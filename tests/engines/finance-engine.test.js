/**
 * Contrato del negocio — FinancialEngine (capital de trabajo y costo financiero).
 *
 * Reglas (Prompt 1 "Capital de trabajo", Prompt 4 §21):
 *   días financiados = días hasta facturar + plazo de cobro − días de pago del grupo (mínimo 0)
 *   capital de trabajo = Σ costo mensual en efectivo × días financiados / 30
 *   costo financiero   = Σ costo mensual en efectivo × tasa mensual × días financiados / 30
 *   Golden: 10.000.000 × 3 % × 90 / 30 = 900.000
 *   Plazo 0 (y facturación inmediata) → costo financiero 0.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { simpleFinancialCost, financingDays, computeFinance, DAYS_PER_MONTH_FINANCE } from '../../js/engines/finance-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

describe('FinancialEngine — costo financiero simple', () => {
  test('10.000.000 financiados 90 días al 3 % mensual → 900.000 (10M × 3 % × 90/30)', () => {
    approx(simpleFinancialCost(10_000_000, 3, 90), 900_000);
  });

  test('el mes financiero es de 30 días: 30 días al 3 % → 300.000', () => {
    assert.equal(DAYS_PER_MONTH_FINANCE, 30);
    approx(simpleFinancialCost(10_000_000, 3, 30), 300_000);
  });

  test('plazo 0 o tasa 0 → costo financiero 0', () => {
    assert.equal(simpleFinancialCost(10_000_000, 3, 0), 0);
    assert.equal(simpleFinancialCost(10_000_000, 0, 90), 0);
  });

  test('negativos y vacíos se sanean a 0 (nunca NaN); strings numéricos se aceptan', () => {
    assert.equal(simpleFinancialCost(-10_000_000, 3, 90), 0);
    assert.equal(simpleFinancialCost(10_000_000, -3, 90), 0);
    assert.equal(simpleFinancialCost(10_000_000, 3, -90), 0);
    assert.equal(simpleFinancialCost('', null, undefined), 0);
    approx(simpleFinancialCost('10000000', '3', '90'), 900_000);
  });

  test('a mayor plazo, mayor costo financiero (+30 días suma 300.000 sobre 10M al 3 %)', () => {
    approx(simpleFinancialCost(10_000_000, 3, 120) - simpleFinancialCost(10_000_000, 3, 90), 300_000);
  });
});

describe('FinancialEngine — días financiados', () => {
  test('días financiados = facturación + plazo − días de pago: 15 + 90 − 20 = 85', () => {
    assert.equal(financingDays({ invoiceLagDays: 15, paymentTermDays: 90, payDays: 20 }), 85);
  });

  test('si pagamos después de cobrar no financiamos nada (mínimo 0)', () => {
    assert.equal(financingDays({ invoiceLagDays: 15, paymentTermDays: 30, payDays: 120 }), 0);
  });

  test('plazo 0 y facturación inmediata → 0 días financiados', () => {
    assert.equal(financingDays({ invoiceLagDays: 0, paymentTermDays: 0, payDays: 0 }), 0);
    assert.equal(financingDays({}), 0);
  });
});

describe('FinancialEngine — capital de trabajo y costo financiero por grupo de pago', () => {
  // Costos en efectivo por grupo (ILUSTRATIVOS)
  const cash = {
    salaries: { fixedMonthly: 3_000_000, variablePerActiveDay: 100_000 },
    fuel: { fixedMonthly: 0, variablePerActiveDay: 50_000 },
    suppliers: { fixedMonthly: 1_000_000, variablePerActiveDay: 0 },
    materials: { fixedMonthly: 0, variablePerActiveDay: 0 },
    structure: { fixedMonthly: 500_000, variablePerActiveDay: 0 },
  };
  const finance = {
    paymentTermDays: 60,
    invoiceLagDays: 15,
    monthlyRatePct: 3,
    payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 },
  };

  test('cada grupo financia (15 + 60 − días de pago): salarios 55, combustible 75, proveedores 45', () => {
    const r = computeFinance(cash, finance);
    const days = Object.fromEntries(r.groups.map((g) => [g.id, g.financingDays]));
    assert.equal(days.salaries, 55);
    assert.equal(days.fuel, 75);
    assert.equal(days.suppliers, 45);
    assert.equal(days.materials, 45);
    assert.equal(days.structure, 55);
  });

  test('capital de trabajo fijo = 3M × 55/30 + 1M × 45/30 + 0,5M × 55/30 = 7.916.666,67', () => {
    const r = computeFinance(cash, finance);
    approx(r.workingCapitalFixed, (3_000_000 * 55) / 30 + (1_000_000 * 45) / 30 + (500_000 * 55) / 30);
    // variable: 100.000 × 55/30 + 50.000 × 75/30
    approx(r.workingCapitalPerActiveDay, (100_000 * 55) / 30 + (50_000 * 75) / 30);
  });

  test('costo financiero = capital de trabajo × tasa mensual (3 %)', () => {
    const r = computeFinance(cash, finance);
    approx(r.fixedMonthly, r.workingCapitalFixed * 0.03);
    approx(r.variablePerActiveDay, r.workingCapitalPerActiveDay * 0.03);
    approx(r.fixedMonthly, 237_500);
  });

  test('con tasa 0 hay capital de trabajo pero el costo financiero es 0', () => {
    const r = computeFinance(cash, { ...finance, monthlyRatePct: 0 });
    assert.ok(r.workingCapitalFixed > 0);
    assert.equal(r.fixedMonthly, 0);
    assert.equal(r.variablePerActiveDay, 0);
  });

  test('plazo de pago 0 con facturación inmediata → costo financiero 0 en todos los grupos', () => {
    const r = computeFinance(cash, { ...finance, paymentTermDays: 0, invoiceLagDays: 0 });
    assert.equal(r.fixedMonthly, 0);
    assert.equal(r.variablePerActiveDay, 0);
    assert.equal(r.workingCapitalFixed, 0);
  });

  test('plazo de pago +30 días sube el costo financiero', () => {
    const base = computeFinance(cash, finance);
    const longer = computeFinance(cash, { ...finance, paymentTermDays: 90 });
    assert.ok(longer.fixedMonthly > base.fixedMonthly);
    // +30 días en los 5 grupos: (3M + 1M + 0,5M) × 3 % × 30/30
    approx(longer.fixedMonthly - base.fixedMonthly, 4_500_000 * 0.03);
  });

  test('distingue plazo de pago definido (0 es un valor válido) de plazo sin definir', () => {
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: null }).paymentTermDefined, false);
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: '' }).paymentTermDefined, false);
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: undefined }).paymentTermDefined, false);
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: 'abc' }).paymentTermDefined, false);
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: 0 }).paymentTermDefined, true);
    assert.equal(computeFinance(cash, { ...finance, paymentTermDays: '60' }).paymentTermDefined, true);
  });

  test('grupos sin costos o configuración vacía no producen NaN', () => {
    const r = computeFinance({}, {});
    for (const value of [r.workingCapitalFixed, r.workingCapitalPerActiveDay, r.fixedMonthly, r.variablePerActiveDay]) {
      assert.equal(value, 0);
    }
    const weird = computeFinance(cash, { paymentTermDays: -30, invoiceLagDays: 'x', monthlyRatePct: Number.NaN, payDays: null });
    for (const value of [weird.workingCapitalFixed, weird.fixedMonthly]) assert.ok(Number.isFinite(value));
  });
});
