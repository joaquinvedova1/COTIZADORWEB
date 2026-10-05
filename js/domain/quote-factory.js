/**
 * Fábricas de entidades del dominio (cotizaciones y líneas).
 * Puras: reciben ids y fechas desde afuera cuando hace falta determinismo.
 */

import { createId } from '../core/ids.js';
import { deepClone, isPlainObject } from '../core/object.js';
import { LOCALE, CURRENCY, DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../config.js';
import { RISK_ITEMS, ILLUSTRATIVE_AGREEMENT_PARAMS, DEFAULT_VOLUME_TIERS, DEFAULT_VAT_TREATMENT, ACQUISITION_MODES, EXTERNAL_UNITS, MOBILIZATION_MODES, DRIVER_OPTIONS, VAT_RECOVERY } from './catalogs.js';
import { emptyBillingTaxes, copyBillingTaxes, billingTaxesDecided } from './billing-taxes.js';
import { emptyBase, normalizeBase, isValidDayDate, isKnownCurrency, dayFromDate } from './economic-base.js';
import { familyIdOf } from './equipment-catalog.js';
import { createSnapshot } from './resource-snapshot.js';

/** Configuración por defecto de la organización (valores ILUSTRATIVOS). */
export function defaultSettings(organizationId = null) {
  return {
    organizationId,
    locale: LOCALE,
    currency: CURRENCY,
    fuelPricePerLiter: 1500,
    financeMonthlyRatePct: 3,
    defaultTargetMarginPct: 10,
    defaultContingencyPct: 5,
    defaultPaymentTermDays: 60,
    roundingStep: 1000,
    matrixDays: [...DEFAULT_MATRIX_DAYS],
    marginLadder: [...DEFAULT_MARGIN_LADDER],
    // Impuestos sobre la facturación de la empresa: sin definir (RATEOS no
    // trae alícuotas). Cuando la empresa los guarda, cada cotización nueva
    // arranca con ellos.
    defaultBillingTaxes: null,
    // Base del precio del combustible (PLAN-2026-005): sin definir hasta que la
    // empresa la cargue (nunca se inventa una fecha).
    fuelPriceBase: emptyBase({ currency: CURRENCY }),
    // Tipos de cambio de la empresa (con su base). RATEOS nunca los busca solo.
    exchangeRates: [],
    illustrative: true,
  };
}

// ------------------------------------------------- helpers de forma (PLAN-2026-005)

const ACQUISITION_IDS = ACQUISITION_MODES.map((a) => a.id);
const EXTERNAL_UNIT_IDS = EXTERNAL_UNITS.map((u) => u.id);
const MOBILIZATION_IDS = MOBILIZATION_MODES.map((m) => m.id);
const DRIVER_IDS = DRIVER_OPTIONS.map((d) => d.id);
const VAT_RECOVERY_IDS = VAT_RECOVERY.map((v) => v.id);

function finiteOr(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
const boolOrNull = (v) => (typeof v === 'boolean' ? v : null);
const shortText = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const idOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Moneda de la empresa (la de la configuración o la por defecto). */
export function companyCurrency(settings = {}) {
  return isPlainObject(settings) && isKnownCurrency(settings.currency) ? settings.currency : CURRENCY;
}

/** Cómo se obtiene un recurso (propio por defecto: lo que RATEOS siempre modeló). */
export function acquisitionOf(item = {}) {
  return isPlainObject(item) && ACQUISITION_IDS.includes(item.acquisition) ? item.acquisition : 'owned';
}

/** ¿Es un recurso externo (alquilado o tercerizado)? */
export function isExternal(item = {}) {
  return acquisitionOf(item) !== 'owned';
}

/**
 * Condiciones de un recurso EXTERNO (alquilado o tercerizado). Precio NETO
 * (sin IVA) en la moneda de su base. Las inclusiones son true | false | null
 * (sin definir). El tratamiento fiscal lo define la empresa: RATEOS no trae
 * alícuotas (vatPct null = sin definir).
 */
export function createExternalTerms(src = {}) {
  const s = isPlainObject(src) ? src : {};
  const f = isPlainObject(s.fiscal) ? s.fiscal : {};
  const opt = (v) => finiteOr(v, null);
  return {
    supplier: shortText(s.supplier),
    price: finiteOr(s.price, 0),
    unit: EXTERNAL_UNIT_IDS.includes(s.unit) ? s.unit : 'day',
    minimumUnits: opt(s.minimumUnits),
    validUntil: isValidDayDate(s.validUntil) ? s.validUntil : null,
    operatorIncluded: boolOrNull(s.operatorIncluded),
    fuelIncluded: boolOrNull(s.fuelIncluded),
    fuelLitersPerHour: finiteOr(s.fuelLitersPerHour, 0),
    mobilizationIncluded: boolOrNull(s.mobilizationIncluded),
    mobilizationAmount: finiteOr(s.mobilizationAmount, 0),
    insuranceIncluded: boolOrNull(s.insuranceIncluded),
    fiscal: {
      vatPct: opt(f.vatPct),
      vatRecoverable: VAT_RECOVERY_IDS.includes(f.vatRecoverable) ? f.vatRecoverable : null,
      vatRecoverablePct: opt(f.vatRecoverablePct),
      perceptionsPct: opt(f.perceptionsPct),
      nonRecoverablePct: opt(f.nonRecoverablePct),
      paymentTermDays: opt(f.paymentTermDays),
    },
  };
}

/**
 * Movilización de un equipo de la cotización: ¿cómo llega al lugar del
 * servicio? mode null = sin definir (no suma nada: así quedan las
 * cotizaciones anteriores, que cargaban los traslados como vehículos).
 */
export function createMobilization(src = {}) {
  const s = isPlainObject(src) ? src : {};
  return {
    mode: MOBILIZATION_IDS.includes(s.mode) ? s.mode : null,
    // Por sus propios medios: consumo en ruta y desgaste por km SIN combustible
    // ni amortización (la amortización ya está en el costo de tenerlo).
    travelLitersPer100Km: finiteOr(s.travelLitersPer100Km, 0),
    travelCostPerKm: finiteOr(s.travelCostPerKm, 0),
    driver: DRIVER_IDS.includes(s.driver) ? s.driver : null,
    carrierLineId: idOrNull(s.carrierLineId),
    supportVehicleId: idOrNull(s.supportVehicleId),
  };
}

/** Movilidad de una unidad de "Mis equipos" (legajo). */
export function createEquipmentMobility(src = {}) {
  const s = isPlainObject(src) ? src : {};
  return {
    selfPropelled: boolOrNull(s.selfPropelled),
    roadLegal: boolOrNull(s.roadLegal),
    requiresTransport: boolOrNull(s.requiresTransport),
    requiresDriver: boolOrNull(s.requiresDriver),
    speedKmh: finiteOr(s.speedKmh, null),
    travelLitersPer100Km: finiteOr(s.travelLitersPer100Km, 0),
    travelCostPerKm: finiteOr(s.travelCostPerKm, 0),
  };
}

/**
 * Movilización sugerida para un equipo nuevo en una cotización, según su
 * legajo: autopropulsado que circula por ruta → por sus propios medios;
 * necesita transporte → lo transporta otro equipo (hay que elegir cuál).
 * Sin datos → sin definir (la completitud lo pide).
 */
export function suggestedMobilization(mobility = {}) {
  const m = createEquipmentMobility(mobility);
  let mode = null;
  if (m.selfPropelled === true && m.roadLegal === true && m.requiresTransport !== true) mode = 'self';
  else if (m.requiresTransport === true) mode = 'transported';
  return createMobilization({
    mode,
    travelLitersPer100Km: m.travelLitersPer100Km,
    travelCostPerKm: m.travelCostPerKm,
    driver: mode === 'self' && m.requiresDriver !== false ? 'operator' : null,
  });
}

/** Tipos de cambio saneados: [{ currency, rate, base }] (sin duplicados ni la moneda de la empresa). */
export function normalizeExchangeRates(list, { currency = CURRENCY } = {}) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((r) => isPlainObject(r) && isKnownCurrency(r.currency) && r.currency !== currency)
    .filter((r) => (seen.has(r.currency) ? false : seen.add(r.currency)))
    .map((r) => ({ currency: r.currency, rate: finiteOr(r.rate, null), base: normalizeBase(r.base, { currency }) }));
}

/**
 * Impuestos sobre la facturación para una cotización nueva: los de la
 * empresa si ya los decidió (no dependen de que la configuración sea de
 * demostración: son un dato propio que cargó el usuario), si no, sin definir.
 */
export function billingTaxesForNewQuote(settings = {}) {
  const own = isPlainObject(settings) ? settings.defaultBillingTaxes : null;
  return billingTaxesDecided(own) ? copyBillingTaxes(own) : emptyBillingTaxes();
}

export function defaultRiskItems() {
  return RISK_ITEMS.map((r) => ({ id: r.id, label: r.label, pct: 0, enabled: false }));
}

export function defaultVolumeTiers() {
  return DEFAULT_VOLUME_TIERS.map((t) => ({ ...t }));
}

/**
 * Nueva cotización vacía.
 *
 * Los valores por defecto de una configuración ILUSTRATIVA (la demo) no se
 * dan por "definidos": el plazo de pago y la contingencia quedan sin cargar y
 * el precio de combustible se marca ilustrativo, para que el Cost
 * Completeness Score pida confirmarlos. La actividad estimada siempre queda
 * vacía: es un dato de cada cotización.
 */
export function createEmptyQuote({ organizationId, settings = defaultSettings(), now = new Date().toISOString(), id = createId(), code = '', baseName = '' } = {}) {
  const ownSettings = settings.illustrative !== true;
  const currency = companyCurrency(settings);
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
      activeDaysPerMonth: null,
      daysPerActivation: 1,
      availableDaysPerMonth: 30,
      hoursPerActiveDay: 10,
    },
    labor: [],
    equipment: [],
    materials: [],
    materialsNotApplicable: false,
    otherCosts: [],
    fuel: { pricePerLiter: settings.fuelPricePerLiter ?? 0, providedBy: 'contractor', illustrative: !ownSettings, base: { ...normalizeBase(settings.fuelPriceBase, { currency }), currency } },
    logistics: {
      notApplicable: false,
      // Origen de los viajes: la base operativa de la empresa (sólo texto;
      // la distancia la carga el usuario).
      baseName: typeof baseName === 'string' ? baseName.trim().slice(0, 120) : '',
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
      // Plazo por defecto sólo si la configuración es propia (no la demo); si
      // no, queda sin definir y el Cost Completeness Score lo marca en rojo.
      paymentTermDays: ownSettings && Number.isFinite(settings.defaultPaymentTermDays) ? settings.defaultPaymentTermDays : null,
      invoiceLagDays: 15,
      monthlyRatePct: settings.financeMonthlyRatePct ?? 0,
      // Tasa por defecto de una configuración de demostración: ILUSTRATIVA.
      illustrative: !ownSettings,
      payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 },
    },
    risk: { generalPct: ownSettings ? settings.defaultContingencyPct ?? 0 : 0, items: defaultRiskItems() },
    pricing: {
      targetMarginPct: settings.defaultTargetMarginPct ?? 10,
      customMarginPct: null,
      knownRate: 0,
      offeredRateOverride: null,
      commercialDiscountPct: 0,
      roundingStep: settings.roundingStep ?? 0,
    },
    // Impuestos sobre lo que se factura (Ingresos Brutos, débitos y créditos,
    // sellos…): gross-up junto con el margen. Ver js/domain/billing-taxes.js.
    billingTaxes: billingTaxesForNewQuote(settings),
    // Convención de montos de la cotización: sin IVA (explícita, no supuesta).
    vatTreatment: DEFAULT_VAT_TREATMENT,
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
    // Base económica de la oferta (PLAN-2026-005): moneda en la que calcula,
    // fecha de la oferta (base general) y tipos de cambio PROPIOS de la
    // cotización (copiados de Configuración; cambiar Configuración no los toca).
    currency,
    offerDate: dayFromDate(now),
    exchangeRates: normalizeExchangeRates(settings.exchangeRates, { currency }),
  };
}

/**
 * Línea de personal a partir de un perfil (copia de valores = auditabilidad).
 * La línea guarda la BASE del perfil y un SNAPSHOT (qué valores tenía el
 * perfil al copiarse): si después cambia el perfil, la cotización no cambia y
 * puede avisarlo (ver js/domain/resource-sync.js).
 */
export function laborLineFromProfile(profile = {}, agreement = null, { id = createId(), now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(agreement && agreement.params ? agreement.params : {}) };
  const line = {
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
    // Los sueldos se cargan en la moneda de la empresa.
    base: { ...normalizeBase(profile.base, { currency }), currency },
    snapshot: null,
    // Valores copiados de un perfil o convenio ILUSTRATIVO siguen marcados.
    illustrative: Boolean(profile.illustrative || (agreement && agreement.illustrative)),
  };
  line.snapshot = profile.id ? createSnapshot('laborProfiles', profile, line, { now }) : null;
  return line;
}

/** Campos de carga de mantenimiento y neumáticos (se copian tal cual; null = sin cargar). */
export const WEAR_INPUT_FIELDS = Object.freeze([
  'maintenanceMode', 'maintenanceServiceCost', 'maintenanceServiceHours', 'maintenanceBudget', 'maintenanceBudgetPeriod',
  'tiresMode', 'tiresSetCost', 'tiresLifeHours', 'tiresLifeKm',
]);

export function wearInputsOf(eq = {}) {
  const e = eq && typeof eq === 'object' ? eq : {};
  return Object.fromEntries(WEAR_INPUT_FIELDS.map((k) => [k, e[k] ?? null]));
}

/**
 * Línea de equipo a partir de una unidad de "Mis equipos" (legajo).
 * Propio: valores de posesión y operación. Alquilado / tercerizado: sus
 * condiciones externas (tarifa, inclusiones, fiscal). En ambos casos la
 * movilización se sugiere desde la movilidad del legajo (editable).
 */
export function equipmentLineFromLibrary(eq = {}, { id = createId(), hoursPerActiveDay = null, now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const acquisition = acquisitionOf(eq);
  const line = {
    id,
    sourceId: eq.id ?? null,
    name: eq.name ?? 'Nuevo equipo',
    internalCode: shortText(eq.internalCode, 40),
    familyId: eq.id || eq.familyId || eq.type ? familyIdOf(eq) : null,
    acquisition,
    quantity: 1,
    hoursPerActiveDay,
    replacementValue: eq.replacementValue ?? 0,
    usefulLifeYears: eq.usefulLifeYears ?? 0,
    residualValue: eq.residualValue ?? 0,
    insuranceAnnual: eq.insuranceAnnual ?? 0,
    licenseAnnual: eq.licenseAnnual ?? 0,
    certificationsAnnual: eq.certificationsAnnual ?? 0,
    otherAnnual: eq.otherAnnual ?? 0,
    capitalRatePctAnnual: eq.capitalRatePctAnnual ?? 0,
    maintenancePerHour: eq.maintenancePerHour ?? 0,
    tiresPerHour: eq.tiresPerHour ?? 0,
    fuelLitersPerHour: eq.fuelLitersPerHour ?? 0,
    // Cómo se cargaron mantenimiento y neumáticos (PLAN-2026-007; sin modo = por hora).
    ...wearInputsOf(eq),
    external: acquisition === 'owned' ? null : createExternalTerms(eq.external),
    // Base del VALOR (reposición / residual, puede estar en otra moneda) y base
    // de los costos de tenerlo y usarlo (en la moneda de la empresa). Para un
    // externo, base es la de su tarifa.
    base: normalizeBase(eq.base, { currency }),
    costsBase: { ...normalizeBase(eq.costsBase, { currency }), currency },
    mobilization: suggestedMobilization(eq.mobility),
    operatorLaborId: null,
    snapshot: null,
    illustrative: Boolean(eq.illustrative),
  };
  line.snapshot = eq.id ? createSnapshot('equipment', eq, line, { now }) : null;
  return line;
}

/**
 * Línea de equipo o servicio EXTERNO a partir de una oferta de "Servicios
 * externos" (proveedor): alquilado o tercerizado, sin activo propio.
 */
export function externalLineFromService(service = {}, { id = createId(), hoursPerActiveDay = null, now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const acquisition = acquisitionOf(service) === 'owned' ? 'outsourced' : acquisitionOf(service);
  const line = {
    ...equipmentLineFromLibrary({ name: service.name ?? 'Servicio externo', familyId: service.familyId || 'other', acquisition, external: service.external, base: service.base }, { id, hoursPerActiveDay, now, currency }),
    sourceId: service.id ?? null,
    familyId: service.familyId || null,
    illustrative: Boolean(service.illustrative),
  };
  line.mobilization = createMobilization({});
  line.snapshot = service.id ? createSnapshot('externalServices', service, line, { now }) : null;
  return line;
}

/** Equipo nuevo en blanco (propio, alquilado o tercerizado). */
export function blankEquipmentLine({ acquisition = 'owned', id = createId(), hoursPerActiveDay = null, currency = CURRENCY } = {}) {
  const mode = ACQUISITION_IDS.includes(acquisition) ? acquisition : 'owned';
  const line = equipmentLineFromLibrary({ acquisition: mode }, { id, hoursPerActiveDay, currency });
  line.name = mode === 'owned' ? 'Nuevo equipo' : mode === 'rented' ? 'Equipo alquilado' : 'Servicio tercerizado';
  line.familyId = null;
  return line;
}

/** Línea de material a partir de un ítem de biblioteca. */
export function materialLineFromLibrary(mat = {}, { id = createId(), now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const line = {
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
    base: normalizeBase(mat.base, { currency }),
    snapshot: null,
    illustrative: Boolean(mat.illustrative),
  };
  line.snapshot = mat.id ? createSnapshot('materials', mat, line, { now }) : null;
  return line;
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
export function createQuoteFromTemplate(template, { organizationId, settings, now, id = createId(), code = '', baseName = '' } = {}) {
  const base = createEmptyQuote({ organizationId, settings, now, id, code, baseName });
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
    // La plantilla sólo pisa los impuestos de la empresa si trae una decisión propia.
    billingTaxes: billingTaxesDecided(defaults.billingTaxes) ? copyBillingTaxes(defaults.billingTaxes) : base.billingTaxes,
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
    // La base económica de la oferta es de la cotización nueva, no de la plantilla.
    currency: base.currency,
    offerDate: base.offerDate,
    exchangeRates: base.exchangeRates,
  };
  // Las líneas de la plantilla reciben ids nuevos para no compartir identidad
  // y, si la plantilla es ILUSTRATIVA, siguen marcadas como ilustrativas hasta
  // que el usuario confirme valores propios.
  const fromIllustrative = template.illustrative === true;
  // Ids nuevos, recordando el viejo → nuevo para no romper las referencias
  // entre líneas (quién opera un equipo, quién lo transporta, en qué vehículo va).
  const idMap = new Map();
  const mark = (line) => {
    const id = createId();
    if (typeof line.id === 'string') idMap.set(line.id, id);
    return { ...line, id, illustrative: Boolean(line.illustrative || fromIllustrative) };
  };
  ['labor', 'equipment', 'materials', 'otherCosts'].forEach((k) => {
    merged[k] = (Array.isArray(merged[k]) ? merged[k] : []).filter(isPlainObject).map(mark);
  });
  merged.logistics.vehicles = (Array.isArray(merged.logistics.vehicles) ? merged.logistics.vehicles : []).filter(isPlainObject).map(mark);
  const remap = (id) => (typeof id === 'string' && idMap.has(id) ? idMap.get(id) : null);
  merged.equipment = merged.equipment.map((e) => ({
    ...e,
    operatorLaborId: remap(e.operatorLaborId),
    mobilization: isPlainObject(e.mobilization)
      ? { ...e.mobilization, carrierLineId: remap(e.mobilization.carrierLineId), supportVehicleId: remap(e.mobilization.supportVehicleId) }
      : e.mobilization,
  }));
  if (fromIllustrative && isPlainObject(defaults.fuel) && defaults.fuel.pricePerLiter !== undefined) {
    merged.fuel = { ...merged.fuel, illustrative: true };
  }
  if (fromIllustrative && isPlainObject(defaults.finance) && defaults.finance.monthlyRatePct !== undefined) {
    merged.finance = { ...merged.finance, illustrative: true };
  }
  return merged;
}

/**
 * ¿La cotización tiene valores ILUSTRATIVOS? (demo, plantillas o recursos de
 * biblioteca de demostración). Se usa para badges y avisos en la interfaz.
 * @returns {{ any: boolean, quote: boolean, lines: number, fuel: boolean, finance: boolean }}
 */
export function illustrativeInfo(quote = {}) {
  const lists = ['labor', 'equipment', 'materials', 'otherCosts'].map((k) => (Array.isArray(quote[k]) ? quote[k] : []));
  const vehicles = quote.logistics && Array.isArray(quote.logistics.vehicles) ? quote.logistics.vehicles : [];
  const lines = [...lists.flat(), ...vehicles].filter((l) => isPlainObject(l) && l.illustrative === true).length;
  const fuel = Boolean(quote.fuel && quote.fuel.illustrative === true);
  const finance = Boolean(quote.finance && quote.finance.illustrative === true);
  const whole = quote.illustrative === true;
  return { any: whole || lines > 0 || fuel || finance, quote: whole, lines, fuel, finance };
}
