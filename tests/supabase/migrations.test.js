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
    // El ROL service_role puede recibir grants de funciones puntuales (Edge
    // Function del puente a GitHub); lo que nunca puede aparecer es una clave.
    const withoutRoleGrants = SQL.replace(/grant (?:usage|execute) on (?:schema|function) [^;]* to service_role;/g, '');
    assert.doesNotMatch(withoutRoleGrants, /service_role|sb_secret_/);
    assert.doesNotMatch(SQL, /eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/, 'sin JWT en las migraciones');
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


describe('supabase/migrations: reportes de problemas (PLAN-2026-020)', () => {
  const FILE = FILES.find((f) => /_rateos_bug_reports\.sql$/.test(f));
  const B = FILE ? readFileSync(path.join(DIR, FILE), 'utf8').replace(/--[^\n]*/g, '').toLowerCase() : '';

  test('la tabla vive en private, con RLS y sin permisos para el cliente', () => {
    assert.ok(FILE);
    assert.match(B, /create table private\.bug_reports \(/);
    assert.match(B, /alter table private\.bug_reports enable row level security/);
    assert.match(B, /revoke all on table private\.bug_reports from public, anon, authenticated/);
    assert.doesNotMatch(B, /create table public\.bug_reports/);
  });

  test('alta sólo con sesión, con límite por persona; lista sólo para RATEOS_ADMIN', () => {
    assert.match(B, /if v_uid is null then\s+raise exception 'forbidden' using errcode = '42501'/);
    assert.match(B, /rate_limited/);
    assert.match(B, /not private\.is_platform_admin\(\)/);
    assert.match(B, /grant execute on function public\.submit_bug_report\(jsonb\) to authenticated/);
  });

  test('el puente a GitHub (claim / set) sólo lo ejecuta service_role y sólo para el reporte de quien llama', () => {
    assert.match(B, /revoke all on function public\.claim_bug_report_for_github\(uuid, uuid\) from public, anon, authenticated/);
    assert.match(B, /revoke all on function public\.set_bug_report_github\(uuid, integer, text\) from public, anon, authenticated/);
    assert.match(B, /b\.reporter_id = p_reporter/);
    assert.match(B, /b\.github_issue_number is null/);
  });

  test('lo que va a GitHub y al admin no incluye quién reportó', () => {
    const claim = B.match(/function private\.claim_bug_report_for_github[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
    const adminList = B.match(/function private\.admin_bug_reports[\s\S]*?\$\$([\s\S]*?)\$\$/)[1];
    for (const body of [claim.split('jsonb_build_object')[1], adminList]) {
      assert.doesNotMatch(body, /'reporter_id'|email|full_name|organization/);
    }
  });
});


describe('supabase/migrations: reportes sin sesión (todos pueden reportar)', () => {
  const FILE = FILES.find((f) => /_rateos_bug_reports_anon\.sql$/.test(f));
  const C = FILE ? readFileSync(path.join(DIR, FILE), 'utf8').replace(/--[^\n]*/g, '').toLowerCase() : '';

  test('anon no recibe nada: el alta sin sesión sólo la ejecuta service_role', () => {
    assert.ok(FILE);
    assert.doesNotMatch(C, /grant [^;]* to [^;]*\banon\b/);
    assert.doesNotMatch(C, /grant usage on schema private to anon/);
    assert.match(C, /revoke all on function private\.submit_public_bug_report\(jsonb, text\) from public, anon, authenticated/);
    assert.match(C, /revoke all on function public\.submit_public_bug_report\(jsonb, text\) from public, anon, authenticated/);
    assert.match(C, /grant execute on function public\.submit_public_bug_report\(jsonb, text\) to service_role/);
    assert.match(C, /revoke all on function private\.insert_bug_report\(jsonb, uuid, text\) from public, anon, authenticated/);
  });

  test('con sesión sigue exigiendo auth.uid(); sin sesión hay límite por origen y tope global', () => {
    assert.match(C, /if v_uid is null then\s+raise exception 'forbidden' using errcode = '42501'/);
    assert.match(C, /b\.source_key = p_source_key/);
    assert.match(C, />= 40/);
    assert.match(C, />= 300/);
  });
});
