/**
 * ScenarioEngine — sensibilidad, escenarios y comparador de modelos
 * comerciales.
 *
 * Regla clave: al sensibilizar, la TARIFA COMERCIAL se mantiene fija (la que
 * se ofreció en el caso base). Así se ve el impacto real de cada variable en
 * costo, margen, resultado y break-even.
 */

import { DEFAULT_SCENARIOS } from '../config.js';
import { deepClone } from '../core/object.js';
import { nonNegative, toNumber, pct, isFiniteNumber } from '../core/money.js';
import { computeQuote } from './quote-engine.js';
import { buildCostModel, costAtActivity, normalizeActivity } from './cost-engine.js';
import { findBreakEvenDays } from './break-even-engine.js';
import { marginFromPrice } from './pricing-engine.js';

export const SENSITIVITY_VARIABLES = Object.freeze([
  { id: 'salariesPct', label: 'Salarios', unit: '%' },
  { id: 'fuelPct', label: 'Combustible', unit: '%' },
  { id: 'materialsPct', label: 'Materiales', unit: '%' },
  { id: 'activityPct', label: 'Utilización (días activos)', unit: '%' },
  { id: 'paymentTermDays', label: 'Plazo de pago', unit: 'días' },
  { id: 'commercialDiscountPct', label: 'Descuento comercial', unit: 'puntos' },
]);

const factor = (deltaPct) => Math.max(0, 1 + pct(toNumber(deltaPct, 0)));

/**
 * Devuelve una COPIA de la cotización con las variaciones aplicadas.
 * @param {object} quote
 * @param {{ salariesPct?, fuelPct?, materialsPct?, activityPct?, paymentTermDays?, commercialDiscountPct? }} deltas
 */
export function applySensitivity(quote, deltas = {}) {
  const q = deepClone(quote);
  const s = factor(deltas.salariesPct);
  (q.labor || []).forEach((l) => {
    l.basicMonthly = nonNegative(l.basicMonthly) * s;
    l.additionalsMonthly = nonNegative(l.additionalsMonthly) * s;
  });

  q.fuel = q.fuel || {};
  q.fuel.pricePerLiter = nonNegative(q.fuel.pricePerLiter) * factor(deltas.fuelPct);

  const m = factor(deltas.materialsPct);
  (q.materials || []).forEach((mat) => {
    mat.unitCost = nonNegative(mat.unitCost) * m;
  });
  (q.otherCosts || []).forEach((o) => {
    if (o.category === 'materials') o.amount = nonNegative(o.amount) * m;
  });

  q.activity = q.activity || {};
  // Mismos días disponibles que usa el motor (0 o inválido → 30).
  const available = normalizeActivity(q).availableDaysPerMonth;
  const active = nonNegative(q.activity.activeDaysPerMonth) * factor(deltas.activityPct);
  q.activity.activeDaysPerMonth = Math.min(active, available);

  q.finance = q.finance || {};
  if (toNumber(deltas.paymentTermDays, 0) !== 0) {
    q.finance.paymentTermDays = Math.max(0, nonNegative(q.finance.paymentTermDays) + toNumber(deltas.paymentTermDays, 0));
  }

  q.pricing = q.pricing || {};
  if (toNumber(deltas.commercialDiscountPct, 0) !== 0) {
    q.pricing.commercialDiscountPct = Math.min(100, Math.max(0, nonNegative(q.pricing.commercialDiscountPct) + toNumber(deltas.commercialDiscountPct, 0)));
  }
  return q;
}

function pickKpis(result) {
  const k = result.kpis;
  return {
    totalCost: k.totalCost,
    floorNetRate: k.floorNetRate,
    targetNetRate: k.targetNetRate,
    commercialListRate: k.commercialListRate,
    revenue: k.revenue,
    profit: k.profit,
    marginPct: k.marginPct,
    breakEvenDays: k.breakEvenDays,
    breakEvenWholeDays: k.breakEvenWholeDays,
    targetMarginDays: k.targetMarginDays,
    activeDays: k.activeDays,
    utilizationPct: k.utilizationPct,
    effectiveRatePerActiveDay: k.activeDays > 0 ? k.revenue / k.activeDays : null,
  };
}

function diff(a, b) {
  const out = {};
  for (const key of Object.keys(a)) {
    out[key] = isFiniteNumber(a[key]) && isFiniteNumber(b[key]) ? b[key] - a[key] : null;
  }
  return out;
}

/**
 * Compara el caso base con un caso sensibilizado (tarifa comercial fija).
 */
export function runSensitivity(quote, deltas = {}, { settings = {} } = {}) {
  const baseResult = computeQuote(quote, { settings });
  const listRate = baseResult.kpis.commercialListRate;
  const scenarioResult = computeQuote(applySensitivity(quote, deltas), { settings, listRateOverride: listRate });
  const base = pickKpis(baseResult);
  const scenario = pickKpis(scenarioResult);
  return { base, scenario, delta: diff(base, scenario), listRate };
}

/** Tabla de impacto (tipo tornado): variación de cada variable por separado. */
export function sensitivityTable(quote, { settings = {}, steps = null } = {}) {
  const defaults = steps || {
    salariesPct: 10,
    fuelPct: 10,
    materialsPct: 10,
    activityPct: 20,
    paymentTermDays: 30,
    commercialDiscountPct: 5,
  };
  const baseResult = computeQuote(quote, { settings });
  const listRate = baseResult.kpis.commercialListRate;
  const base = pickKpis(baseResult);
  return Object.entries(defaults).map(([variable, step]) => {
    const variant = (sign) => {
      if (variable === 'commercialDiscountPct' && sign < 0 && nonNegative((quote.pricing || {}).commercialDiscountPct) <= 0) return null;
      const r = computeQuote(applySensitivity(quote, { [variable]: sign * step }), { settings, listRateOverride: listRate });
      return pickKpis(r);
    };
    const low = variant(-1);
    const high = variant(1);
    const meta = SENSITIVITY_VARIABLES.find((v) => v.id === variable);
    return {
      variable,
      label: meta ? meta.label : variable,
      step,
      unit: meta ? meta.unit : '',
      low,
      high,
      profitDeltaLow: low ? low.profit - base.profit : null,
      profitDeltaHigh: high ? high.profit - base.profit : null,
    };
  });
}

/** Escenarios pesimista / base / optimista. */
export function runScenarios(quote, { settings = {}, scenarios = null } = {}) {
  const config = scenarios || settings.scenarios || DEFAULT_SCENARIOS;
  const baseResult = computeQuote(quote, { settings });
  const listRate = baseResult.kpis.commercialListRate;
  const build = (id, label, deltas) => {
    const r = deltas ? computeQuote(applySensitivity(quote, deltas), { settings, listRateOverride: listRate }) : baseResult;
    return { id, label, deltas: deltas || null, ...pickKpis(r) };
  };
  return [
    build('pessimistic', 'Pesimista', config.pessimistic),
    build('base', 'Base', null),
    build('optimistic', 'Optimista', config.optimistic),
  ];
}

/**
 * Comparador de modelos comerciales (tarifa por día).
 * Cada modelo se calibra para lograr el margen objetivo con la actividad
 * estimada y luego se evalúa con actividad pesimista y con 0 días.
 *
 *   1. Sólo tarifa por día:          R(D) = p·D,  p = C(De) / ((1−m)·De)
 *   2. Disponibilidad + día:         R(D) = Fee + q·D,  Fee = Fijos/(1−m), q = Variable/día/(1−m)
 *   3. Mínimo garantizado + día:     R(D) = max(G, p·D),  G = costos fijos del mes
 *   4. Paquete mensual + excedentes: R(D) = Paquete + p·max(0, D − De),  Paquete = C(De)/(1−m)
 */
export function compareCommercialModels(quote, { settings = {}, pessimisticActivityPct = null } = {}) {
  const model = buildCostModel(quote);
  const De = model.activity.activeDaysPerMonth;
  const available = model.activity.availableDaysPerMonth;
  const m = toNumber((quote.pricing || {}).targetMarginPct, 0);
  if (!(De > 0) || !(m >= 0 && m < 100)) return { models: [], estimatedDays: De, pessimisticDays: null, reason: 'Cargá la actividad estimada y un margen válido para comparar modelos.' };
  const pessPct = pessimisticActivityPct ?? (settings.scenarios || DEFAULT_SCENARIOS).pessimistic.activityPct;
  const Dp = Math.max(0, De * (1 + pessPct / 100));
  const k = 1 - m / 100;
  const C = (D) => costAtActivity(model, D).total;
  const fixed = costAtActivity(model, 0).total;
  const variablePerDay = model.variablePerActiveDay;
  const p = C(De) / (k * De);

  const definitions = [
    { id: 'day_rate', label: 'Sólo tarifa por día', params: { ratePerDay: p }, revenue: (D) => p * D },
    { id: 'availability_plus_day', label: 'Fee de disponibilidad + tarifa por día', params: { availabilityFee: fixed / k, ratePerDay: variablePerDay / k }, revenue: (D) => fixed / k + (variablePerDay / k) * D },
    { id: 'guarantee_plus_day', label: 'Mínimo garantizado + tarifa por día', params: { minimumGuarantee: fixed, ratePerDay: p }, revenue: (D) => Math.max(fixed, p * D) },
    { id: 'package_plus_excess', label: 'Paquete mensual + excedentes', params: { packagePrice: C(De) / k, includedDays: De, excessRatePerDay: p }, revenue: (D) => C(De) / k + p * Math.max(0, D - De) },
  ];

  const models = definitions.map((d) => {
    const expectedRevenue = d.revenue(De);
    const expectedProfit = expectedRevenue - C(De);
    const pessRevenue = d.revenue(Dp);
    const pessProfit = pessRevenue - C(Dp);
    const pessMargin = marginFromPrice(C(Dp), pessRevenue);
    const be = findBreakEvenDays((D) => d.revenue(D) - C(D), { maxDays: available });
    let risk = 'low';
    if (pessProfit < 0) risk = 'high';
    else if (isFiniteNumber(pessMargin) && pessMargin < m / 2) risk = 'medium';
    return {
      id: d.id,
      label: d.label,
      params: d.params,
      expectedRevenue,
      expectedProfit,
      expectedMarginPct: marginFromPrice(C(De), expectedRevenue),
      pessimisticRevenue: pessRevenue,
      pessimisticProfit: pessProfit,
      pessimisticMarginPct: pessMargin,
      minimumAssuredRevenue: d.revenue(0),
      breakEvenDays: be.days,
      breakEvenReachable: be.reachable,
      risk,
    };
  });
  return { models, estimatedDays: De, pessimisticDays: Dp, targetMarginPct: m };
}
