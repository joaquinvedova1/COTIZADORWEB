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
    assert.equal(norm(stat.hint), 'Costo por mes ÷ 140 horas que vende por mes.');
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
    assert.equal(norm(timeEquipmentUseText(e)), norm(`Tenerlo: ${formatMoney(e.ownershipPerActiveDay)} por día de trabajo (8 h × ${formatMoney(e.time.hourlyCost)} la hora) · usarlo: ${formatMoney(e.variablePerActiveDay)} por día de trabajo`));
    assert.equal(norm(timeEquipmentOwnershipHint(e)), norm(`Posesión del mes ${formatMoney(e.ownership.totalMonthly)} ÷ 176 horas que trabaja y factura por mes × 8 h del día.`));
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
