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

/**
 * Incidencias del período base: renglones de la EECC (Materiales abierto en sus categorías de
 * gasto), sin los que acompañan (financiero, imprevistos), normalizados a 1.
 * @param {{ rows?: object[] }} eecc  resultado de costStructure()
 * @returns {{ id, label, hint, amount, weight }[]}  sólo categorías con monto > 0
 */
export function rateUpdateWeights(eecc) {
  const rows = eecc && Array.isArray(eecc.rows) ? eecc.rows : [];
  const amountOf = new Map();
  rows.forEach((r) => {
    if (!r || FOLLOWING_EECC_CATEGORIES.includes(r.category)) return;
    if (r.category === 'materials' && Array.isArray(r.children) && r.children.length) {
      r.children.forEach((c) => amountOf.set(c.component, (amountOf.get(c.component) || 0) + (isFiniteNumber(c.amount) ? c.amount : 0)));
      // Lo que no esté en ninguna categoría de gasto (no debería pasar) va a Materiales.
      const rest = (isFiniteNumber(r.amount) ? r.amount : 0) - r.children.reduce((s, c) => s + (isFiniteNumber(c.amount) ? c.amount : 0), 0);
      if (Math.abs(rest) > 1e-6) amountOf.set('materials', (amountOf.get('materials') || 0) + rest);
      return;
    }
    amountOf.set(r.category, (amountOf.get(r.category) || 0) + (isFiniteNumber(r.amount) ? r.amount : 0));
  });
  const cats = RATE_UPDATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, hint: c.hint, amount: amountOf.get(c.id) || 0 })).filter((c) => c.amount > 0);
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
export function rateUpdateState({ baseRate = null, eecc = null, rateUpdate = null, fallbackBasePeriod = null } = {}) {
  const ru = normalizeRateUpdate(rateUpdate);
  const basePeriod = ru.basePeriod || (isValidPeriod(fallbackBasePeriod) ? fallbackBasePeriod : null);
  const weights = rateUpdateWeights(eecc);
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
  return {
    basePeriod,
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
