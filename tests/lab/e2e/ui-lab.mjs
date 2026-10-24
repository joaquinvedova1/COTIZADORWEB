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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../../scripts/serve.mjs';
import { computeQuote } from '../../../js/engines/quote-engine.js';
import { formatMoney, formatMoneyCeil, formatNumber, formatPercent } from '../../../js/core/format.js';
import { unitChoicesFor } from '../../../js/domain/billing-units.js';
import { fieldHref } from '../../../js/ui/field-links.js';
import { cot0010Quote } from '../../fixtures/cot-0010.js';
import { service, person, owned, external, material, product, ingredient, worker, fixedCost } from '../lib/build.js';
import { computeProduct } from '../../../js/engines/product-engine.js';
import { computeLaborLine } from '../../../js/engines/labor-engine.js';
import { computeOwnership } from '../../../js/engines/equipment-engine.js';
import { laborLineFromProfile, defaultVolumeTiers, defaultSettings } from '../../../js/domain/quote-factory.js';
import { createEmptyProduct } from '../../../js/domain/product-factory.js';
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
    // K0E-02: el aviso queda a la vista, junto a "Guardar sueldo", y el foco va al mes marcado (antes quedaba al final del cuerpo).
    const periodAlert = await dlg.evaluate((d) => {
      const e = d.querySelector('.salary-error');
      const r = e ? e.getBoundingClientRect() : null;
      const a = document.activeElement;
      return { inActions: Boolean(e && e.closest('.dialog-actions')), visible: Boolean(r && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight), focus: a && a.getAttribute('name'), invalid: a && a.getAttribute('aria-invalid') };
    }, null, T).catch(() => ({}));
    check(R, 'K0E-02: sin mes base, el aviso está junto a "Guardar sueldo" y a la vista, y el foco va al mes marcado', periodAlert.inActions && periodAlert.visible && periodAlert.focus === 'salary.period' && periodAlert.invalid === 'true', JSON.stringify(periodAlert));
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
    // Sin tipos de cambio: la excavadora en USD tiene que quedar sin convertir aunque otro bloque (p. ej. el de
    // Configuración de UX-01, en el árbol combinado) haya guardado uno.
    ws.state.settings = { ...(ws.state.settings || {}), exchangeRates: [] };
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

  // ---- DESIGN-02 (PLAN-2026-025), "Ingeniería clara": leer bien montos, unidades, riesgo y estado de guardado.
  // Raíz en %, ningún texto visible por debajo de 12 px, cifras tabulares, "Ver cálculo" de 24 px, gráfico que no
  // depende del color, campos de tablas con borde de 3:1, estado de guardado con palabra, "no es un precio de
  // mercado" (VAL-G4), fecha de la oferta en el PDF y una prueba sólo con teclado. Las acciones son "suaves": si
  // algo no existe (p. ej. contra main), falla ese control y la corrida sigue.
  {
    const D = 'DESIGN-02';
    const soft = async (fn) => { try { await fn(); return true; } catch { return false; } };
    const openAll = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const q0 = seeded[0].q;
    const resultHash = (q) => `#/cotizaciones/${encodeURIComponent(q.id)}/result`;
    /** Textos visibles por debajo de 12 px en la pantalla actual: "texto" tamaño (clase). */
    const smallTexts = () => page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        const el = node.parentElement;
        if (!text || !el || seen.has(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue; // no se ve, o es sólo para lectores de pantalla
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        const size = parseFloat(cs.fontSize);
        const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
        if (size < 11.95) out.push(`${cls.split(' ')[0] || el.tagName.toLowerCase()} ${size.toFixed(1)}px`);
      }
      return out;
    });

    // Raíz en %: con la letra de fábrica se ve igual (15 px escritorio, 16 px celular) y sigue a la del navegador.
    const rootPx = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    await go('#/inicio', 600);
    const baseRoot = await rootPx();
    let scaled = null;
    await soft(async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20 } });
      await page.waitForTimeout(250);
      scaled = await rootPx();
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16 } });
      await page.waitForTimeout(250);
      await cdp.detach();
    });
    const expectBase = mode === 'mobile' ? 16 : 15;
    const expectScaled = mode === 'mobile' ? 20 : 18.75;
    check(D, `la raíz sigue la letra del navegador: ${expectBase} px de fábrica y ${expectScaled} px con la letra en 20 px (WCAG 1.4.4)`, baseRoot === expectBase && scaled !== null && Math.abs(scaled - expectScaled) < 0.01, `de fábrica ${baseRoot}px · con 20 px: ${scaled === null ? 'sin dato' : `${scaled}px`}`);

    // Ningún texto visible por debajo de 12 px en las pantallas de cotizar y entender el resultado.
    const screens = [
      ['Inicio', '#/inicio'],
      ['Cotizaciones', '#/cotizaciones'],
      ...['service', 'modality', 'labor', 'equipment', 'logistics', 'indirect', 'margin'].map((st) => [`editor (${st})`, `#/cotizaciones/${encodeURIComponent(q0.id)}/${st}`]),
      ['Resultado', resultHash(q0)],
      ['Escenarios', `#/escenarios/${encodeURIComponent(q0.id)}`],
      ['Recursos (personal)', '#/recursos/personal'],
      ['Recursos (equipos)', '#/recursos/equipos'],
      ['Configuración', '#/configuracion/parametros'],
      ['Producto', `#/productos/${encodeURIComponent(prod.id)}/resultado`],
    ];
    // El detalle cuenta por pantalla, clase y tamaño (sin copiar el texto: puede ser un email o un nombre).
    const small = new Map();
    for (const [name, hash] of screens) {
      await go(hash, 900);
      await openAll();
      await page.waitForTimeout(150);
      (await smallTexts()).forEach((x) => small.set(`${name}: ${x}`, (small.get(`${name}: ${x}`) || 0) + 1));
    }
    const smallTotal = [...small.values()].reduce((a, b) => a + b, 0);
    check(D, 'ningún texto visible por debajo de 12 px (Inicio, Cotizaciones, editor, Resultado, Escenarios, Recursos, Configuración y producto)', smallTotal === 0, `${smallTotal} textos: ${[...small].map(([k, n]) => `${k} ×${n}`).slice(0, 12).join(' | ')}`);
    // La última pantalla del recorrido es el resultado del producto: también dice que no es un precio de mercado.
    const productText = norm(await page.evaluate(() => document.body.innerText));
    check(D, 'producto: el resultado también dice que no es un precio de mercado (VAL-G4)', productText.includes('Calculado con tus costos y tus supuestos: no es un precio de mercado.'), 'no lo dice');

    // Resultado: cifras tabulares, "Ver cálculo" de 24 px (44 en el celular) y "no es un precio de mercado".
    await go(resultHash(q0), 900);
    await openAll();
    await page.waitForTimeout(150);
    const nums = await page.evaluate(() => [...document.querySelectorAll('.big-stat-number, .qr-hero-value, .qr-score-value')]
      .filter((n) => n.getBoundingClientRect().width > 0)
      .map((n) => ({ cls: n.className.split(' ')[0], v: getComputedStyle(n).fontVariantNumeric })));
    const notTabular = nums.filter((n) => !/tabular-nums/.test(n.v));
    check(D, 'Resultado: las cifras clave usan cifras tabulares (los dígitos no "bailan")', nums.some((n) => n.cls === 'qr-hero-value') && notTabular.length === 0, nums.length ? notTabular.map((n) => `${n.cls}: ${n.v}`).slice(0, 4).join(' | ') || 'falta .qr-hero-value' : 'no hay cifras clave');
    const traces = await page.evaluate(() => [...document.querySelectorAll('.trace-btn')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => Math.round(r.height * 10) / 10));
    const minTrace = mode === 'mobile' ? 44 : 24;
    const lowTraces = traces.filter((x) => x < minTrace - 0.05);
    check(D, `Resultado: "Ver cálculo" mide ${minTrace} px de alto o más (WCAG 2.5.8)`, traces.length > 0 && lowTraces.length === 0, traces.length ? `${lowTraces.length} de ${traces.length} más bajos: ${[...new Set(lowTraces)].slice(0, 5).join(', ')} px` : 'no hay botones "Ver cálculo"');
    const summaryText = norm(await page.evaluate(() => (document.querySelector('.qr-summary') || {}).innerText || ''));
    check(D, 'Resultado: junto a los montos dice "Calculado con tus costos y tus supuestos: no es un precio de mercado." (VAL-G4)', summaryText.includes('Calculado con tus costos y tus supuestos: no es un precio de mercado.'), 'no lo dice');
    await scan(D, 'Resultado');

    // PDF: la fecha de la oferta (la de la cotización, 16/10/2026) y, aparte, la de impresión; y el aviso de mercado.
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => ({ head: (document.querySelector('.qr-print-head') || {}).innerText || '', body: document.body.innerText }));
    await page.emulateMedia({ media: 'screen' });
    // La fecha de impresión esperada sale del reloj del navegador, el mismo que usa la app.
    const printedOn = await page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    });
    check(D, 'PDF: la fecha de la oferta (16/10/2026) y, aparte, la de impresión', norm(printed.head).includes('Oferta del 16/10/2026') && norm(printed.head).includes(`impreso el ${printedOn}`), norm(printed.head).slice(0, 160));
    check(D, 'PDF: también dice que no es un precio de mercado', norm(printed.body).includes('no es un precio de mercado'), 'no aparece en la impresión');

    // Teclado: Tab hasta "Ver cálculo" de los montos, Enter abre la traza, Esc la cierra y el foco vuelve al botón.
    const kb = { reached: false, opened: false, closed: false, back: false, presses: 0 };
    await soft(async () => {
      await go(resultHash(q0), 900);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
      for (; kb.presses < 90 && !kb.reached; kb.presses += 1) {
        await page.keyboard.press('Tab');
        kb.reached = await page.evaluate(() => Boolean(document.activeElement && document.activeElement.classList.contains('trace-btn') && document.activeElement.closest('.qr-stats')));
      }
      if (!kb.reached) return;
      const label = await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      kb.opened = await page.evaluate(() => Boolean(document.querySelector('dialog[open]')));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => ({ open: Boolean(document.querySelector('dialog[open]')), label: document.activeElement ? document.activeElement.getAttribute('aria-label') || document.activeElement.textContent : null }));
      kb.closed = !after.open;
      kb.back = after.label === label;
    });
    check(D, 'sólo con teclado: Tab llega a "Ver cálculo" de los montos, Enter abre la traza y Esc la cierra y devuelve el foco', kb.reached && kb.opened && kb.closed && kb.back, JSON.stringify(kb));

    // Gráfico: la tarifa piso (punteada) y el objetivo (lleno) no se distinguen sólo por el tono, tampoco en la leyenda.
    let chart = null;
    for (const { q } of seeded) {
      await go(resultHash(q), 700);
      await openAll();
      await page.waitForTimeout(150);
      chart = await page.evaluate(() => {
        const floor = document.querySelector('.qr-chart-floor');
        const target = document.querySelector('.qr-chart-target');
        if (!floor || !target) return null;
        const key = document.querySelector('.qr-key-floor');
        return { floor: getComputedStyle(floor).strokeDasharray, target: getComputedStyle(target).strokeDasharray, key: key ? getComputedStyle(key).borderTopStyle : null };
      });
      if (chart) break;
    }
    check(D, 'gráfico: la tarifa piso va punteada y el objetivo lleno, igual en la leyenda (WCAG 1.4.1)', Boolean(chart) && chart.floor !== 'none' && chart.target === 'none' && /dotted|dashed/.test(chart.key || ''), chart ? JSON.stringify(chart) : 'ningún resultado con gráfico');

    // Campos dentro de tablas del editor: borde de 3:1 o más contra su fondo (WCAG 1.4.11).
    const borders = [];
    for (const st of ['labor', 'equipment', 'indirect', 'margin']) {
      await go(`#/cotizaciones/${encodeURIComponent(q0.id)}/${st}`, 700);
      await openAll();
      borders.push(...await page.evaluate((stepId) => {
        const lum = (rgb) => {
          const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        };
        return [...document.querySelectorAll('.table input:not([type="checkbox"]):not([type="radio"]), .table select')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el) => {
            const cs = getComputedStyle(el);
            const bg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : cs.backgroundColor;
            return { step: stepId, ratio: Math.round(ratio(cs.borderTopColor, bg) * 100) / 100 };
          });
      }, st));
    }
    const weak = borders.filter((b) => b.ratio < 3);
    check(D, 'editor: los campos dentro de tablas tienen borde de 3:1 o más (WCAG 1.4.11)', borders.length > 0 && weak.length === 0, borders.length ? `${weak.length} de ${borders.length} con menos de 3:1 (${[...new Set(weak.map((w) => `${w.step} ${w.ratio}:1`))].slice(0, 4).join(', ')})` : 'no hay campos en tablas');

    // Estado de guardado: en el riel (1000 px) con una palabra; en el celular, en la barra de arriba sin abrir el menú.
    const SYNC_WORDS = /Guardado|Guardando|Sin conexión|Sin sincronizar|Conflicto|Sesión vencida|Conectando/;
    const visibleLeafText = (selector) => page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root || root.closest('[hidden]')) return '';
      return [...root.querySelectorAll('*')]
        .filter((n) => n.childElementCount === 0 && !n.closest('.sr-only') && n.getBoundingClientRect().width > 2 && getComputedStyle(n).visibility !== 'hidden')
        .map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    }, selector);
    if (mode === 'desktop') {
      await page.setViewportSize({ width: 1000, height: 900 });
      await go('#/inicio', 900);
      const rail = await visibleLeafText('.sidebar .sync-status');
      check(D, 'riel (1000 px): el estado de guardado se lee con una palabra, no sólo con un punto de color', SYNC_WORDS.test(rail), `texto visible: "${rail}"`);
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
    } else {
      await go('#/inicio', 900);
      const bar = await visibleLeafText('.mobile-bar');
      check(D, 'celular: el estado de guardado se ve en la barra de arriba, sin abrir el menú', SYNC_WORDS.test(bar), `barra: "${bar}"`);
      // Con el menú abierto se ve un solo estado (si no, los lectores de pantalla lo anunciarían dos veces).
      const shownWithMenu = await soft(async () => {
        await tap(page.locator('.menu-toggle').first());
        await page.waitForTimeout(400);
      }) ? await page.evaluate(() => [...document.querySelectorAll('.sync-status')].filter((el) => !el.hidden && el.getBoundingClientRect().width > 0).length) : null;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(D, 'celular: con el menú abierto se ve un solo estado de guardado (no se anuncia dos veces)', shownWithMenu === 1, `estados visibles: ${shownWithMenu}`);
      // A 320 px la barra entra: la palabra se acorta antes que apretar "Menú" (44 × 44 px) o la marca.
      await page.setViewportSize({ width: 320, height: 700 });
      await page.waitForTimeout(400);
      const narrowBar = await page.evaluate(() => {
        const barEl = document.querySelector('.mobile-bar');
        const menu = document.querySelector('.menu-toggle');
        const r = menu ? menu.getBoundingClientRect() : null;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          barOverflow: barEl ? barEl.scrollWidth - barEl.clientWidth : null,
          menu: r ? { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } : null,
          vw: window.innerWidth,
        };
      });
      check(D, 'celular a 320 px: la barra entra sin scroll horizontal y "Menú" sigue de 44 × 44 px', narrowBar.overflow <= 1 && narrowBar.barOverflow !== null && narrowBar.barOverflow <= 1 && Boolean(narrowBar.menu) && narrowBar.menu.w >= 44 && narrowBar.menu.h >= 44 && narrowBar.menu.right <= narrowBar.vw, JSON.stringify(narrowBar));
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
    }

    // Datos de ejemplo: una copia sintética marcada ILUSTRATIVA muestra la marca a 12 px o más.
    const live = db.workspaces.get(orgId);
    const illQ = { ...structuredClone(q0), id: randomUUID(), code: 'LAB-D02', name: 'DESIGN-02 cotización ilustrativa', illustrative: true };
    live.state.quotes = [...live.state.quotes, illQ];
    live.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);
    await go(resultHash(illQ), 900);
    const illSizes = await page.evaluate(() => [...document.querySelectorAll('.badge, .tag-illustrative')]
      .filter((b) => /ILUSTRATIV/.test(b.textContent) && b.getBoundingClientRect().width > 0)
      .map((b) => parseFloat(getComputedStyle(b).fontSize)));
    check(D, 'ILUSTRATIVO: la marca de datos de ejemplo se ve y mide 12 px o más', illSizes.length > 0 && illSizes.every((x) => x >= 11.95), illSizes.length ? `${illSizes.join(', ')} px` : 'no aparece la marca');
  }

  // ---- DESIGN-02 (2/2) (PLAN-2026-026), cotizar sin fricción: el resumen en vivo con el resultado y el margen
  // esperados, la barra compacta que destaca la tarifa cobrada, los avisos arriba y las tablas apiladas en el
  // celular, campos accesibles (aria-required y aria-describedby) y el eco de montos en todo campo de plata, con
  // una prueba sólo con teclado. Acciones "suaves", como en DESIGN-02.
  {
    const D = 'DESIGN-02B';
    const soft = async (fn) => { try { await fn(); return true; } catch { return false; } };
    const editorHash = (q, st) => `#/cotizaciones/${encodeURIComponent(q.id)}/${st}`;
    const byId = (id) => (seeded.find((x) => x.s.id === id) || seeded[0]).q;
    const q0 = seeded[0].q;
    // Copia sintética de la primera con la estructura desglosada en rubros y tramos de descuento: ninguna de las
    // sembradas trae la tabla de estructura.
    const stackQ = {
      ...structuredClone(q0),
      id: randomUUID(),
      code: 'LAB-D02B',
      name: 'DESIGN-02B estructura y tramos',
      indirect: {
        ...structuredClone(q0.indirect || {}),
        mode: 'detailed',
        items: [
          { id: 'str-d02b-1', label: 'Administración', method: 'percent_direct', pct: 5, amount: 0 },
          { id: 'str-d02b-2', label: 'Alquiler de base', method: 'manual', pct: 0, amount: 850000 },
        ],
      },
      rules: { ...structuredClone(q0.rules || {}), volumeTiers: defaultVolumeTiers() },
    };
    const liveWs = db.workspaces.get(orgId);
    liveWs.state.quotes = [...liveWs.state.quotes, stackQ];
    liveWs.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);
    /** Ítems del resumen a la vista (data-kpi), la palabra del margen y cómo se ven la tarifa cobrada y la piso. */
    const summaryState = () => page.evaluate(() => {
      // checkVisibility: lo de un <details> cerrado ("Ver más") no se ve aunque el navegador le calcule tamaño.
      const shown = (n) => Boolean(n) && n.getBoundingClientRect().width > 0 && (typeof n.checkVisibility === 'function' ? n.checkVisibility({ checkVisibilityCSS: true }) : getComputedStyle(n).display !== 'none');
      const style = (key) => {
        const n = document.querySelector(`.qe-summary [data-kpi="${key}"]`);
        const v = n && n.querySelector('.qe-sum-value');
        return n && v ? { bg: getComputedStyle(n).backgroundColor, weight: Number(getComputedStyle(v).fontWeight) } : null;
      };
      const margin = document.querySelector('.qe-summary [data-kpi="expectedMargin"]');
      const word = margin ? margin.querySelector('.qe-sum-state') : null;
      return {
        kpis: [...document.querySelectorAll('.qe-summary .qe-sum-item')].filter(shown).map((n) => n.dataset.kpi),
        word: shown(word) ? word.textContent.trim() : '',
        tone: margin ? margin.dataset.tone || '' : '',
        commercial: style('commercialRate'),
        floor: style('floorRate'),
      };
    });
    const openEditor = async (q, st) => {
      await go(editorHash(q, st), 900);
      await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
      // La barra compacta, plegada (se abre sólo con "Ver detalle").
      await page.evaluate(() => {
        const toggle = document.querySelector('.qe-sum-toggle');
        if (toggle && document.querySelector('.qe-summary-inner.is-expanded')) toggle.click();
      });
      await page.waitForTimeout(200);
    };

    // Panel del escritorio: el resultado y el margen esperados, siempre a la vista.
    if (mode === 'desktop') {
      await openEditor(q0, 'service');
      const panel = await summaryState();
      check(D, 'resumen en vivo (panel de escritorio): el resultado y el margen esperados se ven sin abrir "Ver más"', panel.kpis.includes('expectedResult') && panel.kpis.includes('expectedMargin'), `a la vista: ${panel.kpis.join(', ')}`);
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.waitForTimeout(500);
    }

    // Barra compacta (1000 px en escritorio; 390 px en el celular).
    const where = mode === 'desktop' ? 'barra compacta (1000 px)' : 'barra compacta (celular)';
    const WORDS = ['cumple', 'debajo', 'pierde', 'no confiable', 'sin tarifa', 'sin objetivo'];
    await openEditor(q0, 'service');
    const bar = await summaryState();
    check(D, `${where}: plegada muestra costo, piso, tarifa cobrada y margen esperado`, bar.kpis.length === 4 && ['totalCost', 'floorRate', 'commercialRate', 'expectedMargin'].every((k) => bar.kpis.includes(k)), `a la vista: ${bar.kpis.join(', ')}`);
    check(D, `${where}: el margen dice su estado con una palabra, no sólo con el color (WCAG 1.4.1)`, WORDS.includes(bar.word), `palabra: "${bar.word}"`);
    check(D, `${where}: la tarifa cobrada se destaca de la piso (fondo propio y cifra más fuerte)`, Boolean(bar.commercial && bar.floor) && bar.commercial.bg !== bar.floor.bg && bar.commercial.weight > bar.floor.weight, JSON.stringify({ cobrada: bar.commercial, piso: bar.floor }));
    let detail = null;
    await soft(async () => {
      await tap(page.locator('.qe-sum-toggle').first());
      await page.waitForTimeout(400);
      detail = await summaryState();
      await tap(page.locator('.qe-sum-toggle').first());
      await page.waitForTimeout(300);
    });
    check(D, `${where}: "Ver detalle" muestra además "Para no perder" y el resultado esperado`, Boolean(detail) && ['breakEven', 'expectedResult', 'expectedMargin'].every((k) => detail.kpis.includes(k)), detail ? `a la vista: ${detail.kpis.join(', ')}` : 'no se pudo abrir');
    // Con un resultado NO CONFIABLE (E2E-20: un puesto sin sueldo básico), la barra lo dice en rojo (ECO-01).
    await openEditor(byId('E2E-20'), 'service');
    const unreliableBar = await summaryState();
    check(D, `${where}: con un resultado NO CONFIABLE el margen dice "no confiable", en rojo`, unreliableBar.word === 'no confiable' && unreliableBar.tone === 'red', `palabra "${unreliableBar.word}" · tono ${unreliableBar.tone || 'ninguno'}`);
    await scan(D, where);
    if (mode === 'desktop') {
      // A 1000 px el resumen también está fijo abajo: el aviso sale arriba y no lo tapa.
      await openEditor(q0, 'labor');
      let deskToast = null;
      await soft(async () => {
        await tap(page.locator('.qe-toolbar-pick').getByRole('button', { name: 'Agregar', exact: true }).first());
        await page.waitForSelector('.toast', { timeout: 3000 });
        await page.waitForTimeout(150);
        deskToast = await page.evaluate(() => {
          const r = [...document.querySelectorAll('.toast')].pop().getBoundingClientRect();
          const sum = document.querySelector('.qe-summary');
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, summaryTop: sum ? Math.round(sum.getBoundingClientRect().top) : null };
        });
      });
      check(D, `${where}: los avisos salen arriba y no tapan el resumen fijo`, Boolean(deskToast) && deskToast.summaryTop !== null && deskToast.bottom <= deskToast.summaryTop && deskToast.top < deskToast.vh / 3, deskToast ? JSON.stringify(deskToast) : 'no apareció el aviso');
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
    }

    /** La tabla con ese título: si está apilada (una tarjeta por fila) y si algo se sale de su caja o de la página. */
    const tableInfo = (caption) => page.evaluate((cap) => {
      const t = [...document.querySelectorAll('table')].find((x) => (x.querySelector('caption') || {}).textContent === cap);
      if (!t) return null;
      const wrap = t.closest('.table-wrap');
      return {
        stacked: getComputedStyle(t).display === 'block',
        wrapOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : 0,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, caption);
    const STACK_TABLES = [['indirect', 'Rubros de estructura'], ['margin', 'Tramos de descuento por cantidad de días']];
    const openStep = async (q, step) => {
      await go(editorHash(q, step), 900);
      // Los tramos pueden estar dentro de un plegable cerrado.
      await page.evaluate(() => document.querySelectorAll('.qe-step-body details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(200);
    };

    if (mode === 'desktop') {
      // En escritorio (1360 px) las dos tablas entran: siguen como tabla, sin tarjetas.
      const desk = [];
      for (const [step, caption] of STACK_TABLES) {
        await openStep(stackQ, step);
        desk.push({ caption, ...((await tableInfo(caption)) || { missing: true }) });
      }
      check(D, 'escritorio: las tablas de estructura y de tramos siguen como tabla (no pasan a tarjetas)', desk.every((x) => !x.missing && !x.stacked && x.pageOverflow <= 1), JSON.stringify(desk));
    }

    if (mode === 'mobile') {
      // Avisos arriba, debajo de la barra de la app: no tapan el resumen fijo ni "Menú".
      await openEditor(q0, 'labor');
      let toastBox = null;
      await soft(async () => {
        await tap(page.locator('.qe-toolbar-pick').getByRole('button', { name: 'Agregar', exact: true }).first());
        await page.waitForSelector('.toast', { timeout: 3000 });
        await page.waitForTimeout(150);
        toastBox = await page.evaluate(() => {
          const t = [...document.querySelectorAll('.toast')].pop();
          const r = t.getBoundingClientRect();
          const appBar = document.querySelector('.mobile-bar');
          const sum = document.querySelector('.qe-summary');
          return {
            top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right),
            vw: window.innerWidth, vh: window.innerHeight,
            appBar: appBar ? Math.round(appBar.getBoundingClientRect().bottom) : 0,
            summaryTop: sum ? Math.round(sum.getBoundingClientRect().top) : null,
          };
        });
      });
      check(D, 'celular: los avisos salen arriba, debajo de la barra de la app, y no tapan el resumen fijo', Boolean(toastBox) && toastBox.top >= toastBox.appBar - 1 && toastBox.top < toastBox.vh / 3 && (toastBox.summaryTop === null || toastBox.bottom <= toastBox.summaryTop) && toastBox.left >= 0 && toastBox.right <= toastBox.vw, toastBox ? JSON.stringify(toastBox) : 'no apareció el aviso');

      // Tablas de estructura y de tramos apiladas: sin scroll horizontal a 390, 360 y 320 px.
      const tables = [];
      for (const [step, caption] of STACK_TABLES) {
        await openStep(stackQ, step);
        if (!(await tableInfo(caption))) {
          tables.push({ caption, missing: true });
          continue;
        }
        for (const width of [390, 360, 320]) {
          await page.setViewportSize({ width, height: 844 });
          await page.waitForTimeout(300);
          tables.push({ caption, width, ...(await tableInfo(caption)) });
        }
        await page.setViewportSize(viewport);
        await page.waitForTimeout(300);
      }
      const badTables = tables.filter((x) => x.missing || !x.stacked || x.wrapOverflow > 1 || x.pageOverflow > 1);
      check(D, 'celular: las tablas de estructura y de tramos se apilan, sin scroll horizontal a 390, 360 y 320 px', tables.length > 0 && badTables.length === 0, JSON.stringify(badTables.slice(0, 4)));
    }

    // Campos: los obligatorios llevan aria-required y la ayuda de cada campo se asocia al control.
    const fieldAria = () => page.evaluate(() => {
      const out = { required: 0, hinted: 0, bad: [] };
      for (const f of document.querySelectorAll('.field')) {
        if (f.getBoundingClientRect().width === 0) continue;
        const control = f.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea');
        if (!control) continue;
        const label = ((f.querySelector('.field-label') || {}).textContent || '').replace(/\*/g, '').trim().slice(0, 40);
        if (f.querySelector('.field-label .req')) {
          out.required += 1;
          if (control.getAttribute('aria-required') !== 'true') out.bad.push(`obligatorio sin aria-required: ${label}`);
        }
        const hint = f.querySelector('.field-hint[id]');
        if (hint) {
          out.hinted += 1;
          if (!(control.getAttribute('aria-describedby') || '').split(/\s+/).includes(hint.id)) out.bad.push(`ayuda sin asociar: ${label}`);
        }
      }
      return out;
    });
    const aria = { required: 0, hinted: 0, bad: [] };
    for (const st of ['service', 'modality', 'labor', 'margin']) {
      await go(editorHash(q0, st), 800);
      const a = await fieldAria();
      aria.required += a.required;
      aria.hinted += a.hinted;
      aria.bad.push(...a.bad.map((b) => `${st}: ${b}`));
    }
    check(D, 'editor: los obligatorios llevan aria-required y la ayuda de cada campo se asocia al control (aria-describedby)', aria.required > 0 && aria.hinted > 0 && aria.bad.length === 0, `${aria.bad.length} de ${aria.required + aria.hinted}: ${aria.bad.slice(0, 5).join(' | ')}`);

    // Los avisos del motor junto a un campo se asocian al control: un lector de pantalla los lee al entrar.
    let notes = null;
    for (const id of ['E2E-07', 'E2E-20']) {
      for (const st of ['modality', 'margin', 'labor', 'finance']) {
        await go(editorHash(byId(id), st), 700);
        const found = await page.evaluate(() => [...document.querySelectorAll('.qe-issue-note')]
          .filter((note) => note.getBoundingClientRect().width > 0)
          .map((note) => {
            const field = note.closest('.field, .choice-group');
            const control = field && field.querySelector('input, select, textarea');
            const ids = control ? (control.getAttribute('aria-describedby') || '').split(/\s+/) : [];
            return Boolean(note.id) && ids.includes(note.id);
          }));
        if (found.length) notes = (notes || []).concat(found);
      }
      if (notes) break;
    }
    check(D, 'editor: los avisos del motor junto a un campo se asocian al control (aria-describedby)', Boolean(notes) && notes.every(Boolean), notes ? `${notes.filter((x) => !x).length} de ${notes.length} sin asociar` : 'ningún escenario mostró avisos junto a un campo');

    // El eco de los montos sigue en el editor: el sueldo del primer puesto se lee con separadores.
    await go(editorHash(q0, 'labor'), 800);
    const editorEcho = await page.evaluate(() => [...document.querySelectorAll('.field-echo, .qe-num-echo')]
      .filter((e) => !e.hidden && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
    check(D, 'editor: los montos grandes siguen con su eco con separadores ("$ …")', editorEcho.length > 0 && editorEcho.every((t) => /^-?\$\s?[\d.]+(,\d+)?$/.test(t.replace(/[  ]/g, ' '))), editorEcho.slice(0, 3).join(' | ') || 'sin eco');

    // Recursos: el eco también ahí. Sólo con teclado: Tab hasta "Agregar perfil", Enter, Tab hasta el sueldo,
    // tipear; Tab y Shift+Tab vuelven al campo con todo seleccionado y lo nuevo reemplaza al número anterior.
    const activeField = () => page.evaluate(() => {
      const el = document.activeElement;
      const field = el && el.closest('.field');
      const echo = field ? field.querySelector('.field-echo, .qe-num-echo') : null;
      return {
        value: el ? el.value : null,
        echo: echo && !echo.hidden && echo.getBoundingClientRect().width > 0 ? echo.textContent.replace(/[  ]/g, ' ').trim() : '',
        required: el ? el.getAttribute('aria-required') : null,
      };
    });
    const kb = { opened: false, reached: false, first: null, second: null, closed: false };
    await soft(async () => {
      await go('#/recursos/personal', 900);
      await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
      for (let i = 0; i < 60; i += 1) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => Boolean(document.activeElement && /Agregar perfil/.test(document.activeElement.textContent || '')))) break;
      }
      await page.keyboard.press('Enter');
      await page.waitForSelector('dialog[open]', { timeout: 3000 });
      kb.opened = true;
      for (let i = 0; i < 40 && !kb.reached; i += 1) {
        await page.keyboard.press('Tab');
        kb.reached = await page.evaluate(() => {
          const field = document.activeElement && document.activeElement.closest('.field');
          return Boolean(field && /Sueldo básico mensual/.test((field.querySelector('.field-label') || {}).textContent || ''));
        });
      }
      if (!kb.reached) return;
      await page.keyboard.type('2600000');
      await page.waitForTimeout(150);
      kb.first = await activeField();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.type('3500000');
      await page.waitForTimeout(150);
      kb.second = await activeField();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      // Con UX-01 (#32), un formulario con cambios pregunta antes de descartarlos.
      if (await page.locator('dialog[open]').count()) {
        const discard = page.locator('dialog[open]').getByRole('button', { name: /Descartar/ }).first();
        if (await discard.count()) await discard.click();
        await page.waitForTimeout(300);
      }
      kb.closed = (await page.locator('dialog[open]').count()) === 0;
    });
    check(D, 'Recursos: el sueldo básico es obligatorio también para los lectores de pantalla (aria-required)', Boolean(kb.first) && kb.first.required === 'true', JSON.stringify(kb.first));
    check(D, 'Recursos: al escribir un sueldo aparece el eco con separadores ("$ 2.600.000")', Boolean(kb.first) && kb.first.echo === '$ 2.600.000', JSON.stringify(kb.first));
    check(D, 'sólo con teclado: Tab hasta el sueldo y tipear; Shift+Tab vuelve con todo seleccionado y lo nuevo reemplaza al número anterior; Esc cierra', kb.opened && kb.reached && Boolean(kb.second) && kb.second.value === '3500000' && kb.second.echo === '$ 3.500.000' && kb.closed, JSON.stringify(kb));

    // En el celular, con el sueldo justo en el borde de abajo del diálogo (como al tocarlo sin desplazar), el eco que
    // aparece al escribir tiene que quedar a la vista, no debajo del pie. Con 360 × 640 px el sueldo queda debajo
    // del borde al abrir el diálogo; en escritorio queda en la mitad de arriba y ese caso no se da.
    if (mode === 'mobile') {
      const edge = { atEdge: null, closed: false, echo: null };
      await soft(async () => {
        await page.setViewportSize({ width: 360, height: 640 });
        await go('#/recursos/personal', 900);
        await tap(page.getByRole('button', { name: 'Agregar perfil' }).first());
        await page.waitForSelector('dialog[open]', { timeout: 3000 });
        await page.waitForTimeout(300);
        const salary = page.locator('dialog[open]').getByLabel('Sueldo básico mensual').first();
        // El campo, alineado con el borde de abajo de lo visible del diálogo, y con el foco sin desplazar.
        edge.atEdge = await salary.evaluate((el) => {
          el.scrollIntoView({ block: 'end' });
          el.focus({ preventScroll: true });
          const body = el.closest('.dialog-body');
          const visibleBottom = body.getBoundingClientRect().top + body.clientTop + body.clientHeight;
          return Math.abs(el.getBoundingClientRect().bottom - visibleBottom) <= 2;
        });
        await page.keyboard.type('2600000');
        await page.waitForTimeout(250);
        edge.echo = await page.evaluate(() => {
          const field = document.activeElement && document.activeElement.closest('.field');
          const echo = field ? field.querySelector('.field-echo, .qe-num-echo') : null;
          if (!echo || echo.hidden) return { text: '' };
          const body = echo.closest('.dialog-body');
          const box = body.getBoundingClientRect();
          const r = echo.getBoundingClientRect();
          return {
            text: echo.textContent.replace(/[\u00a0\u202f]/g, ' ').trim(),
            top: Math.round(r.top), bottom: Math.round(r.bottom),
            visibleTop: Math.round(box.top + body.clientTop), visibleBottom: Math.round(Math.min(window.innerHeight, box.top + body.clientTop + body.clientHeight)),
          };
        });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        if (await page.locator('dialog[open]').count()) {
          const discard = page.locator('dialog[open]').getByRole('button', { name: /Descartar/ }).first();
          if (await discard.count()) await discard.click();
          await page.waitForTimeout(300);
        }
        edge.closed = (await page.locator('dialog[open]').count()) === 0;
      });
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      const e = edge.echo;
      check(D, 'celular (360 × 640 px), Recursos: con el sueldo en el borde de abajo del diálogo, el eco que aparece al escribir queda a la vista (no debajo del pie)', edge.atEdge === true && Boolean(e) && e.text === '$ 2.600.000' && e.top >= e.visibleTop - 1 && e.bottom <= e.visibleBottom + 1 && edge.closed, JSON.stringify(edge));
    }
    await scan(D, 'Recursos');
  }

  // ---- P1 CIERRE (PLAN-2026-028, Gate A de la revisión del 21/10): señales que pueden llevar a confiar en un
  // precio equivocado. H-09 cantidad de un externo por km, H-10 cobertura del personal, H-12 estado de la lista
  // de productos, H-13 margen de la configuración de ejemplo y H-14 veredicto del precio de hoy. Las cifras son
  // las del motor y no cambian al confirmar. Siembra sus propios datos SINTÉTICOS (fixtures de AUD-T1 E3 y E4).
  {
    const P = 'P1-CIERRE';
    const fixture = (name) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'eco-01', `${name}.json`), 'utf8'));
    const stored = (list, id) => ((db.workspaces.get(orgId).state[list] || []).find((x) => x.id === id) || null);
    const waitFor = async (list, id, test) => {
      let x = null;
      for (let i = 0; i < 30; i += 1) {
        x = stored(list, id);
        if (x && test(x)) break;
        await page.waitForTimeout(150);
      }
      return x;
    };
    const visibleText = (selector) => page.evaluate((sel) => {
      const b = [...document.querySelectorAll(sel)].find((x) => !x.closest('[hidden]') && x.offsetParent !== null);
      return b ? b.innerText : '';
    }, selector);
    const pendingFields = () => page.evaluate(() => [...document.querySelectorAll('.qr-checklist a[href*="campo="]')].map((a) => decodeURIComponent((a.getAttribute('href') || '').split('campo=')[1] || '')));

    const e3 = fixture('e3-cotizacion');
    e3.equipment[0].quantity = 2;
    Object.assign(e3, { id: randomUUID(), organizationId: orgId, code: 'LAB-P1C', name: 'P1C transporte con 2 camiones por km', offerDate: '2026-10-16', createdAt: now, updatedAt: now });
    const e3r = computeQuote(structuredClone(e3));
    const e4 = (name, patch) => {
      const p = fixture('e4-producto');
      Object.assign(p, { id: randomUUID(), organizationId: orgId, name, createdAt: now, updatedAt: now });
      patch(p);
      return p;
    };
    const review = e4('P1C producto con impuestos sin definir', (p) => { p.billingTaxes = null; });
    const impossible = e4('P1C producto sin ventas por mes', (p) => { p.monthlyUnits = 0; p.pricing.currentPrice = 120000; });
    const fresh = createEmptyProduct({ organizationId: orgId, settings: defaultSettings(orgId), now, id: randomUUID() });
    fresh.name = 'P1C producto nuevo con el margen de ejemplo';
    const live = db.workspaces.get(orgId);
    live.state.quotes = [...live.state.quotes, e3];
    live.state.products = [...(Array.isArray(live.state.products) ? live.state.products : []), review, impossible, fresh];
    live.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);

    // H-09: externo por km con cantidad 2 → ¿cada unidad hace todo el recorrido?
    check(P, 'H-09: el motor pide confirmar la cantidad del externo por km (crítico, no NO CONFIABLE)', Boolean(e3r.completeness.pending.find((p) => p.id === 'external_quantity' && p.severity === 'critical' && p.unreliable !== true)), 'sin el pendiente');
    await go(`#/cotizaciones/${encodeURIComponent(e3.id)}/equipment`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const qty = norm(await visibleText('.qe-quantity-confirm:not(.is-confirmed)'));
    check(P, 'H-09: Equipos pregunta "¿Cada unidad hace todo el recorrido?" con los km de la ruta y los facturados', /¿Cada unidad hace todo el recorrido\?/.test(qty) && qty.includes('11.520 km') && qty.includes('23.040 km'), qty.slice(0, 220));
    const allRoute = page.getByRole('button', { name: 'Cada unidad hace todo el recorrido' }).first();
    if (await allRoute.isVisible().catch(() => false)) {
      await tap(allRoute);
      const saved = await waitFor('quotes', e3.id, (q) => q.equipment[0] && q.equipment[0].externalQuantityConfirmed);
      const c = saved && saved.equipment[0].externalQuantityConfirmed;
      check(P, 'H-09: la confirmación se guarda ligada a la unidad y la cantidad', Boolean(c) && c.unit === 'km' && c.quantity === 2, JSON.stringify(c));
      await page.waitForTimeout(400);
      check(P, 'H-09: queda a la vista "Confirmado: cada unidad hace todo el recorrido"', /Confirmado: cada unidad hace todo el recorrido/.test(await visibleText('.qe-quantity-confirm.is-confirmed')), 'sin la confirmación a la vista');
    } else {
      check(P, 'H-09: el botón "Cada unidad hace todo el recorrido" está a la vista', false, 'sin botón');
    }

    // H-10: el coordinador compartido (18 días × 10 h contra 176 h) → revisar o confirmar, sin sumar personas.
    await go(`#/cotizaciones/${encodeURIComponent(e3.id)}/labor`, 300);
    await page.waitForSelector('[data-kpi="totalCost"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const cov = norm(await visibleText('.qe-coverage-confirm:not(.is-confirmed)'));
    check(P, 'H-10: Personal pregunta si la operación está cubierta, con las horas que faltan, y dice que no hace falta sumar personas', /¿Está cubierta la operación\?/.test(cov) && /faltan 4 h/.test(cov) && /no hace falta sumar personas/.test(cov), cov.slice(0, 220));
    const covered = page.getByRole('button', { name: 'La cobertura está prevista' }).first();
    if (await covered.isVisible().catch(() => false)) {
      await tap(covered);
      const saved = await waitFor('quotes', e3.id, (q) => q.labor[0] && q.labor[0].coverageConfirmed);
      const c = saved && saved.labor[0].coverageConfirmed;
      check(P, 'H-10: la confirmación se guarda con el supuesto (días, horas y personas)', Boolean(c) && c.activeDaysPerMonth === 18 && c.hoursPerActiveDay === 10 && c.peoplePerPosition === 1, JSON.stringify(c));
      check(P, 'H-10: no se sumó ninguna persona', Boolean(saved) && saved.labor[0].peoplePerPosition === 1, saved ? String(saved.labor[0].peoplePerPosition) : 'sin guardar');
    } else {
      check(P, 'H-10: el botón "La cobertura está prevista" está a la vista', false, 'sin botón');
    }
    await go(`#/cotizaciones/${encodeURIComponent(e3.id)}/result`, 300);
    await page.waitForSelector('.qr-checklist', { timeout: 8000 }).catch(() => {});
    const after = await pendingFields();
    const resultText = norm(await page.evaluate(() => document.body.innerText));
    check(P, 'H-09 y H-10: confirmados, el Resultado ya no los pide y el costo del mes es el del motor', !after.includes('equipment.0.quantity') && !after.includes('labor.0.peoplePerPosition') && resultText.includes(norm(formatMoney(e3r.kpis.totalCost))), JSON.stringify(after));

    // H-12: un aviso pendiente no dice "Completo" en la lista.
    await go('#/productos', 800);
    const row = await page.evaluate((name) => {
      const r = [...document.querySelectorAll('tr')].find((x) => x.innerText && x.innerText.includes(name));
      return r ? r.innerText : '';
    }, review.name);
    check(P, 'H-12: con un aviso pendiente la lista dice "Revisar (1)" y ofrece "Ver avisos", no "Completo"', /Revisar \(1\)/.test(row) && /Ver avisos/.test(row) && !/Completo/.test(row), norm(row).slice(0, 200));

    // H-14: sin ventas por mes el precio de hoy no se puede evaluar.
    await go(`#/productos/${encodeURIComponent(impossible.id)}/resultado`, 300);
    await page.waitForTimeout(800);
    const verdict = await page.evaluate(() => {
      const b = document.querySelector('[data-verdict]');
      return b ? { kind: b.dataset.verdict, cls: b.className, text: b.innerText } : null;
    });
    check(P, 'H-14: sin ventas por mes el precio de hoy "no se puede evaluar" (nunca verde)', Boolean(verdict) && verdict.kind === 'not_evaluable' && !/banner-success/.test(verdict.cls) && /No se puede evaluar/.test(verdict.text), JSON.stringify(verdict));
    check(P, 'H-14: no aparece "Tu precio de hoy cubre tus costos y el margen que querés."', !norm(await page.evaluate(() => document.body.innerText)).includes('Tu precio de hoy cubre tus costos y el margen que querés.'), 'sigue el veredicto verde');

    // H-13: el margen de la configuración de ejemplo se marca y "Es mi margen" lo confirma sin cambiarlo.
    await go(`#/productos/${encodeURIComponent(fresh.id)}/precio`, 300);
    await page.waitForTimeout(800);
    const marg = await page.evaluate(() => {
      const input = document.querySelector('[name="pricing.targetMarginPct"]');
      const field = input && input.closest('.field');
      const note = document.querySelector('.pe-margin-example');
      return { tag: Boolean(field && field.querySelector('.tag-illustrative')), note: note ? note.innerText : '' };
    });
    check(P, 'H-13: el margen heredado de la configuración de ejemplo lleva la marca ILUSTRATIVO y lo explica', marg.tag && /Margen de ejemplo/.test(marg.note), JSON.stringify(marg));
    const mine = page.getByRole('button', { name: 'Es mi margen' }).first();
    if (await mine.isVisible().catch(() => false)) {
      await tap(mine);
      const saved = await waitFor('products', fresh.id, (p) => p.pricing && p.pricing.marginFromExample === undefined);
      check(P, 'H-13: "Es mi margen" lo confirma (se guarda) sin cambiar el valor', Boolean(saved) && saved.pricing.marginFromExample === undefined && saved.pricing.targetMarginPct === fresh.pricing.targetMarginPct, saved ? JSON.stringify(saved.pricing) : 'sin guardar');
    } else {
      check(P, 'H-13: el botón "Es mi margen" está a la vista', false, 'sin botón');
    }
    await scan(P, 'producto');
  }

  // ---- BETA-RC2 UI (revisión de frontend de la beta): lo que la pantalla afirma con color y orden.
  // UI-01 "perdés plata" arriba de los números y tarifa bajo el piso en rojo con su nombre, UI-03 un monto en la
  // primera pantalla con BORRADOR, UI-02 "Costos cargados"
  // nunca en verde con un pendiente crítico, UI-11 filtros de Recursos legibles y UI-12 objetivos de 44 px en el
  // celular. Cotización SINTÉTICA: AUD-T1 E3 con 2 camiones por km sin confirmar y una tarifa ofrecida de $ 1.000.
  {
    const P = 'BETA-RC2-UI';
    const ui = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'eco-01', 'e3-cotizacion.json'), 'utf8'));
    ui.equipment[0].quantity = 2;
    ui.pricing.offeredRateOverride = 1000;
    Object.assign(ui, { id: randomUUID(), organizationId: orgId, code: 'LAB-UI2', name: 'UI2 tarifa ofrecida bajo el piso', offerDate: '2026-10-16', createdAt: now, updatedAt: now });
    const uir = computeQuote(structuredClone(ui));
    check(P, 'el caso tiene un pendiente crítico con "Costos cargados" sobre el umbral verde y la tarifa bajo el piso', uir.completeness.critical > 0 && uir.completeness.scorePct >= 85 && uir.kpis.belowFloor === true && uir.kpis.commercialSource === 'offered', JSON.stringify({ critical: uir.completeness.critical, pct: uir.completeness.scorePct, belowFloor: uir.kpis.belowFloor }));
    const live = db.workspaces.get(orgId);
    live.state.quotes = [...live.state.quotes, ui];
    live.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);

    await go(`#/cotizaciones/${encodeURIComponent(ui.id)}/result`, 300);
    await page.waitForSelector('.qr-stats', { timeout: 8000 }).catch(() => {});
    const res = await page.evaluate(() => {
      const alerts = document.querySelector('.qr-alerts-price');
      const stats = document.querySelector('.qr-stats');
      const price = document.querySelector('.qr-stat-price');
      const kpi = [...document.querySelectorAll('.qr-kpis .kpi')].find((k) => /Costos cargados/.test(k.innerText));
      const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
      return {
        alertsFirst: Boolean(alerts && stats) && Boolean(alerts.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING),
        alertText: alerts ? alerts.innerText.slice(0, 120) : '',
        alertTop: top(alerts),
        statsTop: top(stats),
        draftHeight: document.querySelector('.qr-draft') ? Math.round(document.querySelector('.qr-draft').getBoundingClientRect().height) : null,
        screen: window.innerHeight,
        priceCls: price ? price.className : '',
        priceLabel: price ? price.innerText.split('\n')[0] : '',
        kpiCls: kpi ? kpi.className : 'sin KPI',
      };
    });
    check(P, 'UI-01: "perdés plata" está arriba de los números del resumen', res.alertsFirst && /perdés plata/.test(res.alertText), JSON.stringify(res));
    // UI-03: con BORRADOR, el aviso no ocupa la pantalla (cada pendiente en 2 renglones en el celular). En escritorio, la
    // alerta de la tarifa entra en la primera pantalla. En el celular, con otro aviso de página arriba, todavía no: ver el informe.
    if (mode === 'mobile') check(P, 'UI-03: en el celular el aviso BORRADOR ocupa menos de un tercio de la pantalla', res.draftHeight !== null && res.draftHeight < res.screen / 3, JSON.stringify({ draftHeight: res.draftHeight, screen: res.screen }));
    else check(P, 'UI-03: con BORRADOR, la alerta de la tarifa entra en la primera pantalla', res.alertTop !== null && res.alertTop < res.screen, JSON.stringify({ alertTop: res.alertTop, statsTop: res.statsTop, screen: res.screen }));
    check(P, 'UI-01: la tarifa ofrecida bajo el piso se llama "Tarifa ofrecida" y va en rojo', /big-stat-red/.test(res.priceCls) && /Tarifa ofrecida/i.test(res.priceLabel), JSON.stringify({ cls: res.priceCls, label: res.priceLabel }));
    check(P, 'UI-02: con un pendiente crítico, el KPI "Costos cargados" no es verde', !/kpi-green/.test(res.kpiCls), res.kpiCls);
    await go('#/cotizaciones', 800);
    // "Costos cargados" está en la vista Detallada de la lista.
    await tap(page.getByRole('button', { name: 'Detallada' }).first()).catch(() => {});
    await page.waitForTimeout(400);
    const listTone = await page.evaluate((name) => {
      const r = [...document.querySelectorAll('tr, .table-card, li')].find((x) => x.innerText && x.innerText.includes(name));
      const bar = r && r.querySelector('.progress');
      return bar ? bar.className : 'sin barra';
    }, ui.name);
    check(P, 'UI-02: en la lista de cotizaciones la barra de "Costos cargados" tampoco es verde', !/progress-green/.test(listTone) && /progress-/.test(listTone), listTone);

    if (mode === 'mobile') {
      // UI-11: el filtro por convenio se lee entero ("Todos los convenios").
      await go('#/recursos/personal', 800);
      const fits = await page.evaluate(() => {
        const sel = document.querySelector('select[name="convenio"]');
        if (!sel) return { ok: false, why: 'sin selector' };
        const cs = getComputedStyle(sel);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = sel.options[sel.selectedIndex].text;
        const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { ok: ctx.measureText(text).width <= room, text, room: Math.round(room), need: Math.round(ctx.measureText(text).width) };
      });
      check(P, 'UI-11: en el celular el filtro de Personal se lee entero', fits.ok, JSON.stringify(fits));
      // UI-12: objetivos de al menos 44 px (computados: el menú puede estar cerrado).
      const small = await page.evaluate(() => [...document.querySelectorAll('.account-action, .cost-legend-details > summary')]
        .map((el) => ({ cls: el.className || el.tagName, min: parseFloat(getComputedStyle(el).minHeight) || 0 }))
        .filter((x) => x.min < 44));
      check(P, 'UI-12: "Mi cuenta", "Cerrar sesión" y los desplegables de Recursos tienen 44 px en el celular', small.length === 0, JSON.stringify(small));
    }
    await scan(P, 'resultado');
  }

  // ---- K0 (último pase de UX antes del ensayo real): montos de cientos y miles de millones que nunca se parten
  // (K0C-01), "Error al guardar" que se va solo al reconectar (K0E-03) y la columna fija de Recursos que no tapa
  // montos a 1024 y 1280 px (K0E-01). Cotizaciones SINTÉTICAS con montos de 9 y 10 dígitos.
  {
    const P = 'K0';
    const meta = (q, id, name) => Object.assign(q, { id: randomUUID(), organizationId: orgId, code: `LAB-${id}`, name, offerDate: '2026-10-16', createdAt: now, updatedAt: now });
    const km = (id, price) => meta(service({ id: `k0-${id}`, serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1 }, labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })], equipment: [external({ name: 'Camión tercerizado' }, { price, unit: 'km' })], logistics: route({ distanceKm: 100, tripsPerActivation: 1 }) }), id, `K0 transporte ${id}`);
    const month = (id, value) => meta(service({ id: `k0-${id}`, serviceType: 'permanent', unit: 'month', contractMonths: 12, activity: { activeDaysPerMonth: 22 }, labor: [person({ role: 'Operador', basicMonthly: 3850000 })], equipment: [owned({ name: 'Hidrogrúa', replacementValue: value, usefulLifeYears: 10, quantity: 2 })] }), id, `K0 abono ${id}`);
    const big = [km('KM10', 150000), km('KM11', 1500000), month('MES10', 12000000000), month('MES11', 120000000000)];
    check(P, 'los casos tienen montos de 9 y 10 dígitos', big.some((q) => computeQuote(structuredClone(q)).kpis.totalCost >= 1e9) && big.every((q) => computeQuote(structuredClone(q)).kpis.totalCost >= 1e8), big.map((q) => Math.round(computeQuote(structuredClone(q)).kpis.totalCost)).join(', '));
    const live = db.workspaces.get(orgId);
    live.state.quotes = [...live.state.quotes, ...big];
    live.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);

    // Un monto partido en dos renglones, o que se sale de su tarjeta, se mide sobre el texto (no sobre la caja).
    const amounts = () => page.evaluate(() => {
      const root = document.querySelector('main') || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const re = /(US\$|\$)\s?-?\d{1,3}(\.\d{3})+(,\d+)?/g;
      const split = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !el.getClientRects().length || el.closest('[hidden], .sr-only')) continue;
        re.lastIndex = 0;
        for (let m = re.exec(n.textContent); m; m = re.exec(n.textContent)) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          if (new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top))).size > 1) split.push(m[0]);
        }
      }
      const outside = [];
      for (const num of document.querySelectorAll('main .qr-stat .big-stat-number, main .qr-base-item dd, main .qe-sum-number, main .qr-hero-value')) {
        if (!num.getClientRects().length) continue;
        const range = document.createRange();
        range.selectNodeContents(num);
        const a = range.getBoundingClientRect();
        const b = num.closest('.qr-stat, .qr-base-item, .qe-sum-item, .qr-hero-item').getBoundingClientRect();
        if (a.right > b.right + 1.5 || a.left < b.left - 1.5) outside.push(`${num.textContent.trim()} (${Math.round(a.right - b.right)} px)`);
      }
      const d = document.documentElement;
      return { split, outside, overflow: Math.max(d.scrollWidth - d.clientWidth, 0) };
    });
    const widths = mode === 'mobile' ? [320, 360, 390] : [1024, 1152, 1440];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: mode === 'mobile' ? 800 : 900 });
      const bad = [];
      for (const q of big) {
        await go(`#/cotizaciones/${encodeURIComponent(q.id)}/result`, 1200);
        await page.waitForSelector('.qr-stats', { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.querySelectorAll('main details').forEach((x) => { x.open = true; }));
        await page.waitForTimeout(200);
        const r = await amounts();
        if (r.split.length || r.outside.length || r.overflow > 1) bad.push(`${q.code}: ${JSON.stringify(r)}`);
      }
      check(P, `K0C-01 a ${w} px: ningún monto partido ni fuera de su tarjeta en el Resultado (4 cotizaciones)`, bad.length === 0, bad.join(' | '));
    }
    if (mode === 'mobile') {
      // El detalle del resumen en vivo ("Ver detalle") a 320 px: los montos van de a uno por fila y enteros.
      await page.setViewportSize({ width: 320, height: 640 });
      await go(`#/cotizaciones/${encodeURIComponent(big[3].id)}/service`, 1200);
      const toggle = page.locator('.qe-sum-toggle').first();
      if (await toggle.count()) await tap(toggle).catch(() => {});
      await page.waitForTimeout(300);
      const s = await amounts();
      check(P, 'K0C-01: el detalle del resumen en vivo a 320 px no parte ningún monto', s.split.length === 0 && s.outside.length === 0, JSON.stringify(s));
    }
    await page.setViewportSize(viewport);

    // K0E-03: sin red se cambia un dato, se sale y se vuelve (borrador recuperado); vuelve la red y "Reintentar":
    // el editor queda en "Guardado" y no queda ningún "Error al guardar" (ni en el editor ni como aviso).
    const offline = (r) => r.abort('internetdisconnected');
    const isSupa = (u) => u.href.startsWith(SUPA);
    const state = () => page.evaluate(() => ({
      save: (document.querySelector('.qe-save') || { dataset: {} }).dataset.status || null,
      errors: [...document.querySelectorAll('.toast')].map((t) => t.innerText.replace(/\s+/g, ' ')).filter((t) => /Error al guardar/.test(t)),
    }));
    await go(`#/cotizaciones/${encodeURIComponent(big[0].id)}/logistics`, 1500);
    const errorsBeforeOffline = errors.length;
    await context.route(isSupa, offline);
    const fuelInput = page.locator('input[name="fuel.pricePerLiter"]').first();
    await fuelInput.fill('1750').catch(() => {});
    await fuelInput.press('Tab').catch(() => {});
    await page.waitForTimeout(3500);
    await go('#/cotizaciones', 1200);
    await go(`#/cotizaciones/${encodeURIComponent(big[0].id)}/logistics`, 1800);
    const offlineState = await state();
    await context.unroute(isSupa, offline);
    await page.waitForTimeout(500);
    const retry = page.getByRole('button', { name: 'Reintentar' }).first();
    if (await retry.count()) await tap(retry).catch(() => {});
    await page.waitForTimeout(4000);
    const back = await state();
    await go('#/inicio', 1200);
    const home = await state();
    // El navegador anota en la consola cada pedido cortado por el corte de red simulado: es del test, no de la
    // app. Se descartan sólo esos; cualquier otro error del corte sigue contando.
    for (let i = errors.length - 1; i >= errorsBeforeOffline; i -= 1) {
      if (/net::ERR_INTERNET_DISCONNECTED/.test(errors[i])) errors.splice(i, 1);
    }
    const savedFuel = ((db.workspaces.get(orgId).state.quotes || []).find((q) => q.id === big[0].id) || { fuel: {} }).fuel.pricePerLiter;
    check(P, 'K0E-03: sin red, el borrador recuperado se ve como error (punto de partida del caso)', offlineState.save === 'error', JSON.stringify(offlineState));
    check(P, 'K0E-03: al volver la red queda "Guardado", el cambio está en la nube y no queda ningún "Error al guardar"', back.save === 'saved' && back.errors.length === 0 && home.errors.length === 0 && savedFuel === 1750, JSON.stringify({ back, home, savedFuel }));

    // K0E-01: a 1024 y 1280 px la columna fija "Acciones" no tapa montos de Personal ("Por convenio", la vista de entrada).
    if (mode === 'desktop') {
      for (const w of [1024, 1280]) {
        await page.setViewportSize({ width: w, height: 800 });
        await go('#/recursos/personal', 1000);
        const covered = await page.evaluate(() => [...document.querySelectorAll('main .table-wrap')].flatMap((wrap) => {
          const t = wrap.querySelector('table');
          const act = t && t.querySelector('td[data-label="Acciones"]:last-child');
          if (!act || getComputedStyle(act).position !== 'sticky') return [];
          const ar = act.getBoundingClientRect();
          // La propia celda fija también es ta-right: se compara sólo con las celdas de montos.
          return [...t.querySelectorAll('tbody td.ta-right, tbody td[data-label*="Costo"], tbody td[data-label*="Bruto"]')]
            .filter((td) => td.dataset.label !== 'Acciones')
            .map((td) => ({ label: td.dataset.label, px: Math.round(Math.max(0, Math.min(td.getBoundingClientRect().right, ar.right) - Math.max(td.getBoundingClientRect().left, ar.left))) }))
            .filter((x) => x.px > 8);
        }));
        check(P, `K0E-01 a ${w} px: la columna fija de Personal no tapa montos`, covered.length === 0, JSON.stringify(covered));
      }
      await page.setViewportSize(viewport);
    }
    await scan(P, 'después de K0');
  }

  // ---- UX-UNITS (Issue #5 de RATEOS-AUDIT): unidad de cobro "ARS / [unidad]", rendimiento compuesto, cantidad en
  // días de trabajo, cambio de unidad sin leer un número en otra unidad (F4), ayudas (i) con mouse, toque y teclado,
  // y "La cuenta del mes" con las cifras del motor. Cotizaciones SINTÉTICAS.
  {
    const P = 'UXU';
    await page.setViewportSize(viewport);
    const meta = (q, id, name) => Object.assign(q, { id: randomUUID(), organizationId: orgId, code: `LAB-${id}`, name, offerDate: '2026-10-16', createdAt: now, updatedAt: now });
    const driver = () => person({ role: 'Chofer', basicMonthly: 2100000 });
    const truck = () => owned({ name: 'Camión cisterna 20 m³', replacementValue: 180000000, usefulLifeYears: 10, fuelLitersPerHour: 12, hoursPerActiveDay: 10 });
    const water = (id) => meta(service({ id: `uxu-${id}`, serviceType: 'per_unit', unit: 'm3', activity: { billableQuantityPerMonth: 200, unitsPerActiveDay: 20, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 10 }, labor: [driver()], equipment: [truck()] }), id, `UXU agua por m³ ${id}`);
    const m3 = water('M3');
    const res = water('RES');
    const kg = meta(service({ id: 'uxu-kg', serviceType: 'per_unit', unit: 'kg', pricingMode: 'known_rate', pricing: { knownRate: 50 }, activity: { billableQuantityPerMonth: 5000, unitsPerActiveDay: 500, daysPerActivation: 1 }, labor: [driver()] }), 'UXU-KG', 'UXU por kg');
    const call = meta(service({ id: 'uxu-call', serviceType: 'on_call', unit: 'call', activity: { billableQuantityPerMonth: 6, daysPerActivation: 1 }, labor: [driver()] }), 'UXU-CALL', 'UXU por llamado');
    const stale = meta(service({ id: 'uxu-stale', serviceType: 'configurable', unit: 'day', activity: { activeDaysPerMonth: 8, billableQuantityPerMonth: 300, unitsPerActiveDay: 30 }, labor: [driver()] }), 'UXU-STALE', 'UXU por día con una cantidad vieja');
    const kmq = meta(service({ id: 'uxu-km', serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 6000, unitsPerActiveDay: 400, daysPerActivation: 1, hoursPerActiveDay: 8 }, labor: [driver()], equipment: [truck()], logistics: route({ distanceKm: 100, tripsPerActivation: 2 }) }), 'UXU-KM', 'UXU traslado por km');
    const live = db.workspaces.get(orgId);
    live.state.quotes = [...live.state.quotes, m3, res, kg, call, stale, kmq];
    live.revision += 1;
    await page.reload();
    await page.waitForTimeout(2500);
    const stored = (id) => (db.workspaces.get(orgId).state.quotes || []).find((x) => x.id === id) || null;
    const waitStored = async (id, test) => {
      let q = null;
      for (let i = 0; i < 25; i += 1) {
        q = stored(id);
        if (q && test(q)) break;
        await page.waitForTimeout(150);
      }
      return q;
    };
    const mainText = async () => norm(await page.evaluate(() => (document.querySelector('main') || document.body).innerText));
    const dialog = () => page.evaluate(() => {
      const d = document.querySelector('dialog[open]');
      return d ? { text: d.innerText, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null;
    });
    const press = async (name) => {
      const btn = page.locator('dialog[open] button', { hasText: name }).first();
      if (await btn.count()) await tap(btn);
      await page.waitForTimeout(700);
    };
    /** Elige la unidad de cobro: selector (muchas unidades) o botón de opción (pocas). */
    const chooseUnit = async (value) => {
      const sel = page.locator('select[name="unit"]').first();
      if (await sel.count()) await sel.selectOption(value);
      else await tap(page.locator(`input[type="radio"][name="unit"][value="${value}"]`).first());
    };
    const setNumber = async (name, value) => {
      const input = page.locator(`input[name="${name}"]`).first();
      await input.fill(String(value));
      await input.press('Tab');
      await page.waitForTimeout(500);
    };

    // 1. "ARS / [m³ ▾]", las mismas unidades habituales que K0, y menos texto de ayuda.
    await go(`#/cotizaciones/${encodeURIComponent(m3.id)}/modality`, 1200);
    await page.waitForSelector('select[name="unit"]', { timeout: 8000 }).catch(() => {});
    const unitUi = await page.evaluate(() => {
      const sel = document.querySelector('select[name="unit"]');
      const field = sel && sel.closest('.field');
      return {
        value: sel && sel.value,
        radios: document.querySelectorAll('input[type="radio"][name="unit"]').length,
        prefix: field && field.querySelector('.qe-compound-fixed') ? field.querySelector('.qe-compound-fixed').textContent : null,
        label: field && field.querySelector('label.field-label') ? field.querySelector('label.field-label').textContent : null,
        options: sel ? [...sel.options].map((o) => o.value) : [],
      };
    });
    check(P, 'la unidad de cobro es "ARS / [m³ ▾]": un selector con la moneda a la vista, sin tarjetas de radio', unitUi.value === 'm3' && unitUi.radios === 0 && norm(unitUi.prefix) === 'ARS /' && /Unidad de cobro/.test(unitUi.label || ''), JSON.stringify(unitUi));
    check(P, 'el selector ofrece las mismas unidades que K0 (las habituales del tipo de servicio + otra)', JSON.stringify(unitUi.options) === JSON.stringify(unitChoicesFor('per_unit', 'm3').map((u) => u.id)), unitUi.options.join(', '));
    const help = await page.evaluate(() => {
      const vis = (el) => el.getClientRects().length > 0 && !el.closest('details:not([open]) > :not(summary)');
      const sel = '.field-hint, .qe-note, .qe-question-why, .choice-hint, .qe-keyline-hint, .qe-term';
      return [...(document.querySelector('main') || document.body).querySelectorAll(sel)].filter(vis).reduce((n, el) => n + (el.innerText.trim().match(/\S+/g) || []).length, 0);
    });
    check(P, 'texto de ayuda a la vista en "Cómo se cobra": al menos 30 % menos que K0 (218 palabras en este caso)', help <= 152, `${help} palabras`);

    // 2. La cadena con las cifras del motor: cantidad ÷ rendimiento = días; cantidad × tarifa = facturación.
    const r0 = computeQuote(structuredClone(m3));
    const rev0 = r0.estimate.revenue;
    let t = await mainText();
    check(P, 'a la vista: "200 m³ ÷ 20 m³ por día = 10 días de trabajo"', t.includes('200 m³ ÷ 20 m³ por día = 10 días de trabajo'), t.slice(t.indexOf('Con estos datos'), t.indexOf('Con estos datos') + 240));
    const revenueText = norm(`200 m³ × ${formatMoney(rev0.netRate)} por m³ = ${formatMoney(rev0.components.base)} por mes`);
    check(P, `a la vista: "${revenueText}" (motor)`, t.includes(revenueText), t.slice(t.indexOf('Con estos datos'), t.indexOf('Con estos datos') + 240));

    // 3. Ayuda (i): teclado (Enter abre y anuncia, Esc cierra y devuelve el foco), mouse o toque.
    const tipBtn = page.locator('.qe-unit-field .info-tip-btn').first();
    const tipState = () => page.evaluate(() => {
      const b = document.querySelector('.qe-unit-field .info-tip-btn');
      const bub = b && document.getElementById(b.getAttribute('aria-controls'));
      if (!bub) return null;
      const r = bub.getBoundingClientRect();
      return { expanded: b.getAttribute('aria-expanded'), hidden: bub.hidden, role: bub.parentElement && bub.parentElement.getAttribute('role'), text: bub.textContent, inside: bub.hidden || (r.left >= 0 && r.right <= document.documentElement.clientWidth), focus: document.activeElement === b };
    });
    await tipBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const opened = await tipState();
    check(P, '(i) con el teclado: Enter la abre, se anuncia (role="status") y la burbuja entra en la pantalla', Boolean(opened) && opened.expanded === 'true' && !opened.hidden && opened.role === 'status' && /moneda de tu empresa/.test(opened.text) && opened.inside, JSON.stringify(opened));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const closed = await tipState();
    check(P, '(i) Esc la cierra y el foco vuelve al botón', Boolean(closed) && closed.expanded === 'false' && closed.hidden && closed.focus, JSON.stringify(closed));
    if (mode === 'mobile') {
      await tipBtn.tap();
      await page.waitForTimeout(250);
      const tapped = await tipState();
      // Un toque en un texto de la página que quede fuera de la burbuja abierta (que tapa lo que tiene debajo)
      // y fuera de cualquier control.
      const away = await page.evaluate(() => {
        const b = document.querySelector('.qe-unit-field .info-tip-btn');
        const r = document.getElementById(b.getAttribute('aria-controls')).getBoundingClientRect();
        for (const y of [r.bottom + 16, r.bottom + 40, r.bottom + 72, r.top - 16, r.top - 40]) {
          for (const x of [16, 40, document.documentElement.clientWidth / 2]) {
            if (y <= 0 || y >= window.innerHeight) continue;
            const el = document.elementFromPoint(x, y);
            if (el && !el.closest('.info-tip, input, select, textarea, button, label, a, [role="radio"]')) return { x, y };
          }
        }
        return null;
      });
      if (away) await page.touchscreen.tap(away.x, away.y);
      await page.waitForTimeout(250);
      const outside = await tipState();
      check(P, '(i) con un toque se abre y al tocar afuera se cierra', tapped && tapped.expanded === 'true' && tapped.inside && outside && outside.expanded === 'false', JSON.stringify({ tapped, outside }));
      // H9: con el botón justo arriba de la barra del resumen, la burbuja se abre hacia arriba (no queda tapada).
      const lowBtn = page.locator('.qe-full-activations .info-tip-btn').first();
      const bar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--qe-sum-h')) || 0);
      await lowBtn.evaluate((el, barH) => { window.scrollBy(0, el.getBoundingClientRect().bottom - (window.innerHeight - barH - 20)); }, bar);
      await page.waitForTimeout(300);
      await lowBtn.tap();
      await page.waitForTimeout(300);
      const low = await page.evaluate((barH) => {
        const b = document.querySelector('.qe-full-activations .info-tip-btn');
        const bub = document.getElementById(b.getAttribute('aria-controls'));
        const r = bub.getBoundingClientRect();
        return { open: b.getAttribute('aria-expanded'), top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(window.innerHeight - barH), above: bub.classList.contains('is-above') };
      }, bar);
      check(P, 'H9: en el celular la ayuda (i) no queda debajo del resumen fijo (se abre hacia arriba)', low.open === 'true' && low.top >= 0 && low.bottom <= low.limit + 1, JSON.stringify(low));
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      await tipBtn.hover();
      await page.waitForTimeout(450);
      const hovered = await tipState();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(450);
      const left = await tipState();
      check(P, '(i) con el mouse se abre al pasar y se cierra al salir', hovered && hovered.expanded === 'true' && left && left.expanded === 'false', JSON.stringify({ hovered: hovered && hovered.expanded, left: left && left.expanded }));
    }
    const critical = await page.evaluate(() => [...document.querySelectorAll('.info-tip')].filter((x) => x.closest('.banner, .qr-draft, .qe-notices, .qe-illustrative')).length);
    check(P, 'ningún aviso crítico (borrador, NO CONFIABLE, ILUSTRATIVO) lleva su texto en una ayuda (i)', critical === 0, `${critical} ayudas dentro de avisos`);

    // 4. Rendimiento por hora: el número se pide de nuevo; 2 m³ por hora × 10 h = 20 m³ por día de trabajo.
    const denominator = page.locator('select[name="activity.rateInput.denominator"]').first();
    check(P, 'el rendimiento es "[número] [m³] / [día de trabajo ▾]"', (await denominator.count()) > 0 && await denominator.inputValue() === 'day', 'sin el selector del denominador');
    if (await denominator.count()) {
      await denominator.selectOption('hour');
      await page.waitForTimeout(900);
      const hourUi = await page.evaluate(() => ({ value: (document.querySelector('input[name="activity.unitsPerActiveDay"]') || {}).value, hours: (document.querySelector('input[name="activity.rateInput.hours"]') || {}).value }));
      check(P, 'por hora: 20 por día no se lee como 20 por hora y las horas no se suponen (las dos cosas se piden)', hourUi.value === '' && hourUi.hours === '', JSON.stringify(hourUi));
      await setNumber('activity.rateInput.hours', 10);
      await setNumber('activity.unitsPerActiveDay', 2);
      const savedHour = await waitStored(m3.id, (q) => q.activity && q.activity.unitsPerActiveDay === 20);
      const a = savedHour && savedHour.activity;
      check(P, '2 m³ por hora × 10 h = 20 m³ por día de trabajo: se guardan la forma y el dato del motor', Boolean(a) && a.unitsPerActiveDay === 20 && a.rateInput && a.rateInput.value === 2 && a.rateInput.denominator === 'hour' && a.rateInput.hours === 10, JSON.stringify(a));
      await page.waitForTimeout(500);
      const equiv = norm(await page.locator('.qe-rate-equiv').first().textContent().catch(() => ''));
      check(P, 'a la vista: "= 20 m³ por día de trabajo"', equiv === '= 20 m³ por día de trabajo', equiv);
    }

    // 5. Cantidad en días de trabajo: 200 m³ ÷ 20 = 10 días; 12 días × 20 m³ por día = 240 m³ por mes.
    const basis = page.locator('select[name="activity.quantityInput.basis"]').first();
    if (await basis.count()) {
      await basis.selectOption('workdays');
      await page.waitForTimeout(900);
      const days = await page.locator('input[name="activity.billableQuantityPerMonth"]').first().inputValue();
      check(P, 'cantidad en días de trabajo: pasa con el rendimiento cargado (200 m³ ÷ 20 m³ por día = 10 días)', days === '10', days);
      await setNumber('activity.billableQuantityPerMonth', 12);
      const savedDays = await waitStored(m3.id, (q) => q.activity.billableQuantityPerMonth === 240);
      check(P, '12 días × 20 m³ por día = 240 m³ por mes: se guarda la cantidad del motor', Boolean(savedDays) && savedDays.activity.billableQuantityPerMonth === 240 && savedDays.activity.quantityInput && savedDays.activity.quantityInput.value === 12, JSON.stringify(savedDays && savedDays.activity));
      await page.waitForTimeout(600);
      t = await mainText();
      check(P, 'a la vista: "20 m³ por día × 12 días de trabajo = 240 m³ por mes"', t.includes('20 m³ por día × 12 días de trabajo = 240 m³ por mes'), t.slice(t.indexOf('Con estos datos'), t.indexOf('Con estos datos') + 200));
    } else {
      check(P, 'la cantidad del mes se puede cargar en días de trabajo', false, 'sin el selector');
    }

    // 6. F4: m³ → t sin un factor (densidad): pide qué hacer y nunca convierte; Cancelar no cambia nada.
    await page.locator('select[name="unit"]').first().selectOption('ton');
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    let dlg = await dialog();
    check(P, 'F4: m³ → t con cantidad y rendimiento cargados pregunta y no ofrece convertir (no hay factor)', Boolean(dlg) && /Cantidad del mes: 240 m³ por mes/.test(norm(dlg.text)) && /Rendimiento:/.test(dlg.text) && !dlg.buttons.some((b) => /^Convertir/.test(b)), JSON.stringify(dlg));
    await press('Cancelar');
    const kept = stored(m3.id);
    check(P, 'Cancelar deja la unidad y los datos como estaban', await page.locator('select[name="unit"]').first().inputValue() === 'm3' && kept.unit === 'm3' && kept.activity.billableQuantityPerMonth === 240, JSON.stringify({ unit: kept.unit, q: kept.activity.billableQuantityPerMonth }));
    await page.locator('select[name="unit"]').first().selectOption('ton');
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    await press('Borrar y cargar de nuevo');
    const cleared = await waitStored(m3.id, (q) => q.unit === 'ton');
    const ca = cleared && cleared.activity;
    check(P, 'F4: "Borrar y cargar de nuevo": la cantidad, el rendimiento y su forma quedan vacíos (240 m³ nunca pasan a ser 240 t)', Boolean(ca) && cleared.unit === 'ton' && ca.billableQuantityPerMonth === null && ca.unitsPerActiveDay === null && !ca.rateInput && !ca.quantityInput, JSON.stringify(ca));

    // 7. kg → t con el factor exacto: 5.000 kg = 5 t; 500 kg por día = 0,5 t; $ 50 por kg = $ 50.000 por t.
    await go(`#/cotizaciones/${encodeURIComponent(kg.id)}/modality`, 1200);
    await page.locator('select[name="unit"]').first().selectOption('ton');
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    dlg = await dialog();
    check(P, 'kg → t ofrece convertir con el factor exacto (1 t = 1.000 kg) y muestra antes y después', Boolean(dlg) && dlg.buttons.some((b) => /^Convertir a/.test(b)) && /1 t = 1\.000 kg/.test(dlg.text) && /5\.000 kg por mes → 5 t por mes/.test(norm(dlg.text)), JSON.stringify(dlg));
    await press('Convertir a');
    const conv = await waitStored(kg.id, (q) => q.unit === 'ton');
    check(P, 'convertido: 5 t por mes, 0,5 t por día de trabajo y $ 50.000 por t (mismos números del motor)', Boolean(conv) && conv.activity.billableQuantityPerMonth === 5 && conv.activity.unitsPerActiveDay === 0.5 && conv.pricing.knownRate === 50000, JSON.stringify(conv && { a: conv.activity, rate: conv.pricing.knownRate }));
    if (conv) {
      const before = computeQuote(structuredClone(kg));
      const after = computeQuote(structuredClone(conv));
      check(P, 'con kg → t el costo y la facturación del mes no cambian', Math.abs(before.kpis.totalCost - after.kpis.totalCost) < 0.01 && Math.abs(before.kpis.revenue - after.kpis.revenue) < 0.01, `${before.kpis.revenue} → ${after.kpis.revenue}`);
    }

    // 8. Llamado → día: 6 llamados por mes no pasan a ser 6 días; una cantidad vieja tampoco se reusa.
    await go(`#/cotizaciones/${encodeURIComponent(call.id)}/modality`, 1200);
    const chips = await page.evaluate(() => ({ radios: [...document.querySelectorAll('input[type="radio"][name="unit"]')].map((r) => r.value), select: Boolean(document.querySelector('select[name="unit"]')), prefix: (document.querySelector('.qe-unit-chips .qe-compound-fixed') || {}).textContent }));
    check(P, 'con pocas unidades (on-call: 5) van a la vista como botones de opción, con "ARS /"', !chips.select && JSON.stringify(chips.radios) === JSON.stringify(unitChoicesFor('on_call', 'call').map((u) => u.id)) && norm(chips.prefix) === 'ARS /', JSON.stringify(chips));
    await chooseUnit('day');
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    dlg = await dialog();
    check(P, 'llamado → día: la cantidad de llamados se borra, no se convierte', Boolean(dlg) && /Cantidad del mes: 6 llamados por mes/.test(norm(dlg.text)) && !dlg.buttons.some((b) => /^Convertir/.test(b)), JSON.stringify(dlg));
    await press('Borrar y cargar de nuevo');
    const callSaved = await waitStored(call.id, (q) => q.unit === 'day');
    check(P, 'llamado → día guardado sin la cantidad de llamados', Boolean(callSaved) && callSaved.activity.billableQuantityPerMonth === null, JSON.stringify(callSaved && callSaved.activity));
    await go(`#/cotizaciones/${encodeURIComponent(stale.id)}/modality`, 1200);
    await page.locator('select[name="unit"]').first().selectOption('m3');
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    dlg = await dialog();
    check(P, 'día → m³ con una cantidad guardada de una unidad anterior: lo dice y no la reusa', Boolean(dlg) && /de una unidad anterior/.test(dlg.text) && !dlg.buttons.some((b) => /^Convertir/.test(b)), JSON.stringify(dlg));
    await press('Borrar y cargar de nuevo');
    const staleSaved = await waitStored(stale.id, (q) => q.unit === 'm3');
    check(P, 'día → m³: la cantidad vieja (300) no aparece como 300 m³', Boolean(staleSaved) && staleSaved.activity.billableQuantityPerMonth === null && staleSaved.activity.unitsPerActiveDay === null, JSON.stringify(staleSaved && staleSaved.activity));

    // 8 bis. km por hora (revisión UX-UNITS, H2): la velocidad no se factura; las horas de marcha se piden y,
    // si son todas las horas del día de trabajo, se avisa. El aviso del motor habla en la forma elegida.
    await go(`#/cotizaciones/${encodeURIComponent(kmq.id)}/modality`, 1200);
    await page.locator('select[name="activity.rateInput.denominator"]').first().selectOption('hour');
    await page.waitForTimeout(1200);
    const kmUi = await page.evaluate(() => {
      const field = (document.querySelector('input[name="activity.unitsPerActiveDay"]') || document.body).closest('.field');
      return {
        hours: (document.querySelector('input[name="activity.rateInput.hours"]') || {}).value,
        hint: field ? (field.querySelector('.field-hint') || {}).textContent : '',
        issue: field ? [...field.querySelectorAll('.qe-issue-note')].map((n) => n.textContent).join(' | ') : '',
      };
    });
    check(P, 'km por hora: dice "velocidad promedio con paradas", no supone las horas de marcha', /Velocidad promedio con paradas/.test(kmUi.hint) && kmUi.hours === '', JSON.stringify(kmUi));
    check(P, 'km por hora sin número: el aviso pide el rendimiento "en km por hora" (no "por día de trabajo")', /Cargá el rendimiento en km por hora/.test(kmUi.issue), kmUi.issue || 'sin aviso');
    await setNumber('activity.rateInput.hours', 8);
    await setNumber('activity.unitsPerActiveDay', 50);
    const kmSaved = await waitStored(kmq.id, (q) => q.activity.unitsPerActiveDay === 400);
    await page.waitForTimeout(500);
    const kmEquiv = norm(await page.locator('.qe-rate-equiv').first().textContent().catch(() => ''));
    check(P, '50 km/h × 8 h de marcha = 400 km por día; con todas las horas del día de trabajo, avisa', Boolean(kmSaved) && /^= 400 km por día de trabajo\. Ojo: son todas las horas del día de trabajo/.test(kmEquiv), `${kmEquiv} · ${JSON.stringify(kmSaved && kmSaved.activity.rateInput)}`);

    // 9. Una cotización de K0 (sin la forma nueva) abre en su forma nativa y, sin editarla, no se le agrega nada.
    await go(`#/cotizaciones/${encodeURIComponent(res.id)}/modality`, 1200);
    const native = await page.evaluate(() => ({
      value: (document.querySelector('input[name="activity.unitsPerActiveDay"]') || {}).value,
      numerator: (document.querySelector('select[name="activity.rateInput.numerator"]') || { value: null }).value,
      fixed: (document.querySelector('.qe-compound-unit .qe-compound-fixed') || { textContent: null }).textContent,
      denominator: (document.querySelector('select[name="activity.rateInput.denominator"]') || {}).value,
      quantity: (document.querySelector('input[name="activity.billableQuantityPerMonth"]') || {}).value,
    }));
    check(P, 'compatibilidad K0: abre como "200 m³ por mes" y "20 m³ / día de trabajo"', native.value === '20' && native.quantity === '200' && native.denominator === 'day' && (native.numerator === 'm3' || norm(native.fixed) === 'm³'), JSON.stringify(native));
    await scan(P, 'Cómo se cobra (UX-UNITS)');

    // 10. Resultado: la tarifa es la cifra principal y "La cuenta del mes" cierra con el motor.
    await go(`#/cotizaciones/${encodeURIComponent(res.id)}/result`, 1500);
    await page.waitForSelector('.qr-account', { timeout: 8000 }).catch(() => {});
    const rr = computeQuote(structuredClone(res));
    const acc = await page.evaluate(() => {
      const s = document.querySelector('.qr-account');
      return s ? [...s.querySelectorAll('.qr-account-row')].map((row) => [row.querySelector('dt').firstChild.textContent, row.querySelector('dd').textContent]) : null;
    });
    const want = [
      ['Cantidad facturable', '200 m³'],
      ['× Tarifa sugerida', `${formatMoney(rr.estimate.revenue.netRate)} / m³`],
      ['= Facturación del mes', formatMoney(rr.kpis.revenue)],
      [`− Impuestos sobre lo que facturás (${formatPercent(rr.kpis.billingTaxPct)})`, `− ${formatMoney(rr.estimate.billingTaxes)}`],
      ['− Costo del mes', `− ${formatMoney(rr.kpis.totalCost)}`],
      ['= Ganancia del mes', formatMoney(rr.estimate.profit)],
    ].map(([a, b]) => [norm(a), norm(b)]);
    const got = (acc || []).map(([a, b]) => [norm(a), norm(b)]);
    check(P, '"La cuenta del mes": cantidad × tarifa = facturación − impuestos − costo = ganancia, con las cifras del motor', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
    check(P, 'y cierra: facturación − impuestos − costo = ganancia (motor, al centavo)', Math.abs(rr.kpis.revenue - rr.estimate.billingTaxes - rr.kpis.totalCost - rr.estimate.profit) < 0.005 && rr.estimate.revenue.billableUnits * rr.estimate.revenue.netRate === rr.estimate.revenue.components.base, `${rr.kpis.revenue} − ${rr.estimate.billingTaxes} − ${rr.kpis.totalCost} vs ${rr.estimate.profit}`);
    const prim = await page.evaluate(() => Boolean(document.querySelector('.qr-stat-price.qr-stat-primary')) && document.querySelectorAll('.qr-summary .info-tip').length === 0);
    check(P, 'la tarifa es la cifra destacada y el resumen no esconde nada en ayudas (i)', prim, 'sin la tarifa destacada o con ayudas en el resumen');
    await scan(P, 'Resultado (UX-UNITS)');
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => ({ account: Boolean(document.querySelector('.qr-account')) && document.querySelector('.qr-account').getClientRects().length > 0, tips: [...document.querySelectorAll('.info-tip')].filter((x) => x.getClientRects().length > 0).length }));
    await page.emulateMedia({ media: 'screen' });
    check(P, 'PDF: imprime "La cuenta del mes" y ninguna ayuda (i)', printed.account && printed.tips === 0, JSON.stringify(printed));
    const stillK0 = stored(res.id);
    check(P, 'compatibilidad K0: abrirla sin editar no le agrega campos nuevos', Boolean(stillK0) && !('rateInput' in stillK0.activity) && !('quantityInput' in stillK0.activity), JSON.stringify(stillK0 && Object.keys(stillK0.activity)));

    // 11. NO CONFIABLE (ECO-01): "La cuenta del mes" lo dice en su título; no se lee como una cifra para usar.
    const unreliable = seeded.find((x) => (x.r.completeness.pending || []).some((p) => p.unreliable === true) && x.r.kpis.commercialListRate > 0 && x.r.estimate.revenue.total > 0);
    check(P, 'hay un escenario NO CONFIABLE con tarifa para probarlo', Boolean(unreliable), 'ninguno');
    if (unreliable) {
      await go(`#/cotizaciones/${encodeURIComponent(unreliable.q.id)}/result`, 1500);
      await page.waitForSelector('.qr-account', { timeout: 8000 }).catch(() => {});
      const tag = await page.evaluate(() => {
        const s = document.querySelector('.qr-account');
        const t = s && s.querySelector('.qr-account-title .tag-unreliable');
        return { block: Boolean(s), tag: t ? t.textContent.trim() : null, visible: Boolean(t && t.getClientRects().length) };
      });
      check(P, `${unreliable.s.id}: "La cuenta del mes" dice "No confiable" a la vista`, tag.block && tag.tag === 'No confiable' && tag.visible, JSON.stringify(tag));
    }
  }

  // Sesión (PLAN-2026-015): al cerrar sesión no queda nada de la empresa A en
  // pantalla ni en el menú oculto, y otra cuenta que ingresa en la MISMA
  // pestaña (sin recargar) no ve nada de A, ni con los ids de sus cotizaciones.
  {
    const ofA = ['Empresa sintética', email, seeded[0].q.name, seeded[seeded.length - 1].q.name, 'E2E producto financiado', 'DESIGN-02 cotización ilustrativa', 'DESIGN-02B estructura y tramos'];
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
