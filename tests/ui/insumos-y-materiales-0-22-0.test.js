/**
 * 0.22.0 "Una sola lista Insumos y materiales" (PLAN-2026-027): controles estáticos del código
 * de la interfaz (sin DOM). El paso es una lista sin secciones, con "Tipo" junto al nombre; no
 * quedan "Va a" ni "Agregar costo"; los gastos guardados antes se ven sólo si existen; el
 * formulario de Recursos no pide cantidad, base ni markup; el PDF del cliente lista bloques.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { QUOTE_STEPS, COST_CATEGORIES } from '../../js/domain/catalogs.js';
import { costRowLabel } from '../../js/ui/cost-breakdown.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person } from '../lab/lib/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
// Sin comentarios: sólo lo que se ve.
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

const STEP = code('js/ui/views/quote-steps/materials.js');
const LIBRARY = code('js/ui/views/library.js');
const RESULT = code('js/ui/views/quote-result.js');

describe('paso "Insumos y materiales"', () => {
  test('el paso y el renglón se llaman "Insumos y materiales"', () => {
    assert.equal(QUOTE_STEPS.find((s) => s.id === 'materials').label, 'Insumos y materiales');
    assert.equal(COST_CATEGORIES.find((c) => c.id === 'materials').label, 'Insumos y materiales');
    const row = computeQuote(service({ id: 'iym-ui', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] })).eecc.rows.find((r) => r.category === 'materials');
    assert.equal(costRowLabel('materials', row.label), 'Insumos y materiales');
  });

  test('una sola lista: sin secciones por tipo, con "Tipo" junto al nombre de cada línea', () => {
    assert.match(STEP, /title: 'Insumos y materiales'/);
    assert.doesNotMatch(STEP, /qe-material-section|sectionOf\(|SECTIONS\b/);
    const card = STEP.slice(STEP.indexOf('const materialCard'));
    const tipo = card.indexOf("label: 'Tipo'");
    const que = card.indexOf('¿Qué es?');
    assert.ok(tipo > 0 && que > 0 && Math.abs(tipo - que) < 2500, 'Tipo y ¿Qué es? en el mismo encabezado');
    assert.match(card, /name: `\$\{p\}\.component`/);
  });

  test('no quedan "Va a", "Categoría" de línea ni "Agregar costo"', () => {
    assert.doesNotMatch(STEP, /['"`]Va a:?['"`]/);
    assert.doesNotMatch(STEP, /Agregar costo/);
    assert.doesNotMatch(STEP, /label: 'Categoría'/);
    assert.doesNotMatch(STEP, /['"`]Otros costos['"`]/);
  });

  test('agregar en blanco con un tipo elegido; desde Recursos con la base de la unidad de cobro', () => {
    assert.match(STEP, /'Agregar en blanco'/);
    assert.match(STEP, /name: 'newMaterialType'/);
    assert.match(STEP, /DEFAULT_BLANK_TYPE/);
    assert.match(STEP, /defaultMaterialBasis\(/);
    assert.doesNotMatch(STEP, /localStorage/);
  });

  test('"Gastos cargados antes" sólo aparece con otherCosts, y sólo se pasan a la lista los de Insumos y materiales', () => {
    assert.match(STEP, /quote\.otherCosts\.length\s*\?\s*card\(\s*\{ title: 'Gastos cargados antes'/);
    assert.match(STEP, /'Pasar a la lista'/);
    assert.match(STEP, /otherCostToMaterialLine\(/);
    assert.match(STEP, /row\.line\.category === 'materials' && !kit\.readOnly\s*\?\s*button\('Pasar a la lista'/);
    assert.match(STEP, /Puede estar contado también en "\$\{stepName\('indirect'\)\}"/);
  });
});

describe('Recursos → Insumos y materiales', () => {
  const start = LIBRARY.indexOf('function materialSections');
  const form = LIBRARY.slice(start, LIBRARY.indexOf('\nfunction ', start + 10));

  test('el formulario no pide cantidad, base ni markup; sí el tipo', () => {
    assert.ok(start > 0);
    assert.match(form, /key: 'component'/);
    for (const key of ['quantity', 'basis', 'resaleMarkupPct']) assert.doesNotMatch(form, new RegExp(`key: '${key}'`), key);
    assert.match(form, /Sin tipo/);
  });

  test('la pestaña y el botón hablan de insumos y materiales', () => {
    assert.match(LIBRARY, /'Insumos y materiales'/);
    assert.match(LIBRARY, /'Agregar insumo o material'/);
  });

  test('la ropa de trabajo y el EPP básico siguen en el puesto (D6)', () => {
    assert.match(LIBRARY, /Ropa de trabajo y EPP básico \(por persona\)/);
    assert.match(code('js/ui/views/quote-steps/labor.js'), /Ropa de trabajo y EPP básico \(por persona\)/);
  });
});

describe('PDF del cliente', () => {
  test('"Incluye" lista los 4 bloques de "¿Qué incluye?", no los componentes', () => {
    assert.match(RESULT, /blocksOf\(q\.contract\)/);
    assert.match(RESULT, /INCLUDE_BLOCKS/);
    assert.match(RESULT, /row\('Incluye'/);
  });
});

describe('"¿Qué incluye?"', () => {
  test('4 casillas, una por bloque', () => {
    const svc = code('js/ui/views/quote-steps/service.js');
    assert.match(svc, /INCLUDE_BLOCKS\.map\(/);
    assert.match(svc, /name: 'contractComponents'/);
  });
});
