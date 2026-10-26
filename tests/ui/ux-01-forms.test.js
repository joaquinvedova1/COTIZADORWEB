/**
 * UX-01 (PLAN-2026-022) · Formularios que no pierden cambios sin avisar y
 * valores que no se corrigen en silencio. Acá van las funciones puras; los
 * diálogos, los avisos y la navegación se prueban en el navegador
 * (tests/lab/e2e/ui-lab.mjs, bloque UX-01).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { contentSnapshot } from '../../js/core/object.js';
import { restoredNoticeText } from '../../js/ui/components.js';

describe('UX-01 · huella del borrador de un formulario (contentSnapshot)', () => {
  test('el orden de las claves no cuenta', () => {
    assert.equal(contentSnapshot({ b: 1, a: { d: 'x', c: 2 } }), contentSnapshot({ a: { c: 2, d: 'x' }, b: 1 }));
  });

  test('no tocar un campo y escribir y borrar dan lo mismo (vacíos fuera)', () => {
    const untouched = { role: 'Chofer', base: { period: null } };
    const typedAndCleared = { role: 'Chofer', category: '', additionalsMonthly: null, notes: '   ', base: { period: null, source: undefined }, tags: [] };
    assert.equal(contentSnapshot(typedAndCleared), contentSnapshot(untouched));
    assert.equal(contentSnapshot({ a: {}, b: [null, ''] }), contentSnapshot({}));
  });

  test('un cambio real cambia la huella: textos, números, 0 y false son respuestas', () => {
    const base = { role: 'Chofer', basicMonthly: 1500000, overtime: null };
    assert.notEqual(contentSnapshot({ ...base, role: 'Chofer del camión' }), contentSnapshot(base));
    assert.notEqual(contentSnapshot({ ...base, basicMonthly: 1600000 }), contentSnapshot(base));
    assert.notEqual(contentSnapshot({ ...base, overtime: 0 }), contentSnapshot(base));
    // "No" en un sí/no/sin definir no es lo mismo que "sin definir".
    assert.notEqual(contentSnapshot({ ...base, fuelIncluded: false }), contentSnapshot(base));
  });

  test('las listas conservan la posición de cada elemento', () => {
    assert.notEqual(contentSnapshot({ l: ['', 'a'] }), contentSnapshot({ l: ['a'] }));
    assert.equal(contentSnapshot({ l: ['', 'a'] }), contentSnapshot({ l: [null, 'a'] }));
  });

  test('números no finitos y funciones no cuentan', () => {
    assert.equal(contentSnapshot({ a: Number.NaN, b: Infinity, f: () => 1 }), contentSnapshot({}));
  });
});

describe('UX-01 · aviso del valor que volvió al anterior (restoredNoticeText)', () => {
  test('dice la pantalla, el campo, lo que se escribió, por qué no se guardó y qué quedó', () => {
    const text = restoredNoticeText({
      screen: 'COT-0010 Transporte',
      label: 'Margen que querés ganar (sobre el precio)',
      typed: '12x',
      restored: '15',
      reason: 'Ingresá un número válido (usá coma para decimales y punto para miles, p. ej. 1.800.000,50).',
    });
    assert.match(text, /^No se guardó "12x" en "Margen que querés ganar \(sobre el precio\)" \(COT-0010 Transporte\)\./);
    assert.match(text, /Ingresá un número válido/);
    assert.match(text, /Quedó el valor anterior: 15\.$/);
  });

  test('un campo obligatorio que quedó vacío lo dice (el campo no manda el motivo: sería repetirlo)', () => {
    const text = restoredNoticeText({ screen: 'Configuración', label: 'Nombre de la empresa', typed: '', restored: 'Empresa sintética' });
    assert.equal(text, '"Nombre de la empresa" (Configuración) no puede quedar vacío. Quedó el valor anterior: Empresa sintética.');
  });

  test('si antes estaba vacío, lo dice', () => {
    const text = restoredNoticeText({ label: 'Precio del combustible (sin IVA)', typed: 'mil', restored: '' });
    assert.equal(text, 'No se guardó "mil" en "Precio del combustible (sin IVA)". Quedó como estaba, vacío.');
  });

  test('los textos largos se recortan (el aviso entra en pantalla)', () => {
    const text = restoredNoticeText({ screen: 'x'.repeat(200), label: 'y'.repeat(200), typed: 'z'.repeat(200), restored: '1' });
    assert.ok(text.length < 300, `${text.length} caracteres`);
    assert.match(text, /…/);
  });
});
