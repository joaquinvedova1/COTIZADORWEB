/**
 * Datos de demostración de RATEOS.
 *
 * ⚠ TODOS LOS VALORES SON ILUSTRATIVOS. No son escalas salariales, cargas
 * patronales, alícuotas, precios ni costos reales. No usar para cotizar
 * sin reemplazarlos por valores propios vigentes.
 *
 * Los ids son UUID fijos para que la demo sea determinística.
 */

import { AGREEMENT_TYPES, ILLUSTRATIVE_AGREEMENT_PARAMS } from './catalogs.js';
import { defaultSettings, defaultRiskItems, defaultVolumeTiers } from './quote-factory.js';
import { emptyBillingTaxes } from './billing-taxes.js';

export const DEMO_TIMESTAMP = '2026-10-01T12:00:00.000Z';
export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001';

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const DEMO_IDS = Object.freeze({
  org: DEMO_ORG_ID,
  quoteHydroCrane: uid(1001),
  quoteReference: uid(1002),
  templateHydroCrane: uid(2002),
  equipmentHydroCrane: uid(3003),
  equipmentPickup: uid(3001),
  profileOperator: uid(4001),
});

const meta = (id) => ({ id, organizationId: DEMO_ORG_ID, createdAt: DEMO_TIMESTAMP, updatedAt: DEMO_TIMESTAMP, createdBy: null, updatedBy: null });

export function demoOrganization() {
  return {
    ...meta(DEMO_ORG_ID),
    name: 'Patagonia Servicios SRL',
    baseLocation: 'Neuquén Capital',
    illustrative: true,
    notes: 'Empresa ficticia de demostración.',
  };
}

export function demoAgreements() {
  return AGREEMENT_TYPES.map((a, i) => ({
    ...meta(uid(100 + i)),
    code: a.code,
    name: a.label,
    illustrative: true,
    params: { ...ILLUSTRATIVE_AGREEMENT_PARAMS },
    notes: 'Parámetros GENÉRICOS e ILUSTRATIVOS, iguales para todos los convenios. Cargá los valores vigentes de tu CCT.',
  }));
}

const agreementId = (code) => uid(100 + AGREEMENT_TYPES.findIndex((a) => a.code === code));

export function demoLaborProfiles() {
  const p = ILLUSTRATIVE_AGREEMENT_PARAMS;
  const base = (n, role, code, category, basic, additionals, extra = {}) => ({
    ...meta(uid(n)),
    role,
    agreementId: agreementId(code),
    category,
    basicMonthly: basic,
    additionalsMonthly: additionals,
    normalHoursPerMonth: p.normalHoursPerMonth,
    overtimeHoursPerActiveDay: 0,
    overtimePremiumPct: p.overtimePremiumPct,
    mealPerActiveDay: 25000,
    sacPct: p.sacPct,
    vacationPct: p.vacationPct,
    employerContributionsPct: p.employerContributionsPct,
    artPct: p.artPct,
    insuranceMonthly: 30000,
    ppeMonthly: 40000,
    trainingMonthly: 25000,
    transferMonthly: 60000,
    illustrative: true,
    ...extra,
  });
  return [
    base(4001, 'Operador de hidrogrúa', 'petroleros_privados', 'Operador (ilustrativo)', 1800000, 400000, { overtimeHoursPerActiveDay: 4 }),
    base(4002, 'Chofer de camión', 'camioneros', 'Chofer (ilustrativo)', 1600000, 300000, { overtimeHoursPerActiveDay: 2 }),
    base(4003, 'Ayudante / oficial', 'uocra', 'Oficial (ilustrativo)', 1300000, 200000),
    base(4004, 'Supervisor de campo', 'petroleros_jerarquicos', 'Supervisor (ilustrativo)', 2600000, 600000),
    base(4005, 'Administrativo', 'fuera_convenio', 'Administración (ilustrativo)', 1400000, 0, { mealPerActiveDay: 0, transferMonthly: 0 }),
  ];
}

export function demoEquipment() {
  const eq = (n, name, type, v) => ({
    ...meta(uid(n)),
    name,
    type,
    currentValue: v.currentValue ?? v.replacementValue,
    replacementValue: v.replacementValue,
    usefulLifeYears: v.usefulLifeYears,
    residualValue: v.residualValue,
    insuranceAnnual: v.insuranceAnnual,
    licenseAnnual: v.licenseAnnual ?? 0,
    certificationsAnnual: v.certificationsAnnual ?? 0,
    capitalRatePctAnnual: 0,
    maintenancePerHour: v.maintenancePerHour,
    tiresPerHour: v.tiresPerHour ?? 0,
    fuelLitersPerHour: v.fuelLitersPerHour,
    availableHoursPerMonth: v.availableHoursPerMonth ?? 300,
    availableDaysPerMonth: v.availableDaysPerMonth ?? 30,
    utilizationPct: v.utilizationPct ?? 30,
    illustrative: true,
  });
  return [
    eq(3001, 'Pickup 4x4 (tipo Hilux)', 'vehicle', { replacementValue: 60000000, usefulLifeYears: 5, residualValue: 15000000, insuranceAnnual: 2400000, licenseAnnual: 1200000, certificationsAnnual: 300000, maintenancePerHour: 3000, tiresPerHour: 1500, fuelLitersPerHour: 3, utilizationPct: 50 }),
    eq(3002, 'Camión', 'truck', { replacementValue: 150000000, usefulLifeYears: 8, residualValue: 30000000, insuranceAnnual: 4800000, licenseAnnual: 2400000, certificationsAnnual: 1200000, maintenancePerHour: 9000, tiresPerHour: 4000, fuelLitersPerHour: 10, utilizationPct: 50 }),
    eq(3003, 'Hidrogrúa (camión con hidrogrúa)', 'crane_truck', { replacementValue: 250000000, usefulLifeYears: 10, residualValue: 50000000, insuranceAnnual: 6000000, licenseAnnual: 2400000, certificationsAnnual: 1800000, maintenancePerHour: 15000, tiresPerHour: 5000, fuelLitersPerHour: 12, utilizationPct: 27 }),
    eq(3004, 'Retroexcavadora', 'backhoe', { replacementValue: 180000000, usefulLifeYears: 10, residualValue: 36000000, insuranceAnnual: 3600000, certificationsAnnual: 900000, maintenancePerHour: 12000, tiresPerHour: 3000, fuelLitersPerHour: 11, utilizationPct: 40 }),
    eq(3005, 'Generador 100 kVA', 'generator', { replacementValue: 45000000, usefulLifeYears: 8, residualValue: 5000000, insuranceAnnual: 900000, maintenancePerHour: 2500, fuelLitersPerHour: 18, availableHoursPerMonth: 720, utilizationPct: 60 }),
    eq(3006, 'Compresor', 'compressor', { replacementValue: 30000000, usefulLifeYears: 8, residualValue: 3000000, insuranceAnnual: 600000, maintenancePerHour: 2000, fuelLitersPerHour: 8, utilizationPct: 40 }),
    eq(3007, 'Bomba', 'pump', { replacementValue: 25000000, usefulLifeYears: 7, residualValue: 2500000, insuranceAnnual: 500000, maintenancePerHour: 1800, fuelLitersPerHour: 6, availableHoursPerMonth: 720, utilizationPct: 50 }),
    eq(3008, 'Tráiler / semirremolque', 'trailer', { replacementValue: 40000000, usefulLifeYears: 12, residualValue: 8000000, insuranceAnnual: 800000, licenseAnnual: 600000, maintenancePerHour: 800, tiresPerHour: 1200, fuelLitersPerHour: 0, utilizationPct: 40 }),
    eq(3009, 'Grúa', 'crane', { replacementValue: 600000000, usefulLifeYears: 15, residualValue: 120000000, insuranceAnnual: 12000000, licenseAnnual: 3000000, certificationsAnnual: 4000000, maintenancePerHour: 35000, tiresPerHour: 8000, fuelLitersPerHour: 20, utilizationPct: 35 }),
    eq(3010, 'Herramientas especiales (kit)', 'tools', { replacementValue: 12000000, usefulLifeYears: 4, residualValue: 0, insuranceAnnual: 300000, maintenancePerHour: 500, fuelLitersPerHour: 0, utilizationPct: 40 }),
  ];
}

export function demoMaterials() {
  const m = (n, description, unit, unitCost, extra = {}) => ({
    ...meta(uid(n)),
    description,
    unit,
    unitCost,
    basis: 'per_month',
    quantity: 1,
    wastePct: 0,
    logisticsPct: 0,
    resaleMarkupPct: 0,
    providedBy: 'contractor',
    illustrative: true,
    ...extra,
  });
  return [
    m(5001, 'Eslingas, grilletes y elementos de izaje (reposición)', 'kit', 300000),
    m(5002, 'Consumibles menores por llamado', 'kit', 50000, { basis: 'per_activation' }),
    m(5003, 'Absorbentes y kit antiderrame', 'kit', 120000, { wastePct: 5 }),
    m(5004, 'Electrodos y gases de soldadura', 'kg', 18000, { quantity: 10, basis: 'per_active_day', wastePct: 10 }),
  ];
}

export function demoLocations() {
  return [
    { ...meta(uid(6001)), name: 'Neuquén Capital', type: 'base', distanceFromBaseKm: 0, illustrative: true },
    { ...meta(uid(6002)), name: 'Añelo', type: 'destination', distanceFromBaseKm: 110, illustrative: true },
  ];
}

/** Cotización demo principal: HIDROGRÚA ON-CALL — AÑELO. */
export function demoHydroCraneQuote() {
  const risk = defaultRiskItems().map((r) => {
    const enabled = { activity_variation: 2, unproductive: 1, weather: 1, equipment_failure: 1 };
    return r.id in enabled ? { ...r, pct: enabled[r.id], enabled: true } : r;
  });
  const tiers = defaultVolumeTiers().map((t) => ({ ...t, discountPct: { 'tier-3': 3, 'tier-4': 5, 'tier-5': 8 }[t.id] ?? 0 }));
  const p = ILLUSTRATIVE_AGREEMENT_PARAMS;
  return {
    ...meta(DEMO_IDS.quoteHydroCrane),
    code: 'COT-0001',
    name: 'Hidrogrúa on-call — Añelo',
    client: 'Operadora (ejemplo ilustrativo)',
    status: 'draft',
    illustrative: true,
    serviceType: 'on_call',
    templateId: DEMO_IDS.templateHydroCrane,
    pricingMode: 'known_activity',
    unit: 'day',
    contractMonths: 12,
    activity: {
      availability: '24/7',
      availabilityWindow: '',
      responseTimeHours: 4,
      activeDaysPerMonth: 8,
      daysPerActivation: 2,
      availableDaysPerMonth: 30,
      hoursPerActiveDay: 10,
    },
    labor: [
      {
        id: uid(7001),
        sourceId: DEMO_IDS.profileOperator,
        role: 'Operador de hidrogrúa',
        agreementId: agreementId('petroleros_privados'),
        category: 'Operador (ilustrativo)',
        positions: 1,
        peoplePerPosition: 1,
        basicMonthly: 1800000,
        additionalsMonthly: 400000,
        normalHoursPerMonth: p.normalHoursPerMonth,
        overtimeHoursPerActiveDay: 4,
        overtimePremiumPct: p.overtimePremiumPct,
        mealPerActiveDay: 25000,
        sacPct: p.sacPct,
        vacationPct: p.vacationPct,
        employerContributionsPct: p.employerContributionsPct,
        artPct: p.artPct,
        insuranceMonthly: 30000,
        ppeMonthly: 40000,
        trainingMonthly: 25000,
        transferMonthly: 60000,
      },
    ],
    equipment: [
      {
        id: uid(7101),
        sourceId: DEMO_IDS.equipmentHydroCrane,
        name: 'Hidrogrúa (camión con hidrogrúa)',
        quantity: 1,
        hoursPerActiveDay: 10,
        replacementValue: 250000000,
        usefulLifeYears: 10,
        residualValue: 50000000,
        insuranceAnnual: 6000000,
        licenseAnnual: 2400000,
        certificationsAnnual: 1800000,
        capitalRatePctAnnual: 0,
        maintenancePerHour: 15000,
        tiresPerHour: 5000,
        fuelLitersPerHour: 12,
      },
      {
        id: uid(7102),
        sourceId: DEMO_IDS.equipmentPickup,
        name: 'Vehículo de apoyo (pickup 4x4)',
        quantity: 1,
        hoursPerActiveDay: 4,
        replacementValue: 60000000,
        usefulLifeYears: 5,
        residualValue: 15000000,
        insuranceAnnual: 2400000,
        licenseAnnual: 1200000,
        certificationsAnnual: 300000,
        capitalRatePctAnnual: 0,
        maintenancePerHour: 3000,
        tiresPerHour: 1500,
        fuelLitersPerHour: 3,
      },
    ],
    materials: [
      { id: uid(7201), sourceId: uid(5001), description: 'Eslingas, grilletes y elementos de izaje (reposición)', unit: 'kit', basis: 'per_month', quantity: 1, unitCost: 300000, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor' },
      { id: uid(7202), sourceId: uid(5002), description: 'Consumibles menores por llamado', unit: 'kit', basis: 'per_activation', quantity: 1, unitCost: 50000, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor' },
      { id: uid(7203), sourceId: null, description: 'Carga a izar (la provee el cliente)', unit: 'unidad', basis: 'per_activation', quantity: 1, unitCost: 0, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'client' },
    ],
    materialsNotApplicable: false,
    otherCosts: [],
    fuel: { pricePerLiter: 1500, providedBy: 'contractor' },
    logistics: {
      notApplicable: false,
      baseName: 'Neuquén Capital',
      destinationName: 'Añelo',
      distanceKm: 110,
      roundTrip: true,
      tripsPerActivation: 1,
      vehicles: [
        { id: uid(7301), name: 'Hidrogrúa', count: 1, consumptionLPer100Km: 35, costPerKm: 150 },
        { id: uid(7302), name: 'Vehículo de apoyo', count: 1, consumptionLPer100Km: 12, costPerKm: 80 },
      ],
      tollsPerActivation: 0,
      lodgingPerActivation: 0,
    },
    indirect: { method: 'percent_direct', pct: 12, amount: 0 },
    finance: {
      paymentTermDays: 90,
      invoiceLagDays: 15,
      monthlyRatePct: 3,
      payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 },
    },
    risk: { generalPct: 0, items: risk },
    pricing: {
      targetMarginPct: 10,
      customMarginPct: 20,
      knownRate: 0,
      offeredRateOverride: null,
      commercialDiscountPct: 0,
      roundingStep: 1000,
    },
    // Sin definir a propósito: RATEOS no trae alícuotas (cada empresa carga
    // las suyas). La interfaz avisa que la tarifa piso no los incluye.
    billingTaxes: emptyBillingTaxes(),
    vatTreatment: 'excluded',
    rules: {
      availabilityFeeMonthly: 0,
      calloutFeePerActivation: 0,
      mobilizationFeePerActivation: 0,
      includedKmPerActivation: 0,
      extraKmRate: 0,
      minimumCallUnits: 1,
      standbyDaysPerMonth: 0,
      standbyRatePerDay: 0,
      standbyNotApplicable: false,
      volumeTiers: tiers,
      continuityMinMonths: 6,
      continuityDiscountPct: 0,
      minimumMonthlyGuarantee: 0,
    },
    notes: 'Cotización de demostración. TODOS los costos son ILUSTRATIVOS.',
  };
}

/** Caso de referencia del motor (golden case): fijos 30M, variable 1M/día, tarifa 4M/día → break-even 10 días. */
export function demoReferenceQuote() {
  return {
    ...demoHydroCraneQuote(),
    ...meta(DEMO_IDS.quoteReference),
    code: 'COT-0002',
    name: 'Ejemplo: tarifa que no cubre los costos (caso de referencia)',
    client: 'Cliente de ejemplo',
    serviceType: 'configurable',
    templateId: null,
    pricingMode: 'known_rate',
    unit: 'day',
    activity: { availability: 'window', availabilityWindow: 'Referencia', responseTimeHours: 0, activeDaysPerMonth: 8, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 10 },
    labor: [],
    equipment: [],
    materials: [],
    materialsNotApplicable: true,
    otherCosts: [
      { id: uid(7401), description: 'Costos fijos mensuales (referencia)', category: 'equipment', behavior: 'fixed_monthly', amount: 30000000 },
      { id: uid(7402), description: 'Costo variable por día activo (referencia)', category: 'labor', behavior: 'per_active_day', amount: 1000000 },
    ],
    fuel: { pricePerLiter: 0, providedBy: 'client' },
    logistics: { notApplicable: true, baseName: '', destinationName: '', distanceKm: 0, roundTrip: true, tripsPerActivation: 1, vehicles: [], tollsPerActivation: 0, lodgingPerActivation: 0 },
    indirect: { method: 'manual', pct: 0, amount: 0 },
    finance: { paymentTermDays: 0, invoiceLagDays: 0, monthlyRatePct: 0, payDays: { salaries: 0, fuel: 0, suppliers: 0, materials: 0, structure: 0 } },
    risk: { generalPct: 0, items: defaultRiskItems() },
    pricing: { targetMarginPct: 10, customMarginPct: null, knownRate: 4000000, offeredRateOverride: null, commercialDiscountPct: 0, roundingStep: 0 },
    rules: { ...demoHydroCraneQuote().rules, minimumCallUnits: 0, standbyNotApplicable: true, volumeTiers: defaultVolumeTiers() },
    notes: 'Caso de prueba del motor on-call: fijos 30.000.000, variable 1.000.000/día, tarifa 4.000.000/día → contribución 3.000.000/día, break-even 10 días. Valores ILUSTRATIVOS.',
  };
}

/** Plantillas de servicio (biblioteca). */
export function demoServiceTemplates() {
  const hydro = demoHydroCraneQuote();
  const strip = (q) => {
    // Los impuestos sobre la facturación son de la empresa, no de la plantilla.
    const { id, organizationId, createdAt, updatedAt, createdBy, updatedBy, code, status, client, illustrative, templateId, billingTaxes, vatTreatment, ...rest } = q;
    return rest;
  };
  const t = (n, name, serviceType, description, defaults = {}) => ({
    ...meta(uid(n)),
    name,
    serviceType,
    description,
    illustrative: true,
    defaults: { name, serviceType, ...defaults },
  });
  return [
    t(2001, 'Cuadrilla 24/7', 'permanent', 'Posiciones cubiertas en turnos rotativos con relevos.', { activity: { availability: '24/7', activeDaysPerMonth: 30, availableDaysPerMonth: 30, daysPerActivation: 14, hoursPerActiveDay: 12 }, unit: 'day', pricingMode: 'known_activity' }),
    { ...t(2002, 'Hidrogrúa on-call', 'on_call', 'Hidrogrúa con operador disponible 24/7, se activa por llamado.'), defaults: { ...strip(hydro), name: 'Hidrogrúa on-call' } },
    t(2003, 'Transporte', 'transport', 'Traslado de cargas entre base y locación.', { activity: { activeDaysPerMonth: 20, availableDaysPerMonth: 22, daysPerActivation: 1, hoursPerActiveDay: 9 } }),
    t(2004, 'Water Transfer', 'equipment_with_operator', 'Bombeo y transferencia de agua con equipo y operador.', { activity: { activeDaysPerMonth: 15, availableDaysPerMonth: 30, daysPerActivation: 5, hoursPerActiveDay: 12 } }),
    t(2005, 'Servicio ambiental', 'crew', 'Cuadrilla ambiental (limpieza, remediación).', { activity: { activeDaysPerMonth: 20, availableDaysPerMonth: 22, daysPerActivation: 5, hoursPerActiveDay: 9 } }),
    t(2006, 'Movimiento de suelo', 'equipment_with_operator', 'Retroexcavadora con operador.', { activity: { activeDaysPerMonth: 18, availableDaysPerMonth: 22, daysPerActivation: 6, hoursPerActiveDay: 9 } }),
    t(2007, 'Taller móvil', 'on_call', 'Unidad de taller móvil para mantenimiento en campo.', { activity: { activeDaysPerMonth: 10, availableDaysPerMonth: 30, daysPerActivation: 1, hoursPerActiveDay: 8 } }),
    t(2008, 'Inspección', 'crew', 'Inspecciones técnicas en locación.', { activity: { activeDaysPerMonth: 12, availableDaysPerMonth: 22, daysPerActivation: 2, hoursPerActiveDay: 8 } }),
    t(2009, 'Soldadura', 'crew', 'Soldadura en campo con equipo propio.', { activity: { activeDaysPerMonth: 15, availableDaysPerMonth: 22, daysPerActivation: 3, hoursPerActiveDay: 9 } }),
    t(2010, 'Mantenimiento', 'permanent', 'Mantenimiento preventivo y correctivo con personal asignado.', { activity: { activeDaysPerMonth: 22, availableDaysPerMonth: 22, daysPerActivation: 22, hoursPerActiveDay: 9 } }),
    t(2011, 'Generador', 'equipment_only', 'Alquiler de generador con mantenimiento incluido.', { activity: { activeDaysPerMonth: 30, availableDaysPerMonth: 30, daysPerActivation: 30, hoursPerActiveDay: 24 }, unit: 'day' }),
    t(2012, 'Camión con chofer', 'equipment_with_operator', 'Camión con chofer a disposición.', { activity: { activeDaysPerMonth: 20, availableDaysPerMonth: 22, daysPerActivation: 1, hoursPerActiveDay: 9 } }),
  ];
}

/** Estado inicial completo (formato de almacenamiento / backup). */
export function createDemoState(schemaVersion) {
  return {
    schemaVersion,
    organization: demoOrganization(),
    resources: {
      agreements: demoAgreements(),
      laborProfiles: demoLaborProfiles(),
      equipment: demoEquipment(),
      materials: demoMaterials(),
      locations: demoLocations(),
    },
    services: demoServiceTemplates(),
    quotes: [demoHydroCraneQuote(), demoReferenceQuote()],
    settings: { ...defaultSettings(DEMO_ORG_ID), illustrative: true },
  };
}
