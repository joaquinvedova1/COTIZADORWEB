/**
 * Contrato del negocio — MaterialsEngine (materiales y otros costos directos).
 *
 * Reglas (Prompt 1 "Materiales"):
 *   costo = cantidad × costo unitario × (1 + merma %) × (1 + logística %)
 *   Quién provee: cliente → NO es costo nuestro (costo 0, se lista igual);
 *                 contratista o tercero contratado por nosotros → es costo.
 *   Base de cálculo: por mes → fijo; por día activo → variable;
 *                    por activación → variable por día = costo / días por activación.
 *   Markup de reventa (opcional, informativo) = costo × (1 + markup %) — markup sobre costo.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMaterialLine, computeMaterials, computeOtherCostLine } from '../../js/engines/materials-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

function electrodes(overrides = {}) {
  return {
    id: 'm1',
    description: 'Electrodos (ilustrativo)',
    quantity: 10,
    unitCost: 18_000,
    wastePct: 10,
    logisticsPct: 5,
    resaleMarkupPct: 0,
    basis: 'per_active_day',
    providedBy: 'contractor',
    ...overrides,
  };
}

// 10 × 18.000 × 1,10 × 1,05 = 207.900
const GROSS = 10 * 18_000 * 1.1 * 1.05;

describe('MaterialsEngine — costo con merma y logística', () => {
  test('costo = cantidad × unitario × (1 + merma) × (1 + logística) = 207.900', () => {
    const r = computeMaterialLine(electrodes());
    approx(r.grossCost, GROSS);
    approx(r.costForUs, GROSS);
  });

  test('sin merma ni logística el costo es cantidad × unitario', () => {
    approx(computeMaterialLine(electrodes({ wastePct: 0, logisticsPct: 0 })).costForUs, 180_000);
  });

  test('merma y logística se aplican en cascada (no se suman): 1,10 × 1,05 ≠ 1,15', () => {
    const r = computeMaterialLine(electrodes());
    assert.ok(Math.abs(r.costForUs - 180_000 * 1.15) > 1);
  });
});

describe('MaterialsEngine — quién provee', () => {
  test('si lo provee el cliente el costo para nosotros es 0, pero el material se lista con su valor', () => {
    const r = computeMaterialLine(electrodes({ providedBy: 'client' }));
    assert.equal(r.costForUs, 0);
    assert.equal(r.variablePerActiveDay, 0);
    assert.equal(r.fixedMonthly, 0);
    approx(r.grossCost, GROSS);
    assert.equal(r.providedBy, 'client');
  });

  test('si lo provee un tercero contratado por nosotros, es costo nuestro', () => {
    approx(computeMaterialLine(electrodes({ providedBy: 'third_party' })).costForUs, GROSS);
  });

  test('sin responsable definido se costea igual (criterio conservador: no se omite el costo)', () => {
    const r = computeMaterialLine(electrodes({ providedBy: null }));
    approx(r.costForUs, GROSS);
    assert.equal(r.providedBy, null);
  });
});

describe('MaterialsEngine — base de cálculo', () => {
  test('por día activo → costo variable por día', () => {
    const r = computeMaterialLine(electrodes({ basis: 'per_active_day' }), { daysPerActivation: 2 });
    approx(r.variablePerActiveDay, GROSS);
    assert.equal(r.fixedMonthly, 0);
  });

  test('por activación → variable por día = costo / días por activación (50.000 / 2 = 25.000)', () => {
    const r = computeMaterialLine({ quantity: 1, unitCost: 50_000, basis: 'per_activation', providedBy: 'contractor' }, { daysPerActivation: 2 });
    approx(r.variablePerActiveDay, 25_000);
    assert.equal(r.fixedMonthly, 0);
  });

  test('por mes → costo fijo mensual', () => {
    const r = computeMaterialLine({ quantity: 1, unitCost: 300_000, basis: 'per_month', providedBy: 'contractor' });
    approx(r.fixedMonthly, 300_000);
    assert.equal(r.variablePerActiveDay, 0);
  });

  test('base desconocida → se trata como mensual', () => {
    const r = computeMaterialLine({ quantity: 1, unitCost: 300_000, basis: 'semanal', providedBy: 'contractor' });
    assert.equal(r.basis, 'per_month');
    approx(r.fixedMonthly, 300_000);
  });

  test('por activación con 0 días por activación → 0 por día (nunca Infinity)', () => {
    const r = computeMaterialLine({ quantity: 1, unitCost: 50_000, basis: 'per_activation', providedBy: 'contractor' }, { daysPerActivation: 0 });
    assert.equal(r.variablePerActiveDay, 0);
  });
});

describe('MaterialsEngine — reventa, sumas y valores inválidos', () => {
  test('precio de reventa informativo = costo × (1 + markup de reventa sobre costo)', () => {
    const r = computeMaterialLine({ quantity: 1, unitCost: 300_000, resaleMarkupPct: 20, providedBy: 'contractor' });
    approx(r.resalePrice, 360_000);
  });

  test('la suma de materiales separa fijos y variables', () => {
    const r = computeMaterials(
      [
        { quantity: 1, unitCost: 300_000, basis: 'per_month', providedBy: 'contractor' },
        { quantity: 1, unitCost: 50_000, basis: 'per_activation', providedBy: 'contractor' },
        { quantity: 1, unitCost: 999_999, basis: 'per_activation', providedBy: 'client' },
      ],
      { daysPerActivation: 2 },
    );
    approx(r.fixedMonthly, 300_000);
    approx(r.variablePerActiveDay, 25_000);
    assert.equal(r.lines.length, 3);
  });

  test('negativos se sanean a 0 y strings numéricos se aceptan', () => {
    assert.equal(computeMaterialLine(electrodes({ quantity: -10 })).costForUs, 0);
    approx(computeMaterialLine(electrodes({ wastePct: -10, logisticsPct: -5 })).costForUs, 180_000);
    approx(computeMaterialLine(electrodes({ quantity: '10', unitCost: '18000', wastePct: '10', logisticsPct: '5' })).costForUs, GROSS);
  });

  test('vacíos nunca producen NaN', () => {
    for (const empty of ['', null, undefined, Number.NaN, 'abc']) {
      const r = computeMaterialLine(electrodes({ quantity: empty, unitCost: empty, wastePct: empty, logisticsPct: empty }));
      assert.ok(Number.isFinite(r.costForUs));
      assert.ok(Number.isFinite(r.variablePerActiveDay));
    }
    const none = computeMaterials(null);
    assert.equal(none.fixedMonthly, 0);
    assert.equal(none.variablePerActiveDay, 0);
  });
});

describe('MaterialsEngine — otros costos directos (terceros, subcontratos, manuales)', () => {
  test('fijo mensual, por día activo y por activación (/ días por activación)', () => {
    approx(computeOtherCostLine({ amount: 30_000_000, behavior: 'fixed_monthly' }).fixedMonthly, 30_000_000);
    approx(computeOtherCostLine({ amount: 1_000_000, behavior: 'per_active_day' }).variablePerActiveDay, 1_000_000);
    approx(computeOtherCostLine({ amount: 400_000, behavior: 'per_activation' }, { daysPerActivation: 4 }).variablePerActiveDay, 100_000);
  });

  test('comportamiento desconocido → fijo mensual; monto negativo → 0', () => {
    const unknown = computeOtherCostLine({ amount: 500, behavior: 'raro' });
    assert.equal(unknown.behavior, 'fixed_monthly');
    approx(unknown.fixedMonthly, 500);
    assert.equal(computeOtherCostLine({ amount: -500, behavior: 'fixed_monthly' }).fixedMonthly, 0);
  });
});
