/**
 * Regla de un ítem (dueño, 2026-11-18): una cotización NUEVA da un solo ítem con un solo precio.
 * Nada de adicionales ni cobros aparte; las cotizaciones guardadas conservan lo suyo (con Quitar).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankQuote, createQuoteFromTemplate, laborLineFromProfile, withoutSeparateCharges, SEPARATE_CHARGE_RULES } from '../../js/domain/quote-factory.js';
import { legacySeparateCharges, showStandbyRule } from '../../js/ui/views/quote-steps/margin.js';
import { materialsBilledBefore } from '../../js/ui/views/quote-steps/materials.js';
import { laborHasOwnOvertime } from '../../js/ui/views/quote-steps/modality.js';
import { showModelComparator } from '../../js/ui/views/quote-result.js';
import { roleOvertimeMonth, capAllDaysNote } from '../../js/ui/result-text.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { demoServiceTemplates, demoLaborProfiles, DEMO_IDS } from '../../js/domain/demo-data.js';
import { service, person, resetIds } from '../lab/lib/build.js';

const NOW = '2026-11-18T12:00:00.000Z';
const SETTINGS = { currency: 'ARS', roundingStep: 1000, defaultTargetMarginPct: 10 };

describe('Cotización nueva: no ofrece cobros aparte', () => {
  const blank = createBlankQuote({ settings: SETTINGS, now: NOW, id: 'q' });

  test('Opciones comerciales: sin fijo de guardia, plus, movilización, km adicional ni equipo en espera', () => {
    assert.deepEqual(legacySeparateCharges(blank), { guardFee: false, guardPlus: false, mobilization: false, extraKm: false, standby: false });
    // "No aplica equipo en espera" solo no cobra nada (B5).
    assert.equal(showStandbyRule({ ...blank, rules: { ...blank.rules, standbyNotApplicable: true } }), false);
  });

  test('una cotización guardada con esos cobros los sigue mostrando (para quitarlos)', () => {
    const old = { rules: { availabilityFeeMonthly: 500000, calloutFeePerActivation: 0, mobilizationFeePerActivation: 80000, extraKmRate: 900, standbyRatePerDay: 300000 } };
    assert.deepEqual(legacySeparateCharges(old), { guardFee: true, guardPlus: false, mobilization: true, extraKm: true, standby: true });
  });

  test('Materiales: facturar aparte sólo si ya estaba elegido', () => {
    assert.equal(materialsBilledBefore(blank), false);
    assert.equal(materialsBilledBefore({ pricing: { materialsBilledSeparately: true } }), true);
    assert.equal(materialsBilledBefore({ materials: [{ billedSeparately: true }] }), true);
    assert.equal(materialsBilledBefore({ materials: [{ billedSeparately: false }] }), false);
  });

  test('Resultado: sin comparador de modelos de dos partes (abono + tarifa, take-or-pay, paquete + excedente)', () => {
    assert.equal(showModelComparator(blank), false);
    assert.equal(showModelComparator({ rules: { minimumMonthlyGuarantee: 1000000 } }), false);
    assert.equal(showModelComparator({ rules: { availabilityFeeMonthly: 500000 } }), true);
  });

  test('una cotización en blanco no tiene adicionales ni nada facturado aparte', () => {
    assert.deepEqual(blank.extras || [], []);
    assert.notEqual(blank.pricing.materialsBilledSeparately, true);
    SEPARATE_CHARGE_RULES.forEach((k) => assert.ok(!(Number(blank.rules[k]) > 0), k));
  });
});

describe('A4 · plantillas sin cobros aparte', () => {
  const old = {
    name: 'Vieja', serviceType: 'on_call',
    activity: { availability: '24/7', guardType: 'active', activeDaysPerMonth: 10 },
    extras: [{ id: 'x1', label: 'Km excedente', quantityPerMonth: 100, costPerUnit: 500, price: 900 }],
    labor: [{ id: 'l1', role: 'Operador', basicMonthly: 1000000, overtimeHoursPerActiveDay: 4, overtimeBilled: true, overtime: [{ id: 'o', hours: 2, billRatePerHour: 30000 }], overtime50HoursPerMonth: 10 }],
    materials: [{ id: 'm1', billedSeparately: true }, { id: 'm2', billedSeparately: false }],
    pricing: { materialsBilledSeparately: true, targetMarginPct: 15 },
    rules: { availabilityFeeMonthly: 500000, calloutFeePerActivation: 100000, mobilizationFeePerActivation: 80000, extraKmRate: 900, includedKmPerActivation: 50, standbyDaysPerMonth: 2, standbyRatePerDay: 300000, minimumCallUnits: 1 },
    overtimeWork: { mode: 'all', premiumPct: 100 },
  };

  test('al crear desde una plantilla (también guardada antes): sin adicionales ni cobros aparte; horas extra del trabajo sí', () => {
    const q = createQuoteFromTemplate({ id: 't', serviceType: 'on_call', defaults: JSON.parse(JSON.stringify(old)) }, { settings: SETTINGS, now: NOW });
    assert.deepEqual(q.extras, []);
    assert.equal(q.labor[0].overtimeHoursPerActiveDay, 0);
    assert.equal(q.labor[0].overtimeBilled, undefined);
    assert.equal(q.labor[0].overtime, undefined);
    assert.equal(q.labor[0].overtime50HoursPerMonth, 0);
    assert.equal(q.pricing.materialsBilledSeparately, false);
    assert.equal(q.pricing.targetMarginPct, 15);
    assert.equal(q.materials[0].billedSeparately, undefined);
    assert.equal(q.materials[1].billedSeparately, false);
    SEPARATE_CHARGE_RULES.forEach((k) => assert.equal(q.rules[k], 0, k));
    assert.equal(q.rules.minimumCallUnits, 1);
    assert.equal(q.activity.availability, null);
    assert.deepEqual(q.overtimeWork, { mode: 'all', premiumPct: 100 });
    const r = computeQuote(q);
    assert.equal(r.estimate.revenue.components.extras || 0, 0);
    assert.equal(r.estimate.revenue.components.overtimeVariable || 0, 0);
    assert.equal(r.estimate.revenue.components.materialsFixed + r.estimate.revenue.components.materialsVariable, 0);
  });

  test('withoutSeparateCharges no toca la cotización de origen si se le pasa una copia', () => {
    const copy = JSON.parse(JSON.stringify(old));
    withoutSeparateCharges(copy);
    assert.equal(old.extras.length, 1);
    assert.equal(old.rules.extraKmRate, 900);
  });

  test('la plantilla demo "Hidrogrúa por día" da una cotización de un solo precio', () => {
    const tpl = demoServiceTemplates().find((t) => t.id === DEMO_IDS.templateHydroCrane);
    const q = createQuoteFromTemplate(tpl, { settings: SETTINGS, now: NOW });
    assert.ok(q.labor.every((l) => !laborHasOwnOvertime(l)));
    assert.ok(q.rules.volumeTiers.every((t) => !(Number(t.discountPct) > 0)));
    assert.equal(q.activity.availability, null);
  });
});

describe('A5 · el puesto nuevo no hereda horas extra del perfil', () => {
  test('un perfil con horas extra por día da un puesto sin horas extra', () => {
    const line = laborLineFromProfile({ id: 'p', role: 'Operador', basicMonthly: 1000000, overtimeHoursPerActiveDay: 4 }, null, { now: NOW });
    assert.equal(line.overtimeHoursPerActiveDay, 0);
    assert.equal(laborHasOwnOvertime(line), false);
  });

  test('los perfiles demo ya no traen horas extra', () => {
    assert.ok(demoLaborProfiles().every((p) => !(Number(p.overtimeHoursPerActiveDay) > 0)));
  });

  test('el aviso de doble conteo ve las horas por día y por tramos (cotizaciones viejas)', () => {
    assert.equal(laborHasOwnOvertime({ overtimeHoursPerActiveDay: 4 }), true);
    assert.equal(laborHasOwnOvertime({ overtime: [{ hours: 2 }] }), true);
    assert.equal(laborHasOwnOvertime({ overtime: [{ hours: 0 }] }), false);
    assert.equal(laborHasOwnOvertime({ overtime50HoursPerMonth: 10 }), true);
  });
});

describe('M2 · las horas extra van dentro del costo del puesto', () => {
  const quote = (ow) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 10, availableDaysPerMonth: 30, daysPerActivation: 1 }, labor: [person({ positions: 2 }), person({ role: 'Ayudante', basicMonthly: 1200000 })] });
    q.overtimeWork = ow;
    return q;
  };

  for (const ow of [{ mode: 'all', premiumPct: 50 }, { mode: 'some', hours50: 3, hours100: 1 }]) {
    test(`${ow.mode}: lo de cada puesto suma el total de horas extra del personal`, () => {
      const r = computeQuote(quote(ow));
      const line = r.model.lines.find((l) => l.key === 'labor:overtime-work');
      const total = line.variablePerActiveDay * 20 + line.fixedMonthly;
      const perRole = roleOvertimeMonth(r, 0) + roleOvertimeMonth(r, 1);
      assert.ok(total > 0);
      assert.ok(Math.abs(perRole - total) < 1e-6, `${perRole} contra ${total}`);
    });
  }

  test('"Ver cálculo" del total nombra las horas extra', () => {
    const r = computeQuote(quote({ mode: 'all', premiumPct: 50 }));
    assert.ok(r.model.overtimeWork.active);
    assert.equal(roleOvertimeMonth(computeQuote(quote({ mode: 'none' })), 0), 0);
  });
});

describe('M4 · el aviso de horas del personal y las horas extra del trabajo', () => {
  const quote = (ow) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 10, availableDaysPerMonth: 30, daysPerActivation: 1 }, labor: [person({ coverageHoursPerDay: null })] });
    q.labor[0].normalHoursPerMonth = 176;
    q.overtimeWork = ow;
    return q;
  };
  const item = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'labor_hours');

  test('sin horas extra del trabajo: pide elegirlas en "Cómo se cobra", no en el puesto', () => {
    const it = item(quote({ mode: 'none' }));
    assert.ok(it && it.status !== 'ok');
    assert.doesNotMatch(it.message, /cargá las horas extra/);
    assert.match(it.message, /Horas extra del trabajo/);
  });

  test('con "todo el trabajo" no hay aviso', () => {
    const it = item(quote({ mode: 'all', premiumPct: 50 }));
    assert.ok(!it || it.status === 'ok' || it.status === 'n/a');
  });

  test('con "algunas horas" que alcanzan no hay aviso', () => {
    // faltan 2 h por día por persona: 2 h al 50 % por día de trabajo las cubren
    const it = item(quote({ mode: 'some', hours50: 2 }));
    assert.ok(!it || it.status === 'ok' || it.status === 'n/a');
  });
});

describe('B1 · "(sin contar horas extra)"', () => {
  test('no se dice si hay horas extra del trabajo', () => {
    assert.equal(capAllDaysNote(true), ' (sin contar horas extra)');
    assert.equal(capAllDaysNote(true, { overtimeWork: true }), '');
    assert.equal(capAllDaysNote(false), '');
  });
});
