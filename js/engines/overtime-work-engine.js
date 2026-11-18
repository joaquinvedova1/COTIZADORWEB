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
 *     Las horas de cada persona ya están en su sueldo del mes (que la cotización ya carga):
 *     se suma sólo el RECARGO de cada hora trabajada.
 *       recargo por hora de un puesto = valor hora extra − hora de sueldo con cargas (≥ 0)
 *       horas por día del puesto      = las del servicio (o las de cada persona, si son menos)
 *       por día de trabajo            = Σ personas × horas por día × recargo por hora
 *     Así "la cuadrilla por hora al 50 %" sale la hora normal + el recargo de cada operador.
 *
 *   mode 'some' — el trabajo es en horario normal y además lleva ALGUNAS horas fuera de horario
 *     (p. ej. intervenciones fuera de horario en un precio cerrado). Esas horas son además de las
 *     normales: se suma la hora extra COMPLETA de cada persona.
 *       por hora = Σ personas × valor hora extra (50 % o 100 %)
 *       fijo mensual: horas por mes → fijo del mes
 *       por trabajo / llamado (precio cerrado o por servicio): horas por cada uno →
 *         por día de trabajo = horas × valor ÷ días por trabajo
 *
 * Sólo la gente: el uso de equipos ya se costea con las horas por día del servicio.
 * Funciones puras: sin DOM, sin storage, sin fecha actual.
 */

import { isPlainObject, objectList } from '../core/object.js';
import { nonNegative, isFiniteNumber } from '../core/money.js';

export const OVERTIME_WORK_MODES = Object.freeze(['none', 'all', 'some']);
export const OVERTIME_WORK_PREMIUMS = Object.freeze([50, 100]);

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
 * @param {{ hoursPerActiveDay: number, daysPerActivation: number }} activity
 * @param {{ contractMode?: string|null }} opts
 */
export function computeOvertimeWork(quote = {}, labor = null, activity = {}, { contractMode = null } = {}) {
  const cfg = overtimeWorkOf(quote, { contractMode });
  const inputLines = objectList(quote && quote.labor);
  const H = Math.min(nonNegative(activity && activity.hoursPerActiveDay), 24);
  const perRole = [];
  (labor && Array.isArray(labor.lines) ? labor.lines : []).forEach((l, i) => {
    const people = nonNegative(l && l.positions);
    if (!(people > 0) || !l.perPerson) return;
    const p = l.perPerson;
    const base = isFiniteNumber(p.overtimeBaseHourly) ? p.overtimeBaseHourly : nonNegative(p.hourlyBase);
    const baseLoaded = nonNegative(base) * nonNegative(p.loadFactor, 1);
    const at50 = isFiniteNumber(p.overtimeHourlyCost50) ? nonNegative(p.overtimeHourlyCost50) : baseLoaded * 1.5;
    const at100 = isFiniteNumber(p.overtimeHourlyCost100) ? nonNegative(p.overtimeHourlyCost100) : baseLoaded * 2;
    const own = nonNegative(inputLines[i] && inputLines[i].coverageHoursPerDay);
    const hoursPerDay = own > 0 ? Math.min(own, H) : H;
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
    const key = cfg.premiumPct === 100 ? 'surcharge100' : 'surcharge50';
    out.variablePerActiveDay = perRole.reduce((acc, r) => acc + r.people * r.hoursPerDay * r[key], 0);
    out.active = out.variablePerActiveDay > 0;
  } else if (cfg.mode === 'some') {
    const perUnit = cfg.hours50 * crewAt50 + cfg.hours100 * crewAt100;
    out.perUnit = perUnit;
    if (cfg.perMonth) out.fixedMonthly = perUnit;
    else {
      const dpa = nonNegative(activity && activity.daysPerActivation, 1);
      out.variablePerActiveDay = dpa > 0 ? perUnit / dpa : perUnit;
    }
    out.active = perUnit > 0;
  }
  return out;
}
