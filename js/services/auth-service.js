/**
 * AuthService — cuentas reales con Supabase Auth (punto único de auth).
 *
 * Estados de sesión: 'loading' (todavía no se sabe: la UI no muestra nada
 * protegido) → 'anonymous' | 'authenticated'.
 *
 * - Registro: nombre, empresa, email y contraseña. El trigger de la base
 *   crea perfil, organización (OWNER) y workspace vacío.
 * - Ingreso, cierre de sesión, recuperación y cambio de contraseña.
 * - Enlaces de los emails (confirmación y recuperación) con flujo PKCE:
 *   vuelven a https://…/COTIZADORWEB/?code=…&auth=…&next=… (query ANTES del
 *   #, compatible con el router por hash). handleRedirect() canjea el
 *   código, limpia la URL y devuelve a dónde ir.
 * - Mensajes humanos: nunca errores internos, tokens ni stack traces.
 * - Las contraseñas nunca se guardan ni se loguean: sólo pasan al SDK.
 */

import { PUBLIC_SITE_URL } from '../config.js';
import { AUTH_ERRORS } from '../data/auth-gateway.js';
import { isSafeNextPath } from './auth-routing.js';

export const AUTH_STATUS = Object.freeze({ loading: 'loading', anonymous: 'anonymous', authenticated: 'authenticated' });

/** Textos para personas. */
export const AUTH_MESSAGES = Object.freeze({
  [AUTH_ERRORS.emailTaken]: 'Ese email ya está registrado. Ingresá o recuperá tu contraseña.',
  [AUTH_ERRORS.invalidCredentials]: 'No pudimos iniciar sesión. Revisá el email y la contraseña.',
  [AUTH_ERRORS.emailNotConfirmed]: 'Todavía no confirmaste tu email. Revisá tu correo (también la carpeta de spam).',
  [AUTH_ERRORS.weakPassword]: 'La contraseña es muy débil. Usá al menos 8 caracteres combinando letras y números.',
  [AUTH_ERRORS.samePassword]: 'La contraseña nueva tiene que ser distinta de la anterior.',
  [AUTH_ERRORS.invalidEmail]: 'Revisá el email: no parece válido.',
  [AUTH_ERRORS.rateLimited]: 'Hubo muchos intentos seguidos. Esperá unos minutos y probá de nuevo.',
  [AUTH_ERRORS.linkInvalid]: 'El enlace venció o ya se usó. Pedí uno nuevo.',
  [AUTH_ERRORS.sessionMissing]: 'Tu sesión terminó. Volvé a ingresar.',
  [AUTH_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
  [AUTH_ERRORS.unknown]: 'No pudimos completar la operación. Probá de nuevo en unos minutos.',
});

export const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function messageFor(code) {
  return AUTH_MESSAGES[code] || AUTH_MESSAGES[AUTH_ERRORS.unknown];
}

function clean(text, max = MAX_NAME) {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** Validación del formulario de registro (antes de llamar a la red). */
export function validateSignUp({ fullName, company, email, password }) {
  const errors = {};
  if (!clean(fullName)) errors.fullName = 'Contanos tu nombre.';
  if (!clean(company)) errors.company = 'Indicá el nombre de tu empresa.';
  if (!EMAIL_RE.test(String(email || '').trim())) errors.email = 'Ingresá un email válido.';
  if (String(password || '').length < MIN_PASSWORD_LENGTH) errors.password = `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  return errors;
}

export function validateSignIn({ email, password }) {
  const errors = {};
  if (!EMAIL_RE.test(String(email || '').trim())) errors.email = 'Ingresá tu email.';
  if (!String(password || '')) errors.password = 'Ingresá tu contraseña.';
  return errors;
}

/**
 * URL a la que vuelven los enlaces de los emails (debe estar permitida en
 * Supabase → Authentication → URL Configuration). Sin "#": PKCE agrega
 * ?code=… y el router por hash no se rompe.
 */
/**
 * Base de los enlaces de los emails: el sitio público (GitHub Pages) y, en
 * desarrollo local (localhost / 127.0.0.1 bajo /COTIZADORWEB/), el servidor
 * local. Cualquier otro origen usa el sitio público. Supabase además sólo
 * acepta las Redirect URLs de su lista permitida.
 */
export function siteUrlFor(location, fallback = PUBLIC_SITE_URL) {
  try {
    const url = new URL(location && location.href ? location.href : '');
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (local && url.pathname.startsWith('/COTIZADORWEB/')) return `${url.origin}/COTIZADORWEB/`;
  } catch {
    /* sin location: el sitio público */
  }
  return fallback;
}

export function authRedirectUrl(kind, next = null, siteUrl = PUBLIC_SITE_URL) {
  const url = new URL(siteUrl);
  url.hash = '';
  url.searchParams.set('auth', kind);
  if (next && isSafeNextPath(next)) url.searchParams.set('next', next);
  return url.toString();
}

/**
 * Lee los parámetros de Auth de la URL (query antes del #).
 * @returns {null | { code?: string, tokenHash?: string, type?: string, kind: string|null, next: string|null, error: string|null }}
 */
export function parseAuthRedirect(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const p = url.searchParams;
  const code = p.get('code');
  const tokenHash = p.get('token_hash');
  const error = p.get('error_code') || p.get('error');
  const kind = p.get('auth');
  if (!code && !tokenHash && !error && !kind) return null;
  const next = p.get('next');
  return {
    code: code || null,
    tokenHash: tokenHash || null,
    type: p.get('type') || null,
    kind: kind === 'recovery' || kind === 'confirm' ? kind : null,
    next: next && isSafeNextPath(next) ? next : null,
    error: error || null,
  };
}

/** La misma URL sin los parámetros de Auth (no deja códigos en el historial). */
export function cleanAuthUrl(href) {
  const url = new URL(href);
  ['code', 'token_hash', 'type', 'auth', 'next', 'error', 'error_code', 'error_description'].forEach((k) => url.searchParams.delete(k));
  return url.toString();
}

/**
 * @param {{
 *   gateway: ReturnType<import('../data/auth-gateway.js').createAuthGateway>,
 *   siteUrl?: string,
 *   location?: { href: string },
 *   history?: { replaceState: Function },
 * }} deps
 */
export function createAuthService({ gateway, location = globalThis.location, history = globalThis.history, siteUrl = siteUrlFor(location) }) {
  if (!gateway) throw new Error('Falta el acceso a Supabase Auth.');
  let status = AUTH_STATUS.loading;
  let user = null;
  let endReason = null;
  let signingOut = false;
  let recoveryMode = false;
  const listeners = new Set();
  let unsubscribe = null;

  const snapshot = () => ({ status, user: user ? { ...user } : null, endReason, recoveryMode });
  const emit = () => listeners.forEach((fn) => {
    try {
      fn(snapshot());
    } catch {
      /* un oyente con error no corta a los demás */
    }
  });
  const setState = (nextStatus, nextUser, reason = null) => {
    status = nextStatus;
    user = nextUser;
    endReason = reason;
    emit();
  };

  function onGatewayChange(event, nextUser) {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryMode = true;
      setState(AUTH_STATUS.authenticated, nextUser);
      return;
    }
    if (event === 'SIGNED_OUT') {
      // Cierre pedido por la persona: "signed_out"; si no (sesión vencida o
      // revocada en otro lado): "expired" → "Tu sesión terminó. Volvé a ingresar."
      const reason = signingOut ? 'signed_out' : status === AUTH_STATUS.authenticated ? 'expired' : null;
      recoveryMode = false;
      setState(AUTH_STATUS.anonymous, null, reason);
      return;
    }
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && nextUser) {
      const changed = !user || user.id !== nextUser.id || status !== AUTH_STATUS.authenticated;
      user = nextUser;
      if (changed) setState(AUTH_STATUS.authenticated, nextUser);
    }
  }

  return {
    get status() {
      return status;
    },
    get user() {
      return user ? { ...user } : null;
    },
    /** Modo real: hay cuentas. (La interfaz anterior tenía available: false.) */
    available: true,
    mode: 'supabase',

    snapshot,

    /** @param {(state: ReturnType<typeof snapshot>) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Arranque: procesa un enlace de email si lo hay y restaura la sesión.
     * @returns {Promise<{ redirect: null | { ok: boolean, kind: string|null, next: string|null, message: string|null } }>}
     */
    async init() {
      const redirect = await this.handleRedirect();
      const res = await gateway.getUser();
      if (!unsubscribe) unsubscribe = gateway.onChange(onGatewayChange);
      setState(res.ok && res.user ? AUTH_STATUS.authenticated : AUTH_STATUS.anonymous, res.ok ? res.user : null);
      return { redirect };
    },

    /** Canjea ?code= / ?token_hash= de los enlaces de email y limpia la URL. */
    async handleRedirect() {
      const href = location && location.href;
      const params = href ? parseAuthRedirect(href) : null;
      if (!params) return null;
      if (history && typeof history.replaceState === 'function') {
        try {
          history.replaceState(null, '', cleanAuthUrl(href));
        } catch {
          /* la URL queda como estaba */
        }
      }
      let result;
      if (params.error && !params.code) {
        result = { ok: false, code: AUTH_ERRORS.linkInvalid };
      } else if (params.code) {
        result = await gateway.exchangeCode(params.code);
      } else if (params.tokenHash && params.type) {
        result = await gateway.verifyEmailToken(params.tokenHash, params.type);
      } else {
        result = { ok: false, code: null };
      }
      const kind = params.kind || (params.type === 'recovery' ? 'recovery' : params.code || params.tokenHash ? 'confirm' : null);
      if (result.ok && kind === 'recovery') recoveryMode = true;
      let message = null;
      if (!result.ok && result.code) {
        // Confirmación abierta en otro navegador (PKCE): el email igual quedó confirmado.
        message = result.code === AUTH_ERRORS.linkInvalid && kind === 'confirm'
          ? 'Tu email ya puede estar confirmado. Ingresá con tu email y contraseña; si no podés, pedí un enlace nuevo.'
          : messageFor(result.code);
      }
      return { ok: Boolean(result.ok), kind, next: params.next, message };
    },

    async signUp({ fullName, company, email, password, next = null }) {
      const errors = validateSignUp({ fullName, company, email, password });
      if (Object.keys(errors).length) return { ok: false, errors, message: 'Revisá los campos marcados.' };
      const res = await gateway.signUp({
        email: String(email).trim(),
        password: String(password),
        fullName: clean(fullName),
        company: clean(company),
        redirectTo: authRedirectUrl('confirm', next, siteUrl),
      });
      if (!res.ok) return { ok: false, errors: res.code === AUTH_ERRORS.emailTaken ? { email: messageFor(res.code) } : {}, message: messageFor(res.code), code: res.code };
      if (res.needsConfirmation) {
        return { ok: true, needsConfirmation: true, message: 'Revisá tu email para confirmar tu cuenta. Te enviamos un enlace.' };
      }
      setState(AUTH_STATUS.authenticated, res.user);
      return { ok: true, needsConfirmation: false, message: null };
    },

    async signIn({ email, password }) {
      const errors = validateSignIn({ email, password });
      if (Object.keys(errors).length) return { ok: false, errors, message: 'Revisá los campos marcados.' };
      const res = await gateway.signIn({ email: String(email).trim(), password: String(password) });
      if (!res.ok) return { ok: false, errors: {}, message: messageFor(res.code), code: res.code };
      setState(AUTH_STATUS.authenticated, res.user);
      return { ok: true, message: null };
    },

    async signOut() {
      signingOut = true;
      try {
        const res = await gateway.signOut();
        // Aunque la red falle, la sesión local se descarta.
        recoveryMode = false;
        setState(AUTH_STATUS.anonymous, null, 'signed_out');
        return { ok: res.ok, message: res.ok ? null : messageFor(res.code) };
      } finally {
        signingOut = false;
      }
    },

    /**
     * La base rechazó el token (401) aunque el SDK creía tener sesión: se
     * intenta renovar UNA vez. Si no hay sesión válida, se cierra la local
     * con motivo "expired" ("Tu sesión terminó. Volvé a ingresar."). Sin
     * conexión no se cierra nada (queda "sin sincronizar").
     * @returns {Promise<{ ok: boolean, code?: string }>}
     */
    async revalidate() {
      if (status !== AUTH_STATUS.authenticated) return { ok: false, code: 'session_missing' };
      const res = await gateway.refresh();
      if (res.ok) return { ok: true };
      if (res.code === AUTH_ERRORS.network) return { ok: false, code: res.code };
      signingOut = true;
      try {
        await gateway.signOut();
      } finally {
        signingOut = false;
      }
      recoveryMode = false;
      setState(AUTH_STATUS.anonymous, null, 'expired');
      return { ok: false, code: 'expired' };
    },

    /** Siempre responde lo mismo (no revela si el email tiene cuenta). */
    async requestPasswordReset(email) {
      if (!EMAIL_RE.test(String(email || '').trim())) return { ok: false, errors: { email: 'Ingresá un email válido.' }, message: 'Revisá los campos marcados.' };
      const res = await gateway.requestPasswordReset(String(email).trim(), authRedirectUrl('recovery', null, siteUrl));
      if (!res.ok && (res.code === AUTH_ERRORS.network || res.code === AUTH_ERRORS.rateLimited)) return { ok: false, errors: {}, message: messageFor(res.code) };
      return { ok: true, message: 'Si hay una cuenta con ese email, te enviamos un enlace para recuperar tu contraseña.' };
    },

    async updatePassword(password) {
      if (String(password || '').length < MIN_PASSWORD_LENGTH) {
        return { ok: false, errors: { password: `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, message: 'Revisá los campos marcados.' };
      }
      const res = await gateway.updatePassword(String(password));
      if (!res.ok) return { ok: false, errors: {}, message: messageFor(res.code) };
      recoveryMode = false;
      emit();
      return { ok: true, message: 'Listo: tu contraseña quedó actualizada.' };
    },

    /** Deja de escuchar cambios de sesión (tests). */
    dispose() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      listeners.clear();
    },
  };
}
