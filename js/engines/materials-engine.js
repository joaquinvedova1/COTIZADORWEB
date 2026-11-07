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
 *   por unidad producida (PLAN-2026-021; unificada con la "por unidad facturada" de la tanda B,
 *     PLAN-2026-022: "por válvula", "por PSV", "por m³"…)
 *                  → costo por unidad = costo × % de las unidades que lo usan (`usagePct`, vacío = 100 %)
 *                    variable por día = costo por unidad × unidades producidas por día
 *     (las de la línea, `outputPerActiveDay`, o si no las de la cotización,
 *      cost-engine.autoOutputPerActiveDay: cantidad por día si se cobra por cantidad, horas por día
 *      por hora, 1 por día, hitos ÷ días por trabajo por llamado / trabajo / hito; por mes, 0).
 *     Las unidades son las que se TRABAJAN (sin el relleno del mínimo por llamado).
 *
 * Facturar aparte por línea (tanda A 2026-11, A-8): `line.billedSeparately`
 * true (se factura aparte) / false (lo cubre la tarifa) / sin definir (sigue
 * el tilde global "Facturo los materiales aparte", como siempre). El motor
 * sólo lo expone; la facturación la arma economics-engine (materialsResaleOf).
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';
import { MATERIAL_PROVIDERS } from '../domain/catalogs.js';

/** Bases de un material. `per_output` = "Por unidad producida" (PLAN-2026-021 + PLAN-2026-022). */
export const MATERIAL_BASIS_IDS = Object.freeze(['per_month', 'per_active_day', 'per_activation', 'per_output']);
/** Comportamientos de "Otros costos" (también por unidad producida, PLAN-2026-022). */
export const OTHER_COST_BEHAVIOR_IDS = Object.freeze(['fixed_monthly', 'per_active_day', 'per_activation', 'per_output']);

/**
 * Base de una línea, con el alias `per_billable_unit` → `per_output` (PLAN-2026-022: la base "por
 * unidad facturada" de la tanda B nunca se publicó con ese id; se acepta por si acaso).
 */
export function normalizeBasisId(value) {
  return value === 'per_billable_unit' ? 'per_output' : value;
}

/**
 * % de las unidades producidas que usan el material o el costo (PLAN-2026-022): vacío o
 * inválido = 100 %; se acota a 0–100.
 */
export function usageShareOf(value) {
  if (value === null || value === undefined || value === '') return 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 100) / 100;
}

const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * ¿La unidad producida de la línea es la misma en que se cobra? (vacía = sí).
 * Si es otra (p. ej. m² cobrando por viaje), la producción de "Cómo se cobra"
 * no sirve: la línea tiene que cargar la suya.
 */
export function outputMatchesBilling(line = {}, billingUnit = null) {
  const own = norm(line && line.outputUnit);
  if (!own) return true;
  const u = billingUnit || {};
  return [u.singular, u.plural, u.short, u.id].some((x) => x && norm(x) === own);
}

/** Unidades producidas por día de trabajo de una línea "por unidad producida" (0 si no hay dato). */
export function outputPerActiveDayOf(line = {}, autoOutputPerActiveDay = 0, billingUnit = null) {
  const own = nonNegative(line.outputPerActiveDay);
  if (own > 0) return own;
  return outputMatchesBilling(line, billingUnit) ? nonNegative(autoOutputPerActiveDay) : 0;
}

function splitByBasis(amount, basis, daysPerActivation, outputPerDay = 0) {
  if (basis === 'per_output') return { fixedMonthly: 0, variablePerActiveDay: amount * outputPerDay };
  if (basis === 'per_active_day') return { fixedMonthly: 0, variablePerActiveDay: amount };
  if (basis === 'per_activation') return { fixedMonthly: 0, variablePerActiveDay: safeDivide(amount, daysPerActivation, 0) };
  return { fixedMonthly: amount, variablePerActiveDay: 0 };
}

/**
 * @param {object} line
 * @param {{ daysPerActivation?: number, outputPerActiveDay?: number, billingUnit?: object }} [ctx]
 *   outputPerActiveDay: lo producido por día de la cotización (cost-engine.autoOutputPerActiveDay)
 */
export function computeMaterialLine(line = {}, { daysPerActivation = 1, outputPerActiveDay = 0, billingUnit = null } = {}) {
  const quantity = nonNegative(line.quantity);
  const unitCost = nonNegative(line.unitCost);
  const wastePct = nonNegative(line.wastePct);
  const logisticsPct = nonNegative(line.logisticsPct);
  const resaleMarkupPct = nonNegative(line.resaleMarkupPct);
  const provider = MATERIAL_PROVIDERS.find((p) => p.id === line.providedBy) || null;
  const grossCost = quantity * unitCost * (1 + pct(wastePct)) * (1 + pct(logisticsPct));
  const costForUs = provider && !provider.costForUs ? 0 : grossCost;
  const rawBasis = normalizeBasisId(line.basis);
  const basis = MATERIAL_BASIS_IDS.includes(rawBasis) ? rawBasis : 'per_month';
  // Por unidad producida: sólo una parte de las unidades puede llevarlo (p. ej. 30 % de las PSV, PLAN-2026-022).
  const usageShare = basis === 'per_output' ? usageShareOf(line.usagePct) : 1;
  const outputPerDay = basis === 'per_output' ? outputPerActiveDayOf(line, outputPerActiveDay, billingUnit) : 0;
  const split = splitByBasis(costForUs * usageShare, basis, nonNegative(daysPerActivation), outputPerDay);
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    providedBy: provider ? provider.id : null,
    basis,
    // Por unidad producida: cuántas por día de trabajo se usaron (0 = falta el dato).
    ...(basis === 'per_output' ? { outputPerActiveDay: outputPerDay, outputOwn: nonNegative(line.outputPerActiveDay) > 0 } : {}),
    quantity,
    unitCost,
    grossCost,
    costForUs,
    // Por unidad producida (PLAN-2026-022): parte de las unidades que lo usan y costo promedio por unidad.
    usageShare,
    costPerOutputUnit: basis === 'per_output' ? costForUs * usageShare : null,
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
export function computeOtherCostLine(line = {}, { daysPerActivation = 1, outputPerActiveDay = 0, billingUnit = null } = {}) {
  const amount = nonNegative(line.amount);
  const rawBehavior = normalizeBasisId(line.behavior);
  const behavior = OTHER_COST_BEHAVIOR_IDS.includes(rawBehavior) ? rawBehavior : 'fixed_monthly';
  // Por unidad producida (PLAN-2026-022): monto × % de las unidades que lo usan × unidades por día.
  const usageShare = behavior === 'per_output' ? usageShareOf(line.usagePct) : 1;
  const outputPerDay = behavior === 'per_output' ? outputPerActiveDayOf(line, outputPerActiveDay, billingUnit) : 0;
  let fixedMonthly = 0;
  let variablePerActiveDay = 0;
  if (behavior === 'fixed_monthly') fixedMonthly = amount;
  else if (behavior === 'per_active_day') variablePerActiveDay = amount;
  else if (behavior === 'per_output') variablePerActiveDay = amount * usageShare * outputPerDay;
  else variablePerActiveDay = safeDivide(amount, nonNegative(daysPerActivation), 0);
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    category: line.category,
    behavior,
    amount,
    ...(behavior === 'per_output' ? { outputPerActiveDay: outputPerDay } : {}),
    usageShare,
    costPerOutputUnit: behavior === 'per_output' ? amount * usageShare : null,
    fixedMonthly,
    variablePerActiveDay,
  };
}
