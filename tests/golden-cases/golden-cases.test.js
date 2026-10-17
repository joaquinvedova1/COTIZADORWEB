/**
 * Golden cases (Prompt 4 §21) — casos de referencia del negocio.
 *
 * Cada archivo .json de esta carpeta es un caso con el formato:
 *   { id, title, rule, engine, inputs, expected, tolerance }
 *
 *   engine    motor a usar (ver ENGINES abajo)
 *   inputs    entradas de negocio del caso
 *   expected  { "ruta.en.el.resultado": valor } — los motores escalares devuelven { value }
 *   tolerance tolerancia absoluta para los valores numéricos
 *
 * Estos casos deben seguir siendo válidos aunque cambie la interfaz. Si un cambio de
 * fórmula rompe un golden case, el cambio es un cambio de REGLA DE NEGOCIO: se documenta y
 * se discute antes de tocar el caso.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { getPath } from '../../js/core/object.js';
import { ENGINES, REQUIRED_KEYS, loadCases, assertMatches } from './harness.js';

const cases = loadCases();

describe('Golden cases — estructura de los casos', () => {
  test('hay al menos los 8 casos de referencia obligatorios', () => {
    const ids = cases.map((c) => c.data.id);
    for (const required of [
      'on-call-basico',
      'margen-10-sobre-precio',
      'markup-10-sobre-costo',
      'conversion-margen-a-markup',
      'tarifa-piso-8-dias',
      'tarifa-margen-10-con-10-dias',
      'costo-financiero-simple',
      'caso-demo-referencia',
      // PLAN-2026-002: impuestos sobre la facturación (gross-up exacto).
      'gross-up-impuestos-facturacion',
      'tarifa-piso-con-impuestos',
      'markup-con-impuestos',
      'ganancia-sobre-costo-con-impuestos',
      'on-call-break-even-con-impuestos',
      'on-call-tarifa-minima-6-dias-con-impuestos',
      'on-call-cotizacion-con-impuestos',
    ]) {
      assert.ok(ids.includes(required), `falta el golden case ${required}`);
    }
  });

  test('cada caso tiene { id, title, rule, engine, inputs, expected, tolerance } válidos', () => {
    for (const { file, data } of cases) {
      for (const key of REQUIRED_KEYS) assert.ok(key in data, `${file}: falta "${key}"`);
      assert.equal(data.id, basename(file, '.json'), `${file}: el id debe coincidir con el nombre del archivo`);
      assert.ok(typeof data.title === 'string' && data.title.length > 0, `${file}: título vacío`);
      assert.ok(typeof data.rule === 'string' && data.rule.length > 0, `${file}: regla de negocio vacía`);
      assert.ok(data.engine in ENGINES, `${file}: motor desconocido "${data.engine}"`);
      assert.ok(data.inputs && typeof data.inputs === 'object' && !Array.isArray(data.inputs), `${file}: inputs debe ser un objeto`);
      assert.ok(data.expected && typeof data.expected === 'object' && Object.keys(data.expected).length > 0, `${file}: expected vacío`);
      assert.ok(typeof data.tolerance === 'number' && data.tolerance >= 0, `${file}: tolerancia inválida`);
    }
  });

  test('los ids no se repiten', () => {
    const ids = cases.map((c) => c.data.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('Golden cases — reglas de negocio', () => {
  for (const { file, data } of cases) {
    test(`${data.title} — ${data.rule}`, () => {
      const run = ENGINES[data.engine];
      assert.ok(run, `${file}: motor desconocido "${data.engine}"`);
      const result = run(structuredClone(data.inputs));
      for (const [path, expected] of Object.entries(data.expected)) {
        const actual = path === 'value' ? result.value : getPath(result, path);
        assertMatches(actual, expected, data.tolerance, `${data.id} → ${path}`);
      }
    });
  }
});
