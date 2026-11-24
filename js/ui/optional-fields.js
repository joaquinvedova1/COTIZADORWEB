/**
 * 0.24.0 (PLAN-2026-028, PR 5): campos que no mueven ningún número.
 *
 * Se ocultan o se pliegan, pero NUNCA se borran: lo guardado sigue en disco y, si el campo
 * tiene un valor, se sigue viendo. Estas reglas son las mismas en la cotización y en Recursos.
 */

import { nonNegative } from '../core/money.js';
import { priceAdjustmentOf, PRICE_RISK_ITEM_IDS } from '../domain/price-adjustment.js';

/** ¿Tiene texto cargado (sin contar espacios)? */
export function hasText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** ¿Tiene un número cargado mayor que 0? */
export function positiveValue(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
}

/** Lo cargado en "Datos de la unidad (opcional)" de un equipo, para el resumen del pliegue. */
export function unitDataParts(d = {}) {
  const text = (v) => (hasText(v) ? v.trim() : '');
  return [
    text(d.capacity),
    text(d.internalCode) ? `interno ${text(d.internalCode)}` : '',
    d.modelId ? 'con modelo' : '',
    positiveValue(d.year) ? String(d.year) : '',
    text(d.plate) ? `patente ${text(d.plate)}` : '',
  ].filter(Boolean);
}

/**
 * P-15: con el precio que ya contempla la inflación, "Suba de precios" e "Inflación" se ocultan
 * sólo si están en 0 y sin marcar (se contarían dos veces). Con un valor cargado se ven siempre.
 */
export function riskItemVisible(quote = {}, saved = {}) {
  if (!saved || !PRICE_RISK_ITEM_IDS.includes(saved.id)) return true;
  if (saved.enabled || nonNegative(saved.pct) > 0) return true;
  return !priceAdjustmentOf(quote).active;
}
