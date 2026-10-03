/**
 * Contrato del negocio — ScenarioEngine (sensibilidad, escenarios y comparador de modelos).
 *
 * Reglas (Prompt 1 "Sensibilidad", "Escenarios", "Comparador de modelos comerciales";
 * Prompt 3 "Sensibilidad"):
 *   Al sensibilizar, la TARIFA COMERCIAL queda fija (la ofrecida en el caso base) para ver el
 *   impacto real de cada variable en costo, tarifa piso, margen, resultado y break-even.
 *   - salarios +10 % → sube el costo
 *   - utilización −X % → sube la tarifa piso
 *   - descuento comercial → baja el resultado (con tarifa fija)
 *   - plazo de pago +30 días → sube el costo financiero
 *   Escenarios: pesimista < base < optimista (en resultado).
 *   Comparador: tarifa por día / disponibilidad + día / mínimo garantizado + día /
 *   paquete + excedentes, todos calibrados al margen objetivo con la actividad estimada
 *   (mismo ingreso esperado); "fee de disponibilidad + día" asegura un ingreso mínimo > 0.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applySensitivity, runSensitivity, sensitivityTable, runScenarios, compareCommercialModels, SENSITIVITY_VARIABLES } from '../../js/engines/scenario-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createDemoState, demoReferenceQuote, demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { deepFreeze } from '../../js/core/object.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Igualdad relativa para montos grandes calculados por caminos distintos. */
function approxRel(actual, expected, message = '', rel = 1e-9) {
  approx(actual, expected, message, Math.max(EPS, Math.abs(expected) * rel));
}

describe('ScenarioEngine — aplicar variaciones (sin mutar la cotización)', () => {
  test('salarios +10 %: básico y adicionales suben 10 %', () => {
    const q = applySensitivity(demoHydroCraneQuote(), { salariesPct: 10 });
    approx(q.labor[0].basicMonthly, 1_980_000);
    approx(q.labor[0].additionalsMonthly, 440_000);
  });

  test('combustible +10 %: 1.500 → 1.650 $/L; materiales +10 %: costo unitario × 1,1', () => {
    const q = applySensitivity(demoHydroCraneQuote(), { fuelPct: 10, materialsPct: 10 });
    approx(q.fuel.pricePerLiter, 1_650);
    approx(q.materials[0].unitCost, 330_000);
    approx(q.materials[1].unitCost, 55_000);
  });

  test('materiales +10 % sólo afecta otros costos de categoría materiales', () => {
    const base = demoReferenceQuote();
    base.otherCosts.push({ id: 'om', description: 'Consumibles', category: 'materials', behavior: 'fixed_monthly', amount: 100_000 });
    const q = applySensitivity(base, { materialsPct: 10 });
    approx(q.otherCosts[0].amount, 30_000_000, 'categoría equipos sin cambio');
    approx(q.otherCosts[2].amount, 110_000);
  });

  test('utilización −25 %: 8 → 6 días activos; nunca supera los días disponibles', () => {
    approx(applySensitivity(demoReferenceQuote(), { activityPct: -25 }).activity.activeDaysPerMonth, 6);
    approx(applySensitivity(demoReferenceQuote(), { activityPct: 500 }).activity.activeDaysPerMonth, 30);
    approx(applySensitivity(demoReferenceQuote(), { activityPct: -200 }).activity.activeDaysPerMonth, 0);
  });

  test('si los días disponibles no son válidos (0) la variación de actividad se limita a los 30 días que usa el motor', () => {
    const base = demoReferenceQuote();
    base.activity.availableDaysPerMonth = 0;
    base.activity.activeDaysPerMonth = 28;
    const q = applySensitivity(base, { activityPct: 50 });
    assert.ok(q.activity.activeDaysPerMonth <= 30, `días activos ${q.activity.activeDaysPerMonth}: el motor usa 30 días disponibles`);
  });

  test('plazo de pago +30 días: 90 → 120; nunca negativo', () => {
    approx(applySensitivity(demoHydroCraneQuote(), { paymentTermDays: 30 }).finance.paymentTermDays, 120);
    approx(applySensitivity(demoHydroCraneQuote(), { paymentTermDays: -200 }).finance.paymentTermDays, 0);
  });

  test('descuento comercial: suma puntos y se limita a 0–100 %', () => {
    approx(applySensitivity(demoHydroCraneQuote(), { commercialDiscountPct: 5 }).pricing.commercialDiscountPct, 5);
    approx(applySensitivity(demoHydroCraneQuote(), { commercialDiscountPct: -10 }).pricing.commercialDiscountPct, 0);
    approx(applySensitivity(demoHydroCraneQuote(), { commercialDiscountPct: 150 }).pricing.commercialDiscountPct, 100);
  });

  test('no muta la cotización original (funciona con la cotización congelada)', () => {
    const original = demoHydroCraneQuote();
    const before = JSON.stringify(original);
    const frozen = deepFreeze(JSON.parse(before));
    const changed = applySensitivity(frozen, { salariesPct: 10, fuelPct: 10, materialsPct: 10, activityPct: -25, paymentTermDays: 30, commercialDiscountPct: 5 });
    assert.equal(JSON.stringify(frozen), before);
    assert.notEqual(JSON.stringify(changed), before);
  });

  test('variaciones vacías o en 0 no cambian el resultado', () => {
    const q = demoHydroCraneQuote();
    assert.deepEqual(computeQuote(applySensitivity(q, {})).kpis, computeQuote(q).kpis);
    assert.deepEqual(computeQuote(applySensitivity(q, { salariesPct: '', fuelPct: null, activityPct: 0 })).kpis, computeQuote(q).kpis);
  });
});

describe('ScenarioEngine — sensibilidad con tarifa comercial fija', () => {
  test('salarios +10 % sube el costo total y baja el resultado; la tarifa comercial no cambia', () => {
    const s = runSensitivity(demoHydroCraneQuote(), { salariesPct: 10 });
    assert.ok(s.delta.totalCost > 0);
    assert.ok(s.delta.profit < 0);
    assert.equal(s.scenario.commercialListRate, s.base.commercialListRate);
    assert.equal(s.listRate, s.base.commercialListRate);
  });

  test('utilización −25 % sube la tarifa piso: con 6 días el piso es 36M / 6 = 6M (antes 4,75M)', () => {
    const s = runSensitivity(demoReferenceQuote(), { activityPct: -25 });
    approx(s.base.floorNetRate, 4_750_000);
    approx(s.scenario.floorNetRate, 6_000_000);
    approx(s.delta.floorNetRate, 1_250_000);
  });

  test('descuento comercial +5 puntos con tarifa fija baja el resultado en 5 % de la facturación (−1,6M)', () => {
    const s = runSensitivity(demoReferenceQuote(), { commercialDiscountPct: 5 });
    approx(s.scenario.revenue, 30_400_000);
    approx(s.delta.profit, -1_600_000);
    approx(s.scenario.commercialListRate, 4_000_000);
  });

  test('plazo de pago +30 días sube el costo financiero (y el costo total)', () => {
    const q = demoHydroCraneQuote();
    const base = computeQuote(q).kpis.financialCost;
    const longer = computeQuote(applySensitivity(q, { paymentTermDays: 30 })).kpis.financialCost;
    assert.ok(base > 0);
    assert.ok(longer > base);
    assert.ok(runSensitivity(q, { paymentTermDays: 30 }).delta.totalCost > 0);
  });

  test('combustible +10 % sube el costo de la demo hidrogrúa', () => {
    assert.ok(runSensitivity(demoHydroCraneQuote(), { fuelPct: 10 }).delta.totalCost > 0);
  });

  test('con tarifa fija, menos utilización no mueve el break-even (depende de costos y tarifa) pero empeora el resultado', () => {
    // Con la tarifa de 4M y los mismos costos, el break-even sigue siendo 10 días aunque se trabajen 6.
    const s = runSensitivity(demoReferenceQuote(), { activityPct: -25 });
    approx(s.base.breakEvenDays, 10);
    approx(s.scenario.breakEvenDays, 10);
    approx(s.scenario.profit, 24_000_000 - 36_000_000);
  });

  test('tabla de impacto: una fila por variable, con variación hacia abajo y hacia arriba', () => {
    const table = sensitivityTable(demoHydroCraneQuote());
    assert.deepEqual(table.map((r) => r.variable), ['salariesPct', 'fuelPct', 'materialsPct', 'activityPct', 'paymentTermDays', 'commercialDiscountPct']);
    assert.equal(SENSITIVITY_VARIABLES.length, 6);
    const row = (id) => table.find((r) => r.variable === id);
    assert.ok(row('salariesPct').profitDeltaHigh < 0 && row('salariesPct').profitDeltaLow > 0);
    assert.ok(row('fuelPct').profitDeltaHigh < 0);
    assert.ok(row('activityPct').profitDeltaHigh > 0, 'con margen positivo, más actividad mejora el resultado');
    assert.ok(row('paymentTermDays').profitDeltaHigh < 0);
    assert.ok(row('commercialDiscountPct').profitDeltaHigh < 0);
    assert.equal(row('commercialDiscountPct').low, null, 'sin descuento base no se puede bajar el descuento');
  });
});

describe('ScenarioEngine — escenarios pesimista / base / optimista', () => {
  test('demo: resultado pesimista < base < optimista', () => {
    for (const q of createDemoState(1).quotes) {
      const [pess, base, opt] = runScenarios(q);
      assert.deepEqual([pess.id, base.id, opt.id], ['pessimistic', 'base', 'optimistic']);
      assert.ok(pess.profit < base.profit, `${q.name}: pesimista ${pess.profit} < base ${base.profit}`);
      assert.ok(base.profit < opt.profit, `${q.name}: base ${base.profit} < optimista ${opt.profit}`);
      assert.equal(pess.commercialListRate, base.commercialListRate, 'misma tarifa comercial en los tres escenarios');
      assert.equal(opt.commercialListRate, base.commercialListRate);
    }
  });

  test('caso de referencia: actividad −25 % → 6 días (−12M); base 8 días (−6M); +25 % → 10 días (0)', () => {
    const [pess, base, opt] = runScenarios(demoReferenceQuote());
    approx(pess.profit, -12_000_000);
    approx(base.profit, -6_000_000);
    approx(opt.profit, 0);
    approx(pess.activeDays, 6);
    approx(opt.activeDays, 10);
    approx(base.effectiveRatePerActiveDay, 4_000_000);
  });

  test('los escenarios pueden configurarse', () => {
    const [pess, , opt] = runScenarios(demoReferenceQuote(), { scenarios: { pessimistic: { activityPct: -50 }, optimistic: { activityPct: 50 } } });
    approx(pess.activeDays, 4);
    approx(opt.activeDays, 12);
  });
});

describe('ScenarioEngine — comparador de modelos comerciales', () => {
  // Caso de referencia: C(8) = 38M, fijos 30M, variable 1M/día, margen objetivo 10 % (k = 0,9).
  const result = compareCommercialModels(demoReferenceQuote());
  const model = (id) => result.models.find((m) => m.id === id);

  test('compara 4 modelos: sólo día, disponibilidad + día, mínimo garantizado + día, paquete + excedentes', () => {
    assert.deepEqual(result.models.map((m) => m.id), ['day_rate', 'availability_plus_day', 'guarantee_plus_day', 'package_plus_excess']);
    approx(result.estimatedDays, 8);
    approx(result.pessimisticDays, 6);
  });

  test('los 4 modelos tienen el mismo ingreso esperado a la actividad estimada: 38M / 0,9 = 42,22M (margen 10 %)', () => {
    for (const m of result.models) {
      approxRel(m.expectedRevenue, 38_000_000 / 0.9, m.id);
      approx(m.expectedMarginPct, 10, m.id);
    }
  });

  test('sólo tarifa por día: 5.277.777,78/día, ingreso mínimo asegurado 0 y riesgo alto en el escenario pesimista', () => {
    const m = model('day_rate');
    approx(m.params.ratePerDay, 38_000_000 / 7.2);
    approx(m.minimumAssuredRevenue, 0);
    approx(m.breakEvenDays, 30_000_000 / (38_000_000 / 7.2 - 1_000_000));
    assert.ok(m.pessimisticProfit < 0);
    assert.equal(m.risk, 'high');
  });

  test('fee de disponibilidad + día asegura un ingreso mínimo > 0 (fijos / 0,9 = 33,33M) y no pierde con ninguna actividad', () => {
    const m = model('availability_plus_day');
    assert.ok(m.minimumAssuredRevenue > 0);
    approx(m.minimumAssuredRevenue, 30_000_000 / 0.9, '', 1e-4);
    approx(m.params.ratePerDay, 1_000_000 / 0.9, '', 1e-4);
    approx(m.breakEvenDays, 0);
    approx(m.pessimisticMarginPct, 10, 'mantiene el margen aunque baje la actividad');
    assert.equal(m.risk, 'low');
  });

  test('mínimo garantizado + día: el ingreso mínimo asegurado son los costos fijos (30M)', () => {
    approx(model('guarantee_plus_day').minimumAssuredRevenue, 30_000_000);
  });

  test('paquete mensual + excedentes: el paquete asegura el ingreso esperado completo', () => {
    const m = model('package_plus_excess');
    approxRel(m.minimumAssuredRevenue, 38_000_000 / 0.9);
    approx(m.params.includedDays, 8);
  });

  test('demo hidrogrúa: los 4 modelos calibrados al margen objetivo tienen el mismo ingreso esperado', () => {
    const r = compareCommercialModels(demoHydroCraneQuote());
    assert.equal(r.models.length, 4);
    const expected = r.models[0].expectedRevenue;
    for (const m of r.models) {
      approxRel(m.expectedRevenue, expected, m.id);
      approx(m.expectedMarginPct, 10, m.id, 1e-6);
    }
    assert.ok(r.models.find((m) => m.id === 'availability_plus_day').minimumAssuredRevenue > 0);
  });

  test('sin actividad estimada o con margen inválido no se comparan modelos (y se explica)', () => {
    const noActivity = demoReferenceQuote();
    noActivity.activity.activeDaysPerMonth = 0;
    const a = compareCommercialModels(noActivity);
    assert.deepEqual(a.models, []);
    assert.equal(typeof a.reason, 'string');
    const badMargin = demoReferenceQuote();
    badMargin.pricing.targetMarginPct = 100;
    assert.deepEqual(compareCommercialModels(badMargin).models, []);
  });
});
