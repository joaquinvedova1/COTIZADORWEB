/**
 * Tests de js/core/money.js — redondeos y aritmética segura.
 * Regla: ninguna función devuelve NaN, Infinity ni -Infinity.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isFiniteNumber,
  toNumber,
  nonNegative,
  clamp,
  pct,
  safeDivide,
  sum,
  roundTo,
  roundMoney,
  roundRate,
  roundPercentage,
  roundDays,
  ceilTolerant,
  roundUpToStep,
  roundPercentagesToTotal,
  approxEqual,
} from '../../js/core/money.js';

const NON_FINITE = [NaN, Infinity, -Infinity];
const NOT_NUMBERS = [null, undefined, '', '12', {}, [], true];

/** Suma en unidades enteras (centésimos) para comparar "exactamente". */
function sumUnits(values, decimals = 2) {
  const f = 10 ** decimals;
  return values.reduce((acc, v) => acc + Math.round(v * f), 0);
}

describe('isFiniteNumber / toNumber / nonNegative / clamp / pct', () => {
  test('isFiniteNumber sólo acepta números finitos', () => {
    assert.equal(isFiniteNumber(0), true);
    assert.equal(isFiniteNumber(-1.5), true);
    for (const v of [...NON_FINITE, ...NOT_NUMBERS]) assert.equal(isFiniteNumber(v), false, String(v));
  });

  test('toNumber convierte entradas y usa fallback ante vacíos o inválidos', () => {
    assert.equal(toNumber(5), 5);
    assert.equal(toNumber(' 12.5 '), 12.5);
    assert.equal(toNumber('-3'), -3);
    assert.equal(toNumber(''), 0);
    assert.equal(toNumber('   ', 7), 7);
    assert.equal(toNumber('abc'), 0);
    assert.equal(toNumber(null, 1), 1);
    assert.equal(toNumber(undefined, 2), 2);
    assert.equal(toNumber(NaN, 3), 3);
    assert.equal(toNumber(Infinity, 4), 4);
    assert.equal(toNumber('Infinity', 5), 5);
    assert.equal(toNumber({}, 6), 6);
  });

  test('nonNegative descarta negativos e inválidos', () => {
    assert.equal(nonNegative(10), 10);
    assert.equal(nonNegative(0), 0);
    assert.equal(nonNegative(-5), 0);
    assert.equal(nonNegative('-5', 1), 1);
    assert.equal(nonNegative(NaN), 0);
  });

  test('clamp limita al rango', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
    assert.equal(clamp(NaN, 0, 10), 0);
  });

  test('pct convierte puntos porcentuales a fracción', () => {
    assert.equal(pct(10), 0.1);
    assert.equal(pct(100), 1);
    assert.equal(pct(''), 0);
    assert.equal(pct(NaN), 0);
  });
});

describe('safeDivide / sum / approxEqual', () => {
  test('división por 0 devuelve null (nunca Infinity)', () => {
    assert.equal(safeDivide(1, 0), null);
    assert.equal(safeDivide(0, 0), null);
    assert.equal(safeDivide(-5, 0), null);
    assert.equal(safeDivide(1, 1e-12), null, 'divisor por debajo de la tolerancia');
    assert.equal(safeDivide(1, 0, 0), 0, 'fallback configurable');
  });

  test('operandos no finitos devuelven el fallback', () => {
    for (const bad of [...NON_FINITE, null, undefined, '3']) {
      assert.equal(safeDivide(bad, 2), null);
      assert.equal(safeDivide(2, bad), null);
    }
  });

  test('división normal', () => {
    assert.equal(safeDivide(6, 3), 2);
    assert.equal(safeDivide(30000000, 3000000), 10);
    assert.equal(safeDivide(1e308, 1e-5), null, 'desborde a Infinity se evita');
  });

  test('sum ignora valores no finitos', () => {
    assert.equal(sum([1, 2, 3]), 6);
    assert.equal(sum([1, NaN, Infinity, null, '5', 2]), 3);
    assert.equal(sum([]), 0);
  });

  test('approxEqual con tolerancia y valores no finitos', () => {
    assert.equal(approxEqual(0.1 + 0.2, 0.3), true);
    assert.equal(approxEqual(1, 1.1), false);
    assert.equal(approxEqual(1, 1.05, 0.1), true);
    assert.equal(approxEqual(NaN, NaN), false);
    assert.equal(approxEqual(Infinity, Infinity), false);
  });
});

describe('Redondeos centralizados', () => {
  test('roundMoney: half away from zero, robusto a errores binarios', () => {
    assert.equal(roundMoney(1.005), 1.01);
    assert.equal(roundMoney(-1.005), -1.01);
    assert.equal(roundMoney(2.675), 2.68);
    assert.equal(roundMoney(1.0049999), 1);
    assert.equal(roundMoney(0.125), 0.13);
    assert.equal(roundMoney(-0.125), -0.13);
    assert.equal(roundMoney(123456789.125), 123456789.13);
    assert.equal(roundMoney(111.11111111), 111.11);
    assert.equal(roundMoney(0.1 + 0.2), 0.3);
  });

  test('roundMoney de valores no finitos devuelve 0 (nunca NaN)', () => {
    for (const bad of [...NON_FINITE, ...NOT_NUMBERS]) {
      assert.equal(roundMoney(bad), 0, String(bad));
    }
  });

  test('nunca devuelve -0', () => {
    assert.ok(Object.is(roundMoney(-0.001), 0));
    assert.ok(Object.is(roundMoney(-0), 0));
    assert.ok(Object.is(roundPercentage(-0.004), 0));
  });

  test('roundRate usa 4 decimales', () => {
    assert.equal(roundRate(1.23456789), 1.2346);
    assert.equal(roundRate(0.00005), 0.0001);
    assert.equal(roundRate(0.00004), 0);
    assert.equal(roundRate(-2.00005), -2.0001);
    assert.equal(roundRate(19134.306818181), 19134.3068);
    assert.equal(roundRate(NaN), 0);
  });

  test('roundPercentage y roundDays usan 2 decimales', () => {
    assert.equal(roundPercentage(12.345), 12.35);
    assert.equal(roundPercentage(11.111111), 11.11);
    assert.equal(roundPercentage(-18.755), -18.76);
    assert.equal(roundPercentage(Infinity), 0);
    assert.equal(roundDays(6.378726865071805), 6.38);
    assert.equal(roundDays(10), 10);
  });

  test('roundTo admite cualquier cantidad de decimales y notación exponencial', () => {
    assert.equal(roundTo(1.45, 1), 1.5);
    assert.equal(roundTo(2.5, 0), 3);
    assert.equal(roundTo(-2.5, 0), -3);
    assert.equal(roundTo(1e-7, 2), 0);
    assert.equal(roundTo(1.23e-5, 6), 0.000012);
    assert.ok(isFiniteNumber(roundTo(1e21, 2)));
    assert.ok(isFiniteNumber(roundTo(Number.MAX_VALUE, 2)), 'valores enormes no desbordan a Infinity');
  });
});

describe('ceilTolerant / roundUpToStep', () => {
  test('ceilTolerant tolera errores de punto flotante', () => {
    assert.equal(ceilTolerant(10.0000000001), 10);
    assert.equal(ceilTolerant(10), 10);
    assert.equal(ceilTolerant(10.1), 11);
    assert.equal(ceilTolerant(9.999999), 10);
    assert.equal(ceilTolerant(0.1 + 0.2 + 0.7), 1);
    for (const bad of NON_FINITE) assert.equal(ceilTolerant(bad), null);
  });

  test('roundUpToStep redondea hacia arriba al múltiplo', () => {
    assert.equal(roundUpToStep(2258948.79, 1000), 2259000);
    assert.equal(roundUpToStep(3000, 1000), 3000, 'múltiplo exacto no sube');
    assert.equal(roundUpToStep(3000.0000000001, 1000), 3000);
    assert.equal(roundUpToStep(1234.5, 0), 1234.5, 'step 0 → sin cambio');
    assert.equal(roundUpToStep(1234.5, -10), 1234.5);
    assert.equal(roundUpToStep(1234.5, ''), 1234.5);
    assert.equal(roundUpToStep(NaN, 1000), null);
    assert.equal(roundUpToStep(Infinity, 1000), null);
  });
});

describe('roundPercentagesToTotal (método del mayor resto)', () => {
  const CASES = [
    ['tres partes iguales', [1, 1, 1]],
    ['siete partes iguales', [1, 1, 1, 1, 1, 1, 1]],
    ['seis partes iguales', [5, 5, 5, 5, 5, 5]],
    ['dos tercios', [1, 2]],
    ['con ceros', [0, 3, 0, 3, 3]],
    ['montos reales de una estructura de costos', [9031407.38, 6745090.95, 995025.29, 822800, 1234.56]],
    ['un monto dominante y muchos chicos', [1e9, 1, 1, 1, 1]],
    ['montos con decimales feos', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
  ];

  for (const [label, amounts] of CASES) {
    test(`suma exactamente 100: ${label}`, () => {
      const result = roundPercentagesToTotal(amounts);
      assert.equal(result.length, amounts.length);
      assert.equal(sumUnits(result), 10000, `resultado: ${result.join(' + ')}`);
      assert.equal(roundTo(result.reduce((a, b) => a + b, 0), 2), 100);
      result.forEach((v) => {
        assert.ok(isFiniteNumber(v) && v >= 0);
        assert.equal(roundTo(v, 2), v, 'como mucho 2 decimales');
      });
    });
  }

  test('tres partes iguales → 33,34 + 33,33 + 33,33', () => {
    assert.deepEqual(roundPercentagesToTotal([1, 1, 1]), [33.34, 33.33, 33.33]);
  });

  test('los ceros quedan en 0 y no reciben ajuste', () => {
    const result = roundPercentagesToTotal([0, 1, 0, 1, 1]);
    assert.equal(result[0], 0);
    assert.equal(result[2], 0);
    assert.deepEqual(roundPercentagesToTotal([0, 5, 0]), [0, 100, 0]);
  });

  test('todo cero (o lista vacía) devuelve ceros sin NaN', () => {
    assert.deepEqual(roundPercentagesToTotal([0, 0, 0]), [0, 0, 0]);
    assert.deepEqual(roundPercentagesToTotal([]), []);
  });

  test('negativos y no finitos se tratan como 0', () => {
    assert.deepEqual(roundPercentagesToTotal([NaN, -5, 10]), [0, 0, 100]);
    assert.deepEqual(roundPercentagesToTotal([Infinity, null, 'x', 4]), [0, 0, 0, 100]);
    assert.deepEqual(roundPercentagesToTotal([-1, -2]), [0, 0]);
  });

  test('admite otros decimales y otro total', () => {
    assert.deepEqual(roundPercentagesToTotal([1, 1, 1], 0), [34, 33, 33]);
    const result = roundPercentagesToTotal([1, 1, 1], 1, 50);
    assert.equal(sumUnits(result, 1), 500);
  });
});
