/**
 * Contrato del negocio — PricingEngine (margen, markup, tarifa piso).
 *
 * Reglas (Prompt 1 "Margen vs markup", Prompt 2 "Margen vs markup", Prompt 4 §21):
 *   - Margen se calcula SOBRE EL PRECIO:  precio = costo / (1 − margen)
 *   - Markup se calcula SOBRE EL COSTO:   precio = costo × (1 + markup)
 *   - NO son sinónimos: costo 100 con margen 10 % → 111,11 (NO 110); con markup 10 % → 110.
 *   - markup = margen / (1 − margen) · margen = markup / (1 + markup)
 *   - Margen válido: 0 ≤ margen < 100. Fuera de rango → null (nunca Infinity/NaN).
 *   - Tarifa piso = precio con margen 0 = costo.
 *   - Redondeo comercial: siempre hacia arriba (nunca baja el margen).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceFromMargin,
  priceFromMarkup,
  marginFromPrice,
  markupFromPrice,
  marginToMarkup,
  markupToMargin,
  isValidMarginPct,
  floorPrice,
  floorRate,
  priceLadder,
  commercialRound,
  traceMarginVsMarkup,
} from '../../js/engines/pricing-engine.js';
import { roundMoney } from '../../js/core/money.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

function assertNullOrFinite(value, message = '') {
  assert.ok(value === null || (typeof value === 'number' && Number.isFinite(value)), `${message} debe ser null o número finito, se obtuvo ${value}`);
}

describe('PricingEngine — margen sobre precio', () => {
  test('margen 10 % con costo 100 → precio 111,11… (NO 110): el margen se calcula sobre el precio de venta', () => {
    // 100 / (1 − 0,10) = 100 / 0,9 = 111,111…
    const price = priceFromMargin(100, 10);
    approx(price, 100 / 0.9);
    assert.equal(roundMoney(price), 111.11);
    assert.notEqual(roundMoney(price), 110, 'un margen del 10 % NO es sumar 10 % al costo');
  });

  test('el margen efectivamente logrado con ese precio es exactamente el 10 %', () => {
    // (111,11… − 100) / 111,11… = 0,10
    approx(marginFromPrice(100, 100 / 0.9), 10);
  });

  test('margen 0 → el precio es igual al costo (tarifa piso)', () => {
    approx(priceFromMargin(38_000_000, 0), 38_000_000);
    approx(floorPrice(38_000_000), 38_000_000);
  });

  test('margen 15 % con costo 100 → 117,65 (100 / 0,85)', () => {
    approx(priceFromMargin(100, 15), 100 / 0.85);
    assert.equal(roundMoney(priceFromMargin(100, 15)), 117.65);
  });

  test('margen de 100 % o más es inválido → null (nunca Infinity)', () => {
    assert.equal(priceFromMargin(100, 100), null);
    assert.equal(priceFromMargin(100, 150), null);
    assert.equal(priceFromMargin(100, -5), null, 'margen negativo tampoco es un objetivo válido');
    assert.equal(priceFromMargin(100, Number.NaN), null);
    assert.equal(priceFromMargin(100, Number.POSITIVE_INFINITY), null);
    assert.equal(isValidMarginPct(0), true);
    assert.equal(isValidMarginPct(99.99), true);
    assert.equal(isValidMarginPct(100), false);
    assert.equal(isValidMarginPct(-0.01), false);
  });
});

describe('PricingEngine — markup sobre costo', () => {
  test('markup 10 % con costo 100 → precio 110: el markup se calcula sobre el costo', () => {
    // 100 × (1 + 0,10) = 110
    approx(priceFromMarkup(100, 10), 110);
  });

  test('el markup que implica un precio de 110 sobre costo 100 es 10 %, pero su margen es 9,09 %', () => {
    approx(markupFromPrice(100, 110), 10);
    // (110 − 100) / 110 = 9,0909… %
    approx(marginFromPrice(100, 110), (10 / 110) * 100);
  });

  test('markup negativo hasta −100 % representa precio bajo costo; menor a −100 % es inválido', () => {
    approx(priceFromMarkup(100, -20), 80);
    approx(priceFromMarkup(100, -100), 0);
    assert.equal(priceFromMarkup(100, -101), null);
    assert.equal(priceFromMarkup(100, Number.NaN), null);
  });
});

describe('PricingEngine — margen y markup NO son sinónimos', () => {
  test('con el mismo porcentaje (> 0), el precio por margen siempre supera al precio por markup', () => {
    for (const p of [1, 5, 10, 15, 25, 50, 90]) {
      const byMargin = priceFromMargin(1000, p);
      const byMarkup = priceFromMarkup(1000, p);
      assert.ok(byMargin > byMarkup, `con ${p} %: margen ${byMargin} debe ser > markup ${byMarkup}`);
    }
  });

  test('conversión: margen 10 % ↔ markup 11,11 %', () => {
    // markup = 0,10 / (1 − 0,10) = 0,1111…
    approx(marginToMarkup(10), (0.1 / 0.9) * 100);
    assert.equal(roundMoney(marginToMarkup(10)), 11.11);
    // margen = 0,1111… / (1 + 0,1111…) = 0,10
    approx(markupToMargin((0.1 / 0.9) * 100), 10);
  });

  test('conversión: markup 10 % ↔ margen 9,09 %', () => {
    // margen = 0,10 / 1,10 = 0,0909…
    approx(markupToMargin(10), (0.1 / 1.1) * 100);
  });

  test('aplicar el markup equivalente al margen da exactamente el mismo precio', () => {
    for (const m of [0, 5, 10, 15, 33.3, 60]) {
      approx(priceFromMarkup(250_000, marginToMarkup(m)), priceFromMargin(250_000, m), `margen ${m} %`);
    }
  });

  test('ida y vuelta margen → markup → margen conserva el valor', () => {
    for (const m of [0, 1, 5, 10, 15, 20, 45, 75]) {
      approx(markupToMargin(marginToMarkup(m)), m, `margen ${m} %`);
    }
  });

  test('conversiones inválidas devuelven null: margen ≥ 100 o markup ≤ −100', () => {
    assert.equal(marginToMarkup(100), null);
    assert.equal(marginToMarkup(120), null);
    assert.equal(markupToMargin(-100), null);
    assert.equal(markupToMargin(Number.NaN), null);
  });

  test('costo 100 y precio 125 → margen 20 % y markup 25 %', () => {
    approx(marginFromPrice(100, 125), 20);
    approx(markupFromPrice(100, 125), 25);
  });
});

describe('PricingEngine — precio inferior al costo y valores límite', () => {
  test('precio inferior al costo → margen y markup negativos (pierde dinero)', () => {
    // costo 100, precio 80: margen = −20 / 80 = −25 %; markup = −20 / 100 = −20 %
    approx(marginFromPrice(100, 80), -25);
    approx(markupFromPrice(100, 80), -20);
  });

  test('precio 0 → margen indefinido (null); costo 0 → markup indefinido (null)', () => {
    assert.equal(marginFromPrice(100, 0), null);
    assert.equal(markupFromPrice(0, 100), null);
  });

  test('valores vacíos o no numéricos nunca producen NaN ni Infinity', () => {
    const weird = ['', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'abc', {}];
    for (const w of weird) {
      assertNullOrFinite(priceFromMargin(w, 10), `priceFromMargin(${String(w)})`);
      assertNullOrFinite(priceFromMargin(100, w), `priceFromMargin(100, ${String(w)})`);
      assertNullOrFinite(priceFromMarkup(w, 10), `priceFromMarkup(${String(w)})`);
      assertNullOrFinite(marginFromPrice(w, 10), `marginFromPrice(${String(w)})`);
      assertNullOrFinite(markupFromPrice(10, w), `markupFromPrice(10, ${String(w)})`);
      assertNullOrFinite(marginToMarkup(w), `marginToMarkup(${String(w)})`);
      assertNullOrFinite(markupToMargin(w), `markupToMargin(${String(w)})`);
      assertNullOrFinite(floorRate(w, 8), `floorRate(${String(w)})`);
      assertNullOrFinite(commercialRound(w, 1000), `commercialRound(${String(w)})`);
    }
  });

  test('tarifa piso unitaria = costo total / unidades; sin unidades no hay tarifa (null)', () => {
    // 38.000.000 / 8 días = 4.750.000 por día
    approx(floorRate(38_000_000, 8), 4_750_000);
    assert.equal(floorRate(38_000_000, 0), null);
  });
});

describe('PricingEngine — escalera de precios (piso, 5 %, 10 %, 15 %, personalizado)', () => {
  test('escalera estándar para costo 100 con margen personalizado 20 %', () => {
    const ladder = priceLadder(100, [5, 10, 15], 20);
    const byKey = Object.fromEntries(ladder.map((r) => [r.key, r]));
    assert.deepEqual(ladder.map((r) => r.key), ['floor', 'm5', 'm10', 'm15', 'custom']);
    approx(byKey.floor.price, 100, 'piso');
    assert.equal(byKey.floor.marginPct, 0);
    approx(byKey.m5.price, 100 / 0.95, 'margen 5 %');
    approx(byKey.m10.price, 100 / 0.9, 'margen 10 %');
    approx(byKey.m15.price, 100 / 0.85, 'margen 15 %');
    approx(byKey.custom.price, 125, 'margen 20 % → 100 / 0,8');
    // Cada fila informa el markup equivalente (no igual al margen)
    approx(byKey.m10.markupPct, (0.1 / 0.9) * 100);
    approx(byKey.custom.markupPct, 25);
  });

  test('a mayor margen, mayor precio en la escalera', () => {
    const prices = priceLadder(1_000_000, [5, 10, 15], 30).map((r) => r.price);
    for (let i = 1; i < prices.length; i += 1) assert.ok(prices[i] > prices[i - 1]);
  });

  test('el margen personalizado se omite si repite uno estándar, es 0 o es inválido (≥ 100)', () => {
    assert.equal(priceLadder(100, [5, 10, 15], 10).length, 4);
    assert.equal(priceLadder(100, [5, 10, 15], 0).length, 4);
    assert.equal(priceLadder(100, [5, 10, 15], 100).length, 4);
    assert.equal(priceLadder(100, [5, 10, 15], null).length, 4);
  });
});

describe('PricingEngine — redondeo comercial', () => {
  test('redondea siempre hacia arriba al múltiplo indicado (nunca baja el margen)', () => {
    assert.equal(commercialRound(4_444_444.44, 1000), 4_445_000);
    assert.equal(commercialRound(2_191_180.32, 1000), 2_192_000);
    assert.ok(commercialRound(4_444_444.44, 1000) >= 4_444_444.44);
  });

  test('un valor que ya es múltiplo exacto no se modifica (tolerancia de punto flotante)', () => {
    assert.equal(commercialRound(4_445_000, 1000), 4_445_000);
    // 0,7 / 0,1 = 6,999999999999999 en binario: no debe saltar a 0,8
    approx(commercialRound(0.7, 0.1), 0.7);
  });

  test('paso 0, negativo o vacío → sin redondeo; precio inválido → null', () => {
    assert.equal(commercialRound(1234.56, 0), 1234.56);
    assert.equal(commercialRound(1234.56, -100), 1234.56);
    assert.equal(commercialRound(1234.56, ''), 1234.56);
    assert.equal(commercialRound(null, 1000), null);
    assert.equal(commercialRound(Number.NaN, 1000), null);
  });
});

describe('PricingEngine — trazabilidad', () => {
  test('la traza "margen vs markup" muestra ambos precios y su diferencia (111,11 − 110 = 1,11)', () => {
    const trace = traceMarginVsMarkup(100, 10);
    assert.equal(trace.id, 'margin_vs_markup');
    assert.match(trace.formula, /margen/i);
    assert.match(trace.formula, /markup/i);
    approx(trace.steps[0].value, 100 / 0.9);
    approx(trace.steps[1].value, 110);
    approx(trace.result.value, 100 / 0.9 - 110);
    assert.ok(trace.notes.some((n) => /no son equivalentes/i.test(n)));
  });
});
