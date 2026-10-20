/**
 * Redondeo comercial de la tarifa sugerida (ECO-03, VAL-01-F1).
 *
 *   - 'auto' (por defecto en empresas y cotizaciones nuevas): la tarifa objetivo
 *     se redondea HACIA ARRIBA al múltiplo de 1, 10, 100, 1.000… más grande que
 *     no la suba más de `roundingMaxPct` (1 % por defecto). Con una objetivo
 *     menor a $ 100 (el 1 % no llega a $ 1) no se redondea.
 *   - 'step': múltiplo fijo (`roundingStep`; 0 = sin redondeo). Es la regla de
 *     siempre: la conservan las cotizaciones guardadas antes de ECO-03 (sin
 *     `roundingMode`) y las empresas que la tienen elegida.
 *
 * Siempre hacia arriba: el redondeo nunca baja el margen. Ver
 * docs/CALCULATION_RULES.md §13 y PLAN-2026-020 (compatibilidad).
 */

import { isFiniteNumber, nonNegative, toNumber } from '../core/money.js';

export const ROUNDING_MODES = Object.freeze(['auto', 'step']);
/** Tope por defecto del automático: la sugerida no sube más de 1 % sobre la objetivo. */
export const DEFAULT_ROUNDING_MAX_PCT = 1;
/** Tope máximo configurable del automático. */
export const MAX_ROUNDING_MAX_PCT = 10;
/** Múltiplo fijo que traía la configuración de fábrica antes de ECO-03. */
export const LEGACY_DEFAULT_ROUNDING_STEP = 1000;
/** Con un múltiplo fijo, a partir de cuánto se avisa que la sugerida se aleja de la objetivo (%). */
export const ROUNDING_WARN_PCT = DEFAULT_ROUNDING_MAX_PCT;

/** Tope válido del automático (0 a 10 %); si no es válido, el de fábrica (1 %). */
export function roundingMaxPctOf(value) {
  const n = toNumber(value, NaN);
  return n >= 0 && n <= MAX_ROUNDING_MAX_PCT ? n : DEFAULT_ROUNDING_MAX_PCT;
}

/**
 * Múltiplo del automático para una tarifa objetivo: el de 1, 10, 100… más grande
 * que no supere `maxPct` % de la objetivo (0 = sin redondeo).
 */
export function autoRoundingStep(target, maxPct = DEFAULT_ROUNDING_MAX_PCT) {
  if (!isFiniteNumber(target) || target <= 0) return 0;
  const room = (target * roundingMaxPctOf(maxPct)) / 100;
  if (!(room >= 1)) return 0;
  let step = 1;
  while (step * 10 <= room) step *= 10;
  return step;
}

/**
 * Regla de redondeo de una cotización. Sin `roundingMode` (cotizaciones de antes
 * de ECO-03) rige el múltiplo fijo guardado: sus números no cambian.
 * @param {object|null} pricing  `quote.pricing`
 * @returns {{ mode: 'auto', maxPct: number } | { mode: 'step', step: number }}
 */
export function quoteRounding(pricing) {
  const p = pricing && typeof pricing === 'object' ? pricing : {};
  if (p.roundingMode === 'auto') return { mode: 'auto', maxPct: roundingMaxPctOf(p.roundingMaxPct) };
  return { mode: 'step', step: nonNegative(p.roundingStep) };
}

/**
 * Campos de `pricing` al cambiar la regla de una cotización (editor y "Usar redondeo automático"). A
 * automático: múltiplo en 0 (una versión anterior la calcula sin redondeo, nunca inflada) y el tope que
 * tenía o el de fábrica. A múltiplo fijo: sin tope (el múltiplo se vuelve a cargar).
 */
export function roundingModeChange(mode, pricing = {}) {
  if (mode === 'auto') {
    const raw = pricing && pricing.roundingMaxPct;
    const keep = raw !== null && raw !== undefined && raw !== '' && roundingMaxPctOf(raw) === toNumber(raw, NaN);
    return { roundingMode: 'auto', roundingMaxPct: keep ? toNumber(raw) : DEFAULT_ROUNDING_MAX_PCT, roundingStep: 0 };
  }
  return { roundingMode: 'step', roundingMaxPct: null };
}

/** Múltiplo que se aplica a una tarifa objetivo con esa regla (0 = sin redondeo). */
export function roundingStepFor(rule, target) {
  if (!rule) return 0;
  return rule.mode === 'auto' ? autoRoundingStep(target, rule.maxPct) : nonNegative(rule.step);
}

/**
 * Regla de la empresa para las cotizaciones NUEVAS, como campos de `pricing`.
 * Sin `roundingMode` (configuración de antes de ECO-03): con los parámetros de
 * fábrica sin confirmar (ILUSTRATIVOS) y el $ 1.000 de fábrica → automático (el
 * nuevo valor de fábrica); si no (otro múltiplo, o parámetros confirmados como
 * propios) → el múltiplo guardado, tal cual. En automático se guarda
 * `roundingStep: 0`: una versión anterior la calcula sin redondeo, nunca inflada.
 * @returns {{ roundingMode: 'auto'|'step', roundingMaxPct: number|null, roundingStep: number }}
 */
export function settingsRounding(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const auto = (maxPct) => ({ roundingMode: 'auto', roundingMaxPct: roundingMaxPctOf(maxPct), roundingStep: 0 });
  if (s.roundingMode === 'auto') return auto(s.roundingMaxPct);
  const step = nonNegative(s.roundingStep);
  if (s.roundingMode === 'step') return { roundingMode: 'step', roundingMaxPct: null, roundingStep: step };
  if (isFactoryLegacyStep(s.illustrative, step)) return auto(DEFAULT_ROUNDING_MAX_PCT);
  return { roundingMode: 'step', roundingMaxPct: null, roundingStep: step };
}

/**
 * true si un múltiplo guardado sin `roundingMode` es el $ 1.000 de fábrica sobre datos de fábrica
 * (ILUSTRATIVOS, sin confirmar): la única combinación que no pudo elegir nadie. La misma regla vale para
 * la configuración de la empresa y para las plantillas (PLAN-2026-020 §2).
 */
export function isFactoryLegacyStep(illustrative, step) {
  return illustrative === true && nonNegative(step) === LEGACY_DEFAULT_ROUNDING_STEP;
}
