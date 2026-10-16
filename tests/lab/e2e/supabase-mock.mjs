/**
 * RATEOS Test Lab — Supabase SIMULADO para la auditoría en navegador (PLAN-2026-013).
 *
 * Intercepta en Playwright todo lo que va al proyecto de Supabase (GoTrue +
 * PostgREST): la base real nunca recibe un pedido (staging comparte la base con
 * producción). Emula las políticas RLS de la migración: cada consulta sólo ve y
 * modifica filas de las organizaciones de las que el usuario del token es
 * miembro. Usuarios, organizaciones y tokens son sintéticos y viven en memoria.
 */

import { randomUUID } from 'node:crypto';
import { SUPABASE } from '../../../js/config.js';

export const SUPA = SUPABASE.url;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Base en memoria (como el trigger on_auth_user_created: cada usuario nace con su organización y su workspace vacío). */
export function createDb() {
  const db = {
    users: new Map(),
    tokens: new Map(),
    refresh: new Map(),
    orgs: new Map(),
    members: [],
    profiles: new Map(),
    workspaces: new Map(),
    log: [],
  };
  db.createUser = ({ email, password, fullName, company }) => {
    const id = randomUUID();
    const orgId = randomUUID();
    const now = new Date().toISOString();
    db.users.set(email, { id, email, password, fullName, company, createdAt: now });
    db.profiles.set(id, { id, full_name: String(fullName || '').slice(0, 120) });
    db.orgs.set(orgId, { id: orgId, name: String(company || 'Mi empresa').slice(0, 120), created_at: now, updated_at: now });
    db.members.push({ organization_id: orgId, user_id: id, role: 'OWNER', created_at: now });
    db.workspaces.set(orgId, { id: randomUUID(), organization_id: orgId, state: null, revision: 0, schema_version: 2, updated_at: now, updated_by: null });
    return db.users.get(email);
  };
  db.userById = (id) => [...db.users.values()].find((u) => u.id === id);
  db.orgOf = (userId) => db.members.find((m) => m.user_id === userId).organization_id;
  return db;
}

/** Token con forma de JWT (firma aleatoria: sólo lo valida este simulador). */
function token(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: randomUUID() }));
  return `${header}.${payload}.${b64url(randomUUID())}`;
}

function userJson(u) {
  const now = new Date().toISOString();
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: now,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: u.fullName, company: u.company, email_verified: true },
    identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { sub: u.id, email: u.email } }],
    created_at: u.createdAt,
    updated_at: now,
  };
}

function session(db, u) {
  const access = token(u);
  const refresh = b64url(randomUUID());
  db.tokens.set(access, u.id);
  db.refresh.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJson(u) };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': 'Content-Range, X-Supabase-Api-Version',
  'x-supabase-api-version': '2024-01-01',
};

const reply = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
const authErr = (route, status, code, msg) => reply(route, status, { code, error_code: code, msg, message: msg });

/** Filtros simples de PostgREST (col=eq.valor). */
function filters(url) {
  const out = {};
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) out[k] = m[1];
  }
  return out;
}
const matches = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === v);
function pick(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const raw of select.split(',')) {
    const col = raw.trim();
    if (col && !col.includes('(')) out[col] = row[col];
  }
  return out;
}

/** Intercepta Supabase en un contexto de Playwright. */
export async function installSupabaseMock(context, db) {
  await context.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    db.log.push(`${method} ${url.pathname}`);
    if (req.headers().apikey !== SUPABASE.publishableKey) return reply(route, 401, { message: 'Invalid API key' });
    const bearer = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
    const uid = db.tokens.get(bearer) || null;
    let body = null;
    try {
      body = req.postData() ? JSON.parse(req.postData()) : null;
    } catch {
      body = null;
    }

    // GoTrue
    if (url.pathname === '/auth/v1/token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = db.users.get(body && body.email);
        if (!u || u.password !== body.password) return authErr(route, 400, 'invalid_credentials', 'Invalid login credentials');
        return reply(route, 200, session(db, u));
      }
      if (grant === 'refresh_token') {
        const userId = db.refresh.get(body && body.refresh_token);
        if (!userId) return authErr(route, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
        db.refresh.delete(body.refresh_token);
        return reply(route, 200, session(db, db.userById(userId)));
      }
      return authErr(route, 400, 'unsupported_grant_type', 'unsupported');
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname === '/auth/v1/user') {
      if (!uid) return authErr(route, 401, 'bad_jwt', 'invalid JWT');
      return reply(route, 200, userJson(db.userById(uid)));
    }

    // PostgREST con RLS emulada
    if (url.pathname.startsWith('/rest/v1/')) {
      if (!uid) return reply(route, 401, { code: '42501', message: 'permission denied for table' });
      const table = url.pathname.slice('/rest/v1/'.length);
      const f = filters(url);
      const select = url.searchParams.get('select');
      const memberOrgs = new Set(db.members.filter((m) => m.user_id === uid).map((m) => m.organization_id));
      const roleIn = (orgId) => (db.members.find((m) => m.user_id === uid && m.organization_id === orgId) || {}).role;
      const single = String(req.headers().accept || '').includes('vnd.pgrst.object');
      const out = (rows) => {
        if (single) return rows.length === 1 ? reply(route, 200, rows[0]) : reply(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return reply(route, 200, rows);
      };
      if (method === 'POST' && table.startsWith('rpc/')) {
        // Sólo la consulta de rol de plataforma: en el lab nadie es RATEOS ADMIN.
        return table === 'rpc/am_i_platform_admin' ? reply(route, 200, false) : reply(route, 403, { code: '42501', message: 'forbidden' });
      }
      if (method === 'GET') {
        if (table === 'organization_members') {
          const rows = db.members.filter((m) => memberOrgs.has(m.organization_id) && matches(m, f)).map((m) => ({ ...pick(m, select), organizations: { id: m.organization_id, name: db.orgs.get(m.organization_id).name } }));
          return out(rows.slice(0, Number(url.searchParams.get('limit')) || rows.length));
        }
        if (table === 'profiles') return out([...db.profiles.values()].filter((p) => p.id === uid && matches(p, f)).map((p) => pick(p, select)));
        if (table === 'workspace_states') return out([...db.workspaces.values()].filter((w) => memberOrgs.has(w.organization_id) && matches(w, f)).map((w) => pick(w, select)));
        if (table === 'organizations') return out([...db.orgs.values()].filter((o) => memberOrgs.has(o.id) && matches(o, f)).map((o) => pick(o, select)));
        return reply(route, 404, { message: 'not found' });
      }
      if (method === 'PATCH' && table === 'workspace_states') {
        if (Object.keys(body || {}).some((k) => !['state', 'schema_version'].includes(k))) return reply(route, 401, { code: '42501', message: 'permission denied for column' });
        const rows = [...db.workspaces.values()].filter((w) => memberOrgs.has(w.organization_id) && ['OWNER', 'ADMIN', 'ESTIMATOR'].includes(roleIn(w.organization_id)) && matches(w, f));
        rows.forEach((w) => {
          w.state = body.state;
          w.schema_version = body.schema_version;
          w.revision += 1;
          w.updated_by = uid;
          w.updated_at = new Date().toISOString();
        });
        return out(rows.map((w) => pick(w, select)));
      }
      return reply(route, 403, { code: '42501', message: 'permission denied' });
    }
    return reply(route, 404, { message: 'not found' });
  });
}
