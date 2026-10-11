/**
 * Productos (PLAN-2026-008): rutas de los pasos, estado de cada paso y textos
 * que dependen de la unidad de venta. Los números los da el motor (ver
 * tests/engines/product-engine.test.js); acá sólo se prueba la interfaz.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { productHref, unitMoney, STEP_HINTS } from '../../js/ui/views/products.js';
import { pluralUnit, productStepStatus, shareModeOf, stepOfIssue } from '../../js/ui/views/product-editor.js';
import { PRODUCT_STEPS } from '../../js/domain/catalogs.js';
import { matchRoute } from '../../js/ui/router.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { createEmptyProduct, exampleProduct } from '../../js/domain/product-factory.js';

const NOW = '2026-10-11T12:00:00.000Z';
let n = 0;
const ids = () => `id-${(n += 1)}`;

describe('productos: enlaces y pasos', () => {
  test('cada paso tiene su ayuda y su enlace es una ruta válida del editor', () => {
    for (const s of PRODUCT_STEPS) {
      assert.ok(STEP_HINTS[s.id], `falta la ayuda del paso ${s.id}`);
      const m = matchRoute(productHref({ id: 'p 1' }, s.id));
      assert.equal(m.route.name, 'product-editor-step');
      assert.deepEqual(m.params, { id: 'p 1', step: s.id });
    }
    assert.equal(productHref({ id: 'p-1' }), '#/productos/p-1');
  });

  test('cada aviso del motor lleva al paso donde se corrige', () => {
    assert.equal(stepOfIssue('unitsPerBatch'), 'producto');
    assert.equal(stepOfIssue('monthlyUnits'), 'producto');
    assert.equal(stepOfIssue('materials.2.useUnit'), 'insumos');
    assert.equal(stepOfIssue('labor.0.normalHoursPerMonth'), 'personal');
    assert.equal(stepOfIssue('equipment.0.fixedSharePct'), 'maquinas');
    assert.equal(stepOfIssue('fixedCosts.1.sharePct'), 'fijos');
    assert.equal(stepOfIssue('pricing.targetMarginPct'), 'precio');
    assert.equal(stepOfIssue('billingTaxes'), 'precio');
    assert.equal(stepOfIssue('otra.cosa'), 'producto');
  });

  test('estado de los pasos: vacío = sin cargar, con faltantes = rojo, completo = verde', () => {
    const empty = createEmptyProduct({ now: NOW, id: 'p-empty', settings: {} });
    const r0 = computeProduct(empty);
    assert.equal(productStepStatus('producto', empty, r0), 'red');
    assert.equal(productStepStatus('insumos', empty, r0), 'gray');
    assert.equal(productStepStatus('resultado', empty, r0), null);

    const chipa = exampleProduct({ now: NOW, id: 'p-chipa', idFactory: ids, settings: {} });
    const r1 = computeProduct(chipa);
    for (const s of PRODUCT_STEPS.filter((x) => !['resultado', 'precio'].includes(x.id))) {
      assert.equal(productStepStatus(s.id, chipa, r1), 'green', s.id);
    }
    // El ejemplo no trae impuestos sobre la venta (RATEOS no inventa alícuotas): queda para revisar.
    assert.equal(productStepStatus('precio', chipa, r1), 'orange');
    const decided = { ...chipa, billingTaxes: { ...chipa.billingTaxes, notApplicable: true } };
    assert.equal(productStepStatus('precio', decided, computeProduct(decided)), 'green');
    // Un gasto fijo sin % asignado es un aviso (naranja), no un error.
    const missingShare = { ...chipa, fixedCosts: chipa.fixedCosts.map((f, i) => (i === 0 ? { ...f, sharePct: null } : f)) };
    assert.equal(productStepStatus('fijos', missingShare, computeProduct(missingShare)), 'orange');
  });
});

describe('productos: textos', () => {
  test('plural de la unidad de venta', () => {
    assert.equal(pluralUnit('unidad'), 'unidades');
    assert.equal(pluralUnit('docena'), 'docenas');
    assert.equal(pluralUnit('porción'), 'porciones');
    assert.equal(pluralUnit('kg'), 'kg');
    assert.equal(pluralUnit('paquete'), 'paquetes');
    assert.equal(pluralUnit(''), 'unidades');
    assert.equal(pluralUnit(null), 'unidades');
  });

  test('montos por unidad: con centavos si son chicos, nunca NaN', () => {
    assert.match(unitMoney(286.666), /286,67/);
    assert.doesNotMatch(unitMoney(1500.4), /,/);
    assert.equal(unitMoney(null), '—');
    assert.equal(unitMoney(Number.NaN), '—');
    assert.equal(unitMoney(Infinity), '—');
  });

  test('la parte de los fijos de una máquina nunca se infiere: sin decidir = vacío', () => {
    assert.equal(shareModeOf({ fixedSharePct: null }), '');
    assert.equal(shareModeOf({}), '');
    assert.equal(shareModeOf({ fixedSharePct: 100 }), 'dedicated');
    assert.equal(shareModeOf({ fixedSharePct: 50 }), 'shared');
    assert.equal(shareModeOf({ shareMode: 'shared', fixedSharePct: 100 }), 'shared');
  });
});
