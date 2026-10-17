/**
 * QuoteEngine — orquesta todos los motores para una cotización.
 *
 * Función pura: mismos inputs → mismos outputs. No accede a DOM ni a storage.
 *
 * Conceptos:
 *   COSTO            lo que cuesta prestar el servicio en el mes
 *   TARIFA PISO      tarifa neta que iguala costo (margen 0)
 *   PRECIO OBJETIVO  tarifa para lograr el margen objetivo
 *   PRECIO COMERCIAL tarifa de lista finalmente ofrecida
 */

import { DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../config.js';
import { nonNegative, safeDivide, isFiniteNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { formatPercent, formatDays, formatNumber } from '../core/format.js';
import { validateQuote } from '../core/validation.js';
import { buildCostModel, costStructure, costAtActivity, traceTotalCost, monthsFactor, activationRoundingAt, activationBreakpoints } from './cost-engine.js';
import { createEconomicsContext, evaluateAt, requiredRatesAt, linearDecomposition, revenueAt } from './economics-engine.js';
import { findBreakEvenDays, traceBreakEven } from './break-even-engine.js';
import { buildRateUtilizationMatrix, matrixDays } from './utilization-engine.js';
import { classifyDiscount, normalizeRules, tierLabel, continuityApplies, unitHasDayTiers } from './commercial-rules-engine.js';
import { isValidMarginPct, isValidMarginAndTaxes, commercialRound, markupWithTaxesPct, profitOnCostPct, readMarginInput } from './pricing-engine.js';
import { evaluateCompleteness, COMPLETENESS_RISK_THRESHOLD } from './completeness-engine.js';
import { traceBillingTaxes } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { unitTexts, unitFitsServiceType, SERVICE_TYPE_UNITS, BILLING_UNITS } from '../domain/billing-units.js';
import { SERVICE_TYPES, labelOf } from '../domain/catalogs.js';

/** Margen leído como lo valida validateQuote (texto es-AR incluido); `fallback` si está vacío o es inválido. */
function readMargin(value, fallback) {
  const r = readMarginInput(value);
  return r.state === 'ok' ? r.value : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * Menor cantidad de DÍAS ACTIVOS con la que se alcanzan `billableDays` días
 * facturables (con minimum call, cada activación factura más días de los
 * trabajados). Es el peor caso del tramo: la menor actividad que ya recibe
 * ese descuento.
 */
export function minActiveDaysForBillableDays(ctx, billableDays) {
  const a = ctx.activity;
  const dpa = a.daysPerActivation > 0 ? a.daysPerActivation : 1;
  const minCall = normalizeRules(ctx.rules).minimumCallUnits;
  const bd = nonNegative(billableDays);
  if (ctx.unit === 'hour') {
    const h = a.hoursPerActiveDay;
    if (!(h > 0)) return bd;
    const perActivation = Math.max(dpa * h, minCall);
    return perActivation > 0 ? (bd * dpa * h) / perActivation : bd;
  }
  const perActivation = Math.max(dpa, minCall);
  return perActivation > 0 ? (bd * dpa) / perActivation : bd;
}

/**
 * Abono mensual (unidad mes): la facturación es fija y cada día activo suma
 * costo variable, así que en vez de días MÍNIMOS hay días MÁXIMOS sin perder
 * (o conservando un margen sobre la facturación). Mismo buscador del
 * break-even sobre el resultado invertido; el resultado ya descuenta los
 * impuestos sobre la facturación.
 * @returns {null | { status: 'until'|'all'|'none', days: number|null, wholeDays: number|null, available: number, marginPct: number, listRate: number }}
 */
export function monthlyFeeCap(ctx, listRate, marginPct = 0) {
  if (!ctx || ctx.unit !== 'month' || !(isFiniteNumber(listRate) && listRate > 0)) return null;
  const available = ctx.activity ? ctx.activity.availableDaysPerMonth : null;
  if (!(isFiniteNumber(available) && available > 0)) return null;
  const m = isValidMarginPct(marginPct) && marginPct > 0 ? marginPct : 0;
  const gap = (d) => {
    const e = evaluateAt(ctx, d, listRate);
    return e.profit - (m / 100) * e.revenue.total;
  };
  const res = findBreakEvenDays((d) => -gap(d), { maxDays: available, breakpoints: activationBreakpoints(ctx.model, available) });
  if (!res.reachable) return { status: 'all', days: null, wholeDays: null, available, marginPct: m, listRate };
  if (!(res.days > 1e-9)) return { status: 'none', days: 0, wholeDays: 0, available, marginPct: m, listRate };
  return { status: 'until', days: res.days, wholeDays: Math.floor(res.days + 1e-7), available, marginPct: m, listRate };
}

/** Cantidad facturable (en la unidad comercial) con D días de trabajo. */
export function billableQuantityAt(ctx, activeDays) {
  return revenueAt(ctx, activeDays, 0).billableUnits;
}

/** Cantidad de equilibrio en la unidad comercial: la cantidad que se factura en esos días. */
function withQuantity(ctx, res) {
  if (!res || !res.reachable || !isFiniteNumber(res.days)) return { ...res, quantity: null, wholeQuantity: null };
  const quantity = billableQuantityAt(ctx, res.days);
  return { ...res, quantity, wholeQuantity: Math.ceil(quantity - 1e-7) };
}

/** Avisos de la unidad de facturación (PLAN-2026-009). No cambian ningún número. */
function unitIssues(quote, ctx) {
  const issues = [];
  const u = ctx.unitInfo;
  const a = ctx.activity;
  if (u.custom && !(typeof quote.unitName === 'string' && quote.unitName.trim())) {
    issues.push({ path: 'unitName', message: 'Escribí el nombre de tu unidad (por ejemplo "pozo" o "muestra").', severity: 'warning' });
  }
  if (u.kind === 'quantity' || u.kind === 'event') {
    const q = quote.activity ? quote.activity.billableQuantityPerMonth : null;
    if (q !== null && q !== undefined && q !== '' && !(Number(q) >= 0)) issues.push({ path: 'activity.billableQuantityPerMonth', message: 'La cantidad por mes debe ser un número mayor o igual a 0.', severity: 'error' });
    if (u.kind === 'quantity' && a.billableQuantityPerMonth > 0 && !(a.unitsPerActiveDay > 0) && !(normalizeRules(ctx.rules).minimumCallUnits > 0)) {
      issues.push({ path: 'activity.unitsPerActiveDay', message: `Cargá ${unitTexts(u).cuantos} ${u.plural} hacés por día de trabajo: sin eso no se pueden calcular los días de trabajo ni los costos.`, severity: 'error' });
    }
    if (a.activeDaysPerMonth > a.availableDaysPerMonth + 1e-9) {
      issues.push({
        path: 'activity.billableQuantityPerMonth',
        message: `Para facturar ${formatNumber(a.billableQuantityPerMonth, { decimals: 2 })} ${u.plural} por mes necesitás ${formatDays(a.activeDaysPerMonth, { decimals: 1 })} de trabajo: más que los ${formatNumber(a.availableDaysPerMonth)} días disponibles del mes.`,
        severity: 'warning',
      });
    }
  }
  if (quote.serviceType && SERVICE_TYPE_UNITS[quote.serviceType] && !unitFitsServiceType(quote.serviceType, u.id)) {
    const usual = SERVICE_TYPE_UNITS[quote.serviceType].map((id) => (BILLING_UNITS.find((x) => x.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
    issues.push({
      path: 'unit',
      message: `"${labelOf(SERVICE_TYPES, quote.serviceType, 'Este servicio')}" se suele cobrar en ${usual}. Estás cobrando en ${u.label}: revisá que sea la unidad correcta.`,
      severity: 'warning',
    });
  }
  return issues;
}

/** Evalúa cada tramo de descuento por cantidad de días (peor caso del tramo). */
export function evaluateDiscountTiers(ctx, listRate, targetMarginPct) {
  // Los tramos son por cantidad de días: sólo con tarifa por día u hora.
  if (!unitHasDayTiers(ctx.unit) || !isFiniteNumber(listRate)) return [];
  const rules = normalizeRules(ctx.rules);
  return rules.volumeTiers.map((tier) => {
    // Peor caso: la menor actividad que ya cae en el tramo (con minimum call,
    // menos días activos que los días facturables del tramo).
    const days = Math.max(minActiveDaysForBillableDays(ctx, Math.max(tier.fromDays, 1)), 1e-6);
    const rates = requiredRatesAt(ctx, days, isFiniteNumber(targetMarginPct) ? [targetMarginPct] : [], { tierOverride: tier });
    const evaluation = evaluateAt(ctx, days, listRate, { tierOverride: tier });
    const netRate = listRate * rates.discountFactor;
    const target = rates.byMargin[0];
    return {
      id: tier.id,
      label: tierLabel(tier),
      fromDays: tier.fromDays,
      toDays: tier.toDays,
      evaluatedDays: days,
      discountPct: tier.discountPct,
      listRate,
      netRate,
      floorNetRate: rates.floorNetRate,
      targetNetRate: target ? target.netRate : null,
      marginPct: evaluation.marginPct,
      profit: evaluation.profit,
      exceedsAvailability: evaluation.exceedsAvailability,
      status: classifyDiscount({ netRate, floorNetRate: rates.floorNetRate, targetNetRate: target ? target.netRate : null }),
    };
  });
}

/**
 * Calcula una cotización completa.
 * @param {object} quote
 * @param {{ settings?: object, listRateOverride?: number|null }} [options]
 */
export function computeQuote(quote = {}, { settings = {}, listRateOverride = null } = {}) {
  const issues = validateQuote(quote);
  const model = buildCostModel(quote);
  // Un valor en otra moneda sin tipo de cambio NO se suma al costo: error en rojo.
  model.currency.gaps.forEach((g) => {
    issues.push({
      path: `${g.list}.${g.index}.${g.field}.currency`,
      message: `Falta el tipo de cambio ${g.currency || ''} de esta cotización: "${g.label}" no se suma al costo hasta cargarlo.`,
      severity: 'error',
    });
  });
  const ctx = createEconomicsContext(quote, model);
  issues.push(...unitIssues(quote, ctx));
  const unitInfo = ctx.unitInfo;
  const texts = unitTexts(unitInfo);
  const byQuantity = ctx.unit === 'quantity' || ctx.unit === 'event';
  const activity = model.activity;
  const D = activity.activeDaysPerMonth;
  const pricing = quote.pricing || {};

  // Impuestos sobre la facturación (t, en puntos): gross-up junto con el margen.
  const t = ctx.billingTaxPct;
  // Margen objetivo: vacío → 0 % (la completitud lo marca). Inválido (≥ 100,
  // negativo, texto) o margen + impuestos ≥ 100 → NO hay tarifa sugerida
  // (antes se usaba 0 % en silencio y la "sugerida" quedaba igual a la piso).
  const marginStatus = readMarginInput(pricing.targetMarginPct).state;
  const targetMarginPct = readMargin(pricing.targetMarginPct, 0);
  const targetMarginInvalid = marginStatus === 'invalid' || !isValidMarginAndTaxes(targetMarginPct, t);
  const customMarginRaw = readMargin(pricing.customMarginPct, null);
  const customMarginPct = customMarginRaw !== null && customMarginRaw > 0 && isValidMarginAndTaxes(customMarginRaw, t) ? customMarginRaw : null;
  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const margins = unique([...ladder, ...(targetMarginInvalid ? [] : [targetMarginPct]), ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginAndTaxes(m, t)));

  // Tarifas necesarias con la actividad estimada
  const ratesAtEstimate = requiredRatesAt(ctx, D, margins);
  const byMargin = (m) => ratesAtEstimate.byMargin.find((r) => r.marginPct === m) || { netRate: null, listRate: null, requiredRevenue: null };
  const targetRates = targetMarginInvalid ? { netRate: null, listRate: null, requiredRevenue: null } : byMargin(targetMarginPct);
  const roundingStep = nonNegative(pricing.roundingStep);
  const suggestedListRate = commercialRound(targetRates.listRate, roundingStep);

  // Tarifa comercial (de lista) ofrecida
  let commercialListRate = null;
  let commercialSource = 'none';
  if (listRateOverride !== null && listRateOverride !== undefined && isFiniteNumber(listRateOverride)) {
    commercialListRate = nonNegative(listRateOverride);
    commercialSource = 'override';
  } else if (quote.pricingMode === 'known_rate') {
    commercialListRate = nonNegative(pricing.knownRate) > 0 ? nonNegative(pricing.knownRate) : null;
    commercialSource = 'known_rate';
  } else if (nonNegative(pricing.offeredRateOverride) > 0) {
    commercialListRate = nonNegative(pricing.offeredRateOverride);
    commercialSource = 'offered';
  } else if (isFiniteNumber(suggestedListRate)) {
    commercialListRate = suggestedListRate;
    commercialSource = 'suggested';
  }

  const hasRate = isFiniteNumber(commercialListRate) && commercialListRate > 0;
  const estimate = evaluateAt(ctx, D, hasRate ? commercialListRate : 0);
  const maxDays = activity.availableDaysPerMonth;

  // Break-even y días para margen objetivo
  let breakEven;
  let targetMarginDays;
  if (ctx.unit === 'month') {
    const reason = 'Con abono mensual la facturación no depende de los días activos: no hay break-even en días.';
    breakEven = { reachable: false, days: null, wholeDays: null, notApplicable: true, reason };
    targetMarginDays = { reachable: false, days: null, wholeDays: null, notApplicable: true, reason };
  } else if (!hasRate) {
    const reason = 'Sin tarifa definida no se puede calcular el break-even.';
    breakEven = { reachable: false, days: null, wholeDays: null, reason };
    targetMarginDays = { reachable: false, days: null, wholeDays: null, reason };
  } else {
    // Con "cada salida completa" el costo salta al empezar cada salida: se evalúa en cada salto.
    const breakpoints = activationBreakpoints(model, maxDays);
    breakEven = findBreakEvenDays((d) => evaluateAt(ctx, d, commercialListRate).profit, { maxDays, breakpoints });
    targetMarginDays = targetMarginInvalid
      ? { reachable: false, days: null, wholeDays: null, reason: 'El margen objetivo no es válido (o margen + impuestos sobre la facturación llega a 100 %).' }
      : findBreakEvenDays((d) => {
        const e = evaluateAt(ctx, d, commercialListRate);
        return e.profit - (targetMarginPct / 100) * e.revenue.total;
      }, { maxDays, breakpoints });
    // Cantidad de equilibrio en la unidad comercial (m³, viajes, días…): la
    // que se factura con esos días de trabajo (PLAN-2026-009).
    breakEven = withQuantity(ctx, breakEven);
    targetMarginDays = withQuantity(ctx, targetMarginDays);
    // Equilibrio en 0 (PLAN-2026-012): sin costos fijos, cada unidad vendida ya
    // cubre su costo variable; con fijos, los cubren los ingresos fijos.
    if (breakEven.reachable && isFiniteNumber(breakEven.days) && breakEven.days <= 1e-9) {
      breakEven = { ...breakEven, zeroReason: model.fixedMonthly > 0.005 ? 'fixed_revenue' : 'no_fixed_costs' };
    }
  }
  // La traza del break-even se arma en el punto de equilibrio (allí rige el
  // tramo de descuento que realmente aplica); si no se alcanza, con la
  // actividad estimada.
  const linearReferenceDays = breakEven.reachable && breakEven.days > 0 ? Math.max(breakEven.days, 1) : D > 0 ? D : 1;
  const linear = linearDecomposition(ctx, hasRate ? commercialListRate : 0, linearReferenceDays);
  // Igual para los días del margen objetivo: en SU punto (puede caer en otro tramo).
  const linearTarget = targetMarginDays.reachable && targetMarginDays.days > 0
    ? linearDecomposition(ctx, hasRate ? commercialListRate : 0, Math.max(targetMarginDays.days, 1))
    : linear;

  // Estructura de costos, matriz, descuentos, completitud
  const eecc = costStructure(model, D);
  // La matriz siempre incluye el margen objetivo (aunque no esté en la escalera).
  const matrixMargins = unique([...ladder, ...(targetMarginInvalid ? [] : [targetMarginPct]), ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginAndTaxes(m, t) && m > 0));
  const matrix = buildRateUtilizationMatrix(ctx, {
    days: matrixDays(Array.isArray(settings.matrixDays) && settings.matrixDays.length ? settings.matrixDays : [...DEFAULT_MATRIX_DAYS], D),
    marginsPct: matrixMargins,
    commercialListRate: hasRate ? commercialListRate : null,
    estimatedDays: D,
  });
  const discounts = evaluateDiscountTiers(ctx, hasRate ? commercialListRate : null, targetMarginInvalid ? null : targetMarginPct);
  const completeness = evaluateCompleteness(quote);

  // Continuidad: efecto del descuento por permanencia con la actividad estimada
  const continuity = {
    applies: continuityApplies(quote.rules || {}, quote.contractMonths),
    discountPct: normalizeRules(quote.rules || {}).continuityDiscountPct,
    minMonths: normalizeRules(quote.rules || {}).continuityMinMonths,
    contractMonths: nonNegative(quote.contractMonths),
  };
  if (continuity.applies && hasRate) {
    continuity.status = classifyDiscount({
      netRate: estimate.revenue.netRate,
      floorNetRate: ratesAtEstimate.floorNetRate,
      targetNetRate: targetRates.netRate,
    });
  }

  // Indicadores derivados
  const costAt = costAtActivity(model, D);
  const factor = monthsFactor(D, activity.availableDaysPerMonth);
  // Salidas estimadas vs costeadas (PLAN-2026-011). Apagado: ajuste 0 y todo como siempre.
  const rounding = activationRoundingAt(model, D);
  const roundingPreview = rounding.enabled ? rounding : activationRoundingAt(model, D, { force: true });
  const roundingOn = rounding.enabled && rounding.total > 0;
  let workingCapital = model.finance.workingCapitalFixed * factor + model.finance.workingCapitalPerActiveDay * D;
  if (roundingOn) workingCapital += rounding.workingCapital;
  const financialCost = costAt.byCategory.financial;
  // Viajes = movilización de los equipos + logística auxiliar (vehículos, peajes, viáticos).
  let logisticsMonthly = (model.logistics.perActiveDay + model.mobilization.perActiveDay) * D;
  if (roundingOn) logisticsMonthly += (rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0);
  // Externos (PLAN-2026-005): costo económico vs salida de caja vs crédito fiscal del mes.
  const externalMonthly = model.external.reduce((acc, x) => {
    acc.economic += (x.fixedMonthly * factor) + (x.variablePerActiveDay + x.mobilizationPerActiveDay) * D;
    acc.cash += (x.cashFixedMonthly * factor) + x.cashPerActiveDay * D;
    acc.credit += (x.creditFixedMonthly * factor) + x.creditPerActiveDay * D;
    return acc;
  }, { economic: 0, cash: 0, credit: 0 });
  if (roundingOn && rounding.bySource.external) {
    // Lo que se le paga de más al proveedor por las salidas completas (costo y caja):
    // sólo su tarifa y su movilización. El combustible no incluido en la tarifa va a
    // "Combustible", igual que arriba (Test Lab LAB-F1, PLAN-2026-013).
    const extLines = model.lines.filter((l) => l.source === 'external' && l.category === 'external');
    const extEconomic = extLines.reduce((acc, l) => acc + nonNegative(l.discretePerActivation), 0) * rounding.extraActivations;
    const extCash = extLines.reduce((acc, l) => acc + nonNegative(l.cashDiscretePerActivation), 0) * rounding.extraActivations;
    externalMonthly.economic += extEconomic;
    externalMonthly.cash += extCash;
    externalMonthly.credit += Math.max(0, extCash - extEconomic);
  }
  const commercialNetRate = estimate.revenue.netRate;
  const hoursPerDay = activity.hoursPerActiveDay;

  const kpis = {
    activeDays: D,
    utilizationPct: activity.utilizationPct,
    totalCost: costAt.total,
    fixedCosts: costAt.fixed,
    variableCosts: costAt.variable,
    costPerActiveDay: costAt.perActiveDay,
    floorNetRate: ratesAtEstimate.floorNetRate,
    floorListRate: ratesAtEstimate.floorListRate,
    targetMarginPct: targetMarginInvalid ? null : targetMarginPct,
    targetMarginInvalid,
    // Markup (recargo sobre el costo, AGENTS.md §9) que implica el margen objetivo: (m + t) / (1 − m − t).
    targetMarkupPct: targetMarginInvalid ? null : markupWithTaxesPct(targetMarginPct, t),
    // Ganancia sobre el costo que implica el margen objetivo: m / (1 − m − t).
    targetProfitOnCostPct: targetMarginInvalid ? null : profitOnCostPct(targetMarginPct, t),
    billingTaxPct: t,
    billingTaxesDefined: ctx.billingTaxInfo.defined,
    billingTaxesInvalid: ctx.billingTaxInfo.invalid,
    billingTaxes: estimate.billingTaxes,
    targetNetRate: targetRates.netRate,
    targetListRate: targetRates.listRate,
    suggestedListRate,
    commercialListRate: hasRate ? commercialListRate : null,
    commercialNetRate: hasRate ? commercialNetRate : null,
    commercialSource: hasRate ? commercialSource : 'none',
    revenue: estimate.revenue.total,
    profit: estimate.profit,
    // Sin tarifa comercial no hay margen de la cotización (sólo otros ingresos).
    marginPct: hasRate ? estimate.marginPct : null,
    markupPct: hasRate ? estimate.markupPct : null,
    profitOnCostPct: hasRate ? estimate.profitOnCostPct : null,
    breakEvenDays: breakEven.days,
    breakEvenWholeDays: breakEven.wholeDays,
    targetMarginDays: targetMarginDays.days,
    targetMarginWholeDays: targetMarginDays.wholeDays,
    // Unidad comercial (PLAN-2026-009): cantidad facturable del mes y de equilibrio.
    unitId: unitInfo.id,
    unitKind: unitInfo.kind,
    billableQuantity: estimate.revenue.billableUnits,
    breakEvenQuantity: isFiniteNumber(breakEven.quantity) ? breakEven.quantity : null,
    breakEvenWholeQuantity: isFiniteNumber(breakEven.wholeQuantity) ? breakEven.wholeQuantity : null,
    // 'no_fixed_costs' | 'fixed_revenue' cuando el equilibrio es 0 (PLAN-2026-012).
    breakEvenZeroReason: breakEven.zeroReason || null,
    targetMarginQuantity: isFiniteNumber(targetMarginDays.quantity) ? targetMarginDays.quantity : null,
    completenessPct: completeness.scorePct,
    financialCost,
    financialMarginImpactPct: estimate.revenue.total > 0 ? (financialCost / estimate.revenue.total) * 100 : null,
    workingCapital,
    logisticsMonthly,
    logisticsIncidencePct: costAt.total > 0 ? (logisticsMonthly / costAt.total) * 100 : null,
    externalMonthly: externalMonthly.economic,
    externalCashMonthly: externalMonthly.cash,
    externalTaxCreditMonthly: externalMonthly.credit,
    // Salidas (PLAN-2026-011): estimadas (promedio) y costeadas (enteras si la opción está activa).
    fullActivations: rounding.enabled,
    activationsEstimated: rounding.estimated,
    activationsCosted: rounding.costed,
    activationRoundingCost: roundingOn ? rounding.total : 0,
    // Tarifa neta debajo de la tarifa piso (que no cuenta el mínimo garantizado).
    belowFloorRate: hasRate && isFiniteNumber(ratesAtEstimate.floorNetRate) ? commercialNetRate < ratesAtEstimate.floorNetRate - 1e-6 : false,
    // "Bajo piso" = la tarifa no cubre el costo Y el mes da pérdida (si un
    // mínimo garantizado cubre la diferencia, no se pierde dinero).
    belowFloor: hasRate && isFiniteNumber(ratesAtEstimate.floorNetRate) ? commercialNetRate < ratesAtEstimate.floorNetRate - 1e-6 && estimate.profit < 0 : false,
    belowTarget: hasRate && !targetMarginInvalid && isFiniteNumber(estimate.marginPct) ? estimate.marginPct < targetMarginPct - 1e-9 : false,
    incomplete: completeness.scorePct < COMPLETENESS_RISK_THRESHOLD,
    // Precio / costo (κ): cuántas veces el costo es la facturación del mes.
    priceToCostMultiplier: costAt.total > 0 && estimate.revenue.total > 0 ? estimate.revenue.total / costAt.total : null,
    // Riesgo: sin tarifa, pierde plata, no llega al margen objetivo, margen
    // inválido o le faltan costos relevantes.
    atRisk:
      !hasRate ||
      targetMarginInvalid ||
      estimate.profit < 0 ||
      (!targetMarginInvalid && isFiniteNumber(estimate.marginPct) && estimate.marginPct < targetMarginPct - 1e-9) ||
      completeness.scorePct < COMPLETENESS_RISK_THRESHOLD,
  };

  // Por cantidad o evento: lo que se factura por la tarifa en un día de trabajo.
  const perWorkDay = byQuantity && hasRate ? safeDivide(estimate.revenue.components.base, D, null) : null;
  const equivalents = hasRate
    ? {
        perHour: ctx.unit === 'day' ? safeDivide(commercialListRate, hoursPerDay, null) : ctx.unit === 'hour' ? commercialListRate : byQuantity ? (isFiniteNumber(perWorkDay) ? safeDivide(perWorkDay, hoursPerDay, null) : null) : null,
        perDay: ctx.unit === 'day' ? commercialListRate : ctx.unit === 'hour' ? commercialListRate * hoursPerDay : byQuantity ? perWorkDay : safeDivide(commercialListRate, D, null),
        perMonth: estimate.revenue.total,
      }
    : { perHour: null, perDay: null, perMonth: null };

  // Rótulo de la unidad: "día", "hora", "mes" (como siempre), "m³", "viaje", "pozo"…
  const unitLabel = unitInfo.short || 'día';

  const traces = {
    totalCost: traceTotalCost(model, D),
    breakEven: traceBreakEven({
      fixedCosts: linear.fixedCosts,
      fixedRevenue: linear.fixedRevenue,
      ratePerDay: linear.netRatePerActiveDay,
      otherRevenuePerDay: linear.otherRevenuePerActiveDay,
      variableCostPerDay: linear.variableCostPerDay,
      contributionPerDay: linear.contributionPerDay,
      result: breakEven,
      unitLabel,
      nonLinear: linear.hasNonLinearRules,
      billingTaxPct: t,
      quantityUnit: byQuantity ? { plural: unitInfo.plural, singular: unitInfo.singular, label: texts.breakEvenLabel, perDay: linear.unitsPerActiveDay } : null,
    }),
    // Días para el margen objetivo (antes se armaba en la interfaz): con la
    // descomposición lineal, R(D)·(1 − t − m) − C(D) ≥ 0.
    targetMarginDays: createTrace({
      id: 'target_margin_days',
      title: targetMarginInvalid
        ? `${byQuantity ? `${unitInfo.plural} para lograr` : 'Días para lograr'} el margen objetivo (margen inválido)`
        : `${byQuantity ? `${unitInfo.plural} para lograr` : 'Días para lograr'} el margen objetivo (${formatPercent(targetMarginPct)})`,
      formula: t > 0
        ? 'Días = (Costos fijos − Ingresos fijos × (1 − impuestos − margen)) / (Ingreso por día × (1 − impuestos − margen) − Costo variable por día)'
        : 'Días = (Costos fijos − Ingresos fijos × (1 − margen)) / (Ingreso por día × (1 − margen) − Costo variable por día)',
      inputs: [
        { label: 'Costos fijos mensuales', value: linearTarget.fixedCosts, format: 'money' },
        { label: 'Ingresos fijos (abono de disponibilidad, equipo en espera)', value: linearTarget.fixedRevenue, format: 'money' },
        { label: 'Ingreso por día activo', value: linearTarget.revenuePerActiveDay, format: 'money' },
        { label: 'Costo variable por día activo', value: linearTarget.variableCostPerDay, format: 'money' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
        { label: 'Margen objetivo', value: targetMarginInvalid ? null : targetMarginPct, format: 'percent' },
      ],
      steps: [{
        label: t > 0 ? 'Ingreso por día después de impuestos y de reservar el margen − costo variable' : 'Ingreso por día después de reservar el margen − costo variable',
        value: !targetMarginInvalid && hasRate && isFiniteNumber(linearTarget.revenuePerActiveDay) ? linearTarget.revenuePerActiveDay * (1 - (t + targetMarginPct) / 100) - linearTarget.variableCostPerDay : null,
        format: 'money',
      }],
      result: byQuantity
        ? { label: `${unitInfo.plural} por mes para lograr el margen`, value: targetMarginDays.reachable ? targetMarginDays.quantity : null, format: 'number' }
        : { label: 'Días activos para lograr el margen', value: targetMarginDays.reachable ? targetMarginDays.days : null, format: 'days' },
      notes: [
        byQuantity && targetMarginDays.reachable ? `Son ${formatDays(targetMarginDays.days, { decimals: 1 })} de trabajo: los costos se calculan con esos días y la facturación, con ${texts.los} ${unitInfo.plural}.` : null,
        !targetMarginDays.reachable ? targetMarginDays.reason : null,
        linearTarget.hasNonLinearRules ? 'Hay reglas no lineales (mínimo garantizado, mínimo por llamado, tramos de descuento o cada salida contada completa): el resultado se calcula día a día.' : null,
      ],
    }),
    floorRate: createTrace({
      id: 'floor_rate',
      title: `Tarifa piso (por ${unitLabel})`,
      formula: t > 0
        ? 'Facturación necesaria = Costo total / (1 − impuestos sobre la facturación) · Tarifa piso neta = (Facturación necesaria − Otros ingresos) / Unidades facturables · Tarifa piso de lista = neta / factor de descuentos'
        : 'Tarifa piso neta = (Costo total − Otros ingresos) / Unidades facturables · Tarifa piso de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
        { label: 'Otros ingresos (abono de disponibilidad, equipo en espera, km)', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: `Unidades facturables (${unitInfo.plural})`, value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [
        ...(t > 0 ? [{ label: 'Facturación necesaria (cubre costo e impuestos sobre la facturación)', value: ratesAtEstimate.floorRequiredRevenue, format: 'money' }] : []),
        { label: 'Tarifa piso neta (lo que efectivamente cobrás por unidad)', value: ratesAtEstimate.floorNetRate, format: 'moneyCeil' },
      ],
      result: { label: 'Tarifa piso de lista (la que escribís en la cotización)', value: ratesAtEstimate.floorListRate, format: 'moneyCeil' },
      notes: [
        D <= 0 ? (byQuantity ? `Sin ${unitInfo.plural} por mes no hay tarifa por ${unitInfo.singular} posible: cargá la actividad estimada.` : 'Sin días activos no hay tarifa por día posible: cargá la actividad estimada.') : null,
        ratesAtEstimate.floorCoveredByOtherRevenue ? 'Los otros ingresos ya cubren el costo.' : null,
        !ctx.billingTaxInfo.defined && !ctx.billingTaxInfo.notApplicable && !ctx.billingTaxInfo.invalid ? 'No incluye impuestos sobre lo que facturás (sin definir): cargalos en "El precio".' : null,
        ctx.billingTaxInfo.invalid ? 'No incluye impuestos sobre lo que facturás: hay un porcentaje inválido. Corregilo en "El precio".' : null,
      ],
    }),
    targetRate: createTrace({
      id: 'target_rate',
      title: targetMarginInvalid ? 'Precio objetivo (margen inválido)' : `Precio objetivo (margen ${targetMarginPct} %)`,
      formula: t > 0
        ? 'Tarifa objetivo = (Costo total / (1 − margen − impuestos sobre la facturación) − Otros ingresos) / Unidades facturables · Tarifa de lista = neta / factor de descuentos'
        : 'Tarifa objetivo = (Costo total / (1 − margen) − Otros ingresos) / Unidades facturables · Tarifa de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        { label: 'Margen objetivo (sobre precio, antes del impuesto a las Ganancias)', value: targetMarginInvalid ? null : targetMarginPct, format: 'percent' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
        { label: 'Otros ingresos', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: 'Unidades facturables', value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [
        { label: 'Facturación necesaria', value: targetRates.requiredRevenue, format: 'money' },
        { label: 'Tarifa objetivo neta', value: targetRates.netRate, format: 'moneyCeil' },
        { label: 'Markup equivalente (recargo sobre el costo: precio = costo × (1 + markup))', value: targetMarginInvalid ? null : markupWithTaxesPct(targetMarginPct, t), format: 'percent' },
        ...(t > 0 ? [{ label: 'Ganancia sobre el costo (resultado / costo)', value: targetMarginInvalid ? null : profitOnCostPct(targetMarginPct, t), format: 'percent' }] : []),
      ],
      result: { label: 'Precio objetivo de lista', value: targetRates.listRate, format: 'moneyCeil' },
      notes: [
        roundingStep > 0 ? `Tarifa sugerida: redondeada hacia arriba a múltiplos de ${roundingStep}.` : null,
        targetMarginInvalid ? 'El margen objetivo tiene que ser mayor o igual a 0 y, sumado a los impuestos sobre la facturación, menor a 100 %.' : null,
      ],
    }),
    expectedResult: createTrace({
      id: 'expected_result',
      title: 'Resultado esperado del mes',
      formula: t > 0
        ? 'Resultado = Facturación − Impuestos sobre la facturación − Costo total · Margen = Resultado / Facturación'
        : 'Resultado = Facturación − Costo total · Margen = Resultado / Facturación',
      inputs: [
        { label: 'Tarifa de lista', value: hasRate ? commercialListRate : null, format: 'money' },
        { label: 'Tarifa neta (después de descuentos)', value: hasRate ? commercialNetRate : null, format: 'money' },
        { label: 'Unidades facturables', value: estimate.revenue.billableUnits, format: 'number' },
        { label: 'Facturación por tarifa', value: estimate.revenue.components.base, format: 'money' },
        { label: 'Otros ingresos', value: estimate.revenue.otherRevenue, format: 'money' },
        { label: 'Ajuste por mínimo garantizado', value: estimate.revenue.guaranteeTopUp, format: 'money' },
        { label: 'Costo total', value: costAt.total, format: 'money' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
      ],
      steps: [
        { label: 'Facturación total', value: estimate.revenue.total, format: 'money' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación del mes', value: estimate.billingTaxes, format: 'money' }] : []),
      ],
      result: { label: 'Resultado', value: estimate.profit, format: 'money' },
      notes: [
        hasRate && isFiniteNumber(estimate.marginPct)
          ? `Margen sobre precio (antes del impuesto a las Ganancias): ${formatPercent(estimate.marginPct)}. Markup sobre costo: ${formatPercent(estimate.markupPct)}.${t > 0 ? ` Ganancia sobre el costo: ${formatPercent(estimate.profitOnCostPct)} (el resto del recargo son los impuestos sobre la facturación).` : ''}`
          : null,
        'Todos los montos son sin IVA.',
      ],
    }),
    billingTaxes: traceBillingTaxes(ctx.billingTaxInfo, estimate.revenue.total),
    financialCost: createTrace({
      id: 'financial_cost',
      title: 'Costo financiero',
      formula: 'Costo financiero = Σ costo en efectivo del grupo × tasa mensual × días financiados / 30 · Días financiados = facturación + plazo de cobro − días de pago',
      inputs: [
        { label: 'Plazo de cobro del cliente', value: model.finance.paymentTermDays, format: 'days' },
        { label: 'Días promedio hasta facturar', value: model.finance.invoiceLagDays, format: 'days' },
        { label: 'Tasa mensual', value: model.finance.monthlyRatePct, format: 'percent' },
        ...model.finance.groups.map((g) => ({ label: `${g.label}: días financiados`, value: g.financingDays, format: 'days' })),
        ...(externalMonthly.cash - externalMonthly.economic > 0.005
          ? [{ label: 'Externos: IVA y percepciones que adelantás al proveedor (caja que se financia, no costo)', value: externalMonthly.cash - externalMonthly.economic, format: 'money' }]
          : []),
      ],
      steps: [
        // Proveedores con plazo propio (PLAN-2026-011): cada uno con sus días financiados.
        ...model.finance.suppliers.flatMap((g) => {
          const cash = g.cashFixedMonthly * factor + g.cashVariablePerActiveDay * D + (roundingOn ? rounding.cashByKey[g.key] || 0 : 0);
          const wc = cash * (g.financingDays / 30);
          return [
            { label: `${g.label}: salida de caja del mes (proveedor)`, value: cash, format: 'money' },
            { label: `${g.label}: plazo de pago al proveedor`, value: g.payDays, format: 'days' },
            { label: `${g.label}: días financiados`, value: g.financingDays, format: 'days' },
            { label: `${g.label}: capital de trabajo`, value: wc, format: 'money' },
            { label: `${g.label}: costo financiero asociado`, value: wc * (model.finance.monthlyRatePct / 100), format: 'money' },
          ];
        }),
        { label: 'Capital de trabajo a financiar', value: workingCapital, format: 'money' },
        { label: 'Impacto en margen (puntos)', value: kpis.financialMarginImpactPct, format: 'percent' },
      ],
      result: { label: 'Costo financiero mensual', value: financialCost, format: 'money' },
      notes: [
        model.finance.paymentTermDefined
          ? null
          : 'Falta el plazo de cobro para completar el costo financiero. Mientras tanto RATEOS sólo considera el desfase que ya conoce (los días hasta facturar).',
        'Es una aproximación con interés simple: cada desembolso se financia desde que se paga hasta que cobrás (días hasta facturar + plazo de cobro − días hasta pagar ese costo).',
        'Se financian sólo los desembolsos: la amortización y el costo de capital de los equipos no son salidas de caja (no se financian). La contingencia tampoco.',
        'Equipos y servicios externos: se financia lo que le pagás al proveedor (neto + IVA + percepciones); el IVA recuperable y las percepciones no son costo, pero sí caja que adelantás hasta cobrar.',
        model.finance.suppliers.length
          ? 'Los externos con plazo de pago propio se financian con su plazo (días hasta facturar + plazo de cobro − plazo del proveedor); el resto, con los días de "Proveedores". El costo del externo no cambia.'
          : null,
      ],
    }),
    logistics: createTrace({
      id: 'logistics',
      title: 'Movilización y viajes',
      formula: 'Por llamado = movilización de equipos (km × consumo en ruta × precio + km × desgaste por km) + logística auxiliar (km × consumo × precio + desgaste + peajes + viáticos) · Mensual = por llamado × llamados',
      inputs: [
        { label: 'Distancia base → locación', value: model.logistics.distanceKm, format: 'km' },
        { label: 'Km de ruta por activación', value: model.logistics.routeKmPerActivation, format: 'km' },
        { label: 'Km de equipos que van por sus medios, por activación', value: model.mobilization.kmPerActivation, format: 'km' },
        { label: 'Km de vehículos auxiliares por activación', value: model.logistics.vehicleKmPerActivation, format: 'km' },
        { label: 'Litros por activación (equipos + auxiliares)', value: model.mobilization.litersPerActivation + model.logistics.litersPerActivation, format: 'liters' },
        { label: 'Precio combustible', value: model.fuel.paidByUs ? model.fuel.pricePerLiter : 0, format: 'rate' },
        { label: 'Activaciones por mes', value: activity.activationsPerMonth, format: 'number' },
      ],
      steps: [
        ...model.mobilization.lines.filter((l) => l.mode === 'self' && l.perActivation > 0).map((l) => ({ label: `Movilización de ${l.name || 'equipo'}: ${l.km.toFixed(0)} km`, value: l.perActivation, format: 'money' })),
        { label: 'Movilización de equipos por activación', value: model.mobilization.perActivation, format: 'money' },
        { label: 'Logística auxiliar: combustible por activación', value: model.logistics.fuelPerActivation, format: 'money' },
        { label: 'Logística auxiliar: desgaste, peajes y viáticos por activación', value: model.logistics.nonFuelPerActivation, format: 'money' },
        { label: 'Costo por activación', value: model.logistics.costPerActivation + model.mobilization.perActivation, format: 'money' },
        // Por mes (PLAN-2026-010): equipos principales y logística auxiliar por separado.
        { label: 'Equipos principales: km por mes', value: model.mobilization.kmPerActivation * activity.activationsPerMonth, format: 'km' },
        { label: 'Equipos principales: litros por mes', value: model.mobilization.litersPerActivation * activity.activationsPerMonth, format: 'liters' },
        { label: 'Equipos principales: combustible por mes', value: model.mobilization.fuelPerActivation * activity.activationsPerMonth, format: 'money' },
        { label: 'Equipos principales: desgaste por mes', value: model.mobilization.wearPerActivation * activity.activationsPerMonth, format: 'money' },
        { label: 'Vehículos auxiliares: km por mes', value: model.logistics.vehicleKmPerActivation * activity.activationsPerMonth, format: 'km' },
        { label: 'Vehículos auxiliares: costo por mes', value: model.logistics.costPerActivation * activity.activationsPerMonth, format: 'money' },
        ...(roundingOn && ((rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0)) > 0
          ? [
            { label: 'Salidas estimadas por mes', value: rounding.estimated, format: 'number' },
            { label: 'Salidas costeadas (cada salida completa)', value: rounding.costed, format: 'number' },
            { label: 'Ajuste por salidas completas (movilización y viajes)', value: (rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0), format: 'money' },
          ]
          : []),
      ],
      result: { label: 'Costo mensual de movilización y viajes', value: logisticsMonthly, format: 'money' },
      notes: [
        'En la estructura de costos, el combustible de los traslados se informa en "Combustible" y el resto en "Logística".',
        model.mobilization.lines.some((l) => l.mode === 'self' && l.driver === 'operator') ? 'Los equipos que maneja su operador no suman mano de obra: el operador ya está en Personal.' : null,
        'El desgaste por km de un equipo propio no incluye amortización (ya está en el costo de tenerlo).',
      ],
    }),
  };

  return {
    issues,
    // Salidas estimadas vs costeadas y ajuste (PLAN-2026-011); `preview` = cuánto sumaría si se activa.
    activationRounding: { ...rounding, active: roundingOn, preview: roundingPreview },
    unit: ctx.unit,
    unitLabel,
    unitInfo,
    unitTexts: texts,
    pricingMode: quote.pricingMode,
    activity,
    model,
    ctx,
    estimate,
    ratesAtEstimate,
    targetMarginPct: targetMarginInvalid ? null : targetMarginPct,
    targetMarginInvalid,
    billingTaxPct: t,
    billingTaxInfo: ctx.billingTaxInfo,
    customMarginPct,
    breakEven,
    targetMarginDays,
    linear,
    eecc,
    matrix,
    discounts,
    continuity,
    completeness,
    // Base económica de la oferta (PLAN-2026-005): "¿con qué costo, moneda y fecha base se calculó?".
    economicBase: summarizeEconomicBase(quote),
    equivalents,
    kpis,
    traces,
  };
}

/** Indicadores compactos para dashboard y listados (sin trazas). */
export function summarizeQuote(quote, options = {}) {
  const r = computeQuote(quote, options);
  return { ...r.kpis, issuesCount: r.issues.length };
}
