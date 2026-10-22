/**
 * DESIGN-02 (PLAN-2026-025) · Sistema de diseño "Ingeniería clara".
 *
 * - DESIGN.md (raíz) dice los mismos colores que css/styles.css: los alias
 *   por función (--color-*) existen y llegan al mismo hex.
 * - Contraste de los tokens: texto ≥ 4,5:1; bordes de campos y foco ≥ 3:1.
 * - La raíz sigue el tamaño de letra del navegador (en %, no en px).
 * - Ningún tamaño de letra de la app por debajo de 12 px (0,8 rem).
 * - Cifras clave tabulares, "Ver cálculo" de 24 px, piso y objetivo del
 *   gráfico con trazo distinto y campos de tablas con el borde de los campos.
 *
 * Estático: lee los archivos, sin navegador. Lo que se ve en pantalla lo mide
 * el bloque DESIGN-02 de tests/lab/e2e/ui-lab.mjs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** CSS de la aplicación (la landing y el registro, css/public.css, van en D7 después de HD-03). */
const APP_CSS = ['css/styles.css', 'css/quote.css', 'css/result.css', 'css/views.css'];
const STYLES = read('css/styles.css');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));

/** Variables de :root (la primera regla :root de styles.css). */
function rootVars(css) {
  const m = /:root\s*\{([\s\S]*?)\n\}/.exec(stripComments(css));
  assert.ok(m, 'falta :root en css/styles.css');
  const vars = {};
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  return vars;
}
const VARS = rootVars(STYLES);

/** Valor final de una variable: sigue las cadenas var(--x). */
function resolveVar(name, seen = new Set()) {
  assert.ok(!seen.has(name), `ciclo en ${name}`);
  seen.add(name);
  const v = VARS[name];
  if (v === undefined) return undefined;
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? resolveVar(ref[1], seen) : v;
}

/** Contraste WCAG 2.x entre dos colores #RRGGBB. */
function contrast(a, b) {
  const lum = (hex) => {
    const c = /^#([0-9a-f]{6})$/i.exec(hex);
    assert.ok(c, `color inválido ${hex}`);
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(c[1].slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Frontmatter de DESIGN.md: sólo el bloque `colors:` (clave: "#hex"). */
function designColors(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  assert.ok(fm, 'DESIGN.md no tiene frontmatter');
  const block = /\ncolors:\n((?: {2}[\w-]+: "#[0-9A-Fa-f]{6}"\n?)+)/.exec(`\n${fm[1]}\n`);
  assert.ok(block, 'el frontmatter no tiene el bloque colors');
  return Object.fromEntries([...block[1].matchAll(/ {2}([\w-]+): "(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2]]));
}

/** Declaraciones font-size de un CSS con su línea (sin comentarios). */
function fontSizes(file) {
  const out = [];
  stripComments(read(file)).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/font-size\s*:\s*([^;}]+)/g)) out.push({ where: `${file}:${i + 1}`, value: m[1].trim() });
  });
  return out;
}

/** px de un tamaño con raíz de 15 px (escritorio); null si es relativo al padre (em, %) o no se sabe. */
function sizePx(value) {
  const v = value.replace(/\s*!important$/, '');
  const varRef = /^var\((--fs-[\w-]+)\)$/.exec(v);
  if (varRef) return sizePx(resolveVar(varRef[1]) || '');
  const m = /^([0-9.]+)(rem|px)$/.exec(v);
  if (!m) return null;
  return m[2] === 'rem' ? Number(m[1]) * 15 : Number(m[1]);
}

describe('DESIGN-02 · DESIGN.md y tokens', () => {
  test('DESIGN.md está en la raíz con frontmatter de colores y las secciones del sistema', () => {
    assert.ok(existsSync(path.join(ROOT, 'DESIGN.md')), 'falta DESIGN.md en la raíz');
    const md = read('DESIGN.md');
    const sections = ['Principios', 'Color', 'Tipografía y números', 'Riesgo y estados', 'Componentes', 'Celular', 'Impresión', 'Voz y textos', 'Accesibilidad', 'Estados de pantalla', 'Guía para agentes'];
    for (const s of sections) assert.match(md, new RegExp(`^## \\d+\\. ${s}`, 'm'), `falta la sección "${s}"`);
    assert.ok(Object.keys(designColors(md)).length >= 15, 'el frontmatter tiene menos de 15 colores');
  });

  test('cada color de DESIGN.md es un alias --color-* de css/styles.css y llega al mismo valor', () => {
    const colors = designColors(read('DESIGN.md'));
    for (const [key, hex] of Object.entries(colors)) {
      const alias = `--color-${key}`;
      assert.ok(VARS[alias] !== undefined, `falta ${alias} en :root`);
      assert.match(VARS[alias], /^var\(--[\w-]+\)$/, `${alias} tiene que apuntar a un token de la paleta, no a un hex suelto`);
      assert.equal(String(resolveVar(alias)).toUpperCase(), hex.toUpperCase(), `${alias}: DESIGN.md dice ${hex}`);
    }
  });

  test('contraste de los tokens: texto ≥ 4,5:1 y bordes de campos y foco ≥ 3:1 (WCAG 1.4.3 y 1.4.11)', () => {
    const c = (name) => resolveVar(name);
    const white = c('--color-surface');
    for (const text of ['--color-text', '--color-text-secondary', '--color-text-muted', '--color-link', '--color-brand']) {
      for (const bg of ['--color-surface', '--color-bg']) {
        assert.ok(contrast(c(text), c(bg)) >= 4.5, `${text} sobre ${bg}: ${contrast(c(text), c(bg)).toFixed(2)}:1`);
      }
    }
    for (const s of ['ok', 'review', 'critical', 'info']) {
      const ratio = contrast(c(`--color-status-${s}`), c(`--color-status-${s}-bg`));
      assert.ok(ratio >= 4.5, `--color-status-${s} sobre su fondo: ${ratio.toFixed(2)}:1`);
    }
    assert.ok(contrast(c('--color-border-control'), white) >= 3, 'borde de campos < 3:1');
    for (const bg of ['--color-surface', '--color-bg']) assert.ok(contrast(c('--color-focus'), c(bg)) >= 3, `foco sobre ${bg} < 3:1`);
  });
});

describe('DESIGN-02 · tamaños de letra', () => {
  test('la raíz va en % (sigue el tamaño de letra que elige la persona; WCAG 1.4.4)', () => {
    const roots = [...stripComments(STYLES).matchAll(/(?:^|\n)\s*html\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((b) => /font-size/.test(b));
    assert.ok(roots.length >= 2, 'faltan las reglas de la raíz (escritorio y celular)');
    for (const b of roots) assert.match(b, /font-size\s*:\s*[0-9.]+%/, `raíz en px: ${b.trim()}`);
    assert.match(STYLES, /html\s*\{[^}]*font-size\s*:\s*93\.75%/, 'escritorio: 93,75 % (15 px con la letra de fábrica)');
  });

  test('--fs-xs es el mínimo: 0,8 rem (12 px)', () => {
    assert.equal(VARS['--fs-xs'], '0.8rem');
  });

  test('ningún tamaño de letra de la app por debajo de 12 px (0,8 rem)', () => {
    const small = APP_CSS.flatMap(fontSizes).filter((d) => {
      const px = sizePx(d.value);
      return px !== null && px < 11.99;
    });
    assert.deepEqual(small.map((d) => `${d.where} ${d.value}`), []);
  });

  test('un tamaño relativo al padre (em) por debajo de 1 lleva piso: max(…, var(--fs-xs))', () => {
    const bare = APP_CSS.flatMap(fontSizes).filter((d) => {
      const m = /^([0-9.]+)em$/.exec(d.value.replace(/\s*!important$/, ''));
      return m && Number(m[1]) < 1;
    });
    assert.deepEqual(bare.map((d) => `${d.where} ${d.value}`), []);
  });

  test('la etiqueta ILUSTRATIVO de las páginas públicas también llega a 12 px', () => {
    const rule = /\.pub-tag-illustrative\s*\{([^}]*)\}/.exec(stripComments(read('css/public.css')));
    assert.ok(rule, 'falta .pub-tag-illustrative');
    const size = /font-size\s*:\s*([^;]+);/.exec(rule[1]);
    assert.ok(size && sizePx(size[1].trim()) >= 12, `ILUSTRATIVO público: ${size && size[1]}`);
  });
});

describe('DESIGN-02 · montos, "Ver cálculo", gráfico y campos', () => {
  test('ninguna cifra anula las cifras tabulares (font-variant-numeric: normal)', () => {
    for (const f of APP_CSS) assert.doesNotMatch(stripComments(read(f)), /font-variant-numeric\s*:\s*normal/, f);
  });

  test('"Ver cálculo" mide al menos 24 px de alto también en escritorio (WCAG 2.5.8)', () => {
    const rule = /\.btn-link\.trace-btn\s*\{([^}]*)\}/.exec(stripComments(STYLES));
    assert.ok(rule, 'falta la regla .btn-link.trace-btn fuera del celular');
    const h = /min-height\s*:\s*([0-9.]+)px/.exec(rule[1]);
    assert.ok(h && Number(h[1]) >= 24, `min-height ${h && h[1]}`);
  });

  test('gráfico: la tarifa piso va punteada, el objetivo lleno, y la leyenda los muestra igual (WCAG 1.4.1)', () => {
    const css = stripComments(read('css/result.css'));
    const decl = (sel) => {
      const m = new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
      assert.ok(m, `falta ${sel}`);
      return m[1];
    };
    assert.match(decl('.qr-chart-floor'), /stroke-dasharray\s*:\s*[0-9]/, 'la línea del piso no está punteada');
    assert.doesNotMatch(decl('.qr-chart-target'), /stroke-dasharray/, 'el objetivo tiene que quedar lleno');
    assert.match(decl('.qr-key-floor'), /dashed|dotted/, 'la muestra del piso en la leyenda no está punteada');
  });

  test('los campos dentro de tablas usan el borde de los campos (3:1), no el de decoración', () => {
    const m = /\.table input,\s*\.table select\s*\{([^}]*)\}/.exec(stripComments(STYLES));
    assert.ok(m, 'falta la regla de campos en tablas');
    assert.match(m[1], /border\s*:\s*1px solid var\(--(?:color-border-control|field-border)\)/);
  });
});
