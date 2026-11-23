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

// ---- 0.19.0: horas del recurso en la unidad de cobro (CALCULATION_RULES §36.2) ----
import { resourceHoursBasis, unitHoursConversion, showsPerUnit, unitHoursFactor, resolveUnitHours } from '../../js/domain/cost-basis.js';
import { applyUnitChange } from '../../js/domain/unit-change.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';

const valveQuote = (o = {}) => {
  const q = service({
    unit: 'custom', unitName: 'válvula',
    activity: { hoursPerActiveDay: 8, billableQuantityPerMonth: 40, unitsPerActiveDay: 4 },
    labor: [person({ role: 'Operador', assignedHoursPerUnit: 1.5 })],
    equipment: [crane({ assignedHoursPerUnit: 0.5 })],
    ...o,
  });
  q.costBasis = 'time';
  return q;
};

test('en qué se piden las horas: por trabajo o por día (0.20.0: por cantidad, por día con el rendimiento del paso 1)', () => {
  assert.equal(resourceHoursBasis(valveQuote()), 'day');
  // El dato "horas por válvula" cargado en la 0.19.0 se sigue convirtiendo; por m³ no existe.
  assert.equal(unitHoursConversion(valveQuote()), 'unit');
  assert.equal(unitHoursConversion(valveQuote({ unit: 'm3' })), null);
  assert.equal(unitHoursConversion(valveQuote({ unit: 'job' })), 'job');
  assert.equal(showsPerUnit(valveQuote()), true);
  assert.equal(showsPerUnit(valveQuote({ unit: 'm3' })), true);
  assert.equal(showsPerUnit(valveQuote({ unit: 'day' })), false);
  const job = valveQuote({ unit: 'job' });
  assert.equal(resourceHoursBasis(job), 'job');
  ['day', 'hour', 'km', 'm3', 'manhour'].forEach((unit) => assert.equal(resourceHoursBasis(valveQuote({ unit })), 'day', unit));
  assert.equal(resourceHoursBasis(valveQuote({ unit: 'month' })), null);
  const old = valveQuote();
  delete old.costBasis;
  assert.equal(resourceHoursBasis(old), null);
});

test('por válvula: 0,5 h de grúa × 4 válvulas por día = 2 h por día; el costo por válvula no depende del ritmo', () => {
  const r = computeQuote(valveQuote());
  const grua = r.model.equipment[0];
  const op = r.model.labor.lines[0];
  assert.equal(grua.time.hoursPerDay, 2);
  near(grua.ownershipPerActiveDay, 2 * 5000);
  near(grua.variablePerActiveDay, 2 * (10 * 1500 + 1000));
  assert.equal(op.time.hoursPerDay, 6);
  // Mismo resultado que cargar las horas por día a mano.
  const byDay = valveQuote({ labor: [person({ role: 'Operador', coverageHoursPerDay: 6 })], equipment: [crane({ assignedHoursPerDay: 2 })] });
  near(computeQuote(byDay).kpis.totalCost, r.kpis.totalCost);
  // Con otro ritmo (2 válvulas por día) el costo de grúa por válvula es el mismo: 0,5 h × valor hora.
  const slow = valveQuote();
  slow.activity.unitsPerActiveDay = 2;
  const g2 = computeQuote(slow).model.equipment[0];
  near((g2.ownershipPerActiveDay + g2.variablePerActiveDay) / 2, (grua.ownershipPerActiveDay + grua.variablePerActiveDay) / 4);
});

test('por trabajo: 6 h de grúa en un trabajo de 3 días = 2 h por día', () => {
  const q = valveQuote({ unit: 'job', activity: { hoursPerActiveDay: 8, billableQuantityPerMonth: 1, daysPerActivation: 3 }, labor: [], equipment: [crane({ assignedHoursPerUnit: 6 })] });
  const r = computeQuote(q);
  near(r.activity.activeDaysPerMonth, 3);
  assert.equal(r.model.equipment[0].time.hoursPerDay, 2);
  near(r.model.equipment[0].ownershipPerActiveDay * 3, 6 * 5000);
});

test('sin rendimiento cargado, cobro por día o equipo alquilado: las horas en la unidad no se aplican', () => {
  assert.equal(unitHoursFactor('unit', { unitsPerActiveDay: 0 }), 0);
  const q = valveQuote();
  q.activity.unitsPerActiveDay = null;
  assert.equal(resolveUnitHours(q, { unitsPerActiveDay: 0 }), q);
  const day = valveQuote({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 } });
  assert.equal(computeQuote(day).model.equipment[0].time.hoursPerDay, 8);
  const rented = valveQuote();
  rented.equipment[0].acquisition = 'rented';
  const out = resolveUnitHours(rented, { unitsPerActiveDay: 4 });
  assert.equal(out.equipment[0].assignedHoursPerDay, rented.equipment[0].assignedHoursPerDay);
  // No muta la cotización.
  const before = JSON.stringify(q);
  computeQuote(valveQuote());
  assert.equal(JSON.stringify(q), before);
});

test('más horas que el día de trabajo no se cuentan; validación 0–744', () => {
  const q = valveQuote({ equipment: [crane({ assignedHoursPerUnit: 5 })] });
  assert.equal(computeQuote(q).model.equipment[0].time.hoursPerDay, 8);
  q.equipment[0].assignedHoursPerUnit = -1;
  q.labor[0].assignedHoursPerUnit = 800;
  const paths = validateQuote(q).map((i) => i.path);
  ['labor.0.assignedHoursPerUnit', 'equipment.0.assignedHoursPerUnit'].forEach((p) => assert.ok(paths.includes(p), p));
});

test('al cambiar la unidad de cobro se limpian las horas cargadas en la anterior, con aviso', () => {
  const q = valveQuote();
  const from = billingUnitOf(q);
  const notices = applyUnitChange(q, from, billingUnitOf({ ...q, unit: 'day' }));
  assert.equal(q.labor[0].assignedHoursPerUnit, null);
  assert.equal(q.equipment[0].assignedHoursPerUnit, null);
  assert.ok(notices.some((n) => /horas de cada recurso/.test(n)), notices.join(' | '));
});

test('horas por encima del día de trabajo: aviso en la línea (no se recorta en silencio)', () => {
  const q = valveQuote({ equipment: [crane({ assignedHoursPerUnit: 3 })] }); // 3 h × 4 válvulas = 12 h > 8 h
  const issues = computeQuote(q).issues.filter((i) => /no se están contando/.test(i.message));
  assert.deepEqual(issues.map((i) => i.path), ['equipment.0.assignedHoursPerUnit']);
  const day = service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person({ coverageHoursPerDay: 10 })] });
  day.costBasis = 'time';
  assert.ok(computeQuote(day).issues.some((i) => i.path === 'labor.0.coverageHoursPerDay' && /no se están contando/.test(i.message)));
  assert.ok(!computeQuote(valveQuote()).issues.some((i) => /no se están contando/.test(i.message)));
});

test('equipo con horas andando heredadas por encima de las asignadas: el motor cuenta las andando y avisa', () => {
  const q = valveQuote({ equipment: [crane({ assignedHoursPerUnit: 0.5, hoursPerActiveDay: 8 })] });
  const r = computeQuote(q);
  assert.equal(r.model.equipment[0].time.hoursPerDay, 8);
  assert.ok(r.issues.some((i) => i.path === 'equipment.0.hoursPerActiveDay' && /con el motor andando/.test(i.message)));
  assert.ok(!computeQuote(valveQuote()).issues.some((i) => /con el motor andando/.test(i.message)));
});
