/**
 * Horas extra del trabajo (2026-11-18): un precio único; si el trabajo lleva horas extra, su
 * costo se suma dentro del personal (valor de la hora de cada recurso). Sin el dato, nada cambia.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLabor } from '../../js/engines/labor-engine.js';
import { computeOvertimeWork, overtimeWorkOf } from '../../js/engines/overtime-work-engine.js';

const person = { positions: 2, peoplePerPosition: 1, basicMonthly: 1760000, additionalsMonthly: 0, normalHoursPerMonth: 176, sacPct: 0, vacationPct: 0, employerContributionsPct: 50, artPct: 0 };
// hora de sueldo 10.000 · cargas × 1,5 → hora con cargas 15.000 · al 50 % = 22.500 · al 100 % = 30.000
const activity = { hoursPerActiveDay: 8, daysPerActivation: 2, activeDaysPerMonth: 10 };

describe('Horas extra del trabajo', () => {
  test('sin dato o "no": no suma nada', () => {
    const quote = { labor: [person] };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity);
    assert.equal(r.mode, 'none');
    assert.equal(r.active, false);
    assert.equal(r.fixedMonthly + r.variablePerActiveDay, 0);
  });

  test('todo al 50 %: suma el recargo de cada persona por hora trabajada', () => {
    const quote = { labor: [person], overtimeWork: { mode: 'all', premiumPct: 50 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity);
    // 2 personas × 8 h × (22.500 − 15.000)
    assert.equal(r.variablePerActiveDay, 2 * 8 * 7500);
    assert.equal(r.crewSurchargePerHour, 15000);
    assert.equal(r.fixedMonthly, 0);
  });

  test('todo al 100 %, con horas propias de cada persona menores a las del servicio', () => {
    const quote = { labor: [{ ...person, coverageHoursPerDay: 6 }], overtimeWork: { mode: 'all', premiumPct: 100 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity);
    assert.equal(r.variablePerActiveDay, 2 * 6 * 15000);
  });

  test('valor propio del recurso (convenio): se usa ése', () => {
    const quote = { labor: [{ ...person, overtimeRate50: 25000 }], overtimeWork: { mode: 'all', premiumPct: 50 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity);
    assert.equal(r.variablePerActiveDay, 2 * 8 * 10000);
  });

  test('algunas horas por trabajo: hora extra completa, repartida en los días del trabajo', () => {
    const quote = { labor: [person], overtimeWork: { mode: 'some', hours50: 3, hours100: 1 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity, { contractMode: 'closed' });
    const perJob = 3 * 2 * 22500 + 1 * 2 * 30000;
    assert.equal(r.perUnit, perJob);
    assert.equal(r.variablePerActiveDay, perJob / 2);
    assert.equal(r.fixedMonthly, 0);
  });

  test('algunas horas en fijo mensual: son por mes (fijo del mes)', () => {
    const quote = { labor: [person], overtimeWork: { mode: 'some', hours50: 10 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity, { contractMode: 'monthly' });
    assert.equal(r.fixedMonthly, 10 * 2 * 22500);
    assert.equal(r.variablePerActiveDay, 0);
  });

  test('datos inválidos se normalizan', () => {
    assert.deepEqual(overtimeWorkOf({ overtimeWork: { mode: 'x', premiumPct: 70, hours50: -3 } }), { mode: 'none', premiumPct: 50, hours50: 0, hours100: 0, perMonth: false });
  });
});

describe('Horas extra del trabajo — revisión de costos', () => {
  test('todo el trabajo: las horas que pasan lo que paga el sueldo van completas', () => {
    // 1 persona, 24 días × 10 h = 240 h; su sueldo paga 176 → 176 con recargo y 64 completas.
    const quote = { labor: [{ ...person, positions: 1 }], overtimeWork: { mode: 'all', premiumPct: 50 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), { hoursPerActiveDay: 10, daysPerActivation: 1, activeDaysPerMonth: 24 });
    assert.equal(r.monthlyAtEstimate, 176 * 7500 + 64 * 22500);
  });

  test('persona compartida: el sueldo asignado paga sólo su parte de las horas', () => {
    const quote = { labor: [{ ...person, positions: 1, assignment: 'shared', fixedCostSharePct: 25 }], overtimeWork: { mode: 'all', premiumPct: 50 } };
    const labor = computeLabor(quote.labor);
    const r = computeOvertimeWork(quote, labor, activity);
    assert.equal(labor.lines[0].shared, true);
    assert.equal(r.monthlyAtEstimate, 44 * 7500 + 36 * 22500);
  });

  test('turno de una cotización vieja limita las horas de cada persona', () => {
    const quote = { labor: [{ ...person, positions: 3, rotation: { hoursPerShift: 8 } }], overtimeWork: { mode: 'all', premiumPct: 50 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), { hoursPerActiveDay: 24, daysPerActivation: 1, activeDaysPerMonth: 10 });
    assert.equal(r.perRole[0].hoursPerDay, 8);
  });

  test('algunas horas suman el uso por hora de los equipos propios', () => {
    const quote = { labor: [person], overtimeWork: { mode: 'some', hours50: 2 } };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), activity, { contractMode: 'monthly', equipmentPerHour: 5000 });
    assert.equal(r.fixedMonthly, 2 * (2 * 22500 + 5000));
  });
});
