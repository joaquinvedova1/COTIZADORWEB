/**
 * Versión 0.12.0 (2026-11-18): personal por convenio.
 * - Sueldo como en el recibo: remunerativo, no remunerativo y aportes del trabajador.
 * - Los aportes sólo dan el neto: no cambian el costo de la empresa.
 * - El no remunerativo y las contribuciones fijas del convenio no llevan cargas.
 * - El puesto sigue a su convenio; "Aplicar aumento" con historial y deshacer.
 * - agreementRaiseFactor para la actualización de tarifas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeLaborLine } from '../../js/engines/labor-engine.js';
import { laborLineFromProfile } from '../../js/domain/quote-factory.js';
import { snapshotValuesFromLine, createSnapshot } from '../../js/domain/resource-snapshot.js';
import { lineSyncStatus } from '../../js/domain/resource-sync.js';
import { AGREEMENT_TYPES, AGREEMENT_TYPES_SORTED } from '../../js/domain/catalogs.js';
import { demoAgreements } from '../../js/domain/demo-data.js';
import {
  agreementRaiseFactor,
  applyAgreementRaise,
  ownParamKeys,
  profileFollowsAgreement,
  profilesToPropagate,
  undoLastAgreementRaise,
  withAgreementParams,
} from '../../js/domain/agreement-raises.js';

const close = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const agreement = {
  id: 'pet',
  name: 'Petroleros Privados',
  params: { normalHoursPerMonth: 200, overtimePremiumPct: 50, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 2, workerContributionsPct: 17, fixedContributionsMonthly: 100000 },
};
const profile = (extra = {}) => ({
  id: 'p1',
  role: 'Operario',
  agreementId: 'pet',
  basicMonthly: 1000000,
  nonRemunerativeMonthly: 500000,
  ...withAgreementParams({}, agreement),
  base: { period: '2026-07', currency: 'ARS' },
  ...extra,
});
const one = (p) => computeLaborLine({ ...p, positions: 1, peoplePerPosition: 1 });

describe('Sueldo como en el recibo (0.12.0)', () => {
  test('el no remunerativo y las contribuciones fijas suman al costo sin cargas', () => {
    const p = one(profile()).perPerson;
    const loaded = 1000000 * (1 + 0.0833 + 0.04) * (1 + 0.24 + 0.02);
    close(p.loadedRemunerative, loaded);
    close(p.fixedMonthly, loaded + 500000 + 100000);
  });

  test('los aportes del trabajador dan el neto y no cambian el costo', () => {
    const withAportes = one(profile()).perPerson;
    const without = one(profile({ workerContributionsPct: 0 })).perPerson;
    close(withAportes.fixedMonthly, without.fixedMonthly);
    close(withAportes.grossMonthly, 1500000);
    close(withAportes.workerContributions, 170000);
    close(withAportes.netMonthly, 1330000);
  });

  test('costo empleador del mes (para comparar con el recibo): sin aguinaldo ni vacaciones', () => {
    const p = one(profile()).perPerson;
    close(p.payslipEmployerCost, 1000000 * 1.26 + 500000 + 100000);
  });

  test('un puesto anterior a 0.12.0 (sin campos nuevos) cuesta lo mismo que antes', () => {
    const old = { basicMonthly: 900000, additionalsMonthly: 100000, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6, normalHoursPerMonth: 176, positions: 1, peoplePerPosition: 1 };
    const p = computeLaborLine(old).perPerson;
    close(p.fixedMonthly, 1000000 * (1 + 0.0833 + 0.04) * (1 + 0.24 + 0.06));
  });

  test('la línea de la cotización copia no remunerativo, contribuciones fijas y aportes; la huella de un puesto viejo no cambia', () => {
    const line = laborLineFromProfile(profile(), agreement, { id: 'l1', now: '2026-11-18T00:00:00Z' });
    assert.equal(line.nonRemunerativeMonthly, 500000);
    assert.equal(line.fixedContributionsMonthly, 100000);
    assert.equal(line.workerContributionsPct, 17);
    const oldLine = laborLineFromProfile({ id: 'x', basicMonthly: 1, sacPct: 8.33 }, null, { id: 'l2', now: '2026-11-18T00:00:00Z' });
    const values = snapshotValuesFromLine('laborProfiles', oldLine);
    assert.ok(!('nonRemunerativeMonthly' in values));
    assert.ok(!('fixedContributionsMonthly' in values));
  });
});

describe('Revisión de costos', () => {
  test('una línea guardada antes de 0.12.0 con su puesto sin cambios no avisa "valores nuevos"', () => {
    const agr = { id: 'a1', params: { normalHoursPerMonth: 176, overtimePremiumPct: 50, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6 } };
    const prof = { id: 'pp', role: 'Chofer', agreementId: 'a1', basicMonthly: 1000000, additionalsMonthly: 0, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6, normalHoursPerMonth: 176, base: { period: '2026-07', currency: 'ARS' } };
    const line = laborLineFromProfile(prof, agr, { id: 'l', now: '2026-10-01T00:00:00Z' });
    // Como se guardaba antes: sin los campos nuevos ni en la línea ni en la foto.
    delete line.nonRemunerativeMonthly; delete line.fixedContributionsMonthly; delete line.workerContributionsPct; delete line.nonRemunerativeChargesPct;
    line.snapshot = createSnapshot('laborProfiles', prof, line, { now: '2026-10-01T00:00:00Z' });
    const status = lineSyncStatus('labor', line, { laborProfiles: [prof], agreements: [agr] }, { currency: 'ARS' });
    assert.deepEqual(status.changes, []);
    assert.notEqual(status.state, 'changed');
  });

  test('cargas sobre el no remunerativo (opcional)', () => {
    const base = one(profile()).perPerson.fixedMonthly;
    close(one(profile({ nonRemunerativeChargesPct: 6 })).perPerson.fixedMonthly, base + 500000 * 0.06);
  });
});

describe('El puesto sigue a su convenio', () => {
  test('sigue mientras sus valores son los del convenio; uno propio lo separa', () => {
    assert.equal(profileFollowsAgreement(profile(), agreement), true);
    assert.deepEqual(ownParamKeys(profile({ artPct: 5 }), agreement), ['artPct']);
    assert.equal(profileFollowsAgreement(profile({ artPct: 5 }), agreement), false);
  });

  test('al cambiar el convenio se actualiza cada valor que seguía, clave por clave', () => {
    const after = { ...agreement, params: { ...agreement.params, employerContributionsPct: 26 } };
    const updated = profilesToPropagate(agreement, after, [profile(), profile({ id: 'p2', artPct: 5 }), profile({ id: 'p3', agreementId: 'otro' }), profile({ id: 'p4', employerContributionsPct: 30 })]);
    assert.deepEqual(updated.map((p) => p.id), ['p1', 'p2']);
    assert.equal(updated[0].employerContributionsPct, 26);
    assert.equal(updated[1].employerContributionsPct, 26);
    assert.equal(updated[1].artPct, 5);
  });

  test('sin cambios en los parámetros no se toca ningún puesto', () => {
    assert.deepEqual(profilesToPropagate(agreement, { ...agreement, name: 'Otro nombre' }, [profile()]), []);
  });
});

describe('Aplicar aumento por convenio', () => {
  test('sube remunerativo y no remunerativo, actualiza el mes del sueldo y queda en el historial', () => {
    const r = applyAgreementRaise(agreement, [profile(), profile({ id: 'p9', agreementId: 'otro' })], { fromPeriod: '2026-08', remunerativePct: 10, nonRemunerativePct: 5, note: 'Acta' }, { id: 'r1', now: 'x' });
    assert.equal(r.profiles.length, 1);
    assert.equal(r.profiles[0].basicMonthly, 1100000);
    assert.equal(r.profiles[0].nonRemunerativeMonthly, 525000);
    assert.equal(r.profiles[0].base.period, '2026-08');
    assert.equal(r.agreement.raises.length, 1);
    assert.equal(r.agreement.raises[0].changes[0].before.basicMonthly, 1000000);
  });

  test('sin % de no remunerativo usa el mismo %', () => {
    const r = applyAgreementRaise(agreement, [profile()], { fromPeriod: '2026-08', remunerativePct: 10 });
    assert.equal(r.profiles[0].nonRemunerativeMonthly, 550000);
  });

  test('datos inválidos: no aplica', () => {
    assert.equal(applyAgreementRaise(agreement, [profile()], { fromPeriod: 'agosto', remunerativePct: 10 }), null);
    assert.equal(applyAgreementRaise(agreement, [profile()], { fromPeriod: '2026-08', remunerativePct: null }), null);
    assert.equal(applyAgreementRaise(agreement, [profile()], { fromPeriod: '2026-08', remunerativePct: -100 }), null);
  });

  test('deshacer el último aumento vuelve a los valores anteriores; un puesto editado después no se toca', () => {
    const r = applyAgreementRaise(agreement, [profile(), profile({ id: 'p2' })], { fromPeriod: '2026-08', remunerativePct: 10 });
    const edited = { ...r.profiles[1], basicMonthly: 2000000 };
    const u = undoLastAgreementRaise(r.agreement, [r.profiles[0], edited]);
    assert.equal(u.agreement.raises.length, 0);
    assert.deepEqual(u.skipped, ['p2']);
    assert.equal(u.profiles[0].basicMonthly, 1000000);
    assert.equal(u.profiles[0].base.period, '2026-07');
  });
});

describe('agreementRaiseFactor (para actualizar tarifas)', () => {
  const withRaises = { ...agreement, raises: [
    { fromPeriod: '2026-08', remunerativePct: 10, nonRemunerativePct: 5 },
    { fromPeriod: '2026-10', remunerativePct: 5, nonRemunerativePct: 5 },
  ] };
  test('acumula los aumentos con "desde" en (base, destino]', () => {
    close(agreementRaiseFactor(withRaises, '2026-07', '2026-11'), 1.1 * 1.05, 1e-9);
    close(agreementRaiseFactor(withRaises, '2026-08', '2026-11'), 1.05, 1e-9);
    close(agreementRaiseFactor(withRaises, '2026-07', '2026-09'), 1.1, 1e-9);
    close(agreementRaiseFactor(withRaises, '2026-10', '2026-12'), 1, 1e-9);
    close(agreementRaiseFactor(withRaises, '2026-07', '2026-11', { part: 'nonRemunerative' }), 1.05 * 1.05, 1e-9);
  });
  test('sin historial o con meses inválidos: null', () => {
    assert.equal(agreementRaiseFactor(agreement, '2026-07', '2026-11'), null);
    assert.equal(agreementRaiseFactor(withRaises, '2026-7', '2026-11'), null);
  });
});

describe('Lista de convenios', () => {
  test('incluye los de servicios petroleros, construcción y transporte; la demo no cambia', () => {
    const codes = AGREEMENT_TYPES.map((a) => a.code);
    ['petroleros_privados', 'petroleros_privados_sur', 'petroleros_jerarquicos', 'uocra', 'uocra_yacimientos', 'camioneros', 'uom', 'comercio', 'gastronomicos', 'seguridad', 'fuera_convenio', 'personalizado'].forEach((c) => assert.ok(codes.includes(c), c));
    assert.equal(demoAgreements().length, 9);
    assert.equal(AGREEMENT_TYPES_SORTED[0].code, 'petroleros_privados');
  });
});
