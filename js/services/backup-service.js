/**
 * BackupService — exportar e importar datos en JSON versionado.
 *
 * Flujo de importación (la confirmación se pide en la UI):
 *   1. parseBackupText(texto) → valida y resume SIN modificar datos
 *   2. el usuario confirma que quiere sobrescribir
 *   3. applyBackup(datos) → guarda copia de recuperación y reemplaza
 */

import { MAX_BACKUP_BYTES, APP_NAME } from '../config.js';
import { track } from '../core/events.js';
import { createFreshWorkspace } from '../domain/workspace.js';

export function createBackupService({ repository, clock = () => new Date().toISOString() }) {
  return {
    /** Devuelve { filename, json } listo para descargar. */
    async exportBackup() {
      const data = await repository.exportBackup();
      const stamp = clock().slice(0, 19).replace(/[:T]/g, '-');
      track('backup_exported', { count: Array.isArray(data.quotes) ? Math.min(data.quotes.length, 10000) : 0 });
      return { filename: `${APP_NAME.toLowerCase()}-backup-${stamp}.json`, json: JSON.stringify(data, null, 2), data };
    },

    /** Valida un texto JSON de backup sin aplicarlo. */
    parseBackupText(text) {
      if (typeof text !== 'string' || text.trim() === '') return { ok: false, errors: ['El archivo está vacío.'] };
      // Primero el largo (barato) y luego los bytes reales en UTF-8.
      if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) {
        return { ok: false, errors: ['El archivo supera el tamaño máximo permitido (5 MB).'] };
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, errors: ['El archivo no es un JSON válido.'] };
      }
      // Nunca se importa sin validar antes (Prompt 2): si el almacenamiento no
      // sabe validar, la importación se rechaza.
      const prepared = typeof repository.prepareImport === 'function'
        ? repository.prepareImport(data)
        : { ok: false, errors: ['Este almacenamiento no permite validar backups antes de importarlos.'] };
      return { ...prepared, data };
    },

    /** Aplica un backup ya validado y confirmado por el usuario. */
    async applyBackup(data) {
      const result = await repository.importBackup(data);
      track('backup_imported', { count: Math.min(result.quotes ?? 0, 10000) });
      return result;
    },

    /**
     * "Empezar con mi empresa en limpio": quita la empresa ficticia y sus
     * cotizaciones y recursos (conserva convenios, plantillas y
     * configuración). Guarda ANTES una copia de recuperación (importBackup).
     * La confirmación se pide en la UI.
     * @param {{ name?: string, baseLocation?: string, industry?: string, activity?: string }} [org]
     */
    async startFresh(org = {}) {
      const current = await repository.exportBackup();
      const fresh = createFreshWorkspace(current, org);
      return repository.importBackup(fresh, { recoveryReason: 'before-start-fresh' });
    },

    /** Restaura los datos demo (con copia de recuperación previa). */
    async resetToDemo() {
      if (typeof repository.resetToDemo !== 'function') throw new Error('Operación no soportada por este almacenamiento.');
      return repository.resetToDemo();
    },

    listRecoverySnapshots() {
      return typeof repository.listRecoverySnapshots === 'function' ? repository.listRecoverySnapshots() : [];
    },

    deleteRecoverySnapshot(key) {
      return typeof repository.deleteRecoverySnapshot === 'function' ? repository.deleteRecoverySnapshot(key) : false;
    },

    getRecoverySnapshot(key) {
      return typeof repository.getRecoverySnapshot === 'function' ? repository.getRecoverySnapshot(key) : null;
    },
  };
}
