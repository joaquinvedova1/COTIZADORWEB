/**
 * Datos del modo local anterior (clave rateos.state del localStorage).
 *
 * Sólo LECTURA: nunca se borran ni se modifican (AGENTS.md §11). Se leen,
 * se migran EN MEMORIA al esquema actual y se filtran para quedarse con los
 * datos reales (sin demo ni ILUSTRATIVOS). La decisión de la persona
 * ("importar" o "empezar en limpio") se recuerda por usuario para no volver
 * a preguntar.
 */

import { STORAGE_KEYS } from '../config.js';
import { migrateState } from './migrations.js';
import { CURRENT_SCHEMA_VERSION, detectSchemaVersion, validateState } from './schema.js';
import { extractRealData } from '../domain/real-data.js';
import { getBrowserStorage } from './memory-storage.js';

const DECISIONS = Object.freeze(['imported', 'skipped']);

function decisionKey(userId) {
  return `${STORAGE_KEYS.cloudCachePrefix}${userId}.local-import`;
}

/**
 * @param {{ storage?: Storage|null }} [options]
 * @returns {{ raw: string|null, real: ReturnType<typeof extractRealData> }}
 */
export function readLegacyLocalData({ storage = getBrowserStorage() } = {}) {
  const none = { raw: null, real: extractRealData(null) };
  if (!storage) return none;
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEYS.state);
  } catch {
    return none;
  }
  if (!raw) return none;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw, real: extractRealData(null) };
  }
  const version = detectSchemaVersion(parsed);
  if (version === null || version > CURRENT_SCHEMA_VERSION) return { raw, real: extractRealData(null) };
  let state = parsed;
  if (version < CURRENT_SCHEMA_VERSION) {
    try {
      state = migrateState(parsed).state;
    } catch {
      return { raw, real: extractRealData(null) };
    }
  }
  if (!validateState(state).ok) return { raw, real: extractRealData(null) };
  return { raw, real: extractRealData(state) };
}

export function getLocalImportDecision(userId, { storage = getBrowserStorage() } = {}) {
  if (!storage || !userId) return null;
  try {
    const value = storage.getItem(decisionKey(userId));
    return DECISIONS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function setLocalImportDecision(userId, decision, { storage = getBrowserStorage() } = {}) {
  if (!storage || !userId || !DECISIONS.includes(decision)) return false;
  try {
    storage.setItem(decisionKey(userId), decision);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copia de seguridad del texto local ANTES de importarlo (en una clave de
 * recuperación; el original sigue en rateos.state).
 */
export function backupLegacyLocalData(raw, { storage = getBrowserStorage(), now = new Date().toISOString() } = {}) {
  if (!storage || typeof raw !== 'string') return null;
  const key = `${STORAGE_KEYS.recoveryPrefix}${now.replace(/[:.]/g, '-')}.before-cloud-import`;
  try {
    storage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}
