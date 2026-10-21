/**
 * Créditos de prueba en el cliente (PLAN-2026-029), con el servidor falso que
 * imita el trigger de cobro de la base (tests/helpers/fake-supabase.js). La
 * autoridad real es Postgres (supabase/tests/credits_reports_test.sql); acá se
 * prueba que el cliente nunca pierda datos, no reintente para siempre, no deje
 * un código COT-NNNN consumido y no cobre lo que no corresponde.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseRepository, CREDITS_EXHAUSTED_MESSAGE, cloudCalculationIndex } from '../../js/data/supabase-repository.js';
import { workspaceErrorCode, creditsDetail, WORKSPACE_ERRORS } from '../../js/data/workspace-gateway.js';
import { createQuoteService } from '../../js/services/quote-service.js';
import { createProductService } from '../../js/services/product-service.js';
import { DEMO_IDS } from '../../js/domain/demo-data.js';
import { createFakeServer, SpyStorage } from '../helpers/fake-supabase.js';

let timersSet = 0;
const noTimers = { setTimeout: () => { timersSet += 1; return 1; }, clearTimeout: () => {} };

async function open(server, userId) {
  const gw = server.gatewayFor(userId);
  const m = await gw.loadMembership(userId);
  const cache = new SpyStorage();
  const repo = new SupabaseRepository({ gateway: gw, organization: m.organization, userId, role: m.role, cacheStorage: cache, timers: noTimers });
  await repo.init();
  let n = 0;
  return {
    repo,
    gw,
    cache,
    orgId: m.organization.id,
    quotes: createQuoteService({ repository: repo, idFactory: () => `q-${userId}-${(n += 1)}` }),
    products: createProductService({ repository: repo, idFactory: () => `p-${userId}-${(n += 1)}` }),
  };
}

const serverQuotes = (server, orgId) => (server.workspaces.get(orgId).state.quotes || []).map((q) => q.id);
const recoveryKeys = (cache) => [...cache.map.keys()].filter((k) => k.includes('.recovery.'));

describe('créditos: errores de la base', () => {
  test('el rechazo por créditos y por ids inválidos tiene su propio código (no "unknown", que se reintenta)', () => {
    assert.equal(workspaceErrorCode({ code: 'P0001', message: 'rateos_credits_exhausted', details: '{"needed":1,"balance":0}' }), WORKSPACE_ERRORS.creditsExhausted);
    assert.equal(workspaceErrorCode({ code: 'P0001', message: 'rateos_invalid_calculations' }), WORKSPACE_ERRORS.invalidCalculations);
    assert.deepEqual(creditsDetail({ details: '{"needed":3,"balance":1}' }), { needed: 3, balance: 1 });
    assert.equal(creditsDetail({ details: 'texto' }), null);
    assert.equal(workspaceErrorCode({ code: 'P0001', message: 'otra cosa' }), WORKSPACE_ERRORS.unknown);
  });

  test('índice de lo que la nube ya aceptó', () => {
    const idx = cloudCalculationIndex({ quotes: [{ id: 'a' }, { id: 'b' }, null], products: [{ id: 'p' }], settings: { lastQuoteNumber: 7 } });
    assert.deepEqual([...idx.quotes], ['a', 'b']);
    assert.deepEqual([...idx.products], ['p']);
    assert.equal(idx.lastQuoteNumber, 7);
    assert.equal(cloudCalculationIndex(null).lastQuoteNumber, 0);
  });
});

describe('créditos: crear con saldo y sin saldo', () => {
  test('cada cotización nueva es UNA escritura (código + cotización juntos) y usa 1 crédito', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a', company: 'Tester A' });
    const acct = server.enableCredits(orgId, 2);
    const { quotes, gw } = await open(server, 'a');
    const before = gw.calls.length;
    const q1 = await quotes.createQuote();
    assert.equal(gw.calls.length - before, 1, 'una sola subida por creación (antes eran dos: la reserva del código y la cotización)');
    const q2 = await quotes.duplicateQuote(q1.id);
    assert.equal(q1.code, 'COT-0001');
    assert.equal(q2.code, 'COT-0002');
    assert.equal(acct.balance, 0);
    assert.deepEqual(serverQuotes(server, orgId), [q1.id, q2.id]);
    assert.equal(server.workspaces.get(orgId).state.settings.lastQuoteNumber, 2);
  });

  test('sin saldo: la creación se rechaza con el mensaje del dueño, no queda a medias, no se reintenta y no se pierde nada', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    server.enableCredits(orgId, 1);
    const { repo, quotes, cache } = await open(server, 'a');
    const q1 = await quotes.createQuote();
    const timersBefore = timersSet;
    await assert.rejects(quotes.createQuote(), (error) => {
      assert.equal(error.code, 'credits_exhausted');
      assert.equal(error.message, CREDITS_EXHAUSTED_MESSAGE);
      assert.equal(error.message, 'Se agotaron tus cálculos de prueba; podés seguir trabajando con los que ya tenés y enviarnos feedback.');
      assert.equal(error.removed, 1);
      return true;
    });
    // Nada a medias: ni la cotización ni el código consumido, en la nube ni en el navegador.
    assert.deepEqual(serverQuotes(server, orgId), [q1.id]);
    assert.deepEqual((await repo.getQuotes()).map((q) => q.id), [q1.id]);
    assert.equal((await repo.getSettings()).lastQuoteNumber, 1);
    assert.equal(server.workspaces.get(orgId).state.settings.lastQuoteNumber, 1);
    // Sin reintentos automáticos y sin cambios pendientes trabados.
    assert.equal(timersSet, timersBefore);
    assert.equal(repo.getSyncState().dirty, false);
    assert.equal(repo.getSyncState().status, 'saved');
    // Lo rechazado quedó en una copia de recuperación.
    const copies = recoveryKeys(cache).map((k) => cache.getItem(k));
    assert.ok(copies.some((text) => text.includes('credits-exhausted') || text.includes('COT-0002')), 'hay una copia con la cotización rechazada');
    // El código siguiente sigue la secuencia (no saltea el que se rechazó).
    server.credits.get(orgId).balance = 1;
    assert.equal((await quotes.createQuote()).code, 'COT-0002');
  });

  test('sin saldo se sigue editando, guardando, borrando y restaurando lo existente', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const acct = server.enableCredits(orgId, 2);
    const { repo, quotes } = await open(server, 'a');
    const q1 = await quotes.createQuote();
    const q2 = await quotes.createQuote();
    assert.equal(acct.balance, 0);
    await quotes.saveQuote({ ...(await repo.getQuote(q1.id)), name: 'Editada sin saldo', days: 20 });
    assert.equal(server.workspaces.get(orgId).state.quotes.find((q) => q.id === q1.id).name, 'Editada sin saldo');
    const backup = await repo.getQuote(q2.id);
    await quotes.deleteQuote(q2.id);
    assert.deepEqual(serverQuotes(server, orgId), [q1.id]);
    await repo.saveQuote(backup); // restaurar el mismo id: no cobra
    assert.deepEqual(serverQuotes(server, orgId).sort(), [q1.id, q2.id].sort());
    assert.equal(acct.balance, 0);
  });

  test('un cambio sin subir de antes se guarda aunque la creación nueva se rechace', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    server.enableCredits(orgId, 1);
    const { repo, quotes } = await open(server, 'a');
    const q1 = await quotes.createQuote();
    server.failNext = 'network';
    await assert.rejects(quotes.saveQuote({ ...(await repo.getQuote(q1.id)), name: 'Editada sin conexión' }));
    assert.equal(repo.getSyncState().dirty, true);
    server.credits.get(orgId).balance = 0;
    await assert.rejects(quotes.createQuote(), (e) => e.code === 'credits_exhausted');
    const saved = server.workspaces.get(orgId).state.quotes;
    assert.deepEqual(saved.map((q) => q.id), [q1.id]);
    assert.equal(saved[0].name, 'Editada sin conexión', 'la edición pendiente subió');
    assert.equal(repo.getSyncState().dirty, false);
  });

  test('restaurar un respaldo propio no cobra; uno con cálculos que la empresa nunca tuvo, sin saldo, se rechaza sin perder nada', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const acct = server.enableCredits(orgId, 2);
    const { repo, quotes, cache } = await open(server, 'a');
    await quotes.createQuote();
    await quotes.createQuote();
    const own = await repo.exportBackup();
    await repo.importBackup(own);
    assert.equal(acct.balance, 0, 'restaurar lo propio no cobró');
    const foreign = JSON.parse(JSON.stringify(own));
    foreign.quotes.push({ ...foreign.quotes[0], id: 'otra-empresa-1', code: 'COT-0099' });
    await assert.rejects(repo.importBackup(foreign), (e) => e.code === 'credits_exhausted');
    assert.equal(serverQuotes(server, orgId).length, 2);
    assert.ok(!serverQuotes(server, orgId).includes('otra-empresa-1'));
    assert.ok(recoveryKeys(cache).length >= 1, 'el respaldo rechazado quedó en una copia de recuperación');
  });

  test('ids repetidos o ausentes: la validación local ya los rechaza, y si la base los rechaza, error propio sin reintento ni pérdida', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    server.enableCredits(orgId, 5);
    const { repo, quotes } = await open(server, 'a');
    assert.throws(() => repo.mutate((draft) => {
      draft.quotes.push({ id: 'x', name: 'uno' }, { id: 'x', name: 'dos' });
    }), /id duplicado/);
    const timersBefore = timersSet;
    server.failNext = 'invalid_calculations';
    await assert.rejects(quotes.createQuote(), (e) => e.code === 'invalid_calculations');
    assert.equal(timersSet, timersBefore);
    assert.equal(repo.getSyncState().dirty, true, 'los cambios siguen en el navegador');
    assert.equal(repo.getSyncState().code, 'invalid_calculations');
  });
});

describe('créditos: productos y el ejemplo', () => {
  test('el ejemplo "Chipá" usa un id fijo, no cobra y hay uno solo', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const acct = server.enableCredits(orgId, 0);
    const { repo, products } = await open(server, 'a');
    const ex1 = await products.createProduct({ example: true });
    const ex2 = await products.createProduct({ example: true });
    assert.equal(ex1.id, DEMO_IDS.productExample);
    assert.equal(ex2.id, ex1.id, 'el segundo "Ver un ejemplo" abre el mismo');
    assert.equal((await repo.getProducts()).length, 1);
    assert.equal(acct.balance, 0);
    assert.deepEqual(server.workspaces.get(orgId).state.products.map((p) => p.id), [DEMO_IDS.productExample]);
  });

  test('producto en blanco y duplicado del ejemplo usan 1 crédito cada uno; sin saldo se rechazan', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const acct = server.enableCredits(orgId, 1);
    const { repo, products } = await open(server, 'a');
    const ex = await products.createProduct({ example: true });
    const copy = await products.duplicateProduct(ex.id);
    assert.notEqual(copy.id, ex.id);
    assert.equal(acct.balance, 0);
    await assert.rejects(products.createProduct(), (e) => e.code === 'credits_exhausted');
    assert.deepEqual((await repo.getProducts()).map((p) => p.id).sort(), [ex.id, copy.id].sort());
  });

  test('una empresa sin cuota (las que ya existían) no tiene límite', async () => {
    const server = createFakeServer();
    const orgId = server.addUser({ id: 'a' });
    const { quotes } = await open(server, 'a');
    for (let i = 0; i < 15; i += 1) await quotes.createQuote();
    assert.equal(serverQuotes(server, orgId).length, 15);
  });
});
