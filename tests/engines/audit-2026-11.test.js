/**
 * Auditoría 2026-11 (simulaciones de servicios reales por unidad):
 * válvulas, END, pozos, transporte por km / viaje / m³, horas con mínimo.
 * Cada bug corregido deja un test que impide que vuelva (AGENTS.md §10).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { effectiveRoundingStep, suggestedRateRound, commercialRound } from '../../js/engines/pricing-engine.js';
import { pluralizeUnit } from '../../js/domain/billing-units.js';
import { activationPaceText } from '../../js/ui/unit-text.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { service, person, external, vehicle, material, resetIds } from '../lab/lib/build.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

describe('redondeo de la tarifa sugerida acotado al 1 % (unidades baratas)', () => {
  test('el paso de $ 1.000 no convierte 100 $/kg en 1.000 $/kg', () => {
    assert.equal(effectiveRoundingStep(100.23, 1000), 1);
    assert.equal(suggestedRateRound(100.23, 1000), 101);
    assert.equal(effectiveRoundingStep(8474, 1000), 10);
    assert.equal(suggestedRateRound(8474, 1000), 8480);
  });
  test('tarifas por día grandes: el paso configurado no cambia', () => {
    assert.equal(effectiveRoundingStep(4_444_444.44, 1000), 1000);
    assert.equal(suggestedRateRound(4_444_444.44, 1000), 4_445_000);
    assert.equal(suggestedRateRound(1234.56, 0), 1234.56);
    assert.equal(suggestedRateRound(null, 1000), null);
  });
  test('nunca baja del objetivo y deja el margen cerca del buscado (servicio $/kg)', () => {
    resetIds();
    const q = service({
      serviceType: 'per_unit', unit: 'kg',
      activity: { billableQuantityPerMonth: 180000, unitsPerActiveDay: 12000, daysPerActivation: 1, hoursPerActiveDay: 8 },
      labor: [person({ positions: 2, basicMonthly: 1500000 })],
    });
    const r = computeQuote(q, { settings: {} });
    assert.ok(r.kpis.suggestedListRate >= r.kpis.targetListRate);
    assert.ok(r.kpis.suggestedListRate <= r.kpis.targetListRate * 1.0101, `${r.kpis.suggestedListRate} vs ${r.kpis.targetListRate}`);
  });
  test('commercialRound (productos) respeta el paso elegido', () => {
    assert.equal(commercialRound(492.86, 50), 500);
  });
});

describe('varias intervenciones por día (días por intervención < 1)', () => {
  test('válvulas: 160 por mes, 8 por día, 3 intervenciones por día → 20 días y 60 intervenciones', () => {
    resetIds();
    const q = service({
      serviceType: 'per_unit', unit: 'piece',
      activity: { billableQuantityPerMonth: 160, unitsPerActiveDay: 8, daysPerActivation: 1 / 3, hoursPerActiveDay: 9 },
      labor: [person({ positions: 2 }), person({ role: 'Técnico HSE' })],
      materials: [material({ description: 'Precintos', basis: 'per_activation', quantity: 1, unitCost: 20000 })],
    });
    const r = computeQuote(q, { settings: {} });
    close(r.kpis.activeDays, 20);
    close(r.activity.activationsPerMonth, 60);
    close(r.kpis.billableQuantity, 160);
  });
  test('el ritmo se lee "3 intervenciones por día" (no "0,33 días")', () => {
    const T = activationTerms({ serviceType: 'per_unit', unit: 'piece' });
    assert.equal(activationPaceText(1 / 3, T), '3 intervenciones por día');
    assert.equal(activationPaceText(2, T), '2 días por intervención');
  });
  test('aviso: menos de una unidad por intervención (medio pozo) cuenta la movilización de más', () => {
    resetIds();
    const q = service({
      serviceType: 'per_unit', unit: 'well',
      activity: { billableQuantityPerMonth: 10, unitsPerActiveDay: 0.5, daysPerActivation: 1, hoursPerActiveDay: 10 },
      labor: [person()],
    });
    const r = computeQuote(q, { settings: {} });
    assert.ok(r.issues.some((i) => i.path === 'activity.daysPerActivation' && /cargá 2 días/.test(i.message)), JSON.stringify(r.issues.map((i) => i.message)));
    q.activity.daysPerActivation = 2;
    const ok = computeQuote(q, { settings: {} });
    assert.ok(!ok.issues.some((i) => i.path === 'activity.daysPerActivation'));
  });
  test('aviso: mínimo diario de un alquiler cobrado en cada una de varias intervenciones por día', () => {
    resetIds();
    const q = service({
      serviceType: 'per_unit', unit: 'piece',
      activity: { billableQuantityPerMonth: 160, unitsPerActiveDay: 8, daysPerActivation: 1 / 3, hoursPerActiveDay: 9 },
      labor: [person()],
      equipment: [external({ name: 'Torquímetro', acquisition: 'rented' }, { unit: 'day', price: 50000, minimumUnits: 1 })],
    });
    const r = computeQuote(q, { settings: {} });
    assert.ok(r.issues.some((i) => /Torquímetro/.test(i.message) && /CADA intervención/.test(i.message)));
  });
});

describe('transporte $/viaje con "cada salida completa": no se costean viajes que no se hacen', () => {
  test('26 viajes, 2 por día, 2 días por salida (6,5 salidas): el redondeo suma sólo peajes y viáticos', () => {
    resetIds();
    const build = (full) => service({
      serviceType: 'transport', unit: 'trip',
      activity: { billableQuantityPerMonth: 26, unitsPerActiveDay: 2, daysPerActivation: 2, hoursPerActiveDay: 10, fullActivations: full },
      labor: [person({ role: 'Chofer' })],
      logistics: { notApplicable: false, distanceKm: 100, roundTrip: true, tripsPerActivation: 4, tollsPerActivation: 10000, lodgingPerActivation: 40000, vehicles: [vehicle({ consumptionLPer100Km: 30, costPerKm: 300 })] },
      indirect: { method: 'percent_direct', pct: 0 },
      risk: { generalPct: 0, items: [] },
      finance: { paymentTermDays: 0, invoiceLagDays: 0, monthlyRatePct: 0 },
    });
    const off = computeQuote(build(false), { settings: {} });
    const on = computeQuote(build(true), { settings: {} });
    // 0,5 salida × (10.000 + 40.000) = 25.000; los km siguen a los 26 viajes facturados.
    close(on.kpis.totalCost - off.kpis.totalCost, 25000, 1e-9);
  });
});

describe('textos', () => {
  test('plurales de unidades de varias palabras', () => {
    assert.equal(pluralizeUnit('prueba hidráulica'), 'pruebas hidráulicas');
    assert.equal(pluralizeUnit('metro lineal'), 'metros lineales');
    assert.equal(pluralizeUnit('punto de inspección'), 'puntos de inspección');
  });
  test('por hora con mínimo por llamado: el equivalente por día incluye el mínimo', () => {
    resetIds();
    const q = service({
      serviceType: 'crew', unit: 'hour', pricingMode: 'known_rate',
      activity: { activeDaysPerMonth: 20, daysPerActivation: 0.25, hoursPerActiveDay: 10 },
      labor: [person({ positions: 3 })],
      rules: { minimumCallUnits: 4 },
      pricing: { knownRate: 48000 },
    });
    const r = computeQuote(q, { settings: {} });
    // 4 llamados por día × 4 h mínimas = 16 h por día de trabajo.
    close(r.kpis.billableQuantity ?? r.estimate.revenue.billableUnits, 320);
    close(r.equivalents.perDay, 16 * 48000);
  });
});
