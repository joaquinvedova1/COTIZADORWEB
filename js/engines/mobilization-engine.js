/**
 * MobilizationEngine — MOVILIZACIÓN DEL RECURSO PRINCIPAL (PLAN-2026-005).
 *
 * Separa "¿cómo llega este equipo al lugar del servicio?" de la logística
 * auxiliar (vehículos de apoyo y de personal, en logistics-engine.js).
 *
 *   self (por sus propios medios)
 *     km/llamado   = km de ruta por llamado × cantidad de unidades
 *     litros       = km × consumo en ruta (L/100 km) / 100
 *     combustible  = litros × precio      (0 si lo provee el cliente; un externo
 *                                          sólo si su tarifa NO incluye combustible)
 *     desgaste     = km × mantenimiento y neumáticos por km (sin combustible
 *                    NI amortización: la amortización ya está en el costo de tenerlo)
 *     conductor    = su operador ya incluido en Personal → NO se suma mano de
 *                    obra (el tiempo de manejo está dentro de su costo)
 *   transported (lo transporta otro equipo) → 0 acá: el costo está en la línea
 *                    del equipo que lo transporta (propio, alquilado o tercerizado)
 *   support (con un vehículo de apoyo) → 0 acá: el costo está en ese vehículo
 *                    de la logística auxiliar
 *   none (no requiere) / sin definir → 0
 *
 * Un externo con la movilización INCLUIDA en su tarifa no suma nada acá.
 *
 *   por día activo = costo por llamado / días por llamado
 */

import { nonNegative, safeDivide } from '../core/money.js';
import { isPlainObject, objectList } from '../core/object.js';

/**
 * @param {object[]} equipment  líneas de equipo (las que ve el motor)
 * @param {object} ctx { notApplicable, routeKmPerActivation, daysPerActivation, activationsPerMonth,
 *                       fuelPricePerLiter, fuelPaidByUs, vehicles (logística auxiliar), labor (líneas de personal) }
 */
export function computeMobilization(equipment = [], ctx = {}) {
  const items = objectList(equipment);
  const vehicles = objectList(ctx.vehicles);
  const labor = objectList(ctx.labor);
  const routeKm = ctx.notApplicable ? 0 : nonNegative(ctx.routeKmPerActivation);
  const dpaRaw = nonNegative(ctx.daysPerActivation, 1);
  const dpa = dpaRaw > 0 ? dpaRaw : 1;
  const fuelPrice = ctx.fuelPaidByUs === false ? 0 : nonNegative(ctx.fuelPricePerLiter);

  const lines = items.map((line, index) => {
    const m = isPlainObject(line.mobilization) ? line.mobilization : {};
    const mode = ['self', 'transported', 'support', 'none'].includes(m.mode) ? m.mode : null;
    const quantity = nonNegative(line.quantity);
    const external = line.acquisition === 'rented' || line.acquisition === 'outsourced';
    const ext = isPlainObject(line.external) ? line.external : {};
    const includedByProvider = external && ext.mobilizationIncluded === true;
    const warnings = [];
    let km = 0;
    let liters = 0;
    let fuel = 0;
    let wear = 0;
    let driver = null;
    let carrier = null;
    let support = null;

    if (mode === 'self' && !includedByProvider) {
      km = routeKm * quantity;
      liters = (km * nonNegative(m.travelLitersPer100Km)) / 100;
      // Un externo paga el combustible en ruta sólo si su tarifa NO lo incluye
      // (false). Sin definir (null) no se suma y la completitud lo advierte,
      // igual que el combustible trabajando (external-engine).
      const paysFuel = !external || ext.fuelIncluded === false;
      fuel = paysFuel ? liters * fuelPrice : 0;
      wear = km * nonNegative(m.travelCostPerKm);
      driver = m.driver === 'other' ? 'other' : m.driver === 'operator' ? 'operator' : null;
      if (routeKm > 0 && nonNegative(m.travelLitersPer100Km) <= 0) warnings.push('travel_consumption');
      if (!driver) warnings.push('driver');
    } else if (mode === 'transported') {
      const target = items.find((e, i) => i !== index && e && e.id && e.id === m.carrierLineId) || null;
      if (!target) warnings.push('carrier_missing');
      else {
        carrier = { id: target.id, name: target.name || 'Equipo' };
        const tm = isPlainObject(target.mobilization) ? target.mobilization : {};
        if (tm.mode === 'transported' && tm.carrierLineId === line.id) warnings.push('carrier_cycle');
      }
    } else if (mode === 'support') {
      const vehicle = vehicles.find((v) => v && v.id && v.id === m.supportVehicleId) || null;
      if (!vehicle) warnings.push('support_missing');
      else support = { id: vehicle.id, name: vehicle.name || 'Vehículo' };
    }

    const operator = typeof line.operatorLaborId === 'string' ? labor.find((l) => l && l.id === line.operatorLaborId) || null : null;
    const perActivation = fuel + wear;
    return {
      id: line.id ?? null,
      name: line.name ?? '',
      mode,
      external,
      includedByProvider,
      quantity,
      km,
      liters,
      fuelPerActivation: fuel,
      wearPerActivation: wear,
      perActivation,
      fuelPerActiveDay: safeDivide(fuel, dpa, 0),
      wearPerActiveDay: safeDivide(wear, dpa, 0),
      perActiveDay: safeDivide(perActivation, dpa, 0),
      travelLitersPer100Km: nonNegative(m.travelLitersPer100Km),
      travelCostPerKm: nonNegative(m.travelCostPerKm),
      driver,
      operatorName: operator ? operator.role || 'Operador' : null,
      carrier,
      support,
      warnings,
    };
  });

  const sum = (key) => lines.reduce((s, l) => s + l[key], 0);
  const activations = nonNegative(ctx.activationsPerMonth);
  return {
    routeKmPerActivation: routeKm,
    lines,
    kmPerActivation: sum('km'),
    litersPerActivation: sum('liters'),
    fuelPerActivation: sum('fuelPerActivation'),
    wearPerActivation: sum('wearPerActivation'),
    perActivation: sum('perActivation'),
    fuelPerActiveDay: sum('fuelPerActiveDay'),
    wearPerActiveDay: sum('wearPerActiveDay'),
    perActiveDay: sum('perActiveDay'),
    kmPerMonth: sum('km') * activations,
    litersPerMonth: sum('liters') * activations,
    monthlyCost: sum('perActivation') * activations,
  };
}
