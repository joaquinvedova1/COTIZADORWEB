/**
 * Importar a la cuenta los datos del modo local anterior (rateos.state).
 *
 * - Sólo datos REALES: nunca la demo, la empresa ficticia ni nada marcado
 *   ILUSTRATIVO (js/domain/real-data.js).
 * - Nunca automático: la persona elige "Importarlos a mi cuenta" o
 *   "Empezar en limpio". La decisión se recuerda por usuario.
 * - Antes de importar se guarda una copia de recuperación del texto local y
 *   otra del estado de la nube. rateos.state nunca se borra.
 */

import {
  backupLegacyLocalData,
  getLocalImportDecision,
  readLegacyLocalData,
  setLocalImportDecision,
} from '../data/legacy-local.js';

/**
 * @param {{ repository: import('../data/supabase-repository.js').SupabaseRepository, userId: string, storage?: Storage|null, now?: () => string }} deps
 */
export function createLocalImportService({ repository, userId, storage, now = () => new Date().toISOString() }) {
  const opts = storage === undefined ? {} : { storage };
  return {
    /** ¿Hay datos reales locales sin decidir? → { available, counts } */
    inspect() {
      if (getLocalImportDecision(userId, opts)) return { available: false, counts: null };
      const { real } = readLegacyLocalData(opts);
      return real.hasRealData ? { available: true, counts: real.counts } : { available: false, counts: null };
    },

    async importToAccount() {
      const { raw, real } = readLegacyLocalData(opts);
      if (!real.hasRealData) return { ok: false, message: 'No hay datos reales para importar en este navegador.' };
      const backupKey = backupLegacyLocalData(raw, { ...opts, now: now() });
      if (!backupKey) {
        return { ok: false, message: 'No hay espacio en el navegador para guardar una copia de seguridad antes de importar. Exportá un backup y liberá espacio.' };
      }
      const result = await repository.importLocalData(real.data);
      setLocalImportDecision(userId, 'imported', opts);
      return { ok: true, ...result, backupKey };
    },

    /** "Empezar en limpio": no importa nada y no vuelve a preguntar (los datos locales quedan intactos). */
    skip() {
      setLocalImportDecision(userId, 'skipped', opts);
      return { ok: true };
    },
  };
}
