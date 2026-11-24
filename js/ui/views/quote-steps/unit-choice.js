/**
 * "¿En qué unidad le cobrás al cliente?" (0.10.0, "La unidad primero").
 *
 * Lo primero que se elige al cotizar es la unidad del ítem que se cotiza, en UN solo desplegable
 * (0.15.0): $/mes, $/día, $/hora, $/trabajo, el catálogo (viaje, m³, km, hora-hombre…) y la opción
 * abierta "$/ otro…", con el nombre que escriba la persona (diagnóstico, válvula…). El modo del contrato (`contract.mode`) se DERIVA de la unidad
 * (modeForUnit) y se sigue guardando porque el motor y muchas pantallas lo leen.
 *
 * Cambiar la unidad con una tarifa cargada pide qué hacer con ella (convertirla día ↔ hora o
 * borrarla): nunca se lee el mismo número en otra unidad sin avisar (QA-E2E-08). Lo cargado en la
 * unidad anterior (cantidades, mínimos) se limpia con aviso (V-03, applyUnitChange) y, si con la
 * unidad cambia el modo, también las "algunas horas" extra (M8, applyContractModeChange).
 */

import { h } from '../../dom.js';
import { formGrid, searchSelectField, openDialog, button } from '../../components.js';
import { BILLING_UNITS, BILLING_UNIT_GROUPS, billingUnitOf, cleanUnitName, unitGroupOf, searchUnits } from '../../../domain/billing-units.js';
import { componentsOf, contractOf, contractWithComponents, modeForUnit, quotedItemText, serviceTypeForContract } from '../../../domain/contract.js';
import { applyUnitChange, applyContractModeChange } from '../../../domain/unit-change.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { isPlainObject } from '../../../core/object.js';
import { isFiniteNumber } from '../../../core/money.js';
import { formatMoney, formatNumber, formatDays } from '../../../core/format.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { stepName } from './shared.js';
import { normalizeActivity } from '../../../engines/cost-engine.js';

/**
 * Unidades que van primero en el desplegable (0.15.0): las de siempre, con un rótulo corto. No son
 * una elección aparte: el desplegable es el único selector de unidad (pedido de Joaco, 2026-11-19).
 */
export const FIRST_UNITS = Object.freeze([
  { value: 'month', label: '$/mes', hint: 'Una tarifa por mes.' },
  { value: 'day', label: '$/día', hint: 'Cada día de trabajo.' },
  { value: 'hour', label: '$/hora', hint: 'Cada hora trabajada.' },
  { value: 'job', label: '$/trabajo', hint: 'Un precio por todo el trabajo u obra.' },
]);
const FIRST_IDS = FIRST_UNITS.map((u) => u.value);
/** Valor de la opción "usar lo que escribí como unidad" del desplegable. */
const TYPED = '__typed:';
/** Rótulo de la opción abierta cuando todavía no tiene nombre. */
export const OPEN_UNIT_LABEL = '$/otra unidad… (escribí el nombre)';

/** Línea del paso 1 mientras la unidad no se eligió (revisión 0.25.0, UX C1). */
export const UNIT_PENDING_TEXT = 'Todavía no elegiste la unidad. Si no elegís, queda por día.';

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
 * Deriva el modo del contrato (MUTA `q`): lo guarda, deriva el tipo de servicio y limpia con aviso
 * lo que se leía en el modo anterior (horas extra, cobros aparte de la guardia). Sirve también para
 * corregir un modo guardado que no corresponde a la unidad (revisión 0.10.0, C2) sin tocar nada más.
 */
export function applyModeDerivation(q, fromMode, toMode, fromTerms = null) {
  const saved = isPlainObject(q.contract) ? q.contract : null;
  const components = componentsOf(saved || contractOf(q));
  q.contract = contractWithComponents({ ...(saved || {}), mode: toMode }, components, saved ? saved.customComponents : undefined);
  q.serviceType = serviceTypeForContract(q.contract);
  return applyContractModeChange(q, fromMode, q.contract.mode, fromTerms);
}

/**
 * Días de trabajo por mes que ya salían de la cantidad (revisión 0.10.0, U6): por cantidad,
 * cantidad por mes ÷ cantidad por día; por trabajo, trabajos × días por trabajo. Los calcula el
 * motor (normalizeActivity), como siempre. null si no hay con qué derivarlos.
 */
function derivedActiveDays(q, fromInfo) {
  if (!(fromInfo.kind === 'quantity' || fromInfo.kind === 'event')) return null;
  const D = normalizeActivity(q).activeDaysPerMonth;
  return Number.isFinite(D) && D > 0 ? D : null;
}

/**
 * Aplica a `q` el cambio de unidad (MUTA `q`) y devuelve los avisos: limpia lo cargado en la
 * unidad anterior, deriva el modo del contrato de la unidad nueva y, por trabajo, arranca en
 * 1 trabajo por mes si no había cantidad. De una unidad por cantidad a hora o día, deja los días
 * de trabajo que ya se derivaban (U6) y lo avisa.
 */
export function applyQuoteUnit(q, nextUnit) {
  const fromInfo = billingUnitOf(q);
  const fromMode = contractOf(q).mode;
  const fromTerms = activationTerms(q);
  const toInfo = billingUnitOf({ ...q, unit: nextUnit });
  const toTime = (toInfo.kind === 'day' || toInfo.kind === 'hour') && fromInfo.id !== toInfo.id;
  const days = toTime ? derivedActiveDays(q, fromInfo) : null;
  q.unit = nextUnit;
  delete q.unitPending;
  const notices = applyUnitChange(q, fromInfo, billingUnitOf(q));
  notices.push(...applyModeDerivation(q, fromMode, modeForUnit(nextUnit), fromTerms));
  if (nextUnit === 'job') {
    if (!isPlainObject(q.activity)) q.activity = {};
    const jobs = q.activity.billableQuantityPerMonth;
    if (jobs === null || jobs === undefined || jobs === '') q.activity.billableQuantityPerMonth = 1;
  }
  if (toTime && (fromInfo.kind === 'quantity' || fromInfo.kind === 'event')) {
    if (days !== null) {
      if (!isPlainObject(q.activity)) q.activity = {};
      q.activity.activeDaysPerMonth = days;
      notices.push(`Quedaron ${formatDays(days)} de trabajo por mes; revisalo acá abajo.`);
    } else {
      notices.push(`Cargá cuántos días de trabajo por mes${toInfo.kind === 'hour' ? ' y cuántas horas por día' : ''}, acá abajo.`);
    }
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
    // Modo guardado que no corresponde a la unidad (revisión 0.10.0, C2): elegir de nuevo la misma
    // unidad sólo deriva el modo (no borra cantidades ni tarifas).
    const fromMode = contractOf(quote).mode;
    const toMode = modeForUnit(nextUnit);
    if (!contractOf(quote).legacy && fromMode !== toMode) {
      let fixed = [];
      ctx.mutate((q) => { fixed = applyModeDerivation(q, fromMode, toMode); });
      ctx.toast(`Cobrás ${perText(billingUnitOf(quote))}.${fixed.length ? ` ${fixed.join(' ')}` : ''}`, fixed.length ? 'warning' : 'success');
      return;
    }
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

// Sin tildes ni mayúsculas, para comparar lo escrito con las unidades del catálogo.
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/**
 * Unidades del desplegable, en orden: mes, día, hora y trabajo; después el catálogo por grupo
 * ("hito" sólo si ya está elegido) y, al final, la opción abierta ("$/ otro…": su nombre lo
 * escribe la persona). Cada una como opción { value, label, hint, unit }.
 * @param {ReturnType<typeof billingUnitOf>} info unidad actual de la cotización
 */
export function unitOptions(info) {
  const current = info.id;
  const rank = (u) => BILLING_UNIT_GROUPS.findIndex((g) => g.id === unitGroupOf(u).id);
  const rest = BILLING_UNITS
    .filter((u) => !FIRST_IDS.includes(u.id) && !u.custom && (u.id !== 'milestone' || current === 'milestone'))
    .map((u, i) => ({ u, i }))
    .sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i)
    .map(({ u }) => ({ value: u.id, label: u.label, hint: unitGroupOf(u).label, unit: u }));
  const first = FIRST_UNITS.map((o) => ({ ...o, unit: BILLING_UNITS.find((u) => u.id === o.value) }));
  const named = info.custom && cleanUnitName(info.singular) && info.singular !== 'unidad';
  const open = {
    value: 'custom',
    label: named ? info.label : OPEN_UNIT_LABEL,
    hint: named ? 'Tu unidad (le cambiás el nombre abajo)' : 'Diagnóstico, válvula, muestra… lo que quieras.',
    unit: { label: 'otro otra unidad propia personalizada', singular: named ? info.singular : '', plural: named ? info.plural : '', short: '', keywords: 'custom libre nombre' },
  };
  // La unidad elegida va primera cuando no es una de las cuatro de arriba: la lista abre siempre
  // con mes, día, hora y trabajo a la vista (revisión 0.15.0).
  if (named) return [open, ...first, ...rest];
  const chosen = rest.find((o) => o.value === current);
  return chosen ? [chosen, ...first, ...rest.filter((o) => o !== chosen), open] : [...first, ...rest, open];
}

/**
 * Unidades comunes que se ven sin escribir (0.25.0, PR 4), además de mes, día, hora y trabajo. Los
 * casi sinónimos (jornal, día-equipo, hora de equipo, turno, guardia) y el resto del catálogo
 * aparecen al escribir. No se borra ninguna: las guardadas siguen valiendo y la elegida se ve siempre.
 */
export const COMMON_UNITS = Object.freeze(['trip', 'km', 'm3', 'ton', 'unit', 'meter', 'm2', 'ha', 'manhour', 'call']);
/** Grupos que se ven sin escribir según el sector de la empresa (organization.industry). */
const SECTOR_UNIT_GROUPS = Object.freeze({ oil_gas: ['oilfield', 'energy'], mining: ['oilfield', 'energy'], energy: ['oilfield', 'energy'] });

/** true si la opción se ve con el buscador vacío. */
export function unitShownWithoutTyping(option, { current = null, sector = null } = {}) {
  if (!option) return false;
  const value = String(option.value);
  if (value === 'custom' || FIRST_IDS.includes(value) || COMMON_UNITS.includes(value) || value === current) return true;
  const groups = SECTOR_UNIT_GROUPS[sector] || [];
  return Boolean(option.unit) && groups.includes(unitGroupOf(option.unit).id);
}

/**
 * Lo que muestra el desplegable al escribir: las unidades que coinciden y, si lo escrito no es
 * exactamente una de ellas, la opción de usarlo como unidad propia ("$/diagnóstico"). Sin texto,
 * la lista corta (unitShownWithoutTyping); sin `view`, todas (como antes de la 0.25.0).
 * @param {{ current?: string|null, sector?: string|null }|null} view unidad elegida y sector de la empresa
 */
export function searchUnitOptions(options, query, view = null) {
  const typed = cleanUnitName(query);
  if (!typed && view && view.preferCommon) {
    // Revisión 0.25.0 (UX C1): quien tocó la tarjeta de las otras unidades ve primero las comunes
    // (viaje, km, m³…) y después las cuatro de siempre.
    const shown = options.filter((o) => unitShownWithoutTyping(o, view));
    const common = COMMON_UNITS.map((id) => shown.find((o) => o.value === id)).filter(Boolean);
    return [...common, ...shown.filter((o) => !common.includes(o))];
  }
  if (!typed) return view ? options.filter((o) => unitShownWithoutTyping(o, view)) : [...options];
  const found = searchUnits(options.map((o) => o.unit), query);
  const matches = options.filter((o) => found.includes(o.unit) && o.value !== 'custom');
  const exact = options.some((o) => o.value !== 'custom' && [o.unit.singular, o.unit.plural, o.unit.short, o.label.replace(/^\$\/?\s*/, '')].some((t) => fold(t) === fold(typed)));
  const own = exact ? [] : [{ value: `${TYPED}${typed}`, label: `$/${typed}`, hint: 'Usar como unidad propia' }];
  return [...matches, ...own];
}

/**
 * Tarjeta del paso 1: UN solo desplegable con todas las unidades ($/mes, $/día, $/hora, $/trabajo,
 * el catálogo y "$/ otro…"), el nombre de la unidad propia y la línea "Vas a cotizar: $ por
 * diagnóstico". Escribir una unidad que no está la ofrece como unidad propia.
 */
export function unitChoiceBlock(ctx) {
  const { quote, kit } = ctx;
  const info = billingUnitOf(quote);
  const options = unitOptions(info);
  const def = BILLING_UNITS.find((u) => u.id === info.id) || {};
  // Revisión 0.25.0 (UX C1): creada sin elegir la unidad. Se guarda por día (como siempre) con una
  // marca que se borra al elegir; mientras tanto el buscador arranca vacío.
  const pending = quote.unitPending === true;
  const pick = async (value) => {
    if (quote.unitPending === true) {
      ctx.mutate((q) => { delete q.unitPending; });
      if (value === (quote.unit || 'day')) {
        ctx.toast(`Cobrás ${perText(billingUnitOf(quote))}.`, 'success');
        return;
      }
    }
    const typed = typeof value === 'string' && value.startsWith(TYPED) ? cleanUnitName(value.slice(TYPED.length)) : null;
    // Lo escrito pasa a ser el nombre ANTES de cambiar la unidad: el aviso ya dice "Cobrás por diagnóstico".
    const wasCustom = (quote.unit || 'day') === 'custom';
    const previousName = quote.unitName;
    if (typed) ctx.mutate((q) => { q.unitName = typed; });
    await changeQuoteUnit(ctx, typed !== null ? 'custom' : value);
    // Canceló el cambio (había una tarifa cargada): el nombre escrito no queda guardado.
    if (typed && (quote.unit || 'day') !== 'custom') ctx.mutate((q) => { q.unitName = previousName; });
    else if (typed && wasCustom && typed !== cleanUnitName(previousName)) ctx.toast(`Cobrás por ${typed}.`, 'success');
    if ((quote.unit || 'day') === 'custom' && !cleanUnitName(quote.unitName)) ctx.focusField('unitName');
  };
  const choice = formGrid(2, searchSelectField({
    label: '¿En qué unidad le cobrás al cliente?',
    name: 'unit',
    value: pending ? null : info.id,
    disabled: kit.readOnly,
    allowEmpty: false,
    placeholder: pending ? 'Escribí: viaje, m³, km, tonelada…' : 'Elegí o escribí: mes, hora, viaje, m³, diagnóstico…',
    options,
    search: (query) => searchUnitOptions(options, query, pending ? { current: null, sector: ctx.sector || null, preferCommon: true } : { current: info.id, sector: ctx.sector || null }),
    hint: pending
      ? 'Si la tuya no está, escribila y elegí "Usar como unidad propia".'
      : info.custom
      ? 'Unidad propia: le ponés el nombre que quieras.'
      : `${(FIRST_UNITS.find((u) => u.value === info.id) || {}).hint || def.hint || ''} Si la tuya no está, escribila y elegí "Usar como unidad propia".`.trim(),
    onChange: pick,
  }));
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
        // Se vuelve a dibujar: el desplegable muestra el nombre nuevo ("$/diagnóstico").
        ctx.mutate((q) => { q.unitName = clean; });
      });
    }
  }
  const quoted = pending
    ? h('p', { class: 'qe-quoted-item qe-unit-pending', role: 'status' }, UNIT_PENDING_TEXT)
    : h('p', { class: 'qe-quoted-item' },
      h('span', { class: 'qe-quoted-item-label' }, 'Vas a cotizar: '),
      h('strong', {}, quotedItemText(quote)));
  return h('div', { class: 'qe-unit-first' }, choice, nameField ? formGrid(2, nameField) : null, quoted);
}
