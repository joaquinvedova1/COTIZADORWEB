/**
 * 0.10.0 "La unidad primero" — correcciones de la revisión de costos y UX (2026-11).
 * Ningún total del motor cambia: sólo avisos, desgloses y textos.
 *   C1  sin aviso de unidad "falso" (viaje con sólo personal); sólo si el modo guardado no es el de la unidad.
 *   C2  un modo guardado que no corresponde a la unidad se corrige al elegir la unidad (sin borrar datos).
 *   C3  el motor da, por categoría de gasto, lo que va al renglón Materiales y lo que "Va a" otros renglones.
 *   C4  un adicional (cotizaciones anteriores) con categoría Materiales cae en "Otros costos", no en "Materiales".
 *   C5  aviso de costos fijos con varios trabajos por mes: días por trabajo y del mes.
 *   C6  al dejar de cobrar "por servicio", se borran con aviso el fijo de guardia, el plus por llamado y el mínimo en $.
 *   U2  "llamado" sólo si se cobra por llamado (en cotizaciones por componentes).
 *   U6  de una unidad por cantidad a hora o día quedan los días de trabajo que ya salían.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contractWithComponents, contractOf, modeForUnit, unitFitsContract } from '../../js/domain/contract.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { applyContractModeChange } from '../../js/domain/unit-change.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { costStructure, buildCostModel } from '../../js/engines/cost-engine.js';
import { applyModeDerivation, applyQuoteUnit } from '../../js/ui/views/quote-steps/unit-choice.js';
import { termsOfResult } from '../../js/ui/result-text.js';
import { service, person, material, otherCost, resetIds } from '../lab/lib/build.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≈ ${b}`);
const unitIssue = (r) => r.issues.find((i) => i.path === 'unit');

function withComponents(components, { unit = 'day', mode = null, activity = {}, ...rest } = {}) {
  resetIds();
  const q = service({
    unit,
    activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 8, availableDaysPerMonth: 30, daysPerActivation: 1, ...activity },
    labor: [person({ role: 'Técnico', positions: 1, basicMonthly: 1_500_000 })],
    ...rest,
  });
  q.contract = contractWithComponents({ mode: mode || modeForUnit(unit) }, components);
  q.serviceType = 'on_call';
  return q;
}

describe('C1 · aviso de unidad sólo si el modo guardado no es el de la unidad', () => {
  test('sólo personal, cobrando por viaje, km, kg o litro: sin aviso', () => {
    ['trip', 'km', 'kg', 'liter', 'm3', 'custom'].forEach((unit) => {
      const q = withComponents(['labor'], { unit, activity: { billableQuantityPerMonth: 10, unitsPerActiveDay: 2 } });
      if (unit === 'custom') q.unitName = 'diagnóstico';
      assert.equal(unitIssue(computeQuote(q)), undefined, unit);
    });
  });

  test('unitFitsContract: "por servicio" acepta cualquier unidad que no sea mes, trabajo ni hito', () => {
    const c = contractWithComponents({ mode: 'on_demand' }, ['labor']);
    ['trip', 'km', 'kg', 'liter', 'custom', 'hour', 'day'].forEach((u) => assert.equal(unitFitsContract(c, u), true, u));
    ['month', 'job', 'milestone'].forEach((u) => assert.equal(unitFitsContract(c, u), false, u));
    assert.equal(unitFitsContract({ mode: 'monthly' }, 'day'), false);
  });

  test('modo guardado "precio cerrado" cobrando por día: avisa (dato guardado antes)', () => {
    const q = withComponents(['labor'], { unit: 'day', mode: 'closed' });
    const issue = unitIssue(computeQuote(q));
    assert.ok(issue);
    assert.match(issue.message, /elegí de nuevo la unidad en "El servicio"/);
  });
});

describe('C2 · corregir el modo guardado sin borrar datos', () => {
  test('applyModeDerivation deja el modo de la unidad y conserva cantidades y tarifas', () => {
    const q = withComponents(['labor', 'tools'], { unit: 'day', mode: 'closed' });
    q.pricing.knownRate = 500_000;
    const before = JSON.stringify({ activity: q.activity, pricing: q.pricing, labor: q.labor });
    const notices = applyModeDerivation(q, 'closed', modeForUnit(q.unit));
    assert.equal(contractOf(q).mode, 'on_demand');
    assert.deepEqual(q.contract.components, ['labor', 'tools']);
    assert.equal(JSON.stringify({ activity: q.activity, pricing: q.pricing, labor: q.labor }), before);
    assert.deepEqual(notices, []);
    assert.equal(unitIssue(computeQuote(q)), undefined);
  });
});

describe('C3 · costo por categoría: en Materiales y en otros renglones', () => {
  test('el subtotal de la sección es el hijo del Resultado; lo que "Va a" otro renglón se informa aparte', () => {
    const q = withComponents(['labor', 'tools', 'other'], { unit: 'day' });
    q.materialsNotApplicable = false;
    q.materials = [material({ id: 'm1', description: 'Llave', quantity: 1, unitCost: 100_000, basis: 'per_month', component: 'tools' })];
    q.otherCosts = [
      otherCost({ id: 'o1', description: 'Permiso', amount: 30_000, behavior: 'fixed_monthly', component: 'other' }),
      otherCost({ id: 'o2', description: 'Laboratorio', amount: 80_000, behavior: 'fixed_monthly', category: 'external', component: 'other' }),
    ];
    const r = computeQuote(q);
    const mat = r.eecc.rows.find((x) => x.category === 'materials');
    const child = (id) => mat.children.find((c) => c.component === id);
    const other = r.componentCosts.byComponent.other;
    close(other.inMaterials.amount, child('other').amount, 'otros en Materiales');
    close(other.inMaterials.amount, 30_000);
    assert.equal(other.elsewhere.length, 1);
    assert.equal(other.elsewhere[0].category, 'external');
    close(other.elsewhere[0].amount, 80_000);
    close(other.amount, 110_000);
    close(r.componentCosts.byComponent.tools.inMaterials.amount, child('tools').amount);
    close(r.componentCosts.materials.amount, mat.amount);
    // Por día: equivalente por unidad cobrada (÷ días facturables), nada "en el trabajo".
    assert.equal(r.componentCosts.jobsPerMonth, null);
    close(r.componentCosts.materials.perBilledUnit, mat.amount / r.estimate.revenue.billableUnits);
  });

  test('por trabajo: lo del trabajo lo da el motor (÷ trabajos por mes, como el Total del trabajo)', () => {
    const q = withComponents(['labor', 'tools'], { unit: 'job', activity: { billableQuantityPerMonth: 2, daysPerActivation: 3 } });
    q.materialsNotApplicable = false;
    q.materials = [material({ id: 'm1', description: 'Llave', quantity: 1, unitCost: 100_000, basis: 'per_month', component: 'tools' })];
    const r = computeQuote(q);
    close(r.componentCosts.jobsPerMonth, r.estimate.revenue.activations);
    const tools = r.componentCosts.byComponent.tools.inMaterials;
    close(tools.perJob, tools.amount / 2);
    assert.equal(tools.perBilledUnit, null);
  });
});

describe('C4 · un adicional con categoría Materiales va a "Otros costos"', () => {
  test('el hijo es "other" y la suma del renglón no cambia', () => {
    const q = withComponents(['labor', 'tools'], { unit: 'day' });
    q.materialsNotApplicable = false;
    q.materials = [material({ id: 'm1', description: 'Llave', quantity: 1, unitCost: 30_000, basis: 'per_month', component: 'tools' })];
    q.extras = [{ id: 'x1', label: 'Andamio', category: 'materials', unit: 'day', quantityPerMonth: 4, costPerUnit: 25_000, price: 40_000 }];
    const r = computeQuote(q);
    const mat = r.eecc.rows.find((x) => x.category === 'materials');
    assert.deepEqual(mat.children.map((c) => c.component), ['tools', 'other']);
    close(mat.children.find((c) => c.component === 'other').amount, 100_000);
    close(mat.children.reduce((s, c) => s + c.amount, 0), mat.amount);
    // Mismo total que sin el desglose.
    const eecc = costStructure(buildCostModel(q), r.activity.activeDaysPerMonth);
    close(eecc.total, r.eecc.total);
  });
});

describe('C5 · costos fijos absorbidos con varios trabajos por mes', () => {
  test('2 trabajos de 3 días: dice los días por trabajo y los del mes', () => {
    const q = withComponents(['labor'], { unit: 'job', activity: { billableQuantityPerMonth: 2, daysPerActivation: 3 } });
    const r = computeQuote(q);
    const n = r.completeness.notices.find((x) => x.id === 'fixed_costs_absorbed');
    assert.ok(n);
    assert.match(n.message, /^2 trabajos de 3 días \(6 días de trabajo en el mes\): este precio absorbe/);
    assert.doesNotMatch(n.message, /Un trabajo de 6 días/);
  });

  test('un trabajo: "Un trabajo de 3 días"', () => {
    const q = withComponents(['labor'], { unit: 'job', activity: { billableQuantityPerMonth: 1, daysPerActivation: 3 } });
    const n = computeQuote(q).completeness.notices.find((x) => x.id === 'fixed_costs_absorbed');
    assert.match(n.message, /^Un trabajo de 3 días:/);
  });
});

describe('C6 · cobros aparte de la guardia al dejar de cobrar "por servicio"', () => {
  const rulesQuote = () => ({
    unit: 'month',
    rules: { availabilityFeeMonthly: 500_000, calloutFeePerActivation: 80_000, minimumMonthlyGuarantee: 2_000_000, minimumGuaranteeBasis: 'amount' },
  });

  test('a por mes o por trabajo: se borran con un aviso que los nombra', () => {
    const q = rulesQuote();
    const notices = applyContractModeChange(q, 'on_demand', 'monthly', activationTerms({ serviceType: 'on_call', unit: 'call' }));
    assert.equal(q.rules.availabilityFeeMonthly, 0);
    assert.equal(q.rules.calloutFeePerActivation, 0);
    assert.equal(q.rules.minimumMonthlyGuarantee, 0);
    assert.deepEqual(notices, ['Se borraron el fijo por mes por estar de guardia, el plus por cada llamado y el mínimo mensual garantizado: cobrando por mes no se cobran aparte.']);
    const q2 = rulesQuote();
    q2.rules.calloutFeePerActivation = 0;
    q2.rules.minimumMonthlyGuarantee = 0;
    assert.deepEqual(applyContractModeChange(q2, 'on_demand', 'closed'), ['Se borró el fijo por mes por estar de guardia: cobrando por trabajo no se cobra aparte.']);
  });

  test('entre unidades "por servicio" no se toca nada', () => {
    const q = rulesQuote();
    assert.deepEqual(applyContractModeChange(q, 'on_demand', 'on_demand'), []);
    assert.deepEqual(applyContractModeChange(q, 'monthly', 'on_demand'), []);
    assert.equal(q.rules.availabilityFeeMonthly, 500_000);
    assert.equal(q.rules.minimumMonthlyGuarantee, 2_000_000);
  });

  test('cambiar la unidad de por día a por mes los limpia (y el precio deja de incluirlos)', () => {
    const q = withComponents(['labor'], { unit: 'day' });
    q.rules.availabilityFeeMonthly = 500_000;
    q.rules.calloutFeePerActivation = 80_000;
    const notices = applyQuoteUnit(q, 'month');
    assert.equal(q.rules.availabilityFeeMonthly, 0);
    assert.equal(q.rules.calloutFeePerActivation, 0);
    assert.ok(notices.some((n) => /fijo por mes por estar de guardia/.test(n) && /plus por cada salida/.test(n)), notices.join(' | '));
  });
});

describe('U2 · "llamado" sólo si se cobra por llamado', () => {
  test('cotización por componentes, on_call derivado: salida (0.15.0; antes intervención); por llamado: llamado', () => {
    const contract = { components: ['labor', 'tools'] };
    ['day', 'hour', 'custom', 'trip'].forEach((unit) => assert.equal(activationTerms({ serviceType: 'on_call', unit, contract }).one, 'salida', unit));
    assert.equal(activationTerms({ serviceType: 'on_call', unit: 'call', contract }).one, 'llamado');
    assert.equal(activationTerms({ serviceType: 'lump_sum', unit: 'job', contract }).one, 'trabajo');
    // Cotizaciones anteriores (sin componentes) y la demo: como siempre.
    assert.equal(activationTerms({ serviceType: 'on_call', unit: 'day' }).one, 'llamado');
    assert.equal(activationTerms('on_call').one, 'llamado');
  });

  test('el motor nombra igual la activación y no cambia ningún número', () => {
    const q = withComponents(['labor'], { unit: 'custom', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2 } });
    q.unitName = 'diagnóstico';
    const r = computeQuote(q);
    assert.equal(termsOfResult(r).one, 'salida');
    const legacy = JSON.parse(JSON.stringify(q));
    delete legacy.contract;
    const r2 = computeQuote(legacy);
    assert.equal(termsOfResult(r2).one, 'llamado');
    close(r.kpis.totalCost, r2.kpis.totalCost);
    close(r.kpis.floorNetRate, r2.kpis.floorNetRate);
    assert.equal(q.serviceType, 'on_call');
  });
});

describe('U6 · de una unidad por cantidad a hora o día quedan los días de trabajo', () => {
  test('40 diagnósticos por mes, 2 por día → por hora: 20 días de trabajo y el aviso', () => {
    const q = withComponents(['labor'], { unit: 'custom', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, activeDaysPerMonth: null } });
    q.unitName = 'diagnóstico';
    const notices = applyQuoteUnit(q, 'hour');
    assert.equal(q.unit, 'hour');
    close(q.activity.activeDaysPerMonth, 20);
    assert.ok(notices.includes('Quedaron 20 días de trabajo por mes; revisalo acá abajo.'), notices.join(' | '));
    const r = computeQuote(q);
    close(r.activity.activeDaysPerMonth, 20);
    assert.ok(r.kpis.totalCost > 0);
  });

  test('por trabajo (2 trabajos de 3 días) → por día: 6 días de trabajo', () => {
    const q = withComponents(['labor'], { unit: 'job', activity: { billableQuantityPerMonth: 2, daysPerActivation: 3, activeDaysPerMonth: null } });
    applyQuoteUnit(q, 'day');
    close(q.activity.activeDaysPerMonth, 6);
    assert.equal(contractOf(q).mode, 'on_demand');
  });

  test('sin cantidad cargada: el aviso dice qué cargar', () => {
    const q = withComponents(['labor'], { unit: 'trip', activity: { billableQuantityPerMonth: null, unitsPerActiveDay: null, activeDaysPerMonth: null } });
    const notices = applyQuoteUnit(q, 'hour');
    assert.ok(notices.includes('Cargá cuántos días de trabajo por mes y cuántas horas por día, acá abajo.'), notices.join(' | '));
  });
});
