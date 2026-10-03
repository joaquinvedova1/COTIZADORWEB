/**
 * Fábricas de entidades del dominio (cotizaciones y líneas).
 * Puras: reciben ids y fechas desde afuera cuando hace falta determinismo.
 */

import { createId } from '../core/ids.js';
import { deepClone } from '../core/object.js';
import { DEFAULT_VOLUME_TIERS } from '../engines/commercial-rules-engine.js';
import { RISK_ITEMS, ILLUSTRATIVE_AGREEMENT_PARAMS } from './catalogs.js';

/** Configuración por defecto de la organización (valores ILUSTRATIVOS). */
export function defaultSettings(organizationId = null) {
  return {
    organizationId,
    locale: 'es-AR',
    currency: 'ARS',
    fuelPricePerLiter: 1500,
    financeMonthlyRatePct: 3,
    defaultTargetMarginPct: 10,
    defaultContingencyPct: 5,
    defaultPaymentTermDays: 60,
    roundingStep: 1000,
    matrixDays: [5, 8, 10, 15, 20],
    marginLadder: [5, 10, 15],
    illustrative: true,
  };
}

export function defaultRiskItems() {
  return RISK_ITEMS.map((r) => ({ id: r.id, label: r.label, pct: 0, enabled: false }));
}

export function defaultVolumeTiers() {
  return DEFAULT_VOLUME_TIERS.map((t) => ({ ...t }));
}

/** Nueva cotización vacía con valores por defecto razonables. */
export function createEmptyQuote({ organizationId, settings = defaultSettings(), now = new Date().toISOString(), id = createId(), code = '' } = {}) {
  return {
    id,
    organizationId: organizationId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    code,
    name: 'Nueva cotización',
    client: '',
    status: 'draft',
    illustrative: false,
    serviceType: 'on_call',
    templateId: null,
    pricingMode: 'known_activity',
    unit: 'day',
    contractMonths: 12,
    activity: {
      availability: '24/7',
      availabilityWindow: '',
      responseTimeHours: 4,
      activeDaysPerMonth: 8,
      daysPerActivation: 1,
      availableDaysPerMonth: 30,
      hoursPerActiveDay: 10,
    },
    labor: [],
    equipment: [],
    materials: [],
    materialsNotApplicable: false,
    otherCosts: [],
    fuel: { pricePerLiter: settings.fuelPricePerLiter ?? 0, providedBy: 'contractor' },
    logistics: {
      notApplicable: false,
      baseName: '',
      destinationName: '',
      distanceKm: 0,
      roundTrip: true,
      tripsPerActivation: 1,
      vehicles: [],
      tollsPerActivation: 0,
      lodgingPerActivation: 0,
    },
    indirect: { method: 'percent_direct', pct: 0, amount: 0 },
    finance: {
      // Se usa el plazo por defecto de la configuración; si no hay, queda sin
      // definir y el Cost Completeness Score lo marca en rojo.
      paymentTermDays: Number.isFinite(settings.defaultPaymentTermDays) ? settings.defaultPaymentTermDays : null,
      invoiceLagDays: 15,
      monthlyRatePct: settings.financeMonthlyRatePct ?? 0,
      payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 },
    },
    risk: { generalPct: settings.defaultContingencyPct ?? 0, items: defaultRiskItems() },
    pricing: {
      targetMarginPct: settings.defaultTargetMarginPct ?? 10,
      customMarginPct: null,
      knownRate: 0,
      offeredRateOverride: null,
      commercialDiscountPct: 0,
      roundingStep: settings.roundingStep ?? 0,
    },
    rules: {
      availabilityFeeMonthly: 0,
      calloutFeePerActivation: 0,
      mobilizationFeePerActivation: 0,
      includedKmPerActivation: 0,
      extraKmRate: 0,
      minimumCallUnits: 0,
      standbyDaysPerMonth: 0,
      standbyRatePerDay: 0,
      standbyNotApplicable: false,
      volumeTiers: defaultVolumeTiers(),
      continuityMinMonths: 6,
      continuityDiscountPct: 0,
      minimumMonthlyGuarantee: 0,
    },
    notes: '',
  };
}

/** Línea de personal a partir de un perfil (copia de valores = auditabilidad). */
export function laborLineFromProfile(profile = {}, agreement = null, { id = createId() } = {}) {
  const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(agreement && agreement.params ? agreement.params : {}) };
  return {
    id,
    sourceId: profile.id ?? null,
    role: profile.role ?? 'Nuevo puesto',
    agreementId: profile.agreementId ?? (agreement ? agreement.id : null),
    category: profile.category ?? '',
    positions: 1,
    peoplePerPosition: 1,
    basicMonthly: profile.basicMonthly ?? 0,
    additionalsMonthly: profile.additionalsMonthly ?? 0,
    normalHoursPerMonth: profile.normalHoursPerMonth ?? params.normalHoursPerMonth,
    overtimeHoursPerActiveDay: profile.overtimeHoursPerActiveDay ?? 0,
    overtimePremiumPct: profile.overtimePremiumPct ?? params.overtimePremiumPct,
    mealPerActiveDay: profile.mealPerActiveDay ?? 0,
    sacPct: profile.sacPct ?? params.sacPct,
    vacationPct: profile.vacationPct ?? params.vacationPct,
    employerContributionsPct: profile.employerContributionsPct ?? params.employerContributionsPct,
    artPct: profile.artPct ?? params.artPct,
    insuranceMonthly: profile.insuranceMonthly ?? 0,
    ppeMonthly: profile.ppeMonthly ?? 0,
    trainingMonthly: profile.trainingMonthly ?? 0,
    transferMonthly: profile.transferMonthly ?? 0,
  };
}

/** Línea de equipo a partir de una ficha de biblioteca. */
export function equipmentLineFromLibrary(eq = {}, { id = createId(), hoursPerActiveDay = null } = {}) {
  return {
    id,
    sourceId: eq.id ?? null,
    name: eq.name ?? 'Nuevo equipo',
    quantity: 1,
    hoursPerActiveDay,
    replacementValue: eq.replacementValue ?? 0,
    usefulLifeYears: eq.usefulLifeYears ?? 0,
    residualValue: eq.residualValue ?? 0,
    insuranceAnnual: eq.insuranceAnnual ?? 0,
    licenseAnnual: eq.licenseAnnual ?? 0,
    certificationsAnnual: eq.certificationsAnnual ?? 0,
    capitalRatePctAnnual: eq.capitalRatePctAnnual ?? 0,
    maintenancePerHour: eq.maintenancePerHour ?? 0,
    tiresPerHour: eq.tiresPerHour ?? 0,
    fuelLitersPerHour: eq.fuelLitersPerHour ?? 0,
  };
}

/** Línea de material a partir de un ítem de biblioteca. */
export function materialLineFromLibrary(mat = {}, { id = createId() } = {}) {
  return {
    id,
    sourceId: mat.id ?? null,
    description: mat.description ?? 'Nuevo material',
    unit: mat.unit ?? 'unidad',
    basis: mat.basis ?? 'per_month',
    quantity: mat.quantity ?? 1,
    unitCost: mat.unitCost ?? 0,
    wastePct: mat.wastePct ?? 0,
    logisticsPct: mat.logisticsPct ?? 0,
    resaleMarkupPct: mat.resaleMarkupPct ?? 0,
    providedBy: mat.providedBy ?? null,
  };
}

export function createVehicle({ id = createId(), name = 'Vehículo', count = 1, consumptionLPer100Km = 0, costPerKm = 0 } = {}) {
  return { id, name, count, consumptionLPer100Km, costPerKm };
}

export function createOtherCost({ id = createId(), description = 'Otro costo', category = 'materials', behavior = 'fixed_monthly', amount = 0 } = {}) {
  return { id, description, category, behavior, amount };
}

/**
 * Crea una cotización desde una plantilla de servicio (biblioteca).
 * La plantilla aporta valores parciales que pisan los de una cotización vacía.
 */
export function createQuoteFromTemplate(template, { organizationId, settings, now, id = createId(), code = '' } = {}) {
  const base = createEmptyQuote({ organizationId, settings, now, id, code });
  if (!template) return base;
  const defaults = deepClone(template.defaults || {});
  const merged = {
    ...base,
    ...defaults,
    activity: { ...base.activity, ...(defaults.activity || {}) },
    fuel: { ...base.fuel, ...(defaults.fuel || {}) },
    logistics: { ...base.logistics, ...(defaults.logistics || {}) },
    indirect: { ...base.indirect, ...(defaults.indirect || {}) },
    finance: { ...base.finance, ...(defaults.finance || {}), payDays: { ...base.finance.payDays, ...((defaults.finance || {}).payDays || {}) } },
    risk: { ...base.risk, ...(defaults.risk || {}) },
    pricing: { ...base.pricing, ...(defaults.pricing || {}) },
    rules: { ...base.rules, ...(defaults.rules || {}) },
    id: base.id,
    organizationId: base.organizationId,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    code: base.code,
    status: 'draft',
    illustrative: false,
    templateId: template.id ?? null,
    serviceType: template.serviceType || defaults.serviceType || base.serviceType,
    name: defaults.name || template.name || base.name,
  };
  // Las líneas de la plantilla reciben ids nuevos para no compartir identidad.
  ['labor', 'equipment', 'materials', 'otherCosts'].forEach((k) => {
    merged[k] = (merged[k] || []).map((line) => ({ ...line, id: createId() }));
  });
  merged.logistics.vehicles = (merged.logistics.vehicles || []).map((v) => ({ ...v, id: createId() }));
  return merged;
}
