/**
 * CommercialRulesEngine — cómo se factura el servicio.
 *
 * Reglas soportadas (todas opcionales; 0 = no aplica):
 *   - Minimum call: mínimo de unidades facturables por activación.
 *   - Standby: días/mes en locación sin operar × tarifa standby.
 *   - Call-out fee: monto fijo por activación.
 *   - Movilización: monto fijo por activación.
 *   - Km adicional: (km de ruta por activación − km incluidos) × $/km.
 *   - Descuento por cantidad de días (tramos: 1, 2–7, 8–15, 16–30, +30).
 *   - Descuento por continuidad: si el contrato dura ≥ N meses.
 *   - Mínimo mensual garantizado: la facturación del mes nunca es menor.
 *   - Fee de disponibilidad: monto mensual fijo por estar disponible.
 *
 * Facturación del mes con D días activos:
 *   activaciones     = D / díasPorActivación
 *   unidades         = activaciones × max(unidadesPorActivación, minimumCall)
 *   tarifaNeta       = tarifaLista × (1 − tramo%) × (1 − continuidad%) × (1 − descuentoComercial%)
 *   base             = tarifaNeta × unidades
 *   otros ingresos   = feeDisponibilidad + (callOut + movilización + kmAdicional) × activaciones + standby
 *   subtotal         = base + otros
 *   total            = max(subtotal, mínimoGarantizado)
 */

import { isPlainObject } from '../core/object.js';
import { nonNegative, pct, safeDivide, isFiniteNumber } from '../core/money.js';
import { NUMERIC_EPSILON } from '../config.js';
import { priceFromMarginAndTaxes } from './pricing-engine.js';
import { DEFAULT_VOLUME_TIERS } from '../domain/catalogs.js';

// Tramos por defecto (dato de dominio): se definen en catalogs.js y se
// re-exportan para mantener la API pública del motor.
export { DEFAULT_VOLUME_TIERS };

/** Etiqueta legible de un tramo. */
export function tierLabel(tier) {
  const from = nonNegative(tier.fromDays);
  const to = tier.toDays === null || tier.toDays === undefined || tier.toDays === '' ? null : nonNegative(tier.toDays);
  if (to === null) return `+${Math.max(0, from - 1)} días`;
  if (to === from) return `${from} ${from === 1 ? 'día' : 'días'}`;
  return `${from}–${to} días`;
}

/** Tramos ordenados y saneados. */
export function normalizeTiers(tiers) {
  const valid = Array.isArray(tiers) ? tiers.filter(isPlainObject) : [];
  const list = valid.length > 0 ? valid : DEFAULT_VOLUME_TIERS;
  return list
    .map((t, i) => ({
      id: t.id ?? `tier-${i + 1}`,
      fromDays: nonNegative(t.fromDays),
      toDays: t.toDays === null || t.toDays === undefined || t.toDays === '' ? null : nonNegative(t.toDays),
      discountPct: Math.min(nonNegative(t.discountPct), 100),
    }))
    .sort((a, b) => a.fromDays - b.fromDays);
}

/**
 * Tramo aplicable a una cantidad de días facturables: el último tramo cuyo
 * "desde" sea ≤ días. Con 0 días o menos que el primer tramo no hay tramo.
 */
export function findVolumeTier(tiers, billableDays) {
  const d = nonNegative(billableDays);
  if (d <= 0) return null;
  let found = null;
  for (const t of normalizeTiers(tiers)) {
    if (t.fromDays <= d + NUMERIC_EPSILON) found = t;
  }
  return found;
}

/** Reglas comerciales saneadas. */
export function normalizeRules(rules = {}) {
  return {
    availabilityFeeMonthly: nonNegative(rules.availabilityFeeMonthly),
    calloutFeePerActivation: nonNegative(rules.calloutFeePerActivation),
    mobilizationFeePerActivation: nonNegative(rules.mobilizationFeePerActivation),
    includedKmPerActivation: nonNegative(rules.includedKmPerActivation),
    extraKmRate: nonNegative(rules.extraKmRate),
    minimumCallUnits: nonNegative(rules.minimumCallUnits),
    // "No aplica standby" anula días e ingresos de standby.
    standbyDaysPerMonth: rules.standbyNotApplicable === true ? 0 : nonNegative(rules.standbyDaysPerMonth),
    standbyRatePerDay: rules.standbyNotApplicable === true ? 0 : nonNegative(rules.standbyRatePerDay),
    volumeTiers: normalizeTiers(rules.volumeTiers),
    continuityMinMonths: nonNegative(rules.continuityMinMonths),
    continuityDiscountPct: Math.min(nonNegative(rules.continuityDiscountPct), 100),
    minimumMonthlyGuarantee: nonNegative(rules.minimumMonthlyGuarantee),
  };
}

/** ¿Aplica el descuento por continuidad para esta duración de contrato? */
export function continuityApplies(rules, contractMonths) {
  const r = normalizeRules(rules);
  return r.continuityDiscountPct > 0 && nonNegative(contractMonths) >= r.continuityMinMonths && r.continuityMinMonths > 0;
}

/**
 * Unidades facturables con D días activos.
 * @param {{ activeDays:number, daysPerActivation:number, hoursPerActiveDay:number, availableDaysPerMonth:number, unit:'day'|'hour'|'month', minimumCallUnits:number }} p
 */
export function billableUnits({ activeDays, daysPerActivation, hoursPerActiveDay, availableDaysPerMonth, unit = 'day', minimumCallUnits = 0 }) {
  const D = nonNegative(activeDays);
  const dpa = nonNegative(daysPerActivation) > 0 ? nonNegative(daysPerActivation) : 1;
  const hours = nonNegative(hoursPerActiveDay);
  const activations = D / dpa;
  const minCall = nonNegative(minimumCallUnits);

  if (unit === 'month') {
    const available = nonNegative(availableDaysPerMonth);
    const months = available > 0 && D > available ? D / available : 1;
    return { activations, unitsPerActivation: null, billableUnitsPerActivation: null, billableUnits: months, billableDays: D, minimumCallApplied: false };
  }
  const unitsPerActivation = unit === 'hour' ? dpa * hours : dpa;
  const billableUnitsPerActivation = Math.max(unitsPerActivation, minCall);
  const units = activations * billableUnitsPerActivation;
  const billableDays = unit === 'hour' ? (hours > 0 ? units / hours : D) : units;
  return {
    activations,
    unitsPerActivation,
    billableUnitsPerActivation,
    billableUnits: units,
    billableDays,
    minimumCallApplied: minCall > unitsPerActivation + NUMERIC_EPSILON && activations > 0,
  };
}

/** Factor que convierte tarifa de lista en tarifa neta. */
export function discountFactor({ tierPct = 0, continuityPct = 0, commercialPct = 0 } = {}) {
  return (1 - pct(Math.min(nonNegative(tierPct), 100))) * (1 - pct(Math.min(nonNegative(continuityPct), 100))) * (1 - pct(Math.min(nonNegative(commercialPct), 100)));
}

/**
 * Facturación mensual completa con D días activos.
 * @param {object} p
 * @param {number|null} p.listRate tarifa de lista por unidad (día/hora/mes)
 * @param {number} p.activeDays
 * @param {object} p.activity actividad normalizada (cost-engine.normalizeActivity)
 * @param {'day'|'hour'|'month'} p.unit
 * @param {object} p.rules reglas comerciales
 * @param {number} p.contractMonths
 * @param {number} p.commercialDiscountPct
 * @param {number} p.routeKmPerActivation km de ruta por activación (logística)
 * @param {object|null} [p.tierOverride] forzar un tramo de descuento (evaluación de tramos)
 */
export function computeRevenue({ listRate, activeDays, activity, unit = 'day', rules = {}, contractMonths = 0, commercialDiscountPct = 0, routeKmPerActivation = 0, tierOverride = null }) {
  const r = normalizeRules(rules);
  const D = nonNegative(activeDays);
  const units = billableUnits({
    activeDays: D,
    daysPerActivation: activity.daysPerActivation,
    hoursPerActiveDay: activity.hoursPerActiveDay,
    availableDaysPerMonth: activity.availableDaysPerMonth,
    unit,
    minimumCallUnits: r.minimumCallUnits,
  });
  const available = nonNegative(activity.availableDaysPerMonth);
  const months = available > 0 && D > available ? D / available : 1;

  const tier = unit === 'month' ? null : tierOverride || findVolumeTier(r.volumeTiers, units.billableDays);
  const tierPct = tier ? tier.discountPct : 0;
  const continuityPct = continuityApplies(rules, contractMonths) ? r.continuityDiscountPct : 0;
  const commercialPct = Math.min(nonNegative(commercialDiscountPct), 100);
  const factor = discountFactor({ tierPct, continuityPct, commercialPct });
  const list = isFiniteNumber(listRate) ? nonNegative(listRate) : 0;
  const netRate = list * factor;

  const extraKmPerActivation = Math.max(0, nonNegative(routeKmPerActivation) - r.includedKmPerActivation);
  const components = {
    base: netRate * units.billableUnits,
    availabilityFee: r.availabilityFeeMonthly * months,
    callout: r.calloutFeePerActivation * units.activations,
    mobilization: r.mobilizationFeePerActivation * units.activations,
    extraKm: extraKmPerActivation * r.extraKmRate * units.activations,
    standby: r.standbyDaysPerMonth * r.standbyRatePerDay * months,
  };
  const otherRevenue = components.availabilityFee + components.callout + components.mobilization + components.extraKm + components.standby;
  const subtotal = components.base + otherRevenue;
  const guarantee = r.minimumMonthlyGuarantee * months;
  const guaranteeTopUp = Math.max(0, guarantee - subtotal);
  return {
    activeDays: D,
    unit,
    ...units,
    tier,
    tierDiscountPct: tierPct,
    continuityDiscountPct: continuityPct,
    commercialDiscountPct: commercialPct,
    discountFactor: factor,
    listRate: list,
    netRate,
    extraKmPerActivation,
    components,
    otherRevenue,
    subtotal,
    guarantee,
    guaranteeTopUp,
    total: subtotal + guaranteeTopUp,
  };
}

/**
 * Tarifa NETA por unidad necesaria para lograr un margen sobre la
 * facturación total, dado el costo total, los otros ingresos y los impuestos
 * sobre la facturación (t). No considera el mínimo garantizado (criterio
 * conservador). Los otros ingresos también tributan: se restan de la
 * facturación necesaria ya calculada con el gross-up.
 *
 *   tarifaNeta = (Costo / (1 − margen − t) − otrosIngresos) / unidades
 *
 * @returns {{ rate: number|null, coveredByOtherRevenue: boolean, requiredRevenue: number|null, invalid?: boolean }}
 */
export function requiredNetRate({ totalCost, marginPct = 0, billingTaxPct = 0, billableUnits: units, otherRevenue = 0 }) {
  const requiredRevenue = priceFromMarginAndTaxes(totalCost, marginPct, billingTaxPct);
  if (requiredRevenue === null) return { rate: null, coveredByOtherRevenue: false, requiredRevenue: null, invalid: isFiniteNumber(totalCost) };
  const remaining = requiredRevenue - nonNegative(otherRevenue);
  const rate = safeDivide(remaining, units, null);
  if (rate === null) return { rate: null, coveredByOtherRevenue: remaining <= 0, requiredRevenue };
  if (rate < 0) return { rate: 0, coveredByOtherRevenue: true, requiredRevenue };
  return { rate, coveredByOtherRevenue: false, requiredRevenue };
}

/**
 * Mínimo por llamado al cambiar la unidad de la tarifa (mismo significado en
 * la otra unidad): día → hora × horas por día activo; hora → día ÷ horas.
 * Con abono mensual no aplica (se conserva el número). null si no se puede
 * convertir (sin horas por día).
 */
export function convertMinimumCallUnits(units, fromUnit, toUnit, hoursPerActiveDay) {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0 || fromUnit === toUnit) return Number.isFinite(n) ? n : null;
  if (toUnit === 'month' || fromUnit === 'month') return n;
  const hours = Number(hoursPerActiveDay);
  if (!(Number.isFinite(hours) && hours > 0)) return null;
  if (fromUnit === 'day' && toUnit === 'hour') return n * hours;
  if (fromUnit === 'hour' && toUnit === 'day') return n / hours;
  return null;
}

/** Tarifa de lista necesaria para cobrar una tarifa neta, dado el factor de descuento. */
export function listRateFromNet(netRate, factor) {
  if (!isFiniteNumber(netRate)) return null;
  return safeDivide(netRate, factor, null);
}

/**
 * Semáforo de un descuento:
 *  green     = mantiene el margen objetivo
 *  orange    = debajo del margen objetivo pero sobre break-even
 *  red       = debajo de break-even (pierde dinero)
 *  no_target = cubre los costos, pero no hay un margen objetivo válido para comparar
 */
export function classifyDiscount({ netRate, floorNetRate, targetNetRate }) {
  if (!isFiniteNumber(netRate) || !isFiniteNumber(floorNetRate)) return 'unknown';
  const tol = Math.max(1e-6, Math.abs(floorNetRate) * 1e-9);
  if (netRate < floorNetRate - tol) return 'red';
  // Sin margen objetivo válido no hay contra qué comparar: no se rotula "bajo el objetivo".
  if (!isFiniteNumber(targetNetRate)) return 'no_target';
  return netRate >= targetNetRate - tol ? 'green' : 'orange';
}
