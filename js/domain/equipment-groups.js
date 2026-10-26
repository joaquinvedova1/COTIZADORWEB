/**
 * Equipos agrupados por familia (RES-02, PLAN-2026-024). Funciones puras: la
 * vista de Recursos sólo dibuja lo que devuelven.
 *
 * - Los grupos visibles juntan las familias descriptivas del catálogo
 *   (equipment-catalog.js). Cada familia está en un solo grupo (test).
 * - Cada ficha es una unidad. Las propias forman la flota; las alquiladas y
 *   tercerizadas se cuentan aparte y nunca suman a la flota ni a su costo.
 * - El monto de un grupo es el costo de TENER las propias por mes (la posesión
 *   de la ficha), sin usarlas. Una propia valuada en otra moneda sin tipo de
 *   cambio no se suma (no se mezclan monedas): el monto queda parcial.
 */

import { deepFreeze, isPlainObject } from '../core/object.js';
import { isFiniteNumber, roundMoney } from '../core/money.js';
import { familyById, familyIdOf } from './equipment-catalog.js';
import { acquisitionOf } from './quote-factory.js';
import { searchKey } from './labor-groups.js';

/** Grupos visibles, en el orden en que se muestran. "other" junta lo que no tiene familia. */
export const EQUIPMENT_GROUPS = deepFreeze([
  { id: 'cranes', title: 'Grúas', families: ['crane_truck', 'crane'] },
  { id: 'trucks', title: 'Camiones', families: ['truck', 'tank_truck', 'tractor'] },
  // Revisión de ChatGPT (Issue #4, punto 6): los equipos especiales no van con los camiones.
  { id: 'vacuum', title: 'Equipos de vacío y succión', families: ['vactor', 'vacuum_truck'] },
  { id: 'well', title: 'Equipos de pozo', families: ['flushby', 'wireline'] },
  { id: 'trailers', title: 'Remolques y tanques', families: ['semitrailer', 'lowboy', 'dump_trailer', 'tank', 'frac_tank'] },
  { id: 'light', title: 'Camionetas y vehículos livianos', families: ['pickup', 'minibus'] },
  { id: 'earthmoving', title: 'Movimiento de suelo', families: ['backhoe', 'excavator', 'wheel_loader', 'motor_grader'] },
  { id: 'support', title: 'Equipos de apoyo', families: ['generator', 'compressor', 'pump', 'welder', 'light_tower', 'forklift', 'telehandler', 'tools'] },
  { id: 'other', title: 'Otros / sin familia', families: ['other'] },
]);

/** Filtro de tenencia de la dirección (`?tenencia=`). */
export const TENURE_OWNED = 'propias';
export const TENURE_EXTERNAL = 'externas';

const GROUP_OF_FAMILY = new Map(EQUIPMENT_GROUPS.flatMap((g) => g.families.map((f) => [f, g.id])));
const ORDER = new Map(EQUIPMENT_GROUPS.map((g, i) => [g.id, i]));
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Grupo visible de una familia del catálogo ("other" si no está en ninguno). */
export function groupIdOfFamily(familyId) {
  return GROUP_OF_FAMILY.get(familyId) || 'other';
}

/** Grupo visible de una ficha de equipo (por su familia o su tipo anterior). */
export function equipmentGroupId(equipment) {
  return groupIdOfFamily(familyIdOf(isPlainObject(equipment) ? equipment : {}));
}

/**
 * Costo de tener una unidad propia por mes, de su ficha: la posesión, o null si
 * no se puede sumar (alquilada o tercerizada, sin ficha, o valuada en otra
 * moneda sin tipo de cambio).
 */
export function holdingMonthlyOf(equipment, card) {
  if (acquisitionOf(equipment) !== 'owned' || !isPlainObject(card)) return null;
  if (isPlainObject(card.currency) && card.currency.converted === false) return null;
  const value = isPlainObject(card.ownership) ? card.ownership.totalMonthly : null;
  return isFiniteNumber(value) ? value : null;
}

function summarize(group) {
  // Primero las propias (la flota), después las alquiladas y tercerizadas; dentro, por nombre.
  group.items.sort((a, b) => Number(b.owned) - Number(a.owned)
    || collator.compare(text(a.equipment.name), text(b.equipment.name))
    || collator.compare(text(a.equipment.internalCode), text(b.equipment.internalCode))
    || collator.compare(String(a.equipment.id || ''), String(b.equipment.id || '')));
  const owned = group.items.filter((i) => i.owned);
  const valued = owned.filter((i) => i.holdingMonthly !== null);
  group.ownedCount = owned.length;
  group.externalCount = group.items.length - owned.length;
  group.unvaluedCount = owned.length - valued.length;
  group.holdingMonthly = valued.length ? roundMoney(valued.reduce((s, i) => s + i.holdingMonthly, 0)) : null;
  // Parcial: alguna propia no se pudo sumar (otra moneda sin tipo de cambio).
  group.partial = group.holdingMonthly !== null && group.unvaluedCount > 0;
  return group;
}

/**
 * Agrupa las fichas por grupo visible. Los grupos sin fichas no se devuelven.
 * @param {object[]} equipment  resources.equipment
 * @param {{ cardOf?: (eq: object) => object|null }} options  ficha económica (equipmentCard) de cada unidad
 * @returns {Array<{ id: string, title: string, items: Array<{ equipment: object, familyId: string, familyLabel: string, owned: boolean, holdingMonthly: number|null, card: object|null }>, ownedCount: number, externalCount: number, unvaluedCount: number, holdingMonthly: number|null, partial: boolean }>}
 */
export function groupEquipment(equipment = [], { cardOf = () => null } = {}) {
  const groups = new Map();
  (Array.isArray(equipment) ? equipment : []).forEach((eq) => {
    if (!isPlainObject(eq)) return;
    const familyId = familyIdOf(eq);
    const id = groupIdOfFamily(familyId);
    if (!groups.has(id)) {
      const def = EQUIPMENT_GROUPS.find((g) => g.id === id);
      groups.set(id, { id, title: def.title, items: [] });
    }
    const card = cardOf(eq) || null;
    const family = familyById(familyId);
    groups.get(id).items.push({
      equipment: eq,
      familyId,
      familyLabel: family && family.id !== 'other' ? family.short || family.label : '',
      owned: acquisitionOf(eq) === 'owned',
      holdingMonthly: holdingMonthlyOf(eq, card),
      card,
    });
  });
  return [...groups.values()].map(summarize).sort((a, b) => ORDER.get(a.id) - ORDER.get(b.id));
}

/**
 * Filtra los grupos por tenencia (`propias` | `externas`) y por texto (nombre,
 * interno, dominio, familia, capacidad o modelo). Si el texto coincide con el
 * grupo, se ve el grupo entero. Los grupos vacíos no se muestran.
 * @param {{ query?: string, tenure?: string, modelLabelOf?: (eq: object) => string }} options
 */
export function filterEquipmentGroups(groups = [], { query = '', tenure = '', modelLabelOf = () => '' } = {}) {
  const q = searchKey(query);
  const keep = (i) => (tenure === TENURE_OWNED ? i.owned : tenure === TENURE_EXTERNAL ? !i.owned : true);
  const matches = (i) => [i.equipment.name, i.equipment.internalCode, i.equipment.plate, i.familyLabel, i.equipment.capacity, modelLabelOf(i.equipment)]
    .some((v) => searchKey(v).includes(q));
  return groups
    .map((g) => {
      const byTenure = g.items.filter(keep);
      const items = !q || searchKey(g.title).includes(q) ? byTenure : byTenure.filter(matches);
      return items.length === g.items.length ? g : summarize({ ...g, items });
    })
    .filter((g) => g.items.length > 0);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Conteos del encabezado de un grupo. Las alquiladas y tercerizadas se cuentan
 * aparte y lo dicen: no suman a la flota.
 *   "2 unidades propias · 1 alquilada o tercerizada (no suma)" · "3 unidades propias" · "1 alquilada o tercerizada (no suma)"
 */
export function equipmentCountsText(group) {
  const parts = [];
  if (group.ownedCount) parts.push(plural(group.ownedCount, 'unidad propia', 'unidades propias'));
  if (group.externalCount) parts.push(`${plural(group.externalCount, 'alquilada o tercerizada', 'alquiladas o tercerizadas')} (no ${group.externalCount === 1 ? 'suma' : 'suman'})`);
  return parts.join(' · ');
}
