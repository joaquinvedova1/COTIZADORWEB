/**
 * Etapa 2 · Los recursos — Equipos.
 *
 * PROPIOS: separa COSTO DE TENERLO / posesión (existe aunque el equipo no
 * trabaje) de COSTO DE USARLO / operación (existe sólo cuando trabaja).
 * Básico: nombre, cantidad, horas por día, valor de reposición, vida útil y
 * consumo. Opciones avanzadas (con resumen visible): residual, seguro,
 * patente, otros costos, certificaciones, costo de capital, mantenimiento y
 * neumáticos.
 *
 * ALQUILADOS / TERCERIZADOS (PLAN-2026-005): no son activos propios (sin
 * amortización ni seguro propio). Tarifa NETA del proveedor por unidad, con
 * mínimo, qué incluye (operador, combustible, movilización, seguro) y su
 * tratamiento fiscal (IVA recuperable o no, percepciones): el costo es el
 * económico; la salida de caja y el crédito fiscal se informan aparte.
 *
 * Cada línea guarda los valores que usó (snapshot): si cambian en Recursos,
 * se avisa y la persona decide (nunca se actualiza sola).
 */

import { h, mount } from '../../dom.js';
import { badge, card, dateField, formGrid, selectField, triStateField, confirmDialog, emptyState, icon } from '../../components.js';
import { equipmentLineFromLibrary, externalLineFromService, blankEquipmentLine, createExternalTerms, createMobilization, acquisitionOf } from '../../../domain/quote-factory.js';
import { ACQUISITION_MODES, CURRENCIES, EXTERNAL_UNITS, EXTERNAL_TRIP_BASES, EXTERNAL_FUEL_MODES, VAT_RECOVERY, MAINTENANCE_MODES, BUDGET_PERIODS, TIRE_MODES, labelOf } from '../../../domain/catalogs.js';
import { activationTerms, withActivationOptions } from '../../../domain/activation-terms.js';
import { computeEquipmentUnit, maintenanceOf, tiresOf, MAX_EQUIPMENT_HOURS_PER_DAY } from '../../../engines/equipment-engine.js';
import { wearNote, wearWarnings } from '../../equipment-wear-ui.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { conversionFactor } from '../../../engines/currency-engine.js';
import { lineIncrementalImpact } from '../../../engines/impact-engine.js';
import { externalUnitAssumption, externalQuantityAssumption, externalQuantityHolds, operatorSupplierSnapshot } from '../../../engines/completeness-engine.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, moneyText, plural, stepName } from './shared.js';
import { baseFields, lineOriginBlock, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { MOBILIZATION_MODES } from '../../../domain/catalogs.js';
import { transportOf, providerActivityText, providerRouteText, routeName } from './transport.js';
import { fieldHref } from '../../field-links.js';
import { assignmentBlock } from './assignment.js';
import { billingUnitOf } from '../../../domain/billing-units.js';

const isExternalLine = (line) => acquisitionOf(line) !== 'owned';

/** Símbolo de la moneda de un valor ("$", "US$"). */
function currencyUnit(base, quote) {
  const code = base && typeof base.currency === 'string' && base.currency ? base.currency : quoteCurrencyOf(quote);
  const c = CURRENCIES.find((x) => x.id === code);
  return c ? c.symbol : '$';
}

/** Nombre de la activación de la cotización de un resultado (llamado / salida / intervención…, PLAN-2026-014). */
const termsOfResult = (result) => activationTerms(result && result.model && result.model.activationRounding ? result.model.activationRounding.terms : null);
/**
 * Unidades de tarifa externa con la activación nombrada como en la cotización ("Por salida", "/salida").
 * "Por viaje completo (ida y vuelta)" (ECO-01) es la unidad "trip" con `tripBasis: 'round_trip'`:
 * en el selector es una opción más (`trip:round_trip`); lo guardado como "trip" sigue siendo por tramo.
 */
const ROUND_TRIP = 'trip:round_trip';
const unitsFor = (T) => withActivationOptions(EXTERNAL_UNITS, T).flatMap((u) => {
  if (u.id !== 'trip') return [u];
  const round = EXTERNAL_TRIP_BASES.find((b) => b.id === 'round_trip');
  return [u, { id: ROUND_TRIP, label: round.label, short: round.short }];
});
/** Opción del selector de una tarifa externa (o de un resultado del motor). */
const unitKeyOf = (ext) => {
  const x = ext || {};
  const unit = x.unit || 'day';
  return unit === 'trip' && x.tripBasis === 'round_trip' ? ROUND_TRIP : unit;
};
const unitShort = (unit, T = activationTerms()) => (unitsFor(T).find((u) => u.id === unit) || EXTERNAL_UNITS[1]).short;

/** "Por qué" de cada unidad de tarifa (cómo se cuentan las unidades por activación). */
const unitHints = (T) => ({
  hour: `Unidades ${T.per} = horas de uso por día × días ${T.per}.`,
  day: `Unidades ${T.per} = días ${T.per}.`,
  month: 'Costo fijo por mes (trabaje o no).',
  trip: 'Cobra cada ida o cada vuelta (tramo): un viaje ida y vuelta son 2 tramos. Los viajes salen de la ruta y de los viajes físicos de la cotización.',
  [ROUND_TRIP]: 'Cobra cada viaje completo (ida y vuelta): un viaje ida y vuelta es 1 unidad. Los viajes salen de la ruta y de los viajes físicos de la cotización.',
  km: `Unidades ${T.per} = km de ruta ${T.per}: viajes físicos × km por viaje (de "Movilización y viajes").`,
  activation: `Un cobro en ${T.each}.`,
  global: 'Monto por todo el contrato, repartido en los meses de contrato.',
});

/** Ficha del equipo a la utilización de la cotización (por unidad). */
export function equipmentCardAtQuote(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const activity = result.activity;
  const hours = line.hoursPerActiveDay;
  // Mismo tipo de cambio que el costo de la cotización (un valor en USD no se mezcla con pesos).
  const f = Number.isFinite(line.conversion) ? line.conversion : 1;
  const src = source || {};
  return computeEquipmentUnit(
    {
      ...src,
      replacementValue: (Number(src.replacementValue) || 0) * f,
      residualValue: (Number(src.residualValue) || 0) * f,
      availableHoursPerMonth: activity.availableDaysPerMonth * hours,
      availableDaysPerMonth: activity.availableDaysPerMonth,
      utilizationPct: activity.utilizationPct,
    },
    { fuelPricePerLiter: result.model.fuel.pricePerLiter, fuelPaidByUs: result.model.fuel.paidByUs },
  );
}

function monthlyAtEstimate(result, line) {
  const D = result.activity.activeDaysPerMonth;
  return line.fixedMonthly * monthsFactor(D, result.activity.availableDaysPerMonth) + line.variablePerActiveDay * D + externalRoundingAt(result, line).economic;
}

/** Lo que suma un externo por contar cada salida completa (PLAN-2026-011; 0 si está apagado). */
function externalRoundingAt(result, line) {
  const r = result && result.activationRounding;
  const x = line && line.external;
  if (!r || !r.active || !x) return { economic: 0, cash: 0 };
  return {
    // El combustible por km de ruta (PLAN-2026-012) también es por salida (va a Combustible, no al proveedor).
    economic: (x.discretePerActivation + x.mobilizationPerActivation + (x.fuelPerActivationRoute || 0)) * r.extraActivations,
    cash: (x.cashDiscretePerActivation + x.cashMobilizationPerActivation) * r.extraActivations,
  };
}

/** Actividad del proveedor por km o por viaje (PLAN-2026-012), o null. */
function providerOf(result, index) {
  const t = transportOf(result);
  return t && Array.isArray(t.providers) ? t.providers.find((p) => p.index === index) || null : null;
}

/** Campo donde se define la ruta que falta (el mismo que marca la completitud). */
function routeFieldOf(result) {
  const item = result && result.completeness && (result.completeness.items || []).find((i) => i.id === 'external_route');
  return item && item.focus ? item.focus : 'logistics.distanceKm';
}

/** "Combustible a tu cargo: 2.400 km × 35 L/100 km = 840 L × $ 1.500 = $ 1.260.000 por mes". */
function externalFuelText(result, line) {
  const x = line && line.external;
  if (!x || !(x.fuelLitersPerActiveDay > 0 || x.fuelKmPerActivation > 0)) return '';
  const D = result.activity.activeDaysPerMonth;
  const A = result.activity.activationsPerMonth;
  const price = result.model.fuel.paidByUs ? result.model.fuel.pricePerLiter : 0;
  const liters = x.fuelLitersPerActiveDay * D;
  const cost = x.fuelPerActiveDay * D;
  if (x.fuelMode === 'per_hour') {
    return `Combustible a tu cargo: ${formatNumber(x.fuelLitersPerHour, { decimals: 2 })} L/h × ${formatNumber(x.hoursPerActiveDay, { decimals: 2 })} h × ${formatNumber(D, { decimals: 2 })} días = ${formatValue(liters, 'liters')} × ${formatMoney(price)} = ${formatMoney(cost)} por mes (va a Combustible, aparte de la tarifa).`;
  }
  if (!(x.fuelKmPerActivation > 0)) return 'Falta la distancia de la ruta: sin km no se calcula el combustible por km.';
  const km = x.fuelKmPerActivation * A;
  const per = x.fuelMode === 'km_per_liter' ? `÷ ${formatNumber(x.fuelKmPerLiter, { decimals: 2 })} km/L` : `× ${formatNumber(x.fuelLitersPer100Km, { decimals: 2 })} L/100 km`;
  return `Combustible a tu cargo: ${formatValue(km, 'km')} de ruta ${per} = ${formatValue(liters, 'liters')} × ${formatMoney(price)} = ${formatMoney(cost)} por mes (va a Combustible, aparte de la tarifa).`;
}

/**
 * Financiación de un externo (PLAN-2026-011): con su plazo propio o con el de
 * "Proveedores". Salida de caja, días financiados, capital de trabajo y costo
 * financiero asociado al nivel estimado.
 */
function supplierFinanceAt(result, index) {
  const line = result && result.model.equipment[index];
  const x = line && line.external;
  if (!x) return null;
  const fin = result.model.finance;
  const key = `supplier:${x.id ?? index}`;
  const own = (fin.suppliers || []).find((g) => g.key === key) || null;
  const general = fin.groups.find((g) => g.id === 'suppliers') || null;
  const D = result.activity.activeDaysPerMonth;
  const factor = monthsFactor(D, result.activity.availableDaysPerMonth);
  const cash = x.cashFixedMonthly * factor + x.cashPerActiveDay * D + externalRoundingAt(result, line).cash;
  const days = own ? own.financingDays : general ? general.financingDays : 0;
  const workingCapital = cash * (days / 30);
  return {
    own: Boolean(own),
    payDays: own ? own.payDays : general ? general.payDays : 0,
    days,
    cash,
    workingCapital,
    financial: workingCapital * (fin.monthlyRatePct / 100),
  };
}

/**
 * Horas por día cargadas por encima del tope (PLAN-2026-014): el dato sigue marcado con error,
 * el costo se calcula con 24 h por unidad y más horas se cargan como más equipos.
 */
function hoursCapNote(source) {
  const h = source ? Number(source.hoursPerActiveDay) : NaN;
  if (!(Number.isFinite(h) && h > MAX_EQUIPMENT_HOURS_PER_DAY)) return null;
  const max = MAX_EQUIPMENT_HOURS_PER_DAY;
  return `Cargaste ${formatNumber(h, { decimals: 2 })} h de uso por día: el máximo es ${max} h por unidad y el costo se calcula con ${max} h. Para más horas por día, sumá equipos en "Cantidad" (2 equipos × 20 h = 40 equipo-horas por día).`;
}

function equipmentTrace(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const o = line.ownership;
  const op = line.operation;
  return createTrace({
    id: 'equipment_line',
    title: `Equipo — ${line.name || 'Equipo'}`,
    formula: 'Posesión/mes = (reposición − residual) / (vida útil × 12) + (seguro + patente + certificaciones + otros) / 12 + mantenimiento fijo (presupuesto) + inversión promedio × tasa de capital / 12 · Operación/h = mantenimiento/h + neumáticos/h + litros/h × precio combustible (service = costo / horas entre services; juego = costo / vida útil en horas) · Costo del mes = posesión × cantidad + operación/h × horas por día × días activos × cantidad',
    inputs: [
      line.conversion !== undefined && line.conversion !== 1 ? { label: `Tipo de cambio de la cotización (${(source && source.base && source.base.currency) || ''})`, value: line.conversion, format: 'number' } : null,
      { label: 'Valor de reposición (en la moneda de la cotización)', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil (años)', value: o.lifeYears, format: 'number' },
      { label: 'Cantidad', value: line.quantity, format: 'number' },
      { label: 'Horas de uso por día activo', value: line.hoursPerActiveDay, format: 'hours' },
      { label: 'Días activos por mes', value: result.activity.activeDaysPerMonth, format: 'days' },
      op.fuelNotApplicable ? { label: 'Combustible', value: 'No usa combustible', format: 'text' } : { label: 'Precio combustible (si lo pagamos)', value: op.fuelPricePerLiter, format: 'rate' },
      op.fuelNotApplicable ? null : { label: 'Consumo', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      { label: `Mantenimiento (${labelOf(MAINTENANCE_MODES, op.maintenanceMode, 'por hora').toLowerCase()})`, value: o.maintenanceFixedMonthly > 0 ? o.maintenanceFixedMonthly : op.maintenancePerHour, format: 'money', unit: o.maintenanceFixedMonthly > 0 ? 'por mes (fijo)' : 'por hora' },
      { label: `Neumáticos (${labelOf(TIRE_MODES, op.tiresMode, 'por hora').toLowerCase()})`, value: op.tiresPerKm > 0 ? op.tiresPerKm : op.tiresPerHour, format: 'money', unit: op.tiresPerKm > 0 ? 'por km (en la ruta)' : 'por hora' },
    ].filter(Boolean),
    steps: [
      { label: 'Amortización mensual (por unidad)', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones + otros + mantenimiento fijo (por unidad)', value: o.cashMonthly, format: 'money' },
      { label: 'Costo de capital mensual (por unidad)', value: o.capitalCostMonthly, format: 'money' },
      ...(line.shared
        ? [
          { label: 'Posesión mensual × cantidad (100 %)', value: line.fullFixedMonthly, format: 'money' },
          { label: '% de sus costos fijos asignado a esta cotización (equipo compartido)', value: line.fixedCostSharePct, format: 'percent' },
          { label: 'Posesión que carga esta cotización', value: line.fixedMonthly, format: 'money' },
          { label: 'Lo que tiene que cubrir otro contrato', value: line.unassignedFixedMonthly, format: 'money' },
        ]
        : [{ label: 'Posesión mensual × cantidad', value: line.fixedMonthly, format: 'money' }]),
      { label: 'Operación por hora (por unidad)', value: op.totalPerHour, format: 'money' },
      { label: 'Operación por día activo × cantidad', value: line.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Costo del equipo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'La amortización y el costo de capital no son salidas de caja: no se financian en el costo financiero.',
      line.shared ? 'Equipo compartido: el % asignado reparte sólo los costos fijos (lo cargás vos; no sale de los días que trabaje). La operación sigue el uso real.' : null,
      source && (source.hoursPerActiveDay === null || source.hoursPerActiveDay === undefined || source.hoursPerActiveDay === '')
        ? 'Horas de uso vacías: se usan las horas por día activo de la cotización.'
        : null,
      hoursCapNote(source),
    ],
  });
}

/** Resumen corto de mantenimiento y neumáticos según cómo se cargaron. */
function wearSummary(e = {}) {
  const m = maintenanceOf(e);
  const t = tiresOf(e);
  const maintenance = m.mode === 'budget'
    ? `mantenimiento fijo ${formatMoney(m.fixedMonthly)}/mes`
    : `mantenimiento ${formatMoney(m.perHour)}/h${m.mode === 'service' ? ' (service)' : ''}`;
  const tires = t.mode === 'set_km' ? `neumáticos ${formatMoney(t.perKm, { decimals: 2 })}/km` : `neumáticos ${formatMoney(t.perHour)}/h${t.mode === 'set_hours' ? ' (juego)' : ''}`;
  return { maintenance, tires };
}

function externalTrace(result, index, source, impact = null) {
  const T = termsOfResult(result);
  const line = result && result.model.equipment[index];
  const x = line && line.external;
  if (!x) return null;
  const f = x.fiscal;
  // Impacto incremental (PLAN-2026-010): cuánto sube el costo total con esta línea.
  const impactSteps = impact
    ? [
      { label: 'Impacto en el costo del mes: costo del proveedor', value: impact.own, format: 'money' },
      { label: '+ estructura asociada', value: impact.structure, format: 'money' },
      { label: '+ financiación asociada', value: impact.financial, format: 'money' },
      Math.abs(impact.contingency) > 0.5 ? { label: '+ contingencia asociada', value: impact.contingency, format: 'money' } : null,
      Math.abs(impact.other) > 0.5 ? { label: '+ otros impactos (combustible, movilización…)', value: impact.other, format: 'money' } : null,
      { label: '= impacto total aproximado en el costo del mes', value: impact.total, format: 'money' },
    ].filter(Boolean)
    : [];
  // Financiación de este proveedor (PLAN-2026-011): con su plazo o el general.
  const sf = supplierFinanceAt(result, index);
  const financeSteps = sf
    ? [
      { label: `Proveedor ${x.supplier || x.name || ''}: salida de caja del mes`.replace(/\s+:/, ':'), value: sf.cash, format: 'money' },
      { label: sf.own ? 'Plazo de pago a este proveedor' : 'Plazo de pago (el general de Proveedores)', value: sf.payDays, format: 'days' },
      { label: 'Días financiados (días hasta facturar + plazo de cobro − plazo del proveedor)', value: sf.days, format: 'days' },
      { label: 'Capital de trabajo de este proveedor', value: sf.workingCapital, format: 'money' },
      { label: 'Costo financiero asociado', value: sf.financial, format: 'money' },
    ]
    : [];
  const rounding = externalRoundingAt(result, line);
  // Ruta (PLAN-2026-012): viajes facturables → días → viajes físicos → km → proveedor.
  const t = transportOf(result);
  const p = providerOf(result, index);
  const routeSteps = p && t && !p.noRoute
    ? [
      t.derived ? { label: `Días de trabajo = ${formatNumber(t.billableTripsPerMonth, { decimals: 2 })} viajes facturables ÷ ${formatNumber(t.tripsPerActiveDay, { decimals: 2 })} por día`, value: t.workDaysPerMonth, format: 'days' } : null,
      { label: `Viajes físicos por mes (${T.many} × viajes ${T.per})`, value: t.physicalTripsPerMonth, format: 'number' },
      { label: `Km por viaje${routeName(t) ? ` (${routeName(t)})` : ''}`, value: t.kmPerTrip, format: 'km' },
      p.unit === 'km'
        ? { label: 'Km facturados por mes = viajes físicos × km por viaje', value: p.unitsPerMonth, format: 'km' }
        : p.tripBasis === 'round_trip'
          ? { label: 'Viajes completos facturados por mes (ida y vuelta)', value: p.unitsPerMonth, format: 'number' }
          : { label: 'Tramos facturados por mes (cada ida o vuelta)', value: p.unitsPerMonth, format: 'number' },
      { label: `Neto del proveedor en el mes = ${p.unit === 'km' ? 'km' : p.tripBasis === 'round_trip' ? 'viajes completos' : 'tramos'} × ${formatMoney(p.price)} × cantidad`, value: p.netMonthly, format: 'money' },
      p.perTripNet !== null ? { label: 'Equivalente por viaje completo (neto)', value: p.perTripNet, format: 'money' } : null,
      p.perKmNet !== null ? { label: 'Equivalente por km (neto)', value: p.perKmNet, format: 'money' } : null,
    ].filter(Boolean)
    : [];
  const D = result.activity.activeDaysPerMonth;
  const factor = monthsFactor(D, result.activity.availableDaysPerMonth);
  const netMonth = x.netFixedMonthly * factor + x.netPerActiveDay * D;
  const cashMonth = x.cashFixedMonthly * factor + x.cashPerActiveDay * D;
  const creditMonth = x.creditFixedMonthly * factor + x.creditPerActiveDay * D;
  const monthSteps = [
    { label: 'Neto del proveedor en el mes (sin IVA)', value: netMonth, format: 'money' },
    { label: 'Salida de caja del mes (neto + IVA + percepciones + cargos)', value: cashMonth, format: 'money' },
    { label: 'IVA y percepciones que adelantás y recuperás (crédito fiscal, no es costo)', value: creditMonth, format: 'money' },
  ];
  return createTrace({
    id: 'external_line',
    title: `${x.acquisition === 'rented' ? 'Alquiler' : 'Servicio tercerizado'} — ${x.name || 'Externo'}`,
    formula: `Facturado ${T.per} = máx(unidades ${T.per}, mínimo) × tarifa neta × cantidad · Costo económico = neto × (1 + cargos no recuperables % + IVA % × (1 − parte recuperable)) · Por día activo = ${T.per} / días ${T.per}`,
    inputs: [
      x.conversion !== 1
        ? { label: `Tarifa neta (sin IVA) ${unitShort(unitKeyOf(x), T)} en ${(source && source.base && source.base.currency) || 'otra moneda'}`, value: x.priceOriginal, format: 'number' }
        : { label: `Tarifa neta (sin IVA) ${unitShort(unitKeyOf(x), T)}`, value: x.priceOriginal, format: 'money' },
      x.conversion !== 1 ? { label: 'Tipo de cambio de la cotización', value: x.conversion, format: 'number' } : null,
      x.conversion !== 1 ? { label: 'Tarifa neta convertida', value: x.price, format: 'money' } : null,
      { label: `Unidades ${T.per}`, value: x.unitsPerActivation, format: 'number' },
      { label: 'Mínimo facturable', value: x.minimum, format: 'number' },
      { label: 'Cantidad', value: x.quantity, format: 'number' },
      { label: `Días ${T.per}`, value: result.activity.daysPerActivation, format: 'days' },
      { label: 'IVA del proveedor', value: f.vatPct, format: 'percent' },
      { label: 'Parte del IVA que recuperás', value: f.recoverableShare * 100, format: 'percent' },
      { label: 'Cargos no recuperables', value: f.nonRecoverablePct, format: 'percent' },
    ].filter(Boolean),
    steps: [
      { label: `Unidades facturadas ${T.per}`, value: x.billedUnitsPerActivation, format: 'number' },
      { label: `Neto facturado ${T.per}`, value: x.netPerActivation, format: 'money' },
      { label: 'Fijo mensual neto (tarifas por mes o globales)', value: x.netFixedMonthly, format: 'money' },
      { label: 'Costo económico por día activo', value: x.variablePerActiveDay, format: 'money' },
      x.mobilizationPerActiveDay > 0 ? { label: 'Movilización del proveedor por día activo', value: x.mobilizationPerActiveDay, format: 'money' } : null,
      x.fuelPerActiveDay > 0 ? { label: x.fuelMode === 'per_hour' ? 'Combustible no incluido por día activo (L/h × horas)' : 'Combustible no incluido por día activo (km de ruta × consumo por km)', value: x.fuelPerActiveDay, format: 'money' } : null,
      { label: 'Salida de caja con impuestos por día activo (se financia hasta cobrar; no es costo)', value: x.cashPerActiveDay, format: 'money' },
      { label: 'Crédito fiscal por día activo (no es costo)', value: x.creditPerActiveDay, format: 'money' },
      ...routeSteps,
      ...monthSteps,
      ...financeSteps,
      ...impactSteps,
    ].filter(Boolean),
    result: { label: 'Costo del recurso externo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'El IVA recuperable y las percepciones son caja que se adelanta, no costo: no se suman al costo de la cotización.',
      f.recovery === null ? 'Sin definir si el IVA es recuperable: se usa el precio neto (sin IVA).' : null,
      'Sin amortización, seguro propio ni costo de capital: el equipo no es tuyo.',
      'Ganancias no se carga como % sobre el alquiler y el IIBB del proveedor ya está en su precio.',
      impact ? 'El impacto total es la diferencia entre el costo del mes con y sin esta línea (misma actividad): el proveedor arrastra estructura, financiación y, si corresponde, contingencia e IVA que no recuperás.' : null,
      rounding.economic > 0.005 ? `${T.Each} se cuenta ${T.whole}: incluye ${formatMoney(rounding.economic)} de efecto del redondeo (${formatNumber(result.activationRounding.costed, { decimals: 0 })} ${T.many} ${T.g('costeadas', 'costeados')} en lugar de ${formatNumber(result.activationRounding.estimated, { decimals: 2 })} promedio).` : null,
      sf && sf.own ? 'Este proveedor tiene su propio plazo de pago: sólo cambia el capital de trabajo y el costo financiero; el costo del externo no cambia.' : null,
      hoursCapNote(source),
    ],
  });
}

/**
 * Asistente de completitud de un recurso externo (PLAN-2026-010): qué falta
 * cargar para que su costo esté completo. No inventa alícuotas.
 */
export function externalChecklist(line = {}) {
  const ext = line.external && typeof line.external === 'object' ? line.external : {};
  const f = ext.fiscal && typeof ext.fiscal === 'object' ? ext.fiscal : {};
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const tri = (v) => (v === true ? 'incluido' : v === false ? 'aparte' : null);
  return [
    { id: 'price', label: 'Tarifa neta', ok: Number(ext.price) > 0 },
    { id: 'unit', label: 'Unidad ($/h, día, mes, viaje…)', ok: typeof ext.unit === 'string' && ext.unit !== '' },
    { id: 'vat', label: 'IVA que te factura', ok: has(f.vatPct) },
    { id: 'recovery', label: 'Recuperable / no recuperable / parcial', ok: ['yes', 'no', 'partial'].includes(f.vatRecoverable) && (f.vatRecoverable !== 'partial' || has(f.vatRecoverablePct)) },
    { id: 'perceptions', label: 'Percepciones (0 si no hay)', ok: has(f.perceptionsPct) },
    { id: 'operator', label: 'Operador incluido', ok: tri(ext.operatorIncluded) !== null, value: tri(ext.operatorIncluded) },
    { id: 'fuel', label: 'Combustible incluido', ok: tri(ext.fuelIncluded) !== null, value: tri(ext.fuelIncluded) },
    { id: 'insurance', label: 'Seguro incluido', ok: tri(ext.insuranceIncluded) !== null, value: tri(ext.insuranceIncluded) },
    { id: 'mobilization', label: 'Movilización incluida', ok: tri(ext.mobilizationIncluded) !== null, value: tri(ext.mobilizationIncluded) },
  ];
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const library = Array.isArray(resources.equipment) ? resources.equipment : [];
  const services = Array.isArray(resources.externalServices) ? resources.externalServices : [];
  const lines = quote.equipment;
  const activityHours = quote.activity ? quote.activity.hoursPerActiveDay : null;
  const currency = quoteCurrencyOf(quote);
  const hoursDefault = () => (Number.isFinite(Number(activityHours)) && activityHours !== null ? Number(activityHours) : null);

  let selectedId = null;
  const addFromLibrary = () => {
    const [kind, id] = String(selectedId || '').split(':');
    const eq = kind === 'eq' ? library.find((e) => e.id === id) : null;
    const service = kind === 'ext' ? services.find((e) => e.id === id) : null;
    if (!eq && !service) {
      ctx.toast('Elegí un equipo o un servicio externo de tus recursos para agregarlo.', 'warning');
      return;
    }
    const opts = { hoursPerActiveDay: hoursDefault(), now: new Date().toISOString(), currency };
    const line = eq ? equipmentLineFromLibrary(eq, opts) : externalLineFromService(service, opts);
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.quantity` });
    ctx.toast(`Se agregó "${line.name}" con los valores que tiene hoy en Recursos (y su fecha base). Si después cambian, esta cotización no cambia sola.`, 'success');
  };
  const addBlank = (acquisition = 'owned') => {
    const line = blankEquipmentLine({ acquisition, hoursPerActiveDay: null, currency });
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.name` });
  };
  const removeLine = async (index) => {
    const line = quote.equipment[index];
    if (!line) return;
    const ok = await confirmDialog({
      title: 'Quitar equipo',
      message: `¿Quitar "${line.name || 'Equipo'}" de esta cotización? Esto no modifica tus recursos.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    ctx.mutate((q) => {
      const removed = q.equipment.splice(index, 1)[0];
      // Si otro equipo lo usaba para trasladarse, queda "sin definir" (no apunta a nada).
      if (removed && removed.id) {
        q.equipment.forEach((e) => {
          if (e && e.mobilization && e.mobilization.carrierLineId === removed.id) {
            e.mobilization.carrierLineId = null;
          }
        });
        // ECO-04 (H-08): el vehículo de apoyo que tenía ahí su costo de tenerlo vuelve a preguntar.
        ((q.logistics && q.logistics.vehicles) || []).forEach((v) => {
          if (v && v.ownershipCostsIn === removed.id) v.ownershipCostsIn = null;
        });
      }
    });
  };
  /** Cambiar propio ↔ alquilado ↔ tercerizado (conserva lo cargado). */
  const setAcquisition = (index, value) => {
    let reset = false;
    ctx.mutate((q) => {
      const line = q.equipment[index];
      if (!line) return;
      const before = acquisitionOf(line);
      line.acquisition = ['owned', 'rented', 'outsourced'].includes(value) ? value : 'owned';
      // Propio ↔ externo: la base deja de describir el mismo valor (valor del
      // equipo vs tarifa del proveedor, quizás en otra moneda): se reinicia en
      // la moneda de la cotización y sin fecha (nunca se arrastra un USD a la tarifa).
      if ((before === 'owned') !== (line.acquisition === 'owned')) {
        line.base = { period: null, currency, source: null, note: '' };
        reset = true;
      }
      if (line.acquisition !== 'owned') line.external = createExternalTerms(line.external);
      if (!line.mobilization) line.mobilization = createMobilization();
    });
    if (reset) ctx.toast(`La fecha base y la moneda de esta línea se reiniciaron (${currency}, sin fecha): cargá las del nuevo valor en "Fecha base y moneda".`, 'info');
  };

  const pickerOptions = [
    ...library.map((e) => ({ value: `eq:${e.id}`, label: `${e.internalCode ? `${e.internalCode} · ` : ''}${e.name || 'Equipo sin nombre'} (${labelOf(ACQUISITION_MODES, acquisitionOf(e), 'Propio').toLowerCase()})` })),
    ...services.map((e) => ({ value: `ext:${e.id}`, label: `Externo · ${e.name || 'Servicio sin nombre'}${e.external && e.external.supplier ? ` — ${e.external.supplier}` : ''}` })),
  ];

  const toolbar = h(
    'div',
    { class: 'qe-toolbar' },
    // UI-05 (revisión de frontend de la beta): con Recursos vacío se dice dónde cargarlos (la cotización se
    // guarda sola) en vez de ofrecer una lista sin nada; el equipo en blanco pasa a ser la acción principal.
    pickerOptions.length
      ? h(
        'div',
        { class: 'qe-toolbar-pick' },
        selectField({
          label: 'Agregar desde tus recursos (Mis equipos y Externos)',
          value: null,
          includeEmpty: true,
          emptyLabel: 'Elegí un equipo o servicio…',
          options: pickerOptions,
          onChange: (v) => {
            selectedId = v;
          },
        }),
        kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
      )
      : h('p', { class: 'qe-toolbar-empty small' }, 'Todavía no cargaste equipos ni servicios externos en Recursos. ', h('a', { href: '#/recursos/equipos' }, 'Cargar equipos en Recursos'), ' (esta cotización se guarda sola) o agregá uno en blanco.'),
    kit.action('Agregar equipo propio en blanco', () => addBlank('owned'), { icon: 'plus', size: 'md', ...(pickerOptions.length ? {} : { variant: 'primary' }) }),
    kit.action('Agregar alquilado o tercerizado', () => addBlank('rented'), { icon: 'plus', size: 'md' }),
  );

  const fuelNote = h(
    'div',
    { class: 'qe-tip' },
    icon('info'),
    kit.out((r) => {
      if (!r.model.fuel.paidByUs) return `El combustible lo provee el cliente: no se suma al costo de uso (se define en "${stepName('logistics')}").`;
      const fuelIllustrative = Boolean(quote.illustrative || (quote.fuel && quote.fuel.illustrative === true));
      return `Combustible: ${formatValue(r.model.fuel.pricePerLiter, 'rate')} por litro (se edita en "${stepName('logistics')}").${fuelIllustrative ? ' Es un valor ILUSTRATIVO: confirmalo con tu precio actual.' : ''}`;
    }, { tag: 'p' }),
  );

  const operatorOptions = () => (Array.isArray(quote.labor) ? quote.labor : [])
    .filter((l) => l && typeof l.id === 'string')
    .map((l) => ({ value: l.id, label: l.role || 'Puesto sin nombre' }));
  const acquisitionField = (i) => {
    const current = acquisitionOf(quote.equipment[i]);
    return selectField({
      label: '¿Cómo lo obtenés?',
      name: `equipment.${i}.acquisition`,
      value: current,
      options: ACQUISITION_MODES.map((m) => ({ value: m.id, label: m.label })),
      hint: (ACQUISITION_MODES.find((m) => m.id === current) || ACQUISITION_MODES[0]).hint,
      disabled: ctx.readOnly,
      onChange: (v) => setAcquisition(i, v),
    });
  };
  const operatorField = (i) => {
    const line = quote.equipment[i] || {};
    const included = isExternalLine(line) && line.external && line.external.operatorIncluded === true;
    const options = operatorOptions();
    return kit.select(`equipment.${i}.operatorLaborId`, {
      label: 'Operador (de Personal)',
      includeEmpty: true,
      emptyLabel: options.length ? 'Sin operador asignado' : `Todavía no cargaste puestos en "${stepName('labor')}"`,
      options,
      structural: true,
      hint: included
        ? 'La tarifa ya incluye operador: no le asignes uno de Personal (se contaría dos veces).'
        : 'El puesto de Personal que lo opera. No suma costo acá: si además maneja en el traslado, no se agrega otra persona.',
    });
  };
  /** Avisos de la línea: operador duplicado y moneda sin tipo de cambio. */
  const lineWarnings = (i) => {
    const line = quote.equipment[i] || {};
    const out = [];
    if (isExternalLine(line) && line.external && line.external.operatorIncluded === true && typeof line.operatorLaborId === 'string' && operatorOptions().some((o) => o.value === line.operatorLaborId)) {
      out.push('La tarifa del proveedor incluye operador y además le asignaste uno de Personal: revisá que no estés pagando dos veces la misma persona.');
    }
    const cur = line.base && line.base.currency;
    if (cur && conversionFactor(cur, quote) === null) {
      out.push(`Este valor está en ${cur} y la cotización no tiene ese tipo de cambio: no se suma al costo hasta que lo cargues en "${stepName('service')}".`);
    }
    return out.length ? h('div', { class: 'qe-line-warnings' }, ...out.map((t) => h('p', { class: 'qe-warn' }, icon('alert', { size: 14 }), h('span', {}, t)))) : null;
  };
  /** Aviso informativo (PLAN-2026-010): equipo propio con valor y sin costo de capital. No obliga a cargarlo. */
  const capitalCostNote = (i) => kit.out(() => {
    const e = quote.equipment[i] || {};
    const noCapital = Number(e.replacementValue) > 0 && !(Number(e.capitalRatePctAnnual) > 0);
    return noCapital
      ? h('p', { class: 'qe-note' }, icon('info', { size: 14 }), ' Sin costo de capital: RATEOS no está imputando rendimiento ni costo del dinero invertido en este equipo. Es opcional; no lo confundas con la financiación del contrato.')
      : '';
  }, { tag: 'div', allowEmpty: true });
  const mobilityNote = (i) => {
    const line = quote.equipment[i] || {};
    const mode = line.mobilization && line.mobilization.mode;
    const included = isExternalLine(line) && line.external && line.external.mobilizationIncluded === true;
    const text = included
      ? 'la movilización está incluida en la tarifa del proveedor'
      : mode ? labelOf(MOBILIZATION_MODES, mode, '').toLowerCase() : 'sin definir';
    return h('p', { class: 'small line-mobility-note' }, `Cómo llega al lugar del servicio: ${text}. Se define en "${stepName('logistics')}".`);
  };
  const baseAdvanced = (i, line) => {
    const p = `equipment.${i}`;
    const owned = !isExternalLine(line);
    return kit.advanced(
      {
        key: `equipment-base:${line.id || i}`,
        title: 'Fecha base y moneda',
        summary: () => {
          const e = quote.equipment[i] || {};
          return owned
            ? `${baseText(e.base, { prefix: 'Valor' })} · ${baseText(e.costsBase, { prefix: 'Costos' })}`
            : baseText(e.base, { prefix: 'Tarifa' });
        },
      },
      h('p', { class: 'small' }, 'De qué mes son estos valores. Cambiarlos acá sólo afecta esta cotización (Recursos no cambia).'),
      baseFields(ctx, `${p}.base`, { currency: true, periodLabel: owned ? 'Mes del valor del equipo' : 'Mes de la tarifa' }),
      owned ? baseFields(ctx, `${p}.costsBase`, { periodLabel: 'Mes de los costos de tenerlo y usarlo' }) : null,
    );
  };

  /** Línea con el valor de reposición en la moneda de la cotización (para los avisos). */
  const comparableLine = (r, i) => {
    const line = quote.equipment[i];
    if (!line) return null;
    const f = r && r.model && r.model.equipment[i] ? r.model.equipment[i].conversion : 1;
    const comparable = f !== undefined && f !== null && f > 0;
    const eq = comparable && f !== 1 ? { ...line, replacementValue: Number(line.replacementValue || 0) * f, residualValue: Number(line.residualValue || 0) * f } : line;
    return { eq, comparable };
  };
  /** "Así lo calcula RATEOS" de un grupo (dentro de las opciones). */
  const wearRegion = (r, i, group) => {
    const c = comparableLine(r, i);
    return c ? wearNote(c.eq, group, { comparable: c.comparable, warnings: false }) : null;
  };
  /** Avisos de sentido común, siempre a la vista (fuera de las opciones avanzadas). */
  const wearWarningsRegion = (r, i) => {
    const c = comparableLine(r, i);
    return c ? wearWarnings(c.eq, { comparable: c.comparable }) : null;
  };

  /** Mantenimiento y neumáticos: cómo se cargan + "Así lo calcula RATEOS" (PLAN-2026-007). */
  const wearGroups = (i, illustrative) => {
    const p = `equipment.${i}`;
    const line = quote.equipment[i] || {};
    const mMode = line.maintenanceMode || 'per_hour';
    const tMode = line.tiresMode || 'per_hour';
    return [
      kit.group(
        'Mantenimiento',
        formGrid(
          3,
          kit.select(`${p}.maintenanceMode`, { label: '¿Cómo lo cargás?', options: MAINTENANCE_MODES.map((m) => ({ value: m.id, label: m.label })), structural: true }),
          ...(mMode === 'service'
            ? [
                kit.num(`${p}.maintenanceServiceCost`, { label: 'Costo de cada service', rule: 'money', unit: '$', illustrative }),
                kit.num(`${p}.maintenanceServiceHours`, { label: 'Cada cuántas horas de uso', rule: 'intervalHours', unit: 'h' }),
              ]
            : mMode === 'budget'
              ? [
                  kit.num(`${p}.maintenanceBudget`, { label: 'Presupuesto de mantenimiento', rule: 'money', unit: '$', illustrative }),
                  kit.select(`${p}.maintenanceBudgetPeriod`, { label: 'Por', options: BUDGET_PERIODS.map((b) => ({ value: b.id, label: b.label })) }),
                ]
              : [kit.num(`${p}.maintenancePerHour`, { label: 'Costo por hora de uso', rule: 'money', unit: '$/h', illustrative })]),
        ),
        kit.region((r) => wearRegion(r, i, 'maintenance')),
      ),
      kit.group(
        'Neumáticos',
        formGrid(
          3,
          kit.select(`${p}.tiresMode`, { label: '¿Cómo lo cargás?', options: TIRE_MODES.map((t) => ({ value: t.id, label: t.label })), structural: true }),
          ...(tMode === 'per_hour'
            ? [kit.num(`${p}.tiresPerHour`, { label: 'Costo por hora de uso', rule: 'money', unit: '$/h', illustrative })]
            : [
                kit.num(`${p}.tiresSetCost`, { label: 'Costo del juego de neumáticos', rule: 'money', unit: '$', illustrative }),
                tMode === 'set_km'
                  ? kit.num(`${p}.tiresLifeKm`, { label: 'Vida útil del juego', rule: 'lifeKm', unit: 'km' })
                  : kit.num(`${p}.tiresLifeHours`, { label: 'Vida útil del juego', rule: 'intervalHours', unit: 'h' }),
              ]),
        ),
        kit.region((r) => wearRegion(r, i, 'tires')),
      ),
    ];
  };

  const transportUnit = ['trip', 'km', 'tonkm'].includes(billingUnitOf(quote).id);
  const fuelTwiceRisk = (line) => transportUnit && line.mobilization && line.mobilization.mode === 'self' && Number(line.mobilization.travelLitersPer100Km) > 0;
  const ownedCard = (line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    // Valores copiados de una plantilla o equipo de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este equipo' });
    const illustrative = ill.marked;
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Equipo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} ${plural(l.quantity, 'unidad', 'unidades')} · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h de uso por día activo` : '';
        }),
        badges: [badge('Propio', 'gray'), ill.tag].filter(Boolean),
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      lineOriginBlock(ctx, 'equipment', i, [{ prefix: 'Valor', base: line.base }, { prefix: 'Costos', base: line.costsBase }]),
      resourceSyncNotice(ctx, 'equipment', i, { name: line.name || 'Equipo' }),
      ill.control,
      lineWarnings(i),
      formGrid(
        3,
        acquisitionField(i),
        operatorField(i),
      ),
      formGrid(
        3,
        kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
        kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
        kit.num(`${p}.hoursPerActiveDay`, {
          label: 'Horas de uso por día activo',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
          hint: 'Vacío = usa las horas por día de la cotización.',
        }),
        kit.num(`${p}.replacementValue`, { label: 'Valor de reposición', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, hint: 'Lo que costaría comprarlo hoy.' }),
        kit.num(`${p}.usefulLifeYears`, { label: 'Vida útil', rule: 'years', unit: 'años', illustrative }),
        // PLAN-2026-014 (LAB-D5): "No usa combustible" es un dato explícito; un consumo 0 sin marcar sigue faltando.
        line.fuelNotApplicable === true ? null : kit.num(`${p}.fuelLitersPerHour`, { label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', illustrative }),
        kit.check(`${p}.fuelNotApplicable`, {
          label: 'No usa combustible',
          structural: true,
          hint: line.fuelNotApplicable === true
            ? 'No se pide consumo ni se suma combustible de este equipo (tampoco al trasladarse).'
            : 'Eléctrico, manual o estacionario: marcalo en vez de dejar el consumo en 0.',
        }),
        // SIM-02 (S3): cobra por viaje/km y se traslada con consumo en ruta → el L/h puede ser el de andar (dos veces).
        line.fuelNotApplicable !== true && fuelTwiceRisk(line)
          ? kit.check(`${p}.fuelWhileStopped`, {
            label: 'El consumo por hora es detenido (bomba, hidrogrúa)',
            hint: 'Se traslada por sus propios medios con consumo en ruta (L/100 km). Si el L/h es de andar, el combustible va dos veces: dejalo en 0. Marcalo sólo si consume trabajando detenido.',
          })
          : null,
      ),
      kit.region((r) => wearWarningsRegion(r, i)),
      // PLAN-2026-012: reservado / compartido (% explícito de sus costos fijos).
      assignmentBlock(kit, { path: p, line, kind: 'equipment', at }),
      kit.keyline({
        label: 'Costo del equipo en el mes',
        value: (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY),
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          const share = l.shared && !l.shareMissing ? ` (${formatPercent(l.fixedCostSharePct)} asignado a esta cotización de ${formatMoney(l.fullFixedMonthly)})` : '';
          return `Tenerlo: ${formatMoney(l.fixedMonthly)} por mes${share} (aunque no trabaje) · usarlo: ${formatMoney(l.variablePerActiveDay)} por día activo · con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`;
        },
        trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
      }),
      mobilityNote(i),
      kit.advanced(
        {
          key: `equipment:${line.id || i}`,
          summary: () => {
            const e = quote.equipment[i] || {};
            const parts = [
              `residual ${moneyText(e.residualValue) || '$ 0'}`,
              `seguro ${moneyText(e.insuranceAnnual) || '$ 0'}/año`,
              `patente ${moneyText(e.licenseAnnual) || '$ 0'}/año`,
              hasNumber(e.otherAnnual) && Number(e.otherAnnual) > 0 ? `otros ${moneyText(e.otherAnnual)}/año` : null,
              `certificaciones ${moneyText(e.certificationsAnnual) || '$ 0'}/año`,
              wearSummary(e).maintenance,
              wearSummary(e).tires,
              hasNumber(e.capitalRatePctAnnual) && Number(e.capitalRatePctAnnual) > 0 ? `costo de capital ${formatPercent(Number(e.capitalRatePctAnnual))} anual` : 'sin costo de capital',
            ];
            const text = parts.filter(Boolean).join(' · ');
            return illustrative ? h('span', {}, `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, illustrativeTag()) : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
          },
        },
        kit.group(
          'Costo de tenerlo (existe aunque no trabaje)',
          formGrid(
            3,
            kit.num(`${p}.residualValue`, { label: 'Valor residual', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, hint: 'Lo que vale al final de su vida útil (en la misma moneda que el valor de reposición).' }),
            kit.num(`${p}.insuranceAnnual`, { label: 'Seguro anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.licenseAnnual`, { label: 'Patente anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.otherAnnual`, { label: 'Otros costos anuales de tenerlo', rule: 'money', unit: '$/año', hint: 'Habilitaciones, GPS, cocheras… lo que pagás aunque no trabaje.' }),
            kit.num(`${p}.certificationsAnnual`, { label: 'Certificaciones anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.capitalRatePctAnnual`, { label: 'Costo de capital (opcional)', rule: 'percent', unit: '% anual', hint: 'Rendimiento que le pedís a la plata invertida en el equipo. No es la financiación del contrato (eso va en "Financiación").' }),
          ),
          capitalCostNote(i),
        ),
        ...wearGroups(i, illustrative),
      ),
      kit.advanced(
        {
          key: `equipment-detail:${line.id || i}`,
          title: 'Ver detalle del costo',
          variant: 'detail',
          summary: (r) => {
            const l = at(r);
            return l ? `Amortización, seguros y capital por mes; mantenimiento, neumáticos y combustible por hora; costo por hora y por día usado.` : '';
          },
        },
        h(
          'div',
          { class: 'qe-split' },
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Tenerlo: por mes (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const o = l.ownership;
              return kit.breakdown(
                [
                  ['Amortización', formatMoney(o.depreciationMonthly)],
                  ['Seguro', formatMoney(o.insuranceMonthly)],
                  ['Patente', formatMoney(o.licenseMonthly)],
                  ['Certificaciones', formatMoney(o.certificationsMonthly)],
                  ['Otros', formatMoney(o.otherMonthly)],
                  o.maintenanceFixedMonthly > 0 ? ['Mantenimiento (presupuesto)', formatMoney(o.maintenanceFixedMonthly)] : null,
                  ['Costo de capital', formatMoney(o.capitalCostMonthly)],
                ].filter(Boolean),
                { totalLabel: 'Tenerlo por mes', total: formatMoney(o.totalMonthly) },
              );
            }),
          ),
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Usarlo: por hora (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const op = l.operation;
              return kit.breakdown(
                [
                  [op.maintenanceMode === 'service' ? 'Mantenimiento (service)' : 'Mantenimiento', formatMoney(op.maintenancePerHour)],
                  [op.tiresMode === 'set_km' ? 'Neumáticos (van por km, en la ruta)' : op.tiresMode === 'set_hours' ? 'Neumáticos (juego)' : 'Neumáticos', formatMoney(op.tiresPerHour)],
                  [op.fuelNotApplicable ? 'Combustible (no usa)' : `Combustible (${formatNumber(op.fuelLitersPerHour, { decimals: 2 })} L/h)`, formatMoney(op.fuelPerHour)],
                ],
                { totalLabel: 'Usarlo por hora', total: formatMoney(op.totalPerHour) },
              );
            }),
          ),
        ),
        h('h5', { class: 'qe-group-title' }, 'En esta cotización (todas las unidades)'),
        kit.stats(
          kit.stat('Tenerlo por mes (fijo)', (r) => formatMoney(at(r) && at(r).fixedMonthly)),
          kit.stat('Usarlo por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: (r) => (at(r) ? `${formatNumber(at(r).fuelLitersPerActiveDay, { decimals: 1 })} L de combustible por día` : '') }),
          kit.stat('Costo mensual con la actividad estimada', (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY), {
            emphasis: true,
            hint: (r) => `Con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`,
            trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
          }),
        ),
        h('h5', { class: 'qe-group-title' }, 'Ficha con los días de esta cotización (por unidad)'),
        kit.stats(
          kit.stat('$ por hora usada', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedHour) : EMPTY;
          }),
          kit.stat('$ por día usado', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedDay) : EMPTY;
          }),
          kit.stat('$ por mes', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerMonth) : EMPTY;
          }, {
            hint: (r) => {
              const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
              return c ? `Utilización ${formatNumber(c.capacity.utilizationPct, { decimals: 2 })} % · ${formatNumber(c.capacity.usedHoursPerMonth, { decimals: 1 })} h usadas de ${formatNumber(c.capacity.availableHoursPerMonth, { decimals: 1 })} disponibles` : '';
            },
          }),
        ),
      ),
      baseAdvanced(i, line),
    );
  };

  const triField = (path, label, hint = null) => triStateField({
    label,
    hint,
    name: path,
    value: kit.get(path),
    yesLabel: 'Sí, incluido',
    noLabel: 'No, lo pago aparte',
    disabled: ctx.readOnly,
    onChange: (v) => {
      ctx.update(path, v);
      ctx.rerender();
    },
  });

  /**
   * Unidad de la tarifa externa (ECO-01): "Por tramo" y "Por viaje completo (ida y vuelta)" son
   * la unidad "trip" con o sin `tripBasis`. Cambiar la unidad descarta una confirmación anterior.
   */
  const setExternalUnit = (index, value) => ctx.mutate((q) => {
    const line = q.equipment[index];
    if (!line) return;
    if (!line.external || typeof line.external !== 'object') line.external = createExternalTerms({});
    if (value === ROUND_TRIP) {
      line.external.unit = 'trip';
      line.external.tripBasis = 'round_trip';
    } else {
      line.external.unit = value;
      delete line.external.tripBasis;
    }
    delete line.externalUnitConfirmed;
  });
  const unitField = (index, value) => selectField({
    label: 'Unidad de la tarifa',
    name: `equipment.${index}.external.unit`,
    value,
    options: unitsFor(T).map((u) => ({ value: u.id, label: u.label })),
    hint: unitHints(T)[value],
    disabled: ctx.readOnly,
    onChange: (v) => setExternalUnit(index, v || 'day'),
  });
  /** Pendiente "Unidad del proveedor" de esta línea (completitud), o null. */
  const unitPendingOf = (r, index) => ((r && r.completeness && r.completeness.pending) || [])
    .find((x) => x.id === 'external_unit_trips' && (x.targets || []).some((t) => t.index === index)) || null;
  /**
   * "Por salida" con varios viajes por salida (ECO-01, H-01): crítico hasta elegir la unidad o
   * confirmarla. "Sí, cobra por salida" guarda el supuesto actual (tarifa, viajes por salida y
   * ruta, `externalUnitAssumption`): si después cambia, el motor vuelve a pedirlo.
   */
  const unitConfirmBanner = (index) => {
    const pendingBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-warning qe-unit-confirm', role: 'status' },
      kit.out((r) => {
        const item = unitPendingOf(r, index);
        return item ? h('div', {}, h('strong', {}, `¿Cobra ${T.per} o por viaje? `), item.message) : '';
      }, { tag: 'div', allowEmpty: true }),
      ctx.readOnly
        ? null
        : h('div', { class: 'qe-toolbar' },
          kit.action('Por viaje completo (ida y vuelta)', () => setExternalUnit(index, ROUND_TRIP), { variant: 'primary' }),
          kit.action(`Sí, cobra ${T.per}`, () => ctx.mutate((q) => { q.equipment[index].externalUnitConfirmed = externalUnitAssumption(q, q.equipment[index]); }), { icon: 'check' })),
    ), (r) => Boolean(unitPendingOf(r, index)));
    const line = quote.equipment[index] || {};
    const c = line.externalUnitConfirmed;
    if (!c || typeof c !== 'object') return pendingBanner;
    // Confirmación vigente: se muestra lo que se confirmó (desaparece si el motor la da por vencida).
    const confirmedBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-info qe-unit-confirm is-confirmed', role: 'status' },
      h('div', {}, h('strong', {}, `Confirmado: el proveedor cobra ${T.per}. `),
        `${formatMoney(Number(c.price) || 0)} ${T.per} con ${formatNumber(Number(c.tripsPerActivation) || 0, { decimals: 2 })} viajes ${T.per}: se paga una vez en ${T.each}. Si cambian la tarifa, los viajes ${T.per} o la ruta, se vuelve a pedir.`),
      ctx.readOnly ? null : h('div', { class: 'qe-toolbar' }, kit.action('Revisar la unidad', () => ctx.mutate((q) => { delete q.equipment[index].externalUnitConfirmed; }, { focus: `equipment.${index}.external.unit` }), { icon: 'edit' })),
    ), (r) => !unitPendingOf(r, index));
    return h('div', { class: 'qe-unit-confirm-wrap' }, pendingBanner, confirmedBanner);
  };

  /** Pendiente "Cantidad del proveedor" de esta línea (P1 CIERRE, H-09), o null. */
  const quantityPendingOf = (r, index) => ((r && r.completeness && r.completeness.pending) || [])
    .find((x) => x.id === 'external_quantity' && (x.targets || []).some((t) => t.index === index)) || null;
  /**
   * Externo por km o por tramo con cantidad mayor que 1 (P1 CIERRE, AUD-T1 H-09): cada unidad cuenta
   * todo el recorrido. "Poner cantidad 1" si se reparten los viajes; "Cada unidad hace todo el
   * recorrido" guarda el supuesto (`externalQuantityAssumption`): si cambian la cantidad o la unidad, se
   * vuelve a pedir. La fórmula no cambia.
   */
  const quantityConfirmBanner = (index) => {
    const pendingBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-warning qe-quantity-confirm', role: 'status' },
      kit.out((r) => {
        const item = quantityPendingOf(r, index);
        return item ? h('div', {}, h('strong', {}, '¿Cada unidad hace todo el recorrido? '), item.message) : '';
      }, { tag: 'div', allowEmpty: true }),
      ctx.readOnly
        ? null
        : h('div', { class: 'qe-toolbar' },
          kit.action('Poner cantidad 1', () => ctx.mutate((q) => { q.equipment[index].quantity = 1; delete q.equipment[index].externalQuantityConfirmed; }, { focus: `equipment.${index}.quantity` }), { variant: 'primary' }),
          kit.action('Cada unidad hace todo el recorrido', () => ctx.mutate((q) => { q.equipment[index].externalQuantityConfirmed = externalQuantityAssumption(q, q.equipment[index]); }), { icon: 'check' })),
    ), (r) => Boolean(quantityPendingOf(r, index)));
    const line = quote.equipment[index] || {};
    const c = line.externalQuantityConfirmed;
    if (!c || typeof c !== 'object') return pendingBanner;
    // Confirmación vigente: se muestra lo que se confirmó (desaparece si el motor la da por vencida).
    const confirmedBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-info qe-quantity-confirm is-confirmed', role: 'status' },
      h('div', {}, h('strong', {}, 'Confirmado: cada unidad hace todo el recorrido. '),
        `Con cantidad ${formatNumber(Number(c.quantity) || 0, { decimals: 2 })}, la tarifa se paga por el recorrido completo de cada unidad. Si cambian la cantidad o la unidad de la tarifa, se vuelve a pedir.`),
      ctx.readOnly ? null : h('div', { class: 'qe-toolbar' }, kit.action('Revisar la cantidad', () => ctx.mutate((q) => { delete q.equipment[index].externalQuantityConfirmed; }, { focus: `equipment.${index}.quantity` }), { icon: 'edit' })),
    // Además tiene que coincidir con la cantidad y la unidad de ahora, aunque la regla no se aplique (p. ej., tarifa en 0).
    ), (r) => !quantityPendingOf(r, index) && (Number((quote.equipment[index] || {}).quantity) || 0) > 1 && externalQuantityHolds(quote, quote.equipment[index]));
    return h('div', { class: 'qe-quantity-confirm-wrap' }, pendingBanner, confirmedBanner);
  };

  /** ¿Esta línea pregunta "¿lo opera alguien de tu Personal?" (ECO-04, VAL-01-F2)? Cada línea, no sólo la primera. */
  const operatorScopeOf = (r, index) => ((r && r.completeness && r.completeness.operatorScope) || []).some((x) => x.index === index);
  /** Pregunta de la línea con los puestos candidatos de ahora. */
  const operatorScopeText = (index) => {
    const line = quote.equipment[index] || {};
    const names = operatorSupplierSnapshot(quote).labor.map((x) => `"${x.role}"`);
    const who = names.length === 1 ? `${names[0]} no opera ningún equipo` : `${names.slice(0, 3).join(', ')} no operan ningún equipo`;
    return `La tarifa de "${line.name || 'Externo'}" ya incluye operador y ${who}: si es el mismo, se paga dos veces. Si es el mismo, sacalo de Personal (o dejalo en 0 posiciones); si la tarifa no lo incluye, marcá el operador como "No, lo pago aparte". Si es otra persona, confirmalo acá.`;
  };
  /**
   * Externo que trae operador y un puesto de Personal que suena a operador o chofer sin equipo (ECO-04,
   * VAL-01-F2): asignarlo o confirmar "Ningún puesto de Personal lo opera", que guarda esos puestos
   * (`operatorSupplierSnapshot`). Si aparece otro o se renombra, el motor vuelve a preguntar.
   */
  const operatorScopeBanner = (index) => {
    const pendingBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-warning qe-operator-scope', role: 'status' },
      kit.out((r) => (operatorScopeOf(r, index) ? h('div', {}, h('strong', {}, '¿Lo opera alguien de tu Personal? '), operatorScopeText(index)) : ''), { tag: 'div', allowEmpty: true }),
      ctx.readOnly
        ? null
        : h('div', { class: 'qe-toolbar' },
          kit.action('Ningún puesto de Personal lo opera', () => ctx.mutate((q) => { q.equipment[index].operatorBySupplier = operatorSupplierSnapshot(q); }), { icon: 'check' })),
    ), (r) => operatorScopeOf(r, index));
    const line = quote.equipment[index] || {};
    // "Asignado" como lo cuenta el motor: un puesto que existe (un id viejo no cuenta).
    const assigned = typeof line.operatorLaborId === 'string' && (quote.labor || []).some((l) => l && l.id === line.operatorLaborId);
    const confirmed = line.operatorBySupplier && typeof line.operatorBySupplier === 'object' && line.external && line.external.operatorIncluded === true && !assigned;
    if (!confirmed) return pendingBanner;
    // Confirmación vigente: se muestra (desaparece si el motor la da por vencida).
    const confirmedBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-info qe-operator-scope is-confirmed', role: 'status' },
      h('div', {}, h('strong', {}, 'Confirmado: el operador lo pone el proveedor. '), 'Ningún puesto de Personal opera este equipo. Si agregás o renombrás un puesto de chofer u operador, se vuelve a preguntar.'),
      ctx.readOnly ? null : h('div', { class: 'qe-toolbar' }, kit.action('Revisar', () => ctx.mutate((q) => { delete q.equipment[index].operatorBySupplier; }, { focus: `equipment.${index}.operatorLaborId` }), { icon: 'edit' })),
    ), (r) => !operatorScopeOf(r, index));
    return h('div', { class: 'qe-operator-scope-wrap' }, pendingBanner, confirmedBanner);
  };

  const externalCard = (line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    const ill = kit.lineIllustrative(p, { what: 'este recurso externo' });
    const illustrative = ill.marked;
    const acq = acquisitionOf(line);
    const ext = line.external || {};
    const sym = currencyUnit(line.base, quote);
    const unit = ext.unit || 'day';
    const unitKey = unitKeyOf(ext);
    const fiscal = ext.fiscal || {};
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Recurso externo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          const e = (quote.equipment[i] && quote.equipment[i].external) || {};
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} ${plural(l.quantity, 'unidad', 'unidades')}${e.supplier ? ` · ${e.supplier}` : ''}` : '';
        }),
        badges: [badge(labelOf(ACQUISITION_MODES, acq, 'Externo'), 'blue'), ill.tag].filter(Boolean),
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      lineOriginBlock(ctx, 'equipment', i, [{ prefix: 'Tarifa', base: line.base }]),
      resourceSyncNotice(ctx, 'equipment', i, { name: line.name || 'Recurso externo' }),
      ill.control,
      lineWarnings(i),
      // Línea incompleta (PLAN-2026-010): se muestra cuál es, con [Completar] y [Quitar]. No se oculta ni se inventa un costo.
      !(Number(ext.price) > 0)
        ? h(
          'div',
          { class: 'banner banner-warning qe-incomplete', role: 'status' },
          h('div', {}, h('strong', {}, `"${line.name || 'Recurso externo'}" no tiene tarifa del proveedor. `), 'Hoy no suma costo: completá la tarifa o quitá la línea si no va.'),
          h('div', { class: 'qe-toolbar' },
            kit.action('Completar', () => ctx.focusField(`${p}.external.price`), { variant: 'primary', icon: 'check' }),
            kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })),
        )
        : null,
      // Tarifa por km o por viaje sin ruta (PLAN-2026-012): nunca un $ 0 como si valiera.
      unit === 'km' || unit === 'trip'
        ? kit.toggle(h(
          'div',
          { class: 'banner banner-warning qe-incomplete qe-route-missing', role: 'status' },
          h('div', {}, h('strong', {}, 'Falta definir la ruta/distancia para calcular este proveedor. '), `Su tarifa es ${unit === 'km' ? 'por km' : 'por viaje'} y la cotización no tiene km ni viajes: hasta definirla no suma costo.`),
          h('div', { class: 'qe-toolbar' }, kit.out((r) => h('a', { class: 'btn btn-primary btn-sm', href: fieldHref(ctx.quoteId, routeFieldOf(r)) }, 'Definir la ruta'))),
        ), (r) => Boolean(providerOf(r, i) && providerOf(r, i).noRoute))
        : null,
      // Distancia / actividad del proveedor y su tarifa ligada a la ruta (PLAN-2026-012).
      unit === 'km' || unit === 'trip'
        ? kit.out((r) => {
          const pa = providerOf(r, i);
          const t = transportOf(r);
          if (!pa || pa.noRoute) return '';
          return h('div', { class: 'qe-provider-line' },
            h('p', { class: 'small' }, h('strong', {}, 'Distancia / actividad del proveedor: '), providerActivityText(pa, t)),
            providerRouteText(pa, t) ? h('p', { class: 'small muted' }, providerRouteText(pa, t)) : null);
        }, { tag: 'div', allowEmpty: true })
        : null,
      // "Por salida" con varios viajes por salida (ECO-01, H-01): elegir la unidad o confirmarla.
      unit === 'activation' ? unitConfirmBanner(i) : null,
      // Por km o por tramo con cantidad mayor que 1 (P1 CIERRE, H-09): ¿cada unidad hace todo el recorrido?
      unit === 'km' || unit === 'trip' ? quantityConfirmBanner(i) : null,
      // Asistente de completitud del externo.
      kit.out(() => {
        const items = externalChecklist(quote.equipment[i] || {});
        const pending = items.filter((x) => !x.ok);
        return h(
          'div',
          { class: ['qe-ext-checklist', pending.length ? 'has-pending' : 'is-complete'] },
          h('p', { class: 'small' }, pending.length ? `Para que el costo del proveedor quede completo ${pending.length === 1 ? 'falta 1 dato' : `faltan ${pending.length} datos`}:` : 'Datos del proveedor completos.'),
          h('ul', { class: 'qe-chips' }, ...items.map((x) => h('li', { class: ['qe-chip', x.ok ? 'is-ok' : 'is-pending'] }, `${x.ok ? '✓' : '•'} ${x.label}${x.value ? `: ${x.value}` : ''}`))),
        );
      }, { tag: 'div' }),
      formGrid(3, acquisitionField(i), operatorField(i)),
      // ECO-04 (VAL-01-F2): la tarifa trae operador y en Personal hay un chofer u operador sin equipo.
      ext.operatorIncluded === true ? operatorScopeBanner(i) : null,
      formGrid(
        3,
        kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
        kit.text(`${p}.external.supplier`, { label: 'Proveedor', maxLength: 120 }),
        kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
        kit.num(`${p}.external.price`, { label: 'Tarifa neta (sin IVA)', rule: 'money', unit: `${sym}${unitShort(unitKey, T)}`, illustrative, hint: 'El precio del proveedor SIN IVA: el IVA se trata aparte.' }),
        unitField(i, unitKey),
        kit.num(`${p}.external.minimumUnits`, { label: 'Mínimo facturable', rule: 'quantity', unit: unitShort(unitKey, T).replace('/', '').trim() || 'u.', hint: `Unidades mínimas ${T.per}. Vacío = sin mínimo.` }),
        unit === 'hour'
          ? kit.num(`${p}.hoursPerActiveDay`, {
            label: 'Horas de uso por día activo',
            rule: 'hoursPerDay',
            unit: 'h/día',
            placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
            hint: 'Vacío = usa las horas por día de la cotización.',
          })
          : null,
        dateField({ label: 'Oferta del proveedor válida hasta', name: `${p}.external.validUntil`, value: kit.get(`${p}.external.validUntil`), disabled: ctx.readOnly, onChange: (v) => ctx.update(`${p}.external.validUntil`, v) }),
      ),
      kit.group(
        '¿Qué incluye la tarifa?',
        formGrid(
          2,
          triField(`${p}.external.operatorIncluded`, 'Operador'),
          triField(`${p}.external.fuelIncluded`, 'Combustible'),
          // Combustible a tu cargo (PLAN-2026-012): por hora o por km FÍSICO de la ruta, nunca las dos.
          ext.fuelIncluded === false
            ? kit.select(`${p}.external.fuelMode`, {
              label: '¿Cómo cargás el consumo?',
              options: EXTERNAL_FUEL_MODES.map((m) => ({ value: m.id, label: m.label })),
              structural: true,
              hint: 'Un camión por km o por viaje: por km de ruta. Un equipo que trabaja por horas: por hora.',
            })
            : null,
          ext.fuelIncluded === false && ext.fuelMode === 'per_100km'
            ? kit.num(`${p}.external.fuelLitersPer100Km`, { label: 'Consumo que pagás vos', rule: 'quantity', unit: 'L/100 km', hint: 'Sobre los km físicos de la ruta (viajes × km por viaje). Se suma como combustible, aparte de la tarifa.' })
            : ext.fuelIncluded === false && ext.fuelMode === 'km_per_liter'
              ? kit.num(`${p}.external.fuelKmPerLiter`, { label: 'Rendimiento', rule: 'quantity', unit: 'km/L', hint: 'Km por litro sobre los km físicos de la ruta. Se suma como combustible, aparte de la tarifa.' })
              : ext.fuelIncluded === false
                ? kit.num(`${p}.external.fuelLitersPerHour`, { label: 'Consumo que pagás vos', rule: 'quantity', unit: 'L/h', hint: 'Se suma como combustible con el precio de la cotización.' })
                : null,
          ext.fuelIncluded === false ? kit.out((r) => (at(r) ? externalFuelText(r, at(r)) : ''), { tag: 'p', className: 'small qe-fuel-calc', allowEmpty: true }) : null,
          // Como en los propios (SIM-02 S3): un consumo por hora que pagás vos puede ser el de andar.
          ext.fuelIncluded === false && !['per_100km', 'km_per_liter'].includes(ext.fuelMode) && fuelTwiceRisk(line)
            ? kit.check(`${p}.fuelWhileStopped`, { label: 'El consumo por hora es detenido (bomba, hidrogrúa)', hint: 'Se traslada por sus propios medios con consumo en ruta. Si el L/h es de andar, el combustible va dos veces: dejalo en 0.' })
            : null,
          triField(`${p}.external.mobilizationIncluded`, 'Movilización (llevarlo y traerlo)'),
          ext.mobilizationIncluded === false ? kit.num(`${p}.external.mobilizationAmount`, { label: `Movilización del proveedor ${T.per} (neta)`, rule: 'money', unit: sym, hint: `Lo que te cobra por llevarlo y traerlo en ${T.each}.` }) : null,
          triField(`${p}.external.insuranceIncluded`, 'Seguro'),
        ),
      ),
      supplierTermGroup(i, line),
      kit.keyline({
        label: `Costo del ${acq === 'rented' ? 'alquiler' : 'servicio'} en el mes`,
        value: (r) => (providerOf(r, i) && providerOf(r, i).noRoute ? 'Falta la ruta' : at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY),
        tone: (r) => (providerOf(r, i) && providerOf(r, i).noRoute ? 'red' : null),
        hint: (r) => {
          const x = at(r) && at(r).external;
          if (!x) return '';
          if (providerOf(r, i) && providerOf(r, i).noRoute) return 'Falta definir la ruta/distancia para calcular este proveedor: hasta entonces no suma costo.';
          const fixed = x.fixedMonthly > 0 ? `Fijo: ${formatMoney(x.fixedMonthly)} por mes (trabaje o no). ` : '';
          const billed = x.netPerActivation > 0 ? `Facturado ${T.per}: ${formatNumber(x.billedUnitsPerActivation, { decimals: 2 })} × ${formatMoney(x.price)} × ${formatNumber(x.quantity, { decimals: 2 })} = ${formatMoney(x.netPerActivation)} neto. ` : '';
          // Combustible a tu cargo (no incluido en la tarifa): suma acá, pero va a Combustible.
          const fuel = x.fuelPerActiveDay > 0 ? `Incluye combustible a tu cargo: ${formatMoney(x.fuelPerActiveDay * r.activity.activeDaysPerMonth)} por mes (en la estructura de costos va a Combustible). ` : '';
          return `${fixed}${billed}${fuel}Salida de caja con impuestos: ${formatMoney(x.cashPerActiveDay)} por día activo; el crédito fiscal (${formatMoney(x.creditPerActiveDay)}) no es costo.`;
        },
        trace: (r) => {
          let impact = null;
          try {
            impact = lineIncrementalImpact(quote, { list: 'equipment', index: i }, { settings: ctx.settings });
          } catch {
            impact = null;
          }
          return externalTrace(r, i, quote.equipment[i], impact);
        },
      }),
      mobilityNote(i),
      kit.advanced(
        {
          key: `equipment-fiscal:${line.id || i}`,
          title: 'Tratamiento fiscal',
          summary: () => {
            const f = ((quote.equipment[i] || {}).external || {}).fiscal || {};
            const vat = hasNumber(f.vatPct) ? `IVA ${formatPercent(Number(f.vatPct))}` : 'IVA sin definir';
            const rec = f.vatRecoverable ? labelOf(VAT_RECOVERY, f.vatRecoverable, '').toLowerCase() : 'sin definir si lo recuperás';
            return `${vat} · ${rec}${hasNumber(f.perceptionsPct) && Number(f.perceptionsPct) > 0 ? ` · percepciones ${formatPercent(Number(f.perceptionsPct))}` : ''}.`;
          },
          flag: () => {
            const f = ((quote.equipment[i] || {}).external || {}).fiscal || {};
            if ((f.vatRecoverable === 'no' || f.vatRecoverable === 'partial') && !hasNumber(f.vatPct)) return { tone: 'red', text: 'Falta la alícuota' };
            if (!f.vatRecoverable) return { tone: 'orange', text: 'Revisar' };
            return null;
          },
        },
        h('p', { class: 'small' }, 'RATEOS no trae alícuotas: cargá las que te informa tu contador o el proveedor. El IVA que recuperás y las percepciones son caja que adelantás, no costo. No cargues Ganancias como % del alquiler y no dupliques el IIBB: el del proveedor ya está dentro de su precio.'),
        formGrid(
          3,
          kit.num(`${p}.external.fiscal.vatPct`, { label: 'IVA que te factura', rule: 'percent', unit: '%' }),
          kit.select(`${p}.external.fiscal.vatRecoverable`, { label: '¿Recuperás ese IVA?', options: VAT_RECOVERY.map((v) => ({ value: v.id, label: v.label })), includeEmpty: true, emptyLabel: 'Sin definir', structural: true }),
          fiscal.vatRecoverable === 'partial' ? kit.num(`${p}.external.fiscal.vatRecoverablePct`, { label: 'Parte del IVA que recuperás', rule: 'percent', unit: '%' }) : null,
          kit.num(`${p}.external.fiscal.perceptionsPct`, { label: 'Percepciones / retenciones', rule: 'percent', unit: '%', hint: 'Caja adelantada: no es costo.' }),
          kit.num(`${p}.external.fiscal.nonRecoverablePct`, { label: 'Otros cargos que no recuperás', rule: 'percent', unit: '%', hint: 'Sí es costo (un cargo que no podés computar).' }),
        ),
      ),
      baseAdvanced(i, line),
    );
  };

  /**
   * Plazo de pago a este proveedor (PLAN-2026-011). Vacío = el general de
   * "Proveedores". Una condición de pago cargada antes (en Recursos o como
   * dato informativo) nunca se usa sola: se ofrece [Usar X días].
   */
  function supplierTermGroup(i, line) {
    const p = `equipment.${i}`;
    const generalDays = quote.finance && quote.finance.payDays && hasNumber(quote.finance.payDays.suppliers) ? Number(quote.finance.payDays.suppliers) : 0;
    const legacy = ((line.external || {}).fiscal || {}).paymentTermDays;
    const legacyDays = hasNumber(legacy) ? Number(legacy) : null;
    const own = hasNumber(line.supplierPayDays);
    return kit.group(
      'Pago al proveedor',
      formGrid(
        2,
        kit.num(`${p}.supplierPayDays`, {
          label: '¿A cuántos días pagás a este proveedor?',
          rule: 'paymentDays',
          unit: 'días',
          placeholder: `${formatNumber(generalDays)} (general)`,
          hint: `Vacío = el plazo general de Proveedores (${formatNumber(generalDays)} días, en Financiación). Sólo cambia el capital de trabajo y el costo financiero: el costo del externo no cambia.`,
        }),
      ),
      !own && legacyDays !== null
        ? kit.toggle(h('div', { class: 'qe-toolbar' },
          h('span', { class: 'small' }, `Hay una condición de pago cargada de ${formatNumber(legacyDays)} días (de Recursos o como dato informativo). No se usa sola.`),
          kit.action(`Usar ${formatNumber(legacyDays)} días`, () => ctx.mutate((q) => {
            q.equipment[i].supplierPayDays = legacyDays;
          }, { focus: `${p}.supplierPayDays` }), { icon: 'check' })), () => !hasNumber((quote.equipment[i] || {}).supplierPayDays))
        : null,
      kit.out((r) => {
        const sf = supplierFinanceAt(r, i);
        if (!sf) return '';
        return `${sf.own ? 'Con su plazo propio' : 'Con el plazo general de Proveedores'}: se financia ${formatNumber(sf.days, { decimals: 1 })} días → capital de trabajo ${formatMoney(sf.workingCapital)}, costo financiero ${formatMoney(sf.financial)} por mes.`;
      }, { tag: 'p', className: 'small muted', allowEmpty: true }),
    );
  }

  const lineCards = lines.map((line, i) => (isExternalLine(line) ? externalCard(line, i) : ownedCard(line, i)));

  const totals = kit.keyline({
    label: 'Equipos en el costo del mes',
    value: (r) => formatMoney(r.model.equipment.reduce((acc, e) => acc + monthlyAtEstimate(r, e), 0)),
    hint: (r) => `Fijo: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.fixedMonthly, 0))} por mes · variable: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.variablePerActiveDay, 0))} por día activo (incluye combustible y la movilización que cobran los proveedores). En la estructura de costos, el combustible y los externos se informan aparte.`,
    className: 'qe-keyline-total',
  });

  mount(
    container,
    card({ title: 'Equipos', subtitle: `Cargá cada equipo afectado al servicio: propio, alquilado o tercerizado. Cómo llega cada uno al lugar del servicio y los vehículos de apoyo se definen en "${stepName('logistics')}".` }, toolbar, fuelNote),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : emptyState({
        title: 'Todavía no agregaste equipos.',
        text: h('span', {}, 'Agregá uno desde ', h('a', { href: '#/recursos/equipos' }, 'tus recursos'), ' o en blanco (propio, alquilado o tercerizado). Si el servicio no usa equipos, seguí al próximo paso.'),
        icon: 'resources',
      }),
    lineCards.length ? totals : null,
  );
  return { update() {} };
}
