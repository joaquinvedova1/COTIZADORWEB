/**
 * 0.24.0 (PLAN-2026-028, PR 2, W-01): un solo precio en el Resultado y en el resumen del editor.
 *
 * - El resumen del Resultado tiene UNA cifra grande, el precio que se cobra ("Precio sugerido" o
 *   "Tu precio"); debajo, "Te cuesta $ X · ganás $ Y (Z %)" y la mínima en un renglón de detalle,
 *   "¿Hasta cuánto puedo bajar?".
 * - Las cinco tarjetas de antes quedan en "Todos los indicadores".
 * - El resumen del editor muestra sólo el precio; el resto va en "Ver más" (mismos data-kpi).
 * - Sólo pantalla: ningún número cambia (la foto tanda4-sin-cambio lo controla).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { auditTerminology } from '../lab/lib/ux-audit.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

describe('un solo precio en el Resultado', () => {
  const src = code('js/ui/views/quote-result.js');
  const summary = between(src, 'function renderSummary(v)', '\n}\n');

  test('el resumen tiene una sola cifra grande: el precio', () => {
    assert.match(summary, /priceStat\(v, \{ hero: true \}\)/);
    assert.match(summary, /summaryLine\(v\)/);
    assert.match(summary, /floorStat\(v, \{ row: true \}\)/);
    for (const fn of ['costStat(v)', 'profitStat(v)', 'marginStat(v)']) assert.ok(!summary.includes(fn), fn);
  });

  test('la cifra grande se llama "Precio sugerido" o "Tu precio"', () => {
    assert.match(src, /const suggestedName = hero \? 'Precio sugerido' : suggestedRateName\(r\);/);
    assert.match(src, /const ownName = hero \? 'Tu precio' : null;/);
  });

  test('la línea "Te cuesta · ganás (Z %)" con el margen que pediste, y NO CONFIABLE cuando corresponde', () => {
    const line = between(src, 'function summaryLine(v)', '\n}\n');
    assert.match(line, /`Te cuesta \$\{money/);
    assert.match(line, /losing \? 'perdés' : 'ganás'/);
    // Revisión de la 0.24.0 (B-2): el pedido sólo si la diferencia es del redondeo (shownMarginPct).
    assert.match(line, /shownMarginPct\(k, \{ covered, losing, marginPct/);
    assert.match(line, /unreliableText\(r\.completeness, 'este margen'\)/);
    // ECO-01 lee la primera .qr-stat-margin de la página: es esta línea.
    assert.match(line, /'qr-stat-margin'/);
    assert.doesNotMatch(line, /Ganás/);
  });

  test('la mínima va en un renglón "¿Hasta cuánto puedo bajar?", con su "Ver cálculo"', () => {
    const floor = between(src, 'function floorStat(v', '\n}\n');
    assert.match(floor, /row \? '¿Hasta cuánto puedo bajar\?' : floorRateName\(v\.r\)/);
    assert.match(floor, /trace: costOk \? floorSummaryTrace\(v\) : null/);
  });

  test('las cinco tarjetas quedan en "Todos los indicadores"', () => {
    const detail = between(src, 'function renderResultDetail(v)', '\n}\n');
    assert.match(detail, /priceStat\(v\), costStat\(v\), profitStat\(v\), marginStat\(v\), floorStat\(v\)/);
  });

  test('"tarifa mínima" y "tarifa sugerida" siguen con su nombre (UX-TERM-DISTINCT)', () => {
    assert.deepEqual(auditTerminology().filter((f) => f.id === 'UX-TERM-DISTINCT'), []);
  });
});

describe('el resumen del editor muestra sólo el precio', () => {
  const src = code('js/ui/views/quote-editor.js');
  const build = between(src, 'function buildSummary(', '\nfunction ');
  const main = between(build, "{ class: 'qe-sum-list qe-sum-main' }", "{ class: 'qe-sum-list qe-sum-more-list' }");
  const more = between(build, "{ class: 'qe-sum-list qe-sum-more-list' }", 'const moreHint');

  test('a la vista, sólo commercialRate', () => {
    assert.deepEqual([...main.matchAll(/key: '(\w+)'/g)].map((m) => m[1]), ['commercialRate']);
  });

  test('costo, mínima y equilibrio en "Ver más", con sus data-kpi', () => {
    const keys = [...more.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
    for (const key of ['totalCost', 'floorRate', 'breakEven']) assert.ok(keys.includes(key), key);
  });
});
