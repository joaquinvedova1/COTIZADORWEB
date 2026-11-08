/**
 * Modalidad de CONTRATO de una cotización (PLAN-2026-018).
 *
 * La primera decisión al cotizar es cómo paga el cliente, no qué recurso se
 * ofrece. Se separan dos ejes que antes estaban mezclados en un único "tipo
 * de servicio":
 *
 *   1. ¿Cómo te paga el cliente?  (modo)
 *        monthly    Fijo mensual (mensualizado): un abono por mes con un horario
 *                   o cupo incluido, se trabaje o no.
 *        on_demand  Por servicio prestado (on call): sólo lo trabajado, por
 *                   hora, día, llamado, viaje, m³… (puede tener mínimo mensual).
 *        closed     Precio cerrado: un precio global por trabajo u obra (o hitos).
 *
 *   2. ¿Qué incluye?  (componentes combinables desde PLAN-2026-019:
 *        personal, vehículo, equipo, terceros, insumos, químicos… en
 *        cualquier combinación; labor / equipment se derivan de ellos)
 *        labor      Personal (cuadrilla, operador, chofer, técnicos).
 *        equipment  Equipos o vehículos (hidrogrúa, camión, colectivo, pick-up…).
 *
 * Lo que se cobra aparte del precio principal (fuera de horario, feriados,
 * llamados extra, km excedentes…) va en "Adicionales" (extras-engine) y se
 * suma a cualquier modo.
 *
 * `quote.serviceType` se sigue guardando (listados, plantillas, nombres de la
 * activación) y se DERIVA del contrato con serviceTypeForContract. Las
 * cotizaciones anteriores, sin `contract`, se leen desde su serviceType y su
 * unidad: no cambia ningún número.
 *
 * Sólo datos y reglas de dominio: nada de cálculo económico.
 */

import { deepFreeze, isPlainObject } from '../core/object.js';
import { BILLING_UNITS, BILLING_UNIT_IDS } from './billing-units.js';

export const CONTRACT_MODES = deepFreeze([
  { id: 'monthly', label: 'Fijo mensual', hint: 'Monto fijo por mes, se trabaje o no.' },
  { id: 'on_demand', label: 'Por servicio prestado (on call)', hint: 'Sólo lo trabajado (hora, día, viaje…).' },
  { id: 'closed', label: 'Precio cerrado', hint: 'Un precio por todo el trabajo u obra.' },
]);

export const CONTRACT_MODE_IDS = deepFreeze(CONTRACT_MODES.map((m) => m.id));

/**
 * ¿Qué incluye? Una sola elección: el transporte es un equipo o vehículo con
 * chofer (no una categoría aparte).
 */
export const CONTRACT_RESOURCES = deepFreeze([
  { id: 'labor', label: 'Sólo personal', hint: 'Cuadrilla, técnicos, operarios.', labor: true, equipment: false },
  { id: 'both', label: 'Equipo o vehículo con operador o chofer', hint: 'Hidrogrúa, camión, colectivo… (incluye transporte).', labor: true, equipment: true },
  { id: 'equipment', label: 'Equipo o vehículo sin operador', hint: 'Alquiler: lo opera el cliente.', labor: false, equipment: true },
]);

/**
 * Componentes del servicio (PLAN-2026-019): el servicio se ARMA sumando
 * componentes, en cualquier combinación (una persona con camioneta e
 * insumos, una cuadrilla con químicos, un equipo sin operador, un
 * subcontrato…). Cada componente dice en qué paso se carga su costo: el motor
 * no cambia, los componentes sólo ordenan qué se pide y qué se controla.
 *   equipment: true  → el servicio usa equipos o vehículos (se exige su costo).
 *   materials: true  → el servicio usa materiales (insumos, químicos, EPP…).
 * "Otros costos" y los componentes propios se cargan como otros costos directos.
 */
export const SERVICE_COMPONENTS = deepFreeze([
  { id: 'labor', label: 'Personal', hint: 'Operarios, técnicos, choferes, supervisión.', step: 'labor' },
  { id: 'vehicle', label: 'Vehículo', hint: 'Camioneta, utilitario, camión, colectivo (cargalo una sola vez).', step: 'equipment', equipment: true },
  { id: 'machinery', label: 'Equipo o maquinaria', hint: 'Hidrogrúa, hidrolavadora, retro, generador, equipo de soldadura o END.', step: 'equipment', equipment: true },
  { id: 'subcontract', label: 'Servicio de terceros', hint: 'Subcontrato, alquiler o laboratorio: pagás la tarifa de un proveedor.', step: 'equipment', equipment: true },
  { id: 'tools', label: 'Herramientas', hint: 'Herramientas menores y su reposición.', step: 'materials', materials: true },
  { id: 'supplies', label: 'Insumos y consumibles', hint: 'Electrodos, discos, gas, filtros, trapos.', step: 'materials', materials: true },
  { id: 'chemicals', label: 'Químicos', hint: 'Desengrasantes, sanitizantes, herbicidas, inhibidores.', step: 'materials', materials: true },
  { id: 'materials', label: 'Materiales que quedan en obra', hint: 'Pintura, caños, cables (se pueden facturar aparte).', step: 'materials', materials: true },
  { id: 'ppe', label: 'EPP especial', hint: 'Trajes, respiradores, arneses (el básico va en cada puesto).', step: 'materials', materials: true },
  { id: 'waste', label: 'Residuos y disposición', hint: 'Transporte habilitado, disposición final, certificados.', step: 'materials', materials: true },
  { id: 'travel', label: 'Viáticos y alojamiento', hint: 'Desarraigo, hotel, comidas, peajes.', step: 'logistics' },
  { id: 'other', label: 'Otros costos', hint: 'Permisos, seguros especiales, ingeniería, informes.', step: 'materials' },
]);

export const SERVICE_COMPONENT_IDS = deepFreeze(SERVICE_COMPONENTS.map((c) => c.id));
const EQUIPMENT_COMPONENTS = SERVICE_COMPONENTS.filter((c) => c.equipment).map((c) => c.id);

/**
 * Plantillas rápidas: PUNTOS DE PARTIDA editables, nunca categorías (PLAN-2026-019, ampliadas
 * en PLAN-2026-024). Marcan componentes y, cuando la plantilla lo dice, sugieren cómo paga el
 * cliente (`mode`) y en qué unidad (`unit`). No cargan montos ni recursos: después se suma o se
 * quita lo que haga falta (una "Cuadrilla por hora-hombre" con camioneta e insumos sigue siendo
 * la misma cotización). La unidad sugerida no se aplica si ya hay una tarifa o un mínimo
 * cargados (el número se leería en otra unidad). Un único catálogo: no hay otro sistema de
 * plantillas.
 *   group  grupo del selector (TEMPLATE_GROUPS)
 *   hint   qué arma, en una línea
 */
export const TEMPLATE_GROUPS = deepFreeze([
  { id: 'people', label: 'Personal' },
  { id: 'equipment', label: 'Equipos y vehículos' },
  { id: 'integral', label: 'Servicio integral' },
  { id: 'result', label: 'Por resultado o precio global' },
  { id: 'third', label: 'Terceros' },
]);

export const SERVICE_TEMPLATES = deepFreeze([
  { id: 'crew_manhour', group: 'people', label: 'Cuadrilla por hora-hombre', hint: 'Personal y herramientas; se cobra cada hora de cada persona.', components: ['labor', 'tools'], mode: 'on_demand', unit: 'manhour', keywords: 'hh hora hombre operarios solo personal' },
  { id: 'crew_day', group: 'people', label: 'Cuadrilla por día de trabajo', hint: 'Personal y herramientas; se cobra el día de la cuadrilla.', components: ['labor', 'tools'], mode: 'on_demand', unit: 'day', keywords: 'dia diario equipo de trabajo solo personal jornal' },
  { id: 'tech_pickup', group: 'people', label: 'Servicio técnico por hora', hint: 'Técnico con camioneta, herramientas e insumos; por hora.', components: ['labor', 'vehicle', 'tools', 'supplies'], mode: 'on_demand', unit: 'hour', keywords: 'tecnico camioneta insumos mantenimiento' },
  { id: 'field_crew', group: 'people', label: 'Personal en campo (abono mensual)', hint: 'Personas de tu nómina en la locación, con vehículo y viáticos; abono mensual.', components: ['labor', 'vehicle', 'travel'], mode: 'monthly', unit: 'month', keywords: 'campo locacion campamento guardia mensual abono' },
  { id: 'equipment_operator', group: 'equipment', label: 'Equipo con operador', hint: 'Equipo o maquinaria con su operador.', components: ['labor', 'machinery'], mode: 'on_demand', unit: 'hour', keywords: 'hidrogrua grua retro maquina' },
  { id: 'dry_rental', group: 'equipment', label: 'Equipo sin operador (alquiler)', hint: 'Sólo el equipo: lo opera el cliente.', components: ['machinery'], mode: 'on_demand', unit: 'day', keywords: 'alquiler seco' },
  { id: 'vehicle_driver', group: 'equipment', label: 'Vehículo con chofer', hint: 'Camión, colectivo o utilitario con su chofer.', components: ['labor', 'vehicle'], mode: 'on_demand', unit: 'trip', keywords: 'transporte camion colectivo flete' },
  { id: 'integral', group: 'integral', label: 'Servicio integral (personal, equipos y consumibles)', hint: 'Personal, vehículo, equipo, insumos y EPP especial. Sumá químicos o residuos si hacen falta.', components: ['labor', 'vehicle', 'machinery', 'supplies', 'ppe'], keywords: 'integral completo limpieza industrial quimicos residuos mantenimiento edilicio' },
  { id: 'per_unit', group: 'result', label: 'Servicio por unidad ejecutada', hint: 'Mano de obra y materiales; se cobra por unidad terminada (después elegís: válvula, junta, metro…).', components: ['labor', 'tools', 'supplies', 'materials'], mode: 'on_demand', unit: 'unit', keywords: 'unidad ejecutada valvula junta metro pieza produccion edilicio' },
  { id: 'lump_sum', group: 'result', label: 'Precio global por un trabajo definido', hint: 'Todo el alcance de un trabajo u obra, a precio cerrado.', components: ['labor', 'vehicle', 'tools', 'supplies', 'other'], mode: 'closed', unit: 'job', keywords: 'precio cerrado global obra llave en mano' },
  { id: 'third_party', group: 'third', label: 'Servicio de un tercero', hint: 'Subcontrato, alquiler o laboratorio de un proveedor.', components: ['subcontract'], keywords: 'subcontrato proveedor laboratorio' },
]);

/** Plantilla por id (o null). */
export function templateById(id) {
  return SERVICE_TEMPLATES.find((t) => t.id === id) || null;
}

/** "Personal" (nombre del grupo de una plantilla). */
export function templateGroupLabel(t) {
  return ((t && TEMPLATE_GROUPS.find((g) => g.id === t.group)) || {}).label || '';
}

/** Texto plano sin tildes y en minúsculas (buscador de plantillas). */
function plain(s) {
  // "jornad…" se busca como "día" (la cuadrilla por día de trabajo).
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/jornad[a-z]*/g, 'dia');
}

/**
 * Plantillas que coinciden con lo escrito (todas las palabras, en el nombre, la descripción,
 * el grupo o las palabras clave), en el orden del catálogo (agrupadas).
 */
export function searchTemplates(query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...SERVICE_TEMPLATES];
  return SERVICE_TEMPLATES.filter((t) => {
    const text = plain(`${t.label} ${t.hint} ${templateGroupLabel(t)} ${t.keywords || ''}`);
    return words.every((w) => text.includes(w));
  });
}

/** Componentes guardados, saneados (orden del catálogo, sin repetidos ni desconocidos); null si no hay lista. */
function cleanComponents(list) {
  if (!Array.isArray(list)) return null;
  const set = new Set(list.filter((id) => typeof id === 'string'));
  return SERVICE_COMPONENT_IDS.filter((id) => set.has(id));
}

/** Componentes nuevos personalizados ("Otro…": un nombre libre que se carga como otro costo directo). */
function cleanCustom(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, 60) : ''))
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, 20);
}

/** Componentes que equivalen a las marcas viejas personal / equipos. */
function componentsFromFlags(labor, equipment) {
  return [...(labor ? ['labor'] : []), ...(equipment ? ['machinery'] : [])];
}

/**
 * Contrato con los componentes elegidos (lo que se guarda). Las marcas
 * labor / equipment se derivan de los componentes y se siguen guardando.
 */
export function contractWithComponents(contract, components, custom = undefined) {
  const c = isPlainObject(contract) ? contract : {};
  const list = cleanComponents(components) || [];
  const out = {
    mode: CONTRACT_MODE_IDS.includes(c.mode) ? c.mode : 'on_demand',
    labor: list.includes('labor'),
    equipment: list.some((id) => EQUIPMENT_COMPONENTS.includes(id)),
    components: list,
  };
  const extra = cleanCustom(custom === undefined ? c.customComponents : custom);
  if (extra.length) out.customComponents = extra;
  // Plantilla de partida (PLAN-2026-024): sólo informativa, nunca cambia un número.
  if (templateById(c.templateId)) out.templateId = c.templateId;
  return out;
}

/** Componentes de un contrato (los guardados o, si no hay lista, los que equivalen a sus marcas). */
export function componentsOf(contract) {
  const c = isPlainObject(contract) ? contract : {};
  const list = cleanComponents(c.components);
  if (list) return list;
  const n = normalize(c);
  return componentsFromFlags(n.labor, n.equipment);
}

/** ¿El servicio usa materiales? (null si el contrato no tiene componentes). */
export function contractUsesMaterials(contract) {
  const c = isPlainObject(contract) ? contract : {};
  const list = cleanComponents(c.components);
  if (!list) return null;
  return list.some((id) => (SERVICE_COMPONENTS.find((x) => x.id === id) || {}).materials);
}

/**
 * Plantilla de la que partió el servicio: la elegida (`contract.templateId`) o, si no hay, la
 * primera cuyos componentes son exactamente los elegidos (o null). `edited` = se cambiaron los
 * componentes después de elegirla (sigue siendo un punto de partida, no una categoría).
 * Se acepta la lista de componentes (forma de siempre) o el contrato guardado.
 */
export function templateOf(componentsOrContract) {
  const isContract = isPlainObject(componentsOrContract);
  const list = cleanComponents(isContract ? componentsOrContract.components : componentsOrContract) || [];
  const same = (t) => t.components.length === list.length && t.components.every((id) => list.includes(id));
  const chosen = isContract ? templateById(componentsOrContract.templateId) : null;
  if (chosen) return { ...chosen, edited: !same(chosen) };
  const found = SERVICE_TEMPLATES.find(same);
  return found ? { ...found, edited: false } : null;
}

/** "Personal + Vehículo + Químicos" (nombre corto de lo que incluye). */
export function componentsLabel(contract) {
  const c = isPlainObject(contract) ? contract : {};
  const names = componentsOf(c).map((id) => (SERVICE_COMPONENTS.find((x) => x.id === id) || {}).label).filter(Boolean);
  return [...names, ...cleanCustom(c.customComponents)].join(' + ');
}

/** Elección de recursos de un contrato: 'labor' | 'both' | 'equipment'. */
export function resourceChoiceOf(contract) {
  const c = normalize(isPlainObject(contract) ? contract : {});
  if (c.labor && c.equipment) return 'both';
  return c.labor ? 'labor' : 'equipment';
}

/**
 * Unidades en que se cobra el precio principal según el modo (la primera es
 * la sugerida). Con "Por servicio prestado" el orden depende de si hay equipos.
 */
const ON_DEMAND_EQUIPMENT_UNITS = ['hour', 'day', 'call', 'trip', 'km', 'm3', 'ton', 'tonkm', 'liter', 'barrel', 'shift', 'unit', 'piece', 'well', 'test', 'meter', 'm2', 'ha', 'kg', 'lot', 'set', 'manhour',
  // Ampliación 2026-11 (al final: no cambia la unidad sugerida ni el orden de las de siempre).
  'equipment_hour', 'equipment_day', 'manday', 'guard', 'kwh', 'mwh', 'mj', 'gj', 'mmbtu', 'kw_day', 'kva_day', 'hp_hour', 'gas_m3',
  'stage', 'drilled_meter', 'connection', 'inch_dia', 'joint', 'point', 'pallet', 'container', 'drum', 'bag', 'sample', 'analysis'];
const ON_DEMAND_LABOR_UNITS = ['hour', 'day', 'call', 'manhour', 'shift', 'unit', 'piece', 'well', 'test', 'meter', 'm2', 'ha', 'lot', 'set',
  'manday', 'guard', 'stage', 'connection', 'inch_dia', 'joint', 'point', 'sample', 'analysis', 'm3', 'ton', 'drum', 'bag', 'kwh', 'mwh'];

export const CONTRACT_UNITS = deepFreeze({
  monthly: ['month'],
  closed: ['job', 'milestone'],
});

/** Contrato saneado { mode, labor, equipment } (sin recursos marcados = los dos). */
function normalize(contract) {
  const mode = CONTRACT_MODE_IDS.includes(contract.mode) ? contract.mode : 'on_demand';
  // Con componentes (PLAN-2026-019) las marcas salen de ellos: puede no haber
  // personal ni equipos (p. ej. sólo insumos u otros costos).
  const list = cleanComponents(contract.components);
  if (list && (list.length || cleanCustom(contract.customComponents).length)) {
    return {
      mode,
      labor: list.includes('labor'),
      equipment: list.some((id) => EQUIPMENT_COMPONENTS.includes(id)),
      legacy: false,
    };
  }
  let labor = contract.labor === true;
  let equipment = contract.equipment === true;
  if (!labor && !equipment) {
    labor = true;
    equipment = true;
  }
  return { mode, labor, equipment, legacy: false };
}

/** Contrato de una cotización anterior (sin `contract`), leído de su tipo de servicio y su unidad. */
function fromLegacy(quote) {
  const type = quote.serviceType;
  const unit = quote.unit;
  let mode = 'on_demand';
  if (type === 'lump_sum' || type === 'turnkey' || unit === 'job' || unit === 'milestone') mode = 'closed';
  else if (unit === 'month') mode = 'monthly';
  let labor = true;
  let equipment = true;
  if (type === 'equipment_only') labor = false;
  else if (type === 'crew' || type === 'permanent' || type === 'time_materials') equipment = false;
  return { mode, labor, equipment, legacy: true };
}

/**
 * Contrato de una cotización: el guardado o, en una anterior, el que se deduce.
 * @returns {{ mode: 'monthly'|'on_demand'|'closed', labor: boolean, equipment: boolean, legacy: boolean }}
 */
export function contractOf(quote = {}) {
  const q = isPlainObject(quote) ? quote : {};
  return isPlainObject(q.contract) ? normalize(q.contract) : fromLegacy(q);
}

/**
 * Tipo de servicio que se guarda junto al contrato (listados, plantillas,
 * nombre de la activación: llamado / trabajo / intervención).
 */
export function serviceTypeForContract(contract) {
  const c = normalize(isPlainObject(contract) ? contract : {});
  if (c.mode === 'closed') return 'lump_sum';
  if (!c.labor && !c.equipment) return 'configurable';
  if (!c.labor) return 'equipment_only';
  if (c.mode === 'on_demand') return 'on_call';
  return c.equipment ? 'equipment_with_operator' : 'crew';
}

/** Unidades del precio principal para un contrato (la primera es la sugerida). */
export function contractUnits(contract) {
  const c = normalize(isPlainObject(contract) ? contract : {});
  if (CONTRACT_UNITS[c.mode]) return [...CONTRACT_UNITS[c.mode]];
  return c.equipment ? [...ON_DEMAND_EQUIPMENT_UNITS] : [...ON_DEMAND_LABOR_UNITS];
}

/** ¿La unidad corresponde al contrato? (la unidad propia siempre vale con "por servicio"). */
export function unitFitsContract(contract, unit) {
  const c = normalize(isPlainObject(contract) ? contract : {});
  if (unit === 'custom') return c.mode === 'on_demand';
  return contractUnits(c).includes(unit || 'day');
}

/** Unidad sugerida para un contrato. */
export function defaultUnitForContract(contract) {
  return contractUnits(contract)[0];
}

/** Nombre corto del contrato para listados: "Fijo mensual · Personal y equipos". */
export function contractLabel(quote = {}) {
  const c = contractOf(quote);
  const mode = { monthly: 'Fijo mensual', on_demand: 'Por servicio (on call)', closed: 'Precio cerrado' }[c.mode];
  const q = isPlainObject(quote) ? quote : {};
  const res = !c.legacy && isPlainObject(q.contract) && Array.isArray(q.contract.components)
    ? componentsLabel(q.contract).toLowerCase() || 'sin componentes'
    : c.labor && c.equipment ? 'personal y equipos' : c.labor ? 'personal' : 'equipos';
  return `${mode} · ${res}`;
}

/** Unidades para elegir según el contrato (+ la actual si no está; + "Otra" si es por servicio). */
export function unitChoicesForContract(contract, currentUnit = null) {
  const c = normalize(isPlainObject(contract) ? contract : {});
  const list = contractUnits(c);
  if (currentUnit && BILLING_UNIT_IDS.includes(currentUnit) && currentUnit !== 'custom' && !list.includes(currentUnit)) list.push(currentUnit);
  if (c.mode === 'on_demand' || currentUnit === 'custom') list.push('custom');
  return list.map((id) => BILLING_UNITS.find((u) => u.id === id));
}

/**
 * Nombre del servicio para listados: con componentes (PLAN-2026-019), el
 * contrato y lo que incluye ("Por servicio (on call) · personal + vehículo");
 * si no, null (se usa el tipo de servicio de siempre).
 */
export function componentsServiceLabel(quote = {}) {
  const q = isPlainObject(quote) ? quote : {};
  if (!isPlainObject(q.contract) || !Array.isArray(q.contract.components) || !q.contract.components.length) return null;
  return contractLabel(q);
}
