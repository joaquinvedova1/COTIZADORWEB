/**
 * 0.25.1 (auditoría de lanzamiento, ECO-01): cobrando por mes, las horas por mes de un recurso
 * propio quedan guardadas. Si después cambian los días del servicio, el Resultado avisa con montos.
 * La fórmula no cambia.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createBlankQuote, defaultSettings, laborLineFromProfile, withTimeCostBasis } from '../../js/domain/quote-factory.js';
import { prefillMonthHours } from '../../js/ui/views/quote-steps/assignment.js';

const NOW = '2026-11-25T12:00:00.000Z';
function monthQuote(days, { prefill = true } = {}) {
  const q = createBlankQuote({ organizationId: 'o', settings: defaultSettings('o'), now: NOW, id: 'q1', code: 'Q1' }, { unit: 'month' });
  withTimeCostBasis(q);
  q.activity.activeDaysPerMonth = 2;
  q.activity.hoursPerActiveDay = 8;
  const l = laborLineFromProfile({ id: 'p', role: 'Técnico', basicMonthly: 3200000, additionalsMonthly: 0, normalHoursPerMonth: 160 }, null, { id: 'l1', now: NOW });
  Object.assign(l, { sacPct: 0, vacationPct: 0, employerContributionsPct: 0, artPct: 0, nonRemunerativeChargesPct: 0, otherChargesPct: 0, fixedContributionsMonthly: 0 });
  if (prefill) prefillMonthHours(l, { serviceHours: 16, baseHours: 160 });
  q.labor = [l];
  q.activity.activeDaysPerMonth = days;
  return q;
}
const drift = (q) => computeQuote(q).completeness.notices.find((n) => n.id === 'month_hours_drift');

describe('ECO-01: horas del recurso distintas de las del servicio, cobrando por mes', () => {
  test('recién cargado (16 h y el servicio son 16 h): sin aviso', () => {
    assert.equal(drift(monthQuote(2)), undefined);
  });
  test('los días pasan a 20: avisa, con lo que paga y lo que costaría', () => {
    const n = drift(monthQuote(20));
    assert.ok(n);
    assert.equal(n.severity, 'warning');
    assert.equal(n.focus, 'labor.0.assignedHoursPerMonth');
    assert.equal(Math.round(n.rows[0].paidAmount), 320000);
    assert.equal(Math.round(n.rows[0].serviceAmount), 3200000);
    assert.equal(Math.round(n.amount), 2880000);
    assert.match(n.message, /160 h por mes/);
  });
  test('sin horas cargadas (todo el mes): sin aviso', () => {
    assert.equal(drift(monthQuote(20, { prefill: false })), undefined);
  });
});
