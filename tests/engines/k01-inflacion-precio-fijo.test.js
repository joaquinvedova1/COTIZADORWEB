/**
 * K-01 (0.13.0): inflación esperada con precio fijo todo el contrato.
 *   f = ((1 + π)^n − 1) / (n × π); inflación = (f − 1) × todo el resto de la EECC.
 * Apagada (campo ausente, null, 'adjusted', precio cerrado o un mes) el resultado es el de siempre.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { levelingFactor, priceAdjustmentOf, priceAdjustmentApplies, normalizePriceAdjustment, emptyPriceAdjustment } from '../../js/domain/price-adjustment.js';
import { buildCostModel, costAtActivity, costStructure } from '../../js/engines/cost-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { rateUpdateAmounts } from '../../js/engines/rate-update-engine.js';
import { demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { COST_CATEGORIES } from '../../js/domain/catalogs.js';

const close = (a, b, tol = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const fixed = (pct = 3, months = 12) => ({ ...demoHydroCraneQuote(), contractMonths: months, priceAdjustment: { mode: 'fixed', expectedMonthlyInflationPct: pct } });
const D = (q) => q.activity.activeDaysPerMonth;
const itemOf = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'price_adjustment') || null;

describe('K-01 · factor de nivelación', () => {
  test('3 % mensual durante 12 meses → 1,182669…', () => {
    close(levelingFactor(3, 12), 1.1826691301282766, 1e-12);
  });
  test('π = 0 o n ≤ 1 → 1', () => {
    assert.equal(levelingFactor(0, 12), 1);
    assert.equal(levelingFactor(1e-10, 12), 1);
    assert.equal(levelingFactor(3, 1), 1);
    assert.equal(levelingFactor(3, 0.5), 1);
  });
  test('n fraccionario: misma fórmula', () => {
    close(levelingFactor(2, 6.5), (Math.pow(1.02, 6.5) - 1) / (6.5 * 0.02), 1e-12);
  });
  test('no finito → null (no se aplica)', () => {
    assert.equal(levelingFactor(NaN, 12), null);
    assert.equal(levelingFactor(3, Infinity), null);
  });
  test('normalización y valor por defecto', () => {
    assert.deepEqual(emptyPriceAdjustment(), { mode: null, expectedMonthlyInflationPct: null });
    assert.deepEqual(normalizePriceAdjustment(undefined), { present: false, mode: null, expectedMonthlyInflationPct: null });
    assert.deepEqual(normalizePriceAdjustment({ mode: 'otro', expectedMonthlyInflationPct: '2,5' }), { present: true, mode: null, expectedMonthlyInflationPct: 2.5 });
    assert.deepEqual(createEmptyQuote({ organizationId: 'o' }).priceAdjustment, { mode: null, expectedMonthlyInflationPct: null });
  });
});

describe('K-01 · motor de costos', () => {
  test('apagado (ausente, null, ajustable, sin %) → el mismo modelo de siempre', () => {
    const base = demoHydroCraneQuote();
    const ref = buildCostModel(base);
    for (const pa of [undefined, null, { mode: null, expectedMonthlyInflationPct: null }, { mode: 'adjusted', expectedMonthlyInflationPct: 5 }, { mode: 'fixed', expectedMonthlyInflationPct: null }, { mode: 'fixed', expectedMonthlyInflationPct: 0 }]) {
      const m = buildCostModel({ ...base, priceAdjustment: pa });
      assert.equal(m.inflation.active, false);
      assert.equal(m.fixedMonthly, ref.fixedMonthly);
      assert.equal(m.variablePerActiveDay, ref.variablePerActiveDay);
      assert.deepEqual(m.byCategory, ref.byCategory);
      const a = computeQuote(base);
      const b = computeQuote({ ...base, priceAdjustment: pa });
      // Sin decidir, el puntaje tampoco cambia; con una decisión, la completitud suma ese ítem.
      const undecided = !pa || pa.mode === null;
      const strip = (k) => (undecided ? k : { ...k, completenessPct: null });
      assert.deepEqual(strip(b.kpis), strip(a.kpis));
      assert.deepEqual(b.eecc, a.eecc);
      assert.ok(!b.eecc.rows.some((r) => r.category === 'inflation'));
    }
  });

  test('precio cerrado o un mes de contrato → apagado aunque se elija precio fijo', () => {
    const closed = { ...fixed(), unit: 'job', contract: { mode: 'closed', components: ['labor'] } };
    assert.equal(priceAdjustmentApplies(closed), false);
    assert.equal(buildCostModel(closed).inflation.active, false);
    const oneMonth = fixed(3, 1);
    assert.equal(priceAdjustmentApplies(oneMonth), false);
    assert.equal(buildCostModel(oneMonth).inflation.factor, 1);
  });

  test('activo: inflación = (f − 1) × el resto; la suma de las categorías es el total', () => {
    const q = fixed();
    const off = computeQuote(demoHydroCraneQuote());
    const r = computeQuote(q);
    const f = r.model.inflation.factor;
    close(f, 1.1826691301282766, 1e-12);
    const at = costAtActivity(r.model, D(q));
    const rest = COST_CATEGORIES.filter((c) => c.id !== 'inflation').reduce((s, c) => s + at.byCategory[c.id], 0);
    close(at.byCategory.inflation, (f - 1) * rest, 1e-9);
    close(Object.values(at.byCategory).reduce((s, v) => s + v, 0), at.total, 1e-12);
    close(r.kpis.totalCost, off.kpis.totalCost * f, 1e-9);
    const eecc = costStructure(r.model, D(q));
    close(eecc.rows.reduce((s, row) => s + row.amount, 0), eecc.total, 1e-12);
    assert.equal(eecc.rows.at(-1).category, 'inflation');
    assert.equal(eecc.displayTotalPct, 100);
    close(r.model.inflation.lastMonthFactor, Math.pow(1.03, 11), 1e-12);
  });

  test('salidas completas: la parte por salida también lleva la inflación', () => {
    const base = demoHydroCraneQuote();
    base.activity = { ...base.activity, fullActivations: true, daysPerActivation: 3 };
    const off = buildCostModel(base);
    const on = buildCostModel({ ...base, contractMonths: 12, priceAdjustment: { mode: 'fixed', expectedMonthlyInflationPct: 3 } });
    const f = on.inflation.factor;
    if (off.activationRounding.perActivation.total > 0) {
      close(on.activationRounding.perActivation.total, off.activationRounding.perActivation.total * f, 1e-9);
    }
    close(costAtActivity(on, 7).total, costAtActivity(off, 7).total * f, 1e-9);
  });

  test('actualización de tarifa: la inflación acompaña sola (no pesa)', () => {
    const r = computeQuote(fixed());
    assert.equal(rateUpdateAmounts(r.eecc).inflation, undefined);
  });
});

describe('K-01 · validación, completitud y traza', () => {
  test('regla inflationPct 0–30', () => {
    const bad = validateQuote({ ...fixed(31) }).find((i) => i.path === 'priceAdjustment.expectedMonthlyInflationPct');
    assert.ok(bad);
    assert.equal(validateQuote(fixed(30)).some((i) => i.path === 'priceAdjustment.expectedMonthlyInflationPct'), false);
    // Fuera de rango no se aplica.
    assert.equal(priceAdjustmentOf(fixed(31)).active, false);
  });

  test('sin decidir (cotización nueva): amarillo sin restar puntaje; anteriores sin el campo: nada', () => {
    const base = demoHydroCraneQuote();
    assert.equal(itemOf(base), null);
    const undecided = { ...base, priceAdjustment: { mode: null, expectedMonthlyInflationPct: null } };
    const item = itemOf(undecided);
    assert.equal(item.status, 'warning');
    assert.equal(item.focus, 'priceAdjustment.mode');
    assert.equal(evaluateCompleteness(undecided).scorePct, evaluateCompleteness(base).scorePct);
    assert.equal(itemOf({ ...undecided, contractMonths: 1 }), null);
  });

  test('fijo sin %, fijo con f > 2 y fijo con actualizaciones: amarillo', () => {
    assert.equal(itemOf({ ...fixed(), priceAdjustment: { mode: 'fixed', expectedMonthlyInflationPct: null } }).focus, 'priceAdjustment.expectedMonthlyInflationPct');
    assert.equal(itemOf(fixed(10, 24)).status, 'warning');
    // Precio fijo + actualizaciones: aviso propio, también junto al de f > 2.
    const both = evaluateCompleteness({ ...fixed(10, 24), rateUpdate: { steps: [{ id: 's1' }] } }).items;
    assert.equal(both.find((i) => i.id === 'price_adjustment').message, 'Con ese % el costo del contrato se duplica. Revisá el %.');
    assert.equal(both.find((i) => i.id === 'price_adjustment_updates').status, 'warning');
    assert.equal(itemOf(fixed()).status, 'ok');
    assert.equal(itemOf({ ...fixed(), priceAdjustment: { mode: 'adjusted' } }).status, 'ok');
  });

  test('doble conteo: contingencia con % por inflación o precios y precio fijo → aviso', () => {
    const q = fixed();
    const i = q.risk.items.findIndex((x) => x.id === 'inflation');
    assert.ok(i >= 0);
    q.risk.items[i] = { ...q.risk.items[i], enabled: true, pct: 2 };
    const item = evaluateCompleteness(q).items.find((x) => x.id === 'price_adjustment_contingency');
    assert.equal(item.status, 'warning');
    assert.match(item.message, /La contingencia ya tiene 2[,.]?0* ?% por inflación o precios/);
    assert.equal(item.focus, `risk.items.${i}.pct`);
    const off = { ...q, priceAdjustment: { mode: 'adjusted' } };
    assert.equal(evaluateCompleteness(off).items.some((x) => x.id === 'price_adjustment_contingency'), false);
  });

  test('Ver cálculo: con pérdida en los últimos meses lo dice', () => {
    const t = computeQuote(fixed(3, 24)).traces.inflation;
    assert.ok(t.notes.some((n) => /Los últimos meses dan pérdida/.test(n)));
  });

  test('Ver cálculo: f, último mes y "El % lo cargaste vos"', () => {
    const t = computeQuote(fixed()).traces.inflation;
    assert.match(t.formula, /Costo promedio del contrato = costo de hoy × f/);
    assert.ok(t.steps.some((s) => /^Factor f/.test(s.label) && s.value === '1,182669'));
    assert.ok(t.steps.some((s) => /^Último mes/.test(s.label)));
    assert.ok(t.notes.some((n) => /El % lo cargaste vos/.test(n)));
  });
});
