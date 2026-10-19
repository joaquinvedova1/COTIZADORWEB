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
import { service, person, owned, external, material, product, ingredient, worker, fixedCost } from '../lib/build.js';
import { computeProduct } from '../../../js/engines/product-engine.js';
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
  // ---- Decisiones LAB-D1…D8 (PLAN-2026-014): los avisos nuevos llevan a su campo (bucle general) y se ven bien.
  {
    id: 'E2E-11', title: 'D1: 0,5 salidas por mes (transporte): aviso con promedio, costeadas y efecto del redondeo',
    build: () => service({ id: 'lab-e11', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 2, daysPerActivation: 4 }, labor: [person({ role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', fuelLitersPerHour: 8, mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 250, driver: 'operator' } })], logistics: route({ distanceKm: 150, tollsPerActivation: 40000 }) }),
  },
  {
    id: 'E2E-12', title: 'D2: 12 h × 20 días con 1 persona por posición: "más horas de cobertura que las horas cargadas"',
    build: () => service({ id: 'lab-e12', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 12 }, labor: [person({ role: 'Soldador', positions: 2 })] }),
  },
  {
    id: 'E2E-13', title: 'D5: equipo propio "No usa combustible": sin campo de consumo',
    build: () => service({ id: 'lab-e13', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [owned({ name: 'Andamio multidireccional', replacementValue: 30000000, usefulLifeYears: 8, fuelNotApplicable: true })] }),
  },
  {
    id: 'E2E-14', title: 'D7: cotización real nueva con precio de combustible de ejemplo: pide confirmarlo',
    build: () => {
      const q = service({ id: 'lab-e14', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [owned({ name: 'Grupo electrógeno', fuelLitersPerHour: 6 })] });
      q.fuel = { ...q.fuel, illustrative: true, requiresConfirmation: true };
      return q;
    },
  },
  {
    id: 'E2E-15', title: 'D4: cobro por km: km facturables y km de ruta por separado',
    build: () => service({ id: 'lab-e15', serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 2400, unitsPerActiveDay: 400, daysPerActivation: 1 }, labor: [person({ role: 'Chofer' })],
      equipment: [external({ name: 'Camión' }, { price: 3250, unit: 'km', fuelIncluded: true })], logistics: route({ destinationName: 'Añelo', tripsPerActivation: 2 }) }),
  },
  {
    id: 'E2E-16', title: 'D8: on-call: la activación se llama "llamado" en "Cómo se cobra"',
    build: () => service({ id: 'lab-e16', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 5, daysPerActivation: 2 }, labor: [person({ peoplePerPosition: 2 })], logistics: route({ distanceKm: 80, tollsPerActivation: 12000 }) }),
  },
  // ---- ECO-01 (AUD-T1 H-01, H-02, H-03): los avisos nuevos llevan a su campo y las cifras son las del motor.
  {
    id: 'E2E-17', title: 'ECO-01 H-01: proveedor "por salida" con 2 viajes por salida: pide elegir la unidad o confirmarla',
    build: () => service({ id: 'lab-e17', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 18, daysPerActivation: 1 }, labor: [person({ role: 'Coordinador' })],
      equipment: [external({ name: 'Camión cisterna' }, { price: 928000, unit: 'activation', fuelIncluded: true, operatorIncluded: true })], logistics: route({ distanceKm: 160, tripsPerActivation: 2 }) }),
  },
  {
    id: 'E2E-18', title: 'ECO-01 H-01: proveedor "por viaje completo (ida y vuelta)": viajes, tramos y equivalente por km',
    build: () => service({ id: 'lab-e18', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 18, daysPerActivation: 1 }, labor: [person({ role: 'Coordinador' })],
      equipment: [external({ name: 'Camión cisterna' }, { price: 928000, unit: 'trip', tripBasis: 'round_trip', fuelIncluded: true, operatorIncluded: true })], logistics: route({ distanceKm: 160, tripsPerActivation: 2 }) }),
  },
  {
    id: 'E2E-19', title: 'ECO-01 H-02: abono mensual + abono de disponibilidad: crítico y composición de la facturación',
    build: () => service({ id: 'lab-e19', serviceType: 'permanent', unit: 'month', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 22 }, labor: [person({ role: 'Técnico' })],
      pricing: { knownRate: 25000000 }, rules: { availabilityFeeMonthly: 25000000 } }),
  },
  {
    id: 'E2E-20', title: 'ECO-01 H-03: puesto usado sin sueldo básico: crítico, nombra el puesto y lleva al campo',
    build: () => service({ id: 'lab-e20', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Operador de hidrogrúa', basicMonthly: null }), person({ role: 'Rigger' })] }),
  },
];

/** Producto financiado (LAB-D3): la financiación se ve en el Resultado del producto con el costo del motor. */
export const E2E_PRODUCT = () => product({
  id: 'lab-p01', saleUnit: 'unidad', unitsPerBatch: 10, monthlyUnits: 500,
  materials: [ingredient({ description: 'Componente', per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 5200 })],
  labor: [worker({ role: 'Armador', basicMonthly: 1250000, minutesPerBatch: 50 })],
  fixedCosts: [fixedCost({ description: 'Taller', monthlyAmount: 800000, sharePct: 50 })],
  pricing: { targetMarginPct: 20, roundingStep: 10 },
  finance: { invoiceLagDays: 15, paymentTermDays: 60, monthlyRatePct: 3, payDays: { materials: 30, salaries: 30, fuel: 0, suppliers: 30, structure: 30 } },
});

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
  const prod = E2E_PRODUCT();
  Object.assign(prod, { id: randomUUID(), organizationId: orgId, name: 'E2E producto financiado (LAB-D3)', createdAt: now, updatedAt: now });
  ws.state.products = [...(Array.isArray(ws.state.products) ? ws.state.products : []), prod];
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
        ['Km de ruta por mes', `${formatNumber(tr.routeKmPerMonth, { decimals: 2 })} km`],
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
  // ---- Decisiones LAB-D1…D8 (PLAN-2026-014): lo que se ve en pantalla.
  const byId = Object.fromEntries(seeded.map((x) => [x.s.id, x]));
  const screenText = async (id, step) => {
    await go(`#/cotizaciones/${encodeURIComponent(byId[id].q.id)}/${step}`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    // textContent (como los demás rótulos): innerText aplica las mayúsculas del CSS.
    return norm(await page.evaluate(() => document.body.textContent));
  };
  /**
   * ECO-01: en el Resultado (ya abierto), "RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA" está a la
   * vista ARRIBA del margen (no dentro de un bloque plegado), el margen lo repite, y el PDF lo imprime
   * antes del margen.
   */
  const unreliableFirst = async (id, cause) => {
    const info = await page.evaluate(() => {
      const banner = document.querySelector('.qr-draft.qr-unreliable');
      const margin = document.querySelector('.qr-stat-margin');
      const visible = (el) => Boolean(el) && el.offsetParent !== null && !el.closest('details:not([open])');
      return {
        banner: banner ? banner.innerText : null,
        bannerVisible: visible(banner),
        before: Boolean(banner && margin && (banner.compareDocumentPosition(margin) & Node.DOCUMENT_POSITION_FOLLOWING)),
        margin: margin ? margin.innerText : null,
        work: (document.querySelector('.qr-work') || {}).innerText || '',
      };
    });
    check(id, 'ECO-01: "RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA" a la vista, arriba del margen, con la causa', info.bannerVisible && info.before && /RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA/.test(info.banner || '') && cause.test(info.banner || ''), JSON.stringify(info).slice(0, 300));
    check(id, 'ECO-01: el margen dice NO CONFIABLE (no "Ganás")', /NO CONFIABLE/.test(info.margin || '') && !/Ganás/.test(info.margin || ''), norm(info.margin));
    check(id, 'ECO-01: el cálculo de días / equilibrio también dice NO CONFIABLE', /NO CONFIABLE/.test(info.work), norm(info.work).slice(0, 200));
    await page.emulateMedia({ media: 'print' });
    const printed = norm(await page.evaluate(() => document.body.innerText));
    await page.emulateMedia({ media: 'screen' });
    const at = printed.indexOf('RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA');
    const marginAt = printed.indexOf('Margen');
    check(id, 'ECO-01: el PDF imprime "RESULTADO NO CONFIABLE" antes del margen', at >= 0 && marginAt > at, `aviso en ${at}, margen en ${marginAt}`);
  };
  {
    const t = await screenText('E2E-11', 'modality');
    check('E2E-11', 'D1: "Cómo se cobra" muestra salidas promedio, costeadas y el efecto del redondeo', /Salidas promedio por mes: 0,5/.test(t) && /salidas costeadas: 0,5/.test(t) && /efecto del redondeo/i.test(t), 'faltan los tres números');
    check('E2E-11', 'D1: la casilla se llama "Cada salida se cuenta completa"', t.includes('Cada salida se cuenta completa'), 'no aparece el rótulo');
  }
  {
    await screenText('E2E-13', 'equipment');
    const ui = await page.evaluate(() => ({
      flag: Boolean(document.querySelector('input[name="equipment.0.fuelNotApplicable"]') && document.querySelector('input[name="equipment.0.fuelNotApplicable"]').checked),
      consumption: Boolean(document.querySelector('[name="equipment.0.fuelLitersPerHour"]')),
    }));
    check('E2E-13', 'D5: "No usa combustible" marcado y sin campo de consumo', ui.flag && !ui.consumption, JSON.stringify(ui));
  }
  {
    const t = await screenText('E2E-14', 'logistics');
    const confirm = await page.evaluate(() => Boolean(document.querySelector('input[name="fuel.illustrative"]')));
    check('E2E-14', 'D7: el precio de ejemplo se ve ILUSTRATIVO, con su base, y se puede confirmar', confirm && /ILUSTRATIVO de ejemplo/.test(t) && /Base no definida/.test(t), `confirmar: ${confirm}`);
  }
  {
    const t = await screenText('E2E-15', 'modality');
    const at = t.search(/Km facturables/);
    check('E2E-15', 'D4: km facturables y km de ruta por separado', /Km facturables\s*2\.400 km/.test(t) && /Km de ruta por mes\s*2\.400 km/.test(t), `no aparecen los dos: …${at >= 0 ? t.slice(Math.max(0, at - 80), at + 220) : 'sin "Km facturables"'}…`);
  }
  {
    const t = await screenText('E2E-16', 'modality');
    check('E2E-16', 'D8: on-call nombra la activación "llamado" (y nunca "salida")', t.includes('¿Cuántos días dura cada llamado?') && t.includes('Cada llamado se cuenta completo') && !/\bsalidas?\b/i.test(t.replace(/salidas? de caja/gi, '')), 'mezcla nombres');
  }
  // ---- ECO-01 (AUD-T1 H-01, H-02, H-03): lo que se ve en pantalla y los botones de cada aviso.
  {
    const t = await screenText('E2E-17', 'equipment');
    check('E2E-17', 'H-01: "Por salida" con 2 viajes por salida pide elegir o confirmar (18 salidas, 36 viajes, $ 464.000 por viaje)', /¿Cobra por salida o por viaje\?/.test(t) && /18 salidas por mes son 36 viajes/.test(t) && /\$ 464\.000 por viaje/.test(t), 'falta el aviso con sus números');
    const options = await page.evaluate(() => [...(document.querySelector('select[name="equipment.0.external.unit"]') || { options: [] }).options].map((o) => o.textContent));
    check('E2E-17', 'H-01: la unidad ofrece "Por tramo" y "Por viaje completo (ida y vuelta)" por separado', options.includes('Por tramo (cada ida o cada vuelta)') && options.includes('Por viaje completo (ida y vuelta)') && options.includes('Por salida'), options.join(' · '));
    // "Por viaje completo (ida y vuelta)": la línea pasa a 36 viajes y cuesta lo mismo que E2E-18 (mismo dato con la unidad correcta).
    await tap(page.getByRole('button', { name: 'Por viaje completo (ida y vuelta)' }).first());
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({
      unit: (document.querySelector('select[name="equipment.0.external.unit"]') || {}).value,
      cost: (document.querySelector('[data-kpi="totalCost"] .qe-sum-full') || {}).textContent,
      banner: Boolean([...document.querySelectorAll('.qe-unit-confirm')].find((b) => !b.hidden)),
    }));
    const expected = formatMoney(byId['E2E-18'].r.kpis.totalCost);
    check('E2E-17', 'H-01: el botón "Por viaje completo" cambia la unidad, el costo es el del motor y el aviso se va', after.unit === 'trip:round_trip' && norm(after.cost) === norm(expected) && !after.banner, `${JSON.stringify(after)} · motor ${expected}`);
    // Vuelve a "Por salida" y confirma: el aviso se va y el costo vuelve al de "por salida".
    await page.selectOption('select[name="equipment.0.external.unit"]', 'activation');
    await page.waitForTimeout(900);
    await tap(page.getByRole('button', { name: 'Sí, cobra por salida' }).first());
    await page.waitForTimeout(900);
    const confirmed = await page.evaluate(() => ({
      text: document.body.textContent,
      cost: (document.querySelector('[data-kpi="totalCost"] .qe-sum-full') || {}).textContent,
    }));
    check('E2E-17', 'H-01: "Sí, cobra por salida" deja la confirmación a la vista y el costo de siempre', /Confirmado: el proveedor cobra por salida/.test(confirmed.text) && norm(confirmed.cost) === norm(formatMoney(byId['E2E-17'].r.kpis.totalCost)), norm(confirmed.cost));
    // Confirmación ligada al supuesto: con 3 viajes por salida ya no vale y vuelve el crítico.
    // Por el enlace al campo de la app (abre el desplegable donde está).
    await go(fieldHref(byId['E2E-17'].q.id, 'logistics.tripsPerActivation').replace(/^.*#/, '#'), 600);
    await waitFocus('logistics.tripsPerActivation');
    const trips = page.locator('[name="logistics.tripsPerActivation"]').first();
    await trips.scrollIntoViewIfNeeded().catch(() => {});
    await trips.fill('3');
    await trips.press('Tab');
    await page.waitForTimeout(900);
    const t17 = await screenText('E2E-17', 'equipment');
    const stale = await page.evaluate(() => [...document.querySelectorAll('.qe-unit-confirm')].filter((b) => !b.hidden).map((b) => b.textContent));
    check('E2E-17', 'H-01: si cambian los viajes por salida, la confirmación vieja no vale y vuelve el aviso', stale.length === 1 && /La confirmación anterior .*ya no vale: cambió los viajes por salida/.test(stale[0]) && !/Confirmado:/.test(stale[0]) && /3 viajes/.test(t17), JSON.stringify(stale).slice(0, 300));
  }
  {
    const t = await screenText('E2E-18', 'equipment');
    check('E2E-18', 'H-01: viaje completo: 36 viajes completos por mes a $ 928.000 por viaje, equivalente $ 2.900/km', /36 viajes completos\/mes \(ida y vuelta\)/.test(t) && /\$ 928\.000\/viaje/.test(t) && /equivalente \$ 2\.900\/km/.test(t), 'faltan viajes, tarifa o equivalente');
  }
  {
    const t = await screenText('E2E-19', 'margin');
    check('E2E-19', 'H-02: "El precio" avisa los dos abonos con sus montos', /Dos abonos por mes/.test(t) && /\$ 25\.000\.000/.test(t) && /\$ 50\.000\.000 por mes/.test(t), 'falta el aviso');
    await go(`#/cotizaciones/${encodeURIComponent(byId['E2E-19'].q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const comp = norm(await page.evaluate(() => (document.querySelector('.qr-revenue-composition') || {}).textContent || ''));
    const total = formatMoney(byId['E2E-19'].r.estimate.revenue.total);
    check('E2E-19', 'H-02: el Resultado muestra cómo se compone la facturación (abono + disponibilidad = total del motor) y el aviso crítico', /Cómo se compone la facturación del mes/.test(comp) && /Abono mensual \(la tarifa\)\s*\$ 25\.000\.000/.test(comp) && /Abono de disponibilidad\s*\$ 25\.000\.000/.test(comp) && comp.includes(norm(total)) && /Dos abonos por mes/.test(comp), comp.slice(0, 300));
    await unreliableFirst('E2E-19', /Dos abonos por mes/);
  }
  {
    await screenText('E2E-20', 'labor');
    // Sólo los avisos a la vista (el de cada línea existe oculto hasta que la completitud lo marca).
    const shown = await page.evaluate(() => [...document.querySelectorAll('.qe-salary-missing')].filter((b) => !b.hidden).map((b) => b.textContent));
    check('E2E-20', 'H-03: la línea avisa el puesto sin sueldo básico, con su nombre (y sólo esa)', shown.length === 1 && /"Operador de hidrogrúa" no tiene sueldo básico/.test(shown[0]), JSON.stringify(shown));
    const critical = byId['E2E-20'].r.completeness.pending.find((p) => p.id === 'labor');
    check('E2E-20', 'H-03: es crítico en el motor', Boolean(critical && critical.severity === 'critical'), JSON.stringify(critical && critical.severity));
    await go(`#/cotizaciones/${encodeURIComponent(byId['E2E-20'].q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    await unreliableFirst('E2E-20', /Personal/);
  }
  {
    const pr = computeProduct(structuredClone(prod));
    await go(`#/productos/${encodeURIComponent(prod.id)}/resultado`, 300);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const t = norm(await page.evaluate(() => document.body.innerText));
    const unitCost = norm(formatMoney(pr.unitCost, { decimals: 2 }));
    check('E2E-P01', 'D3: el Resultado del producto muestra la financiación', t.includes('Financiación (capital de trabajo)'), 'sin fila de financiación');
    check('E2E-P01', 'D3: costo por unidad = motor (con financiación)', t.includes(unitCost) || t.includes(norm(formatMoney(pr.unitCost))), `no aparece ${unitCost}`);
    // Alcance (LAB-D3): la financiación es sobre costos netos; el IVA de compras no está incluido.
    const NET = /estimación financiera sobre costos netos\. el iva de compras no está incluido en este capital de trabajo\./i;
    check('E2E-P01', 'D3: el Resultado aclara que la financiación es sobre costos netos (sin IVA de compras)', NET.test(t), 'sin la aclaración');
    await go(`#/productos/${encodeURIComponent(prod.id)}/precio`, 300);
    await page.waitForTimeout(600);
    const fields = await page.evaluate(() => ['finance.invoiceLagDays', 'finance.paymentTermDays', 'finance.monthlyRatePct'].every((n) => document.querySelector(`[name="${n}"]`)));
    check('E2E-P01', 'D3: "Precio y margen" tiene los campos de financiación', fields, 'faltan campos');
    const tp = norm(await page.evaluate(() => document.body.innerText));
    check('E2E-P01', 'D3: "Precio y margen" aclara que la financiación es sobre costos netos (sin IVA de compras)', NET.test(tp), 'sin la aclaración');
    await scan('E2E-P01', 'producto');
  }

  // Sesión (PLAN-2026-015): al cerrar sesión no queda nada de la empresa A en
  // pantalla ni en el menú oculto, y otra cuenta que ingresa en la MISMA
  // pestaña (sin recargar) no ve nada de A, ni con los ids de sus cotizaciones.
  {
    const ofA = ['Empresa sintética', email, seeded[0].q.name, seeded[seeded.length - 1].q.name, 'E2E producto financiado'];
    const leaks = (text) => ofA.filter((x) => norm(text).includes(norm(x)));
    await go('#/inicio', 600);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cerrar sesión');
      if (btn) btn.click();
    });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
      visible: document.body.innerText,
      all: document.body.textContent,
      session: localStorage.getItem('rateos.auth'),
    }));
    check('SESION-01', 'al cerrar sesión no queda en pantalla nada de la empresa', leaks(after.visible).length === 0, leaks(after.visible).join(', '));
    check('SESION-01', 'tampoco en el menú y la barra ocultos (DOM)', leaks(after.all).length === 0, leaks(after.all).join(', '));
    check('SESION-01', 'la sesión se borró del navegador', after.session === null, 'quedó rateos.auth');

    // Registro por invitación (HD-03, PLAN-2026-016): sin sesión, #/registro no
    // tiene formulario y nada en la landing ni en el ingreso ofrece crear cuenta.
    await go('#/registro', 800);
    const reg = await page.evaluate(() => ({
      text: document.body.innerText,
      forms: document.querySelectorAll('form').length,
      passwords: document.querySelectorAll('input[type="password"]').length,
    }));
    check('REGISTRO-01', '#/registro explica la beta cerrada por invitación', /beta cerrada/i.test(reg.text) && /invitaci/i.test(reg.text), 'sin el texto de la invitación');
    check('REGISTRO-01', '#/registro no tiene formulario ni campo de contraseña', reg.forms === 0 && reg.passwords === 0, `${reg.forms} formularios, ${reg.passwords} contraseñas`);
    await go('#/', 1000);
    const landing = await page.evaluate(() => {
      const cta = document.querySelector('.pub-header-cta');
      return {
        ctaText: cta ? cta.textContent.trim() : '',
        ctaHref: cta ? cta.getAttribute('href') : '',
        signupLinks: [...document.querySelectorAll('a')].filter((a) => /^#\/registro/.test(a.getAttribute('href') || '') || /Crear cuenta/i.test(a.textContent)).map((a) => a.textContent.trim()),
      };
    });
    check('REGISTRO-01', 'el botón principal de la landing es "Ingresar"', landing.ctaText === 'Ingresar' && landing.ctaHref === '#/login', `${landing.ctaText} → ${landing.ctaHref}`);
    check('REGISTRO-01', 'la landing no ofrece crear cuenta', landing.signupLinks.length === 0, landing.signupLinks.join(', '));
    await go('#/login', 800);
    const loginText = await page.evaluate(() => document.body.innerText);
    check('REGISTRO-01', 'el ingreso no ofrece "Crear cuenta" y sí "¿Olvidaste tu contraseña?"', !/Crear cuenta/.test(loginText) && /¿Olvidaste tu contraseña\?/.test(loginText), 'texto inesperado en el ingreso');

    const emailB = `lab.${mode}.b@rateos.test`;
    const passwordB = `lab-${randomUUID()}`;
    db.createUser({ email: emailB, password: passwordB, fullName: 'Otra persona', company: 'Empresa B sintética' });
    await go('#/login', 800);
    await page.getByLabel('Email').fill(emailB);
    await page.getByLabel('Contraseña', { exact: true }).fill(passwordB);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForTimeout(2500);
    const asB = await page.evaluate(() => ({ visible: document.body.innerText, all: document.body.textContent }));
    check('SESION-02', 'otra cuenta en la misma pestaña: ve su empresa', norm(asB.all).includes('Empresa B sintética'), 'no aparece la empresa B');
    check('SESION-02', 'otra cuenta en la misma pestaña: nada de la empresa anterior (pantalla y DOM)', leaks(asB.all).length === 0, leaks(asB.all).join(', '));
    await go(`#/cotizaciones/${encodeURIComponent(seeded[0].q.id)}/result`, 1500);
    const byId = await page.evaluate(() => document.body.textContent);
    check('SESION-02', 'con el id de una cotización de A, B no ve nada de A', leaks(byId).length === 0, leaks(byId).join(', '));
    await go(`#/productos/${encodeURIComponent(prod.id)}/resultado`, 1500);
    const byProduct = await page.evaluate(() => document.body.textContent);
    check('SESION-02', 'con el id del producto de A, B no ve nada de A', leaks(byProduct).length === 0, leaks(byProduct).join(', '));
    const orgB = db.orgOf(db.users.get(emailB).id);
    const wsB = JSON.stringify(db.workspaces.get(orgB).state || {});
    check('SESION-02', 'nada de A llegó al workspace de B', leaks(wsB).length === 0, leaks(wsB).join(', '));
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
