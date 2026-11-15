/**
 * PLAN-2026-025 — Cotización guiada por recursos: tarifas por persona (hora
 * normal, 50 % y 100 %), tarifas fuera de horario derivadas de los recursos,
 * % de dedicación propuesto por horas y orden de pasos (recursos primero).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeExtras } from '../../js/engines/extras-engine.js';
import {
  OUT_OF_HOURS_KIND,
  OUT_OF_HOURS_PRESETS,
  isOutOfHoursExtra,
  hasOutOfHours,
  outOfHoursBasis,
  outOfHoursCostPerHour,
  outOfHoursSurchargePerHour,
  resolveExtras,
  normalHourEquivalent,
  resourceNormalHourCost,
} from '../../js/engines/out-of-hours-engine.js';
import { serviceTimeSharePct, proposeServiceShares } from '../../js/engines/utilization-engine.js';
import { QUOTE_STEPS } from '../../js/domain/catalogs.js';
import { createBlankQuote, laborLineFromProfile, blankEquipmentLine } from '../../js/domain/quote-factory.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

/** Semi con chofer, on call, $/hora: 10 días × 9 h, margen 20 %. */
function semiQuote({ choferes = 1, extras = [] } = {}) {
  const q = createBlankQuote({ organizationId: 'o', now: '2026-11-15T00:00:00Z' });
  q.unit = 'hour';
  q.activity.activeDaysPerMonth = 10;
  q.activity.hoursPerActiveDay = 9;
  q.labor.push({ ...laborLineFromProfile({ role: 'Chofer', basicMonthly: 2000000 }), positions: choferes });
  const e = blankEquipmentLine();
  Object.assign(e, { name: 'Semi', replacementValue: 180000000, usefulLifeYears: 10, maintenancePerHour: 8000, fuelLitersPerHour: 10, hoursPerActiveDay: 9 });
  q.equipment.push(e);
  q.pricing.targetMarginPct = 20;
  q.extras = extras;
  return q;
}
const ooh = (premiumPct, more = {}) => ({ id: `ooh-${premiumPct}`, kind: OUT_OF_HOURS_KIND, premiumPct, quantityPerMonth: 0, ...more });

describe('PLAN-2026-025 — tarifas por persona', () => {
  test('la hora extra al 50 % y al 100 % salen del básico por hora con cargas', () => {
    const r = computeQuote(semiQuote());
    const p = r.model.labor.lines[0].perPerson;
    assert.ok(p.hourlyBase > 0 && p.loadFactor >= 1);
    near(p.overtimeHourlyCost50, p.hourlyBase * 1.5 * p.loadFactor); // sin adicionales: básico por hora
    near(p.overtimeHourlyCost100, p.hourlyBase * 2 * p.loadFactor);
    assert.ok(p.overtimeHourlyCost100 > p.overtimeHourlyCost50);
  });

  test('los adicionales remunerativos entran en la base de la hora extra (sueldo habitual)', () => {
    const q = semiQuote();
    q.labor[0].additionalsMonthly = 600000;
    const p = computeQuote(q).model.labor.lines[0].perPerson;
    near(p.overtimeBaseHourly, (2000000 + 600000) / q.labor[0].normalHoursPerMonth);
    near(p.overtimeHourlyCost50, p.overtimeBaseHourly * 1.5 * p.loadFactor);
    // Los tramos de horas extra ya cargados siguen con el básico por hora de siempre.
    near(p.hourlyBase, 2000000 / q.labor[0].normalHoursPerMonth);
  });
});

describe('PLAN-2026-025 — motor de fuera de horario', () => {
  test('reconoce sólo las líneas derivadas', () => {
    assert.equal(isOutOfHoursExtra(ooh(50)), true);
    assert.equal(isOutOfHoursExtra({ label: 'Km excedente', costPerUnit: 10 }), false);
    assert.equal(isOutOfHoursExtra(null), false);
    assert.equal(hasOutOfHours([{ label: 'x' }]), false);
    assert.equal(hasOutOfHours([{ label: 'x' }, ooh(100)]), true);
    assert.equal(hasOutOfHours(undefined), false);
    assert.deepEqual(OUT_OF_HOURS_PRESETS.map((p) => p.premiumPct), [50, 100]);
  });

  test('base por hora: gente con cargas + uso de equipos propios en uso', () => {
    const labor = { lines: [{ positions: 2, perPerson: { hourlyBase: 1000, loadFactor: 1.5, loadedHourlyCost: 2000 } }, { positions: 0, perPerson: { hourlyBase: 9999, loadFactor: 1, loadedHourlyCost: 9999 } }] };
    const equipment = [
      { acquisition: 'owned', quantity: 1, hoursPerActiveDay: 8, operation: { totalPerHour: 400 } },
      { acquisition: 'owned', quantity: 1, hoursPerActiveDay: 0, operation: { totalPerHour: 5000 } }, // sólo traslada
      { acquisition: 'rented', quantity: 1, hoursPerActiveDay: 8, operation: { totalPerHour: 5000 } }, // del proveedor
    ];
    const b = outOfHoursBasis(labor, equipment);
    assert.deepEqual(b, { crewBasePerHour: 3000, crewNormalPerHour: 4000, equipmentPerHour: 400, people: 2, equipmentUnits: 1 });
    assert.equal(resourceNormalHourCost(b), 4400);
    assert.equal(outOfHoursCostPerHour(b, 50), 3000 * 1.5 + 400);
    assert.equal(outOfHoursCostPerHour(b, 100), 3000 * 2 + 400);
    assert.equal(outOfHoursSurchargePerHour(b, 50), 1500);
    assert.equal(outOfHoursSurchargePerHour(b, 100), 3000);
  });

  test('sin recursos la base es cero y no rompe', () => {
    assert.deepEqual(outOfHoursBasis(null, null), { crewBasePerHour: 0, crewNormalPerHour: 0, equipmentPerHour: 0, people: 0, equipmentUnits: 0 });
    assert.equal(outOfHoursCostPerHour(null, 50), 0);
    assert.equal(outOfHoursSurchargePerHour(undefined, 50), 0);
  });

  test('resolveExtras completa el costo de las derivadas y no toca el resto ni la cotización', () => {
    const manual = { id: 'm', label: 'Km excedente', costPerUnit: 10, price: 20 };
    const extras = [manual, ooh(50)];
    const out = resolveExtras(extras, { crewBasePerHour: 1000, equipmentPerHour: 100 });
    assert.equal(out[0], manual);
    assert.equal(out[1].costPerUnit, 1600);
    assert.equal(out[1].surchargePerUnit, 500);
    assert.equal(out[1].unitName, 'hora');
    assert.equal(extras[1].costPerUnit, undefined);
    assert.equal(resolveExtras(undefined, {}), undefined);
  });

  test('hora normal de la tarifa: sólo cobrando por hora o por día', () => {
    assert.equal(normalHourEquivalent({ unitKind: 'hour', listRate: 900, hoursPerActiveDay: 9 }), 900);
    assert.equal(normalHourEquivalent({ unitKind: 'day', listRate: 900, hoursPerActiveDay: 9 }), 100);
    assert.equal(normalHourEquivalent({ unitKind: 'day', listRate: 900, hoursPerActiveDay: 0 }), null);
    assert.equal(normalHourEquivalent({ unitKind: 'month', listRate: 900, hoursPerActiveDay: 9 }), null);
    assert.equal(normalHourEquivalent({ unitKind: 'quantity', listRate: 900, hoursPerActiveDay: 9 }), null);
    assert.equal(normalHourEquivalent({ unitKind: 'hour', listRate: 0 }), null);
    assert.equal(normalHourEquivalent(), null);
  });
});

describe('PLAN-2026-025 — precio sugerido de la hora fuera de horario', () => {
  const basis = { crewBasePerHour: 1000, equipmentPerHour: 0 };
  const opts = { targetMarginPct: 20, billingTaxPct: 0, loadFactor: 1 };

  test('nunca sale más barata que la hora normal: hora normal + recargo', () => {
    const { lines } = computeExtras(resolveExtras([ooh(50)], basis), { ...opts, referenceHourPrice: 5000 });
    const l = lines[0];
    assert.equal(l.derived, true);
    near(l.priceByCost, 1500 / 0.8);
    near(l.surchargePrice, 500 / 0.8);
    near(l.price, 5000 + 500 / 0.8);
    assert.equal(l.priceBasis, 'normal_hour');
  });

  test('sin hora normal de referencia (o si el costo manda) cubre su costo con margen', () => {
    const noRef = computeExtras(resolveExtras([ooh(100)], basis), opts).lines[0];
    near(noRef.price, 2000 / 0.8);
    assert.equal(noRef.priceBasis, 'cost');
    const lowRef = computeExtras(resolveExtras([ooh(100)], basis), { ...opts, referenceHourPrice: 100 }).lines[0];
    near(lowRef.price, 2000 / 0.8);
    assert.equal(lowRef.priceBasis, 'cost');
  });

  test('el precio escrito a mano se respeta', () => {
    const l = computeExtras(resolveExtras([ooh(50, { price: 9000 })], basis), { ...opts, referenceHourPrice: 5000 }).lines[0];
    assert.equal(l.price, 9000);
  });

  test('sin hora de la tarifa (abono, precio cerrado) el piso es la hora normal de los recursos con margen', () => {
    const l = computeExtras(resolveExtras([ooh(50)], basis), { ...opts, referenceHourCost: 2400 }).lines[0];
    near(l.referenceHourPrice, 2400 / 0.8);
    assert.equal(l.referenceSource, 'resources');
    near(l.price, 2400 / 0.8 + 500 / 0.8);
    // Con hora de la tarifa, manda la tarifa.
    const r = computeExtras(resolveExtras([ooh(50)], basis), { ...opts, referenceHourPrice: 5000, referenceHourCost: 2400 }).lines[0];
    assert.equal(r.referenceSource, 'rate');
    near(r.price, 5000 + 500 / 0.8);
  });

  test('las horas estimadas cuentan para la tarifa principal sólo por el precio que cubre su costo', () => {
    const { lines, revenue, neutralRevenue } = computeExtras(resolveExtras([ooh(50, { quantityPerMonth: 10 })], basis), { ...opts, referenceHourPrice: 5000 });
    near(revenue, 10 * lines[0].price);
    near(neutralRevenue, 10 * lines[0].priceByCost);
    assert.ok(neutralRevenue < revenue);
  });

  test('los adicionales comunes no cambian', () => {
    const manual = [{ id: 'm', label: 'Km excedente', unitName: 'km', costPerUnit: 100, quantityPerMonth: 10 }];
    assert.deepEqual(computeExtras(manual, opts), computeExtras(manual, { ...opts, referenceHourPrice: 5000, referenceHourCost: 900 }));
    assert.equal(computeExtras(manual, opts).neutralRevenue, computeExtras(manual, opts).revenue);
  });
});

describe('PLAN-2026-025 — cotización completa (semi con chofer, on call)', () => {
  test('sin tarifas fuera de horario informa la base y la hora normal, y nada más cambia', () => {
    const r = computeQuote(semiQuote());
    assert.equal(r.outOfHours.active, false);
    assert.deepEqual(r.outOfHours.lines, []);
    near(r.outOfHours.normalHourPrice, r.kpis.commercialListRate); // cobra por hora
    assert.ok(r.outOfHours.basis.crewBasePerHour > 0 && r.outOfHours.basis.equipmentPerHour > 0);
  });

  test('la hora al 100 % vale más que al 50 % y ambas más que la normal', () => {
    const base = computeQuote(semiQuote());
    const r = computeQuote(semiQuote({ extras: [ooh(50), ooh(100)] }));
    const [l50, l100] = r.outOfHours.lines;
    near(r.outOfHours.normalHourPrice, base.outOfHours.normalHourPrice);
    assert.ok(l50.price > r.outOfHours.normalHourPrice);
    assert.ok(l100.price > l50.price);
    near(l50.costPerUnit, outOfHoursCostPerHour(r.outOfHours.basis, 50));
    // Con 0 horas estimadas no mueven la tarifa principal ni el costo del mes.
    near(r.kpis.commercialListRate, base.kpis.commercialListRate);
    near(r.kpis.totalCost, base.kpis.totalCost);
  });

  test('con dos choferes la hora fuera de horario cuesta el doble de gente', () => {
    const one = computeQuote(semiQuote()).outOfHours.basis;
    const two = computeQuote(semiQuote({ choferes: 2 })).outOfHours.basis;
    near(two.crewBasePerHour, one.crewBasePerHour * 2);
    near(two.equipmentPerHour, one.equipmentPerHour);
  });

  test('horas estimadas fuera de horario suman costo y facturación, sin avisos de adicional sin precio', () => {
    const base = computeQuote(semiQuote());
    const r = computeQuote(semiQuote({ extras: [ooh(100, { quantityPerMonth: 10 })] }));
    const l = r.outOfHours.lines[0];
    assert.ok(r.kpis.totalCost > base.kpis.totalCost);
    near(r.kpis.totalCost - base.kpis.totalCost, l.costPerUnit * 10, 1e-3);
    assert.equal(r.extras.missingPrice, 0);
    // Las horas estimadas no abaratan la tarifa principal (si no ocurren, el margen no cae).
    near(r.kpis.commercialListRate, base.kpis.commercialListRate, 1e-3);
    assert.ok(r.kpis.marginPct >= base.kpis.marginPct - 1e-6);
    assert.equal(r.issues.some((i) => /adicional/i.test(i.message || '') && /precio/i.test(i.message || '')), false);
  });

  test('una cotización sin la clave nueva calcula igual que antes (sin extras derivados)', () => {
    const a = computeQuote(semiQuote());
    const b = computeQuote(semiQuote({ extras: [{ id: 'm', label: 'Km excedente', unitName: 'km', costPerUnit: 100, quantityPerMonth: 0 }] }));
    near(a.kpis.commercialListRate, b.kpis.commercialListRate);
    assert.equal(b.outOfHours.active, false);
  });
});

describe('PLAN-2026-025 — abono y precio cerrado: el piso no sale de la tarifa', () => {
  for (const [mode, unit] of [['monthly', 'month'], ['closed', 'job']]) {
    test(`${mode}: la hora fuera de horario queda cerca de la hora de los recursos, no de la tarifa total`, () => {
      const q = semiQuote({ extras: [ooh(50)] });
      q.contract = { mode, components: ['labor', 'vehicle'] };
      q.unit = unit;
      q.activity.activeDaysPerMonth = 2;
      q.activity.hoursPerActiveDay = 4;
      const r = computeQuote(q);
      const l = r.outOfHours.lines[0];
      assert.equal(r.outOfHours.rateHourPrice, null);
      assert.equal(r.outOfHours.normalHourSource, 'resources');
      assert.ok(l.price >= l.priceByCost - 1e-6);
      assert.ok(l.price < l.priceByCost * 3, `${l.price} vs ${l.priceByCost}`);
    });
  }

  test('una tarifa fuera de horario sin recargo se avisa', () => {
    const r = computeQuote(semiQuote({ extras: [ooh(0)] }));
    assert.ok(r.issues.some((i) => /no tiene recargo/.test(i.message)));
  });
});

describe('PLAN-2026-025 — % de dedicación propuesto por horas (se aplica sólo si el usuario lo elige)', () => {
  test('horas del servicio ÷ horas normales del mes, con tope', () => {
    assert.equal(serviceTimeSharePct({ activeDays: 8, hoursPerActiveDay: 9, normalHoursPerMonth: 176 }), 40.9);
    assert.equal(serviceTimeSharePct({ activeDays: 30, hoursPerActiveDay: 12, normalHoursPerMonth: 176 }), 100);
    assert.equal(serviceTimeSharePct({ activeDays: 0, hoursPerActiveDay: 9, normalHoursPerMonth: 176 }), null);
    assert.equal(serviceTimeSharePct({ activeDays: 8, hoursPerActiveDay: 9, normalHoursPerMonth: 0 }), null);
    assert.equal(serviceTimeSharePct(), null);
  });

  test('propone para cada persona y cada equipo propio; no para los del proveedor; no modifica la cotización', () => {
    const q = semiQuote();
    q.equipment.push({ ...blankEquipmentLine(), acquisition: 'rented' });
    const snapshot = JSON.stringify(q);
    const p = proposeServiceShares(q, { activeDaysPerMonth: 8, hoursPerActiveDay: 9 });
    assert.equal(p.serviceHours, 72);
    assert.equal(p.labor.length, 1);
    assert.ok(p.labor[0] > 0 && p.labor[0] <= 100);
    assert.equal(p.equipment[0], p.labor[0]);
    assert.equal(p.equipment[1], null);
    assert.equal(JSON.stringify(q), snapshot);
  });
});

describe('PLAN-2026-025 — orden de pasos', () => {
  test('los recursos van antes que "Cómo se cobra"', () => {
    const ids = QUOTE_STEPS.map((s) => s.id);
    assert.deepEqual(ids.slice(0, 6), ['service', 'labor', 'equipment', 'materials', 'logistics', 'modality']);
    assert.equal(ids[ids.length - 1], 'result');
  });
});
