/**
 * Catálogo industrial de equipos (PLAN-2026-005).
 *
 * CATÁLOGO ≠ MIS EQUIPOS:
 * - El catálogo dice QUÉ TIPO de equipo existe (familia, y los modelos que
 *   cada empresa agrega: marca, modelo, año). Es descriptivo.
 * - "Mis equipos" (resources.equipment) son las unidades reales de la empresa,
 *   con su legajo económico (valor de reposición, seguros, mantenimiento…).
 *
 * Este archivo es GLOBAL (igual para todas las empresas): sólo familias con
 * características generales SUGERIDAS (¿suele ser autopropulsado? ¿circula por
 * ruta? ¿suele necesitar transporte? ¿necesita conductor?). No tiene precios,
 * valores económicos ni especificaciones técnicas de marcas o modelos: cada
 * empresa confirma las características de su unidad. Los modelos que agrega
 * una empresa (resources.equipmentModels) viven en SU workspace privado.
 */

import { deepFreeze } from '../core/object.js';

/**
 * Familias industriales generales.
 * selfPropelled / roadLegal / requiresTransport / requiresDriver: sugerencias
 * (true | false | null = depende de la unidad). consumption: cómo se suele
 * medir el consumo trabajando ('per_hour' L/h o 'none').
 */
export const EQUIPMENT_FAMILIES = deepFreeze([
  { id: 'vactor', label: 'Vactor / vacuum truck', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'crane_truck', label: 'Hidrogrúa (camión con hidrogrúa)', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'truck', label: 'Camión', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'tractor', label: 'Tractor (camión tractor)', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'semitrailer', label: 'Semirremolque', selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false, consumption: 'none' },
  { id: 'lowboy', label: 'Carretón / batea', selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false, consumption: 'none' },
  { id: 'backhoe', label: 'Retroexcavadora', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour' },
  { id: 'excavator', label: 'Excavadora', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour' },
  { id: 'telehandler', label: 'Manipulador telescópico', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour' },
  { id: 'crane', label: 'Grúa', selfPropelled: null, roadLegal: null, requiresTransport: null, requiresDriver: true, consumption: 'per_hour' },
  { id: 'forklift', label: 'Autoelevador', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour' },
  { id: 'generator', label: 'Generador', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour' },
  { id: 'compressor', label: 'Motocompresor', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour' },
  { id: 'pump', label: 'Bomba', selfPropelled: false, roadLegal: false, requiresTransport: true, requiresDriver: false, consumption: 'per_hour' },
  { id: 'flushby', label: 'Flushby', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'wireline', label: 'Wireline unit', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'frac_tank', label: 'Frac tank', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'none' },
  { id: 'tank_truck', label: 'Cisterna (camión cisterna)', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'pickup', label: 'Pickup / camioneta', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'minibus', label: 'Minibús / combi', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour' },
  { id: 'tools', label: 'Herramientas / equipos menores', selfPropelled: false, roadLegal: false, requiresTransport: true, requiresDriver: false, consumption: 'none' },
  { id: 'other', label: 'Otro', selfPropelled: null, roadLegal: null, requiresTransport: null, requiresDriver: null, consumption: 'per_hour' },
]);

export const EQUIPMENT_FAMILY_IDS = deepFreeze(EQUIPMENT_FAMILIES.map((f) => f.id));

/** Tipos de equipo del esquema 2 (EQUIPMENT_TYPES) → familia del catálogo. */
export const LEGACY_TYPE_TO_FAMILY = deepFreeze({
  vehicle: 'pickup',
  truck: 'truck',
  crane_truck: 'crane_truck',
  crane: 'crane',
  backhoe: 'backhoe',
  generator: 'generator',
  compressor: 'compressor',
  pump: 'pump',
  trailer: 'semitrailer',
  tools: 'tools',
  other: 'other',
});

/** Familia por id (o null). */
export function familyById(id) {
  return EQUIPMENT_FAMILIES.find((f) => f.id === id) || null;
}

/** Familia de un equipo: la propia o la de su tipo del esquema anterior. */
export function familyIdOf(equipment = {}) {
  if (equipment && EQUIPMENT_FAMILY_IDS.includes(equipment.familyId)) return equipment.familyId;
  const legacy = equipment && LEGACY_TYPE_TO_FAMILY[equipment.type];
  return legacy || 'other';
}

/** Nombre visible de un modelo del catálogo de la empresa: "Vac-Con PD4211 (2022)". */
export function modelLabel(model = {}) {
  const parts = [model.brand, model.model].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  const year = Number.isInteger(model.year) && model.year > 0 ? ` (${model.year})` : '';
  return parts.length ? `${parts.join(' ')}${year}` : 'Modelo sin nombre';
}

/**
 * Movilidad sugerida para una unidad nueva: lo que diga su modelo y, si no,
 * su familia. Siempre editable (son características generales, no specs).
 */
export function suggestedMobility(familyId, model = null) {
  const fam = familyById(familyId) || familyById('other');
  const pick = (key) => (model && typeof model[key] === 'boolean' ? model[key] : fam[key]);
  return {
    selfPropelled: pick('selfPropelled'),
    roadLegal: pick('roadLegal'),
    requiresTransport: pick('requiresTransport'),
    requiresDriver: pick('requiresDriver'),
  };
}
