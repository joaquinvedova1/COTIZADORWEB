/**
 * Tanda A de correcciones (informe auditado de 5 especialistas, 2026-11,
 * docs/informes/2026-11-especialistas-auditado.md §5): A-1, A-3, A-5, A-8,
 * A-13, A-14 y A-15. Cada test falló antes de la corrección (AGENTS.md §10).
 *
 * Regla de la tanda: ningún número de una cotización existente cambia, salvo
 * el total del contrato en precio cerrado (A-1), que estaba mal. Todo lo nuevo
 * es opcional con un default que reproduce el comportamiento anterior.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { computeMobilization } from '../../js/engines/mobilization-engine.js';
import { materialsResaleOf } from '../../js/engines/economics-engine.js';
import { buildCostModel } from '../../js/engines/cost-engine.js';
import { applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { service, person, owned, material, resetIds } from '../lab/lib/build.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const item = (q, id) => evaluateCompleteness(q).items.find((x) => x.id === id);
const notice = (r, id) => r.completeness.notices.find((n) => n.id === id);

/** Cotización de los especialistas: 2x1 C3, cuadrilla de 3 personas en diagrama 2x1, precio cerrado de 45 días. */
const fixture = JSON.parse(readFileSync(new URL('../fixtures/especialista-2x1-c3.json', import.meta.url), 'utf8'));
const c3 = () => structuredClone(fixture.quote);
const run = (q) => computeQuote(q, { settings: fixture.settings });

/** Precio cerrado mínimo: una persona y un otro costo fijo, con la unidad y la actividad dadas. */
function closedQuote({ unit = 'job', activity = {}, contractJobs, contract = { mode: 'closed', components: ['labor'] } } = {}) {
  resetIds();
  const q = service({
    id: 'a1', serviceType: 'lump_sum', unit, pricingMode: 'known_activity',
    activity: { billableQuantityPerMonth: 1, daysPerActivation: 10, hoursPerActiveDay: 8, ...activity },
    labor: [person({ role: 'Soldador', positions: 2 })],
  });
  q.contract = contract;
  if (contractJobs !== undefined) q.contractJobs = contractJobs;
  return q;
}

describe('A-1 · Precio cerrado: el total es por trabajo, nunca × meses de contrato', () => {
  test('2x1 C3 (45 días, 1 trabajo): "Total del trabajo" = facturación del trabajo (202.222.000), no × 12', () => {
    const r = run(c3());
    const c = priceComposition(r);
    assert.equal(r.contract.mode, 'closed');
    assert.equal(c.contract.mode, 'closed');
    assert.equal(c.contract.months, null);
    assert.equal(c.contract.jobs, 1);
    close(c.contract.jobsPerMonth, 1);
    close(c.contract.revenue, 202_222_000);
    close(c.contract.revenue, r.kpis.revenue);
    close(c.contract.cost, r.estimate.cost.total);
    close(c.contract.billingTaxes, r.estimate.billingTaxes);
    close(c.contract.profit, r.estimate.profit);
    // Antes: 202.222.000 × 12 = 2.426.664.000 (número falso).
    assert.ok(c.contract.revenue < 2_426_664_000 / 2);
  });

  test('los números del mes no cambian (sólo el total del contrato estaba mal)', () => {
    const r = run(c3());
    const c = priceComposition(r);
    close(c.revenue, 202_222_000);
    close(r.kpis.revenue, 202_222_000);
    assert.equal(r.ctx.contractMonths, 12, 'la duración cargada sigue guardada (descuento por continuidad)');
  });

  test('quote.contractJobs (opcional): total de la obra = un trabajo × trabajos', () => {
    const q = c3();
    q.contractJobs = 3;
    const c = priceComposition(run(q));
    assert.equal(c.contract.jobs, 3);
    close(c.contract.revenue, 202_222_000 * 3);
    // Vacío, 0 o inválido = 1.
    for (const v of [null, '', 0, -2, 'x']) {
      const q2 = c3();
      q2.contractJobs = v;
      close(priceComposition(run(q2)).contract.revenue, 202_222_000);
    }
  });

  test('dos trabajos por mes: el total de un trabajo es el mes ÷ 2', () => {
    const q = closedQuote({ activity: { billableQuantityPerMonth: 2, daysPerActivation: 5 } });
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 10_000_000;
    const r = computeQuote(q, { settings: {} });
    const c = priceComposition(r);
    close(r.kpis.revenue, 20_000_000);
    close(c.contract.jobsPerMonth, 2);
    close(c.contract.revenue, 10_000_000);
    close(c.contract.cost, r.estimate.cost.total / 2);
    close(c.contract.profit, r.estimate.profit / 2);
  });

  test('por hito: el total del trabajo = tarifa × hitos de un trabajo', () => {
    const q = closedQuote({ unit: 'milestone', activity: { billableQuantityPerMonth: 4, unitsPerActivation: 4, daysPerActivation: 20 } });
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 2_500_000;
    const r = computeQuote(q, { settings: {} });
    const c = priceComposition(r);
    close(c.contract.jobsPerMonth, 1);
    close(c.contract.unitsPerJob, 4);
    close(c.contract.revenue, 2_500_000 * 4);
  });

  test('1,5 trabajos por mes con cobro de movilización por trabajo: total = tarifa + movilización (× trabajos de la obra)', () => {
    const q = closedQuote({ activity: { billableQuantityPerMonth: 1.5, daysPerActivation: 10 }, contractJobs: 2 });
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 10_000_000;
    q.rules = { ...(q.rules || {}), mobilizationFeePerActivation: 1_000_000 };
    const r = computeQuote(q, { settings: {} });
    const c = priceComposition(r);
    close(r.kpis.revenue, 1.5 * 11_000_000);
    close(c.contract.jobsPerMonth, 1.5);
    close(c.contract.revenue, 2 * 11_000_000);
    close(c.contract.cost, (r.estimate.cost.total / 1.5) * 2);
    close(c.contract.revenue, c.contract.cost + c.contract.billingTaxes + c.contract.profit);
  });

  test('trabajo más largo que los días disponibles: 1 trabajo, sin × meses (fijos × monthsFactor en el costo)', () => {
    const q = closedQuote({ activity: { billableQuantityPerMonth: 1, daysPerActivation: 45 } });
    const r = computeQuote(q, { settings: {} });
    const c = priceComposition(r);
    close(r.estimate.cost.monthsFactor, 1.5);
    close(c.contract.jobsPerMonth, 1);
    close(c.contract.revenue, r.kpis.revenue);
    close(c.contract.cost, r.estimate.cost.total);
  });

  test('cotización anterior sin contrato (lump_sum): también es precio cerrado', () => {
    const q = closedQuote();
    delete q.contract;
    const r = computeQuote(q, { settings: {} });
    assert.equal(r.contract.mode, 'closed');
    const c = priceComposition(r);
    assert.equal(c.contract.months, null);
    close(c.contract.revenue, r.kpis.revenue);
  });

  test('fijo mensual y on call: el total del contrato sigue siendo el mes × meses', () => {
    resetIds();
    const q = service({ serviceType: 'on_call', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()], pricing: { knownRate: 3_000_000 } });
    q.contract = { mode: 'on_demand', components: ['labor'] };
    const r = computeQuote(q, { settings: {} });
    const c = priceComposition(r);
    assert.equal(c.contract.mode, 'months');
    assert.equal(c.contract.months, 12);
    close(c.contract.revenue, r.kpis.revenue * 12);
    q.contractJobs = 5; // no aplica fuera de precio cerrado
    close(priceComposition(computeQuote(q, { settings: {} })).contract.revenue, r.kpis.revenue * 12);
  });
});

describe('A-3 · Remolque arrastrado ("va enganchado y rueda")', () => {
  const tractor = { id: 'tr', name: 'Tractor', acquisition: 'owned', quantity: 1, tiresMode: 'set_km', tiresSetCost: 9_500_000, tiresLifeKm: 100_000, mobilization: { mode: 'self', travelLitersPer100Km: 45, travelCostPerKm: 220, driver: 'operator' } };
  const trailer = (m = {}) => ({ id: 'ca', name: 'Carretón', acquisition: 'owned', quantity: 1, tiresMode: 'set_km', tiresSetCost: 8_400_000, tiresLifeKm: 120_000, mobilization: { mode: 'transported', carrierLineId: 'tr', ...m } });
  const ctx = { routeKmPerActivation: 1280, daysPerActivation: 2, fuelPricePerLiter: 1500, fuelPaidByUs: true };

  test('sin marcar (default) = cargado arriba: no suma nada, como siempre', () => {
    const m = computeMobilization([tractor, trailer()], ctx);
    assert.equal(m.lines[1].towed, false);
    assert.equal(m.lines[1].km, 0);
    assert.equal(m.lines[1].perActivation, 0);
    assert.equal(m.lines[1].wearPerActivation, 0);
  });

  test('enganchado: km × (desgaste por km + neumáticos por km), sin combustible ni conductor', () => {
    const m = computeMobilization([tractor, trailer({ towed: true })], ctx);
    const l = m.lines[1];
    assert.equal(l.towed, true);
    close(l.km, 1280);
    close(l.wearPerActivation, 89_600); // 1.280 km × 70 $/km
    assert.equal(l.liters, 0);
    assert.equal(l.fuelPerActivation, 0);
    assert.equal(l.driver, null);
    assert.ok(!l.warnings.includes('driver'));
    close(l.perActiveDay, 89_600 / 2);
    // Con mantenimiento por km propio del remolque.
    close(computeMobilization([tractor, trailer({ towed: true, travelCostPerKm: 30 })], ctx).lines[1].wearPerActivation, 1280 * 100);
    // Cantidad 2: el doble de km.
    close(computeMobilization([tractor, { ...trailer({ towed: true }), quantity: 2 }], ctx).lines[1].km, 2560);
  });

  test('la completitud avisa (sin cambiar nada) si un remolque con neumáticos por km no está marcado', () => {
    resetIds();
    const q = service({
      serviceType: 'equipment_with_operator', unit: 'job', activity: { billableQuantityPerMonth: 1, daysPerActivation: 2, hoursPerActiveDay: 8 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ ...tractor, operatorLaborId: 'op', fuelLitersPerHour: 10 }), owned({ ...trailer(), fuelNotApplicable: true })],
      logistics: { notApplicable: false, distanceKm: 640, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
    const it = item(q, 'mobility');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /"Carretón"/);
    assert.match(it.message, /Va enganchado y rueda/);
    assert.equal(it.focus, 'equipment.1.mobilization.towed');
    q.equipment[1].mobilization.towed = true;
    assert.equal(item(q, 'mobility').status, 'ok');
    // Elegido explícitamente "Va cargado arriba" (false): la pregunta queda respondida y no se suma desgaste.
    q.equipment[1].mobilization.towed = false;
    assert.equal(item(q, 'mobility').status, 'ok');
    delete q.equipment[1].mobilization.towed;
    assert.equal(item(q, 'mobility').status, 'warning');
  });

  test('Ver cálculo de movilización: el remolque enganchado aparece con su desgaste (sin combustible)', () => {
    resetIds();
    const q = service({
      serviceType: 'equipment_with_operator', unit: 'job', activity: { billableQuantityPerMonth: 1, daysPerActivation: 2, hoursPerActiveDay: 8 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ ...tractor, operatorLaborId: 'op', fuelLitersPerHour: 10 }), owned({ ...trailer({ towed: true }), fuelNotApplicable: true })],
      logistics: { notApplicable: false, distanceKm: 640, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
    const r = computeQuote(q, { settings: {} });
    const step = r.traces.logistics.steps.find((s) => /Carretón/.test(s.label));
    assert.ok(step, 'el carretón enganchado figura en los pasos');
    assert.match(step.label, /enganchado/);
    close(step.value, 89_600);
    // Neumáticos por km del carretón sólo en la movilización: su operación en Equipos no los cuenta por hora.
    assert.equal(r.model.equipment[1].operation.tiresPerHour, 0);
  });

  test('en la cotización: +89.600 por trabajo de desgaste del carretón', () => {
    resetIds();
    const q = service({
      serviceType: 'equipment_with_operator', unit: 'job', activity: { billableQuantityPerMonth: 1, daysPerActivation: 2, hoursPerActiveDay: 8 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ ...tractor, operatorLaborId: 'op', fuelLitersPerHour: 10 }), owned({ ...trailer(), fuelNotApplicable: true })],
      logistics: { notApplicable: false, distanceKm: 640, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
    const before = computeQuote(structuredClone(q), { settings: {} });
    q.equipment[1].mobilization.towed = true;
    const after = computeQuote(q, { settings: {} });
    close(after.model.mobilization.wearPerActivation - before.model.mobilization.wearPerActivation, 89_600);
    assert.ok(after.kpis.totalCost > before.kpis.totalCost);
  });
});

describe('A-5 · Aviso de horas del personal', () => {
  const quote = ({ D = 20, H = 12, ppp = 1, coverage, available = 30, positions = 1, overtime = 0 } = {}) => {
    resetIds();
    return service({
      serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: D, availableDaysPerMonth: available, hoursPerActiveDay: H },
      labor: [person({ role: 'Operario', positions, peoplePerPosition: ppp, overtimeHoursPerActiveDay: overtime, ...(coverage !== undefined ? { coverageHoursPerDay: coverage } : {}) })],
    });
  };

  test('D > días disponibles: las horas por mes se prorratean (2x1 de 45 días ya no da un aviso falso)', () => {
    // 45 días × 12 h = 540 h; 1,6667 × 176 h × 1,5 meses + 4 h × 45 = 620 h → alcanza.
    assert.equal(item(c3(), 'labor_hours'), undefined);
    // Sin prorrateo (antes) habría pedido 540 h contra 473 h. Con 1 persona sí falta: 540 > 176 × 1,5 = 264.
    const it = item(quote({ D: 45, H: 12 }), 'labor_hours');
    assert.ok(it);
    assert.match(it.message, /45 días × 12 h = 540 h/);
    assert.match(it.message, /lo cargado cubre 264 h \(1 persona × 176 h normales por mes × 1,5 meses\)/);
    assert.match(it.message, /más que los 30 días disponibles/);
    // D ≤ disponibles: igual que siempre.
    assert.match(item(quote({ D: 20, H: 12 }), 'labor_hours').message, /lo cargado cubre 176 h \(1 persona × 176 h normales por mes\)\./);
  });

  test('"Horas por día que cubre este puesto": un turno de 12 h en una actividad de 24 h', () => {
    // 24 h con 2 personas por posición: 20 × 24 = 480 > 352 → aviso.
    assert.ok(item(quote({ H: 24, ppp: 2 }), 'labor_hours'));
    // El puesto cubre 12 h (turno día): 20 × 12 = 240 ≤ 352 → sin aviso.
    assert.equal(item(quote({ H: 24, ppp: 2, coverage: 12 }), 'labor_hours'), undefined);
    // Con 1 persona y 12 h propias: 240 > 176 → aviso con el dato del puesto.
    const it = item(quote({ H: 24, ppp: 1, coverage: 12 }), 'labor_hours');
    assert.match(it.message, /20 días × 12 h \(horas por día que cubre este puesto\) = 240 h/);
    // Vacío o 0 = las horas de la actividad.
    assert.match(item(quote({ H: 24, ppp: 1, coverage: null }), 'labor_hours').message, /20 días × 24 h = 480 h/);
    assert.match(item(quote({ H: 24, ppp: 1, coverage: 0 }), 'labor_hours').message, /20 días × 24 h = 480 h/);
  });

  test('el mensaje sugiere también sumar posiciones (turno día / turno noche)', () => {
    assert.match(item(quote({ H: 24 }), 'labor_hours').message, /o sumá posiciones \(turno día \/ turno noche\)/);
  });

  test('el dato del puesto sólo lo usa el aviso: el costo no cambia', () => {
    const a = computeQuote(quote({ H: 24 }), { settings: {} });
    const b = computeQuote(quote({ H: 24, coverage: 12 }), { settings: {} });
    assert.equal(a.kpis.totalCost, b.kpis.totalCost);
    assert.equal(a.model.labor.fixedMonthly, b.model.labor.fixedMonthly);
  });

  test('al actualizar el puesto desde Recursos se conserva (es un dato de la cotización)', () => {
    const line = { id: 'l1', role: 'Operario', positions: 1, coverageHoursPerDay: 12, snapshot: { resourceType: 'laborProfiles', resourceId: 'p1' } };
    const resources = { laborProfiles: [{ id: 'p1', role: 'Operario', basicMonthly: 2_000_000 }] };
    const next = applyResourceUpdate('labor', line, resources, { now: '2026-11-07T00:00:00.000Z' });
    assert.equal(next.basicMonthly, 2_000_000, 'tomó los valores del recurso');
    assert.equal(next.coverageHoursPerDay, 12);
    const mat = applyResourceUpdate('materials', { id: 'm1', description: 'Pintura', billedSeparately: true, snapshot: { resourceId: 'r1' } }, { materials: [{ id: 'r1', description: 'Pintura', unitCost: 5000 }] }, { now: '2026-11-07T00:00:00.000Z' });
    assert.equal(mat.unitCost, 5000, 'tomó los valores del recurso');
    assert.equal(mat.billedSeparately, true);
  });
});

describe('A-8 · Facturar materiales aparte por línea', () => {
  const quote = ({ global = false, a, b } = {}) => {
    resetIds();
    return service({
      serviceType: 'time_materials', unit: 'hour', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
      labor: [person()],
      pricing: { knownRate: 100_000, materialsBilledSeparately: global },
      materials: [
        material({ description: 'Pintura', quantity: 1, unitCost: 1_000_000, resaleMarkupPct: 20, ...(a !== undefined ? { billedSeparately: a } : {}) }),
        material({ description: 'Electrodos', basis: 'per_active_day', quantity: 1, unitCost: 50_000, resaleMarkupPct: 10, ...(b !== undefined ? { billedSeparately: b } : {}) }),
      ],
    });
  };
  const resale = (q) => {
    const r = computeQuote(q, { settings: {} });
    const c = r.estimate.revenue.components;
    return { r, billed: c.materialsFixed + c.materialsVariable };
  };

  test('sin definir sigue al tilde global (como siempre)', () => {
    assert.equal(resale(quote()).billed, 0);
    assert.equal(materialsResaleOf(quote(), buildCostModel(quote())), null);
    close(resale(quote({ global: true })).billed, 1_200_000 + 10 * 55_000);
  });

  test('por línea: sólo suman a reventa las que se facturan aparte', () => {
    close(resale(quote({ global: false, a: true })).billed, 1_200_000);
    close(resale(quote({ global: false, b: true })).billed, 550_000);
    close(resale(quote({ global: true, a: false })).billed, 550_000);
    close(resale(quote({ global: true, a: false, b: false })).billed, 0);
    close(resale(quote({ global: true, b: true })).billed, 1_750_000);
  });

  test('siguen siendo costo: el costo no cambia, sólo la facturación', () => {
    const a = computeQuote(quote(), { settings: {} });
    const b = computeQuote(quote({ a: true }), { settings: {} });
    assert.equal(a.kpis.totalCost, b.kpis.totalCost);
    close(b.kpis.revenue - a.kpis.revenue, 1_200_000);
  });

  test('reparto de la tarifa: fila separada "Materiales facturados aparte" con su costo; la suma no cambia', () => {
    const r = computeQuote(quote({ a: true }), { settings: {} });
    const c = priceComposition(r);
    const sep = c.rows.find((x) => x.key === 'materials_billed');
    const mat = c.rows.find((x) => x.key === 'materials');
    assert.ok(sep, 'fila propia');
    close(sep.amount, 1_000_000);
    const eeccMaterials = r.eecc.rows.find((x) => x.category === 'materials').amount;
    close(mat.amount + sep.amount, eeccMaterials);
    assert.ok(c.allChecksOk, 'los números cierran');
    close(c.rows.reduce((s, x) => s + x.amount, 0), c.revenue);
    // Sin materiales facturados aparte no hay fila nueva (como siempre).
    assert.equal(priceComposition(computeQuote(quote(), { settings: {} })).rows.find((x) => x.key === 'materials_billed'), undefined);
  });
});

describe('A-13 · El aviso de fecha base lleva al campo del primer valor sin fecha', () => {
  test('personal sin fecha: paso Personal y foco en el mes del sueldo', () => {
    resetIds();
    const q = service({ serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person({ base: { period: null } })] });
    const it = item(q, 'economic_base');
    assert.equal(it.status, 'warning');
    assert.equal(it.step, 'labor');
    assert.equal(it.focus, 'labor.0.base.period');
  });
  test('equipo propio con los costos sin fecha: foco en costsBase.period', () => {
    resetIds();
    const q = service({ serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()], equipment: [owned({ costsBase: { period: null } })] });
    const it = item(q, 'economic_base');
    assert.equal(it.step, 'equipment');
    assert.equal(it.focus, 'equipment.0.costsBase.period');
  });
  test('todo con fecha: sin foco, en Contrato (como siempre)', () => {
    resetIds();
    const it = item(service({ serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()] }), 'economic_base');
    assert.equal(it.status, 'ok');
    assert.equal(it.focus, undefined);
  });
});

describe('A-14 · Consumo en ruta faltante en la completitud', () => {
  const quote = (m = {}, fuel = {}) => {
    resetIds();
    return service({
      serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ name: 'Hidrogrúa', operatorLaborId: 'op', fuelLitersPerHour: 12, mobilization: { mode: 'self', travelLitersPer100Km: 0, travelCostPerKm: 100, driver: 'operator', ...m } })],
      logistics: { notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
      fuel,
    });
  };
  test('por sus propios medios sin L/100 km: aviso en "Movilización de equipos" con foco en el campo', () => {
    const it = item(quote(), 'mobility');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /Falta el consumo en ruta de "Hidrogrúa": el combustible del traslado queda en 0/);
    assert.equal(it.focus, 'equipment.0.mobilization.travelLitersPer100Km');
    assert.equal(item(quote({ travelLitersPer100Km: 35 }), 'mobility').status, 'ok');
  });
  test('si el combustible lo provee el cliente, no se pide', () => {
    assert.equal(item(quote({}, { providedBy: 'client' }), 'mobility').status, 'ok');
  });
});

describe('A-15 · Avisos informativos nuevos (no bajan el puntaje)', () => {
  test('(a) precio cerrado: informa los costos fijos que absorbe el precio, sin aplicar ningún % solo', () => {
    const q = c3();
    const r = run(q);
    const n = notice(r, 'fixed_costs_absorbed');
    assert.ok(n);
    assert.equal(n.severity, 'info');
    assert.match(n.message, /este precio absorbe \$\s?[\d.]+ de costos fijos de 1,5 meses/);
    assert.match(n.message, /asignales un % compartido/);
    assert.match(n.message, /RATEOS no lo aplica solo/);
    // El personal del 2x1 C3 está "contratado para este servicio": no se comparte con otras obras,
    // así que no entra en el aviso (revisión de costos). Sólo la tenencia de los equipos propios.
    assert.equal(q.labor[0].assignment, 'hired');
    assert.equal(n.focus, 'equipment.0.assignment');
    close(n.laborFixed, 0);
    close(n.amount, r.model.equipment.filter((e) => e.acquisition === 'owned').reduce((s, e) => s + e.fixedMonthly, 0) * 1.5);
    close(n.amount, 2_390_000);
    // Dedicado: el sueldo del mes también se informa.
    const dedicated = c3();
    dedicated.labor.forEach((l) => { l.assignment = 'dedicated'; });
    const rd = run(dedicated);
    const nd = notice(rd, 'fixed_costs_absorbed');
    assert.equal(nd.focus, 'labor.0.assignment');
    close(nd.amount, (rd.model.labor.lines[0].fixedMonthly + rd.model.equipment.filter((e) => e.acquisition === 'owned').reduce((s, e) => s + e.fixedMonthly, 0)) * 1.5);
    // Con todos compartidos no hay nada que informar.
    const shared = c3();
    shared.labor.forEach((l) => { l.assignment = 'shared'; l.fixedCostSharePct = 40; });
    shared.equipment.forEach((e) => { e.assignment = 'shared'; e.fixedCostSharePct = 40; });
    assert.equal(notice(run(shared), 'fixed_costs_absorbed'), undefined);
  });

  test('(a) "contratada para este servicio" no entra; "compartida" sin % válido (cargada al 100 %) sí', () => {
    resetIds();
    const q = service({ serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 }, labor: [person({ role: 'A' }), person({ role: 'B' })] });
    q.contract = { mode: 'on_demand', components: ['labor'] };
    q.labor[0].assignment = 'hired';
    q.labor[1].assignment = 'shared';
    q.labor[1].fixedCostSharePct = null;
    const r = computeQuote(q, { settings: {} });
    const n = notice(r, 'fixed_costs_absorbed');
    assert.ok(n);
    close(n.amount, r.model.labor.lines[1].fixedMonthly);
    assert.deepEqual(n.targets.map((t) => t.index), [1]);
    assert.equal(n.focus, 'labor.1.assignment');
    // Con un % válido ya está compartida: sólo queda la contratada, que no se informa.
    q.labor[1].fixedCostSharePct = 50;
    assert.equal(notice(computeQuote(q, { settings: {} }), 'fixed_costs_absorbed'), undefined);
  });

  test('(a) on call con menos días que los disponibles también; fijo mensual no (el abono cubre el mes)', () => {
    resetIds();
    const q = service({ serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 }, labor: [person()] });
    q.contract = { mode: 'on_demand', components: ['labor'] };
    const r = computeQuote(q, { settings: {} });
    const n = notice(r, 'fixed_costs_absorbed');
    assert.ok(n);
    assert.match(n.message, /^Trabajás 8 de 30 días disponibles: este precio absorbe/);
    close(n.amount, r.model.labor.lines[0].fixedMonthly);
    q.contract = { mode: 'monthly', components: ['labor'] };
    q.unit = 'month';
    assert.equal(notice(computeQuote(q, { settings: {} }), 'fixed_costs_absorbed'), undefined);
    q.contract = { mode: 'on_demand', components: ['labor'] };
    q.unit = 'day';
    q.activity.activeDaysPerMonth = 30;
    assert.equal(notice(computeQuote(q, { settings: {} }), 'fixed_costs_absorbed'), undefined);
  });

  test('(a) informativo: no cambia el puntaje ni el costo', () => {
    const r = run(c3());
    const q = c3();
    q.labor.forEach((l) => { l.assignment = 'shared'; l.fixedCostSharePct = 100; });
    assert.equal(r.completeness.scorePct, evaluateCompleteness(c3()).scorePct);
    assert.ok(!r.completeness.items.some((x) => x.id === 'fixed_costs_absorbed'));
    assert.ok(!r.completeness.pending.some((x) => x.id === 'fixed_costs_absorbed'));
  });

  test('(b) personas no enteras: pregunta cuántas hay en nómina', () => {
    resetIds();
    const q = service({ serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person({ role: 'Operario', positions: 3, peoplePerPosition: 1.5 })] });
    const n = evaluateCompleteness(q).notices.find((x) => x.id === 'labor_fractional_headcount');
    assert.ok(n);
    assert.equal(n.severity, 'info');
    assert.match(n.message, /Cargaste 4,5 personas en "Operario"/);
    assert.match(n.message, /¿cuántas hay en nómina\?/);
    assert.equal(n.focus, 'labor.0.peoplePerPosition');
    // 3 × 1,6667 ≈ 5 (5 ÷ 3 con decimales): no se pregunta.
    q.labor[0].peoplePerPosition = 1.6667;
    assert.equal(evaluateCompleteness(q).notices.find((x) => x.id === 'labor_fractional_headcount'), undefined);
    q.labor[0].peoplePerPosition = 2;
    assert.equal(evaluateCompleteness(q).notices.find((x) => x.id === 'labor_fractional_headcount'), undefined);
  });

  test('(c) precio cerrado de varios días con 1 viaje: ¿la cuadrilla vuelve a la base cada día?', () => {
    const q = closedQuote({ activity: { billableQuantityPerMonth: 1, daysPerActivation: 4 } });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
    const n = evaluateCompleteness(q).notices.find((x) => x.id === 'closed_single_trip');
    assert.ok(n);
    assert.match(n.message, /^¿La cuadrilla vuelve a la base cada día\? El trabajo dura 4 días y cargaste 1 viaje por trabajo/);
    assert.equal(n.focus, 'logistics.tripsPerActivation');
    q.logistics.tripsPerActivation = 4;
    assert.equal(evaluateCompleteness(q).notices.find((x) => x.id === 'closed_single_trip'), undefined);
    q.logistics.tripsPerActivation = 1;
    q.activity.daysPerActivation = 1;
    assert.equal(evaluateCompleteness(q).notices.find((x) => x.id === 'closed_single_trip'), undefined);
    // On call: no aplica.
    q.activity.daysPerActivation = 4;
    q.contract = { mode: 'on_demand', components: ['labor'] };
    assert.equal(evaluateCompleteness(q).notices.find((x) => x.id === 'closed_single_trip'), undefined);
  });
});
