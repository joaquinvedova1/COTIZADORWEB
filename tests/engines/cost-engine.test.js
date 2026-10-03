/**
 * Contrato del negocio — CostEngine (economía del servicio y EECC).
 *
 * Reglas (Prompt 1 "Lógica central", "Costos indirectos", "Riesgo y contingencia",
 * "Estructura de costos — EECC"; Prompt 3 "Motor on-call", "Estructura de costos"):
 *   Costo(D) = Fijos mensuales × factorMeses(D) + Variable por día activo × D
 *   Los costos FIJOS existen aunque no haya actividad; los VARIABLES crecen con los días.
 *   factorMeses(D) = max(1, D / días disponibles) (prorrateo si D supera el mes).
 *   Orden: directos → estructura (absorción) → financiero (sólo efectivo) → contingencia.
 *   Contingencia = % × (directos + estructura + financiero). La contingencia no se financia.
 *   EECC: monto + incidencia %; TOTAL = 100 % (la incidencia mostrada suma exactamente 100).
 *   Días disponibles 0 o inválidos → se usan 30 (y validateQuote lo informa).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivity, contingencyPctOf, buildCostModel, costAtActivity, costStructure, monthsFactor, traceTotalCost } from '../../js/engines/cost-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { createDemoState, demoReferenceQuote } from '../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../js/domain/quote-factory.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Caso de referencia: fijos 30M (categoría equipos), variable 1M/día (categoría personal). */
function referenceQuote() {
  return demoReferenceQuote();
}

/** Cotización sin costos ni recargos, para aislar cada regla. */
function blankQuote() {
  const q = createEmptyQuote({ id: 'q-test', now: '2026-01-01T00:00:00.000Z' });
  q.risk.generalPct = 0;
  q.finance = { paymentTermDays: 0, invoiceLagDays: 0, monthlyRatePct: 0, payDays: { salaries: 0, fuel: 0, suppliers: 0, materials: 0, structure: 0 } };
  q.logistics.notApplicable = true;
  q.fuel = { pricePerLiter: 0, providedBy: 'contractor' };
  q.materialsNotApplicable = true;
  q.indirect = { method: 'manual', pct: 0, amount: 0 };
  return q;
}

const NO_FINANCE_DELAY = { paymentTermDays: 30, invoiceLagDays: 0, monthlyRatePct: 3, payDays: { salaries: 0, fuel: 0, suppliers: 0, materials: 0, structure: 0 } };

describe('CostEngine — actividad normalizada', () => {
  test('días disponibles 0 o inválidos → se usan 30 días', () => {
    for (const bad of [0, -5, 'abc', '', null, undefined, Number.NaN]) {
      const a = normalizeActivity({ activity: { availableDaysPerMonth: bad, activeDaysPerMonth: 8 } });
      assert.equal(a.availableDaysPerMonth, 30, `días disponibles = ${String(bad)}`);
      approx(a.utilizationPct, (8 / 30) * 100);
    }
  });

  test('validateQuote informa los días disponibles inválidos (regla availableDays)', () => {
    for (const bad of [0, -5, 'abc']) {
      const issues = validateQuote({ activity: { availableDaysPerMonth: bad, activeDaysPerMonth: 8 } });
      assert.ok(issues.some((i) => i.path === 'activity.availableDaysPerMonth' && i.severity === 'error'), `días disponibles = ${String(bad)}`);
    }
    const ok = validateQuote({ activity: { availableDaysPerMonth: 30, activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: 10 } });
    assert.ok(!ok.some((i) => i.path === 'activity.availableDaysPerMonth'));
  });

  test('días disponibles se limitan a 31; horas por día a 24; días por activación 0 → 1', () => {
    const a = normalizeActivity({ activity: { availableDaysPerMonth: 45, hoursPerActiveDay: 30, daysPerActivation: 0, activeDaysPerMonth: 8 } });
    assert.equal(a.availableDaysPerMonth, 31);
    assert.equal(a.hoursPerActiveDay, 24);
    assert.equal(a.daysPerActivation, 1);
  });

  test('activaciones por mes = días activos / días por activación (8 / 2 = 4)', () => {
    const a = normalizeActivity({ activity: { activeDaysPerMonth: 8, daysPerActivation: 2, availableDaysPerMonth: 30 } });
    approx(a.activationsPerMonth, 4);
  });

  test('strings numéricos se interpretan como números', () => {
    const a = normalizeActivity({ activity: { activeDaysPerMonth: '8', daysPerActivation: '2', availableDaysPerMonth: '30', hoursPerActiveDay: '10' } });
    assert.equal(a.activeDaysPerMonth, 8);
    approx(a.activationsPerMonth, 4);
  });
});

describe('CostEngine — costos fijos y variables', () => {
  const model = buildCostModel(referenceQuote());

  test('caso de referencia: fijos 30.000.000/mes y variable 1.000.000 por día activo', () => {
    approx(model.fixedMonthly, 30_000_000);
    approx(model.variablePerActiveDay, 1_000_000);
  });

  test('costo con 8 días = 30M + 8 × 1M = 38.000.000 (4.750.000 por día activo)', () => {
    const at = costAtActivity(model, 8);
    approx(at.fixed, 30_000_000);
    approx(at.variable, 8_000_000);
    approx(at.total, 38_000_000);
    approx(at.perActiveDay, 4_750_000);
  });

  test('actividad 0: los costos fijos existen igual (30M) y no hay costo por día (null)', () => {
    const at = costAtActivity(model, 0);
    approx(at.total, 30_000_000);
    assert.equal(at.perActiveDay, null);
  });

  test('los variables crecen linealmente con los días y los fijos no cambian', () => {
    const at10 = costAtActivity(model, 10);
    const at20 = costAtActivity(model, 20);
    approx(at10.fixed, at20.fixed);
    approx(at20.variable - at10.variable, 10_000_000);
  });

  test('más días que los disponibles: los fijos se prorratean como trabajo de más de un mes (45 días → 90M)', () => {
    approx(monthsFactor(45, 30), 1.5);
    approx(costAtActivity(model, 45).total, 30_000_000 * 1.5 + 45_000_000);
  });

  test('factor de meses = 1 dentro del mes o sin días disponibles', () => {
    assert.equal(monthsFactor(20, 30), 1);
    assert.equal(monthsFactor(30, 30), 1);
    assert.equal(monthsFactor(45, 0), 1);
  });

  test('días negativos o vacíos se tratan como 0 días', () => {
    approx(costAtActivity(model, -5).total, 30_000_000);
    approx(costAtActivity(model, '').total, 30_000_000);
  });

  test('la traza del costo total muestra fijos, variable, días y resultado', () => {
    const trace = traceTotalCost(model, 8);
    approx(trace.result.value, 38_000_000);
    assert.ok(trace.inputs.some((i) => i.value === 30_000_000));
    assert.ok(trace.inputs.some((i) => i.value === 1_000_000));
  });
});

describe('CostEngine — estructura (costos indirectos) por método de absorción', () => {
  test('% sobre costo directo: 10 % de (30M fijos, 1M/día) → 3M fijos y 100.000/día', () => {
    const q = referenceQuote();
    q.indirect = { method: 'percent_direct', pct: 10, amount: 0 };
    const m = buildCostModel(q);
    approx(m.structure.fixedMonthly, 3_000_000);
    approx(m.structure.variablePerActiveDay, 100_000);
    approx(m.byCategory.structure.fixedMonthly, 3_000_000);
  });

  test('% sobre mano de obra: sólo absorbe sobre los costos de personal (1M/día → 100.000/día)', () => {
    const q = referenceQuote();
    q.indirect = { method: 'percent_labor', pct: 10, amount: 0 };
    const m = buildCostModel(q);
    approx(m.structure.fixedMonthly, 0);
    approx(m.structure.variablePerActiveDay, 100_000);
  });

  test('monto por empleado: 500.000 × dotación (1 posición con relevo = 2 personas) = 1.000.000', () => {
    const q = blankQuote();
    q.labor = [{ id: 'l1', role: 'Operador', positions: 1, peoplePerPosition: 2, basicMonthly: 0 }];
    q.indirect = { method: 'per_employee', pct: 0, amount: 500_000 };
    approx(buildCostModel(q).structure.fixedMonthly, 1_000_000);
  });

  test('monto por hora: 10.000 × 10 horas por día activo = 100.000 por día', () => {
    const q = blankQuote();
    q.indirect = { method: 'per_hour', pct: 0, amount: 10_000 };
    approx(buildCostModel(q).structure.variablePerActiveDay, 100_000);
  });

  test('monto manual o por contrato: fijo mensual', () => {
    for (const method of ['manual', 'per_contract']) {
      const q = blankQuote();
      q.indirect = { method, pct: 0, amount: 2_000_000 };
      approx(buildCostModel(q).structure.fixedMonthly, 2_000_000, method);
    }
  });

  test('lo cargado manualmente como "estructura" no forma parte de la base de absorción', () => {
    const q = referenceQuote();
    q.otherCosts.push({ id: 'oc-st', description: 'Alquiler de base', category: 'structure', behavior: 'fixed_monthly', amount: 1_000_000 });
    q.indirect = { method: 'percent_direct', pct: 10, amount: 0 };
    const m = buildCostModel(q);
    approx(m.structure.fixedMonthly, 3_000_000, 'absorción sobre 30M, no 31M');
    approx(m.byCategory.structure.fixedMonthly, 4_000_000);
  });
});

describe('CostEngine — financiero y contingencia', () => {
  test('costo financiero dentro del costo: 30 días financiados al 3 % sobre los costos en efectivo', () => {
    const q = referenceQuote();
    q.finance = NO_FINANCE_DELAY;
    const m = buildCostModel(q);
    // fijos 30M × 3 % × 30/30 = 900.000; variable 1M × 3 % = 30.000/día
    approx(m.byCategory.financial.fixedMonthly, 900_000);
    approx(m.byCategory.financial.variablePerActiveDay, 30_000);
  });

  test('contingencia = % × (directos + estructura + financiero); la contingencia no se financia', () => {
    const q = referenceQuote();
    q.finance = NO_FINANCE_DELAY;
    q.indirect = { method: 'manual', pct: 0, amount: 2_000_000 };
    q.risk = { generalPct: 10, items: [] };
    const m = buildCostModel(q);
    // financiero: (30M + 2M) × 3 % = 960.000; variable 1M × 3 % = 30.000
    approx(m.byCategory.financial.fixedMonthly, 960_000);
    // contingencia: (30M + 2M + 0,96M) × 10 % = 3.296.000; variable (1M + 30.000) × 10 % = 103.000
    approx(m.contingency.fixedMonthly, 3_296_000);
    approx(m.contingency.variablePerActiveDay, 103_000);
    approx(m.fixedMonthly, 30_000_000 + 2_000_000 + 960_000 + 3_296_000);
    approx(m.variablePerActiveDay, 1_000_000 + 30_000 + 103_000);
  });

  test('porcentaje de contingencia = general + ítems de riesgo habilitados (los deshabilitados no suman)', () => {
    const pctTotal = contingencyPctOf({
      generalPct: 2,
      items: [
        { id: 'a', pct: 2, enabled: true },
        { id: 'b', pct: 1, enabled: true },
        { id: 'c', pct: 5, enabled: false },
      ],
    });
    approx(pctTotal, 5);
  });

  test('contingencia con negativos o vacíos → 0 %', () => {
    assert.equal(contingencyPctOf({ generalPct: -5, items: [{ pct: -3, enabled: true }] }), 0);
    assert.equal(contingencyPctOf({}), 0);
    assert.equal(contingencyPctOf(), 0);
  });

  test('la amortización de equipos no es salida de caja: no genera costo financiero', () => {
    const q = blankQuote();
    q.finance = NO_FINANCE_DELAY;
    q.equipment = [{ id: 'e1', name: 'Equipo', quantity: 1, hoursPerActiveDay: 0, replacementValue: 1_200_000, usefulLifeYears: 1, residualValue: 0 }];
    const onlyDepreciation = buildCostModel(q);
    approx(onlyDepreciation.byCategory.equipment.fixedMonthly, 100_000, 'amortización 1,2M / 12');
    approx(onlyDepreciation.byCategory.financial.fixedMonthly, 0);
    // El seguro (1,2M/año = 100.000/mes) sí es efectivo: 100.000 × 3 % = 3.000
    q.equipment[0].insuranceAnnual = 1_200_000;
    approx(buildCostModel(q).byCategory.financial.fixedMonthly, 3_000);
  });
});

describe('CostEngine — combustible, standby, logística y materiales', () => {
  test('combustible de equipos: 10 L/h × 10 h × 1.500 $/L = 150.000 por día activo (categoría Combustible)', () => {
    const q = blankQuote();
    q.fuel = { pricePerLiter: 1500, providedBy: 'contractor' };
    q.equipment = [{ id: 'e1', name: 'Generador', quantity: 1, hoursPerActiveDay: 10, fuelLitersPerHour: 10, maintenancePerHour: 2_000 }];
    const m = buildCostModel(q);
    approx(m.byCategory.fuel.variablePerActiveDay, 150_000);
    approx(m.byCategory.equipment.variablePerActiveDay, 20_000, 'mantenimiento 2.000 × 10 h');
  });

  test('si el cliente provee el combustible no es costo nuestro', () => {
    const q = blankQuote();
    q.fuel = { pricePerLiter: 1500, providedBy: 'client' };
    q.equipment = [{ id: 'e1', name: 'Generador', quantity: 1, hoursPerActiveDay: 10, fuelLitersPerHour: 10 }];
    approx(buildCostModel(q).byCategory.fuel.variablePerActiveDay, 0);
  });

  test('standby: días en locación sin operar se costean con el variable diario del personal (3 × 25.000)', () => {
    const q = blankQuote();
    q.labor = [{ id: 'l1', role: 'Operador', positions: 1, peoplePerPosition: 1, basicMonthly: 1_000_000, normalHoursPerMonth: 176, mealPerActiveDay: 25_000 }];
    q.rules.standbyDaysPerMonth = 3;
    const m = buildCostModel(q);
    approx(m.standby.monthly, 75_000);
    approx(m.byCategory.labor.fixedMonthly, 1_000_000 + 75_000);
  });

  test('logística: el combustible de traslados va a Combustible y el desgaste a Logística (por día activo)', () => {
    const q = blankQuote();
    q.activity.daysPerActivation = 2;
    q.fuel = { pricePerLiter: 1500, providedBy: 'contractor' };
    q.logistics = {
      notApplicable: false,
      distanceKm: 110,
      roundTrip: true,
      tripsPerActivation: 1,
      vehicles: [
        { id: 'v1', count: 1, consumptionLPer100Km: 35, costPerKm: 150 },
        { id: 'v2', count: 1, consumptionLPer100Km: 12, costPerKm: 80 },
      ],
      tollsPerActivation: 0,
      lodgingPerActivation: 0,
    };
    const m = buildCostModel(q);
    approx(m.byCategory.fuel.variablePerActiveDay, 155_100 / 2);
    approx(m.byCategory.logistics.variablePerActiveDay, 50_600 / 2);
  });

  test('materiales marcados como "no aplica" no suman costo', () => {
    const q = blankQuote();
    q.materials = [{ id: 'm1', quantity: 1, unitCost: 300_000, basis: 'per_month', providedBy: 'contractor' }];
    q.materialsNotApplicable = true;
    approx(buildCostModel(q).byCategory.materials.fixedMonthly, 0);
    q.materialsNotApplicable = false;
    approx(buildCostModel(q).byCategory.materials.fixedMonthly, 300_000);
  });
});

describe('CostEngine — EECC (monto + incidencia %, TOTAL = 100 %)', () => {
  test('caso de referencia con 8 días: equipos 30M (78,95 %) y mano de obra 8M (21,05 %)', () => {
    const s = costStructure(buildCostModel(referenceQuote()), 8);
    const row = (id) => s.rows.find((r) => r.category === id);
    approx(s.total, 38_000_000);
    approx(row('equipment').amount, 30_000_000);
    approx(row('labor').amount, 8_000_000);
    assert.equal(row('equipment').displayPct, 78.95);
    assert.equal(row('labor').displayPct, 21.05);
    approx(row('equipment').sharePct, (30 / 38) * 100);
  });

  test('las 8 categorías del EECC están siempre presentes y en orden', () => {
    const s = costStructure(buildCostModel(referenceQuote()), 8);
    assert.deepEqual(s.rows.map((r) => r.category), ['labor', 'equipment', 'fuel', 'materials', 'logistics', 'structure', 'financial', 'contingency']);
  });

  test('cotizaciones demo: la incidencia mostrada suma exactamente 100 % y las participaciones suman 1', () => {
    const { quotes } = createDemoState(1);
    for (const q of quotes) {
      const model = buildCostModel(q);
      const s = costStructure(model, model.activity.activeDaysPerMonth);
      const displaySum = s.rows.reduce((acc, r) => acc + r.displayPct, 0);
      const shareSum = s.rows.reduce((acc, r) => acc + r.share, 0);
      const amountSum = s.rows.reduce((acc, r) => acc + r.amount, 0);
      assert.ok(Math.abs(displaySum - 100) < 1e-9, `${q.name}: Σ incidencia = ${displaySum}`);
      assert.equal(s.displayTotalPct, 100);
      assert.ok(Math.abs(shareSum - 1) < 1e-9, `${q.name}: Σ participación = ${shareSum}`);
      approx(amountSum, s.total, `${q.name}: Σ montos = total`, 1e-4);
      for (const r of s.rows) {
        assert.ok(Math.abs(r.displayPct * 100 - Math.round(r.displayPct * 100)) < 1e-6, 'incidencia con 2 decimales');
      }
    }
  });

  test('la incidencia suma 100 % aunque haya redondeos (tres partes iguales: 33,34 + 33,33 + 33,33)', () => {
    const q = blankQuote();
    q.otherCosts = [
      { id: 'a', category: 'labor', behavior: 'fixed_monthly', amount: 1_000_000 },
      { id: 'b', category: 'equipment', behavior: 'fixed_monthly', amount: 1_000_000 },
      { id: 'c', category: 'materials', behavior: 'fixed_monthly', amount: 1_000_000 },
    ];
    const s = costStructure(buildCostModel(q), 8);
    const shown = s.rows.filter((r) => r.amount > 0).map((r) => r.displayPct);
    assert.equal(shown.length, 3);
    assert.ok(Math.abs(shown.reduce((a, b) => a + b, 0) - 100) < 1e-9);
    assert.deepEqual([...shown].sort((a, b) => b - a), [33.34, 33.33, 33.33]);
  });

  test('sin costos: incidencias en 0 y total 0 % (nunca NaN)', () => {
    const s = costStructure(buildCostModel(blankQuote()), 8);
    assert.equal(s.total, 0);
    assert.equal(s.totalPct, 0);
    for (const r of s.rows) {
      assert.equal(r.displayPct, 0);
      assert.equal(r.share, 0);
    }
  });

  test('actividad 0: el EECC muestra sólo los fijos y no hay costo por día (null)', () => {
    const s = costStructure(buildCostModel(referenceQuote()), 0);
    approx(s.total, 30_000_000);
    assert.equal(s.rows.find((r) => r.category === 'equipment').displayPct, 100);
    assert.ok(s.rows.every((r) => r.perActiveDay === null));
  });
});
