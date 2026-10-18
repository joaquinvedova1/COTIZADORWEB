#!/usr/bin/env node
/**
 * RATEOS — prueba A/B REAL contra Supabase (PLAN-2026-016, punto 4).
 *
 * NUNCA corre en CI ni dentro de npm test: usa la base real. Sólo acepta
 * cuentas SINTÉTICAS (email @rateos.invalid) y nunca lee datos de otras
 * cuentas: cada actor ve únicamente lo que RLS le devuelve.
 *
 * Antes: las dos cuentas (supabase/tests/live_ab.sql, bloque 1, o el
 * Dashboard: Add user → Create new user, Auto Confirm) y `npm run build`.
 *
 *   RATEOS_LIVE_A_EMAIL=perimetro-a@rateos.invalid RATEOS_LIVE_A_PASSWORD=… \
 *   RATEOS_LIVE_B_EMAIL=perimetro-b@rateos.invalid RATEOS_LIVE_B_PASSWORD=… \
 *   node tests/live/perimeter-ab.mjs
 *
 * Qué verifica (Supabase real; la app compilada en un navegador real):
 * - Navegador: A ingresa y la app guarda su espacio de trabajo; A cierra
 *   sesión y no queda nada de A (pantalla, DOM, sesión del navegador); B
 *   ingresa en la MISMA pestaña, ve lo suyo y nada de A; la app guarda el
 *   espacio de B; B cierra sesión.
 * - API con los JWT reales de A y de B, en las dos direcciones y con los IDs
 *   conocidos de la otra empresa: leer, actualizar, crear, borrar y RPC de
 *   admin → nada; sin filtro cada uno ve sólo lo suyo; guardar con la
 *   revisión vigente sí y con una vieja no; anon no lee; el logout revoca el
 *   refresh token.
 *
 * Escribe reports/live/perimeter-ab-<fecha>.{json,md} SIN emails, tokens,
 * contraseñas ni ids (actores "A" y "B"). Después: bloque 3 (verificar) y,
 * con autorización del dueño, bloque 4 (limpieza) de live_ab.sql.
 * Código de salida 1 si algún control falla; 2 si falta algo para correr.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SUPABASE } from '../../js/config.js';
import { createStaticServer } from '../../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const SYNTHETIC_EMAIL = /^[a-z0-9._%+-]+@rateos\.invalid$/i;

/** ¿Es una cuenta sintética? (dominio reservado: nunca una persona real). */
export function isSyntheticEmail(email) {
  return typeof email === 'string' && SYNTHETIC_EMAIL.test(email.trim());
}

/**
 * Cuentas A y B desde el entorno. Se niega con cualquier cuenta que no sea
 * sintética, con una sola cuenta o con A = B. Los mensajes nunca incluyen
 * emails ni contraseñas.
 */
export function syntheticAccounts(env = process.env) {
  const read = (label) => ({
    email: String(env[`RATEOS_LIVE_${label}_EMAIL`] || '').trim(),
    password: String(env[`RATEOS_LIVE_${label}_PASSWORD`] || ''),
  });
  const a = read('A');
  const b = read('B');
  for (const [label, acc] of [['A', a], ['B', b]]) {
    if (!acc.email || !acc.password) throw new Error(`Faltan RATEOS_LIVE_${label}_EMAIL y RATEOS_LIVE_${label}_PASSWORD.`);
    if (!isSyntheticEmail(acc.email)) throw new Error(`La cuenta ${label} no es sintética: el email tiene que terminar en @rateos.invalid.`);
  }
  if (a.email.toLowerCase() === b.email.toLowerCase()) throw new Error('A y B tienen que ser dos cuentas distintas.');
  return { a, b };
}

/** El reporte nunca lleva datos sensibles (emails, contraseñas, tokens, ids). */
export function assertNoSecrets(text, secrets) {
  const leaked = (secrets || []).filter((s) => typeof s === 'string' && s.length >= 6 && String(text).includes(s));
  if (leaked.length) throw new Error('El reporte contiene datos sensibles: no se escribe.');
}

/** ¿La respuesta no dio acceso? (error HTTP, o 0 filas). */
export function denied(res) {
  return Boolean(res) && (res.status >= 400 || (Array.isArray(res.body) && res.body.length === 0));
}

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Cliente REST mínimo de Supabase (PostgREST y Auth) con la publishable key. */
function client(token = null) {
  const headers = (extra = {}) => ({ apikey: SUPABASE.publishableKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });
  const call = async (method, rel, body) => {
    const res = await fetch(`${SUPABASE.url}/rest/v1/${rel}`, {
      method,
      headers: headers(body !== undefined ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : { Prefer: 'return=representation' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await json(res) };
  };
  return {
    get: (rel) => call('GET', rel),
    patch: (rel, body) => call('PATCH', rel, body),
    post: (rel, body) => call('POST', rel, body),
    del: (rel) => call('DELETE', rel),
    rpc: (name, body = {}) => call('POST', `rpc/${name}`, body),
  };
}

async function auth(pathQ, body, token = null) {
  const res = await fetch(`${SUPABASE.url}/auth/v1/${pathQ}`, {
    method: 'POST',
    headers: { apikey: SUPABASE.publishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await json(res) };
}

async function signIn({ email, password }) {
  const res = await auth('token?grant_type=password', { email, password });
  if (res.status !== 200 || !res.body || !res.body.access_token) throw new Error(`No se pudo ingresar con una cuenta sintética (HTTP ${res.status}).`);
  return { access: res.body.access_token, refresh: res.body.refresh_token, userId: res.body.user && res.body.user.id };
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

async function main() {
  let accounts;
  try {
    accounts = syntheticAccounts();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const playwright = loadPlaywright();
  if (!playwright) {
    process.stderr.write('Falta Playwright (no es dependencia de RATEOS): PLAYWRIGHT_MODULE=<ruta>/node_modules/playwright\n');
    process.exitCode = 2;
    return;
  }
  const dist = path.join(ROOT, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    process.stderr.write('Falta dist/: corré "npm run build" antes.\n');
    process.exitCode = 2;
    return;
  }

  const results = [];
  const check = (area, name, ok, detail = '') => {
    results.push({ area, check: name, ok: Boolean(ok), detail: ok ? '' : String(detail) });
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} ${area} · ${name}${ok ? '' : ` — ${detail}`}\n`);
  };
  const secrets = [accounts.a.email, accounts.a.password, accounts.b.email, accounts.b.password];

  // ------------------------------------------------ navegador (app real)
  const server = createStaticServer({ root: dist });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Un host propio (no "localhost"): la app no se comporta como servidor local.
  const base = `http://rateos.test:${server.address().port}/COTIZADORWEB/`;
  const browser = await playwright.chromium.launch({ args: ['--host-resolver-rules=MAP rateos.test 127.0.0.1'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const offSite = [];
  await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith(SUPABASE.url), (r) => {
    offSite.push(new URL(r.request().url()).host);
    return r.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const go = async (hash, wait = 800) => {
    await page.evaluate((x) => { window.location.hash = x; }, hash);
    await page.waitForTimeout(wait);
  };
  const login = async ({ email, password }) => {
    await go('#/login', 1000);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForTimeout(4000);
  };
  const logout = async () => {
    await go('#/inicio', 800);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cerrar sesión');
      if (btn) btn.click();
    });
    await page.waitForTimeout(2000);
  };
  const snapshot = () => page.evaluate(() => ({
    visible: document.body.innerText,
    all: document.body.textContent,
    session: localStorage.getItem('rateos.auth'),
    hash: window.location.hash,
  }));
  /** Revisión del espacio propio vista con un token real (RLS). */
  const ownWorkspace = async (token) => {
    const res = await client(token).get('workspace_states?select=id,organization_id,revision,schema_version,state');
    return Array.isArray(res.body) && res.body.length === 1 ? res.body[0] : null;
  };
  const waitSaved = async (token) => {
    for (let i = 0; i < 20; i += 1) {
      const ws = await ownWorkspace(token);
      if (ws && ws.revision > 0 && ws.state) return ws;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  };

  try {
    await page.goto(base);
    const apiA = await signIn(accounts.a);
    const apiB = await signIn(accounts.b);

    await login(accounts.a);
    const asA = await snapshot();
    check('NAV-A', 'A ingresa y abre su cuenta', /^#\/(inicio|bienvenida|nuevo)/.test(asA.hash) && asA.all.includes(accounts.a.email), `ruta ${asA.hash}`);
    const wsA = await waitSaved(apiA.access);
    check('NAV-A', 'la app guardó el espacio de trabajo de A en la nube (revisión > 0)', Boolean(wsA), 'sin guardado');
    await logout();
    const out = await snapshot();
    check('NAV-A', 'al cerrar sesión no queda nada de A en pantalla', !out.visible.includes(accounts.a.email), 'quedó el email de A');
    check('NAV-A', 'ni en el DOM oculto', !out.all.includes(accounts.a.email), 'quedó el email de A');
    check('NAV-A', 'la sesión se borró del navegador', out.session === null, 'quedó rateos.auth');

    await login(accounts.b);
    const asB = await snapshot();
    check('NAV-B', 'B ingresa en la misma pestaña y ve su cuenta', asB.all.includes(accounts.b.email), 'no aparece la cuenta de B');
    check('NAV-B', 'B no ve nada de A (pantalla y DOM)', !asB.all.includes(accounts.a.email), 'aparece la cuenta de A');
    const wsB = await waitSaved(apiB.access);
    check('NAV-B', 'la app guardó el espacio de trabajo de B en la nube', Boolean(wsB), 'sin guardado');
    await logout();
    const outB = await snapshot();
    check('NAV-B', 'al cerrar sesión no queda nada de B', !outB.all.includes(accounts.b.email) && outB.session === null, 'quedó algo de B');
    check('NAV', 'sin errores de la app ni pedidos fuera del sitio y de Supabase', pageErrors.length === 0 && offSite.length === 0, `${pageErrors.length} errores, ${offSite.length} pedidos`);

    // --------------------------------------- API con JWT reales (A↔B)
    if (wsA && wsB) {
      const pairs = [
        ['A→B', apiA, wsA, apiB, wsB],
        ['B→A', apiB, wsB, apiA, wsA],
      ];
      for (const [lbl, me, mine, them, theirs] of pairs) {
        const api = client(me.access);
        const all = await api.get('workspace_states?select=id');
        check(lbl, 'sin filtro ve sólo su espacio (1 fila)', Array.isArray(all.body) && all.body.length === 1 && all.body[0].id === mine.id, `HTTP ${all.status}`);
        check(lbl, 'no lee el espacio ajeno por organización', denied(await api.get(`workspace_states?select=id&organization_id=eq.${theirs.organization_id}`)));
        check(lbl, 'no lee el espacio ajeno por id', denied(await api.get(`workspace_states?select=id&id=eq.${theirs.id}`)));
        check(lbl, 'no lee la organización ajena', denied(await api.get(`organizations?select=id&id=eq.${theirs.organization_id}`)));
        check(lbl, 'no lee membresías ni perfil ajenos', denied(await api.get(`organization_members?select=user_id&organization_id=eq.${theirs.organization_id}`)) && denied(await api.get(`profiles?select=id&id=eq.${them.userId}`)));
        check(lbl, 'no modifica el espacio ajeno (por organización ni por id)', denied(await api.patch(`workspace_states?organization_id=eq.${theirs.organization_id}`, { state: { intento: lbl } })) && denied(await api.patch(`workspace_states?id=eq.${theirs.id}`, { state: { intento: lbl } })));
        check(lbl, 'no crea un espacio con la organización ajena', denied(await api.post('workspace_states', { organization_id: theirs.organization_id, state: { intento: lbl } })));
        check(lbl, 'no borra el espacio ajeno', denied(await api.del(`workspace_states?organization_id=eq.${theirs.organization_id}`)));
        check(lbl, 'no usa las funciones de RATEOS ADMIN', denied(await api.rpc('admin_users')));
        // Guardado real con control de revisión: vigente sí, vieja no (se relee
        // justo antes: la app pudo volver a guardar antes de cerrar sesión).
        const current = await ownWorkspace(me.access);
        const saved = current
          ? await api.patch(`workspace_states?organization_id=eq.${current.organization_id}&revision=eq.${current.revision}`, { state: current.state, schema_version: current.schema_version })
          : { status: 0, body: null };
        const savedRow = Array.isArray(saved.body) ? saved.body[0] : null;
        check(lbl, 'guarda su espacio con la revisión vigente (revisión + 1)', Boolean(savedRow) && savedRow.revision === current.revision + 1, `HTTP ${saved.status}`);
        check(lbl, 'un guardado con la revisión vieja no pisa nada', Boolean(current) && denied(await api.patch(`workspace_states?organization_id=eq.${current.organization_id}&revision=eq.${current.revision}`, { state: current.state })));
      }
      const anon = client(null);
      check('anon', 'sin sesión no lee ningún espacio', denied(await anon.get('workspace_states?select=id')));
      const after = await ownWorkspace(apiA.access);
      check('integridad', 'el espacio de A sigue siendo de A y sin nada de B', Boolean(after) && !JSON.stringify(after.state).includes(wsB.organization_id) && !JSON.stringify(after.state).includes('intento'), 'contenido inesperado');
    }

    // ---------------------------------------------------- logout real
    const out204 = await auth('logout', {}, apiA.access);
    check('logout', 'Supabase cierra la sesión de A', out204.status === 204 || out204.status === 200, `HTTP ${out204.status}`);
    const reuse = await auth('token?grant_type=refresh_token', { refresh_token: apiA.refresh });
    check('logout', 'el refresh token de A ya no sirve', reuse.status >= 400, `HTTP ${reuse.status}`);
    await auth('logout', {}, apiB.access);
  } catch (error) {
    check('ejecución', 'la prueba corrió completa', false, error && error.message ? error.message : 'error');
  } finally {
    await browser.close();
    server.close();
  }

  const ok = results.every((r) => r.ok);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(ROOT, 'reports', 'live');
  mkdirSync(outDir, { recursive: true });
  const md = [
    '# RATEOS — prueba A/B real contra Supabase (PLAN-2026-016)',
    '',
    `- Fecha: ${new Date().toISOString()} · resultado: **${ok ? 'PASA' : 'NO PASA'}** (${results.filter((r) => r.ok).length}/${results.length})`,
    '- Cuentas sintéticas (A y B, @rateos.invalid); sin emails, tokens, contraseñas ni ids en este reporte.',
    '',
    '| Área | Control | Estado | Detalle |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.area} | ${r.check} | ${r.ok ? 'OK' : 'FALLA'} | ${r.detail.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
  const jsonText = `${JSON.stringify({ test: 'perimeter-ab', plan: 'PLAN-2026-016', ok, results }, null, 2)}\n`;
  assertNoSecrets(md + jsonText, secrets);
  writeFileSync(path.join(outDir, `perimeter-ab-${stamp}.md`), md);
  writeFileSync(path.join(outDir, `perimeter-ab-${stamp}.json`), jsonText);
  process.stdout.write(`\n${ok ? 'PRUEBA A/B REAL: PASA' : 'PRUEBA A/B REAL: NO PASA'} — reports/live/perimeter-ab-${stamp}.md\n`);
  process.exitCode = ok ? 0 : 1;
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) await main();
