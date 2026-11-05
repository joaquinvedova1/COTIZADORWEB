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
 *   2. ¿Qué incluye?  (recursos; uno o los dos)
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
  { id: 'monthly', label: 'Fijo mensual (mensualizado)', hint: 'Un monto por mes que cubre un horario o cupo, se trabaje o no. Lo que exceda se cobra como adicional.' },
  { id: 'on_demand', label: 'Por servicio prestado (on call)', hint: 'Sólo lo trabajado: por hora, día, llamado, viaje, m³… Puede tener un mínimo mensual.' },
  { id: 'closed', label: 'Precio cerrado (por trabajo u obra)', hint: 'Un precio global por el alcance, de una vez o por hitos.' },
]);

export const CONTRACT_MODE_IDS = deepFreeze(CONTRACT_MODES.map((m) => m.id));

/**
 * ¿Qué incluye? Una sola elección: el transporte es un equipo o vehículo con
 * chofer (no una categoría aparte).
 */
export const CONTRACT_RESOURCES = deepFreeze([
  { id: 'labor', label: 'Sólo personal', hint: 'Cuadrilla, técnicos, operarios. Sin equipos propios.', labor: true, equipment: false },
  { id: 'both', label: 'Equipo o vehículo con operador o chofer', hint: 'Hidrogrúa, camión, colectivo, pick-up con chofer… También transporte de cargas o personas.', labor: true, equipment: true },
  { id: 'equipment', label: 'Equipo o vehículo sin operador', hint: 'Alquiler: lo opera el cliente (pick-up, generador, trailer…).', labor: false, equipment: true },
]);

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
const ON_DEMAND_EQUIPMENT_UNITS = ['hour', 'day', 'call', 'trip', 'km', 'm3', 'ton', 'tonkm', 'liter', 'barrel', 'shift', 'unit', 'piece', 'well', 'test', 'meter', 'm2', 'ha', 'kg', 'lot', 'set', 'manhour'];
const ON_DEMAND_LABOR_UNITS = ['hour', 'day', 'call', 'manhour', 'shift', 'unit', 'piece', 'well', 'test', 'meter', 'm2', 'ha', 'lot', 'set'];

export const CONTRACT_UNITS = deepFreeze({
  monthly: ['month'],
  closed: ['job', 'milestone'],
});

/** Contrato saneado { mode, labor, equipment } (sin recursos marcados = los dos). */
function normalize(contract) {
  const mode = CONTRACT_MODE_IDS.includes(contract.mode) ? contract.mode : 'on_demand';
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
  const res = c.labor && c.equipment ? 'personal y equipos' : c.labor ? 'personal' : 'equipos';
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
