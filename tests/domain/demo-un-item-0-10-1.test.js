/**
 * 0.10.1: la demo COT-0001 con la regla de un ítem y la unidad primero (horas extra del trabajo
 * dentro del personal, contrato con categorías de gasto, sin mínimos ni tramos con descuento).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoState, demoHydroCraneQuote, demoReferenceQuote, demoServiceTemplates, DEMO_IDS } from '../../js/domain/demo-data.js';
import { contractOf, modeForUnit, SERVICE_COMPONENT_IDS, LINE_COMPONENT_IDS } from '../../js/domain/contract.js';
import { computeQuote } from '../../js/engines/quote-engine.js';

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

describe('Demo COT-0001 "Hidrogrúa por día — Añelo"', () => {
  const q = demoHydroCraneQuote();

  test('nombre sin "on-call" (cotización, plantilla y demo guiada)', () => {
    assert.equal(q.name, 'Hidrogrúa por día — Añelo');
    const template = demoServiceTemplates().find((t) => t.id.endsWith('2002'));
    assert.equal(template.name, 'Hidrogrúa por día');
    assert.equal(template.defaults.name, 'Hidrogrúa por día');
    const tour = readFileSync(new URL('../../js/ui/views/public/demo-tour.js', import.meta.url), 'utf8');
    assert.doesNotMatch(tour, /on-call/i);
    assert.match(tour, /Está disponible todo el mes, pero sólo cobrás los días que te llaman\./);
    assert.match(q.notes, /además de las 10 h de cada día/);
  });

  test('sin guardia: la demo no se ve como cotización vieja', () => {
    assert.equal(q.activity.availability, 'none');
    assert.ok(!(Number(q.rules.availabilityFeeMonthly) > 0) && !(Number(q.rules.calloutFeePerActivation) > 0));
  });

  test('contrato: el modo sale de la unidad y las categorías son las de 0.10.0', () => {
    assert.equal(q.contract.mode, modeForUnit(q.unit));
    assert.deepEqual(q.contract.components, ['labor', 'vehicle', 'machinery', 'tools', 'supplies', 'materials']);
    q.contract.components.forEach((c) => assert.ok(SERVICE_COMPONENT_IDS.includes(c), c));
    assert.equal(contractOf(q).legacy, false);
    q.materials.forEach((m) => assert.ok(LINE_COMPONENT_IDS.includes(m.component), m.description));
  });

  test('horas extra en "Horas extra del trabajo", no en el puesto', () => {
    assert.deepEqual(q.overtimeWork, { mode: 'some', premiumPct: 50, hours50: 4, hours100: 0 });
    q.labor.forEach((l) => assert.equal(l.overtimeHoursPerActiveDay, 0));
    const r = computeQuote(q, { settings: createDemoState(5).settings });
    const line = r.model.lines.find((x) => x.key === 'labor:overtime-work');
    assert.ok(line && line.category === 'labor');
    near(r.model.overtimeWork.monthlyAtEstimate, 1190087);
  });

  test('un solo precio: sin cobros aparte, mínimo por llamado ni tramos con descuento', () => {
    const rules = q.rules;
    ['availabilityFeeMonthly', 'calloutFeePerActivation', 'mobilizationFeePerActivation', 'extraKmRate', 'standbyRatePerDay', 'minimumCallUnits', 'minimumMonthlyGuarantee', 'continuityDiscountPct']
      .forEach((k) => assert.ok(!(Number(rules[k]) > 0), k));
    assert.ok(rules.volumeTiers.every((t) => !(Number(t.discountPct) > 0)));
    assert.deepEqual(q.extras || [], []);
  });

  test('números ILUSTRATIVOS: costo 16.380.305, sugerida 2.276.000 por día', () => {
    const r = computeQuote(q, { settings: createDemoState(5).settings });
    near(r.kpis.totalCost, 16380305);
    assert.equal(r.kpis.suggestedListRate, 2276000);
  });

  test('el caso de referencia sigue sin contrato ni horas extra (break-even 10 días)', () => {
    const ref = demoReferenceQuote();
    assert.equal(ref.contract, undefined);
    assert.equal(ref.overtimeWork, undefined);
    const r = computeQuote(ref, { settings: createDemoState(5).settings });
    assert.equal(r.breakEven.days, 10);
    assert.equal(createDemoState(5).quotes.find((x) => x.id === DEMO_IDS.quoteReference).code, 'COT-0002');
  });
});
