/**
 * 0.24.0 (PLAN-2026-028, "menos preguntas"): la tanda 4 no cambia ningún número.
 *
 * La foto (tests/fixtures/tanda4-sin-cambio.json) se sacó UNA vez con el motor de la
 * 0.23.0, antes de tocar el código: KPIs, estructura de costos y completitud (id, estado,
 * peso) de la demo, los casos del baseline, COT-0009/0010/0011, los JSON de fixtures y los
 * escenarios y sondas del Test Lab. De la completitud sólo puede cambiar `step` (el paso
 * "Cómo se cobra" se disolvió) y los textos.
 *
 * Regenerar la foto (sólo si un cambio de fórmula está aprobado y documentado):
 *   TANDA4_WRITE=1 node --test tests/engines/tanda4-sin-cambio.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { baselineCases } from '../fixtures/baseline-cases.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';
import { cot0010Quote, cot0011Quote, transportQuote } from '../fixtures/cot-0010.js';
import { SERVICE_SCENARIOS } from '../lab/scenarios/services.js';
import { PROBES } from '../lab/scenarios/probes.js';
import { resetIds } from '../lab/lib/build.js';
import { PRODUCT_SCENARIOS } from '../lab/scenarios/products.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { computeEquipmentUnit } from '../../js/engines/equipment-engine.js';
import { exampleProduct } from '../../js/domain/product-factory.js';
import { equipmentLineFromLibrary } from '../../js/domain/quote-factory.js';

const PHOTO_URL = new URL('../fixtures/tanda4-sin-cambio.json', import.meta.url);
const FIXTURES_DIR = new URL('../fixtures/', import.meta.url);

function cases() {
  const out = [];
  const demo = createDemoState(1);
  demo.quotes.forEach((q) => out.push({ id: `demo:${q.id}`, run: () => computeQuote(structuredClone(q), { settings: demo.settings }) }));
  baselineCases().forEach((c) => out.push({ id: `baseline:${c.id}`, run: () => computeQuote(structuredClone(c.quote), { settings: c.settings }) }));
  out.push({ id: 'cot-0009', run: () => computeQuote(cot0009Quote()) });
  out.push({ id: 'cot-0010', run: () => computeQuote(cot0010Quote()) });
  out.push({ id: 'cot-0011', run: () => computeQuote(cot0011Quote()) });
  [1, 2, 3].forEach((n) => out.push({ id: `transporte-${n}-por-dia`, run: () => computeQuote(transportQuote({ tripsPerDay: n, tripsPerActivation: 1 })) }));
  readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && f !== 'baseline-v1.json' && !f.startsWith('tanda4-sin-cambio')).sort().forEach((f) => {
    const data = JSON.parse(readFileSync(new URL(f, FIXTURES_DIR), 'utf8'));
    const quote = data.quote || data;
    const settings = data.settings || undefined;
    out.push({ id: `fixture:${f}`, run: () => computeQuote(structuredClone(quote), settings ? { settings } : undefined) });
  });
  // Revisión de la 0.24.0 (P-5 de costos): el caso de B-2, con el aviso guarantee_above_estimate.
  // Agregado a la foto después, con el motor de la 0.23.0 (origin/main); los demás no cambiaron.
  {
    const data = JSON.parse(readFileSync(new URL('especialista-24h-c2.json', FIXTURES_DIR), 'utf8'));
    out.push({ id: 'fixture:especialista-24h-c2+minimo-20-unidades', run: () => {
      const q = structuredClone(data.quote);
      q.activity.activeDaysPerMonth = 10;
      Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 });
      return computeQuote(q, { settings: data.settings });
    } });
  }
  SERVICE_SCENARIOS.forEach((s) => out.push({ id: `lab:${s.id}`, run: () => { resetIds(); return computeQuote(structuredClone(s.build())); } }));
  PROBES.forEach((p) => out.push({ id: `probe:${p.id}`, run: () => { resetIds(); return computeQuote(structuredClone(p.build())); } }));
  return out;
}

/** Lo que no puede cambiar: KPIs, EECC y completitud sin `step` ni textos. */
function photo(r) {
  return {
    kpis: r.kpis,
    eecc: r.eecc,
    completeness: {
      scorePct: r.completeness.scorePct,
      counts: r.completeness.counts,
      items: r.completeness.items.map((i) => ({ id: i.id, status: i.status, weight: i.weight, severity: i.severity ?? null })),
      notices: (r.completeness.notices || []).map((n) => n.id),
    },
  };
}

const clean = (x) => JSON.parse(JSON.stringify(x));

function close(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = Math.max(1e-6, Math.abs(b) * 1e-9);
    assert.ok(Math.abs(a - b) <= tol, `${path}: ${a} ≠ ${b}`);
    return;
  }
  if (Array.isArray(b)) {
    assert.ok(Array.isArray(a) && a.length === b.length, `${path}: largo distinto (${a && a.length} ≠ ${b.length})`);
    b.forEach((v, i) => close(a[i], v, `${path}[${i}]`));
    return;
  }
  if (b && typeof b === 'object') {
    assert.ok(a && typeof a === 'object', `${path}: falta`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: claves distintas`);
    Object.keys(b).forEach((k) => close(a[k], b[k], `${path}.${k}`));
    return;
  }
  assert.equal(a, b, path);
}

const all = cases();

if (process.env.TANDA4_WRITE === '1') {
  const out = Object.fromEntries(all.map((c) => [c.id, clean(photo(c.run()))]));
  writeFileSync(PHOTO_URL, `${JSON.stringify({ note: 'Foto de computeQuote con la 0.23.0, antes de la tanda 4 (PLAN-2026-028). No editar a mano.', cases: out })}\n`);
}

const expected = JSON.parse(readFileSync(PHOTO_URL, 'utf8')).cases;

describe('0.24.0: la tanda 4 no cambia ningún número', () => {
  // Los casos que la tanda agrega después de la foto (p. ej. PRB-24) no tienen un "antes": se
  // controlan en sus propios tests. Todos los de la foto tienen que seguir existiendo.
  const NEW_IN_TANDA4 = new Set(['probe:PRB-24']);
  test('el caso del mínimo por encima de la estimación tiene su aviso (P-5 de la revisión)', () => {
    assert.ok(expected['fixture:especialista-24h-c2+minimo-20-unidades'].completeness.notices.includes('guarantee_above_estimate'));
  });
  test('la foto cubre todos los casos', () => {
    assert.deepEqual(Object.keys(expected).sort(), all.map((c) => c.id).filter((id) => !NEW_IN_TANDA4.has(id)).sort());
    assert.ok(all.length > 150, `sólo ${all.length} casos`);
  });
  for (const c of all.filter((x) => !NEW_IN_TANDA4.has(x.id))) {
    test(c.id, () => close(clean(photo(c.run())), expected[c.id], c.id));
  }
});

/* ------------------------------------------------------------------------------------------
 * 0.25.0 (PLAN-2026-029, tanda 4, segunda parte): foto NUEVA sacada con el motor de la 0.24.0
 * (origin/main 2d5d483), antes de tocar el código. La foto de arriba (0.23.0) no se regenera.
 * Suma a las cotizaciones (ahora con `issues`, estimación, matriz y descuentos) los productos
 * (computeProduct sin las trazas) y la ficha de equipos (computeEquipmentUnit) con la línea
 * que nace de Recursos (equipmentLineFromLibrary). Los avisos informativos nuevos de la
 * 0.25.0 (PR 8) no entran en el puntaje: se descuentan de `notices` antes de comparar.
 *
 * Regenerar (sólo con un cambio de fórmula aprobado y documentado):
 *   TANDA4B_WRITE=1 node --test tests/engines/tanda4-sin-cambio.test.js
 * ------------------------------------------------------------------------------------------ */

const PHOTO_B_URL = new URL('../fixtures/tanda4-sin-cambio-0-25.json', import.meta.url);
/** Avisos informativos que agrega la 0.25.0 (fuera del puntaje). */
export const NEW_NOTICES_0_25 = new Set(['client_fuel_external_not_summed', 'overtime_hours_over_month']);

function photoB(r) {
  const base = photo(r);
  base.completeness.notices = base.completeness.notices.filter((id) => !NEW_NOTICES_0_25.has(id));
  return {
    ...base,
    issues: (r.issues || []).map((i) => ({ path: i.path ?? null, severity: i.severity ?? null })),
    estimate: r.estimate,
    matrix: r.matrix,
    discounts: r.discounts,
  };
}

function productCases() {
  const out = [];
  PRODUCT_SCENARIOS.forEach((s) => out.push({ id: `product:${s.id}`, run: () => { resetIds(); return s.build(); } }));
  out.push({ id: 'product:ejemplo-chipa', run: () => exampleProduct({ organizationId: 'org', now: '2026-11-01T00:00:00.000Z', id: 'p1', idFactory: (() => { let i = 0; return () => `x-${(i += 1)}`; })() }) });
  const eco = JSON.parse(readFileSync(new URL('eco-01/e4-producto.json', FIXTURES_DIR), 'utf8'));
  out.push({ id: 'product:eco-01-e4', run: () => structuredClone(eco) });
  return out;
}

function photoProduct(r) {
  const { traces, issues, ...rest } = r;
  return { ...rest, issues: (issues || []).map((i) => ({ path: i.path ?? null, severity: i.severity ?? null })) };
}

function equipmentCases() {
  const out = [];
  const demo = createDemoState(1);
  const fuel = demo.settings.fuelPricePerLiter;
  const variants = [
    ['', (e) => e],
    ['+uso-0', (e) => ({ ...e, utilizationPct: 0 })],
    ['+uso-150', (e) => ({ ...e, utilizationPct: 150 })],
    ['+sin-combustible', (e) => ({ ...e, fuelNotApplicable: true })],
  ];
  demo.resources.equipment.forEach((eq) => {
    variants.forEach(([suffix, mod]) => {
      out.push({ id: `equipo:${eq.name}${suffix}:combustible-nuestro`, run: () => computeEquipmentUnit(mod(structuredClone(eq)), { fuelPricePerLiter: fuel, fuelPaidByUs: true }) });
    });
    out.push({ id: `equipo:${eq.name}:combustible-del-cliente`, run: () => computeEquipmentUnit(structuredClone(eq), { fuelPricePerLiter: fuel, fuelPaidByUs: false }) });
    out.push({ id: `linea:${eq.name}`, run: () => equipmentLineFromLibrary(structuredClone(eq), { id: 'l1', now: '2026-11-01T00:00:00.000Z' }) });
  });
  return out;
}

const allB = [
  ...all.map((c) => ({ id: `quote:${c.id}`, run: () => photoB(c.run()) })),
  ...productCases().map((c) => ({ id: c.id, run: () => photoProduct(computeProduct(c.run())) })),
  ...equipmentCases(),
];

if (process.env.TANDA4B_WRITE === '1') {
  const out = Object.fromEntries(allB.map((c) => [c.id, clean(c.run())]));
  writeFileSync(PHOTO_B_URL, `${JSON.stringify({ note: 'Foto con la 0.24.0 (2d5d483), antes de la 0.25.0 (PLAN-2026-029). No editar a mano.', cases: out })}\n`);
}

const expectedB = JSON.parse(readFileSync(PHOTO_B_URL, 'utf8')).cases;

describe('0.25.0: la segunda parte de la tanda 4 no cambia ningún número', () => {
  test('la foto cubre todos los casos (cotizaciones, productos y equipos)', () => {
    assert.deepEqual(Object.keys(expectedB).sort(), allB.map((c) => c.id).sort());
    assert.ok(allB.filter((c) => c.id.startsWith('product:')).length >= 10);
    assert.ok(allB.filter((c) => c.id.startsWith('equipo:')).length >= 40);
  });
  for (const c of allB) {
    test(c.id, () => close(clean(c.run()), expectedB[c.id], c.id));
  }
});
