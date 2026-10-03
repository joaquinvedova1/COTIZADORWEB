/**
 * Contrato del negocio — EquipmentEngine (equipos).
 *
 * Reglas (Prompt 1 "Equipos", Prompt 3 "Equipos"):
 *   Separar COSTO DE POSESIÓN (existe aunque el equipo no trabaje) de
 *   COSTO DE OPERACIÓN (existe sólo cuando trabaja).
 *   amortización mensual = (valor de reposición − valor residual) / (vida útil años × 12)
 *   seguro / patente / certificaciones anuales → / 12
 *   operación por hora = mantenimiento/h + neumáticos/h + litros/h × precio combustible
 *   $/hora, $/día y $/mes dependen de la utilización: a menor utilización, mayor costo unitario.
 *   Un residual mayor a la reposición NO genera amortización negativa.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOwnership, computeOperation, computeEquipmentUnit, computeEquipmentLine } from '../../js/engines/equipment-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Hidrogrúa ILUSTRATIVA. */
function hydroCrane(overrides = {}) {
  return {
    id: 'hc',
    name: 'Hidrogrúa',
    quantity: 1,
    replacementValue: 250_000_000,
    usefulLifeYears: 10,
    residualValue: 50_000_000,
    insuranceAnnual: 6_000_000,
    licenseAnnual: 2_400_000,
    certificationsAnnual: 1_800_000,
    capitalRatePctAnnual: 0,
    maintenancePerHour: 15_000,
    tiresPerHour: 5_000,
    fuelLitersPerHour: 12,
    availableHoursPerMonth: 300,
    availableDaysPerMonth: 30,
    utilizationPct: 27,
    ...overrides,
  };
}

// Posesión mensual esperada (a mano):
//   amortización = (250M − 50M) / (10 × 12) = 1.666.666,67
//   seguro 6M/12 = 500.000; patente 2,4M/12 = 200.000; certificaciones 1,8M/12 = 150.000
const DEPRECIATION = 200_000_000 / 120;
const CASH_OWNERSHIP = 500_000 + 200_000 + 150_000;
const OWNERSHIP = DEPRECIATION + CASH_OWNERSHIP;
// Operación por hora con combustible a 1.500 $/L: 15.000 + 5.000 + 12 × 1.500 = 38.000
const OPERATION_PER_HOUR = 38_000;

describe('EquipmentEngine — costo de posesión', () => {
  test('amortización = (reposición − residual) / (vida útil × 12) = 1.666.666,67 por mes', () => {
    const o = computeOwnership(hydroCrane());
    approx(o.depreciationMonthly, DEPRECIATION);
  });

  test('seguro, patente y certificaciones anuales se mensualizan (/12)', () => {
    const o = computeOwnership(hydroCrane());
    approx(o.insuranceMonthly, 500_000);
    approx(o.licenseMonthly, 200_000);
    approx(o.certificationsMonthly, 150_000);
  });

  test('posesión = amortización + seguro + patente + certificaciones (+ costo de capital)', () => {
    const o = computeOwnership(hydroCrane());
    approx(o.totalMonthly, OWNERSHIP);
  });

  test('la amortización y el costo de capital no son salida de caja; seguro/patente/certificaciones sí', () => {
    const o = computeOwnership(hydroCrane({ capitalRatePctAnnual: 12 }));
    approx(o.cashMonthly, CASH_OWNERSHIP);
    // costo de capital = inversión promedio (250M + 50M)/2 × 12 % / 12 = 1.500.000
    approx(o.capitalCostMonthly, 1_500_000);
    approx(o.nonCashMonthly, DEPRECIATION + 1_500_000);
  });

  test('residual mayor a la reposición no genera amortización negativa (queda en 0)', () => {
    const o = computeOwnership(hydroCrane({ replacementValue: 10_000_000, residualValue: 15_000_000 }));
    assert.equal(o.depreciationMonthly, 0);
    assert.ok(o.residual <= o.replacement);
    assert.ok(o.totalMonthly >= 0);
  });

  test('vida útil 0 o vacía → sin amortización (0), nunca Infinity', () => {
    for (const life of [0, '', null, undefined, -5]) {
      const o = computeOwnership(hydroCrane({ usefulLifeYears: life }));
      assert.equal(o.depreciationMonthly, 0, `vida útil ${String(life)}`);
      assert.ok(Number.isFinite(o.totalMonthly));
    }
  });

  test('negativos se sanean a 0', () => {
    const o = computeOwnership(hydroCrane({ insuranceAnnual: -12_000, licenseAnnual: -1 }));
    approx(o.insuranceMonthly, 0);
    approx(o.licenseMonthly, 0);
  });
});

describe('EquipmentEngine — costo de operación', () => {
  test('operación por hora = mantenimiento + neumáticos + litros × precio combustible = 38.000', () => {
    const op = computeOperation(hydroCrane(), { fuelPricePerLiter: 1500 });
    approx(op.nonFuelPerHour, 20_000);
    approx(op.fuelPerHour, 18_000);
    approx(op.totalPerHour, OPERATION_PER_HOUR);
  });

  test('si el combustible lo provee el cliente no es costo nuestro', () => {
    const op = computeOperation(hydroCrane(), { fuelPricePerLiter: 1500, fuelPaidByUs: false });
    assert.equal(op.fuelPerHour, 0);
    approx(op.totalPerHour, 20_000);
  });

  test('la operación no cambia con la utilización (es por hora de uso)', () => {
    const low = computeEquipmentUnit(hydroCrane({ utilizationPct: 10 }), { fuelPricePerLiter: 1500 });
    const high = computeEquipmentUnit(hydroCrane({ utilizationPct: 90 }), { fuelPricePerLiter: 1500 });
    approx(low.operation.totalPerHour, high.operation.totalPerHour);
  });
});

describe('EquipmentEngine — $/hora, $/día y $/mes según utilización', () => {
  test('ficha con utilización 27 %: 81 h y 8,1 días usados; $/mes, $/hora y $/día', () => {
    // horas usadas = 300 × 27 % = 81; días usados = 30 × 27 % = 8,1
    // $/mes = posesión + 38.000 × 81
    const u = computeEquipmentUnit(hydroCrane(), { fuelPricePerLiter: 1500 });
    approx(u.capacity.usedHoursPerMonth, 81);
    approx(u.capacity.usedDaysPerMonth, 8.1);
    const perMonth = OWNERSHIP + OPERATION_PER_HOUR * 81;
    approx(u.rates.costPerMonth, perMonth);
    approx(u.rates.costPerUsedHour, perMonth / 81);
    approx(u.rates.costPerUsedDay, perMonth / 8.1);
    approx(u.rates.ownershipPerUsedHour, OWNERSHIP / 81);
  });

  test('a menor utilización, mayor costo por hora y por día (los fijos se reparten entre menos horas)', () => {
    const at = (pctUse) => computeEquipmentUnit(hydroCrane({ utilizationPct: pctUse }), { fuelPricePerLiter: 1500 }).rates;
    const levels = [10, 27, 54, 100].map(at);
    for (let i = 1; i < levels.length; i += 1) {
      assert.ok(levels[i].costPerUsedHour < levels[i - 1].costPerUsedHour, 'costo por hora decrece con la utilización');
      assert.ok(levels[i].costPerUsedDay < levels[i - 1].costPerUsedDay, 'costo por día decrece con la utilización');
      assert.ok(levels[i].costPerMonth > levels[i - 1].costPerMonth, 'el costo mensual total crece con el uso');
    }
  });

  test('utilización 100 %: costo por hora = posesión / 300 + operación por hora', () => {
    const u = computeEquipmentUnit(hydroCrane({ utilizationPct: 100 }), { fuelPricePerLiter: 1500 });
    approx(u.rates.costPerUsedHour, OWNERSHIP / 300 + OPERATION_PER_HOUR);
  });

  test('utilización mayor a 100 % se limita a 100 %', () => {
    const u = computeEquipmentUnit(hydroCrane({ utilizationPct: 150 }), { fuelPricePerLiter: 1500 });
    assert.equal(u.capacity.utilizationPct, 100);
    approx(u.capacity.usedHoursPerMonth, 300);
  });

  test('utilización 0: no hay costo por hora ni por día (null), nunca Infinity; el costo mensual es la posesión', () => {
    const u = computeEquipmentUnit(hydroCrane({ utilizationPct: 0 }), { fuelPricePerLiter: 1500 });
    assert.equal(u.rates.costPerUsedHour, null);
    assert.equal(u.rates.costPerUsedDay, null);
    approx(u.rates.costPerMonth, OWNERSHIP);
  });

  test('utilización cercana a 0 (0,1 %): costo por hora muy alto pero finito', () => {
    const u = computeEquipmentUnit(hydroCrane({ utilizationPct: 0.1 }), { fuelPricePerLiter: 1500 });
    // horas usadas = 0,3
    approx(u.rates.costPerUsedHour, (OWNERSHIP + OPERATION_PER_HOUR * 0.3) / 0.3, '', 1e-3);
  });
});

describe('EquipmentEngine — línea de equipo en una cotización', () => {
  test('posesión → fijo mensual; operación → variable por día activo (× horas/día × cantidad)', () => {
    const line = computeEquipmentLine(hydroCrane({ quantity: 2, hoursPerActiveDay: 10 }), { fuelPricePerLiter: 1500 });
    approx(line.fixedMonthly, 2 * OWNERSHIP);
    approx(line.fixedCashMonthly, 2 * CASH_OWNERSHIP);
    // 20.000 $/h × 10 h × 2 equipos
    approx(line.nonFuelPerActiveDay, 400_000);
    // 18.000 $/h × 10 h × 2 equipos; 12 L/h × 10 h × 2 = 240 L
    approx(line.fuelPerActiveDay, 360_000);
    approx(line.fuelLitersPerActiveDay, 240);
    approx(line.variablePerActiveDay, 760_000);
  });

  test('sin horas por día propias, la línea usa las horas por día activo de la cotización', () => {
    const line = computeEquipmentLine(hydroCrane({ hoursPerActiveDay: null }), { fuelPricePerLiter: 1500, defaultHoursPerActiveDay: 8 });
    assert.equal(line.hoursPerActiveDay, 8);
    approx(line.variablePerActiveDay, OPERATION_PER_HOUR * 8);
  });

  test('0 horas por día explícitas se respetan (equipo reservado que no opera)', () => {
    const line = computeEquipmentLine(hydroCrane({ hoursPerActiveDay: 0 }), { fuelPricePerLiter: 1500, defaultHoursPerActiveDay: 8 });
    assert.equal(line.variablePerActiveDay, 0);
    approx(line.fixedMonthly, OWNERSHIP, 'la posesión se paga igual');
  });

  test('cantidad 0 → sin costo; negativos y vacíos nunca producen NaN', () => {
    const zero = computeEquipmentLine(hydroCrane({ quantity: 0, hoursPerActiveDay: 10 }), { fuelPricePerLiter: 1500 });
    assert.equal(zero.fixedMonthly, 0);
    assert.equal(zero.variablePerActiveDay, 0);
    for (const bad of ['', null, undefined, -1, 'abc', Number.NaN]) {
      const eq = Object.fromEntries(Object.entries(hydroCrane({ hoursPerActiveDay: 10 })).map(([k, v]) => [k, typeof v === 'number' ? bad : v]));
      const r = computeEquipmentLine(eq, { fuelPricePerLiter: bad, defaultHoursPerActiveDay: bad });
      for (const value of [r.fixedMonthly, r.fixedCashMonthly, r.variablePerActiveDay, r.fuelPerActiveDay]) {
        assert.ok(Number.isFinite(value), `con ${String(bad)} se obtuvo ${value}`);
      }
    }
  });

  test('strings numéricos dan el mismo resultado que números', () => {
    const asStrings = Object.fromEntries(Object.entries(hydroCrane({ hoursPerActiveDay: 10 })).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
    const a = computeEquipmentLine(asStrings, { fuelPricePerLiter: '1500' });
    const b = computeEquipmentLine(hydroCrane({ hoursPerActiveDay: 10 }), { fuelPricePerLiter: 1500 });
    approx(a.fixedMonthly, b.fixedMonthly);
    approx(a.variablePerActiveDay, b.variablePerActiveDay);
  });
});
