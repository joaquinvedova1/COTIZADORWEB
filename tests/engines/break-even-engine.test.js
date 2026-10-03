/**
 * Contrato del negocio — BreakEvenEngine (días activos mínimos).
 *
 * Reglas (Prompt 1 "Servicio on-call", Prompt 2 "Tests económicos", Prompt 3 "Motor on-call"):
 *   contribución/día = tarifa/día − costo variable/día
 *   break-even (días) = costos fijos / contribución/día
 *   Caso obligatorio: F 30.000.000, v 1.000.000/día, p 4.000.000/día → contribución 3.000.000 → 10 días.
 *   Problema inverso: tarifa mínima con D días = F / D + v (6 días → 6.000.000).
 *   Con fee de disponibilidad: break-even = (F − fee) / (p − v).
 *   Si p ≤ v nunca se alcanza el equilibrio.
 *   Con reglas no lineales (mínimo garantizado) el break-even es ROBUSTO: el menor D
 *   a partir del cual ya no se pierde dinero hasta los días disponibles.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { breakEvenSimple, minimumRateForDays, findBreakEvenDays, traceBreakEven } from '../../js/engines/break-even-engine.js';

const EPS = 1e-6;
const F = 30_000_000;
const V = 1_000_000;
const P = 4_000_000;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Resultado mensual lineal: fee + p·D − F − v·D. */
const linearProfit = ({ fixed = F, variable = V, rate = P, fee = 0 } = {}) => (d) => fee + rate * d - fixed - variable * d;

describe('BreakEvenEngine — fórmula clásica on-call', () => {
  test('on-call: fijos 30M, variable 1M/día, tarifa 4M/día → contribución 3M/día y break-even 10 días', () => {
    const r = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: P });
    assert.equal(r.reachable, true);
    approx(r.contributionPerDay, 3_000_000);
    approx(r.days, 10);
    assert.equal(r.wholeDays, 10);
  });

  test('break-even no entero se informa con decimales y en días enteros redondeando hacia arriba (31M → 10,33 → 11 días)', () => {
    const r = breakEvenSimple({ fixedCosts: 31_000_000, variableCostPerDay: V, ratePerDay: P });
    approx(r.days, 31 / 3);
    assert.equal(r.wholeDays, 11);
  });

  test('el redondeo a días enteros tolera errores de punto flotante (1,1 / 0,1 = 11, no 12)', () => {
    // 1,1 / 0,1 = 11,000000000000002 en binario
    const r = breakEvenSimple({ fixedCosts: 1.1, variableCostPerDay: 0, ratePerDay: 0.1 });
    assert.equal(r.wholeDays, 11);
  });

  test('tarifa igual al costo variable → break-even inalcanzable (contribución 0)', () => {
    const r = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: V });
    assert.equal(r.reachable, false);
    assert.equal(r.days, null);
    assert.equal(r.wholeDays, null);
    assert.equal(r.contributionPerDay, 0);
    assert.equal(typeof r.reason, 'string');
  });

  test('tarifa menor al costo variable (precio inferior al costo) → inalcanzable con contribución negativa', () => {
    const r = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: 800_000 });
    assert.equal(r.reachable, false);
    assert.equal(r.days, null);
    approx(r.contributionPerDay, -200_000);
  });

  test('sin costos fijos el equilibrio es inmediato (0 días)', () => {
    const r = breakEvenSimple({ fixedCosts: 0, variableCostPerDay: V, ratePerDay: P });
    assert.equal(r.reachable, true);
    assert.equal(r.days, 0);
  });

  test('negativos inválidos se sanean a 0 (nunca NaN): fijos −5 → 0 días; variable −1M → 0', () => {
    assert.equal(breakEvenSimple({ fixedCosts: -5, variableCostPerDay: V, ratePerDay: P }).days, 0);
    const r = breakEvenSimple({ fixedCosts: F, variableCostPerDay: -1_000_000, ratePerDay: P });
    approx(r.contributionPerDay, P);
    approx(r.days, 7.5);
  });

  test('valores vacíos (""/null/undefined) equivalen a 0 y nunca producen NaN', () => {
    for (const empty of ['', null, undefined, Number.NaN]) {
      const r = breakEvenSimple({ fixedCosts: F, variableCostPerDay: empty, ratePerDay: P });
      approx(r.days, 7.5, `variable=${String(empty)}`);
      const noRate = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: empty });
      assert.equal(noRate.reachable, false);
      assert.equal(noRate.days, null);
    }
  });

  test('strings numéricos (como llegan de un formulario) se interpretan como números', () => {
    const r = breakEvenSimple({ fixedCosts: '30000000', variableCostPerDay: '1000000', ratePerDay: '4000000' });
    approx(r.days, 10);
  });
});

describe('BreakEvenEngine — problema inverso: tarifa mínima para D días', () => {
  test('si estimo trabajar 6 días/mes la tarifa mínima es 6.000.000/día (30M / 6 + 1M)', () => {
    approx(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: 6 }), 6_000_000);
  });

  test('con 8 días la tarifa piso es 4.750.000/día y con 10 días es 4.000.000/día', () => {
    approx(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: 8 }), 4_750_000);
    approx(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: 10 }), 4_000_000);
  });

  test('a menor actividad mayor tarifa mínima (5 > 8 > 10 > 15 > 20 días)', () => {
    const rates = [5, 8, 10, 15, 20].map((d) => minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: d }));
    for (let i = 1; i < rates.length; i += 1) assert.ok(rates[i] < rates[i - 1]);
  });

  test('actividad 0 → no existe tarifa por día (null, nunca Infinity)', () => {
    assert.equal(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: 0 }), null);
    assert.equal(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: -3 }), null);
    assert.equal(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: '' }), null);
  });

  test('utilización cercana a 0 (0,1 día) → tarifa enorme pero finita (301.000.000)', () => {
    approx(minimumRateForDays({ fixedCosts: F, variableCostPerDay: V, activeDays: 0.1 }), 301_000_000, '', 1e-4);
  });
});

describe('BreakEvenEngine — búsqueda numérica (reglas comerciales)', () => {
  test('caso lineal on-call: el equilibrio numérico es exactamente 10 días', () => {
    const r = findBreakEvenDays(linearProfit(), { maxDays: 30 });
    assert.equal(r.reachable, true);
    assert.equal(r.days, 10, 'si el resultado es entero se devuelve el entero exacto');
    assert.equal(r.wholeDays, 10);
  });

  test('caso lineal no entero: 31M de fijos → 10,333… días', () => {
    const r = findBreakEvenDays(linearProfit({ fixed: 31_000_000 }), { maxDays: 30 });
    approx(r.days, 31 / 3);
    assert.equal(r.wholeDays, 11);
  });

  test('break-even con fee de disponibilidad: (F − fee) / (p − v) = (30M − 6M) / 3M = 8 días', () => {
    const r = findBreakEvenDays(linearProfit({ fee: 6_000_000 }), { maxDays: 30 });
    approx(r.days, 8);
    assert.equal(r.wholeDays, 8);
  });

  test('si el fee de disponibilidad cubre todos los fijos no se pierde con ninguna actividad (0 días)', () => {
    const r = findBreakEvenDays(linearProfit({ fee: 30_000_000 }), { maxDays: 30 });
    assert.equal(r.reachable, true);
    assert.equal(r.days, 0);
  });

  test('tarifa ≤ costo variable → nunca se alcanza el equilibrio', () => {
    const r = findBreakEvenDays(linearProfit({ rate: V }), { maxDays: 30 });
    assert.equal(r.reachable, false);
    assert.equal(r.days, null);
    assert.equal(typeof r.reason, 'string');
  });

  test('equilibrio justo en los días disponibles es alcanzable; si excede los disponibles, no', () => {
    // p 2M, v 1M → contribución 1M → 30 días
    const atLimit = findBreakEvenDays(linearProfit({ rate: 2_000_000 }), { maxDays: 30 });
    assert.equal(atLimit.reachable, true);
    approx(atLimit.days, 30);
    const beyond = findBreakEvenDays(linearProfit({ rate: 2_000_000 }), { maxDays: 29 });
    assert.equal(beyond.reachable, false);
    assert.equal(beyond.days, null);
  });

  test('mínimo garantizado: el break-even robusto es el día a partir del cual ya no se pierde (10, no 0)', () => {
    // Facturación = max(35M, 4M·D). Resultado(D) = max(35M, 4M·D) − 30M − 1M·D
    //   D = 0 → +5M (gana por el mínimo); 5 < D < 10 → pierde; D ≥ 10 → no pierde.
    const profit = (d) => Math.max(35_000_000, P * d) - F - V * d;
    assert.ok(profit(0) > 0 && profit(7) < 0, 'precondición: hay días con pérdida después de días con ganancia');
    const r = findBreakEvenDays(profit, { maxDays: 30 });
    assert.equal(r.reachable, true);
    approx(r.days, 10);
  });

  test('mínimo garantizado que cubre la pérdida en todo el rango → equilibrio desde 0 días', () => {
    // max(40M, 4M·D) − 30M − D·1M ≥ 0 para todo D ∈ [0, 30]
    const profit = (d) => Math.max(40_000_000, P * d) - F - V * d;
    const r = findBreakEvenDays(profit, { maxDays: 30 });
    assert.equal(r.days, 0);
  });

  test('una función de resultado inválida (NaN) nunca reporta equilibrio', () => {
    const r = findBreakEvenDays(() => Number.NaN, { maxDays: 30 });
    assert.equal(r.reachable, false);
    assert.equal(r.days, null);
  });

  test('es determinístico: mismos inputs → mismo resultado', () => {
    const a = findBreakEvenDays(linearProfit({ fixed: 31_000_000 }), { maxDays: 30 });
    const b = findBreakEvenDays(linearProfit({ fixed: 31_000_000 }), { maxDays: 30 });
    assert.deepEqual(a, b);
  });
});

describe('BreakEvenEngine — trazabilidad ("Ver cálculo")', () => {
  test('la traza del break-even muestra fijos, tarifa, variable, contribución, fórmula y resultado', () => {
    const result = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: P });
    const trace = traceBreakEven({ fixedCosts: F, ratePerDay: P, variableCostPerDay: V, contributionPerDay: result.contributionPerDay, result });
    assert.equal(trace.id, 'break_even');
    assert.match(trace.formula, /Costos fijos/);
    const values = trace.inputs.map((i) => i.value);
    assert.ok(values.includes(F) && values.includes(P) && values.includes(V));
    approx(trace.steps[0].value, 3_000_000);
    approx(trace.result.value, 10);
  });

  test('con fee de disponibilidad la traza explica la fórmula con ingresos fijos', () => {
    const trace = traceBreakEven({ fixedCosts: F, fixedRevenue: 6_000_000, ratePerDay: P, variableCostPerDay: V, contributionPerDay: 3_000_000, result: { reachable: true, days: 8 } });
    assert.match(trace.formula, /Ingresos fijos/);
    assert.ok(trace.inputs.some((i) => i.value === 6_000_000));
  });

  test('si no se alcanza el equilibrio, el resultado es null y se explica el motivo', () => {
    const result = breakEvenSimple({ fixedCosts: F, variableCostPerDay: V, ratePerDay: V });
    const trace = traceBreakEven({ fixedCosts: F, ratePerDay: V, variableCostPerDay: V, contributionPerDay: 0, result });
    assert.equal(trace.result.value, null);
    assert.ok(trace.notes.some((n) => n === result.reason));
  });
});
