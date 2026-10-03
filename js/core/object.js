/**
 * Utilidades puras para objetos planos (sin dependencias de UI ni storage).
 */

/** Copia profunda de datos JSON-serializables. */
export function deepClone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Congela recursivamente (útil para catálogos y constantes). */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function splitPath(path) {
  return String(path)
    .split('.')
    .filter((p) => p !== '');
}

/** Lee `a.b.0.c` de un objeto. Devuelve undefined si no existe. */
export function getPath(obj, path) {
  let cur = obj;
  for (const key of splitPath(path)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Escribe `a.b.0.c` en un objeto (mutándolo). Crea objetos intermedios.
 * Rechaza claves peligrosas para evitar prototype pollution.
 */
export function setPath(obj, path, value) {
  const keys = splitPath(path);
  if (keys.length === 0) throw new Error('Ruta vacía.');
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) throw new Error('Ruta no permitida.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

/** true si es un objeto plano (no array, no null). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lista de objetos defensiva: si no es un array devuelve [], y reemplaza los
 * elementos que no son objetos planos (null, números, textos) por {} para
 * conservar la alineación de índices entre la entrada y los resultados.
 */
export function objectList(value) {
  return Array.isArray(value) ? value.map((item) => (isPlainObject(item) ? item : {})) : [];
}
