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
 * margen 2, impuestos sobre la facturación 1, standby 1 → total 23.
 */
function completeQuote() {
  const q = demoHydroCraneQuote();
  q.labor[0].peoplePerPosition = 2;
  q.rules.standbyNotApplicable = true;
  q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 5, items: [] };
  return q;
}
const TOTAL_WEIGHT = 23;

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

  test('un faltante rojo de peso 2 resta su peso completo: 21 / 23 = 91,30 %', () => {
    const q = completeQuote();
    q.finance.paymentTermDays = null;
    approx(evaluateCompleteness(q).scorePct, ((TOTAL_WEIGHT - 2) / TOTAL_WEIGHT) * 100);
  });

  test('un aviso naranja de peso 1 resta la mitad de su peso: 22,5 / 23 = 97,83 %', () => {
    const q = completeQuote();
    q.risk = { generalPct: 0, items: [] };
    approx(evaluateCompleteness(q).scorePct, ((TOTAL_WEIGHT - 0.5) / TOTAL_WEIGHT) * 100);
  });

  test('la demo hidrogrúa (sin relevo, sin standby e impuestos sin definir) tiene 3 avisos naranja: 21,5 / 23', () => {
    const r = evaluateCompleteness(demoHydroCraneQuote());
    approx(r.scorePct, (21.5 / 23) * 100);
    assert.equal(item(r, 'relief').status, 'warning');
    assert.equal(item(r, 'standby').status, 'warning');
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

  test('detecta falta de logística (distancia o vehículos); "sin traslados" la da por buena', () => {
    const noDistance = completeQuote();
    noDistance.logistics.distanceKm = 0;
    assert.equal(item(evaluateCompleteness(noDistance), 'logistics').status, 'missing');
    const noVehicles = completeQuote();
    noVehicles.logistics.vehicles = [];
    assert.equal(item(evaluateCompleteness(noVehicles), 'logistics').status, 'missing');
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

  test('detecta falta de utilización on-call (días activos estimados)', () => {
    for (const days of [0, '', null]) {
      const q = completeQuote();
      q.activity.activeDaysPerMonth = days;
      const it = item(evaluateCompleteness(q), 'utilization');
      assert.equal(it.status, 'missing', `días activos ${String(days)}`);
    }
  });

  test('detecta falta de modalidad (tipo de servicio o "conozco la tarifa / la actividad")', () => {
    const noMode = completeQuote();
    delete noMode.pricingMode;
    assert.equal(item(evaluateCompleteness(noMode), 'modality').status, 'missing');
    const badType = completeQuote();
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

  test('on-call sin standby definido → aviso; con tarifa de standby → ok', () => {
    const q = completeQuote();
    q.rules.standbyNotApplicable = false;
    q.rules.standbyRatePerDay = 0;
    assert.equal(item(evaluateCompleteness(q), 'standby').status, 'warning');
    q.rules.standbyRatePerDay = 800_000;
    assert.equal(item(evaluateCompleteness(q), 'standby').status, 'ok');
  });

  test('sin personal cargado → falta personal; en "equipo sin operador" no se exige personal', () => {
    const q = completeQuote();
    q.labor = [];
    assert.equal(item(evaluateCompleteness(q), 'labor').status, 'missing');
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
  test('sin definir → aviso naranja de peso 1 (la tarifa piso no los incluye)', () => {
    const q = completeQuote();
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: null, items: [] };
    const r = evaluateCompleteness(q);
    const i = item(r, 'billing_taxes');
    assert.equal(i.status, 'warning');
    assert.equal(i.weight, 1);
    assert.equal(i.step, 'margin');
    assert.match(i.message, /tarifa piso no incluye/);
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
