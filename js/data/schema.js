/**
 * Esquema de datos persistidos (localStorage y backups JSON).
 *
 * Formato (schemaVersion 3):
 * {
 *   schemaVersion: 3,
 *   organization: { id, name, ... },
 *   resources: { agreements: [], laborProfiles: [], equipment: [], materials: [], locations: [],
 *                equipmentModels: [], externalServices: [] },   // v3: catálogo propio y externos
 *   services: [],   // plantillas de servicio
 *   quotes: [],     // cotizaciones (v2: billingTaxes; v3: currency, offerDate, exchangeRates,
 *                   //   y en cada línea base + snapshot; equipos: acquisition, external, mobilization)
 *   settings: {}    // v2: defaultBillingTaxes; v3: fuelPriceBase, exchangeRates
 * }
 *
 * Este mismo formato es el que se exporta como backup y el que en el futuro
 * se importará a Supabase (ver docs/SUPABASE_PLAN.md).
 */

import { SCHEMA_VERSION } from '../config.js';
import { isPlainObject } from '../core/object.js';

export const CURRENT_SCHEMA_VERSION = SCHEMA_VERSION;

/** Tipos de recursos de biblioteca. */
export const RESOURCE_TYPES = Object.freeze(['agreements', 'laborProfiles', 'equipment', 'materials', 'locations', 'equipmentModels', 'externalServices']);

const LIMITS = Object.freeze({
  maxItemsPerCollection: 5000,
  maxStringLength: 20000,
  maxDepth: 12,
});

/** Estado vacío (sin datos demo). */
export function createEmptyState(organization = null, settings = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    organization: organization || null,
    resources: Object.fromEntries(RESOURCE_TYPES.map((t) => [t, []])),
    services: [],
    quotes: [],
    settings: { ...settings },
  };
}

/** Lee la versión de esquema de un estado (0 = legado / sin versión). */
export function detectSchemaVersion(state) {
  if (!isPlainObject(state)) return null;
  const v = state.schemaVersion;
  if (v === undefined) return 0;
  return Number.isInteger(v) && v >= 0 ? v : null;
}

function checkJsonSafe(value, path, errors, depth = 0) {
  if (errors.length > 20) return;
  if (depth > LIMITS.maxDepth) {
    errors.push(`${path}: estructura demasiado profunda.`);
    return;
  }
  if (value === null || value === undefined) return; // JSON.stringify omite undefined
  const t = typeof value;
  if (t === 'string') {
    if (value.length > LIMITS.maxStringLength) errors.push(`${path}: texto demasiado largo.`);
    return;
  }
  if (t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path}: número inválido.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > LIMITS.maxItemsPerCollection) errors.push(`${path}: demasiados elementos.`);
    value.forEach((v, i) => checkJsonSafe(v, `${path}[${i}]`, errors, depth + 1));
    return;
  }
  if (t === 'object') {
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        errors.push(`${path}: clave no permitida "${key}".`);
        continue;
      }
      checkJsonSafe(value[key], path ? `${path}.${key}` : key, errors, depth + 1);
    }
    return;
  }
  errors.push(`${path}: tipo de dato no soportado (${t}).`);
}

function checkEntityList(list, path, errors, { requireName = null } = {}) {
  if (!Array.isArray(list)) {
    errors.push(`${path}: debe ser una lista.`);
    return;
  }
  const ids = new Set();
  list.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`${path}[${i}]: debe ser un objeto.`);
      return;
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') errors.push(`${path}[${i}]: falta "id".`);
    else if (ids.has(item.id)) errors.push(`${path}[${i}]: id duplicado.`);
    else ids.add(item.id);
    if (requireName && typeof item[requireName] !== 'string') errors.push(`${path}[${i}]: falta "${requireName}".`);
  });
}

const QUOTE_OBJECT_FIELDS = Object.freeze(['activity', 'pricing', 'finance', 'logistics', 'rules', 'fuel', 'indirect', 'risk', 'billingTaxes']);
const QUOTE_LIST_FIELDS = Object.freeze(['labor', 'equipment', 'materials', 'otherCosts', 'exchangeRates']);
/** Sub-objetos de cada línea (v3): si están, deben ser objetos. */
const LINE_OBJECT_FIELDS = Object.freeze(['base', 'costsBase', 'snapshot', 'external', 'mobilization']);
const NESTED_LIST_FIELDS = Object.freeze([
  ['logistics', 'vehicles'],
  ['risk', 'items'],
  ['rules', 'volumeTiers'],
  ['billingTaxes', 'items'],
]);

function checkObjectList(value, path, errors) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path}: debe ser una lista.`);
    return;
  }
  value.forEach((item, i) => {
    if (!isPlainObject(item)) errors.push(`${path}[${i}]: debe ser un objeto.`);
  });
}

/** Forma interna de UNA cotización (o de los valores de una plantilla). */
function checkQuoteShape(q, base, errors) {
  if (!isPlainObject(q)) return;
  QUOTE_OBJECT_FIELDS.forEach((f) => {
    if (q[f] !== undefined && q[f] !== null && !isPlainObject(q[f])) errors.push(`${base}.${f}: debe ser un objeto.`);
  });
  QUOTE_LIST_FIELDS.forEach((f) => checkObjectList(q[f], `${base}.${f}`, errors));
  NESTED_LIST_FIELDS.forEach(([parent, child]) => {
    if (isPlainObject(q[parent])) checkObjectList(q[parent][child], `${base}.${parent}.${child}`, errors);
  });
  ['labor', 'equipment', 'materials'].forEach((f) => {
    if (!Array.isArray(q[f])) return;
    q[f].forEach((line, j) => {
      if (!isPlainObject(line)) return;
      LINE_OBJECT_FIELDS.forEach((k) => {
        if (line[k] !== undefined && line[k] !== null && !isPlainObject(line[k])) errors.push(`${base}.${f}[${j}].${k}: debe ser un objeto.`);
      });
    });
  });
  if (q.offerDate !== undefined && q.offerDate !== null && typeof q.offerDate !== 'string') errors.push(`${base}.offerDate: debe ser una fecha.`);
}

/** Forma interna de cada cotización y de los valores de cada plantilla. */
function checkQuoteShapes(quotes, errors, services = []) {
  if (Array.isArray(quotes)) quotes.forEach((q, i) => checkQuoteShape(q, `quotes[${i}]`, errors));
  // Una plantilla crea cotizaciones: sus valores deben tener la misma forma.
  if (Array.isArray(services)) {
    services.forEach((t, i) => {
      if (isPlainObject(t) && isPlainObject(t.defaults)) checkQuoteShape(t.defaults, `services[${i}].defaults`, errors);
    });
  }
}

/**
 * Valida la estructura de un estado en la versión ACTUAL del esquema.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateState(state) {
  const errors = [];
  if (!isPlainObject(state)) return { ok: false, errors: ['El contenido no es un objeto JSON válido de RATEOS.'] };
  if (state.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion esperado ${CURRENT_SCHEMA_VERSION}, recibido ${String(state.schemaVersion)}.`);
  }
  if (!isPlainObject(state.organization)) errors.push('organization: falta la organización.');
  else if (typeof state.organization.id !== 'string' || state.organization.id === '') errors.push('organization: falta "id".');
  if (!isPlainObject(state.resources)) errors.push('resources: debe ser un objeto.');
  else RESOURCE_TYPES.forEach((t) => checkEntityList(state.resources[t] ?? [], `resources.${t}`, errors));
  checkEntityList(state.services, 'services', errors, { requireName: 'name' });
  checkEntityList(state.quotes, 'quotes', errors, { requireName: 'name' });
  checkQuoteShapes(state.quotes, errors, state.services);
  if (!isPlainObject(state.settings)) errors.push('settings: debe ser un objeto.');
  else {
    const dbt = state.settings.defaultBillingTaxes;
    if (dbt !== undefined && dbt !== null && !isPlainObject(dbt)) errors.push('settings.defaultBillingTaxes: debe ser un objeto.');
    else if (isPlainObject(dbt)) checkObjectList(dbt.items, 'settings.defaultBillingTaxes.items', errors);
    checkObjectList(state.settings.exchangeRates, 'settings.exchangeRates', errors);
    const fb = state.settings.fuelPriceBase;
    if (fb !== undefined && fb !== null && !isPlainObject(fb)) errors.push('settings.fuelPriceBase: debe ser un objeto.');
  }
  if (errors.length === 0) checkJsonSafe(state, '', errors);
  return { ok: errors.length === 0, errors: errors.slice(0, 20) };
}

/**
 * Completa colecciones faltantes sin borrar nada existente.
 * (Se usa después de migrar.)
 */
export function normalizeState(state) {
  const out = { ...state };
  out.resources = { ...(isPlainObject(state.resources) ? state.resources : {}) };
  RESOURCE_TYPES.forEach((t) => {
    if (!Array.isArray(out.resources[t])) out.resources[t] = [];
  });
  if (!Array.isArray(out.services)) out.services = [];
  if (!Array.isArray(out.quotes)) out.quotes = [];
  if (!isPlainObject(out.settings)) out.settings = {};
  return out;
}
