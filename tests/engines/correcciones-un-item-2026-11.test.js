/**
 * Correcciones de la auditoría "un ítem y unidad de cobro" (2026-11-18).
 *   A1: con "todo el trabajo" y más días que los disponibles, las horas que ya paga el sueldo
 *       crecen con los meses de sueldo (D ÷ disponibles): no se cobra dos veces el sueldo.
 *   M1: equilibrio, tramos y matriz recalculan esas horas extra con cada cantidad de días.
 *   M8: al cambiar la modalidad, las horas de "algunas horas" (por mes ↔ por trabajo) se limpian.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLabor } from '../../js/engines/labor-engine.js';
import { computeOvertimeWork, overtimeAllMonthlyAt, salaryMonths } from '../../js/engines/overtime-work-engine.js';
import { buildCostModel, costAtActivity } from '../../js/engines/cost-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { applyContractModeChange } from '../../js/domain/unit-change.js';
import { service, person, resetIds } from '../lab/lib/build.js';

// hora de sueldo 10.000 · cargas × 1,5 → hora con cargas 15.000 · al 50 % = 22.500 (recargo 7.500)
const simple = { positions: 1, peoplePerPosition: 1, basicMonthly: 1760000, additionalsMonthly: 0, normalHoursPerMonth: 176, sacPct: 0, vacationPct: 0, employerContributionsPct: 50, artPct: 0 };
const all50 = { mode: 'all', premiumPct: 50 };

describe('A1 · todo el trabajo con más días que los disponibles', () => {
  test('meses de sueldo: 1 hasta los disponibles, D ÷ disponibles después', () => {
    assert.equal(salaryMonths(20, 30), 1);
    assert.equal(salaryMonths(30, 30), 1);
    assert.equal(salaryMonths(45, 30), 1.5);
    assert.equal(salaryMonths(10, 0), 1);
  });

  test('45 días de 8 h con 30 disponibles: el sueldo de 1,5 meses paga 264 h (sólo recargo)', () => {
    const quote = { labor: [simple], overtimeWork: all50 };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), { hoursPerActiveDay: 8, daysPerActivation: 1, activeDaysPerMonth: 45, availableDaysPerMonth: 30 });
    // 360 h trabajadas · 176 × 1,5 = 264 con recargo · 96 completas
    assert.equal(r.monthlyAtEstimate, 264 * 7500 + 96 * 22500);
    assert.equal(r.perRole[0].paidHoursInWork, 264);
    assert.equal(r.perRole[0].fullHoursPerMonth, 96);
  });

  test('60 días: el sueldo de 2 meses paga 352 h', () => {
    const quote = { labor: [simple], overtimeWork: all50 };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), { hoursPerActiveDay: 8, daysPerActivation: 1, activeDaysPerMonth: 60, availableDaysPerMonth: 30 });
    assert.equal(r.monthlyAtEstimate, 352 * 7500 + 128 * 22500);
  });

  test('con días dentro de los disponibles no cambia nada (20 días de 10 h)', () => {
    const quote = { labor: [simple], overtimeWork: all50 };
    const r = computeOvertimeWork(quote, computeLabor(quote.labor), { hoursPerActiveDay: 10, daysPerActivation: 1, activeDaysPerMonth: 20, availableDaysPerMonth: 30 });
    assert.equal(r.monthlyAtEstimate, 176 * 7500 + 24 * 22500);
  });

  test('en la cotización completa: precio cerrado de 45 días, la línea de horas extra usa los meses de sueldo', () => {
    resetIds();
    const q = service({ serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 45, hoursPerActiveDay: 8, availableDaysPerMonth: 30, daysPerActivation: 1 }, labor: [person()] });
    q.overtimeWork = all50;
    const r = computeQuote(q);
    const ow = r.model.overtimeWork;
    const role = ow.perRole[0];
    // 1.800.000 / 176 h con cargas ilustrativas: horas pagas = 176 × 1,5
    assert.ok(Math.abs(role.paidHoursInWork - 264) < 1e-9);
    const expected = 264 * role.surcharge50 + 96 * role.at50;
    assert.ok(Math.abs(ow.monthlyAtEstimate - expected) < 1e-6);
  });
});

describe('M1 · equilibrio y otros días con horas extra de todo el trabajo', () => {
  const quote = (days) => {
    resetIds();
    const q = service({
      serviceType: 'on_call', unit: 'day', pricingMode: 'known_rate',
      activity: { activeDaysPerMonth: days, hoursPerActiveDay: 10, availableDaysPerMonth: 30, daysPerActivation: 1 },
      labor: [person({ positions: 2 })],
      pricing: { knownRate: 900000 },
    });
    q.overtimeWork = all50;
    return q;
  };

  test('el costo con otros días es el que da la cotización con esos días', () => {
    const model = buildCostModel(quote(26));
    [5, 11.2, 17.6, 26, 30].forEach((d) => {
      const direct = buildCostModel(quote(d));
      const at = costAtActivity(model, d).total;
      const real = costAtActivity(direct, d).total;
      assert.ok(Math.abs(at - real) < 1e-4, `${d} días: ${at} contra ${real}`);
    });
  });

  test('en el equilibrio la ganancia es 0 (no ganancia de más)', () => {
    const r = computeQuote(quote(26));
    assert.ok(r.kpis.breakEvenDays > 0);
    const at = computeQuote(quote(r.kpis.breakEvenDays));
    assert.ok(Math.abs(at.kpis.profit) < 1, `ganancia en el equilibrio: ${at.kpis.profit}`);
  });

  test('con la actividad estimada no cambia nada (precio y costo iguales al promedio)', () => {
    const model = buildCostModel(quote(26));
    const at = costAtActivity(model, 26);
    assert.ok(Math.abs(at.overtimeAdjustment) < 1e-6);
  });

  test('curva: recargo hasta las horas pagas, completa después', () => {
    const q = { labor: [simple], overtimeWork: all50 };
    const ow = computeOvertimeWork(q, computeLabor(q.labor), { hoursPerActiveDay: 10, activeDaysPerMonth: 26, availableDaysPerMonth: 30 });
    assert.equal(overtimeAllMonthlyAt(ow, 10), 100 * 7500);
    assert.equal(overtimeAllMonthlyAt(ow, 20), 176 * 7500 + 24 * 22500);
  });
});

describe('M8 · cambiar la modalidad limpia las horas de "algunas horas"', () => {
  test('precio cerrado → fijo mensual: se borran con aviso', () => {
    const q = { overtimeWork: { mode: 'some', hours50: 4, hours100: 1 } };
    const notices = applyContractModeChange(q, 'closed', 'monthly');
    assert.equal(q.overtimeWork.hours50, 0);
    assert.equal(q.overtimeWork.hours100, 0);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /por trabajo/);
  });

  test('fijo mensual → por servicio: se borran', () => {
    const q = { overtimeWork: { mode: 'some', hours50: 10 } };
    assert.equal(applyContractModeChange(q, 'monthly', 'on_demand').length, 1);
    assert.equal(q.overtimeWork.hours50, 0);
  });

  test('misma base (precio cerrado ↔ por servicio) o "todo el trabajo": no se toca', () => {
    const q = { overtimeWork: { mode: 'some', hours50: 4 } };
    assert.deepEqual(applyContractModeChange(q, 'closed', 'on_demand'), []);
    assert.equal(q.overtimeWork.hours50, 4);
    const all = { overtimeWork: { mode: 'all', premiumPct: 100 } };
    assert.deepEqual(applyContractModeChange(all, 'closed', 'monthly'), []);
    assert.equal(all.overtimeWork.mode, 'all');
  });
});
