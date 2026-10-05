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
 * Operación (por hora de uso):
 *   operación/h = mantenimiento/h + neumáticos/h + litros/h × precioCombustible
 *
 * Utilización (ficha de biblioteca):
 *   horasUsadas = horasDisponibles × utilización%
 *   $/mes       = posesión + operación/h × horasUsadas
 *   $/hora      = $/mes / horasUsadas
 *   $/día       = $/mes / díasUsados
 */

import { nonNegative, pct, safeDivide } from '../core/money.js';

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
  const averageInvestment = (replacement + residual) / 2;
  const capitalCostMonthly = (averageInvestment * pct(nonNegative(eq.capitalRatePctAnnual))) / 12;
  const cashMonthly = insuranceMonthly + licenseMonthly + certificationsMonthly + otherMonthly;
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
    averageInvestment,
    capitalCostMonthly,
    cashMonthly,
    nonCashMonthly,
    totalMonthly: cashMonthly + nonCashMonthly,
  };
}

/** Costo de operación por hora de uso de UNA unidad. */
export function computeOperation(eq = {}, { fuelPricePerLiter = 0, fuelPaidByUs = true } = {}) {
  const maintenancePerHour = nonNegative(eq.maintenancePerHour);
  const tiresPerHour = nonNegative(eq.tiresPerHour);
  const fuelLitersPerHour = nonNegative(eq.fuelLitersPerHour);
  const fuelPrice = fuelPaidByUs ? nonNegative(fuelPricePerLiter) : 0;
  const fuelPerHour = fuelLitersPerHour * fuelPrice;
  const nonFuelPerHour = maintenancePerHour + tiresPerHour;
  return {
    maintenancePerHour,
    tiresPerHour,
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
