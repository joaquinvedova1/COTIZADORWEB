/**
 * UtilizationEngine — relación tarifa × utilización.
 *
 *   utilización % = días activos / días disponibles × 100
 *
 * A mayor utilización, menor tarifa unitaria necesaria (los costos fijos se
 * reparten entre más días). A menor utilización, mayor tarifa necesaria.
 *
 *   tarifa necesaria(D, margen) = (Costo(D) / (1 − margen) − otrosIngresos(D)) / unidades(D)
 */

import { DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../config.js';
import { nonNegative, safeDivide, clamp } from '../core/money.js';
import { evaluateAt, requiredRatesAt } from './economics-engine.js';

/** Utilización (%) de D días sobre los disponibles. null si no hay disponibilidad. */
export function utilizationPct(activeDays, availableDays) {
  const r = safeDivide(nonNegative(activeDays), nonNegative(availableDays), null);
  return r === null ? null : r * 100;
}

/** Días activos que corresponden a una utilización (%). */
export function activeDaysFromUtilization(utilization, availableDays) {
  return (clamp(utilization, 0, 100) / 100) * nonNegative(availableDays);
}

/** Lista de días de la matriz: los configurados + la actividad estimada. */
export function matrixDays(configured = DEFAULT_MATRIX_DAYS, estimatedDays = null) {
  const set = new Set(configured.map((d) => nonNegative(d)).filter((d) => d > 0));
  const est = nonNegative(estimatedDays);
  if (est > 0) set.add(est);
  return [...set].sort((a, b) => a - b);
}

/**
 * Matriz tarifa × utilización.
 * @param {object} ctx contexto económico (economics-engine)
 * @param {{ days: number[], marginsPct: number[], commercialListRate: number|null, estimatedDays: number }} options
 */
export function buildRateUtilizationMatrix(ctx, { days, marginsPct = DEFAULT_MARGIN_LADDER, commercialListRate = null, estimatedDays = null }) {
  return days.map((D) => {
    const rates = requiredRatesAt(ctx, D, marginsPct);
    const evaluation = commercialListRate !== null ? evaluateAt(ctx, D, commercialListRate) : null;
    return {
      activeDays: D,
      utilizationPct: utilizationPct(D, ctx.activity.availableDaysPerMonth),
      exceedsAvailability: ctx.activity.availableDaysPerMonth > 0 && D > ctx.activity.availableDaysPerMonth,
      isEstimate: estimatedDays !== null && Math.abs(D - nonNegative(estimatedDays)) < 1e-9,
      floorNetRate: rates.floorNetRate,
      byMargin: rates.byMargin,
      cost: rates.totalCost,
      revenue: evaluation ? evaluation.revenue.total : null,
      profit: evaluation ? evaluation.profit : null,
      marginPct: evaluation ? evaluation.marginPct : null,
      tierDiscountPct: evaluation ? evaluation.revenue.tierDiscountPct : null,
    };
  });
}
