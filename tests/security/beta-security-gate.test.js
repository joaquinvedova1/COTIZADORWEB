/**
 * Beta Security Gate (PLAN-2026-015) dentro de `npm test`: si un control P0/P1
 * falla, falla la suite (y CI y el deploy no siguen). También prueba que los
 * detectores del gate detectan lo que tienen que detectar.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  findSecrets,
  gateVerdict,
  HUMAN_DECISIONS,
  loggerTemplateCalls,
  migrationFindings,
  runSecurityChecks,
  supabaseSurface,
  unguardedDeletes,
} from './lib/checks.js';

describe('Beta Security Gate', () => {
  test('ningún control P0/P1 falla', async () => {
    const results = await runSecurityChecks();
    const { blocking } = gateVerdict(results);
    assert.deepEqual(blocking.map((r) => `${r.id}: ${r.details.join(' | ')}`), []);
    assert.ok(results.filter((r) => r.status !== 'human').length >= 15, 'el gate corre todos sus controles');
  });

  test('las decisiones del dueño se informan siempre y nunca se marcan como resueltas solas', async () => {
    const results = await runSecurityChecks();
    const human = results.filter((r) => r.status === 'human');
    assert.equal(human.length, HUMAN_DECISIONS.length);
    assert.ok(human.every((r) => /^HD-\d+$/.test(r.id) && r.details[0]));
  });
});

describe('Beta Security Gate: los detectores detectan', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

  test('secretos: secret key, clave privada, connection string y JWT de service_role (no la publishable key)', () => {
    // Los ejemplos se arman por partes: el detector de secretos del repo no los confunde con reales.
    assert.equal(findSecrets(`const k = '${'sb_' + 'secret_'}${'a'.repeat(20)}';`).length, 1);
    assert.equal(findSecrets(`${'-----BEGIN '}${'PRIVATE KEY-----'}`).length, 1);
    assert.equal(findSecrets(`${'postgres' + '://'}postgres:clave@db.example:5432/postgres`).length, 1);
    const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.${'x'.repeat(20)}`;
    assert.deepEqual(findSecrets(`token = "${jwt('service_role')}"`), ['JWT con rol service_role']);
    assert.deepEqual(findSecrets(`token = "${jwt('anon')}"`), []);
    assert.deepEqual(findSecrets("publishableKey: 'sb_publishable_abc123'"), []);
  });

  test('logger con mensaje interpolado', () => {
    assert.deepEqual(loggerTemplateCalls('logger.warn(`Costo ${costo}`, {});'), ['Costo ${costo}']);
    assert.deepEqual(loggerTemplateCalls("logger.warn('Mensaje fijo', { code });"), []);
  });

  test('DELETE sin protección en un test SQL', () => {
    assert.equal(unguardedDeletes('  delete from public.organization_members where user_id = x;').length, 1);
    assert.deepEqual(unguardedDeletes('  begin\n    delete from public.organizations where id = y;\n    failed := failed || \'x\';\n  exception when insufficient_privilege then passed := passed + 1;\n  end;'), []);
  });

  test('migraciones: tabla sin RLS, grant a anon, política abierta, security definer fuera de private', () => {
    const bad = `
      create table public.cotizaciones (id uuid primary key);
      grant select on table public.cotizaciones to anon;
      create policy abierta on public.cotizaciones for select to authenticated using (true);
      create or replace function public.leer() returns void language sql security definer as $$ select 1 $$;`;
    const findings = migrationFindings(bad);
    assert.ok(findings.some((f) => /sin RLS/.test(f)));
    assert.ok(findings.some((f) => /anon/.test(f)));
    assert.ok(findings.some((f) => /"true"/.test(f)));
    assert.ok(findings.some((f) => /fuera de private/.test(f)));
    assert.ok(findings.some((f) => /search_path/.test(f)));
  });

  test('superficie de Supabase: tabla/RPC no revisadas, borrados y Realtime desde el cliente', () => {
    const s = supabaseSurface([
      { rel: 'js/data/x-gateway.js', text: "client.from('quotes').delete().eq('id', 1); client.rpc('leer_todo'); client.channel('x');" },
      { rel: 'js/ui/views/x.js', text: "import { getSupabaseClient } from '../../data/supabase-client.js';" },
    ]);
    assert.deepEqual(s.tables, ['quotes']);
    assert.deepEqual(s.rpcNames, ['leer_todo']);
    assert.deepEqual(s.mutations, ['js/data/x-gateway.js']);
    assert.deepEqual(s.features, ['js/data/x-gateway.js']);
    assert.deepEqual(s.clientImports, ['js/ui/views/x.js']);
  });
});
