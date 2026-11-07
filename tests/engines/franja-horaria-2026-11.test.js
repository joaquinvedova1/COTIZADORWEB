/**
 * Franja horaria como número (2026-11): "Horas de guardia por día" reemplaza el texto libre.
 * Las horas de guardia NO mueven costo ni facturación (se facturan las horas trabajadas por
 * día con llamado); sólo avisan si se trabaja más que la franja (fuera de horario).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { availabilityHoursOf, normalizeActivity } from '../../js/engines/cost-engine.js';
import { outsideWindowHours } from '../../js/engines/completeness-engine.js';
import { createEmptyQuote, defaultSettings } from '../../js/domain/quote-factory.js';
import { validateQuote } from '../../js/core/validation.js';

function onCall(activity = {}, unit = 'hour') {
  const settings = { ...defaultSettings('org'), illustrative: false, defaultBillingTaxes: null };
  const q = createEmptyQuote({ organizationId: 'org', settings, now: '2026-11-07T00:00:00.000Z', id: 'q-franja' });
  q.serviceType = 'on_call';
  q.unit = unit;
  q.pricingMode = 'known_rate';
  q.pricing = { ...(q.pricing || {}), knownRate: 50000 };
  q.activity = { ...q.activity, activeDaysPerMonth: 8, hoursPerActiveDay: 10, ...activity };
  return q;
}

describe('franja horaria: horas de guardia por día', () => {
  test('24/7 = 24 h; franja = las cargadas (máx. 24); sin cargar o sin elegir = null', () => {
    assert.equal(availabilityHoursOf({ availability: '24/7' }), 24);
    assert.equal(availabilityHoursOf({ availability: 'window', availabilityHoursPerDay: 8 }), 8);
    assert.equal(availabilityHoursOf({ availability: 'window', availabilityHoursPerDay: 30 }), 24);
    assert.equal(availabilityHoursOf({ availability: 'window', availabilityHoursPerDay: '' }), null);
    assert.equal(availabilityHoursOf({ availability: 'window', availabilityHoursPerDay: 0 }), null);
    assert.equal(availabilityHoursOf({ availability: null, availabilityHoursPerDay: 8 }), null);
    assert.equal(normalizeActivity(onCall({ availability: 'window', availabilityHoursPerDay: 12 })).availabilityHoursPerDay, 12);
  });

  test('cobrando por hora se facturan las horas trabajadas, no las de guardia', () => {
    const a = computeQuote(onCall({ availability: 'window', availabilityHoursPerDay: 8, hoursPerActiveDay: 3 }));
    const b = computeQuote(onCall({ availability: '24/7', hoursPerActiveDay: 3 }));
    assert.equal(a.estimate.revenue.billableUnits, 8 * 3);
    assert.equal(b.estimate.revenue.billableUnits, 8 * 3);
    assert.ok(a.estimate.revenue.total > 0, 'hay facturación');
    assert.equal(a.estimate.revenue.total, b.estimate.revenue.total, 'la franja no mueve la facturación');
    assert.equal(a.estimate.cost.total, b.estimate.cost.total, 'ni el costo');
  });

  test('aviso de fuera de horario sólo si se trabaja más que la franja', () => {
    const over = onCall({ availability: 'window', availabilityHoursPerDay: 8, hoursPerActiveDay: 10 });
    assert.deepEqual(outsideWindowHours(over), { worked: 10, guard: 8, outside: 2 });
    const item = computeQuote(over).completeness.items.find((x) => x.id === 'availability_window');
    assert.ok(item, 'aparece el aviso');
    assert.match(item.message, /10 h por día con llamado/);
    assert.match(item.message, /2 h por día quedan fuera de horario \(16 h por mes\)/);
    // Por hora esas horas ya se facturan: el aviso no manda a cobrarlas de nuevo enteras.
    assert.match(item.message, /Ya se facturan como horas normales/);
    assert.match(item.message, /sólo el recargo/);
    assert.equal(item.focus, 'activity.hoursPerActiveDay');

    // Por día: el día cubre la franja; el excedente va a Adicionales.
    const byDay = computeQuote(onCall({ availability: 'window', availabilityHoursPerDay: 8, hoursPerActiveDay: 10 }, 'day')).completeness.items.find((x) => x.id === 'availability_window');
    assert.ok(byDay);
    assert.match(byDay.message, /si el cliente las paga aparte, cobralas en "Adicionales"/);
    assert.doesNotMatch(byDay.message, /Ya se facturan/);

    for (const activity of [
      { availability: 'window', availabilityHoursPerDay: 12, hoursPerActiveDay: 10 },
      { availability: 'window', availabilityHoursPerDay: null, hoursPerActiveDay: 10 },
      { availability: '24/7', hoursPerActiveDay: 10 },
    ]) {
      assert.equal(outsideWindowHours(onCall(activity)), null, JSON.stringify(activity));
      assert.ok(!computeQuote(onCall(activity)).completeness.items.some((x) => x.id === 'availability_window'), JSON.stringify(activity));
    }
  });
});

test('horas de guardia fuera de rango: la validación lo marca', () => {
  const q = onCall({ availability: 'window', availabilityHoursPerDay: 30 });
  assert.ok(validateQuote(q).some((i) => i.path === 'activity.availabilityHoursPerDay'));
  assert.ok(!validateQuote(onCall({ availability: 'window', availabilityHoursPerDay: 12 })).some((i) => i.path === 'activity.availabilityHoursPerDay'));
});
