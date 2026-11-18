/**
 * "¿En qué unidad le cobrás al cliente?" (0.10.0, "La unidad primero").
 *
 * Lo primero que se elige al cotizar es la unidad del ítem que se cotiza: por mes, por trabajo,
 * por hora, por día, por unidad (con su nombre: diagnóstico, válvula…) u otra del catálogo
 * (viaje, m³, km, hora-hombre…). El modo del contrato (`contract.mode`) se DERIVA de la unidad
 * (modeForUnit) y se sigue guardando porque el motor y muchas pantallas lo leen.
 *
 * Cambiar la unidad con una tarifa cargada pide qué hacer con ella (convertirla día ↔ hora o
 * borrarla): nunca se lee el mismo número en otra unidad sin avisar (QA-E2E-08). Lo cargado en la
 * unidad anterior (cantidades, mínimos) se limpia con aviso (V-03, applyUnitChange) y, si con la
 * unidad cambia el modo, también las "algunas horas" extra (M8, applyContractModeChange).
 */

import { h } from '../../dom.js';
import { formGrid, choiceGroup, searchSelectField, openDialog, button } from '../../components.js';
import { BILLING_UNITS, BILLING_UNIT_GROUPS, billingUnitOf, cleanUnitName, unitGroupOf, searchUnits } from '../../../domain/billing-units.js';
import { componentsOf, contractOf, contractWithComponents, modeForUnit, quotedItemText, serviceTypeForContract } from '../../../domain/contract.js';
import { applyUnitChange, applyContractModeChange } from '../../../domain/unit-change.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { isPlainObject } from '../../../core/object.js';
import { isFiniteNumber } from '../../../core/money.js';
import { formatMoney, formatNumber, formatDays } from '../../../core/format.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { stepName } from './shared.js';
import { onSessionReset } from '../../session-memory.js';

/** Opciones rápidas, en este orden. `custom` = "Por unidad" (con el nombre que le ponga la persona). */
export const QUICK_UNITS = Object.freeze([
  { value: 'month', label: 'Por mes', hint: 'Una tarifa por mes.' },
  { value: 'job', label: 'Por trabajo', hint: 'Un precio por todo el trabajo u obra.' },
  { value: 'hour', label: 'Por hora', hint: 'Cada hora trabajada.' },
  { value: 'day', label: 'Por día', hint: 'Cada día de trabajo.' },
  { value: 'custom', label: 'Por unidad', hint: 'Vos le ponés el nombre: diagnóstico, válvula, muestra…' },
]);
const OTHER = '__other';
const QUICK_IDS = QUICK_UNITS.map((u) => u.value);

/** Cotizaciones en las que se abrió "Otra unidad…" sin elegir todavía (sólo en pantalla). */
const otherOpen = new Set();
onSessionReset(() => otherOpen.clear());

/** "por llamado", "por m³"… */
const perText = (info) => `por ${info.singular || 'unidad'}`;

/** Diálogo al cambiar la unidad con tarifas cargadas: 'convert' | 'clear' | null. */
export function askUnitChange({ from, to, fromUnit, rates, convertible, hours }) {
  return new Promise((resolve) => {
    let choice = null;
    const list = h(
      'ul',
      {},
      ...rates.map((r) => h('li', {}, `${r.label}: ${formatMoney(r.value)} ${perText(from)}${convertible ? ` → ${formatMoney(r.converted)} ${perText(to)}` : ''}`)),
    );
    const explanation = convertible
      ? `Podés convertirla con las ${formatNumber(hours, { decimals: 2 })} horas trabajadas por día de trabajo (${fromUnit === 'day' ? '÷' : '×'} ${formatNumber(hours, { decimals: 2 })}, redondeado hacia arriba) o borrarla y cargarla de nuevo.`
      : 'Entre estas unidades no hay una conversión segura: borrala y cargala de nuevo en la unidad nueva.';
    const { close } = openDialog({
      title: `Cobrar ${perText(to)}`,
      content: h(
        'div',
        {},
        h('p', {}, `Hay tarifas cargadas ${perText(from)}. Si cambiás la unidad sin convertirlas, el mismo número se leería ${perText(to)} y el resultado sería engañoso.`),
        list,
        h('p', {}, explanation),
      ),
      actions: [
        button('Cancelar', { variant: 'secondary', onClick: () => close() }),
        button('Borrar la tarifa y cambiar', { variant: convertible ? 'secondary' : 'primary', onClick: () => { choice = 'clear'; close(); } }),
        convertible ? button(`Convertir ${perText(to)}`, { variant: 'primary', onClick: () => { choice = 'convert'; close(); } }) : null,
      ].filter(Boolean),
      onClose: () => resolve(choice),
    });
  });
}

/**
 * Aplica a `q` el cambio de unidad (MUTA `q`) y devuelve los avisos: limpia lo cargado en la
 * unidad anterior, deriva el modo del contrato de la unidad nueva y, por trabajo, arranca en
 * 1 trabajo por mes si no había cantidad.
 */
export function applyQuoteUnit(q, nextUnit) {
  const fromInfo = billingUnitOf(q);
  const fromMode = contractOf(q).mode;
  q.unit = nextUnit;
  const notices = applyUnitChange(q, fromInfo, billingUnitOf(q));
  const saved = isPlainObject(q.contract) ? q.contract : null;
  const components = componentsOf(saved || contractOf(q));
  q.contract = contractWithComponents({ ...(saved || {}), mode: modeForUnit(nextUnit) }, components, saved ? saved.customComponents : undefined);
  q.serviceType = serviceTypeForContract(q.contract);
  notices.push(...applyContractModeChange(q, fromMode, q.contract.mode));
  if (nextUnit === 'job') {
    if (!isPlainObject(q.activity)) q.activity = {};
    const jobs = q.activity.billableQuantityPerMonth;
    if (jobs === null || jobs === undefined || jobs === '') q.activity.billableQuantityPerMonth = 1;
  }
  return notices;
}

/**
 * Cambio de unidad desde la pantalla: con tarifas cargadas pregunta (convertir día ↔ hora o
 * borrar); sin tarifas, cambia y avisa lo que se limpió. Cancelar vuelve a la unidad anterior.
 */
export async function changeQuoteUnit(ctx, nextUnit) {
  const { quote } = ctx;
  const fromUnit = quote.unit || 'day';
  if (nextUnit === fromUnit) {
    ctx.rerender();
    return;
  }
  const from = billingUnitOf(quote);
  const to = billingUnitOf({ ...quote, unit: nextUnit });
  const pricing = quote.pricing || {};
  const hours = quote.activity ? quote.activity.hoursPerActiveDay : null;
  const timeToTime = ['day', 'hour'].includes(from.kind) && ['day', 'hour'].includes(to.kind);
  const minCall = Number(quote.rules && quote.rules.minimumCallUnits);
  const T = activationTerms(quote);
  let notices = [];
  const minCallUnitText = (n, u) => (u.kind === 'hour'
    ? `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? 'hora' : 'horas'}`
    : formatDays(n));
  const changeNote = () => {
    const now = Number(quote.rules && quote.rules.minimumCallUnits);
    const converted = Number.isFinite(minCall) && minCall > 0 && timeToTime && Number.isFinite(now) && now > 0 && Math.abs(now - minCall) > 1e-9
      ? ` Mínimo ${T.per}: ${minCallUnitText(minCall, from)} → ${minCallUnitText(now, to)}.`
      : '';
    return `${converted}${notices.length ? ` ${notices.join(' ')}` : ''}`;
  };
  otherOpen.delete(quote.id);
  const rates = [
    { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
    { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
  ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
  if (rates.length === 0) {
    ctx.mutate((q) => { notices = applyQuoteUnit(q, nextUnit); });
    const note = changeNote();
    ctx.toast(`Cobrás ${perText(to)}.${note}`, notices.length ? 'warning' : 'success');
    return;
  }
  rates.forEach((r) => {
    r.converted = timeToTime ? convertRateUnit(r.value, fromUnit, nextUnit, hours) : null;
  });
  const convertible = rates.every((r) => isFiniteNumber(r.converted));
  const choice = await askUnitChange({ from, to, fromUnit, rates, convertible, hours: Number(hours) });
  if (choice === 'convert' && convertible) {
    ctx.mutate((q) => {
      notices = applyQuoteUnit(q, nextUnit);
      rates.forEach((r) => { q.pricing[r.path] = r.converted; });
    });
    ctx.toast(`Cobrás ${perText(to)}. ${rates.map((r) => `${r.label}: ${formatMoney(r.converted)} ${perText(to)}`).join(' · ')}.${changeNote()}`, notices.length ? 'warning' : 'success');
  } else if (choice === 'clear') {
    ctx.mutate((q) => {
      notices = applyQuoteUnit(q, nextUnit);
      rates.forEach((r) => { q.pricing[r.path] = r.path === 'knownRate' ? 0 : null; });
    });
    ctx.toast(`Cobrás ${perText(to)}. Se borró la tarifa: cargala de nuevo ${perText(to)}.${changeNote()}`, 'warning');
  } else {
    ctx.rerender();
  }
}

/** Unidades del buscador "Otra unidad…": todas menos las rápidas y "hito" (sólo si ya está). */
function otherUnits(current) {
  const list = BILLING_UNITS.filter((u) => !QUICK_IDS.includes(u.id) && (u.id !== 'milestone' || current === 'milestone'));
  const rank = (u) => BILLING_UNIT_GROUPS.findIndex((g) => g.id === unitGroupOf(u).id);
  return list.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map((x) => x.u);
}

/**
 * Tarjeta del paso 1: opciones rápidas, buscador de otras unidades, nombre de la unidad propia
 * y la línea "Vas a cotizar: $ por diagnóstico".
 */
export function unitChoiceBlock(ctx) {
  const { quote, kit } = ctx;
  const info = billingUnitOf(quote);
  const current = info.id;
  const quick = QUICK_IDS.includes(current);
  const showOther = !quick || otherOpen.has(quote.id);
  const choice = choiceGroup({
    label: '¿En qué unidad le cobrás al cliente?',
    name: 'unit',
    value: showOther ? OTHER : current,
    disabled: kit.readOnly,
    options: [...QUICK_UNITS, { value: OTHER, label: 'Otra unidad…', hint: 'Viaje, m³, km, hora-hombre, pozo…' }],
    onChange: (value) => {
      if (value === OTHER) {
        otherOpen.add(quote.id);
        ctx.rerender();
        return;
      }
      changeQuoteUnit(ctx, value);
    },
  });
  const units = otherUnits(current);
  const toOption = (u) => ({ value: u.id, label: u.label, hint: unitGroupOf(u).label });
  const search = showOther
    ? formGrid(2, searchSelectField({
      label: 'Buscá la unidad',
      name: 'unitOther',
      value: quick ? null : current,
      disabled: kit.readOnly,
      allowEmpty: false,
      placeholder: 'Escribí: viaje, m³, kWh, hora-hombre, junta…',
      options: units.map(toOption),
      search: (query) => searchUnits(units, query).map(toOption),
      hint: !quick && info.id !== 'custom' ? (BILLING_UNITS.find((u) => u.id === current) || {}).hint || null : 'Si no está, elegí "Por unidad" y escribí su nombre.',
      onChange: (value) => changeQuoteUnit(ctx, value),
    }))
    : null;
  let nameField = null;
  if (info.custom) {
    nameField = kit.text('unitName', {
      label: '¿Cómo se llama tu unidad?',
      maxLength: 30,
      placeholder: 'Ej.: diagnóstico, válvula, muestra',
      hint: 'En singular. Vas a cobrar "$ por diagnóstico" y cargar cuántos hacés por mes.',
    });
    const input = nameField.querySelector('input');
    if (input) {
      input.addEventListener('change', () => {
        const clean = cleanUnitName(input.value);
        ctx.mutate((q) => { q.unitName = clean; });
      });
    }
  }
  const quoted = h('p', { class: 'qe-quoted-item' },
    h('span', { class: 'qe-quoted-item-label' }, 'Vas a cotizar: '),
    h('strong', {}, quotedItemText(quote)));
  return h('div', { class: 'qe-unit-first' }, choice, search, nameField ? formGrid(2, nameField) : null, quoted);
}
