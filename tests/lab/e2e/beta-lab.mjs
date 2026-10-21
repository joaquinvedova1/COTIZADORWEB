#!/usr/bin/env node
/**
 * RATEOS Test Lab — créditos de prueba y reportes de errores en NAVEGADOR
 * (PLAN-2026-029). SIMULADO: Supabase lo imita supabase-mock.mjs con las mismas
 * reglas que la migración 20261021120000 (cobro al guardar, reportes, revisión
 * de RATEOS ADMIN). La base real nunca recibe un pedido.
 *
 *   npm run build && node tests/lab/e2e/beta-lab.mjs            escritorio y celular
 *   node tests/lab/e2e/beta-lab.mjs --mode=mobile               uno solo
 *
 * Recorre: saldo a la vista, crear (servicio, ejemplo, producto), quedarse sin
 * saldo (sólo se bloquea crear; editar y abrir el resultado siguen), la base
 * rechaza una creación que el navegador creía posible (sin perder nada), dos
 * pestañas a la vez, reportar un error, verlo como colega, revisarlo y
 * aprobarlo como RATEOS ADMIN (+2 una sola vez) y usar esos créditos.
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
const EXHAUSTED = 'Se agotaron tus cálculos de prueba; podés seguir trabajando con los que ya tenés y enviarnos feedback.';
const EXAMPLE_PRODUCT = '00000000-0000-4000-8000-000000002001';

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
    overflow: () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - window.innerWidth, 0)),
  });

  // ---------------------------------------------------- cuentas sintéticas
  const pw = () => `lab-${randomUUID()}`;
  const admin = { email: `beta.admin.${mode}@rateos.test`, password: pw() };
  db.createUser({ ...admin, fullName: 'Admin sintético', company: 'Plataforma sintética' }); // sin cuota (como las empresas existentes)
  db.admins.add(db.users.get(admin.email).id);
  db.policy.quotaForNewOrgs = true;
  const tester = { email: `beta.tester.${mode}@rateos.test`, password: pw() };
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
  db.credits.delete(colleagueOwnOrg);
  db.members.push({ organization_id: orgT, user_id: colleagueId, role: 'ESTIMATOR', created_at: new Date().toISOString() });
  const acct = db.credits.get(orgT);
  check('cuentas', 'la empresa tester nace con 10 créditos y la del admin sin cuota', acct && acct.balance === 10 && !db.credits.has(db.orgOf(db.users.get(admin.email).id)), JSON.stringify(acct));
  const wsT = () => db.workspaces.get(orgT);
  const quotesT = () => ((wsT().state && wsT().state.quotes) || []);
  const productsT = () => ((wsT().state && wsT().state.products) || []);

  // ------------------------------------------------------------- saldo y crear
  const page = await open(tester.email, tester.password);
  const t = helpers(page);
  await t.go('#/nuevo');
  let body = await t.text();
  check('saldo', 'Nuevo cálculo muestra "Te quedan 10 cálculos nuevos de prueba"', /Te quedan 10 cálculos nuevos de prueba/.test(body), norm(body).slice(0, 200));
  check('saldo', 'dice qué no consume (editar, recalcular, guardar o exportar)', /Editar, recalcular, guardar o exportar lo que ya tenés no usa ninguno/.test(body), '');
  check('saldo', 'Nuevo cálculo: sin scroll horizontal', (await t.overflow()) <= 1, `${await t.overflow()}px`);

  await t.go('#/cotizaciones/nueva');
  await t.tap(page.locator('.quote-choice-blank').first());
  await page.waitForTimeout(1800);
  check('crear', 'crear una cotización en blanco abre el editor', /#\/cotizaciones\/[^/]+\/service/.test(await page.evaluate(() => window.location.hash)), await page.evaluate(() => window.location.hash));
  check('crear', 'el aviso dice cuántos quedan (9)', /Te quedan 9 cálculos nuevos de prueba/.test(await t.toasts()), await t.toasts());
  check('crear', 'la base cobró 1 y guardó el código en la misma escritura', acct.balance === 9 && quotesT().length === 1 && wsT().state.settings.lastQuoteNumber === 1, `saldo ${acct.balance}, ${quotesT().length} cotizaciones, último código ${wsT().state.settings.lastQuoteNumber}`);
  const firstQuote = quotesT()[0];

  await t.go('#/productos/nuevo');
  await t.clearToasts();
  await t.tap(page.locator('.quote-choice', { hasText: 'Ver un ejemplo' }).first());
  await page.waitForTimeout(1800);
  await t.go('#/productos/nuevo');
  await t.tap(page.locator('.quote-choice', { hasText: 'Ver un ejemplo' }).first());
  await page.waitForTimeout(1800);
  check('ejemplo', 'el ejemplo "Chipá" no usa créditos y hay uno solo aunque se abra dos veces', acct.balance === 9 && productsT().filter((p) => p.id === EXAMPLE_PRODUCT).length === 1 && productsT().length === 1, `saldo ${acct.balance}, productos ${productsT().map((p) => p.id.slice(0, 8)).join(',')}`);

  // ---------------------------------------------------------- sin saldo
  acct.balance = 1;
  await t.go('#/productos/nuevo');
  await t.tap(page.locator('.quote-choice-blank').first());
  await page.waitForTimeout(1800);
  check('agotar', 'un producto en blanco usa el último crédito', acct.balance === 0 && productsT().length === 2, `saldo ${acct.balance}, productos ${productsT().length}`);
  await t.go('#/nuevo');
  body = await t.text();
  const cards = await page.evaluate(() => [...document.querySelectorAll('.calc-choice')].map((c) => ({ disabled: c.getAttribute('aria-disabled') === 'true', link: c.tagName === 'A' })));
  check('agotar', 'Nuevo cálculo: el mensaje del dueño, palabra por palabra', body.includes(EXHAUSTED), norm(body).slice(0, 240));
  check('agotar', 'Nuevo cálculo: servicio y producto no llevan a crear', cards.length === 2 && cards.every((c) => c.disabled && !c.link), JSON.stringify(cards));
  await t.go('#/cotizaciones/nueva');
  const choices = await page.evaluate(() => [...document.querySelectorAll('.quote-choice')].map((b) => b.disabled));
  check('agotar', 'Nueva cotización: todas las opciones deshabilitadas y el aviso a la vista', choices.length > 0 && choices.every(Boolean) && (await t.text()).includes(EXHAUSTED), JSON.stringify(choices));
  await t.go('#/productos/nuevo');
  const productChoices = await page.evaluate(() => [...document.querySelectorAll('.quote-choice')].map((b) => ({ blank: b.classList.contains('quote-choice-blank'), disabled: b.disabled })));
  check('agotar', 'Nuevo producto: "Empezar en blanco" deshabilitado y el ejemplo disponible (no cobra)', productChoices.some((c) => c.blank && c.disabled) && productChoices.some((c) => !c.blank && !c.disabled), JSON.stringify(productChoices));
  await t.go('#/cotizaciones', 1500);
  await t.clearToasts();
  await t.tap(page.getByRole('button', { name: /^Más opciones/ }).first());
  await page.waitForTimeout(600);
  await t.tap(page.getByRole('dialog').getByRole('button', { name: 'Duplicar' }));
  await page.waitForTimeout(1500);
  check('agotar', 'Duplicar sin saldo: aviso con el mensaje y nada nuevo en la nube', (await t.toasts()).includes(EXHAUSTED) && quotesT().length === 1, `${await t.toasts()} · ${quotesT().length} cotizaciones`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Sin saldo se sigue editando y abriendo el resultado.
  await t.go(`#/cotizaciones/${encodeURIComponent(firstQuote.id)}/service`, 1500);
  const nameInput = page.getByLabel('Nombre de la cotización').first();
  let edited = false;
  if (await nameInput.count()) {
    await nameInput.fill('Cotización editada sin saldo');
    await nameInput.blur();
    await page.waitForTimeout(2500);
    edited = quotesT().some((q) => q.name === 'Cotización editada sin saldo');
  }
  check('agotar', 'sin saldo se edita y se guarda en la nube una cotización existente', edited, quotesT().map((q) => q.name).join(', '));
  await t.go(`#/cotizaciones/${encodeURIComponent(firstQuote.id)}/result`, 1800);
  body = await t.text();
  check('agotar', 'sin saldo el resultado se abre (y con él el PDF)', /Imprimir|PDF/.test(body) && !/No se pudo mostrar esta pantalla/.test(body), norm(body).slice(0, 160));

  // La base rechaza una creación que el navegador creía posible.
  acct.balance = 1;
  await t.go('#/inicio', 800);
  await t.go('#/cotizaciones/nueva', 1200);
  const seen = await page.evaluate(() => ({ hash: window.location.hash, credits: (document.querySelector('.credits-notice') || { dataset: {} }).dataset.credits, disabled: [...document.querySelectorAll('.quote-choice')].map((b) => b.disabled) }));
  check('carrera', 'con saldo 1 la creación está disponible', seen.credits === '1' && seen.disabled.length > 0 && !seen.disabled[0], JSON.stringify(seen));
  acct.balance = 0; // otro miembro usó el último crédito mientras tanto
  await t.clearToasts();
  const before = quotesT().length;
  await t.tap(page.locator('.quote-choice-blank').first());
  await page.waitForTimeout(2500);
  const afterRace = await page.evaluate(() => ({
    hash: window.location.hash,
    sync: (document.querySelector('.sync-text') || {}).textContent || '',
    recovery: Object.keys(localStorage).filter((k) => k.includes('.recovery.')).length,
  }));
  check('carrera', 'la base rechaza la creación: aviso con el mensaje del dueño', (await t.toasts()).includes(EXHAUSTED), await t.toasts());
  check('carrera', 'nada a medias: ni la cotización ni el código en la nube', quotesT().length === before && wsT().state.settings.lastQuoteNumber === 1, `${quotesT().length} cotizaciones, último código ${wsT().state.settings.lastQuoteNumber}`);
  check('carrera', 'no queda en el editor de una cotización inexistente y la sincronización no queda en error', !/\/service$/.test(afterRace.hash) && !/No pudimos sincronizar/.test(afterRace.sync), JSON.stringify(afterRace));
  check('carrera', 'lo rechazado queda en una copia de recuperación del navegador', afterRace.recovery >= 1, JSON.stringify(afterRace));

  // ----------------------------------------------------- dos pestañas a la vez
  acct.balance = 1;
  const page2 = await page.context().newPage();
  page2.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await page2.goto(`${base}#/cotizaciones/nueva`);
  await page2.waitForTimeout(2500);
  await t.go('#/inicio', 800);
  await t.go('#/cotizaciones/nueva', 1200);
  await t.tap(page.locator('.quote-choice-blank').first());
  await page.waitForTimeout(2000);
  const t2 = helpers(page2);
  await t2.tap(page2.locator('.quote-choice-blank').first());
  await page2.waitForTimeout(2500);
  const tab2 = await page2.evaluate(() => document.body.innerText);
  check('pestañas', 'dos pestañas con saldo 1: se cobra una sola creación', acct.balance === 0 && acct.used === 3 && quotesT().length === before + 1, `saldo ${acct.balance}, usados ${acct.used}, cotizaciones ${quotesT().length}`);
  check('pestañas', 'la segunda pestaña avisa (otro dispositivo o sin créditos) y no pierde nada en silencio', /cambiaron en otro dispositivo|Se agotaron tus cálculos de prueba/.test(tab2), norm(tab2).slice(0, 200));
  await page2.close();

  // ------------------------------------------------------- reportar un error
  if (mode === 'mobile') {
    await t.tap(page.locator('.menu-toggle').first());
    await page.waitForTimeout(500);
  }
  await t.go(`#/cotizaciones/${encodeURIComponent(firstQuote.id)}/result`, 1500);
  if (mode === 'mobile') {
    await t.tap(page.locator('.menu-toggle').first());
    await page.waitForTimeout(600);
  }
  await t.tap(page.locator('.account-report').first());
  await page.waitForTimeout(1500);
  const reportHash = await page.evaluate(() => window.location.hash);
  check('reporte', 'el enlace del menú lleva la pantalla (sin ids)', reportHash === '#/reportar?desde=resultado', reportHash);
  const screenSelected = await page.evaluate(() => [...document.querySelectorAll('select')].map((s) => s.value));
  check('reporte', 'la pantalla viene elegida', screenSelected.includes('resultado'), JSON.stringify(screenSelected));
  await page.getByLabel('¿De qué se trata?').selectOption('calculo');
  await page.getByLabel('¿Qué hiciste?').fill('Abrí la cotización y fui a Resultado.');
  await page.getByLabel('¿Qué esperabas que pasara?').fill('Ver el margen con el número que cargué.');
  await page.getByLabel('¿Qué pasó?').fill('El margen cambió solo después de guardar.');
  await t.tap(page.getByRole('button', { name: 'Enviar reporte' }));
  await page.waitForTimeout(1800);
  body = await t.text();
  check('reporte', 'se envía y aparece como "Recibido" en "Reportes de tu empresa"', /Recibimos tu reporte/.test(body) && /Recibido/.test(body), norm(body).slice(0, 300));
  const stored = db.reports[0] || {};
  const keys = Object.keys(stored).filter((k) => !['id', 'organization_id', 'reporter', 'category', 'screen', 'app_version', 'did', 'expected', 'happened', 'status', 'created_at', 'at', 'review_note', 'reviewed_at', 'reviewed_by', 'duplicate_of', 'history'].includes(k));
  check('reporte', 'la base recibe sólo texto, categoría, pantalla y versión (sin datos económicos)', db.reports.length === 1 && keys.length === 0 && stored.screen === 'resultado' && !/\$|COT-/.test(`${stored.did}${stored.expected}${stored.happened}`), JSON.stringify(keys));
  await page.getByLabel('¿De qué se trata?').selectOption('calculo');
  await page.getByLabel('¿Qué hiciste?').fill('Abrí la cotización y fui a Resultado.');
  await page.getByLabel('¿Qué esperabas que pasara?').fill('Ver el margen con el número que cargué.');
  await page.getByLabel('¿Qué pasó?').fill('El margen cambió solo después de guardar.');
  await t.tap(page.getByRole('button', { name: 'Enviar reporte' }));
  await page.waitForTimeout(1500);
  check('reporte', 'el mismo texto dos veces: se avisa y no se duplica', /Ya recibimos un reporte/.test(await t.text()) && db.reports.length === 1, `${db.reports.length} reportes`);
  check('reporte', 'el formulario no tiene scroll horizontal', (await t.overflow()) <= 1, `${await t.overflow()}px`);
  await page.screenshot({ path: path.join(outDir, `beta-reportar-${mode}.png`), fullPage: true });

  // ------------------------------------------------------- colega de la empresa
  const pageC = await open(colleague.email, colleague.password);
  const c = helpers(pageC);
  await c.go('#/reportar', 1800);
  body = await c.text();
  check('colega', 'otra persona de la empresa ve el reporte y el mismo saldo', /de otra persona de tu empresa/.test(body) && /Cálculos de prueba disponibles: 0/.test(body), norm(body).slice(0, 300));

  // ----------------------------------------------------------- RATEOS ADMIN
  const pageA = await open(admin.email, admin.password);
  const a = helpers(pageA);
  await a.go('#/admin', 2500);
  body = await a.text();
  check('admin', 'la cola muestra el reporte con la empresa, quién y el saldo', /Reportes de errores/.test(body) && body.includes('Tester Sintética SRL') && body.includes(tester.email) && /Saldo de la empresa: 0/.test(body), norm(body).slice(0, 300));
  check('admin', 'el panel no muestra nada de las cotizaciones de la empresa', !body.includes('Cotización editada sin saldo'), 'aparece el nombre de una cotización');
  await a.tap(pageA.getByRole('button', { name: 'Aprobar (+2)' }).first());
  await pageA.waitForTimeout(600);
  await a.tap(pageA.getByRole('button', { name: 'Aprobar', exact: true }).last());
  await pageA.waitForTimeout(2000);
  check('admin', 'aprobar (con confirmación) suma +2 a la empresa', /Se sumaron 2 cálculos/.test(await a.toasts()) && acct.balance === 2 && db.reports[0].status === 'approved', `${await a.toasts()} · saldo ${acct.balance}`);
  await a.tap(pageA.getByRole('button', { name: 'Aprobados' }).first());
  await pageA.waitForTimeout(1500);
  const approvedCard = await pageA.evaluate(() => {
    const card = document.querySelector('.admin-report[data-status="approved"]');
    return card ? { buttons: [...card.querySelectorAll('button')].map((b) => b.textContent.trim()), text: card.innerText } : null;
  });
  check('admin', 'aprobado es definitivo: sin botones y con historial (quién y cuándo)', approvedCard && approvedCard.buttons.length === 0 && approvedCard.text.includes(admin.email) && /Validado y aprobado/.test(approvedCard.text), JSON.stringify(approvedCard).slice(0, 300));
  // Una segunda aprobación por la API directa (otra pestaña, botón viejo): no suma.
  const second = await rpcFromPage(pageA, 'admin_review_bug_report', { p_report: db.reports[0].id, p_status: 'approved' });
  check('admin', 'la doble aprobación por la API no suma', second.status === 200 && second.body.already === true && second.body.credits_added === 0 && acct.balance === 2, JSON.stringify(second));
  check('admin', 'el panel sin scroll horizontal', (await a.overflow()) <= 1, `${await a.overflow()}px`);
  await pageA.screenshot({ path: path.join(outDir, `beta-admin-${mode}.png`), fullPage: true });

  // ------------------------------------------------ la tester usa el premio
  await t.go('#/reportar', 1800);
  body = await t.text();
  check('premio', 'la empresa ve "Validado y aprobado (+2)" y la respuesta', /Validado y aprobado \(\+2\)/.test(body), norm(body).slice(0, 300));
  await t.go('#/nuevo', 1200);
  check('premio', 'Nuevo cálculo vuelve a mostrar el saldo (2)', /Te quedan 2 cálculos nuevos de prueba/.test(await t.text()), norm(await t.text()).slice(0, 200));
  await t.go('#/admin', 1500);
  check('premio', 'la tester no entra al panel de RATEOS ADMIN', /No tenés permisos para acceder a esta sección/.test(await t.text()), norm(await t.text()).slice(0, 160));
  // Desde el navegador de la tester, por la API: ni aprobarse ni leer la cola ni cambiar el saldo.
  const self = await rpcFromPage(page, 'admin_review_bug_report', { p_report: db.reports[0].id, p_status: 'approved' });
  const queue = await rpcFromPage(page, 'admin_bug_reports', {});
  const otherOrg = await rpcFromPage(page, 'get_my_credits', { p_org: db.orgOf(db.users.get(admin.email).id) });
  check('api', 'la tester no se aprueba, no lee la cola ni el saldo de otra empresa (403)', self.status === 403 && queue.status === 403 && otherOrg.status === 403, JSON.stringify({ self: self.status, queue: queue.status, otherOrg: otherOrg.status }));
  const forged = await page.evaluate(async ({ supa, key, org }) => {
    const raw = window.sessionStorage.getItem('rateos.auth') || window.localStorage.getItem('rateos.auth');
    const tok = raw ? JSON.parse(raw).access_token : '';
    const r = await window.fetch(`${supa}/rest/v1/credit_accounts?organization_id=eq.${org}`, { method: 'PATCH', headers: { apikey: key, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ balance: 999 }) });
    return r.status;
  }, { supa: SUPA, key: SUPABASE.publishableKey, org: orgT });
  check('api', 'escribir el saldo directo por la API se rechaza y el saldo no cambia', forged >= 400 && acct.balance === 2, `HTTP ${forged}, saldo ${acct.balance}`);

  check('consola', 'sin errores de la app en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('red', 'ningún pedido fuera del sitio y del Supabase simulado', blocked.length === 0, blocked.slice(0, 3).join(' | '));
  for (const ctx of contexts) await ctx.close();
}

try {
  for (const mode of args.modes) {
    process.stdout.write(`\n=== Beta (créditos y reportes) en navegador — ${mode} ===\n`);
    await runMode(mode);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((x) => !x.ok);
const md = [
  '# RATEOS — créditos de prueba y reportes en navegador (SIMULADO)',
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
