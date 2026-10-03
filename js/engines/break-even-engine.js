/**
 * BreakEvenEngine — punto de equilibrio en días activos.
 *
 * Caso base (on-call, tarifa por día, sin reglas comerciales):
 *
 *   contribución/día = tarifa/día − costo variable/día
 *   break-even (días) = costos fijos / contribución/día
 *
 *   Ej.: fijos 30.000.000, variable 1.000.000/día, tarifa 4.000.000/día
 *        contribución 3.000.000/día → break-even 10 días.
 *
 * Con reglas comerciales (mínimo garantizado, tramos de descuento, minimum
 * call) la relación deja de ser lineal: se busca numéricamente el menor D
 * a partir del cual resultado(D) ≥ 0 se sostiene hasta los días disponibles,
 * con una grilla de 0,1 día y refinamiento por bisección.
 */

import { nonNegative, safeDivide, ceilTolerant, isFiniteNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';

/** Tolerancia absoluta de resultado ($) para considerar equilibrio. */
export const PROFIT_TOLERANCE = 1e-6;

/**
 * Break-even cerrado (fórmula clásica).
 * @returns {{ reachable: boolean, days: number|null, wholeDays: number|null, contributionPerDay: number, reason: string|null }}
 */
export function breakEvenSimple({ fixedCosts, variableCostPerDay, ratePerDay }) {
  const F = nonNegative(fixedCosts);
  const v = nonNegative(variableCostPerDay);
  const p = nonNegative(ratePerDay);
  const contributionPerDay = p - v;
  if (F === 0) return { reachable: true, days: 0, wholeDays: 0, contributionPerDay, reason: null };
  if (contributionPerDay <= 0) {
    return {
      reachable: false,
      days: null,
      wholeDays: null,
      contributionPerDay,
      reason: 'La tarifa no cubre el costo variable por día: nunca se alcanza el equilibrio.',
    };
  }
  const days = safeDivide(F, contributionPerDay, null);
  return { reachable: days !== null, days, wholeDays: ceilTolerant(days), contributionPerDay, reason: null };
}

/**
 * Tarifa mínima por día para una actividad dada (problema inverso):
 *   tarifa = costos fijos / días + costo variable/día
 */
export function minimumRateForDays({ fixedCosts, variableCostPerDay, activeDays }) {
  const D = nonNegative(activeDays);
  if (D <= 0) return null;
  return nonNegative(fixedCosts) / D + nonNegative(variableCostPerDay);
}

/**
 * Días activos mínimos a partir de los cuales el resultado es ≥ 0 y se
 * mantiene ≥ 0 hasta `maxDays` (definición robusta frente a reglas no
 * lineales como el mínimo garantizado o los tramos de descuento).
 *
 * Algoritmo determinístico: se evalúa una grilla de paso `step` días
 * (por defecto 0,1) entre 0 y maxDays; se toma el último punto con
 * resultado negativo y se refina por bisección hasta el siguiente punto.
 *
 * @param {(days:number) => number} profitAt
 * @param {{ maxDays: number, tolerance?: number, step?: number }} options
 * @returns {{ reachable: boolean, days: number|null, wholeDays: number|null, reason: string|null }}
 */
export function findBreakEvenDays(profitAt, { maxDays, tolerance = PROFIT_TOLERANCE, step = 0.1 } = {}) {
  const limit = nonNegative(maxDays);
  const ok = (d) => {
    const p = profitAt(d);
    return isFiniteNumber(p) && p >= -tolerance;
  };
  const divisions = Math.max(1, Math.round(1 / (step > 0 ? step : 0.1)));
  const lastIndex = Math.floor(limit * divisions + 1e-9);
  const grid = [];
  for (let i = 0; i <= lastIndex; i += 1) grid.push(i / divisions);
  if (grid[grid.length - 1] < limit - 1e-12) grid.push(limit);

  let lastNegative = -1;
  for (let i = 0; i < grid.length; i += 1) {
    if (!ok(grid[i])) lastNegative = i;
  }
  if (lastNegative === -1) return { reachable: true, days: 0, wholeDays: 0, reason: null };
  if (lastNegative === grid.length - 1) {
    return {
      reachable: false,
      days: null,
      wholeDays: null,
      reason: `No se alcanza el equilibrio dentro de los ${limit} días disponibles del mes.`,
    };
  }
  let lo = grid[lastNegative];
  let hi = grid[lastNegative + 1];
  for (let i = 0; i < 80 && hi - lo > 1e-10; i += 1) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  // Si la diferencia con el entero es despreciable, devolver el entero exacto.
  const rounded = Math.round(hi);
  const days = Math.abs(hi - rounded) < 1e-7 && ok(rounded) ? rounded : hi;
  return { reachable: true, days, wholeDays: ceilTolerant(days), reason: null };
}

/** Traza del break-even (formato "Ver cálculo"). */
export function traceBreakEven({ fixedCosts, fixedRevenue = 0, ratePerDay, otherRevenuePerDay = 0, variableCostPerDay, contributionPerDay, result, unitLabel = 'día', nonLinear = false }) {
  return createTrace({
    id: 'break_even',
    title: 'Break-even (días activos mínimos)',
    formula: fixedRevenue > 0
      ? 'Break-even = (Costos fijos − Ingresos fijos) / (Ingreso por día − Costo variable por día)'
      : 'Break-even = Costos fijos / (Tarifa por día − Costo variable por día)',
    inputs: [
      { label: 'Costos fijos mensuales', value: fixedCosts, format: 'money' },
      ...(fixedRevenue > 0 ? [{ label: 'Ingresos fijos (fee de disponibilidad, standby)', value: fixedRevenue, format: 'money' }] : []),
      { label: `Ingreso por tarifa por día activo (tarifa neta por ${unitLabel} × unidades del día)`, value: ratePerDay, format: 'money' },
      ...(otherRevenuePerDay > 0 ? [{ label: 'Otros ingresos por día activo (call-out, movilización, km)', value: otherRevenuePerDay, format: 'money' }] : []),
      { label: 'Costo variable por día activo', value: variableCostPerDay, format: 'money' },
    ],
    steps: [{ label: 'Contribución por día activo', value: contributionPerDay, format: 'money' }],
    result: { label: 'Días activos para no perder dinero', value: result && result.reachable ? result.days : null, format: 'days' },
    notes: [
      result && !result.reachable ? result.reason : null,
      nonLinear ? 'Hay reglas no lineales (mínimo garantizado, minimum call o tramos de descuento): el resultado se calcula día a día, no sólo con la fórmula.' : null,
    ],
  });
}
