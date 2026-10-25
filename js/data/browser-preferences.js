/**
 * Preferencias de este navegador que no son datos de la empresa (PLAN-2026-029):
 * por ejemplo, cuándo se mostró la invitación a dejar un comentario. Si el
 * almacenamiento no está disponible (ventana privada, permisos), devuelve
 * null y la interfaz sigue sin esa comodidad.
 */

/** Almacenamiento clave-valor del navegador, o null si no se puede usar. */
export function browserPreferencesStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
