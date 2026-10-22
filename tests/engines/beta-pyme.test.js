/**
 * Auditoría PyME de la beta (BETA-CR, PLAN-2026-029): los dos P1 del recorrido
 * de una empresa nueva. Cada test falló antes del arreglo. Ninguno cambia una
 * fórmula: sólo avisan (completitud) de un dato que deja el costo corto.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { service, person, owned, external } from '../lab/lib/build.js';

const item = (q, id) => evaluateCompleteness(q).items.find((x) => x.id === id);
const pending = (q, id) => evaluateCompleteness(q).pending.find((x) => x.id === id) || null;
const rowsOf = (r, category) => r.eecc.rows.filter((x) => x.category === category).reduce((s, x) => s + x.amount, 0);

describe('P1-1 · Equipo que se traslada por sus propios medios sin consumo en ruta', () => {
  const quote = (mob = {}, o = {}) => {
    const q = service({
      id: 'p11', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
      labor: [person({ agreementId: 'cct-test' })],
      equipment: [owned({ name: 'Hidrogrúa', fuelLitersPerHour: 12, mobilization: { mode: 'self', travelLitersPer100Km: 0, travelCostPerKm: 0, driver: 'operator', ...mob }, ...o })],
    });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
    return q;
  };

  test('con km y consumo en ruta 0, Combustible queda pendiente aunque el equipo consuma trabajando', () => {
    const fuel = item(quote(), 'fuel');
    assert.equal(fuel.status, 'missing');
    assert.equal(fuel.focus, 'equipment.0.mobilization.travelLitersPer100Km');
    assert.equal(fuel.step, 'logistics');
    assert.match(fuel.message, /"Hidrogrúa"/);
    // El rótulo del campo en Movilización, y sin sugerir "No usa combustible" (sacaría también lo que consume trabajando).
    assert.match(fuel.message, /consumo en ruta/);
    assert.doesNotMatch(fuel.message, /No usa combustible/);
    // Es un pendiente "para revisar": el resultado sale como BORRADOR (pantalla y PDF).
    assert.equal(pending(quote(), 'fuel').severity, 'review');
  });

  test('el aviso no cambia el costo: la fórmula sigue igual', () => {
    const q = quote();
    const before = computeQuote(structuredClone(q));
    // 12 L/h × 8 h × 10 días × $ 1.500 = $ 1.440.000 trabajando; en ruta, 0.
    assert.equal(rowsOf(before, 'fuel'), 1440000);
  });

  test('con consumo en ruta cargado, sin traslados, sin km, cliente que provee o "No usa combustible": no avisa', () => {
    assert.equal(item(quote({ travelLitersPer100Km: 30 }), 'fuel').status, 'ok');
    const noKm = quote();
    noKm.logistics.distanceKm = 0;
    assert.notEqual(item(noKm, 'fuel').focus, 'equipment.0.mobilization.travelLitersPer100Km');
    const client = quote();
    client.fuel.providedBy = 'client';
    assert.equal(item(client, 'fuel').status, 'ok');
    assert.equal(item(quote({}, { fuelNotApplicable: true }), 'fuel').status, 'ok');
    const off = quote();
    off.logistics.notApplicable = true;
    assert.notEqual(item(off, 'fuel').focus, 'equipment.0.mobilization.travelLitersPer100Km');
  });

  test('un externo con el combustible incluido no paga la ruta: no avisa', () => {
    const q = service({
      id: 'p11x', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
      labor: [person({ agreementId: 'cct-test' })],
      equipment: [
        owned({ name: 'Camión', fuelLitersPerHour: 10, mobilization: { mode: 'none' } }),
        external({ name: 'Grúa alquilada', mobilization: { mode: 'self', travelLitersPer100Km: 0, driver: 'other' } }, { price: 100000, fuelIncluded: true, mobilizationIncluded: false }),
      ],
    });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
    assert.notEqual(item(q, 'fuel').focus, 'equipment.1.mobilization.travelLitersPer100Km');
  });
});

describe('P1-2 · Cargas sociales genéricas de ejemplo en un puesto sin convenio', () => {
  const quote = (o = {}) => service({
    id: 'p12', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
    labor: [person({ role: 'Operador de grúa', ...o })],
  });

  test('sin convenio y con los parámetros genéricos: pendiente "para revisar" en Personal', () => {
    const p = pending(quote(), 'labor_generic_params');
    assert.ok(p, 'falta el pendiente');
    assert.equal(p.status, 'warning');
    assert.equal(p.severity, 'review');
    assert.equal(p.step, 'labor');
    // Al campo de las cargas en "Opciones avanzadas": sin convenios cargados, el selector no tiene salida (ESC-03).
    assert.equal(p.focus, 'labor.0.employerContributionsPct');
    assert.match(p.message, /"Operador de grúa"/);
    assert.match(p.message, /ILUSTRATIV/);
  });

  test('con convenio elegido, con un valor propio, sin posiciones o en la demo: no avisa', () => {
    assert.equal(pending(quote({ agreementId: 'cct-test' }), 'labor_generic_params'), null);
    assert.equal(pending(quote({ employerContributionsPct: 26.4 }), 'labor_generic_params'), null);
    assert.equal(pending(quote({ positions: 0 }), 'labor_generic_params'), null);
    const demo = quote();
    demo.illustrative = true;
    assert.equal(pending(demo, 'labor_generic_params'), null);
  });

  test('el aviso no cambia el costo laboral', () => {
    const a = computeQuote(quote());
    const b = computeQuote(quote({ agreementId: 'cct-test' }));
    assert.ok(rowsOf(a, 'labor') > 0);
    assert.equal(rowsOf(a, 'labor'), rowsOf(b, 'labor'));
  });
});
