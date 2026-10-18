/**
 * Perímetro de Supabase Auth (HD-03, PLAN-2026-016): scripts/check-auth-perimeter.mjs
 * lee la configuración pública de Auth y exige el registro cerrado sin apagar
 * el ingreso por email. Acá se prueba la evaluación (sin red).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAuthSettings, MANUAL_CHECKS } from '../../scripts/check-auth-perimeter.mjs';

/** Forma de GET /auth/v1/settings de Supabase Auth (valores de ejemplo). */
const settings = (over = {}, external = {}) => ({
  external: { anonymous_users: false, apple: false, azure: false, email: true, github: false, google: false, phone: false, ...external },
  disable_signup: true,
  mailer_autoconfirm: false,
  phone_autoconfirm: false,
  saml_enabled: false,
  ...over,
});

describe('perímetro de Auth (HD-03)', () => {
  test('beta por invitación: registro cerrado, Email activo, confirmación activa y nada más', () => {
    const r = evaluateAuthSettings(settings());
    assert.equal(r.ok, true);
    assert.deepEqual(r.checks.map((c) => [c.id, c.ok]), [['signup', true], ['email', true], ['confirm', true], ['others', true]]);
  });

  test('registro abierto: pendiente (es HD-03)', () => {
    const r = evaluateAuthSettings(settings({ disable_signup: false }));
    assert.equal(r.ok, false);
    assert.match(r.checks.find((c) => c.id === 'signup').detail, /sigue abierto/);
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

  test('el SMTP propio no es público: queda como verificación manual (sin él, las personas invitadas no reciben el correo)', () => {
    const smtp = MANUAL_CHECKS.find((c) => c.id === 'smtp');
    assert.ok(smtp, 'el script recuerda el SMTP propio');
    assert.match(smtp.label, /SMTP Settings/);
    assert.match(smtp.detail, /equipo del proyecto/);
    assert.equal(evaluateAuthSettings(settings()).checks.some((c) => c.id === 'smtp'), false, 'no se da por verificado lo que no se puede leer');
  });
});
