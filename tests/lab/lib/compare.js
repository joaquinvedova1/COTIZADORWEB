/**
 * RATEOS Test Lab — comparación motor productivo ↔ oráculo independiente.
 */

import { computeQuote } from '../../../js/engines/quote-engine.js';
import { computeProduct } from '../../../js/engines/product-engine.js';
import { oracleQuote, ORACLE_CATEGORIES } from './oracle.js';
import { oracleProduct } from './product-oracle.js';

/** Indicadores de una cotización que el oráculo calcula por su cuenta (§ de CALCULATION_RULES). */
export const QUOTE_KEYS = Object.freeze([
  ['activeDays', 'days'], ['billableQuantity', 'qty'], ['totalCost', 'money'], ['fixedCosts', 'money'], ['variableCosts', 'money'],
  ['floorNetRate', 'money'], ['floorListRate', 'money'], ['targetNetRate', 'money'], ['targetListRate', 'money'], ['suggestedListRate', 'money'],
  ['commercialListRate', 'money'], ['commercialNetRate', 'money'], ['revenue', 'money'], ['billingTaxes', 'money'], ['profit', 'money'],
  ['marginPct', 'pct'], ['markupPct', 'pct'], ['breakEvenDays', 'days'], ['breakEvenQuantity', 'qty'], ['breakEvenZeroReason', 'text'], ['targetMarginDays', 'days'],
  ['financialCost', 'money'], ['workingCapital', 'money'], ['logisticsMonthly', 'money'], ['externalMonthly', 'money'], ['externalCashMonthly', 'money'], ['externalTaxCreditMonthly', 'money'],
]);

export const PRODUCT_KEYS = Object.freeze([
  ['sellablePerBatch', 'qty'], ['variablePerUnit', 'money'], ['fixedPerUnit', 'money'], ['unitCost', 'money'], ['fixedMonthly', 'money'],
  ['pricing.floorPrice', 'money'], ['pricing.targetPrice', 'money'], ['pricing.suggestedPrice', 'money'], ['pricing.priceWithVat', 'money'],
  ['pricing.markupPct', 'pct'], ['pricing.breakEvenUnits', 'qty'], ['monthly.profit', 'money'],
  ['current.marginPct', 'pct'], ['current.breakEvenUnits', 'qty'], ['current.belowFloor', 'text'], ['current.belowVariable', 'text'],
  // Financiación de productos (PLAN-2026-014, LAB-D3).
  ['finance.financialPerUnit', 'money'], ['finance.financialMonthly', 'money'],
]);

const ORACLE_PRODUCT_PATH = {
  'pricing.floorPrice': 'floorPrice', 'pricing.targetPrice': 'targetPrice', 'pricing.suggestedPrice': 'suggestedPrice', 'pricing.priceWithVat': 'priceWithVat',
  'pricing.markupPct': 'markupPct', 'pricing.breakEvenUnits': 'breakEvenUnits', 'monthly.profit': 'monthlyProfit',
  'finance.financialPerUnit': 'financialPerUnit', 'finance.financialMonthly': 'financialMonthly',
};

/** Lee una ruta "a.b.0.c" (y "eecc.<categoría>" = monto de esa fila de la estructura de costos). */
export function resolvePath(result, path) {
  if (path.startsWith('eecc.')) {
    const row = result && result.eecc && Array.isArray(result.eecc.rows) ? result.eecc.rows.find((r) => r.category === path.slice(5)) : null;
    return row ? row.amount : undefined;
  }
  return path.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), result);
}

/** Tolerancia por tipo de magnitud (los motores no redondean: sólo ruido binario). */
export function tolerance(kind, expected) {
  const abs = Math.abs(Number(expected) || 0);
  if (kind === 'days' || kind === 'qty') return Math.max(1e-4, abs * 1e-9);
  if (kind === 'pct') return 1e-6;
  return Math.max(0.01, abs * 1e-9);
}

export function sameValue(actual, expected, kind = 'money') {
  const isNull = (v) => v === null || v === undefined;
  if (isNull(actual) && isNull(expected)) return true;
  if (typeof expected === 'number' && typeof actual === 'number') return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance(kind, expected);
  return actual === expected;
}

/** Compara una cotización: motor vs oráculo, indicador por indicador y fila por fila de la EECC. */
export function compareQuote(quote, { settings = {} } = {}) {
  const engine = computeQuote(structuredClone(quote), { settings });
  const oracle = oracleQuote(structuredClone(quote));
  const diffs = [];
  for (const [key, kind] of QUOTE_KEYS) {
    const actual = engine.kpis[key] ?? null;
    const expected = oracle.kpis[key] ?? null;
    if (!sameValue(actual, expected, kind)) diffs.push({ path: `kpis.${key}`, kind, expected, actual, delta: typeof actual === 'number' && typeof expected === 'number' ? actual - expected : null });
  }
  for (const c of ORACLE_CATEGORIES) {
    const actual = resolvePath(engine, `eecc.${c}`) ?? null;
    const expected = oracle.byCategory[c];
    if (!sameValue(actual, expected, 'money')) diffs.push({ path: `eecc.${c}`, kind: 'money', expected, actual, delta: typeof actual === 'number' ? actual - expected : null });
  }
  const transportPairs = [['physicalTripsPerMonth', 'qty'], ['kmPerTrip', 'qty'], ['routeKmPerMonth', 'qty']];
  for (const [key, kind] of transportPairs) {
    const actual = engine.model.transport ? engine.model.transport[key] : null;
    if (!sameValue(actual, oracle.transport[key], kind)) diffs.push({ path: `model.transport.${key}`, kind, expected: oracle.transport[key], actual, delta: typeof actual === 'number' ? actual - oracle.transport[key] : null });
  }
  oracle.transport.providers.forEach((p) => {
    const actual = (engine.model.transport.providers || []).find((x) => x.index === p.index);
    if (!actual || !sameValue(actual.netMonthly, p.netMonthly, 'money')) diffs.push({ path: `model.transport.providers[${p.index}].netMonthly`, kind: 'money', expected: p.netMonthly, actual: actual ? actual.netMonthly : null, delta: actual ? actual.netMonthly - p.netMonthly : null });
  });
  return { engine, oracle, diffs };
}

/** Compara un producto: motor vs oráculo. */
export function compareProduct(prod) {
  const engine = computeProduct(structuredClone(prod));
  const oracle = oracleProduct(structuredClone(prod));
  const diffs = [];
  for (const [path, kind] of PRODUCT_KEYS) {
    const actual = resolvePath(engine, path) ?? null;
    const expected = resolvePath(oracle, ORACLE_PRODUCT_PATH[path] || path) ?? null;
    if (!sameValue(actual, expected, kind)) diffs.push({ path, kind, expected, actual, delta: typeof actual === 'number' && typeof expected === 'number' ? actual - expected : null });
  }
  return { engine, oracle, diffs };
}

/** Busca NaN / Infinity en cualquier parte de un resultado (§5: nunca se muestran). */
export function findNonFinite(value, path = '', out = [], seen = new WeakSet()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(path || '(raíz)');
    return out;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return out;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) findNonFinite(v, path ? `${path}.${k}` : k, out, seen);
  }
  return out;
}
