/**
 * Contrato (modalidad + recursos) y adicionales cobrados aparte (PLAN-2026-018).
 *
 * Escenarios reales del pedido del dueño:
 *   - Colectivo mensual con chofer: fijo por 26 días × 12 h + horas fuera de horario.
 *   - Cuadrilla on call (sólo personal): no exige equipos ni equipo en espera.
 *   - Cotizaciones anteriores (sin contrato): se leen desde el tipo de servicio, mismos números.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeExtras } from '../../js/engines/extras-engine.js';
import { revenueComposition } from '../../js/engines/commercial-rules-engine.js';
import { createEmptyQuote, defaultSettings, createOtherCost, createExtra } from '../../js/domain/quote-factory.js';
import { contractOf, serviceTypeForContract, contractUnits, unitFitsContract, unitChoicesForContract, resourceChoiceOf } from '../../js/domain/contract.js';
import { demoHydroCraneQuote } from '../../js/domain/demo-data.js';

const approx = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);

function baseQuote({ contract, unit, knownRate = 0, pricingMode = 'known_rate', activity = {}, extras = [], fixed = 0, perDay = 0, margin = 15 }) {
  const settings = { ...defaultSettings('org'), illustrative: false, defaultBillingTaxes: null };
  const q = createEmptyQuote({ organizationId: 'org', settings, now: '2026-11-01T00:00:00.000Z', id: 'q-contract' });
  q.contract = contract;
  q.serviceType = serviceTypeForContract(contract);
  q.unit = unit;
  q.pricingMode = pricingMode;
  q.billingTaxes = { mode: 'combined', notApplicable: true, combinedPct: null, items: [] };
  q.finance.monthlyRatePct = 0;
  q.risk.generalPct = 0;
  q.logistics.notApplicable = true;
  q.materialsNotApplicable = true;
  q.fuel.requiresConfirmation = false;
  q.activity = { ...q.activity, ...activity };
  q.rules = { ...q.rules, volumeTiers: q.rules.volumeTiers.map((t) => ({ ...t, discountPct: 0 })) };
  q.pricing = { ...q.pricing, knownRate, targetMarginPct: margin, roundingStep: 0 };
  q.indirect = { ...q.indirect, method: 'percent_direct', pct: 0 };
  q.otherCosts = [];
  if (fixed) q.otherCosts.push(createOtherCost({ id: 'f', description: 'Fijo', category: 'equipment', behavior: 'fixed_monthly', amount: fixed }));
  if (perDay) q.otherCosts.push(createOtherCost({ id: 'v', description: 'Por día', category: 'equipment', behavior: 'per_active_day', amount: perDay }));
  q.extras = extras;
  return q;
}

describe('Contrato — modalidad y recursos (PLAN-2026-018)', () => {
  test('el tipo de servicio guardado se deriva del contrato', () => {
    assert.equal(serviceTypeForContract({ mode: 'monthly', labor: true, equipment: true }), 'equipment_with_operator');
    assert.equal(serviceTypeForContract({ mode: 'monthly', labor: true, equipment: false }), 'crew');
    assert.equal(serviceTypeForContract({ mode: 'on_demand', labor: true, equipment: false }), 'on_call');
    assert.equal(serviceTypeForContract({ mode: 'on_demand', labor: false, equipment: true }), 'equipment_only');
    assert.equal(serviceTypeForContract({ mode: 'closed', labor: true, equipment: true }), 'lump_sum');
  });

  test('las unidades siguen a la modalidad: fijo mensual → $/mes, cerrado → global o hitos', () => {
    assert.deepEqual(contractUnits({ mode: 'monthly' }), ['month']);
    assert.deepEqual(contractUnits({ mode: 'closed' }), ['job', 'milestone']);
    const onCall = contractUnits({ mode: 'on_demand', labor: true, equipment: true });
    assert.equal(onCall[0], 'hour');
    ['call', 'trip', 'km', 'm3'].forEach((u) => assert.ok(onCall.includes(u), u));
    // Sólo personal: sin unidades de transporte.
    const crew = contractUnits({ mode: 'on_demand', labor: true, equipment: false });
    assert.ok(crew.includes('call') && crew.includes('manhour'));
    assert.ok(!crew.includes('tonkm'));
    assert.equal(unitFitsContract({ mode: 'monthly' }, 'day'), false);
    assert.equal(unitFitsContract({ mode: 'on_demand' }, 'custom'), true);
    const ids = unitChoicesForContract({ mode: 'monthly' }, 'day').map((u) => u.id);
    assert.deepEqual(ids, ['month', 'day']);
  });

  test('una cotización anterior (sin contrato) se lee desde su tipo de servicio y su unidad', () => {
    assert.deepEqual(contractOf({ serviceType: 'on_call', unit: 'day' }), { mode: 'on_demand', labor: true, equipment: true, legacy: true });
    assert.deepEqual(contractOf({ serviceType: 'permanent', unit: 'month' }), { mode: 'monthly', labor: true, equipment: false, legacy: true });
    assert.deepEqual(contractOf({ serviceType: 'equipment_only', unit: 'day' }), { mode: 'on_demand', labor: false, equipment: true, legacy: true });
    assert.equal(contractOf({ serviceType: 'turnkey', unit: 'job' }).mode, 'closed');
    assert.equal(resourceChoiceOf({ mode: 'monthly', labor: false, equipment: false }), 'both');
  });

  test('la demo (sin contrato) calcula exactamente igual con y sin el motor de adicionales', () => {
    const demo = demoHydroCraneQuote({ organizationId: 'org', now: '2026-11-01T00:00:00.000Z' });
    const a = computeQuote(demo);
    const b = computeQuote({ ...demo, extras: [] });
    assert.equal(a.kpis.revenue, b.kpis.revenue);
    assert.equal(a.kpis.totalCost, b.kpis.totalCost);
    assert.equal(a.contract.legacy, true);
  });
});

describe('Adicionales cobrados aparte (PLAN-2026-018)', () => {
  test('precio sugerido = costo con margen e impuestos; el precio a mano manda', () => {
    const x = computeExtras([
      { id: 'a', label: 'Hora fuera de horario', unitName: 'hora', quantityPerMonth: 18, costPerUnit: 40000, price: null },
      { id: 'b', label: 'Feriado', unitName: 'día', quantityPerMonth: 2, costPerUnit: 100000, price: 200000 },
      { id: 'c', label: 'Sin costo', quantityPerMonth: 3, costPerUnit: null, price: null },
    ], { targetMarginPct: 15, billingTaxPct: 5 });
    approx(x.lines[0].suggestedPrice, 40000 / 0.8);
    assert.equal(x.lines[0].priceSource, 'suggested');
    approx(x.lines[0].revenue, 18 * 50000);
    assert.equal(x.lines[1].priceSource, 'manual');
    approx(x.lines[1].revenue, 400000);
    approx(x.cost, 18 * 40000 + 2 * 100000);
    assert.equal(x.missingPrice, 1);
  });

  test('colectivo mensual con chofer: fijo + horas fuera de horario en la misma cotización', () => {
    const q = baseQuote({
      contract: { mode: 'monthly', labor: true, equipment: true },
      unit: 'month',
      knownRate: 14000000,
      activity: { activeDaysPerMonth: 26, hoursPerActiveDay: 12, availableDaysPerMonth: 30 },
      fixed: 9000000,
      perDay: 200000,
      extras: [createExtra({ id: 'x1', label: 'Hora fuera de horario', unitName: 'hora', quantityPerMonth: 18, costPerUnit: 40000, price: 60000 })],
    });
    const r = computeQuote(q);
    const rev = r.estimate.revenue;
    approx(rev.components.base, 14000000, 'fijo');
    approx(rev.components.extras, 18 * 60000, 'adicionales');
    approx(rev.total, 14000000 + 1080000, 'total');
    // El costo del adicional suma al costo del mes, sin cambiar los días de trabajo.
    approx(r.kpis.totalCost, 9000000 + 26 * 200000 + 18 * 40000, 'costo');
    assert.equal(r.activity.activeDaysPerMonth, 26);
    const rows = revenueComposition(rev).rows.map((x) => x.id);
    assert.deepEqual(rows, ['base', 'extras']);
    // "Calcular la tarifa": el fijo sugerido cubre lo que el adicional no cubre.
    const r2 = computeQuote({ ...q, pricingMode: 'known_activity' });
    const needed = (r2.kpis.totalCost / 0.85) - 1080000;
    approx(r2.kpis.targetNetRate, needed, 'fijo sugerido');
    assert.ok(!r.issues.some((i) => i.path === 'unit'), 'sin aviso de unidad');
  });

  test('cuadrilla on call (sólo personal): no pide equipos ni equipo en espera', () => {
    const q = baseQuote({
      contract: { mode: 'on_demand', labor: true, equipment: false },
      unit: 'call',
      knownRate: 1300000,
      activity: { billableQuantityPerMonth: 8, daysPerActivation: 1 },
      fixed: 3000000,
    });
    const r = computeQuote(q);
    const ids = r.completeness.items.map((i) => i.id);
    assert.ok(!ids.includes('equipment_cost'), 'no exige equipos');
    assert.ok(!ids.includes('standby'), 'no pide equipo en espera');
    assert.ok(!r.issues.some((i) => i.path === 'unit'), '$/llamado corresponde');
  });

  test('un adicional con cantidad y sin costo queda como pendiente', () => {
    const q = baseQuote({
      contract: { mode: 'monthly', labor: true, equipment: false },
      unit: 'month',
      knownRate: 5000000,
      activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 9 },
      extras: [createExtra({ id: 'x', label: 'Feriado', unitName: 'día', quantityPerMonth: 2 })],
    });
    const item = computeQuote(q).completeness.items.find((i) => i.id === 'extras');
    assert.equal(item.status, 'warning');
    assert.equal(item.focus, 'extras.0.costPerUnit');
  });

  test('unidad que no corresponde al contrato: aviso, sin cambiar números', () => {
    const q = baseQuote({ contract: { mode: 'monthly', labor: true, equipment: true }, unit: 'day', knownRate: 500000, activity: { activeDaysPerMonth: 20 } });
    const r = computeQuote(q);
    assert.ok(r.issues.some((i) => i.path === 'unit' && i.severity === 'warning'));
  });
});

describe('Adicionales — revisión económica (PLAN-2026-018)', () => {
  const loaded = () => {
    const q = baseQuote({
      contract: { mode: 'on_demand', labor: true, equipment: true },
      unit: 'day',
      knownRate: 600000,
      activity: { activeDaysPerMonth: 20 },
      fixed: 5000000,
      perDay: 300000,
      extras: [createExtra({ id: 'x', label: 'Hora fuera de horario', unitName: 'hora', quantityPerMonth: 18, costPerUnit: 40000 })],
    });
    q.indirect = { ...q.indirect, method: 'percent_direct', pct: 20 };
    q.risk.generalPct = 5;
    return q;
  };

  test('el precio sugerido cubre el costo cargado: el adicional no baja el margen', () => {
    const q = loaded();
    const withExtra = computeQuote(q);
    const line = withExtra.extras.lines[0];
    assert.ok(withExtra.extras.loadFactor > 1, 'estructura y contingencia cargan el costo');
    // La ganancia que suma el adicional es exactamente su margen objetivo sobre lo que factura.
    const without = computeQuote({ ...q, extras: [] });
    const addedProfit = withExtra.kpis.profit - without.kpis.profit;
    approx(addedProfit, line.revenue * 0.15, 'margen del adicional');
    approx(line.profit, line.revenue * 0.15, 'ganancia de la línea');
  });

  test('margen inválido: sin precio sugerido y con aviso', () => {
    const q = loaded();
    q.pricing.targetMarginPct = 150;
    const r = computeQuote(q);
    assert.equal(r.extras.lines[0].price, null);
    assert.ok(r.issues.some((i) => i.path === 'extras.0.price'));
    assert.equal(r.completeness.items.find((i) => i.id === 'extras').status, 'warning');
  });

  test('precio a mano bajo el costo: aviso; 0 a mano es 0 (bonificado)', () => {
    const q = loaded();
    q.extras[0].price = 30000;
    assert.ok(computeQuote(q).issues.some((i) => i.path === 'extras.0.price' && /debajo de su costo/.test(i.message)));
    q.extras[0].price = 0;
    assert.equal(computeQuote(q).estimate.revenue.components.extras, 0);
  });

  test('los adicionales se cobran encima del mínimo garantizado', () => {
    const q = loaded();
    q.rules.minimumMonthlyGuarantee = 20000000;
    q.extras[0].price = 60000;
    const rev = computeQuote(q).estimate.revenue;
    approx(rev.total, 20000000 + 18 * 60000);
  });
});
