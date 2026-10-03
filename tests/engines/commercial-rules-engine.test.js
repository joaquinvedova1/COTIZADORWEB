/**
 * Contrato del negocio — CommercialRulesEngine (cómo se factura el servicio).
 *
 * Reglas (Prompt 1 "Reglas comerciales", "Descuentos por volumen y continuidad";
 * Prompt 3 "Reglas comerciales MVP", "Descuentos"):
 *   Standby, minimum call, call-out fee, movilización, km adicional, descuento por cantidad
 *   de días (tramos 1, 2–7, 8–15, 16–30, +30), descuento por continuidad (permanencia),
 *   mínimo mensual garantizado, fee de disponibilidad.
 *   tarifa neta = lista × (1 − tramo) × (1 − continuidad) × (1 − comercial)   (en cascada)
 *   facturación = neta × unidades + fee + (call-out + movilización + km extra) × activaciones + standby
 *   total = max(facturación, mínimo garantizado)
 *   Semáforo de descuentos: verde = mantiene margen objetivo; naranja = debajo del objetivo
 *   pero sobre break-even; rojo = debajo de break-even.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VOLUME_TIERS,
  tierLabel,
  normalizeTiers,
  findVolumeTier,
  normalizeRules,
  continuityApplies,
  billableUnits,
  discountFactor,
  computeRevenue,
  requiredNetRate,
  listRateFromNet,
  classifyDiscount,
} from '../../js/engines/commercial-rules-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

const ACTIVITY = { daysPerActivation: 1, hoursPerActiveDay: 10, availableDaysPerMonth: 30 };

function revenue(overrides = {}) {
  return computeRevenue({ listRate: 4_000_000, activeDays: 8, activity: ACTIVITY, unit: 'day', rules: {}, ...overrides });
}

function tiers(discounts) {
  return DEFAULT_VOLUME_TIERS.map((t, i) => ({ ...t, discountPct: discounts[i] ?? 0 }));
}

describe('CommercialRulesEngine — tramos de descuento por cantidad de días', () => {
  test('tramos por defecto: 1 día, 2–7, 8–15, 16–30 y +30 días (sin descuento)', () => {
    assert.deepEqual(DEFAULT_VOLUME_TIERS.map(tierLabel), ['1 día', '2–7 días', '8–15 días', '16–30 días', '+30 días']);
    assert.ok(DEFAULT_VOLUME_TIERS.every((t) => t.discountPct === 0));
  });

  test('cada cantidad de días cae en su tramo', () => {
    const cases = [
      [1, 'tier-1'],
      [2, 'tier-2'],
      [7, 'tier-2'],
      [8, 'tier-3'],
      [15, 'tier-3'],
      [16, 'tier-4'],
      [30, 'tier-4'],
      [31, 'tier-5'],
      [45, 'tier-5'],
    ];
    for (const [days, id] of cases) assert.equal(findVolumeTier(DEFAULT_VOLUME_TIERS, days).id, id, `${days} días`);
  });

  test('días fraccionarios: 7,5 días todavía no alcanza el tramo 8–15', () => {
    assert.equal(findVolumeTier(DEFAULT_VOLUME_TIERS, 7.5).id, 'tier-2');
  });

  test('0 días → sin tramo (no hay descuento que aplicar)', () => {
    assert.equal(findVolumeTier(DEFAULT_VOLUME_TIERS, 0), null);
    assert.equal(findVolumeTier(DEFAULT_VOLUME_TIERS, -3), null);
  });

  test('tramos vacíos → se usan los tramos por defecto; se ordenan; descuento limitado a 0–100 %', () => {
    assert.equal(normalizeTiers([]).length, 5);
    assert.equal(normalizeTiers(null).length, 5);
    const n = normalizeTiers([
      { id: 'b', fromDays: 8, toDays: null, discountPct: 150 },
      { id: 'a', fromDays: 1, toDays: 7, discountPct: -5 },
    ]);
    assert.deepEqual(n.map((t) => t.id), ['a', 'b']);
    assert.equal(n[0].discountPct, 0);
    assert.equal(n[1].discountPct, 100);
  });
});

describe('CommercialRulesEngine — descuentos en cascada y continuidad (permanencia)', () => {
  test('tramo 5 %, continuidad 3 %, comercial 2 % → factor 0,95 × 0,97 × 0,98 (no 0,90)', () => {
    approx(discountFactor({ tierPct: 5, continuityPct: 3, commercialPct: 2 }), 0.95 * 0.97 * 0.98);
    assert.ok(Math.abs(discountFactor({ tierPct: 5, continuityPct: 3, commercialPct: 2 }) - 0.9) > 1e-3);
  });

  test('sin descuentos el factor es 1; descuentos > 100 % se limitan a 100 %', () => {
    assert.equal(discountFactor(), 1);
    assert.equal(discountFactor({ tierPct: 150 }), 0);
    assert.equal(discountFactor({ tierPct: -10 }), 1);
  });

  test('continuidad: aplica si el contrato dura al menos los meses mínimos (12 ≥ 6 sí; 3 < 6 no)', () => {
    const rules = { continuityMinMonths: 6, continuityDiscountPct: 5 };
    assert.equal(continuityApplies(rules, 12), true);
    assert.equal(continuityApplies(rules, 6), true);
    assert.equal(continuityApplies(rules, 3), false);
    assert.equal(continuityApplies({ continuityMinMonths: 6, continuityDiscountPct: 0 }, 12), false);
  });

  test('descuento por continuidad baja la tarifa neta: 4M × (1 − 5 %) = 3,8M → 30,4M con 8 días', () => {
    const r = revenue({ rules: { continuityMinMonths: 6, continuityDiscountPct: 5 }, contractMonths: 12 });
    approx(r.netRate, 3_800_000);
    approx(r.total, 30_400_000);
    assert.equal(r.continuityDiscountPct, 5);
    const short = revenue({ rules: { continuityMinMonths: 6, continuityDiscountPct: 5 }, contractMonths: 3 });
    approx(short.total, 32_000_000);
  });

  test('descuento por cantidad de días: con 8 días aplica el tramo 8–15 (5 %); con 7 días el 2–7 (0 %)', () => {
    const rules = { volumeTiers: tiers([0, 0, 5, 10, 15]) };
    const eight = revenue({ rules });
    approx(eight.netRate, 3_800_000);
    approx(eight.total, 30_400_000);
    assert.equal(eight.tier.id, 'tier-3');
    const seven = revenue({ rules, activeDays: 7 });
    approx(seven.total, 28_000_000);
  });

  test('tramo + continuidad + descuento comercial se combinan en cascada', () => {
    const r = revenue({ rules: { volumeTiers: tiers([0, 0, 5]), continuityMinMonths: 6, continuityDiscountPct: 5 }, contractMonths: 12, commercialDiscountPct: 10 });
    approx(r.discountFactor, 0.95 * 0.95 * 0.9);
    approx(r.netRate, 4_000_000 * 0.95 * 0.95 * 0.9);
  });

  test('descuento comercial 10 % → tarifa neta 3,6M → facturación 28,8M con 8 días', () => {
    const r = revenue({ commercialDiscountPct: 10 });
    approx(r.netRate, 3_600_000);
    approx(r.total, 28_800_000);
  });
});

describe('CommercialRulesEngine — unidades facturables y minimum call', () => {
  test('tarifa por día: 8 días activos en activaciones de 2 días → 4 activaciones y 8 días facturables', () => {
    const u = billableUnits({ activeDays: 8, daysPerActivation: 2, hoursPerActiveDay: 10, availableDaysPerMonth: 30, unit: 'day' });
    approx(u.activations, 4);
    approx(u.billableUnits, 8);
    assert.equal(u.minimumCallApplied, false);
  });

  test('minimum call de 3 días por activación de 2 días → se facturan 3 días por llamado (12 días)', () => {
    const u = billableUnits({ activeDays: 8, daysPerActivation: 2, hoursPerActiveDay: 10, availableDaysPerMonth: 30, unit: 'day', minimumCallUnits: 3 });
    approx(u.billableUnits, 12);
    assert.equal(u.minimumCallApplied, true);
  });

  test('minimum call menor o igual a la duración del llamado no cambia la facturación', () => {
    const u = billableUnits({ activeDays: 8, daysPerActivation: 2, hoursPerActiveDay: 10, availableDaysPerMonth: 30, unit: 'day', minimumCallUnits: 1 });
    approx(u.billableUnits, 8);
    assert.equal(u.minimumCallApplied, false);
  });

  test('minimum call en facturación: llamados de 1 día con mínimo 2 días → 8 × 2 × 4M = 64M', () => {
    const r = revenue({ rules: { minimumCallUnits: 2 } });
    approx(r.billableUnits, 16);
    approx(r.total, 64_000_000);
  });

  test('tarifa por hora: 8 días × 10 h = 80 horas facturables; con minimum call de 12 h → 96 h', () => {
    const u = billableUnits({ activeDays: 8, daysPerActivation: 1, hoursPerActiveDay: 10, availableDaysPerMonth: 30, unit: 'hour' });
    approx(u.billableUnits, 80);
    const withMin = billableUnits({ activeDays: 8, daysPerActivation: 1, hoursPerActiveDay: 10, availableDaysPerMonth: 30, unit: 'hour', minimumCallUnits: 12 });
    approx(withMin.billableUnits, 96);
    approx(withMin.billableDays, 9.6, 'días equivalentes para el tramo de descuento');
  });

  test('tarifa mensual (abono): 1 mes facturable sin importar los días; si superan el mes se prorratea', () => {
    approx(billableUnits({ activeDays: 8, daysPerActivation: 1, availableDaysPerMonth: 30, unit: 'month' }).billableUnits, 1);
    approx(billableUnits({ activeDays: 0, daysPerActivation: 1, availableDaysPerMonth: 30, unit: 'month' }).billableUnits, 1);
    approx(billableUnits({ activeDays: 45, daysPerActivation: 1, availableDaysPerMonth: 30, unit: 'month' }).billableUnits, 1.5);
  });
});

describe('CommercialRulesEngine — facturación con reglas comerciales', () => {
  test('caso base: 4M/día × 8 días = 32M', () => {
    const r = revenue();
    approx(r.components.base, 32_000_000);
    approx(r.total, 32_000_000);
    approx(r.otherRevenue, 0);
  });

  test('standby: 2 días en locación sin operar × 500.000 = 1M adicional', () => {
    const r = revenue({ rules: { standbyDaysPerMonth: 2, standbyRatePerDay: 500_000 } });
    approx(r.components.standby, 1_000_000);
    approx(r.total, 33_000_000);
  });

  test('call-out fee: 500.000 por activación × 8 activaciones = 4M', () => {
    const r = revenue({ rules: { calloutFeePerActivation: 500_000 } });
    approx(r.components.callout, 4_000_000);
    approx(r.total, 36_000_000);
  });

  test('movilización: 250.000 por activación × 8 = 2M', () => {
    const r = revenue({ rules: { mobilizationFeePerActivation: 250_000 } });
    approx(r.components.mobilization, 2_000_000);
  });

  test('km adicional: (220 km de ruta − 100 incluidos) × 1.000 $/km × 8 activaciones = 960.000', () => {
    const r = revenue({ rules: { includedKmPerActivation: 100, extraKmRate: 1_000 }, routeKmPerActivation: 220 });
    approx(r.extraKmPerActivation, 120);
    approx(r.components.extraKm, 960_000);
  });

  test('km adicional: si la ruta no supera los km incluidos no se cobra', () => {
    const r = revenue({ rules: { includedKmPerActivation: 300, extraKmRate: 1_000 }, routeKmPerActivation: 220 });
    assert.equal(r.components.extraKm, 0);
  });

  test('fee de disponibilidad: monto mensual fijo (6M) que se cobra aunque no haya actividad', () => {
    const r = revenue({ rules: { availabilityFeeMonthly: 6_000_000 } });
    approx(r.components.availabilityFee, 6_000_000);
    approx(r.total, 38_000_000);
    const idle = revenue({ rules: { availabilityFeeMonthly: 6_000_000 }, activeDays: 0 });
    approx(idle.total, 6_000_000);
  });

  test('mínimo mensual garantizado: si la facturación (32M) es menor que el mínimo (40M) se completa hasta 40M', () => {
    const r = revenue({ rules: { minimumMonthlyGuarantee: 40_000_000 } });
    approx(r.guaranteeTopUp, 8_000_000);
    approx(r.total, 40_000_000);
    const above = revenue({ rules: { minimumMonthlyGuarantee: 30_000_000 } });
    approx(above.guaranteeTopUp, 0);
    approx(above.total, 32_000_000);
  });

  test('abono mensual: 50M/mes × 1 mes, aunque haya 8 o 20 días activos', () => {
    approx(revenue({ unit: 'month', listRate: 50_000_000 }).total, 50_000_000);
    approx(revenue({ unit: 'month', listRate: 50_000_000, activeDays: 20 }).total, 50_000_000);
    assert.equal(revenue({ unit: 'month', listRate: 50_000_000, rules: { volumeTiers: tiers([10, 10, 10, 10, 10]) } }).tier, null, 'el abono no aplica tramos por día');
  });

  test('tarifa por hora: 400.000 $/h × 80 h = 32M', () => {
    approx(revenue({ unit: 'hour', listRate: 400_000 }).total, 32_000_000);
  });

  test('actividad 0: sólo se factura lo fijo (fee + standby) y el mínimo garantizado', () => {
    const r = revenue({ activeDays: 0, rules: { availabilityFeeMonthly: 1_000_000, standbyDaysPerMonth: 1, standbyRatePerDay: 500_000, calloutFeePerActivation: 999 } });
    approx(r.total, 1_500_000);
  });

  test('tarifa vacía, inválida o negativa → facturación por tarifa 0 (nunca NaN)', () => {
    for (const rate of [null, undefined, '', Number.NaN, -4_000_000, 'abc']) {
      const r = revenue({ listRate: rate });
      assert.equal(r.components.base, 0, `tarifa ${String(rate)}`);
      assert.ok(Number.isFinite(r.total));
    }
  });

  test('reglas con negativos o vacíos se sanean a 0', () => {
    const n = normalizeRules({ availabilityFeeMonthly: -1, calloutFeePerActivation: '', minimumCallUnits: null, standbyRatePerDay: 'x', minimumMonthlyGuarantee: -5 });
    assert.equal(n.availabilityFeeMonthly, 0);
    assert.equal(n.calloutFeePerActivation, 0);
    assert.equal(n.minimumCallUnits, 0);
    assert.equal(n.standbyRatePerDay, 0);
    assert.equal(n.minimumMonthlyGuarantee, 0);
    approx(revenue({ rules: { availabilityFeeMonthly: -1, minimumMonthlyGuarantee: -5 } }).total, 32_000_000);
  });

  test('strings numéricos en reglas y tarifa se interpretan como números', () => {
    const r = computeRevenue({ listRate: 4_000_000, activeDays: '8', activity: ACTIVITY, unit: 'day', rules: { calloutFeePerActivation: '500000' } });
    approx(r.total, 36_000_000);
  });
});

describe('CommercialRulesEngine — tarifa necesaria', () => {
  test('tarifa piso neta = costo / unidades: 38M / 8 días = 4.750.000', () => {
    approx(requiredNetRate({ totalCost: 38_000_000, marginPct: 0, billableUnits: 8 }).rate, 4_750_000);
  });

  test('tarifa para margen 10 % = costo / (1 − 10 %) / unidades = 5.277.777,78', () => {
    approx(requiredNetRate({ totalCost: 38_000_000, marginPct: 10, billableUnits: 8 }).rate, 38_000_000 / 0.9 / 8);
  });

  test('los otros ingresos (fee, call-out, standby) reducen la tarifa necesaria: (38M − 6M) / 8 = 4M', () => {
    approx(requiredNetRate({ totalCost: 38_000_000, marginPct: 0, billableUnits: 8, otherRevenue: 6_000_000 }).rate, 4_000_000);
  });

  test('si los otros ingresos ya cubren el costo, la tarifa necesaria es 0 (cubierto)', () => {
    const r = requiredNetRate({ totalCost: 38_000_000, marginPct: 0, billableUnits: 8, otherRevenue: 50_000_000 });
    assert.equal(r.rate, 0);
    assert.equal(r.coveredByOtherRevenue, true);
  });

  test('sin unidades facturables o con margen inválido no hay tarifa (null)', () => {
    assert.equal(requiredNetRate({ totalCost: 38_000_000, marginPct: 0, billableUnits: 0 }).rate, null);
    assert.equal(requiredNetRate({ totalCost: 38_000_000, marginPct: 100, billableUnits: 8 }).rate, null);
    assert.equal(requiredNetRate({ totalCost: Number.NaN, marginPct: 10, billableUnits: 8 }).rate, null);
  });

  test('tarifa de lista = neta / factor de descuentos (4,75M con 5 % de descuento → 5M)', () => {
    approx(listRateFromNet(4_750_000, 0.95), 5_000_000);
    assert.equal(listRateFromNet(4_750_000, 0), null, 'descuento del 100 %: no hay tarifa de lista posible');
    assert.equal(listRateFromNet(null, 0.95), null);
  });
});

describe('CommercialRulesEngine — semáforo de descuentos', () => {
  // Con 8 días: tarifa piso 4.750.000 y tarifa para margen 10 % 5.277.777,78
  const floorNetRate = 4_750_000;
  const targetNetRate = 38_000_000 / 0.9 / 8;

  test('verde: el descuento mantiene el margen objetivo', () => {
    assert.equal(classifyDiscount({ netRate: 5_500_000, floorNetRate, targetNetRate }), 'green');
    assert.equal(classifyDiscount({ netRate: targetNetRate, floorNetRate, targetNetRate }), 'green', 'justo en el objetivo');
  });

  test('naranja: debajo del margen objetivo pero sobre el break-even', () => {
    assert.equal(classifyDiscount({ netRate: 5_000_000, floorNetRate, targetNetRate }), 'orange');
    assert.equal(classifyDiscount({ netRate: floorNetRate, floorNetRate, targetNetRate }), 'orange', 'justo en el piso: no pierde');
  });

  test('rojo: el descuento deja la tarifa debajo del break-even (margen negativo)', () => {
    assert.equal(classifyDiscount({ netRate: 4_500_000, floorNetRate, targetNetRate }), 'red');
  });

  test('sin datos suficientes el semáforo es "unknown" (nunca un color engañoso)', () => {
    assert.equal(classifyDiscount({ netRate: null, floorNetRate, targetNetRate }), 'unknown');
    assert.equal(classifyDiscount({ netRate: 5_000_000, floorNetRate: null, targetNetRate }), 'unknown');
  });
});
