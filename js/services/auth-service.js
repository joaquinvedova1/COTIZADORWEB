/**
 * AuthService — cuentas reales con Supabase Auth (punto único de auth).
 *
 * Estados de sesión: 'loading' (todavía no se sabe: la UI no muestra nada
 * protegido) → 'anonymous' | 'authenticated'.
 *
 * - Registro público (FEATURES.publicSignup = true, decisión del dueño del
 *   2026-10-20): nombre, empresa, email y contraseña, con confirmación de
 *   email obligatoria. El trigger de la base crea perfil, organización
 *   (OWNER) y workspace vacío. La respuesta es la misma sea el email nuevo o
 *   ya registrado (no revela quién usa RATEOS). Con publicSignup = false
 *   (beta por invitación) la app no llama al registro.
 * - Ingreso, cierre de sesión, recuperación y cambio de contraseña.
 * - Enlaces de los emails (confirmación y recuperación) con flujo PKCE:
 *   vuelven a https://…/COTIZADORWEB/?code=…&auth=…&next=… (query ANTES del
 *   #, compatible con el router por hash). handleRedirect() canjea el
 *   código, limpia la URL y devuelve a dónde ir.
 * - Mensajes humanos: nunca errores internos, tokens ni stack traces.
 * - Las contraseñas nunca se guardan ni se loguean: sólo pasan al SDK.
 */

import { FEATURES, MOVED_TO_SITE_URL, PUBLIC_SITE_URL, PUBLIC_SITE_URLS } from '../config.js';
import { logger } from '../core/logger.js';
import { AUTH_ERRORS } from '../data/auth-gateway.js';
import { isSafeNextPath } from './auth-routing.js';

export const AUTH_STATUS = Object.freeze({ loading: 'loading', anonymous: 'anonymous', authenticated: 'authenticated' });

/** Textos para personas. */
export const AUTH_MESSAGES = Object.freeze({
  // Sólo para registros internos: en pantalla el registro responde neutro (no revela si el email existe).
  [AUTH_ERRORS.emailTaken]: 'Ese email ya está registrado. Ingresá o recuperá tu contraseña.',
  [AUTH_ERRORS.signupClosed]: 'En este momento no se pueden crear cuentas nuevas en RATEOS. Si ya tenés una, ingresá con tu email (o elegí tu contraseña con «¿Olvidaste tu contraseña?»).',
  [AUTH_ERRORS.invalidCredentials]: 'No pudimos iniciar sesión. Revisá el email y la contraseña.',
  [AUTH_ERRORS.emailNotConfirmed]: 'Todavía no confirmaste tu email. Abrí el enlace del correo que te enviamos (revisá también spam y promociones) o pedí que te lo reenviemos.',
  [AUTH_ERRORS.weakPassword]: 'La contraseña es muy débil. Usá al menos 8 caracteres combinando letras y números.',
  [AUTH_ERRORS.samePassword]: 'La contraseña nueva tiene que ser distinta de la anterior.',
  [AUTH_ERRORS.invalidEmail]: 'Revisá el email: no parece válido.',
  [AUTH_ERRORS.emailNotAuthorized]: 'No pudimos enviarte el email: RATEOS todavía no tiene habilitado el envío de correos a tu dirección. Probá de nuevo más tarde.',
  [AUTH_ERRORS.rateLimited]: 'Hubo muchos intentos seguidos. Esperá unos minutos y probá de nuevo.',
  [AUTH_ERRORS.linkInvalid]: 'El enlace venció o ya se usó. Pedí uno nuevo.',
  [AUTH_ERRORS.sessionMissing]: 'Tu sesión terminó. Volvé a ingresar.',
  [AUTH_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
  [AUTH_ERRORS.unknown]: 'No pudimos completar la operación. Probá de nuevo en unos minutos.',
});

/**
 * "¿Olvidaste tu contraseña?" sin sesión (HD-03): la misma respuesta haya o no
 * cuenta (no revela quién usa RATEOS), pero dice qué hacer si no llega nada:
 * sin alta previa Supabase no envía ningún correo.
 */
export const RESET_REQUESTED_MESSAGE = 'Pedido enviado. Si ese email tiene una cuenta en RATEOS, en unos minutos te llega un correo para elegir tu contraseña. Si no llega en 10 minutos (revisá también spam y promociones), puede que ese email todavía no tenga cuenta: creala en «Crear cuenta».';
/**
 * Subtítulo de "¿Olvidaste tu contraseña?" ANTES de pedir nada: no promete un
 * correo (sin alta previa no sale ninguno) y dice que primero hace falta acceso.
 */
export const RECOVER_REQUEST_SUBTITLE = 'Pedí un correo para elegir una contraseña nueva. Sólo llega si ese email tiene una cuenta en RATEOS.';
/** "Cambiar contraseña" con la sesión iniciada y el propio email: no hay nada que ocultar. */
export const RESET_SENT_OWN_MESSAGE = 'Te enviamos un correo para elegir una contraseña nueva. Seguí sus pasos: si trae un enlace, abrilo en este mismo navegador.';
/**
 * Registro (HD-03, registro público): la misma respuesta sea el email nuevo o
 * ya registrado. Supabase tampoco lo revela: con la confirmación activa, a un
 * email ya registrado le devuelve un usuario "de mentira" y no le manda nada.
 */
export const SIGNUP_REQUESTED_MESSAGE = 'Listo. Si ese email no tenía una cuenta en RATEOS, en unos minutos te llega un correo para confirmarla: abrí el enlace en este mismo navegador. Si ya tenías cuenta con ese email, no te llega nada: ingresá o usá «¿Olvidaste tu contraseña?». Si no llega en 10 minutos, revisá spam y promociones y pedí que te lo reenviemos.';
/** Reenvío del correo de confirmación: neutro (no revela si la cuenta existe ni si ya está confirmada). */
export const CONFIRMATION_RESENT_MESSAGE = 'Pedido enviado. Si ese email tiene una cuenta sin confirmar, en unos minutos te llega otro correo para confirmarla (sólo sirve el último). Abrí el enlace en este mismo navegador.';
/**
 * El correo de confirmación no salió (SMTP por defecto o roto). Supabase no
 * crea la cuenta si no puede enviarlo, así que se dice: callar dejaría a la
 * persona esperando un correo que no existe (lo que originó HD-03). Sólo pasa
 * mientras el envío de correos está roto.
 */
export const SIGNUP_MAIL_FAILED_MESSAGE = 'No pudimos enviarte el correo para confirmar la cuenta, así que todavía no se creó. Probá de nuevo en unos minutos.';
/**
 * Espera de la pantalla entre dos pedidos del correo. Es sólo una ayuda de UX:
 * vive en la memoria de esa pantalla (recargar o navegar la saltea). Los
 * límites efectivos los pone Supabase (por dirección y por hora); su 429 se
 * informa con `rateLimited`.
 */
export const RESET_COOLDOWN_SECONDS = 60;
/** El código del correo ({{ .Token }}) no sirve o venció. */
export const CODE_INVALID_MESSAGE = 'El código no es válido o venció. Pedí un correo nuevo y usá el código del último que llegue.';
/**
 * Enlace de recuperación que no se pudo canjear (otro navegador, escáner de
 * correo, vencido). Abrir el enlace ya usó el correo entero: en Supabase el
 * enlace y el código son la misma credencial, así que el código de ESE correo
 * tampoco sirve. Hay que pedir otro.
 */
export const RECOVERY_LINK_INVALID_MESSAGE = 'El enlace venció, ya se usó o se abrió en otro navegador, y con eso el código de ese correo tampoco sirve. Pedí un correo nuevo en «¿Olvidaste tu contraseña?»: abrí el enlace en el mismo navegador donde lo pediste o, si lo leés en otro dispositivo, no toques el enlace y escribí el código en «Ya tengo un código».';
/** Enlace con tokens en el # (p. ej. "Send invitation" de Supabase): RATEOS no lo usa. */
export const INVITE_LINK_MESSAGE = 'Ese enlace no sirve para entrar a RATEOS. Si ya te dieron de alta, elegí tu contraseña con «¿Olvidaste tu contraseña?» y el mismo email.';

export const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Código de recuperación: de 6 a 10 dígitos según "Email OTP Length" de Supabase. */
const RECOVERY_CODE_RE = /^\d{6,10}$/;

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
 * Base de los enlaces de los emails de Auth (deben estar permitidos en
 * Supabase → Authentication → URL Configuration). Sin "#": PKCE agrega
 * ?code=… y el router por hash no se rompe.
 *
 * - En un sitio público de producción (PUBLIC_SITE_URLS), ese mismo sitio: el
 *   enlace PKCE sólo funciona en el origen donde se pidió (ahí quedó el
 *   code_verifier), así que mientras convivan github.io y el dominio propio
 *   cada uno usa los suyos.
 * - En desarrollo local (localhost / 127.0.0.1 bajo /COTIZADORWEB/), el servidor local.
 * - Cualquier otro origen: el sitio principal (el primero de la lista).
 */
export function siteUrlFor(location, sites = PUBLIC_SITE_URLS) {
  const list = Array.isArray(sites) && sites.length ? sites : [PUBLIC_SITE_URL];
  try {
    const url = new URL(location && location.href ? location.href : '');
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (local && url.pathname.startsWith('/COTIZADORWEB/')) return `${url.origin}/COTIZADORWEB/`;
    for (const site of list) {
      const s = new URL(site);
      if (url.origin === s.origin && url.pathname.startsWith(s.pathname)) return s.href;
    }
  } catch {
    /* sin location: el sitio principal */
  }
  return new URL(list[0]).href;
}

/**
 * Mudanza al dominio propio (HD-01): ¿hay que irse de este sitio? Devuelve la
 * URL nueva (conservando la ruta del hash) sólo si `movedTo` está definido y
 * la app corre en OTRO sitio público de producción (nunca en desarrollo local,
 * en el sitio nuevo ni en un origen desconocido). La query (p. ej. ?code= de
 * un enlace viejo) no viaja: no serviría en el origen nuevo.
 * @returns {string|null}
 */
export function movedTarget(location, { movedTo = MOVED_TO_SITE_URL, sites = PUBLIC_SITE_URLS } = {}) {
  if (!movedTo) return null;
  try {
    const url = new URL(location && location.href ? location.href : '');
    const target = new URL(movedTo);
    if (target.protocol !== 'https:' || url.origin === target.origin) return null;
    const onPublicSite = (Array.isArray(sites) ? sites : []).some((site) => {
      const s = new URL(site);
      return url.origin === s.origin && url.pathname.startsWith(s.pathname);
    });
    if (!onPublicSite) return null;
    target.search = '';
    target.hash = url.hash;
    return target.href;
  } catch {
    return null;
  }
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
 *
 * Sólo se aceptan enlaces PKCE (?code=…): canjearlos exige el code_verifier
 * que quedó en ESTE navegador al registrarse o pedir la recuperación, así que
 * nadie puede hacer entrar a otra persona en su cuenta mandándole un enlace.
 * Los enlaces con ?token_hash= (que no exigen nada de este navegador) se
 * rechazan: un atacante podría usarlos para abrir SU cuenta en el navegador
 * de la víctima y recibir lo que ella cargue.
 * @returns {null | { code: string|null, kind: string|null, next: string|null, error: string|null }}
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
  const error = p.get('error_code') || p.get('error') || (tokenHash && !code ? 'unsupported_link' : null);
  const kind = p.get('auth');
  if (!code && !error && !kind) return null;
  const next = p.get('next');
  return {
    code: code || null,
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
 * Enlaces "implícitos", con datos de Auth en el # (#access_token=…,
 * #error_code=…): los arma "Send invitation" de Supabase y algunos errores de
 * sus enlaces. RATEOS no los usa (abrirían una sesión sin el code_verifier de
 * este navegador, igual que ?token_hash=): sólo se detectan para borrarlos de la
 * URL y explicar qué hacer. Una ruta del router (#/…) nunca coincide.
 * @returns {null | { kind: 'implicit' | 'error', error: string|null }}
 */
export function parseAuthFragment(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fragment = url.hash.replace(/^#/, '');
  if (!fragment || fragment.startsWith('/')) return null;
  const p = new URLSearchParams(fragment);
  const tokens = p.has('access_token') || p.has('refresh_token') || p.has('provider_token');
  const error = p.get('error_code') || p.get('error');
  if (!tokens && !error) return null;
  return { kind: tokens ? 'implicit' : 'error', error: error || null };
}

/** La URL sin el # ni los parámetros de Auth (los tokens no quedan en la barra ni en el historial). */
export function cleanAuthFragment(href) {
  const url = new URL(cleanAuthUrl(href));
  url.hash = '';
  return url.toString();
}

/**
 * @param {{
 *   gateway: ReturnType<import('../data/auth-gateway.js').createAuthGateway>,
 *   siteUrl?: string,
 *   location?: { href: string },
 *   history?: { replaceState: Function },
 *   publicSignup?: boolean,
 * }} deps publicSignup: false = beta por invitación (la app no llama al registro).
 */
export function createAuthService({ gateway, location = globalThis.location, history = globalThis.history, siteUrl = siteUrlFor(location), publicSignup = FEATURES.publicSignup }) {
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

    /** Canjea el ?code= (PKCE) de los enlaces de email y limpia la URL. */
    async handleRedirect() {
      const href = location && location.href;
      const params = href ? parseAuthRedirect(href) : null;
      const fragment = href ? parseAuthFragment(href) : null;
      const replaceUrl = (url) => {
        if (history && typeof history.replaceState === 'function') {
          try {
            history.replaceState(null, '', url);
          } catch {
            /* la URL queda como estaba */
          }
        }
      };
      if (fragment) {
        // Tokens o errores en el #: nunca se usan; se borran y se explica qué hacer.
        replaceUrl(cleanAuthFragment(href));
        const kind = params && params.kind;
        const message = fragment.kind === 'implicit'
          ? INVITE_LINK_MESSAGE
          : kind === 'recovery' ? RECOVERY_LINK_INVALID_MESSAGE : messageFor(AUTH_ERRORS.linkInvalid);
        return { ok: false, kind: kind || null, next: null, message };
      }
      if (!params) return null;
      replaceUrl(cleanAuthUrl(href));
      let result;
      if (params.error && !params.code) {
        result = { ok: false, code: AUTH_ERRORS.linkInvalid };
      } else if (params.code) {
        result = await gateway.exchangeCode(params.code);
      } else {
        result = { ok: false, code: null };
      }
      const kind = params.kind || (params.code ? 'confirm' : null);
      if (result.ok && kind === 'recovery') recoveryMode = true;
      let message = null;
      if (!result.ok && result.code) {
        // Confirmación abierta en otro navegador (PKCE): el email igual quedó confirmado.
        if (result.code === AUTH_ERRORS.linkInvalid && kind === 'confirm') message = 'Tu email ya puede estar confirmado. Ingresá con tu email y contraseña; si no podés, pedí un enlace nuevo.';
        else if (result.code === AUTH_ERRORS.linkInvalid && kind === 'recovery') message = RECOVERY_LINK_INVALID_MESSAGE;
        else message = messageFor(result.code);
      }
      return { ok: Boolean(result.ok), kind, next: params.next, message };
    },

    async signUp({ fullName, company, email, password, next = null }) {
      // Beta por invitación: ni se llama a Supabase (la barrera real es Auth con
      // el registro apagado; esto sólo evita ofrecerlo).
      if (!publicSignup) return { ok: false, errors: {}, message: messageFor(AUTH_ERRORS.signupClosed), code: AUTH_ERRORS.signupClosed };
      const errors = validateSignUp({ fullName, company, email, password });
      if (Object.keys(errors).length) return { ok: false, errors, message: 'Revisá los campos marcados.' };
      const res = await gateway.signUp({
        email: String(email).trim(),
        password: String(password),
        fullName: clean(fullName),
        company: clean(company),
        redirectTo: authRedirectUrl('confirm', next, siteUrl),
      });
      // Email ya registrado: la misma respuesta que un registro nuevo (no se revela quién usa RATEOS).
      if (res.ok ? res.needsConfirmation : res.code === AUTH_ERRORS.emailTaken) {
        return { ok: true, needsConfirmation: true, message: SIGNUP_REQUESTED_MESSAGE, cooldownSeconds: RESET_COOLDOWN_SECONDS };
      }
      if (!res.ok && res.code === AUTH_ERRORS.emailNotAuthorized) {
        logger.warn('Auth: Supabase no envió la confirmación del registro (usa su SMTP por defecto, que sólo envía al equipo del proyecto: configurar un SMTP propio).');
        return { ok: false, errors: {}, message: SIGNUP_MAIL_FAILED_MESSAGE, code: res.code };
      }
      if (!res.ok) return { ok: false, errors: {}, message: messageFor(res.code), code: res.code };
      setState(AUTH_STATUS.authenticated, res.user);
      return { ok: true, needsConfirmation: false, message: null };
    },

    /**
     * "Reenviar el correo de confirmación": la misma respuesta haya o no cuenta
     * sin confirmar (sólo la red o el límite de envíos se informan).
     */
    async resendConfirmation(email, next = null) {
      if (!EMAIL_RE.test(String(email || '').trim())) return { ok: false, errors: { email: 'Ingresá un email válido.' }, message: 'Revisá los campos marcados.' };
      const res = await gateway.resendSignupConfirmation(String(email).trim(), authRedirectUrl('confirm', next, siteUrl));
      if (!res.ok && res.code === AUTH_ERRORS.emailNotAuthorized) {
        logger.warn('Auth: Supabase no reenvió la confirmación (usa su SMTP por defecto, que sólo envía al equipo del proyecto: configurar un SMTP propio).');
      }
      if (!res.ok && (res.code === AUTH_ERRORS.network || res.code === AUTH_ERRORS.rateLimited)) return { ok: false, errors: {}, message: messageFor(res.code) };
      return { ok: true, message: CONFIRMATION_RESENT_MESSAGE, cooldownSeconds: RESET_COOLDOWN_SECONDS };
    },

    async signIn({ email, password }) {
      const errors = validateSignIn({ email, password });
      if (Object.keys(errors).length) return { ok: false, errors, message: 'Revisá los campos marcados.' };
      const res = await gateway.signIn({ email: String(email).trim(), password: String(password) });
      // Sin confirmar: Supabase lo dice sólo con la contraseña correcta (no revela cuentas); se ofrece reenviar.
      if (!res.ok) return { ok: false, errors: {}, message: messageFor(res.code), code: res.code, unconfirmed: res.code === AUTH_ERRORS.emailNotConfirmed };
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

    /**
     * Sin sesión responde siempre lo mismo (no revela si el email tiene
     * cuenta). Con la sesión iniciada y el propio email ("Cambiar contraseña")
     * no hay nada que revelar: si el correo no salió, se dice.
     */
    async requestPasswordReset(email) {
      if (!EMAIL_RE.test(String(email || '').trim())) return { ok: false, errors: { email: 'Ingresá un email válido.' }, message: 'Revisá los campos marcados.' };
      const address = String(email).trim();
      const res = await gateway.requestPasswordReset(address, authRedirectUrl('recovery', null, siteUrl));
      if (!res.ok && res.code === AUTH_ERRORS.emailNotAuthorized) {
        // HD-03: con el SMTP por defecto de Supabase las personas invitadas nunca reciben el correo (docs/BETA_PERIMETER.md §2).
        logger.warn('Auth: Supabase no envió el correo (usa su SMTP por defecto, que sólo envía al equipo del proyecto: configurar un SMTP propio).');
      }
      const own = status === AUTH_STATUS.authenticated && Boolean(user && user.email) && user.email.toLowerCase() === address.toLowerCase();
      if (!res.ok && (own || res.code === AUTH_ERRORS.network || res.code === AUTH_ERRORS.rateLimited)) return { ok: false, errors: {}, message: messageFor(res.code) };
      return { ok: true, message: own ? RESET_SENT_OWN_MESSAGE : RESET_REQUESTED_MESSAGE, cooldownSeconds: RESET_COOLDOWN_SECONDS };
    },

    /**
     * Código del correo de recuperación (HD-03): alternativa al enlace PKCE que
     * sirve en cualquier navegador (correo leído en el celular), siempre que
     * nadie haya abierto antes el enlace de ese correo: enlace y código son la
     * misma credencial. Con éxito queda la sesión en modo recuperación: la
     * pantalla pide la contraseña nueva.
     */
    async verifyRecoveryCode(email, code) {
      const errors = {};
      const address = String(email || '').trim();
      const digits = String(code ?? '').replace(/[\s-]/g, '');
      if (!EMAIL_RE.test(address)) errors.email = 'Ingresá el email de tu cuenta.';
      if (!RECOVERY_CODE_RE.test(digits)) errors.code = 'El código son los números que trae el correo.';
      if (Object.keys(errors).length) return { ok: false, errors, message: 'Revisá los campos marcados.' };
      const res = await gateway.verifyRecoveryCode(address, digits);
      if (res.ok && !(res.user && res.user.id)) {
        // Respuesta incompleta: nunca queda "autenticado" ni en modo recuperación sin usuario.
        logger.warn('Auth: la verificación del código no devolvió un usuario; no se abre la recuperación.');
        return { ok: false, errors: {}, message: messageFor(AUTH_ERRORS.unknown), code: AUTH_ERRORS.unknown };
      }
      if (!res.ok) {
        const invalid = res.code === AUTH_ERRORS.linkInvalid;
        return { ok: false, errors: invalid ? { code: CODE_INVALID_MESSAGE } : {}, message: invalid ? CODE_INVALID_MESSAGE : messageFor(res.code), code: res.code };
      }
      recoveryMode = true;
      setState(AUTH_STATUS.authenticated, res.user);
      return { ok: true, message: null };
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
