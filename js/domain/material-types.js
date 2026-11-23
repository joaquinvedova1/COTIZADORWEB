/**
 * Tipos de "Insumos y materiales" (PLAN-2026-027, 0.22.0): UN solo catálogo.
 *
 * Antes un mismo gasto se clasificaba hasta tres veces: la casilla de "¿Qué incluye?", la
 * sección o "Categoría" de la línea y el "Va a" de los otros costos. Ahora cada línea tiene un
 * tipo, que se elige una vez en Recursos (`resources.materials[].component`) y viaja con la
 * línea al agregarla. El id del tipo es el mismo `component` de siempre: el motor no cambia
 * (abre el renglón Materiales de la estructura de costos en sus hijos y pondera la
 * actualización de tarifas por tipo, como desde 0.10.0).
 *
 * Sólo datos y reglas de dominio: nada de cálculo económico. Este archivo no importa
 * contract.js (contract.js deriva LINE_COMPONENT_IDS de acá y lo re-exporta).
 */

import { deepFreeze, isPlainObject } from '../core/object.js';
import { billingUnitOf } from './billing-units.js';

/**
 *   label    rótulo largo (selector "Tipo", Recursos)
 *   short    rótulo corto (estructura de costos, subtotales, actualizar tarifa)
 *   hint     qué entra (ayuda del selector y de la actualización de tarifas)
 *   example  ejemplo que se ve en "¿Qué es?" mientras está vacío
 */
export const MATERIAL_TYPES = deepFreeze([
  { id: 'materials', label: 'Material que queda en la obra', short: 'Materiales', hint: 'Lo que queda en la obra: caños, cables, pintura.', example: 'Ej.: caño, cable, pintura' },
  { id: 'supplies', label: 'Insumo o consumible', short: 'Insumos y consumibles', hint: 'Lo que se gasta al trabajar: electrodos, discos, gas, filtros, químicos, repuestos que se consumen.', example: 'Ej.: electrodos, juntas, gas, filtros' },
  { id: 'tools', label: 'Herramienta menor (reposición)', short: 'Herramientas', hint: 'Lo que gastás en reponerlas (no el precio de compra entero). Si dura años y vale mucho, cargala en Equipos.', example: 'Ej.: amoladora, llaves, discos de corte' },
  { id: 'ppe', label: 'EPP especial', short: 'EPP especial', hint: 'Sólo el EPP especial del trabajo (trajes, respiradores, arneses). La ropa de trabajo y el EPP básico de cada persona van en su puesto, en Personal.', example: 'Ej.: traje descartable, arnés, respirador' },
  { id: 'other', label: 'Otro gasto', short: 'Otros gastos', hint: 'Permisos, seguros del trabajo, disposición de residuos, ingeniería.', example: 'Ej.: permiso, seguro del trabajo, residuos' },
]);

/**
 * Ids de los tipos, en el orden de siempre de las categorías de gasto (0.10.0): ese orden es el
 * de los hijos de la estructura de costos y el de la actualización de tarifas (fotos guardadas).
 */
export const MATERIAL_TYPE_IDS = deepFreeze(['tools', 'supplies', 'materials', 'ppe', 'other']);

/** Tipo preelegido de una línea en blanco (decisión D1 del plan). */
export const DEFAULT_BLANK_TYPE = 'supplies';

/** Definición de un tipo (o null). */
export function materialTypeById(id) {
  return MATERIAL_TYPES.find((t) => t.id === id) || null;
}

/** "Insumo o consumible" (o "Sin tipo"). */
export function materialTypeLabel(id) {
  const t = materialTypeById(id);
  return t ? t.label : 'Sin tipo';
}

/** "Insumos y consumibles" (rótulo corto; o el id si no es un tipo). */
export function materialTypeShort(id) {
  const t = materialTypeById(id);
  return t ? t.short : id;
}

/** Tipo guardado en un material de Recursos, o null si no tiene uno válido ("Sin tipo"). */
export function resourceMaterialType(mat) {
  const c = isPlainObject(mat) ? mat.component : null;
  return MATERIAL_TYPE_IDS.includes(c) ? c : null;
}

/** ¿Precio cerrado? (el modo guardado, o una cotización anterior por obra o llave en mano). */
function isClosedQuote(q) {
  if (isPlainObject(q.contract) && typeof q.contract.mode === 'string') return q.contract.mode === 'closed';
  return ['lump_sum', 'turnkey'].includes(q.serviceType) || ['job', 'milestone'].includes(q.unit);
}

/**
 * Base ("¿Cada cuánto se consume?") con que nace una línea nueva, según la unidad en que se
 * cobra y el tipo (P-03, PLAN-2026-027). Nunca la base guardada en Recursos: el maestro no
 * sabe en qué unidad se cobra cada cotización (un kit "por mes" agregado a una cotización por
 * válvula se leía como 40 kits por mes).
 *   precio cerrado o unidad de evento (llamado, trabajo, hito) → per_activation
 *   unidad de cantidad (válvula, m³, viaje…)                    → per_output (herramientas y otros gastos → per_month)
 *   el resto (mes, día, hora)                                   → per_month
 */
export function defaultMaterialBasis(quote = {}, type = DEFAULT_BLANK_TYPE) {
  const q = isPlainObject(quote) ? quote : {};
  const kind = billingUnitOf(q).kind;
  if (isClosedQuote(q) || kind === 'event') return 'per_activation';
  if (kind === 'quantity') return type === 'tools' || type === 'other' ? 'per_month' : 'per_output';
  return 'per_month';
}
