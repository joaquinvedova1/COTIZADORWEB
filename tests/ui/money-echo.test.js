/**
 * Eco de montos (DESIGN-02 2/2, PLAN-2026-026): debajo de cada campo de plata,
 * el monto con separadores ("$ 2.600.000") para ver de un vistazo un cero de
 * más o de menos. Lee lo escrito con el mismo intérprete que el campo y nunca
 * adivina: con un texto vacío, inválido o ambiguo no muestra nada.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MONEY_ECHO_FROM, moneyEchoText } from '../../js/ui/money-echo.js';
import { parseDecimalInput } from '../../js/core/validation.js';

const norm = (s) => String(s).replace(/[  ]/g, ' ');
/** "$ 1.800.000,50" → 1800000.5 (para comparar el eco con lo que se guarda). */
const echoValue = (text) => Number(norm(text).replace(/^-?\$ ?/, '').replace(/\./g, '').replace(',', '.'));

describe('eco de montos', () => {
  test('desde $ 10.000, con separadores de miles', () => {
    assert.equal(MONEY_ECHO_FROM, 10000);
    assert.equal(norm(moneyEchoText('2600000')), '$ 2.600.000');
    assert.equal(norm(moneyEchoText('10000')), '$ 10.000');
    assert.equal(moneyEchoText('9999'), '');
    assert.equal(moneyEchoText('0'), '');
  });

  test('lee lo escrito con el mismo intérprete que el campo (formato argentino)', () => {
    assert.equal(norm(moneyEchoText('1.800.000,50')), '$ 1.800.000,50');
    assert.equal(norm(moneyEchoText('$ 250.000')), '$ 250.000');
    assert.equal(norm(moneyEchoText(' 2600000 ')), '$ 2.600.000');
    assert.equal(norm(moneyEchoText('12345,5')), '$ 12.345,50');
  });

  test('vacío, inválido o ambiguo: sin eco (nunca adivina un número)', () => {
    for (const raw of ['', '   ', null, undefined, 'abc', '1,234.56', '1.2.3', '1e5', '-']) {
      assert.equal(moneyEchoText(raw), '', `"${raw}"`);
    }
  });

  test('el eco es el mismo número que se guarda (sin redondear los centavos)', () => {
    for (const raw of ['2600000', '1.800.000,5', '12345,67', '999999999', '10000,01', '3.500.000']) {
      assert.equal(echoValue(moneyEchoText(raw)), parseDecimalInput(raw), raw);
    }
  });
});
