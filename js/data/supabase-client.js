/**
 * Cliente de Supabase (único lugar que importa el SDK oficial).
 *
 * - Sólo usa la URL y la publishable key de js/config.js (públicas por
 *   diseño). Nunca service_role ni secretos.
 * - Flujo PKCE: los enlaces de los emails vuelven con ?code=… ANTES del #,
 *   así no chocan con el router por hash. detectSessionInUrl está apagado:
 *   el canje lo hace auth-gateway.js (controla la URL y el destino).
 * - La sesión (tokens) la guarda el SDK en localStorage bajo
 *   STORAGE_KEYS.authSession. Nunca hay contraseñas guardadas.
 */

import { createClient } from './vendor/supabase.js';
import { SUPABASE, STORAGE_KEYS } from '../config.js';
import { getBrowserStorage } from './memory-storage.js';

let client = null;

/** Adaptador de storage para el SDK: si el navegador no deja guardar, la sesión vive sólo en memoria. */
function sessionStorageAdapter(globalObject = globalThis) {
  const browser = getBrowserStorage(globalObject);
  const memory = new Map();
  return {
    getItem: (key) => {
      try {
        return browser ? browser.getItem(key) : memory.get(key) ?? null;
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      try {
        if (browser) browser.setItem(key, value);
        else memory.set(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem: (key) => {
      memory.delete(key);
      try {
        if (browser) browser.removeItem(key);
      } catch {
        /* nada que borrar */
      }
    },
  };
}

/**
 * @param {{ factory?: Function, config?: { url: string, publishableKey: string } }} [options]
 * @returns {object} cliente de Supabase (singleton)
 */
export function getSupabaseClient({ factory = createClient, config = SUPABASE } = {}) {
  if (client) return client;
  if (!config || typeof config.url !== 'string' || typeof config.publishableKey !== 'string') {
    throw new Error('Falta la configuración pública de Supabase.');
  }
  client = factory(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: STORAGE_KEYS.authSession,
      storage: sessionStorageAdapter(),
    },
  });
  return client;
}

/** Sólo para tests. */
export function resetSupabaseClientForTests() {
  client = null;
}
