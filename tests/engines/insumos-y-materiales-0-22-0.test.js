/**
 * 0.22.0 "Una sola lista Insumos y materiales" (PLAN-2026-027): esquema, sincronización con
 * Recursos, actualización de tarifas, completitud y "¿Qué incluye?" en 4 bloques. El motor no
 * cambia: ningún total de una cotización guardada se mueve.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateState } from '../../js/data/schema.js';
import { SCHEMA_VERSION } from '../../js/config.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { lineSyncStatus, applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { materialLineFromLibrary, otherCostToMaterialLine } from '../../js/domain/quote-factory.js';
import { RATE_UPDATE_CATEGORY_IDS, normalizeRateUpdate } from '../../js/domain/rate-update.js';
import { rateUpdateAmounts, rateUpdateWeights } from '../../js/engines/rate-update-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { INCLUDE_BLOCKS, INCLUDE_BLOCK_IDS, blocksOf, withBlock, blockOfComponent, contractUsesMaterials } from '../../js/domain/contract.js';
import { displayCostRows } from '../../js/ui/cost-breakdown.js';
import { service, person, material, otherCost } from '../lab/lib/build.js';

const NOW = '2026-10-16T00:00:00.000Z';
const crew = (o = {}) => service({ id: 'iym', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20 }, labor: [person()], ...o });

describe('esquema 11: tipo de un material de Recursos', () => {
  test('SCHEMA_VERSION es 11', () => assert.equal(SCHEMA_VERSION, 11));

  test('un tipo válido o ninguno es válido; uno desconocido no', () => {
    const s = createDemoState(SCHEMA_VERSION);
    s.resources.materials[0].component = 'ppe';
    delete s.resources.materials[1].component;
    assert.equal(validateState(s).ok, true);
    s.resources.materials[0].component = 'chemicals';
    const v = validateState(s);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /resources\.materials\[0\]\.component/.test(e) || /tipo desconocido/.test(String(e.message || e))), JSON.stringify(v.errors));
  });
});

describe('sincronización con Recursos', () => {
  const mat = { id: 'mat-1', description: 'Electrodos', unit: 'kg', unitCost: 9000, wastePct: 0, logisticsPct: 0, providedBy: 'contractor', component: 'supplies', base: { currency: 'ARS', period: '2026-10', type: 'manual' } };

  test('cambiar el tipo en Recursos no desactualiza la línea', () => {
    const line = { ...materialLineFromLibrary(mat, { id: 'l1', now: NOW }), basis: 'per_month', quantity: 3 };
    assert.equal(lineSyncStatus('materials', line, { materials: [mat] }).state, 'current');
    assert.equal(lineSyncStatus('materials', line, { materials: [{ ...mat, component: 'tools' }] }).state, 'current');
  });

  test('"Actualizar en esta cotización" conserva el tipo, la cantidad y la base de la línea', () => {
    const line = { ...materialLineFromLibrary(mat, { id: 'l1', now: NOW }), basis: 'per_active_day', quantity: 3, component: 'ppe' };
    const resources = { materials: [{ ...mat, unitCost: 9900, component: 'tools' }] };
    assert.equal(lineSyncStatus('materials', line, resources).state, 'changed');
    const next = applyResourceUpdate('materials', line, resources, { now: NOW });
    assert.equal(next.unitCost, 9900);
    assert.equal(next.component, 'ppe');
    assert.equal(next.quantity, 3);
    assert.equal(next.basis, 'per_active_day');
  });

  test('una línea sin tipo sigue sin tipo al actualizarse', () => {
    const { component, ...plain } = materialLineFromLibrary(mat, { id: 'l2', now: NOW });
    const next = applyResourceUpdate('materials', { ...plain, quantity: 1, basis: 'per_month' }, { materials: [{ ...mat, unitCost: 10000 }] }, { now: NOW });
    assert.equal(Object.hasOwn(next, 'component'), false);
  });
});

describe('actualización de tarifas', () => {
  test('ids y orden de categorías sin cambio', () => {
    assert.deepEqual([...RATE_UPDATE_CATEGORY_IDS], ['labor', 'equipment', 'external', 'fuel', 'tools', 'supplies', 'materials', 'ppe', 'other', 'logistics', 'structure']);
  });

  test('mismos pesos con un "Otro gasto" en la lista o cargado antes', () => {
    const before = crew({ materials: [material({ component: 'supplies', quantity: 2, unitCost: 5000 })], otherCosts: [otherCost({ description: 'Permiso', component: 'other', amount: 70000 })] });
    const after = structuredClone(before);
    after.materials.push(otherCostToMaterialLine(after.otherCosts[0], after, { id: 'm-other' }));
    after.otherCosts = [];
    const a = computeQuote(before);
    const b = computeQuote(after);
    assert.deepEqual(rateUpdateWeights(b.eecc), rateUpdateWeights(a.eecc));
    assert.ok(rateUpdateAmounts(a.eecc).other > 0);
  });

  test('una foto guardada con los ids de siempre sigue siendo válida', () => {
    const saved = { basePeriod: '2026-09', base: null, steps: [{ toPeriod: '2026-10', pcts: { labor: 5, tools: 2, supplies: 3, materials: 4, ppe: 1, other: 6 } }] };
    const ru = normalizeRateUpdate(saved);
    assert.deepEqual(ru.steps[0].pcts, saved.steps[0].pcts);
  });
});

describe('completitud', () => {
  test('el aviso de gasto en estructura es informativo: no cambia el porcentaje', () => {
    const withStructure = crew({ otherCosts: [otherCost({ description: 'Alquiler', category: 'structure', amount: 200000 })], indirect: { pct: 12 } });
    const elsewhere = crew({ otherCosts: [otherCost({ description: 'Alquiler', category: 'labor', amount: 200000 })], indirect: { pct: 12 } });
    const a = evaluateCompleteness(withStructure);
    const b = evaluateCompleteness(elsewhere);
    const notice = a.notices.find((n) => n.id === 'other_cost_structure_overlap');
    assert.ok(notice, 'avisa');
    assert.equal(notice.severity, 'info');
    assert.match(notice.message, /Gastos cargados antes/);
    assert.ok(!b.notices.some((n) => n.id === 'other_cost_structure_overlap'));
    assert.equal(a.scorePct, b.scorePct);
  });

  test('sin estructura cargada no avisa', () => {
    const q = crew({ otherCosts: [otherCost({ category: 'structure', amount: 1000 })], indirect: { pct: 0, amount: 0 } });
    assert.ok(!evaluateCompleteness(q).notices.some((n) => n.id === 'other_cost_structure_overlap'));
  });

  test('cantidad vacía con precio: pendiente con el nombre de la línea', () => {
    const q = crew({ materials: [material({ description: 'Discos de corte', quantity: null, unitCost: 4000 })] });
    const c = evaluateCompleteness(q);
    assert.ok(c.pending.some((p) => /Discos de corte/.test(p.message) && /falta la cantidad/.test(p.message)), JSON.stringify(c.pending.map((p) => p.message)));
  });

  test('una cotización guardada con sólo "other" en componentes conserva su estado (y el texto no contradice la casilla)', () => {
    const only = (components) => evaluateCompleteness({ ...crew({ materials: [] }), materialsNotApplicable: false, contract: { mode: 'time', components } });
    const a = only(['labor', 'other']);
    const item = a.items.find((i) => i.id === 'materials');
    // Como en 0.21.0: "Otro gasto" solo no pide materiales (contractUsesMaterials no cambió).
    assert.equal(contractUsesMaterials({ components: ['labor', 'other'] }), false);
    assert.equal(item.status, 'ok');
    assert.equal(a.scorePct, only(['labor']).scorePct);
    // La casilla "Insumos y materiales" se ve marcada: el texto no dice que no se marcó.
    assert.deepEqual(blocksOf({ components: ['labor', 'other'] }), ['labor', 'materials']);
    assert.doesNotMatch(item.message, /no se marcaron/);
    assert.equal(only(['labor', 'supplies']).items.find((i) => i.id === 'materials').status, 'warning');
  });
});

describe('"¿Qué incluye?" en 4 bloques', () => {
  test('4 bloques; cada componente guardado pertenece a uno', () => {
    assert.deepEqual([...INCLUDE_BLOCK_IDS], ['labor', 'equipment', 'materials', 'travel']);
    for (const id of ['labor', 'vehicle', 'machinery', 'subcontract', 'tools', 'supplies', 'materials', 'ppe', 'other', 'travel', 'chemicals', 'waste']) {
      assert.ok(blockOfComponent(id), id);
    }
    assert.equal(blockOfComponent('chemicals').id, 'materials');
    assert.equal(INCLUDE_BLOCKS.find((b) => b.id === 'travel').step, 'logistics');
  });

  test('blocksOf lee los ids viejos', () => {
    assert.deepEqual(blocksOf({ components: ['labor', 'ppe', 'vehicle'] }), ['labor', 'equipment', 'materials']);
    assert.deepEqual(blocksOf({ components: ['other'] }), ['materials']);
    assert.deepEqual(blocksOf({ components: [] }), []);
  });

  test('withBlock: marcar agrega uno solo si no había; desmarcar quita todos', () => {
    assert.deepEqual(withBlock(['labor'], 'materials', true), ['labor', 'materials']);
    assert.deepEqual(withBlock(['labor', 'ppe'], 'materials', true), ['labor', 'ppe']);
    assert.deepEqual(withBlock(['labor', 'ppe', 'tools', 'other'], 'materials', false), ['labor']);
    assert.deepEqual(withBlock(['labor', 'vehicle', 'subcontract'], 'equipment', false), ['labor']);
    assert.deepEqual(withBlock([], 'equipment', true), ['machinery']);
    assert.deepEqual(withBlock(['labor'], 'nada', true), ['labor']);
  });

  test('displayCostRows: sólo los tipos con monto; con el bloque elegido y nada cargado, un renglón en $ 0', () => {
    const q = crew({ materials: [material({ component: 'supplies', quantity: 2, unitCost: 5000 })] });
    const rows = displayCostRows(computeQuote(q).eecc, ['labor', 'supplies']);
    const mats = rows.filter((r) => r.parent === 'materials' || r.category === 'materials');
    assert.deepEqual(mats.map((r) => r.category), ['materials:supplies']);

    const empty = crew({ materials: [] });
    empty.materialsNotApplicable = false;
    const eecc = computeQuote(empty).eecc;
    const chosen = displayCostRows(eecc, ['labor', 'tools']).filter((r) => String(r.category).startsWith('materials'));
    assert.deepEqual(chosen.map((r) => [r.category, r.amount]), [['materials', 0]]);
    assert.deepEqual(displayCostRows(eecc, ['labor']).filter((r) => String(r.category).startsWith('materials')), []);
  });
});
