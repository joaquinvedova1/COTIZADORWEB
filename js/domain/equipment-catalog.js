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
 * short: nombre corto para sugerir el nombre de una unidad ("Vactor 12 yd³ / 1.500 gal").
 * variants: variantes DESCRIPTIVAS comunes (configuración o capacidad nominal) para
 * acelerar la carga. Son sólo sugerencias de texto: nunca precios, consumos ni
 * especificaciones económicas, y la persona siempre puede escribir la suya.
 */
export const EQUIPMENT_FAMILIES = deepFreeze([
  { id: 'vactor', label: 'Vactor / camión combinado', short: 'Vactor', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour',
    variants: ['5 yd³ / 1.000 gal', '10 yd³ / 1.300 gal', '12 yd³ / 1.500 gal', '15 yd³ / 1.500 gal'] },
  { id: 'vacuum_truck', label: 'Camión atmosférico / vacío', short: 'Camión atmosférico', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour',
    variants: ['4x2', '6x4'] },
  { id: 'crane_truck', label: 'Hidrogrúa (camión con hidrogrúa)', short: 'Hidrogrúa', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour',
    variants: ['Sobre camión 4x2', 'Sobre camión 6x4'] },
  { id: 'crane', label: 'Grúa', short: 'Grúa', selfPropelled: null, roadLegal: null, requiresTransport: null, requiresDriver: true, consumption: 'per_hour',
    variants: ['Sobre camión', 'Todo terreno', 'Sobre orugas'] },
  { id: 'tractor', label: 'Camión tractor', short: 'Camión tractor', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour',
    variants: ['4x2', '6x2', '6x4'] },
  { id: 'semitrailer', label: 'Semirremolque', short: 'Semirremolque', selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false, consumption: 'none',
    variants: ['3 ejes tándem', '3 ejes 1+2', '3 ejes 1+1+1', 'Sider', 'Carretón', 'Batea', 'Tanque'] },
  { id: 'lowboy', label: 'Carretón', short: 'Carretón', selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false, consumption: 'none',
    variants: ['2 ejes', '3 ejes', 'Extensible'] },
  { id: 'dump_trailer', label: 'Batea', short: 'Batea', selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false, consumption: 'none',
    variants: ['Volcadora trasera', 'Volcadora lateral'] },
  { id: 'tank', label: 'Tanque', short: 'Tanque', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'none',
    variants: [{ label: 'Semirremolque tanque', name: 'Semirremolque tanque' }, 'Estacionario', 'Sobre patín (skid)'] },
  { id: 'pickup', label: 'Camioneta', short: 'Camioneta', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour',
    variants: ['4x2', '4x4', 'Cabina doble 4x4'] },
  { id: 'minibus', label: 'Minibús', short: 'Minibús', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'backhoe', label: 'Retroexcavadora', short: 'Retroexcavadora', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour',
    variants: ['4x2', '4x4'] },
  { id: 'excavator', label: 'Excavadora', short: 'Excavadora', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour',
    variants: ['Sobre orugas', 'Sobre ruedas', { label: 'Miniexcavadora', name: 'Miniexcavadora' }] },
  { id: 'wheel_loader', label: 'Cargadora frontal', short: 'Cargadora frontal', selfPropelled: true, roadLegal: null, requiresTransport: null, requiresDriver: true, consumption: 'per_hour',
    variants: ['Sobre ruedas', 'Sobre orugas', { label: 'Minicargadora', name: 'Minicargadora' }] },
  { id: 'motor_grader', label: 'Motoniveladora', short: 'Motoniveladora', selfPropelled: true, roadLegal: null, requiresTransport: null, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'forklift', label: 'Autoelevador', short: 'Autoelevador', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour',
    variants: ['A combustión', 'Eléctrico', 'Todo terreno'] },
  { id: 'generator', label: 'Generador', short: 'Generador', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour',
    variants: ['Sobre trailer', 'Estacionario', 'Insonorizado'] },
  { id: 'compressor', label: 'Compresor / motocompresor', short: 'Compresor', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour',
    variants: ['Sobre trailer', 'Estacionario'] },
  { id: 'pump', label: 'Bomba', short: 'Bomba', selfPropelled: false, roadLegal: false, requiresTransport: true, requiresDriver: false, consumption: 'per_hour',
    variants: ['Centrífuga', 'De desplazamiento positivo', 'Sumergible'] },
  { id: 'welder', label: 'Equipo de soldadura', short: 'Equipo de soldadura', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour',
    variants: [{ label: 'Motosoldadora', name: 'Motosoldadora' }, 'Inverter (eléctrico)'] },
  { id: 'light_tower', label: 'Torre de iluminación', short: 'Torre de iluminación', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'per_hour',
    variants: ['Sobre trailer', 'LED'] },
  // Otras familias (se conservan: hay unidades y modelos que ya las usan).
  { id: 'truck', label: 'Camión', short: 'Camión', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour', variants: ['4x2', '6x4'] },
  { id: 'tank_truck', label: 'Cisterna (camión cisterna)', short: 'Camión cisterna', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'frac_tank', label: 'Frac tank', short: 'Frac tank', selfPropelled: false, roadLegal: null, requiresTransport: true, requiresDriver: false, consumption: 'none', variants: [] },
  { id: 'telehandler', label: 'Manipulador telescópico', short: 'Manipulador telescópico', selfPropelled: true, roadLegal: false, requiresTransport: true, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'flushby', label: 'Flushby', short: 'Flushby', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'wireline', label: 'Wireline unit', short: 'Wireline', selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, consumption: 'per_hour', variants: [] },
  { id: 'tools', label: 'Herramientas / equipos menores', short: 'Herramientas', selfPropelled: false, roadLegal: false, requiresTransport: true, requiresDriver: false, consumption: 'none', variants: [] },
  { id: 'other', label: 'Otro / Personalizado', short: '', selfPropelled: null, roadLegal: null, requiresTransport: null, requiresDriver: null, consumption: 'per_hour', variants: [] },
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

const lowerFirst = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/**
 * Variantes sugeridas de una familia: [{ label, name }]. `label` es lo que se
 * carga como capacidad / especificación; `name` es el nombre sugerido para la
 * unidad ("Vactor 12 yd³ / 1.500 gal", "Camión tractor 6x4"). Siempre editables.
 */
export function familyVariants(familyId) {
  const fam = familyById(familyId);
  if (!fam || !Array.isArray(fam.variants)) return [];
  return fam.variants.map((v) => {
    const label = typeof v === 'string' ? v : v.label;
    const name = typeof v === 'object' && v.name ? v.name : [fam.short, lowerFirst(label)].filter(Boolean).join(' ');
    return { label, name };
  });
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
