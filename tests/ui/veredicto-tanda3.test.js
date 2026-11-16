/**
 * Veredicto de la ronda de testeo 2026-11-15, tanda 3 (V-15 a V-33):
 * limpieza y textos. Decisiones de pantalla sacadas a funciones puras;
 * ninguna recalcula: leen el resultado de computeQuote.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { baseOf } from '../../js/ui/views/quote-steps/indirect.js';
import { resourceCostText, outOfHoursNoteText, outOfHoursHoursNote, outOfHoursCostLabel, outOfHoursCostHint, ownEquipmentTravels } from '../../js/ui/views/quote-steps/modality.js';
import { extraPresetsFor, OUT_OF_HOURS_PRESETS_NOTE } from '../../js/ui/views/quote-steps/extras.js';
import { OUT_OF_HOURS_KIND } from '../../js/engines/out-of-hours-engine.js';
import { routeConsumptionNote } from '../../js/ui/views/quote-steps/logistics.js';
import { defaultUnitForContract } from '../../js/domain/contract.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';
import { outOfHoursMarginNote, outOfHoursBreakEvenNote, coveredByOtherRevenue, coveredRateText, rateBelowHourCostText } from '../../js/ui/result-text.js';
import { standbyOutputText, showStandbyRule, STANDBY_DAYS_NOTE } from '../../js/ui/views/quote-steps/margin.js';
import { EMPTY, formatMoney } from '../../js/core/format.js';
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

describe('V-26 · Hora fuera de horario cuando no se cobra por hora ni por día', () => {
  const overtime = () => [50, 100].map((premiumPct, i) => ({ id: `ooh-${i}`, kind: OUT_OF_HOURS_KIND, premiumPct, label: '', unitName: 'hora', category: 'labor', quantityPerMonth: null, costPerUnit: null, price: null }));
  const quote = (o) => {
    resetIds();
    const q = service({ labor: [person(), person()], ...o });
    q.extras = overtime();
    return q;
  };
  const note = (q) => norm(outOfHoursNoteText(computeQuote(q), billingUnitOf(q)));

  test('por viaje: dice para qué sirve la hora y que no reemplaza al viaje', () => {
    const q = quote({ serviceType: 'transport', unit: 'trip', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, hoursPerActiveDay: 8 } });
    const r = computeQuote(q);
    assert.equal(r.outOfHours.normalHourSource, 'resources');
    const [s50, s100] = r.outOfHours.lines.map((l) => l.surchargePrice);
    assert.ok(s50 > 0 && s100 > s50);
    const text = note(q);
    assert.match(text, /^Tu hora normal equivale a \$ [\d.]+ \(lo que cuestan tu gente y tus equipos por hora, con tu margen\)\./);
    assert.match(text, /Es el precio de cada hora que trabajás fuera de horario además de los viajes que cotizaste\. No reemplaza al viaje: si un viaje entero cae fuera de horario, cobrá el viaje más el recargo por hora \(\$ [\d.]+ al 50 % o \$ [\d.]+ al 100 %\)\.$/);
    assert.doesNotMatch(text, /Se cobra aparte de la tarifa/);
  });

  test('por km o por hectárea: "a los km", "a las hectáreas" y "un trabajo entero"', () => {
    const km = note(quote({ serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 3600, unitsPerActiveDay: 240, hoursPerActiveDay: 8 } }));
    assert.match(km, /además de los km que cotizaste\. No reemplaza a los km: si un trabajo entero cae fuera de horario, cobrá los km más el recargo/);
    const ha = note(quote({ serviceType: 'per_unit', unit: 'ha', activity: { billableQuantityPerMonth: 100, unitsPerActiveDay: 10, hoursPerActiveDay: 8 } }));
    assert.match(ha, /además de las hectáreas que cotizaste\. No reemplaza a las hectáreas:/);
  });

  test('abono: sólo dice que es además del abono', () => {
    const text = note(quote({ serviceType: 'permanent', unit: 'month', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 8 } }));
    assert.match(text, /Es el precio de cada hora que trabajás fuera de horario además del abono que cotizaste\.$/);
  });

  test('una sola hora cotizada: "el recargo de $ X por hora"', () => {
    const q = quote({ serviceType: 'transport', unit: 'trip', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, hoursPerActiveDay: 8 } });
    q.extras = q.extras.slice(0, 1);
    assert.match(note(q), /cobrá el viaje más el recargo de \$ [\d.]+ por hora\.$/);
  });

  test('cobrando por día el texto no cambia', () => {
    const text = note(quote({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 } }));
    assert.match(text, /\(sale de tu tarifa\)\. El precio sugerido es esa hora más el recargo de las horas extra\. Se cobra aparte de la tarifa\.$/);
  });

  test('rótulo y ayuda del costo por hora: "(gente)" sin equipos trabajando; la ruta no está incluida', () => {
    assert.equal(outOfHoursCostLabel({ people: 2, equipmentPerHour: 0 }), 'Te cuesta por hora (gente)');
    assert.equal(outOfHoursCostLabel({ people: 2, equipmentPerHour: 1500 }), 'Te cuesta por hora (gente + equipos)');
    assert.equal(outOfHoursCostLabel(null), 'Te cuesta por hora (gente)');
    assert.equal(ownEquipmentTravels({ equipment: [owned({ mobilization: { mode: 'self' } })] }), true);
    assert.equal(ownEquipmentTravels({ equipment: [owned(), external({ mobilization: { mode: 'self' } })] }), false);
    const hint = norm(outOfHoursCostHint({ people: 2, equipmentPerHour: 0 }, { travels: true }));
    assert.equal(hint, 'Lo que pagás de más por esa hora: las horas extra de 2 personas con cargas. Sueldos y amortización ya están en el mes. No incluye combustible ni desgaste en ruta: si en esas horas se viaja, cobralos como km o como viaje.');
    assert.doesNotMatch(outOfHoursCostHint({ people: 1, equipmentPerHour: 0 }), /en ruta/);
  });
});

describe('V-26 y V-27 · Nota de las horas estimadas fuera de horario', () => {
  test('son además de las horas normales del mes; un día entero no suma solo vianda ni viaje', () => {
    assert.equal(norm(outOfHoursHoursNote({ activity: { activeDaysPerMonth: 12, hoursPerActiveDay: 8 } })),
      'Las horas estimadas son además de las 96 horas normales por mes que cargaste arriba. Si son días enteros que no ibas a trabajar, la vianda y el viaje de ese día no se suman solos.');
    assert.equal(outOfHoursHoursNote({ activity: {} }), 'Si son días enteros que no ibas a trabajar, la vianda y el viaje de ese día no se suman solos.');
  });
});

describe('V-27 · Horas fuera de horario estimadas en el Resultado', () => {
  const quote = (hours) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person(), person()] });
    q.extras = [{ id: 'ooh-50', kind: OUT_OF_HOURS_KIND, premiumPct: 50, label: '', unitName: 'hora', category: 'labor', quantityPerMonth: hours, costPerUnit: null, price: null }];
    return q;
  };

  test('con horas estimadas: el margen y el equilibrio dicen cuánto viene de esas horas', () => {
    const r = computeQuote(quote(20));
    const [line] = r.outOfHours.lines;
    assert.ok(line.profit > 0 && line.revenue > 0);
    assert.equal(outOfHoursMarginNote(r), `Incluye ${formatMoney(line.profit)} de ganancia de las horas fuera de horario, si ocurren.`);
    assert.equal(outOfHoursBreakEvenNote(r), `Cuenta ${formatMoney(line.revenue)} de horas fuera de horario como si se facturaran aunque trabajes menos días.`);
  });

  test('sin horas estimadas no se dice nada', () => {
    const r = computeQuote(quote(null));
    assert.equal(outOfHoursMarginNote(r), '');
    assert.equal(outOfHoursBreakEvenNote(r), '');
    assert.equal(outOfHoursMarginNote({}), '');
  });
});

describe('V-28 · Guardia que cubre todo', () => {
  const guard = (fee) => {
    resetIds();
    return service({ serviceType: 'on_call', unit: 'hour', activity: { activeDaysPerMonth: 6, hoursPerActiveDay: 8, availability: '24/7' }, labor: [person(), person()], rules: { availabilityFeeMonthly: fee } });
  };

  test('guardia mayor que costo y margen: sin tarifa sugerida, se explica y el margen sale de la estimación', () => {
    const r = computeQuote(guard(25_000_000));
    assert.equal(r.ratesAtEstimate.floorCoveredByOtherRevenue, true);
    assert.equal(r.kpis.marginPct, null);
    assert.ok(r.estimate.marginPct > 0 && r.estimate.profit > 0);
    assert.equal(coveredByOtherRevenue(r), true);
    assert.equal(coveredRateText(r), 'La guardia y los adicionales ya cubren tu costo y tu margen: la tarifa por hora puede ser la que acuerdes.');
  });

  test('sin guardia o con una guardia chica no aplica', () => {
    assert.equal(coveredByOtherRevenue(computeQuote(guard(0))), false);
    assert.equal(coveredByOtherRevenue(computeQuote(guard(3_000_000))), false);
    assert.equal(rateBelowHourCostText(computeQuote(guard(0))), '');
  });

  test('guardia que cubre casi todo: la sugerida queda bajo el costo por hora y se avisa', () => {
    const r = computeQuote(guard(6_500_000));
    assert.equal(coveredByOtherRevenue(r), false);
    assert.ok(r.kpis.suggestedListRate > 0);
    const hourCost = r.outOfHours.basis.crewNormalPerHour + r.outOfHours.basis.equipmentPerHour;
    assert.ok(r.kpis.suggestedListRate < hourCost, `${r.kpis.suggestedListRate} vs ${hourCost}`);
    assert.match(norm(rateBelowHourCostText(r)), /^La guardia y los adicionales ya cubren casi todo tu costo y tu margen: la tarifa por hora queda por debajo de lo que te cuesta una hora de tus recursos \(\$ [\d.]+\)\. Puede ser la que acuerdes\.$/);
  });
});

describe('V-29 · Equipo en espera con días', () => {
  const onCall = (rules) => {
    resetIds();
    return service({ serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [owned()], rules: { standbyNotApplicable: false, ...rules } });
  };

  test('con días cargados se avisa que bajan la tarifa principal; con 0 días no', () => {
    const withDays = computeQuote(onCall({ standbyDaysPerMonth: 1, standbyRatePerDay: 1_850_000 }));
    assert.match(norm(standbyOutputText(withDays, { days: 1 })), /^Ingreso por equipo en espera: \$ 1\.850\.000 · .* Estos días se cuentan como ingreso seguro y bajan tu tarifa principal\. Si la espera es eventual, dejá los días en 0 y cargá sólo la tarifa\.$/);
    const onlyRate = computeQuote(onCall({ standbyDaysPerMonth: 0, standbyRatePerDay: 1_850_000 }));
    assert.doesNotMatch(standbyOutputText(onlyRate, { days: 0 }), /ingreso seguro/);
    assert.match(standbyOutputText(onlyRate, { off: true, days: 3 }), /^No aplica equipo en espera/);
    assert.ok(withDays.kpis.suggestedListRate < onlyRate.kpis.suggestedListRate, 'la regla no cambia: los días bajan la sugerida');
    assert.match(STANDBY_DAYS_NOTE, /dejá los días en 0/);
  });

  test('el pendiente de standby dice qué hacer si la espera es eventual', () => {
    const item = computeQuote(onCall({ standbyRatePerDay: 0 })).completeness.items.find((i) => i.id === 'standby');
    assert.equal(item.status, 'warning');
    assert.match(item.message, /Si la espera es eventual, dejá los días en 0 y cargá sólo la tarifa\.$/);
  });

  test('en precio cerrado "Equipo en espera" no se muestra vacío', () => {
    const closed = { contract: { mode: 'closed', components: ['labor', 'equipment'] }, serviceType: 'lump_sum', unit: 'job', rules: {} };
    assert.equal(showStandbyRule(closed), false);
    assert.equal(showStandbyRule({ ...closed, rules: { standbyRatePerDay: 500_000 } }), true);
    assert.equal(showStandbyRule({ ...closed, rules: { standbyNotApplicable: true } }), true);
    assert.equal(showStandbyRule({ serviceType: 'on_call', unit: 'day', rules: {} }), true);
  });
});
