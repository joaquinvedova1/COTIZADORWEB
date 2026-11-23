/**
 * 0.20.0 (2026-11-23): la cotización en la unidad de cobro.
 *  - Cobro por mes: un equipo con "horas asignado por mes" no anda más horas que las asignadas
 *    (CALCULATION_RULES §36.3). Antes su uso contaba el día entero de servicio.
 *  - Por tiempo usado un vehículo se trata como cualquier equipo: horas de uso vacías = las
 *    asignadas (valor hora completo). Antes nacía con 0 h y un camión que trabaja no sumaba su uso.
 *  - Presentación: una cifra del mes se dice primero en la unidad de cobro.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { capMonthlyRunningHours } from '../../js/domain/cost-basis.js';
import { stepOfPath } from '../../js/ui/field-links.js';
import { unitAmountText, perBilledUnitAmount, costPlaceLabel } from '../../js/ui/result-text.js';
import { service, owned } from '../lab/lib/build.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const crane = (o = {}) => owned({ name: 'Hidrogrúa', replacementValue: 96000000, usefulLifeYears: 8, billableHoursPerMonth: 200, fuelLitersPerHour: 10, maintenancePerHour: 1000, ...o });
const monthly = (equipment) => service({ unit: 'month', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 9 }, labor: [], equipment });

test('abono por mes: hidrogrúa asignada 20 h por mes usa 20 h, no 22 días × 9 h', () => {
  const full = computeQuote(monthly([crane({ hoursPerActiveDay: 9 })])).model.equipment[0];
  near(full.hoursPerActiveDay * 22, 198);
  const part = computeQuote(monthly([crane({ hoursPerActiveDay: 9, assignedHoursPerMonth: 20, assignment: 'shared', fixedCostSharePct: 10 })])).model.equipment[0];
  near(part.hoursPerActiveDay * 22, 20);
  near(part.variablePerActiveDay * 22, full.variablePerActiveDay * 22 * (20 / 198));
});

test('abono por mes: horas de uso más bajas que el tope se respetan; sin horas asignadas no cambia nada', () => {
  const low = monthly([crane({ hoursPerActiveDay: 0.5, assignedHoursPerMonth: 20 })]);
  assert.equal(capMonthlyRunningHours(low, { activeDaysPerMonth: 22, hoursPerActiveDay: 9 }), low);
  const none = monthly([crane({ hoursPerActiveDay: 9 })]);
  assert.equal(capMonthlyRunningHours(none, { activeDaysPerMonth: 22, hoursPerActiveDay: 9 }), none);
  // Horas de uso vacías: valen el día de servicio, y también se topean.
  const blank = monthly([crane({ hoursPerActiveDay: null, assignedHoursPerMonth: 44 })]);
  near(capMonthlyRunningHours(blank, { activeDaysPerMonth: 22, hoursPerActiveDay: 9 }).equipment[0].hoursPerActiveDay, 2);
  // Alquilado o por tiempo usado: no aplica. No muta la cotización.
  const rented = monthly([{ ...crane({ assignedHoursPerMonth: 20, hoursPerActiveDay: 9 }), acquisition: 'rented' }]);
  assert.equal(capMonthlyRunningHours(rented, { activeDaysPerMonth: 22, hoursPerActiveDay: 9 }), rented);
  const before = JSON.stringify(blank);
  computeQuote(blank);
  assert.equal(JSON.stringify(blank), before);
});

test('por tiempo usado: un vehículo agregado desde Recursos queda con las horas de uso vacías (valor hora completo)', () => {
  const s = readFileSync(new URL('../../js/ui/views/quote-steps/equipment.js', import.meta.url), 'utf8');
  assert.match(s, /line\.hoursPerActiveDay = timeBasis \? null : 0;/);
  const truck = owned({ name: 'Camión', replacementValue: 96000000, usefulLifeYears: 8, billableHoursPerMonth: 200, fuelLitersPerHour: 10, maintenancePerHour: 1000, hoursPerActiveDay: null });
  const q = service({ unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [], equipment: [truck] });
  q.costBasis = 'time';
  const l = computeQuote(q).model.equipment[0];
  near(l.variablePerActiveDay, 8 * (10 * q.fuel.pricePerLiter + 1000));
  const parked = computeQuote({ ...q, equipment: [{ ...truck, hoursPerActiveDay: 0 }] }).model.equipment[0];
  assert.equal(parked.variablePerActiveDay, 0);
});

test('el ritmo se carga en el paso 1; la guardia sigue en "Cómo se cobra"', () => {
  ['activeDaysPerMonth', 'billableQuantityPerMonth', 'unitsPerActiveDay', 'hoursPerActiveDay', 'daysPerActivation'].forEach((k) => assert.equal(stepOfPath(`activity.${k}`), 'service', k));
  ['availability', 'availabilityHoursPerDay', 'guardType'].forEach((k) => assert.equal(stepOfPath(`activity.${k}`), 'modality', k));
  assert.equal(stepOfPath('pricing.knownRate'), 'modality');
});

test('una cifra del mes se dice primero en la unidad de cobro', () => {
  const r = { contract: { mode: 'on_demand' }, estimate: { revenue: { billableUnits: 40 } } };
  const q = { unit: 'custom', unitName: 'válvula' };
  assert.equal(perBilledUnitAmount(r, q, 4000000), 100000);
  assert.equal(unitAmountText(r, q, 4000000).replace(/ /g, ' '), '$ 100.000 por válvula · $ 4.000.000 por mes');
  assert.equal(costPlaceLabel(r, q, 'Equipos'), 'Equipos en el costo por válvula');
  // Por mes o sin unidades cargadas: como siempre, por mes.
  assert.equal(perBilledUnitAmount(r, { unit: 'month' }, 4000000), null);
  assert.equal(costPlaceLabel(r, { unit: 'month' }, 'Equipos'), 'Equipos en el costo del mes');
  assert.equal(perBilledUnitAmount({ ...r, estimate: { revenue: { billableUnits: 0 } } }, q, 4000000), null);
  assert.equal(unitAmountText({ ...r, estimate: { revenue: { billableUnits: 0 } } }, q, 4000000).replace(/\u00a0/g, ' '), '$ 4.000.000 por mes');
});
