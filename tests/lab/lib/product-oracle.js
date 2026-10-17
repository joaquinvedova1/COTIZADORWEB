/**
 * RATEOS Test Lab — ORÁCULO INDEPENDIENTE de productos (PLAN-2026-013).
 *
 * Fórmulas de docs/CALCULATION_RULES.md §23, escritas de nuevo (no importa
 * js/engines/). Un producto se fabrica por tandas y se vende por unidad:
 *
 *   S                    = unidades por tanda × (1 − pérdida %)
 *   ingrediente          = cantidad (en la unidad del precio) × precio por unidad × (1 + merma %)
 *   personal por tanda   = personas × minutos ÷ 60 × costo hora con cargas
 *   uso de máquinas      = minutos ÷ 60 × (mantenimiento/h + neumáticos/h + combustible/h + energía/h)
 *   fijos asignados      = tenencia × % asignado + gastos fijos × % asignado   (sin % → no suma, avisa)
 *   variable por unidad  = (receta + personal + uso) ÷ S + materiales por unidad
 *   fijo por unidad      = fijos asignados ÷ unidades por mes
 *   precio piso          = costo ÷ (1 − t);  precio = costo ÷ (1 − margen − t)
 *   equilibrio (u/mes)   = fijos ÷ (precio × (1 − t) − variable por unidad)
 */

import { n, div, currencyFactor, ownership, operation, billingTaxPct, commercialRound, readMargin } from './oracle.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const frac = (pts) => n(pts) / 100;

/** Unidades de medida (§23): masa, volumen y conteo; distinta dimensión no se convierte. */
const MEASURES = { kg: ['mass', 1000], g: ['mass', 1], l: ['volume', 1000], ml: ['volume', 1], u: ['count', 1], docena: ['count', 12] };
const ALIASES = { kgs: 'kg', kilo: 'kg', kilos: 'kg', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g', lt: 'l', lts: 'l', litro: 'l', litros: 'l', cc: 'ml', unidad: 'u', unidades: 'u', un: 'u', unid: 'u', docenas: 'docena', doc: 'docena' };
const unitKey = (raw) => {
  const k = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/\.$/, '') : '';
  return MEASURES[k] ? k : ALIASES[k] || null;
};
/** Cantidad en la unidad del precio (null si no se puede convertir). */
export function convert(quantity, from, to) {
  const a = unitKey(from);
  const b = unitKey(to);
  // Unidades que no son de medida (paquete, bolsa): sólo si son la misma.
  if (a === null || b === null) return String(from || '').trim().toLowerCase() === String(to || '').trim().toLowerCase() ? quantity : null;
  if (MEASURES[a][0] !== MEASURES[b][0]) return null;
  return (quantity * MEASURES[a][1]) / MEASURES[b][1];
}

export function oracleProduct(p) {
  const loss = Math.min(100, n(p.lossPct));
  const S = n(p.unitsPerBatch) * (1 - loss / 100);
  const N = n(p.monthlyUnits);

  let batchMaterials = 0;
  let unitMaterials = 0;
  for (const m of list(p.materials)) {
    const priceUnit = typeof m.unit === 'string' && m.unit.trim() ? m.unit.trim() : 'u';
    const useUnit = typeof m.useUnit === 'string' && m.useUnit.trim() ? m.useUnit.trim() : priceUnit;
    const unitPrice = m.priceMode === 'pack' ? div(n(m.packPrice), n(m.packSize), null) : n(m.unitCost);
    const qty = convert(n(m.quantity), useUnit, priceUnit);
    const factor = currencyFactor(m.base, p);
    const cost = unitPrice === null || qty === null || factor === null ? 0 : qty * unitPrice * factor * (1 + frac(m.wastePct));
    if (m.per === 'unit') unitMaterials += cost; else batchMaterials += cost;
  }

  let batchLabor = 0;
  for (const l of list(p.labor)) {
    // Costo hora con cargas = costo mensual por persona ÷ horas normales (§3 y §23).
    const remunerative = n(l.basicMonthly) + n(l.additionalsMonthly);
    const loadFactor = (1 + frac(l.sacPct) + frac(l.vacationPct)) * (1 + frac(l.employerContributionsPct) + frac(l.artPct));
    const monthly = remunerative * loadFactor + n(l.insuranceMonthly) + n(l.ppeMonthly) + n(l.trainingMonthly) + n(l.transferMonthly);
    const hourly = div(monthly, n(l.normalHoursPerMonth), null);
    batchLabor += hourly === null ? 0 : (n(l.people, 1) * n(l.minutesPerBatch) * hourly) / 60;
  }

  let batchUse = 0;
  let equipmentFixed = 0;
  for (const e of list(p.equipment)) {
    const factor = currencyFactor(e.base, p);
    const own = ownership(e, factor ?? 0);
    const op = operation(e, n(p.fuelPricePerLiter));
    batchUse += (n(e.minutesPerBatch) * (op.nonFuelPerHour + op.fuelPerHour + n(e.energyPerHour))) / 60;
    const share = typeof e.fixedSharePct === 'number' && Number.isFinite(e.fixedSharePct) ? Math.min(100, Math.max(0, e.fixedSharePct)) : null;
    equipmentFixed += share === null ? 0 : own.total * (share / 100);
  }
  let otherFixed = 0;
  for (const f of list(p.fixedCosts)) {
    const share = typeof f.sharePct === 'number' && Number.isFinite(f.sharePct) ? Math.min(100, Math.max(0, f.sharePct)) : null;
    otherFixed += share === null ? 0 : n(f.monthlyAmount) * (share / 100);
  }
  const fixedMonthly = equipmentFixed + otherFixed;
  const variablePerUnit = S > 0 ? (batchMaterials + batchLabor + batchUse) / S + unitMaterials : null;
  const fixedPerUnit = fixedMonthly <= 0 ? 0 : div(fixedMonthly, N, null);
  const unitCost = variablePerUnit !== null && fixedPerUnit !== null ? variablePerUnit + fixedPerUnit : null;

  const t = billingTaxPct(p.billingTaxes).t;
  const pricing = isObj(p.pricing) ? p.pricing : {};
  const margin = readMargin(pricing.targetMarginPct);
  const m = margin.state === 'ok' ? margin.value : 0;
  const price = (marginPct) => (unitCost === null || !(marginPct + t < 100) ? null : (unitCost * 100) / (100 - marginPct - t));
  const floorPrice = price(0);
  const targetPrice = price(m);
  const suggestedPrice = commercialRound(targetPrice, pricing.roundingStep);
  const vat = typeof pricing.vatPct === 'number' && pricing.vatPct > 0 && pricing.vatPct < 100 ? pricing.vatPct : null;
  const breakEven = (pr) => {
    if (pr === null || variablePerUnit === null) return null;
    if (fixedMonthly <= 0) return 0;
    const contribution = pr * (1 - t / 100) - variablePerUnit;
    return contribution > 0 ? fixedMonthly / contribution : null;
  };
  const current = typeof pricing.currentPrice === 'number' && pricing.currentPrice > 0 ? pricing.currentPrice : null;
  return {
    sellablePerBatch: S,
    monthlyUnits: N,
    perBatch: { materials: batchMaterials, labor: batchLabor, equipmentUse: batchUse },
    materialsPerUnitDirect: unitMaterials,
    fixedMonthly,
    variablePerUnit,
    fixedPerUnit,
    unitCost,
    taxPct: t,
    marginPct: m,
    floorPrice,
    targetPrice,
    suggestedPrice,
    priceWithVat: suggestedPrice !== null && vat !== null ? suggestedPrice * (1 + vat / 100) : null,
    markupPct: suggestedPrice === null ? null : div((suggestedPrice - unitCost) * 100, unitCost, null),
    breakEvenUnits: breakEven(suggestedPrice),
    monthlyProfit: suggestedPrice === null || variablePerUnit === null ? null : suggestedPrice * N * (1 - t / 100) - variablePerUnit * N - fixedMonthly,
    current: current === null ? null : {
      price: current,
      marginPct: unitCost === null ? null : (1 - t / 100 - unitCost / current) * 100,
      breakEvenUnits: breakEven(current),
      belowFloor: floorPrice !== null && current < floorPrice,
      belowVariable: variablePerUnit !== null && current * (1 - t / 100) <= variablePerUnit,
    },
  };
}
