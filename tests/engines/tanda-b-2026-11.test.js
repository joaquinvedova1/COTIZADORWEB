/**
 * Tanda B de correcciones (informe auditado de 5 especialistas, 2026-11,
 * docs/informes/2026-11-especialistas-auditado.md §5): B-2 (materiales y otros
 * costos por unidad producida: la base `per_output` de PLAN-2026-021 con el % de
 * unidades que lo usan, unificada en PLAN-2026-022), B-3 (mínimo garantizado en unidades y ventana
 * de pérdida) y el aviso "Unidad del proveedor" (H-04; los tests de la regla
 * están en eco-01.test.js).
 *
 * Regla de la tanda: ninguna cotización existente cambia de número. Todo lo
 * nuevo es opcional con un default que reproduce el comportamiento anterior.
 * Fixtures: cotizaciones de los especialistas (válvulas C1 y 24 h C2) con el
 * cliente y los nombres reemplazados por rótulos neutros (no cambian números).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeMaterialLine, computeOtherCostLine, usageShareOf } from '../../js/engines/materials-engine.js';
import { autoOutputPerActiveDay, normalizeActivity } from '../../js/engines/cost-engine.js';
import { computeRevenue, normalizeRules } from '../../js/engines/commercial-rules-engine.js';
import { findLossWindows, findBreakEvenDays } from '../../js/engines/break-even-engine.js';
import { materialsResaleOf } from '../../js/engines/economics-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { lossWindowText } from '../../js/ui/result-text.js';

const close = (a, b, tol = 1e-6) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const valves = load('especialista-valvulas-c1');
const crew24 = load('especialista-24h-c2');
const runV = (q) => computeQuote(q, { settings: valves.settings });
const run24 = (q) => computeQuote(q, { settings: crew24.settings });
const v1 = () => structuredClone(valves.quote);
const c2 = () => structuredClone(crew24.quote);
/** Costo de materiales del mes con la actividad estimada (fijo + variable × D), del modelo. */
const materialsMonthly = (r) => r.model.lines.filter((l) => l.category === 'materials').reduce((a, l) => a + l.fixedMonthly + l.variablePerActiveDay * r.kpis.activeDays, 0);
const perValve = (q) => { Object.assign(q.materials[0], { basis: 'per_output', quantity: 1 }); return q; };

// ------------------------------------------------------------------ B-2
describe('B-2: materiales y otros costos por unidad producida (H-11)', () => {
  test('válvulas C1 tal cual (por día, 8 × 18.000): los números de siempre', () => {
    const r = runV(v1());
    close(r.kpis.totalCost, 27248070.099132, 1e-9);
    assert.equal(r.kpis.suggestedListRate, 282000);
    close(materialsMonthly(r) / r.kpis.billableQuantity, 18000);
  });

  test('el error del especialista: con 6 válvulas por día el material "por día" sube a 24.000 por válvula (+33 %)', () => {
    const q = v1();
    q.activity.unitsPerActiveDay = 6;
    const r = runV(q);
    close(materialsMonthly(r) / r.kpis.billableQuantity, 24000);
    assert.equal(r.kpis.suggestedListRate, 311000);
  });

  test('"Por válvula": 18.000 por válvula con 8, 6 y 10 válvulas por día; con 8 da exactamente lo mismo que antes', () => {
    const base = runV(v1());
    const r8 = runV(perValve(v1()));
    close(r8.kpis.totalCost, base.kpis.totalCost, 1e-12);
    assert.equal(r8.kpis.suggestedListRate, base.kpis.suggestedListRate);
    for (const [perDay, suggested] of [[8, 282000], [6, 301000], [10, 270000]]) {
      const q = perValve(v1());
      q.activity.unitsPerActiveDay = perDay;
      const r = runV(q);
      close(materialsMonthly(r) / r.kpis.billableQuantity, 18000);
      close(materialsMonthly(r), 120 * 18000);
      assert.equal(r.kpis.suggestedListRate, suggested, `${perDay} por día`);
    }
  });

  test('% de las unidades que lo usan: 30 % de las válvulas → 5.400 por válvula; vacío = 100 %', () => {
    const q = perValve(v1());
    q.materials[0].usagePct = 30;
    const r = runV(q);
    close(materialsMonthly(r), 120 * 18000 * 0.3);
    const line = r.model.materials.lines[0];
    close(line.usageShare, 0.3);
    close(line.costPerOutputUnit, 5400);
    close(line.outputUnitsAtEstimate, 120);
    close(line.monthlyAtEstimate, 648000);
    assert.equal(usageShareOf(''), 1);
    assert.equal(usageShareOf(null), 1);
    assert.equal(usageShareOf(150), 1, 'se acota a 100 %');
    assert.equal(usageShareOf(-5), 1, 'inválido = 100 % (y la validación lo marca)');
    assert.ok(validateQuote({ ...q, materials: [{ ...q.materials[0], usagePct: 120 }] }).some((i) => i.path === 'materials.0.usagePct'));
  });

  test('merma y logística se aplican como siempre; si lo provee el cliente no es costo', () => {
    const ctx = { daysPerActivation: 1, outputPerActiveDay: 8 };
    const m = computeMaterialLine({ basis: 'per_output', quantity: 2, unitCost: 1000, wastePct: 10, logisticsPct: 5, usagePct: 50, providedBy: 'contractor' }, ctx);
    close(m.grossCost, 2 * 1000 * 1.1 * 1.05);
    close(m.costPerOutputUnit, 2310 * 0.5);
    close(m.variablePerActiveDay, 1155 * 8);
    assert.equal(m.fixedMonthly, 0);
    const client = computeMaterialLine({ basis: 'per_output', quantity: 1, unitCost: 1000, providedBy: 'client' }, ctx);
    assert.equal(client.variablePerActiveDay, 0);
  });

  test('unidades por día de trabajo según la unidad de cobro (sin el relleno del mínimo por llamado)', () => {
    assert.equal(autoOutputPerActiveDay({ unitKind: 'day', daysPerActivation: 1 }), 1);
    assert.equal(autoOutputPerActiveDay({ unitKind: 'hour', hoursPerActiveDay: 10 }), 10);
    assert.equal(autoOutputPerActiveDay({ unitKind: 'quantity', unitsPerActiveDay: 8 }), 8);
    close(autoOutputPerActiveDay({ unitKind: 'event', unitsPerActivation: 3, daysPerActivation: 15 }), 0.2);
    close(autoOutputPerActiveDay({ unitKind: 'event', unitsPerActivation: 1, daysPerActivation: 2 }), 0.5);
    // Con abono mensual no hay unidades por día: cada línea carga su producción (PLAN-2026-021, materials_output).
    assert.equal(autoOutputPerActiveDay({ unitKind: 'month' }), 0);
    const m = computeMaterialLine({ basis: 'per_output', quantity: 1, unitCost: 500, providedBy: 'contractor' }, { outputPerActiveDay: 0 });
    assert.equal(m.fixedMonthly, 0);
    assert.equal(m.variablePerActiveDay, 0);
    // Por hora con mínimo de 4 h por llamado: el material sigue a las horas TRABAJADAS (2 h), no a las facturadas.
    const q = v1();
    Object.assign(q, { unit: 'hour' });
    Object.assign(q.activity, { activeDaysPerMonth: 10, hoursPerActiveDay: 2, daysPerActivation: 1 });
    q.rules.minimumCallUnits = 4;
    Object.assign(q.materials[0], { basis: 'per_output', quantity: 1, unitCost: 1000 });
    const r = runV(q);
    close(r.model.materials.lines[0].variablePerActiveDay, 2000);
    assert.ok(r.estimate.revenue.billableUnits > 20, 'se facturan las horas del mínimo');
    assert.equal(autoOutputPerActiveDay(normalizeActivity(q)), 2);
  });

  test('"¿Se factura aparte?" y la reventa: una línea por válvula facturada aparte se cobra a costo × (1 + recargo) por las unidades del mes', () => {
    const q = perValve(v1());
    Object.assign(q.materials[0], { billedSeparately: true, resaleMarkupPct: 25, usagePct: 30 });
    const r = runV(q);
    const resale = materialsResaleOf(q, r.model);
    close(resale.costPerActiveDay * r.kpis.activeDays, 120 * 18000 * 0.3);
    close(resale.perActiveDay * r.kpis.activeDays, 120 * 18000 * 0.3 * 1.25);
    const c = r.estimate.revenue.components;
    close(c.materialsVariable, 120 * 18000 * 0.3 * 1.25);
    // Con 6 por día lo facturado aparte por válvula no cambia (antes también se desajustaba).
    const q6 = structuredClone(q);
    q6.activity.unitsPerActiveDay = 6;
    close(runV(q6).estimate.revenue.components.materialsVariable, c.materialsVariable);
    // Si la línea no se factura aparte, nada se suma a la facturación.
    q.materials[0].billedSeparately = false;
    assert.equal(materialsResaleOf(q, runV(q).model), null);
  });

  test('otros costos por unidad producida: monto × % que lo usa × unidades del mes', () => {
    const o = computeOtherCostLine({ behavior: 'per_output', amount: 10000, usagePct: 40, category: 'materials' }, { outputPerActiveDay: 8 });
    close(o.variablePerActiveDay, 10000 * 0.4 * 8);
    close(o.costPerOutputUnit, 4000);
    const q = v1();
    q.otherCosts.push({ id: 'oc-b2', description: 'Certificado por válvula', category: 'materials', behavior: 'per_output', amount: 5000 });
    const before = runV(v1());
    const r = runV(q);
    close(r.model.otherCosts.at(-1).monthlyAtEstimate, 120 * 5000);
    assert.ok(r.kpis.totalCost > before.kpis.totalCost + 120 * 5000, 'suma al costo (con estructura, financiero y contingencia)');
    close(r.model.otherCosts.at(-1).outputUnitsAtEstimate, 120);
  });

  test('un solo id: per_billable_unit (nunca publicado) se lee como per_output', () => {
    const ctx = { outputPerActiveDay: 8 };
    const alias = computeMaterialLine({ basis: 'per_billable_unit', quantity: 1, unitCost: 1000, usagePct: 30, providedBy: 'contractor' }, ctx);
    assert.equal(alias.basis, 'per_output');
    close(alias.variablePerActiveDay, 1000 * 0.3 * 8);
    const o = computeOtherCostLine({ behavior: 'per_billable_unit', amount: 1000 }, ctx);
    assert.equal(o.behavior, 'per_output');
    close(o.variablePerActiveDay, 8000);
    const r = runV(perValve(v1()));
    const q = v1();
    Object.assign(q.materials[0], { basis: 'per_billable_unit', quantity: 1 });
    close(runV(q).kpis.totalCost, r.kpis.totalCost, 1e-12);
  });

  test('por día y por llamado: la base cuenta los días y los llamados trabajados', () => {
    const q = v1();
    Object.assign(q, { unit: 'day' });
    Object.assign(q.activity, { activeDaysPerMonth: 10 });
    Object.assign(q.materials[0], { basis: 'per_output', quantity: 1, unitCost: 1000 });
    const r = runV(q);
    close(r.model.materials.lines[0].variablePerActiveDay, 1000);
    close(r.model.materials.lines[0].outputUnitsAtEstimate, 10);
    assert.ok(!r.completeness.items.some((i) => i.id === 'materials_output'), 'por día ya no falta la producción');
  });

  test('aviso informativo (no cambia nada): un material por día con la misma cantidad que las válvulas por día pregunta si es por válvula', () => {
    const r = runV(v1());
    const n = r.completeness.notices.find((x) => x.id === 'materials_per_unit_hint');
    assert.ok(n, 'falta el aviso');
    assert.equal(n.severity, 'info');
    assert.equal(n.focus, 'materials.0.basis');
    assert.match(n.message, /"Por unidad producida"/);
    assert.equal(runV(perValve(v1())).completeness.notices.find((x) => x.id === 'materials_per_unit_hint'), undefined, 'por válvula ya no pregunta');
  });
});

// ------------------------------------------------------------------ B-3
describe('B-3: mínimo garantizado en unidades y ventana de pérdida (H-13, H-29)', () => {
  const SUG = 3233000;
  const fixed = (d, rules) => {
    const q = c2();
    q.activity.activeDaysPerMonth = d;
    q.pricing.offeredRateOverride = SUG;
    Object.assign(q.rules, rules);
    return q;
  };

  test('24 h C2 tal cual: sugerida 3.233.000 por día y "21 días" para no perder', () => {
    const r = run24(c2());
    close(r.kpis.totalCost, 67900424.240128, 1e-9);
    assert.equal(r.kpis.suggestedListRate, SUG);
    close(r.kpis.breakEvenDays, 20.97, 1e-3);
    assert.equal(r.breakEven.lossWindows, undefined, 'sin mínimo no hay ventana');
  });

  test('"mínimo 20 días por mes" en unidades = 20 × tarifa: mismos números que el mínimo en $ cargado a mano', () => {
    for (const d of [26, 20, 15, 10]) {
      const byUnits = run24(fixed(d, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 }));
      const byAmount = run24(fixed(d, { minimumMonthlyGuarantee: 20 * SUG }));
      close(byUnits.kpis.revenue, byAmount.kpis.revenue);
      close(byUnits.kpis.profit, byAmount.kpis.profit);
      close(byUnits.kpis.breakEvenDays, byAmount.kpis.breakEvenDays);
      close(byUnits.estimate.revenue.guarantee, 64660000);
      close(byUnits.estimate.revenue.guaranteeUnitsShortfall, Math.max(0, 20 - d));
    }
    close(run24(fixed(15, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 })).estimate.revenue.guaranteeTopUp, 5 * SUG);
  });

  test('el mínimo en unidades sigue a la tarifa (sin circularidad): la sugerida se calcula sin el mínimo', () => {
    const plain = run24(c2());
    const q = c2();
    Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 });
    const r = run24(q);
    assert.equal(r.kpis.suggestedListRate, plain.kpis.suggestedListRate, 'la sugerida no cuenta el mínimo');
    close(r.estimate.revenue.guarantee, 20 * r.kpis.suggestedListRate);
    q.pricing.offeredRateOverride = 3500000;
    close(run24(q).estimate.revenue.guarantee, 20 * 3500000);
  });

  test('default = $ como siempre: sin modo elegido sólo cuenta el monto; con "unidades" el monto en $ no se usa', () => {
    assert.equal(normalizeRules({ minimumMonthlyGuarantee: 1000 }).minimumGuaranteeBasis, 'amount');
    assert.equal(normalizeRules({ minimumMonthlyGuarantee: 1000 }).hasMinimumGuarantee, true);
    const u = normalizeRules({ minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 0, minimumMonthlyGuarantee: 1000 });
    assert.equal(u.minimumMonthlyGuarantee, 0);
    assert.equal(u.hasMinimumGuarantee, false);
    const activity = { daysPerActivation: 1, hoursPerActiveDay: 8, availableDaysPerMonth: 30 };
    const rev = computeRevenue({ listRate: 100, activeDays: 5, activity, unit: 'day', rules: { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 8, minimumMonthlyGuarantee: 99999 } });
    close(rev.total, 800);
    close(rev.guaranteeTopUp, 300);
    // Más días que los disponibles: el mínimo se prorratea igual que en $ (× meses).
    const long = computeRevenue({ listRate: 100, activeDays: 45, activity, unit: 'day', rules: { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 50 } });
    close(long.guaranteedUnits, 75);
    close(long.guaranteeTopUp, 30 * 100);
    // Por hora: el mínimo se cuenta en horas.
    const hours = computeRevenue({ listRate: 10, activeDays: 2, activity, unit: 'hour', rules: { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 40 } });
    close(hours.guaranteeTopUp, (40 - 16) * 10);
    assert.ok(validateQuote({ rules: { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: -3 } }).some((i) => i.path === 'rules.minimumGuaranteeUnits'));
  });

  test('H-29: con tarifa fija y mínimo de 20 días, la app informa que se pierde entre ≈ 15,85 y 20,97 días (con 10 gana, con 20 pierde)', () => {
    for (const rules of [{ minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 }, { minimumMonthlyGuarantee: 20 * SUG }]) {
      const r10 = run24(fixed(10, rules));
      const r20 = run24(fixed(20, rules));
      assert.ok(r10.kpis.profit > 0, 'con 10 días gana');
      assert.ok(r20.kpis.profit < 0, 'con 20 días pierde');
      close(r20.kpis.breakEvenDays, 20.97, 1e-3);
      assert.equal(r20.breakEven.guaranteeProtects, true);
      assert.equal(r20.breakEven.lossWindows.length, 1);
      const w = r20.breakEven.lossWindows[0];
      close(w.fromDays, 15.85, 1e-3);
      close(w.toDays, r20.kpis.breakEvenDays, 1e-9);
      assert.equal(w.open, false);
      assert.match(lossWindowText(r20, { estimateDays: 20 }), /hasta 15,85 días el mínimo cubre tus costos; entre 15,85 días y 20,97 días perdés plata/);
      assert.match(lossWindowText(r20, { estimateDays: 20 }), /Tu estimación cae en el tramo en que perdés/);
      assert.doesNotMatch(lossWindowText(r10, { estimateDays: 10 }), /Tu estimación cae/);
      assert.ok(r20.traces.breakEven.notes.some((n) => /se pierde plata entre 15,85 días y 20,97 días/.test(n)));
    }
  });

  test('golden de siempre (mínimo 35 M, caso básico): se pierde entre 5 y 10 días', () => {
    const windows = findLossWindows((d) => (Math.max(35, 4 * d) - (30 + d)) * 1e6, { maxDays: 30 });
    assert.equal(windows.length, 1);
    close(windows[0].fromDays, 5);
    close(windows[0].toDays, 10);
    assert.equal(findBreakEvenDays((d) => (Math.max(35, 4 * d) - (30 + d)) * 1e6, { maxDays: 30 }).days, 10);
    // Sin pérdida no hay tramos; pérdida hasta el final queda abierta.
    assert.deepEqual(findLossWindows(() => 1, { maxDays: 30 }), []);
    const open = findLossWindows((d) => 10 - d, { maxDays: 30 });
    assert.equal(open.length, 1);
    assert.equal(open[0].open, true);
    close(open[0].fromDays, 10);
  });

  test('sin mínimo, o con un mínimo que no protege los primeros días, no hay texto nuevo', () => {
    assert.equal(lossWindowText(run24(c2())), null);
    const q = c2();
    Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 1 });
    q.pricing.offeredRateOverride = SUG;
    const r = run24(q);
    assert.equal(r.breakEven.guaranteeProtects, false);
    assert.equal(lossWindowText(r), null);
    close(r.kpis.breakEvenDays, 20.97, 1e-3);
  });
});
