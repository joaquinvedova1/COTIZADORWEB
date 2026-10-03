/**
 * RATEOS — build del sitio estático para GitHub Pages.
 *
 * Sin dependencias: sólo built-ins de Node (>= 20).
 *
 *   npm run build                 → genera dist/
 *   node scripts/build.mjs --out <dir>
 *
 * Qué hace:
 *  1. Limpia y crea el directorio de salida (por defecto dist/).
 *  2. Copia SÓLO lo que se publica: index.html, .nojekyll, assets/ (si existe),
 *     css/ y js/ (recursivo). Nunca copia tests, docs, scripts, .github,
 *     node_modules, dotfiles ni archivos *.test.js.
 *  3. Escribe dist/version.json { version, commit, buildDate, ref }.
 *  4. Valida el sitio generado:
 *     - todo src/href local de index.html es relativo y existe;
 *     - todos los imports (estáticos y dinámicos literales) de dist/js son
 *       relativos y resuelven a archivos existentes dentro de dist/;
 *     - las url() de los CSS son relativas y existen;
 *     - ningún string de JS apunta a la raíz del dominio ("/js/…", "/css/…"),
 *       porque el sitio vive bajo /COTIZADORWEB/.
 *  5. Imprime un resumen. Exit code 1 si algo falla.
 *
 * Las funciones se exportan para reutilizarlas desde los tests
 * (tests/build.test.js, tests/architecture.test.js).
 */

import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Lo único que se publica. `required: false` → se omite si no existe. */
export const PUBLISHED_ENTRIES = Object.freeze([
  Object.freeze({ name: 'index.html', type: 'file', required: true }),
  Object.freeze({ name: '.nojekyll', type: 'file', required: false }),
  Object.freeze({ name: 'assets', type: 'dir', required: false }),
  Object.freeze({ name: 'css', type: 'dir', required: true }),
  Object.freeze({ name: 'js', type: 'dir', required: true }),
]);

/** Directorios del repo que el build nunca debe borrar ni usar como salida. */
const PROTECTED_TOP_LEVEL = new Set([
  '.git', '.github', '.agent', 'assets', 'css', 'js', 'docs', 'scripts', 'tests', 'node_modules',
]);

const EXCLUDED_DIR_NAMES = new Set(['tests', '__tests__', 'node_modules']);
const EXCLUDED_FILE_PATTERNS = [/\.test\.[cm]?js$/i, /\.spec\.[cm]?js$/i, /\.map$/i];

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HEX_SHA_RE = /^[0-9a-f]{7,64}$/i;
const SAFE_REF_RE = /[^A-Za-z0-9._/-]/g;

// ===================================================================
// Helpers de análisis de código (compartidos con los tests)
// ===================================================================

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const REGEX_PRECEDING_PUNCTUATORS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Reemplaza los comentarios de un archivo JavaScript por espacios
 * (conserva los saltos de línea y la longitud, para poder informar números
 * de línea y mapear posiciones al texto original).
 * Por defecto los strings, template literals y regex se conservan.
 * Con `{ mask: true }` además se enmascara el CONTENIDO de strings, partes
 * literales de templates y cuerpos de regex (las comillas quedan), de modo
 * que una palabra dentro de un string nunca se confunda con código.
 * Es un lexer simple pero suficiente para el código del proyecto.
 */
export function stripComments(source, { mask = false } = {}) {
  const src = String(source);
  const n = src.length;
  let out = '';
  let i = 0;
  let prev = '';
  let prevWord = '';
  let depth = 0;
  const templateDepths = [];

  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) out += src[k] === '\n' ? '\n' : ' ';
  };
  /** Copia un tramo literal; con mask, lo reemplaza por espacios. */
  const literal = (from, to) => {
    if (mask) blank(from, to);
    else out += src.slice(from, to);
  };

  /** Recorre un template literal desde `start` hasta su cierre o hasta "${". */
  const scanTemplate = (start) => {
    let j = start;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') return { end: j + 1, interpolation: false };
      if (ch === '$' && src[j + 1] === '{') return { end: j + 2, interpolation: true };
      j += 1;
    }
    return { end: n, interpolation: false };
  };

  const enterTemplate = (from) => {
    const r = scanTemplate(from);
    const closeLen = r.interpolation ? 2 : (r.end <= n && src[r.end - 1] === '`' ? 1 : 0);
    literal(from, r.end - closeLen);
    out += src.slice(r.end - closeLen, r.end);
    i = r.end;
    if (r.interpolation) {
      templateDepths.push(depth);
      depth += 1;
      prev = '{';
    } else {
      prev = '`';
    }
    prevWord = '';
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      const e = src.indexOf('*/', i + 2);
      const j = e === -1 ? n : e + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      const closed = src[j - 1] === ch && j - 1 > i;
      out += ch;
      literal(i + 1, closed ? j - 1 : j);
      if (closed) out += ch;
      i = j;
      prev = ch;
      prevWord = '';
      continue;
    }
    if (ch === '`') {
      out += '`';
      enterTemplate(i + 1);
      continue;
    }
    if (ch === '/' && (prev === '' || REGEX_PRECEDING_PUNCTUATORS.includes(prev) || REGEX_PRECEDING_KEYWORDS.has(prevWord))) {
      // Literal de expresión regular.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { closed = true; break; }
        j += 1;
      }
      if (closed) {
        const bodyEnd = j;
        j += 1;
        while (j < n && /[a-z]/i.test(src[j])) j += 1;
        out += '/';
        literal(i + 1, bodyEnd);
        out += src.slice(bodyEnd, j);
        i = j;
        prev = 'a';
        prevWord = '';
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      out += word;
      i = j;
      prev = 'a';
      prevWord = word;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (templateDepths.length && templateDepths[templateDepths.length - 1] === depth) {
        templateDepths.pop();
        out += '}';
        enterTemplate(i + 1);
        continue;
      }
    }
    out += ch;
    i += 1;
    if (!/\s/.test(ch)) {
      prev = ch;
      prevWord = '';
    }
  }
  return out;
}

function lineAt(text, index) {
  let line = 1;
  for (let k = 0; k < index && k < text.length; k += 1) if (text[k] === '\n') line += 1;
  return line;
}

// Se aplican sobre el código ENMASCARADO (sin comentarios ni contenido de
// strings); el especificador se lee del texto original en la misma posición.
const STATIC_IMPORT_RE = /(?<![\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?(['"])([^'"\n]*)\1/dg;
const DYNAMIC_LITERAL_RE = /(?<![\w$.])import\s*\(\s*(['"`])([^'"`\n]*)\1\s*[,)]/dg;
const DYNAMIC_ANY_RE = /(?<![\w$.])import\s*\(/g;

/**
 * Extrae los imports de un módulo ES.
 * @returns {{specifier: string|null, kind: 'static'|'dynamic'|'dynamic-expression', line: number}[]}
 *  `dynamic-expression` = import() con una expresión no literal (no verificable).
 */
export function extractImports(source) {
  const code = stripComments(source);
  const masked = stripComments(source, { mask: true });
  const textOf = (m) => code.slice(m.indices[2][0], m.indices[2][1]);
  const found = [];
  for (const m of masked.matchAll(STATIC_IMPORT_RE)) {
    found.push({ specifier: textOf(m), kind: 'static', line: lineAt(code, m.index) });
  }
  const literalStarts = new Set();
  for (const m of masked.matchAll(DYNAMIC_LITERAL_RE)) {
    const specifier = textOf(m);
    if (m[1] === '`' && specifier.includes('${')) continue;
    literalStarts.add(m.index);
    found.push({ specifier, kind: 'dynamic', line: lineAt(code, m.index) });
  }
  for (const m of masked.matchAll(DYNAMIC_ANY_RE)) {
    if (!literalStarts.has(m.index)) found.push({ specifier: null, kind: 'dynamic-expression', line: lineAt(code, m.index) });
  }
  return found.sort((a, b) => a.line - b.line);
}

/** true si el especificador es relativo ("./" o "../"). */
export function isRelativeSpecifier(specifier) {
  return typeof specifier === 'string' && (specifier.startsWith('./') || specifier.startsWith('../'));
}

/**
 * Extrae los atributos src/href de un HTML (ignora comentarios HTML).
 * @returns {{tag: string, attr: string, value: string, line: number}[]}
 */
export function extractHtmlRefs(html) {
  const text = String(html).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  const refs = [];
  for (const tagMatch of text.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*>/g)) {
    const tag = tagMatch[1].toLowerCase();
    for (const a of tagMatch[0].matchAll(/\s(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      refs.push({ tag, attr: a[1].toLowerCase(), value: value.trim(), line: lineAt(text, tagMatch.index) });
    }
  }
  return refs;
}

/** Extrae url(...) e @import de un CSS (ignora comentarios). */
export function extractCssUrls(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const urls = [];
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) {
    urls.push({ value: (m[1] ?? m[2] ?? m[3] ?? '').trim(), line: lineAt(text, m.index) });
  }
  for (const m of text.matchAll(/@import\s+(["'])([^"']+)\1/g)) {
    urls.push({ value: m[2].trim(), line: lineAt(text, m.index) });
  }
  return urls;
}

/**
 * Clasifica una referencia de HTML/CSS:
 *  'anchor' (#x), 'data' (data:), 'external' (http:, mailto:, //host),
 *  'absolute' (/x — rompe bajo /COTIZADORWEB/), 'relative', 'empty'.
 */
export function classifyRef(value) {
  const v = String(value ?? '').trim();
  if (v === '') return 'empty';
  if (v.startsWith('#')) return 'anchor';
  if (/^data:/i.test(v)) return 'data';
  if (v.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return 'external';
  if (v.startsWith('/')) return 'absolute';
  return 'relative';
}

/** Quita query/hash y decodifica una ruta relativa. */
export function refToPath(value) {
  const clean = String(value).split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

/** Strings de JS que apuntan a la raíz del dominio (rompen bajo /COTIZADORWEB/). */
export const ROOT_ABSOLUTE_LITERAL_RE = /(['"`])\/(?:js\/|css\/|assets\/|version\.json|index\.html)/;

/** Lista recursiva de archivos (rutas absolutas). */
export async function listFiles(dir, { filter } = {}) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (filter && !filter(full, entry)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ===================================================================
// Validación del sitio generado
// ===================================================================

/**
 * Valida un directorio de sitio (dist/ o la raíz del repo).
 * @returns {Promise<{errors: string[], warnings: string[], stats: {htmlRefs: number, jsFiles: number, jsImports: number, cssUrls: number}}>}
 */
export async function validateSite(siteDir) {
  const errors = [];
  const warnings = [];
  const stats = { htmlRefs: 0, jsFiles: 0, jsImports: 0, cssUrls: 0 };
  const dir = path.resolve(siteDir);

  // --- index.html
  const indexPath = path.join(dir, 'index.html');
  if (!(await exists(indexPath))) {
    errors.push('Falta index.html.');
  } else {
    const html = await readFile(indexPath, 'utf8');
    for (const ref of extractHtmlRefs(html)) {
      const kind = classifyRef(ref.value);
      const where = `index.html:${ref.line} <${ref.tag} ${ref.attr}="${ref.value}">`;
      if (kind === 'anchor' || kind === 'data') continue;
      if (kind === 'empty') { errors.push(`${where}: referencia vacía.`); continue; }
      if (kind === 'absolute') { errors.push(`${where}: ruta absoluta; debe ser relativa ("./…") para funcionar bajo /COTIZADORWEB/.`); continue; }
      if (kind === 'external') { errors.push(`${where}: recurso externo; el sitio sólo usa archivos propios (CSP 'self').`); continue; }
      stats.htmlRefs += 1;
      const target = path.resolve(dir, refToPath(ref.value));
      if (!isInside(dir, target)) errors.push(`${where}: apunta fuera del sitio.`);
      else if (!(await exists(target))) errors.push(`${where}: el archivo no existe.`);
    }
  }

  // --- JS: imports relativos y existentes, sin rutas a la raíz del dominio.
  const jsDir = path.join(dir, 'js');
  const jsFiles = await listFiles(jsDir, { filter: (full) => !path.basename(full).startsWith('.') });
  for (const file of jsFiles.filter((f) => /\.m?js$/.test(f))) {
    stats.jsFiles += 1;
    const rel = toPosix(path.relative(dir, file));
    const source = await readFile(file, 'utf8');
    for (const imp of extractImports(source)) {
      if (imp.kind === 'dynamic-expression') {
        warnings.push(`${rel}:${imp.line}: import() con expresión no literal (no se puede verificar).`);
        continue;
      }
      stats.jsImports += 1;
      if (!isRelativeSpecifier(imp.specifier)) {
        errors.push(`${rel}:${imp.line}: import "${imp.specifier}" no es relativo ("./" o "../").`);
        continue;
      }
      const target = path.resolve(path.dirname(file), imp.specifier);
      if (!isInside(dir, target)) errors.push(`${rel}:${imp.line}: import "${imp.specifier}" sale del sitio publicado.`);
      else if (!(await exists(target))) errors.push(`${rel}:${imp.line}: import "${imp.specifier}" no existe.`);
    }
    const code = stripComments(source);
    code.split('\n').forEach((line, idx) => {
      if (ROOT_ABSOLUTE_LITERAL_RE.test(line)) {
        errors.push(`${rel}:${idx + 1}: ruta absoluta a la raíz del dominio en un string; usá rutas relativas ("./…").`);
      }
    });
  }

  // --- CSS: url() relativas y existentes.
  const cssFiles = (await listFiles(path.join(dir, 'css'))).filter((f) => f.endsWith('.css'));
  for (const file of cssFiles) {
    const rel = toPosix(path.relative(dir, file));
    const css = await readFile(file, 'utf8');
    for (const u of extractCssUrls(css)) {
      const kind = classifyRef(u.value);
      if (kind === 'anchor' || kind === 'data') continue;
      const where = `${rel}:${u.line} url(${u.value})`;
      if (kind === 'absolute') { errors.push(`${where}: ruta absoluta; debe ser relativa.`); continue; }
      if (kind === 'external') { errors.push(`${where}: recurso externo no permitido (CSP 'self').`); continue; }
      if (kind === 'empty') { errors.push(`${where}: url vacía.`); continue; }
      stats.cssUrls += 1;
      const target = path.resolve(path.dirname(file), refToPath(u.value));
      if (!isInside(dir, target)) errors.push(`${where}: apunta fuera del sitio.`);
      else if (!(await exists(target))) errors.push(`${where}: el archivo no existe.`);
    }
  }

  return { errors, warnings, stats };
}

// ===================================================================
// Build
// ===================================================================

/** SHA corto: BUILD_SHA → GITHUB_SHA → git rev-parse → "local". */
export function resolveCommit(env = process.env, rootDir = ROOT_DIR) {
  for (const key of ['BUILD_SHA', 'GITHUB_SHA']) {
    const value = String(env[key] ?? '').trim();
    if (HEX_SHA_RE.test(value)) return value.slice(0, 7).toLowerCase();
  }
  try {
    const out = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      encoding: 'utf8',
    }).trim();
    if (HEX_SHA_RE.test(out)) return out.slice(0, 7).toLowerCase();
  } catch {
    /* sin git o fuera de un repo */
  }
  return 'local';
}

/** Ref desplegada: BUILD_REF → GITHUB_REF_NAME → "local" (saneada). */
export function resolveRef(env = process.env) {
  const raw = String(env.BUILD_REF || env.GITHUB_REF_NAME || '').trim();
  if (!raw) return 'local';
  return raw.replace(SAFE_REF_RE, '-').slice(0, 100);
}

/** Fecha de build ISO UTC (respeta SOURCE_DATE_EPOCH para builds reproducibles). */
export function resolveBuildDate(env = process.env, now = new Date()) {
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  if (String(env.SOURCE_DATE_EPOCH ?? '').trim() !== '' && Number.isFinite(epoch) && epoch >= 0) {
    return new Date(epoch * 1000).toISOString();
  }
  return now.toISOString();
}

/** Arma el contenido de version.json. */
export async function createVersionInfo({ rootDir = ROOT_DIR, env = process.env, now = new Date() } = {}) {
  const pkg = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
    throw new Error(`package.json: "version" inválida (${JSON.stringify(pkg.version)}).`);
  }
  return {
    version: pkg.version,
    commit: resolveCommit(env, rootDir),
    buildDate: resolveBuildDate(env, now),
    ref: resolveRef(env),
  };
}

/** Evita borrar el repo o carpetas de código por un outDir mal pasado. */
export function assertSafeOutDir(outDir, rootDir = ROOT_DIR) {
  const out = path.resolve(outDir);
  const root = path.resolve(rootDir);
  if (out === path.parse(out).root) throw new Error(`outDir inválido (raíz del sistema): ${out}`);
  if (out === root || isInside(out, root)) throw new Error(`outDir no puede ser el repo ni un directorio que lo contenga: ${out}`);
  if (isInside(root, out)) {
    const top = path.relative(root, out).split(path.sep)[0];
    if (PROTECTED_TOP_LEVEL.has(top) || top.startsWith('.')) {
      throw new Error(`outDir no puede estar dentro de "${top}/": ${out}`);
    }
  }
  return out;
}

function isExcludedFromCopy(name, isDir) {
  if (name.startsWith('.')) return true;
  if (isDir) return EXCLUDED_DIR_NAMES.has(name);
  return EXCLUDED_FILE_PATTERNS.some((re) => re.test(name));
}

async function copyTree(src, dest, report) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      report.warnings.push(`Se omitió el enlace simbólico ${toPosix(path.relative(report.rootDir, from))}.`);
      continue;
    }
    if (entry.isDirectory()) {
      if (isExcludedFromCopy(entry.name, true)) continue;
      await copyTree(from, to, report);
    } else if (entry.isFile()) {
      if (isExcludedFromCopy(entry.name, false)) continue;
      await copyFile(from, to);
      report.files += 1;
      report.bytes += (await stat(to)).size;
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Genera el sitio estático.
 * @param {{outDir?: string, rootDir?: string, env?: object, now?: Date, log?: (line: string) => void}} [options]
 * @returns {Promise<{ok: boolean, outDir: string, versionInfo: object|null, files: number, bytes: number, errors: string[], warnings: string[], stats: object}>}
 */
export async function build({ outDir, rootDir = ROOT_DIR, env = process.env, now = new Date(), log = () => {} } = {}) {
  const root = path.resolve(rootDir);
  const out = assertSafeOutDir(outDir ?? path.join(root, 'dist'), root);
  const report = { rootDir: root, files: 0, bytes: 0, errors: [], warnings: [] };

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const entry of PUBLISHED_ENTRIES) {
    const from = path.join(root, entry.name);
    let info = null;
    try {
      info = await lstat(from);
    } catch {
      info = null;
    }
    if (!info) {
      if (entry.required) report.errors.push(`Falta ${entry.name}${entry.type === 'dir' ? '/' : ''} en el repositorio.`);
      continue;
    }
    if (info.isSymbolicLink()) {
      report.errors.push(`${entry.name} es un enlace simbólico; no se publica.`);
      continue;
    }
    const to = path.join(out, entry.name);
    if (entry.type === 'dir' && info.isDirectory()) {
      await copyTree(from, to, report);
    } else if (entry.type === 'file' && info.isFile()) {
      await copyFile(from, to);
      report.files += 1;
      report.bytes += info.size;
    } else {
      report.errors.push(`${entry.name}: tipo inesperado (se esperaba ${entry.type === 'dir' ? 'directorio' : 'archivo'}).`);
    }
  }

  // GitHub Pages: .nojekyll evita que Jekyll procese el sitio.
  if (!(await exists(path.join(out, '.nojekyll')))) {
    await writeFile(path.join(out, '.nojekyll'), '');
    report.files += 1;
  }

  let versionInfo = null;
  try {
    versionInfo = await createVersionInfo({ rootDir: root, env, now });
    const json = `${JSON.stringify(versionInfo, null, 2)}\n`;
    await writeFile(path.join(out, 'version.json'), json);
    report.files += 1;
    report.bytes += Buffer.byteLength(json);
  } catch (error) {
    report.errors.push(`No se pudo generar version.json: ${error.message}`);
  }

  const validation = await validateSite(out);
  const errors = [...report.errors, ...validation.errors];
  const warnings = [...report.warnings, ...validation.warnings];
  const ok = errors.length === 0;
  const relOut = isInside(root, out) ? `${toPosix(path.relative(root, out))}/` : out;

  log(`RATEOS build ${ok ? 'OK' : 'CON ERRORES'}`);
  if (versionInfo) {
    log(`  versión  : ${versionInfo.version}`);
    log(`  commit   : ${versionInfo.commit}`);
    log(`  ref      : ${versionInfo.ref}`);
    log(`  fecha    : ${versionInfo.buildDate}`);
  }
  log(`  archivos : ${report.files} (${formatBytes(report.bytes)}) en ${relOut}`);
  log(`  validado : ${validation.stats.htmlRefs} refs HTML, ${validation.stats.jsFiles} módulos JS, ${validation.stats.jsImports} imports, ${validation.stats.cssUrls} url() CSS`);
  for (const w of warnings) log(`  aviso    : ${w}`);
  for (const e of errors) log(`  ERROR    : ${e}`);

  return { ok, outDir: out, versionInfo, files: report.files, bytes: report.bytes, errors, warnings, stats: validation.stats };
}

function parseArgs(argv) {
  const args = { outDir: undefined };
  for (let k = 0; k < argv.length; k += 1) {
    if (argv[k] === '--out' && argv[k + 1]) {
      args.outDir = path.resolve(argv[k + 1]);
      k += 1;
    }
  }
  return args;
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const { outDir } = parseArgs(process.argv.slice(2));
  try {
    const result = await build({ outDir, log: (line) => process.stdout.write(`${line}\n`) });
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`RATEOS build falló: ${error.message}\n`);
    process.exitCode = 1;
  }
}
