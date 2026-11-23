/**
 * "Pasar a la lista" (PLAN-2026-027, decisión D2): un gasto cargado antes con "Suma en:
 * Insumos y materiales" convertido en una línea de la lista suma EXACTAMENTE lo mismo (total,
 * renglón e hijo de la EECC, grupo de pago, financiación, escenario de materiales y
 * facturación aparte). Los otros renglones y "El servicio no usa insumos ni materiales" no se
 * convierten.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { otherCostToMaterialLine, createQuoteFromTemplate } from '../../js/domain/quote-factory.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { runSensitivity } from '../../js/engines/scenario-engine.js';
import { rateUpdateAmounts } from '../../js/engines/rate-update-engine.js';
import { service, person, material, otherCost } from '../lab/lib/build.js';

const close = (a, b, msg) => assert.ok(Math.abs((a || 0) - (b || 0)) <= Math.max(0.01, Math.abs(a || 0) * 1e-9), `${msg}: ${a} ≠ ${b}`);
const base = (o = {}) => service({
  id: 'conv', serviceType: 'per_unit', unit: 'm3',
  activity: { billableQuantityPerMonth: 300, unitsPerActiveDay: 20, daysPerActivation: 1, hoursPerActiveDay: 9 },
  labor: [person()],
  materials: [material({ description: 'Electrodos', component: 'supplies', basis: 'per_month', quantity: 4, unitCost: 9000 })],
  ...o,
});
const converted = (q) => {
  const next = structuredClone(q);
  const kept = [];
  next.otherCosts.forEach((o, k) => {
    const line = otherCostToMaterialLine(o, next, { id: `conv-${k}` });
    if (line) next.materials.push(line);
    else kept.push(o);
  });
  next.otherCosts = kept;
  return next;
};
const row = (r, cat) => r.eecc.rows.find((x) => x.category === cat) || { amount: 0, children: [] };
const child = (r, id) => (row(r, 'materials').children || []).find((c) => c.component === id)?.amount || 0;
const group = (r, id) => r.model.finance.groups.find((g) => g.id === id) || {};

function assertSame(a, b, label) {
  close(a.kpis.totalCost, b.kpis.totalCost, `${label} total`);
  close(row(a, 'materials').amount, row(b, 'materials').amount, `${label} renglón`);
  close(child(a, 'other'), child(b, 'other'), `${label} hijo other`);
  close(a.kpis.financialCost, b.kpis.financialCost, `${label} financiero`);
  close(a.kpis.targetListRate, b.kpis.targetListRate, `${label} tarifa sugerida`);
  close(group(a, 'materials').cashFixedMonthly, group(b, 'materials').cashFixedMonthly, `${label} grupo de pago (fijo)`);
  close(group(a, 'materials').cashVariablePerActiveDay, group(b, 'materials').cashVariablePerActiveDay, `${label} grupo de pago (por día)`);
  const ra = rateUpdateAmounts(a.eecc);
  const rb = rateUpdateAmounts(b.eecc);
  Object.keys({ ...ra, ...rb }).forEach((k) => close(ra[k], rb[k], `${label} peso ${k}`));
}

describe('otherCostToMaterialLine', () => {
  for (const behavior of ['fixed_monthly', 'per_active_day', 'per_activation', 'per_output']) {
    test(`${behavior}: mismos números, mismo escenario de materiales`, () => {
      const q = base({ otherCosts: [otherCost({ description: 'Permiso municipal', behavior, amount: 54321 })] });
      const q2 = converted(q);
      assert.equal(q2.otherCosts.length, 0);
      const line = q2.materials.at(-1);
      assert.equal(line.component, 'other');
      assert.equal(line.quantity, 1);
      assert.equal(line.unit, 'global');
      assert.equal(line.unitCost, 54321);
      assert.equal(line.base.period, null, 'sin fecha base inventada');
      assertSame(computeQuote(q), computeQuote(q2), behavior);
      const sa = runSensitivity(q, { materialsPct: 20 });
      const sb = runSensitivity(q2, { materialsPct: 20 });
      Object.keys(sa.scenario).forEach((k) => {
        if (typeof sa.scenario[k] === 'number') close(sa.scenario[k], sb.scenario[k], `${behavior} escenario +20 % materiales ${k}`);
      });
      assert.ok(sa.scenario.totalCost > sa.base.totalCost, 'el escenario mueve el gasto');
    });
  }

  test('con "facturar materiales aparte" activo, el gasto convertido sigue sin facturarse', () => {
    const q = base({ otherCosts: [otherCost({ description: 'Permiso', amount: 80000 })], pricing: { materialsBilledSeparately: true } });
    const q2 = converted(q);
    assert.equal(q2.materials.at(-1).billedSeparately, false);
    const a = computeQuote(q);
    const b = computeQuote(q2);
    assertSame(a, b, 'facturar aparte');
    close(a.kpis.revenue, b.kpis.revenue, 'facturación');
  });

  test('conserva el % de uso y la unidad producida', () => {
    const line = otherCostToMaterialLine({ category: 'materials', behavior: 'per_output', amount: 10, usagePct: 50, outputUnit: 'm3' }, base());
    assert.equal(line.basis, 'per_output');
    assert.equal(line.usagePct, 50);
    assert.equal(line.outputUnit, 'm3');
  });

  test('no convierte gastos que suman en otro renglón', () => {
    for (const category of ['labor', 'structure', 'equipment', 'logistics']) {
      assert.equal(otherCostToMaterialLine(otherCost({ category, amount: 1000 }), base()), null, category);
    }
    assert.equal(otherCostToMaterialLine(null, base()), null);
  });

  test('una plantilla con "El servicio no usa insumos ni materiales" no convierte sus gastos', () => {
    const tpl = { id: 'tpl', name: 'Plantilla', defaults: { materialsNotApplicable: true, materials: [], otherCosts: [otherCost({ id: 'o1', amount: 1000 })] } };
    const q = createQuoteFromTemplate(tpl, { organizationId: 'org', now: '2026-10-16T00:00:00.000Z' });
    assert.equal(q.otherCosts.length, 1);
    assert.equal(q.materials.length, 0);
  });
});
