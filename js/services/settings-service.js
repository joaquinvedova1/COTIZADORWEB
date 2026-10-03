/**
 * SettingsService — configuración de la organización y datos "Acerca de".
 */

import { defaultSettings } from '../domain/quote-factory.js';

export function createSettingsService({ repository }) {
  return {
    async get() {
      const org = await repository.getOrganization();
      return { ...defaultSettings(org.id), ...(await repository.getSettings()) };
    },
    async save(patch) {
      return repository.saveSettings(patch);
    },
    async getOrganization() {
      return repository.getOrganization();
    },
    async saveOrganization(patch) {
      return repository.saveOrganization(patch);
    },
  };
}

/**
 * Lee version.json (generado en el build de GitHub Actions).
 * Usa ruta relativa para funcionar bajo /COTIZADORWEB/.
 */
export async function loadVersionInfo(fetchImpl = globalThis.fetch) {
  const fallback = { version: 'dev', commit: 'local', buildDate: null, ref: null };
  if (typeof fetchImpl !== 'function') return fallback;
  try {
    const res = await fetchImpl('./version.json', { cache: 'no-store' });
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      version: typeof data.version === 'string' ? data.version : fallback.version,
      commit: typeof data.commit === 'string' ? data.commit.slice(0, 12) : fallback.commit,
      buildDate: typeof data.buildDate === 'string' ? data.buildDate : null,
      ref: typeof data.ref === 'string' ? data.ref : null,
    };
  } catch {
    return fallback;
  }
}
