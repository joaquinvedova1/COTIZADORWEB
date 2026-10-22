/**
 * Perímetro de Supabase Auth (HD-03, PLAN-2026-016/018): scripts/check-auth-perimeter.mjs
 * lee la configuración pública de Auth y exige que coincida con la app: hoy,
 * registro público con confirmación de email obligatoria, sin apagar el
 * ingreso por email ni sumar otros métodos. Acá se prueba la evaluación (sin red).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAuthSettings, MANUAL_CHECKS } from '../../scripts/check-auth-perimeter.mjs';
import { FEATURES } from '../../js/config.js';

/** Forma de GET /auth/v1/settings de Supabase Auth (valores de ejemplo). */
const settings = (over = {}, external = {}) => ({
  external: { anonymous_users: false, apple: false, azure: false, email: true, github: false, google: false, phone: false, ...external },
  disable_signup: false,
  mailer_autoconfirm: false,
  phone_autoconfirm: false,
  saml_enabled: false,
  ...over,
});

describe('perímetro de Auth (HD-03)', () => {
  test('registro público (lo que ofrece la app): registro abierto, Email activo, confirmación obligatoria y nada más', () => {
    assert.equal(FEATURES.publicSignup, true);
    const r = evaluateAuthSettings(settings());
    assert.equal(r.ok, true);
    assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [['signup', true], ['email', true], ['confirm', true], ['others', true]]);
  });

  test('registro público con el registro cerrado en Supabase: la app ofrecería algo que falla (se detecta)', () => {
    const r = evaluateAuthSettings(settings({ disable_signup: true }));
    assert.equal(r.ok, false);
    assert.match(r.checks.find((c) => c.id === 'signup').detail, /está cerrado/);
  });

  test('registro público sin confirmación de email: nunca se da por bueno (cualquiera entraría con un email ajeno)', () => {
    const r = evaluateAuthSettings(settings({ mailer_autoconfirm: true }));
    assert.equal(r.ok, false);
    assert.match(r.checks.find((c) => c.id === 'confirm').detail, /email ajeno/);
  });

  test('si se vuelve a la beta por invitación (publicSignup = false), exige el registro cerrado', () => {
    assert.equal(evaluateAuthSettings(settings({ disable_signup: true }), { publicSignup: false }).ok, true);
    const open = evaluateAuthSettings(settings(), { publicSignup: false });
    assert.equal(open.ok, false);
    assert.match(open.checks.find((c) => c.id === 'signup').detail, /sigue abierto/);
  });

  test('apagar el proveedor Email en lugar del registro rompe el ingreso: se detecta', () => {
    const r = evaluateAuthSettings(settings({}, { email: false }));
    assert.equal(r.ok, false);
    assert.match(r.checks.find((c) => c.id === 'email').detail, /nadie puede ingresar/);
  });

  test('autoconfirmación, proveedores sociales, anónimos o SAML: se detectan', () => {
    assert.equal(evaluateAuthSettings(settings({ mailer_autoconfirm: true })).ok, false);
    const others = evaluateAuthSettings(settings({ saml_enabled: true }, { google: true, anonymous_users: true }));
    assert.equal(others.ok, false);
    assert.equal(others.checks.find((c) => c.id === 'others').detail, 'habilitados: anonymous_users, google, saml');
  });

  test('una respuesta vacía o inválida nunca se da por buena', () => {
    for (const bad of [null, undefined, {}, 'x', { external: null }]) assert.equal(evaluateAuthSettings(bad).ok, false);
  });

  test('el SMTP propio no es público: queda como verificación manual (sin él, nadie de afuera recibe la confirmación)', () => {
    const smtp = MANUAL_CHECKS.find((c) => c.id === 'smtp');
    assert.ok(smtp, 'el script recuerda el SMTP propio');
    assert.match(smtp.label, /SMTP Settings/);
    assert.match(smtp.detail, /equipo del proyecto/);
    assert.equal(evaluateAuthSettings(settings()).checks.some((c) => c.id === 'smtp'), false, 'no se da por verificado lo que no se puede leer');
  });
});
