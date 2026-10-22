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

/**
 * Huella del contenido de un borrador de formulario (UX-01): JSON con las
 * claves ordenadas y sin los valores vacíos (null, undefined, textos en blanco
 * y listas u objetos vacíos). Así, no tocar un campo y escribir y borrar dan
 * lo mismo. `false` y `0` cuentan: son respuestas.
 */
export function contentSnapshot(value) {
  const clean = (v) => {
    if (v === null || v === undefined || typeof v === 'function') return undefined;
    if (typeof v === 'string') return v.trim() === '' ? undefined : v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (Array.isArray(v)) {
      const items = v.map((item) => {
        const c = clean(item);
        return c === undefined ? null : c;
      });
      return items.some((item) => item !== null) ? items : undefined;
    }
    if (isPlainObject(v)) {
      const out = {};
      Object.keys(v).sort().forEach((key) => {
        const c = clean(v[key]);
        if (c !== undefined) out[key] = c;
      });
      return Object.keys(out).length ? out : undefined;
    }
    return v;
  };
  const cleaned = clean(value);
  return JSON.stringify(cleaned === undefined ? null : cleaned);
}
