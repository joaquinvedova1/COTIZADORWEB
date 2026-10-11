/**
 * ProductEngine — costo por unidad y precio de un PRODUCTO (PLAN-2026-008).
 *
 * Un producto se fabrica por TANDAS (una receta rinde N unidades) y se vende
 * por unidad. Separa siempre lo que depende de cuánto producís (variable) de
 * lo que pagás igual cada mes (fijo):
 *
 *   S (vendibles por tanda) = unidades por tanda × (1 − pérdida %)
 *
 *   Ingrediente / material  = cantidad usada (en la unidad del precio) × precio por unidad × (1 + merma %)
 *                             precio por unidad = cargado, o precio del paquete / contenido
 *                             va por tanda (receta) o por unidad (empaque, etiqueta)
 *   Personal por tanda      = personas × minutos por tanda / 60 × costo hora con cargas
 *                             costo hora = costo mensual por persona / horas normales (LaborEngine)
 *   Uso de máquinas         = minutos por tanda / 60 × (mantenimiento/h + neumáticos/h + combustible/h + energía/h)
 *   Tenencia de máquinas    = posesión mensual (amortización, seguro, patente, certificaciones,
 *                             mantenimiento fijo, costo de capital) × % asignado (FIJO)
 *   Gastos fijos            = monto mensual × % asignado (FIJO)
 *
 *   variable por unidad = (ingredientes por tanda + personal + uso de máquinas) / S + materiales por unidad
 *   fijo por unidad     = fijos asignados del mes / unidades vendidas por mes
 *   costo por unidad    = variable por unidad + fijo por unidad
 *
 * Precio (mismas reglas que las cotizaciones; margen ≠ markup, AGENTS.md §9):
 *   precio piso         = costo / (1 − t)                       (t: impuestos sobre lo que vendés)
 *   precio con margen   = costo / (1 − margen − t)              (margen sobre el precio)
 *   precio sugerido     = redondeo comercial hacia arriba
 *   precio al público   = precio × (1 + IVA %)                  (sólo si la empresa carga el IVA)
 *   equilibrio (u/mes)  = fijos asignados / (precio × (1 − t) − variable por unidad)
 *
 * El % de los fijos que se asigna al producto es SIEMPRE un dato explícito:
 * nunca se infiere del uso (PLAN-2026-006). Función pura: sin DOM, storage,
 * red, fecha actual ni aleatoriedad.
 */

import { MEASURE_UNITS, MEASURE_UNIT_ALIASES } from '../domain/catalogs.js';
import { isPlainObject, objectList } from '../core/object.js';
import { isFiniteNumber, nonNegative, pct, safeDivide, roundPercentagesToTotal } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { computeLaborLine } from './labor-engine.js';
import { computeOwnership, computeOperation } from './equipment-engine.js';
import { billingTaxConfigInfo } from './billing-taxes-engine.js';
import { conversionFactor, quoteCurrency, currencyOfBase } from './currency-engine.js';
import {
  isValidMarginPct,
  isValidMarginAndTaxes,
  priceFromMarginAndTaxes,
  markupFromPrice,
  commercialRound,
} from './pricing-engine.js';

// ---------------------------------------------------------------- unidades

/** Id de unidad conocida a partir de texto libre ("Kilos" → "kg"), o null. */
export function unitIdOf(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!key) return null;
  if (MEASURE_UNITS.some((u) => u.id === key)) return key;
  return MEASURE_UNIT_ALIASES[key] || null;
}

/**
 * Convierte una cantidad entre unidades de la misma dimensión (g ↔ kg,
 * ml ↔ l, unidad ↔ docena). Unidades iguales (aunque no se conozcan) → la
 * misma cantidad. Incompatibles o desconocidas y distintas → null.
 */
export function convertQuantity(quantity, fromUnit, toUnit) {
  if (!isFiniteNumber(quantity)) return null;
  const fromText = typeof fromUnit === 'string' ? fromUnit.trim().toLowerCase() : '';
  const toText = typeof toUnit === 'string' ? toUnit.trim().toLowerCase() : '';
  const from = MEASURE_UNITS.find((u) => u.id === unitIdOf(fromText));
  const to = MEASURE_UNITS.find((u) => u.id === unitIdOf(toText));
  if (from && to) return from.dimension === to.dimension ? (quantity * from.factor) / to.factor : null;
  return fromText === toText ? quantity : null;
}

// ------------------------------------------------------------------ líneas

function factorOfBase(base, product) {
  const currency = currencyOfBase(base);
  return currency ? conversionFactor(currency, product) : 1;
}

/**
 * Un ingrediente o material.
 * @returns {{ id, description, per: 'batch'|'unit', unitPrice: number|null, quantityInPriceUnit: number|null, cost: number, issue: string|null, currencyGap: boolean }}
 */
export function computeProductMaterialLine(line = {}, product = {}) {
  const per = line.per === 'unit' ? 'unit' : 'batch';
  const priceUnit = typeof line.unit === 'string' && line.unit.trim() ? line.unit.trim() : 'u';
  const useUnit = typeof line.useUnit === 'string' && line.useUnit.trim() ? line.useUnit.trim() : priceUnit;
  const quantity = nonNegative(line.quantity);
  const wastePct = nonNegative(line.wastePct);
  let issue = null;
  let unitPrice;
  if (line.priceMode === 'pack') {
    const packSize = nonNegative(line.packSize);
    unitPrice = packSize > 0 ? nonNegative(line.packPrice) / packSize : null;
    if (unitPrice === null) issue = 'pack_size_missing';
  } else {
    unitPrice = nonNegative(line.unitCost);
  }
  const factor = factorOfBase(line.base, product);
  const currencyGap = factor === null;
  const quantityInPriceUnit = convertQuantity(quantity, useUnit, priceUnit);
  if (quantityInPriceUnit === null && !issue) issue = 'incompatible_units';
  const cost = unitPrice === null || quantityInPriceUnit === null || currencyGap
    ? 0
    : quantityInPriceUnit * unitPrice * factor * (1 + pct(wastePct));
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    per,
    priceUnit,
    useUnit,
    quantity,
    wastePct,
    unitPrice: unitPrice === null ? null : unitPrice * (factor || 0),
    quantityInPriceUnit,
    cost,
    issue,
    currencyGap,
  };
}

/** Personal: costo hora con cargas (LaborEngine) × tiempo por tanda. */
export function computeProductLaborLine(line = {}) {
  const labor = computeLaborLine({ ...line, positions: 1, peoplePerPosition: 1 });
  const hourlyCost = labor.perPerson.loadedHourlyCost;
  const people = nonNegative(line.people, 1);
  const minutesPerBatch = nonNegative(line.minutesPerBatch);
  const costPerBatch = hourlyCost === null ? 0 : (people * minutesPerBatch * hourlyCost) / 60;
  return {
    id: line.id ?? null,
    role: line.role ?? '',
    people,
    minutesPerBatch,
    hourlyCost,
    monthlyPerPerson: labor.perPerson.fixedMonthly,
    normalHoursPerMonth: nonNegative(line.normalHoursPerMonth),
    costPerBatch,
    issue: hourlyCost === null ? 'normal_hours_missing' : null,
  };
}

/** Máquina o equipo: uso por tanda (variable) y tenencia asignada (fija). */
export function computeProductEquipmentLine(line = {}, product = {}) {
  const factor = factorOfBase(line.base, product);
  const currencyGap = factor === null;
  const converted = factor === 1 || factor === null
    ? line
    : { ...line, replacementValue: nonNegative(line.replacementValue) * factor, residualValue: nonNegative(line.residualValue) * factor };
  const ownership = computeOwnership(currencyGap ? { ...line, replacementValue: 0, residualValue: 0 } : converted);
  const operation = computeOperation(line, { fuelPricePerLiter: nonNegative(product.fuelPricePerLiter) });
  const energyPerHour = nonNegative(line.energyPerHour);
  const usePerHour = operation.totalPerHour + energyPerHour;
  const minutesPerBatch = nonNegative(line.minutesPerBatch);
  const useCostPerBatch = (minutesPerBatch * usePerHour) / 60;
  const sharePct = isFiniteNumber(line.fixedSharePct) ? Math.min(100, Math.max(0, line.fixedSharePct)) : null;
  const fixedAssigned = sharePct === null ? 0 : ownership.totalMonthly * pct(sharePct);
  return {
    id: line.id ?? null,
    name: line.name ?? '',
    minutesPerBatch,
    energyPerHour,
    operation,
    usePerHour,
    useCostPerBatch,
    ownership,
    ownershipMonthly: ownership.totalMonthly,
    sharePct,
    fixedAssigned,
    currencyGap,
    issue: sharePct === null && ownership.totalMonthly > 0 ? 'share_missing' : null,
  };
}

/** Gasto fijo del negocio: monto mensual × % asignado al producto. */
export function computeProductFixedCost(line = {}) {
  const monthlyAmount = nonNegative(line.monthlyAmount);
  const sharePct = isFiniteNumber(line.sharePct) ? Math.min(100, Math.max(0, line.sharePct)) : null;
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    monthlyAmount,
    sharePct,
    assigned: sharePct === null ? 0 : monthlyAmount * pct(sharePct),
    issue: sharePct === null && monthlyAmount > 0 ? 'share_missing' : null,
  };
}

// ---------------------------------------------------------------- producto

/** Margen después de impuestos que deja un precio: 1 − t − costo / precio (en %). */
function marginAfterTaxesPct(cost, price, t) {
  if (!isFiniteNumber(cost) || !isFiniteNumber(price) || price <= 0) return null;
  return (1 - pct(t) - cost / price) * 100;
}

/** Unidades por mes para cubrir los fijos con un precio (null si no se alcanza nunca). */
export function productBreakEvenUnits({ fixedMonthly, variablePerUnit, price, taxPct = 0 }) {
  if (!isFiniteNumber(fixedMonthly) || !isFiniteNumber(variablePerUnit) || !isFiniteNumber(price)) return null;
  if (fixedMonthly <= 0) return 0;
  const contribution = price * (1 - pct(taxPct)) - variablePerUnit;
  return contribution > 0 ? fixedMonthly / contribution : null;
}

/**
 * Valida un producto: lista de { path, message, severity: 'error'|'warning' }.
 * Errores = el resultado no se puede calcular o es inválido; avisos = falta un dato.
 */
export function validateProduct(product = {}, computed = null) {
  const p = isPlainObject(product) ? product : {};
  const issues = [];
  const r = computed || computeProductParts(p);
  if (!(nonNegative(p.unitsPerBatch) > 0)) issues.push({ path: 'unitsPerBatch', message: 'Cargá cuántas unidades salen de cada tanda (receta).', severity: 'error' });
  else if (!(r.sellablePerBatch > 0)) issues.push({ path: 'lossPct', message: 'Con esa pérdida no queda ninguna unidad para vender: revisá el %.', severity: 'error' });
  if (!(nonNegative(p.monthlyUnits) > 0) && r.fixedMonthly > 0) issues.push({ path: 'monthlyUnits', message: 'Cargá cuántas unidades vendés por mes: sin eso los gastos fijos no se pueden repartir por unidad.', severity: 'error' });
  const m = isPlainObject(p.pricing) ? p.pricing.targetMarginPct : null;
  if (m !== null && m !== undefined && !isValidMarginPct(m)) issues.push({ path: 'pricing.targetMarginPct', message: 'El margen debe ser mayor o igual a 0 y menor a 100 %.', severity: 'error' });
  else if (isValidMarginPct(m) && !isValidMarginAndTaxes(m, r.taxPct)) issues.push({ path: 'pricing.targetMarginPct', message: 'El margen más los impuestos sobre la venta llegan a 100 % o más: no hay precio posible.', severity: 'error' });
  if (r.taxInfo.invalid) issues.push({ path: 'billingTaxes', message: 'Revisá los impuestos sobre la venta: hay un porcentaje inválido.', severity: 'error' });
  else if (!r.taxInfo.defined) issues.push({ path: 'billingTaxes', message: 'No cargaste los impuestos sobre lo que vendés (Ingresos Brutos, tasa municipal…): el precio no los incluye. Cargalos o marcá que no corresponden.', severity: 'warning' });
  r.materials.forEach((line, i) => {
    if (line.issue === 'incompatible_units') issues.push({ path: `materials.${i}.useUnit`, message: `"${line.description || 'Ingrediente'}": la unidad que usás (${line.useUnit}) no se puede pasar a la del precio (${line.priceUnit}).`, severity: 'error' });
    if (line.issue === 'pack_size_missing') issues.push({ path: `materials.${i}.packSize`, message: `"${line.description || 'Ingrediente'}": cargá cuánto trae el paquete.`, severity: 'warning' });
    if (line.currencyGap) issues.push({ path: `materials.${i}.base.currency`, message: `"${line.description || 'Ingrediente'}" está en otra moneda: cargá el tipo de cambio.`, severity: 'error' });
  });
  r.labor.forEach((line, i) => {
    if (line.issue === 'normal_hours_missing') issues.push({ path: `labor.${i}.normalHoursPerMonth`, message: `"${line.role || 'Puesto'}": cargá las horas normales del mes para calcular el costo hora.`, severity: 'warning' });
    if (isFiniteNumber(line.usedPct) && line.usedPct > 100) issues.push({ path: `labor.${i}.minutesPerBatch`, message: `"${line.role || 'Puesto'}": con las unidades que vendés por mes necesitaría más horas de las que trabaja en el mes. Revisá los minutos por tanda, las personas o las ventas.`, severity: 'warning' });
  });
  r.equipment.forEach((line, i) => {
    if (line.issue === 'share_missing') issues.push({ path: `equipment.${i}.fixedSharePct`, message: `"${line.name || 'Máquina'}": cargá qué parte de sus costos fijos le toca a este producto.`, severity: 'warning' });
    if (line.currencyGap) issues.push({ path: `equipment.${i}.base.currency`, message: `"${line.name || 'Máquina'}": el valor está en otra moneda; cargá el tipo de cambio.`, severity: 'error' });
  });
  r.fixedCosts.forEach((line, i) => {
    if (line.issue === 'share_missing') issues.push({ path: `fixedCosts.${i}.sharePct`, message: `"${line.description || 'Gasto fijo'}": cargá qué parte le toca a este producto.`, severity: 'warning' });
  });
  return issues;
}

/** Partes del cálculo (sin precio): líneas, totales por tanda, por unidad y del mes. */
function computeProductParts(p) {
  const unitsPerBatch = nonNegative(p.unitsPerBatch);
  const lossPct = Math.min(100, nonNegative(p.lossPct));
  const sellablePerBatch = unitsPerBatch * (1 - pct(lossPct));
  const monthlyUnits = nonNegative(p.monthlyUnits);

  const batchesPerMonth = safeDivide(monthlyUnits, sellablePerBatch, null);
  const materials = objectList(p.materials).map((l) => computeProductMaterialLine(l, p));
  // Horas del mes que cada persona dedica a este producto (informativo: el
  // costo es por minuto de tanda; las horas pagadas que no se usan acá no
  // entran en este producto).
  const labor = objectList(p.labor).map((l) => {
    const line = computeProductLaborLine(l);
    const hoursPerMonth = batchesPerMonth === null || !(monthlyUnits > 0) ? null : (batchesPerMonth * line.minutesPerBatch) / 60;
    const usedPct = hoursPerMonth === null ? null : safeDivide(hoursPerMonth * 100, line.normalHoursPerMonth, null);
    return { ...line, hoursPerMonth, usedPct };
  });
  const equipment = objectList(p.equipment).map((l) => computeProductEquipmentLine(l, p));
  const fixedCosts = objectList(p.fixedCosts).map((l) => computeProductFixedCost(l));

  const materialsPerBatch = materials.filter((l) => l.per === 'batch').reduce((s, l) => s + l.cost, 0);
  const materialsPerUnitDirect = materials.filter((l) => l.per === 'unit').reduce((s, l) => s + l.cost, 0);
  const laborPerBatch = labor.reduce((s, l) => s + l.costPerBatch, 0);
  const equipmentUsePerBatch = equipment.reduce((s, l) => s + l.useCostPerBatch, 0);
  const variablePerBatch = materialsPerBatch + laborPerBatch + equipmentUsePerBatch;

  const equipmentFixedMonthly = equipment.reduce((s, l) => s + l.fixedAssigned, 0);
  const otherFixedMonthly = fixedCosts.reduce((s, l) => s + l.assigned, 0);
  const fixedMonthly = equipmentFixedMonthly + otherFixedMonthly;

  const perBatchShare = (amount) => (sellablePerBatch > 0 ? amount / sellablePerBatch : null);
  const perUnit = {
    materials: sellablePerBatch > 0 ? materialsPerBatch / sellablePerBatch + materialsPerUnitDirect : null,
    materialsBatch: perBatchShare(materialsPerBatch),
    materialsUnit: materialsPerUnitDirect,
    labor: perBatchShare(laborPerBatch),
    equipmentUse: perBatchShare(equipmentUsePerBatch),
    equipmentFixed: fixedMonthly <= 0 ? 0 : safeDivide(equipmentFixedMonthly, monthlyUnits, null),
    otherFixed: fixedMonthly <= 0 ? 0 : safeDivide(otherFixedMonthly, monthlyUnits, null),
  };
  const variablePerUnit = sellablePerBatch > 0 ? variablePerBatch / sellablePerBatch + materialsPerUnitDirect : null;
  const fixedPerUnit = fixedMonthly <= 0 ? 0 : safeDivide(fixedMonthly, monthlyUnits, null);
  const unitCost = variablePerUnit !== null && fixedPerUnit !== null ? variablePerUnit + fixedPerUnit : null;

  const taxInfo = billingTaxConfigInfo(p.billingTaxes);
  return {
    unitsPerBatch,
    lossPct,
    sellablePerBatch,
    monthlyUnits,
    batchesPerMonth,
    materials,
    labor,
    equipment,
    fixedCosts,
    perBatch: { materials: materialsPerBatch, labor: laborPerBatch, equipmentUse: equipmentUsePerBatch, variable: variablePerBatch },
    perUnit,
    materialsPerUnitDirect,
    equipmentFixedMonthly,
    otherFixedMonthly,
    fixedMonthly,
    variablePerUnit,
    fixedPerUnit,
    unitCost,
    taxInfo,
    taxPct: taxInfo.pct,
  };
}

/**
 * Calcula un producto completo.
 * @param {object} product
 * @returns {object} { ...partes, pricing, monthly, current, breakdown, issues, traces }
 */
export function computeProduct(product = {}) {
  const p = isPlainObject(product) ? product : {};
  const r = computeProductParts(p);
  const pricingIn = isPlainObject(p.pricing) ? p.pricing : {};
  const marginPct = isValidMarginPct(pricingIn.targetMarginPct) ? pricingIn.targetMarginPct : 0;
  const t = r.taxPct;
  const roundingStep = nonNegative(pricingIn.roundingStep);
  const vatPct = isFiniteNumber(pricingIn.vatPct) && pricingIn.vatPct > 0 && pricingIn.vatPct < 100 ? pricingIn.vatPct : null;

  const floorPrice = r.unitCost === null ? null : priceFromMarginAndTaxes(r.unitCost, 0, t);
  const targetPrice = r.unitCost === null ? null : priceFromMarginAndTaxes(r.unitCost, marginPct, t);
  const suggestedPrice = targetPrice === null ? null : commercialRound(targetPrice, roundingStep);
  const priceWithVat = suggestedPrice !== null && vatPct !== null ? suggestedPrice * (1 + pct(vatPct)) : null;
  const markupPct = suggestedPrice === null ? null : markupFromPrice(r.unitCost, suggestedPrice);
  const realMarginPct = marginAfterTaxesPct(r.unitCost, suggestedPrice, t);
  const breakEvenUnits = productBreakEvenUnits({ fixedMonthly: r.fixedMonthly, variablePerUnit: r.variablePerUnit, price: suggestedPrice, taxPct: t });

  // Resultado del mes con el precio sugerido y las unidades que vendés.
  const N = r.monthlyUnits;
  const revenue = suggestedPrice === null ? null : suggestedPrice * N;
  const salesTaxes = revenue === null ? null : revenue * pct(t);
  const variableMonthly = r.variablePerUnit === null ? null : r.variablePerUnit * N;
  const profit = revenue === null || variableMonthly === null ? null : revenue - salesTaxes - variableMonthly - r.fixedMonthly;

  // Precio actual (si ya lo vendés).
  const currentPrice = isFiniteNumber(pricingIn.currentPrice) && pricingIn.currentPrice > 0 ? pricingIn.currentPrice : null;
  const current = currentPrice === null
    ? null
    : {
      price: currentPrice,
      marginPct: marginAfterTaxesPct(r.unitCost, currentPrice, t),
      profitPerUnit: r.unitCost === null ? null : currentPrice * (1 - pct(t)) - r.unitCost,
      breakEvenUnits: productBreakEvenUnits({ fixedMonthly: r.fixedMonthly, variablePerUnit: r.variablePerUnit, price: currentPrice, taxPct: t }),
      belowFloor: floorPrice !== null && currentPrice < floorPrice,
      belowVariable: r.variablePerUnit !== null && currentPrice * (1 - pct(t)) <= r.variablePerUnit,
      monthlyProfit: r.unitCost === null || r.variablePerUnit === null ? null : currentPrice * N * (1 - pct(t)) - r.variablePerUnit * N - r.fixedMonthly,
    };

  // ¿Cómo se forma el costo por unidad? (incidencia que suma 100 %).
  const rows = [
    { key: 'materials', label: 'Ingredientes y materiales', amount: r.perUnit.materials },
    { key: 'labor', label: 'Personal', amount: r.perUnit.labor },
    { key: 'equipmentUse', label: 'Uso de máquinas (energía y desgaste)', amount: r.perUnit.equipmentUse },
    { key: 'equipmentFixed', label: 'Máquinas: amortización y otros fijos', amount: r.perUnit.equipmentFixed },
    { key: 'otherFixed', label: 'Gastos fijos del negocio', amount: r.perUnit.otherFixed },
  ];
  const amounts = rows.map((row) => (isFiniteNumber(row.amount) ? row.amount : 0));
  const display = r.unitCost > 0 ? roundPercentagesToTotal(amounts, 2, 100) : amounts.map(() => 0);
  const breakdown = rows.map((row, i) => ({ ...row, amount: isFiniteNumber(row.amount) ? row.amount : null, displayPct: display[i] }));

  const result = {
    ...r,
    currency: quoteCurrency(p),
    pricing: {
      marginPct,
      marginInput: pricingIn.targetMarginPct ?? null,
      taxPct: t,
      roundingStep,
      vatPct,
      floorPrice,
      targetPrice,
      suggestedPrice,
      priceWithVat,
      markupPct,
      realMarginPct,
      breakEvenUnits,
      gainPerUnit: suggestedPrice === null || r.unitCost === null ? null : suggestedPrice * (1 - pct(t)) - r.unitCost,
    },
    monthly: { units: N, revenue, salesTaxes, variable: variableMonthly, fixed: r.fixedMonthly, profit },
    current,
    breakdown,
  };
  result.issues = validateProduct(p, r);
  result.traces = productTraces(result, p);
  return result;
}

/** Resumen para listas (nunca lanza). */
export function summarizeProduct(product) {
  try {
    const r = computeProduct(product);
    return {
      unitCost: r.unitCost,
      suggestedPrice: r.pricing.suggestedPrice,
      marginPct: r.pricing.marginPct,
      breakEvenUnits: r.pricing.breakEvenUnits,
      currentBelowFloor: Boolean(r.current && r.current.belowFloor),
      errors: r.issues.filter((i) => i.severity === 'error').length,
      warnings: r.issues.filter((i) => i.severity === 'warning').length,
      error: false,
    };
  } catch {
    return { unitCost: null, suggestedPrice: null, marginPct: null, breakEvenUnits: null, currentBelowFloor: false, errors: 1, warnings: 0, error: true };
  }
}

// ------------------------------------------------------------------ trazas

function productTraces(r, p) {
  const saleUnit = typeof p.saleUnit === 'string' && p.saleUnit.trim() ? p.saleUnit.trim() : 'unidad';
  const per = `por ${saleUnit}`;
  const traces = {};
  traces.sellable = createTrace({
    id: 'product_sellable',
    title: 'Unidades vendibles por tanda',
    formula: 'Vendibles por tanda = Unidades por tanda × (1 − pérdida %)',
    inputs: [
      { label: 'Unidades por tanda (receta)', value: r.unitsPerBatch, format: 'number' },
      { label: 'Pérdida (se rompe, se quema o no se vende)', value: r.lossPct, format: 'percent' },
    ],
    result: { label: 'Unidades vendibles por tanda', value: r.sellablePerBatch, format: 'number' },
  });
  traces.materials = createTrace({
    id: 'product_materials',
    title: 'Ingredientes y materiales',
    formula: 'Cada uno = Cantidad usada (en la unidad del precio) × Precio por unidad × (1 + merma %) · Por unidad = Receta ÷ Vendibles por tanda + Materiales por unidad',
    inputs: r.materials.map((l) => ({ label: `${l.description || 'Ingrediente'} (${l.per === 'unit' ? 'por unidad' : 'por tanda'})`, value: l.cost, format: 'money' })),
    steps: [
      { label: 'Receta (por tanda)', value: r.perBatch.materials, format: 'money' },
      { label: 'Vendibles por tanda', value: r.sellablePerBatch, format: 'number' },
      { label: 'Materiales que van en cada unidad', value: r.materialsPerUnitDirect, format: 'money' },
    ],
    result: { label: `Ingredientes y materiales ${per}`, value: r.perUnit.materials, format: 'money' },
    notes: [r.materials.some((l) => l.issue) ? 'Hay ingredientes con datos incompletos o unidades que no se pueden convertir: no suman hasta corregirlos.' : null],
  });
  traces.labor = createTrace({
    id: 'product_labor',
    title: 'Personal',
    formula: 'Por tanda = Personas × Minutos por tanda ÷ 60 × Costo hora con cargas · Costo hora = Costo mensual por persona ÷ Horas normales del mes',
    inputs: r.labor.flatMap((l) => [
      { label: `${l.role || 'Puesto'}: costo hora con cargas`, value: l.hourlyCost, format: 'money' },
      { label: `${l.role || 'Puesto'}: ${l.people} × ${l.minutesPerBatch} min por tanda`, value: l.costPerBatch, format: 'money' },
    ]),
    steps: [
      { label: 'Personal por tanda', value: r.perBatch.labor, format: 'money' },
      { label: 'Vendibles por tanda', value: r.sellablePerBatch, format: 'number' },
    ],
    result: { label: `Personal ${per}`, value: r.perUnit.labor, format: 'money' },
    notes: ['El costo hora sale del sueldo con cargas de Personal (convenio que cargó la empresa). RATEOS no trae escalas salariales.'],
  });
  traces.equipmentUse = createTrace({
    id: 'product_equipment_use',
    title: 'Uso de máquinas',
    formula: 'Por tanda = Minutos de uso ÷ 60 × (Mantenimiento/h + Neumáticos/h + Combustible/h + Energía/h)',
    inputs: r.equipment.map((l) => ({ label: `${l.name || 'Máquina'}: ${l.minutesPerBatch} min × ${Math.round(l.usePerHour)} $/h`, value: l.useCostPerBatch, format: 'money' })),
    steps: [{ label: 'Uso por tanda', value: r.perBatch.equipmentUse, format: 'money' }],
    result: { label: `Uso de máquinas ${per}`, value: r.perUnit.equipmentUse, format: 'money' },
    notes: ['La amortización y los demás costos de tener la máquina NO van acá: son fijos del mes (ver "Gastos fijos por unidad").'],
  });
  traces.fixed = createTrace({
    id: 'product_fixed',
    title: 'Gastos fijos por unidad',
    formula: 'Fijo por unidad = (Tenencia de máquinas × % asignado + Gastos fijos × % asignado) ÷ Unidades vendidas por mes',
    inputs: [
      ...r.equipment.map((l) => ({ label: `${l.name || 'Máquina'}: tenencia ${l.sharePct === null ? 'sin %' : `× ${l.sharePct} %`}`, value: l.fixedAssigned, format: 'money' })),
      ...r.fixedCosts.map((l) => ({ label: `${l.description || 'Gasto fijo'} ${l.sharePct === null ? 'sin %' : `× ${l.sharePct} %`}`, value: l.assigned, format: 'money' })),
      { label: 'Unidades vendidas por mes', value: r.monthlyUnits, format: 'number' },
    ],
    steps: [{ label: 'Fijos asignados del mes', value: r.fixedMonthly, format: 'money' }],
    result: { label: `Gastos fijos ${per}`, value: r.fixedPerUnit, format: 'money' },
    notes: ['Los fijos se pagan aunque vendas menos: si vendés menos unidades, a cada una le toca más. El % asignado lo decidís vos (no se calcula solo).'],
  });
  traces.unitCost = createTrace({
    id: 'product_unit_cost',
    title: `Costo ${per}`,
    formula: 'Costo por unidad = (Receta + Personal + Uso de máquinas) ÷ Vendibles por tanda + Materiales por unidad + Fijos del mes ÷ Unidades por mes',
    inputs: [
      { label: 'Ingredientes y materiales', value: r.perUnit.materials, format: 'money' },
      { label: 'Personal', value: r.perUnit.labor, format: 'money' },
      { label: 'Uso de máquinas', value: r.perUnit.equipmentUse, format: 'money' },
      { label: 'Gastos fijos (máquinas y negocio)', value: r.fixedPerUnit, format: 'money' },
    ],
    steps: [
      { label: 'Costo variable por unidad', value: r.variablePerUnit, format: 'money' },
      { label: 'Costo fijo por unidad', value: r.fixedPerUnit, format: 'money' },
    ],
    result: { label: `Costo ${per}`, value: r.unitCost, format: 'money' },
  });
  traces.floor = createTrace({
    id: 'product_floor',
    title: 'Precio piso',
    formula: 'Precio piso = Costo por unidad ÷ (1 − impuestos sobre la venta)',
    inputs: [
      { label: `Costo ${per}`, value: r.unitCost, format: 'money' },
      { label: 'Impuestos sobre lo que vendés (t)', value: r.pricing.taxPct, format: 'percent' },
    ],
    result: { label: 'Precio piso (sin ganar ni perder)', value: r.pricing.floorPrice, format: 'money' },
    notes: [!r.taxInfo.defined && !r.taxInfo.notApplicable ? 'Impuestos sobre la venta sin definir: el precio piso no los incluye.' : null],
  });
  traces.target = createTrace({
    id: 'product_target',
    title: 'Precio con tu margen',
    formula: 'Precio = Costo ÷ (1 − margen − t) · redondeo comercial hacia arriba',
    inputs: [
      { label: `Costo ${per}`, value: r.unitCost, format: 'money' },
      { label: 'Margen que querés ganar (sobre el precio)', value: r.pricing.marginPct, format: 'percent' },
      { label: 'Impuestos sobre lo que vendés (t)', value: r.pricing.taxPct, format: 'percent' },
      { label: 'Redondeo comercial', value: r.pricing.roundingStep, format: 'money' },
    ],
    steps: [
      { label: 'Precio exacto', value: r.pricing.targetPrice, format: 'money' },
      { label: 'Markup equivalente (recargo sobre el costo)', value: r.pricing.markupPct, format: 'percent' },
    ],
    result: { label: 'Precio sugerido (sin IVA)', value: r.pricing.suggestedPrice, format: 'money' },
    notes: ['Margen ≠ markup: el margen se mide sobre el precio y el markup sobre el costo.', 'El redondeo es siempre hacia arriba: nunca baja tu margen.'],
  });
  traces.breakEven = createTrace({
    id: 'product_break_even',
    title: 'Punto de equilibrio',
    formula: 'Unidades por mes = Fijos asignados ÷ (Precio × (1 − t) − Costo variable por unidad)',
    inputs: [
      { label: 'Fijos asignados del mes', value: r.fixedMonthly, format: 'money' },
      { label: 'Precio sugerido', value: r.pricing.suggestedPrice, format: 'money' },
      { label: 'Impuestos sobre lo que vendés (t)', value: r.pricing.taxPct, format: 'percent' },
      { label: 'Costo variable por unidad', value: r.variablePerUnit, format: 'money' },
    ],
    result: { label: 'Unidades por mes para no perder plata', value: r.pricing.breakEvenUnits, format: 'number' },
    notes: [r.pricing.breakEvenUnits === null && r.pricing.suggestedPrice !== null ? 'Con este precio cada unidad no cubre su costo variable: no hay cantidad que alcance.' : null],
  });
  if (r.pricing.priceWithVat !== null) {
    traces.vat = createTrace({
      id: 'product_vat',
      title: 'Precio al público con IVA',
      formula: 'Precio con IVA = Precio sin IVA × (1 + IVA %)',
      inputs: [
        { label: 'Precio sugerido (sin IVA)', value: r.pricing.suggestedPrice, format: 'money' },
        { label: 'IVA (lo cargó la empresa)', value: r.pricing.vatPct, format: 'percent' },
      ],
      result: { label: 'Precio al público', value: r.pricing.priceWithVat, format: 'money' },
      notes: ['El IVA no es costo ni ganancia: lo cobrás y lo pagás. RATEOS no trae alícuotas.'],
    });
  }
  return traces;
}
