/**
 * ExternalEngine — equipos ALQUILADOS y servicios TERCERIZADOS (PLAN-2026-005).
 *
 * Un recurso externo no es un activo propio: no tiene amortización, seguro ni
 * costo de capital. Es una TARIFA del proveedor (precio NETO, sin IVA) por una
 * unidad, con un mínimo opcional:
 *
 *   hora        unidades/llamado = horas por día × días por llamado
 *   día         unidades/llamado = días por llamado
 *   viaje       unidades/llamado = viajes de ida o vuelta por llamado
 *   km          unidades/llamado = km de ruta por llamado
 *   llamado     1 por llamado (sin mínimo)
 *   mes         fijo mensual = precio × cantidad
 *   global      fijo mensual = precio × cantidad / meses de contrato
 *
 *   facturado/llamado = max(unidades, mínimo) × precio × cantidad
 *   por día activo    = facturado/llamado / días por llamado
 *
 * Tratamiento fiscal (lo define la empresa; RATEOS no trae alícuotas):
 *
 *   costo económico  = neto × (1 + cargos no recuperables% + IVA% × (1 − parte recuperable))
 *   salida de caja   = neto × (1 + IVA% + percepciones% + cargos no recuperables%)
 *   crédito fiscal   = neto × (IVA% × parte recuperable + percepciones%)   (NO es costo)
 *
 * El IVA recuperable y las percepciones / retenciones son caja adelantada,
 * no costo. Ganancias no se trata acá (es otra capa económica) y el IIBB del
 * proveedor ya está dentro de su precio (el nuestro se calcula sobre nuestra
 * facturación, en "Impuestos sobre lo que facturás").
 *
 * Opcionales del proveedor:
 *   combustible NO incluido (false) → litros/h × horas × cantidad × precio (Combustible)
 *   movilización NO incluida (false) → monto por llamado × cantidad (con el mismo fiscal)
 */

import { nonNegative, pct, safeDivide, clamp } from '../core/money.js';
import { isPlainObject } from '../core/object.js';

export const EXTERNAL_UNIT_IDS = Object.freeze(['hour', 'day', 'month', 'trip', 'km', 'activation', 'global']);

/** Factores fiscales de un recurso externo (sobre el precio neto). */
export function externalFiscal(fiscal = {}) {
  const f = isPlainObject(fiscal) ? fiscal : {};
  const vatDefined = f.vatPct !== null && f.vatPct !== undefined && f.vatPct !== '' && Number.isFinite(Number(f.vatPct));
  const vatPct = vatDefined ? nonNegative(f.vatPct) : 0;
  const recovery = ['yes', 'no', 'partial'].includes(f.vatRecoverable) ? f.vatRecoverable : null;
  const partialDefined = f.vatRecoverablePct !== null && f.vatRecoverablePct !== undefined && f.vatRecoverablePct !== '' && Number.isFinite(Number(f.vatRecoverablePct));
  // Sin definir si es recuperable: se usa el precio neto (no se suma IVA al
  // costo sin saberlo) y la completitud lo advierte.
  let recoverableShare = 1;
  if (recovery === 'no') recoverableShare = 0;
  else if (recovery === 'partial') recoverableShare = partialDefined ? clamp(f.vatRecoverablePct, 0, 100) / 100 : 0;
  const perceptionsPct = nonNegative(f.perceptionsPct);
  const nonRecoverablePct = nonNegative(f.nonRecoverablePct);
  const nonRecoverableVatPct = vatPct * (1 - recoverableShare);
  return {
    vatPct,
    vatDefined,
    recovery,
    recoverableShare,
    perceptionsPct,
    nonRecoverablePct,
    nonRecoverableVatPct,
    economicFactor: 1 + pct(nonRecoverablePct) + pct(nonRecoverableVatPct),
    cashFactor: 1 + pct(vatPct) + pct(perceptionsPct) + pct(nonRecoverablePct),
    creditFactor: pct(vatPct) * recoverableShare + pct(perceptionsPct),
    paymentTermDays: f.paymentTermDays === null || f.paymentTermDays === undefined || f.paymentTermDays === '' ? null : nonNegative(f.paymentTermDays),
    // Necesita la alícuota para calcular el IVA que NO se recupera.
    missingVatRate: !vatDefined && (recovery === 'no' || recovery === 'partial'),
    missingPartialPct: recovery === 'partial' && !partialDefined,
  };
}

/**
 * Costo de UNA línea externa (alquilado o tercerizado) en la cotización.
 * @param {object} line  línea de equipo con acquisition rented | outsourced y `external`
 * @param {object} ctx   { daysPerActivation, defaultHoursPerActiveDay, routeKmPerActivation,
 *                         tripsPerActivation (viajes de ida o vuelta), contractMonths,
 *                         fuelPricePerLiter, fuelPaidByUs, conversion (factor de moneda; 0 si falta el tipo de cambio) }
 */
export function computeExternalLine(line = {}, ctx = {}) {
  const ext = isPlainObject(line.external) ? line.external : {};
  const conversion = nonNegative(ctx.conversion, 1);
  const quantity = nonNegative(line.quantity);
  const dpaRaw = nonNegative(ctx.daysPerActivation, 1);
  const dpa = dpaRaw > 0 ? dpaRaw : 1;
  const hoursPerActiveDay =
    line.hoursPerActiveDay === null || line.hoursPerActiveDay === undefined || line.hoursPerActiveDay === ''
      ? nonNegative(ctx.defaultHoursPerActiveDay)
      : nonNegative(line.hoursPerActiveDay);
  const unit = EXTERNAL_UNIT_IDS.includes(ext.unit) ? ext.unit : 'day';
  const priceOriginal = nonNegative(ext.price);
  const price = priceOriginal * conversion;
  const minimum = nonNegative(ext.minimumUnits);
  const contractMonthsRaw = nonNegative(ctx.contractMonths);
  const contractMonths = contractMonthsRaw >= 1 ? contractMonthsRaw : 1;

  let unitsPerActivation = null;
  let billedUnitsPerActivation = null;
  let netPerActivation = 0;
  let netFixedMonthly = 0;
  switch (unit) {
    case 'hour':
      unitsPerActivation = hoursPerActiveDay * dpa;
      break;
    case 'day':
      unitsPerActivation = dpa;
      break;
    case 'trip':
      unitsPerActivation = nonNegative(ctx.tripsPerActivation);
      break;
    case 'km':
      unitsPerActivation = nonNegative(ctx.routeKmPerActivation);
      break;
    case 'activation':
      unitsPerActivation = 1;
      break;
    default:
      break;
  }
  if (unit === 'month') {
    netFixedMonthly = price * quantity;
  } else if (unit === 'global') {
    netFixedMonthly = (price * quantity) / contractMonths;
  } else {
    billedUnitsPerActivation = unit === 'activation' ? 1 : Math.max(unitsPerActivation, minimum);
    netPerActivation = billedUnitsPerActivation * price * quantity;
  }
  const netPerActiveDay = safeDivide(netPerActivation, dpa, 0);

  const fiscal = externalFiscal(ext.fiscal);

  // Movilización cobrada por el proveedor (sólo si se dijo que NO está incluida).
  const mobilizationNetPerActivation = ext.mobilizationIncluded === false ? nonNegative(ext.mobilizationAmount) * conversion * quantity : 0;
  const mobilizationNetPerActiveDay = safeDivide(mobilizationNetPerActivation, dpa, 0);

  // Combustible a cargo nuestro (sólo si se dijo que NO está incluido).
  const fuelLitersPerHour = ext.fuelIncluded === false ? nonNegative(ext.fuelLitersPerHour) : 0;
  const fuelPrice = ctx.fuelPaidByUs === false ? 0 : nonNegative(ctx.fuelPricePerLiter);
  const fuelLitersPerActiveDay = fuelLitersPerHour * hoursPerActiveDay * quantity;
  const fuelPerActiveDay = fuelLitersPerActiveDay * fuelPrice;

  const economic = (net) => net * fiscal.economicFactor;
  return {
    id: line.id ?? null,
    name: line.name ?? '',
    acquisition: line.acquisition === 'rented' ? 'rented' : 'outsourced',
    supplier: typeof ext.supplier === 'string' ? ext.supplier : '',
    unit,
    quantity,
    hoursPerActiveDay,
    priceOriginal,
    price,
    conversion,
    minimum,
    contractMonths,
    unitsPerActivation,
    billedUnitsPerActivation,
    netPerActivation,
    netPerActiveDay,
    netFixedMonthly,
    fiscal,
    operatorIncluded: typeof ext.operatorIncluded === 'boolean' ? ext.operatorIncluded : null,
    fuelIncluded: typeof ext.fuelIncluded === 'boolean' ? ext.fuelIncluded : null,
    mobilizationIncluded: typeof ext.mobilizationIncluded === 'boolean' ? ext.mobilizationIncluded : null,
    insuranceIncluded: typeof ext.insuranceIncluded === 'boolean' ? ext.insuranceIncluded : null,
    // Costo ECONÓMICO (lo que entra al costo de la cotización).
    fixedMonthly: economic(netFixedMonthly),
    variablePerActiveDay: economic(netPerActiveDay),
    mobilizationPerActiveDay: economic(mobilizationNetPerActiveDay),
    mobilizationPerActivation: economic(mobilizationNetPerActivation),
    fuelLitersPerActiveDay,
    fuelPerActiveDay,
    // Salida de caja y crédito fiscal (informativos: no son costo).
    cashFixedMonthly: netFixedMonthly * fiscal.cashFactor,
    cashPerActiveDay: (netPerActiveDay + mobilizationNetPerActiveDay) * fiscal.cashFactor,
    creditFixedMonthly: netFixedMonthly * fiscal.creditFactor,
    creditPerActiveDay: (netPerActiveDay + mobilizationNetPerActiveDay) * fiscal.creditFactor,
  };
}
