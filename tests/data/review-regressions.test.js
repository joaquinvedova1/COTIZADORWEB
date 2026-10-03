/**
 * Regresiones de la revisión multidisciplinaria (seguridad + persistencia).
 * Cada test documenta un bug real encontrado y corregido: no debe volver.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEYS, SCHEMA_VERSION } from '../../js/config.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { createRepository } from '../../js/data/repository-factory.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { createAppContext } from '../../js/services/app-context.js';
import { createQuoteService } from '../../js/services/quote-service.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { sanitizeEventProps } from '../../js/core/events.js';

const quotaError = () => Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });

async function repoOn(storage) {
  const repo = new LocalStorageRepository(storage);
  await repo.init();
  return repo;
}

function demoBackup() {
  const s = createDemoState(SCHEMA_VERSION);
  return { ...s, app: { name: 'RATEOS', version: 'test' }, exportedAt: '2026-10-03T00:00:00.000Z' };
}

describe('Dos pestañas sobre el mismo almacenamiento (DATA-01)', () => {
  test('una pestaña no borra la cotización creada en la otra', async () => {
    const storage = new MemoryStorage();
    const ctxA = await createAppContext({ storage });
    const ctxB = await createAppContext({ storage });
    const created = await ctxA.quotes.createQuote();
    // B cambia otra cotización con su copia en memoria (antes del fix pisaba todo).
    const [demo] = await ctxB.repository.getQuotes();
    await ctxB.repository.saveQuote({ ...demo, status: 'sent' });
    const ids = JSON.parse(storage.getItem(STORAGE_KEYS.state)).quotes.map((q) => q.id);
    assert.ok(ids.includes(created.id), 'la cotización creada en A sigue guardada');
    const stored = JSON.parse(storage.getItem(STORAGE_KEYS.state)).quotes.find((q) => q.id === demo.id);
    assert.equal(stored.status, 'sent');
  });

  test('los códigos COT no se repiten entre pestañas', async () => {
    const storage = new MemoryStorage();
    const ctxA = await createAppContext({ storage });
    const ctxB = await createAppContext({ storage });
    const a = await ctxA.quotes.createQuote();
    const b = await ctxB.quotes.createQuote();
    assert.notEqual(a.code, b.code);
  });

  test('si otra pestaña con una versión más nueva migró los datos, esta pasa a sólo lectura', async () => {
    const storage = new MemoryStorage();
    const repo = await repoOn(storage);
    const newer = { ...JSON.parse(storage.getItem(STORAGE_KEYS.state)), schemaVersion: SCHEMA_VERSION + 1 };
    storage.setItem(STORAGE_KEYS.state, JSON.stringify(newer));
    await repo.getQuotes();
    assert.equal(repo.readOnly, true);
    await assert.rejects(() => repo.saveSettings({ x: 1 }), (e) => e.code === 'read_only');
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).schemaVersion, SCHEMA_VERSION + 1, 'no se pisan los datos nuevos');
  });

  test('si otra pestaña dejó texto ilegible, se avisa y no se sobrescribe', async () => {
    const storage = new MemoryStorage();
    const repo = await repoOn(storage);
    storage.setItem(STORAGE_KEYS.state, '{roto');
    await assert.rejects(() => repo.saveSettings({ x: 1 }), (e) => e.code === 'stale_state');
    assert.equal(storage.getItem(STORAGE_KEYS.state), '{roto');
  });
});

describe('Importación: validar antes de importar (SEC-01, SEC-02, DATA-04)', () => {
  const malformedQuotes = {
    'labor [null]': (q) => { q.labor = [null]; },
    'labor texto': (q) => { q.labor = 'x'; },
    'equipment [null]': (q) => { q.equipment = [null]; },
    'materials [null]': (q) => { q.materials = [null]; },
    'otherCosts [null]': (q) => { q.otherCosts = [null]; },
    'logistics.vehicles [null]': (q) => { q.logistics.vehicles = [null]; },
    'rules.volumeTiers texto': (q) => { q.rules.volumeTiers = 'x'; },
    'pricing como lista': (q) => { q.pricing = [1]; },
  };
  for (const [name, mutate] of Object.entries(malformedQuotes)) {
    test(`rechaza una cotización con ${name} y no modifica datos`, async () => {
      const storage = new MemoryStorage();
      const repo = await repoOn(storage);
      const before = storage.getItem(STORAGE_KEYS.state);
      const backup = demoBackup();
      mutate(backup.quotes[0]);
      const prepared = repo.prepareImport(backup);
      assert.equal(prepared.ok, false);
      await assert.rejects(() => repo.importBackup(backup), (e) => e.code === 'invalid_backup');
      assert.equal(storage.getItem(STORAGE_KEYS.state), before);
    });
  }

  const wrongTypes = {
    'quotes como mapa': (b) => { b.quotes = { a: b.quotes[0] }; },
    'resources como lista': (b) => { b.resources = []; },
    'services como texto': (b) => { b.services = 'x'; },
    'resources.equipment como objeto': (b) => { b.resources.equipment = { a: 1 }; },
    'settings como lista': (b) => { b.settings = [1]; },
  };
  for (const [name, mutate] of Object.entries(wrongTypes)) {
    test(`rechaza (no vacía en silencio) un backup v1 con ${name}`, async () => {
      const repo = await repoOn(new MemoryStorage());
      const backup = demoBackup();
      mutate(backup);
      assert.equal(repo.prepareImport(backup).ok, false);
    });
  }

  test('rechaza un JSON que no es de RATEOS (package.json, {}) en lugar de vaciar todo', async () => {
    const repo = await repoOn(new MemoryStorage());
    assert.equal(repo.prepareImport({}).ok, false);
    assert.equal(repo.prepareImport({ name: 'rateos', version: '0.1.0', scripts: { test: 'node --test' } }).ok, false);
    assert.equal(repo.prepareImport({ version: '0.1.0', commit: 'dev', buildDate: null }).ok, false);
  });

  test('sigue aceptando un backup legado (sin schemaVersion) con organización y cotizaciones', async () => {
    const repo = await repoOn(new MemoryStorage());
    const prepared = repo.prepareImport({ organization: { id: 'org-1', name: 'Vieja' }, quotes: [{ id: 'q1', name: 'Q' }] });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.summary.quotes, 1);
  });
});

describe('Copias de recuperación y cuota (DATA-05, DATA-06, DATA-02)', () => {
  test('si la importación falla por cuota no queda una copia huérfana ocupando espacio', async () => {
    class FullOnState extends MemoryStorage {
      constructor() {
        super();
        this.full = false;
      }
      setItem(key, value) {
        if (this.full && key === STORAGE_KEYS.state) throw quotaError();
        super.setItem(key, value);
      }
    }
    const storage = new FullOnState();
    const repo = await repoOn(storage);
    const before = storage.getItem(STORAGE_KEYS.state);
    storage.full = true;
    await assert.rejects(() => repo.importBackup(demoBackup()), (e) => e.code === 'quota_exceeded');
    assert.deepEqual(repo.listRecoverySnapshots(), []);
    assert.equal(storage.getItem(STORAGE_KEYS.state), before);
  });

  test('deleteRecoverySnapshot sólo elimina claves de recuperación', async () => {
    const storage = new MemoryStorage({ 'otra.app': 'x' });
    const repo = await repoOn(storage);
    await repo.resetToDemo();
    const [key] = repo.listRecoverySnapshots();
    assert.equal(repo.deleteRecoverySnapshot(STORAGE_KEYS.state), false);
    assert.equal(repo.deleteRecoverySnapshot('otra.app'), false);
    assert.equal(repo.deleteRecoverySnapshot(key), true);
    assert.equal(storage.getItem(key), null);
    assert.equal(storage.getItem('otra.app'), 'x');
    assert.notEqual(storage.getItem(STORAGE_KEYS.state), null);
  });

  test('datos dañados sin espacio para la copia: init falla con corrupt_no_space y no toca el original', async () => {
    class NoRecoverySpace extends MemoryStorage {
      setItem(key, value) {
        if (key.startsWith(STORAGE_KEYS.recoveryPrefix)) throw quotaError();
        super.setItem(key, value);
      }
    }
    const storage = new NoRecoverySpace({ [STORAGE_KEYS.state]: '{roto' });
    const repo = new LocalStorageRepository(storage);
    await assert.rejects(() => repo.init(), (e) => e.code === 'corrupt_no_space');
    assert.equal(storage.getItem(STORAGE_KEYS.state), '{roto');
  });

  test('almacenamiento lleno con datos guardados: no se abre la demo en memoria', () => {
    const state = JSON.stringify(createDemoState(SCHEMA_VERSION));
    const fullStorage = {
      length: 1,
      key: () => STORAGE_KEYS.state,
      getItem: (k) => (k === STORAGE_KEYS.state ? state : null),
      setItem: () => { throw quotaError(); },
      removeItem: () => {},
    };
    assert.throws(() => createRepository({ globalObject: { localStorage: fullStorage } }), (e) => e.code === 'quota_exceeded');
  });

  test('almacenamiento bloqueado sin datos previos: modo memoria no persistente', () => {
    const blocked = { getItem: () => null, setItem: () => { throw quotaError(); }, removeItem: () => {}, key: () => null, length: 0 };
    const { persistent } = createRepository({ globalObject: { localStorage: blocked } });
    assert.equal(persistent, false);
  });
});

describe('Resiliencia ante cotizaciones malformadas (SEC-01)', () => {
  test('los motores no fallan con líneas null y no inventan costos', () => {
    const [demo] = createDemoState(SCHEMA_VERSION).quotes;
    const q = { ...demo, labor: [null, ...demo.labor], equipment: [null], materials: [5], otherCosts: ['x'], logistics: { ...demo.logistics, vehicles: [null] }, rules: { ...demo.rules, volumeTiers: [null] } };
    const r = computeQuote(q);
    assert.ok(Number.isFinite(r.kpis.totalCost));
    assert.equal(r.model.labor.lines.length, demo.labor.length + 1, 'se conserva la alineación de índices');
    assert.equal(r.model.labor.lines[0].fixedMonthly, 0);
  });

  test('una cotización que no se puede calcular no rompe el listado ni el dashboard', async () => {
    const [good] = createDemoState(SCHEMA_VERSION).quotes;
    const bad = { id: 'bad', name: 'Mala', status: 'draft', get activity() { throw new Error('boom'); } };
    const repository = {
      getQuotes: async () => [good, bad],
      getSettings: async () => ({}),
    };
    const service = createQuoteService({ repository });
    const stats = await service.dashboardStats();
    assert.equal(stats.totalCount, 2);
    const broken = stats.items.find((i) => i.quote.id === 'bad');
    assert.equal(broken.summary.error, true);
    assert.equal(broken.summary.atRisk, true);
  });
});

describe('Eventos internos sin datos sensibles (SEC-05)', () => {
  test('montos o identificadores con dígitos disfrazados de enum se descartan', () => {
    assert.deepEqual(sanitizeEventProps({ serviceType: '85000000' }), {});
    assert.deepEqual(sanitizeEventProps({ variable: 'monthly_labor_cost_85000000' }), {});
    assert.deepEqual(sanitizeEventProps({ serviceType: 'on_call', step: 'labor' }), { serviceType: 'on_call', step: 'labor' });
  });
});
