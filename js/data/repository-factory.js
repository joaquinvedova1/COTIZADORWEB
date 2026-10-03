/**
 * Crea el repositorio según STORAGE_MODE. Único punto que decide la
 * implementación concreta de StorageRepository.
 *
 * Hoy: "local" → LocalStorageRepository.
 * Futuro: "supabase" → SupabaseRepository (no implementado; ver docs/SUPABASE_PLAN.md).
 */

import { STORAGE_MODE } from '../config.js';
import { LocalStorageRepository } from './local-storage-repository.js';
import { MemoryStorage, getBrowserStorage } from './memory-storage.js';
import { RepositoryError } from './storage-repository.js';

/**
 * @param {{ mode?: string, storage?: Storage|null, appVersion?: string }} [options]
 * @returns {{ repository: import('./storage-repository.js').StorageRepository, persistent: boolean }}
 */
export function createRepository({ mode = STORAGE_MODE, storage, appVersion = 'dev' } = {}) {
  if (mode === 'local') {
    const browserStorage = storage === undefined ? getBrowserStorage() : storage;
    const persistent = Boolean(browserStorage);
    const repository = new LocalStorageRepository(browserStorage || new MemoryStorage(), { appVersion });
    return { repository, persistent };
  }
  throw new RepositoryError(`Modo de almacenamiento no soportado: ${mode}.`, 'unsupported_mode');
}
