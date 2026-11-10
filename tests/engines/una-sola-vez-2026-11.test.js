/**
 * "No repitamos cosas" (2026-11-10): viáticos, combustible y vehículos se cargan una sola vez.
 *   - Cómo llega cada equipo (y su consumo en ruta) se edita en su tarjeta de Equipos.
 *   - Las comidas van sólo en Personal; la calculadora de Viajes es de alojamiento.
 *   - Ninguna cotización guardada cambia sus números.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { stepOfPath, fieldHref } from '../../js/ui/field-links.js';
import { lodgingFromDetail } from '../../js/domain/lodging.js';
import { service, person, owned, vehicle, resetIds } from '../lab/lib/build.js';

const item = (q, id) => evaluateCompleteness(q).items.find((i) => i.id === id);

describe('Un equipo, un solo lugar: la movilización se edita en Equipos', () => {
  test('los campos de movilización llevan a Equipos', () => {
    assert.equal(stepOfPath('equipment.0.mobilization.mode'), 'equipment');
    assert.equal(stepOfPath('equipment.2.mobilization.travelLitersPer100Km'), 'equipment');
    assert.match(fieldHref('q1', 'equipment.0.mobilization.mode'), /\/equipment\?campo=equipment\.0\.mobilization\.mode$/);
    assert.equal(stepOfPath('logistics.distanceKm'), 'logistics');
    assert.equal(stepOfPath('fuel.pricePerLiter'), 'logistics');
  });

  const quote = (m = {}) => {
    resetIds();
    return service({
      serviceType: 'monthly', unit: 'month', activity: { activeDaysPerMonth: 20 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ name: 'Camioneta', operatorLaborId: 'op', fuelLitersPerHour: 0, mobilization: { mode: 'self', travelLitersPer100Km: 0, travelCostPerKm: 100, driver: 'operator', ...m } })],
      logistics: { notApplicable: false, distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
  };
  test('el pendiente del consumo en ruta se muestra en Equipos', () => {
    const it = item(quote(), 'mobility');
    assert.equal(it.status, 'warning');
    assert.equal(it.step, 'equipment');
    assert.equal(it.focus, 'equipment.0.mobilization.travelLitersPer100Km');
    const fuel = item(quote(), 'fuel');
    assert.equal(fuel.step, 'equipment');
  });
  test('una camioneta que sólo viaja: 0 L/h trabajando + consumo en ruta = combustible definido', () => {
    const q = quote({ travelLitersPer100Km: 14 });
    assert.equal(item(q, 'fuel').status, 'ok');
    assert.equal(item(q, 'mobility').status, 'ok');
    const r = computeQuote(q);
    // 200 km por día × 14 L/100 km × 20 días = 560 L, sólo en ruta.
    assert.ok(Math.abs(r.model.mobilization.litersPerActivation * r.model.logistics.activationsPerMonth - 560) < 1e-6);
  });
});

describe('Cotizaciones guardadas: mismos números', () => {
  test('un vehículo por km de antes sigue sumando igual', () => {
    resetIds();
    const q = service({
      serviceType: 'monthly', unit: 'month', activity: { activeDaysPerMonth: 20 },
      labor: [person({ mealPerActiveDay: 15000, transferMonthly: 50000 })],
      logistics: { notApplicable: false, distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [vehicle({ name: 'Camioneta' })], lodgingPerActivation: 90000, lodgingDetail: { people: 3, nights: 1, perNight: 20000, days: 1, perDay: 10000 } },
    });
    const r = computeQuote(q);
    // vehículo: 200 km × (12 L/100 km × $ 1.500 + $ 80/km) = $ 52.000 + viáticos $ 90.000, × 20.
    assert.ok(Math.abs(r.model.logistics.monthlyCost - (52000 + 90000) * 20) < 1e-6);
  });
  test('la calculadora sin comidas da sólo el alojamiento; con comidas de antes, igual que siempre', () => {
    assert.equal(lodgingFromDetail({ people: 3, nights: 2, perNight: 20000, days: 2, perDay: null }), 120000);
    assert.equal(lodgingFromDetail({ people: 3, nights: 1, perNight: 20000, days: 1, perDay: 10000 }), 90000);
  });
});

