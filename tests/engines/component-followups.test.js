/**
 * Pendientes de los componentes del servicio (PLAN-2026-021):
 *   - insumos por unidad producida (m², m³, pieza…),
 *   - viáticos por personas × noches,
 *   - vehículo cargado sólo en "Movilización y viajes".
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeMaterialLine } from '../../js/engines/materials-engine.js';
import { autoOutputPerActiveDay } from '../../js/engines/cost-engine.js';
import { createEmptyQuote, defaultSettings, createVehicle } from '../../js/domain/quote-factory.js';
import { contractWithComponents, serviceTypeForContract } from '../../js/domain/contract.js';
import { lodgingFromDetail } from '../../js/domain/lodging.js';

const approx = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);

function base({ unit = 'm2', activity = {}, materials = [], contract = null } = {}) {
  const settings = { ...defaultSettings('org'), illustrative: false, defaultBillingTaxes: null };
  const q = createEmptyQuote({ organizationId: 'org', settings, now: '2026-11-07T00:00:00.000Z', id: 'q-f' });
  if (contract) {
    q.contract = contract;
    q.serviceType = serviceTypeForContract(contract);
  }
  q.unit = unit;
  q.pricingMode = 'known_rate';
  q.billingTaxes = { mode: 'combined', notApplicable: true, combinedPct: null, items: [] };
  q.finance.monthlyRatePct = 0;
  q.risk.generalPct = 0;
  q.logistics.notApplicable = true;
  q.fuel.requiresConfirmation = false;
  q.activity = { ...q.activity, ...activity };
  q.pricing = { ...q.pricing, knownRate: 5000, targetMarginPct: 15, roundingStep: 0 };
  q.indirect = { ...q.indirect, method: 'percent_direct', pct: 0 };
  q.materials = materials;
  q.otherCosts = [];
  return q;
}

const paint = (extra = {}) => ({ id: 'm1', description: 'Pintura', unit: 'L', basis: 'per_output', quantity: 0.25, unitCost: 8000, providedBy: 'contractor', wastePct: 0, logisticsPct: 0, ...extra });

describe('Insumos por unidad producida', () => {
  test('motor: costo por unidad × unidades por día', () => {
    const l = computeMaterialLine(paint(), { outputPerActiveDay: 120 });
    approx(l.grossCost, 2000, 'por m²');
    approx(l.variablePerActiveDay, 240000, 'por día');
    assert.equal(l.fixedMonthly, 0);
    const own = computeMaterialLine(paint({ outputPerActiveDay: 50 }), { outputPerActiveDay: 120 });
    approx(own.variablePerActiveDay, 100000, 'la producción propia de la línea manda');
  });

  test('cobrando por m²: usa los m² por día de "Cómo se cobra" y suma al mes', () => {
    const q = base({ activity: { billableQuantityPerMonth: 2400, unitsPerActiveDay: 120 }, materials: [paint()] });
    const r = computeQuote(q);
    approx(autoOutputPerActiveDay(r.activity), 120);
    const line = r.model.materials.lines[0];
    approx(line.variablePerActiveDay, 240000);
    // 2.400 m² al mes = 20 días × 120 m²/día → 0,25 L × $ 8.000 × 2.400 = $ 4.800.000
    approx(line.variablePerActiveDay * r.activity.activeDaysPerMonth, 4800000, 'mes');
    assert.ok(!r.completeness.items.some((i) => i.id === 'materials_output'));
  });

  test('cobrando por mes sin producción por día: pendiente que lleva al campo', () => {
    const q = base({ unit: 'month', activity: { activeDaysPerMonth: 20 }, materials: [paint()] });
    const r = computeQuote(q);
    const item = r.completeness.items.find((i) => i.id === 'materials_output');
    assert.ok(item && item.status === 'missing');
    assert.equal(item.focus, 'materials.0.outputPerActiveDay');
    const q2 = base({ unit: 'month', activity: { activeDaysPerMonth: 20 }, materials: [paint({ outputPerActiveDay: 80, outputUnit: 'm²' })] });
    const r2 = computeQuote(q2);
    assert.ok(!r2.completeness.items.some((i) => i.id === 'materials_output'));
    approx(r2.model.materials.lines[0].variablePerActiveDay, 160000);
  });

  test('las bases de siempre no cambian', () => {
    const m = { quantity: 2, unitCost: 100, providedBy: 'contractor' };
    approx(computeMaterialLine({ ...m, basis: 'per_month' }, { outputPerActiveDay: 999 }).fixedMonthly, 200);
    approx(computeMaterialLine({ ...m, basis: 'per_active_day' }, { outputPerActiveDay: 999 }).variablePerActiveDay, 200);
    approx(computeMaterialLine({ ...m, basis: 'per_activation' }, { daysPerActivation: 2, outputPerActiveDay: 999 }).variablePerActiveDay, 100);
  });
});

describe('Viáticos por personas y noches', () => {
  test('personas × noches × alojamiento + personas × días × comidas', () => {
    assert.equal(lodgingFromDetail({ people: 3, nights: 4, perNight: 30000, days: 5, perDay: 15000 }), 3 * 4 * 30000 + 3 * 5 * 15000);
    assert.equal(lodgingFromDetail({ people: 2, nights: 0, perNight: 30000, days: 1, perDay: 10000 }), 20000);
    assert.equal(lodgingFromDetail({}), 0);
    assert.equal(lodgingFromDetail({ people: -1, nights: 2, perNight: 1 }), 0);
  });
});

describe('Vehículo cargado sólo en Viajes', () => {
  const crewVehicle = contractWithComponents({ mode: 'on_demand' }, ['labor', 'vehicle', 'supplies']);
  test('con costo por km en Viajes: aviso, no pendiente crítico', () => {
    const q = base({ unit: 'day', contract: crewVehicle, activity: { activeDaysPerMonth: 10 } });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 50, vehicles: [{ ...createVehicle({ id: 'v', name: 'Camioneta' }), costPerKm: 120, consumptionLPer100Km: 12 }] };
    const r = computeQuote(q);
    const item = r.completeness.items.find((i) => i.id === 'equipment_cost');
    assert.equal(item.status, 'warning');
    assert.notEqual(item.severity, 'critical');
  });
  test('sin vehículo en Viajes sigue faltando el costo del vehículo', () => {
    const q = base({ unit: 'day', contract: crewVehicle, activity: { activeDaysPerMonth: 10 } });
    const item = computeQuote(q).completeness.items.find((i) => i.id === 'equipment_cost');
    assert.equal(item.status, 'missing');
  });
  test('con maquinaria además del vehículo, se exige Equipos como antes', () => {
    const q = base({ unit: 'day', contract: contractWithComponents({ mode: 'on_demand' }, ['labor', 'vehicle', 'machinery']), activity: { activeDaysPerMonth: 10 } });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 50, vehicles: [{ ...createVehicle({ id: 'v' }), costPerKm: 120 }] };
    assert.equal(computeQuote(q).completeness.items.find((i) => i.id === 'equipment_cost').status, 'missing');
  });
});
