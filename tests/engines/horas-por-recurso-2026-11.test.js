/**
 * 0.18.0 (2026-11-20, pedido del dueño): cada recurso asignado dice sus horas en el trabajo.
 *  - Personal por tiempo usado: sus horas por día × el valor de su hora (ya regía, §29).
 *  - Equipo propio por tiempo usado: `assignedHoursPerDay` → tenerlo se cobra por esas horas (antes,
 *    siempre el día de trabajo entero). Sin dato: igual que antes.
 * Reglas: docs/CALCULATION_RULES.md §36.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEquipmentLine, assignedEquipmentHours } from '../../js/engines/equipment-engine.js';
import { computeLaborLine } from '../../js/engines/labor-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { service, person, owned } from '../lab/lib/build.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
// Posesión: 96.000.000 ÷ (8 años × 12) = 1.000.000 por mes; 200 h por mes → 5.000 la hora.
const crane = (o = {}) => owned({ name: 'Hidrogrúa', replacementValue: 96000000, usefulLifeYears: 8, billableHoursPerMonth: 200, fuelLitersPerHour: 10, maintenancePerHour: 1000, ...o });
const ctx = { fuelPricePerLiter: 1500, fuelPaidByUs: true, defaultHoursPerActiveDay: 8, timeBasis: true, defaultBillableHours: 176 };

test('equipo sin horas propias: tenerlo por el día de trabajo entero (como antes)', () => {
  const l = computeEquipmentLine(crane(), ctx);
  assert.equal(l.time.hoursPerDay, 8);
  assert.equal(l.time.ownHours, false);
  near(l.ownershipPerActiveDay, 8 * 5000);
  near(l.variablePerActiveDay, 8 * (10 * 1500 + 1000));
});

test('hidrogrúa 2 h por día en el trabajo: tenerla y usarla por 2 h', () => {
  const l = computeEquipmentLine(crane({ assignedHoursPerDay: 2 }), ctx);
  assert.equal(l.time.hoursPerDay, 2);
  assert.equal(l.time.ownHours, true);
  near(l.ownershipPerActiveDay, 2 * 5000);
  assert.equal(l.hoursPerActiveDay, 2);
  near(l.variablePerActiveDay, 2 * (10 * 1500 + 1000));
});

test('horas en el trabajo y horas andando distintas: cada costo sigue las suyas', () => {
  // 5 h en el trabajo, 1 h con el motor andando.
  const l = computeEquipmentLine(crane({ assignedHoursPerDay: 5, hoursPerActiveDay: 1 }), ctx);
  near(l.ownershipPerActiveDay, 5 * 5000);
  near(l.variablePerActiveDay, 1 * (10 * 1500 + 1000));
  // Vehículo que sólo viaja (0 h andando en la locación): paga tenerlo por sus horas.
  const v = computeEquipmentLine(crane({ assignedHoursPerDay: 3, hoursPerActiveDay: 0 }), ctx);
  near(v.ownershipPerActiveDay, 3 * 5000);
  assert.equal(v.variablePerActiveDay, 0);
});

test('nunca menos que las horas andando ni más que el día de trabajo', () => {
  // Dice 2 h en el trabajo pero 4 h andando: tenerlo por 4 h.
  near(computeEquipmentLine(crane({ assignedHoursPerDay: 2, hoursPerActiveDay: 4 }), ctx).ownershipPerActiveDay, 4 * 5000);
  // Dice 12 h con un día de trabajo de 8 h: 8 h.
  const over = computeEquipmentLine(crane({ assignedHoursPerDay: 12 }), ctx);
  assert.equal(over.time.hoursPerDay, 8);
  assert.equal(over.hoursPerActiveDay, 8);
  assert.equal(assignedEquipmentHours({ assignedHoursPerDay: 30 }, 0), 24);
  assert.equal(assignedEquipmentHours({ assignedHoursPerDay: 0 }, 8), 0);
  assert.equal(assignedEquipmentHours({}, 8), 0);
});

test('fuera de "por tiempo usado" el dato no cambia nada', () => {
  const base = { ...ctx, timeBasis: false };
  assert.deepEqual(computeEquipmentLine(crane({ id: 'e1', assignedHoursPerDay: 2 }), base), computeEquipmentLine(crane({ id: 'e1' }), base));
});

test('ejemplo del dueño: chofer 5 h y hidrogrúa 2 h por día, 10 días', () => {
  const q = service({
    unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
    labor: [person({ role: 'Chofer', coverageHoursPerDay: 5 })],
    equipment: [crane({ assignedHoursPerDay: 2, fuelLitersPerHour: 0, maintenancePerHour: 0 })],
  });
  q.costBasis = 'time';
  const r = computeQuote(q);
  const chofer = r.model.labor.lines[0];
  const grua = r.model.equipment[0];
  // Chofer: valor de la hora = costo del mes ÷ 176; 5 h por día.
  near(chofer.time.hourlyCost, chofer.perPerson.fixedMonthly / 176);
  near(chofer.variablePerActiveDay, 5 * chofer.time.hourlyCost);
  near(grua.ownershipPerActiveDay, 2 * 5000);
  // Con las 8 h del día para los dos, el costo sería mayor.
  const full = structuredClone(q);
  delete full.labor[0].coverageHoursPerDay;
  delete full.equipment[0].assignedHoursPerDay;
  assert.ok(computeQuote(full).kpis.totalCost > r.kpis.totalCost);
  assert.deepEqual(validateQuote(q).filter((i) => /assignedHours|coverageHours/.test(i.path)), []);
});

test('personal: las horas propias mandan hasta el día de trabajo', () => {
  const p = person({ coverageHoursPerDay: 5 });
  const l = computeLaborLine(p, { timeBasis: true, hoursPerActiveDay: 8, activeDaysPerMonth: 10 });
  assert.equal(l.time.hoursPerDay, 5);
  assert.equal(computeLaborLine(person({ coverageHoursPerDay: 12 }), { timeBasis: true, hoursPerActiveDay: 8 }).time.hoursPerDay, 8);
});

test('validación: horas por día 0–24 y horas por mes 0–744', () => {
  const q = service({ unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ coverageHoursPerDay: 30, assignedHoursPerMonth: 800 })], equipment: [crane({ assignedHoursPerDay: 25, assignedHoursPerMonth: -1 })] });
  const paths = validateQuote(q).map((i) => i.path);
  ['labor.0.coverageHoursPerDay', 'labor.0.assignedHoursPerMonth', 'equipment.0.assignedHoursPerDay', 'equipment.0.assignedHoursPerMonth'].forEach((p) => assert.ok(paths.includes(p), p));
});

test('avisos: cobro por hora de equipo compara con las horas en el trabajo; sin horas del día no se pide el uso', () => {
  const q = service({ unit: 'equipment_hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8, billableQuantityPerMonth: 20, unitsPerActiveDay: 2 }, equipment: [crane({ assignedHoursPerDay: 2 })] });
  q.costBasis = 'time';
  const issues = JSON.stringify(computeQuote(q).issues || []);
  assert.ok(!/lo cargado da 8/.test(issues), issues.slice(0, 400));
  const noDay = service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 0 }, equipment: [crane({ assignedHoursPerDay: 2 })] });
  noDay.costBasis = 'time';
  const r = computeQuote(noDay);
  assert.ok(!(r.completeness.pending || []).some((x) => x.id === 'equipment_hours'));
  near(r.model.equipment[0].ownershipPerActiveDay, 2 * 5000);
});
