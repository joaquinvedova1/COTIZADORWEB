/**
 * 0.25.0 (PLAN-2026-029, PR 8): dos avisos que faltaban (P-20 y P-22). Son informativos
 * (`notices`): no entran en el puntaje ni en los pendientes, y no cambian ningún número.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { PROBES } from '../lab/scenarios/probes.js';
import { resetIds } from '../lab/lib/build.js';

const probe = (id) => {
  resetIds();
  return structuredClone(PROBES.find((p) => p.id === id).build());
};
const noticeIds = (r) => (r.completeness.notices || []).map((n) => n.id);
/** Lo que no puede cambiar con un aviso informativo. */
const score = (r) => ({ scorePct: r.completeness.scorePct, counts: r.completeness.counts, items: r.completeness.items.map((i) => [i.id, i.status, i.severity]), pending: r.completeness.pending.map((p) => p.id) });

describe('P-20: el combustible del externo no se suma si lo pone el cliente', () => {
  test('con el cliente poniendo el combustible: aviso con el nombre del externo', () => {
    const r = computeQuote(probe('PRB-25'));
    const n = r.completeness.notices.find((x) => x.id === 'client_fuel_external_not_summed');
    assert.ok(n);
    assert.equal(n.severity, 'info');
    assert.equal(n.step, 'equipment');
    assert.match(n.message, /El combustible de «Retro alquilada» no se está sumando/);
    assert.equal(n.focus, 'equipment.0.external.fuelIncluded');
  });
  test('si lo pagamos nosotros, o el externo lo incluye, o no tiene consumo: sin aviso', () => {
    const ours = probe('PRB-25'); ours.fuel.providedBy = 'contractor';
    assert.ok(!noticeIds(computeQuote(ours)).includes('client_fuel_external_not_summed'));
    const included = probe('PRB-25'); included.equipment[0].external.fuelIncluded = true;
    assert.ok(!noticeIds(computeQuote(included)).includes('client_fuel_external_not_summed'));
    const empty = probe('PRB-25'); empty.equipment[0].external.fuelLitersPerHour = 0;
    assert.ok(!noticeIds(computeQuote(empty)).includes('client_fuel_external_not_summed'));
  });
  test('el puntaje y los números son los mismos con o sin el aviso', () => {
    const withNotice = probe('PRB-25');
    const without = probe('PRB-25'); without.equipment[0].external.fuelLitersPerHour = 0;
    const a = computeQuote(withNotice);
    const b = computeQuote(without);
    assert.deepEqual(score(a), score(b));
    assert.deepEqual(a.kpis, b.kpis, 'con el cliente poniendo el combustible, el consumo no mueve ningún número');
  });
});

describe('P-22: por tiempo usado, más horas que las normales del mes sin horas extra', () => {
  test('22 días × 10 h = 220 h contra 176 h normales: aviso', () => {
    const r = computeQuote(probe('PRB-26'));
    const n = r.completeness.notices.find((x) => x.id === 'overtime_hours_over_month');
    assert.ok(n);
    assert.equal(n.step, 'labor');
    assert.equal(n.focus, 'overtimeWork.mode');
    assert.match(n.message, /«Soldador»: 22 días × 10 h por día son 220 h, más que sus 176 horas normales del mes/);
    assert.doesNotMatch(n.message, /jornada/i);
  });
  test('con horas extra elegidas, con menos horas o fuera del tiempo usado: sin aviso', () => {
    const ot = probe('PRB-26'); ot.overtimeWork = { mode: 'all', premiumPct: 50 };
    assert.ok(!noticeIds(computeQuote(ot)).includes('overtime_hours_over_month'));
    const some = probe('PRB-26'); some.overtimeWork = { mode: 'some', hours50: 2 };
    assert.ok(!noticeIds(computeQuote(some)).includes('overtime_hours_over_month'));
    const fewer = probe('PRB-26'); fewer.activity.activeDaysPerMonth = 17;
    assert.ok(!noticeIds(computeQuote(fewer)).includes('overtime_hours_over_month'), '170 h ≤ 176 h');
    const own = probe('PRB-26'); own.labor[0].coverageHoursPerDay = 6;
    assert.ok(!noticeIds(computeQuote(own)).includes('overtime_hours_over_month'), '22 × 6 = 132 h');
    const legacy = probe('PRB-26'); delete legacy.costBasis;
    assert.ok(!noticeIds(computeQuote(legacy)).includes('overtime_hours_over_month'), 'sin tiempo usado rige el control de siempre');
  });
  test('el aviso no cambia el puntaje', () => {
    const a = computeQuote(probe('PRB-26'));
    const fewer = probe('PRB-26'); fewer.labor[0].normalHoursPerMonth = 230;
    const b = computeQuote(fewer);
    assert.ok(noticeIds(a).includes('overtime_hours_over_month') && !noticeIds(b).includes('overtime_hours_over_month'));
    assert.deepEqual(score(a), score(b));
  });
});

describe('se ven en su paso', () => {
  test('STEP_NOTICE_IDS los incluye', () => {
    const src = readFileSync(new URL('../../js/ui/views/quote-editor.js', import.meta.url), 'utf8');
    assert.match(src, /const STEP_NOTICE_IDS = new Set\(\[[^\]]*'client_fuel_external_not_summed', 'overtime_hours_over_month'\]\);/);
  });
});
