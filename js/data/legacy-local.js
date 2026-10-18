/**
 * Datos del modo local anterior (clave rateos.state del localStorage).
 *
 * Sólo LECTURA: nunca se borran ni se modifican (AGENTS.md §11). Se leen,
 * se migran EN MEMORIA al esquema actual y se filtran para quedarse con los
 * datos reales (sin demo ni ILUSTRATIVOS). La decisión de la persona
 * ("importar" o "empezar en limpio") se recuerda por usuario para no volver
 * a preguntar.
 *
 * Cuando una cuenta los IMPORTA, quedan "reclamados" en este navegador
 * (rateos.cloud.local-import.claimed, con una huella del texto y la fecha;
 * sin datos ni ids): ya no se le ofrecen a otra cuenta que ingrese en el mismo
 * navegador (PLAN-2026-015). Si el texto local cambiara, la huella deja de
 * coincidir.
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

const CLAIM_KEY = `${STORAGE_KEYS.cloudCachePrefix}local-import.claimed`;

/** Huella corta y determinística del texto local (FNV-1a de 32 bits): sólo para reconocerlo, no es secreta. */
export function legacyFingerprint(raw) {
  let hash = 0x811c9dc5;
  const text = String(raw ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}-${hash.toString(16).padStart(8, '0')}`;
}

/** ¿Estos datos locales ya los importó una cuenta en este navegador? */
export function isLegacyDataClaimed(raw, { storage = getBrowserStorage() } = {}) {
  if (!storage || typeof raw !== 'string') return false;
  try {
    const claim = JSON.parse(storage.getItem(CLAIM_KEY) || 'null');
    return Boolean(claim && typeof claim === 'object' && claim.fingerprint === legacyFingerprint(raw));
  } catch {
    return false;
  }
}

/** Marca los datos locales como importados por una cuenta (sin guardar datos ni ids). */
export function claimLegacyData(raw, { storage = getBrowserStorage(), now = new Date().toISOString() } = {}) {
  if (!storage || typeof raw !== 'string') return false;
  try {
    storage.setItem(CLAIM_KEY, JSON.stringify({ v: 1, fingerprint: legacyFingerprint(raw), claimedAt: now }));
    return true;
  } catch {
    return false;
  }
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
export function backupLegacyLocalData(raw, { storage = getBrowserStorage(), now = new Date().toISOString(), prefix = STORAGE_KEYS.recoveryPrefix } = {}) {
  if (!storage || typeof raw !== 'string') return null;
  const key = `${prefix}${now.replace(/[:.]/g, '-')}.before-cloud-import`;
  try {
    storage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}
