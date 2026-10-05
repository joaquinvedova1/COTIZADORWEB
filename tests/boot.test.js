/**
 * boot.js — cargador del build publicado (cache busting, ver scripts/build.mjs).
 *
 * Contrato: pide version.json SIN caché, carga sólo rutas dentro de
 * build/<id>/ (nunca "..", nunca otro origen) y no usa HTML ni código inline.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractImports, stripComments } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(path.join(ROOT, 'boot.js'), 'utf8');
const CODE = stripComments(SOURCE);

function regexFrom(name) {
  const m = CODE.match(new RegExp(`const ${name} = \\/(.+)\\/([a-z]*);`));
  assert.ok(m, `boot.js define ${name}`);
  return new RegExp(m[1], m[2]);
}

describe('boot.js', () => {
  test('pide version.json relativo y sin caché', () => {
    assert.match(CODE, /fetch\('\.\/version\.json', \{ cache: 'no-store' \}\)/);
  });

  test('no tiene imports estáticos: sólo importa la entrada del manifiesto', () => {
    const imports = extractImports(SOURCE);
    assert.deepEqual(imports.map((i) => i.kind), ['dynamic-expression']);
    assert.match(CODE, /import\(`\.\/\$\{manifest\.base\}\$\{manifest\.entry\}`\)/);
  });

  test('sólo acepta carpetas build/<id>/ y archivos .js/.css relativos, sin ".."', () => {
    const BASE_RE = regexFrom('BASE_RE');
    const FILE_RE = regexFrom('FILE_RE');
    for (const ok of ['build/afb761f/', 'build/local-deadbeefca/']) assert.ok(BASE_RE.test(ok), ok);
    for (const bad of ['build/../', 'build/./', 'build/.x/', 'build/', '/build/a/', 'https://x/build/a/', 'build/a/b/', 'js/', 'build/a']) assert.ok(!BASE_RE.test(bad), bad);
    for (const ok of ['js/app.js', 'css/styles.css', 'css/a.b.css']) assert.ok(FILE_RE.test(ok), ok);
    for (const bad of ['../js/app.js', 'js/../app.js', '/js/app.js', '//x/app.js', 'js/app.mjs', 'js/app.js?x', 'x.html']) assert.ok(!FILE_RE.test(bad), bad);
  });

  test('sin innerHTML, eval, document.write ni console', () => {
    assert.doesNotMatch(CODE, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|console\./);
  });
});
