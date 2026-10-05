/**
 * Tests del esquema persistido (validación estructural y de seguridad).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_SCHEMA_VERSION,
  RESOURCE_TYPES,
  createEmptyState,
  detectSchemaVersion,
  validateState,
  normalizeState,
} from '../../js/data/schema.js';
import { SCHEMA_VERSION } from '../../js/config.js';
import { createDemoState } from '../../js/domain/demo-data.js';

const ORG = { id: 'org-1', name: 'Org' };

function validBase() {
  return createEmptyState({ ...ORG }, { currency: 'ARS' });
}

function expectInvalid(state, pattern) {
  const result = validateState(state);
  assert.equal(result.ok, false, 'debería ser inválido');
  if (pattern) assert.ok(result.errors.some((e) => pattern.test(e)), `errores: ${result.errors.join(' | ')}`);
  return result;
}

describe('Constantes de esquema', () => {
  test('CURRENT_SCHEMA_VERSION sale de config.js y es entero >= 1', () => {
    assert.equal(CURRENT_SCHEMA_VERSION, SCHEMA_VERSION);
    assert.ok(Number.isInteger(CURRENT_SCHEMA_VERSION) && CURRENT_SCHEMA_VERSION >= 1);
  });

  test('RESOURCE_TYPES lista las bibliotecas y está congelado', () => {
    // v3 (PLAN-2026-005): modelos de equipos propios y servicios externos.
    assert.deepEqual([...RESOURCE_TYPES], ['agreements', 'laborProfiles', 'equipment', 'materials', 'locations', 'equipmentModels', 'externalServices']);
    assert.ok(Object.isFrozen(RESOURCE_TYPES));
  });
});

describe('createEmptyState', () => {
  test('crea todas las colecciones vacías en la versión actual', () => {
    const s = createEmptyState({ ...ORG }, { a: 1 });
    assert.equal(s.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(s.organization, ORG);
    RESOURCE_TYPES.forEach((t) => assert.deepEqual(s.resources[t], []));
    assert.deepEqual(s.services, []);
    assert.deepEqual(s.quotes, []);
    assert.deepEqual(s.settings, { a: 1 });
    assert.equal(validateState(s).ok, true);
  });

  test('copia settings (no comparte la referencia)', () => {
    const settings = { a: 1 };
    const s = createEmptyState({ ...ORG }, settings);
    s.settings.a = 2;
    assert.equal(settings.a, 1);
  });

  test('sin organización el estado no es válido', () => {
    expectInvalid(createEmptyState(), /organization/);
  });
});

describe('detectSchemaVersion', () => {
  test('casos válidos', () => {
    assert.equal(detectSchemaVersion({}), 0);
    assert.equal(detectSchemaVersion({ quotes: [] }), 0);
    assert.equal(detectSchemaVersion({ schemaVersion: 0 }), 0);
    assert.equal(detectSchemaVersion({ schemaVersion: 1 }), 1);
    assert.equal(detectSchemaVersion({ schemaVersion: 7 }), 7);
  });

  test('casos inválidos devuelven null', () => {
    for (const bad of [null, undefined, [], 'x', 1, { schemaVersion: '1' }, { schemaVersion: -1 }, { schemaVersion: 1.5 }, { schemaVersion: null }, { schemaVersion: NaN }]) {
      assert.equal(detectSchemaVersion(bad), null, JSON.stringify(bad));
    }
  });
});

describe('validateState', () => {
  test('la demo es válida', () => {
    assert.deepEqual(validateState(createDemoState(CURRENT_SCHEMA_VERSION)), { ok: true, errors: [] });
  });

  test('rechaza lo que no es objeto', () => {
    for (const bad of [null, undefined, [], 'x', 3]) expectInvalid(bad, /no es un objeto/);
  });

  test('exige la versión de esquema actual', () => {
    expectInvalid({ ...validBase(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }, /schemaVersion/);
    expectInvalid({ ...validBase(), schemaVersion: undefined }, /schemaVersion/);
  });

  test('exige organización con id', () => {
    expectInvalid({ ...validBase(), organization: null }, /organization/);
    expectInvalid({ ...validBase(), organization: { name: 'x' } }, /organization: falta "id"/);
    expectInvalid({ ...validBase(), organization: { id: '' } }, /organization: falta "id"/);
  });

  test('resources debe ser objeto y cada colección una lista', () => {
    expectInvalid({ ...validBase(), resources: [] }, /resources: debe ser un objeto/);
    const s = validBase();
    s.resources.equipment = 'x';
    expectInvalid(s, /resources\.equipment: debe ser una lista/);
  });

  test('una colección de recursos faltante se tolera (se normaliza luego)', () => {
    const s = validBase();
    delete s.resources.locations;
    assert.equal(validateState(s).ok, true);
  });

  test('cada entidad debe ser objeto con id de texto no vacío', () => {
    const s1 = validBase();
    s1.quotes = ['texto'];
    expectInvalid(s1, /quotes\[0\]: debe ser un objeto/);
    const s2 = validBase();
    s2.quotes = [{ name: 'sin id' }];
    expectInvalid(s2, /quotes\[0\]: falta "id"/);
    const s3 = validBase();
    s3.resources.materials = [{ id: '   ' }];
    expectInvalid(s3, /resources\.materials\[0\]: falta "id"/);
    const s4 = validBase();
    s4.services = [{ id: 5, name: 'x' }];
    expectInvalid(s4, /services\[0\]: falta "id"/);
  });

  test('detecta ids duplicados dentro de una colección', () => {
    const s = validBase();
    s.quotes = [
      { id: 'a', name: 'A' },
      { id: 'a', name: 'B' },
    ];
    expectInvalid(s, /quotes\[1\]: id duplicado/);
    const r = validBase();
    r.resources.equipment = [{ id: 'e' }, { id: 'e' }];
    expectInvalid(r, /resources\.equipment\[1\]: id duplicado/);
  });

  test('el mismo id en colecciones distintas es válido', () => {
    const s = validBase();
    s.quotes = [{ id: 'x', name: 'Q' }];
    s.services = [{ id: 'x', name: 'S' }];
    s.resources.equipment = [{ id: 'x' }];
    assert.equal(validateState(s).ok, true);
  });

  test('cotizaciones y servicios requieren name de texto', () => {
    const s = validBase();
    s.quotes = [{ id: 'q' }];
    expectInvalid(s, /quotes\[0\]: falta "name"/);
    const t = validBase();
    t.services = [{ id: 's', name: 3 }];
    expectInvalid(t, /services\[0\]: falta "name"/);
  });

  test('quotes/services deben ser listas y settings un objeto', () => {
    expectInvalid({ ...validBase(), quotes: {} }, /quotes: debe ser una lista/);
    expectInvalid({ ...validBase(), services: null }, /services: debe ser una lista/);
    expectInvalid({ ...validBase(), settings: [] }, /settings: debe ser un objeto/);
    expectInvalid({ ...validBase(), settings: 'x' }, /settings/);
  });

  test('rechaza números no finitos en cualquier nivel', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const s = validBase();
      s.quotes = [{ id: 'q', name: 'Q', pricing: { knownRate: bad } }];
      expectInvalid(s, /quotes\[0\]\.pricing\.knownRate: número inválido/);
    }
    const t = validBase();
    t.settings.matrixDays = [5, NaN];
    expectInvalid(t, /settings\.matrixDays\[1\]: número inválido/);
  });

  test('rechaza claves peligrosas (__proto__, constructor, prototype)', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const s = validBase();
      s.quotes = [JSON.parse(`{"id":"q","name":"Q","nested":{"${key}":{"polluted":true}}}`)];
      expectInvalid(s, new RegExp(`clave no permitida "${key}"`));
    }
    const top = JSON.parse(`{"schemaVersion":${CURRENT_SCHEMA_VERSION},"__proto__":{"x":1}}`);
    Object.assign(top, validBase());
    expectInvalid(top, /clave no permitida "__proto__"/);
    assert.equal({}.polluted, undefined);
  });

  test('rechaza textos demasiado largos, estructuras demasiado profundas y listas enormes', () => {
    const long = validBase();
    long.quotes = [{ id: 'q', name: 'x'.repeat(20001) }];
    expectInvalid(long, /texto demasiado largo/);

    const deep = validBase();
    let node = {};
    deep.settings.deep = node;
    for (let i = 0; i < 20; i += 1) {
      node.child = {};
      node = node.child;
    }
    expectInvalid(deep, /demasiado profunda/);

    const big = validBase();
    big.resources.locations = Array.from({ length: 5001 }, (_, i) => ({ id: `l${i}` }));
    expectInvalid(big, /demasiados elementos/);
  });

  test('acepta textos en el límite exacto', () => {
    const s = validBase();
    s.quotes = [{ id: 'q', name: 'x'.repeat(20000) }];
    assert.equal(validateState(s).ok, true);
  });

  test('rechaza tipos no serializables (funciones)', () => {
    const s = validBase();
    s.settings.fn = () => 1;
    expectInvalid(s, /tipo de dato no soportado/);
  });

  test('limita la cantidad de errores reportados a 20', () => {
    const s = validBase();
    s.quotes = Array.from({ length: 60 }, () => ({}));
    const result = expectInvalid(s);
    assert.ok(result.errors.length <= 20);
  });

  test('no modifica el estado validado', () => {
    const s = createDemoState(CURRENT_SCHEMA_VERSION);
    const before = JSON.stringify(s);
    validateState(s);
    assert.equal(JSON.stringify(s), before);
  });
});

describe('normalizeState', () => {
  test('completa colecciones faltantes sin borrar nada', () => {
    const input = { schemaVersion: 1, organization: { id: 'o' }, resources: { equipment: [{ id: 'e' }], extraType: [1] }, quotes: [{ id: 'q', name: 'Q' }], legacy: { a: 1 } };
    const out = normalizeState(input);
    assert.deepEqual(out.resources.equipment, [{ id: 'e' }]);
    assert.deepEqual(out.resources.extraType, [1]);
    RESOURCE_TYPES.forEach((t) => assert.ok(Array.isArray(out.resources[t])));
    assert.deepEqual(out.services, []);
    assert.deepEqual(out.quotes, input.quotes);
    assert.deepEqual(out.settings, {});
    assert.deepEqual(out.legacy, { a: 1 });
  });

  test('reemplaza colecciones con tipo incorrecto por vacías y no muta la entrada', () => {
    const input = { resources: 'x', services: 'y', quotes: null, settings: [] };
    const before = JSON.stringify(input);
    const out = normalizeState(input);
    assert.deepEqual(out.services, []);
    assert.deepEqual(out.quotes, []);
    assert.deepEqual(out.settings, {});
    RESOURCE_TYPES.forEach((t) => assert.deepEqual(out.resources[t], []));
    assert.equal(JSON.stringify(input), before);
  });
});

describe('Plantillas: sus valores tienen la misma forma que una cotización (PLAN-2026-005)', () => {
  test('una plantilla con líneas mal formadas se rechaza al validar (no rompe después al crear la cotización)', () => {
    const s = validBase();
    s.services = [{ id: 't1', name: 'Plantilla', defaults: { equipment: [{ id: 'e', external: 'str' }], labor: [{ id: 'l', base: 7 }] } }];
    expectInvalid(s, /services\[0\]\.defaults\.(equipment\[0\]\.external|labor\[0\]\.base)/);
  });

  test('una plantilla sin valores o con valores bien formados es válida', () => {
    const s = validBase();
    s.services = [{ id: 't1', name: 'Vacía' }, { id: 't2', name: 'Con líneas', defaults: { equipment: [{ id: 'e', external: null, mobilization: { mode: null } }] } }];
    assert.deepEqual(validateState(s), { ok: true, errors: [] });
  });
});
