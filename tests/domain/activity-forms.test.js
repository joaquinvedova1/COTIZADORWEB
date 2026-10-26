/**
 * Formas de cargar la actividad (UXR): las horas del mes que escribió la persona y los días que se derivan.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { hoursInputOf, daysFromHours, demandFormOf } from '../../js/domain/activity-forms.js';

describe('Horas a facturar por mes', () => {
  test('coinciden con días × horas × personas: se muestran', () => {
    assert.equal(hoursInputOf({ hoursInput: { value: 880 }, activeDaysPerMonth: 22, hoursPerActiveDay: 10, billedResourceKind: 'person', billedResources: 4 }), 880);
  });
  test('ya no coinciden (cambiaron los días): no se muestran', () => {
    assert.equal(hoursInputOf({ hoursInput: { value: 880 }, activeDaysPerMonth: 20, hoursPerActiveDay: 10, billedResourceKind: 'person', billedResources: 4 }), null);
  });
  test('sin horas por día todavía: siguen siendo el dato (revisión de código)', () => {
    assert.equal(hoursInputOf({ hoursInput: { value: 160 }, activeDaysPerMonth: null, hoursPerActiveDay: null }), 160);
    assert.equal(daysFromHours(160, null), null);
  });
});

describe('Llamados de distinta duración', () => {
  const profile = [{ count: 4, units: 2 }, { count: 4, units: 8 }];
  test('perfil con el mismo promedio que la actividad (5 h): "Duran distinto", como lo lee el motor', () => {
    assert.equal(demandFormOf({ activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: 5, activationProfile: profile }, 'hour').distinct, true);
  });
  test('perfil desfasado (otras horas por día): no rige, igual que en el motor', () => {
    const form = demandFormOf({ activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: 6, activationProfile: profile }, 'hour');
    assert.equal(form.profile.length, 0);
  });
});
