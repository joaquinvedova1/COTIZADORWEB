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
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide } from '../core/money.js';
import { MATERIAL_PROVIDERS } from '../domain/catalogs.js';

function splitByBasis(amount, basis, daysPerActivation) {
  if (basis === 'per_active_day') return { fixedMonthly: 0, variablePerActiveDay: amount };
  if (basis === 'per_activation') return { fixedMonthly: 0, variablePerActiveDay: safeDivide(amount, daysPerActivation, 0) };
  return { fixedMonthly: amount, variablePerActiveDay: 0 };
}

export function computeMaterialLine(line = {}, { daysPerActivation = 1 } = {}) {
  const quantity = nonNegative(line.quantity);
  const unitCost = nonNegative(line.unitCost);
  const wastePct = nonNegative(line.wastePct);
  const logisticsPct = nonNegative(line.logisticsPct);
  const resaleMarkupPct = nonNegative(line.resaleMarkupPct);
  const provider = MATERIAL_PROVIDERS.find((p) => p.id === line.providedBy) || null;
  const grossCost = quantity * unitCost * (1 + pct(wastePct)) * (1 + pct(logisticsPct));
  const costForUs = provider && !provider.costForUs ? 0 : grossCost;
  const basis = ['per_month', 'per_active_day', 'per_activation'].includes(line.basis) ? line.basis : 'per_month';
  const split = splitByBasis(costForUs, basis, nonNegative(daysPerActivation));
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    providedBy: provider ? provider.id : null,
    basis,
    quantity,
    unitCost,
    grossCost,
    costForUs,
    resalePrice: costForUs * (1 + pct(resaleMarkupPct)),
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
export function computeOtherCostLine(line = {}, { daysPerActivation = 1 } = {}) {
  const amount = nonNegative(line.amount);
  const behavior = ['fixed_monthly', 'per_active_day', 'per_activation'].includes(line.behavior) ? line.behavior : 'fixed_monthly';
  let fixedMonthly = 0;
  let variablePerActiveDay = 0;
  if (behavior === 'fixed_monthly') fixedMonthly = amount;
  else if (behavior === 'per_active_day') variablePerActiveDay = amount;
  else variablePerActiveDay = safeDivide(amount, nonNegative(daysPerActivation), 0);
  return {
    id: line.id ?? null,
    description: line.description ?? '',
    category: line.category,
    behavior,
    amount,
    fixedMonthly,
    variablePerActiveDay,
  };
}
