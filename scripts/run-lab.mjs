#!/usr/bin/env node
/**
 * RATEOS Test Lab — runner (PLAN-2026-013).
 *
 *   npm run test:lab                       campaña ESTABLE (PR gate): escenarios curados,
 *                                          productos, sondas, golden, cobertura, mercado offline
 *   npm run test:lab:extended              + escenarios generados con seed (pairwise, 120 por defecto)
 *   node scripts/run-lab.mjs --extended --seed=7 --count=200 --out=reports/lab
 *
 * Escribe reports/lab/<run>/lab-report.json y lab-report.md (y una copia en
 * reports/lab/latest/). reports/ está ignorado por git: en CI se sube como
 * artefacto. Sin red: el mercado se compara con tests/lab/market/references.json.
 *
 * Código de salida: estable → 1 si el gate falla (golden, candado, cobertura o
 * hallazgos P0/P1 sin triage). Extendido → 1 sólo con P0 nuevos (`--fail-on=P1`
 * para ser más estricto, `--fail-on=none` para sólo reportar).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCampaign } from '../tests/lab/lib/lab.js';
import { toJSON, toMarkdown } from '../tests/lab/lib/report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { extended: false, seed: 20261016, count: 120, out: 'reports/lab', failOn: null };
  for (const arg of argv) {
    if (arg === '--extended') out.extended = true;
    // Vacío (p. ej. un workflow sin inputs) o no numérico: queda la seed por defecto.
    else if (arg.startsWith('--seed=') && arg.slice(7).trim() !== '' && Number.isFinite(Number(arg.slice(7)))) out.seed = Number(arg.slice(7)) >>> 0;
    else if (arg.startsWith('--count=')) out.count = Math.max(1, Math.min(2000, Number(arg.slice(8)) || 120));
    else if (arg.startsWith('--out=')) out.out = arg.slice(6);
    else if (arg.startsWith('--fail-on=')) out.failOn = arg.slice(10);
  }
  if (!out.failOn) out.failOn = out.extended ? 'P0' : 'gate';
  return out;
}

function commitOf() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local';
  }
}

// `npm run test:lab | head` cierra la salida antes de tiempo: no es un error del lab.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode || 0);
  throw error;
});

const args = parseArgs(process.argv.slice(2));
const started = Date.now();
const campaign = runCampaign({ mode: args.extended ? 'extended' : 'stable', seed: args.seed, count: args.count });
const commit = commitOf();
const date = new Date().toISOString();
const runId = `${args.extended ? `extended-${args.seed}` : 'stable'}-${commit}-${date.replace(/[-:]/g, '').slice(0, 15)}`;
const meta = { runId, commit, date, mode: args.extended ? 'extended' : 'stable', seed: args.extended ? args.seed : null, count: args.extended ? args.count : null, durationMs: Date.now() - started };

const outDir = path.resolve(ROOT, args.out);
if (!outDir.startsWith(ROOT + path.sep)) throw new Error('--out tiene que quedar dentro del repo.');
const json = toJSON(campaign, meta);
const md = toMarkdown(campaign, meta);
for (const dir of [path.join(outDir, runId), path.join(outDir, 'latest')]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'lab-report.json'), json);
  writeFileSync(path.join(dir, 'lab-report.md'), md);
}

const summary = md.slice(md.indexOf('```') + 3, md.indexOf('```', md.indexOf('```') + 3)).trim();
process.stdout.write(`${summary}\n\nReporte: ${path.relative(ROOT, path.join(outDir, runId))}/lab-report.md (${((Date.now() - started) / 1000).toFixed(1)} s)\n`);

const p0 = campaign.blocking.filter((f) => f.classification.startsWith('P0'));
const p1 = campaign.blocking.filter((f) => f.classification.startsWith('P1'));
let fail = false;
if (args.failOn === 'gate') fail = !campaign.gate.ok;
else if (args.failOn === 'P0') fail = p0.length > 0 || !campaign.goldens.lock.ok || campaign.goldens.failed.length > 0;
else if (args.failOn === 'P1') fail = p0.length + p1.length > 0 || !campaign.goldens.lock.ok || campaign.goldens.failed.length > 0;
if (fail) {
  process.stdout.write(`\nGATE: FALLA (${campaign.gate.reasons.join(' · ') || `${p0.length} P0`})\n`);
  for (const f of campaign.blocking.slice(0, 40)) process.stdout.write(`  [${f.classification}] ${f.subject} ${f.code}: ${f.title}\n`);
  process.exitCode = 1;
}
