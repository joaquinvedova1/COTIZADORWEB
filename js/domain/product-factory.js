/**
 * Productos (PLAN-2026-008): fábricas del producto y de sus líneas.
 *
 * Las líneas que vienen de Recursos se arman con los MISMOS factories que la
 * cotización (laborLineFromProfile, equipmentLineFromLibrary,
 * materialLineFromLibrary): guardan una COPIA de los valores (snapshot), así
 * cambiar un recurso nunca cambia un producto ya armado (AGENTS.md §5.1) y
 * se puede avisar con [Actualizar] / [Conservar valor original].
 *
 * Puras: reciben ids y fechas desde afuera cuando hace falta determinismo.
 */

import { createId } from '../core/ids.js';
import { deepClone, isPlainObject } from '../core/object.js';
import { CURRENCY } from '../config.js';
import { MEASURE_UNITS, MEASURE_UNIT_ALIASES } from './catalogs.js';
import { normalizeBase } from './economic-base.js';
import { laborLineFromProfile, equipmentLineFromLibrary, materialLineFromLibrary, billingTaxesForNewQuote, companyCurrency, normalizeExchangeRates } from './quote-factory.js';
import { emptyBillingTaxes } from './billing-taxes.js';

const MAX_NAME = 120;
const shortText = (v, max = MAX_NAME) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Id de unidad conocida para texto libre ("Kilos" → "kg"), o el texto tal cual. */
function knownUnit(raw, fallback = 'u') {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const key = raw.trim().toLowerCase();
  if (MEASURE_UNITS.some((u) => u.id === key)) return key;
  return MEASURE_UNIT_ALIASES[key] || raw.trim().slice(0, 30);
}

/** Producto vacío. */
export function createEmptyProduct({ organizationId = null, settings = {}, now = new Date().toISOString(), id = createId() } = {}) {
  const currency = companyCurrency(settings);
  const margin = Number.isFinite(settings.defaultTargetMarginPct) ? settings.defaultTargetMarginPct : null;
  return {
    id,
    organizationId,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    name: 'Nuevo producto',
    saleUnit: 'unidad',
    unitsPerBatch: null,
    lossPct: 0,
    monthlyUnits: null,
    materials: [],
    labor: [],
    equipment: [],
    fixedCosts: [],
    pricing: { targetMarginPct: margin, roundingStep: 0, vatPct: null, currentPrice: null },
    billingTaxes: billingTaxesForNewQuote(settings),
    currency,
    exchangeRates: normalizeExchangeRates(settings.exchangeRates, { currency }),
    fuelPricePerLiter: Number.isFinite(settings.fuelPricePerLiter) ? settings.fuelPricePerLiter : 0,
    illustrative: false,
    notes: '',
  };
}

/**
 * Completa la forma de un producto (datos parciales o viejos) sin borrar nada.
 * Lo usa el editor antes de mostrarlo.
 */
export function normalizeProductShape(product = {}) {
  const p = isPlainObject(product) ? deepClone(product) : {};
  ['materials', 'labor', 'equipment', 'fixedCosts'].forEach((k) => {
    p[k] = Array.isArray(p[k]) ? p[k].filter(isPlainObject) : [];
  });
  p.pricing = { targetMarginPct: null, roundingStep: 0, vatPct: null, currentPrice: null, ...(isPlainObject(p.pricing) ? p.pricing : {}) };
  if (!isPlainObject(p.billingTaxes)) p.billingTaxes = emptyBillingTaxes();
  if (!Array.isArray(p.exchangeRates)) p.exchangeRates = [];
  if (typeof p.name !== 'string') p.name = 'Producto';
  if (typeof p.saleUnit !== 'string' || !p.saleUnit.trim()) p.saleUnit = 'unidad';
  return p;
}

// ---------------------------------------------------------------- líneas

/** Ingrediente o material desde Recursos → Materiales (copia con snapshot). */
export function productMaterialLine(mat = {}, { id = createId(), now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const base = materialLineFromLibrary(mat, { id, now, currency });
  const unit = knownUnit(mat.unit);
  return {
    ...base,
    unit,
    per: 'batch',
    useUnit: unit,
    quantity: null,
    priceMode: 'unit',
    packPrice: null,
    packSize: null,
  };
}

/** Ingrediente o material cargado a mano. */
export function blankProductMaterialLine({ id = createId(), per = 'batch', currency = CURRENCY } = {}) {
  return {
    id,
    sourceId: null,
    description: per === 'unit' ? 'Empaque' : 'Ingrediente',
    per: per === 'unit' ? 'unit' : 'batch',
    unit: per === 'unit' ? 'u' : 'kg',
    useUnit: per === 'unit' ? 'u' : 'kg',
    quantity: per === 'unit' ? 1 : null,
    unitCost: null,
    priceMode: 'unit',
    packPrice: null,
    packSize: null,
    wastePct: 0,
    base: normalizeBase(null, { currency }),
    snapshot: null,
    illustrative: false,
  };
}

/** Persona desde Recursos → Personal (con los parámetros de su convenio). */
export function productLaborLine(profile = {}, agreement = null, { id = createId(), now = new Date().toISOString(), currency = CURRENCY } = {}) {
  return { ...laborLineFromProfile(profile, agreement, { id, now, currency }), people: 1, minutesPerBatch: null };
}

/** Puesto cargado a mano (parámetros genéricos ILUSTRATIVOS hasta reemplazarlos). */
export function blankProductLaborLine({ id = createId(), currency = CURRENCY } = {}) {
  const line = productLaborLine({ role: 'Nuevo puesto' }, null, { id, currency });
  line.sourceId = null;
  line.snapshot = null;
  // Sueldo vacío (no $ 0): lo carga la empresa.
  line.basicMonthly = null;
  return line;
}

/**
 * Máquina o equipo desde Recursos → Mis equipos. `fixedSharePct` (qué parte de
 * sus costos fijos le toca a este producto) arranca SIN cargar: lo decide la
 * persona (nunca se infiere del uso).
 */
export function productEquipmentLine(eq = {}, { id = createId(), now = new Date().toISOString(), currency = CURRENCY } = {}) {
  const line = equipmentLineFromLibrary({ ...eq, acquisition: 'owned' }, { id, now, currency });
  return { ...line, external: null, minutesPerBatch: null, energyPerHour: null, fixedSharePct: null };
}

/** Máquina cargada a mano. */
export function blankProductEquipmentLine({ id = createId(), currency = CURRENCY } = {}) {
  const line = productEquipmentLine({}, { id, currency });
  line.name = 'Nueva máquina';
  line.familyId = null;
  line.sourceId = null;
  line.snapshot = null;
  // Campos vacíos (no $ 0 ni 0 años): los carga la empresa.
  line.replacementValue = null;
  line.usefulLifeYears = null;
  line.residualValue = null;
  line.insuranceAnnual = null;
  return line;
}

/** Gasto fijo del negocio (alquiler, servicios, contador…). */
export function createFixedCost({ id = createId(), description = 'Gasto fijo', monthlyAmount = null, sharePct = null } = {}) {
  return { id, description: shortText(description, 120) || 'Gasto fijo', monthlyAmount, sharePct };
}

// --------------------------------------------------------------- ejemplo

/**
 * Producto de EJEMPLO para aprender a usarlo: "Chipá". Todos los valores son
 * ILUSTRATIVOS (no son precios, sueldos ni costos reales) y quedan marcados.
 */
export function exampleProduct({ organizationId = null, settings = {}, now = new Date().toISOString(), id = createId(), idFactory = createId } = {}) {
  const p = createEmptyProduct({ organizationId, settings, now, id });
  const currency = p.currency;
  const ingredient = (description, quantity, useUnit, unit, unitCost, extra = {}) => ({
    ...blankProductMaterialLine({ id: idFactory(), currency }),
    description,
    quantity,
    useUnit,
    unit,
    unitCost,
    illustrative: true,
    ...extra,
  });
  p.name = 'Chipá (ejemplo)';
  p.saleUnit = 'unidad';
  p.unitsPerBatch = 60;
  p.lossPct = 5;
  p.monthlyUnits = 3000;
  p.illustrative = true;
  p.materials = [
    ingredient('Almidón de mandioca', 1, 'kg', 'kg', 2500, { priceMode: 'pack', packPrice: 25000, packSize: 10 }),
    ingredient('Queso', 600, 'g', 'kg', 9000),
    ingredient('Huevos', 6, 'u', 'docena', 3600),
    ingredient('Leche', 300, 'ml', 'l', 1200),
    ingredient('Grasa o manteca', 200, 'g', 'kg', 6000, { wastePct: 5 }),
    { ...ingredient('Bolsita', 1, 'u', 'u', 20), per: 'unit' },
  ];
  const cook = blankProductLaborLine({ id: idFactory(), currency });
  Object.assign(cook, { role: 'Panadero/a (ejemplo)', basicMonthly: 900000, minutesPerBatch: 90, people: 1, illustrative: true });
  p.labor = [cook];
  const oven = blankProductEquipmentLine({ id: idFactory(), currency });
  Object.assign(oven, {
    name: 'Horno (ejemplo)',
    replacementValue: 3000000,
    usefulLifeYears: 10,
    residualValue: 0,
    insuranceAnnual: 120000,
    maintenancePerHour: 100,
    minutesPerBatch: 40,
    energyPerHour: 1500,
    fixedSharePct: 50,
    illustrative: true,
  });
  p.equipment = [oven];
  p.fixedCosts = [
    createFixedCost({ id: idFactory(), description: 'Alquiler del local (ejemplo)', monthlyAmount: 600000, sharePct: 25 }),
    createFixedCost({ id: idFactory(), description: 'Luz, gas e internet fijos (ejemplo)', monthlyAmount: 150000, sharePct: 25 }),
  ];
  p.pricing = { ...p.pricing, targetMarginPct: 30, roundingStep: 10, vatPct: null, currentPrice: null };
  return p;
}
