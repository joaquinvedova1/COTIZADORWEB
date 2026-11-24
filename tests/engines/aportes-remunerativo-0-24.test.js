/**
 * 0.24.0 (PLAN-2026-028, PR 5): "Aportes del trabajador (% del remunerativo)".
 *
 * El rótulo dice lo que el motor ya hace (labor-engine.js): los aportes del trabajador y las
 * cargas patronales (aguinaldo, vacaciones, contribuciones, ART y otras cargas) se calculan
 * SÓLO sobre el remunerativo. El no remunerativo suma al costo tal cual, más las cargas
 * propias del convenio sobre el no remunerativo si las tiene. Sin cambio de fórmula.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLaborLine } from '../../js/engines/labor-engine.js';

const close = (a, b, msg, eps = 0.005) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≠ ${b}`);

const line = (extra = {}) => ({
  basicMonthly: 1000000,
  additionalsMonthly: 0,
  normalHoursPerMonth: 200,
  sacPct: 8.33,
  vacationPct: 4,
  employerContributionsPct: 24,
  artPct: 2,
  otherChargesPct: 3,
  workerContributionsPct: 17,
  nonRemunerativeChargesPct: 0,
  positions: 1,
  peoplePerPosition: 1,
  ...extra,
});
const perPerson = (extra) => computeLaborLine(line(extra)).perPerson;

describe('Aportes y cargas sólo sobre el remunerativo (0.24.0)', () => {
  const sin = perPerson({ nonRemunerativeMonthly: 0 });
  const con = perPerson({ nonRemunerativeMonthly: 400000 });

  test('los aportes del trabajador son el % del remunerativo, con o sin no remunerativo', () => {
    close(sin.workerContributions, 170000, 'sin no remunerativo');
    close(con.workerContributions, 170000, 'con 400.000 de no remunerativo');
    close(con.grossMonthly, 1400000, 'bruto = remunerativo + no remunerativo');
    close(con.netMonthly, 1400000 - 170000, 'neto = bruto − aportes del remunerativo');
  });

  test('aguinaldo, vacaciones, contribuciones, ART y otras cargas no cambian con el no remunerativo', () => {
    for (const k of ['sac', 'vacation', 'employerContributions', 'art', 'loadedRemunerative']) {
      close(con[k], sin[k], k);
    }
    close(con.loadedRemunerative, 1000000 * (1 + 0.0833 + 0.04) * (1 + 0.24 + 0.02), 'remunerativo cargado');
  });

  test('el no remunerativo suma al costo tal cual (sin cargas del convenio sobre él)', () => {
    close(con.fixedMonthly - sin.fixedMonthly, 400000, 'diferencia de costo');
  });

  test('con cargas del convenio sobre el no remunerativo, sólo esas se suman', () => {
    const conCargas = perPerson({ nonRemunerativeMonthly: 400000, nonRemunerativeChargesPct: 10 });
    close(conCargas.fixedMonthly - sin.fixedMonthly, 440000, 'no remunerativo + 10 %');
    close(conCargas.workerContributions, 170000, 'los aportes no cambian');
  });

  test('los aportes no cambian el costo de la empresa', () => {
    close(perPerson({ nonRemunerativeMonthly: 400000, workerContributionsPct: 0 }).fixedMonthly, con.fixedMonthly, 'costo');
  });

  test('el rótulo lo dice en el puesto y en el convenio', () => {
    const src = readFileSync(new URL('../../js/ui/views/library.js', import.meta.url), 'utf8');
    assert.equal(src.match(/label: 'Aportes del trabajador \(% del remunerativo\)'/g).length, 2);
    assert.doesNotMatch(src, /label: 'Aportes del trabajador'/);
  });
});
