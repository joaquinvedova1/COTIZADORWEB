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
 * Un proveedor por km se paga por esos km; por tramo, por cada ida o vuelta;
 * por viaje completo (ECO-01), por cada viaje ida y vuelta de la ruta; por
 * salida, una vez por salida con todos sus viajes; por día, hora o mes, por
 * su unidad (external-engine).
 */

import { nonNegative, safeDivide } from '../core/money.js';
import { isPlainObject } from '../core/object.js';
import { createTrace } from '../core/trace.js';
import { formatNumber } from '../core/format.js';
import { billingUnitOf } from '../domain/billing-units.js';
import { activationTerms } from '../domain/activation-terms.js';

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

/** Por proveedor por km, por tramo o por viaje completo: km, viajes y equivalencias de su tarifa. */
function providerActivity(x, { activationsPerMonth, kmPerTrip, oneWayKm, roundTrip }) {
  const legsPerTrip = roundTrip ? 2 : 1;
  const unitsPerMonth = nonNegative(x.billedUnitsPerActivation) * activationsPerMonth;
  const netMonthly = nonNegative(x.netPerActivation) * activationsPerMonth;
  const fullTrip = x.unit === 'trip' && x.tripBasis === 'round_trip';
  // Equivalencias de la tarifa POR UNIDAD de equipo (sin la cantidad).
  let perTripNet;
  let perKmNet;
  if (x.unit === 'km') {
    perTripNet = x.price * kmPerTrip;
    perKmNet = x.price;
  } else if (fullTrip) {
    perTripNet = x.price;
    perKmNet = safeDivide(x.price, kmPerTrip, null);
  } else {
    perTripNet = x.price * legsPerTrip;
    perKmNet = safeDivide(x.price, oneWayKm, null);
  }
  return {
    index: x.index,
    name: x.name || 'Proveedor',
    supplier: x.supplier || '',
    unit: x.unit,
    // "trip": 'leg' (por tramo) o 'round_trip' (por viaje completo, ECO-01); null con otras unidades.
    tripBasis: x.unit === 'trip' ? (fullTrip ? 'round_trip' : 'leg') : null,
    price: x.price,
    quantity: x.quantity,
    minimum: x.minimum,
    unitsPerActivation: x.unitsPerActivation,
    billedUnitsPerActivation: x.billedUnitsPerActivation,
    minimumApplied: nonNegative(x.billedUnitsPerActivation) > nonNegative(x.unitsPerActivation) + 1e-9,
    unitsPerMonth,
    kmPerMonth: x.unit === 'km' ? unitsPerMonth : null,
    // Tramos y viajes completos que factura el proveedor (por tramo: tramos; por viaje completo: viajes).
    legsPerMonth: x.unit === 'trip' ? (fullTrip ? unitsPerMonth * legsPerTrip : unitsPerMonth) : null,
    tripsPerMonth: x.unit === 'trip' ? (fullTrip ? unitsPerMonth : safeDivide(unitsPerMonth, legsPerTrip, 0)) : null,
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
  // Proveedores que cobran POR SALIDA (ECO-01, AUD-T1 H-01): una vez por salida con todos sus
  // viajes. Se explica cuántas salidas factura y cuánto equivale por viaje (nunca se reinterpreta).
  const perActivationProviders = (Array.isArray(external) ? external : [])
    .filter((x) => x && x.unit === 'activation' && tripsPerActivation > 0)
    .map((x) => ({
      index: x.index,
      name: x.name || 'Proveedor',
      supplier: x.supplier || '',
      price: x.price,
      quantity: x.quantity,
      activationsPerMonth,
      tripsPerActivation,
      tripsPerMonth: activationsPerMonth * tripsPerActivation,
      netMonthly: nonNegative(x.netPerActivation) * activationsPerMonth,
      perTripNet: safeDivide(x.price, tripsPerActivation, null),
    }));
  // Cobro por km (PLAN-2026-014, LAB-D4): km FACTURABLES (lo que se cobra) y km DE RUTA (lo que
  // se recorre y se costea) son dos datos; nunca se deriva uno del otro ni se pisa lo cargado.
  const routeKmPerMonth = activationsPerMonth * nonNegative(logistics.routeKmPerActivation);
  const billableKmPerMonth = billingUnitOf(quote).id === 'km' ? nonNegative(activity.billableQuantityPerMonth) : null;
  return {
    applicable: Boolean(route.derived) || billableKmPerMonth !== null || (!route.notApplicable && oneWayKm > 0) || providers.length > 0,
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
    routeKmPerMonth,
    billableKmPerMonth,
    // Km facturables por km de ruta (null sin ruta): 1 = coinciden; > 1 = se cobran más km de los que se recorren.
    billableToRouteKm: billableKmPerMonth !== null && routeKmPerMonth > 0 ? billableKmPerMonth / routeKmPerMonth : null,
    // Para nombrar la activación (llamado / salida / intervención, PLAN-2026-014).
    terms: { serviceType: typeof quote.serviceType === 'string' ? quote.serviceType : null, unit: typeof quote.unit === 'string' ? quote.unit : null },
    storedTripsPerActivation: route.storedTripsPerActivation,
    storedDiffers: Boolean(route.storedDiffers),
    // Facturables > físicos: el mínimo por llamado factura viajes que no se hacen.
    minimumPadding: billable !== null && billable > physicalTripsPerMonth + 1e-9 && physicalTripsPerMonth > 0,
    providers,
    perActivationProviders,
  };
}

/** "Ver cálculo" del transporte: viajes facturables → días → viajes físicos → km → proveedores. */
export function traceTransport(transport) {
  const t = transport || {};
  const derived = t.derived === true;
  const T = activationTerms(t.terms);
  const byKm = t.billableKmPerMonth !== null && t.billableKmPerMonth !== undefined;
  const inputs = [
    derived ? { label: 'Viajes facturables por mes', value: t.billableTripsPerMonth, format: 'number' } : null,
    derived ? { label: 'Viajes por día de trabajo', value: t.tripsPerActiveDay, format: 'number' } : null,
    byKm ? { label: 'Km facturables por mes (lo que cobrás)', value: t.billableKmPerMonth, format: 'km' } : null,
    { label: `Días ${T.per}`, value: t.daysPerActivation, format: 'days' },
    { label: 'Distancia de ida', value: t.oneWayKm, format: 'km' },
    { label: 'Ida y vuelta', value: t.roundTrip ? 'Sí' : 'No', format: 'text' },
  ].filter(Boolean);
  const steps = [
    derived
      ? { label: `Días de trabajo = viajes facturables ÷ viajes por día${t.minimumPadding ? ` (con el mínimo ${T.per})` : ''}`, value: t.workDaysPerMonth, format: 'days' }
      : { label: 'Días de trabajo por mes', value: t.workDaysPerMonth, format: 'days' },
    { label: `${T.Many} por mes = días de trabajo ÷ días ${T.per}`, value: t.activationsPerMonth, format: 'number' },
    { label: derived ? `Viajes físicos ${T.per} = viajes por día × días ${T.per}` : `Viajes físicos ${T.per} ("Viajes ${T.per}")`, value: t.physicalTripsPerActivation, format: 'number' },
    { label: `Viajes físicos por mes = ${T.many} × viajes ${T.per}`, value: t.physicalTripsPerMonth, format: 'number' },
    { label: 'Km por viaje = distancia × (ida y vuelta ? 2 : 1)', value: t.kmPerTrip, format: 'km' },
    { label: 'Km de ruta por mes (lo que se recorre y se costea) = viajes físicos × km por viaje', value: t.routeKmPerMonth, format: 'km' },
    ...(byKm
      ? [
        { label: 'Km facturables por mes (lo que cobrás)', value: t.billableKmPerMonth, format: 'km' },
        t.billableToRouteKm !== null ? { label: 'Km facturables por km de ruta', value: t.billableToRouteKm, format: 'number' } : null,
        { label: 'Diferencia = km facturables − km de ruta', value: t.billableKmPerMonth - t.routeKmPerMonth, format: 'km' },
      ]
      : []),
    ...(Array.isArray(t.providers) ? t.providers : []).flatMap((p) => {
      const what = p.unit === 'km' ? 'km' : p.tripBasis === 'round_trip' ? 'viajes completos' : 'tramos';
      return [
        p.unit === 'km'
          ? { label: `${p.name}: km facturados por mes`, value: p.unitsPerMonth, format: 'km' }
          : p.tripBasis === 'round_trip'
            ? { label: `${p.name}: viajes completos (ida y vuelta) facturados por mes`, value: p.unitsPerMonth, format: 'number' }
            : { label: `${p.name}: tramos facturados por mes (cada ida o cada vuelta)`, value: p.unitsPerMonth, format: 'number' },
        { label: `${p.name}: ${what} × tarifa neta × cantidad`, value: p.netMonthly, format: 'money' },
      ];
    }),
    ...(Array.isArray(t.perActivationProviders) ? t.perActivationProviders : []).flatMap((p) => [
      { label: `${p.name}: ${T.many} que factura por mes (${formatNumber(p.tripsPerActivation, { decimals: 2 })} viajes ${T.per})`, value: p.activationsPerMonth, format: 'number' },
      { label: `${p.name}: ${T.many} × tarifa neta × cantidad`, value: p.netMonthly, format: 'money' },
      { label: `${p.name}: equivale por viaje = tarifa ÷ viajes ${T.per}`, value: p.perTripNet, format: 'money' },
    ]),
  ].filter(Boolean);
  const over = byKm && t.billableKmPerMonth - t.routeKmPerMonth > Math.max(1, t.billableKmPerMonth * 0.01);
  const under = byKm && t.routeKmPerMonth - t.billableKmPerMonth > Math.max(1, t.billableKmPerMonth * 0.01);
  return createTrace({
    id: 'transport',
    title: 'Viajes y km del mes',
    formula: `Días = viajes facturables ÷ viajes por día · ${T.many} = días ÷ días ${T.per} · viajes físicos = ${T.many} × viajes ${T.per} · km de ruta = viajes físicos × km por viaje · proveedor por km = km de ruta × $/km`,
    inputs,
    steps,
    result: { label: 'Km de ruta por mes', value: t.routeKmPerMonth, format: 'km' },
    notes: [
      derived ? `Con la unidad "viaje", los viajes ${T.per} se calculan con los viajes por día: cambiar 1, 2 o 3 viajes por día no cambia los km ni el costo de un proveedor por km si los viajes facturables son los mismos.` : null,
      byKm ? 'Km facturables (lo que cobrás) y km de ruta (lo que se recorre: combustible, desgaste, proveedor por km) son dos datos distintos: uno no se deriva del otro y RATEOS no cambia los que cargaste.' : null,
      over ? 'Facturás más km de los que recorre la ruta: si el equipo recorre los km que facturás, los costos por km quedan cortos (revisá los viajes o la distancia).' : null,
      under ? 'La ruta recorre más km de los que facturás (por ejemplo, vueltas vacías): se costean todos los km de la ruta.' : null,
      t.minimumPadding ? `El mínimo ${T.per} factura más viajes de los que se hacen: se costean los viajes físicos.` : null,
      t.notApplicable ? 'Marcaste "Sin traslados": no hay km de ruta.' : null,
      'Los montos son netos (sin IVA). El costo económico, el IVA que adelantás y la financiación de cada proveedor están en su "Ver cálculo" (Equipos).',
    ].filter(Boolean),
  });
}
