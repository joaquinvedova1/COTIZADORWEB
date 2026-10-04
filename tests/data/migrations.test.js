/**
 * Tests de migraciones de esquema (Prompt 4 §7: "Nunca borrar los datos
 * porque cambió la estructura").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { migrateState, migrateV0ToV1, migrateV1ToV2, MIGRATIONS, MigrationError } from '../../js/data/migrations.js';
import { CURRENT_SCHEMA_VERSION, RESOURCE_TYPES, validateState } from '../../js/data/schema.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { isUuid } from '../../js/core/ids.js';

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
    assert.ok(Object.isFrozen(MIGRATIONS));
  });
});

describe('migrateState v0 → v1', () => {
  test('lleva el estado a la versión actual y el resultado es válido', () => {
    const result = migrateState(legacyState(), { now: NOW, idFactory: sequentialIds() });
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.applied, ['0→1', '1→2']);
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
    assert.deepEqual(state.settings, { fuelPricePerLiter: 900, defaultBillingTaxes: null });
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
    assert.equal(validateState(migrateV1ToV2(out)).ok, true);
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
    s.quotes.forEach((q) => delete q.billingTaxes);
    delete s.settings.defaultBillingTaxes;
    return s;
  }

  test('agrega billingTaxes SIN DEFINIR a cada cotización y defaultBillingTaxes null; el resultado es válido', () => {
    const before = v1State();
    const result = migrateState(before);
    assert.equal(result.fromVersion, 1);
    assert.deepEqual(result.applied, ['1→2']);
    assert.equal(result.state.schemaVersion, 2);
    assert.deepEqual(validateState(result.state), { ok: true, errors: [] });
    result.state.quotes.forEach((q) => assert.deepEqual(q.billingTaxes, { mode: 'combined', notApplicable: false, combinedPct: null, items: [] }));
    assert.equal(result.state.settings.defaultBillingTaxes, null);
  });

  test('no cambia ningún otro dato (cotizaciones, recursos, plantillas, organización)', () => {
    const before = v1State();
    const { state } = migrateState(before);
    const strip = (q) => {
      const { billingTaxes, ...rest } = q;
      return rest;
    };
    assert.deepEqual(state.quotes.map(strip), before.quotes);
    assert.deepEqual(state.resources, before.resources);
    assert.deepEqual(state.services, before.services);
    assert.deepEqual(state.organization, before.organization);
    const { defaultBillingTaxes, ...settings } = state.settings;
    assert.deepEqual(settings, before.settings);
  });

  test('el estado migrado equivale al estado demo actual (la demo queda "sin definir")', () => {
    assert.deepEqual(migrateState(v1State()).state, createDemoState(CURRENT_SCHEMA_VERSION));
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
