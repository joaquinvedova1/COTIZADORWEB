/**
 * Puerta de acceso a Supabase Auth (capa de datos).
 *
 * Traduce el SDK a resultados simples { ok, code, … } con códigos propios
 * (nunca mensajes internos de Supabase, tokens ni stack traces). Los textos
 * para personas los arma js/services/auth-service.js.
 *
 * Las contraseñas sólo pasan por acá hacia el SDK: nunca se guardan, ni se
 * loguean, ni van a eventos.
 */

/** Códigos de error que entiende la app. */
export const AUTH_ERRORS = Object.freeze({
  emailTaken: 'email_taken',
  invalidCredentials: 'invalid_credentials',
  emailNotConfirmed: 'email_not_confirmed',
  weakPassword: 'weak_password',
  samePassword: 'same_password',
  invalidEmail: 'invalid_email',
  rateLimited: 'rate_limited',
  linkInvalid: 'link_invalid',
  sessionMissing: 'session_missing',
  network: 'network',
  unknown: 'unknown',
});

/** Código propio a partir de un error del SDK (sin exponer su mensaje). */
export function authErrorCode(error) {
  if (!error) return null;
  const code = String(error.code || '');
  const name = String(error.name || '');
  const status = Number(error.status);
  if (name === 'AuthRetryableFetchError' || status === 0 || name === 'TypeError') return AUTH_ERRORS.network;
  if (code === 'user_already_exists' || code === 'email_exists') return AUTH_ERRORS.emailTaken;
  if (code === 'invalid_credentials') return AUTH_ERRORS.invalidCredentials;
  if (code === 'email_not_confirmed') return AUTH_ERRORS.emailNotConfirmed;
  if (code === 'weak_password') return AUTH_ERRORS.weakPassword;
  if (code === 'same_password') return AUTH_ERRORS.samePassword;
  if (code === 'email_address_invalid' || code === 'validation_failed') return AUTH_ERRORS.invalidEmail;
  if (code.startsWith('over_') || status === 429) return AUTH_ERRORS.rateLimited;
  if (['otp_expired', 'flow_state_not_found', 'flow_state_expired', 'bad_code_verifier', 'bad_oauth_state'].includes(code)) return AUTH_ERRORS.linkInvalid;
  if (name === 'AuthPKCECodeVerifierMissingError') return AUTH_ERRORS.linkInvalid;
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || name === 'AuthSessionMissingError') return AUTH_ERRORS.sessionMissing;
  if (status === 400 && /invalid login/i.test(String(error.message || ''))) return AUTH_ERRORS.invalidCredentials;
  return AUTH_ERRORS.unknown;
}

/** Datos del usuario que necesita la app (nada de tokens ni metadatos internos). */
export function publicUser(user) {
  if (!user || typeof user.id !== 'string') return null;
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email : '',
    fullName: typeof meta.full_name === 'string' ? meta.full_name : '',
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}

async function call(fn) {
  try {
    const { data, error } = await fn();
    if (error) return { ok: false, code: authErrorCode(error), data: null };
    return { ok: true, code: null, data };
  } catch (error) {
    return { ok: false, code: authErrorCode(error) || AUTH_ERRORS.unknown, data: null };
  }
}

/**
 * @param {object} client cliente de Supabase (js/data/supabase-client.js)
 */
export function createAuthGateway(client) {
  if (!client || !client.auth) throw new Error('Cliente de Supabase inválido.');
  const auth = client.auth;
  return {
    /** Sesión actual (restaurada del storage; el SDK la renueva sola). */
    async getUser() {
      const res = await call(() => auth.getSession());
      if (!res.ok) return { ok: false, code: res.code, user: null };
      const session = res.data && res.data.session;
      return { ok: true, code: null, user: session ? publicUser(session.user) : null };
    },

    /**
     * Escucha cambios de sesión. El callback recibe (evento, usuario|null):
     * SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, INITIAL_SESSION.
     * @returns {() => void}
     */
    onChange(callback) {
      const { data } = auth.onAuthStateChange((event, session) => {
        // Diferido: el SDK pide no llamar a otros métodos de auth dentro del callback.
        setTimeout(() => callback(event, session ? publicUser(session.user) : null), 0);
      });
      return () => data && data.subscription && data.subscription.unsubscribe();
    },

    /**
     * Registro con nombre y empresa (los usa el trigger de alta para crear
     * el perfil y la organización). Con confirmación de email activada no
     * hay sesión hasta confirmar.
     */
    async signUp({ email, password, fullName, company, redirectTo }) {
      const res = await call(() => auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo, data: { full_name: fullName, company } },
      }));
      if (!res.ok) return { ok: false, code: res.code };
      const user = res.data && res.data.user;
      // Con confirmación activada, un email ya registrado devuelve un usuario
      // sin identidades (Supabase no revela si existe): se avisa igual.
      if (user && Array.isArray(user.identities) && user.identities.length === 0) return { ok: false, code: AUTH_ERRORS.emailTaken };
      const session = res.data && res.data.session;
      return { ok: true, code: null, needsConfirmation: !session, user: session ? publicUser(session.user) : null };
    },

    async signIn({ email, password }) {
      const res = await call(() => auth.signInWithPassword({ email, password }));
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, user: publicUser(res.data && res.data.user) };
    },

    /** Cierra la sesión de este navegador (el refresh token queda revocado en el servidor). */
    async signOut() {
      const res = await call(() => auth.signOut({ scope: 'local' }));
      return res.ok ? { ok: true, code: null } : { ok: false, code: res.code };
    },

    async requestPasswordReset(email, redirectTo) {
      const res = await call(() => auth.resetPasswordForEmail(email, { redirectTo }));
      return res.ok ? { ok: true, code: null } : { ok: false, code: res.code };
    },

    async updatePassword(password) {
      const res = await call(() => auth.updateUser({ password }));
      return res.ok ? { ok: true, code: null } : { ok: false, code: res.code };
    },

    async updateFullName(fullName) {
      const res = await call(() => auth.updateUser({ data: { full_name: fullName } }));
      return res.ok ? { ok: true, code: null, user: publicUser(res.data && res.data.user) } : { ok: false, code: res.code };
    },

    /** Canje del código PKCE que trae el enlace del email (?code=…). */
    async exchangeCode(code) {
      const res = await call(() => auth.exchangeCodeForSession(code));
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, user: publicUser(res.data && (res.data.user || (res.data.session && res.data.session.user))) };
    },

    /** Enlaces con token_hash (plantillas de email personalizadas): funcionan en otro dispositivo. */
    async verifyEmailToken(tokenHash, type) {
      const res = await call(() => auth.verifyOtp({ token_hash: tokenHash, type }));
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, user: publicUser(res.data && res.data.user) };
    },
  };
}
