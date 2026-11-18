/**
 * 0.11 · Actualización de tarifas por estructura de costos (EECC).
 * tarifa nueva = tarifa × (1 + Σ incidencia × %), con índices encadenados por categoría.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rateUpdateWeights, rateUpdateState, previewRateUpdate, proposeLaborRaisePct } from '../../js/engines/rate-update-engine.js';
import { normalizeRateUpdate, normalizeUpdatePcts } from '../../js/domain/rate-update.js';
import { computeQuote, summarizeQuote } from '../../js/engines/quote-engine.js';
import { createQuoteService } from '../../js/services/quote-service.js';
import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';
import { validateNumber } from '../../js/core/validation.js';
import { configureLogger } from '../../js/core/logger.js';

configureLogger({ consoleImpl: null });

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a}`);

/** EECC mínima: mano de obra 60, materiales 40 (abiertos en categorías de gasto), financiero e imprevistos. */
const eecc = (labor = 60, mats = 40, extra = {}) => ({
  rows: [
    { category: 'labor', amount: labor },
    { category: 'materials', amount: mats, children: mats ? [{ component: 'materials', amount: mats }] : [] },
    { category: 'financial', amount: 5 },
    { category: 'contingency', amount: 3 },
    ...Object.entries(extra).map(([category, amount]) => ({ category, amount })),
  ],
});

describe('rate-update: incidencias', () => {
  test('financiero e imprevistos no pesan; los pesos suman 1', () => {
    const w = rateUpdateWeights(eecc());
    assert.deepEqual(w.map((x) => x.id), ['labor', 'materials']);
    close(w[0].weight, 0.6);
    close(w[1].weight, 0.4);
  });
  test('Materiales se abre en sus categorías de gasto', () => {
    const w = rateUpdateWeights({ rows: [{ category: 'materials', amount: 100, children: [{ component: 'ppe', amount: 30 }, { component: 'supplies', amount: 70 }] }] });
    assert.deepEqual(w.map((x) => [x.id, x.weight]), [['supplies', 0.7], ['ppe', 0.3]]);
  });
  test('sin costos no hay pesos', () => {
    assert.deepEqual(rateUpdateWeights({ rows: [] }), []);
    assert.deepEqual(rateUpdateWeights(null), []);
  });
});

describe('rate-update: fórmula', () => {
  test('ejemplo de Joaco: 60 % × 2 % + 40 % × 5 % = 3,2 %', () => {
    const state = rateUpdateState({ baseRate: 1000, eecc: eecc(), fallbackBasePeriod: '2026-10' });
    const p = previewRateUpdate(state, { labor: 2, materials: 5 }, '2026-11');
    close(p.stepPct, 3.2);
    close(p.rateAfter, 1032);
    assert.equal(p.canApply, true);
  });
  test('encadenado: la incidencia vigente se corre con los índices', () => {
    const ru = { basePeriod: '2026-10', steps: [{ toPeriod: '2026-11', pcts: { labor: 10 } }, { toPeriod: '2026-12', pcts: { materials: 10 } }] };
    const s = rateUpdateState({ baseRate: 1000, eecc: eecc(), rateUpdate: ru });
    // Paso 1: 0,6 × 10 % = 6 %. Paso 2: materiales pesa 0,4 / 1,06 → 3,7736 %.
    close(s.steps[0].stepPct, 6);
    close(s.steps[1].stepPct, (0.04 / 1.06) * 100);
    // Total = Σ w × I = 0,6 × 1,1 + 0,4 × 1,1 = 1,1.
    close(s.factor, 1.1);
    close(s.rate, 1100);
    assert.equal(s.period, '2026-12');
    assert.equal(s.basePeriod, '2026-10');
  });
  test('mismo % en todas las categorías = ese %', () => {
    const s = rateUpdateState({ baseRate: 500, eecc: eecc(30, 70, { fuel: 20 }), fallbackBasePeriod: '2026-01' });
    const p = previewRateUpdate(s, { labor: 4, materials: 4, fuel: 4 }, '2026-02');
    close(p.stepPct, 4);
  });
  test('el destino debe ser posterior al período vigente', () => {
    const s = rateUpdateState({ baseRate: 1, eecc: eecc(), fallbackBasePeriod: '2026-10' });
    assert.equal(previewRateUpdate(s, { labor: 1 }, '2026-10').periodError, 'not_after');
    assert.equal(previewRateUpdate(s, { labor: 1 }, '2026-09').canApply, false);
    assert.equal(previewRateUpdate(s, { labor: 1 }, null).periodError, 'missing');
  });
  test('una categoría sin costo en el ítem no mueve la tarifa', () => {
    const s = rateUpdateState({ baseRate: 1000, eecc: eecc(), fallbackBasePeriod: '2026-10' });
    close(previewRateUpdate(s, { fuel: 50 }, '2026-11').stepPct, 0);
  });
});

describe('rate-update: datos guardados', () => {
  test('pasos que no avanzan en el tiempo o inválidos se descartan', () => {
    const ru = normalizeRateUpdate({ basePeriod: '2026-10', steps: [{ toPeriod: '2026-09', pcts: {} }, { toPeriod: 'x' }, { toPeriod: '2026-11', pcts: { labor: '3', fuel: 2, nada: 4 } }] });
    assert.equal(ru.steps.length, 1);
    assert.deepEqual(ru.steps[0].pcts, { fuel: 2 });
  });
  test('% fuera de rango se ignora; negativos valen', () => {
    assert.deepEqual(normalizeUpdatePcts({ labor: -5, fuel: 900, materials: 0 }), { labor: -5 });
    assert.equal(validateNumber('-5', 'updatePct').ok, true);
    assert.equal(validateNumber('600', 'updatePct').ok, false);
  });
});

describe('rate-update: cotización real', () => {
  test('summarizeQuote trae la tarifa vigente y el margen % no cambia', () => {
    const q = cot0009Quote();
    const base = summarizeQuote(q);
    assert.equal(base.rateUpdate.updated, false);
    close(base.rateUpdate.rate, base.commercialListRate, 1e-6);
    const weights = base.rateUpdate.weights;
    assert.ok(weights.length > 1);
    close(weights.reduce((s, w) => s + w.weight, 0), 1, 1e-9);
    const all = Object.fromEntries(weights.map((w) => [w.id, 7]));
    const after = summarizeQuote({ ...q, rateUpdate: { basePeriod: '2026-01', steps: [{ toPeriod: '2026-03', pcts: all }] } });
    close(after.rateUpdate.rate, base.commercialListRate * 1.07, 1e-6);
    // La cotización en sí no cambia.
    assert.equal(after.commercialListRate, base.commercialListRate);
    assert.equal(computeQuote(q).kpis.totalCost, after.totalCost);
  });

  test('servicio: aplicar, deshacer y período base', async () => {
    const t = Date.UTC(2026, 9, 3, 10, 0, 0);
    const repository = new LocalStorageRepository(new MemoryStorage(), { now: () => new Date(t).toISOString() });
    await repository.init();
    const service = createQuoteService({ repository, clock: () => new Date(t).toISOString() });
    const saved = await repository.saveQuote({ ...cot0009Quote(), id: 'q-act', offerDate: '2026-10-01' });
    const before = summarizeQuote(saved, { settings: await repository.getSettings() });
    assert.equal(before.rateUpdate.basePeriod, '2026-10');
    await service.setRateBasePeriod('q-act', '2026-09');
    await service.applyRateUpdate('q-act', { toPeriod: '2026-11', pcts: { labor: 10 } });
    const q1 = await repository.getQuote('q-act');
    assert.equal(q1.rateUpdate.basePeriod, '2026-09');
    assert.equal(q1.rateUpdate.steps.length, 1);
    await assert.rejects(() => service.setRateBasePeriod('q-act', '2026-08'), /rate_update_locked/);
    await assert.rejects(() => service.applyRateUpdate('q-act', { toPeriod: '2026-11', pcts: { labor: 1 } }), /rate_update_period/);
    await service.undoRateUpdate('q-act');
    assert.equal((await repository.getQuote('q-act')).rateUpdate.steps.length, 0);
  });

  test('la foto de la primera actualización no cambia si después se edita la cotización', () => {
    const ru = { basePeriod: '2026-10', base: { rate: 1000, amounts: { labor: 100 } }, steps: [{ toPeriod: '2026-11', pcts: { labor: 10, external: 50 } }] };
    // Hoy la cotización tiene terceros y otra tarifa: la vigente sigue saliendo de la foto.
    const s = rateUpdateState({ baseRate: 1200, eecc: { rows: [{ category: 'labor', amount: 100 }, { category: 'external', amount: 20 }] }, rateUpdate: ru });
    close(s.rate, 1100);
    assert.equal(s.stale, true);
    const same = rateUpdateState({ baseRate: 1000, eecc: { rows: [{ category: 'labor', amount: 50 }] }, rateUpdate: ru });
    assert.equal(same.stale, false);
  });

  test('estructura como % del directo no lleva % propio', () => {
    const rows = { rows: [{ category: 'labor', amount: 80 }, { category: 'structure', amount: 20 }] };
    assert.deepEqual(rateUpdateWeights(rows, { structureFollows: true }).map((w) => w.id), ['labor']);
    assert.deepEqual(rateUpdateWeights(rows).map((w) => w.id), ['labor', 'structure']);
  });

  test('servicio: guarda la foto, rechaza % inválidos y toma una base nueva', async () => {
    const t = Date.UTC(2026, 9, 3, 10, 0, 0);
    const repository = new LocalStorageRepository(new MemoryStorage(), { now: () => new Date(t).toISOString() });
    await repository.init();
    const service = createQuoteService({ repository, clock: () => new Date(t).toISOString() });
    await repository.saveQuote({ ...cot0009Quote(), id: 'q-foto', offerDate: '2026-10-01' });
    await assert.rejects(() => service.applyRateUpdate('q-foto', { toPeriod: '2026-11', pcts: { labor: 600 } }), /rate_update_pct/);
    await service.applyRateUpdate('q-foto', { toPeriod: '2026-11', pcts: { labor: 10 } });
    const q = await repository.getQuote('q-foto');
    assert.ok(q.rateUpdate.base && q.rateUpdate.base.rate > 0);
    await service.rebaseRateUpdate('q-foto');
    const r = await repository.getQuote('q-foto');
    assert.equal(r.rateUpdate.basePeriod, '2026-11');
    assert.equal(r.rateUpdate.steps.length, 0);
    assert.equal(r.rateUpdate.previous.length, 1);
  });
});

describe('rate-update: mano de obra propuesta por paritarias (0.12.1)', () => {
  const line = (extra = {}) => ({ agreementId: 'a', positions: 1, basicMonthly: 1000000, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6, ...extra });
  const ag = { id: 'a', name: 'Petroleros', raises: [{ fromPeriod: '2026-11', remunerativePct: 10, nonRemunerativePct: 20 }, { fromPeriod: '2027-01', remunerativePct: 5, nonRemunerativePct: 0 }] };
  test('sólo remunerativo: el % del convenio', async () => {
    const p = proposeLaborRaisePct([line()], [ag], '2026-10', '2026-12');
    close(p.pct, 10, 1e-9);
  });
  test('remunerativo y no remunerativo ponderados por su peso en el costo', async () => {
    const p = proposeLaborRaisePct([line({ nonRemunerativeMonthly: 500000 })], [ag], '2026-10', '2026-12');
    assert.ok(p.pct > 10 && p.pct < 20, String(p.pct));
  });
  test('ventana: (desde, hasta]; acumula; sin historial → null', async () => {
    close((proposeLaborRaisePct([line()], [ag], '2026-10', '2027-01')).pct, 15.5, 1e-9);
    close((proposeLaborRaisePct([line()], [ag], '2026-11', '2026-12')).pct, 0, 1e-9);
    assert.equal(proposeLaborRaisePct([line({ agreementId: 'x' })], [ag], '2026-10', '2026-12'), null);
  });
  test('puestos sin convenio quedan afuera y se informa', async () => {
    const p = proposeLaborRaisePct([line(), line({ agreementId: null })], [ag], '2026-10', '2026-12');
    assert.equal(p.covered, 1);
    assert.equal(p.total, 2);
  });
  test('la vianda sube con el no remunerativo y pesa por los días', () => {
    const p = proposeLaborRaisePct([line({ mealPerActiveDay: 20000 })], [ag], '2026-10', '2026-12', { activeDaysPerMonth: 20 });
    assert.ok(p.pct > 10, String(p.pct));
  });
  test('un puesto con 0 personas no cuenta en la cobertura; último aumento informado', () => {
    const p = proposeLaborRaisePct([line(), line({ positions: 0, agreementId: null })], [ag], '2026-10', '2026-12');
    assert.equal(p.total, 1);
    close(p.coveredShare, 1, 1e-9);
    assert.equal(p.lastRaise, '2026-11');
  });
});

