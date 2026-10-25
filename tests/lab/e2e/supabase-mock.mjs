/**
 * RATEOS Test Lab — Supabase SIMULADO para la auditoría en navegador (PLAN-2026-013).
 *
 * Intercepta en Playwright todo lo que va al proyecto de Supabase (GoTrue +
 * PostgREST): la base real nunca recibe un pedido (staging comparte la base con
 * producción). Emula las políticas RLS de la migración: cada consulta sólo ve y
 * modifica filas de las organizaciones de las que el usuario del token es
 * miembro. Usuarios, organizaciones y tokens son sintéticos y viven en memoria.
 *
 * Correos de Auth (HD-03): el registro público deja en db.outbox el correo de
 * confirmación (enlace /verify PKCE) y "¿Olvidaste tu contraseña?" el de
 * recuperación (enlace + código de 6 dígitos), sólo si corresponde, como
 * Supabase: un email ya registrado recibe la misma respuesta y ningún correo;
 * sin confirmar no se puede ingresar. db.smtp.mode simula el SMTP: 'custom' (entrega todo),
 * 'default' (SMTP por defecto: sólo al equipo, db.smtp.team) o 'broken'.
 * El enlace sigue el flujo PKCE real (code_challenge → ?code= → canje con el
 * code_verifier) y el código, verifyOtp type 'recovery'. Nada sale a internet.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    // ---- Feedback de la beta (PLAN-2026-029), como la migración 20261022120000.
    /** private.feedback (+ historial de private.feedback_events). */
    feedback: [],
    /** RATEOS_ADMIN (private.platform_admins). */
    admins: new Set(),
  };
  db.createUser = ({ email, password, fullName, company, confirmed = true }) => {
    const id = randomUUID();
    const orgId = randomUUID();
    const now = new Date().toISOString();
    db.users.set(email, { id, email, password, fullName, company, confirmed, createdAt: now });
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
    email_confirmed_at: u.confirmed === false ? null : now,
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
const CATEGORIES = ['calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro'];
const SCREENS = ['inicio', 'nuevo', 'cotizacion', 'resultado', 'escenarios', 'cotizaciones', 'productos', 'producto', 'recursos', 'plantillas', 'configuracion', 'cuenta', 'registro', 'pdf', 'otra'];
const REVIEW = ['in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate'];
const cleanText = (v) => String(v ?? '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim();
const optional = (v) => cleanText(v) || null;

/** RPC del feedback y de RATEOS ADMIN, con las mismas reglas que las funciones de las migraciones. */
function platformRpc(db, route, name, args, uid, memberOrgs) {
  const forbidden = () => reply(route, 403, { code: '42501', message: 'forbidden' });
  const fail = (message) => reply(route, 400, { code: 'P0001', message, details: null, hint: null });
  const isAdmin = db.admins.has(uid);
  const email = (id) => (db.userById(id) || {}).email || null;
  const member = (org) => typeof org === 'string' && memberOrgs.has(org);
  if (name === 'am_i_platform_admin') return reply(route, 200, isAdmin);
  if (name === 'submit_feedback') {
    if (!member(args.p_org)) return forbidden();
    const kind = args.p_kind;
    const category = args.p_category || 'otro';
    const f = { message: cleanText(args.p_message), details: optional(args.p_details), expected: kind === 'problem' ? optional(args.p_expected) : null };
    const within = (t) => !t || t.length <= 2000;
    if (!['problem', 'suggestion'].includes(kind) || !CATEGORIES.includes(category) || !SCREENS.includes(args.p_screen) || !/^[0-9A-Za-z.+-]{1,40}$/.test(String(args.p_app_version || ''))
      || f.message.length < 3 || f.message.length > 2000 || !within(f.details) || !within(f.expected)) return fail('rateos_feedback_invalid');
    const day = Date.now() - 86400000;
    if (db.feedback.filter((x) => x.author === uid && x.at > day).length >= 5 || db.feedback.filter((x) => x.organization_id === args.p_org && x.at > day).length >= 10) return fail('rateos_feedback_rate_limited');
    if (db.feedback.filter((x) => x.organization_id === args.p_org && ['received', 'in_review'].includes(x.status)).length >= 20) return fail('rateos_feedback_too_many_open');
    if (db.feedback.some((x) => x.organization_id === args.p_org && x.kind === kind && x.message === f.message && x.details === f.details && x.expected === f.expected)) return fail('rateos_feedback_duplicate');
    const now = new Date().toISOString();
    const item = { id: randomUUID(), organization_id: args.p_org, author: uid, kind, category, screen: args.p_screen, app_version: args.p_app_version, ...f, status: 'received', created_at: now, at: Date.now(), response: null, reviewed_at: null, reviewed_by: null, duplicate_of: null, history: [{ at: now, actor: uid, from: null, to: 'received', response: null }] };
    db.feedback.push(item);
    return reply(route, 200, { id: item.id, kind, status: 'received', created_at: now });
  }
  if (name === 'my_feedback') {
    if (!member(args.p_org)) return forbidden();
    return reply(route, 200, db.feedback.filter((r) => r.organization_id === args.p_org).slice().reverse().map((r) => ({
      id: r.id, created_at: r.created_at, kind: r.kind, category: r.category, screen: r.screen, app_version: r.app_version, message: r.message, details: r.details, expected: r.expected,
      status: r.status, response: r.response, reviewed_at: r.reviewed_at, mine: r.author === uid,
    })));
  }
  // ---- RATEOS ADMIN: sólo metadata y el texto del feedback; nunca el workspace.
  if (['admin_overview', 'admin_users', 'admin_feedback', 'admin_review_feedback'].includes(name) && !isAdmin) return forbidden();
  if (name === 'admin_overview') {
    return reply(route, 200, { users_total: db.users.size, users_confirmed: db.users.size, users_7d: db.users.size, users_30d: db.users.size, organizations_total: db.orgs.size, workspaces_total: db.workspaces.size, workspaces_active_30d: [...db.workspaces.values()].filter((w) => w.revision > 0).length, generated_at: new Date().toISOString() });
  }
  if (name === 'admin_users') {
    return reply(route, 200, db.members.map((m) => ({ full_name: (db.profiles.get(m.user_id) || {}).full_name || '', email: email(m.user_id), email_confirmed: true, organization_name: db.orgs.get(m.organization_id).name, organization_role: m.role, organization_members: db.members.filter((x) => x.organization_id === m.organization_id).length, workspace_revision: db.workspaces.get(m.organization_id).revision, is_platform_admin: db.admins.has(m.user_id) })));
  }
  if (name === 'admin_feedback') {
    const st = args.p_status ?? null;
    const kind = args.p_kind ?? null;
    const rows = db.feedback.filter((r) => (kind === null || r.kind === kind) && (st === null || (st === 'open' ? ['received', 'in_review', 'confirmed'].includes(r.status) : r.status === st)));
    return reply(route, 200, rows.slice().reverse().map((r) => ({
      id: r.id, created_at: r.created_at, organization_name: db.orgs.get(r.organization_id).name, author_email: email(r.author), kind: r.kind, category: r.category, screen: r.screen, app_version: r.app_version,
      message: r.message, details: r.details, expected: r.expected, status: r.status, duplicate_of: r.duplicate_of, response: r.response, reviewed_at: r.reviewed_at, reviewer_email: email(r.reviewed_by),
      similar_count: db.feedback.filter((s) => s.id !== r.id && s.kind === r.kind && s.category === r.category && s.screen === r.screen && s.status !== 'not_applicable').length,
      history: r.history.map((e) => ({ ...e, actor: email(e.actor) })),
    })));
  }
  if (name === 'admin_review_feedback') {
    const r = db.feedback.find((x) => x.id === args.p_feedback);
    if (!REVIEW.includes(args.p_status)) return fail('rateos_feedback_invalid');
    if (!r) return fail('rateos_feedback_not_found');
    if (args.p_status === 'duplicate' && (!args.p_duplicate_of || args.p_duplicate_of === r.id || !db.feedback.some((x) => x.id === args.p_duplicate_of && x.status !== 'duplicate'))) return fail('rateos_feedback_invalid');
    const response = cleanText(args.p_response).slice(0, 1000) || null;
    if (r.status === args.p_status && !response && (args.p_status !== 'duplicate' || r.duplicate_of === args.p_duplicate_of)) return reply(route, 200, { status: r.status, changed: false });
    const from = r.status;
    Object.assign(r, { status: args.p_status, duplicate_of: args.p_status === 'duplicate' ? args.p_duplicate_of : null, response: response || r.response, reviewed_by: uid, reviewed_at: new Date().toISOString() });
    r.history.push({ at: new Date().toISOString(), actor: uid, from, to: args.p_status, response });
    return reply(route, 200, { status: args.p_status, changed: true });
  }
  return reply(route, 404, { code: 'PGRST202', message: `Could not find the function public.${name}` });
}

/**
 * Sólo para pruebas (2026-10-25): la versión publicada sale con la beta por
 * invitación (FEATURES.publicSignup = false) hasta tener SMTP propio. Para seguir
 * probando el alta completa "para cuando se reabra", sirve el config.js del build
 * con el registro público encendido. Lee el archivo del disco (dist/) y cambia
 * sólo esa bandera; si no la encuentra, lo sirve igual y la prueba de registro
 * falla a la vista (nunca prueba en silencio otra cosa).
 * @param {import('playwright').BrowserContext} context
 * @param {{ base: string, distRoot: string }} options
 */
export async function enablePublicSignupForTests(context, { base, distRoot }) {
  const prefix = new URL(base).pathname;
  await context.route((u) => u.href.startsWith(base) && /\/js\/config\.js$/.test(u.pathname), async (route) => {
    const rel = new URL(route.request().url()).pathname.slice(prefix.length);
    const file = path.join(distRoot, rel);
    if (!file.startsWith(distRoot)) return route.abort();
    const body = readFileSync(file, 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: body.replace('publicSignup: false,', 'publicSignup: true,') });
  });
}

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
      if (mail.type === 'signup') db.users.get(mail.to).confirmed = true; // el enlace confirma el email aunque se abra en otro navegador
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
        // Como GoTrue: "sin confirmar" recién después de validar la contraseña (no revela cuentas).
        if (u.confirmed === false) return authErr(route, 400, 'email_not_confirmed', 'Email not confirmed');
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
    // Registro público con confirmación (como GoTrue con "Confirm email" encendido).
    const mailTo = (u, type) => {
      for (const m of db.outbox) if (m.to === u.email && m.type === type) m.used = true;
      db.outbox.push({
        to: u.email,
        type,
        otp: String(randomInt(0, 1000000)).padStart(6, '0'),
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        redirectTo: url.searchParams.get('redirect_to'),
        challenge: (body && body.code_challenge) || null,
        method: String((body && body.code_challenge_method) || 's256').toLowerCase(),
        used: false,
        at: Date.now(),
      });
    };
    const smtpFails = (email) => {
      if (db.smtp.mode === 'default' && !db.smtp.team.some((t) => sameEmail(t, email))) return ['email_address_not_authorized', 400, 'Email address not authorized'];
      if (db.smtp.mode === 'broken') return ['unexpected_failure', 500, 'Error sending confirmation email'];
      return null;
    };
    if (url.pathname === '/auth/v1/signup' && method === 'POST') {
      const email = String((body && body.email) || '').trim().toLowerCase();
      if (String((body && body.password) || '').length < 6) return authErr(route, 422, 'weak_password', 'Password should be at least 6 characters.');
      const existing = [...db.users.values()].find((x) => sameEmail(x.email, email));
      if (existing && existing.confirmed !== false) {
        // Ya registrado y confirmado: usuario "de mentira", sin identidades y sin correo.
        return reply(route, 200, { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email, identities: [], user_metadata: {}, app_metadata: { provider: 'email', providers: ['email'] }, created_at: new Date().toISOString() });
      }
      const fail = smtpFails(email);
      if (fail) return authErr(route, fail[1], fail[0], fail[2]); // GoTrue no crea la cuenta si no pudo enviar.
      const last = existing && db.outbox.filter((m) => m.to === existing.email && m.type === 'signup').at(-1);
      if (last && Date.now() - last.at < 60000) return authErr(route, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
      const data = (body && body.data) || {};
      const u = existing || db.createUser({ email, password: body.password, fullName: data.full_name, company: data.company || 'Mi empresa', confirmed: false });
      mailTo(u, 'signup');
      return reply(route, 200, userJson(u));
    }
    if (url.pathname === '/auth/v1/resend' && method === 'POST') {
      const u = [...db.users.values()].find((x) => sameEmail(x.email, body && body.email));
      if (!u || u.confirmed !== false || (body && body.type) !== 'signup') return reply(route, 200, {});
      const fail = smtpFails(u.email);
      if (fail) return authErr(route, fail[1], fail[0], fail[2]);
      const last = db.outbox.filter((m) => m.to === u.email && m.type === 'signup').at(-1);
      if (last && Date.now() - last.at < 60000) return authErr(route, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.');
      mailTo(u, 'signup');
      return reply(route, 200, {});
    }
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
      if (method === 'POST' && table.startsWith('rpc/')) return platformRpc(db, route, table.slice('rpc/'.length), body || {}, uid, memberOrgs);
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
