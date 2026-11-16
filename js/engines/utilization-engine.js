/**
 * UtilizationEngine — relación tarifa × utilización.
 *
 *   utilización % = días activos / días disponibles × 100
 *
 * A mayor utilización, menor tarifa unitaria necesaria (los costos fijos se
 * reparten entre más días). A menor utilización, mayor tarifa necesaria.
 *
 *   tarifa necesaria(D, margen) = (Costo(D) / (1 − margen − t) − otrosIngresos(D)) / unidades(D)
 *
 * (t = impuestos sobre la facturación del contexto económico; 0 si no hay.)
 */

import { DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../config.js';
import { nonNegative, safeDivide, clamp } from '../core/money.js';
import { evaluateAt, requiredRatesAt } from './economics-engine.js';
import { objectList } from '../core/object.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS } from '../domain/catalogs.js';
import { fixedCostShareOf } from '../domain/assignment.js';

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
      // Cantidad facturable con esos días, en la unidad comercial (m³, viajes, días…).
      billableUnits: rates.billableUnits,
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

/**
 * Parte del mes que este servicio le ocupa a un recurso (PLAN-2026-025):
 *
 *   % = horas de trabajo del servicio por mes ÷ horas normales del mes × 100   (tope 100 %)
 *   horas de trabajo del servicio = días con trabajo × horas por día
 *
 * Es una PROPUESTA para cuando la persona dice que su gente y sus equipos
 * también hacen otros trabajos: se guarda como % EXPLÍCITO en cada línea
 * (assignment 'shared'), queda a la vista y se puede cambiar. El motor nunca
 * la aplica solo ni la recalcula cuando cambian los días.
 * @returns {number|null} % con un decimal, o null si faltan los días o las horas
 */
export function serviceTimeSharePct({ activeDays, hoursPerActiveDay, normalHoursPerMonth } = {}) {
  const hours = nonNegative(activeDays) * nonNegative(hoursPerActiveDay);
  const ratio = safeDivide(hours, nonNegative(normalHoursPerMonth), null);
  if (ratio === null || !(hours > 0)) return null;
  return Math.min(100, Math.max(0.1, Math.round(ratio * 1000) / 10));
}

/**
 * Propuesta de % para cada persona y cada equipo propio de la cotización.
 * Los equipos usan las horas normales del mes de la cuadrilla (las mayores
 * cargadas) o, sin personal, las del parámetro por defecto.
 * @param {object} quote
 * @param {{ activeDaysPerMonth: number, hoursPerActiveDay: number }} activity actividad normalizada del modelo
 */
export function proposeServiceShares(quote = {}, activity = {}) {
  const labor = objectList(quote.labor);
  const equipment = objectList(quote.equipment);
  const base = { activeDays: activity.activeDaysPerMonth, hoursPerActiveDay: activity.hoursPerActiveDay };
  const crewHours = labor.reduce((max, l) => Math.max(max, nonNegative(l.normalHoursPerMonth)), 0);
  const equipmentHours = crewHours > 0 ? crewHours : ILLUSTRATIVE_AGREEMENT_PARAMS.normalHoursPerMonth;
  return {
    serviceHours: nonNegative(base.activeDays) * nonNegative(base.hoursPerActiveDay),
    equipmentHours,
    labor: labor.map((l) => serviceTimeSharePct({ ...base, normalHoursPerMonth: l.normalHoursPerMonth })),
    equipment: equipment.map((e) => (e.acquisition === 'rented' || e.acquisition === 'outsourced' ? null : serviceTimeSharePct({ ...base, normalHoursPerMonth: equipmentHours }))),
  };
}

/** Diferencia (en puntos) a partir de la cual un % de dedicación cargado se considera viejo. */
export const DEDICATION_STALE_POINTS = 5;

/**
 * % de dedicación que quedó viejo (V-11): una línea compartida cuyo % cargado
 * difiere del propuesto con los días y las horas de AHORA en más de 5 puntos.
 * El % nunca se recalcula solo (AGENTS §5.1): sólo se avisa.
 * @param {object} quote
 * @param {{ activeDaysPerMonth: number, hoursPerActiveDay: number }} activity actividad normalizada
 * @returns {{ kind: 'labor'|'equipment', index: number, loaded: number, proposed: number }|null} la primera línea desajustada
 */
export function staleDedicationOf(quote = {}, activity = {}) {
  const proposal = proposeServiceShares(quote, activity);
  const check = (kind, list, proposed) => {
    for (let index = 0; index < list.length; index += 1) {
      const share = fixedCostShareOf(list[index]);
      const p = proposed[index];
      if (!share.shared || share.missing || p === null || p === undefined) continue;
      if (Math.abs(share.sharePct - p) > DEDICATION_STALE_POINTS + 1e-9) return { kind, index, loaded: share.sharePct, proposed: p };
    }
    return null;
  };
  return check('labor', objectList(quote.labor), proposal.labor) || check('equipment', objectList(quote.equipment), proposal.equipment);
}

/** Texto del aviso de % de dedicación viejo (el mismo en "Cómo se cobra" y en la completitud). */
export function staleDedicationMessage(stale) {
  const pctText = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} %`;
  return `El % cargado (${pctText(stale.loaded)}) ya no coincide con los días y horas de ahora (${pctText(stale.proposed)}).`;
}
