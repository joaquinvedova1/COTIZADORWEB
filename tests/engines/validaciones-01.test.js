/**
 * VALIDACIONES-01 (beta abierta, decisión del dueño del 2026-10-25): las validaciones críticas que
 * salieron de la simulación SIM-01, sin cambiar ninguna fórmula. Cada caso compara los números con y
 * sin la condición nueva: sólo cambian la completitud, el estado y los textos.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { multiMonthAssumption, multiMonthHolds, laborCoverageAssumption } from '../../js/engines/completeness-engine.js';
import { riskSummary, sendCheck } from '../../js/domain/quote-risk.js';
import { activationRoundingText } from '../../js/ui/result-text.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { service, person, LAB_SETTINGS } from '../lab/lib/build.js';

const calc = (q) => computeQuote(q, { settings: LAB_SETTINGS });
const item = (r, id) => r.completeness.items.find((i) => i.id === id);
const numbers = (r) => ({ cost: r.kpis.totalCost, floor: r.kpis.floorRate, suggested: r.kpis.suggestedRate, revenue: r.kpis.revenue, profit: r.kpis.profit });

describe('V-1: trabajo de más de un mes (fuera del abono)', () => {
  const hourly = (over = {}) => service({
    id: 'v1-hour', serviceType: 'on_call', unit: 'hour',
    activity: { activeDaysPerMonth: 32, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 8, ...over },
    labor: [person({ role: 'Operador' })],
  });
  test('32 días con 30 disponibles: crítico hasta confirmar, con el mismo costo', () => {
    const r = calc(hourly());
    const it = item(r, 'multi_month');
    assert.equal(it.severity, 'critical');
    assert.equal(it.unreliable, undefined, 'no es NO CONFIABLE: puede ser una obra de varios meses');
    assert.match(it.message, /más de un mes/);
    assert.equal(it.focus, 'activity.activeDaysPerMonth');
    assert.equal(sendCheck(riskSummary(r.completeness)).allowed, false);
    const q = hourly();
    q.activity.multiMonthConfirmed = multiMonthAssumption(q);
    assert.equal(multiMonthHolds(q), true);
    const ok = calc(q);
    assert.equal(item(ok, 'multi_month'), undefined, 'confirmado: deja de ser pendiente');
    assert.deepEqual(numbers(ok), numbers(r), 'la confirmación no cambia ningún número');
  });
  test('la confirmación queda atada a los días: si cambian, se vuelve a preguntar', () => {
    const q = hourly();
    q.activity.multiMonthConfirmed = multiMonthAssumption(q);
    q.activity.activeDaysPerMonth = 33;
    assert.equal(multiMonthHolds(q), false);
    assert.equal(item(calc(q), 'multi_month').severity, 'critical');
  });
  test('por cantidad, el botón lleva a la cantidad del mes; dentro del mes no aparece', () => {
    const m3 = service({ id: 'v1-m3', serviceType: 'transport', unit: 'm3', activity: { billableQuantityPerMonth: 1500, unitsPerActiveDay: 20, daysPerActivation: 1, availableDaysPerMonth: 30 }, labor: [person({ role: 'Chofer' })] });
    assert.equal(item(calc(m3), 'multi_month').focus, 'activity.billableQuantityPerMonth');
    assert.equal(item(calc(hourly({ activeDaysPerMonth: 30 })), 'multi_month'), undefined);
  });
  test('con abono mensual sigue siendo NO CONFIABLE (month_days_overflow), sin un segundo pendiente', () => {
    const r = calc(service({ id: 'v1-month', serviceType: 'permanent', unit: 'month', activity: { activeDaysPerMonth: 32, availableDaysPerMonth: 30 }, labor: [person({ role: 'Técnico' })] }));
    assert.ok(item(r, 'month_days_overflow'));
    assert.equal(item(r, 'multi_month'), undefined);
  });
});

describe('V-2: tarifa conocida sin cantidad facturable', () => {
  const known = (qty) => service({
    id: 'v2', serviceType: 'transport', unit: 'm3', pricingMode: 'known_rate', pricing: { knownRate: 1100000 },
    activity: { billableQuantityPerMonth: qty, unitsPerActiveDay: qty ? 20 : null, daysPerActivation: 1, availableDaysPerMonth: 30 },
    labor: [person({ role: 'Chofer' })],
  });
  test('NO CONFIABLE (no se puede marcar como enviada) y pide revisar la unidad de la tarifa', () => {
    const r = calc(known(null));
    const it = item(r, 'utilization');
    assert.equal(it.unreliable, true);
    assert.match(it.message, /facturación del mes es \$ 0/);
    assert.match(it.message, /por m³/);
    assert.equal(sendCheck(riskSummary(r.completeness)).reason, 'unreliable');
  });
  test('con cantidad, nada cambia', () => {
    const it = item(calc(known(400)), 'utilization');
    assert.equal(it.status, 'ok');
    assert.equal(it.unreliable, undefined);
  });
});

describe('V-3: plazo de cobro vacío', () => {
  const q = (term) => service({ id: 'v3', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Operador' })], finance: { paymentTermDays: term } });
  test('vacío = crítico (cambia el costo financiero); 0 (contado) es un dato válido', () => {
    const empty = calc(q(null));
    assert.equal(item(empty, 'payment_term').severity, 'critical');
    assert.match(item(empty, 'payment_term').message, /si cobrás al contado, cargá 0/);
    assert.equal(item(calc(q(0)), 'payment_term').status, 'ok');
    assert.equal(item(calc(q(60)), 'payment_term').status, 'ok');
  });
});

describe('V-4: cobertura de personal muy por debajo de la operación', () => {
  const pump = (people, over = {}) => service({
    id: 'v4', serviceType: 'permanent', unit: 'hour',
    activity: { availability: '24/7', activeDaysPerMonth: 30, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 24 },
    labor: [person({ role: 'Operador de bomba', peoplePerPosition: people, ...over })],
  });
  test('24/7 con 1 persona (≈ 200 h para 720 h): crítico; con 4 personas, sólo "para revisar" si falta poco', () => {
    const one = item(calc(pump(1)), 'labor_hours');
    assert.equal(one.severity, 'critical');
    assert.match(one.message, /menos de la mitad/);
    const four = item(calc(pump(4)), 'labor_hours');
    assert.ok(!four || four.severity === 'review', 'con más de la mitad cubierta no es crítico');
  });
  test('"La cobertura está prevista" sigue resolviéndolo (decisión explícita), sin cambiar el costo', () => {
    const q = pump(1);
    const before = calc(q);
    q.labor[0].coverageConfirmed = laborCoverageAssumption(q, q.labor[0]);
    const after = calc(q);
    assert.equal(item(after, 'labor_hours'), undefined);
    assert.deepEqual(numbers(after), numbers(before));
  });
});

describe('V-1: días de espera sin tarifa fuera de on-call', () => {
  test('servicio permanente con 10 días de espera y tarifa 0: para revisar (cuestan y no se cobran)', () => {
    const r = calc(service({
      id: 'v1-standby', serviceType: 'permanent', unit: 'hour',
      activity: { activeDaysPerMonth: 15, daysPerActivation: 1, availableDaysPerMonth: 31, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Operador' })],
      rules: { standbyNotApplicable: false, standbyDaysPerMonth: 10, standbyRatePerDay: 0 },
    }));
    const it = item(r, 'standby');
    assert.equal(it.severity, 'review');
    assert.match(it.message, /cuestan y no se cobran/);
  });
});

describe('V-5: con pendientes críticos no se marca como enviada', () => {
  test('una cotización recién creada (con críticos) no pasa a Enviada', () => {
    const r = calc(service({ id: 'v5', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Operador' })], finance: { paymentTermDays: null } }));
    const check = sendCheck(riskSummary(r.completeness));
    assert.equal(check.allowed, false);
    assert.equal(check.reason, 'critical');
    assert.ok(check.items.includes('Plazo de pago'));
  });
});

describe('V-6 y V-7: límites del modelo, informativos', () => {
  test('mínimo por llamado: aviso informativo (no resta puntaje ni bloquea)', () => {
    const r = calc(service({ id: 'v6', serviceType: 'on_call', unit: 'hour', activity: { activeDaysPerMonth: 15, daysPerActivation: 1, hoursPerActiveDay: 4.8 }, labor: [person({ role: 'Operador' })], rules: { minimumCallUnits: 4 } }));
    const n = r.completeness.notices.find((x) => x.id === 'minimum_on_average');
    assert.ok(n);
    assert.equal(n.severity, 'info');
    assert.match(n.message, /se aplica al llamado promedio/);
  });
  test('una intervención más larga que el mes: aviso propio y "Cómo se cobra" no sugiere contarla completa', () => {
    // Como SIM-06D: una obra global de 43 días con 26 días disponibles por mes (0,6 trabajos por mes).
    const q = service({ id: 'v7', serviceType: 'lump_sum', unit: 'job', activity: { billableQuantityPerMonth: 26 / 43, daysPerActivation: 43, availableDaysPerMonth: 26, hoursPerActiveDay: 11 }, labor: [person({ role: 'Capataz' })] });
    const r = calc(q);
    const n = r.completeness.notices.find((x) => x.id === 'activation_longer_than_month');
    assert.ok(n, JSON.stringify(r.completeness.notices.map((x) => x.id)));
    assert.match(n.message, /UN MES de trabajo/);
    assert.equal(r.activationRounding.longerThanMonth, true);
    const text = activationRoundingText(r.activationRounding, activationTerms(q));
    if (text) assert.doesNotMatch(text.text, /activá la opción/);
  });
});
