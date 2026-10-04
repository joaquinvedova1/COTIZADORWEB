/**
 * Utilidades de presentación compartidas por los pasos del editor y el
 * resumen en vivo. No calculan nada económico: sólo eligen y formatean los
 * valores que devuelve computeQuote().
 *
 * Regla de bases (UX-01): las tarifas se muestran en la base que el usuario
 * escribe en la cotización (DE LISTA, antes de descuentos), con la neta como
 * dato secundario cuando hay descuentos (factor ≠ 1). Las tarifas mínimas
 * (piso, objetivo, sugerida, por margen) se muestran redondeadas HACIA
 * ARRIBA: cobrar la cifra que se ve nunca deja debajo del mínimo.
 */

import { confirmDialog } from '../../components.js';
import { formatMoney, formatMoneyCeil, formatNumber, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';

/** "día" | "hora" | "mes" según la unidad de cotización. */
export function unitShortOf(unit) {
  return unit === 'hour' ? 'hora' : unit === 'month' ? 'mes' : 'día';
}

/** Factor de descuentos (tramo × continuidad × comercial) con la actividad estimada. */
export function discountFactorOf(result) {
  const f = result && result.ratesAtEstimate ? result.ratesAtEstimate.discountFactor : null;
  return isFiniteNumber(f) ? f : 1;
}

/** ¿Hay descuentos que separan la tarifa de lista de la neta? */
export function hasDiscounts(result) {
  return Math.abs(discountFactorOf(result) - 1) > 1e-9;
}

/** "$ 2.033.055 / día" redondeado hacia arriba (tarifas mínimas). */
export function perUnitCeil(value, unit) {
  return isFiniteNumber(value) ? `${formatMoneyCeil(value)} / ${unitShortOf(unit)}` : EMPTY;
}

/** "$ 2.300.000 / día" (tarifas ingresadas por el usuario). */
export function perUnitMoney(value, unit) {
  return isFiniteNumber(value) ? `${formatMoney(value)} / ${unitShortOf(unit)}` : EMPTY;
}

/** Pista "Neta: $ X (después de descuentos)." sólo si el factor de descuentos ≠ 1. */
export function netRateHint(netValue, result) {
  return hasDiscounts(result) && isFiniteNumber(netValue) ? `Neta: ${formatMoneyCeil(netValue)} (después de descuentos).` : '';
}

/**
 * Tarifa piso que se muestra: la de LISTA. Si no existe (factor de
 * descuentos 0, p. ej. 100 % de descuento) se muestra la neta y se aclara.
 */
export function floorDisplay(result) {
  const k = (result && result.kpis) || {};
  if (isFiniteNumber(k.floorListRate)) return { value: k.floorListRate, base: 'list' };
  if (isFiniteNumber(k.floorNetRate)) return { value: k.floorNetRate, base: 'net' };
  return { value: null, base: 'list' };
}

/** La traza muestra su resultado con el mismo redondeo hacia arriba que la tarjeta. */
export function withCeilResult(trace) {
  if (!trace || !trace.result || trace.result.format !== 'money') return trace;
  return { ...trace, result: { ...trace.result, format: 'moneyCeil' } };
}

/** "Ver cálculo" de la tarifa piso: termina en la tarifa piso DE LISTA (motor). */
export function floorRateTrace(result) {
  return result && result.traces ? withCeilResult(result.traces.floorRate) : null;
}

/** "Ver cálculo" del precio objetivo: termina en la tarifa objetivo DE LISTA (motor). */
export function targetRateTrace(result) {
  return result && result.traces ? withCeilResult(result.traces.targetRate) : null;
}

/** Confirmación antes de quitar una línea de la cotización (acción destructiva). */
export function confirmRemove({ title, name, extra = 'Esto no modifica la biblioteca.' }) {
  return confirmDialog({
    title,
    message: `¿Quitar "${name}" de esta cotización?${extra ? ` ${extra}` : ''}`,
    confirmLabel: 'Quitar',
    danger: true,
  });
}

/** ¿El valor cargado es un número? (vacío, null o texto → no). */
export function hasNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

/** Número cargado como texto ("8,33") o null si está vacío. */
export function numberText(value, { decimals = 2 } = {}) {
  return hasNumber(value) ? formatNumber(Number(value), { decimals }) : null;
}

/** Monto cargado como texto ("$ 25.000") o null si está vacío. */
export function moneyText(value) {
  return hasNumber(value) ? formatMoney(Number(value)) : null;
}
