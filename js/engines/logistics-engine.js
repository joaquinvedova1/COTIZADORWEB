/**
 * LogisticsEngine — traslados entre base y locación.
 *
 *   kmRuta/viaje     = distancia × (ida y vuelta ? 2 : 1)
 *   kmRuta/activación = kmRuta/viaje × viajesPorActivación
 *   por vehículo:
 *     km/activación   = kmRuta/activación × cantidad
 *     litros          = km × consumo(L/100 km) / 100
 *     combustible     = litros × precioCombustible
 *     desgaste        = km × costo por km (no combustible)
 *   costo/activación = Σ combustible + Σ desgaste + peajes + alojamiento/viáticos
 *   activaciones/mes = díasActivos / díasPorActivación
 *   costo mensual    = costo/activación × activaciones/mes
 *   por día activo   = costo/activación / díasPorActivación
 */

import { nonNegative, safeDivide } from '../core/money.js';

export function computeLogistics(logistics = {}, { activationsPerMonth = 0, daysPerActivation = 1, fuelPricePerLiter = 0, fuelPaidByUs = true } = {}) {
  const notApplicable = Boolean(logistics.notApplicable);
  const distanceKm = notApplicable ? 0 : nonNegative(logistics.distanceKm);
  const roundTrip = logistics.roundTrip !== false;
  const tripsPerActivation = notApplicable ? 0 : nonNegative(logistics.tripsPerActivation, 1);
  const kmPerTrip = distanceKm * (roundTrip ? 2 : 1);
  const routeKmPerActivation = kmPerTrip * tripsPerActivation;
  const fuelPrice = fuelPaidByUs ? nonNegative(fuelPricePerLiter) : 0;

  const vehicles = (notApplicable ? [] : Array.isArray(logistics.vehicles) ? logistics.vehicles : []).map((v) => {
    const count = nonNegative(v.count);
    const km = routeKmPerActivation * count;
    const liters = (km * nonNegative(v.consumptionLPer100Km)) / 100;
    const fuel = liters * fuelPrice;
    const wear = km * nonNegative(v.costPerKm);
    return {
      id: v.id ?? null,
      name: v.name ?? '',
      count,
      kmPerActivation: km,
      litersPerActivation: liters,
      fuelPerActivation: fuel,
      wearPerActivation: wear,
      totalPerActivation: fuel + wear,
    };
  });

  const tolls = notApplicable ? 0 : nonNegative(logistics.tollsPerActivation);
  const lodging = notApplicable ? 0 : nonNegative(logistics.lodgingPerActivation);
  const vehicleKmPerActivation = vehicles.reduce((s, v) => s + v.kmPerActivation, 0);
  const litersPerActivation = vehicles.reduce((s, v) => s + v.litersPerActivation, 0);
  const fuelPerActivation = vehicles.reduce((s, v) => s + v.fuelPerActivation, 0);
  const wearPerActivation = vehicles.reduce((s, v) => s + v.wearPerActivation, 0);
  const nonFuelPerActivation = wearPerActivation + tolls + lodging;
  const costPerActivation = fuelPerActivation + nonFuelPerActivation;

  const activations = nonNegative(activationsPerMonth);
  const dpa = nonNegative(daysPerActivation);

  return {
    notApplicable,
    distanceKm,
    roundTrip,
    tripsPerActivation,
    kmPerTrip,
    routeKmPerActivation,
    vehicles,
    vehicleKmPerActivation,
    litersPerActivation,
    fuelPerActivation,
    wearPerActivation,
    tollsPerActivation: tolls,
    lodgingPerActivation: lodging,
    nonFuelPerActivation,
    costPerActivation,
    activationsPerMonth: activations,
    kmPerMonth: vehicleKmPerActivation * activations,
    litersPerMonth: litersPerActivation * activations,
    fuelMonthly: fuelPerActivation * activations,
    nonFuelMonthly: nonFuelPerActivation * activations,
    monthlyCost: costPerActivation * activations,
    fuelPerActiveDay: safeDivide(fuelPerActivation, dpa, 0),
    nonFuelPerActiveDay: safeDivide(nonFuelPerActivation, dpa, 0),
    perActiveDay: safeDivide(costPerActivation, dpa, 0),
  };
}
