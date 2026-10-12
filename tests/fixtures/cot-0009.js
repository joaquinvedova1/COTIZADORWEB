/**
 * Caso de prueba de punta a punta COT-0009 ("PPRUEBA 1 REAL"), reconstruido
 * del PDF exportado por RATEOS (12/10/2026) para la auditoría de PLAN-2026-010.
 *
 * El PDF trae los totales por rubro, los fijos y variables, el financiero, la
 * movilización (100 km por salida, 10 salidas, 35 L/100 km) y la sensibilidad
 * (plazo de pago ±30 días → ±$ 720.837, que fija tasa 3 % mensual y cobro a
 * 60 días). Con esos datos se reconstruyó UNA combinación de entradas que
 * reproduce todos los números del reporte al peso; el detalle interno del
 * personal y del vactor (sueldo vs. cargas, seguro vs. otros) no está en el
 * PDF y es ilustrativo. Sin nombre de cliente.
 *
 *   2.400 m³/mes · 120 m³ por día de trabajo → 20 días · 2 días por intervención → 10 salidas
 *   Personal       $ 4.920.054 (fijo)      Vactor propio  $ 5.000.000 fijo + $ 10.000/h × 160 h
 *   Combustible    35 L/h × 160 h + 350 L en ruta, a $ 1.500/L = $ 8.925.000
 *   Externos       pickup tercerizada $ 2.800.000/mes (IVA sin definir) + "Equipo alquilado" sin precio
 *   Materiales     10 L/día × $ 5.000/L = $ 1.000.000   Logística  1.000 km × $ 250/km = $ 250.000
 *   Estructura     10 % del costo directo                Financiero 3 % mensual, cobro a 60 días
 *   Impuestos sobre la facturación 5 % · margen 10 % · redondeo a $ 1.000
 */

import { createEmptyQuote } from '../../js/domain/quote-factory.js';
import { computeLaborLine } from '../../js/engines/labor-engine.js';

/**
 * @param {object} [overrides]
 * @param {object} [overrides.pickupFiscal] tratamiento fiscal de la pickup tercerizada
 * @param {number} [overrides.pickupPrice] precio neto mensual de la pickup
 */
export function cot0009Quote({ pickupFiscal = { vatPct: null, vatRecoverable: null }, pickupPrice = 2800000 } = {}) {
  const now = '2026-10-12T12:00:00.000Z';
  const q = createEmptyQuote({ organizationId: 'org-test', settings: { fuelPricePerLiter: 1500 }, now, id: 'cot-0009', code: 'COT-0009' });
  Object.assign(q, { name: 'Caso de prueba COT-0009', client: '', serviceType: 'per_unit', unit: 'm3', unitName: '', pricingMode: 'known_activity', contractMonths: 12, illustrative: false });
  q.activity = { ...q.activity, billableQuantityPerMonth: 2400, unitsPerActiveDay: 120, daysPerActivation: 2, availableDaysPerMonth: 30, hoursPerActiveDay: 8 };
  const operator = {
    id: 'l1', role: 'Operador de vactor', positions: 1, peoplePerPosition: 1, basicMonthly: 3000000, additionalsMonthly: 0, normalHoursPerMonth: 176,
    overtimeHoursPerActiveDay: 0, overtimePremiumPct: 50, mealPerActiveDay: 0, sacPct: 8.33, vacationPct: 4.17, employerContributionsPct: 24, artPct: 3,
    insuranceMonthly: 0, ppeMonthly: 0, trainingMonthly: 0, transferMonthly: 0,
  };
  // Personal del reporte: $ 4.920.054 por mes (el resto, no remunerativo).
  operator.insuranceMonthly = 4920054 - computeLaborLine(operator).fixedMonthly;
  q.labor = [operator];
  q.equipment = [
    {
      id: 'e1', name: 'Vactor', acquisition: 'owned', quantity: 1, hoursPerActiveDay: null,
      replacementValue: 350000000, usefulLifeYears: 10, residualValue: 0, insuranceAnnual: 25000000, licenseAnnual: 0, certificationsAnnual: 0, otherAnnual: 0, capitalRatePctAnnual: 0,
      maintenancePerHour: 10000, tiresPerHour: 0, fuelLitersPerHour: 35,
      mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 250, driver: 'operator' },
    },
    {
      id: 'e2', name: 'Pickup tercerizada', acquisition: 'outsourced', quantity: 1, hoursPerActiveDay: null,
      external: { price: pickupPrice, unit: 'month', minimumUnits: 0, operatorIncluded: null, fuelIncluded: null, mobilizationIncluded: null, fiscal: { ...pickupFiscal } },
    },
    { id: 'e3', name: 'Equipo alquilado', acquisition: 'rented', quantity: 1, hoursPerActiveDay: null, external: { price: 0, unit: 'day', minimumUnits: 0, fiscal: { vatPct: null, vatRecoverable: null } } },
  ];
  q.materials = [{ id: 'm1', description: 'Producto químico', unit: 'L', basis: 'per_active_day', quantity: 10, unitCost: 5000, wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor' }];
  q.logistics = { ...q.logistics, notApplicable: false, distanceKm: 50, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
  q.indirect = { method: 'percent_direct', pct: 10, amount: 0 };
  q.finance = { paymentTermDays: 60, invoiceLagDays: 15, monthlyRatePct: 3, payDays: { salaries: 20, fuel: 0, suppliers: 30, materials: 30, structure: 20 } };
  q.risk = { generalPct: 0, items: [] };
  q.pricing = { ...q.pricing, targetMarginPct: 10, roundingStep: 1000, knownRate: 0, offeredRateOverride: null, commercialDiscountPct: 0 };
  q.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: 5, items: [] };
  return q;
}
