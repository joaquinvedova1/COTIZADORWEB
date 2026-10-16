/**
 * RATEOS Test Lab — el oráculo es INDEPENDIENTE del motor (PLAN-2026-013).
 *
 * Verificar el motor llamándolo dos veces no prueba nada. El oráculo no puede
 * importar js/ (ni motores, ni dominio, ni core): sus fórmulas se escriben de
 * nuevo desde docs/CALCULATION_RULES.md. Además el lab es reproducible: nada
 * de Math.random ni de la fecha actual en los cálculos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImports } from '../../scripts/build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');

test('oracle.js y product-oracle.js no importan nada de js/ (ni motores, ni dominio, ni core)', () => {
  for (const file of ['lib/oracle.js', 'lib/product-oracle.js']) {
    const imports = extractImports(read(file)).map((i) => i.specifier).filter(Boolean);
    const bad = imports.filter((s) => !/^\.\/[a-z-]+\.js$/.test(s));
    assert.deepEqual(bad, [], `${file} importa ${bad.join(', ')}`);
  }
});

test('el product-oracle sólo reutiliza helpers del oráculo (no del motor de productos)', () => {
  const imports = extractImports(read('lib/product-oracle.js')).map((i) => i.specifier);
  assert.deepEqual(imports, ['./oracle.js']);
});

test('el lab es reproducible: sin Math.random ni Date.now/new Date() en librerías y escenarios', () => {
  const files = [...readdirSync(path.join(HERE, 'lib')).map((f) => `lib/${f}`), ...readdirSync(path.join(HERE, 'scenarios')).map((f) => `scenarios/${f}`)].filter((f) => f.endsWith('.js'));
  const hits = files.flatMap((f) => read(f).split('\n').map((line, i) => ({ f, i, line })).filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && /Math\.random\(|Date\.now\(|new Date\(/.test(line)).map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`));
  assert.deepEqual(hits, []);
});
