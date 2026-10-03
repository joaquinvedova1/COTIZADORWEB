/**
 * Contrato del negocio — LogisticsEngine (traslados base ↔ locación).
 *
 * Reglas (Prompt 1 "Logística y base", Prompt 3 "Logística"):
 *   km por viaje = distancia × 2 (ida y vuelta) o × 1 (sólo ida)
 *   km de ruta por activación = km por viaje × viajes por activación
 *   por vehículo: km = km de ruta × cantidad; litros = km × consumo (L/100 km) / 100
 *   costo por activación = combustible + desgaste por km + peajes + viáticos
 *   costo mensual = costo por activación × activaciones por mes
 *   costo por día activo = costo por activación / días por activación
 *
 * Caso demo ILUSTRATIVO: Neuquén Capital → Añelo, 110 km, ida y vuelta, 1 viaje por activación,
 * hidrogrúa (35 L/100 km, 150 $/km) + vehículo de apoyo (12 L/100 km, 80 $/km), gasoil 1.500 $/L,
 * 4 activaciones/mes de 2 días.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLogistics } from '../../js/engines/logistics-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

function anelo(overrides = {}) {
  return {
    notApplicable: false,
    distanceKm: 110,
    roundTrip: true,
    tripsPerActivation: 1,
    vehicles: [
      { id: 'v1', name: 'Hidrogrúa', count: 1, consumptionLPer100Km: 35, costPerKm: 150 },
      { id: 'v2', name: 'Apoyo', count: 1, consumptionLPer100Km: 12, costPerKm: 80 },
    ],
    tollsPerActivation: 0,
    lodgingPerActivation: 0,
    ...overrides,
  };
}

const CTX = { activationsPerMonth: 4, daysPerActivation: 2, fuelPricePerLiter: 1500, fuelPaidByUs: true };

describe('LogisticsEngine — kilómetros y litros', () => {
  test('ida y vuelta: km por viaje = distancia × 2 (110 km → 220 km)', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.kmPerTrip, 220);
    approx(r.routeKmPerActivation, 220);
  });

  test('sólo ida: km por viaje = distancia', () => {
    const r = computeLogistics(anelo({ roundTrip: false }), CTX);
    approx(r.kmPerTrip, 110);
  });

  test('km = distancia × 2 × viajes: 2 viajes por activación → 440 km de ruta', () => {
    const r = computeLogistics(anelo({ tripsPerActivation: 2 }), CTX);
    approx(r.routeKmPerActivation, 440);
  });

  test('km de vehículos = km de ruta × cantidad de vehículos (2 vehículos × 220 km = 440 km)', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.vehicleKmPerActivation, 440);
    const doubled = computeLogistics(anelo({ vehicles: [{ id: 'x', count: 2, consumptionLPer100Km: 35, costPerKm: 150 }] }), CTX);
    approx(doubled.vehicles[0].kmPerActivation, 440);
  });

  test('litros = km × consumo / 100: 220 × 35 / 100 = 77 L y 220 × 12 / 100 = 26,4 L', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.vehicles[0].litersPerActivation, 77);
    approx(r.vehicles[1].litersPerActivation, 26.4);
    approx(r.litersPerActivation, 103.4);
  });
});

describe('LogisticsEngine — costos', () => {
  test('costo por activación = combustible + desgaste = 155.100 + 50.600 = 205.700', () => {
    // combustible: 77 × 1.500 = 115.500 + 26,4 × 1.500 = 39.600 → 155.100
    // desgaste: 220 × 150 = 33.000 + 220 × 80 = 17.600 → 50.600
    const r = computeLogistics(anelo(), CTX);
    approx(r.fuelPerActivation, 155_100);
    approx(r.wearPerActivation, 50_600);
    approx(r.costPerActivation, 205_700);
  });

  test('peajes y viáticos por activación se suman al costo no combustible', () => {
    const r = computeLogistics(anelo({ tollsPerActivation: 10_000, lodgingPerActivation: 50_000 }), CTX);
    approx(r.nonFuelPerActivation, 50_600 + 60_000);
    approx(r.costPerActivation, 205_700 + 60_000);
  });

  test('costo mensual = costo por activación × activaciones (205.700 × 4 = 822.800)', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.monthlyCost, 822_800);
    approx(r.fuelMonthly, 155_100 * 4);
    approx(r.kmPerMonth, 440 * 4);
    approx(r.litersPerMonth, 103.4 * 4);
  });

  test('costo por día activo = costo por activación / días por activación (205.700 / 2 = 102.850)', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.perActiveDay, 102_850);
    approx(r.fuelPerActiveDay, 155_100 / 2);
    approx(r.nonFuelPerActiveDay, 50_600 / 2);
  });

  test('costo por día activo × días activos coincide con el costo mensual (8 días = 4 activaciones × 2)', () => {
    const r = computeLogistics(anelo(), CTX);
    approx(r.perActiveDay * 8, r.monthlyCost);
  });

  test('si el combustible lo provee el cliente, se cobra sólo el desgaste', () => {
    const r = computeLogistics(anelo(), { ...CTX, fuelPaidByUs: false });
    assert.equal(r.fuelPerActivation, 0);
    approx(r.litersPerActivation, 103.4, 'los litros se informan igual');
    approx(r.costPerActivation, 50_600);
  });

  test('"sin traslados" anula km y costos aunque haya distancia y vehículos cargados', () => {
    const r = computeLogistics(anelo({ notApplicable: true }), CTX);
    assert.equal(r.routeKmPerActivation, 0);
    assert.equal(r.costPerActivation, 0);
    assert.equal(r.monthlyCost, 0);
    assert.equal(r.vehicles.length, 0);
  });
});

describe('LogisticsEngine — valores inválidos', () => {
  test('distancia negativa o vacía → 0 km y costo 0', () => {
    for (const d of [-110, '', null, undefined, 'abc']) {
      const r = computeLogistics(anelo({ distanceKm: d }), CTX);
      assert.equal(r.routeKmPerActivation, 0, `distancia ${String(d)}`);
      assert.equal(r.costPerActivation, 0);
    }
  });

  test('strings numéricos se interpretan como números', () => {
    const r = computeLogistics(anelo({ distanceKm: '110', tripsPerActivation: '1', vehicles: [{ count: '1', consumptionLPer100Km: '35', costPerKm: '150' }] }), { ...CTX, fuelPricePerLiter: '1500' });
    approx(r.costPerActivation, 115_500 + 33_000);
  });

  test('días por activación 0 → costo por día 0 (nunca Infinity); sin activaciones → costo mensual 0', () => {
    const r = computeLogistics(anelo(), { ...CTX, daysPerActivation: 0, activationsPerMonth: 0 });
    assert.equal(r.perActiveDay, 0);
    assert.equal(r.monthlyCost, 0);
  });

  test('logística vacía o sin vehículos no produce NaN', () => {
    for (const lg of [{}, undefined, { vehicles: null }, { vehicles: [{}] }]) {
      const r = computeLogistics(lg, CTX);
      for (const value of [r.costPerActivation, r.monthlyCost, r.perActiveDay, r.litersPerMonth]) {
        assert.ok(Number.isFinite(value));
      }
    }
  });
});
