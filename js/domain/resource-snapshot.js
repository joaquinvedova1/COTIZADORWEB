/**
 * SNAPSHOT de recursos en una cotización (PLAN-2026-005).
 *
 *   RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN
 *
 * Al agregar un recurso de la biblioteca a una cotización, la línea COPIA sus
 * valores (lo que el motor usa) y guarda un snapshot: qué valores y qué base
 * tenía el recurso en ese momento. El recurso maestro puede cambiar después;
 * la cotización no cambia sola (sólo avisa y ofrece actualizar a mano).
 *
 *   line.snapshot = {
 *     resourceType  'laborProfiles' | 'equipment' | 'materials' | 'externalServices'
 *     resourceId    id del recurso maestro
 *     resourceName  nombre al momento de copiar
 *     takenAt       fecha y hora de la copia (ISO) o null (snapshot anterior)
 *     legacy        true si lo armó la migración: no se sabe qué tenía el
 *                   recurso, se guardan los valores que usaba la línea
 *     values        valores económicos + base (lo que tenía el recurso)
 *     dismissed     huella del recurso cuya actualización se decidió NO aplicar
 *   }
 *
 * Funciones puras. La comparación con el recurso actual está en
 * js/domain/resource-sync.js.
 */

import { isPlainObject } from '../core/object.js';
import { normalizeBase } from './economic-base.js';

/** Campos ECONÓMICOS que se copian de cada tipo de recurso (los operativos —cantidad, horas, posiciones— son de la cotización). */
export const SNAPSHOT_FIELDS = Object.freeze({
  laborProfiles: Object.freeze([
    'basicMonthly', 'additionalsMonthly', 'normalHoursPerMonth', 'overtimePremiumPct', 'mealPerActiveDay',
    'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct',
    'insuranceMonthly', 'ppeMonthly', 'trainingMonthly', 'transferMonthly',
  ]),
  equipment: Object.freeze([
    'replacementValue', 'usefulLifeYears', 'residualValue', 'insuranceAnnual', 'licenseAnnual', 'certificationsAnnual',
    'otherAnnual', 'capitalRatePctAnnual', 'maintenancePerHour', 'tiresPerHour', 'fuelLitersPerHour',
  ]),
  materials: Object.freeze(['unitCost', 'wastePct', 'logisticsPct']),
  externalServices: Object.freeze([]),
});

export const SNAPSHOT_TYPES = Object.freeze(Object.keys(SNAPSHOT_FIELDS));

/** Campo económico principal de cada tipo (el que se muestra en "valor utilizado / valor actual"). */
export const MAIN_VALUE_FIELD = Object.freeze({
  laborProfiles: 'basicMonthly',
  equipment: 'replacementValue',
  materials: 'unitCost',
  externalServices: 'price',
});

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Copia canónica de las condiciones externas (orden fijo, números normalizados). */
function canonicalExternal(ext) {
  if (!isPlainObject(ext)) return null;
  const f = isPlainObject(ext.fiscal) ? ext.fiscal : {};
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  return {
    supplier: typeof ext.supplier === 'string' ? ext.supplier.trim() : '',
    price: num(ext.price),
    unit: typeof ext.unit === 'string' ? ext.unit : null,
    minimumUnits: num(ext.minimumUnits),
    validUntil: typeof ext.validUntil === 'string' ? ext.validUntil : null,
    operatorIncluded: bool(ext.operatorIncluded),
    fuelIncluded: bool(ext.fuelIncluded),
    fuelLitersPerHour: num(ext.fuelLitersPerHour),
    mobilizationIncluded: bool(ext.mobilizationIncluded),
    mobilizationAmount: num(ext.mobilizationAmount),
    insuranceIncluded: bool(ext.insuranceIncluded),
    fiscal: {
      vatPct: num(f.vatPct),
      vatRecoverable: typeof f.vatRecoverable === 'string' ? f.vatRecoverable : null,
      vatRecoverablePct: num(f.vatRecoverablePct),
      perceptionsPct: num(f.perceptionsPct),
      nonRecoverablePct: num(f.nonRecoverablePct),
      paymentTermDays: num(f.paymentTermDays),
    },
  };
}

/**
 * Valores económicos de una LÍNEA de cotización (lo que usa el motor), en la
 * misma forma que el snapshot. Equipos: también obtención, condiciones
 * externas, base de costos y consumo / desgaste en ruta.
 */
export function snapshotValuesFromLine(type, line = {}) {
  const l = isPlainObject(line) ? line : {};
  const fields = SNAPSHOT_FIELDS[type] || [];
  const values = Object.fromEntries(fields.map((f) => [f, num(l[f])]));
  values.base = normalizeBase(l.base);
  if (type === 'equipment' || type === 'externalServices') {
    values.acquisition = typeof l.acquisition === 'string' ? l.acquisition : 'owned';
    values.external = values.acquisition === 'owned' ? null : canonicalExternal(l.external);
    if (type === 'equipment') {
      values.costsBase = normalizeBase(l.costsBase);
      const m = isPlainObject(l.mobilization) ? l.mobilization : {};
      values.travel = { litersPer100Km: num(m.travelLitersPer100Km), costPerKm: num(m.travelCostPerKm) };
    }
  }
  return values;
}

/** Huella canónica (texto estable) de unos valores económicos. */
export function fingerprintOf(values) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    return v === undefined ? null : v;
  };
  return JSON.stringify(canonical(values));
}

/**
 * Snapshot de un recurso recién copiado a una línea: los valores de la línea
 * son exactamente los que tenía el recurso en ese momento.
 */
export function createSnapshot(type, resource = {}, line = {}, { now = null } = {}) {
  const r = isPlainObject(resource) ? resource : {};
  const name = r.name ?? r.role ?? r.description ?? '';
  return {
    resourceType: type,
    resourceId: typeof r.id === 'string' ? r.id : null,
    resourceName: typeof name === 'string' ? name.slice(0, 160) : '',
    takenAt: typeof now === 'string' ? now : null,
    legacy: false,
    values: snapshotValuesFromLine(type, line),
    dismissed: null,
  };
}

/**
 * Snapshot armado por la migración para una línea que ya existía: no se sabe
 * qué tenía el recurso al copiarse, así que se guardan los valores que usa
 * la línea (y se marca legacy: los avisos dicen "distinto", no "actualizado").
 */
export function legacySnapshot(type, line = {}, { resourceId = null, resourceName = '' } = {}) {
  return {
    resourceType: type,
    resourceId: typeof resourceId === 'string' && resourceId ? resourceId : null,
    resourceName: typeof resourceName === 'string' ? resourceName.slice(0, 160) : '',
    takenAt: null,
    legacy: true,
    values: snapshotValuesFromLine(type, line),
    dismissed: null,
  };
}
