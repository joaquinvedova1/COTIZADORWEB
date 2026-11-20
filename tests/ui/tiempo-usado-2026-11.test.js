/**
 * Costo por tiempo usado (2026-11-18): en las cotizaciones nuevas (`costBasis = 'time'`) que no se
 * cobran por mes, la gente y los equipos propios cuestan las horas del trabajo × el valor de su
 * hora. Estos tests cubren los textos de presentación (result-text.js) y que una cotización SIN
 * costBasis (guardada) siga diciendo exactamente lo de siempre.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import {
  closedJobsPerMonth, lineMonthAtEstimate, closedLaborCostText, timeLaborCostText, laborHourStat,
  timeEquipmentUseText, timeEquipmentOwnershipHint, equipmentPerActiveDay, timeBasisWithoutFixed,
  longClosedJobNote, timeEquipmentHourHint, timeEquipmentJobText, timeEquipmentTotalText, timeStaffHoursText,
  timeEquipmentHoursText, BILLABLE_HOURS_LABEL,
} from '../../js/ui/result-text.js';
import { formatMoney } from '../../js/core/format.js';
import { service, person, owned, resetIds } from '../lab/lib/build.js';

const norm = (s) => String(s).replace(/[  ]/g, ' ');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

/** Precio cerrado: 1 operario, 3 días × 8 h, con un generador propio. */
function generatorJob({ time = true, billable = null } = {}) {
  resetIds();
  const q = service({
    id: 'tu1', serviceType: 'lump_sum', unit: 'job',
    activity: { billableQuantityPerMonth: 1, daysPerActivation: 3, hoursPerActiveDay: 8, availableDaysPerMonth: 30 },
    labor: [person({ role: 'Operario', positions: 1, basicMonthly: 1_500_000, billableHoursPerMonth: billable })],
    equipment: [owned({ name: 'Generador', replacementValue: 50_000_000, usefulLifeYears: 10, fuelLitersPerHour: 10 })],
  });
  q.contract = { mode: 'closed', components: ['labor', 'machinery'] };
  if (time) q.costBasis = 'time';
  return q;
}

/** Por hora: 2 técnicos, 20 días × 8 h. */
function hourly({ time = true } = {}) {
  resetIds();
  const q = service({
    id: 'tu2', serviceType: 'on_call', unit: 'hour',
    activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 8, availableDaysPerMonth: 30 },
    labor: [person({ role: 'Técnico', positions: 2, basicMonthly: 1_800_000, billableHoursPerMonth: 140 })],
  });
  q.contract = { mode: 'on_demand', components: ['labor', 'tools'] };
  if (time) q.costBasis = 'time';
  return q;
}

describe('Personal por tiempo usado', () => {
  test('precio cerrado: "1 persona × 8 h por día × 3 días × $ X la hora" y el total cierra con el del motor', () => {
    const r = computeQuote(generatorJob());
    const l = r.model.labor.lines[0];
    assert.equal(l.timeBasis, true);
    close(l.fixedMonthly, 0);
    const text = norm(closedLaborCostText(r, l));
    assert.equal(text, norm(`1 persona × 8 h por día × 3 días × ${formatMoney(l.time.hourlyCost)} la hora`));
    // El valor del puesto (lo del mes ÷ trabajos) es horas × días × valor de la hora.
    close(lineMonthAtEstimate(r, l) / closedJobsPerMonth(r), l.time.hourlyCost * 8 * 3);
    assert.ok(!/meses de sueldo|sueldo con cargas/.test(text));
  });

  test('con vianda: suma lo de cada día y muestra el total en el trabajo', () => {
    const q = generatorJob();
    q.labor[0].mealPerActiveDay = 15_000;
    const r = computeQuote(q);
    const l = r.model.labor.lines[0];
    const text = norm(timeLaborCostText(r, l));
    assert.match(text, /^1 persona × 8 h por día × 3 días × \$ [\d.]+ la hora \+ vianda \$ 15\.000 por día × 3 días = \$ [\d.]+ en el trabajo$/);
    assert.ok(text.endsWith(norm(`${formatMoney(lineMonthAtEstimate(r, l))} en el trabajo`)));
  });

  test('por hora: la cuenta del mes con 2 personas y la hora de 140 h que vende', () => {
    const r = computeQuote(hourly());
    const l = r.model.labor.lines[0];
    const text = norm(timeLaborCostText(r, l));
    assert.match(text, /^2 personas × 8 h por día × 20 días × \$ [\d.]+ la hora = \$ [\d.]+ en el mes$/);
    close(lineMonthAtEstimate(r, l), l.time.hourlyCost * 8 * 20 * 2);
    const stat = laborHourStat(l, 176);
    close(stat.value, l.perPerson.billableHourlyCost);
    assert.equal(norm(stat.hint), 'Costo por mes ÷ 140 horas que le cobrás a clientes por mes.');
  });

  test('sin horas que vende cargadas, la hora es la normal y el texto lo dice', () => {
    const r = computeQuote(generatorJob());
    const stat = laborHourStat(r.model.labor.lines[0], 176);
    close(stat.value, r.model.labor.lines[0].perPerson.loadedHourlyCost);
    assert.equal(norm(stat.hint), 'Costo por mes ÷ 176 horas normales por mes.');
  });

  test('menos horas que vende → hora más cara', () => {
    const a = computeQuote(generatorJob()).model.labor.lines[0];
    const b = computeQuote(generatorJob({ billable: 140 })).model.labor.lines[0];
    assert.ok(b.time.hourlyCost > a.time.hourlyCost);
  });

  test('total del personal (línea agregada del motor): "Horas de tu gente $ X por día × 3 días"', () => {
    const r = computeQuote(generatorJob());
    assert.match(norm(closedLaborCostText(r, r.model.labor)), /^Horas de tu gente \$ [\d.]+ por día × 3 días$/);
  });

  test('sin días cargados: lo de cada día de trabajo', () => {
    const q = hourly();
    q.activity.activeDaysPerMonth = 0;
    const r = computeQuote(q);
    const text = norm(timeLaborCostText(r, r.model.labor.lines[0]));
    assert.match(text, /^2 personas × 8 h por día × \$ [\d.]+ la hora = \$ [\d.]+ por día de trabajo$/);
    assert.ok(!/NaN|Infinity/.test(text));
  });
});

describe('Equipos propios por tiempo usado', () => {
  test('"Tenerlo: $ X por día de trabajo (8 h × $ Y la hora) · usarlo: …" y el hint de la posesión', () => {
    const r = computeQuote(generatorJob());
    const e = r.model.equipment[0];
    assert.equal(e.timeBasis, true);
    assert.equal(norm(timeEquipmentUseText(e)), norm(`Asignado: ${formatMoney(e.ownershipPerActiveDay)} por día de trabajo (8 h × ${formatMoney(e.time.hourlyCost)} la hora) · uso efectivo: ${formatMoney(e.variablePerActiveDay)} por día de trabajo`));
    assert.equal(norm(timeEquipmentOwnershipHint(e)), norm(`Tenerlo en el mes ${formatMoney(e.ownership.totalMonthly)} ÷ 176 horas por mes (si trabaja todo el mes a este ritmo) × 8 h del día de trabajo.`));
    // Lo de cada día incluye tenerlo (el motor lo deja aparte de la operación).
    close(equipmentPerActiveDay(e), e.variablePerActiveDay + e.ownershipPerActiveDay);
  });

  test('sin costos fijos: no hay break-even que mostrar', () => {
    assert.equal(timeBasisWithoutFixed(computeQuote(generatorJob())), true);
  });
});

describe('Cotización guardada (sin costBasis): todo igual que antes', () => {
  test('los helpers nuevos no dicen nada y los de siempre hablan de sueldo del mes', () => {
    const r = computeQuote(generatorJob({ time: false }));
    const l = r.model.labor.lines[0];
    const e = r.model.equipment[0];
    assert.ok(!r.model.timeBasis);
    assert.equal(timeLaborCostText(r, l), '');
    assert.equal(timeEquipmentUseText(e), '');
    assert.equal(timeEquipmentOwnershipHint(e), '');
    close(equipmentPerActiveDay(e), e.variablePerActiveDay);
    assert.equal(timeBasisWithoutFixed(r), false);
    assert.equal(norm(closedLaborCostText(r, l)), norm(`Sueldo con cargas ${formatMoney(l.fixedMonthly)}`));
    const stat = laborHourStat(l, 176);
    close(stat.value, l.perPerson.loadedHourlyCost);
    assert.equal(norm(stat.hint), 'Costo por mes ÷ 176 horas normales por mes.');
  });

  test('las horas que vende cargadas no cambian la hora de una cotización guardada', () => {
    const r = computeQuote(generatorJob({ time: false, billable: 140 }));
    const stat = laborHourStat(r.model.labor.lines[0], 176);
    close(stat.value, r.model.labor.lines[0].perPerson.loadedHourlyCost);
  });

  test('cobrando por mes rige el método de siempre aunque la cotización sea nueva', () => {
    resetIds();
    const q = service({ id: 'tu3', serviceType: 'monthly', unit: 'month', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 8, availableDaysPerMonth: 30 }, labor: [person()] });
    q.costBasis = 'time';
    const r = computeQuote(q);
    assert.ok(!r.model.timeBasis);
    assert.equal(timeLaborCostText(r, r.model.labor.lines[0]), '');
    assert.equal(timeBasisWithoutFixed(r), false);
  });
});

/** Precio cerrado largo: 1 operario, 45 días × 8 h (más que los 30 días del mes), con un generador. */
function longJob({ time = true } = {}) {
  const q = generatorJob({ time });
  q.activity.daysPerActivation = 45;
  return q;
}

describe('Revisión UX (2026-11-18): textos por tiempo usado', () => {
  test('I4: trabajo de 45 días: se cotizan las horas de esos días, sin meses de sueldo', () => {
    const r = computeQuote(longJob());
    assert.equal(norm(longClosedJobNote(r)), 'El trabajo dura 45 días: se cotizan las horas de tu gente y tus equipos en esos días.');
  });

  test('I4: la cotización guardada de 45 días sigue diciendo los meses de sueldo', () => {
    const r = computeQuote(longJob({ time: false }));
    assert.equal(norm(longClosedJobNote(r)), 'El trabajo dura 1,5 meses (45 días; el mes tiene 30 días disponibles): se pagan 1,5 meses de sueldo y de gastos fijos. Está bien así, no es un error.');
  });

  test('M1: equipo en precio cerrado, en el trabajo: tenerlo + usarlo = el costo del equipo', () => {
    const r = computeQuote(generatorJob());
    const e = r.model.equipment[0];
    const own = e.ownershipPerActiveDay * 3;
    const use = e.variablePerActiveDay * 3;
    assert.equal(norm(timeEquipmentJobText(r, e)), norm(`Asignado: 8 h × 3 días × ${formatMoney(e.time.hourlyCost)} la hora = ${formatMoney(own)} · uso efectivo (combustible y mantenimiento): ${formatMoney(use)} · en el trabajo`));
    close(own, e.time.hourlyCost * 8 * 3);
  });

  test('M3: total de Equipos sin fijo ni variable', () => {
    const r = computeQuote(generatorJob());
    const e = r.model.equipment[0];
    const own = e.ownershipPerActiveDay * 3;
    const use = e.variablePerActiveDay * 3;
    assert.equal(norm(timeEquipmentTotalText(r)), norm(`${formatMoney(own + use)} en el trabajo: asignados ${formatMoney(own)} + uso efectivo ${formatMoney(use)}.`));
    assert.ok(!/fijo|variable/i.test(timeEquipmentTotalText(r)));
  });

  test('M3: por hora, lo de cada día de trabajo', () => {
    resetIds();
    const q = hourly();
    q.equipment = [owned({ name: 'Camioneta', replacementValue: 40_000_000, usefulLifeYears: 8, fuelLitersPerHour: 2 })];
    const r = computeQuote(q);
    const e = r.model.equipment[0];
    assert.equal(norm(timeEquipmentTotalText(r)), norm(`${formatMoney(e.ownershipPerActiveDay + e.variablePerActiveDay)} por día de trabajo: asignados ${formatMoney(e.ownershipPerActiveDay)} + uso efectivo ${formatMoney(e.variablePerActiveDay)}.`));
    assert.equal(timeEquipmentJobText(r, e), '');
  });

  test('I7: la hora de tenerlo y las horas del mes por defecto (lo que reporta el motor)', () => {
    const q = generatorJob();
    q.activity.hoursPerActiveDay = 10;
    const r = computeQuote(q);
    const e = r.model.equipment[0];
    // Sin dato: 10 h × 22 días = 220 h (más que las 176 de la gente).
    close(e.time.billableHoursPerMonth, 220);
    assert.equal(norm(timeEquipmentHourHint(e)), norm(`Tenerlo en el mes ${formatMoney(e.ownership.totalMonthly)} ÷ 220 horas por mes (si trabaja todo el mes a este ritmo).`));
    q.equipment[0].billableHoursPerMonth = 120;
    const e2 = computeQuote(q).model.equipment[0];
    assert.ok(/120 horas que lo usás o alquilás por mes/.test(norm(timeEquipmentHourHint(e2))));
  });

  test('I8: "1 persona × 24 h × $ X la hora" y "Generador: 24 h × $ Y la hora" en precio cerrado', () => {
    const r = computeQuote(generatorJob());
    const l = r.model.labor.lines[0];
    const e = r.model.equipment[0];
    assert.equal(norm(timeStaffHoursText(r, l)), norm(`1 persona × 24 h × ${formatMoney(l.time.hourlyCost)} la hora`));
    assert.equal(norm(timeEquipmentHoursText(r, e)), norm(`Generador: 24 h × ${formatMoney(e.time.hourlyCost)} la hora`));
  });

  test('I8: por hora, "2 personas × 8 h por día × $ X la hora"', () => {
    const r = computeQuote(hourly());
    const l = r.model.labor.lines[0];
    assert.equal(norm(timeStaffHoursText(r, l)), norm(`2 personas × 8 h por día × ${formatMoney(l.time.hourlyCost)} la hora`));
  });

  test('M7: el rótulo de las horas facturables', () => {
    assert.equal(BILLABLE_HOURS_LABEL, 'Horas que le cobrás a clientes por mes (opcional)');
  });

  test('cotización guardada: los textos nuevos no dicen nada', () => {
    const r = computeQuote(generatorJob({ time: false }));
    const l = r.model.labor.lines[0];
    const e = r.model.equipment[0];
    assert.equal(timeEquipmentJobText(r, e), '');
    assert.equal(timeEquipmentTotalText(r), '');
    assert.equal(timeEquipmentHourHint(e), '');
    assert.equal(timeStaffHoursText(r, l), '');
    assert.equal(timeEquipmentHoursText(r, e), '');
    assert.equal(longClosedJobNote(r), '');
  });
});
