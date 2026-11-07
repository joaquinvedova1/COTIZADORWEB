/**
 * MaterialsEngine — materiales y otros costos directos.
 *
 * Material:
 *   costo/unidad base = cantidad × costoUnitario × (1 + merma%) × (1 + logística%)
 *   si lo provee el cliente → costo para nosotros = 0 (se lista igual)
 *   precio de reventa (informativo) = costo × (1 + markup de reventa%)
 *
 * Base de cálculo:
 *   por mes        → fijo mensual
 *   por día activo → variable por día
 *   por activación → variable por día = costo / díasPorActivación
 *   por unidad facturada (tanda B 2026-11, B-2: "por válvula", "por PSV", "por m³"…)
 *                  → costo por unidad = costo × % de las unidades que lo usan (vacío = 100 %)
 *                    variable por día = costo por unidad × unidades por día de trabajo
 *                    (con abono mensual, la unidad es el mes: fijo mensual)
 *                    Las unidades son las que se TRABAJAN (sin el relleno del mínimo por llamado).
 *
 * Facturar aparte por línea (tanda A 2026-11, A-8): `line.billedSeparately`
 * true (se factura aparte) / false (lo cubre la tarifa) / sin definir (sigue
 * el tilde global "Facturo los materiales aparte", como siempre). El motor
 * sólo lo expone; la facturación la arma economics-engine (materialsResaleOf).
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';
import { MATERIAL_PROVIDERS } from '../domain/catalogs.js';

/** Bases de un material. `per_billable_unit` se rotula con la unidad de la cotización (B-2). */
export const MATERIAL_BASIS_IDS = Object.freeze(['per_month', 'per_active_day', 'per_activation', 'per_billable_unit']);
/** Comportamientos de "Otros costos" (también por unidad facturada, B-2). */
export const OTHER_COST_BEHAVIOR_IDS = Object.freeze(['fixed_monthly', 'per_active_day', 'per_activation', 'per_billable_unit']);

/**
 * % de las unidades facturadas que usan el material o el costo (B-2): vacío o inválido = 100 %;
 * se acota a 0–100.
 */
export function usageShareOf(value) {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 100) / 100;
}

/**
 * Cómo se reparte un costo "por unidad facturada" (B-2) según la unidad de la cotización.
 *   unitsPerActiveDay  unidades trabajadas por día de trabajo (día 1, hora H, m³ q, hito h ÷ días por trabajo)
 *   monthly            true con abono mensual: la unidad es el mes (fijo mensual)
 */
function splitPerUnit(perUnit, billingUnits) {
  const b = billingUnits || {};
  if (b.monthly === true) return { fixedMonthly: perUnit, variablePerActiveDay: 0 };
  return { fixedMonthly: 0, variablePerActiveDay: perUnit * nonNegative(b.unitsPerActiveDay) };
}

function splitByBasis(amount, basis, daysPerActivation, billingUnits) {
  if (basis === 'per_active_day') return { fixedMonthly: 0, variablePerActiveDay: amount };
  if (basis === 'per_activation') return { fixedMonthly: 0, variablePerActiveDay: safeDivide(amount, daysPerActivation, 0) };
  if (basis === 'per_billable_unit') return splitPerUnit(amount, billingUnits);
  return { fixedMonthly: amount, variablePerActiveDay: 0 };
}

/**
 * @param {object} line
 * @param {{ daysPerActivation?: number, billingUnits?: { unitsPerActiveDay: number, monthly: boolean } }} [ctx]
 *   billingUnits: unidades de la cotización por día de trabajo (cost-engine.billingUnitsPerActiveDay)
 */
export function computeMaterialLine(line = {}, { daysPerActivation = 1, billingUnits = null } = {}) {
  const quantity = nonNegative(line.quantity);
  const unitCost = nonNegative(line.unitCost);
  const wastePct = nonNegative(line.wastePct);
  const logisticsPct = nonNegative(line.logisticsPct);
  const resaleMarkupPct = nonNegative(line.resaleMarkupPct);
  const provider = MATERIAL_PROVIDERS.find((p) => p.id === line.providedBy) || null;
  const grossCost = quantity * unitCost * (1 + pct(wastePct)) * (1 + pct(logisticsPct));
  const costForUs = provider && !provider.costForUs ? 0 : grossCost;
  const basis = MATERIAL_BASIS_IDS.includes(line.basis) ? line.basis : 'per_month';
  // Por unidad facturada (B-2): sólo una parte de las unidades puede llevarlo (p. ej. 30 % de las PSV).
  const usageShare = basis === 'per_billable_unit' ? usageShareOf(line.usagePct) : 1;
  const split = splitByBasis(costForUs * usageShare, basis, nonNegative(daysPerActivation), billingUnits);
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    providedBy: provider ? provider.id : null,
    basis,
    quantity,
    unitCost,
    grossCost,
    costForUs,
    // Por unidad facturada (B-2): parte de las unidades que lo usan y costo promedio por unidad.
    usageShare,
    costPerBillableUnit: basis === 'per_billable_unit' ? costForUs * usageShare : null,
    resalePrice: costForUs * (1 + pct(resaleMarkupPct)),
    // Para facturar los materiales aparte (PLAN-2026-009): costo × (1 + recargo de reventa).
    resaleFactor: 1 + pct(resaleMarkupPct),
    // true / false / null (= sigue el tilde global de la cotización).
    billedSeparately: line.billedSeparately === true ? true : line.billedSeparately === false ? false : null,
    ...split,
  };
}

export function computeMaterials(lines = [], ctx = {}) {
  const results = objectList(lines).map((l) => computeMaterialLine(l, ctx));
  return {
    lines: results,
    fixedMonthly: results.reduce((s, r) => s + r.fixedMonthly, 0),
    variablePerActiveDay: results.reduce((s, r) => s + r.variablePerActiveDay, 0),
  };
}

/** Otros costos directos (terceros, subcontratos, montos manuales). */
export function computeOtherCostLine(line = {}, { daysPerActivation = 1, billingUnits = null } = {}) {
  const amount = nonNegative(line.amount);
  const behavior = OTHER_COST_BEHAVIOR_IDS.includes(line.behavior) ? line.behavior : 'fixed_monthly';
  const usageShare = behavior === 'per_billable_unit' ? usageShareOf(line.usagePct) : 1;
  let fixedMonthly = 0;
  let variablePerActiveDay = 0;
  if (behavior === 'fixed_monthly') fixedMonthly = amount;
  else if (behavior === 'per_active_day') variablePerActiveDay = amount;
  else if (behavior === 'per_billable_unit') ({ fixedMonthly, variablePerActiveDay } = splitPerUnit(amount * usageShare, billingUnits));
  else variablePerActiveDay = safeDivide(amount, nonNegative(daysPerActivation), 0);
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    category: line.category,
    behavior,
    amount,
    usageShare,
    costPerBillableUnit: behavior === 'per_billable_unit' ? amount * usageShare : null,
    fixedMonthly,
    variablePerActiveDay,
  };
}
