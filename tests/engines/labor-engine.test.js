/**
 * Contrato del negocio — LaborEngine (personal y convenios).
 *
 * Reglas (Prompt 1 "Personal y convenios", "Servicio permanente"; Prompt 3 "Personal"):
 *   factor de cargas = (1 + SAC% + vacaciones%) × (1 + cargas patronales% + ART%)
 *   fijo mensual por PERSONA = (básico + adicionales) × factor + seguros + EPP + capacitación + traslado
 *   variable por día activo por POSICIÓN = horas extra × valor hora extra × factor + vianda
 *   Pensar en POSICIONES CUBIERTAS: dotación = posiciones × personas por posición (relevos).
 *   Todos cobran sueldo (fijo × dotación), pero en un día activo trabaja una persona
 *   por posición (variable × posiciones).
 *   Los porcentajes son parámetros (no se inventa normativa; valores ILUSTRATIVOS).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { laborLoadFactor, computeLaborLine, computeLabor } from '../../js/engines/labor-engine.js';

const EPS = 1e-6;

function approx(actual, expected, message = '', tolerance = EPS) {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${message} se esperaba un número finito y se obtuvo ${actual}`);
  assert.ok(Math.abs(actual - expected) < tolerance, `${message} esperado ${expected}, obtenido ${actual}`);
}

/** Parámetros ILUSTRATIVOS (no son normativa real). */
const PARAMS = { sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6 };
// (1 + 0,0833 + 0,04) × (1 + 0,24 + 0,06) = 1,1233 × 1,30 = 1,46029
const LOAD_FACTOR = 1.1233 * 1.3;

function operatorLine(overrides = {}) {
  return {
    id: 'op',
    role: 'Operador',
    positions: 1,
    peoplePerPosition: 1,
    basicMonthly: 1_800_000,
    additionalsMonthly: 400_000,
    normalHoursPerMonth: 176,
    overtimeHoursPerActiveDay: 4,
    overtimePremiumPct: 50,
    mealPerActiveDay: 25_000,
    insuranceMonthly: 30_000,
    ppeMonthly: 40_000,
    trainingMonthly: 25_000,
    transferMonthly: 60_000,
    ...PARAMS,
    ...overrides,
  };
}

// Valores esperados calculados a mano para operatorLine():
//   remunerativo = 1.800.000 + 400.000 = 2.200.000
//   remunerativo con cargas = 2.200.000 × 1,46029 = 3.212.638
//   no remunerativo = 30.000 + 40.000 + 25.000 + 60.000 = 155.000
//   fijo por persona = 3.367.638
//   valor hora = 1.800.000 / 176 = 10.227,27…; hora extra (+50 %) = 15.340,909…
//   horas extra por día con cargas = 4 × 15.340,909… × 1,46029 = 89.608,7…
//   variable por día por posición = 89.608,7… + 25.000 (vianda)
const FIXED_PER_PERSON = 2_200_000 * LOAD_FACTOR + 155_000;
const OVERTIME_PER_DAY = 4 * (1_800_000 / 176) * 1.5 * LOAD_FACTOR;
const VARIABLE_PER_POSITION = OVERTIME_PER_DAY + 25_000;

describe('LaborEngine — factor de cargas', () => {
  test('factor de cargas = (1 + SAC + vacaciones) × (1 + cargas patronales + ART) = 1,46029', () => {
    approx(laborLoadFactor(PARAMS), 1.46029);
  });

  test('el factor es multiplicativo, no la suma de porcentajes (1,46029 ≠ 1,4233)', () => {
    const additive = 1 + 0.0833 + 0.04 + 0.24 + 0.06;
    assert.ok(Math.abs(laborLoadFactor(PARAMS) - additive) > 0.03);
  });

  test('sin parámetros el factor es 1 (no inventa cargas)', () => {
    approx(laborLoadFactor({}), 1);
    approx(laborLoadFactor(), 1);
  });

  test('porcentajes negativos o vacíos se sanean a 0', () => {
    approx(laborLoadFactor({ sacPct: -10, vacationPct: '', employerContributionsPct: null, artPct: undefined }), 1);
  });
});

describe('LaborEngine — costo de una posición', () => {
  test('fijo mensual por persona = remunerativo × factor de cargas + no remunerativos', () => {
    const r = computeLaborLine(operatorLine());
    approx(r.perPerson.remunerative, 2_200_000);
    approx(r.perPerson.loadedRemunerative, 2_200_000 * LOAD_FACTOR);
    approx(r.perPerson.nonRemunerative, 155_000);
    approx(r.perPerson.fixedMonthly, FIXED_PER_PERSON);
    approx(r.fixedMonthly, FIXED_PER_PERSON);
  });

  test('SAC y vacaciones sobre el remunerativo; cargas y ART sobre remunerativo + SAC + vacaciones', () => {
    const r = computeLaborLine(operatorLine());
    approx(r.perPerson.sac, 2_200_000 * 0.0833);
    approx(r.perPerson.vacation, 2_200_000 * 0.04);
    const base = 2_200_000 * 1.1233;
    approx(r.perPerson.employerContributions, base * 0.24);
    approx(r.perPerson.art, base * 0.06);
  });

  test('horas extra: valor hora = básico / horas normales; recargo 50 %; con cargas; más vianda por día activo', () => {
    const r = computeLaborLine(operatorLine());
    approx(r.perPerson.hourlyBase, 1_800_000 / 176);
    approx(r.perPerson.overtimeHourly, (1_800_000 / 176) * 1.5);
    approx(r.perPosition.overtimePerActiveDay, OVERTIME_PER_DAY);
    approx(r.perPosition.variablePerActiveDay, VARIABLE_PER_POSITION);
    approx(r.variablePerActiveDay, VARIABLE_PER_POSITION);
  });

  test('costo horario cargado = fijo por persona / horas normales del mes', () => {
    const r = computeLaborLine(operatorLine());
    approx(r.perPerson.loadedHourlyCost, FIXED_PER_PERSON / 176);
  });

  test('sin horas normales no hay valor hora (0) ni costo horario (null): nunca NaN ni Infinity', () => {
    const r = computeLaborLine(operatorLine({ normalHoursPerMonth: 0 }));
    assert.equal(r.perPerson.hourlyBase, 0);
    assert.equal(r.perPosition.overtimePerActiveDay, 0);
    assert.equal(r.perPerson.loadedHourlyCost, null);
    approx(r.variablePerActiveDay, 25_000, 'sólo queda la vianda');
  });
});

describe('LaborEngine — posiciones cubiertas y relevos', () => {
  test('1 posición con relevo (2 personas): el fijo se paga a 2 personas, el variable diario a 1 posición', () => {
    const r = computeLaborLine(operatorLine({ positions: 1, peoplePerPosition: 2 }));
    assert.equal(r.headcount, 2);
    approx(r.fixedMonthly, 2 * FIXED_PER_PERSON);
    approx(r.variablePerActiveDay, VARIABLE_PER_POSITION);
  });

  test('2 posiciones con 3 personas cada una (24/7): dotación 6; variable × 2 posiciones', () => {
    const r = computeLaborLine(operatorLine({ positions: 2, peoplePerPosition: 3 }));
    assert.equal(r.headcount, 6);
    approx(r.fixedMonthly, 6 * FIXED_PER_PERSON);
    approx(r.variablePerActiveDay, 2 * VARIABLE_PER_POSITION);
    approx(r.hoursPerMonth, 6 * 176);
  });

  test('si no se indican personas por posición se asume 1 (sin relevo)', () => {
    const line = operatorLine();
    delete line.peoplePerPosition;
    const r = computeLaborLine(line);
    assert.equal(r.peoplePerPosition, 1);
    assert.equal(r.headcount, 1);
  });

  test('0 posiciones → sin costo de personal', () => {
    const r = computeLaborLine(operatorLine({ positions: 0 }));
    assert.equal(r.fixedMonthly, 0);
    assert.equal(r.variablePerActiveDay, 0);
  });

  test('suma de varias líneas: dotación, posiciones, fijos y variables', () => {
    const lines = [operatorLine({ id: 'a', positions: 1, peoplePerPosition: 2 }), operatorLine({ id: 'b', positions: 2, peoplePerPosition: 1 })];
    const r = computeLabor(lines);
    assert.equal(r.headcount, 4);
    assert.equal(r.positions, 3);
    approx(r.fixedMonthly, 4 * FIXED_PER_PERSON);
    approx(r.variablePerActiveDay, 3 * VARIABLE_PER_POSITION);
    assert.equal(r.lines.length, 2);
  });

  test('sin líneas (o con un valor no-lista) el costo de personal es 0', () => {
    for (const empty of [[], null, undefined, 'x']) {
      const r = computeLabor(empty);
      assert.equal(r.fixedMonthly, 0);
      assert.equal(r.variablePerActiveDay, 0);
      assert.equal(r.headcount, 0);
    }
  });
});

describe('LaborEngine — valores inválidos', () => {
  test('montos negativos se sanean a 0: básico −100 → sólo quedan los no remunerativos', () => {
    const r = computeLaborLine(operatorLine({ basicMonthly: -100, additionalsMonthly: -1, overtimeHoursPerActiveDay: -4 }));
    approx(r.perPerson.remunerative, 0);
    approx(r.fixedMonthly, 155_000);
    approx(r.variablePerActiveDay, 25_000);
  });

  test('strings numéricos de formulario dan el mismo resultado que números', () => {
    const asStrings = Object.fromEntries(Object.entries(operatorLine()).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]));
    const a = computeLaborLine(asStrings);
    const b = computeLaborLine(operatorLine());
    approx(a.fixedMonthly, b.fixedMonthly);
    approx(a.variablePerActiveDay, b.variablePerActiveDay);
  });

  test('valores vacíos ("", null, undefined, NaN) nunca producen NaN', () => {
    for (const empty of ['', null, undefined, Number.NaN, 'abc']) {
      const line = Object.fromEntries(Object.entries(operatorLine()).map(([k, v]) => [k, typeof v === 'number' ? empty : v]));
      const r = computeLaborLine(line);
      for (const value of [r.fixedMonthly, r.variablePerActiveDay, r.headcount, r.perPerson.hourlyBase]) {
        assert.ok(Number.isFinite(value), `con ${String(empty)} se obtuvo ${value}`);
      }
    }
  });
});
