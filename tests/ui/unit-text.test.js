/**
 * Textos de la unidad de facturación (PLAN-2026-009): cómo se lee una
 * cantidad en la unidad comercial. Sin DOM.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { quantityText, quantityCeilText, perUnitSuffix, unitWord, isQuantityUnit, workDaysText, capitalizeUnitPhrase } from '../../js/ui/unit-text.js';
import { unitShortOf, perUnitCeil } from '../../js/ui/views/quote-steps/shared.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';

const norm = (s) => String(s).replace(/[  ]/g, ' ');
const of = (unit, unitName = '') => ({ unitInfo: billingUnitOf({ unit, unitName }) });

describe('textos por unidad', () => {
  test('cantidades con su unidad: símbolo o palabra en singular/plural', () => {
    assert.equal(norm(quantityText(1240, of('m3'))), '1.240 m³');
    assert.equal(norm(quantityText(40, of('trip'))), '40 viajes');
    assert.equal(norm(quantityText(1, of('trip'))), '1 viaje');
    assert.equal(norm(quantityText(4200, of('unit'))), '4.200 u.');
    assert.equal(norm(quantityText(830, of('ton'))), '830 t');
    assert.equal(norm(quantityText(12, of('custom', 'pozo'))), '12 pozos');
    assert.equal(norm(quantityText(2.5, of('call'))), '2,5 llamados');
    assert.equal(quantityText(null, of('m3')), '—');
    assert.equal(unitWord(1, of('custom', 'muestra')), 'muestra');
  });

  test('el equilibrio se redondea hacia arriba (nunca se lee de menos)', () => {
    assert.equal(norm(quantityCeilText(1239.2, of('m3'))), '1.240 m³');
    assert.equal(norm(quantityCeilText(19.01, of('trip'))), '19,1 viajes');
    assert.equal(norm(quantityCeilText(20, of('trip'))), '20 viajes');
  });

  test('"$ … / unidad": el resultado da la unidad; los ids de antes siguen funcionando', () => {
    assert.equal(perUnitSuffix(of('m3')), 'm³');
    assert.equal(perUnitSuffix(of('custom', 'pozo')), 'pozo');
    assert.equal(unitShortOf('hour'), 'hora');
    assert.equal(unitShortOf('month'), 'mes');
    assert.equal(unitShortOf(undefined), 'día');
    assert.equal(unitShortOf({ unitInfo: billingUnitOf({ unit: 'trip' }) }), 'viaje');
    assert.equal(norm(perUnitCeil(8450, of('m3'))), '$ 8.450 / m³');
    // Nunca "/día" si no se factura por día.
    assert.ok(!/día/.test(perUnitCeil(8450, of('m3'))));
  });

  test('qué unidades son por cantidad o por evento', () => {
    assert.equal(isQuantityUnit(of('m3')), true);
    assert.equal(isQuantityUnit(of('job')), true);
    assert.equal(isQuantityUnit(of('day')), false);
    assert.equal(isQuantityUnit(of('month')), false);
    assert.equal(norm(workDaysText(12)), '12 días de trabajo');
    assert.equal(capitalizeUnitPhrase('m³ para no perder'), 'm³ para no perder');
    assert.equal(capitalizeUnitPhrase('viajes para no perder'), 'Viajes para no perder');
  });
});
