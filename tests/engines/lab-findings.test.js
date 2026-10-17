/**
 * Hallazgos de la primera campaña de RATEOS Test Lab (PLAN-2026-013).
 *
 * Cada test reproduce un hallazgo con la cotización mínima que lo muestra y
 * fija la respuesta correcta (falló antes del fix). Ninguno cambia una
 * fórmula de costo o de precio: son avisos, enlaces al campo exacto y un
 * indicador del resultado que mezclaba combustible con externos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { cot0010Quote, cot0011Quote } from '../fixtures/cot-0010.js';
import { service, person, owned, external, material } from '../lab/lib/build.js';

const route = (o = {}) => ({ notApplicable: false, baseName: 'Neuquén', destinationName: 'Locación', distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [], ...o });
const item = (q, id) => evaluateCompleteness(q).items.find((x) => x.id === id);

describe('LAB-F1 · Externos del mes: el combustible por km no se mezcla con la tarifa del proveedor', () => {
  test('con salidas completas, "Costo económico" de externos = fila "Equipos y servicios externos" de la EECC', () => {
    const q = cot0011Quote({ code: 'LAB-F1' });
    q.activity = { ...q.activity, billableQuantityPerMonth: 13, fullActivations: true };
    q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
    const r = computeQuote(q);
    const row = r.eecc.rows.find((x) => x.category === 'external');
    assert.ok(Math.abs(r.kpis.externalMonthly - row.amount) < 0.01, `externos ${r.kpis.externalMonthly} vs EECC ${row.amount}`);
    // IVA 21 % recuperable: la salida de caja es neto × 1,21, sin el combustible (lo pagamos nosotros, no el proveedor).
    assert.ok(Math.abs(r.kpis.externalCashMonthly - row.amount * 1.21) < 0.01, `caja ${r.kpis.externalCashMonthly}`);
    // El costo total no cambia: el combustible sigue en "Combustible".
    assert.ok(r.eecc.rows.find((x) => x.category === 'fuel').amount > 0);
  });
});

describe('LAB-F2 · Combustible por km con "Sin traslados": el botón lleva a lo que bloquea', () => {
  test('el pendiente apunta a "Sin traslados" (no a la distancia) y dice por qué', () => {
    const q = cot0010Quote({ code: 'LAB-F2' });
    q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
    q.logistics.notApplicable = true;
    const fuel = item(q, 'fuel');
    assert.equal(fuel.status, 'missing');
    assert.equal(fuel.focus, 'logistics.notApplicable');
    assert.match(fuel.message, /Sin traslados/);
  });
  test('con traslados y sin distancia sigue llevando a la distancia (como en v0.7.2)', () => {
    const q = cot0010Quote({ code: 'LAB-F2b' });
    q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
    q.logistics.distanceKm = 0;
    assert.equal(item(q, 'fuel').focus, 'logistics.distanceKm');
  });
});

describe('LAB-F3 · Unidad "km": km facturados ≠ km de la ruta', () => {
  const kmQuote = (trips) => service({
    id: 'lab-f3', serviceType: 'transport', unit: 'km',
    activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1 },
    labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
    equipment: [external({ name: 'Camión tercerizado' }, { price: 1100, unit: 'km' })],
    logistics: route({ distanceKm: 100, tripsPerActivation: trips }),
  });
  test('8.000 km facturados con una ruta de 4.000 km: aviso a revisar con botón a los viajes por salida (no queda 100 %)', () => {
    const c = evaluateCompleteness(kmQuote(1));
    const it = c.items.find((x) => x.id === 'route_consistency');
    assert.ok(it, 'falta el aviso de coherencia de la ruta');
    assert.equal(it.status, 'warning');
    assert.equal(it.focus, 'logistics.tripsPerActivation');
    assert.match(it.message, /8\.000 km/);
    assert.match(it.message, /4\.000 km/);
    assert.ok(c.scorePct < 100);
  });
  test('con 2 viajes por salida (8.000 km de ruta) no hay aviso', () => {
    const it = evaluateCompleteness(kmQuote(2)).items.find((x) => x.id === 'route_consistency');
    assert.ok(!it || it.status === 'ok');
  });
  test('la ruta recorre MÁS km de los que se facturan (vuelta vacía, se cobran los km cargados): no hay aviso', () => {
    // 4 viajes por salida = 16.000 km de ruta para 8.000 km facturados: los costos por km ya cubren los km físicos.
    const it = evaluateCompleteness(kmQuote(4)).items.find((x) => x.id === 'route_consistency');
    assert.ok(!it || it.status === 'ok', it && it.message);
  });
});

describe('LAB-F4 · Unidad "viaje" o "km" con "Sin traslados"', () => {
  test('se venden viajes pero no hay ruta: aviso con botón a "Sin traslados"', () => {
    const q = service({
      id: 'lab-f4', serviceType: 'transport', unit: 'trip',
      activity: { billableQuantityPerMonth: 20, unitsPerActiveDay: 2, daysPerActivation: 1 },
      labor: [person({ id: 'ch', role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', operatorLaborId: 'ch', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
      logistics: { notApplicable: true, distanceKm: 0 },
    });
    const it = item(q, 'route_consistency');
    assert.ok(it && it.status === 'warning', 'falta el aviso');
    assert.equal(it.focus, 'logistics.notApplicable');
    assert.match(it.message, /Sin traslados/);
  });
});

describe('LAB-F5 · "Sin traslados" con un equipo que se traslada por sus propios medios', () => {
  test('la regla de movilización avisa que esa movilización no se suma', () => {
    const q = service({
      id: 'lab-f5', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ name: 'Camión grúa', operatorLaborId: 'op', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
      logistics: { notApplicable: true, distanceKm: 120 },
    });
    const it = item(q, 'mobility');
    assert.ok(it && it.status === 'warning', 'falta el aviso');
    assert.equal(it.focus, 'logistics.notApplicable');
    assert.match(it.message, /Camión grúa/);
  });
});

describe('LAB-F6 · Externo $/hora sin horas: crítico, nunca $ 0 válido', () => {
  test('0 horas por día en la línea → crítico con botón a esas horas', () => {
    const q = service({ id: 'lab-f6', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, equipment: [external({ name: 'Grúa por hora', hoursPerActiveDay: 0 }, { price: 300000, unit: 'hour' })] });
    const c = evaluateCompleteness(q);
    const it = c.items.find((x) => x.id === 'external_hours');
    assert.ok(it, 'falta el crítico');
    assert.equal(it.severity, 'critical');
    assert.equal(it.focus, 'equipment.0.hoursPerActiveDay');
    assert.match(it.message, /Grúa por hora/);
  });
  test('sin horas en la línea ni en la actividad → el botón lleva a las horas de la actividad', () => {
    const q = service({ id: 'lab-f6b', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 0 }, equipment: [external({ name: 'Grúa por hora' }, { price: 300000, unit: 'hour' })] });
    assert.equal(item(q, 'external_hours').focus, 'activity.hoursPerActiveDay');
  });
  test('con mínimo por llamado no es crítico (factura el mínimo)', () => {
    const q = service({ id: 'lab-f6c', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, equipment: [external({ name: 'Grúa', hoursPerActiveDay: 0 }, { price: 300000, unit: 'hour', minimumUnits: 4 })] });
    assert.equal(item(q, 'external_hours'), undefined);
  });
});

describe('LAB-F7 · Cobro $/hora con 0 horas por día', () => {
  test('la actividad queda en rojo (crítico) con botón a las horas por día', () => {
    const q = service({ id: 'lab-f7', serviceType: 'crew', unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 0 }, labor: [person()] });
    const c = evaluateCompleteness(q);
    const it = c.items.find((x) => x.id === 'utilization');
    assert.equal(it.status, 'missing');
    assert.equal(it.severity, 'critical');
    assert.equal(it.focus, 'activity.hoursPerActiveDay');
  });
});

describe('LAB-F8 · Materiales con precio y sin cantidad', () => {
  test('la regla de materiales lo marca y la validación rechaza cantidades negativas', () => {
    const q = service({ id: 'lab-f8', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Electrodos', basis: 'per_active_day', quantity: 0, unitCost: 18000 })] });
    const it = item(q, 'materials');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /Electrodos/);
    assert.equal(it.focus, 'materials.0.quantity');
    q.materials[0].quantity = -3;
    assert.ok(validateQuote(q).some((x) => x.path === 'materials.0.quantity' && x.severity === 'error'));
    // Con "El servicio no usa materiales" las líneas no se ven ni se suman: no hay error que no se pueda corregir en pantalla.
    q.materialsNotApplicable = true;
    assert.ok(!validateQuote(q).some((x) => x.path.startsWith('materials.')));
  });
});

describe('LAB-F9 · Avisos informativos (no restan puntaje)', () => {
  test('puesto con sueldo y 0 posiciones', () => {
    const q = service({ id: 'lab-f9', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Oficial' }), person({ role: 'Ayudante', positions: 0, basicMonthly: 1200000 })] });
    const c = evaluateCompleteness(q);
    const n = c.notices.find((x) => x.id === 'labor_no_positions');
    assert.ok(n && /Ayudante/.test(n.message));
    assert.equal(n.focus, 'labor.1.positions');
  });
  test('"no usa materiales" con materiales cargados', () => {
    const q = service({ id: 'lab-f9b', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Pintura', quantity: 10, unitCost: 20000 })] });
    q.materialsNotApplicable = true;
    const n = evaluateCompleteness(q).notices.find((x) => x.id === 'materials_ignored');
    assert.ok(n && /1 material/.test(n.message));
    assert.equal(n.focus, 'materialsNotApplicable');
  });
});

describe('LAB-F10 · Críticos de un solo campo llevan a ese campo', () => {
  test('actividad, margen, tarifa conocida y plazo de cobro tienen botón al campo exacto', () => {
    const q = service({ id: 'lab-f10', serviceType: 'on_call', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: null }, labor: [person()], pricing: { targetMarginPct: 100, knownRate: 0 }, finance: { paymentTermDays: null } });
    const focus = Object.fromEntries(evaluateCompleteness(q).pending.map((p) => [p.id, p.focus]));
    assert.equal(focus.utilization, 'activity.activeDaysPerMonth');
    assert.equal(focus.margin, 'pricing.targetMarginPct');
    assert.equal(focus.rate, 'pricing.knownRate');
    assert.equal(focus.payment_term, 'finance.paymentTermDays');
  });
  test('por cantidad: lleva a la cantidad del mes o a la cantidad por día, según cuál falte', () => {
    const base = { id: 'lab-f10b', serviceType: 'per_unit', unit: 'm3', labor: [person()] };
    assert.equal(item(service({ ...base, activity: { billableQuantityPerMonth: 0, unitsPerActiveDay: 100 } }), 'utilization').focus, 'activity.billableQuantityPerMonth');
    assert.equal(item(service({ ...base, activity: { billableQuantityPerMonth: 2000, unitsPerActiveDay: 0 } }), 'utilization').focus, 'activity.unitsPerActiveDay');
  });
});

describe('LAB-F11 · "Costo de equipos" incompleto lleva al dato que falta de la primera línea', () => {
  const base = { id: 'lab-f11', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10 } };
  test('externo sin tarifa → tarifa neta de esa línea', () => {
    const q = service({ ...base, equipment: [owned({ name: 'Grúa propia' }), external({ name: 'Equipo alquilado' }, { price: 0, unit: 'day' })] });
    assert.equal(item(q, 'equipment_cost').focus, 'equipment.1.external.price');
  });
  test('propio sin valor de reposición → valor de reposición; con valor y sin vida útil → vida útil', () => {
    assert.equal(item(service({ ...base, equipment: [owned({ name: 'Grúa', replacementValue: 0 })] }), 'equipment_cost').focus, 'equipment.0.replacementValue');
    assert.equal(item(service({ ...base, equipment: [owned({ name: 'Grúa', usefulLifeYears: 0 })] }), 'equipment_cost').focus, 'equipment.0.usefulLifeYears');
  });
  test('sin equipos cargados no hay campo: el botón lleva al paso (sin focus)', () => {
    assert.equal(item(service({ ...base, equipment: [] }), 'equipment_cost').focus, undefined);
  });
});

describe('LAB-F12 · Dentro del paso, "Ir al campo" usa el campo exacto que indica el motor', () => {
  test('materiales incompletos, movilización con "Sin traslados", km de la ruta y horas del proveedor', async () => {
    const { pendingFieldPath } = await import('../../js/ui/views/quote-editor.js');
    const mat = service({ id: 'lab-f12a', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Electrodos', quantity: 0, unitCost: 18000 })] });
    assert.equal(pendingFieldPath(item(mat, 'materials'), mat), 'materials.0.quantity');
    const mob = service({
      id: 'lab-f12b', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person({ id: 'op' })],
      equipment: [owned({ name: 'Camión grúa', operatorLaborId: 'op', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
      logistics: { notApplicable: true, distanceKm: 120 },
    });
    assert.equal(pendingFieldPath(item(mob, 'mobility'), mob), 'logistics.notApplicable');
    const km = service({
      id: 'lab-f12c', serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 1100, unit: 'km' })],
      logistics: route({ distanceKm: 100, tripsPerActivation: 1 }),
    });
    assert.equal(pendingFieldPath(item(km, 'route_consistency'), km), 'logistics.tripsPerActivation');
    const hours = service({ id: 'lab-f12d', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, equipment: [external({ name: 'Grúa por hora', hoursPerActiveDay: 0 }, { price: 300000, unit: 'hour' })] });
    assert.equal(pendingFieldPath(item(hours, 'external_hours'), hours), 'equipment.0.hoursPerActiveDay');
  });
  test('un material sin responsable sigue llevando al responsable', async () => {
    const { pendingFieldPath } = await import('../../js/ui/views/quote-editor.js');
    const q = service({ id: 'lab-f12e', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Pintura', providedBy: null, quantity: 0, unitCost: 1000 })] });
    assert.equal(pendingFieldPath(item(q, 'materials'), q), 'materials.0.providedBy');
  });
});
