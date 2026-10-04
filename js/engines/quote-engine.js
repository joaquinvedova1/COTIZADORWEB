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
import { nonNegative, toNumber, safeDivide, isFiniteNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { formatPercent } from '../core/format.js';
import { validateQuote } from '../core/validation.js';
import { buildCostModel, costStructure, costAtActivity, traceTotalCost, monthsFactor } from './cost-engine.js';
import { createEconomicsContext, evaluateAt, requiredRatesAt, linearDecomposition } from './economics-engine.js';
import { findBreakEvenDays, traceBreakEven } from './break-even-engine.js';
import { buildRateUtilizationMatrix, matrixDays } from './utilization-engine.js';
import { classifyDiscount, normalizeRules, tierLabel, continuityApplies } from './commercial-rules-engine.js';
import { isValidMarginPct, commercialRound, marginToMarkup } from './pricing-engine.js';
import { evaluateCompleteness, COMPLETENESS_RISK_THRESHOLD } from './completeness-engine.js';

function readMargin(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = toNumber(value, NaN);
  return isValidMarginPct(n) ? n : fallback;
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

/** Evalúa cada tramo de descuento por cantidad de días (peor caso del tramo). */
export function evaluateDiscountTiers(ctx, listRate, targetMarginPct) {
  if (ctx.unit === 'month' || !isFiniteNumber(listRate)) return [];
  const rules = normalizeRules(ctx.rules);
  return rules.volumeTiers.map((tier) => {
    // Peor caso: la menor actividad que ya cae en el tramo (con minimum call,
    // menos días activos que los días facturables del tramo).
    const days = Math.max(minActiveDaysForBillableDays(ctx, Math.max(tier.fromDays, 1)), 1e-6);
    const rates = requiredRatesAt(ctx, days, [targetMarginPct], { tierOverride: tier });
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
  const ctx = createEconomicsContext(quote, model);
  const activity = model.activity;
  const D = activity.activeDaysPerMonth;
  const pricing = quote.pricing || {};

  const targetMarginPct = readMargin(pricing.targetMarginPct, 0);
  const customMarginRaw = readMargin(pricing.customMarginPct, null);
  const customMarginPct = customMarginRaw !== null && customMarginRaw > 0 ? customMarginRaw : null;
  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const margins = unique([...ladder, targetMarginPct, ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginPct(m)));

  // Tarifas necesarias con la actividad estimada
  const ratesAtEstimate = requiredRatesAt(ctx, D, margins);
  const byMargin = (m) => ratesAtEstimate.byMargin.find((r) => r.marginPct === m) || { netRate: null, listRate: null };
  const targetRates = byMargin(targetMarginPct);
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
    breakEven = findBreakEvenDays((d) => evaluateAt(ctx, d, commercialListRate).profit, { maxDays });
    targetMarginDays = findBreakEvenDays((d) => {
      const e = evaluateAt(ctx, d, commercialListRate);
      return e.profit - (targetMarginPct / 100) * e.revenue.total;
    }, { maxDays });
  }
  // La traza del break-even se arma en el punto de equilibrio (allí rige el
  // tramo de descuento que realmente aplica); si no se alcanza, con la
  // actividad estimada.
  const linearReferenceDays = breakEven.reachable && breakEven.days > 0 ? Math.max(breakEven.days, 1) : D > 0 ? D : 1;
  const linear = linearDecomposition(ctx, hasRate ? commercialListRate : 0, linearReferenceDays);

  // Estructura de costos, matriz, descuentos, completitud
  const eecc = costStructure(model, D);
  // La matriz siempre incluye el margen objetivo (aunque no esté en la escalera).
  const matrixMargins = unique([...ladder, targetMarginPct, ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginPct(m) && m > 0));
  const matrix = buildRateUtilizationMatrix(ctx, {
    days: matrixDays(Array.isArray(settings.matrixDays) && settings.matrixDays.length ? settings.matrixDays : [...DEFAULT_MATRIX_DAYS], D),
    marginsPct: matrixMargins,
    commercialListRate: hasRate ? commercialListRate : null,
    estimatedDays: D,
  });
  const discounts = evaluateDiscountTiers(ctx, hasRate ? commercialListRate : null, targetMarginPct);
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
  const workingCapital = model.finance.workingCapitalFixed * factor + model.finance.workingCapitalPerActiveDay * D;
  const financialCost = costAt.byCategory.financial;
  const logisticsMonthly = model.logistics.perActiveDay * D;
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
    targetMarginPct,
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
    breakEvenDays: breakEven.days,
    breakEvenWholeDays: breakEven.wholeDays,
    targetMarginDays: targetMarginDays.days,
    targetMarginWholeDays: targetMarginDays.wholeDays,
    completenessPct: completeness.scorePct,
    financialCost,
    financialMarginImpactPct: estimate.revenue.total > 0 ? (financialCost / estimate.revenue.total) * 100 : null,
    workingCapital,
    logisticsMonthly,
    logisticsIncidencePct: costAt.total > 0 ? (logisticsMonthly / costAt.total) * 100 : null,
    // Tarifa neta debajo de la tarifa piso (que no cuenta el mínimo garantizado).
    belowFloorRate: hasRate && isFiniteNumber(ratesAtEstimate.floorNetRate) ? commercialNetRate < ratesAtEstimate.floorNetRate - 1e-6 : false,
    // "Bajo piso" = la tarifa no cubre el costo Y el mes da pérdida (si un
    // mínimo garantizado cubre la diferencia, no se pierde dinero).
    belowFloor: hasRate && isFiniteNumber(ratesAtEstimate.floorNetRate) ? commercialNetRate < ratesAtEstimate.floorNetRate - 1e-6 && estimate.profit < 0 : false,
    belowTarget: hasRate && isFiniteNumber(estimate.marginPct) ? estimate.marginPct < targetMarginPct - 1e-9 : false,
    incomplete: completeness.scorePct < COMPLETENESS_RISK_THRESHOLD,
    // Riesgo: sin tarifa, pierde dinero, no llega al margen objetivo o le faltan costos relevantes.
    atRisk:
      !hasRate ||
      estimate.profit < 0 ||
      (isFiniteNumber(estimate.marginPct) && estimate.marginPct < targetMarginPct - 1e-9) ||
      completeness.scorePct < COMPLETENESS_RISK_THRESHOLD,
  };

  const equivalents = hasRate
    ? {
        perHour: ctx.unit === 'day' ? safeDivide(commercialListRate, hoursPerDay, null) : ctx.unit === 'hour' ? commercialListRate : null,
        perDay: ctx.unit === 'day' ? commercialListRate : ctx.unit === 'hour' ? commercialListRate * hoursPerDay : safeDivide(commercialListRate, D, null),
        perMonth: estimate.revenue.total,
      }
    : { perHour: null, perDay: null, perMonth: null };

  const unitLabel = ctx.unit === 'hour' ? 'hora' : ctx.unit === 'month' ? 'mes' : 'día';

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
    }),
    floorRate: createTrace({
      id: 'floor_rate',
      title: `Tarifa piso (por ${unitLabel})`,
      formula: 'Tarifa piso neta = (Costo total − Otros ingresos) / Unidades facturables · Tarifa piso de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        { label: 'Otros ingresos (fees, standby, km)', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: `Unidades facturables (${unitLabel}s)`, value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [{ label: 'Tarifa piso neta (lo que efectivamente cobrás por unidad)', value: ratesAtEstimate.floorNetRate, format: 'moneyCeil' }],
      result: { label: 'Tarifa piso de lista (la que escribís en la cotización)', value: ratesAtEstimate.floorListRate, format: 'moneyCeil' },
      notes: [
        D <= 0 ? 'Sin días activos no hay tarifa por día posible: cargá la actividad estimada.' : null,
        ratesAtEstimate.floorCoveredByOtherRevenue ? 'Los otros ingresos ya cubren el costo.' : null,
      ],
    }),
    targetRate: createTrace({
      id: 'target_rate',
      title: `Precio objetivo (margen ${targetMarginPct} %)`,
      formula: 'Tarifa objetivo = (Costo total / (1 − margen) − Otros ingresos) / Unidades facturables · Tarifa de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        { label: 'Margen objetivo (sobre precio)', value: targetMarginPct, format: 'percent' },
        { label: 'Otros ingresos', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: 'Unidades facturables', value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [
        { label: 'Facturación necesaria', value: isValidMarginPct(targetMarginPct) ? ratesAtEstimate.totalCost / (1 - targetMarginPct / 100) : null, format: 'money' },
        { label: 'Tarifa objetivo neta', value: targetRates.netRate, format: 'moneyCeil' },
        { label: 'Markup equivalente', value: marginToMarkup(targetMarginPct), format: 'percent' },
      ],
      result: { label: 'Precio objetivo de lista', value: targetRates.listRate, format: 'moneyCeil' },
      notes: [roundingStep > 0 ? `Tarifa sugerida: redondeada hacia arriba a múltiplos de ${roundingStep}.` : null],
    }),
    expectedResult: createTrace({
      id: 'expected_result',
      title: 'Resultado esperado del mes',
      formula: 'Resultado = Facturación − Costo total · Margen = Resultado / Facturación',
      inputs: [
        { label: 'Tarifa de lista', value: hasRate ? commercialListRate : null, format: 'money' },
        { label: 'Tarifa neta (después de descuentos)', value: hasRate ? commercialNetRate : null, format: 'money' },
        { label: 'Unidades facturables', value: estimate.revenue.billableUnits, format: 'number' },
        { label: 'Facturación por tarifa', value: estimate.revenue.components.base, format: 'money' },
        { label: 'Otros ingresos', value: estimate.revenue.otherRevenue, format: 'money' },
        { label: 'Ajuste por mínimo garantizado', value: estimate.revenue.guaranteeTopUp, format: 'money' },
        { label: 'Costo total', value: costAt.total, format: 'money' },
      ],
      steps: [{ label: 'Facturación total', value: estimate.revenue.total, format: 'money' }],
      result: { label: 'Resultado', value: estimate.profit, format: 'money' },
      notes: [hasRate && isFiniteNumber(estimate.marginPct) ? `Margen sobre precio: ${formatPercent(estimate.marginPct)}. Markup sobre costo: ${formatPercent(estimate.markupPct)}.` : null],
    }),
    financialCost: createTrace({
      id: 'financial_cost',
      title: 'Costo financiero',
      formula: 'Costo financiero = Σ costo en efectivo del grupo × tasa mensual × días financiados / 30 · Días financiados = facturación + plazo de cobro − días de pago',
      inputs: [
        { label: 'Plazo de cobro del cliente', value: model.finance.paymentTermDays, format: 'days' },
        { label: 'Días promedio hasta facturar', value: model.finance.invoiceLagDays, format: 'days' },
        { label: 'Tasa mensual', value: model.finance.monthlyRatePct, format: 'percent' },
        ...model.finance.groups.map((g) => ({ label: `${g.label}: días financiados`, value: g.financingDays, format: 'days' })),
      ],
      steps: [
        { label: 'Capital de trabajo a financiar', value: workingCapital, format: 'money' },
        { label: 'Impacto en margen (puntos)', value: kpis.financialMarginImpactPct, format: 'percent' },
      ],
      result: { label: 'Costo financiero mensual', value: financialCost, format: 'money' },
      notes: ['La amortización y el costo de capital de equipos no son salidas de caja: no se financian. La contingencia tampoco.'],
    }),
    logistics: createTrace({
      id: 'logistics',
      title: 'Logística',
      formula: 'Costo por activación = combustible (km × consumo × precio) + desgaste por km + peajes + viáticos · Mensual = costo por activación × activaciones',
      inputs: [
        { label: 'Distancia base → locación', value: model.logistics.distanceKm, format: 'km' },
        { label: 'Km de ruta por activación', value: model.logistics.routeKmPerActivation, format: 'km' },
        { label: 'Km totales de vehículos por activación', value: model.logistics.vehicleKmPerActivation, format: 'km' },
        { label: 'Litros por activación', value: model.logistics.litersPerActivation, format: 'liters' },
        { label: 'Precio combustible', value: model.fuel.paidByUs ? model.fuel.pricePerLiter : 0, format: 'rate' },
        { label: 'Activaciones por mes', value: activity.activationsPerMonth, format: 'number' },
      ],
      steps: [
        { label: 'Combustible por activación', value: model.logistics.fuelPerActivation, format: 'money' },
        { label: 'Desgaste, peajes y viáticos por activación', value: model.logistics.nonFuelPerActivation, format: 'money' },
        { label: 'Costo por activación', value: model.logistics.costPerActivation, format: 'money' },
      ],
      result: { label: 'Costo logístico mensual', value: logisticsMonthly, format: 'money' },
      notes: ['En la estructura de costos, el combustible de traslados se informa en "Combustible" y el resto en "Logística".'],
    }),
  };

  return {
    issues,
    unit: ctx.unit,
    unitLabel,
    pricingMode: quote.pricingMode,
    activity,
    model,
    ctx,
    estimate,
    ratesAtEstimate,
    targetMarginPct,
    customMarginPct,
    breakEven,
    targetMarginDays,
    linear,
    eecc,
    matrix,
    discounts,
    continuity,
    completeness,
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
