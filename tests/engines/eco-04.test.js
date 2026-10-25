/**
 * ECO-04 — avisos verificables de la beta (PLAN-2026-021). Ninguna fórmula cambia.
 *
 *  H-04  Abono ($/mes) con más días trabajados que disponibles (26 con 22): el motor
 *        lo toma como más de un mes de trabajo y factura 1,18 abonos. Un abono mensual
 *        no se cobra 1,18 veces: el resultado queda NO CONFIABLE hasta corregir los
 *        días (las cifras no cambian). En las otras unidades sigue siendo "trabajo de
 *        más de un mes" y el aviso lo dice (antes decía que reemplazaba valores por 0).
 *  H-08  Vehículo de apoyo: sólo suma sus costos por km. Cada vehículo dice dónde está
 *        su costo de tenerlo (una línea de Equipos o ya en el costo por km); sin
 *        respuesta, pendiente crítico.
 *  F2    Externo con operador incluido, sin operador asignado y puestos de Personal que
 *        no operan ningún equipo: se pregunta (para revisar). La confirmación vale para
 *        esos puestos; uno nuevo o renombrado vuelve a preguntar.
 *
 * Cotizaciones SINTÉTICAS de tests/fixtures/eco-01/ (E1 abono de cuadrilla, E3 transporte
 * con un externo con chofer). Las cifras fijadas son las de `main` d6540b7.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
// Import de espacio de nombres: contra `main` (sin estas funciones) cada test falla por su cuenta.
import * as completenessEngine from '../../js/engines/completeness-engine.js';
import { createQuoteFromTemplate, defaultSettings, externalLineFromService } from '../../js/domain/quote-factory.js';
import { applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { OWNERSHIP_COSTS_PER_KM } from '../../js/domain/catalogs.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/eco-01/${name}.json`, import.meta.url), 'utf8'));
const approx = (actual, expected, label = '', tol = 0.01) => {
  assert.ok(Number.isFinite(actual), `${label}: no es finito (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: esperado ${expected}, obtenido ${actual}`);
};
const operatorSupplierSnapshot = (q) => (completenessEngine.operatorSupplierSnapshot ? completenessEngine.operatorSupplierSnapshot(q) : { labor: [] });
const pendingOf = (r, id) => (r.completeness.pending || []).find((p) => p.id === id) || null;
const itemOf = (r, id) => (r.completeness.items || []).find((p) => p.id === id) || null;

// ------------------------------------------------------------------ H-04
/** E1 (abono $/mes de una cuadrilla) con 26 días trabajados y 22 disponibles. */
function e1Overflow({ active = 26, available = 22 } = {}) {
  const q = fixture('e1-cotizacion');
  q.activity.activeDaysPerMonth = active;
  q.activity.availableDaysPerMonth = available;
  return q;
}

describe('ECO-04 · H-04: abono con más días trabajados que disponibles', () => {
  test('26 de 22 en $/mes: RESULTADO NO CONFIABLE (crítico) con las mismas cifras de antes', () => {
    const r = computeQuote(e1Overflow());
    // Las cifras no cambian (las de main d6540b7): sólo dejan de presentarse como confiables.
    approx(r.kpis.totalCost, 31614002.89, 'costo del mes');
    approx(r.kpis.revenue, 39378181.82, 'facturación (1,18 abonos)');
    const p = pendingOf(r, 'month_days_overflow');
    assert.ok(p, 'falta el pendiente de días');
    assert.equal(p.severity, 'critical');
    assert.equal(p.unreliable, true);
    assert.equal(p.focus, 'activity.availableDaysPerMonth');
    assert.ok(r.completeness.unreliable >= 1);
    // El mensaje dice los números y cómo corregirlo.
    assert.match(p.message, /26/);
    assert.match(p.message, /22/);
    assert.match(p.message, /1,18/);
    assert.match(p.message, /30/);
  });

  test('con los días dentro del mes (22 de 30, 26 de 26) no hay pendiente', () => {
    assert.equal(pendingOf(computeQuote(fixture('e1-cotizacion')), 'month_days_overflow'), null);
    assert.equal(pendingOf(computeQuote(e1Overflow({ active: 26, available: 26 })), 'month_days_overflow'), null);
    assert.equal(computeQuote(fixture('e1-cotizacion')).completeness.unreliable, 0);
  });

  test('en otras unidades sigue siendo trabajo de más de un mes: sin NO CONFIABLE, crítico hasta confirmarlo (V-1) y sin un aviso repetido', () => {
    const q = fixture('e2-cotizacion');
    q.activity.activeDaysPerMonth = 36;
    q.activity.availableDaysPerMonth = 30;
    const r = computeQuote(q);
    assert.equal(pendingOf(r, 'month_days_overflow'), null);
    const p = pendingOf(r, 'multi_month');
    assert.ok(p, 'falta el pendiente de días');
    assert.equal(p.severity, 'critical');
    assert.equal(p.unreliable, undefined);
    assert.match(p.message, /36 días de trabajo en un mes de 30/);
    assert.match(p.message, /más de un mes/);
    assert.doesNotMatch(p.message, /reemplaz/);
    assert.equal(r.issues.some((i) => i.path === 'activity.activeDaysPerMonth'), false, 'el pendiente ya lo dice: sin un aviso suelto que lo repita');
  });

  test('en $/mes el aviso del campo dice que un abono no se cobra más de una vez por mes', () => {
    const issues = computeQuote(e1Overflow()).issues.filter((i) => i.path === 'activity.activeDaysPerMonth');
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /abono/);
    assert.doesNotMatch(issues[0].message, /más de un mes de trabajo/);
  });

  test('el aviso usa los días del motor: disponibles por encima de 31 se toman como 31 (como el cálculo)', () => {
    const r = computeQuote(e1Overflow({ active: 33, available: 40 }));
    const issue = r.issues.find((i) => i.path === 'activity.activeDaysPerMonth' && i.severity === 'warning');
    assert.ok(issue, 'el motor usa 31 disponibles: 33 los supera');
    assert.match(issue.message, /\(31\)/);
    assert.match(pendingOf(r, 'month_days_overflow').message, /33 días trabajados por mes con 31 días disponibles/);
  });

  test('por cantidad no se usa el campo de días: un dato viejo en "días activos" no avisa', () => {
    const q = fixture('e3-cotizacion');
    q.activity.activeDaysPerMonth = 40;
    q.activity.availableDaysPerMonth = 22;
    assert.equal(computeQuote(q).issues.some((i) => i.path === 'activity.activeDaysPerMonth'), false);
  });
});

// ------------------------------------------------------------------ H-08
/** E1 con la camioneta (Equipo 2) sacada de Equipos y cargada sólo como vehículo de apoyo. */
function e1SupportVehicle(extra = {}) {
  const q = fixture('e1-cotizacion');
  q.equipment = q.equipment.filter((e) => e.name !== 'Equipo 2');
  q.logistics.vehicles = [{ id: 'veh-camioneta', name: 'Camioneta', count: 1, consumptionLPer100Km: 13, costPerKm: 0, ...extra }];
  q.equipment[0].mobilization = { ...(q.equipment[0].mobilization || {}), mode: 'support', supportVehicleId: 'veh-camioneta' };
  return q;
}

describe('ECO-04 · H-08: vehículo de apoyo sin su costo de tenerlo', () => {
  test('la camioneta sólo como vehículo de apoyo: pendiente crítico (antes, ningún aviso), mismas cifras', () => {
    const r = computeQuote(e1SupportVehicle());
    approx(r.kpis.totalCost, 25180404.74, 'costo del mes');
    assert.equal(r.kpis.suggestedListRate, 31360000);
    const p = pendingOf(r, 'vehicle_ownership_costs');
    assert.ok(p, 'falta el pendiente del vehículo');
    assert.equal(p.severity, 'critical');
    assert.notEqual(p.unreliable, true, 'no vuelve NO CONFIABLE el resultado: el costo por km puede estar bien');
    assert.equal(p.focus, 'logistics.vehicles.0.ownershipCostsIn');
    assert.match(p.message, /Camioneta/);
    assert.match(p.message, /costo de tenerlo/);
    assert.deepEqual(p.targets, [{ list: 'vehicles', index: 0, name: 'Camioneta' }]);
  });

  test('"ya está en el costo por km" o una línea de Equipos lo resuelven; una línea que ya no existe, no', () => {
    assert.equal(pendingOf(computeQuote(e1SupportVehicle({ ownershipCostsIn: OWNERSHIP_COSTS_PER_KM })), 'vehicle_ownership_costs'), null);
    const linked = e1SupportVehicle();
    linked.logistics.vehicles[0].ownershipCostsIn = linked.equipment[0].id;
    assert.equal(pendingOf(computeQuote(linked), 'vehicle_ownership_costs'), null);
    assert.ok(pendingOf(computeQuote(e1SupportVehicle({ ownershipCostsIn: 'linea-borrada' })), 'vehicle_ownership_costs'));
  });

  test('sin traslados o con cantidad 0 no se pregunta', () => {
    const none = e1SupportVehicle();
    none.logistics.notApplicable = true;
    assert.equal(pendingOf(computeQuote(none), 'vehicle_ownership_costs'), null);
    assert.equal(pendingOf(computeQuote(e1SupportVehicle({ count: 0 })), 'vehicle_ownership_costs'), null);
  });

  test('ligado a una línea de Equipos que va por sus propios medios: los km se contarían dos veces', () => {
    const q = fixture('e1-cotizacion');
    const camioneta = q.equipment.find((e) => e.name === 'Equipo 2');
    assert.equal(camioneta.mobilization.mode, 'self');
    q.logistics.vehicles = [{ id: 'veh-1', name: 'Traslado del personal', count: 1, consumptionLPer100Km: 13, costPerKm: 0, ownershipCostsIn: camioneta.id }];
    const r = computeQuote(q);
    const dup = itemOf(r, 'duplicates');
    assert.equal(dup.status, 'warning');
    assert.match(dup.message, /Equipo 2/);
    assert.match(dup.message, /propios medios/);
  });

  test('las cifras no cambian por responder la pregunta (sólo es dónde está el costo)', () => {
    const a = computeQuote(e1SupportVehicle());
    const b = computeQuote(e1SupportVehicle({ ownershipCostsIn: OWNERSHIP_COSTS_PER_KM }));
    assert.equal(a.kpis.totalCost, b.kpis.totalCost);
    assert.equal(a.kpis.suggestedListRate, b.kpis.suggestedListRate);
  });
});

// ------------------------------------------------------------------ F2
/** E3 (transporte con un externo que trae chofer) + un "Chofer del camión" en Personal, sin asignar. */
function e3WithDriver() {
  const q = fixture('e3-cotizacion');
  q.labor.push({ ...q.labor[0], id: 'lab-chofer', role: 'Chofer del camión', positions: 1, basicMonthly: 1500000 });
  return q;
}
const carrierOf = (q) => q.equipment.find((e) => e.acquisition === 'outsourced');

describe('ECO-04 · VAL-01-F2: operador de Personal que el externo ya trae', () => {
  test('externo con operador + puestos sin equipo: se pregunta (para revisar); antes, "sin señales"', () => {
    const r = computeQuote(e3WithDriver());
    // Las cifras no cambian (las de main d6540b7).
    approx(r.kpis.totalCost, 42750249.75, 'costo del mes');
    assert.equal(r.kpis.suggestedListRate, 1426000);
    const dup = itemOf(r, 'duplicates');
    assert.equal(dup.status, 'warning');
    assert.match(dup.message, /Externo 1/);
    assert.match(dup.message, /Chofer del camión/);
    assert.equal(dup.focus, 'equipment.0.operatorLaborId');
    const p = pendingOf(r, 'duplicates');
    assert.equal(p.severity, 'review');
    assert.notEqual(p.unreliable, true);
  });

  test('confirmado para esos puestos: sin aviso; un puesto nuevo o renombrado vuelve a preguntar', () => {
    const q = e3WithDriver();
    carrierOf(q).operatorBySupplier = operatorSupplierSnapshot(q);
    assert.equal(itemOf(computeQuote(q), 'duplicates').status, 'ok');

    const added = structuredClone(q);
    added.labor.push({ ...added.labor[0], id: 'lab-otro', role: 'Chofer de relevo', positions: 1 });
    assert.equal(itemOf(computeQuote(added), 'duplicates').status, 'warning');

    const renamed = structuredClone(q);
    renamed.labor.find((l) => l.id === 'lab-chofer').role = 'Chofer del camión 2';
    assert.equal(itemOf(computeQuote(renamed), 'duplicates').status, 'warning');
  });

  test('asignado como operador: el aviso de siempre (operador duplicado)', () => {
    const q = e3WithDriver();
    carrierOf(q).operatorLaborId = 'lab-chofer';
    const dup = itemOf(computeQuote(q), 'duplicates');
    assert.equal(dup.status, 'warning');
    assert.match(dup.message, /Operador posiblemente duplicado/);
  });

  test('sin falsos positivos: un puesto libre que no suena a operador ("Coordinador de tráfico") no dispara la pregunta', () => {
    const r = computeQuote(fixture('e3-cotizacion'));
    assert.equal(itemOf(r, 'duplicates').status, 'ok');
    assert.equal(completenessEngine.looksLikeOperatorRole?.('Coordinador de tráfico'), false);
    for (const role of ['Chofer del camión', 'Operador de hidrogrúa', 'CONDUCTOR', 'Camionero', 'Gruista']) {
      assert.equal(completenessEngine.looksLikeOperatorRole?.(role), true, role);
    }
    for (const role of ['Ayudante', 'Supervisor', 'Rigger / ayudante', 'Coordinadora']) {
      assert.equal(completenessEngine.looksLikeOperatorRole?.(role), false, role);
    }
  });

  test('sin puestos libres o con un externo sin operador incluido, no se pregunta', () => {
    const noFree = e3WithDriver();
    noFree.labor = noFree.labor.map((l) => ({ ...l, positions: 0 }));
    assert.equal(itemOf(computeQuote(noFree), 'duplicates').status, 'ok');
    const noOperator = e3WithDriver();
    carrierOf(noOperator).external.operatorIncluded = false;
    assert.equal(itemOf(computeQuote(noOperator), 'duplicates').status, 'ok');
  });

  test('un puesto que ya opera otro equipo no cuenta como libre', () => {
    const q = fixture('e2-cotizacion');
    // E2: hidrogrúa propia operada por el "Operador de hidrogrúa"; se agrega un externo con operador.
    const operatorId = q.equipment[0].operatorLaborId;
    q.labor = q.labor.filter((l) => l.id === operatorId);
    q.equipment.push({ ...structuredClone(fixture('e3-cotizacion').equipment[0]), id: 'ext-1', operatorLaborId: null });
    assert.equal(itemOf(computeQuote(q), 'duplicates').status, 'ok');
  });
});

// ------------------------------------------------------------------ revisión (Code Review, nivel medio)
describe('ECO-04 · correcciones del Code Review', () => {
  test('dos externos con operador: preguntan los dos (no sólo el primero), y un operador asignado en otra línea no los tapa', () => {
    const q = e3WithDriver();
    const second = { ...structuredClone(carrierOf(q)), id: 'ext-2', name: 'Camión 2' };
    q.equipment.push(second);
    let r = computeQuote(q);
    assert.deepEqual(r.completeness.operatorScope.map((x) => x.index), [0, 1]);
    assert.deepEqual(pendingOf(r, 'duplicates').targets.map((t) => t.index), [0, 1]);
    // Un tercer externo con el chofer asignado (operador duplicado) no esconde la pregunta de los otros dos.
    q.labor.push({ ...q.labor[0], id: 'lab-chofer-2', role: 'Chofer 2', positions: 1 });
    q.equipment.push({ ...structuredClone(carrierOf(q)), id: 'ext-3', name: 'Camión 3', operatorLaborId: 'lab-chofer-2' });
    r = computeQuote(q);
    assert.match(itemOf(r, 'duplicates').message, /Operador posiblemente duplicado/);
    assert.deepEqual(r.completeness.operatorScope.map((x) => x.index), [0, 1]);
  });

  test('un operador asignado que ya no existe (id viejo) no cuenta como asignado', () => {
    const q = e3WithDriver();
    carrierOf(q).operatorLaborId = 'puesto-borrado';
    assert.deepEqual(computeQuote(q).completeness.operatorScope.map((x) => x.index), [0]);
  });

  test('nombres de operador: "Hidrogruista" y "Operario de grúa" sí; "Operario de limpieza" no', () => {
    const looks = completenessEngine.looksLikeOperatorRole;
    for (const role of ['Hidrogruista', 'Operario de grúa', 'Operario hidrogrúa', 'Operaria de autoelevador']) assert.equal(looks?.(role), true, role);
    for (const role of ['Operario de limpieza', 'Operario', 'Administrativa']) assert.equal(looks?.(role), false, role);
  });

  test('la guía de H-08 dice cómo cargar la línea de Equipos sin contar dos veces el traslado', () => {
    assert.match(pendingOf(computeQuote(e1SupportVehicle()), 'vehicle_ownership_costs').message, /"No requiere movilización"/);
    const q = fixture('e1-cotizacion');
    const camioneta = q.equipment.find((e) => e.name === 'Equipo 2');
    q.logistics.vehicles = [{ id: 'veh-1', name: 'Traslado', count: 1, consumptionLPer100Km: 13, costPerKm: 0, ownershipCostsIn: camioneta.id }];
    const dup = itemOf(computeQuote(q), 'duplicates');
    assert.match(dup.message, /"No requiere movilización"/);
    assert.equal(dup.focus, 'logistics.vehicles.0.ownershipCostsIn');
  });
});

// ------------------------------------------------------------------ referencias
describe('ECO-04 · las referencias nuevas viajan con la cotización', () => {
  test('desde una plantilla: el vehículo y la confirmación del operador apuntan a los ids nuevos', () => {
    const q = e3WithDriver();
    q.logistics.vehicles = [{ id: 'veh-1', name: 'Camioneta', count: 1, consumptionLPer100Km: 13, costPerKm: 0, ownershipCostsIn: carrierOf(q).id }];
    carrierOf(q).operatorBySupplier = operatorSupplierSnapshot(q);
    const template = { id: 'tpl', name: 'Plantilla', serviceType: q.serviceType, defaults: structuredClone(q) };
    const copy = createQuoteFromTemplate(template, { organizationId: 'org', settings: defaultSettings('org'), now: '2026-10-20T12:00:00.000Z' });
    const carrier = copy.equipment.find((e) => e.acquisition === 'outsourced');
    assert.notEqual(carrier.id, carrierOf(q).id);
    assert.equal(copy.logistics.vehicles[0].ownershipCostsIn, carrier.id);
    const laborIds = new Set(copy.labor.map((l) => l.id));
    assert.ok(carrier.operatorBySupplier.labor.length > 0);
    assert.ok(carrier.operatorBySupplier.labor.every((x) => laborIds.has(x.id)), 'los puestos confirmados son los de la copia');
    const r = computeQuote(copy);
    assert.equal(pendingOf(r, 'vehicle_ownership_costs'), null);
    assert.equal(itemOf(r, 'duplicates').status, 'ok');
  });

  test('"Actualizar desde Recursos" conserva la confirmación del operador (es de la cotización)', () => {
    const q = e3WithDriver();
    const service = { id: 'svc-1', name: 'Transporte', external: { ...structuredClone(carrierOf(q).external), price: 2900 } };
    const line = externalLineFromService(service, { id: 'ext-1', now: '2026-10-01T00:00:00.000Z' });
    line.operatorBySupplier = { labor: [{ id: 'lab-chofer', role: 'Chofer del camión' }] };
    const changed = { ...service, external: { ...service.external, price: 3100 } };
    const next = applyResourceUpdate('equipment', line, { externalServices: [changed] }, { now: '2026-10-20T00:00:00.000Z' });
    assert.equal(next.external.price, 3100, 'toma el valor actual del recurso');
    assert.deepEqual(next.operatorBySupplier, line.operatorBySupplier);
  });
});
