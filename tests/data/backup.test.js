/**
 * Tests de backup / importación (Prompt 2 "Backup", Prompt 4 §10).
 *
 * - Formato limpio y versionado: { schemaVersion, app, exportedAt,
 *   organization, resources, services, quotes, settings }.
 * - Validar ANTES de importar (sin modificar datos).
 * - Antes de sobrescribir se guarda una copia de recuperación.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { CURRENT_SCHEMA_VERSION, RESOURCE_TYPES } from '../../js/data/schema.js';
import { createBackupService } from '../../js/services/backup-service.js';
import { STORAGE_KEYS, MAX_BACKUP_BYTES, APP_NAME } from '../../js/config.js';
import { createDemoState, DEMO_IDS } from '../../js/domain/demo-data.js';
import { configureLogger } from '../../js/core/logger.js';
import { addEventSink } from '../../js/core/events.js';

configureLogger({ consoleImpl: null });

// ------------------------------------------------------------------ helpers

function createClock(startMs = Date.UTC(2026, 9, 3, 10, 0, 0)) {
  let t = startMs;
  const now = () => new Date(t).toISOString();
  now.advance = (ms = 1000) => {
    t += ms;
    return now();
  };
  return now;
}

class SpyStorage extends MemoryStorage {
  constructor(initial) {
    super(initial);
    this.failWhen = () => false;
    this.clearCalls = 0;
  }

  setItem(key, value) {
    if (this.failWhen(key)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    super.setItem(key, value);
  }

  clear() {
    this.clearCalls += 1;
    throw new Error('storage.clear() está prohibido');
  }
}

function dump(storage) {
  const out = {};
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    out[k] = storage.getItem(k);
  }
  return out;
}

async function setup({ storage = new SpyStorage(), clock = createClock(), appVersion = '0.1.0' } = {}) {
  const repo = new LocalStorageRepository(storage, { now: clock, appVersion });
  await repo.init();
  const backup = createBackupService({ repository: repo, clock });
  return { repo, storage, clock, backup };
}

async function readAll(repo) {
  return {
    organization: await repo.getOrganization(),
    resources: await repo.getResources(),
    services: await repo.getServices(),
    quotes: await repo.getQuotes(),
    settings: await repo.getSettings(),
  };
}

/** Backup válido (texto) de la demo, con modificaciones opcionales. */
async function demoBackupText(mutate = (d) => d) {
  const { repo } = await setup();
  const data = await repo.exportBackup();
  return JSON.stringify(mutate(data));
}

// ================================================================== export

describe('Backup — exportación', () => {
  test('formato { schemaVersion, app, exportedAt, organization, resources, services, quotes, settings }', async () => {
    const { repo, clock } = await setup({ appVersion: '1.4.2' });
    const data = await repo.exportBackup();
    assert.deepEqual(Object.keys(data), ['schemaVersion', 'app', 'exportedAt', 'organization', 'resources', 'services', 'quotes', 'settings']);
    assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(data.app, { name: APP_NAME, version: '1.4.2' });
    assert.equal(data.exportedAt, clock());
    assert.deepEqual(Object.keys(data.resources).sort(), [...RESOURCE_TYPES].sort());
    assert.ok(Array.isArray(data.services) && Array.isArray(data.quotes));
    assert.equal(typeof data.settings, 'object');

    const demo = createDemoState(CURRENT_SCHEMA_VERSION);
    assert.deepEqual(data.organization, demo.organization);
    assert.deepEqual(data.quotes, demo.quotes);
  });

  test('es JSON puro (sobrevive serialización sin cambios)', async () => {
    const { repo } = await setup();
    const data = await repo.exportBackup();
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
  });

  test('incluye legacy sólo cuando existe (datos migrados)', async () => {
    const storage = new SpyStorage({ [STORAGE_KEYS.state]: JSON.stringify({ quotes: [], viejo: 1 }) });
    const { repo } = await setup({ storage });
    const data = await repo.exportBackup();
    assert.deepEqual(data.legacy, { viejo: 1 });
    const { repo: clean } = await setup();
    assert.equal('legacy' in (await clean.exportBackup()), false);
  });

  test('devuelve una copia: mutarla no altera los datos', async () => {
    const { repo } = await setup();
    const before = await readAll(repo);
    const data = await repo.exportBackup();
    data.quotes.length = 0;
    data.organization.name = 'MUTADO';
    data.settings.fuelPricePerLiter = -1;
    assert.deepEqual(await readAll(repo), before);
  });

  test('backupService.exportBackup devuelve { filename, json, data } listos para descargar', async () => {
    const { backup } = await setup();
    const out = await backup.exportBackup();
    assert.match(out.filename, /^rateos-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);
    assert.equal(out.filename, 'rateos-backup-2026-10-03-10-00-00.json');
    assert.deepEqual(JSON.parse(out.json), out.data);
    assert.equal(out.data.schemaVersion, CURRENT_SCHEMA_VERSION);
  });

  test('el evento backup_exported sólo lleva un contador (sin datos sensibles)', async () => {
    const events = [];
    const remove = addEventSink((e) => events.push(e), { force: true });
    try {
      const { backup } = await setup();
      await backup.exportBackup();
    } finally {
      remove();
    }
    const ev = events.find((e) => e.name === 'backup_exported');
    assert.ok(ev);
    assert.deepEqual(ev.props, { count: 2 });
  });
});

// ======================================================= export → import

describe('Backup — ida y vuelta', () => {
  test('export → import en otro storage reproduce el mismo estado', async () => {
    const clock = createClock();
    const { repo: a, backup: backupA } = await setup({ clock });
    await a.saveQuote({ name: 'Cotización real', client: 'Operadora', pricing: { knownRate: 3456789.12 } });
    await a.updateQuote(DEMO_IDS.quoteHydroCrane, { status: 'sent' });
    await a.deleteQuote(DEMO_IDS.quoteReference);
    await a.saveResource('materials', { description: 'Gasoil premium', unitCost: 1700.55 });
    await a.saveService({ name: 'Servicio propio' });
    await a.saveSettings({ fuelPricePerLiter: 1750 });
    await a.saveOrganization({ name: 'Empresa Real SRL' });
    const expected = await readAll(a);
    const { json } = await backupA.exportBackup();

    const storageB = new SpyStorage();
    const { repo: b, backup: backupB } = await setup({ storage: storageB, clock });
    const parsed = backupB.parseBackupText(json);
    assert.equal(parsed.ok, true, parsed.errors.join(' '));
    await backupB.applyBackup(parsed.data);
    assert.deepEqual(await readAll(b), expected);

    // Persistido: una recarga sobre el storage B ve lo mismo.
    const reloaded = new LocalStorageRepository(storageB);
    assert.equal((await reloaded.init()).status, 'loaded');
    assert.deepEqual(await readAll(reloaded), expected);
  });
});

// ============================================== validación previa (no muta)

describe('Backup — validación antes de importar', () => {
  test('parseBackupText acepta un backup válido y devuelve un resumen', async () => {
    const { backup } = await setup();
    const text = await demoBackupText();
    const result = backup.parseBackupText(text);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.fromVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.summary, {
      organization: 'Patagonia Servicios SRL',
      quotes: 2,
      services: 12,
      resources: { agreements: 6, laborProfiles: 5, equipment: 10, materials: 4, locations: 2, equipmentModels: 0, externalServices: 3 },
      exportedAt: '2026-10-03T10:00:00.000Z',
      appVersion: '0.1.0',
    });
    assert.deepEqual(result.data, JSON.parse(text));
  });

  test('prepareImport y parseBackupText NO modifican datos (válidos o inválidos)', async () => {
    const { repo, storage, backup } = await setup();
    await repo.saveQuote({ name: 'Mía' });
    const before = dump(storage);
    const state = await readAll(repo);

    const valid = await demoBackupText((d) => ({ ...d, quotes: [] }));
    backup.parseBackupText(valid);
    backup.parseBackupText('{roto');
    backup.parseBackupText(await demoBackupText((d) => ({ ...d, schemaVersion: 99 })));
    repo.prepareImport(JSON.parse(valid));
    repo.prepareImport({ quotes: [{ name: 'v0' }] });

    assert.deepEqual(dump(storage), before, 'storage intacto');
    assert.deepEqual(await readAll(repo), state, 'estado intacto');
    assert.equal(repo.listRecoverySnapshots().length, 0, 'no crea copias');
  });

  test('prepareImport no modifica el objeto recibido', async () => {
    const { repo } = await setup();
    const data = JSON.parse(await demoBackupText());
    const before = JSON.stringify(data);
    repo.prepareImport(data);
    repo.prepareImport({ quotes: [{ name: 'v0' }] });
    assert.equal(JSON.stringify(data), before);
  });

  const REJECTIONS = [
    ['texto vacío', async () => '', /vacío/],
    ['sólo espacios', async () => '   \n ', /vacío/],
    ['JSON inválido', async () => '{"schemaVersion":1,', /JSON válido/],
    ['lista JSON', async () => '[]', /objeto JSON/],
    ['null JSON', async () => 'null', /objeto JSON/],
    ['número JSON', async () => '42', /objeto JSON/],
    ['demasiado grande', async () => 'x'.repeat(MAX_BACKUP_BYTES + 1), /tamaño máximo/],
    ['schemaVersion futuro', async () => demoBackupText((d) => ({ ...d, schemaVersion: CURRENT_SCHEMA_VERSION + 1 })), /más nueva/],
    ['schemaVersion inválido', async () => demoBackupText((d) => ({ ...d, schemaVersion: 'uno' })), /no reconocido|interpretar/],
    [
      'ids duplicados en cotizaciones',
      async () => demoBackupText((d) => ({ ...d, quotes: [...d.quotes, { ...d.quotes[0] }] })),
      /id duplicado/,
    ],
    [
      'ids duplicados en recursos',
      async () => demoBackupText((d) => ({ ...d, resources: { ...d.resources, equipment: [d.resources.equipment[0], d.resources.equipment[0]] } })),
      /id duplicado/,
    ],
    [
      '__proto__ dentro de una cotización',
      async () => (await demoBackupText()).replace('"code":"COT-0001"', '"__proto__":{"polluted":true},"code":"COT-0001"'),
      /clave no permitida "__proto__"/,
    ],
    [
      '__proto__ en la raíz',
      async () => (await demoBackupText()).replace(/^\{/, '{"__proto__":{"polluted":true},'),
      /clave no permitida "__proto__"/,
    ],
    [
      'constructor.prototype anidado',
      async () => (await demoBackupText()).replace('"code":"COT-0002"', '"constructor":{"prototype":{"polluted":true}},"code":"COT-0002"'),
      /clave no permitida "constructor"/,
    ],
    ['número no finito (1e999)', async () => (await demoBackupText()).replace('"knownRate":4000000', '"knownRate":1e999'), /número inválido/],
    ['número no finito (-1e999)', async () => (await demoBackupText()).replace('"contractMonths":12', '"contractMonths":-1e999'), /número inválido/],
    ['organización sin id', async () => demoBackupText((d) => ({ ...d, organization: { name: 'x' } })), /organization/],
    ['cotización sin nombre', async () => demoBackupText((d) => ({ ...d, quotes: [{ id: 'q' }] })), /falta "name"/],
  ];

  for (const [label, makeText, pattern] of REJECTIONS) {
    test(`rechaza: ${label}`, async () => {
      const { repo, storage, backup } = await setup();
      const before = dump(storage);
      const result = backup.parseBackupText(await makeText());
      assert.equal(result.ok, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some((e) => pattern.test(e)), `errores: ${result.errors.join(' | ')}`);
      assert.equal('state' in result && result.state !== undefined, false, 'no entrega un estado importable');
      assert.deepEqual(dump(storage), before);
      assert.equal({}.polluted, undefined, 'sin prototype pollution');
      assert.equal(repo.listRecoverySnapshots().length, 0);
    });
  }

  test('rechaza valores que no son texto', async () => {
    const { backup } = await setup();
    for (const bad of [null, undefined, 42, {}]) {
      const result = backup.parseBackupText(bad);
      assert.equal(result.ok, false);
    }
  });

  test('prepareImport rechaza objetos con NaN/Infinity (no sólo texto JSON)', async () => {
    const { repo } = await setup();
    const data = JSON.parse(await demoBackupText());
    data.settings.fuelPricePerLiter = NaN;
    assert.equal(repo.prepareImport(data).ok, false);
    data.settings.fuelPricePerLiter = Infinity;
    assert.equal(repo.prepareImport(data).ok, false);
  });

  test('un backup legado (sin schemaVersion) se valida y migra sin aplicarse', async () => {
    const { repo, storage, backup } = await setup();
    const before = dump(storage);
    const result = backup.parseBackupText(JSON.stringify({ organization: { id: 'o', name: 'Vieja SRL' }, quotes: [{ name: 'Q vieja' }] }));
    assert.equal(result.ok, true);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.summary.organization, 'Vieja SRL');
    assert.equal(result.summary.quotes, 1);
    assert.equal(result.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(dump(storage), before);
    assert.equal((await repo.getQuotes()).length, 2);
  });

  test('un backup v1 (versión anterior de RATEOS) se valida, migra a v2 y se importa sin perder datos (PLAN-2026-002)', async () => {
    const { repo, storage, backup } = await setup();
    const v1 = JSON.parse(await demoBackupText());
    v1.schemaVersion = 1;
    v1.quotes.forEach((q) => {
      delete q.billingTaxes;
      delete q.vatTreatment;
    });
    delete v1.settings.defaultBillingTaxes;
    v1.quotes[0].name = 'Cotización guardada con la versión anterior';
    const before = dump(storage);
    const result = backup.parseBackupText(JSON.stringify(v1));
    assert.equal(result.ok, true);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(dump(storage), before, 'validar no cambia nada');
    await backup.applyBackup(result.data);
    const quotes = await repo.getQuotes();
    assert.equal(quotes.length, v1.quotes.length);
    const q = quotes.find((x) => x.id === v1.quotes[0].id);
    assert.equal(q.name, 'Cotización guardada con la versión anterior');
    assert.deepEqual(q.billingTaxes, { mode: 'combined', notApplicable: false, combinedPct: null, items: [] }, 'impuestos sin definir: nunca inventados');
    assert.equal(q.vatTreatment, 'excluded', 'la convención sin IVA queda explícita');
    const strip = ({ billingTaxes, vatTreatment, ...rest }) => rest;
    assert.deepEqual(strip(q), v1.quotes[0], 'el resto de la cotización queda igual');
    assert.equal((await repo.getSettings()).defaultBillingTaxes, null);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEYS.state)).schemaVersion, CURRENT_SCHEMA_VERSION);
  });

  test('un backup v2 con impuestos sobre la facturación hace ida y vuelta exacta', async () => {
    const { repo, backup } = await setup();
    const [first] = await repo.getQuotes();
    await repo.saveQuote({ ...first, billingTaxes: { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'gross_income', label: 'Ingresos Brutos', pct: 3 }] } });
    await repo.saveSettings({ defaultBillingTaxes: { mode: 'combined', notApplicable: false, combinedPct: 4.5, items: [] } });
    const text = JSON.stringify(await repo.exportBackup());
    const { repo: repoB, backup: backupB } = await setup();
    const parsed = backupB.parseBackupText(text);
    assert.equal(parsed.ok, true);
    await backupB.applyBackup(parsed.data);
    const q = (await repoB.getQuotes()).find((x) => x.id === first.id);
    assert.equal(q.billingTaxes.items[0].pct, 3);
    assert.equal((await repoB.getSettings()).defaultBillingTaxes.combinedPct, 4.5);
    assert.ok(backup);
  });

  test('un backup legado con "__proto__" en la raíz no contamina prototipos ni conserva la clave', async () => {
    const { backup } = await setup();
    const text = '{"__proto__":{"polluted":true},"organization":{"id":"o","name":"x"},"quotes":[]}';
    const result = backup.parseBackupText(text);
    assert.equal({}.polluted, undefined);
    if (result.ok) {
      assert.equal(Object.hasOwn(result.state, '__proto__'), false);
      assert.equal(JSON.stringify(result.state).includes('polluted'), false);
    }
  });
});

// ================================================================= import

describe('Backup — importación', () => {
  test('importBackup guarda una copia "before-import" idéntica al estado previo y reemplaza los datos', async () => {
    const clock = createClock();
    const { repo, storage, backup } = await setup({ clock });
    await repo.saveQuote({ name: 'Trabajo previo' });
    const previousRaw = storage.getItem(STORAGE_KEYS.state);

    const incoming = JSON.parse(await demoBackupText((d) => ({ ...d, quotes: [d.quotes[0]], organization: { ...d.organization, name: 'Importada SRL' } })));
    clock.advance();
    const result = await backup.applyBackup(incoming);

    assert.ok(result.recoveryKey.startsWith(STORAGE_KEYS.recoveryPrefix));
    assert.match(result.recoveryKey, /before-import$/);
    assert.equal(storage.getItem(result.recoveryKey), previousRaw, 'copia literal del estado anterior');
    assert.equal(repo.getRecoverySnapshot(result.recoveryKey), previousRaw);
    assert.deepEqual(backup.listRecoverySnapshots(), [result.recoveryKey]);
    assert.equal(backup.getRecoverySnapshot(result.recoveryKey), previousRaw);

    assert.equal(result.quotes, 1);
    assert.equal(result.organization, 'Importada SRL');
    assert.equal((await repo.getOrganization()).name, 'Importada SRL');
    assert.equal((await repo.getQuotes()).length, 1);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEYS.state));
    assert.equal('app' in persisted || 'exportedAt' in persisted, false, 'no persiste metadatos del archivo');
    assert.equal(persisted.schemaVersion, CURRENT_SCHEMA_VERSION);
  });

  test('importar un backup inválido falla con invalid_backup y no cambia nada', async () => {
    const { repo, storage, backup } = await setup();
    const before = dump(storage);
    const state = await readAll(repo);
    await assert.rejects(backup.applyBackup({ schemaVersion: 1, organization: null }), { name: 'RepositoryError', code: 'invalid_backup' });
    await assert.rejects(repo.importBackup('texto'), { code: 'invalid_backup' });
    await assert.rejects(repo.importBackup({ schemaVersion: 99 }), { code: 'invalid_backup' });
    assert.deepEqual(dump(storage), before);
    assert.deepEqual(await readAll(repo), state);
  });

  test('sin espacio para la copia previa: falla con recovery_failed y no sobrescribe', async () => {
    const { repo, storage } = await setup();
    const before = dump(storage);
    const state = await readAll(repo);
    storage.failWhen = (key) => key.startsWith(STORAGE_KEYS.recoveryPrefix);
    const incoming = JSON.parse(await demoBackupText((d) => ({ ...d, quotes: [] })));
    await assert.rejects(repo.importBackup(incoming), { code: 'recovery_failed' });
    assert.deepEqual(dump(storage), before);
    assert.deepEqual(await readAll(repo), state);
  });

  test('si falla la escritura principal el estado en memoria no cambia', async () => {
    const { repo, storage } = await setup();
    const mainBefore = storage.getItem(STORAGE_KEYS.state);
    const state = await readAll(repo);
    storage.failWhen = (key) => key === STORAGE_KEYS.state;
    const incoming = JSON.parse(await demoBackupText((d) => ({ ...d, quotes: [] })));
    await assert.rejects(repo.importBackup(incoming), { code: 'quota_exceeded' });
    assert.equal(storage.getItem(STORAGE_KEYS.state), mainBefore);
    assert.deepEqual(await readAll(repo), state);
  });

  test('el evento backup_imported sólo lleva un contador', async () => {
    const events = [];
    const remove = addEventSink((e) => events.push(e), { force: true });
    try {
      const { backup } = await setup();
      await backup.applyBackup(JSON.parse(await demoBackupText()));
    } finally {
      remove();
    }
    const ev = events.find((e) => e.name === 'backup_imported');
    assert.deepEqual(ev.props, { count: 2 });
  });
});

// ============================================================ reset demo

describe('Backup — restaurar demo', () => {
  test('resetToDemo guarda una copia del estado actual y vuelve a la demo', async () => {
    const clock = createClock();
    const { repo, storage, backup } = await setup({ clock });
    await repo.saveQuote({ name: 'Trabajo previo' });
    await repo.saveOrganization({ name: 'Mi Empresa' });
    const previousRaw = storage.getItem(STORAGE_KEYS.state);
    clock.advance();

    const { recoveryKey } = await backup.resetToDemo();
    assert.ok(recoveryKey.startsWith(STORAGE_KEYS.recoveryPrefix));
    assert.match(recoveryKey, /before-demo-reset$/);
    assert.equal(storage.getItem(recoveryKey), previousRaw);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEYS.state)), createDemoState(CURRENT_SCHEMA_VERSION));
    assert.equal((await repo.getOrganization()).name, 'Patagonia Servicios SRL');
    assert.equal(storage.clearCalls, 0);
  });

  test('sin espacio para la copia, resetToDemo no borra los datos actuales', async () => {
    const { repo, storage } = await setup();
    await repo.saveQuote({ name: 'No perder' });
    const before = dump(storage);
    storage.failWhen = (key) => key.startsWith(STORAGE_KEYS.recoveryPrefix);
    await assert.rejects(repo.resetToDemo(), { code: 'recovery_failed' });
    assert.deepEqual(dump(storage), before);
  });

  test('backupService informa operaciones no soportadas por repositorios sin recuperación', async () => {
    const minimal = { exportBackup: async () => ({}), importBackup: async () => ({ quotes: 0 }) };
    const backup = createBackupService({ repository: minimal });
    await assert.rejects(backup.resetToDemo(), /no soportada/);
    assert.deepEqual(backup.listRecoverySnapshots(), []);
    assert.equal(backup.getRecoverySnapshot('rateos.recovery.x'), null);
  });

  test('getRecoverySnapshot del servicio no expone claves que no sean de recuperación', async () => {
    const { backup } = await setup();
    assert.equal(backup.getRecoverySnapshot(STORAGE_KEYS.state), null);
  });
});

// ================================================ empezar en limpio

describe('startFresh: empezar con mi empresa en limpio', () => {
  test('quita la empresa ficticia, cotizaciones y recursos; conserva convenios, plantillas y configuración; guarda copia de recuperación', async () => {
    const storage = new MemoryStorage();
    const repo = new LocalStorageRepository(storage, { now: createClock() });
    await repo.init();
    const service = createBackupService({ repository: repo });
    const before = await repo.exportBackup();
    assert.ok(before.quotes.length > 0 && before.organization.illustrative === true);
    const result = await service.startFresh({ name: '  Grúas del Sur SA ', baseLocation: 'Añelo', industry: 'oil_gas_services' });
    assert.ok(result.recoveryKey && storage.getItem(result.recoveryKey), 'guarda una copia de recuperación antes');
    assert.match(result.recoveryKey, /before-start-fresh/, 'la copia dice por qué se guardó');
    const after = await repo.exportBackup();
    assert.equal(after.organization.id, before.organization.id);
    assert.equal(after.organization.name, 'Grúas del Sur SA');
    assert.equal(after.organization.baseLocation, 'Añelo');
    assert.equal(after.organization.industry, 'oil_gas_services');
    assert.equal(after.organization.illustrative, false);
    assert.equal(after.organization.notes, '', 'las notas de la empresa ficticia no pasan a la propia');
    assert.equal(after.quotes.length, 0);
    for (const type of RESOURCE_TYPES) {
      if (type === 'agreements') assert.deepEqual(after.resources[type], before.resources[type]);
      else assert.deepEqual(after.resources[type], [], type);
    }
    assert.deepEqual(after.services, before.services);
    assert.equal(after.settings.lastQuoteNumber, before.settings.lastQuoteNumber, 'el contador de códigos nunca se reinicia');
    // La copia de recuperación tiene los datos anteriores completos.
    const snapshot = JSON.parse(storage.getItem(result.recoveryKey));
    assert.equal(snapshot.quotes.length, before.quotes.length);
  });

  test('sin nombre, la empresa ficticia pasa a llamarse "Mi empresa" y sin base', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage(), { now: createClock() });
    await repo.init();
    await createBackupService({ repository: repo }).startFresh();
    const org = await repo.getOrganization();
    assert.equal(org.name, 'Mi empresa');
    assert.equal(org.baseLocation, '');
    assert.equal(org.illustrative, false);
  });

  test('en modo sólo lectura no modifica nada', async () => {
    const storage = new MemoryStorage();
    const repo = new LocalStorageRepository(storage, { now: createClock() });
    await repo.init();
    const raw = JSON.parse(storage.getItem(STORAGE_KEYS.state));
    raw.schemaVersion = CURRENT_SCHEMA_VERSION + 1;
    storage.setItem(STORAGE_KEYS.state, JSON.stringify(raw));
    const ro = new LocalStorageRepository(storage, { now: createClock() });
    const init = await ro.init();
    assert.equal(init.status, 'read_only');
    const before = storage.getItem(STORAGE_KEYS.state);
    await assert.rejects(() => createBackupService({ repository: ro }).startFresh({ name: 'X' }));
    assert.equal(storage.getItem(STORAGE_KEYS.state), before);
  });
});

describe('importBackup: motivo de la copia de recuperación', () => {
  test('por defecto "before-import"; un motivo inválido no se usa en la clave', async () => {
    const storage = new MemoryStorage();
    const repo = new LocalStorageRepository(storage, { now: createClock() });
    await repo.init();
    const data = await repo.exportBackup();
    const a = await repo.importBackup(data);
    assert.match(a.recoveryKey, /before-import/);
    const b = await repo.importBackup(data, { recoveryReason: '../x"; drop' });
    assert.match(b.recoveryKey, /before-import/);
    const c = await repo.importBackup(data, { recoveryReason: 'before-start-fresh' });
    assert.match(c.recoveryKey, /before-start-fresh/);
  });
});
