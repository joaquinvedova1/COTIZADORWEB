/**
 * Precio fijo con inflación esperada (K-01, 0.13.0).
 *
 * Pregunta única al cotizar un contrato de varios meses: "¿El precio se ajusta durante el
 * contrato?".
 *   adjusted  Sí, con una cláusula de ajuste: se actualiza con "Actualizar tarifa" (nada cambia).
 *   fixed     No, queda fijo todo el contrato: los costos suben mes a mes y el precio no. RATEOS
 *             cobra parejo el costo PROMEDIO del contrato con la inflación mensual que carga la
 *             empresa (nunca se inventa un %).
 *   null      Sin decidir (cotización nueva): la completitud lo pregunta.
 * Campo ausente (cotizaciones anteriores), null o 'adjusted' → apagado, mismos números de siempre.
 *
 * Factor de nivelación (costo promedio del contrato ÷ costo de hoy), con π = inflación mensual
 * y n = meses de contrato, el costo del mes k (1…n) es C × (1 + π)^(k−1):
 *
 *   f = ((1 + π)^n − 1) / (n × π)        f = 1 si π ≈ 0 o n ≤ 1
 *
 * Sólo aplica fuera de precio cerrado y con más de un mes de contrato.
 */

import { isPlainObject } from '../core/object.js';
import { contractOf, modeForUnit } from './contract.js';

export const PRICE_ADJUSTMENT_MODES = Object.freeze(['adjusted', 'fixed']);
/** Límites del % mensual (regla `inflationPct` de la validación). */
export const INFLATION_PCT_MIN = 0;
export const INFLATION_PCT_MAX = 30;

/** Valor por defecto de una cotización nueva: sin decidir. */
export function emptyPriceAdjustment() {
  return { mode: null, expectedMonthlyInflationPct: null };
}

function readPct(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Lectura defensiva del campo.
 * @returns {{ present: boolean, mode: 'adjusted'|'fixed'|null, expectedMonthlyInflationPct: number|null }}
 */
export function normalizePriceAdjustment(raw) {
  if (!isPlainObject(raw)) return { present: false, mode: null, expectedMonthlyInflationPct: null };
  const mode = PRICE_ADJUSTMENT_MODES.includes(raw.mode) ? raw.mode : null;
  return { present: true, mode, expectedMonthlyInflationPct: readPct(raw.expectedMonthlyInflationPct) };
}

/** Meses de contrato de una cotización (0 si no hay dato). */
export function contractMonthsOf(quote = {}) {
  const n = Number(isPlainObject(quote) ? quote.contractMonths : null);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ¿Es precio cerrado? (el contrato guardado o la unidad: trabajo / hito). */
function isClosed(quote) {
  return contractOf(quote).mode === 'closed' || (typeof quote.unit === 'string' && modeForUnit(quote.unit) === 'closed');
}

/** ¿Corresponde preguntar? Fuera de precio cerrado y con más de un mes de contrato. */
export function priceAdjustmentApplies(quote = {}) {
  const q = isPlainObject(quote) ? quote : {};
  return !isClosed(q) && contractMonthsOf(q) > 1;
}

/**
 * Factor de nivelación f = ((1 + π)^n − 1) / (n × π). 1 si π ≈ 0 o n ≤ 1; null si no es finito.
 * @param {number} pctPerMonth  inflación mensual en %
 * @param {number} months       meses de contrato (puede ser fraccionario)
 */
export function levelingFactor(pctPerMonth, months) {
  const p = Number(pctPerMonth) / 100;
  const n = Number(months);
  if (!Number.isFinite(p) || !Number.isFinite(n)) return null;
  if (n <= 1 || Math.abs(p) < 1e-9) return 1;
  const f = (Math.pow(1 + p, n) - 1) / (n * p);
  return Number.isFinite(f) && f > 0 ? f : null;
}

/**
 * Estado de la inflación con precio fijo de una cotización.
 * active sólo si aplica, el modo es 'fixed', hay un % válido (0–30) y el factor es finito.
 * @returns {{ applies: boolean, mode: string|null, present: boolean, active: boolean, factor: number, months: number, pct: number|null, lastMonthFactor: number }}
 */
export function priceAdjustmentOf(quote = {}) {
  const q = isPlainObject(quote) ? quote : {};
  const pa = normalizePriceAdjustment(q.priceAdjustment);
  const applies = priceAdjustmentApplies(q);
  const months = contractMonthsOf(q);
  const pct = pa.expectedMonthlyInflationPct;
  const validPct = pct !== null && pct >= INFLATION_PCT_MIN && pct <= INFLATION_PCT_MAX;
  const f = applies && pa.mode === 'fixed' && validPct ? levelingFactor(pct, months) : null;
  const active = f !== null && f > 1 + 1e-12;
  return {
    applies,
    present: pa.present,
    mode: pa.mode,
    active,
    factor: active ? f : 1,
    months,
    pct: validPct ? pct : null,
    // Costo del último mes ÷ costo de hoy: (1 + π)^(n − 1).
    lastMonthFactor: active ? Math.pow(1 + pct / 100, months - 1) : 1,
  };
}
