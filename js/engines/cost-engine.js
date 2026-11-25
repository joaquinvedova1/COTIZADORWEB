/**
 * CostEngine — arma la estructura de costos de una cotización.
 *
 * Toda la economía del servicio se expresa como:
 *
 *   Costo(D) = F × factorMeses(D) + v × D
 *
 *   F = costos fijos mensuales (existen aunque no haya actividad)
 *   v = costos variables por día de trabajo
 *   D = días de trabajo (facturables) en el mes
 *   factorMeses(D) = max(1, D / díasDisponiblesMes)  (sólo > 1 si D supera
 *                    los días disponibles: se interpreta como trabajo de
 *                    varios meses y se prorratean los fijos)
 *
 * Orden de cálculo:
 *   1. Costos directos (personal, standby, equipos propios, equipos y
 *      servicios externos, combustible, materiales, movilización, logística
 *      auxiliar, otros)
 *   2. Estructura (costos indirectos) según método de absorción
 *   3. Financiero (sobre costos en efectivo: directos + estructura)
 *   4. Contingencia = % × (directos + estructura + financiero)
 *   5. Inflación esperada con precio fijo (K-01, apagada salvo que se elija):
 *      (f − 1) × (directos + estructura + financiero + contingencia),
 *      f = ((1 + π)^n − 1) / (n × π) (ver js/domain/price-adjustment.js)
 *
 * "Cada salida se cuenta completa" (PLAN-2026-011, opcional, apagado por
 * defecto): las intervenciones estimadas A = D / días por intervención siguen
 * siendo un promedio (producción y facturación no cambian), pero los costos
 * físicamente indivisibles POR SALIDA (movilización, peajes, viáticos,
 * vehículos de apoyo, cargos de proveedor por llamado / viaje / km o con
 * mínimo por llamado, materiales y otros costos por llamado) se costean con
 * ⌈A⌉ salidas:
 *   ajuste(D) = (⌈A⌉ − A) × costo discreto por salida
 *               (+ su estructura si es %, su financiación y su contingencia)
 * Apagado (o con A entero) el costo es exactamente el de siempre.
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide, roundPercentagesToTotal, roundPercentage, toNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { COST_CATEGORIES, CATEGORY_PAY_GROUP, DIRECT_CATEGORY_IDS, PAY_GROUPS, MATERIAL_PROVIDERS, AVAILABILITY_WINDOW } from '../domain/catalogs.js';
import { computeLabor } from './labor-engine.js';
import { computeContractedStaff } from './contracted-staff-engine.js';
import { travelDaysOf, rotationCoverageOf } from './rotation-engine.js';
import { computeEquipmentLine } from './equipment-engine.js';
import { computeLogistics } from './logistics-engine.js';
import { computeMaterials, computeOtherCostLine } from './materials-engine.js';
import { computeFinance, financingDaysOf } from './finance-engine.js';
import { computeExternalLine } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { computeExtras } from './extras-engine.js';
import { outOfHoursBasis, resolveExtras } from './out-of-hours-engine.js';
import { computeOvertimeWork, overtimeAllMonthlyAt } from './overtime-work-engine.js';
import { routeTrips, transportSummary } from './transport-engine.js';
import { conversionFactor, currencyOfBase, quoteCurrency } from './currency-engine.js';
import { billingUnitOf } from '../domain/billing-units.js';
import { contractOf, LINE_COMPONENT_IDS } from '../domain/contract.js';
import { materialTypeShort } from '../domain/material-types.js';
import { usesTimeBasis, resolveUnitHours, defaultEquipmentBillableHours } from '../domain/cost-basis.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS } from '../domain/catalogs.js';
import { activationTerms } from '../domain/activation-terms.js';
import { formatMoney, formatNumber } from '../core/format.js';
import { priceAdjustmentOf } from '../domain/price-adjustment.js';
import { vatFinanceOf } from '../domain/vat-finance.js';

/**
 * Días de trabajo que lleva facturar una cantidad (PLAN-2026-009). UNIDAD DE
 * VENTA ≠ UNIDAD DE COSTO: los costos se calculan con los días de trabajo y
 * la facturación se expresa en la unidad comercial.
 *
 *   por cantidad (m³, viaje…): llamados = cantidad / max(días por llamado × cantidad por día, mínimo por llamado)
 *                              días     = llamados × días por llamado      (sin mínimo: cantidad / cantidad por día)
 *   por evento (llamado, trabajo, hito): llamados = cantidad / hitos por trabajo (1 si no es por hito)
 *                              días     = llamados × días por llamado (o por trabajo)
 */
export function activeDaysForQuantity({ kind, quantity, unitsPerActiveDay, unitsPerActivation, daysPerActivation, minimumCallUnits = 0 }) {
  const Q = nonNegative(quantity);
  const dpa = nonNegative(daysPerActivation) > 0 ? nonNegative(daysPerActivation) : 1;
  if (kind === 'event') {
    const upa = nonNegative(unitsPerActivation) > 0 ? nonNegative(unitsPerActivation) : 1;
    return (Q / upa) * dpa;
  }
  const perActivation = Math.max(dpa * nonNegative(unitsPerActiveDay), nonNegative(minimumCallUnits));
  return perActivation > 0 ? (Q / perActivation) * dpa : 0;
}

/**
 * Unidades producidas por día de trabajo según cómo se cobra (PLAN-2026-021, ampliado por
 * PLAN-2026-022): la base de los materiales y otros costos "por unidad producida" cuando la
 * línea no carga su propia producción. Son las unidades que se TRABAJAN (sin el relleno del
 * mínimo por llamado: un consumible se gasta en la válvula que se atiende, no en la que se
 * factura de mínimo).
 *   cantidad (m³, válvula…) q por día · hora H · día 1 · llamado / trabajo / hito: hitos ÷ días por trabajo
 *   mes: 0 (cada línea carga lo suyo)
 */
export function autoOutputPerActiveDay(activity = {}) {
  const a = activity || {};
  if (a.unitKind === 'quantity') return nonNegative(a.unitsPerActiveDay);
  if (a.unitKind === 'hour') return nonNegative(a.hoursPerActiveDay);
  if (a.unitKind === 'day') return 1;
  if (a.unitKind === 'event') {
    const dpa = nonNegative(a.daysPerActivation) > 0 ? nonNegative(a.daysPerActivation) : 1;
    return (nonNegative(a.unitsPerActivation) > 0 ? nonNegative(a.unitsPerActivation) : 1) / dpa;
  }
  return 0;
}

/**
 * Horas de guardia por día: 24 con 24/7; con franja, las cargadas (máx. 24) o null si faltan.
 * Disponibilidad sin elegir → null. No mueve costos ni facturación: sólo avisos.
 */
export function availabilityHoursOf(a = {}) {
  if (a.availability === '24/7') return 24;
  if (a.availability !== AVAILABILITY_WINDOW) return null;
  const v = a.availabilityHoursPerDay;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 24) : null;
}

/**
 * Horas que un equipo propio SIN dato trabaja y factura por mes (por tiempo usado, §29): las
 * horas del día de trabajo × los días del mes (22 hábiles; 30 si trabaja más de 12 h por día,
 * servicio continuo), nunca menos que las horas normales de la cuadrilla. Así un equipo que
 * trabaja todo el mes a ese ritmo paga una vez su posesión, no varias (un generador de 24 h
 * dividido por las 176 h de la gente se cobraba 4 veces).
 */
export { defaultEquipmentBillableHours };

/** Normaliza los parámetros de actividad de una cotización. */
export function normalizeActivity(quote = {}) {
  const a = quote.activity || {};
  const availableRaw = Math.min(nonNegative(a.availableDaysPerMonth, 30), 31);
  // 0 o inválido no tiene sentido económico: se usa 30 (y validateQuote lo informa).
  const availableDaysPerMonth = availableRaw > 0 ? availableRaw : 30;
  // Cómo viaja el personal (PLAN-2026-024): todos los días = 1; con los relevos = los del
  // diagrama de Personal. Sin elegir, el número guardado (como siempre).
  const travel = travelDaysOf(quote);
  const dpaRaw = travel.days !== null ? travel.days : nonNegative(a.daysPerActivation, 1);
  const daysPerActivation = dpaRaw > 0 ? dpaRaw : 1;
  const hoursPerActiveDay = Math.min(nonNegative(a.hoursPerActiveDay), 24);
  // Por día, hora o mes la actividad se carga en días (como siempre). Por
  // cantidad o por evento se carga en la unidad comercial y los días de
  // trabajo se derivan (PLAN-2026-009).
  const unit = billingUnitOf(quote);
  const byQuantity = unit.kind === 'quantity' || unit.kind === 'event';
  const billableQuantityPerMonth = byQuantity ? nonNegative(a.billableQuantityPerMonth) : null;
  const unitsPerActiveDay = unit.kind === 'quantity' ? nonNegative(a.unitsPerActiveDay) : null;
  const unitsPerActivation = unit.kind === 'event' ? (unit.id === 'milestone' && nonNegative(a.unitsPerActivation) > 0 ? nonNegative(a.unitsPerActivation) : 1) : null;
  const activeDaysPerMonth = byQuantity
    ? activeDaysForQuantity({
      kind: unit.kind,
      quantity: billableQuantityPerMonth,
      unitsPerActiveDay,
      unitsPerActivation,
      daysPerActivation,
      minimumCallUnits: quote.rules ? quote.rules.minimumCallUnits : 0,
    })
    : nonNegative(a.activeDaysPerMonth);
  return {
    unitKind: unit.kind,
    billableQuantityPerMonth,
    unitsPerActiveDay,
    unitsPerActivation,
    availability: a.availability || '24/7',
    availabilityWindow: a.availabilityWindow || '',
    // Horas de guardia por día (franja, 2026-11): cuándo el cliente puede llamar. No son las
    // horas que se facturan (ésas son hoursPerActiveDay). 24/7 = 24 h; franja sin cargar = null.
    availabilityHoursPerDay: availabilityHoursOf(a),
    responseTimeHours: nonNegative(a.responseTimeHours),
    availableDaysPerMonth,
    activeDaysPerMonth,
    daysPerActivation,
    travelPattern: travel.pattern,
    travelRelief: travel.relief,
    hoursPerActiveDay,
    activationsPerMonth: activeDaysPerMonth / daysPerActivation,
    utilizationPct: availableDaysPerMonth > 0 ? (activeDaysPerMonth / availableDaysPerMonth) * 100 : null,
    // PLAN-2026-011: cada salida se cuenta completa (sólo los costos por salida).
    fullActivations: a.fullActivations === true,
  };
}

/**
 * Costo del mes de una línea de materiales u otros costos con la actividad estimada (para
 * mostrar al lado de la línea; no entra en ningún cálculo): fijo + variable × D, y las unidades
 * producidas del mes si es "por unidad producida" (PLAN-2026-022).
 */
function withEstimate(line, activity) {
  const D = nonNegative(activity.activeDaysPerMonth);
  const perUnit = line.basis === 'per_output' || line.behavior === 'per_output';
  return {
    ...line,
    monthlyAtEstimate: line.fixedMonthly + line.variablePerActiveDay * D,
    outputUnitsAtEstimate: perUnit ? nonNegative(line.outputPerActiveDay) * D : null,
  };
}

/** Porcentaje total de contingencia (general + ítems de riesgo habilitados). */
export function contingencyPctOf(risk = {}) {
  const general = nonNegative(risk.generalPct);
  const items = objectList(risk.items)
    .filter((i) => i && i.enabled)
    .reduce((s, i) => s + nonNegative(i.pct), 0);
  return general + items;
}

function emptyBucket() {
  return { fixedMonthly: 0, variablePerActiveDay: 0 };
}

function addTo(bucket, fixed, variable) {
  bucket.fixedMonthly += fixed;
  bucket.variablePerActiveDay += variable;
}

/**
 * Construye el modelo de costos completo.
 * @param {object} quote
 * @returns {object} costModel
 */
export function buildCostModel(quoteInput = {}) {
  const activity = normalizeActivity(quoteInput);
  // 0.19.0: las horas de cada recurso cargadas en la unidad de cobro ("horas por válvula") pasan
  // a horas por día de trabajo con el rendimiento de la cotización (CALCULATION_RULES §36.2).
  const quote = resolveUnitHours(quoteInput, activity);
  const fuelPaidByUs = (quote.fuel && quote.fuel.providedBy) !== 'client';
  const fuelPricePerLiter = nonNegative(quote.fuel && quote.fuel.pricePerLiter);
  const lines = [];

  // 1. Personal
  // Cobertura vendida para la propuesta del esquema de trabajo (PLAN-2026-024): los días de
  // servicio del fijo mensual (o servicio permanente); en el resto, todo el mes, como siempre.
  // Sólo cambia la PROPUESTA del diagrama, nunca el costo.
  const coverageDaysPerMonth = rotationCoverageOf(quote, activity.activeDaysPerMonth);
  // Por tiempo usado (2026-11-18, cotizaciones nuevas que no se cobran por mes): el personal y los
  // equipos propios cuestan sus horas en el trabajo × el valor de su hora (variable por día).
  const timeBasis = usesTimeBasis(quote);
  const labor = computeLabor(quote.labor, { coverageDaysPerMonth, timeBasis, hoursPerActiveDay: activity.hoursPerActiveDay, activeDaysPerMonth: activity.activeDaysPerMonth });
  // Horas facturables de un equipo propio sin dato: las normales de la cuadrilla (las mayores) o el parámetro por defecto.
  const crewNormalHours = objectList(quote.labor).reduce((max, l) => Math.max(max, nonNegative(l.normalHoursPerMonth)), 0);
  const defaultBillableHours = defaultEquipmentBillableHours(activity.hoursPerActiveDay, crewNormalHours > 0 ? crewNormalHours : ILLUSTRATIVE_AGREEMENT_PARAMS.normalHoursPerMonth);
  labor.lines.forEach((l, i) => {
    lines.push({
      key: `labor:${l.id ?? i}`,
      source: 'labor',
      label: l.role || 'Personal',
      category: 'labor',
      payGroup: 'salaries',
      fixedMonthly: l.fixedMonthly,
      variablePerActiveDay: l.variablePerActiveDay,
      cashFixedMonthly: l.fixedMonthly,
      cashVariablePerActiveDay: l.variablePerActiveDay,
    });
  });

  // 1 bis. Personal tercerizado (0.15.0): un valor fijo por hora, por día o por mes, sin sueldo
  // ni cargas. Va al rubro Personal y se paga como proveedor. Sin líneas no suma nada.
  const contractedStaff = computeContractedStaff(quote.contractedStaff, { hoursPerActiveDay: activity.hoursPerActiveDay });
  contractedStaff.lines.forEach((c, i) => {
    lines.push({
      key: `contracted:${c.id ?? i}`,
      source: 'contractedStaff',
      label: `${c.role || 'Personal'} (tercerizado)`,
      category: 'labor',
      payGroup: 'suppliers',
      fixedMonthly: c.fixedMonthly,
      variablePerActiveDay: c.variablePerActiveDay,
      cashFixedMonthly: c.fixedMonthly,
      cashVariablePerActiveDay: c.variablePerActiveDay,
    });
  });

  // Standby: días en locación sin operar. Se costea el variable de personal
  // (vianda + horas extra) de cada día de standby. Es un monto mensual estimado.
  const rules = quote.rules || {};
  const standbyDays = rules.standbyNotApplicable === true ? 0 : nonNegative(rules.standbyDaysPerMonth);
  const standbyCostPerDay = labor.variablePerActiveDay - (labor.timePerActiveDay || 0);
  const standbyMonthly = standbyDays * standbyCostPerDay;
  if (standbyMonthly > 0) {
    lines.push({
      key: 'labor:standby',
      source: 'standby',
      label: 'Standby (personal en locación sin operar)',
      category: 'labor',
      payGroup: 'salaries',
      fixedMonthly: standbyMonthly,
      variablePerActiveDay: 0,
      cashFixedMonthly: standbyMonthly,
      cashVariablePerActiveDay: 0,
    });
  }

  // Moneda (PLAN-2026-005): los valores en otra moneda se convierten con el
  // tipo de cambio de la cotización; si falta, no se suman (factor 0) y la
  // validación lo marca en rojo.
  const currency = quoteCurrency(quote);
  const currencyGaps = [];
  // Sólo es un faltante si el valor nos cuesta algo (un material que provee el
  // cliente o un precio en 0 no necesitan tipo de cambio).
  const factorFor = (base, where, relevant = true) => {
    const cur = currencyOfBase(base);
    const f = conversionFactor(cur, quote);
    if (f === null) {
      if (relevant) currencyGaps.push({ ...where, currency: cur });
      return 0;
    }
    return f;
  };

  // Logística (ruta): la usan la movilización y las tarifas externas por km o
  // viaje. Con la unidad "viaje" los viajes físicos por intervención se derivan
  // de los viajes por día (PLAN-2026-012): "Viajes por llamado" no rige.
  const route = routeTrips(quote, activity);
  const logisticsInput = route.derived || route.byCapacity ? { ...(quote.logistics || {}), tripsPerActivation: route.tripsPerActivation } : quote.logistics || {};
  const logistics = computeLogistics(logisticsInput, {
    activationsPerMonth: activity.activationsPerMonth,
    daysPerActivation: activity.daysPerActivation,
    fuelPricePerLiter,
    fuelPaidByUs,
  });
  const oneWayTripsPerActivation = logistics.notApplicable ? 0 : logistics.tripsPerActivation * (logistics.roundTrip ? 2 : 1);

  // 2. Equipos. PROPIOS: posesión → fijo, operación → variable, combustible
  // aparte. ALQUILADOS / TERCERIZADOS: costo externo (tarifa del proveedor,
  // costo económico sin IVA recuperable). model.equipment queda alineado con
  // quote.equipment (mismo índice).
  const equipmentInput = objectList(quote.equipment);
  const external = [];
  const closedContract = contractOf(quote).mode === 'closed';
  const equipment = equipmentInput.map((e, index) => {
    const acquisition = e.acquisition === 'rented' || e.acquisition === 'outsourced' ? e.acquisition : 'owned';
    if (acquisition === 'owned') {
      const f = factorFor(e.base, { list: 'equipment', index, field: 'base', label: e.name || 'Equipo' }, nonNegative(e.quantity) > 0 && (nonNegative(e.replacementValue) > 0 || nonNegative(e.residualValue) > 0));
      const converted = f === 1 ? e : { ...e, replacementValue: nonNegative(e.replacementValue) * f, residualValue: nonNegative(e.residualValue) * f };
      return { ...computeEquipmentLine(converted, { fuelPricePerLiter, fuelPaidByUs, defaultHoursPerActiveDay: activity.hoursPerActiveDay, timeBasis, defaultBillableHours }), acquisition, conversion: f, external: null };
    }
    const ext = e.external && typeof e.external === 'object' ? e.external : {};
    const f = factorFor(e.base, { list: 'equipment', index, field: 'base', label: e.name || 'Equipo externo' }, nonNegative(e.quantity) > 0 && (nonNegative(ext.price) > 0 || (ext.mobilizationIncluded === false && nonNegative(ext.mobilizationAmount) > 0)));
    const x = computeExternalLine({ ...e, acquisition }, {
      daysPerActivation: activity.daysPerActivation,
      defaultHoursPerActiveDay: activity.hoursPerActiveDay,
      routeKmPerActivation: logistics.routeKmPerActivation,
      tripsPerActivation: oneWayTripsPerActivation,
      // Viajes completos de la ruta (ECO-01): para un proveedor que cobra por viaje ida y vuelta.
      fullTripsPerActivation: logistics.notApplicable ? 0 : logistics.tripsPerActivation,
      contractMonths: quote.contractMonths,
      // Precio cerrado (V-02): "global" = toda la obra, repartida en sus trabajos.
      globalJobs: closedContract ? (nonNegative(quote.contractJobs) > 0 ? nonNegative(quote.contractJobs) : 1) : null,
      fuelPricePerLiter,
      fuelPaidByUs,
      conversion: f,
    });
    external.push({ ...x, index });
    return {
      id: x.id,
      name: x.name,
      acquisition,
      quantity: x.quantity,
      hoursPerActiveDay: x.hoursPerActiveDay,
      conversion: f,
      ownership: null,
      operation: null,
      external: x,
      fixedMonthly: x.fixedMonthly,
      fixedCashMonthly: x.fixedMonthly,
      nonFuelPerActiveDay: x.variablePerActiveDay + x.mobilizationPerActiveDay,
      fuelPerActiveDay: x.fuelPerActiveDay,
      fuelLitersPerActiveDay: x.fuelLitersPerActiveDay,
      variablePerActiveDay: x.variablePerActiveDay + x.mobilizationPerActiveDay + x.fuelPerActiveDay,
    };
  });
  // PLAN-2026-011 + unidad "viaje": con viajes derivados, lo que depende de
  // km o viajes no es indivisible por salida (sigue a los viajes facturados).
  const kmDriven = (x) => route.derived && x && ['km', 'trip'].includes(x.unit);
  equipment.forEach((e, i) => {
    const name = e.name || 'Equipo';
    if (e.acquisition !== 'owned') {
      const x = e.external;
      const kind = e.acquisition === 'rented' ? 'alquilado' : 'tercerizado';
      // Plazo de pago propio de este proveedor (PLAN-2026-011): vacío = el de "Proveedores".
      const ownTerm = optionalNumber((equipmentInput[i] || {}).supplierPayDays);
      const finance = ownTerm !== null && ownTerm >= 0 ? { key: `supplier:${e.id ?? i}`, label: name, payDays: ownTerm, index: i } : null;
      lines.push({
        key: `external:${e.id ?? i}`,
        source: 'external',
        label: `${name} — ${kind}`,
        category: 'external',
        payGroup: 'suppliers',
        fixedMonthly: x.fixedMonthly,
        variablePerActiveDay: x.variablePerActiveDay,
        // Se financia la SALIDA DE CAJA (neto + IVA + percepciones + cargos), no
        // el costo económico: el IVA recuperable y las percepciones son caja que
        // la empresa adelanta al proveedor hasta cobrar. Sin tratamiento fiscal
        // definido, caja = costo (como siempre).
        cashFixedMonthly: x.cashFixedMonthly,
        cashVariablePerActiveDay: x.cashVariablePerActiveDay,
        // Unidad "viaje" (viajes derivados): los km y viajes siguen a los viajes
        // facturados, no a las salidas; redondear salidas no agrega viajes.
        discretePerActivation: kmDriven(x) ? 0 : x.discretePerActivation,
        cashDiscretePerActivation: kmDriven(x) ? 0 : x.cashDiscretePerActivation,
        finance,
      });
      if (x.mobilizationPerActiveDay > 0) {
        lines.push({
          key: `external:mobilization:${e.id ?? i}`,
          source: 'external',
          label: `${name} — movilización del proveedor`,
          category: 'external',
          payGroup: 'suppliers',
          fixedMonthly: 0,
          variablePerActiveDay: x.mobilizationPerActiveDay,
          cashFixedMonthly: 0,
          cashVariablePerActiveDay: x.cashMobilizationPerActiveDay,
          discretePerActivation: x.mobilizationPerActivation,
          cashDiscretePerActivation: x.cashMobilizationPerActivation,
          finance,
        });
      }
      if (x.fuelPerActiveDay > 0) {
        lines.push({
          key: `external:fuel:${e.id ?? i}`,
          source: 'external',
          label: `${name} — combustible (no incluido en la tarifa)`,
          category: 'fuel',
          payGroup: 'fuel',
          fixedMonthly: 0,
          variablePerActiveDay: x.fuelPerActiveDay,
          cashFixedMonthly: 0,
          cashVariablePerActiveDay: x.fuelPerActiveDay,
          // Por km de ruta (PLAN-2026-012) es un costo por salida; por hora, no.
          discretePerActivation: route.derived ? 0 : x.fuelPerActivationRoute,
          cashDiscretePerActivation: route.derived ? 0 : x.fuelPerActivationRoute,
        });
      }
      return;
    }
    lines.push({
      key: `equipment:ownership:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — posesión`,
      category: 'equipment',
      payGroup: 'suppliers',
      fixedMonthly: e.fixedMonthly,
      variablePerActiveDay: e.timeBasis ? e.ownershipPerActiveDay : 0,
      cashFixedMonthly: e.fixedCashMonthly,
      cashVariablePerActiveDay: e.timeBasis ? e.ownershipCashPerActiveDay : 0,
    });
    lines.push({
      key: `equipment:operation:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — operación (mant. y neumáticos)`,
      category: 'equipment',
      payGroup: 'suppliers',
      fixedMonthly: 0,
      variablePerActiveDay: e.nonFuelPerActiveDay,
      cashFixedMonthly: 0,
      cashVariablePerActiveDay: e.nonFuelPerActiveDay,
    });
    lines.push({
      key: `equipment:fuel:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — combustible operativo`,
      category: 'fuel',
      payGroup: 'fuel',
      fixedMonthly: 0,
      variablePerActiveDay: e.fuelPerActiveDay,
      cashFixedMonthly: 0,
      cashVariablePerActiveDay: e.fuelPerActiveDay,
    });
  });

  // Movilización del recurso principal (¿cómo llega cada equipo?): combustible
  // en ruta → Combustible; desgaste por km → Logística. Sin amortización (ya
  // está en la posesión) y sin mano de obra (el operador ya está en Personal).
  const mobilization = computeMobilization(equipmentInput, {
    notApplicable: logistics.notApplicable,
    routeKmPerActivation: logistics.routeKmPerActivation,
    daysPerActivation: activity.daysPerActivation,
    activationsPerMonth: activity.activationsPerMonth,
    fuelPricePerLiter,
    fuelPaidByUs,
    vehicles: (quote.logistics || {}).vehicles,
    labor: quote.labor,
  });
  lines.push({
    key: 'mobilization:fuel',
    source: 'mobilization',
    label: 'Movilización de equipos — combustible en ruta',
    category: 'fuel',
    payGroup: 'fuel',
    fixedMonthly: 0,
    variablePerActiveDay: mobilization.fuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: mobilization.fuelPerActiveDay,
    discretePerActivation: route.derived ? 0 : mobilization.fuelPerActivation,
    cashDiscretePerActivation: route.derived ? 0 : mobilization.fuelPerActivation,
  });
  lines.push({
    key: 'mobilization:other',
    source: 'mobilization',
    label: 'Movilización de equipos — desgaste por km',
    category: 'logistics',
    payGroup: 'suppliers',
    fixedMonthly: 0,
    variablePerActiveDay: mobilization.wearPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: mobilization.wearPerActiveDay,
    discretePerActivation: route.derived ? 0 : mobilization.wearPerActivation,
    cashDiscretePerActivation: route.derived ? 0 : mobilization.wearPerActivation,
  });

  // 3. Logística AUXILIAR (vehículos de apoyo y de personal): combustible →
  // Combustible; desgaste, peajes y viáticos → Logística.
  lines.push({
    key: 'logistics:fuel',
    source: 'logistics',
    label: 'Traslados — combustible',
    category: 'fuel',
    payGroup: 'fuel',
    fixedMonthly: 0,
    variablePerActiveDay: logistics.fuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: logistics.fuelPerActiveDay,
    discretePerActivation: route.derived ? 0 : logistics.fuelPerActivation,
    cashDiscretePerActivation: route.derived ? 0 : logistics.fuelPerActivation,
  });
  lines.push({
    key: 'logistics:other',
    source: 'logistics',
    label: 'Traslados — desgaste, peajes y viáticos',
    category: 'logistics',
    payGroup: 'suppliers',
    fixedMonthly: 0,
    variablePerActiveDay: logistics.nonFuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: logistics.nonFuelPerActiveDay,
    // Con viajes derivados sólo peajes y viáticos son indivisibles por salida.
    discretePerActivation: route.derived ? logistics.tollsPerActivation + logistics.lodgingPerActivation : logistics.nonFuelPerActivation,
    cashDiscretePerActivation: route.derived ? logistics.tollsPerActivation + logistics.lodgingPerActivation : logistics.nonFuelPerActivation,
  });

  // 4. Materiales
  const materialInput = quote.materialsNotApplicable ? [] : objectList(quote.materials).map((m, index) => {
    const provider = MATERIAL_PROVIDERS.find((p) => p.id === m.providedBy);
    const costsUs = !(provider && provider.costForUs === false) && nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0;
    const f = factorFor(m.base, { list: 'materials', index, field: 'base', label: m.description || 'Material' }, costsUs);
    return f === 1 ? m : { ...m, unitCost: nonNegative(m.unitCost) * f };
  });
  // Por unidad producida (PLAN-2026-021 / PLAN-2026-022): lo producido por día de la cotización.
  const outputCtx = { outputPerActiveDay: autoOutputPerActiveDay(activity), billingUnit: billingUnitOf(quote) };
  const materialsRaw = computeMaterials(materialInput, {
    daysPerActivation: activity.daysPerActivation,
    ...outputCtx,
  });
  const materials = { ...materialsRaw, lines: materialsRaw.lines.map((m) => withEstimate(m, activity)) };
  materials.lines.forEach((m, i) => {
    lines.push({
      key: `materials:${m.id ?? i}`,
      source: 'materials',
      label: m.description || 'Material',
      category: 'materials',
      // Categoría de gasto (0.10.0): desglose del renglón Materiales de la EECC.
      component: m.component,
      payGroup: 'materials',
      fixedMonthly: m.fixedMonthly,
      variablePerActiveDay: m.variablePerActiveDay,
      cashFixedMonthly: m.fixedMonthly,
      cashVariablePerActiveDay: m.variablePerActiveDay,
      discretePerActivation: m.basis === 'per_activation' ? m.costForUs : 0,
      cashDiscretePerActivation: m.basis === 'per_activation' ? m.costForUs : 0,
    });
  });

  // 5. Otros costos (terceros, subcontratos, manuales)
  const otherCosts = objectList(quote.otherCosts).map((o) =>
    withEstimate(computeOtherCostLine(o, { daysPerActivation: activity.daysPerActivation, ...outputCtx }), activity),
  );
  otherCosts.forEach((o, i) => {
    const category = DIRECT_CATEGORY_IDS.includes(o.category) ? o.category : 'materials';
    lines.push({
      key: `other:${o.id ?? i}`,
      source: 'other',
      label: o.description || 'Otro costo',
      category,
      component: o.component,
      payGroup: CATEGORY_PAY_GROUP[category] || 'suppliers',
      fixedMonthly: o.fixedMonthly,
      variablePerActiveDay: o.variablePerActiveDay,
      cashFixedMonthly: o.fixedMonthly,
      cashVariablePerActiveDay: o.variablePerActiveDay,
      discretePerActivation: o.behavior === 'per_activation' ? o.amount : 0,
      cashDiscretePerActivation: o.behavior === 'per_activation' ? o.amount : 0,
    });
  });

  // 5 bis. Adicionales que se cobran aparte (PLAN-2026-018): su costo directo
  // estimado del mes (cantidad × costo por unidad), fijo: no depende de los
  // días de trabajo del precio principal.
  // Cada adicional va a la categoría de costo que eligió la persona (personal por defecto).
  // Tarifas fuera de horario (PLAN-2026-025): su costo por hora sale de los recursos.
  const outOfHours = outOfHoursBasis(labor, equipment);
  const resolvedExtras = resolveExtras(quote.extras, outOfHours);
  // Horas extra del trabajo (2026-11-18): un concepto más del personal, dentro del precio único.
  const overtimeWork = computeOvertimeWork(quote, labor, activity, { contractMode: contractOf(quote).mode, equipmentPerHour: outOfHours.equipmentPerHour });
  if (overtimeWork.active) {
    lines.push({
      key: 'labor:overtime-work',
      source: 'labor',
      label: overtimeWork.mode === 'all' ? `Horas extra (todo el trabajo al ${overtimeWork.premiumPct}\u00a0%)` : 'Horas extra del trabajo',
      category: 'labor',
      payGroup: 'salaries',
      fixedMonthly: overtimeWork.fixedMonthly,
      variablePerActiveDay: overtimeWork.variablePerActiveDay,
      cashFixedMonthly: overtimeWork.fixedMonthly,
      cashVariablePerActiveDay: overtimeWork.variablePerActiveDay,
    });
  }

  computeExtras(resolvedExtras).lines.forEach((x, i) => {
    if (!(x.cost > 0)) return;
    const category = DIRECT_CATEGORY_IDS.includes(x.category) && x.category !== 'structure' ? x.category : 'labor';
    lines.push({
      key: `extra:${x.id ?? i}`,
      source: 'extra',
      label: x.label,
      category,
      payGroup: CATEGORY_PAY_GROUP[category] || 'suppliers',
      fixedMonthly: x.cost,
      variablePerActiveDay: 0,
      cashFixedMonthly: x.cost,
      cashVariablePerActiveDay: 0,
      discretePerActivation: 0,
      cashDiscretePerActivation: 0,
    });
  });

  // Base directa (excluye lo cargado manualmente como "estructura")
  const direct = emptyBucket();
  const laborBucket = emptyBucket();
  lines.forEach((l) => {
    if (l.category !== 'structure') addTo(direct, l.fixedMonthly, l.variablePerActiveDay);
    if (l.category === 'labor') addTo(laborBucket, l.fixedMonthly, l.variablePerActiveDay);
  });

  // 6. Estructura (indirectos). Modo simple (el de siempre): un método para
  // toda la estructura. Modo desglosado (PLAN-2026-010, opcional): cada rubro
  // con su propio método (administración % directo, HSE por empleado…).
  const indirect = quote.indirect || {};
  const method = indirect.method || 'percent_direct';
  const indirectPct = nonNegative(indirect.pct);
  const indirectAmount = nonNegative(indirect.amount);
  const structureBy = (m, pctValue, amount) => {
    switch (m) {
      case 'percent_direct':
        return { fixed: direct.fixedMonthly * pct(pctValue), variable: direct.variablePerActiveDay * pct(pctValue) };
      case 'percent_labor':
        return { fixed: laborBucket.fixedMonthly * pct(pctValue), variable: laborBucket.variablePerActiveDay * pct(pctValue) };
      case 'per_employee':
        // Dotación equivalente: una persona compartida cuenta por su % asignado (PLAN-2026-012).
        // Por tiempo usado: sigue a las horas del trabajo (personas × horas del día ÷ horas facturables).
        if (timeBasis) return { fixed: amount * (labor.fullMonthHeadcount || 0), variable: amount * labor.timeHeadcountPerActiveDay };
        return { fixed: amount * labor.effectiveHeadcount, variable: 0 };
      case 'per_hour':
        return { fixed: 0, variable: amount * activity.hoursPerActiveDay };
      case 'per_contract':
      case 'manual':
      default:
        return { fixed: amount, variable: 0 };
    }
  };
  const detailed = indirect.mode === 'detailed' && Array.isArray(indirect.items);
  const structureItems = detailed
    ? objectList(indirect.items).map((it, idx) => {
      const m = typeof it.method === 'string' && it.method ? it.method : 'percent_direct';
      const value = structureBy(m, nonNegative(it.pct), nonNegative(it.amount));
      return { id: it.id ?? `item-${idx}`, label: typeof it.label === 'string' && it.label.trim() ? it.label.trim() : 'Rubro de estructura', method: m, pct: nonNegative(it.pct), amount: nonNegative(it.amount), fixedMonthly: value.fixed, variablePerActiveDay: value.variable };
    })
    : [];
  const simple = detailed ? null : structureBy(method, indirectPct, indirectAmount);
  const structureFixed = detailed ? structureItems.reduce((acc, it) => acc + it.fixedMonthly, 0) : simple.fixed;
  const structureVariable = detailed ? structureItems.reduce((acc, it) => acc + it.variablePerActiveDay, 0) : simple.variable;
  lines.push({
    key: 'structure:absorption',
    source: 'structure',
    label: 'Estructura de empresa (absorción)',
    category: 'structure',
    payGroup: 'structure',
    fixedMonthly: structureFixed,
    variablePerActiveDay: structureVariable,
    cashFixedMonthly: structureFixed,
    cashVariablePerActiveDay: structureVariable,
  });

  // 7. Financiero. Un externo con plazo de pago propio se financia aparte
  // (PLAN-2026-011); sin plazo propio, en su grupo como siempre.
  const cashByGroup = Object.fromEntries(PAY_GROUPS.map((g) => [g.id, emptyBucket()]));
  const supplierTerms = new Map();
  lines.forEach((l) => {
    if (l.finance) {
      if (!supplierTerms.has(l.finance.key)) supplierTerms.set(l.finance.key, { ...l.finance, fixedMonthly: 0, variablePerActiveDay: 0 });
      addTo(supplierTerms.get(l.finance.key), l.cashFixedMonthly, l.cashVariablePerActiveDay);
      return;
    }
    addTo(cashByGroup[l.payGroup] || cashByGroup.suppliers, l.cashFixedMonthly, l.cashVariablePerActiveDay);
  });
  const financeRaw = computeFinance(cashByGroup, quote.finance || {}, { suppliers: [...supplierTerms.values()] });
  // 7 bis. Costo financiero del IVA (K-03): el IVA recuperable CONOCIDO de los externos baja el IVA
  // que se adelanta al fisco, y con eso el costo financiero: alivio = crédito × tasa × d/30, con
  // d = max(0, plazo de cobro − días hasta pagar el IVA). Piso 0 en el fijo y en el variable (el
  // financiero nunca queda negativo). Apagado (sin "Sí" o sin datos): el financiero de siempre.
  const vat = vatFinanceOf(quote);
  const vatRelief = (() => {
    const rate = pct(financeRaw.monthlyRatePct);
    const factor = vat.active ? rate * (vat.days / 30) : 0;
    const creditFixedMonthly = external.reduce((acc, x) => acc + nonNegative(x.vatCreditFixedMonthly), 0);
    const creditPerActiveDay = external.reduce((acc, x) => acc + nonNegative(x.vatCreditPerActiveDay), 0);
    // Tope: el crédito sólo alivia hasta el IVA que se factura. Como piso conservador del IVA de
    // venta se usa IVA % × costo antes del alivio (el precio nunca es menor que el costo); lo que
    // sobra es saldo a favor, que no se adelanta al fisco. Con IVA 0 % no hay alivio.
    const vatShare = vat.active ? pct(nonNegative(vat.ratePct)) : 0;
    const baseFixed = lines.reduce((acc, l) => acc + nonNegative(l.fixedMonthly), 0) + financeRaw.fixedMonthly;
    const baseVariable = lines.reduce((acc, l) => acc + nonNegative(l.variablePerActiveDay), 0) + financeRaw.variablePerActiveDay;
    const usedFixed = Math.min(creditFixedMonthly, vatShare * baseFixed);
    const usedVariable = Math.min(creditPerActiveDay, vatShare * baseVariable);
    const reliefFixed = usedFixed * factor;
    const reliefVariable = usedVariable * factor;
    return {
      active: vat.active && factor > 0 && (reliefFixed > 0 || reliefVariable > 0),
      days: vat.days,
      creditFixedMonthly: vat.active ? creditFixedMonthly : 0,
      creditPerActiveDay: vat.active ? creditPerActiveDay : 0,
      // Crédito que se usa de verdad (con el tope del IVA que se factura).
      creditUsedFixedMonthly: vat.active ? usedFixed : 0,
      creditUsedPerActiveDay: vat.active ? usedVariable : 0,
      // Lo que se descuenta de verdad (con el piso 0 de cada parte).
      fixedMonthly: Math.min(reliefFixed, financeRaw.fixedMonthly),
      variablePerActiveDay: Math.min(reliefVariable, financeRaw.variablePerActiveDay),
      grossFixedMonthly: financeRaw.fixedMonthly,
      grossVariablePerActiveDay: financeRaw.variablePerActiveDay,
    };
  })();
  const finance = vatRelief.active
    ? {
      ...financeRaw,
      fixedMonthly: Math.max(0, financeRaw.fixedMonthly - vatRelief.fixedMonthly),
      variablePerActiveDay: Math.max(0, financeRaw.variablePerActiveDay - vatRelief.variablePerActiveDay),
      vat,
      vatRelief,
    }
    : { ...financeRaw, vat, vatRelief };

  // 8. Contingencia
  const preContingency = emptyBucket();
  lines.forEach((l) => addTo(preContingency, l.fixedMonthly, l.variablePerActiveDay));
  addTo(preContingency, finance.fixedMonthly, finance.variablePerActiveDay);
  const contingencyPct = contingencyPctOf(quote.risk || {});
  const contingency = {
    pct: contingencyPct,
    fixedMonthly: preContingency.fixedMonthly * pct(contingencyPct),
    variablePerActiveDay: preContingency.variablePerActiveDay * pct(contingencyPct),
  };

  // 9. Inflación esperada con precio fijo (K-01): el precio queda parejo todo el contrato y cubre
  // el costo PROMEDIO = costo de hoy × f. Se suma (f − 1) × todo lo anterior (fijo y variable).
  const adjustment = priceAdjustmentOf(quote);
  const inflationMult = adjustment.active ? adjustment.factor - 1 : 0;
  const inflation = {
    active: adjustment.active,
    factor: adjustment.factor,
    months: adjustment.months,
    pct: adjustment.pct,
    lastMonthFactor: adjustment.lastMonthFactor,
    fixedMonthly: (preContingency.fixedMonthly + contingency.fixedMonthly) * inflationMult,
    variablePerActiveDay: (preContingency.variablePerActiveDay + contingency.variablePerActiveDay) * inflationMult,
  };

  // Totales por categoría (EECC)
  const byCategory = Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, emptyBucket()]));
  lines.forEach((l) => addTo(byCategory[l.category], l.fixedMonthly, l.variablePerActiveDay));
  addTo(byCategory.financial, finance.fixedMonthly, finance.variablePerActiveDay);
  addTo(byCategory.contingency, contingency.fixedMonthly, contingency.variablePerActiveDay);
  addTo(byCategory.inflation, inflation.fixedMonthly, inflation.variablePerActiveDay);

  const total = emptyBucket();
  Object.values(byCategory).forEach((b) => addTo(total, b.fixedMonthly, b.variablePerActiveDay));

  // "Cada salida se cuenta completa" (PLAN-2026-011): costo de UNA salida
  // completa de lo físicamente indivisible, con su estructura (sólo la que es
  // %), su financiación y su contingencia. Se calcula siempre (para mostrar
  // cuánto sumaría) y sólo se aplica si la opción está activa.
  const perActivation = (() => {
    const byCat = Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, 0]));
    const cashByKey = {};
    const bySource = {};
    let direct = 0;
    let laborDirect = 0;
    lines.forEach((l) => {
      const amount = nonNegative(l.discretePerActivation);
      const cash = nonNegative(l.cashDiscretePerActivation);
      if (!(amount > 0) && !(cash > 0)) return;
      byCat[l.category] += amount;
      bySource[l.source] = (bySource[l.source] || 0) + amount;
      if (l.category !== 'structure') direct += amount;
      if (l.category === 'labor') laborDirect += amount;
      const key = l.finance ? l.finance.key : PAY_GROUPS.some((g) => g.id === l.payGroup) ? l.payGroup : 'suppliers';
      cashByKey[key] = (cashByKey[key] || 0) + cash;
    });
    // Estructura: sólo la parte que es un % del costo (la mensual fija no cambia).
    const structurePart = (m, pctValue) => (m === 'percent_direct' ? direct * pct(pctValue) : m === 'percent_labor' ? laborDirect * pct(pctValue) : 0);
    const structure = detailed
      ? structureItems.reduce((acc, it) => acc + structurePart(it.method, it.pct), 0)
      : structurePart(method, indirectPct);
    byCat.structure += structure;
    cashByKey.structure = (cashByKey.structure || 0) + structure;
    const rate = pct(finance.monthlyRatePct);
    let financial = 0;
    let workingCapital = 0;
    Object.entries(cashByKey).forEach(([key, cash]) => {
      const days = financingDaysOf(finance, key);
      workingCapital += cash * (days / 30);
      financial += cash * rate * (days / 30);
    });
    byCat.financial += financial;
    const preCont = COST_CATEGORIES.filter((c) => c.id !== 'contingency' && c.id !== 'inflation').reduce((acc, c) => acc + byCat[c.id], 0);
    const contingencyAmount = preCont * pct(contingencyPct);
    byCat.contingency += contingencyAmount;
    // Inflación con precio fijo (K-01): la salida completa también se paga a costo promedio.
    const inflationAmount = (preCont + contingencyAmount) * inflationMult;
    byCat.inflation += inflationAmount;
    const totalAmount = COST_CATEGORIES.reduce((acc, c) => acc + byCat[c.id], 0);
    return { direct, structure, financial, contingency: contingencyAmount, inflation: inflationAmount, workingCapital, byCategory: byCat, bySource, cashByKey, total: totalAmount };
  })();

  // Horas extra de "todo el trabajo" con OTROS días (M1, 2026-11-18): no son lineales (recargo hasta
  // las horas que paga el sueldo, hora completa después). Cada peso de diferencia contra el promedio
  // por día lleva su estructura (sólo la que es %), su financiación (salarios) y su contingencia.
  const overtimeCurve = (() => {
    if (overtimeWork.mode !== 'all' || !overtimeWork.perRole.length) return null;
    const structurePctOf = (m, pctValue) => (m === 'percent_direct' || m === 'percent_labor' ? pct(pctValue) : 0);
    const s = detailed
      ? structureItems.reduce((acc, it) => acc + structurePctOf(it.method, it.pct), 0)
      : structurePctOf(method, indirectPct);
    const rate = pct(finance.monthlyRatePct);
    const factorOf = (id) => {
      const g = finance.groups.find((x) => x.id === id);
      return g ? g.financingDays / 30 : 0;
    };
    const financial = rate * (factorOf('salaries') + s * factorOf('structure'));
    const contingencyMult = pct(contingencyPct) * (1 + s + financial);
    const byCat = { labor: 1, structure: s, financial, contingency: contingencyMult };
    // Inflación con precio fijo (K-01): sólo si está activa (apagada, el mapa es el de siempre).
    if (inflationMult > 0) byCat.inflation = inflationMult * (1 + s + financial + contingencyMult);
    return {
      overtimeWork,
      variablePerActiveDay: overtimeWork.variablePerActiveDay,
      byCategory: byCat,
    };
  })();

  // Resumen de transporte (PLAN-2026-012): viajes facturables, físicos y km.
  const transport = transportSummary({ quote, activity, route, logistics, external });

  return {
    activity,
    timeBasis,
    transport,
    fuel: { pricePerLiter: fuelPricePerLiter, paidByUs: fuelPaidByUs, providedBy: quote.fuel && quote.fuel.providedBy ? quote.fuel.providedBy : null },
    labor,
    contractedStaff,
    overtimeWork,
    overtimeCurve,
    standby: { days: standbyDays, costPerDay: standbyCostPerDay, monthly: standbyMonthly },
    equipment,
    external,
    mobilization,
    logistics,
    materials,
    otherCosts,
    // Base por hora de las tarifas fuera de horario y adicionales con ese costo ya derivado.
    outOfHours,
    resolvedExtras,
    currency: { code: currency, gaps: currencyGaps },
    lines,
    direct,
    structure: {
      mode: detailed ? 'detailed' : 'simple',
      method,
      pct: indirectPct,
      amount: indirectAmount,
      items: structureItems,
      fixedMonthly: structureFixed,
      variablePerActiveDay: structureVariable,
    },
    finance,
    contingency,
    // K-01: inflación esperada con precio fijo ({ active: false, factor: 1 } si no aplica).
    inflation,
    byCategory,
    fixedMonthly: total.fixedMonthly,
    variablePerActiveDay: total.variablePerActiveDay,
    activationRounding: {
      enabled: activity.fullActivations === true,
      daysPerActivation: activity.daysPerActivation,
      perActivation,
      // Para nombrar la activación en las trazas (llamado / salida / intervención, PLAN-2026-014).
      terms: { serviceType: typeof quote.serviceType === 'string' ? quote.serviceType : null, unit: typeof quote.unit === 'string' ? quote.unit : null, contract: quote.contract && typeof quote.contract === 'object' && Array.isArray(quote.contract.components) ? { components: [...quote.contract.components] } : null },
    },
  };
}

/**
 * Salidas estimadas y costeadas con D días (PLAN-2026-011). `force` calcula el
 * ajuste aunque la opción esté apagada (para mostrar cuánto sumaría).
 */
export function activationRoundingAt(model, activeDays, { force = false } = {}) {
  const r = model && model.activationRounding;
  const D = nonNegative(activeDays);
  const dpa = r && r.daysPerActivation > 0 ? r.daysPerActivation : 1;
  const estimated = D / dpa;
  const costed = estimated > 1e-12 ? Math.ceil(estimated - 1e-9) : 0;
  const extra = Math.max(0, costed - estimated);
  const enabled = Boolean(r && r.enabled);
  const apply = Boolean(r) && (enabled || force);
  const per = apply ? r.perActivation : null;
  const scale = (v) => (per ? v * extra : 0);
  return {
    enabled,
    estimated,
    costed: enabled ? Math.max(costed, estimated) : estimated,
    wholeActivations: costed,
    extraActivations: extra,
    perActivationDiscrete: per ? per.total : 0,
    direct: scale(per ? per.direct : 0),
    structure: scale(per ? per.structure : 0),
    financial: scale(per ? per.financial : 0),
    contingency: scale(per ? per.contingency : 0),
    inflation: scale(per ? per.inflation || 0 : 0),
    workingCapital: scale(per ? per.workingCapital : 0),
    total: scale(per ? per.total : 0),
    byCategory: Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, per ? per.byCategory[c.id] * extra : 0])),
    bySource: per ? Object.fromEntries(Object.entries(per.bySource).map(([k, v]) => [k, v * extra])) : {},
    cashByKey: per ? Object.fromEntries(Object.entries(per.cashByKey).map(([k, v]) => [k, v * extra])) : {},
  };
}

/** Días de trabajo donde empieza una salida nueva (saltos del costo con "cada salida completa"). */
export function activationBreakpoints(model, maxDays) {
  const r = model && model.activationRounding;
  if (!r || !r.enabled || !(r.perActivation && r.perActivation.total > 0)) return [];
  const dpa = r.daysPerActivation > 0 ? r.daysPerActivation : 1;
  const limit = nonNegative(maxDays);
  const out = [];
  // Tope alto: con muchas salidas por día (dpa chico) hay que cubrir todo el mes.
  for (let k = 1; k * dpa <= limit + 1e-9 && out.length < 20000; k += 1) out.push(k * dpa);
  return out;
}

/** Factor de prorrateo de fijos cuando D supera los días disponibles. */
export function monthsFactor(activeDays, availableDays) {
  const d = nonNegative(activeDays);
  const a = nonNegative(availableDays);
  if (a <= 0 || d <= a) return 1;
  return d / a;
}

/** Costo total y por categoría con D días de trabajo. */
export function costAtActivity(model, activeDays) {
  const D = nonNegative(activeDays);
  const factor = monthsFactor(D, model.activity.availableDaysPerMonth);
  const byCategory = {};
  let total = 0;
  for (const c of COST_CATEGORIES) {
    const b = model.byCategory[c.id] || emptyBucket();
    const amount = b.fixedMonthly * factor + b.variablePerActiveDay * D;
    byCategory[c.id] = amount;
    total += amount;
  }
  const fixed = model.fixedMonthly * factor;
  let variable = model.variablePerActiveDay * D;
  // Horas extra de "todo el trabajo" (M1): el costo real con D días, no el promedio por día.
  let overtimeAdjustment = 0;
  const curve = model.overtimeCurve;
  if (curve) {
    const delta = overtimeAllMonthlyAt(curve.overtimeWork, D) - curve.variablePerActiveDay * D;
    if (Math.abs(delta) > 1e-9) {
      for (const [cat, mult] of Object.entries(curve.byCategory)) {
        if (!byCategory[cat] && byCategory[cat] !== 0) continue;
        byCategory[cat] += delta * mult;
        total += delta * mult;
        overtimeAdjustment += delta * mult;
      }
      variable += overtimeAdjustment;
    }
  }
  // "Cada salida se cuenta completa" (PLAN-2026-011): sólo si está activa.
  let rounding = null;
  if (model.activationRounding && model.activationRounding.enabled) {
    rounding = activationRoundingAt(model, D);
    if (rounding.total > 0) {
      for (const c of COST_CATEGORIES) {
        byCategory[c.id] += rounding.byCategory[c.id];
        total += rounding.byCategory[c.id];
      }
      variable += rounding.total;
    }
  }
  return {
    activeDays: D,
    monthsFactor: factor,
    fixed,
    variable,
    total,
    byCategory,
    rounding,
    overtimeAdjustment,
    perActiveDay: safeDivide(total, D, null),
  };
}

/**
 * Costo por categoría de gasto (0.10.0) con D días de trabajo: herramientas, insumos,
 * materiales, EPP y otros costos. Cada línea de Materiales u Otros costos suma
 * fijo × meses de costo fijo + variable × D (+ su parte del redondeo de salidas, si está activo),
 * con la MISMA cuenta que costAtActivity: es sólo un desglose, no cambia ningún total.
 *
 * @param {object} model  buildCostModel(...)
 * @param {number} activeDays
 * @param {{ category?: string|null }} [options]  category: sólo las líneas de esa categoría de la
 *   EECC (p. ej. 'materials'); sin dato, todas las líneas con componente (Materiales y Otros costos).
 * @returns {Record<string, { fixedMonthly: number, variablePerActiveDay: number, amount: number, lines: number }>}
 */
export function componentCostAt(model, activeDays, { category = null } = {}) {
  const D = nonNegative(activeDays);
  const factor = monthsFactor(D, model && model.activity ? model.activity.availableDaysPerMonth : 0);
  const rounding = model && model.activationRounding && model.activationRounding.enabled ? activationRoundingAt(model, D) : null;
  const extra = rounding ? rounding.extraActivations : 0;
  const out = Object.fromEntries(LINE_COMPONENT_IDS.map((id) => [id, { fixedMonthly: 0, variablePerActiveDay: 0, amount: 0, lines: 0 }]));
  ((model && model.lines) || []).forEach((l) => {
    if (category ? l.category !== category : !l.component) return;
    // Un adicional (cotizaciones anteriores) no es un material: va a "Otros costos" (revisión 0.10.0, C4).
    const id = l.source === 'extra' ? 'other' : LINE_COMPONENT_IDS.includes(l.component) ? l.component : 'materials';
    const b = out[id];
    b.fixedMonthly += l.fixedMonthly * factor;
    b.variablePerActiveDay += l.variablePerActiveDay;
    b.amount += l.fixedMonthly * factor + l.variablePerActiveDay * D + nonNegative(l.discretePerActivation) * extra;
    b.lines += 1;
  });
  return out;
}

/**
 * Costo de cada categoría de gasto de Materiales u Otros costos (herramientas, insumos, materiales,
 * EPP, otros) con D días, separado en lo que se suma en el renglón Materiales de la EECC y lo que
 * "Va a" otros renglones (un otro costo con "Va a: Equipos y servicios externos"). Revisión 0.10.0
 * (C3): el subtotal de cada sección de Materiales es `inMaterials.amount`, igual al hijo del
 * Resultado. Misma cuenta que componentCostAt: sólo un desglose, no cambia ningún total.
 *
 * @param {object} model  buildCostModel(...)
 * @param {number} activeDays
 * @returns {Record<string, { inMaterials: { fixedMonthly: number, variablePerActiveDay: number, amount: number, lines: number }, elsewhere: { category: string, amount: number, lines: number }[], amount: number }>}
 */
export function componentCostSplitAt(model, activeDays) {
  const inMaterials = componentCostAt(model, activeDays, { category: 'materials' });
  const all = componentCostAt(model, activeDays);
  const D = nonNegative(activeDays);
  const factor = monthsFactor(D, model && model.activity ? model.activity.availableDaysPerMonth : 0);
  const rounding = model && model.activationRounding && model.activationRounding.enabled ? activationRoundingAt(model, D) : null;
  const extra = rounding ? rounding.extraActivations : 0;
  const out = {};
  LINE_COMPONENT_IDS.forEach((id) => {
    const elsewhere = new Map();
    ((model && model.lines) || []).forEach((l) => {
      if (!l.component || l.category === 'materials') return;
      const lineId = LINE_COMPONENT_IDS.includes(l.component) ? l.component : 'materials';
      if (lineId !== id) return;
      const amount = l.fixedMonthly * factor + l.variablePerActiveDay * D + nonNegative(l.discretePerActivation) * extra;
      const b = elsewhere.get(l.category) || { category: l.category, amount: 0, lines: 0 };
      b.amount += amount;
      b.lines += 1;
      elsewhere.set(l.category, b);
    });
    out[id] = {
      inMaterials: inMaterials[id],
      elsewhere: COST_CATEGORIES.map((c) => elsewhere.get(c.id)).filter(Boolean),
      // Todo lo de la categoría (en Materiales + en otros renglones), sin los adicionales.
      amount: all[id].amount,
    };
  });
  return out;
}

/** Nombre corto de un tipo de "Insumos y materiales" ("Insumos y consumibles", PLAN-2026-027). */
function componentLabel(id) {
  return materialTypeShort(id);
}

/**
 * Estructura de costos (EECC): monto + incidencia %.
 * La incidencia mostrada (2 decimales) suma exactamente 100 %.
 * El renglón `materials` trae `children` (0.10.0): su desglose por categoría de gasto
 * (herramientas, insumos, materiales, EPP, otros), sólo las que tienen líneas. La suma de los
 * montos de `children` es el monto del renglón y la de sus `displayPct`, su `displayPct`.
 */
export function costStructure(model, activeDays) {
  const at = costAtActivity(model, activeDays);
  // El renglón de inflación (K-01) sólo existe con precio fijo activo: apagado, la EECC es la de siempre.
  const categories = COST_CATEGORIES.filter((c) => c.id !== 'inflation' || (model.inflation && model.inflation.active));
  const amounts = categories.map((c) => at.byCategory[c.id]);
  const displayPcts = roundPercentagesToTotal(amounts, 2, 100);
  const byCat = model.byCategory || {};
  const rows = categories.map((c, i) => ({
    category: c.id,
    label: c.label,
    amount: amounts[i],
    // Fijo del mes y variable por día de trabajo de la categoría (PLAN-2026-010):
    // "monto ÷ días" mezcla los fijos y no es un costo por día.
    fixedMonthly: (byCat[c.id] ? byCat[c.id].fixedMonthly : 0) * at.monthsFactor,
    variablePerActiveDay: byCat[c.id] ? byCat[c.id].variablePerActiveDay : 0,
    // Ajuste por "cada salida se cuenta completa" (PLAN-2026-011; 0 si está apagado).
    activationRounding: at.rounding ? at.rounding.byCategory[c.id] : 0,
    // Equivalente por día AL NIVEL ESTIMADO (incluye fijos): sólo una referencia.
    perActiveDay: safeDivide(amounts[i], at.activeDays, null),
    share: at.total > 0 ? amounts[i] / at.total : 0,
    sharePct: at.total > 0 ? (amounts[i] / at.total) * 100 : 0,
    displayPct: displayPcts[i],
  }));
  const materialsRow = rows.find((r) => r.category === 'materials');
  if (materialsRow) {
    const parts = componentCostAt(model, at.activeDays, { category: 'materials' });
    const ids = LINE_COMPONENT_IDS.filter((id) => parts[id].lines > 0);
    const childPcts = roundPercentagesToTotal(ids.map((id) => parts[id].amount), 2, materialsRow.displayPct);
    materialsRow.children = ids.map((id, j) => ({
      component: id,
      label: componentLabel(id),
      amount: parts[id].amount,
      fixedMonthly: parts[id].fixedMonthly,
      variablePerActiveDay: parts[id].variablePerActiveDay,
      perActiveDay: safeDivide(parts[id].amount, at.activeDays, null),
      share: at.total > 0 ? parts[id].amount / at.total : 0,
      sharePct: at.total > 0 ? (parts[id].amount / at.total) * 100 : 0,
      displayPct: childPcts[j],
    }));
  }
  return {
    activeDays: at.activeDays,
    rows,
    total: at.total,
    totalPct: at.total > 0 ? 100 : 0,
    displayTotalPct: roundPercentage(displayPcts.reduce((s, p) => s + p, 0)),
  };
}

/** Traza del costo total mensual. */
export function traceTotalCost(model, activeDays) {
  const at = costAtActivity(model, activeDays);
  // Salidas promedio, costeadas y efecto del redondeo (PLAN-2026-014, LAB-D1), con el nombre del servicio.
  const T = activationTerms(model.activationRounding && model.activationRounding.terms);
  const preview = at.rounding ? null : activationRoundingAt(model, activeDays, { force: true });
  const averageOnly = preview && preview.total > 0;
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  return createTrace({
    id: 'total_cost',
    title: 'Costo total mensual',
    formula: 'Costo = Fijos mensuales × meses de costo fijo + Variable por día de trabajo × Días de trabajo',
    inputs: [
      { label: 'Costos fijos mensuales (incluye estructura, financiero y contingencia)', value: model.fixedMonthly, format: 'money' },
      { label: 'Costo variable por día de trabajo', value: model.variablePerActiveDay, format: 'money' },
      { label: 'Días de trabajo', value: at.activeDays, format: 'days' },
      { label: 'Meses de costo fijo (1 = un mes; más si los días superan los disponibles)', value: at.monthsFactor, format: 'number' },
    ],
    steps: [
      { label: 'Fijos', value: at.fixed, format: 'money' },
      ...(at.rounding && at.rounding.total > 0
        ? [
          { label: 'Variables (por día de trabajo)', value: at.variable - at.rounding.total, format: 'money' },
          { label: `${T.Many} promedio por mes`, value: at.rounding.estimated, format: 'number' },
          { label: `${T.Many} ${T.g('costeadas', 'costeados')} (${T.each} ${T.whole})`, value: at.rounding.costed, format: 'number' },
          { label: `Efecto del redondeo (costos por ${T.one}, con su estructura, financiación y contingencia)`, value: at.rounding.total, format: 'money' },
        ]
        : []),
      { label: 'Variables', value: at.variable, format: 'money' },
    ],
    result: { label: 'Costo total', value: at.total, format: 'money' },
    notes: [
      at.monthsFactor > 1 ? 'Los días superan los disponibles del mes: se prorratean los fijos como trabajo de más de un mes.' : null,
      model.inflation && model.inflation.active ? `Precio fijo todo el contrato: incluye la inflación esperada (${formatMoney(at.byCategory.inflation)}, costo de hoy × ${formatNumber(model.inflation.factor, { decimals: 4 })}).` : null,
      Math.abs(at.overtimeAdjustment || 0) > 0.005 ? `Horas extra de todo el trabajo con estos días: ${at.overtimeAdjustment > 0 ? '+' : '−'}${formatMoney(Math.abs(at.overtimeAdjustment))} contra el promedio por día (con su estructura, financiación e imprevistos).` : null,
      at.rounding && at.rounding.total > 0 ? `${T.Each} se cuenta ${T.whole}: sólo los costos por ${T.one} (movilización, peajes, viáticos, cargos por ${T.one}…) se costean con ${T.theMany} ${T.many} ${T.wholeMany}. Sueldos, tenencia, producción y estructura mensual no cambian.` : null,
      averageOnly
        ? `${T.Many} promedio por mes: ${n(preview.estimated)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${n(preview.estimated)} (los costos por ${T.one} se cuentan en proporción). Con "${T.Each} se cuenta ${T.whole}" se costearía${preview.wholeActivations === 1 ? '' : 'n'} ${n(preview.wholeActivations)}: efecto del redondeo +${formatMoney(preview.total)} por mes (no incluido).`
        : null,
    ].filter(Boolean),
  });
}

/** Utilidad: lee un número opcional (null si vacío). */
export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = toNumber(value, NaN);
  return Number.isFinite(n) ? n : null;
}
