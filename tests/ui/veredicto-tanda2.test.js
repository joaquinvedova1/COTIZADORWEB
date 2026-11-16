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
import { outputPerDayUnitLabel, outputUnitShownOf, outputPluralShownOf, materialFormulaText } from '../../js/ui/views/quote-steps/materials.js';
import { minimumCallNote } from '../../js/ui/views/quote-steps/margin.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';
import { service, person, external, resetIds } from '../lab/lib/build.js';

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
    // Revisión UX: con el aviso de "por debajo de su costo" no se agrega un segundo aviso.
    assert.equal(cheaperThanNormalHourText({ ...line, belowCost: true }), '');
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

  test('revisión UX: cantidad, % de uso y fórmula tampoco dicen "día/día"', () => {
    assert.equal(outputUnitShownOf({}, { unit: 'day' }), 'unidad');
    assert.equal(outputPluralShownOf({}, { unit: 'hour' }), 'unidades');
    assert.equal(outputUnitShownOf({ outputUnit: 'válvula' }, { unit: 'day' }), 'válvula');
    assert.equal(outputUnitShownOf({}, { unit: 'custom', unitName: 'hectárea' }), 'hectárea');
    const model = { basis: 'per_output', quantity: 1, unitCost: 1000, grossCost: 1000, usageShare: 1, costPerOutputUnit: 1000, outputPerActiveDay: 40 };
    const text = norm(materialFormulaText({ unit: 'L' }, model, { activeDays: 10, outputUnit: 'hectárea', outputPlural: 'hectáreas' }));
    assert.match(text, /· 40 hectáreas\/día × 10 días = \$ 400\.000\/mes$/);
  });
});

describe('V-13 · Nota del mínimo por llamado', () => {
  const byKm = (rules) => {
    resetIds();
    return service({
      serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: 3600, unitsPerActiveDay: 240, daysPerActivation: 1 },
      labor: [person()], equipment: [external({ name: 'Camión' }, { price: 1100, unit: 'km' })],
      logistics: { notApplicable: false, distanceKm: 120, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
      rules,
    });
  };
  const note = (q) => norm(minimumCallNote(computeQuote(q), activationTerms(q), billingUnitOf(q)));

  test('por km con mínimo 300 y 240 km por día: dice qué factura cada salida y cuántas son', () => {
    assert.equal(note(byKm({ minimumCallUnits: 300 })), 'Se está aplicando: cada salida factura 300 km aunque haga 240. Tus 3.600 km por mes son 12 salidas.');
  });

  test('sin mínimo, o con un mínimo que no llega a aplicarse, no cambia la facturación', () => {
    assert.match(note(byKm({ minimumCallUnits: 0 })), /^Hoy no cambia la facturación/);
    assert.match(note(byKm({ minimumCallUnits: 200 })), /^Hoy no cambia la facturación/);
  });

  test('por día y por hora dice cuánto factura cada vez, sin jerga (revisión UX)', () => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 8, daysPerActivation: 1 }, labor: [person()], rules: { minimumCallUnits: 2 } });
    assert.equal(note(q), `Se está aplicando: cada ${activationTerms(q).one} factura 2 días aunque se trabaje 1.`);
    resetIds();
    const qh = service({ unit: 'hour', activity: { activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: 6 }, labor: [person()], rules: { minimumCallUnits: 8 } });
    assert.equal(note(qh), `Se está aplicando: cada ${activationTerms(qh).one} factura 8 horas aunque se trabajen 6.`);
  });
});
