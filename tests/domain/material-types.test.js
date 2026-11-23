/**
 * PLAN-2026-027 (0.22.0): un solo catálogo de tipos de "Insumos y materiales" y el maestro de
 * Recursos sin uso (P-03): la cantidad y la base se cargan en cada cotización.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_TYPES, MATERIAL_TYPE_IDS, DEFAULT_BLANK_TYPE, materialTypeLabel, materialTypeShort, resourceMaterialType, defaultMaterialBasis } from '../../js/domain/material-types.js';
import { LINE_COMPONENT_IDS } from '../../js/domain/contract.js';
import { materialLineFromLibrary, blankMaterialLine } from '../../js/domain/quote-factory.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person, material, resetIds } from '../lab/lib/build.js';

const NOW = '2026-10-16T00:00:00.000Z';
const valveQuote = (materials = []) => service({
  id: 'valvulas', serviceType: 'per_unit', unit: 'piece',
  activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, daysPerActivation: 0.5, hoursPerActiveDay: 9 },
  labor: [person()], materials,
});
const materialsAmount = (r) => r.eecc.rows.find((x) => x.category === 'materials').amount;

describe('catálogo de tipos', () => {
  test('los ids son los mismos que LINE_COMPONENT_IDS, en el mismo orden', () => {
    assert.deepEqual([...MATERIAL_TYPE_IDS], [...LINE_COMPONENT_IDS]);
    assert.deepEqual([...MATERIAL_TYPE_IDS], ['tools', 'supplies', 'materials', 'ppe', 'other']);
    assert.deepEqual(MATERIAL_TYPES.map((t) => t.id).sort(), [...MATERIAL_TYPE_IDS].sort());
  });

  test('rótulos largos y cortos, "Sin tipo" para lo que no es un tipo', () => {
    assert.equal(materialTypeLabel('supplies'), 'Insumo o consumible');
    assert.equal(materialTypeLabel('ppe'), 'EPP especial');
    assert.equal(materialTypeLabel('x'), 'Sin tipo');
    assert.equal(materialTypeShort('other'), 'Otros gastos');
    assert.equal(materialTypeShort('materials'), 'Materiales');
    assert.equal(DEFAULT_BLANK_TYPE, 'supplies');
  });

  test('resourceMaterialType sólo acepta un tipo válido', () => {
    assert.equal(resourceMaterialType({ component: 'tools' }), 'tools');
    assert.equal(resourceMaterialType({ component: 'chemicals' }), null);
    assert.equal(resourceMaterialType({}), null);
    assert.equal(resourceMaterialType(null), null);
  });
});

describe('defaultMaterialBasis: la base sale de la unidad en que se cobra', () => {
  test('unidad de tiempo → por mes', () => {
    assert.equal(defaultMaterialBasis(service({ unit: 'day' }), 'supplies'), 'per_month');
    assert.equal(defaultMaterialBasis(service({ unit: 'month' }), 'materials'), 'per_month');
  });
  test('unidad de cantidad → por unidad cobrada; herramientas, EPP especial y otros gastos → por mes', () => {
    const q = valveQuote();
    assert.equal(defaultMaterialBasis(q, 'supplies'), 'per_output');
    assert.equal(defaultMaterialBasis(q, 'materials'), 'per_output');
    assert.equal(defaultMaterialBasis(q, 'ppe'), 'per_month');
    assert.equal(defaultMaterialBasis(q, 'tools'), 'per_month');
    assert.equal(defaultMaterialBasis(q, 'other'), 'per_month');
  });
  test('precio cerrado o unidad de evento → por activación', () => {
    assert.equal(defaultMaterialBasis({ ...service({ unit: 'day' }), contract: { mode: 'closed' } }, 'supplies'), 'per_activation');
    assert.equal(defaultMaterialBasis(service({ serviceType: 'lump_sum', unit: 'job' }), 'supplies'), 'per_activation');
    assert.equal(defaultMaterialBasis(service({ unit: 'call' }), 'supplies'), 'per_activation');
  });
  test('sin cotización: por mes', () => {
    assert.equal(defaultMaterialBasis(), 'per_month');
    assert.equal(defaultMaterialBasis(null), 'per_month');
  });
});

describe('materialLineFromLibrary (P-03)', () => {
  const master = { id: 'mat-kit', description: 'Kit de juntas', unit: 'kit', basis: 'per_month', quantity: 1, unitCost: 100000, resaleMarkupPct: 25, providedBy: 'contractor', component: 'supplies' };

  test('no copia cantidad, base ni markup del maestro; sí el tipo y el precio', () => {
    const line = materialLineFromLibrary(master, { id: 'l1', now: NOW });
    assert.equal(line.quantity, null);
    assert.equal(Object.hasOwn(line, 'basis'), false);
    assert.equal(line.resaleMarkupPct, 0);
    assert.equal(line.component, 'supplies');
    assert.equal(line.unitCost, 100000);
    assert.equal(line.sourceId, 'mat-kit');
  });

  test('un maestro "Sin tipo" da una línea sin tipo', () => {
    const line = materialLineFromLibrary({ ...master, component: undefined }, { id: 'l2', now: NOW });
    assert.equal(Object.hasOwn(line, 'component'), false);
  });

  test('la línea en blanco nace por mes, con cantidad 1', () => {
    const line = blankMaterialLine({ id: 'b1', now: NOW });
    assert.equal(line.basis, 'per_month');
    assert.equal(line.quantity, 1);
    assert.equal(line.providedBy, 'contractor');
  });

  test('regresión ×40: kit "1 por mes" agregado por válvula da $ 0 con aviso, nunca 40 kits', () => {
    resetIds();
    const q = valveQuote();
    const line = materialLineFromLibrary(master, { id: 'l3', now: NOW });
    q.materials = [{ ...line, basis: defaultMaterialBasis(q, line.component) }];
    q.materialsNotApplicable = false;
    const r = computeQuote(q);
    assert.equal(q.materials[0].basis, 'per_output');
    assert.equal(materialsAmount(r), 0);
    assert.ok(r.completeness.pending.some((p) => /Kit de juntas/.test(p.message || '')), 'el pendiente nombra la línea');

    // Con cantidad 2 por válvula: lo mismo que 80 kits por mes (40 válvulas × 2).
    q.materials[0].quantity = 2;
    const perValve = materialsAmount(computeQuote(q));
    const monthly = materialsAmount(computeQuote(valveQuote([material({ description: 'Kit de juntas', basis: 'per_month', quantity: 80, unitCost: 100000 })])));
    assert.ok(perValve > 0);
    assert.ok(Math.abs(perValve - monthly) < 0.01, `${perValve} ≠ ${monthly}`);
  });
});
