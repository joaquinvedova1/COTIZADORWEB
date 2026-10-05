/**
 * Staging público en /preview/ (scripts/stage-preview.mjs): producción nunca
 * cambia y el preview siempre se ve como "RATEOS · STAGING · rama · build".
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { build } from '../scripts/build.mjs';
import {
  escapeHtml,
  placeholderHtml,
  productionHash,
  stageIndexHtml,
  stagePreview,
  stagingText,
  validateBranch,
  validateCommit,
} from '../scripts/stage-preview.mjs';

const CSP_RE = /<meta http-equiv="Content-Security-Policy"[^>]*>/i;
const NOW = new Date('2026-10-05T12:00:00Z');

async function freshBuild(dir, sha, ref) {
  await build({ outDir: dir, env: { BUILD_SHA: sha, BUILD_REF: ref, SOURCE_DATE_EPOCH: '1790000000' }, now: NOW });
}

describe('stage-preview: producción + /preview/', () => {
  let tmp;
  let site;
  let previewBuild;

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'rateos-stage-'));
    site = path.join(tmp, 'site');
    previewBuild = path.join(tmp, 'preview-build');
    await freshBuild(site, 'aaaaaaa1111111111111111111111111111111aa', 'main');
    await freshBuild(previewBuild, 'bbbbbbb2222222222222222222222222222222bb', 'claude/supabase-auth-v1');
  });

  after(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('producción queda byte a byte igual y el preview queda en /preview/', async () => {
    const rootIndex = await readFile(path.join(site, 'index.html'), 'utf8');
    const rootVersion = await readFile(path.join(site, 'version.json'), 'utf8');
    const before = await productionHash(site);
    const res = await stagePreview({ siteDir: site, fromDir: previewBuild, branch: 'claude/supabase-auth-v1', commit: 'bbbbbbb2222222222222222222222222222222bb', now: NOW });
    assert.equal(res.mode, 'branch');
    assert.equal(res.productionHash, before.hash);
    assert.equal(await readFile(path.join(site, 'index.html'), 'utf8'), rootIndex, 'index.html de producción intacto');
    assert.equal(await readFile(path.join(site, 'version.json'), 'utf8'), rootVersion, 'version.json de producción intacto');
    assert.doesNotMatch(rootIndex, /STAGING|noindex|staging\.css/, 'producción nunca lleva la marca de staging');
    assert.equal(JSON.parse(rootVersion).channel, undefined);

    const pIndex = await readFile(path.join(site, 'preview', 'index.html'), 'utf8');
    const ribbon = pIndex.match(/<div class="rateos-staging"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(ribbon, 'franja de staging');
    assert.equal(ribbon[1].replace(/<[^>]+>/g, ''), 'RATEOS · STAGING · rama claude/supabase-auth-v1 · build bbbbbbb');
    assert.match(ribbon[0], /aria-label="RATEOS · STAGING · rama claude\/supabase-auth-v1 · build bbbbbbb"/);
    assert.match(pIndex, /<title>\[STAGING\] /);
    assert.match(pIndex, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(pIndex, /<link rel="stylesheet" href="\.\/staging\.css">/);
    assert.equal(pIndex.match(CSP_RE)[0], rootIndex.match(CSP_RE)[0], 'misma CSP que producción (sin inline)');
    assert.doesNotMatch(pIndex, /<script(?![^>]*\bsrc=)[^>]*>/i, 'sin scripts inline');
    assert.doesNotMatch(pIndex, /\sstyle=/i, 'sin estilos inline');
    const pVersion = JSON.parse(await readFile(path.join(site, 'preview', 'version.json'), 'utf8'));
    assert.equal(pVersion.channel, 'staging');
    assert.equal(pVersion.branch, 'claude/supabase-auth-v1');
    assert.equal(pVersion.commit, 'bbbbbbb');
    assert.ok(pVersion.build && pVersion.build.base, 'conserva el manifiesto del build (cache busting)');
    await readFile(path.join(site, 'preview', pVersion.build.base, pVersion.build.entry));
    await readFile(path.join(site, 'preview', 'staging.css'));
    await readFile(path.join(site, 'preview', 'boot.js'));
  });

  test('nunca pisa un preview existente ni un build que ya trae preview/', async () => {
    await assert.rejects(stagePreview({ siteDir: site, fromDir: previewBuild, branch: 'x', commit: 'abcdef1' }), /ya trae una carpeta preview/);
  });

  test('sin rama publicada: página de staging sin scripts que lleva a producción', async () => {
    const other = path.join(tmp, 'site-placeholder');
    await freshBuild(other, 'ccccccc3333333333333333333333333333333cc', 'main');
    const before = await productionHash(other);
    const res = await stagePreview({ siteDir: other, placeholder: 'La rama x no pasó los tests: no se publicó.', now: NOW });
    assert.equal(res.mode, 'placeholder');
    assert.equal(res.productionHash, before.hash);
    const html = await readFile(path.join(other, 'preview', 'index.html'), 'utf8');
    assert.match(html, /RATEOS · STAGING/);
    assert.match(html, /La rama x no pasó los tests/);
    assert.match(html, /script-src 'none'/);
    assert.match(html, /href="\.\.\/"/);
    assert.equal(JSON.parse(await readFile(path.join(other, 'preview', 'version.json'), 'utf8')).branch, null);
  });

  test('productionHash detecta cualquier cambio fuera de preview/', async () => {
    const dir = path.join(tmp, 'hash');
    await mkdir(path.join(dir, 'preview'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), 'a');
    await writeFile(path.join(dir, 'preview', 'index.html'), 'p');
    const h1 = await productionHash(dir);
    await writeFile(path.join(dir, 'preview', 'index.html'), 'otro');
    assert.equal((await productionHash(dir)).hash, h1.hash, 'preview/ no cuenta');
    await writeFile(path.join(dir, 'index.html'), 'b');
    assert.notEqual((await productionHash(dir)).hash, h1.hash);
  });
});

describe('stage-preview: validación y escape', () => {
  test('ramas y commits válidos; nada que pueda inyectar HTML o salir de la carpeta', () => {
    assert.equal(validateBranch('claude/supabase-auth-v1'), 'claude/supabase-auth-v1');
    for (const bad of ['', '../x', 'a..b', '-x', 'a b', '<script>', 'a"b', null]) assert.throws(() => validateBranch(bad), /Rama inválida/, String(bad));
    assert.equal(validateCommit('2592241051827'), '2592241');
    assert.throws(() => validateCommit('xyz'), /Commit inválido/);
    assert.equal(escapeHtml('<b>"&\''), '&lt;b&gt;&quot;&amp;&#39;');
    assert.equal(stagingText({ branch: 'dev', commit: 'abc1234' }), 'RATEOS · STAGING · rama dev · build abc1234');
  });

  test('stageIndexHtml no cambia la CSP ni agrega scripts inline', () => {
    const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>T</title></head><body class="x"><div id="app"></div><script type="module" src="./boot.js"></script></body></html>';
    const out = stageIndexHtml(html, { branch: 'dev', commit: 'abc1234' });
    assert.match(out, /<body class="x">\n  <div class="rateos-staging" role="note"/);
    assert.equal(out.match(CSP_RE)[0], html.match(CSP_RE)[0]);
    assert.throws(() => stageIndexHtml('<html></html>', { branch: 'dev', commit: 'abc1234' }), /sin <head> o <body>/);
  });

  test('la página sin preview escapa el motivo', () => {
    assert.match(placeholderHtml('<img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});
