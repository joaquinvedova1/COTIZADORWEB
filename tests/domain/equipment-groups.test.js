/**
 * RES-02 (PLAN-2026-024) · Equipos agrupados por familia: cada familia en un
 * solo grupo (los equipos especiales aparte de los camiones), unidades propias
 * ≠ alquiladas o tercerizadas y costo de tener la flota propia. Datos
 * sintéticos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EQUIPMENT_GROUPS,
  TENURE_EXTERNAL,
  TENURE_OWNED,
  equipmentCountsText,
  equipmentGroupId,
  filterEquipmentGroups,
  groupEquipment,
  groupIdOfFamily,
  holdingMonthlyOf,
} from '../../js/domain/equipment-groups.js';
import { EQUIPMENT_FAMILY_IDS } from '../../js/domain/equipment-catalog.js';
import { computeEquipmentUnit } from '../../js/engines/equipment-engine.js';
import { deepClone } from '../../js/core/object.js';

const owned = (id, familyId, o = {}) => ({
  id, name: `Equipo ${id}`, familyId, acquisition: 'owned', internalCode: '', plate: '', capacity: '',
  replacementValue: 120000000, residualValue: 20000000, usefulLifeYears: 10, insuranceAnnual: 2400000, licenseAnnual: 600000,
  certificationsAnnual: 300000, otherAnnual: 0, capitalRatePctAnnual: 8, maintenancePerHour: 9000, tiresPerHour: 2000, fuelLitersPerHour: 12,
  availableHoursPerMonth: 200, availableDaysPerMonth: 22, utilizationPct: 60, ...o,
});
const rented = (id, familyId, o = {}) => ({ id, name: `Alquiler ${id}`, familyId, acquisition: 'rented', external: { price: 1800000, unit: 'day' }, ...o });
const cardOf = (eq) => computeEquipmentUnit(eq, { fuelPricePerLiter: 1500 });
const titles = (groups) => groups.map((g) => g.title);

describe('RES-02 · grupos visibles de equipos', () => {
  test('cada una de las 29 familias del catálogo está en exactamente un grupo, y los grupos sólo nombran familias que existen', () => {
    assert.equal(EQUIPMENT_FAMILY_IDS.length, 29);
    const seen = EQUIPMENT_GROUPS.flatMap((g) => g.families);
    EQUIPMENT_FAMILY_IDS.forEach((f) => assert.equal(seen.filter((x) => x === f).length, 1, `familia ${f}`));
    seen.forEach((f) => assert.ok(EQUIPMENT_FAMILY_IDS.includes(f), `familia inexistente ${f}`));
  });

  test('los equipos especiales no van con los camiones (revisión de ChatGPT, punto 6)', () => {
    assert.equal(groupIdOfFamily('vactor'), 'vacuum');
    assert.equal(groupIdOfFamily('vacuum_truck'), 'vacuum');
    assert.equal(groupIdOfFamily('flushby'), 'well');
    assert.equal(groupIdOfFamily('wireline'), 'well');
    assert.deepEqual(EQUIPMENT_GROUPS.find((g) => g.id === 'trucks').families, ['truck', 'tank_truck', 'tractor']);
  });

  test('tipos del esquema anterior por su familia; sin familia, "Otros / sin familia"', () => {
    assert.equal(equipmentGroupId({ type: 'vehicle' }), 'light');
    assert.equal(equipmentGroupId({ type: 'trailer' }), 'trailers');
    assert.equal(equipmentGroupId({ type: 'crane_truck' }), 'cranes');
    assert.equal(equipmentGroupId({}), 'other');
    assert.equal(equipmentGroupId({ familyId: 'no_existe' }), 'other');
    assert.equal(equipmentGroupId(null), 'other');
  });

  test('orden fijo; sin fichas, sin grupos; los grupos vacíos no se devuelven', () => {
    assert.deepEqual(groupEquipment([]), []);
    assert.deepEqual(groupEquipment(null), []);
    const groups = groupEquipment([owned('a', 'other'), owned('b', 'pickup'), owned('c', 'flushby'), owned('d', 'crane_truck')], { cardOf });
    assert.deepEqual(titles(groups), ['Grúas', 'Equipos de pozo', 'Camionetas y vehículos livianos', 'Otros / sin familia']);
  });
});

describe('RES-02 · flota propia y alquiladas', () => {
  test('cuenta las propias y, aparte, las alquiladas o tercerizadas', () => {
    const [g] = groupEquipment([owned('h1', 'crane_truck'), owned('h2', 'crane_truck'), rented('r1', 'crane'), rented('r2', 'crane', { acquisition: 'outsourced' })], { cardOf });
    assert.equal(g.ownedCount, 2);
    assert.equal(g.externalCount, 2);
    assert.equal(equipmentCountsText(g), '2 unidades propias · 2 alquiladas o tercerizadas (no suman)');
    assert.equal(equipmentCountsText({ ownedCount: 1, externalCount: 0 }), '1 unidad propia');
    assert.equal(equipmentCountsText({ ownedCount: 0, externalCount: 1 }), '1 alquilada o tercerizada (no suma)');
  });

  test('monto del grupo = Σ costo de tener cada propia (posesión del motor); las alquiladas nunca suman', () => {
    const h1 = owned('h1', 'crane_truck');
    const h2 = owned('h2', 'crane', { replacementValue: 300000000, insuranceAnnual: 6000000 });
    const [g] = groupEquipment([h1, h2, rented('r1', 'crane', { external: { price: 99000000, unit: 'month' } })], { cardOf });
    const expected = Math.round((cardOf(h1).ownership.totalMonthly + cardOf(h2).ownership.totalMonthly) * 100) / 100;
    assert.equal(g.holdingMonthly, expected);
    assert.equal(g.partial, false);
    assert.equal(holdingMonthlyOf(rented('r', 'crane'), cardOf(owned('x', 'crane'))), null);
  });

  test('una propia en otra moneda sin tipo de cambio no se suma: subtotal parcial; si es la única, sin monto', () => {
    const usd = owned('u1', 'excavator');
    const cards = (eq) => (eq.id === 'u1' ? { ...cardOf(eq), currency: { code: 'USD', rate: null, converted: false } } : cardOf(eq));
    const [g] = groupEquipment([owned('e1', 'backhoe'), usd], { cardOf: cards });
    assert.equal(g.unvaluedCount, 1);
    assert.equal(g.partial, true);
    assert.equal(g.holdingMonthly, Math.round(cardOf(owned('e1', 'backhoe')).ownership.totalMonthly * 100) / 100);
    const [only] = groupEquipment([usd], { cardOf: cards });
    assert.equal(only.holdingMonthly, null);
    assert.equal(only.unvaluedCount, 1);
    assert.equal(only.partial, false);
  });

  test('sin propias, no hay monto', () => {
    const [g] = groupEquipment([rented('r1', 'pickup')], { cardOf });
    assert.equal(g.ownedCount, 0);
    assert.equal(g.holdingMonthly, null);
  });

  test('dentro del grupo, primero las propias y después por nombre', () => {
    const [g] = groupEquipment([rented('r', 'truck', { name: 'Aaa alquilado' }), owned('b', 'truck', { name: 'Zeta' }), owned('a', 'truck', { name: 'Alfa' })], { cardOf });
    assert.deepEqual(g.items.map((i) => i.equipment.name), ['Alfa', 'Zeta', 'Aaa alquilado']);
  });

  test('agrupar no cambia las fichas', () => {
    const list = [owned('h1', 'crane_truck'), rented('r1', 'crane')];
    const before = deepClone(list);
    groupEquipment(list, { cardOf });
    assert.deepEqual(list, before);
  });
});

describe('RES-02 · buscar y filtrar equipos', () => {
  const list = [
    owned('h1', 'crane_truck', { name: 'Hidrogrúa 30 t·m', internalCode: 'HG-01', plate: 'AB123CD' }),
    owned('v1', 'vactor', { name: 'Combinado', capacity: '12 yd³' }),
    rented('r1', 'crane', { name: 'Grúa 50 t' }),
  ];
  const groups = groupEquipment(list, { cardOf });

  test('por tenencia: propias o alquiladas y tercerizadas, con los conteos y el monto de lo que queda', () => {
    const own = filterEquipmentGroups(groups, { tenure: TENURE_OWNED });
    assert.deepEqual(own.map((g) => [g.title, g.ownedCount, g.externalCount]), [['Grúas', 1, 0], ['Equipos de vacío y succión', 1, 0]]);
    const ext = filterEquipmentGroups(groups, { tenure: TENURE_EXTERNAL });
    assert.deepEqual(ext.map((g) => [g.title, g.ownedCount, g.externalCount, g.holdingMonthly]), [['Grúas', 0, 1, null]]);
  });

  test('por texto: nombre, interno, dominio, familia, capacidad o modelo, sin mayúsculas ni tildes', () => {
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'hg-01' }).map((g) => g.items.length), [1]);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'ab123' }).map((g) => g.items[0].equipment.id), ['h1']);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'vactor' }).map((g) => g.items[0].equipment.id), ['v1']);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'yd³' }).map((g) => g.items[0].equipment.id), ['v1']);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'vac-con', modelLabelOf: (eq) => (eq.id === 'v1' ? 'Vac-Con PD4211' : '') }).map((g) => g.items[0].equipment.id), ['v1']);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'HIDROGRUA' }).map((g) => g.items[0].equipment.id), ['h1']);
    assert.deepEqual(filterEquipmentGroups(groups, { query: 'nada que ver' }), []);
  });

  test('si el texto coincide con el grupo, se ve el grupo entero', () => {
    const [g] = filterEquipmentGroups(groups, { query: 'grúas' });
    assert.equal(g.items.length, 2);
  });
});
