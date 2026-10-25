/**
 * AuthService (Supabase Auth) con una puerta falsa: registro, ingreso,
 * cierre, sesión restaurada, sesión vencida, recuperación, enlaces de email
 * con el router por hash y mensajes humanos. Las contraseñas nunca se guardan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_STATUS,
  authRedirectUrl,
  cleanAuthUrl,
  createAuthService,
  messageFor,
  movedTarget,
  parseAuthRedirect,
  siteUrlFor,
  validateSignUp,
  RESET_REQUESTED_MESSAGE,
  SIGNUP_REQUESTED_MESSAGE,
} from '../../js/services/auth-service.js';
import { AUTH_ERRORS, authErrorCode, createAuthGateway, publicUser } from '../../js/data/auth-gateway.js';
import { FEATURES } from '../../js/config.js';
import { addLogSink } from '../../js/core/logger.js';
import { clearLocalAuthSession } from '../../js/data/supabase-client.js';
import { createFakeAuthGateway, SpyStorage } from '../helpers/fake-supabase.js';

const SITE = 'https://joaquinvedova1.github.io/COTIZADORWEB/';

/** publicSignup: true por defecto acá (el flujo de registro se sigue probando para cuando se reabra). */
function service(gateway, href = `${SITE}#/`, { publicSignup = true } = {}) {
  const location = { href };
  const history = {
    replaced: [],
    replaceState(_s, _t, url) {
      this.replaced.push(url);
      location.href = url;
    },
  };
  return { auth: createAuthService({ gateway, siteUrl: SITE, location, history, publicSignup }), location, history };
}

describe('AuthService: registro e ingreso', () => {
  test('arranca en "loading" y pasa a "anonymous" sin sesión', async () => {
    const { auth } = service(createFakeAuthGateway());
    assert.equal(auth.status, AUTH_STATUS.loading);
    await auth.init();
    assert.equal(auth.status, AUTH_STATUS.anonymous);
  });

  test('registro con confirmación de email: "Revisá tu email", sin sesión todavía', async () => {
    const gw = createFakeAuthGateway({ confirmEmail: true });
    const { auth } = service(gw);
    await auth.init();
    const res = await auth.signUp({ fullName: 'Joaquín', company: 'Grúas del Sur', email: 'j@example.com', password: 'clave-segura-1', next: '/cotizaciones/nueva' });
    assert.equal(res.ok, true);
    assert.equal(res.needsConfirmation, true);
    assert.equal(res.message, SIGNUP_REQUESTED_MESSAGE);
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.deepEqual(gw.lastSignUp, { email: 'j@example.com', fullName: 'Joaquín', company: 'Grúas del Sur', redirectTo: `${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva`, passwordLength: 14 });
  });

  test('registro sin confirmación (si el proyecto la desactiva): queda con sesión', async () => {
    const { auth } = service(createFakeAuthGateway({ confirmEmail: false }));
    await auth.init();
    const res = await auth.signUp({ fullName: 'Ana', company: 'Norte', email: 'ana@example.com', password: 'clave-segura-1' });
    assert.equal(res.needsConfirmation, false);
    assert.equal(auth.status, AUTH_STATUS.authenticated);
  });

  test('validación antes de la red: nombre, empresa, email y contraseña de 8+', () => {
    const errors = validateSignUp({ fullName: ' ', company: '', email: 'x', password: '123' });
    assert.deepEqual(Object.keys(errors).sort(), ['company', 'email', 'fullName', 'password']);
  });

  test('email ya registrado (misma respuesta que uno nuevo: no revela cuentas) y credenciales inválidas', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'ya@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    const { auth } = service(gw);
    await auth.init();
    const taken = await auth.signUp({ fullName: 'X', company: 'Y', email: 'ya@example.com', password: 'otra-clave-123' });
    const fresh = await auth.signUp({ fullName: 'X', company: 'Y', email: 'nueva@example.com', password: 'otra-clave-123' });
    assert.deepEqual(taken, fresh);
    assert.doesNotMatch(taken.message, /ya está registrado/);
    const bad = await auth.signIn({ email: 'ya@example.com', password: 'mal' });
    assert.equal(bad.message, 'No pudimos iniciar sesión. Revisá el email y la contraseña.');
    const ok = await auth.signIn({ email: 'ya@example.com', password: 'clave-segura-1' });
    assert.equal(ok.ok, true);
    assert.equal(auth.status, AUTH_STATUS.authenticated);
  });

  test('email sin confirmar: lo explica', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'nc@example.com', password: 'clave-segura-1', emailConfirmed: false }] });
    const { auth } = service(gw);
    await auth.init();
    const res = await auth.signIn({ email: 'nc@example.com', password: 'clave-segura-1' });
    assert.match(res.message, /Todavía no confirmaste tu email/);
  });

  test('logout: vuelve a anónimo con motivo "signed_out"', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'a@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    const { auth } = service(gw);
    await auth.init();
    await auth.signIn({ email: 'a@example.com', password: 'clave-segura-1' });
    await auth.signOut();
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(auth.snapshot().endReason, 'signed_out');
  });

  test('sesión restaurada al recargar', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'a@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    await gw.signIn({ email: 'a@example.com', password: 'clave-segura-1' });
    const { auth } = service(gw);
    await auth.init();
    assert.equal(auth.status, AUTH_STATUS.authenticated);
    assert.equal(auth.user.email, 'a@example.com');
  });

  test('sesión vencida o revocada: motivo "expired" (la UI muestra "Tu sesión terminó")', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'a@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    await gw.signIn({ email: 'a@example.com', password: 'clave-segura-1' });
    const { auth } = service(gw);
    await auth.init();
    const seen = [];
    auth.subscribe((s) => seen.push(s));
    gw.expire();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(seen.at(-1).endReason, 'expired');
  });

  test('la base rechazó el token: se renueva una vez; si no se puede, "expired" (Tu sesión terminó)', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'a@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    await gw.signIn({ email: 'a@example.com', password: 'clave-segura-1' });
    const { auth } = service(gw);
    await auth.init();
    assert.deepEqual(await auth.revalidate(), { ok: true });
    assert.equal(auth.status, AUTH_STATUS.authenticated);
    gw.refreshFails = 'network';
    assert.equal((await auth.revalidate()).ok, false);
    assert.equal(auth.status, AUTH_STATUS.authenticated, 'sin conexión no se cierra la sesión');
    gw.refreshFails = 'session_missing';
    const seen = [];
    auth.subscribe((s) => seen.push(s));
    assert.deepEqual(await auth.revalidate(), { ok: false, code: 'expired' });
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(seen.at(-1).endReason, 'expired');
  });

  test('nunca guarda la contraseña ni el email en localStorage', async () => {
    const original = globalThis.localStorage;
    const spy = new SpyStorage();
    globalThis.localStorage = spy;
    try {
      const gw = createFakeAuthGateway({ confirmEmail: false });
      const { auth } = service(gw);
      await auth.init();
      await auth.signUp({ fullName: 'A', company: 'B', email: 'x@example.com', password: 'super-secreta-99' });
      await auth.signIn({ email: 'x@example.com', password: 'super-secreta-99' });
      for (const value of spy.map.values()) assert.ok(!value.includes('super-secreta-99'));
    } finally {
      if (original === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = original;
    }
  });
});

describe('AuthService: enlaces de email con GitHub Pages + router por hash', () => {
  test('authRedirectUrl: sin "#", con el destino seguro, bajo /COTIZADORWEB/', () => {
    assert.equal(authRedirectUrl('confirm', '/cotizaciones/nueva', SITE), `${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva`);
    assert.equal(authRedirectUrl('recovery', null, SITE), `${SITE}?auth=recovery`);
    assert.equal(authRedirectUrl('confirm', 'https://malo.example', SITE), `${SITE}?auth=confirm`, 'destinos externos se descartan');
  });

  test('siteUrlFor: sitio público salvo en desarrollo local bajo /COTIZADORWEB/', () => {
    assert.equal(siteUrlFor({ href: 'https://joaquinvedova1.github.io/COTIZADORWEB/#/login' }), SITE);
    assert.equal(siteUrlFor({ href: 'http://localhost:8080/COTIZADORWEB/#/registro' }), 'http://localhost:8080/COTIZADORWEB/');
    assert.equal(siteUrlFor({ href: 'http://127.0.0.1:9000/COTIZADORWEB/' }), 'http://127.0.0.1:9000/COTIZADORWEB/');
    assert.equal(siteUrlFor({ href: 'https://evil.example/COTIZADORWEB/' }), SITE, 'otro origen nunca es la base de los enlaces');
    assert.equal(siteUrlFor({ href: 'http://localhost:8080/otra-cosa/' }), SITE);
    assert.equal(siteUrlFor(undefined), SITE);
  });

  test('siteUrlFor sin staging público (HD-02): una ruta /preview/ ya no tiene enlaces propios', () => {
    assert.equal(siteUrlFor({ href: `${SITE}preview/#/registro` }), SITE);
    assert.equal(siteUrlFor({ href: 'http://localhost:8080/COTIZADORWEB/preview/#/login' }), 'http://localhost:8080/COTIZADORWEB/');
  });

  test('siteUrlFor con dominio propio (HD-01): cada sitio usa sus enlaces (PKCE vuelve al mismo origen); un origen desconocido, el principal', () => {
    const DOMAIN = 'https://app.ejemplo.com.ar/';
    const sites = [DOMAIN, SITE];
    assert.equal(siteUrlFor({ href: `${DOMAIN}#/login` }, sites), DOMAIN);
    assert.equal(siteUrlFor({ href: `${DOMAIN}?auth=recovery&code=x#/` }, sites), DOMAIN);
    assert.equal(siteUrlFor({ href: `${SITE}#/recuperar-contrasena` }, sites), SITE, 'mientras conviven, github.io usa los suyos');
    assert.equal(siteUrlFor({ href: 'https://evil.example/#/login' }, sites), DOMAIN, 'otro origen: el principal');
    assert.equal(siteUrlFor({ href: 'https://app.ejemplo.com.ar.evil.example/' }, sites), DOMAIN, 'un sufijo no engaña');
    assert.equal(siteUrlFor(undefined, sites), DOMAIN);
    assert.equal(authRedirectUrl('recovery', null, siteUrlFor({ href: `${DOMAIN}#/recuperar-contrasena` }, sites)), `${DOMAIN}?auth=recovery`);
  });

  test('movedTarget: mudanza al dominio propio sólo desde un sitio público viejo (nunca local, el nuevo ni otro origen)', () => {
    const DOMAIN = 'https://app.ejemplo.com.ar/';
    const sites = [DOMAIN, SITE];
    assert.equal(movedTarget({ href: `${SITE}#/login` }), null, 'apagado mientras MOVED_TO_SITE_URL es null');
    assert.equal(movedTarget({ href: `${SITE}#/cotizaciones/nueva` }, { movedTo: DOMAIN, sites }), `${DOMAIN}#/cotizaciones/nueva`);
    assert.equal(movedTarget({ href: `${SITE}?auth=recovery&code=viejo#/` }, { movedTo: DOMAIN, sites }), `${DOMAIN}#/`, 'la query (?code=) no viaja');
    assert.equal(movedTarget({ href: `${DOMAIN}#/login` }, { movedTo: DOMAIN, sites }), null, 'en el sitio nuevo: sin bucles');
    assert.equal(movedTarget({ href: 'http://localhost:8080/COTIZADORWEB/#/' }, { movedTo: DOMAIN, sites }), null, 'desarrollo local');
    assert.equal(movedTarget({ href: 'https://evil.example/COTIZADORWEB/' }, { movedTo: DOMAIN, sites }), null, 'un origen desconocido no se redirige');
    assert.equal(movedTarget({ href: `${SITE}#/` }, { movedTo: 'http://app.ejemplo.com.ar/', sites }), null, 'sólo HTTPS');
    assert.equal(movedTarget({ href: `${SITE}#/` }, { movedTo: 'no-es-una-url', sites }), null);
  });

  test('parseAuthRedirect lee la query antes del # y descarta destinos inseguros', () => {
    const p = parseAuthRedirect(`${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva&code=abc#/`);
    assert.deepEqual(p, { code: 'abc', kind: 'confirm', next: '/cotizaciones/nueva', error: null });
    assert.equal(parseAuthRedirect(`${SITE}?code=x&next=//evil.example`).next, null);
    assert.equal(parseAuthRedirect(`${SITE}#/inicio`), null);
    assert.equal(cleanAuthUrl(`${SITE}?auth=confirm&code=abc&next=%2Finicio#/login`), `${SITE}#/login`);
  });

  test('confirmación: canjea el código, limpia la URL (sin códigos en el historial) y devuelve el destino', async () => {
    const gw = createFakeAuthGateway({ confirmEmail: true });
    const { auth } = service(gw);
    await auth.init();
    await auth.signUp({ fullName: 'J', company: 'E', email: 'j@example.com', password: 'clave-segura-1' });
    const second = service(gw, `${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva&code=pkce-123#/`);
    const { redirect } = await second.auth.init();
    assert.deepEqual(gw.exchanged, ['pkce-123']);
    assert.equal(redirect.ok, true);
    assert.equal(redirect.next, '/cotizaciones/nueva');
    assert.equal(second.location.href, `${SITE}#/`);
    assert.equal(second.auth.status, AUTH_STATUS.authenticated);
  });

  test('enlace vencido o abierto en otro navegador: mensaje humano, sin sesión', async () => {
    const gw = createFakeAuthGateway();
    const { auth } = service(gw, `${SITE}?auth=confirm&code=bad#/`);
    const { redirect } = await auth.init();
    assert.equal(redirect.ok, false);
    assert.match(redirect.message, /Ingresá con tu email y contraseña/);
    const err = service(gw, `${SITE}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid#/`);
    const r2 = await err.auth.init();
    assert.match(r2.redirect.message, /El enlace venció o ya se usó/);
    assert.ok(!r2.redirect.message.includes('Email link is invalid'), 'no muestra mensajes internos');
  });

  test('enlaces con ?token_hash= se rechazan (sin PKCE alguien podría abrir SU cuenta en tu navegador)', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'atacante', email: 'x@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    let verified = false;
    gw.verifyEmailToken = async () => {
      verified = true;
      return { ok: true, user: { id: 'atacante', email: 'x@example.com' } };
    };
    const { auth, location } = service(gw, `${SITE}?token_hash=abc123&type=magiclink#/`);
    const { redirect } = await auth.init();
    assert.equal(verified, false, 'nunca se verifica un token_hash');
    assert.deepEqual(gw.exchanged, []);
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(redirect.ok, false);
    assert.ok(redirect.message, 'mensaje humano');
    assert.equal(location.href, `${SITE}#/`, 'el token no queda en la URL');
  });

  test('recuperación: pide el email (respuesta neutra) y el enlace habilita "nueva contraseña"', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'a@example.com', password: 'vieja-clave-1', emailConfirmed: true }] });
    const { auth } = service(gw);
    await auth.init();
    const res = await auth.requestPasswordReset('a@example.com');
    assert.equal(res.message, RESET_REQUESTED_MESSAGE, 'respuesta neutra (HD-03)');
    assert.equal(gw.lastReset.redirectTo, `${SITE}?auth=recovery`);
    const neutral = await auth.requestPasswordReset('noexiste@example.com');
    assert.equal(neutral.message, res.message, 'no revela si el email tiene cuenta');
    const back = service(gw, `${SITE}?auth=recovery&code=rec-1#/`);
    await back.auth.init();
    assert.equal(back.auth.snapshot().recoveryMode, true);
    const upd = await back.auth.updatePassword('nueva-clave-1');
    assert.equal(upd.ok, true);
    assert.equal(back.auth.snapshot().recoveryMode, false);
  });
});

describe('auth-gateway: errores del SDK → códigos propios', () => {
  test('mapea errores conocidos y nunca expone el mensaje interno', () => {
    assert.equal(authErrorCode({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }), 'invalid_credentials');
    assert.equal(authErrorCode({ code: 'user_already_exists' }), 'email_taken');
    assert.equal(authErrorCode({ code: 'email_not_confirmed' }), 'email_not_confirmed');
    assert.equal(authErrorCode({ code: 'weak_password' }), 'weak_password');
    assert.equal(authErrorCode({ code: 'over_email_send_rate_limit', status: 429 }), 'rate_limited');
    assert.equal(authErrorCode({ name: 'AuthRetryableFetchError', status: 0 }), 'network');
    assert.equal(authErrorCode({ code: 'otp_expired' }), 'link_invalid');
    assert.equal(authErrorCode({ code: 'algo_raro', message: 'pg: relation does not exist' }), 'unknown');
  });

  test('cerrar sesión borra la sesión de este navegador aunque el SDK falle (token vencido y sin conexión)', async () => {
    const store = new SpyStorage({ 'rateos.auth': '{"access_token":"x","refresh_token":"y"}', 'rateos.auth-code-verifier': 'v', 'rateos.state': '{}' });
    const client = { auth: { signOut: async () => ({ error: { name: 'AuthRetryableFetchError', status: 0 } }) } };
    const gw = createAuthGateway(client, { clearLocalSession: () => clearLocalAuthSession(store) });
    const res = await gw.signOut();
    assert.equal(res.ok, false);
    assert.equal(store.getItem('rateos.auth'), null, 'sin refresh token guardado');
    assert.equal(store.getItem('rateos.auth-code-verifier'), null);
    assert.equal(store.getItem('rateos.state'), '{}', 'no toca otros datos');
  });

  test('publicUser no expone tokens ni metadatos internos', () => {
    const u = publicUser({ id: 'u1', email: 'a@example.com', user_metadata: { full_name: 'Ana', company: 'X' }, email_confirmed_at: '2026-01-01', app_metadata: { provider: 'email' }, aud: 'authenticated' });
    assert.deepEqual(u, { id: 'u1', email: 'a@example.com', fullName: 'Ana', emailConfirmed: true });
  });
});

describe('AuthService: registro público y, como alternativa, beta por invitación (HD-03)', () => {
  test('lo publicado es la beta por invitación hasta tener SMTP propio (el registro público queda listo, apagado)', () => {
    assert.equal(FEATURES.publicSignup, false);
  });

  test('si se vuelve a la beta por invitación (publicSignup = false), signUp no llama a Supabase y explica cómo entrar', async () => {
    const gw = createFakeAuthGateway({ confirmEmail: true });
    const { auth } = service(gw, `${SITE}#/registro`, { publicSignup: false });
    await auth.init();
    const res = await auth.signUp({ fullName: 'Ana', company: 'Norte', email: 'ana@example.com', password: 'clave-segura-1' });
    assert.equal(res.ok, false);
    assert.equal(res.code, AUTH_ERRORS.signupClosed);
    assert.match(res.message, /no se pueden crear cuentas nuevas/);
    assert.match(res.message, /¿Olvidaste tu contraseña\?/, 'dice cómo es el primer ingreso');
    assert.equal(gw.lastSignUp, undefined, 'no se llamó al registro de Supabase');
    assert.equal(auth.status, AUTH_STATUS.anonymous);
  });

  test('con el registro cerrado, una persona dada de alta ingresa y recupera su contraseña igual', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'inv-1', email: 'invitada@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    const { auth } = service(gw, `${SITE}#/login`, { publicSignup: false });
    await auth.init();
    const reset = await auth.requestPasswordReset('invitada@example.com');
    assert.equal(reset.ok, true);
    assert.equal(gw.lastReset.redirectTo, `${SITE}?auth=recovery`, 'recuperación PKCE de siempre');
    const res = await auth.signIn({ email: 'invitada@example.com', password: 'clave-segura-1' });
    assert.equal(res.ok, true);
    assert.equal(auth.status, AUTH_STATUS.authenticated);
  });

  test('Supabase con el registro apagado (signup_disabled, email_provider_disabled) → mensaje de invitación, nunca el error interno', () => {
    for (const code of ['signup_disabled', 'email_provider_disabled']) {
      assert.equal(authErrorCode({ code, status: 422, message: 'Signups not allowed for this instance' }), AUTH_ERRORS.signupClosed, code);
    }
    assert.doesNotMatch(messageFor(AUTH_ERRORS.signupClosed), /Signups|instance|422/);
  });

  test('SMTP por defecto de Supabase (email_address_not_authorized): sin sesión, respuesta neutra; con la sesión y el propio email, se avisa', async () => {
    assert.equal(authErrorCode({ code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' }), AUTH_ERRORS.emailNotAuthorized);
    const gw = createFakeAuthGateway({ users: [{ id: 'inv-1', email: 'invitada@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    let failWith = AUTH_ERRORS.emailNotAuthorized;
    gw.requestPasswordReset = async () => ({ ok: false, code: failWith });
    const entries = [];
    const remove = addLogSink((e) => entries.push(e));
    try {
      const { auth } = service(gw, `${SITE}#/recuperar-contrasena`, { publicSignup: false });
      await auth.init();
      const neutral = await auth.requestPasswordReset('invitada@example.com');
      assert.equal(neutral.ok, true, 'fuera de sesión no revela que la cuenta existe');
      assert.equal(neutral.message, RESET_REQUESTED_MESSAGE);
      assert.ok(entries.some((e) => e.level === 'warn' && /SMTP propio/.test(e.message)), 'queda un aviso técnico para quien diagnostica');
      assert.ok(entries.every((e) => !/invitada@example\.com/.test(`${e.message} ${JSON.stringify(e.context ?? null)}`)), 'el aviso no lleva el email');

      await auth.signIn({ email: 'invitada@example.com', password: 'clave-segura-1' });
      assert.equal(auth.status, AUTH_STATUS.authenticated);
      const own = await auth.requestPasswordReset('Invitada@Example.com ');
      assert.equal(own.ok, false, '"Cambiar contraseña" con la sesión iniciada no dice que lo envió');
      assert.equal(own.message, messageFor(AUTH_ERRORS.emailNotAuthorized));
      assert.match(own.message, /no tiene habilitado el envío de correos/);
      assert.doesNotMatch(own.message, /SMTP|Supabase|authorized/);
      failWith = AUTH_ERRORS.unknown;
      const broken = await auth.requestPasswordReset('invitada@example.com');
      assert.equal(broken.ok, false, 'un SMTP propio mal configurado tampoco se tapa con la sesión iniciada');
      assert.equal(broken.message, messageFor(AUTH_ERRORS.unknown));
      const other = await auth.requestPasswordReset('otra@example.com');
      assert.equal(other.ok, true, 'otro email, aun con la sesión iniciada: respuesta neutra');
    } finally {
      remove();
    }
  });
});
