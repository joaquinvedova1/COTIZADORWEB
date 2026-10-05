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
