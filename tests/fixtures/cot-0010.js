/**
 * Casos de prueba de punta a punta COT-0010 ("Transporte") y COT-0011
 * ("Transporte 2 viajes x día"), reconstruidos de los PDF exportados por
 * RATEOS (16/10/2026) para PLAN-2026-012. Sin nombre de cliente.
 *
 *   Transporte $/viaje · 12 viajes facturables por mes · Neuquén → Añelo 100 km (ida y vuelta = 200 km por viaje)
 *   Camión tractor + semirremolque tercerizado: $ 3.250/km, operador, combustible, seguro y movilización incluidos,
 *     IVA 21 % recuperable, plazo de pago propio 15 días → 2.400 km × $ 3.250 = $ 7.800.000 por mes
 *   Coordinador logístico: $ 3.280.036 por mes (el detalle sueldo / cargas no está en el PDF: es ilustrativo)
 *   Estructura 8 % del costo directo · contingencia 3 % · financiero 3 % mensual, cobro a 15 + 40 días
 *   Impuestos sobre la facturación 5 % · margen 10 % · redondeo a $ 1.000
 *
 *   COT-0010: 1 viaje por día → 12 días de trabajo, 12 intervenciones de 1 viaje.
 *   COT-0011: 2 viajes por día → 6 días de trabajo, 6 intervenciones de 2 viajes.
 *   En ambos: 12 viajes físicos, 2.400 km, costo $ 12.864.478, sugerida $ 1.262.000 / viaje.
 */

import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { computeLaborLine } from '../../js/engines/labor-engine.js';

/**
 * @param {object} [options]
 * @param {number} [options.tripsPerDay]           viajes por día de trabajo (1 en COT-0010, 2 en COT-0011)
 * @param {number|null} [options.tripsPerActivation] viajes por intervención cargados en "Viajes" (null = el que corresponde)
 */
export function transportQuote({ tripsPerDay = 1, tripsPerActivation = null, code = 'COT-0010' } = {}) {
  const now = '2026-10-16T12:00:00.000Z';
  const q = createEmptyQuote({ organizationId: 'org-test', settings: { fuelPricePerLiter: 1500 }, now, id: code.toLowerCase(), code });
  Object.assign(q, { name: tripsPerDay === 1 ? 'Transporte' : `Transporte ${tripsPerDay} viajes x dia`, client: '', serviceType: 'transport', unit: 'trip', unitName: '', pricingMode: 'known_activity', contractMonths: 12, illustrative: false });
  q.activity = { ...q.activity, billableQuantityPerMonth: 12, unitsPerActiveDay: tripsPerDay, daysPerActivation: 1, availableDaysPerMonth: 30, hoursPerActiveDay: 10 };
  const coordinator = {
    id: 'l1', role: 'Coordinador logístico', positions: 1, peoplePerPosition: 1, basicMonthly: 2000000, additionalsMonthly: 0, normalHoursPerMonth: 176,
    overtimeHoursPerActiveDay: 0, overtimePremiumPct: 50, mealPerActiveDay: 0, sacPct: 8.33, vacationPct: 4.17, employerContributionsPct: 24, artPct: 3,
    insuranceMonthly: 0, ppeMonthly: 0, trainingMonthly: 0, transferMonthly: 0,
  };
  // Personal del reporte: $ 3.280.036 por mes (el resto, no remunerativo).
  coordinator.insuranceMonthly = 3280036 - computeLaborLine(coordinator).fixedMonthly;
  coordinator.base = { period: '2026-10', currency: 'ARS', source: 'company', note: '' };
  q.labor = [coordinator];
  q.equipment = [
    {
      id: 'e1', name: 'Camión tractor + semirremolque', acquisition: 'outsourced', quantity: 1, hoursPerActiveDay: null, supplierPayDays: 15,
      base: { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' },
      external: {
        supplier: 'Transportista', price: 3250, unit: 'km', minimumUnits: 0, validUntil: '2026-12-31',
        operatorIncluded: true, fuelIncluded: true, insuranceIncluded: true, mobilizationIncluded: true,
        fiscal: { vatPct: 21, vatRecoverable: 'yes', perceptionsPct: 0, nonRecoverablePct: 0 },
      },
    },
  ];
  q.materialsNotApplicable = true;
  q.materials = [];
  q.logistics = {
    ...q.logistics, notApplicable: false, baseName: 'Neuquén', destinationName: 'Añelo', distanceKm: 100, roundTrip: true,
    tripsPerActivation: tripsPerActivation === null ? tripsPerDay : tripsPerActivation, vehicles: [],
  };
  q.fuel = { ...q.fuel, providedBy: 'contractor', pricePerLiter: 1500, illustrative: false, base: { period: '2026-10', currency: 'ARS', source: 'company', note: '' } };
  q.indirect = { method: 'percent_direct', pct: 8, amount: 0 };
  q.finance = { paymentTermDays: 40, invoiceLagDays: 15, monthlyRatePct: 3, payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 } };
  q.risk = { generalPct: 3, items: [] };
  q.pricing = { ...q.pricing, targetMarginPct: 10, roundingStep: 1000, knownRate: 0, offeredRateOverride: null, commercialDiscountPct: 0 };
  q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 5, items: [] };
  return q;
}

/** COT-0010 — Transporte base: 1 viaje por día, 12 días de trabajo. */
export function cot0010Quote(options = {}) {
  return transportQuote({ tripsPerDay: 1, code: 'COT-0010', ...options });
}

/** COT-0011 — 2 viajes por día, 6 días de trabajo, 2 viajes por intervención. */
export function cot0011Quote(options = {}) {
  return transportQuote({ tripsPerDay: 2, code: 'COT-0011', ...options });
}
