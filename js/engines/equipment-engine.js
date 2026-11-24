/**
 * EquipmentEngine — costo de equipos.
 *
 * Separa COSTO DE POSESIÓN (existe aunque el equipo no trabaje) de
 * COSTO DE OPERACIÓN (existe sólo cuando el equipo trabaja).
 *
 * Posesión (mensual):
 *   amortización     = (valorReposición − valorResidual) / (vidaÚtilAños × 12)
 *   seguro           = seguroAnual / 12
 *   patente          = patenteAnual / 12
 *   certificaciones  = certificacionesAnual / 12
 *   otros            = otrosAnual / 12   (GPS, inspecciones, otros costos de tenencia)
 *   costoCapital     = ((valorReposición + valorResidual) / 2) × tasaAnual% / 12
 *   posesión         = suma de lo anterior
 *   (amortización y costo de capital NO son salidas de caja mensuales)
 *
 *   mantenimiento fijo = presupuesto mensual (o anual / 12) si el mantenimiento
 *                    se cargó como presupuesto (PLAN-2026-007): es costo de
 *                    tenencia, no se divide por horas de uso
 *
 * Operación (por hora de uso):
 *   operación/h = mantenimiento/h + neumáticos/h + litros/h × precioCombustible
 *   mantenimiento/h = cargado por hora, o costo del service / horas entre services
 *   neumáticos/h    = cargado por hora, o costo del juego / vida útil en horas
 *   (juego / vida útil en km = $/km: se suma al desgaste en ruta, no por hora)
 *
 * Utilización (ficha de biblioteca):
 *   horasUsadas = horasDisponibles × utilización%
 *   $/mes       = posesión + operación/h × horasUsadas
 *   $/hora      = $/mes / horasUsadas
 *   $/día       = $/mes / díasUsados
 */

import { nonNegative, pct, safeDivide } from '../core/money.js';
import { RULES } from '../core/validation.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { billableHoursOf } from '../domain/cost-basis.js';

const MAINTENANCE_MODE_IDS = Object.freeze(['per_hour', 'service', 'budget']);
const TIRE_MODE_IDS = Object.freeze(['per_hour', 'set_hours', 'set_km']);

/**
 * Mantenimiento de UNA unidad según cómo se cargó (sin modo = por hora, como
 * siempre: los datos anteriores calculan igual).
 *   por hora     → $/h = maintenancePerHour
 *   service      → $/h = costo del service / horas de uso entre services
 *   presupuesto  → fijo mensual = presupuesto mensual (o anual / 12); $/h = 0
 */
export function maintenanceOf(eq = {}) {
  const e = eq && typeof eq === 'object' ? eq : {};
  const mode = MAINTENANCE_MODE_IDS.includes(e.maintenanceMode) ? e.maintenanceMode : 'per_hour';
  if (mode === 'service') {
    const serviceCost = nonNegative(e.maintenanceServiceCost);
    const serviceHours = nonNegative(e.maintenanceServiceHours);
    return { mode, perHour: safeDivide(serviceCost, serviceHours, 0), fixedMonthly: 0, serviceCost, serviceHours };
  }
  if (mode === 'budget') {
    const budget = nonNegative(e.maintenanceBudget);
    const budgetPeriod = e.maintenanceBudgetPeriod === 'year' ? 'year' : 'month';
    return { mode, perHour: 0, fixedMonthly: budgetPeriod === 'year' ? budget / 12 : budget, budget, budgetPeriod };
  }
  return { mode, perHour: nonNegative(e.maintenancePerHour), fixedMonthly: 0 };
}

/**
 * Neumáticos de UNA unidad según cómo se cargaron (sin modo = por hora).
 *   por hora           → $/h = tiresPerHour
 *   juego + horas      → $/h = costo del juego / vida útil en horas
 *   juego + km (ruta)  → $/km = costo del juego / vida útil en km ($/h = 0)
 */
export function tiresOf(eq = {}) {
  const e = eq && typeof eq === 'object' ? eq : {};
  const mode = TIRE_MODE_IDS.includes(e.tiresMode) ? e.tiresMode : 'per_hour';
  if (mode === 'set_hours') {
    const setCost = nonNegative(e.tiresSetCost);
    const lifeHours = nonNegative(e.tiresLifeHours);
    return { mode, perHour: safeDivide(setCost, lifeHours, 0), perKm: 0, setCost, lifeHours };
  }
  if (mode === 'set_km') {
    const setCost = nonNegative(e.tiresSetCost);
    const lifeKm = nonNegative(e.tiresLifeKm);
    return { mode, perHour: 0, perKm: safeDivide(setCost, lifeKm, 0), setCost, lifeKm };
  }
  return { mode, perHour: nonNegative(e.tiresPerHour), perKm: 0 };
}

/** Costo de posesión mensual de UNA unidad. */
export function computeOwnership(eq = {}) {
  const replacement = nonNegative(eq.replacementValue);
  const residualRaw = nonNegative(eq.residualValue);
  const residual = Math.min(residualRaw, replacement);
  const lifeYears = nonNegative(eq.usefulLifeYears);
  const depreciationMonthly = safeDivide(replacement - residual, lifeYears * 12, 0);
  const insuranceMonthly = nonNegative(eq.insuranceAnnual) / 12;
  const licenseMonthly = nonNegative(eq.licenseAnnual) / 12;
  const certificationsMonthly = nonNegative(eq.certificationsAnnual) / 12;
  const otherMonthly = nonNegative(eq.otherAnnual) / 12;
  const maintenanceFixedMonthly = maintenanceOf(eq).fixedMonthly;
  const averageInvestment = (replacement + residual) / 2;
  const capitalCostMonthly = (averageInvestment * pct(nonNegative(eq.capitalRatePctAnnual))) / 12;
  const cashMonthly = insuranceMonthly + licenseMonthly + certificationsMonthly + otherMonthly + maintenanceFixedMonthly;
  const nonCashMonthly = depreciationMonthly + capitalCostMonthly;
  return {
    replacement,
    residual,
    lifeYears,
    depreciationMonthly,
    insuranceMonthly,
    licenseMonthly,
    certificationsMonthly,
    otherMonthly,
    maintenanceFixedMonthly,
    averageInvestment,
    capitalCostMonthly,
    cashMonthly,
    nonCashMonthly,
    totalMonthly: cashMonthly + nonCashMonthly,
  };
}

/** Costo de operación por hora de uso de UNA unidad. */
export function computeOperation(eq = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true } = {}) {
  const maintenance = maintenanceOf(eq);
  const tires = tiresOf(eq);
  const maintenancePerHour = maintenance.perHour;
  const tiresPerHour = tires.perHour;
  // "No usa combustible" (PLAN-2026-014, LAB-D5): eléctrico, manual o estacionario. Es un dato
  // explícito: un consumo 0 sin marcar sigue siendo un dato faltante.
  const fuelLitersPerHour = eq.fuelNotApplicable === true ? 0 : nonNegative(eq.fuelLitersPerHour);
  const fuelPrice = fuelPaidByUs ? nonNegative(fuelPricePerLiter) : 0;
  const fuelPerHour = fuelLitersPerHour * fuelPrice;
  const nonFuelPerHour = maintenancePerHour + tiresPerHour;
  return {
    maintenancePerHour,
    tiresPerHour,
    maintenanceMode: maintenance.mode,
    tiresMode: tires.mode,
    tiresPerKm: tires.perKm,
    fuelNotApplicable: eq.fuelNotApplicable === true,
    fuelLitersPerHour,
    fuelPricePerLiter: fuelPrice,
    fuelPerHour,
    nonFuelPerHour,
    totalPerHour: nonFuelPerHour + fuelPerHour,
  };
}

/** Horas por mes que el equipo trabaja para clientes, si la ficha las tiene (0.25.0); si no, null. */
export function ownBillableHoursOf(eq = {}) {
  const v = Number(eq && eq.billableHoursPerMonth);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Ficha completa de un equipo de biblioteca a su utilización esperada:
 * $/hora, $/día y $/mes.
 *
 * 0.25.0 (PLAN-2026-029, PR 6, P-08/P-09): si el equipo trae `billableHoursPerMonth` (horas por mes
 * que trabaja para clientes, entre todos tus trabajos), ésas son las horas usadas; los días usados
 * salen de las horas por día del equipo (disponibles ÷ días), si las tiene. Sin el campo, igual que
 * siempre: horas disponibles × utilización. Sólo la usa la ficha de Recursos (no entra en computeQuote).
 */
export function computeEquipmentUnit(eq = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true } = {}) {
  const ownership = computeOwnership(eq);
  const operation = computeOperation(eq, { fuelPricePerLiter, fuelPaidByUs });
  const availableHours = nonNegative(eq.availableHoursPerMonth);
  const availableDays = nonNegative(eq.availableDaysPerMonth);
  const own = ownBillableHoursOf(eq);
  const utilizationPct = own === null
    ? Math.min(nonNegative(eq.utilizationPct), 100)
    : availableHours > 0 ? Math.min((own / availableHours) * 100, 100) : 100;
  const usedHours = own === null ? availableHours * pct(utilizationPct) : own;
  // Con el campo, los días usados no pasan de los días disponibles del mes (0.25.0, revisión): un
  // equipo con más horas para clientes que disponibles no trabaja 60 días en un mes de 30.
  const usedDays = own === null ? availableDays * pct(utilizationPct) : availableHours > 0 ? Math.min(availableDays * (own / availableHours), availableDays) : 0;
  const operationMonthly = operation.totalPerHour * usedHours;
  const costPerMonth = ownership.totalMonthly + operationMonthly;
  return {
    ownership,
    operation,
    capacity: {
      availableHoursPerMonth: availableHours,
      availableDaysPerMonth: availableDays,
      utilizationPct,
      usedHoursPerMonth: usedHours,
      usedDaysPerMonth: usedDays,
      hoursPerDay: safeDivide(availableHours, availableDays, 0),
      // Sólo con el campo nuevo (sin él, la ficha tiene las mismas claves de siempre).
      ...(own === null ? {} : { ownBillableHours: true, billableHoursPerMonth: own }),
    },
    rates: {
      costPerMonth,
      operationMonthly,
      costPerUsedHour: safeDivide(costPerMonth, usedHours, null),
      costPerUsedDay: safeDivide(costPerMonth, usedDays, null),
      ownershipPerUsedHour: safeDivide(ownership.totalMonthly, usedHours, null),
    },
  };
}

/** Máximo físico de horas de uso de UNA unidad de equipo en un día (el mismo de la validación). */
export const MAX_EQUIPMENT_HOURS_PER_DAY = RULES.hoursPerDay.max;

/**
 * Horas de uso por día de UNA unidad de equipo, propio o externo (decisión del dueño,
 * PLAN-2026-014): las de la línea o, si están vacías, las de la actividad; como mucho 24.
 * Un dato mayor sigue siendo un error de validación (`validateQuote`), pero el motor nunca
 * calcula por encima del tope: más horas por día son más equipos (`quantity`), p. ej.
 * 2 equipos × 20 h = 40 equipo-horas por día, nunca 1 equipo × 40 h.
 */
export function equipmentHoursPerDay(lineHours, defaultHours = 0) {
  const raw = lineHours === null || lineHours === undefined || lineHours === '' ? nonNegative(defaultHours) : nonNegative(lineHours);
  return Math.min(raw, MAX_EQUIPMENT_HOURS_PER_DAY);
}

/**
 * Horas por día que un equipo propio está en el trabajo (`assignedHoursPerDay`, 0.18.0): las
 * cargadas, hasta las del día de trabajo (o 24 si el servicio no las tiene). 0 = sin dato.
 */
export function assignedEquipmentHours(line = {}, serviceHoursPerDay = 0) {
  const own = nonNegative(line && line.assignedHoursPerDay);
  if (!(own > 0)) return 0;
  const service = Math.min(nonNegative(serviceHoursPerDay), MAX_EQUIPMENT_HOURS_PER_DAY);
  return Math.min(own, service > 0 ? service : MAX_EQUIPMENT_HOURS_PER_DAY);
}

/**
 * Línea de equipo dentro de una cotización.
 * Posesión → fijo mensual (× % asignado si se comparte, PLAN-2026-012);
 * operación → variable por día de trabajo según el uso (no se reduce).
 */
export function computeEquipmentLine(line = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true, defaultHoursPerActiveDay = 0, timeBasis = false, defaultBillableHours = 0 } = {}) {
  const quantity = nonNegative(line.quantity);
  // Horas por día en este trabajo (0.18.0, por tiempo usado): si el equipo está en el trabajo sólo
  // una parte del día (la hidrogrúa va 2 h), tenerlo se cobra por esas horas, nunca más que las del
  // día de trabajo. Sin dato: el día de trabajo entero, como siempre. Las horas de uso (motor) sin
  // dato pasan a ser esas mismas horas.
  const assignedHours = timeBasis ? assignedEquipmentHours(line, defaultHoursPerActiveDay) : 0;
  const hoursPerActiveDay = equipmentHoursPerDay(line.hoursPerActiveDay, assignedHours > 0 ? assignedHours : defaultHoursPerActiveDay);
  const ownership = computeOwnership(line);
  const operation = computeOperation(line, { fuelPricePerLiter, fuelPaidByUs });
  // Equipo compartido (PLAN-2026-012): esta cotización carga el % EXPLÍCITO de
  // su costo de tenerlo; reservado (o sin dato) = 100 %. La operación sigue el uso.
  const allocation = timeBasis ? { assignment: null, shared: false, sharePct: 100, share: 1, missing: false } : fixedCostShareOf(line);
  const share = allocation.shared ? allocation.share : 1;
  const fullFixedMonthly = ownership.totalMonthly * quantity;
  // Por tiempo usado (2026-11-18): tenerlo cuesta las horas que está en el trabajo × (posesión del
  // mes ÷ horas facturables). Sin horas propias (0.18.0) es el día de trabajo entero, aunque el motor ande menos.
  if (timeBasis) {
    const billableHours = billableHoursOf(line, defaultBillableHours);
    const dayHours = Math.min(nonNegative(defaultHoursPerActiveDay) > 0 ? nonNegative(defaultHoursPerActiveDay) : hoursPerActiveDay, MAX_EQUIPMENT_HOURS_PER_DAY);
    // Con horas propias en el trabajo: esas (o las de uso, si son más), hasta el día de trabajo.
    const occupiedHours = assignedHours > 0 ? Math.min(Math.max(assignedHours, hoursPerActiveDay), dayHours) : dayHours;
    const hourly = safeDivide(ownership.totalMonthly, billableHours, 0);
    const cashHourly = safeDivide(ownership.cashMonthly, billableHours, 0);
    const ownershipPerActiveDay = hourly * occupiedHours * quantity;
    return {
      id: line.id ?? null,
      name: line.name ?? '',
      quantity,
      hoursPerActiveDay,
      ownership,
      operation,
      assignment: null,
      shared: false,
      fixedCostSharePct: 100,
      shareMissing: false,
      timeBasis: true,
      time: { billableHoursPerMonth: billableHours, ownBillableHours: nonNegative(line.billableHoursPerMonth) > 0, hourlyCost: hourly, hoursPerDay: occupiedHours, ownHours: assignedHours > 0, perActiveDay: ownershipPerActiveDay },
      fullFixedMonthly,
      unassignedFixedMonthly: 0,
      fixedMonthly: 0,
      fixedCashMonthly: 0,
      ownershipPerActiveDay,
      ownershipCashPerActiveDay: cashHourly * occupiedHours * quantity,
      nonFuelPerActiveDay: operation.nonFuelPerHour * hoursPerActiveDay * quantity,
      fuelPerActiveDay: operation.fuelPerHour * hoursPerActiveDay * quantity,
      fuelLitersPerActiveDay: operation.fuelLitersPerHour * hoursPerActiveDay * quantity,
      variablePerActiveDay: operation.totalPerHour * hoursPerActiveDay * quantity,
    };
  }
  return {
    id: line.id ?? null,
    name: line.name ?? '',
    quantity,
    hoursPerActiveDay,
    ownership,
    operation,
    assignment: allocation.assignment,
    shared: allocation.shared,
    fixedCostSharePct: allocation.sharePct,
    shareMissing: allocation.missing,
    fullFixedMonthly,
    unassignedFixedMonthly: allocation.shared ? fullFixedMonthly - fullFixedMonthly * share : 0,
    fixedMonthly: allocation.shared ? fullFixedMonthly * share : fullFixedMonthly,
    fixedCashMonthly: allocation.shared ? ownership.cashMonthly * quantity * share : ownership.cashMonthly * quantity,
    nonFuelPerActiveDay: operation.nonFuelPerHour * hoursPerActiveDay * quantity,
    fuelPerActiveDay: operation.fuelPerHour * hoursPerActiveDay * quantity,
    fuelLitersPerActiveDay: operation.fuelLitersPerHour * hoursPerActiveDay * quantity,
    variablePerActiveDay: operation.totalPerHour * hoursPerActiveDay * quantity,
  };
}

/**
 * Avisos de sentido común sobre los valores de un equipo propio (no bloquean
 * ni corrigen nada: la persona decide). `comparable` = false cuando el valor de
 * reposición está en otra moneda sin tipo de cambio (no se comparan montos).
 * El valor de reposición tiene que venir en la misma moneda que los costos.
 * @returns {{ id: string, mode?: string, unit?: string, period?: string }[]}
 */
export function equipmentChecks(eq = {}, { comparable = true } = {}) {
  const e = eq && typeof eq === 'object' ? eq : {};
  const warnings = [];
  const replacement = nonNegative(e.replacementValue);
  const residual = nonNegative(e.residualValue);
  const m = maintenanceOf(e);
  const t = tiresOf(e);
  if (replacement > 0 && residual > replacement) warnings.push({ id: 'residual_over_replacement' });
  if (replacement > 0 && !(nonNegative(e.usefulLifeYears) > 0)) warnings.push({ id: 'useful_life_missing' });
  if (m.mode === 'service' && m.serviceCost > 0 && !(m.serviceHours > 0)) warnings.push({ id: 'service_hours_missing' });
  if (t.mode === 'set_hours' && t.setCost > 0 && !(t.lifeHours > 0)) warnings.push({ id: 'tires_life_missing', unit: 'hours' });
  if (t.mode === 'set_km' && t.setCost > 0 && !(t.lifeKm > 0)) warnings.push({ id: 'tires_life_missing', unit: 'km' });
  if (comparable && replacement > 0) {
    // 100 horas de uso cuestan más que el equipo: casi seguro un monto mensual o anual cargado por hora.
    if (m.perHour * 100 > replacement) warnings.push({ id: 'maintenance_per_hour_high', mode: m.mode });
    else if (m.perHour * 1000 > replacement) warnings.push({ id: 'maintenance_per_hour_elevated', mode: m.mode });
    if (m.mode === 'budget' && m.fixedMonthly * 12 > replacement) warnings.push({ id: 'maintenance_budget_high', period: m.budgetPeriod });
    if (t.perHour * 100 > replacement) warnings.push({ id: 'tires_per_hour_high', mode: t.mode });
    else if (t.perHour * 1000 > replacement) warnings.push({ id: 'tires_per_hour_elevated', mode: t.mode });
    if (t.perKm * 1000 > replacement) warnings.push({ id: 'tires_per_km_high' });
  }
  return warnings;
}

