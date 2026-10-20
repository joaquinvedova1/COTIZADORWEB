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

import {
  AUTH_STATUS,
  CODE_INVALID_MESSAGE,
  INVITE_LINK_MESSAGE,
  RECOVERY_LINK_INVALID_MESSAGE,
  RESET_COOLDOWN_SECONDS,
  RESET_REQUESTED_MESSAGE,
  RESET_SENT_OWN_MESSAGE,
  authRedirectUrl,
  cleanAuthFragment,
  createAuthService,
  messageFor,
  parseAuthFragment,
} from '../../js/services/auth-service.js';
import { AUTH_ERRORS, createAuthGateway } from '../../js/data/auth-gateway.js';
import { addLogSink } from '../../js/core/logger.js';
import { createFakeAuthGateway } from '../helpers/fake-supabase.js';

const SITE = 'https://joaquinvedova1.github.io/COTIZADORWEB/';
const INVITED = { id: 'inv-1', email: 'invitada@example.com', password: 'clave-larga-al-azar-1', emailConfirmed: true };

function service(gateway, href = `${SITE}#/recuperar-contrasena`) {
  const location = { href };
  const history = {
    replaced: [],
    replaceState(_s, _t, url) {
      this.replaced.push(url);
      location.href = url;
    },
  };
  return { auth: createAuthService({ gateway, siteUrl: SITE, location, history, publicSignup: false }), location, history };
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

  test('la respuesta no afirma que se envió un correo y dice qué hacer si no llega (el caso del amigo: sin alta previa no sale nada)', () => {
    assert.doesNotMatch(RESET_REQUESTED_MESSAGE, /te enviamos/i);
    assert.match(RESET_REQUESTED_MESSAGE, /Si ese email tiene acceso a RATEOS/);
    assert.match(RESET_REQUESTED_MESSAGE, /spam/);
    assert.match(RESET_REQUESTED_MESSAGE, /avisale a quien te invitó: puede que tu acceso todavía no esté creado/);
    assert.equal(RESET_COOLDOWN_SECONDS, 60);
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
          return { data: { user: { id: 'u1', email: params.email, user_metadata: {} }, session: { user: { id: 'u1', email: params.email } } }, error: null };
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
