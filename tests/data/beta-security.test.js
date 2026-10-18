/**
 * Beta Readiness v1 (PLAN-2026-015): tenancy, integridad y recuperación del
 * lado del navegador, con el servidor falso (que imita RLS) y datos SINTÉTICOS.
 *
 * La negación real entre empresas la prueba la base con
 * supabase/tests/beta_security_test.sql; acá se prueba que el cliente nunca
 * mezcla empresas, nunca confía en el organizationId que traiga el cliente o
 * un archivo, nunca pierde en silencio cambios sin subir (varias pestañas,
 * fallas a mitad de guardado) y nunca reemplaza solo datos de la nube que no
 * puede leer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SupabaseRepository,
  cloudCacheKey,
  cloudPendingPrefix,
  ACCESS_LOST_CODE,
  UNREADABLE_CLOUD_MESSAGE,
} from '../../js/data/supabase-repository.js';
import { createAccountContext } from '../../js/services/app-context.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { createEmptyProduct } from '../../js/domain/product-factory.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { CURRENT_SCHEMA_VERSION } from '../../js/data/schema.js';
import { isLegacyDataClaimed, legacyFingerprint } from '../../js/data/legacy-local.js';
import { createDraftStore, onSessionReset, resetSessionMemory, sessionOwner } from '../../js/ui/session-memory.js';
import { createFakeServer, SpyStorage } from '../helpers/fake-supabase.js';

const noTimers = { setTimeout: () => 1, clearTimeout: () => {} };

/** Reloj fijo por pestaña (las copias se ordenan por fecha). */
const clock = (iso) => () => iso;

async function openRepo(server, userId, { cache = new SpyStorage(), tabId, now } = {}) {
  const gw = server.gatewayFor(userId);
  const m = await gw.loadMembership(userId);
  const repo = new SupabaseRepository({ gateway: gw, organization: m.organization, userId, role: m.role, cacheStorage: cache, timers: noTimers, tabId, now });
  const init = await repo.init();
  return { repo, gw, init, cache, orgId: m.organization.id };
}

const pendingKeys = (cache, userId, orgId) => [...cache.map.keys()].filter((k) => k === cloudCacheKey(userId, orgId) || k.startsWith(cloudPendingPrefix(userId, orgId)));
const snapshotsText = (repo) => repo.listRecoverySnapshots().map((k) => repo.getRecoverySnapshot(k)).join('\n');
const serverText = (server, orgId) => JSON.stringify(server.workspaces.get(orgId).state);
const quote = (orgId, fields) => ({ ...createEmptyQuote({ organizationId: orgId }), ...fields });

describe('tenancy: una empresa nunca obtiene datos de otra, ni con los IDs conocidos', () => {
  for (const [attacker, victim] of [['a', 'b'], ['b', 'a']]) {
    test(`${attacker.toUpperCase()} → ${victim.toUpperCase()}: no lee, no escribe y no encuentra nada por id`, async () => {
      const server = createFakeServer();
      const orgs = { a: server.addUser({ id: 'a', company: 'Empresa A' }), b: server.addUser({ id: 'b', company: 'Empresa B' }) };
      const v = await openRepo(server, victim);
      await v.repo.saveQuote(quote(orgs[victim], { id: `q-${victim}`, name: `Secreta de ${victim}` }));
      await v.repo.saveResource('equipment', { id: `eq-${victim}`, name: `Grúa de ${victim}`, illustrative: false });
      const before = serverText(server, orgs[victim]);

      const gw = server.gatewayFor(attacker);
      assert.equal((await gw.loadWorkspace(orgs[victim])).ok, false, 'no lee el workspace ajeno por su organización');
      const write = await gw.saveWorkspace(orgs[victim], { state: { hack: true }, schemaVersion: CURRENT_SCHEMA_VERSION, baseRevision: server.workspaces.get(orgs[victim]).revision });
      assert.equal(write.ok, false, 'no lo escribe aunque conozca la revisión');
      assert.equal(serverText(server, orgs[victim]), before, 'el workspace ajeno sigue intacto');
      // Un repositorio "manipulado" con la organización ajena no abre.
      const forged = new SupabaseRepository({ gateway: gw, organization: { id: orgs[victim], name: 'x' }, userId: attacker, role: 'OWNER', cacheStorage: new SpyStorage(), timers: noTimers });
      await assert.rejects(forged.init(), (e) => e.code === 'not_found');
      // Su propio workspace no contiene nada ajeno, aunque pida los ids conocidos.
      const own = await openRepo(server, attacker);
      assert.equal(await own.repo.getQuote(`q-${victim}`), null);
      assert.equal(await own.repo.getResource('equipment', `eq-${victim}`), null);
      assert.ok(!JSON.stringify(await own.repo.exportBackup()).includes(`Secreta de ${victim}`));
    });
  }
});

describe('el organizationId que manda el cliente nunca decide de quién es un dato', () => {
  test('guardar con el organizationId de otra empresa: queda con el de la cuenta', async () => {
    const server = createFakeServer();
    const orgA = server.addUser({ id: 'a' });
    const orgB = server.addUser({ id: 'b' });
    const { repo } = await openRepo(server, 'a');
    await repo.saveQuote(quote(orgB, { id: 'q1', name: 'Q' }));
    await repo.saveResource('equipment', { id: 'eq1', name: 'Grúa', organizationId: orgB });
    await repo.saveProduct({ ...createEmptyProduct({ organizationId: orgB, id: 'p1' }), name: 'P' });
    await repo.saveService({ id: 's1', name: 'Plantilla', serviceType: 'on_call', organizationId: orgB });
    await repo.updateQuote('q1', { organizationId: orgB });
    await repo.saveSettings({ organizationId: orgB });
    const st = server.workspaces.get(orgA).state;
    const ids = [st.quotes, st.resources.equipment, st.products, st.services].flat().map((x) => x.organizationId);
    assert.deepEqual([...new Set(ids)], [orgA]);
    assert.equal(st.settings.organizationId, orgA);
    assert.equal(st.organization.id, orgA);
    assert.equal(server.workspaces.get(orgB).state, null, 'nada llegó a la otra empresa');
  });

  test('importar un backup con el organizationId y los recursos de otra empresa: se normaliza a la cuenta y no toca a la otra', async () => {
    const server = createFakeServer();
    const orgA = server.addUser({ id: 'a', company: 'Mía' });
    const orgB = server.addUser({ id: 'b', company: 'Ajena' });
    const b = await openRepo(server, 'b');
    await b.repo.saveResource('equipment', { id: 'eq-b', name: 'Grúa de B', illustrative: false });
    await b.repo.saveQuote(quote(orgB, { id: 'q-b', name: 'Cotización de B' }));
    const bBefore = serverText(server, orgB);

    // Un archivo que dice ser de B y referencia recursos de B por id.
    const file = createDemoState(CURRENT_SCHEMA_VERSION);
    file.organization = { ...file.organization, id: orgB, name: 'Ajena' };
    file.quotes = [quote(orgB, { id: 'q-archivo', name: 'Del archivo', equipment: [{ id: 'l1', resourceId: 'eq-b', name: 'Grúa' }] })];
    file.resources.equipment = [];
    const a = await openRepo(server, 'a');
    await a.repo.importBackup(file);

    const ws = server.workspaces.get(orgA).state;
    assert.equal(ws.organization.id, orgA);
    assert.equal(ws.organization.name, 'Mía', 'el nombre de la empresa es el de la cuenta');
    const owners = new Set([...ws.quotes, ...ws.services, ...Object.values(ws.resources).flat(), ...(ws.products || [])].map((x) => x.organizationId));
    assert.deepEqual([...owners], [orgA]);
    assert.ok(!JSON.stringify(ws).includes('Grúa de B'), 'el id de un recurso ajeno no trae el recurso ajeno');
    assert.ok(!JSON.stringify(ws).includes('Cotización de B'));
    assert.equal(serverText(server, orgB), bBefore, 'la otra empresa sigue intacta');
  });
});

describe('varias pestañas: los cambios sin subir de una pestaña nunca se pierden por otra', () => {
  test('la pestaña 1 guarda bien; los cambios sin subir de la pestaña 2 siguen a salvo (antes se borraban)', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const t1 = await openRepo(server, 'a', { cache, tabId: 'tab-1' });
    const t2 = await openRepo(server, 'a', { cache, tabId: 'tab-2' });
    server.failNext = 'network';
    await assert.rejects(t2.repo.saveQuote(quote(orgId, { name: 'De la pestaña 2' })), (e) => e.code === 'sync_failed');
    await t1.repo.saveQuote(quote(orgId, { name: 'De la pestaña 1' }));
    assert.match(cache.getItem(t2.repo.cacheKey) || '', /De la pestaña 2/, 'la copia de la pestaña 2 sigue en el navegador');
    // La pestaña 2 se cierra sin reintentar. Al volver a abrir no se pierde nada:
    const t3 = await openRepo(server, 'a', { cache, tabId: 'tab-3' });
    assert.equal(t3.init.conflictAtLoad, true, 'otro guardado pasó en el medio: se avisa');
    assert.match(serverText(server, orgId), /De la pestaña 1/);
    assert.match(snapshotsText(t3.repo), /De la pestaña 2/, 'los cambios de la pestaña 2 quedaron en una copia de recuperación');
    assert.deepEqual(pendingKeys(cache, 'a', orgId), [], 'y ya no hay copias pendientes sueltas');
  });

  test('dos pestañas sin conexión sobre la misma versión: se retoma la más nueva y la otra queda en una copia', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const t1 = await openRepo(server, 'a', { cache, tabId: 'tab-1', now: clock('2026-10-17T10:00:00.000Z') });
    const t2 = await openRepo(server, 'a', { cache, tabId: 'tab-2', now: clock('2026-10-17T10:05:00.000Z') });
    server.failNext = 'network';
    await assert.rejects(t1.repo.saveQuote(quote(orgId, { name: 'Uno' })));
    server.failNext = 'network';
    await assert.rejects(t2.repo.saveQuote(quote(orgId, { name: 'Dos' })));
    assert.equal(pendingKeys(cache, 'a', orgId).length, 2, 'una copia por pestaña: ninguna pisó a la otra');
    const t3 = await openRepo(server, 'a', { cache, tabId: 'tab-3' });
    assert.equal(t3.init.resumed, true);
    assert.ok(t3.init.messages.some((m) => /otra pestaña/.test(m)));
    assert.match(serverText(server, orgId), /"Dos"/, 'se subió la más nueva');
    assert.match(snapshotsText(t3.repo), /"Uno"/, 'la otra quedó en una copia de recuperación');
    assert.deepEqual(pendingKeys(cache, 'a', orgId), []);
  });

  test('una copia pendiente de v0.8.0 (clave única) se sigue retomando después de actualizar', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const first = await openRepo(server, 'a', { cache });
    const legacy = JSON.parse(JSON.stringify(server.workspaces.get(orgId).state));
    legacy.quotes.push(quote(orgId, { id: 'q-vieja', name: 'Pendiente de v0.8.0' }));
    cache.setItem(cloudCacheKey('a', orgId), JSON.stringify({ v: 1, userId: 'a', orgId, baseRevision: first.repo.revision, dirty: true, savedAt: '2026-10-17T09:00:00.000Z', text: JSON.stringify(legacy) }));
    const again = await openRepo(server, 'a', { cache });
    assert.equal(again.init.resumed, true);
    assert.match(serverText(server, orgId), /Pendiente de v0\.8\.0/);
    assert.equal(cache.getItem(cloudCacheKey('a', orgId)), null, 'la clave vieja se suelta recién cuando quedó subida');
  });

  test('"Conservar una copia" descarga la versión ACTUAL de la pestaña, no una copia vieja apartada al abrir', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const first = await openRepo(server, 'a', { cache, tabId: 'tab-1' });
    server.failNext = 'network';
    await assert.rejects(first.repo.saveQuote(quote(orgId, { name: 'Copia vieja' })));
    server.externalSave(orgId, server.workspaces.get(orgId).state);
    const again = await openRepo(server, 'a', { cache, tabId: 'tab-2' });
    assert.equal(again.init.conflictAtLoad, true, 'la copia vieja se apartó al abrir');
    server.externalSave(orgId, server.workspaces.get(orgId).state);
    await assert.rejects(again.repo.saveQuote(quote(orgId, { name: 'Edición actual' })), (e) => e.code === 'conflict');
    const copy = again.repo.localCopyText();
    assert.match(copy, /Edición actual/);
    assert.doesNotMatch(copy, /Copia vieja/);
    assert.match(snapshotsText(again.repo), /Copia vieja/, 'la vieja sigue en las copias de recuperación');
  });

  test('dos pestañas editan la misma cotización: la segunda no pisa a la primera (conflicto visible) y conserva su versión', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const t1 = await openRepo(server, 'a', { cache, tabId: 'tab-1' });
    await t1.repo.saveQuote(quote(orgId, { id: 'q1', name: 'Original' }));
    const t2 = await openRepo(server, 'a', { cache, tabId: 'tab-2' });
    await t1.repo.updateQuote('q1', { name: 'Editada en la pestaña 1' });
    await assert.rejects(t2.repo.updateQuote('q1', { name: 'Editada en la pestaña 2' }), (e) => e.code === 'conflict');
    assert.match(serverText(server, orgId), /Editada en la pestaña 1/);
    assert.match(t2.repo.localCopyText(), /Editada en la pestaña 2/, '"Conservar una copia" descarga la versión de la pestaña 2');
    assert.match(cache.getItem(t2.repo.cacheKey), /Editada en la pestaña 2/);
    await t2.repo.reloadFromCloud();
    assert.match(snapshotsText(t2.repo), /Editada en la pestaña 2/, '"Recargar" la deja antes en una copia de recuperación');
  });
});

describe('recuperación: nunca se pierde en silencio el último dato válido', () => {
  test('falla A MITAD de guardado (la nube guardó pero la respuesta no llegó): no se pisa nada y el cambio no se pierde', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const gw = server.gatewayFor('a');
    let dropNext = false;
    const flaky = {
      ...gw,
      async saveWorkspace(...args) {
        const res = await gw.saveWorkspace(...args);
        if (dropNext && res.ok) {
          dropNext = false;
          return { ok: false, code: 'network' };
        }
        return res;
      },
    };
    const m = await gw.loadMembership('a');
    const repo = new SupabaseRepository({ gateway: flaky, organization: m.organization, userId: 'a', role: m.role, cacheStorage: cache, timers: noTimers });
    await repo.init();
    dropNext = true;
    await assert.rejects(repo.saveQuote(quote(orgId, { name: 'Guardada a medias' })), (e) => e.code === 'sync_failed');
    assert.notEqual(repo.getSyncState().status, 'saved', 'nunca dice "guardado" sin la confirmación');
    assert.match(cache.getItem(repo.cacheKey), /Guardada a medias/, 'el cambio sigue en el navegador');
    await assert.rejects(repo.retryNow(), (e) => e.code === 'conflict');
    assert.match(serverText(server, orgId), /Guardada a medias/, 'la nube tiene el guardado que sí llegó');
    await repo.reloadFromCloud();
    assert.ok((await repo.getQuotes()).some((q) => q.name === 'Guardada a medias'));
  });

  test('datos de la nube DAÑADOS: se abren en sólo lectura, la nube no se toca y queda una copia', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const first = await openRepo(server, 'a', { cache });
    await first.repo.saveQuote(quote(orgId, { name: 'Valiosa' }));
    server.externalSave(orgId, { ...server.workspaces.get(orgId).state, schemaVersion: 'roto' });
    const before = serverText(server, orgId);
    const revision = server.workspaces.get(orgId).revision;
    const { repo, init } = await openRepo(server, 'a', { cache });
    assert.equal(init.status, 'read_only');
    assert.deepEqual(init.messages, [UNREADABLE_CLOUD_MESSAGE]);
    assert.ok(!init.messages.some((m) => /demo/.test(m)), 'una cuenta nunca dice que cargó la demo');
    assert.equal(repo.readOnly, true);
    assert.equal(serverText(server, orgId), before, 'la nube no se reemplazó por un espacio vacío');
    assert.equal(server.workspaces.get(orgId).revision, revision, 'ni se escribió');
    assert.match(snapshotsText(repo), /Valiosa/, 'copia del original en este navegador');
    assert.deepEqual(pendingKeys(cache, 'a', orgId), [], 'nada quedó "pendiente" para subirse después');
    await assert.rejects(repo.saveQuote(quote(orgId, { name: 'Otra' })), (e) => e.code === 'read_only');
    // Una recarga posterior tampoco lo pisa.
    const again = await openRepo(server, 'a', { cache });
    assert.equal(again.init.status, 'read_only');
    assert.equal(serverText(server, orgId), before);
  });

  test('datos de la nube con estructura inesperada (misma versión): sólo lectura, sin "reparar" la nube sola', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const first = await openRepo(server, 'a');
    await first.repo.saveQuote(quote(orgId, { name: 'Valiosa' }));
    server.externalSave(orgId, { ...server.workspaces.get(orgId).state, settings: 'roto' });
    const revision = server.workspaces.get(orgId).revision;
    const { repo, init } = await openRepo(server, 'a');
    assert.equal(init.status, 'read_only');
    assert.equal(server.workspaces.get(orgId).revision, revision, 'no se subió una versión reparada');
    assert.equal(server.workspaces.get(orgId).state.settings, 'roto');
    assert.ok(repo.listRecoverySnapshots().some((k) => k.endsWith('.invalid')));
  });

  test('"Recargar" con datos de la nube dañados: tampoco los pisa y avisa', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const { repo } = await openRepo(server, 'a');
    await repo.saveQuote(quote(orgId, { name: 'Mía' }));
    server.externalSave(orgId, { ...server.workspaces.get(orgId).state, schemaVersion: 'roto' });
    const before = serverText(server, orgId);
    await assert.rejects(repo.saveQuote(quote(orgId, { name: 'Choca' })), (e) => e.code === 'conflict');
    const res = await repo.reloadFromCloud();
    assert.equal(res.readOnly, true);
    assert.equal(res.message, UNREADABLE_CLOUD_MESSAGE);
    assert.equal(serverText(server, orgId), before);
  });

  test('cambios sin subir de este navegador que no se pueden leer: se abre la nube y la copia queda guardada', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const first = await openRepo(server, 'a', { cache });
    await first.repo.saveQuote(quote(orgId, { name: 'En la nube' }));
    cache.setItem(`${cloudPendingPrefix('a', orgId)}vieja`, JSON.stringify({ v: 2, userId: 'a', orgId, baseRevision: first.repo.revision, dirty: true, savedAt: '2026-10-17T09:00:00.000Z', text: '{"schemaVersion":"roto","x":"local ilegible"}' }));
    const revision = server.workspaces.get(orgId).revision;
    const { repo, init } = await openRepo(server, 'a', { cache });
    assert.notEqual(init.status, 'read_only', 'la nube estaba bien: se usa');
    assert.ok(init.messages.some((m) => /no pudo leer/.test(m)));
    assert.ok((await repo.getQuotes()).some((q) => q.name === 'En la nube'));
    assert.equal(server.workspaces.get(orgId).revision, revision, 'no se subió nada');
    assert.match(snapshotsText(repo), /local ilegible/);
    assert.deepEqual(pendingKeys(cache, 'a', orgId), []);
  });

  test('datos de una versión más nueva en la nube: sólo lectura, sin modificarlos', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    await openRepo(server, 'a');
    server.externalSave(orgId, { ...server.workspaces.get(orgId).state, schemaVersion: CURRENT_SCHEMA_VERSION + 5 });
    const before = serverText(server, orgId);
    const { repo, init } = await openRepo(server, 'a');
    assert.equal(init.status, 'read_only');
    await assert.rejects(repo.saveQuote(quote(orgId, { name: 'X' })), (e) => e.code === 'read_only');
    assert.equal(serverText(server, orgId), before);
  });
});

describe('sesión y acceso', () => {
  test('miembro quitado de la empresa: el guardado avisa que perdió el acceso, no reintenta y no pierde el cambio', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    server.members.push({ organization_id: orgId, user_id: 'm', role: 'ESTIMATOR' });
    const cache = new SpyStorage();
    const { repo } = await openRepo(server, 'm', { cache });
    server.members.splice(server.members.findIndex((x) => x.user_id === 'm'), 1);
    await assert.rejects(repo.saveQuote(quote(orgId, { name: 'Sin acceso' })), (e) => e.code === ACCESS_LOST_CODE && /Ya no tenés acceso/.test(e.message));
    assert.equal(repo.getSyncState().code, ACCESS_LOST_CODE);
    assert.equal(repo.retryTimer, null, 'no se reintenta en loop');
    assert.match(cache.getItem(repo.cacheKey), /Sin acceso/, 'el cambio sigue en el navegador');
    assert.ok(!serverText(server, orgId).includes('Sin acceso'));
    await assert.rejects(createAccountContext({ user: { id: 'm', email: 'm@example.com', fullName: '' }, workspaceGateway: server.gatewayFor('m'), cacheStorage: cache }), (e) => e.code === 'not_found');
  });

  test('otra persona en el mismo navegador no retoma ni ve los cambios sin subir ni las copias de la anterior', async () => {
    const server = createFakeServer();
    const orgA = server.addUser({ id: 'a' });
    const orgB = server.addUser({ id: 'b' });
    const cache = new SpyStorage();
    const a = await openRepo(server, 'a', { cache });
    server.failNext = 'network';
    await assert.rejects(a.repo.saveQuote(quote(orgA, { name: 'Sin subir de A' })));
    a.repo.dispose(); // cierre de sesión
    const b = await openRepo(server, 'b', { cache });
    assert.equal(b.init.resumed, false);
    assert.deepEqual(await b.repo.getQuotes(), []);
    assert.deepEqual(b.repo.listRecoverySnapshots(), []);
    assert.ok(!serverText(server, orgB).includes('Sin subir de A'));
    assert.match(cache.getItem(a.repo.cacheKey), /Sin subir de A/, 'los cambios de A siguen para cuando A vuelva');
  });
});

describe('memoria de la pestaña atada a la cuenta (borradores y preferencias de pantalla)', () => {
  const ctxOf = (user, org) => ({ mode: 'cloud', account: { user: { id: user }, organization: { id: org } } });

  test('un borrador no guardado de la cuenta A nunca aparece en la cuenta B, aunque el id coincida', () => {
    const drafts = createDraftStore();
    const a = ctxOf('u-a', 'org-a');
    const b = ctxOf('u-b', 'org-b');
    drafts.set(a, 'q-1', { name: 'Borrador de A' });
    assert.equal(drafts.get(b, 'q-1'), undefined);
    assert.equal(drafts.get(ctxOf('u-a', 'org-b'), 'q-1'), undefined, 'la misma persona en otra empresa tampoco');
    assert.deepEqual(drafts.get(a, 'q-1'), { name: 'Borrador de A' }, 'la misma cuenta lo recupera al volver');
    assert.equal(drafts.get({ mode: 'demo' }, 'q-1'), undefined, 'ni la demo');
    drafts.delete(a, 'q-1');
    assert.equal(drafts.size, 0);
  });

  test('sessionOwner distingue cuentas, empresas y la demo', () => {
    assert.notEqual(sessionOwner(ctxOf('u', 'o1')), sessionOwner(ctxOf('u', 'o2')));
    assert.equal(sessionOwner({ mode: 'demo' }), 'demo');
    assert.equal(sessionOwner(null), 'none');
  });

  test('resetSessionMemory borra lo registrado aunque una vista falle', () => {
    const memory = new Map([['q-1', { margin: 5 }]]);
    const offA = onSessionReset(() => {
      throw new Error('vista con error');
    });
    const offB = onSessionReset(() => memory.clear());
    resetSessionMemory();
    assert.equal(memory.size, 0);
    offA();
    offB();
  });
});

describe('datos del modo local anterior: una vez importados a una cuenta, no se ofrecen a otra', () => {
  function legacyState() {
    const s = createDemoState(CURRENT_SCHEMA_VERSION);
    s.quotes.push({ ...createEmptyQuote({ organizationId: s.organization.id }), id: 'q-local', code: 'COT-0003', name: 'Cotización local real', illustrative: false });
    return s;
  }

  test('A los importa → B (mismo navegador) no los ve ni los puede importar; rateos.state sigue intacto', async () => {
    const original = JSON.stringify(legacyState());
    const storage = new SpyStorage({ 'rateos.state': original });
    const server = createFakeServer();
    server.addUser({ id: 'a' });
    const orgB = server.addUser({ id: 'b' });
    const a = await createAccountContext({ user: { id: 'a', email: 'a@example.com', fullName: '' }, workspaceGateway: server.gatewayFor('a'), cacheStorage: storage });
    assert.equal(a.localImport.inspect().available, true);
    assert.equal((await a.localImport.importToAccount()).ok, true);
    assert.equal(isLegacyDataClaimed(original, { storage }), true);
    a.dispose();
    const b = await createAccountContext({ user: { id: 'b', email: 'b@example.com', fullName: '' }, workspaceGateway: server.gatewayFor('b'), cacheStorage: storage });
    assert.deepEqual(b.localImport.inspect(), { available: false, counts: null });
    const res = await b.localImport.importToAccount();
    assert.equal(res.ok, false);
    assert.ok(!JSON.stringify(server.workspaces.get(orgB).state).includes('Cotización local real'));
    assert.equal(storage.getItem('rateos.state'), original, 'nunca se borra');
    const claim = storage.getItem('rateos.cloud.local-import.claimed');
    assert.ok(!claim.includes('Cotización') && !claim.includes('"a"'), 'la marca no guarda datos ni ids');
    b.dispose();
  });

  test('la huella cambia si el texto cambia (datos locales distintos se vuelven a ofrecer)', () => {
    assert.equal(legacyFingerprint('{"a":1}'), legacyFingerprint('{"a":1}'));
    assert.notEqual(legacyFingerprint('{"a":1}'), legacyFingerprint('{"a":2}'));
  });
});

describe('copias de recuperación: los cambios que nunca llegaron a la nube tienen su propio cupo', () => {
  test('importar varias veces no borra la copia de cambios sin subir', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const cache = new SpyStorage();
    const t1 = await openRepo(server, 'a', { cache, tabId: 'tab-1' });
    server.failNext = 'network';
    await assert.rejects(t1.repo.saveQuote(quote(orgId, { name: 'Única copia de esto' })));
    server.externalSave(orgId, server.workspaces.get(orgId).state);
    let n = 0;
    const tick = () => `2026-10-17T11:00:0${n++}.000Z`;
    const t2 = await openRepo(server, 'a', { cache, tabId: 'tab-2', now: tick });
    assert.ok(t2.repo.listRecoverySnapshots().some((k) => k.endsWith('.cloud-unsynced')));
    for (let i = 0; i < 4; i += 1) await t2.repo.importBackup(createDemoState(CURRENT_SCHEMA_VERSION));
    const keys = t2.repo.listRecoverySnapshots();
    assert.equal(keys.filter((k) => k.endsWith('.before-import')).length, 3, 'las de importar rotan entre ellas');
    assert.match(snapshotsText(t2.repo), /Única copia de esto/, 'la de cambios sin subir sigue');
  });
});
