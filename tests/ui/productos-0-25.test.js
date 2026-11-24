/**
 * 0.25.0 (PLAN-2026-029, PR 7): Productos (R-04, R-05, R-06, R-07, R-10, R-12, R-13, W-23).
 * Ningún producto guardado cambia sus números (foto tanda4-sin-cambio-0-25, PINV-11).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeProduct, materialQuantityPerUnit, laborMinutesPerUnit } from '../../js/engines/product-engine.js';
import { blankProductMaterialLine, exampleProduct } from '../../js/domain/product-factory.js';
import { isIllustrativeAgreementParam, ILLUSTRATIVE_AGREEMENT_PARAMS } from '../../js/domain/catalogs.js';
import { BREAK_EVEN_ZERO_TEXT, breakEvenIsZero, libraryByType } from '../../js/ui/views/product-editor.js';
import { product, ingredient, worker } from '../lab/lib/build.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const editor = source('js/ui/views/product-editor.js');

describe('R-05: cuánto lleva cada unidad', () => {
  test('14 kg por tanda de 40 → 350 g por unidad', () => {
    const p = product({ unitsPerBatch: 40, materials: [ingredient({ unit: 'kg', useUnit: 'kg', quantity: 14, unitCost: 1000 })] });
    const r = computeProduct(p);
    assert.deepEqual(materialQuantityPerUnit(r.materials[0], r.sellablePerBatch), { quantity: 350, unit: 'g' });
  });
  test('en g, ml y unidades; con pérdida, sobre lo que se vende', () => {
    const r = computeProduct(product({ unitsPerBatch: 10, lossPct: 50, materials: [
      ingredient({ unit: 'l', useUnit: 'ml', quantity: 3000, unitCost: 1 }),
      ingredient({ unit: 'u', useUnit: 'u', quantity: 20, unitCost: 1 }),
      ingredient({ unit: 'kg', useUnit: 'kg', quantity: 50, unitCost: 1 }),
    ] }));
    assert.equal(r.sellablePerBatch, 5);
    assert.deepEqual(materialQuantityPerUnit(r.materials[0], 5), { quantity: 600, unit: 'ml' });
    assert.deepEqual(materialQuantityPerUnit(r.materials[1], 5), { quantity: 4, unit: 'u' });
    assert.deepEqual(materialQuantityPerUnit(r.materials[2], 5), { quantity: 10, unit: 'kg' });
  });
  test('lo que va por unidad o sin datos: nada', () => {
    const r = computeProduct(product({ unitsPerBatch: 10, materials: [ingredient({ per: 'unit', unit: 'u', useUnit: 'u', quantity: 1, unitCost: 1 })] }));
    assert.equal(materialQuantityPerUnit(r.materials[0], 10), null);
    assert.equal(materialQuantityPerUnit(null, 10), null);
    assert.equal(materialQuantityPerUnit({ per: 'batch', quantity: 1, useUnit: 'kg' }, 0), null);
  });
  test('personal: personas × minutos por tanda ÷ unidades para vender', () => {
    const r = computeProduct(product({ unitsPerBatch: 30, labor: [worker({ basicMonthly: 1000000, minutesPerBatch: 90, people: 2 })] }));
    assert.equal(laborMinutesPerUnit(r.labor[0], r.sellablePerBatch), 6);
    assert.equal(laborMinutesPerUnit({ people: 1, minutesPerBatch: 0 }, 30), null);
    assert.match(editor, /min de trabajo por \$\{saleUnit\(\)\} que vendés/);
    assert.match(editor, /por \$\{saleUnit\(\)\} que vendés\./);
  });
});

describe('R-06: "Son mis valores"', () => {
  const line = { sacPct: ILLUSTRATIVE_AGREEMENT_PARAMS.sacPct, artPct: ILLUSTRATIVE_AGREEMENT_PARAMS.artPct };
  test('sin ownParams: una línea suelta con el valor de ejemplo es ilustrativa (como siempre)', () => {
    assert.equal(isIllustrativeAgreementParam(line, 'sacPct'), true);
  });
  test('con el parámetro en ownParams no lo es, aunque coincida', () => {
    const own = { ...line, ownParams: ['sacPct'] };
    assert.equal(isIllustrativeAgreementParam(own, 'sacPct'), false);
    assert.equal(isIllustrativeAgreementParam(own, 'artPct'), true);
    // En una cotización o producto de demostración sigue marcado.
    assert.equal(isIllustrativeAgreementParam(own, 'sacPct', { wholeIllustrative: true }), true);
  });
  test('la pantalla marca lo que la persona escribe y tiene el botón', () => {
    assert.match(editor, /onValue: \(\) => markOwnParam\(i, 'sacPct'\)/);
    assert.match(editor, /button\('Son mis valores'/);
    assert.match(editor, /delete line\.ownParams;/);
  });
});

describe('R-07: No remunerativo por mes', () => {
  test('el campo está junto a "Adicionales mensuales"', () => {
    assert.match(editor, /kit\.num\(`\$\{base\}\.nonRemunerativeMonthly`, \{ label: 'No remunerativo por mes'/);
  });
  test('vacío = 0 = el número de hoy; con monto, suma sin cargas', () => {
    const base = () => product({ unitsPerBatch: 10, monthlyUnits: 100, labor: [worker({ basicMonthly: 1000000, minutesPerBatch: 60, sacPct: 8.33, employerContributionsPct: 24 })] });
    const a = computeProduct(base());
    const zero = base(); zero.labor[0].nonRemunerativeMonthly = 0;
    assert.equal(computeProduct(zero).unitCost, a.unitCost);
    const more = base(); more.labor[0].nonRemunerativeMonthly = 50000;
    assert.ok(Math.abs(computeProduct(more).labor[0].monthlyPerPerson - a.labor[0].monthlyPerPerson - 50000) < 1e-6);
  });
});

describe('R-04, R-10, R-12, R-13', () => {
  test('R-04: "sin IVA" para responsable inscripto; sin condición, una línea con enlace', () => {
    assert.match(editor, /settings\.vatCondition === 'registered'/);
    assert.match(editor, /\$\{text\} \(sin IVA\)/);
    assert.match(editor, /href: '#\/configuracion\/parametros' \}, 'Configuración → Parámetros económicos'/);
  });
  test('R-10: "Agregar algo que va en cada unidad", sin "¿Dónde va?" y con "Mover a…"', () => {
    assert.match(editor, /'Agregar algo que va en cada unidad'/);
    assert.doesNotMatch(editor, /label: '¿Dónde va\?'/);
    assert.match(editor, /Mover a la receta \(por tanda\)/);
  });
  test('R-10: una línea nueva nace sin nombre', () => {
    assert.equal(blankProductMaterialLine({ per: 'batch' }).description, '');
    assert.equal(blankProductMaterialLine({ per: 'unit' }).description, '');
    // El ejemplo sigue con sus nombres.
    assert.ok(exampleProduct({ id: 'p' }).materials.every((m) => m.description));
  });
  test('R-10: Recursos ofrece primero materiales e insumos', () => {
    const list = [{ id: 't', component: 'tools' }, { id: 's', component: 'supplies' }, { id: 'x' }, { id: 'm', component: 'materials' }];
    assert.deepEqual(libraryByType(list).map((m) => m.id), ['m', 's', 't', 'x']);
  });
  test('R-12: sólo el texto de la merma (la fórmula no cambia, D5)', () => {
    assert.match(editor, /% extra que tenés que comprar por lo que se pierde/);
    const r = computeProduct(product({ unitsPerBatch: 1, materials: [ingredient({ quantity: 1, unitCost: 1000, wastePct: 10 })] }));
    assert.ok(Math.abs(r.materials[0].cost - 1100) < 1e-9, 'cantidad × (1 + merma)');
  });
  test('R-13: la tabla de la tanda dice la unidad del producto', () => {
    assert.doesNotMatch(editor, /label: 'Unidades por tanda'/);
  });
});

describe('W-23: equilibrio 0', () => {
  test('"Cualquier venta te deja ganancia" en lugar de "0 por mes"', () => {
    assert.equal(BREAK_EVEN_ZERO_TEXT, 'Cualquier venta te deja ganancia');
    assert.equal(breakEvenIsZero(0), true);
    assert.equal(breakEvenIsZero(0.5), false);
    assert.equal(breakEvenIsZero(null), false);
    const r = computeProduct(product({ unitsPerBatch: 10, monthlyUnits: 100, materials: [ingredient({ quantity: 1, unitCost: 1000 })], pricing: { targetMarginPct: 20 } }));
    assert.equal(r.pricing.breakEvenUnits, 0);
  });
  test('"mirá primero un ejemplo" tiene su botón al ejemplo', () => {
    assert.match(source('js/ui/views/products.js'), /button\('Ver un ejemplo: Chipá'/);
  });
});
