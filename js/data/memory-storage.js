/**
 * Implementación en memoria de la interfaz Web Storage.
 * Se usa en tests y como respaldo si localStorage no está disponible
 * (modo privado, cookies bloqueadas). En ese caso los datos NO persisten
 * y la interfaz lo avisa.
 */
export class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }

  removeItem(key) {
    this.map.delete(String(key));
  }
}

/**
 * Devuelve localStorage si está disponible y funciona; si no, null.
 * Nunca lanza.
 */
export function getBrowserStorage(globalObject = globalThis) {
  try {
    const storage = globalObject.localStorage;
    if (!storage) return null;
    const probe = '__rateos_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Devuelve localStorage si se puede LEER (sin escribir). Se usa para
 * recuperar datos cuando el almacenamiento está lleno o bloqueado para
 * escritura. Nunca lanza.
 */
export function getReadableBrowserStorage(globalObject = globalThis) {
  try {
    const storage = globalObject.localStorage;
    if (!storage) return null;
    storage.getItem('__rateos_probe__');
    return storage;
  } catch {
    return null;
  }
}
