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
  const fuelLitersPerHour = nonNegative(eq.fuelLitersPerHour);
  const fuelPrice = fuelPaidByUs ? nonNegative(fuelPricePerLiter) : 0;
  const fuelPerHour = fuelLitersPerHour * fuelPrice;
  const nonFuelPerHour = maintenancePerHour + tiresPerHour;
  return {
    maintenancePerHour,
    tiresPerHour,
    maintenanceMode: maintenance.mode,
    tiresMode: tires.mode,
    tiresPerKm: tires.perKm,
    fuelLitersPerHour,
    fuelPricePerLiter: fuelPrice,
    fuelPerHour,
    nonFuelPerHour,
    totalPerHour: nonFuelPerHour + fuelPerHour,
  };
}

/**
 * Ficha completa de un equipo de biblioteca a su utilización esperada:
 * $/hora, $/día y $/mes.
 */
export function computeEquipmentUnit(eq = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true } = {}) {
  const ownership = computeOwnership(eq);
  const operation = computeOperation(eq, { fuelPricePerLiter, fuelPaidByUs });
  const availableHours = nonNegative(eq.availableHoursPerMonth);
  const availableDays = nonNegative(eq.availableDaysPerMonth);
  const utilizationPct = Math.min(nonNegative(eq.utilizationPct), 100);
  const usedHours = availableHours * pct(utilizationPct);
  const usedDays = availableDays * pct(utilizationPct);
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

/**
 * Línea de equipo dentro de una cotización.
 * Posesión → fijo mensual; operación → variable por día activo.
 */
export function computeEquipmentLine(line = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true, defaultHoursPerActiveDay = 0 } = {}) {
  const quantity = nonNegative(line.quantity);
  const hoursPerActiveDay =
    line.hoursPerActiveDay === null || line.hoursPerActiveDay === undefined || line.hoursPerActiveDay === ''
      ? nonNegative(defaultHoursPerActiveDay)
      : nonNegative(line.hoursPerActiveDay);
  const ownership = computeOwnership(line);
  const operation = computeOperation(line, { fuelPricePerLiter, fuelPaidByUs });
  return {
    id: line.id ?? null,
    name: line.name ?? '',
    quantity,
    hoursPerActiveDay,
    ownership,
    operation,
    fixedMonthly: ownership.totalMonthly * quantity,
    fixedCashMonthly: ownership.cashMonthly * quantity,
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

