/**
 * 0.15.0 (pedido del dueño, 2026-11-19) — personal tercerizado en la cotización y regla de
 * presentación de las salidas. Valores ILUSTRATIVOS.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeContractedStaffLine, computeContractedStaff, contractedStaffUnitOf } from '../../js/engines/contracted-staff-engine.js';
import { buildCostModel, costAtActivity, costStructure } from '../../js/engines/cost-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { createContractedStaff } from '../../js/domain/quote-factory.js';
import { activationsMatter } from '../../js/domain/contract.js';
import { service, person, material, external, resetIds } from '../lab/lib/build.js';
import { laborRaiseProposal } from '../../js/engines/quote-engine.js';

const quoteWith = (contractedStaff, o = {}) => {
  resetIds();
  const q = service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, ...o });
  if (contractedStaff) q.contractedStaff = contractedStaff;
  return q;
};

describe('Personal tercerizado · motor', () => {
  test('por día: personas × valor por cada día de trabajo', () => {
    const r = computeContractedStaffLine({ people: 2, rate: 50000, unit: 'day' }, { hoursPerActiveDay: 8 });
    assert.equal(r.variablePerActiveDay, 100000);
    assert.equal(r.fixedMonthly, 0);
    assert.equal(r.hoursPerDay, null);
  });

  test('por hora: usa las horas del trabajo o las propias de la línea (tope 24)', () => {
    assert.equal(computeContractedStaffLine({ people: 1, rate: 10000, unit: 'hour' }, { hoursPerActiveDay: 8 }).variablePerActiveDay, 80000);
    const own = computeContractedStaffLine({ people: 2, rate: 10000, unit: 'hour', hoursPerDay: 4 }, { hoursPerActiveDay: 8 });
    assert.equal(own.variablePerActiveDay, 80000);
    assert.equal(own.ownHours, true);
    assert.equal(computeContractedStaffLine({ people: 1, rate: 1000, unit: 'hour', hoursPerDay: 30 }).hoursPerDay, 24);
  });

  test('por hora sin horas: cuesta 0 y lo marca', () => {
    const r = computeContractedStaffLine({ people: 1, rate: 10000, unit: 'hour' }, { hoursPerActiveDay: 0 });
    assert.equal(r.variablePerActiveDay, 0);
    assert.equal(r.hoursMissing, true);
  });

  test('por mes: costo fijo del mes, no depende de los días', () => {
    const r = computeContractedStaffLine({ people: 3, rate: 900000, unit: 'month' });
    assert.equal(r.fixedMonthly, 2700000);
    assert.equal(r.variablePerActiveDay, 0);
  });

  test('unidad desconocida = por día; valores negativos o vacíos = 0; totales', () => {
    assert.equal(contractedStaffUnitOf({ unit: 'año' }), 'day');
    assert.equal(computeContractedStaffLine({ people: -1, rate: null }).variablePerActiveDay, 0);
    const t = computeContractedStaff([{ people: 1, rate: 100, unit: 'day' }, { people: 2, rate: 1000, unit: 'month' }, null]);
    assert.deepEqual([t.people, t.fixedMonthly, t.variablePerActiveDay], [3, 2000, 100]);
    assert.deepEqual(computeContractedStaff(undefined), { lines: [], people: 0, fixedMonthly: 0, variablePerActiveDay: 0 });
  });

  test('línea nueva: una persona, por día, sin valor', () => {
    assert.deepEqual(createContractedStaff({ id: 'c1' }), { id: 'c1', role: '', people: 1, rate: null, unit: 'day', hoursPerDay: null });
  });
});

describe('Personal tercerizado · costo de la cotización', () => {
  test('sin líneas el costo no cambia', () => {
    const a = buildCostModel(quoteWith(null));
    const b = buildCostModel(quoteWith([]));
    assert.equal(costAtActivity(a, 10).total, costAtActivity(b, 10).total);
    assert.equal(a.lines.some((l) => l.source === 'contractedStaff'), false);
  });

  test('va al rubro Personal y se paga como proveedor', () => {
    const model = buildCostModel(quoteWith([{ id: 'c1', role: 'Soldador', people: 2, rate: 50000, unit: 'day' }, { id: 'c2', role: 'Sereno', people: 1, rate: 600000, unit: 'month' }]));
    const lines = model.lines.filter((l) => l.source === 'contractedStaff');
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => l.category === 'labor' && l.payGroup === 'suppliers'));
    assert.equal(lines[0].label, 'Soldador (tercerizado)');
    assert.equal(lines[0].variablePerActiveDay, 100000);
    assert.equal(lines[1].fixedMonthly, 600000);
    assert.equal(model.contractedStaff.people, 3);
  });

  test('suma exactamente su costo directo al mes (10 días)', () => {
    const base = buildCostModel(quoteWith(null, { indirect: { method: 'percent_direct', pct: 0 }, risk: { generalPct: 0, items: [] } }));
    const withStaff = buildCostModel(quoteWith([{ id: 'c1', role: 'Ayudante', people: 1, rate: 40000, unit: 'day' }], { indirect: { method: 'percent_direct', pct: 0 }, risk: { generalPct: 0, items: [] } }));
    const labor = (m) => costStructure(m, 10).rows.find((c) => c.category === 'labor')?.amount ?? 0;
    assert.equal(labor(withStaff) - labor(base), 400000);
  });
});

describe('Personal tercerizado · completitud', () => {
  const ruleOf = (q, id) => evaluateCompleteness(q).items.find((i) => i.id === id);

  test('sin valor: pide cuánto se le paga y apunta al campo', () => {
    const item = ruleOf(quoteWith([{ id: 'c1', role: 'Soldador', people: 1, rate: null, unit: 'day' }]), 'contracted_staff');
    assert.ok(item);
    assert.equal(item.focus, 'contractedStaff.0.rate');
    assert.match(item.message, /"Soldador"/);
  });

  test('por hora sin horas del trabajo ni propias: pide las horas', () => {
    const q = quoteWith([{ id: 'c1', role: '', people: 1, rate: 1000, unit: 'hour' }], { activity: { activeDaysPerMonth: 10, hoursPerActiveDay: null } });
    const items = evaluateCompleteness(q).items;
    // O lo pide esta regla o ya lo pide la de horas del trabajo: nunca queda sin aviso.
    assert.ok(items.some((i) => i.id === 'contracted_staff_hours' || /hora/i.test(i.message || '')));
  });

  test('completo: no hay pendientes de tercerizado y el personal cuenta como cargado', () => {
    const q = quoteWith([{ id: 'c1', role: 'Soldador', people: 1, rate: 50000, unit: 'day' }]);
    assert.equal(ruleOf(q, 'contracted_staff'), undefined);
    assert.equal(ruleOf(q, 'contracted_staff_hours'), undefined);
  });
});

describe('Salidas · sólo se preguntan cuando algo se paga por salida', () => {
  const withComponents = (o = {}) => {
    resetIds();
    const q = service({ unit: 'custom', unitName: 'diagnóstico', labor: [person()], ...o });
    q.contract = { ...(q.contract || {}), components: ['labor', 'materials'] };
    q.logistics = { ...q.logistics, notApplicable: true };
    return q;
  };

  test('por diagnóstico, sin traslado ni nada por salida: no se preguntan', () => {
    assert.equal(activationsMatter(withComponents()), false);
    assert.equal(activationsMatter(withComponents({ unit: 'day' })), false);
  });

  test('movilización que se cobra por salida o un tercero que se paga por salida: se preguntan', () => {
    assert.equal(activationsMatter(withComponents({ rules: { mobilizationFeePerActivation: 50000 } })), true);
    const withExternal = (ext) => { const q = withComponents(); q.equipment = [external({}, ext)]; q.logistics = { ...q.logistics, notApplicable: true }; return q; };
    assert.equal(activationsMatter(withExternal({ unit: 'activation' })), true);
    assert.equal(activationsMatter(withExternal({ unit: 'day', minimumUnits: 2 })), true);
    assert.equal(activationsMatter(withExternal({ unit: 'day', mobilizationIncluded: false, mobilizationAmount: 1000 })), true);
  });

  test('cotizaciones anteriores (sin "¿Qué incluye?") siguen como siempre', () => {
    resetIds();
    const q = service({});
    if (q.contract) q.contract.components = null;
    assert.equal(activationsMatter(q), true);
  });

  test('cobrar por trabajo, llamado, viaje o km siempre las usa', () => {
    for (const unit of ['job', 'call', 'trip', 'km', 'milestone']) assert.equal(activationsMatter(withComponents({ unit })), true, unit);
  });

  test('un insumo o un costo por salida las vuelve a pedir', () => {
    assert.equal(activationsMatter(withComponents({ materials: [material({ basis: 'per_activation' })] })), true);
    assert.equal(activationsMatter(withComponents({ otherCosts: [{ id: 'o1', behavior: 'per_activation', amount: 1 }] })), true);
    assert.equal(activationsMatter(withComponents({ rules: { calloutFeePerActivation: 1000 } })), true);
  });
});

describe('Personal tercerizado · actualizar tarifa', () => {
  test('el % de los convenios informa que no cubre al tercerizado', () => {
    resetIds();
    const agreements = [{ id: 'a1', name: 'Convenio de prueba', raises: [{ fromPeriod: '2026-11', remunerativePct: 10, nonRemunerativePct: 10 }] }];
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person({ agreementId: 'a1' })] });
    const alone = laborRaiseProposal(q, agreements, '2026-10', '2026-12');
    q.contractedStaff = [{ id: 'c1', role: 'Ayudante', people: 2, rate: 50000, unit: 'day' }];
    const mixed = laborRaiseProposal(q, agreements, '2026-10', '2026-12');
    assert.equal(alone.covered, alone.total);
    assert.equal(mixed.pct, alone.pct);
    assert.equal(mixed.total, alone.total + 1);
    assert.ok(Math.abs(mixed.coveredShare - 0.7244) < 0.001);
  });
});
