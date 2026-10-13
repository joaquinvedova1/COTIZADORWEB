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
 * Con impuestos sobre la facturación (t), cada peso facturado deja (1 − t):
 *   contribución/día = tarifa/día × (1 − t) − costo variable/día
 *   Ej.: el mismo caso con t = 10 % → 2.600.000/día → 11,54 días.
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
export function breakEvenSimple({ fixedCosts, variableCostPerDay, ratePerDay, billingTaxPct = 0 }) {
  const F = nonNegative(fixedCosts);
  const v = nonNegative(variableCostPerDay);
  const p = nonNegative(ratePerDay);
  const t = nonNegative(billingTaxPct);
  if (t >= 100) {
    return { reachable: false, days: null, wholeDays: null, contributionPerDay: null, reason: 'Los impuestos sobre la facturación tienen que ser menores a 100 %.' };
  }
  const contributionPerDay = p * (1 - t / 100) - v;
  if (F === 0) return { reachable: true, days: 0, wholeDays: 0, contributionPerDay, reason: null };
  if (contributionPerDay <= 0) {
    return {
      reachable: false,
      days: null,
      wholeDays: null,
      contributionPerDay,
      reason: t > 0
        ? 'Lo que te queda de la tarifa después de los impuestos sobre la facturación no cubre el costo variable por día: nunca se alcanza el equilibrio.'
        : 'La tarifa no cubre el costo variable por día: nunca se alcanza el equilibrio.',
    };
  }
  const days = safeDivide(F, contributionPerDay, null);
  return { reachable: days !== null, days, wholeDays: ceilTolerant(days), contributionPerDay, reason: null };
}

/**
 * Tarifa mínima por día para una actividad dada (problema inverso):
 *   tarifa = (costos fijos / días + costo variable/día) / (1 − t)
 */
export function minimumRateForDays({ fixedCosts, variableCostPerDay, activeDays, billingTaxPct = 0 }) {
  const D = nonNegative(activeDays);
  const t = nonNegative(billingTaxPct);
  if (D <= 0 || t >= 100) return null;
  return (nonNegative(fixedCosts) / D + nonNegative(variableCostPerDay)) / (1 - t / 100);
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
 * @param {{ maxDays: number, tolerance?: number, step?: number, breakpoints?: number[] }} options  breakpoints: días donde el costo salta (salidas completas)
 * @returns {{ reachable: boolean, days: number|null, wholeDays: number|null, reason: string|null }}
 */
export function findBreakEvenDays(profitAt, { maxDays, tolerance = PROFIT_TOLERANCE, step = 0.1, breakpoints = [] } = {}) {
  const limit = nonNegative(maxDays);
  const ok = (d) => {
    const p = profitAt(d);
    return isFiniteNumber(p) && p >= -tolerance;
  };
  const divisions = Math.max(1, Math.round(1 / (step > 0 ? step : 0.1)));
  const lastIndex = Math.floor(limit * divisions + 1e-9);
  let grid = [];
  for (let i = 0; i <= lastIndex; i += 1) grid.push(i / divisions);
  if (grid[grid.length - 1] < limit - 1e-12) grid.push(limit);
  // Costos escalonados (PLAN-2026-011, cada salida completa): se evalúa justo
  // en cada salto y apenas después, así ningún tramo con pérdida queda entre
  // dos puntos de la grilla y la bisección trabaja en un tramo continuo.
  if (Array.isArray(breakpoints) && breakpoints.length) {
    const extra = [];
    breakpoints.forEach((b) => {
      if (isFiniteNumber(b) && b > 0 && b < limit) extra.push(b, Math.min(limit, b + 1e-7));
    });
    grid = [...new Set([...grid, ...extra])].sort((a, b) => a - b);
  }

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

/**
 * Traza del break-even (formato "Ver cálculo"). Con `quantityUnit` (cobro por
 * m³, viaje, llamado…; PLAN-2026-009) el equilibrio se expresa en esa unidad:
 *   cantidad = (costos fijos − ingresos fijos) / (tarifa por unidad × (1 − t) + otros ingresos por unidad − costo variable por unidad)
 * con costo variable por unidad = costo variable por día de trabajo ÷ unidades por día.
 */
export function traceBreakEven({ fixedCosts, fixedRevenue = 0, ratePerDay, otherRevenuePerDay = 0, variableCostPerDay, contributionPerDay, result, unitLabel = 'día', nonLinear = false, billingTaxPct = 0, quantityUnit = null }) {
  const t = nonNegative(billingTaxPct);
  const keep = t > 0 ? ' × (1 − impuestos sobre la facturación)' : '';
  if (quantityUnit && quantityUnit.perDay > 0) {
    const u = quantityUnit;
    const per = (v) => (Number.isFinite(v) ? v / u.perDay : null);
    return createTrace({
      id: 'break_even',
      title: `${u.label} (cantidad de equilibrio)`,
      formula: `${u.label} = (Costos fijos${fixedRevenue > 0 ? ` − Ingresos fijos${keep}` : ''}) / (Tarifa por ${u.singular}${keep}${otherRevenuePerDay > 0 ? ' + otros ingresos por ' + u.singular : ''} − Costo variable por ${u.singular}) · Costo variable por ${u.singular} = costo variable por día de trabajo ÷ ${u.plural} por día`,
      inputs: [
        { label: 'Costos fijos mensuales', value: fixedCosts, format: 'money' },
        ...(fixedRevenue > 0 ? [{ label: 'Ingresos fijos (abono de disponibilidad, equipo en espera, materiales fijos)', value: fixedRevenue, format: 'money' }] : []),
        { label: `Tarifa neta por ${u.singular}`, value: per(ratePerDay), format: 'money' },
        ...(otherRevenuePerDay > 0 ? [{ label: `Otros ingresos por ${u.singular} (call-out, movilización, km, materiales)`, value: per(otherRevenuePerDay), format: 'money' }] : []),
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
        { label: `${u.plural} por día de trabajo`, value: u.perDay, format: 'number' },
        { label: 'Costo variable por día de trabajo', value: variableCostPerDay, format: 'money' },
      ],
      steps: [
        { label: `Costo variable por ${u.singular}`, value: per(variableCostPerDay), format: 'money' },
        { label: t > 0 ? `Contribución por ${u.singular} (después de impuestos sobre la facturación)` : `Contribución por ${u.singular}`, value: per(contributionPerDay), format: 'money' },
        { label: 'Días de trabajo para no perder', value: result && result.reachable ? result.days : null, format: 'days' },
      ],
      result: { label: `${u.label} (por mes)`, value: result && result.reachable && Number.isFinite(result.quantity) ? result.quantity : null, format: 'number' },
      notes: [
        result && !result.reachable ? result.reason : null,
        'Los costos se calculan con los días de trabajo (personal, equipos, combustible, viajes) y la facturación, con la unidad que cobrás.',
        nonLinear ? 'Hay reglas no lineales (mínimo garantizado, mínimo por llamado o cada salida contada completa): el resultado se calcula paso a paso, no sólo con la fórmula.' : null,
      ],
    });
  }
  return createTrace({
    id: 'break_even',
    title: 'Break-even (días activos mínimos)',
    formula: fixedRevenue > 0
      ? `Break-even = (Costos fijos − Ingresos fijos${keep}) / (Ingreso por día${keep} − Costo variable por día)`
      : `Break-even = Costos fijos / (Tarifa por día${keep} − Costo variable por día)`,
    inputs: [
      { label: 'Costos fijos mensuales', value: fixedCosts, format: 'money' },
      ...(fixedRevenue > 0 ? [{ label: 'Ingresos fijos (abono de disponibilidad, equipo en espera)', value: fixedRevenue, format: 'money' }] : []),
      { label: `Ingreso por tarifa por día activo (tarifa neta por ${unitLabel} × unidades del día)`, value: ratePerDay, format: 'money' },
      ...(otherRevenuePerDay > 0 ? [{ label: 'Otros ingresos por día activo (call-out, movilización, km)', value: otherRevenuePerDay, format: 'money' }] : []),
      ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
      { label: 'Costo variable por día activo', value: variableCostPerDay, format: 'money' },
    ],
    steps: [{ label: t > 0 ? 'Contribución por día activo (después de impuestos sobre la facturación)' : 'Contribución por día activo', value: contributionPerDay, format: 'money' }],
    result: { label: 'Días activos para no perder plata', value: result && result.reachable ? result.days : null, format: 'days' },
    notes: [
      result && !result.reachable ? result.reason : null,
      nonLinear ? 'Hay reglas no lineales (mínimo garantizado, mínimo por llamado, tramos de descuento o cada salida contada completa): el resultado se calcula día a día, no sólo con la fórmula.' : null,
    ],
  });
}
