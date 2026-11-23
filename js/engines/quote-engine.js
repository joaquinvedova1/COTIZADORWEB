/**
 * QuoteEngine — orquesta todos los motores para una cotización.
 *
 * Función pura: mismos inputs → mismos outputs. No accede a DOM ni a storage.
 *
 * Conceptos:
 *   COSTO            lo que cuesta prestar el servicio en el mes
 *   TARIFA MÍNIMA      tarifa neta que iguala costo (margen 0)
 *   PRECIO OBJETIVO  tarifa para lograr el margen objetivo
 *   PRECIO COMERCIAL tarifa de lista finalmente ofrecida
 */

import { computeContractedStaff } from './contracted-staff-engine.js';
import { DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../config.js';
import { nonNegative, safeDivide, isFiniteNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { formatPercent, formatDays, formatNumber, formatMoney } from '../core/format.js';
import { validateQuote } from '../core/validation.js';
import { buildCostModel, normalizeActivity, costStructure, componentCostSplitAt, costAtActivity, traceTotalCost, monthsFactor, activationRoundingAt, activationBreakpoints } from './cost-engine.js';
import { hasOutOfHours, isOutOfHoursExtra, normalHourEquivalent, resourceNormalHourCost, MAN_HOUR_UNIT } from './out-of-hours-engine.js';
import { createEconomicsContext, evaluateAt, requiredRatesAt, linearDecomposition, revenueAt, grossUpPctOf } from './economics-engine.js';
import { withCompanyVatCondition } from '../domain/vat-finance.js';
import { findBreakEvenDays, findLossWindows, traceBreakEven } from './break-even-engine.js';
import { buildRateUtilizationMatrix, matrixDays } from './utilization-engine.js';
import { classifyDiscount, normalizeRules, tierLabel, continuityApplies, unitHasDayTiers } from './commercial-rules-engine.js';
import { isValidMarginPct, isValidMarginAndTaxes, suggestedRateRound, effectiveRoundingStep, markupWithTaxesPct, profitOnCostPct, readMarginInput } from './pricing-engine.js';
import { evaluateCompleteness, activationRoundingNotice, fixedCostsAbsorbedNotice, idleCapacityNotice, COMPLETENESS_RISK_THRESHOLD } from './completeness-engine.js';
import { activationTerms } from '../domain/activation-terms.js';
import { routeTrips } from './transport-engine.js';
import { traceBillingTaxes } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { rateUpdateState, proposeLaborRaisePct } from './rate-update-engine.js';
import { usesTimeBasis, resolveUnitHours } from '../domain/cost-basis.js';
import { assignedEquipmentHours } from './equipment-engine.js';
import { periodFromDate } from '../domain/economic-base.js';
import { contractOf, contractUnits, modeForUnit } from '../domain/contract.js';
import { unitTexts, unitFitsServiceType, SERVICE_TYPE_UNITS, BILLING_UNITS, capitalizeUnitWord } from '../domain/billing-units.js';
import { SERVICE_TYPES, QUOTE_STEPS, labelOf } from '../domain/catalogs.js';

/** Margen leído como lo valida validateQuote (texto es-AR incluido); `fallback` si está vacío o es inválido. */
function readMargin(value, fallback) {
  const r = readMarginInput(value);
  return r.state === 'ok' ? r.value : fallback;
}

function unique(values) {
  return [...new Set(values)];
}

/**
 * Aviso del mínimo garantizado en UNIDADES por encima de la estimación cuando la tarifa es la
 * sugerida (revisión de costos de la tanda B, B-3). La sugerida se calcula SIN el mínimo
 * (criterio conservador, §13), pero el mínimo en unidades se valoriza con esa misma tarifa:
 * con menos unidades estimadas que las garantizadas el margen del mes queda muy por encima del
 * objetivo (24 h C2 con 10 días y mínimo 20: sugerida 7.242.000 por día y margen 55 % en vez de
 * 15 %). No cambia ningún número: informa el margen con el mínimo, la tarifa que da el margen
 * objetivo si el cliente paga el mínimo (requerido − otros ingresos) ÷ unidades garantizadas, y
 * el margen con esa tarifa si se trabajan todas las unidades garantizadas.
 * @returns {object|null} aviso informativo (`guarantee_above_estimate`) o null
 */
export function guaranteeAboveEstimateNotice({ ctx, D, estimate, commercialSource, targetRates, targetMarginPct, roundingStep, maxDays }) {
  const rev = estimate && estimate.revenue;
  if (commercialSource !== 'suggested' || !rev || rev.guaranteeBasis !== 'units') return null;
  if (!(rev.guaranteeUnitsShortfall > 1e-9) || !(rev.guaranteedUnits > 0) || !(D > 0)) return null;
  if (!targetRates || !isFiniteNumber(targetRates.requiredRevenue) || !isFiniteNumber(targetRates.listRate)) return null;
  const factor = rev.listRate > 0 ? safeDivide(rev.netRate, rev.listRate, null) : null;
  if (!(factor > 0)) return null;
  const remaining = targetRates.requiredRevenue - nonNegative(rev.otherRevenue);
  if (!(remaining > 0)) return null;
  const listWithMinimum = suggestedRateRound(remaining / rev.guaranteedUnits / factor, roundingStep);
  if (!isFiniteNumber(listWithMinimum)) return null;
  // Días con los que se trabajan todas las unidades garantizadas (desde ahí el mínimo ya no completa nada).
  let lo = D;
  let hi = nonNegative(maxDays);
  let coverDays = null;
  if (hi > lo && revenueAt(ctx, hi, 0).guaranteeUnitsShortfall <= 1e-9) {
    for (let i = 0; i < 80 && hi - lo > 1e-9; i += 1) {
      const mid = (lo + hi) / 2;
      if (revenueAt(ctx, mid, 0).guaranteeUnitsShortfall <= 1e-9) hi = mid;
      else lo = mid;
    }
    coverDays = hi;
  }
  const atCover = coverDays !== null ? evaluateAt(ctx, coverDays, listWithMinimum) : null;
  const u = ctx.unitInfo || {};
  const plural = u.plural || 'unidades';
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  const estUnits = nonNegative(rev.billableUnits);
  return {
    id: 'guarantee_above_estimate',
    step: 'margin',
    severity: 'info',
    label: 'El mínimo supera tu estimación',
    message: `Estimaste ${n(estUnits)} ${plural} y el mínimo garantizado es de ${n(rev.guaranteedUnits)} ${plural}: a la tarifa sugerida (${formatMoney(rev.listRate)}, calculada sin el mínimo) el mes factura el mínimo y el margen estimado da ${formatPercent(estimate.marginPct)}, no el ${formatPercent(targetMarginPct)} objetivo. Si el cliente paga el mínimo, con ${formatMoney(listWithMinimum)} ya llegás al ${formatPercent(targetMarginPct)}${atCover ? `; pero con esa tarifa, si trabajás todo el mínimo (${n(rev.guaranteedUnits)} ${plural}${ctx.unit === 'day' ? '' : ` en ${formatDays(coverDays)} de trabajo`}), el margen baja a ${formatPercent(atCover.marginPct)}` : ''}. RATEOS no cambia la sugerida: elegí la tarifa en "Tarifa ofrecida".`,
    focus: 'pricing.offeredRateOverride',
    listRateWithMinimum: listWithMinimum,
    marginAtEstimatePct: estimate.marginPct,
    marginAtGuaranteeWorkedPct: atCover ? atCover.marginPct : null,
    guaranteeWorkedDays: coverDays,
  };
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
  // Tramo por días trabajados: el peor caso del tramo es su primer día trabajado.
  if (normalizeRules(ctx.rules).volumeTierBasis === 'worked') return bd;
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
 * Abono mensual (unidad mes): la facturación es fija y cada día de trabajo suma
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
/** Personas o equipos (u horas de equipo) por día que se costean, para comparar con lo facturado. */
function resourcesPerDayCheck(quote, unitId, a) {
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  if (unitId === 'manday') {
    // Con el personal tercerizado que se paga por día o por hora (0.15.0): también hace jornales.
    const people = (Array.isArray(quote.labor) ? quote.labor : []).reduce((t, l) => t + Math.max(0, num(l && l.positions, 1)), 0)
      + (Array.isArray(quote.contractedStaff) ? quote.contractedStaff : []).reduce((t, c) => t + (c && typeof c === 'object' && c.unit !== 'month' ? Math.max(0, num(c.people, 0)) : 0), 0);
    return people > 0 ? { loaded: people, detail: `${formatNumber(people, { decimals: 2 })} personas en Personal`, where: 'los puestos en Personal' } : null;
  }
  if (unitId === 'equipment_day' || unitId === 'equipment_hour') {
    const lines = (Array.isArray(quote.equipment) ? quote.equipment : []).filter((e) => e && typeof e === 'object');
    if (!lines.length) return null;
    const count = lines.reduce((t, e) => t + Math.max(0, num(e.quantity, 1)), 0);
    if (unitId === 'equipment_day') return { loaded: count, detail: `${formatNumber(count, { decimals: 2 })} equipos en Equipos`, where: 'los equipos cargados' };
    // 0.18.0: por tiempo usado, un equipo propio con horas en el trabajo se costea con ésas.
    const time = usesTimeBasis(quote);
    const dayHours = (e) => {
      const own = time && e.acquisition !== 'rented' && e.acquisition !== 'outsourced' ? assignedEquipmentHours(e, a.hoursPerActiveDay) : 0;
      return own > 0 ? Math.max(own, Math.min(num(e.hoursPerActiveDay, 0), num(a.hoursPerActiveDay, 24) > 0 ? num(a.hoursPerActiveDay, 24) : 24)) : num(e.hoursPerActiveDay, a.hoursPerActiveDay);
    };
    const hours = lines.reduce((t, e) => t + Math.max(0, num(e.quantity, 1)) * Math.max(0, dayHours(e)), 0);
    return { loaded: hours, detail: 'equipos × horas por día en Equipos', where: 'los equipos y sus horas por día' };
  }
  return null;
}

/** Código del aviso "cada llamado hace menos de una unidad" (V-08): la pantalla lo usa para mostrar el ritmo de los llamados. */
export const SPARSE_ACTIVATIONS_ISSUE = 'sparse_activations';

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
    // UX 1 (2026-11): en precio cerrado, UN trabajo más largo que el mes no es un error (una obra
    // de 45 días): se pagan 1,5 meses de sueldo y el Resultado lo dice como dato. Sólo se avisa
    // si son varios trabajos por mes y no entran.
    const singleLongJob = contractOf(quote).mode === 'closed' && !(a.billableQuantityPerMonth > 1 + 1e-9);
    if (a.activeDaysPerMonth > a.availableDaysPerMonth + 1e-9 && !singleLongJob) {
      issues.push({
        path: 'activity.billableQuantityPerMonth',
        message: `Para facturar ${formatNumber(a.billableQuantityPerMonth, { decimals: 2 })} ${Math.abs(a.billableQuantityPerMonth - 1) < 1e-9 ? u.singular : u.plural} por mes necesitás ${formatDays(a.activeDaysPerMonth, { decimals: 1 })} de trabajo: más que los ${formatNumber(a.availableDaysPerMonth)} días disponibles del mes.`,
        severity: 'warning',
      });
    }
  }
  // Unidad que no corresponde a la modalidad del contrato (PLAN-2026-018): sólo avisa.
  // 0.10.0 (revisión 2026-11): el modo sale de la unidad (modeForUnit); sólo se avisa si el modo
  // guardado no es el que corresponde a la unidad (dato guardado antes). Una unidad de "por
  // servicio" que no está en la lista sugerida para los componentes (viaje con sólo personal) vale.
  const contract = contractOf(quote);
  if (!contract.legacy && contract.mode !== modeForUnit(u.id)) {
    const usual = contractUnits(contract).map((id) => (BILLING_UNITS.find((x) => x.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
    issues.push({
      path: 'unit',
      message: `Esta cotización quedó guardada para cobrar en ${usual}, pero estás cobrando en ${u.label}: elegí de nuevo la unidad en "${labelOf(QUOTE_STEPS, 'service', 'Contrato')}".`,
      severity: 'warning',
    });
  } else if (contract.legacy && quote.serviceType && SERVICE_TYPE_UNITS[quote.serviceType] && !unitFitsServiceType(quote.serviceType, u.id)) {
    const usual = SERVICE_TYPE_UNITS[quote.serviceType].map((id) => (BILLING_UNITS.find((x) => x.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
    issues.push({
      path: 'unit',
      message: `"${labelOf(SERVICE_TYPES, quote.serviceType, 'Este servicio')}" se suele cobrar en ${usual}. Estás cobrando en ${u.label}: revisá que sea la unidad correcta.`,
      severity: 'warning',
    });
  }
  // Auditoría 2026-11: datos que describen una realidad incoherente (no cambian números).
  const T = activationTerms(quote);
  const fmt = (n) => formatNumber(n, { decimals: 2 });
  const minCall = normalizeRules(ctx.rules).minimumCallUnits;
  if (u.kind === 'quantity' && a.unitsPerActiveDay > 0 && !(minCall > 0) && u.id !== 'trip') {
    const perActivation = a.unitsPerActiveDay * a.daysPerActivation;
    if (perActivation < 1 - 1e-9) {
      // V-08: los dos valores posibles salen de datos ya cargados. Una sola ida para toda la
      // cantidad del mes (cantidad ÷ por día) o una salida por unidad (1 ÷ por día).
      const quantity = nonNegative(a.billableQuantityPerMonth);
      const each = `Si cada ${u.singular} es ${T.a} ${T.one} ${T.g('distinta', 'distinto')}, cargá ${fmt(1 / a.unitsPerActiveDay)}`;
      const fix = quantity > 0
        ? `Si es una sola ida para ${fmt(quantity)} ${quantity === 1 ? u.singular : u.plural}, cargá ${fmt(quantity / a.unitsPerActiveDay)} días ${T.per}. ${each}.`
        : `${each} días ${T.per}.`;
      issues.push({
        path: 'activity.daysPerActivation',
        code: SPARSE_ACTIVATIONS_ISSUE,
        message: `Cada ${T.one} hace sólo ${fmt(perActivation)} ${u.singular} (${fmt(a.unitsPerActiveDay)} por día × ${fmt(a.daysPerActivation)} días): la movilización y los costos ${T.per} se cuentan más de una vez por ${u.singular}. ${fix}`,
        severity: 'warning',
      });
    }
  }
  const route = routeTrips(quote, a);
  if (route && route.derived && !route.notApplicable && route.tripsPerActivation > 0 && route.tripsPerActivation < 1 - 1e-9) {
    issues.push({
      path: 'activity.daysPerActivation',
      message: `Hay ${fmt(route.tripsPerActivation)} viajes ${T.per}: menos de un viaje en cada ${T.one}. Los peajes y viáticos ${T.per} se cuentan de más; revisá cuántas ${T.many} hacés por día.`,
      severity: 'warning',
    });
  }
  // Unidades 2026-11 que cuentan personas o equipos: lo facturado por día tiene que
  // coincidir con lo cargado (si no, se factura una cosa y se costea otra). Sólo avisa.
  const resourceCheck = resourcesPerDayCheck(quote, u.id, a);
  if (resourceCheck && a.unitsPerActiveDay > 0 && Math.abs(a.unitsPerActiveDay - resourceCheck.loaded) > 0.01 * Math.max(1, resourceCheck.loaded)) {
    issues.push({
      path: 'activity.unitsPerActiveDay',
      message: `Facturás ${fmt(a.unitsPerActiveDay)} ${a.unitsPerActiveDay === 1 ? u.singular : u.plural} por día de trabajo, pero lo cargado da ${fmt(resourceCheck.loaded)} (${resourceCheck.detail}). Los costos se calculan con lo cargado: revisá el rendimiento o ${resourceCheck.where}.`,
      severity: 'warning',
    });
  }
  if (a.daysPerActivation < 1 - 1e-9) {
    (Array.isArray(quote.equipment) ? quote.equipment : []).forEach((e, i) => {
      const x = e && e.acquisition !== 'owned' ? e.external || {} : null;
      if (x && ['day', 'hour'].includes(x.unit) && Number(x.minimumUnits) > 0) {
        issues.push({
          path: `equipment.${i}.external.minimumUnits`,
          message: `"${e.name || 'Equipo externo'}": el mínimo de ${fmt(Number(x.minimumUnits))} ${x.unit === 'day' ? 'días' : 'horas'} se cobra en CADA ${T.one} y hay ${fmt(1 / a.daysPerActivation)} ${T.many} por día. Si el proveedor lo cobra por día de trabajo (y no por ${T.one}), bajá el mínimo para no costearlo de más.`,
          severity: 'warning',
        });
      }
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
    // menos días de trabajo que los días facturables del tramo).
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
 * Costo de cada categoría de gasto (herramientas, insumos, materiales, EPP, otros) con la actividad
 * estimada (revisión 0.10.0, C3 / U12): lo que se suma en el renglón Materiales de la EECC, lo que
 * "Va a" otros renglones y, en la unidad de la cotización, lo del trabajo (precio cerrado: ÷
 * trabajos por mes, el mismo divisor que el "Total del trabajo") o el equivalente por unidad
 * cobrada (por hora, día o cantidad: ÷ unidades facturables del mes). Sólo un desglose del motor:
 * no cambia ningún total.
 */
function componentCostsOf(model, D, estimate, contract, unitInfo, eecc) {
  const revenue = estimate && estimate.revenue ? estimate.revenue : {};
  const closed = contract.mode === 'closed';
  const jobsPerMonth = closed && isFiniteNumber(revenue.activations) && revenue.activations > 1e-9 ? revenue.activations : null;
  const billableUnits = !closed && unitInfo.kind !== 'month' && isFiniteNumber(revenue.billableUnits) && revenue.billableUnits > 1e-9 ? revenue.billableUnits : null;
  const inUnit = (amount) => ({
    perJob: jobsPerMonth !== null ? amount / jobsPerMonth : null,
    perBilledUnit: billableUnits !== null ? amount / billableUnits : null,
  });
  const split = componentCostSplitAt(model, D);
  const byComponent = Object.fromEntries(Object.entries(split).map(([id, part]) => [id, {
    amount: part.amount,
    inMaterials: { ...part.inMaterials, ...inUnit(part.inMaterials.amount) },
    elsewhere: part.elsewhere.map((x) => ({ ...x, ...inUnit(x.amount) })),
  }]));
  const row = eecc && Array.isArray(eecc.rows) ? eecc.rows.find((r) => r.category === 'materials') : null;
  const materialsAmount = row ? row.amount : 0;
  return {
    jobsPerMonth,
    billableUnitsPerMonth: billableUnits,
    byComponent,
    // El renglón Materiales completo de la EECC (lo de todas las categorías que suman ahí).
    materials: { amount: materialsAmount, ...inUnit(materialsAmount) },
  };
}

/**
 * Calcula una cotización completa.
 * @param {object} quote
 * @param {{ settings?: object, listRateOverride?: number|null }} [options]
 */
export function computeQuote(quoteInput = {}, { settings = {}, listRateOverride = null } = {}) {
  // Costo financiero del IVA (K-03): con monotributo o exento (Configuración) nunca aplica.
  const rawQuote = withCompanyVatCondition(quoteInput, settings);
  const issues = validateQuote(rawQuote);
  // 0.19.0: horas de cada recurso en la unidad de cobro → horas por día (para los controles de abajo).
  const quote = resolveUnitHours(rawQuote, normalizeActivity(rawQuote));
  const model = buildCostModel(quote);
  // Un valor en otra moneda sin tipo de cambio NO se suma al costo: error en rojo.
  model.currency.gaps.forEach((g) => {
    issues.push({
      path: `${g.list}.${g.index}.${g.field}.currency`,
      message: `Falta el tipo de cambio ${g.currency || ''} de esta cotización: "${g.label}" no se suma al costo hasta cargarlo.`,
      severity: 'error',
    });
  });
  // Tarifas fuera de horario (PLAN-2026-025): su precio sugerido parte de la hora normal
  // equivalente de la MISMA cotización sin esas tarifas (sin cuenta circular).
  let referenceHourPrice = null;
  const withOutOfHours = hasOutOfHours(quote.extras);
  if (withOutOfHours) {
    const base = computeQuote({ ...quote, extras: quote.extras.filter((e) => !isOutOfHoursExtra(e)) }, { settings, listRateOverride });
    referenceHourPrice = base.outOfHours.rateHourPrice;
  }
  // 0.19.0 (auditoría de costos): horas de un recurso por encima del día de trabajo no se cuentan;
  // antes el recorte era silencioso y el costo quedaba de menos. Se avisa en la línea.
  if (usesTimeBasis(quote)) {
    const dayHours = normalizeActivity(quote).hoursPerActiveDay;
    const over = (list, key, nameOf, own) => (Array.isArray(list) ? list : []).forEach((line, i) => {
      if (!line || (own && !own(line))) return;
      const hours = nonNegative(line[key]);
      if (!(dayHours > 0) || !(hours > dayHours + 1e-6)) return;
      const raw = rawQuote[list === quote.labor ? 'labor' : 'equipment'][i] || {};
      const field = nonNegative(raw.assignedHoursPerUnit) > 0 && nonNegative(raw[key]) !== hours ? 'assignedHoursPerUnit' : key;
      issues.push({
        path: `${list === quote.labor ? 'labor' : 'equipment'}.${i}.${field}`,
        message: `"${nameOf(line)}": sus horas dan ${formatNumber(hours, { decimals: 2 })} h por día de trabajo y el día tiene ${formatNumber(dayHours, { decimals: 2 })} h: las horas de más no se están contando en el costo. Bajá sus horas, subí las horas por día de trabajo o agregá otro recurso igual.`,
        severity: 'warning',
      });
    });
    over(quote.labor, 'coverageHoursPerDay', (l) => l.role || 'Personal');
    over(quote.equipment, 'assignedHoursPerDay', (e) => e.name || 'Equipo', (e) => e.acquisition !== 'rented' && e.acquisition !== 'outsourced');
    // Horas con el motor andando por encima de las asignadas: mandan las andando (regla de §36). Se avisa,
    // porque un equipo agregado antes de la 0.19.0 las trae cargadas con el día entero.
    (Array.isArray(quote.equipment) ? quote.equipment : []).forEach((e, i) => {
      if (!e || e.acquisition === 'rented' || e.acquisition === 'outsourced') return;
      const assigned = assignedEquipmentHours(e, dayHours);
      const running = Math.min(nonNegative(e.hoursPerActiveDay), dayHours > 0 ? dayHours : 24);
      if (!(assigned > 0) || !(running > assigned + 1e-6)) return;
      issues.push({
        path: `equipment.${i}.hoursPerActiveDay`,
        message: `"${e.name || 'Equipo'}": tiene ${formatNumber(running, { decimals: 2 })} h por día con el motor andando y ${formatNumber(assigned, { decimals: 2 })} h asignadas: se están contando ${formatNumber(running, { decimals: 2 })} h. Si la asignación es la correcta, borrá las horas con el motor andando (en "Cambiar sus datos…").`,
        severity: 'warning',
      });
    });
    // 0.20.0: un vehículo que llega por sus medios y además suma horas de uso puede contar el viaje
    // dos veces (por hora y por km). Sólo avisa; qué horas son de viaje lo decide quien cotiza.
    const routeKm = nonNegative(quote.logistics && quote.logistics.distanceKm);
    (Array.isArray(quote.equipment) ? quote.equipment : []).forEach((e, i) => {
      if (!e || e.acquisition === 'rented' || e.acquisition === 'outsourced') return;
      const line = model.equipment[i];
      if (!(routeKm > 0) || !e.mobilization || e.mobilization.mode !== 'self' || !line || !(line.variablePerActiveDay > 0.005)) return;
      issues.push({
        path: `equipment.${i}.hoursPerActiveDay`,
        message: `"${e.name || 'Equipo'}": suma ${formatNumber(line.hoursPerActiveDay, { decimals: 2 })} h por día de uso (combustible y mantenimiento por hora) y además el traslado por km. Si esas horas incluyen el viaje, o el vehículo sólo lleva gente y queda estacionado, bajá las "Horas con el motor andando" (0 = sólo viaja).`,
        severity: 'warning',
      });
    });
  }
  const ctx = createEconomicsContext(quote, model, { referenceHourPrice, referenceHourCost: resourceNormalHourCost(model.outOfHours) });
  issues.push(...unitIssues(quote, ctx));
  // Adicionales (PLAN-2026-018): sin precio o con precio a mano bajo el costo.
  if (ctx.extras && ctx.extras.missingPrice > 0) {
    const i = ctx.extras.lines.findIndex((l) => l.quantity > 0 && l.price === null);
    issues.push({ path: `extras.${i}.price`, message: `"${ctx.extras.lines[i].label}" no tiene precio: cargalo a mano o revisá el margen objetivo y los impuestos (con un margen inválido no se sugiere). Mientras tanto no suma facturación.`, severity: 'warning' });
  }
  // Tarifa fuera de horario sin recargo (dato importado o editado a mano): vale lo mismo que una hora normal.
  if (ctx.extras) {
    const i = ctx.extras.lines.findIndex((l) => l.derived && !(l.premiumPct > 0));
    if (i >= 0) issues.push({ path: `extras.${i}.premiumPct`, message: `"${ctx.extras.lines[i].label}" no tiene recargo: una hora fuera de horario lleva el 50 % o el 100 % de horas extra.`, severity: 'warning' });
  }
  if (ctx.extras && ctx.extras.belowCost > 0) {
    const i = ctx.extras.lines.findIndex((l) => l.belowCost);
    issues.push({ path: `extras.${i}.price`, message: `"${ctx.extras.lines[i].label}" se cobra por debajo de su costo (con estructura, imprevistos e impuestos): cada ${ctx.extras.lines[i].unitName} pierde plata.`, severity: 'warning' });
  }
  const unitInfo = ctx.unitInfo;
  const texts = unitTexts(unitInfo);
  const byQuantity = ctx.unit === 'quantity' || ctx.unit === 'event';
  const activity = model.activity;
  const D = activity.activeDaysPerMonth;
  const pricing = quote.pricing || {};

  // Impuestos sobre la facturación (t, en puntos): gross-up junto con el margen.
  const t = ctx.billingTaxPct;
  // Costo financiero del IVA (K-03, t_iva) y divisor combinado g = t + t_iva (= t si está apagado).
  const tv = ctx.vatFinancePct;
  const g = grossUpPctOf(ctx);
  // Lo que se descuenta de lo facturado, en palabras (sin K-03, los textos de siempre).
  const deductionWords = tv > 0 ? (t > 0 ? 'impuestos sobre la facturación − costo financiero del IVA' : 'costo financiero del IVA') : 'impuestos sobre la facturación';
  const deductionInputs = [
    ...(t > 0 ? [{ label: 'Impuestos sobre la facturación', value: t, format: 'percent' }] : []),
    ...(tv > 0 ? [{ label: 'Costo financiero del IVA (puntos del precio)', value: tv, format: 'percent' }] : []),
  ];
  // Margen objetivo: vacío → 0 % (la completitud lo marca). Inválido (≥ 100,
  // negativo, texto) o margen + impuestos ≥ 100 → NO hay tarifa sugerida
  // (antes se usaba 0 % en silencio y la "sugerida" quedaba igual a la piso).
  const marginStatus = readMarginInput(pricing.targetMarginPct).state;
  const targetMarginPct = readMargin(pricing.targetMarginPct, 0);
  const targetMarginInvalid = marginStatus === 'invalid' || !isValidMarginAndTaxes(targetMarginPct, g);
  // Costo financiero del IVA (K-03): margen + impuestos + t_iva < 100 (como margen + impuestos).
  // Si ya falla sin el IVA, lo dice la validación de los impuestos (un solo aviso).
  if (tv > 0 && marginStatus === 'ok' && isValidMarginAndTaxes(targetMarginPct, t) && !isValidMarginAndTaxes(targetMarginPct, g)) {
    issues.push({
      path: 'pricing.targetMarginPct',
      message: g >= 100
        ? `El costo financiero del IVA (${formatPercent(tv)} del precio)${t > 0 ? ' más los impuestos sobre lo que facturás' : ''} llega a 100 %: no hay precio posible. Revisá el IVA, los días hasta pagarlo y la tasa en "Financiación".`
        : `Con ${t > 0 ? `${formatPercent(t)} de impuestos sobre lo que facturás y ` : ''}${formatPercent(tv)} de costo financiero del IVA, el margen tiene que ser menor a ${formatPercent(100 - g)}.`,
      severity: 'error',
    });
  }
  const customMarginRaw = readMargin(pricing.customMarginPct, null);
  const customMarginPct = customMarginRaw !== null && customMarginRaw > 0 && isValidMarginAndTaxes(customMarginRaw, g) ? customMarginRaw : null;
  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const margins = unique([...ladder, ...(targetMarginInvalid ? [] : [targetMarginPct]), ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginAndTaxes(m, g)));

  // Tarifas necesarias con la actividad estimada
  const ratesAtEstimate = requiredRatesAt(ctx, D, margins);
  const byMargin = (m) => ratesAtEstimate.byMargin.find((r) => r.marginPct === m) || { netRate: null, listRate: null, requiredRevenue: null };
  const targetRates = targetMarginInvalid ? { netRate: null, listRate: null, requiredRevenue: null } : byMargin(targetMarginPct);
  const roundingStep = nonNegative(pricing.roundingStep);
  const suggestedListRate = suggestedRateRound(targetRates.listRate, roundingStep);
  const effectiveStep = isFiniteNumber(targetRates.listRate) ? effectiveRoundingStep(targetRates.listRate, roundingStep) : roundingStep;

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
    const reason = 'Con abono mensual la facturación no depende de los días de trabajo: no hay break-even en días.';
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
    // Mínimo garantizado (B-3, H-29): con pocos días el mínimo puede cubrir los costos, más
    // adelante se pierde y desde el break-even se gana. El break-even no cambia (es desde
    // dónde se gana siempre); se agrega la ventana de pérdida con la tarifa comercial.
    if (normalizeRules(ctx.rules).hasMinimumGuarantee) {
      const windows = findLossWindows((d) => evaluateAt(ctx, d, commercialListRate).profit, { maxDays, breakpoints })
        .map((w) => ({ ...w, fromQuantity: billableQuantityAt(ctx, w.fromDays), toQuantity: billableQuantityAt(ctx, w.toDays) }));
      // Sólo hay algo que informar si el mínimo protege los primeros días (la pérdida no empieza en 0).
      breakEven = { ...breakEven, lossWindows: windows, guaranteeProtects: windows.length > 0 && windows[0].fromDays > 1e-9 };
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
  const componentCosts = componentCostsOf(model, D, estimate, contractOf(quote), unitInfo, eecc);
  // La matriz siempre incluye el margen objetivo (aunque no esté en la escalera).
  const matrixMargins = unique([...ladder, ...(targetMarginInvalid ? [] : [targetMarginPct]), ...(customMarginPct !== null ? [customMarginPct] : [])].filter((m) => isValidMarginAndTaxes(m, g) && m > 0));
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
  // Menos de una salida por mes (PLAN-2026-014, LAB-D1): aviso informativo, la fórmula no cambia.
  const belowOne = activationRoundingNotice(quote, rounding, roundingPreview);
  if (belowOne) completeness.notices.push(belowOne);
  // Costos fijos del mes que absorbe el precio (tanda A 2026-11, A-15 a): informativo, nunca se aplica un % solo.
  const absorbed = fixedCostsAbsorbedNotice(quote, model, D);
  if (absorbed) completeness.notices.push(absorbed);
  // Horas del mes de los recursos propios que esta cotización no paga (0.23.0): sólo avisa.
  const idle = idleCapacityNotice(quote, model, D);
  if (idle) completeness.notices.unshift(idle);
  // Mínimo en unidades por encima de la estimación con la sugerida (revisión de costos tanda B, B-3).
  const aboveEstimate = guaranteeAboveEstimateNotice({ ctx, D, estimate, commercialSource, targetRates, targetMarginPct, roundingStep, maxDays });
  if (aboveEstimate) completeness.notices.push(aboveEstimate);
  // Nombre de la activación en los textos: llamado / salida / intervención (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const num = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  let workingCapital = model.finance.workingCapitalFixed * factor + model.finance.workingCapitalPerActiveDay * D;
  if (roundingOn) workingCapital += rounding.workingCapital;
  const financialCost = costAt.byCategory.financial;
  // Alivio del crédito fiscal de los externos (K-03): lo que se descontó del financiero del mes.
  const relief = model.finance.vatRelief;
  const vatReliefMonthly = relief && relief.active ? relief.fixedMonthly * factor + relief.variablePerActiveDay * D : 0;
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
    targetMarkupPct: targetMarginInvalid ? null : markupWithTaxesPct(targetMarginPct, g),
    // Ganancia sobre el costo que implica el margen objetivo: m / (1 − m − t).
    targetProfitOnCostPct: targetMarginInvalid ? null : profitOnCostPct(targetMarginPct, g),
    // "Impuestos" que se muestran: sólo los impuestos sobre la facturación (sin el IVA).
    billingTaxPct: t,
    billingTaxesDefined: ctx.billingTaxInfo.defined,
    billingTaxesInvalid: ctx.billingTaxInfo.invalid,
    billingTaxes: estimate.billingTaxes,
    // Costo financiero del IVA (K-03): puntos del precio, monto del mes y divisor combinado.
    vatFinanceActive: Boolean(ctx.vatFinance && ctx.vatFinance.active),
    vatFinancePct: tv,
    vatFinance: estimate.vatFinance,
    grossUpPct: g,
    vatReliefMonthly,
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
    // Tarifa neta debajo de la tarifa mínima (que no cuenta el mínimo garantizado).
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
        // Por día u hora con mínimo por llamado, lo facturado por día de trabajo incluye el mínimo.
        perDay: (ctx.unit === 'day' || ctx.unit === 'hour') && estimate.revenue.minimumCallApplied && D > 0 ? safeDivide(estimate.revenue.components.base, D, null) : ctx.unit === 'day' ? commercialListRate : ctx.unit === 'hour' ? commercialListRate * hoursPerDay : byQuantity ? perWorkDay : safeDivide(commercialListRate, D, null),
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
      vatFinancePct: tv,
      quantityUnit: byQuantity ? { plural: unitInfo.plural, singular: unitInfo.singular, label: texts.breakEvenLabel, perDay: linear.unitsPerActiveDay } : null,
      terms: T,
    }),
    // Días para el margen objetivo (antes se armaba en la interfaz): con la
    // descomposición lineal, R(D)·(1 − t − m) − C(D) ≥ 0.
    targetMarginDays: createTrace({
      id: 'target_margin_days',
      title: targetMarginInvalid
        ? `${byQuantity ? `${capitalizeUnitWord(unitInfo.plural)} para lograr` : 'Días para lograr'} el margen objetivo (margen inválido)`
        : `${byQuantity ? `${capitalizeUnitWord(unitInfo.plural)} para lograr` : 'Días para lograr'} el margen objetivo (${formatPercent(targetMarginPct)})`,
      formula: tv > 0
        ? `Días = (Costos fijos − Ingresos fijos × (1 − ${deductionWords} − margen)) / (Ingreso por día × (1 − ${deductionWords} − margen) − Costo variable por día)`
        : t > 0
        ? 'Días = (Costos fijos − Ingresos fijos × (1 − impuestos − margen)) / (Ingreso por día × (1 − impuestos − margen) − Costo variable por día)'
        : 'Días = (Costos fijos − Ingresos fijos × (1 − margen)) / (Ingreso por día × (1 − margen) − Costo variable por día)',
      inputs: [
        { label: 'Costos fijos mensuales', value: linearTarget.fixedCosts, format: 'money' },
        { label: 'Ingresos fijos (fijo por estar de guardia, equipo en espera, adicionales)', value: linearTarget.fixedRevenue, format: 'money' },
        { label: 'Ingreso por día de trabajo', value: linearTarget.revenuePerActiveDay, format: 'money' },
        { label: 'Costo variable por día de trabajo', value: linearTarget.variableCostPerDay, format: 'money' },
        ...deductionInputs,
        { label: 'Margen objetivo', value: targetMarginInvalid ? null : targetMarginPct, format: 'percent' },
      ],
      steps: [{
        label: tv > 0 ? 'Ingreso por día después de impuestos, del costo financiero del IVA y de reservar el margen − costo variable' : t > 0 ? 'Ingreso por día después de impuestos y de reservar el margen − costo variable' : 'Ingreso por día después de reservar el margen − costo variable',
        value: !targetMarginInvalid && hasRate && isFiniteNumber(linearTarget.revenuePerActiveDay) ? linearTarget.revenuePerActiveDay * (1 - (g + targetMarginPct) / 100) - linearTarget.variableCostPerDay : null,
        format: 'money',
      }],
      result: byQuantity
        ? { label: `${capitalizeUnitWord(unitInfo.plural)} por mes para lograr el margen`, value: targetMarginDays.reachable ? targetMarginDays.quantity : null, format: 'number' }
        : { label: 'Días de trabajo para lograr el margen', value: targetMarginDays.reachable ? targetMarginDays.days : null, format: 'days' },
      notes: [
        byQuantity && targetMarginDays.reachable ? `Son ${formatDays(targetMarginDays.days, { decimals: 1 })} de trabajo: los costos se calculan con esos días y la facturación, con ${texts.los} ${unitInfo.plural}.` : null,
        !targetMarginDays.reachable ? targetMarginDays.reason : null,
        linearTarget.hasNonLinearRules ? `Hay reglas no lineales (mínimo garantizado, mínimo ${T.per}, tramos de descuento, ${T.each} contad${T.g('a', 'o')} ${T.whole} u horas extra de todo el trabajo): el resultado se calcula día a día.` : null,
      ],
    }),
    floorRate: createTrace({
      id: 'floor_rate',
      title: `Tarifa mínima (por ${unitLabel})`,
      formula: tv > 0
        ? `Facturación necesaria = Costo total / (1 − ${deductionWords}) · Tarifa mínima neta = (Facturación necesaria − Otros ingresos) / Unidades facturables · Tarifa mínima de lista = neta / factor de descuentos`
        : t > 0
        ? 'Facturación necesaria = Costo total / (1 − impuestos sobre la facturación) · Tarifa mínima neta = (Facturación necesaria − Otros ingresos) / Unidades facturables · Tarifa mínima de lista = neta / factor de descuentos'
        : 'Tarifa mínima neta = (Costo total − Otros ingresos) / Unidades facturables · Tarifa mínima de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        ...deductionInputs,
        { label: 'Otros ingresos (fijo por estar de guardia, equipo en espera, km)', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: `Unidades facturables (${unitInfo.plural})`, value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [
        ...(g > 0 ? [{ label: tv > 0 ? 'Facturación necesaria (cubre costo, impuestos sobre la facturación y costo financiero del IVA)' : 'Facturación necesaria (cubre costo e impuestos sobre la facturación)', value: ratesAtEstimate.floorRequiredRevenue, format: 'money' }] : []),
        { label: 'Tarifa mínima neta (lo que efectivamente cobrás por unidad)', value: ratesAtEstimate.floorNetRate, format: 'moneyCeil' },
      ],
      result: { label: 'Tarifa mínima de lista (la que escribís en la cotización)', value: ratesAtEstimate.floorListRate, format: 'moneyCeil' },
      notes: [
        D <= 0 ? (byQuantity ? `Sin ${unitInfo.plural} por mes no hay tarifa por ${unitInfo.singular} posible: cargá la actividad estimada.` : `Sin días de trabajo no hay tarifa por ${unitInfo.singular || 'día'} posible: cargá la actividad estimada.`) : null,
        ratesAtEstimate.floorCoveredByOtherRevenue ? 'Los otros ingresos ya cubren el costo.' : null,
        !ctx.billingTaxInfo.defined && !ctx.billingTaxInfo.notApplicable && !ctx.billingTaxInfo.invalid ? 'No incluye impuestos sobre lo que facturás (sin definir): cargalos en "El precio".' : null,
        ctx.billingTaxInfo.invalid ? 'No incluye impuestos sobre lo que facturás: hay un porcentaje inválido. Corregilo en "El precio".' : null,
      ],
    }),
    targetRate: createTrace({
      id: 'target_rate',
      title: targetMarginInvalid ? 'Precio objetivo (margen inválido)' : `Precio objetivo (margen ${targetMarginPct} %)`,
      formula: g > 0
        ? `Tarifa objetivo = (Costo total / (1 − margen − ${deductionWords}) − Otros ingresos) / Unidades facturables · Tarifa de lista = neta / factor de descuentos`
        : 'Tarifa objetivo = (Costo total / (1 − margen) − Otros ingresos) / Unidades facturables · Tarifa de lista = neta / factor de descuentos',
      inputs: [
        { label: 'Costo total del mes', value: ratesAtEstimate.totalCost, format: 'money' },
        { label: 'Margen objetivo (sobre precio, antes del impuesto a las Ganancias)', value: targetMarginInvalid ? null : targetMarginPct, format: 'percent' },
        ...deductionInputs,
        { label: 'Otros ingresos', value: ratesAtEstimate.otherRevenue, format: 'money' },
        { label: 'Unidades facturables', value: ratesAtEstimate.billableUnits, format: 'number' },
        { label: 'Factor de descuentos (tramo × continuidad × comercial)', value: ratesAtEstimate.discountFactor, format: 'number' },
      ],
      steps: [
        { label: 'Facturación necesaria', value: targetRates.requiredRevenue, format: 'money' },
        { label: 'Tarifa objetivo neta', value: targetRates.netRate, format: 'moneyCeil' },
        { label: 'Markup equivalente (recargo sobre el costo: precio = costo × (1 + markup))', value: targetMarginInvalid ? null : markupWithTaxesPct(targetMarginPct, g), format: 'percent' },
        ...(g > 0 ? [{ label: 'Ganancia sobre el costo (resultado / costo)', value: targetMarginInvalid ? null : profitOnCostPct(targetMarginPct, g), format: 'percent' }] : []),
      ],
      result: { label: 'Precio objetivo de lista', value: targetRates.listRate, format: 'moneyCeil' },
      notes: [
        roundingStep > 0 && isFiniteNumber(suggestedListRate)
          ? (effectiveStep < roundingStep - 1e-9
            ? `Tarifa sugerida: redondeada hacia arriba a múltiplos de ${formatMoney(effectiveStep)} (el paso configurado de ${formatMoney(roundingStep)} sería más del 1 % de la tarifa).`
            : `Tarifa sugerida: redondeada hacia arriba a múltiplos de ${formatMoney(roundingStep)}.`)
          : null,
        targetMarginInvalid ? (tv > 0 ? 'El margen objetivo tiene que ser mayor o igual a 0 y, sumado a los impuestos sobre la facturación y al costo financiero del IVA, menor a 100 %.' : 'El margen objetivo tiene que ser mayor o igual a 0 y, sumado a los impuestos sobre la facturación, menor a 100 %.') : null,
      ],
    }),
    expectedResult: createTrace({
      id: 'expected_result',
      title: 'Resultado esperado del mes',
      formula: tv > 0
        ? `Resultado = Facturación − ${t > 0 ? 'Impuestos sobre la facturación − ' : ''}Costo financiero del IVA − Costo total · Margen = Resultado / Facturación`
        : t > 0
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
        ...deductionInputs,
      ],
      steps: [
        { label: 'Facturación total', value: estimate.revenue.total, format: 'money' },
        ...(t > 0 ? [{ label: 'Impuestos sobre la facturación del mes', value: estimate.billingTaxes, format: 'money' }] : []),
        ...(tv > 0 ? [{ label: 'Costo financiero del IVA del mes', value: estimate.vatFinance, format: 'money' }] : []),
      ],
      result: { label: 'Resultado', value: estimate.profit, format: 'money' },
      notes: [
        hasRate && isFiniteNumber(estimate.marginPct)
          ? `Margen sobre precio (antes del impuesto a las Ganancias): ${formatPercent(estimate.marginPct)}. Markup sobre costo: ${formatPercent(estimate.markupPct)}.${g > 0 ? ` Ganancia sobre el costo: ${formatPercent(estimate.profitOnCostPct)} (el resto del recargo son ${tv > 0 ? 'los impuestos sobre la facturación y el costo financiero del IVA' : 'los impuestos sobre la facturación'}).` : ''}`
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
        // Alivio por el crédito fiscal de los externos (K-03): ya descontado del financiero.
        ...(vatReliefMonthly > 0.005 ? [{ label: 'Menos: alivio por el IVA recuperable de los externos (crédito × tasa × días/30), ya descontado', value: -vatReliefMonthly, format: 'money' }] : []),
        { label: 'Impacto en margen (puntos)', value: kpis.financialMarginImpactPct, format: 'percent' },
        // Costo financiero del IVA (K-03): va en el precio (como los impuestos), no en el costo.
        ...(ctx.vatFinance && ctx.vatFinance.active
          ? [
            {
              label: 'Costo financiero del IVA = IVA × tasa × (plazo de cobro − días hasta pagar el IVA)/30',
              value: `${formatPercent(ctx.vatFinance.ratePct)} × ${formatPercent(ctx.vatFinance.monthlyRatePct)} × ${formatNumber(ctx.vatFinance.days, { decimals: 1 })}/30 = ${formatNumber(tv, { decimals: 4 })} % del precio`,
              format: 'text',
            },
            { label: 'Costo financiero del IVA del mes (va en el precio, como los impuestos)', value: estimate.vatFinance, format: 'money' },
          ]
          : []),
      ],
      result: { label: 'Costo financiero mensual', value: financialCost, format: 'money' },
      notes: [
        model.finance.paymentTermDefined
          ? null
          : 'Falta el plazo de cobro para completar el costo financiero. Mientras tanto RATEOS sólo considera el desfase que ya conoce (los días hasta facturar).',
        'Es una aproximación con interés simple: cada desembolso se financia desde que se paga hasta que cobrás (días hasta facturar + plazo de cobro − días hasta pagar ese costo).',
        'Se financian sólo los desembolsos: la amortización y el costo de capital de los equipos no son salidas de caja (no se financian). La contingencia tampoco.',
        'Equipos y servicios externos: se financia lo que le pagás al proveedor (neto + IVA + percepciones); el IVA recuperable y las percepciones no son costo, pero sí caja que adelantás hasta cobrar.',
        ctx.vatFinance && ctx.vatFinance.active
          ? `El IVA no es costo ni ganancia: sólo cuesta financiarlo. Sólo se descuenta el IVA de los externos cargados (criterio conservador).${ctx.vatFinance.days <= 0 ? ' Pagás el IVA después de cobrar: no hay costo financiero del IVA.' : ` Días que adelantás el IVA: ${formatNumber(ctx.vatFinance.paymentTermDays, { decimals: 1 })} − ${formatNumber(ctx.vatFinance.payLagDays, { decimals: 1 })} = ${formatNumber(ctx.vatFinance.days, { decimals: 1 })}.`}`
          : null,
        model.finance.suppliers.length
          ? 'Los externos con plazo de pago propio se financian con su plazo (días hasta facturar + plazo de cobro − plazo del proveedor); el resto, con los días de "Proveedores". El costo del externo no cambia.'
          : null,
      ],
    }),
    // Precio fijo con inflación esperada (K-01): sólo informa; el monto ya está en el costo.
    inflation: (() => {
      const inf = model.inflation || { active: false, factor: 1, lastMonthFactor: 1, months: 0, pct: null };
      const amount = costAt.byCategory.inflation || 0;
      const today = costAt.total - amount;
      const R = estimate.revenue.total;
      const marginAt = (cost) => (hasRate && R > 0 ? ((R - estimate.billingTaxes - (estimate.vatFinance || 0) - cost) / R) * 100 : null);
      return createTrace({
        id: 'inflation',
        title: 'Inflación esperada con precio fijo',
        formula: 'Costo promedio del contrato = costo de hoy × f · f = ((1 + π)^n − 1) / (n × π)',
        inputs: [
          { label: 'Inflación mensual que esperás (π)', value: inf.pct, format: 'percent' },
          { label: 'Meses de contrato (n)', value: inf.months, format: 'number' },
          { label: 'Costo del mes con los precios de hoy', value: today, format: 'money' },
        ],
        steps: [
          { label: 'Factor f (costo promedio ÷ costo de hoy)', value: formatNumber(inf.factor, { decimals: 6 }), format: 'text' },
          { label: 'Último mes: factor (1 + π)^(n − 1)', value: formatNumber(inf.lastMonthFactor, { decimals: 6 }), format: 'text' },
          { label: 'Costo del último mes', value: today * inf.lastMonthFactor, format: 'money' },
          { label: 'Costo promedio del contrato', value: costAt.total, format: 'money' },
          ...(marginAt(today) !== null
            ? [
              { label: 'Margen del primer mes', value: marginAt(today), format: 'percent' },
              { label: 'Margen del último mes', value: marginAt(today * inf.lastMonthFactor), format: 'percent' },
            ]
            : []),
        ],
        result: { label: 'Inflación esperada del mes (en el costo)', value: amount, format: 'money' },
        notes: [
          inf.active ? null : 'No aplica: el precio se ajusta, es precio cerrado, el contrato dura un mes o falta el %.',
          'El % lo cargaste vos: RATEOS no estima la inflación.',
          'El precio queda parejo todo el contrato: al principio ganás un poco más y al final un poco menos.',
          inf.active && marginAt(today * inf.lastMonthFactor) !== null && marginAt(today * inf.lastMonthFactor) < 0 ? 'Los últimos meses dan pérdida; se compensan con lo que ganás de más al principio.' : null,
        ].filter(Boolean),
      });
    })(),
    logistics: createTrace({
      id: 'logistics',
      title: 'Movilización y viajes',
      formula: `Por ${T.one} = movilización de equipos (km × consumo en ruta × precio + km × desgaste por km) + logística auxiliar (km × consumo × precio + desgaste + peajes + viáticos) · Mensual = ${T.per} × ${T.many} promedio por mes`,
      inputs: [
        { label: 'Distancia base → locación', value: model.logistics.distanceKm, format: 'km' },
        { label: `Km de ruta ${T.per}`, value: model.logistics.routeKmPerActivation, format: 'km' },
        { label: `Km de equipos en ruta (por sus medios o enganchados), ${T.per}`, value: model.mobilization.kmPerActivation, format: 'km' },
        { label: `Km de vehículos auxiliares ${T.per}`, value: model.logistics.vehicleKmPerActivation, format: 'km' },
        { label: `Litros ${T.per} (equipos + auxiliares)`, value: model.mobilization.litersPerActivation + model.logistics.litersPerActivation, format: 'liters' },
        { label: 'Precio combustible', value: model.fuel.paidByUs ? model.fuel.pricePerLiter : 0, format: 'rate' },
        { label: `${T.Many} promedio por mes`, value: activity.activationsPerMonth, format: 'number' },
      ],
      steps: [
        ...model.mobilization.lines.filter((l) => (l.mode === 'self' || l.towed) && l.perActivation > 0).map((l) => ({ label: `Movilización de ${l.name || 'equipo'}${l.towed ? ' (enganchado, sólo desgaste)' : ''}: ${l.km.toFixed(0)} km`, value: l.perActivation, format: 'money' })),
        { label: `Movilización de equipos ${T.per}`, value: model.mobilization.perActivation, format: 'money' },
        { label: `Logística auxiliar: combustible ${T.per}`, value: model.logistics.fuelPerActivation, format: 'money' },
        { label: `Logística auxiliar: desgaste, peajes y viáticos ${T.per}`, value: model.logistics.nonFuelPerActivation, format: 'money' },
        { label: `Costo ${T.per}`, value: model.logistics.costPerActivation + model.mobilization.perActivation, format: 'money' },
        // Por mes (PLAN-2026-010): equipos principales y logística auxiliar por separado.
        { label: 'Equipos principales: km por mes', value: model.mobilization.kmPerActivation * activity.activationsPerMonth, format: 'km' },
        { label: 'Equipos principales: litros por mes', value: model.mobilization.litersPerActivation * activity.activationsPerMonth, format: 'liters' },
        { label: 'Equipos principales: combustible por mes', value: model.mobilization.fuelPerActivation * activity.activationsPerMonth, format: 'money' },
        { label: 'Equipos principales: desgaste por mes', value: model.mobilization.wearPerActivation * activity.activationsPerMonth, format: 'money' },
        { label: 'Vehículos auxiliares: km por mes', value: model.logistics.vehicleKmPerActivation * activity.activationsPerMonth, format: 'km' },
        { label: 'Vehículos auxiliares: costo por mes', value: model.logistics.costPerActivation * activity.activationsPerMonth, format: 'money' },
        ...(roundingOn && ((rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0)) > 0
          ? [
            { label: `${T.Many} ${T.g('costeadas', 'costeados')} (${T.each} ${T.whole})`, value: rounding.costed, format: 'number' },
            { label: 'Efecto del redondeo (movilización y viajes)', value: (rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0), format: 'money' },
          ]
          : []),
      ],
      result: { label: 'Costo mensual de movilización y viajes', value: logisticsMonthly, format: 'money' },
      notes: [
        'En la estructura de costos, el combustible de los traslados se informa en "Combustible" y el resto en "Logística".',
        model.mobilization.lines.some((l) => l.mode === 'self' && l.driver === 'operator') ? 'Los equipos que maneja su operador no suman mano de obra: el operador ya está en Personal.' : null,
        'El desgaste por km de un equipo propio no incluye amortización (ya está en el costo de tenerlo).',
        // Apagada y con salidas no enteras (PLAN-2026-014, LAB-D1): promedio, costeadas y efecto del redondeo.
        !rounding.enabled && ((roundingPreview.bySource.logistics || 0) + (roundingPreview.bySource.mobilization || 0)) > 0
          ? `${T.Many} promedio por mes: ${num(rounding.estimated)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${num(rounding.estimated)} (en proporción). Con "${T.Each} se cuenta ${T.whole}" se costearía${roundingPreview.wholeActivations === 1 ? '' : 'n'} ${num(roundingPreview.wholeActivations)}: efecto del redondeo en movilización y viajes +${formatMoney((roundingPreview.bySource.logistics || 0) + (roundingPreview.bySource.mobilization || 0))} por mes (no incluido).`
          : null,
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
    // Contrato y adicionales (PLAN-2026-018).
    contract: contractOf(quote),
    extras: ctx.extras,
    // Tarifas fuera de horario (PLAN-2026-025): base por hora de los recursos y la hora normal
    // equivalente (la de referencia si hay tarifas cargadas; si no, la de esta cotización).
    outOfHours: (() => {
      const lines = ctx.extras.lines.filter((l) => l.derived);
      // Hora normal leída de la tarifa (sólo cobrando por hora o por día).
      const rateHourPrice = withOutOfHours
        ? referenceHourPrice
        : normalHourEquivalent({ unitKind: unitInfo.kind, unitId: unitInfo.id, listRate: commercialListRate, hoursPerActiveDay: activity.hoursPerActiveDay, people: model.outOfHours.people });
      const used = lines.find((l) => isFiniteNumber(l.referenceHourPrice));
      return {
        basis: model.outOfHours,
        active: withOutOfHours,
        rateHourPrice,
        // La que se usó de piso: la de la tarifa o, con abono / precio cerrado / por unidad, la de los recursos.
        normalHourPrice: used ? used.referenceHourPrice : rateHourPrice,
        normalHourSource: used ? used.referenceSource : rateHourPrice !== null ? 'rate' : null,
        // Hora-hombre (V-34): las horas fuera de horario son por hora de TODA la cuadrilla, no por hora-hombre.
        crewHour: unitInfo.id === MAN_HOUR_UNIT,
        lines,
      };
    })(),
    estimate,
    ratesAtEstimate,
    targetMarginPct: targetMarginInvalid ? null : targetMarginPct,
    targetMarginInvalid,
    billingTaxPct: t,
    billingTaxInfo: ctx.billingTaxInfo,
    // Costo financiero del IVA (K-03): puntos del precio y divisor combinado (g = t si está apagado).
    vatFinancePct: tv,
    grossUpPct: g,
    customMarginPct,
    breakEven,
    targetMarginDays,
    linear,
    eecc,
    // Costo por categoría de gasto de Materiales / Otros costos (revisión 0.10.0, C3 y U12).
    componentCosts,
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

/**
 * Tarifa vigente de la cotización (actualización por EECC, 0.11): la tarifa comercial de la
 * cotización llevada al último período actualizado. Base: el período guardado o, si no, el
 * mes de la fecha de la oferta (o de creación).
 */
export function rateUpdateOf(quote, result) {
  const q = quote && typeof quote === 'object' ? quote : {};
  return rateUpdateState({
    baseRate: result && result.kpis ? result.kpis.commercialListRate : null,
    eecc: result ? result.eecc : null,
    rateUpdate: q.rateUpdate,
    fallbackBasePeriod: periodFromDate(q.offerDate) || periodFromDate(q.createdAt),
    // Estructura como % del directo o de la mano de obra: acompaña sola (no lleva % propio).
    structureFollows: structureFollowsDirect(q.indirect),
    otherRevenue: result && result.ratesAtEstimate ? result.ratesAtEstimate.otherRevenue : 0,
  });
}

/** % de Mano de obra propuesto por las paritarias para una cotización (ver proposeLaborRaisePct). */
export function laborRaiseProposal(quote, agreements, fromPeriod, toPeriod) {
  const q = quote && typeof quote === 'object' ? quote : {};
  const a = q.activity && typeof q.activity === 'object' ? q.activity : {};
  const num = (v) => (isFiniteNumber(v) && v > 0 ? v : 0);
  const contracted = computeContractedStaff(q.contractedStaff, { hoursPerActiveDay: num(a.hoursPerActiveDay) });
  return proposeLaborRaisePct(q.labor, agreements, fromPeriod, toPeriod, {
    timeBasis: usesTimeBasis(q),
    hoursPerActiveDay: num(a.hoursPerActiveDay),
    activeDaysPerMonth: num(a.activeDaysPerMonth),
    otherLaborCost: contracted.fixedMonthly + contracted.variablePerActiveDay * num(a.activeDaysPerMonth),
    otherLaborLines: contracted.lines.filter((l) => l.fixedMonthly + l.variablePerActiveDay > 0).length,
  });
}

function structureFollowsDirect(indirect) {
  const ind = indirect && typeof indirect === 'object' ? indirect : {};
  if (ind.mode === 'detailed' && Array.isArray(ind.items)) return ind.items.length > 0 && ind.items.every((it) => it && (it.method || 'percent_direct').startsWith('percent_'));
  return (ind.method || 'percent_direct').startsWith('percent_');
}

/** Indicadores compactos para dashboard y listados (sin trazas). */
export function summarizeQuote(quote, options = {}) {
  const r = computeQuote(quote, options);
  return { ...r.kpis, issuesCount: r.issues.length, rateUpdate: rateUpdateOf(quote, r) };
}
