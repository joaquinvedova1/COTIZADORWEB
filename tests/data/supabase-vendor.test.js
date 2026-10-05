/**
 * SDK oficial de Supabase copiado en js/data/vendor/supabase.js.
 *
 * - Integridad: el tramo original es byte a byte el dist/umd/supabase.js de
 *   @supabase/supabase-js 2.117.2 (sha256 fijo; el tarball se verificó
 *   contra la integridad publicada en el registro de npm).
 * - Sólo lo importa js/data/supabase-client.js (la UI nunca).
 * - Compatible con la CSP (script-src 'self'): sin eval ni new Function, y
 *   sin inyectar HTML.
 * - package.json sigue sin dependencias.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(ROOT, 'js', 'data', 'vendor', 'supabase.js');
const UPSTREAM_SHA256 = '59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd';
const source = readFileSync(FILE, 'utf8');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

describe('js/data/vendor/supabase.js', () => {
  test('el tramo original no fue modificado (sha256)', () => {
    const begin = '// --- upstream begin ---\n';
    const end = '\n// --- upstream end ---';
    const start = source.indexOf(begin);
    const stop = source.lastIndexOf(end);
    assert.ok(start > 0 && stop > start);
    const upstream = source.slice(start + begin.length, stop);
    assert.equal(createHash('sha256').update(upstream, 'utf8').digest('hex'), UPSTREAM_SHA256);
  });

  test('sólo agrega exports ES al final', () => {
    const tail = source.slice(source.lastIndexOf('// --- upstream end ---'));
    assert.match(tail, /export const createClient = supabase\.createClient;\nexport default supabase;\n$/);
  });

  test('sólo lo importa js/data/supabase-client.js', () => {
    const importers = walk(path.join(ROOT, 'js'))
      .filter((f) => !f.includes(`${path.sep}vendor${path.sep}`))
      .filter((f) => /vendor\/supabase\.js/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    assert.deepEqual(importers, ['js/data/supabase-client.js']);
  });

  test('compatible con la CSP y sin inyección de HTML', () => {
    assert.doesNotMatch(source, /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/);
    assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  });

  test('package.json sigue sin dependencias (el SDK no se instala con npm)', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
  });
});
