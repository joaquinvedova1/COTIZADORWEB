/**
 * Cotización ↔ Recursos (PLAN-2026-005): ¿cambió el recurso maestro desde que
 * se copió a esta cotización? Nunca actualiza solo: sólo informa y, si la
 * persona lo pide, aplica los valores actuales a UNA línea.
 *
 * Estados de una línea:
 *   unlinked  no viene de Recursos (se cargó a mano)
 *   missing   el recurso ya no existe: la cotización conserva sus valores
 *   current   el recurso sigue igual que cuando se copió
 *   changed   el recurso cambió después: ofrecer [Actualizar] [Conservar]
 *   dismissed cambió, pero se eligió conservar el valor original
 * y además `adjusted`: la línea tiene valores distintos de los que copió
 * (ajuste de esta cotización).
 *
 * Preparado para "Actualizar costos de esta oferta a valores actuales"
 * (resourceChanges devuelve la lista completa de cambios de una cotización).
 */

import { isPlainObject, deepClone } from '../core/object.js';
import { createId } from '../core/ids.js';
import { laborLineFromProfile, equipmentLineFromLibrary, externalLineFromService, materialLineFromLibrary } from './quote-factory.js';
import { snapshotValuesFromLine, economicFingerprint, changedKeys, MAIN_VALUE_FIELD } from './resource-snapshot.js';

/** Lista de la cotización y tipo de recurso de cada línea. */
const LIST_TYPES = Object.freeze({ labor: 'laborProfiles', equipment: 'equipment', materials: 'materials' });

function typeOfLine(listKey, line) {
  if (listKey === 'equipment' && isPlainObject(line.snapshot) && line.snapshot.resourceType === 'externalServices') return 'externalServices';
  return LIST_TYPES[listKey];
}

function resourceIdOf(line) {
  if (isPlainObject(line.snapshot) && typeof line.snapshot.resourceId === 'string' && line.snapshot.resourceId) return line.snapshot.resourceId;
  return typeof line.sourceId === 'string' && line.sourceId ? line.sourceId : null;
}

/** Línea "fresca" armada desde el recurso maestro (mismos factories que al agregarlo). */
function lineFromResource(type, resource, { resources = {}, now = null, currency, id = 'sync' } = {}) {
  const opts = { id, now, currency };
  switch (type) {
    case 'laborProfiles': {
      const agreements = Array.isArray(resources.agreements) ? resources.agreements : [];
      const agreement = agreements.find((a) => a.id === resource.agreementId) || null;
      return laborLineFromProfile(resource, agreement, opts);
    }
    case 'equipment':
      return equipmentLineFromLibrary(resource, opts);
    case 'externalServices':
      return externalLineFromService(resource, opts);
    case 'materials':
      return materialLineFromLibrary(resource, opts);
    default:
      return null;
  }
}

/** Valores económicos ACTUALES de un recurso maestro, en la forma del snapshot. */
export function currentResourceValues(type, resource, context = {}) {
  const fresh = lineFromResource(type, resource, context);
  return fresh ? snapshotValuesFromLine(type === 'externalServices' ? 'externalServices' : type, fresh) : null;
}

/**
 * Estado de una línea frente a su recurso maestro.
 * @param {'labor'|'equipment'|'materials'} listKey
 * @param {object} line
 * @param {object} resources  { laborProfiles, agreements, equipment, externalServices, materials }
 */
export function lineSyncStatus(listKey, line = {}, resources = {}, { currency } = {}) {
  const type = typeOfLine(listKey, line);
  const resourceId = resourceIdOf(line);
  const snap = isPlainObject(line.snapshot) ? line.snapshot : null;
  const used = snapshotValuesFromLine(type, line);
  if (!resourceId) return { state: 'unlinked', type, resourceId: null, adjusted: false, legacy: false, used, original: null, current: null, resource: null, changes: [] };
  const list = Array.isArray(resources[type]) ? resources[type] : [];
  const resource = list.find((r) => r && r.id === resourceId) || null;
  const original = snap && isPlainObject(snap.values) ? snap.values : used;
  const legacy = !snap || snap.legacy === true;
  const adjusted = economicFingerprint(used) !== economicFingerprint(original);
  if (!resource) return { state: 'missing', type, resourceId, adjusted, legacy, used, original, current: null, resource: null, changes: [] };
  const current = currentResourceValues(type, resource, { resources, currency });
  // Sólo cuentan los valores económicos: re-fechar el mismo valor en Recursos
  // no desactualiza la cotización (ni la re-fecha).
  const currentPrint = economicFingerprint(current);
  let state = currentPrint === economicFingerprint(original) ? 'current' : 'changed';
  if (state === 'changed' && snap && snap.dismissed === currentPrint) state = 'dismissed';
  const changes = state === 'current' ? [] : changedKeys(original, current);
  return { state, type, resourceId, adjusted, legacy, used, original, current, resource, changes };
}

/** Valor principal (para "valor utilizado / valor actual") de unos valores de snapshot. */
export function mainValueOf(type, values) {
  if (!isPlainObject(values)) return null;
  if (type === 'externalServices' || (values.acquisition && values.acquisition !== 'owned')) {
    return isPlainObject(values.external) ? values.external.price : null;
  }
  const key = MAIN_VALUE_FIELD[type];
  return key ? values[key] ?? null : null;
}

/** Campos operativos que se conservan al actualizar una línea desde Recursos. */
const KEEP_ON_UPDATE = Object.freeze({
  laborProfiles: ['id', 'positions', 'peoplePerPosition', 'overtimeHoursPerActiveDay'],
  equipment: ['id', 'quantity', 'hoursPerActiveDay', 'operatorLaborId'],
  externalServices: ['id', 'quantity', 'hoursPerActiveDay', 'operatorLaborId'],
  materials: ['id', 'quantity', 'basis', 'providedBy'],
});

/**
 * "Actualizar en esta cotización": la línea toma los valores ACTUALES del
 * recurso (y un snapshot nuevo) y conserva lo operativo de la cotización
 * (cantidad, horas, posiciones, cómo llega al servicio). Devuelve una línea nueva.
 */
export function applyResourceUpdate(listKey, line, resources = {}, { now = null, currency } = {}) {
  const status = lineSyncStatus(listKey, line, resources, { currency });
  if (!status.resource) return deepClone(line);
  // Una línea sin id (datos viejos) recibe uno nuevo: nunca un id compartido.
  const id = typeof line.id === 'string' && line.id ? line.id : createId();
  const fresh = lineFromResource(status.type, status.resource, { resources, now, currency, id });
  const next = { ...fresh };
  (KEEP_ON_UPDATE[status.type] || ['id']).forEach((k) => {
    if (Object.hasOwn(line, k)) next[k] = deepClone(line[k]);
  });
  next.id = id;
  if (listKey === 'equipment' && isPlainObject(line.mobilization)) {
    // Cómo llega al servicio es una decisión de la cotización. Del legajo de
    // "Mis equipos" se toman el consumo y el desgaste en ruta; un servicio
    // externo no los tiene: se conservan los de la línea.
    next.mobilization = status.type === 'equipment'
      ? { ...deepClone(line.mobilization), travelLitersPer100Km: fresh.mobilization.travelLitersPer100Km, travelCostPerKm: fresh.mobilization.travelCostPerKm }
      : deepClone(line.mobilization);
  }
  if (isPlainObject(next.snapshot)) next.snapshot.resourceId = status.resourceId;
  return next;
}

/** "Conservar valor original": recuerda que esta versión del recurso no se aplica. */
export function dismissResourceUpdate(listKey, line, resources = {}, { currency } = {}) {
  const status = lineSyncStatus(listKey, line, resources, { currency });
  const next = deepClone(line);
  if (!status.current) return next;
  const snap = isPlainObject(next.snapshot) ? next.snapshot : {
    resourceType: status.type, resourceId: status.resourceId, resourceName: '', takenAt: null, legacy: true, values: status.used, dismissed: null,
  };
  snap.dismissed = economicFingerprint(status.current);
  next.snapshot = snap;
  return next;
}

/**
 * Todas las líneas de una cotización cuyo recurso cambió (estado "changed").
 * Base de la futura "Actualizar costos de esta oferta a valores actuales".
 */
export function resourceChanges(quote = {}, resources = {}, { currency } = {}) {
  const out = [];
  ['labor', 'equipment', 'materials'].forEach((listKey) => {
    (Array.isArray(quote[listKey]) ? quote[listKey] : []).forEach((line, index) => {
      if (!isPlainObject(line)) return;
      const status = lineSyncStatus(listKey, line, resources, { currency });
      if (status.state === 'changed') out.push({ listKey, index, lineId: line.id ?? null, ...status });
    });
  });
  return out;
}
