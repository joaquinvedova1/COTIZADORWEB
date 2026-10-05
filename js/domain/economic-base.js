/**
 * Base económica de un valor (PLAN-2026-005).
 *
 * Todo valor económico (sueldo, valor de reposición, precio del combustible,
 * costo de un material, tarifa de un proveedor, tipo de cambio) dice:
 *
 *   base = { period: 'AAAA-MM' | null, currency, source, note }
 *
 *   period   período base (mes): "Base: sep-26". null = "Base no definida"
 *            (nunca se inventa: un dato viejo sin fecha queda sin definir).
 *   currency moneda del valor (ARS, USD, EUR). Los costos de personal, de
 *            tenencia y operación y el combustible van en la moneda de la
 *            empresa; valor de un equipo, materiales y tarifas externas pueden
 *            estar en otra moneda (la cotización los convierte con SU tipo de
 *            cambio explícito).
 *   source   de dónde sale (catálogo BASE_SOURCES) o null.
 *   note     referencia opcional (texto corto).
 *
 * Funciones puras: sin fecha actual (el "hoy" lo pasa quien llama).
 */

import { isPlainObject } from '../core/object.js';
import { formatPeriod } from '../core/format.js';
import { BASE_SOURCES, CURRENCIES } from './catalogs.js';

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CURRENCY_IDS = CURRENCIES.map((c) => c.id);
const SOURCE_IDS = BASE_SOURCES.map((s) => s.id);
export const MAX_BASE_NOTE = 160;

/** ¿Es un período "AAAA-MM" válido? */
export function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_RE.test(period);
}

/** ¿Es una fecha "AAAA-MM-DD" válida (sin hora)? */
export function isValidDayDate(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

/** ¿Moneda conocida? */
export function isKnownCurrency(currency) {
  return CURRENCY_IDS.includes(currency);
}

/**
 * Período de una fecha ISO ("2026-10-05T12:00:00.000Z" o "2026-10-05") sin
 * pasar por zonas horarias: se toma el texto. null si no es una fecha.
 */
export function periodFromDate(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(0[1-9]|1[0-2])/.exec(value);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Día "AAAA-MM-DD" de una fecha ISO (texto), o null. */
export function dayFromDate(value) {
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  return isValidDayDate(day) ? day : null;
}

/** Número de mes absoluto (año × 12 + mes) de un período, o null. */
export function periodIndex(period) {
  const m = typeof period === 'string' ? PERIOD_RE.exec(period) : null;
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
}

/** Meses entre dos períodos (b − a). null si alguno no es válido. */
export function monthsBetween(a, b) {
  const ia = periodIndex(a);
  const ib = periodIndex(b);
  return ia === null || ib === null ? null : ib - ia;
}

/** Base vacía ("Base no definida"), opcionalmente con una moneda. */
export function emptyBase({ currency = null } = {}) {
  return { period: null, currency: isKnownCurrency(currency) ? currency : null, source: null, note: '' };
}

/**
 * Base saneada: período válido o null, moneda conocida (o la por defecto),
 * fuente del catálogo o null, nota corta. Nunca inventa un período.
 */
export function normalizeBase(base, { currency = null } = {}) {
  const b = isPlainObject(base) ? base : {};
  const fallbackCurrency = isKnownCurrency(currency) ? currency : null;
  return {
    period: isValidPeriod(b.period) ? b.period : null,
    currency: isKnownCurrency(b.currency) ? b.currency : fallbackCurrency,
    source: SOURCE_IDS.includes(b.source) ? b.source : null,
    note: typeof b.note === 'string' ? b.note.trim().slice(0, MAX_BASE_NOTE) : '',
  };
}

/** ¿La base tiene período definido? */
export function baseDefined(base) {
  return isPlainObject(base) && isValidPeriod(base.period);
}

/** "Base: sep-26" | "Base no definida". */
export function baseLabel(base, { prefix = 'Base' } = {}) {
  return baseDefined(base) ? `${prefix}: ${formatPeriod(base.period)}` : `${prefix} no definida`;
}

/** Copia de una base (para snapshots). */
export function copyBase(base, options = {}) {
  return normalizeBase(base, options);
}

/** ¿Dos bases son iguales (período, moneda, fuente y nota)? */
export function sameBase(a, b) {
  const x = normalizeBase(a);
  const y = normalizeBase(b);
  return x.period === y.period && x.currency === y.currency && x.source === y.source && x.note === y.note;
}
