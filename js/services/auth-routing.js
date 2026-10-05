/**
 * Reglas de acceso por ruta (funciones puras, testeables).
 *
 *   public  landing, demo, callbacks: cualquiera.
 *   guest   ingreso, registro, recuperar contraseña: sin sesión; con sesión
 *           van a la app (o al destino pedido).
 *   auth    toda la aplicación: requiere sesión. Sin sesión → #/login
 *           conservando el destino (?next=/cotizaciones/nueva).
 *
 * Mientras la sesión se está restaurando ('loading') NO se muestra nada
 * protegido (ni medio segundo).
 *
 * Esto es experiencia de uso: la seguridad real de los datos la da RLS en
 * Postgres (sin sesión válida la base no devuelve nada).
 */

export const APP_HOME_PATH = '/inicio';
const GUEST_PATHS = new Set(['/login', '/registro', '/recuperar-contrasena']);

/**
 * Destino interno seguro para ?next=: una ruta de la app ("/cotizaciones/nueva"),
 * nunca una URL externa, protocolo, "//host" ni una pantalla de ingreso.
 */
export function isSafeNextPath(path) {
  if (typeof path !== 'string' || path.length < 2 || path.length > 200) return false;
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (!/^\/[A-Za-z0-9\-_/.%]*$/.test(path)) return false;
  if (path.includes('..')) return false;
  const base = path.replace(/\/+$/, '');
  return !GUEST_PATHS.has(base) && base !== '';
}

/** Parámetros de la "query" de un hash (#/login?next=%2Finicio). */
export function hashQuery(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const i = raw.indexOf('?');
  return new URLSearchParams(i >= 0 ? raw.slice(i + 1) : '');
}

/** Destino seguro de ?next= en un hash, o null. */
export function nextFromHash(hash) {
  const next = hashQuery(hash).get('next');
  return next && isSafeNextPath(next) ? next : null;
}

export function loginHash(path = null, { expired = false } = {}) {
  const params = new URLSearchParams();
  if (path && isSafeNextPath(path)) params.set('next', path);
  if (expired) params.set('sesion', 'vencida');
  const q = params.toString();
  return q ? `#/login?${q}` : '#/login';
}

export function registerHash(path = null) {
  return path && isSafeNextPath(path) ? `#/registro?next=${encodeURIComponent(path)}` : '#/registro';
}

/**
 * Qué hacer con una ruta según su acceso y el estado de la sesión.
 * @param {{ access: 'public'|'guest'|'auth', status: 'loading'|'anonymous'|'authenticated', path: string, hash?: string }} input
 * @returns {{ action: 'render'|'wait'|'redirect', to?: string }}
 */
export function resolveAccess({ access, status, path, hash = '' }) {
  if (access === 'public') return { action: 'render' };
  if (status === 'loading') return { action: 'wait' };
  if (access === 'guest') {
    if (status === 'authenticated') return { action: 'redirect', to: `#${nextFromHash(hash) || APP_HOME_PATH}` };
    return { action: 'render' };
  }
  // auth
  if (status === 'authenticated') return { action: 'render' };
  return { action: 'redirect', to: loginHash(path) };
}
