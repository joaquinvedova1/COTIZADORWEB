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
  parseAuthRedirect,
  siteUrlFor,
  validateSignUp,
} from '../../js/services/auth-service.js';
import { authErrorCode, createAuthGateway, publicUser } from '../../js/data/auth-gateway.js';
import { clearLocalAuthSession } from '../../js/data/supabase-client.js';
import { createFakeAuthGateway, SpyStorage } from '../helpers/fake-supabase.js';

const SITE = 'https://joaquinvedova1.github.io/COTIZADORWEB/';

function service(gateway, href = `${SITE}#/`) {
  const location = { href };
  const history = {
    replaced: [],
    replaceState(_s, _t, url) {
      this.replaced.push(url);
      location.href = url;
    },
  };
  return { auth: createAuthService({ gateway, siteUrl: SITE, location, history }), location, history };
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
    assert.match(res.message, /Revisá tu email/);
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

  test('email ya registrado y credenciales inválidas: mensajes humanos', async () => {
    const gw = createFakeAuthGateway({ users: [{ id: 'u1', email: 'ya@example.com', password: 'clave-segura-1', emailConfirmed: true }] });
    const { auth } = service(gw);
    await auth.init();
    const taken = await auth.signUp({ fullName: 'X', company: 'Y', email: 'ya@example.com', password: 'otra-clave-123' });
    assert.equal(taken.message, 'Ese email ya está registrado. Ingresá o recuperá tu contraseña.');
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
    assert.match(res.message, /te enviamos un enlace para recuperar tu contraseña/);
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
