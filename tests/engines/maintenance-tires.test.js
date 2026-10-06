/**
 * Mantenimiento y neumáticos con forma de carga (PLAN-2026-007).
 *
 * - Mantenimiento: por hora, service cada N horas (= $/h) o presupuesto
 *   mensual / anual (= costo FIJO de tenencia, nunca dividido por horas).
 * - Neumáticos: por hora, juego + vida útil en horas (= $/h) o juego + vida
 *   útil en km (= $/km, sólo en la ruta).
 * - Sin forma de carga = por hora: los datos anteriores calculan igual.
 * - Avisos de sentido común: no bloquean ni corrigen valores.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeOwnership, computeOperation, computeEquipmentLine, maintenanceOf, tiresOf, equipmentChecks } from '../../js/engines/equipment-engine.js';
import { computeMobilization } from '../../js/engines/mobilization-engine.js';
import { snapshotValuesFromLine, economicFingerprint, changedKeys } from '../../js/domain/resource-snapshot.js';
import { equipmentLineFromLibrary, createEmptyQuote } from '../../js/domain/quote-factory.js';
import { buildCostModel, costAtActivity } from '../../js/engines/cost-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';

const ids = (warnings) => warnings.map((w) => w.id);
// El autoelevador del caso real: $ 3.000.000 cargados como "por hora".
const autoelevador = { name: 'AUTOELEVADOR', replacementValue: 100000000, residualValue: 20000000, usefulLifeYears: 6, insuranceAnnual: 5000000, maintenancePerHour: 3000000, tiresPerHour: 0, fuelLitersPerHour: 0 };

describe('mantenimiento: formas de carga', () => {
  test('A. por hora (sin forma de carga = como siempre): el autoelevador sigue en $ 3.000.000/h', () => {
    assert.deepEqual(maintenanceOf(autoelevador), { mode: 'per_hour', perHour: 3000000, fixedMonthly: 0 });
    const op = computeOperation(autoelevador, { fuelPricePerLiter: 1500 });
    assert.equal(op.maintenancePerHour, 3000000);
    assert.equal(op.totalPerHour, 3000000);
    assert.equal(computeEquipmentLine({ ...autoelevador, quantity: 1, hoursPerActiveDay: 8 }, { fuelPricePerLiter: 1500 }).variablePerActiveDay, 24000000);
  });

  test('B. service $ 600.000 cada 250 h = $ 2.400 por hora de uso', () => {
    const eq = { maintenanceMode: 'service', maintenanceServiceCost: 600000, maintenanceServiceHours: 250, maintenancePerHour: 3000000 };
    assert.equal(maintenanceOf(eq).perHour, 2400);
    assert.equal(computeOperation(eq).maintenancePerHour, 2400, 'el valor por hora guardado antes no se usa en modo service');
    assert.equal(computeOwnership(eq).maintenanceFixedMonthly, 0);
  });

  test('C. presupuesto $ 3.000.000/mes o $ 36.000.000/año = $ 3.000.000 por mes de costo FIJO, $ 0 por hora', () => {
    for (const eq of [
      { maintenanceMode: 'budget', maintenanceBudget: 3000000, maintenanceBudgetPeriod: 'month' },
      { maintenanceMode: 'budget', maintenanceBudget: 36000000, maintenanceBudgetPeriod: 'year' },
    ]) {
      const own = computeOwnership(eq);
      assert.equal(own.maintenanceFixedMonthly, 3000000);
      assert.equal(own.cashMonthly, 3000000);
      assert.equal(own.totalMonthly, 3000000);
      assert.equal(computeOperation(eq).maintenancePerHour, 0, 'nunca se divide por horas');
    }
    assert.equal(maintenanceOf({ maintenanceMode: 'budget', maintenanceBudget: 1200 }).budgetPeriod, 'month', 'sin período = mensual');
  });

  test('en una cotización: el presupuesto es fijo mensual (no depende de los días activos) y no suma por día', () => {
    const base = { quantity: 1, hoursPerActiveDay: 8, replacementValue: 0 };
    const line = computeEquipmentLine({ ...base, maintenanceMode: 'budget', maintenanceBudget: 3000000 });
    assert.equal(line.fixedMonthly, 3000000);
    assert.equal(line.variablePerActiveDay, 0);
    const two = computeEquipmentLine({ ...base, quantity: 2, maintenanceMode: 'budget', maintenanceBudget: 3000000 });
    assert.equal(two.fixedMonthly, 6000000, 'por unidad');
  });

  test('casos extremos: service sin horas o vacío, negativos, modo desconocido', () => {
    assert.equal(maintenanceOf({ maintenanceMode: 'service', maintenanceServiceCost: 600000, maintenanceServiceHours: 0 }).perHour, 0);
    assert.equal(maintenanceOf({ maintenanceMode: 'service' }).perHour, 0);
    assert.equal(maintenanceOf({ maintenanceMode: 'budget', maintenanceBudget: -5 }).fixedMonthly, 0);
    assert.deepEqual(maintenanceOf({ maintenanceMode: 'otro', maintenancePerHour: 10 }), { mode: 'per_hour', perHour: 10, fixedMonthly: 0 });
    assert.ok(Number.isFinite(computeOwnership({ maintenanceMode: 'budget', maintenanceBudget: 'abc' }).totalMonthly));
  });
});

describe('neumáticos: formas de carga', () => {
  test('A. por hora (sin forma de carga = como siempre)', () => {
    assert.deepEqual(tiresOf({ tiresPerHour: 1500 }), { mode: 'per_hour', perHour: 1500, perKm: 0 });
  });

  test('B. juego $ 2.400.000 / 3.000 h = $ 800 por hora de uso', () => {
    const eq = { tiresMode: 'set_hours', tiresSetCost: 2400000, tiresLifeHours: 3000 };
    assert.equal(tiresOf(eq).perHour, 800);
    assert.equal(computeOperation(eq).tiresPerHour, 800);
  });

  test('C. juego $ 2.400.000 / 80.000 km = $ 30 por km: se suma en la ruta, no por hora', () => {
    const eq = { tiresMode: 'set_km', tiresSetCost: 2400000, tiresLifeKm: 80000, tiresPerHour: 999 };
    assert.equal(tiresOf(eq).perKm, 30);
    assert.equal(computeOperation(eq).tiresPerHour, 0);
    const line = { id: 'a', name: 'Camión', quantity: 1, ...eq, mobilization: { mode: 'self', driver: 'operator', travelLitersPer100Km: 0, travelCostPerKm: 150 } };
    const m = computeMobilization([line], { routeKmPerActivation: 100, daysPerActivation: 1, fuelPricePerLiter: 1500 });
    // 100 km × ($ 150 mantenimiento en ruta + $ 30 neumáticos) = $ 18.000 por llamado.
    assert.equal(m.lines[0].wearPerActivation, 18000);
    assert.equal(m.lines[0].tiresPerKm, 30);
  });

  test('sin juego por km, el desgaste en ruta es el de siempre', () => {
    const line = { id: 'a', quantity: 2, mobilization: { mode: 'self', driver: 'operator', travelLitersPer100Km: 0, travelCostPerKm: 150 } };
    assert.equal(computeMobilization([line], { routeKmPerActivation: 100 }).lines[0].wearPerActivation, 30000);
  });
});

describe('avisos de sentido común (no bloquean ni corrigen)', () => {
  test('el autoelevador: 100 h de mantenimiento cuestan más que el equipo → aviso', () => {
    assert.deepEqual(ids(equipmentChecks(autoelevador)), ['maintenance_per_hour_high']);
  });

  test('alto pero no absurdo: en 1.000 h supera el valor del equipo → aviso más suave', () => {
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, maintenancePerHour: 150000 })), ['maintenance_per_hour_elevated']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, maintenancePerHour: 8000 })), []);
  });

  test('service, presupuesto y neumáticos', () => {
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, maintenanceMode: 'service', maintenanceServiceCost: 600000 })), ['service_hours_missing']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, maintenanceMode: 'service', maintenanceServiceCost: 600000, maintenanceServiceHours: 0.5 })), ['maintenance_per_hour_high']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 30000000, usefulLifeYears: 5, maintenanceMode: 'budget', maintenanceBudget: 3000000 })), ['maintenance_budget_high']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, tiresPerHour: 2000000 })), ['tires_per_hour_high']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, tiresMode: 'set_hours', tiresSetCost: 2400000 })), ['tires_life_missing']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 100000000, usefulLifeYears: 5, tiresMode: 'set_km', tiresSetCost: 2400000, tiresLifeKm: 10 })), ['tires_per_km_high']);
  });

  test('residual > reposición y vida útil 0', () => {
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 15000000, residualValue: 20000000, usefulLifeYears: 6 })), ['residual_over_replacement']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 15000000, usefulLifeYears: 0 })), ['useful_life_missing']);
    assert.deepEqual(ids(equipmentChecks({ replacementValue: 15000000 })), ['useful_life_missing']);
  });

  test('valor de reposición en otra moneda sin tipo de cambio: no se comparan montos', () => {
    assert.deepEqual(ids(equipmentChecks(autoelevador, { comparable: false })), []);
  });

  test('sin valor de reposición o vacío: sin avisos de proporción; nunca lanza', () => {
    assert.deepEqual(ids(equipmentChecks({ maintenancePerHour: 3000000 })), []);
    assert.deepEqual(equipmentChecks(null), []);
    // No corrige: el valor queda como estaba.
    const eq = { ...autoelevador };
    equipmentChecks(eq);
    assert.equal(eq.maintenancePerHour, 3000000);
  });
});

describe('snapshot: los datos anteriores no cambian de huella', () => {
  test('sin forma de carga, los valores del snapshot no tienen la clave nueva (no hay avisos falsos)', () => {
    const line = equipmentLineFromLibrary({ id: 'eq1', ...autoelevador });
    const values = snapshotValuesFromLine('equipment', line);
    assert.equal('wear' in values, false);
    // Una línea vieja (sin los campos nuevos) y una nueva por hora tienen la misma huella.
    const old = { ...line };
    ['maintenanceMode', 'maintenanceServiceCost', 'maintenanceServiceHours', 'maintenanceBudget', 'maintenanceBudgetPeriod', 'tiresMode', 'tiresSetCost', 'tiresLifeHours', 'tiresLifeKm'].forEach((k) => delete old[k]);
    assert.equal(economicFingerprint(snapshotValuesFromLine('equipment', old)), economicFingerprint(values));
  });

  test('si en Recursos pasa a "service", la cotización lo detecta como cambio', () => {
    const before = snapshotValuesFromLine('equipment', equipmentLineFromLibrary({ id: 'eq1', ...autoelevador }));
    const after = snapshotValuesFromLine('equipment', equipmentLineFromLibrary({ id: 'eq1', ...autoelevador, maintenanceMode: 'service', maintenanceServiceCost: 600000, maintenanceServiceHours: 250 }));
    assert.notEqual(economicFingerprint(before), economicFingerprint(after));
    assert.ok(changedKeys(before, after).includes('wear'));
  });

  test('la línea copia la forma de carga del recurso', () => {
    const line = equipmentLineFromLibrary({ id: 'eq1', maintenanceMode: 'budget', maintenanceBudget: 36000000, maintenanceBudgetPeriod: 'year', tiresMode: 'set_km', tiresSetCost: 2400000, tiresLifeKm: 80000 });
    assert.equal(line.maintenanceMode, 'budget');
    assert.equal(line.maintenanceBudgetPeriod, 'year');
    assert.equal(line.tiresLifeKm, 80000);
    assert.equal(computeEquipmentLine({ ...line, quantity: 1 }).fixedMonthly, 3000000);
  });
});

describe('on-call: los costos fijos NO dependen de los días trabajados (15 días ≠ 50 % del fijo)', () => {
  // Equipo propio con todos los fijos de tenencia y todos los variables por uso.
  const vactor = {
    name: 'Vactor', replacementValue: 300000000, residualValue: 60000000, usefulLifeYears: 10,
    insuranceAnnual: 6000000, licenseAnnual: 1200000, certificationsAnnual: 2400000, capitalRatePctAnnual: 12,
    maintenanceMode: 'budget', maintenanceBudget: 1500000, maintenanceBudgetPeriod: 'month',
    tiresMode: 'set_hours', tiresSetCost: 9000000, tiresLifeHours: 3000, fuelLitersPerHour: 15,
  };
  function onCallQuote(activeDaysPerMonth) {
    const q = createEmptyQuote({ id: 'q-oncall', now: '2026-10-01T00:00:00.000Z' });
    q.serviceType = 'on_call';
    q.pricingMode = 'known_activity';
    q.activity = { ...q.activity, activeDaysPerMonth, availableDaysPerMonth: 30, hoursPerActiveDay: 10 };
    q.fuel = { ...q.fuel, pricePerLiter: 1500, providedBy: 'contractor' };
    q.equipment = [equipmentLineFromLibrary(vactor, { id: 'l1', hoursPerActiveDay: 10, now: '2026-10-01T00:00:00.000Z' })];
    return q;
  }

  test('amortización, seguro, patente, certificaciones, mantenimiento por presupuesto y costo de capital: el mes completo con 1, 15 o 30 días', () => {
    const own = computeOwnership(vactor);
    const expectedFixed = own.depreciationMonthly + own.insuranceMonthly + own.licenseMonthly + own.certificationsMonthly + own.maintenanceFixedMonthly + own.capitalCostMonthly;
    assert.ok(expectedFixed > 0);
    const fixedAt = (D) => buildCostModel(onCallQuote(D)).lines.filter((l) => l.key.startsWith('equipment:ownership')).reduce((s, l) => s + l.fixedMonthly, 0);
    for (const D of [1, 15, 30]) assert.ok(Math.abs(fixedAt(D) - expectedFixed) < 1e-6, `${D} días: ${fixedAt(D)} ≠ ${expectedFixed}`);
    const k15 = computeQuote(onCallQuote(15)).kpis;
    const k30 = computeQuote(onCallQuote(30)).kpis;
    assert.equal(k15.fixedCosts, k30.fixedCosts, '15 días cargan el 100 % del fijo mensual, no el 50 %');
  });

  test('combustible, neumáticos por hora y operación sí dependen del uso: 30 días = 2 × 15 días', () => {
    const at = (D) => costAtActivity(buildCostModel(onCallQuote(D)), D);
    const v15 = at(15).variable;
    const v30 = at(30).variable;
    assert.ok(v15 > 0);
    assert.ok(Math.abs(v30 - 2 * v15) < 1e-6, `${v30} ≠ 2 × ${v15}`);
    assert.equal(at(15).fixed, at(30).fixed);
  });
});
