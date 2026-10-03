/**
 * Tests de ResourceService (bibliotecas y plantillas de servicio).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createResourceService } from '../../js/services/resource-service.js';
import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { RESOURCE_TYPES } from '../../js/data/schema.js';
import { DEMO_IDS } from '../../js/domain/demo-data.js';
import { isUuid } from '../../js/core/ids.js';
import { isFiniteNumber } from '../../js/core/money.js';
import { configureLogger } from '../../js/core/logger.js';
import { addEventSink } from '../../js/core/events.js';

configureLogger({ consoleImpl: null });

async function setup() {
  const storage = new MemoryStorage();
  const repository = new LocalStorageRepository(storage);
  await repository.init();
  return { service: createResourceService({ repository }), repository, storage };
}

/** Rutas con NaN/Infinity/-Infinity en un objeto (null es válido: "no disponible"). */
function nonFinitePaths(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => nonFinitePaths(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const GARBAGE_INPUTS = [
  {},
  { replacementValue: -100, usefulLifeYears: 0, availableHoursPerMonth: 0, utilizationPct: 0 },
  { replacementValue: 'abc', usefulLifeYears: NaN, residualValue: Infinity, fuelLitersPerHour: -5, utilizationPct: 1000 },
  { replacementValue: 1e300, usefulLifeYears: 1e-300, availableHoursPerMonth: 1e-300, utilizationPct: 1e-300 },
];

describe('ResourceService — CRUD de bibliotecas', () => {
  test('expone los tipos de recurso del esquema', async () => {
    const { service } = await setup();
    assert.deepEqual(service.types, RESOURCE_TYPES);
  });

  for (const type of RESOURCE_TYPES) {
    test(`list/get/save/remove de "${type}"`, async () => {
      const { service, repository } = await setup();
      const initial = await service.list(type);
      assert.ok(initial.length > 0, 'la demo trae datos ilustrativos');

      const saved = await service.save(type, { name: `Nuevo ${type}` });
      assert.ok(isUuid(saved.id));
      assert.deepEqual(await service.get(type, saved.id), saved);
      assert.equal((await service.list(type)).length, initial.length + 1);
      assert.deepEqual(await repository.getResource(type, saved.id), saved);

      assert.equal(await service.remove(type, saved.id), true);
      assert.equal(await service.get(type, saved.id), null);
      assert.equal(await service.remove(type, saved.id), false);
    });
  }

  test('tipo desconocido se rechaza', async () => {
    const { service } = await setup();
    await assert.rejects(service.list('clientes'), { code: 'unknown_type' });
    await assert.rejects(service.save('clientes', { name: 'x' }), { code: 'unknown_type' });
    await assert.rejects(service.remove('__proto__', 'x'), { code: 'unknown_type' });
  });

  test('save emite resource_saved con el tipo en snake_case y sin datos del recurso', async () => {
    const events = [];
    const remove = addEventSink((e) => events.push(e), { force: true });
    try {
      const { service } = await setup();
      await service.save('laborProfiles', { role: 'Soldador', basicMonthly: 2500000 });
      await service.save('equipment', { name: 'Grúa' });
    } finally {
      remove();
    }
    const saved = events.filter((e) => e.name === 'resource_saved');
    assert.deepEqual(saved.map((e) => e.props), [{ resourceType: 'labor_profiles' }, { resourceType: 'equipment' }]);
    assert.equal(JSON.stringify(saved).includes('2500000'), false, 'nunca se envían salarios');
  });
});

describe('ResourceService — plantillas de servicio', () => {
  test('listServices/saveService/removeService', async () => {
    const { service } = await setup();
    const initial = await service.listServices();
    assert.equal(initial.length, 12);
    const saved = await service.saveService({ name: 'Plantilla propia', serviceType: 'crew', defaults: { unit: 'hour' } });
    assert.ok(isUuid(saved.id));
    assert.equal((await service.listServices()).length, 13);
    assert.equal(await service.removeService(saved.id), true);
    assert.equal(await service.removeService(saved.id), false);
    assert.equal((await service.listServices()).length, 12);
  });
});

describe('ResourceService.equipmentCard', () => {
  test('todos los equipos demo devuelven números finitos y costos positivos', async () => {
    const { service } = await setup();
    const equipment = await service.list('equipment');
    assert.equal(equipment.length, 10);
    for (const eq of equipment) {
      const card = await service.equipmentCard(eq);
      assert.deepEqual(nonFinitePaths(card), [], eq.name);
      assert.ok(isFiniteNumber(card.ownership.totalMonthly) && card.ownership.totalMonthly > 0, eq.name);
      assert.ok(isFiniteNumber(card.rates.costPerMonth) && card.rates.costPerMonth > 0, eq.name);
      assert.ok(isFiniteNumber(card.rates.costPerUsedHour) && card.rates.costPerUsedHour > 0, eq.name);
      assert.ok(isFiniteNumber(card.rates.costPerUsedDay) && card.rates.costPerUsedDay > 0, eq.name);
    }
  });

  test('hidrogrúa demo: amortización (250M − 50M) / 10 años / 12 meses', async () => {
    const { service } = await setup();
    const eq = await service.get('equipment', DEMO_IDS.equipmentHydroCrane);
    const card = await service.equipmentCard(eq);
    assert.ok(Math.abs(card.ownership.depreciationMonthly - 200000000 / 120) < 1e-6);
  });

  test('usa el precio de combustible de la configuración vigente', async () => {
    const { service, repository } = await setup();
    const eq = await service.get('equipment', DEMO_IDS.equipmentHydroCrane);
    const before = await service.equipmentCard(eq);
    assert.equal(before.operation.fuelPricePerLiter, (await repository.getSettings()).fuelPricePerLiter);
    await repository.saveSettings({ fuelPricePerLiter: 2000 });
    const after = await service.equipmentCard(eq);
    assert.equal(after.operation.fuelPricePerLiter, 2000);
    assert.ok(after.operation.totalPerHour > before.operation.totalPerHour);
  });

  test('datos incompletos o inválidos nunca producen NaN/Infinity', async () => {
    const { service } = await setup();
    for (const input of GARBAGE_INPUTS) {
      const card = await service.equipmentCard(input);
      assert.deepEqual(nonFinitePaths(card), [], JSON.stringify(input));
    }
  });
});

describe('ResourceService.laborProfileCost', () => {
  test('todos los perfiles demo devuelven costos finitos y positivos para 1 persona', async () => {
    const { service } = await setup();
    const profiles = await service.list('laborProfiles');
    assert.equal(profiles.length, 5);
    for (const profile of profiles) {
      const cost = service.laborProfileCost(profile);
      assert.deepEqual(nonFinitePaths(cost), [], profile.role);
      assert.equal(cost.headcount, 1, profile.role);
      assert.ok(isFiniteNumber(cost.fixedMonthly) && cost.fixedMonthly > 0, profile.role);
      assert.ok(isFiniteNumber(cost.variablePerActiveDay) && cost.variablePerActiveDay >= 0, profile.role);
      assert.ok(cost.fixedMonthly > profile.basicMonthly, 'el costo cargado supera el básico');
    }
  });

  test('siempre calcula para 1 persona aunque el perfil diga otra cosa', async () => {
    const { service } = await setup();
    const profile = await service.get('laborProfiles', DEMO_IDS.profileOperator);
    const single = service.laborProfileCost(profile);
    const many = service.laborProfileCost({ ...profile, positions: 5, peoplePerPosition: 3 });
    assert.equal(many.headcount, 1);
    assert.equal(many.fixedMonthly, single.fixedMonthly);
  });

  test('no modifica el perfil recibido', async () => {
    const { service } = await setup();
    const profile = await service.get('laborProfiles', DEMO_IDS.profileOperator);
    const before = JSON.stringify(profile);
    service.laborProfileCost(profile);
    assert.equal(JSON.stringify(profile), before);
  });

  test('datos incompletos o inválidos nunca producen NaN/Infinity', async () => {
    const { service } = await setup();
    for (const input of [{}, { basicMonthly: -1, normalHoursPerMonth: 0 }, { basicMonthly: 'x', sacPct: NaN, normalHoursPerMonth: Infinity }, { basicMonthly: 1e300, normalHoursPerMonth: 1e-300 }]) {
      const cost = service.laborProfileCost(input);
      assert.deepEqual(nonFinitePaths(cost), [], JSON.stringify(input));
    }
  });
});
