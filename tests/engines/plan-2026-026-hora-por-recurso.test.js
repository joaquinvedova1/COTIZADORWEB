/**
 * PLAN-2026-026 — valor de la hora POR RECURSO y horas extra como cantidad en la cotización.
 *
 * El perfil de Recursos puede traer su hora al 50 % y al 100 % (por convenio). La cotización
 * carga sólo cantidades (personas y horas por mes). Fuera de horario: se suma la hora de CADA
 * persona. Sin los campos nuevos, nada cambia.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLaborLine, computeLabor } from '../../js/engines/labor-engine.js';
import { outOfHoursBasis, outOfHoursCostPerHour, outOfHoursSurchargePerHour } from '../../js/engines/out-of-hours-engine.js';
import { laborLineFromProfile } from '../../js/domain/quote-factory.js';
import { snapshotValuesFromLine, economicFingerprint } from '../../js/domain/resource-snapshot.js';
import { lineSyncStatus } from '../../js/domain/resource-sync.js';

const base = { positions: 1, peoplePerPosition: 1, basicMonthly: 1760000, additionalsMonthly: 0, normalHoursPerMonth: 176, sacPct: 0, vacationPct: 0, employerContributionsPct: 50, artPct: 0 };
// hora de sueldo 10.000 · factor de cargas 1,5 → hora al 50 % = 22.500 · al 100 % = 30.000

describe('PLAN-2026-026 — hora al 50 % y al 100 % por recurso', () => {
  test('sin valor propio se calcula del sueldo (como siempre)', () => {
    const l = computeLaborLine(base);
    assert.equal(l.perPerson.overtimeHourlyCost50, 22500);
    assert.equal(l.perPerson.overtimeHourlyCost100, 30000);
    assert.equal(l.perPerson.overtimeRate50Own, false);
    assert.equal(l.perPerson.overtimeRate100Own, false);
  });

  test('con valor propio del recurso (convenio) se usa ése; 0 o vacío = calculado', () => {
    const l = computeLaborLine({ ...base, overtimeRate50: 25000, overtimeRate100: 0 });
    assert.equal(l.perPerson.overtimeHourlyCost50, 25000);
    assert.equal(l.perPerson.overtimeRate50Own, true);
    assert.equal(l.perPerson.overtimeHourlyCost100, 30000);
    assert.equal(l.perPerson.overtimeRate100Own, false);
    assert.equal(computeLaborLine({ ...base, overtimeRate50: '', overtimeRate100: null }).perPerson.overtimeHourlyCost50, 22500);
  });

  test('el valor propio no cambia el costo del mes si no hay horas cargadas', () => {
    assert.equal(computeLaborLine({ ...base, overtimeRate50: 99999, overtimeRate100: 99999 }).fixedMonthly, computeLaborLine(base).fixedMonthly);
  });
});

describe('PLAN-2026-026 — horas extra por mes: la cotización carga sólo la cantidad', () => {
  test('costo del mes += horas × hora de la persona, por cada persona', () => {
    const plain = computeLaborLine({ ...base, positions: 3 });
    const l = computeLaborLine({ ...base, positions: 3, overtime50HoursPerMonth: 10, overtime100HoursPerMonth: 4 });
    // por persona: 10 × 22.500 + 4 × 30.000 = 345.000 · × 3 personas
    assert.equal(l.perPerson.overtimeMonthly, 345000);
    assert.equal(l.fixedMonthly - plain.fixedMonthly, 345000 * 3);
    assert.equal(l.variablePerActiveDay, plain.variablePerActiveDay);
    assert.deepEqual(l.overtimeItems.map((o) => [o.premiumPct, o.hours, o.basis, o.monthlyPerPerson]), [[50, 10, 'per_month', 225000], [100, 4, 'per_month', 120000]]);
  });

  test('usa el valor propio del recurso', () => {
    const l = computeLaborLine({ ...base, overtimeRate50: 25000, overtime50HoursPerMonth: 10 });
    assert.equal(l.perPerson.overtimeMonthly, 250000);
  });

  test('dos puestos con distinto sueldo: cada uno con su hora (no una tarifa pareja)', () => {
    const cheap = { ...base, basicMonthly: 880000, positions: 4, overtime50HoursPerMonth: 10 };
    const dear = { ...base, positions: 1, overtime50HoursPerMonth: 10 };
    const labor = computeLabor([cheap, dear]);
    const plain = computeLabor([{ ...cheap, overtime50HoursPerMonth: 0 }, { ...dear, overtime50HoursPerMonth: null }]);
    // 4 × 10 h × 11.250 + 1 × 10 h × 22.500
    assert.equal(labor.fixedMonthly - plain.fixedMonthly, 4 * 10 * 11250 + 10 * 22500);
  });

  test('persona compartida: las horas extra siguen el uso real (no se reducen con el %)', () => {
    const l = computeLaborLine({ ...base, assignment: 'shared', fixedCostSharePct: 50, overtime50HoursPerMonth: 10 });
    const plain = computeLaborLine({ ...base, assignment: 'shared', fixedCostSharePct: 50 });
    assert.equal(l.fixedMonthly - plain.fixedMonthly, 225000);
  });

  test('sin los campos nuevos, vacíos, en 0 o negativos: mismo resultado que antes', () => {
    const before = computeLaborLine({ ...base, overtimeHoursPerActiveDay: 2, overtimePremiumPct: 50 });
    [{}, { overtime50HoursPerMonth: null, overtime100HoursPerMonth: '' }, { overtime50HoursPerMonth: 0, overtime100HoursPerMonth: -5 }].forEach((extra) => {
      const after = computeLaborLine({ ...base, overtimeHoursPerActiveDay: 2, overtimePremiumPct: 50, ...extra });
      assert.equal(after.fixedMonthly, before.fixedMonthly);
      assert.equal(after.variablePerActiveDay, before.variablePerActiveDay);
      assert.equal(after.overtimeItems.length, before.overtimeItems.length);
    });
  });
});

describe('PLAN-2026-026 — fuera de horario: suma la hora de cada persona', () => {
  test('sin valores propios: mismo cálculo de siempre, con el detalle por puesto', () => {
    const labor = computeLabor([{ ...base, role: 'Técnico', positions: 1 }, { ...base, role: 'Operario', basicMonthly: 880000, positions: 4 }]);
    const b = outOfHoursBasis(labor, []);
    assert.equal(b.crewPerHourByPremium, null);
    // base: 1 × 15.000 + 4 × 7.500 = 45.000
    assert.equal(b.crewBasePerHour, 45000);
    assert.equal(outOfHoursCostPerHour(b, 50), 67500);
    assert.equal(outOfHoursSurchargePerHour(b, 50), 22500);
    assert.deepEqual(b.perRole.map((x) => [x.role, x.people, x.perHour50, x.perHour100]), [['Técnico', 1, 22500, 30000], ['Operario', 4, 11250, 15000]]);
  });

  test('con un valor propio: la hora de la cuadrilla es la suma de la de cada uno', () => {
    const labor = computeLabor([{ ...base, role: 'Técnico', positions: 1, overtimeRate50: 25000 }, { ...base, role: 'Operario', basicMonthly: 880000, positions: 4 }]);
    const b = outOfHoursBasis(labor, []);
    // al 50 %: 25.000 + 4 × 11.250 = 70.000 · al 100 %: 30.000 + 4 × 15.000 = 90.000
    assert.deepEqual(b.crewPerHourByPremium, { 50: 70000, 100: 90000 });
    assert.equal(outOfHoursCostPerHour(b, 50), 70000);
    assert.equal(outOfHoursCostPerHour(b, 100), 90000);
    assert.equal(outOfHoursSurchargePerHour(b, 50), 70000 - 45000);
    assert.equal(outOfHoursSurchargePerHour(b, 100), 90000 - 45000);
    // otro recargo (no 50 ni 100): base × (1 + r), como siempre
    assert.equal(outOfHoursCostPerHour(b, 75), 45000 * 1.75);
  });

  test('un valor propio más bajo que la hora base no da recargo negativo', () => {
    const labor = computeLabor([{ ...base, overtimeRate50: 1000 }]);
    assert.equal(outOfHoursSurchargePerHour(outOfHoursBasis(labor, []), 50), 0);
  });
});

describe('PLAN-2026-026 — el recurso es el dueño de los datos', () => {
  const profile = { id: 'p1', role: 'Técnico HSE', ...base, overtimeRate50: 25000, overtimeRate100: 33000 };

  test('la línea copia el valor de la hora del recurso; las cantidades nacen vacías', () => {
    const line = laborLineFromProfile(profile, null, { id: 'l1', now: '2026-11-16T00:00:00.000Z' });
    assert.equal(line.overtimeRate50, 25000);
    assert.equal(line.overtimeRate100, 33000);
    assert.equal(line.overtime50HoursPerMonth, undefined);
    assert.equal(line.snapshot.values.overtimeRate50, 25000);
  });

  test('un recurso sin valor propio deja la huella igual que antes (sin avisos falsos en cotizaciones hechas)', () => {
    const old = { sourceId: 'p2', ...base, mealPerActiveDay: 0, overtimePremiumPct: 50, insuranceMonthly: 0, ppeMonthly: 0, trainingMonthly: 0, transferMonthly: 0 };
    const values = snapshotValuesFromLine('laborProfiles', old);
    assert.equal('overtimeRate50' in values, false);
    assert.equal('overtimeRate100' in values, false);
    assert.equal(economicFingerprint(values), economicFingerprint(snapshotValuesFromLine('laborProfiles', { ...old, overtimeRate50: null, overtimeRate100: 0 })));
  });

  test('cambiar el valor de la hora en Recursos avisa en la cotización (no la cambia sola)', () => {
    const line = laborLineFromProfile(profile, null, { id: 'l1', now: '2026-11-16T00:00:00.000Z' });
    assert.equal(lineSyncStatus('labor', line, { laborProfiles: [profile], agreements: [] }).state, 'current');
    const changed = lineSyncStatus('labor', line, { laborProfiles: [{ ...profile, overtimeRate50: 27000 }], agreements: [] });
    assert.equal(changed.state, 'changed');
    assert.deepEqual(changed.changes, ['overtimeRate50']);
  });
});
