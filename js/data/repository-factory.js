/**
 * Crea el repositorio según STORAGE_MODE. Único punto que decide la
 * implementación concreta de StorageRepository.
 *
 * Hoy: "local" → LocalStorageRepository.
 * Futuro: "supabase" → SupabaseRepository (no implementado; ver docs/SUPABASE_PLAN.md).
 */

import { STORAGE_MODE, STORAGE_KEYS } from '../config.js';
import { LocalStorageRepository } from './local-storage-repository.js';
import { MemoryStorage, getBrowserStorage, getReadableBrowserStorage } from './memory-storage.js';
import { RepositoryError } from './storage-repository.js';

/**
 * @param {{ mode?: string, storage?: Storage|null, appVersion?: string, globalObject?: object }} [options]
 * @returns {{ repository: import('./storage-repository.js').StorageRepository, persistent: boolean }}
 */
export function createRepository({ mode = STORAGE_MODE, storage, appVersion = 'dev', globalObject = globalThis } = {}) {
  if (mode === 'local') {
    const browserStorage = storage === undefined ? getBrowserStorage(globalObject) : storage;
    if (storage === undefined && !browserStorage) {
      // No se puede escribir. Si igual se puede LEER y hay datos guardados, no
      // se abre la demo en memoria (engañaría y exportaría la demo): se informa
      // el problema para que la pantalla de recuperación permita descargarlos.
      const readable = getReadableBrowserStorage(globalObject);
      let hasState = false;
      try {
        hasState = Boolean(readable) && readable.getItem(STORAGE_KEYS.state) !== null;
      } catch {
        hasState = false;
      }
      if (hasState) {
        throw new RepositoryError(
          'El almacenamiento del navegador está lleno o bloqueado para escritura. Tus datos siguen guardados: descargalos, liberá espacio y reintentá.',
          'quota_exceeded',
        );
      }
    }
    const persistent = Boolean(browserStorage);
    const repository = new LocalStorageRepository(browserStorage || new MemoryStorage(), { appVersion });
    return { repository, persistent };
  }
  throw new RepositoryError(`Modo de almacenamiento no soportado: ${mode}.`, 'unsupported_mode');
}
