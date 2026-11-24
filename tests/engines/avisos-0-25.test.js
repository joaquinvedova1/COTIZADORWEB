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
    assert.match(n.message, /«Retro alquilada»: en «¿Quién paga el combustible\?» \(Movilización y viajes\) elegiste el cliente, así que este consumo no se suma/);
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
  test('en L/100 km o km/L sin km de ruta no hay nada que sumar: sin aviso', () => {
    const per100 = probe('PRB-25');
    Object.assign(per100.equipment[0].external, { fuelMode: 'per_100km', fuelLitersPer100Km: 30 });
    assert.ok(!noticeIds(computeQuote(per100)).includes('client_fuel_external_not_summed'));
    const kmL = probe('PRB-25');
    Object.assign(kmL.equipment[0].external, { fuelMode: 'km_per_liter', fuelKmPerLiter: 4 });
    assert.ok(!noticeIds(computeQuote(kmL)).includes('client_fuel_external_not_summed'));
    const withKm = probe('PRB-25');
    Object.assign(withKm.equipment[0].external, { fuelMode: 'per_100km', fuelLitersPer100Km: 30 });
    withKm.logistics = { ...(withKm.logistics || {}), notApplicable: false, distanceKm: 40 };
    assert.ok(noticeIds(computeQuote(withKm)).includes('client_fuel_external_not_summed'), 'con km de ruta sí avisa');
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
  test('relevos: con 2 personas por puesto o nómina de 2 son 110 h por persona: sin aviso', () => {
    const ppp = probe('PRB-26'); ppp.labor[0].peoplePerPosition = 2;
    assert.ok(!noticeIds(computeQuote(ppp)).includes('overtime_hours_over_month'));
    const payroll = probe('PRB-26'); payroll.labor[0].payrollHeadcount = 2;
    assert.ok(!noticeIds(computeQuote(payroll)).includes('overtime_hours_over_month'));
    const shift = probe('PRB-26'); shift.activity.hoursPerActiveDay = 12; shift.labor[0].peoplePerPosition = 2;
    assert.ok(!noticeIds(computeQuote(shift)).includes('overtime_hours_over_month'), '22 × 12 = 264 h entre 2 = 132 h');
    const three = probe('PRB-26'); three.activity.hoursPerActiveDay = 24; three.labor[0].peoplePerPosition = 2;
    const n = computeQuote(three).completeness.notices.find((x) => x.id === 'overtime_hours_over_month');
    assert.ok(n, '22 × 24 = 528 h entre 2 = 264 h por persona: avisa');
    assert.match(n.message, /264 h por persona y por mes \(2 personas por puesto\)/);
  });
  test('trabajo de 44 días: las horas normales cubren los meses del trabajo', () => {
    const job = (available) => {
      const q = probe('PRB-26');
      q.unit = 'job';
      q.activity = { ...q.activity, activeDaysPerMonth: 44, hoursPerActiveDay: 8, availableDaysPerMonth: available, billableQuantityPerMonth: 1, daysPerActivation: 44 };
      return q;
    };
    // 44 días hábiles de 22 por mes = 2 meses: 352 h entre 2 = 176 h por mes, justo las normales.
    assert.ok(!noticeIds(computeQuote(job(22))).includes('overtime_hours_over_month'));
    // Con 30 días disponibles el trabajo dura 1,47 meses: 240 h por mes, más que 176.
    const n = computeQuote(job(30)).completeness.notices.find((x) => x.id === 'overtime_hours_over_month');
    assert.ok(n);
    assert.match(n.message, /44 días × 8 h por día son 240 h por persona y por mes \(el trabajo dura 1,5 meses\)/);
  });
  test('con horas extra cargadas en el puesto (líneas de antes): sin aviso', () => {
    const items = probe('PRB-26'); items.labor[0].overtime = [{ id: 'o', hours: 3, basis: 'per_active_day', premiumPct: 50 }];
    assert.ok(!noticeIds(computeQuote(items)).includes('overtime_hours_over_month'));
    const legacy = probe('PRB-26'); legacy.labor[0].overtimeHoursPerActiveDay = 2; legacy.labor[0].overtimePremiumPct = 50;
    assert.ok(!noticeIds(computeQuote(legacy)).includes('overtime_hours_over_month'));
    const res = probe('PRB-26'); res.labor[0].overtime50HoursPerMonth = 20;
    assert.ok(!noticeIds(computeQuote(res)).includes('overtime_hours_over_month'));
    const zero = probe('PRB-26'); zero.labor[0].overtime = [{ id: 'o', hours: 0, basis: 'per_active_day', premiumPct: 50 }];
    assert.ok(noticeIds(computeQuote(zero)).includes('overtime_hours_over_month'), 'una fila de horas extra en 0 no cuenta');
  });
  test('dos puestos iguales ("Agregar otra persona igual"): un solo aviso, con las dos personas', () => {
    const q = probe('PRB-26');
    q.labor.push({ ...structuredClone(q.labor[0]), id: 'copia' });
    const ns = computeQuote(q).completeness.notices.filter((x) => x.id === 'overtime_hours_over_month');
    assert.equal(ns.length, 1);
    assert.match(ns[0].message, /^«Soldador» \(2 personas\): 22 días × 10 h/);
    assert.deepEqual(ns[0].targets.map((t) => t.index), [0, 1]);
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
