/**
 * Build del sitio estático (scripts/build.mjs).
 *
 * Genera el sitio en un directorio temporal y verifica que contiene sólo lo
 * publicable, que version.json es correcto y que las rutas son relativas.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertSafeOutDir,
  build,
  classifyRef,
  extractCssUrls,
  extractHtmlRefs,
  extractImports,
  resolveBuildDate,
  resolveCommit,
  resolveRef,
  stripComments,
} from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function listRecursive(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listRecursive(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

describe('build({ outDir }) en un directorio temporal', () => {
  let tmp;
  let outDir;
  let result;
  const env = { GITHUB_SHA: 'ABCDEF1234567890abcdef1234567890abcdef12', BUILD_REF: 'v0.1.0' };
  const now = new Date('2026-01-02T03:04:05.000Z');

  before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'rateos-build-'));
    outDir = path.join(tmp, 'dist');
    result = await build({ outDir, env, now });
  });

  after(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('termina sin errores', () => {
    assert.deepEqual(result.errors, [], `Errores del build:\n  ${result.errors.join('\n  ')}`);
    assert.equal(result.ok, true);
    assert.equal(result.outDir, outDir);
  });

  test('contiene index.html, js/app.js, css/styles.css, .nojekyll y version.json', () => {
    for (const file of ['index.html', 'js/app.js', 'css/styles.css', '.nojekyll', 'version.json']) {
      assert.ok(existsSync(path.join(outDir, file)), `Falta ${file} en el build`);
    }
  });

  test('copia todos los módulos de js/ y todos los CSS', () => {
    const source = listRecursive(path.join(ROOT, 'js')).filter((f) => !/\.test\.[cm]?js$/.test(f) && !f.split('/').some((s) => s.startsWith('.')));
    const built = new Set(listRecursive(path.join(outDir, 'js')));
    const missing = source.filter((f) => !built.has(f));
    assert.deepEqual(missing, [], 'Módulos que faltan en dist/js');
    const css = readdirSync(path.join(ROOT, 'css')).filter((f) => f.endsWith('.css'));
    for (const f of css) assert.ok(existsSync(path.join(outDir, 'css', f)), `Falta css/${f}`);
  });

  test('version.json es válido y coincide con package.json', () => {
    const info = JSON.parse(readFileSync(path.join(outDir, 'version.json'), 'utf8'));
    assert.equal(info.version, PKG.version);
    assert.equal(info.commit, 'abcdef1', 'SHA corto de 7 caracteres, en minúsculas');
    assert.equal(info.ref, 'v0.1.0');
    assert.equal(info.buildDate, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(Object.keys(info).sort(), ['buildDate', 'commit', 'ref', 'version']);
    assert.deepEqual(result.versionInfo, info);
  });

  test('NO publica tests, docs, scripts, .github, node_modules, package.json ni dotfiles (salvo .nojekyll)', () => {
    for (const name of ['tests', 'docs', 'scripts', '.github', '.git', '.agent', 'node_modules', 'package.json', 'README.md', 'AGENTS.md', 'CHANGELOG.md', '.gitignore']) {
      assert.ok(!existsSync(path.join(outDir, name)), `dist/ no debe contener ${name}`);
    }
    const files = listRecursive(outDir);
    const dotfiles = files.filter((f) => f.split('/').some((seg) => seg.startsWith('.')) && f !== '.nojekyll');
    assert.deepEqual(dotfiles, []);
    assert.deepEqual(files.filter((f) => /\.test\.[cm]?js$/.test(f)), []);
    const topLevel = new Set(readdirSync(outDir));
    for (const entry of topLevel) {
      assert.ok(['index.html', '.nojekyll', 'version.json', 'assets', 'css', 'js'].includes(entry), `Entrada inesperada en dist/: ${entry}`);
    }
  });

  test('las rutas de dist/index.html son relativas', () => {
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    for (const ref of extractHtmlRefs(html)) {
      assert.ok(['relative', 'anchor', 'data'].includes(classifyRef(ref.value)), `${ref.attr}="${ref.value}" no es relativa`);
    }
    assert.ok(result.stats.jsImports > 0, 'El build debe validar imports de JS');
    assert.ok(result.stats.htmlRefs > 0, 'El build debe validar referencias del HTML');
  });

  test('es repetible: un segundo build limpia la salida anterior', async () => {
    const marker = path.join(outDir, 'basura-vieja.txt');
    rmSync(marker, { force: true });
    await import('node:fs/promises').then((fs) => fs.writeFile(marker, 'x'));
    const again = await build({ outDir, env, now });
    assert.equal(again.ok, true);
    assert.ok(!existsSync(marker), 'El build debe limpiar el directorio de salida');
  });
});

describe('build: metadatos de versión', () => {
  test('commit: BUILD_SHA tiene prioridad sobre GITHUB_SHA (rollback despliega otro commit)', () => {
    assert.equal(resolveCommit({ BUILD_SHA: '1111111aaaa', GITHUB_SHA: '2222222bbbb' }), '1111111');
    assert.equal(resolveCommit({ GITHUB_SHA: '2222222bbbb' }), '2222222');
  });

  test('commit: sin env usa git o "local"', () => {
    const commit = resolveCommit({}, ROOT);
    assert.ok(commit === 'local' || /^[0-9a-f]{7}$/.test(commit), commit);
    assert.equal(resolveCommit({ GITHUB_SHA: 'no-es-un-sha' }, os.tmpdir()), 'local');
  });

  test('ref: BUILD_REF → GITHUB_REF_NAME → "local", saneada', () => {
    assert.equal(resolveRef({ BUILD_REF: 'v1.2.3', GITHUB_REF_NAME: 'main' }), 'v1.2.3');
    assert.equal(resolveRef({ GITHUB_REF_NAME: 'main' }), 'main');
    assert.equal(resolveRef({}), 'local');
    assert.equal(resolveRef({ BUILD_REF: 'feature/x"<script>' }), 'feature/x--script-');
  });

  test('buildDate: ISO UTC; respeta SOURCE_DATE_EPOCH', () => {
    assert.equal(resolveBuildDate({}, new Date('2026-05-06T07:08:09Z')), '2026-05-06T07:08:09.000Z');
    assert.equal(resolveBuildDate({ SOURCE_DATE_EPOCH: '0' }), '1970-01-01T00:00:00.000Z');
  });
});

describe('build: protecciones', () => {
  test('rechaza outDir peligrosos (raíz del repo, padres, carpetas de código)', () => {
    assert.throws(() => assertSafeOutDir(ROOT, ROOT));
    assert.throws(() => assertSafeOutDir(path.dirname(ROOT), ROOT));
    assert.throws(() => assertSafeOutDir(path.parse(ROOT).root, ROOT));
    for (const dir of ['js', 'css', 'tests', 'docs', 'scripts', '.git', '.github', 'js/dist']) {
      assert.throws(() => assertSafeOutDir(path.join(ROOT, dir), ROOT), undefined, dir);
    }
    assert.equal(assertSafeOutDir(path.join(ROOT, 'dist'), ROOT), path.join(ROOT, 'dist'));
  });
});

describe('build: análisis de código', () => {
  test('stripComments ignora comentarios pero conserva strings, regex y longitud', () => {
    const src = "const a = 'http://x'; // c\n/* b */ const r = /\\/\\//g; const t = `${1}//x`;";
    const out = stripComments(src);
    assert.equal(out.length, src.length);
    assert.match(out, /'http:\/\/x'/);
    assert.doesNotMatch(out, /\/\/ c|\/\* b \*\//);
    assert.match(out, /\/\\\/\\\/\/g/);
    assert.match(out, /`\$\{1\}\/\/x`/);
  });

  test('extractImports: estáticos, re-exports y dinámicos; ignora comentarios y strings', () => {
    const src = [
      "import a from './a.js';",
      "import { b, c as d } from '../b.js';",
      "import './side.js';",
      "export * from './all.js';",
      "export { e } from \"./e.js\";",
      "const m = () => import('./lazy.js');",
      "// import x from './comentado.js';",
      "const s = { 'before-import': 'importar desde \"x\"' };",
      'const v = import(nombre);',
    ].join('\n');
    const imps = extractImports(src);
    assert.deepEqual(
      imps.filter((i) => i.specifier).map((i) => [i.specifier, i.kind]),
      [['./a.js', 'static'], ['../b.js', 'static'], ['./side.js', 'static'], ['./all.js', 'static'], ['./e.js', 'static'], ['./lazy.js', 'dynamic']],
    );
    assert.equal(imps.filter((i) => i.kind === 'dynamic-expression').length, 1);
  });

  test('extractHtmlRefs / extractCssUrls / classifyRef', () => {
    const refs = extractHtmlRefs('<!-- <script src="/x.js"></script> --><link rel="stylesheet" href="./css/a.css"><script type="module" src=\'./js/app.js\'></script>');
    assert.deepEqual(refs.map((r) => r.value), ['./css/a.css', './js/app.js']);
    assert.deepEqual(extractCssUrls('/* url(/no.png) */ a { background: url("../assets/x.svg") } @import "./b.css";').map((u) => u.value), ['../assets/x.svg', './b.css']);
    assert.equal(classifyRef('/js/app.js'), 'absolute');
    assert.equal(classifyRef('https://cdn.example.com/x.js'), 'external');
    assert.equal(classifyRef('//cdn.example.com/x.js'), 'external');
    assert.equal(classifyRef('./js/app.js'), 'relative');
    assert.equal(classifyRef('js/app.js'), 'relative');
    assert.equal(classifyRef('#main'), 'anchor');
    assert.equal(classifyRef('data:image/svg+xml,'), 'data');
  });
});
