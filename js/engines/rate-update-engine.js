/**
 * Motor de actualización de tarifas por estructura de costos (ver js/domain/rate-update.js).
 *
 * Índices encadenados (fórmula polinómica de redeterminación): cada categoría lleva su índice
 * acumulado I_i (arranca en 1 y se multiplica por 1 + %/100 en cada actualización). Con las
 * incidencias del período base w_i (suman 1):
 *
 *   factor = Σ w_i × I_i          tarifa vigente = tarifa base × factor
 *
 * En una actualización, el aumento del paso es Σ s_i × %_i, con s_i = w_i × I_i ÷ factor la
 * incidencia VIGENTE de cada categoría (la primera vez, s_i = w_i: "60 % × 2 % + 40 % × 5 %").
 * Así, si la mano de obra subió más que el resto, pesa más en la próxima actualización.
 *
 * El margen y los impuestos sobre la facturación son % del precio: al multiplicar costo y
 * precio por el mismo factor, el margen % no cambia.
 *
 * Funciones puras.
 */

import { isFiniteNumber } from '../core/money.js';
import { RATE_UPDATE_CATEGORIES, FOLLOWING_EECC_CATEGORIES, normalizeRateUpdate, normalizeUpdatePcts } from '../domain/rate-update.js';
import { monthsBetween, isValidPeriod } from '../domain/economic-base.js';
import { agreementRaiseFactor } from '../domain/agreement-raises.js';
import { computeLaborLine } from './labor-engine.js';

/**
 * Incidencias del período base: renglones de la EECC (Materiales abierto en sus categorías de
 * gasto), sin los que acompañan (financiero, imprevistos), normalizados a 1.
 * @param {{ rows?: object[] }} eecc  resultado de costStructure()
 * @returns {{ id, label, hint, amount, weight }[]}  sólo categorías con monto > 0
 */
export function rateUpdateWeights(eecc, { structureFollows = false } = {}) {
  return weightsFromAmounts(rateUpdateAmounts(eecc, { structureFollows }));
}

/**
 * Montos por categoría actualizable de una EECC ({ labor: $, ppe: $ … }). Con estructura como %
 * del directo o de la mano de obra (`structureFollows`), Estructura acompaña sola y no pesa.
 */
export function rateUpdateAmounts(eecc, { structureFollows = false } = {}) {
  const rows = eecc && Array.isArray(eecc.rows) ? eecc.rows : [];
  const amountOf = new Map();
  rows.forEach((r) => {
    if (!r || FOLLOWING_EECC_CATEGORIES.includes(r.category)) return;
    if (structureFollows && r.category === 'structure') return;
    if (r.category === 'materials' && Array.isArray(r.children) && r.children.length) {
      r.children.forEach((c) => amountOf.set(c.component, (amountOf.get(c.component) || 0) + (isFiniteNumber(c.amount) ? c.amount : 0)));
      // Lo que no esté en ninguna categoría de gasto (no debería pasar) va a Materiales.
      const rest = (isFiniteNumber(r.amount) ? r.amount : 0) - r.children.reduce((s, c) => s + (isFiniteNumber(c.amount) ? c.amount : 0), 0);
      if (Math.abs(rest) > 1e-6) amountOf.set('materials', (amountOf.get('materials') || 0) + rest);
      return;
    }
    amountOf.set(r.category, (amountOf.get(r.category) || 0) + (isFiniteNumber(r.amount) ? r.amount : 0));
  });
  const out = {};
  RATE_UPDATE_CATEGORIES.forEach((c) => {
    const v = amountOf.get(c.id) || 0;
    if (v > 0) out[c.id] = v;
  });
  return out;
}

function weightsFromAmounts(amounts) {
  const a = amounts || {};
  const cats = RATE_UPDATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, amount: a[c.id] || 0 })).filter((c) => c.amount > 0);
  const total = cats.reduce((s, c) => s + c.amount, 0);
  return total > 0 ? cats.map((c) => ({ ...c, weight: c.amount / total })) : [];
}

function factorOf(weights, indices) {
  return weights.reduce((s, w) => s + w.weight * (indices[w.id] ?? 1), 0);
}

/**
 * Estado de la tarifa de una cotización: período base, período vigente, índices por categoría,
 * factor acumulado, tarifa vigente e historial con el aumento de cada paso.
 * @param {{ baseRate: number|null, eecc: object, rateUpdate: object, fallbackBasePeriod?: string|null }} input
 */
export function rateUpdateState({ baseRate = null, eecc = null, rateUpdate = null, fallbackBasePeriod = null, structureFollows = false, otherRevenue = 0 } = {}) {
  const ru = normalizeRateUpdate(rateUpdate);
  const basePeriod = ru.basePeriod || (isValidPeriod(fallbackBasePeriod) ? fallbackBasePeriod : null);
  // Lo que la cotización dice HOY (tarifa y montos por categoría).
  const liveAmounts = rateUpdateAmounts(eecc, { structureFollows });
  const liveRate = isFiniteNumber(baseRate) && baseRate > 0 ? baseRate : null;
  // Con actualizaciones, todo se calcula sobre la FOTO guardada en la primera.
  const snapshot = ru.steps.length && ru.base ? ru.base : null;
  const weights = weightsFromAmounts(snapshot ? snapshot.amounts : liveAmounts);
  if (snapshot) baseRate = snapshot.rate;
  const indices = Object.fromEntries(weights.map((w) => [w.id, 1]));
  const hasRate = isFiniteNumber(baseRate);
  let factor = 1;
  let fromPeriod = basePeriod;
  const steps = ru.steps.map((s) => {
    const before = factor;
    weights.forEach((w) => {
      const p = s.pcts[w.id];
      if (isFiniteNumber(p)) indices[w.id] *= 1 + p / 100;
    });
    factor = weights.length ? factorOf(weights, indices) : 1;
    const step = {
      id: s.id,
      fromPeriod,
      toPeriod: s.toPeriod,
      pcts: s.pcts,
      note: s.note,
      appliedAt: s.appliedAt,
      stepPct: (factor / before - 1) * 100,
      rateBefore: hasRate ? baseRate * before : null,
      rateAfter: hasRate ? baseRate * factor : null,
    };
    fromPeriod = s.toPeriod;
    return step;
  });
  // ¿La cotización cambió después de la foto? (otra tarifa u otro peso de alguna categoría)
  const liveWeights = weightsFromAmounts(liveAmounts);
  const sameWeights = liveWeights.length === weights.length && liveWeights.every((w) => {
    const o = weights.find((x) => x.id === w.id);
    return o && Math.abs(o.weight - w.weight) < 1e-6;
  });
  const stale = Boolean(snapshot) && (liveRate === null || Math.abs(liveRate - snapshot.rate) > 1e-6 * snapshot.rate || !sameWeights);
  return {
    basePeriod,
    // Foto para guardar en la primera actualización (tarifa y montos de hoy).
    liveBase: liveRate !== null && Object.keys(liveAmounts).length ? { rate: liveRate, amounts: liveAmounts } : null,
    liveRate,
    stale,
    // Cobros aparte (cargos, materiales revendidos…) que este cuadro no actualiza.
    otherRevenue: isFiniteNumber(otherRevenue) && otherRevenue > 0 ? otherRevenue : 0,
    previousCount: ru.previous.length,
    // Período al que está expresada la tarifa vigente.
    period: steps.length ? steps[steps.length - 1].toPeriod : basePeriod,
    updated: steps.length > 0,
    weights,
    indices,
    factor,
    totalPct: (factor - 1) * 100,
    baseRate: hasRate ? baseRate : null,
    rate: hasRate ? baseRate * factor : null,
    steps,
  };
}

/**
 * Vista previa de una actualización: incidencia vigente de cada categoría, su aporte
 * (incidencia × %) y la tarifa resultante. La suma de los aportes es el aumento del paso.
 * @param {ReturnType<typeof rateUpdateState>} state
 * @param {Record<string, number>} pcts  % por categoría
 * @param {string|null} toPeriod
 */
export function previewRateUpdate(state, pcts, toPeriod = null) {
  const p = normalizeUpdatePcts(pcts);
  const weights = state && Array.isArray(state.weights) ? state.weights : [];
  const indices = (state && state.indices) || {};
  const factor = weights.length ? factorOf(weights, indices) : 1;
  const rows = weights.map((w) => {
    const share = factor > 0 ? (w.weight * (indices[w.id] ?? 1)) / factor : 0;
    const pct = isFiniteNumber(p[w.id]) ? p[w.id] : 0;
    return { id: w.id, label: w.label, hint: w.hint, share, sharePct: share * 100, pct, contributionPct: share * pct };
  });
  const stepPct = rows.reduce((s, r) => s + r.contributionPct, 0);
  const rate = state && isFiniteNumber(state.rate) ? state.rate : null;
  const period = state ? state.period : null;
  let periodError = null;
  if (!isValidPeriod(toPeriod)) periodError = 'missing';
  else if (period && monthsBetween(period, toPeriod) <= 0) periodError = 'not_after';
  return {
    rows,
    stepPct,
    rateBefore: rate,
    rateAfter: rate === null ? null : rate * (1 + stepPct / 100),
    periodError,
    canApply: weights.length > 0 && periodError === null,
  };
}

/**
 * % de Mano de obra propuesto por las paritarias (0.12.1): aumento de cada puesto de la
 * cotización según el historial de aumentos de SU convenio entre los dos meses.
 *   - Sube con el % remunerativo: remunerativo con SAC, vacaciones y cargas, y las horas extra.
 *   - Sube con el % no remunerativo: el no remunerativo con sus cargas y la vianda.
 *   - No cambia: seguro, EPP, capacitación, traslado y contribuciones fijas (igual que
 *     "Aplicar aumento" del convenio).
 * Cada puesto pesa lo que aporta al renglón Mano de obra de la EECC (con su reparto, el tiempo
 * usado y los días estimados: `ctx` como en computeLabor). Los puestos sin convenio con aumentos
 * cargados quedan afuera: se les supone el mismo aumento (se informa qué parte del costo cubre).
 * @returns {{ pct, coveredShare, covered, total, agreements: string[], lastRaise: string|null } | null}
 */
export function proposeLaborRaisePct(laborLines, agreements, fromPeriod, toPeriod, ctx = {}) {
  const lines = Array.isArray(laborLines) ? laborLines.filter((l) => l && typeof l === 'object') : [];
  const list = Array.isArray(agreements) ? agreements : [];
  const D = isFiniteNumber(ctx.activeDaysPerMonth) && ctx.activeDaysPerMonth > 0 ? ctx.activeDaysPerMonth : 0;
  let allCost = 0;
  let cost = 0;
  let raise = 0;
  let covered = 0;
  let total = 0;
  let lastRaise = null;
  const names = new Set();
  lines.forEach((line) => {
    const r = computeLaborLine(line, ctx);
    const amount = r.fixedMonthly + r.variablePerActiveDay * D;
    if (!(amount > 0)) return;
    total += 1;
    allCost += amount;
    const agreement = list.find((a) => a && a.id === line.agreementId) || null;
    const fR = agreementRaiseFactor(agreement, fromPeriod, toPeriod, { part: 'remunerative' });
    const fN = agreementRaiseFactor(agreement, fromPeriod, toPeriod, { part: 'nonRemunerative' });
    if (fR === null && fN === null) return;
    covered += 1;
    if (agreement && typeof agreement.name === 'string') names.add(agreement.name);
    (agreement.raises || []).forEach((x) => {
      if (x && isValidPeriod(x.fromPeriod) && x.fromPeriod <= toPeriod && (!lastRaise || x.fromPeriod > lastRaise)) lastRaise = x.fromPeriod;
    });
    const p = r.perPerson;
    const meal = isFiniteNumber(p.mealPerActiveDay) ? p.mealPerActiveDay : 0;
    const variable = isFiniteNumber(p.variablePerActiveDay) ? p.variablePerActiveDay : 0;
    const overtimeMonthly = isFiniteNumber(p.overtimeMonthly) ? p.overtimeMonthly : 0;
    const remPart = p.loadedRemunerative + (isFiniteNumber(p.otherCharges) ? p.otherCharges : 0) + overtimeMonthly + (variable - meal) * D;
    const nonRemPart = p.nonRemunerativePay + p.nonRemunerativeCharges + meal * D;
    const whole = p.fixedMonthly + overtimeMonthly + variable * D;
    if (!(whole > 0)) return;
    const ratio = (remPart * ((fR ?? 1) - 1) + nonRemPart * ((fN ?? 1) - 1)) / whole;
    cost += amount;
    raise += amount * ratio;
  });
  // Personal tercerizado (0.15.0): pesa en Mano de obra pero no sigue a ningún convenio. Cuenta
  // como costo sin cubrir, así la pantalla dice qué parte cubre el % propuesto.
  if (isFiniteNumber(ctx.otherLaborCost) && ctx.otherLaborCost > 0) {
    allCost += ctx.otherLaborCost;
    total += isFiniteNumber(ctx.otherLaborLines) && ctx.otherLaborLines > 0 ? ctx.otherLaborLines : 1;
  }
  if (!covered || !(cost > 0)) return null;
  return { pct: (raise / cost) * 100, coveredShare: allCost > 0 ? cost / allCost : 0, covered, total, agreements: [...names], lastRaise };
}
