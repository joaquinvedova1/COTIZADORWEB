/**
 * Reglas de arquitectura y seguridad de RATEOS, expresadas como tests.
 *
 * Recorre el código que exista al momento de correr (no hay listas fijas de
 * archivos de UI), así que cualquier vista nueva queda cubierta.
 *
 * Los comentarios se ignoran (la documentación puede MENCIONAR APIs
 * prohibidas para explicar por qué no se usan); los strings sí se analizan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractImports, isRelativeSpecifier, ROOT_ABSOLUTE_LITERAL_RE, stripComments } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');

const toPosix = (p) => p.split(path.sep).join('/');
const rel = (abs) => toPosix(path.relative(ROOT, abs));

function walk(dir, { skipDirs = new Set() } = {}) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...walk(full, { skipDirs }));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Código de terceros copiado sin cambios (hoy sólo el SDK oficial de
 * Supabase): no sigue las reglas de estilo del proyecto, pero tiene sus
 * propios controles (integridad, único importador, sin eval/innerHTML) en
 * tests/data/supabase-vendor.test.js.
 */
const VENDOR_DIR = 'js/data/vendor/';

/** Módulos JS propios del frontend, cargados una sola vez. */
const JS_FILES = walk(JS_DIR)
  .filter((f) => f.endsWith('.js') && !rel(f).startsWith(VENDOR_DIR))
  .map((abs) => {
    const source = readFileSync(abs, 'utf8');
    return { abs, rel: rel(abs), source, code: stripComments(source), imports: extractImports(source) };
  });

/** Capa a la que pertenece un archivo de js/ ("engines", "ui", "app", "config", …). */
function layerOf(relPath) {
  const parts = relPath.split('/');
  if (parts[0] !== 'js') return null;
  if (parts.length === 2) return parts[1].replace(/\.js$/, ''); // app, config
  return parts[1];
}

/** Imports resueltos a rutas del repo (sólo los relativos y literales). */
function resolvedImports(file) {
  return file.imports
    .filter((imp) => imp.specifier && isRelativeSpecifier(imp.specifier))
    .map((imp) => ({ ...imp, target: rel(path.resolve(path.dirname(file.abs), imp.specifier)) }));
}

/** Busca un patrón línea por línea en el código sin comentarios. */
function findInCode(file, pattern) {
  const hits = [];
  file.code.split('\n').forEach((line, idx) => {
    if (pattern.test(line)) hits.push(`${file.rel}:${idx + 1}: ${line.trim().slice(0, 140)}`);
  });
  return hits;
}

function report(hits, message) {
  assert.deepEqual(hits, [], `${message}\n  ${hits.join('\n  ')}`);
}

/** Archivos versionables: los de git (incluye nuevos no ignorados) o, sin git, un recorrido del repo. */
function versionedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const files = [...new Set(out.split('\0').filter(Boolean))]
      .map((p) => path.join(ROOT, p))
      .filter((abs) => existsSync(abs) && statSync(abs).isFile());
    if (files.length > 0) return files;
  } catch {
    /* sin git: se recorre el árbol */
  }
  return walk(ROOT, { skipDirs: new Set(['.git', 'node_modules', 'dist', 'coverage']) });
}

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.otf', '.eot']);

function readTextOrNull(abs) {
  if (BINARY_EXT.has(path.extname(abs).toLowerCase())) return null;
  const buf = readFileSync(abs);
  if (buf.length > 5 * 1024 * 1024 || buf.includes(0)) return null;
  return buf.toString('utf8');
}

// Patrones de secretos. Se arman concatenando para que este archivo no se
// detecte a sí mismo.
const PLACEHOLDER_RE = /^(?:x+|\*+|\.\.\.|<[^>]*>|\$\{?[A-Z_]+\}?|tu[-_].*|your[-_].*|example.*|ejemplo.*|placeholder.*|changeme.*|redacted.*)$/i;
const SECRET_PATTERNS = [
  { name: 'Stripe live secret key', re: new RegExp('\\b(?:sk|rk)' + '_live_[0-9A-Za-z]{8,}') },
  { name: 'Clave privada PEM', re: new RegExp('-----BEGIN ' + '(?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY' + '( BLOCK)?-----') },
  { name: 'AWS access key id', re: new RegExp('\\b' + 'AKIA' + '[0-9A-Z]{16}\\b') },
  { name: 'GitHub token', re: new RegExp('\\bgh[pousr]' + '_[A-Za-z0-9]{36}\\b') },
  { name: 'GitHub fine-grained token', re: new RegExp('\\bgithub' + '_pat_[A-Za-z0-9_]{22,}') },
  { name: 'Google API key', re: new RegExp('\\b' + 'AIza' + '[0-9A-Za-z_-]{35}\\b') },
  { name: 'Slack token', re: new RegExp('\\bxox' + '[abprs]-[0-9A-Za-z-]{10,}') },
  { name: 'Supabase secret key', re: new RegExp('\\bsb_' + 'secret_[A-Za-z0-9_-]{8,}') },
  { name: 'Connection string de Postgres con contraseña', re: new RegExp('postgres(?:ql)?:' + '\\/\\/[^\\s:/@]+:(?!\\[)[^\\s@/]{6,}@') },
  { name: 'JWT (p. ej. clave anon/service_role de Supabase)', re: new RegExp('\\beyJ' + '[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}') },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY con valor',
    re: new RegExp('SUPABASE_SERVICE_ROLE' + '_KEY\\s*[=:]\\s*["\']?([^\\s"\'#`]{8,})'),
    valueGroup: 1,
  },
  {
    name: 'clave service_role con valor',
    re: new RegExp('service' + '_role[\\w-]*["\']?\\s*[=:]\\s*["\']([A-Za-z0-9._-]{20,})'),
    valueGroup: 1,
  },
];

/** Busca secretos en un texto. Devuelve los nombres de patrón encontrados por línea. */
function scanForSecrets(text) {
  const hits = [];
  text.split('\n').forEach((line, idx) => {
    for (const p of SECRET_PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      if (p.valueGroup && PLACEHOLDER_RE.test(m[p.valueGroup])) continue;
      hits.push({ line: idx + 1, name: p.name });
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------

describe('arquitectura: inventario', () => {
  test('existe js/ con módulos para analizar', () => {
    assert.ok(JS_FILES.length > 0, 'No se encontraron archivos en js/');
    for (const required of ['js/config.js', 'js/core', 'js/engines', 'js/data', 'js/services', 'js/ui']) {
      assert.ok(existsSync(path.join(ROOT, required)), `Falta ${required}`);
    }
  });
});

describe('arquitectura: persistencia sólo vía js/data', () => {
  test('(1) ningún archivo fuera de js/data/ usa localStorage, sessionStorage, indexedDB ni cookies', () => {
    const hits = JS_FILES.filter((f) => !f.rel.startsWith('js/data/')).flatMap((f) =>
      findInCode(f, /\b(?:localStorage|sessionStorage|indexedDB)\b|document\s*\.\s*cookie/),
    );
    report(hits, 'Acceso a almacenamiento fuera de js/data/ (usá StorageRepository vía servicios):');
  });

  test('nunca se usa localStorage.clear() (ni siquiera en js/data)', () => {
    const hits = JS_FILES.flatMap((f) => findInCode(f, /\b(?:localStorage|sessionStorage|storage)\s*\.\s*clear\s*\(/));
    report(hits, 'localStorage.clear() borra datos del usuario:');
  });
});

describe('arquitectura: seguridad del DOM y del código', () => {
  test('(2) ningún archivo de js/ usa innerHTML, outerHTML, insertAdjacentHTML, document.write, eval ni new Function', () => {
    const hits = JS_FILES.flatMap((f) =>
      findInCode(f, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\s*\.\s*write(?:ln)?\s*\(|(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/),
    );
    report(hits, 'APIs de inyección de HTML/código prohibidas (usá h() de js/ui/dom.js):');
  });

  test('setTimeout/setInterval nunca reciben código como string', () => {
    const hits = JS_FILES.flatMap((f) => findInCode(f, /\bset(?:Timeout|Interval)\s*\(\s*['"`]/));
    report(hits, 'setTimeout/setInterval con string equivale a eval:');
  });

  test('(6) no hay console.* fuera del logger (js/core/logger.js) ni debugger', () => {
    const hits = JS_FILES.filter((f) => f.rel !== 'js/core/logger.js').flatMap((f) => findInCode(f, /\bconsole\s*\.|\bdebugger\b/));
    report(hits, 'Usá logger de js/core/logger.js en lugar de console.*:');
  });

  test('sin red externa: no hay XMLHttpRequest, WebSocket, EventSource, sendBeacon ni fetch a URLs absolutas', () => {
    const hits = JS_FILES.flatMap((f) =>
      findInCode(f, /\b(?:XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\s*\(|\bfetch\w*\s*\(\s*['"`](?:https?:)?\/\//),
    );
    report(hits, 'RATEOS no se conecta a servicios externos:');
  });

  test('la UI no usa estilos inline como string (la CSP style-src \'self\' los bloquea)', () => {
    const uiFiles = JS_FILES.filter((f) => ['ui', 'app'].includes(layerOf(f.rel)));
    const hits = uiFiles.flatMap((f) => [
      ...findInCode(f, /setAttribute\s*\(\s*['"]style['"]|\.style\s*\.\s*cssText\s*=|\.style\s*=\s*['"`]/),
      ...findInCode(f, /[{,]\s*style\s*:\s*['"`](?!(?:currency|percent|decimal|unit)['"`])/),
    ]);
    report(hits, 'Usá clases CSS o { style: { prop: valor } } (CSSOM) en lugar de atributos style:');
  });

  test('ningún string de js/ apunta a la raíz del dominio (el sitio vive bajo /COTIZADORWEB/)', () => {
    const hits = JS_FILES.flatMap((f) => findInCode(f, ROOT_ABSOLUTE_LITERAL_RE));
    report(hits, 'Usá rutas relativas ("./…"):');
  });
});

describe('arquitectura: capas', () => {
  test('(3) los motores (js/engines) son puros: sin DOM, storage, red ni imports de ui/data/services', () => {
    const engines = JS_FILES.filter((f) => layerOf(f.rel) === 'engines');
    assert.ok(engines.length > 0, 'No hay motores en js/engines');
    const hits = engines.flatMap((f) => findInCode(f, /\b(?:document|window|globalThis|localStorage|sessionStorage|indexedDB|fetch|navigator|XMLHttpRequest)\b/));
    report(hits, 'Los motores no pueden tocar DOM, almacenamiento ni red:');

    const allowed = new Set(['core', 'domain', 'engines', 'config']);
    const badImports = engines.flatMap((f) =>
      resolvedImports(f)
        .filter((imp) => !allowed.has(layerOf(imp.target)))
        .map((imp) => `${f.rel}:${imp.line} importa ${imp.specifier}`),
    );
    report(badImports, 'Los motores sólo pueden importar core, domain, config y otros motores:');
  });

  test('los motores son determinísticos (sin Math.random, Date.now, new Date() ni crypto)', () => {
    const hits = JS_FILES.filter((f) => layerOf(f.rel) === 'engines').flatMap((f) =>
      findInCode(f, /\bMath\s*\.\s*random\b|\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|\bcrypto\b|\bperformance\s*\.\s*now\b/),
    );
    report(hits, 'Mismos inputs = mismos outputs:');
  });

  test('(4) la UI (js/ui y js/app.js) no importa la capa de datos (usa servicios)', () => {
    const ui = JS_FILES.filter((f) => ['ui', 'app'].includes(layerOf(f.rel)));
    const hits = ui.flatMap((f) =>
      [
        ...resolvedImports(f).filter((imp) => layerOf(imp.target) === 'data'),
        ...f.imports.filter((imp) => imp.specifier && /(?:^|\/)data\//.test(imp.specifier) && /^\.\.?\//.test(imp.specifier)),
      ].map((imp) => `${f.rel}:${imp.line} importa ${imp.specifier}`),
    );
    report([...new Set(hits)], 'La UI no puede importar js/data/*:');
  });

  test('las capas inferiores no importan capas superiores', () => {
    const forbidden = {
      core: new Set(['ui', 'app', 'services', 'data', 'engines', 'domain']),
      config: new Set(['ui', 'app', 'services', 'data', 'engines', 'domain', 'core']),
      domain: new Set(['ui', 'app', 'services', 'data']),
      data: new Set(['ui', 'app', 'services']),
      services: new Set(['ui', 'app']),
    };
    const hits = JS_FILES.flatMap((f) => {
      const layer = layerOf(f.rel);
      const banned = forbidden[layer];
      if (!banned) return [];
      return resolvedImports(f)
        .filter((imp) => banned.has(layerOf(imp.target)))
        .map((imp) => `${f.rel}:${imp.line} (${layer}) importa ${imp.specifier}`);
    });
    report(hits, 'Dependencia de capa invertida:');
  });
});

describe('arquitectura: imports', () => {
  test('(5) todos los imports de js/ son relativos y resuelven a archivos existentes dentro de js/', () => {
    const problems = [];
    let count = 0;
    for (const f of JS_FILES) {
      for (const imp of f.imports) {
        if (imp.kind === 'dynamic-expression') continue;
        count += 1;
        const where = `${f.rel}:${imp.line} import "${imp.specifier}"`;
        if (!isRelativeSpecifier(imp.specifier)) {
          problems.push(`${where}: no es relativo ("./" o "../")`);
          continue;
        }
        if (!imp.specifier.endsWith('.js')) problems.push(`${where}: debe incluir la extensión .js (ES modules nativos)`);
        const target = path.resolve(path.dirname(f.abs), imp.specifier);
        const fromJs = path.relative(JS_DIR, target);
        if (fromJs.startsWith('..') || path.isAbsolute(fromJs)) problems.push(`${where}: sale de js/`);
        else if (!existsSync(target) || !statSync(target).isFile()) problems.push(`${where}: el archivo no existe`);
      }
    }
    assert.ok(count > 0, 'No se encontraron imports en js/');
    report(problems, 'Imports inválidos:');
  });

  test('los imports dinámicos usan rutas literales (verificables)', () => {
    const hits = JS_FILES.flatMap((f) =>
      f.imports.filter((imp) => imp.kind === 'dynamic-expression').map((imp) => `${f.rel}:${imp.line}`),
    );
    report(hits, 'import() con expresión no literal (no verificable por los tests ni el build):');
  });
});

describe('seguridad del repositorio', () => {
  const FILES = versionedFiles();

  test('el detector de secretos funciona (autoprueba)', () => {
    const fakeAws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const fakeRole = 'SUPABASE_SERVICE_ROLE' + '_KEY=' + 'abc123def456ghi789jkl';
    const fakePem = '-----BEGIN ' + 'PRIVATE KEY-----';
    assert.equal(scanForSecrets(fakeAws).length, 1);
    assert.equal(scanForSecrets(fakeRole).length, 1);
    assert.equal(scanForSecrets(fakePem).length, 1);
    // Mencionar el nombre de la variable en documentación está permitido.
    assert.equal(scanForSecrets('Nunca expongas SUPABASE_SERVICE_ROLE' + '_KEY en el navegador.').length, 0);
    assert.equal(scanForSecrets('SUPABASE_SERVICE_ROLE' + '_KEY=<tu-clave>').length, 0);
    assert.equal(scanForSecrets('La clave service' + '_role sólo vive en el backend.').length, 0);
    // Supabase: la secret key y una connection string con contraseña se detectan;
    // la publishable key y el placeholder [YOUR-PASSWORD] no.
    assert.equal(scanForSecrets('const k = "sb_' + 'secret_AbCdEf123456";').length, 1);
    assert.equal(scanForSecrets('postgresql://postgres:' + 'hunter2pass@db.example.supabase.co:5432/postgres').length, 1);
    assert.equal(scanForSecrets('postgresql://postgres:[YOUR-PASSWORD]@db.example.supabase.co:5432/postgres').length, 0);
    assert.equal(scanForSecrets("publishableKey: 'sb_publishable_0zN4iQ1quvW2kC8XScqNGw_ZQ1F6ztW'").length, 0);
  });

  test('(7) no hay secretos en los archivos versionados', () => {
    assert.ok(FILES.length > 0, 'No se encontraron archivos para analizar');
    const hits = [];
    for (const abs of FILES) {
      const text = readTextOrNull(abs);
      if (text === null) continue;
      for (const hit of scanForSecrets(text)) hits.push(`${rel(abs)}:${hit.line}: ${hit.name}`);
    }
    report(hits, 'Posibles secretos versionados (nunca subir claves: todo el frontend es público):');
  });

  test('(8) no hay archivos .env ni claves privadas versionados', () => {
    const hits = FILES.map((abs) => rel(abs)).filter((p) => {
      const base = path.posix.basename(p);
      if (base === '.env.example') return false;
      return /^\.env(?:\..+)?$/.test(base) || /\.(?:pem|key|p12|pfx)$/i.test(base) || /^id_(?:rsa|ed25519|ecdsa)$/.test(base);
    });
    report(hits, 'Archivos sensibles versionados:');
  });

  test('(8b) no hay planillas versionadas (.xls, .xlsx, .ods…): pueden contener datos confidenciales de clientes', () => {
    const hits = FILES.map((abs) => rel(abs)).filter((p) => /\.(?:xls|xlsx|xlsm|xlsb|ods)$/i.test(p));
    report(hits, 'Planillas versionadas (el repo es público; usar sólo ejemplos ILUSTRATIVOS en JSON):');
  });

  test('(10) RATEOS ADMIN no se decide en el frontend: sin email del master, metadata ni claims', () => {
    // La autoridad es private.platform_admins (Postgres). El frontend sólo pregunta con am_i_platform_admin().
    const hits = JS_FILES.flatMap((f) => [
      ...findInCode(f, /joaquinvedova@|@hotmail\.com/i),
      ...findInCode(f, /(?:user_metadata|app_metadata|raw_user_meta_data|raw_app_meta_data)[^\n]*admin|admin[^\n]*(?:user_metadata|app_metadata)/i),
      ...findInCode(f, /platformAdmin\s*[:=][^=\n]*(?:email|metadata|localStorage|sessionStorage|organizationId|jwt|claims)/i),
    ]);
    report(hits, 'El rol RATEOS_ADMIN lo decide la base (am_i_platform_admin), nunca un email, metadata, storage o claims en JS');
    const ctxFile = JS_FILES.find((f) => f.rel === 'js/services/app-context.js');
    assert.match(ctxFile.code, /\(await adminGateway\.amIPlatformAdmin\(\)\)\.isAdmin === true/, 'platformAdmin sale sólo de la respuesta de la base');
  });

  test('(9) package.json no declara dependencias y no hay lockfile con paquetes', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies']) {
      const value = pkg[field];
      const empty = value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0);
      assert.ok(empty, `package.json no debe declarar "${field}" (RATEOS no usa dependencias npm).`);
    }
    const lockPath = path.join(ROOT, 'package-lock.json');
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      const packages = Object.keys(lock.packages || {}).filter((k) => k !== '');
      assert.deepEqual(packages, [], 'package-lock.json no debe contener paquetes');
      assert.deepEqual(Object.keys(lock.dependencies || {}), [], 'package-lock.json no debe contener dependencias');
    }
    assert.ok(!existsSync(path.join(ROOT, 'node_modules')) || readdirSync(path.join(ROOT, 'node_modules')).length === 0, 'No debe haber node_modules con paquetes');
  });
});
