/**
 * RATEOS Test Lab — campaña ESTABLE de servicios (PLAN-2026-013).
 *
 * Escenarios curados con IDs fijos: todos los tipos de servicio, todas las
 * unidades comerciales, propios / alquilados / tercerizados, personal,
 * materiales, transporte, financiación, contingencia, recursos compartidos y
 * casos extremos. Datos SINTÉTICOS e ILUSTRATIVOS (ningún valor es real).
 *
 * Cada escenario: { id, title, family, build(), expect?, ux?, market? }
 *   expect  valores de negocio calculables a mano ("12 viajes × 200 km = 2.400 km")
 *   ux      lo que la completitud tiene que decir (pendientes, críticos, avisos)
 *   market  conceptos a comparar con referencias de mercado (sólo informativo)
 */

import { service, person, owned, external, material, vehicle, otherCost, taxes, base } from '../lib/build.js';
import { cot0009Quote } from '../../fixtures/cot-0009.js';
import { cot0010Quote, cot0011Quote, transportQuote } from '../../fixtures/cot-0010.js';
import { demoReferenceQuote, createDemoState, DEMO_IDS } from '../../../js/domain/demo-data.js';
import { createEmptyQuote } from '../../../js/domain/quote-factory.js';
import { LAB_SETTINGS, LAB_NOW, LAB_ORG } from '../lib/build.js';

const route = (o = {}) => ({ notApplicable: false, baseName: 'Neuquén', destinationName: 'Locación', distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [], tollsPerActivation: 0, lodgingPerActivation: 0, ...o });

export const SERVICE_SCENARIOS = [
  // ------------------------------------------------------------------ on-call
  {
    id: 'SRV-01-ONCALL-DAY',
    title: 'On-call hidrogrúa $/día: relevos, standby, call-out, vehículo de apoyo',
    family: 'on_call',
    build: () => {
      const op = person({ id: 'op', role: 'Operador de hidrogrúa', assignment: 'dedicated', basicMonthly: 1800000, additionalsMonthly: 400000, peoplePerPosition: 2, overtimeHoursPerActiveDay: 2, mealPerActiveDay: 25000, insuranceMonthly: 30000, ppeMonthly: 40000 });
      const rigger = person({ id: 'rig', role: 'Señalero', basicMonthly: 1400000, peoplePerPosition: 2, mealPerActiveDay: 25000 });
      return service({
        id: 'srv-01', serviceType: 'on_call', unit: 'day',
        activity: { activeDaysPerMonth: 8, daysPerActivation: 2, hoursPerActiveDay: 10 },
        labor: [op, rigger],
        equipment: [owned({ id: 'crane', name: 'Hidrogrúa', replacementValue: 250000000, residualValue: 50000000, usefulLifeYears: 10, insuranceAnnual: 6000000, licenseAnnual: 2400000, certificationsAnnual: 1800000, maintenancePerHour: 15000, tiresPerHour: 5000, fuelLitersPerHour: 12, operatorLaborId: 'op', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
        materials: [material({ description: 'Eslingas y consumibles', basis: 'per_activation', quantity: 1, unitCost: 50000 })],
        logistics: route({ distanceKm: 110, vehicles: [vehicle({ name: 'Camioneta del señalero' })], tollsPerActivation: 6000 }),
        indirect: { method: 'percent_direct', pct: 12 },
        finance: { paymentTermDays: 90, invoiceLagDays: 15 },
        risk: { generalPct: 2, items: [{ id: 'weather', label: 'Clima', pct: 1, enabled: true }, { id: 'rework', label: 'Retrabajos', pct: 4, enabled: false }] },
        pricing: { targetMarginPct: 15 },
        billingTaxes: taxes(4.5),
        rules: { standbyNotApplicable: false, standbyDaysPerMonth: 2, standbyRatePerDay: 300000, calloutFeePerActivation: 200000 },
      });
    },
    expect: { 'kpis.activeDays': 8, 'activity.activationsPerMonth': 4, 'model.transport.routeKmPerMonth': 880 },
    market: [{ concept: 'fuel.diesel.ars_per_liter', path: 'fuel.pricePerLiter' }],
  },
  {
    id: 'SRV-02-ONCALL-HOUR',
    title: 'On-call $/hora con mínimo por llamado (4 h) y grúa tercerizada con mínimo',
    family: 'on_call',
    build: () => service({
      id: 'srv-02', serviceType: 'on_call', unit: 'hour',
      activity: { activeDaysPerMonth: 6, daysPerActivation: 1, hoursPerActiveDay: 3 },
      labor: [person({ role: 'Supervisor de maniobra', basicMonthly: 2200000, peoplePerPosition: 2 })],
      equipment: [external({ name: 'Grúa tercerizada' }, { price: 450000, unit: 'hour', minimumUnits: 4 })],
      billingTaxes: taxes([3.5, 1.2]),
      pricing: { targetMarginPct: 12 },
      rules: { minimumCallUnits: 4, standbyNotApplicable: true },
    }),
    expect: { 'kpis.billableQuantity': 24, 'model.external.0.billedUnitsPerActivation': 4 },
  },
  {
    id: 'SRV-03-ONCALL-CALL',
    title: 'On-call $/llamado: 10 llamados, camioneta propia por sus medios, alquiler por llamado',
    family: 'on_call',
    build: () => service({
      id: 'srv-03', serviceType: 'on_call', unit: 'call',
      activity: { billableQuantityPerMonth: 10, daysPerActivation: 1, hoursPerActiveDay: 6 },
      labor: [person({ id: 'tec', role: 'Técnico', basicMonthly: 1600000, peoplePerPosition: 2 })],
      equipment: [
        owned({ name: 'Camioneta de servicio', replacementValue: 45000000, usefulLifeYears: 6, insuranceAnnual: 1800000, licenseAnnual: 600000, maintenancePerHour: 2500, fuelLitersPerHour: 4, operatorLaborId: 'tec', mobilization: { mode: 'self', travelLitersPer100Km: 13, travelCostPerKm: 90, driver: 'operator' } }),
        external({ name: 'Herramienta especial alquilada', acquisition: 'rented' }, { price: 120000, unit: 'activation', operatorIncluded: false }),
      ],
      logistics: route({ distanceKm: 40 }),
      rules: { standbyNotApplicable: true },
    }),
    expect: { 'kpis.activeDays': 10, 'kpis.billableQuantity': 10 },
  },
  {
    id: 'SRV-04-ONCALL-MONTH',
    title: 'On-call abono $/mes con tarifa conocida (equilibrio no aplica)',
    family: 'on_call',
    build: () => service({
      id: 'srv-04', serviceType: 'on_call', unit: 'month', pricingMode: 'known_rate',
      activity: { activeDaysPerMonth: 6, daysPerActivation: 2, hoursPerActiveDay: 10 },
      labor: [person({ role: 'Operador', basicMonthly: 1900000, peoplePerPosition: 2, mealPerActiveDay: 22000 })],
      equipment: [owned({ name: 'Equipo de bombeo', replacementValue: 80000000, usefulLifeYears: 8, insuranceAnnual: 2400000, maintenancePerHour: 6000, fuelLitersPerHour: 7 })],
      pricing: { knownRate: 18000000 },
      rules: { standbyNotApplicable: true },
    }),
    expect: { 'kpis.billableQuantity': 1, 'breakEven.notApplicable': true },
  },
  // ---------------------------------------------------------------- permanente
  {
    id: 'SRV-05-PERM-MONTH',
    title: 'Servicio permanente $/mes 24/7: 3 posiciones con relevo, estructura por empleado, sin impuestos',
    family: 'permanent',
    build: () => service({
      id: 'srv-05', serviceType: 'permanent', unit: 'month',
      activity: { activeDaysPerMonth: 30, hoursPerActiveDay: 12 },
      labor: [person({ role: 'Operador de planta', positions: 3, peoplePerPosition: 3, basicMonthly: 1700000, mealPerActiveDay: 20000 })],
      indirect: { method: 'per_employee', amount: 150000 },
      billingTaxes: taxes('na'),
      pricing: { targetMarginPct: 8 },
    }),
    expect: { 'kpis.billableQuantity': 1 },
  },
  {
    id: 'SRV-06-PERM-SHIFT',
    title: 'Permanente $/turno con horas extra por tramos (HE 50 % por día y HE 100 % por mes) facturadas aparte',
    family: 'permanent',
    build: () => service({
      id: 'srv-06', serviceType: 'permanent', unit: 'shift',
      activity: { billableQuantityPerMonth: 60, unitsPerActiveDay: 2, daysPerActivation: 1, hoursPerActiveDay: 12 },
      labor: [person({
        role: 'Guardia operativa', positions: 2, peoplePerPosition: 2, basicMonthly: 1500000, overtimeBilled: true,
        overtime: [
          { id: 'he50', label: 'HE 50 %', premiumPct: 50, hours: 2, basis: 'per_active_day', billRatePerHour: 30000 },
          { id: 'he100', label: 'HE 100 %', premiumPct: 100, hours: 8, basis: 'per_month', billRatePerHour: 45000 },
        ],
      })],
    }),
    expect: { 'kpis.activeDays': 30 },
  },
  // -------------------------------------------------------------------- cuadrilla
  {
    id: 'SRV-07-CREW-DAY',
    title: 'Cuadrilla $/día con tarifa conocida, tramos de descuento, continuidad y descuento comercial',
    family: 'crew',
    build: () => service({
      id: 'srv-07', serviceType: 'crew', unit: 'day', pricingMode: 'known_rate',
      activity: { activeDaysPerMonth: 16, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Oficial', positions: 4, basicMonthly: 1500000, mealPerActiveDay: 18000 })],
      materials: [material({ description: 'Consumibles', basis: 'per_active_day', quantity: 20, unitCost: 3500, wastePct: 5, logisticsPct: 3 })],
      indirect: { method: 'percent_labor', pct: 18 },
      pricing: { knownRate: 2600000, commercialDiscountPct: 2 },
      rules: {
        volumeTiers: [{ id: 't1', fromDays: 1, toDays: 7, discountPct: 0 }, { id: 't2', fromDays: 8, toDays: 15, discountPct: 3 }, { id: 't3', fromDays: 16, toDays: 30, discountPct: 5 }],
        continuityMinMonths: 6, continuityDiscountPct: 3,
      },
    }),
    expect: { 'kpis.activeDays': 16 },
  },
  {
    id: 'SRV-08-CREW-HOUR',
    title: 'Cuadrilla $/hora con tarifa ofrecida y mínimo por llamado (10 h > 9 h trabajadas)',
    family: 'crew',
    build: () => service({
      id: 'srv-08', serviceType: 'crew', unit: 'hour',
      activity: { activeDaysPerMonth: 12, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Técnico', positions: 3, basicMonthly: 1650000, mealPerActiveDay: 18000 })],
      indirect: { method: 'per_hour', amount: 4000 },
      pricing: { offeredRateOverride: 95000 },
      rules: { minimumCallUnits: 10 },
    }),
    expect: { 'kpis.billableQuantity': 120 },
  },
  // ------------------------------------------------------------- equipo con operador
  {
    id: 'SRV-09-EQOP-DAY-TRANSPORTED',
    title: 'Retro con operador $/día: service cada 250 h, juego de neumáticos por horas, costo de capital, transportada por carretón tercerizado',
    family: 'equipment_with_operator',
    build: () => service({
      id: 'srv-09', serviceType: 'equipment_with_operator', unit: 'day',
      activity: { activeDaysPerMonth: 10, daysPerActivation: 5, hoursPerActiveDay: 9 },
      labor: [person({ id: 'op9', role: 'Operador de retro', basicMonthly: 1900000, mealPerActiveDay: 20000 })],
      equipment: [
        owned({
          id: 'retro', name: 'Retroexcavadora', replacementValue: 180000000, usefulLifeYears: 10, residualValue: 30000000, insuranceAnnual: 3600000, capitalRatePctAnnual: 8,
          maintenanceMode: 'service', maintenanceServiceCost: 600000, maintenanceServiceHours: 250, tiresMode: 'set_hours', tiresSetCost: 2400000, tiresLifeHours: 3000,
          fuelLitersPerHour: 14, operatorLaborId: 'op9', mobilization: { mode: 'transported', carrierLineId: 'lowboy' },
        }),
        external({ id: 'lowboy', name: 'Carretón tercerizado' }, { price: 1200000, unit: 'trip' }),
      ],
      logistics: route({ distanceKm: 150 }),
    }),
    expect: { 'kpis.activeDays': 10, 'model.external.0.billedUnitsPerActivation': 2 },
  },
  {
    id: 'SRV-10-EQOP-TRIP-ONEWAY',
    title: 'Camión propio con chofer $/viaje: 60 viajes a 3 por día, viajes de ida (60 km), neumáticos por km',
    family: 'equipment_with_operator',
    build: () => service({
      id: 'srv-10', serviceType: 'equipment_with_operator', unit: 'trip',
      activity: { billableQuantityPerMonth: 60, unitsPerActiveDay: 3, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ id: 'drv', role: 'Chofer', basicMonthly: 1750000, mealPerActiveDay: 20000 })],
      equipment: [owned({
        name: 'Camión volcador', replacementValue: 140000000, usefulLifeYears: 8, insuranceAnnual: 4800000, licenseAnnual: 1200000,
        tiresMode: 'set_km', tiresSetCost: 4800000, tiresLifeKm: 120000, maintenancePerHour: 0, fuelLitersPerHour: 0,
        operatorLaborId: 'drv', mobilization: { mode: 'self', travelLitersPer100Km: 32, travelCostPerKm: 120, driver: 'operator' },
      })],
      logistics: route({ distanceKm: 60, roundTrip: false }),
    }),
    expect: { 'model.transport.physicalTripsPerMonth': 60, 'model.transport.kmPerTrip': 60, 'model.transport.routeKmPerMonth': 3600 },
  },
  // ------------------------------------------------------------- equipo sin operador
  {
    id: 'SRV-11-EQONLY-MONTH-FUEL-CLIENT',
    title: 'Generador sin operador $/mes: presupuesto anual de mantenimiento, combustible provisto por el cliente',
    family: 'equipment_only',
    build: () => service({
      id: 'srv-11', serviceType: 'equipment_only', unit: 'month',
      activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 12 },
      equipment: [owned({ name: 'Generador 250 kVA', replacementValue: 60000000, usefulLifeYears: 10, insuranceAnnual: 1200000, maintenanceMode: 'budget', maintenanceBudget: 3600000, maintenanceBudgetPeriod: 'year', fuelLitersPerHour: 18 })],
      fuel: { providedBy: 'client' },
      billingTaxes: taxes(3),
      pricing: { targetMarginPct: 18 },
    }),
    ux: { itemStatus: { fuel: 'ok' } },
  },
  {
    id: 'SRV-12-EQONLY-DAY-RENTED',
    title: 'Compresor alquilado $/día: IVA no recuperable + percepciones + cargos, plazo propio del proveedor, combustible y movilización aparte',
    family: 'equipment_only',
    build: () => service({
      id: 'srv-12', serviceType: 'equipment_only', unit: 'day',
      activity: { activeDaysPerMonth: 15, daysPerActivation: 5, hoursPerActiveDay: 8 },
      equipment: [external({ name: 'Compresor alquilado', acquisition: 'rented', supplierPayDays: 45 }, {
        price: 220000, unit: 'day', operatorIncluded: false, fuelIncluded: false, fuelLitersPerHour: 6, mobilizationIncluded: false, mobilizationAmount: 150000,
        fiscal: { vatPct: 21, vatRecoverable: 'no', perceptionsPct: 3, nonRecoverablePct: 1.5 },
      })],
    }),
  },
  // ---------------------------------------------------------- por unidad producida
  {
    id: 'SRV-13-UNIT-M3-FULL-ACTIVATIONS',
    title: 'Vactor $/m³ (COT-0009 con 2.500 m³) con "cada salida se cuenta completa"',
    family: 'per_unit',
    build: () => {
      const q = cot0009Quote();
      q.id = 'srv-13';
      q.activity = { ...q.activity, billableQuantityPerMonth: 2500, fullActivations: true };
      return q;
    },
    expect: { 'kpis.activationsEstimated': 10.416666666666666, 'kpis.activationsCosted': 11 },
    market: [{ concept: 'fuel.diesel.ars_per_liter', path: 'fuel.pricePerLiter' }],
  },
  {
    id: 'SRV-14-UNIT-TON-DETAILED-STRUCTURE',
    title: 'Carga a granel $/tonelada: pala alquilada por hora con combustible aparte, estructura desglosada por rubro',
    family: 'per_unit',
    build: () => service({
      id: 'srv-14', serviceType: 'per_unit', unit: 'ton',
      activity: { billableQuantityPerMonth: 1800, unitsPerActiveDay: 90, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Operador de pala', basicMonthly: 1850000, mealPerActiveDay: 20000 })],
      equipment: [external({ name: 'Pala cargadora alquilada', acquisition: 'rented' }, { price: 85000, unit: 'hour', operatorIncluded: false, fuelIncluded: false, fuelLitersPerHour: 16 })],
      materials: [material({ description: 'Repuestos de desgaste', basis: 'per_month', quantity: 1, unitCost: 400000 })],
      indirect: { mode: 'detailed', method: 'percent_direct', pct: 0, amount: 0, items: [
        { id: 'adm', label: 'Administración', method: 'percent_direct', pct: 8 },
        { id: 'hse', label: 'HSE', method: 'per_employee', amount: 120000 },
        { id: 'seg', label: 'Seguros generales', method: 'per_contract', amount: 350000 },
      ] },
    }),
    expect: { 'kpis.activeDays': 20 },
  },
  {
    id: 'SRV-15-UNIT-KG',
    title: 'Embolsado $/kg con otro costo por llamado (logística)',
    family: 'per_unit',
    build: () => service({
      id: 'srv-15', serviceType: 'per_unit', unit: 'kg',
      activity: { billableQuantityPerMonth: 12000, unitsPerActiveDay: 800, daysPerActivation: 1, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Operario', positions: 2, basicMonthly: 1400000 })],
      materials: [material({ description: 'Bolsas', unit: 'unidad', basis: 'per_active_day', quantity: 40, unitCost: 900 })],
      otherCosts: [otherCost({ description: 'Flete de retiro', category: 'logistics', behavior: 'per_activation', amount: 25000 })],
    }),
    expect: { 'kpis.activeDays': 15 },
  },
  {
    id: 'SRV-16-UNIT-METER-MIN-CALL',
    title: 'Zanjeo $/metro con mínimo por llamado (150 m > 100 m trabajados por salida)',
    family: 'per_unit',
    build: () => service({
      id: 'srv-16', serviceType: 'per_unit', unit: 'meter',
      activity: { billableQuantityPerMonth: 900, unitsPerActiveDay: 50, daysPerActivation: 2, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Operador de zanjadora', basicMonthly: 1800000 })],
      equipment: [owned({ name: 'Zanjadora', assignment: 'reserved', replacementValue: 90000000, usefulLifeYears: 10, maintenancePerHour: 7000, fuelLitersPerHour: 10 })],
      rules: { minimumCallUnits: 150 },
    }),
    expect: { 'kpis.activeDays': 12, 'kpis.billableQuantity': 900 },
  },
  {
    id: 'SRV-17-UNIT-M2-SHARED',
    title: 'Pintura industrial $/m²: supervisor compartido 40 %, elevador compartido 30 %, estructura por empleado (dotación equivalente)',
    family: 'per_unit',
    build: () => service({
      id: 'srv-17', serviceType: 'per_unit', unit: 'm2',
      activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 250, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [
        person({ role: 'Supervisor', basicMonthly: 2600000, assignment: 'shared', fixedCostSharePct: 40, mealPerActiveDay: 20000 }),
        person({ role: 'Pintor', positions: 3, basicMonthly: 1500000, mealPerActiveDay: 18000 }),
      ],
      equipment: [owned({ name: 'Plataforma elevadora', replacementValue: 70000000, usefulLifeYears: 8, insuranceAnnual: 1500000, maintenancePerHour: 4000, assignment: 'shared', fixedCostSharePct: 30 })],
      materials: [material({ description: 'Pintura epoxi', unit: 'L', basis: 'per_active_day', quantity: 35, unitCost: 9000, wastePct: 8 })],
      indirect: { method: 'per_employee', amount: 100000 },
    }),
  },
  {
    id: 'SRV-18-UNIT-LOT-FRACTIONAL-YIELD',
    title: 'Ensayos por lote $/lote con medio lote por día (rendimiento fraccionario)',
    family: 'per_unit',
    build: () => service({
      id: 'srv-18', serviceType: 'per_unit', unit: 'lot',
      activity: { billableQuantityPerMonth: 4, unitsPerActiveDay: 0.5, daysPerActivation: 2, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Laboratorista', basicMonthly: 2100000 })],
      materials: [material({ description: 'Reactivos', basis: 'per_activation', quantity: 1, unitCost: 180000 })],
    }),
    expect: { 'kpis.activeDays': 8 },
  },
  {
    id: 'SRV-19-UNIT-UNIT-CURRENCY',
    title: 'Inspecciones $/unidad con equipo y consumible en USD (tipo de cambio de la cotización, ILUSTRATIVO)',
    family: 'per_unit',
    build: () => service({
      id: 'srv-19', serviceType: 'per_unit', unit: 'unit',
      activity: { billableQuantityPerMonth: 300, unitsPerActiveDay: 15, daysPerActivation: 1, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Inspector nivel II', basicMonthly: 2300000 })],
      equipment: [owned({ name: 'Equipo de ultrasonido', replacementValue: 25000, usefulLifeYears: 5, base: base('USD'), insuranceAnnual: 300000, maintenancePerHour: 500 })],
      materials: [material({ description: 'Acoplante', basis: 'per_active_day', quantity: 1, unitCost: 12, base: base('USD') })],
      exchangeRates: [{ currency: 'USD', rate: 1000, base: base('ARS') }],
    }),
  },
  // -------------------------------------------------------------------- transporte
  {
    id: 'SRV-20-TRANS-KM-CONSISTENT',
    title: 'Transporte $/km: 8.000 km facturados = 20 días × 2 viajes × 200 km (coherente)',
    family: 'transport',
    build: () => service({
      id: 'srv-20', serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1, hoursPerActiveDay: 10 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 1100, unit: 'km' })],
      logistics: route({ distanceKm: 100, tripsPerActivation: 2 }),
    }),
    expect: { 'model.transport.routeKmPerMonth': 8000, 'model.transport.providers.0.netMonthly': 8800000 },
    market: [{ concept: 'transport.truck.ars_per_km', path: 'equipment.0.external.price' }],
  },
  {
    id: 'SRV-21-TRANS-TRIP-COT0010',
    title: 'COT-0010 Transporte $/viaje: 12 viajes a 1 por día (golden)',
    family: 'transport',
    build: () => cot0010Quote(),
    expect: { 'kpis.activeDays': 12, 'model.transport.physicalTripsPerMonth': 12, 'model.transport.routeKmPerMonth': 2400, 'model.transport.providers.0.netMonthly': 7800000, 'kpis.totalCost': 12864477.768024001, 'kpis.suggestedListRate': 1262000 },
    ux: { completeness: 100, itemStatus: { fuel: 'ok' } },
    market: [{ concept: 'transport.semi.ars_per_km', path: 'equipment.0.external.price' }, { concept: 'transport.semi.ars_per_km_tariff', kpi: 'perKmTariff' }],
  },
  {
    id: 'SRV-22-TRANS-TRIP-COT0011',
    title: 'COT-0011 Transporte $/viaje: 12 viajes a 2 por día, mismos km (golden)',
    family: 'transport',
    build: () => cot0011Quote(),
    expect: { 'kpis.activeDays': 6, 'model.transport.physicalTripsPerMonth': 12, 'model.transport.routeKmPerMonth': 2400, 'model.transport.providers.0.netMonthly': 7800000, 'kpis.totalCost': 12864477.768024001, 'kpis.suggestedListRate': 1262000 },
    ux: { completeness: 100 },
  },
  {
    id: 'SRV-23-TRANS-TRIP-3-PER-DAY',
    title: 'Transporte $/viaje a 3 por día: mismos km y mismo proveedor (golden)',
    family: 'transport',
    build: () => transportQuote({ tripsPerDay: 3, code: 'COT-LAB-23' }),
    expect: { 'kpis.activeDays': 4, 'model.transport.routeKmPerMonth': 2400, 'kpis.totalCost': 12864477.768024001 },
  },
  {
    id: 'SRV-24-TRANS-TRIP-FUEL-PER-100KM',
    title: 'COT-0010 con combustible del camión a nuestro cargo: 35 L/100 km sobre los km físicos',
    family: 'transport',
    build: () => {
      const q = cot0010Quote({ code: 'COT-LAB-24' });
      q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
      return q;
    },
    expect: { 'eecc.fuel': 1260000 },
    ux: { itemStatus: { fuel: 'ok' } },
    market: [{ concept: 'transport.semi.liters_per_100km', path: 'equipment.0.external.fuelLitersPer100Km' }, { concept: 'fuel.diesel.ars_per_liter', path: 'fuel.pricePerLiter' }],
  },
  {
    id: 'SRV-25-TRANS-TRIP-FUEL-KM-PER-LITER',
    title: 'COT-0010 con rendimiento 2,5 km/L: 2.400 km ÷ 2,5 = 960 L',
    family: 'transport',
    build: () => {
      const q = cot0010Quote({ code: 'COT-LAB-25' });
      q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'km_per_liter', fuelKmPerLiter: 2.5 };
      return q;
    },
    expect: { 'eecc.fuel': 1440000 },
  },
  {
    id: 'SRV-26-TRANS-TON-OWN-TRUCK',
    title: 'Transporte $/tonelada con camión propio por sus medios (30 t por viaje, 1 viaje por día)',
    family: 'transport',
    build: () => service({
      id: 'srv-26', serviceType: 'transport', unit: 'ton',
      activity: { billableQuantityPerMonth: 600, unitsPerActiveDay: 30, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ id: 'ch26', role: 'Chofer', basicMonthly: 1750000, mealPerActiveDay: 20000 })],
      equipment: [owned({ name: 'Camión con batea', replacementValue: 160000000, usefulLifeYears: 8, insuranceAnnual: 5400000, licenseAnnual: 1500000, operatorLaborId: 'ch26', mobilization: { mode: 'self', travelLitersPer100Km: 38, travelCostPerKm: 140, driver: 'operator' } })],
      logistics: route({ distanceKm: 80 }),
    }),
    expect: { 'kpis.activeDays': 20, 'model.transport.routeKmPerMonth': 3200 },
  },
  {
    id: 'SRV-27-TRANS-TONKM',
    title: 'Transporte $/ton-km: 30 t × 160 km por día, camión tercerizado por día',
    family: 'transport',
    build: () => service({
      id: 'srv-27', serviceType: 'transport', unit: 'tonkm',
      activity: { billableQuantityPerMonth: 96000, unitsPerActiveDay: 4800, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 380000, unit: 'day' })],
      logistics: route({ distanceKm: 80 }),
    }),
    expect: { 'kpis.activeDays': 20 },
  },
  {
    id: 'SRV-28-TRANS-M3-WATER-MIN-LEGS',
    title: 'Transporte de agua $/m³: proveedor por tramo con mínimo de 3 tramos por salida',
    family: 'transport',
    build: () => service({
      id: 'srv-28', serviceType: 'transport', unit: 'm3',
      activity: { billableQuantityPerMonth: 1200, unitsPerActiveDay: 60, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Coordinador', basicMonthly: 1900000 })],
      equipment: [external({ name: 'Camión cisterna tercerizado' }, { price: 90000, unit: 'trip', minimumUnits: 3 })],
      logistics: route({ distanceKm: 25 }),
    }),
    expect: { 'model.external.0.billedUnitsPerActivation': 3 },
  },
  {
    id: 'SRV-29-TRANS-HOUR',
    title: 'Transporte $/hora: camión alquilado por día con combustible aparte por hora',
    family: 'transport',
    build: () => service({
      id: 'srv-29', serviceType: 'transport', unit: 'hour',
      activity: { activeDaysPerMonth: 18, daysPerActivation: 1, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Chofer', basicMonthly: 1750000 })],
      equipment: [external({ name: 'Camión alquilado', acquisition: 'rented' }, { price: 300000, unit: 'day', operatorIncluded: false, fuelIncluded: false, fuelLitersPerHour: 9 })],
    }),
    expect: { 'kpis.billableQuantity': 144 },
  },
  {
    id: 'SRV-30-TRANS-DAY-EXTRA-KM',
    title: 'Transporte $/día: movilización del proveedor aparte, fee de movilización y km adicional al cliente',
    family: 'transport',
    build: () => service({
      id: 'srv-30', serviceType: 'transport', unit: 'day',
      activity: { activeDaysPerMonth: 12, daysPerActivation: 1, hoursPerActiveDay: 10 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 450000, unit: 'day', mobilizationIncluded: false, mobilizationAmount: 80000 })],
      logistics: route({ distanceKm: 140 }),
      rules: { mobilizationFeePerActivation: 120000, includedKmPerActivation: 200, extraKmRate: 900 },
    }),
  },
  // ---------------------------------------------------------- llave en mano / lump sum
  {
    id: 'SRV-31-TURNKEY-JOB-GLOBAL',
    title: 'Llave en mano $ global por trabajo: externo global repartido en 6 meses de contrato, tarifa conocida',
    family: 'turnkey',
    build: () => service({
      id: 'srv-31', serviceType: 'turnkey', unit: 'job', pricingMode: 'known_rate', contractMonths: 6,
      activity: { billableQuantityPerMonth: 1, daysPerActivation: 10, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Jefe de obra', basicMonthly: 2800000, assignment: 'hired' }), person({ role: 'Oficial', positions: 3, basicMonthly: 1500000 })],
      equipment: [external({ name: 'Ingeniería tercerizada' }, { price: 6000000, unit: 'global' })],
      materials: [material({ description: 'Materiales del trabajo', basis: 'per_activation', quantity: 1, unitCost: 800000 })],
      pricing: { knownRate: 9500000 },
    }),
    expect: { 'kpis.activeDays': 10 },
  },
  {
    id: 'SRV-32-TURNKEY-MILESTONE',
    title: 'Llave en mano $/hito: 3 hitos por trabajo, 1 trabajo de 15 días por mes',
    family: 'turnkey',
    build: () => service({
      id: 'srv-32', serviceType: 'turnkey', unit: 'milestone',
      activity: { billableQuantityPerMonth: 3, unitsPerActivation: 3, daysPerActivation: 15, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Técnico', positions: 2, basicMonthly: 1800000 })],
    }),
    expect: { 'kpis.activeDays': 15, 'kpis.billableQuantity': 3 },
  },
  {
    id: 'SRV-33-LUMPSUM-JOB',
    title: 'Precio cerrado $/trabajo: 2 trabajos de 4 días, estructura manual, peajes y viáticos',
    family: 'lump_sum',
    build: () => service({
      id: 'srv-33', serviceType: 'lump_sum', unit: 'job',
      activity: { billableQuantityPerMonth: 2, daysPerActivation: 4, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Montador', positions: 3, basicMonthly: 1600000, mealPerActiveDay: 18000 })],
      equipment: [owned({ name: 'Equipo de soldadura', replacementValue: 15000000, usefulLifeYears: 6, maintenancePerHour: 1500, mobilization: { mode: 'support', supportVehicleId: 'cam33' } })],
      logistics: route({ distanceKm: 200, vehicles: [vehicle({ id: 'cam33', name: 'Camioneta', consumptionLPer100Km: 12, costPerKm: 85 })], tollsPerActivation: 12000, lodgingPerActivation: 180000 }),
      indirect: { method: 'manual', amount: 900000 },
    }),
    expect: { 'kpis.activeDays': 8 },
  },
  // ------------------------------------------------------------ horas y materiales
  {
    id: 'SRV-34-TM-HOUR-MATERIALS-BILLED',
    title: 'Horas y materiales $/hora: materiales facturados aparte con recargo de reventa 20 %',
    family: 'time_materials',
    build: () => service({
      id: 'srv-34', serviceType: 'time_materials', unit: 'hour',
      activity: { activeDaysPerMonth: 14, daysPerActivation: 1, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Técnico electricista', positions: 2, basicMonthly: 1900000 })],
      materials: [material({ description: 'Kits de conexión', basis: 'per_active_day', quantity: 5, unitCost: 12000, resaleMarkupPct: 20 })],
      pricing: { materialsBilledSeparately: true },
    }),
  },
  {
    id: 'SRV-35-TM-DAY-GUARANTEE',
    title: 'Horas y materiales $/día: material del cliente + de tercero, fee de disponibilidad y mínimo garantizado',
    family: 'time_materials',
    build: () => service({
      id: 'srv-35', serviceType: 'time_materials', unit: 'day',
      activity: { activeDaysPerMonth: 9, daysPerActivation: 1, hoursPerActiveDay: 9 },
      labor: [person({ role: 'Técnico', positions: 2, basicMonthly: 1800000 })],
      materials: [
        material({ description: 'Caños (los provee el cliente)', basis: 'per_month', quantity: 10, unitCost: 95000, providedBy: 'client' }),
        material({ description: 'Juntas (las compra un tercero contratado)', basis: 'per_active_day', quantity: 4, unitCost: 6000, providedBy: 'third_party' }),
      ],
      pricing: { offeredRateOverride: 1900000 },
      rules: { availabilityFeeMonthly: 2000000, minimumMonthlyGuarantee: 20000000 },
    }),
  },
  // ------------------------------------------------------------------ configurable
  {
    id: 'SRV-36-CONFIG-CUSTOM-UNIT',
    title: 'Servicio configurable con unidad propia "pozo": 8 pozos, medio pozo por día',
    family: 'configurable',
    build: () => service({
      id: 'srv-36', serviceType: 'configurable', unit: 'custom', unitName: 'pozo',
      activity: { billableQuantityPerMonth: 8, unitsPerActiveDay: 0.5, daysPerActivation: 2, hoursPerActiveDay: 10 },
      labor: [person({ role: 'Supervisor de pozo', basicMonthly: 2600000, peoplePerPosition: 2 })],
      equipment: [owned({ name: 'Unidad de prueba', replacementValue: 120000000, usefulLifeYears: 10, maintenancePerHour: 8000, fuelLitersPerHour: 9 })],
    }),
    expect: { 'kpis.activeDays': 16 },
  },
  {
    id: 'SRV-37-CONFIG-REFERENCE',
    title: 'Caso de referencia (golden): fijos 30M, variable 1M/día, tarifa 4M, 8 días',
    family: 'configurable',
    build: () => demoReferenceQuote(),
    expect: { 'kpis.breakEvenDays': 10, 'kpis.totalCost': 38000000, 'kpis.floorListRate': 4750000 },
  },
  {
    id: 'SRV-38-ONCALL-DEMO-HYDROCRANE',
    title: 'Demo hidrogrúa on-call (ILUSTRATIVA)',
    family: 'on_call',
    build: () => createDemoState(9).quotes.find((q) => q.id === DEMO_IDS.quoteHydroCrane),
  },
  {
    id: 'SRV-39-TRANS-TRIP-FULL-ACTIVATIONS-FUEL-KM',
    title: 'Transporte $/viaje con salidas completas (13 viajes a 2 por día = 6,5 salidas) y combustible por km a nuestro cargo',
    family: 'transport',
    build: () => {
      const q = cot0011Quote({ code: 'COT-LAB-39' });
      q.activity = { ...q.activity, billableQuantityPerMonth: 13, fullActivations: true };
      q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
      return q;
    },
    expect: { 'kpis.activationsEstimated': 6.5, 'kpis.activationsCosted': 7 },
  },
  // ---------------------------------------------------------------- casos extremos
  {
    id: 'SRV-E01-ZERO-ACTIVITY',
    title: 'Extremo: 0 días de trabajo (tarifas "—", sin NaN)',
    family: 'edge',
    build: () => service({ id: 'srv-e01', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 0 }, labor: [person({ basicMonthly: 2000000 })] }),
    expect: { 'kpis.floorListRate': null, 'kpis.costPerActiveDay': null, 'kpis.activeDays': 0 },
  },
  {
    id: 'SRV-E02-UTIL-100-MARGIN-0',
    title: 'Extremo: utilización 100 % (30 de 30 días) con margen 0',
    family: 'edge',
    build: () => service({ id: 'srv-e02', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 30, availableDaysPerMonth: 30 }, labor: [person({ positions: 2, basicMonthly: 1700000, mealPerActiveDay: 15000 })], pricing: { targetMarginPct: 0 } }),
  },
  {
    id: 'SRV-E03-NEAR-ZERO',
    title: 'Extremo: utilización cercana a 0 (0,1 día): tarifas muy altas pero finitas',
    family: 'edge',
    build: () => service({ id: 'srv-e03', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 0.1 }, labor: [person({ basicMonthly: 1700000 })] }),
  },
  {
    id: 'SRV-E04-BELOW-COST',
    title: 'Extremo: tarifa conocida por debajo del costo (bajo piso, con pérdida)',
    family: 'edge',
    build: () => service({ id: 'srv-e04', serviceType: 'crew', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 10 }, labor: [person({ positions: 2, basicMonthly: 1800000 })], pricing: { knownRate: 200000 } }),
    expect: { 'kpis.belowFloor': true },
  },
  {
    id: 'SRV-E05-DISCOUNT-NEGATIVE-MARGIN',
    title: 'Extremo: tarifa ofrecida con descuento comercial 30 % → margen negativo',
    family: 'edge',
    build: () => service({ id: 'srv-e05', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 12 }, labor: [person({ positions: 2, basicMonthly: 1800000 })], pricing: { offeredRateOverride: 900000, commercialDiscountPct: 30 } }),
  },
  {
    id: 'SRV-E06-NO-FIXED',
    title: 'Extremo: sin costos fijos (sólo variables): equilibrio desde la primera unidad',
    family: 'edge',
    build: () => service({ id: 'srv-e06', serviceType: 'transport', unit: 'trip', activity: { billableQuantityPerMonth: 20, unitsPerActiveDay: 2 }, equipment: [external({ name: 'Flete tercerizado' }, { price: 350000, unit: 'trip' })], logistics: route({ distanceKm: 50 }), indirect: { method: 'percent_direct', pct: 5 } }),
    expect: { 'kpis.breakEvenZeroReason': 'no_fixed_costs' },
  },
  {
    id: 'SRV-E07-NO-VARIABLE',
    title: 'Extremo: sin costos variables (sólo fijos)',
    family: 'edge',
    build: () => service({ id: 'srv-e07', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 14 }, labor: [person({ positions: 2, basicMonthly: 1900000 })], equipment: [owned({ name: 'Contenedor oficina', replacementValue: 12000000, usefulLifeYears: 10 })] }),
  },
  {
    id: 'SRV-E08-FRACTIONAL',
    title: 'Extremo: cantidades fraccionarias (1.234,56 m³, 87,3 m³/día, 1,5 días por salida)',
    family: 'edge',
    build: () => service({ id: 'srv-e08', serviceType: 'per_unit', unit: 'm3', activity: { billableQuantityPerMonth: 1234.56, unitsPerActiveDay: 87.3, daysPerActivation: 1.5 }, labor: [person({ basicMonthly: 1800000, mealPerActiveDay: 12345.67 })], logistics: route({ distanceKm: 33.3, vehicles: [vehicle()] }) }),
  },
  {
    id: 'SRV-E09-OVER-AVAILABLE',
    title: 'Extremo: 35 días activos con 30 disponibles (fijos prorrateados)',
    family: 'edge',
    build: () => service({ id: 'srv-e09', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 35, availableDaysPerMonth: 30 }, labor: [person({ positions: 2, basicMonthly: 1700000, mealPerActiveDay: 15000 })], rules: { availabilityFeeMonthly: 500000 } }),
  },
  {
    id: 'SRV-E10-MARGIN-INVALID',
    title: 'Extremo: margen objetivo 100 % (inválido: sin tarifa sugerida)',
    family: 'edge',
    build: () => service({ id: 'srv-e10', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ basicMonthly: 1700000 })], pricing: { targetMarginPct: 100 } }),
    expect: { 'kpis.suggestedListRate': null, targetMarginInvalid: true },
  },
  {
    id: 'SRV-E11-MARGIN-PLUS-TAXES-100',
    title: 'Extremo: margen 96 % + impuestos 5 % (llega a 100 %: no hay precio)',
    family: 'edge',
    build: () => service({ id: 'srv-e11', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ basicMonthly: 1700000 })], pricing: { targetMarginPct: 96 }, billingTaxes: taxes(5) }),
    expect: { 'kpis.suggestedListRate': null, targetMarginInvalid: true },
  },
  {
    id: 'SRV-E12-BLANK',
    title: 'Extremo: cotización en blanco recién creada',
    family: 'edge',
    build: () => createEmptyQuote({ organizationId: LAB_ORG, settings: LAB_SETTINGS, now: LAB_NOW, id: 'srv-e12', code: 'COT-LAB-E12' }),
  },
  {
    id: 'SRV-E13-EXT-VAT-PARTIAL',
    title: 'Extremo: externo con IVA recuperable en parte (50 %) y percepciones 3 %',
    family: 'edge',
    build: () => service({ id: 'srv-e13', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 12 }, equipment: [external({ name: 'Grupo electrógeno alquilado', acquisition: 'rented' }, { price: 180000, unit: 'day', operatorIncluded: false, fiscal: { vatPct: 21, vatRecoverable: 'partial', vatRecoverablePct: 50, perceptionsPct: 3 } })] }),
  },
  {
    id: 'SRV-E14-EXT-KM-NO-ROUTE',
    title: 'Extremo: proveedor $/km sin distancia → crítico "Falta definir la ruta" (v0.7.2)',
    family: 'edge',
    build: () => {
      const q = cot0010Quote({ code: 'COT-LAB-E14' });
      q.logistics.distanceKm = 0;
      return q;
    },
    ux: { critical: ['external_route'], focus: { external_route: 'logistics.distanceKm' } },
  },
  {
    id: 'SRV-E15-INCONSISTENT-TRIPS',
    title: 'Extremo: COT-0011 con "Viajes por llamado" = 1 (dato viejo): se derivan 2 y se avisa (golden)',
    family: 'edge',
    build: () => cot0011Quote({ tripsPerActivation: 1, code: 'COT-LAB-E15' }),
    expect: { 'model.transport.physicalTripsPerMonth': 12, 'model.transport.storedDiffers': true },
    ux: { notices: ['transport_trips'] },
  },
  {
    id: 'SRV-E17-FUEL-PER-KM-NO-TRAVEL',
    title: 'Extremo: combustible del proveedor por km a nuestro cargo con "Sin traslados" marcado',
    family: 'edge',
    build: () => {
      const q = cot0010Quote({ code: 'COT-LAB-E17' });
      q.equipment[0].external = { ...q.equipment[0].external, fuelIncluded: false, fuelMode: 'per_100km', fuelLitersPer100Km: 35 };
      q.logistics.notApplicable = true;
      return q;
    },
    ux: { critical: ['external_route'], focus: { external_route: 'logistics.notApplicable' } },
  },
  {
    id: 'SRV-E16-STRINGS-AND-NEGATIVES',
    title: 'Extremo: valores vacíos ("") y negativos inválidos (se sanean a 0 y se informan)',
    family: 'edge',
    build: () => service({
      id: 'srv-e16', serviceType: 'crew', unit: 'day',
      activity: { activeDaysPerMonth: '12', hoursPerActiveDay: '' },
      labor: [person({ basicMonthly: '1800000', mealPerActiveDay: -5000, positions: '' })],
      materials: [material({ quantity: -3, unitCost: 1000 })],
      pricing: { targetMarginPct: '12,5' },
    }),
  },

  // ------------------------------------------- decisiones del dueño LAB-D1…D8 (PLAN-2026-014)
  {
    id: 'SRV-D1-BELOW-ONE-AVERAGE',
    title: 'D1: 0,5 salidas por mes con la opción apagada: se costea el promedio y se avisa (salidas promedio / costeadas / efecto)',
    family: 'decisions',
    build: () => service({ id: 'srv-d1a', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 2, daysPerActivation: 4 }, labor: [person({ role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', fuelLitersPerHour: 8, mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 250, driver: 'operator' } })], logistics: route({ distanceKm: 150, tollsPerActivation: 40000 }) }),
    expect: { 'activationRounding.estimated': 0.5, 'activationRounding.costed': 0.5, 'activationRounding.preview.wholeActivations': 1 },
    ux: { notices: ['activations_below_one'] },
  },
  {
    id: 'SRV-D1-BELOW-ONE-WHOLE',
    title: 'D1: 0,5 salidas por mes con "cada salida se cuenta completa": la salida indivisible se costea entera (⌈0,5⌉ = 1)',
    family: 'decisions',
    build: () => service({ id: 'srv-d1b', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 2, daysPerActivation: 4, fullActivations: true }, labor: [person({ role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', fuelLitersPerHour: 8, mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 250, driver: 'operator' } })], logistics: route({ distanceKm: 150, tollsPerActivation: 40000 }) }),
    expect: { 'activationRounding.costed': 1 },
  },
  {
    id: 'SRV-D2-HOURS-SHORT',
    title: 'D2: 12 h × 20 días con 1 persona de 176 h por posición: aviso "más horas de cobertura que las horas cargadas" (el costo no cambia)',
    family: 'decisions',
    build: () => service({ id: 'srv-d2a', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 12 }, labor: [person({ role: 'Soldador', positions: 2 })] }),
    ux: { itemStatus: { labor_hours: 'warning' } },
  },
  {
    id: 'SRV-D2-HOURS-COVERED',
    title: 'D2: 24 h × 20 días con 4 personas por posición (704 h): sin aviso',
    family: 'decisions',
    build: () => service({ id: 'srv-d2b', serviceType: 'permanent', unit: 'month', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 24 }, labor: [person({ role: 'Guardia', positions: 1, peoplePerPosition: 4 })] }),
  },
  {
    id: 'SRV-D4-KM-BILLED-ROUTE',
    title: 'D4: cobro por km con km facturables = km de ruta (2.400): los dos datos separados, relación 1',
    family: 'decisions',
    build: () => service({ id: 'srv-d4', serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 2400, unitsPerActiveDay: 400, daysPerActivation: 1 }, labor: [person({ role: 'Chofer' })],
      equipment: [external({ name: 'Camión' }, { price: 3250, unit: 'km', fuelIncluded: true })], logistics: route({ destinationName: 'Añelo', tripsPerActivation: 2 }) }),
    expect: { 'model.transport.billableKmPerMonth': 2400, 'model.transport.routeKmPerMonth': 2400, 'model.transport.billableToRouteKm': 1 },
  },
  {
    id: 'SRV-D5-NO-FUEL',
    title: 'D5: equipo propio "No usa combustible" que va por sus medios: sin combustible trabajando ni en ruta, sí el desgaste',
    family: 'decisions',
    build: () => service({ id: 'srv-d5', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()],
      equipment: [owned({ name: 'Plataforma eléctrica', fuelNotApplicable: true, fuelLitersPerHour: 5, mobilization: { mode: 'self', travelLitersPer100Km: 20, travelCostPerKm: 150, driver: 'other' } })], logistics: route({ distanceKm: 60 }) }),
    ux: { itemStatus: { fuel: 'ok' } },
  },
  {
    id: 'SRV-D7-ILLUSTRATIVE-FUEL',
    title: 'D7: cotización real nueva con el precio de combustible de ejemplo: no cuenta como definido',
    family: 'decisions',
    build: () => {
      const q = service({ id: 'srv-d7', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [owned({ name: 'Grupo electrógeno', fuelLitersPerHour: 6 })] });
      q.fuel = { ...q.fuel, illustrative: true, requiresConfirmation: true };
      return q;
    },
    ux: { itemStatus: { fuel: 'missing' } },
  },
  {
    id: 'SRV-D8-PERMANENT-NEUTRAL',
    title: 'D8: servicio permanente: la activación se llama "intervención" (neutral: RATEOS no sabe si es un relevo), nunca "cambio de turno"',
    family: 'decisions',
    build: () => service({ id: 'srv-d8a', serviceType: 'permanent', unit: 'month', activity: { activeDaysPerMonth: 30, daysPerActivation: 7, hoursPerActiveDay: 8 }, labor: [person({ role: 'Vigilador', positions: 1, peoplePerPosition: 2 })], logistics: route({ distanceKm: 40, vehicles: [vehicle()] }) }),
  },
  {
    id: 'SRV-D8-TURNKEY-JOB',
    title: 'D8: llave en mano por trabajo: la activación se llama "trabajo" en todos los textos',
    family: 'decisions',
    build: () => service({ id: 'srv-d8b', serviceType: 'turnkey', unit: 'job', activity: { billableQuantityPerMonth: 0.5, daysPerActivation: 20 }, labor: [person({ role: 'Oficial' })], logistics: route({ distanceKm: 90, tollsPerActivation: 15000, vehicles: [vehicle()] }) }),
  },
];
