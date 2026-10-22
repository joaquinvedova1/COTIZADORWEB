/**
 * P1 CIERRE (PLAN-2026-028) — Productos: lo que la interfaz afirma sobre un precio.
 *
 *  H-12  La lista decía "Completo" con avisos pendientes (sólo miraba los errores).
 *  H-14  "Tu precio de hoy cubre tus costos y el margen que querés" en verde aunque no hubiera
 *        precio posible (unidades por mes en 0, pérdida 100 %, margen + impuestos ≥ 100 %).
 *
 * Producto SINTÉTICO de AUD-T1 E4 (tests/fixtures/eco-01/e4-producto.json). Las cifras las da
 * el motor y no cambian: acá sólo se prueba qué estado y qué veredicto se muestran.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeProduct, summarizeProduct } from '../../js/engines/product-engine.js';
// Imports de espacio de nombres: contra el candidato anterior (sin estas funciones) cada test falla por su cuenta.
import * as productsView from '../../js/ui/views/products.js';
import * as productEditor from '../../js/ui/views/product-editor.js';

const e4 = (patch = (p) => p) => {
  const p = JSON.parse(readFileSync(new URL('../fixtures/eco-01/e4-producto.json', import.meta.url), 'utf8'));
  patch(p);
  return p;
};
const listStatus = (product) => {
  assert.equal(typeof productsView.productListStatus, 'function', 'falta productListStatus');
  return productsView.productListStatus(product, summarizeProduct(product));
};
const verdict = (product) => {
  assert.equal(typeof productEditor.currentPriceVerdict, 'function', 'falta currentPriceVerdict');
  return productEditor.currentPriceVerdict(computeProduct(product));
};

describe('P1 CIERRE · H-12: el estado de la lista de productos', () => {
  test('sin errores ni avisos: "Completo"', () => {
    const s = listStatus(e4());
    assert.equal(s.kind, 'complete');
    assert.equal(s.label, 'Completo');
  });

  test('con avisos pendientes (impuestos sin definir): "Revisar (1)", nunca "Completo"', () => {
    const s = listStatus(e4((p) => { p.billingTaxes = null; }));
    assert.equal(s.kind, 'review');
    assert.equal(s.label, 'Revisar (1)');
    assert.notEqual(s.tone, 'green');
  });

  test('con datos faltantes: "Faltan datos (n)"', () => {
    const s = listStatus(e4((p) => { p.unitsPerBatch = 0; }));
    assert.equal(s.kind, 'errors');
    assert.match(s.label, /^Faltan datos \(\d+\)$/);
  });

  test('con el precio de hoy debajo del costo: rojo, aunque haya avisos', () => {
    const s = listStatus(e4((p) => { p.pricing.currentPrice = 50000; p.billingTaxes = null; }));
    assert.equal(s.kind, 'below_floor');
    assert.equal(s.tone, 'red');
  });

  test('el producto de ejemplo dice "Ejemplo", no "Completo"', () => {
    const s = listStatus(e4((p) => { p.illustrative = true; }));
    assert.equal(s.kind, 'example');
    assert.notEqual(s.label, 'Completo');
  });
});

describe('P1 CIERRE · H-14: el veredicto del precio de hoy', () => {
  test('92.000 con una sugerida de 102.000: amarillo, "debajo del precio sugerido"', () => {
    const v = verdict(e4());
    assert.equal(v.kind, 'below_suggested');
    assert.equal(v.tone, 'warning');
  });

  test('sin datos faltantes ni avisos y con el precio sobre la sugerida: verde', () => {
    const v = verdict(e4((p) => { p.pricing.currentPrice = 120000; }));
    assert.equal(v.kind, 'ok');
    assert.equal(v.tone, 'success');
  });

  test('con avisos pendientes nunca es verde: "con los datos cargados", para revisar', () => {
    const v = verdict(e4((p) => { p.pricing.currentPrice = 120000; p.billingTaxes = null; }));
    assert.equal(v.kind, 'review');
    assert.equal(v.tone, 'warning');
    assert.match(v.text, /con los datos cargados/i);
  });

  const impossible = {
    'unidades por mes en 0': (p) => { p.monthlyUnits = 0; },
    'tanda en 0': (p) => { p.unitsPerBatch = 0; },
    'pérdida 100 %': (p) => { p.lossPct = 100; },
    'margen 96 % (margen + impuestos ≥ 100 %)': (p) => { p.pricing.targetMarginPct = 96; },
  };
  for (const [name, patch] of Object.entries(impossible)) {
    test(`${name}: "no se puede evaluar", nunca verde`, () => {
      const v = verdict(e4((p) => { patch(p); p.pricing.currentPrice = 120000; }));
      assert.notEqual(v.tone, 'success', name);
      assert.equal(v.kind, 'not_evaluable', name);
      assert.match(v.text, /no se puede evaluar/i);
    });
  }

  test('sin precio de hoy cargado no hay veredicto', () => {
    assert.equal(verdict(e4((p) => { p.pricing.currentPrice = null; })), null);
  });
});
