/**
 * Ampliación de unidades de facturación (2026-11, pedido de Joaco): energía y
 * potencia (kWh, MWh, MJ, GJ, MMBTU, kW-día, kVA-día, HP-hora), gas, equipos,
 * jornal, pozo, montaje, logística y laboratorio. Las unidades de siempre no
 * cambian (ni id, ni orden, ni cálculo) y las cotizaciones guardadas se leen igual.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_UNITS, BILLING_UNIT_IDS, billingUnitOf, unitTexts, searchUnits, unitGroupOf } from '../../js/domain/billing-units.js';
import { contractUnits, unitChoicesForContract } from '../../js/domain/contract.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { demoReferenceQuote } from '../../js/domain/demo-data.js';

const NEW = ['kwh', 'mwh', 'mj', 'gj', 'mmbtu', 'kw_day', 'kva_day', 'hp_hour', 'gas_m3', 'equipment_hour', 'equipment_day', 'manday', 'guard',
  'stage', 'drilled_meter', 'connection', 'inch_dia', 'joint', 'point', 'pallet', 'container', 'drum', 'bag', 'sample', 'analysis'];
const OLD = ['hour', 'day', 'month', 'call', 'shift', 'trip', 'km', 'ton', 'tonkm', 'm3', 'unit', 'kg', 'meter', 'm2', 'lot', 'piece', 'well', 'test', 'manhour', 'liter', 'barrel', 'ha', 'set', 'job', 'milestone', 'custom'];

describe('unidades 2026-11', () => {
  test('las de siempre siguen estando; las nuevas son únicas y por cantidad', () => {
    OLD.forEach((id) => assert.ok(BILLING_UNIT_IDS.includes(id), id));
    assert.equal(new Set(BILLING_UNIT_IDS).size, BILLING_UNIT_IDS.length);
    NEW.forEach((id) => {
      const u = BILLING_UNITS.find((x) => x.id === id);
      assert.ok(u, id);
      assert.equal(u.kind, 'quantity');
      assert.ok(u.singular && u.plural && u.short && u.label.startsWith('$/') && u.hint, id);
      assert.notEqual(unitGroupOf(u).id, 'other', id);
    });
  });

  test('la unidad sugerida y el orden de las de siempre no cambian', () => {
    const eq = contractUnits({ mode: 'on_demand', labor: true, equipment: true });
    assert.deepEqual(eq.slice(0, 22), ['hour', 'day', 'call', 'trip', 'km', 'm3', 'ton', 'tonkm', 'liter', 'barrel', 'shift', 'unit', 'piece', 'well', 'test', 'meter', 'm2', 'ha', 'kg', 'lot', 'set', 'manhour']);
    NEW.forEach((id) => assert.ok(eq.includes(id), id));
    assert.deepEqual(contractUnits({ mode: 'monthly' }), ['month']);
    assert.deepEqual(contractUnits({ mode: 'closed' }), ['job', 'milestone']);
    assert.equal(unitChoicesForContract({ mode: 'on_demand', labor: true, equipment: false }).at(-1).id, 'custom');
  });

  test('concordancia y preguntas propias ("¿Cuántos kVA ponés a disposición…?", "las horas de equipo")', () => {
    const kva = unitTexts(billingUnitOf({ unit: 'kva_day' }));
    assert.equal(kva.cuantos, 'cuántos'); // "kVA-día" termina en "a" pero es masculino
    assert.match(kva.perDayQuestion, /kVA ponés a disposición/);
    assert.equal(unitTexts(billingUnitOf({ unit: 'hp_hour' })).Cuantos, 'Cuántos');
    assert.equal(unitTexts(billingUnitOf({ unit: 'equipment_hour' })).los, 'las');
    assert.equal(unitTexts(billingUnitOf({ unit: 'inch_dia' })).cuantos, 'cuántas');
    assert.equal(unitTexts(billingUnitOf({ unit: 'analysis' })).los, 'los');
    assert.equal(unitTexts(billingUnitOf({ unit: 'joint' })).cuantos, 'cuántas');
    assert.equal(unitTexts(billingUnitOf({ unit: 'kwh' })).quantityQuestion, '¿Cuántos kWh esperás facturar por mes?');
    // Una unidad de siempre no recibe textos nuevos.
    assert.equal(unitTexts(billingUnitOf({ unit: 'm3' })).perDayQuestion, '¿Cuántos m³ hacés por día de trabajo?');
  });

  test('el buscador encuentra por nombre, sinónimo y grupo, sin tildes', () => {
    const ids = (q) => searchUnits(BILLING_UNITS, q).map((u) => u.id);
    assert.ok(ids('joule').includes('mj') && ids('joule').includes('gj'));
    assert.ok(ids('potencia').includes('kva_day') && ids('potencia').includes('hp_hour'));
    assert.ok(ids('kw').includes('kw_day') && ids('kw').includes('kwh'));
    assert.ok(ids('energia').includes('kwh'));
    assert.ok(ids('soldadura').includes('joint') && ids('soldadura').includes('inch_dia'));
    assert.deepEqual(ids('m³ de gas'), ['gas_m3']);
    assert.equal(ids('').length, BILLING_UNITS.length);
    assert.deepEqual(ids('zzz'), []);
  });

  test('una cotización $/kVA-día calcula igual que la misma por cantidad en $/unidad', () => {
    const make = (unit) => {
      const q = demoReferenceQuote();
      q.serviceType = 'configurable';
      q.unit = unit;
      q.activity.billableQuantityPerMonth = 10000;
      q.activity.unitsPerActiveDay = 500;
      q.activity.daysPerActivation = 1;
      return computeQuote(q);
    };
    const a = make('kva_day');
    const b = make('unit');
    assert.equal(a.ratesAtEstimate.activeDays, 20);
    assert.equal(a.ratesAtEstimate.billableUnits, 10000);
    assert.equal(a.ratesAtEstimate.floorListRate, b.ratesAtEstimate.floorListRate);
    assert.equal(a.ratesAtEstimate.totalCost, b.ratesAtEstimate.totalCost);
  });

  test('una cotización guardada con una unidad que no existe sigue siendo $/día', () => {
    assert.equal(billingUnitOf({ unit: 'volt' }).id, 'day');
  });
});
