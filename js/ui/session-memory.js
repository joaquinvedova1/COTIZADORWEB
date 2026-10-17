/**
 * Memoria de la pestaña atada a la SESIÓN (una cuenta con su empresa, o la
 * demo). PLAN-2026-015.
 *
 * Los editores guardan en memoria los borradores que no se pudieron guardar
 * y algunas preferencias de pantalla (sliders, secciones abiertas). Nada de
 * eso puede aparecer en otra cuenta que entre después en la MISMA pestaña:
 * - createDraftStore(): borradores por cuenta. Otra cuenta nunca recibe uno
 *   ajeno, aunque abra una cotización con el mismo id (p. ej. importada de un
 *   backup de otra empresa). La misma persona, al volver a ingresar en la
 *   pestaña (sesión vencida), recupera los suyos.
 * - onSessionReset() / resetSessionMemory(): preferencias de pantalla que se
 *   borran al cerrar la cuenta.
 */

/** Dueño de la memoria: usuario + empresa de la cuenta, o el modo (demo / local). */
export function sessionOwner(ctx) {
  if (!ctx) return 'none';
  const account = ctx.account;
  if (account && account.user && typeof account.user.id === 'string' && account.organization && typeof account.organization.id === 'string') {
    return `account:${account.user.id}:${account.organization.id}`;
  }
  return typeof ctx.mode === 'string' && ctx.mode ? ctx.mode : 'local';
}

/** Borradores por cuenta: get/set/delete(ctx, id). */
export function createDraftStore() {
  const drafts = new Map();
  const keyOf = (ctx, id) => `${sessionOwner(ctx)}\u0000${String(id)}`;
  return {
    get: (ctx, id) => drafts.get(keyOf(ctx, id)),
    set: (ctx, id, value) => {
      drafts.set(keyOf(ctx, id), value);
    },
    delete: (ctx, id) => drafts.delete(keyOf(ctx, id)),
    get size() {
      return drafts.size;
    },
  };
}

const resets = new Set();

/** Registra qué borrar al cerrar la cuenta. Devuelve la función para desregistrar. */
export function onSessionReset(clear) {
  if (typeof clear !== 'function') return () => {};
  resets.add(clear);
  return () => resets.delete(clear);
}

/** Al cerrar la cuenta (o cambiar de persona): borra la memoria de pantalla registrada. */
export function resetSessionMemory() {
  resets.forEach((clear) => {
    try {
      clear();
    } catch {
      /* una vista con error no impide limpiar las demás */
    }
  });
}
