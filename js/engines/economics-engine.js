/**
 * EconomicsEngine — une costos (CostEngine) y facturación
 * (CommercialRulesEngine) para evaluar el servicio con D días activos.
 *
 * Es la "economía del servicio": costos fijos mensuales + costos variables
 * por día activo, contra la facturación del mes. Los impuestos sobre la
 * facturación (t) se descuentan de lo facturado:
 *
 *   Resultado = Facturación − t × Facturación − Costo
 *   Margen    = Resultado / Facturación     (sobre el precio, antes de Ganancias)
 *   Markup    = Resultado / Costo           (recargo efectivo sobre el costo)
 */

import { nonNegative } from '../core/money.js';
import { costAtActivity } from './cost-engine.js';
import { computeRevenue, requiredNetRate, listRateFromNet, discountFactor, findVolumeTier, continuityApplies, normalizeRules } from './commercial-rules-engine.js';
import { marginFromPrice, markupFromPrice, effectiveMarkupPct } from './pricing-engine.js';
import { billingTaxInfo } from './billing-taxes-engine.js';

/**
 * Contexto económico de una cotización (sin tarifa).
 * @param {object} quote
 * @param {object} model resultado de buildCostModel(quote)
 */
export function createEconomicsContext(quote, model) {
  const pricing = quote.pricing || {};
  const taxes = billingTaxInfo(quote);
  return {
    billingTaxPct: taxes.pct,
    billingTaxInfo: taxes,
    model,
    activity: model.activity,
    unit: ['day', 'hour', 'month'].includes(quote.unit) ? quote.unit : 'day',
    rules: quote.rules || {},
    contractMonths: nonNegative(quote.contractMonths),
    commercialDiscountPct: nonNegative(pricing.commercialDiscountPct),
    routeKmPerActivation: model.logistics.routeKmPerActivation,
  };
}

/** Facturación con D días y una tarifa de lista dada. */
export function revenueAt(ctx, activeDays, listRate, { tierOverride = null } = {}) {
  return computeRevenue({
    listRate,
    activeDays,
    activity: ctx.activity,
    unit: ctx.unit,
    rules: ctx.rules,
    contractMonths: ctx.contractMonths,
    commercialDiscountPct: ctx.commercialDiscountPct,
    routeKmPerActivation: ctx.routeKmPerActivation,
    tierOverride,
  });
}

/** Evalúa el mes con D días activos y una tarifa de lista. */
export function evaluateAt(ctx, activeDays, listRate, options = {}) {
  const D = nonNegative(activeDays);
  const cost = costAtActivity(ctx.model, D);
  const revenue = revenueAt(ctx, D, listRate, options);
  const t = nonNegative(ctx.billingTaxPct);
  const billingTaxes = (revenue.total * t) / 100;
  const profit = revenue.total - billingTaxes - cost.total;
  return {
    activeDays: D,
    utilizationPct: ctx.activity.availableDaysPerMonth > 0 ? (D / ctx.activity.availableDaysPerMonth) * 100 : null,
    exceedsAvailability: ctx.activity.availableDaysPerMonth > 0 && D > ctx.activity.availableDaysPerMonth,
    cost,
    revenue,
    billingTaxPct: t,
    billingTaxes,
    profit,
    // Margen sobre el precio: (Facturación − impuestos − costo) / Facturación.
    marginPct: marginFromPrice(cost.total + billingTaxes, revenue.total),
    // Markup efectivo: resultado / costo.
    markupPct: markupFromPrice(cost.total, revenue.total - billingTaxes),
  };
}

/**
 * Tarifas NETAS necesarias con D días para cada margen.
 * Devuelve también la tarifa de LISTA equivalente según los descuentos
 * que aplicarían con esos días (tramo, continuidad, comercial).
 */
export function requiredRatesAt(ctx, activeDays, marginsPct = [], { tierOverride = null } = {}) {
  const D = nonNegative(activeDays);
  const cost = costAtActivity(ctx.model, D);
  // Unidades y otros ingresos no dependen de la tarifa: se evalúan con tarifa 0.
  const rev0 = revenueAt(ctx, D, 0, { tierOverride });
  const units = rev0.billableUnits;
  const other = rev0.otherRevenue;
  const rules = normalizeRules(ctx.rules);
  const tier = ctx.unit === 'month' ? null : tierOverride || findVolumeTier(rules.volumeTiers, rev0.billableDays);
  const factor = discountFactor({
    tierPct: tier ? tier.discountPct : 0,
    continuityPct: continuityApplies(ctx.rules, ctx.contractMonths) ? rules.continuityDiscountPct : 0,
    commercialPct: ctx.commercialDiscountPct,
  });
  const t = nonNegative(ctx.billingTaxPct);
  const floor = requiredNetRate({ totalCost: cost.total, marginPct: 0, billingTaxPct: t, billableUnits: units, otherRevenue: other });
  const byMargin = marginsPct.map((m) => {
    const r = requiredNetRate({ totalCost: cost.total, marginPct: m, billingTaxPct: t, billableUnits: units, otherRevenue: other });
    // markupPct: recargo efectivo sobre el costo que implica ese margen con t (m / (1 − m − t)).
    return { marginPct: m, netRate: r.rate, listRate: listRateFromNet(r.rate, factor), coveredByOtherRevenue: r.coveredByOtherRevenue, requiredRevenue: r.requiredRevenue, markupPct: effectiveMarkupPct(m, t) };
  });
  return {
    activeDays: D,
    totalCost: cost.total,
    billableUnits: units,
    billableDays: rev0.billableDays,
    otherRevenue: other,
    discountFactor: factor,
    tier,
    billingTaxPct: t,
    floorRequiredRevenue: floor.requiredRevenue,
    floorNetRate: floor.rate,
    floorListRate: listRateFromNet(floor.rate, factor),
    floorCoveredByOtherRevenue: floor.coveredByOtherRevenue,
    byMargin,
  };
}

/**
 * Descomposición lineal: ingresos fijos y contribución por día activo.
 * Sirve para explicar el break-even (exacta si no hay mínimo garantizado
 * ni cambios de tramo de descuento). Con impuestos sobre la facturación (t),
 * cada peso facturado deja (1 − t):
 *
 *   contribución/día = ingreso por día × (1 − t) − costo variable/día
 *   fijos netos      = costos fijos − ingresos fijos × (1 − t)
 */
export function linearDecomposition(ctx, listRate, referenceDays) {
  const D = Math.max(nonNegative(referenceDays), 1);
  const r1 = revenueAt(ctx, D, listRate);
  const keep = 1 - nonNegative(ctx.billingTaxPct) / 100;
  const fixedRevenue = r1.components.availabilityFee + r1.components.standby;
  const variableRevenue = r1.components.base + r1.components.callout + r1.components.mobilization + r1.components.extraKm;
  const revenuePerActiveDay = variableRevenue / D;
  const fixedCosts = ctx.model.fixedMonthly;
  const variableCostPerDay = ctx.model.variablePerActiveDay;
  const contributionPerDay = revenuePerActiveDay * keep - variableCostPerDay;
  const netRatePerActiveDay = r1.components.base / D;
  return {
    fixedCosts,
    fixedRevenue,
    billingTaxPct: nonNegative(ctx.billingTaxPct),
    netFixed: fixedCosts - fixedRevenue * keep,
    revenuePerActiveDay,
    netRatePerActiveDay,
    otherRevenuePerActiveDay: revenuePerActiveDay - netRatePerActiveDay,
    variableCostPerDay,
    contributionPerDay,
    hasNonLinearRules: r1.guarantee > 0 || normalizeRules(ctx.rules).volumeTiers.some((t) => t.discountPct > 0) || r1.minimumCallApplied,
  };
}
