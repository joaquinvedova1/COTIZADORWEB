/**
 * DESIGN-02 (2/2, PLAN-2026-026) · Cotizar sin fricción.
 *
 * - Barra compacta del resumen en vivo (1180 px o menos): costo, piso, tarifa
 *   cobrada (destacada) y margen esperado; "Para no perder" y el resultado en
 *   pesos quedan en "Ver detalle".
 * - En el celular los avisos salen arriba, debajo de la barra de la app.
 * - Las tablas de estructura y de tramos se apilan en el celular.
 * - Un solo eco de montos, en el componente de campos (no sólo en el editor),
 *   y DESIGN.md dice por qué no se reformatea el texto del campo.
 *
 * Estático: lee los archivos, sin navegador. Lo que se ve en pantalla lo mide
 * el bloque DESIGN-02B de tests/lab/e2e/ui-lab.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));

/** Cuerpos de los bloques `@media <query> { … }` (con llaves anidadas). */
function mediaBlocks(css, query) {
  const src = stripComments(css);
  const head = `@media ${query}`;
  const out = [];
  for (let at = src.indexOf(head); at !== -1; at = src.indexOf(head, at + head.length)) {
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.push(src.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return out;
}

/** Reglas { selector, decls } de un bloque sin llaves anidadas. */
function rules(block) {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), decls: m[2] }));
}

const decl = (decls, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(decls);
  return m ? m[1].trim() : null;
};

describe('barra compacta del resumen en vivo (1180 px o menos)', () => {
  const compact = mediaBlocks(read('css/quote.css'), '(max-width: 1180px)').flatMap(rules);
  assert.ok(compact.length > 0, 'falta el bloque @media (max-width: 1180px) de css/quote.css');

  test('la tarifa cobrada se destaca: con fondo propio y la cifra más fuerte que la piso', () => {
    const commercial = compact.filter((r) => r.selector.includes('[data-kpi="commercialRate"]'));
    const backgrounds = commercial.map((r) => decl(r.decls, 'background')).filter(Boolean);
    assert.ok(backgrounds.length > 0, 'sin fondo para la tarifa cobrada en la barra compacta');
    assert.ok(backgrounds.every((b) => b !== 'transparent' && b !== 'none'), `fondo: ${backgrounds.join(' | ')}`);
    const weights = commercial.filter((r) => r.selector.includes('.qe-sum-value')).map((r) => Number(decl(r.decls, 'font-weight')));
    assert.ok(weights.some((w) => w >= 750), `peso de la cifra: ${weights.join(', ') || 'sin regla'}`);
  });

  test('plegada muestra costo, piso, tarifa cobrada y margen: "Para no perder" y el resultado van a "Ver detalle"', () => {
    const hidden = compact.filter((r) => decl(r.decls, 'display') === 'none' && r.selector.includes(':not(.is-expanded)'));
    for (const kpi of ['breakEven', 'expectedResult']) {
      assert.ok(hidden.some((r) => r.selector.includes(`[data-kpi="${kpi}"]`)), `${kpi} sigue a la vista en la barra plegada`);
    }
    for (const kpi of ['totalCost', 'floorRate', 'commercialRate', 'expectedMargin']) {
      assert.ok(!hidden.some((r) => r.selector.includes(`[data-kpi="${kpi}"]`)), `${kpi} no se ve en la barra plegada`);
    }
  });

  test('el margen lleva su palabra en la barra plegada (no sólo el color, WCAG 1.4.1)', () => {
    const state = compact.filter((r) => r.selector.includes('.qe-sum-state') && r.selector.includes(':not(.is-expanded)'));
    assert.ok(state.some((r) => decl(r.decls, 'display') && decl(r.decls, 'display') !== 'none'), 'la palabra del margen no se muestra en la barra plegada');
  });
});

describe('celular (760 px o menos)', () => {
  test('los avisos salen arriba, debajo de la barra de la app: nunca tapan el resumen fijo', () => {
    const mobile = mediaBlocks(read('css/styles.css'), '(max-width: 760px)').flatMap(rules);
    const region = mobile.filter((r) => r.selector.split(',').some((s) => s.trim() === '.toast-region'));
    assert.ok(region.length > 0, 'falta .toast-region en el bloque del celular');
    const top = region.map((r) => decl(r.decls, 'top')).find(Boolean);
    const bottom = region.map((r) => decl(r.decls, 'bottom')).find(Boolean);
    assert.ok(top && top !== 'auto', `top: ${top}`);
    assert.equal(bottom, 'auto');
  });

  test('las tablas de estructura y de tramos se apilan (qe-stack-table), como las de materiales y vehículos', () => {
    const cases = [
      ['js/ui/views/quote-steps/indirect.js', 'Rubros de estructura'],
      ['js/ui/views/quote-steps/margin.js', 'Tramos de descuento por cantidad de días'],
    ];
    for (const [file, caption] of cases) {
      const m = new RegExp(`className:\\s*'([^']*)',\\s*caption:\\s*'${caption}'`).exec(read(file));
      assert.ok(m, `no encuentro la tabla "${caption}" en ${file}`);
      assert.ok(m[1].split(/\s+/).includes('qe-stack-table'), `${file}: "${caption}" no se apila (${m[1]})`);
    }
  });
});

describe('montos: un solo eco, en el componente de campos', () => {
  test('el eco vive en numberField (todos los campos de plata), no sólo en el editor', () => {
    assert.match(read('js/ui/components.js'), /from '\.\/money-echo\.js'/);
    assert.doesNotMatch(read('js/ui/views/quote-editor.js'), /function attachMoneyEcho/);
  });

  test('DESIGN.md explica el eco y por qué no se reformatea el texto del campo', () => {
    const design = read('DESIGN.md');
    assert.match(design, /eco/i);
    assert.match(design, /no se reformatea/i);
  });
});
