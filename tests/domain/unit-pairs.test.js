/**
 * Unidades compuestas (UX-UNITS): pares válidos del rendimiento, conversiones
 * exactas y los cinco casos económicos del encargo (Issue #5 de RATEOS-AUDIT).
 *
 * Regla: un número nunca se lee en otra unidad. Se convierte sólo con un
 * factor exacto (1 t = 1.000 kg, 1 km = 1.000 m) o con un dato que carga la
 * persona (carga por viaje, horas por día); si no, queda sin cargar.
 * El motor no cambia: lee activity.unitsPerActiveDay y billableQuantityPerMonth;
 * rateInput y quantityInput son sólo cómo se cargaron.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_UNITS, billingUnitOf } from '../../js/domain/billing-units.js';
import {
  rateNumeratorsFor,
  loadUnitOf,
  hasRatePairs,
  rateInputOf,
  isNativeRate,
  unitsPerActiveDayFrom,
  quantityFromWorkdays,
  workdaysFromQuantity,
  quantityBasisOf,
  quantityFactorBetween,
  convertExact,
} from '../../js/domain/unit-pairs.js';
import { convertRateUnit } from '../../js/engines/pricing-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person, owned, LAB_SETTINGS } from '../lab/lib/build.js';

const unit = (id) => billingUnitOf({ unit: id });
const ids = (list) => list.map((n) => n.id);

describe('UX-UNITS · pares válidos del rendimiento', () => {
  test('cada unidad por cantidad se ofrece primero a sí misma; los pares son sólo los que tienen un factor', () => {
    assert.deepEqual(ids(rateNumeratorsFor(unit('trip'))), ['trip', 'm3', 'ton']);
    assert.deepEqual(ids(rateNumeratorsFor(unit('m3'))), ['m3', 'trip']);
    assert.deepEqual(ids(rateNumeratorsFor(unit('ton'))), ['ton', 'kg', 'trip']);
    assert.deepEqual(ids(rateNumeratorsFor(unit('kg'))), ['kg', 'ton']);
    assert.deepEqual(ids(rateNumeratorsFor(unit('meter'))), ['meter', 'km']);
    assert.deepEqual(ids(rateNumeratorsFor(unit('km'))), ['km', 'meter']);
    for (const id of ['unit', 'm2', 'lot', 'shift', 'tonkm']) assert.deepEqual(ids(rateNumeratorsFor(unit(id))), [id], id);
  });

  test('una unidad propia ("pozo") sólo se ofrece a sí misma, con su nombre', () => {
    const info = billingUnitOf({ unit: 'custom', unitName: 'pozo' });
    const list = rateNumeratorsFor(info);
    assert.equal(list.length, 1);
    assert.equal(list[0].plural, 'pozos');
  });

  test('sólo las unidades por cantidad tienen rendimiento compuesto (día, hora, abono y eventos no)', () => {
    for (const def of BILLING_UNITS) {
      const info = billingUnitOf({ unit: def.id });
      assert.equal(hasRatePairs(info), info.kind === 'quantity', def.id);
    }
  });

  test('viaje ↔ m³ o t piden la carga por viaje; kg ↔ t y metro ↔ km no (son exactos)', () => {
    assert.equal(loadUnitOf(unit('trip'), 'm3'), 'm3');
    assert.equal(loadUnitOf(unit('trip'), 'ton'), 'ton');
    assert.equal(loadUnitOf(unit('m3'), 'trip'), 'm3');
    assert.equal(loadUnitOf(unit('ton'), 'trip'), 'ton');
    assert.equal(loadUnitOf(unit('ton'), 'kg'), null);
    assert.equal(loadUnitOf(unit('km'), 'meter'), null);
    assert.equal(loadUnitOf(unit('m3'), 'm3'), null);
  });
});

describe('UX-UNITS · rendimiento en la unidad del motor (por día de trabajo)', () => {
  const m3 = unit('m3');
  test('forma nativa: el mismo número', () => {
    assert.equal(unitsPerActiveDayFrom({ value: 20, numerator: 'm3', denominator: 'day' }, m3), 20);
    assert.equal(isNativeRate({ numerator: 'm3', denominator: 'day' }, m3), true);
    assert.equal(isNativeRate({ numerator: 'm3', denominator: 'hour' }, m3), false);
  });

  test('por hora: × las horas productivas por día; sin horas (o más de 24) queda sin cargar', () => {
    assert.equal(unitsPerActiveDayFrom({ value: 2, numerator: 'm3', denominator: 'hour', hours: 10 }, m3), 20);
    assert.equal(unitsPerActiveDayFrom({ value: 2.5, numerator: 'm3', denominator: 'hour', hours: 9 }, m3), 22.5);
    assert.equal(unitsPerActiveDayFrom({ value: 2, numerator: 'm3', denominator: 'hour', hours: null }, m3), null);
    assert.equal(unitsPerActiveDayFrom({ value: 2, numerator: 'm3', denominator: 'hour', hours: 25 }, m3), null);
  });

  test('exactos: 5.000 kg por día = 5 t; 2 km por día = 2.000 metros', () => {
    assert.equal(unitsPerActiveDayFrom({ value: 5000, numerator: 'kg', denominator: 'day' }, unit('ton')), 5);
    assert.equal(unitsPerActiveDayFrom({ value: 2, numerator: 'km', denominator: 'day' }, unit('meter')), 2000);
    assert.equal(unitsPerActiveDayFrom({ value: 1500, numerator: 'meter', denominator: 'day' }, unit('km')), 1.5);
  });

  test('sin número, con un numerador que no corresponde o con un denominador desconocido: sin cargar (nunca se adivina)', () => {
    assert.equal(unitsPerActiveDayFrom({ value: null, numerator: 'm3', denominator: 'day' }, m3), null);
    assert.equal(unitsPerActiveDayFrom({ value: 0, numerator: 'm3', denominator: 'day' }, m3), null);
    assert.equal(unitsPerActiveDayFrom({ value: 20, numerator: 'km', denominator: 'day' }, m3), null);
    assert.equal(unitsPerActiveDayFrom({ value: 20, numerator: 'm3', denominator: 'week' }, m3), null);
    assert.equal(unitsPerActiveDayFrom(null, m3), null);
  });

  test('rateInputOf: sin forma guardada (o de otra unidad), la nativa con el dato del motor', () => {
    assert.deepEqual(rateInputOf({ unitsPerActiveDay: 20 }, m3), { value: 20, numerator: 'm3', denominator: 'day', load: null, hours: null });
    // Una forma cargada con otra unidad de cobro no se reusa.
    assert.deepEqual(rateInputOf({ unitsPerActiveDay: 4, rateInput: { value: 80, numerator: 'ton', denominator: 'day', load: 20 } }, m3), { value: 4, numerator: 'm3', denominator: 'day', load: null, hours: null });
    assert.deepEqual(rateInputOf({ unitsPerActiveDay: 20, rateInput: { value: '2', numerator: 'm3', denominator: 'hour', hours: 10 } }, m3), { value: 2, numerator: 'm3', denominator: 'hour', load: null, hours: 10 });
    assert.deepEqual(rateInputOf(null, m3), { value: null, numerator: 'm3', denominator: 'day', load: null, hours: null });
  });

  test('una forma que ya no da el dato del motor (editado en una versión anterior) se descarta: manda el motor', () => {
    // 2 m³ por hora × 10 h = 20, pero el motor tiene 30 (se editó el rendimiento sin la forma).
    assert.deepEqual(rateInputOf({ unitsPerActiveDay: 30, rateInput: { value: 2, numerator: 'm3', denominator: 'hour', hours: 10 } }, m3), { value: 30, numerator: 'm3', denominator: 'day', load: null, hours: null });
    // Forma elegida y número todavía sin cargar: se conserva mientras falta el número.
    assert.deepEqual(rateInputOf({ unitsPerActiveDay: null, rateInput: { value: null, numerator: 'm3', denominator: 'hour', hours: 10 } }, m3), { value: null, numerator: 'm3', denominator: 'hour', load: null, hours: 10 });
  });
});

describe('UX-UNITS · cantidad del mes en días de trabajo', () => {
  test('20 m³ por día × 10 días = 200 m³; 200 m³ ÷ 20 m³ por día = 10 días', () => {
    assert.equal(quantityFromWorkdays(10, 20), 200);
    assert.equal(workdaysFromQuantity(200, 20), 10);
    assert.equal(quantityFromWorkdays(10, null), null);
    assert.equal(workdaysFromQuantity(200, 0), null);
  });

  test('la forma se lee de activity.quantityInput; sin ella, en la unidad de cobro', () => {
    assert.equal(quantityBasisOf({ quantityInput: { basis: 'workdays', value: 10 }, unitsPerActiveDay: 20, billableQuantityPerMonth: 200 }), 'workdays');
    assert.equal(quantityBasisOf({ quantityInput: { basis: 'workdays', value: null }, unitsPerActiveDay: 20, billableQuantityPerMonth: null }), 'workdays');
    // Editada en una versión anterior: 10 días × 20 ya no da los 300 del motor → se muestra la cantidad.
    assert.equal(quantityBasisOf({ quantityInput: { basis: 'workdays', value: 10 }, unitsPerActiveDay: 20, billableQuantityPerMonth: 300 }), 'quantity');
    assert.equal(quantityBasisOf({ quantityInput: null }), 'quantity');
    assert.equal(quantityBasisOf({}), 'quantity');
    assert.equal(quantityBasisOf(null), 'quantity');
  });
});

describe('UX-UNITS · cambio de unidad de cobro: sólo factores exactos', () => {
  test('kg ↔ t y metro ↔ km se convierten; la tarifa con el inverso ($ 50 / kg = $ 50.000 / t)', () => {
    assert.equal(quantityFactorBetween('kg', 'ton'), 1 / 1000);
    assert.equal(quantityFactorBetween('ton', 'kg'), 1000);
    assert.equal(quantityFactorBetween('meter', 'km'), 1 / 1000);
    assert.equal(quantityFactorBetween('km', 'meter'), 1000);
    assert.equal(convertExact(5000, quantityFactorBetween('kg', 'ton')), 5);
    assert.equal(convertExact(50, 1 / quantityFactorBetween('kg', 'ton')), 50000);
    assert.equal(convertExact(45555, 1 / quantityFactorBetween('ton', 'kg')), 45.555);
  });

  test('ningún otro par de unidades tiene factor: m³ → viaje, llamado → trabajo, día → m³ (F4)', () => {
    const exact = new Set(['kg>ton', 'ton>kg', 'meter>km', 'km>meter']);
    for (const a of BILLING_UNITS) {
      for (const b of BILLING_UNITS) {
        if (a.id === b.id) continue;
        const f = quantityFactorBetween(a.id, b.id);
        assert.equal(f !== null, exact.has(`${a.id}>${b.id}`), `${a.id} → ${b.id}`);
      }
    }
  });
});

/** Cotización por cantidad con datos sintéticos (como los casos de la evidencia). */
function quantityQuote(o) {
  return service({
    serviceType: 'per_unit',
    pricingMode: 'known_rate',
    labor: [person({ role: 'Chofer', basicMonthly: 2100000 })],
    equipment: [owned({ name: 'Camión cisterna 20 m³', replacementValue: 180000000, usefulLifeYears: 10, fuelLitersPerHour: 12, hoursPerActiveDay: 10 })],
    ...o,
  });
}

describe('UX-UNITS · los cinco casos económicos (motor sin cambios, aritmética independiente)', () => {
  test('C1 · m³/día → m³/mes → $/m³: 20 m³ por día × 10 días = 200 m³; × $ 5.000 = $ 1.000.000 por mes', () => {
    const perDay = unitsPerActiveDayFrom({ value: 20, numerator: 'm3', denominator: 'day' }, unit('m3'));
    const billable = quantityFromWorkdays(10, perDay);
    const q = quantityQuote({ unit: 'm3', pricing: { knownRate: 5000 }, activity: { billableQuantityPerMonth: billable, unitsPerActiveDay: perDay, quantityInput: { basis: 'workdays', value: 10 }, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 10 } });
    const r = computeQuote(q, { settings: LAB_SETTINGS });
    assert.equal(r.kpis.activeDays, 10);
    assert.equal(r.estimate.revenue.billableUnits, 200);
    assert.equal(r.estimate.revenue.components.base, 200 * 5000);
  });

  test('C2 · km/h ≠ km facturados: 50 km/h × 8 h de marcha = 400 km por día; se facturan los km, no la velocidad', () => {
    const perDay = unitsPerActiveDayFrom({ value: 50, numerator: 'km', denominator: 'hour', hours: 8 }, unit('km'));
    assert.equal(perDay, 400);
    const q = quantityQuote({ serviceType: 'transport', unit: 'km', pricing: { knownRate: 2000 }, activity: { billableQuantityPerMonth: 6000, unitsPerActiveDay: perDay, rateInput: { value: 50, numerator: 'km', denominator: 'hour', load: null, hours: 8 }, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 8 } });
    const r = computeQuote(q, { settings: LAB_SETTINGS });
    assert.equal(r.kpis.activeDays, 15);
    assert.equal(r.estimate.revenue.billableUnits, 6000);
    assert.equal(r.estimate.revenue.components.base, 6000 * 2000);
  });

  test('C3 · día ↔ hora sólo con las horas por día: $ 100.000 por día con 10 h = $ 10.000 por hora; sin horas, no se convierte', () => {
    assert.equal(convertRateUnit(100000, 'day', 'hour', 10), 10000);
    assert.equal(convertRateUnit(10000, 'hour', 'day', 10), 100000);
    assert.equal(convertRateUnit(100000, 'day', 'hour', null), null);
    // Nunca se lee 100.000 por día como 100.000 por hora: no hay factor de cantidad entre día y hora.
    assert.equal(quantityFactorBetween('day', 'hour'), null);
  });

  test('C4 · viaje vs m³ con factor físico: 80 m³ por día ÷ 20 m³ por viaje = 4 viajes; y al revés, 4 viajes × 20 = 80 m³', () => {
    assert.equal(unitsPerActiveDayFrom({ value: 80, numerator: 'm3', denominator: 'day', load: 20 }, unit('trip')), 4);
    assert.equal(unitsPerActiveDayFrom({ value: 4, numerator: 'trip', denominator: 'day', load: 20 }, unit('m3')), 80);
    assert.equal(unitsPerActiveDayFrom({ value: 80, numerator: 'm3', denominator: 'day', load: null }, unit('trip')), null);
  });

  test('C5 · tarifa cargada que cambia de denominador sin supuesto ($/día → $/m³): no hay conversión', () => {
    assert.equal(convertRateUnit(1200000, 'day', 'm3', 10), null);
    assert.equal(quantityFactorBetween('day', 'm3'), null);
    assert.equal(quantityFactorBetween('m3', 'trip'), null);
  });

  test('el motor ignora cómo se cargó: con rateInput y quantityInput da lo mismo que con los números del motor solos', () => {
    const activity = { billableQuantityPerMonth: 40, unitsPerActiveDay: 4, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 10 };
    const base = quantityQuote({ id: 'uxu-a', serviceType: 'transport', unit: 'trip', pricing: { knownRate: 220000 }, activity });
    const loaded = quantityQuote({ id: 'uxu-a', serviceType: 'transport', unit: 'trip', pricing: { knownRate: 220000 }, activity: { ...activity, rateInput: { value: 80, numerator: 'm3', denominator: 'day', load: 20, hours: null }, quantityInput: { basis: 'workdays', value: 10 } } });
    const a = computeQuote(base, { settings: LAB_SETTINGS });
    const b = computeQuote(loaded, { settings: LAB_SETTINGS });
    assert.deepEqual(b.kpis, a.kpis);
    assert.deepEqual(b.estimate, a.estimate);
  });
});
