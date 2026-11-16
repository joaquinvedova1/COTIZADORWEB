/**
 * Tanda "cotización para novatos" — El precio y el Resultado (textos de presentación).
 * - La insignia de valores de ejemplo dice QUÉ es de ejemplo (ILUSTRATIVO a secas sólo
 *   si toda la cotización es demo).
 * - "Ver cálculo" de la sugerida: la cuenta en palabras con los valores del motor
 *   (no recalcula nada) y el precio objetivo sin redondear.
 * - Precio cerrado: "Precio sugerido" / "Precio mínimo" y "este precio".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { illustrativeBadgeText, suggestedRateTrace, suggestedRateName, floorRateName, isClosedPrice, draftBannerText } from '../../js/ui/result-text.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createEmptyQuote, createOtherCost, defaultSettings } from '../../js/domain/quote-factory.js';

function quoteWith({ roundingStep = 0, margin = 10, closed = false } = {}) {
  const settings = defaultSettings('org');
  const q = createEmptyQuote({ organizationId: 'org', settings, id: '00000000-0000-4000-8000-000000009911', now: '2026-01-01T00:00:00.000Z' });
  q.pricingMode = 'known_activity';
  q.unit = 'day';
  q.activity.activeDaysPerMonth = 10;
  q.finance.paymentTermDays = 0;
  q.finance.monthlyRatePct = 0;
  q.risk.generalPct = 0;
  q.fuel.pricePerLiter = 0;
  q.otherCosts = [
    createOtherCost({ id: 'c-fijo', description: 'Fijo', category: 'equipment', behavior: 'fixed_monthly', amount: 30000000 }),
    createOtherCost({ id: 'c-dia', description: 'Por día', category: 'labor', behavior: 'per_active_day', amount: 1000000 }),
  ];
  q.pricing.targetMarginPct = margin;
  q.pricing.roundingStep = roundingStep;
  q.billingTaxes = { notApplicable: true, mode: 'combined', combinedPct: null, items: [] };
  const r = computeQuote(q, { settings });
  if (closed) r.contract = { ...(r.contract || {}), mode: 'closed' };
  return { q, r };
}

describe('Insignia de valores de ejemplo', () => {
  test('dice qué es de ejemplo; ILUSTRATIVO sólo con la cotización entera', () => {
    assert.equal(illustrativeBadgeText({ any: false }), null);
    assert.equal(illustrativeBadgeText({ any: true, quote: true, lines: 3, fuel: true }), 'ILUSTRATIVO');
    assert.equal(illustrativeBadgeText({ any: true, fuel: true }), 'Combustible de ejemplo');
    assert.equal(illustrativeBadgeText({ any: true, lines: 1 }), 'Carga de ejemplo');
    assert.equal(illustrativeBadgeText({ any: true, lines: 3 }), 'Cargas de ejemplo (3)');
    assert.equal(illustrativeBadgeText({ any: true, lines: 2, fuel: true }), 'Valores de ejemplo (2)');
  });
});

describe('"Ver cálculo" de la tarifa sugerida', () => {
  test('cuenta en palabras con los valores del motor y el redondeo al final', () => {
    const { r } = quoteWith({ roundingStep: 1000 });
    const t = suggestedRateTrace(r, { roundingStep: 1000 });
    assert.match(t.formula, /costo \+ tu ganancia\) ÷ días, redondeado hacia arriba/);
    // 40.000.000 ÷ 0,9 = 44.444.444,44 → ÷ 10 días = 4.444.444,44 → 4.445.000.
    const required = t.steps.find((s) => s.label.startsWith('1.'));
    assert.ok(Math.abs(required.value - 40000000 / 0.9) < 1e-3);
    assert.match(required.label, /\$ 90 de costo y \$ 10 de ganancia/);
    assert.ok(t.steps.some((s) => /Redondeo hacia arriba a múltiplos de \$\s1\.000/.test(s.label)));
    assert.equal(t.result.value, r.kpis.suggestedListRate);
    assert.equal(r.kpis.suggestedListRate, 4445000);
    assert.ok(t.notes.some((n) => /Precio objetivo sin redondear: \$\s4\.444\.445/.test(n)));
  });

  test('sin redondeo: es el precio objetivo', () => {
    const { r } = quoteWith({ roundingStep: 0 });
    const t = suggestedRateTrace(r);
    assert.ok(!t.steps.some((s) => s.label.startsWith('Redondeo')));
    assert.ok(t.notes[0].startsWith('Sin redondeo comercial'));
  });
});

describe('Precio cerrado: precio, no tarifa', () => {
  test('rótulos y aviso de borrador', () => {
    const { r } = quoteWith();
    assert.equal(isClosedPrice(r), false);
    assert.equal(suggestedRateName(r), 'Tarifa sugerida');
    assert.equal(floorRateName(r), 'Tarifa mínima (para no perder)');
    const closed = quoteWith({ closed: true }).r;
    assert.equal(suggestedRateName(closed), 'Precio sugerido');
    assert.equal(floorRateName(closed), 'Precio mínimo (para no perder)');
    assert.equal(suggestedRateTrace(closed).title, 'Precio sugerido');
    assert.match(draftBannerText({ review: 2, closed: true }).title, /antes de usar este precio\.$/);
    assert.match(draftBannerText({ review: 2 }).title, /antes de usar esta tarifa\.$/);
  });
});
