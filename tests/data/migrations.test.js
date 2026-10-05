/**
 * Tests de migraciones de esquema (Prompt 4 §7: "Nunca borrar los datos
 * porque cambió la estructura").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { migrateState, migrateV0ToV1, migrateV1ToV2, migrateV2ToV3, MIGRATIONS, MigrationError } from '../../js/data/migrations.js';
import { CURRENT_SCHEMA_VERSION, RESOURCE_TYPES, validateState } from '../../js/data/schema.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { isUuid } from '../../js/core/ids.js';
import { computeQuote } from '../../js/engines/quote-engine.js';

const NOW = '2026-10-03T12:00:00.000Z';

/** idFactory determinística para poder verificar asignaciones. */
function sequentialIds(prefix = 'gen') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

function legacyState() {
  return {
    organization: { id: 'org-legado', name: 'Legado SRL', cuit: 'ficticio' },
    resources: {
      agreements: [{ name: 'Convenio viejo' }],
      laborProfiles: [{ id: 'lp-1', role: 'Chofer', basicMonthly: 100 }],
      equipment: [{ id: 'eq-1', name: 'Grúa', createdAt: '2019-01-01T00:00:00.000Z', organizationId: 'otra-org' }],
      materials: [],
      locations: [{ name: 'Añelo', distanceFromBaseKm: 110 }],
    },
    services: [{ name: 'Plantilla vieja' }, { serviceType: 'crew' }],
    quotes: [
      { name: 'Cotización vieja', code: 'COT-0007', pricing: { knownRate: 1500000 } },
      { id: 'q-2', name: 'Con id', updatedAt: '2021-02-02T00:00:00.000Z' },
      { id: '', code: 'sin nombre' },
    ],
    settings: { fuelPricePerLiter: 900 },
    preferenciasViejas: { tema: 'oscuro' },
    ultimaPantalla: '#/cotizaciones',
  };
}

describe('Registro de migraciones', () => {
  test('existe una migración para cada versión anterior a la actual', () => {
    for (let v = 0; v < CURRENT_SCHEMA_VERSION; v += 1) {
      assert.equal(typeof MIGRATIONS[v], 'function', `falta la migración ${v} → ${v + 1}`);
    }
    assert.equal(MIGRATIONS[0], migrateV0ToV1);
    assert.equal(MIGRATIONS[1], migrateV1ToV2);
    assert.equal(MIGRATIONS[2], migrateV2ToV3);
    assert.ok(Object.isFrozen(MIGRATIONS));
  });
});

describe('migrateState v0 → v1', () => {
  test('lleva el estado a la versión actual y el resultado es válido', () => {
    const result = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.applied, ['0→1', '1→2', '2→3']);
    assert.equal(result.state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(validateState(result.state), { ok: true, errors: [] });
  });

  test('conserva cotizaciones y recursos con todos sus campos', () => {
    const { state } = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    assert.equal(state.quotes.length, 3);
    const old = state.quotes.find((q) => q.code === 'COT-0007');
    assert.equal(old.name, 'Cotización vieja');
    assert.deepEqual(old.pricing, { knownRate: 1500000 });
    // v1 → v2: impuestos sobre la facturación sin definir (nunca inventados).
    assert.deepEqual(old.billingTaxes, { mode: 'combined', notApplicable: false, combinedPct: null, items: [] });

    assert.equal(state.resources.laborProfiles[0].basicMonthly, 100);
    assert.equal(state.resources.equipment[0].name, 'Grúa');
    assert.equal(state.resources.locations[0].distanceFromBaseKm, 110);
    assert.equal(state.resources.agreements[0].name, 'Convenio viejo');
    assert.deepEqual(state.resources.materials, []);
    assert.equal(state.services.length, 2);
    // v2 → v3: base del combustible SIN DEFINIR (nunca inventada) y sin tipos de cambio.
    assert.deepEqual(state.settings, { fuelPricePerLiter: 900, defaultBillingTaxes: null, fuelPriceBase: { period: null, currency: 'ARS', source: null, note: '' }, exchangeRates: [] });
    assert.equal(state.organization.name, 'Legado SRL');
    assert.equal(state.organization.cuit, 'ficticio');
  });

  test('asigna ids faltantes o vacíos y conserva los existentes', () => {
    const { state } = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    const ids = state.quotes.map((q) => q.id);
    assert.ok(ids.includes('q-2'), 'id existente conservado');
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(state.resources.laborProfiles[0].id, 'lp-1');
    assert.ok(state.resources.agreements[0].id.startsWith('gen-'));
    assert.ok(state.resources.locations[0].id.startsWith('gen-'));
  });

  test('con la idFactory por defecto los ids nuevos son UUID', () => {
    const { state } = migrateState({ quotes: [{ name: 'x' }] }, { now: NOW });
    assert.ok(isUuid(state.quotes[0].id));
    assert.ok(isUuid(state.organization.id));
  });

  test('asigna organizationId y timestamps faltantes; conserva los existentes', () => {
    const { state } = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    const old = state.quotes.find((q) => q.code === 'COT-0007');
    assert.equal(old.organizationId, 'org-legado');
    assert.equal(old.createdAt, NOW);
    assert.equal(old.updatedAt, NOW);
    const q2 = state.quotes.find((q) => q.id === 'q-2');
    assert.equal(q2.updatedAt, '2021-02-02T00:00:00.000Z');
    assert.equal(q2.createdAt, NOW);
    const eq = state.resources.equipment[0];
    assert.equal(eq.createdAt, '2019-01-01T00:00:00.000Z');
    assert.equal(eq.organizationId, 'otra-org', 'no pisa un organizationId existente');
    for (const s of state.services) assert.equal(s.organizationId, 'org-legado');
  });

  test('completa nombres faltantes de cotizaciones y servicios', () => {
    const { state } = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    assert.equal(state.quotes.find((q) => q.code === 'sin nombre').name, 'Cotización');
    assert.equal(state.services.find((s) => s.serviceType === 'crew').name, 'Servicio');
  });

  test('sin organización crea "Mi empresa" con id nuevo y la asigna a todo', () => {
    const { state } = migrateState({ quotes: [{ name: 'Q' }], resources: { equipment: [{ name: 'E' }] } }, { now: NOW, idFactory: sequentialIds('org') });
    assert.equal(state.organization.name, 'Mi empresa');
    assert.equal(state.organization.createdAt, NOW);
    assert.ok('createdBy' in state.organization && 'updatedBy' in state.organization);
    assert.equal(state.quotes[0].organizationId, state.organization.id);
    assert.equal(state.resources.equipment[0].organizationId, state.organization.id);
    assert.deepEqual(Object.keys(state.resources).sort(), [...RESOURCE_TYPES].sort());
  });

  test('las claves desconocidas se guardan en legacy (no se pierden)', () => {
    const { state } = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    assert.deepEqual(state.legacy, { preferenciasViejas: { tema: 'oscuro' }, ultimaPantalla: '#/cotizaciones' });
  });

  test('sin claves desconocidas no agrega legacy', () => {
    const { state } = migrateState({ quotes: [] }, { now: NOW, idFactory: sequentialIds() });
    assert.equal('legacy' in state, false);
  });

  // BUG detectado: tipos de recurso desconocidos dentro de `resources`
  // (p. ej. una colección "vehicles" de una versión vieja) se descartan en
  // silencio en lugar de guardarse en legacy.
  test('colecciones de recursos desconocidas se conservan en legacy.resources', () => {
    const input = { resources: { equipment: [], vehicles: [{ id: 'v1', patente: 'AA000AA' }] } };
    const { state } = migrateState(input, { now: NOW, idFactory: sequentialIds() });
    assert.deepEqual(state.legacy?.resources?.vehicles, [{ id: 'v1', patente: 'AA000AA' }]);
  });

  // BUG detectado: ids duplicados en datos legados producen un estado v1
  // inválido (validateState falla) y el repositorio queda sin poder guardar.
  test('ids duplicados en datos legados: se conservan ambos registros con ids únicos', () => {
    const input = {
      quotes: [
        { id: 'dup', name: 'A' },
        { id: 'dup', name: 'B' },
      ],
    };
    const { state } = migrateState(input, { now: NOW, idFactory: sequentialIds() });
    assert.deepEqual(state.quotes.map((q) => q.name), ['A', 'B']);
    assert.equal(new Set(state.quotes.map((q) => q.id)).size, 2);
    assert.equal(validateState(state).ok, true);
  });

  test('no modifica el objeto de entrada', () => {
    const input = legacyState();
    const before = JSON.stringify(input);
    migrateState(input, { now: NOW, idFactory: sequentialIds() });
    assert.equal(JSON.stringify(input), before);
  });

  test('migrateV0ToV1 tolera entradas que no son objetos', () => {
    const out = migrateV0ToV1(null, { now: NOW, idFactory: sequentialIds() });
    assert.equal(out.schemaVersion, 1);
    assert.deepEqual(out.quotes, []);
    assert.equal(validateState(migrateV2ToV3(migrateV1ToV2(out))).ok, true);
  });
});

describe('migrateState — versiones no soportadas', () => {
  test('rechaza datos de una versión más nueva con MigrationError newer_version', () => {
    const future = { ...createDemoState(CURRENT_SCHEMA_VERSION), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const before = JSON.stringify(future);
    assert.throws(
      () => migrateState(future),
      (error) => {
        assert.ok(error instanceof MigrationError);
        assert.equal(error.name, 'MigrationError');
        assert.equal(error.code, 'newer_version');
        assert.match(error.message, /más nueva/);
        return true;
      },
    );
    assert.equal(JSON.stringify(future), before, 'los datos no se tocan');
  });

  test('rechaza formatos no reconocidos con code invalid', () => {
    for (const bad of [null, undefined, [], 'texto', 42, { schemaVersion: '1' }, { schemaVersion: -1 }, { schemaVersion: 1.5 }, { schemaVersion: null }]) {
      assert.throws(() => migrateState(bad), { name: 'MigrationError', code: 'invalid' }, JSON.stringify(bad));
    }
  });

  test('si falta una migración intermedia falla con missing_migration', () => {
    const state = createDemoState(CURRENT_SCHEMA_VERSION);
    assert.throws(() => migrateState(state, { targetVersion: CURRENT_SCHEMA_VERSION + 5 }), { code: 'missing_migration' });
  });
});

describe('migrateState — idempotencia en la versión actual', () => {
  test('un estado v1 válido no cambia', () => {
    const state = createDemoState(CURRENT_SCHEMA_VERSION);
    const result = migrateState(state);
    assert.equal(result.fromVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.state, state);
    assert.notEqual(result.state, state, 'devuelve una copia');
  });

  test('migrar dos veces da el mismo resultado que migrar una vez', () => {
    const once = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() }).state;
    const twice = migrateState(once, { now: '2030-01-01T00:00:00.000Z', idFactory: sequentialIds('otro') });
    assert.deepEqual(twice.applied, []);
    assert.deepEqual(twice.state, once);
  });

  test('un estado actual con colecciones faltantes se normaliza sin borrar nada', () => {
    const partial = { schemaVersion: CURRENT_SCHEMA_VERSION, organization: { id: 'o' }, quotes: [{ id: 'q', name: 'Q', billingTaxes: { mode: 'combined', notApplicable: false, combinedPct: null, items: [] } }], extra: { a: 1 } };
    const { state } = migrateState(partial);
    assert.deepEqual(state.quotes, partial.quotes);
    assert.deepEqual(state.extra, { a: 1 });
    assert.deepEqual(state.services, []);
    assert.deepEqual(state.settings, {});
    RESOURCE_TYPES.forEach((t) => assert.deepEqual(state.resources[t], []));
  });
});

describe('migrateState v1 → v2 (impuestos sobre la facturación, PLAN-2026-002)', () => {
  /** Estado v1 real: el que guardaba la versión anterior de RATEOS. */
  function v1State() {
    const s = createDemoState(1);
    s.quotes.forEach((q) => {
      delete q.billingTaxes;
      delete q.vatTreatment;
    });
    delete s.settings.defaultBillingTaxes;
    return s;
  }

  test('agrega billingTaxes SIN DEFINIR a cada cotización y defaultBillingTaxes null; el resultado es válido', () => {
    const before = v1State();
    const result = migrateState(before, { targetVersion: 2 });
    assert.equal(result.fromVersion, 1);
    assert.deepEqual(result.applied, ['1→2']);
    assert.equal(result.state.schemaVersion, 2);
    // Válido una vez llevado a la versión actual.
    assert.deepEqual(validateState(migrateState(before).state), { ok: true, errors: [] });
    result.state.quotes.forEach((q) => assert.deepEqual(q.billingTaxes, { mode: 'combined', notApplicable: false, combinedPct: null, items: [] }));
    assert.equal(result.state.settings.defaultBillingTaxes, null);
  });

  test('no cambia ningún otro dato (cotizaciones, recursos, plantillas, organización)', () => {
    const before = v1State();
    const { state } = migrateState(before, { targetVersion: 2 });
    const strip = (q) => {
      const { billingTaxes, vatTreatment, ...rest } = q;
      return rest;
    };
    assert.deepEqual(state.quotes.map(strip), before.quotes);
    assert.deepEqual(state.resources, before.resources);
    assert.deepEqual(state.services, before.services);
    assert.deepEqual(state.organization, before.organization);
    const { defaultBillingTaxes, ...settings } = state.settings;
    assert.deepEqual(settings, before.settings);
  });

  test('la convención de montos queda explícita: vatTreatment "excluded" (sin IVA) en cada cotización', () => {
    const { state } = migrateState(v1State());
    assert.ok(state.quotes.length > 0);
    state.quotes.forEach((q) => assert.equal(q.vatTreatment, 'excluded'));
  });

  test('un vatTreatment ya presente no se pisa: si esta versión no lo soporta, el cálculo lo avisa', () => {
    const s = v1State();
    s.quotes[0].vatTreatment = 'excluded';
    s.quotes[1].vatTreatment = 'included';
    const out = migrateV1ToV2(s);
    assert.equal(out.quotes[0].vatTreatment, 'excluded');
    assert.equal(out.quotes[1].vatTreatment, 'included');
    // La estructura es válida (no se descarta nada) ...
    assert.equal(validateState(migrateV2ToV3(out)).ok, true);
    // ... pero la cotización no se calcula en silencio como si fuera sin IVA.
    const issues = computeQuote(out.quotes[1]).issues.filter((i) => i.path === 'vatTreatment');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.deepEqual(computeQuote(out.quotes[0]).issues.filter((i) => i.path === 'vatTreatment'), []);
  });

  test('el estado migrado da los mismos números que la demo actual (impuestos "sin definir")', () => {
    // La demo actual (v3) tiene bases ILUSTRATIVAS y movilización por equipo;
    // la migrada desde v1 no inventa bases, pero ningún número cambia.
    const migrated = migrateState(v1State()).state;
    const current = createDemoState(CURRENT_SCHEMA_VERSION);
    assert.equal(validateState(migrated).ok, true);
    migrated.quotes.forEach((q, i) => {
      const a = computeQuote(q).kpis;
      const b = computeQuote(current.quotes[i]).kpis;
      for (const k of ['totalCost', 'floorNetRate', 'suggestedListRate', 'revenue', 'profit', 'breakEvenDays']) assert.ok(Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-6, `${q.name}: ${k}`);
    });
  });

  test('una cotización que ya trae billingTaxes válido lo conserva', () => {
    const s = v1State();
    s.quotes[0].billingTaxes = { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'gross_income', label: 'IB', pct: 3 }] };
    const { state } = migrateState(s);
    assert.deepEqual(state.quotes[0].billingTaxes, s.quotes[0].billingTaxes);
  });

  test('un billingTaxes que no es objeto no se pierde: queda en legacy de la cotización', () => {
    const s = v1State();
    s.quotes[0].billingTaxes = 'texto ajeno';
    s.quotes[1].legacy = 'viejo';
    s.quotes[1].billingTaxes = 7;
    const { state } = migrateState(s);
    assert.equal(state.quotes[0].legacy.billingTaxes, 'texto ajeno');
    assert.deepEqual(state.quotes[1].legacy, { previous: 'viejo', billingTaxes: 7 });
    assert.equal(validateState(state).ok, true);
  });

  test('settings que no es objeto se guarda en legacy (no se descarta)', () => {
    const s = v1State();
    s.settings = 'roto';
    const out = migrateV1ToV2(s);
    assert.deepEqual(out.settings, { defaultBillingTaxes: null });
    assert.equal(out.legacy.settings, 'roto');
  });

  test('no modifica el objeto de entrada y es idempotente', () => {
    const input = v1State();
    const text = JSON.stringify(input);
    const once = migrateState(input).state;
    assert.equal(JSON.stringify(input), text);
    const twice = migrateState(once);
    assert.deepEqual(twice.applied, []);
    assert.deepEqual(twice.state, once);
  });

  test('migrateV1ToV2 tolera entradas que no son objetos', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      const out = migrateV1ToV2(bad);
      assert.equal(out.schemaVersion, 2);
      assert.deepEqual(out.quotes, []);
    }
  });
});

describe('migrateState v2 → v3 (base económica, snapshots, movilización — PLAN-2026-005)', () => {
  /** Estado v2 real: cotización con personal, equipo y material de Recursos y un vehículo de viaje. */
  function v2State() {
    return {
      schemaVersion: 2,
      organization: { id: 'org', name: 'Mi empresa' },
      resources: {
        agreements: [],
        laborProfiles: [{ id: 'lp', role: 'Operador', basicMonthly: 2000000 }],
        equipment: [{ id: 'eq', name: 'Hidrogrúa', type: 'crane_truck', replacementValue: 250000000, usefulLifeYears: 10, residualValue: 50000000, fuelLitersPerHour: 12, maintenancePerHour: 15000 }],
        materials: [{ id: 'mat', description: 'Eslingas', unitCost: 300000 }],
        locations: [],
      },
      services: [{ id: 't', name: 'Plantilla', defaults: { equipment: [{ id: 'te', sourceId: 'eq', name: 'Hidrogrúa', replacementValue: 1 }] } }],
      quotes: [{
        id: 'q', name: 'Cotización v2', createdAt: '2026-08-15T10:00:00.000Z', serviceType: 'on_call', pricingMode: 'known_activity', unit: 'day',
        activity: { activeDaysPerMonth: 8, daysPerActivation: 2, availableDaysPerMonth: 30, hoursPerActiveDay: 10 },
        labor: [{ id: 'l', sourceId: 'lp', role: 'Operador', positions: 1, peoplePerPosition: 1, basicMonthly: 2000000, normalHoursPerMonth: 176 }],
        equipment: [{ id: 'e', sourceId: 'eq', name: 'Hidrogrúa', quantity: 1, hoursPerActiveDay: 10, replacementValue: 250000000, usefulLifeYears: 10, residualValue: 50000000, fuelLitersPerHour: 12, maintenancePerHour: 15000 }],
        materials: [{ id: 'm', sourceId: 'mat', description: 'Eslingas', basis: 'per_month', quantity: 1, unitCost: 300000, providedBy: 'contractor' }],
        otherCosts: [],
        fuel: { pricePerLiter: 1500, providedBy: 'contractor' },
        logistics: { notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [{ id: 'v', name: 'Hidrogrúa', count: 1, consumptionLPer100Km: 35, costPerKm: 150 }], tollsPerActivation: 0, lodgingPerActivation: 0 },
        indirect: { method: 'percent_direct', pct: 10, amount: 0 },
        finance: { paymentTermDays: 60, invoiceLagDays: 15, monthlyRatePct: 3, payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 } },
        risk: { generalPct: 5, items: [] },
        pricing: { targetMarginPct: 10, roundingStep: 0 },
        rules: {},
        billingTaxes: { mode: 'combined', notApplicable: false, combinedPct: null, items: [] },
        vatTreatment: 'excluded',
      }],
      settings: { currency: 'ARS', fuelPricePerLiter: 1500, defaultBillingTaxes: null },
    };
  }

  test('el resultado es válido y NINGÚN número cambia', () => {
    const before = v2State();
    const result = migrateState(before);
    assert.deepEqual(result.applied, ['2→3']);
    assert.deepEqual(validateState(result.state), { ok: true, errors: [] });
    const a = computeQuote(before.quotes[0]);
    const b = computeQuote(result.state.quotes[0]);
    for (const k of ['totalCost', 'fixedCosts', 'variableCosts', 'floorNetRate', 'targetListRate', 'financialCost', 'logisticsMonthly']) {
      assert.ok(Math.abs(a.kpis[k] - b.kpis[k]) < 1e-6, `${k}: ${a.kpis[k]} → ${b.kpis[k]}`);
    }
    assert.deepEqual(a.eecc.rows.map((r) => r.amount), b.eecc.rows.map((r) => r.amount));
  });

  test('ninguna fecha base se inventa: todo queda "Base no definida", en la moneda de la empresa', () => {
    const { state } = migrateState(v2State());
    const empty = { period: null, currency: 'ARS', source: null, note: '' };
    assert.deepEqual(state.resources.laborProfiles[0].base, empty);
    assert.deepEqual(state.resources.equipment[0].base, empty);
    assert.deepEqual(state.resources.equipment[0].costsBase, empty);
    assert.deepEqual(state.resources.materials[0].base, empty);
    const q = state.quotes[0];
    assert.deepEqual(q.labor[0].base, empty);
    assert.deepEqual(q.equipment[0].base, empty);
    assert.deepEqual(q.materials[0].base, empty);
    assert.deepEqual(q.fuel.base, empty);
    assert.deepEqual(state.settings.fuelPriceBase, empty);
    assert.deepEqual(state.settings.exchangeRates, []);
  });

  test('la cotización recibe moneda, fecha de la oferta (su creación, un hecho) y tipos de cambio vacíos', () => {
    const q = migrateState(v2State()).state.quotes[0];
    assert.equal(q.currency, 'ARS');
    assert.equal(q.offerDate, '2026-08-15');
    assert.deepEqual(q.exchangeRates, []);
  });

  test('equipos: obtención "propio", familia desde el tipo, movilidad SIN DEFINIR (los traslados siguen en Viajes)', () => {
    const { state } = migrateState(v2State());
    const res = state.resources.equipment[0];
    assert.equal(res.acquisition, 'owned');
    assert.equal(res.familyId, 'crane_truck');
    assert.equal(res.type, 'crane_truck', 'el tipo viejo no se borra');
    assert.equal(res.mobility.selfPropelled, null);
    const line = state.quotes[0].equipment[0];
    assert.equal(line.acquisition, 'owned');
    assert.equal(line.familyId, 'crane_truck');
    assert.equal(line.mobilization.mode, null);
    assert.equal(state.quotes[0].logistics.vehicles.length, 1, 'el vehículo de viaje se conserva');
  });

  test('snapshots "anteriores" (legacy) con los valores que ya usaba cada línea', () => {
    const q = migrateState(v2State()).state.quotes[0];
    assert.equal(q.labor[0].snapshot.legacy, true);
    assert.equal(q.labor[0].snapshot.resourceId, 'lp');
    assert.equal(q.labor[0].snapshot.takenAt, null);
    assert.equal(q.labor[0].snapshot.values.basicMonthly, 2000000);
    assert.equal(q.equipment[0].snapshot.values.replacementValue, 250000000);
    assert.equal(q.materials[0].snapshot.values.unitCost, 300000);
  });

  test('colecciones nuevas vacías y plantillas migradas; idempotente y no modifica la entrada', () => {
    const input = v2State();
    const text = JSON.stringify(input);
    const once = migrateState(input).state;
    assert.equal(JSON.stringify(input), text);
    assert.deepEqual(once.resources.equipmentModels, []);
    assert.deepEqual(once.resources.externalServices, []);
    assert.equal(once.services[0].defaults.equipment[0].acquisition, 'owned');
    assert.equal(once.services[0].defaults.labor, undefined, 'una plantilla sin personal no gana listas vacías');
    const twice = migrateState(once);
    assert.deepEqual(twice.applied, []);
    assert.deepEqual(twice.state, once);
  });

  test('tolera entradas que no son objetos', () => {
    for (const bad of [null, undefined, 'x', 42]) {
      const out = migrateV2ToV3(bad);
      assert.equal(out.schemaVersion, 3);
      assert.deepEqual(out.quotes, []);
    }
  });
});
