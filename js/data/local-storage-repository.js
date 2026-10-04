/**
 * LocalStorageRepository — implementación actual de StorageRepository.
 *
 * - Guarda TODO el estado en una sola clave (STORAGE_KEYS.state) con
 *   schemaVersion.
 * - Los datos sobreviven recargas, cierres del navegador y nuevos deploys
 *   (la clave no depende de la versión de la app).
 * - Antes de migrar, importar un backup o restaurar la demo, guarda una
 *   copia del estado anterior en una clave de recuperación.
 * - Si el contenido guardado está dañado, NO lo borra: lo copia a una clave
 *   de recuperación y arranca con datos demo.
 * - Si los datos son de una versión más nueva de RATEOS, entra en modo
 *   sólo lectura para no pisarlos.
 * - Nunca usa localStorage.clear().
 */

import { STORAGE_KEYS, APP_NAME } from '../config.js';
import { createId } from '../core/ids.js';
import { deepClone, isPlainObject } from '../core/object.js';
import { logger } from '../core/logger.js';
import { StorageRepository, RepositoryError } from './storage-repository.js';
import { CURRENT_SCHEMA_VERSION, RESOURCE_TYPES, validateState, detectSchemaVersion, createEmptyState } from './schema.js';
import { migrateState, MigrationError } from './migrations.js';
import { createDemoState } from '../domain/demo-data.js';

/** Cantidad máxima de copias de recuperación conservadas. */
export const MAX_RECOVERY_SNAPSHOTS = 3;

export class LocalStorageRepository extends StorageRepository {
  /**
   * @param {Storage} storage objeto con la interfaz Web Storage
   * @param {{ key?: string, now?: () => string, idFactory?: () => string, seedFactory?: () => object, appVersion?: string }} [options]
   */
  constructor(storage, { key = STORAGE_KEYS.state, now = () => new Date().toISOString(), idFactory = createId, seedFactory = null, appVersion = 'dev' } = {}) {
    super();
    if (!storage || typeof storage.getItem !== 'function') throw new RepositoryError('Storage inválido.', 'invalid_storage');
    this.storage = storage;
    this.key = key;
    this.now = now;
    this.idFactory = idFactory;
    this.seedFactory = seedFactory || (() => createDemoState(CURRENT_SCHEMA_VERSION));
    this.appVersion = appVersion;
    this.state = null;
    this.readOnly = false;
    this.initResult = null;
    /** Último texto leído o escrito en storage: detecta cambios de otras pestañas. */
    this.lastRaw = null;
    /** Cantidad de veces que se adoptaron cambios hechos en otra pestaña. */
    this.externalChanges = 0;
  }

  // ---------------------------------------------------------------- init

  async init() {
    if (this.initResult) return this.initResult;
    const messages = [];
    let status = 'loaded';
    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (error) {
      throw new RepositoryError('No se pudo leer el almacenamiento local.', 'read_failed', error);
    }

    if (raw === null) {
      this.state = this.seedFactory();
      this.persist(this.state);
      status = 'seeded';
      messages.push('Se cargaron datos de demostración ILUSTRATIVOS.');
    } else {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const version = parsed === undefined ? null : detectSchemaVersion(parsed);
      if (parsed === undefined || version === null) {
        const recoveryKey = this.saveRecoverySnapshot(raw, 'corrupt');
        if (!recoveryKey) {
          // Sin espacio para la copia: NO se pisa el original. La app muestra la
          // pantalla de recuperación, que permite descargar el texto guardado.
          throw new RepositoryError(
            'Los datos guardados están dañados y no hay espacio para guardar una copia. No se modificaron: descargalos con el botón de abajo y liberá espacio en el navegador.',
            'corrupt_no_space',
          );
        }
        this.state = this.seedFactory();
        this.persist(this.state);
        status = 'recovered';
        messages.push(`Los datos guardados estaban dañados. Se conservó una copia (${recoveryKey}) y se cargó la demo.`);
      } else if (version > CURRENT_SCHEMA_VERSION) {
        this.state = parsed;
        this.lastRaw = raw;
        this.readOnly = true;
        status = 'read_only';
        messages.push('Los datos fueron guardados por una versión más nueva de RATEOS. Se abren en modo sólo lectura para no dañarlos. Recargá la página para obtener la última versión.');
      } else if (version < CURRENT_SCHEMA_VERSION) {
        const recoveryKey = this.saveRecoverySnapshot(raw, `pre-migration-v${version}`);
        const migrated = migrateState(parsed, { now: this.now(), idFactory: this.idFactory });
        this.state = migrated.state;
        this.lastRaw = raw;
        if (validateState(this.state).ok) {
          this.persist(this.state);
          status = 'migrated';
          messages.push(`Datos actualizados del esquema ${version} al ${CURRENT_SCHEMA_VERSION}. Copia previa: ${recoveryKey}.`);
        } else {
          // La migración no produjo un estado válido: no se persiste nada
          // (el original sigue intacto) y se abre en sólo lectura.
          this.readOnly = true;
          status = 'read_only';
          messages.push(`No se pudieron actualizar los datos guardados al esquema ${CURRENT_SCHEMA_VERSION}. No se modificaron (copia previa: ${recoveryKey}). Se abren en modo sólo lectura: exportá un backup y contactá soporte.`);
        }
      } else {
        const check = validateState(parsed);
        if (!check.ok) {
          // Datos con estructura inesperada: se conservan intactos en
          // recuperación y se normaliza lo posible sin borrar nada.
          const recoveryKey = this.saveRecoverySnapshot(raw, 'invalid');
          const repaired = migrateState({ ...parsed, schemaVersion: undefined }, { now: this.now(), idFactory: this.idFactory }).state;
          repaired.schemaVersion = CURRENT_SCHEMA_VERSION;
          if (validateState(repaired).ok) {
            this.state = repaired;
            this.persist(this.state);
            status = 'repaired';
            messages.push(`Se repararon datos con estructura inesperada. Copia original: ${recoveryKey}.`);
          } else {
            this.state = this.seedFactory();
            this.persist(this.state);
            status = 'recovered';
            messages.push(`No se pudieron interpretar los datos guardados. Se conservó una copia (${recoveryKey}) y se cargó la demo.`);
          }
        } else {
          this.state = parsed;
          this.lastRaw = raw;
        }
      }
    }
    this.initResult = { status, messages, readOnly: this.readOnly };
    logger.info('Repositorio local inicializado', { status });
    return this.initResult;
  }

  // ------------------------------------------------------------ helpers

  ensureReady() {
    if (!this.state) throw new RepositoryError('Repositorio no inicializado: llamá a init().', 'not_initialized');
    this.syncFromStorage();
  }

  /**
   * Varias pestañas comparten el mismo localStorage. Antes de leer o escribir
   * se compara el texto guardado con el último conocido: si otra pestaña lo
   * cambió, se adopta su versión para no pisar sus cambios con una copia
   * vieja en memoria (cada escritura reemplaza el estado completo).
   */
  syncFromStorage() {
    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return; // no se puede leer: se sigue con la memoria
    }
    if (raw === null || raw === this.lastRaw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const version = parsed === undefined ? null : detectSchemaVersion(parsed);
    if (version === CURRENT_SCHEMA_VERSION && validateState(parsed).ok) {
      this.state = parsed;
      this.lastRaw = raw;
      this.externalChanges += 1;
      return;
    }
    if (version !== null && version > CURRENT_SCHEMA_VERSION) {
      // Otra pestaña con una versión más nueva de la app migró los datos.
      this.state = parsed;
      this.lastRaw = raw;
      this.readOnly = true;
      return;
    }
    throw new RepositoryError('Los datos cambiaron en otra pestaña y no se pudieron leer. Recargá la página.', 'stale_state');
  }

  ensureWritable() {
    this.ensureReady();
    if (this.readOnly) throw new RepositoryError('Modo sólo lectura: los datos no se pueden modificar en esta versión de RATEOS (recargá la página).', 'read_only');
  }

  persist(state) {
    const text = JSON.stringify(state);
    try {
      this.storage.setItem(this.key, text);
      this.lastRaw = text;
    } catch (error) {
      const quota = error && (error.name === 'QuotaExceededError' || error.code === 22);
      throw new RepositoryError(
        quota
          ? 'El almacenamiento del navegador está lleno. Exportá un backup y liberá espacio: eliminá copias de recuperación viejas (Configuración) o cotizaciones que no uses.'
          : 'No se pudieron guardar los datos en el navegador.',
        quota ? 'quota_exceeded' : 'write_failed',
        error,
      );
    }
  }

  /** Aplica una mutación de forma transaccional (si falla, no cambia nada). */
  mutate(mutator) {
    this.ensureWritable();
    const draft = deepClone(this.state);
    const result = mutator(draft);
    const check = validateState(draft);
    if (!check.ok) throw new RepositoryError(`Datos inválidos: ${check.errors.join(' ')}`, 'validation_failed');
    // Copia final: corta toda referencia a objetos del llamador (entidades o
    // patches anidados) para que la memoria nunca difiera de lo persistido.
    const next = deepClone(draft);
    this.persist(next);
    this.state = next;
    return deepClone(result);
  }

  stamp(entity, existing = null) {
    const now = this.now();
    return {
      ...entity,
      id: typeof entity.id === 'string' && entity.id ? entity.id : this.idFactory(),
      organizationId: entity.organizationId ?? (existing && existing.organizationId) ?? this.state.organization.id,
      createdAt: (existing && existing.createdAt) || entity.createdAt || now,
      updatedAt: now,
      createdBy: (existing && existing.createdBy) ?? entity.createdBy ?? null,
      updatedBy: entity.updatedBy ?? null,
    };
  }

  checkResourceType(type) {
    if (!RESOURCE_TYPES.includes(type)) throw new RepositoryError(`Tipo de recurso desconocido: ${type}.`, 'unknown_type');
  }

  // ------------------------------------------------------- organization

  async getOrganization() {
    this.ensureReady();
    return deepClone(this.state.organization);
  }

  async saveOrganization(organization) {
    if (!isPlainObject(organization)) throw new RepositoryError('Organización inválida.', 'invalid');
    return this.mutate((s) => {
      s.organization = this.stamp({ ...s.organization, ...organization, id: s.organization.id, organizationId: undefined }, s.organization);
      delete s.organization.organizationId;
      return s.organization;
    });
  }

  // ---------------------------------------------------------- resources

  async getResources(type) {
    this.ensureReady();
    if (type === undefined) return deepClone(this.state.resources);
    this.checkResourceType(type);
    return deepClone(this.state.resources[type] || []);
  }

  async getResource(type, id) {
    this.ensureReady();
    this.checkResourceType(type);
    const found = (this.state.resources[type] || []).find((r) => r.id === id);
    return found ? deepClone(found) : null;
  }

  async saveResource(type, resource) {
    this.checkResourceType(type);
    if (!isPlainObject(resource)) throw new RepositoryError('Recurso inválido.', 'invalid');
    return this.mutate((s) => {
      const list = s.resources[type] || (s.resources[type] = []);
      const index = list.findIndex((r) => r.id === resource.id);
      const stamped = this.stamp(resource, index >= 0 ? list[index] : null);
      if (index >= 0) list[index] = stamped;
      else list.push(stamped);
      return stamped;
    });
  }

  async updateResource(type, id, patch) {
    this.checkResourceType(type);
    return this.mutate((s) => {
      const list = s.resources[type] || [];
      const index = list.findIndex((r) => r.id === id);
      if (index < 0) throw new RepositoryError('Recurso no encontrado.', 'not_found');
      list[index] = this.stamp({ ...list[index], ...patch, id }, list[index]);
      return list[index];
    });
  }

  async deleteResource(type, id) {
    this.checkResourceType(type);
    return this.mutate((s) => {
      const list = s.resources[type] || [];
      const index = list.findIndex((r) => r.id === id);
      if (index < 0) return false;
      list.splice(index, 1);
      return true;
    });
  }

  // ------------------------------------------------------------- quotes

  async getQuotes() {
    this.ensureReady();
    return deepClone(this.state.quotes);
  }

  async getQuote(id) {
    this.ensureReady();
    const found = this.state.quotes.find((q) => q.id === id);
    return found ? deepClone(found) : null;
  }

  async saveQuote(quote) {
    if (!isPlainObject(quote)) throw new RepositoryError('Cotización inválida.', 'invalid');
    return this.mutate((s) => {
      const index = s.quotes.findIndex((q) => q.id === quote.id);
      const stamped = this.stamp({ ...quote, name: typeof quote.name === 'string' ? quote.name : 'Cotización' }, index >= 0 ? s.quotes[index] : null);
      if (index >= 0) s.quotes[index] = stamped;
      else s.quotes.push(stamped);
      return stamped;
    });
  }

  async updateQuote(id, patch) {
    return this.mutate((s) => {
      const index = s.quotes.findIndex((q) => q.id === id);
      if (index < 0) throw new RepositoryError('Cotización no encontrada.', 'not_found');
      s.quotes[index] = this.stamp({ ...s.quotes[index], ...patch, id }, s.quotes[index]);
      return s.quotes[index];
    });
  }

  async deleteQuote(id) {
    return this.mutate((s) => {
      const index = s.quotes.findIndex((q) => q.id === id);
      if (index < 0) return false;
      s.quotes.splice(index, 1);
      return true;
    });
  }

  // ----------------------------------------------------------- services

  async getServices() {
    this.ensureReady();
    return deepClone(this.state.services);
  }

  async saveService(service) {
    if (!isPlainObject(service)) throw new RepositoryError('Servicio inválido.', 'invalid');
    return this.mutate((s) => {
      const index = s.services.findIndex((x) => x.id === service.id);
      const stamped = this.stamp({ ...service, name: typeof service.name === 'string' ? service.name : 'Servicio' }, index >= 0 ? s.services[index] : null);
      if (index >= 0) s.services[index] = stamped;
      else s.services.push(stamped);
      return stamped;
    });
  }

  async deleteService(id) {
    return this.mutate((s) => {
      const index = s.services.findIndex((x) => x.id === id);
      if (index < 0) return false;
      s.services.splice(index, 1);
      return true;
    });
  }

  // ----------------------------------------------------------- settings

  async getSettings() {
    this.ensureReady();
    return deepClone(this.state.settings);
  }

  async saveSettings(settings) {
    if (!isPlainObject(settings)) throw new RepositoryError('Configuración inválida.', 'invalid');
    return this.mutate((s) => {
      s.settings = { ...s.settings, ...settings };
      return s.settings;
    });
  }

  // ------------------------------------------------------------- backup

  async exportBackup() {
    this.ensureReady();
    const s = deepClone(this.state);
    return {
      schemaVersion: s.schemaVersion,
      app: { name: APP_NAME, version: this.appVersion },
      exportedAt: this.now(),
      organization: s.organization,
      resources: s.resources,
      services: s.services,
      quotes: s.quotes,
      settings: s.settings,
      ...(s.legacy ? { legacy: s.legacy } : {}),
    };
  }

  /**
   * Valida y migra un backup SIN aplicarlo.
   * @returns {{ ok: boolean, errors: string[], state?: object, summary?: object, fromVersion?: number }}
   */
  prepareImport(data) {
    if (!isPlainObject(data)) return { ok: false, errors: ['El archivo no contiene un objeto JSON.'] };
    const { app, exportedAt, ...rest } = data;
    const version = detectSchemaVersion(rest);
    if (version === 0) {
      // Un backup legado (sin schemaVersion) debe tener al menos alguna colección
      // de RATEOS: evita importar cualquier JSON (p. ej. package.json) y vaciar todo.
      const looksLikeRateos = isPlainObject(rest.organization) || Array.isArray(rest.quotes) || Array.isArray(rest.services) || isPlainObject(rest.resources);
      if (!looksLikeRateos) {
        return { ok: false, errors: ['El archivo no es un backup de RATEOS (no tiene organización, cotizaciones, plantillas ni recursos).'] };
      }
    }
    if (version === CURRENT_SCHEMA_VERSION) {
      // Validar la forma ORIGINAL antes de normalizar: una colección con tipo
      // incorrecto se rechaza en lugar de vaciarse en silencio.
      const raw = validateState({ ...createEmptyState(), ...rest });
      if (!raw.ok) return { ok: false, errors: raw.errors };
    }
    let migrated;
    try {
      migrated = migrateState(rest, { now: this.now(), idFactory: this.idFactory });
    } catch (error) {
      return { ok: false, errors: [error instanceof MigrationError ? error.message : 'No se pudo interpretar el backup.'] };
    }
    const check = validateState(migrated.state);
    if (!check.ok) return { ok: false, errors: check.errors };
    const st = migrated.state;
    return {
      ok: true,
      errors: [],
      state: st,
      fromVersion: migrated.fromVersion,
      summary: {
        organization: st.organization.name || '—',
        quotes: st.quotes.length,
        services: st.services.length,
        resources: Object.fromEntries(RESOURCE_TYPES.map((t) => [t, st.resources[t].length])),
        exportedAt: typeof exportedAt === 'string' ? exportedAt : null,
        appVersion: isPlainObject(app) && typeof app.version === 'string' ? app.version : null,
      },
    };
  }

  /**
   * Reemplaza los datos actuales por los del backup. La confirmación del
   * usuario se pide en la interfaz ANTES de llamar a este método.
   * El estado previo se guarda en una clave de recuperación.
   */
  async importBackup(data, { recoveryReason = 'before-import' } = {}) {
    this.ensureWritable();
    const prepared = this.prepareImport(data);
    if (!prepared.ok) throw new RepositoryError(`Backup inválido: ${prepared.errors.join(' ')}`, 'invalid_backup');
    // El motivo sólo puede ser una etiqueta segura (se usa en la clave de la copia).
    const reason = /^[a-z][a-z0-9-]{0,40}$/.test(String(recoveryReason)) ? recoveryReason : 'before-import';
    const recoveryKey = this.saveRecoverySnapshot(JSON.stringify(this.state), reason);
    this.persistReplacing(prepared.state, recoveryKey);
    this.state = prepared.state;
    return { ...prepared.summary, recoveryKey };
  }

  /** Restaura los datos demo, guardando antes una copia del estado actual. */
  async resetToDemo() {
    this.ensureWritable();
    const recoveryKey = this.saveRecoverySnapshot(JSON.stringify(this.state), 'before-demo-reset');
    const demo = this.seedFactory();
    this.persistReplacing(demo, recoveryKey);
    this.state = demo;
    return { recoveryKey };
  }

  /**
   * Persiste un estado que reemplaza al actual. Si falla (p. ej. cuota), se
   * elimina la copia de recuperación recién creada: el estado principal quedó
   * intacto y esa copia sólo ocuparía espacio.
   */
  persistReplacing(state, recoveryKey) {
    try {
      this.persist(state);
    } catch (error) {
      if (recoveryKey) {
        try {
          this.storage.removeItem(recoveryKey);
        } catch {
          /* sin efecto */
        }
      }
      throw error;
    }
  }

  // ----------------------------------------------------------- recovery

  /** Guarda una copia literal en una clave de recuperación. Devuelve la clave. */
  saveRecoverySnapshot(raw, reason) {
    const base = `${STORAGE_KEYS.recoveryPrefix}${this.now().replace(/[:.]/g, '-')}.${reason}`;
    let key = base;
    // Dos copias en el mismo milisegundo no deben pisarse.
    for (let n = 2; this.storage.getItem(key) !== null; n += 1) key = `${base}.${n}`;
    try {
      this.storage.setItem(key, String(raw));
      this.pruneRecoverySnapshots();
    } catch (error) {
      logger.warn('No se pudo guardar la copia de recuperación', { reason });
      if (reason !== 'corrupt') {
        throw new RepositoryError('No hay espacio para guardar una copia de seguridad previa. Exportá un backup y liberá espacio antes de continuar.', 'recovery_failed', error);
      }
      return null;
    }
    return key;
  }

  /** Lista claves de recuperación (más nuevas primero). */
  listRecoverySnapshots() {
    const keys = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const k = this.storage.key(i);
      if (k && k.startsWith(STORAGE_KEYS.recoveryPrefix)) keys.push(k);
    }
    return keys.sort().reverse();
  }

  /** Elimina una copia de recuperación (sólo claves de recuperación). */
  deleteRecoverySnapshot(key) {
    if (typeof key !== 'string' || !key.startsWith(STORAGE_KEYS.recoveryPrefix)) return false;
    if (this.storage.getItem(key) === null) return false;
    this.storage.removeItem(key);
    return true;
  }

  /** Contenido literal de una copia de recuperación. */
  getRecoverySnapshot(key) {
    if (typeof key !== 'string' || !key.startsWith(STORAGE_KEYS.recoveryPrefix)) return null;
    return this.storage.getItem(key);
  }

  /**
   * Conserva sólo las MAX_RECOVERY_SNAPSHOTS copias más recientes de cada
   * tipo. Las copias de datos dañados ("corrupt" e "invalid") se podan aparte para que
   * importaciones o restauraciones posteriores nunca borren la única copia
   * del texto original dañado.
   */
  pruneRecoverySnapshots() {
    const keys = this.listRecoverySnapshots();
    // Copias del texto original dañado o con estructura inválida: pueden ser
    // la única copia de esos datos, se cuentan aparte.
    const isCorrupt = (k) => /\.(corrupt|invalid)(\.\d+)?$/.test(k);
    keys.filter((k) => !isCorrupt(k)).slice(MAX_RECOVERY_SNAPSHOTS).forEach((k) => this.storage.removeItem(k));
    keys.filter(isCorrupt).slice(MAX_RECOVERY_SNAPSHOTS).forEach((k) => this.storage.removeItem(k));
  }
}
