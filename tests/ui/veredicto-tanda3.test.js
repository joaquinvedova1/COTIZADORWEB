/**
 * Veredicto de la ronda de testeo 2026-11-15, tanda 3 (V-15 a V-33):
 * limpieza y textos. Decisiones de pantalla sacadas a funciones puras;
 * ninguna recalcula: leen el resultado de computeQuote.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { baseOf } from '../../js/ui/views/quote-steps/indirect.js';
import { resourceCostText } from '../../js/ui/views/quote-steps/modality.js';
import { extraPresetsFor, OUT_OF_HOURS_PRESETS_NOTE } from '../../js/ui/views/quote-steps/extras.js';
import { OUT_OF_HOURS_KIND } from '../../js/engines/out-of-hours-engine.js';
import { routeConsumptionNote } from '../../js/ui/views/quote-steps/logistics.js';
import { defaultUnitForContract } from '../../js/domain/contract.js';
import { EMPTY } from '../../js/core/format.js';
import { illustrativeInfo, usesOwnFuel, blankMaterialLine, materialLineFromLibrary } from '../../js/domain/quote-factory.js';
import { service, person, external, owned, vehicle, resetIds } from '../lab/lib/build.js';

const norm = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ');

describe('V-15 · Base de la estructura con proveedores', () => {
  test('el % sobre costo directo se muestra sobre la misma base que usa el motor', () => {
    resetIds();
    const q = service({
      unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person()], equipment: [external({ name: 'Grúa' }, { price: 500000, unit: 'day' })],
      indirect: { method: 'percent_direct', pct: 10 },
    });
    const r = computeQuote(q);
    const structure = r.eecc.rows.find((row) => row.category === 'structure').amount;
    assert.ok(r.eecc.rows.find((row) => row.category === 'external').amount > 0);
    assert.ok(Math.abs(baseOf(r) * 0.1 - structure) < 0.01, `${baseOf(r) * 0.1} vs ${structure}`);
  });
});

describe('V-16 · "Lo que cuestan tus recursos"', () => {
  test('con fijo y variable muestra los dos', () => {
    assert.equal(norm(resourceCostText(4200000, 350000)), '$ 4.200.000 por mes + $ 350.000 por día');
    assert.equal(norm(resourceCostText(4200000, 0)), '$ 4.200.000 por mes');
    assert.equal(norm(resourceCostText(0, 350000)), '$ 350.000 por día');
    assert.equal(resourceCostText(0, 0), EMPTY);
  });
});

describe('V-17 · Adicionales frecuentes con fuera de horario activo', () => {
  const labels = (extras) => extraPresetsFor(extras).map((p) => p.label);

  test('sin fuera de horario se ofrecen los tres', () => {
    assert.deepEqual(labels([]), ['Feriado o fin de semana', 'Llamado fuera de horario', 'Km excedente']);
    assert.deepEqual(labels(undefined), ['Feriado o fin de semana', 'Llamado fuera de horario', 'Km excedente']);
  });

  test('con fuera de horario activo sólo queda "Km excedente"', () => {
    assert.deepEqual(labels([{ kind: OUT_OF_HOURS_KIND, premiumPct: 50 }]), ['Km excedente']);
    assert.match(OUT_OF_HOURS_PRESETS_NOTE, /ya se cotizan arriba/);
  });

  test('un adicional ya cargado no se ofrece de nuevo', () => {
    assert.deepEqual(labels([{ label: 'Km excedente' }]), ['Feriado o fin de semana', 'Llamado fuera de horario']);
  });
});

describe('V-20 · Sello ILUSTRATIVO del combustible', () => {
  const quote = (o) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], ...o });
    q.fuel.illustrative = true;
    return q;
  };

  test('sin nadie que consuma combustible a cargo propio no hay sello', () => {
    assert.equal(illustrativeInfo(quote({})).fuel, false);
    assert.equal(illustrativeInfo(quote({})).any, false);
    assert.equal(illustrativeInfo(quote({ equipment: [owned({ fuelNotApplicable: true })] })).fuel, false);
    assert.equal(illustrativeInfo(quote({ equipment: [external({}, { fuelIncluded: true })] })).fuel, false);
    // Vehículo cargado pero "Sin traslados": no viaja.
    assert.equal(illustrativeInfo(quote({ logistics: { notApplicable: true, vehicles: [vehicle()] } })).fuel, false);
  });

  test('con un equipo propio, un externo sin combustible incluido o un vehículo de apoyo, sí', () => {
    assert.equal(illustrativeInfo(quote({ equipment: [owned()] })).fuel, true);
    assert.equal(illustrativeInfo(quote({ equipment: [external({}, { fuelIncluded: false })] })).fuel, true);
    assert.equal(illustrativeInfo(quote({ logistics: { notApplicable: false, vehicles: [vehicle()] } })).fuel, true);
  });

  test('coincide con la regla de combustible de la completitud', () => {
    const cases = [{}, { equipment: [owned({ fuelNotApplicable: true })] }, { equipment: [owned()] }, { equipment: [external({}, { fuelIncluded: false })] },
      { equipment: [external({}, { fuelIncluded: true })] }, { logistics: { notApplicable: false, vehicles: [vehicle()] } }];
    cases.forEach((o) => {
      const q = quote(o);
      const item = computeQuote(q).completeness.items.find((i) => i.id === 'fuel');
      const applies = Boolean(item) && !/^No aplica/.test(item.message);
      assert.equal(usesOwnFuel(q), applies, JSON.stringify(o));
    });
  });
});

describe('V-21 · Material nuevo', () => {
  test('la línea en blanco nace con proveedor "Nosotros"; la de biblioteca conserva lo suyo', () => {
    assert.equal(blankMaterialLine({ id: 'm1' }).providedBy, 'contractor');
    assert.equal(blankMaterialLine({ id: 'm1' }).description, 'Nuevo material');
    assert.equal(materialLineFromLibrary({ id: 'lib', description: 'Caño' }, { id: 'm2', now: '2026-10-16T12:00:00.000Z' }).providedBy, null);
    assert.equal(materialLineFromLibrary({ id: 'lib', providedBy: 'client' }, { id: 'm3', now: '2026-10-16T12:00:00.000Z' }).providedBy, 'client');
  });
});

describe('V-23 · "Consumo en ruta" de un alquilado con consumo por km', () => {
  test('no se pide dos veces: la ruta ya está en el consumo del alquiler', () => {
    const rented = (ext) => external({ acquisition: 'rented', mobilization: { mode: 'self' } }, ext);
    assert.equal(routeConsumptionNote(rented({ fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 30 })), 'El combustible de la ruta ya está en el consumo del alquiler.');
    assert.equal(routeConsumptionNote(rented({ fuelIncluded: false, fuelMode: 'per_hour', fuelLitersPerHour: 8 })), null);
    assert.equal(routeConsumptionNote(rented({ fuelIncluded: true })), null);
    assert.equal(routeConsumptionNote(owned({ mobilization: { mode: 'self' } })), null);
  });
});

describe('V-24 · Unidad al pasar a "Por servicio prestado"', () => {
  test('sin unidad que encaje arranca en $/día, como la cotización en blanco', () => {
    assert.equal(defaultUnitForContract({ mode: 'on_demand', labor: true, equipment: true }), 'day');
    assert.equal(defaultUnitForContract({ mode: 'on_demand', labor: true, equipment: false }), 'day');
    assert.equal(defaultUnitForContract({ mode: 'monthly', labor: true, equipment: true }), 'month');
    assert.equal(defaultUnitForContract({ mode: 'closed', labor: true, equipment: true }), 'job');
  });
});
