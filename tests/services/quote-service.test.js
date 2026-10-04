/**
 * Tests de QuoteService (casos de uso de cotizaciones) sobre el repositorio
 * real con MemoryStorage.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createQuoteService } from '../../js/services/quote-service.js';
import { createAppContext } from '../../js/services/app-context.js';
import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { createEmptyState } from '../../js/data/schema.js';
import { DEMO_IDS, DEMO_ORG_ID } from '../../js/domain/demo-data.js';
import { isUuid } from '../../js/core/ids.js';
import { isFiniteNumber } from '../../js/core/money.js';
import { configureLogger } from '../../js/core/logger.js';
import { addEventSink } from '../../js/core/events.js';

configureLogger({ consoleImpl: null });

function createClock(startMs = Date.UTC(2026, 9, 3, 10, 0, 0)) {
  let t = startMs;
  const now = () => new Date(t).toISOString();
  now.advance = (ms = 1000) => {
    t += ms;
    return now();
  };
  return now;
}

const EMPTY_ORG = { id: '22222222-2222-4222-8222-222222222222', name: 'Empresa Vacía SRL', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdBy: null, updatedBy: null };

async function setup({ empty = false } = {}) {
  const clock = createClock();
  const storage = new MemoryStorage();
  const repository = new LocalStorageRepository(storage, {
    now: clock,
    ...(empty ? { seedFactory: () => createEmptyState({ ...EMPTY_ORG }) } : {}),
  });
  await repository.init();
  const service = createQuoteService({ repository, clock });
  return { service, repository, storage, clock };
}

function captureEvents() {
  const events = [];
  const remove = addEventSink((e) => events.push(e), { force: true });
  return { events, remove };
}

/** Recorre un objeto y devuelve las rutas con NaN/Infinity. */
function nonFinitePaths(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => nonFinitePaths(v, path ? `${path}.${k}` : k));
  }
  return [];
}

// ============================================================ createQuote

describe('QuoteService.createQuote', () => {
  test('genera códigos COT-0001, COT-0002, COT-0003… incrementales', async () => {
    const { service } = await setup({ empty: true });
    const codes = [];
    for (let i = 0; i < 3; i += 1) codes.push((await service.createQuote()).code);
    assert.deepEqual(codes, ['COT-0001', 'COT-0002', 'COT-0003']);
  });

  test('con la demo (COT-0001 y COT-0002) la siguiente es COT-0003', async () => {
    const { service } = await setup();
    assert.equal((await service.createQuote()).code, 'COT-0003');
    assert.equal((await service.createQuote()).code, 'COT-0004');
  });

  test('el código sigue al mayor existente e ignora códigos con otro formato', async () => {
    const { service, repository } = await setup({ empty: true });
    await repository.saveQuote({ name: 'a', code: 'COT-0041' });
    await repository.saveQuote({ name: 'b', code: 'PRESUP-99' });
    await repository.saveQuote({ name: 'c', code: 'COT-9999x' });
    await repository.saveQuote({ name: 'd' });
    assert.equal((await service.createQuote()).code, 'COT-0042');
  });

  test('cotización en blanco: borrador con metadatos completos y persistida', async () => {
    const { service, repository, clock } = await setup();
    const quote = await service.createQuote();
    assert.ok(isUuid(quote.id));
    assert.equal(quote.organizationId, DEMO_ORG_ID);
    assert.equal(quote.status, 'draft');
    assert.equal(quote.templateId, null);
    assert.equal(quote.createdAt, clock());
    assert.equal(quote.updatedAt, clock());
    assert.ok('createdBy' in quote && 'updatedBy' in quote);
    assert.deepEqual(await repository.getQuote(quote.id), quote);
  });

  test('cotización en blanco toma valores por defecto de la configuración', async () => {
    const { service, repository } = await setup();
    await repository.saveSettings({ fuelPricePerLiter: 2222, defaultTargetMarginPct: 17 });
    const quote = await service.createQuote();
    assert.equal(quote.fuel.pricePerLiter, 2222);
    assert.equal(quote.pricing.targetMarginPct, 17);
  });

  test('desde plantilla: copia la plantilla con ids nuevos en todas las líneas', async () => {
    const { service, repository } = await setup();
    const servicesBefore = await repository.getServices();
    const template = servicesBefore.find((s) => s.id === DEMO_IDS.templateHydroCrane);

    const quote = await service.createQuote({ templateId: DEMO_IDS.templateHydroCrane });
    assert.equal(quote.templateId, DEMO_IDS.templateHydroCrane);
    assert.equal(quote.serviceType, 'on_call');
    assert.equal(quote.name, 'Hidrogrúa on-call');
    assert.equal(quote.status, 'draft');
    assert.equal(quote.code, 'COT-0003');
    assert.equal(quote.organizationId, DEMO_ORG_ID);
    assert.equal(quote.illustrative, false);

    // Contenido copiado de la plantilla.
    assert.deepEqual(quote.activity, { ...template.defaults.activity });
    assert.equal(quote.labor.length, template.defaults.labor.length);
    assert.equal(quote.equipment.length, template.defaults.equipment.length);
    assert.equal(quote.materials.length, template.defaults.materials.length);
    assert.equal(quote.logistics.vehicles.length, template.defaults.logistics.vehicles.length);
    // Las líneas copiadas de una plantilla ILUSTRATIVA siguen marcadas como ilustrativas.
    for (const line of [...quote.labor, ...quote.equipment, ...quote.materials, ...quote.logistics.vehicles]) {
      assert.equal(line.illustrative, true, 'línea copiada de plantilla demo marcada ILUSTRATIVA');
    }
    const strip = ({ id, illustrative, ...rest }) => rest;
    assert.deepEqual(quote.labor.map(strip), template.defaults.labor.map(strip));
    assert.deepEqual(quote.equipment.map(strip), template.defaults.equipment.map(strip));
    assert.deepEqual(quote.pricing, template.defaults.pricing);

    // Ids nuevos, únicos y distintos de los de la plantilla.
    const templateIds = new Set(
      ['labor', 'equipment', 'materials', 'otherCosts']
        .flatMap((k) => template.defaults[k] || [])
        .concat(template.defaults.logistics.vehicles)
        .map((l) => l.id),
    );
    const newIds = ['labor', 'equipment', 'materials', 'otherCosts'].flatMap((k) => quote[k]).concat(quote.logistics.vehicles).map((l) => l.id);
    assert.ok(newIds.length > 0);
    assert.ok(newIds.every((id) => isUuid(id) && !templateIds.has(id)), 'ids nuevos');
    assert.equal(new Set(newIds).size, newIds.length, 'ids únicos');
    assert.notEqual(quote.id, template.id);

    assert.deepEqual(await repository.getServices(), servicesBefore, 'la plantilla no se modifica');
  });

  test('dos cotizaciones de la misma plantilla no comparten ids de líneas', async () => {
    const { service } = await setup();
    const a = await service.createQuote({ templateId: DEMO_IDS.templateHydroCrane });
    const b = await service.createQuote({ templateId: DEMO_IDS.templateHydroCrane });
    const ids = (q) => q.labor.concat(q.equipment, q.materials).map((l) => l.id);
    assert.equal(ids(a).some((id) => ids(b).includes(id)), false);
  });

  test('plantilla inexistente → cotización en blanco', async () => {
    const { service } = await setup();
    const quote = await service.createQuote({ templateId: 'no-existe' });
    assert.equal(quote.templateId, null);
    assert.deepEqual(quote.labor, []);
  });

  test('emite quote_created sin datos sensibles', async () => {
    const { events, remove } = captureEvents();
    try {
      const { service } = await setup();
      await service.createQuote({ templateId: DEMO_IDS.templateHydroCrane });
      await service.createQuote();
    } finally {
      remove();
    }
    const created = events.filter((e) => e.name === 'quote_created');
    assert.deepEqual(created.map((e) => e.props), [
      { serviceType: 'on_call', source: 'template' },
      { serviceType: 'on_call', source: 'blank' },
    ]);
  });
});

// ======================================================= duplicate / delete

describe('QuoteService.duplicateQuote / deleteQuote / saveQuote', () => {
  test('duplicateQuote crea una copia en borrador con id y código nuevos', async () => {
    const { service, repository, clock } = await setup();
    await repository.updateQuote(DEMO_IDS.quoteHydroCrane, { status: 'sent' });
    const original = await repository.getQuote(DEMO_IDS.quoteHydroCrane);
    const t = clock.advance(3600_000);

    const copy = await service.duplicateQuote(DEMO_IDS.quoteHydroCrane);
    assert.ok(isUuid(copy.id));
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.code, 'COT-0003');
    assert.equal(copy.name, `${original.name} (copia)`);
    assert.equal(copy.status, 'draft');
    assert.equal(copy.createdAt, t);
    assert.equal(copy.updatedAt, t);
    assert.equal(copy.organizationId, original.organizationId);
    for (const key of ['labor', 'equipment', 'materials', 'logistics', 'finance', 'pricing', 'rules', 'activity', 'risk']) {
      assert.deepEqual(copy[key], original[key], key);
    }
    assert.deepEqual(await repository.getQuote(DEMO_IDS.quoteHydroCrane), original, 'el original no cambia');
    assert.equal((await repository.getQuotes()).length, 3);
  });

  test('duplicateQuote de un id inexistente devuelve null sin guardar nada', async () => {
    const { service, repository } = await setup();
    assert.equal(await service.duplicateQuote('no-existe'), null);
    assert.equal((await repository.getQuotes()).length, 2);
  });

  test('deleteQuote borra y devuelve false si no existe', async () => {
    const { service, repository } = await setup();
    assert.equal(await service.deleteQuote(DEMO_IDS.quoteReference), true);
    assert.equal(await repository.getQuote(DEMO_IDS.quoteReference), null);
    assert.equal(await service.deleteQuote(DEMO_IDS.quoteReference), false);
  });

  test('saveQuote persiste los cambios y getQuote los devuelve', async () => {
    const { service } = await setup();
    const quote = await service.getQuote(DEMO_IDS.quoteHydroCrane);
    quote.client = 'Cliente nuevo';
    quote.pricing.customMarginPct = 15;
    await service.saveQuote(quote);
    const again = await service.getQuote(DEMO_IDS.quoteHydroCrane);
    assert.equal(again.client, 'Cliente nuevo');
    assert.equal(again.pricing.customMarginPct, 15);
  });
});

// ============================================================ listQuotes

describe('QuoteService.listQuotes', () => {
  test('ordena por updatedAt descendente (más reciente primero)', async () => {
    const { service, repository, clock } = await setup();
    clock.advance();
    const a = await service.createQuote();
    clock.advance();
    const b = await service.createQuote();
    clock.advance();
    await repository.updateQuote(DEMO_IDS.quoteReference, { client: 'tocada' });

    const list = await service.listQuotes();
    const ids = list.map((i) => i.quote.id);
    assert.deepEqual(ids, [DEMO_IDS.quoteReference, b.id, a.id, DEMO_IDS.quoteHydroCrane]);
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(String(list[i - 1].quote.updatedAt) >= String(list[i].quote.updatedAt));
    }
  });

  test('cada item trae la cotización y un resumen sin NaN/Infinity', async () => {
    const { service } = await setup();
    const list = await service.listQuotes();
    assert.equal(list.length, 2);
    for (const item of list) {
      assert.ok(item.quote && item.summary);
      assert.deepEqual(nonFinitePaths(item.summary), [], item.quote.name);
      assert.equal(typeof item.summary.atRisk, 'boolean');
      assert.equal(typeof item.summary.belowFloor, 'boolean');
    }
  });

  test('con una cotización en blanco el resumen no rompe ni produce NaN', async () => {
    const { service } = await setup({ empty: true });
    await service.createQuote();
    const [item] = await service.listQuotes();
    assert.deepEqual(nonFinitePaths(item.summary), []);
  });
});

// ======================================================== dashboardStats

describe('QuoteService.dashboardStats', () => {
  test('con la demo: 2 activas, 1 en riesgo y 1 bajo piso (el caso de referencia)', async () => {
    const { service } = await setup();
    const stats = await service.dashboardStats();
    assert.equal(stats.totalCount, 2);
    assert.equal(stats.activeCount, 2);
    assert.equal(stats.atRiskCount, 1);
    assert.equal(stats.belowFloorCount, 1);
    assert.ok(isFiniteNumber(stats.averageMarginPct));
    assert.ok(isFiniteNumber(stats.totalQuotedMonthly) && stats.totalQuotedMonthly > 0);

    const ref = stats.items.find((i) => i.quote.id === DEMO_IDS.quoteReference);
    assert.equal(ref.summary.belowFloor, true, 'tarifa 4.000.000 < piso con 8 días');
    assert.equal(ref.summary.atRisk, true);
    assert.equal(ref.summary.breakEvenDays, 10, 'golden case: break-even 10 días');
    const hydro = stats.items.find((i) => i.quote.id === DEMO_IDS.quoteHydroCrane);
    assert.equal(hydro.summary.belowFloor, false);
  });

  test('cotizaciones perdidas o archivadas no cuentan como activas', async () => {
    const { service, repository } = await setup();
    await repository.updateQuote(DEMO_IDS.quoteReference, { status: 'archived' });
    let stats = await service.dashboardStats();
    assert.equal(stats.totalCount, 2);
    assert.equal(stats.activeCount, 1);
    assert.equal(stats.belowFloorCount, 0);
    assert.equal(stats.atRiskCount, 0);

    await repository.updateQuote(DEMO_IDS.quoteHydroCrane, { status: 'lost' });
    stats = await service.dashboardStats();
    assert.equal(stats.activeCount, 0);
    assert.equal(stats.averageMarginPct, null, 'sin activas no hay promedio (nunca NaN)');
    assert.equal(stats.totalQuotedMonthly, 0);
  });

  test('sin cotizaciones devuelve ceros y null, nunca NaN', async () => {
    const { service } = await setup({ empty: true });
    const stats = await service.dashboardStats();
    assert.deepEqual(
      { ...stats, items: undefined },
      { totalCount: 0, activeCount: 0, totalQuotedMonthly: 0, averageMarginPct: null, atRiskCount: 0, belowFloorCount: 0, items: undefined },
    );
  });
});

// ================================================================ compute

describe('QuoteService.compute', () => {
  test('calcula con la configuración vigente y sin NaN en los KPIs', async () => {
    const { service } = await setup();
    const quote = await service.getQuote(DEMO_IDS.quoteHydroCrane);
    const result = await service.compute(quote);
    assert.ok(result && result.kpis);
    assert.deepEqual(nonFinitePaths(result.kpis), []);
    assert.ok(result.kpis.totalCost > 0);
  });
});

// ================================================= origen de los viajes

describe('createQuote: base operativa como origen de los viajes', () => {
  test('una cotización nueva toma la base operativa de la empresa como origen', async () => {
    const { service, repository } = await setup();
    await repository.saveOrganization({ baseLocation: '  Añelo  ' });
    const blank = await service.createQuote();
    assert.equal(blank.logistics.baseName, 'Añelo');
    // Una plantilla que define su propio origen lo conserva (es más específica).
    const template = (await repository.getServices()).find((t) => t.id === DEMO_IDS.templateHydroCrane);
    const fromTemplate = await service.createQuote({ templateId: template.id });
    assert.equal(fromTemplate.logistics.baseName, template.defaults.logistics.baseName);
    // Una plantilla sin origen toma la base operativa.
    const noBase = (await repository.getServices()).find((t) => !(t.defaults && t.defaults.logistics && t.defaults.logistics.baseName));
    if (noBase) assert.equal((await service.createQuote({ templateId: noBase.id })).logistics.baseName, 'Añelo');
  });

  test('sin base operativa el origen queda vacío (no cambia ningún cálculo)', async () => {
    const { service } = await setup({ empty: true });
    const q = await service.createQuote();
    assert.equal(q.logistics.baseName, '');
  });
});

// ============================================================ demo guiada

describe('ensureDemoQuote / latestDraft', () => {
  test('devuelve la cotización demo existente sin modificarla', async () => {
    const { service, repository } = await setup();
    const before = await repository.getQuote(DEMO_IDS.quoteHydroCrane);
    const demo = await service.ensureDemoQuote();
    assert.equal(demo.id, DEMO_IDS.quoteHydroCrane);
    assert.deepEqual(demo, before);
    assert.equal((await repository.getQuotes()).length, 2);
  });

  test('si se borró, la recrea con el mismo id, la organización actual y un código nuevo', async () => {
    const { service, repository } = await setup({ empty: true });
    const own = await service.createQuote();
    const demo = await service.ensureDemoQuote();
    assert.equal(demo.id, DEMO_IDS.quoteHydroCrane);
    assert.equal(demo.organizationId, EMPTY_ORG.id);
    assert.equal(demo.illustrative, true);
    assert.equal(demo.name, 'Hidrogrúa on-call — Añelo');
    assert.notEqual(demo.code, own.code, 'nunca reutiliza el código de otra cotización');
    assert.match(demo.code, /^COT-\d{4}$/);
    const quotes = await repository.getQuotes();
    assert.equal(quotes.length, 2);
    assert.ok(quotes.some((q) => q.id === own.id), 'no toca las otras cotizaciones');
    // Idempotente: una segunda llamada no duplica.
    await service.ensureDemoQuote();
    assert.equal((await repository.getQuotes()).length, 2);
  });

  test('la demo recreada calcula igual que la demo original (sin NaN/Infinity)', async () => {
    const { service } = await setup({ empty: true });
    const demo = await service.ensureDemoQuote();
    const result = await service.compute(demo);
    assert.deepEqual(nonFinitePaths(result.kpis), []);
    assert.ok(result.kpis.totalCost > 0);
    assert.ok(result.kpis.floorListRate > 0);
  });

  test('getDemoQuote nunca escribe: devuelve la guardada o una demo en memoria', async () => {
    const { service, repository, storage } = await setup({ empty: true });
    const raw = storage.getItem('rateos.state');
    const shown = await service.getDemoQuote();
    assert.equal(shown.stored, false);
    assert.equal(shown.quote.id, DEMO_IDS.quoteHydroCrane);
    assert.equal(shown.quote.organizationId, EMPTY_ORG.id);
    assert.equal(storage.getItem('rateos.state'), raw, 'mostrar la demo no modifica los datos');
    assert.equal((await repository.getQuotes()).length, 0);
    await service.ensureDemoQuote();
    const stored = await service.getDemoQuote();
    assert.equal(stored.stored, true);
  });

  test('latestDraft devuelve el borrador modificado más recientemente o null', async () => {
    const { service, clock } = await setup({ empty: true });
    assert.equal(await service.latestDraft(), null);
    const a = await service.createQuote();
    clock.advance(5000);
    const b = await service.createQuote();
    clock.advance(5000);
    await service.saveQuote({ ...a, name: 'Editada después' });
    const latest = await service.latestDraft();
    assert.equal(latest.quote.id, a.id);
    clock.advance(5000);
    await service.saveQuote({ ...(await service.getQuote(a.id)), status: 'won' });
    assert.equal((await service.latestDraft()).quote.id, b.id);
  });
});

// ======================================================== composition root

describe('createAppContext', () => {
  test('arma repositorio y servicios sobre el storage indicado', async () => {
    const storage = new MemoryStorage();
    const ctx = await createAppContext({ storage, appVersion: 'test' });
    assert.equal(ctx.persistent, true);
    assert.equal(ctx.init.status, 'seeded');
    for (const key of ['quotes', 'resources', 'backup', 'settings', 'auth', 'logger', 'track', 'repository']) {
      assert.ok(ctx[key], `falta ctx.${key}`);
    }
    const stats = await ctx.quotes.dashboardStats();
    assert.equal(stats.totalCount, 2);
    assert.ok(storage.getItem('rateos.state'));
  });

  test('sin storage persistente funciona en memoria (persistent=false)', async () => {
    const ctx = await createAppContext({ storage: null });
    assert.equal(ctx.persistent, false);
    assert.equal((await ctx.quotes.listQuotes()).length, 2);
  });
});
