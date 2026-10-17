/**
 * RATEOS Test Lab — candado de los golden cases (PLAN-2026-013).
 *
 * Los golden son reglas de negocio aprobadas: Test Lab JAMÁS los actualiza
 * porque cambió un resultado. Este candado guarda la huella (SHA-256 del JSON
 * canónico de engine + inputs + expected + tolerance) de cada caso aprobado.
 * Si un caso cambia, desaparece o aparece uno nuevo sin aprobar → FAIL con la
 * explicación de qué hacer (AGENTS.md §10: se discute y documenta antes).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCases } from '../../golden-cases/harness.js';

export const LOCK_PATH = fileURLToPath(new URL('../golden-lock.json', import.meta.url));

/** JSON con claves ordenadas (la huella no depende del orden en que se escribió el archivo). */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Huella de lo que define el caso (no de su título ni de su texto explicativo). */
export function fingerprint(data) {
  const { engine, inputs, expected, tolerance } = data;
  return createHash('sha256').update(canonical({ engine, inputs, expected, tolerance })).digest('hex');
}

export function readLock() {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
}

/**
 * Compara los golden actuales con el candado.
 * @returns {{ ok: boolean, total: number, problems: { id: string, kind: 'changed'|'missing'|'unapproved', message: string }[] }}
 */
export function checkGoldenLock() {
  const lock = readLock();
  const cases = loadCases();
  const problems = [];
  const seen = new Set();
  for (const { file, data } of cases) {
    seen.add(data.id);
    const entry = lock.cases[data.id];
    const hash = fingerprint(data);
    if (!entry) {
      problems.push({ id: data.id, kind: 'unapproved', message: `${file}: golden nuevo sin aprobar. Si es una regla de negocio aprobada, agregalo a tests/lab/golden-lock.json con el motivo.` });
    } else if (entry.sha256 !== hash) {
      problems.push({ id: data.id, kind: 'changed', message: `${file}: cambió la definición del caso (motor, entradas, esperado o tolerancia). Es un cambio de REGLA DE NEGOCIO: se discute y documenta (CALCULATION_RULES + CHANGELOG) antes de tocar el caso, y recién entonces se actualiza la huella con el motivo. Test Lab nunca lo actualiza solo.` });
    }
  }
  for (const id of Object.keys(lock.cases)) {
    if (!seen.has(id)) problems.push({ id, kind: 'missing', message: `${id}: el golden aprobado ya no existe en tests/golden-cases/. Borrar un golden es un cambio de regla de negocio.` });
  }
  return { ok: problems.length === 0, total: cases.length, problems };
}
