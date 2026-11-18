/**
 * OvertimeWorkEngine — ¿el trabajo cotizado lleva horas extra? (pedido del dueño, 2026-11-18).
 *
 * Cada cotización da UN solo ítem con UN solo precio. Si el trabajo lleva horas extra, no se
 * cotizan aparte: su costo se suma DENTRO del costo del personal, como un concepto más. El valor
 * de la hora extra (al 50 % y al 100 %) es de cada recurso (calculado con su sueldo o el que trae
 * por convenio: `perPerson.overtimeHourlyCost50/100` de labor-engine).
 *
 *   mode 'none' (o sin dato): no suma nada.
 *
 *   mode 'all' — TODAS las horas del trabajo son fuera de horario (al 50 % o al 100 %).
 *     Las horas que el sueldo cargado en la cotización ya paga llevan sólo el RECARGO; las que
 *     pasan de ahí, la hora extra COMPLETA:
 *       horas por día de cada persona = las del servicio (o las suyas / su turno, si son menos)
 *       horas del mes por persona     = días de trabajo × horas por día
 *       horas que ya paga su sueldo   = horas normales del mes × % asignado (100 % si es dedicada)
                                       × meses de sueldo (D ÷ días disponibles si el trabajo dura más)
 *       recargo por hora              = valor hora extra − hora de sueldo con cargas (≥ 0)
 *       costo del mes = Σ personas × (min(horas, pagas) × recargo + max(0, horas − pagas) × valor)
 *       (va como costo por día de trabajo: costo del mes ÷ días; con otros días —equilibrio, tramos,
        matriz— se recalcula con `overtimeAllMonthlyAt`, porque no es lineal)
 *     Así "la cuadrilla por hora al 50 %" sale la hora normal + el recargo de cada operador.
 *
 *   mode 'some' — el trabajo es en horario normal y además lleva ALGUNAS horas fuera de horario
 *     (p. ej. intervenciones fuera de horario en un precio cerrado). Esas horas son además de las
 *     normales: se suma la hora extra COMPLETA de cada persona.
 *       por hora = Σ personas × valor hora extra (50 % o 100 %) + uso por hora de los equipos propios
 *       fijo mensual: horas por mes → fijo del mes
 *       por trabajo / llamado (precio cerrado o por servicio): horas por cada uno →
 *         por día de trabajo = horas × valor ÷ días por trabajo
 *
 * En 'all' los equipos ya se costean con las horas por día del servicio (no se suman de nuevo).
 * Funciones puras: sin DOM, sin storage, sin fecha actual.
 */

import { isPlainObject, objectList } from '../core/object.js';
import { nonNegative, isFiniteNumber, safeDivide } from '../core/money.js';

export const OVERTIME_WORK_MODES = Object.freeze(['none', 'all', 'some']);
export const OVERTIME_WORK_PREMIUMS = Object.freeze([50, 100]);

/**
 * Meses de sueldo que se pagan con D días de trabajo: 1 hasta los días disponibles del mes;
 * si el trabajo dura más, D ÷ disponibles (como los fijos en cost-engine `monthsFactor`).
 * Las horas que ya paga el sueldo crecen en la misma proporción (A1, 2026-11-18).
 */
export function salaryMonths(activeDays, availableDays) {
  const d = nonNegative(activeDays);
  const a = nonNegative(availableDays);
  if (a <= 0 || d <= a) return 1;
  return d / a;
}

/** Un puesto en 'all' con D días: horas trabajadas, las que ya paga el sueldo, las completas y el costo. */
function roleAllAt(r, premiumPct, D, months) {
  const p = premiumPct === 100 ? 100 : 50;
  const worked = nonNegative(D) * r.hoursPerDay;
  const paid = Math.min(worked, r.paidHoursPerMonth * months);
  const full = Math.max(0, worked - paid);
  return { worked, paid, full, cost: r.people * (paid * r[`surcharge${p}`] + full * r[`at${p}`]) };
}

/**
 * Costo de las horas extra de 'all' con OTROS días de trabajo (equilibrio, tramos, matriz: M1).
 * No es lineal: hasta las horas que ya paga el sueldo va sólo el recargo; después, la hora completa.
 * @param {object} ow resultado de computeOvertimeWork
 * @param {number} activeDays
 */
export function overtimeAllMonthlyAt(ow, activeDays) {
  if (!ow || ow.mode !== 'all' || !Array.isArray(ow.perRole)) return 0;
  const D = nonNegative(activeDays);
  const months = salaryMonths(D, ow.availableDaysPerMonth);
  return ow.perRole.reduce((acc, r) => acc + roleAllAt(r, ow.premiumPct, D, months).cost, 0);
}

/** Lo cargado en la cotización, normalizado. `perMonth`: las horas de 'some' son por mes. */
export function overtimeWorkOf(quote = {}, { contractMode = null } = {}) {
  const raw = isPlainObject(quote) && isPlainObject(quote.overtimeWork) ? quote.overtimeWork : {};
  const mode = OVERTIME_WORK_MODES.includes(raw.mode) ? raw.mode : 'none';
  const premiumPct = OVERTIME_WORK_PREMIUMS.includes(Number(raw.premiumPct)) ? Number(raw.premiumPct) : 50;
  return {
    mode,
    premiumPct,
    hours50: nonNegative(raw.hours50),
    hours100: nonNegative(raw.hours100),
    perMonth: contractMode === 'monthly',
  };
}

/**
 * Costo de las horas extra del trabajo, dentro del personal.
 * @param {object} quote
 * @param {{ lines: object[] }} labor resultado de computeLabor (mismo orden que quote.labor)
 * @param {{ hoursPerActiveDay: number, daysPerActivation: number, activeDaysPerMonth: number, availableDaysPerMonth?: number }} activity
 * @param {{ contractMode?: string|null, equipmentPerHour?: number }} opts
 */
export function computeOvertimeWork(quote = {}, labor = null, activity = {}, { contractMode = null, equipmentPerHour = 0 } = {}) {
  const cfg = overtimeWorkOf(quote, { contractMode });
  const inputLines = objectList(quote && quote.labor);
  const H = Math.min(nonNegative(activity && activity.hoursPerActiveDay), 24);
  const D = nonNegative(activity && activity.activeDaysPerMonth);
  const perRole = [];
  (labor && Array.isArray(labor.lines) ? labor.lines : []).forEach((l, i) => {
    const people = nonNegative(l && l.positions);
    if (!(people > 0) || !l.perPerson) return;
    const p = l.perPerson;
    const base = isFiniteNumber(p.overtimeBaseHourly) ? p.overtimeBaseHourly : nonNegative(p.hourlyBase);
    const baseLoaded = nonNegative(base) * nonNegative(p.loadFactor, 1);
    const at50 = isFiniteNumber(p.overtimeHourlyCost50) ? nonNegative(p.overtimeHourlyCost50) : baseLoaded * 1.5;
    const at100 = isFiniteNumber(p.overtimeHourlyCost100) ? nonNegative(p.overtimeHourlyCost100) : baseLoaded * 2;
    const input = inputLines[i] || {};
    // Horas de cada persona: las suyas o, en cotizaciones viejas, su turno (como el aviso de horas).
    const ownHours = nonNegative(input.coverageHoursPerDay);
    const shift = input.rotation && typeof input.rotation === 'object' ? nonNegative(input.rotation.hoursPerShift) : 0;
    const own = ownHours > 0 ? ownHours : shift;
    const hoursPerDay = own > 0 ? Math.min(own, H) : H;
    // Horas del mes que su sueldo (la parte asignada a esta cotización) ya paga, por persona trabajando.
    const headcount = nonNegative(l.headcount, people);
    const normalPerPerson = safeDivide(nonNegative(l.hoursPerMonth), headcount, 0);
    const share = l.shared && !l.shareMissing ? nonNegative(l.fixedCostSharePct) / 100 : 1;
    // Por tiempo usado (2026-11-18): cada hora del trabajo ya está en el costo a valor normal, así
    // que todas llevan sólo el recargo (no hay tope de horas pagas por el sueldo).
    const paidHoursPerMonth = l.timeBasis ? Infinity : normalPerPerson * share * safeDivide(headcount, people, 1);
    perRole.push({
      index: i,
      role: l.role || '',
      people,
      hoursPerDay,
      baseHourLoaded: baseLoaded,
      at50,
      at100,
      surcharge50: Math.max(0, at50 - baseLoaded),
      surcharge100: Math.max(0, at100 - baseLoaded),
      paidHoursPerMonth,
      // Valor propio por debajo de la hora de sueldo: recargo 0 (se avisa en la pantalla).
      lowRate50: at50 < baseLoaded - 0.005,
      lowRate100: at100 < baseLoaded - 0.005,
    });
  });
  const crew = (key) => perRole.reduce((acc, r) => acc + r.people * r[key], 0);
  const crewAt50 = crew('at50');
  const crewAt100 = crew('at100');
  const out = {
    ...cfg,
    perRole,
    crewAt50,
    crewAt100,
    crewSurchargePerHour: cfg.premiumPct === 100 ? crew('surcharge100') : crew('surcharge50'),
    fixedMonthly: 0,
    variablePerActiveDay: 0,
    // Lo que suma por hora del trabajo ('all') o por cada unidad de horas cargada ('some').
    perUnit: 0,
    active: false,
  };
  if (cfg.mode === 'all') {
    const available = nonNegative(activity && activity.availableDaysPerMonth);
    const months = salaryMonths(D, available);
    out.availableDaysPerMonth = available;
    out.salaryMonths = months;
    let monthly = 0;
    perRole.forEach((r) => {
      const at = roleAllAt(r, cfg.premiumPct, D, months);
      r.workedHoursPerMonth = at.worked;
      r.paidHoursInWork = at.paid;
      r.fullHoursPerMonth = at.full;
      r.monthly = at.cost;
      monthly += r.monthly;
    });
    out.monthlyAtEstimate = monthly;
    out.variablePerActiveDay = D > 0 ? monthly / D : 0;
    out.active = out.variablePerActiveDay > 0;
  } else if (cfg.mode === 'some') {
    const eq = nonNegative(equipmentPerHour);
    out.equipmentPerHour = eq;
    const perUnit = cfg.hours50 * (crewAt50 + eq) + cfg.hours100 * (crewAt100 + eq);
    out.perUnit = perUnit;
    const dpa = nonNegative(activity && activity.daysPerActivation, 1);
    // Unidades de horas en el mes: 1 (fijo mensual) o los trabajos / llamados del mes (D ÷ días por cada uno).
    const unitsPerMonth = cfg.perMonth ? 1 : dpa > 0 ? D / dpa : D;
    if (cfg.perMonth) out.fixedMonthly = perUnit;
    else out.variablePerActiveDay = dpa > 0 ? perUnit / dpa : perUnit;
    // Lo de cada puesto en el mes estimado (M2: se muestra dentro del costo de ese puesto).
    perRole.forEach((r) => {
      r.perUnit = r.people * (cfg.hours50 * r.at50 + cfg.hours100 * r.at100);
      r.monthly = r.perUnit * unitsPerMonth;
    });
    out.equipmentMonthly = (cfg.hours50 + cfg.hours100) * eq * unitsPerMonth;
    out.monthlyAtEstimate = perUnit * unitsPerMonth;
    out.active = perUnit > 0;
  }
  return out;
}
