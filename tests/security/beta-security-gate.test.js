/**
 * Beta Security Gate (PLAN-2026-015) dentro de `npm test`: si un control P0/P1
 * falla, falla la suite (y CI y el deploy no siguen). También prueba que los
 * detectores del gate detectan lo que tienen que detectar.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  creditsFindings,
  findSecrets,
  gateVerdict,
  HUMAN_DECISIONS,
  loggerTemplateCalls,
  migrationFindings,
  runSecurityChecks,
  stagingFindings,
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

  test('HD-01, HD-02 y HD-03 son requisitos obligatorios antes de usuarios reales (decisión del dueño) y siguen pendientes', async () => {
    const verdict = gateVerdict(await runSecurityChecks());
    assert.deepEqual(verdict.requiredBeforeRealUsers.map((r) => r.id), ['HD-01', 'HD-02', 'HD-03']);
    assert.ok(verdict.requiredBeforeRealUsers.every((r) => r.status === 'human' && /^Requisito obligatorio antes de habilitar usuarios reales/.test(r.details[0])));
    assert.match(verdict.requiredBeforeRealUsers[0].details[0], /dominio propio/);
    assert.match(verdict.requiredBeforeRealUsers[1].details[0], /origen y en base de datos, o \/preview\/ deshabilitado/);
    assert.match(verdict.requiredBeforeRealUsers[2].details[0], /registro público con confirmación de email/, 'HD-03 cambió por decisión del dueño (2026-10-20)');
    assert.match(verdict.requiredBeforeRealUsers[2].details[0], /SMTP propio/);
  });
});

describe('Beta Security Gate: los detectores detectan', () => {
  test('staging (HD-02): un preview en el origen de producción se detecta; el workflow actual no lo tiene', () => {
    const viejo = [
      'on:\n  workflow_run:\n    workflows: [CI]\n',
      'jobs:\n  preview:\n    steps:\n      - run: git show origin/main:scripts/stage-preview.mjs > s.mjs && node s.mjs --site dist --from preview-dist\n',
    ].join('');
    const hallazgos = stagingFindings(viejo, { stagePreviewScript: true });
    assert.ok(hallazgos.some((h) => /workflow_run/.test(h)), 'publicar ramas con workflow_run');
    assert.ok(hallazgos.some((h) => /staging/.test(h)), 'armar /preview/');
    assert.ok(hallazgos.some((h) => /guardia/.test(h)), 'sin la guardia de dist/preview');
    assert.ok(hallazgos.some((h) => /404/.test(h)), 'sin verificar /preview/ → 404');
    assert.ok(hallazgos.some((h) => /stage-preview\.mjs existe/.test(h)), 'el script del preview');
    const actual = readFileSync(new URL('../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
    assert.deepEqual(stagingFindings(actual), []);
  });

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

  test('créditos y reportes (SEC-19): detecta cobro fuera de Postgres, tablas expuestas y revisión sin admin', () => {
    const real = {
      migration: readFileSync(new URL('../../supabase/migrations/20261021120000_rateos_beta_credits_reports.sql', import.meta.url), 'utf8'),
      sqlTest: readFileSync(new URL('../../supabase/tests/credits_reports_test.sql', import.meta.url), 'utf8'),
      concurrency: readFileSync(new URL('../../supabase/tests/local/credits_concurrency.sh', import.meta.url), 'utf8'),
      clientFiles: [],
    };
    assert.deepEqual(creditsFindings(real), []);
    assert.deepEqual(creditsFindings({ ...real, migration: '' }), ['falta la migración de créditos y reportes']);
    const has = (input, re) => creditsFindings(input).some((f) => re.test(f));
    assert.ok(has({ ...real, migration: real.migration.replace('create trigger workspace_states_credit_guard', 'create trigger otro') }, /trigger BEFORE/));
    assert.ok(has({ ...real, migration: real.migration.replace('create table private.credit_accounts', 'create table public.credit_accounts') }, /credit_accounts no está en private/));
    assert.ok(has({ ...real, migration: real.migration.replace(/create unique index credit_ledger_reward_once[^;]*;/, '') }, /premio por reporte/));
    assert.ok(has({ ...real, migration: real.migration.replace('if v_uid is null or not private.is_platform_admin() then\n    raise exception \'forbidden\' using errcode = \'42501\';\n  end if;\n  if p_status is null or p_status not in (\'in_review\'', 'if v_uid is null then\n    raise exception \'forbidden\' using errcode = \'42501\';\n  end if;\n  if p_status is null or p_status not in (\'in_review\'') }, /exige RATEOS ADMIN/));
    assert.ok(has({ ...real, migration: `${real.migration}\ngrant execute on function private.admin_adjust_credits(uuid, integer, text) to authenticated;` }, /admin_adjust_credits se puede ejecutar/));
    assert.ok(has({ ...real, migration: real.migration.replace('select o.name, a.enabled, a.balance,', 'select o.name, a.enabled, a.balance, (select pg_column_size(w.state) from public.workspace_states w limit 1),') }, /admin_credit_accounts lee workspace_states/));
    assert.ok(has({ ...real, clientFiles: [{ rel: 'js/x.js', text: "client.from('credit_accounts').update({ balance: 99 })" }] }, /js\/x\.js: nombra una tabla/));
    assert.deepEqual(creditsFindings({ ...real, clientFiles: [{ rel: 'js/data/admin-gateway.js', text: "rpc(client, 'admin_credit_accounts')" }] }), []);
    assert.ok(has({ ...real, sqlTest: real.sqlTest.replace(/raise exception 'CREDITS_TESTS_FAILED[^;]*;/, '') }, /RAISE EXCEPTION/));
    assert.ok(has({ ...real, concurrency: 'psql -c "select 1"' }, /fuera de la base local/));
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
