/**
 * Migración de datos del modo local (rateos.state) a la cuenta:
 * nunca la demo, nunca automática, nunca borra el original.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractRealData } from '../../js/domain/real-data.js';
import { readLegacyLocalData } from '../../js/data/legacy-local.js';
import { createAccountContext } from '../../js/services/app-context.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { CURRENT_SCHEMA_VERSION } from '../../js/data/schema.js';
import { createFakeServer, SpyStorage } from '../helpers/fake-supabase.js';

function demoWithOwnData() {
  const s = createDemoState(CURRENT_SCHEMA_VERSION);
  s.quotes.push({ ...createEmptyQuote({ organizationId: s.organization.id }), id: 'q-mia', code: 'COT-0003', name: 'Mi cotización real', illustrative: false });
  s.resources.equipment.push({ id: 'eq-mio', organizationId: s.organization.id, name: 'Mi camión', illustrative: false, createdAt: s.organization.createdAt, updatedAt: s.organization.createdAt });
  return s;
}

describe('datos reales del modo local', () => {
  test('la demo pura no tiene datos reales (no se ofrece importar)', () => {
    const real = extractRealData(createDemoState(CURRENT_SCHEMA_VERSION));
    assert.equal(real.hasRealData, false);
    assert.deepEqual([real.counts.quotes, real.counts.resources, real.counts.services], [0, 0, 0]);
    assert.equal(real.counts.organization, false, 'Patagonia Servicios SRL nunca es "real"');
  });

  test('de una mezcla, sólo quedan los datos propios', () => {
    const real = extractRealData(demoWithOwnData());
    assert.equal(real.hasRealData, true);
    assert.deepEqual(real.data.quotes.map((q) => q.name), ['Mi cotización real']);
    assert.deepEqual(real.data.resources.equipment.map((e) => e.name), ['Mi camión']);
    assert.ok(!JSON.stringify(real.data).includes('Patagonia Servicios SRL'));
    assert.equal(real.data.settings, null, 'la configuración de demostración no se importa');
  });

  test('leer rateos.state nunca escribe ni borra nada', () => {
    const storage = new SpyStorage({ 'rateos.state': JSON.stringify(demoWithOwnData()) });
    const before = storage.getItem('rateos.state');
    const { real } = readLegacyLocalData({ storage });
    assert.equal(real.counts.quotes, 1);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem('rateos.state'), before);
  });

  test('datos v1 se migran en memoria antes de filtrar', () => {
    const s = demoWithOwnData();
    s.schemaVersion = 1;
    s.quotes.forEach((q) => delete q.billingTaxes);
    delete s.settings.defaultBillingTaxes;
    const storage = new SpyStorage({ 'rateos.state': JSON.stringify(s) });
    const { real } = readLegacyLocalData({ storage });
    assert.equal(real.hasRealData, true);
    assert.equal(real.data.quotes[0].vatTreatment, 'excluded');
  });
});

describe('importar a la cuenta', () => {
  async function account(storage) {
    const server = createFakeServer();
    server.addUser({ id: 'a', company: 'Mi Empresa Real' });
    const ctx = await createAccountContext({ user: { id: 'a', email: 'a@example.com', fullName: 'A' }, workspaceGateway: server.gatewayFor('a'), cacheStorage: storage });
    return { ctx, server };
  }

  test('ofrece importar sólo si hay datos reales; "Empezar en limpio" no vuelve a preguntar', async () => {
    const storage = new SpyStorage({ 'rateos.state': JSON.stringify(demoWithOwnData()) });
    const { ctx } = await account(storage);
    const info = ctx.localImport.inspect();
    assert.equal(info.available, true);
    assert.equal(info.counts.quotes, 1);
    ctx.localImport.skip();
    assert.equal(ctx.localImport.inspect().available, false);
    assert.deepEqual(await ctx.quotes.listQuotes(), [], 'empezar en limpio no importa nada');
    assert.ok(storage.getItem('rateos.state'), 'los datos locales siguen intactos');
  });

  test('con sólo la demo guardada no se ofrece nada', async () => {
    const storage = new SpyStorage({ 'rateos.state': JSON.stringify(createDemoState(CURRENT_SCHEMA_VERSION)) });
    const { ctx } = await account(storage);
    assert.equal(ctx.localImport.inspect().available, false);
  });

  test('importar: copia de seguridad previa, sin demo, en la nube y rateos.state intacto', async () => {
    const original = JSON.stringify(demoWithOwnData());
    const storage = new SpyStorage({ 'rateos.state': original });
    const { ctx, server } = await account(storage);
    const res = await ctx.localImport.importToAccount();
    assert.equal(res.ok, true);
    assert.equal(res.quotes, 1);
    assert.ok(storage.getItem(res.backupKey) === original, 'copia del texto local antes de importar');
    assert.ok(res.backupKey.startsWith('rateos.cloud.a.') && res.backupKey.includes('.recovery.'), 'la copia es de la cuenta que importa');
    assert.ok(ctx.repository.listRecoverySnapshots().includes(res.backupKey), 'y aparece en sus copias (Configuración → Datos y backup)');
    const names = (await ctx.quotes.listQuotes()).map((i) => i.quote.name);
    assert.deepEqual(names, ['Mi cotización real']);
    const cloud = JSON.stringify([...server.workspaces.values()][0].state);
    assert.ok(cloud.includes('Mi cotización real'));
    assert.ok(!cloud.includes('Patagonia Servicios SRL'), 'la empresa ficticia nunca llega a la cuenta');
    assert.ok(!cloud.includes('Hidrogrúa on-call — Añelo'));
    assert.equal((await ctx.settings.getOrganization()).name, 'Mi Empresa Real');
    assert.equal(storage.getItem('rateos.state'), original);
    assert.equal(ctx.localImport.inspect().available, false);
  });

  test('importar no borra los tipos de cambio ni la fecha base del combustible que ya tiene la cuenta (PLAN-2026-005)', async () => {
    const local = demoWithOwnData();
    local.settings = { ...local.settings, illustrative: false, exchangeRates: [{ currency: 'EUR', rate: 1300, base: { period: '2026-08', currency: 'ARS', source: null, note: '' } }], fuelPriceBase: { period: null, currency: 'ARS', source: null, note: '' } };
    const storage = new SpyStorage({ 'rateos.state': JSON.stringify(local) });
    const { ctx } = await account(storage);
    await ctx.settings.save({
      exchangeRates: [{ currency: 'USD', rate: 1200, base: { period: '2026-09', currency: 'ARS', source: null, note: '' } }],
      fuelPriceBase: { period: '2026-09', currency: 'ARS', source: 'supplier', note: '' },
    });
    const res = await ctx.localImport.importToAccount();
    assert.equal(res.ok, true);
    const settings = await ctx.settings.get();
    assert.deepEqual(settings.exchangeRates.map((r) => [r.currency, r.rate]), [['USD', 1200], ['EUR', 1300]], 'se suman por moneda; la cuenta manda');
    assert.equal(settings.fuelPriceBase.period, '2026-09', 'una base vacía no pisa la de la cuenta');
  });
});
