/**
 * La interfaz no recalcula precios ni márgenes (AGENTS.md §4: "si una pantalla
 * necesita un número, lo pide a un motor"). Con los impuestos sobre la
 * facturación (PLAN-2026-002) una fórmula copiada en la UI —(1 − margen),
 * precio − costo, margen → markup sin impuestos— daría números distintos de los
 * del motor. Este test impide que vuelvan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UI = join(ROOT, 'js', 'ui');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.js') ? [full] : [];
  });
}

const FILES = walk(UI).map((full) => ({ rel: relative(ROOT, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') }));

/** Líneas de código (sin comentarios de línea) que matchean un patrón. */
function hits(pattern, { except = [] } = {}) {
  return FILES.filter((f) => !except.includes(f.rel)).flatMap((f) => f.text.split('\n').map((line, i) => ({ f, line, i }))
    .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && pattern.test(line))
    .map(({ f, line, i }) => `${f.rel}:${i + 1}: ${line.trim()}`));
}

describe('la interfaz no recalcula precios ni márgenes', () => {
  test('sin (1 − margen) ni (1 − impuestos) en la UI', () => {
    const found = hits(/\(\s*1\s*-\s*(m|margin|marginPct|targetMarginPct|t|taxes|billingTaxPct)\b/);
    assert.deepEqual(found, [], `Usá los valores del motor (requiredRatesAt, priceLadder, kpis):\n${found.join('\n')}`);
  });

  test('sin "precio − costo" ni ejemplos con divisores escritos a mano', () => {
    const found = [...hits(/row\.price\s*-\s*cost/), ...hits(/\b100\s*\/\s*0\.9\b/)];
    assert.deepEqual(found, [], found.join('\n'));
  });

  test('el markup equivalente de una cotización sale del motor (con impuestos), no de marginToMarkup', () => {
    // El panel educativo del Inicio compara margen y markup en abstracto (sin impuestos): es la única excepción.
    const found = hits(/marginToMarkup\(/, { except: ['js/ui/views/dashboard.js'] });
    assert.deepEqual(found, [], `Usá kpis.targetMarkupPct o byMargin[].markupPct:\n${found.join('\n')}`);
  });
});
