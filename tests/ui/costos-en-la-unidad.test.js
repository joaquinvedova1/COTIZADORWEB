/**
 * Costos en la unidad cotizada (Joaco 2026-11-18): en precio cerrado, las tarjetas de
 * Materiales, Personal, Equipos y Viajes muestran lo del TRABAJO (lo del mes ÷ trabajos por
 * mes, el mismo divisor que el "Total del trabajo" del Resultado), no "por mes". Por servicio
 * prestado, al lado de lo del mes, el equivalente por unidad cotizada. Sólo presentación: el
 * motor no cambia.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { closedJobsPerMonth, perQuoteUnit, quoteUnitPlace, lineMonthAtEstimate, perBilledUnitSuffix } from '../../js/ui/result-text.js';
import { materialFormulaText } from '../../js/ui/views/quote-steps/materials.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { service, person, material, resetIds } from '../lab/lib/build.js';

const norm = (s) => String(s).replace(/ /g, ' ');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

function closedJob({ jobs = 1, days = 5 } = {}) {
  resetIds();
  const q = service({
    id: 'cu1', serviceType: 'lump_sum', unit: 'job', pricingMode: 'known_activity',
    activity: { billableQuantityPerMonth: jobs, daysPerActivation: days, hoursPerActiveDay: 8 },
    labor: [person({ role: 'Soldador', positions: 2 })],
  });
  q.contract = { mode: 'closed', components: ['labor', 'supplies'] };
  q.materialsNotApplicable = false;
  q.materials = [material({ description: 'Metales', basis: 'per_activation', quantity: 1, unitCost: 1_000_000, providedBy: 'contractor' })];
  return q;
}

describe('Precio cerrado: lo del trabajo, no por mes', () => {
  test('un trabajo de 5 días con metales por $ 1.000.000: el material cuesta $ 1.000.000 en el trabajo', () => {
    const q = closedJob();
    const r = computeQuote(q, { settings: {} });
    close(closedJobsPerMonth(r), 1);
    const l = r.model.materials.lines[0];
    const v = perQuoteUnit(r, lineMonthAtEstimate(r, l));
    close(v.amount, 1_000_000);
    assert.equal(norm(v.text), '$ 1.000.000 en el trabajo');
    assert.equal(quoteUnitPlace(r), 'trabajo');
    const f = norm(materialFormulaText(q.materials[0], l, { activeDays: r.activity.activeDaysPerMonth, activationsPerMonth: r.activity.activationsPerMonth, terms: activationTerms(q), jobsPerMonth: closedJobsPerMonth(r), closed: true }));
    assert.doesNotMatch(f, /mes/);
    assert.match(f, /= \$ 1\.000\.000 en el trabajo$/);
  });

  test('dos trabajos por mes: lo del mes ÷ 2, igual que el "Total del trabajo" del Resultado', () => {
    const r = computeQuote(closedJob({ jobs: 2, days: 5 }), { settings: {} });
    close(closedJobsPerMonth(r), 2);
    const c = priceComposition(r);
    close(perQuoteUnit(r, r.estimate.cost.total).amount, c.contract.cost);
    const l = r.model.materials.lines[0];
    close(perQuoteUnit(r, lineMonthAtEstimate(r, l)).amount, 1_000_000);
    const labor = r.model.labor.lines[0];
    close(perQuoteUnit(r, lineMonthAtEstimate(r, labor)).amount, lineMonthAtEstimate(r, labor) / 2);
  });

  test('por día de trabajo en precio cerrado: costo por día × días del trabajo', () => {
    const q = closedJob({ jobs: 1, days: 4 });
    q.materials[0].basis = 'per_active_day';
    q.materials[0].unitCost = 100_000;
    const r = computeQuote(q, { settings: {} });
    const l = r.model.materials.lines[0];
    const f = norm(materialFormulaText(q.materials[0], l, { activeDays: r.activity.activeDaysPerMonth, activationsPerMonth: r.activity.activationsPerMonth, terms: activationTerms(q), jobsPerMonth: closedJobsPerMonth(r), closed: true }));
    assert.match(f, /4 días de trabajo = \$ 400\.000 en el trabajo/);
    close(perQuoteUnit(r, lineMonthAtEstimate(r, l)).amount, 400_000);
  });

  test('sin trabajos cargados todavía: no se divide y el rótulo sigue "mes"', () => {
    const q = closedJob();
    q.activity.billableQuantityPerMonth = null;
    q.activity.daysPerActivation = null;
    const r = computeQuote(q, { settings: {} });
    assert.equal(closedJobsPerMonth(r), null);
    assert.equal(quoteUnitPlace(r), 'mes');
  });

  test('los números del motor no cambian (sólo presentación)', () => {
    const r = computeQuote(closedJob({ jobs: 2 }), { settings: {} });
    const c = priceComposition(r);
    close(c.contract.cost * 2, r.estimate.cost.total);
  });
});

describe('Por servicio prestado: el equivalente por unidad cotizada', () => {
  test('por día: "≈ $ X por día" = lo del mes ÷ días facturados; nada en fijo mensual ni en precio cerrado', () => {
    resetIds();
    const q = service({ id: 'cu2', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] });
    const r = computeQuote(q, { settings: {} });
    const units = r.estimate.revenue.billableUnits;
    assert.ok(units > 0);
    assert.equal(norm(perBilledUnitSuffix(r, q, 2_000_000)), ` · ≈ $ ${(2_000_000 / units).toLocaleString('es-AR', { maximumFractionDigits: 0 })} por día`);
    assert.equal(perBilledUnitSuffix(r, { ...q, unit: 'month' }, 2_000_000), '');
    const rc = computeQuote(closedJob(), { settings: {} });
    assert.equal(perBilledUnitSuffix(rc, closedJob(), 2_000_000), '');
  });
});
