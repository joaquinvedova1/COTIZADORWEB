/**
 * SupabaseRepository (datos reales en la nube) con un servidor falso:
 * cuenta nueva vacía, guardado confirmado, conflicto de revisión, errores
 * de red, sesión vencida, cambios pendientes retomados, roles e importación.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseRepository, cloudCacheKey } from '../../js/data/supabase-repository.js';
import { createAccountContext, createDemoContext } from '../../js/services/app-context.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { CURRENT_SCHEMA_VERSION } from '../../js/data/schema.js';
import { createFakeServer, SpyStorage } from '../helpers/fake-supabase.js';

const noTimers = { setTimeout: () => 1, clearTimeout: () => {} };

async function openRepo(server, userId, { cache = new SpyStorage(), role } = {}) {
  const gw = server.gatewayFor(userId);
  const m = await gw.loadMembership(userId);
  const repo = new SupabaseRepository({ gateway: gw, organization: m.organization, userId, role: role || m.role, cacheStorage: cache, timers: noTimers });
  const init = await repo.init();
  return { repo, gw, init, cache, orgId: m.organization.id };
}

describe('SupabaseRepository: cuenta nueva', () => {
  test('arranca VACÍA (sin la empresa ficticia ni demo) con la empresa real, y la sube a la nube', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a', company: 'Grúas del Sur SRL' });
    const { repo, init, orgId } = await openRepo(server, 'a');
    assert.equal(init.status, 'new_workspace');
    assert.deepEqual(init.messages, [], 'sin el aviso "Se cargaron datos de demostración"');
    const org = await repo.getOrganization();
    assert.equal(org.name, 'Grúas del Sur SRL');
    assert.equal(org.id, orgId);
    assert.equal(org.illustrative, false);
    assert.deepEqual(await repo.getQuotes(), []);
    for (const type of ['laborProfiles', 'equipment', 'materials', 'locations', 'agreements']) assert.deepEqual(await repo.getResources(type), [], type);
    assert.deepEqual(await repo.getServices(), []);
    const ws = server.workspaces.get(orgId);
    assert.equal(ws.revision, 1, 'el estado vacío quedó guardado en la nube');
    assert.equal(ws.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok(!JSON.stringify(ws.state).includes('Patagonia Servicios SRL'));
    assert.equal(repo.getSyncState().status, 'saved');
  });

  test('guardar una cotización espera la confirmación de la nube y la deja en el servidor', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const { repo, orgId, cache } = await openRepo(server, 'a');
    const q = createEmptyQuote({ organizationId: orgId, baseName: 'Primera' });
    await repo.saveQuote({ ...q, name: 'Primera' });
    const ws = server.workspaces.get(orgId);
    assert.equal(ws.revision, 2);
    assert.equal(ws.state.quotes.length, 1);
    assert.equal(ws.state.quotes[0].organizationId, orgId);
    assert.equal(repo.getSyncState().status, 'saved');
    assert.equal(cache.getItem(cloudCacheKey('a', orgId)), null, 'sin cambios pendientes no queda copia local');
  });

  test('otro dispositivo (recarga) ve los datos guardados', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const first = await openRepo(server, 'a');
    await first.repo.saveQuote({ ...createEmptyQuote({ organizationId: first.orgId }), name: 'Sincronizada' });
    const second = await openRepo(server, 'a', { cache: new SpyStorage() });
    const quotes = await second.repo.getQuotes();
    assert.deepEqual(quotes.map((q) => q.name), ['Sincronizada']);
  });
});

describe('SupabaseRepository: conflictos, red y sesión', () => {
  test('conflicto de revisión: NO pisa la versión nueva, avisa y bloquea escrituras hasta resolver', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const { repo, orgId, cache } = await openRepo(server, 'a');
    const remote = JSON.parse(JSON.stringify(server.workspaces.get(orgId).state));
    remote.organization.notes = 'cambio de otro dispositivo';
    server.externalSave(orgId, remote);
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Local' }), (e) => e.code === 'conflict' && /otro dispositivo/.test(e.message));
    assert.equal(server.workspaces.get(orgId).state.organization.notes, 'cambio de otro dispositivo', 'la versión nueva sigue intacta');
    assert.equal(repo.getSyncState().status, 'conflict');
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Otra' }), (e) => e.code === 'conflict');
    // "Conservar una copia": el texto local incluye el cambio que no se subió.
    assert.match(repo.localCopyText(), /"Local"/);
    // "Recargar": abre la versión de la nube y guarda antes una copia de recuperación local.
    await repo.reloadFromCloud();
    assert.equal((await repo.getOrganization()).notes, 'cambio de otro dispositivo');
    assert.deepEqual(await repo.getQuotes(), []);
    assert.ok(repo.listRecoverySnapshots().some((k) => k.endsWith('.cloud-conflict-local')));
    assert.ok(cache.map.size >= 1);
    await repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Después' });
    assert.equal(server.workspaces.get(orgId).state.quotes[0].name, 'Después');
  });

  test('sin conexión: no dice "guardado", conserva el cambio localmente y lo retoma al volver', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const { repo, orgId } = await openRepo(server, 'a', { cache });
    server.failNext = 'network';
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Offline' }), (e) => e.code === 'sync_failed' && /No pudimos sincronizar/.test(e.message));
    assert.equal(repo.getSyncState().status, 'offline');
    assert.equal(server.workspaces.get(orgId).state.quotes.length, 0, 'no llegó a la nube');
    const pending = JSON.parse(cache.getItem(cloudCacheKey('a', orgId)));
    assert.equal(pending.dirty, true);
    assert.match(pending.text, /Offline/);
    // Se recarga la página (otro repositorio, mismo navegador): retoma y sube.
    const again = await openRepo(server, 'a', { cache });
    assert.equal(again.init.resumed, true);
    assert.deepEqual(server.workspaces.get(orgId).state.quotes.map((q) => q.name), ['Offline']);
    assert.equal(cache.getItem(cloudCacheKey('a', orgId)), null);
  });

  test('retryNow sube lo pendiente cuando vuelve la conexión', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const { repo, orgId } = await openRepo(server, 'a');
    server.failNext = 'network';
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Reintento' }));
    await repo.retryNow();
    assert.equal(repo.getSyncState().status, 'saved');
    assert.equal(server.workspaces.get(orgId).state.quotes[0].name, 'Reintento');
  });

  test('sesión vencida: avisa "Tu sesión terminó" y no pierde el cambio', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const { repo, orgId } = await openRepo(server, 'a', { cache });
    server.failNext = 'session_expired';
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Pendiente' }), (e) => e.code === 'session_expired' && /Tu sesión terminó/.test(e.message));
    assert.equal(repo.getSyncState().status, 'session_expired');
    assert.match(cache.getItem(cloudCacheKey('a', orgId)), /Pendiente/);
  });

  test('cambios pendientes de este navegador + otro dispositivo guardó: abre la nube y deja los locales en una copia de recuperación', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const { repo, orgId } = await openRepo(server, 'a', { cache });
    server.failNext = 'network';
    await assert.rejects(repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), name: 'Sin subir' }));
    const remote = JSON.parse(JSON.stringify(server.workspaces.get(orgId).state));
    remote.organization.notes = 'del celular';
    server.externalSave(orgId, remote);
    const again = await openRepo(server, 'a', { cache });
    assert.equal(again.init.conflictAtLoad, true);
    assert.ok(again.init.messages.some((m) => /otro dispositivo/.test(m)));
    assert.equal((await again.repo.getOrganization()).notes, 'del celular');
    const key = again.repo.listRecoverySnapshots().find((k) => k.endsWith('.cloud-unsynced'));
    assert.ok(key);
    assert.match(again.repo.getRecoverySnapshot(key), /Sin subir/);
  });

  test('VIEWER: sólo lectura', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const orgId = [...server.orgs.keys()][0];
    server.members.push({ organization_id: orgId, user_id: 'v', role: 'VIEWER' });
    await openRepo(server, 'a');
    const { repo } = await openRepo(server, 'v');
    await assert.rejects(repo.saveQuote(createEmptyQuote({ organizationId: orgId })), (e) => e.code === 'read_only');
  });

  test('la demo no se puede cargar en una cuenta real', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const { repo } = await openRepo(server, 'a');
    await assert.rejects(repo.resetToDemo(), (e) => e.code === 'unsupported_operation');
  });
});

describe('aislamiento entre cuentas y de la demo', () => {
  test('el usuario B no abre ni escribe el workspace de A (como RLS)', async () => {
    const server = createFakeServer();
    const orgA = server.addUser({ id: 'a', company: 'A' });
    server.addUser({ id: 'b', company: 'B' });
    await openRepo(server, 'a');
    const gwB = server.gatewayFor('b');
    assert.equal((await gwB.loadWorkspace(orgA)).ok, false);
    const res = await gwB.saveWorkspace(orgA, { state: {}, schemaVersion: 2, baseRevision: 1 });
    assert.equal(res.ok, false);
    // B no puede abrir un repositorio contra la organización de A aunque manipule el id.
    const repo = new SupabaseRepository({ gateway: gwB, organization: { id: orgA, name: 'A' }, userId: 'b', role: 'OWNER', cacheStorage: new SpyStorage(), timers: noTimers });
    await assert.rejects(repo.init(), (e) => e.code === 'not_found');
  });

  test('la caché local es por usuario y organización (otra persona en el mismo navegador no la toma)', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const orgB = server.addUser({ id: 'b' });
    const cache = new SpyStorage();
    const a = await openRepo(server, 'a', { cache });
    server.failNext = 'network';
    await assert.rejects(a.repo.saveQuote({ ...createEmptyQuote({ organizationId: a.orgId }), name: 'De A' }));
    const b = await openRepo(server, 'b', { cache });
    assert.equal(b.init.resumed, false);
    assert.deepEqual(await b.repo.getQuotes(), []);
    assert.ok(!JSON.stringify(server.workspaces.get(orgB).state).includes('De A'));
  });

  test('las copias de recuperación son de cada cuenta: otra persona en el mismo navegador no las ve ni las restaura', async () => {
    const server = createFakeServer();
    const orgA = server.addUser({ id: 'a' });
    server.addUser({ id: 'b' });
    const cache = new SpyStorage({ 'rateos.recovery.2026-01-01T00-00-00-000Z.before-import': '{"modo":"local"}' });
    const a = await openRepo(server, 'a', { cache });
    await a.repo.saveQuote({ ...createEmptyQuote({ organizationId: a.orgId }), name: 'Secreta de A' });
    // Otro dispositivo guarda → conflicto → "Recargar" deja la versión local en una copia.
    server.externalSave(orgA, server.workspaces.get(orgA).state);
    await assert.rejects(a.repo.saveQuote({ ...createEmptyQuote({ organizationId: a.orgId }), name: 'Otra de A' }), (e) => e.code === 'conflict');
    await a.repo.reloadFromCloud();
    const keysA = a.repo.listRecoverySnapshots();
    assert.ok(keysA.length >= 1);
    assert.ok(keysA.every((k) => k.startsWith(`rateos.cloud.a.${orgA}.recovery.`)), keysA.join(','));
    assert.ok(!keysA.some((k) => k.startsWith('rateos.recovery.')), 'las copias del modo local no se mezclan con las de la cuenta');

    const b = await openRepo(server, 'b', { cache });
    assert.deepEqual(b.repo.listRecoverySnapshots(), [], 'B no ve las copias de A');
    assert.equal(b.repo.getRecoverySnapshot(keysA[0]), null, 'B no puede leer una copia de A aunque conozca la clave');
    assert.equal(b.repo.deleteRecoverySnapshot(keysA[0]), false, 'ni borrarla');
    assert.equal(b.repo.getRecoverySnapshot('rateos.recovery.2026-01-01T00-00-00-000Z.before-import'), null);
    assert.ok(cache.getItem(keysA[0]), 'la copia de A sigue intacta');
    // En pantalla y en el archivo descargado: fecha y motivo, nunca usuario ni organización.
    const { recoveryLabel, recoveryFilename } = await import('../../js/ui/views/settings.js');
    const label = recoveryLabel(keysA[0]);
    assert.equal(label.reason, 'Tu versión, antes de recargar la más nueva');
    assert.ok(!JSON.stringify(label).includes(orgA) && !recoveryFilename(keysA[0]).includes(orgA));
    assert.match(recoveryFilename(keysA[0]), /^rateos-recovery-\d{4}-\d{2}-\d{2}T[\d-]+Z-cloud-conflict-local\.json$/);
    assert.equal(recoveryFilename('rateos.recovery.2026-01-01T00-00-00-000Z.before-import'), 'rateos-recovery-2026-01-01T00-00-00-000Z-before-import.json');
  });

  test('la demo pública vive en memoria: no escribe en el navegador ni en la nube', async () => {
    const original = globalThis.localStorage;
    const spy = new SpyStorage();
    globalThis.localStorage = spy;
    try {
      const demo = await createDemoContext();
      const items = await demo.quotes.listQuotes();
      assert.ok(items.length >= 1);
      assert.ok(items.every((i) => i.quote.illustrative === true));
      await demo.quotes.ensureDemoQuote();
      assert.deepEqual(spy.writes, [], 'nada en localStorage');
      assert.equal(demo.persistent, false);
    } finally {
      if (original === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = original;
    }
  });

  test('createAccountContext arma la cuenta con la organización y el rol reales', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a', fullName: 'Joaquín', company: 'Servicios Norte' });
    const ctx = await createAccountContext({ user: { id: 'a', email: 'a@example.com', fullName: '' }, workspaceGateway: server.gatewayFor('a'), cacheStorage: new SpyStorage() });
    assert.equal(ctx.account.organization.name, 'Servicios Norte');
    assert.equal(ctx.account.user.fullName, 'Joaquín');
    assert.equal(ctx.account.role, 'OWNER');
    assert.equal(ctx.account.roleLabel, 'Dueño/a');
    assert.deepEqual(await ctx.quotes.listQuotes(), []);
    const q = await ctx.quotes.createQuote({ name: 'Primera cotización' });
    assert.equal(q.code, 'COT-0001');
    ctx.dispose();
  });
});

describe('importar un backup en la nube', () => {
  test('un backup de otra organización queda en la organización de la cuenta (no se puede "colar" otra)', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a', company: 'Mía' });
    const { repo, orgId } = await openRepo(server, 'a');
    const foreign = createDemoState(CURRENT_SCHEMA_VERSION); // organizationId de otra empresa en todo
    await repo.importBackup(foreign);
    const ws = server.workspaces.get(orgId).state;
    assert.equal(ws.organization.id, orgId);
    assert.equal(ws.organization.name, 'Mía');
    const ids = new Set([...ws.quotes, ...ws.services, ...Object.values(ws.resources).flat()].map((x) => x.organizationId));
    assert.deepEqual([...ids], [orgId]);
  });
});

describe('importar datos del modo local', () => {
  test('suma datos reales sin pisar los de la cuenta y renumera códigos repetidos', async () => {
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const { repo, orgId } = await openRepo(server, 'a');
    await repo.saveQuote({ ...createEmptyQuote({ organizationId: orgId }), id: 'q-cloud', code: 'COT-0001', name: 'De la nube' });
    const local = createDemoState(CURRENT_SCHEMA_VERSION);
    const mine = { ...createEmptyQuote({ organizationId: 'org-local' }), id: 'q-local', code: 'COT-0001', name: 'Mía local', illustrative: false };
    const result = await repo.importLocalData({ resources: { equipment: [{ id: 'e1', name: 'Grúa propia', illustrative: false, organizationId: 'org-local' }] }, services: [], quotes: [mine], settings: { ...local.settings, illustrative: false, fuelPricePerLiter: 1800, lastQuoteNumber: 1 }, organization: { baseLocation: 'Añelo' } });
    assert.equal(result.quotes, 1);
    assert.equal(result.resources, 1);
    assert.ok(result.recoveryKey);
    const quotes = await repo.getQuotes();
    assert.deepEqual(quotes.map((q) => [q.name, q.code, q.organizationId]), [['De la nube', 'COT-0001', orgId], ['Mía local', 'COT-0002', orgId]]);
    assert.equal((await repo.getSettings()).fuelPricePerLiter, 1800);
    assert.equal((await repo.getSettings()).organizationId, orgId);
    assert.equal((await repo.getOrganization()).baseLocation, 'Añelo');
    assert.equal(server.workspaces.get(orgId).state.quotes.length, 2, 'quedó en la nube');
  });
});

describe('SupabaseRepository: producción con datos v2 en la nube (PLAN-2026-005)', () => {
  /** Workspace v2 con la forma que guardaba producción antes de v0.2.0. */
  function v2Workspace(orgId) {
    return {
      schemaVersion: 2,
      organization: { id: orgId, organizationId: orgId, name: 'Empresa real', baseLocation: '', industry: '', notes: '', illustrative: false, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', createdBy: null, updatedBy: null },
      resources: {
        agreements: [],
        laborProfiles: [{ id: 'lp', organizationId: orgId, role: 'Operador', basicMonthly: 2000000 }],
        equipment: [{ id: 'eq', organizationId: orgId, name: 'Hidrogrúa', type: 'crane_truck', replacementValue: 250000000, usefulLifeYears: 10 }],
        materials: [],
        locations: [],
      },
      services: [],
      quotes: [{
        id: 'q', organizationId: orgId, code: 'COT-0001', name: 'Cotización v2', createdAt: '2026-10-02T10:00:00.000Z', serviceType: 'on_call', pricingMode: 'known_activity', unit: 'day',
        activity: { activeDaysPerMonth: 8, daysPerActivation: 2, availableDaysPerMonth: 30, hoursPerActiveDay: 10 },
        labor: [{ id: 'l', sourceId: 'lp', role: 'Operador', positions: 1, peoplePerPosition: 1, basicMonthly: 2000000, normalHoursPerMonth: 176 }],
        equipment: [{ id: 'e', sourceId: 'eq', name: 'Hidrogrúa', quantity: 1, hoursPerActiveDay: 10, replacementValue: 250000000, usefulLifeYears: 10 }],
        materials: [], otherCosts: [],
        fuel: { pricePerLiter: 1500, providedBy: 'contractor' },
        logistics: { notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [{ id: 'v', name: 'Hidrogrúa', count: 1, consumptionLPer100Km: 35, costPerKm: 150 }] },
        billingTaxes: { mode: 'combined', notApplicable: false, combinedPct: null, items: [] },
        vatTreatment: 'excluded',
      }],
      settings: { currency: 'ARS', fuelPricePerLiter: 1500, defaultBillingTaxes: null, illustrative: false },
    };
  }

  test('sin la confirmación de staging (producción): migra a v3 una vez, con copia previa en el navegador, y la sube', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a', company: 'Empresa real' });
    server.workspaces.set(orgId, { state: v2Workspace(orgId), revision: 7, schemaVersion: 2 });
    const { repo, init, cache } = await openRepo(server, 'a');
    await repo.flush();
    assert.equal(init.status, 'migrated');
    const ws = server.workspaces.get(orgId);
    assert.equal(ws.schemaVersion, 3);
    assert.equal(ws.state.schemaVersion, 3);
    assert.ok(ws.revision > 7, 'se guardó con control de revisión');
    const [q] = await repo.getQuotes();
    assert.equal(q.labor[0].basicMonthly, 2000000, 'ningún valor cambia');
    assert.equal(q.labor[0].base.period, null, '"Base no definida": nunca se inventa una fecha');
    assert.equal(q.offerDate, '2026-10-02');
    const keys = Array.from({ length: cache.length }, (_, i) => cache.key(i));
    assert.ok(keys.some((k) => k.startsWith(`rateos.cloud.a.${orgId}.recovery.`) && k.includes('pre-migration-v2')), 'copia previa de la cuenta en este navegador');
    // Abrir de nuevo no vuelve a migrar ni a escribir.
    const again = await openRepo(server, 'a');
    assert.equal(again.init.status, 'loaded');
  });

  test('cuenta nueva en producción: crea su espacio vacío en v3 sin preguntar', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'n', company: 'Nueva SA' });
    const { repo, init } = await openRepo(server, 'n');
    await repo.flush();
    assert.equal(init.status, 'new_workspace');
    assert.equal(server.workspaces.get(orgId).schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(await repo.getResources('externalServices'), []);
    assert.deepEqual(await repo.getResources('equipmentModels'), []);
  });
});
