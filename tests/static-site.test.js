/**
 * Contrato del sitio estático (GitHub Pages bajo /COTIZADORWEB/).
 *
 * - index.html: idioma, viewport, CSP estricta, título, rutas relativas.
 * - .nojekyll, version.json y package.json válidos.
 * - El workflow de deploy ejecuta los tests antes de desplegar.
 * - scripts/serve.mjs simula Pages bajo /COTIZADORWEB/ y bloquea path traversal.
 */

import { SUPABASE } from '../js/config.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRef, extractHtmlRefs, refToPath } from '../scripts/build.mjs';
import { createStaticServer, resolveSafePath } from '../scripts/serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const INDEX_PATH = path.join(ROOT, 'index.html');

function parseCsp(html) {
  const m = html.match(/<meta\s+[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/i);
  if (!m) return null;
  const content = m[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  const value = content ? content[1] ?? content[2] : '';
  const directives = {};
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return directives;
}

describe('index.html', () => {
  test('existe', () => {
    assert.ok(existsSync(INDEX_PATH), 'Falta index.html en la raíz del repo');
  });

  const html = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf8') : '';

  test('declara idioma es-AR, charset utf-8 y meta viewport', () => {
    assert.match(html, /<html[^>]*\slang\s*=\s*["']es-AR["']/i, 'Falta <html lang="es-AR">');
    assert.match(html, /<meta\s+charset\s*=\s*["']?utf-8["']?/i, 'Falta <meta charset="utf-8">');
    assert.match(html, /<meta\s+[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i, 'Falta meta viewport');
  });

  test('el título incluye RATEOS', () => {
    const m = html.match(/<title>([^<]*)<\/title>/i);
    assert.ok(m, 'Falta <title>');
    assert.match(m[1], /RATEOS/);
  });

  test('tiene una CSP estricta (sin inline/eval ni orígenes externos)', () => {
    const csp = parseCsp(html);
    assert.ok(csp, 'Falta <meta http-equiv="Content-Security-Policy">');
    assert.deepEqual(csp['default-src'], ["'self'"], "default-src debe ser 'self'");
    const scriptSrc = csp['script-src'] ?? csp['default-src'];
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'blob:']) {
      assert.ok(!scriptSrc.includes(bad), `script-src no debe incluir ${bad}`);
    }
    assert.deepEqual(csp['object-src'], ["'none'"], "object-src debe ser 'none'");
    assert.ok(csp['base-uri'] && csp['base-uri'].every((s) => s === "'self'" || s === "'none'"), "base-uri debe ser 'self' o 'none'");
    // Único origen externo permitido: el proyecto de Supabase (sólo para conectarse
    // a su API: Auth y datos con RLS). Nunca scripts, estilos ni imágenes externas.
    for (const [directive, sources] of Object.entries(csp)) {
      for (const source of sources) {
        if (directive === 'connect-src' && source === SUPABASE.url) continue;
        assert.ok(!/^(?:https?:|\*|\/\/)/i.test(source) && !/\.[a-z]{2,}(?::\d+)?(?:\/|$)/i.test(source), `${directive} no debe permitir orígenes externos (${source})`);
      }
    }
    const connect = csp['connect-src'] ?? csp['default-src'];
    assert.deepEqual(connect, ["'self'", SUPABASE.url], 'connect-src: sólo self y el proyecto de Supabase');
    assert.match(SUPABASE.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });

  test('carga la app como ES module con ruta relativa', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    const app = scripts.find((tag) => /\ssrc\s*=\s*["']\.\/js\/app\.js["']/.test(tag));
    assert.ok(app, 'Falta <script type="module" src="./js/app.js">');
    assert.match(app, /\stype\s*=\s*["']module["']/, 'El script de la app debe ser type="module"');
  });

  test('sin scripts inline, handlers on*, estilos inline ni <base> (CSP y sub-ruta)', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attrs, body] of scripts) {
      assert.match(attrs, /\ssrc\s*=/, 'Todo <script> debe tener src (la CSP bloquea scripts inline)');
      assert.equal(body.trim(), '', 'Un <script src> no debe tener contenido');
    }
    const tags = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]);
    for (const tag of tags) {
      assert.doesNotMatch(tag, /\son[a-z]+\s*=/i, `Handler inline no permitido: ${tag}`);
      assert.doesNotMatch(tag, /\sstyle\s*=/i, `Atributo style no permitido (CSP style-src 'self'): ${tag}`);
    }
    assert.doesNotMatch(html, /<style\b/i, "<style> inline no permitido (CSP style-src 'self')");
    assert.doesNotMatch(html, /<base\b/i, '<base> rompe las rutas relativas bajo /COTIZADORWEB/');
  });

  test('todos los src/href locales son relativos y existen', () => {
    const refs = extractHtmlRefs(html);
    assert.ok(refs.length > 0, 'index.html no referencia recursos');
    const problems = [];
    for (const ref of refs) {
      const kind = classifyRef(ref.value);
      const where = `<${ref.tag} ${ref.attr}="${ref.value}"> (línea ${ref.line})`;
      if (kind === 'anchor' || kind === 'data') continue;
      if (kind === 'absolute') problems.push(`${where}: empieza con "/" (rompe bajo /COTIZADORWEB/)`);
      else if (kind === 'external') problems.push(`${where}: recurso externo`);
      else if (kind === 'empty') problems.push(`${where}: vacío`);
      else {
        const target = path.resolve(ROOT, refToPath(ref.value));
        if (!target.startsWith(ROOT + path.sep)) problems.push(`${where}: sale del repo`);
        else if (!existsSync(target) || !statSync(target).isFile()) problems.push(`${where}: no existe`);
      }
    }
    assert.deepEqual(problems, [], `Referencias inválidas en index.html:\n  ${problems.join('\n  ')}`);
  });
});

describe('archivos del sitio', () => {
  test('existe .nojekyll (GitHub Pages no procesa el sitio con Jekyll)', () => {
    assert.ok(existsSync(path.join(ROOT, '.nojekyll')), 'Falta .nojekyll');
  });

  test('version.json es JSON válido con version y commit', () => {
    const data = JSON.parse(read('version.json'));
    assert.equal(typeof data.version, 'string');
    assert.match(data.version, /^\d+\.\d+\.\d+/);
    assert.equal(typeof data.commit, 'string');
    assert.ok(data.commit.length > 0);
  });

  test('package.json: type module y scripts test/build/start', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.scripts && typeof pkg.scripts.test === 'string', 'Falta script "test"');
    assert.match(pkg.scripts.test, /^node --test\b/, 'npm test debe usar el runner nativo de Node');
    assert.ok(typeof pkg.scripts.build === 'string', 'Falta script "build"');
    assert.ok(typeof pkg.scripts.start === 'string', 'Falta script "start"');
  });

  test('el workflow de deploy corre los tests antes de desplegar y admite rollback', () => {
    const wf = read('.github/workflows/deploy-pages.yml');
    assert.match(wf, /^on:\s*$[\s\S]*?^\s+push:\s*$[\s\S]*?branches:\s*\[\s*main\s*\]/m, 'Debe dispararse con push a main');
    assert.match(wf, /^\s+workflow_dispatch:\s*$[\s\S]*?^\s+ref:\s*$/m, 'Debe admitir workflow_dispatch con input "ref" (rollback)');
    assert.match(wf, /run:\s*npm test/, 'Debe ejecutar npm test');
    assert.match(wf, /^\s+build:\s*$[\s\S]*?needs:\s*\[[^\]]*\btest\b[^\]]*\]/m, 'El build debe depender de los tests');
    assert.match(wf, /needs\.test\.result == 'success'/, 'Sin tests de producción en verde no hay build');
    assert.match(wf, /^\s+deploy:\s*$[\s\S]*?needs:\s*build\b/m, 'El deploy debe depender del build');
    assert.match(wf, /actions\/upload-pages-artifact@v\d+[\s\S]*?path:\s*dist\b/, 'Debe publicar dist/');
    assert.match(wf, /actions\/deploy-pages@v\d+/);
  });

  test('staging en /preview/: nunca reemplaza producción', () => {
    const wf = read('.github/workflows/deploy-pages.yml');
    const job = (name) => {
      const m = wf.match(new RegExp(`^  ${name}:\\s*$([\\s\\S]*?)(?=^  [a-z][a-z_-]*:\\s*$|(?![\\s\\S]))`, 'm'));
      assert.ok(m, `falta el job ${name}`);
      return m[1];
    };
    // Producción: sólo commits que están en main.
    assert.match(job('plan'), /git merge-base --is-ancestor "\$SHA" origin\/main/);
    assert.match(job('test'), /ref: \$\{\{ needs\.plan\.outputs\.sha \}\}/, 'los tests de producción usan el commit de main');
    assert.match(job('build'), /ref: \$\{\{ needs\.plan\.outputs\.sha \}\}/, 'la raíz se construye con el commit de main');
    // Preview: sólo CI exitoso de un push a una rama de este repo (nunca forks ni main).
    assert.match(wf, /workflow_run:\s*\n\s+workflows: \[CI\]\s*\n\s+types: \[completed\]\s*\n\s+branches-ignore: \[main, "dependabot\/\*\*"\]/);
    assert.match(job('plan'), /workflow_run\.conclusion == 'success'/);
    assert.match(job('plan'), /workflow_run\.event == 'push'/);
    assert.match(job('plan'), /head_repository\.full_name == github\.repository/);
    // El código de la rama corre sin permisos de escritura ni credenciales.
    const preview = job('preview');
    assert.match(preview, /permissions:\s*\n\s+contents: read\s*\n/);
    assert.doesNotMatch(preview, /pages: write|id-token|contents: write/);
    assert.match(preview, /persist-credentials: false/);
    assert.match(preview, /run: npm test/, 'el preview también pasa sus tests');
    // Sólo deploy escribe en Pages; build no tiene permisos de escritura.
    assert.doesNotMatch(job('build'), /pages: write|id-token: write/);
    assert.match(job('deploy'), /pages: write/);
    // La cola de despliegues vive en el job deploy: una corrida salteada (CI de
    // pull_request) nunca cancela el deploy pendiente de un preview.
    assert.match(job('deploy'), /concurrency:\s*\n\s+group: "pages"\s*\n\s+cancel-in-progress: false/);
    assert.doesNotMatch(wf, /^concurrency:/m, 'sin concurrencia a nivel workflow');
    // /preview/ se arma con el script de main, que verifica que producción no cambie.
    assert.match(job('build'), /git show origin\/main:scripts\/stage-preview\.mjs/);
    assert.match(job('build'), /--site dist --from/);
    // Un deploy de preview atrasado nunca pisa uno más nuevo: antes de publicar
    // se verifica que el commit siga siendo el último de la rama (y si no, no se publica).
    const deploy = job('deploy');
    const guard = deploy.indexOf('git ls-remote');
    assert.ok(guard > 0, 'deploy verifica el último commit de la rama del preview');
    assert.ok(guard < deploy.indexOf('actions/deploy-pages@'), 'la verificación va antes de publicar');
    assert.match(deploy, /if: needs\.build\.outputs\.preview_trigger == 'preview'/);
    assert.match(deploy, /\[ "\$HEAD_SHA" != "\$PREVIEW_SHA" \][\s\S]*?exit 1/);
    assert.match(job('build'), /preview_sha: \$\{\{ needs\.plan\.outputs\.preview_sha \}\}/);
  });

  test('los workflows no interpolan datos controlables por usuarios dentro de scripts (inyección)', () => {
    for (const file of ['.github/workflows/deploy-pages.yml', '.github/workflows/ci.yml']) {
      const injected = runBlocks(read(file)).filter((block) =>
        /\$\{\{[^}]*\b(?:inputs\.|github\.event\.|github\.head_ref)/.test(block.text),
      );
      assert.deepEqual(injected.map((b) => `${file}:${b.line}`), [], 'Pasá esos valores por env: y usalos como "$VAR"');
    }
  });
});

/** Extrae el contenido de cada `run:` de un workflow (inline o bloque `|`). */
function runBlocks(yamlText) {
  const lines = yamlText.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const body = [m[2]];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > indent)) {
      body.push(lines[j]);
      j += 1;
    }
    blocks.push({ line: i + 1, text: body.join('\n') });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Servidor local (scripts/serve.mjs)

function request(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('servidor local bajo /COTIZADORWEB/ (scripts/serve.mjs)', () => {
  let server;
  let port;

  before(async () => {
    server = createStaticServer({ root: ROOT });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('redirige / y /COTIZADORWEB a /COTIZADORWEB/', async () => {
    for (const p of ['/', '/COTIZADORWEB']) {
      const res = await request(port, p);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.location, '/COTIZADORWEB/');
    }
  });

  test('sirve index.html, módulos JS y version.json con content-type correcto', async () => {
    const index = await request(port, '/COTIZADORWEB/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /^text\/html/);
    assert.match(index.body, /RATEOS/);

    const js = await request(port, '/COTIZADORWEB/js/config.js');
    assert.equal(js.status, 200);
    assert.match(js.headers['content-type'], /^text\/javascript/);

    const css = await request(port, '/COTIZADORWEB/css/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/css/);

    const version = await request(port, '/COTIZADORWEB/version.json?x=1');
    assert.equal(version.status, 200);
    assert.match(version.headers['content-type'], /^application\/json/);
    assert.equal(typeof JSON.parse(version.body).version, 'string');

    const head = await request(port, '/COTIZADORWEB/index.html', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });

  test('bloquea path traversal (también codificado)', async () => {
    for (const p of [
      '/COTIZADORWEB/../package.json',
      '/COTIZADORWEB/../../../../etc/passwd',
      '/COTIZADORWEB/%2e%2e/%2e%2e/etc/passwd',
      '/COTIZADORWEB/..%2f..%2f..%2fetc%2fpasswd',
      '/COTIZADORWEB/js/..%5c..%5cpackage.json',
      '/COTIZADORWEB/%00index.html',
      '/COTIZADORWEB/%E0%A4%A',
    ]) {
      const res = await request(port, p);
      assert.ok([400, 403, 404].includes(res.status), `${p} → ${res.status}`);
      assert.doesNotMatch(res.body, /root:|"name":\s*"rateos"/, `${p} filtró contenido`);
    }
  });

  test('no sirve dotfiles (salvo .nojekyll), node_modules ni rutas fuera del prefijo', async () => {
    for (const p of ['/COTIZADORWEB/.git/config', '/COTIZADORWEB/.gitignore', '/COTIZADORWEB/.env', '/COTIZADORWEB/node_modules/x.js', '/package.json', '/js/app.js']) {
      const res = await request(port, p);
      assert.equal(res.status, 404, p);
    }
    const nojekyll = await request(port, '/COTIZADORWEB/.nojekyll');
    assert.equal(nojekyll.status, 200);
  });

  test('sólo acepta GET y HEAD', async () => {
    const res = await request(port, '/COTIZADORWEB/', 'POST');
    assert.equal(res.status, 405);
  });

  test('resolveSafePath rechaza rutas peligrosas', () => {
    assert.equal(resolveSafePath(ROOT, '../etc/passwd'), null);
    assert.equal(resolveSafePath(ROOT, '%2e%2e/x'), null);
    assert.equal(resolveSafePath(ROOT, 'a/../../x'), null);
    assert.equal(resolveSafePath(ROOT, '.git/config'), null);
    assert.equal(resolveSafePath(ROOT, 'js\\..\\..\\x'), null);
    assert.equal(resolveSafePath(ROOT, '%zz'), null);
    assert.equal(resolveSafePath(ROOT, 'js/app.js'), path.join(ROOT, 'js', 'app.js'));
    assert.equal(resolveSafePath(ROOT, ''), ROOT);
  });
});
