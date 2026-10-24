/**
 * Etapa 1 · El servicio — Cómo se cobra (modalidad).
 * Básico: modo (conozco la tarifa / conozco la actividad), unidad (las
 * habituales del tipo de servicio + "Otra / personalizada", PLAN-2026-009),
 * tarifa conocida y la actividad EN LA UNIDAD COMERCIAL:
 *   $/día, $/hora, $/mes      días trabajados por mes y días por llamado (como siempre)
 *   $/m³, $/viaje, $/turno…   cantidad a facturar por mes + cantidad por día de trabajo
 *   $/llamado, $/trabajo, $/hito  llamados o trabajos por mes + días de trabajo de cada uno
 * Los días de trabajo (lo que consume personal, equipos y combustible) se
 * derivan en el motor: UNIDAD DE COSTO ≠ UNIDAD DE VENTA.
 * Opciones avanzadas: días disponibles, horas por día, disponibilidad on-call
 * y tiempo de respuesta (con un resumen visible de lo aplicado).
 *
 * UX-UNITS: la unidad de cobro se elige como "ARS / [unidad]"; el rendimiento
 * se carga como "[número] [m³ | viajes…] / [día de trabajo | hora]" y la
 * cantidad del mes en la unidad de cobro o en días de trabajo (unit-pairs.js).
 * Al cambiar la unidad, tarifas, cantidades y mínimo se convierten sólo con un
 * factor exacto; si no lo hay, se borran y se piden de nuevo. Una frase de
 * ayuda por campo y lo secundario en (i).
 */

import { h, mount, uniqueId } from '../../dom.js';
import { card, formGrid, openDialog, button, numberField, addInfoTip } from '../../components.js';
import { PRICING_MODES, AVAILABILITY_OPTIONS } from '../../../domain/catalogs.js';
import { billingUnitOf, unitChoicesFor, unitTexts, cleanUnitName } from '../../../domain/billing-units.js';
import {
  rateNumeratorsFor, loadUnitOf, rateInputOf, isNativeRate, unitsPerActiveDayFrom, quantityFromWorkdays,
  workdaysFromQuantity, quantityBasisOf, quantityFactorBetween, convertExact,
} from '../../../domain/unit-pairs.js';
import { quoteCurrencyOf } from './resource-line.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { convertMinimumCallUnits } from '../../../engines/commercial-rules-engine.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace, hasNumber, stepName } from './shared.js';
import { quantityText, quantityCeilText, workDaysText, capitalizeUnitPhrase } from '../../unit-text.js';
import { activationRoundingText } from '../../result-text.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { transportStats } from './transport.js';

const MODE_LABELS = Object.freeze({
  known_rate: 'Sí, ya tengo la tarifa',
  known_activity: 'No: calculá cuánto cobrar',
});

/** Hasta cuántas unidades de cobro se muestran a la vista (botones de opción); con más, un selector. */
const UNIT_CHIPS_MAX = 6;

/** Una frase por opción (UX-UNITS): qué calcula RATEOS en cada caso. */
const MODE_HINTS = Object.freeze({
  known_rate: 'Cargás tu tarifa: RATEOS calcula cuánto facturar para no perder y cuánto ganás.',
  known_activity: 'Cargás la actividad: RATEOS calcula la tarifa piso y la tarifa con margen.',
});

/** Nombre de la unidad en el selector "ARS / [unidad]": "m³", "hora", "mes (abono)", "trabajo (precio global)". */
function unitOptionLabel(def) {
  if (def.custom) return 'otra (la escribís vos)';
  if (def.id === 'job') return 'trabajo (precio global)';
  if (def.id === 'month') return 'mes (abono)';
  return def.singular;
}

/** "m³ por día de trabajo", "viajes por hora". */
function rateFormText(plural, denominator) {
  return `${plural} por ${denominator === 'hour' ? 'hora' : 'día de trabajo'}`;
}

/** Número positivo o null (para leer datos de la cotización). */
function positiveOrNull(v) {
  return isFiniteNumber(v) && v > 0 ? v : null;
}

const AVAILABILITY_HINTS = Object.freeze({
  '24/7': 'Disponible todos los días, a toda hora. Normalmente exige relevos.',
  window: 'Disponible sólo en una franja horaria acordada.',
});

/**
 * Rótulo de los días por activación con el nombre de la cotización (PLAN-2026-014, LAB-D8).
 * En un servicio permanente es un intervalo (cada cuántos días), no una duración.
 */
function daysPerActivationLabel(T, serviceType) {
  if (serviceType === 'permanent') return `¿Cada cuántos días hay ${T.a} ${T.one}?`;
  return `¿Cuántos días dura ${T.each}?`;
}

/** Unidades facturables en la unidad comercial ("8 días", "160 horas", "1 abono", "10.000 m³"). */
function unitsLabel(r, value) {
  const unit = r.unit;
  if (unit === 'hour') return `${formatNumber(value, { decimals: 2 })} horas`;
  if (unit === 'month') return `${formatNumber(value, { decimals: 2 })} ${Math.abs(value - 1) < 1e-9 ? 'abono' : 'abonos'}`;
  if (unit === 'quantity' || unit === 'event') return quantityText(value, r);
  return `${formatNumber(value, { decimals: 2 })} días`;
}

/** Rótulo de la tarifa: "$/día", "$/mes (abono)" (como siempre) o "$/m³", "$/viaje", "$/pozo". */
function rateLabelOf(info) {
  return info.legacy ? info.label : `$/${info.singular}`;
}

/** Sufijo del campo de tarifa: "$/día", "$/m³", "$/u.". */
function rateSuffixOf(info) {
  return info.legacy ? info.label.replace(/\s*\(.*\)$/, '') : `$/${info.short}`;
}

/** "Por llamado", "por m³"… (diálogo de cambio de unidad). */
function perText(info) {
  return `por ${info.singular || 'unidad'}`;
}

/** ¿El mínimo por llamado se aplica con esta unidad? (no con abono ni por llamado/trabajo). */
function minimumCallApplies(kind) {
  return kind === 'day' || kind === 'hour' || kind === 'quantity';
}

function rateRowFor(result, marginPct) {
  return (result.ratesAtEstimate.byMargin || []).find((m) => m.marginPct === marginPct) || null;
}

/**
 * Diálogo al cambiar la unidad con datos cargados (QA-E2E-08, UX-UNITS):
 * tarifas, cantidad del mes y rendimiento. Cada renglón dice cómo queda: se
 * convierte con un factor conocido o se borra para cargarlo de nuevo. Nunca se
 * lee el mismo número en la unidad nueva. → 'convert' | 'clear' | null.
 */
function askUnitChange({ from, to, items, convertible, explanation }) {
  return new Promise((resolve) => {
    let choice = null;
    const list = h(
      'ul',
      {},
      ...items.map((it) => h('li', {}, `${it.label}: ${it.before}${convertible && it.after ? ` → ${it.after}` : ''}`)),
    );
    const { close } = openDialog({
      title: `Cambiar la unidad a ${to.label}`,
      content: h(
        'div',
        {},
        h('p', {}, `Hay datos cargados en ${from.label}. Si cambiás la unidad sin convertirlos, el mismo número se leería ${perText(to)} y el resultado sería engañoso.`),
        list,
        h('p', {}, explanation),
      ),
      actions: [
        button('Cancelar', { variant: 'secondary', onClick: () => close() }),
        button(convertible ? 'Borrar y cambiar' : 'Borrar y cargar de nuevo', { variant: convertible ? 'secondary' : 'primary', onClick: () => { choice = 'clear'; close(); } }),
        convertible ? button(`Convertir a ${to.label}`, { variant: 'primary', onClick: () => { choice = 'convert'; close(); } }) : null,
      ].filter(Boolean),
      onClose: () => resolve(choice),
    });
  });
}

export function render(container, ctx) {
  const { quote, kit, settings } = ctx;
  const info = billingUnitOf(quote);
  // Unidad "viaje" (PLAN-2026-012): los viajes físicos por intervención se
  // derivan de los viajes por día × días por intervención. Al editar esos
  // datos se deja el mismo número en "Viajes por llamado" (que con esta unidad
  // no rige), así nunca queda un dato viejo distinto.
  const tripUnit = info.id === 'trip' && info.kind === 'quantity';
  const syncRouteTrips = () => {
    if (!tripUnit) return;
    const perDay = Number(kit.get('activity.unitsPerActiveDay'));
    const dpaRaw = kit.get('activity.daysPerActivation');
    const dpa = dpaRaw === null || dpaRaw === undefined || dpaRaw === '' ? 1 : Number(dpaRaw);
    if (!(Number.isFinite(perDay) && perDay > 0) || !(Number.isFinite(dpa) && dpa > 0)) return;
    ctx.update('logistics.tripsPerActivation', perDay * dpa);
  };
  const texts = unitTexts(info);
  const kind = info.kind;
  // Por cantidad (m³, viajes, turnos…) o por evento (llamados, trabajos, hitos):
  // la actividad se carga en la unidad comercial y los días de trabajo se derivan.
  const byQuantity = kind === 'quantity' || kind === 'event';
  const isOnCall = quote.serviceType === 'on_call';
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const num = (v) => formatNumber(v, { decimals: 2 });
  const knownRate = quote.pricingMode === 'known_rate';
  const Plural = capitalizeUnitPhrase(info.plural);

  /**
   * Cambio de unidad (QA-E2E-08, UX-UNITS): las tarifas (conocida y ofrecida),
   * la cantidad del mes y el rendimiento cargados se convierten sólo con un
   * factor conocido (día ↔ hora con las horas por día; kg ↔ t y metro ↔ km,
   * exactos) o se borran y se piden de nuevo. Nunca se reinterpreta el mismo
   * número en otra unidad (200 m³ no pasan a ser 200 viajes). El mínimo por
   * llamado (en la unidad de la tarifa) se convierte igual; si no se puede, se avisa.
   */
  async function changeUnit(nextUnit) {
    const fromUnit = quote.unit || 'day';
    if (nextUnit === fromUnit) return;
    const from = billingUnitOf(quote);
    const to = billingUnitOf({ ...quote, unit: nextUnit });
    const pricing = quote.pricing || {};
    const activity = quote.activity || {};
    const hours = activity.hoursPerActiveDay;
    const timeToTime = ['day', 'hour'].includes(from.kind) && ['day', 'hour'].includes(to.kind);
    // kg ↔ t, metro ↔ km: cantidad nueva = cantidad × factor; tarifa nueva = tarifa ÷ factor.
    const exactFactor = from.kind === 'quantity' && to.kind === 'quantity' ? quantityFactorBetween(from.id, to.id) : null;
    const factorNote = exactFactor === null ? '' : ['kg', 'ton'].includes(from.id) ? '1 t = 1.000 kg' : '1 km = 1.000 m';
    const minCall = Number(quote.rules && quote.rules.minimumCallUnits);
    const hasMinCall = Number.isFinite(minCall) && minCall > 0 && minimumCallApplies(from.kind) && minimumCallApplies(to.kind) && from.id !== to.id;
    let minCallConverted = null;
    if (hasMinCall && timeToTime) minCallConverted = convertMinimumCallUnits(minCall, fromUnit, nextUnit, hours);
    else if (hasMinCall && exactFactor !== null) minCallConverted = convertExact(minCall, exactFactor);
    const applyMinCall = (q) => {
      if (hasMinCall && isFiniteNumber(minCallConverted) && q.rules) q.rules.minimumCallUnits = minCallConverted;
    };
    const minCallUnitText = (n, u) => {
      if (u.kind === 'hour') return `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? 'hora' : 'horas'}`;
      if (u.kind === 'day') return formatDays(n);
      return quantityText(n, { unitInfo: u });
    };
    let minCallNote = '';
    if (hasMinCall) {
      if (isFiniteNumber(minCallConverted)) {
        minCallNote = ` Mínimo ${T.per}: ${minCallUnitText(minCall, from)} → ${minCallUnitText(minCallConverted, to)}.`;
      } else if (timeToTime) {
        minCallNote = ` Revisá el mínimo ${T.per} en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir (faltan las horas por día activo).`;
      } else {
        minCallNote = ` Revisá el mínimo ${T.per} en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir y ahora se lee en ${to.plural || 'la unidad nueva'}.`;
      }
    }
    const rates = [
      { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
      { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
    ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
    rates.forEach((r) => {
      if (timeToTime) r.converted = convertRateUnit(r.value, fromUnit, nextUnit, hours);
      else if (exactFactor !== null) r.converted = convertExact(r.value, 1 / exactFactor);
      else r.converted = null;
      r.before = `${formatMoney(r.value)} ${perText(from)}`;
      r.after = isFiniteNumber(r.converted) ? `${formatMoney(r.converted)} ${perText(to)}` : null;
    });
    // Cantidad del mes y rendimiento (UX-UNITS, F4): están en la unidad de cobro. Entre día y hora no se
    // usan; en cualquier otro cambio se convierten con un factor exacto o se borran (un dato guardado de
    // una unidad anterior tampoco se reusa: no se sabe en qué unidad está).
    const quantityKinds = ['quantity', 'event'];
    const touchesQuantities = quantityKinds.includes(from.kind) || quantityKinds.includes(to.kind);
    const inFrom = quantityKinds.includes(from.kind);
    const qty = touchesQuantities ? positiveOrNull(Number(activity.billableQuantityPerMonth)) : null;
    const perDay = touchesQuantities ? positiveOrNull(Number(activity.unitsPerActiveDay)) : null;
    const quantities = [];
    if (qty !== null) {
      const converted = exactFactor !== null ? convertExact(qty, exactFactor) : null;
      quantities.push({
        path: 'billableQuantityPerMonth',
        label: 'Cantidad del mes',
        value: qty,
        converted,
        before: inFrom ? `${quantityText(qty, { unitInfo: from })} por mes` : `${formatNumber(qty, { decimals: 2 })} (de una unidad anterior)`,
        after: converted !== null ? `${quantityText(converted, { unitInfo: to })} por mes` : null,
      });
    }
    if (perDay !== null) {
      const converted = exactFactor !== null ? convertExact(perDay, exactFactor) : null;
      const input = from.kind === 'quantity' ? rateInputOf(activity, from) : null;
      const shownBefore = input && input.value !== null && !isNativeRate(input, from)
        ? `${num(input.value)} ${rateFormText(rateNumeratorsFor(from).find((n) => n.id === input.numerator).plural, input.denominator)}`
        : `${formatNumber(perDay, { decimals: 2 })} ${from.kind === 'quantity' ? rateFormText(from.plural, 'day') : '(de una unidad anterior)'}`;
      quantities.push({
        path: 'unitsPerActiveDay',
        label: 'Rendimiento',
        value: perDay,
        converted,
        before: shownBefore,
        after: converted !== null ? `${num(converted)} ${rateFormText(to.plural, 'day')}` : null,
      });
    }
    const minCallTone = minCallNote && !isFiniteNumber(minCallConverted) ? 'warning' : 'success';
    const items = [...rates, ...quantities];
    if (items.length === 0) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
      });
      if (minCallNote) ctx.toast(`Unidad cambiada a ${to.label}.${minCallNote}`, minCallTone);
      return;
    }
    const convertible = items.every((it) => isFiniteNumber(it.converted));
    let explanation;
    if (convertible && timeToTime) {
      explanation = `Podés convertirla con las ${formatNumber(Number(hours), { decimals: 2 })} horas trabajadas por día activo (${fromUnit === 'day' ? '÷' : '×'} ${formatNumber(Number(hours), { decimals: 2 })}, redondeado hacia arriba) o borrarla y cargarla de nuevo.`;
    } else if (convertible) {
      explanation = `Podés convertirlos con el factor exacto (${factorNote}) o borrarlos y cargarlos de nuevo.`;
    } else {
      explanation = `Entre estas unidades no hay una conversión segura: se borran y los cargás de nuevo en ${to.plural || 'la unidad nueva'}.`;
    }
    const choice = await askUnitChange({ from, to, items, convertible, explanation });
    // Lo que queda de la forma de carga (UX-UNITS): se quita si los datos cambian de unidad o se borran.
    const resetInputs = (q, { keepWorkdays }) => {
      if (!q.activity) return;
      if (q.activity.rateInput) q.activity.rateInput = null;
      if (!keepWorkdays && q.activity.quantityInput) q.activity.quantityInput = null;
    };
    if (choice === 'convert' && convertible) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.converted;
        });
        quantities.forEach((it) => {
          q.activity[it.path] = it.converted;
        });
        // Con un factor exacto los días de trabajo no cambian: "10 días de trabajo por mes" sigue valiendo.
        if (quantities.length) resetInputs(q, { keepWorkdays: true });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. ${items.map((it) => `${it.label}: ${it.after}`).join(' · ')}.${minCallNote}`, minCallTone);
    } else if (choice === 'clear') {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.path === 'knownRate' ? 0 : null;
        });
        quantities.forEach((it) => {
          q.activity[it.path] = null;
        });
        if (quantities.length) resetInputs(q, { keepWorkdays: false });
      });
      const cleared = [rates.length ? 'la tarifa' : null, ...quantities.map((it) => (it.path === 'unitsPerActiveDay' ? 'el rendimiento' : 'la cantidad del mes'))].filter(Boolean);
      const what = cleared.length > 1 ? `Se borraron ${cleared.slice(0, -1).join(', ')} y ${cleared[cleared.length - 1]}` : `Se borró ${cleared[0]}`;
      ctx.toast(`Unidad cambiada a ${to.label}. ${what}: cargá los datos de nuevo en ${to.label}.${minCallNote}`, 'warning');
    } else {
      // Cancelado: vuelve a mostrar la unidad anterior.
      ctx.rerender();
    }
  }

  // Unidades habituales del tipo de servicio (+ la actual si no está, + "Otra / personalizada").
  const unitOptions = unitChoicesFor(quote.serviceType, info.id);
  const selectedDef = unitOptions.find((u) => u.id === info.id);
  const currency = quoteCurrencyOf(quote);

  /**
   * Unidad de cobro como "ARS / [unidad]" (UX-UNITS): la moneda es la de la
   * empresa (fija en la cotización) y la unidad se elige de las habituales del
   * tipo de servicio. Con pocas opciones (hasta UNIT_CHIPS_MAX) van a la vista
   * como botones de opción; con más, en un selector (GOV.UK: las opciones
   * cortas se muestran). Al cambiarla, changeUnit pide qué hacer con los datos.
   */
  function unitField() {
    const id = uniqueId('unit');
    const hint = h('div', { class: 'field-hint', id: `${id}-hint` }, selectedDef && selectedDef.hint ? selectedDef.hint : '');
    const prefix = h('span', { class: 'qe-compound-fixed', 'aria-hidden': 'true' }, `${currency} /`);
    let el;
    if (unitOptions.length <= UNIT_CHIPS_MAX) {
      el = h(
        'fieldset',
        { class: 'choice-group qe-unit-field qe-unit-chips', 'aria-describedby': `${id}-hint` },
        h('legend', { class: 'field-label' }, 'Unidad de cobro', h('span', { class: 'sr-only' }, ` (${currency} por unidad)`)),
        h(
          'div',
          { class: 'qe-compound' },
          prefix,
          h('div', { class: 'qe-chips' }, ...unitOptions.map((u) => {
            const input = h('input', { type: 'radio', name: 'unit', value: u.id, checked: u.id === info.id, disabled: kit.readOnly });
            input.addEventListener('change', () => {
              if (input.checked) changeUnit(u.id);
            });
            return h('label', { class: 'qe-chip' }, input, h('span', {}, unitOptionLabel(u)));
          })),
        ),
        hint,
      );
    } else {
      const select = h(
        'select',
        { id, name: 'unit', disabled: kit.readOnly, 'aria-describedby': `${id}-hint` },
        ...unitOptions.map((u) => h('option', { value: u.id, selected: u.id === info.id }, unitOptionLabel(u))),
      );
      select.addEventListener('change', () => changeUnit(select.value));
      el = h(
        'div',
        { class: 'field qe-unit-field' },
        h('label', { class: 'field-label', for: id }, 'Unidad de cobro', h('span', { class: 'sr-only' }, ` (${currency} por unidad)`)),
        h('div', { class: 'qe-compound' }, prefix, h('div', { class: 'field-control' }, select)),
        hint,
      );
    }
    const tip = `La tarifa va en ${currency}, la moneda de tu empresa (Configuración); los insumos en otra moneda se pasan con el tipo de cambio de la cotización.`;
    return addInfoTip(el, byQuantity
      ? `${tip} Los costos se siguen calculando con los días de trabajo (personal, equipos, combustible, viajes); la tarifa y el resultado, ${perText(info)}.`
      : tip, { label: 'Más información: unidad de cobro' });
  }

  // Nombre de la unidad propia ("pozo", "muestra"): al salir del campo se
  // vuelven a dibujar los rótulos ("Pozos a facturar por mes").
  let unitNameField = null;
  if (info.custom) {
    unitNameField = kit.text('unitName', {
      label: '¿Cómo se llama tu unidad?',
      maxLength: 30,
      placeholder: 'Ej.: pozo, muestra, ensayo',
      hint: 'En singular: vas a cobrar "$/pozo".',
    });
    const input = unitNameField.querySelector('input');
    if (input) {
      input.addEventListener('change', () => {
        const clean = cleanUnitName(input.value);
        ctx.mutate((q) => {
          q.unitName = clean;
        });
      });
    }
  }

  const knownRateField = knownRate
    ? addInfoTip(kit.num('pricing.knownRate', {
      label: `Tu tarifa (${rateLabelOf(info)}, sin IVA)`,
      rule: 'money',
      unit: rateSuffixOf(info),
      requiredMark: true,
      hint: 'De lista, sin IVA, antes de descuentos.',
    }), kind === 'day' || kind === 'hour'
      ? `Los descuentos por días, por continuidad y comerciales se cargan en "${stepName('margin')}" y se aplican sobre esta tarifa.`
      : `Los descuentos por continuidad y comerciales se cargan en "${stepName('margin')}" y se aplican sobre esta tarifa.`)
    : null;

  const modeCard = card(
    {},
    kit.choice('pricingMode', {
      label: '¿Ya tenés una tarifa?',
      options: PRICING_MODES.map((m) => ({ value: m.id, label: MODE_LABELS[m.id] || m.label, hint: MODE_HINTS[m.id] || m.hint })),
      structural: true,
    }),
    formGrid(2, unitField(), unitNameField, knownRateField),
  );

  // Horas por día activo: dato básico si cobrás por hora (define las horas facturables).
  const hoursField = () => kit.num('activity.hoursPerActiveDay', {
    label: byQuantity ? 'Horas trabajadas por día de trabajo' : 'Horas trabajadas por día activo',
    rule: 'hoursPerDay',
    unit: 'h/día',
    hint: quote.unit === 'hour' ? 'Se facturan días activos × horas por día.' : 'Para el uso de equipos, la tarifa por hora y la estructura por hora.',
  });
  const hourly = quote.unit === 'hour';
  // Se evalúa en cada recálculo (la persona carga la cantidad sin redibujar el paso).
  const hasQuantity = () => hasNumber(quote.activity && quote.activity.billableQuantityPerMonth);

  // ---- UX-UNITS: rendimiento y cantidad del mes como unidades compuestas (sólo por cantidad).
  const composite = kind === 'quantity';
  const numerators = composite ? rateNumeratorsFor(info) : [];
  const numeratorOf = (id) => numerators.find((n) => n.id === id) || info;
  const rateIn = composite ? rateInputOf(quote.activity, info) : null;
  const basis = composite ? quantityBasisOf(quote.activity) : 'quantity';
  const workdaysValue = () => {
    const qi = quote.activity && quote.activity.quantityInput;
    return qi && typeof qi === 'object' ? positiveOrNull(Number(qi.value)) : null;
  };

  /** Marca de obligatorio (como kit.num con requiredMark). */
  const markRequired = (el) => {
    const label = el.querySelector('.field-label');
    if (label) label.appendChild(h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));
    const input = el.querySelector('input');
    if (input) input.setAttribute('aria-required', 'true');
    return el;
  };

  /** Selector chico al lado del número ("m³ ▾", "día de trabajo ▾"). */
  const miniSelect = ({ name, label, value, options, onChange }) => {
    const select = h(
      'select',
      { name, 'aria-label': label, disabled: kit.readOnly },
      ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
    );
    select.addEventListener('change', () => onChange(select.value));
    return h('div', { class: 'field-control qe-mini-select' }, select);
  };

  /** Pone el número y su unidad en la misma fila: [número] [numerador ▾] / [denominador ▾]. */
  const withUnitControls = (field, ...controls) => {
    const control = field.querySelector('.field-control');
    if (!control) return field;
    const row = h('div', { class: 'qe-compound' });
    control.replaceWith(row);
    row.append(control, h('div', { class: 'qe-compound-unit' }, ...controls.filter(Boolean)));
    return field;
  };

  /**
   * Guarda lo cargado y recalcula los datos que lee el motor: el rendimiento por
   * día de trabajo y, si la cantidad se cargó en días de trabajo, la cantidad del
   * mes. En la forma de siempre no se guarda nada nuevo (mismo dato que K0).
   */
  function writeRate(next) {
    const native = isNativeRate(next, info);
    const perDay = native ? positiveOrNull(next.value) : unitsPerActiveDayFrom(next, info);
    if (native) {
      if (quote.activity && quote.activity.rateInput) ctx.update('activity.rateInput', null);
    } else {
      ctx.update('activity.rateInput', { value: next.value, numerator: next.numerator, denominator: next.denominator, load: next.load, hours: next.hours });
    }
    ctx.update('activity.unitsPerActiveDay', native ? next.value : perDay);
    // La forma de la cantidad es la de este dibujo (se cambia sólo con changeBasis, que redibuja).
    if (basis === 'workdays') ctx.update('activity.billableQuantityPerMonth', quantityFromWorkdays(workdaysValue(), perDay));
    syncRouteTrips();
  }

  /**
   * Otro numerador o denominador: el número se carga de nuevo (20 m³ por día no
   * pasan a ser 20 viajes por día). La carga por viaje y las horas se conservan
   * si siguen valiendo; las horas arrancan con las de la cotización.
   */
  function changeRateForm(patch) {
    const next = { ...rateIn, ...patch, value: null };
    if (next.numerator === rateIn.numerator && next.denominator === rateIn.denominator) return;
    if (loadUnitOf(info, next.numerator) !== loadUnitOf(info, rateIn.numerator)) next.load = null;
    // Las horas por día no se suponen (revisión UX-UNITS, H2): con todas las horas trabajadas, una velocidad en
    // km/h daría más km de los que se recorren. Se piden, como el número.
    if (next.denominator !== 'hour') next.hours = null;
    const before = rateIn.value !== null ? ` Antes: ${num(rateIn.value)} ${rateFormText(numeratorOf(rateIn.numerator).plural, rateIn.denominator)}.` : '';
    ctx.mutate((q) => {
      if (!q.activity) q.activity = {};
      if (isNativeRate(next, info)) {
        if (q.activity.rateInput) q.activity.rateInput = null;
      } else {
        q.activity.rateInput = { value: null, numerator: next.numerator, denominator: next.denominator, load: next.load, hours: next.hours };
      }
      q.activity.unitsPerActiveDay = null;
      if (basis === 'workdays') q.activity.billableQuantityPerMonth = null;
    }, { focus: 'activity.unitsPerActiveDay' });
    ctx.toast(`Cargá el rendimiento en ${rateFormText(numeratorOf(next.numerator).plural, next.denominator)}.${before}`, 'info');
  }

  /** Rendimiento: [número] [m³ | viajes ▾] / [día de trabajo | hora ▾] (+ carga por viaje u horas, si hacen falta). */
  function rateFields() {
    const loadUnit = loadUnitOf(info, rateIn.numerator);
    const hourly = rateIn.denominator === 'hour';
    const form = rateFormText(numeratorOf(rateIn.numerator).plural, rateIn.denominator);
    let rateHint = `Lo que hacés en ${hourly ? 'una hora' : 'un día de trabajo'}. Con esto se calculan los días de trabajo.`;
    if (info.id === 'km' && hourly) rateHint = 'Velocidad promedio con paradas, no la máxima. Con esto se calculan los días de trabajo.';
    else if (tripUnit && rateIn.numerator === 'trip' && !hourly) rateHint = 'Viajes que hacés en un día de trabajo. Con esto se calculan los días de trabajo.';
    const field = markRequired(numberField({
      label: 'Rendimiento',
      name: 'activity.unitsPerActiveDay',
      rule: 'quantity',
      value: rateIn.value,
      placeholder: hourly ? (info.id === 'km' ? 'Ej.: 50' : 'Ej.: 2') : rateIn.numerator === 'trip' ? 'Ej.: 2' : 'Ej.: 500',
      hint: rateHint,
      disabled: kit.readOnly,
      onChange: (v) => {
        rateIn.value = v;
        writeRate(rateIn);
      },
    }));
    // El lector de pantalla no lee los selectores de al lado al entrar al número: la unidad va en el rótulo (GOV.UK).
    const label = field.querySelector('.field-label');
    if (label) label.insertBefore(h('span', { class: 'sr-only' }, ` (${form})`), label.querySelector('.req'));
    // El aviso del motor ("Cargá cuántos m³ hacés por día de trabajo") habla de la forma nativa: con otra, se pide en la elegida.
    if (!isNativeRate(rateIn, info)) field.dataset.issueMessage = `Cargá el rendimiento en ${form}: sin eso no se pueden calcular los días de trabajo ni los costos.`;
    withUnitControls(
      field,
      numerators.length > 1
        ? miniSelect({ name: 'activity.rateInput.numerator', label: 'Unidad del rendimiento', value: rateIn.numerator, options: numerators.map((n) => ({ value: n.id, label: n.plural })), onChange: (v) => changeRateForm({ numerator: v }) })
        : h('span', { class: 'qe-compound-fixed' }, info.plural),
      h('span', { class: 'qe-compound-sep', 'aria-hidden': 'true' }, '/'),
      miniSelect({ name: 'activity.rateInput.denominator', label: 'Rendimiento por', value: rateIn.denominator, options: [{ value: 'day', label: 'día de trabajo' }, { value: 'hour', label: 'hora' }], onChange: (v) => changeRateForm({ denominator: v }) }),
    );
    addInfoTip(field, tripUnit
      ? `Los días de trabajo son lo que consume personal, equipos y combustible; con el rendimiento también salen los viajes ${T.per}, y los km del mes salen de los viajes que facturás.`
      : 'Los días de trabajo son lo que consume personal, equipos y combustible. Podés cargarlo por día o por hora; el resultado se calcula por día de trabajo.');
    const loadField = loadUnit
      ? markRequired(numberField({
        label: 'Carga por viaje',
        name: 'activity.rateInput.load',
        rule: 'quantity',
        unit: `${numeratorOf(loadUnit).short}/viaje`,
        value: rateIn.load,
        placeholder: 'Ej.: 20',
        hint: info.id === 'trip' ? `Para pasar ${numeratorOf(loadUnit).plural} a viajes.` : `Para pasar viajes a ${info.plural}.`,
        disabled: kit.readOnly,
        onChange: (v) => {
          rateIn.load = v;
          writeRate(rateIn);
        },
      }))
      : null;
    const hoursInput = rateIn.denominator === 'hour'
      ? markRequired(numberField({
        label: info.id === 'km' ? 'Horas de marcha por día' : 'Horas productivas por día',
        name: 'activity.rateInput.hours',
        rule: 'hoursPerDay',
        unit: 'h/día',
        value: rateIn.hours,
        placeholder: 'Ej.: 6',
        hint: info.id === 'km' ? 'Sólo las horas manejando: sin carga, espera ni descarga.' : 'Las horas del día de trabajo en que rendís eso.',
        disabled: kit.readOnly,
        onChange: (v) => {
          rateIn.hours = v;
          writeRate(rateIn);
        },
      }))
      : null;
    if (hoursInput && info.id === 'km') addInfoTip(hoursInput, 'La velocidad (km/h) no se factura: se facturan los km recorridos. Con las horas de marcha se pasa a km por día de trabajo.');
    // La equivalencia en la unidad del motor, a la vista: "= 20 m³ por día de trabajo".
    const equivalence = kit.out(() => {
      const current = rateInputOf(quote.activity, info);
      if (isNativeRate(current, info)) return '';
      const perDay = unitsPerActiveDayFrom(current, info);
      if (perDay !== null) {
        // km por hora con TODAS las horas trabajadas: casi nunca se maneja el día entero (H2).
        const allDay = info.id === 'km' && current.denominator === 'hour' && current.hours !== null && Math.abs(current.hours - Number(quote.activity && quote.activity.hoursPerActiveDay)) < 1e-9;
        return `= ${num(perDay)} ${rateFormText(info.plural, 'day')}${allDay ? '. Ojo: son todas las horas del día de trabajo; si hay carga, espera o descarga, las horas de marcha son menos.' : ''}`;
      }
      if (current.value === null) return '';
      if (loadUnit && current.load === null) return 'Falta la carga por viaje para pasarlo a la unidad de cobro.';
      return 'Faltan las horas por día para pasarlo a días de trabajo.';
    }, { tag: 'p', className: 'qe-note qe-rate-equiv', allowEmpty: true });
    return [field, equivalence, loadField || hoursInput ? formGrid(2, loadField, hoursInput) : null];
  }

  /** Cantidad del mes: [número] [m³ por mes | días de trabajo por mes ▾]. */
  function quantityField() {
    const workdays = basis === 'workdays';
    const field = markRequired(numberField({
      label: workdays ? 'Días de trabajo por mes' : `${Plural} a facturar por mes`,
      name: 'activity.billableQuantityPerMonth',
      rule: workdays ? 'days' : 'quantity',
      value: workdays ? workdaysValue() : quote.activity && quote.activity.billableQuantityPerMonth,
      placeholder: workdays ? 'Ej.: 10' : 'Ej.: 10.000',
      hint: workdays ? `La cantidad del mes es días de trabajo × rendimiento (en ${info.plural}).` : 'Una estimación alcanza: en el Resultado ves otras cantidades.',
      disabled: kit.readOnly,
      onChange: (v) => {
        if (workdays) {
          ctx.update('activity.quantityInput', { basis: 'workdays', value: v });
          ctx.update('activity.billableQuantityPerMonth', quantityFromWorkdays(v, quote.activity && quote.activity.unitsPerActiveDay));
        } else {
          ctx.update('activity.billableQuantityPerMonth', v);
        }
      },
    }));
    return withUnitControls(field, miniSelect({
      name: 'activity.quantityInput.basis',
      label: 'Cargás la cantidad en',
      value: basis,
      options: [{ value: 'quantity', label: `${info.plural} por mes` }, { value: 'workdays', label: 'días de trabajo por mes' }],
      onChange: (v) => changeBasis(v),
    }));
  }

  /**
   * Cambia cómo se carga la cantidad del mes. Se pasa con el rendimiento que
   * cargó la persona (200 m³ ÷ 20 m³ por día = 10 días); sin rendimiento, queda
   * sin cargar. La cantidad que lee el motor no cambia hasta que se edite.
   */
  function changeBasis(next) {
    if (next === basis) return;
    const perDay = quote.activity && quote.activity.unitsPerActiveDay;
    ctx.mutate((q) => {
      if (!q.activity) q.activity = {};
      if (next === 'workdays') q.activity.quantityInput = { basis: 'workdays', value: workdaysFromQuantity(q.activity.billableQuantityPerMonth, perDay) };
      else if (q.activity.quantityInput) q.activity.quantityInput = null;
    }, { focus: 'activity.billableQuantityPerMonth' });
  }

  /** Actividad por cantidad (m³, viajes…) o por evento (llamados, trabajos, hitos). */
  function quantityFields() {
    if (kind === 'event') {
      const isCall = info.id === 'call';
      const isMilestone = info.id === 'milestone';
      return formGrid(
        isMilestone ? 3 : 2,
        kit.num('activity.billableQuantityPerMonth', {
          label: `${Plural} por mes`,
          rule: 'quantity',
          unit: texts.perMonth,
          requiredMark: true,
          placeholder: isCall ? 'Ej.: 6' : 'Ej.: 1',
          hint: isCall
            ? 'Llamados que esperás facturar en el mes. Si no estás seguro, cargá una estimación.'
            : isMilestone
              ? 'Hitos que esperás facturar en el mes.'
              : 'Trabajos que esperás terminar y facturar en el mes (0,5 = uno cada dos meses).',
        }),
        kit.num('activity.daysPerActivation', {
          label: `¿Cuántos días de trabajo lleva ${T.each}?`,
          rule: 'positiveDays',
          unit: 'días',
          requiredMark: true,
          hint: 'Con esto se calculan los días de trabajo del mes.',
        }),
        isMilestone
          ? kit.num('activity.unitsPerActivation', {
            label: 'Hitos por trabajo',
            rule: 'positive',
            unit: 'hitos',
            placeholder: 'Ej.: 3',
            hint: 'En cuántas partes facturás cada trabajo (por ejemplo: anticipo, avance y entrega).',
          })
          : null,
      );
    }
    // Cada campo compuesto en su fila: "[200] [m³ por mes ▾]" y "[20] [m³ ▾] / [día de trabajo ▾]" no se parten.
    const [rate, equivalence, extra] = rateFields();
    return h('div', { class: 'qe-quantity-fields' }, quantityField(), rate, equivalence, extra);
  }

  /** "200 m³ × $ 45.000 por m³ = $ 9.000.000 por mes" (la cantidad × la tarifa, con los números del motor). */
  const revenueLine = (r) => {
    const rev = r.estimate && r.estimate.revenue;
    if (!rev || !isFiniteNumber(r.kpis.commercialListRate) || !(rev.billableUnits > 0)) return '';
    const net = Math.abs((rev.discountFactor ?? 1) - 1) > 1e-9;
    return `${unitsLabel(r, rev.billableUnits)} × ${formatMoney(rev.netRate, { decimals: rev.netRate < 100 ? 2 : 0 })} ${perText(info)}${net ? ' (neta)' : ''} = ${formatMoney(rev.components.base)} por mes.`;
  };

  /** La explicación de la línea clave en renglones: actividad, facturación y uso de los días. */
  const lines = (...items) => h('span', { class: 'qe-keyline-lines' }, ...items.filter(Boolean).map((t) => h('span', { class: 'qe-keyline-line' }, t)));

  /** Salidas fraccionarias: el costo por salida (movilización…) es un PROMEDIO. */
  const fractionalText = (r) => {
    const acts = r.activity.activationsPerMonth;
    if (!(acts > 0) || Math.abs(acts - Math.round(acts)) <= 1e-6) return '';
    return r.activationRounding && r.activationRounding.enabled
      ? ` Son ${num(acts)} ${T.many} promedio por mes; los costos ${T.per} se cuentan con ${T.many} ${T.wholeMany} (abajo).`
      : ` Son ${num(acts)} ${T.many} promedio por mes: la movilización y los costos ${T.per} se calculan como promedio (abajo podés contar ${T.each} ${T.whole}).`;
  };

  const daysKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => (hasNumber(quote.activity && quote.activity.activeDaysPerMonth) ? `${num(r.activity.activationsPerMonth)} ${T.word(r.activity.activationsPerMonth)} por mes` : EMPTY),
    hint: (r) => {
      if (!hasNumber(quote.activity && quote.activity.activeDaysPerMonth)) return `Cargá los días por mes para ver cuántos ${T.many} y días facturás.`;
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      const hoursPerDay = r.activity.hoursPerActiveDay;
      const chain = r.unit === 'hour' && isFiniteNumber(hoursPerDay)
        ? `${formatDays(r.activity.activeDaysPerMonth, { decimals: 2 })} × ${num(hoursPerDay)} h por día = ${billable} por mes${extra}.`
        : `Facturás ${billable} por mes${extra}.`;
      return lines(chain, r.unit === 'month' ? null : revenueLine(r), `Utilización: ${formatPercent(r.activity.utilizationPct)} de los días disponibles.${fractionalText(r)}`);
    },
  });

  const quantityKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => {
      if (!hasQuantity() || !(r.activity.activeDaysPerMonth > 0)) return EMPTY;
      // Lo que no cargó la persona es lo que se calcula: días de trabajo o cantidad del mes.
      return basis === 'workdays' ? `${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes` : `${workDaysText(r.activity.activeDaysPerMonth)} por mes`;
    },
    hint: (r) => {
      if (!hasQuantity()) {
        return basis === 'workdays' ? 'Cargá los días de trabajo y el rendimiento para ver la cantidad del mes.' : `Cargá ${texts.los} ${info.plural} por mes para ver cuántos días de trabajo lleva.`;
      }
      if (!(r.activity.activeDaysPerMonth > 0)) {
        return kind === 'quantity' ? `Cargá ${texts.cuantos} ${info.plural} hacés por día de trabajo para calcular los días de trabajo.` : 'Cargá cuántos días de trabajo lleva cada uno.';
      }
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      const over = r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9
        ? ` Ojo: son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} disponibles del mes.`
        : '';
      const perDay = r.activity.unitsPerActiveDay;
      // La cadena en el sentido en que se cargó: cantidad ÷ rendimiento = días, o rendimiento × días = cantidad.
      let chain;
      if (kind === 'quantity' && isFiniteNumber(perDay) && perDay > 0) {
        const rateText = `${quantityText(perDay, r)} por día`;
        chain = basis === 'workdays'
          ? `${rateText} × ${workDaysText(r.activity.activeDaysPerMonth)} = ${billable} por mes${extra}.`
          : `${billable} ÷ ${rateText} = ${workDaysText(r.activity.activeDaysPerMonth)}${extra}.`;
      } else {
        chain = `Facturás ${billable} por mes${extra} en ${workDaysText(r.activity.activeDaysPerMonth)}.`;
      }
      // Por intervención (PLAN-2026-010): volumen ↔ días ↔ movilización.
      const acts = r.activity.activationsPerMonth;
      const perIntervention = kind === 'quantity' && acts > 0
        ? ` ${quantityText(r.estimate.revenue.billableUnits / acts, r)} ${T.per} · ${num(acts)} ${T.word(acts)} por mes.`
        : '';
      return lines(chain, revenueLine(r), `Utilización: ${formatPercent(r.activity.utilizationPct)} de los días disponibles.${perIntervention}${fractionalText(r)}${over}`);
    },
    tone: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
  });

  const activityCard = card(
    {},
    byQuantity
      ? quantityFields()
      : formGrid(
        hourly ? 3 : 2,
        kit.num('activity.activeDaysPerMonth', {
          label: 'Días trabajados y facturados por mes',
          rule: 'days',
          unit: 'días/mes',
          requiredMark: true,
          placeholder: 'Ej.: 8',
          hint: 'Una estimación alcanza: en el Resultado ves otras cantidades de días.',
        }),
        kit.num('activity.daysPerActivation', {
          label: daysPerActivationLabel(T, quote.serviceType),
          rule: 'positiveDays',
          unit: 'días',
          hint: `Sirve para saber cuántos ${T.many} hay por mes.`,
        }),
        hourly ? hoursField() : null,
      ),
    byQuantity ? quantityKeyline : daysKeyline,
    // PLAN-2026-012: viajes facturables, físicos, días de trabajo y km (unidad "viaje").
    tripUnit ? kit.group('Viajes y km del mes', transportStats(kit)) : null,
    // Cobro por km (PLAN-2026-014, LAB-D4): km facturables y km de ruta, por separado.
    info.id === 'km' ? kit.group('Viajes y km del mes', transportStats(kit, { billable: false, km: true })) : null,
    // PLAN-2026-011: cada salida completa (apagado por defecto). Sólo los costos
    // físicamente indivisibles por salida; producción y facturación no cambian.
    h('div', { class: 'qe-full-activations' },
      addInfoTip(kit.check('activity.fullActivations', {
        label: `${T.Each} se cuenta ${T.whole}`,
        hint: `Para costos que no se dividen: movilización, peajes, viáticos.`,
      }), `Apagada, ${T.theMany} ${T.many} por mes son un promedio (por ejemplo 10,42) y los costos ${T.per} se cuentan en proporción. Encendida, esos costos —movilización, peajes, viáticos, cargos del proveedor ${T.per} y mínimos ${T.per}— se costean con ${T.many} ${T.wholeMany} (11). Sueldos, tenencia de equipos, producción, facturación y estructura mensual no cambian.`),
      kit.out((r) => {
        const info = activationRoundingText(r.activationRounding, T);
        if (!info) return '';
        return h('p', { class: ['qe-note', info.tone === 'warning' ? 'is-warning' : null] }, info.text);
      }, { tag: 'div', allowEmpty: true })),
    kit.advanced(
      {
        key: 'modality',
        summary: () => {
          const a = quote.activity || {};
          const parts = [
            isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días disponibles por mes` : 'días disponibles sin cargar',
            hourly ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día activo` : 'horas por día sin cargar',
            kind === 'quantity' && hasNumber(a.daysPerActivation) ? `${formatDays(Number(a.daysPerActivation))} ${T.per}` : null,
            isOnCall ? `disponibilidad ${a.availability === 'window' ? 'por franja horaria' : '24/7'}` : null,
            isOnCall && isFiniteNumber(Number(a.responseTimeHours)) && a.responseTimeHours !== null && a.responseTimeHours !== '' ? `respuesta en ${formatNumber(Number(a.responseTimeHours), { decimals: 1 })} h` : null,
          ].filter(Boolean);
          return parts.join(' · ');
        },
      },
      formGrid(
        2,
        kit.num('activity.availableDaysPerMonth', {
          label: 'Días disponibles en el mes',
          rule: 'daysInMonth',
          unit: 'días',
          placeholder: '30',
          hint: 'Normalmente 30 para servicios 24/7; 22 si sólo trabajás días hábiles.',
        }),
        hourly ? null : hoursField(),
        // Por cantidad: los días por llamado o salida cuentan las movilizaciones y el mínimo por llamado.
        kind === 'quantity'
          ? addInfoTip(kit.num('activity.daysPerActivation', {
            label: `Duración promedio de ${T.each}`,
            rule: 'positiveDays',
            unit: 'días',
            hint: `Dato OPERATIVO: cuántos días de trabajo seguidos dura ${T.each}.`,
            onValue: () => syncRouteTrips(),
          }), tripUnit
            ? `Viajes ${T.per} = viajes por día × estos días. Si es 1, cada día de trabajo es ${T.a} ${T.one}.`
            : `No es la unidad que cobrás: cuenta las movilizaciones y el mínimo ${T.per}. Ej.: 20 días de trabajo ÷ 2 días ${T.per} = 10 ${T.many} por mes. Si es 1, cada día de trabajo es ${T.a} ${T.one}.`)
          : null,
      ),
      isOnCall
        ? kit.group(
          'Disponibilidad on-call',
          kit.choice('activity.availability', {
            label: 'Disponibilidad requerida',
            options: AVAILABILITY_OPTIONS.map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
            structural: true,
          }),
          formGrid(
            2,
            quote.activity && quote.activity.availability === 'window'
              ? kit.text('activity.availabilityWindow', { label: 'Franja horaria', maxLength: 120, placeholder: 'Ej.: lunes a sábado de 7 a 19 h' })
              : null,
            kit.num('activity.responseTimeHours', {
              label: 'Tiempo máximo de respuesta',
              rule: 'hours',
              unit: 'h',
              hint: 'Desde el llamado hasta estar operativo en locación.',
            }),
          ),
        )
        : null,
      kit.stats(
        kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: byQuantity ? 'Días de trabajo ÷ días disponibles.' : 'Días activos ÷ días disponibles.' }),
        byQuantity
          ? kit.stat('Días de trabajo por mes', (r) => (r.activity.activeDaysPerMonth > 0 ? formatDays(r.activity.activeDaysPerMonth, { decimals: 2 }) : EMPTY), {
            hint: kind === 'quantity' ? `${Plural} por mes ÷ ${info.plural} por día de trabajo.` : `${Plural} por mes × días de trabajo de cada uno.`,
          })
          : null,
        kit.stat(`${T.Many} por mes`, (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: byQuantity ? `Días de trabajo ÷ duración de ${T.each}. Es un promedio (puede tener decimales).` : `Días activos ÷ días ${T.per}. Es un promedio (puede tener decimales).` }),
        kit.stat(byQuantity ? `${Plural} facturables por mes` : 'Unidades facturables por mes', (r) => unitsLabel(r, r.estimate.revenue.billableUnits), {
          hint: (r) => (r.estimate.revenue.minimumCallApplied ? `Incluye el mínimo ${T.per}.` : `En la unidad elegida (${info.label}).`),
        }),
      ),
    ),
  );

  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const breakEvenStat = byQuantity
    ? kit.stat(`${texts.breakEvenLabel} (break-even)`, (r) => {
      const be = r.breakEven || {};
      if (be.notApplicable) return 'No aplica';
      if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
      return quantityCeilText(be.quantity, r);
    }, {
      hint: (r) => (r.breakEven && (r.breakEven.reason || (r.breakEven.reachable ? `${workDaysText(r.breakEven.days)} por mes, a ${formatMoney(r.kpis.commercialListRate)} / ${r.unitLabel}` : ''))) || '',
      trace: (r) => r.traces.breakEven,
      tone: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !isFiniteNumber(r.kpis.commercialListRate)) return 'gray';
        return !be.reachable || be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
      },
    })
    : kit.stat('Días mínimos para no perder (break-even)', (r) => {
      const be = r.breakEven || {};
      if (be.notApplicable) return 'No aplica';
      if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
      // 1 decimal en la superficie (6,4 días); los 2 decimales, en "Ver cálculo".
      return formatDays(be.days, { decimals: 1 });
    }, {
      hint: (r) => (r.breakEven && (r.breakEven.reason || (r.breakEven.reachable ? `${formatNumber(r.breakEven.wholeDays)} días enteros, a ${formatMoney(r.kpis.commercialListRate)} / ${r.unitLabel}` : ''))) || '',
      trace: (r) => r.traces.breakEven,
      tone: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !isFiniteNumber(r.kpis.commercialListRate)) return 'gray';
        return !be.reachable || be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
      },
    });
  const calcCard = knownRate
    ? card(
      { title: 'Con tu tarifa', subtitle: 'Lo que calcula RATEOS cuando ya tenés la tarifa.' },
      kit.stats(
        breakEvenStat,
        kit.stat('Resultado esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatMoney(r.kpis.profit) : EMPTY), {
          trace: (r) => r.traces.expectedResult,
          tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        }),
        kit.stat('Margen esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatPercent(r.kpis.marginPct) : EMPTY), {
          hint: (r) => `Objetivo ${formatPercent(r.kpis.targetMarginPct)}`,
          tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        }),
      ),
    )
    : kit.advanced(
      {
        key: 'modality-ladder',
        title: 'Ver tarifas según el margen',
        variant: 'detail',
        boxed: true,
        summary: (r) => {
          const floor = floorDisplay(r);
          return isFiniteNumber(floor.value)
            ? `Tarifa piso ${perUnitCeil(floor.value, r)} y las tarifas para ganar ${ladder.map((m) => formatPercent(m)).join(', ')} sobre el precio.`
            : byQuantity ? `Cargá ${texts.los} ${info.plural} por mes para ver las tarifas.` : 'Cargá los días por mes para ver las tarifas.';
        },
      },
      h('p', { class: 'qe-note' }, 'Son tarifas DE LISTA (antes de descuentos), redondeadas hacia arriba: las que escribís en la cotización.'),
      kit.stats(
        kit.stat(
          (r) => (floorDisplay(r).base === 'net' ? 'Tarifa piso neta (margen 0 %)' : 'Tarifa piso de lista (margen 0 %)'),
          (r) => perUnitCeil(floorDisplay(r).value, r),
          {
            trace: floorRateTrace,
            hint: (r) => {
              const net = floorDisplay(r).base === 'list' ? netRateHint(r.kpis.floorNetRate, r) : '';
              return `Sólo cubre los costos.${net ? ` ${net}` : ''}`;
            },
          },
        ),
        ...ladder.map((m) => kit.stat(`Tarifa de lista con margen ${formatPercent(m)}`, (r) => {
          const row = rateRowFor(r, m);
          return perUnitCeil(row ? row.listRate : null, r);
        }, {
          hint: (r) => {
            const row = rateRowFor(r, m);
            const net = row ? netRateHint(row.netRate, r) : '';
            return `Margen sobre el precio de venta.${net ? ` ${net}` : ''}`;
          },
        })),
      ),
    );

  const question = byQuantity
    ? kit.question(texts.quantityQuestion, `Cuanto menos factures, más alta tiene que ser la tarifa ${perText(info)} para cubrir los costos fijos.`)
    : kit.question('¿Cuántos días por mes esperás trabajar?', 'Cuantos menos días trabajes, más alta tiene que ser la tarifa para cubrir los costos fijos.', { term: 'utilización (días trabajados ÷ días disponibles)' });

  mount(
    container,
    modeCard,
    question,
    activityCard,
    calcCard,
  );
  return { update() {} };
}
