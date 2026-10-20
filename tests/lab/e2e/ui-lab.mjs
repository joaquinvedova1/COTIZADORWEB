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
import { computeLaborLine } from '../../../js/engines/labor-engine.js';
import { computeOwnership } from '../../../js/engines/equipment-engine.js';
import { laborLineFromProfile } from '../../../js/domain/quote-factory.js';
import { roundMoney } from '../../../js/core/money.js';
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

  // ---- RES-02 Personal (PLAN-2026-023): agrupado por convenio desde la vista de entrada, personas ≠
  // perfiles, subtotales parciales, "Editar sueldo" (bruto = básico + adicionales, sin doble conteo),
  // horas extra con confirmación, cotizaciones que no cambian y convenio borrado sin referencias.
  {
    const R = 'RES-02';
    const PARAMS = { normalHoursPerMonth: 176, overtimePremiumPct: 50, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6 };
    const meta = (id) => ({ id, organizationId: orgId, createdAt: now, updatedAt: now, createdBy: null, updatedBy: null });
    const agreement = (id, code, name) => ({ ...meta(id), code, name, params: { ...PARAMS }, notes: '', illustrative: false });
    const profile = (id, role, agreementId, basic, additionals, o = {}) => ({
      ...meta(id), role, agreementId, category: '', basicMonthly: basic, additionalsMonthly: additionals, mealPerActiveDay: 0, overtimeHoursPerActiveDay: 0,
      ...PARAMS, insuranceMonthly: 35000, ppeMonthly: 40000, trainingMonthly: 0, transferMonthly: 0,
      base: { period: '2026-09', currency: 'ARS', source: 'company', note: '' }, illustrative: false, ...o,
    });
    const agreements = [agreement('res-pp', 'petroleros_privados', 'Petroleros Privados (empresa)'), agreement('res-uocra', 'uocra', 'UOCRA Yacimientos'), agreement('res-fuera', 'fuera_convenio', 'Fuera de convenio')];
    const profiles = [
      profile('res-op', 'Operador de hidrogrúa', 'res-pp', 2800000, 700000, { peopleCount: 2, overtimeHoursPerActiveDay: 2 }),
      profile('res-ch', 'Chofer de camión', 'res-pp', 2300000, 600000, { peopleCount: 3 }),
      profile('res-of', 'Oficial', 'res-uocra', 1600000, 300000, { peopleCount: 4 }),
      profile('res-ca', 'Capataz', 'res-uocra', 2100000, 400000),
      profile('res-ge', 'Gerente de operaciones', 'res-fuera', 6500000, 0, { peopleCount: 1 }),
      profile('res-su', 'Supervisor HSE', null, 3200000, 0),
    ];
    // Una cotización en curso con el operador, armada como la arma la app al agregarlo desde Recursos.
    const linked = service({ id: 'res-q', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [laborLineFromProfile(profiles[0], agreements[0], { id: 'res-q-l1', now })] });
    Object.assign(linked, { id: randomUUID(), organizationId: orgId, code: 'LAB-R01', name: 'RES-02 cotización con el operador', createdAt: now, updatedAt: now });
    const linkedCost = formatMoney(computeQuote(structuredClone(linked)).kpis.totalCost);
    Object.assign(ws.state.resources, { agreements, laborProfiles: profiles });
    ws.state.quotes = [...ws.state.quotes, linked];
    ws.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);

    const perPerson = (p) => computeLaborLine({ ...p, positions: 1, peoplePerPosition: 1 }).perPerson.fixedMonthly;
    const byKey = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const stored = (id) => ((db.workspaces.get(orgId).state.resources || {}).laborProfiles || []).find((p) => p.id === id) || null;
    const storedQuote = () => (db.workspaces.get(orgId).state.quotes || []).find((q) => q.id === linked.id) || null;
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
    const groupsOnScreen = () => page.evaluate(() => [...document.querySelectorAll('.labor-group')].map((d) => ({
      key: d.dataset.group,
      open: d.open,
      title: (d.querySelector('.labor-group-title') || {}).textContent || '',
      counts: (d.querySelector('.labor-group-counts') || {}).textContent || '',
      amount: (d.querySelector('.labor-group-amount') || {}).textContent || '',
      roles: [...d.querySelectorAll('tbody tr')].map((tr) => (tr.querySelector('td') || {}).textContent || ''),
      text: d.textContent,
    })));
    // Acciones "suaves": si el control no existe (estos controles también corren contra `main`, que no
    // tiene la vista), falla el control y la corrida sigue.
    const T = { timeout: 4000 };
    const soft = async (fn) => {
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    };
    const press = (loc) => soft(async () => {
      await loc.scrollIntoViewIfNeeded(T).catch(() => {});
      if (mode === 'mobile') await loc.tap(T);
      else await loc.click(T);
    });
    const openPersonal = async (hash = '#/recursos/personal') => {
      await go(hash, 900);
      await page.waitForSelector('.labor-group', { timeout: 8000 }).catch(() => {});
    };

    await openPersonal();
    const top = await page.evaluate(() => {
      const g = document.querySelector('.labor-group');
      return g ? Math.round(g.getBoundingClientRect().top) : null;
    });
    check(R, 'Recursos → Personal arranca agrupado por convenio y el primer grupo se ve sin desplazar', top !== null && top < viewport.height - 80, `primer grupo a ${top}px (pantalla de ${viewport.height}px)`);
    let groups = await groupsOnScreen();
    check(R, 'grupos en orden: convenios, "Fuera de convenio" y "Sin convenio indicado" al final', groups.map((g) => g.key).join(',') === 'res-pp,res-uocra,fuera,sin', groups.map((g) => g.key).join(','));
    const g = Object.fromEntries(groups.map((x) => [x.key, x]));
    const pp = formatMoney(roundMoney(perPerson(byKey['res-op']) * 2 + perPerson(byKey['res-ch']) * 3));
    check(R, 'convenio completo: "2 perfiles · 5 personas" y el monto = motor (costo por persona × personas)', g['res-pp'] && /Petroleros Privados \(empresa\)/.test(g['res-pp'].title) && norm(g['res-pp'].counts) === '2 perfiles · 5 personas' && norm(g['res-pp'].amount).startsWith(`${norm(pp)} / mes`), JSON.stringify(g['res-pp'] && { counts: g['res-pp'].counts, amount: g['res-pp'].amount, motor: pp }));
    const uocra = formatMoney(roundMoney(perPerson(byKey['res-of']) * 4));
    check(R, 'falta una cantidad: "4 personas en 1 de 2 perfiles" y "Subtotal parcial" (sólo los que tienen cantidad)', g['res-uocra'] && norm(g['res-uocra'].counts) === '4 personas en 1 de 2 perfiles' && norm(g['res-uocra'].amount).startsWith(`Subtotal parcial: ${norm(uocra)} / mes`) && /sólo los perfiles con cantidad cargada/.test(g['res-uocra'].amount), JSON.stringify(g['res-uocra'] && { counts: g['res-uocra'].counts, amount: g['res-uocra'].amount, motor: uocra }));
    check(R, '"Sin convenio indicado": abierto, "Falta el dato", sin monto y con el enlace a Configuración → Convenios', g.sin && g.sin.open && /Falta el dato/.test(g.sin.title) && /Sin monto/.test(g.sin.amount) && norm(g.sin.counts) === '1 perfil · personas sin cargar'
      && (await page.locator('.labor-group-none a[href="#/configuracion/convenios"]').count()) === 1, JSON.stringify(g.sin && { open: g.sin.open, title: g.sin.title, counts: g.sin.counts, amount: g.sin.amount }));
    const summaryText = norm(await page.evaluate(() => (document.querySelector('.labor-summary') || {}).textContent || ''));
    const toolbarCount = norm(await page.evaluate(() => (document.querySelector('.toolbar-count') || {}).textContent || ''));
    check(R, 'personas ≠ perfiles: "6 perfiles en 4 grupos · 10 personas cargadas en 4 perfiles" y la barra cuenta perfiles', summaryText.startsWith('6 perfiles en 4 grupos · 10 personas cargadas en 4 perfiles.') && toolbarCount === '6 perfiles', `${summaryText} | ${toolbarCount}`);
    const rowCosts = await page.evaluate(() => [...document.querySelectorAll('.labor-group tbody tr')].map((tr) => ({ role: (tr.querySelector('td') || {}).textContent || '', cost: (tr.querySelector('td:nth-child(5) strong') || {}).textContent || '' })));
    const costMismatch = profiles.filter((p) => {
      const row = rowCosts.find((r) => norm(r.role).startsWith(p.role));
      return !row || norm(row.cost) !== norm(`${formatMoney(perPerson(p))} / mes`);
    }).map((p) => p.role);
    check(R, 'costo empresa por persona de cada perfil = motor', costMismatch.length === 0, `distinto en: ${costMismatch.join(', ')}`);
    await scan(R, 'Personal por convenio');

    // Plegar / desplegar: con el teclado (escritorio) o tocando (celular); "Plegar todo" no pliega "Sin convenio indicado".
    const ppSummary = page.locator('.labor-group[data-group="res-pp"] > summary');
    await soft(async () => {
      if (mode === 'mobile') await ppSummary.tap(T);
      else {
        await ppSummary.focus(T);
        await page.keyboard.press('Enter');
      }
    });
    await page.waitForTimeout(200);
    const folded = await page.evaluate(() => {
      const d = document.querySelector('.labor-group[data-group="res-pp"]');
      return d ? d.open : null;
    });
    await press(page.getByRole('button', { name: 'Plegar todo', exact: true }));
    await page.waitForTimeout(300);
    groups = await groupsOnScreen();
    const allFolded = groups.length > 1 && groups.filter((x) => x.key !== 'sin').every((x) => !x.open) && Boolean((groups.find((x) => x.key === 'sin') || {}).open);
    await press(page.getByRole('button', { name: 'Desplegar todo', exact: true }));
    await page.waitForTimeout(300);
    groups = await groupsOnScreen();
    check(R, 'un grupo se pliega desde su encabezado; "Plegar todo" / "Desplegar todo" (sin plegar "Sin convenio indicado")', folded === false && allFolded && groups.length > 1 && groups.every((x) => x.open), JSON.stringify({ folded, allFolded, open: groups.map((x) => x.open) }));

    // Búsqueda y filtro en la dirección: se pueden recargar o compartir.
    await soft(() => page.locator('input[name="q"]').fill('capataz', T));
    await page.waitForTimeout(300);
    groups = await groupsOnScreen();
    const hashQ = await page.evaluate(() => window.location.hash);
    check(R, 'buscar "capataz" deja sólo su grupo y su perfil, y queda en la dirección', groups.length === 1 && groups[0].key === 'res-uocra' && groups[0].roles.length === 1 && /Capataz/.test(groups[0].roles[0]) && /[?&]q=capataz(&|$)/.test(hashQ), `${hashQ} · ${JSON.stringify(groups.map((x) => [x.key, x.roles.length]))}`);
    await page.reload();
    await page.waitForTimeout(2500);
    await page.waitForSelector('.labor-group', { timeout: 8000 }).catch(() => {});
    groups = await groupsOnScreen();
    const kept = await page.evaluate(() => (document.querySelector('input[name="q"]') || {}).value);
    check(R, 'al recargar, la búsqueda sigue (campo y resultados)', kept === 'capataz' && groups.length === 1 && groups[0].roles.length === 1, `campo "${kept}" · ${groups.length} grupos`);
    await openPersonal('#/recursos/personal?convenio=fuera');
    groups = await groupsOnScreen();
    const selected = await page.evaluate(() => (document.querySelector('select[name="convenio"]') || {}).value);
    await soft(() => page.selectOption('select[name="convenio"]', '', T));
    await page.waitForTimeout(300);
    const cleared = await page.evaluate(() => ({ hash: window.location.hash, groups: document.querySelectorAll('.labor-group').length }));
    check(R, 'filtro por convenio desde la dirección ("Fuera de convenio") y "Todos los convenios" lo quita', selected === 'fuera' && groups.length === 1 && groups[0].key === 'fuera' && cleared.groups === 4 && !/convenio=/.test(cleared.hash), JSON.stringify({ selected, groups: groups.map((x) => x.key), cleared }));

    // "Editar sueldo" del chofer (sin horas extra): bruto + básico → adicionales; vista previa = motor; mes base obligatorio.
    await openPersonal();
    await press(page.getByRole('button', { name: 'Editar sueldo de Chofer de camión', exact: true }));
    await page.waitForSelector('dialog[open] [name="salary.gross"]', { timeout: 3000 }).catch(() => {});
    const dlg = page.locator('dialog[open]');
    const prefilled = await dlg.evaluate((d) => ({ gross: d.querySelector('[name="salary.gross"]').value, basic: d.querySelector('[name="salary.basic"]').value, period: d.querySelector('[name="salary.period"]').value }), null, T).catch(() => ({}));
    check(R, '"Editar sueldo" abre con el bruto (básico + adicionales), el básico y el mes base', /2\.?900\.?000/.test(prefilled.gross) && /2\.?300\.?000/.test(prefilled.basic) && prefilled.period === '2026-09', JSON.stringify(prefilled));
    await soft(() => dlg.locator('[name="salary.gross"]').fill('3190000', T));
    await soft(() => dlg.locator('[name="salary.basic"]').fill('2530000', T));
    await page.waitForTimeout(300);
    const nextCh = { ...byKey['res-ch'], basicMonthly: 2530000, additionalsMonthly: 660000 };
    const preview = await dlg.evaluate((d) => ({
      after: Number((d.querySelector('[data-cost-after]') || { dataset: {} }).dataset.costAfter),
      before: Number((d.querySelector('[data-cost-before]') || { dataset: {} }).dataset.costBefore),
      additionals: (d.querySelector('.salary-additionals') || {}).textContent || '',
      samePeriod: [...d.querySelectorAll('p')].some((p) => !p.hidden && /¿El sueldo nuevo es del mismo mes base\?/.test(p.textContent)),
      overflow: d.scrollWidth - d.clientWidth,
    }), null, T).catch(() => ({ after: NaN, before: NaN, additionals: '', samePeriod: false, overflow: NaN }));
    check(R, 'vista previa: costo empresa por persona antes → después = motor, y adicionales = bruto − básico', Math.abs(preview.before - perPerson(byKey['res-ch'])) < 0.01 && Math.abs(preview.after - perPerson(nextCh)) < 0.01 && norm(preview.additionals).includes(norm(formatMoney(660000))), `${JSON.stringify(preview)} · motor ${perPerson(byKey['res-ch'])} → ${perPerson(nextCh)}`);
    check(R, 'con el sueldo cambiado y el mismo mes, pregunta si el mes base es el mismo', preview.samePeriod, 'sin la pregunta');
    check(R, '"Editar sueldo": sin scroll horizontal en el diálogo', preview.overflow <= 1, `${preview.overflow}px de más`);
    await soft(() => dlg.locator('[name="salary.period"]').fill('', T));
    await press(dlg.getByRole('button', { name: 'Guardar sueldo', exact: true }));
    await page.waitForTimeout(500);
    const periodError = await dlg.evaluate((d) => (d.querySelector('.salary-error') || {}).textContent || '', null, T).catch(() => '');
    check(R, 'sueldo cambiado sin mes base: no guarda y pide el mes', /Cargá el mes base del sueldo nuevo/.test(periodError) && stored('res-ch').basicMonthly === 2300000, `${periodError} · básico guardado ${stored('res-ch').basicMonthly}`);
    await soft(() => dlg.locator('[name="salary.period"]').fill('2026-10', T));
    await press(dlg.getByRole('button', { name: 'Guardar sueldo', exact: true }));
    await page.waitForTimeout(1200);
    const ch = stored('res-ch');
    check(R, 'guardado: básico 2.530.000 + adicionales 660.000 (= bruto 3.190.000, sin sumar dos veces) y mes 2026-10', ch && ch.basicMonthly === 2530000 && ch.additionalsMonthly === 660000 && ch.base && ch.base.period === '2026-10' && (await page.locator('dialog[open]').count()) === 0, JSON.stringify(ch && { b: ch.basicMonthly, a: ch.additionalsMonthly, base: ch.base }));
    const chRow = norm(await page.evaluate(() => {
      const tr = [...document.querySelectorAll('.labor-group tbody tr')].find((r) => /Chofer de camión/.test(r.textContent));
      return tr ? tr.textContent : '';
    }));
    check(R, 'la fila muestra el bruto nuevo con su básico y el costo del motor', chRow.includes(norm(formatMoney(3190000))) && chRow.includes(`básico ${norm(formatMoney(2530000))}`) && chRow.includes(norm(`${formatMoney(perPerson(nextCh))} / mes`)), chRow.slice(0, 300));

    // Operador con horas extra (en el perfil y en una cotización): sin básico hay que confirmar; la cotización no cambia.
    const quoteBefore = canon(storedQuote());
    await press(page.getByRole('button', { name: 'Editar sueldo de Operador de hidrogrúa', exact: true }));
    await page.waitForSelector('dialog[open] [name="salary.gross"]', { timeout: 3000 }).catch(() => {});
    await soft(() => dlg.locator('[name="salary.gross"]').fill('3850000', T));
    await page.waitForTimeout(200);
    const hintShown = await dlg.evaluate((d) => {
      const p = d.querySelector('.salary-basic-hint');
      return Boolean(p && !p.hidden && /El bruto cambió y el básico no/.test(p.textContent));
    }, null, T).catch(() => false);
    check(R, 'el bruto cambió y el básico no: lo dice (RATEOS no sube el básico solo)', hintShown, 'sin el aviso');
    await soft(() => dlg.locator('[name="salary.basic"]').fill('', T));
    await soft(() => dlg.locator('[name="salary.period"]').fill('2026-10', T));
    await page.waitForTimeout(300);
    const ot = await dlg.evaluate((d) => ({ text: d.textContent, box: Boolean(d.querySelector('input[name="salary.overtimeOnGross"]')) }), null, T).catch(() => ({ text: '', box: false }));
    check(R, 'horas extra sin básico: lo avisa (perfil y 1 cotización), ofrece valuarlas sobre el bruto y dice que el bruto se guarda como básico', ot.box && /Horas extra: el perfil tiene horas extra y 1 cotización que lo usa tiene horas extra/.test(norm(ot.text)) && /Sin el básico, el bruto completo se guarda como básico/.test(norm(ot.text)), norm(ot.text).slice(0, 300));
    check(R, 'el diálogo avisa que las cotizaciones hechas no cambian', /Las cotizaciones hechas no cambian\. La cotización en curso o ganada que usa este perfil te va a avisar/.test(norm(ot.text)), 'sin el aviso');
    await press(dlg.getByRole('button', { name: 'Guardar sueldo', exact: true }));
    await page.waitForTimeout(500);
    const otError = await dlg.evaluate((d) => (d.querySelector('.salary-error') || {}).textContent || '', null, T).catch(() => '');
    check(R, 'sin confirmar no guarda: no asume en silencio que el bruto completo es el básico', /Este perfil se usa con horas extra: cargá el básico o marcá/.test(otError) && stored('res-op').basicMonthly === 2800000, `${otError} · básico guardado ${stored('res-op').basicMonthly}`);
    await soft(() => dlg.locator('input[name="salary.overtimeOnGross"]').check(T));
    await press(dlg.getByRole('button', { name: 'Guardar sueldo', exact: true }));
    await page.waitForTimeout(1200);
    const op = stored('res-op');
    check(R, 'confirmado: guarda el bruto como básico y adicionales 0', op && op.basicMonthly === 3850000 && op.additionalsMonthly === 0 && op.base && op.base.period === '2026-10', JSON.stringify(op && { b: op.basicMonthly, a: op.additionalsMonthly, base: op.base }));
    check(R, 'la cotización guardada que usa el perfil no cambió (ni una coma)', canon(storedQuote()) === quoteBefore, 'cambió la cotización guardada');
    await go(`#/cotizaciones/${encodeURIComponent(linked.id)}/labor`, 600);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    const inQuote = await page.evaluate(() => ({ text: document.body.textContent, cost: (document.querySelector('[data-kpi="totalCost"] .qe-sum-full') || {}).textContent || '' }));
    check(R, 'la cotización avisa que el recurso cambió y conserva su costo hasta que se actualice', inQuote.text.includes('El costo de "Operador de hidrogrúa" fue actualizado desde que hiciste esta cotización.') && norm(inQuote.cost) === norm(linkedCost), `costo ${norm(inQuote.cost)} · antes ${linkedCost}`);

    // Borrar un convenio en uso: sus perfiles quedan "Sin convenio indicado", sin un id que ya no existe.
    await go('#/configuracion/convenios', 900);
    await press(page.getByRole('button', { name: 'Eliminar UOCRA Yacimientos', exact: true }));
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    const askText = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || {}).textContent || ''));
    await press(page.locator('dialog[open]').getByRole('button', { name: 'Eliminar', exact: true }));
    await page.waitForTimeout(1200);
    const left = ['res-of', 'res-ca'].map((id) => stored(id));
    const st = db.workspaces.get(orgId).state.resources;
    check(R, 'borrar un convenio en uso: lo avisa y sus perfiles quedan sin convenio (null, no un id borrado)', /Hay 2 perfiles de personal que lo usan: quedarán sin convenio asignado/.test(askText) && !st.agreements.some((a) => a.id === 'res-uocra') && left.every((p) => p && p.agreementId === null), `${askText.slice(0, 160)} · ${JSON.stringify(left.map((p) => p && p.agreementId))}`);
    await openPersonal();
    groups = await groupsOnScreen();
    const none = groups.find((x) => x.key === 'sin');
    check(R, 'y se ven en "Sin convenio indicado" con sus personas', groups.length === 3 && none && none.roles.length === 3 && norm(none.counts) === '4 personas en 1 de 3 perfiles', JSON.stringify(groups.map((x) => [x.key, x.counts])));

    // "Lista" y "Detallada" siguen.
    await press(page.getByRole('button', { name: 'Lista', exact: true }));
    await page.waitForTimeout(400);
    const flat = await page.evaluate(() => ({ groups: document.querySelectorAll('.labor-group').length, rows: document.querySelectorAll('.lib-table tbody tr').length }));
    await press(page.getByRole('button', { name: 'Por convenio', exact: true }));
    await page.waitForTimeout(400);
    check(R, '"Lista" muestra todos los perfiles en una tabla y "Por convenio" vuelve', flat.groups === 0 && flat.rows === 6 && (await page.locator('.labor-group').count()) === 3, JSON.stringify(flat));
    await scan(R, 'Personal (al final)');
    if (args.shots) await page.screenshot({ path: path.join(outDir, `${mode}-RES-02-personal.png`), fullPage: true });
    // Ningún diálogo abierto para lo que sigue.
    for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()) > 0; i += 1) await page.keyboard.press('Escape');
  }

  // ---- RES-02 Equipos (PLAN-2026-024): agrupados por familia (vacío y pozo aparte de los camiones),
  // unidades propias ≠ alquiladas o tercerizadas (no suman), posesión de la flota propia = motor,
  // otra moneda sin tipo de cambio como subtotal parcial, búsqueda y filtro en la dirección.
  {
    const R = 'RES-02-EQ';
    const T = { timeout: 4000 };
    const soft = async (fn) => {
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    };
    const press = (loc) => soft(async () => {
      await loc.scrollIntoViewIfNeeded(T).catch(() => {});
      if (mode === 'mobile') await loc.tap(T);
      else await loc.click(T);
    });
    const ars = { period: '2026-09', currency: 'ARS', source: 'company', note: '' };
    const meta = (id) => ({ id, organizationId: orgId, createdAt: now, updatedAt: now, createdBy: null, updatedBy: null });
    const own = (id, name, familyId, o = {}) => ({
      ...meta(id), name, internalCode: '', familyId, capacity: '', modelId: null, year: null, plate: '', acquisition: 'owned', currentValue: 0,
      replacementValue: 120000000, usefulLifeYears: 10, residualValue: 20000000, insuranceAnnual: 2400000, licenseAnnual: 600000, certificationsAnnual: 300000,
      otherAnnual: 0, capitalRatePctAnnual: 8, maintenancePerHour: 9000, tiresPerHour: 2000, fuelLitersPerHour: 12, availableHoursPerMonth: 200,
      availableDaysPerMonth: 22, utilizationPct: 60, external: null, base: { ...ars }, costsBase: { ...ars }, illustrative: false, ...o,
    });
    const ext = (id, name, familyId, acquisition, price, unit) => ({
      ...meta(id), name, internalCode: '', familyId, capacity: '', modelId: null, year: null, plate: '', acquisition,
      external: { supplier: 'Proveedor sintético', price, unit, minimumUnits: 0, includes: {}, fuelIncluded: true, operatorIncluded: acquisition === 'outsourced' },
      base: { ...ars }, costsBase: { ...ars }, illustrative: false,
    });
    const units = [
      own('eq-hg1', 'Hidrogrúa 30 t·m', 'crane_truck', { internalCode: 'HG-01', replacementValue: 180000000 }),
      own('eq-hg2', 'Hidrogrúa 30 t·m', 'crane_truck', { internalCode: 'HG-02', replacementValue: 180000000 }),
      ext('eq-gr50', 'Grúa 50 t', 'crane', 'rented', 1800000, 'day'),
      own('eq-cam', 'Camión 6x4', 'truck', { internalCode: 'CA-01' }),
      own('eq-vac', 'Vactor 12 yd³', 'vactor', { internalCode: 'VC-01', replacementValue: 260000000 }),
      ext('eq-atm', 'Camión atmosférico', 'vacuum_truck', 'outsourced', 950000, 'day'),
      own('eq-fb', 'Flushby', 'flushby', { internalCode: 'FB-01', replacementValue: 320000000 }),
      own('eq-wl', 'Unidad de wireline', 'wireline', { internalCode: 'WL-01', replacementValue: 410000000 }),
      own('eq-leg', 'Batea (tipo anterior)', undefined, { type: 'trailer', internalCode: 'BT-07', fuelLitersPerHour: 0, fuelNotApplicable: true }),
      own('eq-pk', 'Camioneta 4x4', 'pickup', { internalCode: 'PK-01', replacementValue: 45000000 }),
      ext('eq-pk2', 'Camioneta 4x4 (alquiler)', 'pickup', 'rented', 2600000, 'month'),
      own('eq-exc', 'Excavadora 20 t', 'excavator', { internalCode: 'EX-01', replacementValue: 210000, residualValue: 40000, base: { ...ars, currency: 'USD' } }),
      own('eq-otro', 'Hidrolavadora industrial', 'other', { internalCode: 'HL-01', replacementValue: 8000000 }),
    ];
    ws.state.resources.equipment = units;
    ws.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);
    const byId = Object.fromEntries(units.map((u) => [u.id, u]));
    const holding = (id) => computeOwnership(byId[id]).totalMonthly;
    const storedUnits = () => canon((db.workspaces.get(orgId).state.resources || {}).equipment || []);
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
    const groupsOnScreen = () => page.evaluate(() => [...document.querySelectorAll('.equipment-group')].map((d) => ({
      id: d.dataset.group,
      open: d.open,
      title: (d.querySelector('.equipment-group-title') || {}).textContent || '',
      counts: (d.querySelector('.equipment-group-counts') || {}).textContent || '',
      amount: (d.querySelector('.equipment-group-amount') || {}).textContent || '',
      rows: [...d.querySelectorAll('tbody tr')].map((tr) => ({ name: (tr.querySelector('td') || {}).textContent || '', holding: (tr.querySelector('td:nth-child(3)') || {}).textContent || '' })),
    })));
    const openEquipment = async (hash = '#/recursos/equipos') => {
      await go(hash, 900);
      await page.waitForSelector('.equipment-group', { timeout: 8000 }).catch(() => {});
    };
    const before = storedUnits();

    await openEquipment();
    const top = await page.evaluate(() => {
      const g = document.querySelector('.equipment-group');
      return g ? Math.round(g.getBoundingClientRect().top) : null;
    });
    check(R, 'Recursos → Equipos arranca agrupado por familia y el primer grupo se ve sin desplazar', top !== null && top < viewport.height - 80, `primer grupo a ${top}px (pantalla de ${viewport.height}px)`);
    let groups = await groupsOnScreen();
    check(R, 'grupos en orden fijo: grúas, camiones, vacío, pozo, remolques, livianos, movimiento de suelo y "Otros / sin familia"', groups.map((g) => g.id).join(',') === 'cranes,trucks,vacuum,well,trailers,light,earthmoving,other', groups.map((g) => g.id).join(','));
    const g = Object.fromEntries(groups.map((x) => [x.id, x]));
    const names = (id) => (g[id] ? g[id].rows.map((r) => norm(r.name)) : []);
    check(R, 'vactor, camión atmosférico, flushby y wireline no van con los camiones (revisión de ChatGPT, punto 6)', names('trucks').length === 1 && /Camión 6x4/.test(names('trucks')[0])
      && /Equipos de vacío y succión/.test(g.vacuum && g.vacuum.title) && names('vacuum').some((n) => /Vactor/.test(n)) && names('vacuum').some((n) => /Camión atmosférico/.test(n))
      && /Equipos de pozo/.test(g.well && g.well.title) && names('well').length === 2, JSON.stringify({ trucks: names('trucks'), vacuum: names('vacuum'), well: names('well') }));
    const cranes = formatMoney(roundMoney(holding('eq-hg1') + holding('eq-hg2')));
    check(R, 'grúas: "2 unidades propias · 1 alquilada o tercerizada (no suma)" y posesión = motor, sin la alquilada', g.cranes && norm(g.cranes.counts) === '2 unidades propias · 1 alquilada o tercerizada (no suma)' && norm(g.cranes.amount).startsWith(`${norm(cranes)} / mes`), JSON.stringify(g.cranes && { counts: g.cranes.counts, amount: g.cranes.amount, motor: cranes }));
    const rowMismatch = ['eq-hg1', 'eq-cam', 'eq-vac', 'eq-fb', 'eq-wl', 'eq-leg', 'eq-pk', 'eq-otro'].filter((id) => {
      const row = groups.flatMap((x) => x.rows).find((r) => norm(r.name).includes(byId[id].internalCode));
      return !row || !norm(row.holding).startsWith(`${norm(formatMoney(holding(id)))} / mes`);
    });
    check(R, 'posesión por mes de cada unidad propia = motor', rowMismatch.length === 0, `distinta en: ${rowMismatch.join(', ')}`);
    const rented = groups.flatMap((x) => x.rows).find((r) => /Grúa 50 t/.test(r.name));
    check(R, 'una alquilada muestra su tarifa, no una posesión', Boolean(rented) && /1\.800\.000/.test(norm(rented.holding)) && !/\/ mes/.test(norm(rented.holding)), JSON.stringify(rented));
    check(R, 'el tipo anterior "trailer" cae en "Remolques y tanques" y "Otro" en "Otros / sin familia"', names('trailers').some((n) => /Batea/.test(n)) && names('other').some((n) => /Hidrolavadora/.test(n)), JSON.stringify({ trailers: names('trailers'), other: names('other') }));
    const summaryText = norm(await page.evaluate(() => (document.querySelector('.equipment-summary') || {}).textContent || ''));
    check(R, 'otra moneda sin tipo de cambio: no se suma (grupo sin monto, "subtotal parcial" arriba) y lo dice en la fila', g.earthmoving && /Sin monto: la unidad propia está valuada en otra moneda sin tipo de cambio/.test(g.earthmoving.amount)
      && /Valor en USD/.test(norm(g.earthmoving.rows[0] && g.earthmoving.rows[0].holding)) && /subtotal parcial/.test(summaryText), `${g.earthmoving && g.earthmoving.amount} | ${summaryText.slice(0, 200)}`);
    check(R, 'el resumen cuenta propias y, aparte, alquiladas o tercerizadas (no suman)', summaryText.startsWith('10 unidades propias · 3 alquiladas o tercerizadas (no suman)'), summaryText.slice(0, 160));
    await scan(R, 'Equipos por familia');

    // "Ver cálculo" de la posesión: termina en el número de la fila.
    await press(page.locator('.equipment-group[data-group="cranes"] tbody tr').first().locator('.trace-btn'));
    await page.waitForSelector('dialog[open]', T).catch(() => {});
    const trace = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || {}).textContent || ''));
    check(R, '"Ver cálculo" de la posesión termina en el número de la fila', /COSTO DE POSESIÓN mensual/.test(trace) && trace.includes(norm(formatMoney(holding('eq-hg1')))), trace.slice(0, 200));
    for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()) > 0; i += 1) await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Búsqueda y filtro en la dirección.
    await soft(() => page.locator('input[name="q"]').fill('fb-01', T));
    await page.waitForTimeout(300);
    groups = await groupsOnScreen();
    const hashQ = await page.evaluate(() => window.location.hash);
    check(R, 'buscar por interno ("fb-01") deja sólo esa unidad y queda en la dirección', groups.length === 1 && groups[0].rows.length === 1 && /Flushby/.test(groups[0].rows[0].name) && /[?&]q=fb-01(&|$)/.test(hashQ), `${hashQ} · ${JSON.stringify(groups.map((x) => [x.id, x.rows.length]))}`);
    await openEquipment('#/recursos/equipos?tenencia=externas');
    groups = await groupsOnScreen();
    const sel = await page.evaluate(() => (document.querySelector('select[name="tenencia"]') || {}).value);
    check(R, 'filtro "Sólo alquiladas o tercerizadas" desde la dirección: sus grupos, sin montos de posesión', sel === 'externas' && groups.map((x) => x.id).join(',') === 'cranes,vacuum,light' && groups.every((x) => /Sin unidades propias/.test(x.amount)), JSON.stringify({ sel, groups: groups.map((x) => [x.id, norm(x.amount).slice(0, 40)]) }));
    await soft(() => page.selectOption('select[name="tenencia"]', '', T));
    await page.waitForTimeout(300);
    const cleared = await page.evaluate(() => ({ hash: window.location.hash, groups: document.querySelectorAll('.equipment-group').length }));
    check(R, '"Todas" quita el filtro de la dirección', cleared.groups === 8 && !/tenencia=/.test(cleared.hash), JSON.stringify(cleared));

    // Plegar / desplegar y las otras vistas.
    await openEquipment();
    await press(page.getByRole('button', { name: 'Plegar todo', exact: true }));
    await page.waitForTimeout(300);
    // Con grupos: sin grupos, "todos plegados" sería cierto sin probar nada.
    const afterFold = await groupsOnScreen();
    const folded = afterFold.length > 0 && afterFold.every((x) => !x.open);
    await press(page.getByRole('button', { name: 'Desplegar todo', exact: true }));
    await page.waitForTimeout(300);
    const afterUnfold = await groupsOnScreen();
    const unfolded = afterUnfold.length > 0 && afterUnfold.every((x) => x.open);
    check(R, '"Plegar todo" / "Desplegar todo"', folded && unfolded, JSON.stringify({ folded, unfolded, groups: afterUnfold.length }));
    await press(page.getByRole('button', { name: 'Lista', exact: true }));
    await page.waitForTimeout(400);
    const flat = await page.evaluate(() => ({ groups: document.querySelectorAll('.equipment-group').length, rows: document.querySelectorAll('.lib-table tbody tr').length }));
    await press(page.getByRole('button', { name: 'Por familia', exact: true }));
    await page.waitForTimeout(400);
    check(R, '"Lista" muestra todas las fichas en una tabla y "Por familia" vuelve', flat.groups === 0 && flat.rows === units.length && (await page.locator('.equipment-group').count()) === 8, JSON.stringify(flat));
    check(R, 'ver, buscar y filtrar no cambia ninguna ficha guardada', storedUnits() === before, 'cambió una ficha guardada');
    await scan(R, 'Equipos (al final)');
    if (args.shots) await page.screenshot({ path: path.join(outDir, `${mode}-RES-02-equipos.png`), fullPage: true });
    for (let i = 0; i < 3 && (await page.locator('dialog[open]').count()) > 0; i += 1) await page.keyboard.press('Escape');
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
