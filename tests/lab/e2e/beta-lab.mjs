#!/usr/bin/env node
/**
 * RATEOS Test Lab — beta gratuita y feedback en NAVEGADOR (PLAN-2026-029).
 * SIMULADO: Supabase lo imita supabase-mock.mjs con las mismas reglas que la
 * migración 20261022120000 (feedback, límites contra el spam y revisión de
 * RATEOS ADMIN). La base real nunca recibe un pedido.
 *
 *   npm run build && node tests/lab/e2e/beta-lab.mjs            escritorio y celular
 *   node tests/lab/e2e/beta-lab.mjs --mode=mobile               uno solo
 *
 * Recorre: crear sin límites ni contadores (más de 10 cotizaciones, un
 * producto y un duplicado), el distintivo "Beta gratuita" y "Acerca de la
 * beta", la invitación discreta después de exportar el PDF (no se repite),
 * reportar un problema y sugerir una mejora desde el menú, verlo como colega,
 * clasificarlo y responderlo como RATEOS ADMIN, ver la respuesta, y que nadie
 * lo haga por la API sin permisos.
 * Escribe reports/lab/e2e/beta-lab-report.{json,md}.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../scripts/serve.mjs';
import { assertSafeReport } from '../lib/report.js';
import { createDb, installSupabaseMock, SUPA } from './supabase-mock.mjs';
import { SUPABASE } from '../../../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const THANKS = 'Gracias por ayudarnos a mejorar RATEOS. Recibimos tu comentario y vas a poder seguir su estado acá abajo.';
/** Textos del esquema de créditos que ya no existe: no pueden aparecer en ninguna pantalla. */
const CREDITS_TEXT = /cálculos? (nuevos? )?de prueba|Se agotaron|Te queda|créditos de prueba|\+2/i;

function parseArgs(argv) {
  const out = { modes: ['desktop', 'mobile'], out: 'reports/lab/e2e' };
  for (const a of argv) {
    if (a.startsWith('--mode=')) out.modes = [a.slice(7)];
    else if (a.startsWith('--out=')) out.out = a.slice(6);
  }
  return out;
}

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try {
      return require(id);
    } catch {
      // siguiente candidato
    }
  }
  process.stderr.write('Playwright no está instalado (ver tests/lab/e2e/ui-lab.mjs).\n');
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const dist = path.join(ROOT, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write('Falta dist/: corré "npm run build" antes.\n');
  process.exit(2);
}
const { chromium } = loadPlaywright();
const server = createStaticServer({ root: dist });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://rateos.test:${server.address().port}/COTIZADORWEB/`;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP rateos.test 127.0.0.1'] });
const outDir = path.resolve(ROOT, args.out);
if (!outDir.startsWith(ROOT + path.sep)) throw new Error('--out tiene que quedar dentro del repo.');
mkdirSync(outDir, { recursive: true });

const results = [];
const norm = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Llama una RPC de Supabase con la sesión de esa página (como lo haría alguien desde DevTools). */
function rpcFromPage(page, name, body) {
  return page.evaluate(async ({ supa, key, fn, payload }) => {
    const raw = window.sessionStorage.getItem('rateos.auth') || window.localStorage.getItem('rateos.auth');
    const tok = raw ? JSON.parse(raw).access_token : '';
    const r = await window.fetch(`${supa}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    let parsed = null;
    try {
      parsed = await r.json();
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed };
  }, { supa: SUPA, key: SUPABASE.publishableKey, fn: name, payload: body });
}

async function runMode(mode) {
  const viewport = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1360, height: 900 };
  const db = createDb();
  const errors = [];
  const blocked = [];
  const contexts = [];
  const check = (scenario, name, ok, detail = '') => {
    // Sin emails en el reporte (las cuentas son sintéticas, pero el reporte no lleva ninguno).
    const safe = ok ? '' : String(detail).replace(/[\w.+-]+@[\w.-]+/g, '<email>');
    results.push({ mode, scenario, check: name, ok: Boolean(ok), detail: safe });
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} [${mode}] ${scenario} · ${name}${ok ? '' : ` — ${safe}`}\n`);
  };

  async function open(email, password) {
    const context = await browser.newContext({ viewport, ...(mode === 'mobile' ? { hasTouch: true, isMobile: true } : {}) });
    contexts.push(context);
    await installSupabaseMock(context, db);
    await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith(SUPA), (r) => {
      blocked.push(r.request().url());
      return r.abort();
    });
    // El diálogo de impresión del navegador no se abre en el lab: se cuenta.
    await context.addInitScript(() => {
      window.print = () => { window.__printed = (window.__printed || 0) + 1; };
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console ${m.text()}`);
    });
    await page.goto(`${base}#/login`);
    await page.waitForTimeout(800);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForTimeout(2500);
    return page;
  }
  const helpers = (page) => ({
    go: async (hash, wait = 900) => {
      await page.evaluate((x) => { window.location.hash = x; }, hash);
      await page.waitForTimeout(wait);
    },
    tap: async (loc) => {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      if (mode === 'mobile') await loc.tap();
      else await loc.click();
    },
    text: () => page.evaluate(() => document.body.innerText),
    toasts: () => page.evaluate(() => [...document.querySelectorAll('.toast-text')].map((t) => t.textContent).join(' | ')),
    clearToasts: () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove())),
    // Como ui-lab: en un contexto isMobile, Chromium agranda innerWidth hasta el contenido y
    // scrollWidth - innerWidth da 0 aunque la página se desplace de costado (K0C-02).
    overflow: () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth, 0)),
    /** En el celular, los enlaces de la cuenta están en el menú. */
    menu: async () => {
      if (mode !== 'mobile') return;
      const toggle = page.locator('.menu-toggle').first();
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.tap();
        await page.waitForTimeout(500);
      }
    },
  });

  // ---------------------------------------------------- cuentas sintéticas
  const pw = () => `lab-${randomUUID()}`;
  const admin = { email: `beta.admin.${mode}@rateos.test`, password: pw() };
  db.createUser({ ...admin, fullName: 'Admin sintético', company: 'Plataforma sintética' });
  db.admins.add(db.users.get(admin.email).id);
  // Email largo pero plausible (break-ui): el panel admin lo muestra como autor (K0C-02).
  const tester = { email: `bartolome.fitzgerald.administracion.${mode}@serviciospetrolerosintegrales-altovalle.rateos.test`, password: pw() };
  db.createUser({ ...tester, fullName: 'Tester sintético', company: 'Tester Sintética SRL' });
  const colleague = { email: `beta.colega.${mode}@rateos.test`, password: pw() };
  db.createUser({ ...colleague, fullName: 'Colega sintético', company: 'Propia del colega' });
  const orgT = db.orgOf(db.users.get(tester.email).id);
  // El colega es miembro SÓLO de la empresa tester (como un ESTIMATOR invitado).
  const colleagueId = db.users.get(colleague.email).id;
  const colleagueOwnOrg = db.orgOf(colleagueId);
  db.members = db.members.filter((m) => m.user_id !== colleagueId);
  db.orgs.delete(colleagueOwnOrg);
  db.workspaces.delete(colleagueOwnOrg);
  db.members.push({ organization_id: orgT, user_id: colleagueId, role: 'ESTIMATOR', created_at: new Date().toISOString() });
  const wsT = () => db.workspaces.get(orgT);
  const quotesT = () => ((wsT().state && wsT().state.quotes) || []);
  const productsT = () => ((wsT().state && wsT().state.products) || []);

  // ------------------------------------------------- beta gratuita sin límites
  const page = await open(tester.email, tester.password);
  const t = helpers(page);
  const seen = [];
  for (const hash of ['#/nuevo', '#/cotizaciones/nueva', '#/productos/nuevo', '#/cotizaciones']) {
    await t.go(hash, 1200);
    seen.push(await t.text());
  }
  check('sin límites', 'ninguna pantalla de crear muestra saldos, cupos ni créditos', !seen.some((x) => CREDITS_TEXT.test(x)), norm(seen.find((x) => CREDITS_TEXT.test(x)) || '').slice(0, 200));
  const disabledChoices = await page.evaluate(() => [...document.querySelectorAll('.quote-choice, .calc-choice')].filter((b) => b.disabled || b.getAttribute('aria-disabled') === 'true').length);
  check('sin límites', 'ninguna opción de crear está deshabilitada', disabledChoices === 0, `${disabledChoices} deshabilitadas`);
  for (let i = 0; i < 11; i += 1) {
    await t.go('#/inicio', 400);
    await t.go('#/cotizaciones/nueva', 900);
    await t.tap(page.locator('.quote-choice-blank').first());
    await page.waitForTimeout(1300);
  }
  check('sin límites', 'once cotizaciones nuevas (más que el viejo cupo de 10) se guardan en la nube', quotesT().length === 11, `${quotesT().length} cotizaciones`);
  await t.go('#/productos/nuevo', 1000);
  await t.tap(page.locator('.quote-choice-blank').first());
  await page.waitForTimeout(1500);
  check('sin límites', 'un producto nuevo también', productsT().length === 1, `${productsT().length} productos`);
  await t.go('#/cotizaciones', 1500);
  await t.clearToasts();
  await t.tap(page.getByRole('button', { name: /^Más opciones/ }).first());
  await page.waitForTimeout(600);
  await t.tap(page.getByRole('dialog').getByRole('button', { name: 'Duplicar' }));
  await page.waitForTimeout(1500);
  check('sin límites', 'duplicar funciona y no habla de créditos', quotesT().length === 12 && !CREDITS_TEXT.test(await t.toasts()), `${quotesT().length} cotizaciones · ${await t.toasts()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ------------------------------------------------- distintivo y acerca de la beta
  await t.go('#/inicio', 1000);
  await t.menu();
  const pill = page.locator('.beta-pill').first();
  const pillInfo = await pill.evaluate((el) => ({ text: el.textContent.trim(), href: el.getAttribute('href'), visible: el.getBoundingClientRect().height > 0 }));
  check('beta', 'el distintivo "Beta gratuita" está a la vista y lleva a "Acerca de la beta"', pillInfo.visible && /Beta gratuita/.test(pillInfo.text) && pillInfo.href === '#/mejorar?acerca=1', JSON.stringify(pillInfo));
  await t.tap(pill);
  await page.waitForTimeout(1500);
  const about = await page.evaluate(() => {
    const d = document.getElementById('acerca-beta');
    return d ? { open: d.open, text: d.innerText } : null;
  });
  check('beta', '"Acerca de la beta" abierta: gratis y sin límites, sin prometer beneficios', about && about.open && /gratuito y sin límites/.test(about.text) && /no da premios ni beneficios/.test(about.text), JSON.stringify(about).slice(0, 300));

  // ------------------------------------------- invitación después de exportar
  const quote = quotesT()[0];
  await t.go(`#/cotizaciones/${encodeURIComponent(quote.id)}/result`, 1800);
  check('invitación', 'antes de exportar no hay ninguna invitación', (await page.locator('.feedback-invite').count()) === 0, 'apareció antes de terminar la tarea');
  await t.tap(page.getByRole('button', { name: 'Imprimir resumen (1 hoja)' }));
  await page.waitForTimeout(600);
  const invite = await page.evaluate(() => {
    const el = document.querySelector('.feedback-invite');
    return el ? { text: el.innerText, modal: Boolean(el.closest('dialog')), printed: window.__printed || 0 } : { printed: window.__printed || 0 };
  });
  check('invitación', 'después de exportar aparece una invitación discreta, no modal, con las dos opciones', invite.text && !invite.modal && invite.printed === 1 && /Sugerir una mejora/.test(invite.text) && /Reportar un problema/.test(invite.text), JSON.stringify(invite).slice(0, 300));
  await t.tap(page.locator('.feedback-invite').getByRole('button', { name: 'Ahora no' }));
  await page.waitForTimeout(400);
  await t.tap(page.getByRole('button', { name: 'Imprimir resumen (1 hoja)' }));
  await page.waitForTimeout(600);
  check('invitación', '"Ahora no" la cierra y no vuelve a aparecer al exportar otra vez', (await page.locator('.feedback-invite').count()) === 0, 'volvió a aparecer');

  // ---------------------------------------------------- reportar un problema
  await t.menu();
  await t.tap(page.locator('.account-feedback[data-feedback="problem"]').first());
  await page.waitForTimeout(1500);
  const fbHash = await page.evaluate(() => window.location.hash);
  check('problema', '"Reportar un problema" lleva el tipo y la pantalla (sin ids)', fbHash === '#/mejorar?tipo=problema&desde=resultado', fbHash);
  const formState = await page.evaluate(() => ({
    kind: (document.querySelector('input[type="radio"]:checked') || {}).value,
    screens: [...document.querySelectorAll('select')].map((x) => x.value),
    required: [...document.querySelectorAll('textarea')].filter((x) => x.closest('.disclosure-body') === null).length,
  }));
  check('problema', 'viene elegido "Encontré un problema", con la pantalla y un solo campo a la vista', formState.kind === 'problem' && formState.screens.includes('resultado') && formState.required === 1, JSON.stringify(formState));
  await page.getByLabel('¿Qué pasó?').fill('El margen cambió solo después de guardar.');
  await t.tap(page.getByRole('button', { name: 'Enviar' }));
  await page.waitForTimeout(1800);
  let body = await t.text();
  check('problema', 'se envía con un solo campo y agradece', body.includes(THANKS) && /Recibido/.test(body), norm(body).slice(0, 300));
  const stored = db.feedback[0] || {};
  const extraKeys = Object.keys(stored).filter((k) => !['id', 'organization_id', 'author', 'kind', 'category', 'screen', 'app_version', 'message', 'details', 'expected', 'status', 'created_at', 'at', 'response', 'reviewed_at', 'reviewed_by', 'duplicate_of', 'history'].includes(k));
  check('problema', 'la base recibe sólo texto, tipo, categoría, pantalla y versión (sin datos económicos)', db.feedback.length === 1 && extraKeys.length === 0 && stored.kind === 'problem' && stored.screen === 'resultado' && stored.details === null && !/\$|COT-/.test(stored.message), JSON.stringify(extraKeys));
  await page.getByLabel('¿Qué pasó?').fill('El margen cambió solo después de guardar.');
  await t.tap(page.getByRole('button', { name: 'Enviar' }));
  await page.waitForTimeout(1500);
  check('problema', 'el mismo texto dos veces: se avisa y no se duplica', /Ya recibimos un comentario/.test(await t.text()) && db.feedback.length === 1, `${db.feedback.length} comentarios`);

  // ----------------------------------------------------- sugerir una mejora
  await page.getByLabel('¿Qué pasó?').fill('Texto que no se tiene que perder');
  await t.menu();
  await t.tap(page.locator('.account-feedback[data-feedback="suggestion"]').first());
  await page.waitForTimeout(800);
  const switched = await page.evaluate(() => ({
    kind: (document.querySelector('input[type="radio"]:checked') || {}).value,
    label: [...document.querySelectorAll('label')].map((l) => l.textContent).find((x) => /mejorar o agregar/.test(x)) || null,
    message: (document.querySelector('.report-form textarea') || {}).value,
    hash: window.location.hash,
  }));
  check('sugerencia', 'estando en el formulario, "Sugerir una mejora" cambia el tipo sin perder lo escrito', switched.kind === 'suggestion' && switched.label && switched.message === 'Texto que no se tiene que perder', JSON.stringify(switched));
  await page.getByLabel('¿Qué te gustaría mejorar o agregar?').fill('Poder ordenar la lista de cotizaciones por cliente.');
  await t.tap(page.getByText('Agregar detalles').first());
  await page.waitForTimeout(300);
  await page.getByLabel('¿Para qué te serviría? (opcional)').fill('Para encontrar rápido las de un mismo cliente.');
  await t.tap(page.getByRole('button', { name: 'Enviar' }));
  await page.waitForTimeout(1800);
  const sug = db.feedback[1] || {};
  check('sugerencia', 'la sugerencia llega con su detalle y sin "qué esperabas"', db.feedback.length === 2 && sug.kind === 'suggestion' && sug.details === 'Para encontrar rápido las de un mismo cliente.' && sug.expected === null, JSON.stringify({ n: db.feedback.length, kind: sug.kind }));
  body = await t.text();
  check('sugerencia', '"Comentarios de tu empresa" muestra los dos con su estado', /Recibida/.test(body) && /Recibido/.test(body) && /Problema/.test(body) && /Sugerencia/.test(body), norm(body).slice(0, 300));
  check('sugerencia', 'el formulario no tiene scroll horizontal', (await t.overflow()) <= 1, `${await t.overflow()}px`);
  check('sugerencia', 'la pantalla no habla de créditos ni premios', !CREDITS_TEXT.test(body), norm(body).slice(0, 200));
  await page.screenshot({ path: path.join(outDir, `beta-mejorar-${mode}.png`), fullPage: true });

  // ------------------------------------------------------- colega de la empresa
  const pageC = await open(colleague.email, colleague.password);
  const c = helpers(pageC);
  await c.go('#/mejorar', 1800);
  body = await c.text();
  check('colega', 'otra persona de la empresa ve los comentarios', (body.match(/de otra persona de tu empresa/g) || []).length === 2, norm(body).slice(0, 300));

  // ----------------------------------------------------------- RATEOS ADMIN
  const pageA = await open(admin.email, admin.password);
  const a = helpers(pageA);
  await a.go('#/admin', 2500);
  body = await a.text();
  check('admin', 'la cola muestra los dos con la empresa, quién y el tipo', /Feedback de la beta/.test(body) && body.includes('Tester Sintética SRL') && body.includes(tester.email) && /Sugerencia/.test(body) && /Problema/.test(body), norm(body).slice(0, 300));
  check('admin', 'el panel no muestra saldos ni nada de las cotizaciones de la empresa', !/Saldo|cálculos de prueba|\+2/.test(body) && !quotesT().some((q) => q.code && body.includes(q.code)), 'aparece un saldo o una cotización');
  await a.tap(pageA.getByRole('button', { name: 'Sugerencias', exact: true }).first());
  await pageA.waitForTimeout(1200);
  const onlySuggestions = await pageA.evaluate(() => [...document.querySelectorAll('.admin-report')].map((x) => x.dataset.kind));
  check('admin', 'el filtro "Sugerencias" muestra sólo sugerencias', onlySuggestions.length === 1 && onlySuggestions[0] === 'suggestion', JSON.stringify(onlySuggestions));
  await a.tap(pageA.getByRole('button', { name: 'Problemas', exact: true }).first());
  await pageA.waitForTimeout(1200);
  const problemCard = pageA.locator('.admin-report[data-kind="problem"]').first();
  await problemCard.getByLabel(/Respuesta para la empresa/).fill('Gracias: lo reproducimos y lo estamos corrigiendo.');
  await a.tap(problemCard.getByRole('button', { name: 'Confirmado' }));
  await pageA.waitForTimeout(1500);
  check('admin', 'clasificar como "Confirmado" con respuesta', /Quedó como "Confirmado"/.test(await a.toasts()) && db.feedback[0].status === 'confirmed' && /lo reproducimos/.test(db.feedback[0].response || ''), `${await a.toasts()} · ${db.feedback[0].status}`);
  await a.clearToasts();
  const problemCard2 = pageA.locator('.admin-report[data-kind="problem"]').first();
  await problemCard2.getByLabel(/Respuesta para la empresa/).fill('Ya está corregido. ¡Gracias por avisarnos!');
  await a.tap(problemCard2.getByRole('button', { name: 'Resuelto' }));
  await pageA.waitForTimeout(1500);
  const leftOpen = await pageA.locator('.admin-report[data-kind="problem"]').count();
  check('admin', 'lo resuelto sale de "Sin resolver"', leftOpen === 0, `${leftOpen} problemas abiertos`);
  await a.tap(pageA.getByRole('button', { name: 'Resueltos', exact: true }).first());
  await pageA.waitForTimeout(1200);
  const resolvedCard = await pageA.evaluate(() => (document.querySelector('.admin-report[data-kind="problem"]') || {}).innerText || '');
  check('admin', '"Resuelto" queda en el historial con quién y la respuesta', db.feedback[0].status === 'resolved' && db.feedback[0].history.length === 3 && /Resuelto/.test(resolvedCard) && resolvedCard.includes(admin.email), norm(resolvedCard).slice(0, 300));
  check('admin', 'el panel sin scroll horizontal', (await a.overflow()) <= 1, `${await a.overflow()}px`);
  await pageA.screenshot({ path: path.join(outDir, `beta-admin-${mode}.png`), fullPage: true });

  // ------------------------------------------------ la empresa ve la respuesta
  await t.go('#/inicio', 600);
  await t.go('#/mejorar', 1800);
  body = await t.text();
  check('respuesta', 'la empresa ve "Resuelto" y la respuesta de RATEOS', /Resuelto/.test(body) && /Respuesta de RATEOS: Ya está corregido/.test(body), norm(body).slice(0, 300));
  await t.go('#/admin', 1500);
  check('respuesta', 'la tester no entra al panel de RATEOS ADMIN', /No tenés permisos para acceder a esta sección/.test(await t.text()), norm(await t.text()).slice(0, 160));

  // --------------------------------------------- por la API, sin permisos
  const queue = await rpcFromPage(page, 'admin_feedback', {});
  const review = await rpcFromPage(page, 'admin_review_feedback', { p_feedback: db.feedback[1].id, p_status: 'resolved' });
  const otherOrg = await rpcFromPage(page, 'my_feedback', { p_org: db.orgOf(db.users.get(admin.email).id) });
  check('api', 'la tester no lee la cola, no clasifica y no lee el feedback de otra empresa (403)', queue.status === 403 && review.status === 403 && otherOrg.status === 403 && db.feedback[1].status === 'received', JSON.stringify({ queue: queue.status, review: review.status, otherOrg: otherOrg.status }));
  const forged = await page.evaluate(async ({ supa, key }) => {
    const raw = window.sessionStorage.getItem('rateos.auth') || window.localStorage.getItem('rateos.auth');
    const tok = raw ? JSON.parse(raw).access_token : '';
    const r = await window.fetch(`${supa}/rest/v1/feedback`, { method: 'PATCH', headers: { apikey: key, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved' }) });
    return r.status;
  }, { supa: SUPA, key: SUPABASE.publishableKey });
  check('api', 'escribir la tabla del feedback directo por la API se rechaza', forged >= 400 && db.feedback[1].status === 'received', `HTTP ${forged}`);

  check('consola', 'sin errores de la app en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('red', 'ningún pedido fuera del sitio y del Supabase simulado', blocked.length === 0, blocked.slice(0, 3).join(' | '));
  for (const ctx of contexts) await ctx.close();
}

try {
  for (const mode of args.modes) {
    process.stdout.write(`\n=== Beta gratuita y feedback en navegador — ${mode} ===\n`);
    await runMode(mode);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((x) => !x.ok);
const md = [
  '# RATEOS — beta gratuita y feedback en navegador (SIMULADO)',
  '',
  `Modos: ${args.modes.join(', ')} · controles: ${results.length} · fallas: ${failed.length}`,
  '',
  '| Modo | Escenario | Control | Estado | Detalle |',
  '|---|---|---|---|---|',
  ...results.map((x) => `| ${x.mode} | ${x.scenario} | ${x.check.replace(/\|/g, '\\|')} | ${x.ok ? 'PASS' : 'FAIL'} | ${x.detail.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
writeFileSync(path.join(outDir, 'beta-lab-report.md'), assertSafeReport(md));
writeFileSync(path.join(outDir, 'beta-lab-report.json'), assertSafeReport(JSON.stringify({ modes: args.modes, results }, null, 2)));
process.stdout.write(`\n${results.length - failed.length}/${results.length} controles en verde · reporte: ${path.relative(ROOT, outDir)}/beta-lab-report.md\n`);
if (failed.length) process.exitCode = 1;
