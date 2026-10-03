/**
 * Utilidades numéricas y de redondeo centralizadas.
 *
 * Reglas:
 * - Los motores calculan SIEMPRE con valores internos sin redondear.
 * - El redondeo se aplica sólo al presentar o al persistir resultados finales.
 * - Ninguna función de este módulo devuelve NaN, Infinity ni -Infinity.
 */

import { NUMERIC_EPSILON } from '../config.js';

/** true si el valor es un número finito. */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Convierte un valor de entrada a número finito.
 * Strings vacíos, null, undefined, NaN o Infinity devuelven `fallback`.
 */
export function toNumber(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Número finito y >= 0. Negativos o inválidos devuelven `fallback` (0). */
export function nonNegative(value, fallback = 0) {
  const n = toNumber(value, fallback);
  return n < 0 ? fallback : n;
}

/** Limita un número al rango [min, max]. */
export function clamp(value, min, max) {
  const n = toNumber(value, min);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Convierte porcentaje (10 = 10 %) a fracción (0,10). */
export function pct(value) {
  return toNumber(value, 0) / 100;
}

/**
 * División segura: si el divisor es 0 o algún operando no es finito,
 * devuelve `fallback` (null por defecto) en lugar de Infinity/NaN.
 */
export function safeDivide(numerator, denominator, fallback = null) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator)) return fallback;
  if (Math.abs(denominator) < NUMERIC_EPSILON) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

/** Suma segura de una lista (ignora valores no finitos). */
export function sum(values) {
  let total = 0;
  for (const v of values) {
    if (isFiniteNumber(v)) total += v;
  }
  return total;
}

/**
 * Redondeo "half away from zero" a `decimals` decimales, robusto frente a
 * errores binarios típicos (1.005 → 1.01). Valores no finitos devuelven 0.
 */
export function roundTo(value, decimals = 2) {
  if (!isFiniteNumber(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const text = String(abs);
  let rounded;
  if (text.includes('e')) {
    // Notación exponencial (valores muy chicos o muy grandes).
    const factor = 10 ** decimals;
    rounded = Math.round(abs * factor) / factor;
  } else {
    const shifted = Number(`${text}e${decimals}`);
    rounded = Number(`${Math.round(shifted)}e-${decimals}`);
  }
  if (!Number.isFinite(rounded)) return value;
  const result = sign * rounded;
  return Object.is(result, -0) ? 0 : result;
}

/** Montos de dinero: 2 decimales (centavos). */
export function roundMoney(value) {
  return roundTo(value, 2);
}

/**
 * Tarifas y costos unitarios ($/hora, $/km, $/día, $/litro):
 * 4 decimales para no perder precisión en valores unitarios chicos.
 */
export function roundRate(value) {
  return roundTo(value, 4);
}

/** Porcentajes expresados en puntos (12,345 % → 12,35). */
export function roundPercentage(value) {
  return roundTo(value, 2);
}

/** Días (break-even, utilización): 2 decimales. */
export function roundDays(value) {
  return roundTo(value, 2);
}

/**
 * Entero inmediatamente superior tolerando errores de punto flotante
 * (10.0000000001 → 10, no 11).
 */
export function ceilTolerant(value, epsilon = NUMERIC_EPSILON) {
  if (!isFiniteNumber(value)) return null;
  return Math.ceil(value - epsilon);
}

/** Redondea hacia arriba al múltiplo de `step` (step <= 0 → sin cambio). */
export function roundUpToStep(value, step) {
  if (!isFiniteNumber(value)) return null;
  const s = toNumber(step, 0);
  if (s <= 0) return value;
  return Math.ceil(value / s - NUMERIC_EPSILON) * s;
}

/**
 * Convierte una lista de montos (o participaciones) en porcentajes
 * redondeados a `decimals` cuya suma exacta es `total` (por defecto 100),
 * usando el método del mayor resto. Si la suma de montos es 0 devuelve ceros.
 */
export function roundPercentagesToTotal(amounts, decimals = 2, total = 100) {
  const values = amounts.map((v) => (isFiniteNumber(v) && v > 0 ? v : 0));
  const base = sum(values);
  if (base <= 0) return values.map(() => 0);
  const factor = 10 ** decimals;
  const totalUnits = Math.round(total * factor);
  const raw = values.map((v) => (v / base) * totalUnits);
  const floors = raw.map((r) => Math.floor(r + NUMERIC_EPSILON));
  let remaining = totalUnits - sum(floors);
  const order = raw
    .map((r, i) => ({ i, rest: r - floors[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; k < order.length && remaining > 0; k += 1) {
    if (values[order[k].i] > 0) {
      floors[order[k].i] += 1;
      remaining -= 1;
    }
  }
  return floors.map((units) => units / factor);
}

/** Compara dos números con tolerancia absoluta. */
export function approxEqual(a, b, tolerance = 1e-6) {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false;
  return Math.abs(a - b) <= tolerance;
}
