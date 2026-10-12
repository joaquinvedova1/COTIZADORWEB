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
 * Horas extra por tramos (PLAN-2026-010, opcional): `line.overtime` es una
 * lista de { label, premiumPct, hours, basis } (HE 50 %, HE 100 %, otro
 * recargo). Cada tramo cuesta horas × valor hora × (1 + recargo) × factor de
 * cargas:
 *   basis 'per_active_day'  horas por día activo → variable × posiciones
 *   basis 'per_month'       horas promedio por mes por persona → fijo del mes × dotación
 * Sin `overtime`, se usa el campo único de siempre (horas extra por día
 * activo + un recargo): mismo resultado que antes.
 * Si las horas extra se FACTURAN aparte (`overtimeBilled`), siguen siendo
 * costo y además generan ingreso: horas × precio por hora de cada tramo.
 *
 * Todos los porcentajes son parámetros. Los valores demo son ILUSTRATIVOS.
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';

/** Factor de cargas aplicado a conceptos remunerativos. */
export function laborLoadFactor({ sacPct = 0, vacationPct = 0, employerContributionsPct = 0, artPct = 0 } = {}) {
  return (1 + pct(nonNegative(sacPct)) + pct(nonNegative(vacationPct))) *
    (1 + pct(nonNegative(employerContributionsPct)) + pct(nonNegative(artPct)));
}

export const OVERTIME_BASES = Object.freeze(['per_active_day', 'per_month']);

/**
 * Tramos de horas extra de una línea: los de `overtime` o, si no hay lista,
 * el campo único de siempre (horas por día activo + un recargo).
 */
export function overtimeItemsOf(line = {}) {
  if (Array.isArray(line.overtime)) {
    return line.overtime
      .filter((o) => o && typeof o === 'object')
      .map((o, i) => ({
        id: o.id ?? `ot-${i}`,
        label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : `Horas extra ${nonNegative(o.premiumPct)} %`,
        premiumPct: nonNegative(o.premiumPct),
        hours: nonNegative(o.hours),
        basis: OVERTIME_BASES.includes(o.basis) ? o.basis : 'per_active_day',
        billRatePerHour: nonNegative(o.billRatePerHour),
        legacy: false,
      }));
  }
  const hours = nonNegative(line.overtimeHoursPerActiveDay);
  if (!(hours > 0)) return [];
  const premiumPct = nonNegative(line.overtimePremiumPct);
  return [{ id: 'ot-legacy', label: `Horas extra ${premiumPct} %`, premiumPct, hours, basis: 'per_active_day', billRatePerHour: nonNegative(line.overtimeBillRatePerHour), legacy: true }];
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
  // Tramos de horas extra (con el campo único de siempre si no hay lista).
  const billed = line.overtimeBilled === true;
  const overtimeItems = overtimeItemsOf(line).map((o) => {
    // Mismo orden de cálculo que el campo único de siempre (mismos números al centavo).
    const hourlyWithPremium = hourlyBase * (1 + pct(o.premiumPct));
    const hourlyCost = hourlyWithPremium * loadFactor;
    const cost = o.hours * hourlyWithPremium * loadFactor;
    return {
      ...o,
      hourlyCost,
      perActiveDayPerPosition: o.basis === 'per_active_day' ? cost : 0,
      monthlyPerPerson: o.basis === 'per_month' ? cost : 0,
      billedPerActiveDayPerPosition: billed && o.basis === 'per_active_day' ? o.hours * o.billRatePerHour : 0,
      billedMonthlyPerPerson: billed && o.basis === 'per_month' ? o.hours * o.billRatePerHour : 0,
    };
  });
  const overtimePerActiveDay = overtimeItems.reduce((acc, o) => acc + o.perActiveDayPerPosition, 0);
  const overtimeMonthlyPerPerson = overtimeItems.reduce((acc, o) => acc + o.monthlyPerPerson, 0);
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
      // Horas extra por mes (tramos "horas promedio por mes"): fijo del mes.
      overtimeMonthly: overtimeMonthlyPerPerson,
    },
    perPosition: {
      overtimePerActiveDay,
      mealPerActiveDay,
      variablePerActiveDay: variablePerActiveDayPerPosition,
    },
    overtimeItems,
    // Horas extra facturadas aparte al cliente (siguen siendo costo).
    overtimeBilling: billed
      ? {
        fixedMonthly: overtimeItems.reduce((acc, o) => acc + o.billedMonthlyPerPerson, 0) * headcount,
        perActiveDay: overtimeItems.reduce((acc, o) => acc + o.billedPerActiveDayPerPosition, 0) * positions,
      }
      : null,
    fixedMonthly: (fixedMonthlyPerPerson + overtimeMonthlyPerPerson) * headcount,
    variablePerActiveDay: variablePerActiveDayPerPosition * positions,
    hoursPerMonth: normalHours * headcount,
  };
}

/** Suma un conjunto de líneas de personal. */
export function computeLabor(lines = []) {
  const results = objectList(lines).map((l) => computeLaborLine(l));
  return {
    lines: results,
    headcount: results.reduce((s, r) => s + r.headcount, 0),
    positions: results.reduce((s, r) => s + r.positions, 0),
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
    hoursPerMonth: results.reduce((s, r) => s + r.hoursPerMonth, 0),
  };
}
