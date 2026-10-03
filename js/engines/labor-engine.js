/**
 * LaborEngine — costo de personal.
 *
 * Modelo (por persona, mensual):
 *   valorHora        = básico / horasNormalesMes
 *   valorHoraExtra   = valorHora × (1 + recargoHE%)
 *   remunerativo     = básico + adicionales
 *   factorCargas     = (1 + SAC% + vacaciones%) × (1 + cargasPatronales% + ART%)
 *   costoRemunerativo = remunerativo × factorCargas
 *   noRemunerativo   = seguros + EPP + capacitación + traslado
 *   fijoMensual      = costoRemunerativo + noRemunerativo
 *
 * Por día activo (por posición en servicio):
 *   horasExtraDía    = horasExtraPorDíaActivo × valorHoraExtra × factorCargas
 *   variableDía      = horasExtraDía + vianda
 *
 * Posiciones cubiertas:
 *   dotación = posiciones × personasPorPosición (relevos)
 *   fijo total = fijoMensual × dotación (todos cobran sueldo)
 *   variable total por día = variableDía × posiciones (en un día activo
 *   trabaja una persona por posición)
 *
 * Todos los porcentajes son parámetros. Los valores demo son ILUSTRATIVOS.
 */

import { nonNegative, pct, safeDivide } from '../core/money.js';

/** Factor de cargas aplicado a conceptos remunerativos. */
export function laborLoadFactor({ sacPct = 0, vacationPct = 0, employerContributionsPct = 0, artPct = 0 } = {}) {
  return (1 + pct(nonNegative(sacPct)) + pct(nonNegative(vacationPct))) *
    (1 + pct(nonNegative(employerContributionsPct)) + pct(nonNegative(artPct)));
}

/**
 * Calcula el costo de una línea de personal.
 * @param {object} line
 */
export function computeLaborLine(line = {}) {
  const positions = nonNegative(line.positions);
  const peoplePerPosition = nonNegative(line.peoplePerPosition, 1);
  const headcount = positions * peoplePerPosition;

  const basic = nonNegative(line.basicMonthly);
  const additionals = nonNegative(line.additionalsMonthly);
  const normalHours = nonNegative(line.normalHoursPerMonth);
  const otHoursPerDay = nonNegative(line.overtimeHoursPerActiveDay);
  const otPremium = pct(nonNegative(line.overtimePremiumPct));

  const sacPct = nonNegative(line.sacPct);
  const vacationPct = nonNegative(line.vacationPct);
  const employerContributionsPct = nonNegative(line.employerContributionsPct);
  const artPct = nonNegative(line.artPct);

  const loadFactor = laborLoadFactor({ sacPct, vacationPct, employerContributionsPct, artPct });
  const remunerative = basic + additionals;
  const sac = remunerative * pct(sacPct);
  const vacation = remunerative * pct(vacationPct);
  const contributionBase = remunerative + sac + vacation;
  const employerContributions = contributionBase * pct(employerContributionsPct);
  const art = contributionBase * pct(artPct);
  const loadedRemunerative = contributionBase + employerContributions + art; // = remunerative × loadFactor

  const insurance = nonNegative(line.insuranceMonthly);
  const ppe = nonNegative(line.ppeMonthly);
  const training = nonNegative(line.trainingMonthly);
  const transfer = nonNegative(line.transferMonthly);
  const nonRemunerative = insurance + ppe + training + transfer;

  const fixedMonthlyPerPerson = loadedRemunerative + nonRemunerative;

  const hourlyBase = safeDivide(basic, normalHours, 0);
  const overtimeHourly = hourlyBase * (1 + otPremium);
  const overtimePerActiveDay = otHoursPerDay * overtimeHourly * loadFactor;
  const mealPerActiveDay = nonNegative(line.mealPerActiveDay);
  const variablePerActiveDayPerPosition = overtimePerActiveDay + mealPerActiveDay;

  const loadedHourlyCost = safeDivide(fixedMonthlyPerPerson, normalHours, null);

  return {
    id: line.id ?? null,
    role: line.role ?? '',
    positions,
    peoplePerPosition,
    headcount,
    perPerson: {
      basic,
      additionals,
      remunerative,
      sac,
      vacation,
      employerContributions,
      art,
      loadedRemunerative,
      insurance,
      ppe,
      training,
      transfer,
      nonRemunerative,
      fixedMonthly: fixedMonthlyPerPerson,
      loadFactor,
      hourlyBase,
      overtimeHourly,
      loadedHourlyCost,
    },
    perPosition: {
      overtimePerActiveDay,
      mealPerActiveDay,
      variablePerActiveDay: variablePerActiveDayPerPosition,
    },
    fixedMonthly: fixedMonthlyPerPerson * headcount,
    variablePerActiveDay: variablePerActiveDayPerPosition * positions,
    hoursPerMonth: normalHours * headcount,
  };
}

/** Suma un conjunto de líneas de personal. */
export function computeLabor(lines = []) {
  const results = (Array.isArray(lines) ? lines : []).map(computeLaborLine);
  return {
    lines: results,
    headcount: results.reduce((s, r) => s + r.headcount, 0),
    positions: results.reduce((s, r) => s + r.positions, 0),
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
    hoursPerMonth: results.reduce((s, r) => s + r.hoursPerMonth, 0),
  };
}
