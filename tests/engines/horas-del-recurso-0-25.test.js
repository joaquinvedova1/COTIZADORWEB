/**
 * 0.25.0 (PLAN-2026-029, PR 6, P-08/P-09): horas del recurso, un texto y una pregunta.
 *
 * - computeEquipmentUnit con `billableHoursPerMonth`: ésas son las horas usadas. Sin el campo, los
 *   resultados de hoy al centavo (también los fija la foto tanda4-sin-cambio-0-25).
 * - Un equipo guardado sin el campo produce la misma línea de cotización que hoy.
 * - El valor hora de la ficha de Recursos es el mismo que muestra la cotización al asignarlo.
 * - Recursos › Equipos: un solo campo; un equipo nuevo escribe además las horas disponibles al 100 %.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeEquipmentUnit, ownBillableHoursOf } from '../../js/engines/equipment-engine.js';
import { equipmentLineFromLibrary, equipmentBillableHours, createBlankQuote, withTimeCostBasis } from '../../js/domain/quote-factory.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { equipmentFullHourRate, BILLABLE_HOURS_LABEL } from '../../js/ui/result-text.js';
import { legacyEquipmentHours, withEquipmentHours } from '../../js/ui/views/library.js';
import { retiredHoursLabels } from '../lab/lib/ux-audit.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const close = (a, b, msg = '') => assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9), `${msg} ${a} ≠ ${b}`);
const demo = createDemoState(1);
const crane = () => structuredClone(demo.resources.equipment.find((e) => /Hidrogrúa/.test(e.name)));
const FUEL = { fuelPricePerLiter: 1500, fuelPaidByUs: true };

describe('computeEquipmentUnit con y sin las horas nuevas', () => {
  test('sin el campo: horas disponibles × utilización, como siempre', () => {
    const eq = crane();
    const u = computeEquipmentUnit(eq, FUEL);
    close(u.capacity.usedHoursPerMonth, eq.availableHoursPerMonth * eq.utilizationPct / 100);
    close(u.rates.costPerMonth, u.ownership.totalMonthly + u.operation.totalPerHour * u.capacity.usedHoursPerMonth);
    assert.ok(!('ownBillableHours' in u.capacity), 'sin el campo, las mismas claves de siempre');
    assert.equal(ownBillableHoursOf(eq), null);
  });
  test('vacío, 0 o un texto: igual que sin el campo', () => {
    const base = computeEquipmentUnit(crane(), FUEL);
    for (const v of [null, undefined, '', 0, -5, 'abc']) assert.deepEqual(computeEquipmentUnit({ ...crane(), billableHoursPerMonth: v }, FUEL), base, String(v));
  });
  test('con el campo: ésas son las horas usadas', () => {
    const u = computeEquipmentUnit({ ...crane(), billableHoursPerMonth: 120 }, FUEL);
    assert.equal(u.capacity.usedHoursPerMonth, 120);
    assert.equal(u.capacity.ownBillableHours, true);
    close(u.rates.costPerMonth, u.ownership.totalMonthly + u.operation.totalPerHour * 120);
    close(u.rates.costPerUsedHour, u.ownership.totalMonthly / 120 + u.operation.totalPerHour);
  });
  test('el mismo número que daban los datos de antes da la misma ficha', () => {
    const eq = crane();
    const legacy = computeEquipmentUnit(eq, FUEL);
    const own = computeEquipmentUnit({ ...eq, billableHoursPerMonth: legacy.capacity.usedHoursPerMonth }, FUEL);
    close(own.rates.costPerMonth, legacy.rates.costPerMonth);
    close(own.rates.costPerUsedHour, legacy.rates.costPerUsedHour);
    close(own.capacity.usedDaysPerMonth, legacy.capacity.usedDaysPerMonth);
  });
  test('un equipo nuevo (horas = disponibles, 100 %) lo lee igual una versión anterior', () => {
    const fresh = withEquipmentHours({ ...crane(), availableHoursPerMonth: null, utilizationPct: null, billableHoursPerMonth: 90 });
    assert.equal(fresh.availableHoursPerMonth, 90);
    assert.equal(fresh.utilizationPct, 100);
    const { billableHoursPerMonth, ...asOldTab } = fresh;
    close(computeEquipmentUnit(asOldTab, FUEL).rates.costPerUsedHour, computeEquipmentUnit(fresh, FUEL).rates.costPerUsedHour);
  });
});

describe('la línea de cotización y el valor hora', () => {
  test('un equipo guardado sin el campo produce la misma línea que hoy', () => {
    for (const eq of demo.resources.equipment) {
      const line = equipmentLineFromLibrary(structuredClone(eq), { id: 'l', now: '2026-11-01T00:00:00.000Z' });
      assert.equal(line.billableHoursPerMonth, equipmentBillableHours(eq));
      assert.equal(line.billableHoursPerMonth, Math.round(eq.availableHoursPerMonth * eq.utilizationPct) / 100);
    }
  });
  test('E2E-34 en Node: el $/hora de Recursos es el valor hora que muestra la cotización', () => {
    for (const hours of [null, 120, 200]) {
      const eq = { ...crane(), billableHoursPerMonth: hours };
      const card = computeEquipmentUnit(eq, { fuelPricePerLiter: demo.settings.fuelPricePerLiter, fuelPaidByUs: true });
      const q = withTimeCostBasis(createBlankQuote({ organizationId: 'o', settings: demo.settings, now: '2026-11-01T00:00:00.000Z', id: 'q' }, { unit: 'hour' }));
      Object.assign(q.activity, { activeDaysPerMonth: 10, hoursPerActiveDay: 8 });
      q.contract = { ...q.contract, components: ['labor', 'machinery'], equipment: true };
      q.equipment = [equipmentLineFromLibrary(eq, { id: 'l', now: '2026-11-01T00:00:00.000Z' })];
      const r = computeQuote(q, { settings: demo.settings });
      const shown = equipmentFullHourRate(r.model.equipment[0]);
      assert.ok(Math.abs(shown - card.rates.costPerUsedHour) < 0.5, `${hours}: cotización ${shown} vs Recursos ${card.rates.costPerUsedHour}`);
    }
  });
});

describe('Recursos › Equipos: una pregunta', () => {
  test('el mismo texto para personas y equipos', () => {
    assert.equal(BILLABLE_HOURS_LABEL, '¿Cuántas horas por mes trabaja para clientes, entre todos tus trabajos?');
    const lib = source('js/ui/views/library.js');
    assert.match(lib, /key: 'billableHoursPerMonth',\n\s+label: BILLABLE_HOURS_LABEL/);
    assert.match(source('js/ui/views/quote-steps/equipment.js'), /label: BILLABLE_HOURS_LABEL/);
  });
  test('UX-TERM-HOURS: no quedan los rótulos de antes', () => {
    assert.deepEqual(retiredHoursLabels(), []);
  });
  test('el sugerido de un equipo de antes es disponibles × utilización', () => {
    assert.equal(legacyEquipmentHours({ availableHoursPerMonth: 300, utilizationPct: 27 }), 81);
    assert.equal(legacyEquipmentHours({ availableHoursPerMonth: null, utilizationPct: 50 }), null);
    assert.equal(legacyEquipmentHours({ availableHoursPerMonth: 300, utilizationPct: 0 }), null);
  });
  test('un equipo de antes conserva sus tres datos al guardar', () => {
    const eq = { ...crane(), billableHoursPerMonth: 150 };
    const saved = withEquipmentHours(structuredClone(eq));
    assert.equal(saved.availableHoursPerMonth, eq.availableHoursPerMonth);
    assert.equal(saved.utilizationPct, eq.utilizationPct);
    assert.equal(saved.availableDaysPerMonth, eq.availableDaysPerMonth);
  });
  test('la tabla de Equipos: sin "Costo por día usado" ni "Utilización"', () => {
    const lib = source('js/ui/views/library.js');
    assert.doesNotMatch(lib, /label: 'Costo por día usado'/);
    assert.doesNotMatch(lib, /key: 'util', label: 'Utilización'/);
  });
  test('la ficha en la cotización no toma las horas de Recursos (usa las de la cotización)', () => {
    assert.match(source('js/ui/views/quote-steps/equipment.js'), /utilizationPct: activity\.utilizationPct,\n\s+\/\/[^\n]*\n\s+billableHoursPerMonth: null,/);
  });
});
