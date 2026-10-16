/**
 * Golden cases (Prompt 4 §21) — casos de referencia del negocio.
 *
 * Cada archivo .json de esta carpeta es un caso con el formato:
 *   { id, title, rule, engine, inputs, expected, tolerance }
 *
 *   engine    motor a usar (ver ENGINES abajo)
 *   inputs    entradas de negocio del caso
 *   expected  { "ruta.en.el.resultado": valor } — los motores escalares devuelven { value }
 *   tolerance tolerancia absoluta para los valores numéricos
 *
 * Estos casos deben seguir siendo válidos aunque cambie la interfaz. Si un cambio de
 * fórmula rompe un golden case, el cambio es un cambio de REGLA DE NEGOCIO: se documenta y
 * se discute antes de tocar el caso.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceFromMargin, priceFromMarkup, marginToMarkup, markupToMargin, priceFromMarginAndTaxes, markupWithTaxesPct, profitOnCostPct } from '../../js/engines/pricing-engine.js';
import { breakEvenSimple, minimumRateForDays } from '../../js/engines/break-even-engine.js';
import { simpleFinancialCost } from '../../js/engines/finance-engine.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeExternalLine } from '../../js/engines/external-engine.js';
import { computeMobilization } from '../../js/engines/mobilization-engine.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { demoReferenceQuote } from '../../js/domain/demo-data.js';
import { getPath } from '../../js/core/object.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';
import { transportQuote } from '../fixtures/cot-0010.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REQUIRED_KEYS = ['id', 'title', 'rule', 'engine', 'inputs', 'expected', 'tolerance'];

/**
 * Cotización on-call mínima a partir de entradas de negocio, sobre la base de la demo de
 * referencia (sin personal, equipos, logística, financiero ni contingencia):
 *   fijos mensuales → otro costo fijo; variable por día → otro costo por día activo.
 * Con ratePerDay → modo A "conozco la tarifa"; sin ratePerDay → modo B "conozco la actividad".
 * Con billingTaxPct → impuestos sobre la facturación como "% total"; sin él quedan sin definir (t = 0).
 */
function onCallQuote(inputs) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = inputs.fixedCosts ?? 0;
  q.otherCosts[1].amount = inputs.variableCostPerDay ?? 0;
  q.activity.activeDaysPerMonth = inputs.activeDays ?? 0;
  q.activity.availableDaysPerMonth = inputs.availableDaysPerMonth ?? 30;
  const hasRate = inputs.ratePerDay !== undefined && inputs.ratePerDay !== null;
  q.pricingMode = hasRate ? 'known_rate' : 'known_activity';
  q.pricing = { ...q.pricing, knownRate: hasRate ? inputs.ratePerDay : 0, targetMarginPct: inputs.targetMarginPct ?? 0, roundingStep: 0, offeredRateOverride: null };
  q.rules = {
    ...q.rules,
    availabilityFeeMonthly: inputs.availabilityFeeMonthly ?? 0,
    minimumMonthlyGuarantee: inputs.minimumMonthlyGuarantee ?? 0,
  };
  if (inputs.billingTaxPct !== undefined && inputs.billingTaxPct !== null) {
    q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: inputs.billingTaxPct, items: [] };
  }
  return q;
}

/**
 * Cotización facturada en cualquier unidad (PLAN-2026-009) sobre la base de la
 * demo de referencia: fijos mensuales → otro costo fijo; variable por día de
 * trabajo → otro costo por día activo. Por cantidad (m³, viaje, unidad…) la
 * actividad es la cantidad del mes y el rendimiento por día; por día, los días.
 */
function unitQuote(inputs) {
  const q = onCallQuote({ ...inputs, ratePerDay: inputs.rate, activeDays: inputs.activeDays ?? 0 });
  q.serviceType = inputs.serviceType ?? q.serviceType;
  q.unit = inputs.unit ?? 'day';
  q.unitName = inputs.unitName ?? '';
  q.activity.billableQuantityPerMonth = inputs.quantityPerMonth ?? null;
  q.activity.unitsPerActiveDay = inputs.unitsPerActiveDay ?? null;
  q.activity.daysPerActivation = inputs.daysPerActivation ?? 1;
  return q;
}

/** Despacho por "engine". Los motores escalares se envuelven como { value }. */
const ENGINES = {
  'pricing.priceFromMargin': ({ cost, marginPct }) => ({ value: priceFromMargin(cost, marginPct) }),
  'pricing.priceFromMarkup': ({ cost, markupPct }) => ({ value: priceFromMarkup(cost, markupPct) }),
  'pricing.marginToMarkup': ({ marginPct }) => ({ value: marginToMarkup(marginPct) }),
  'pricing.markupToMargin': ({ markupPct }) => ({ value: markupToMargin(markupPct) }),
  'pricing.priceFromMarginAndTaxes': ({ cost, marginPct, billingTaxPct }) => ({ value: priceFromMarginAndTaxes(cost, marginPct, billingTaxPct) }),
  'pricing.markupWithTaxesPct': ({ marginPct, billingTaxPct }) => ({ value: markupWithTaxesPct(marginPct, billingTaxPct) }),
  'pricing.profitOnCostPct': ({ marginPct, billingTaxPct }) => ({ value: profitOnCostPct(marginPct, billingTaxPct) }),
  'break-even.simple': (inputs) => breakEvenSimple(inputs),
  'break-even.minimumRateForDays': (inputs) => ({ value: minimumRateForDays(inputs) }),
  'finance.simpleFinancialCost': ({ amount, monthlyRatePct, days }) => ({ value: simpleFinancialCost(amount, monthlyRatePct, days) }),
  'quote.onCall': (inputs) => computeQuote(onCallQuote(inputs)),
  'quote.demoReference': () => computeQuote(demoReferenceQuote()),
  'quote.byUnit': (inputs) => computeQuote(unitQuote(inputs)),
  // PLAN-2026-010: cotización de prueba de punta a punta (reconstruida del PDF auditado).
  'quote.cot0009': (inputs) => computeQuote(cot0009Quote(inputs)),
  // PLAN-2026-012: transporte $/viaje de punta a punta (COT-0010 / COT-0011).
  'quote.transport': (inputs) => computeQuote(transportQuote(inputs)),
  // PLAN-2026-008: costo por unidad y precio de un producto.
  'product.compute': ({ product }) => computeProduct(product),
  // PLAN-2026-005: tarifa externa (precio neto + tratamiento fiscal) y movilización propia.
  'external.line': ({ price, unit, quantity = 1, minimumUnits = null, daysPerActivation = 1, hoursPerActiveDay = 0, vatPct = null, vatRecoverable = null, tripsPerActivation = 0, routeKmPerActivation = 0 }) =>
    computeExternalLine(
      { acquisition: 'rented', quantity, hoursPerActiveDay, external: { price, unit, minimumUnits, fiscal: { vatPct, vatRecoverable } } },
      { daysPerActivation, tripsPerActivation, routeKmPerActivation },
    ),
  'mobilization.self': ({ distanceKm, roundTrip = true, litersPer100Km, fuelPricePerLiter, costPerKm, quantity = 1, daysPerActivation = 1 }) =>
    computeMobilization(
      [{ id: 'eq', name: 'Equipo', acquisition: 'owned', quantity, mobilization: { mode: 'self', travelLitersPer100Km: litersPer100Km, travelCostPerKm: costPerKm, driver: 'operator' } }],
      { routeKmPerActivation: distanceKm * (roundTrip ? 2 : 1), daysPerActivation, fuelPricePerLiter, fuelPaidByUs: true },
    ),
};

function loadCases() {
  return readdirSync(HERE)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(HERE, file), 'utf8')) }));
}

function assertMatches(actual, expected, tolerance, label) {
  if (typeof expected === 'number') {
    assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${label}: se esperaba un número finito y se obtuvo ${actual}`);
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: esperado ${expected}, obtenido ${actual} (tolerancia ${tolerance})`);
  } else {
    assert.deepEqual(actual, expected, `${label}: esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)}`);
  }
}

const cases = loadCases();

describe('Golden cases — estructura de los casos', () => {
  test('hay al menos los 8 casos de referencia obligatorios', () => {
    const ids = cases.map((c) => c.data.id);
    for (const required of [
      'on-call-basico',
      'margen-10-sobre-precio',
      'markup-10-sobre-costo',
      'conversion-margen-a-markup',
      'tarifa-piso-8-dias',
      'tarifa-margen-10-con-10-dias',
      'costo-financiero-simple',
      'caso-demo-referencia',
      // PLAN-2026-002: impuestos sobre la facturación (gross-up exacto).
      'gross-up-impuestos-facturacion',
      'tarifa-piso-con-impuestos',
      'markup-con-impuestos',
      'ganancia-sobre-costo-con-impuestos',
      'on-call-break-even-con-impuestos',
      'on-call-tarifa-minima-6-dias-con-impuestos',
      'on-call-cotizacion-con-impuestos',
    ]) {
      assert.ok(ids.includes(required), `falta el golden case ${required}`);
    }
  });

  test('cada caso tiene { id, title, rule, engine, inputs, expected, tolerance } válidos', () => {
    for (const { file, data } of cases) {
      for (const key of REQUIRED_KEYS) assert.ok(key in data, `${file}: falta "${key}"`);
      assert.equal(data.id, basename(file, '.json'), `${file}: el id debe coincidir con el nombre del archivo`);
      assert.ok(typeof data.title === 'string' && data.title.length > 0, `${file}: título vacío`);
      assert.ok(typeof data.rule === 'string' && data.rule.length > 0, `${file}: regla de negocio vacía`);
      assert.ok(data.engine in ENGINES, `${file}: motor desconocido "${data.engine}"`);
      assert.ok(data.inputs && typeof data.inputs === 'object' && !Array.isArray(data.inputs), `${file}: inputs debe ser un objeto`);
      assert.ok(data.expected && typeof data.expected === 'object' && Object.keys(data.expected).length > 0, `${file}: expected vacío`);
      assert.ok(typeof data.tolerance === 'number' && data.tolerance >= 0, `${file}: tolerancia inválida`);
    }
  });

  test('los ids no se repiten', () => {
    const ids = cases.map((c) => c.data.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('Golden cases — reglas de negocio', () => {
  for (const { file, data } of cases) {
    test(`${data.title} — ${data.rule}`, () => {
      const run = ENGINES[data.engine];
      assert.ok(run, `${file}: motor desconocido "${data.engine}"`);
      const result = run(structuredClone(data.inputs));
      for (const [path, expected] of Object.entries(data.expected)) {
        const actual = path === 'value' ? result.value : getPath(result, path);
        assertMatches(actual, expected, data.tolerance, `${data.id} → ${path}`);
      }
    });
  }
});
