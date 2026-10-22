/**
 * SettingsService — configuración de la organización y datos "Acerca de".
 */

import { defaultSettings } from '../domain/quote-factory.js';
import { LEGACY_DEFAULT_ROUNDING_STEP } from '../domain/rounding.js';

export function createSettingsService({ repository }) {
  return {
    async get() {
      const org = await repository.getOrganization();
      const stored = (await repository.getSettings()) || {};
      const merged = { ...defaultSettings(org.id), ...stored };
      // ECO-03: una configuración guardada antes del redondeo automático no trae `roundingMode`. No se
      // completa con el de fábrica (sería pasarla a automático sin que nadie lo elija): se interpreta en
      // settingsRounding (PLAN-2026-020 §2), con el múltiplo de fábrica de entonces si tampoco lo trae.
      if (stored.roundingMode === undefined) {
        delete merged.roundingMode;
        delete merged.roundingMaxPct;
        if (stored.roundingStep === undefined) merged.roundingStep = LEGACY_DEFAULT_ROUNDING_STEP;
      }
      return merged;
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
  const fallback = { version: 'dev', commit: 'local', buildDate: null, ref: null, channel: null };
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
      // "staging" (sólo un staging aislado, con su propia base: ver
      // docs/BETA_PERIMETER.md): la app pide confirmación antes de
      // actualizar el formato de los datos de la cuenta.
      channel: data.channel === 'staging' || data.channel === 'production' ? data.channel : null,
    };
  } catch {
    return fallback;
  }
}
