/**
 * TransportEngine — viajes físicos y km de la ruta (PLAN-2026-012).
 *
 * UNIDAD DE VENTA ≠ DÍAS DE TRABAJO ≠ VIAJES FÍSICOS ≠ KM. Cada dato alimenta
 * sólo lo que le corresponde:
 *
 *   viajes facturables      = cantidad a facturar por mes (unidad "viaje")
 *   días de trabajo         = viajes facturables ÷ viajes por día (cost-engine,
 *                             con el mínimo por llamado si rige)
 *   intervenciones (salidas) = días de trabajo ÷ días por intervención
 *   viajes físicos por intervención:
 *     unidad "viaje"        = viajes por día × días por intervención (se DERIVA:
 *                             nunca se asume intervención = viaje ni día = viaje)
 *     otras unidades        = "Viajes por llamado" de Movilización y viajes
 *   viajes físicos por mes  = intervenciones × viajes físicos por intervención
 *   km por viaje            = distancia de ida × (ida y vuelta ? 2 : 1)
 *   km de ruta por mes      = viajes físicos por mes × km por viaje
 *
 * Con unidad "viaje" y sin mínimo por llamado, los viajes físicos son los
 * facturables: 12 viajes a 1, 2 o 3 por día recorren los mismos 2.400 km.
 * Un proveedor por km se paga por esos km; por viaje, por cada ida o vuelta
 * (tramo); por día, hora o mes, por su unidad (external-engine).
 */

import { nonNegative, safeDivide } from '../core/money.js';
import { isPlainObject } from '../core/object.js';
import { createTrace } from '../core/trace.js';
import { billingUnitOf } from '../domain/billing-units.js';

/** ¿Los viajes físicos se derivan de la actividad? (unidad comercial "viaje"). */
export function tripsAreDerived(quote = {}) {
  const unit = billingUnitOf(quote);
  return unit.id === 'trip' && unit.kind === 'quantity';
}

/**
 * Viajes físicos por intervención que recorren la ruta.
 * @param {object} quote
 * @param {object} activity  actividad normalizada (cost-engine.normalizeActivity)
 * @returns {{ derived: boolean, notApplicable: boolean, tripsPerActiveDay: number|null, daysPerActivation: number,
 *             tripsPerActivation: number, storedTripsPerActivation: number, storedDiffers: boolean }}
 */
export function routeTrips(quote = {}, activity = {}) {
  const logistics = isPlainObject(quote.logistics) ? quote.logistics : {};
  const notApplicable = Boolean(logistics.notApplicable);
  const derived = tripsAreDerived(quote);
  const dpaRaw = nonNegative(activity.daysPerActivation, 1);
  const daysPerActivation = dpaRaw > 0 ? dpaRaw : 1;
  const stored = nonNegative(logistics.tripsPerActivation, 1);
  const tripsPerActiveDay = derived ? nonNegative(activity.unitsPerActiveDay) : null;
  const physical = derived ? tripsPerActiveDay * daysPerActivation : stored;
  const tripsPerActivation = notApplicable ? 0 : physical;
  return {
    derived,
    notApplicable,
    tripsPerActiveDay,
    daysPerActivation,
    tripsPerActivation,
    storedTripsPerActivation: stored,
    // Cotización anterior con otro "Viajes por llamado": ya no se usa (se avisa).
    storedDiffers: derived && !notApplicable && tripsPerActiveDay > 0 && Math.abs(stored - physical) > 1e-9,
  };
}

/** Por proveedor por km o por viaje: km, viajes y equivalencias de su tarifa. */
function providerActivity(x, { activationsPerMonth, kmPerTrip, oneWayKm, roundTrip }) {
  const legsPerTrip = roundTrip ? 2 : 1;
  const unitsPerMonth = nonNegative(x.billedUnitsPerActivation) * activationsPerMonth;
  const netMonthly = nonNegative(x.netPerActivation) * activationsPerMonth;
  // Equivalencias de la tarifa POR UNIDAD de equipo (sin la cantidad).
  const perTripNet = x.unit === 'km' ? x.price * kmPerTrip : x.price * legsPerTrip;
  const perKmNet = x.unit === 'km' ? x.price : safeDivide(x.price, oneWayKm, null);
  return {
    index: x.index,
    name: x.name || 'Proveedor',
    supplier: x.supplier || '',
    unit: x.unit,
    price: x.price,
    quantity: x.quantity,
    minimum: x.minimum,
    unitsPerActivation: x.unitsPerActivation,
    billedUnitsPerActivation: x.billedUnitsPerActivation,
    minimumApplied: nonNegative(x.billedUnitsPerActivation) > nonNegative(x.unitsPerActivation) + 1e-9,
    unitsPerMonth,
    kmPerMonth: x.unit === 'km' ? unitsPerMonth : null,
    legsPerMonth: x.unit === 'trip' ? unitsPerMonth : null,
    netMonthly,
    perTripNet: kmPerTrip > 0 ? perTripNet : null,
    perKmNet: kmPerTrip > 0 ? perKmNet : null,
    // Tarifa por km o por viaje sin km / viajes en la cotización (y sin mínimo): no suma.
    noRoute: x.price > 0 && x.quantity > 0 && !(nonNegative(x.billedUnitsPerActivation) > 0),
  };
}

/**
 * Resumen de transporte de una cotización (lo arma cost-engine con lo que ya calculó).
 * @param {{ quote: object, activity: object, route: object, logistics: object, external: object[] }} input
 */
export function transportSummary({ quote = {}, activity = {}, route = {}, logistics = {}, external = [] } = {}) {
  const lg = isPlainObject(quote.logistics) ? quote.logistics : {};
  const activationsPerMonth = nonNegative(activity.activationsPerMonth);
  const tripsPerActivation = nonNegative(logistics.tripsPerActivation);
  const kmPerTrip = nonNegative(logistics.kmPerTrip);
  const oneWayKm = nonNegative(logistics.distanceKm);
  const roundTrip = logistics.roundTrip !== false;
  const billable = route.derived ? nonNegative(activity.billableQuantityPerMonth) : null;
  const physicalTripsPerMonth = activationsPerMonth * tripsPerActivation;
  const providers = (Array.isArray(external) ? external : [])
    .filter((x) => x && (x.unit === 'km' || x.unit === 'trip'))
    .map((x) => providerActivity(x, { activationsPerMonth, kmPerTrip, oneWayKm, roundTrip }));
  return {
    applicable: Boolean(route.derived) || (!route.notApplicable && oneWayKm > 0) || providers.length > 0,
    derived: Boolean(route.derived),
    notApplicable: Boolean(route.notApplicable),
    origin: typeof lg.baseName === 'string' ? lg.baseName.trim() : '',
    destination: typeof lg.destinationName === 'string' ? lg.destinationName.trim() : '',
    oneWayKm,
    roundTrip,
    kmPerTrip,
    billableTripsPerMonth: billable,
    tripsPerActiveDay: route.derived ? route.tripsPerActiveDay : null,
    workDaysPerMonth: nonNegative(activity.activeDaysPerMonth),
    daysPerActivation: nonNegative(activity.daysPerActivation, 1),
    activationsPerMonth,
    physicalTripsPerActivation: tripsPerActivation,
    physicalTripsPerMonth,
    routeKmPerActivation: nonNegative(logistics.routeKmPerActivation),
    routeKmPerMonth: activationsPerMonth * nonNegative(logistics.routeKmPerActivation),
    storedTripsPerActivation: route.storedTripsPerActivation,
    storedDiffers: Boolean(route.storedDiffers),
    // Facturables > físicos: el mínimo por llamado factura viajes que no se hacen.
    minimumPadding: billable !== null && billable > physicalTripsPerMonth + 1e-9 && physicalTripsPerMonth > 0,
    providers,
  };
}

/** "Ver cálculo" del transporte: viajes facturables → días → viajes físicos → km → proveedores. */
export function traceTransport(transport) {
  const t = transport || {};
  const derived = t.derived === true;
  const inputs = [
    derived ? { label: 'Viajes facturables por mes', value: t.billableTripsPerMonth, format: 'number' } : null,
    derived ? { label: 'Viajes por día de trabajo', value: t.tripsPerActiveDay, format: 'number' } : null,
    { label: 'Días por intervención (salida)', value: t.daysPerActivation, format: 'days' },
    { label: 'Distancia de ida', value: t.oneWayKm, format: 'km' },
    { label: 'Ida y vuelta', value: t.roundTrip ? 'Sí' : 'No', format: 'text' },
  ].filter(Boolean);
  const steps = [
    derived
      ? { label: `Días de trabajo = viajes facturables ÷ viajes por día${t.minimumPadding ? ' (con el mínimo por llamado)' : ''}`, value: t.workDaysPerMonth, format: 'days' }
      : { label: 'Días de trabajo por mes', value: t.workDaysPerMonth, format: 'days' },
    { label: 'Intervenciones por mes = días de trabajo ÷ días por intervención', value: t.activationsPerMonth, format: 'number' },
    { label: derived ? 'Viajes físicos por intervención = viajes por día × días por intervención' : 'Viajes físicos por intervención ("Viajes por llamado")', value: t.physicalTripsPerActivation, format: 'number' },
    { label: 'Viajes físicos por mes = intervenciones × viajes por intervención', value: t.physicalTripsPerMonth, format: 'number' },
    { label: 'Km por viaje = distancia × (ida y vuelta ? 2 : 1)', value: t.kmPerTrip, format: 'km' },
    { label: 'Km de ruta por mes = viajes físicos × km por viaje', value: t.routeKmPerMonth, format: 'km' },
    ...(Array.isArray(t.providers) ? t.providers : []).flatMap((p) => [
      p.unit === 'km'
        ? { label: `${p.name}: km facturados por mes`, value: p.unitsPerMonth, format: 'km' }
        : { label: `${p.name}: tramos facturados por mes (cada ida o vuelta)`, value: p.unitsPerMonth, format: 'number' },
      { label: `${p.name}: ${p.unit === 'km' ? 'km' : 'tramos'} × tarifa neta × cantidad`, value: p.netMonthly, format: 'money' },
    ]),
  ];
  return createTrace({
    id: 'transport',
    title: 'Viajes y km del mes',
    formula: 'Días = viajes facturables ÷ viajes por día · intervenciones = días ÷ días por intervención · viajes físicos = intervenciones × viajes por intervención · km = viajes físicos × km por viaje · proveedor por km = km × $/km',
    inputs,
    steps,
    result: { label: 'Km de ruta por mes', value: t.routeKmPerMonth, format: 'km' },
    notes: [
      derived ? 'Con la unidad "viaje", los viajes por intervención se calculan con los viajes por día: cambiar 1, 2 o 3 viajes por día no cambia los km ni el costo de un proveedor por km si los viajes facturables son los mismos.' : null,
      t.minimumPadding ? 'El mínimo por llamado factura más viajes de los que se hacen: se costean los viajes físicos.' : null,
      t.notApplicable ? 'Marcaste "Sin traslados": no hay km de ruta.' : null,
      'Los montos son netos (sin IVA). El costo económico, el IVA que adelantás y la financiación de cada proveedor están en su "Ver cálculo" (Equipos).',
    ].filter(Boolean),
  });
}
