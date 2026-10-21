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
 *   - ECO-02: "No confiable" fuera del Resultado (lista, Inicio, Escenarios), en los
 *     cuatro números y en el PDF; "Enviada" bloqueada con un resultado NO CONFIABLE
 *     (Resultado, lista y editor) y confirmada con pendientes críticos
 *   - ECO-03: el múltiplo fijo guardado se conserva y avisa, margen objetivo y real, pasar a automático
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
  // ---- ECO-03 (VAL-01-F1): una cotización de antes con el múltiplo fijo de $ 1.000 en $/ton-km.
  {
    id: 'E2E-21', title: 'ECO-03: $/ton-km con el múltiplo fijo de $ 1.000 guardado: aviso, margen objetivo y real, y pasar a automático',
    build: () => service({ id: 'lab-e21', serviceType: 'transport', unit: 'tonkm', activity: { billableQuantityPerMonth: 25000, unitsPerActiveDay: 1250, availableDaysPerMonth: 30 }, labor: [person({ role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', replacementValue: 300000000, usefulLifeYears: 10 })], pricing: { roundingMode: 'step', roundingStep: 1000 } }),
  },
  // ---- ECO-04 (AUD-T1 H-04, H-08 y VAL-01-F2): avisos verificables; las cifras son las del motor.
  {
    id: 'E2E-22', title: 'ECO-04 H-04: abono con 26 días trabajados y 22 disponibles: NO CONFIABLE, lleva a los días disponibles',
    build: () => service({ id: 'lab-e22', serviceType: 'crew', unit: 'month', activity: { activeDaysPerMonth: 26, availableDaysPerMonth: 22 }, labor: [person({ role: 'Técnico' })] }),
  },
  {
    id: 'E2E-23', title: 'ECO-04 H-08: camioneta sólo como vehículo de apoyo: crítico hasta decir dónde está su costo de tenerlo',
    build: () => service({ id: 'lab-e23', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20 }, labor: [person({ role: 'Técnico' })],
      equipment: [owned({ id: 'lab-e23-herr', name: 'Herramientas', mobilization: { mode: 'support', supportVehicleId: 'lab-e23-veh' } })],
      logistics: route({ distanceKm: 60, vehicles: [{ id: 'lab-e23-veh', name: 'Camioneta', count: 1, consumptionLPer100Km: 13, costPerKm: 60 }] }) }),
  },
  {
    id: 'E2E-24', title: 'ECO-04 F2: camión tercerizado con chofer y un "Chofer del camión" en Personal: se pregunta y se confirma',
    build: () => service({ id: 'lab-e24', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 18, daysPerActivation: 1 }, labor: [person({ role: 'Chofer del camión' })],
      equipment: [external({ name: 'Camión volcador' }, { price: 450000, unit: 'day', fuelIncluded: true, operatorIncluded: true, mobilizationIncluded: true })], logistics: route({ distanceKm: 40 }) }),
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
  // ---- ECO-04 (AUD-T1 H-04, H-08 y VAL-01-F2): lo que se ve, los botones de cada aviso y lo que se guarda.
  // Las cifras son las del motor en el bucle general (y no cambian al responder).
  {
    const storedQuote = (id) => (db.workspaces.get(orgId).state.quotes || []).find((x) => x.id === id) || null;
    const waitStored = async (id, test) => {
      let q = null;
      for (let i = 0; i < 20; i += 1) {
        q = storedQuote(id);
        if (q && test(q)) break;
        await page.waitForTimeout(150);
      }
      return q;
    };
    const pendingIds = () => page.evaluate(() => [...document.querySelectorAll('.qr-checklist a[href*="campo="]')].map((a) => decodeURIComponent((a.getAttribute('href') || '').split('campo=')[1] || '')));

    // H-04: abono con más días que disponibles → RESULTADO NO CONFIABLE con la causa; el aviso ya no dice "reemplazan por 0".
    const e22 = byId['E2E-22'];
    check('E2E-22', 'H-04: el motor lo marca crítico y no confiable', Boolean(e22.r.completeness.pending.find((p) => p.id === 'month_days_overflow' && p.severity === 'critical' && p.unreliable === true)), 'sin el pendiente');
    await go(`#/cotizaciones/${encodeURIComponent(e22.q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    await unreliableFirst('E2E-22', /Días trabajados del abono/);
    const e22text = norm(await page.evaluate(() => document.body.innerText));
    check('E2E-22', 'H-04: el aviso dice los días y los abonos (26 con 22: 1,18)', /26 días trabajados por mes con 22 días disponibles/.test(e22text) && /1,18 abonos/.test(e22text), 'sin los números');
    check('E2E-22', 'H-04: ningún aviso dice que los cálculos reemplazan valores por 0', !/reemplazan los valores inválidos/.test(e22text), 'sigue el texto viejo');

    // H-08: "Costo de tenerlo" en Logística; "Ya está en el costo por km" saca el crítico y no cambia las cifras.
    const e23 = byId['E2E-23'];
    check('E2E-23', 'H-08: el motor pide el costo de tenerlo del vehículo (crítico)', Boolean(e23.r.completeness.pending.find((p) => p.id === 'vehicle_ownership_costs' && p.severity === 'critical')), 'sin el pendiente');
    await go(`#/cotizaciones/${encodeURIComponent(e23.q.id)}/logistics`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    const ownership = page.locator('select[name="logistics.vehicles.0.ownershipCostsIn"]').first();
    const hasOwnership = (await ownership.count()) > 0;
    check('E2E-23', 'H-08: el vehículo tiene "Costo de tenerlo" con "Ya está en el costo por km" y las líneas de Equipos', hasOwnership && await ownership.evaluate((el) => [...el.options].some((o) => o.value === 'per_km') && [...el.options].some((o) => /En Equipos: Herramientas/.test(o.textContent))), 'sin el campo');
    if (hasOwnership) {
      await ownership.selectOption('per_km');
      const saved = await waitStored(e23.q.id, (q) => q.logistics && q.logistics.vehicles[0] && q.logistics.vehicles[0].ownershipCostsIn === 'per_km');
      check('E2E-23', 'H-08: la respuesta se guarda en la cotización', Boolean(saved) && saved.logistics.vehicles[0].ownershipCostsIn === 'per_km', saved ? JSON.stringify(saved.logistics.vehicles[0].ownershipCostsIn) : 'sin guardar');
      await go(`#/cotizaciones/${encodeURIComponent(e23.q.id)}/result`, 300);
      await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
      const after = await pendingIds();
      const cost = norm(await page.evaluate(() => document.body.innerText));
      check('E2E-23', 'H-08: respondido, el pendiente se va y el costo del mes es el mismo', !after.some((x) => /ownershipCostsIn/.test(x)) && cost.includes(norm(formatMoney(e23.r.kpis.totalCost))), JSON.stringify(after));
    }

    // F2: Equipos pregunta y "Ningún puesto de Personal lo opera" lo confirma (ligado a ese puesto).
    const e24 = byId['E2E-24'];
    check('E2E-24', 'F2: el motor pregunta por el operador (para revisar)', Boolean(e24.r.completeness.pending.find((p) => p.id === 'duplicates' && p.severity === 'review' && p.focus === 'equipment.0.operatorLaborId')), 'sin el pendiente');
    await go(`#/cotizaciones/${encodeURIComponent(e24.q.id)}/equipment`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const scope = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.qe-operator-scope')].find((x) => !x.closest('[hidden]') && x.offsetParent !== null && !x.classList.contains('is-confirmed'));
      return b ? b.innerText : '';
    });
    check('E2E-24', 'F2: Equipos pregunta si el "Chofer del camión" opera el camión que ya trae operador', /¿Lo opera alguien de tu Personal\?/.test(scope) && /Chofer del camión/.test(scope) && /Camión volcador/.test(scope), norm(scope).slice(0, 200));
    const confirm = page.getByRole('button', { name: 'Ningún puesto de Personal lo opera' }).first();
    if (await confirm.isVisible().catch(() => false)) {
      await tap(confirm);
      const saved = await waitStored(e24.q.id, (q) => q.equipment[0] && q.equipment[0].operatorBySupplier);
      const labor = saved && saved.equipment[0].operatorBySupplier && saved.equipment[0].operatorBySupplier.labor;
      check('E2E-24', 'F2: la confirmación se guarda ligada a ese puesto (id y nombre)', Array.isArray(labor) && labor.length === 1 && labor[0].role === 'Chofer del camión' && labor[0].id === saved.labor[0].id, JSON.stringify(labor));
      await page.waitForTimeout(400);
      const confirmed = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.qe-operator-scope.is-confirmed')].find((x) => !x.closest('[hidden]') && x.offsetParent !== null);
        return b ? b.innerText : '';
      });
      check('E2E-24', 'F2: queda a la vista "Confirmado: el operador lo pone el proveedor"', /Confirmado: el operador lo pone el proveedor/.test(confirmed), norm(confirmed).slice(0, 160));
      await go(`#/cotizaciones/${encodeURIComponent(e24.q.id)}/result`, 300);
      await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
      const after = await pendingIds();
      check('E2E-24', 'F2: confirmado, el Resultado ya no lo pide', !after.includes('equipment.0.operatorLaborId'), JSON.stringify(after));
    } else {
      check('E2E-24', 'F2: el botón "Ningún puesto de Personal lo opera" está a la vista', false, 'sin botón');
    }
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

  // ---- ECO-02: el riesgo se ve FUERA del Resultado (lista, Inicio, Escenarios), en los cuatro números y en
  // el PDF; una cotización NO CONFIABLE no se marca como enviada por ningún camino (Resultado, lista, editor)
  // y con pendientes críticos se confirma. Lo esperado sale del motor sobre lo GUARDADO en la cuenta.
  {
    const storedQuotes = () => (db.workspaces.get(orgId).state.quotes || []);
    const storedStatus = async (id, expected) => {
      let status = null;
      for (let i = 0; i < 20; i += 1) {
        const q = storedQuotes().find((x) => x.id === id);
        status = q ? q.status : null;
        if (status === expected) break;
        await page.waitForTimeout(150);
      }
      return status;
    };
    const unreliableNames = new Set(storedQuotes().filter((q) => computeQuote(structuredClone(q)).completeness.unreliable > 0).map((q) => norm(q.name)));
    check('ECO-02', 'hay cotizaciones NO CONFIABLES para probar (E2E-17, E2E-19, E2E-20)', unreliableNames.size >= 2, `${unreliableNames.size}`);
    // Filas de las tablas de cotizaciones: nombre, marca "No confiable" y qué dice la columna del margen.
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.table-wrap tbody tr')].map((tr) => ({
      name: ((tr.querySelector('.cell-title') || {}).textContent || '').trim(),
      tag: Boolean(tr.querySelector('.tag-unreliable')),
      margin: ((tr.querySelector('td[data-label="Margen"], td[data-label="Margen esperado"]') || {}).textContent || '').trim(),
    })).filter((r) => r.name));
    const listCheck = async (where, { mustShow = true } = {}) => {
      const list = await rows();
      const bad = list.filter((r) => {
        const u = unreliableNames.has(norm(r.name));
        return u !== r.tag || u !== /No confiable/.test(r.margin);
      });
      check('ECO-02', `${where}: "No confiable" en la fila y en lugar del margen, sólo en las cotizaciones NO CONFIABLES`, list.length > 0 && bad.length === 0 && (!mustShow || list.some((r) => r.tag)), bad.length ? JSON.stringify(bad.slice(0, 3)) : `filas: ${list.length}`);
    };
    await go('#/cotizaciones', 700);
    await listCheck('Cotizaciones');
    await scan('ECO-02', 'lista');
    await go('#/escenarios', 700);
    await listCheck('Escenarios');
    await go('#/inicio', 900);
    await listCheck('Inicio', { mustShow: false });
    const home = await page.evaluate(() => ({
      continueName: ((document.querySelector('.continue-title') || {}).textContent || '').replace('No confiable', '').replace('ILUSTRATIVO', '').trim(),
      continueTag: Boolean(document.querySelector('.continue-title .tag-unreliable')),
      continueRisk: ((document.querySelector('.continue-risk') || {}).textContent || ''),
      text: document.body.textContent,
    }));
    const continueUnreliable = unreliableNames.has(norm(home.continueName));
    check('ECO-02', 'Inicio: "Continuar cotización" marca "No confiable" (y por qué) sólo si su resultado no es confiable', !home.continueName || (continueUnreliable === home.continueTag && continueUnreliable === /Resultado NO CONFIABLE/.test(home.continueRisk)), JSON.stringify({ name: home.continueName, tag: home.continueTag, risk: home.continueRisk }));
    check('ECO-02', 'Inicio: "Cotizaciones en riesgo" dice que incluye las de resultado NO CONFIABLE', /Incluye \d+ con resultado NO CONFIABLE/.test(norm(home.text)), 'sin la aclaración');
    await scan('ECO-02', 'inicio');

    // Escenarios de una cotización NO CONFIABLE: el aviso va arriba del análisis.
    const u = byId['E2E-19'];
    await go(`#/escenarios/${encodeURIComponent(u.q.id)}`, 900);
    const sc = await page.evaluate(() => {
      const b = document.querySelector('.qr-analysis .qr-draft.qr-unreliable');
      return { text: b ? b.innerText : '', visible: Boolean(b && b.offsetParent !== null) };
    });
    check('ECO-02', 'Escenarios: "RESULTADO NO CONFIABLE" arriba del análisis, con la causa', sc.visible && /RESULTADO NO CONFIABLE/.test(sc.text) && /Dos abonos por mes/.test(sc.text), norm(sc.text).slice(0, 200));

    // Resultado NO CONFIABLE: los cuatro números marcados, "Marcar como enviada" deshabilitado con el motivo a la vista, PDF marcado.
    await go(`#/cotizaciones/${encodeURIComponent(u.q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    const res = await page.evaluate(() => {
      const tagged = (sel) => Boolean(document.querySelector(`${sel} .big-stat-label .tag-unreliable`));
      const sent = document.querySelector('button[data-edit="status"]');
      const note = document.querySelector('.qr-send-blocked');
      return {
        cost: tagged('.qr-stat-cost'), price: tagged('.qr-stat-price'), margin: tagged('.qr-stat-margin'),
        floor: tagged('.qr-stat-floor') || !/\$/.test((document.querySelector('.qr-stat-floor .big-stat-number') || {}).textContent || ''),
        sentDisabled: Boolean(sent && sent.disabled),
        note: note ? note.innerText : '',
        noteVisible: Boolean(note && note.offsetParent !== null),
      };
    });
    check('ECO-02', 'Resultado: costo, piso, tarifa y margen llevan "No confiable"', res.cost && res.floor && res.price && res.margin, JSON.stringify(res));
    check('ECO-02', 'Resultado: "Marcar como enviada" deshabilitado y el motivo a la vista (con la causa)', res.sentDisabled && res.noteVisible && /No se puede marcar como enviada/.test(res.note) && /Dos abonos por mes/.test(res.note), JSON.stringify(res).slice(0, 300));
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.evaluate(() => {
      const flag = document.querySelector('.qr-print-flag');
      const stat = document.querySelector('.qr-stat');
      return {
        flag: flag && flag.offsetParent !== null ? flag.innerText : '',
        first: Boolean(flag && stat && (flag.compareDocumentPosition(stat) & Node.DOCUMENT_POSITION_FOLLOWING)),
        tags: document.querySelectorAll('.qr-stat .tag-unreliable').length,
        tagsShown: [...document.querySelectorAll('.qr-stat .tag-unreliable')].filter((t) => t.offsetParent !== null).length,
      };
    });
    await page.emulateMedia({ media: 'screen' });
    check('ECO-02', 'PDF: "RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA" en el encabezado, antes del primer número, y las marcas se imprimen', /RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA/.test(pdf.flag) && pdf.first && pdf.tagsShown >= 3, JSON.stringify(pdf));

    // Lista (vista detallada): elegir "Enviada" en una NO CONFIABLE avisa por qué y no cambia el estado.
    await go('#/cotizaciones', 700);
    const detailed = page.getByRole('button', { name: 'Detallada' }).first();
    if (await detailed.isVisible().catch(() => false)) await tap(detailed);
    await page.waitForTimeout(500);
    const rowSel = page.locator('.table-wrap tbody tr').filter({ hasText: u.q.name }).locator('select.status-select').first();
    const hasSelect = (await rowSel.count()) > 0;
    check('ECO-02', 'Lista (detallada): la fila tiene el selector de estado', hasSelect, 'sin selector');
    if (hasSelect) {
      await rowSel.selectOption('sent');
      await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
      const dlg = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || {}).textContent || ''));
      check('ECO-02', 'Lista: "Enviada" en una NO CONFIABLE abre el aviso "No se puede marcar como enviada" con la causa', /No se puede marcar como enviada/.test(dlg) && /Dos abonos por mes/.test(dlg), dlg.slice(0, 200));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const shown = await rowSel.inputValue().catch(() => null);
      check('ECO-02', 'Lista: el estado sigue en Borrador (pantalla y cuenta)', shown === 'draft' && (await storedStatus(u.q.id, 'draft')) === 'draft', `selector ${shown}`);
    }

    // Editor ("Más datos de la cotización"): el mismo aviso y el estado no cambia.
    await go(`#/cotizaciones/${encodeURIComponent(u.q.id)}/service`, 600);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const ed = page.locator('select[name="status"]').first();
    if ((await ed.count()) > 0) {
      await ed.scrollIntoViewIfNeeded().catch(() => {});
      await ed.selectOption('sent');
      await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
      const dlg = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || {}).textContent || ''));
      check('ECO-02', 'Editor: "Enviada" en una NO CONFIABLE abre el mismo aviso', /No se puede marcar como enviada/.test(dlg) && /Dos abonos por mes/.test(dlg), dlg.slice(0, 200));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      check('ECO-02', 'Editor: el estado sigue en Borrador (pantalla y cuenta)', (await ed.inputValue().catch(() => null)) === 'draft' && (await storedStatus(u.q.id, 'draft')) === 'draft', 'cambió el estado');
    } else {
      check('ECO-02', 'Editor: el selector de estado existe', false, 'sin select[name="status"]');
    }

    // Pendientes críticos sin NO CONFIABLE (E2E-02, "Ruta del proveedor"): se confirma nombrándolos; cancelar no cambia nada.
    const c = byId['E2E-02'];
    await go(`#/cotizaciones/${encodeURIComponent(c.q.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    const sentBtn = page.locator('button[data-edit="status"]').first();
    check('ECO-02', 'Con pendientes críticos (no NO CONFIABLE) "Marcar como enviada" está habilitado y sin aviso de bloqueo', (await sentBtn.isEnabled().catch(() => false)) && (await page.locator('.qr-send-blocked').count()) === 0, 'deshabilitado o con aviso');
    await tap(sentBtn);
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    const conf = norm(await page.evaluate(() => (document.querySelector('dialog[open]') || {}).textContent || ''));
    check('ECO-02', 'Con pendientes críticos se pide confirmar y se nombran', /¿Marcarla como enviada con pendientes críticos\?/.test(conf) && /Ruta del proveedor/.test(conf), conf.slice(0, 200));
    await tap(page.locator('dialog[open]').getByRole('button', { name: 'Revisar primero' }));
    await page.waitForTimeout(500);
    check('ECO-02', '"Revisar primero" no cambia el estado', (await storedStatus(c.q.id, 'draft')) === 'draft', 'cambió');
    await tap(sentBtn);
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    await tap(page.locator('dialog[open]').getByRole('button', { name: 'Marcar como enviada igual' }));
    check('ECO-02', '"Marcar como enviada igual" la marca como enviada (y se guarda)', (await storedStatus(c.q.id, 'sent')) === 'sent', 'no se guardó');

    // ECO-02 R1: Perdida → Ganada registra un hecho (no se controla), pero no autoriza a mandarla: el
    // Resultado sigue diciendo que hoy NO ES CONFIABLE y que se resuelve antes de volver a mandarla.
    await go('#/cotizaciones', 700);
    const detailedAgain = page.getByRole('button', { name: 'Detallada' }).first();
    if (await detailedAgain.isVisible().catch(() => false)) await tap(detailedAgain);
    await page.waitForTimeout(500);
    const statusOf = () => page.locator('.table-wrap tbody tr').filter({ hasText: u.q.name }).locator('select.status-select').first();
    if ((await statusOf().count()) > 0) {
      await statusOf().selectOption('lost');
      const lost = await storedStatus(u.q.id, 'lost');
      await page.waitForTimeout(500);
      await statusOf().selectOption('won');
      await page.waitForTimeout(400);
      const dialogs = await page.locator('dialog[open]').count();
      const won = await storedStatus(u.q.id, 'won');
      check('ECO-02', 'Perdida → Ganada (registra un hecho) no se bloquea ni pide confirmar', lost === 'lost' && won === 'won' && dialogs === 0, `perdida ${lost} · ganada ${won} · diálogos ${dialogs}`);
      await go(`#/cotizaciones/${encodeURIComponent(u.q.id)}/result`, 300);
      await page.waitForSelector('.qr-actions-bar', { timeout: 8000 }).catch(() => {});
      const note = norm(await page.evaluate(() => [...document.querySelectorAll('.qr-send-blocked')].map((n) => n.textContent).join(' ')));
      check('ECO-02', 'Ganada con un resultado NO CONFIABLE: el Resultado avisa que se resuelve antes de volver a mandarla', /Figura como ganada, pero hoy su resultado NO ES CONFIABLE/.test(note) && /antes de volver a mandarla/.test(note), note.slice(0, 200));
    } else {
      check('ECO-02', 'Lista (detallada): la fila tiene el selector de estado (Perdida → Ganada)', false, 'sin selector');
    }
  }

  // ---- ECO-03 (VAL-01-F1): el múltiplo fijo guardado se conserva y se avisa; el margen objetivo y el real
  // se ven siempre; "Usar redondeo automático" lo cambia; la empresa nueva y sus cotizaciones nuevas, en automático.
  {
    const stored = (id) => (db.workspaces.get(orgId).state.quotes || []).find((x) => x.id === id) || null;
    // Como la app muestra las tarifas mínimas: hacia arriba, con centavos si son menores a $ 100.
    const shownCeil = (v) => (Math.abs(v) > 0 && Math.abs(v) < 100 ? formatMoney(Math.ceil(v * 100 - 1e-6) / 100, { decimals: 2 }) : formatMoneyCeil(v));
    const t = byId['E2E-21'];
    const k0 = t.r.kpis;
    await go(`#/cotizaciones/${encodeURIComponent(t.q.id)}/result`, 300);
    await page.waitForSelector('.qr-stats', { timeout: 8000 }).catch(() => {});
    const readPrice = () => page.evaluate(() => {
      const stat = document.querySelector('.qr-stat-price');
      const banner = document.querySelector('.qr-rounding');
      return {
        value: stat ? (stat.querySelector('.big-stat-number') || {}).textContent : null,
        hint: stat ? (stat.querySelector('.big-stat-hint') || {}).textContent : null,
        banner: banner ? banner.textContent : null,
        bannerBefore: Boolean(banner && stat && (banner.compareDocumentPosition(stat) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    });
    const before = await readPrice();
    check('E2E-21', 'ECO-03: lo guardado no cambia: la sugerida es la del múltiplo fijo de $ 1.000 (la del motor)', norm(before.value) === norm(shownCeil(k0.suggestedListRate)) && k0.roundingMode === 'step', `pantalla ${norm(before.value)} · motor ${shownCeil(k0.suggestedListRate)}`);
    check('E2E-21', 'ECO-03: aviso arriba de los números: "quedó X % arriba de tu precio objetivo por el redondeo"', /La tarifa sugerida quedó .* arriba de tu precio objetivo por el redondeo/.test(norm(before.banner)) && before.bannerBefore, norm(before.banner).slice(0, 200));
    check('E2E-21', 'ECO-03: la sugerida muestra el margen objetivo y el real', /Objetivo: 10 % de margen · con esta tarifa: [\d.,]+ %/.test(norm(before.hint)) && /Precio objetivo exacto/.test(norm(before.hint)), norm(before.hint).slice(0, 200));
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => {
      const b = document.querySelector('.qr-rounding');
      return Boolean(b) && getComputedStyle(b).display !== 'none';
    });
    await page.emulateMedia({ media: 'screen' });
    check('E2E-21', 'ECO-03: el aviso del redondeo se imprime en el PDF', printed, 'no se imprime');
    const autoBtn = page.locator('[data-action="rounding-auto"]').first();
    const hasBtn = (await autoBtn.count()) > 0;
    check('E2E-21', 'ECO-03: el aviso ofrece "Usar redondeo automático"', hasBtn, 'sin botón');
    if (hasBtn) {
      await tap(autoBtn);
      let q = null;
      for (let i = 0; i < 20; i += 1) {
        q = stored(t.q.id);
        if (q && q.pricing && q.pricing.roundingMode === 'auto') break;
        await page.waitForTimeout(150);
      }
      const k1 = q ? computeQuote(structuredClone(q)).kpis : null;
      await page.waitForTimeout(500);
      const after = await readPrice();
      check('E2E-21', 'ECO-03: "Usar redondeo automático" lo guarda y la sugerida queda a lo sumo 1 % sobre la objetivo', Boolean(k1) && q.pricing.roundingMode === 'auto' && k1.suggestedRoundUpPct <= 1 + 1e-9 && k1.roundingStep > 0 && norm(after.value) === norm(shownCeil(k1.suggestedListRate)), `guardado ${q && q.pricing.roundingMode} · múltiplo ${k1 && k1.roundingStep} · pantalla ${norm(after.value)} · motor ${k1 && shownCeil(k1.suggestedListRate)}`);
      check('E2E-21', 'ECO-03: sin el múltiplo fijo, el aviso se va', !after.banner, norm(after.banner).slice(0, 120));
    }
    // "El precio": el control del redondeo con el automático elegido y su tope.
    await go(`#/cotizaciones/${encodeURIComponent(t.q.id)}/margin`, 600);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const control = await page.evaluate(() => {
      const sel = document.querySelector('select[name="pricing.roundingMode"]');
      return { mode: sel ? sel.value : null, maxPct: Boolean(document.querySelector('input[name="pricing.roundingMaxPct"]')), step: Boolean(document.querySelector('input[name="pricing.roundingStep"]')) };
    });
    check('E2E-21', 'ECO-03: "El precio" muestra el redondeo automático con su tope', control.mode === 'auto' && control.maxPct && !control.step, JSON.stringify(control));
    // Empresa nueva (la cuenta del lab): Configuración en automático, y una cotización nueva también.
    await go('#/configuracion/parametros', 900);
    const settingsMode = await page.evaluate(() => {
      const sel = document.querySelector('select[name="roundingMode"]');
      return sel ? sel.value : null;
    });
    check('ECO-03', 'Configuración de una empresa nueva: redondeo automático', settingsMode === 'auto', `selector ${settingsMode}`);
    const ids = new Set((db.workspaces.get(orgId).state.quotes || []).map((x) => x.id));
    await go('#/cotizaciones/nueva', 900);
    const blank = page.getByRole('button', { name: /Empezar en blanco/ }).first();
    if (await blank.isVisible().catch(() => false)) await tap(blank);
    else {
      const card = page.locator('.quote-choice-blank').first();
      if (await card.count()) await tap(card);
    }
    let created = null;
    for (let i = 0; i < 20 && !created; i += 1) {
      created = (db.workspaces.get(orgId).state.quotes || []).find((x) => !ids.has(x.id)) || null;
      if (!created) await page.waitForTimeout(200);
    }
    check('ECO-03', 'una cotización nueva de una empresa nueva arranca en redondeo automático (hasta 1 %)', Boolean(created) && created.pricing.roundingMode === 'auto' && created.pricing.roundingMaxPct === 1 && created.pricing.roundingStep === 0, created ? JSON.stringify({ mode: created.pricing.roundingMode, max: created.pricing.roundingMaxPct, step: created.pricing.roundingStep }) : 'no se creó');

    // Empresa guardada antes de ECO-03 con sus parámetros confirmados y $ 1.000: Configuración la muestra como
    // múltiplo fijo y, al guardar otro parámetro, no la pasa a automático (hallazgo de la revisión de código).
    const w = db.workspaces.get(orgId);
    const { roundingMode: _mode, roundingMaxPct: _max, ...legacySettings } = w.state.settings;
    w.state.settings = { ...legacySettings, illustrative: false, roundingStep: 1000 };
    w.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);
    await go('#/configuracion/parametros', 900);
    const legacyShown = await page.evaluate(() => {
      const sel = document.querySelector('select[name="roundingMode"]');
      const label = [...document.querySelectorAll('label')].find((l) => /Múltiplo del redondeo/.test(l.textContent));
      const input = label ? document.getElementById(label.getAttribute('for')) : null;
      const box = input ? input.closest('[hidden]') : null;
      return { mode: sel ? sel.value : null, step: input ? input.value : null, visible: Boolean(input) && !box };
    });
    check('ECO-03', 'Configuración de una empresa de antes con $ 1.000 confirmado: "Múltiplo fijo" de $ 1.000', legacyShown.mode === 'step' && legacyShown.visible && /^1\.?000$/.test(String(legacyShown.step).trim()), JSON.stringify(legacyShown));
    const fuel = page.getByLabel(/Precio del combustible/).first();
    if (await fuel.count()) {
      await fuel.fill('1600');
      await fuel.press('Tab').catch(() => {});
      let saved = null;
      for (let i = 0; i < 25; i += 1) {
        saved = db.workspaces.get(orgId).state.settings;
        if (saved && Number(saved.fuelPricePerLiter) === 1600) break;
        await page.waitForTimeout(200);
      }
      check('ECO-03', 'al guardar otro parámetro, la empresa de antes conserva su múltiplo fijo (no pasa a automático)', Boolean(saved) && Number(saved.fuelPricePerLiter) === 1600 && saved.roundingMode !== 'auto' && Number(saved.roundingStep) === 1000, saved ? JSON.stringify({ fuel: saved.fuelPricePerLiter, mode: saved.roundingMode, step: saved.roundingStep }) : 'sin configuración');
    } else {
      check('ECO-03', 'Configuración: el campo del combustible existe', false, 'sin campo');
    }
  }

  // ---- UX-01 (PLAN-2026-022): ningún formulario pierde cambios sin avisar y ningún valor se corrige en silencio.
  // Cada paso tolera que el anterior falle (en `main` estos controles fallan y la corrida sigue).
  {
    const S = 'UX-01';
    const state = () => db.workspaces.get(orgId).state;
    const dialogs = () => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => ((d.querySelector('.dialog-title') || {}).textContent || '').trim()));
    const toastList = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => ({ text: t.textContent.replace(/\s+/g, ' ').trim(), close: Boolean(t.querySelector('.toast-close')) })));
    const tapIf = async (loc) => {
      if (!(await loc.count())) return false;
      await tap(loc.first());
      return true;
    };
    const closeToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    const ASK = '¿Descartar los cambios?';
    let list = [];

    // 1. Ficha de un recurso (RES-02-G4): Esc, clic en el fondo, la X y "Descartar".
    await go('#/recursos/personal', 900);
    const profilesBefore = (state().laborProfiles || []).length;
    await tapIf(page.getByRole('button', { name: 'Agregar perfil' }));
    await page.waitForTimeout(500);
    const role = page.locator('dialog[open]').getByLabel('Rol / puesto');
    if (await role.count()) await role.fill('Puesto UX-01');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    let open = await dialogs();
    check(S, `Recursos: con cambios, Esc pregunta "${ASK}" y la ficha sigue abierta`, open.length === 2 && open.includes(ASK), JSON.stringify(open));
    await tapIf(page.getByRole('button', { name: 'Seguir editando' }));
    await page.waitForTimeout(300);
    open = await dialogs();
    const kept = (await role.count()) ? await role.inputValue() : null;
    check(S, 'Recursos: "Seguir editando" vuelve a la ficha con lo cargado', open.length === 1 && kept === 'Puesto UX-01', `${JSON.stringify(open)} · ${kept}`);
    // Clic en el fondo: el evento llega al propio <dialog> (fuera de la caja).
    await page.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      if (d) d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    open = await dialogs();
    check(S, 'Recursos: un clic en el fondo no cierra la ficha', open.length === 1, JSON.stringify(open));
    await tapIf(page.locator('dialog[open] .dialog-header button[aria-label="Cerrar"]'));
    await page.waitForTimeout(300);
    open = await dialogs();
    check(S, 'Recursos: la X también pregunta antes de cerrar', open.includes(ASK), JSON.stringify(open));
    await tapIf(page.getByRole('button', { name: 'Descartar', exact: true }));
    await page.waitForTimeout(500);
    open = await dialogs();
    check(S, 'Recursos: "Descartar" cierra la ficha sin guardar nada', open.length === 0 && (state().laborProfiles || []).length === profilesBefore, `${JSON.stringify(open)} · ${(state().laborProfiles || []).length} perfiles (antes ${profilesBefore})`);
    // Sin cambios, Esc cierra como siempre.
    if (open.length) await page.keyboard.press('Escape');
    await tapIf(page.getByRole('button', { name: 'Agregar perfil' }));
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    open = await dialogs();
    check(S, 'Recursos: sin cambios, Esc cierra la ficha sin preguntar', open.length === 0, JSON.stringify(open));
    while ((await dialogs()).length) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    const discardAll = async () => {
      for (let i = 0; i < 4 && (await dialogs()).length; i += 1) {
        if ((await dialogs()).includes(ASK)) await tapIf(page.getByRole('button', { name: 'Descartar', exact: true }));
        else await tapIf(page.locator('dialog[open] .dialog-header button[aria-label="Cerrar"]').last());
        await page.waitForTimeout(300);
      }
    };
    // Esc dos veces seguidas, sin un clic en el medio (Chrome cierra el segundo sin `cancel` cancelable).
    await tapIf(page.getByRole('button', { name: 'Agregar perfil' }));
    await page.waitForTimeout(500);
    if (await role.count()) await role.fill('Puesto UX-01 bis');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    open = await dialogs();
    const keptTwice = (await role.count()) ? await role.inputValue() : null;
    check(S, 'Recursos: Esc dos veces seguidas no cierra la ficha con cambios (sigue lo cargado)', open.some((t) => t !== ASK) && keptTwice === 'Puesto UX-01 bis', `${JSON.stringify(open)} · ${keptTwice}`);
    // Un valor inválido en la ficha y "Cancelar" → "Descartar": no queda un aviso de lo que no se guardó (se descartó a propósito).
    await closeToasts();
    const basic = page.locator('dialog[open]').getByLabel('Sueldo básico mensual');
    if (await basic.count()) await basic.fill('abc');
    await tapIf(page.locator('dialog[open]').getByRole('button', { name: 'Cancelar', exact: true }));
    await page.waitForTimeout(300);
    await tapIf(page.getByRole('button', { name: 'Descartar', exact: true }));
    await page.waitForTimeout(1900);
    open = await dialogs();
    list = await toastList();
    check(S, 'Recursos: al descartar la ficha, un valor inválido de la ficha no deja un aviso fijo', open.length === 0 && !list.some((t) => /abc/.test(t.text)), `${JSON.stringify(open)} · ${JSON.stringify(list).slice(0, 200)}`);
    await discardAll();
    // Marcar y desmarcar una casilla (sin valor guardado) no es un cambio: Esc cierra sin preguntar.
    await go('#/recursos/equipos', 900);
    await tapIf(page.getByRole('button', { name: 'Agregar equipo' }));
    await page.waitForTimeout(500);
    const noFuel = () => page.locator('dialog[open]').getByLabel('No usa combustible').first();
    let toggledBack = false;
    if (await page.locator('dialog[open]').getByLabel('No usa combustible').count()) {
      await tap(noFuel());
      await page.waitForTimeout(250);
      await tap(noFuel());
      await page.waitForTimeout(250);
      toggledBack = !(await noFuel().isChecked());
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    open = await dialogs();
    check(S, 'Recursos: marcar y desmarcar una casilla no cuenta como cambio (Esc cierra sin preguntar)', toggledBack && open.length === 0, `${toggledBack} · ${JSON.stringify(open)}`);
    await discardAll();

    // 2. "Guardar como plantilla" (editor): Esc con cambios pregunta; "Descartar" no crea la plantilla.
    const q1 = byId['E2E-01'].q;
    await go(`#/cotizaciones/${encodeURIComponent(q1.id)}/service`, 900);
    const servicesBefore = (state().services || []).length;
    await tapIf(page.getByRole('button', { name: 'Guardar como plantilla' }));
    await page.waitForTimeout(500);
    const desc = page.locator('dialog[open]').getByLabel('Descripción');
    if (await desc.count()) await desc.fill('Plantilla UX-01 sin guardar');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    open = await dialogs();
    check(S, `Guardar como plantilla: con cambios, Esc pregunta "${ASK}"`, open.length === 2 && open.includes(ASK), JSON.stringify(open));
    await tapIf(page.getByRole('button', { name: 'Descartar', exact: true }));
    await page.waitForTimeout(500);
    open = await dialogs();
    check(S, 'Guardar como plantilla: "Descartar" cierra sin crear la plantilla', open.length === 0 && (state().services || []).length === servicesBefore, `${JSON.stringify(open)} · ${(state().services || []).length} plantillas (antes ${servicesBefore})`);
    while ((await dialogs()).length) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }

    // 3. Editor: un valor inválido sin confirmar y salir del paso (sin que el campo pierda el foco).
    await closeToasts();
    const storedMargin = () => ((state().quotes || []).find((x) => x.id === q1.id) || {}).pricing?.targetMarginPct;
    const marginBefore = storedMargin();
    await go(`#/cotizaciones/${encodeURIComponent(q1.id)}/margin`, 900);
    const marginInput = page.locator('[name="pricing.targetMarginPct"]').first();
    if (await marginInput.count()) await marginInput.fill('12x');
    await go(`#/cotizaciones/${encodeURIComponent(q1.id)}/service`, 1200);
    list = await toastList();
    const editorNotice = list.find((t) => /Margen que querés ganar/.test(t.text) && /12x/.test(t.text));
    check(S, 'Editor: al salir del paso con un valor inválido, un aviso dice qué campo, qué se escribió y qué valor quedó', Boolean(editorNotice) && /Quedó/.test(editorNotice.text), JSON.stringify(list).slice(0, 300));
    check(S, 'Editor: lo guardado es el valor anterior (no se guardó el inválido)', storedMargin() === marginBefore, `${storedMargin()} vs ${marginBefore}`);

    // 4. Configuración: un cambio válido y, sin salir del campo, otro inválido; se sale con Atrás o un atajo (sin perder el foco).
    await closeToasts();
    await go('#/configuracion/parametros', 1200);
    const marginBase = state().settings ? state().settings.defaultTargetMarginPct : null;
    const target = marginBase === 23 ? 24 : 23;
    const sMargin = page.getByLabel('Margen objetivo').first();
    const sFuel = page.getByLabel('Precio del combustible (sin IVA)').first();
    if (await sMargin.count()) await sMargin.fill(String(target));
    if (await sFuel.count()) await sFuel.fill('mil');
    await go('#/inicio', 2000);
    check(S, 'Configuración: al salir con un campo inválido, el resto de la sección se guarda igual (margen objetivo)', state().settings && state().settings.defaultTargetMarginPct === target, `guardado ${state().settings && state().settings.defaultTargetMarginPct}, esperado ${target}`);
    list = await toastList();
    const settingsNotice = list.find((t) => /Precio del combustible/.test(t.text) && /mil/.test(t.text));
    check(S, 'Configuración: un aviso dice que "mil" no se guardó en el precio del combustible y qué valor quedó', Boolean(settingsNotice) && /Quedó/.test(settingsNotice.text), JSON.stringify(list).slice(0, 300));

    // 4b. Configuración: un mes inválido (navegador sin selector de mes: se ve como texto) no frena el guardado de su sección.
    await closeToasts();
    await go('#/configuracion/parametros', 1200);
    await tapIf(page.getByRole('button', { name: 'Agregar tipo de cambio' }));
    await page.waitForTimeout(300);
    const rateField = () => page.getByLabel(/^Tipo de cambio \(/).last();
    const monthField = () => page.getByLabel('Mes del tipo de cambio').last();
    const hasRow = async () => (await page.getByLabel(/^Tipo de cambio \(/).count()) > 0 && (await page.getByLabel('Mes del tipo de cambio').count()) > 0;
    const savedRates = () => (state().settings && state().settings.exchangeRates) || [];
    let monthState = null;
    if (await hasRow()) {
      await rateField().fill('1234');
      await monthField().evaluate((el) => { el.type = 'text'; });
      await monthField().fill('sept 26');
      await monthField().press('Tab');
      await page.waitForTimeout(300);
      monthState = await monthField().evaluate((el) => ({ value: el.value, invalid: el.getAttribute('aria-invalid'), error: (document.getElementById(`${el.id}-error`) || {}).textContent || '' }));
    }
    check(S, 'Configuración: un mes inválido vuelve al anterior al salir del campo y lo dice', Boolean(monthState) && monthState.value === '' && monthState.invalid !== 'true' && /Se restauró el valor anterior/.test(monthState.error), JSON.stringify(monthState));
    await page.waitForTimeout(800);
    await go('#/inicio', 1500);
    check(S, 'Configuración: un mes inválido no frena el guardado del tipo de cambio de la misma sección', savedRates().some((r) => r.rate === 1234), JSON.stringify(savedRates()).slice(0, 200));
    // Sin salir del campo (p. ej. con Atrás): el guardado automático pasa con la sección inválida y después se sale de la pantalla.
    await closeToasts();
    await go('#/configuracion/parametros', 1200);
    if (await hasRow()) {
      await rateField().fill('4321');
      await monthField().evaluate((el) => { el.type = 'text'; });
      await monthField().fill('sept 26');
      await page.waitForTimeout(900);
    }
    await go('#/inicio', 2000);
    check(S, 'Configuración: con el mes inválido sin confirmar, el tipo de cambio se guarda al salir de la pantalla', savedRates().some((r) => r.rate === 4321), JSON.stringify(savedRates()).slice(0, 200));
    list = await toastList();
    check(S, 'Configuración: y un aviso dice que "sept 26" no se guardó en el mes del tipo de cambio', list.some((t) => /Mes del tipo de cambio/.test(t.text) && /sept 26/.test(t.text)), JSON.stringify(list).slice(0, 300));

    // 4c. Una sección que así no se puede guardar (impuestos que suman 100 % o más): al salir, un aviso lo dice.
    await closeToasts();
    await go('#/configuracion/parametros', 1200);
    const detailed = page.locator('input[name="defaultBillingTaxes.mode"][value="detailed"]');
    if (await detailed.count()) {
      await detailed.first().check({ timeout: 3000 }).catch(() => detailed.first().evaluate((el) => el.click()));
      await page.waitForTimeout(400);
    }
    const pct0 = page.locator('[name="defaultBillingTaxes.items.0.pct"]').first();
    const pct1 = page.locator('[name="defaultBillingTaxes.items.1.pct"]').first();
    const taxRows = (await pct0.count()) > 0 && (await pct1.count()) > 0;
    if (taxRows) {
      await pct0.fill('60');
      await pct1.fill('60');
      await pct1.press('Tab');
      await page.waitForTimeout(300);
    }
    await go('#/inicio', 1500);
    list = await toastList();
    check(S, 'Configuración: si una sección no se puede guardar (impuestos que suman 100 % o más), al salir un aviso lo dice', taxRows && list.some((t) => /No se guardaron los cambios de "Impuestos sobre lo que facturás"/.test(t.text)), `${taxRows} · ${JSON.stringify(list).slice(0, 300)}`);

    // 5. "Mi cuenta": el nombre escrito y no guardado.
    await closeToasts();
    await go('#/configuracion/cuenta', 1200);
    const nameInput = page.getByLabel('Tu nombre').first();
    if (await nameInput.count()) await nameInput.fill('Nombre UX-01 sin guardar');
    await go('#/inicio', 1200);
    list = await toastList();
    check(S, 'Mi cuenta: al salir sin "Guardar nombre", un aviso dice que el nombre no se guardó', list.some((t) => /Nombre UX-01 sin guardar/.test(t.text) && /Guardar nombre/.test(t.text)), JSON.stringify(list).slice(0, 300));

    // 6. Avisos de error: quedan hasta cerrarlos, con "Cerrar"; no se repiten ni se acumulan sin límite.
    await closeToasts();
    const shown = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/js\/ui\/components\.js$/.test(n));
      if (!url) return { error: 'sin components.js' };
      const { toast } = await import(url);
      toast('UX-01: no se pudo guardar (prueba).', 'danger');
      toast('UX-01: no se pudo guardar (prueba).', 'danger');
      return { ok: true };
    });
    await page.waitForTimeout(4200);
    list = await toastList();
    const errors = list.filter((t) => /UX-01: no se pudo guardar/.test(t.text));
    check(S, 'Avisos: uno de error sigue a la vista después de 4 s y tiene "Cerrar"', errors.length >= 1 && errors.every((t) => t.close), `${JSON.stringify(shown)} · ${JSON.stringify(list).slice(0, 200)}`);
    check(S, 'Avisos: el mismo aviso no se repite', errors.length === 1, `${errors.length} iguales`);
    const closed = await tapIf(page.locator('.toast .toast-close'));
    await page.waitForTimeout(300);
    list = await toastList();
    check(S, 'Avisos: "Cerrar" lo saca', errors.length >= 1 && closed && !list.some((t) => /UX-01: no se pudo guardar/.test(t.text)), JSON.stringify(list).slice(0, 200));
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/js\/ui\/components\.js$/.test(n));
      if (!url) return;
      const { toast } = await import(url);
      for (let i = 1; i <= 6; i += 1) toast(`UX-01: error ${i} (prueba).`, 'danger');
    });
    await page.waitForTimeout(300);
    list = await toastList();
    check(S, 'Avisos: como máximo 4 a la vez (quedan los más nuevos)', list.length <= 4 && list.some((t) => /error 6/.test(t.text)), `${list.length} avisos`);
    await closeToasts();
    // Un error no se va para hacerle lugar a avisos que igual se iban solos.
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/js\/ui\/components\.js$/.test(n));
      if (!url) return;
      const { toast } = await import(url);
      toast('UX-01: error que queda (prueba).', 'danger');
      for (let i = 1; i <= 4; i += 1) toast(`UX-01: aviso ${i} (prueba).`, 'info');
    });
    await page.waitForTimeout(300);
    list = await toastList();
    check(S, 'Avisos: con más de 4, se van primero los que se iban solos (el error queda)', list.length <= 4 && list.some((t) => /error que queda/.test(t.text)) && list.some((t) => /aviso 4/.test(t.text)), JSON.stringify(list.map((t) => t.text)).slice(0, 300));
    await closeToasts();
    await scan(S, 'después de los avisos');
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

    // Registro público (HD-03, decisión del dueño del 2026-10-20): sin sesión,
    // #/registro tiene el formulario y la landing y el ingreso ofrecen crear cuenta.
    // El alta completa (confirmación por correo) la recorre tests/lab/e2e/auth-lab.mjs.
    await go('#/registro', 800);
    const reg = await page.evaluate(() => ({
      text: document.body.innerText,
      forms: document.querySelectorAll('form').length,
      passwords: document.querySelectorAll('input[type="password"]').length,
      fields: [...document.querySelectorAll('form input')].map((i) => i.getAttribute('autocomplete')),
    }));
    check('REGISTRO-01', '#/registro: nombre, empresa, email y contraseña nueva', reg.forms === 1 && reg.passwords === 1 && ['name', 'organization', 'email', 'new-password'].every((f) => reg.fields.includes(f)), reg.fields.join(', '));
    check('REGISTRO-01', '#/registro ya no habla de una beta cerrada por invitación', !/beta cerrada|por invitación/i.test(reg.text), 'texto de la invitación');
    await go('#/', 1000);
    const landing = await page.evaluate(() => {
      const cta = document.querySelector('.pub-header-cta');
      return {
        ctaText: cta ? cta.textContent.trim() : '',
        ctaHref: cta ? cta.getAttribute('href') : '',
      };
    });
    check('REGISTRO-01', 'el botón principal de la landing es "Crear cuenta"', landing.ctaText === 'Crear cuenta' && landing.ctaHref === '#/registro', `${landing.ctaText} → ${landing.ctaHref}`);
    await go('#/login', 800);
    const loginText = await page.evaluate(() => document.body.innerText);
    check('REGISTRO-01', 'el ingreso ofrece "Crear cuenta" y "¿Olvidaste tu contraseña?"', /Crear cuenta/.test(loginText) && /¿Olvidaste tu contraseña\?/.test(loginText), 'texto inesperado en el ingreso');

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
