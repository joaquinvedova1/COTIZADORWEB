/**
 * RATEOS Test Lab — constructores de escenarios (PLAN-2026-013).
 *
 * Arman cotizaciones y productos SINTÉTICOS con la misma forma que guarda la
 * aplicación (createEmptyQuote / createEmptyProduct del dominio), con ids y
 * fechas fijas (reproducibles). Los valores son ILUSTRATIVOS: no son escalas
 * salariales, alícuotas, precios ni costos reales de nadie.
 */

import { createEmptyQuote } from '../../../js/domain/quote-factory.js';
import { createEmptyProduct } from '../../../js/domain/product-factory.js';

export const LAB_NOW = '2026-10-16T12:00:00.000Z';
export const LAB_ORG = 'org-test-lab';

/** Configuración propia (no ILUSTRATIVA) para que los defaults no dependan de la demo. */
export const LAB_SETTINGS = Object.freeze({
  currency: 'ARS',
  fuelPricePerLiter: 1500,
  financeMonthlyRatePct: 3,
  defaultTargetMarginPct: 10,
  defaultContingencyPct: 0,
  defaultPaymentTermDays: 60,
  roundingStep: 1000,
  defaultBillingTaxes: null,
  exchangeRates: [],
  illustrative: false,
});

/** Base económica del mes de la oferta (evita avisos de "base no definida" que no son el foco). */
export const base = (currency = 'ARS', period = '2026-10') => ({ period, currency, source: 'company', note: '' });

let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
/** Reinicia los ids automáticos: cada escenario se arma igual en cualquier orden de ejecución. */
export function resetIds() {
  seq = 0;
}

/** Persona (posición) con parámetros genéricos ILUSTRATIVOS de convenio. */
export function person(o = {}) {
  return {
    id: o.id || nextId('l'),
    role: 'Operador',
    positions: 1,
    peoplePerPosition: 1,
    basicMonthly: 1800000,
    additionalsMonthly: 0,
    normalHoursPerMonth: 176,
    overtimeHoursPerActiveDay: 0,
    overtimePremiumPct: 50,
    mealPerActiveDay: 0,
    sacPct: 8.33,
    vacationPct: 4,
    employerContributionsPct: 24,
    artPct: 6,
    insuranceMonthly: 0,
    ppeMonthly: 0,
    trainingMonthly: 0,
    transferMonthly: 0,
    base: base(),
    ...o,
  };
}

/** Equipo PROPIO. */
export function owned(o = {}) {
  return {
    id: o.id || nextId('e'),
    name: 'Equipo propio',
    acquisition: 'owned',
    quantity: 1,
    hoursPerActiveDay: null,
    replacementValue: 100000000,
    usefulLifeYears: 10,
    residualValue: 0,
    insuranceAnnual: 0,
    licenseAnnual: 0,
    certificationsAnnual: 0,
    otherAnnual: 0,
    capitalRatePctAnnual: 0,
    maintenancePerHour: 0,
    tiresPerHour: 0,
    fuelLitersPerHour: 0,
    mobilization: { mode: 'none' },
    base: base(),
    costsBase: base(),
    ...o,
  };
}

/** Equipo o servicio EXTERNO (alquilado o tercerizado). `ext` pisa las condiciones del proveedor. */
export function external(o = {}, ext = {}) {
  const { fiscal = {}, ...rest } = ext;
  return {
    id: o.id || nextId('x'),
    name: 'Servicio externo',
    acquisition: 'outsourced',
    quantity: 1,
    hoursPerActiveDay: null,
    mobilization: { mode: null },
    base: base(),
    ...o,
    external: {
      supplier: 'Proveedor',
      price: 0,
      unit: 'day',
      minimumUnits: 0,
      validUntil: '2026-12-31',
      operatorIncluded: true,
      fuelIncluded: true,
      insuranceIncluded: true,
      mobilizationIncluded: true,
      mobilizationAmount: 0,
      ...rest,
      fiscal: { vatPct: 21, vatRecoverable: 'yes', perceptionsPct: 0, nonRecoverablePct: 0, ...fiscal },
    },
  };
}

export function material(o = {}) {
  return { id: o.id || nextId('m'), description: 'Material', unit: 'unidad', basis: 'per_month', quantity: 1, unitCost: 0, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor', base: base(), ...o };
}

export function vehicle(o = {}) {
  return { id: o.id || nextId('v'), name: 'Camioneta de apoyo', count: 1, consumptionLPer100Km: 12, costPerKm: 80, ...o };
}

export function otherCost(o = {}) {
  return { id: o.id || nextId('o'), description: 'Otro costo', category: 'materials', behavior: 'fixed_monthly', amount: 0, ...o };
}

/** Impuestos sobre la facturación: número (un % total), lista de %, 'na' (no incluir) o null (sin definir). */
export function taxes(value) {
  if (value === 'na') return { mode: 'combined', notApplicable: true, combinedPct: null, items: [] };
  if (Array.isArray(value)) return { mode: 'detailed', notApplicable: false, combinedPct: null, items: value.map((pct, i) => ({ id: `tax-${i + 1}`, kind: ['gross_income', 'debits_credits', 'stamp', 'other'][i % 4], pct })) };
  if (value === null || value === undefined) return { mode: 'combined', notApplicable: false, combinedPct: null, items: [] };
  return { mode: 'combined', notApplicable: false, combinedPct: value, items: [] };
}

/**
 * Cotización de servicio. Cada bloque pisa (shallow) el de una cotización vacía.
 * @param {object} o { id, code, name, serviceType, unit, unitName, pricingMode, contractMonths, activity, labor,
 *   equipment, materials, materialsNotApplicable, otherCosts, fuel, logistics, indirect, finance, risk, pricing,
 *   billingTaxes, rules, currency, exchangeRates, offerDate }
 */
export function service(o = {}) {
  const id = o.id || nextId('q');
  const q = createEmptyQuote({ organizationId: LAB_ORG, settings: LAB_SETTINGS, now: LAB_NOW, id, code: o.code || id.toUpperCase(), baseName: 'Neuquén' });
  Object.assign(q, {
    name: o.name || id,
    serviceType: o.serviceType || 'on_call',
    unit: o.unit || 'day',
    unitName: o.unitName || '',
    pricingMode: o.pricingMode || 'known_activity',
    contractMonths: o.contractMonths ?? 12,
    illustrative: false,
    status: o.status || 'draft',
    offerDate: o.offerDate || '2026-10-16',
  });
  q.activity = { ...q.activity, activeDaysPerMonth: null, ...(o.activity || {}) };
  q.labor = o.labor || [];
  q.equipment = o.equipment || [];
  q.materials = o.materials || [];
  q.materialsNotApplicable = o.materialsNotApplicable ?? (o.materials ? false : true);
  q.otherCosts = o.otherCosts || [];
  q.fuel = { ...q.fuel, pricePerLiter: 1500, providedBy: 'contractor', illustrative: false, base: base(), ...(o.fuel || {}) };
  q.logistics = { ...q.logistics, notApplicable: true, ...(o.logistics || {}) };
  q.indirect = { method: 'percent_direct', pct: 10, amount: 0, ...(o.indirect || {}) };
  q.finance = { paymentTermDays: 60, invoiceLagDays: 15, monthlyRatePct: 3, payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 }, illustrative: false, ...(o.finance || {}) };
  q.risk = { generalPct: 3, items: [], ...(o.risk || {}) };
  q.pricing = { ...q.pricing, targetMarginPct: 10, roundingStep: 1000, knownRate: 0, offeredRateOverride: null, commercialDiscountPct: 0, ...(o.pricing || {}) };
  q.billingTaxes = o.billingTaxes === undefined ? taxes(5) : o.billingTaxes;
  q.rules = { ...q.rules, standbyNotApplicable: true, ...(o.rules || {}) };
  if (o.currency) q.currency = o.currency;
  if (o.exchangeRates) q.exchangeRates = o.exchangeRates;
  return q;
}

/** Ingrediente o material de un producto. */
export function ingredient(o = {}) {
  return { id: o.id || nextId('pm'), sourceId: null, description: 'Ingrediente', per: 'batch', unit: 'kg', useUnit: 'kg', quantity: 1, unitCost: 0, priceMode: 'unit', packPrice: null, packSize: null, wastePct: 0, base: base(), snapshot: null, illustrative: false, ...o };
}

/** Persona de un producto (minutos por tanda). */
export function worker(o = {}) {
  return { ...person({ id: o.id || nextId('pl'), role: 'Producción' }), people: 1, minutesPerBatch: 0, ...o };
}

/** Máquina de un producto (tenencia × % asignado + uso por tanda). */
export function machine(o = {}) {
  return { ...owned({ id: o.id || nextId('pe'), name: 'Máquina' }), minutesPerBatch: 0, energyPerHour: 0, fixedSharePct: null, external: null, ...o };
}

export function fixedCost(o = {}) {
  return { id: o.id || nextId('pf'), description: 'Gasto fijo', monthlyAmount: 0, sharePct: 100, ...o };
}

/** Producto. */
export function product(o = {}) {
  const id = o.id || nextId('p');
  const p = createEmptyProduct({ organizationId: LAB_ORG, settings: LAB_SETTINGS, now: LAB_NOW, id });
  Object.assign(p, {
    name: o.name || id,
    saleUnit: o.saleUnit || 'unidad',
    unitsPerBatch: o.unitsPerBatch ?? 1,
    lossPct: o.lossPct ?? 0,
    monthlyUnits: o.monthlyUnits ?? 1000,
    materials: o.materials || [],
    labor: o.labor || [],
    equipment: o.equipment || [],
    fixedCosts: o.fixedCosts || [],
    fuelPricePerLiter: o.fuelPricePerLiter ?? 1500,
    illustrative: false,
  });
  p.pricing = { ...p.pricing, targetMarginPct: 25, roundingStep: 10, vatPct: null, currentPrice: null, ...(o.pricing || {}) };
  p.billingTaxes = o.billingTaxes === undefined ? taxes('na') : o.billingTaxes;
  if (o.currency) p.currency = o.currency;
  if (o.exchangeRates) p.exchangeRates = o.exchangeRates;
  return p;
}
