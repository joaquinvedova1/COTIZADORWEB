/**
 * Composition root: crea repositorio + servicios. Es lo único que la UI
 * necesita para operar. Las pantallas reciben `ctx` y nunca instancian
 * repositorios ni acceden a localStorage.
 */

import { createRepository } from '../data/repository-factory.js';
import { createQuoteService } from './quote-service.js';
import { createResourceService } from './resource-service.js';
import { createBackupService } from './backup-service.js';
import { createSettingsService } from './settings-service.js';
import { logger } from '../core/logger.js';
import { STORAGE_KEYS } from '../config.js';
import { track } from '../core/events.js';

/**
 * @param {{ storage?: Storage|null, appVersion?: string }} [options]
 */
export async function createAppContext(options = {}) {
  const { repository, persistent } = createRepository(options);
  const init = await repository.init();
  const ctx = {
    repository,
    persistent,
    init,
    quotes: createQuoteService({ repository }),
    resources: createResourceService({ repository }),
    backup: createBackupService({ repository }),
    settings: createSettingsService({ repository }),
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
