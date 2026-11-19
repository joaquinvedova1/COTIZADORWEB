/**
 * ContractedStaffEngine — personal TERCERIZADO de una cotización (0.15.0, pedido del dueño
 * 2026-11-19).
 *
 * El personal propio se carga en Recursos con su sueldo completo (convenio, cargas, valor de la
 * hora). La excepción es una persona que se contrata AFUERA para el trabajo: no hay sueldo ni
 * cargas que calcular, se paga un valor fijo. Cada línea de `quote.contractedStaff` es:
 *
 *   { role, people, rate, unit: 'hour' | 'day' | 'month', hoursPerDay? }
 *
 *   por hora   costo por día de trabajo = personas × valor × horas por día
 *              (horas por día = las de la línea o, vacías, las del trabajo; tope 24)
 *   por día    costo por día de trabajo = personas × valor
 *   por mes    costo fijo del mes       = personas × valor
 *
 * El valor es lo que se le paga al proveedor o a la persona por esa unidad, tal como llega a ser
 * costo (sin IVA si la empresa lo recupera; con IVA si no: lo dice la pantalla). No lleva cargas
 * sociales, aguinaldo ni horas extra: eso ya está en el valor acordado. Va al rubro Personal de
 * la estructura de costos y se paga como un proveedor (no como sueldo).
 *
 * Sin `contractedStaff` (todas las cotizaciones anteriores) no suma nada.
 */

import { objectList } from '../core/object.js';
import { nonNegative } from '../core/money.js';

export const CONTRACTED_STAFF_UNIT_IDS = Object.freeze(['hour', 'day', 'month']);

/** Unidad válida de una línea ('day' si falta o es desconocida). */
export function contractedStaffUnitOf(line = {}) {
  return CONTRACTED_STAFF_UNIT_IDS.includes(line && line.unit) ? line.unit : 'day';
}

/**
 * Costo de UNA línea de personal tercerizado.
 * @param {object} line
 * @param {{ hoursPerActiveDay?: number }} ctx  horas por día de trabajo de la cotización
 */
export function computeContractedStaffLine(line = {}, { hoursPerActiveDay = 0 } = {}) {
  const people = nonNegative(line.people);
  const rate = nonNegative(line.rate);
  const unit = contractedStaffUnitOf(line);
  const ownHours = nonNegative(line.hoursPerDay) > 0;
  const hoursPerDay = Math.min(ownHours ? nonNegative(line.hoursPerDay) : nonNegative(hoursPerActiveDay), 24);
  const perPersonPerActiveDay = unit === 'hour' ? rate * hoursPerDay : unit === 'day' ? rate : 0;
  const perPersonFixedMonthly = unit === 'month' ? rate : 0;
  return {
    id: line.id ?? null,
    role: typeof line.role === 'string' ? line.role : '',
    people,
    rate,
    unit,
    hoursPerDay: unit === 'hour' ? hoursPerDay : null,
    ownHours: unit === 'hour' && ownHours,
    // Por hora sin horas por día: el costo queda en $ 0 (la completitud lo pide).
    hoursMissing: unit === 'hour' && people > 0 && rate > 0 && !(hoursPerDay > 0),
    perPersonPerActiveDay,
    perPersonFixedMonthly,
    fixedMonthly: perPersonFixedMonthly * people,
    variablePerActiveDay: perPersonPerActiveDay * people,
  };
}

/** Todas las líneas y sus totales. */
export function computeContractedStaff(lines = [], ctx = {}) {
  const results = objectList(lines).map((l) => computeContractedStaffLine(l, ctx));
  return {
    lines: results,
    people: results.reduce((s, r) => s + r.people, 0),
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
  };
}
