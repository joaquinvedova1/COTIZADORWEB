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
import { defaultVolumeTiers } from '../../../js/domain/quote-factory.js';
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
    await scan(D, 'Recursos');
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
