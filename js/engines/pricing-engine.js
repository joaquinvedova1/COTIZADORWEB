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
 * Impuestos sobre la facturación (t: Ingresos Brutos, débitos y créditos,
 * sellos…) se pagan sobre lo que se FACTURA, no sobre el costo: van dentro del
 * divisor junto con el margen (gross-up exacto):
 *
 *     precio = costo / (1 − margen − t)      (válido si margen + t < 100 %)
 *     costo 100, t 10 %, margen 10 % → 125 (no 121 ni 123,46)
 *     tarifa piso (margen 0)          → costo / (1 − t) = 111,11
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

/** true si 0 ≤ impuestos < 100 (puntos). */
export function isValidBillingTaxPct(taxPct) {
  return isFiniteNumber(taxPct) && taxPct >= 0 && taxPct < 100;
}

/** true si el margen y los impuestos sobre la facturación dejan un divisor positivo. */
export function isValidMarginAndTaxes(marginPct, taxPct = 0) {
  return isValidMarginPct(marginPct) && isValidBillingTaxPct(taxPct) && marginPct + taxPct < 100;
}

/**
 * Precio que deja un margen sobre el precio DESPUÉS de pagar impuestos sobre
 * la facturación: costo / (1 − margen − impuestos). null si margen + impuestos ≥ 100.
 */
export function priceFromMarginAndTaxes(cost, marginPct, taxPct = 0) {
  if (!isFiniteNumber(cost) || !isValidMarginAndTaxes(marginPct, taxPct)) return null;
  return (cost * 100) / (100 - marginPct - taxPct);
}

/**
 * Recargo sobre el costo (markup) que implica un margen con impuestos sobre la
 * facturación: resultado / costo = m / (1 − m − t). Con t = 0 es marginToMarkup.
 */
export function effectiveMarkupPct(marginPct, taxPct = 0) {
  if (!isValidMarginAndTaxes(marginPct, taxPct)) return null;
  return (marginPct * 100) / (100 - marginPct - taxPct);
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
 * Escalera de precios para un costo dado. Con impuestos sobre la facturación
 * (t > 0) cada precio es costo / (1 − m − t): `billingTaxes` = t·precio,
 * `gain` = m·precio (resultado después de impuestos) y `markupPct` es el
 * recargo efectivo sobre el costo. Se omiten los márgenes con m + t ≥ 100.
 * @returns {{ key: string, label: string, marginPct: number, price: number|null, markupPct: number|null, billingTaxes: number|null, gain: number|null }[]}
 */
export function priceLadder(cost, marginsPct = DEFAULT_MARGIN_LADDER, customMarginPct = null, billingTaxPct = 0) {
  const t = isValidBillingTaxPct(billingTaxPct) ? billingTaxPct : 0;
  const row = (key, label, m) => {
    const price = priceFromMarginAndTaxes(cost, m, t);
    return {
      key,
      label,
      marginPct: m,
      price,
      markupPct: effectiveMarkupPct(m, t),
      billingTaxes: price === null ? null : (price * t) / 100,
      gain: price === null ? null : (price * m) / 100,
    };
  };
  const rows = [row('floor', 'Tarifa piso', 0)];
  marginsPct.filter((m) => isValidMarginAndTaxes(m, t)).forEach((m) => rows.push(row(`m${m}`, `Margen ${m} %`, m)));
  if (isValidMarginAndTaxes(customMarginPct, t) && !marginsPct.includes(customMarginPct) && customMarginPct > 0) {
    rows.push(row('custom', `Margen personalizado ${customMarginPct} %`, customMarginPct));
  }
  return rows;
}

/** Redondeo comercial hacia arriba (nunca baja el margen). */
export function commercialRound(price, step) {
  if (!isFiniteNumber(price)) return null;
  return roundUpToStep(price, nonNegative(step));
}

/**
 * Convierte una tarifa entre $/día y $/hora (horas por día activo).
 * Redondea HACIA ARRIBA al centavo (nunca baja el margen). El abono mensual
 * no es convertible sin ambigüedad: devuelve null.
 */
export function convertRateUnit(rate, fromUnit, toUnit, hoursPerActiveDay) {
  const hours = Number(hoursPerActiveDay);
  if (!isFiniteNumber(rate) || !(Number.isFinite(hours) && hours > 0)) return null;
  let converted = null;
  if (fromUnit === toUnit) converted = rate;
  else if (fromUnit === 'day' && toUnit === 'hour') converted = safeDivide(rate, hours, null);
  else if (fromUnit === 'hour' && toUnit === 'day') converted = rate * hours;
  if (!isFiniteNumber(converted)) return null;
  return Math.round(commercialRound(converted, 0.01) * 100) / 100;
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
