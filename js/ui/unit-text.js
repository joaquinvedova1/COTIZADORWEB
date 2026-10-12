/**
 * Textos de la UNIDAD DE FACTURACIÓN para la interfaz (PLAN-2026-009) —
 * funciones puras, sin DOM ni storage (tests/ui/unit-text.test.js).
 *
 * No calculan nada económico: sólo deciden cómo se lee una cantidad en la
 * unidad comercial ("1.240 m³", "40 viajes", "1 viaje", "4.200 u.",
 * "12 pozos") a partir de lo que ya devolvió el motor (result.unitInfo).
 */

import { formatNumber, formatDays, EMPTY } from '../core/format.js';
import { isFiniteNumber } from '../core/money.js';
import { billingUnitOf, unitTexts } from '../domain/billing-units.js';

const EPS = 1e-9;

/** Unidad de un resultado de computeQuote (o de una cotización). "día" si no hay. */
export function unitInfoOf(source) {
  if (source && source.unitInfo && source.unitInfo.id) return source.unitInfo;
  if (source && typeof source.unit === 'string') return billingUnitOf({ unit: source.unit, unitName: source.unitName });
  return billingUnitOf({});
}

/** ¿Se cobra por cantidad o por evento (m³, viaje, llamado, trabajo…)? Ahí la actividad no está en días. */
export function isQuantityUnit(source) {
  const info = unitInfoOf(source);
  return info.kind === 'quantity' || info.kind === 'event';
}

/** Decimales de una cantidad en superficie: 0 desde 100, 1 desde 10, 2 debajo. */
export function quantityDecimals(value) {
  if (!isFiniteNumber(value)) return 0;
  const a = Math.abs(value);
  return a >= 100 ? 0 : a >= 10 ? 1 : 2;
}

/**
 * Palabra que acompaña a una cantidad: el símbolo si la unidad tiene uno
 * ("m³", "t", "u.", "km"), si no singular o plural ("1 viaje", "40 viajes").
 */
export function unitWord(value, source) {
  const info = unitInfoOf(source);
  if (info.short && info.short !== info.singular) return info.short;
  const one = isFiniteNumber(value) && Math.abs(Math.abs(value) - 1) < EPS;
  return one ? info.singular : info.plural;
}

/** "1.240 m³" · "40 viajes" · "1 viaje" · "4.200 u." · "12 pozos". */
export function quantityText(value, source, { decimals = quantityDecimals(value) } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  return `${formatNumber(value, { decimals })} ${unitWord(value, source)}`;
}

/** Cantidad redondeada hacia arriba (equilibrio: "no perder" nunca se lee de menos). */
export function quantityCeilText(value, source) {
  if (!isFiniteNumber(value)) return EMPTY;
  const decimals = quantityDecimals(value);
  const f = 10 ** decimals;
  return quantityText(Math.ceil(value * f - 1e-7) / f, source, { decimals });
}

/** Lo que va después de "$ … /": "día", "hora", "mes", "m³", "viaje", "pozo". */
export function perUnitSuffix(source) {
  const info = unitInfoOf(source);
  return info.short || 'día';
}

/** "6,4 días de trabajo" (los días que lleva facturar una cantidad). */
export function workDaysText(value, { decimals = 1 } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  return `${formatDays(value, { decimals })} de trabajo`;
}

/** Textos de actividad y equilibrio de la unidad ("¿Cuántos m³ esperás facturar por mes?", "m³ para no perder"). */
export function unitTextsOf(source) {
  return unitTexts(unitInfoOf(source));
}

/** Primera letra en mayúscula, salvo símbolos ("m³ para no perder", "Viajes para no perder"). */
export function capitalizeUnitPhrase(text) {
  if (typeof text !== 'string' || !text) return '';
  return /^[a-zñáéíóú]{4,}/i.test(text) ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}
