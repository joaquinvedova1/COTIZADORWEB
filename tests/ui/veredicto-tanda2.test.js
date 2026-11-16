/**
 * Veredicto de la ronda de testeo 2026-11-15, tanda 2: decisiones de pantalla
 * sacadas a funciones puras (qué paso corrige un aviso, qué texto se muestra).
 * Ninguna recalcula: leen el resultado de computeQuote.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { stepOfPath } from '../../js/ui/field-links.js';
import { isExtrasIssue } from '../../js/ui/views/quote-result.js';
import { cheaperThanNormalHourText, sparseActivationsWarned } from '../../js/ui/views/quote-steps/modality.js';
import { outputPerDayUnitLabel } from '../../js/ui/views/quote-steps/materials.js';

const norm = (s) => String(s).replace(/ /g, ' ');

describe('V-09 · Avisos de adicionales', () => {
  test('los avisos de extras.* se corrigen en "Cómo se cobra", no en "El servicio"', () => {
    assert.equal(stepOfPath('extras.0.price'), 'modality');
    assert.equal(stepOfPath('extras.3.premiumPct'), 'modality');
    assert.equal(stepOfPath('name'), 'service');
  });

  test('en Resultado van en su propia lista', () => {
    assert.equal(isExtrasIssue({ path: 'extras.0.price' }), true);
    assert.equal(isExtrasIssue({ path: 'labor.0.baseSalary' }), false);
    assert.equal(isExtrasIssue(null), false);
  });

  test('precio a mano por debajo de la hora normal: se avisa en la fila', () => {
    const line = { priceSource: 'manual', price: 5000, referenceHourPrice: 228000 };
    assert.equal(norm(cheaperThanNormalHourText(line)), 'Queda más barata que tu hora normal ($ 228.000).');
    assert.equal(cheaperThanNormalHourText({ ...line, price: 228000 }), '');
    assert.equal(cheaperThanNormalHourText({ ...line, priceSource: 'suggested' }), '');
    assert.equal(cheaperThanNormalHourText({ ...line, referenceHourPrice: null }), '');
    assert.equal(cheaperThanNormalHourText(null), '');
  });
});

describe('V-08 · "¿Cómo son los llamados?" a la vista', () => {
  test('sólo cuando salta el aviso de menos de una unidad por llamado', () => {
    assert.equal(sparseActivationsWarned({ issues: [{ path: 'activity.daysPerActivation', code: 'sparse_activations' }] }), true);
    assert.equal(sparseActivationsWarned({ issues: [{ path: 'activity.daysPerActivation' }] }), false);
    assert.equal(sparseActivationsWarned({}), false);
  });
});

describe('V-07 · Rótulo de "Producción por día"', () => {
  test('cobrando por día o por hora sin unidad escrita no dice "día/día"', () => {
    assert.equal(outputPerDayUnitLabel({}, { unit: 'day' }), 'unidades/día');
    assert.equal(outputPerDayUnitLabel({}, { unit: 'hour' }), 'unidades/día');
    assert.equal(outputPerDayUnitLabel({ outputUnit: 'hectárea' }, { unit: 'day' }), 'hectárea/día');
    assert.equal(outputPerDayUnitLabel({}, { unit: 'custom', unitName: 'hectárea' }), 'hectárea/día');
  });
});
