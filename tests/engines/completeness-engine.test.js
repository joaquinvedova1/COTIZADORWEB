/**
 * Contrato del negocio — CompletenessEngine (Cost Completeness Score).
 *
 * Reglas (Prompt 1 "Cost Completeness Score", Prompt 3 "Cost Completeness Score"):
 *   Reglas determinísticas que detectan: falta plazo de pago, combustible sin responsable,
 *   falta responsable de materiales, falta costo de equipo, falta logística, falta
 *   contingencia, falta margen, falta utilización on-call, falta modalidad (y relevos, standby).
 *   ok (verde) suma el peso completo, warning (naranja) la mitad, missing (rojo) 0.
 *   score % = Σ peso obtenido / Σ peso aplicable × 100. Todo OK → 100 %.
 *   Debajo de 60 % la cotización se considera con riesgo (pueden faltar costos).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteness, COMPLETENESS_RISK_THRESHOLD } from '../../js/engines/completeness-engine.js';
import { demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { service, person, owned, external, material, resetIds } from '../lab/lib/build.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/**
 * Cotización on-call completa: demo hidrogrúa + relevo configurado + standby definido
 * + impuestos sobre la facturación definidos (% sintético).
 * Reglas aplicables (peso): modalidad 2, utilización 2, personal 2, relevos 1, equipos 2,
 * combustible 2, materiales 2, logística 2, estructura 1, plazo de pago 2, contingencia 1,
 * margen 2, impuestos sobre la facturación 1 → 22; más PLAN-2026-005:
 * movilización de equipos 1, costos duplicados 1, fecha base 1, antigüedad de las
 * bases 1 → total 26. Standby (tanda novatos 2026-11) sólo participa con días de espera
 * cargados o una tarifa: "no aplica" o sin días ni tarifa no es un pendiente.
 */
function completeQuote() {
  const q = demoHydroCraneQuote();
  // Desde 0.10.1 la demo no tiene guardia; estas reglas se prueban con un servicio 24/7 (relevos).
  q.activity.availability = '24/7';
  q.labor[0].peoplePerPosition = 2;
  q.rules.standbyNotApplicable = true;
  q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 5, items: [] };
  return q;
}
const TOTAL_WEIGHT = 26;

const item = (result, id) => result.items.find((i) => i.id === id);

describe('CompletenessEngine — puntaje', () => {
  test('cotización completa → 100 % y sin pendientes', () => {
    const r = evaluateCompleteness(completeQuote());
    approx(r.scorePct, 100);
    assert.equal(r.pending.length, 0);
    assert.equal(r.counts.missing, 0);
    assert.equal(r.counts.warning, 0);
    assert.ok(r.items.every((i) => i.color === 'green'));
  });

  test('un faltante rojo de peso 2 resta su peso completo: 24 / 26 = 92,31 %', () => {
    const q = completeQuote();
    q.finance.paymentTermDays = null;
    approx(evaluateCompleteness(q).scorePct, ((TOTAL_WEIGHT - 2) / TOTAL_WEIGHT) * 100);
  });

  test('un aviso naranja de peso 1 resta la mitad de su peso: 25,5 / 26 = 98,08 %', () => {
    const q = completeQuote();
    q.risk = { generalPct: 0, items: [] };
    approx(evaluateCompleteness(q).scorePct, ((TOTAL_WEIGHT - 0.5) / TOTAL_WEIGHT) * 100);
  });

  test('la demo hidrogrúa (sin guardia desde 0.10.1, impuestos sin definir) tiene 1 aviso naranja: 24,5 / 25', () => {
    const r = evaluateCompleteness(demoHydroCraneQuote());
    // Sin guardia 24/7 no aplica la regla de relevos (peso 1): 25 de peso total.
    approx(r.scorePct, (24.5 / 25) * 100);
    assert.equal(item(r, 'relief'), undefined);
    // Bases definidas (ILUSTRATIVAS), equipos movilizados y sin duplicados.
    for (const id of ['mobility', 'duplicates', 'economic_base', 'base_age']) assert.equal(item(r, id).status, 'ok', id);
    // Sin días de espera ni tarifa, el standby no es un pendiente (tanda novatos 2026-11).
    assert.equal(item(r, 'standby'), undefined);
    assert.equal(item(r, 'billing_taxes').status, 'warning');
  });

  test('pendientes ordenados: primero rojos (missing), después naranjas (warning)', () => {
    const q = completeQuote();
    q.risk = { generalPct: 0, items: [] };
    q.finance.paymentTermDays = null;
    const r = evaluateCompleteness(q);
    assert.deepEqual(r.pending.map((p) => p.status), ['missing', 'warning']);
    assert.deepEqual(r.pending.map((p) => p.id), ['payment_term', 'contingency']);
  });

  test('umbral de riesgo: 60 %; una cotización nueva vacía queda debajo del umbral', () => {
    assert.equal(COMPLETENESS_RISK_THRESHOLD, 60);
    const r = evaluateCompleteness(createEmptyQuote({ id: 'q', now: '2026-01-01T00:00:00.000Z' }));
    assert.ok(r.scorePct < COMPLETENESS_RISK_THRESHOLD, `puntaje ${r.scorePct}`);
  });

  test('es determinístico y nunca devuelve NaN, aun con una cotización vacía', () => {
    for (const q of [{}, undefined, { labor: null, equipment: 'x', materials: 5 }]) {
      const r = evaluateCompleteness(q);
      assert.ok(Number.isFinite(r.scorePct));
      assert.ok(r.scorePct >= 0 && r.scorePct <= 100);
    }
    assert.deepEqual(evaluateCompleteness(completeQuote()), evaluateCompleteness(completeQuote()));
  });
});

describe('CompletenessEngine — detecciones obligatorias', () => {
  test('detecta falta de plazo de pago (vacío o null); 0 días es un plazo válido', () => {
    for (const term of [null, '', undefined]) {
      const q = completeQuote();
      q.finance.paymentTermDays = term;
      const it = item(evaluateCompleteness(q), 'payment_term');
      assert.equal(it.status, 'missing', `plazo ${String(term)}`);
      assert.equal(it.color, 'red');
    }
    const zero = completeQuote();
    zero.finance.paymentTermDays = 0;
    assert.equal(item(evaluateCompleteness(zero), 'payment_term').status, 'ok');
  });

  test('detecta combustible sin responsable', () => {
    const q = completeQuote();
    q.fuel.providedBy = null;
    const it = item(evaluateCompleteness(q), 'fuel');
    assert.equal(it.status, 'missing');
    assert.match(it.message, /responsable/i);
  });

  test('detecta combustible a nuestro cargo sin precio; si lo provee el cliente no hace falta precio', () => {
    const q = completeQuote();
    q.fuel = { providedBy: 'contractor', pricePerLiter: 0 };
    assert.equal(item(evaluateCompleteness(q), 'fuel').status, 'missing');
    q.fuel = { providedBy: 'client', pricePerLiter: 0 };
    assert.equal(item(evaluateCompleteness(q), 'fuel').status, 'ok');
  });

  test('detecta materiales sin responsable (quién los provee)', () => {
    const q = completeQuote();
    q.materials[0].providedBy = null;
    const it = item(evaluateCompleteness(q), 'materials');
    assert.equal(it.status, 'missing');
  });

  test('sin materiales cargados avisa (naranja); "no usa materiales" lo da por bueno', () => {
    const q = completeQuote();
    q.materials = [];
    assert.equal(item(evaluateCompleteness(q), 'materials').status, 'warning');
    q.materialsNotApplicable = true;
    assert.equal(item(evaluateCompleteness(q), 'materials').status, 'ok');
  });

  test('detecta falta de costo de equipo: sin valor de reposición, sin vida útil o sin equipos en un servicio con equipos', () => {
    const noValue = completeQuote();
    noValue.equipment[0].replacementValue = 0;
    assert.equal(item(evaluateCompleteness(noValue), 'equipment_cost').status, 'missing');
    const noLife = completeQuote();
    noLife.equipment[1].usefulLifeYears = 0;
    assert.equal(item(evaluateCompleteness(noLife), 'equipment_cost').status, 'missing');
    const none = completeQuote();
    none.equipment = [];
    assert.equal(item(evaluateCompleteness(none), 'equipment_cost').status, 'missing');
  });

  test('detecta falta de logística (distancia o cómo se llega); "sin traslados" la da por buena', () => {
    const noDistance = completeQuote();
    noDistance.logistics.distanceKm = 0;
    assert.equal(item(evaluateCompleteness(noDistance), 'logistics').status, 'missing');
    // Sin vehículos auxiliares y sin equipos que se movilicen: falta cómo se llega.
    const noVehicles = completeQuote();
    noVehicles.logistics.vehicles = [];
    noVehicles.equipment.forEach((e) => { e.mobilization.mode = null; });
    assert.equal(item(evaluateCompleteness(noVehicles), 'logistics').status, 'missing');
    // La demo no tiene vehículos auxiliares: sus equipos van por sus propios medios.
    assert.equal(item(evaluateCompleteness(completeQuote()), 'logistics').status, 'ok');
    const na = completeQuote();
    na.logistics.notApplicable = true;
    assert.equal(item(evaluateCompleteness(na), 'logistics').status, 'ok');
  });

  test('detecta falta de contingencia (general 0 y sin ítems de riesgo habilitados)', () => {
    const q = completeQuote();
    q.risk = { generalPct: 0, items: q.risk.items.map((i) => ({ ...i, enabled: false })) };
    const it = item(evaluateCompleteness(q), 'contingency');
    assert.equal(it.status, 'warning');
    assert.equal(it.color, 'orange');
  });

  test('detecta falta de margen (vacío → rojo; 0 % → naranja: cotizás sin ganancia)', () => {
    for (const blank of ['', null, undefined]) {
      const q = completeQuote();
      q.pricing.targetMarginPct = blank;
      assert.equal(item(evaluateCompleteness(q), 'margin').status, 'missing', `margen ${String(blank)}`);
    }
    const zero = completeQuote();
    zero.pricing.targetMarginPct = 0;
    assert.equal(item(evaluateCompleteness(zero), 'margin').status, 'warning');
  });

  test('un margen objetivo inválido (≥ 100 %) no se da por definido (el motor no puede usarlo)', () => {
    for (const invalid of [100, 150]) {
      const q = completeQuote();
      q.pricing.targetMarginPct = invalid;
      assert.notEqual(item(evaluateCompleteness(q), 'margin').status, 'ok', `margen ${invalid} %`);
    }
  });

  test('detecta falta de utilización on-call (días de trabajo estimados)', () => {
    for (const days of [0, '', null]) {
      const q = completeQuote();
      q.activity.activeDaysPerMonth = days;
      const it = item(evaluateCompleteness(q), 'utilization');
      assert.equal(it.status, 'missing', `días de trabajo ${String(days)}`);
    }
  });

  test('detecta falta de modalidad (tipo de servicio o "conozco la tarifa / la actividad")', () => {
    const noMode = completeQuote();
    delete noMode.pricingMode;
    assert.equal(item(evaluateCompleteness(noMode), 'modality').status, 'missing');
    const badType = completeQuote();
    // El tipo de servicio sólo cuenta en una cotización anterior (sin contrato); la demo tiene contrato desde 0.10.1.
    delete badType.contract;
    badType.serviceType = 'inexistente';
    assert.equal(item(evaluateCompleteness(badType), 'modality').status, 'missing');
  });

  test('"conozco la tarifa" sin tarifa ingresada → falta la tarifa', () => {
    const q = completeQuote();
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 0;
    assert.equal(item(evaluateCompleteness(q), 'rate').status, 'missing');
    q.pricing.knownRate = 2_500_000;
    assert.equal(item(evaluateCompleteness(q), 'rate').status, 'ok');
  });

  test('cobertura 24/7 con una sola persona por posición → aviso de relevos', () => {
    const q = completeQuote();
    q.labor[0].peoplePerPosition = 1;
    assert.equal(item(evaluateCompleteness(q), 'relief').status, 'warning');
  });

  test('on-call: sin días de espera no es pendiente; con días y sin tarifa → aviso; con tarifa → ok', () => {
    const q = completeQuote();
    q.rules.standbyNotApplicable = false;
    q.rules.standbyRatePerDay = 0;
    q.rules.standbyDaysPerMonth = 0;
    assert.equal(item(evaluateCompleteness(q), 'standby'), undefined);
    q.rules.standbyDaysPerMonth = 3;
    assert.equal(item(evaluateCompleteness(q), 'standby').status, 'warning');
    q.rules.standbyRatePerDay = 800_000;
    assert.equal(item(evaluateCompleteness(q), 'standby').status, 'ok');
  });

  test('sin personal cargado → falta personal; en "equipo sin operador" no se exige personal', () => {
    const q = completeQuote();
    q.labor = [];
    assert.equal(item(evaluateCompleteness(q), 'labor').status, 'missing');
    // Cotización anterior (sin contrato): el tipo de servicio dice si lleva personal.
    delete q.contract;
    q.serviceType = 'equipment_only';
    assert.equal(item(evaluateCompleteness(q), 'labor'), undefined);
  });

  test('sin absorción de estructura → aviso naranja', () => {
    const q = completeQuote();
    q.indirect = { method: 'percent_direct', pct: 0, amount: 0 };
    assert.equal(item(evaluateCompleteness(q), 'structure').status, 'warning');
  });
});

describe('CompletenessEngine — impuestos sobre lo que facturás (PLAN-2026-002)', () => {
  test('sin definir → aviso naranja de peso 1 (la tarifa mínima no los incluye)', () => {
    const q = completeQuote();
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: null, items: [] };
    const r = evaluateCompleteness(q);
    const i = item(r, 'billing_taxes');
    assert.equal(i.status, 'warning');
    assert.equal(i.weight, 1);
    assert.equal(i.step, 'margin');
    assert.match(i.message, /tarifa mínima no incluye/);
    approx(r.scorePct, ((TOTAL_WEIGHT - 0.5) / TOTAL_WEIGHT) * 100);
  });

  test('datos viejos sin el campo → sin definir (aviso), nunca un error', () => {
    const q = completeQuote();
    delete q.billingTaxes;
    assert.equal(item(evaluateCompleteness(q), 'billing_taxes').status, 'warning');
  });

  test('"No incluir impuestos sobre la facturación en esta cotización" → ok', () => {
    const q = completeQuote();
    q.billingTaxes = { mode: 'combined', notApplicable: true, combinedPct: null, items: [] };
    assert.equal(item(evaluateCompleteness(q), 'billing_taxes').status, 'ok');
  });

  test('detalle por impuesto con al menos un % cargado → ok; 0 % explícito también es una decisión', () => {
    const q = completeQuote();
    q.billingTaxes = { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'gross_income', label: 'Ingresos Brutos', pct: 0 }] };
    assert.equal(item(evaluateCompleteness(q), 'billing_taxes').status, 'ok');
  });

  test('un % inválido (negativo o total ≥ 100) → rojo', () => {
    const q = completeQuote();
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: -1, items: [] };
    assert.equal(item(evaluateCompleteness(q), 'billing_taxes').status, 'missing');
    q.billingTaxes = { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'other', label: 'x', pct: 60 }, { id: 'b', kind: 'other', label: 'y', pct: 40 }] };
    assert.equal(item(evaluateCompleteness(q), 'billing_taxes').status, 'missing');
  });

  test('margen + impuestos ≥ 100 % → el margen no se da por definido (rojo)', () => {
    const q = completeQuote();
    q.pricing.targetMarginPct = 60;
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 40, items: [] };
    const i = item(evaluateCompleteness(q), 'margin');
    assert.equal(i.status, 'missing');
    assert.match(i.message, /menor a 60 %/);
  });
});

describe('V-04 · Horas de trabajo por día y equipos por hora (equipment_hours)', () => {
  const quoteWith = (hoursPerActiveDay, equipment) => {
    resetIds();
    return service({
      serviceType: 'per_unit', unit: 'ha',
      activity: { billableQuantityPerMonth: 100, unitsPerActiveDay: 10, hoursPerActiveDay },
      labor: [person()],
      equipment,
    });
  };
  const found = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'equipment_hours');

  test('horas vacías y equipo propio con costo por hora y sin horas propias: falta, con foco en las horas', () => {
    for (const hours of [null, '', 0]) {
      const i = found(quoteWith(hours, [owned({ name: 'Camión', fuelLitersPerHour: 12, maintenancePerHour: 3000 })]));
      assert.ok(i, `horas ${JSON.stringify(hours)}`);
      assert.equal(i.status, 'missing');
      assert.equal(i.step, 'modality');
      assert.equal(i.focus, 'activity.hoursPerActiveDay');
      assert.equal(i.message, 'Faltan las horas de trabajo por día: sin ese dato no se suma el uso de "Camión".');
    }
    const withRule = evaluateCompleteness(quoteWith(null, [owned({ name: 'Camión', fuelLitersPerHour: 12 })]));
    const without = evaluateCompleteness(quoteWith(9, [owned({ name: 'Camión', fuelLitersPerHour: 12 })]));
    assert.ok(withRule.scorePct < without.scorePct, 'baja la completitud');
  });

  test('no salta si el equipo tiene horas propias, si no tiene costo por hora o si las horas están cargadas', () => {
    assert.equal(found(quoteWith(null, [owned({ name: 'Camión', fuelLitersPerHour: 12, hoursPerActiveDay: 6 })])), undefined);
    assert.equal(found(quoteWith(null, [owned({ name: 'Trailer' })])), undefined);
    assert.equal(found(quoteWith(9, [owned({ name: 'Camión', fuelLitersPerHour: 12 })])), undefined);
    assert.equal(found(quoteWith(null, [])), undefined);
  });

  test('externo por hora: lo avisa "Horas del proveedor" (una sola vez); con mínimo facturable, esta regla', () => {
    const plain = evaluateCompleteness(quoteWith(null, [external({ name: 'Minibús' }, { price: 50_000, unit: 'hour' })]));
    assert.ok(plain.items.find((i) => i.id === 'external_hours'));
    assert.equal(plain.items.find((i) => i.id === 'equipment_hours'), undefined);
    const withMinimum = found(quoteWith(null, [external({ name: 'Minibús' }, { price: 50_000, unit: 'hour', minimumUnits: 4 })]));
    assert.ok(withMinimum);
    assert.match(withMinimum.message, /"Minibús"/);
  });

  test('PLAN-2026-026: las "Horas al 50 % / 100 % por mes" del puesto cuentan como horas cubiertas', () => {
    resetIds();
    const base = { unit: 'day', activity: { activeDaysPerMonth: 26, hoursPerActiveDay: 8 } };
    const short = evaluateCompleteness(service({ ...base, labor: [person({ positions: 1, normalHoursPerMonth: 176 })] })).items.find((i) => i.id === 'labor_hours');
    assert.ok(short, 'sin horas extra cargadas faltan 32 h');
    resetIds();
    const covered = evaluateCompleteness(service({ ...base, labor: [person({ positions: 1, normalHoursPerMonth: 176, overtime50HoursPerMonth: 20, overtime100HoursPerMonth: 12 })] })).items.find((i) => i.id === 'labor_hours');
    assert.equal(covered, undefined);
  });

  test('los avisos de horas del personal dicen dónde corregir las horas por día del servicio', () => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10 }, labor: [person({ positions: 1, coverageHoursPerDay: 8 })] });
    const gap = evaluateCompleteness(q).items.find((i) => i.id === 'labor_day_gap');
    assert.ok(gap);
    assert.match(gap.message, /Si el servicio no pide 10 h por día, corregilo en "Cómo se cobra"\.$/);
    resetIds();
    const q2 = service({ unit: 'day', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10 }, labor: [person({ positions: 1 })] });
    const hours = evaluateCompleteness(q2).items.find((i) => i.id === 'labor_hours');
    assert.ok(hours);
    assert.match(hours.message, /Si el servicio no pide 10 h por día, corregilo en "Cómo se cobra"\.$/);
  });
});

describe('V-11 · % de dedicación que quedó viejo (dedication_stale)', () => {
  const sharedQuote = (days, hours, pct) => {
    resetIds();
    const q = service({ unit: 'day', activity: { activeDaysPerMonth: days, hoursPerActiveDay: hours }, labor: [person({ normalHoursPerMonth: 176, assignment: 'shared', fixedCostSharePct: pct })] });
    q.contract = { mode: 'on_demand', components: ['labor'] };
    return q;
  };
  const found = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'dedication_stale');

  test('salta con 71,6 % cargado y 100 % propuesto (22 días × 8 h)', () => {
    const i = found(sharedQuote(22, 8, 71.6));
    assert.ok(i);
    assert.equal(i.status, 'warning');
    assert.equal(i.step, 'modality');
    assert.equal(i.focus, 'labor.0.fixedCostSharePct');
    assert.equal(i.message, 'El % cargado (71,6 %) ya no coincide con los días y horas de ahora (100 %).');
  });

  test('no salta con 71,6 cargado y 71,6 propuesto (14 días × 9 h), ni con una diferencia de hasta 5 puntos', () => {
    assert.equal(found(sharedQuote(14, 9, 71.6)), undefined);
    assert.equal(found(sharedQuote(14, 9, 75)), undefined);
    assert.ok(found(sharedQuote(14, 9, 80)));
  });

  test('no salta sin líneas compartidas, sin días cargados ni en un fijo mensual', () => {
    const dedicated = sharedQuote(22, 8, 71.6);
    dedicated.labor[0].assignment = 'dedicated';
    assert.equal(found(dedicated), undefined);
    assert.equal(found(sharedQuote(null, 8, 71.6)), undefined);
    const monthly = sharedQuote(22, 8, 71.6);
    monthly.contract = { mode: 'monthly', components: ['labor'] };
    monthly.unit = 'month';
    assert.equal(found(monthly), undefined);
  });
});

describe('V-06 · Vehículo propio sin seguro ni patente (equipment_insurance)', () => {
  const quoteWith = (equipment) => {
    resetIds();
    return service({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()], equipment });
  };
  const found = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'equipment_insurance');
  const self = { mode: 'self', travelLitersPer100Km: 12, travelCostPerKm: 100, driver: 'operator' };

  test('salta para un vehículo que se traslada por sus propios medios con seguro y patente en 0', () => {
    const i = found(quoteWith([owned({ name: 'Generador' }), owned({ name: 'Pickup', mobilization: self })]));
    assert.ok(i);
    assert.equal(i.status, 'warning');
    assert.equal(i.step, 'equipment');
    assert.equal(i.focus, 'equipment.1.insuranceAnnual');
    assert.equal(i.message, '"Pickup" no tiene seguro ni patente cargados. Si los pagás, cargalos: son costo aunque no trabaje.');
  });

  test('no salta con uno de los dos cargado, para un equipo que no circula, sin valor de reposición ni para un alquilado', () => {
    assert.equal(found(quoteWith([owned({ name: 'Pickup', mobilization: self, insuranceAnnual: 900_000 })])), undefined);
    assert.equal(found(quoteWith([owned({ name: 'Pickup', mobilization: self, licenseAnnual: 300_000 })])), undefined);
    assert.equal(found(quoteWith([owned({ name: 'Generador' })])), undefined);
    assert.equal(found(quoteWith([owned({ name: 'Trailer', mobilization: { mode: 'towed' } })])), undefined);
    assert.equal(found(quoteWith([owned({ name: 'Pickup', mobilization: self, replacementValue: 0 })])), undefined);
    assert.equal(found(quoteWith([external({ name: 'Camioneta alquilada', mobilization: self }, { price: 100_000, unit: 'day' })])), undefined);
  });

  test('no cambia el precio: sólo baja la completitud', () => {
    const a = evaluateCompleteness(quoteWith([owned({ name: 'Pickup', mobilization: self })]));
    const b = evaluateCompleteness(quoteWith([owned({ name: 'Pickup', mobilization: self, insuranceAnnual: 1 })]));
    assert.ok(a.scorePct < b.scorePct);
  });
});

describe('V-07 · Insumos "por unidad producida" (materials_output_mismatch, materials_output_unit)', () => {
  const herbicide = (o = {}) => material({ description: 'Herbicida', basis: 'per_output', quantity: 2, unitCost: 30_000, ...o });
  const byHectare = (perDay, line) => {
    resetIds();
    return service({ unit: 'custom', unitName: 'hectárea', activity: { billableQuantityPerMonth: 60, unitsPerActiveDay: perDay, hoursPerActiveDay: 8 }, labor: [person()], materials: [line] });
  };
  const byTime = (unit, line) => {
    resetIds();
    return service({ unit, activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()], materials: [line] });
  };
  const find = (q, id) => evaluateCompleteness(q).items.find((i) => i.id === id);

  test('4 hectáreas por día en la línea y 6 en "Cómo se cobra": avisa y lleva al campo de la línea', () => {
    const i = find(byHectare(6, herbicide({ outputPerActiveDay: 4 })), 'materials_output_mismatch');
    assert.ok(i);
    assert.equal(i.status, 'warning');
    assert.equal(i.step, 'materials');
    assert.equal(i.focus, 'materials.0.outputPerActiveDay');
    assert.equal(i.message, '"Herbicida" usa 4 hectáreas por día y en "Cómo se cobra" cargaste 6. Dejá un solo número: borrá el de acá para que siga al otro.');
  });

  test('no avisa con la línea vacía, con el mismo número ni con otra unidad producida', () => {
    assert.equal(find(byHectare(6, herbicide()), 'materials_output_mismatch'), undefined);
    assert.equal(find(byHectare(6, herbicide({ outputPerActiveDay: 6 })), 'materials_output_mismatch'), undefined);
    assert.equal(find(byHectare(6, herbicide({ outputUnit: 'm²', outputPerActiveDay: 4 })), 'materials_output_mismatch'), undefined);
    assert.equal(find(byHectare(6, herbicide()), 'materials_output_unit'), undefined);
  });

  test('cobrando por día sin unidad escrita: avisa que cuenta 1 por día; por hora, las horas por día', () => {
    const d = find(byTime('day', herbicide()), 'materials_output_unit');
    assert.ok(d);
    assert.equal(d.status, 'warning');
    assert.equal(d.focus, 'materials.0.outputUnit');
    assert.equal(d.message, '"Herbicida" está por unidad producida y cobrás por día: se cuenta 1 por día. Si es por hectárea, válvula o metro, escribí la unidad y cuántas hacés por día.');
    const h = find(byTime('hour', herbicide()), 'materials_output_unit');
    assert.match(h.message, /cobrás por hora: se cuenta 8 por día/);
  });

  test('no avisa con unidad o rendimiento escritos, ni para otra base o un insumo del cliente', () => {
    assert.equal(find(byTime('day', herbicide({ outputUnit: 'hectárea', outputPerActiveDay: 4 })), 'materials_output_unit'), undefined);
    assert.equal(find(byTime('day', herbicide({ outputPerActiveDay: 4 })), 'materials_output_unit'), undefined);
    assert.equal(find(byTime('day', herbicide({ basis: 'per_active_day' })), 'materials_output_unit'), undefined);
    assert.equal(find(byTime('day', herbicide({ providedBy: 'client' })), 'materials_output_unit'), undefined);
  });

  test('falta la producción y la línea sigue a la unidad de cobro: el pendiente lleva a "Cómo se cobra"', () => {
    const i = find(byHectare(null, herbicide()), 'materials_output');
    assert.ok(i);
    assert.equal(i.focus, 'activity.unitsPerActiveDay');
    assert.match(i.message, /cargalo en "Cómo se cobra"\.$/);
    const other = find(byHectare(6, herbicide({ outputUnit: 'm²' })), 'materials_output');
    assert.equal(other.focus, 'materials.0.outputPerActiveDay');
    assert.match(other.message, /hasta cargarlo no suma costo\.$/);
  });
});

describe('V-10 · Días por trabajo vacíos en unidades por evento', () => {
  const byJob = (unit, daysPerActivation, extra = {}) => {
    resetIds();
    return service({ unit, activity: { billableQuantityPerMonth: 4, daysPerActivation, hoursPerActiveDay: 8 }, labor: [person()], ...extra });
  };
  const util = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'utilization');

  test('por llamado con los días vacíos o en 0: falta, lleva al campo y dice que se calcula con 1 día', () => {
    [null, '', 0].forEach((empty) => {
      const i = util(byJob('call', empty));
      assert.equal(i.status, 'missing');
      assert.equal(i.focus, 'activity.daysPerActivation');
      assert.equal(i.message, 'Faltan los días que lleva cada llamado: se está calculando con 1 día.');
    });
  });

  test('por trabajo dice "trabajo"', () => {
    assert.equal(util(byJob('job', null)).message, 'Faltan los días que lleva cada trabajo: se está calculando con 1 día.');
  });

  test('con los días cargados está completo; sin la cantidad, primero se pide la cantidad', () => {
    assert.equal(util(byJob('call', 3)).status, 'ok');
    assert.equal(util(byJob('call', 0.5)).status, 'ok');
    const noQty = byJob('call', null);
    noQty.activity.billableQuantityPerMonth = null;
    assert.equal(util(noQty).focus, 'activity.billableQuantityPerMonth');
  });

  test('no aplica a las unidades por cantidad', () => {
    resetIds();
    const q = service({ unit: 'custom', unitName: 'pozo', activity: { billableQuantityPerMonth: 4, unitsPerActiveDay: 1, daysPerActivation: null }, labor: [person()] });
    assert.equal(util(q).status, 'ok');
  });
});

describe('V-13 · Mínimo por llamado en km: la ruta se compara con los km trabajados', () => {
  const byKm = (quantity, minimumCallUnits, tripsPerActivation = 1) => {
    resetIds();
    return service({
      serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: quantity, unitsPerActiveDay: 240, daysPerActivation: 1 },
      labor: [person()],
      equipment: [external({ name: 'Camión' }, { price: 1100, unit: 'km' })],
      logistics: { notApplicable: false, distanceKm: 120, roundTrip: true, tripsPerActivation, vehicles: [] },
      rules: { minimumCallUnits },
    });
  };
  const found = (q) => evaluateCompleteness(q).items.find((i) => i.id === 'route_consistency');

  test('240 km por día y mínimo 300: sin pendiente con 2.880 km y con 3.600 km', () => {
    assert.equal(found(byKm(2880, 300)), undefined);
    assert.equal(found(byKm(3600, 300)), undefined);
    assert.equal(evaluateCompleteness(byKm(3600, 300)).scorePct, evaluateCompleteness(byKm(3600, 0)).scorePct);
  });

  test('sigue avisando si la ruta recorre menos km que los trabajados, con y sin mínimo', () => {
    const withMin = found(byKm(3600, 300, 0.5));
    assert.ok(withMin);
    assert.match(withMin.message, /^Hacés 2\.880 km por mes pero la ruta recorre 1\.440 km/);
    const noMin = found(byKm(3600, 0, 0.5));
    assert.match(noMin.message, /^Facturás 3\.600 km por mes pero la ruta recorre 1\.800 km/);
  });
});

describe('CompletenessEngine — "¿Quién maneja?" es opcional (V-22)', () => {
  test('equipo que llega por sus medios sin conductor elegido: sin pendiente de movilización', () => {
    resetIds();
    const q = service({
      unit: 'day', activity: { activeDaysPerMonth: 10, daysPerActivation: 1 }, labor: [person()],
      equipment: [owned({ fuelLitersPerHour: 5, mobilization: { mode: 'self', travelLitersPer100Km: 12, travelCostPerKm: 80, driver: null } })],
      logistics: { notApplicable: false, distanceKm: 80, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
    const r = evaluateCompleteness(q);
    assert.equal(item(r, 'mobility').status, 'ok');
    assert.ok(!r.items.some((i) => /quién maneja/i.test(i.message)));
  });
});
