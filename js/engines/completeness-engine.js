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
 */

import { nonNegative, toNumber } from '../core/money.js';
import { EQUIPMENT_SERVICE_TYPES, CONTINUOUS_SERVICE_TYPES, SERVICE_TYPES, PRICING_MODES } from '../domain/catalogs.js';
import { contingencyPctOf } from './cost-engine.js';
import { isValidMarginPct } from './pricing-engine.js';

const STATUS_WEIGHT = { ok: 1, warning: 0.5, missing: 0 };

/** Debajo de este puntaje la cotización se considera con riesgo (pueden faltar costos). */
export const COMPLETENESS_RISK_THRESHOLD = 60;

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
  const serviceType = quote.serviceType;
  const isOnCall = serviceType === 'on_call';
  const activity = quote.activity || {};
  const labor = Array.isArray(quote.labor) ? quote.labor : [];
  const equipment = Array.isArray(quote.equipment) ? quote.equipment : [];
  const materials = Array.isArray(quote.materials) ? quote.materials : [];
  const logistics = quote.logistics || {};
  const vehicles = Array.isArray(logistics.vehicles) ? logistics.vehicles : [];
  const pricing = quote.pricing || {};
  const rules = quote.rules || {};
  const finance = quote.finance || {};
  const fuel = quote.fuel || {};

  // 1. Modalidad / tipo de servicio
  const validType = SERVICE_TYPES.some((t) => t.id === serviceType);
  const validMode = PRICING_MODES.some((m) => m.id === quote.pricingMode);
  items.push(rule('modality', 'Modalidad de cotización', 'modality', 2,
    validType && validMode ? 'ok' : 'missing',
    validType && validMode ? 'Tipo de servicio y modalidad definidos.' : 'Falta definir el tipo de servicio o la modalidad (conozco la tarifa / conozco la actividad).'));

  // 2. Tarifa o actividad según modalidad
  if (quote.pricingMode === 'known_rate') {
    const ok = nonNegative(pricing.knownRate) > 0;
    items.push(rule('rate', 'Tarifa ingresada', 'modality', 2, ok ? 'ok' : 'missing', ok ? 'Tarifa definida.' : 'Elegiste "Conozco la tarifa" pero falta ingresarla.'));
  }

  // 3. Utilización on-call
  if (isOnCall || quote.pricingMode === 'known_activity') {
    const ok = nonNegative(activity.activeDaysPerMonth) > 0;
    items.push(rule('utilization', isOnCall ? 'Utilización on-call (días activos)' : 'Actividad estimada', 'modality', 2,
      ok ? 'ok' : 'missing',
      ok ? 'Días activos estimados por mes definidos.' : '¿Cuántos días del mes esperás que el equipo esté trabajando y facturando? Falta ese dato.'));
  }

  // 4. Personal
  if (serviceType !== 'equipment_only') {
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

  // 6. Costo de equipos
  const needsEquipment = EQUIPMENT_SERVICE_TYPES.includes(serviceType);
  if (needsEquipment || equipment.length > 0) {
    const ok = equipment.length > 0 && equipment.every((e) => nonNegative(e.replacementValue) > 0 && nonNegative(e.usefulLifeYears) > 0);
    items.push(rule('equipment_cost', 'Costo de equipos', 'equipment', 2, ok ? 'ok' : 'missing',
      ok ? 'Equipos con valor de reposición y vida útil.' : equipment.length === 0 ? 'El servicio usa equipos pero no hay equipos cargados.' : 'Hay equipos sin valor de reposición o sin vida útil (falta su amortización).'));
  }

  // 7. Combustible
  const consumesFuel = equipment.some((e) => nonNegative(e.fuelLitersPerHour) > 0) || (!logistics.notApplicable && vehicles.some((v) => nonNegative(v.consumptionLPer100Km) > 0));
  const hasFuelUsers = equipment.length > 0 || (!logistics.notApplicable && vehicles.length > 0);
  if (hasFuelUsers) {
    let status = 'ok';
    let message = 'Combustible definido.';
    if (!fuel.providedBy) {
      status = 'missing';
      message = 'Combustible sin responsable: definí si lo pagás vos o lo provee el cliente.';
    } else if (fuel.providedBy !== 'client' && (nonNegative(fuel.pricePerLiter) <= 0 || !consumesFuel)) {
      status = 'missing';
      message = nonNegative(fuel.pricePerLiter) <= 0 ? 'Falta el precio del combustible.' : 'Falta el consumo de combustible de equipos o vehículos.';
    }
    items.push(rule('fuel', 'Combustible', 'logistics', 2, status, message));
  }

  // 8. Materiales y responsable
  if (quote.materialsNotApplicable) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'ok', 'Marcado como "el servicio no usa materiales".'));
  } else if (materials.length === 0) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'warning', 'No hay materiales cargados: confirmá si el servicio no usa materiales.'));
  } else {
    const ok = materials.every((m) => Boolean(m.providedBy));
    items.push(rule('materials', 'Responsable de materiales', 'materials', 2, ok ? 'ok' : 'missing',
      ok ? 'Todos los materiales tienen responsable.' : 'Hay materiales sin definir quién los provee (cliente, nosotros o tercero).'));
  }

  // 9. Logística
  if (logistics.notApplicable) {
    items.push(rule('logistics', 'Logística', 'logistics', 1, 'ok', 'Marcado como "sin traslados".'));
  } else {
    const ok = nonNegative(logistics.distanceKm) > 0 && vehicles.some((v) => nonNegative(v.count) > 0);
    items.push(rule('logistics', 'Logística', 'logistics', 2, ok ? 'ok' : 'missing',
      ok ? 'Distancia y vehículos definidos.' : 'Falta la distancia a locación o los vehículos de traslado.'));
  }

  // 10. Estructura
  const indirect = quote.indirect || {};
  const indirectOk = ['percent_direct', 'percent_labor'].includes(indirect.method) ? nonNegative(indirect.pct) > 0 : nonNegative(indirect.amount) > 0;
  items.push(rule('structure', 'Costos de estructura', 'indirect', 1, indirectOk ? 'ok' : 'warning',
    indirectOk ? 'Absorción de estructura definida.' : 'No se absorbe estructura de empresa (administración, base, seguros generales).'));

  // 11. Plazo de pago
  const termOk = !isBlank(finance.paymentTermDays) && Number.isFinite(toNumber(finance.paymentTermDays, NaN));
  items.push(rule('payment_term', 'Plazo de pago', 'finance', 2, termOk ? 'ok' : 'missing',
    termOk ? 'Plazo de cobro definido.' : 'Plazo de pago sin definir: no se puede calcular el costo financiero.'));

  // 12. Contingencia
  const contOk = contingencyPctOf(quote.risk || {}) > 0;
  items.push(rule('contingency', 'Contingencia', 'risk', 1, contOk ? 'ok' : 'warning',
    contOk ? 'Contingencia configurada.' : 'Sin contingencia: cualquier imprevisto sale del margen.'));

  // 13. Margen (un margen inválido — ≥ 100 %, negativo o texto — no cuenta como definido)
  const marginBlank = isBlank(pricing.targetMarginPct);
  const marginValue = toNumber(pricing.targetMarginPct, NaN);
  const marginInvalid = !marginBlank && !isValidMarginPct(marginValue);
  const marginPositive = !marginBlank && !marginInvalid && marginValue > 0;
  items.push(rule('margin', 'Margen objetivo', 'margin', 2, marginBlank || marginInvalid ? 'missing' : marginPositive ? 'ok' : 'warning',
    marginBlank
      ? 'Falta definir el margen objetivo.'
      : marginInvalid
        ? 'El margen objetivo debe ser mayor o igual a 0 y menor a 100 %.'
        : marginPositive
          ? 'Margen objetivo definido.'
          : 'Margen objetivo en 0 %: cotizás sin ganancia.'));

  // 14. Standby (on-call)
  if (isOnCall) {
    const ok = nonNegative(rules.standbyRatePerDay) > 0 || rules.standbyNotApplicable === true;
    items.push(rule('standby', 'Standby', 'margin', 1, ok ? 'ok' : 'warning',
      ok ? 'Standby definido.' : 'Standby no definido: ¿qué se cobra si el equipo queda en locación sin operar?'));
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
  const order = { missing: 0, warning: 1, ok: 2 };
  const pending = items.filter((i) => i.status !== 'ok').sort((a, b) => order[a.status] - order[b.status]);
  return { scorePct, items, pending, counts };
}
