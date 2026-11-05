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
 *   Con t, el markup sigue siendo precio = costo × (1 + markup) (AGENTS.md §9):
 *     markup            = (m + t) / (1 − m − t)   → 25 % (125 = 100 × 1,25)
 *   y la ganancia sobre el costo (lo que una cascada "costo + beneficio, y los
 *   impuestos encima" llama "beneficio sobre costo") es otra cosa:
 *     ganancia/costo    = m / (1 − m − t)         → 12,5 %
 *   Sin impuestos las dos coinciden con marginToMarkup.
 *
 * Todos los porcentajes se expresan en puntos (10 = 10 %).
 */

import { DEFAULT_MARGIN_LADDER } from '../config.js';
import { isFiniteNumber, nonNegative, safeDivide, roundUpToStep } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { parseDecimalInput } from '../core/validation.js';

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
 * Markup (recargo sobre el costo, AGENTS.md §9: precio = costo × (1 + markup))
 * que implica un margen con impuestos sobre la facturación:
 *   markup = precio / costo − 1 = (m + t) / (1 − m − t)
 * El recargo incluye la ganancia Y los impuestos. Con t = 0 es marginToMarkup.
 */
export function markupWithTaxesPct(marginPct, taxPct = 0) {
  if (!isValidMarginAndTaxes(marginPct, taxPct)) return null;
  return ((marginPct + taxPct) * 100) / (100 - marginPct - taxPct);
}

/**
 * Ganancia sobre el costo (resultado / costo) que implica un margen con
 * impuestos sobre la facturación: m / (1 − m − t). Es el "beneficio sobre
 * costo" de una cascada que suma el beneficio al costo y después agrega los
 * impuestos: precio = costo × (1 + ganancia/costo) / (1 − t). NO es el markup
 * (con t > 0, costo × (1 + ganancia/costo) queda por debajo del precio).
 * Con t = 0 es marginToMarkup.
 */
export function profitOnCostPct(marginPct, taxPct = 0) {
  if (!isValidMarginAndTaxes(marginPct, taxPct)) return null;
  return (marginPct * 100) / (100 - marginPct - taxPct);
}

/**
 * Lee un margen como lo valida validateQuote (número, o texto es-AR "10,5";
 * "10 %" también): { state: 'empty' | 'ok' | 'invalid', value }.
 * Vacío → 'empty' (el motor usa 0 y la completitud lo marca); inválido
 * (≥ 100, negativo, texto) → 'invalid' (nunca se reemplaza en silencio).
 */
export function readMarginInput(raw) {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { state: 'empty', value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseDecimalInput(raw) : NaN;
  return isValidMarginPct(n) ? { state: 'ok', value: n } : { state: 'invalid', value: null };
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
 * `gain` = m·precio (resultado después de impuestos), `markupPct` = precio /
 * costo − 1 (recargo sobre el costo) y `profitOnCostPct` = ganancia / costo.
 * Se omiten los márgenes con m + t ≥ 100.
 * @returns {{ key: string, label: string, marginPct: number, price: number|null, markupPct: number|null, profitOnCostPct: number|null, billingTaxes: number|null, gain: number|null }[]}
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
      markupPct: markupWithTaxesPct(m, t),
      profitOnCostPct: profitOnCostPct(m, t),
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

/** Tope del redondeo comercial: el paso nunca supera el 1 % del precio. */
export const MAX_ROUNDING_SHARE = 0.01;

/**
 * Paso de redondeo EFECTIVO para un precio: el configurado, salvo que sea más
 * del 1 % del precio; en ese caso, la mayor potencia de 10 que no lo supera.
 *   precio 4.444.444 $/día, paso 1.000 → 1.000 (sin cambios)
 *   precio 100,23 $/kg,     paso 1.000 → 1     (antes: 1.000 $/kg, +898 %)
 *   precio 8.474 $/m,       paso 1.000 → 10
 * Unidades baratas (kg, litro, m) ya no reciben un precio sugerido inflado.
 */
export function effectiveRoundingStep(price, step) {
  const s = nonNegative(step);
  const p = Math.abs(Number(price));
  if (!(s > 0) || !isFiniteNumber(p) || p <= 0) return s;
  const cap = p * MAX_ROUNDING_SHARE;
  if (s <= cap) return s;
  const pow = 10 ** Math.floor(Math.log10(cap));
  return Math.max(pow, 0.01);
}

/** Redondeo comercial hacia arriba (nunca baja el margen) con el paso indicado. */
export function commercialRound(price, step) {
  if (!isFiniteNumber(price)) return null;
  const s = nonNegative(step);
  const rounded = roundUpToStep(price, s);
  if (!(s > 0) || s >= 1) return rounded;
  // Pasos decimales: sin restos de coma flotante (100,23 → 100,3, no 100,30000000000001).
  const decimals = Math.min(2, Math.max(0, -Math.floor(Math.log10(s))));
  const fixed = Number(rounded.toFixed(decimals));
  return fixed >= price ? fixed : rounded;
}

/**
 * Redondeo de la tarifa SUGERIDA de un servicio: hacia arriba, con el paso
 * acotado al 1 % de la tarifa (effectiveRoundingStep). Así un paso de $ 1.000
 * pensado para tarifas por día no convierte 100 $/kg en 1.000 $/kg.
 */
export function suggestedRateRound(price, step) {
  if (!isFiniteNumber(price)) return null;
  return commercialRound(price, effectiveRoundingStep(price, step));
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
