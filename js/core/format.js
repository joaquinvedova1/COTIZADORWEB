/**
 * Formateo para presentación (es-AR). Separado del cálculo.
 *
 * Regla: nunca mostrar NaN, Infinity ni -Infinity. Los valores no
 * disponibles se muestran como "—".
 */

import { LOCALE, CURRENCY } from '../config.js';
import { isFiniteNumber, roundMoney, roundPercentage, roundDays, ceilTolerant } from './money.js';

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

/**
 * Tarifa mínima mostrada sin decimales SIEMPRE hacia arriba: cobrar la cifra
 * que se ve nunca deja debajo del piso u objetivo (4.444.444,44 → $ 4.444.445).
 */
export function formatMoneyCeil(value) {
  if (!isFiniteNumber(value)) return EMPTY;
  return formatMoney(Math.ceil(value - 1e-9));
}

/**
 * Monto abreviado para resúmenes y vistas previas: "$ 15,8 M", "$ 2,04 M",
 * "$ 850 mil", "$ 950" (2 decimales debajo de $ 10 M, 1 hasta $ 100 M). Con `ceil: true` redondea HACIA ARRIBA al dígito mostrado (para
 * tarifas: la cifra visible nunca queda debajo del valor calculado).
 * No reemplaza al monto completo en el detalle: es sólo presentación.
 */
export function formatMoneyCompact(value, { ceil = false } = {}) {
  if (!isFiniteNumber(value)) return EMPTY;
  const roundTo = (x, decimals) => {
    const f = 10 ** decimals;
    return (ceil ? ceilTolerant(x * f) : Math.round(x * f)) / f;
  };
  const abs = Math.abs(value);
  let scaled;
  let decimals;
  let suffix;
  if (abs >= 1e6) {
    scaled = value / 1e6;
    // Hasta $ 10 M se muestran 2 decimales ("$ 2,04 M"): con 1 decimal el
    // redondeo hacia arriba de una tarifa podía mostrar hasta un 5 % más.
    decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    suffix = 'M';
  } else if (abs >= 1e3) {
    scaled = value / 1e3;
    decimals = 0;
    suffix = 'mil';
  } else {
    scaled = value;
    decimals = 0;
    suffix = '';
  }
  let rounded = roundTo(scaled, decimals);
  // 999.999 → "1.000 mil" no: se pasa a la unidad siguiente.
  if (suffix === '' && Math.abs(rounded) >= 1000) {
    suffix = 'mil';
    rounded = roundTo(value / 1e3, 0);
  }
  if (suffix === 'mil' && Math.abs(rounded) >= 1000) {
    suffix = 'M';
    rounded = roundTo(value / 1e6, 2);
  }
  if (Object.is(rounded, -0)) rounded = 0;
  const number = numberFormat({ minimumFractionDigits: 0, maximumFractionDigits: suffix === 'M' ? 2 : 0 }).format(Math.abs(rounded));
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$\u00A0${number}${suffix ? `\u00A0${suffix}` : ''}`;
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
    case 'money2':
      return formatMoney(value, { decimals: 2 });
    case 'moneyCeil':
      return formatMoneyCeil(value);
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
