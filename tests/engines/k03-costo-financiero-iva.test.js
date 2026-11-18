/**
 * K-03 (0.14.0): costo financiero del IVA.
 *   d = max(0, plazo de cobro − días hasta pagar el IVA); t_iva = IVA × tasa mensual × d/30 (puntos)
 *   precio = costo / (1 − margen − impuestos − t_iva)
 *   alivio = IVA recuperable conocido de los externos × tasa × d/30, restado del financiero (piso 0)
 * Apagado (campo ausente, null, false, sin un número, monotributo o exento) el resultado es el de siempre.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { vatFinanceOf, normalizeVatFinance, emptyVatFinance, vatFinanceForNewQuote, withCompanyVatCondition, companyAllowsVatFinance } from '../../js/domain/vat-finance.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { applySensitivity, compareCommercialModels } from '../../js/engines/scenario-engine.js';
import { priceLadder } from '../../js/engines/pricing-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { createEmptyQuote, defaultSettings } from '../../js/domain/quote-factory.js';

const close = (a, b, tol = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const KPI_KEYS = ['totalCost', 'financialCost', 'floorNetRate', 'targetNetRate', 'targetListRate', 'suggestedListRate', 'commercialListRate', 'revenue', 'profit', 'marginPct', 'markupPct', 'breakEvenDays', 'targetMarginDays', 'billingTaxes', 'workingCapital'];
const pick = (r) => Object.fromEntries(KPI_KEYS.map((k) => [k, r.kpis[k]]));

/** Hidrogrúa demo con impuestos 10 %, plazo 60, tasa 3 % y un IVA dado (o sin campo). */
function hydro(vat, { term = 60, rate = 3, taxes = 10, margin = null } = {}) {
  const q = demoHydroCraneQuote();
  q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: taxes, items: [] };
  q.finance = { ...q.finance, paymentTermDays: term, monthlyRatePct: rate };
  if (margin !== null) q.pricing = { ...q.pricing, targetMarginPct: margin };
  if (vat !== undefined) q.finance.vat = vat;
  else delete q.finance.vat;
  return q;
}
const ON = { applies: true, ratePct: 21, payLagDays: 20 };

/** Con un alquiler de 1.000.000 neto/día con IVA 21 % (recuperable según `recoverable`). */
function withRental(q, { recoverable = 'yes', supplierPayDays = undefined, price = 1000000 } = {}) {
  q.equipment = [...q.equipment, {
    id: 'k03-rented',
    name: 'Alquilado',
    acquisition: 'rented',
    quantity: 1,
    ...(supplierPayDays !== undefined ? { supplierPayDays } : {}),
    external: { price, unit: 'day', fiscal: { vatPct: 21, vatRecoverable: recoverable } },
  }];
  return q;
}

describe('K-03 · lectura del campo y fórmula', () => {
  test('vacío por defecto: sin decidir y sin números (no se precarga 21 % ni día 20)', () => {
    assert.deepEqual(emptyVatFinance(), { applies: null, ratePct: null, payLagDays: null });
    assert.deepEqual(defaultSettings().defaultVat, { ratePct: null, payLagDays: null });
    assert.equal(normalizeVatFinance(undefined).present, false);
    assert.equal(normalizeVatFinance({ applies: 'sí' }).applies, null);
  });
  test('t_iva = IVA × tasa × (plazo − días hasta pagar)/30', () => {
    const v = vatFinanceOf(hydro(ON));
    assert.equal(v.active, true);
    assert.equal(v.days, 40);
    close(v.pct, 21 * 0.03 * 40 / 30);
  });
  test('d ≤ 0 (pagás el IVA después de cobrar) → 0', () => {
    assert.equal(vatFinanceOf(hydro({ ...ON, payLagDays: 60 })).pct, 0);
    assert.equal(vatFinanceOf(hydro({ ...ON, payLagDays: 90 })).days, 0);
    assert.equal(vatFinanceOf(hydro(ON, { term: 0 })).pct, 0);
  });
  test('falta un número, IVA ≥ 100 o días inválidos → apagado y se dice qué falta', () => {
    assert.deepEqual(vatFinanceOf(hydro({ applies: true, ratePct: null, payLagDays: 20 })).missing, ['ratePct']);
    assert.deepEqual(vatFinanceOf(hydro({ applies: true, ratePct: 21, payLagDays: null })).missing, ['payLagDays']);
    assert.equal(vatFinanceOf(hydro({ applies: true, ratePct: 100, payLagDays: 20 })).active, false);
    assert.equal(vatFinanceOf(hydro({ applies: true, ratePct: 21, payLagDays: -1 })).active, false);
  });
});

describe('K-03 · apagado = resultados idénticos', () => {
  const base = pick(computeQuote(hydro(undefined)));
  for (const [label, vat] of [
    ['null', { applies: null, ratePct: 21, payLagDays: 20 }],
    ['false', { applies: false, ratePct: 21, payLagDays: 20 }],
    ['sin IVA', { applies: true, ratePct: null, payLagDays: 20 }],
    ['sin días', { applies: true, ratePct: 21, payLagDays: null }],
    ['d ≤ 0', { applies: true, ratePct: 21, payLagDays: 60 }],
  ]) {
    test(`${label}: mismos números que sin el campo`, () => {
      assert.deepEqual(pick(computeQuote(hydro(vat))), base);
    });
  }
  test('monotributo o exento: nunca aplica aunque la cotización diga "Sí"', () => {
    for (const vatCondition of ['monotributo', 'exempt']) {
      const r = computeQuote(hydro(ON), { settings: { vatCondition } });
      assert.deepEqual(pick(r), base);
      assert.equal(r.kpis.vatFinancePct, 0);
      assert.ok(!r.completeness.items.some((i) => i.id === 'vat_finance'));
    }
    assert.equal(companyAllowsVatFinance({ vatCondition: 'registered' }), true);
    assert.equal(companyAllowsVatFinance({ vatCondition: null }), true);
    const q = hydro(ON);
    assert.equal(withCompanyVatCondition(q, { vatCondition: 'registered' }), q, 'sin copia si no cambia nada');
  });
  test('la composición del precio con K-03 apagado no tiene la fila', () => {
    const c = priceComposition(computeQuote(hydro(undefined)));
    assert.ok(!c.rows.some((r) => r.key === 'vat_finance'));
    assert.equal(c.vatFinance, 0);
  });
});

describe('K-03 · encendido', () => {
  test('va al divisor: misma ganancia (margen), mismos impuestos (10 %), costo igual', () => {
    const off = computeQuote(hydro(undefined));
    const on = computeQuote(hydro(ON));
    const tv = 21 * 0.03 * 40 / 30;
    close(on.kpis.vatFinancePct, tv);
    close(on.kpis.grossUpPct, 10 + tv);
    assert.equal(on.kpis.billingTaxPct, 10, '"impuestos" sigue siendo sólo los impuestos');
    close(on.kpis.totalCost, off.kpis.totalCost);
    const m = on.kpis.targetMarginPct;
    close(on.kpis.targetNetRate, off.kpis.targetNetRate * (100 - m - 10) / (100 - m - 10 - tv), 1e-9);
    close(on.kpis.floorNetRate, off.kpis.floorNetRate * 90 / (90 - tv), 1e-9);
  });
  test('la composición cierra con su fila "Costo financiero del IVA"', () => {
    const r = computeQuote(hydro(ON));
    const c = priceComposition(r);
    assert.equal(c.allChecksOk, true, JSON.stringify(c.checks.filter((x) => x.ok === false)));
    const row = c.rows.find((x) => x.key === 'vat_finance');
    assert.ok(row && row.label === 'Costo financiero del IVA');
    close(row.amount, r.kpis.vatFinance);
    close(c.revenue, c.cost + c.billingTaxes + c.vatFinance + c.profit, 1e-9);
    assert.ok(c.checks.some((x) => x.id === 'vat_finance_rate' && x.ok === true));
    assert.ok(c.groups.some((g) => g.key === 'vat_finance'));
    const sum = c.rows.reduce((s, x) => s + x.displayPct, 0);
    close(Math.round(sum * 100) / 100, 100);
  });
  test('escalera de precios: precio = costo + impuestos + IVA + ganancia', () => {
    const rows = priceLadder(100, [10], null, 10, 1);
    close(rows[1].price, 100 / 0.79);
    close(rows[1].price - rows[1].billingTaxes - rows[1].vatFinance - rows[1].gain, 100);
    assert.deepEqual(priceLadder(100, [10], null, 10).map((x) => x.price), priceLadder(100, [10], null, 10, 0).map((x) => x.price));
  });
  test('escenario +30 días de plazo de cobro: sube t_iva', () => {
    const q = hydro(ON);
    const base = computeQuote(q).kpis.vatFinancePct;
    const more = computeQuote(applySensitivity(q, { paymentTermDays: 30 })).kpis.vatFinancePct;
    assert.ok(more > base, `${more} > ${base}`);
    close(more - base, 21 * 0.03 * 30 / 30);
  });
  test('comparador de modelos: cada modelo logra el margen objetivo con el IVA en el divisor', () => {
    const q = hydro(ON);
    const cmp = compareCommercialModels(q, { settings: {} });
    const m = cmp.targetMarginPct;
    assert.ok(cmp.models.length > 0);
    close(cmp.models[0].expectedMarginPct, m, 1e-9);
    close(cmp.vatFinancePct, 21 * 0.03 * 40 / 30);
  });
  test('margen + impuestos + t_iva ≥ 100 → margen inválido y error en el margen', () => {
    // 21 × 3 % × 60/30 = 1,26 puntos: 89 + 10 < 100 pero 89 + 10 + 1,26 ≥ 100.
    const r = computeQuote(hydro({ ...ON, payLagDays: 0 }, { margin: 89 }));
    assert.equal(r.kpis.targetMarginInvalid, true);
    assert.equal(r.kpis.targetListRate, null);
    assert.ok(r.issues.some((i) => i.path === 'pricing.targetMarginPct' && /costo financiero del IVA/.test(i.message) && i.severity === 'error'));
    // Sin el IVA el mismo margen es válido.
    assert.equal(computeQuote(hydro(undefined, { margin: 89 })).kpis.targetMarginInvalid, false);
  });
  test('"Ver cálculo" del costo financiero dice la fórmula, los números y el criterio', () => {
    const t = computeQuote(hydro(ON)).traces.financialCost;
    const step = t.steps.find((s) => s.label.startsWith('Costo financiero del IVA = IVA × tasa × (plazo de cobro − días hasta pagar el IVA)/30'));
    assert.ok(step && /21 % × 3 % × 40\/30/.test(step.value), step && step.value);
    assert.ok(t.notes.some((n) => n.startsWith('El IVA no es costo ni ganancia: sólo cuesta financiarlo. Sólo se descuenta el IVA de los externos cargados (criterio conservador).')));
  });
});

describe('K-03 · crédito fiscal de los externos', () => {
  test('alivio = IVA recuperable × tasa × d/30, restado del financiero', () => {
    const off = computeQuote(withRental(hydro(undefined), { supplierPayDays: 0 }));
    const on = computeQuote(withRental(hydro(ON), { supplierPayDays: 0 }));
    const D = on.kpis.activeDays;
    const expected = 210000 * D * 0.03 * 40 / 30;
    close(on.kpis.vatReliefMonthly, expected, 1e-9);
    close(off.kpis.financialCost - on.kpis.financialCost, expected, 1e-9);
    close(off.kpis.totalCost - on.kpis.totalCost, expected * (1 + on.model.contingency.pct / 100), 1e-6);
    assert.equal(priceComposition(on).allChecksOk, true);
  });
  test('IVA no recuperable o sin definir: crédito 0 (criterio conservador)', () => {
    for (const recoverable of ['no', null]) {
      const r = computeQuote(withRental(hydro(ON), { recoverable, supplierPayDays: 0 }));
      assert.equal(r.kpis.vatReliefMonthly, 0, String(recoverable));
    }
  });
  test('el alivio nunca deja el costo financiero negativo (piso 0)', () => {
    // Tasa 3 %, todo pagado a 90 días (nada que financiar) y un alquiler enorme con IVA recuperable.
    const q = withRental(hydro(ON), { supplierPayDays: 90, price: 50000000 });
    q.finance.invoiceLagDays = 0;
    q.finance.payDays = { salaries: 90, fuel: 90, suppliers: 90, materials: 90, structure: 90 };
    const r = computeQuote(q);
    assert.ok(r.model.finance.vatRelief.creditPerActiveDay > 0);
    assert.ok(r.kpis.financialCost >= 0);
    assert.ok(r.model.finance.fixedMonthly >= 0 && r.model.finance.variablePerActiveDay >= 0);
    assert.ok(r.model.byCategory.financial.fixedMonthly >= 0 && r.model.byCategory.financial.variablePerActiveDay >= 0);
    assert.equal(r.kpis.financialCost, 0);
  });
});

describe('K-03 · cotización nueva, completitud y validación', () => {
  const registered = { ...defaultSettings('org'), illustrative: false, vatCondition: 'registered', defaultVat: { ratePct: 21, payLagDays: 20 } };
  test('copia los valores de la empresa: "Sí" sólo con los dos números y responsable inscripto', () => {
    assert.deepEqual(vatFinanceForNewQuote(registered), { applies: true, ratePct: 21, payLagDays: 20 });
    assert.deepEqual(vatFinanceForNewQuote({ ...registered, vatCondition: null }), { applies: null, ratePct: 21, payLagDays: 20 });
    assert.deepEqual(vatFinanceForNewQuote({ ...registered, defaultVat: { ratePct: 21, payLagDays: null } }), { applies: null, ratePct: 21, payLagDays: null });
    assert.deepEqual(createEmptyQuote({ organizationId: 'org', settings: registered }).finance.vat, { applies: true, ratePct: 21, payLagDays: 20 });
    assert.deepEqual(createEmptyQuote({ organizationId: 'org' }).finance.vat, emptyVatFinance());
  });
  const itemOf = (q, settings = {}) => computeQuote(q, { settings }).completeness.items.find((i) => i.id === 'vat_finance') || null;
  test('sin decidir con plazo de cobro: amarillo con peso 0 ("¿Facturás con IVA?")', () => {
    const item = itemOf(hydro(emptyVatFinance()));
    assert.equal(item.status, 'warning');
    assert.equal(item.weight, 0);
    assert.match(item.message, /¿Facturás con IVA\?/);
    assert.equal(item.focus, 'finance.vat.applies');
    // Mismo puntaje que sin el campo.
    assert.equal(computeQuote(hydro(emptyVatFinance())).completeness.scorePct, computeQuote(hydro(undefined)).completeness.scorePct);
  });
  test('sin el campo (cotizaciones anteriores), sin plazo o con monotributo: no se pregunta', () => {
    assert.equal(itemOf(hydro(undefined)), null);
    assert.equal(itemOf(hydro(emptyVatFinance(), { term: 0 })), null);
    assert.equal(itemOf(hydro(emptyVatFinance()), { vatCondition: 'monotributo' }), null);
  });
  test('"Sí" con un número faltante: amarillo y lleva al campo', () => {
    const item = itemOf(hydro({ applies: true, ratePct: 21, payLagDays: null }));
    assert.equal(item.status, 'warning');
    assert.equal(item.focus, 'finance.vat.payLagDays');
  });
  test('validación: IVA 0 a < 100 y días 0 a 720', () => {
    const paths = (vat) => validateQuote(hydro(vat)).map((i) => i.path);
    assert.ok(paths({ applies: true, ratePct: 100, payLagDays: 20 }).includes('finance.vat.ratePct'));
    assert.ok(paths({ applies: true, ratePct: -1, payLagDays: 20 }).includes('finance.vat.ratePct'));
    assert.ok(paths({ applies: true, ratePct: 21, payLagDays: 721 }).includes('finance.vat.payLagDays'));
    assert.deepEqual(paths(ON).filter((p) => p.startsWith('finance.vat')), []);
  });
});
