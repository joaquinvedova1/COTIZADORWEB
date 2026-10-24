/**
 * Unidades compuestas de la actividad (UX-UNITS): cómo se CARGAN el
 * rendimiento y la cantidad del mes, y qué conversiones son seguras al
 * cambiar la unidad de cobro.
 *
 * El motor no cambia: sigue leyendo
 *   activity.unitsPerActiveDay        unidad de cobro por día de trabajo
 *   activity.billableQuantityPerMonth unidad de cobro por mes
 * y la interfaz los recalcula desde lo que cargó la persona:
 *   activity.rateInput     = { value, numerator, denominator, load, hours }
 *                            ("2 m³ por hora × 10 h por día", "80 m³ por día ÷ 20 m³ por viaje")
 *   activity.quantityInput = { basis: 'workdays', value }  ("10 días de trabajo por mes")
 * Ambos son opcionales: sin ellos se carga como siempre (forma nativa).
 *
 * Sólo factores EXACTOS (1 t = 1.000 kg, 1 km = 1.000 m) o un dato que carga
 * la persona (carga por viaje, horas por día): nunca se reinterpreta un número
 * en otra unidad. Sin cálculo económico.
 */

import { BILLING_UNITS } from './billing-units.js';
import { isFiniteNumber } from '../core/money.js';

/** Denominadores del rendimiento: por día de trabajo (forma nativa) o por hora (× horas por día). */
export const RATE_DENOMINATORS = Object.freeze(['day', 'hour']);

/**
 * Numeradores válidos del rendimiento según la unidad de cobro (la primera es
 * la propia). `exact`: cuántas unidades de cobro es una unidad del numerador.
 * `load`: hace falta la carga por viaje (en m³ o en t) que carga la persona.
 */
const NUMERATORS = Object.freeze({
  trip: [{ id: 'trip' }, { id: 'm3', load: 'm3' }, { id: 'ton', load: 'ton' }],
  m3: [{ id: 'm3' }, { id: 'trip', load: 'm3' }],
  ton: [{ id: 'ton' }, { id: 'kg', exact: 1 / 1000 }, { id: 'trip', load: 'ton' }],
  kg: [{ id: 'kg' }, { id: 'ton', exact: 1000 }],
  meter: [{ id: 'meter' }, { id: 'km', exact: 1000 }],
  km: [{ id: 'km' }, { id: 'meter', exact: 1 / 1000 }],
});

/** Cambios de unidad de cobro con un factor exacto: cantidad nueva = cantidad × factor. */
const EXACT_QUANTITY_FACTORS = Object.freeze({
  'kg>ton': 1 / 1000,
  'ton>kg': 1000,
  'meter>km': 1 / 1000,
  'km>meter': 1000,
});

/** Sin ruido de punto flotante (0,1 + 0,2): 12 cifras significativas. */
function clean(x) {
  return isFiniteNumber(x) ? Number(x.toPrecision(12)) : null;
}

function positive(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isFiniteNumber(n) && n > 0 ? n : null;
}

function unitDef(id) {
  return BILLING_UNITS.find((u) => u.id === id) || null;
}

/**
 * Numeradores que se pueden elegir para el rendimiento con esta unidad de
 * cobro: [{ id, singular, plural, short, exact?, load? }]. Las unidades sin
 * pares (m², lote, turno, ton-km, una propia…) sólo se ofrecen a sí mismas.
 * @param {{ id: string, singular: string, plural: string, short: string }} info billingUnitOf(quote)
 */
export function rateNumeratorsFor(info) {
  const list = NUMERATORS[info && info.id] || [{ id: info ? info.id : 'unit' }];
  return list.map((n) => {
    const def = n.id === (info && info.id) ? info : unitDef(n.id);
    return { ...n, singular: def.singular, plural: def.plural, short: def.short };
  });
}

/** Unidad de la carga por viaje que necesita el par (m³ o t), o null si no hace falta. */
export function loadUnitOf(info, numerator) {
  const n = rateNumeratorsFor(info).find((x) => x.id === numerator);
  return n && n.load ? n.load : null;
}

/** ¿Se puede elegir otro numerador o denominador? (si no, el rendimiento se carga en la forma de siempre). */
export function hasRatePairs(info) {
  return Boolean(info) && info.kind === 'quantity';
}

/** ¿Dos números son el mismo dato? (tolerancia relativa de punto flotante). */
function same(a, b) {
  return isFiniteNumber(a) && isFiniteNumber(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

/**
 * Lo que cargó la persona, normalizado para esta unidad de cobro. Sin
 * rateInput, con uno de otra unidad o con uno que ya no da el dato del motor
 * (p. ej. el rendimiento se editó en una versión anterior, que no conoce la
 * forma), la forma nativa: el número del motor por día de trabajo.
 */
export function rateInputOf(activity, info) {
  const a = activity && typeof activity === 'object' ? activity : {};
  const r = a.rateInput && typeof a.rateInput === 'object' ? a.rateInput : null;
  const native = { value: positive(a.unitsPerActiveDay), numerator: info.id, denominator: 'day', load: null, hours: null };
  const numerators = rateNumeratorsFor(info).map((n) => n.id);
  if (!r || !numerators.includes(r.numerator) || !RATE_DENOMINATORS.includes(r.denominator)) return native;
  const input = {
    value: positive(r.value),
    numerator: r.numerator,
    denominator: r.denominator,
    load: positive(r.load),
    hours: positive(r.hours),
  };
  const perDay = unitsPerActiveDayFrom(input, info);
  const stored = positive(a.unitsPerActiveDay);
  // Coincide con el dato del motor, o los dos están sin cargar (se eligió la forma y falta el número o un factor).
  return (perDay === null && stored === null) || same(perDay, stored) ? input : native;
}

/** ¿Es la forma de siempre (unidad de cobro por día de trabajo)? Entonces no se guarda rateInput. */
export function isNativeRate(input, info) {
  return Boolean(input) && input.numerator === info.id && input.denominator === 'day';
}

/**
 * Rendimiento en la unidad del motor (unidad de cobro por día de trabajo), o
 * null si falta un dato (número, carga por viaje u horas por día): entonces
 * el campo queda sin cargar y se pide de nuevo; nunca se adivina.
 */
export function unitsPerActiveDayFrom(input, info) {
  if (!input) return null;
  const value = positive(input.value);
  if (value === null) return null;
  const n = rateNumeratorsFor(info).find((x) => x.id === input.numerator);
  if (!n || !RATE_DENOMINATORS.includes(input.denominator)) return null;
  let factor = 1;
  if (n.exact) factor = n.exact;
  else if (n.load) {
    const load = positive(input.load);
    if (load === null) return null;
    // Se cobra por viaje: viajes = m³ ÷ m³ por viaje. Se cobra por m³ o t: m³ = viajes × m³ por viaje.
    factor = input.numerator === 'trip' ? load : 1 / load;
  }
  let perDay = value * factor;
  if (input.denominator === 'hour') {
    const hours = positive(input.hours);
    if (hours === null || hours > 24) return null;
    perDay *= hours;
  }
  return clean(perDay);
}

/** Cantidad del mes desde los días de trabajo: días × rendimiento por día (null si falta alguno). */
export function quantityFromWorkdays(days, unitsPerActiveDay) {
  const d = positive(days);
  const rate = positive(unitsPerActiveDay);
  return d === null || rate === null ? null : clean(d * rate);
}

/** Días de trabajo desde la cantidad del mes: cantidad ÷ rendimiento (para pasar de una forma a la otra). */
export function workdaysFromQuantity(quantity, unitsPerActiveDay) {
  const q = positive(quantity);
  const rate = positive(unitsPerActiveDay);
  return q === null || rate === null ? null : clean(q / rate);
}

/**
 * ¿La cantidad del mes se cargó como días de trabajo? Sólo si los días todavía
 * dan la cantidad del motor (días × rendimiento), o los dos están sin cargar;
 * si no (se editó en una versión anterior), se muestra en la unidad de cobro.
 */
export function quantityBasisOf(activity) {
  const a = activity && typeof activity === 'object' ? activity : {};
  const qi = a.quantityInput;
  if (!qi || typeof qi !== 'object' || qi.basis !== 'workdays') return 'quantity';
  const expected = quantityFromWorkdays(qi.value, a.unitsPerActiveDay);
  const stored = positive(a.billableQuantityPerMonth);
  return (expected === null && stored === null) || same(expected, stored) ? 'workdays' : 'quantity';
}

/**
 * Factor EXACTO para pasar una cantidad de una unidad de cobro a otra
 * (kg ↔ t, metro ↔ km), 1 si es la misma, o null si no hay conversión segura.
 * La tarifa por unidad se convierte con el inverso.
 */
export function quantityFactorBetween(fromId, toId) {
  if (fromId === toId) return 1;
  const f = EXACT_QUANTITY_FACTORS[`${fromId}>${toId}`];
  return isFiniteNumber(f) ? f : null;
}

/** Convierte un número con un factor exacto, sin ruido de punto flotante. */
export function convertExact(value, factor) {
  return isFiniteNumber(value) && isFiniteNumber(factor) ? clean(value * factor) : null;
}
