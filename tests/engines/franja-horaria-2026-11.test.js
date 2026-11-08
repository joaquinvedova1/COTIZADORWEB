/**
 * Franja horaria como número (2026-11): "Horas de guardia por día" reemplaza el texto libre.
 * Las horas de guardia NO mueven costo ni facturación (se facturan las horas trabajadas por
 * día con llamado); sólo avisan si se trabaja más que la franja (fuera de horario).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { availabilityHoursOf, normalizeActivity } from '../../js/engines/cost-engine.js';
import { outsideWindowHours, activeGuardCoverage } from '../../js/engines/completeness-engine.js';
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

describe('guardia activa / pasiva (2026-11)', () => {
  const op = (o = {}) => ({ id: 'l1', role: 'Operador', positions: 1, peoplePerPosition: 1, basicMonthly: 1000000, normalHoursPerMonth: 200, ...o });
  const withLabor = (activity, labor = [op()], unit = 'day') => {
    const q = onCall(activity, unit);
    q.labor = labor;
    return q;
  };
  const relief = (q) => computeQuote(q).completeness.items.find((x) => x.id === 'relief');
  const notice = (q, id) => computeQuote(q).completeness.notices.find((x) => x.id === id);

  test('activa 24/7: relevos con números (720 h, 3,6 personas) y sin el aviso de horas repetido', () => {
    const q = withLabor({ availability: '24/7', guardType: 'active', availableDaysPerMonth: 30 });
    assert.deepEqual(activeGuardCoverage(q), { days: 30, hours: 24, required: 720 });
    const r = relief(q);
    assert.equal(r.status, 'warning');
    assert.match(r.message, /30 días × 24 h = 720 h por persona/);
    assert.match(r.message, /cubre 200 h/);
    assert.match(r.message, /unas 3,6 personas/);
    // Sin diagramas (2026-11): lleva a las horas por día de cada persona.
    assert.equal(r.focus, 'labor.0.coverageHoursPerDay');
    assert.ok(!computeQuote(q).completeness.items.some((x) => x.id === 'labor_hours'));
  });

  test('activa con franja de 8 h y 22 días: 176 h, una persona alcanza', () => {
    const q = withLabor({ availability: 'window', availabilityHoursPerDay: 8, guardType: 'active', availableDaysPerMonth: 22, hoursPerActiveDay: 8 });
    const r = relief(q);
    assert.equal(r.status, 'ok');
    assert.match(r.message, /cubre las horas de guardia/);
  });

  test('activa con nómina suficiente (5 personas por posición) → ok', () => {
    const q = withLabor({ availability: '24/7', guardType: 'active' }, [op({ peoplePerPosition: 4 })]);
    assert.equal(relief(q).status, 'ok');
  });

  test('activa 24/7 con turnos día/noche de 12 h y 2 personas cada uno: alcanza (cada puesto cubre su turno)', () => {
    const q = withLabor({ availability: '24/7', guardType: 'active' }, [
      op({ id: 'd', role: 'Turno día', peoplePerPosition: 2, coverageHoursPerDay: 12 }),
      op({ id: 'n', role: 'Turno noche', peoplePerPosition: 2, coverageHoursPerDay: 12 }),
    ]);
    assert.equal(relief(q).status, 'ok');
  });

  test('activa: las horas extra por día activo también cubren', () => {
    // 8 días × 6 h extra = 48 h; 200 + 48 = 248 ≥ 22 × 11 = 242.
    const q = withLabor({ availability: 'window', availabilityHoursPerDay: 11, guardType: 'active', availableDaysPerMonth: 22, hoursPerActiveDay: 10 }, [op({ overtimeHoursPerActiveDay: 6 })]);
    assert.equal(relief(q).status, 'ok');
  });

  test('disponibilidad sin cobrar también con guardia activa en franja y sin personal', () => {
    const q = onCall({ availability: 'window', availabilityHoursPerDay: 8, guardType: 'active' }, 'day');
    q.labor = [];
    assert.ok(computeQuote(q).completeness.notices.some((x) => x.id === 'availability_unpaid'));
  });

  test('pasiva 24/7 con una persona: no pide relevos hora por hora; sugiere el adicional de guardia', () => {
    const q = withLabor({ availability: '24/7', guardType: 'passive' });
    assert.equal(relief(q).status, 'ok');
    const n = notice(q, 'guard_allowance');
    assert.ok(n);
    assert.equal(n.focus, 'labor.0.additionalsMonthly');
    assert.equal(notice(withLabor({ availability: '24/7', guardType: 'passive' }, [op({ additionalsMonthly: 50000 })]), 'guard_allowance'), undefined);
  });

  test('sin tipo de guardia: el aviso de relevos de siempre', () => {
    const r = relief(withLabor({ availability: '24/7' }));
    assert.equal(r.status, 'warning');
    assert.match(r.message, /una sola persona por posición/);
  });

  test('disponibilidad sin cobrar: informativo, se va con abono o mínimo garantizado', () => {
    const q = withLabor({ availability: '24/7', guardType: 'passive' });
    assert.ok(notice(q, 'availability_unpaid'));
    q.rules = { ...q.rules, availabilityFeeMonthly: 1000000 };
    assert.equal(notice(q, 'availability_unpaid'), undefined);
    const g = withLabor({ availability: '24/7' });
    g.rules = { ...g.rules, minimumMonthlyGuarantee: 3000000 };
    assert.equal(notice(g, 'availability_unpaid'), undefined);
    assert.equal(notice(withLabor({ availability: 'window', availabilityHoursPerDay: 8, guardType: 'passive' }), 'availability_unpaid'), undefined);
  });

  test('el tipo de guardia no cambia costo ni facturación', () => {
    const base = computeQuote(withLabor({ availability: '24/7' }, [op()], 'hour'));
    for (const guardType of ['active', 'passive']) {
      const r = computeQuote(withLabor({ availability: '24/7', guardType }, [op()], 'hour'));
      assert.equal(r.estimate.cost.total, base.estimate.cost.total);
      assert.equal(r.estimate.revenue.total, base.estimate.revenue.total);
    }
  });
});
