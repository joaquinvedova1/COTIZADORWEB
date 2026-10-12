/**
 * Unidades de facturación por tipo de servicio (PLAN-2026-009).
 *
 * TIPO DE SERVICIO → UNIDAD DE FACTURACIÓN → ACTIVIDAD → EQUILIBRIO.
 * UNIDAD DE COSTO ≠ UNIDAD DE VENTA: los costos se calculan con los días de
 * trabajo (derivados de la cantidad y el rendimiento) y la facturación es
 * cantidad facturable × tarifa por unidad.
 *
 * Los casos A–E del pedido están en tests/golden-cases/unidad-*.json; acá van
 * las reglas y los casos extremos.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_UNITS,
  SERVICE_TYPE_UNITS,
  billingUnitOf,
  unitChoicesFor,
  defaultUnitFor,
  unitFitsServiceType,
  pluralizeUnit,
  cleanUnitName,
  unitTexts,
} from '../../js/domain/billing-units.js';
import { SERVICE_TYPES } from '../../js/domain/catalogs.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { normalizeActivity, activeDaysForQuantity } from '../../js/engines/cost-engine.js';
import { applySensitivity, runSensitivity } from '../../js/engines/scenario-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { demoReferenceQuote } from '../../js/domain/demo-data.js';

const close = (actual, expected, tol = 1e-6) => assert.ok(Math.abs(actual - expected) <= tol, `esperado ${expected}, obtenido ${actual}`);

/** Cotización de referencia: fijos F, variable v por día de trabajo, sin otros costos ni reglas. */
function base({ F = 30000000, v = 1000000, unit = 'day', serviceType = 'configurable', rate = null, margin = 0 } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = F;
  q.otherCosts[1].amount = v;
  q.serviceType = serviceType;
  q.unit = unit;
  q.unitName = '';
  q.activity.availableDaysPerMonth = 30;
  q.activity.daysPerActivation = 1;
  q.pricingMode = rate === null ? 'known_activity' : 'known_rate';
  q.pricing = { ...q.pricing, knownRate: rate === null ? 0 : rate, targetMarginPct: margin, roundingStep: 0, offeredRateOverride: null };
  return q;
}

/** Por cantidad: Q por mes con un rendimiento por día de trabajo. */
function byQuantity(opts, { quantity, perDay, dpa = 1, unitName = '' } = {}) {
  const q = base(opts);
  q.unitName = unitName;
  q.activity.billableQuantityPerMonth = quantity;
  q.activity.unitsPerActiveDay = perDay;
  q.activity.daysPerActivation = dpa;
  return q;
}

const finiteOrNull = (x) => x === null || Number.isFinite(x);

describe('unidades por tipo de servicio (dominio)', () => {
  test('cada tipo de servicio ofrece sus unidades habituales + "Otra / personalizada"', () => {
    const ids = (type) => unitChoicesFor(type).map((u) => u.id);
    assert.deepEqual(ids('on_call'), ['day', 'hour', 'call', 'month', 'custom']);
    assert.deepEqual(ids('permanent'), ['month', 'day', 'hour', 'shift', 'custom']);
    assert.deepEqual(ids('crew'), ['day', 'hour', 'shift', 'month', 'custom']);
    assert.deepEqual(ids('equipment_with_operator'), ['day', 'hour', 'month', 'trip', 'custom']);
    assert.deepEqual(ids('equipment_only'), ['day', 'hour', 'month', 'trip', 'custom']);
    assert.deepEqual(ids('per_unit'), ['unit', 'm3', 'ton', 'kg', 'meter', 'm2', 'km', 'lot', 'custom']);
    assert.deepEqual(ids('transport'), ['trip', 'km', 'ton', 'tonkm', 'm3', 'hour', 'day', 'custom']);
    assert.deepEqual(ids('turnkey'), ['job', 'milestone', 'custom']);
    assert.deepEqual(ids('lump_sum'), ['job', 'milestone', 'custom']);
    assert.deepEqual(ids('time_materials'), ['hour', 'day', 'custom']);
    // Configurable: todas.
    assert.equal(ids('configurable').length, BILLING_UNITS.length);
  });

  test('"Servicio por unidad producida" ya no ofrece sólo $/día, $/hora y $/mes', () => {
    const ids = unitChoicesFor('per_unit').map((u) => u.id);
    ['day', 'hour', 'month'].forEach((id) => assert.ok(!ids.includes(id), `${id} no es habitual por unidad producida`));
    assert.equal(defaultUnitFor('per_unit'), 'unit');
    assert.equal(defaultUnitFor('transport'), 'trip');
    assert.equal(defaultUnitFor('on_call'), 'day');
  });

  test('todos los tipos de servicio tienen unidades; la unidad actual se conserva aunque no sea habitual', () => {
    SERVICE_TYPES.forEach((t) => assert.ok(Array.isArray(SERVICE_TYPE_UNITS[t.id]) && SERVICE_TYPE_UNITS[t.id].length > 0, t.id));
    const ids = unitChoicesFor('per_unit', 'day').map((u) => u.id);
    assert.ok(ids.includes('day'), 'una cotización vieja por día sigue mostrando $/día');
    assert.equal(unitFitsServiceType('per_unit', 'day'), false);
    assert.equal(unitFitsServiceType('per_unit', 'm3'), true);
    assert.equal(unitFitsServiceType('per_unit', 'custom'), true);
  });

  test('unidad desconocida o vacía = día (como siempre); unidad propia con su nombre', () => {
    assert.equal(billingUnitOf({}).id, 'day');
    assert.equal(billingUnitOf({ unit: 'xyz' }).id, 'day');
    assert.equal(billingUnitOf({ unit: 'hour' }).legacy, true);
    const pozo = billingUnitOf({ unit: 'custom', unitName: 'pozo' });
    assert.deepEqual([pozo.kind, pozo.singular, pozo.plural, pozo.label, pozo.short], ['quantity', 'pozo', 'pozos', '$/pozo', 'pozo']);
    const sinNombre = billingUnitOf({ unit: 'custom', unitName: '  ' });
    assert.deepEqual([sinNombre.singular, sinNombre.plural], ['unidad', 'unidades']);
  });

  test('nombre propio: plural en español, sin "$/" ni caracteres de control, máximo 30', () => {
    assert.equal(pluralizeUnit('pozo'), 'pozos');
    assert.equal(pluralizeUnit('muestra'), 'muestras');
    assert.equal(pluralizeUnit('inspección'), 'inspecciones');
    assert.equal(pluralizeUnit('ensayo'), 'ensayos');
    assert.equal(pluralizeUnit('m³'), 'm³');
    assert.equal(cleanUnitName('$/pozo'), 'pozo');
    assert.equal(cleanUnitName('mues\u0000tra'), 'mues tra');
    assert.equal(cleanUnitName('x'.repeat(50)).length, 30);
  });

  test('preguntas y rótulos en la unidad comercial', () => {
    assert.equal(unitTexts(billingUnitOf({ unit: 'm3' })).quantityQuestion, '¿Cuántos m³ esperás facturar por mes?');
    assert.equal(unitTexts(billingUnitOf({ unit: 'm3' })).breakEvenLabel, 'm³ para no perder');
    assert.equal(unitTexts(billingUnitOf({ unit: 'trip' })).breakEvenLabel, 'Viajes para no perder');
    assert.equal(unitTexts(billingUnitOf({ unit: 'ton' })).breakEvenLabel, 'Toneladas para no perder');
    assert.equal(unitTexts(billingUnitOf({ unit: 'unit' })).breakEvenLabel, 'Unidades para no perder');
    assert.equal(unitTexts(billingUnitOf({ unit: 'custom', unitName: 'muestra' })).quantityQuestion, '¿Cuántas muestras esperás facturar por mes?');
  });
});

describe('motor: cantidad facturable × precio por unidad', () => {
  test('días de trabajo derivados: cantidad ÷ rendimiento (con mínimo por llamado si corresponde)', () => {
    close(activeDaysForQuantity({ kind: 'quantity', quantity: 10000, unitsPerActiveDay: 500, daysPerActivation: 1 }), 20);
    close(activeDaysForQuantity({ kind: 'quantity', quantity: 8000, unitsPerActiveDay: 500, daysPerActivation: 1, minimumCallUnits: 800 }), 10);
    close(activeDaysForQuantity({ kind: 'event', quantity: 6, daysPerActivation: 2 }), 12);
    close(activeDaysForQuantity({ kind: 'event', quantity: 3, unitsPerActivation: 3, daysPerActivation: 10 }), 10);
    // Sin rendimiento no hay días (y validateQuote lo informa): nunca NaN ni Infinity.
    assert.equal(activeDaysForQuantity({ kind: 'quantity', quantity: 100, unitsPerActiveDay: 0, daysPerActivation: 1 }), 0);
  });

  test('$/día, $/hora y $/mes ignoran los campos nuevos de actividad (calculan exactamente igual)', () => {
    ['day', 'hour', 'month'].forEach((unit) => {
      const plain = base({ unit, rate: 4000000 });
      plain.activity.activeDaysPerMonth = 15;
      const withNew = base({ unit, rate: 4000000 });
      withNew.activity.activeDaysPerMonth = 15;
      withNew.activity.billableQuantityPerMonth = 999;
      withNew.activity.unitsPerActiveDay = 3;
      withNew.activity.unitsPerActivation = 7;
      const a = computeQuote(plain).kpis;
      const b = computeQuote(withNew).kpis;
      ['totalCost', 'floorNetRate', 'floorListRate', 'targetListRate', 'revenue', 'profit', 'breakEvenDays', 'activeDays'].forEach((key) => {
        assert.equal(b[key], a[key], `${unit}: ${key}`);
      });
    });
  });

  test('$/llamado: 6 llamados de 2 días, tarifa 3.000.000 → equilibrio 6 llamados (12 días de trabajo)', () => {
    const q = base({ F: 12000000, v: 500000, unit: 'call', serviceType: 'on_call', rate: 3000000 });
    q.activity.billableQuantityPerMonth = 6;
    q.activity.daysPerActivation = 2;
    const r = computeQuote(q);
    close(r.kpis.activeDays, 12);
    close(r.kpis.totalCost, 18000000);
    close(r.kpis.billableQuantity, 6);
    close(r.kpis.revenue, 18000000);
    close(r.kpis.floorNetRate, 3000000);
    close(r.kpis.breakEvenQuantity, 6, 1e-4);
    close(r.kpis.breakEvenDays, 12, 1e-4);
    assert.equal(r.unitLabel, 'llamado');
    assert.equal(r.unitTexts.breakEvenLabel, 'Llamados para no perder');
  });

  test('$/hito: 3 hitos por trabajo de 10 días, 3 hitos por mes → 1 trabajo y 10 días de trabajo', () => {
    const q = base({ F: 5000000, v: 200000, unit: 'milestone', serviceType: 'turnkey' });
    q.activity.billableQuantityPerMonth = 3;
    q.activity.unitsPerActivation = 3;
    q.activity.daysPerActivation = 10;
    const r = computeQuote(q);
    close(r.kpis.activeDays, 10);
    close(r.kpis.totalCost, 7000000);
    close(r.kpis.billableQuantity, 3);
    close(r.kpis.floorNetRate, 7000000 / 3);
  });

  test('$ global por trabajo: medio trabajo por mes de 20 días → 10 días de trabajo y la tarifa cubre el trabajo entero', () => {
    const q = base({ F: 4000000, v: 300000, unit: 'job', serviceType: 'lump_sum' });
    q.activity.billableQuantityPerMonth = 0.5;
    q.activity.daysPerActivation = 20;
    const r = computeQuote(q);
    close(r.kpis.activeDays, 10);
    close(r.kpis.totalCost, 7000000);
    close(r.kpis.floorNetRate, 14000000);
  });

  test('unidad propia ($/pozo): 12 pozos por mes a medio pozo por día → 24 días de trabajo', () => {
    const q = byQuantity({ F: 24000000, v: 1000000, unit: 'custom', rate: 5000000 }, { quantity: 12, perDay: 0.5, unitName: 'pozo' });
    const r = computeQuote(q);
    close(r.kpis.activeDays, 24);
    close(r.kpis.totalCost, 48000000);
    close(r.kpis.floorNetRate, 4000000);
    assert.equal(r.unitLabel, 'pozo');
    assert.match(r.traces.breakEven.title, /^Pozos para no perder/);
    // Contribución por pozo = 5.000.000 − 2.000.000 = 3.000.000 → 8 pozos (16 días).
    close(r.kpis.breakEvenQuantity, 8, 1e-4);
    close(r.kpis.breakEvenDays, 16, 1e-4);
  });

  test('$/km de transporte: 4.000 km por mes a 200 km por día → 20 días de trabajo', () => {
    const q = byQuantity({ F: 10000000, v: 500000, unit: 'km', serviceType: 'transport' }, { quantity: 4000, perDay: 200 });
    const r = computeQuote(q);
    close(r.kpis.activeDays, 20);
    close(r.kpis.floorNetRate, 20000000 / 4000);
  });

  test('mínimo por llamado en la unidad comercial: suma cantidad facturable y baja los días de trabajo', () => {
    const q = byQuantity({ F: 10000000, v: 500000, unit: 'm3', serviceType: 'per_unit', rate: 3000 }, { quantity: 8000, perDay: 500 });
    q.rules.minimumCallUnits = 800;
    const r = computeQuote(q);
    // Cada salida factura al menos 800 m³ aunque se hagan 500: 10 salidas de 1 día.
    close(r.kpis.activeDays, 10);
    close(r.kpis.billableQuantity, 8000);
    assert.equal(r.estimate.revenue.minimumCallApplied, true);
  });

  test('los tramos por cantidad de días sólo aplican con tarifa por día u hora', () => {
    const tiers = [{ id: 't1', fromDays: 1, toDays: null, discountPct: 10 }];
    const day = base({ unit: 'day', rate: 4000000 });
    day.activity.activeDaysPerMonth = 15;
    day.rules.volumeTiers = tiers;
    const m3 = byQuantity({ unit: 'm3', serviceType: 'per_unit', rate: 4000 }, { quantity: 15000, perDay: 1000 });
    m3.rules.volumeTiers = tiers;
    const rd = computeQuote(day);
    const rq = computeQuote(m3);
    close(rd.ratesAtEstimate.discountFactor, 0.9);
    close(rq.ratesAtEstimate.discountFactor, 1);
    assert.deepEqual(rq.discounts, []);
    assert.ok(rd.discounts.length > 0);
  });

  test('horas y materiales: los materiales facturados aparte suman a la facturación (costo × (1 + recargo))', () => {
    const q = base({ F: 3000000, v: 400000, unit: 'hour', serviceType: 'time_materials' });
    q.activity.activeDaysPerMonth = 10;
    q.activity.hoursPerActiveDay = 10;
    q.materialsNotApplicable = false;
    q.materials = [{ id: 'm1', description: 'Material', unit: 'u', basis: 'per_month', quantity: 1, unitCost: 1000000, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 20, providedBy: 'contractor' }];
    const apart = JSON.parse(JSON.stringify(q));
    apart.pricing.materialsBilledSeparately = true;
    const r0 = computeQuote(q);
    const r1 = computeQuote(apart);
    // El costo no cambia: los materiales siguen siendo costo.
    close(r1.kpis.totalCost, r0.kpis.totalCost);
    close(r0.kpis.totalCost, 3000000 + 4000000 + 1000000);
    close(r1.estimate.revenue.components.materialsFixed, 1200000);
    // La tarifa por hora necesaria baja: los materiales se cobran aparte (100 horas).
    close(r0.kpis.floorNetRate, 8000000 / 100);
    close(r1.kpis.floorNetRate, (8000000 - 1200000) / 100);
    // Sin la opción, nada cambia (como siempre).
    assert.equal(r0.estimate.revenue.components.materialsFixed, 0);
  });

  test('casos extremos por cantidad: 0, sin rendimiento, negativos y más días que los disponibles (sin NaN ni Infinity)', () => {
    const cases = [
      byQuantity({ unit: 'm3', rate: 5000 }, { quantity: 0, perDay: 500 }),
      byQuantity({ unit: 'm3', rate: 5000 }, { quantity: 1000, perDay: 0 }),
      byQuantity({ unit: 'm3', rate: 5000 }, { quantity: -50, perDay: 500 }),
      byQuantity({ unit: 'm3' }, { quantity: 1000, perDay: null }),
      byQuantity({ unit: 'm3', rate: 5000 }, { quantity: 100000, perDay: 500 }),
      byQuantity({ unit: 'trip', rate: 1 }, { quantity: 1, perDay: 1 }),
    ];
    cases.forEach((q, i) => {
      const r = computeQuote(q);
      Object.entries(r.kpis).forEach(([key, value]) => {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `caso ${i}: ${key} = ${value}`);
      });
      assert.ok(finiteOrNull(r.kpis.breakEvenQuantity), `caso ${i}: breakEvenQuantity`);
    });
    const noYield = computeQuote(cases[1]);
    assert.ok(noYield.issues.some((x) => x.path === 'activity.unitsPerActiveDay' && x.severity === 'error'));
    const negative = computeQuote(cases[2]);
    assert.ok(negative.issues.some((x) => x.path === 'activity.billableQuantityPerMonth' && x.severity === 'error'));
    assert.equal(negative.kpis.activeDays, 0);
    const tooMuch = computeQuote(cases[4]);
    close(tooMuch.kpis.activeDays, 200);
    assert.ok(tooMuch.issues.some((x) => x.path === 'activity.billableQuantityPerMonth' && x.severity === 'warning'));
  });

  test('avisos de la unidad: unidad propia sin nombre y unidad no habitual para el tipo de servicio', () => {
    const custom = computeQuote(byQuantity({ unit: 'custom' }, { quantity: 10, perDay: 1 }));
    assert.ok(custom.issues.some((x) => x.path === 'unitName'));
    const legacy = base({ unit: 'day', serviceType: 'per_unit', rate: 4000000 });
    legacy.activity.activeDaysPerMonth = 10;
    const r = computeQuote(legacy);
    const warn = r.issues.find((x) => x.path === 'unit');
    assert.ok(warn, 'por unidad producida cobrando $/día avisa');
    assert.match(warn.message, /\$\/unidad/);
    // …pero calcula igual que siempre.
    close(r.kpis.breakEvenDays, 10, 1e-4);
  });

  test('completitud: por cantidad pide la cantidad del mes y el rendimiento', () => {
    const missing = evaluateCompleteness(byQuantity({ unit: 'm3' }, { quantity: null, perDay: null }));
    const item = missing.items.find((x) => x.id === 'utilization');
    assert.equal(item.status, 'missing');
    assert.match(item.detail || item.message || item.label, /m³/);
    const ok = evaluateCompleteness(byQuantity({ unit: 'm3' }, { quantity: 1000, perDay: 100 }));
    assert.equal(ok.items.find((x) => x.id === 'utilization').status, 'ok');
  });

  test('normalizeActivity: por día sigue leyendo los días; por cantidad los deriva', () => {
    const day = base({ unit: 'day' });
    day.activity.activeDaysPerMonth = 7;
    assert.equal(normalizeActivity(day).activeDaysPerMonth, 7);
    assert.equal(normalizeActivity(day).billableQuantityPerMonth, null);
    const m3 = byQuantity({ unit: 'm3' }, { quantity: 3000, perDay: 300 });
    m3.activity.activeDaysPerMonth = 99; // se ignora: los días salen de la cantidad
    close(normalizeActivity(m3).activeDaysPerMonth, 10);
  });
});

describe('escenarios por cantidad', () => {
  test('la variación de actividad cambia la cantidad del mes (los días se derivan)', () => {
    const q = byQuantity({ unit: 'm3', rate: 7000 }, { quantity: 10000, perDay: 500 });
    const up = applySensitivity(q, { activityPct: 10 });
    close(up.activity.billableQuantityPerMonth, 11000);
    close(normalizeActivity(up).activeDaysPerMonth, 22);
    // Tope: no más días que los disponibles (30) → 15.000 m³.
    const huge = applySensitivity(q, { activityPct: 200 });
    close(normalizeActivity(huge).activeDaysPerMonth, 30);
    close(huge.activity.billableQuantityPerMonth, 15000);
    const res = runSensitivity(q, { activityPct: 10 });
    close(res.scenario.billableQuantity, 11000);
    close(res.base.billableQuantity, 10000);
    assert.ok(Number.isFinite(res.scenario.breakEvenQuantity));
  });
});
