#!/usr/bin/env node
/**
 * RATEOS Test Lab — auditoría en NAVEGADOR (PLAN-2026-013, auditor UX B · I · J).
 *
 *   npm run build && npm run test:lab:e2e          escritorio (1360 × 900) y celular (390 × 844)
 *   node tests/lab/e2e/ui-lab.mjs --mode=mobile    uno solo
 *
 * Sirve dist/ bajo /COTIZADORWEB/ en un host "de producción" (rateos.test →
 * 127.0.0.1) y simula Supabase (supabase-mock.mjs): la base real nunca recibe un
 * pedido y cualquier otra salida a internet es un error. Siembra escenarios del
 * lab en una cuenta sintética y verifica, para cada uno:
 *   - "Ir al campo" de cada pendiente con campo exacto: existe en el Resultado y,
 *     al tocarlo, el foco queda en ESE campo, visible y sin nada encima
 *   - mismas cifras que el motor en el resumen en vivo, en "Ver cálculo", en el
 *     Resultado y en el PDF (impresión del Resultado): costo del mes y tarifa
 *   - magnitudes distintas con su propio nombre y valor (viajes facturables ≠
 *     viajes físicos, días de trabajo, km por mes)
 *   - sin NaN / Infinity, sin scroll horizontal y sin errores de consola
 * Escribe reports/lab/e2e/ui-lab-report.{json,md} (artefacto de CI).
 *
 * Playwright NO es dependencia de RATEOS (cero dependencias npm): se toma de
 * PLAYWRIGHT_MODULE (CI lo instala con versión fija fuera del repo), de una
 * instalación global o de /opt/node22.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../scripts/serve.mjs';
import { computeQuote } from '../../../js/engines/quote-engine.js';
import { formatMoney, formatMoneyCeil, formatNumber } from '../../../js/core/format.js';
import { fieldHref } from '../../../js/ui/field-links.js';
import { cot0010Quote } from '../../fixtures/cot-0010.js';
import { service, person, owned, external, material } from '../lib/build.js';
import { assertSafeReport } from '../lib/report.js';
import { createDb, installSupabaseMock, SUPA } from './supabase-mock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const out = { modes: ['desktop', 'mobile'], out: 'reports/lab/e2e', shots: false };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) out.modes = arg.slice(7) === 'both' ? ['desktop', 'mobile'] : [arg.slice(7)];
    else if (arg.startsWith('--out=')) out.out = arg.slice(6);
    else if (arg === '--shots') out.shots = true;
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
  process.stderr.write('Playwright no está instalado. En CI: npm install --prefix "$RUNNER_TEMP/pw" playwright@1.56.1 y PLAYWRIGHT_MODULE=$RUNNER_TEMP/pw/node_modules/playwright\n');
  process.exit(2);
}

// ---------------------------------------------------------------- escenarios
const route = (o = {}) => ({ notApplicable: false, baseName: 'Neuquén', destinationName: 'Locación', distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [], ...o });

/** Escenarios del lab que ejercitan cada clase de pendiente y de aviso (LAB-F2…F11, PRB-18). */
export const E2E_SCENARIOS = [
  { id: 'E2E-01', title: 'COT-0010 completo (transporte por viaje): cifras del resumen = resultado = motor', build: () => cot0010Quote({ code: 'LAB-E01' }) },
  {
    id: 'E2E-02', title: 'Combustible del proveedor por km con "Sin traslados" (LAB-F2, LAB-F4)',
    build: () => {
      const q = cot0010Quote({ code: 'LAB-E02' });
      q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
      q.logistics.notApplicable = true;
      return q;
    },
  },
  {
    id: 'E2E-03', title: 'Unidad km: 8.000 km facturados con 4.000 km de ruta (LAB-F3)',
    build: () => service({
      id: 'lab-e03', serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 1100, unit: 'km' })],
      logistics: route({ distanceKm: 100, tripsPerActivation: 1 }),
    }),
  },
  {
    id: 'E2E-04', title: 'Externo $/hora con 0 horas en su línea (LAB-F6)',
    build: () => service({ id: 'lab-e04', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, equipment: [external({ name: 'Grúa por hora', hoursPerActiveDay: 0 }, { price: 300000, unit: 'hour' })] }),
  },
  {
    id: 'E2E-05', title: 'Cobro por hora con 0 horas por día (LAB-F7)',
    build: () => service({ id: 'lab-e05', serviceType: 'crew', unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 0 }, labor: [person()] }),
  },
  {
    id: 'E2E-06', title: 'Material con precio y cantidad 0 (LAB-F8)',
    build: () => service({ id: 'lab-e06', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Electrodos', basis: 'per_active_day', quantity: 0, unitCost: 18000 })] }),
  },
  {
    id: 'E2E-07', title: 'Críticos de un solo campo: días, margen, tarifa conocida y plazo de cobro (LAB-F10)',
    build: () => service({ id: 'lab-e07', serviceType: 'on_call', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: null }, labor: [person()], pricing: { targetMarginPct: 100, knownRate: 0 }, finance: { paymentTermDays: null } }),
  },
  {
    id: 'E2E-08', title: 'Equipo alquilado sin tarifa junto a uno propio (LAB-F11)',
    build: () => service({ id: 'lab-e08', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10 }, equipment: [owned({ name: 'Grúa propia' }), external({ name: 'Equipo alquilado' }, { price: 0, unit: 'day' })] }),
  },
  {
    id: 'E2E-09', title: 'Proveedor $/km sin distancia (PRB-18)',
    build: () => {
      const q = cot0010Quote({ code: 'LAB-E09' });
      q.logistics.distanceKm = 0;
      return q;
    },
  },
  {
    id: 'E2E-10', title: 'Avisos informativos: puesto sin posiciones y materiales ignorados (LAB-F9)',
    build: () => {
      const q = service({ id: 'lab-e10', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Oficial' }), person({ role: 'Ayudante', positions: 0, basicMonthly: 1200000 })], materials: [material({ description: 'Pintura', quantity: 10, unitCost: 20000 })] });
      q.materialsNotApplicable = true;
      return q;
    },
  },
];

// -------------------------------------------------------------------- runner
const args = parseArgs(process.argv.slice(2));
const dist = path.join(ROOT, 'dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  process.stderr.write('Falta dist/: corré "npm run build" antes de la auditoría en navegador.\n');
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
const norm = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

async function runMode(mode) {
  const viewport = mode === 'mobile' ? { width: 390, height: 844 } : { width: 1360, height: 900 };
  const context = await browser.newContext({ viewport, ...(mode === 'mobile' ? { hasTouch: true, isMobile: true } : {}) });
  const db = createDb();
  await installSupabaseMock(context, db);
  const blocked = [];
  await context.route((u) => !u.href.startsWith(base) && !u.href.startsWith(SUPA), (r) => {
    blocked.push(r.request().url());
    return r.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console ${m.text()}`);
  });
  const check = (scenario, name, ok, detail = '') => {
    results.push({ mode, scenario, check: name, ok: Boolean(ok), detail: ok ? '' : String(detail) });
    process.stdout.write(`${ok ? '  ok  ' : '  FAIL'} [${mode}] ${scenario} · ${name}${ok ? '' : ` — ${detail}`}\n`);
  };
  const go = async (hash, wait = 400) => {
    await page.evaluate((x) => { window.location.hash = x; }, hash);
    await page.waitForTimeout(wait);
  };
  const tap = async (loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    if (mode === 'mobile') await loc.tap();
    else await loc.click();
  };
  const scan = async (scenario, where) => {
    const info = await page.evaluate(() => ({
      nan: /NaN|Infinity/.test(document.body.innerText),
      overflow: Math.max(document.documentElement.scrollWidth - window.innerWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    }));
    check(scenario, `${where}: sin NaN/Infinity`, !info.nan, 'aparece NaN o Infinity en pantalla');
    check(scenario, `${where}: sin scroll horizontal`, info.overflow <= 1, `${info.overflow}px de más`);
  };
  /** El control enfocado: nombre, visible en pantalla y sin nada encima (resumen fijo, barras, diálogos). */
  const focused = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { name: null };
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    const own = (n) => Boolean(n) && (n === el || el.contains(n) || [...(el.labels || [])].some((l) => l.contains(n)) || (n.closest && n.closest('label') && n.closest('label').contains(el)));
    return {
      name: el.getAttribute('name'),
      inView: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
      covered: !own(top),
      over: top ? `${top.tagName.toLowerCase()}${top.className && typeof top.className === 'string' ? `.${top.className.split(' ').filter(Boolean).slice(0, 2).join('.')}` : ''}` : null,
    };
  });
  const waitFocus = async (name) => {
    for (let i = 0; i < 20; i += 1) {
      const f = await focused();
      if (f.name === name) return f;
      await page.waitForTimeout(150);
    }
    return focused();
  };

  // Cuenta sintética (contraseña aleatoria por corrida; nunca toca la base real).
  const email = `lab.${mode}@rateos.test`;
  const password = `lab-${randomUUID()}`;
  db.createUser({ email, password, fullName: 'Test Lab', company: 'Empresa sintética' });
  await page.goto(`${base}#/login`);
  await page.waitForTimeout(800);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForTimeout(2500);
  const orgId = db.orgOf(db.users.get(email).id);
  const ws = db.workspaces.get(orgId);
  check('cuenta', 'el workspace de la cuenta se crea al ingresar', Boolean(ws.state), 'sin estado guardado');
  if (!ws.state) return;

  const now = new Date().toISOString();
  const seeded = E2E_SCENARIOS.map((s, i) => {
    const q = s.build();
    Object.assign(q, { id: randomUUID(), organizationId: orgId, code: `LAB-E${String(i + 1).padStart(2, '0')}`, name: `${s.id} ${s.title}`.slice(0, 120), offerDate: '2026-10-16', createdAt: now, updatedAt: now });
    return { s, q, r: computeQuote(structuredClone(q)) };
  });
  ws.state.quotes = seeded.map((x) => x.q);
  ws.revision += 1;
  await page.reload();
  await page.waitForTimeout(2500);

  for (const { s, q, r } of seeded) {
    const k = r.kpis;
    const money = formatMoney(k.totalCost);
    const rate = Number.isFinite(k.commercialListRate) ? (k.commercialSource === 'suggested' ? formatMoneyCeil(k.commercialListRate) : formatMoney(k.commercialListRate)) : null;

    // Resumen en vivo del editor (mismas cifras que el motor).
    await go(`#/cotizaciones/${encodeURIComponent(q.id)}/service`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    const summary = await page.evaluate(() => {
      const read = (key) => {
        const n = document.querySelector(`[data-kpi="${key}"] .qe-sum-full`);
        return n ? n.textContent : null;
      };
      return { cost: read('totalCost'), rate: read('commercialRate') };
    });
    check(s.id, 'resumen en vivo: costo del mes = motor', norm(summary.cost) === norm(money), `resumen "${norm(summary.cost)}" · motor "${money}"`);
    if (rate) check(s.id, 'resumen en vivo: tarifa = motor', norm(summary.rate).includes(norm(rate)), `resumen "${norm(summary.rate)}" · motor "${rate}"`);
    await scan(s.id, 'editor');

    // "Ver cálculo" del costo del mes: la traza termina en el mismo número (en el celular, el resumen se abre con "Ver detalle").
    const traceBtn = page.locator('[data-kpi="totalCost"] .trace-btn').first();
    if (!(await traceBtn.isVisible().catch(() => false))) {
      const toggle = page.locator('.qe-sum-toggle').first();
      if (await toggle.isVisible().catch(() => false)) await tap(toggle);
      await page.waitForTimeout(300);
    }
    const traceVisible = await traceBtn.isVisible().catch(() => false);
    check(s.id, '"Ver cálculo" del costo del mes a la vista', traceVisible, 'no se ve el botón');
    if (traceVisible) {
      await tap(traceBtn);
      await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
      const traceText = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || document.body).textContent));
      check(s.id, '"Ver cálculo": costo del mes = motor', traceText.includes(norm(money)), `la traza no muestra ${money}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }

    // Viajes facturables ≠ viajes físicos ≠ días ≠ km (unidad "viaje", PLAN-2026-012): cada magnitud con su nombre y su valor.
    if (q.unit === 'trip' && !(q.logistics && q.logistics.notApplicable) && r.model.transport.kmPerTrip > 0) {
      await go(`#/cotizaciones/${encodeURIComponent(q.id)}/modality`, 300);
      await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      const t = norm(await page.evaluate(() => document.body.textContent));
      const tr = r.model.transport;
      const expectText = [
        ['Viajes facturables', `${formatNumber(k.billableQuantity, { decimals: 2 })} viajes`],
        ['Viajes físicos costeados', `${formatNumber(tr.physicalTripsPerMonth, { decimals: 2 })} viajes`],
        ['Días de trabajo', `${formatNumber(k.activeDays, { decimals: 2 })} días`],
        ['Km por mes', `${formatNumber(tr.routeKmPerMonth, { decimals: 2 })} km`],
      ];
      // Rótulo y valor son elementos vecinos: en el texto pueden quedar pegados.
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const [label, value] of expectText) check(s.id, `"${label}" = ${value}`, new RegExp(`${esc(label)}\\s*${esc(value)}`).test(t), `no aparece "${label} ${value}"`);
    }

    // Resultado: mismas cifras, pendientes con su botón.
    await go(`#/cotizaciones/${encodeURIComponent(q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const resultText = norm(await page.evaluate(() => document.body.innerText));
    check(s.id, 'resultado: costo del mes = motor', resultText.includes(norm(money)), `no aparece ${money}`);
    if (rate) check(s.id, 'resultado: tarifa = motor', resultText.includes(norm(rate)), `no aparece ${rate}`);
    await scan(s.id, 'resultado');
    if (args.shots) await page.screenshot({ path: path.join(outDir, `${mode}-${s.id}-resultado.png`), fullPage: true });

    // PDF: el Resultado se exporta con "Imprimir / Guardar como PDF" (estilos de impresión).
    await page.emulateMedia({ media: 'print' });
    const printText = norm(await page.evaluate(() => document.body.innerText));
    check(s.id, 'PDF: costo del mes = motor', printText.includes(norm(money)), `no aparece ${money}`);
    if (rate) check(s.id, 'PDF: tarifa = motor', printText.includes(norm(rate)), `no aparece ${rate}`);
    check(s.id, 'PDF: sin NaN/Infinity', !/NaN|Infinity/.test(printText), 'aparece NaN o Infinity');
    await page.emulateMedia({ media: 'screen' });

    const targets = [...r.completeness.pending, ...(r.completeness.notices || [])].filter((p) => typeof p.focus === 'string' && p.focus);
    for (const p of targets) {
      const href = fieldHref(q.id, p.focus);
      await go(`#/cotizaciones/${encodeURIComponent(q.id)}/result`, 300);
      await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      const link = page.locator(`a[href="${href}"]`).first();
      const present = (await link.count()) > 0;
      check(s.id, `"${p.label}": botón "Ir al campo" en el resultado`, present, `falta el enlace ${href}`);
      if (present) await tap(link);
      else await go(href.replace(/^.*#/, '#'), 300);
      const f = await waitFocus(p.focus);
      check(s.id, `"${p.label}": el foco queda en ${p.focus}`, f.name === p.focus, `foco en ${f.name || 'ningún campo'}`);
      if (f.name === p.focus) {
        check(s.id, `"${p.label}": el campo se ve y nada lo tapa`, f.inView && !f.covered, f.inView ? `lo tapa ${f.over}` : 'fuera de la pantalla');
      }
    }
  }
  check('consola', 'sin errores de la app en la consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('red', 'ningún pedido fuera del sitio y del Supabase simulado', blocked.length === 0, blocked.slice(0, 3).join(' | '));
  await context.close();
}

try {
  for (const mode of args.modes) {
    process.stdout.write(`\n=== Test Lab en navegador — ${mode} ===\n`);
    await runMode(mode);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((x) => !x.ok);
const md = [
  '# RATEOS TEST LAB — auditoría en navegador',
  '',
  `Modos: ${args.modes.join(', ')} · escenarios: ${E2E_SCENARIOS.length} · controles: ${results.length} · fallas: ${failed.length}`,
  '',
  '| Modo | Escenario | Control | Estado | Detalle |',
  '|---|---|---|---|---|',
  ...results.map((x) => `| ${x.mode} | ${x.scenario} | ${x.check.replace(/\|/g, '\\|')} | ${x.ok ? 'PASS' : 'FAIL'} | ${x.detail.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
writeFileSync(path.join(outDir, 'ui-lab-report.md'), assertSafeReport(md));
writeFileSync(path.join(outDir, 'ui-lab-report.json'), assertSafeReport(JSON.stringify({ modes: args.modes, scenarios: E2E_SCENARIOS.map((s) => ({ id: s.id, title: s.title })), results }, null, 2)));
process.stdout.write(`\n${results.length - failed.length}/${results.length} controles en verde · reporte: ${path.relative(ROOT, outDir)}/ui-lab-report.md\n`);
if (failed.length) process.exitCode = 1;
