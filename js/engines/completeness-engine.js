/**
 * CompletenessEngine — Cost Completeness Score.
 *
 * Reglas determinísticas que detectan costos u definiciones faltantes.
 * Cada regla tiene un peso y un estado:
 *   ok      (verde)   → suma el 100 % de su peso
 *   warning (naranja) → suma el 50 % de su peso
 *   missing (rojo)    → suma 0
 *   n/a               → no participa
 *
 *   score % = Σ peso obtenido / Σ peso aplicable × 100
 *
 * Severidad de cada pendiente (PLAN-2026-010; no cambia el puntaje):
 *   critical  falta algo que cambia el costo o el precio (externo sin tarifa,
 *             moneda sin tipo de cambio, actividad o productividad faltante,
 *             tarifa o margen faltantes)
 *   review    revisar antes de usar la tarifa (IVA de externos, fechas base,
 *             contingencia 0, movilización sin definir…)
 * Una regla también es crítica si lo dice su ítem (`critical: true`): por
 * ejemplo, "Personal" con un puesto usado sin sueldo básico (ECO-01, H-03).
 * `unreliable: true` (ECO-01) marca los pendientes con los que los números se
 * muestran pero NO son reales (doble abono, "por salida" sin confirmar, puesto
 * sin sueldo): el resultado dice "RESULTADO NO CONFIABLE" arriba del margen.
 * Además, `notices` lleva avisos INFORMATIVOS que no participan del puntaje
 * (por ejemplo, equipo propio sin costo de capital).
 */

import { objectList } from '../core/object.js';
import { nonNegative, toNumber } from '../core/money.js';
import { contractOf, contractUsesMaterials, travelNotNeeded, componentsOf } from '../domain/contract.js';
import { computeExtras } from './extras-engine.js';
import { AVAILABILITY_WINDOW, EQUIPMENT_SERVICE_TYPES, CONTINUOUS_SERVICE_TYPES, SERVICE_TYPES, PRICING_MODES, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { billingUnitOf, unitTexts } from '../domain/billing-units.js';
import { isValidMarginAndTaxes, readMarginInput } from './pricing-engine.js';
import { formatPercent, formatNumber, formatMoney } from '../core/format.js';
import { baseLabel } from '../domain/economic-base.js';
import { activationTerms, activationFieldLabels, GUARD_FEE_LABEL } from '../domain/activation-terms.js';
import { billingTaxInfo } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { externalFiscal, externalFuelMode } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { computeEquipmentLine } from './equipment-engine.js';
import { proposeServiceShares, staleDedicationOf, staleDedicationMessage } from './utilization-engine.js';
import { normalizeRules } from './commercial-rules-engine.js';
import { overtimeWorkOf } from './overtime-work-engine.js';
import { contingencyPctOf, normalizeActivity, monthsFactor, autoOutputPerActiveDay, availabilityHoursOf } from './cost-engine.js';
import { outputPerActiveDayOf, outputMatchesBilling, normalizeBasisId } from './materials-engine.js';
import { routeTrips } from './transport-engine.js';
import { overtimeItemsOf, resourceOvertimeHoursOf, hasPayrollHeadcount, laborHeadcountOf, laborPeoplePerPositionOf } from './labor-engine.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { usesTimeBasis, resolveUnitHours } from '../domain/cost-basis.js';
import { conversionFactor, currencyOfBase } from './currency-engine.js';
import { isPlainObject } from '../core/object.js';
import { normalizePriceAdjustment, priceAdjustmentOf, contingencyPriceOverlap } from '../domain/price-adjustment.js';
import { vatFinanceOf } from '../domain/vat-finance.js';

const STATUS_WEIGHT = { ok: 1, warning: 0.5, missing: 0 };

/** ¿Campo vacío? (null, undefined o texto en blanco: la cantidad de un material recién traído de Recursos). */
const emptyValue = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Pendientes que cambian el costo o el precio: se muestran como críticos (PLAN-2026-010 / 012). */
const CRITICAL_RULES = Object.freeze(['equipment_cost', 'external_route', 'external_hours', 'currency', 'utilization', 'rate', 'margin', 'monthly_fee_overlap', 'external_unit_trips']);

/** Tope de horas por día por persona para el aviso con "todo el trabajo" (N5). */
const MAX_HOURS_PER_PERSON_DAY = 16;

/** Debajo de este puntaje la cotización se considera con riesgo (pueden faltar costos). */
export const COMPLETENESS_RISK_THRESHOLD = 60;

/** Colores del puntaje en toda la interfaz: verde ≥ 85, naranja ≥ 60, rojo < 60. */
export const COMPLETENESS_GREEN_THRESHOLD = 85;

/**
 * Aviso de cobertura de horas del personal (PLAN-2026-014, LAB-D2). Es un control mensual de
 * horas de cobertura: no habla de "jornada" porque RATEOS no tiene un dato de jornada diaria.
 */
export const LABOR_COVERAGE_MESSAGE = 'La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra.';

/** Tono (green | orange | red) de un puntaje de completitud. */
export function completenessTone(scorePct) {
  if (!Number.isFinite(scorePct)) return 'red';
  if (scorePct >= COMPLETENESS_GREEN_THRESHOLD) return 'green';
  if (scorePct >= COMPLETENESS_RISK_THRESHOLD) return 'orange';
  return 'red';
}

/**
 * Horas trabajadas por día con llamado que quedan fuera de la franja de guardia (2026-11).
 * Sólo con franja horaria y ambos datos cargados; null si no hay excedente.
 * @returns {{ worked:number, guard:number, outside:number }|null}
 */
export function outsideWindowHours(quote = {}) {
  const a = quote.activity || {};
  if (a.availability !== AVAILABILITY_WINDOW) return null;
  const guard = availabilityHoursOf(a);
  const worked = Math.min(nonNegative(a.hoursPerActiveDay), 24);
  if (!(guard > 0) || !(worked > guard + 1e-9)) return null;
  return { worked, guard, outside: worked - guard };
}

/**
 * Texto del aviso de fuera de horario (pendiente y nota del paso), según la unidad:
 * por hora esas horas YA se facturan como horas normales; por día, el día cubre la franja.
 * Regla de un ítem (2026-11-18): el recargo se elige en "Horas extra del trabajo" (dentro del
 * precio), nunca en un renglón aparte.
 * @param {{ worked:number, guard:number, outside:number }} o
 */
export function outsideWindowMessage(quote = {}, o, { short = false } = {}) {
  const f = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
  const D = normalizeActivity(quote).activeDaysPerMonth;
  const month = D > 0 ? ` (${f(o.outside * D)} h por mes)` : '';
  const head = short
    ? `${f(o.outside)} h por día fuera de la franja${month}`
    : `Trabajás ${f(o.worked)} h por día y la franja de guardia es de ${f(o.guard)} h: ${f(o.outside)} h por día quedan fuera de horario${month}`;
  return billingUnitOf(quote).kind === 'hour'
    ? `${head}. Ya se facturan como horas normales: si fuera de horario les pagás un recargo, cubrí sólo el recargo en tu tarifa (un solo precio; la hora entera ya está en las horas por día).`
    : `${head}: si fuera de horario les pagás un recargo, cubrilo en tu tarifa (un solo precio, sin renglones aparte).`;
}

/**
 * Guardia activa (2026-11): el personal está en el lugar durante las horas de guardia, que
 * cuentan como horas de trabajo. Horas a cubrir por posición en el mes = días disponibles
 * (de guardia) × horas de guardia por día (24 con 24/7). Sólo on call con "activa" y horas.
 * La pasiva (localizable) no se cubre hora por hora: se rota quién está de guardia.
 * @returns {{ days:number, hours:number, required:number }|null}
 */
export function activeGuardCoverage(quote = {}) {
  if (!quote || quote.serviceType !== 'on_call') return null;
  const a = quote.activity || {};
  if (a.guardType !== 'active') return null;
  const hours = availabilityHoursOf(a);
  if (!(hours > 0)) return null;
  const days = normalizeActivity(quote).availableDaysPerMonth;
  return { days, hours, required: days * hours };
}

/**
 * Personas por posición que pide la guardia activa para una línea de personal: horas a cubrir
 * ÷ horas normales por persona, contra las cargadas (nómina o personas por posición, más las
 * horas extra). Un puesto que cubre sólo un turno ("Horas por día que cubre este puesto" o las
 * horas por turno del diagrama) cubre esas horas de la guardia, no las 24. Sin horas normales
 * o sin posiciones → null. Nunca cambia el costo.
 * @param {number} [activeDays] días con trabajo (para las horas extra por día de trabajo)
 */
export function activeGuardLineCheck(guard, l = {}, activeDays = 0) {
  const normal = nonNegative(l.normalHoursPerMonth);
  if (!guard || !(nonNegative(l.positions) > 0) || !(normal > 0)) return null;
  const own = Math.min(nonNegative(l.coverageHoursPerDay), 24);
  const shift = isPlainObject(l.rotation) ? Math.min(nonNegative(l.rotation.hoursPerShift), 24) : 0;
  const lineHours = own > 0 ? own : shift > 0 ? shift : guard.hours;
  const hours = Math.min(guard.hours, lineHours);
  const required = guard.days * hours;
  const ppp = laborPeoplePerPositionOf(l);
  const items = overtimeItemsOf(l);
  const perMonth = items.filter((o) => o.basis === 'per_month').reduce((acc, o) => acc + o.hours, 0) + resourceOvertimeHoursOf(l);
  const perDay = items.filter((o) => o.basis === 'per_active_day').reduce((acc, o) => acc + o.hours, 0);
  const extra = ppp * perMonth + perDay * nonNegative(activeDays);
  const covered = ppp * normal + extra;
  return { ppp, normal, hours, required, extra, covered, needed: required / normal, short: required > covered + 1e-6 };
}

/** Personal cargado como "cantidad de personas" (sin relevos por posición ni nómina total). */
function isSimpleStaff(l = {}) {
  return !(Number(l.payrollHeadcount) > 0) && Math.abs(nonNegative(l.peoplePerPosition, 1) - 1) < 1e-9;
}

function rule(id, label, step, weight, status, message) {
  return { id, label, step, weight, status, color: status === 'ok' ? 'green' : status === 'warning' ? 'orange' : status === 'missing' ? 'red' : 'gray', message };
}

function isBlank(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
}

/**
 * Supuesto de "Sí, cobra por salida" (ECO-01, H-01) para una línea externa: tarifa, viajes por
 * salida y ruta (distancia de ida, ida y vuelta) TAL COMO ESTÁN AHORA. La confirmación guarda
 * esto en `line.externalUnitConfirmed` y sólo vale mientras siga igual: si cambian la tarifa,
 * los viajes por salida (también los que se derivan de la unidad "viaje") o la ruta, se vuelve
 * a pedir. Así una confirmación vieja nunca silencia el aviso para otra operación.
 */
export function externalUnitAssumption(quote = {}, line = {}) {
  const logistics = isPlainObject(quote.logistics) ? quote.logistics : {};
  const x = isPlainObject(line.external) ? line.external : {};
  const route = routeTrips(quote, normalizeActivity(quote));
  return {
    unit: 'activation',
    price: nonNegative(x.price),
    tripsPerActivation: logistics.notApplicable ? 0 : nonNegative(route.tripsPerActivation),
    distanceKm: logistics.notApplicable ? 0 : nonNegative(logistics.distanceKm),
    roundTrip: logistics.roundTrip !== false,
  };
}

/** Qué cambió desde la confirmación (vacío = sigue valiendo). Sin confirmación válida: null. */
function assumptionChanges(confirmed, current) {
  if (!isPlainObject(confirmed) || confirmed.unit !== 'activation') return null;
  const differs = (a, b) => !(Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) < 1e-9);
  const changes = [];
  if (differs(confirmed.price, current.price)) changes.push('price');
  if (differs(confirmed.tripsPerActivation, current.tripsPerActivation)) changes.push('trips');
  if (differs(confirmed.distanceKm, current.distanceKm)) changes.push('distance');
  if (Boolean(confirmed.roundTrip) !== current.roundTrip) changes.push('roundTrip');
  return changes;
}

/**
 * Evalúa la completitud de una cotización.
 * @param {object} quote
 * @returns {{ scorePct: number, items: object[], pending: object[], counts: {ok:number, warning:number, missing:number} }}
 */
export function evaluateCompleteness(quoteInput = {}) {
  // 0.19.0: horas de cada recurso en la unidad de cobro → horas por día (para los avisos de horas).
  const quote = resolveUnitHours(quoteInput, normalizeActivity(quoteInput));
  const items = [];
  // La activación con el nombre de la cotización y los rótulos que se citan (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const L = activationFieldLabels(T);
  const serviceType = quote.serviceType;
  // Contrato (PLAN-2026-018): modalidad y recursos. Las cotizaciones anteriores
  // (sin contrato guardado) se evalúan exactamente como siempre.
  const contract = contractOf(quote);
  const isOnCall = contract.legacy ? serviceType === 'on_call' : contract.mode === 'on_demand';
  const activity = quote.activity || {};
  const labor = objectList(quote.labor);
  const contracted = objectList(quote.contractedStaff);
  const equipment = objectList(quote.equipment);
  const materials = objectList(quote.materials);
  const logistics = quote.logistics || {};
  const vehicles = objectList(logistics.vehicles);
  const pricing = quote.pricing || {};
  const rules = quote.rules || {};
  const finance = quote.finance || {};
  const fuel = quote.fuel || {};

  // 1. Modalidad / tipo de servicio
  const validType = contract.legacy ? SERVICE_TYPES.some((t) => t.id === serviceType) : true;
  const validMode = PRICING_MODES.some((m) => m.id === quote.pricingMode);
  items.push(rule('modality', 'Unidad de cobro', 'service', 2,
    validType && validMode ? 'ok' : 'missing',
    validType && validMode ? 'Unidad de cobro definida.' : 'Falta definir el contrato o la unidad de cobro.'));

  // 2. Tarifa o actividad según modalidad
  if (quote.pricingMode === 'known_rate') {
    const ok = nonNegative(pricing.knownRate) > 0;
    const item = rule('rate', 'Tarifa ingresada', 'margin', 2, ok ? 'ok' : 'missing', ok ? 'Tarifa definida.' : 'Falta tu precio en «El precio».');
    if (!ok) item.focus = 'pricing.knownRate';
    items.push(item);
  }

  // 3. Actividad: por cantidad o evento (m³, viajes, llamados…; PLAN-2026-009) en la unidad comercial.
  // Cada pendiente lleva al campo que falta (Test Lab, PLAN-2026-013).
  const unit = billingUnitOf(quote);
  // Cobro por hora: sin horas por día no hay unidades facturables (la tarifa queda "—").
  const hoursMissing = unit.kind === 'hour' && !(Math.min(nonNegative(activity.hoursPerActiveDay), 24) > 0);
  // Los avisos citan el rótulo del campo tal como se ve en el paso 1 (El servicio).
  const activityHoursLabel = 'Horas por día de trabajo';
  const hoursMessage = `Cobrás por hora y falta "${activityHoursLabel}": sin horas no hay unidades facturables ni tarifa.`;
  // Por tiempo usado (2026-11-18): el personal y los equipos propios cuestan sus HORAS en el trabajo.
  // Sin horas por día (o sin horas del mes del puesto) su costo queda en $ 0: se pide en rojo.
  if (usesTimeBasis(quote)) {
    const laborLines = objectList(quote.labor);
    const ownEquipment = objectList(quote.equipment).filter((e) => e.acquisition !== 'rented' && e.acquisition !== 'outsourced' && nonNegative(e.quantity) > 0);
    const working = laborLines.some((l) => nonNegative(l.positions) > 0) || ownEquipment.length > 0;
    if (working && !hoursMissing && !(Math.min(nonNegative(activity.hoursPerActiveDay), 24) > 0)) {
      const item = rule('time_hours', activityHoursLabel, 'service', 2, 'missing',
        `Falta "${activityHoursLabel}": tu gente y tus equipos se cobran por las horas que les lleva el trabajo. Sin horas, su costo queda en $ 0.`);
      item.focus = 'activity.hoursPerActiveDay';
      items.push(item);
    }
    const noHour = laborLines.findIndex((l) => nonNegative(l.positions) > 0 && (nonNegative(l.basicMonthly) + nonNegative(l.additionalsMonthly)) > 0
      && !(nonNegative(l.billableHoursPerMonth) > 0) && !(nonNegative(l.normalHoursPerMonth) > 0));
    if (noHour >= 0) {
      const name = (typeof laborLines[noHour].role === 'string' && laborLines[noHour].role.trim()) || 'Puesto';
      const item = rule('time_hour_value', 'Valor de la hora', 'labor', 2, 'missing',
        `"${name}" no tiene horas normales por mes: sin ellas no sale el valor de su hora y su costo queda en $ 0.`);
      item.focus = `labor.${noHour}.normalHoursPerMonth`;
      items.push(item);
    }
  }
  if (unit.kind === 'quantity' || unit.kind === 'event') {
    const qOk = nonNegative(activity.billableQuantityPerMonth) > 0;
    const yieldOk = unit.kind !== 'quantity' || nonNegative(activity.unitsPerActiveDay) > 0;
    // V-10: por llamado, trabajo o hito, los días que lleva cada uno definen los días de trabajo
    // (sueldos, equipos, combustible). Vacío o en 0 el motor usa 1 día: se pide el dato.
    const eventDaysOk = unit.kind !== 'event' || contractOf(quote).mode === 'monthly' || nonNegative(activity.daysPerActivation) > 0;
    const ok = qOk && yieldOk && eventDaysOk;
    const texts = unitTexts(unit);
    const item = rule('utilization', `${unit.plural.charAt(0).toUpperCase()}${unit.plural.slice(1)} por mes`, 'service', 2,
      ok ? 'ok' : 'missing',
      ok ? `Cantidad por mes definida (${unit.plural}).`
        : !qOk ? `${texts.quantityQuestion} Falta ese dato.`
          : !yieldOk ? `${texts.perDayQuestion} Falta ese dato para calcular los días de trabajo.`
            : `Faltan los días que lleva cada ${T.one}: se está calculando con 1 día.`);
    if (!ok) item.focus = !qOk ? 'activity.billableQuantityPerMonth' : !yieldOk ? 'activity.unitsPerActiveDay' : 'activity.daysPerActivation';
    items.push(item);
  } else if (isOnCall || quote.pricingMode === 'known_activity') {
    const daysOk = nonNegative(activity.activeDaysPerMonth) > 0;
    const ok = daysOk && !hoursMissing;
    const item = rule('utilization', isOnCall ? 'Días de trabajo por mes' : 'Actividad estimada', 'service', 2,
      ok ? 'ok' : 'missing',
      ok ? 'Días de trabajo estimados por mes definidos.' : !daysOk ? '¿Cuántos días del mes esperás que el equipo esté trabajando y facturando? Falta ese dato.' : hoursMessage);
    if (!ok) item.focus = !daysOk ? 'activity.activeDaysPerMonth' : 'activity.hoursPerActiveDay';
    items.push(item);
  } else if (hoursMissing) {
    const item = rule('utilization', 'Horas por día de trabajo', 'service', 2, 'missing', hoursMessage);
    item.focus = 'activity.hoursPerActiveDay';
    items.push(item);
  }

  // 4. Personal. Un puesto USADO (posiciones > 0) sin sueldo básico es CRÍTICO (ECO-01, H-03):
  // su costo laboral sería $ 0 y la cotización no está completa. No se inventa ningún sueldo.
  // Vale también para "sólo equipo": si se cargó un puesto con posiciones, se usa.
  const unpaid = labor.map((l, index) => ({ l, index })).filter(({ l }) => nonNegative(l.positions) > 0 && !(nonNegative(l.basicMonthly) > 0));
  const roleOf = (l) => (typeof l.role === 'string' && l.role.trim()) || 'Personal';
  if (unpaid.length) {
    const names = unpaid.slice(0, 3).map(({ l }) => `"${roleOf(l)}"`).join(', ');
    const more = unpaid.length > 3 ? ` y ${unpaid.length - 3} más` : '';
    const item = rule('labor', 'Personal', 'labor', 2, 'missing',
      `${unpaid.length === 1 ? 'Un puesto que se usa en la cotización no tiene' : 'Hay puestos que se usan en la cotización sin'} sueldo básico: ${names}${more}. Sin el básico faltan su sueldo, las cargas sociales sobre él y el valor de sus horas extra: la cotización no está completa. Cargá el básico mensual; si el puesto no trabaja en este servicio, poné 0 personas o quitá la línea.`);
    item.critical = true;
    item.unreliable = true;
    item.focus = `labor.${unpaid[0].index}.basicMonthly`;
    item.targets = unpaid.map(({ l, index }) => ({ list: 'labor', index, name: roleOf(l) }));
    items.push(item);
  } else if (contract.legacy ? serviceType !== 'equipment_only' : contract.labor) {
    // 0.15.0: el personal tercerizado (un valor fijo, sin sueldo) también es personal cargado.
    const ok = labor.some((l) => nonNegative(l.basicMonthly) > 0 && nonNegative(l.positions) > 0)
      || contracted.some((c) => nonNegative(c.people) > 0 && nonNegative(c.rate) > 0);
    items.push(rule('labor', 'Personal', 'labor', 2, ok ? 'ok' : 'missing', ok ? 'Personal cargado.' : 'No hay personal con salario cargado.'));
  }

  // 4b. Personal tercerizado (0.15.0): con personas y sin valor, o por hora sin horas por día, su
  // costo queda en $ 0. No se inventa un valor: se pide.
  const contractedNameOf = (c) => (typeof c.role === 'string' && c.role.trim()) || 'Personal tercerizado';
  const contractedNoRate = contracted.map((c, index) => ({ c, index })).filter(({ c }) => nonNegative(c.people) > 0 && !(nonNegative(c.rate) > 0));
  if (contractedNoRate.length) {
    const names = contractedNoRate.slice(0, 3).map(({ c }) => `"${contractedNameOf(c)}"`).join(', ');
    const item = rule('contracted_staff', 'Personal tercerizado', 'labor', 2, 'missing',
      `${contractedNoRate.length === 1 ? 'Falta cuánto le pagás a' : 'Falta cuánto les pagás a'} ${names}: sin ese valor su costo queda en $ 0. Si no trabaja en este servicio, quitá la línea.`);
    item.unreliable = true;
    item.focus = `contractedStaff.${contractedNoRate[0].index}.rate`;
    items.push(item);
  }
  const contractedNoHours = contracted.findIndex((c) => c.unit === 'hour' && nonNegative(c.people) > 0 && nonNegative(c.rate) > 0
    && !(nonNegative(c.hoursPerDay) > 0) && !(Math.min(nonNegative(activity.hoursPerActiveDay), 24) > 0));
  if (contractedNoHours >= 0 && !hoursMissing) {
    const item = rule('contracted_staff_hours', 'Horas del personal tercerizado', 'labor', 2, 'missing',
      `"${contractedNameOf(contracted[contractedNoHours])}" se paga por hora y faltan las horas por día: sin ellas su costo queda en $ 0.`);
    item.focus = `contractedStaff.${contractedNoHours}.hoursPerDay`;
    items.push(item);
  }

  // 4c. Nómina total menor que las personas en sitio (revisión de costos de la tanda B, B-1):
  // nadie puede estar en sitio sin estar en nómina; el costo fijo queda corto. Sólo con nómina cargada.
  const payrollShort = labor.map((l, index) => ({ l, index }))
    .filter(({ l }) => hasPayrollHeadcount(l) && nonNegative(l.positions) > 0 && nonNegative(l.payrollHeadcount) < nonNegative(l.positions) - 1e-9);
  if (payrollShort.length) {
    const { l, index } = payrollShort[0];
    const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
    const fmtN = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
    const others = payrollShort.length > 1 ? ` También: ${payrollShort.slice(1, 4).map((x) => `"${(typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal'}"`).join(', ')}.` : '';
    const item = rule('labor_payroll_below_positions', 'Nómina menor que en sitio', 'labor', 1, 'warning',
      `"${name}" tiene ${fmtN(nonNegative(l.positions))} en sitio a la vez y ${fmtN(nonNegative(l.payrollHeadcount))} en nómina: la nómina no puede ser menor que los que están en sitio. Los sueldos y cargas se calculan con ${fmtN(nonNegative(l.payrollHeadcount))} ${Math.abs(nonNegative(l.payrollHeadcount) - 1) < 1e-9 ? 'persona' : 'personas'} y el costo queda corto. Revisá "Personas en nómina". RATEOS no lo corrige solo.${others}`);
    item.focus = `labor.${index}.payrollHeadcount`;
    item.targets = payrollShort.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
    items.push(item);
  }

  // 5. Relevos (cobertura continua)
  const continuous = CONTINUOUS_SERVICE_TYPES.includes(serviceType) && (serviceType === 'permanent' || activity.availability === '24/7');
  // Guardia activa (2026-11): relevos con números (horas de guardia del mes vs horas normales).
  const activeGuard = labor.length > 0 ? activeGuardCoverage(quote) : null;
  const D0 = normalizeActivity(quote).activeDaysPerMonth;
  const passiveGuard = serviceType === 'on_call' && activity.guardType === 'passive';
  if (activeGuard) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const checks = labor.map((l, index) => ({ l, index, c: activeGuardLineCheck(activeGuard, l, D0) })).filter((x) => x.c);
    const short = checks.filter((x) => x.c.short);
    if (short.length) {
      const { l, index, c } = short[0];
      const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
      const others = short.length > 1 ? ` También: ${short.slice(1, 4).map((x) => `"${(typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal'}"`).join(', ')}.` : '';
      // Sin diagramas (2026-11): con "cantidad de personas" (1 por posición) se habla de personas.
      const simple = !hasPayrollHeadcount(l) && Math.abs(c.ppp - 1) < 1e-9;
      const item = rule('relief', 'Horas de guardia', 'labor', 1, 'warning', simple
        ? `Guardia activa: ${fmt(activeGuard.days)} días × ${fmt(c.hours)} h = ${fmt(c.required)} h por persona. "${name}" cubre ${fmt(c.covered)} h por persona: para cubrir ${fmt(c.required)} h hacen falta unas ${fmt(c.needed)} personas (más francos y vacaciones). Si las personas se turnan, cargá sus "Horas por día de cada persona" (por ejemplo 3 personas de 8 h para 24 h) y sumá personas; si no, cargá horas extra.${others}`
        : `Guardia activa: ${fmt(activeGuard.days)} días × ${fmt(c.hours)} h = ${fmt(c.required)} h por posición. "${name}" cubre ${fmt(c.covered)} h: hacen falta unas ${fmt(c.needed)} personas por posición (más francos y vacaciones). Sumá personas en nómina o horas extra.${others}`);
      item.focus = `labor.${index}.${hasPayrollHeadcount(l) ? 'payrollHeadcount' : simple ? 'coverageHoursPerDay' : 'peoplePerPosition'}`;
      item.targets = short.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
      items.push(item);
    } else if (checks.length) {
      items.push(rule('relief', 'Horas de guardia', 'labor', 1, 'ok', `Guardia activa: el personal cargado cubre las horas de guardia del mes.`));
    }
  } else if (continuous && passiveGuard && labor.length > 0) {
    items.push(rule('relief', 'Horas de guardia', 'labor', 1, 'ok', 'Guardia pasiva (localizable): no se cubre hora por hora; alcanza con rotar quién está de guardia.'));
  } else if (continuous && labor.length > 0) {
    // Con la nómina cargada como total (B-1), personas por posición = nómina ÷ posiciones.
    // Sin diagramas (2026-11): con "cantidad de personas" (1 por posición) se mira cuántas
    // personas hay y sus horas por día, no relevos por posición.
    const legacy = labor.filter((l) => !isSimpleStaff(l));
    const simple = labor.filter(isSimpleStaff);
    const legacyOk = legacy.every((l) => laborPeoplePerPositionOf(l) > 1);
    const alone = simple.find((l) => !(nonNegative(l.positions) > 1) && !(nonNegative(l.coverageHoursPerDay) > 0));
    const ok = legacyOk && !alone;
    const name = alone && ((typeof alone.role === 'string' && alone.role.trim()) || 'Personal');
    const item = rule('relief', 'Cobertura de todo el día', 'labor', 1, ok ? 'ok' : 'warning',
      ok ? 'Hay más de una persona para cubrir el servicio de todo el día.'
        : alone
          ? `Servicio de todo el día y todos los días con una sola persona en "${name}": nadie la reemplaza en francos ni vacaciones. Sumá los puestos que se turnen (cada uno con sus horas efectivas de trabajo) o cargá las horas extra.`
          : 'Cobertura 24/7 con una sola persona por posición: revisá relevos, francos y vacaciones.');
    // 0.19.0: con una persona "Cantidad" no se muestra: el aviso lleva a sus horas.
    if (alone) item.focus = `labor.${labor.indexOf(alone)}.${Math.abs(nonNegative(alone.positions) - 1) < 1e-9 ? 'coverageHoursPerDay' : 'positions'}`;
    items.push(item);
  }

  // 5 ter. Franja de guardia (2026-11): si cada día con llamado se trabajan más horas que la
  // franja, el excedente es fuera de horario. Sólo avisa: no cambia costo ni facturación.
  const overrun = serviceType === 'on_call' ? outsideWindowHours(quote) : null;
  if (overrun) {
    const item = rule('availability_window', 'Franja de guardia', 'margin', 1, 'warning', outsideWindowMessage(quote, overrun));
    // 0.24.0: la franja vive en "Detalle de la guardia" (El precio): el botón lleva a sus horas.
    item.focus = 'activity.availabilityHoursPerDay';
    items.push(item);
  }

  // 5 bis. Horas de cobertura de la operación vs horas cargadas del puesto (PLAN-2026-014,
  // LAB-D2). Control MENSUAL, sólo con datos cargados: horas por posición que pide la actividad
  // en el mes (días × horas por día) contra las que cubren las personas por posición (horas
  // normales por mes del puesto) y las horas extra cargadas. RATEOS no conoce la jornada diaria
  // de cada persona, así que el aviso no habla de jornada. Nunca se infieren horas extra,
  // turnos, relevos ni convenio, ni cambia el costo: sólo avisa (y la regla aparece únicamente
  // si falta cubrir horas).
  const act = normalizeActivity(quote);
  const D = act.activeDaysPerMonth;
  const H = act.hoursPerActiveDay;
  // Trabajo de más de un mes (D > días disponibles, tanda A 2026-11, A-5): las horas normales y
  // las extra por mes cubren tantos meses como el prorrateo de los fijos (monthsFactor).
  const mf = monthsFactor(D, act.availableDaysPerMonth);
  // "Horas por día que cubre este puesto" (opcional, A-5): un turno de 12 h en una actividad de
  // 24 h. Sólo lo usa este aviso; vacío = las horas por día de la actividad.
  // Tanda B (B-1): si el puesto tiene diagrama de rotación con "horas por turno" y este campo
  // está vacío, el aviso usa las horas por turno (entiende turnos sin otro dato).
  const coverageOf = (l) => {
    const c = Math.min(nonNegative(l.coverageHoursPerDay), 24);
    if (c > 0) return c;
    const shift = isPlainObject(l.rotation) ? Math.min(nonNegative(l.rotation.hoursPerShift), 24) : 0;
    return shift > 0 ? shift : H;
  };
  // Con guardia activa el control de relevos ya mide todas las horas de guardia (que incluyen
  // las trabajadas): no se repite el aviso de horas con los días con trabajo.
  // V-04: las horas por día del servicio pueden ser el dato equivocado (nacen en 10), no la gente.
  const hoursFix = (hours, own) => (own ? '' : ` Si el servicio no pide ${formatNumber(hours, { decimals: Math.abs(hours - Math.round(hours)) < 1e-9 ? 0 : 1 })} h por día, corregilo en "El servicio".`);
  // Horas extra del trabajo (M4, 2026-11-18): con "todo el trabajo" las horas que faltan ya se pagan
  // como hora extra (no hay aviso); con "algunas horas", esas horas también cubren.
  const ow = overtimeWorkOf(quote, { contractMode: contract.mode });
  const owHoursPerPerson = ow.mode === 'some'
    ? (ow.hours50 + ow.hours100) * (ow.perMonth ? mf : act.daysPerActivation > 0 ? D / act.daysPerActivation : D)
    : 0;
  // Por tiempo usado (§29): el costo sale de las horas del trabajo, no de la cobertura mensual del
  // sueldo; este control no aplica (queda el tope de horas por día por persona, abajo).
  const timeBasisHours = usesTimeBasis(quote);
  if (labor.length > 0 && D > 0 && !activeGuard && ow.mode !== 'all' && !timeBasisHours) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const short = labor.map((l, index) => {
      const normal = nonNegative(l.normalHoursPerMonth);
      const hours = coverageOf(l);
      if (!(nonNegative(l.positions) > 0) || !(normal > 0) || !(hours > 0)) return null;
      const ppp = laborPeoplePerPositionOf(l);
      const items = overtimeItemsOf(l);
      const perDay = items.filter((o) => o.basis === 'per_active_day').reduce((acc, o) => acc + o.hours, 0);
      const perMonth = items.filter((o) => o.basis === 'per_month').reduce((acc, o) => acc + o.hours, 0) + resourceOvertimeHoursOf(l);
      const required = D * hours;
      const covered = (ppp * normal + perMonth * ppp) * mf + perDay * D + owHoursPerPerson;
      return required > covered + 1e-6 ? { l, index, ppp, normal, hours, own: hours !== H, extra: perMonth * ppp * mf + perDay * D + owHoursPerPerson, required, covered } : null;
    }).filter(Boolean);
    if (short.length) {
      const first = short[0];
      const name = (typeof first.l.role === 'string' && first.l.role.trim()) || 'Personal';
      const months = mf > 1 + 1e-9 ? ` × ${fmt(mf)} meses` : '';
      const people = `${fmt(first.ppp)} ${Math.abs(first.ppp - 1) < 1e-9 ? 'persona' : 'personas'} × ${fmt(first.normal)} h normales por mes${months}${first.extra > 0 ? ` + ${fmt(first.extra)} h extra` : ''}`;
      const span = mf > 1 + 1e-9 ? ` (el trabajo dura más que los ${fmt(act.availableDaysPerMonth)} días disponibles del mes: las horas por mes cuentan ${fmt(mf)} meses)` : '';
      // Sin diagramas (2026-11): un diagrama guardado antes sigue aportando sus horas por turno
      // (no aparecen avisos nuevos en cotizaciones viejas); se nombra como dato anterior.
      const own = first.own ? (nonNegative(first.l.coverageHoursPerDay) > 0 ? ' (horas por día de cada persona)' : ' (horas por turno cargadas antes)') : '';
      const others = short.length > 1 ? ` También: ${short.slice(1, 4).map((x) => `"${(typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal'}"`).join(', ')}.` : '';
      const simple = !hasPayrollHeadcount(first.l) && Math.abs(first.ppp - 1) < 1e-9;
      const item = rule('labor_hours', 'Horas del personal', 'labor', 1, 'warning', simple
        ? `${LABOR_COVERAGE_MESSAGE} "${name}": ${fmt(D)} días × ${fmt(first.hours)} h${own} = ${fmt(first.required)} h por persona en el mes; cada persona cubre ${fmt(first.covered)} h (${fmt(first.normal)} h normales por mes${months}${first.extra > 0 ? ` + ${fmt(first.extra)} h extra` : ''})${span}. Faltan ${fmt(first.required - first.covered)} h por persona: si son horas extra, elegilas en "Horas extra del trabajo" (al final de "Personal"); si no, revisá las horas normales del puesto. Sumar personas sólo ayuda si se turnan: en ese caso bajá sus "Horas por día de cada persona". RATEOS no las agrega solo.${others}${hoursFix(first.hours, first.own)}`
        : `${LABOR_COVERAGE_MESSAGE} "${name}": ${fmt(D)} días × ${fmt(first.hours)} h${own} = ${fmt(first.required)} h de cobertura por posición en el mes; lo cargado cubre ${fmt(first.covered)} h (${people})${span}. Faltan ${fmt(first.required - first.covered)} h por posición: sumá personas por posición (turnos o relevos) o sumá posiciones (turno día / turno noche), elegí "Horas extra del trabajo" (al final de "Personal") o revisá las horas normales del puesto. Si el puesto cubre sólo una parte del día, cargá sus "Horas por día de cada persona". RATEOS no las agrega solo.${others}${hoursFix(first.hours, first.own)}`);
      item.focus = `labor.${first.index}.${hasPayrollHeadcount(first.l) ? 'payrollHeadcount' : simple ? 'coverageHoursPerDay' : 'peoplePerPosition'}`;
      item.targets = short.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
      items.push(item);
    }
  }

  // N5 (verificación 2026-11): con "todo el trabajo" las horas que faltan se pagan como hora
  // extra, pero hay un tope físico: si cada persona tendría que trabajar más de
  // MAX_HOURS_PER_PERSON_DAY h por día (p. ej. 1 persona 24 h por día), se avisa igual.
  if (labor.length > 0 && D > 0 && !activeGuard && (ow.mode === 'all' || timeBasisHours)) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const over = labor.map((l, index) => {
      const hours = coverageOf(l);
      const ppp = laborPeoplePerPositionOf(l);
      if (!(nonNegative(l.positions) > 0) || !(hours > 0) || !(ppp > 0)) return null;
      const perPerson = hours / ppp;
      return perPerson > MAX_HOURS_PER_PERSON_DAY + 1e-9 ? { l, index, hours, ppp, perPerson } : null;
    }).filter(Boolean);
    if (over.length) {
      const first = over[0];
      const name = (typeof first.l.role === 'string' && first.l.role.trim()) || 'Personal';
      const others = over.length > 1 ? ` También: ${over.slice(1, 4).map((x) => `"${(typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal'}"`).join(', ')}.` : '';
      const who = Math.abs(first.ppp - 1) < 1e-9 ? '1 persona' : `${fmt(first.ppp)} personas que se turnan`;
      const item = rule('labor_hours', 'Horas del personal', 'labor', 1, 'warning',
        `"${name}": ${fmt(first.hours)} h por día con ${who} son ${fmt(first.perPerson)} h por día por persona. ${ow.mode === 'all' ? 'Las horas extra de "todo el trabajo" se pagan, pero nadie' : 'Nadie'} trabaja más de ${MAX_HOURS_PER_PERSON_DAY} h por día todos los días: sumá personas que se turnen o bajá sus "Horas por día de cada persona". RATEOS no las agrega solo.${others}${hoursFix(first.hours, first.hours !== H)}`);
      item.focus = `labor.${first.index}.${hasPayrollHeadcount(first.l) ? 'payrollHeadcount' : isSimpleStaff(first.l) ? 'coverageHoursPerDay' : 'peoplePerPosition'}`;
      item.targets = over.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
      items.push(item);
    }
  }

  // 5 quater. Horas del día sin cubrir (2026-11, sin diagramas): con "Horas por día de cada
  // persona", personas × horas de cada una tiene que alcanzar las horas por día del servicio.
  // Sólo avisa (no cambia el costo). Con guardia activa lo mide su propio control.
  // 0.16.0: por tiempo usado (trabajo / hora / día) esas horas son las que cada persona dedica a
  // esta cotización (el chofer maneja 3 h de las 8 h): que no cubran el día no es un faltante.
  if (labor.length > 0 && H > 0 && !activeGuard && !timeBasisHours) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const gaps = labor.map((l, index) => {
      const c = Math.min(nonNegative(l.coverageHoursPerDay), 24);
      const n = nonNegative(l.positions);
      if (!isSimpleStaff(l) || !(c > 0) || !(n > 0) || n * c >= Math.min(H, 24) - 1e-6) return null;
      return { l, index, c, n, covered: n * c };
    }).filter(Boolean);
    if (gaps.length) {
      const g = gaps[0];
      const name = (typeof g.l.role === 'string' && g.l.role.trim()) || 'Personal';
      const missing = Math.min(H, 24) - g.covered;
      const more = Math.ceil(missing / g.c - 1e-9);
      const item = rule('labor_day_gap', 'Horas del día sin cubrir', 'labor', 1, 'warning',
        `"${name}": ${fmt(g.n)} ${Math.abs(g.n - 1) < 1e-9 ? 'persona' : 'personas'} × ${fmt(g.c)} h = ${fmt(g.covered)} h por día, y el servicio pide ${fmt(Math.min(H, 24))} h por día. Si el servicio necesita gente todas esas horas, faltan ${fmt(missing)} h por día: sumá ${fmt(more)} ${more === 1 ? 'persona' : 'personas'} de ${fmt(g.c)} h o subí sus horas efectivas de trabajo. Si no hace falta cubrir todas las horas, está bien así. No cambia el costo.${hoursFix(Math.min(H, 24), false)}`);
      item.focus = `labor.${g.index}.positions`;
      item.targets = gaps.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
      items.push(item);
    }
  }

  // 6. Costo de equipos (propios: reposición y vida útil; externos: tarifa)
  const isExt = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';
  const extOf = (e) => (isPlainObject(e.external) ? e.external : {});
  const needsEquipment = contract.legacy ? EQUIPMENT_SERVICE_TYPES.includes(serviceType) : contract.equipment;
  if (needsEquipment || equipment.length > 0) {
    // Cuáles líneas están incompletas (PLAN-2026-010): se nombran, nunca se ocultan.
    const ownMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => !isExt(e) && !(nonNegative(e.replacementValue) > 0 && nonNegative(e.usefulLifeYears) > 0));
    const extMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => isExt(e) && !(nonNegative(extOf(e).price) > 0));
    const ownOk = ownMissing.length === 0;
    const extOk = extMissing.length === 0;
    const ok = equipment.length > 0 && ownOk && extOk;
    const names = (list, fallback) => list.map(({ e }) => `"${(typeof e.name === 'string' && e.name.trim()) || fallback}"`).join(', ');
    // Componentes (PLAN-2026-021): si el único equipo del servicio es un vehículo y ya
    // está en "Movilización y viajes" con su costo por km, no falta: se avisa que ese
    // costo no incluye lo fijo del mes (amortización, seguro, patente).
    const comps = !contract.legacy && isPlainObject(quote.contract) && Array.isArray(quote.contract.components) ? quote.contract.components : null;
    const onlyVehicle = comps && comps.includes('vehicle') && !comps.includes('machinery') && !comps.includes('subcontract');
    const routeVehicleIndex = logistics.notApplicable || !(nonNegative(logistics.distanceKm) > 0) ? -1 : vehicles.findIndex((v) => nonNegative(v.count) > 0 && nonNegative(v.costPerKm) > 0);
    const routeVehicle = routeVehicleIndex >= 0 ? vehicles[routeVehicleIndex] : null;
    if (equipment.length === 0 && onlyVehicle && routeVehicle) {
      const item = rule('equipment_cost', 'Costo de equipos', 'equipment', 2, 'warning',
        `El vehículo está en "Movilización y viajes" (${(typeof routeVehicle.name === 'string' && routeVehicle.name.trim()) || 'Vehículo'}, costo por km): ese costo cubre los km, no lo fijo del mes (amortización, seguro, patente). Si el vehículo está afectado a este servicio, cargalo en Equipos y sacalo de Viajes para no contarlo dos veces.`);
      item.focus = `logistics.vehicles.${routeVehicleIndex}.costPerKm`;
      items.push(item);
    } else {
      const item = rule('equipment_cost', 'Costo de equipos', 'equipment', 2, ok ? 'ok' : 'missing',
        ok
          ? 'Equipos propios con valor de reposición y vida útil; externos con tarifa.'
          : equipment.length === 0
            ? 'El servicio usa equipos pero no hay equipos cargados.'
            : !ownOk
              ? `Hay equipos propios sin valor de reposición o sin vida útil (falta su amortización): ${names(ownMissing, 'Equipo')}.`
              : `Hay equipos alquilados o tercerizados sin tarifa del proveedor: ${names(extMissing, 'Recurso externo')}. Completá la tarifa o quitá la línea.`);
      item.targets = [...ownMissing, ...extMissing].map(({ e, index }) => ({ list: 'equipment', index, name: (typeof e.name === 'string' && e.name.trim()) || 'Equipo' }));
      // El botón lleva al dato que falta de la primera línea que nombra el mensaje (Test Lab, PLAN-2026-013).
      if (!ownOk) {
        const { e, index } = ownMissing[0];
        item.focus = `equipment.${index}.${nonNegative(e.replacementValue) > 0 ? 'usefulLifeYears' : 'replacementValue'}`;
      } else if (!extOk) {
        item.focus = `equipment.${extMissing[0].index}.external.price`;
      }
      items.push(item);
    }
  }

  // Ruta física (PLAN-2026-012): con la unidad "viaje" los viajes por
  // intervención se derivan de los viajes por día (igual que el motor).
  const route = routeTrips(quote, normalizeActivity(quote));
  const oneWayKm = logistics.notApplicable ? 0 : nonNegative(logistics.distanceKm);
  const routeKmPerActivation = oneWayKm * (logistics.roundTrip === false ? 1 : 2) * route.tripsPerActivation;
  const lineName = (e, fallback = 'Equipo') => (typeof e.name === 'string' && e.name.trim()) || fallback;

  // 7. Combustible: sólo lo que consume combustible A TU CARGO (PLAN-2026-012).
  // Un externo con el combustible incluido no necesita consumo; si lo provee
  // el cliente, no hay costo. Cada pendiente lleva al campo exacto (`focus`).
  const fuelUsers = [];
  equipment.forEach((e, i) => {
    // "No usa combustible" (PLAN-2026-014, LAB-D5): un dato explícito; consumo 0 sin marcar sigue siendo "falta".
    const noFuel = !isExt(e) && e.fuelNotApplicable === true;
    if (!isExt(e)) {
      if (!noFuel) fuelUsers.push({ name: lineName(e), consumes: nonNegative(e.fuelLitersPerHour) > 0, path: `equipment.${i}.fuelLitersPerHour` });
    } else if (extOf(e).fuelIncluded === false) {
      const x = extOf(e);
      const mode = externalFuelMode(x);
      if (mode === 'per_hour') {
        fuelUsers.push({ name: lineName(e, 'Externo'), consumes: nonNegative(x.fuelLitersPerHour) > 0, path: `equipment.${i}.external.fuelLitersPerHour` });
      } else {
        const value = mode === 'per_100km' ? x.fuelLitersPer100Km : x.fuelKmPerLiter;
        const loaded = nonNegative(value) > 0;
        fuelUsers.push({ name: lineName(e, 'Externo'), consumes: loaded && routeKmPerActivation > 0, noRoute: loaded && !(routeKmPerActivation > 0), path: `equipment.${i}.external.${mode === 'per_100km' ? 'fuelLitersPer100Km' : 'fuelKmPerLiter'}` });
      }
    }
    // Movilización por sus propios medios que paga combustible en ruta.
    const m = isPlainObject(e.mobilization) ? e.mobilization : {};
    const includedByProvider = isExt(e) && extOf(e).mobilizationIncluded === true;
    const paysRouteFuel = !isExt(e) || (extOf(e).fuelIncluded === false && externalFuelMode(extOf(e)) === 'per_hour');
    if (!logistics.notApplicable && m.mode === 'self' && !includedByProvider && paysRouteFuel && !noFuel) {
      // Un vehículo cargado con 0 h en la locación sólo gasta en ruta: el aviso lleva a ese campo.
      const onlyTravels = !isExt(e) && !isBlank(e.hoursPerActiveDay) && nonNegative(e.hoursPerActiveDay) === 0;
      fuelUsers.push({ name: lineName(e), consumes: nonNegative(m.travelLitersPer100Km) > 0, path: `equipment.${i}.mobilization.travelLitersPer100Km`, first: onlyTravels });
    }
  });
  if (!logistics.notApplicable) {
    vehicles.forEach((v, i) => {
      fuelUsers.push({ name: (typeof v.name === 'string' && v.name.trim()) || 'Vehículo', consumes: nonNegative(v.consumptionLPer100Km) > 0, path: `logistics.vehicles.${i}.consumptionLPer100Km` });
    });
  }
  const hasFuelUsers = equipment.length > 0 || (!logistics.notApplicable && vehicles.length > 0);
  if (hasFuelUsers) {
    let status = 'ok';
    let message = 'Combustible definido.';
    let focus = null;
    if (fuelUsers.length === 0) {
      message = 'No aplica: ningún equipo ni vehículo usa combustible a tu cargo (equipos que no usan combustible o externos con el combustible incluido en su tarifa).';
    } else if (!fuel.providedBy) {
      status = 'missing';
      message = 'Combustible sin responsable: definí si lo pagás vos o lo provee el cliente.';
      focus = 'fuel.providedBy';
    } else if (fuel.providedBy === 'client') {
      message = 'Lo provee el cliente: no se suma costo de combustible.';
    } else if (nonNegative(fuel.pricePerLiter) <= 0) {
      status = 'missing';
      message = 'Falta el precio del combustible.';
      focus = 'fuel.pricePerLiter';
    } else if (!fuelUsers.some((u) => u.consumes)) {
      status = 'missing';
      const routeless = fuelUsers.find((u) => u.noRoute);
      if (routeless && logistics.notApplicable) {
        message = `Marcaste "Sin traslados": sin km no se calcula el combustible por km de "${routeless.name}". Si el proveedor viaja, desmarcalo y cargá la distancia.`;
        focus = 'logistics.notApplicable';
      } else if (routeless && !(oneWayKm > 0)) {
        message = `Falta la distancia de la ruta: sin km no se calcula el combustible por km de "${routeless.name}".`;
        focus = 'logistics.distanceKm';
      } else if (routeless) {
        message = `No hay viajes en la cotización: sin km no se calcula el combustible por km de "${routeless.name}".`;
        focus = route.derived ? 'activity.unitsPerActiveDay' : 'logistics.tripsPerActivation';
      } else {
        const names = [...new Set(fuelUsers.map((u) => `"${u.name}"`))].slice(0, 3).join(', ');
        message = `Falta el consumo de combustible de ${names}: lo pagás vos y sin consumo no suma costo.`;
        focus = (fuelUsers.find((u) => u.first) || fuelUsers[0]).path;
      }
    } else if (fuel.illustrative === true) {
      // PLAN-2026-014 (LAB-D7): en una cotización real nueva el precio de ejemplo no cuenta como
      // definido hasta que se confirma o se reemplaza. Las anteriores y la demo: el aviso de siempre.
      const mustConfirm = fuel.requiresConfirmation === true && quote.illustrative !== true;
      status = mustConfirm ? 'missing' : 'warning';
      message = mustConfirm
        ? `El precio del combustible (${formatMoney(nonNegative(fuel.pricePerLiter))}/L, ${baseLabel(fuel.base)}) es un valor ILUSTRATIVO de ejemplo: confirmalo ("Es mi precio vigente") o cargá tu precio actual. Hasta entonces no se toma como definido.`
        : 'El precio del combustible es un valor ILUSTRATIVO por defecto: confirmalo con tu precio actual.';
      focus = 'fuel.pricePerLiter';
    }
    // El pendiente se muestra en el paso de su campo (el consumo de un equipo, también el de ruta, en Equipos).
    const step = focus && /^equipment\.\d+\./.test(focus) ? 'equipment' : 'logistics';
    const item = rule('fuel', 'Combustible', step, 2, status, message);
    if (focus) item.focus = focus;
    items.push(item);
  }

  // 8. Materiales y responsable
  if (quote.materialsNotApplicable) {
    items.push(rule('materials', 'Insumos y materiales', 'materials', 1, 'ok', 'Marcado como "El servicio no usa insumos ni materiales".'));
  } else if (materials.length === 0 && contractUsesMaterials(quote.contract) === false) {
    // Tanda novatos 2026-11: si en "¿Qué incluye?" no se marcó ningún material, no hay nada que confirmar.
    // Una cotización guardada con sólo "Otro gasto" en sus componentes (PLAN-2026-027): mismo estado
    // que antes, pero la casilla "Insumos y materiales" ahora se ve marcada.
    const onlyOther = componentsOf(quote.contract).includes('other');
    items.push(rule('materials', 'Insumos y materiales', 'materials', 1, 'ok', onlyOther
      ? 'No hay insumos ni materiales cargados (en "¿Qué incluye?" sólo estaban los otros gastos).'
      : 'El servicio no incluye insumos ni materiales (no se marcaron en "¿Qué incluye?").'));
  } else if (materials.length === 0) {
    items.push(rule('materials', 'Insumos y materiales', 'materials', 1, 'warning', 'No hay insumos ni materiales cargados: confirmá si el servicio no los usa.'));
  } else {
    const ok = materials.every((m) => Boolean(m.providedBy));
    // Un material que pagamos con precio y sin cantidad (o al revés) suma $ 0: se avisa (Test Lab, PLAN-2026-013).
    const paidByUs = (m) => MATERIAL_PROVIDERS.some((p) => p.id === m.providedBy && p.costForUs !== false);
    const isIncomplete = (m) => paidByUs(m) && (nonNegative(m.unitCost) > 0) !== (nonNegative(m.quantity) > 0);
    const incomplete = materials.map((m, index) => ({ m, index })).find(({ m }) => isIncomplete(m));
    const incompleteCount = materials.filter(isIncomplete).length;
    // Un material con cantidad y sin precio se nombra así (tanda novatos 2026-11): "Material sin precio".
    const label = !ok ? 'Responsable de materiales' : incomplete ? (nonNegative(incomplete.m.unitCost) > 0 ? 'Material sin cantidad' : 'Material sin precio') : 'Responsable de materiales';
    const item = rule('materials', label, 'materials', 2, !ok ? 'missing' : incomplete ? 'warning' : 'ok',
      !ok
        ? 'Hay materiales sin definir quién los provee (cliente, nosotros o tercero).'
        : incomplete
          ? `"${(typeof incomplete.m.description === 'string' && incomplete.m.description.trim()) || 'Material'}"${incompleteCount > 1 ? ` (y ${incompleteCount - 1} más)` : ''} tiene ${nonNegative(incomplete.m.unitCost) > 0 ? (emptyValue(incomplete.m.quantity) ? 'precio y falta la cantidad' : 'precio pero cantidad 0') : 'cantidad pero precio 0'}: no suma costo. Completalo o quitá la línea.`
          : 'Todos los materiales tienen responsable.');
    if (ok && incomplete) {
      item.focus = `materials.${incomplete.index}.${nonNegative(incomplete.m.unitCost) > 0 ? 'quantity' : 'unitCost'}`;
      item.targets = [{ list: 'materials', index: incomplete.index, name: incomplete.m.description || 'Material' }];
    }
    items.push(item);
    // Por unidad producida (PLAN-2026-021): sin producción por día el consumo suma $ 0.
    const autoOut = autoOutputPerActiveDay(normalizeActivity(quote));
    const noOutput = materials.map((m, index) => ({ m, index })).filter(({ m }) => normalizeBasisId(m.basis) === 'per_output' && paidByUs(m)
      && nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0 && !(outputPerActiveDayOf(m, autoOut, unit) > 0));
    if (noOutput.length) {
      const first = noOutput[0];
      // V-07: si la línea produce en la unidad de cobro, el rendimiento se carga una sola vez, en el paso 1.
      const followsBilling = unit.kind === 'quantity' && outputMatchesBilling(first.m, unit);
      const out = rule('materials_output', 'Producción por día', 'materials', 2, 'missing',
        `"${(typeof first.m.description === 'string' && first.m.description.trim()) || 'Material'}" se consume por unidad producida y falta cuántas se producen por día de trabajo: ${followsBilling ? 'cargalo en "El servicio".' : 'hasta cargarlo no suma costo.'}`);
      out.focus = followsBilling ? 'activity.unitsPerActiveDay' : `materials.${first.index}.outputPerActiveDay`;
      out.targets = noOutput.map(({ m, index }) => ({ list: 'materials', index, name: m.description || 'Material' }));
      items.push(out);
    }
    // V-07: insumos "por unidad producida" con el rendimiento pedido dos veces o contando 1 por día sin decirlo.
    const outputLines = materials.map((m, index) => ({ m, index })).filter(({ m }) => normalizeBasisId(m.basis) === 'per_output' && paidByUs(m)
      && nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0);
    const nameOf = (m) => (typeof m.description === 'string' && m.description.trim()) || 'Material';
    const fmtOut = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
    const billedPerDay = nonNegative(activity.unitsPerActiveDay);
    const mismatch = unit.kind === 'quantity' && billedPerDay > 0
      ? outputLines.filter(({ m }) => nonNegative(m.outputPerActiveDay) > 0 && outputMatchesBilling(m, unit)
        && Math.abs(nonNegative(m.outputPerActiveDay) - billedPerDay) > 1e-9)
      : [];
    if (mismatch.length) {
      const first = mismatch[0];
      const item = rule('materials_output_mismatch', 'Producción por día', 'materials', 1, 'warning',
        `"${nameOf(first.m)}" usa ${fmtOut(nonNegative(first.m.outputPerActiveDay))} ${unit.plural} por día y en "El servicio" cargaste ${fmtOut(billedPerDay)}. Dejá un solo número: borrá el de acá para que siga al otro.`);
      item.focus = `materials.${first.index}.outputPerActiveDay`;
      item.targets = mismatch.map(({ m, index }) => ({ list: 'materials', index, name: m.description || 'Material' }));
      items.push(item);
    }
    const noUnit = unit.kind === 'day' || unit.kind === 'hour'
      ? outputLines.filter(({ m }) => !String(m.outputUnit || '').trim() && !(nonNegative(m.outputPerActiveDay) > 0))
      : [];
    if (noUnit.length && autoOut > 0) {
      const first = noUnit[0];
      const item = rule('materials_output_unit', 'Unidad producida', 'materials', 1, 'warning',
        `"${nameOf(first.m)}" está por unidad producida y cobrás por ${unit.kind === 'day' ? 'día' : 'hora'}: se cuenta ${fmtOut(autoOut)} por día. Si es por hectárea, válvula o metro, escribí la unidad y cuántas hacés por día.`);
      item.focus = `materials.${first.index}.outputUnit`;
      item.targets = noUnit.map(({ m, index }) => ({ list: 'materials', index, name: m.description || 'Material' }));
      items.push(item);
    }
  }

  // 9. Logística: ruta + cómo se llega (equipos que se movilizan o vehículos auxiliares)
  if (logistics.notApplicable) {
    items.push(rule('logistics', 'Viajes', 'logistics', 1, 'ok', 'Marcado como "sin traslados".'));
  } else if (travelNotNeeded(quote)) {
    // Revisión UX tanda novatos: sin "Viáticos y alojamiento" en "¿Qué incluye?" y sin nada que
    // viaje, la ruta vacía ya suma $ 0: la distancia no es un dato que falte.
    items.push(rule('logistics', 'Viajes', 'logistics', 1, 'ok', 'El servicio no incluye viajes (no se marcó "Viajes" en "¿Qué incluye?").'));
  } else {
    const moves = vehicles.some((v) => nonNegative(v.count) > 0)
      || equipment.some((e) => isPlainObject(e.mobilization) && ['self', 'transported', 'support'].includes(e.mobilization.mode))
      || equipment.some((e) => isExt(e) && extOf(e).mobilizationIncluded === true);
    const ok = nonNegative(logistics.distanceKm) > 0 && moves;
    items.push(rule('logistics', 'Viajes', 'logistics', 2, ok ? 'ok' : 'missing',
      ok ? 'Distancia y movilización definidas.' : nonNegative(logistics.distanceKm) > 0 ? 'Falta definir cómo llegan los equipos o el personal a la locación: en Equipos, cargá el vehículo o equipo y elegí cómo llega.' : 'Falta la distancia a la locación.'));
  }

  // 9b. Movilización de cada equipo (¿cómo llega al lugar del servicio?)
  if (logistics.notApplicable && equipment.length > 0) {
    // "Sin traslados" y un equipo que dice que viaja: dos datos incompatibles (Test Lab, PLAN-2026-013).
    const travelling = equipment.filter((e) => isPlainObject(e.mobilization) && ['self', 'support'].includes(e.mobilization.mode) && !(isExt(e) && extOf(e).mobilizationIncluded === true));
    if (travelling.length) {
      const names = travelling.slice(0, 3).map((x) => `"${lineName(x)}"`).join(', ');
      const item = rule('mobility', 'Movilización de equipos', 'logistics', 1, 'warning',
        `Marcaste "Sin traslados" pero ${names} ${travelling.length === 1 ? 'figura' : 'figuran'} viajando desde la base (por sus propios medios o con un vehículo de apoyo): esa movilización no se suma. Si viaja, desmarcá "Sin traslados" y cargá la distancia; si ya está en la locación, elegí "No requiere movilización".`);
      item.focus = 'logistics.notApplicable';
      item.targets = travelling.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e) }));
      items.push(item);
    }
  }
  if (!logistics.notApplicable && equipment.length > 0) {
    const mob = computeMobilization(equipment, { notApplicable: false, routeKmPerActivation: nonNegative(logistics.distanceKm), vehicles, labor });
    const pending = equipment.filter((e) => !(isExt(e) && extOf(e).mobilizationIncluded === true) && !(isPlainObject(e.mobilization) && e.mobilization.mode));
    const broken = mob.lines.filter((l) => l.warnings.some((w) => ['carrier_missing', 'carrier_cycle', 'support_missing'].includes(w)));
    // Consumo en ruta faltante (A-14): sólo si ese combustible lo pagás vos (igual que la regla de
    // combustible); el motor ya lo marca en la línea, acá se suma a la completitud.
    const paysRouteFuelAt = (idx) => {
      const e = equipment[idx];
      return !isExt(e) || (extOf(e).fuelIncluded === false && externalFuelMode(extOf(e)) === 'per_hour');
    };
    const noConsumption = fuel.providedBy === 'client' ? [] : mob.lines.map((l, idx) => ({ l, idx })).filter(({ l, idx }) => l.warnings.includes('travel_consumption') && paysRouteFuelAt(idx));
    // Remolque con neumáticos por km que "lo transporta otro equipo" y no está marcado como
    // enganchado (A-3): su desgaste por km queda afuera. Nunca se marca solo.
    const untowed = mob.lines.map((l, idx) => ({ l, idx })).filter(({ l }) => l.mode === 'transported' && !l.towedChosen && !l.includedByProvider && l.tiresPerKm > 0);
    const ok = pending.length === 0 && broken.length === 0 && noConsumption.length === 0 && untowed.length === 0;
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Equipo'}"`).join(', ');
    // Cómo llega cada equipo se carga en su tarjeta de Equipos (un equipo, un solo lugar).
    const item = rule('mobility', 'Movilización de equipos', 'equipment', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Cada equipo tiene definido cómo llega al lugar del servicio.'
        : pending.length
          ? `Falta definir cómo llega al lugar del servicio: ${names(pending)}.`
          : broken.length
            ? `Revisá qué equipo o vehículo transporta a ${names(broken)}.`
            : noConsumption.length
              ? `Falta el consumo en ruta de ${names(noConsumption.map(({ l }) => l))}: el combustible del traslado queda en 0. Cargá los L/100 km en ruta o, si no usa combustible, marcalo en Equipos.`
              : `${names(untowed.map(({ l }) => l))} ${untowed.length === 1 ? 'tiene' : 'tienen'} neumáticos por km y lo transporta otro equipo: si va enganchado y rueda (remolque, carretón o batea), elegí "Va enganchado y rueda" para sumar su desgaste por km; si va cargado arriba, elegí "Va cargado arriba".`);
    if (!ok && !pending.length && !broken.length) {
      if (noConsumption.length) {
        item.focus = `equipment.${noConsumption[0].idx}.mobilization.travelLitersPer100Km`;
        item.targets = noConsumption.map(({ l, idx }) => ({ list: 'equipment', index: idx, name: l.name || 'Equipo' }));
      } else {
        item.focus = `equipment.${untowed[0].idx}.mobilization.towed`;
        item.targets = untowed.map(({ l, idx }) => ({ list: 'equipment', index: idx, name: l.name || 'Equipo' }));
      }
    }
    items.push(item);
  }

  // 9c. Equipos y servicios externos: tratamiento fiscal y vigencia de la oferta
  const externals = equipment.filter(isExt);
  if (externals.length > 0) {
    const offerDay = typeof quote.offerDate === 'string' ? quote.offerDate : null;
    const fiscalMissing = externals.filter((e) => {
      const f = externalFiscal(extOf(e).fiscal);
      return f.missingVatRate || f.missingPartialPct;
    });
    const recoveryUndefined = externals.filter((e) => externalFiscal(extOf(e).fiscal).recovery === null);
    const noValidity = externals.filter((e) => !extOf(e).validUntil);
    const expired = externals.filter((e) => extOf(e).validUntil && offerDay && extOf(e).validUntil < offerDay);
    // Qué incluye la tarifa: sin definir el combustible o el operador no se suma nada (puede faltar costo).
    const inclusionsUndefined = externals.filter((e) => typeof extOf(e).fuelIncluded !== 'boolean' || typeof extOf(e).operatorIncluded !== 'boolean');
    // Global: se reparte en los meses de contrato (sin dato se toma 1 mes).
    const globalNoContract = contractOf(quote).mode === 'closed' ? [] : externals.filter((e) => extOf(e).unit === 'global' && !(nonNegative(quote.contractMonths) >= 1));
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Externo'}"`).join(', ');
    let status = 'ok';
    let message = 'Recursos externos con tratamiento fiscal y vigencia definidos.';
    if (fiscalMissing.length) {
      status = 'missing';
      message = `Falta la alícuota de IVA (o la parte recuperable) de ${names(fiscalMissing)}: sin ese dato no se puede calcular el IVA que no recuperás.`;
    } else if (recoveryUndefined.length) {
      status = 'warning';
      message = `Sin definir si el IVA de ${names(recoveryUndefined)} es recuperable: RATEOS usa el precio neto (sin IVA). Si no lo recuperás, el costo es mayor.`;
    } else if (inclusionsUndefined.length) {
      status = 'warning';
      message = `Sin definir si la tarifa de ${names(inclusionsUndefined)} incluye combustible u operador: si no lo incluye y no lo cargás, falta costo.`;
    } else if (globalNoContract.length) {
      status = 'warning';
      message = `La tarifa global de ${names(globalNoContract)} se reparte en los meses de contrato: cargá la duración del contrato (sin ese dato se toma todo en 1 mes).`;
    } else if (expired.length) {
      status = 'warning';
      message = `La oferta de ${names(expired)} venció antes de la fecha de esta cotización: pedí un precio vigente.`;
    } else if (noValidity.length) {
      status = 'warning';
      message = `Sin vigencia de la oferta del proveedor: ${names(noValidity)}.`;
    }
    items.push(rule('external_terms', 'Equipos y servicios externos', 'equipment', 1, status, message));

    // 9c'. Externo por km o por viaje sin ruta (PLAN-2026-012): CRÍTICO. Su
    // tarifa no se puede calcular (no es un $ 0 válido): nunca pasa en silencio.
    const legs = (logistics.roundTrip === false ? 1 : 2) * route.tripsPerActivation;
    const routeless = externals.filter((e) => {
      const x = extOf(e);
      if (!(x.unit === 'km' || x.unit === 'trip') || nonNegative(x.price) <= 0 || nonNegative(x.minimumUnits) > 0) return false;
      return x.unit === 'km' ? !(routeKmPerActivation > 0) : !(legs > 0);
    });
    if (routeless.length) {
      const routeFocus = logistics.notApplicable
        ? 'logistics.notApplicable'
        : !(oneWayKm > 0)
          ? 'logistics.distanceKm'
          : route.derived ? 'activity.unitsPerActiveDay' : 'logistics.tripsPerActivation';
      const item = rule('external_route', 'Ruta del proveedor', routeFocus.startsWith('activity.') ? 'service' : 'logistics', 2, 'missing',
        `Falta definir la ruta/distancia para calcular este proveedor: ${names(routeless)} (tarifa por ${extOf(routeless[0]).unit === 'km' ? 'km' : 'viaje'}). ${logistics.notApplicable ? 'Marcaste "Sin traslados".' : !(oneWayKm > 0) ? 'Cargá la distancia de ida en "Movilización y viajes".' : 'No hay viajes en la cotización.'} Hasta entonces no suma costo.`);
      item.focus = routeFocus;
      item.targets = routeless.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
      items.push(item);
    }

    // 9c'. Externo "por salida" cuando cada salida tiene VARIOS viajes (ECO-01, H-01): la tarifa
    // se cobra una vez por salida, no por viaje. Si en realidad es por viaje, el costo queda corto.
    // CRÍTICO (no confiable) hasta elegir la unidad o confirmarla; la confirmación vale sólo para
    // el supuesto confirmado (`externalUnitAssumption`). No cambia la fórmula. Con un viaje por
    // salida no hay ambigüedad.
    // Decisión del dueño (tanda B 2026-11, H-04): baja a aviso común (warning: ni crítico ni "no
    // confiable") cuando lo habitual es que el proveedor vaya UNA vez y los viajes sean de otros:
    //   (a) su movilización está incluida en la tarifa por salida, o
    //   (b) los viajes de la ruta los hacen vehículos propios (logística auxiliar o un equipo
    //       propio que va por sus medios) y el externo no va por sus propios medios (dicho:
    //       transportado, en vehículo de apoyo o sin movilización; sin dato, crítico).
    // Si alguna línea no cumple (a) ni (b), queda crítico como siempre.
    const tripsPerActivation = logistics.notApplicable ? 0 : route.tripsPerActivation;
    const perActivation = tripsPerActivation > 1 + 1e-9
      ? externals
        .filter((e) => extOf(e).unit === 'activation' && nonNegative(extOf(e).price) > 0 && nonNegative(e.quantity) > 0)
        .map((e) => ({ e, changes: assumptionChanges(e.externalUnitConfirmed, externalUnitAssumption(quote, e)) }))
        .filter(({ changes }) => changes === null || changes.length > 0)
      : [];
    const ownRouteVehicles = (objectList(logistics.vehicles).some((v) => nonNegative(v.count) > 0))
      || equipment.some((e) => !isExt(e) && nonNegative(e.quantity) > 0 && isPlainObject(e.mobilization) && e.mobilization.mode === 'self');
    // (b) exige que se haya dicho cómo llega el externo y que NO sea por sus medios (transportado,
    // en un vehículo de apoyo o sin movilización). Sin dato no se supone: un flete o una grúa
    // tercerizada suele ir por sus medios y es justo el caso de ECO-01 (revisión de costos de la tanda B).
    const notSelf = (e) => isPlainObject(e.mobilization) && ['transported', 'support', 'none'].includes(e.mobilization.mode);
    const goesOnce = ({ e }) => extOf(e).mobilizationIncluded === true
      || (ownRouteVehicles && notSelf(e));
    const soft = perActivation.length > 0 && perActivation.every(goesOnce);
    if (perActivation.length) {
      const { e: first, changes } = perActivation[0];
      const price = nonNegative(extOf(first).price);
      const A = act.activationsPerMonth;
      const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
      const tripWord = (v) => (Math.abs(v - 1) < 1e-9 ? 'viaje' : 'viajes');
      const legs = logistics.roundTrip === false ? '' : ' (ida y vuelta)';
      const month = A > 0 ? ` Con ${n(A)} ${T.word(A)} por mes son ${n(A * tripsPerActivation)} ${tripWord(A * tripsPerActivation)}, pero se ${A === 1 ? 'paga' : 'pagan'} ${n(A)} ${A === 1 ? 'vez' : 'veces'} ${formatMoney(price)}.` : '';
      const changed = { price: 'la tarifa', trips: `los viajes ${T.per}`, distance: 'la distancia', roundTrip: 'ida y vuelta / sólo ida' };
      const stale = changes && changes.length ? `La confirmación anterior ("cobra ${T.per}") ya no vale: cambió ${changes.map((c) => changed[c]).join(', ')}. ` : '';
      const others = perActivation.length > 1 ? ` También: ${perActivation.slice(1, 4).map(({ e }) => `"${lineName(e, 'Externo')}"`).join(', ')}.` : '';
      const why = !soft ? '' : extOf(first).mobilizationIncluded === true
        ? ` Su movilización está incluida: lo habitual es que vaya una sola vez ${T.per} y que los otros viajes sean de tus vehículos.`
        : ` Los viajes de la ruta los hacen tus vehículos: lo habitual es que el proveedor vaya una sola vez ${T.per}.`;
      const item = rule('external_unit_trips', 'Unidad del proveedor', 'equipment', 2, soft ? 'warning' : 'missing',
        `${stale}"${lineName(first, 'Externo')}" cobra ${formatMoney(price)} ${T.per} y cada ${T.one} tiene ${n(tripsPerActivation)} ${tripWord(tripsPerActivation)}${legs}.${month} Equivale a ${formatMoney(price / tripsPerActivation)} por viaje.${why} Si el proveedor cobra ${formatMoney(price)} por cada viaje, elegí "Por viaje completo (ida y vuelta)" (o "Por tramo" si cobra cada ida o cada vuelta); si cobra ${T.per}, confirmalo.${soft ? ' Revisalo: si cobra por viaje, el costo queda corto.' : ' Hasta entonces el resultado no es confiable.'}${others}`);
      if (!soft) item.unreliable = true;
      item.focus = `equipment.${equipment.indexOf(first)}.external.unit`;
      item.targets = perActivation.map(({ e }) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
      items.push(item);
    }
  }

  // 9c''. Externo por hora sin horas por día (Test Lab, PLAN-2026-013): CRÍTICO, igual que la
  // ruta faltante. Su tarifa no se puede calcular: nunca es un $ 0 válido.
  const activityHours = Math.min(nonNegative(activity.hoursPerActiveDay), 24);
  const hourless = equipment.filter((e) => {
    if (!isExt(e)) return false;
    const x = extOf(e);
    if (x.unit !== 'hour' || !(nonNegative(x.price) > 0) || nonNegative(x.minimumUnits) > 0 || !(nonNegative(e.quantity) > 0)) return false;
    const hours = isBlank(e.hoursPerActiveDay) ? activityHours : nonNegative(e.hoursPerActiveDay);
    return !(hours > 0);
  });
  if (hourless.length) {
    const first = hourless[0];
    const inherits = isBlank(first.hoursPerActiveDay);
    const names = hourless.slice(0, 3).map((x) => `"${lineName(x, 'Externo')}"`).join(', ');
    const item = rule('external_hours', 'Horas del proveedor', inherits ? 'service' : 'equipment', 2, 'missing',
      `Falta cuántas horas por día trabaja ${names} (tarifa por hora): sin horas no suma costo. ${inherits ? `Cargá "${activityHoursLabel}" en "El servicio" o sus "Horas de uso por día de trabajo" en "Equipos".` : 'Cargá sus "Horas de uso por día de trabajo" en "Equipos".'}`);
    item.focus = inherits ? 'activity.hoursPerActiveDay' : `equipment.${equipment.indexOf(first)}.hoursPerActiveDay`;
    item.targets = hourless.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
    items.push(item);
  }

  // 6 bis. Seguro y patente de un vehículo propio (V-06): sólo los que circulan ("se traslada
  // por sus propios medios"), con valor de reposición y los dos en 0. Un generador o una
  // herramienta sin seguro es normal: no se pregunta.
  {
    const uninsured = equipment.map((e, index) => ({ e, index })).filter(({ e }) => !isExt(e)
      && isPlainObject(e.mobilization) && e.mobilization.mode === 'self'
      && nonNegative(e.quantity) > 0 && nonNegative(e.replacementValue) > 0
      && !(nonNegative(e.insuranceAnnual) > 0) && !(nonNegative(e.licenseAnnual) > 0));
    if (uninsured.length) {
      const first = uninsured[0];
      const others = uninsured.length > 1 ? ` También: ${uninsured.slice(1, 4).map(({ e }) => `"${lineName(e)}"`).join(', ')}.` : '';
      const item = rule('equipment_insurance', 'Seguro y patente', 'equipment', 1, 'warning',
        `"${lineName(first.e)}" no tiene seguro ni patente cargados. Si los pagás, cargalos: son costo aunque no trabaje.${others}`);
      item.focus = `equipment.${first.index}.insuranceAnnual`;
      item.targets = uninsured.map(({ e, index }) => ({ list: 'equipment', index, name: lineName(e) }));
      items.push(item);
    }
  }

  // 9c''ter. % de dedicación viejo (V-11): el % cargado en una línea compartida ya no coincide
  // con los días y las horas de ahora (más de 5 puntos). No se recalcula solo: se avisa.
  if (contract.mode !== 'monthly' && !usesTimeBasis(quote)) {
    const stale = staleDedicationOf(quote, { activeDaysPerMonth: D, hoursPerActiveDay: H });
    if (stale) {
      // 0.24.0: el % se cambia en cada línea (Personal o Equipos), no en una tarjeta general.
      const item = rule('dedication_stale', 'Dedicación de tu gente y tus equipos', stale.kind === 'equipment' ? 'equipment' : 'labor', 1, 'warning', staleDedicationMessage(stale));
      item.focus = `${stale.kind}.${stale.index}.fixedCostSharePct`;
      items.push(item);
    }
  }

  // 9c''bis. Horas de trabajo por día (V-04): con las horas vacías o en 0, un equipo propio con
  // costo por hora (combustible, mantenimiento, neumáticos) y sin horas propias no suma su uso, y
  // cobrando por cantidad nadie lo avisaba. Los externos por hora ya tienen su control
  // ("Horas del proveedor"); acá entran sólo los que ese control no mira (con mínimo facturable).
  if (!(activityHours > 0)) {
    const fuelPaidByUs = fuel.providedBy !== 'client';
    const idle = equipment.filter((e) => {
      if (!(nonNegative(e.quantity) > 0) || !isBlank(e.hoursPerActiveDay)) return false;
      if (isExt(e)) return extOf(e).unit === 'hour' && nonNegative(extOf(e).price) > 0 && !hourless.includes(e);
      // 0.18.0: con horas propias en el trabajo (por tiempo usado) el uso ya se suma con ésas.
      if (usesTimeBasis(quote) && nonNegative(e.assignedHoursPerDay) > 0) return false;
      // Con 1 h por día: ¿el equipo tiene algún costo que dependa de las horas?
      return computeEquipmentLine(e, { fuelPricePerLiter: nonNegative(fuel.pricePerLiter), fuelPaidByUs, defaultHoursPerActiveDay: 1 }).variablePerActiveDay > 0;
    });
    if (idle.length) {
      const names = idle.slice(0, 3).map((x) => `"${lineName(x, 'Equipo')}"`).join(', ');
      const item = rule('equipment_hours', 'Horas de trabajo por día', 'service', 1, 'missing',
        `Faltan las horas de trabajo por día: sin ese dato no se suma el uso de ${names}.`);
      item.focus = 'activity.hoursPerActiveDay';
      item.targets = idle.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Equipo') }));
      items.push(item);
    }
  }

  // 9c'''. Unidades que recorren la ruta (viaje, km) y la ruta de la cotización (Test Lab, PLAN-2026-013).
  // "Sin traslados" con viajes vendidos, o más km facturados que los que recorre la ruta (los costos
  // por km quedarían cortos): dos datos que describen realidades incompatibles. Se avisa (no se deriva:
  // ver PLANS.md). Una ruta con MÁS km que los facturados (vuelta vacía) no se avisa: es lo físico.
  if (unit.id === 'trip' || unit.id === 'km') {
    const billed = nonNegative(activity.billableQuantityPerMonth);
    const normalized = normalizeActivity(quote);
    const activations = normalized.activationsPerMonth;
    const routeKmPerMonth = activations * routeKmPerActivation;
    // V-13: cuando rige el mínimo por llamado, parte de los km facturados no se recorren (se
    // cobran de mínimo). La ruta se compara con los km TRABAJADOS: llamados × días × km por día.
    const workedPerActivation = normalized.daysPerActivation * nonNegative(normalized.unitsPerActiveDay);
    const minimumRules = nonNegative(rules.minimumCallUnits) > workedPerActivation + 1e-9 && workedPerActivation > 0;
    const traveled = unit.id === 'km' && minimumRules ? Math.min(billed, activations * workedPerActivation) : billed;
    const fmtN = (n) => formatNumber(n, { decimals: 2 });
    let message = null;
    let focus = null;
    if (logistics.notApplicable && billed > 0) {
      message = `Cobrás por ${unit.plural} pero marcaste "Sin traslados": los ${unit.plural} que vendés no tienen ${unit.id === 'km' ? '' : 'km ni '}costos de ruta (combustible, desgaste, peajes, proveedores por km). Si hay viajes, desmarcalo y cargá la ruta.`;
      focus = 'logistics.notApplicable';
    } else if (unit.id === 'km' && billed > 0 && oneWayKm > 0 && traveled - routeKmPerMonth > Math.max(1, traveled * 0.01)) {
      message = `${minimumRules ? `Hacés ${fmtN(traveled)}` : `Facturás ${fmtN(billed)}`} km por mes pero la ruta recorre ${fmtN(routeKmPerMonth)} km (${fmtN(activations)} ${T.word(activations)} × ${fmtN(route.tripsPerActivation)} ${route.tripsPerActivation === 1 ? 'viaje' : 'viajes'} × ${fmtN(oneWayKm * (logistics.roundTrip === false ? 1 : 2))} km por viaje): los costos por km (proveedor, combustible, desgaste) se calculan con los km de la ruta y quedan cortos si el equipo recorre los km que facturás. Ajustá "${L.tripsPerActivation}" o la distancia.`;
      focus = 'logistics.tripsPerActivation';
    }
    if (message) {
      const item = rule('route_consistency', 'Viajes y km de la ruta', 'logistics', 1, 'warning', message);
      item.focus = focus;
      items.push(item);
    }
  }

  // 9d. Posible doble conteo (operador o vehículo cargado dos veces)
  if (equipment.length > 0) {
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const operatorTwice = equipment.filter((e) => isExt(e) && extOf(e).operatorIncluded === true && typeof e.operatorLaborId === 'string' && labor.some((l) => l.id === e.operatorLaborId));
    const selfMoving = equipment.filter((e) => isPlainObject(e.mobilization) && e.mobilization.mode === 'self');
    const vehicleTwice = logistics.notApplicable ? [] : selfMoving.filter((e) => {
      const n = norm(e.name);
      return n.length >= 4 && vehicles.some((v) => {
        const vn = norm(v.name);
        return vn.length >= 4 && (vn.includes(n) || n.includes(vn));
      });
    });
    // Un externo cuya movilización cobra el proveedor aparte y que además "va por sus propios medios".
    const mobilizationTwice = logistics.notApplicable ? [] : selfMoving.filter((e) => isExt(e) && extOf(e).mobilizationIncluded === false && nonNegative(extOf(e).mobilizationAmount) > 0);
    const ok = operatorTwice.length === 0 && vehicleTwice.length === 0 && mobilizationTwice.length === 0;
    items.push(rule('duplicates', 'Costos posiblemente duplicados', 'logistics', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Sin señales de operadores, vehículos o movilizaciones cargados dos veces.'
        : operatorTwice.length
          ? `Operador posiblemente duplicado: la tarifa de "${operatorTwice[0].name || 'Externo'}" ya incluye operador y además le asignaste uno de Personal.`
          : vehicleTwice.length
            ? `Posible doble conteo: "${vehicleTwice[0].name || 'Equipo'}" se moviliza por sus propios medios y también está en "Vehículos por km (cargados antes)": quitalo de ahí.`
            : `Movilización posiblemente duplicada: el proveedor de "${mobilizationTwice[0].name || 'Externo'}" cobra la movilización aparte y además lo marcaste "por sus propios medios" (se suman km, combustible y desgaste).`));
  }

  // 9d bis. Personal ↔ logística / materiales: el mismo costo en dos lugares (PLAN-2026-024).
  // Sólo señales con datos de los dos lados (nunca se descuenta nada): comidas en el puesto y en
  // los viáticos, traslado del puesto y vehículos de la logística, EPP del puesto y EPP en
  // materiales. Aparece sólo si hay una señal (sin ítem "ok": no cambia otras cotizaciones).
  {
    const normTxt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const staffed = labor.filter((l) => nonNegative(l.positions) > 0);
    const roleOf = (l) => (typeof l.role === 'string' && l.role.trim()) || 'Puesto';
    const hints = [];
    const lodgingDetail = isPlainObject(logistics.lodgingDetail) ? logistics.lodgingDetail : null;
    const mealsInTravel = !logistics.notApplicable && lodgingDetail && nonNegative(lodgingDetail.perDay) > 0 && nonNegative(lodgingDetail.days) > 0 && nonNegative(logistics.lodgingPerActivation) > 0;
    const mealLine = staffed.find((l) => nonNegative(l.mealPerActiveDay) > 0);
    if (mealsInTravel && mealLine) hints.push({ focus: `labor.${labor.indexOf(mealLine)}.mealPerActiveDay`, text: `"${roleOf(mealLine)}" tiene vianda por día y los viáticos de "Viajes" también suman comidas por día: si son las mismas, dejá una sola.` });
    const transferLine = staffed.find((l) => nonNegative(l.transferMonthly) > 0);
    if (transferLine && !logistics.notApplicable && vehicles.length > 0) hints.push({ focus: `labor.${labor.indexOf(transferLine)}.transferMonthly`, text: `"${roleOf(transferLine)}" tiene pasajes o traslado por mes y además hay vehículos por km en "Viajes": si es el que lleva al personal, el traslado del puesto se cuenta dos veces.` });
    const ppeLine = staffed.find((l) => nonNegative(l.ppeMonthly) > 0);
    const ppeMaterial = materials.find((m) => /\b(epp|proteccion personal|ropa de trabajo)\b/.test(normTxt(m.description)));
    if (ppeLine && ppeMaterial) hints.push({ focus: `labor.${labor.indexOf(ppeLine)}.ppeMonthly`, text: `"${roleOf(ppeLine)}" tiene EPP por mes y en materiales está "${ppeMaterial.description}": si es el mismo EPP, cargalo en un solo lugar (la ropa y el EPP básico en el puesto, el EPP especial en insumos y materiales).` });
    if (hints.length) {
      const item = rule('double_cost_hints', 'Mismo costo en dos lugares', 'labor', 1, 'warning', `Revisá: ${hints.map((x) => x.text).join(' ')}`);
      item.focus = hints[0].focus;
      items.push(item);
    }
  }

  // 9e. Base económica (fecha base de los valores) y su antigüedad.
  // Tanda novatos 2026-11 (pedido del dueño): un valor SIN fecha base no es un pendiente: se
  // muestra con el mes de la oferta (los cálculos no cambian). Sólo avisa una base que SÍ tiene
  // fecha y es vieja o despareja respecto de la oferta.
  const baseInfo = summarizeEconomicBase(quote);
  if (baseInfo.entries.length > 0) {
    items.push(rule('economic_base', 'Fecha base de los valores', 'service', 1, 'ok',
      baseInfo.undefinedCount === 0
        ? 'Todos los valores tienen fecha base.'
        : `${baseInfo.undefinedCount === 1 ? 'Un valor no tiene' : `${baseInfo.undefinedCount} valores no tienen`} fecha propia: se toman del mes de la oferta.`));
    if (baseInfo.defined > 0 && !baseInfo.offerPeriod) {
      items.push(rule('base_age', 'Antigüedad de las bases', 'service', 1, 'warning', 'Sin fecha de la oferta: no se puede saber si las bases son viejas. Cargala en "El servicio".'));
    } else if (baseInfo.defined > 0) {
      const old = baseInfo.stale.length > 0;
      items.push(rule('base_age', 'Antigüedad de las bases', 'service', 1, old || baseInfo.mixed ? 'warning' : 'ok',
        old
          ? (baseInfo.warnings.find((w) => w.id === 'stale') || {}).message
          : baseInfo.mixed
            ? (baseInfo.warnings.find((w) => w.id === 'mixed') || {}).message
            : 'Bases actuales y parejas respecto de la fecha de la oferta.'));
    }
  }

  // 9f. Moneda: un valor en otra moneda necesita el tipo de cambio de la cotización
  const priced = [
    ...equipment.map((e) => ({ name: e.name || 'Equipo', base: e.base, relevant: nonNegative(e.quantity) > 0 && (isExt(e) ? nonNegative(extOf(e).price) > 0 : nonNegative(e.replacementValue) > 0) })),
    ...(quote.materialsNotApplicable ? [] : materials.map((m) => {
      const provider = MATERIAL_PROVIDERS.find((p) => p.id === m.providedBy);
      return { name: m.description || 'Material', base: m.base, relevant: nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0 && !(provider && provider.costForUs === false) };
    })),
  ].filter((x) => x.relevant);
  const foreign = priced.filter((x) => currencyOfBase(x.base) && conversionFactor(currencyOfBase(x.base), quote) !== 1);
  const noRate = foreign.filter((x) => conversionFactor(currencyOfBase(x.base), quote) === null);
  const noCurrency = priced.filter((x) => isPlainObject(x.base) && !currencyOfBase(x.base));
  if (foreign.length > 0 || noCurrency.length > 0) {
    items.push(rule('currency', 'Moneda y tipo de cambio', 'service', 2, noRate.length ? 'missing' : noCurrency.length ? 'warning' : 'ok',
      noRate.length
        ? `Falta el tipo de cambio ${currencyOfBase(noRate[0].base)} de esta cotización: "${noRate[0].name}" no se suma al costo hasta cargarlo.`
        : noCurrency.length
          ? `Sin moneda definida: ${noCurrency.slice(0, 3).map((x) => `"${x.name}"`).join(', ')}.`
          : 'Valores en otra moneda convertidos con el tipo de cambio de la cotización.'));
  }

  // 10. Estructura
  const indirect = quote.indirect || {};
  const itemOk = (it) => (['percent_direct', 'percent_labor'].includes(it.method) ? nonNegative(it.pct) > 0 : nonNegative(it.amount) > 0);
  // Desglosada por rubro (PLAN-2026-010): alcanza con un rubro con valor.
  const indirectOk = indirect.mode === 'detailed' && Array.isArray(indirect.items)
    ? indirect.items.some((it) => it && itemOk(it))
    : itemOk(indirect);
  items.push(rule('structure', 'Gastos de estructura', 'indirect', 1, indirectOk ? 'ok' : 'warning',
    indirectOk ? 'Absorción de estructura definida.' : 'No se absorbe estructura de empresa (administración, base, seguros generales).'));

  // 11. Plazo de pago
  const termOk = !isBlank(finance.paymentTermDays) && Number.isFinite(toNumber(finance.paymentTermDays, NaN));
  const termItem = rule('payment_term', 'Plazo de pago', 'finance', 2, termOk ? 'ok' : 'missing',
    termOk ? 'Plazo de cobro definido.' : 'Falta el plazo de cobro para completar el costo financiero: mientras tanto sólo se considera el desfase hasta facturar.');
  if (!termOk) termItem.focus = 'finance.paymentTermDays';
  items.push(termItem);

  // 11 bis. ¿Facturás con IVA? (K-03). Sólo en cotizaciones que tienen la pregunta (las nuevas):
  // las anteriores, sin el campo, no cambian ni su puntaje. Con monotributo o exento computeQuote
  // ya sacó el campo (nunca aplica).
  const vat = vatFinanceOf(quote);
  if (vat.present) {
    if (vat.applies === true && vat.missing.length) {
      const item = rule('vat_finance', 'Costo financiero del IVA', 'finance', 1, 'warning',
        vat.missing.length === 2
          ? 'Facturás con IVA: cargá el IVA que facturás y los días entre que facturás y pagás el IVA. Mientras tanto no se cuenta.'
          : vat.missing[0] === 'ratePct'
            ? 'Facturás con IVA: cargá el IVA que facturás. Mientras tanto no se cuenta.'
            : 'Facturás con IVA: cargá los días entre que facturás y pagás el IVA. Mientras tanto no se cuenta.');
      item.focus = `finance.vat.${vat.missing[0]}`;
      items.push(item);
    } else if (vat.applies === null && vat.paymentTermDays > 0) {
      // Sin decidir no resta puntaje (peso 0): pendiente amarillo, los números quedan como siempre.
      const item = rule('vat_finance', 'Costo financiero del IVA', 'finance', 0, 'warning',
        '¿Facturás con IVA? Si el IVA vence antes de que te paguen, adelantarlo cuesta: contestalo en "Financiación".');
      item.focus = 'finance.vat.applies';
      items.push(item);
    } else if (vat.active) {
      items.push(rule('vat_finance', 'Costo financiero del IVA', 'finance', 1, 'ok',
        vat.days > 0
          ? `Facturás con IVA: lo adelantás ${formatNumber(vat.days, { decimals: 1 })} días y financiarlo cuesta ${formatNumber(vat.pct, { decimals: 2 })} puntos del precio.`
          : 'Facturás con IVA y lo pagás después de cobrar: no hay costo financiero del IVA.'));
    }
  }

  // 12. Contingencia
  const contOk = contingencyPctOf(quote.risk || {}) > 0;
  items.push(rule('contingency', 'Imprevistos (contingencia)', 'risk', 1, contOk ? 'ok' : 'warning',
    contOk ? 'Contingencia configurada.' : 'Sin contingencia: cualquier imprevisto sale del margen.'));

  // 13. Margen (un margen inválido — ≥ 100 %, negativo o texto — no cuenta como
  // definido; tampoco uno que, sumado a los impuestos sobre la facturación, llega a 100 %)
  const taxes = billingTaxInfo(quote);
  // Mismo lector que la validación y el motor (texto es-AR "10,5" incluido).
  const marginRead = readMarginInput(pricing.targetMarginPct);
  const marginBlank = marginRead.state === 'empty';
  const marginValue = marginRead.value;
  const marginInvalid = marginRead.state === 'invalid';
  // Costo financiero del IVA (K-03): también va al divisor (margen + impuestos + t_iva < 100).
  const vatPctForMargin = vatFinanceOf(quote).pct;
  const grossUp = taxes.pct + vatPctForMargin;
  const marginTooHighWithTaxes = !marginBlank && !marginInvalid && !isValidMarginAndTaxes(marginValue, grossUp);
  const marginPositive = !marginBlank && !marginInvalid && marginValue > 0;
  const marginItem = rule('margin', 'Margen objetivo', 'margin', 2, marginBlank || marginInvalid || marginTooHighWithTaxes ? 'missing' : marginPositive ? 'ok' : 'warning',
    marginBlank
      ? 'Falta definir el margen objetivo.'
      : marginInvalid
        ? 'El margen objetivo debe ser mayor o igual a 0 y menor a 100 %.'
        : marginTooHighWithTaxes
          ? (vatPctForMargin > 0
            ? `Con ${taxes.pct > 0 ? `${formatPercent(taxes.pct)} de impuestos sobre lo que facturás y ` : ''}${formatPercent(vatPctForMargin)} de costo financiero del IVA, ${grossUp < 100 ? `el margen tiene que ser menor a ${formatPercent(100 - grossUp)}` : 'no hay precio posible: revisá el IVA, los días y la tasa'}.`
            : `Con ${formatPercent(taxes.pct)} de impuestos sobre lo que facturás, el margen tiene que ser menor a ${formatPercent(100 - taxes.pct)}.`)
          : marginPositive
            ? 'Margen objetivo definido.'
            : 'Margen objetivo en 0 %: cotizás sin ganancia.');
  if (!marginPositive || marginTooHighWithTaxes) marginItem.focus = 'pricing.targetMarginPct';
  items.push(marginItem);

  // 13b. Impuestos sobre lo que facturás (Ingresos Brutos, débitos y créditos, sellos…)
  items.push(rule('billing_taxes', 'Impuestos sobre lo que facturás', 'margin', 1,
    taxes.invalid ? 'missing' : taxes.defined ? 'ok' : 'warning',
    taxes.invalid
      ? 'Hay un porcentaje de impuestos inválido (negativo, no numérico o un total de 100 % o más): corregilo.'
      : taxes.notApplicable
        ? 'Elegiste no incluir impuestos sobre la facturación en esta cotización.'
        : taxes.defined
          ? 'Impuestos sobre la facturación definidos.'
          : 'Sin definir: la tarifa mínima no incluye los impuestos que pagás sobre lo que facturás (Ingresos Brutos, impuesto al cheque, sellos). Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".'));

  // 13c. ¿El precio se ajusta durante el contrato? (K-01). Sólo fuera de precio cerrado, con más de
  // un mes y en cotizaciones que tienen la pregunta (las nuevas): las anteriores, sin el campo, no
  // cambian ni su puntaje.
  const adjustment = priceAdjustmentOf(quote);
  if (adjustment.applies && adjustment.present) {
    const raw = normalizePriceAdjustment(quote.priceAdjustment);
    const updates = isPlainObject(quote.rateUpdate) && Array.isArray(quote.rateUpdate.steps) ? quote.rateUpdate.steps.length : 0;
    const months = formatNumber(adjustment.months, { decimals: 2 });
    let status = 'ok';
    let message;
    let focus = null;
    if (adjustment.mode === null) {
      status = 'warning';
      message = `¿El precio se ajusta durante el contrato? Son ${months} meses: si queda fijo, cargá la inflación que esperás.`;
      focus = 'priceAdjustment.mode';
    } else if (adjustment.mode === 'adjusted') {
      message = 'El precio se ajusta con una cláusula: usá "Actualizar tarifa" cuando suban los costos.';
    } else if (raw.expectedMonthlyInflationPct === null || adjustment.pct === null) {
      status = 'warning';
      message = 'Precio fijo todo el contrato: cargá la inflación mensual que esperás.';
      focus = 'priceAdjustment.expectedMonthlyInflationPct';
    } else if (adjustment.factor > 2) {
      status = 'warning';
      message = 'Con ese % el costo del contrato se duplica. Revisá el %.';
      focus = 'priceAdjustment.expectedMonthlyInflationPct';
    } else {
      message = adjustment.active
        ? `Precio fijo con ${formatPercent(adjustment.pct)} de inflación mensual: el costo promedio del contrato es el de hoy × ${formatNumber(adjustment.factor, { decimals: 4 })}.`
        : 'Precio fijo sin inflación esperada.';
    }
    // Sin decidir no resta puntaje (peso 0): se muestra como pendiente amarillo y los números de
    // una cotización nueva quedan como siempre hasta que se elige.
    const item = rule('price_adjustment', 'Ajuste del precio', 'margin', adjustment.mode === null ? 0 : 1, status, message);
    if (focus) item.focus = focus;
    items.push(item);
    // Precio fijo y actualizaciones de tarifa: se contradicen (aviso aparte, aunque haya otro).
    if (adjustment.mode === 'fixed' && updates > 0) {
      const upd = rule('price_adjustment_updates', 'Precio fijo con actualizaciones', 'margin', 1, 'warning',
        'Elegiste precio fijo pero la tarifa tiene actualizaciones: con precio fijo no se actualiza. Revisá cuál de las dos vale.');
      upd.focus = 'priceAdjustment.mode';
      items.push(upd);
    }
    // Doble conteo: la contingencia ya tiene un % por inflación o precios.
    const overlap = contingencyPriceOverlap(quote);
    if (overlap.pct > 0) {
      const dbl = rule('price_adjustment_contingency', 'Inflación contada dos veces', 'risk', 1, 'warning',
        `La contingencia ya tiene ${formatPercent(overlap.pct)} por inflación o precios: con precio fijo se cuenta dos veces. Sacalo de imprevistos.`);
      dbl.focus = `risk.items.${overlap.index}.pct`;
      items.push(dbl);
    }
  }

  // 13 bis. Abono mensual + "Abono de disponibilidad" (ECO-01, H-02): con la tarifa en $/mes los
  // dos son cargos fijos del mismo mes y se SUMAN: el mismo abono cargado dos veces muestra
  // facturación y margen que no existen. Disponibilidad + tarifa por uso (día, hora, llamado…) y el
  // mínimo mensual garantizado no son doble cobro. La fórmula no cambia: el resultado queda
  // crítico (no confiable) hasta dejar un solo abono. Dos cargos fijos distintos se expresan
  // igual con un solo número: la tarifa mensual.
  const availabilityFee = nonNegative(rules.availabilityFeeMonthly);
  if (unit.kind === 'month' && availabilityFee > 0) {
    const knownRate = quote.pricingMode === 'known_rate' && nonNegative(pricing.knownRate) > 0 ? nonNegative(pricing.knownRate) : null;
    const item = rule('monthly_fee_overlap', 'Dos abonos por mes', 'margin', 2, 'missing',
      knownRate !== null
        ? `Cobrás un abono mensual de ${formatMoney(knownRate)} y además un "${GUARD_FEE_LABEL}" de ${formatMoney(availabilityFee)} por mes: se facturan los dos (${formatMoney(knownRate + availabilityFee)} por mes, de lista). Si es el mismo abono, dejá el fijo de guardia en 0; si son dos cargos distintos, sumalos en la tarifa mensual. Hasta entonces el resultado no es confiable.`
        : `La tarifa es un abono mensual y además cargaste un "${GUARD_FEE_LABEL}" de ${formatMoney(availabilityFee)} por mes: se facturan los dos y la tarifa sugerida ya descuenta ese abono. Si es el mismo abono, dejá el fijo de guardia en 0; si es un cargo distinto, incluilo en la tarifa mensual. Hasta entonces el resultado no es confiable.`);
    item.unreliable = true;
    item.focus = 'rules.availabilityFeeMonthly';
    items.push(item);
  }

  // 14. Standby (on-call; con contrato, sólo si hay equipos)
  // Tanda novatos 2026-11: sólo es pendiente si hay días de espera cargados y no hay tarifa.
  if (isOnCall && (contract.legacy || contract.equipment) && rules.standbyNotApplicable !== true) {
    const rated = nonNegative(rules.standbyRatePerDay) > 0;
    const days = nonNegative(rules.standbyDaysPerMonth) > 0;
    if (rated || days) {
      items.push(rule('standby', 'Equipo en espera (standby)', 'margin', 1, rated ? 'ok' : 'warning',
        rated ? 'Standby definido.' : 'Cargaste días de espera por mes y no la tarifa: ¿qué cobrás por cada día que el equipo queda en locación sin operar?'));
    }
  }

  // 15. Adicionales (PLAN-2026-018): cada uno con cantidad necesita costo y precio.
  const extrasMargin = readMarginInput((quote.pricing || {}).targetMarginPct);
  const extras = computeExtras(quote.extras, { targetMarginPct: extrasMargin.state === 'invalid' ? null : (extrasMargin.value ?? 0) });
  // Las tarifas fuera de horario (PLAN-2026-025) no llevan costo a mano: sale de los recursos.
  const extrasIncomplete = extras.lines.map((x, index) => ({ x, index })).filter(({ x }) => !x.derived && x.quantity > 0 && !(x.costPerUnit > 0));
  if (extras.lines.some((x) => x.quantity > 0)) {
    const missingPrice = extras.lines.filter((x) => !x.derived && x.quantity > 0 && x.price === null).length;
    const ok = extrasIncomplete.length === 0 && missingPrice === 0;
    const item = rule('extras', 'Adicionales', 'margin', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Adicionales con costo y precio.'
        : `Hay adicionales sin costo por unidad${missingPrice ? ' o sin precio' : ''}: ${extrasIncomplete.slice(0, 3).map(({ x }) => `"${x.label}"`).join(', ') || 'revisalos'}. Sin el costo, RATEOS no puede sugerir el precio ni saber si ganás con ellos.`);
    if (!ok && extrasIncomplete.length) item.focus = `extras.${extrasIncomplete[0].index}.costPerUnit`;
    items.push(item);
  }

  let earned = 0;
  let total = 0;
  const counts = { ok: 0, warning: 0, missing: 0 };
  items.forEach((i) => {
    if (!(i.status in STATUS_WEIGHT)) return;
    total += i.weight;
    earned += i.weight * STATUS_WEIGHT[i.status];
    counts[i.status] += 1;
  });
  const scorePct = total > 0 ? (earned / total) * 100 : 0;
  // Severidad (PLAN-2026-010): crítico si falta algo que cambia el costo o el precio.
  items.forEach((i) => {
    i.severity = i.status === 'ok' || i.status === 'n/a' ? null : (CRITICAL_RULES.includes(i.id) || i.critical === true) && i.status === 'missing' ? 'critical' : 'review';
  });
  const order = { missing: 0, warning: 1, ok: 2 };
  const pending = items.filter((i) => i.status !== 'ok').sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || order[a.status] - order[b.status]);
  // Informativos: no participan del puntaje ni de los pendientes.
  const notices = [];
  // Revisión 0.25.0 (UX C1): creada con "Otra unidad…" y todavía sin elegir. Se calcula por día (como
  // siempre); el aviso es informativo y desaparece al elegir la unidad.
  if (quote.unitPending === true) {
    notices.push({
      id: 'unit_pending',
      step: 'service',
      severity: 'info',
      label: 'Unidad sin elegir',
      message: 'Todavía no elegiste la unidad. Si no elegís, queda por día.',
      focus: 'unit',
    });
  }
  // Unidad "viaje" con un "Viajes por llamado" anterior distinto (PLAN-2026-012).
  if (route.storedDiffers) {
    const fmt = (n) => formatNumber(n, { decimals: 2 });
    notices.push({
      id: 'transport_trips',
      step: 'logistics',
      severity: 'info',
      label: 'Viajes físicos',
      message: `Con la unidad "viaje", los viajes ${T.per} se calculan con los viajes por día: ${fmt(route.tripsPerActiveDay)} × ${fmt(route.daysPerActivation)} ${route.daysPerActivation === 1 ? 'día' : 'días'} = ${fmt(route.tripsPerActivation)}. El dato anterior de esta cotización (${fmt(route.storedTripsPerActivation)} ${T.per}) ya no se usa: los km se calculan con los viajes que facturás.`,
    });
  }
  // Recursos compartidos: el resto del costo fijo lo cubre otro servicio.
  const sharedNotice = (line, list, index, fallback) => {
    const share = fixedCostShareOf(line);
    // Por tiempo usado el % no rige: no se avisa.
    if (usesTimeBasis(quote) || !share.shared || share.missing || share.sharePct >= 100) return;
    notices.push({
      id: 'shared_fixed',
      step: list,
      severity: 'info',
      label: list === 'labor' ? 'Personal compartido' : 'Equipo compartido',
      message: `"${(typeof line.role === 'string' && line.role.trim()) || (typeof line.name === 'string' && line.name.trim()) || fallback}" se comparte: esta cotización carga el ${formatPercent(share.sharePct)} de su costo fijo. El ${formatPercent(100 - share.sharePct)} restante lo tiene que cubrir otro servicio o contrato (si no se concreta, queda sin cubrir).`,
      targets: [{ list, index }],
    });
  };
  labor.forEach((l, index) => sharedNotice(l, 'labor', index, 'Personal'));
  equipment.forEach((e, index) => {
    if (!isExt(e)) sharedNotice(e, 'equipment', index, 'Equipo');
  });
  // Guardia pasiva (2026-11): el adicional de guardia del convenio entra al costo sólo si se carga.
  if (passiveGuard && labor.length > 0 && labor.every((l) => !(nonNegative(l.additionalsMonthly) > 0))) {
    const i = Math.max(0, labor.findIndex((l) => nonNegative(l.positions) > 0));
    notices.push({
      id: 'guard_allowance',
      step: 'labor',
      severity: 'info',
      label: 'Adicional de guardia',
      message: 'Guardia pasiva: si el convenio paga un adicional por estar de guardia, cargalo en "Otros pagos fijos por mes" del puesto (por persona) para que entre al costo.',
      focus: `labor.${i}.additionalsMonthly`,
    });
  }
  // Disponibilidad que no se cobra aparte (2026-11): 24/7 o guardia activa, cobrando sólo lo
  // trabajado. Informativo: muchas tarifas ya la incluyen.
  const guardIsCostly = activity.availability === '24/7' || Boolean(activeGuardCoverage(quote));
  if (serviceType === 'on_call' && guardIsCostly && unit.kind !== 'month' && !(nonNegative(rules.availabilityFeeMonthly) > 0) && !normalizeRules(rules).hasMinimumGuarantee) {
    notices.push({
      id: 'availability_unpaid',
      step: 'margin',
      severity: 'info',
      label: 'Disponibilidad sin cobrar',
      // Sin "Ir al campo": el fijo de guardia ya no se carga en cotizaciones nuevas (regla de un ítem).
      message: 'Estar de guardia también cuesta: cubrilo en la tarifa (un solo precio).',
    });
  }
  // P-20 (0.25.0): el cliente pone el combustible y un externo dice "combustible incluido: No" con
  // consumo cargado: ese combustible no se suma (el motor lo cuesta en 0). Informativo, sin puntaje.
  if (fuel.providedBy === 'client') {
    equipment.forEach((e, index) => {
      if (!isExt(e) || extOf(e).fuelIncluded !== false) return;
      const x = extOf(e);
      const mode = externalFuelMode(x);
      const value = mode === 'per_hour' ? x.fuelLitersPerHour : mode === 'per_100km' ? x.fuelLitersPer100Km : x.fuelKmPerLiter;
      if (!(nonNegative(value) > 0)) return;
      // En L/100 km o km/L el consumo sale de los km de la ruta: sin km no habría nada que sumar.
      if (mode !== 'per_hour' && !(routeKmPerActivation > 0)) return;
      const name = lineName(e, 'Externo');
      notices.push({
        id: 'client_fuel_external_not_summed',
        step: 'equipment',
        severity: 'info',
        label: 'Combustible del cliente',
        message: `«${name}»: en «¿Quién paga el combustible?» (Movilización y viajes) elegiste el cliente, así que este consumo no se suma. Si al proveedor se lo pagás vos, cambialo ahí.`,
        focus: `equipment.${index}.external.fuelIncluded`,
        targets: [{ list: 'equipment', index, name }],
      });
    });
  }
  // P-22 (0.25.0): por tiempo usado el control de horas del mes está apagado (arriba). Si los días
  // por las horas por día de un puesto superan las horas normales que cubren sus personas en el
  // mes y el trabajo no lleva horas extra, se avisa: con los datos cargados, sin constantes.
  // Mismo criterio que el control de siempre: personas por posición (relevos), meses del trabajo
  // (`mf`, un trabajo de 44 días en meses de 30) y horas extra cargadas en el puesto (sin aviso).
  // Los puestos iguales (mismo nombre y mismas horas, "Agregar otra persona igual") van en un
  // solo aviso. Informativo, sin puntaje.
  if (timeBasisHours && ow.mode === 'none' && D > 0 && !activeGuard) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const groups = new Map();
    labor.forEach((l, index) => {
      const normal = nonNegative(l.normalHoursPerMonth);
      if (!(nonNegative(l.positions) > 0) || !(normal > 0)) return;
      if (overtimeItemsOf(l).some((o) => o.hours > 0) || resourceOvertimeHoursOf(l) > 0) return;
      const own = nonNegative(l.coverageHoursPerDay) > 0
        ? nonNegative(l.coverageHoursPerDay)
        : isPlainObject(l.rotation) ? nonNegative(l.rotation.hoursPerShift) : 0;
      const perDay = own > 0 ? Math.min(own, H) : H;
      const ppp = laborPeoplePerPositionOf(l);
      const total = D * perDay;
      if (!(perDay > 0) || !(ppp > 0) || total <= ppp * normal * mf + 1e-9) return;
      const perPersonMonth = total / (ppp * mf);
      const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
      const key = `${name}|${perDay}|${normal}|${ppp}`;
      const g = groups.get(key);
      if (g) {
        g.targets.push({ list: 'labor', index, name });
        g.people += nonNegative(l.positions) * ppp;
      } else {
        groups.set(key, { name, perDay, normal, ppp, total, perPersonMonth, people: nonNegative(l.positions) * ppp, targets: [{ list: 'labor', index, name }] });
      }
    });
    groups.forEach((g) => {
      const who = g.targets.length > 1 ? `«${g.name}» (${fmt(g.people)} personas)` : `«${g.name}»`;
      const simple = Math.abs(g.ppp - 1) < 1e-9 && Math.abs(mf - 1) < 1e-9;
      const per = simple
        ? `${fmt(D)} días × ${fmt(g.perDay)} h por día son ${fmt(g.total)} h, más que sus ${fmt(g.normal)} horas normales del mes`
        : `${fmt(D)} días × ${fmt(g.perDay)} h por día son ${fmt(g.perPersonMonth)} h por persona y por mes${Math.abs(g.ppp - 1) < 1e-9 ? '' : ` (${fmt(g.ppp)} personas por puesto)`}${mf > 1 + 1e-9 ? ` (el trabajo dura ${fmt(mf)} meses)` : ''}, más que sus ${fmt(g.normal)} horas normales del mes`;
      notices.push({
        id: 'overtime_hours_over_month',
        step: 'labor',
        severity: 'info',
        label: 'Más horas que las normales del mes',
        message: `${who}: ${per}, y el trabajo no lleva horas extra. Si las horas de más se pagan como extra, elegilo en "Horas extra del trabajo" (al final de Personal); si no, revisá los días o las horas por día.`,
        focus: 'overtimeWork.mode',
        targets: g.targets,
      });
    });
  }
  // Puesto con sueldo y 0 posiciones: no suma costo (Test Lab, PLAN-2026-013).
  labor.forEach((l, index) => {
    if (nonNegative(l.basicMonthly) > 0 && !(nonNegative(l.positions) > 0)) {
      const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
      notices.push({
        id: 'labor_no_positions',
        step: 'labor',
        severity: 'info',
        label: 'Puesto sin personas',
        message: `"${name}" tiene sueldo pero 0 personas: no suma costo. Si trabaja en el servicio, poné 1 en Cantidad; si no, quitá la línea.`,
        focus: `labor.${index}.positions`,
        targets: [{ list: 'labor', index, name }],
      });
    }
  });
  // "El servicio no usa materiales" con materiales cargados: esas líneas no se suman.
  if (quote.materialsNotApplicable && materials.length > 0) {
    notices.push({
      id: 'materials_ignored',
      step: 'materials',
      severity: 'info',
      label: 'Insumos y materiales sin sumar',
      message: `Marcaste "El servicio no usa insumos ni materiales" y hay ${materials.length === 1 ? '1 línea cargada' : `${materials.length} líneas cargadas`}: no se suman al costo. Si los usás, desmarcá esa opción.`,
      focus: 'materialsNotApplicable',
    });
  }
  // Un gasto cargado antes con "Va a: Gastos de estructura" y además estructura cargada (PLAN-2026-027,
  // P-02): puede estar contado dos veces. Sólo informativo (no entra en el puntaje: ninguna
  // cotización guardada cambia de estado).
  {
    const ind = isPlainObject(quote.indirect) ? quote.indirect : {};
    const loaded = (it) => (['percent_direct', 'percent_labor'].includes(it.method || 'percent_direct') ? nonNegative(it.pct) > 0 : nonNegative(it.amount) > 0);
    const structureLoaded = ind.mode === 'detailed' && Array.isArray(ind.items) ? ind.items.some((it) => isPlainObject(it) && loaded(it)) : loaded(ind);
    const overlap = objectList(quote.otherCosts).map((o, index) => ({ o, index })).filter(({ o }) => o.category === 'structure' && nonNegative(o.amount) > 0);
    if (structureLoaded && overlap.length) {
      const name = (typeof overlap[0].o.description === 'string' && overlap[0].o.description.trim()) || 'Gasto';
      notices.push({
        id: 'other_cost_structure_overlap',
        step: 'materials',
        severity: 'info',
        label: 'Gasto que puede estar contado dos veces',
        message: `"${name}" suma en Gastos de estructura y además cargaste "Gastos de estructura": si ya está en tu porcentaje o en tus rubros, se cuenta dos veces. En ese caso, quitalo de "Gastos cargados antes".`,
        focus: `otherCosts.${overlap[0].index}.amount`,
        targets: overlap.map(({ o, index }) => ({ list: 'otherCosts', index, name: (typeof o.description === 'string' && o.description.trim()) || 'Gasto' })),
      });
    }
  }
  equipment.forEach((e, index) => {
    if (!isExt(e) && nonNegative(e.replacementValue) > 0 && !(nonNegative(e.capitalRatePctAnnual) > 0)) {
      notices.push({
        id: 'capital_cost',
        step: 'equipment',
        severity: 'info',
        label: 'Costo de capital',
        message: `Sin costo de capital en "${(typeof e.name === 'string' && e.name.trim()) || 'Equipo'}": RATEOS no está imputando rendimiento ni costo del dinero invertido en este equipo (es opcional y no es la financiación del contrato).`,
        targets: [{ list: 'equipment', index }],
      });
    }
  });
  // Dotación fraccionaria (A-15 b): posiciones × personas por posición no entero. El costo se
  // calcula con lo cargado; sólo se pregunta cuántas personas hay de verdad en nómina.
  labor.forEach((l, index) => {
    const positions = nonNegative(l.positions);
    if (!(positions > 0)) return;
    const payroll = hasPayrollHeadcount(l);
    const people = payroll ? laborHeadcountOf(l) : positions * nonNegative(l.peoplePerPosition, 1);
    // Tolerancia de 0,01 persona: 3 × 1,6667 (5 ÷ 3 cargado con decimales) son 5 personas.
    if (!(people > 0) || Math.abs(people - Math.round(people)) < 0.01) return;
    const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
    notices.push({
      id: 'labor_fractional_headcount',
      step: 'labor',
      severity: 'info',
      label: 'Personas no enteras',
      message: payroll
        ? `Cargaste ${formatNumber(people, { decimals: 2 })} personas en nómina en "${name}" (con decimales); ¿cuántas hay de verdad? El costo se calcula con ${formatNumber(people, { decimals: 2 })}: si en nómina son ${formatNumber(Math.ceil(people - 1e-9))}, cargalo así. RATEOS no redondea solo.`
        : Math.abs(nonNegative(l.peoplePerPosition, 1) - 1) < 1e-9
          ? `Cargaste ${formatNumber(people, { decimals: 2 })} personas en "${name}" (con decimales); ¿cuántas son de verdad? El costo se calcula con ${formatNumber(people, { decimals: 2 })}: si son ${formatNumber(Math.ceil(people - 1e-9))}, cargalo así. RATEOS no redondea solo.`
          : `Cargaste ${formatNumber(people, { decimals: 2 })} personas en "${name}" (${formatNumber(positions, { decimals: 2 })} ${Math.abs(positions - 1) < 1e-9 ? 'posición' : 'posiciones'} × ${formatNumber(nonNegative(l.peoplePerPosition, 1), { decimals: 2 })} por posición); ¿cuántas hay en nómina? El costo se calcula con ${formatNumber(people, { decimals: 2 })}: si en nómina son ${formatNumber(Math.ceil(people - 1e-9))}, cargalo así. RATEOS no redondea solo.`,
      focus: `labor.${index}.${payroll ? 'payrollHeadcount' : Math.abs(nonNegative(l.peoplePerPosition, 1) - 1) < 1e-9 ? 'positions' : 'peoplePerPosition'}`,
      targets: [{ list: 'labor', index, name }],
    });
  });
  // Material "por día" que parece "por unidad" (tanda B 2026-11, B-2, PLAN-2026-022): cobrás por
  // cantidad y la cantidad por día del material es igual a las unidades por día. Si cambia el
  // rendimiento, el costo por unidad se desajusta en silencio; con "Por unidad producida" se mueve solo. Nunca se convierte solo.
  if (act.unitKind === 'quantity' && act.unitsPerActiveDay > 0 && quote.materialsNotApplicable !== true) {
    const unit = billingUnitOf(quote);
    (Array.isArray(quote.materials) ? quote.materials : []).forEach((m, index) => {
      if (!isPlainObject(m) || m.basis !== 'per_active_day' || !(nonNegative(m.unitCost) > 0)) return;
      const qty = nonNegative(m.quantity);
      if (!(qty > 1) || Math.abs(qty - act.unitsPerActiveDay) > 1e-9) return;
      const name = (typeof m.description === 'string' && m.description.trim()) || 'Material';
      const n = formatNumber(qty, { decimals: 2 });
      notices.push({
        id: 'materials_per_unit_hint',
        step: 'materials',
        severity: 'info',
        label: `¿Es por ${unit.singular}?`,
        message: `"${name}" está cargado por día (${n} por día) y hacés ${n} ${unit.plural} por día. Si se consume por ${unit.singular}, elegí "Por unidad producida" en "¿Cada cuánto se consume?" con la cantidad de cada ${unit.singular}: así el costo por ${unit.singular} no cambia si cambia el rendimiento. RATEOS no lo cambia solo.`,
        focus: `materials.${index}.basis`,
        targets: [{ list: 'materials', index, name }],
      });
    });
  }
  // Precio cerrado de varios días con 1 viaje por trabajo (A-15 c): ¿vuelven a la base cada día?
  if (contract.mode === 'closed' && !logistics.notApplicable && oneWayKm > 0 && !route.derived && !route.byCapacity
    && act.daysPerActivation > 1 + 1e-9 && Math.abs(route.tripsPerActivation - 1) < 1e-9) {
    const who = labor.length > 0 ? 'la cuadrilla' : 'el equipo';
    const days = formatNumber(act.daysPerActivation, { decimals: Math.abs(act.daysPerActivation - Math.round(act.daysPerActivation)) < 1e-9 ? 0 : 2 });
    notices.push({
      id: 'closed_single_trip',
      step: 'logistics',
      severity: 'info',
      label: 'Un viaje en un trabajo de varios días',
      message: `¿${who.charAt(0).toUpperCase()}${who.slice(1)} vuelve a la base cada día? El trabajo dura ${days} días y cargaste 1 viaje por trabajo: si vuelven cada día (o cada tanto), cargá los viajes que correspondan; si se quedan en la locación, está bien así (y sumá el alojamiento en los viáticos).`,
      focus: 'logistics.tripsPerActivation',
    });
  }
  // "No usa combustible" en un equipo propio que viaja por sus medios (V-30): el viaje no suma
  // gasoil (regla LAB-D5). Si es un vehículo con motor, la marca está de más: se avisa, no se cambia.
  if (!logistics.notApplicable) {
    equipment.forEach((e, index) => {
      const m = isPlainObject(e.mobilization) ? e.mobilization : {};
      if (isExt(e) || e.fuelNotApplicable !== true || m.mode !== 'self') return;
      notices.push({
        id: 'no_fuel_travels',
        step: 'equipment',
        severity: 'info',
        label: 'Viaja y no usa combustible',
        message: `Marcaste "No usa combustible" en "${lineName(e)}": el viaje no suma gasoil. Si es un vehículo con motor, desmarcalo.`,
        focus: `equipment.${index}.fuelNotApplicable`,
        targets: [{ list: 'equipment', index, name: lineName(e) }],
      });
    });
  }
  return {
    scorePct,
    items,
    pending,
    counts,
    notices,
    critical: pending.filter((i) => i.severity === 'critical').length,
    review: pending.filter((i) => i.severity === 'review').length,
    // Con estos pendientes el resultado NO es confiable (ECO-01): cuántos hay.
    unreliable: pending.filter((i) => i.unreliable === true).length,
  };
}

/**
 * Costos fijos absorbidos (tanda A 2026-11, A-15 a; informativo, no resta puntaje). En precio
 * cerrado, o con menos días de trabajo que los disponibles (salvo fijo mensual, donde el abono
 * cubre el mes por definición), el precio carga el costo fijo del mes completo de las personas y
 * los equipos propios al 100 % (dedicados, reservados, sin dato o compartidos sin % válido; no los
 * "contratados para este servicio", que no se comparten). Se informa el
 * monto; NUNCA se aplica un % compartido solo (AGENTS §5.1: no se infiere del uso).
 *
 *   X = Σ costo fijo del mes de esas líneas × meses de costo fijo (monthsFactor)
 *
 * @param {object} quote
 * @param {object} model buildCostModel(quote)
 * @param {number} activeDays D con la actividad estimada
 * @returns {object|null}
 */
export function fixedCostsAbsorbedNotice(quote = {}, model = null, activeDays = 0) {
  if (!model || !model.activity) return null;
  const contract = contractOf(quote);
  const D = nonNegative(activeDays);
  const available = model.activity.availableDaysPerMonth;
  if (!(D > 0)) return null;
  const closed = contract.mode === 'closed';
  if (!closed && !(contract.mode !== 'monthly' && D < available - 1e-9)) return null;
  // Al 100 % y que podría compartirse: dedicada / reservado / sin dato, o "compartida" sin un %
  // válido (se carga al 100 %). Se excluye "contratada para este servicio": no trabaja en otras
  // obras, así que el aviso ("si también hacen otros trabajos…") no le aplica (revisión de costos de la tanda A).
  // Por tiempo usado (0.23.1) sólo absorben su mes los recursos marcados "sólo tiene este trabajo".
  const byTime = usesTimeBasis(quote);
  const full = (line) => {
    if (byTime) return line.fullMonth === true;
    const share = fixedCostShareOf(line);
    if (share.assignment === 'hired') return false;
    return !share.shared || share.missing;
  };
  const labor = objectList(quote.labor);
  const laborModel = model.labor && Array.isArray(model.labor.lines) ? model.labor.lines : [];
  let laborFixed = 0;
  const targets = [];
  labor.forEach((l, i) => {
    if (nonNegative(l.positions) > 0 && full(l) && laborModel[i] && nonNegative(laborModel[i].fixedMonthly) > 0) {
      laborFixed += nonNegative(laborModel[i].fixedMonthly);
      targets.push({ list: 'labor', index: i, name: (typeof l.role === 'string' && l.role.trim()) || 'Personal' });
    }
  });
  const equipment = objectList(quote.equipment);
  const eqModel = Array.isArray(model.equipment) ? model.equipment : [];
  let equipmentFixed = 0;
  equipment.forEach((e, i) => {
    const owned = !(e.acquisition === 'rented' || e.acquisition === 'outsourced');
    if (owned && full(e) && eqModel[i] && eqModel[i].acquisition === 'owned' && nonNegative(eqModel[i].fixedMonthly) > 0) {
      equipmentFixed += nonNegative(eqModel[i].fixedMonthly);
      targets.push({ list: 'equipment', index: i, name: (typeof e.name === 'string' && e.name.trim()) || 'Equipo' });
    }
  });
  const mf = monthsFactor(D, available);
  const amount = (laborFixed + equipmentFixed) * mf;
  if (!(amount > 0)) return null;
  // V-01 (FLUJO-NUEVO-B): fuera de precio cerrado, si el servicio ya les ocupa el mes entero
  // (la propuesta de dedicación da 100 % para todas esas líneas: lunes a viernes, 8 h), no hay
  // nada que compartir: no se le dice "trabajás 22 de 30 días" a quien trabaja el mes completo.
  if (!closed && !byTime) {
    const proposal = proposeServiceShares(quote, { activeDaysPerMonth: D, hoursPerActiveDay: model.activity.hoursPerActiveDay });
    const fullMonth = targets.every((t) => {
      const p = t.list === 'labor' ? proposal.labor[t.index] : proposal.equipment[t.index];
      return p !== null && p !== undefined && p >= 100 - 1e-9;
    });
    if (fullMonth) return null;
  }
  const days = formatNumber(D, { decimals: Math.abs(D - Math.round(D)) < 1e-9 ? 0 : 1 });
  // Revisión 0.10.0 (C5): con varios trabajos por mes, los días son de todos los trabajos del mes.
  const jobs = billingUnitOf(quote).id === 'job' ? nonNegative(model.activity.billableQuantityPerMonth) : 1;
  const dayWord = (n) => (Math.abs(n - 1) < 1e-9 ? 'día' : 'días');
  const fmtDays = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
  const why = !closed
    ? `Trabajás ${days} de ${formatNumber(available)} días disponibles`
    : jobs > 1 + 1e-9
      ? `${fmtDays(jobs)} trabajos de ${fmtDays(D / jobs)} ${dayWord(D / jobs)} (${days} ${dayWord(D)} de trabajo en el mes)`
      : `Un trabajo de ${days} ${dayWord(D)}`;
  const period = mf > 1 + 1e-9 ? `de ${formatNumber(mf, { decimals: 2 })} meses (el trabajo dura más que los días disponibles)` : 'del mes';
  const parts = [laborFixed > 0 ? `sueldos ${formatMoney(laborFixed * mf)}` : null, equipmentFixed > 0 ? `tenencia de equipos propios ${formatMoney(equipmentFixed * mf)}` : null].filter(Boolean).join(' + ');
  return {
    id: 'fixed_costs_absorbed',
    step: targets[0].list,
    severity: 'info',
    label: 'Costos fijos del mes en el precio',
    message: byTime
      ? `${why}: este precio cobra el mes completo (${formatMoney(amount)}: ${parts}) de ${targets.map((t) => `"${t.name}"`).join(', ')}, porque marcaste que sólo tienen este trabajo. Es un costo fijo: si el cliente usa menos de lo estimado, no lo recuperás (conviene pactar un mínimo). Si también hacen otros trabajos, desmarcá "Sólo tiene este trabajo" en su tarjeta.`
      : `${why}: este precio absorbe ${formatMoney(amount)} de costos fijos ${period} (${parts}) del personal y los equipos asignados al 100 %. Si también hacen otros trabajos, elegí "Una parte de su mes" en la persona (o «Compartido» en el equipo).`,
    focus: `${targets[0].list}.${targets[0].index}.${byTime ? 'fullMonth' : 'assignment'}`,
    targets,
    amount,
    laborFixed: laborFixed * mf,
    equipmentFixed: equipmentFixed * mf,
  };
}

/**
 * Horas del mes de los recursos propios que esta cotización NO paga (0.23.0, capacidad ociosa; 0.23.1: ver capacityRows).
 * Por tiempo usado cada recurso cuesta sus horas en el trabajo × su valor hora; el resto de su mes
 * lo tienen que pagar otros trabajos. Con poco trabajo estimado el precio queda muy por debajo del
 * costo real de quien sólo tiene este trabajo, y antes no se avisaba. No cambia ningún cálculo.
 *
 *   horas pagadas  = horas por día en el trabajo × días de trabajo estimados (por persona o unidad)
 *   horas del mes  = las que dividen su costo del mes para el valor hora (`billableHoursPerMonth`)
 *   sin cobrar acá = (horas del mes − horas pagadas) × valor hora × personas o unidades
 *
 * Se avisa cuando algún recurso queda cubierto en menos de la mitad de su mes (IDLE_NOTICE_BELOW_PCT)
 * o cuando la cotización le pide más horas que las de su mes.
 * @param {object} quote
 * @param {object} model buildCostModel(quote)
 * @param {number} activeDays D con la actividad estimada
 * @returns {object|null}
 */
export const IDLE_NOTICE_BELOW_PCT = 50;
/**
 * Avisos de capacidad de los recursos propios (0.23.1): devuelve, juntos, el de horas del mes que la
 * cotización no paga (`idle_capacity`) y el de más horas que las del mes (`over_capacity`). Antes
 * el segundo tapaba al primero.
 *
 * Un recurso con "mes completo en esta cotización" (`fullMonth`) ya cobra su mes entero como costo
 * fijo: nunca entra en `idle_capacity`; sí en `over_capacity` si el trabajo le pide más horas que
 * las de su mes (hace falta otro).
 * @returns {object[]}
 */
export function capacityNotices(quote = {}, model = null, activeDays = 0) {
  const rows = capacityRows(quote, model, activeDays);
  return rows.length ? capacityNoticesFrom(rows) : [];
}

/**
 * Cuánto de su mes le paga esta cotización a cada recurso propio (por tiempo usado, con actividad
 * estimada). Una fila por recurso: horas pagadas (`used`), horas de su mes (`month`), % del mes,
 * lo que paga (`paidAmount`), lo que cuesta su mes entero (`fullAmount`) y lo que queda sin cobrar.
 * @returns {{ list: 'labor'|'equipment', index: number, name: string, used: number, month: number, pct: number, fullMonth: boolean, paidAmount: number, fullAmount: number, idleAmount: number }[]}
 */
export function capacityRows(quote = {}, model = null, activeDays = 0) {
  if (!model || !usesTimeBasis(quote)) return [];
  const D = nonNegative(activeDays);
  if (!(D > 0)) return [];
  const rows = [];
  const add = (list, index, name, m, count, monthlyFull, capacityFactor = 1) => {
    if (!m || !(count > 0)) return;
    if (m.fullMonth && m.fullMonthHours) {
      const f = m.fullMonthHours;
      if (f.hoursPerDay > 0 && f.monthHours > 0) rows.push({ list, index, name, used: f.hoursPerDay * D, month: f.monthHours * capacityFactor, pct: ((f.hoursPerDay * D) / (f.monthHours * capacityFactor)) * 100, fullMonth: true, paidAmount: monthlyFull, fullAmount: monthlyFull, idleAmount: 0 });
      return;
    }
    const time = m.timeBasis ? m.time : null;
    if (!time || !(time.billableHoursPerMonth > 0) || !(time.hourlyCost > 0) || !(time.hoursPerDay > 0)) return;
    const used = time.hoursPerDay * D;
    // Un puesto con relevos (2 personas para 1 puesto) tiene el mes de todas sus personas.
    const month = time.billableHoursPerMonth * capacityFactor;
    const paidAmount = used * time.hourlyCost * count;
    // Lo que cuesta su mes entero: todas las personas del puesto (con relevos) o todas las unidades.
    const fullAmount = Math.max(monthlyFull, time.billableHoursPerMonth * time.hourlyCost * count);
    rows.push({ list, index, name, used, month, pct: (used / month) * 100, fullMonth: false, paidAmount, fullAmount, idleAmount: Math.max(0, fullAmount - paidAmount) });
  };
  const laborModel = model.labor && Array.isArray(model.labor.lines) ? model.labor.lines : [];
  objectList(quote.labor).forEach((l, i) => {
    const m = laborModel[i];
    if (m) add('labor', i, (typeof l.role === 'string' && l.role.trim()) || 'Personal', m, nonNegative(m.positions), nonNegative(m.perPerson && m.perPerson.fixedMonthly) * nonNegative(m.headcount), nonNegative(m.positions) > 0 && nonNegative(m.headcount) > nonNegative(m.positions) ? nonNegative(m.headcount) / nonNegative(m.positions) : 1);
  });
  const eqModel = Array.isArray(model.equipment) ? model.equipment : [];
  objectList(quote.equipment).forEach((e, i) => {
    const m = eqModel[i];
    if (m && m.acquisition === 'owned') add('equipment', i, (typeof e.name === 'string' && e.name.trim()) || 'Equipo', m, nonNegative(m.quantity), nonNegative(m.ownership && m.ownership.totalMonthly) * nonNegative(m.quantity));
  });
  return rows;
}

function capacityNoticesFrom(rows) {
  const h = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1 });
  const names = (list) => list.map((r) => `"${r.name}" (${h(r.used)} de ${h(r.month)} h)`).join(', ');
  const out = [];
  const idle = rows.filter((r) => !r.fullMonth && r.pct < IDLE_NOTICE_BELOW_PCT && r.idleAmount > 0.005);
  if (idle.length) {
    const amount = idle.reduce((acc, r) => acc + r.idleAmount, 0);
    out.push({
      id: 'idle_capacity',
      step: idle[0].list,
      severity: 'warning',
      label: 'Horas del mes que esta cotización no paga',
      message: `Esta cotización paga sólo una parte del mes de ${names(idle)}. Quedan ${formatMoney(amount)} por mes de lo que cuesta tenerlos que acá no se cobran. Está bien si otros trabajos pagan ese tiempo. Si alguno sólo tiene este trabajo, el precio queda corto: en su tarjeta (Personal o Equipos) marcá "Sólo tiene este trabajo" y esta cotización cobra su mes completo.`,
      focus: `${idle[0].list}.${idle[0].index}.fullMonth`,
      targets: idle.map((r) => ({ list: r.list, index: r.index, name: r.name })),
      amount,
      rows: idle,
    });
  }
  const over = rows.filter((r) => r.used > r.month + 0.05);
  if (over.length) {
    // Horas del mes escritas a mano (o por el botón de la 0.23.0) por debajo de lo que pide el trabajo:
    // no es que falte otro recurso; el valor hora quedó calculado con menos horas de las que se cobran.
    out.push({
      id: 'over_capacity',
      step: over[0].list,
      severity: 'warning',
      label: 'Más horas que las del mes del recurso',
      message: `Con el trabajo estimado, esta cotización le pide más horas que las que trabaja por mes a ${names(over)}. Si las horas por mes están bien, hace falta otro igual o menos días. Si quedaron bajas (por ejemplo, iguales a las de un trabajo más corto), corregilas: así el recurso se cobra más de una vez.`,
      focus: `${over[0].list}.${over[0].index}.${over[0].fullMonth ? (over[0].list === 'labor' ? 'normalHoursPerMonth' : 'billableHoursPerMonth') : 'billableHoursPerMonth'}`,
      targets: over.map((r) => ({ list: r.list, index: r.index, name: r.name })),
      rows: over,
    });
  }
  return out;
}

/** El aviso de horas no pagadas, o el de exceso si no hay (compatibilidad 0.23.0). */
export function idleCapacityNotice(quote = {}, model = null, activeDays = 0) {
  const list = capacityNotices(quote, model, activeDays);
  return list.length ? list[0] : null;
}

/**
 * Menos de una salida por mes con costos por salida y "cada salida completa"
 * apagada (PLAN-2026-014, LAB-D1). La fórmula no cambia: la frecuencia es un
 * promedio y los costos por salida se cuentan en proporción. Informativo (no
 * resta puntaje): salidas promedio, costeadas y efecto del redondeo, y el campo
 * donde se decide. `rounding` = activationRoundingAt(model, D) con su preview.
 * @returns {object|null}
 */
export function activationRoundingNotice(quote, rounding, preview) {
  if (!rounding || rounding.enabled) return null;
  const A = rounding.estimated;
  if (!(A > 1e-9 && A < 1 - 1e-9) || !preview || !(preview.perActivationDiscrete > 0) || !(preview.total > 0)) return null;
  const T = activationTerms(quote);
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  return {
    id: 'activations_below_one',
    step: 'service',
    severity: 'info',
    label: `Menos de ${T.a} ${T.one} por mes`,
    message: `${T.Many} promedio por mes: ${n(A)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${n(A)} (promedio): los costos por ${T.one} (movilización, peajes, viáticos y cargos por ${T.one}) se cuentan en proporción. Si ${T.each} se paga ${T.whole}, marcá "${activationFieldLabels(T).fullActivations}": se costearía${preview.wholeActivations === 1 ? '' : 'n'} ${n(preview.wholeActivations)} (efecto del redondeo: +${formatMoney(preview.total)} por mes).`,
    focus: 'activity.fullActivations',
  };
}

