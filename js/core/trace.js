/**
 * Trazabilidad de cálculos ("Ver cálculo").
 *
 * Los motores devuelven objetos `trace` puramente de datos; la UI los
 * presenta. Nunca se muestran números mágicos: cada resultado importante
 * indica sus entradas, la fórmula y el resultado.
 */

/**
 * @typedef {{ label: string, value: number|string|null, format?: string, unit?: string }} TraceItem
 * @typedef {{ id: string, title: string, formula: string, inputs: TraceItem[], steps: TraceItem[], result: TraceItem, notes: string[] }} Trace
 */

/** Crea una traza de cálculo. */
export function createTrace({ id, title, formula, inputs = [], steps = [], result, notes = [] }) {
  return {
    id,
    title,
    formula,
    inputs: inputs.map(normalizeItem),
    steps: steps.map(normalizeItem),
    result: normalizeItem(result || { label: 'Resultado', value: null }),
    notes: notes.filter(Boolean).map(String),
  };
}

function normalizeItem(item) {
  return {
    label: String(item.label),
    value: item.value === undefined ? null : item.value,
    format: item.format || 'number',
    unit: item.unit || '',
  };
}
