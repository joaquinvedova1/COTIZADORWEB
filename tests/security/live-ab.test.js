/**
 * Prueba A/B real (PLAN-2026-016): tests/live/perimeter-ab.mjs y
 * supabase/tests/live_ab.sql. Acá se prueba, SIN red ni base, que sólo puedan
 * usar y borrar datos SINTÉTICOS y que nada sensible llegue a un reporte.
 * La prueba real se corre a mano (nunca en CI ni en npm test).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assertNoSecrets, denied, isSyntheticEmail, syntheticAccounts } from '../live/perimeter-ab.mjs';

const SQL = readFileSync(new URL('../../supabase/tests/live_ab.sql', import.meta.url), 'utf8');
describe('prueba A/B real: sólo cuentas sintéticas', () => {
  test('una cuenta es sintética sólo con @rateos.invalid', () => {
    for (const ok of ['perimetro-a@rateos.invalid', 'PERIMETRO-B@RATEOS.INVALID', ' x.y+1@rateos.invalid ']) assert.equal(isSyntheticEmail(ok), true, ok);
    for (const bad of ['', null, 'persona@empresa.com', 'x@rateos.invalid.com', 'x@rateos.test', 'rateos.invalid', '@rateos.invalid']) assert.equal(isSyntheticEmail(bad), false, String(bad));
  });

  test('se niega con cuentas reales, incompletas o repetidas, sin mostrar emails ni contraseñas', () => {
    const env = { RATEOS_LIVE_A_EMAIL: 'perimetro-a@rateos.invalid', RATEOS_LIVE_A_PASSWORD: 'clave-a-123456', RATEOS_LIVE_B_EMAIL: 'perimetro-b@rateos.invalid', RATEOS_LIVE_B_PASSWORD: 'clave-b-123456' };
    assert.deepEqual(Object.keys(syntheticAccounts(env)), ['a', 'b']);
    const cases = [
      { ...env, RATEOS_LIVE_A_EMAIL: 'duenio@empresa-real.com' },
      { ...env, RATEOS_LIVE_B_PASSWORD: '' },
      { ...env, RATEOS_LIVE_B_EMAIL: 'PERIMETRO-A@rateos.invalid' },
      {},
    ];
    for (const bad of cases) {
      assert.throws(() => syntheticAccounts(bad), (error) => {
        assert.doesNotMatch(error.message, /empresa-real|clave-|perimetro-/i, 'el mensaje no muestra datos');
        return true;
      });
    }
  });

  test('un reporte con un email, una contraseña o un token no se escribe', () => {
    const secrets = ['perimetro-a@rateos.invalid', 'clave-a-123456', 'eyJhbGciOi.token.largo'];
    assert.doesNotThrow(() => assertNoSecrets('| A→B | no lee el espacio ajeno | OK |', secrets));
    for (const s of secrets) assert.throws(() => assertNoSecrets(`detalle ${s}`, secrets));
  });

  test('"denegado" = error HTTP o cero filas; una fila devuelta nunca cuenta como denegado', () => {
    assert.equal(denied({ status: 401, body: { message: 'x' } }), true);
    assert.equal(denied({ status: 403, body: null }), true);
    assert.equal(denied({ status: 200, body: [] }), true);
    assert.equal(denied({ status: 200, body: [{ id: 'ajeno' }] }), false);
    assert.equal(denied({ status: 201, body: [{ id: 'creado' }] }), false);
    assert.equal(denied(null), false);
  });
});

describe('live_ab.sql: sólo toca lo sintético', () => {
  const statements = (text) => text.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);

  test('los únicos emails son los dos sintéticos y no hay contraseñas reales (sólo marcadores)', () => {
    const emails = new Set(SQL.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g));
    assert.deepEqual([...emails].sort(), ['perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid']);
    assert.match(SQL, /pw_a text := '__CONTRASENA_A__'/);
    assert.match(SQL, /pw_b text := '__CONTRASENA_B__'/);
    assert.match(SQL, /raise exception 'LIVE_AB_SETUP: reemplazá las dos contraseñas/, 'el alta se niega con los marcadores');
  });

  test('los DELETE están sólo en la limpieza y sólo sobre lo sintético identificado', () => {
    const deletes = statements(SQL).filter((s) => /\bdelete\s+from\b/i.test(s));
    assert.equal(deletes.length, 2);
    for (const d of deletes) assert.match(d, /where id = any\((coalesce\()?synth_(orgs|users)/i, d);
    const cleanup = SQL.slice(SQL.search(/-- -+ 4\. LIMPIEZA/));
    assert.equal(statements(SQL.slice(0, SQL.search(/-- -+ 4\. LIMPIEZA/))).filter((s) => /\bdelete\b/i.test(s)).length, 0, 'ningún DELETE fuera de la limpieza');
    assert.match(cleanup, /from auth\.users where email in \('perimetro-a@rateos\.invalid', 'perimetro-b@rateos\.invalid'\)/);
    assert.match(cleanup, /tiene otros miembros: no se borra nada/, 'se niega si una organización sintética tiene un miembro real');
    assert.match(cleanup, /más datos de los esperados: no se borra nada/);
  });

  test('identificar y verificar son sólo lectura y filtran por los emails sintéticos', () => {
    const readOnly = SQL.slice(SQL.search(/-- -+ 2\. IDENTIFICAR/), SQL.search(/-- -+ 4\. LIMPIEZA/));
    assert.doesNotMatch(readOnly, /\b(insert|update|delete|truncate|alter|drop)\b/i);
    assert.equal((readOnly.match(/where u\.email in \('perimetro-a@rateos\.invalid', 'perimetro-b@rateos\.invalid'\)/g) || []).length, 2);
  });

  test('el script de la prueba real no está en npm test ni en CI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.doesNotMatch(JSON.stringify(pkg.scripts), /perimeter-ab|tests\/live/);
    for (const wf of ['ci.yml', 'test-lab.yml', 'deploy-pages.yml']) {
      assert.doesNotMatch(readFileSync(new URL(`../../.github/workflows/${wf}`, import.meta.url), 'utf8'), /perimeter-ab|tests\/live|live_ab/, wf);
    }
  });
});
