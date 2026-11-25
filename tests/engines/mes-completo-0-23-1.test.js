/**
 * 0.23.1 (2026-11-24, auditoría de la 0.23.0): "Sólo tiene este trabajo: cobrar su mes completo acá"
 * guarda la DECISIÓN por recurso (`fullMonth`), no un número de horas.
 *  - El botón de la 0.23.0 escribía billableHoursPerMonth = horas de la cotización. Al cambiar los
 *    días después, la cotización cobraba 2 sueldos (2 → 4 días) o medio (2 → 1) y el equilibrio daba 0.
 *  - Con `fullMonth` el recurso se costea como dedicado: su mes entero, costo fijo, con cualquier
 *    cantidad de días. Sin el dato, ninguna cotización cambia.
 * Caso del dueño: técnico de $ 3.200.000 por mes y 160 h; el cliente contrata 16 h por mes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote, quoteCapacityRows } from '../../js/engines/quote-engine.js';
import { capacityRows } from '../../js/engines/completeness-engine.js';
import { resourceUsage } from '../../js/domain/resource-usage.js';
import { applyResourceUpdate } from '../../js/domain/resource-sync.js';
import { service, person, owned, external } from '../lab/lib/build.js';

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const tech = (o = {}) => person({ id: 'l1', role: 'Técnico', basicMonthly: 3200000, normalHoursPerMonth: 160, sacPct: 0, vacationPct: 0, employerContributionsPct: 0, artPct: 0, sourceId: 'p-1', ...o });
const crane = (o = {}) => ({ ...owned({ id: 'e1', name: 'Hidrogrúa', replacementValue: 96000000, usefulLifeYears: 8, insuranceAnnual: 2400000, maintenancePerHour: 5000, billableHoursPerMonth: 176 }), sourceId: 'e-1', ...o });
const quote = (days, { labor = [tech()], equipment = [], unit = 'day', ...rest } = {}) => ({ ...service({ unit, activity: { activeDaysPerMonth: days, hoursPerActiveDay: 8 }, labor, equipment, ...rest }), costBasis: 'time' });
const laborCost = (r) => r.model.labor.fixedMonthly + r.model.labor.variablePerActiveDay * r.activity.activeDaysPerMonth;
const notices = (q) => computeQuote(q).completeness.notices;
const ids = (q) => notices(q).map((n) => n.id);

test('A: sin marcar, el técnico cuesta sus 16 h ($ 320.000) y el aviso dice $ 2.880.000 sin cobrar', () => {
  const r = computeQuote(quote(2));
  near(laborCost(r), 320000);
  const n = r.completeness.notices.find((x) => x.id === 'idle_capacity');
  near(n.amount, 2880000);
  assert.match(n.message, /16 de 160 h/);
  assert.equal(n.focus, 'labor.0.fullMonth');
});

test('A: con "sólo tiene este trabajo" cobra su mes completo como costo FIJO, con 1, 2 o 4 días', () => {
  [1, 2, 4, 10].forEach((days) => {
    const r = computeQuote(quote(days, { labor: [tech({ fullMonth: true })] }));
    near(laborCost(r), 3200000);
    near(r.model.labor.fixedMonthly, 3200000);
    near(r.model.labor.variablePerActiveDay, 0);
    assert.ok(!r.completeness.notices.some((x) => x.id === 'idle_capacity' || x.id === 'over_capacity'), `sin avisos de capacidad con ${days} días`);
  });
});

test('A: regresión del botón de la 0.23.0: las horas congeladas cobran 2 sueldos al pasar de 2 a 4 días; la decisión, uno', () => {
  const frozen = computeQuote(quote(4, { labor: [tech({ billableHoursPerMonth: 16 })] }));
  near(laborCost(frozen), 6400000);
  near(laborCost(computeQuote(quote(4, { labor: [tech({ fullMonth: true })] }))), 3200000);
});

test('A: el equilibrio vuelve a existir (antes daba 0 días con el sueldo como costo por día)', () => {
  const a = computeQuote(quote(2));
  const b = computeQuote(quote(2, { labor: [tech({ fullMonth: true })] }));
  assert.ok(!(a.model.fixedMonthly > 0));
  assert.ok(b.model.fixedMonthly >= 3200000);
  assert.ok(b.breakEven.days > 0);
});

test('deshacer: quitar la marca devuelve exactamente los números de antes', () => {
  const before = computeQuote(quote(2));
  const undone = computeQuote(quote(2, { labor: [tech({ fullMonth: false })] }));
  assert.deepEqual(undone.kpis, before.kpis);
});

test('la marca no cambia nada cobrando por mes ni con el método anterior', () => {
  const month = (o) => ({ ...service({ unit: 'month', activity: { activeDaysPerMonth: 2, hoursPerActiveDay: 8 }, labor: [tech(o)], equipment: [] }), costBasis: 'time' });
  assert.deepEqual(computeQuote(month({ fullMonth: true })).kpis, computeQuote(month({})).kpis);
  const legacy = (o) => service({ unit: 'day', activity: { activeDaysPerMonth: 2, hoursPerActiveDay: 8 }, labor: [tech(o)], equipment: [] });
  assert.deepEqual(computeQuote(legacy({ fullMonth: true })).kpis, computeQuote(legacy({})).kpis);
});

test('C: hidrogrúa con mes completo: tenerla es fija y el uso (mantenimiento por hora) sigue a las horas, sin inflarse', () => {
  const plain = computeQuote(quote(2, { labor: [], equipment: [crane()] }));
  const full = computeQuote(quote(2, { labor: [], equipment: [crane({ fullMonth: true })] }));
  const e0 = plain.model.equipment[0];
  const e1 = full.model.equipment[0];
  near(e1.fixedMonthly, e0.ownership.totalMonthly);
  near(e1.variablePerActiveDay, e0.variablePerActiveDay);
  near(e1.variablePerActiveDay, 5000 * 8);
  assert.equal(e1.fullMonth, true);
  // 2, 10 y 20 días: tenerla cuesta lo mismo por mes.
  [10, 20].forEach((d) => near(computeQuote(quote(d, { labor: [], equipment: [crane({ fullMonth: true })] })).model.equipment[0].fixedMonthly, e0.ownership.totalMonthly));
});

test('la decisión es por recurso: el técnico con mes completo y la grúa por horas', () => {
  const r = computeQuote(quote(2, { labor: [tech({ fullMonth: true })], equipment: [crane()] }));
  near(r.model.labor.fixedMonthly, 3200000);
  assert.equal(r.model.equipment[0].timeBasis, true);
  const n = r.completeness.notices.find((x) => x.id === 'idle_capacity');
  assert.deepEqual(n.targets.map((t) => t.name), ['Hidrogrúa']);
});

test('un recurso pasado de horas ya no tapa el aviso de horas sin cobrar de otro', () => {
  const q = quote(26, { labor: [tech()], equipment: [crane({ assignedHoursPerDay: 1 })] });
  const got = ids(q);
  assert.ok(got.includes('over_capacity'));
  assert.ok(got.includes('idle_capacity'));
});

test('relevos: 1 puesto con 2 personas tiene el mes de las dos (sin exceso falso) y lo no cobrado cuenta las dos nóminas', () => {
  const two = tech({ peoplePerPosition: 2 });
  const r = computeQuote(quote(25, { labor: [two] })); // 200 h de un puesto cubierto por 2 personas (320 h)
  assert.ok(!r.completeness.notices.some((x) => x.id === 'over_capacity'));
  const row = capacityRows(quote(2, { labor: [two] }), computeQuote(quote(2, { labor: [two] })).model, 2)[0];
  near(row.fullAmount, 6400000);
  near(row.idleAmount, 6400000 - 320000);
  near(laborCost(computeQuote(quote(2, { labor: [tech({ peoplePerPosition: 2, fullMonth: true })] }))), 6400000);
});

test('bordes de utilización: 0 %, < 50 %, 50 %, 99 %, 100 % y más', () => {
  const at = (hoursMonth) => ids(quote(hoursMonth / 8));
  assert.deepEqual(at(0).filter((x) => /capacity/.test(x)), []);
  assert.ok(at(16).includes('idle_capacity'));
  assert.ok(at(79.2).includes('idle_capacity'));
  assert.ok(!at(80).includes('idle_capacity'));
  assert.deepEqual(at(158.4).filter((x) => /capacity/.test(x)), []);
  assert.deepEqual(at(160).filter((x) => /capacity/.test(x)), []);
  assert.ok(at(240).includes('over_capacity'));
});

test('alquilado o tercerizado: nunca avisa ni admite mes completo', () => {
  const ext = { ...external({ id: 'x1', name: 'Grúa alquilada' }, { price: 500000, unit: 'day' }), fullMonth: true };
  const q = quote(2, { labor: [], equipment: [ext] });
  assert.deepEqual(ids(q).filter((x) => /capacity/.test(x)), []);
  assert.deepEqual(computeQuote(q).kpis, computeQuote(quote(2, { labor: [], equipment: [{ ...ext, fullMonth: false }] })).kpis);
});

test('datos incompletos: sin NaN ni avisos de capacidad', () => {
  [tech({ basicMonthly: 0, fullMonth: true }), tech({ normalHoursPerMonth: 0, fullMonth: true }), tech({ positions: 0, fullMonth: true }), tech({ basicMonthly: '', normalHoursPerMonth: '' })].forEach((l) => {
    const r = computeQuote(quote(2, { labor: [l] }));
    assert.ok(Number.isFinite(r.kpis.totalCost));
    assert.ok(!JSON.stringify(r.kpis).includes('null,null'));
  });
  assert.deepEqual(ids(quote(0, { labor: [tech({ fullMonth: true })] })).filter((x) => /capacity/.test(x)), []);
});

test('"Usado en": el mes completo cuenta 100 % y más de uno se informa (doble cobro del mismo sueldo)', () => {
  const q = (id, o, status = 'draft') => ({ ...quote(2, { labor: [tech(o)] }), id, status });
  const u = resourceUsage('laborProfiles', 'p-1', [q('a', { fullMonth: true }), q('b', { fullMonth: true }), q('c', {})]);
  assert.equal(u.fullMonthCount, 2);
  near(u.rows[0].assignedPct, 100);
  assert.equal(u.rows[0].fullMonth, true);
  near(u.rows[2].assignedPct, 10);
  assert.equal(resourceUsage('laborProfiles', 'p-1', [q('a', {})]).fullMonthCount, 0);
});

test('"Usado en" con las horas del motor: mismo % que cobra la cotización (antes 2 h donde el costo cobraba 16 h)', () => {
  // Grúa con el motor andando 1 h por día y sin horas asignadas: tenerla se cobra el día entero.
  const q = { ...quote(2, { labor: [], equipment: [crane({ hoursPerActiveDay: 1 })] }), id: 'a', status: 'won' };
  const engine = (qq, line, kind, index) => {
    const row = quoteCapacityRows(qq).find((r) => r.list === kind && r.index === index);
    return row ? { hoursPerMonth: row.used, monthHours: row.month, sharePct: row.pct } : null;
  };
  const u = resourceUsage('equipment', 'e-1', [q], { timeShare: engine });
  near(u.rows[0].hoursPerMonth, 16);
  near(u.rows[0].assignedPct, (16 / 176) * 100, 0.01);
});

test('"Actualizar en esta cotización" desde Recursos conserva la decisión de mes completo', () => {
  const resources = { laborProfiles: [{ id: 'p-1', role: 'Técnico', basicMonthly: 3500000, normalHoursPerMonth: 160 }] };
  const next = applyResourceUpdate('labor', tech({ fullMonth: true }), resources, { now: '2026-11-24T00:00:00.000Z' });
  assert.equal(next.fullMonth, true);
});
