/**
 * PriceCompositionEngine — "¿Cómo se forma tu precio?" (PLAN-2026-002, PN4/PN5).
 *
 * Descompone la FACTURACIÓN del mes (sin IVA) con la tarifa que se cotiza:
 *
 *   Facturación = Σ costo por categoría + impuestos sobre la facturación + resultado
 *
 * Cada fila se expresa en % del PRECIO (la estructura de costos, EECC, es otra
 * tabla: suma 100 % del COSTO). Con ganancia, los % mostrados suman exactamente
 * 100 (método del mayor resto); con pérdida no se fuerza el 100 %: el costo y
 * los impuestos superan lo facturado y el resultado es negativo.
 *
 * Apropiación por unidad facturable (proporcional al precio):
 *   parte de la fila en la tarifa neta = tarifa neta × fila / facturación
 *   Σ partes = tarifa neta; tarifa de lista = tarifa neta / factor de descuentos
 *
 * Total del contrato = mes × meses de contrato (misma actividad todos los
 * meses; sin ajustes por índices).
 *
 * Controles de cuadre ("Los números cierran"): invariantes que deben dar
 * siempre; si alguno falla hay un error de cálculo, no un dato del usuario.
 *
 * Función pura sobre el resultado de computeQuote: no recalcula el motor.
 */

import { isFiniteNumber, nonNegative, roundPercentage, roundPercentagesToTotal, roundTo } from '../core/money.js';
import { createTrace } from '../core/trace.js';

const TAX_KEY = 'billing_taxes';
const RESULT_KEY = 'result';

function moneyTolerance(reference) {
  return Math.max(0.01, Math.abs(isFiniteNumber(reference) ? reference : 0) * 1e-9);
}

function check(id, label, ok, detail = null) {
  return { id, label, ok, detail };
}

/**
 * @param {object} result resultado de computeQuote
 * @returns {{
 *   available: boolean, reason: string|null,
 *   taxesState: 'defined'|'undefined'|'invalid'|'not_applicable',
 *   revenue: number, cost: number, billingTaxes: number, profit: number, billingTaxPct: number,
 *   loss: boolean,
 *   rows: { key: string, group: 'cost'|'taxes'|'result', label: string, amount: number, pctOfPrice: number, displayPct: number, perUnit: number|null }[],
 *   groups: { key: string, label: string, amount: number, pctOfPrice: number, displayPct: number, displayPct1: number }[],
 *   perUnit: { unit: string, units: number|null, netRate: number|null, listRate: number|null, discountFactor: number|null, otherRevenue: number },
 *   contract: { months: number|null, revenue: number|null, cost: number|null, billingTaxes: number|null, profit: number|null },
 *   checks: { id: string, label: string, ok: boolean|null, detail: string|null }[],
 *   allChecksOk: boolean,
 *   trace: object,
 * }}
 */
export function priceComposition(result) {
  const r = result || {};
  const k = r.kpis || {};
  const e = r.estimate || {};
  const revenue = e.revenue || {};
  const R = isFiniteNumber(revenue.total) ? revenue.total : 0;
  const hasRate = isFiniteNumber(k.commercialListRate) && k.commercialListRate > 0;
  const empty = (reason) => ({
    available: false,
    reason,
    revenue: R,
    cost: isFiniteNumber(e.cost && e.cost.total) ? e.cost.total : 0,
    billingTaxes: 0,
    profit: isFiniteNumber(e.profit) ? e.profit : 0,
    billingTaxPct: nonNegative(k.billingTaxPct),
    loss: false,
    rows: [],
    groups: [],
    perUnit: { unit: r.unit || 'day', units: null, netRate: null, listRate: null, discountFactor: null, otherRevenue: 0 },
    contract: { months: null, revenue: null, cost: null, billingTaxes: null, profit: null },
    checks: [],
    allChecksOk: true,
    trace: null,
  });
  if (!hasRate) return empty('Sin tarifa todavía: la composición del precio aparece cuando haya una tarifa para cotizar.');
  if (!(R > 0)) {
    const D = isFiniteNumber(k.activeDays) ? k.activeDays : 0;
    const factor = isFiniteNumber(revenue.discountFactor) ? revenue.discountFactor : null;
    return empty(!(D > 0)
      ? 'Sin facturación: cargá los días por mes que esperás trabajar.'
      : factor !== null && factor <= 0
        ? 'Sin facturación: los descuentos suman 100 % y la tarifa neta queda en $ 0.'
        : 'Sin facturación con la tarifa y la actividad estimada.');
  }

  const C = isFiniteNumber(e.cost && e.cost.total) ? e.cost.total : 0;
  const T = isFiniteNumber(e.billingTaxes) ? e.billingTaxes : 0;
  const G = isFiniteNumber(e.profit) ? e.profit : R - T - C;
  const t = nonNegative(k.billingTaxPct);
  const loss = G < -moneyTolerance(R);

  const eeccRows = Array.isArray(r.eecc && r.eecc.rows) ? r.eecc.rows : [];
  const base = [
    ...eeccRows.map((row) => ({ key: row.category, group: 'cost', label: row.label, amount: isFiniteNumber(row.amount) ? row.amount : 0 })),
    { key: TAX_KEY, group: 'taxes', label: 'Impuestos sobre lo que facturás', amount: T },
    { key: RESULT_KEY, group: 'result', label: loss ? 'Pérdida' : 'Ganancia (antes del impuesto a las Ganancias)', amount: G },
  ];
  // Con ganancia, los % de las filas suman exactamente 100; con pérdida se
  // muestran tal cual (cada uno redondeado: no se fuerza el 100).
  const display = loss ? base.map((row) => roundPercentage((row.amount / R) * 100)) : roundPercentagesToTotal(base.map((row) => row.amount), 2, 100);

  const netRate = isFiniteNumber(revenue.netRate) ? revenue.netRate : null;
  const listRate = isFiniteNumber(revenue.listRate) ? revenue.listRate : null;
  const discountFactor = isFiniteNumber(revenue.discountFactor) ? revenue.discountFactor : null;
  const units = isFiniteNumber(revenue.billableUnits) && revenue.billableUnits > 0 ? revenue.billableUnits : null;
  const rows = base.map((row, i) => ({
    ...row,
    pctOfPrice: (row.amount / R) * 100,
    displayPct: display[i],
    perUnit: netRate !== null ? (netRate * row.amount) / R : null,
  }));

  const groupDefs = [
    { key: 'cost', label: 'Costo', amount: C },
    { key: 'taxes', label: 'Impuestos sobre lo que facturás', amount: T },
    { key: 'result', label: loss ? 'Pérdida' : 'Ganancia', amount: G },
  ];
  const g2 = loss ? groupDefs.map((g) => roundPercentage((g.amount / R) * 100)) : roundPercentagesToTotal(groupDefs.map((g) => g.amount), 2, 100);
  // "De cada $ 100": con 1 decimal (un 4,5 % de impuestos no se muestra como $ 5).
  // Con pérdida: costo e impuestos con redondeo simétrico y la pérdida es lo
  // que falta para 100 (los tres siempre suman 100: 118,8 + 0 − 18,8).
  let g1;
  if (loss) {
    const costPct = roundTo((C / R) * 100, 1);
    const taxPct = roundTo((T / R) * 100, 1);
    g1 = [costPct, taxPct, roundTo(100 - costPct - taxPct, 1)];
  } else {
    g1 = roundPercentagesToTotal(groupDefs.map((g) => g.amount), 1, 100);
  }
  const groups = groupDefs.map((g, i) => ({ ...g, pctOfPrice: (g.amount / R) * 100, displayPct: g2[i], displayPct1: g1[i] }));

  const months = isFiniteNumber(r.ctx && r.ctx.contractMonths) && r.ctx.contractMonths > 0 ? r.ctx.contractMonths : null;
  const contract = {
    months,
    revenue: months !== null ? R * months : null,
    cost: months !== null ? C * months : null,
    billingTaxes: months !== null ? T * months : null,
    profit: months !== null ? G * months : null,
  };

  // ------------------------------------------------ controles de cuadre
  const tol = moneyTolerance(R);
  const sumCategories = eeccRows.reduce((s, row) => s + (isFiniteNumber(row.amount) ? row.amount : 0), 0);
  const sumPerUnit = rows.reduce((s, row) => s + (isFiniteNumber(row.perUnit) ? row.perUnit : 0), 0);
  const sumDisplay = Math.round(rows.reduce((s, row) => s + row.displayPct, 0) * 100) / 100;
  const checks = [
    check('revenue_equals_parts', 'Facturación = costo + impuestos sobre la facturación + resultado', Math.abs(R - (C + T + G)) <= tol),
    check('cost_categories', 'Los rubros de la estructura de costos suman el costo del mes', Math.abs(sumCategories - C) <= tol),
    check('taxes_rate', 'Impuestos = porcentaje × facturación', Math.abs(T - (t * R) / 100) <= tol),
    check('display_100', 'Los porcentajes del precio suman 100 %', loss ? null : Math.abs(sumDisplay - 100) < 1e-9, loss ? 'Con pérdida no se fuerza el 100 %: el costo y los impuestos superan lo facturado.' : null),
    check('per_unit_sum', 'La apropiación por unidad suma la tarifa neta', netRate === null ? null : Math.abs(sumPerUnit - netRate) <= moneyTolerance(netRate)),
    check('list_from_net', 'Tarifa de lista × factor de descuentos = tarifa neta', netRate === null || listRate === null || discountFactor === null ? null : Math.abs(listRate * discountFactor - netRate) <= moneyTolerance(netRate)),
    check('margin_definition', 'Margen = resultado ÷ facturación', isFiniteNumber(k.marginPct) ? Math.abs(k.marginPct - (G / R) * 100) < 1e-6 : null),
  ];
  const allChecksOk = checks.every((c) => c.ok !== false);

  const trace = createTrace({
    id: 'price_composition',
    title: '¿Cómo se forma tu precio?',
    formula: 'Facturación = Costo + Impuestos sobre la facturación + Resultado · % del precio = fila / Facturación · Parte en la tarifa = tarifa neta × fila / Facturación',
    inputs: [
      { label: 'Facturación del mes (sin IVA)', value: R, format: 'money' },
      { label: 'Costo del mes', value: C, format: 'money' },
      { label: 'Impuestos sobre la facturación', value: T, format: 'money' },
      { label: 'Tarifa neta', value: netRate, format: 'money' },
    ],
    steps: rows.map((row) => ({ label: `${row.label} (% del precio)`, value: row.pctOfPrice, format: 'percent' })),
    result: { label: loss ? 'Pérdida del mes' : 'Ganancia del mes (antes del impuesto a las Ganancias)', value: G, format: 'money' },
    notes: [
      'La estructura de costos suma 100 % del costo; esta composición suma 100 % del precio. No se mezclan.',
      'La apropiación por unidad reparte la tarifa neta en la misma proporción que la facturación del mes.',
      loss ? 'Con pérdida no se fuerza el 100 %: el costo y los impuestos superan lo facturado.' : null,
      ...checks.filter((c) => c.ok === false).map((c) => `No cierra: ${c.label}.`),
    ],
  });

  const taxesState = k.billingTaxesInvalid ? 'invalid' : !k.billingTaxesDefined ? 'undefined' : r.billingTaxInfo && r.billingTaxInfo.notApplicable ? 'not_applicable' : 'defined';
  return {
    available: true,
    reason: null,
    taxesState,
    revenue: R,
    cost: C,
    billingTaxes: T,
    profit: G,
    billingTaxPct: t,
    loss,
    rows,
    groups,
    perUnit: { unit: r.unit || 'day', units, netRate, listRate, discountFactor, otherRevenue: nonNegative(revenue.otherRevenue) + nonNegative(revenue.guaranteeTopUp) },
    contract,
    checks,
    allChecksOk,
    trace,
  };
}
