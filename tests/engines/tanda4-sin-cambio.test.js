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
  readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json') && f !== 'baseline-v1.json' && f !== 'tanda4-sin-cambio.json').sort().forEach((f) => {
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
