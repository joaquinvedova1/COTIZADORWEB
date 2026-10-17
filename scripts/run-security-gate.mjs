#!/usr/bin/env node
/**
 * RATEOS — Beta Security Gate (PLAN-2026-015).
 *
 *   npm run test:security
 *   node scripts/run-security-gate.mjs --out=reports/security
 *
 * 1. Corre los controles de tests/security/lib/checks.js (estáticos y
 *    dinámicos, sin red ni base, datos sintéticos).
 * 2. Corre los tests de seguridad, tenancy, sesión, privacidad y recuperación
 *    (node --test).
 * 3. Escribe reports/security/<run>/beta-security-gate.json y .md (y una copia
 *    en reports/security/latest/). reports/ está ignorado por git.
 *
 * Código de salida 1 si falla algún control P0/P1 o algún test. Las
 * decisiones del dueño (HD-…) se informan siempre y no bloquean.
 *
 * La negación real entre empresas se prueba EN LA BASE (no se puede desde CI
 * sin credenciales): supabase/tests/beta_security_test.sql, rls_test.sql y
 * rls_admin_test.sql — ver docs/BETA_SECURITY.md.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateVerdict, runSecurityChecks } from '../tests/security/lib/checks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tests que forman parte del gate (seguridad, tenancy, sesión, privacidad, recuperación). */
export const SECURITY_TEST_FILES = Object.freeze([
  'tests/security/beta-security-gate.test.js',
  'tests/data/beta-security.test.js',
  'tests/data/supabase-repository.test.js',
  'tests/data/backup.test.js',
  'tests/data/local-storage-repository.test.js',
  'tests/supabase/migrations.test.js',
  'tests/architecture.test.js',
  'tests/static-site.test.js',
  'tests/services/auth-service.test.js',
  'tests/services/auth-routing.test.js',
  'tests/services/platform-admin.test.js',
  'tests/services/local-import.test.js',
  'tests/core/logger.test.js',
  'tests/core/events.test.js',
  'tests/data/supabase-vendor.test.js',
]);

function parseArgs(argv) {
  const out = { out: 'reports/security' };
  for (const arg of argv) if (arg.startsWith('--out=')) out.out = arg.slice(6);
  return out;
}

function commitOf() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local';
  }
}

function runTests() {
  const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SECURITY_TEST_FILES], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout || ''}`;
  const num = (name) => Number((out.match(new RegExp(`^# ${name} (\\d+)`, 'm')) || [])[1] || 0);
  const failures = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]).slice(0, 50);
  return { files: SECURITY_TEST_FILES.length, tests: num('tests'), pass: num('pass'), fail: num('fail'), cancelled: num('cancelled'), exitCode: res.status, failures };
}

const ICON = Object.freeze({ pass: 'OK', fail: 'FALLA', human: 'DECISIÓN' });

function toMarkdown(report) {
  const lines = [];
  lines.push(`# RATEOS — Beta Security Gate`);
  lines.push('');
  lines.push(`- Commit: \`${report.commit}\` · fecha: ${report.date}`);
  lines.push(`- Veredicto: **${report.ok ? 'PASA' : 'NO PASA'}** (P0/P1 en falla: ${report.blocking.length}; P2 en falla: ${report.warnings.length}; decisiones del dueño: ${report.human.length})`);
  lines.push(`- Tests del gate: ${report.tests.pass}/${report.tests.tests} en verde (${report.tests.files} archivos)${report.tests.fail ? ` — **${report.tests.fail} fallan**` : ''}`);
  lines.push('- Negación real entre empresas: en la base (supabase/tests/*.sql), ver docs/BETA_SECURITY.md.');
  lines.push('');
  lines.push('| Control | Severidad | Categoría | Estado | Detalle |');
  lines.push('|---|---|---|---|---|');
  for (const r of report.results) {
    const detail = r.details.join(' · ').replace(/\|/g, '\\|');
    lines.push(`| ${r.id} — ${r.title.replace(/\|/g, '\\|')} | ${r.severity} | ${r.category} | ${ICON[r.status]} | ${detail} |`);
  }
  if (report.tests.failures.length) {
    lines.push('');
    lines.push('## Tests que fallan');
    report.tests.failures.forEach((f) => lines.push(`- ${f}`));
  }
  return `${lines.join('\n')}\n`;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode || 0);
  throw error;
});

const args = parseArgs(process.argv.slice(2));
const results = await runSecurityChecks();
const verdict = gateVerdict(results);
const tests = runTests();
const commit = commitOf();
const date = new Date().toISOString();
const report = {
  gate: 'beta-security',
  plan: 'PLAN-2026-015',
  commit,
  date,
  ok: verdict.ok && tests.fail === 0 && tests.exitCode === 0,
  blocking: verdict.blocking.map((r) => r.id),
  warnings: verdict.warnings.map((r) => r.id),
  human: verdict.human.map((r) => r.id),
  tests,
  results,
};

const runDir = path.join(ROOT, args.out, `${date.slice(0, 19).replace(/[:T]/g, '-')}-${commit}`);
const latestDir = path.join(ROOT, args.out, 'latest');
for (const dir of [runDir, latestDir]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'beta-security-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(dir, 'beta-security-gate.md'), toMarkdown(report));
}

for (const r of results) {
  console.log(`${ICON[r.status].padEnd(8)} ${r.severity} ${r.id.padEnd(7)} ${r.title}`);
  if (r.status === 'fail') r.details.forEach((d) => console.log(`           · ${d}`));
}
console.log(`\nTests del gate: ${tests.pass}/${tests.tests} en verde (${tests.files} archivos).`);
console.log(`Reporte: ${path.relative(ROOT, latestDir)}/beta-security-gate.md`);
console.log(report.ok ? 'BETA SECURITY GATE: PASA' : `BETA SECURITY GATE: NO PASA (${[...report.blocking, ...(tests.fail ? ['tests'] : [])].join(', ')})`);
process.exitCode = report.ok ? 0 : 1;
