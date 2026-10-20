/**
 * HD-03 (PLAN-2026-018): alta por invitación y correos de Auth — pruebas
 * SIMULADAS (puerta de Auth falsa, sin red ni correo real). Las pruebas con
 * envío REAL son manuales y están en docs/BETA_PERIMETER.md §2.4.
 *
 * - "¿Olvidaste tu contraseña?" sin sesión: la misma respuesta haya o no cuenta,
 *   aunque el correo no se pueda enviar, y dice qué hacer si no llega nada.
 * - Código del correo de recuperación ({{ .Token }}): sirve en cualquier navegador.
 * - Enlaces con tokens en el # ("Send invitation"): nunca se usan y se borran.
 * - Enlace de recuperación abierto en otro navegador: ofrece el código.
 * - Ningún email ni código en los logs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AUTH_STATUS,
  CODE_INVALID_MESSAGE,
  CONFIRMATION_RESENT_MESSAGE, CONFIRMATION_RESEND_FAILED_MESSAGE,
  INVITE_LINK_MESSAGE,
  RECOVERY_LINK_INVALID_MESSAGE,
  RECOVER_REQUEST_SUBTITLE,
  RESET_COOLDOWN_SECONDS,
  RESET_REQUESTED_MESSAGE,
  RESET_SENT_OWN_MESSAGE,
  SIGNUP_MAIL_FAILED_MESSAGE,
  SIGNUP_REQUESTED_MESSAGE,
  authRedirectUrl,
  cleanAuthFragment,
  createAuthService,
  messageFor,
  parseAuthFragment,
} from '../../js/services/auth-service.js';
import { AUTH_ERRORS, createAuthGateway } from '../../js/data/auth-gateway.js';
import { addLogSink } from '../../js/core/logger.js';
import { FEATURES } from '../../js/config.js';
import { createFakeAuthGateway } from '../helpers/fake-supabase.js';

const SITE = 'https://joaquinvedova1.github.io/COTIZADORWEB/';
const INVITED = { id: 'inv-1', email: 'invitada@example.com', password: 'clave-larga-al-azar-1', emailConfirmed: true };

function service(gateway, href = `${SITE}#/recuperar-contrasena`, { publicSignup = FEATURES.publicSignup } = {}) {
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

/** Captura los logs de la prueba (nunca deben llevar el email ni el código). */
function captureLogs() {
  const entries = [];
  const remove = addLogSink((e) => entries.push(e));
  return { entries, remove, text: () => entries.map((e) => `${e.message} ${JSON.stringify(e.context ?? null)}`).join('\n') };
}

describe('HD-03: "¿Olvidaste tu contraseña?" sin sesión', () => {
  test('misma respuesta con cuenta, sin cuenta, SMTP por defecto o SMTP roto: no revela quién usa RATEOS', async () => {
    const outcomes = [];
    for (const failure of [null, 'none', AUTH_ERRORS.emailNotAuthorized, AUTH_ERRORS.unknown]) {
      const gw = createFakeAuthGateway({ users: [INVITED] });
      if (failure && failure !== 'none') gw.requestPasswordReset = async () => ({ ok: false, code: failure });
      const { auth } = service(gw);
      await auth.init();
      const email = failure === 'none' ? 'sin-cuenta@example.com' : INVITED.email;
      const res = await auth.requestPasswordReset(email);
      outcomes.push(res);
    }
    for (const res of outcomes) {
      assert.equal(res.ok, true);
      assert.equal(res.message, RESET_REQUESTED_MESSAGE);
      assert.equal(res.cooldownSeconds, RESET_COOLDOWN_SECONDS);
      assert.deepEqual(Object.keys(res).sort(), ['cooldownSeconds', 'message', 'ok']);
    }
  });

  test('la respuesta no afirma que se envió un correo y dice qué hacer si no llega (sin alta previa no sale nada)', () => {
    assert.doesNotMatch(RESET_REQUESTED_MESSAGE, /te enviamos/i);
    assert.match(RESET_REQUESTED_MESSAGE, /Si ese email tiene una cuenta en RATEOS/);
    assert.match(RESET_REQUESTED_MESSAGE, /spam/);
    assert.match(RESET_REQUESTED_MESSAGE, /puede que ese email todavía no tenga cuenta: creala en «Crear cuenta»/);
    assert.equal(RESET_COOLDOWN_SECONDS, 60);
  });

  test('antes de pedir nada, la pantalla no promete un correo y dice que sólo llega si hay cuenta', () => {
    assert.doesNotMatch(RECOVER_REQUEST_SUBTITLE, /te mandamos|te enviamos|te llega/i);
    assert.match(RECOVER_REQUEST_SUBTITLE, /Sólo llega si ese email tiene una cuenta en RATEOS/);
  });

  test('sin conexión o con muchos intentos seguidos, se dice (no depende de si la cuenta existe)', async () => {
    for (const code of [AUTH_ERRORS.network, AUTH_ERRORS.rateLimited]) {
      const gw = createFakeAuthGateway({ users: [INVITED] });
      gw.requestPasswordReset = async () => ({ ok: false, code });
      const { auth } = service(gw);
      await auth.init();
      const res = await auth.requestPasswordReset(INVITED.email);
      assert.equal(res.ok, false, code);
      assert.equal(res.message, messageFor(code));
    }
  });

  test('el aviso técnico del SMTP por defecto no lleva el email', async () => {
    const logs = captureLogs();
    try {
      const gw = createFakeAuthGateway({ users: [INVITED] });
      gw.requestPasswordReset = async () => ({ ok: false, code: AUTH_ERRORS.emailNotAuthorized });
      const { auth } = service(gw);
      await auth.init();
      await auth.requestPasswordReset(INVITED.email);
      assert.ok(logs.entries.some((e) => /SMTP propio/.test(e.message)));
      assert.doesNotMatch(logs.text(), /invitada@example\.com/);
    } finally {
      logs.remove();
    }
  });

  test('"Cambiar contraseña" con la sesión iniciada: dice que se envió (el propio email) o que no se pudo', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    const { auth } = service(gw, `${SITE}#/configuracion`);
    await auth.init();
    await auth.signIn({ email: INVITED.email, password: INVITED.password });
    const ok = await auth.requestPasswordReset(INVITED.email);
    assert.equal(ok.ok, true);
    assert.equal(ok.message, RESET_SENT_OWN_MESSAGE);
    gw.requestPasswordReset = async () => ({ ok: false, code: AUTH_ERRORS.emailNotAuthorized });
    const failed = await auth.requestPasswordReset(INVITED.email);
    assert.equal(failed.ok, false);
    assert.match(failed.message, /No pudimos enviarte el email/);
  });
});

describe('HD-03: código del correo de recuperación (cualquier navegador)', () => {
  test('valida antes de la red: email y de 6 a 10 dígitos', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    const { auth } = service(gw);
    await auth.init();
    for (const [email, code, field] of [['no-es-email', '123456', 'email'], [INVITED.email, '12345', 'code'], [INVITED.email, 'abcdef', 'code'], [INVITED.email, '12345678901', 'code']]) {
      const res = await auth.verifyRecoveryCode(email, code);
      assert.equal(res.ok, false);
      assert.ok(res.errors[field], `${email} / ${code}`);
    }
    assert.equal(gw.lastCode, undefined, 'no se llamó a Supabase');
  });

  test('el código correcto abre la recuperación y permite elegir la contraseña; sirve una sola vez', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    const pidio = service(gw);
    await pidio.auth.init();
    await pidio.auth.requestPasswordReset(INVITED.email);
    // Otro navegador (sin el code_verifier del enlace PKCE): con el código alcanza.
    const otro = service(gw, `${SITE}#/recuperar-contrasena`);
    await otro.auth.init();
    const res = await otro.auth.verifyRecoveryCode(` ${INVITED.email} `, '123 456');
    assert.equal(res.ok, true);
    assert.equal(otro.auth.status, AUTH_STATUS.authenticated);
    assert.equal(otro.auth.snapshot().recoveryMode, true);
    assert.equal(otro.auth.snapshot().user.email, INVITED.email, 'la pantalla puede mostrar de qué cuenta es');
    const upd = await otro.auth.updatePassword('mi-clave-nueva-1');
    assert.equal(upd.ok, true);
    assert.equal(otro.auth.snapshot().recoveryMode, false);
    const tercero = service(gw);
    await tercero.auth.init();
    const again = await tercero.auth.verifyRecoveryCode(INVITED.email, '123456');
    assert.equal(again.ok, false, 'un código usado no vuelve a servir');
  });

  test('código equivocado o email sin cuenta: el mismo mensaje y sin sesión', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    const { auth } = service(gw);
    await auth.init();
    await auth.requestPasswordReset(INVITED.email);
    const wrong = await auth.verifyRecoveryCode(INVITED.email, '654321');
    const nobody = await auth.verifyRecoveryCode('sin-cuenta@example.com', '123456');
    for (const res of [wrong, nobody]) {
      assert.equal(res.ok, false);
      assert.equal(res.message, CODE_INVALID_MESSAGE);
      assert.equal(res.errors.code, CODE_INVALID_MESSAGE);
    }
    assert.equal(auth.status, AUTH_STATUS.anonymous);
  });

  test('ni el email ni el código quedan en los logs', async () => {
    const logs = captureLogs();
    try {
      const gw = createFakeAuthGateway({ users: [INVITED] });
      const { auth } = service(gw);
      await auth.init();
      await auth.requestPasswordReset(INVITED.email);
      await auth.verifyRecoveryCode(INVITED.email, '999999');
      await auth.verifyRecoveryCode(INVITED.email, '123456');
      assert.doesNotMatch(logs.text(), /invitada@example\.com|123456|999999/);
    } finally {
      logs.remove();
    }
  });

  test('puerta real: usa verifyOtp con type "recovery" y traduce el error sin mostrar el mensaje interno', async () => {
    const calls = [];
    const client = {
      auth: {
        async verifyOtp(params) {
          calls.push(params);
          if (params.token === '000000') return { data: { user: null, session: null }, error: { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' } };
          return { data: { user: { id: 'u1', email: params.email, user_metadata: {} }, session: { access_token: 'token-de-prueba', user: { id: 'u1', email: params.email } } }, error: null };
        },
      },
    };
    const gateway = createAuthGateway(client);
    const ok = await gateway.verifyRecoveryCode('a@example.com', '123456');
    assert.deepEqual(calls[0], { email: 'a@example.com', token: '123456', type: 'recovery' });
    assert.equal(ok.ok, true);
    assert.equal(ok.user.id, 'u1');
    assert.equal(ok.user.access_token, undefined, 'sin tokens');
    const bad = await gateway.verifyRecoveryCode('a@example.com', '000000');
    assert.deepEqual(bad, { ok: false, code: AUTH_ERRORS.linkInvalid, user: null });
  });

  test('puerta real: una respuesta sin error pero sin sesión o sin usuario válido NO cuenta como verificada', async () => {
    const user = { id: 'u1', email: 'a@example.com', user_metadata: {} };
    const incompletas = [
      { user: null, session: null },
      { user, session: null },
      { user, session: { user } },
      { user: null, session: { access_token: 'token-de-prueba', user: { email: 'a@example.com' } } },
      null,
    ];
    for (const data of incompletas) {
      const gateway = createAuthGateway({ auth: { verifyOtp: async () => ({ data, error: null }) } });
      const res = await gateway.verifyRecoveryCode('a@example.com', '123456');
      assert.deepEqual(res, { ok: false, code: AUTH_ERRORS.unknown, user: null }, JSON.stringify(data));
    }
  });

  test('servicio: si la puerta dice ok sin usuario, no queda autenticado ni en modo recuperación', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    gw.verifyRecoveryCode = async () => ({ ok: true, code: null, user: null });
    const { auth } = service(gw);
    await auth.init();
    const res = await auth.verifyRecoveryCode(INVITED.email, '123456');
    assert.equal(res.ok, false);
    assert.equal(res.message, messageFor(AUTH_ERRORS.unknown));
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(auth.snapshot().recoveryMode, false);
  });
});

describe('HD-03: enlaces de los correos', () => {
  test('el enlace de recuperación vuelve al sitio publicado (Redirect URLs) con query antes del #', () => {
    assert.equal(authRedirectUrl('recovery', null, SITE), `${SITE}?auth=recovery`);
    assert.ok(authRedirectUrl('recovery', null, SITE).startsWith(SITE), 'cae dentro de https://joaquinvedova1.github.io/COTIZADORWEB/**');
    assert.ok(!authRedirectUrl('recovery', null, SITE).includes('#'));
  });

  test('"Send invitation" (tokens en el #): no se usan, se borran de la URL y se explica qué hacer', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    let used = false;
    gw.setSession = async () => {
      used = true;
      return { ok: true };
    };
    const href = `${SITE}#access_token=eyJhbGciOiJIUzI1NiJ9.x.y&expires_in=3600&refresh_token=rt-secreto&token_type=bearer&type=invite`;
    const { auth, location } = service(gw, href);
    const { redirect } = await auth.init();
    assert.equal(used, false);
    assert.deepEqual(gw.exchanged, []);
    assert.equal(auth.status, AUTH_STATUS.anonymous);
    assert.equal(redirect.ok, false);
    assert.equal(redirect.message, INVITE_LINK_MESSAGE);
    assert.equal(location.href, SITE);
    assert.doesNotMatch(location.href, /access_token|refresh_token|rt-secreto/);
  });

  test('error en el # de un enlace de recuperación vencido: mensaje humano que ofrece el código, sin el texto interno', async () => {
    const gw = createFakeAuthGateway();
    const { auth, location } = service(gw, `${SITE}?auth=recovery#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    const { redirect } = await auth.init();
    assert.equal(redirect.message, RECOVERY_LINK_INVALID_MESSAGE);
    assert.match(redirect.message, /código/);
    assert.doesNotMatch(redirect.message, /Email link|invalid|expired/);
    assert.equal(location.href, SITE);
  });

  test('enlace de recuperación abierto en otro navegador (sin code_verifier): ofrece el código', async () => {
    const gw = createFakeAuthGateway({ users: [INVITED] });
    const { auth } = service(gw, `${SITE}?auth=recovery&code=bad#/`);
    const { redirect } = await auth.init();
    assert.equal(redirect.ok, false);
    assert.equal(redirect.message, RECOVERY_LINK_INVALID_MESSAGE);
    assert.equal(auth.snapshot().recoveryMode, false);
  });

  test('las rutas del router nunca se confunden con un enlace de Auth', () => {
    for (const hash of ['#/', '#/inicio', '#/recuperar-contrasena', '#/cotizaciones/abc/result', '#/login?next=%2Finicio', '']) {
      assert.equal(parseAuthFragment(`${SITE}${hash}`), null, hash);
    }
    assert.deepEqual(parseAuthFragment(`${SITE}#access_token=a&type=invite`), { kind: 'implicit', error: null });
    assert.deepEqual(parseAuthFragment(`${SITE}#error=access_denied&error_code=otp_expired`), { kind: 'error', error: 'otp_expired' });
    assert.equal(cleanAuthFragment(`${SITE}?auth=recovery&code=x#access_token=a`), SITE);
  });
});

describe('HD-03: plantillas de correo (supabase/templates/)', () => {
  const tpl = (name) => readFileSync(new URL(`../../supabase/templates/${name}`, import.meta.url), 'utf8');
  const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  test('sin imágenes, scripts ni enlaces a terceros (nada de seguimiento)', () => {
    for (const name of ['recovery.html', 'recovery-solo-codigo.html', 'invite.html', 'confirmation.html']) {
      const html = tpl(name);
      assert.doesNotMatch(html, /<img|<script|<iframe|https?:\/\//i, name);
      for (const href of hrefs(html)) assert.match(href, /^\{\{ \.(ConfirmationURL|SiteURL) \}\}/, `${name}: ${href}`);
    }
  });

  test('recuperación: enlace PKCE y código, y avisa que son la misma credencial', () => {
    const html = tpl('recovery.html');
    assert.ok(html.includes('{{ .ConfirmationURL }}') && html.includes('{{ .Token }}'));
    assert.match(html, /No toques el enlace/);
    assert.doesNotMatch(html, /TokenHash/, 'nunca un enlace con token_hash (no es PKCE)');
  });

  test('variante sólo código: ningún enlace que verifique nada (un escáner no puede usar el correo)', () => {
    const html = tpl('recovery-solo-codigo.html');
    assert.ok(html.includes('{{ .Token }}'));
    assert.doesNotMatch(html, /ConfirmationURL|TokenHash|token_hash|\/verify/);
    assert.deepEqual(hrefs(html), ['{{ .SiteURL }}#/recuperar-contrasena']);
  });

  test('confirmación del registro: enlace PKCE ({{ .ConfirmationURL }}), nunca token_hash, y explica el otro dispositivo', () => {
    const html = tpl('confirmation.html');
    assert.deepEqual(hrefs(html), ['{{ .ConfirmationURL }}']);
    assert.doesNotMatch(html, /TokenHash/);
    assert.match(html, /tu email queda confirmado igual/);
  });

  test('invitación: no usa el enlace de "Send invitation" (implícito, la app lo rechaza)', () => {
    const html = tpl('invite.html');
    assert.doesNotMatch(html, /ConfirmationURL|TokenHash/);
    assert.deepEqual(hrefs(html), ['{{ .SiteURL }}#/recuperar-contrasena']);
  });
});

describe('HD-03: registro público con confirmación de email (decisión del dueño, 2026-10-20)', () => {
  const NEW = { fullName: 'Ana Pérez', company: 'Grúas del Sur', email: 'ana@example.com', password: 'clave-segura-1' };
  const CONFIRMED = { id: 'u-ok', email: 'ya@example.com', password: 'clave-larga-1', emailConfirmed: true };
  const PENDING = { id: 'u-nc', email: 'pendiente@example.com', password: 'clave-larga-2', emailConfirmed: false };

  test('lo publicado ofrece el registro (sin invitación) y exige confirmar el email', async () => {
    assert.equal(FEATURES.publicSignup, true);
    const gw = createFakeAuthGateway({ confirmEmail: true });
    const { auth } = service(gw, `${SITE}#/registro`);
    await auth.init();
    const res = await auth.signUp(NEW);
    assert.equal(res.ok, true);
    assert.equal(res.needsConfirmation, true);
    assert.equal(auth.status, AUTH_STATUS.anonymous, 'sin sesión hasta confirmar');
  });

  test('la misma respuesta para un email nuevo, uno ya registrado y uno sin confirmar: no revela quién usa RATEOS', async () => {
    const outcomes = [];
    for (const email of [NEW.email, CONFIRMED.email, PENDING.email]) {
      const gw = createFakeAuthGateway({ users: [CONFIRMED, PENDING] });
      const { auth } = service(gw, `${SITE}#/registro`);
      await auth.init();
      outcomes.push(await auth.signUp({ ...NEW, email }));
    }
    for (const res of outcomes) {
      assert.deepEqual(res, { ok: true, needsConfirmation: true, message: SIGNUP_REQUESTED_MESSAGE, cooldownSeconds: RESET_COOLDOWN_SECONDS });
    }
    assert.doesNotMatch(SIGNUP_REQUESTED_MESSAGE, /ya está registrado|te enviamos/i);
    assert.match(SIGNUP_REQUESTED_MESSAGE, /Si ya tenías cuenta con ese email, no te llega nada/);
  });

  test('puerta real: el usuario "de mentira" de Supabase (email ya registrado) se responde igual que un registro nuevo', async () => {
    const calls = [];
    const client = {
      auth: {
        async signUp(params) {
          calls.push(params);
          if (params.email === 'ya@example.com') return { data: { user: { id: 'x', email: params.email, identities: [] }, session: null }, error: null };
          return { data: { user: { id: 'n1', email: params.email, identities: [{ id: 'i1' }] }, session: null }, error: null };
        },
      },
    };
    const gateway = createAuthGateway(client);
    const results = [];
    for (const email of ['ya@example.com', 'nueva@example.com']) {
      const { auth } = service(gateway, `${SITE}#/registro`);
      results.push(await auth.signUp({ ...NEW, email }));
    }
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(calls[1].options, { emailRedirectTo: `${SITE}?auth=confirm`, data: { full_name: 'Ana Pérez', company: 'Grúas del Sur' } }, 'enlace PKCE de vuelta al sitio publicado');
    assert.equal(calls[1].password, NEW.password, 'la contraseña sólo pasa al SDK');
  });

  test('el enlace de confirmación vuelve al sitio con ?auth=confirm y sólo conserva un destino interno', async () => {
    const gw = createFakeAuthGateway();
    const { auth } = service(gw, `${SITE}#/registro`);
    await auth.signUp({ ...NEW, next: '/cotizaciones/nueva' });
    assert.equal(gw.lastSignUp.redirectTo, `${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva`);
    await auth.signUp({ ...NEW, email: 'otra@example.com', next: 'https://evil.example/' });
    assert.equal(gw.lastSignUp.redirectTo, `${SITE}?auth=confirm`, 'un destino externo nunca viaja en el enlace');
  });

  test('si el correo de confirmación no sale (SMTP por defecto), se dice (la cuenta no se creó) y el aviso técnico no lleva el email', async () => {
    const logs = captureLogs();
    try {
      const gw = createFakeAuthGateway();
      gw.signUp = async () => ({ ok: false, code: AUTH_ERRORS.emailNotAuthorized });
      const { auth } = service(gw, `${SITE}#/registro`);
      const res = await auth.signUp(NEW);
      assert.equal(res.ok, false);
      assert.equal(res.message, SIGNUP_MAIL_FAILED_MESSAGE);
      assert.ok(logs.entries.some((e) => e.level === 'warn' && /SMTP propio/.test(e.message)));
      assert.doesNotMatch(logs.text(), /ana@example\.com|clave-segura-1/);
    } finally {
      logs.remove();
    }
  });

  test('red, límite de envíos, contraseña débil o registro cerrado en el servidor: mensaje humano, sin detalles internos', async () => {
    for (const code of [AUTH_ERRORS.network, AUTH_ERRORS.rateLimited, AUTH_ERRORS.weakPassword, AUTH_ERRORS.signupClosed, AUTH_ERRORS.unknown]) {
      const gw = createFakeAuthGateway();
      gw.signUp = async () => ({ ok: false, code });
      const { auth } = service(gw, `${SITE}#/registro`);
      const res = await auth.signUp(NEW);
      assert.equal(res.ok, false, code);
      assert.equal(res.message, messageFor(code), code);
    }
  });

  test('valida antes de la red: nombre, empresa, email y contraseña de 8 o más', async () => {
    const gw = createFakeAuthGateway();
    const { auth } = service(gw, `${SITE}#/registro`);
    const res = await auth.signUp({ fullName: ' ', company: '', email: 'no-es-email', password: '1234567' });
    assert.deepEqual(Object.keys(res.errors).sort(), ['company', 'email', 'fullName', 'password']);
    assert.equal(gw.lastSignUp, undefined);
  });

  test('reenviar la confirmación con el envío funcionando: la misma respuesta haya o no cuenta sin confirmar', async () => {
    const outcomes = [];
    for (const email of [PENDING.email, CONFIRMED.email, 'nadie@example.com']) {
      const gw = createFakeAuthGateway({ users: [CONFIRMED, PENDING] });
      const { auth } = service(gw, `${SITE}#/login`);
      outcomes.push(await auth.resendConfirmation(email, '/cotizaciones/nueva'));
      assert.equal(gw.lastResend.redirectTo, `${SITE}?auth=confirm&next=%2Fcotizaciones%2Fnueva`);
    }
    for (const res of outcomes) assert.deepEqual(res, { ok: true, message: CONFIRMATION_RESENT_MESSAGE, cooldownSeconds: RESET_COOLDOWN_SECONDS });
  });

  test('HD-03 R3: si el proveedor rechaza el reenvío, nunca dice "Pedido enviado": dice que no salió, con el mismo mensaje para cualquier falla', async () => {
    const failures = [AUTH_ERRORS.emailNotAuthorized, AUTH_ERRORS.unknown, 'otro_error_del_proveedor'];
    const outcomes = [];
    for (const failure of failures) {
      const gw = createFakeAuthGateway({ users: [CONFIRMED, PENDING] });
      gw.resendSignupConfirmation = async () => ({ ok: false, code: failure });
      const { auth } = service(gw, `${SITE}#/login`);
      outcomes.push(await auth.resendConfirmation(PENDING.email));
    }
    for (const res of outcomes) {
      assert.deepEqual(res, { ok: false, errors: {}, message: CONFIRMATION_RESEND_FAILED_MESSAGE });
      assert.notEqual(res.message, CONFIRMATION_RESENT_MESSAGE);
      assert.doesNotMatch(res.message, /Pedido enviado|te llega|te enviamos/i);
      assert.doesNotMatch(res.message, /pendiente@example\.com/);
    }
    assert.match(CONFIRMATION_RESEND_FAILED_MESSAGE, /No pudimos enviar el correo de confirmación/);
  });

  test('HD-03 R3: con el envío roto, sólo una cuenta sin confirmar recibe el error; sin cuenta y confirmada siguen respondiendo igual entre sí (excepción documentada)', async () => {
    const run = async (email) => {
      const gw = createFakeAuthGateway({ users: [CONFIRMED, PENDING], mailFailure: AUTH_ERRORS.emailNotAuthorized });
      const { auth } = service(gw, `${SITE}#/login`);
      return { res: await auth.resendConfirmation(email), sent: gw.lastResend.sent };
    };
    const nueva = await run('nadie@example.com');
    const confirmada = await run(CONFIRMED.email);
    const pendiente = await run(PENDING.email);
    assert.deepEqual(nueva.res, confirmada.res, 'sin cuenta y confirmada: la misma respuesta');
    assert.equal(nueva.res.ok, true);
    assert.equal(pendiente.res.ok, false);
    assert.equal(pendiente.res.message, CONFIRMATION_RESEND_FAILED_MESSAGE);
    assert.equal(pendiente.sent, false, 'no salió ningún correo');
  });

  test('HD-03 R3: el aviso técnico del reenvío fallido no lleva el email', async () => {
    const logs = captureLogs();
    try {
      for (const failure of [AUTH_ERRORS.emailNotAuthorized, AUTH_ERRORS.unknown]) {
        const gw = createFakeAuthGateway({ users: [PENDING], mailFailure: failure });
        const { auth } = service(gw, `${SITE}#/login`);
        await auth.resendConfirmation(PENDING.email);
      }
      assert.ok(logs.entries.some((e) => /SMTP propio/.test(e.message)));
      assert.ok(logs.entries.some((e) => /proveedor de correo/.test(e.message)));
      assert.doesNotMatch(logs.text(), /pendiente@example\.com/);
    } finally {
      logs.remove();
    }
  });

  test('reenviar la confirmación: la red y el límite de envíos se informan; un email inválido no llama a Supabase', async () => {
    for (const code of [AUTH_ERRORS.network, AUTH_ERRORS.rateLimited]) {
      const gw = createFakeAuthGateway({ users: [PENDING] });
      gw.resendSignupConfirmation = async () => ({ ok: false, code });
      const { auth } = service(gw, `${SITE}#/login`);
      const res = await auth.resendConfirmation(PENDING.email);
      assert.equal(res.ok, false);
      assert.equal(res.message, messageFor(code));
    }
    const gw = createFakeAuthGateway();
    const { auth } = service(gw, `${SITE}#/login`);
    const bad = await auth.resendConfirmation('no-es-email');
    assert.ok(bad.errors.email);
    assert.equal(gw.lastResend, undefined, 'no se llamó a Supabase');
  });

  test('puerta real: reenvía con resend type "signup" y el enlace PKCE de vuelta', async () => {
    const calls = [];
    const gateway = createAuthGateway({ auth: { resend: async (p) => (calls.push(p), { data: {}, error: null }) } });
    const res = await gateway.resendSignupConfirmation('a@example.com', `${SITE}?auth=confirm`);
    assert.deepEqual(res, { ok: true, code: null });
    assert.deepEqual(calls[0], { type: 'signup', email: 'a@example.com', options: { emailRedirectTo: `${SITE}?auth=confirm` } });
  });

  test('ingreso sin confirmar: lo explica y marca la cuenta para ofrecer el reenvío (sólo con la contraseña correcta)', async () => {
    const gw = createFakeAuthGateway({ users: [PENDING] });
    const { auth } = service(gw, `${SITE}#/login`);
    await auth.init();
    const res = await auth.signIn({ email: PENDING.email, password: PENDING.password });
    assert.equal(res.ok, false);
    assert.equal(res.unconfirmed, true);
    assert.match(res.message, /Todavía no confirmaste tu email/);
    const wrong = await auth.signIn({ email: PENDING.email, password: 'otra-clave-9' });
    assert.equal(wrong.unconfirmed, false, 'con la contraseña equivocada no se revela nada');
    assert.equal(auth.status, AUTH_STATUS.anonymous);
  });

  test('confirmación: el enlace PKCE canjea el código, abre la sesión y limpia la URL', async () => {
    const gw = createFakeAuthGateway({ users: [PENDING] });
    const { auth, location } = service(gw, `${SITE}?code=codigo-pkce&auth=confirm#/`);
    const redirect = await auth.handleRedirect();
    assert.equal(redirect.ok, true);
    assert.equal(redirect.kind, 'confirm');
    assert.deepEqual(gw.exchanged, ['codigo-pkce']);
    assert.doesNotMatch(location.href, /code=/);
  });

  test('confirmación abierta en otro navegador: el email igual quedó confirmado y se explica que hay que ingresar', async () => {
    const gw = createFakeAuthGateway({ users: [PENDING] });
    const { auth } = service(gw, `${SITE}?code=bad&auth=confirm#/`);
    const redirect = await auth.handleRedirect();
    assert.equal(redirect.ok, false);
    assert.match(redirect.message, /Tu email ya puede estar confirmado\. Ingresá con tu email y contraseña/);
  });
});
