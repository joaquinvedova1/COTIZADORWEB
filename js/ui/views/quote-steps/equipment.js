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
import { badge, card, dateField, formGrid, selectField, triStateField, confirmDialog, emptyState, icon, infoTip } from '../../components.js';
import { equipmentLineFromLibrary, externalLineFromService, blankEquipmentLine, createExternalTerms, createMobilization, acquisitionOf } from '../../../domain/quote-factory.js';
import { ACQUISITION_MODES, CURRENCIES, EXTERNAL_UNITS, EXTERNAL_TRIP_BASES, EXTERNAL_FUEL_MODES, VAT_RECOVERY, MAINTENANCE_MODES, BUDGET_PERIODS, TIRE_MODES, ILLUSTRATIVE_AGREEMENT_PARAMS, labelOf } from '../../../domain/catalogs.js';
import { activationTerms, withActivationOptions } from '../../../domain/activation-terms.js';
import { contractOf } from '../../../domain/contract.js';
import { computeEquipmentUnit, maintenanceOf, tiresOf, MAX_EQUIPMENT_HOURS_PER_DAY } from '../../../engines/equipment-engine.js';
import { wearNote, wearWarnings } from '../../equipment-wear-ui.js';
import { monthsFactor, defaultEquipmentBillableHours } from '../../../engines/cost-engine.js';
import { conversionFactor } from '../../../engines/currency-engine.js';
import { lineIncrementalImpact } from '../../../engines/impact-engine.js';
import { externalUnitAssumption } from '../../../engines/completeness-engine.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { nonNegative } from '../../../core/money.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, moneyText, plural, stepName } from './shared.js';
import { baseFields, lineOriginBlock, offerPeriodOf, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { transportOf, providerActivityText, providerRouteText, routeName } from './transport.js';
import { fieldHref } from '../../field-links.js';
import { assignmentBlock, monthHoursField, unitHoursField, asksUnitHours, hasManualSharePct } from './assignment.js';
import { mobilizationEditor } from './logistics.js';
import { closedJobsPerMonth, quoteUnitPlace, unitAmountText, costPlaceLabel, timeEquipmentUseText, timeEquipmentOwnershipHint, equipmentPerActiveDay, timeEquipmentHourHint, timeEquipmentJobText, timeEquipmentTotalText, equipmentFullHourRate } from '../../result-text.js';
import { usesTimeBasis, unitHoursConversion, showsPerUnit, unitHoursFactor } from '../../../domain/cost-basis.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { workDaysText } from '../../unit-text.js';
import { isVehicleFamily, looksLikeVehicleName } from '../../../domain/equipment-catalog.js';

const isExternalLine = (line) => acquisitionOf(line) !== 'owned';

const blankHours = (v) => v === null || v === undefined || v === '';
/**
 * ¿La línea es un VEHÍCULO propio (camioneta, camión, semi, colectivo: su función es trasladarse)?
 * Por su familia, por su nombre (cargado en blanco) o porque ya se cargó con 0 h en la locación y
 * viaja por sus medios. Sólo cambia el ORDEN de la ficha (consumo en ruta primero; trabajar parado
 * en la locación, plegado): los números salen de los mismos datos.
 */
export function isVehicleLine(line) {
  if (!line || isExternalLine(line)) return false;
  if (isVehicleFamily(line.familyId)) return true;
  if ((!line.familyId || line.familyId === 'other') && looksLikeVehicleName(line.name)) return true;
  const m = line.mobilization || {};
  return !blankHours(line.hoursPerActiveDay) && Number(line.hoursPerActiveDay) === 0 && m.mode === 'self';
}

/**
 * Líneas en blanco creadas en esta sesión: si al ponerles nombre resultan ser un vehículo, arrancan
 * con 0 h en la locación (sólo líneas NUEVAS: una cotización guardada nunca cambia sola).
 */
const freshBlankIds = new Set();

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
  day: `Unidades ${T.per} = días ${T.per}. Si lo usás menos días que los ${T.feminine ? 'de la' : 'del'} ${T.one}, elegí "Por ${T.one}" y cargá el total.`,
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

/** En la unidad de la cotización (Joaco 2026-11-18): precio cerrado → lo del mes ÷ trabajos por mes. */
function inQuoteUnit(result, monthly) {
  const jobs = closedJobsPerMonth(result);
  return jobs !== null ? monthly / jobs : monthly;
}

/** " ÷ 2 trabajos del mes" cuando el mes tiene más (o menos) de un trabajo; vacío si no. */
function jobsSplitText(result) {
  const jobs = closedJobsPerMonth(result);
  return jobs !== null && Math.abs(jobs - 1) > 1e-9 ? ` · repartido en ${formatNumber(jobs, { decimals: 2 })} trabajos del mes` : '';
}

/** Resultado del "Ver cálculo" de un equipo propio por tiempo usado (I3): en el trabajo o en el mes. */
function timeEquipmentTraceResult(result, line) {
  const jobs = closedJobsPerMonth(result);
  if (jobs !== null) return { label: 'Costo del equipo en el trabajo', value: inQuoteUnit(result, monthlyAtEstimate(result, line)), format: 'money' };
  return { label: 'Costo del equipo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' };
}

function monthlyAtEstimate(result, line) {
  const D = result.activity.activeDaysPerMonth;
  // Por tiempo usado (2026-11-18), tenerlo también es por día de trabajo (ownershipPerActiveDay).
  return line.fixedMonthly * monthsFactor(D, result.activity.availableDaysPerMonth) + equipmentPerActiveDay(line) * D + externalRoundingAt(result, line).economic;
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
    formula: line.timeBasis && line.time
      // I3 (2026-11-18): por tiempo usado, tenerlo va por hora.
      ? 'Tenerlo por mes = (reposición − residual) / (vida útil × 12) + (seguro + patente + certificaciones + otros) / 12 + mantenimiento fijo (presupuesto) + inversión promedio × tasa de capital / 12 · Usarlo por hora = mantenimiento/h + neumáticos/h + litros/h × precio combustible · Tenerlo por hora = lo que cuesta tenerlo por mes ÷ horas que trabaja y factura por mes · Costo = (tenerlo por hora × horas del día de trabajo + usarlo por hora × horas de uso) × días × cantidad'
      : 'Posesión/mes = (reposición − residual) / (vida útil × 12) + (seguro + patente + certificaciones + otros) / 12 + mantenimiento fijo (presupuesto) + inversión promedio × tasa de capital / 12 · Operación/h = mantenimiento/h + neumáticos/h + litros/h × precio combustible (service = costo / horas entre services; juego = costo / vida útil en horas) · Costo del mes = posesión × cantidad + operación/h × horas por día × días de trabajo × cantidad',
    inputs: [
      line.conversion !== undefined && line.conversion !== 1 ? { label: `Tipo de cambio de la cotización (${(source && source.base && source.base.currency) || ''})`, value: line.conversion, format: 'number' } : null,
      { label: 'Valor de reposición (en la moneda de la cotización)', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil (años)', value: o.lifeYears, format: 'number' },
      { label: 'Cantidad', value: line.quantity, format: 'number' },
      { label: line.timeBasis ? 'Horas de uso efectivo por día' : 'Horas de uso por día de trabajo', value: line.hoursPerActiveDay, format: 'hours' },
      { label: 'Días de trabajo por mes', value: result.activity.activeDaysPerMonth, format: 'days' },
      op.fuelNotApplicable ? { label: 'Combustible', value: 'No usa combustible', format: 'text' } : { label: 'Precio combustible (si lo pagamos)', value: op.fuelPricePerLiter, format: 'rate' },
      op.fuelNotApplicable ? null : { label: 'Consumo', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      { label: `Mantenimiento (${labelOf(MAINTENANCE_MODES, op.maintenanceMode, 'por hora').toLowerCase()})`, value: o.maintenanceFixedMonthly > 0 ? o.maintenanceFixedMonthly : op.maintenancePerHour, format: 'money', unit: o.maintenanceFixedMonthly > 0 ? 'por mes (fijo)' : 'por hora' },
      { label: `Neumáticos (${labelOf(TIRE_MODES, op.tiresMode, 'por hora').toLowerCase()})`, value: op.tiresPerKm > 0 ? op.tiresPerKm : op.tiresPerHour, format: 'money', unit: op.tiresPerKm > 0 ? 'por km (en la ruta)' : 'por hora' },
    ].filter(Boolean),
    steps: [
      { label: 'Amortización mensual (por unidad)', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones + otros + mantenimiento fijo (por unidad)', value: o.cashMonthly, format: 'money' },
      { label: 'Costo de capital mensual (por unidad)', value: o.capitalCostMonthly, format: 'money' },
      ...(line.timeBasis && line.time
        ? [
          // Por tiempo usado (2026-11-18): tenerlo cuesta las horas del día de trabajo × el valor de su hora.
          { label: 'Tenerlo por mes × cantidad (no se carga entero: va por hora)', value: line.fullFixedMonthly, format: 'money' },
          { label: line.time.ownBillableHours ? 'Horas por mes que lo usás o alquilás' : 'Horas por mes (si trabaja todo el mes a este ritmo)', value: line.time.billableHoursPerMonth, format: 'hours' },
          { label: 'Tenerlo por hora (lo de tenerlo en el mes ÷ horas por mes, por unidad)', value: line.time.hourlyCost, format: 'rate' },
          { label: line.time.ownHours ? 'Horas asignado a esta cotización por día' : 'Horas asignado a esta cotización por día (todo el día de trabajo)', value: line.time.hoursPerDay, format: 'hours' },
          { label: 'Tenerlo por día de trabajo × cantidad', value: line.ownershipPerActiveDay, format: 'money' },
        ]
        : line.shared
        ? [
          { label: 'Posesión mensual × cantidad (100 %)', value: line.fullFixedMonthly, format: 'money' },
          { label: '% de sus costos fijos asignado a esta cotización (equipo compartido)', value: line.fixedCostSharePct, format: 'percent' },
          { label: 'Posesión que carga esta cotización', value: line.fixedMonthly, format: 'money' },
          { label: 'Lo que tiene que cubrir otro contrato', value: line.unassignedFixedMonthly, format: 'money' },
        ]
        : [{ label: 'Posesión mensual × cantidad', value: line.fixedMonthly, format: 'money' }]),
      { label: 'Operación por hora (por unidad)', value: op.totalPerHour, format: 'money' },
      { label: 'Operación por día de trabajo × cantidad', value: line.variablePerActiveDay, format: 'money' },
    ],
    result: line.timeBasis && line.time
      ? timeEquipmentTraceResult(result, line)
      : { label: 'Costo del equipo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'La amortización y el costo de capital no son salidas de caja: no se financian en el costo financiero.',
      line.timeBasis ? 'Por tiempo usado: el equipo no carga su mes completo ni un % de su mes. Tenerlo cuesta las horas del día de trabajo × (lo de tenerlo en el mes ÷ horas que trabaja y factura por mes). Usarlo sigue el uso real.' : null,
      line.shared ? 'Equipo compartido: el % asignado reparte sólo los costos fijos (lo cargás vos; no sale de los días que trabaje). La operación sigue el uso real.' : null,
      source && (source.hoursPerActiveDay === null || source.hoursPerActiveDay === undefined || source.hoursPerActiveDay === '')
        ? (line.timeBasis && line.time && line.time.ownHours ? 'Horas de uso efectivo vacías: se usan las horas asignadas.' : 'Horas de uso vacías: se usan las horas por día de trabajo de la cotización.')
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
      Math.abs(impact.inflation || 0) > 0.5 ? { label: '+ inflación esperada asociada (precio fijo)', value: impact.inflation, format: 'money' } : null,
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
    formula: `Facturado ${T.per} = máx(unidades ${T.per}, mínimo) × tarifa neta × cantidad · Costo económico = neto × (1 + cargos no recuperables % + IVA % × (1 − parte recuperable)) · Por día de trabajo = ${T.per} / días ${T.per}`,
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
      { label: 'Costo económico por día de trabajo', value: x.variablePerActiveDay, format: 'money' },
      x.mobilizationPerActiveDay > 0 ? { label: 'Movilización del proveedor por día de trabajo', value: x.mobilizationPerActiveDay, format: 'money' } : null,
      x.fuelPerActiveDay > 0 ? { label: x.fuelMode === 'per_hour' ? 'Combustible no incluido por día de trabajo (L/h × horas)' : 'Combustible no incluido por día de trabajo (km de ruta × consumo por km)', value: x.fuelPerActiveDay, format: 'money' } : null,
      { label: 'Salida de caja con impuestos por día de trabajo (se financia hasta cobrar; no es costo)', value: x.cashPerActiveDay, format: 'money' },
      { label: 'Crédito fiscal por día de trabajo (no es costo)', value: x.creditPerActiveDay, format: 'money' },
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
 * Salida de caja de un externo (V-18): con tarifa fija mensual es un monto por
 * mes (antes decía "$ 0 por día de trabajo"); con las dos partes, las dos.
 * @param {object} x resultado del proveedor (`external-engine`)
 */
export function externalCashText(x = {}) {
  const parts = (monthly, daily) => [
    monthly > 0.005 ? `${formatMoney(monthly)} por mes` : null,
    daily > 0.005 || !(monthly > 0.005) ? `${formatMoney(daily || 0)} por día de trabajo` : null,
  ].filter(Boolean).join(' + ');
  return `Salida de caja con impuestos: ${parts(x.cashFixedMonthly, x.cashPerActiveDay)}; el crédito fiscal (${parts(x.creditFixedMonthly, x.creditPerActiveDay)}) no es costo.`;
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
  const closedContract = contractOf(quote).mode === 'closed';
  const library = Array.isArray(resources.equipment) ? resources.equipment : [];
  const services = Array.isArray(resources.externalServices) ? resources.externalServices : [];
  const lines = quote.equipment;
  const activityHours = quote.activity ? quote.activity.hoursPerActiveDay : null;
  // Por tiempo usado (cotizaciones nuevas que no se cobran por mes, 2026-11-18): tener un equipo
  // propio cuesta las horas del trabajo × el valor de su hora. No hay "% de sus costos fijos".
  const timeBasis = usesTimeBasis(quote);
  // 0.19.0: las horas de cada equipo se piden en la unidad de cobro (por válvula, en el trabajo) o por día.
  // Cómo se convierte el dato "en la unidad": 'job' (horas en el trabajo) o 'unit' (heredado de la 0.19.0).
  const hoursBasis = unitHoursConversion(quote);
  const perUnitShown = showsPerUnit(quote);
  const unitHoursReady = () => unitHoursFactor(hoursBasis, ctx.result && ctx.result.activity ? ctx.result.activity : {}) > 0;
  /** Cobro por unidad contable con el rendimiento cargado: las cuentas se dicen "por válvula" (0.19.0). */
  const perUnitView = (r) => {
    const f = perUnitShown && r && r.activity ? nonNegative(r.activity.unitsPerActiveDay) : 0;
    return f > 0 ? { f, one: billingUnitOf(quote).singular || 'unidad' } : null;
  };
  const assignedKey = (line) => (asksUnitHours(hoursBasis, line, 'assignedHoursPerDay') ? 'assignedHoursPerUnit' : 'assignedHoursPerDay');
  /** Ejemplo del campo de horas facturables: las que usa hoy el motor si está vacío. */
  const billablePlaceholder = (i) => {
    const t = ctx.result && ctx.result.model && ctx.result.model.equipment[i] && ctx.result.model.equipment[i].time;
    // Sin dato, el motor usa las horas del día de trabajo × los días del mes (defaultEquipmentBillableHours).
    return t && t.billableHoursPerMonth > 0 && !t.ownBillableHours ? `${formatNumber(t.billableHoursPerMonth, { decimals: 2 })} (si trabaja todo el mes a este ritmo)` : 'Todo el mes a este ritmo';
  };
  /** Horas del mes de un equipo propio (por mes): las de su ficha o, sin dato, todo el mes al ritmo del servicio. */
  const monthBaseHours = (line) => {
    const own = nonNegative(line && line.billableHoursPerMonth);
    if (own > 0) return own;
    const crew = (Array.isArray(quote.labor) ? quote.labor : []).reduce((max, l) => Math.max(max, nonNegative(l && l.normalHoursPerMonth)), 0);
    return defaultEquipmentBillableHours(activityHours, crew > 0 ? crew : ILLUSTRATIVE_AGREEMENT_PARAMS.normalHoursPerMonth);
  };
  const monthUnit = billingUnitOf(quote).kind === 'month';
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
    // 0.19.0: por tiempo usado las horas andando quedan vacías (= todas las asignadas): un solo dato.
    const opts = { hoursPerActiveDay: timeBasis && eq ? null : hoursDefault(), now: new Date().toISOString(), currency };
    const line = eq ? equipmentLineFromLibrary(eq, opts) : externalLineFromService(service, opts);
    // Vehículo nuevo: 0 h trabajando en la locación (una camioneta estacionada no gasta combustible).
    // 0.20.0: por tiempo usado un vehículo se trata como cualquier equipo (horas asignadas × su
    // valor hora completo); antes quedaba con 0 h y un camión que trabaja no sumaba su uso.
    const vehicle = isVehicleLine(line);
    if (vehicle) {
      line.hoursPerActiveDay = timeBasis ? null : 0;
      // Un vehículo llega por sus medios (su consumo en ruta queda a la vista); se puede cambiar.
      if (!line.mobilization || !line.mobilization.mode) line.mobilization = createMobilization({ ...(line.mobilization || {}), mode: 'self' });
    }
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: timeBasis && eq ? `equipment.${index}.${assignedKey(line)}` : `equipment.${index}.quantity` });
    // Una línea (revisión UX): el aviso largo tapaba "Continuar". Lo demás está en la ficha.
    ctx.toast(`Se agregó "${line.name}" con sus valores de hoy en Recursos.`, 'success');
  };
  const addBlank = (acquisition = 'owned', { vehicle = false } = {}) => {
    const line = blankEquipmentLine({ acquisition, hoursPerActiveDay: null, currency });
    if (vehicle) {
      // Vehículo nuevo: sólo viaja (0 h en la locación); el consumo se pide en ruta.
      line.name = 'Nuevo vehículo';
      line.hoursPerActiveDay = timeBasis ? null : 0;
      line.mobilization = createMobilization({ ...line.mobilization, mode: 'self' });
    } else if (acquisition === 'owned') {
      freshBlankIds.add(line.id);
    }
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.name` });
  };
  /** Equipo en blanco recién creado que se llama "Camioneta…", "Semi…": pasa a vehículo (0 h en la locación). */
  const vehicleFromName = (i) => {
    const line = quote.equipment[i];
    if (!line || !freshBlankIds.has(line.id)) return;
    if (!looksLikeVehicleName(line.name) || !blankHours(line.hoursPerActiveDay)) return;
    freshBlankIds.delete(line.id);
    ctx.mutate((q) => {
      const l = q.equipment[i];
      if (!timeBasis) l.hoursPerActiveDay = 0;
      if (!l.mobilization || !l.mobilization.mode) l.mobilization = createMobilization({ ...(l.mobilization || {}), mode: 'self' });
    });
    ctx.toast(`"${line.name}" es un vehículo: su consumo se pide en ruta (L/100 km).`, 'info');
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
    if (reset) ctx.toast(`La fecha base y la moneda de esta línea se reiniciaron (${currency}, sin fecha): cargá las del nuevo valor en "¿De qué mes son estos valores?".`, 'info');
  };

  const pickerOptions = [
    ...library.map((e) => ({ value: `eq:${e.id}`, label: `${e.internalCode ? `${e.internalCode} · ` : ''}${e.name || 'Equipo sin nombre'} (${labelOf(ACQUISITION_MODES, acquisitionOf(e), 'Propio').toLowerCase()})` })),
    ...services.map((e) => ({ value: `ext:${e.id}`, label: `Externo · ${e.name || 'Servicio sin nombre'}${e.external && e.external.supplier ? ` — ${e.external.supplier}` : ''}` })),
  ];

  const toolbar = h(
    'div',
    { class: 'qe-toolbar qe-add-toolbar' },
    // V-25: sin equipos ni externos cargados no se ofrece una lista vacía; "en blanco" pasa a ser el botón principal.
    !pickerOptions.length ? null : h(
      'div',
      { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Agregar desde tus recursos (Mis equipos y Externos)',
        value: null,
        includeEmpty: true,
        emptyLabel: pickerOptions.length ? 'Elegí un equipo o servicio…' : 'Todavía no cargaste equipos ni servicios externos',
        options: pickerOptions,
        onChange: (v) => {
          selectedId = v;
        },
      }),
      kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Agregar equipo propio en blanco', () => addBlank('owned'), { icon: 'plus', size: 'md', ...(pickerOptions.length ? {} : { variant: 'primary' }) }),
    kit.action('Agregar vehículo propio (camioneta, camión…)', () => addBlank('owned', { vehicle: true }), { icon: 'plus', size: 'md' }),
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
  // ¿Cómo llega al lugar del servicio? Se carga acá, en la tarjeta del equipo (con su consumo
  // en ruta): un equipo o vehículo se carga una sola vez. Viajes sólo muestra el resumen.
  const mobilityNote = (i) => {
    const line = quote.equipment[i] || {};
    const lgNA = Boolean(quote.logistics && quote.logistics.notApplicable);
    if (lgNA) {
      return kit.group('¿Cómo llega al lugar del servicio?',
        h('p', { class: 'small line-mobility-note' }, `Marcaste "Sin traslados" en "${stepName('logistics')}": no se suma movilización.`));
    }
    return kit.group('¿Cómo llega al lugar del servicio?', line ? mobilizationEditor(ctx, i) : null);
  };
  const baseAdvanced = (i, line) => {
    const p = `equipment.${i}`;
    const owned = !isExternalLine(line);
    return kit.advanced(
      {
        key: `equipment-base:${line.id || i}`,
        title: '¿De qué mes son estos valores? (fecha y moneda)',
        summary: () => {
          const e = quote.equipment[i] || {};
          // Sin fecha propia, el mes de la oferta (igual que la etiqueta de arriba de la ficha).
          const fallbackPeriod = offerPeriodOf(quote);
          return owned
            ? `${baseText(e.base, { prefix: 'Valor', fallbackPeriod })} · ${baseText(e.costsBase, { prefix: 'Costos', fallbackPeriod })}`
            : baseText(e.base, { prefix: 'Tarifa', fallbackPeriod });
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

  const selfMoving = (line) => Boolean(line && line.mobilization && line.mobilization.mode === 'self' && !(quote.logistics && quote.logistics.notApplicable));
  const ownedCard = (line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    const pu = (r) => perUnitView(r);
    // Valores copiados de una plantilla o equipo de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este equipo' });
    const illustrative = ill.marked;
    const wear = wearGroups(i, illustrative);
    // PLAN-2026-026: un equipo que viene de Recursos ya trae su valor, vida útil, seguro,
    // consumo y mantenimiento: acá sólo se carga cuántos van y cuántas horas se usan. Esos datos
    // quedan plegados ("Cambiar sus datos sólo en esta cotización"). Uno cargado acá los pide.
    const fromResource = typeof line.sourceId === 'string' && line.sourceId !== '';
    const vehicle = isVehicleLine(line);
    // Datos del equipo, en tres partes: valor (a la vista), seguro y patente (en "Costos de
    // tenerlo") y combustible trabajando (en un vehículo, plegado en "¿También trabaja parado…?").
    const valueFields = () => [
      kit.num(`${p}.replacementValue`, { label: 'Cuánto cuesta comprarlo hoy', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, requiredMark: !fromResource, hint: 'Valor de reposición: lo que costaría comprar uno igual hoy. Con esto y la vida útil sale su desgaste por mes (amortización).' }),
      kit.num(`${p}.usefulLifeYears`, { label: 'Vida útil', rule: 'years', unit: 'años', illustrative, requiredMark: !fromResource, hint: 'En cuántos años lo vas a tener que cambiar.' }),
    ];
    // V-06: seguro y patente se piden (en 0 el costo quedaba de menos sin aviso); plegados con su resumen.
    const holdingFields = () => [
      kit.num(`${p}.insuranceAnnual`, { label: 'Seguro anual', rule: 'money', unit: '$/año', illustrative }),
      kit.num(`${p}.licenseAnnual`, { label: 'Patente anual', rule: 'money', unit: '$/año', illustrative }),
    ];
    // PLAN-2026-014 (LAB-D5): "No usa combustible" es un dato explícito; un consumo 0 sin marcar sigue faltando.
    // Si viaja por sus propios medios, su consumo en ruta (L/100 km) se pide en "¿Cómo llega?":
    // acá va sólo lo que gasta TRABAJANDO en la locación (una camioneta que lleva gente y queda parada: 0).
    const fuelFields = () => [
      line.fuelNotApplicable === true ? null : kit.num(`${p}.fuelLitersPerHour`, selfMoving(line) || vehicle
        ? { label: 'Consumo trabajando en la locación', rule: 'quantity', unit: 'L/h', illustrative, hint: 'Sólo con el motor trabajando en el lugar (bomba, hidrogrúa). Si sólo lleva gente o carga y queda parado: 0. Lo que gasta en la ruta va en "¿Cómo llega al lugar del servicio?".' }
        : { label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', illustrative }),
      kit.check(`${p}.fuelNotApplicable`, {
        label: 'No usa combustible',
        structural: true,
        hint: line.fuelNotApplicable === true
          ? 'No se pide consumo ni se suma combustible de este equipo (tampoco al trasladarse).'
          : 'Acoplado, eléctrico o herramienta. Si es un vehículo con motor, no lo marques: poné 0 en el consumo en la locación.',
      }),
    ];
    const dataFields = () => [...valueFields(), ...holdingFields(), ...(vehicle ? [] : fuelFields())];
    const hoursField = () => kit.num(`${p}.hoursPerActiveDay`, timeBasis
      ? {
        // 0.19.0 (Joaco): una sola pregunta (horas asignado × valor hora completo). Esto es opcional, plegado.
        label: 'Horas con el motor andando (opcional)',
        rule: 'hoursPerDay',
        unit: 'h/día',
        placeholder: 'Todas las asignadas',
        hint: vehicle
          ? 'Vacío = todas las horas asignadas llevan el valor hora completo (lo normal). Si el vehículo sólo lleva gente y queda estacionado, poné 0: paga sólo tenerlo, y el combustible y el desgaste van por km.'
          : 'Vacío = todas las horas asignadas llevan el valor hora completo (lo normal). Si parte de ese tiempo el equipo queda quieto, cargá las horas por día de trabajo con el motor andando: las quietas no suman combustible, mantenimiento ni neumáticos.',
      }
      : vehicle
        ? {
          label: 'Horas trabajando en la locación por día',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: timeBasis ? 'Las mismas que asignado' : activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
          hint: 'Sólo las horas con el motor trabajando parado (bombeo, grúa, generador). Si sólo lleva gente o carga: 0. Con 0 h no suman el consumo ni el mantenimiento por hora: lo de la ruta va en "Desgaste por km".',
        }
        : {
          label: 'Horas de uso por día de trabajo',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
          hint: 'Cuántas horas trabaja el equipo cada día. Vacío = las horas por día del servicio.',
        });
    // 0.18.0: horas por día que el equipo está en este trabajo (vacío = todo el día de trabajo).
    const dayHours = hoursDefault();
    // Un equipo agregado antes de la 0.19.0 trae las horas andando = el día de trabajo: al cargar sus
    // horas asignadas se limpian (si no, el motor seguiría contando el día entero).
    const dropInheritedHours = (value) => {
      const cur = quote.equipment[i] || {};
      const run = nonNegative(cur.hoursPerActiveDay);
      if (Number(value) > 0 && run > 0 && dayHours !== null && Math.abs(run - dayHours) < 1e-9) ctx.update(`${p}.hoursPerActiveDay`, null);
    };
    const jobHoursField = () => kit.num(`${p}.assignedHoursPerDay`, {
      label: 'Horas asignado a esta cotización',
      rule: 'hoursPerDay',
      unit: 'h/día',
      placeholder: dayHours !== null && dayHours > 0 ? `${formatNumber(dayHours, { decimals: 2 })} (todo el día)` : 'Todo el día',
      // Vehículo: sus horas trabajando en la locación toman este dato si están vacías (se redibuja).
      structural: vehicle,
      onValue: dropInheritedHours,
      hint: `Las horas por día de trabajo que el equipo queda asignado a esta cotización (mientras tanto no puede estar en otro trabajo). Su costo = esas horas × su valor hora (amortización, seguro, patente, mantenimiento y combustible). Ejemplo: de un día de 8 h, la hidrogrúa va 2 → 2. Vacío = todo el día de trabajo${dayHours !== null && dayHours > 0 ? ` (${formatNumber(dayHours, { decimals: 2 })} h)` : ''}; más que eso no se cuenta.`,
    });
    const unitField = () => unitHoursField(kit, { path: p, kind: 'equipment', basis: hoursBasis, unit: billingUnitOf(quote), ready: unitHoursReady(), where: stepName('service'), onValue: dropInheritedHours });
    // Por mes: horas por mes en el servicio (vacío = todo el mes). Un % cargado antes se ve en "Más detalle".
    const monthField = () => (!monthUnit || hasManualSharePct(line) ? null : monthHoursField(kit, ctx, { path: p, kind: 'equipment', baseHours: monthBaseHours(line) }));
    // I7 (2026-11-18): por tiempo usado, con cuántas horas por mes se reparte lo de tenerlo (a la vista, junto a las horas de uso).
    const billableField = () => kit.num(`${p}.billableHoursPerMonth`, {
      label: 'Horas por mes para el valor hora (opcional)',
      rule: 'hours',
      unit: 'h/mes',
      placeholder: billablePlaceholder(i),
      hint: 'Las horas que el equipo trabaja en un mes entre todos tus trabajos. Su costo del mes se divide por estas horas para sacar el valor hora: con menos horas, cada hora cuesta más.',
    });
    // Nombre: un equipo en blanco que resulta ser un vehículo arranca con 0 h en la locación.
    const nameField = () => {
      const el = kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120, placeholder: 'Ej.: Camioneta 4x4' });
      const input = el.querySelector('input');
      if (input && !ctx.readOnly) input.addEventListener('change', () => vehicleFromName(i));
      return el;
    };
    // Vehículo: ¿también trabaja parado en la locación? Plegado si arranca en 0 h; abierto si ya tiene horas.
    const savedHours = line.hoursPerActiveDay;
    const worksAtSite = blankHours(savedHours) || Number(savedHours) > 0;
    const locationBlock = () => kit.advanced(
      {
        key: `equipment-location:${line.id || i}`,
        title: '¿También trabaja parado en la locación? (bombeo, grúa, generador…)',
        defaultOpen: worksAtSite,
        summary: (r) => {
          const l = at(r);
          if (!l) return '';
          if (!(l.hoursPerActiveDay > 0)) return 'No: sólo viaja (0 h en la locación).';
          const e = quote.equipment[i] || {};
          const fuel = e.fuelNotApplicable === true ? 'no usa combustible' : `${formatNumber(Number(e.fuelLitersPerHour) || 0, { decimals: 2 })} L/h`;
          return `Sí: ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h por día · ${fuel} · ${formatMoney(l.variablePerActiveDay)} por día de trabajo.`;
        },
      },
      formGrid(3, hoursField(), ...fuelFields()),
    );
    // Seguro, patente y mantenimiento: plegados, con su resumen en la línea del título (ficha corta en el celular).
    const holdingBlock = () => kit.advanced(
      {
        key: `equipment-holding:${line.id || i}`,
        title: h('span', {}, 'Costos de tenerlo',
          kit.out(() => {
            const e = quote.equipment[i] || {};
            return ` · seguro ${moneyText(e.insuranceAnnual) || '$ 0'}/año · patente ${moneyText(e.licenseAnnual) || '$ 0'}/año · ${wearSummary(e).maintenance}`;
          }, { className: 'qe-adv-inline' })),
      },
      formGrid(3, ...holdingFields()),
      wear[0],
    );
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Equipo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          if (!l) return '';
          const units = `${formatNumber(l.quantity, { decimals: 2 })} ${plural(l.quantity, 'unidad', 'unidades')}`;
          // 0.18.0: por tiempo usado, lo que define el costo de tenerlo son sus horas en el trabajo.
          if (l.timeBasis && l.time) return `${Math.abs(l.quantity - 1) < 1e-9 ? '' : `${units} · `}${pu(r) ? `${formatNumber(l.time.hoursPerDay / pu(r).f, { decimals: 2 })} h asignado por ${pu(r).one}` : `${formatNumber(l.time.hoursPerDay, { decimals: 2 })} h asignado por día`}`;
          if (vehicle) return l.hoursPerActiveDay > 0 ? `${units} · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h por día trabajando en la locación` : `${units} · vehículo (sólo viaja)`;
          return `${units} · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h de uso por día de trabajo`;
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
        fromResource ? null : nameField(),
        // 0.18.0 (Joaco, 2026-11-20): primero las horas del equipo en el trabajo (o en el mes, si
        // se cobra por mes); con ellas y el valor de su hora sale lo que cuesta tenerlo.
        timeBasis ? (assignedKey(line) === 'assignedHoursPerUnit' ? unitField() : jobHoursField()) : monthField(),
        // 0.20.0: en un vehículo por tiempo usado las horas con el motor andando van a la vista (0 = sólo viaja).
        vehicle ? (timeBasis ? hoursField() : null) : (timeBasis ? null : hoursField()),
        // Sin "Cantidad" (Joaco, 2026-11-20): si hay otro equipo igual, se agrega otra vez. Una línea con otra cantidad la sigue mostrando.
        line.quantity !== null && line.quantity !== undefined && line.quantity !== '' && Math.abs(Number(line.quantity) - 1) < 1e-9 ? null : kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.', requiredMark: true, hint: 'Cargada antes. Para sumar otro equipo igual, agregalo otra vez.' }),
        operatorField(i),
        fromResource ? null : acquisitionField(i),
        ...(fromResource ? [] : valueFields()),
        ...(fromResource || (vehicle && !timeBasis) ? [] : fuelFields()),
      ),
      // Vehículo: primero cómo viaja (consumo en ruta); trabajar parado en la locación, plegado.
      vehicle ? mobilityNote(i) : null,
      vehicle && !timeBasis ? locationBlock() : null,
      // Seguro, patente y mantenimiento plegados sólo si el equipo se carga acá (el de Recursos ya los trae).
      fromResource ? null : holdingBlock(),
      kit.out((r) => wearWarningsRegion(r, i) || '', { tag: 'div', allowEmpty: true }),
      // 0.19.0 (Joaco, 2026-11-20): el valor hora del equipo a la vista, como en Personal. Asignado
      // paga su valor hora; cada hora de uso efectivo suma encima el desgaste.
      timeBasis
        ? h('div', { class: 'qe-person-rates' },
          h('p', { class: 'qe-person-rates-title' }, fromResource ? 'Lo que te cuesta el equipo (viene de Recursos)' : 'Lo que te cuesta el equipo'),
          kit.stats(
            kit.stat('Por mes', (r) => (at(r) && at(r).ownership.totalMonthly > 0 ? formatMoney(at(r).ownership.totalMonthly) : EMPTY), { hint: 'Amortización, seguro, patente y demás costos del mes, lo uses o no.' }),
            kit.stat('Valor hora', (r) => {
              const l = at(r);
              if (!l || !l.time) return EMPTY;
              // El mismo número que usa la cuenta de la línea; con horas andando distintas, sólo tenerlo.
              const full = equipmentFullHourRate(l);
              const rate = full !== null ? full : l.time.hourlyCost;
              return rate > 0 ? formatMoney(rate) : EMPTY;
            }, {
              emphasis: true,
              hint: (r) => {
                const l = at(r);
                if (!l || !l.time) return '';
                const own = `${formatMoney(l.time.hourlyCost)} de tenerlo (${timeEquipmentHourHint(l).replace(/\.$/, '')})`;
                if (!(l.hoursPerActiveDay > 0)) return `${own}. El combustible y el desgaste van por km, en «¿Cómo llega?».`;
                return equipmentFullHourRate(l) !== null
                  ? `${own} + ${formatMoney(l.operation.totalPerHour)} de usarlo (combustible, mantenimiento y neumáticos por hora). El traslado va aparte, en «¿Cómo llega?».`
                  : `${own}. Aparte, cada hora con el motor andando suma ${formatMoney(l.operation.totalPerHour)} (combustible, mantenimiento y neumáticos).`;
              },
            }),
          ))
        : null,
      kit.keyline({
        // Precio cerrado con un trabajo por mes: la cifra es la del trabajo (revisión UX tanda novatos).
        label: (r) => (timeBasis && pu(r) ? `Costo del equipo por ${pu(r).one}` : costPlaceLabel(r, quote, 'Equipo')),
        value: (r) => {
          const l = at(r);
          if (!l) return EMPTY;
          if (l.timeBasis && pu(r)) {
            // Lo del mes ÷ unidades facturadas (como el motor); sin días todavía, lo de un día ÷ unidades por día.
            const units = nonNegative(r.activity.billableQuantityPerMonth);
            return formatMoney(units > 0 && r.activity.activeDaysPerMonth > 0 ? monthlyAtEstimate(r, l) / units : equipmentPerActiveDay(l) / pu(r).f);
          }
          return closedJobsPerMonth(r) !== null ? formatMoney(inQuoteUnit(r, monthlyAtEstimate(r, l))) : unitAmountText(r, quote, monthlyAtEstimate(r, l));
        },
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          // Por tiempo usado: tenerlo por día de trabajo (horas × valor de la hora), no por mes.
          // Precio cerrado (M1): la cuenta en el trabajo, como en Personal.
          if (l.timeBasis && pu(r) && l.time) {
            const full = equipmentFullHourRate(l);
            const { f, one } = pu(r);
            const many = l.quantity > 0 && Math.abs(l.quantity - 1) > 1e-9 ? ` × ${formatNumber(l.quantity, { decimals: 2 })} unidades` : '';
            const month = r.activity.activeDaysPerMonth > 0 ? ` En el mes: ${formatMoney(monthlyAtEstimate(r, l))}.` : '';
            return full !== null
              ? `${formatNumber(l.time.hoursPerDay / f, { decimals: 2 })} h por ${one} × ${formatMoney(full)} la hora${many} = ${formatMoney(equipmentPerActiveDay(l) / f)} por ${one}.${month}`
              : `${timeEquipmentUseText(l)} ÷ ${formatNumber(f, { decimals: 2 })} ${billingUnitOf(quote).plural} por día.${month}`;
          }
          if (l.timeBasis) {
            const job = timeEquipmentJobText(r, l);
            return job ? `${job}.` : `${timeEquipmentUseText(l)} · con ${workDaysText(r.activity.activeDaysPerMonth)}${jobsSplitText(r)}.`;
          }
          const share = l.shared && !l.shareMissing ? ` (${formatPercent(l.fixedCostSharePct)} asignado a esta cotización de ${formatMoney(l.fullFixedMonthly)})` : '';
          return `Tenerlo: ${formatMoney(l.fixedMonthly)} por mes${share} (aunque no trabaje) · usarlo: ${formatMoney(l.variablePerActiveDay)} por día de trabajo · con ${workDaysText(r.activity.activeDaysPerMonth)}${jobsSplitText(r)}.`;
        },
        trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
      }),
      vehicle ? null : mobilityNote(i),
      kit.advanced(
        {
          key: `equipment:${line.id || i}`,
          title: fromResource ? 'Cambiar sus datos sólo en esta cotización (opcional)' : 'Más detalle (opcional)',
          summary: () => {
            const e = quote.equipment[i] || {};
            const parts = [
              fromResource ? `vale ${moneyText(e.replacementValue) || '$ 0'} · ${formatNumber(Number(e.usefulLifeYears) || 0, { decimals: 1 })} años de vida útil` : null,
              `residual ${moneyText(e.residualValue) || '$ 0'}`,
              hasNumber(e.otherAnnual) && Number(e.otherAnnual) > 0 ? `otros ${moneyText(e.otherAnnual)}/año` : null,
              `certificaciones ${moneyText(e.certificationsAnnual) || '$ 0'}/año`,
              fromResource ? wearSummary(e).maintenance : null,
              wearSummary(e).tires,
              hasNumber(e.capitalRatePctAnnual) && Number(e.capitalRatePctAnnual) > 0 ? `costo de capital ${formatPercent(Number(e.capitalRatePctAnnual))} anual` : 'sin costo de capital',
            ];
            const text = parts.filter(Boolean).join(' · ');
            return illustrative ? h('span', {}, `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, illustrativeTag()) : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
          },
        },
        // 0.19.0: una sola pregunta a la vista; de qué horas sale el valor hora y el motor andando, acá.
        timeBasis ? kit.group('Valor hora', formGrid(3, billableField(), vehicle ? null : hoursField())) : null,
        fromResource
          ? h('p', { class: 'qe-note' }, 'Estos datos se cargan una sola vez en ', h('a', { href: '#/recursos' }, 'Recursos'), '. Si los cambiás acá, cambian sólo en esta cotización.')
          : null,
        fromResource
          ? kit.group('Datos del equipo', formGrid(3, kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }), acquisitionField(i), ...dataFields()))
          : null,
        fromResource ? wear[0] : null,
        kit.group(
          'Otros costos de tenerlo (aunque no trabaje)',
          formGrid(
            3,
            kit.num(`${p}.residualValue`, { label: 'Valor residual', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, hint: 'Lo que vale al final de su vida útil (en la misma moneda que el valor de reposición).' }),
            kit.num(`${p}.otherAnnual`, { label: 'Otros por año (RTO, GPS, habilitaciones)', rule: 'money', unit: '$/año', hint: 'Habilitaciones, GPS, cocheras… lo que pagás aunque no trabaje.' }),
            kit.num(`${p}.certificationsAnnual`, { label: 'Certificaciones por año', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.capitalRatePctAnnual`, { label: 'Costo de capital (opcional)', rule: 'percent', unit: '% anual', hint: 'Tasa anual sin inflación (real): lo que le pedís a la plata invertida en el equipo por encima de la suba de precios. Como el valor de reposición ya está actualizado, no sumes la inflación de nuevo. No es la financiación del contrato (eso va en "Financiación").' }),
          ),
          capitalCostNote(i),
        ),
        wear[1],
        // PLAN-2026-012: reservado / compartido (% explícito de sus costos fijos). Por tiempo usado no hay %.
        // 0.18.0: por mes se piden las horas por mes arriba; el bloque queda sólo para un % cargado antes.
        timeBasis || (monthUnit && !hasManualSharePct(line)) ? null : assignmentBlock(kit, { path: p, line, kind: 'equipment', at }),
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
          // I7: la hora de tenerlo (lo del mes ÷ las horas por mes), por unidad.
          timeBasis
            ? kit.stat('Tenerlo por hora', (r) => (at(r) && at(r).timeBasis && at(r).time ? formatMoney(at(r).time.hourlyCost) : EMPTY), { hint: (r) => timeEquipmentHourHint(at(r)) })
            : null,
          timeBasis
            ? kit.stat('Tenerlo por día de trabajo', (r) => formatMoney(at(r) && at(r).timeBasis ? at(r).ownershipPerActiveDay : 0), { hint: (r) => timeEquipmentOwnershipHint(at(r)) })
            : kit.stat('Tenerlo por mes (fijo)', (r) => formatMoney(at(r) && at(r).fixedMonthly)),
          kit.stat('Usarlo por día de trabajo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: (r) => (at(r) ? `${formatNumber(at(r).fuelLitersPerActiveDay, { decimals: 1 })} L de combustible por día` : '') }),
          timeBasis
            // M2: por tiempo usado, en el trabajo (precio cerrado) o en el mes.
            ? kit.stat((r) => (closedJobsPerMonth(r) !== null ? 'Costo en el trabajo' : 'Costo en el mes'), (r) => (at(r) ? formatMoney(inQuoteUnit(r, monthlyAtEstimate(r, at(r)))) : EMPTY), {
              emphasis: true,
              hint: (r) => {
                const jobs = closedJobsPerMonth(r);
                const D = r.activity.activeDaysPerMonth;
                return jobs !== null && jobs > 0 ? `Con ${workDaysText(D / jobs)} del trabajo.` : `Con ${formatNumber(D, { decimals: 2 })} días de trabajo.`;
              },
              trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
            })
            : kit.stat('Costo mensual con la actividad estimada', (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY), {
              emphasis: true,
              hint: (r) => `Con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días de trabajo.`,
              trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
            }),
        ),
        // Por tiempo usado la ficha por utilización del mes no es la cuenta de esta cotización: no se muestra.
        timeBasis ? null : h('h5', { class: 'qe-group-title' }, 'Ficha con los días de esta cotización (por unidad)'),
        timeBasis ? null : kit.stats(
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
    // Precio cerrado (V-02): "global" es toda la obra, no los meses de contrato.
    options: unitsFor(T).map((u) => ({ value: u.id, label: closedContract && u.id === 'global' ? 'Global (toda la obra)' : u.label })),
    hint: closedContract && value === 'global' ? 'Monto por toda la obra. Se reparte en los "Trabajos que cubre el total" (Más datos de la cotización; vacío = 1).' : unitHints(T)[value],
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
        if (!item) return '';
        // Tanda B (H-04): a la vista, la cuenta ("cobra X por salida… equivale a Y por viaje") y la
        // consecuencia; el resto del mensaje del motor (por qué suele ir una vez, cómo elegir) en el (i).
        const msg = String(item.message || '');
        const m = /^([\s\S]*?Equivale a [\s\S]*? por viaje\.)([\s\S]*)$/.exec(msg);
        if (!m) return h('div', {}, h('strong', {}, `¿Cobra ${T.per} o por viaje? `), msg);
        const tail = m[2].trim();
        const ending = /(Revisalo: si cobra por viaje, el costo queda corto\.|Hasta entonces el resultado no es confiable\.)/.exec(tail);
        const rest = (ending ? tail.replace(ending[1], '') : tail).trim();
        return h('div', {}, h('strong', {}, `¿Cobra ${T.per} o por viaje? `), m[1], ending ? h('strong', {}, ` ${ending[1]}`) : null,
          rest ? infoTip(rest, { label: 'Más detalle del aviso' }) : null);
      }, { tag: 'div', allowEmpty: true }),
      ctx.readOnly
        ? null
        // Testeo con especialistas (A-4): las dos respuestas pesan lo mismo (ninguna es la "sugerida").
        : h('div', { class: 'qe-toolbar' },
          kit.action('Por viaje completo (ida y vuelta)', () => setExternalUnit(index, ROUND_TRIP)),
          kit.action(`Sí, cobra ${T.per}`, () => ctx.mutate((q) => { q.equipment[index].externalUnitConfirmed = externalUnitAssumption(q, q.equipment[index]); })),
          // La pista para elegir va en el (i): el aviso ya tiene mucho texto.
          infoTip(`Si los viajes son de tus vehículos y el proveedor va una sola vez, confirmá «cobra ${T.per}».`, { label: '¿Cuál elijo?' })),
    ), (r) => Boolean(unitPendingOf(r, index)));
    // Crítico (resultado no confiable) en rojo; aviso común (tanda B, H-04) en amarillo.
    kit.effect((r) => {
      const item = unitPendingOf(r, index);
      const critical = Boolean(item && item.unreliable);
      pendingBanner.classList.toggle('banner-danger', critical);
      pendingBanner.classList.toggle('banner-warning', !critical);
      pendingBanner.setAttribute('role', critical ? 'alert' : 'status');
    });
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
      // Asistente de completitud del externo.
      kit.out(() => {
        const items = externalChecklist(quote.equipment[i] || {});
        const pending = items.filter((x) => !x.ok);
        return h(
          'div',
          { class: ['qe-ext-checklist', pending.length ? 'has-pending' : 'is-complete'] },
          h('p', { class: 'small' }, pending.length ? `Faltan ${pending.length} ${pending.length === 1 ? 'dato' : 'datos'} del proveedor:` : '✓ Datos del proveedor completos.'),
          // 0.17.0 (menos texto): sólo los datos que faltan; completos, una línea.
          pending.length ? h('ul', { class: 'qe-chips' }, ...pending.map((x) => h('li', { class: ['qe-chip', 'is-pending'] }, `• ${x.label}${x.value ? `: ${x.value}` : ''}`))) : null,
        );
      }, { tag: 'div' }),
      formGrid(3, acquisitionField(i), operatorField(i)),
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
            label: 'Horas de uso por día de trabajo',
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
          triField(`${p}.external.mobilizationIncluded`, 'Movilización (llevarlo y traerlo)'),
          ext.mobilizationIncluded === false ? kit.num(`${p}.external.mobilizationAmount`, { label: `Movilización del proveedor ${T.per} (neta)`, rule: 'money', unit: sym, hint: `Lo que te cobra por llevarlo y traerlo en ${T.each}.` }) : null,
          triField(`${p}.external.insuranceIncluded`, 'Seguro'),
        ),
      ),
      supplierTermGroup(i, line),
      kit.keyline({
        label: (r) => `Costo del ${acq === 'rented' ? 'alquiler' : 'servicio'} en el ${quoteUnitPlace(r)}`,
        value: (r) => (providerOf(r, i) && providerOf(r, i).noRoute ? 'Falta la ruta' : at(r) ? formatMoney(inQuoteUnit(r, monthlyAtEstimate(r, at(r)))) : EMPTY),
        tone: (r) => (providerOf(r, i) && providerOf(r, i).noRoute ? 'red' : null),
        hint: (r) => {
          const x = at(r) && at(r).external;
          if (!x) return '';
          if (providerOf(r, i) && providerOf(r, i).noRoute) return 'Falta definir la ruta/distancia para calcular este proveedor: hasta entonces no suma costo.';
          const fixed = x.fixedMonthly > 0 ? `Fijo: ${formatMoney(x.fixedMonthly)} por mes (trabaje o no). ` : '';
          const billed = x.netPerActivation > 0 ? `Facturado ${T.per}: ${formatNumber(x.billedUnitsPerActivation, { decimals: 2 })} × ${formatMoney(x.price)} × ${formatNumber(x.quantity, { decimals: 2 })} = ${formatMoney(x.netPerActivation)} neto. ` : '';
          // Combustible a tu cargo (no incluido en la tarifa): suma acá, pero va a Combustible.
          const fuel = x.fuelPerActiveDay > 0 ? `Incluye combustible a tu cargo: ${formatMoney(x.fuelPerActiveDay * r.activity.activeDaysPerMonth)} por mes (en la estructura de costos va a Combustible). ` : '';
          return `${fixed}${billed}${fuel}${externalCashText(x)}${jobsSplitText(r) ? ` En el trabajo: lo del mes${jobsSplitText(r).replace(' · ', ' ')}.` : ''}`;
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
    label: (r) => costPlaceLabel(r, quote, 'Equipos'),
    value: (r) => {
      const month = r.model.equipment.reduce((acc, e) => acc + monthlyAtEstimate(r, e), 0);
      return closedJobsPerMonth(r) !== null ? formatMoney(inQuoteUnit(r, month)) : unitAmountText(r, quote, month);
    },
    // Por tiempo usado, lo de tener los equipos propios va en lo de cada día de trabajo.
    hint: (r) => (timeBasis && perUnitView(r) && r.model.timeBasis && !(r.model.equipment.reduce((acc, e) => acc + (e.fixedMonthly || 0), 0) > 0.005) ? `${formatMoney(r.model.equipment.reduce((acc, e) => acc + equipmentPerActiveDay(e), 0) / perUnitView(r).f)} por ${perUnitView(r).one}: las horas asignadas de cada equipo × su valor hora.` : '') || timeEquipmentTotalText(r, closedJobsPerMonth(r) !== null ? inQuoteUnit(r, r.model.equipment.reduce((acc, e) => acc + monthlyAtEstimate(r, e), 0)) : null) || `${r.model.timeBasis && !(r.model.equipment.reduce((acc, e) => acc + e.fixedMonthly, 0) > 0.005) ? 'Sin fijo del mes ·' : `Fijo: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.fixedMonthly, 0))} por mes ·`} variable: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + equipmentPerActiveDay(e), 0))} por día de trabajo${jobsSplitText(r)} (incluye ${r.model.timeBasis && r.model.equipment.some((e) => e.timeBasis) ? 'tener los equipos propios esas horas, ' : ''}combustible y la movilización que cobran los proveedores).`,
    className: 'qe-keyline-total',
  });

  mount(
    container,
    card({ title: 'Agregá los equipos y vehículos', subtitle: 'Camionetas incluidas. Si hay dos iguales, agregalo dos veces.' }, toolbar, fuelNote),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : emptyState({
        title: 'Todavía no agregaste equipos.',
        text: 'Agregá uno desde tus recursos o en blanco (propio, alquilado o tercerizado). Si el servicio no usa equipos, seguí al próximo paso.',
        icon: 'resources',
      }),
    lineCards.length ? totals : null,
  );
  return { update() {} };
}
