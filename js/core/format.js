/**
 * Formateo para presentación (es-AR). Separado del cálculo.
 *
 * Regla: nunca mostrar NaN, Infinity ni -Infinity. Los valores no
 * disponibles se muestran como "—".
 */

import { LOCALE, CURRENCY } from '../config.js';
import { isFiniteNumber, roundMoney, roundPercentage, roundDays } from './money.js';

export const EMPTY = '—';

const cache = new Map();
function numberFormat(options) {
  const key = JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(LOCALE, options));
  return cache.get(key);
}

/** $ 1.234.567 (sin decimales por defecto). */
export function formatMoney(value, { decimals = 0 } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = decimals === 0 ? Math.round(roundMoney(value)) : roundMoney(value);
  const text = numberFormat({
    style: 'currency',
    currency: CURRENCY,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Object.is(v, -0) ? 0 : v);
  return text;
}

/** 1.234,5 */
export function formatNumber(value, { decimals = 0, minDecimals = 0 } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  return numberFormat({ minimumFractionDigits: minDecimals, maximumFractionDigits: decimals }).format(
    Object.is(value, -0) ? 0 : value,
  );
}

/** 12,35 % (recibe puntos porcentuales: 12.345 → "12,35 %"). */
export function formatPercent(value, { decimals = 2 } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = roundPercentage(value);
  return `${numberFormat({ minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(Object.is(v, -0) ? 0 : v)} %`;
}

/** 10 días / 9,5 días */
export function formatDays(value, { decimals = 2 } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = roundDays(value);
  const label = Math.abs(v - 1) < 1e-9 ? 'día' : 'días';
  return `${numberFormat({ maximumFractionDigits: decimals }).format(v)} ${label}`;
}

/** Fecha y hora local legible. */
export function formatDateTime(value) {
  if (!value) return EMPTY;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** Fecha local legible. */
export function formatDate(value) {
  if (!value) return EMPTY;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }).format(d);
}

/**
 * Formatea un valor según un tipo semántico usado en trazas y tablas.
 * format: 'money' | 'rate' | 'number' | 'percent' | 'days' | 'text' | 'km' | 'liters' | 'hours'
 */
export function formatValue(value, format = 'number', unit = '') {
  switch (format) {
    case 'money':
      return formatMoney(value);
    case 'rate':
      return formatMoney(value, { decimals: Math.abs(value) < 100 && isFiniteNumber(value) ? 2 : 0 });
    case 'percent':
      return formatPercent(value);
    case 'days':
      return formatDays(value);
    case 'km':
      return isFiniteNumber(value) ? `${formatNumber(value, { decimals: 1 })} km` : EMPTY;
    case 'liters':
      return isFiniteNumber(value) ? `${formatNumber(value, { decimals: 1 })} L` : EMPTY;
    case 'hours':
      return isFiniteNumber(value) ? `${formatNumber(value, { decimals: 2 })} h` : EMPTY;
    case 'text':
      return value === null || value === undefined || value === '' ? EMPTY : String(value);
    case 'number':
    default: {
      if (!isFiniteNumber(value)) return EMPTY;
      const text = formatNumber(value, { decimals: 2 });
      return unit ? `${text} ${unit}` : text;
    }
  }
}
