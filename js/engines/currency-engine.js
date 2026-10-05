/**
 * CurrencyEngine — moneda de la cotización y conversión explícita (PLAN-2026-005).
 *
 * La cotización calcula en SU moneda (la de la empresa al crearla). Un valor
 * en otra moneda (valor de reposición en USD, una tarifa externa en USD) se
 * convierte con el tipo de cambio PROPIO de la cotización:
 *
 *   valor en moneda de la cotización = valor × tipo de cambio
 *
 * Si falta el tipo de cambio, el factor es null: el motor NO inventa uno, no
 * suma ese valor (factor 0) y la validación lo marca como error en rojo
 * ("falta el tipo de cambio": la cotización no está completa).
 * Nunca se consulta una cotización de moneda externa: lo carga la empresa.
 */

import { CURRENCY } from '../config.js';
import { isPlainObject } from '../core/object.js';
import { isKnownCurrency } from '../domain/economic-base.js';

/** Moneda en la que calcula la cotización. */
export function quoteCurrency(quote = {}) {
  return isPlainObject(quote) && isKnownCurrency(quote.currency) ? quote.currency : CURRENCY;
}

/** Tipo de cambio de la cotización para una moneda (> 0) o null. */
export function exchangeRateOf(quote = {}, currency) {
  const list = isPlainObject(quote) && Array.isArray(quote.exchangeRates) ? quote.exchangeRates : [];
  const row = list.find((r) => isPlainObject(r) && r.currency === currency);
  const rate = row ? Number(row.rate) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Factor para pasar un valor de `currency` a la moneda de la cotización:
 * 1 si es la misma (o no tiene moneda), el tipo de cambio si existe, null si falta.
 */
export function conversionFactor(currency, quote = {}) {
  if (!currency || !isKnownCurrency(currency) || currency === quoteCurrency(quote)) return 1;
  return exchangeRateOf(quote, currency);
}

/** Moneda de una base económica (o null). */
export function currencyOfBase(base) {
  return isPlainObject(base) && isKnownCurrency(base.currency) ? base.currency : null;
}
