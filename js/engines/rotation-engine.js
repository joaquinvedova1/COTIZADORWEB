/**
 * RotationEngine — asistente de diagrama de rotación de un puesto (tanda B 2026-11, B-1,
 * PLAN-2026-021). OPCIONAL y sólo PROPONE: nunca cambia el costo por sí mismo. El costo
 * cambia sólo cuando quien cotiza aplica la propuesta (personas en sitio → posiciones,
 * nómina → `labor[i].payrollHeadcount`, días entre relevos → `activity.daysPerActivation`).
 *
 * Datos (todos libres; los "7x7", "14x14", "14x7"… son atajos editables, no una lista cerrada):
 *   daysOn        días en sitio de cada persona (> 0)
 *   daysOff       días de franco (≥ 0)
 *   onSite        personas en sitio a la vez (vacío = las posiciones del puesto)
 *   groups        grupos que entran escalonados (1 = todos cambian juntos)
 *   shiftsPerDay  turnos por día (opcional, informativo)
 *   hoursPerShift horas por turno (opcional: el aviso de horas lo usa como
 *                 "horas por día que cubre este puesto" si ese campo está vacío)
 *   rounding      'up' (hacia arriba, default) | 'exact' (con decimales)
 *   daysPerMonth  días del mes para contar relevos (vacío = 30, calendario)
 *
 * Fórmulas:
 *   ciclo            = días en sitio + días de franco
 *   fracción en sitio = días en sitio ÷ ciclo
 *   nómina exacta    = en sitio × ciclo ÷ días en sitio        (14x7, 3 en sitio → 4,5)
 *   nómina           = ⌈nómina exacta⌉ (hacia arriba) o la exacta     (→ 5)
 *   en sitio promedio = nómina × fracción en sitio                (5 × 2/3 = 3,33)
 *   relevos por mes  = días del mes ÷ días en sitio × grupos     (30 ÷ 14 × 2 = 4,29)
 *   días entre relevos = días en sitio ÷ grupos                    (7)
 *   personas por relevo = en sitio ÷ grupos
 *   persona-días en sitio por mes = en sitio × días del mes        (base para campamento)
 * Sin franco (daysOff = 0) no hay relevos: nómina = en sitio y 0 relevos.
 */

import { isPlainObject } from '../core/object.js';
import { nonNegative, safeDivide } from '../core/money.js';
import { createTrace } from '../core/trace.js';

/** Atajos de diagrama (plantillas rápidas editables: sólo llenan días en sitio y de franco). */
export const ROTATION_TEMPLATES = Object.freeze([
  Object.freeze({ id: '7x7', daysOn: 7, daysOff: 7 }),
  Object.freeze({ id: '14x14', daysOn: 14, daysOff: 14 }),
  Object.freeze({ id: '14x7', daysOn: 14, daysOff: 7 }),
  Object.freeze({ id: '20x10', daysOn: 20, daysOff: 10 }),
  Object.freeze({ id: '5x2', daysOn: 5, daysOff: 2 }),
]);

export const ROTATION_ROUNDINGS = Object.freeze(['up', 'exact']);

/** Días del mes para contar relevos si no se cargan (mes calendario). */
export const ROTATION_DEFAULT_DAYS_PER_MONTH = 30;

const EPS = 1e-9;

/** ¿El puesto tiene un diagrama cargado (aunque sea incompleto)? */
export function hasRotation(line) {
  return Boolean(line && isPlainObject(line.rotation));
}

/**
 * Propuesta del diagrama de rotación de un puesto.
 * @param {object|null} rotation `labor[i].rotation`
 * @param {{ positions?: number }} ctx posiciones actuales del puesto (default de "en sitio")
 */
export function computeRotation(rotation, { positions = 0 } = {}) {
  const r = isPlainObject(rotation) ? rotation : {};
  const daysOn = nonNegative(r.daysOn);
  const daysOff = nonNegative(r.daysOff);
  const onSiteRaw = nonNegative(r.onSite);
  const onSite = onSiteRaw > 0 ? onSiteRaw : nonNegative(positions);
  const groupsRaw = nonNegative(r.groups);
  const groups = groupsRaw > 0 ? groupsRaw : 1;
  const shiftsPerDay = nonNegative(r.shiftsPerDay);
  const hoursPerShiftRaw = nonNegative(r.hoursPerShift);
  const hoursPerShift = hoursPerShiftRaw > 0 ? Math.min(hoursPerShiftRaw, 24) : null;
  const rounding = ROTATION_ROUNDINGS.includes(r.rounding) ? r.rounding : 'up';
  const dpmRaw = nonNegative(r.daysPerMonth);
  const daysPerMonth = dpmRaw > 0 ? dpmRaw : ROTATION_DEFAULT_DAYS_PER_MONTH;

  const ready = daysOn > 0 && onSite > 0;
  const cycleDays = daysOn + daysOff;
  const onSiteShare = ready ? safeDivide(daysOn, cycleDays, 0) : null;
  const payrollExact = ready ? onSite * cycleDays / daysOn : null;
  const fractional = ready && Math.abs(payrollExact - Math.round(payrollExact)) > 1e-6;
  const payroll = ready ? (rounding === 'exact' ? payrollExact : Math.ceil(payrollExact - 1e-6)) : null;
  const averageOnSite = ready ? payroll * onSiteShare : null;
  const rotates = ready && daysOff > 0;
  const relievesPerMonth = rotates ? daysPerMonth / daysOn * groups : ready ? 0 : null;
  const daysBetweenRelieves = rotates ? daysOn / groups : null;
  const peoplePerRelief = rotates ? onSite / groups : null;
  const shiftHoursPerDay = shiftsPerDay > 0 && hoursPerShift ? shiftsPerDay * hoursPerShift : null;

  return {
    ready,
    templateId: (ROTATION_TEMPLATES.find((t) => Math.abs(t.daysOn - daysOn) < EPS && Math.abs(t.daysOff - daysOff) < EPS) || {}).id || null,
    label: daysOn > 0 ? `${fmtPlain(daysOn)}x${fmtPlain(daysOff)}` : null,
    daysOn,
    daysOff,
    cycleDays,
    onSite,
    onSiteFromPositions: !(onSiteRaw > 0),
    groups,
    shiftsPerDay: shiftsPerDay > 0 ? shiftsPerDay : null,
    hoursPerShift,
    shiftHoursPerDay,
    rounding,
    daysPerMonth,
    onSiteShare,
    payrollExact,
    fractional,
    payroll,
    peoplePerPosition: ready ? payroll / onSite : null,
    averageOnSite,
    spare: ready ? payroll - payrollExact : null,
    relievesPerMonth,
    daysBetweenRelieves,
    peoplePerRelief,
    onSitePerDay: ready ? onSite : null,
    personDaysOnSitePerMonth: ready ? onSite * daysPerMonth : null,
    coverageHoursPerDay: hoursPerShift,
  };
}

/** "14" / "4,5" sin depender del formateador de la UI (sólo para el rótulo "14x7"). */
function fmtPlain(n) {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Traza "Ver cálculo" de la propuesta. */
export function rotationTrace(rot, { role = '' } = {}) {
  if (!rot || !rot.ready) return null;
  return createTrace({
    id: 'labor_rotation',
    title: `Diagrama de rotación — ${role || 'Puesto'}`,
    formula: 'Nómina = personas en sitio × (días en sitio + días de franco) ÷ días en sitio · Relevos por mes = días del mes ÷ días en sitio × grupos que entran escalonados · Días entre relevos = días en sitio ÷ grupos',
    inputs: [
      { label: 'Días en sitio', value: rot.daysOn, format: 'days' },
      { label: 'Días de franco', value: rot.daysOff, format: 'days' },
      { label: 'Personas en sitio a la vez', value: rot.onSite, format: 'number' },
      { label: 'Grupos que entran escalonados', value: rot.groups, format: 'number' },
      { label: 'Días del mes', value: rot.daysPerMonth, format: 'days' },
      ...(rot.shiftsPerDay ? [{ label: 'Turnos por día', value: rot.shiftsPerDay, format: 'number' }] : []),
      ...(rot.hoursPerShift ? [{ label: 'Horas por turno', value: rot.hoursPerShift, format: 'hours' }] : []),
    ],
    steps: [
      { label: 'Fracción del ciclo en sitio', value: rot.onSiteShare * 100, format: 'percent' },
      { label: 'Nómina exacta', value: rot.payrollExact, format: 'number' },
      { label: rot.rounding === 'exact' ? 'Nómina (exacta, con decimales)' : 'Nómina (redondeada hacia arriba)', value: rot.payroll, format: 'number' },
      { label: 'Personas en sitio en promedio con esa nómina', value: rot.averageOnSite, format: 'number' },
      { label: 'Relevos por mes', value: rot.relievesPerMonth, format: 'number' },
      ...(rot.daysBetweenRelieves ? [{ label: 'Días entre relevos', value: rot.daysBetweenRelieves, format: 'days' }] : []),
      { label: 'Persona-días en sitio por mes', value: rot.personDaysOnSitePerMonth, format: 'number' },
    ],
    result: { label: 'Personas en nómina propuestas', value: rot.payroll, format: 'number' },
    notes: [
      'Es una propuesta: el costo no cambia hasta que tocás "Aplicar al puesto". Después podés editar todo a mano.',
      'RATEOS no infiere el diagrama, los turnos ni el convenio: los cargás vos.',
    ],
  });
}
