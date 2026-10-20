/**
 * Eco de montos (DESIGN-02 2/2, PLAN-2026-026). Puro, sin DOM: lo usa
 * `numberField` (components.js) en todo campo de plata.
 *
 * Debajo del campo se lee el monto con separadores ("$ 2.600.000") para ver
 * de un vistazo un cero de más o de menos. El texto del campo no se toca: lo
 * que se guarda sale de lo escrito, con el mismo intérprete que el campo.
 */

import { formatMoney, formatNumber } from '../core/format.js';
import { parseDecimalInput } from '../core/validation.js';

/** Desde este monto (en valor absoluto) se muestra el eco. */
export const MONEY_ECHO_FROM = 10000;

/** Monedas que no son pesos, por cómo las escribe la unidad del campo ("US$", "USD", "€", "EUR"). */
const FOREIGN = [
  { prefix: 'US$', match: /^(US\$|U\$S|USD)/i },
  { prefix: '€', match: /^(€|EUR)/i },
];

/**
 * Prefijo de moneda del eco según la unidad del campo: pesos sin unidad o con
 * una que empieza con "$" ("$", "$/mes"); "US$" o "€" para esas monedas; null
 * con cualquier otra unidad (no se adivina la moneda).
 * @param {string|null|undefined} unit
 * @returns {'$'|'US$'|'€'|null}
 */
export function echoCurrency(unit) {
  const u = String(unit ?? '').trim();
  if (u === '' || u.startsWith('$')) return '$';
  const foreign = FOREIGN.find((c) => c.match.test(u));
  return foreign ? foreign.prefix : null;
}

/**
 * Texto del eco para lo escrito en el campo: "$ 2.600.000" (con centavos si
 * los hay: "$ 1.800.000,50"; "US$ 15.000" en un campo en dólares), o '' si
 * está vacío, no se puede interpretar sin ambigüedad, es menor que
 * MONEY_ECHO_FROM o la unidad no dice una moneda conocida. Nunca adivina.
 * @param {string|null|undefined} raw
 * @param {{ unit?: string|null }} [options] unidad del campo ("$", "US$", "USD", "$/mes"…)
 */
export function moneyEchoText(raw, { unit = null } = {}) {
  const text = String(raw ?? '').trim();
  if (text === '') return '';
  const n = parseDecimalInput(text);
  if (!Number.isFinite(n) || Math.abs(n) < MONEY_ECHO_FROM) return '';
  const currency = echoCurrency(unit);
  if (!currency) return '';
  const decimals = Number.isInteger(n) ? 0 : 2;
  return currency === '$' ? formatMoney(n, { decimals }) : `${currency} ${formatNumber(n, { decimals, minDecimals: decimals })}`;
}
