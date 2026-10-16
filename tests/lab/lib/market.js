/**
 * RATEOS Test Lab — MARKET SANITY (PLAN-2026-013 §9).
 *
 * Compara valores de un escenario con referencias de mercado guardadas en
 * tests/lab/market/references.json (sin internet: npm test nunca depende de la
 * red). El resultado es sólo informativo:
 *
 *   MARKET: PLAUSIBLE  dentro del rango comparable
 *   MARKET: REVIEW     fuera del rango: "Math PASS. X % sobre/bajo las
 *                      referencias. Revisar inputs: …"
 *   MARKET: UNKNOWN    sin referencia con buena evidencia (nunca se inventa)
 *
 * El mercado NO define la fórmula: una diferencia nunca cambia un cálculo.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REFERENCES_PATH = fileURLToPath(new URL('../market/references.json', import.meta.url));

export function loadReferences() {
  return JSON.parse(readFileSync(REFERENCES_PATH, 'utf8'));
}

const getPath = (obj, path) => path.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);

/** Qué revisar cuando un concepto queda fuera de las referencias (nunca "cambiá la fórmula"). */
const REVIEW_HINTS = {
  'fuel.diesel.ars_per_liter': 'precio del combustible (¿sin IVA?, ¿de qué fecha?, ¿compra a granel?)',
  'transport.semi.liters_per_100km': 'consumo del camión (¿L/100 km o km/L?, ¿cargado o vacío?)',
  'transport.semi.ars_per_km': 'tarifa del proveedor (¿neta?, ¿qué incluye?, ¿ida y vuelta?)',
  'transport.semi.ars_per_km_tariff': 'proveedor, estructura, financiación y margen',
  'transport.truck.ars_per_km': 'tarifa del proveedor (¿neta?, ¿qué incluye?)',
};

/** Métricas derivadas que el lab calcula del resultado (no son fórmulas nuevas: sólo divisiones de presentación). */
function derivedValue(kpi, result) {
  if (kpi === 'perKmTariff') {
    const t = result.model.transport;
    return result.kpis.commercialListRate && t && t.kmPerTrip > 0 ? result.kpis.commercialListRate / t.kmPerTrip : null;
  }
  return null;
}

/**
 * @param {object} scenario  { market: [{ concept, path?, kpi? }] }
 * @param {object} quote
 * @param {object} result    computeQuote(quote)
 * @param {object} [refs]    loadReferences()
 */
export function marketCheck(scenario, quote, result, refs = loadReferences()) {
  const out = [];
  for (const m of (scenario && scenario.market) || []) {
    const value = m.path ? Number(getPath(quote, m.path)) : derivedValue(m.kpi, result);
    const ref = refs.references.find((r) => r.concept === m.concept);
    if (!(Number.isFinite(value) && value > 0)) {
      out.push({ concept: m.concept, value: null, status: 'UNKNOWN', message: 'El escenario no tiene un valor para comparar.' });
      continue;
    }
    if (!ref) {
      const gap = (refs.withoutEvidence || []).find((g) => g.concept === m.concept);
      out.push({ concept: m.concept, value, status: 'UNKNOWN', message: gap ? gap.reason : 'Sin referencia de mercado con buena evidencia.' });
      continue;
    }
    const [lo, hi] = ref.comparable.range;
    if (value >= lo && value <= hi) {
      out.push({ concept: m.concept, value, status: 'PLAUSIBLE', reference: ref.id, range: [lo, hi], unit: ref.unit, confidence: ref.confidence, message: `Dentro de las referencias (${lo}–${hi} ${ref.unit}, ${ref.date}).` });
      continue;
    }
    const deviationPct = value < lo ? ((value - lo) / lo) * 100 : ((value - hi) / hi) * 100;
    out.push({
      concept: m.concept,
      value,
      status: 'REVIEW',
      reference: ref.id,
      range: [lo, hi],
      unit: ref.unit,
      confidence: ref.confidence,
      deviationPct,
      message: `Math PASS. ${Math.abs(deviationPct).toFixed(0)} % ${deviationPct < 0 ? 'debajo' : 'arriba'} de las referencias comparables (${lo}–${hi} ${ref.unit}, ${ref.date}, confianza ${ref.confidence}). Revisar inputs: ${REVIEW_HINTS[m.concept] || 'los datos del escenario'}. La fórmula no cambia por esto.`,
    });
  }
  return out;
}
