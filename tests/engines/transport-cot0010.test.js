/**
 * PLAN-2026-012 — pulido desde casos reales de transporte (COT-0010 / COT-0011).
 *
 *  1. COT-0010 y COT-0011: los números del PDF, al peso.
 *  2. Viajes físicos: con la unidad "viaje" se derivan (viajes por día × días
 *     por intervención); 1, 2 o 3 viajes por día recorren los mismos km.
 *  3. Dato viejo inconsistente ("Viajes por llamado" distinto): se costean
 *     los viajes reales y se avisa; nunca un "completo" en silencio.
 *  4. Proveedor por km o por viaje sin ruta: CRÍTICO, nunca $ 0 como válido.
 *  5. Combustible: incluido → no pide consumo; a cargo nuestro por L/100 km o
 *     km/L sobre los km físicos; propio por L/h sin cambios; provisto por el
 *     cliente → sin costo.
 *  6. Recursos compartidos: % EXPLÍCITO de los costos fijos (personal y
 *     equipos propios); las variables siguen el uso.
 *  7. "Usado en", equilibrio sin costos fijos y confirmaciones (unidad de
 *     materiales, HE 50 / 100 ya existían).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { buildCostModel } from '../../js/engines/cost-engine.js';
import { computeExternalLine } from '../../js/engines/external-engine.js';
import { computeLaborLine } from '../../js/engines/labor-engine.js';
import { computeEquipmentLine } from '../../js/engines/equipment-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { routeTrips, traceTransport } from '../../js/engines/transport-engine.js';
import { fixedCostShareOf } from '../../js/domain/assignment.js';
import { resourceUsage } from '../../js/domain/resource-usage.js';
import { applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { validateQuote } from '../../js/core/validation.js';
import { MATERIAL_UNIT_PRESETS } from '../../js/domain/catalogs.js';
import { breakEvenZeroText } from '../../js/ui/result-text.js';
import { fieldFromHash, fieldHref } from '../../js/ui/field-links.js';
import { cot0010Quote, cot0011Quote, transportQuote } from '../fixtures/cot-0010.js';

const approx = (actual, expected, label = '', tol = 0.01) => {
  assert.ok(Number.isFinite(actual), `${label}: no es finito (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: esperado ${expected}, obtenido ${actual}`);
};
const row = (r, category) => r.eecc.rows.find((x) => x.category === category).amount;

describe('COT-0010 / COT-0011: los números del PDF (golden)', () => {
  for (const [label, quote, days] of [['COT-0010', cot0010Quote(), 12], ['COT-0011', cot0011Quote(), 6]]) {
    test(`${label}: costo, piso, objetivo, sugerida, resultado y equilibrio`, () => {
      const r = computeQuote(quote);
      const k = r.kpis;
      approx(k.activeDays, days, 'días de trabajo');
      approx(row(r, 'labor'), 3280036, 'personal');
      approx(row(r, 'external'), 7800000, 'proveedor (2.400 km × $ 3.250)');
      approx(row(r, 'structure'), 886402.88, 'estructura 8 %');
      approx(row(r, 'financial'), 523345.36, 'financiero');
      approx(row(r, 'contingency'), 374693.53, 'contingencia 3 %');
      approx(k.totalCost, 12864477.77, 'costo total');
      approx(k.floorListRate, 1128462.96, 'tarifa piso');
      approx(k.targetListRate, 1261223.31, 'precio objetivo');
      assert.equal(k.suggestedListRate, 1262000);
      approx(k.revenue, 15144000, 'facturación');
      approx(k.billingTaxes, 757200, 'impuestos 5 %');
      approx(k.profit, 1522322.23, 'resultado');
      approx(k.marginPct, 10.0523, 'margen', 1e-4);
      approx(k.breakEvenQuantity, 8.5524, 'equilibrio en viajes', 1e-4);
      // Combustible incluido en la tarifa: no se inventa consumo.
      assert.equal(r.completeness.scorePct, 100);
    });
  }
});

describe('viajes físicos con la unidad "viaje" (P0)', () => {
  test('1, 2 y 3 viajes por día: mismos km y mismo costo del proveedor por km (aunque "Viajes por llamado" quede en 1)', () => {
    const results = [1, 2, 3].map((perDay) => computeQuote(transportQuote({ tripsPerDay: perDay, tripsPerActivation: 1 })));
    results.forEach((r, i) => {
      const t = r.model.transport;
      assert.equal(t.derived, true);
      approx(t.physicalTripsPerMonth, 12, `viajes físicos (${i + 1}/día)`);
      approx(t.routeKmPerMonth, 2400, `km por mes (${i + 1}/día)`);
      approx(row(r, 'external'), 7800000, `proveedor (${i + 1}/día)`);
      approx(r.kpis.totalCost, 12864477.77, `costo (${i + 1}/día)`);
      assert.equal(r.kpis.suggestedListRate, 1262000);
    });
    approx(results[0].kpis.activeDays, 12);
    approx(results[1].kpis.activeDays, 6);
    approx(results[2].kpis.activeDays, 4);
  });

  test('viajes por intervención = viajes por día × días por intervención (no se asume intervención = viaje ni día = viaje)', () => {
    const q = transportQuote({ tripsPerDay: 2 });
    q.activity.daysPerActivation = 3; // salidas de 3 días con 2 viajes por día
    const r = computeQuote(q);
    const t = r.model.transport;
    approx(t.physicalTripsPerActivation, 6);
    approx(t.activationsPerMonth, 2);
    approx(t.physicalTripsPerMonth, 12);
    approx(t.routeKmPerMonth, 2400);
    approx(row(r, 'external'), 7800000);
  });

  test('estado intermedio de COT-0011 (1 viaje por llamado): antes 6 viajes y $ 3.900.000; ahora los 12 reales y un aviso', () => {
    const q = cot0011Quote({ tripsPerActivation: 1 });
    const r = computeQuote(q);
    approx(r.model.transport.physicalTripsPerMonth, 12);
    approx(row(r, 'external'), 7800000);
    assert.equal(r.kpis.suggestedListRate, 1262000);
    assert.equal(r.model.transport.storedDiffers, true);
    const notice = r.completeness.notices.find((n) => n.id === 'transport_trips');
    assert.ok(notice, 'aviso informativo del dato anterior');
    assert.match(notice.message, /2 × 1 día = 2/);
    // PLAN-2026-014 (LAB-D8): en transporte la activación se llama "salida".
    assert.match(notice.message, /1 por salida\) ya no se usa/);
    // El dato guardado no se toca.
    assert.equal(q.logistics.tripsPerActivation, 1);
  });

  test('otras unidades (m³, día…) siguen usando "Viajes por llamado" (sin cambios)', () => {
    const q = transportQuote({ tripsPerDay: 2 });
    q.unit = 'day';
    q.activity.activeDaysPerMonth = 6;
    q.logistics.tripsPerActivation = 1;
    const route = routeTrips(q, { daysPerActivation: 1, unitsPerActiveDay: null });
    assert.equal(route.derived, false);
    assert.equal(route.tripsPerActivation, 1);
    const r = computeQuote(q);
    approx(r.model.transport.routeKmPerMonth, 6 * 200);
  });

  test('con mínimo por llamado, se costean los viajes que se hacen (no los que factura el mínimo)', () => {
    const q = transportQuote({ tripsPerDay: 1 });
    q.rules = { ...q.rules, minimumCallUnits: 3 };
    const t = computeQuote(q).model.transport;
    approx(t.activationsPerMonth, 4);
    approx(t.physicalTripsPerMonth, 4);
    assert.equal(t.minimumPadding, true);
  });

  test('"Ver cálculo" del transporte: facturables ÷ por día = días; físicos × km = km; km × $/km = proveedor', () => {
    const trace = traceTransport(computeQuote(cot0011Quote()).model.transport);
    const step = (re) => trace.steps.find((s) => re.test(s.label));
    approx(step(/^Días de trabajo/).value, 6);
    approx(step(/^Viajes físicos por mes/).value, 12);
    approx(step(/^Km de ruta por mes/).value, 2400);
    approx(step(/km × tarifa neta × cantidad/).value, 7800000);
    approx(trace.result.value, 2400);
  });
});

describe('proveedor por km o por viaje sin ruta (P1): crítico, nunca $ 0 válido', () => {
  for (const [label, mutate, focus] of [
    ['sin distancia', (q) => { q.logistics.distanceKm = 0; }, 'logistics.distanceKm'],
    ['"Sin traslados"', (q) => { q.logistics.notApplicable = true; }, 'logistics.notApplicable'],
    ['sin viajes por día', (q) => { q.activity.unitsPerActiveDay = 0; }, 'activity.unitsPerActiveDay'],
  ]) {
    test(label, () => {
      const q = cot0010Quote();
      mutate(q);
      const r = computeQuote(q);
      const item = r.completeness.items.find((i) => i.id === 'external_route');
      assert.ok(item, 'pendiente de ruta');
      assert.equal(item.severity, 'critical');
      assert.match(item.message, /Falta definir la ruta\/distancia para calcular este proveedor/);
      assert.equal(item.focus, focus);
      assert.ok(r.completeness.critical >= 1);
      assert.ok(r.completeness.scorePct < 100);
      const provider = r.model.transport.providers[0];
      assert.equal(provider.noRoute, true, 'la línea se marca sin ruta (no un $ 0 válido)');
    });
  }

  test('con un mínimo facturable no es un faltante (la tarifa se calcula con el mínimo)', () => {
    const q = cot0010Quote();
    q.logistics.distanceKm = 0;
    q.equipment[0].external.minimumUnits = 100;
    assert.equal(evaluateCompleteness(q).items.some((i) => i.id === 'external_route'), false);
  });
});

describe('combustible (P0 / P1)', () => {
  test('(a) externo con combustible incluido: no pide consumo, combustible "No aplica" y el pendiente desaparece', () => {
    const fuel = evaluateCompleteness(cot0010Quote()).items.find((i) => i.id === 'fuel');
    assert.equal(fuel.status, 'ok');
    assert.match(fuel.message, /No aplica/);
  });

  test('(b) externo cuyo combustible pagamos, por L/100 km: 2.400 km × 35 L/100 km = 840 L, separado de la tarifa y sin duplicar', () => {
    const q = cot0010Quote();
    Object.assign(q.equipment[0].external, { fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 });
    // Aunque "vaya por sus medios", la ruta ya está en su consumo por km.
    q.equipment[0].mobilization = { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 0, driver: 'operator' };
    q.equipment[0].external.mobilizationIncluded = false;
    q.equipment[0].external.mobilizationAmount = 0;
    const r = computeQuote(q);
    const x = r.model.external[0];
    approx(x.fuelLitersPerActivationRoute * r.activity.activationsPerMonth, 840, 'litros por mes');
    approx(row(r, 'fuel'), 840 * 1500, 'combustible (va a Combustible)');
    approx(row(r, 'external'), 7800000, 'la tarifa no cambia');
    approx(r.model.mobilization.fuelPerActivation, 0, 'sin combustible duplicado en la movilización');
    const item = r.completeness.items.find((i) => i.id === 'fuel');
    assert.equal(item.status, 'ok');
  });

  test('(b2) por rendimiento km/L: mismo resultado que L/100 km equivalente', () => {
    const q = cot0010Quote();
    Object.assign(q.equipment[0].external, { fuelIncluded: false, fuelMode: 'km_per_liter', fuelKmPerLiter: 2.5 });
    approx(row(computeQuote(q), 'fuel'), (2400 / 2.5) * 1500);
  });

  test('(b3) por km sin consumo cargado: falta el consumo y lleva al campo exacto', () => {
    const q = cot0010Quote();
    Object.assign(q.equipment[0].external, { fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 0 });
    const item = evaluateCompleteness(q).items.find((i) => i.id === 'fuel');
    assert.equal(item.status, 'missing');
    assert.equal(item.focus, 'equipment.0.external.fuelLitersPer100Km');
    assert.equal(item.step, 'equipment');
  });

  test('(c) equipo propio por L/h: igual que siempre', () => {
    const line = { quantity: 1, hoursPerActiveDay: 10, fuelLitersPerHour: 12, replacementValue: 100, usefulLifeYears: 1 };
    const out = computeEquipmentLine(line, { fuelPricePerLiter: 1500 });
    approx(out.fuelPerActiveDay, 12 * 10 * 1500);
    approx(out.fuelLitersPerActiveDay, 120);
  });

  test('(c2) externo por L/h (sin elegir modo): igual que siempre', () => {
    const x = computeExternalLine({ quantity: 1, hoursPerActiveDay: 8, acquisition: 'rented', external: { price: 900000, unit: 'day', fuelIncluded: false, fuelLitersPerHour: 12 } }, { daysPerActivation: 1, fuelPricePerLiter: 1500, routeKmPerActivation: 200 });
    approx(x.fuelPerActiveDay, 12 * 8 * 1500);
    assert.equal(x.fuelPerActivationRoute, 0);
  });

  test('(d) provisto por el cliente: sin costo de combustible y sin pendiente', () => {
    const q = cot0010Quote();
    Object.assign(q.equipment[0].external, { fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 });
    q.fuel.providedBy = 'client';
    const r = computeQuote(q);
    approx(row(r, 'fuel'), 0);
    const item = r.completeness.items.find((i) => i.id === 'fuel');
    assert.equal(item.status, 'ok');
    assert.match(item.message, /Lo provee el cliente/);
  });

  test('equipo propio sin consumo: falta el consumo y el botón lleva a su campo (no a un paso genérico)', () => {
    const q = cot0010Quote();
    q.equipment.push({ id: 'own', name: 'Camioneta propia', acquisition: 'owned', quantity: 1, replacementValue: 50000000, usefulLifeYears: 5, fuelLitersPerHour: 0, base: { period: '2026-10', currency: 'ARS', source: 'company', note: '' } });
    const item = evaluateCompleteness(q).items.find((i) => i.id === 'fuel');
    assert.equal(item.status, 'missing');
    assert.equal(item.focus, 'equipment.1.fuelLitersPerHour');
    assert.equal(fieldHref('q1', item.focus), '#/cotizaciones/q1/equipment?campo=equipment.1.fuelLitersPerHour');
  });

  test('el enlace "?campo=" sólo acepta rutas de campo (lista blanca)', () => {
    assert.equal(fieldFromHash('#/cotizaciones/x/logistics?campo=logistics.distanceKm'), 'logistics.distanceKm');
    for (const bad of ['?campo=<img>', '?campo=a..b', '?campo=.a', `?campo=${'a'.repeat(130)}`, '?campo=a%20b', '']) assert.equal(fieldFromHash(bad), null, bad);
  });
});

describe('recursos compartidos: % explícito de los costos fijos (P1)', () => {
  test('personal: 100 % y 25 % → $ 3.280.036 y $ 820.009; horas extra y viandas no se reducen', () => {
    const base = { ...cot0010Quote().labor[0], overtime: [{ id: 'o', label: 'HE 50 %', premiumPct: 50, hours: 2, basis: 'per_active_day' }], mealPerActiveDay: 10000 };
    const full = computeLaborLine(base);
    const shared = computeLaborLine({ ...base, assignment: 'shared', fixedCostSharePct: 25 });
    approx(full.fixedMonthly, 3280036);
    approx(shared.fixedMonthly, 820009);
    approx(shared.unassignedFixedMonthly, 3280036 - 820009);
    approx(shared.variablePerActiveDay, full.variablePerActiveDay, 'HE por día y viandas siguen el uso');
    assert.ok(full.variablePerActiveDay > 0);
    // Dedicada o contratada para el servicio = 100 %.
    approx(computeLaborLine({ ...base, assignment: 'dedicated' }).fixedMonthly, 3280036);
    approx(computeLaborLine({ ...base, assignment: 'hired' }).fixedMonthly, 3280036);
  });

  test('personal: las horas extra POR MES tampoco se reducen', () => {
    const line = { ...cot0010Quote().labor[0], overtime: [{ id: 'o', label: 'HE 100 %', premiumPct: 100, hours: 10, basis: 'per_month' }] };
    const full = computeLaborLine(line);
    const shared = computeLaborLine({ ...line, assignment: 'shared', fixedCostSharePct: 25 });
    const otMonthly = full.perPerson.overtimeMonthly;
    assert.ok(otMonthly > 0);
    approx(shared.fixedMonthly, 3280036 * 0.25 + otMonthly);
  });

  test('en la cotización: el costo del personal baja al 25 % y lo demás sigue igual', () => {
    const q = cot0010Quote();
    q.labor[0].assignment = 'shared';
    q.labor[0].fixedCostSharePct = 25;
    const r = computeQuote(q);
    approx(row(r, 'labor'), 820009);
    approx(row(r, 'external'), 7800000);
    const notice = r.completeness.notices.find((n) => n.id === 'shared_fixed');
    assert.ok(notice);
    assert.match(notice.message, /75/);
  });

  test('equipo propio: posesión $ 5.000.000 al 100 % y al 30 % ($ 1.500.000); la operación es la misma', () => {
    const eq = { quantity: 1, replacementValue: 600000000, residualValue: 0, usefulLifeYears: 10, hoursPerActiveDay: 8, fuelLitersPerHour: 10, maintenancePerHour: 5000 };
    const full = computeEquipmentLine(eq, { fuelPricePerLiter: 1500 });
    const shared = computeEquipmentLine({ ...eq, assignment: 'shared', fixedCostSharePct: 30 }, { fuelPricePerLiter: 1500 });
    approx(full.fixedMonthly, 5000000);
    approx(shared.fixedMonthly, 1500000);
    approx(shared.unassignedFixedMonthly, 3500000);
    approx(shared.variablePerActiveDay, full.variablePerActiveDay, 'variables iguales');
    approx(computeEquipmentLine({ ...eq, assignment: 'reserved' }, { fuelPricePerLiter: 1500 }).fixedMonthly, 5000000, 'reservado = 100 %');
  });

  test('sin dato, compartido sin %, % inválido: 100 % (nunca se esconde costo) y la validación lo marca', () => {
    assert.equal(fixedCostShareOf({}).sharePct, 100);
    assert.equal(fixedCostShareOf({ assignment: 'shared' }).sharePct, 100);
    assert.equal(fixedCostShareOf({ assignment: 'shared' }).missing, true);
    assert.equal(fixedCostShareOf({ assignment: 'shared', fixedCostSharePct: 0 }).sharePct, 100);
    assert.equal(fixedCostShareOf({ assignment: 'shared', fixedCostSharePct: 150 }).sharePct, 100);
    assert.equal(fixedCostShareOf({ assignment: 'shared', fixedCostSharePct: '25,5' }).sharePct, 25.5);
    const q = cot0010Quote();
    q.labor[0].assignment = 'shared';
    assert.ok(validateQuote(q).some((i) => i.path === 'labor.0.fixedCostSharePct' && i.severity === 'error'));
    q.labor[0].fixedCostSharePct = 120;
    assert.ok(validateQuote(q).some((i) => i.path === 'labor.0.fixedCostSharePct' && i.severity === 'error'));
    q.labor[0].fixedCostSharePct = 25;
    assert.equal(validateQuote(q).some((i) => i.path === 'labor.0.fixedCostSharePct'), false);
  });

  test('un externo no se reparte (se paga por uso) y la estructura por empleado usa la dotación equivalente', () => {
    const q = cot0010Quote();
    q.equipment[0].assignment = 'shared';
    q.equipment[0].fixedCostSharePct = 30;
    approx(row(computeQuote(q), 'external'), 7800000, 'externo sin cambios');
    const p = cot0010Quote();
    p.indirect = { method: 'per_employee', pct: 0, amount: 100000 };
    approx(buildCostModel(p).structure.fixedMonthly, 100000);
    p.labor[0].assignment = 'shared';
    p.labor[0].fixedCostSharePct = 25;
    approx(buildCostModel(p).structure.fixedMonthly, 25000);
  });

  test('"Actualizar desde Recursos" conserva la asignación (es de la cotización, no del recurso)', () => {
    const profile = { id: 'p1', role: 'Coordinador logístico', basicMonthly: 2000000, normalHoursPerMonth: 176, sacPct: 8.33, vacationPct: 4.17, employerContributionsPct: 24, artPct: 3 };
    const line = { id: 'l1', role: 'Coordinador logístico', positions: 1, peoplePerPosition: 1, basicMonthly: 1000000, assignment: 'shared', fixedCostSharePct: 25, snapshot: { resourceType: 'laborProfiles', resourceId: 'p1', values: {} } };
    const next = applyResourceUpdate('labor', line, { laborProfiles: [profile], agreements: [] }, { now: '2026-10-16T00:00:00.000Z', currency: 'ARS' });
    assert.equal(next.basicMonthly, 2000000);
    assert.equal(next.assignment, 'shared');
    assert.equal(next.fixedCostSharePct, 25);
  });
});

describe('"Usado en" (P1): cotizaciones, % asignado y aviso sobre el 100 %', () => {
  const linked = (extra = {}) => ({ id: 'l', positions: 1, peoplePerPosition: 1, snapshot: { resourceType: 'laborProfiles', resourceId: 'P' }, ...extra });
  const quote = (id, status, lines) => ({ id, code: id.toUpperCase(), name: `Cot ${id}`, status, labor: lines, equipment: [] });

  test('adjudicadas = compromiso, borrador / enviada = potencial, perdidas y archivadas no cuentan', () => {
    const quotes = [
      quote('a', 'won', [linked({ assignment: 'shared', fixedCostSharePct: 60 })]),
      quote('b', 'won', [linked({ assignment: 'shared', fixedCostSharePct: 50 })]),
      quote('c', 'draft', [linked()]),
      quote('d', 'sent', [linked({ sourceId: 'P', snapshot: null })]),
      quote('e', 'lost', [linked()]),
      quote('f', 'archived', [linked()]),
      quote('g', 'won', [{ id: 'x', positions: 1, snapshot: { resourceId: 'OTRO' } }]),
    ];
    const u = resourceUsage('laborProfiles', 'P', quotes);
    assert.equal(u.quotesCount, 4);
    approx(u.committedPct, 110);
    approx(u.potentialPct, 200);
    assert.equal(u.overCommitted, true, 'más del 100 % adjudicado: se avisa (no se bloquea)');
    assert.equal(u.rows.find((r) => r.quoteId === 'd').group, 'potential');
  });

  test('personas y unidades multiplican el %; un externo se lista sin %', () => {
    const quotes = [
      { id: 'a', status: 'won', labor: [linked({ positions: 2 })], equipment: [] },
      { id: 'b', status: 'draft', labor: [], equipment: [{ id: 'e', acquisition: 'outsourced', quantity: 1, snapshot: { resourceType: 'externalServices', resourceId: 'S' } }] },
    ];
    approx(resourceUsage('laborProfiles', 'P', quotes).committedPct, 200);
    const ext = resourceUsage('externalServices', 'S', quotes);
    assert.equal(ext.rows.length, 1);
    assert.equal(ext.rows[0].assignedPct, null);
    assert.equal(ext.committedPct, 0);
  });

  test('sin cotizaciones o con datos raros: vacío, sin romper', () => {
    assert.deepEqual(resourceUsage('laborProfiles', 'P', null).rows, []);
    assert.deepEqual(resourceUsage('materials', 'P', []).rows, []);
    assert.deepEqual(resourceUsage('laborProfiles', 'P', [null, 'x', { status: 'won', labor: 'x' }]).rows, []);
  });
});

describe('equilibrio sin costos fijos (P1)', () => {
  test('sin fijos: "Desde el primer viaje" y "Sin costos fijos: cada viaje vendido cubre su costo variable."', () => {
    const q = cot0010Quote();
    q.labor = [];
    const r = computeQuote(q);
    assert.equal(r.breakEven.reachable, true);
    approx(r.breakEven.days, 0);
    assert.equal(r.breakEven.zeroReason, 'no_fixed_costs');
    assert.equal(r.kpis.breakEvenZeroReason, 'no_fixed_costs');
    assert.equal(breakEvenZeroText(r, { compact: true }), 'Desde el primer viaje');
    assert.match(breakEvenZeroText(r), /^Sin costos fijos: cada viaje vendido cubre su costo variable\. Desde el primer viaje hay contribución positiva\.$/);
  });

  test('con fijos que cubren los ingresos fijos (abono): otro texto, nunca "sin costos fijos"', () => {
    const q = cot0010Quote();
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 1300000;
    q.rules = { ...q.rules, availabilityFeeMonthly: 10000000 };
    const r = computeQuote(q);
    approx(r.breakEven.days, 0);
    assert.equal(r.breakEven.zeroReason, 'fixed_revenue');
    assert.equal(breakEvenZeroText(r, { compact: true }), 'Cubierto con ingresos fijos');
    assert.match(breakEvenZeroText(r), /los ingresos fijos \(abono, equipo en espera\) ya cubren los costos fijos/);
  });

  test('con fijos y sin ingresos fijos: el equilibrio de siempre (sin motivo de cero)', () => {
    const r = computeQuote(cot0010Quote());
    assert.equal(r.breakEven.zeroReason, undefined);
    assert.equal(breakEvenZeroText(r), null);
  });
});

describe('ya estaban en main (sólo se confirma)', () => {
  test('unidad visible de materiales: hay unidades habituales para elegir', () => {
    for (const u of ['unidad', 'kg', 'L', 'm³']) assert.ok(MATERIAL_UNIT_PRESETS.includes(u), `falta ${u}`);
  });

  test('horas extra HE 50 % y HE 100 %: tramos con su recargo', () => {
    const line = { positions: 1, peoplePerPosition: 1, basicMonthly: 1760000, normalHoursPerMonth: 176, overtime: [{ label: 'HE 50 %', premiumPct: 50, hours: 1, basis: 'per_active_day' }, { label: 'HE 100 %', premiumPct: 100, hours: 1, basis: 'per_active_day' }] };
    const out = computeLaborLine(line);
    approx(out.overtimeItems[0].hourlyCost, 10000 * 1.5);
    approx(out.overtimeItems[1].hourlyCost, 10000 * 2);
  });
});
