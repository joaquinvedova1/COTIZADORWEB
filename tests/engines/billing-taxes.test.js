/**
 * Contrato del negocio — impuestos sobre la facturación (PLAN-2026-002, PN2/PN3).
 *
 * Reglas:
 *   - Se pagan sobre lo que se FACTURA (sin IVA), no sobre el costo: van dentro
 *     del divisor junto con el margen → precio = costo / (1 − m − t).
 *   - Tarifa piso = costo / (1 − t). Resultado = Facturación × (1 − t) − Costo.
 *   - Margen = Resultado / Facturación; markup efectivo = m / (1 − m − t).
 *   - m + t ≥ 100 → no existe precio: nunca se usa otro margen en silencio.
 *   - Sin definir → t = 0 (los números no cambian) y `defined` false.
 *   - Nunca (1 − m)(1 − t), nunca sobre el costo ni sobre la tarifa de lista.
 * Todos los valores son sintéticos e ILUSTRATIVOS.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  priceFromMargin,
  priceFromMarginAndTaxes,
  effectiveMarkupPct,
  marginToMarkup,
  isValidMarginAndTaxes,
  isValidBillingTaxPct,
  priceLadder,
} from '../../js/engines/pricing-engine.js';
import { billingTaxInfo, billingTaxConfigInfo, traceBillingTaxes } from '../../js/engines/billing-taxes-engine.js';
import { requiredNetRate } from '../../js/engines/commercial-rules-engine.js';
import { breakEvenSimple, minimumRateForDays } from '../../js/engines/break-even-engine.js';
import { buildCostModel } from '../../js/engines/cost-engine.js';
import { createEconomicsContext, evaluateAt, requiredRatesAt, linearDecomposition } from '../../js/engines/economics-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { compareCommercialModels, runSensitivity, runScenarios, sensitivityTable } from '../../js/engines/scenario-engine.js';
import { demoReferenceQuote, demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { emptyBillingTaxes, normalizeBillingTaxes, billingTaxesDecided } from '../../js/domain/billing-taxes.js';
import { createEmptyQuote, createQuoteFromTemplate, defaultSettings, billingTaxesForNewQuote } from '../../js/domain/quote-factory.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

const combined = (pct) => ({ mode: 'combined', notApplicable: false, combinedPct: pct, items: [] });
const detailed = (...pcts) => ({ mode: 'detailed', notApplicable: false, combinedPct: null, items: pcts.map((pct, i) => ({ id: `t${i}`, kind: 'other', label: `Cargo ${i}`, pct })) });

/** On-call sintético: fijos F, variable v/día, D días, tarifa p (o modo B sin tarifa), impuestos t. */
function onCall({ F = 30000000, v = 1000000, D = 10, rate = null, margin = 10, taxes = null, guarantee = 0 } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = F;
  q.otherCosts[1].amount = v;
  q.activity.activeDaysPerMonth = D;
  q.pricingMode = rate === null ? 'known_activity' : 'known_rate';
  q.pricing = { ...q.pricing, knownRate: rate ?? 0, targetMarginPct: margin, roundingStep: 0, offeredRateOverride: null };
  q.rules = { ...q.rules, minimumMonthlyGuarantee: guarantee };
  if (taxes !== null) q.billingTaxes = typeof taxes === 'number' ? combined(taxes) : taxes;
  return q;
}

// ------------------------------------------------------------------ pricing

describe('Gross-up exacto: precio = costo / (1 − margen − impuestos)', () => {
  test('casos sintéticos de referencia', () => {
    approx(priceFromMarginAndTaxes(100, 10, 10), 125, 'm 10 + t 10', 1e-9);
    approx(priceFromMarginAndTaxes(100, 0, 10), 111.11111111111111, 'piso con t 10', 1e-9);
    approx(priceFromMarginAndTaxes(100, 0, 5), 105.26315789473684, 'piso con t 5', 1e-9);
    approx(priceFromMarginAndTaxes(100, 10, 5), 117.64705882352941, 'm 10 + t 5', 1e-9);
  });

  test('con impuestos 0 es exactamente el margen sobre precio de siempre (111,11)', () => {
    assert.equal(priceFromMarginAndTaxes(100, 10, 0), priceFromMargin(100, 10));
    assert.equal(priceFromMarginAndTaxes(100, 10), priceFromMargin(100, 10));
  });

  test('NO es multiplicativo ni se aplica sobre el costo', () => {
    const price = priceFromMarginAndTaxes(100, 10, 10);
    assert.ok(Math.abs(price - 100 / (0.9 * 0.9)) > 1, 'no es (1 − m)(1 − t) = 123,46');
    assert.ok(Math.abs(price - 121) > 1, 'no es costo × 1,1 × 1,1 = 121');
    // El resultado después de impuestos es exactamente el margen sobre el precio.
    approx((price - 0.1 * price - 100) / price, 0.1, 'margen efectivo', 1e-12);
  });

  test('m + t ≥ 100 → null (no existe precio); justo debajo es válido', () => {
    assert.equal(priceFromMarginAndTaxes(100, 90, 10), null);
    assert.equal(priceFromMarginAndTaxes(100, 50, 60), null);
    assert.equal(isValidMarginAndTaxes(90, 10), false);
    assert.equal(isValidMarginAndTaxes(89.99, 10), true);
    approx(priceFromMarginAndTaxes(100, 89.99, 10), 1000000, 'divisor 0,0001', 1e-3);
    approx(priceFromMarginAndTaxes(100, 0, 99.99), 1000000, 't 99,99', 1e-3);
  });

  test('entradas inválidas → null, nunca NaN ni Infinity', () => {
    for (const [c, m, t] of [[100, 10, -1], [100, 10, 100], [100, 10, NaN], [NaN, 10, 10], [100, -1, 10], [100, 100, 0], [Infinity, 10, 10], [100, 10, '5']]) {
      assert.equal(priceFromMarginAndTaxes(c, m, t), null, `${c}/${m}/${t}`);
    }
    assert.equal(isValidBillingTaxPct(0), true);
    assert.equal(isValidBillingTaxPct(99.99), true);
    assert.equal(isValidBillingTaxPct(100), false);
    assert.equal(isValidBillingTaxPct(-0.01), false);
  });

  test('markup efectivo = m / (1 − m − t); con t 0 es marginToMarkup', () => {
    approx(effectiveMarkupPct(10, 10), 12.5, 'm 10 t 10', 1e-12);
    assert.equal(effectiveMarkupPct(10, 0), marginToMarkup(10));
    assert.equal(effectiveMarkupPct(0, 10), 0);
    assert.equal(effectiveMarkupPct(50, 50), null);
  });

  test('escalera de precios con impuestos: precio = costo + impuestos + ganancia en cada fila; omite m + t ≥ 100', () => {
    const rows = priceLadder(100, [10, 20, 95], 30, 10);
    assert.deepEqual(rows.map((r) => r.key), ['floor', 'm10', 'm20', 'custom']);
    const floor = rows[0];
    approx(floor.price, 111.11111111111111, 'piso', 1e-9);
    approx(floor.billingTaxes, 11.111111111111111, 'impuestos del piso', 1e-9);
    assert.equal(floor.gain, 0);
    approx(rows[1].price, 125, 'm 10', 1e-9);
    approx(rows[1].markupPct, 12.5, 'markup efectivo m 10', 1e-12);
    rows.forEach((r) => approx(r.price - r.billingTaxes - r.gain, 100, `${r.key}: precio − impuestos − ganancia = costo`, 1e-9));
    // Sin impuestos la escalera es la de siempre.
    const plain = priceLadder(100, [10], null);
    approx(plain[1].price, 111.11111111111111, 'm 10 sin impuestos', 1e-9);
    assert.equal(plain[1].billingTaxes, 0);
  });
});

// ------------------------------------------------------------------ datos

describe('Configuración de impuestos: modos excluyentes, "no aplica", sin definir e inválidos', () => {
  test('sin definir (null, {}, datos viejos) → t 0 y defined false', () => {
    for (const raw of [null, undefined, {}, emptyBillingTaxes(), 'texto', []]) {
      const info = billingTaxConfigInfo(raw);
      assert.equal(info.pct, 0);
      assert.equal(info.defined, false);
      assert.equal(info.invalid, false);
    }
    assert.equal(billingTaxInfo({}).defined, false, 'cotización sin el campo');
    assert.equal(billingTaxInfo(null).pct, 0);
  });

  test('"Un % total" usa sólo combinedPct; "Detalle" suma sólo los renglones (nunca los dos)', () => {
    const c = billingTaxConfigInfo({ mode: 'combined', notApplicable: false, combinedPct: 4, items: [{ id: 'a', kind: 'stamp', label: 'S', pct: 2 }] });
    assert.equal(c.pct, 4);
    const d = billingTaxConfigInfo({ mode: 'detailed', notApplicable: false, combinedPct: 4, items: [{ id: 'a', kind: 'gross_income', label: 'IB', pct: 3 }, { id: 'b', kind: 'stamp', label: 'S', pct: 0.5 }, { id: 'c', kind: 'other', label: 'vacío', pct: null }] });
    assert.equal(d.pct, 3.5);
    assert.equal(d.defined, true);
  });

  test('"no aplica" → t 0 y definido aunque haya un % viejo cargado', () => {
    const info = billingTaxConfigInfo({ mode: 'combined', notApplicable: true, combinedPct: 7, items: [] });
    assert.equal(info.pct, 0);
    assert.equal(info.defined, true);
    assert.equal(info.invalid, false);
  });

  test('0 % explícito es una decisión (definido)', () => {
    assert.equal(billingTaxConfigInfo(combined(0)).defined, true);
    assert.equal(billingTaxConfigInfo(detailed(0)).defined, true);
  });

  test('inválidos (negativo, texto, total ≥ 100) → t 0, invalid y NO definido', () => {
    for (const raw of [combined(-1), combined('abc'), combined(100), detailed(60, 40), detailed(3, -1), detailed(true)]) {
      const info = billingTaxConfigInfo(raw);
      assert.equal(info.invalid, true, JSON.stringify(raw));
      assert.equal(info.pct, 0, JSON.stringify(raw));
      assert.equal(info.defined, false, JSON.stringify(raw));
    }
  });

  test('texto con coma decimal se lee igual que en la validación ("4,5" → 4,5)', () => {
    assert.equal(billingTaxConfigInfo(combined('4,5')).pct, 4.5);
    assert.equal(normalizeBillingTaxes(combined('')).combinedPct, null);
  });

  test('normalización: modo desconocido → "Un % total"; renglones sin tipo → "otro" con nombre', () => {
    const n = normalizeBillingTaxes({ mode: 'raro', items: [{ pct: 1 }, 'x'] });
    assert.equal(n.mode, 'combined');
    assert.equal(n.items.length, 1);
    assert.equal(n.items[0].kind, 'other');
    assert.ok(n.items[0].label.length > 0);
    assert.equal(billingTaxesDecided(n), false, 'en modo % total los renglones no cuentan');
  });

  test('traza "Ver cálculo": avisa sin definir, inválido, Sellos proporcional y exclusiones', () => {
    const undef = traceBillingTaxes(billingTaxConfigInfo(null), 1000);
    assert.ok(undef.notes.some((n) => /NO incluye/.test(n)));
    assert.equal(undef.result.value, 0);
    const stamp = traceBillingTaxes(billingTaxConfigInfo({ mode: 'detailed', items: [{ id: 's', kind: 'stamp', label: 'Sellos', pct: 1 }] }), 1000);
    assert.ok(stamp.notes.some((n) => /proporcional/.test(n)));
    approx(stamp.result.value, 10, 'impuestos', 1e-12);
    assert.ok(stamp.notes.some((n) => /No incluyen IVA, Ganancias/.test(n)));
    const bad = traceBillingTaxes(billingTaxConfigInfo(combined(-3)), 1000);
    assert.ok(bad.notes.some((n) => /inválido/.test(n)));
  });
});

describe('Valores de la empresa en cotizaciones nuevas (nunca inventados)', () => {
  test('sin valor de la empresa → sin definir; la demo también', () => {
    assert.deepEqual(createEmptyQuote({ organizationId: 'o' }).billingTaxes, emptyBillingTaxes());
    assert.deepEqual(demoHydroCraneQuote().billingTaxes, emptyBillingTaxes());
    assert.equal(defaultSettings().defaultBillingTaxes, null);
  });

  test('con valor de la empresa → la cotización nueva arranca con él, aunque la configuración sea de demostración', () => {
    const settings = { ...defaultSettings(), illustrative: true, defaultBillingTaxes: detailed(3, 1.2) };
    const q = createEmptyQuote({ organizationId: 'o', settings });
    assert.equal(billingTaxInfo(q).pct, 4.2);
    q.billingTaxes.items[0].pct = 9;
    assert.equal(settings.defaultBillingTaxes.items[0].pct, 3, 'es una copia: editar la cotización no cambia la empresa');
  });

  test('un valor de la empresa sin decidir no cuenta', () => {
    assert.deepEqual(billingTaxesForNewQuote({ defaultBillingTaxes: emptyBillingTaxes() }), emptyBillingTaxes());
    assert.deepEqual(billingTaxesForNewQuote({ defaultBillingTaxes: 'x' }), emptyBillingTaxes());
  });

  test('plantilla: sólo pisa los impuestos de la empresa si trae una decisión propia', () => {
    const settings = { ...defaultSettings(), defaultBillingTaxes: combined(4) };
    const plain = createQuoteFromTemplate({ id: 't', serviceType: 'crew', defaults: { billingTaxes: emptyBillingTaxes() } }, { organizationId: 'o', settings });
    assert.equal(billingTaxInfo(plain).pct, 4);
    const own = createQuoteFromTemplate({ id: 't', serviceType: 'crew', defaults: { billingTaxes: { ...combined(null), notApplicable: true } } }, { organizationId: 'o', settings });
    assert.equal(billingTaxInfo(own).notApplicable, true);
  });
});

// ------------------------------------------------------------------ motores

describe('Tarifa neta necesaria con impuestos y otros ingresos', () => {
  test('costo 10M, otros ingresos 1M, 10 unidades, t 4 % → 941.666,67 (los otros ingresos también tributan)', () => {
    const r = requiredNetRate({ totalCost: 10000000, marginPct: 0, billingTaxPct: 4, billableUnits: 10, otherRevenue: 1000000 });
    approx(r.rate, 941666.6666666666, 'tarifa', 1e-6);
    approx(r.requiredRevenue, 10416666.666666666, 'facturación necesaria', 1e-6);
    assert.equal(r.coveredByOtherRevenue, false);
  });

  test('sin unidades → null; m + t ≥ 100 → null e invalid', () => {
    assert.equal(requiredNetRate({ totalCost: 100, marginPct: 0, billingTaxPct: 10, billableUnits: 0 }).rate, null);
    const bad = requiredNetRate({ totalCost: 100, marginPct: 95, billingTaxPct: 10, billableUnits: 10 });
    assert.equal(bad.rate, null);
    assert.equal(bad.invalid, true);
  });
});

describe('Break-even con impuestos: contribución = tarifa × (1 − t) − variable', () => {
  test('caso on-call con t 10 % → 11,54 días; con t 0 sigue siendo 10 días (regla de negocio)', () => {
    const withTax = breakEvenSimple({ fixedCosts: 30000000, variableCostPerDay: 1000000, ratePerDay: 4000000, billingTaxPct: 10 });
    approx(withTax.contributionPerDay, 2600000);
    approx(withTax.days, 30000000 / 2600000);
    assert.equal(withTax.wholeDays, 12);
    assert.equal(breakEvenSimple({ fixedCosts: 30000000, variableCostPerDay: 1000000, ratePerDay: 4000000 }).days, 10);
  });

  test('si los impuestos se comen la contribución → inalcanzable con motivo claro', () => {
    const r = breakEvenSimple({ fixedCosts: 100, variableCostPerDay: 95, ratePerDay: 100, billingTaxPct: 10 });
    assert.equal(r.reachable, false);
    assert.match(r.reason, /impuestos/);
    assert.equal(breakEvenSimple({ fixedCosts: 100, variableCostPerDay: 1, ratePerDay: 100, billingTaxPct: 100 }).reachable, false);
  });

  test('tarifa mínima para D días = (F / D + v) / (1 − t); D = 0 → null', () => {
    approx(minimumRateForDays({ fixedCosts: 30000000, variableCostPerDay: 1000000, activeDays: 6, billingTaxPct: 10 }), 6666666.666666667);
    assert.equal(minimumRateForDays({ fixedCosts: 1, variableCostPerDay: 1, activeDays: 0, billingTaxPct: 10 }), null);
  });
});

describe('Cotización completa con impuestos (computeQuote)', () => {
  test('modo B: piso, objetivo, impuestos, resultado y markup efectivo', () => {
    const r = computeQuote(onCall({ taxes: 10 }));
    const k = r.kpis;
    approx(k.totalCost, 40000000);
    approx(k.floorNetRate, 4444444.444444444, 'piso neto', 1e-6);
    approx(k.targetNetRate, 5000000, 'objetivo neto', 1e-6);
    approx(k.revenue, 50000000);
    approx(k.billingTaxes, 5000000);
    approx(k.profit, 5000000);
    approx(k.marginPct, 10, 'margen', 1e-9);
    approx(k.targetMarkupPct, 12.5, 'markup efectivo objetivo', 1e-9);
    approx(k.markupPct, 12.5, 'markup efectivo real', 1e-9);
    approx(k.breakEvenDays, 30000000 / 3500000, 'break-even con la tarifa objetivo', 1e-6);
    approx(k.priceToCostMultiplier, 1.25, 'precio / costo', 1e-12);
    assert.equal(k.billingTaxPct, 10);
    assert.equal(k.billingTaxesDefined, true);
    assert.equal(k.billingTaxesInvalid, false);
    assert.equal(r.billingTaxInfo.pct, 10);
    assert.equal(r.traces.billingTaxes.id, 'billing_taxes');
  });

  test('sin definir: mismos números que antes y la traza del piso avisa que no los incluye', () => {
    const r = computeQuote(onCall());
    approx(r.kpis.floorNetRate, 4000000);
    approx(r.kpis.targetNetRate, 4444444.444444444, 'objetivo sin impuestos', 1e-6);
    assert.equal(r.kpis.billingTaxes, 0);
    assert.equal(r.kpis.billingTaxesDefined, false);
    assert.ok(r.traces.floorRate.notes.some((n) => /No incluye impuestos/.test(n)));
  });

  test('"no pago impuestos sobre lo que facturo" → mismos números que sin definir, pero definido y sin aviso', () => {
    const r = computeQuote(onCall({ taxes: { ...emptyBillingTaxes(), notApplicable: true } }));
    approx(r.kpis.floorNetRate, 4000000);
    assert.equal(r.kpis.billingTaxesDefined, true);
    assert.ok(!r.traces.floorRate.notes.some((n) => /No incluye impuestos/.test(n)));
  });

  test('impuestos inválidos → se calcula con t 0 y queda marcado (nunca NaN)', () => {
    const r = computeQuote(onCall({ taxes: -5 }));
    assert.equal(r.kpis.billingTaxesInvalid, true);
    assert.equal(r.kpis.billingTaxPct, 0);
    approx(r.kpis.floorNetRate, 4000000);
  });

  test('modo A: una tarifa que cubre el costo pero no los impuestos queda "bajo piso" (pierde plata)', () => {
    const noTax = computeQuote(onCall({ rate: 4200000 }));
    assert.equal(noTax.kpis.belowFloor, false);
    approx(noTax.kpis.profit, 2000000);
    const withTax = computeQuote(onCall({ rate: 4200000, taxes: 10 }));
    approx(withTax.kpis.billingTaxes, 4200000);
    approx(withTax.kpis.profit, -2200000);
    assert.equal(withTax.kpis.belowFloor, true);
    assert.equal(withTax.kpis.atRisk, true);
  });

  test('margen + impuestos ≥ 100 → sin tarifa sugerida, en riesgo, nunca otro margen en silencio', () => {
    const r = computeQuote(onCall({ margin: 92, taxes: 8 }));
    assert.equal(r.kpis.targetMarginInvalid, true);
    assert.equal(r.kpis.targetMarginPct, null);
    assert.equal(r.kpis.targetNetRate, null);
    assert.equal(r.kpis.targetMarkupPct, null);
    assert.equal(r.kpis.suggestedListRate, null);
    assert.equal(r.kpis.atRisk, true);
    approx(r.kpis.floorNetRate, 40000000 / 0.92 / 10, 'el piso sigue existiendo (costo / (1 − 8 %))', 1e-6);
    assert.ok(r.targetMarginDays.reachable === false);
    assert.ok(r.matrix.every((row) => row.byMargin.every((b) => b.marginPct + 8 < 100)), 'la matriz no incluye márgenes imposibles');
  });

  test('un margen objetivo ≥ 100 (o texto) también es inválido: no se usa 0 % en silencio', () => {
    for (const margin of [100, 150, 'abc', -1]) {
      const r = computeQuote(onCall({ margin }));
      assert.equal(r.kpis.targetMarginInvalid, true, String(margin));
      assert.equal(r.kpis.targetNetRate, null, String(margin));
    }
    const empty = computeQuote(onCall({ margin: '' }));
    assert.equal(empty.kpis.targetMarginInvalid, false, 'vacío → 0 % (la completitud lo marca)');
  });

  test('el mínimo garantizado también tributa: el ajuste suma facturación y paga impuestos', () => {
    const r = computeQuote(onCall({ rate: 1000000, D: 5, taxes: 10, guarantee: 20000000 }));
    const e = r.estimate;
    approx(e.revenue.total, 20000000, 'facturación = mínimo garantizado');
    approx(e.billingTaxes, 2000000);
    approx(e.profit, 20000000 - 2000000 - e.cost.total);
  });
});

describe('Invariantes: Facturación = Costo + Impuestos + Resultado (en cada punto)', () => {
  const cases = [
    ['on-call modo A', onCall({ rate: 4300000, taxes: 7.5 })],
    ['on-call modo B', onCall({ taxes: 3 })],
    ['demo hidrogrúa con detalle', { ...demoHydroCraneQuote(), billingTaxes: detailed(3.5, 0.6, 1) }],
    ['demo sin definir', demoHydroCraneQuote()],
  ];
  for (const [label, quote] of cases) {
    test(label, () => {
      const r = computeQuote(quote);
      const t = r.kpis.billingTaxPct;
      const e = r.estimate;
      approx(e.revenue.total, e.cost.total + e.billingTaxes + e.profit, 'estimación', 1e-6);
      approx(e.billingTaxes, (e.revenue.total * t) / 100, 'impuestos = t × facturación', 1e-6);
      if (e.revenue.total > 0) approx(e.marginPct, (e.profit / e.revenue.total) * 100, 'margen = resultado / facturación', 1e-9);
      r.matrix.forEach((row) => {
        if (row.revenue !== null) {
          // Resultado de la fila = facturación × (1 − t) − costo.
          approx(row.profit, row.revenue * (1 - t / 100) - row.cost, `matriz ${row.activeDays} días`, 1e-6);
        }
        row.byMargin.forEach((b) => {
          if (b.requiredRevenue !== null && !b.coveredByOtherRevenue) {
            // Con la facturación necesaria, el resultado es exactamente el margen.
            approx(b.requiredRevenue * (1 - (b.marginPct + t) / 100), row.cost, `facturación necesaria ${row.activeDays} días, margen ${b.marginPct}`, 1e-6);
          }
        });
      });
    });
  }

  test('con la tarifa sugerida sin redondeo, el margen real es el margen objetivo', () => {
    const q = onCall({ taxes: 6, margin: 15, D: 12 });
    const r = computeQuote(q);
    approx(r.kpis.marginPct, 15, 'margen real', 1e-9);
  });
});

describe('Economía del servicio con impuestos', () => {
  test('evaluateAt y requiredRatesAt usan el mismo t; la descomposición lineal explica el break-even', () => {
    const q = onCall({ rate: 4000000, taxes: 10 });
    const ctx = createEconomicsContext(q, buildCostModel(q));
    assert.equal(ctx.billingTaxPct, 10);
    const e = evaluateAt(ctx, 10, 4000000);
    approx(e.billingTaxes, 4000000);
    approx(e.profit, 40000000 - 4000000 - 40000000);
    const rates = requiredRatesAt(ctx, 10, [10]);
    approx(rates.floorRequiredRevenue, 40000000 / 0.9);
    approx(rates.byMargin[0].requiredRevenue, 50000000);
    const lin = linearDecomposition(ctx, 4000000, 10);
    approx(lin.contributionPerDay, 2600000);
    approx(lin.netFixed / lin.contributionPerDay, 30000000 / 2600000, 'break-even lineal', 1e-9);
  });
});

describe('Escenarios y comparador de modelos con impuestos', () => {
  test('cada modelo calibrado logra el margen objetivo después de impuestos con la actividad estimada', () => {
    const q = onCall({ taxes: 10, margin: 10, D: 10 });
    const out = compareCommercialModels(q);
    assert.equal(out.billingTaxPct, 10);
    assert.equal(out.models.length, 4);
    out.models.forEach((m) => {
      approx(m.expectedMarginPct, 10, `${m.id}: margen esperado`, 1e-9);
      approx(m.expectedProfit, m.expectedRevenue * 0.1, `${m.id}: resultado = 10 % de la facturación`, 1e-6);
    });
    const guarantee = out.models.find((m) => m.id === 'guarantee_plus_day');
    approx(guarantee.params.minimumGuarantee, 30000000 / 0.9, 'el mínimo garantizado cubre los fijos después de impuestos');
    approx(guarantee.minimumAssuredRevenue * 0.9 - 30000000, 0, 'con 0 días no pierde', 1e-6);
    const day = out.models.find((m) => m.id === 'day_rate');
    approx(day.params.ratePerDay, 5000000);
    approx(day.breakEvenDays, 30000000 / (5000000 * 0.9 - 1000000), 'break-even del modelo', 1e-6);
  });

  test('m + t ≥ 100 → sin modelos y con motivo (nunca precios imposibles)', () => {
    const out = compareCommercialModels(onCall({ taxes: 30, margin: 70 }));
    assert.deepEqual(out.models, []);
    assert.match(out.reason, /menor a 70 %/);
  });

  test('sin impuestos el comparador da los mismos números de siempre', () => {
    const out = compareCommercialModels(onCall({ margin: 10, D: 10 }));
    const day = out.models.find((m) => m.id === 'day_rate');
    approx(day.params.ratePerDay, 40000000 / (0.9 * 10));
    const guarantee = out.models.find((m) => m.id === 'guarantee_plus_day');
    approx(guarantee.params.minimumGuarantee, 30000000);
  });

  test('sensibilidad y escenarios conservan los impuestos (la tarifa queda fija, los impuestos se recalculan)', () => {
    const q = onCall({ rate: 4500000, taxes: 10 });
    const s = runSensitivity(q, { activityPct: -20 });
    approx(s.base.billingTaxes, s.base.revenue * 0.1);
    approx(s.scenario.billingTaxes, s.scenario.revenue * 0.1);
    approx(s.scenario.profit, s.scenario.revenue * 0.9 - s.scenario.totalCost);
    runScenarios(q).forEach((sc) => approx(sc.profit, sc.revenue * 0.9 - sc.totalCost, sc.id));
    sensitivityTable(q).forEach((row) => [row.low, row.high].filter(Boolean).forEach((v) => approx(v.profit, v.revenue * 0.9 - v.totalCost, row.variable)));
  });
});
