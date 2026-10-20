/**
 * RATEOS Test Lab — Supabase SIMULADO para la auditoría en navegador (PLAN-2026-013).
 *
 * Intercepta en Playwright todo lo que va al proyecto de Supabase (GoTrue +
 * PostgREST): la base real nunca recibe un pedido (staging comparte la base con
 * producción). Emula las políticas RLS de la migración: cada consulta sólo ve y
 * modifica filas de las organizaciones de las que el usuario del token es
 * miembro. Usuarios, organizaciones y tokens son sintéticos y viven en memoria.
 *
 * Correos de Auth (HD-03): "¿Olvidaste tu contraseña?" deja el correo en
 * db.outbox (enlace /verify + código de 6 dígitos) sólo si la cuenta existe,
 * como Supabase. db.smtp.mode simula el SMTP: 'custom' (entrega todo),
 * 'default' (SMTP por defecto: sólo al equipo, db.smtp.team) o 'broken'.
 * El enlace sigue el flujo PKCE real (code_challenge → ?code= → canje con el
 * code_verifier) y el código, verifyOtp type 'recovery'. Nada sale a internet.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { SUPABASE } from '../../../js/config.js';

export const SUPA = SUPABASE.url;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

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
    /** Correos de Auth simulados (nunca se envían). */
    outbox: [],
    /** Códigos PKCE emitidos por /verify, a canjear con el code_verifier. */
    flows: new Map(),
    smtp: { mode: 'custom', team: [] },
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
    // Enlace del correo (lo abre el navegador, sin apikey): consume el token y vuelve al sitio con ?code= (PKCE).
    if (url.pathname === '/auth/v1/verify' && method === 'GET') {
      const mail = db.outbox.find((m) => m.tokenHash === url.searchParams.get('token'));
      const target = new URL(url.searchParams.get('redirect_to') || (mail && mail.redirectTo));
      if (!mail || mail.used) {
        target.hash = 'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
        return route.fulfill({ status: 303, headers: { location: target.href } });
      }
      mail.used = true;
      const authCode = randomUUID();
      db.flows.set(authCode, { email: mail.to, challenge: mail.challenge, method: mail.method });
      target.searchParams.set('code', authCode);
      return route.fulfill({ status: 303, headers: { location: target.href } });
    }
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
      if (grant === 'pkce') {
        const flow = db.flows.get(body && body.auth_code);
        if (!flow) return authErr(route, 404, 'flow_state_not_found', 'invalid flow state, no valid flow state found');
        // Como GoTrue: s256 (https) o plain (el SDK lo usa sin crypto.subtle, p. ej. en http://rateos.test).
        const verifier = String((body && body.code_verifier) || '');
        const expected = flow.method === 'plain' ? verifier : b64url(createHash('sha256').update(verifier).digest());
        if (!flow.challenge || !verifier || flow.challenge !== expected) return authErr(route, 403, 'bad_code_verifier', 'code challenge does not match previously saved code verifier');
        db.flows.delete(body.auth_code);
        return reply(route, 200, session(db, db.users.get(flow.email)));
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
    // "¿Olvidaste tu contraseña?": como Supabase, 200 aunque la cuenta no exista (y entonces no sale nada).
    if (url.pathname === '/auth/v1/recover' && method === 'POST') {
      const u = [...db.users.values()].find((x) => sameEmail(x.email, body && body.email));
      if (!u) return reply(route, 200, {});
      if (db.smtp.mode === 'default' && !db.smtp.team.some((t) => sameEmail(t, u.email))) return authErr(route, 400, 'email_address_not_authorized', 'Email address not authorized');
      if (db.smtp.mode === 'broken') return authErr(route, 500, 'unexpected_failure', 'Error sending recovery email');
      const last = db.outbox.filter((m) => m.to === u.email).at(-1);
      if (last && Date.now() - last.at < 60000) return authErr(route, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
      // Como GoTrue (un solo recovery_token por usuario): un correo nuevo anula el enlace y el código del anterior.
      for (const m of db.outbox) if (m.to === u.email && m.type === 'recovery') m.used = true;
      db.outbox.push({
        to: u.email,
        type: 'recovery',
        otp: String(randomInt(0, 1000000)).padStart(6, '0'),
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        redirectTo: url.searchParams.get('redirect_to'),
        challenge: (body && body.code_challenge) || null,
        method: String((body && body.code_challenge_method) || 's256').toLowerCase(),
        used: false,
        at: Date.now(),
      });
      return reply(route, 200, {});
    }
    // Código del correo (verifyOtp): sirve en cualquier navegador, una sola vez. Es la misma credencial que el enlace (mail.used).
    if (url.pathname === '/auth/v1/verify' && method === 'POST') {
      const mail = db.outbox.find((m) => !m.used && m.type === (body && body.type) && sameEmail(m.to, body && body.email) && m.otp === String((body && body.token) || ''));
      if (!mail) return authErr(route, 403, 'otp_expired', 'Token has expired or is invalid');
      mail.used = true;
      return reply(route, 200, session(db, db.users.get(mail.to)));
    }
    if (url.pathname === '/auth/v1/user') {
      if (!uid) return authErr(route, 401, 'bad_jwt', 'invalid JWT');
      const u = db.userById(uid);
      if (method === 'PUT' && body && typeof body.password === 'string') u.password = body.password;
      return reply(route, 200, userJson(u));
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
