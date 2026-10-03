/**
 * PricingEngine — margen, markup, tarifa piso y precios objetivo.
 *
 * MARGEN y MARKUP NO son sinónimos:
 *
 *   Margen (sobre precio de venta):  margen = (precio − costo) / precio
 *     → precio = costo / (1 − margen)
 *     costo 100, margen 10 %  → precio 111,11
 *
 *   Markup (sobre costo):            markup = (precio − costo) / costo
 *     → precio = costo × (1 + markup)
 *     costo 100, markup 10 %  → precio 110
 *
 *   Conversiones:
 *     markup = margen / (1 − margen)
 *     margen = markup / (1 + markup)
 *
 * Todos los porcentajes se expresan en puntos (10 = 10 %).
 */

import { DEFAULT_MARGIN_LADDER } from '../config.js';
import { isFiniteNumber, nonNegative, safeDivide, roundUpToStep } from '../core/money.js';
import { createTrace } from '../core/trace.js';

/** true si el margen es válido: 0 ≤ margen < 100. */
export function isValidMarginPct(marginPct) {
  return isFiniteNumber(marginPct) && marginPct >= 0 && marginPct < 100;
}

/** Precio que logra un margen sobre precio. null si el margen es inválido. */
export function priceFromMargin(cost, marginPct) {
  if (!isFiniteNumber(cost) || !isValidMarginPct(marginPct)) return null;
  return (cost * 100) / (100 - marginPct);
}

/** Precio con markup sobre costo. null si el markup es inválido. */
export function priceFromMarkup(cost, markupPct) {
  if (!isFiniteNumber(cost) || !isFiniteNumber(markupPct) || markupPct < -100) return null;
  return (cost * (100 + markupPct)) / 100;
}

/** Margen (%) que deja un precio. null si el precio es 0. */
export function marginFromPrice(cost, price) {
  if (!isFiniteNumber(cost) || !isFiniteNumber(price)) return null;
  const r = safeDivide(price - cost, price, null);
  return r === null ? null : r * 100;
}

/** Markup (%) que implica un precio. null si el costo es 0. */
export function markupFromPrice(cost, price) {
  if (!isFiniteNumber(cost) || !isFiniteNumber(price)) return null;
  const r = safeDivide(price - cost, cost, null);
  return r === null ? null : r * 100;
}

/** Convierte margen (%) a markup (%) equivalente. */
export function marginToMarkup(marginPct) {
  if (!isValidMarginPct(marginPct)) return null;
  return (marginPct * 100) / (100 - marginPct);
}

/** Convierte markup (%) a margen (%) equivalente. */
export function markupToMargin(markupPct) {
  if (!isFiniteNumber(markupPct) || markupPct <= -100) return null;
  return (markupPct * 100) / (100 + markupPct);
}

/** Tarifa piso: el precio que iguala el costo (margen 0). */
export function floorPrice(cost) {
  return isFiniteNumber(cost) ? cost : null;
}

/** Tarifa piso unitaria: costo total / unidades. */
export function floorRate(totalCost, units) {
  return safeDivide(totalCost, units, null);
}

/**
 * Escalera de precios para un costo dado.
 * @returns {{ label: string, marginPct: number, price: number|null, markupPct: number|null }[]}
 */
export function priceLadder(cost, marginsPct = DEFAULT_MARGIN_LADDER, customMarginPct = null) {
  const rows = [{ key: 'floor', label: 'Tarifa piso', marginPct: 0, price: floorPrice(cost), markupPct: 0 }];
  marginsPct.forEach((m) => {
    rows.push({ key: `m${m}`, label: `Margen ${m} %`, marginPct: m, price: priceFromMargin(cost, m), markupPct: marginToMarkup(m) });
  });
  if (isValidMarginPct(customMarginPct) && !marginsPct.includes(customMarginPct) && customMarginPct > 0) {
    rows.push({
      key: 'custom',
      label: `Margen personalizado ${customMarginPct} %`,
      marginPct: customMarginPct,
      price: priceFromMargin(cost, customMarginPct),
      markupPct: marginToMarkup(customMarginPct),
    });
  }
  return rows;
}

/** Redondeo comercial hacia arriba (nunca baja el margen). */
export function commercialRound(price, step) {
  if (!isFiniteNumber(price)) return null;
  return roundUpToStep(price, nonNegative(step));
}

/** Traza: margen vs markup para un costo. */
export function traceMarginVsMarkup(cost, pctValue) {
  return createTrace({
    id: 'margin_vs_markup',
    title: 'Margen vs markup',
    formula: 'Precio por margen = Costo / (1 − margen) · Precio por markup = Costo × (1 + markup)',
    inputs: [
      { label: 'Costo', value: cost, format: 'money2' },
      { label: 'Porcentaje', value: pctValue, format: 'percent' },
    ],
    steps: [
      { label: `Precio con margen ${pctValue} % sobre precio`, value: priceFromMargin(cost, pctValue), format: 'money2' },
      { label: `Precio con markup ${pctValue} % sobre costo`, value: priceFromMarkup(cost, pctValue), format: 'money2' },
      { label: `Markup equivalente a margen ${pctValue} %`, value: marginToMarkup(pctValue), format: 'percent' },
    ],
    result: { label: 'Diferencia de precio', value: (priceFromMargin(cost, pctValue) ?? 0) - (priceFromMarkup(cost, pctValue) ?? 0), format: 'money2' },
    notes: ['El margen se calcula sobre el precio de venta; el markup, sobre el costo. No son equivalentes.'],
  });
}
