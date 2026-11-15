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
 * Tarifas fuera de horario (PLAN-2026-025, `kind: 'overtime'`): su costo por hora
 * no se carga a mano, lo deriva out-of-hours-engine de los recursos (resolveExtras)
 * y llega acá en `costPerUnit` y `surchargePerUnit`. Su precio sugerido es el
 * mayor entre el que cubre su costo y la hora normal equivalente + el recargo
 * (`referenceHourPrice`): una hora fuera de horario nunca se sugiere más barata
 * que una normal.
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
export function computeExtras(extras, { targetMarginPct = 0, billingTaxPct = 0, loadFactor = 1, referenceHourPrice = null, referenceHourCost = null } = {}) {
  // Carga del costo directo (estructura %, financiero, contingencia): el precio
  // sugerido cubre el costo CARGADO, así el adicional no baja el margen total.
  // Margen objetivo inválido (null) → no se sugiere precio (como la tarifa principal).
  const load = isFiniteNumber(loadFactor) && loadFactor > 0 ? loadFactor : 1;
  const marginOk = isFiniteNumber(targetMarginPct);
  // Hora normal de referencia: la de la tarifa (por hora o por día) o, si no hay, la de los recursos con margen.
  const fromRate = isFiniteNumber(referenceHourPrice) && referenceHourPrice > 0;
  const fromResources = !fromRate && marginOk && isFiniteNumber(referenceHourCost) && referenceHourCost > 0
    ? priceFromMarginAndTaxes(referenceHourCost * load, nonNegative(targetMarginPct), nonNegative(billingTaxPct))
    : null;
  const reference = fromRate ? referenceHourPrice : isFiniteNumber(fromResources) && fromResources > 0 ? fromResources : null;
  const referenceSource = fromRate ? 'rate' : reference !== null ? 'resources' : null;
  const list = Array.isArray(extras) ? extras.filter(isPlainObject) : [];
  const lines = list.map((e, i) => {
    const quantity = nonNegative(optional(e.quantityPerMonth) ?? 0);
    const costPerUnit = optional(e.costPerUnit);
    const manual = optional(e.price);
    const byCost = marginOk && costPerUnit !== null && costPerUnit > 0 ? priceFromMarginAndTaxes(costPerUnit * load, nonNegative(targetMarginPct), nonNegative(billingTaxPct)) : null;
    // Tarifa fuera de horario: nunca más barata que la hora normal + el recargo de las horas extra.
    const derived = e.kind === 'overtime';
    const surcharge = derived ? nonNegative(optional(e.surchargePerUnit) ?? 0) : 0;
    const surchargePrice = derived && marginOk && surcharge > 0 ? priceFromMarginAndTaxes(surcharge * load, nonNegative(targetMarginPct), nonNegative(billingTaxPct)) : null;
    const byNormalHour = derived && marginOk && reference !== null
      ? reference + (isFiniteNumber(surchargePrice) ? surchargePrice : 0)
      : null;
    const usesNormalHour = isFiniteNumber(byNormalHour) && (!isFiniteNumber(byCost) || byNormalHour > byCost);
    const suggested = usesNormalHour ? byNormalHour : byCost;
    // Precio a mano (también 0, para bonificarlo); vacío → sugerido.
    const price = manual !== null ? manual : isFiniteNumber(suggested) ? suggested : null;
    const priceSource = manual !== null ? 'manual' : isFiniteNumber(suggested) ? 'suggested' : null;
    const cost = quantity * (costPerUnit ?? 0);
    const loadedCost = cost * load;
    const keep = 1 - nonNegative(billingTaxPct) / 100;
    const revenue = price !== null ? quantity * price : 0;
    return {
      id: e.id ?? `extra-${i + 1}`,
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : derived ? `Hora fuera de horario (extra ${nonNegative(e.premiumPct)}\u00a0%)` : 'Adicional',
      // Tarifa fuera de horario derivada de los recursos (PLAN-2026-025).
      derived,
      ...(derived ? {
        premiumPct: nonNegative(e.premiumPct),
        surchargePerUnit: surcharge,
        surchargePrice: isFiniteNumber(surchargePrice) ? surchargePrice : null,
        referenceHourPrice: reference,
        referenceSource,
        priceByCost: isFiniteNumber(byCost) ? byCost : null,
        priceBasis: isFiniteNumber(suggested) ? (usesNormalHour ? 'normal_hour' : 'cost') : null,
      } : {}),
      category: typeof e.category === 'string' ? e.category : 'labor',
      unitName: typeof e.unitName === 'string' && e.unitName.trim() ? e.unitName.trim() : 'unidad',
      quantity,
      costPerUnit: costPerUnit ?? 0,
      suggestedPrice: isFiniteNumber(suggested) ? suggested : null,
      price,
      priceSource,
      cost,
      loadedCost,
      revenue,
      // Ingreso que sólo cubre su costo con margen: es el que cuenta al calcular la tarifa principal
      // (lo que una hora fuera de horario cobra de más por el piso de la hora normal no la abarata).
      neutralRevenue: derived && priceSource === 'suggested' && isFiniteNumber(byCost) ? quantity * Math.min(price, byCost) : revenue,
      // Resultado después de impuestos sobre la facturación y de la carga del costo.
      profit: revenue * keep - loadedCost,
      // Precio a mano que no cubre el costo cargado ni los impuestos.
      belowCost: priceSource === 'manual' && quantity > 0 && costPerUnit !== null && costPerUnit > 0 && price * keep < costPerUnit * load - 1e-9,
    };
  });
  return {
    lines,
    cost: lines.reduce((s, l) => s + l.cost, 0),
    revenue: lines.reduce((s, l) => s + l.revenue, 0),
    neutralRevenue: lines.reduce((s, l) => s + l.neutralRevenue, 0),
    // Adicionales con cantidad pero sin precio (ni a mano ni sugerido): no suman ingreso.
    missingPrice: lines.filter((l) => l.quantity > 0 && l.price === null).length,
    belowCost: lines.filter((l) => l.belowCost).length,
    loadFactor: load,
  };
}
