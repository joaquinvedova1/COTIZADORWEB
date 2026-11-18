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
import { SERVICE_COMPONENTS } from '../domain/contract.js';

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

/**
 * Categorías de "¿Qué incluye el servicio?" que corresponden a cada renglón de la EECC (0.10.0):
 * un renglón en $ 0 de una categoría no elegida no se muestra.
 */
const ROW_COMPONENTS = Object.freeze({
  labor: ['labor'],
  equipment: ['vehicle', 'machinery'],
  // Revisión 0.10.0 (U7): "Servicios de terceros" en $ 0 sólo si se eligió; "Combustible" en $ 0, nunca.
  external: ['subcontract'],
  logistics: ['travel'],
});

/** Rubros de la estructura de costos con nombre de superficie distinto al del catálogo (0.10.0). */
const RUBRO_LABELS = Object.freeze({
  // Los nombres de "¿Qué incluye el servicio?" (paso 1) y de los pasos.
  labor: 'Personal',
  equipment: 'Equipos y vehículos',
  external: 'Servicios de terceros',
  logistics: 'Viáticos y traslados',
  structure: 'Gastos de estructura',
  contingency: 'Imprevistos',
  inflation: 'Inflación esperada',
});

/**
 * Nombre visible de un renglón de la EECC. El de equipos propios sigue lo elegido en "¿Qué
 * incluye el servicio?" (revisión 0.10.0, U7): sólo vehículos → "Vehículos"; sólo equipos →
 * "Equipos y maquinaria"; los dos (o sin componentes) → "Equipos y vehículos".
 * @param {string} category  id del renglón (labor, equipment… o materials:tools)
 * @param {string} [fallback]  rótulo del motor
 * @param {string[]|null} [components]  componentes elegidos (null = cotización sin componentes)
 */
export function costRowLabel(category, fallback = '', components = null) {
  if (category === 'equipment' && Array.isArray(components)) {
    const vehicle = components.includes('vehicle');
    const machinery = components.includes('machinery');
    if (vehicle && !machinery) return 'Vehículos';
    if (machinery && !vehicle) return 'Equipos y maquinaria';
  }
  return RUBRO_LABELS[category] || fallback || 'Otros';
}
/** Renglones que se muestran siempre (todas las cotizaciones pasan por esos pasos). */
const ALWAYS_ROWS = Object.freeze(['structure', 'financial', 'contingency']);

/**
 * Renglones de la estructura de costos POR CATEGORÍA ELEGIDA (0.10.0): el renglón Materiales se
 * reemplaza por su desglose del motor (`children`: herramientas, insumos, materiales, EPP, otros
 * costos) y no se muestran renglones en $ 0 de categorías no elegidas en "¿Qué incluye?".
 * Presentación pura: los montos y los % vienen del motor (la suma de los hijos es el renglón).
 *
 * @param {{ rows?: object[] }|null} eecc  result.eecc
 * @param {string[]|null} components  componentes elegidos (null = cotización sin componentes: no se esconde nada)
 * @returns {object[]} renglones con { category, label, amount, fixedMonthly, variablePerActiveDay, displayPct, component? }
 */
export function displayCostRows(eecc, components = null) {
  const chosen = Array.isArray(components) ? new Set(components) : null;
  const rows = eecc && Array.isArray(eecc.rows) ? eecc.rows : [];
  const positive = (v) => isFiniteNumber(v) && v > 0.005;
  const out = [];
  rows.forEach((row) => {
    // Inflación con precio fijo (K-01): sólo con monto.
    if (row.category === 'inflation' && !positive(row.amount)) return;
    if (row.category === 'materials' && (Array.isArray(row.children) && row.children.length || chosen)) {
      const children = Array.isArray(row.children) ? row.children : [];
      const ids = ['tools', 'supplies', 'materials', 'ppe', 'other'];
      ids.forEach((id) => {
        const child = children.find((c) => c.component === id);
        if (child) {
          if (positive(child.amount) || !chosen || chosen.has(id)) out.push({ ...child, category: `materials:${id}`, parent: 'materials' });
        } else if (chosen && chosen.has(id)) {
          out.push({ category: `materials:${id}`, parent: 'materials', component: id, label: (SERVICE_COMPONENTS.find((c) => c.id === id) || {}).label || id, amount: 0, fixedMonthly: 0, variablePerActiveDay: 0, displayPct: 0 });
        }
      });
      // Una parte de Materiales sin desglose (no debería pasar): se muestra como renglón propio.
      if (!children.length && positive(row.amount)) out.push(row);
      return;
    }
    if (!chosen || ALWAYS_ROWS.includes(row.category) || positive(row.amount)) {
      out.push(row);
      return;
    }
    const related = ROW_COMPONENTS[row.category];
    if (related && related.some((id) => chosen.has(id))) out.push(row);
  });
  return out;
}
