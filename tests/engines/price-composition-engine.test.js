/**
 * Contrato del negocio — "¿Cómo se forma tu precio?" (PLAN-2026-002, PN4/PN5).
 *
 *   Facturación = Σ costo por rubro + impuestos sobre la facturación + resultado
 *   % del precio: con ganancia suman exactamente 100; con pérdida no se fuerza.
 *   Apropiación: Σ partes por unidad = tarifa neta; lista = neta / factor.
 *   Total del contrato = mes × meses.
 * Valores sintéticos e ILUSTRATIVOS.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { demoHydroCraneQuote, demoReferenceQuote, demoServiceTemplates } from '../../js/domain/demo-data.js';
import { createQuoteFromTemplate, defaultSettings } from '../../js/domain/quote-factory.js';

function approx(actual, expected, message = '', tolerance = 1e-6) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message}: se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: esperado ${expected}, obtenido ${actual}`);
}

const detailed = (...pcts) => ({ mode: 'detailed', notApplicable: false, combinedPct: null, items: pcts.map((pct, i) => ({ id: `t${i}`, kind: 'other', label: `Cargo ${i}`, pct })) });

function onCall({ F = 30000000, v = 1000000, D = 10, rate = null, margin = 10, taxes = null } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = F;
  q.otherCosts[1].amount = v;
  q.activity.activeDaysPerMonth = D;
  q.pricingMode = rate === null ? 'known_activity' : 'known_rate';
  q.pricing = { ...q.pricing, knownRate: rate ?? 0, targetMarginPct: margin, roundingStep: 0, offeredRateOverride: null };
  if (taxes !== null) q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: taxes, items: [] };
  return q;
}

describe('Composición del precio — caso sintético exacto', () => {
  test('costo 40M, impuestos 10 %, margen 10 % → 80 % costo, 10 % impuestos, 10 % ganancia', () => {
    const c = priceComposition(computeQuote(onCall({ taxes: 10 })));
    assert.equal(c.available, true);
    approx(c.revenue, 50000000, 'facturación');
    assert.deepEqual(c.groups.map((g) => [g.key, g.displayPct, g.displayPct1]), [['cost', 80, 80], ['taxes', 10, 10], ['result', 10, 10]]);
    const taxes = c.rows.find((r) => r.key === 'billing_taxes');
    approx(taxes.amount, 5000000, 'impuestos');
    approx(taxes.perUnit, 500000, 'impuestos por día');
    const result = c.rows.find((r) => r.key === 'result');
    approx(result.perUnit, 500000, 'ganancia por día');
    approx(c.perUnit.netRate, 5000000, 'tarifa neta');
    // Total del contrato (12 meses en el caso de referencia).
    assert.equal(c.contract.months, 12);
    approx(c.contract.revenue, 600000000, 'facturación del contrato');
    approx(c.contract.profit, 60000000, 'resultado del contrato');
    assert.equal(c.allChecksOk, true);
    assert.ok(c.checks.every((x) => x.ok === true), JSON.stringify(c.checks));
  });

  test('sin impuestos la fila de impuestos es 0 y no cambia nada más', () => {
    const c = priceComposition(computeQuote(onCall()));
    approx(c.billingTaxes, 0, 'impuestos');
    approx(c.rows.find((r) => r.key === 'billing_taxes').pctOfPrice, 0, '% impuestos');
    approx(c.groups[2].pctOfPrice, 10, 'ganancia 10 % del precio', 1e-9);
  });
});

describe('Composición del precio — invariantes en todos los casos', () => {
  const cases = [
    ['demo hidrogrúa sin impuestos', demoHydroCraneQuote()],
    ['demo hidrogrúa con detalle', { ...demoHydroCraneQuote(), billingTaxes: detailed(3, 0.6, 1.2) }],
    ['on-call modo A con impuestos', onCall({ rate: 4800000, taxes: 4.5 })],
    ...demoServiceTemplates().map((tpl) => [`plantilla ${tpl.name}`, (() => {
      const q = createQuoteFromTemplate(tpl, { organizationId: 'o', settings: { ...defaultSettings(), illustrative: false }, now: '2026-10-04T00:00:00.000Z', id: 'q' });
      q.billingTaxes = detailed(2.5, 1);
      return q;
    })()]),
  ];
  for (const [label, quote] of cases) {
    test(label, () => {
      const r = computeQuote(quote);
      const c = priceComposition(r);
      if (!c.available) {
        assert.ok(c.reason, 'sin composición, con motivo');
        return;
      }
      const total = c.rows.reduce((s, row) => s + row.amount, 0);
      approx(total, c.revenue, 'Σ filas = facturación', Math.max(0.01, c.revenue * 1e-9));
      if (!c.loss) {
        approx(c.rows.reduce((s, row) => s + row.displayPct, 0), 100, 'Σ % mostrados = 100', 1e-9);
        approx(c.groups.reduce((s, g) => s + g.displayPct1, 0), 100, 'Σ % con 1 decimal = 100', 1e-9);
      }
      if (c.perUnit.netRate !== null) approx(c.rows.reduce((s, row) => s + row.perUnit, 0), c.perUnit.netRate, 'Σ por unidad = tarifa neta', 0.01);
      assert.equal(c.allChecksOk, true, JSON.stringify(c.checks.filter((x) => x.ok === false)));
      const costRows = c.rows.filter((row) => row.group === 'cost');
      assert.equal(costRows.length, 9, 'las 9 categorías de la EECC (incluye equipos y servicios externos)');
    });
  }
});

describe('Composición del precio — pérdida, sin tarifa y sin facturación', () => {
  test('con pérdida no se fuerza el 100 % y el resultado es negativo', () => {
    const c = priceComposition(computeQuote(demoReferenceQuote()));
    assert.equal(c.available, true);
    assert.equal(c.loss, true);
    approx(c.profit, -6000000, 'pérdida');
    const result = c.rows.find((r) => r.key === 'result');
    assert.equal(result.label, 'Pérdida');
    assert.ok(result.pctOfPrice < 0);
    assert.equal(c.checks.find((x) => x.id === 'display_100').ok, null);
    assert.equal(c.allChecksOk, true);
    approx(c.groups[0].pctOfPrice, (38000000 / 32000000) * 100, 'costo > 100 % del precio', 1e-9);
    // "De cada $ 100": 118,8 de costo y −18,8 de pérdida (redondeo simétrico, suman 100).
    assert.deepEqual(c.groups.map((g) => g.displayPct1), [118.8, 0, -18.8]);
  });

  test('sin tarifa → no disponible con motivo (nunca NaN)', () => {
    const q = onCall({ rate: 0 });
    const c = priceComposition(computeQuote(q));
    assert.equal(c.available, false);
    assert.match(c.reason, /tarifa/);
    assert.deepEqual(c.rows, []);
  });

  test('0 días activos con tarifa → sin facturación, no disponible', () => {
    const c = priceComposition(computeQuote(onCall({ rate: 4000000, D: 0 })));
    assert.equal(c.available, false);
  });

  test('tolera un resultado vacío', () => {
    assert.equal(priceComposition(null).available, false);
    assert.equal(priceComposition({}).available, false);
  });
});

describe('Composición del precio — "de cada $ 100" con 1 decimal', () => {
  test('impuestos 4,5 % se muestran 4,5 (no 5) y los tres suman 100', () => {
    const q = demoHydroCraneQuote();
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 4.5, items: [] };
    const c = priceComposition(computeQuote(q));
    assert.equal(c.groups.find((g) => g.key === 'taxes').displayPct1, 4.5);
    approx(c.groups.reduce((s, g) => s + g.displayPct1, 0), 100, 'suma', 1e-9);
  });
});
