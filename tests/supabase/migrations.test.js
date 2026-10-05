/**
 * Migraciones de Supabase (supabase/migrations/*.sql): reglas de seguridad
 * verificables sin conectarse a la base. Los tests de RLS contra la base
 * real están en supabase/tests/rls_test.sql (se corren con el plugin/MCP o
 * psql; ver docs/SUPABASE_PLAN.md).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
/** SQL sin comentarios de línea, en minúsculas. */
const SQL = FILES.map((f) => readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '').toLowerCase()).join('\n');

describe('supabase/migrations', () => {
  test('nombres <versión 14 dígitos>_<nombre>.sql, en orden (coinciden con supabase_migrations)', () => {
    assert.ok(FILES.length >= 1);
    for (const f of FILES) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/, f);
  });

  const tables = [...SQL.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]);

  test('crea las tablas de identidad y workspace', () => {
    for (const t of ['profiles', 'organizations', 'organization_members', 'workspace_states']) assert.ok(tables.includes(t), t);
  });

  test('toda tabla de public tiene RLS habilitada y nunca se deshabilita', () => {
    for (const t of tables) assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`), `RLS en ${t}`);
    assert.doesNotMatch(SQL, /disable row level security/);
    assert.doesNotMatch(SQL, /no force row level security/);
  });

  test('anon no recibe permisos; se revocan los permisos por defecto de Supabase', () => {
    assert.doesNotMatch(SQL, /grant [^;]* to [^;]*\banon\b/);
    for (const t of tables) assert.match(SQL, new RegExp(`revoke all on table [^;]*public\\.${t}[^;]* from anon, authenticated`), `revoke en ${t}`);
  });

  test('membresías y organizaciones no se crean ni borran desde el cliente (sin políticas ni grants de insert/delete)', () => {
    assert.doesNotMatch(SQL, /create policy [a-z_]+ on public\.(organization_members|organizations|workspace_states)\s+for (insert|delete|all)/);
    assert.doesNotMatch(SQL, /grant [^;]*(insert|delete)[^;]* on [^;]*public\./);
  });

  test('las funciones security definer viven en private y fijan search_path vacío', () => {
    const defs = [...SQL.matchAll(/create or replace function ([a-z_.]+)\([^)]*\)([\s\S]*?)as \$\$/g)];
    assert.ok(defs.length >= 3);
    for (const [, name, header] of defs) {
      if (!/security definer/.test(header)) continue;
      assert.ok(name.startsWith('private.'), `${name} es security definer fuera de private`);
      assert.match(header, /set search_path = ''/, `${name} sin search_path vacío`);
    }
  });

  test('workspace_states: el cliente sólo actualiza state y schema_version; la revisión la fija un trigger', () => {
    assert.match(SQL, /grant update \(state, schema_version\) on table public\.workspace_states to authenticated/);
    assert.match(SQL, /new\.revision := old\.revision \+ 1/);
    assert.match(SQL, /new\.organization_id := old\.organization_id/);
  });

  test('sin secretos ni conexiones con password en las migraciones', () => {
    assert.doesNotMatch(SQL, /postgres(?:ql)?:\/\/[^\s:]+:[^@\s[]+@/);
    assert.doesNotMatch(SQL, /service_role|sb_secret_/);
  });
});

describe('supabase/migrations: RATEOS ADMIN (rol de plataforma)', () => {
  const ADMIN_FILE = FILES.find((f) => /_rateos_platform_admin\.sql$/.test(f));
  const A = ADMIN_FILE ? readFileSync(path.join(DIR, ADMIN_FILE), 'utf8').replace(/--[^\n]*/g, '').toLowerCase() : '';
  /** Cuerpo de una función (entre $$ … $$). */
  const body = (name) => {
    const m = A.match(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$`));
    assert.ok(m, `falta ${name}`);
    return m[1];
  };
  const header = (name) => {
    const m = A.match(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\([^)]*\\)([\\s\\S]*?)as \\$\\$`));
    assert.ok(m, `falta ${name}`);
    return m[1];
  };

  test('existe la migración del rol de plataforma', () => {
    assert.ok(ADMIN_FILE);
  });

  test('platform_admins, bootstrap y auditoría viven en private, con RLS, sin políticas ni permisos para el cliente', () => {
    for (const t of ['platform_admins', 'platform_admin_bootstrap', 'admin_audit_log']) {
      assert.match(A, new RegExp(`create table private\\.${t} \\(`), t);
      assert.match(A, new RegExp(`alter table private\\.${t} enable row level security`), `RLS en ${t}`);
      assert.match(A, new RegExp(`revoke all on table [^;]*private\\.${t}[^;]* from public, anon, authenticated`), `revoke en ${t}`);
      assert.doesNotMatch(SQL, new RegExp(`create table public\\.${t}\\b`), `${t} no puede estar en public`);
    }
    assert.doesNotMatch(SQL, /create policy [a-z_]+ on private\./, 'sin políticas: nadie lee ni escribe por la API');
    assert.doesNotMatch(SQL, /grant [^;]* on (?:table )?private\./, 'sin grants de tablas de private');
  });

  test('is_platform_admin decide SÓLO por platform_admins y auth.uid() (nunca email, metadata ni claims)', () => {
    const b = body('private.is_platform_admin');
    assert.match(b, /private\.platform_admins/);
    assert.match(b, /auth\.uid\(\)/);
    assert.doesNotMatch(b, /email|meta_data|metadata|jwt|claims|organization/);
    for (const fn of ['private.admin_overview', 'private.admin_users']) {
      assert.match(body(fn), /not private\.is_platform_admin\(\)/, `${fn} verifica el rol`);
      assert.match(body(fn), /errcode = '42501'/, `${fn} rechaza con 42501`);
    }
  });

  test('bootstrap del master: email confirmado, normalizado, no anónimo y de un solo uso', () => {
    const grant = body('private.grant_platform_admin_bootstrap');
    assert.match(grant, /lower\(btrim\(/, 'normaliza el email');
    assert.match(grant, /p_confirmed_at is null[^;]*return/, 'sin confirmación no hace nada');
    assert.match(grant, /consumed_at is null/, 'un solo uso');
    assert.doesNotMatch(grant, /meta_data|metadata|claims|jwt/);
    const trig = body('private.handle_platform_admin_bootstrap');
    assert.match(trig, /new\.email_confirmed_at is not null/);
    assert.match(trig, /new\.is_anonymous is not true/);
    assert.doesNotMatch(trig, /meta_data|metadata/);
    assert.match(A, /create trigger on_auth_user_platform_admin\s+after insert or update of email, email_confirmed_at on auth\.users/);
    assert.match(A, /revoke all on function private\.grant_platform_admin_bootstrap\([^)]*\) from public, anon, authenticated/);
    assert.match(A, /check \(email = lower\(btrim\(email\)\)/, 'el bootstrap guarda el email normalizado');
  });

  test('sin "drop trigger" sobre auth.users (pide ACCESS EXCLUSIVE) y con lock_timeout', () => {
    assert.doesNotMatch(SQL, /drop trigger [^;]* on auth\.users/);
    assert.match(A, /set local lock_timeout/);
  });

  test('lo expuesto en public son wrappers security INVOKER, sólo para authenticated', () => {
    for (const fn of ['am_i_platform_admin', 'admin_overview', 'admin_users']) {
      assert.match(header(`public.${fn}`), /security invoker/, `${fn} invoker`);
      assert.doesNotMatch(header(`public.${fn}`), /security definer/);
      assert.match(A, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon`), `${fn} revoke`);
      assert.match(A, new RegExp(`grant execute on function public\\.${fn}\\(\\) to authenticated`), `${fn} grant`);
    }
  });

  test('admin_users nunca devuelve el contenido del workspace (sólo su tamaño)', () => {
    const b = body('private.admin_users');
    const stateRefs = b.match(/\bw\.state\b/g) || [];
    assert.equal(stateRefs.length, 1);
    assert.match(b, /pg_column_size\(w\.state\)/);
    const cols = A.match(/create or replace function private\.admin_users\(\)\s*returns table \(([^)]*)\)/)[1];
    assert.doesNotMatch(cols, /\bstate\b|password|token|user_id|organization_id/);
  });

  test('admin no cambia las políticas RLS de los datos de clientes', () => {
    assert.doesNotMatch(A, /create policy|alter policy|drop policy/);
    assert.doesNotMatch(A, /on public\.workspace_states/);
  });

  test('la auditoría sólo guarda quién, cuándo y qué acción (lista cerrada, detalle chico)', () => {
    assert.match(A, /action text not null check \(action in \('admin_panel_open'\)\)/);
    assert.match(A, /pg_column_size\(detail\) <= 2048/);
    const cols = A.match(/create table private\.admin_audit_log \(([\s\S]*?)\n\);/)[1];
    assert.doesNotMatch(cols, /password|token|jwt|cost|quote|state/);
  });
});

