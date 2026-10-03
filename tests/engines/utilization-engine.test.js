/**
 * Contrato del negocio — UtilizationEngine (matriz tarifa × utilización).
 *
 * Reglas (Prompt 1 "Matriz tarifa × utilización", Prompt 3):
 *   utilización % = días activos / días disponibles × 100
 *   A mayor utilización, menor tarifa unitaria necesaria (los fijos se reparten
 *   entre más días). A menor utilización, mayor tarifa.
 *   tarifa necesaria(D, margen) = Costo(D) / (1 − margen) / D   (tarifa por día, sin otros ingresos)
 *   La matriz muestra 5, 8, 10, 15 y 20 días + la actividad estimada.
 *
 * Caso de referencia: fijos 30M/mes, variable 1M/día, 30 días disponibles.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { utilizationPct, activeDaysFromUtilization, matrixDays, buildRateUtilizationMatrix } from '../../js/engines/utilization-engine.js';
import { buildCostModel } from '../../js/engines/cost-engine.js';
import { createEconomicsContext } from '../../js/engines/economics-engine.js';
import { demoReferenceQuote } from '../../js/domain/demo-data.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Cotización on-call de referencia: F fijos/mes, v variable/día. */
function referenceQuote({ fixed = 30_000_000, variable = 1_000_000, activeDays = 8, availableDays = 30 } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = fixed;
  q.otherCosts[1].amount = variable;
  q.activity.activeDaysPerMonth = activeDays;
  q.activity.availableDaysPerMonth = availableDays;
  return q;
}

function contextOf(quote) {
  return createEconomicsContext(quote, buildCostModel(quote));
}

describe('UtilizationEngine — utilización', () => {
  test('8 días activos sobre 30 disponibles → utilización 26,67 %', () => {
    approx(utilizationPct(8, 30), (8 / 30) * 100);
  });

  test('utilización 100 %: 30 días activos sobre 30 disponibles', () => {
    approx(utilizationPct(30, 30), 100);
  });

  test('actividad 0 → utilización 0 %; utilización cercana a 0 (0,1 día) → 0,33 %', () => {
    approx(utilizationPct(0, 30), 0);
    approx(utilizationPct(0.1, 30), (0.1 / 30) * 100);
  });

  test('sin días disponibles la utilización no está definida (null, nunca Infinity)', () => {
    assert.equal(utilizationPct(8, 0), null);
    assert.equal(utilizationPct(8, ''), null);
  });

  test('negativos y vacíos se sanean a 0', () => {
    approx(utilizationPct(-5, 30), 0);
    approx(utilizationPct('', 30), 0);
  });

  test('días activos desde utilización: 50 % de 30 días = 15 días; se limita a 0–100 %', () => {
    approx(activeDaysFromUtilization(50, 30), 15);
    approx(activeDaysFromUtilization(150, 30), 30);
    approx(activeDaysFromUtilization(-10, 30), 0);
  });
});

describe('UtilizationEngine — días de la matriz', () => {
  test('la matriz usa 5, 8, 10, 15 y 20 días e incluye la actividad estimada si no está', () => {
    assert.deepEqual(matrixDays([5, 8, 10, 15, 20], 8), [5, 8, 10, 15, 20]);
    assert.deepEqual(matrixDays([5, 8, 10, 15, 20], 12), [5, 8, 10, 12, 15, 20]);
  });

  test('sin actividad estimada (0) o con días inválidos se omiten y no hay duplicados', () => {
    assert.deepEqual(matrixDays([5, 8, 10, 15, 20], 0), [5, 8, 10, 15, 20]);
    assert.deepEqual(matrixDays([20, 5, 5, 0, -3, 10], null), [5, 10, 20]);
  });
});

describe('UtilizationEngine — matriz tarifa × utilización', () => {
  const quote = referenceQuote();
  const ctx = contextOf(quote);
  const matrix = buildRateUtilizationMatrix(ctx, { days: [5, 8, 10, 15, 20], marginsPct: [5, 10, 15], commercialListRate: 4_000_000, estimatedDays: 8 });
  const row = (d) => matrix.find((r) => r.activeDays === d);

  test('tarifa break-even por cantidad de días: 5 → 7M; 8 → 4,75M; 10 → 4M; 15 → 3M; 20 → 2,5M', () => {
    // (30M + 1M·D) / D
    approx(row(5).floorNetRate, 7_000_000);
    approx(row(8).floorNetRate, 4_750_000);
    approx(row(10).floorNetRate, 4_000_000);
    approx(row(15).floorNetRate, 3_000_000);
    approx(row(20).floorNetRate, 2_500_000);
  });

  test('tarifa con margen 5 / 10 / 15 % con 20 días = costo / (1 − margen) / 20', () => {
    // Costo(20) = 50M
    const m = Object.fromEntries(row(20).byMargin.map((b) => [b.marginPct, b.netRate]));
    approx(m[5], 50_000_000 / 0.95 / 20);
    approx(m[10], 50_000_000 / 0.9 / 20);
    approx(m[15], 50_000_000 / 0.85 / 20);
  });

  test('tarifa margen 10 % con 10 días = 4.444.444,44', () => {
    const m10 = row(10).byMargin.find((b) => b.marginPct === 10);
    approx(m10.netRate, 40_000_000 / 0.9 / 10);
  });

  test('a mayor utilización, menor tarifa necesaria (piso y cada margen decrecen con los días)', () => {
    for (let i = 1; i < matrix.length; i += 1) {
      assert.ok(matrix[i].floorNetRate < matrix[i - 1].floorNetRate, `piso ${matrix[i].activeDays} días`);
      matrix[i].byMargin.forEach((b, j) => {
        assert.ok(b.netRate < matrix[i - 1].byMargin[j].netRate, `margen ${b.marginPct} % con ${matrix[i].activeDays} días`);
      });
    }
  });

  test('para cada fila: tarifa piso < margen 5 % < margen 10 % < margen 15 %', () => {
    for (const r of matrix) {
      const rates = [r.floorNetRate, ...r.byMargin.map((b) => b.netRate)];
      for (let i = 1; i < rates.length; i += 1) assert.ok(rates[i] > rates[i - 1]);
    }
  });

  test('con la tarifa comercial de 4M/día: facturación, costo y resultado por fila', () => {
    // D = 5: facturación 20M, costo 35M, resultado −15M
    approx(row(5).revenue, 20_000_000);
    approx(row(5).cost, 35_000_000);
    approx(row(5).profit, -15_000_000);
    // D = 10: equilibrio exacto
    approx(row(10).profit, 0);
    approx(row(10).marginPct, 0);
    // D = 15: facturación 60M, costo 45M, resultado 15M, margen 25 %
    approx(row(15).profit, 15_000_000);
    approx(row(15).marginPct, 25);
  });

  test('marca la fila de la actividad estimada y su utilización', () => {
    assert.equal(row(8).isEstimate, true);
    assert.equal(row(10).isEstimate, false);
    approx(row(15).utilizationPct, 50);
  });

  test('sin tarifa comercial la matriz muestra sólo tarifas necesarias (facturación y resultado null)', () => {
    const noRate = buildRateUtilizationMatrix(ctx, { days: [8], marginsPct: [10], commercialListRate: null, estimatedDays: 8 });
    assert.equal(noRate[0].revenue, null);
    assert.equal(noRate[0].profit, null);
    approx(noRate[0].floorNetRate, 4_750_000);
  });
});

describe('UtilizationEngine — casos extremos de utilización', () => {
  const ctx = contextOf(referenceQuote());

  test('utilización 100 % (30 de 30 días): tarifa piso 2.000.000 y no excede la disponibilidad', () => {
    const [r] = buildRateUtilizationMatrix(ctx, { days: [30], marginsPct: [10], commercialListRate: null, estimatedDays: 8 });
    approx(r.floorNetRate, 60_000_000 / 30);
    approx(r.utilizationPct, 100);
    assert.equal(r.exceedsAvailability, false);
  });

  test('más días que los disponibles: se marca y los fijos se prorratean (40 días → costo 80M)', () => {
    // fijos 30M × 40/30 = 40M + variable 40M
    const [r] = buildRateUtilizationMatrix(ctx, { days: [40], marginsPct: [10], commercialListRate: null, estimatedDays: 8 });
    assert.equal(r.exceedsAvailability, true);
    approx(r.cost, 80_000_000);
    approx(r.floorNetRate, 2_000_000);
  });

  test('utilización cercana a 0 (0,1 día): tarifa piso 301.000.000, finita', () => {
    const [r] = buildRateUtilizationMatrix(ctx, { days: [0.1], marginsPct: [10], commercialListRate: 4_000_000, estimatedDays: 8 });
    approx(r.floorNetRate, 30_100_000 / 0.1, '', 1e-3);
    assert.ok(Number.isFinite(r.profit));
  });

  test('actividad 0: no hay tarifa por día posible (null), nunca Infinity', () => {
    const [r] = buildRateUtilizationMatrix(ctx, { days: [0], marginsPct: [10], commercialListRate: 4_000_000, estimatedDays: 0 });
    assert.equal(r.floorNetRate, null);
    assert.equal(r.byMargin[0].netRate, null);
    approx(r.profit, -30_000_000, 'sin actividad se pierden los fijos completos');
  });
});
