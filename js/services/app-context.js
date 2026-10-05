/**
 * Composition root: crea repositorio + servicios. Es lo único que la UI
 * necesita para operar. Las pantallas reciben `ctx` y nunca instancian
 * repositorios ni acceden a localStorage.
 *
 * Tres contextos:
 * - createAccountContext: datos REALES de una cuenta (Supabase, con RLS).
 * - createDemoContext: la demo pública, EN MEMORIA. No escribe en el
 *   navegador ni en la nube; se pierde al recargar (a propósito).
 * - createAppContext: modo local (localStorage). Se conserva para los
 *   tests y como referencia; la app real ya no lo usa.
 */

import { createRepository } from '../data/repository-factory.js';
import { LocalStorageRepository } from '../data/local-storage-repository.js';
import { MemoryStorage, getBrowserStorage } from '../data/memory-storage.js';
import { SupabaseRepository } from '../data/supabase-repository.js';
import { RepositoryError } from '../data/storage-repository.js';
import { WORKSPACE_ERRORS } from '../data/workspace-gateway.js';
import { createQuoteService } from './quote-service.js';
import { createResourceService } from './resource-service.js';
import { createBackupService } from './backup-service.js';
import { createSettingsService } from './settings-service.js';
import { createAdminService } from './admin-service.js';
import { createLocalImportService } from './local-import-service.js';
import { logger } from '../core/logger.js';
import { STORAGE_KEYS } from '../config.js';
import { track } from '../core/events.js';

export const ROLE_LABELS = Object.freeze({
  OWNER: 'Dueño/a',
  ADMIN: 'Administración',
  ESTIMATOR: 'Presupuestista',
  VIEWER: 'Sólo lectura',
});

function services(repository) {
  return {
    quotes: createQuoteService({ repository }),
    resources: createResourceService({ repository }),
    backup: createBackupService({ repository }),
    settings: createSettingsService({ repository }),
  };
}

/**
 * @param {{ storage?: Storage|null, appVersion?: string }} [options]
 */
export async function createAppContext(options = {}) {
  const { repository, persistent } = createRepository(options);
  const init = await repository.init();
  const ctx = {
    mode: 'local',
    repository,
    persistent,
    init,
    ...services(repository),
    logger,
    track,
    /**
     * Avisa cuando OTRA pestaña modifica los datos guardados (evento storage
     * del navegador). El repositorio ya adopta esos cambios antes de cada
     * lectura o escritura; esto sirve para refrescar la pantalla.
     * @param {() => void} callback
     * @returns {() => void} función para dejar de escuchar
     */
    onExternalChange(callback, target = globalThis) {
      if (!target || typeof target.addEventListener !== 'function') return () => {};
      const handler = (event) => {
        if (event && (event.key === STORAGE_KEYS.state || event.key === null)) callback();
      };
      target.addEventListener('storage', handler);
      return () => target.removeEventListener('storage', handler);
    },
  };
  return ctx;
}

/**
 * Demo pública (sin cuenta): datos ILUSTRATIVOS en memoria. Aislada de la
 * cuenta real: otro repositorio, otro storage, nada se guarda.
 * @param {{ appVersion?: string }} [options]
 */
export async function createDemoContext({ appVersion = 'dev' } = {}) {
  const repository = new LocalStorageRepository(new MemoryStorage(), { appVersion });
  const init = await repository.init();
  return {
    mode: 'demo',
    demo: true,
    repository,
    persistent: false,
    init,
    ...services(repository),
    logger,
    track,
    onExternalChange: () => () => {},
  };
}

const ACCOUNT_OPEN_MESSAGES = Object.freeze({
  [WORKSPACE_ERRORS.network]: 'No pudimos conectarnos para abrir tu cuenta. Revisá tu conexión y reintentá.',
  [WORKSPACE_ERRORS.sessionExpired]: 'Tu sesión terminó. Volvé a ingresar.',
  [WORKSPACE_ERRORS.notFound]: 'No encontramos la empresa de tu cuenta. Si te acabás de registrar, esperá unos segundos y reintentá.',
});

/**
 * Datos reales de una cuenta autenticada.
 * @param {{
 *   user: { id: string, email: string, fullName: string },
 *   workspaceGateway: ReturnType<import('../data/workspace-gateway.js').createWorkspaceGateway>,
 *   cacheStorage?: Storage|null,
 *   appVersion?: string,
 * }} options
 */
export async function createAccountContext({ user, workspaceGateway, adminGateway = null, cacheStorage, appVersion = 'dev', confirmSchemaUpgrade = null }) {
  if (!user || typeof user.id !== 'string') throw new RepositoryError('No hay una sesión válida.', 'session_expired');
  const membership = await workspaceGateway.loadMembership(user.id);
  if (!membership.ok) {
    throw new RepositoryError(ACCOUNT_OPEN_MESSAGES[membership.code] || 'No se pudo abrir tu cuenta.', membership.code === WORKSPACE_ERRORS.sessionExpired ? 'session_expired' : membership.code || 'read_failed');
  }
  const storage = cacheStorage === undefined ? getBrowserStorage() : cacheStorage;
  const repository = new SupabaseRepository({
    gateway: workspaceGateway,
    organization: membership.organization,
    userId: user.id,
    role: membership.role,
    cacheStorage: storage,
    appVersion,
    // Staging comparte la base con producción: antes de actualizar el formato
    // de los datos de la nube se pregunta (ver docs/DEPLOYMENT.md).
    confirmSchemaUpgrade,
  });
  const init = await repository.init();
  // Rol de PLATAFORMA (RATEOS_ADMIN), separado del rol en la empresa. Lo
  // decide la base (private.platform_admins); acá sólo se usa para mostrar el
  // menú. Ante cualquier error: no es admin.
  let platformAdmin = false;
  if (adminGateway && typeof adminGateway.amIPlatformAdmin === 'function') {
    try {
      platformAdmin = (await adminGateway.amIPlatformAdmin()).isAdmin === true;
    } catch {
      platformAdmin = false;
    }
  }
  const account = {
    user: { id: user.id, email: user.email, fullName: membership.profile.fullName || user.fullName || '' },
    organization: { ...membership.organization },
    role: membership.role,
    roleLabel: ROLE_LABELS[membership.role] || membership.role,
    platformAdmin,
  };
  return {
    mode: 'cloud',
    repository,
    persistent: true,
    init,
    account,
    ...services(repository),
    localImport: createLocalImportService({ repository, userId: user.id, storage }),
    /** Panel RATEOS ADMIN (la base verifica el rol en cada llamada). */
    admin: adminGateway ? createAdminService(adminGateway) : null,
    sync: {
      getState: () => repository.getSyncState(),
      onChange: (listener) => repository.onSyncChange(listener),
      retry: () => repository.retryNow(),
      reloadFromCloud: () => repository.reloadFromCloud(),
      localCopyText: () => repository.localCopyText(),
    },
    async updateProfileName(fullName) {
      const name = String(fullName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      const res = await workspaceGateway.updateProfileName(user.id, name);
      if (res.ok) account.user.fullName = name;
      return res;
    },
    /** Nombre actual de la empresa (la organización de la nube). */
    organizationName: () => repository.organization.name,
    logger,
    track,
    onExternalChange: () => () => {},
    dispose: () => repository.dispose(),
  };
}
