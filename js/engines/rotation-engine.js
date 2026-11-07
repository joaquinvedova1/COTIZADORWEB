/**
 * RotationEngine — asistente de diagrama de rotación de un puesto (tanda B 2026-11, B-1,
 * PLAN-2026-023). OPCIONAL y sólo PROPONE: nunca cambia el costo por sí mismo. El costo
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
 *
 * Esquema fijo o rotativo y cobertura vendida (PLAN-2026-024):
 *   pattern 'rotating' (default, como siempre): el servicio sigue mientras unos descansan
 *           (7x7, 14x7, 14x14…). Con la cobertura vendida del mes (días de servicio):
 *             nómina exacta = en sitio × ciclo ÷ días en sitio × mín(1, cobertura ÷ días del mes)
 *           Sin cobertura (o cobertura = el mes) → la fórmula de siempre. Nunca menos que en sitio.
 *   pattern 'fixed': la cuadrilla trabaja cuando trabaja el servicio y descansa cuando el
 *           servicio para (5x2 de lunes a viernes, 6x1). Nómina = en sitio, sin relevos.
 *           Si la cobertura pide más días que los que da el esquema, lo avisa (`coverageShort`).
 * Horas (sólo informa, nunca cambia el costo):
 *   días trabajados por persona por mes = en sitio × cobertura ÷ nómina   (promedio real)
 *   horas trabajadas por persona por mes = esos días × horas por turno (jornada)
 *   horas por encima de las normales = máx(0, trabajadas − horas normales por mes del puesto)
 *   promedio semanal del ciclo = días en sitio × horas por turno ÷ (ciclo ÷ 7)  (rotativo)
 *   Cómo se pagan esas horas (HE 50 / 100 %, adicional por diagrama, régimen especial) lo dice
 *   el convenio: RATEOS no lo infiere. Quien cotiza puede cargarlas como horas extra por mes.
 */

import { isPlainObject } from '../core/object.js';
import { nonNegative, safeDivide } from '../core/money.js';
import { createTrace } from '../core/trace.js';

/** Atajos de diagrama (plantillas rápidas editables: sólo llenan días en sitio y de franco). */
export const ROTATION_TEMPLATES = Object.freeze([
  Object.freeze({ id: '5x2', daysOn: 5, daysOff: 2, pattern: 'fixed', label: '5x2 (lunes a viernes)' }),
  Object.freeze({ id: '6x1', daysOn: 6, daysOff: 1, pattern: 'fixed', label: '6x1 (lunes a sábado)' }),
  Object.freeze({ id: '7x7', daysOn: 7, daysOff: 7, pattern: 'rotating', label: '7x7 (1x1)' }),
  Object.freeze({ id: '14x7', daysOn: 14, daysOff: 7, pattern: 'rotating', label: '14x7 (2x1)' }),
  Object.freeze({ id: '14x14', daysOn: 14, daysOff: 14, pattern: 'rotating', label: '14x14' }),
  Object.freeze({ id: '20x10', daysOn: 20, daysOff: 10, pattern: 'rotating', label: '20x10' }),
]);

export const ROTATION_PATTERNS = Object.freeze(['rotating', 'fixed']);

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
export function computeRotation(rotation, { positions = 0, coverageDaysPerMonth = null, normalHoursPerMonth = null } = {}) {
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

  const pattern = ROTATION_PATTERNS.includes(r.pattern) ? r.pattern : 'rotating';
  const fixed = pattern === 'fixed';
  // Cobertura vendida (días de servicio del mes): vacía = el mes entero (como siempre).
  const coverageRaw = nonNegative(coverageDaysPerMonth);
  const coverageDays = coverageRaw > 0 ? Math.min(coverageRaw, daysPerMonth) : daysPerMonth;
  const coverageShare = safeDivide(coverageDays, daysPerMonth, 1);

  const ready = daysOn > 0 && onSite > 0;
  const cycleDays = daysOn + daysOff;
  const onSiteShare = ready ? safeDivide(daysOn, cycleDays, 0) : null;
  const payrollExact = !ready ? null : fixed ? onSite : Math.max(onSite, onSite * cycleDays / daysOn * coverageShare);
  const fractional = ready && Math.abs(payrollExact - Math.round(payrollExact)) > 1e-6;
  const payroll = ready ? (rounding === 'exact' ? payrollExact : Math.ceil(payrollExact - 1e-6)) : null;
  const averageOnSite = ready ? (fixed ? onSite * coverageShare : payroll * onSiteShare) : null;
  const rotates = ready && daysOff > 0 && !fixed;
  const relievesPerMonth = rotates ? daysPerMonth / daysOn * groups : ready ? 0 : null;
  const daysBetweenRelieves = rotates ? daysOn / groups : null;
  const peoplePerRelief = rotates ? onSite / groups : null;
  const shiftHoursPerDay = shiftsPerDay > 0 && hoursPerShift ? shiftsPerDay * hoursPerShift : null;
  // Días que da el esquema por persona en el mes (5x2 → 21,4) y los que pide la cobertura.
  const schemeDaysPerPerson = ready ? daysPerMonth * onSiteShare : null;
  const coverageShort = ready && fixed && coverageDays > schemeDaysPerPerson + 1 + EPS;
  // Horas (sólo informa): promedio real por persona con la nómina propuesta.
  const workedDaysPerPerson = ready && payroll > 0 ? onSite * coverageDays / payroll : null;
  const workedHoursPerPerson = workedDaysPerPerson !== null && hoursPerShift ? workedDaysPerPerson * hoursPerShift : null;
  const normalHours = nonNegative(normalHoursPerMonth) > 0 ? nonNegative(normalHoursPerMonth) : null;
  const hoursAboveNormal = workedHoursPerPerson !== null && normalHours ? Math.max(0, workedHoursPerPerson - normalHours) : null;
  const cycleWeeklyHours = ready && hoursPerShift && !fixed && cycleDays > 0 ? daysOn * hoursPerShift / (cycleDays / 7) : null;
  const weeklyHours = ready && hoursPerShift && fixed ? Math.min(daysOn, 7) * hoursPerShift * Math.min(1, coverageDays / Math.max(schemeDaysPerPerson, EPS)) : null;

  return {
    ready,
    templateId: (ROTATION_TEMPLATES.find((t) => Math.abs(t.daysOn - daysOn) < EPS && Math.abs(t.daysOff - daysOff) < EPS) || {}).id || null,
    pattern,
    fixed,
    coverageDays,
    coverageFromQuote: coverageRaw > 0,
    coverageShare,
    schemeDaysPerPerson,
    coverageShort,
    workedDaysPerPerson,
    workedHoursPerPerson,
    normalHoursPerMonth: normalHours,
    hoursAboveNormal,
    cycleWeeklyHours,
    weeklyHours,
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
    formula: rot.fixed
      ? 'Esquema fijo (la cuadrilla descansa cuando el servicio para): nómina = personas en sitio, sin relevos · Horas por persona = días de servicio × horas por turno'
      : 'Nómina = personas en sitio × (días en sitio + días de franco) ÷ días en sitio × mín(1, días de servicio ÷ días del mes) · Relevos por mes = días del mes ÷ días en sitio × grupos que entran escalonados · Días entre relevos = días en sitio ÷ grupos',
    inputs: [
      { label: 'Días en sitio', value: rot.daysOn, format: 'days' },
      { label: 'Días de franco', value: rot.daysOff, format: 'days' },
      { label: 'Personas en sitio a la vez', value: rot.onSite, format: 'number' },
      { label: 'Grupos que entran escalonados', value: rot.groups, format: 'number' },
      { label: 'Días del mes', value: rot.daysPerMonth, format: 'days' },
      { label: rot.coverageFromQuote ? 'Días de servicio por mes (cobertura vendida)' : 'Días de servicio por mes (todo el mes)', value: rot.coverageDays, format: 'days' },
      ...(rot.normalHoursPerMonth ? [{ label: 'Horas normales por mes del puesto', value: rot.normalHoursPerMonth, format: 'hours' }] : []),
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
      ...(rot.workedDaysPerPerson !== null ? [{ label: 'Días trabajados por persona por mes (promedio)', value: rot.workedDaysPerPerson, format: 'days' }] : []),
      ...(rot.workedHoursPerPerson !== null ? [{ label: 'Horas trabajadas por persona por mes (promedio)', value: rot.workedHoursPerPerson, format: 'hours' }] : []),
      ...(rot.hoursAboveNormal !== null ? [{ label: 'Horas por encima de las normales del puesto', value: rot.hoursAboveNormal, format: 'hours' }] : []),
      ...(rot.cycleWeeklyHours !== null ? [{ label: 'Promedio semanal en el ciclo', value: rot.cycleWeeklyHours, format: 'hours' }] : []),
    ],
    result: { label: 'Personas en nómina propuestas', value: rot.payroll, format: 'number' },
    notes: [
      'Es una propuesta: el costo no cambia hasta que tocás "Aplicar al puesto". Después podés editar todo a mano.',
      'RATEOS no infiere el diagrama, los turnos ni el convenio: los cargás vos.',
      'Las horas por encima de las normales sólo se informan: cómo se pagan (horas extra, adicional por diagrama o un régimen especial) lo define tu convenio.',
    ],
  });
}

/** Cómo viaja el personal a la locación en un fijo mensual (PLAN-2026-024). */
export const TRAVEL_PATTERNS = Object.freeze(['daily', 'rotation', 'custom']);

/**
 * Relevo que dicta el diagrama de Personal (PLAN-2026-024): el más frecuente entre los puestos
 * con diagrama ROTATIVO completo (días en sitio y de franco > 0). Así el diagrama se carga una
 * sola vez (en el puesto) y los viajes de relevo lo siguen.
 * @returns {{ daysBetweenRelieves: number, index: number, role: string, label: string }|null}
 */
export function reliefFromLabor(labor = []) {
  const list = Array.isArray(labor) ? labor : [];
  let best = null;
  list.forEach((l, index) => {
    if (!hasRotation(l) || !(nonNegative(l.positions) > 0)) return;
    const rot = computeRotation(l.rotation, { positions: nonNegative(l.positions) });
    if (!rot.ready || !(rot.daysBetweenRelieves > 0)) return;
    if (!best || rot.daysBetweenRelieves < best.daysBetweenRelieves - EPS) {
      best = { daysBetweenRelieves: rot.daysBetweenRelieves, index, role: typeof l.role === 'string' ? l.role.trim() : '', label: rot.label };
    }
  });
  return best;
}

/**
 * Días entre viajes de una cotización según cómo viaja el personal (PLAN-2026-024):
 *   'daily'    va y vuelve cada día de servicio → 1
 *   'rotation' viaja con cada relevo del diagrama de Personal → días entre relevos (si no hay
 *              diagrama rotativo completo, el número guardado, como siempre)
 *   'custom' o sin dato → el número guardado (`activity.daysPerActivation`, como siempre)
 * @returns {{ pattern: string|null, days: number|null, relief: object|null }} days null = usar el guardado
 */
export function travelDaysOf(quote = {}) {
  const a = quote && isPlainObject(quote.activity) ? quote.activity : {};
  const pattern = TRAVEL_PATTERNS.includes(a.travelPattern) ? a.travelPattern : null;
  if (pattern === 'daily') return { pattern, days: 1, relief: null };
  if (pattern === 'rotation') {
    const relief = reliefFromLabor(quote.labor);
    return { pattern, days: relief ? relief.daysBetweenRelieves : null, relief };
  }
  return { pattern, days: null, relief: null };
}
