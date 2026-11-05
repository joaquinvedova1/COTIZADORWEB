/**
 * ExtrasEngine — adicionales que se cobran aparte del precio principal
 * (PLAN-2026-018).
 *
 * Una planilla de cotización real tiene un ítem principal (el fijo mensual, la
 * hora on call, el precio cerrado) y debajo ítems con precio unitario: hora
 * fuera de horario, feriado, llamado fuera de horario, km excedente,
 * movilización… Cada adicional es una fila:
 *
 *   concepto · unidad · cantidad estimada por mes · costo por unidad · precio por unidad
 *
 *   costo del mes    = cantidad × costo por unidad
 *   precio sugerido  = costo por unidad × 100 / (100 − margen objetivo − impuestos s/ facturación)
 *   precio usado     = el cargado a mano o, si está vacío, el sugerido
 *   ingreso del mes  = cantidad × precio usado
 *
 * Los adicionales NO dependen de los días de trabajo del precio principal: son
 * un monto mensual estimado (costo e ingreso). Así el fijo mensual cubre lo
 * incluido y cada adicional se cotiza con su propio margen.
 *
 * Función pura: sin DOM, sin storage, sin fecha actual.
 */

import { isPlainObject } from '../core/object.js';
import { nonNegative, isFiniteNumber } from '../core/money.js';
import { priceFromMarginAndTaxes } from './pricing-engine.js';

/** Número >= 0 o null si está vacío / no es número. */
function optional(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Adicionales de una cotización, calculados.
 * @param {object[]|undefined} extras quote.extras
 * @param {{ targetMarginPct?: number, billingTaxPct?: number }} [opts]
 * @returns {{ lines: object[], cost: number, revenue: number, missingPrice: number }}
 */
export function computeExtras(extras, { targetMarginPct = 0, billingTaxPct = 0 } = {}) {
  const list = Array.isArray(extras) ? extras.filter(isPlainObject) : [];
  const lines = list.map((e, i) => {
    const quantity = nonNegative(optional(e.quantityPerMonth) ?? 0);
    const costPerUnit = optional(e.costPerUnit);
    const manual = optional(e.price);
    const suggested = costPerUnit !== null && costPerUnit > 0 ? priceFromMarginAndTaxes(costPerUnit, nonNegative(targetMarginPct), nonNegative(billingTaxPct)) : null;
    const price = manual !== null && manual > 0 ? manual : isFiniteNumber(suggested) ? suggested : null;
    const priceSource = manual !== null && manual > 0 ? 'manual' : isFiniteNumber(suggested) ? 'suggested' : null;
    const cost = quantity * (costPerUnit ?? 0);
    const revenue = price !== null ? quantity * price : 0;
    return {
      id: e.id ?? `extra-${i + 1}`,
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Adicional',
      category: typeof e.category === 'string' ? e.category : 'labor',
      unitName: typeof e.unitName === 'string' && e.unitName.trim() ? e.unitName.trim() : 'unidad',
      quantity,
      costPerUnit: costPerUnit ?? 0,
      suggestedPrice: isFiniteNumber(suggested) ? suggested : null,
      price,
      priceSource,
      cost,
      revenue,
      profit: revenue - cost,
    };
  });
  return {
    lines,
    cost: lines.reduce((s, l) => s + l.cost, 0),
    revenue: lines.reduce((s, l) => s + l.revenue, 0),
    // Adicionales con cantidad pero sin precio (ni a mano ni sugerido): no suman ingreso.
    missingPrice: lines.filter((l) => l.quantity > 0 && l.price === null).length,
  };
}
