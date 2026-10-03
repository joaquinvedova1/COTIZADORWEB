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
  };
  return ctx;
}
