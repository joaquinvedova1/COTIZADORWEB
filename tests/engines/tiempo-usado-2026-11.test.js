/**
 * Costo por tiempo usado (2026-11-18, pedido del dueño).
 *
 * En una cotización NUEVA que no se cobra por mes, el personal y los equipos propios cuestan las
 * horas que les lleva el trabajo × el valor de su hora (costo del mes ÷ horas facturables por mes).
 * No hay "% de su costo fijo". Las cotizaciones guardadas (sin `costBasis`) y las que se cobran por
 * mes calculan como siempre.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { usesTimeBasis, billableHoursOf, COST_BASIS_TIME } from '../../js/domain/cost-basis.js';
import { withTimeCostBasis, equipmentBillableHours, equipmentLineFromLibrary, laborLineFromProfile } from '../../js/domain/quote-factory.js';
import { resourceUsage } from '../../js/domain/resource-usage.js';
import { computeLabor } from '../../js/engines/labor-engine.js';
import { computeEquipmentLine } from '../../js/engines/equipment-engine.js';
import { buildCostModel, costAtActivity, defaultEquipmentBillableHours } from '../../js/engines/cost-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { service, person, owned, resetIds } from '../lab/lib/build.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// Operario: $ 2.000.000 por mes con cargas (básico 1.000.000 × 2), 176 h normales → hora $ 11.363,64.
const operario = (o = {}) => person({ basicMonthly: 1000000, sacPct: 0, vacationPct: 0, employerContributionsPct: 100, artPct: 0, normalHoursPerMonth: 176, ...o });
// Sin estructura, financiación, imprevistos ni impuestos: el costo es sólo el directo.
const plain = { indirect: { method: 'percent_direct', pct: 0, amount: 0 }, finance: { monthlyRatePct: 0 }, risk: { generalPct: 0, items: [] }, billingTaxes: null };
// Instalación de un generador: precio cerrado, 1 trabajo de 3 días de 8 h.
const instalacion = (o = {}) => {
  resetIds();
  const q = service({ unit: 'job', serviceType: 'lump_sum', activity: { billableQuantityPerMonth: 1, daysPerActivation: 3, hoursPerActiveDay: 8 }, labor: [operario()], ...plain, ...o });
  q.contract = { mode: 'closed', labor: true, equipment: false };
  return q;
};
const timed = (q) => ({ ...q, costBasis: COST_BASIS_TIME });

describe('Cuándo rige el costo por tiempo usado', () => {
  test('sólo con costBasis "time" y sin cobrar por mes', () => {
    assert.equal(usesTimeBasis({ costBasis: 'time', unit: 'job' }), true);
    assert.equal(usesTimeBasis({ costBasis: 'time', unit: 'hour' }), true);
    assert.equal(usesTimeBasis({ costBasis: 'time', unit: 'm3' }), true);
    assert.equal(usesTimeBasis({ costBasis: 'time', unit: 'month' }), false);
    assert.equal(usesTimeBasis({ unit: 'job' }), false);
    assert.equal(usesTimeBasis({ costBasis: 'otro', unit: 'job' }), false);
    assert.equal(usesTimeBasis(null), false);
  });

  test('horas facturables: las cargadas o, si no hay, las normales', () => {
    assert.equal(billableHoursOf({ billableHoursPerMonth: 140 }, 176), 140);
    assert.equal(billableHoursOf({ billableHoursPerMonth: null }, 176), 176);
    assert.equal(billableHoursOf({ billableHoursPerMonth: 0 }, 176), 176);
    assert.equal(billableHoursOf({ billableHoursPerMonth: 'x' }, 176), 176);
    assert.equal(billableHoursOf({}, 0), 0);
  });
});

describe('Personal por tiempo usado', () => {
  test('la instalación de 3 días paga 24 h del operario, no su mes', () => {
    const legacy = buildCostModel(instalacion());
    const m = buildCostModel(timed(instalacion()));
    // Como siempre (sin elegir dedicación): el mes entero.
    assert.equal(legacy.fixedMonthly, 2000000);
    assert.equal(legacy.variablePerActiveDay, 0);
    // Por tiempo usado: 8 h × $ 11.363,64 por día; nada fijo.
    assert.equal(m.timeBasis, true);
    assert.equal(m.fixedMonthly, 0);
    near(m.variablePerActiveDay, (2000000 / 176) * 8);
    near(costAtActivity(m, 3).total, 272727.27);
    const l = m.labor.lines[0];
    assert.equal(l.timeBasis, true);
    assert.equal(l.time.billableHoursPerMonth, 176);
    assert.equal(l.time.hoursPerDay, 8);
    near(l.time.hourlyCost, 11363.64);
    assert.equal(l.unassignedFixedMonthly, 0);
  });

  test('es lo mismo que el método de siempre con el % exacto de horas (24 ÷ 176)', () => {
    const shared = instalacion({ labor: [operario({ assignment: 'shared', fixedCostSharePct: (24 / 176) * 100 })] });
    near(costAtActivity(buildCostModel(shared), 3).total, costAtActivity(buildCostModel(timed(instalacion())), 3).total, 1e-6);
  });

  test('con 140 h facturables por mes la hora sube y cubre el tiempo libre', () => {
    const m = buildCostModel(timed(instalacion({ labor: [operario({ billableHoursPerMonth: 140 })] })));
    near(m.labor.lines[0].time.hourlyCost, 2000000 / 140);
    near(costAtActivity(m, 3).total, 342857.14);
    assert.equal(m.labor.lines[0].perPerson.ownBillableHours, true);
  });

  test('el precio del trabajo no depende de cuántos trabajos se hacen por mes', () => {
    const price = (jobs) => {
      const q = timed(instalacion());
      q.activity.billableQuantityPerMonth = jobs;
      q.pricing.targetMarginPct = 20;
      q.pricing.roundingStep = 0;
      return computeQuote(q).kpis.targetListRate;
    };
    near(price(1), 272727.27 / 0.8);
    near(price(1), price(4), 1e-6);
    near(price(1), price(0.5), 1e-6);
  });

  test('varias personas: cada posición cuesta sus horas; los relevos no suman', () => {
    const m = buildCostModel(timed(instalacion({ labor: [operario({ positions: 2, peoplePerPosition: 2 })] })));
    near(m.variablePerActiveDay, 2 * (2000000 / 176) * 8);
  });

  test('las horas propias del puesto (si son menos que las del servicio) mandan', () => {
    const m = buildCostModel(timed(instalacion({ labor: [operario({ coverageHoursPerDay: 4 })] })));
    near(m.variablePerActiveDay, (2000000 / 176) * 4);
    const more = buildCostModel(timed(instalacion({ labor: [operario({ coverageHoursPerDay: 12 })] })));
    near(more.variablePerActiveDay, (2000000 / 176) * 8);
  });

  test('vianda y seguros: la vianda sigue por día; los seguros del mes van dentro de la hora', () => {
    const m = buildCostModel(timed(instalacion({ labor: [operario({ mealPerActiveDay: 10000, insuranceMonthly: 176000 })] })));
    near(m.variablePerActiveDay, ((2000000 + 176000) / 176) * 8 + 10000);
  });

  test('el % de costo fijo cargado se ignora (no hay dedicación por tiempo usado)', () => {
    const q = timed(instalacion({ labor: [operario({ assignment: 'shared', fixedCostSharePct: 10 })] }));
    const m = buildCostModel(q);
    near(costAtActivity(m, 3).total, 272727.27);
    assert.equal(m.labor.lines[0].shared, false);
    assert.equal(validateQuote({ ...q, labor: [operario({ assignment: 'shared', fixedCostSharePct: null })] }).some((i) => /fixedCostSharePct/.test(i.path)), false);
    // En una guardada sí se sigue pidiendo.
    const legacy = instalacion({ labor: [operario({ assignment: 'shared', fixedCostSharePct: null })] });
    assert.equal(validateQuote(legacy).some((i) => /fixedCostSharePct/.test(i.path)), true);
  });

  test('sin horas por día cargadas no hay costo de tiempo: la completitud las pide en rojo', () => {
    const q = timed(instalacion());
    q.activity.hoursPerActiveDay = null;
    assert.equal(buildCostModel(q).variablePerActiveDay, 0);
    const item = computeQuote(q).completeness.items.find((i) => i.id === 'time_hours');
    assert.equal(item.status, 'missing');
    assert.equal(item.focus, 'activity.hoursPerActiveDay');
    // Con horas, o en una guardada, no aparece.
    assert.equal(computeQuote(timed(instalacion())).completeness.items.some((i) => i.id === 'time_hours'), false);
    const legacy = instalacion();
    legacy.activity.hoursPerActiveDay = null;
    assert.equal(computeQuote(legacy).completeness.items.some((i) => i.id === 'time_hours'), false);
  });

  test('puesto sin horas normales ni facturables: se pide el dato (su hora no sale)', () => {
    const q = timed(instalacion({ labor: [operario({ normalHoursPerMonth: 0 })] }));
    const item = computeQuote(q).completeness.items.find((i) => i.id === 'time_hour_value');
    assert.equal(item.status, 'missing');
    assert.match(item.focus, /^labor\.0\.normalHoursPerMonth$/);
    const ok = timed(instalacion({ labor: [operario({ normalHoursPerMonth: 0, billableHoursPerMonth: 160 })] }));
    assert.equal(computeQuote(ok).completeness.items.some((i) => i.id === 'time_hour_value'), false);
  });

  test('un % compartido que quedó en la línea no avisa (no rige)', () => {
    const q = timed(instalacion({ labor: [operario({ assignment: 'shared', fixedCostSharePct: 30 })] }));
    assert.equal((computeQuote(q).completeness.notices || []).some((n) => n.id === 'shared_fixed'), false);
  });
});

describe('Cobrando por mes o en una cotización guardada: como siempre', () => {
  test('por mes con costBasis "time": el recurso queda asignado al servicio (mes completo)', () => {
    resetIds();
    const q = timed(service({ unit: 'month', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 8 }, labor: [operario()], ...plain }));
    const m = buildCostModel(q);
    assert.equal(m.timeBasis, false);
    assert.equal(m.fixedMonthly, 2000000);
    assert.equal(m.labor.lines[0].time, null);
    // Y con una parte del mes asignada: el % sigue rigiendo.
    resetIds();
    const part = timed(service({ unit: 'month', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 8 }, labor: [operario({ assignment: 'shared', fixedCostSharePct: 25 })], ...plain }));
    assert.equal(buildCostModel(part).fixedMonthly, 500000);
  });

  test('una cotización guardada (sin costBasis) no cambia aunque el recurso traiga horas facturables', () => {
    const base = computeQuote(instalacion());
    const withHours = computeQuote(instalacion({ labor: [operario({ billableHoursPerMonth: 140 })] }));
    assert.equal(withHours.kpis.totalCost, base.kpis.totalCost);
    assert.equal(withHours.model.fixedMonthly, 2000000);
    assert.equal(withHours.model.timeBasis, false);
  });
});

describe('Equipos propios por tiempo usado', () => {
  // Posesión: (120.000.000 − 0) ÷ (10 × 12) = 1.000.000 por mes + seguro 240.000 ÷ 12 = 20.000.
  const generador = (o = {}) => owned({ replacementValue: 120000000, usefulLifeYears: 10, insuranceAnnual: 240000, maintenancePerHour: 1000, hoursPerActiveDay: 2, ...o });

  test('tenerlo cuesta las horas del día de trabajo, aunque el motor ande menos', () => {
    const m = buildCostModel(timed(instalacion({ equipment: [generador()] })));
    const e = m.equipment[0];
    assert.equal(e.timeBasis, true);
    assert.equal(e.fixedMonthly, 0);
    // Sin dato propio: las horas normales de la cuadrilla (176). Ocupado 8 h por día.
    assert.equal(e.time.billableHoursPerMonth, 176);
    near(e.ownershipPerActiveDay, (1020000 / 176) * 8);
    near(e.ownershipCashPerActiveDay, (20000 / 176) * 8);
    // La operación sigue a las horas de uso (2 h).
    assert.equal(e.nonFuelPerActiveDay, 2000);
    near(m.variablePerActiveDay, (2000000 / 176) * 8 + (1020000 / 176) * 8 + 2000);
    assert.equal(m.fixedMonthly, 0);
  });

  test('sin dato, un equipo que trabaja todo el mes paga una vez su posesión (no varias)', () => {
    assert.equal(defaultEquipmentBillableHours(8, 176), 176);
    assert.equal(defaultEquipmentBillableHours(10, 176), 220);
    assert.equal(defaultEquipmentBillableHours(24, 176), 720);
    assert.equal(defaultEquipmentBillableHours(0, 176), 176);
    // Generador 24 h, 30 días, por día: 30 × 24 h ÷ 720 h = un mes de posesión.
    resetIds();
    const q = timed(service({ unit: 'day', activity: { activeDaysPerMonth: 30, hoursPerActiveDay: 24 }, labor: [], equipment: [generador({ hoursPerActiveDay: null, maintenancePerHour: 0 })], ...plain }));
    near(costAtActivity(buildCostModel(q), 30).total, 1020000);
  });

  test('con horas facturables propias (ficha de Recursos)', () => {
    const line = computeEquipmentLine(generador({ billableHoursPerMonth: 120, quantity: 2 }), { defaultHoursPerActiveDay: 8, timeBasis: true, defaultBillableHours: 176 });
    near(line.ownershipPerActiveDay, (1020000 / 120) * 8 * 2);
    assert.equal(line.time.ownBillableHours, true);
  });

  test('sin personal: las horas normales por defecto', () => {
    const m = buildCostModel(timed(instalacion({ labor: [], equipment: [generador()] })));
    assert.ok(m.equipment[0].time.billableHoursPerMonth > 0);
  });

  test('la línea que viene de Recursos trae disponibles × utilización', () => {
    assert.equal(equipmentBillableHours({ availableHoursPerMonth: 240, utilizationPct: 60 }), 144);
    assert.equal(equipmentBillableHours({ availableHoursPerMonth: 240, utilizationPct: 0 }), null);
    assert.equal(equipmentBillableHours({}), null);
    assert.equal(equipmentBillableHours({ billableHoursPerMonth: 100, availableHoursPerMonth: 240, utilizationPct: 60 }), 100);
    const line = equipmentLineFromLibrary({ id: 'eq-1', name: 'Generador', availableHoursPerMonth: 240, utilizationPct: 60 }, { id: 'e-1', now: '2026-11-18T00:00:00.000Z' });
    assert.equal(line.billableHoursPerMonth, 144);
    assert.equal(equipmentLineFromLibrary({ id: 'x', acquisition: 'rented', availableHoursPerMonth: 240, utilizationPct: 60 }, { id: 'e-2', now: '2026-11-18T00:00:00.000Z' }).billableHoursPerMonth, null);
  });

  test('alquilados y tercerizados no cambian', () => {
    const rented = { id: 'r', name: 'Grúa', acquisition: 'rented', quantity: 1, hoursPerActiveDay: 8, external: { price: 100000, unit: 'day' } };
    const a = buildCostModel(instalacion({ labor: [], equipment: [rented] }));
    const b = buildCostModel(timed(instalacion({ labor: [], equipment: [rented] })));
    assert.equal(costAtActivity(b, 3).total, costAtActivity(a, 3).total);
  });
});

describe('Lo que se apoya en el personal', () => {
  test('estructura por empleado: sigue a las horas del trabajo', () => {
    const q = timed(instalacion({ indirect: { method: 'per_employee', pct: 0, amount: 176000 } }));
    const m = buildCostModel(q);
    // 176.000 por empleado y por mes × (8 h ÷ 176 h) = 8.000 por día de trabajo.
    near(m.structure.variablePerActiveDay, 8000);
    assert.equal(m.structure.fixedMonthly, 0);
    near(m.labor.effectiveHeadcount, 24 / 176);
  });

  test('horas extra de todo el trabajo: sólo el recargo sobre cada hora', () => {
    const q = timed(instalacion());
    q.activity.hoursPerActiveDay = 10;
    q.overtimeWork = { mode: 'all', premiumPct: 50 };
    const m = buildCostModel(q);
    // hora de sueldo con cargas 11.363,64 · al 50 % 17.045,45 · recargo 5.681,82 por hora
    near(m.overtimeWork.monthlyAtEstimate, 30 * (2000000 / 176) * 0.5);
    near(costAtActivity(m, 3).total, 30 * (2000000 / 176) * 1.5);
    // Es lineal: con otros días no hay ajuste.
    near(costAtActivity(m, 45).total, 450 * (2000000 / 176) * 1.5, 0.05);
  });

  test('standby: no cobra el tiempo de la gente (sólo vianda y horas extra, como siempre)', () => {
    resetIds();
    const q = timed(service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [operario({ mealPerActiveDay: 10000 })], ...plain, rules: { standbyNotApplicable: false, standbyDaysPerMonth: 2 } }));
    assert.equal(buildCostModel(q).standby.costPerDay, 10000);
  });

  test('sin costos fijos el equilibrio es 0 días y el precio no depende de los días', () => {
    resetIds();
    const mk = (D) => {
      const q = timed(service({ unit: 'day', activity: { activeDaysPerMonth: D, hoursPerActiveDay: 8 }, labor: [operario()], ...plain }));
      q.pricing.roundingStep = 0;
      q.pricing.targetMarginPct = 20;
      return computeQuote(q);
    };
    near(mk(5).kpis.targetListRate, mk(20).kpis.targetListRate, 1e-6);
    assert.equal(mk(5).kpis.fixedCosts, 0);
  });
});

describe('Cotización nueva y recursos', () => {
  test('withTimeCostBasis marca la cotización y limpia el % que traiga una plantilla', () => {
    const q = withTimeCostBasis({ unit: 'job', labor: [{ assignment: 'shared', fixedCostSharePct: 30 }], equipment: [{ assignment: 'reserved' }, null] });
    assert.equal(q.costBasis, 'time');
    assert.equal('assignment' in q.labor[0], false);
    assert.equal('fixedCostSharePct' in q.labor[0], false);
    assert.equal('assignment' in q.equipment[0], false);
    assert.equal(withTimeCostBasis(null), null);
  });

  test('la línea de personal copia las horas facturables del perfil (y el snapshot no cambia sin ellas)', () => {
    const now = '2026-11-18T00:00:00.000Z';
    const sin = laborLineFromProfile({ id: 'p-1', role: 'Operario', basicMonthly: 1000000 }, null, { id: 'l-1', now });
    assert.equal(sin.billableHoursPerMonth, null);
    assert.equal('billableHoursPerMonth' in sin.snapshot.values, false);
    const con = laborLineFromProfile({ id: 'p-1', role: 'Operario', basicMonthly: 1000000, billableHoursPerMonth: 140 }, null, { id: 'l-1', now });
    assert.equal(con.billableHoursPerMonth, 140);
    assert.equal(con.snapshot.values.billableHoursPerMonth, 140);
  });

  test('computeLabor informa la hora para cotizar en cualquier cotización', () => {
    const p = computeLabor([operario({ billableHoursPerMonth: 160 })]).lines[0].perPerson;
    assert.equal(p.billableHoursPerMonth, 160);
    assert.equal(p.billableHourlyCost, 12500);
    near(p.loadedHourlyCost, 11363.64);
  });

  test('"Usado en": por tiempo usado sin actividad estimada no hay %', () => {
    const line = { ...operario(), sourceId: 'p-1' };
    const rows = (q) => resourceUsage('laborProfiles', 'p-1', [q]).rows;
    assert.equal(rows({ id: 'a', status: 'won', unit: 'job', costBasis: 'time', labor: [line] })[0].assignedPct, null);
    assert.equal(rows({ id: 'b', status: 'won', unit: 'job', labor: [line] })[0].assignedPct, 100);
    assert.equal(rows({ id: 'c', status: 'won', unit: 'month', costBasis: 'time', labor: [line] })[0].assignedPct, 100);
  });

  test('aviso "Horas del personal": por tiempo usado no mide la cobertura mensual, sólo el tope por día', () => {
    const hours = (q) => computeQuote(q).completeness.items.find((i) => i.id === 'labor_hours');
    const largo = instalacion({ activity: { billableQuantityPerMonth: 1, daysPerActivation: 45, hoursPerActiveDay: 8 } });
    assert.ok(hours(largo), 'la cotización de antes avisa que faltan horas');
    assert.equal(hours(timed(largo)), undefined);
    const dia24 = hours(timed(instalacion({ activity: { billableQuantityPerMonth: 1, daysPerActivation: 3, hoursPerActiveDay: 24 } })));
    assert.match(dia24.message, /Nadie trabaja más de 16 h por día/);
  });
});
