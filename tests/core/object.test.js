/**
 * Tests de js/core/object.js — utilidades de objetos y protección contra
 * prototype pollution en setPath (rutas que vienen de la UI).
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { deepClone, deepFreeze, getPath, setPath, isPlainObject } from '../../js/core/object.js';

function assertNoPollution() {
  assert.equal({}.polluted, undefined, 'Object.prototype contaminado');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal([].polluted, undefined);
}

afterEach(() => {
  delete Object.prototype.polluted;
});

describe('setPath — seguridad', () => {
  const DANGEROUS = [
    '__proto__.polluted',
    'a.__proto__.polluted',
    'constructor.prototype.polluted',
    'a.constructor.prototype.polluted',
    'prototype.polluted',
    'labor.0.__proto__.polluted',
    '__proto__',
    'constructor',
    'a.b.prototype',
  ];

  for (const path of DANGEROUS) {
    test(`rechaza la ruta "${path}"`, () => {
      const obj = { a: { b: {} }, labor: [{}] };
      const before = JSON.stringify(obj);
      assert.throws(() => setPath(obj, path, true), /Ruta no permitida/);
      assertNoPollution();
      assert.equal(JSON.stringify(obj), before, 'el objeto no cambia');
    });
  }

  test('rechaza rutas vacías', () => {
    assert.throws(() => setPath({}, '', 1), /Ruta vacía/);
    assert.throws(() => setPath({}, '...', 1), /Ruta vacía/);
  });
});

describe('setPath — escritura', () => {
  test('escribe en rutas existentes', () => {
    const obj = { pricing: { targetMarginPct: 10 } };
    const out = setPath(obj, 'pricing.targetMarginPct', 15);
    assert.equal(out, obj, 'muta y devuelve el mismo objeto');
    assert.equal(obj.pricing.targetMarginPct, 15);
  });

  test('crea objetos intermedios', () => {
    const obj = {};
    setPath(obj, 'finance.payDays.salaries', 20);
    assert.deepEqual(obj, { finance: { payDays: { salaries: 20 } } });
  });

  test('crea arrays intermedios cuando la clave siguiente es numérica', () => {
    const obj = {};
    setPath(obj, 'labor.0.role', 'Chofer');
    assert.ok(Array.isArray(obj.labor));
    assert.deepEqual(obj.labor, [{ role: 'Chofer' }]);
  });

  test('escribe en índices de arrays existentes', () => {
    const obj = { labor: [{ role: 'A' }, { role: 'B' }] };
    setPath(obj, 'labor.1.role', 'C');
    assert.deepEqual(obj.labor, [{ role: 'A' }, { role: 'C' }]);
  });

  test('reemplaza intermedios primitivos o null por objetos', () => {
    const obj = { a: 5, b: null };
    setPath(obj, 'a.x', 1);
    setPath(obj, 'b.y', 2);
    assert.deepEqual(obj, { a: { x: 1 }, b: { y: 2 } });
  });

  test('ignora segmentos vacíos', () => {
    const obj = {};
    setPath(obj, 'a..b.', 1);
    assert.deepEqual(obj, { a: { b: 1 } });
  });

  test('puede escribir null o undefined', () => {
    const obj = { pricing: { customMarginPct: 20 } };
    setPath(obj, 'pricing.customMarginPct', null);
    assert.equal(obj.pricing.customMarginPct, null);
  });
});

describe('getPath', () => {
  test('lee rutas anidadas y de arrays', () => {
    const obj = { a: { b: [{ c: 3 }] } };
    assert.equal(getPath(obj, 'a.b.0.c'), 3);
    assert.deepEqual(getPath(obj, 'a.b'), [{ c: 3 }]);
  });

  test('devuelve undefined si la ruta no existe', () => {
    assert.equal(getPath({ a: {} }, 'a.b.c'), undefined);
    assert.equal(getPath(null, 'a'), undefined);
    assert.equal(getPath(undefined, 'a.b'), undefined);
    assert.equal(getPath({ a: null }, 'a.b'), undefined);
  });

  test('ruta vacía devuelve el objeto', () => {
    const obj = { a: 1 };
    assert.equal(getPath(obj, ''), obj);
  });
});

describe('deepClone', () => {
  test('copia profunda independiente', () => {
    const original = { a: { b: [1, { c: 2 }] }, d: null, e: 'x' };
    const copy = deepClone(original);
    assert.deepEqual(copy, original);
    assert.notEqual(copy, original);
    copy.a.b[1].c = 99;
    copy.a.b.push(3);
    assert.equal(original.a.b[1].c, 2);
    assert.equal(original.a.b.length, 2);
  });

  test('undefined y primitivos', () => {
    assert.equal(deepClone(undefined), undefined);
    assert.equal(deepClone(5), 5);
    assert.equal(deepClone(null), null);
    assert.equal(deepClone('x'), 'x');
  });
});

describe('deepFreeze', () => {
  test('congela en profundidad y devuelve el mismo valor', () => {
    const obj = { a: { b: [1, { c: 2 }] } };
    const out = deepFreeze(obj);
    assert.equal(out, obj);
    assert.ok(Object.isFrozen(obj));
    assert.ok(Object.isFrozen(obj.a));
    assert.ok(Object.isFrozen(obj.a.b));
    assert.ok(Object.isFrozen(obj.a.b[1]));
    assert.throws(() => {
      'use strict';
      obj.a.b[1].c = 3;
    }, TypeError);
  });

  test('tolera primitivos y null', () => {
    assert.equal(deepFreeze(null), null);
    assert.equal(deepFreeze(3), 3);
  });
});

describe('isPlainObject', () => {
  test('sólo objetos no-array y no-null', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject(null), false);
    assert.equal(isPlainObject(undefined), false);
    assert.equal(isPlainObject('x'), false);
    assert.equal(isPlainObject(1), false);
  });
});
