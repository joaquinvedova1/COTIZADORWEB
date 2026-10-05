/**
 * Tests de LocalStorageRepository (capa de datos).
 *
 * Contrato de persistencia (Prompt 2 "Persistencia local", Prompt 4 §2, §5-§7):
 * - Los datos sobreviven recargas, cierres del navegador y nuevos deploys.
 * - Toda mutación es transaccional: si falla, no cambia nada.
 * - Nunca se usa storage.clear().
 * - Datos dañados, de versión más nueva o legados NUNCA se pierden.
 *
 * Se usa MemoryStorage (misma interfaz que Web Storage) como almacenamiento.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { LocalStorageRepository, MAX_RECOVERY_SNAPSHOTS } from '../../js/data/local-storage-repository.js';
import { MemoryStorage, getBrowserStorage } from '../../js/data/memory-storage.js';
import { RepositoryError, StorageRepository } from '../../js/data/storage-repository.js';
import { CURRENT_SCHEMA_VERSION, RESOURCE_TYPES, validateState } from '../../js/data/schema.js';
import { createRepository } from '../../js/data/repository-factory.js';
import { STORAGE_KEYS } from '../../js/config.js';
import { createDemoState, DEMO_IDS, DEMO_ORG_ID } from '../../js/domain/demo-data.js';
import { isUuid } from '../../js/core/ids.js';
import { configureLogger } from '../../js/core/logger.js';

// Silencia los logs informativos del repositorio durante los tests.
configureLogger({ consoleImpl: null });

// ------------------------------------------------------------------ helpers

/** Reloj controlable: cada llamada devuelve la hora actual; advance() la mueve. */
function createClock(startMs = Date.UTC(2026, 9, 3, 10, 0, 0)) {
  let t = startMs;
  const now = () => new Date(t).toISOString();
  now.advance = (ms = 1000) => {
    t += ms;
    return now();
  };
  return now;
}

/** Storage espía: registra llamadas y PROHÍBE clear(). */
class SpyStorage extends MemoryStorage {
  constructor(initial) {
    super(initial);
    this.calls = [];
  }

  getItem(key) {
    this.calls.push(['getItem', key]);
    return super.getItem(key);
  }

  setItem(key, value) {
    this.calls.push(['setItem', key]);
    super.setItem(key, value);
  }

  removeItem(key) {
    this.calls.push(['removeItem', key]);
    super.removeItem(key);
  }

  clear() {
    this.calls.push(['clear']);
    throw new Error('storage.clear() está prohibido en RATEOS');
  }

  writes() {
    return this.calls.filter(([op]) => op === 'setItem' || op === 'removeItem' || op === 'clear');
  }
}

/** Storage que puede simular "almacenamiento lleno" (QuotaExceededError). */
class QuotaStorage extends SpyStorage {
  constructor(initial) {
    super(initial);
    this.failWhen = () => false;
  }

  setItem(key, value) {
    if (this.failWhen(key)) {
      this.calls.push(['setItem:failed', key]);
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    super.setItem(key, value);
  }
}

/** Copia de todas las claves/valores usando sólo la API Web Storage. */
function dump(storage) {
  const out = {};
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    out[k] = storage.getItem(k);
  }
  return out;
}

function recoveryKeys(storage) {
  return Object.keys(dump(storage)).filter((k) => k.startsWith(STORAGE_KEYS.recoveryPrefix));
}

async function setup({ storage = new SpyStorage(), clock = createClock(), ...options } = {}) {
  const repo = new LocalStorageRepository(storage, { now: clock, ...options });
  const init = await repo.init();
  return { repo, storage, clock, init };
}

/** Estado completo leído a través de la interfaz pública. */
async function readAll(repo) {
  return {
    organization: await repo.getOrganization(),
    resources: await repo.getResources(),
    services: await repo.getServices(),
    quotes: await repo.getQuotes(),
    settings: await repo.getSettings(),
  };
}

function persistedState(storage) {
  return JSON.parse(storage.getItem(STORAGE_KEYS.state));
}

const ALL_WRITES = (repo) => [
  ['saveQuote', () => repo.saveQuote({ name: 'X' })],
  ['updateQuote', () => repo.updateQuote(DEMO_IDS.quoteHydroCrane, { name: 'X' })],
  ['deleteQuote', () => repo.deleteQuote(DEMO_IDS.quoteHydroCrane)],
  ['saveResource', () => repo.saveResource('equipment', { name: 'X' })],
  ['updateResource', () => repo.updateResource('equipment', DEMO_IDS.equipmentPickup, { name: 'X' })],
  ['deleteResource', () => repo.deleteResource('equipment', DEMO_IDS.equipmentPickup)],
  ['saveService', () => repo.saveService({ name: 'X' })],
  ['deleteService', () => repo.deleteService(DEMO_IDS.templateHydroCrane)],
  ['saveSettings', () => repo.saveSettings({ fuelPricePerLiter: 1 })],
  ['saveOrganization', () => repo.saveOrganization({ name: 'X' })],
  ['importBackup', () => repo.importBackup(createDemoState(CURRENT_SCHEMA_VERSION))],
  ['resetToDemo', () => repo.resetToDemo()],
];

// ===================================================================== init

describe('LocalStorageRepository — inicialización', () => {
  test('implementa la interfaz StorageRepository', () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    assert.ok(repo instanceof StorageRepository);
    for (const method of Object.getOwnPropertyNames(StorageRepository.prototype)) {
      if (method === 'constructor') continue;
      assert.equal(typeof repo[method], 'function', `falta ${method}()`);
    }
  });

  test('sin datos guardados siembra la demo y la persiste', async () => {
    const { repo, storage, init } = await setup();
    assert.equal(init.status, 'seeded');
    assert.equal(init.readOnly, false);
    assert.ok(init.messages.some((m) => /ILUSTRATIVOS/.test(m)), 'debe avisar que la demo es ilustrativa');

    const persisted = persistedState(storage);
    assert.deepEqual(persisted, createDemoState(CURRENT_SCHEMA_VERSION));
    assert.equal(persisted.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(validateState(persisted).ok, true);

    const org = await repo.getOrganization();
    assert.equal(org.name, 'Patagonia Servicios SRL');
    assert.equal((await repo.getQuotes()).length, 2);
  });

  test('init es idempotente: no relee ni vuelve a sembrar', async () => {
    const { repo, storage, init } = await setup();
    const writesBefore = storage.writes().length;
    const again = await repo.init();
    assert.equal(again.status, init.status);
    assert.equal(storage.writes().length, writesBefore);
  });

  test('operaciones antes de init() fallan con not_initialized', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await assert.rejects(repo.getQuotes(), { name: 'RepositoryError', code: 'not_initialized' });
    await assert.rejects(repo.getSettings(), { code: 'not_initialized' });
    await assert.rejects(repo.saveQuote({ name: 'x' }), { code: 'not_initialized' });
  });

  test('storage inválido se rechaza en el constructor', () => {
    assert.throws(() => new LocalStorageRepository(null), { name: 'RepositoryError', code: 'invalid_storage' });
    assert.throws(() => new LocalStorageRepository({}), { code: 'invalid_storage' });
  });

  test('si el navegador no deja leer el almacenamiento, init falla con read_failed y no escribe nada', async () => {
    const storage = new SpyStorage();
    storage.getItem = () => {
      throw new Error('SecurityError');
    };
    const repo = new LocalStorageRepository(storage);
    await assert.rejects(repo.init(), { code: 'read_failed' });
    assert.equal(storage.writes().length, 0);
  });
});

// ========================================================== recarga / deploy

describe('LocalStorageRepository — persistencia entre recargas y deploys', () => {
  test('una nueva instancia sobre el mismo storage conserva todos los cambios', async () => {
    const storage = new SpyStorage();
    const clock = createClock();
    const { repo: a } = await setup({ storage, clock, appVersion: '0.1.0' });

    const quote = await a.saveQuote({ name: 'Cotización persistente', client: 'Cliente X', pricing: { knownRate: 123456.78 } });
    await a.deleteQuote(DEMO_IDS.quoteReference);
    const eq = await a.saveResource('equipment', { name: 'Grúa nueva', replacementValue: 1000 });
    await a.saveSettings({ fuelPricePerLiter: 1999.5 });
    await a.saveOrganization({ name: 'Mi Empresa SRL' });
    const before = await readAll(a);

    // "Recarga", "cierre del navegador" o "nuevo deploy" con otra versión de la app.
    const b = new LocalStorageRepository(storage, { now: clock, appVersion: '9.9.9' });
    const init = await b.init();
    assert.equal(init.status, 'loaded');
    assert.deepEqual(init.messages, []);
    assert.deepEqual(await readAll(b), before);

    assert.equal((await b.getQuote(quote.id)).pricing.knownRate, 123456.78);
    assert.equal(await b.getQuote(DEMO_IDS.quoteReference), null);
    assert.equal((await b.getResource('equipment', eq.id)).name, 'Grúa nueva');
    assert.equal((await b.getSettings()).fuelPricePerLiter, 1999.5);
    assert.equal((await b.getOrganization()).name, 'Mi Empresa SRL');
  });

  test('la clave de almacenamiento no depende de la versión de la app', async () => {
    const storage = new MemoryStorage();
    const { repo: a } = await setup({ storage, appVersion: '0.1.0' });
    const b = new LocalStorageRepository(storage, { appVersion: '2.0.0-beta' });
    assert.equal(a.key, STORAGE_KEYS.state);
    assert.equal(b.key, STORAGE_KEYS.state);
    assert.equal(STORAGE_KEYS.state, 'rateos.state');
    assert.deepEqual(Object.keys(dump(storage)), ['rateos.state']);
  });

  test('cargar datos existentes no escribe en el storage', async () => {
    const storage = new SpyStorage();
    await setup({ storage });
    const raw = storage.getItem(STORAGE_KEYS.state);
    const reloaded = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { init } = await setup({ storage: reloaded });
    assert.equal(init.status, 'loaded');
    assert.equal(reloaded.writes().length, 0);
    assert.equal(reloaded.getItem(STORAGE_KEYS.state), raw);
  });
});

// ================================================================== quotes

describe('LocalStorageRepository — cotizaciones (CRUD y metadatos)', () => {
  test('saveQuote crea con id UUID, organizationId, createdAt/updatedAt y createdBy/updatedBy', async () => {
    const { repo, storage, clock } = await setup();
    const t = clock.advance();
    const saved = await repo.saveQuote({ name: 'Nueva', client: 'ACME' });

    assert.ok(isUuid(saved.id), 'id debe ser UUID');
    assert.equal(saved.organizationId, DEMO_ORG_ID);
    assert.equal(saved.createdAt, t);
    assert.equal(saved.updatedAt, t);
    assert.ok('createdBy' in saved, 'createdBy presente');
    assert.ok('updatedBy' in saved, 'updatedBy presente');
    assert.equal(saved.name, 'Nueva');

    const persisted = persistedState(storage).quotes.find((q) => q.id === saved.id);
    assert.deepEqual(persisted, saved);
    assert.equal((await repo.getQuotes()).length, 3);
  });

  test('saveQuote con el mismo id actualiza, conserva createdAt y renueva updatedAt', async () => {
    const { repo, clock } = await setup();
    const t1 = clock.advance();
    const created = await repo.saveQuote({ name: 'Original' });
    const t2 = clock.advance(60_000);
    const updated = await repo.saveQuote({ ...created, name: 'Editada', createdAt: '1999-01-01T00:00:00.000Z' });

    assert.equal(updated.id, created.id);
    assert.equal(updated.name, 'Editada');
    assert.equal(updated.createdAt, t1, 'createdAt se conserva aunque el llamador envíe otro');
    assert.equal(updated.updatedAt, t2);
    assert.equal(updated.organizationId, DEMO_ORG_ID);
    const all = await repo.getQuotes();
    assert.equal(all.filter((q) => q.id === created.id).length, 1, 'no duplica');
  });

  test('saveQuote conserva el id de una cotización nueva que ya trae id', async () => {
    const { repo } = await setup();
    const id = '11111111-1111-4111-8111-111111111111';
    const saved = await repo.saveQuote({ id, name: 'Con id' });
    assert.equal(saved.id, id);
  });

  test('saveQuote sin nombre de texto usa "Cotización"', async () => {
    const { repo } = await setup();
    const saved = await repo.saveQuote({ name: 42 });
    assert.equal(saved.name, 'Cotización');
  });

  test('saveQuote rechaza valores que no son objetos', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    for (const bad of [null, undefined, [], 'texto', 5]) {
      await assert.rejects(repo.saveQuote(bad), { code: 'invalid' });
    }
    assert.deepEqual(dump(storage), before);
  });

  test('updateQuote aplica cambios parciales sin cambiar id ni createdAt', async () => {
    const { repo, clock } = await setup();
    const original = await repo.getQuote(DEMO_IDS.quoteHydroCrane);
    const t = clock.advance();
    const updated = await repo.updateQuote(DEMO_IDS.quoteHydroCrane, {
      status: 'sent',
      id: 'otro-id',
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    assert.equal(updated.id, DEMO_IDS.quoteHydroCrane);
    assert.equal(updated.status, 'sent');
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.updatedAt, t);
    assert.deepEqual(updated.labor, original.labor, 'los campos no tocados se conservan');
    assert.equal((await repo.getQuote(DEMO_IDS.quoteHydroCrane)).status, 'sent');
  });

  test('updateQuote de una cotización inexistente falla con not_found y no persiste nada', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    await assert.rejects(repo.updateQuote('no-existe', { name: 'x' }), { code: 'not_found' });
    assert.deepEqual(dump(storage), before);
  });

  test('deleteQuote borra y persiste; id inexistente devuelve false', async () => {
    const { repo, storage } = await setup();
    assert.equal(await repo.deleteQuote(DEMO_IDS.quoteHydroCrane), true);
    assert.equal(await repo.getQuote(DEMO_IDS.quoteHydroCrane), null);
    assert.equal(persistedState(storage).quotes.some((q) => q.id === DEMO_IDS.quoteHydroCrane), false);
    assert.equal(await repo.deleteQuote(DEMO_IDS.quoteHydroCrane), false);
    assert.equal((await repo.getQuotes()).length, 1);
  });

  test('getQuote de un id inexistente devuelve null', async () => {
    const { repo } = await setup();
    assert.equal(await repo.getQuote('no-existe'), null);
  });
});

// =============================================================== resources

describe('LocalStorageRepository — recursos de biblioteca', () => {
  for (const type of RESOURCE_TYPES) {
    test(`CRUD completo de "${type}" con metadatos`, async () => {
      const { repo, storage, clock } = await setup();
      const initialCount = (await repo.getResources(type)).length;

      const t1 = clock.advance();
      const created = await repo.saveResource(type, { name: `Nuevo ${type}`, value: 10 });
      assert.ok(isUuid(created.id));
      assert.equal(created.organizationId, DEMO_ORG_ID);
      assert.equal(created.createdAt, t1);
      assert.equal(created.updatedAt, t1);
      assert.ok('createdBy' in created && 'updatedBy' in created);
      assert.deepEqual(await repo.getResource(type, created.id), created);
      assert.equal((await repo.getResources(type)).length, initialCount + 1);

      const t2 = clock.advance();
      const replaced = await repo.saveResource(type, { ...created, value: 20 });
      assert.equal(replaced.value, 20);
      assert.equal(replaced.createdAt, t1);
      assert.equal(replaced.updatedAt, t2);
      assert.equal((await repo.getResources(type)).length, initialCount + 1, 'guardar con el mismo id reemplaza');

      const t3 = clock.advance();
      const patched = await repo.updateResource(type, created.id, { value: 30, id: 'otro' });
      assert.equal(patched.id, created.id);
      assert.equal(patched.value, 30);
      assert.equal(patched.name, `Nuevo ${type}`);
      assert.equal(patched.createdAt, t1);
      assert.equal(patched.updatedAt, t3);

      assert.deepEqual(persistedState(storage).resources[type].find((r) => r.id === created.id), patched);

      assert.equal(await repo.deleteResource(type, created.id), true);
      assert.equal(await repo.getResource(type, created.id), null);
      assert.equal(await repo.deleteResource(type, created.id), false);
      assert.equal((await repo.getResources(type)).length, initialCount);
    });
  }

  test('getResources() sin tipo devuelve todas las colecciones', async () => {
    const { repo } = await setup();
    const all = await repo.getResources();
    assert.deepEqual(Object.keys(all).sort(), [...RESOURCE_TYPES].sort());
    RESOURCE_TYPES.forEach((t) => assert.ok(Array.isArray(all[t])));
  });

  test('un tipo de recurso desconocido se rechaza en todas las operaciones sin tocar el storage', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    for (const type of ['clientes', '__proto__', 'constructor', 'toString', '', 'Equipment']) {
      await assert.rejects(repo.getResources(type), { code: 'unknown_type' }, `getResources(${type})`);
      await assert.rejects(repo.getResource(type, 'x'), { code: 'unknown_type' });
      await assert.rejects(repo.saveResource(type, { name: 'x' }), { code: 'unknown_type' });
      await assert.rejects(repo.updateResource(type, 'x', { name: 'x' }), { code: 'unknown_type' });
      await assert.rejects(repo.deleteResource(type, 'x'), { code: 'unknown_type' });
    }
    assert.deepEqual(dump(storage), before);
    assert.equal(Object.prototype.name, undefined, 'sin prototype pollution');
  });

  test('updateResource inexistente falla con not_found; saveResource rechaza no-objetos', async () => {
    const { repo } = await setup();
    await assert.rejects(repo.updateResource('equipment', 'no-existe', { name: 'x' }), { code: 'not_found' });
    await assert.rejects(repo.saveResource('equipment', null), { code: 'invalid' });
    await assert.rejects(repo.saveResource('equipment', ['x']), { code: 'invalid' });
  });
});

// ================================================================ services

describe('LocalStorageRepository — plantillas de servicio', () => {
  test('saveService crea/actualiza y deleteService borra', async () => {
    const { repo, storage, clock } = await setup();
    const initial = (await repo.getServices()).length;
    assert.equal(initial, 12);

    const t1 = clock.advance();
    const created = await repo.saveService({ name: 'Servicio propio', serviceType: 'crew', defaults: { unit: 'day' } });
    assert.ok(isUuid(created.id));
    assert.equal(created.organizationId, DEMO_ORG_ID);
    assert.equal(created.createdAt, t1);
    assert.ok('createdBy' in created && 'updatedBy' in created);

    const t2 = clock.advance();
    const updated = await repo.saveService({ ...created, name: 'Servicio propio v2' });
    assert.equal(updated.createdAt, t1);
    assert.equal(updated.updatedAt, t2);
    assert.equal((await repo.getServices()).length, initial + 1);
    assert.equal(persistedState(storage).services.find((s) => s.id === created.id).name, 'Servicio propio v2');

    assert.equal(await repo.deleteService(created.id), true);
    assert.equal(await repo.deleteService(created.id), false);
    assert.equal((await repo.getServices()).length, initial);
  });

  test('saveService sin nombre de texto usa "Servicio" y rechaza no-objetos', async () => {
    const { repo } = await setup();
    assert.equal((await repo.saveService({})).name, 'Servicio');
    await assert.rejects(repo.saveService(null), { code: 'invalid' });
  });
});

// ================================================== settings / organization

describe('LocalStorageRepository — configuración y organización', () => {
  test('saveSettings combina con la configuración existente y persiste', async () => {
    const { repo, storage } = await setup();
    const before = await repo.getSettings();
    const saved = await repo.saveSettings({ fuelPricePerLiter: 2100, matrixDays: [4, 8] });
    assert.equal(saved.fuelPricePerLiter, 2100);
    assert.deepEqual(saved.matrixDays, [4, 8]);
    assert.equal(saved.currency, before.currency, 'las claves no enviadas se conservan');
    assert.deepEqual(persistedState(storage).settings, saved);
    await assert.rejects(repo.saveSettings(null), { code: 'invalid' });
    await assert.rejects(repo.saveSettings([1]), { code: 'invalid' });
  });

  test('saveOrganization actualiza datos, no permite cambiar el id y conserva createdAt', async () => {
    const { repo, storage, clock } = await setup();
    const before = await repo.getOrganization();
    const t = clock.advance();
    const saved = await repo.saveOrganization({ name: 'Nueva Razón Social', id: 'otro-id', createdAt: '1990-01-01T00:00:00.000Z' });
    assert.equal(saved.id, DEMO_ORG_ID);
    assert.equal(saved.name, 'Nueva Razón Social');
    assert.equal(saved.baseLocation, before.baseLocation);
    assert.equal(saved.createdAt, before.createdAt);
    assert.equal(saved.updatedAt, t);
    assert.ok('createdBy' in saved && 'updatedBy' in saved);
    assert.equal('organizationId' in saved, false, 'la organización no se referencia a sí misma');
    assert.deepEqual(persistedState(storage).organization, saved);
    await assert.rejects(repo.saveOrganization(null), { code: 'invalid' });
    await assert.rejects(repo.saveOrganization('x'), { code: 'invalid' });
  });
});

// ======================================================= copias defensivas

describe('LocalStorageRepository — devuelve copias (aislamiento del estado)', () => {
  test('mutar los resultados de lectura no altera el estado', async () => {
    const { repo } = await setup();
    const snapshot = await readAll(repo);

    const quotes = await repo.getQuotes();
    quotes[0].name = 'MUTADO';
    quotes[0].pricing.knownRate = -1;
    quotes.push({ id: 'intruso' });
    const quote = await repo.getQuote(DEMO_IDS.quoteHydroCrane);
    quote.labor[0].basicMonthly = 0;
    const resources = await repo.getResources();
    resources.equipment.length = 0;
    const eq = await repo.getResource('equipment', DEMO_IDS.equipmentPickup);
    eq.name = 'MUTADO';
    const services = await repo.getServices();
    services[0].defaults = null;
    const settings = await repo.getSettings();
    settings.matrixDays.push(99);
    const org = await repo.getOrganization();
    org.name = 'MUTADO';

    assert.deepEqual(await readAll(repo), snapshot);
  });

  test('mutar el valor devuelto por una escritura no altera el estado', async () => {
    const { repo } = await setup();
    const saved = await repo.saveQuote({ name: 'Copia', pricing: { knownRate: 100 } });
    saved.pricing.knownRate = 999;
    saved.name = 'MUTADO';
    const updated = await repo.updateQuote(saved.id, { client: 'C' });
    updated.client = 'MUTADO';
    const settings = await repo.saveSettings({ matrixDays: [1, 2] });
    settings.matrixDays.push(3);

    const stored = await repo.getQuote(saved.id);
    assert.equal(stored.pricing.knownRate, 100);
    assert.equal(stored.name, 'Copia');
    assert.equal(stored.client, 'C');
    assert.deepEqual((await repo.getSettings()).matrixDays, [1, 2]);
  });

  // BUG detectado: mutate() guarda en this.state objetos anidados que siguen
  // siendo del llamador. Si la UI sigue editando el objeto después de
  // guardar, el estado en memoria cambia SIN persistirse (memoria ≠ storage).
  test('mutar el objeto de entrada después de guardarlo no altera el estado en memoria ni lo desincroniza del storage', async () => {
    const { repo, storage } = await setup();
    const input = { name: 'Entrada', pricing: { knownRate: 100 }, labor: [{ id: 'l1', basicMonthly: 1000 }] };
    const saved = await repo.saveQuote(input);
    input.pricing.knownRate = 999;
    input.labor[0].basicMonthly = 0;

    const patch = { pricing: { knownRate: 200 } };
    await repo.updateQuote(saved.id, patch);
    patch.pricing.knownRate = 777;

    const settingsPatch = { matrixDays: [3, 6] };
    await repo.saveSettings(settingsPatch);
    settingsPatch.matrixDays.push(9);

    const inMemory = await repo.getQuote(saved.id);
    assert.equal(inMemory.pricing.knownRate, 200);
    assert.equal(inMemory.labor[0].basicMonthly, 1000);
    assert.deepEqual((await repo.getSettings()).matrixDays, [3, 6]);
    assert.deepEqual(persistedState(storage).quotes.find((q) => q.id === saved.id), inMemory, 'memoria y storage coinciden');
  });
});

// ======================================================== transaccionalidad

describe('LocalStorageRepository — mutaciones transaccionales', () => {
  test('una mutación inválida (número no finito) no persiste nada ni cambia la memoria', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    const state = await readAll(repo);
    await assert.rejects(repo.saveQuote({ name: 'Mala', pricing: { knownRate: NaN } }), { code: 'validation_failed' });
    await assert.rejects(repo.updateQuote(DEMO_IDS.quoteHydroCrane, { contractMonths: Infinity }), { code: 'validation_failed' });
    await assert.rejects(repo.saveResource('equipment', { name: 'x', replacementValue: -Infinity }), { code: 'validation_failed' });
    await assert.rejects(repo.saveSettings({ fuelPricePerLiter: NaN }), { code: 'validation_failed' });
    assert.deepEqual(dump(storage), before);
    assert.deepEqual(await readAll(repo), state);
  });

  test('una clave "__proto__" en una entidad se rechaza (sin prototype pollution)', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    const evil = JSON.parse('{"name":"x","__proto__":{"polluted":true}}');
    await assert.rejects(repo.saveQuote(evil), { code: 'validation_failed' });
    const evilResource = JSON.parse('{"name":"x","nested":{"constructor":{"prototype":{"polluted":true}}}}');
    await assert.rejects(repo.saveResource('materials', evilResource), { code: 'validation_failed' });
    assert.equal({}.polluted, undefined);
    assert.deepEqual(dump(storage), before);
  });

  test('textos excesivamente largos se rechazan sin persistir', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    await assert.rejects(repo.saveQuote({ name: 'x', notes: 'a'.repeat(20001) }), { code: 'validation_failed' });
    assert.deepEqual(dump(storage), before);
  });
});

// ================================================================== cuota

describe('LocalStorageRepository — almacenamiento lleno (QuotaExceededError)', () => {
  test('una escritura sin espacio falla con quota_exceeded y el estado en memoria no cambia', async () => {
    const storage = new QuotaStorage();
    const { repo } = await setup({ storage });
    const before = dump(storage);
    const state = await readAll(repo);

    storage.failWhen = () => true;
    for (const [name, write] of ALL_WRITES(repo).slice(0, 10)) {
      await assert.rejects(write(), (error) => {
        assert.ok(error instanceof RepositoryError, name);
        assert.equal(error.code, 'quota_exceeded', name);
        assert.match(error.message, /lleno/);
        return true;
      });
    }
    assert.deepEqual(await readAll(repo), state, 'memoria intacta');
    assert.deepEqual(dump(storage), before, 'storage intacto');

    storage.failWhen = () => false;
    const saved = await repo.saveQuote({ name: 'Ahora sí' });
    assert.ok(await repo.getQuote(saved.id), 'al liberar espacio vuelve a guardar');
  });

  test('error de cuota con code 22 (navegadores viejos) también es quota_exceeded', async () => {
    const storage = new MemoryStorage();
    const { repo } = await setup({ storage });
    storage.setItem = () => {
      const error = new Error('quota');
      error.code = 22;
      throw error;
    };
    await assert.rejects(repo.saveQuote({ name: 'x' }), { code: 'quota_exceeded' });
  });

  test('otros errores de escritura se informan como write_failed', async () => {
    const storage = new MemoryStorage();
    const { repo } = await setup({ storage });
    const state = await readAll(repo);
    storage.setItem = () => {
      throw new Error('disco roto');
    };
    await assert.rejects(repo.saveQuote({ name: 'x' }), { code: 'write_failed' });
    assert.deepEqual(await readAll(repo), state);
  });
});

// ============================================================ nunca clear()

describe('LocalStorageRepository — nunca usa storage.clear()', () => {
  test('ciclo de vida completo sin llamar a clear()', async () => {
    const clock = createClock();
    const storage = new SpyStorage({ 'otra.app': 'dato ajeno', [STORAGE_KEYS.uiPrefs]: '{"sidebar":true}' });
    const { repo } = await setup({ storage, clock });
    await repo.saveQuote({ name: 'a' });
    await repo.deleteQuote(DEMO_IDS.quoteHydroCrane);
    await repo.saveResource('locations', { name: 'Rincón de los Sauces' });
    clock.advance();
    await repo.importBackup(await repo.exportBackup());
    for (let i = 0; i < MAX_RECOVERY_SNAPSHOTS + 2; i += 1) {
      clock.advance();
      await repo.resetToDemo();
    }
    // Datos dañados, legados y de versión nueva sobre el mismo storage.
    storage.setItem(STORAGE_KEYS.state, '{dañado');
    await new LocalStorageRepository(storage, { now: clock.advance }).init();
    storage.setItem(STORAGE_KEYS.state, JSON.stringify({ quotes: [{ name: 'vieja' }] }));
    await new LocalStorageRepository(storage, { now: clock.advance }).init();
    storage.setItem(STORAGE_KEYS.state, JSON.stringify({ schemaVersion: 999 }));
    await new LocalStorageRepository(storage, { now: clock.advance }).init();

    assert.equal(storage.calls.some(([op]) => op === 'clear'), false);
    assert.equal(storage.getItem('otra.app'), 'dato ajeno', 'no toca claves de otras apps');
    assert.equal(storage.getItem(STORAGE_KEYS.uiPrefs), '{"sidebar":true}');
    const removed = storage.calls.filter(([op]) => op === 'removeItem').map(([, k]) => k);
    assert.ok(removed.every((k) => k.startsWith(STORAGE_KEYS.recoveryPrefix)), 'sólo se eliminan copias de recuperación viejas');
  });

  test('ningún archivo de js/data llama a .clear()', () => {
    const dir = new URL('../../js/data/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const code = readFileSync(new URL(file, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.equal(/\.clear\s*\(/.test(code), false, `${file} no debe usar clear()`);
    }
  });
});

// ========================================================== datos dañados

describe('LocalStorageRepository — datos dañados', () => {
  const CORRUPT_INPUTS = [
    ['JSON truncado', '{"schemaVersion":1,"organization":{"id":"o"},"quotes":[{"id":"q","name":"Importante"'],
    ['texto plano', 'esto no es JSON'],
    ['null', 'null'],
    ['lista', '[1,2,3]'],
    ['número', '42'],
    ['string JSON', '"hola"'],
    ['schemaVersion de texto', '{"schemaVersion":"1","quotes":[]}'],
    ['schemaVersion negativo', '{"schemaVersion":-1}'],
    ['schemaVersion decimal', '{"schemaVersion":1.5}'],
  ];

  for (const [label, raw] of CORRUPT_INPUTS) {
    test(`${label}: status recovered, copia literal en rateos.recovery.* y carga la demo`, async () => {
      const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
      const { repo, init } = await setup({ storage });
      assert.equal(init.status, 'recovered');
      assert.equal(init.readOnly, false);

      const keys = recoveryKeys(storage);
      assert.equal(keys.length, 1);
      assert.ok(keys[0].startsWith('rateos.recovery.'));
      assert.match(keys[0], /\.corrupt$/);
      assert.equal(storage.getItem(keys[0]), raw, 'la copia es idéntica al texto original');
      assert.equal(repo.getRecoverySnapshot(keys[0]), raw);
      assert.ok(init.messages.some((m) => m.includes('Copias de recuperación')), 'el mensaje indica dónde quedó la copia');
      // Nunca la clave interna (en una cuenta incluye ids de usuario y empresa).
      assert.ok(init.messages.every((m) => !m.includes(keys[0])), 'el mensaje no muestra la clave interna');

      assert.deepEqual(persistedState(storage), createDemoState(CURRENT_SCHEMA_VERSION));
      assert.equal((await repo.getOrganization()).name, 'Patagonia Servicios SRL');
    });
  }

  // BUG detectado: si no hay espacio para la copia de recuperación, el
  // repositorio igual pisa la clave principal con la demo (el original se
  // pierde) y el mensaje afirma que "se conservó una copia".
  test('si no hay espacio para la copia, el texto original NO se pierde', async () => {
    const raw = '{"schemaVersion":1,"organization":{"id":"o"},"quotes":[{"id":"q","name":"Única copia"';
    const storage = new QuotaStorage({ [STORAGE_KEYS.state]: raw });
    storage.failWhen = (key) => key.startsWith(STORAGE_KEYS.recoveryPrefix);
    const repo = new LocalStorageRepository(storage, { now: createClock() });
    try {
      await repo.init();
    } catch {
      /* fallar al iniciar es aceptable; perder el original no */
    }
    const values = Object.values(dump(storage));
    assert.ok(values.includes(raw), 'el texto original debe seguir en algún lado del storage');
  });

  test('estructura actual inesperada pero reparable: status repaired, conserva datos y guarda copia literal', async () => {
    const original = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      organization: { id: 'org-x', name: 'X SRL' },
      resources: { equipment: [{ id: 'e1', name: 'Grúa' }] },
      services: [],
      quotes: [{ id: 'q1', name: 'Q importante', pricing: { knownRate: 5 } }],
      settings: 'roto',
    };
    const raw = JSON.stringify(original);
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo, init } = await setup({ storage });
    assert.equal(init.status, 'repaired');
    const keys = recoveryKeys(storage);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /\.invalid$/);
    assert.equal(storage.getItem(keys[0]), raw);
    assert.equal((await repo.getQuote('q1')).pricing.knownRate, 5);
    assert.equal((await repo.getResource('equipment', 'e1')).name, 'Grúa');
    assert.equal((await repo.getOrganization()).id, 'org-x');
    assert.equal(validateState(persistedState(storage)).ok, true);
  });
  test('datos v1 (versión anterior) con estructura inesperada: se migran y reparan, con el texto original en la copia de recuperación (status repaired)', async () => {
    const original = {
      schemaVersion: 1,
      organization: { id: 'org-x', name: 'X SRL' },
      resources: { equipment: [{ id: 'e1', name: 'Grúa' }] },
      services: [],
      quotes: [{ id: 'q1', name: 'Q importante', pricing: { knownRate: 5 } }, { code: 'sin id ni nombre' }],
      settings: 'roto',
    };
    const raw = JSON.stringify(original);
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo, init } = await setup({ storage });
    assert.equal(init.status, 'repaired');
    assert.equal(init.readOnly, false);
    const keys = recoveryKeys(storage);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /\.pre-migration-v1$/);
    assert.equal(storage.getItem(keys[0]), raw, 'la copia previa es el texto original');
    const q1 = await repo.getQuote('q1');
    assert.equal(q1.pricing.knownRate, 5);
    assert.deepEqual(q1.billingTaxes, { mode: 'combined', notApplicable: false, combinedPct: null, items: [] });
    assert.equal((await repo.getQuotes()).length, 2, 'la cotización sin id se conserva con un id nuevo');
    assert.equal((await repo.getResource('equipment', 'e1')).name, 'Grúa');
    const persisted = persistedState(storage);
    assert.equal(persisted.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(validateState(persisted).ok, true);
  });

  test('datos v1 válidos: se migran a v2 (status migrated) con copia previa y los mismos números', async () => {
    const v1 = createDemoState(CURRENT_SCHEMA_VERSION);
    v1.schemaVersion = 1;
    v1.quotes.forEach((q) => {
      delete q.billingTaxes;
      delete q.vatTreatment;
    });
    delete v1.settings.defaultBillingTaxes;
    const raw = JSON.stringify(v1);
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo, init } = await setup({ storage });
    assert.equal(init.status, 'migrated');
    const keys = recoveryKeys(storage);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /\.pre-migration-v1$/);
    assert.equal(storage.getItem(keys[0]), raw);
    assert.deepEqual(persistedState(storage), createDemoState(CURRENT_SCHEMA_VERSION));
    const quotes = await repo.getQuotes();
    quotes.forEach((q) => {
      assert.equal(q.billingTaxes.combinedPct, null);
      assert.equal(q.vatTreatment, 'excluded', 'la convención sin IVA queda explícita');
    });
  });
});

// ================================================== versión más nueva

describe('LocalStorageRepository — datos de una versión más nueva (sólo lectura)', () => {
  const future = {
    schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    organization: { id: 'org-futuro', name: 'Empresa del futuro' },
    resources: { agreements: [], laborProfiles: [], equipment: [], materials: [], locations: [] },
    services: [],
    quotes: [{ id: 'q-futuro', name: 'Cotización v2', nuevoCampo: { x: 1 } }],
    settings: { nuevaConfig: true },
    nuevaColeccion: [1, 2, 3],
  };
  const raw = JSON.stringify(future);

  test('abre en modo read_only sin modificar los datos', async () => {
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo, init } = await setup({ storage });
    assert.equal(init.status, 'read_only');
    assert.equal(init.readOnly, true);
    assert.ok(init.messages.some((m) => /más nueva/.test(m)));
    assert.equal(storage.getItem(STORAGE_KEYS.state), raw, 'getItem idéntico');
    assert.equal(storage.writes().length, 0, 'no escribe nada (ni copias)');
    assert.deepEqual(await repo.getQuotes(), future.quotes, 'se puede leer');
  });

  test('todas las escrituras fallan con read_only y el storage queda idéntico', async () => {
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo } = await setup({ storage });
    for (const [name, write] of ALL_WRITES(repo)) {
      await assert.rejects(write(), (error) => {
        assert.equal(error.code, 'read_only', name);
        return true;
      });
    }
    assert.equal(storage.getItem(STORAGE_KEYS.state), raw);
    assert.equal(storage.writes().length, 0);
    assert.deepEqual(Object.keys(dump(storage)), [STORAGE_KEYS.state]);
  });
});

// ============================================================ migración v0

describe('LocalStorageRepository — datos legados v0 (sin schemaVersion)', () => {
  const legacy = {
    organization: { id: 'org-legado', name: 'Legado SRL' },
    quotes: [
      { name: 'Cotización vieja', code: 'COT-0007', pricing: { knownRate: 1500000 }, labor: [{ role: 'Chofer' }] },
      { id: 'q-con-id', name: 'Otra', createdAt: '2020-05-05T00:00:00.000Z' },
    ],
    resources: { equipment: [{ id: 'eq-1', name: 'Grúa vieja', replacementValue: 1000 }] },
    services: [{ name: 'Plantilla vieja' }],
    settings: { fuelPricePerLiter: 900 },
    preferenciasViejas: { tema: 'oscuro' },
    version: '0.0.1',
  };
  const raw = JSON.stringify(legacy);

  test('status migrated, copia pre-migración literal y datos preservados', async () => {
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const clock = createClock();
    const { repo, init } = await setup({ storage, clock });
    assert.equal(init.status, 'migrated');
    assert.equal(init.readOnly, false);

    const keys = recoveryKeys(storage);
    assert.equal(keys.length, 1);
    assert.match(keys[0], /\.pre-migration-v0$/);
    assert.equal(storage.getItem(keys[0]), raw, 'copia pre-migración idéntica');

    const persisted = persistedState(storage);
    assert.equal(persisted.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(validateState(persisted).ok, true);

    const quotes = await repo.getQuotes();
    assert.equal(quotes.length, 2);
    const old = quotes.find((q) => q.code === 'COT-0007');
    assert.ok(isUuid(old.id), 'se asigna id faltante');
    assert.equal(old.organizationId, 'org-legado');
    assert.equal(old.createdAt, clock());
    assert.equal(old.updatedAt, clock());
    assert.equal(old.pricing.knownRate, 1500000);
    // v3: la línea conserva sus datos y recibe base SIN DEFINIR (nunca inventada); sin recurso de origen no hay snapshot.
    assert.deepEqual(old.labor, [{ role: 'Chofer', base: { period: null, currency: 'ARS', source: null, note: '' }, snapshot: null }]);
    const withId = quotes.find((q) => q.id === 'q-con-id');
    assert.equal(withId.createdAt, '2020-05-05T00:00:00.000Z', 'se conservan timestamps existentes');

    assert.equal((await repo.getResource('equipment', 'eq-1')).replacementValue, 1000);
    assert.equal((await repo.getServices())[0].name, 'Plantilla vieja');
    assert.equal((await repo.getSettings()).fuelPricePerLiter, 900);
    assert.deepEqual(persisted.legacy, { preferenciasViejas: { tema: 'oscuro' }, version: '0.0.1' }, 'claves desconocidas en legacy');
  });

  test('después de migrar, una recarga carga los datos sin volver a migrar', async () => {
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: raw });
    const { repo } = await setup({ storage });
    const before = await readAll(repo);
    const { repo: again, init } = await setup({ storage });
    assert.equal(init.status, 'loaded');
    assert.deepEqual(await readAll(again), before);
    assert.equal(recoveryKeys(storage).length, 1);
  });

  // BUG detectado: la migración no valida ni corrige ids duplicados y el
  // estado migrado se persiste igual; desde ese momento TODA escritura falla
  // con validation_failed (la app queda sin poder guardar).
  test('v0 con ids duplicados: se preservan ambas cotizaciones y se puede seguir guardando', async () => {
    const dup = JSON.stringify({
      organization: { id: 'o1', name: 'Vieja' },
      quotes: [
        { id: 'a', name: 'A' },
        { id: 'a', name: 'B' },
      ],
    });
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: dup });
    const { repo, init } = await setup({ storage });
    assert.equal(init.status, 'migrated');
    const quotes = await repo.getQuotes();
    assert.deepEqual(quotes.map((q) => q.name).sort(), ['A', 'B']);
    assert.equal(new Set(quotes.map((q) => q.id)).size, 2, 'ids únicos');
    const saved = await repo.saveQuote({ name: 'Nueva' });
    assert.ok(saved.id);
  });
});

// ============================================== poda de copias de recuperación

describe('LocalStorageRepository — copias de recuperación', () => {
  test(`conserva sólo las ${MAX_RECOVERY_SNAPSHOTS} copias más recientes y no toca otras claves`, async () => {
    assert.ok(Number.isInteger(MAX_RECOVERY_SNAPSHOTS) && MAX_RECOVERY_SNAPSHOTS >= 1);
    const clock = createClock();
    const storage = new SpyStorage({ 'otra.app': 'x', [STORAGE_KEYS.uiPrefs]: '{}' });
    const { repo } = await setup({ storage, clock });
    const created = [];
    for (let i = 0; i < MAX_RECOVERY_SNAPSHOTS + 3; i += 1) {
      clock.advance();
      await repo.saveQuote({ name: `v${i}` });
      created.push((await repo.resetToDemo()).recoveryKey);
    }
    const kept = repo.listRecoverySnapshots();
    assert.equal(kept.length, MAX_RECOVERY_SNAPSHOTS);
    assert.deepEqual(kept, created.slice(-MAX_RECOVERY_SNAPSHOTS).reverse(), 'las más nuevas primero');
    assert.deepEqual(recoveryKeys(storage).sort(), [...kept].sort());
    assert.equal(storage.getItem('otra.app'), 'x');
    assert.equal(storage.getItem(STORAGE_KEYS.uiPrefs), '{}');
  });

  test('las copias de datos dañados tienen su propio cupo: importaciones posteriores nunca las podan', async () => {
    const clock = createClock();
    const initial = {};
    for (let i = 0; i < MAX_RECOVERY_SNAPSHOTS; i += 1) {
      initial[`${STORAGE_KEYS.recoveryPrefix}2026-01-0${i + 1}T00-00-00-000Z.before-import`] = `{"n":${i}}`;
    }
    initial[STORAGE_KEYS.state] = '{roto';
    const storage = new SpyStorage(initial);
    const { repo } = await setup({ storage, clock });
    const kept = repo.listRecoverySnapshots();
    const corrupt = kept.filter((k) => /\.corrupt$/.test(k));
    assert.equal(corrupt.length, 1, 'la copia del texto dañado se conserva');
    assert.equal(storage.getItem(corrupt[0]), '{roto');
    assert.equal(kept.length - corrupt.length, MAX_RECOVERY_SNAPSHOTS, 'las demás copias respetan su propio límite');
    // Varias importaciones posteriores no eliminan la copia del texto dañado.
    const backup = await repo.exportBackup();
    for (let i = 0; i < MAX_RECOVERY_SNAPSHOTS + 2; i += 1) await repo.importBackup(backup);
    const after = repo.listRecoverySnapshots();
    assert.ok(after.includes(corrupt[0]), 'la copia del texto dañado sobrevive a importaciones posteriores');
    assert.equal(after.filter((k) => !/\.corrupt$/.test(k)).length, MAX_RECOVERY_SNAPSHOTS);
  });

  test('getRecoverySnapshot sólo lee claves de recuperación', async () => {
    const storage = new SpyStorage({ 'otra.app': 'secreto' });
    const { repo } = await setup({ storage });
    assert.equal(repo.getRecoverySnapshot(STORAGE_KEYS.state), null);
    assert.equal(repo.getRecoverySnapshot('otra.app'), null);
    assert.equal(repo.getRecoverySnapshot(null), null);
    assert.equal(repo.getRecoverySnapshot(`${STORAGE_KEYS.recoveryPrefix}inexistente`), null);
  });
});

// ================================================= fábrica de repositorio

describe('createRepository / getBrowserStorage', () => {
  test('modo local con storage disponible → persistente', async () => {
    const storage = new MemoryStorage();
    const { repository, persistent } = createRepository({ storage, appVersion: '1.2.3' });
    assert.ok(repository instanceof LocalStorageRepository);
    assert.equal(persistent, true);
    assert.equal(repository.appVersion, '1.2.3');
    await repository.init();
    assert.ok(storage.getItem(STORAGE_KEYS.state));
  });

  test('sin storage del navegador → funciona en memoria y avisa que no persiste', async () => {
    const { repository, persistent } = createRepository({ storage: null });
    assert.equal(persistent, false);
    const init = await repository.init();
    assert.equal(init.status, 'seeded');
    assert.equal((await repository.getQuotes()).length, 2);
  });

  test('modo de almacenamiento no soportado → error explícito', () => {
    assert.throws(() => createRepository({ mode: 'supabase' }), { name: 'RepositoryError', code: 'unsupported_mode' });
  });

  test('getBrowserStorage nunca lanza y devuelve null si localStorage no sirve', () => {
    assert.equal(getBrowserStorage({}), null);
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
    assert.equal(getBrowserStorage(throwingGetter), null);
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    assert.equal(getBrowserStorage({ localStorage: full }), null);
  });

  test('getBrowserStorage devuelve el storage y no deja la clave de prueba', () => {
    const storage = new MemoryStorage();
    assert.equal(getBrowserStorage({ localStorage: storage }), storage);
    assert.equal(storage.length, 0);
  });
});

describe('LocalStorageRepository — confirmar antes de actualizar el formato (staging, PLAN-2026-005)', () => {
  const v2Raw = () => JSON.stringify({ ...createDemoState(2), schemaVersion: 2 });
  const keysOf = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i));

  test('si NO se acepta, abre en sólo lectura y no escribe nada', async () => {
    const raw = v2Raw();
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.state, raw);
    const asked = [];
    const repo = new LocalStorageRepository(storage, { confirmSchemaUpgrade: async (from, to) => { asked.push([from, to]); return false; } });
    const init = await repo.init();
    assert.deepEqual(asked, [[2, CURRENT_SCHEMA_VERSION]]);
    assert.equal(init.status, 'read_only');
    assert.equal(repo.readOnly, true);
    assert.equal(storage.getItem(STORAGE_KEYS.state), raw, 'los datos quedan exactamente como estaban');
    assert.equal(keysOf(storage).filter((k) => k.startsWith(STORAGE_KEYS.recoveryPrefix)).length, 0, 'tampoco crea copias');
    assert.ok((await repo.getQuotes()).length > 0, 'se pueden ver');
  });

  test('si se acepta (o no hay que preguntar), migra como siempre; un error al preguntar = no', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.state, v2Raw());
    const repo = new LocalStorageRepository(storage, { confirmSchemaUpgrade: async () => true });
    assert.equal((await repo.init()).status, 'migrated');
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).schemaVersion, CURRENT_SCHEMA_VERSION);

    const other = new MemoryStorage();
    other.setItem(STORAGE_KEYS.state, v2Raw());
    const failing = new LocalStorageRepository(other, { confirmSchemaUpgrade: async () => { throw new Error('x'); } });
    assert.equal((await failing.init()).status, 'read_only');
  });

  test('el aviso de migración dice dónde está la copia previa, nunca su clave interna', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEYS.state, v2Raw());
    const repo = new LocalStorageRepository(storage);
    const init = await repo.init();
    const key = keysOf(storage).find((k) => k.startsWith(STORAGE_KEYS.recoveryPrefix));
    assert.ok(key);
    assert.ok(init.messages.some((m) => m.includes('Copias de recuperación')));
    assert.ok(init.messages.every((m) => !m.includes(key)));
  });
});
