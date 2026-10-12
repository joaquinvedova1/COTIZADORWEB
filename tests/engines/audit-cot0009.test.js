/**
 * PLAN-2026-010 · Auditoría COT-0009: lo que se agregó sin cambiar los números
 * de las cotizaciones existentes.
 *
 *  - Horas extra por tramos (HE 50 %, HE 100 %, otro recargo): el campo único
 *    de siempre da EXACTAMENTE lo mismo que un tramo equivalente.
 *  - Estructura desglosada por rubro: un rubro igual al modo simple da lo mismo.
 *  - Impacto incremental de una línea (sólo trazabilidad).
 *  - Comparador de modelos en $/unidad: mismos ingresos que por día.
 *  - Completitud: severidades, líneas nombradas y avisos informativos.
 *  - Fecha base: "usar el mes de la oferta" sólo para valores sin base.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeLaborLine, overtimeItemsOf } from '../../js/engines/labor-engine.js';
import { lineIncrementalImpact } from '../../js/engines/impact-engine.js';
import { compareCommercialModels } from '../../js/engines/scenario-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { summarizeEconomicBase } from '../../js/engines/economic-base-engine.js';
import { assignOfferBase } from '../../js/domain/economic-base.js';
import { deepClone } from '../../js/core/object.js';
import { draftBannerText } from '../../js/ui/result-text.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';

const close = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `esperado ${expected}, obtenido ${actual}`);

const LINE = {
  role: 'Operador', positions: 2, peoplePerPosition: 1.5, basicMonthly: 1760000, additionalsMonthly: 0, normalHoursPerMonth: 176,
  overtimeHoursPerActiveDay: 0, overtimePremiumPct: 0, mealPerActiveDay: 0, sacPct: 8.33, vacationPct: 4.17, employerContributionsPct: 24, artPct: 3,
  insuranceMonthly: 0, ppeMonthly: 0, trainingMonthly: 0, transferMonthly: 0,
};

describe('horas extra por tramos (HE 50 % / 100 % / otro)', () => {
  test('el campo único de siempre y un tramo equivalente dan el mismo costo, al centavo', () => {
    const legacy = computeLaborLine({ ...LINE, overtimeHoursPerActiveDay: 2, overtimePremiumPct: 50 });
    const tiers = computeLaborLine({ ...LINE, overtime: [{ label: 'HE 50 %', premiumPct: 50, hours: 2, basis: 'per_active_day' }] });
    assert.equal(tiers.variablePerActiveDay, legacy.variablePerActiveDay);
    assert.equal(tiers.fixedMonthly, legacy.fixedMonthly);
    assert.equal(overtimeItemsOf({ overtimeHoursPerActiveDay: 2, overtimePremiumPct: 50 }).length, 1);
    assert.equal(overtimeItemsOf({ overtimeHoursPerActiveDay: 0 }).length, 0);
  });

  test('HE 50 % y HE 100 % por día activo: horas × valor hora × (1 + recargo) × cargas × posiciones', () => {
    const r = computeLaborLine({ ...LINE, overtime: [
      { premiumPct: 50, hours: 2, basis: 'per_active_day' },
      { premiumPct: 100, hours: 1, basis: 'per_active_day' },
    ] });
    const hourly = 1760000 / 176; // 10.000
    const load = r.perPerson.loadFactor;
    const perPosition = (2 * hourly * 1.5 + 1 * hourly * 2) * load;
    close(r.perPosition.overtimePerActiveDay, perPosition);
    close(r.variablePerActiveDay, perPosition * 2);
    // Sin horas extra por mes, el fijo no cambia.
    assert.equal(r.fixedMonthly, computeLaborLine(LINE).fixedMonthly);
  });

  test('horas promedio por mes: fijo del mes por persona × dotación (no por día)', () => {
    const r = computeLaborLine({ ...LINE, overtime: [{ premiumPct: 50, hours: 20, basis: 'per_month' }] });
    const base = computeLaborLine(LINE);
    const perPerson = 20 * (1760000 / 176) * 1.5 * r.perPerson.loadFactor;
    close(r.perPerson.overtimeMonthly, perPerson);
    close(r.fixedMonthly - base.fixedMonthly, perPerson * 3); // 2 posiciones × 1,5 personas
    assert.equal(r.variablePerActiveDay, base.variablePerActiveDay);
  });

  test('horas extra facturadas aparte: siguen siendo costo y suman ingreso (horas × precio por hora)', () => {
    const q = cot0009Quote();
    q.labor[0].overtime = [{ premiumPct: 50, hours: 2, basis: 'per_active_day', billRatePerHour: 30000 }];
    const notBilled = computeQuote(q);
    q.labor[0].overtimeBilled = true;
    const billed = computeQuote(q);
    // Mismo costo (las horas extra cuestan igual se facturen o no).
    close(billed.kpis.totalCost, notBilled.kpis.totalCost, 1);
    // Ingreso extra: 2 h × $ 30.000 × 20 días × 1 posición = 1.200.000 por mes.
    close(billed.estimate.revenue.components.overtimeVariable, 1200000);
    assert.equal(notBilled.estimate.revenue.components.overtimeVariable, 0);
  });
});

describe('estructura desglosada por rubro', () => {
  test('un rubro igual al modo simple da exactamente el mismo costo', () => {
    const simple = computeQuote(cot0009Quote());
    const q = cot0009Quote();
    q.indirect = { ...q.indirect, mode: 'detailed', items: [{ id: 's1', label: 'Administración', method: 'percent_direct', pct: 10, amount: 0 }] };
    const detailed = computeQuote(q);
    assert.equal(detailed.kpis.totalCost, simple.kpis.totalCost);
    assert.equal(detailed.model.structure.mode, 'detailed');
  });

  test('cada rubro con su método: % directo + por empleado + por contrato', () => {
    const q = cot0009Quote();
    q.indirect = { ...q.indirect, mode: 'detailed', items: [
      { label: 'Administración', method: 'percent_direct', pct: 5 },
      { label: 'HSE', method: 'per_employee', amount: 100000 },
      { label: 'Seguros generales', method: 'per_contract', amount: 300000 },
    ] };
    const r = computeQuote(q);
    const items = r.model.structure.items;
    assert.equal(items.length, 3);
    close(items[1].fixedMonthly, 100000 * r.model.labor.headcount);
    close(items[2].fixedMonthly, 300000);
    const structureRow = r.eecc.rows.find((x) => x.category === 'structure');
    close(structureRow.amount, items.reduce((acc, it) => acc + it.fixedMonthly + it.variablePerActiveDay * r.activity.activeDaysPerMonth, 0), 1);
  });

  test('modo desglosado sin lista (datos raros) vuelve al modo simple; sin rubros, estructura 0 y completitud lo marca', () => {
    const q = cot0009Quote();
    q.indirect = { ...q.indirect, mode: 'detailed', items: null };
    assert.equal(computeQuote(q).kpis.totalCost, computeQuote(cot0009Quote()).kpis.totalCost);
    q.indirect.items = [];
    const r = computeQuote(q);
    const row = r.eecc.rows.find((x) => x.category === 'structure');
    assert.ok(!row || row.amount === 0);
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'structure').status, 'warning');
  });
});

describe('impacto incremental de una línea (trazabilidad)', () => {
  test('COT-0009: la pickup de $ 2.800.000 sube el costo $ 3.221.400 (proveedor + estructura + financiación)', () => {
    const q = cot0009Quote();
    const impact = lineIncrementalImpact(q, { list: 'equipment', index: 1 });
    close(impact.own, 2800000);
    close(impact.structure, 280000);
    close(impact.financial, 141400);
    close(impact.contingency, 0);
    close(impact.total, 3221400);
    close(impact.other, 0);
  });

  test('no modifica la cotización y rechaza índices inválidos', () => {
    const q = cot0009Quote();
    const before = JSON.stringify(q);
    lineIncrementalImpact(q, { index: 0 });
    assert.equal(JSON.stringify(q), before);
    assert.equal(lineIncrementalImpact(q, { index: 9 }), null);
    assert.equal(lineIncrementalImpact(q, { index: -1 }), null);
  });
});

describe('comparador de modelos en $/unidad (m³, viaje, unidad)', () => {
  test('COT-0009 en m³: mismos ingresos y resultados que por día, parámetros por m³', () => {
    const q = cot0009Quote();
    const perUnit = compareCommercialModels(q);
    const asDay = cot0009Quote();
    asDay.serviceType = 'on_call';
    asDay.unit = 'day';
    asDay.activity.activeDaysPerMonth = 20;
    const perDay = compareCommercialModels(asDay);
    assert.deepEqual(perUnit.models.map((m) => m.id), ['unit_rate', 'availability_plus_unit', 'guarantee_plus_unit', 'package_plus_excess_unit']);
    assert.equal(perUnit.unit.kind, 'quantity');
    assert.equal(perUnit.unitsPerActiveDay, 120);
    assert.equal(perUnit.estimatedQuantity, 2400);
    perUnit.models.forEach((m, i) => {
      close(m.expectedRevenue, perDay.models[i].expectedRevenue, 1);
      close(m.expectedProfit, perDay.models[i].expectedProfit, 1);
    });
    const unitRate = perUnit.models[0];
    close(unitRate.params.ratePerUnit * 120, perDay.models[0].params.ratePerDay);
    close(unitRate.breakEvenQuantity, unitRate.breakEvenDays * 120);
    const pkg = perUnit.models[3];
    assert.equal(pkg.params.includedUnits, 2400);
  });

  test('sin m³ por día de trabajo no inventa modelos', () => {
    const q = cot0009Quote();
    q.activity.unitsPerActiveDay = 0;
    const out = compareCommercialModels(q);
    assert.equal(out.models.length, 0);
    assert.ok(out.reason);
  });
});

describe('completitud: severidad, líneas nombradas y avisos informativos', () => {
  test('COT-0009: el externo sin tarifa es CRÍTICO y se nombra la línea', () => {
    const c = evaluateCompleteness(cot0009Quote());
    const eq = c.items.find((i) => i.id === 'equipment_cost');
    assert.equal(eq.status, 'missing');
    assert.equal(eq.severity, 'critical');
    assert.match(eq.message, /"Equipo alquilado"/);
    assert.deepEqual(eq.targets.map((t) => t.index), [2]);
    assert.ok(c.critical >= 1);
    assert.equal(c.pending[0].severity, 'critical');
    assert.equal(c.critical + c.review, c.pending.length);
  });

  test('equipo propio sin costo de capital: aviso INFORMATIVO, no resta puntaje', () => {
    const q = cot0009Quote();
    const c = evaluateCompleteness(q);
    const notice = c.notices.find((n) => n.id === 'capital_cost');
    assert.ok(notice);
    assert.equal(notice.severity, 'info');
    assert.match(notice.message, /Vactor/);
    q.equipment[0].capitalRatePctAnnual = 8;
    const withCapital = evaluateCompleteness(q);
    assert.equal(withCapital.notices.length, 0);
    assert.equal(withCapital.scorePct, c.scorePct);
  });

  test('banner de borrador: cuenta críticos y para revisar, nunca los informativos', () => {
    assert.equal(draftBannerText({ critical: 0, review: 0 }), null);
    const one = draftBannerText({ critical: 0, review: 1 });
    assert.equal(one.tone, 'warning');
    assert.equal(one.title, 'BORRADOR — revisar 1 punto antes de usar esta tarifa.');
    const many = draftBannerText({ critical: 2, review: 3 });
    assert.equal(many.tone, 'danger');
    assert.equal(many.title, 'BORRADOR — revisar 5 puntos antes de usar esta tarifa.');
    assert.match(many.text, /2 críticos/);
    assert.equal(draftBannerText({ critical: NaN, review: -1 }), null);
  });
});

describe('fecha base: el mes de la oferta sólo para valores sin base, nunca en silencio', () => {
  test('asigna el período a los valores sin base, no pisa bases definidas y no cambia montos', () => {
    const q = cot0009Quote();
    q.offerDate = '2026-10-12';
    q.labor[0].base = { period: '2026-08', currency: null, source: 'agreement', note: '' };
    const before = computeQuote(q);
    const info = summarizeEconomicBase(q);
    assert.ok(info.undefinedCount > 0);
    const draft = deepClone(q);
    const count = assignOfferBase(draft, info.undefinedEntries.map((e) => e.path), info.offerPeriod);
    assert.equal(count, info.undefinedCount);
    assert.equal(draft.labor[0].base.period, '2026-08');
    assert.equal(draft.labor[0].base.source, 'agreement');
    assert.equal(draft.equipment[0].base.period, '2026-10');
    assert.equal(draft.equipment[0].base.source, 'offer');
    assert.equal(summarizeEconomicBase(draft).undefinedCount, 0);
    assert.equal(computeQuote(draft).kpis.totalCost, before.kpis.totalCost);
  });

  test('rutas desconocidas o período inválido: no hace nada', () => {
    const q = cot0009Quote();
    assert.equal(assignOfferBase(q, ['pricing.base', '__proto__.base', 'labor.0.role'], '2026-10'), 0);
    assert.equal(assignOfferBase(q, ['labor.0.base'], '2026-13'), 0);
    assert.equal(assignOfferBase(q, ['labor.9.base'], '2026-10'), 0);
  });
});
