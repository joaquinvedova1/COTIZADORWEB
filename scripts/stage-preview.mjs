#!/usr/bin/env node
/**
 * RATEOS — arma el sitio con staging público en /preview/.
 *
 *   dist/            ← producción (build de main, NO se toca)
 *   dist/preview/    ← build de la rama de desarrollo + marca "RATEOS · STAGING"
 *
 * Uso (lo llama .github/workflows/deploy-pages.yml):
 *   node scripts/stage-preview.mjs --site dist --from preview-build --branch <rama> --commit <sha>
 *   node scripts/stage-preview.mjs --site dist --placeholder "<motivo>"
 *
 * Garantías (verificadas acá y en tests/stage-preview.test.js):
 * - Producción nunca cambia: index.html, version.json y todo lo que no está en
 *   preview/ queda byte a byte igual (se compara un hash antes y después).
 * - El preview se ve SIEMPRE como staging: franja "RATEOS · STAGING · rama ·
 *   build", título "[STAGING]", noindex y version.json con channel "staging".
 * - Sin scripts ni estilos inline (la CSP de index.html no cambia): la franja
 *   es HTML estático + ./staging.css. La rama se escapa antes de insertarse.
 * - Self-contained (sólo módulos de Node): el workflow lo toma siempre de main.
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREVIEW_DIR = 'preview';
export const STAGING_LABEL = 'RATEOS · STAGING';
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

export const STAGING_CSS = `/* RATEOS — marca de staging (generado por scripts/stage-preview.mjs). */
.rateos-staging {
  position: fixed; top: 0; left: 0; right: 0; margin: 0 auto; width: max-content; z-index: 2147483647;
  max-width: calc(100vw - 16px); box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 3px 12px; border-radius: 0 0 10px 10px; pointer-events: none;
  background: #B45309; color: #FFFFFF; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font: 600 12px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.02em;
}
.rateos-staging-note { max-width: 560px; margin: 15vh auto 0; padding: 0 16px; font: 16px/1.6 system-ui, sans-serif; color: #1F2933; }
.rateos-staging-note a { color: #0B5E7E; font-weight: 600; }
/* Celular: abajo (no tapa el encabezado) y sin las palabras "rama"/"build" para que entren rama y commit. */
@media (max-width: 640px) {
  .rateos-staging { top: auto; bottom: 0; max-width: calc(100vw - 6px); width: auto; border-radius: 8px 8px 0 0; font-size: 10px; letter-spacing: 0; padding: 3px 7px; white-space: normal; text-align: center; }
  .rateos-staging .rs-k { display: none; }
}
@media print { .rateos-staging { display: none; } }
`;

/** Franja de staging (HTML estático, todo escapado). */
export function ribbonHtml({ branch, commit }) {
  const label = escapeHtml(stagingText({ branch, commit }));
  return `<div class="rateos-staging" role="note" aria-label="${label}">${escapeHtml(STAGING_LABEL)} · <span class="rs-k">rama </span>${escapeHtml(branch)} · <span class="rs-k">build </span>${escapeHtml(commit)}</div>`;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function validateBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch) || branch.includes('..')) {
    throw new Error(`Rama inválida para el preview: ${JSON.stringify(branch)}`);
  }
  return branch;
}

export function validateCommit(commit) {
  if (typeof commit !== 'string' || !SHA_RE.test(commit)) throw new Error(`Commit inválido para el preview: ${JSON.stringify(commit)}`);
  return commit.slice(0, 7).toLowerCase();
}

/** Texto visible de la franja. */
export function stagingText({ branch, commit }) {
  return `${STAGING_LABEL} · rama ${branch} · build ${commit}`;
}

/** Inserta noindex, ./staging.css, "[STAGING]" en el título y la franja. No toca la CSP. */
export function stageIndexHtml(html, { branch, commit }) {
  const source = String(html);
  if (!/<\/head>/i.test(source) || !/<body[^>]*>/i.test(source)) throw new Error('index.html del preview sin <head> o <body>.');
  const csp = (source.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/i) || [null])[0];
  const head = `  <meta name="robots" content="noindex, nofollow">\n  <link rel="stylesheet" href="./staging.css">\n</head>`;
  const ribbon = ribbonHtml({ branch, commit });
  let out = source
    .replace(/<title>([\s\S]*?)<\/title>/i, (_m, t) => `<title>[STAGING] ${t}</title>`)
    .replace(/\s*<\/head>/i, `\n${head}`)
    .replace(/<body([^>]*)>/i, (m) => `${m}\n  ${ribbon}`);
  const cspAfter = (out.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/i) || [null])[0];
  if (csp !== cspAfter) throw new Error('La CSP del preview cambió: no se publica.');
  const inlineScripts = (text) => (text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || []).length;
  if (inlineScripts(out) !== inlineScripts(source)) throw new Error('Se agregó un script inline.');
  return out;
}

/** Página del preview cuando no hay rama publicada (o no pasó los tests). */
export function placeholderHtml(reason) {
  return `<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex, nofollow">
  <title>[STAGING] RATEOS — sin preview</title>
  <link rel="stylesheet" href="./staging.css">
</head>
<body>
  <div class="rateos-staging" role="note">${escapeHtml(STAGING_LABEL)}</div>
  <main class="rateos-staging-note">
    <h1>No hay un preview publicado.</h1>
    <p>${escapeHtml(reason)}</p>
    <p><a href="../">Ir a RATEOS (producción)</a></p>
  </main>
</body>
</html>
`;
}

async function listFilesRecursive(dir, base = dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Hash de todo lo que es producción (todo el sitio salvo preview/). */
export async function productionHash(siteDir) {
  const files = (await listFilesRecursive(siteDir)).filter((f) => f !== PREVIEW_DIR && !f.startsWith(`${PREVIEW_DIR}/`));
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update('\0');
    hash.update(await readFile(path.join(siteDir, f)));
    hash.update('\0');
  }
  return { hash: hash.digest('hex'), files: files.length };
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Arma dist/preview/. Devuelve { mode, branch, commit, productionHash }.
 * @param {{ siteDir: string, fromDir?: string|null, branch?: string, commit?: string, placeholder?: string|null, now?: Date }} options
 */
export async function stagePreview({ siteDir, fromDir = null, branch, commit, placeholder = null, now = new Date() }) {
  const site = path.resolve(siteDir);
  if (!(await exists(path.join(site, 'index.html'))) || !(await exists(path.join(site, 'version.json')))) {
    throw new Error(`${site} no es un build de producción (falta index.html o version.json).`);
  }
  const target = path.join(site, PREVIEW_DIR);
  if (await exists(target)) throw new Error('El build de producción ya trae una carpeta preview/: no se pisa nada.');
  const before = await productionHash(site);

  await mkdir(target, { recursive: true });
  let result;
  if (placeholder !== null || !fromDir) {
    const reason = placeholder || 'Todavía no se publicó ninguna rama de desarrollo.';
    await writeFile(path.join(target, 'index.html'), placeholderHtml(reason));
    await writeFile(path.join(target, 'staging.css'), STAGING_CSS);
    await writeFile(path.join(target, 'version.json'), `${JSON.stringify({ channel: 'staging', branch: null, commit: null, reason, stagedAt: now.toISOString() }, null, 2)}\n`);
    await writeFile(path.join(target, '.nojekyll'), '');
    result = { mode: 'placeholder', branch: null, commit: null };
  } else {
    const safeBranch = validateBranch(branch);
    const shortCommit = validateCommit(commit);
    const from = path.resolve(fromDir);
    if (!(await exists(path.join(from, 'index.html'))) || !(await exists(path.join(from, 'version.json')))) {
      throw new Error(`${from} no es un build (falta index.html o version.json).`);
    }
    if (await exists(path.join(from, PREVIEW_DIR))) throw new Error('El build del preview no puede traer su propia carpeta preview/.');
    await cp(from, target, { recursive: true });
    const indexPath = path.join(target, 'index.html');
    await writeFile(indexPath, stageIndexHtml(await readFile(indexPath, 'utf8'), { branch: safeBranch, commit: shortCommit }));
    await writeFile(path.join(target, 'staging.css'), STAGING_CSS);
    const versionPath = path.join(target, 'version.json');
    const version = JSON.parse(await readFile(versionPath, 'utf8'));
    const staged = { ...version, channel: 'staging', branch: safeBranch, ref: safeBranch, commit: shortCommit, stagedAt: now.toISOString() };
    await writeFile(versionPath, `${JSON.stringify(staged, null, 2)}\n`);
    result = { mode: 'branch', branch: safeBranch, commit: shortCommit };
  }

  const after = await productionHash(site);
  if (after.hash !== before.hash || after.files !== before.files) {
    throw new Error('Producción cambió al armar el preview: no se publica.');
  }
  return { ...result, productionHash: after.hash };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (['--site', '--from', '--branch', '--commit', '--placeholder'].includes(key)) {
      args[key.slice(2)] = value ?? '';
      i += 1;
    } else {
      throw new Error(`Argumento desconocido: ${key}`);
    }
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.site) throw new Error('Falta --site');
    const result = await stagePreview({
      siteDir: args.site,
      fromDir: args.from || null,
      branch: args.branch,
      commit: args.commit,
      placeholder: Object.prototype.hasOwnProperty.call(args, 'placeholder') ? args.placeholder : null,
    });
    process.stdout.write(`Preview armado: ${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`stage-preview: ${error.message}\n`);
    process.exit(1);
  }
}
