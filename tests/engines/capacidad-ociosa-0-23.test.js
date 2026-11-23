/**
 * 0.23.0 (2026-11-23): horas del mes de los recursos propios que la cotización no paga.
 *  - Por tiempo usado, con poco trabajo estimado, el precio paga una parte chica del mes del
 *    recurso y antes no se avisaba (simulación E-01 de la beta). Ahora hay un aviso con el monto.
 *  - "Usado en" (Recursos) suma las horas de las cotizaciones por tiempo usado.
 *  - No cambia ningún cálculo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { resourceUsage, timeShareOf } from '../../js/domain/resource-usage.js';
import { service, owned } from '../lab/lib/build.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const operator = (o = {}) => ({ id: 'l1', role: 'Operador', positions: 1, basicMonthly: 1760000, normalHoursPerMonth: 176, sourceId: 'p-1', ...o });
const crane = (o = {}) => ({ ...owned({ name: 'Hidrogrúa', replacementValue: 96000000, usefulLifeYears: 8, billableHoursPerMonth: 176 }), sourceId: 'e-1', ...o });
const timed = (q) => ({ ...q, costBasis: 'time' });
const perDay = (days, extra = {}) => timed(service({ unit: 'day', activity: { activeDaysPerMonth: days, hoursPerActiveDay: 8 }, labor: [operator()], equipment: [crane()], ...extra }));
const notice = (q, id = 'idle_capacity') => computeQuote(q).completeness.notices.find((n) => n.id === id);

test('2 días por mes: avisa las horas y la plata del mes que la cotización no paga', () => {
  const r = computeQuote(perDay(2));
  const n = r.completeness.notices.find((x) => x.id === 'idle_capacity');
  assert.ok(n, 'hay aviso');
  assert.equal(n.severity, 'warning');
  assert.equal(n.targets.length, 2);
  const lab = r.model.labor.lines[0];
  const eq = r.model.equipment[0];
  // 16 h pagadas de 176: quedan 160 h de cada uno a su valor hora.
  near(n.amount, 160 * lab.time.hourlyCost + 160 * eq.time.hourlyCost);
  assert.match(n.message, /16 de 176 h/);
});

test('el aviso no cambia el costo: mismo costo por día con 2 o 20 días', () => {
  const a = computeQuote(perDay(2));
  const b = computeQuote(perDay(20));
  near(a.model.labor.lines[0].variablePerActiveDay, b.model.labor.lines[0].variablePerActiveDay);
});

test('mes bien ocupado (20 días × 8 h de 176 h): sin aviso; exactamente la mitad tampoco', () => {
  assert.equal(notice(perDay(20)), undefined);
  assert.equal(notice(perDay(11)), undefined);
  assert.ok(notice(perDay(10.9)));
});

test('con las horas que trabaja por mes iguales a las que se cobran, el aviso desaparece y el precio sube', () => {
  const q = perDay(2, { labor: [operator({ billableHoursPerMonth: 16 })], equipment: [crane({ billableHoursPerMonth: 16 })] });
  assert.equal(notice(q), undefined);
  near(computeQuote(q).model.labor.lines[0].time.hourlyCost, computeQuote(perDay(2)).model.labor.lines[0].time.hourlyCost * 11, 1);
});

test('más horas que las del mes del recurso: aviso de exceso', () => {
  const q = perDay(26, { labor: [operator()], equipment: [] });
  const n = notice(q, 'over_capacity');
  assert.ok(n);
  assert.match(n.message, /208 de 176 h/);
  assert.equal(notice(q), undefined);
});

test('no aplica cobrando por mes, con el método anterior ni sin días estimados', () => {
  assert.equal(notice(timed(service({ unit: 'month', activity: { activeDaysPerMonth: 2, hoursPerActiveDay: 8 }, labor: [operator()], equipment: [] }))), undefined);
  assert.equal(notice(service({ unit: 'day', activity: { activeDaysPerMonth: 2, hoursPerActiveDay: 8 }, labor: [operator()], equipment: [] })), undefined);
  assert.equal(notice(perDay(0)), undefined);
});

test('"Usado en": por tiempo usado suma horas y detecta más del 100 %', () => {
  const q = (id, days, status = 'won') => ({ ...perDay(days), id, status });
  const one = resourceUsage('laborProfiles', 'p-1', [q('a', 11)]);
  near(one.rows[0].assignedPct, 50);
  assert.equal(one.rows[0].byHours, true);
  near(one.rows[0].hoursPerMonth, 88);
  const two = resourceUsage('equipment', 'e-1', [q('a', 15), q('b', 15)]);
  near(two.committedPct, (120 / 176) * 200);
  assert.equal(two.overCommitted, true);
  assert.equal(resourceUsage('laborProfiles', 'p-1', [q('a', 5, 'draft')]).overCommitted, false);
});

test('timeShareOf: sin actividad estimada no hay parte del mes', () => {
  assert.equal(timeShareOf({ unit: 'day', costBasis: 'time', activity: {} }, operator(), 'labor'), null);
  const s = timeShareOf({ unit: 'day', costBasis: 'time', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 } }, operator({ coverageHoursPerDay: 4 }), 'labor');
  near(s.hoursPerMonth, 40);
  near(s.sharePct, (40 / 176) * 100);
});
