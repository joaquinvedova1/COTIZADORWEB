/**
 * ImpactEngine — impacto incremental de una línea en el costo del mes
 * (PLAN-2026-010). Sólo TRAZABILIDAD: no cambia la contabilidad del motor.
 *
 * Una línea (por ejemplo, una pickup tercerizada de $ 2.800.000/mes) puede
 * subir el costo total más que su propio precio, porque arrastra estructura,
 * financiación, contingencia e IVA no recuperable. El impacto se calcula como
 * la diferencia entre la cotización con y sin la línea, con la misma
 * actividad:
 *
 *   impacto total = costo(con la línea) − costo(sin la línea)
 *                 = costo del proveedor + estructura asociada + financiación
 *                   asociada + contingencia asociada + otros impactos
 */

import { deepClone } from '../core/object.js';
import { computeQuote } from './quote-engine.js';

const CATEGORY_OF = Object.freeze({ structure: 'structure', financial: 'financial', contingency: 'contingency' });

/**
 * @param {object} quote cotización completa
 * @param {{ list?: string, index: number }} target línea a medir (por defecto, de `equipment`)
 * @param {object} [options] mismas opciones de computeQuote (settings…)
 * @returns {{ total:number, own:number, structure:number, financial:number, contingency:number, other:number, ownCategories:string[] } | null}
 */
export function lineIncrementalImpact(quote, { list = 'equipment', index } = {}, options = {}) {
  if (!quote || !Array.isArray(quote[list]) || !(index >= 0) || index >= quote[list].length) return null;
  const withLine = computeQuote(quote, options);
  const without = deepClone(quote);
  without[list].splice(index, 1);
  const withoutLine = computeQuote(without, options);
  const amount = (r, cat) => {
    const row = r.eecc.rows.find((x) => x.category === cat);
    return row ? row.amount : 0;
  };
  const delta = (cat) => amount(withLine, cat) - amount(withoutLine, cat);
  // El costo propio de la línea son sus rubros directos (externos y su combustible para un equipo externo).
  const ownCategories = list === 'equipment'
    ? (quote[list][index] && (quote[list][index].acquisition === 'rented' || quote[list][index].acquisition === 'outsourced') ? ['external'] : ['equipment', 'fuel'])
    : [list];
  const own = ownCategories.reduce((acc, c) => acc + delta(c), 0);
  const structure = delta(CATEGORY_OF.structure);
  const financial = delta(CATEGORY_OF.financial);
  const contingency = delta(CATEGORY_OF.contingency);
  const total = withLine.kpis.totalCost - withoutLine.kpis.totalCost;
  return { total, own, structure, financial, contingency, other: total - own - structure - financial - contingency, ownCategories };
}
