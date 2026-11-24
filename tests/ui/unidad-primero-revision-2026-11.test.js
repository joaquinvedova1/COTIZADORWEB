/**
 * 0.10.0 "La unidad primero" — correcciones de UX de la revisión (2026-11), en pantalla:
 *   U1  una categoría con gastos cargados no se desmarca: queda marcada y se dice dónde borrarlos.
 *   U4  "Personal" y "Equipos" se saltean si no se eligieron y no tienen nada cargado.
 *   U7  EECC: sin "Servicios de terceros" ni "Combustible" en $ 0; el renglón de equipos se llama según lo elegido.
 *   U3, U8–U12  textos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadedFor, blockedRemovalText } from '../../js/ui/views/quote-steps/service.js';
import { isStepHidden } from '../../js/ui/views/quote-editor.js';
import { displayCostRows, costRowLabel } from '../../js/ui/cost-breakdown.js';
import { chosenResourceRows } from '../../js/ui/views/quote-steps/modality.js';
import { contractWithComponents, modeForUnit } from '../../js/domain/contract.js';
import { MATERIAL_TYPES, defaultMaterialBasis } from '../../js/domain/material-types.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person, material, otherCost, owned, resetIds } from '../lab/lib/build.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function quoteWith(components, { unit = 'day', ...rest } = {}) {
  resetIds();
  const q = service({ unit, activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 8, availableDaysPerMonth: 30 }, labor: [], ...rest });
  q.contract = contractWithComponents({ mode: modeForUnit(unit) }, components);
  return q;
}

describe('U1 · desmarcar una categoría con gastos cargados', () => {
  // PLAN-2026-027: se cuenta por bloque de "¿Qué incluye?" (los 5 tipos son un solo bloque).
  test('Insumos y materiales con un gasto: no se puede desmarcar y el aviso dice cuánto y dónde borrarlo', () => {
    const q = quoteWith(['labor', 'ppe', 'tools']);
    q.materialsNotApplicable = false;
    q.materials = [material({ id: 'm1', description: 'Traje', quantity: 1, unitCost: 45_000, basis: 'per_month', component: 'ppe' })];
    assert.equal(loadedFor(q, 'ppe', ['labor']).count, 1);
    assert.equal(loadedFor(q, 'tools', ['labor']).count, 1, 'el bloque entero');
    assert.equal(loadedFor(q, 'ppe', ['labor', 'tools']).count, 0, 'si queda un tipo marcado, el bloque sigue elegido');
    const r = computeQuote(q);
    assert.equal(blockedRemovalText(q, 'ppe', ['labor'], r).replace(/\s/g, ' '), 'Insumos y materiales tiene 1 gasto cargado ($ 45.000 por mes): borralo en «Insumos y materiales» para desmarcarlo.');
    assert.equal(blockedRemovalText(q, 'ppe', ['labor']), 'Insumos y materiales tiene 1 gasto cargado: borralo en «Insumos y materiales» para desmarcarlo.');
  });

  test('Insumos y materiales cuenta también los gastos cargados antes; Personal, sus puestos', () => {
    const q = quoteWith(['labor', 'other']);
    q.otherCosts = [otherCost({ id: 'o1', description: 'Permiso', amount: 30_000 }), otherCost({ id: 'o2', description: 'Laboratorio', amount: 1, category: 'external' })];
    q.labor = [person({ role: 'Técnico', positions: 1, basicMonthly: 1_000_000 }), person({ role: 'Ayudante', positions: 1, basicMonthly: 800_000 })];
    assert.equal(loadedFor(q, 'other').count, 2);
    assert.match(blockedRemovalText(q, 'labor', ['other']), /^Personal tiene 2 puestos cargados: borralos en «Personal» para desmarcarlo\.$/);
  });

  test('Vehículos / Equipos / Terceros: se bloquea sólo si no queda ninguno de los tres marcado', () => {
    const q = quoteWith(['labor', 'vehicle', 'machinery']);
    q.equipment = [owned({ name: 'Camioneta' })];
    assert.equal(loadedFor(q, 'vehicle', ['labor', 'machinery']).count, 0);
    assert.equal(loadedFor(q, 'machinery', ['labor']).count, 1);
    assert.match(blockedRemovalText(q, 'machinery', ['labor']), /^Equipos y vehículos tiene 1 equipo cargado: borralo en «Equipos» para desmarcarlo\.$/);
  });

  test('la pantalla usa la regla antes de guardar (no destructiva)', () => {
    const s = code('js/ui/views/quote-steps/service.js');
    assert.match(s, /const blocked = components\.filter\(\(id\) => !list\.includes\(id\) && loadedFor\(quote, id, list\)\.count > 0\)/);
  });
});

describe('U4 · etapas según lo elegido', () => {
  test('sin Personal ni equipos elegidos ni cargados: se saltean Personal y Equipos', () => {
    const q = quoteWith(['tools', 'supplies']);
    assert.equal(isStepHidden('labor', q), true);
    assert.equal(isStepHidden('equipment', q), true);
    assert.equal(isStepHidden('materials', q), false);
  });

  test('elegidos o con algo cargado: se ven', () => {
    assert.equal(isStepHidden('labor', quoteWith(['labor'])), false);
    assert.equal(isStepHidden('equipment', quoteWith(['subcontract'])), false);
    assert.equal(isStepHidden('equipment', quoteWith(['vehicle'])), false);
    const q = quoteWith(['tools']);
    q.labor = [person({ role: 'Técnico' })];
    q.equipment = [owned({ name: 'Generador' })];
    assert.equal(isStepHidden('labor', q), false);
    assert.equal(isStepHidden('equipment', q), false);
  });

  test('cotizaciones sin componentes (anteriores, demo): no se esconde nada', () => {
    resetIds();
    const q = service({ unit: 'day', labor: [] });
    delete q.contract;
    assert.equal(isStepHidden('labor', q), false);
    assert.equal(isStepHidden('equipment', q), false);
  });

  test('la barra de etapas lleva al primer paso visible de cada etapa', () => {
    const s = code('js/ui/views/quote-editor.js');
    assert.match(s, /stage\.steps\.find\(\(st\) => st\.id === currentStep \|\| !isHidden\(st\.id\)\)/);
    assert.match(s, /buildStageBar\(\{ currentStep: stepId, stepHref, quoteId, isHidden: \(id\) => isStepHidden\(id, state\.quote\) \}\)/);
  });
});

describe('U7 · EECC según lo elegido', () => {
  const eecc = (amounts) => ({ rows: ['labor', 'equipment', 'external', 'fuel', 'materials', 'logistics', 'structure', 'financial', 'contingency'].map((category) => ({ category, label: category, amount: amounts[category] || 0, children: category === 'materials' ? [] : undefined })) });

  test('sin terceros elegidos ni montos: no hay "Servicios de terceros" ni "Combustible" en $ 0', () => {
    const rows = displayCostRows(eecc({ labor: 100, equipment: 50 }), ['labor', 'vehicle', 'tools']);
    const cats = rows.map((r) => r.category);
    assert.ok(!cats.includes('external'));
    assert.ok(!cats.includes('fuel'));
    assert.ok(cats.includes('equipment'));
    // Con terceros elegidos sí (aunque esté en $ 0); con combustible cargado, también.
    assert.ok(displayCostRows(eecc({ labor: 1 }), ['labor', 'subcontract']).some((r) => r.category === 'external'));
    assert.ok(displayCostRows(eecc({ fuel: 10 }), ['labor', 'vehicle']).some((r) => r.category === 'fuel'));
  });

  test('el renglón de equipos es siempre "Equipos y vehículos" (PLAN-2026-027: un solo bloque)', () => {
    assert.equal(costRowLabel('equipment', 'Equipos propios', ['vehicle']), 'Equipos y vehículos');
    assert.equal(costRowLabel('equipment', 'Equipos propios', ['machinery', 'labor']), 'Equipos y vehículos');
    assert.equal(costRowLabel('equipment', 'Equipos propios', ['vehicle', 'machinery']), 'Equipos y vehículos');
    assert.equal(costRowLabel('equipment', 'Equipos propios', null), 'Equipos y vehículos');
    assert.equal(costRowLabel('external', 'x', ['vehicle']), 'Servicios de terceros');
    assert.equal(costRowLabel('materials:tools', 'Herramientas', ['tools']), 'Herramientas');
  });
});

describe('U3 · ¿Cada cuánto se consume? en la unidad de cobro', () => {
  test('por cantidad: "Por diagnóstico" primero y elegido en las líneas nuevas; Herramientas: lo que gastás por mes', () => {
    const s = code('js/ui/views/quote-steps/materials.js');
    assert.match(s, /label: `Por \$\{unitInfo\.singular \|\| 'unidad'\}`/);
    assert.match(s, /const keepActivation = !withComponents \|\| byEventUnit \|\| used === 'per_activation';/);
    // PLAN-2026-027: la base de una línea nueva sale de defaultMaterialBasis (unidad de cobro y tipo).
    assert.match(s, /line\.basis = defaultMaterialBasis\(quote, lastBlankType\);/);
    assert.equal(defaultMaterialBasis({ unit: 'custom', unitName: 'diagnóstico' }, 'supplies'), 'per_output');
    assert.equal(defaultMaterialBasis({ unit: 'custom', unitName: 'diagnóstico' }, 'tools'), 'per_month');
    assert.match(MATERIAL_TYPES.find((t) => t.id === 'tools').hint, /Lo que gastás en reponerlas \(no el precio de compra entero\)/);
  });

  test('"Por diagnóstico" calcula con lo que se hace por día (motor)', () => {
    resetIds();
    const q = service({ unit: 'custom', unitName: 'diagnóstico', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, availableDaysPerMonth: 30 }, labor: [] });
    q.contract = contractWithComponents({ mode: 'on_demand' }, ['supplies']);
    q.materialsNotApplicable = false;
    q.materials = [material({ id: 'm1', description: 'Kit', quantity: 1, unitCost: 1_000, basis: 'per_output', component: 'supplies' })];
    const r = computeQuote(q);
    assert.ok(Math.abs(r.componentCosts.byComponent.supplies.inMaterials.amount - 40_000) < 1e-6);
    assert.ok(Math.abs(r.componentCosts.byComponent.supplies.inMaterials.perBilledUnit - 1_000) < 1e-6);
  });
});

describe('U8–U12 · textos', () => {
  test('U8: sin "Otro componente [Agregar]"; los propios guardados se siguen viendo con su ×', () => {
    const s = code('js/ui/views/quote-steps/service.js');
    assert.doesNotMatch(s, /id: 'cmp-custom', maxlength/);
    assert.match(s, /custom\.length \? h\('div', \{ class: 'variant-suggest qe-custom-block' \}/);
    assert.match(s, /'aria-label': `Quitar \$\{name\}`/);
  });

  test('U9 (0.20.0): el ritmo se pregunta en el paso 1, debajo de la unidad', () => {
    const s = code('js/ui/views/quote-steps/service.js');
    assert.match(s, /renderCharge\(rhythm, \{ \.\.\.ctx, part: 'rhythm' \}\)/);
    assert.match(s, /mount\(container, identity, unitCard, rhythm, includes/);
  });

  test('U10: "Lo que ya cargaste" sólo con las categorías elegidas', () => {
    const rows = chosenResourceRows(quoteWith(['labor', 'tools', 'supplies']));
    assert.equal(rows.labor, true);
    assert.equal(rows.equipment, false);
    assert.equal(rows.otherLabel, 'Materiales');
    const v = chosenResourceRows(quoteWith(['labor', 'vehicle', 'travel']));
    assert.equal(v.equipmentLabel, 'Vehículos');
    assert.equal(v.otherLabel, 'Combustible y viajes');
    assert.equal(chosenResourceRows({}).otherLabel, 'Materiales, combustible y viajes');
  });

  test('U11: unidad de cobro definida; tarifa del mes', () => {
    assert.match(code('js/engines/completeness-engine.js'), /'Unidad de cobro definida\.'/);
    const m = code('js/ui/views/quote-steps/modality.js');
    assert.match(m, /¿Qué cubre la tarifa del mes\?/);
    assert.match(m, /Cobrás una tarifa por mes: un solo precio\./);
    // 0.24.0: sin etapa "Cómo se cobra"; el ritmo se dice en "El servicio".
    assert.match(code('js/ui/views/quotes-list.js'), /'Qué servicio vas a prestar, en qué unidad le cobrás al cliente y cuánto esperás trabajar\.'/);
  });

  test('U12: resumen de "Insumos y materiales" con un renglón por tipo con monto', () => {
    const s = code('js/ui/views/quote-steps/materials.js');
    assert.doesNotMatch(s, /\(incluye otros costos de categoría Materiales\)\.`/);
    assert.match(s, /h\('span', \{\}, materialTypeShort\(id\)\)/);
    assert.match(s, /label: 'Insumos y materiales',/);
  });
});
