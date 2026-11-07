/**
 * Tanda B 2026-11, B-1 (PLAN-2026-023): asistente opcional de diagrama de rotación por
 * puesto y nómina total del puesto (`labor[i].payrollHeadcount`). Informe auditado de los
 * especialistas (docs/informes/2026-11-especialistas-auditado.md): H-12, H-07, H-06, H-14.
 *
 * Reglas: el diagrama sólo PROPONE (no cambia el costo); el costo cambia sólo al aplicar la
 * propuesta (posiciones, nómina, días entre relevos). Sin los campos nuevos, todo da igual
 * que antes. Casos reales: 24h C1 (2 en sitio, 14x14 → 4) y 2x1 C1 (3 en sitio, 14x7 → 4,5 → 5).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeLaborLine, laborHeadcountOf, laborPeoplePerPositionOf } from '../../js/engines/labor-engine.js';
import { computeRotation, rotationTrace, ROTATION_TEMPLATES } from '../../js/engines/rotation-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { service, person, resetIds } from '../lab/lib/build.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const c24 = fixture('especialista-24h-c1.json');
const c2x1 = fixture('especialista-2x1-c1.json');
const run = (fx, mutate = () => {}) => {
  const q = structuredClone(fx.quote);
  mutate(q);
  return computeQuote(q, { settings: fx.settings });
};

/** Lo que hace "Aplicar al puesto" en la UI: en sitio → posiciones, nómina → payrollHeadcount. */
function applyProposal(line) {
  const rot = computeRotation(line.rotation, { positions: line.positions });
  line.positions = rot.onSite;
  line.payrollHeadcount = rot.payroll;
  line.peoplePerPosition = Math.round((rot.payroll / rot.onSite) * 1e4) / 1e4;
  return rot;
}

describe('B-1 · computeRotation: propuesta del diagrama', () => {
  test('24h C1: 14x14 con 2 en sitio → 4 en nómina, 2,14 relevos por mes, uno cada 14 días', () => {
    const rot = computeRotation({ daysOn: 14, daysOff: 14, onSite: 2, shiftsPerDay: 2, hoursPerShift: 12 });
    assert.equal(rot.ready, true);
    assert.equal(rot.label, '14x14');
    assert.equal(rot.templateId, '14x14');
    assert.equal(rot.payrollExact, 4);
    assert.equal(rot.payroll, 4);
    assert.equal(rot.fractional, false);
    close(rot.relievesPerMonth, 30 / 14);
    assert.equal(rot.daysBetweenRelieves, 14);
    assert.equal(rot.peoplePerRelief, 2);
    assert.equal(rot.onSitePerDay, 2);
    assert.equal(rot.personDaysOnSitePerMonth, 60);
    assert.equal(rot.shiftHoursPerDay, 24);
    assert.equal(rot.coverageHoursPerDay, 12);
  });

  test('2x1 C1: 14x7 con 3 en sitio → 4,5 exacta → 5 hacia arriba (3,33 en sitio en promedio); 2 grupos → 4,29 relevos', () => {
    const rot = computeRotation({ daysOn: 14, daysOff: 7, onSite: 3, groups: 2 });
    close(rot.onSiteShare, 2 / 3);
    close(rot.payrollExact, 4.5);
    assert.equal(rot.fractional, true);
    assert.equal(rot.rounding, 'up');
    assert.equal(rot.payroll, 5);
    close(rot.averageOnSite, 10 / 3);
    close(rot.spare, 0.5);
    close(rot.relievesPerMonth, 30 / 14 * 2);
    assert.equal(rot.daysBetweenRelieves, 7);
    assert.equal(rot.peoplePerRelief, 1.5);
    close(rot.peoplePerPosition, 5 / 3);
  });

  test('redondeo "exacto" deja el decimal (4,5) y lo elige quien cotiza', () => {
    const rot = computeRotation({ daysOn: 14, daysOff: 7, onSite: 3, rounding: 'exact' });
    close(rot.payroll, 4.5);
    assert.equal(rot.rounding, 'exact');
    // Un valor desconocido de redondeo usa el default (hacia arriba).
    assert.equal(computeRotation({ daysOn: 14, daysOff: 7, onSite: 3, rounding: 'raro' }).payroll, 5);
  });

  test('campos libres: 20x10, 5x2, 21x7, días del mes propios', () => {
    assert.equal(computeRotation({ daysOn: 20, daysOff: 10, onSite: 4 }).payroll, 6);
    close(computeRotation({ daysOn: 5, daysOff: 2, onSite: 1 }).payrollExact, 1.4);
    assert.equal(computeRotation({ daysOn: 5, daysOff: 2, onSite: 1 }).payroll, 2);
    const free = computeRotation({ daysOn: 21, daysOff: 7, onSite: 2, daysPerMonth: 31 });
    assert.equal(free.templateId, null);
    assert.equal(free.label, '21x7');
    close(free.payrollExact, 8 / 3);
    assert.equal(free.payroll, 3);
    close(free.relievesPerMonth, 31 / 21);
  });

  test('sin franco no hay relevos (nómina = en sitio); sin datos no hay propuesta (sin NaN)', () => {
    const noOff = computeRotation({ daysOn: 30, daysOff: 0, onSite: 2 });
    assert.equal(noOff.payroll, 2);
    assert.equal(noOff.relievesPerMonth, 0);
    assert.equal(noOff.daysBetweenRelieves, null);
    for (const empty of [null, undefined, {}, { daysOn: 0, daysOff: 7, onSite: 3 }, { daysOn: -14, daysOff: 7, onSite: 3 }, { daysOn: 'x' }]) {
      const rot = computeRotation(empty);
      assert.equal(rot.ready, false);
      assert.equal(rot.payroll, null);
      assert.equal(rot.relievesPerMonth, null);
      assert.equal(rotationTrace(rot), null);
    }
  });

  test('"en sitio" vacío toma las posiciones del puesto; grupos vacío o 0 = 1', () => {
    const rot = computeRotation({ daysOn: 14, daysOff: 14 }, { positions: 3 });
    assert.equal(rot.onSite, 3);
    assert.equal(rot.onSiteFromPositions, true);
    assert.equal(rot.payroll, 6);
    assert.equal(computeRotation({ daysOn: 14, daysOff: 14, onSite: 2, groups: 0 }).groups, 1);
  });

  test('las plantillas son atajos editables (no una lista cerrada) y la traza explica la cuenta', () => {
    assert.deepEqual(ROTATION_TEMPLATES.map((t) => t.id), ['7x7', '14x14', '14x7', '20x10', '5x2']);
    const trace = rotationTrace(computeRotation({ daysOn: 14, daysOff: 7, onSite: 3, groups: 2 }), { role: 'Operario' });
    assert.match(trace.formula, /Nómina = personas en sitio × \(días en sitio \+ días de franco\) ÷ días en sitio/);
    assert.equal(trace.result.value, 5);
  });
});

describe('B-1 · nómina total del puesto (payrollHeadcount)', () => {
  const base = { role: 'Operario', positions: 3, peoplePerPosition: 1.5, basicMonthly: 1000000, normalHoursPerMonth: 176, overtimeHoursPerActiveDay: 2, overtimePremiumPct: 50, mealPerActiveDay: 1000, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6 };

  test('sin el campo (o vacío / 0), igual que siempre: posiciones × personas por posición', () => {
    const before = computeLaborLine(base);
    for (const v of [undefined, null, '', 0]) {
      const after = computeLaborLine({ ...base, payrollHeadcount: v });
      assert.deepEqual({ ...after, payrollMode: undefined, rotation: undefined }, { ...before, payrollMode: undefined, rotation: undefined });
      assert.equal(after.payrollMode, false);
    }
    assert.equal(before.headcount, 4.5);
  });

  test('con nómina 5 y 3 posiciones: fijo × 5, horas extra y vianda × 3 (los que están en sitio)', () => {
    const l = computeLaborLine({ ...base, payrollHeadcount: 5 });
    const ref = computeLaborLine({ ...base, peoplePerPosition: 5 / 3 });
    assert.equal(l.payrollMode, true);
    assert.equal(l.headcount, 5);
    close(l.peoplePerPosition, 5 / 3);
    close(l.fixedMonthly, l.perPerson.fixedMonthly * 5);
    close(l.fixedMonthly, ref.fixedMonthly);
    assert.equal(l.variablePerActiveDay, ref.variablePerActiveDay);
    close(l.hoursPerMonth, 176 * 5);
    assert.equal(laborHeadcountOf({ ...base, payrollHeadcount: 5 }), 5);
    close(laborPeoplePerPositionOf({ ...base, payrollHeadcount: 5 }), 5 / 3);
  });

  test('con 0 posiciones el puesto no trabaja aunque tenga nómina', () => {
    const l = computeLaborLine({ ...base, positions: 0, payrollHeadcount: 5 });
    assert.equal(l.headcount, 0);
    assert.equal(l.fixedMonthly, 0);
  });

  test('cargar el diagrama no cambia el costo (sólo propone)', () => {
    const l = computeLaborLine({ ...base, rotation: { daysOn: 14, daysOff: 7, onSite: 3, groups: 2 } });
    const ref = computeLaborLine(base);
    assert.equal(l.fixedMonthly, ref.fixedMonthly);
    assert.equal(l.headcount, 4.5);
    assert.equal(l.rotation.payroll, 5);
    assert.equal(ref.rotation, null);
  });

  test('"Actualizar en esta cotización" conserva nómina y diagrama (son de la cotización, no del recurso)', () => {
    const line = { id: 'l1', role: 'Operario', positions: 3, payrollHeadcount: 5, rotation: { daysOn: 14, daysOff: 7, onSite: 3 }, snapshot: { resourceType: 'laborProfiles', resourceId: 'p1' } };
    const next = applyResourceUpdate('labor', line, { laborProfiles: [{ id: 'p1', role: 'Operario', basicMonthly: 2000000 }] });
    assert.equal(next.payrollHeadcount, 5);
    assert.deepEqual(next.rotation, line.rotation);
  });

  test('validación: nómina y datos del diagrama negativos o fuera de rango son errores', () => {
    resetIds();
    const q = service({ labor: [person({ payrollHeadcount: -1, rotation: { daysOn: -1, daysOff: 400, hoursPerShift: 30, daysPerMonth: 40 } })] });
    const paths = validateQuote(q).map((i) => i.path);
    for (const p of ['labor.0.payrollHeadcount', 'labor.0.rotation.daysOn', 'labor.0.rotation.daysOff', 'labor.0.rotation.hoursPerShift', 'labor.0.rotation.daysPerMonth']) {
      assert.ok(paths.includes(p), `falta validar ${p}`);
    }
    const ok = service({ labor: [person({ payrollHeadcount: 5, rotation: { daysOn: 14, daysOff: 7, onSite: 3 } })] });
    assert.deepEqual(validateQuote(ok).filter((i) => i.path.startsWith('labor.')), []);
  });
});

describe('B-1 · casos reales de los especialistas', () => {
  test('24h C1 sin tocar nada: mismos números que en el informe ($ 70.247.873 / $ 86.941.000)', () => {
    const r = run(c24);
    assert.equal(Math.round(r.kpis.totalCost), 70247873);
    assert.equal(r.kpis.commercialListRate, 86941000);
    assert.equal(r.model.labor.headcount, 4);
  });

  test('24h C1: el diagrama 14x14 con turnos de 12 h saca el aviso falso de horas sin cambiar el costo', () => {
    const before = run(c24);
    assert.ok(before.completeness.pending.some((x) => x.id === 'labor_hours'), 'antes: aviso de horas (2 × 176 h contra 30 × 24 h)');
    const r = run(c24, (q) => { q.labor[0].rotation = { daysOn: 14, daysOff: 14, onSite: 2, shiftsPerDay: 2, hoursPerShift: 12 }; });
    assert.equal(r.kpis.totalCost, before.kpis.totalCost);
    assert.equal(r.completeness.pending.some((x) => x.id === 'labor_hours'), false);
    const rot = r.model.labor.lines[0].rotation;
    assert.equal(rot.payroll, 4);
    close(rot.relievesPerMonth, 30 / 14);
  });

  test('24h C1: aplicar 4 en nómina + 14 días entre relevos reemplaza el truco de 0,0714 viajes (variante G: $ 70.247.973)', () => {
    const r = run(c24, (q) => {
      const l = q.labor[0];
      l.rotation = { daysOn: 14, daysOff: 14, onSite: 2, shiftsPerDay: 2, hoursPerShift: 12 };
      const rot = applyProposal(l);
      q.activity.daysPerActivation = rot.daysBetweenRelieves; // "Usar como días entre relevos"
      q.logistics.tripsPerActivation = 1; // un viaje por relevo, sin decimales
      q.logistics.lodgingPerActivation = 30000; // viáticos por relevo (antes 2.143 "por día")
    });
    assert.equal(r.model.labor.headcount, 4);
    assert.equal(r.model.labor.positions, 2);
    close(r.activity.activationsPerMonth, 30 / 14);
    assert.equal(Math.round(r.kpis.totalCost), 70247973);
    assert.equal(r.kpis.commercialListRate, 86941000);
  });

  test('2x1 C1 sin tocar nada: 4,5 personas ($ 84.542.140 / $ 105.022.000) y el aviso de personas no enteras', () => {
    const r = run(c2x1);
    assert.equal(Math.round(r.kpis.totalCost), 84542140);
    assert.equal(r.kpis.commercialListRate, 105022000);
    assert.equal(r.model.labor.headcount, 4.5);
    assert.ok(r.completeness.notices.some((n) => n.id === 'labor_fractional_headcount'));
  });

  test('2x1 C1: 14x7 con 3 en sitio → 5 en nómina: $ 89,81 M de costo y $ 111,57 M sugerida (lo que calculó el especialista con 5)', () => {
    const r = run(c2x1, (q) => {
      q.labor[0].rotation = { daysOn: 14, daysOff: 7, onSite: 3, groups: 2 };
      applyProposal(q.labor[0]);
    });
    assert.equal(r.model.labor.headcount, 5);
    assert.equal(r.model.labor.lines[0].payrollMode, true);
    assert.equal(Math.round(r.kpis.totalCost), 89810129);
    assert.equal(r.kpis.commercialListRate, 111566000);
    // Sin "5,0001 personas" (5/3 cargado con decimales) ni aviso de personas no enteras.
    assert.equal(r.completeness.notices.some((n) => n.id === 'labor_fractional_headcount'), false);
  });

  test('2x1 C1 con redondeo exacto: aplicar deja 4,5 y los mismos números de antes', () => {
    const before = run(c2x1);
    const r = run(c2x1, (q) => {
      q.labor[0].rotation = { daysOn: 14, daysOff: 7, onSite: 3, groups: 2, rounding: 'exact' };
      applyProposal(q.labor[0]);
    });
    close(r.kpis.totalCost, before.kpis.totalCost, 1e-12);
    assert.equal(r.kpis.commercialListRate, before.kpis.commercialListRate);
    const n = r.completeness.notices.find((x) => x.id === 'labor_fractional_headcount');
    assert.ok(n, 'con nómina 4,5 se sigue preguntando cuántas hay de verdad');
    assert.equal(n.focus, 'labor.0.payrollHeadcount');
    assert.match(n.message, /personas en nómina/);
  });
});

describe('B-1 · aviso de horas y relevos con nómina y turnos', () => {
  const quote24 = (labor) => {
    resetIds();
    return service({ serviceType: 'permanent', activity: { activeDaysPerMonth: 30, availableDaysPerMonth: 30, hoursPerActiveDay: 24, availability: '24/7' }, labor: [person({ role: 'Operador', ...labor })] });
  };

  test('el aviso usa las horas por turno del diagrama si "horas por día que cubre este puesto" está vacío', () => {
    const without = evaluateCompleteness(quote24({ positions: 2, peoplePerPosition: 2 }));
    assert.ok(without.items.some((x) => x.id === 'labor_hours'));
    const shift = evaluateCompleteness(quote24({ positions: 2, peoplePerPosition: 2, overtimeHoursPerActiveDay: 1, rotation: { daysOn: 14, daysOff: 14, hoursPerShift: 12 } }));
    // 30 × 12 = 360 h; cubre 2 × 176 + 1 × 30 = 382 h.
    assert.equal(shift.items.some((x) => x.id === 'labor_hours'), false);
    // El campo explícito manda sobre el diagrama.
    const explicit = evaluateCompleteness(quote24({ positions: 2, peoplePerPosition: 2, coverageHoursPerDay: 24, rotation: { hoursPerShift: 12 } }));
    assert.ok(explicit.items.some((x) => x.id === 'labor_hours'));
  });

  test('el aviso cuenta la nómina total: 2 posiciones con 4 en nómina = 2 por posición', () => {
    const c = evaluateCompleteness(quote24({ positions: 2, peoplePerPosition: 1, payrollHeadcount: 4, overtimeHoursPerActiveDay: 1, coverageHoursPerDay: 12 }));
    assert.equal(c.items.some((x) => x.id === 'labor_hours'), false);
    const short = evaluateCompleteness(quote24({ positions: 2, peoplePerPosition: 1, payrollHeadcount: 2, coverageHoursPerDay: 12 }));
    const item = short.items.find((x) => x.id === 'labor_hours');
    assert.ok(item);
    assert.equal(item.focus, 'labor.0.payrollHeadcount');
    // Relevos 24/7: con 4 en nómina para 2 posiciones hay relevo.
    assert.equal(c.items.find((x) => x.id === 'relief').status, 'ok');
    assert.equal(short.items.find((x) => x.id === 'relief').status, 'warning');
  });
});
