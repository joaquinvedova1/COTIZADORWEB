/**
 * Regresiones de la revisión económica adversarial de PLAN-2026-002.
 * Cada test protege un hallazgo para que no vuelva. Valores sintéticos ILUSTRATIVOS.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote, monthlyFeeCap } from '../../js/engines/quote-engine.js';
import { compareCommercialModels } from '../../js/engines/scenario-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { billingTaxConfigInfo, traceBillingTaxes } from '../../js/engines/billing-taxes-engine.js';
import { classifyDiscount, convertMinimumCallUnits } from '../../js/engines/commercial-rules-engine.js';
import { copyBillingTaxes } from '../../js/domain/billing-taxes.js';
import { createEmptyQuote, defaultSettings } from '../../js/domain/quote-factory.js';
import { demoReferenceQuote } from '../../js/domain/demo-data.js';
import { validateQuote } from '../../js/core/validation.js';

function approx(actual, expected, message = '', tolerance = 1e-6) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message}: se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: esperado ${expected}, obtenido ${actual}`);
}

function onCall({ F = 30000000, v = 1000000, D = 10, rate = null, margin = 10, taxes = null, rules = {} } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = F;
  q.otherCosts[1].amount = v;
  q.activity.activeDaysPerMonth = D;
  q.pricingMode = rate === null ? 'known_activity' : 'known_rate';
  q.pricing = { ...q.pricing, knownRate: rate ?? 0, targetMarginPct: margin, roundingStep: 0, offeredRateOverride: null };
  q.rules = { ...q.rules, ...rules };
  if (taxes !== null) q.billingTaxes = typeof taxes === 'number' ? { mode: 'combined', notApplicable: false, combinedPct: taxes, items: [] } : taxes;
  return q;
}

describe('M1 — el margen escrito como texto se lee igual en validación, motor, completitud y comparador', () => {
  test('"10,5" es válido en los cuatro', () => {
    const q = onCall({ margin: '10,5' });
    assert.deepEqual(validateQuote(q).filter((i) => i.path === 'pricing.targetMarginPct'), []);
    const r = computeQuote(q);
    assert.equal(r.kpis.targetMarginInvalid, false);
    assert.equal(r.kpis.targetMarginPct, 10.5);
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'margin').status, 'ok');
    assert.equal(compareCommercialModels(q).targetMarginPct, 10.5);
  });

  test('"1.000" (mil) es inválido en los cuatro: nunca 1 % en silencio', () => {
    const q = onCall({ margin: '1.000' });
    assert.ok(validateQuote(q).some((i) => i.path === 'pricing.targetMarginPct'));
    assert.equal(computeQuote(q).kpis.targetMarginInvalid, true);
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'margin').status, 'missing');
    assert.deepEqual(compareCommercialModels(q).models, []);
  });

  test('un margen texto inválido en el comparador → sin modelos (no 0 % en silencio)', () => {
    const out = compareCommercialModels(onCall({ margin: 'abc' }));
    assert.deepEqual(out.models, []);
    assert.match(out.reason, /margen válido/);
  });
});

describe('BAJO — textos, redondeos y estados', () => {
  test('el mensaje de completitud usa coma y redondeo (0,1 + 0,2 → 0,3 %)', () => {
    const q = onCall({ margin: 99.8, taxes: { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'other', label: 'a', pct: 0.1 }, { id: 'b', kind: 'other', label: 'b', pct: 0.2 }] } });
    const msg = evaluateCompleteness(q).items.find((i) => i.id === 'margin').message;
    assert.match(msg, /0,3 %/);
    assert.match(msg, /99,7 %/);
    assert.doesNotMatch(msg, /0\.3/);
  });

  test('con pérdida, "de cada $ 100" suma exactamente 100', () => {
    const q = onCall({ rate: 3001237, taxes: 4.05 });
    const c = priceComposition(computeQuote(q));
    assert.equal(c.loss, true);
    approx(c.groups.reduce((s, g) => s + g.displayPct1, 0), 100, 'suma', 1e-9);
  });

  test('la traza de impuestos inválidos no dice además "sin definir"', () => {
    const trace = traceBillingTaxes(billingTaxConfigInfo({ mode: 'combined', notApplicable: false, combinedPct: -3, items: [] }), 1000);
    assert.ok(trace.notes.some((n) => /inválido/.test(n)));
    assert.ok(!trace.notes.some((n) => /Sin definir/.test(n)));
    const r = computeQuote(onCall({ taxes: -3 }));
    assert.ok(!r.traces.floorRate.notes.some((n) => /sin definir/.test(n)));
    assert.ok(r.traces.floorRate.notes.some((n) => /inválido/.test(n)));
  });

  test('impuestos que suman 100 % o más: motivo "total" y la suma cargada para explicarlo', () => {
    const info = billingTaxConfigInfo({ mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'other', label: 'a', pct: 60 }, { id: 'b', kind: 'other', label: 'b', pct: 50 }] });
    assert.equal(info.invalid, true);
    assert.equal(info.invalidReason, 'total');
    assert.equal(info.rawTotal, 110);
    assert.equal(info.pct, 0);
    assert.equal(billingTaxConfigInfo({ mode: 'combined', combinedPct: -1 }).invalidReason, 'negative');
    assert.equal(billingTaxConfigInfo({ mode: 'combined', combinedPct: 'abc' }).invalidReason, 'not_number');
  });

  test('con margen objetivo inválido los tramos no se rotulan "bajo el objetivo"', () => {
    assert.equal(classifyDiscount({ netRate: 10, floorNetRate: 8, targetNetRate: null }), 'no_target');
    assert.equal(classifyDiscount({ netRate: 7, floorNetRate: 8, targetNetRate: null }), 'red');
    assert.equal(classifyDiscount({ netRate: 9, floorNetRate: 8, targetNetRate: 10 }), 'orange');
    assert.equal(classifyDiscount({ netRate: 10, floorNetRate: 8, targetNetRate: 10 }), 'green');
    const r = computeQuote(onCall({ rate: 9000000, margin: 120 }));
    assert.ok(r.discounts.every((d) => d.status !== 'orange' && d.status !== 'green'), JSON.stringify(r.discounts.map((d) => d.status)));
  });

  test('la traza de días para el margen objetivo reproduce el número aunque caiga en otro tramo que el break-even', () => {
    for (const t of [0, 10]) {
      const q = onCall({ D: 10, rate: 4000000, margin: 20, taxes: t, rules: { volumeTiers: [{ id: 'a', fromDays: 1, toDays: 11, discountPct: 0 }, { id: 'b', fromDays: 12, toDays: null, discountPct: 5 }] } });
      const r = computeQuote(q);
      const tr = r.traces.targetMarginDays;
      const value = (label) => tr.inputs.find((i) => i.label.startsWith(label)).value;
      const keep = 1 - (t + 20) / 100;
      const fromTrace = (value('Costos fijos') - value('Ingresos fijos') * keep) / (value('Ingreso por día activo') * keep - value('Costo variable por día activo'));
      assert.equal(r.targetMarginDays.reachable, true);
      approx(fromTrace, r.targetMarginDays.days, `t ${t}`, 1e-6);
    }
  });

  test('composición con descuento 100 %: el motivo es el descuento, no los días', () => {
    const q = onCall({ rate: 4000000 });
    q.pricing.commercialDiscountPct = 100;
    const c = priceComposition(computeQuote(q));
    assert.equal(c.available, false);
    assert.match(c.reason, /descuentos suman 100 %/);
  });

  test('copiar impuestos nunca produce NaN: un texto inválido se conserva como texto', () => {
    const raw = { mode: 'detailed', notApplicable: false, combinedPct: null, items: [{ id: 'a', kind: 'gross_income', label: 'IB', pct: '1,2,3' }, { id: 'b', kind: 'stamp', label: 'S', pct: 1 }] };
    const copy = copyBillingTaxes(raw);
    assert.equal(copy.items[0].pct, '1,2,3');
    assert.equal(JSON.stringify(copy).includes('NaN'), false);
    assert.equal(billingTaxConfigInfo(copy).invalid, true, 'el motor lo sigue marcando inválido');
    const q = createEmptyQuote({ organizationId: 'o', settings: { ...defaultSettings(), defaultBillingTaxes: raw } });
    assert.equal(q.billingTaxes.items[0].pct, '1,2,3');
    assert.equal(JSON.stringify(q).includes('NaN'), false);
    for (const bad of [NaN, Infinity]) assert.equal(copyBillingTaxes({ combinedPct: bad }).combinedPct, null);
  });
});

describe('M2 — al cambiar la unidad, el mínimo por llamado mantiene su significado', () => {
  test('día ↔ hora con 10 h por día', () => {
    assert.equal(convertMinimumCallUnits(3, 'day', 'hour', 10), 30);
    assert.equal(convertMinimumCallUnits(30, 'hour', 'day', 10), 3);
    assert.equal(convertMinimumCallUnits(3, 'day', 'day', 10), 3);
    assert.equal(convertMinimumCallUnits(3, 'day', 'hour', 0), null, 'sin horas por día no se puede convertir');
    assert.equal(convertMinimumCallUnits(3, 'day', 'month', 10), 3, 'con abono no aplica: se conserva');
    assert.equal(convertMinimumCallUnits(0, 'day', 'hour', 10), 0);
  });

  test('la facturación y el margen no cambian al pasar de día a hora con la tarifa y el mínimo convertidos', () => {
    const day = onCall({ rate: 4000000, taxes: 10, rules: { minimumCallUnits: 3 } });
    day.activity.daysPerActivation = 1;
    day.activity.hoursPerActiveDay = 10;
    const hour = JSON.parse(JSON.stringify(day));
    hour.unit = 'hour';
    hour.pricing.knownRate = 400000;
    hour.rules.minimumCallUnits = convertMinimumCallUnits(3, 'day', 'hour', 10);
    const a = computeQuote(day).kpis;
    const b = computeQuote(hour).kpis;
    approx(b.revenue, a.revenue, 'facturación');
    approx(b.marginPct, a.marginPct, 'margen', 1e-9);
    approx(b.breakEvenDays, a.breakEvenDays, 'break-even', 1e-6);
  });
});

describe('BAJO 11 — días máximos del abono mensual en el motor', () => {
  test('abono que cubre fijos: no se pierde hasta (abono × (1 − t) − fijos) / variable', () => {
    const q = onCall({ rate: 50000000, taxes: 10 });
    q.unit = 'month';
    const r = computeQuote(q);
    const cap = monthlyFeeCap(r.ctx, 50000000, 0);
    assert.equal(cap.status, 'until');
    approx(cap.days, (50000000 * 0.9 - 30000000) / 1000000, 'días máximos', 1e-6);
    assert.equal(monthlyFeeCap(r.ctx, 0, 0), null);
    const day = computeQuote(onCall({ rate: 4000000 }));
    assert.equal(monthlyFeeCap(day.ctx, 4000000, 0), null, 'sólo con abono mensual');
  });
});

describe('Convención de montos (vatTreatment): explícita y validada', () => {
  test('una cotización nueva nace "sin IVA"', () => {
    assert.equal(createEmptyQuote({ organizationId: 'org' }).vatTreatment, 'excluded');
  });

  test('sin el campo (datos v2 previos) o con "excluded" no hay error; otra convención sí', () => {
    const base = createEmptyQuote({ organizationId: 'org' });
    const vatIssues = (q) => validateQuote(q).filter((i) => i.path === 'vatTreatment');
    assert.deepEqual(vatIssues(base), []);
    const { vatTreatment, ...noField } = base;
    assert.deepEqual(vatIssues(noField), []);
    const included = { ...base, vatTreatment: 'included' };
    const issues = vatIssues(included);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, 'error');
    assert.match(issues[0].message, /sin IVA/);
  });

  test('el cálculo no depende del campo: misma cotización con y sin vatTreatment da el mismo resultado', () => {
    const q = onCall({ rate: 4000000, taxes: 5 });
    const { vatTreatment, ...noField } = q;
    assert.deepEqual(computeQuote(noField).kpis, computeQuote(q).kpis);
  });
});
