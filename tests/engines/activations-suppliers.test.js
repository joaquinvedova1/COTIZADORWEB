/**
 * PLAN-2026-011 · "Cada salida se cuenta completa" (opcional) y plazo de pago
 * por proveedor externo.
 *
 * COT-0009 (golden) debe dar EXACTAMENTE igual con la opción apagada y sin
 * plazos propios. Con 2.500 m³ / 120 m³ por día / 2 días por intervención hay
 * 10,4167 intervenciones: con la opción se costean 11 SÓLO en lo físicamente
 * indivisible por salida (en COT-0009: la movilización del vactor, 100 km por
 * salida → 52.500 de combustible + 25.000 de desgaste).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { buildCostModel, activationRoundingAt, activationBreakpoints } from '../../js/engines/cost-engine.js';
import { evaluateAt } from '../../js/engines/economics-engine.js';
import { compareCommercialModels } from '../../js/engines/scenario-engine.js';
import { findBreakEvenDays } from '../../js/engines/break-even-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { activationRoundingText } from '../../js/ui/result-text.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';

const close = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `esperado ${expected}, obtenido ${actual}`);
const KPIS = ['totalCost', 'fixedCosts', 'variableCosts', 'floorListRate', 'targetListRate', 'suggestedListRate', 'revenue', 'profit', 'marginPct', 'breakEvenDays', 'breakEvenQuantity', 'targetMarginQuantity', 'financialCost', 'workingCapital', 'logisticsMonthly', 'externalMonthly'];
const base = computeQuote(cot0009Quote());
const row = (r, cat) => r.eecc.rows.find((x) => x.category === cat).amount;

function variant(mutate) {
  const q = cot0009Quote();
  mutate(q);
  return computeQuote(q);
}

describe('COT-0009 no cambia (opción apagada, plazos vacíos)', () => {
  test('sin la opción, con la opción en false y con plazos vacíos: KPIs idénticos al centavo', () => {
    for (const mutate of [
      (q) => { q.activity.fullActivations = false; },
      (q) => { delete q.activity.fullActivations; },
      (q) => { q.equipment[1].supplierPayDays = null; },
      (q) => { q.equipment[1].supplierPayDays = ''; },
      (q) => { q.equipment[1].supplierPayDays = undefined; },
    ]) {
      const r = variant(mutate);
      KPIS.forEach((k) => assert.equal(r.kpis[k], base.kpis[k], k));
    }
  });

  test('con la opción activa pero 10 intervenciones exactas: el mes es idéntico; el equilibrio sí cuenta salidas enteras', () => {
    const r = variant((q) => { q.activity.fullActivations = true; });
    assert.equal(r.kpis.activationsEstimated, 10);
    assert.equal(r.kpis.activationsCosted, 10);
    assert.equal(r.kpis.activationRoundingCost, 0);
    ['totalCost', 'fixedCosts', 'variableCosts', 'floorListRate', 'targetListRate', 'suggestedListRate', 'revenue', 'profit', 'marginPct', 'financialCost', 'workingCapital', 'logisticsMonthly', 'externalMonthly']
      .forEach((k) => assert.equal(r.kpis[k], base.kpis[k], k));
    // En el equilibrio (≈ 8,04 salidas) la novena salida se paga entera: hacen falta más m³.
    assert.ok(r.kpis.breakEvenQuantity > base.kpis.breakEvenQuantity);
    assert.ok(r.kpis.breakEvenDays > 16, `${r.kpis.breakEvenDays}`);
  });

  test('un plazo propio igual al general de Proveedores (30 días) da lo mismo', () => {
    const r = variant((q) => { q.equipment[1].supplierPayDays = 30; });
    close(r.kpis.totalCost, base.kpis.totalCost, 1e-6);
    close(r.kpis.financialCost, base.kpis.financialCost, 1e-6);
  });
});

describe('cada salida se cuenta completa: 2.500 m³ → 10,42 estimadas, 11 costeadas', () => {
  const off = variant((q) => { q.activity.billableQuantityPerMonth = 2500; });
  const on = variant((q) => { q.activity.billableQuantityPerMonth = 2500; q.activity.fullActivations = true; });
  const extra = 11 - 2500 / 120 / 2;

  test('salidas estimadas (promedio) y costeadas (enteras)', () => {
    close(on.kpis.activationsEstimated, 10.4166667, 1e-6);
    assert.equal(on.kpis.activationsCosted, 11);
    assert.equal(off.kpis.activationsCosted, off.kpis.activationsEstimated, 'apagada: se costea el promedio');
  });

  test('ajuste = (11 − 10,42) × costo por salida (movilización + su estructura + su financiación)', () => {
    const per = on.model.activationRounding.perActivation;
    close(per.direct, 77500);
    close(per.structure, 7750);
    // combustible 52.500 × 3 % × 75/30 + desgaste 25.000 × 3 % × 45/30 + estructura 7.750 × 3 % × 55/30
    close(per.financial, 3937.5 + 1125 + 426.25);
    close(on.kpis.activationRoundingCost, extra * (77500 + 7750 + 5488.75), 0.01);
    close(on.kpis.totalCost - off.kpis.totalCost, extra * 90738.75, 0.01);
    close(row(on, 'fuel') - row(off, 'fuel'), extra * 52500, 0.01);
    close(row(on, 'logistics') - row(off, 'logistics'), extra * 25000, 0.01);
  });

  test('NO se redondea: sueldos, tenencia, producción ni facturación', () => {
    assert.equal(row(on, 'labor'), row(off, 'labor'));
    assert.equal(row(on, 'equipment'), row(off, 'equipment'));
    assert.equal(row(on, 'external'), row(off, 'external'));
    assert.equal(row(on, 'materials'), row(off, 'materials'));
    assert.equal(on.kpis.billableQuantity, 2500);
    assert.equal(on.kpis.activeDays, off.kpis.activeDays);
    assert.equal(on.kpis.revenue, off.kpis.revenue);
    assert.equal(on.kpis.fixedCosts, off.kpis.fixedCosts);
  });

  test('"Ver cálculo": costo total y movilización muestran estimadas vs costeadas', () => {
    const steps = on.traces.totalCost.steps.map((s) => s.label);
    // PLAN-2026-014 (LAB-D1/D8): promedio, costeadas y efecto del redondeo, con el nombre del servicio (por cantidad: intervención).
    assert.ok(steps.includes('Intervenciones promedio por mes'));
    assert.ok(steps.includes('Intervenciones costeadas (cada intervención completa)'));
    assert.ok(on.traces.totalCost.steps.some((s) => /^Efecto del redondeo/.test(s.label)));
    assert.ok(on.traces.logistics.steps.some((s) => /Intervenciones costeadas/.test(s.label)));
    // Apagada: "Ver cálculo" dice que es un promedio y cuánto sumaría (sin sumarlo).
    assert.ok(off.traces.totalCost.notes.some((n) => /promedio por mes: 10,42/.test(n) && /no incluido/.test(n)));
    close(on.kpis.logisticsMonthly - off.kpis.logisticsMonthly, extra * 77500, 0.01);
  });

  test('equilibrio: el costo es escalonado y después del equilibrio no hay pérdida', () => {
    assert.ok(on.kpis.breakEvenQuantity >= off.kpis.breakEvenQuantity - 1e-9);
    const model = on.model;
    const ctx = on.ctx;
    const rate = on.kpis.commercialListRate;
    for (let d = on.breakEven.days; d <= 30; d += 0.01) {
      assert.ok(evaluateAt(ctx, d, rate).profit >= -0.01, `pérdida con ${d} días`);
    }
    assert.ok(activationBreakpoints(model, 30).includes(16));
  });

  test('la búsqueda con saltos no se saltea un tramo con pérdida entre dos puntos de la grilla', () => {
    // Ganancia que es positiva antes de 5,05 y cae a negativa justo después (salto).
    const profit = (d) => (d < 5.05 ? d - 1 : d < 5.08 ? -1 : d - 1);
    const naive = findBreakEvenDays(profit, { maxDays: 10 });
    const robust = findBreakEvenDays(profit, { maxDays: 10, breakpoints: [5.05, 5.08] });
    assert.ok(naive.days < 5, 'sin los saltos, la grilla de 0,1 no ve la pérdida');
    assert.ok(robust.days >= 5.08 - 1e-6, `con los saltos: ${robust.days}`);
  });

  test('comparador: con salidas completas cada modelo sigue logrando el margen objetivo', () => {
    const q = cot0009Quote();
    q.activity.billableQuantityPerMonth = 2500;
    q.activity.fullActivations = true;
    const cmp = compareCommercialModels(q);
    cmp.models.forEach((m) => close(m.expectedMarginPct, 10, 1e-6));
  });

  test('textos: estimadas vs costeadas y cuánto sumaría', () => {
    const t = activationRoundingText(on.activationRounding);
    // PLAN-2026-014 (LAB-D1): salidas promedio, costeadas y efecto del redondeo.
    assert.match(t.text, /Intervenciones promedio por mes: 10,42 · intervenciones costeadas: 11/);
    assert.match(t.text, /Efecto del redondeo: \+/);
    const preview = activationRoundingText(off.activationRounding);
    assert.match(preview.text, /se costearían 11/);
    assert.equal(activationRoundingText(base.activationRounding), null, '10 exactas y apagada: sin aviso');
  });
});

describe('qué cuenta como costo por salida (sin doble conteo)', () => {
  const perOf = (mutate) => {
    const q = cot0009Quote();
    q.activity.fullActivations = true;
    mutate(q);
    return buildCostModel(q).activationRounding.perActivation;
  };
  const basePer = perOf(() => {});

  test('externo por llamado y por día con mínimo: sí; por día sin mínimo y por mes: no', () => {
    const perCall = perOf((q) => { q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'activation' }; });
    close(perCall.byCategory.external - basePer.byCategory.external, 100000);
    const perDay = perOf((q) => { q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'day', minimumUnits: 0 }; });
    close(perDay.byCategory.external, basePer.byCategory.external);
    const withMinimum = perOf((q) => { q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'day', minimumUnits: 3 }; });
    close(withMinimum.byCategory.external - basePer.byCategory.external, 300000);
    // La pickup es por mes: nunca es por salida.
    assert.equal(basePer.byCategory.external, 0);
  });

  test('movilización del proveedor (no incluida), materiales y otros costos por llamado, peajes y viáticos', () => {
    const p = perOf((q) => {
      q.equipment[2].external = { ...q.equipment[2].external, price: 0, mobilizationIncluded: false, mobilizationAmount: 40000 };
      q.materials.push({ id: 'm2', description: 'Kit por salida', unit: 'unidad', basis: 'per_activation', quantity: 1, unitCost: 15000, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor' });
      q.otherCosts = [{ id: 'o1', description: 'Permiso por salida', category: 'logistics', behavior: 'per_activation', amount: 8000 }];
      q.logistics.tollsPerActivation = 5000;
      q.logistics.lodgingPerActivation = 20000;
    });
    close(p.direct - basePer.direct, 40000 + 15000 + 8000 + 5000 + 20000);
  });

  test('un equipo transportado o una movilización incluida por el proveedor no suman (ya están en otra línea)', () => {
    const p = perOf((q) => {
      q.equipment[0].mobilization = { mode: 'transported', carrierLineId: 'e2' };
    });
    assert.equal(p.bySource.mobilization || 0, 0);
  });

  test('sueldos y estructura mensual fija no son por salida', () => {
    const p = perOf((q) => { q.indirect = { method: 'per_contract', amount: 500000 }; });
    assert.equal(p.structure, 0, 'una estructura en monto fijo no se redondea');
    assert.equal(p.byCategory.labor, 0);
  });
});

describe('plazo de pago por proveedor', () => {
  test('pickup a 15 días: se financia 15 días más que con Proveedores (30) → +42.000; el costo del externo no cambia', () => {
    const r = variant((q) => { q.equipment[1].supplierPayDays = 15; });
    close(r.kpis.financialCost - base.kpis.financialCost, 2800000 * 0.03 * 15 / 30);
    assert.equal(row(r, 'external'), row(base, 'external'));
    close(r.kpis.workingCapital - base.kpis.workingCapital, 2800000 * 15 / 30);
    const s = r.model.finance.suppliers[0];
    assert.equal(s.label, 'Pickup tercerizada');
    assert.equal(s.payDays, 15);
    assert.equal(s.financingDays, 60);
  });

  test('subcontratista a 45 días y otro externo sin plazo (usa Proveedores)', () => {
    const r = variant((q) => {
      q.equipment[1].supplierPayDays = 45;
      q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'activation' };
    });
    // Pickup: 15 + 60 − 45 = 30 días en lugar de 45 → menos financiero.
    close(r.model.finance.suppliers.find((g) => g.label === 'Pickup tercerizada').financingDays, 30);
    assert.equal(r.model.finance.suppliers.length, 1, 'el externo sin plazo propio queda en Proveedores');
    const withoutTerm = variant((q) => { q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'activation' }; });
    close(r.kpis.financialCost - withoutTerm.kpis.financialCost, -2800000 * 0.03 * 15 / 30);
  });

  test('un plazo mayor que el cobro no financia nada (0 días, nunca negativo)', () => {
    const r = variant((q) => { q.equipment[1].supplierPayDays = 120; });
    assert.equal(r.model.finance.suppliers[0].financingDays, 0);
    close(r.kpis.financialCost - base.kpis.financialCost, -2800000 * 0.03 * 45 / 30);
  });

  test('"Ver cálculo" del financiero: proveedor, salida de caja, plazo, días financiados, capital de trabajo y costo asociado', () => {
    const r = variant((q) => { q.equipment[1].supplierPayDays = 15; });
    const labels = r.traces.financialCost.steps.map((s) => s.label);
    ['salida de caja del mes', 'plazo de pago al proveedor', 'días financiados', 'capital de trabajo', 'costo financiero asociado'].forEach((x) => {
      assert.ok(labels.some((l) => l.startsWith('Pickup tercerizada') && l.includes(x)), x);
    });
    const fin = r.traces.financialCost.steps.find((s) => s.label === 'Pickup tercerizada: costo financiero asociado');
    close(fin.value, 2800000 * 60 / 30 * 0.03);
  });

  test('un plazo negativo es inválido: se avisa y se usa el general', () => {
    const q = cot0009Quote();
    q.equipment[1].supplierPayDays = -5;
    assert.ok(validateQuote(q).some((i) => i.path === 'equipment.1.supplierPayDays'));
    assert.equal(computeQuote(q).kpis.totalCost, base.kpis.totalCost);
  });

  test('salidas completas + plazo propio: la caja de las salidas de más se financia con el plazo del proveedor', () => {
    const q = cot0009Quote();
    q.activity.billableQuantityPerMonth = 2500;
    q.activity.fullActivations = true;
    q.equipment[2].external = { ...q.equipment[2].external, price: 100000, unit: 'activation' };
    q.equipment[2].supplierPayDays = 0;
    const r = computeQuote(q);
    const at = activationRoundingAt(r.model, r.kpis.activeDays);
    close(at.cashByKey['supplier:e3'], 100000 * at.extraActivations);
  });
});
