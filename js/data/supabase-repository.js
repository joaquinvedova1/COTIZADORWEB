/**
 * SupabaseRepository — datos reales de una cuenta, en Supabase.
 *
 * Modelo: un workspace por organización (tabla workspace_states) con el
 * MISMO estado versionado que usa LocalStorageRepository (schemaVersion,
 * migraciones, validación, backup). Por eso hereda de él y trabaja sobre un
 * storage en memoria: toda la lógica de entidades, sellos, validación,
 * migraciones e importación es la misma. Los motores no saben que existe.
 *
 * Sincronización:
 * - Cada escritura se aplica en memoria y se sube enseguida (las escrituras
 *   públicas esperan la confirmación de la nube: "Guardado" significa
 *   guardado en la nube). Si falla, el método rechaza con un RepositoryError
 *   claro, el cambio NO se pierde y se reintenta.
 * - Control de revisión: se guarda sólo si la revisión del servidor sigue
 *   siendo la que se cargó. Si otro dispositivo guardó antes → conflicto
 *   visible (nunca last-write-wins silencioso); se bloquean más escrituras
 *   hasta que la persona elija recargar o conservar una copia.
 * - Copia local recuperable: mientras haya cambios sin subir, el estado se
 *   guarda en localStorage (rateos.cloud.<usuario>.<organización>). Al
 *   volver (otra pestaña, recarga, sin conexión, sesión vencida) se retoma.
 *   Cuando la nube confirma, la copia se borra.
 * - Las copias de recuperación (antes de importar, conflictos) van al
 *   localStorage del navegador con un prefijo propio de la cuenta
 *   (rateos.cloud.<usuario>.<organización>.recovery.): otra persona que use
 *   el mismo navegador no las ve ni las puede restaurar en su cuenta.
 */

import { STORAGE_KEYS } from '../config.js';
import { logger } from '../core/logger.js';
import { LocalStorageRepository } from './local-storage-repository.js';
import { MemoryStorage } from './memory-storage.js';
import { RepositoryError } from './storage-repository.js';
import { createEmptyState, RESOURCE_TYPES, validateState } from './schema.js';
import { WORKSPACE_ERRORS } from './workspace-gateway.js';
import { defaultSettings } from '../domain/quote-factory.js';
import { deepClone, isPlainObject } from '../core/object.js';

const WORKSPACE_KEY = 'rateos.workspace';
const RETRY_DELAYS_MS = Object.freeze([3000, 10000, 30000, 60000]);

/** Métodos que escriben: en la nube esperan la confirmación del guardado. */
const WRITE_METHODS = Object.freeze([
  'saveOrganization', 'saveResource', 'updateResource', 'deleteResource',
  'saveQuote', 'updateQuote', 'deleteQuote', 'saveService', 'deleteService',
  'saveSettings', 'importBackup',
]);

/** Mensajes para personas según el código de la nube. */
const SYNC_MESSAGES = Object.freeze({
  [WORKSPACE_ERRORS.conflict]: 'Tus datos cambiaron en otro dispositivo. Tus cambios de esta pestaña no se subieron.',
  [WORKSPACE_ERRORS.sessionExpired]: 'Tu sesión terminó. Volvé a ingresar: tus cambios quedaron guardados en este navegador.',
  [WORKSPACE_ERRORS.network]: 'No pudimos sincronizar tus cambios. Quedaron guardados en este navegador y vamos a reintentar.',
  [WORKSPACE_ERRORS.forbidden]: 'Tu rol en esta empresa no permite guardar cambios.',
  [WORKSPACE_ERRORS.tooLarge]: 'Los datos superan el máximo que se puede guardar (5 MB). Exportá un backup y eliminá cotizaciones que no uses.',
  [WORKSPACE_ERRORS.unknown]: 'No pudimos sincronizar tus cambios. Quedaron guardados en este navegador y vamos a reintentar.',
});

/** Estado inicial de una cuenta nueva: la organización real y NADA de demo. */
export function emptyWorkspaceState({ id, name }, now = new Date().toISOString()) {
  const organization = {
    id,
    organizationId: id,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Mi empresa',
    baseLocation: '',
    industry: '',
    notes: '',
    illustrative: false,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
  return createEmptyState(organization, defaultSettings(id));
}

export function cloudCacheKey(userId, organizationId) {
  return `${STORAGE_KEYS.cloudCachePrefix}${userId}.${organizationId}`;
}

/** Copias de recuperación de una cuenta: propias de ese usuario y esa organización. */
export function cloudRecoveryPrefix(userId, organizationId) {
  return `${cloudCacheKey(userId, organizationId)}.recovery.`;
}

export class SupabaseRepository extends LocalStorageRepository {
  /**
   * @param {{
   *   gateway: ReturnType<import('./workspace-gateway.js').createWorkspaceGateway>,
   *   organization: { id: string, name: string },
   *   userId: string,
   *   role: string,
   *   cacheStorage?: Storage|null,   localStorage del navegador (copia recuperable y copias de recuperación)
   *   now?: () => string, idFactory?: () => string, appVersion?: string,
   *   timers?: { setTimeout: Function, clearTimeout: Function },
   * }} options
   */
  constructor({ gateway, organization, userId, role, cacheStorage = null, now, idFactory, appVersion = 'dev', timers = globalThis, confirmSchemaUpgrade = null }) {
    const memory = new MemoryStorage();
    const nowFn = typeof now === 'function' ? now : () => new Date().toISOString();
    super(memory, {
      key: WORKSPACE_KEY,
      now: nowFn,
      idFactory,
      appVersion,
      recoveryStorage: cacheStorage || memory,
      recoveryPrefix: organization && typeof organization.id === 'string' ? cloudRecoveryPrefix(userId, organization.id) : undefined,
      seedFactory: () => emptyWorkspaceState(organization, nowFn()),
      confirmSchemaUpgrade,
    });
    if (!gateway || !organization || typeof organization.id !== 'string') throw new RepositoryError('Falta la organización de la cuenta.', 'invalid_storage');
    this.gateway = gateway;
    this.organization = { id: organization.id, name: organization.name };
    this.userId = userId;
    this.role = role;
    this.cacheStorage = cacheStorage;
    this.timers = timers;
    this.revision = 0;
    this.dirty = false;
    this.localVersion = 0;
    this.conflict = null;
    this.syncState = { status: 'idle', code: null, message: null, lastSavedAt: null };
    this.listeners = new Set();
    this.pushChain = Promise.resolve();
    this.retryTimer = null;
    this.retryIndex = 0;
    this.disposed = false;
    this.loading = true;
    this.wrapWriteMethods();
  }

  // ------------------------------------------------------------- estado

  /** Estado de sincronización para la UI: idle | saving | saved | pending | offline | conflict | session_expired | error. */
  getSyncState() {
    return { ...this.syncState, dirty: this.dirty, conflict: Boolean(this.conflict), revision: this.revision };
  }

  /** @param {(state: object) => void} listener @returns {() => void} */
  onSyncChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSync(status, { code = null, message = null } = {}) {
    this.syncState = { ...this.syncState, status, code, message, lastSavedAt: status === 'saved' ? this.now() : this.syncState.lastSavedAt };
    const snapshot = this.getSyncState();
    this.listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (error) {
        logger.warn('Error en un oyente de sincronización', { message: error && error.message });
      }
    });
  }

  get cacheKey() {
    return cloudCacheKey(this.userId, this.organization.id);
  }

  readCache() {
    if (!this.cacheStorage) return null;
    try {
      const raw = this.cacheStorage.getItem(this.cacheKey);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      if (!isPlainObject(cache) || cache.orgId !== this.organization.id || cache.userId !== this.userId || typeof cache.text !== 'string') return null;
      return cache;
    } catch {
      return null;
    }
  }

  writeCache(text) {
    if (!this.cacheStorage) return;
    try {
      this.cacheStorage.setItem(this.cacheKey, JSON.stringify({ v: 1, userId: this.userId, orgId: this.organization.id, baseRevision: this.revision, dirty: true, savedAt: this.now(), text }));
    } catch (error) {
      logger.warn('No se pudo guardar la copia local de los cambios pendientes', { name: error && error.name });
    }
  }

  clearCache() {
    if (!this.cacheStorage) return;
    try {
      this.cacheStorage.removeItem(this.cacheKey);
    } catch {
      /* nada que borrar */
    }
  }

  // --------------------------------------------------------------- init

  async init() {
    if (this.initResult) return this.initResult;
    const server = await this.gateway.loadWorkspace(this.organization.id);
    if (!server.ok) {
      const code = server.code === WORKSPACE_ERRORS.sessionExpired ? 'session_expired' : server.code === WORKSPACE_ERRORS.network ? 'network' : server.code === WORKSPACE_ERRORS.notFound ? 'not_found' : 'read_failed';
      throw new RepositoryError(code === 'network'
        ? 'No pudimos conectarnos para abrir tus datos. Revisá tu conexión y reintentá.'
        : code === 'not_found'
          ? 'No encontramos el espacio de trabajo de tu empresa.'
          : 'No se pudieron abrir tus datos en la nube.', code);
    }
    this.revision = Number.isFinite(server.revision) ? server.revision : 0;
    let text = server.state && isPlainObject(server.state) ? JSON.stringify(server.state) : null;
    let resumed = false;
    let conflictAtLoad = false;
    const cache = this.readCache();
    if (cache && cache.dirty) {
      if (cache.baseRevision === this.revision) {
        // Cambios de este navegador que no llegaron a subirse: se retoman.
        text = cache.text;
        resumed = true;
      } else {
        // Mientras tanto otro dispositivo guardó: no se pisa nada. Los cambios
        // locales quedan en una copia de recuperación y se avisa.
        conflictAtLoad = true;
        try {
          this.saveRecoverySnapshot(cache.text, 'cloud-unsynced');
        } catch (error) {
          logger.warn('No se pudo copiar los cambios sin sincronizar', { name: error && error.name });
        }
        this.conflictBackupText = cache.text;
        this.clearCache();
      }
    }
    if (text !== null) this.storage.setItem(this.key, text);
    const result = await super.init();
    // Los cambios retomados de la copia local todavía no están en la nube.
    if (resumed) {
      this.dirty = true;
      this.localVersion += 1;
    }
    // La organización real manda: id y nombre de la nube (RLS ya garantizó que es del usuario).
    this.adoptCloudOrganization();
    this.loading = false;
    if (this.role === 'VIEWER') this.readOnly = true;

    const messages = result.status === 'seeded' ? [] : [...(result.messages || [])];
    if (conflictAtLoad) messages.push('Tus datos cambiaron en otro dispositivo mientras había cambios de este navegador sin subir. Abrimos la versión más nueva; tus cambios quedaron en una copia de recuperación (Configuración → Datos y backup).');
    this.initResult = { ...result, status: result.status === 'seeded' ? 'new_workspace' : result.status, messages, resumed, conflictAtLoad };

    if (this.dirty && !this.readOnly) {
      try {
        await this.flush();
      } catch {
        /* queda pendiente: la UI muestra el estado de sincronización */
      }
    } else {
      this.setSync('saved');
    }
    return this.initResult;
  }

  /** Alinea el estado con la organización de la nube (id y nombre). */
  adoptCloudOrganization() {
    if (!this.state || !isPlainObject(this.state.organization)) return;
    const org = this.state.organization;
    if (org.id === this.organization.id && org.name === this.organization.name) return;
    const next = deepClone(this.state);
    next.organization = { ...org, id: this.organization.id, organizationId: this.organization.id, name: this.organization.name || org.name };
    if (isPlainObject(next.settings)) next.settings.organizationId = this.organization.id;
    if (!this.readOnly && validateState(next).ok) {
      this.persist(next);
      this.state = next;
    } else {
      this.state = next;
    }
  }

  /** Todas las entidades pasan a pertenecer a la organización de la cuenta. */
  remapToCloudOrganization() {
    const orgId = this.organization.id;
    this.mutate((draft) => {
      draft.organization = { ...draft.organization, id: orgId, organizationId: orgId, name: this.organization.name || draft.organization.name };
      if (isPlainObject(draft.settings)) draft.settings.organizationId = orgId;
      const own = (list) => (Array.isArray(list) ? list.forEach((item) => {
        if (isPlainObject(item)) item.organizationId = orgId;
      }) : undefined);
      RESOURCE_TYPES.forEach((type) => own(draft.resources[type]));
      own(draft.services);
      own(draft.quotes);
    });
  }

  // ------------------------------------------------------ escrituras

  persist(state) {
    super.persist(state);
    this.localVersion += 1;
    this.dirty = true;
    this.writeCache(this.storage.getItem(this.key));
    if (!this.conflict && this.syncState.status !== 'session_expired') this.setSync('pending');
  }

  ensureWritable() {
    if (this.conflict) {
      throw new RepositoryError('Tus datos cambiaron en otro dispositivo. Elegí "Recargar" o "Conservar una copia" antes de seguir editando.', 'conflict');
    }
    super.ensureWritable();
  }

  wrapWriteMethods() {
    WRITE_METHODS.forEach((name) => {
      const original = LocalStorageRepository.prototype[name];
      if (typeof original !== 'function') return;
      this[name] = async (...args) => {
        const result = await original.apply(this, args);
        if (name === 'saveOrganization') await this.renameCloudOrganization();
        // Un backup de OTRA organización (o manipulado) queda igual dentro del
        // workspace propio (RLS) y además se realinea a la organización real.
        if (name === 'importBackup') this.remapToCloudOrganization();
        await this.flush();
        return result;
      };
    });
  }

  async resetToDemo() {
    throw new RepositoryError('La demo no se carga en una cuenta real: está en la página pública "Ver demo".', 'unsupported_operation');
  }

  /** Si cambió el nombre de la empresa, también se actualiza la organización (OWNER/ADMIN). */
  async renameCloudOrganization() {
    const name = this.state && this.state.organization ? String(this.state.organization.name || '').trim() : '';
    if (!name || name === this.organization.name) return;
    const res = await this.gateway.renameOrganization(this.organization.id, name.slice(0, 120));
    if (res.ok) this.organization.name = name.slice(0, 120);
    else logger.warn('No se pudo renombrar la organización en la nube', { code: res.code });
  }

  /**
   * Sube los cambios pendientes. Resuelve cuando la nube confirmó; rechaza
   * con RepositoryError (sync_failed | conflict | session_expired |
   * forbidden | too_large) si no.
   */
  flush() {
    if (!this.dirty) return Promise.resolve(this.getSyncState());
    if (this.conflict) return Promise.reject(new RepositoryError(SYNC_MESSAGES.conflict, 'conflict'));
    const run = this.pushChain.then(() => this.pushPending());
    // La cadena sigue aunque un intento falle.
    this.pushChain = run.catch(() => undefined);
    return run;
  }

  async pushPending() {
    while (this.dirty && !this.disposed) {
      if (this.conflict) throw new RepositoryError(SYNC_MESSAGES.conflict, 'conflict');
      const version = this.localVersion;
      const text = this.storage.getItem(this.key);
      const state = JSON.parse(text);
      this.setSync('saving');
      const res = await this.gateway.saveWorkspace(this.organization.id, { state, schemaVersion: state.schemaVersion, baseRevision: this.revision });
      if (res.ok) {
        this.revision = res.revision;
        this.retryIndex = 0;
        this.clearRetry();
        if (this.localVersion === version) {
          this.dirty = false;
          this.clearCache();
          this.setSync('saved');
        } else {
          // Hubo cambios mientras se subía: la copia local sigue con la revisión nueva.
          this.writeCache(this.storage.getItem(this.key));
        }
        continue;
      }
      const code = res.code || WORKSPACE_ERRORS.unknown;
      if (code === WORKSPACE_ERRORS.conflict) {
        this.conflict = { serverRevision: res.serverRevision ?? null, detectedAt: this.now() };
        this.setSync('conflict', { code, message: SYNC_MESSAGES[code] });
        throw new RepositoryError(SYNC_MESSAGES[code], 'conflict');
      }
      if (code === WORKSPACE_ERRORS.sessionExpired) {
        this.setSync('session_expired', { code, message: SYNC_MESSAGES[code] });
        throw new RepositoryError(SYNC_MESSAGES[code], 'session_expired');
      }
      if (code === WORKSPACE_ERRORS.forbidden || code === WORKSPACE_ERRORS.tooLarge) {
        this.setSync('error', { code, message: SYNC_MESSAGES[code] });
        throw new RepositoryError(SYNC_MESSAGES[code], code);
      }
      this.setSync(code === WORKSPACE_ERRORS.network ? 'offline' : 'error', { code, message: SYNC_MESSAGES[code] || SYNC_MESSAGES.unknown });
      this.scheduleRetry();
      throw new RepositoryError(SYNC_MESSAGES[code] || SYNC_MESSAGES.unknown, 'sync_failed');
    }
    return this.getSyncState();
  }

  scheduleRetry() {
    if (this.retryTimer || this.disposed || !this.timers || typeof this.timers.setTimeout !== 'function') return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.flush().catch(() => undefined);
    }, delay);
  }

  clearRetry() {
    if (this.retryTimer && this.timers && typeof this.timers.clearTimeout === 'function') this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Reintentar ya (botón "Reintentar", volvió la conexión, se renovó la sesión). */
  retryNow() {
    this.clearRetry();
    if (this.syncState.status === 'session_expired') this.setSync('pending');
    return this.flush();
  }

  // ------------------------------------------------------- conflictos

  /** Texto (backup JSON) de la versión de este navegador, para descargar. */
  localCopyText() {
    const text = this.conflictBackupText || this.storage.getItem(this.key);
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return String(text || '');
    }
  }

  /**
   * "Recargar": abre la versión de la nube. Los cambios locales que no se
   * subieron quedan ANTES en una copia de recuperación (nunca se pierden).
   */
  async reloadFromCloud() {
    if (this.dirty || this.conflict) {
      try {
        this.saveRecoverySnapshot(this.storage.getItem(this.key), 'cloud-conflict-local');
      } catch (error) {
        logger.warn('No se pudo copiar la versión local antes de recargar', { name: error && error.name });
      }
    }
    const server = await this.gateway.loadWorkspace(this.organization.id);
    if (!server.ok) throw new RepositoryError(SYNC_MESSAGES[server.code] || SYNC_MESSAGES.unknown, server.code === WORKSPACE_ERRORS.sessionExpired ? 'session_expired' : 'sync_failed');
    this.clearRetry();
    this.conflict = null;
    this.conflictBackupText = null;
    this.clearCache();
    this.revision = Number(server.revision) || 0;
    // Se vuelve a abrir el estado de la nube con la misma lógica de init
    // (migraciones y validación), sin pasar por la copia local.
    this.storage.removeItem(this.key);
    if (server.state && isPlainObject(server.state)) this.storage.setItem(this.key, JSON.stringify(server.state));
    this.state = null;
    this.lastRaw = null;
    this.readOnly = false;
    this.initResult = null;
    this.loading = true;
    this.dirty = false;
    await LocalStorageRepository.prototype.init.call(this);
    this.adoptCloudOrganization();
    this.loading = false;
    if (this.role === 'VIEWER') this.readOnly = true;
    this.initResult = { status: 'loaded', messages: [], resumed: false, conflictAtLoad: false };
    if (this.dirty && !this.readOnly) await this.flush();
    else this.setSync('saved');
    return { ok: true };
  }

  // --------------------------------------------- importación de datos locales

  /**
   * Suma a la cuenta datos reales del modo local anterior (ya filtrados: sin
   * demo ni ILUSTRATIVOS). No reemplaza lo que ya hay: agrega lo que falta
   * por id. Todo queda con la organización de la cuenta. Guarda antes una
   * copia de recuperación del estado de la nube.
   * @param {object} data estado (formato backup, esquema actual)
   * @returns {Promise<{ quotes: number, resources: number, services: number, recoveryKey: string|null }>}
   */
  async importLocalData(data) {
    this.ensureWritable();
    if (!isPlainObject(data)) throw new RepositoryError('Datos locales inválidos.', 'invalid_backup');
    const recoveryKey = this.saveRecoverySnapshot(JSON.stringify(this.state), 'before-local-import');
    const orgId = this.organization.id;
    const counts = { quotes: 0, resources: 0, services: 0 };
    this.mutate((draft) => {
      const owned = (item) => ({ ...item, organizationId: orgId });
      const mergeList = (target, incoming) => {
        const ids = new Set(target.map((x) => x && x.id));
        let added = 0;
        (Array.isArray(incoming) ? incoming : []).forEach((item) => {
          if (!isPlainObject(item) || typeof item.id !== 'string' || ids.has(item.id)) return;
          target.push(owned(deepClone(item)));
          ids.add(item.id);
          added += 1;
        });
        return added;
      };
      RESOURCE_TYPES.forEach((type) => {
        if (!Array.isArray(draft.resources[type])) draft.resources[type] = [];
        counts.resources += mergeList(draft.resources[type], data.resources && data.resources[type]);
      });
      counts.services += mergeList(draft.services, data.services);
      counts.quotes += mergeList(draft.quotes, data.quotes);
      // Datos de la empresa: completa sólo lo vacío (el nombre de la cuenta manda).
      if (isPlainObject(data.organization)) {
        ['baseLocation', 'industry', 'activity', 'notes'].forEach((field) => {
          if (!draft.organization[field] && typeof data.organization[field] === 'string') draft.organization[field] = data.organization[field].slice(0, 500);
        });
      }
      // Configuración propia (no la de demostración): se adopta.
      if (isPlainObject(data.settings) && data.settings.illustrative !== true) {
        const before = draft.settings;
        draft.settings = { ...draft.settings, ...deepClone(data.settings), organizationId: orgId };
        // Lo que la cuenta ya definió no se pisa con un valor vacío: tipos de
        // cambio (se suman por moneda, gana el de la cuenta) y fecha base del combustible.
        const accountRates = Array.isArray(before.exchangeRates) ? before.exchangeRates.filter((r) => isPlainObject(r) && r.currency) : [];
        const importedRates = Array.isArray(data.settings.exchangeRates) ? data.settings.exchangeRates.filter((r) => isPlainObject(r) && r.currency) : [];
        draft.settings.exchangeRates = deepClone([...accountRates, ...importedRates.filter((r) => !accountRates.some((a) => a.currency === r.currency))]);
        const definedBase = (b) => isPlainObject(b) && typeof b.period === 'string' && b.period !== '';
        if (definedBase(before.fuelPriceBase) && !definedBase(data.settings.fuelPriceBase)) draft.settings.fuelPriceBase = deepClone(before.fuelPriceBase);
      }
      // Códigos COT-NNNN: nunca se repiten ni retroceden. Una cotización
      // importada cuyo código ya existe en la cuenta recibe uno nuevo.
      const numberOf = (code) => {
        const m = /^COT-(\d+)$/.exec(String(code || ''));
        return m ? Number(m[1]) : 0;
      };
      const last = (s) => (isPlainObject(s) && Number.isInteger(s.lastQuoteNumber) && s.lastQuoteNumber > 0 ? s.lastQuoteNumber : 0);
      let max = Math.max(last(draft.settings), last(data.settings), ...draft.quotes.map((q) => numberOf(q.code)));
      const seen = new Set();
      draft.quotes.forEach((q) => {
        if (q.code && seen.has(q.code)) {
          max += 1;
          q.code = `COT-${String(max).padStart(4, '0')}`;
        }
        if (q.code) seen.add(q.code);
      });
      draft.settings.lastQuoteNumber = max;
    });
    await this.flush();
    return { ...counts, recoveryKey };
  }

  /** Deja de reintentar y de avisar (al cerrar sesión). */
  dispose() {
    this.disposed = true;
    this.clearRetry();
    this.listeners = new Set();
  }
}
