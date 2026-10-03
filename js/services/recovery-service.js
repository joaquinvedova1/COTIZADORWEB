/**
 * RecoveryService — acceso de SÓLO LECTURA a los datos crudos guardados en
 * el navegador.
 *
 * Se usa cuando RATEOS no puede iniciar (datos dañados, almacenamiento
 * bloqueado, error inesperado al crear el contexto) para que la persona
 * pueda descargar exactamente lo que había guardado y no perder nada.
 *
 * Reglas:
 * - No interpreta, no migra y no modifica datos: devuelve el texto tal cual.
 * - La UI nunca accede al almacenamiento: usa este servicio.
 * - Nunca lanza: ante cualquier problema devuelve valores vacíos.
 */

import { STORAGE_KEYS, APP_NAME } from '../config.js';
import { getReadableBrowserStorage } from '../data/memory-storage.js';

const SAFE_FILENAME_RE = /[^a-z0-9-]+/gi;

function fileStamp(iso) {
  return String(iso).slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * @param {{ storage?: Storage|null, clock?: () => string }} [options]
 *   storage: implementación Web Storage (tests). Por defecto, la del navegador.
 */
export function createRecoveryService({ storage, clock = () => new Date().toISOString() } = {}) {
  const resolveStorage = () => {
    try {
      return storage === undefined ? getReadableBrowserStorage() : storage;
    } catch {
      return null;
    }
  };

  const safeGet = (store, key) => {
    try {
      const value = store.getItem(key);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  };

  return {
    /** true si el almacenamiento del navegador se puede leer. */
    isAvailable() {
      return Boolean(resolveStorage());
    },

    /**
     * Diagnóstico sin modificar nada.
     * @returns {{ available: boolean, readable: boolean, hasState: boolean }}
     */
    inspect() {
      const store = resolveStorage();
      if (!store) return { available: false, readable: false, hasState: false };
      try {
        const value = store.getItem(STORAGE_KEYS.state);
        return { available: true, readable: true, hasState: typeof value === 'string' };
      } catch {
        return { available: true, readable: false, hasState: false };
      }
    },

    /** Texto crudo del estado principal guardado (o null si no hay). */
    readRawState() {
      const store = resolveStorage();
      return store ? safeGet(store, STORAGE_KEYS.state) : null;
    },

    /** Claves de copias de recuperación (más nuevas primero). */
    listRecoveryKeys() {
      const store = resolveStorage();
      if (!store) return [];
      const keys = [];
      try {
        for (let i = 0; i < store.length; i += 1) {
          const k = store.key(i);
          if (typeof k === 'string' && k.startsWith(STORAGE_KEYS.recoveryPrefix)) keys.push(k);
        }
      } catch {
        return [];
      }
      return keys.sort().reverse();
    },

    /** Texto crudo de una copia de recuperación (sólo claves de recuperación). */
    readRecovery(key) {
      if (typeof key !== 'string' || !key.startsWith(STORAGE_KEYS.recoveryPrefix)) return null;
      const store = resolveStorage();
      return store ? safeGet(store, key) : null;
    },

    /**
     * Archivo descargable con el estado principal crudo.
     * Si el contenido es un JSON válido de RATEOS, se puede importar luego
     * desde Configuración → Backup.
     * @returns {{ filename: string, text: string }|null}
     */
    buildRawStateDownload() {
      const raw = this.readRawState();
      if (raw === null) return null;
      return { filename: `${APP_NAME.toLowerCase()}-datos-guardados-${fileStamp(clock())}.json`, text: raw };
    },

    /** Archivo descargable con una copia de recuperación. */
    buildRecoveryDownload(key) {
      const raw = this.readRecovery(key);
      if (raw === null) return null;
      const name = key.replace(SAFE_FILENAME_RE, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      return { filename: `${name}.json`, text: raw };
    },
  };
}
