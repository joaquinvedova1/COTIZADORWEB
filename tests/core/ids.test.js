/**
 * Tests de js/core/ids.js — ids internos estables compatibles con UUID
 * (Prompt 4 §5: nunca usar el nombre visible como clave primaria).
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createId, isUuid } from '../../js/core/ids.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const webcrypto = globalThis.crypto;

function replaceCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

describe('createId', () => {
  test('produce UUID v4 válidos (versión 4, variante RFC 4122)', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = createId();
      assert.match(id, UUID_V4);
      assert.equal(isUuid(id), true);
    }
  });

  test('produce ids únicos', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => createId()));
    assert.equal(ids.size, 5000);
  });

  test('sin randomUUID usa getRandomValues y sigue produciendo UUID v4', () => {
    replaceCrypto({ getRandomValues: (array) => webcrypto.getRandomValues(array) });
    const ids = Array.from({ length: 500 }, () => createId());
    ids.forEach((id) => assert.match(id, UUID_V4));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('el fallback fija versión y variante aunque los bytes sean extremos', () => {
    replaceCrypto({ getRandomValues: (array) => array.fill(0xff) });
    assert.equal(createId(), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    replaceCrypto({ getRandomValues: (array) => array.fill(0) });
    assert.equal(createId(), '00000000-0000-4000-8000-000000000000');
  });

  test('sin generador criptográfico falla explícitamente (nunca usa Math.random)', () => {
    replaceCrypto(undefined);
    assert.throws(() => createId(), /criptográfico/);
    replaceCrypto({});
    assert.throws(() => createId(), /criptográfico/);
  });
});

describe('isUuid', () => {
  test('acepta UUIDs válidos (incluye los ids fijos de la demo y mayúsculas)', () => {
    assert.equal(isUuid('00000000-0000-4000-8000-000000000001'), true);
    assert.equal(isUuid('6B797425-193D-4C04-B790-40834637D98C'), true);
    assert.equal(isUuid('6b797425-193d-1c04-a790-40834637d98c'), true, 'otras versiones RFC también son UUID');
  });

  test('rechaza textos que no son UUID', () => {
    const bad = [
      '',
      'no-es-uuid',
      'Hidrogrúa on-call — Añelo',
      '6b797425193d4c04b79040834637d98c',
      '6b797425-193d-4c04-c790-40834637d98c', // variante inválida
      '6b797425-193d-0c04-b790-40834637d98c', // versión 0
      '6b797425-193d-4c04-b790-40834637d98c ', // espacio
      ' 6b797425-193d-4c04-b790-40834637d98c',
      '6b797425-193d-4c04-b790-40834637d98g',
      '6b797425-193d-4c04-b790-40834637d98c\n',
    ];
    for (const value of bad) assert.equal(isUuid(value), false, JSON.stringify(value));
  });

  test('rechaza valores que no son texto', () => {
    for (const value of [null, undefined, 123, {}, [], true]) assert.equal(isUuid(value), false);
  });
});
