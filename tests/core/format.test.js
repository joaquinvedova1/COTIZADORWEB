/**
 * Tests de js/core/format.js — presentación es-AR.
 * Regla dura: nunca mostrar NaN, Infinity ni -Infinity (se muestra "—").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY,
  formatMoney,
  formatNumber,
  formatPercent,
  formatDays,
  formatDate,
  formatDateTime,
  formatValue,
} from '../../js/core/format.js';

const BAD = [NaN, Infinity, -Infinity, null, undefined, '', 'abc', '123', {}, [], true];
const FORMATS = ['money', 'rate', 'number', 'percent', 'days', 'km', 'liters', 'hours', 'desconocido'];

/** Normaliza espacios no separables que usa Intl. */
const norm = (text) => text.replace(/[  ]/g, ' ');

describe('EMPTY', () => {
  test('el marcador de "no disponible" es una raya', () => {
    assert.equal(EMPTY, '—');
  });
});

describe('Valores inválidos siempre se muestran como "—"', () => {
  test('formatMoney / formatNumber / formatPercent / formatDays', () => {
    for (const v of BAD) {
      assert.equal(formatMoney(v), EMPTY, `formatMoney(${String(v)})`);
      assert.equal(formatMoney(v, { decimals: 2 }), EMPTY);
      assert.equal(formatNumber(v), EMPTY, `formatNumber(${String(v)})`);
      assert.equal(formatPercent(v), EMPTY, `formatPercent(${String(v)})`);
      assert.equal(formatDays(v), EMPTY, `formatDays(${String(v)})`);
    }
  });

  test('formatValue con cualquier formato', () => {
    for (const format of FORMATS) {
      for (const v of BAD) {
        assert.equal(formatValue(v, format), EMPTY, `formatValue(${String(v)}, ${format})`);
      }
    }
  });

  test('formatValue "text" muestra "—" sólo para vacío/null/undefined', () => {
    assert.equal(formatValue(null, 'text'), EMPTY);
    assert.equal(formatValue(undefined, 'text'), EMPTY);
    assert.equal(formatValue('', 'text'), EMPTY);
    assert.equal(formatValue('Añelo', 'text'), 'Añelo');
    assert.equal(formatValue(0, 'text'), '0');
  });

  test('ninguna salida contiene NaN ni Infinity con entradas extremas', () => {
    const extremes = [0, -0, 1e-12, -1e-12, 1e15, -1e15, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE, 99.995, -99.995];
    for (const v of extremes) {
      for (const format of FORMATS) {
        const out = formatValue(v, format);
        assert.equal(/NaN|Infinity|∞/.test(out), false, `${format}(${v}) → ${out}`);
      }
      for (const out of [formatMoney(v), formatMoney(v, { decimals: 2 }), formatNumber(v, { decimals: 4 }), formatPercent(v), formatDays(v)]) {
        assert.equal(/NaN|Infinity|∞/.test(out), false, out);
      }
    }
  });

  test('fechas inválidas o vacías → "—"', () => {
    for (const v of [null, undefined, '', 'no-es-fecha', NaN]) {
      assert.equal(formatDate(v), EMPTY);
      assert.equal(formatDateTime(v), EMPTY);
    }
  });
});

describe('Formato es-AR', () => {
  test('formatMoney usa "$", punto de miles y sin decimales por defecto', () => {
    assert.equal(norm(formatMoney(1234567)), '$ 1.234.567');
    assert.equal(norm(formatMoney(1234567.5)), '$ 1.234.568');
    assert.equal(norm(formatMoney(999.49)), '$ 999');
    assert.equal(norm(formatMoney(0)), '$ 0');
  });

  test('formatMoney con decimales usa coma decimal', () => {
    assert.equal(norm(formatMoney(1234567.891, { decimals: 2 })), '$ 1.234.567,89');
    assert.equal(norm(formatMoney(1.005, { decimals: 2 })), '$ 1,01');
  });

  test('formatMoney de negativos y de -0', () => {
    assert.match(norm(formatMoney(-1500)), /^-\s?\$ 1\.500$/);
    assert.equal(norm(formatMoney(-0.4)), '$ 0', 'nunca "-$ 0"');
    assert.equal(norm(formatMoney(-0)), '$ 0');
  });

  test('formatNumber separa miles con punto y decimales con coma', () => {
    assert.equal(norm(formatNumber(1234567.5, { decimals: 1 })), '1.234.567,5');
    assert.equal(formatNumber(1234), '1.234');
    assert.equal(formatNumber(-0), '0');
    assert.equal(formatNumber(10, { decimals: 2, minDecimals: 2 }), '10,00');
  });

  test('formatPercent recibe puntos porcentuales y redondea a 2 decimales', () => {
    assert.equal(norm(formatPercent(12.345)), '12,35 %');
    assert.equal(norm(formatPercent(10)), '10 %');
    assert.equal(norm(formatPercent(100)), '100 %');
    assert.equal(norm(formatPercent(-18.75)), '-18,75 %');
    assert.equal(norm(formatPercent(-0.001)), '0 %', 'nunca "-0 %"');
    assert.equal(norm(formatPercent(1234.5)), '1.234,5 %');
  });

  test('formatDays usa singular y plural', () => {
    assert.equal(formatDays(1), '1 día');
    assert.equal(formatDays(10), '10 días');
    assert.equal(formatDays(9.5), '9,5 días');
    assert.equal(formatDays(6.378726865071805), '6,38 días');
    assert.equal(formatDays(0), '0 días');
  });

  test('formatValue por tipo semántico', () => {
    assert.equal(norm(formatValue(2259000, 'money')), '$ 2.259.000');
    assert.equal(norm(formatValue(1234.5, 'rate')), '$ 1.235');
    assert.equal(norm(formatValue(12.3456, 'rate')), '$ 12,35', 'tarifas chicas con centavos');
    assert.equal(norm(formatValue(12.345, 'percent')), '12,35 %');
    assert.equal(formatValue(10, 'days'), '10 días');
    assert.equal(formatValue(110, 'km'), '110 km');
    assert.equal(formatValue(12.25, 'liters'), '12,3 L');
    assert.equal(formatValue(3, 'hours'), '3 h');
    assert.equal(formatValue(1234.567), '1.234,57');
    assert.equal(formatValue(1234.567, 'number', 'u'), '1.234,57 u');
  });

  test('fechas válidas se formatean', () => {
    const d = formatDate('2026-10-01T12:00:00.000Z');
    assert.notEqual(d, EMPTY);
    assert.match(d, /2026/);
    assert.notEqual(formatDateTime('2026-10-01T12:00:00.000Z'), EMPTY);
  });
});
