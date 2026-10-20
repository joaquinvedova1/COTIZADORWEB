/**
 * ECO-03 (PLAN-2026-020, VAL-01-F1): redondeo comercial de la tarifa sugerida.
 *
 * Compatibilidad (se escribió ANTES de cambiar la regla y tiene que seguir en verde después): una
 * cotización guardada sin `roundingMode` usa el múltiplo fijo que tiene guardado, en las 18 unidades
 * (17 + la propia) y con 0, 1, 10 y 1.000: la sugerida es la objetivo redondeada hacia arriba a ese
 * múltiplo, exactamente como en `main`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { BILLING_UNITS } from '../../js/domain/billing-units.js';
import { roundUpToStep } from '../../js/core/money.js';
import { service, person, owned, LAB_SETTINGS } from '../lab/lib/build.js';

/** Actividad de cada unidad (sintética): cuánto se factura por mes y cuánto se hace por día de trabajo. */
const ACTIVITY = {
  hour: { serviceType: 'on_call', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 } },
  day: { serviceType: 'on_call', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 } },
  month: { serviceType: 'permanent', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10 } },
  call: { serviceType: 'on_call', activity: { billableQuantityPerMonth: 4, daysPerActivation: 2 } },
  shift: { serviceType: 'crew', activity: { billableQuantityPerMonth: 44, unitsPerActiveDay: 2, hoursPerActiveDay: 24 } },
  trip: { serviceType: 'transport', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2 } },
  km: { serviceType: 'transport', activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400 } },
  ton: { serviceType: 'transport', activity: { billableQuantityPerMonth: 1200, unitsPerActiveDay: 120 } },
  tonkm: { serviceType: 'transport', activity: { billableQuantityPerMonth: 75000, unitsPerActiveDay: 3750 } },
  m3: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 5000, unitsPerActiveDay: 250 } },
  unit: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 300, unitsPerActiveDay: 15 } },
  kg: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 40000, unitsPerActiveDay: 2000 } },
  meter: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 3000, unitsPerActiveDay: 150 } },
  m2: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 200 } },
  lot: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2 } },
  job: { serviceType: 'turnkey', activity: { billableQuantityPerMonth: 1, daysPerActivation: 10 } },
  milestone: { serviceType: 'lump_sum', activity: { billableQuantityPerMonth: 3, daysPerActivation: 20, unitsPerActivation: 3 } },
  custom: { serviceType: 'configurable', unitName: 'pozo', activity: { billableQuantityPerMonth: 6, unitsPerActiveDay: 0.5, daysPerActivation: 2 } },
};

/** Cotización base de una unidad, con el redondeo que se le pase en `pricing`. */
export function unitQuote(unitId, pricing = {}) {
  const a = ACTIVITY[unitId];
  return service({
    id: `eco03-${unitId}`,
    unit: unitId,
    unitName: a.unitName || '',
    serviceType: a.serviceType,
    activity: { availableDaysPerMonth: 30, ...a.activity },
    labor: [person({ role: 'Operador' })],
    equipment: [owned({ name: 'Camión', replacementValue: 300000000, usefulLifeYears: 10 })],
    pricing,
  });
}

/** Saca `roundingMode` y `roundingMaxPct` (como una cotización guardada antes de ECO-03). */
function legacy(quote) {
  const q = structuredClone(quote);
  delete q.pricing.roundingMode;
  delete q.pricing.roundingMaxPct;
  return q;
}

describe('ECO-03 · compatibilidad: lo guardado sin roundingMode no cambia (18 unidades × 0/1/10/1.000)', () => {
  test('las 18 opciones de unidad tienen su cotización de prueba', () => {
    assert.deepEqual(Object.keys(ACTIVITY).sort(), BILLING_UNITS.map((u) => u.id).sort());
  });

  for (const unit of BILLING_UNITS.map((u) => u.id)) {
    test(`${unit}: sugerida = objetivo redondeada hacia arriba al múltiplo guardado`, () => {
      for (const step of [0, 1, 10, 1000]) {
        const k = computeQuote(legacy(unitQuote(unit, { roundingStep: step }))).kpis;
        assert.ok(Number.isFinite(k.targetListRate) && k.targetListRate > 0, `${unit}/${step}: hay tarifa objetivo`);
        assert.equal(k.suggestedListRate, roundUpToStep(k.targetListRate, step), `${unit}/${step}`);
        assert.ok(k.suggestedListRate >= k.targetListRate - 1e-9, `${unit}/${step}: nunca baja`);
        assert.equal(k.commercialSource, 'suggested');
        assert.equal(k.commercialListRate, k.suggestedListRate, `${unit}/${step}: se ofrece la sugerida`);
      }
    });
  }

  test('una empresa con sus parámetros confirmados conserva su múltiplo en las cotizaciones nuevas', () => {
    for (const step of [0, 1, 10, 1000, 500]) {
      const q = createEmptyQuote({ organizationId: 'org', settings: { ...LAB_SETTINGS, roundingStep: step, illustrative: false } });
      assert.equal(q.pricing.roundingStep, step);
      assert.equal(computeQuote(legacy(q)).kpis.suggestedListRate, computeQuote(q).kpis.suggestedListRate, `${step}: igual que sin roundingMode`);
    }
  });
});
