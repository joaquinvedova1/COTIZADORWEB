/**
 * "¿En qué se va el costo?" — agrupación de la estructura de costos (EECC)
 * para las vistas simples (landing, demo guiada, resultado, inicio).
 *
 * Una sola regla en toda la interfaz: los `top` rubros más grandes, ordenados
 * de mayor a menor, y el resto sumado en "Otros". Los porcentajes se
 * redondean con el método del mayor resto, así que SIEMPRE suman 100 %.
 * Es presentación pura: no recalcula costos (los montos vienen del motor).
 */

import { isFiniteNumber, roundPercentagesToTotal } from '../core/money.js';

export const OTHERS_KEY = 'others';
export const OTHERS_LABEL = 'Otros';

/**
 * @param {{ rows?: { category: string, label: string, amount: number }[] }|null} eecc  result.eecc
 * @param {{ top?: number, decimals?: number }} [options]
 * @returns {{ key: string, label: string, amount: number, pct: number, categories: string[] }[]}
 */
export function costBreakdown(eecc, { top = 4, decimals = 0 } = {}) {
  const rows = (eecc && Array.isArray(eecc.rows) ? eecc.rows : [])
    .filter((r) => r && isFiniteNumber(r.amount) && r.amount > 0)
    .map((r, i) => ({ ...r, index: i }))
    .sort((a, b) => b.amount - a.amount || a.index - b.index);
  if (rows.length === 0) return [];
  const n = Math.max(1, Math.floor(Number(top) || 4));
  // Si sólo sobra un rubro, se muestra con su nombre (un "Otros" de un solo rubro no aporta).
  const head = rows.length <= n + 1 ? rows : rows.slice(0, n);
  const tail = rows.length <= n + 1 ? [] : rows.slice(n);
  const groups = head.map((r) => ({ key: r.category, label: r.label, amount: r.amount, categories: [r.category] }));
  if (tail.length) {
    groups.push({
      key: OTHERS_KEY,
      label: OTHERS_LABEL,
      amount: tail.reduce((s, r) => s + r.amount, 0),
      categories: tail.map((r) => r.category),
    });
  }
  const pcts = roundPercentagesToTotal(groups.map((g) => g.amount), decimals);
  return groups.map((g, i) => ({ ...g, pct: pcts[i] }));
}
