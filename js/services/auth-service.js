/**
 * AuthService — punto único de autenticación de RATEOS.
 *
 * HOY RATEOS NO TIENE CUENTAS: funciona en modo local (todo queda en este
 * navegador). Esta implementación no autentica, no recibe credenciales y no
 * guarda ni envía emails ni contraseñas: cualquier intento responde
 * `{ ok: false, reason: 'not_available' }`.
 *
 * Cuando se implemente Supabase Auth (ver docs/AUTH_ARCHITECTURE.md y
 * docs/SUPABASE_PLAN.md) se reemplaza esta implementación por una real con la
 * misma interfaz, sin tocar las pantallas de #/login y #/registro.
 * Nunca guardar contraseñas en localStorage ni en el backup.
 */

/** Modos de autenticación conocidos. Hoy sólo existe "local" (sin cuentas). */
export const AUTH_MODES = Object.freeze({ local: 'local' });

/** Respuesta estándar mientras las cuentas no estén habilitadas. */
export const AUTH_NOT_AVAILABLE = Object.freeze({ ok: false, reason: 'not_available' });

export function createAuthService() {
  return Object.freeze({
    /** Modo actual: "local" = sin cuentas, datos sólo en este navegador. */
    mode: AUTH_MODES.local,
    /** false mientras no exista un proveedor de autenticación real. */
    available: false,
    /** Sesión actual: siempre null en modo local. */
    async getSession() {
      return null;
    },
    /** Ingreso: no disponible todavía. No recibe ni procesa credenciales. */
    async signIn() {
      return AUTH_NOT_AVAILABLE;
    },
    /** Registro: no disponible todavía. No recibe ni procesa credenciales. */
    async signUp() {
      return AUTH_NOT_AVAILABLE;
    },
    async signOut() {
      return { ok: true };
    },
  });
}
