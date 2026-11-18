/**
 * Base de costo de los recursos propios de una cotización (2026-11-18, pedido del dueño).
 *
 *   'time'   Por tiempo usado: el personal y los equipos propios cuestan las HORAS que les lleva
 *            el trabajo × el valor de su hora. No hay "% de su costo fijo": el recurso está
 *            asignado al trabajo sólo las horas del trabajo.
 *              valor de la hora = costo del mes ÷ horas facturables por mes
 *            (`billableHoursPerMonth` del recurso: las horas que de verdad se venden en un mes;
 *            vacío = las horas normales del mes).
 *   (sin dato) El método de siempre: el mes del recurso × % asignado (100 % si no se comparte).
 *
 * Sólo las cotizaciones NUEVAS nacen con 'time' (`quote.costBasis`); las guardadas no tienen el
 * dato y calculan como siempre. Cobrando POR MES el recurso queda asignado al servicio: rige el
 * método de siempre aunque la cotización sea nueva (mes completo o la parte asignada).
 *
 * Sólo reglas de dominio: nada de cálculo económico.
 */

import { isPlainObject } from '../core/object.js';
import { billingUnitOf } from './billing-units.js';

export const COST_BASIS_TIME = 'time';

/** ¿La cotización costea sus recursos propios por tiempo usado? */
export function usesTimeBasis(quote) {
  if (!isPlainObject(quote) || quote.costBasis !== COST_BASIS_TIME) return false;
  return billingUnitOf(quote).kind !== 'month';
}

/** Horas facturables por mes de un recurso: las cargadas o, si no hay, `fallback` (las normales). */
export function billableHoursOf(line, fallback = 0) {
  const raw = isPlainObject(line) ? Number(line.billableHoursPerMonth) : NaN;
  if (Number.isFinite(raw) && raw > 0) return raw;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : 0;
}
