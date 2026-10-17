/**
 * RATEOS Test Lab — GENERADOR de escenarios con seed (campaña extendida,
 * PLAN-2026-013).
 *
 * Combinaciones "de a pares" (pairwise) de los factores categóricos (tipo de
 * servicio, unidad, personal, equipos propios y externos, combustible, IVA,
 * movilización, logística, materiales, estructura, impuestos, reglas…) y
 * valores numéricos sorteados con un PRNG con seed. Mismo seed = misma
 * campaña. Un 15 % de los escenarios lleva valores extremos (0 días, 100 %,
 * margen 0, cantidades fraccionarias, tarifa bajo costo, descuentos altos).
 * Datos SINTÉTICOS.
 */

import { createRng, pairwise, seedOf } from '../lib/rng.js';
import { service, person, owned, external, material, vehicle, otherCost, taxes, base, resetIds } from '../lib/build.js';
import { SERVICE_TYPES } from '../../../js/domain/catalogs.js';
import { SERVICE_TYPE_UNITS } from '../../../js/domain/billing-units.js';

const FACTORS = {
  serviceType: SERVICE_TYPES.map((t) => t.id),
  unitSlot: [0, 1, 2, 3],
  pricingMode: ['known_activity', 'known_rate'],
  labor: ['none', 'single', 'relief', 'overtime', 'shared', 'hired'],
  owned: ['none', 'per_hour', 'service_tires_hours', 'budget_tires_km', 'shared'],
  externalUnit: ['none', 'hour', 'day', 'month', 'trip', 'km', 'activation', 'global'],
  externalFuel: ['included', 'per_hour', 'per_100km', 'km_per_liter'],
  externalVat: ['yes', 'no', 'partial', 'undefined'],
  externalExtra: ['none', 'minimum', 'mobilization', 'supplier_days'],
  mobility: ['none', 'self', 'transported', 'support'],
  logistics: ['no_travel', 'roundtrip', 'oneway', 'vehicles'],
  materials: ['none', 'per_month', 'per_active_day', 'per_activation_client', 'per_activation_third'],
  structure: ['percent_direct', 'percent_labor', 'per_employee', 'per_contract', 'per_hour', 'manual', 'detailed'],
  taxes: ['undefined', 'combined', 'detailed', 'na'],
  rules: ['none', 'minimum_call', 'standby_callout', 'fees_extra_km', 'guarantee', 'discounts'],
  fuelProvider: ['contractor', 'client'],
  fullActivations: [false, true],
  currency: ['ARS', 'USD'],
  // PLAN-2026-014: equipo propio que no usa combustible (LAB-D5) y menos de una salida por mes (LAB-D1).
  ownedFuel: ['consumes', 'no_fuel'],
  activations: ['normal', 'below_one'],
};

const EXTERNAL_PRICE = { hour: [30000, 500000, 1000], day: [150000, 900000, 1000], month: [1000000, 10000000, 10000], trip: [50000, 1500000, 1000], km: [500, 5000, 10], activation: [50000, 800000, 1000], global: [2000000, 20000000, 10000] };

/** Arma un escenario a partir de una combinación de factores y su propio seed. */
function buildGenerated(combo, seed, { edge = false } = {}) {
  const rng = createRng(seed);
  resetIds();
  const units = SERVICE_TYPE_UNITS[combo.serviceType] || ['day'];
  const unit = combo.serviceType === 'configurable' && combo.unitSlot === 3 ? 'custom' : units[combo.unitSlot % units.length];
  const kind = ['day', 'hour', 'month'].includes(unit) ? unit : ['call', 'job', 'milestone'].includes(unit) ? 'event' : 'quantity';
  let dpa = rng.pick([1, 1, 1, 2, 3, 1.5]);
  const available = rng.pick([30, 30, 22, 26]);
  let D = rng.int(2, Math.min(available, 26));
  // Menos de una salida por mes: cada salida dura más que los días de trabajo del mes.
  if (combo.activations === 'below_one') dpa = D + rng.pick([1, 3, 10]);
  const hours = rng.pick([6, 8, 9, 10, 12]);
  const activity = { daysPerActivation: dpa, availableDaysPerMonth: available, hoursPerActiveDay: hours, fullActivations: combo.fullActivations };
  if (edge) D = rng.pick([0, available, 0.1, D + 0.37]);
  if (kind === 'quantity') {
    const r = rng.pick([0.5, 2, 15, 60, 120, 400, 87.3]);
    activity.unitsPerActiveDay = r;
    activity.billableQuantityPerMonth = Math.round(D * r * 100) / 100;
  } else if (kind === 'event') {
    activity.billableQuantityPerMonth = Math.max(0, Math.round(D / dpa)) || (edge ? 0 : 1);
    if (unit === 'milestone') activity.unitsPerActivation = rng.pick([1, 2, 3]);
  } else {
    activity.activeDaysPerMonth = D;
  }

  const labor = [];
  const basic = () => rng.money(1200000, 3000000, 10000);
  if (combo.labor !== 'none') {
    labor.push(person({ id: 'g-op', role: 'Operador', basicMonthly: basic(), mealPerActiveDay: rng.pick([0, 15000, 25000]) }));
    if (combo.labor === 'relief') labor[0].peoplePerPosition = rng.pick([2, 3]);
    if (combo.labor === 'overtime') labor[0].overtime = [{ id: 'g50', premiumPct: 50, hours: rng.pick([1, 2, 3]), basis: 'per_active_day', billRatePerHour: 0 }, { id: 'g100', premiumPct: 100, hours: rng.pick([4, 8]), basis: 'per_month', billRatePerHour: 0 }];
    if (combo.labor === 'shared') Object.assign(labor[0], { assignment: 'shared', fixedCostSharePct: rng.pick([20, 25, 40, 60]) });
    if (combo.labor === 'hired') labor[0].assignment = 'hired';
    if (rng.chance(0.4)) labor.push(person({ role: 'Ayudante', positions: rng.int(1, 3), basicMonthly: basic() }));
  }

  const equipment = [];
  const mobilization = () => {
    if (combo.mobility === 'self') return { mode: 'self', travelLitersPer100Km: rng.pick([12, 30, 38]), travelCostPerKm: rng.pick([80, 150, 300]), driver: labor.length ? 'operator' : 'other' };
    if (combo.mobility === 'transported') return { mode: 'transported', carrierLineId: 'g-carrier' };
    if (combo.mobility === 'support') return { mode: 'support', supportVehicleId: 'g-veh' };
    return { mode: 'none' };
  };
  if (combo.owned !== 'none') {
    const e = owned({
      id: 'g-own', name: 'Equipo propio generado', replacementValue: rng.money(10000000, 300000000, 100000), usefulLifeYears: rng.pick([5, 8, 10, 15]), residualValue: 0,
      insuranceAnnual: rng.money(0, 6000000, 10000), licenseAnnual: rng.money(0, 2400000, 10000), capitalRatePctAnnual: rng.pick([0, 0, 8]), fuelLitersPerHour: rng.pick([0, 4, 12, 18]),
      operatorLaborId: labor.length ? 'g-op' : null, mobilization: mobilization(),
      base: combo.currency === 'USD' ? base('USD') : base('ARS'),
    });
    if (combo.currency === 'USD') e.replacementValue = Math.round(e.replacementValue / 1000);
    if (combo.owned === 'per_hour') Object.assign(e, { maintenancePerHour: rng.money(1000, 20000, 100), tiresPerHour: rng.money(0, 5000, 100) });
    if (combo.owned === 'service_tires_hours') Object.assign(e, { maintenanceMode: 'service', maintenanceServiceCost: rng.money(200000, 900000, 1000), maintenanceServiceHours: rng.pick([250, 500]), tiresMode: 'set_hours', tiresSetCost: rng.money(800000, 4000000, 1000), tiresLifeHours: rng.pick([2000, 3000]) });
    if (combo.owned === 'budget_tires_km') Object.assign(e, { maintenanceMode: 'budget', maintenanceBudget: rng.money(1000000, 6000000, 1000), maintenanceBudgetPeriod: rng.pick(['month', 'year']), tiresMode: 'set_km', tiresSetCost: rng.money(2000000, 6000000, 1000), tiresLifeKm: rng.pick([80000, 120000]) });
    if (combo.owned === 'shared') Object.assign(e, { maintenancePerHour: rng.money(1000, 20000, 100), assignment: 'shared', fixedCostSharePct: rng.pick([30, 50, 70]) });
    if (combo.ownedFuel === 'no_fuel') e.fuelNotApplicable = true;
    equipment.push(e);
  }
  if (combo.externalUnit !== 'none') {
    const [lo, hi, step] = EXTERNAL_PRICE[combo.externalUnit];
    const fuelIncluded = combo.externalFuel === 'included';
    const fiscal = combo.externalVat === 'undefined' ? { vatPct: null, vatRecoverable: null } : { vatPct: 21, vatRecoverable: combo.externalVat, vatRecoverablePct: combo.externalVat === 'partial' ? rng.pick([30, 50]) : null, perceptionsPct: rng.pick([0, 0, 3]) };
    const x = external({
      id: combo.mobility === 'transported' ? 'g-carrier' : 'g-ext', name: 'Externo generado', acquisition: rng.pick(['rented', 'outsourced']), quantity: rng.pick([1, 1, 2]),
      supplierPayDays: combo.externalExtra === 'supplier_days' ? rng.pick([0, 15, 45, 90]) : null,
    }, {
      price: rng.money(lo, hi, step), unit: combo.externalUnit, minimumUnits: combo.externalExtra === 'minimum' ? rng.pick([2, 4, 8]) : 0,
      fuelIncluded, fuelMode: fuelIncluded ? undefined : combo.externalFuel, fuelLitersPerHour: combo.externalFuel === 'per_hour' ? rng.pick([5, 9, 16]) : 0,
      fuelLitersPer100Km: combo.externalFuel === 'per_100km' ? rng.pick([25, 35, 40]) : null, fuelKmPerLiter: combo.externalFuel === 'km_per_liter' ? rng.pick([2.5, 3, 8]) : null,
      mobilizationIncluded: combo.externalExtra !== 'mobilization', mobilizationAmount: combo.externalExtra === 'mobilization' ? rng.money(50000, 400000, 1000) : 0,
      fiscal,
    });
    if (combo.currency === 'USD' && rng.chance(0.3)) { x.base = base('USD'); x.external.price = Math.max(1, Math.round(x.external.price / 1000)); }
    equipment.push(x);
  }

  const logisticsShape = combo.logistics;
  const logistics = logisticsShape === 'no_travel'
    ? { notApplicable: true }
    : {
      notApplicable: false, baseName: 'Base', destinationName: 'Locación', distanceKm: rng.pick([10, 45, 100, 160, 300, 33.3]), roundTrip: logisticsShape !== 'oneway', tripsPerActivation: rng.pick([1, 1, 2]),
      vehicles: logisticsShape === 'vehicles' || combo.mobility === 'support' ? [vehicle({ id: 'g-veh', name: 'Camioneta de apoyo' })] : [], tollsPerActivation: rng.pick([0, 0, 8000]), lodgingPerActivation: rng.pick([0, 0, 120000]),
    };

  const materials = [];
  if (combo.materials !== 'none') {
    const basis = combo.materials.startsWith('per_activation') ? 'per_activation' : combo.materials;
    materials.push(material({ description: 'Material generado', basis, quantity: rng.pick([1, 5, 12.5]), unitCost: rng.money(2000, 300000, 100), wastePct: rng.pick([0, 5]), logisticsPct: rng.pick([0, 3]), providedBy: combo.materials.endsWith('client') ? 'client' : combo.materials.endsWith('third') ? 'third_party' : 'contractor', base: combo.currency === 'USD' && rng.chance(0.3) ? base('USD') : base('ARS') }));
    if (materials[0].base.currency === 'USD') materials[0].unitCost = Math.max(1, Math.round(materials[0].unitCost / 1000));
  }
  const otherCosts = rng.chance(0.3) ? [otherCost({ description: 'Otro costo generado', category: rng.pick(['labor', 'equipment', 'fuel', 'materials', 'logistics', 'structure']), behavior: rng.pick(['fixed_monthly', 'per_active_day', 'per_activation']), amount: rng.money(10000, 900000, 1000) })] : [];

  const structure = combo.structure === 'detailed'
    ? { mode: 'detailed', method: 'percent_direct', pct: 0, amount: 0, items: [{ id: 's1', label: 'Administración', method: 'percent_direct', pct: rng.pick([5, 8, 10]) }, { id: 's2', label: 'HSE', method: 'per_employee', amount: rng.money(50000, 200000, 1000) }, { id: 's3', label: 'Seguros', method: 'per_contract', amount: rng.money(100000, 600000, 1000) }] }
    : { method: combo.structure, pct: rng.pick([5, 8, 10, 15]), amount: combo.structure === 'per_hour' ? rng.money(1000, 8000, 100) : rng.money(50000, 900000, 1000) };

  const tax = { undefined: null, combined: rng.pick([3, 4.5, 5, 7]), detailed: [rng.pick([3, 3.5]), rng.pick([0.6, 1.2])], na: 'na' }[combo.taxes];
  const rules = { standbyNotApplicable: true };
  if (combo.rules === 'minimum_call') rules.minimumCallUnits = kind === 'hour' ? hours + rng.pick([1, 2]) : kind === 'quantity' ? Math.ceil((activity.unitsPerActiveDay || 1) * dpa * 1.5) : dpa + 1;
  if (combo.rules === 'standby_callout') Object.assign(rules, { standbyNotApplicable: false, standbyDaysPerMonth: rng.pick([1, 2, 4]), standbyRatePerDay: rng.money(100000, 500000, 1000), calloutFeePerActivation: rng.money(50000, 300000, 1000) });
  if (combo.rules === 'fees_extra_km') Object.assign(rules, { mobilizationFeePerActivation: rng.money(50000, 300000, 1000), includedKmPerActivation: rng.pick([0, 100]), extraKmRate: rng.money(500, 2000, 10), availabilityFeeMonthly: rng.money(0, 2000000, 1000) });
  if (combo.rules === 'guarantee') rules.minimumMonthlyGuarantee = rng.money(5000000, 40000000, 10000);
  if (combo.rules === 'discounts') Object.assign(rules, { volumeTiers: [{ id: 'g1', fromDays: 1, toDays: 7, discountPct: 0 }, { id: 'g2', fromDays: 8, toDays: 15, discountPct: rng.pick([2, 3]) }, { id: 'g3', fromDays: 16, toDays: null, discountPct: rng.pick([5, 8]) }], continuityMinMonths: 6, continuityDiscountPct: rng.pick([0, 2, 3]) });

  const margin = edge ? rng.pick([0, 0, 35, 49]) : rng.pick([5, 10, 12, 15, 20, 25, 30]);
  const pricing = { targetMarginPct: margin, roundingStep: rng.pick([0, 100, 1000, 10000]), commercialDiscountPct: combo.rules === 'discounts' ? rng.pick([0, 2, 5, edge ? 35 : 0]) : 0, knownRate: 0 };
  return service({
    id: `gen-${seed}`, code: `GEN-${seed}`, serviceType: combo.serviceType, unit, unitName: unit === 'custom' ? 'pozo' : '', pricingMode: combo.pricingMode, contractMonths: rng.pick([1, 6, 12, 24]),
    activity, labor, equipment, materials, materialsNotApplicable: combo.materials === 'none', otherCosts,
    fuel: { providedBy: combo.fuelProvider, pricePerLiter: rng.money(1100, 1900, 10) },
    logistics, indirect: structure,
    finance: { paymentTermDays: rng.pick([0, 30, 60, 90, 120]), invoiceLagDays: rng.pick([0, 15, 30]), monthlyRatePct: rng.pick([0, 2, 3, 4.5]) },
    risk: { generalPct: rng.pick([0, 2, 3, 5]), items: rng.chance(0.3) ? [{ id: 'weather', label: 'Clima', pct: rng.pick([1, 2]), enabled: true }] : [] },
    pricing, billingTaxes: taxes(tax), rules,
    exchangeRates: combo.currency === 'USD' ? [{ currency: 'USD', rate: rng.pick([950, 1000, 1200]), base: base('ARS') }] : [],
  });
}

/** Precio conocido razonable (sin calcular con el motor): sueldos + equipos ≈ costo, ×(0,6–1,6). */
function knownRateFor(q, rng) {
  const days = Math.max(1, Number(q.activity.activeDaysPerMonth) || 10);
  const roughCost = (q.labor.reduce((s, l) => s + Number(l.basicMonthly || 0) * 1.6 * (Number(l.positions || 1) * Number(l.peoplePerPosition || 1)), 0) + 4000000) * rng.real(0.6, 1.6, 2);
  return Math.round(roughCost / days / 1000) * 1000 || 100000;
}

/**
 * Campaña generada: { id, title, family, combo, build } por escenario.
 * @param {{ seed?: number, count?: number }} options
 */
export function generateScenarios({ seed = 20261016, count = 120 } = {}) {
  const rng = createRng(seed);
  const rows = pairwise(FACTORS, rng);
  const combos = [...rows];
  while (combos.length < count) combos.push(Object.fromEntries(Object.entries(FACTORS).map(([k, v]) => [k, rng.pick(v)])));
  return combos.slice(0, Math.max(count, 1)).map((combo, n) => {
    const scenarioSeed = seedOf(`${seed}:${n}`);
    const edge = n >= rows.length ? createRng(scenarioSeed ^ 0x9e3779b9).chance(0.15) : false;
    const title = `${combo.serviceType} · ${combo.unitSlot} · ${combo.pricingMode} · personal ${combo.labor} · propio ${combo.owned} · externo ${combo.externalUnit}/${combo.externalFuel}/${combo.externalVat}/${combo.externalExtra} · mov. ${combo.mobility} · ${combo.logistics} · mat. ${combo.materials} · estr. ${combo.structure} · imp. ${combo.taxes} · reglas ${combo.rules} · comb. ${combo.fuelProvider}${combo.ownedFuel === 'no_fuel' ? ' · propio sin combustible' : ''}${combo.activations === 'below_one' ? ' · menos de 1 salida' : ''}${combo.fullActivations ? ' · salidas completas' : ''}${combo.currency !== 'ARS' ? ' · USD' : ''}${edge ? ' · EXTREMO' : ''}`;
    return {
      id: `GEN-${seed}-${String(n + 1).padStart(3, '0')}`,
      seed: scenarioSeed,
      title,
      family: combo.serviceType,
      combo,
      edge,
      pairwise: n < rows.length,
      build: () => {
        const q = buildGenerated(combo, scenarioSeed, { edge });
        if (q.pricingMode === 'known_rate') q.pricing.knownRate = knownRateFor(q, createRng(scenarioSeed ^ 0x51ed27));
        return q;
      },
    };
  });
}

export { FACTORS };
