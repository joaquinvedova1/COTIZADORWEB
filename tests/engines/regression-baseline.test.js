/**
 * Baseline de regresión (PLAN-2026-002, PN0): con impuestos sobre la
 * facturación sin definir (0 %), ningún número del motor cambia respecto del
 * motor anterior. Compara KPIs, estructura de costos, matriz tarifa × días y
 * tramos de descuento de la demo, el caso de referencia, cada plantilla demo
 * y variantes sintéticas (unidades, reglas, actividad 0, utilización 100 %).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { baselineCases, pickBaseline } from '../fixtures/baseline-cases.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/baseline-v1.json', import.meta.url), 'utf8')).cases;

function close(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = Math.max(1e-6, Math.abs(b) * 1e-9);
    assert.ok(Math.abs(a - b) <= tol, `${path}: ${a} ≠ ${b}`);
    return;
  }
  if (Array.isArray(b)) {
    assert.ok(Array.isArray(a) && a.length === b.length, `${path}: largo distinto`);
    b.forEach((v, i) => close(a[i], v, `${path}[${i}]`));
    return;
  }
  if (b && typeof b === 'object') {
    Object.keys(b).forEach((k) => close(a[k], b[k], `${path}.${k}`));
    return;
  }
  assert.equal(a, b, path);
}

describe('baseline de regresión: impuestos sin definir = números idénticos', () => {
  const cases = baselineCases();
  test('el fixture cubre todos los casos', () => {
    assert.deepEqual(Object.keys(expected).sort(), cases.map((c) => c.id).sort());
  });
  for (const c of cases) {
    test(c.id, () => {
      close(pickBaseline(computeQuote(c.quote, { settings: c.settings })), expected[c.id], c.id);
    });
  }
});
