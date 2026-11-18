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
 * Por día de trabajo (por posición en servicio):
 *   horasExtraDía    = horasExtraPorDíaActivo × valorHoraExtra × factorCargas
 *   variableDía      = horasExtraDía + vianda
 *
 * Posiciones cubiertas:
 *   dotación = posiciones × personasPorPosición (relevos)
 *   fijo total = fijoMensual × dotación (todos cobran sueldo)
 *   variable total por día = variableDía × posiciones (en un día de trabajo
 *   trabaja una persona por posición)
 *
 * Horas extra por tramos (PLAN-2026-010, opcional): `line.overtime` es una
 * lista de { label, premiumPct, hours, basis } (HE 50 %, HE 100 %, otro
 * recargo). Cada tramo cuesta horas × valor hora × (1 + recargo) × factor de
 * cargas:
 *   basis 'per_active_day'  horas por día de trabajo → variable × posiciones
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
 * Tarifas de referencia por persona (PLAN-2026-025, sólo informativas: no cambian el costo):
 *   hora normal      = costo mensual por persona ÷ horas normales del mes
 *   hora extra 50 %  = valorHora × 1,5 × factorCargas
 *   hora extra 100 % = valorHora × 2 × factorCargas
 *
 *
 * Valor de la hora extra POR RECURSO (PLAN-2026-026): cada convenio paga distinto, así que el
 * perfil de Recursos puede traer su propio valor de la hora al 50 % y al 100 %
 * (`overtimeRate50`, `overtimeRate100`: lo que le cuesta a la empresa UNA hora, con cargas).
 * Vacío o 0 = se usa el calculado de arriba. La cotización sólo carga CANTIDADES:
 *   `overtime50HoursPerMonth`, `overtime100HoursPerMonth` = horas por mes de cada persona
 *   costo del mes por persona += horas al 50 % × hora al 50 % + horas al 100 % × hora al 100 %
 * (fijo del mes × personas en nómina, como los tramos "horas promedio por mes"). Sin esos
 * campos: igual que siempre.
 *
 * Todos los porcentajes son parámetros. Los valores demo son ILUSTRATIVOS.
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { billableHoursOf } from '../domain/cost-basis.js';
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

/** Horas extra por mes y por persona cargadas con el valor de la hora del recurso (PLAN-2026-026). */
export function resourceOvertimeHoursOf(line = {}) {
  return nonNegative(line.overtime50HoursPerMonth) + nonNegative(line.overtime100HoursPerMonth);
}

export const OVERTIME_BASES = Object.freeze(['per_active_day', 'per_month']);

/**
 * Tramos de horas extra de una línea: los de `overtime` o, si no hay lista,
 * el campo único de siempre (horas por día de trabajo + un recargo).
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
export function computeLaborLine(line = {}, { coverageDaysPerMonth = null, timeBasis = false, hoursPerActiveDay = 0, activeDaysPerMonth = 0 } = {}) {
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
  // 0.12.0: sumas NO remunerativas del recibo (viandas de convenio, asignaciones por acta…) y
  // contribuciones fijas del convenio por persona: costo de la empresa, sin cargas encima.
  const nonRemunerativePay = nonNegative(line.nonRemunerativeMonthly);
  // Cargas del convenio sobre el no remunerativo (obra social, cuota sindical…); 0 = sin cargas.
  const nonRemunerativeChargesPct = nonNegative(line.nonRemunerativeChargesPct);
  const nonRemunerativeCharges = nonRemunerativePay * pct(nonRemunerativeChargesPct);
  const fixedContributions = nonNegative(line.fixedContributionsMonthly);
  // Auditoría externa K-09: otras cargas y provisiones del convenio (fondo de cese, ausentismo…)
  // en % del remunerativo, sin aguinaldo ni cargas encima. 0 = no se suma.
  const otherChargesPct = nonNegative(line.otherChargesPct);
  const otherCharges = remunerative * pct(otherChargesPct);
  const nonRemunerative = insurance + ppe + training + transfer + nonRemunerativePay + nonRemunerativeCharges + fixedContributions + otherCharges;

  const fixedMonthlyPerPerson = loadedRemunerative + nonRemunerative;
  // Aportes del trabajador (0.12.0): se restan del bruto para mostrar el NETO del recibo.
  // No cambian el costo de la empresa (los paga el trabajador de su bruto).
  const workerContributionsPct = nonNegative(line.workerContributionsPct);
  const grossMonthly = remunerative + nonRemunerativePay;
  const workerContributions = remunerative * pct(workerContributionsPct);
  const netMonthly = grossMonthly - workerContributions;
  // Para comparar con el "costo total empleador" de un recibo: el mes sin aguinaldo ni vacaciones prorrateados.
  const payslipEmployerCost = remunerative * (1 + pct(employerContributionsPct) + pct(artPct)) + nonRemunerativePay + nonRemunerativeCharges + fixedContributions;

  const hourlyBase = safeDivide(basic, normalHours, 0);
  const overtimeHourly = hourlyBase * (1 + otPremium);
  const overtimeBaseHourly = safeDivide(remunerative, normalHours, 0);
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
  // Hora al 50 % y al 100 % de la persona: la de su recurso (convenio) o la calculada.
  const rate50Override = nonNegative(line.overtimeRate50);
  const rate100Override = nonNegative(line.overtimeRate100);
  const overtimeHourlyCost50 = rate50Override > 0 ? rate50Override : overtimeBaseHourly * 1.5 * loadFactor;
  const overtimeHourlyCost100 = rate100Override > 0 ? rate100Override : overtimeBaseHourly * 2 * loadFactor;
  // Horas extra por mes de cada persona (PLAN-2026-026): la cotización carga sólo la cantidad.
  [[50, nonNegative(line.overtime50HoursPerMonth), overtimeHourlyCost50], [100, nonNegative(line.overtime100HoursPerMonth), overtimeHourlyCost100]].forEach(([premiumPct, hours, hourlyCost]) => {
    if (!(hours > 0)) return;
    overtimeItems.push({
      id: `ot-month-${premiumPct}`, label: `Horas al ${premiumPct}\u00a0%`, premiumPct, hours, basis: 'per_month', billRatePerHour: 0, legacy: false, resourceRate: true,
      hourlyCost, perActiveDayPerPosition: 0, monthlyPerPerson: hours * hourlyCost, billedPerActiveDayPerPosition: 0, billedMonthlyPerPerson: 0,
    });
  });
  const overtimePerActiveDay = overtimeItems.reduce((acc, o) => acc + o.perActiveDayPerPosition, 0);
  const overtimeMonthlyPerPerson = overtimeItems.reduce((acc, o) => acc + o.monthlyPerPerson, 0);
  const mealPerActiveDay = nonNegative(line.mealPerActiveDay);
  const variablePerActiveDayPerPosition = overtimePerActiveDay + mealPerActiveDay;

  const loadedHourlyCost = safeDivide(fixedMonthlyPerPerson, normalHours, null);
  // % del costo fijo asignado a esta cotización (100 % si no se comparte).
  // Por tiempo usado (2026-11-18): no hay % asignado; el puesto cuesta sus horas en el trabajo.
  const allocation = timeBasis ? { assignment: null, shared: false, sharePct: 100, share: 1, missing: false } : fixedCostShareOf(line);
  const assignedFixedPerPerson = timeBasis ? 0 : allocation.shared ? fixedMonthlyPerPerson * allocation.share : fixedMonthlyPerPerson;
  // Horas por día de cada persona en el trabajo: las suyas (o su turno viejo) si son menos que
  // las del servicio; si no, las del servicio (misma regla que las horas extra del trabajo).
  const serviceHours = Math.min(nonNegative(hoursPerActiveDay), 24);
  const ownHours = nonNegative(line.coverageHoursPerDay) > 0
    ? nonNegative(line.coverageHoursPerDay)
    : line.rotation && typeof line.rotation === 'object' ? nonNegative(line.rotation.hoursPerShift) : 0;
  const timeHoursPerDay = ownHours > 0 ? Math.min(ownHours, serviceHours) : serviceHours;
  const billableHours = billableHoursOf(line, normalHours);
  // Hora para cotizar por tiempo usado: costo del mes ÷ horas que de verdad se venden por mes.
  const billableHourlyCost = safeDivide(fixedMonthlyPerPerson, billableHours, null);
  const timeHourlyCost = timeBasis ? billableHourlyCost ?? 0 : 0;
  // En un día de trabajo trabaja una persona por posición.
  const timePerActiveDay = timeHourlyCost * timeHoursPerDay * positions;
  const timeHeadcountPerActiveDay = timeBasis ? safeDivide(timeHoursPerDay * positions, billableHours, 0) : 0;

  return {
    id: line.id ?? null,
    role: line.role ?? '',
    positions,
    peoplePerPosition,
    headcount,
    // Nómina cargada como total (B-1) y propuesta del diagrama de rotación (no cambia el costo).
    payrollMode,
    rotation: hasRotation(line) ? computeRotation(line.rotation, { positions, coverageDaysPerMonth, normalHoursPerMonth: normalHours }) : null,
    assignment: allocation.assignment,
    shared: allocation.shared,
    fixedCostSharePct: allocation.sharePct,
    shareMissing: allocation.missing,
    // Dotación equivalente (estructura por empleado): personas × % asignado; por tiempo usado,
    // la parte del mes facturable que les ocupa el trabajo con los días estimados.
    effectiveHeadcount: timeBasis ? timeHeadcountPerActiveDay * nonNegative(activeDaysPerMonth) : allocation.shared ? headcount * allocation.share : headcount,
    // Por tiempo usado (2026-11-18): valor de la hora, horas por día y costo por día de trabajo.
    timeBasis: timeBasis === true,
    time: timeBasis
      ? { billableHoursPerMonth: billableHours, ownBillableHours: billableHours !== normalHours, hourlyCost: timeHourlyCost, hoursPerDay: timeHoursPerDay, perActiveDay: timePerActiveDay, headcountPerActiveDay: timeHeadcountPerActiveDay }
      : null,
    // Costo fijo completo (100 %) y la parte que tiene que cubrir otro servicio.
    fullFixedMonthly: (fixedMonthlyPerPerson + overtimeMonthlyPerPerson) * headcount,
    unassignedFixedMonthly: timeBasis ? 0 : (fixedMonthlyPerPerson - assignedFixedPerPerson) * headcount,
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
      nonRemunerativePay,
      nonRemunerativeCharges,
      otherChargesPct,
      otherCharges,
      fixedContributions,
      nonRemunerative,
      grossMonthly,
      workerContributionsPct,
      workerContributions,
      netMonthly,
      payslipEmployerCost,
      fixedMonthly: fixedMonthlyPerPerson,
      loadFactor,
      hourlyBase,
      overtimeHourly,
      loadedHourlyCost,
      // Horas facturables por mes (las cargadas en el recurso o las normales) y la hora que sale con ellas.
      billableHoursPerMonth: billableHours,
      ownBillableHours: billableHours !== normalHours,
      billableHourlyCost,
      // Tarifas de referencia de la persona (PLAN-2026-025): lo que cuesta UNA hora extra con el
      // recargo habitual (50 % y 100 %, valores de partida editables en los tramos) y con cargas.
      // Base: básico + adicionales remunerativos (la hora extra se liquida sobre el sueldo habitual).
      // Los tramos de horas extra ya cargados (`overtimeItems`) siguen con `hourlyBase` de siempre.
      overtimeBaseHourly,
      overtimeHourlyCost50,
      overtimeHourlyCost100,
      // ¿El valor viene cargado en el recurso (convenio) en vez de calculado?
      overtimeRate50Own: rate50Override > 0,
      overtimeRate100Own: rate100Override > 0,
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
    variablePerActiveDay: variablePerActiveDayPerPosition * positions + timePerActiveDay,
    hoursPerMonth: normalHours * headcount,
  };
}

/** Suma un conjunto de líneas de personal. */
export function computeLabor(lines = [], ctx = {}) {
  const results = objectList(lines).map((l) => computeLaborLine(l, ctx));
  return {
    lines: results,
    headcount: results.reduce((s, r) => s + r.headcount, 0),
    effectiveHeadcount: results.reduce((s, r) => s + r.effectiveHeadcount, 0),
    positions: results.reduce((s, r) => s + r.positions, 0),
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
    // Por tiempo usado: la parte del variable que es el tiempo de la gente, y su dotación equivalente por día.
    timeBasis: ctx.timeBasis === true,
    timePerActiveDay: results.reduce((s, r) => s + (r.time ? r.time.perActiveDay : 0), 0),
    timeHeadcountPerActiveDay: results.reduce((s, r) => s + (r.time ? r.time.headcountPerActiveDay : 0), 0),
    hoursPerMonth: results.reduce((s, r) => s + r.hoursPerMonth, 0),
  };
}
