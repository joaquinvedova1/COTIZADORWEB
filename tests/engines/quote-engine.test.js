/**
 * Contrato del negocio — QuoteEngine (cotización completa).
 *
 * Reglas (Prompt 1 "Lógica central", "Dos formas de iniciar una cotización", "Servicio on-call";
 * Prompt 3 "Dos modos obligatorios", "Matriz", "Reglas comerciales MVP", "Descuentos";
 * Prompt 2 "Tests económicos"; Prompt 4 §20–21):
 *   COSTO → TARIFA PISO (margen 0) → PRECIO OBJETIVO (margen objetivo) → PRECIO COMERCIAL (lista).
 *   Modo A "Conozco la tarifa": días mínimos, break-even, resultado y margen esperados.
 *   Modo B "Conozco la actividad": tarifa piso y tarifas para margen 5/10/15 %.
 *   Caso de referencia (golden): fijos 30M, variable 1M/día, tarifa 4M/día, 8 días estimados →
 *     break-even 10 días, tarifa piso 4.750.000, facturación 32M, resultado −6M.
 *   kpis.atRisk = sin tarifa || resultado < 0 || margen < objetivo || completitud < 60 %.
 *   kpis.incomplete = completitud < 60 %.
 *   Determinismo: mismos inputs → mismos outputs; computeQuote no muta la cotización.
 *   Nunca NaN ni ±Infinity en los resultados.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote, summarizeQuote, evaluateDiscountTiers } from '../../js/engines/quote-engine.js';
import { DEFAULT_VOLUME_TIERS } from '../../js/engines/commercial-rules-engine.js';
import { COMPLETENESS_RISK_THRESHOLD } from '../../js/engines/completeness-engine.js';
import { createDemoState, demoReferenceQuote, demoHydroCraneQuote } from '../../js/domain/demo-data.js';
import { createEmptyQuote, defaultSettings } from '../../js/domain/quote-factory.js';
import { deepFreeze } from '../../js/core/object.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Lista las rutas con NaN / ±Infinity dentro de un valor (recursivo). */
function findNonFinite(value, path = 'resultado', out = [], seen = new Set()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`);
    return out;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return out;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) findNonFinite(v, `${path}.${k}`, out, seen);
  }
  return out;
}

/** Reemplaza recursivamente todos los números de un objeto. */
function mapNumbers(value, fn) {
  if (typeof value === 'number') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapNumbers(v, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapNumbers(v, fn)]));
  return value;
}

/**
 * Cotización on-call de referencia (demo "Caso de referencia"): fijos F (otros costos, categoría
 * equipos), variable v por día activo (categoría personal), sin financiero ni contingencia.
 */
function onCall({ fixed = 30_000_000, variable = 1_000_000, activeDays = 8, availableDays = 30, knownRate = 4_000_000, targetMarginPct = 10, pricingMode = 'known_rate', rules = {}, pricing = {}, unit = 'day', contractMonths = 12 } = {}) {
  const q = demoReferenceQuote();
  q.otherCosts[0].amount = fixed;
  q.otherCosts[1].amount = variable;
  q.activity.activeDaysPerMonth = activeDays;
  q.activity.availableDaysPerMonth = availableDays;
  q.pricingMode = pricingMode;
  q.unit = unit;
  q.contractMonths = contractMonths;
  q.pricing = { ...q.pricing, knownRate, targetMarginPct, ...pricing };
  q.rules = { ...q.rules, ...rules };
  return q;
}

function tiers(discounts) {
  return DEFAULT_VOLUME_TIERS.map((t, i) => ({ ...t, discountPct: discounts[i] ?? 0 }));
}

describe('QuoteEngine — caso de referencia (golden): F 30M, v 1M/día, tarifa 4M/día, 8 días', () => {
  const r = computeQuote(demoReferenceQuote());
  const k = r.kpis;

  test('break-even 10 días (contribución 3M/día)', () => {
    approx(k.breakEvenDays, 10);
    assert.equal(k.breakEvenWholeDays, 10);
    approx(r.linear.contributionPerDay, 3_000_000);
    approx(r.traces.breakEven.result.value, 10);
  });

  test('tarifa piso con 8 días = 4.750.000 (38M / 8)', () => {
    approx(k.floorNetRate, 4_750_000);
    approx(k.totalCost, 38_000_000);
    approx(k.fixedCosts, 30_000_000);
    approx(k.variableCosts, 8_000_000);
    approx(k.costPerActiveDay, 4_750_000);
  });

  test('facturación 32M y resultado −6M: margen −18,75 % sobre precio y markup −15,79 % sobre costo', () => {
    approx(k.revenue, 32_000_000);
    approx(k.profit, -6_000_000);
    approx(k.marginPct, (-6 / 32) * 100);
    approx(k.markupPct, (-6 / 38) * 100);
  });

  test('tarifa objetivo (margen 10 %) con 8 días = 38M / 0,9 / 8 = 5.277.777,78', () => {
    approx(k.targetNetRate, 38_000_000 / 0.9 / 8);
  });

  test('días para lograr el margen objetivo con 4M/día: 4D − 30M − D = 10 % × 4D → D = 30 / 2,6 = 11,54', () => {
    approx(k.targetMarginDays, 30 / 2.6);
    assert.equal(k.targetMarginWholeDays, 12);
  });

  test('la tarifa ofrecida está debajo del piso y la cotización está en riesgo', () => {
    assert.equal(k.belowFloor, true);
    assert.equal(k.belowTarget, true);
    assert.equal(k.atRisk, true);
    assert.equal(k.commercialSource, 'known_rate');
  });

  test('equivalencias: 4M/día con 10 h/día = 400.000/hora; mensual = facturación', () => {
    approx(r.equivalents.perHour, 400_000);
    approx(r.equivalents.perDay, 4_000_000);
    approx(r.equivalents.perMonth, 32_000_000);
  });

  test('todo resultado importante tiene su traza ("Ver cálculo") con fórmula y resultado', () => {
    for (const key of ['totalCost', 'breakEven', 'floorRate', 'targetRate', 'expectedResult', 'financialCost', 'logistics']) {
      const t = r.traces[key];
      assert.ok(t && typeof t.formula === 'string' && t.formula.length > 0, `traza ${key}`);
      assert.ok(t.result && 'value' in t.result, `resultado de la traza ${key}`);
      assert.ok(Array.isArray(t.inputs) && t.inputs.length > 0, `entradas de la traza ${key}`);
    }
    approx(r.traces.expectedResult.result.value, -6_000_000);
    approx(r.traces.floorRate.result.value, 4_750_000);
  });
});

describe('QuoteEngine — modo A (conozco la tarifa) vs modo B (conozco la actividad)', () => {
  test('modo B sin redondeo: la tarifa sugerida es la del margen objetivo y el margen esperado es 10 %', () => {
    const r = computeQuote(onCall({ pricingMode: 'known_activity', pricing: { roundingStep: 0 } }));
    assert.equal(r.kpis.commercialSource, 'suggested');
    approx(r.kpis.commercialListRate, 38_000_000 / 0.9 / 8);
    approx(r.kpis.marginPct, 10);
    approx(r.kpis.profit, 38_000_000 / 0.9 - 38_000_000);
    assert.equal(r.kpis.belowTarget, false);
    // break-even con la tarifa sugerida: 30M / (5.277.777,78 − 1M) = 7,013 días
    approx(r.kpis.breakEvenDays, 30_000_000 / (38_000_000 / 7.2 - 1_000_000));
  });

  test('modo B con redondeo comercial a 1.000: la tarifa sugerida se redondea hacia arriba (nunca baja el margen)', () => {
    const r = computeQuote(onCall({ pricingMode: 'known_activity', pricing: { roundingStep: 1000 } }));
    assert.equal(r.kpis.suggestedListRate, 5_278_000);
    assert.ok(r.kpis.marginPct >= 10);
  });

  test('las tarifas necesarias (piso y objetivo) no dependen del modo elegido', () => {
    const a = computeQuote(onCall({ pricingMode: 'known_rate' }));
    const b = computeQuote(onCall({ pricingMode: 'known_activity' }));
    approx(a.kpis.floorNetRate, b.kpis.floorNetRate);
    approx(a.kpis.targetNetRate, b.kpis.targetNetRate);
    assert.deepEqual(a.matrix.map((m) => m.floorNetRate), b.matrix.map((m) => m.floorNetRate));
  });

  test('modo B calcula tarifa piso y tarifas para margen 5 %, 10 % y 15 % con la actividad estimada', () => {
    const r = computeQuote(onCall({ pricingMode: 'known_activity' }));
    const byMargin = Object.fromEntries(r.ratesAtEstimate.byMargin.map((m) => [m.marginPct, m.netRate]));
    approx(r.ratesAtEstimate.floorNetRate, 4_750_000);
    approx(byMargin[5], 38_000_000 / 0.95 / 8);
    approx(byMargin[10], 38_000_000 / 0.9 / 8);
    approx(byMargin[15], 38_000_000 / 0.85 / 8);
  });

  test('modo B con tarifa ofrecida manual → se evalúa esa tarifa', () => {
    const r = computeQuote(onCall({ pricingMode: 'known_activity', pricing: { offeredRateOverride: 5_000_000 } }));
    assert.equal(r.kpis.commercialSource, 'offered');
    approx(r.kpis.revenue, 40_000_000);
  });

  test('modo A sin tarifa ingresada → no hay tarifa comercial ni break-even, pero sí tarifa piso', () => {
    for (const empty of [0, '', null]) {
      const r = computeQuote(onCall({ knownRate: empty }));
      assert.equal(r.kpis.commercialListRate, null, `tarifa ${String(empty)}`);
      assert.equal(r.kpis.breakEvenDays, null);
      assert.equal(r.kpis.atRisk, true);
      approx(r.kpis.floorNetRate, 4_750_000);
    }
  });

  test('una tarifa forzada desde afuera (sensibilidad) reemplaza a la de la cotización', () => {
    const r = computeQuote(onCall(), { listRateOverride: 5_000_000 });
    assert.equal(r.kpis.commercialSource, 'override');
    approx(r.kpis.revenue, 40_000_000);
  });
});

describe('QuoteEngine — matriz tarifa × utilización', () => {
  const r = computeQuote(onCall());

  test('incluye 5, 8, 10, 15 y 20 días y marca la actividad estimada', () => {
    assert.deepEqual(r.matrix.map((m) => m.activeDays), [5, 8, 10, 15, 20]);
    assert.equal(r.matrix.find((m) => m.activeDays === 8).isEstimate, true);
  });

  test('la tarifa necesaria decrece al aumentar los días (piso y cada margen)', () => {
    for (let i = 1; i < r.matrix.length; i += 1) {
      assert.ok(r.matrix[i].floorNetRate < r.matrix[i - 1].floorNetRate);
      r.matrix[i].byMargin.forEach((b, j) => assert.ok(b.netRate < r.matrix[i - 1].byMargin[j].netRate));
    }
  });

  test('tarifa margen 10 % con 10 días = 4.444.444,44; tarifa piso con 8 días = 4.750.000', () => {
    const ten = r.matrix.find((m) => m.activeDays === 10);
    approx(ten.byMargin.find((b) => b.marginPct === 10).netRate, 40_000_000 / 0.9 / 10);
    approx(r.matrix.find((m) => m.activeDays === 8).floorNetRate, 4_750_000);
  });

  test('con la tarifa ofrecida cada fila informa facturación, costo y resultado', () => {
    const ten = r.matrix.find((m) => m.activeDays === 10);
    approx(ten.revenue, 40_000_000);
    approx(ten.cost, 40_000_000);
    approx(ten.profit, 0);
  });

  test('la configuración puede cambiar los días de la matriz y la escalera de márgenes (el margen objetivo siempre se incluye)', () => {
    const custom = computeQuote(onCall(), { settings: { matrixDays: [6, 12], marginLadder: [20] } });
    assert.deepEqual(custom.matrix.map((m) => m.activeDays), [6, 8, 12]);
    // Escalera configurada (20 %) + margen objetivo de la cotización.
    assert.deepEqual(custom.matrix[0].byMargin.map((b) => b.marginPct), [20, custom.targetMarginPct]);
  });

  test('la matriz incluye el margen objetivo aunque no esté en la escalera (12 % con escalera 5/10/15)', () => {
    const q = onCall();
    q.pricing = { ...q.pricing, targetMarginPct: 12 };
    const r = computeQuote(q);
    assert.ok(r.matrix.every((m) => m.byMargin.some((b) => b.marginPct === 12)));
  });

  test('el margen personalizado se agrega a la escalera y a la matriz (demo hidrogrúa: 20 %)', () => {
    const hydro = computeQuote(demoHydroCraneQuote());
    assert.equal(hydro.customMarginPct, 20);
    assert.ok(hydro.ratesAtEstimate.byMargin.some((b) => b.marginPct === 20));
    assert.ok(hydro.matrix.every((m) => m.byMargin.some((b) => b.marginPct === 20)));
  });
});

describe('QuoteEngine — reglas comerciales en la cotización', () => {
  test('fee de disponibilidad 6M: break-even = (30M − 6M) / (4M − 1M) = 8 días', () => {
    const r = computeQuote(onCall({ rules: { availabilityFeeMonthly: 6_000_000 } }));
    approx(r.kpis.breakEvenDays, 8);
    approx(r.kpis.revenue, 38_000_000);
    approx(r.kpis.profit, 0);
    approx(r.linear.fixedRevenue, 6_000_000);
    assert.match(r.traces.breakEven.formula, /Ingresos fijos/);
  });

  test('break-even inalcanzable cuando la tarifa no supera el costo variable (p ≤ v)', () => {
    for (const rate of [1_000_000, 800_000]) {
      const r = computeQuote(onCall({ knownRate: rate }));
      assert.equal(r.kpis.breakEvenDays, null, `tarifa ${rate}`);
      assert.equal(r.breakEven.reachable, false);
      assert.equal(typeof r.breakEven.reason, 'string');
      assert.equal(r.kpis.belowFloor, true);
      approx(r.kpis.profit, rate * 8 - 38_000_000);
    }
  });

  test('mínimo garantizado 35M: factura 35M con 8 días y el break-even robusto es 10 días', () => {
    // Resultado(D) = max(35M, 4M·D) − 30M − 1M·D: gana con D ≤ 5, pierde entre 5 y 10, no pierde desde 10.
    const r = computeQuote(onCall({ rules: { minimumMonthlyGuarantee: 35_000_000 } }));
    approx(r.kpis.revenue, 35_000_000);
    approx(r.kpis.profit, -3_000_000);
    approx(r.kpis.breakEvenDays, 10);
    assert.equal(r.linear.hasNonLinearRules, true);
  });

  test('standby: 2 días × 500.000 = 1M de ingreso fijo → break-even (30M − 1M) / 3M = 9,67 días', () => {
    const r = computeQuote(onCall({ rules: { standbyDaysPerMonth: 2, standbyRatePerDay: 500_000 } }));
    approx(r.kpis.revenue, 33_000_000);
    approx(r.kpis.breakEvenDays, 29 / 3);
  });

  test('minimum call de 2 días por llamado de 1 día: factura 16 días (64M) → break-even 30M / 7M = 4,29 días', () => {
    const r = computeQuote(onCall({ rules: { minimumCallUnits: 2 } }));
    approx(r.kpis.revenue, 64_000_000);
    approx(r.kpis.breakEvenDays, 30 / 7);
  });

  test('call-out fee 500.000 por activación: +4M con 8 activaciones → break-even 30M / 3,5M = 8,57 días', () => {
    const r = computeQuote(onCall({ rules: { calloutFeePerActivation: 500_000 } }));
    approx(r.kpis.revenue, 36_000_000);
    approx(r.kpis.breakEvenDays, 30 / 3.5);
  });

  test('movilización 250.000 por activación: +2M con 8 activaciones', () => {
    const r = computeQuote(onCall({ rules: { mobilizationFeePerActivation: 250_000 } }));
    approx(r.kpis.revenue, 34_000_000);
  });

  test('km adicional: (220 km − 100 incluidos) × 1.000 $/km × 8 activaciones = 960.000', () => {
    const q = onCall({ rules: { includedKmPerActivation: 100, extraKmRate: 1_000 } });
    q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 110, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
    const r = computeQuote(q);
    approx(r.estimate.revenue.components.extraKm, 960_000);
    approx(r.kpis.revenue, 32_960_000);
  });

  test('descuento por volumen: tramo 8–15 días al 5 % → neta 3,8M; la tarifa de lista piso = 4,75M / 0,95 = 5M', () => {
    const r = computeQuote(onCall({ rules: { volumeTiers: tiers([0, 0, 5, 10, 15]) } }));
    approx(r.kpis.commercialNetRate, 3_800_000);
    approx(r.kpis.revenue, 30_400_000);
    approx(r.kpis.floorNetRate, 4_750_000);
    approx(r.kpis.floorListRate, 5_000_000);
  });

  test('descuento por continuidad (permanencia ≥ 6 meses, 5 %): baja la tarifa neta y se clasifica', () => {
    const rules = { continuityMinMonths: 6, continuityDiscountPct: 5 };
    const red = computeQuote(onCall({ rules }));
    assert.equal(red.continuity.applies, true);
    approx(red.kpis.commercialNetRate, 3_800_000);
    assert.equal(red.continuity.status, 'red', '3,8M < piso 4,75M');
    const green = computeQuote(onCall({ rules, knownRate: 6_000_000 }));
    approx(green.kpis.commercialNetRate, 5_700_000);
    assert.equal(green.continuity.status, 'green', '5,7M ≥ objetivo 5,28M');
    const short = computeQuote(onCall({ rules, contractMonths: 3 }));
    assert.equal(short.continuity.applies, false);
    approx(short.kpis.commercialNetRate, 4_000_000);
  });

  test('descuento comercial 10 % con tarifa fija → baja la facturación a 28,8M', () => {
    const r = computeQuote(onCall({ pricing: { commercialDiscountPct: 10 } }));
    approx(r.kpis.commercialNetRate, 3_600_000);
    approx(r.kpis.revenue, 28_800_000);
  });

  test('descuento que deja margen negativo: tarifa 6M con 50 % de descuento → neta 3M < piso → pierde 14M', () => {
    const r = computeQuote(onCall({ knownRate: 6_000_000, pricing: { commercialDiscountPct: 50 } }));
    approx(r.kpis.profit, 24_000_000 - 38_000_000);
    assert.ok(r.kpis.marginPct < 0);
    assert.equal(r.kpis.belowFloor, true);
    assert.equal(r.kpis.atRisk, true);
  });
});

describe('QuoteEngine — semáforo de descuentos por tramo (1, 2–7, 8–15, 16–30, +30)', () => {
  // Tarifa de lista 6M, margen objetivo 10 %, descuentos 0 / 0 / 5 / 50 / 70 %. Cada tramo se
  // evalúa en su peor caso (el primer día del tramo):
  //   1 día:    piso 31M → neta 6M → rojo
  //   2 días:   piso 16M → rojo
  //   8 días:   neta 5,7M; piso 4,75M; objetivo 5,28M → verde
  //   16 días:  neta 3M; piso 46M/16 = 2,875M; objetivo 3,19M → naranja
  //   31 días:  neta 1,8M; costo 30M × 31/30 + 31M = 62M → piso 2M → rojo
  const r = computeQuote(onCall({ knownRate: 6_000_000, rules: { volumeTiers: tiers([0, 0, 5, 50, 70]) } }));
  const status = Object.fromEntries(r.discounts.map((d) => [d.label, d]));

  test('etiquetas de los tramos', () => {
    assert.deepEqual(r.discounts.map((d) => d.label), ['1 día', '2–7 días', '8–15 días', '16–30 días', '+30 días']);
  });

  test('verde = mantiene el margen objetivo (8–15 días con 5 %)', () => {
    assert.equal(status['8–15 días'].status, 'green');
    approx(status['8–15 días'].netRate, 5_700_000);
    approx(status['8–15 días'].floorNetRate, 4_750_000);
  });

  test('naranja = debajo del margen objetivo pero sobre break-even (16–30 días con 50 %)', () => {
    const t = status['16–30 días'];
    assert.equal(t.status, 'orange');
    approx(t.floorNetRate, 46_000_000 / 16);
    approx(t.targetNetRate, 46_000_000 / 0.9 / 16);
    assert.ok(t.profit > 0 && t.marginPct < 10);
  });

  test('rojo = debajo de break-even: el descuento deja margen negativo (+30 días con 70 %)', () => {
    const t = status['+30 días'];
    assert.equal(t.status, 'red');
    approx(t.floorNetRate, 2_000_000);
    assert.ok(t.profit < 0);
    assert.equal(t.exceedsAvailability, true);
  });

  test('pocos días con fijos altos también es rojo aunque no haya descuento (1 día, 2–7 días)', () => {
    assert.equal(status['1 día'].status, 'red');
    assert.equal(status['2–7 días'].status, 'red');
  });

  test('sin tarifa comercial o con abono mensual no hay evaluación por tramos', () => {
    assert.deepEqual(computeQuote(onCall({ knownRate: 0 })).discounts, []);
    const monthly = computeQuote(onCall({ unit: 'month', knownRate: 50_000_000 }));
    assert.deepEqual(monthly.discounts, []);
    assert.deepEqual(evaluateDiscountTiers(monthly.ctx, 50_000_000, 10), []);
  });
});

describe('QuoteEngine — unidades de tarifa', () => {
  test('tarifa por hora: 400.000 $/h × 10 h × 8 días = 32M; piso por hora = 38M / 80 h = 475.000', () => {
    const r = computeQuote(onCall({ unit: 'hour', knownRate: 400_000 }));
    approx(r.kpis.revenue, 32_000_000);
    approx(r.kpis.floorNetRate, 475_000);
    approx(r.kpis.breakEvenDays, 10);
    approx(r.equivalents.perDay, 4_000_000);
    assert.equal(r.unitLabel, 'hora');
  });

  test('abono mensual: 50M/mes → resultado 12M; no hay break-even en días (no aplica)', () => {
    const r = computeQuote(onCall({ unit: 'month', knownRate: 50_000_000 }));
    approx(r.kpis.revenue, 50_000_000);
    approx(r.kpis.profit, 12_000_000);
    assert.equal(r.kpis.breakEvenDays, null);
    assert.equal(r.breakEven.notApplicable, true);
    approx(r.kpis.floorNetRate, 38_000_000, 'piso del abono = costo del mes');
  });
});

describe('QuoteEngine — indicadores de riesgo y completitud', () => {
  test('sin tarifa comercial → en riesgo', () => {
    assert.equal(computeQuote(onCall({ knownRate: 0 })).kpis.atRisk, true);
  });

  test('resultado negativo → en riesgo', () => {
    const k = computeQuote(onCall()).kpis;
    assert.ok(k.profit < 0);
    assert.equal(k.atRisk, true);
  });

  test('gana dinero pero con margen menor al objetivo (5 % < 10 %) → en riesgo, no debajo del piso', () => {
    const k = computeQuote(onCall({ knownRate: 5_000_000 })).kpis;
    approx(k.marginPct, 5);
    assert.equal(k.belowTarget, true);
    assert.equal(k.belowFloor, false);
    assert.equal(k.atRisk, true);
  });

  test('con margen sobre el objetivo y completitud ≥ 60 % → no está en riesgo', () => {
    const k = computeQuote(onCall({ knownRate: 6_000_000 })).kpis;
    approx(k.marginPct, (10 / 48) * 100);
    assert.ok(k.completenessPct >= COMPLETENESS_RISK_THRESHOLD);
    assert.equal(k.incomplete, false);
    assert.equal(k.atRisk, false);
  });

  test('completitud < 60 % → incompleta y en riesgo aunque el resultado sea positivo', () => {
    const q = onCall({ knownRate: 6_000_000 });
    q.finance.paymentTermDays = null;
    q.materialsNotApplicable = false;
    q.logistics.notApplicable = false;
    const k = computeQuote(q).kpis;
    assert.ok(k.profit > 0 && k.marginPct >= 10, 'precondición: económicamente sana');
    assert.ok(k.completenessPct < COMPLETENESS_RISK_THRESHOLD, `completitud ${k.completenessPct}`);
    assert.equal(k.incomplete, true);
    assert.equal(k.atRisk, true);
  });

  test('la demo hidrogrúa con tarifa sugerida cumple el margen objetivo y no está en riesgo', () => {
    const k = computeQuote(demoHydroCraneQuote()).kpis;
    assert.equal(k.commercialSource, 'suggested');
    assert.equal(k.commercialListRate % 1000, 0, 'redondeo comercial a 1.000');
    assert.ok(k.floorNetRate < k.targetNetRate);
    assert.ok(k.marginPct >= 10);
    assert.equal(k.atRisk, false);
  });
});

describe('QuoteEngine — costo financiero, capital de trabajo y logística', () => {
  const withFinance = (term) => {
    const q = onCall();
    q.finance = { paymentTermDays: term, invoiceLagDays: 0, monthlyRatePct: 3, payDays: { salaries: 0, fuel: 0, suppliers: 0, materials: 0, structure: 0 } };
    return q;
  };

  test('plazo 30 días al 3 %: costo financiero = (30M + 8 × 1M) × 3 % = 1.140.000; capital de trabajo 38M', () => {
    const k = computeQuote(withFinance(30)).kpis;
    approx(k.financialCost, 1_140_000);
    approx(k.workingCapital, 38_000_000);
    approx(k.financialMarginImpactPct, (1_140_000 / 32_000_000) * 100);
  });

  test('plazo de pago +30 días duplica el costo financiero (2.280.000)', () => {
    approx(computeQuote(withFinance(60)).kpis.financialCost, 2_280_000);
  });

  test('plazo 0 → costo financiero 0', () => {
    approx(computeQuote(withFinance(0)).kpis.financialCost, 0);
  });

  test('logística mensual de la demo hidrogrúa = 205.700 por activación × 4 activaciones = 822.800', () => {
    const k = computeQuote(demoHydroCraneQuote()).kpis;
    approx(k.logisticsMonthly, 822_800);
    approx(k.logisticsIncidencePct, (822_800 / k.totalCost) * 100);
  });
});

describe('QuoteEngine — casos extremos', () => {
  test('actividad 0: factura 0, pierde los fijos (30M), sin tarifa por día (null); el break-even se informa igual', () => {
    const r = computeQuote(onCall({ activeDays: 0 }));
    approx(r.kpis.revenue, 0);
    approx(r.kpis.profit, -30_000_000);
    assert.equal(r.kpis.floorNetRate, null);
    assert.equal(r.kpis.costPerActiveDay, null);
    approx(r.kpis.utilizationPct, 0);
    approx(r.kpis.breakEvenDays, 10);
    assert.deepEqual(findNonFinite(r.kpis), []);
  });

  test('utilización 100 % (30 de 30 días): tarifa piso 2M, facturación 120M, resultado 60M', () => {
    const k = computeQuote(onCall({ activeDays: 30 })).kpis;
    approx(k.utilizationPct, 100);
    approx(k.floorNetRate, 2_000_000);
    approx(k.revenue, 120_000_000);
    approx(k.profit, 60_000_000);
  });

  test('utilización cercana a 0 (0,1 día): tarifa piso 301M, finita', () => {
    const k = computeQuote(onCall({ activeDays: 0.1 })).kpis;
    approx(k.floorNetRate, 301_000_000, '', 1e-3);
    assert.deepEqual(findNonFinite(k), []);
  });

  test('margen objetivo 0: la tarifa objetivo es la tarifa piso', () => {
    const k = computeQuote(onCall({ targetMarginPct: 0 })).kpis;
    approx(k.targetNetRate, k.floorNetRate);
  });

  test('margen objetivo 100 % o mayor es inválido: se informa el error y no hay Infinity', () => {
    for (const m of [100, 150]) {
      const r = computeQuote(onCall({ targetMarginPct: m }));
      assert.ok(r.issues.some((i) => i.path === 'pricing.targetMarginPct'), `margen ${m}`);
      assert.deepEqual(findNonFinite(r.kpis), [], `margen ${m}`);
      assert.ok(r.kpis.targetMarginPct >= 0 && r.kpis.targetMarginPct < 100);
    }
  });

  test('días disponibles 0 → se usan 30 y validateQuote lo informa; el resultado es el de 30 días', () => {
    const zero = computeQuote(onCall({ availableDays: 0 }));
    const thirty = computeQuote(onCall({ availableDays: 30 }));
    assert.ok(zero.issues.some((i) => i.path === 'activity.availableDaysPerMonth'));
    assert.equal(zero.activity.availableDaysPerMonth, 30);
    assert.deepEqual(zero.kpis, thirty.kpis);
  });

  test('strings numéricos (como llegan de un formulario) dan el mismo resultado que números', () => {
    const asNumbers = onCall();
    const asStrings = mapNumbers(asNumbers, (n) => String(n));
    const a = computeQuote(asStrings).kpis;
    const b = computeQuote(asNumbers).kpis;
    for (const key of ['totalCost', 'floorNetRate', 'targetNetRate', 'revenue', 'profit', 'breakEvenDays', 'completenessPct']) {
      approx(a[key], b[key], key);
    }
  });

  test('negativos inválidos se sanean a 0: un costo fijo negativo no reduce el costo', () => {
    const k = computeQuote(onCall({ fixed: -30_000_000 })).kpis;
    approx(k.fixedCosts, 0);
    approx(k.totalCost, 8_000_000);
  });
});

describe('QuoteEngine — nunca NaN ni ±Infinity', () => {
  // ctx.rules es un eco de los datos de entrada (no un cálculo): se excluye del recorrido.
  const computedParts = (r) => {
    const { ctx, ...rest } = r;
    return rest;
  };
  const assertAllFinite = (quote, label, options) => {
    const r = computeQuote(quote, options);
    const bad = findNonFinite(computedParts(r));
    assert.deepEqual(bad, [], `${label}: ${bad.slice(0, 5).join(', ')}`);
    for (const part of ['kpis', 'eecc', 'matrix', 'discounts', 'traces']) assert.ok(part in r, `${label}: falta ${part}`);
  };

  test('cotización vacía (createEmptyQuote)', () => {
    assertAllFinite(createEmptyQuote({ id: 'q', now: '2026-01-01T00:00:00.000Z' }), 'vacía');
    assertAllFinite({}, 'objeto vacío');
    assertAllFinite(undefined, 'sin cotización');
  });

  test('cotizaciones demo (createDemoState(1).quotes) con y sin configuración', () => {
    const state = createDemoState(1);
    for (const q of state.quotes) {
      assertAllFinite(q, q.name);
      assertAllFinite(q, `${q.name} (con settings)`, { settings: state.settings });
      assertAllFinite(q, `${q.name} (settings por defecto)`, { settings: defaultSettings() });
    }
  });

  test('todos los campos numéricos en 0, negativos, vacíos, null, NaN o texto, en día / hora / mes y ambos modos', () => {
    const variants = {
      cero: () => 0,
      negativo: () => -5,
      negativoGrande: () => -1e9,
      vacio: () => '',
      nulo: () => null,
      indefinido: () => undefined,
      nan: () => Number.NaN,
      texto: () => 'abc',
      string: (n) => String(n),
    };
    for (const base of [demoHydroCraneQuote(), demoReferenceQuote()]) {
      for (const [name, fn] of Object.entries(variants)) {
        for (const unit of ['day', 'hour', 'month']) {
          for (const pricingMode of ['known_rate', 'known_activity']) {
            const q = mapNumbers({ ...base, unit, pricingMode }, fn);
            assertAllFinite(q, `${base.code} ${name} ${unit} ${pricingMode}`);
          }
        }
      }
    }
  });
});

describe('QuoteEngine — determinismo e inmutabilidad', () => {
  test('mismos inputs → mismos outputs', () => {
    for (const q of createDemoState(1).quotes) {
      assert.deepEqual(computeQuote(q), computeQuote(q));
    }
  });

  test('computeQuote no muta la cotización (funciona con la cotización congelada y el JSON no cambia)', () => {
    for (const q of createDemoState(1).quotes) {
      const before = JSON.stringify(q);
      const frozen = deepFreeze(JSON.parse(before));
      const fromFrozen = computeQuote(frozen);
      assert.equal(JSON.stringify(frozen), before);
      const fromOriginal = computeQuote(q);
      assert.equal(JSON.stringify(q), before);
      assert.deepEqual(fromFrozen.kpis, fromOriginal.kpis);
    }
  });

  test('summarizeQuote devuelve los indicadores y la cantidad de problemas de validación', () => {
    const q = onCall({ availableDays: 0 });
    const s = summarizeQuote(q);
    const r = computeQuote(q);
    assert.equal(s.issuesCount, r.issues.length);
    assert.ok(s.issuesCount > 0);
    approx(s.breakEvenDays, r.kpis.breakEvenDays);
    approx(s.profit, r.kpis.profit);
  });
});
