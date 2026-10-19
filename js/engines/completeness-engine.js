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
 * Además, `notices` lleva avisos INFORMATIVOS que no participan del puntaje
 * (por ejemplo, equipo propio sin costo de capital).
 */

import { objectList } from '../core/object.js';
import { nonNegative, toNumber } from '../core/money.js';
import { EQUIPMENT_SERVICE_TYPES, CONTINUOUS_SERVICE_TYPES, SERVICE_TYPES, PRICING_MODES, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { billingUnitOf, unitTexts } from '../domain/billing-units.js';
import { isValidMarginAndTaxes, readMarginInput } from './pricing-engine.js';
import { formatPercent, formatNumber, formatMoney } from '../core/format.js';
import { baseLabel } from '../domain/economic-base.js';
import { activationTerms, activationFieldLabels } from '../domain/activation-terms.js';
import { billingTaxInfo } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { externalFiscal, externalFuelMode } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { contingencyPctOf, normalizeActivity } from './cost-engine.js';
import { routeTrips } from './transport-engine.js';
import { overtimeItemsOf } from './labor-engine.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { conversionFactor, currencyOfBase } from './currency-engine.js';
import { isPlainObject } from '../core/object.js';

const STATUS_WEIGHT = { ok: 1, warning: 0.5, missing: 0 };

/** Pendientes que cambian el costo o el precio: se muestran como críticos (PLAN-2026-010 / 012). */
const CRITICAL_RULES = Object.freeze(['equipment_cost', 'external_route', 'external_hours', 'currency', 'utilization', 'rate', 'margin', 'monthly_fee_overlap']);

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

function rule(id, label, step, weight, status, message) {
  return { id, label, step, weight, status, color: status === 'ok' ? 'green' : status === 'warning' ? 'orange' : status === 'missing' ? 'red' : 'gray', message };
}

function isBlank(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
}

/**
 * Evalúa la completitud de una cotización.
 * @param {object} quote
 * @returns {{ scorePct: number, items: object[], pending: object[], counts: {ok:number, warning:number, missing:number} }}
 */
export function evaluateCompleteness(quote = {}) {
  const items = [];
  // La activación con el nombre de la cotización y los rótulos que se citan (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const L = activationFieldLabels(T);
  const serviceType = quote.serviceType;
  const isOnCall = serviceType === 'on_call';
  const activity = quote.activity || {};
  const labor = objectList(quote.labor);
  const equipment = objectList(quote.equipment);
  const materials = objectList(quote.materials);
  const logistics = quote.logistics || {};
  const vehicles = objectList(logistics.vehicles);
  const pricing = quote.pricing || {};
  const rules = quote.rules || {};
  const finance = quote.finance || {};
  const fuel = quote.fuel || {};

  // 1. Modalidad / tipo de servicio
  const validType = SERVICE_TYPES.some((t) => t.id === serviceType);
  const validMode = PRICING_MODES.some((m) => m.id === quote.pricingMode);
  items.push(rule('modality', 'Cómo se cobra', 'modality', 2,
    validType && validMode ? 'ok' : 'missing',
    validType && validMode ? 'Tipo de servicio y modalidad definidos.' : 'Falta definir el tipo de servicio o cómo se cobra (ya tengo la tarifa / calcular la tarifa).'));

  // 2. Tarifa o actividad según modalidad
  if (quote.pricingMode === 'known_rate') {
    const ok = nonNegative(pricing.knownRate) > 0;
    const item = rule('rate', 'Tarifa ingresada', 'modality', 2, ok ? 'ok' : 'missing', ok ? 'Tarifa definida.' : 'Elegiste "Ya tengo la tarifa" pero falta ingresarla.');
    if (!ok) item.focus = 'pricing.knownRate';
    items.push(item);
  }

  // 3. Actividad: por cantidad o evento (m³, viajes, llamados…; PLAN-2026-009) en la unidad comercial.
  // Cada pendiente lleva al campo que falta (Test Lab, PLAN-2026-013).
  const unit = billingUnitOf(quote);
  // Cobro por hora: sin horas por día no hay unidades facturables (la tarifa queda "—").
  const hoursMissing = unit.kind === 'hour' && !(Math.min(nonNegative(activity.hoursPerActiveDay), 24) > 0);
  // Los avisos citan el rótulo del campo tal como se ve en "Cómo se cobra".
  const activityHoursLabel = unit.kind === 'quantity' || unit.kind === 'event' ? 'Horas trabajadas por día de trabajo' : 'Horas trabajadas por día activo';
  const hoursMessage = `Cobrás por hora y falta "${activityHoursLabel}": sin horas no hay unidades facturables ni tarifa.`;
  if (unit.kind === 'quantity' || unit.kind === 'event') {
    const qOk = nonNegative(activity.billableQuantityPerMonth) > 0;
    const yieldOk = unit.kind !== 'quantity' || nonNegative(activity.unitsPerActiveDay) > 0;
    const ok = qOk && yieldOk;
    const texts = unitTexts(unit);
    const item = rule('utilization', `${unit.plural.charAt(0).toUpperCase()}${unit.plural.slice(1)} por mes`, 'modality', 2,
      ok ? 'ok' : 'missing',
      ok ? `Cantidad por mes definida (${unit.plural}).` : !qOk ? `${texts.quantityQuestion} Falta ese dato.` : `${texts.perDayQuestion} Falta ese dato para calcular los días de trabajo.`);
    if (!ok) item.focus = !qOk ? 'activity.billableQuantityPerMonth' : 'activity.unitsPerActiveDay';
    items.push(item);
  } else if (isOnCall || quote.pricingMode === 'known_activity') {
    const daysOk = nonNegative(activity.activeDaysPerMonth) > 0;
    const ok = daysOk && !hoursMissing;
    const item = rule('utilization', isOnCall ? 'Días de trabajo por mes' : 'Actividad estimada', 'modality', 2,
      ok ? 'ok' : 'missing',
      ok ? 'Días activos estimados por mes definidos.' : !daysOk ? '¿Cuántos días del mes esperás que el equipo esté trabajando y facturando? Falta ese dato.' : hoursMessage);
    if (!ok) item.focus = !daysOk ? 'activity.activeDaysPerMonth' : 'activity.hoursPerActiveDay';
    items.push(item);
  } else if (hoursMissing) {
    const item = rule('utilization', 'Horas por día de trabajo', 'modality', 2, 'missing', hoursMessage);
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
      `${unpaid.length === 1 ? 'Un puesto que se usa en la cotización no tiene' : 'Hay puestos que se usan en la cotización sin'} sueldo básico: ${names}${more}. Sin el básico faltan su sueldo, las cargas sociales sobre él y el valor de sus horas extra: la cotización no está completa. Cargá el básico mensual; si el puesto no trabaja en este servicio, poné 0 posiciones o quitá la línea.`);
    item.critical = true;
    item.focus = `labor.${unpaid[0].index}.basicMonthly`;
    item.targets = unpaid.map(({ l, index }) => ({ list: 'labor', index, name: roleOf(l) }));
    items.push(item);
  } else if (serviceType !== 'equipment_only') {
    const ok = labor.some((l) => nonNegative(l.basicMonthly) > 0 && nonNegative(l.positions) > 0);
    items.push(rule('labor', 'Personal', 'labor', 2, ok ? 'ok' : 'missing', ok ? 'Personal cargado.' : 'No hay personal con salario cargado.'));
  }

  // 5. Relevos (cobertura continua)
  const continuous = CONTINUOUS_SERVICE_TYPES.includes(serviceType) && (serviceType === 'permanent' || activity.availability === '24/7');
  if (continuous && labor.length > 0) {
    const ok = labor.every((l) => nonNegative(l.peoplePerPosition, 1) > 1);
    items.push(rule('relief', 'Relevos', 'labor', 1, ok ? 'ok' : 'warning',
      ok ? 'Relevos configurados.' : 'Cobertura 24/7 con una sola persona por posición: revisá relevos, francos y vacaciones.'));
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
  if (labor.length > 0 && D > 0 && H > 0) {
    const fmt = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
    const short = labor.map((l, index) => {
      const normal = nonNegative(l.normalHoursPerMonth);
      if (!(nonNegative(l.positions) > 0) || !(normal > 0)) return null;
      const ppp = nonNegative(l.peoplePerPosition, 1);
      const items = overtimeItemsOf(l);
      const perDay = items.filter((o) => o.basis === 'per_active_day').reduce((acc, o) => acc + o.hours, 0);
      const perMonth = items.filter((o) => o.basis === 'per_month').reduce((acc, o) => acc + o.hours, 0);
      const required = D * H;
      const covered = ppp * normal + perDay * D + perMonth * ppp;
      return required > covered + 1e-6 ? { l, index, ppp, normal, extra: perDay * D + perMonth * ppp, required, covered } : null;
    }).filter(Boolean);
    if (short.length) {
      const first = short[0];
      const name = (typeof first.l.role === 'string' && first.l.role.trim()) || 'Personal';
      const people = `${fmt(first.ppp)} ${Math.abs(first.ppp - 1) < 1e-9 ? 'persona' : 'personas'} × ${fmt(first.normal)} h normales por mes${first.extra > 0 ? ` + ${fmt(first.extra)} h extra` : ''}`;
      const others = short.length > 1 ? ` También: ${short.slice(1, 4).map((x) => `"${(typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal'}"`).join(', ')}.` : '';
      const item = rule('labor_hours', 'Horas del personal', 'labor', 1, 'warning',
        `${LABOR_COVERAGE_MESSAGE} "${name}": ${fmt(D)} días × ${fmt(H)} h = ${fmt(first.required)} h de cobertura por posición en el mes; lo cargado cubre ${fmt(first.covered)} h (${people}). Faltan ${fmt(first.required - first.covered)} h por posición: sumá personas por posición (turnos o relevos), cargá las horas extra o revisá las horas normales del puesto. RATEOS no las agrega solo.${others}`);
      item.focus = `labor.${first.index}.peoplePerPosition`;
      item.targets = short.map((x) => ({ list: 'labor', index: x.index, name: (typeof x.l.role === 'string' && x.l.role.trim()) || 'Personal' }));
      items.push(item);
    }
  }

  // 6. Costo de equipos (propios: reposición y vida útil; externos: tarifa)
  const isExt = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';
  const extOf = (e) => (isPlainObject(e.external) ? e.external : {});
  const needsEquipment = EQUIPMENT_SERVICE_TYPES.includes(serviceType);
  if (needsEquipment || equipment.length > 0) {
    // Cuáles líneas están incompletas (PLAN-2026-010): se nombran, nunca se ocultan.
    const ownMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => !isExt(e) && !(nonNegative(e.replacementValue) > 0 && nonNegative(e.usefulLifeYears) > 0));
    const extMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => isExt(e) && !(nonNegative(extOf(e).price) > 0));
    const ownOk = ownMissing.length === 0;
    const extOk = extMissing.length === 0;
    const ok = equipment.length > 0 && ownOk && extOk;
    const names = (list, fallback) => list.map(({ e }) => `"${(typeof e.name === 'string' && e.name.trim()) || fallback}"`).join(', ');
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
      fuelUsers.push({ name: lineName(e), consumes: nonNegative(m.travelLitersPer100Km) > 0, path: `equipment.${i}.mobilization.travelLitersPer100Km` });
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
        focus = fuelUsers[0].path;
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
    // El pendiente se muestra en el paso de su campo (el consumo de un equipo, en Equipos).
    const step = focus && /^equipment\.\d+\.(?!mobilization)/.test(focus) ? 'equipment' : 'logistics';
    const item = rule('fuel', 'Combustible', step, 2, status, message);
    if (focus) item.focus = focus;
    items.push(item);
  }

  // 8. Materiales y responsable
  if (quote.materialsNotApplicable) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'ok', 'Marcado como "el servicio no usa materiales".'));
  } else if (materials.length === 0) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'warning', 'No hay materiales cargados: confirmá si el servicio no usa materiales.'));
  } else {
    const ok = materials.every((m) => Boolean(m.providedBy));
    // Un material que pagamos con precio y sin cantidad (o al revés) suma $ 0: se avisa (Test Lab, PLAN-2026-013).
    const paidByUs = (m) => MATERIAL_PROVIDERS.some((p) => p.id === m.providedBy && p.costForUs !== false);
    const incomplete = materials.map((m, index) => ({ m, index })).find(({ m }) => paidByUs(m) && (nonNegative(m.unitCost) > 0) !== (nonNegative(m.quantity) > 0));
    const item = rule('materials', 'Responsable de materiales', 'materials', 2, !ok ? 'missing' : incomplete ? 'warning' : 'ok',
      !ok
        ? 'Hay materiales sin definir quién los provee (cliente, nosotros o tercero).'
        : incomplete
          ? `"${(typeof incomplete.m.description === 'string' && incomplete.m.description.trim()) || 'Material'}" tiene ${nonNegative(incomplete.m.unitCost) > 0 ? 'precio pero cantidad 0' : 'cantidad pero precio 0'}: no suma costo. Completalo o quitá la línea.`
          : 'Todos los materiales tienen responsable.');
    if (ok && incomplete) {
      item.focus = `materials.${incomplete.index}.${nonNegative(incomplete.m.unitCost) > 0 ? 'quantity' : 'unitCost'}`;
      item.targets = [{ list: 'materials', index: incomplete.index, name: incomplete.m.description || 'Material' }];
    }
    items.push(item);
  }

  // 9. Logística: ruta + cómo se llega (equipos que se movilizan o vehículos auxiliares)
  if (logistics.notApplicable) {
    items.push(rule('logistics', 'Viajes', 'logistics', 1, 'ok', 'Marcado como "sin traslados".'));
  } else {
    const moves = vehicles.some((v) => nonNegative(v.count) > 0)
      || equipment.some((e) => isPlainObject(e.mobilization) && ['self', 'transported', 'support'].includes(e.mobilization.mode))
      || equipment.some((e) => isExt(e) && extOf(e).mobilizationIncluded === true);
    const ok = nonNegative(logistics.distanceKm) > 0 && moves;
    items.push(rule('logistics', 'Viajes', 'logistics', 2, ok ? 'ok' : 'missing',
      ok ? 'Distancia y movilización definidas.' : nonNegative(logistics.distanceKm) > 0 ? 'Falta definir cómo llegan los equipos o el personal a la locación.' : 'Falta la distancia a la locación.'));
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
    const noDriver = mob.lines.filter((l) => l.warnings.includes('driver'));
    const ok = pending.length === 0 && broken.length === 0 && noDriver.length === 0;
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Equipo'}"`).join(', ');
    items.push(rule('mobility', 'Movilización de equipos', 'logistics', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Cada equipo tiene definido cómo llega al lugar del servicio.'
        : pending.length
          ? `Falta definir cómo llega al lugar del servicio: ${names(pending)}.`
          : broken.length
            ? `Revisá qué equipo o vehículo transporta a ${names(broken)}.`
            : `Falta definir quién maneja ${names(noDriver)} en el traslado.`));
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
    const globalNoContract = externals.filter((e) => extOf(e).unit === 'global' && !(nonNegative(quote.contractMonths) >= 1));
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
      const item = rule('external_route', 'Ruta del proveedor', routeFocus.startsWith('activity.') ? 'modality' : 'logistics', 2, 'missing',
        `Falta definir la ruta/distancia para calcular este proveedor: ${names(routeless)} (tarifa por ${extOf(routeless[0]).unit === 'km' ? 'km' : 'viaje'}). ${logistics.notApplicable ? 'Marcaste "Sin traslados".' : !(oneWayKm > 0) ? 'Cargá la distancia de ida en "Movilización y viajes".' : 'No hay viajes en la cotización.'} Hasta entonces no suma costo.`);
      item.focus = routeFocus;
      item.targets = routeless.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
      items.push(item);
    }

    // 9c'. Externo "por salida" cuando cada salida tiene VARIOS viajes (ECO-01, H-01): la tarifa
    // se cobra una vez por salida, no por viaje. Si en realidad es por viaje, el costo queda corto.
    // No cambia la fórmula: pide elegir la unidad o confirmarla
    // (`line.externalUnitConfirmed = 'activation'`). Con un viaje por salida no hay ambigüedad.
    const tripsPerActivation = logistics.notApplicable ? 0 : route.tripsPerActivation;
    const perActivation = tripsPerActivation > 1 + 1e-9
      ? externals.filter((e) => extOf(e).unit === 'activation' && nonNegative(extOf(e).price) > 0 && nonNegative(e.quantity) > 0 && e.externalUnitConfirmed !== 'activation')
      : [];
    if (perActivation.length) {
      const first = perActivation[0];
      const price = nonNegative(extOf(first).price);
      const A = act.activationsPerMonth;
      const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
      const tripWord = (v) => (Math.abs(v - 1) < 1e-9 ? 'viaje' : 'viajes');
      const legs = logistics.roundTrip === false ? '' : ' (ida y vuelta)';
      const month = A > 0 ? ` Con ${n(A)} ${T.word(A)} por mes son ${n(A * tripsPerActivation)} ${tripWord(A * tripsPerActivation)}, pero se ${A === 1 ? 'paga' : 'pagan'} ${n(A)} ${A === 1 ? 'vez' : 'veces'} ${formatMoney(price)}.` : '';
      const others = perActivation.length > 1 ? ` También: ${perActivation.slice(1, 4).map((x) => `"${lineName(x, 'Externo')}"`).join(', ')}.` : '';
      const item = rule('external_unit_trips', 'Unidad del proveedor', 'equipment', 1, 'warning',
        `"${lineName(first, 'Externo')}" cobra ${formatMoney(price)} ${T.per} y cada ${T.one} tiene ${n(tripsPerActivation)} ${tripWord(tripsPerActivation)}${legs}.${month} Equivale a ${formatMoney(price / tripsPerActivation)} por viaje. Si el proveedor cobra ${formatMoney(price)} por cada viaje, elegí "Por viaje completo (ida y vuelta)" (o "Por tramo" si cobra cada ida o cada vuelta); si cobra ${T.per}, confirmalo.${others}`);
      item.focus = `equipment.${equipment.indexOf(first)}.external.unit`;
      item.targets = perActivation.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
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
    const item = rule('external_hours', 'Horas del proveedor', inherits ? 'modality' : 'equipment', 2, 'missing',
      `Falta cuántas horas por día trabaja ${names} (tarifa por hora): sin horas no suma costo. ${inherits ? `Cargá "${activityHoursLabel}" en "Cómo se cobra" o sus "Horas de uso por día activo" en "Equipos".` : 'Cargá sus "Horas de uso por día activo" en "Equipos".'}`);
    item.focus = inherits ? 'activity.hoursPerActiveDay' : `equipment.${equipment.indexOf(first)}.hoursPerActiveDay`;
    item.targets = hourless.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
    items.push(item);
  }

  // 9c'''. Unidades que recorren la ruta (viaje, km) y la ruta de la cotización (Test Lab, PLAN-2026-013).
  // "Sin traslados" con viajes vendidos, o más km facturados que los que recorre la ruta (los costos
  // por km quedarían cortos): dos datos que describen realidades incompatibles. Se avisa (no se deriva:
  // ver PLANS.md). Una ruta con MÁS km que los facturados (vuelta vacía) no se avisa: es lo físico.
  if (unit.id === 'trip' || unit.id === 'km') {
    const billed = nonNegative(activity.billableQuantityPerMonth);
    const activations = normalizeActivity(quote).activationsPerMonth;
    const routeKmPerMonth = activations * routeKmPerActivation;
    const fmtN = (n) => formatNumber(n, { decimals: 2 });
    let message = null;
    let focus = null;
    if (logistics.notApplicable && billed > 0) {
      message = `Cobrás por ${unit.plural} pero marcaste "Sin traslados": los ${unit.plural} que vendés no tienen ${unit.id === 'km' ? '' : 'km ni '}costos de ruta (combustible, desgaste, peajes, proveedores por km). Si hay viajes, desmarcalo y cargá la ruta.`;
      focus = 'logistics.notApplicable';
    } else if (unit.id === 'km' && billed > 0 && oneWayKm > 0 && billed - routeKmPerMonth > Math.max(1, billed * 0.01)) {
      message = `Facturás ${fmtN(billed)} km por mes pero la ruta recorre ${fmtN(routeKmPerMonth)} km (${fmtN(activations)} ${T.word(activations)} × ${fmtN(route.tripsPerActivation)} ${route.tripsPerActivation === 1 ? 'viaje' : 'viajes'} × ${fmtN(oneWayKm * (logistics.roundTrip === false ? 1 : 2))} km por viaje): los costos por km (proveedor, combustible, desgaste) se calculan con los km de la ruta y quedan cortos si el equipo recorre los km que facturás. Ajustá "${L.tripsPerActivation}" o la distancia.`;
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
            ? `Posible doble conteo: "${vehicleTwice[0].name || 'Equipo'}" se moviliza por sus propios medios y también está como vehículo de la logística auxiliar.`
            : `Movilización posiblemente duplicada: el proveedor de "${mobilizationTwice[0].name || 'Externo'}" cobra la movilización aparte y además lo marcaste "por sus propios medios" (se suman km, combustible y desgaste).`));
  }

  // 9e. Base económica (fecha base de los valores) y su antigüedad
  const baseInfo = summarizeEconomicBase(quote);
  if (baseInfo.entries.length > 0) {
    items.push(rule('economic_base', 'Fecha base de los valores', 'service', 1, baseInfo.undefinedCount === 0 ? 'ok' : 'warning',
      baseInfo.undefinedCount === 0
        ? 'Todos los valores tienen fecha base.'
        : `${baseInfo.undefinedCount === 1 ? 'Un valor no tiene' : `${baseInfo.undefinedCount} valores no tienen`} fecha base (${baseInfo.undefinedEntries.slice(0, 3).map((e) => e.label).join(', ')}${baseInfo.undefinedCount > 3 ? '…' : ''}): no se sabe de cuándo son.`));
    if (baseInfo.defined > 0 && !baseInfo.offerPeriod) {
      items.push(rule('base_age', 'Antigüedad de las bases', 'service', 1, 'warning', 'Sin fecha de la oferta: no se puede saber si las bases son viejas. Cargala en "Tipo de servicio".'));
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
  const marginTooHighWithTaxes = !marginBlank && !marginInvalid && !isValidMarginAndTaxes(marginValue, taxes.pct);
  const marginPositive = !marginBlank && !marginInvalid && marginValue > 0;
  const marginItem = rule('margin', 'Margen objetivo', 'margin', 2, marginBlank || marginInvalid || marginTooHighWithTaxes ? 'missing' : marginPositive ? 'ok' : 'warning',
    marginBlank
      ? 'Falta definir el margen objetivo.'
      : marginInvalid
        ? 'El margen objetivo debe ser mayor o igual a 0 y menor a 100 %.'
        : marginTooHighWithTaxes
          ? `Con ${formatPercent(taxes.pct)} de impuestos sobre lo que facturás, el margen tiene que ser menor a ${formatPercent(100 - taxes.pct)}.`
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
          : 'Sin definir: la tarifa piso no incluye los impuestos que pagás sobre lo que facturás (Ingresos Brutos, impuesto al cheque, sellos). Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".'));

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
        ? `Cobrás un abono mensual de ${formatMoney(knownRate)} y además un "Abono de disponibilidad" de ${formatMoney(availabilityFee)} por mes: se facturan los dos (${formatMoney(knownRate + availabilityFee)} por mes, de lista). Si es el mismo abono, dejá el de disponibilidad en 0; si son dos cargos distintos, sumalos en la tarifa mensual. Hasta entonces el resultado no es confiable.`
        : `La tarifa es un abono mensual y además cargaste un "Abono de disponibilidad" de ${formatMoney(availabilityFee)} por mes: se facturan los dos y la tarifa sugerida ya descuenta ese abono. Si es el mismo abono, dejá el de disponibilidad en 0; si es un cargo distinto, incluilo en la tarifa mensual. Hasta entonces el resultado no es confiable.`);
    item.focus = 'rules.availabilityFeeMonthly';
    items.push(item);
  }

  // 14. Standby (on-call)
  if (isOnCall) {
    const ok = nonNegative(rules.standbyRatePerDay) > 0 || rules.standbyNotApplicable === true;
    items.push(rule('standby', 'Equipo en espera (standby)', 'margin', 1, ok ? 'ok' : 'warning',
      ok ? 'Standby definido.' : '¿Qué cobrás si el equipo queda en locación sin operar? Definilo o marcá que no aplica.'));
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
    if (!share.shared || share.missing || share.sharePct >= 100) return;
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
  // Puesto con sueldo y 0 posiciones: no suma costo (Test Lab, PLAN-2026-013).
  labor.forEach((l, index) => {
    if (nonNegative(l.basicMonthly) > 0 && !(nonNegative(l.positions) > 0)) {
      const name = (typeof l.role === 'string' && l.role.trim()) || 'Personal';
      notices.push({
        id: 'labor_no_positions',
        step: 'labor',
        severity: 'info',
        label: 'Puesto sin posiciones',
        message: `"${name}" tiene sueldo pero 0 posiciones: no suma costo. Si trabaja en el servicio, cargá cuántas posiciones; si no, quitá la línea.`,
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
      label: 'Materiales sin sumar',
      message: `Marcaste "el servicio no usa materiales" y hay ${materials.length === 1 ? '1 material cargado' : `${materials.length} materiales cargados`}: no se suman al costo. Si los usás, desmarcá esa opción.`,
      focus: 'materialsNotApplicable',
    });
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
  return {
    scorePct,
    items,
    pending,
    counts,
    notices,
    critical: pending.filter((i) => i.severity === 'critical').length,
    review: pending.filter((i) => i.severity === 'review').length,
  };
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
    step: 'modality',
    severity: 'info',
    label: `Menos de ${T.a} ${T.one} por mes`,
    message: `${T.Many} promedio por mes: ${n(A)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${n(A)} (promedio): los costos por ${T.one} (movilización, peajes, viáticos y cargos por ${T.one}) se cuentan en proporción. Si ${T.each} se paga ${T.whole}, marcá "${activationFieldLabels(T).fullActivations}": se costearía${preview.wholeActivations === 1 ? '' : 'n'} ${n(preview.wholeActivations)} (efecto del redondeo: +${formatMoney(preview.total)} por mes).`,
    focus: 'activity.fullActivations',
  };
}

