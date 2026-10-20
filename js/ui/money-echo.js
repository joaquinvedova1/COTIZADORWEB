/**
 * Eco de montos (DESIGN-02 2/2, PLAN-2026-026). Puro, sin DOM: lo usa
 * `numberField` (components.js) en todo campo de plata.
 *
 * Debajo del campo se lee el monto con separadores ("$ 2.600.000") para ver
 * de un vistazo un cero de más o de menos. El texto del campo no se toca: lo
 * que se guarda sale de lo escrito, con el mismo intérprete que el campo.
 */

import { formatMoney } from '../core/format.js';
import { parseDecimalInput } from '../core/validation.js';

/** Desde este monto (en valor absoluto) se muestra el eco. */
export const MONEY_ECHO_FROM = 10000;

/**
 * Texto del eco para lo escrito en el campo: "$ 2.600.000" (con centavos si
 * los hay: "$ 1.800.000,50"), o '' si está vacío, no se puede interpretar sin
 * ambigüedad o es menor que MONEY_ECHO_FROM. Nunca adivina un número.
 * @param {string|null|undefined} raw
 */
export function moneyEchoText(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  const n = parseDecimalInput(text);
  if (!Number.isFinite(n) || Math.abs(n) < MONEY_ECHO_FROM) return '';
  return formatMoney(n, { decimals: Number.isInteger(n) ? 0 : 2 });
}
