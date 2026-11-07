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
 * Persona compartida (PLAN-2026-012, opcional): si la línea se comparte con
 * otros servicios, esta cotización carga sólo el % EXPLÍCITO de su costo fijo
 * (sueldo, cargas y no remunerativos):
 *   fijo total = (fijoMensual × % asignado + horas extra por mes) × dotación
 * Las horas extra y las viandas siguen el uso real: no se reducen. Dedicada o
 * contratada para el servicio (o sin dato) = 100 %, como siempre.
 *
 * Nómina total (tanda B 2026-11, B-1, opcional): `line.payrollHeadcount` > 0 reemplaza
 * posiciones × personas por posición en la dotación (lo que cobra sueldo):
 *   dotación = nómina (si hay posiciones > 0; con 0 posiciones el puesto no trabaja)
 *   personas por posición = nómina ÷ posiciones (sólo informativo)
 * Así 3 en sitio con 5 en nómina (14x7) no obliga a cargar 1,6667. Las horas extra por día
 * activo y las viandas siguen a las posiciones (los que están en sitio). Sin el campo: igual
 * que siempre. Lo carga quien cotiza (o el asistente de diagrama con "Aplicar").
 * `line.rotation` (asistente de diagrama) NO cambia el costo: sólo propone
 * (rotation-engine.js); el resultado lo devuelve en `rotation` para la UI.
 *
 * Todos los porcentajes son parámetros. Los valores demo son ILUSTRATIVOS.
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { computeRotation, hasRotation } from './rotation-engine.js';

/** ¿La línea carga la nómina total (`payrollHeadcount` > 0) en vez de personas por posición? */
export function hasPayrollHeadcount(line = {}) {
  return Boolean(line) && nonNegative(line.payrollHeadcount) > 0;
}

/**
 * Personas en nómina de una línea (dotación): la nómina cargada o, si no hay,
 * posiciones × personas por posición (lo de siempre).
 */
export function laborHeadcountOf(line = {}) {
  const positions = nonNegative(line && line.positions);
  if (!(positions > 0)) return 0;
  return hasPayrollHeadcount(line) ? nonNegative(line.payrollHeadcount) : positions * nonNegative(line.peoplePerPosition, 1);
}

/** Personas por posición efectivas (con nómina cargada: nómina ÷ posiciones). */
export function laborPeoplePerPositionOf(line = {}) {
  const positions = nonNegative(line && line.positions);
  if (hasPayrollHeadcount(line) && positions > 0) return nonNegative(line.payrollHeadcount) / positions;
  return nonNegative(line && line.peoplePerPosition, 1);
}

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
  const payrollMode = hasPayrollHeadcount(line);
  const peoplePerPosition = laborPeoplePerPositionOf(line);
  const headcount = payrollMode ? laborHeadcountOf(line) : positions * peoplePerPosition;

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
  // % del costo fijo asignado a esta cotización (100 % si no se comparte).
  const allocation = fixedCostShareOf(line);
  const assignedFixedPerPerson = allocation.shared ? fixedMonthlyPerPerson * allocation.share : fixedMonthlyPerPerson;

  return {
    id: line.id ?? null,
    role: line.role ?? '',
    positions,
    peoplePerPosition,
    headcount,
    // Nómina cargada como total (B-1) y propuesta del diagrama de rotación (no cambia el costo).
    payrollMode,
    rotation: hasRotation(line) ? computeRotation(line.rotation, { positions }) : null,
    assignment: allocation.assignment,
    shared: allocation.shared,
    fixedCostSharePct: allocation.sharePct,
    shareMissing: allocation.missing,
    // Dotación equivalente (estructura por empleado): personas × % asignado.
    effectiveHeadcount: allocation.shared ? headcount * allocation.share : headcount,
    // Costo fijo completo (100 %) y la parte que tiene que cubrir otro servicio.
    fullFixedMonthly: (fixedMonthlyPerPerson + overtimeMonthlyPerPerson) * headcount,
    unassignedFixedMonthly: (fixedMonthlyPerPerson - assignedFixedPerPerson) * headcount,
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
    fixedMonthly: (assignedFixedPerPerson + overtimeMonthlyPerPerson) * headcount,
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
    effectiveHeadcount: results.reduce((s, r) => s + r.effectiveHeadcount, 0),
    positions: results.reduce((s, r) => s + r.positions, 0),
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
    hoursPerMonth: results.reduce((s, r) => s + r.hoursPerMonth, 0),
  };
}
