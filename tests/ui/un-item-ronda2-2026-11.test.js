/**
 * Regla de un ítem, segunda tanda (verificación independiente y revisión UX, 2026-11-18):
 * N1 (la cuenta del puesto cierra con meses de sueldo), N2 (cambiar la unidad limpia las
 * "algunas horas" también sin contrato), N5 (tope de horas con "todo el trabajo") y UX 1
 * (un trabajo cerrado más largo que el mes no es un error). Ninguno cambia números.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnitChangeWithMode } from '../../js/domain/unit-change.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { closedLaborCostText, lineMonthAtEstimate, roleOvertimeMonth, longClosedJobNote, approxAmountText, perBilledUnitSuffix } from '../../js/ui/result-text.js';
import { service, person, resetIds } from '../lab/lib/build.js';

const norm = (s) => String(s).replace(/ /g, ' ');
const parseMoney = (s) => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.'));

function closedJob({ jobs = 1, days = 45, ow = { mode: 'all', premiumPct: 50 } } = {}) {
  resetIds();
  const q = service({
    id: 'r2', serviceType: 'lump_sum', unit: 'job', pricingMode: 'known_activity',
    activity: { billableQuantityPerMonth: jobs, daysPerActivation: days, hoursPerActiveDay: 8, availableDaysPerMonth: 30 },
    labor: [person({ role: 'Soldador', positions: 2 })],
  });
  q.contract = { mode: 'closed', components: ['labor'] };
  q.overtimeWork = ow;
  return q;
}

describe('N2 · cambiar la unidad limpia las "algunas horas" (también sin contrato)', () => {
  test('por día → por mes en una cotización sin contrato: horas en 0 y aviso', () => {
    const q = { unit: 'day', rules: {}, activity: {}, overtimeWork: { mode: 'some', premiumPct: 50, hours50: 4, hours100: 1 } };
    const from = billingUnitOf(q);
    const to = billingUnitOf({ ...q, unit: 'month' });
    const notices = applyUnitChangeWithMode(q, 'month', from, to);
    assert.equal(q.unit, 'month');
    assert.equal(q.overtimeWork.hours50, 0);
    assert.equal(q.overtimeWork.hours100, 0);
    assert.ok(notices.some((n) => /horas extra del trabajo/.test(n)), notices.join(' | '));
  });

  test('por día → por hora no cambia el modo: las horas quedan', () => {
    const q = { unit: 'day', rules: {}, activity: {}, overtimeWork: { mode: 'some', premiumPct: 50, hours50: 4, hours100: 0 } };
    const notices = applyUnitChangeWithMode(q, 'hour', billingUnitOf(q), billingUnitOf({ ...q, unit: 'hour' }));
    assert.equal(q.overtimeWork.hours50, 4);
    assert.ok(!notices.some((n) => /horas extra del trabajo/.test(n)));
  });
});

describe('N1 · la cuenta del puesto cierra con el total (trabajo de 45 días, 30 disponibles)', () => {
  test('puesto: meses de sueldo × sueldo + horas extra = costo del puesto en el trabajo', () => {
    const r = computeQuote(closedJob(), { settings: {} });
    const l = r.model.labor.lines[0];
    const ot = roleOvertimeMonth(r, 0);
    const text = norm(closedLaborCostText(r, l, { overtime: ot }));
    assert.match(text, /× 1,5 = \$ [\d.]+ \(1,5 meses de sueldo\)/);
    const total = lineMonthAtEstimate(r, l) + ot;
    const shown = parseMoney(text.split(' = ').pop());
    assert.ok(Math.abs(shown - Math.round(total)) <= 1, `${shown} contra ${total}`);
    // Los sumandos mostrados suman el total (al peso).
    const salary = parseMoney(text.match(/= (\$ [\d.]+) \(1,5/)[1]);
    const extra = parseMoney(text.match(/50 %\): (\$ [\d.]+)/)[1]);
    assert.ok(Math.abs(salary + extra - shown) <= 1, `${salary} + ${extra} contra ${shown}`);
  });

  test('total de Personal: misma cuenta con lo del personal', () => {
    const r = computeQuote(closedJob(), { settings: {} });
    const line = r.model.lines.find((x) => x.key === 'labor:overtime-work');
    const text = norm(closedLaborCostText(r, r.model.labor, { overtime: lineMonthAtEstimate(r, line) }));
    const row = r.eecc.rows.find((x) => x.category === 'labor');
    assert.ok(Math.abs(parseMoney(text.split(' = ').pop()) - Math.round(row.amount)) <= 1, text);
  });

  test('un trabajo que entra en el mes no habla de meses de sueldo', () => {
    const r = computeQuote(closedJob({ days: 10 }), { settings: {} });
    assert.doesNotMatch(norm(closedLaborCostText(r, r.model.labor.lines[0], { overtime: roleOvertimeMonth(r, 0) })), /meses de sueldo/);
  });
});

describe('UX 1 · un trabajo cerrado de más días que el mes no es un error', () => {
  test('1 trabajo de 45 días: sin aviso de "más que los días disponibles"; nota informativa', () => {
    const r = computeQuote(closedJob(), { settings: {} });
    assert.ok(!r.issues.some((i) => /días disponibles del mes/.test(i.message)), r.issues.map((i) => i.message).join(' | '));
    assert.match(norm(longClosedJobNote(r)), /^El trabajo dura 1,5 meses .*se pagan 1,5 meses de sueldo/);
  });

  test('2 trabajos de 20 días por mes que no entran: la alerta sigue', () => {
    const r = computeQuote(closedJob({ jobs: 2, days: 20 }), { settings: {} });
    assert.ok(r.issues.some((i) => /días disponibles del mes/.test(i.message)));
    assert.equal(longClosedJobNote(r), '');
  });

  test('un trabajo que entra en el mes: sin nota', () => {
    assert.equal(longClosedJobNote(computeQuote(closedJob({ days: 10 }), { settings: {} })), '');
  });
});

describe('N5 · "todo el trabajo" con horas imposibles para una persona', () => {
  const quote = (hours, positions = 1, ow = { mode: 'all', premiumPct: 50 }) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 30, hoursPerActiveDay: hours, availableDaysPerMonth: 30, daysPerActivation: 1 }, labor: [person({ positions })] });
    q.overtimeWork = ow;
    return q;
  };
  const hoursItem = (q) => evaluateCompleteness(q, computeQuote(q)).items.find((i) => i.id === 'labor_hours');

  test('1 persona 24 h por día todo el mes: avisa', () => {
    const item = hoursItem(quote(24));
    assert.ok(item && item.status !== 'ok', JSON.stringify(item));
    assert.match(norm(item.message), /24 h por día por persona/);
  });

  test('12 h por día: no avisa (las extra se pagan)', () => {
    const item = hoursItem(quote(12));
    assert.ok(!item || item.status === 'ok' || item.status === 'n/a', JSON.stringify(item));
  });
});

describe('UX · "≈ $ X por hora" no se corta', () => {
  test('espacios de no separación después de "≈" y entre el monto y la unidad', () => {
    assert.equal(approxAmountText(8961, 'hora'), '≈ $ 8.961 por hora');
    resetIds();
    const r = computeQuote(service({ unit: 'hour', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 10, availableDaysPerMonth: 30, daysPerActivation: 1 }, labor: [person()] }));
    const s = perBilledUnitSuffix(r, { unit: 'hour' }, 1_000_000);
    assert.match(s, /^ · ≈ \$ [\d.]+ por hora$/);
  });
});
