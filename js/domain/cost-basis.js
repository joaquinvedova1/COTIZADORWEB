/**
 * Base de costo de los recursos propios de una cotización (2026-11-18, pedido del dueño).
 *
 *   'time'   Por tiempo usado: el personal y los equipos propios cuestan las HORAS que les lleva
 *            el trabajo × el valor de su hora. No hay "% de su costo fijo": el recurso está
 *            asignado al trabajo sólo las horas del trabajo.
 *              valor de la hora = costo del mes ÷ horas facturables por mes
 *            (`billableHoursPerMonth` del recurso: las horas que de verdad se venden en un mes;
 *            vacío = las horas normales del mes).
 *   (sin dato) El método de siempre: el mes del recurso × % asignado (100 % si no se comparte).
 *
 * Sólo las cotizaciones NUEVAS nacen con 'time' (`quote.costBasis`); las guardadas no tienen el
 * dato y calculan como siempre. Cobrando POR MES el recurso queda asignado al servicio: rige el
 * método de siempre aunque la cotización sea nueva (mes completo o la parte asignada).
 *
 * Sólo reglas de dominio: nada de cálculo económico.
 */

import { isPlainObject } from '../core/object.js';
import { billingUnitOf } from './billing-units.js';

export const COST_BASIS_TIME = 'time';

/** ¿La cotización costea sus recursos propios por tiempo usado? */
export function usesTimeBasis(quote) {
  if (!isPlainObject(quote) || quote.costBasis !== COST_BASIS_TIME) return false;
  return billingUnitOf(quote).kind !== 'month';
}

/** Horas facturables por mes de un recurso: las cargadas o, si no hay, `fallback` (las normales). */
export function billableHoursOf(line, fallback = 0) {
  const raw = isPlainObject(line) ? Number(line.billableHoursPerMonth) : NaN;
  if (Number.isFinite(raw) && raw > 0) return raw;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : 0;
}

/**
 * Unidades de cobro "contables" (0.19.0): cada una es una pieza de trabajo a la que se le pueden
 * estimar horas de un recurso ("horas de grúa por válvula"). Las de medida (km, m³, kg, HH…)
 * siguen pidiendo las horas por día.
 */
const COUNTABLE_UNITS = ['unit', 'piece', 'well', 'test', 'lot', 'set', 'stage', 'connection', 'joint', 'point', 'trip', 'container'];

/**
 * En qué se piden las horas de cada recurso propio (0.19.0, pedido del dueño: en la unidad de cobro).
 *   'unit'  por unidad cobrada (válvula, pozo, viaje…)   'job'  en cada trabajo o llamado
 *   'day'   por día de trabajo (cobro por día, por hora o por una unidad de medida)
 *   null    la cotización no costea por tiempo usado (cobro por mes o método anterior)
 */
export function resourceHoursBasis(quote) {
  if (!usesTimeBasis(quote)) return null;
  const u = billingUnitOf(quote);
  if (u.kind === 'event') return u.id === 'job' || u.id === 'call' ? 'job' : 'day';
  if (u.kind === 'quantity' && (u.custom || COUNTABLE_UNITS.includes(u.id))) return 'unit';
  return 'day';
}

/**
 * Por cuánto se multiplican las horas cargadas en la unidad de cobro para llevarlas a horas por
 * día de trabajo: unidades por día (por unidad) o 1 ÷ días del trabajo (por trabajo). 0 = todavía
 * no se puede (falta el rendimiento o los días): las horas en la unidad no se aplican.
 * @param {'unit'|'job'|'day'|null} basis
 * @param {{ unitsPerActiveDay?: number, activeDaysPerMonth?: number, billableQuantityPerMonth?: number, daysPerActivation?: number }} activity
 */
export function unitHoursFactor(basis, activity = {}) {
  const pos = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  if (basis === 'unit') return pos(activity.unitsPerActiveDay);
  if (basis === 'job') {
    const jobs = pos(activity.billableQuantityPerMonth);
    const days = pos(activity.activeDaysPerMonth);
    const perJob = jobs > 0 && days > 0 ? days / jobs : pos(activity.daysPerActivation);
    return perJob > 0 ? 1 / perJob : 0;
  }
  return 0;
}

/**
 * La cotización con las horas "en la unidad de cobro" (`assignedHoursPerUnit`) de cada recurso
 * propio llevadas a horas por día de trabajo (personal: `coverageHoursPerDay`; equipo propio:
 * `assignedHoursPerDay`). No muta: devuelve la misma cotización si no hay nada que resolver.
 * El dato en la unidad manda sobre uno por día cargado antes.
 */
export function resolveUnitHours(quote, activity = {}) {
  const basis = resourceHoursBasis(quote);
  if (basis !== 'unit' && basis !== 'job') return capMonthlyRunningHours(quote, activity);
  const factor = unitHoursFactor(basis, activity);
  if (!(factor > 0)) return quote;
  const own = (line) => (isPlainObject(line) && Number.isFinite(Number(line.assignedHoursPerUnit)) && Number(line.assignedHoursPerUnit) > 0 ? Number(line.assignedHoursPerUnit) * factor : 0);
  let changed = false;
  const map = (list, key, skip) => (Array.isArray(list)
    ? list.map((line) => {
      const perDay = skip && skip(line) ? 0 : own(line);
      if (!(perDay > 0)) return line;
      changed = true;
      return { ...line, [key]: perDay };
    })
    : list);
  const labor = map(quote.labor, 'coverageHoursPerDay');
  const equipment = map(quote.equipment, 'assignedHoursPerDay', (e) => isPlainObject(e) && (e.acquisition === 'rented' || e.acquisition === 'outsourced'));
  return changed ? { ...quote, labor, equipment } : quote;
}

/**
 * Cobro por mes (0.20.0, CALCULATION_RULES §36.3): un equipo propio con "horas asignado por mes"
 * no puede andar más horas que las asignadas. Sus horas de uso por día de servicio quedan, como
 * mucho, en horas asignadas del mes ÷ días de servicio (antes contaba el día entero de servicio
 * aunque estuviera asignado 20 h en el mes). Las horas de uso cargadas más bajas se respetan.
 * No toca la cotización guardada: devuelve una copia sólo si algo cambia.
 */
export function capMonthlyRunningHours(quote, activity = {}) {
  if (!isPlainObject(quote) || usesTimeBasis(quote) || !Array.isArray(quote.equipment)) return quote;
  const days = Number(activity.activeDaysPerMonth);
  const dayHours = Number(activity.hoursPerActiveDay);
  if (!(days > 0)) return quote;
  let changed = false;
  const equipment = quote.equipment.map((line) => {
    if (!isPlainObject(line) || line.acquisition === 'rented' || line.acquisition === 'outsourced') return line;
    const assigned = Number(line.assignedHoursPerMonth);
    if (!(Number.isFinite(assigned) && assigned > 0)) return line;
    const cap = assigned / days;
    const raw = line.hoursPerActiveDay;
    const blank = raw === null || raw === undefined || raw === '';
    const running = blank ? (dayHours > 0 ? dayHours : Infinity) : Number(raw);
    if (!(running > cap + 1e-9)) return line;
    changed = true;
    return { ...line, hoursPerActiveDay: cap };
  });
  return changed ? { ...quote, equipment } : quote;
}
