/**
 * FinancialEngine — capital de trabajo y costo financiero.
 *
 * Cada costo en efectivo se paga X días después de incurrido; el cliente
 * paga Y días después de facturado; se factura Z días (promedio) después de
 * prestado el servicio. Entonces, para cada grupo de pago g:
 *
 *   díasFinanciados_g = max(0, Z + Y − X_g)
 *   capitalDeTrabajo  = Σ costoMensual_g × díasFinanciados_g / 30
 *   costoFinanciero   = Σ costoMensual_g × tasaMensual% × díasFinanciados_g / 30
 *
 * Interés simple. Sólo se financian costos que son salida de caja
 * (la amortización y el costo de capital de equipos no lo son).
 * La contingencia no se financia (es una reserva, no un pago).
 *
 * Plazo por proveedor (PLAN-2026-011, opcional): un equipo o servicio externo
 * con su propio plazo de pago se financia aparte, con
 *   díasFinanciados = Z + Y − plazo de ese proveedor
 * (sin plazo propio va en el grupo "Proveedores", como siempre).
 *
 * Productos (PLAN-2026-014): el mismo cálculo con Z = días entre producir y
 * vender y X_g = días después de producir. Ahí "por día activo" se lee "por
 * unidad vendida" (el impulsor variable de un producto).
 */

import { nonNegative, pct, toNumber } from '../core/money.js';
import { PAY_GROUPS } from '../domain/catalogs.js';

export const DAYS_PER_MONTH_FINANCE = 30;

/** Costo financiero simple de un monto financiado `days` días. */
export function simpleFinancialCost(amount, monthlyRatePct, days) {
  return nonNegative(amount) * pct(nonNegative(monthlyRatePct)) * (nonNegative(days) / DAYS_PER_MONTH_FINANCE);
}

/** Días que la empresa financia un grupo de pago. */
export function financingDays({ invoiceLagDays = 0, paymentTermDays = 0, payDays = 0 }) {
  return Math.max(0, nonNegative(invoiceLagDays) + nonNegative(paymentTermDays) - nonNegative(payDays));
}

/**
 * @param {Record<string, {fixedMonthly:number, variablePerActiveDay:number}>} cashByGroup
 *        costos en efectivo agrupados por grupo de pago (salaries, fuel, suppliers, materials, structure)
 * @param {object} finance  { paymentTermDays, invoiceLagDays, monthlyRatePct, payDays: {...} }
 * @param {{ suppliers?: Array<{ key:string, label:string, payDays:number, fixedMonthly:number, variablePerActiveDay:number }> }} [options]
 *        externos con plazo de pago propio (se financian aparte)
 */
export function computeFinance(cashByGroup = {}, finance = {}, { suppliers = [] } = {}) {
  const paymentTermDefined = finance.paymentTermDays !== null && finance.paymentTermDays !== undefined && finance.paymentTermDays !== '' && Number.isFinite(toNumber(finance.paymentTermDays, NaN));
  const paymentTermDays = nonNegative(finance.paymentTermDays);
  const invoiceLagDays = nonNegative(finance.invoiceLagDays);
  const monthlyRatePct = nonNegative(finance.monthlyRatePct);
  const rate = pct(monthlyRatePct);
  const payDays = finance.payDays || {};

  const groups = PAY_GROUPS.map((g) => {
    const cash = cashByGroup[g.id] || { fixedMonthly: 0, variablePerActiveDay: 0 };
    const days = financingDays({ invoiceLagDays, paymentTermDays, payDays: payDays[g.id] });
    const factor = days / DAYS_PER_MONTH_FINANCE;
    return {
      id: g.id,
      label: g.label,
      payDays: nonNegative(payDays[g.id]),
      financingDays: days,
      cashFixedMonthly: cash.fixedMonthly,
      cashVariablePerActiveDay: cash.variablePerActiveDay,
      workingCapitalFixed: cash.fixedMonthly * factor,
      workingCapitalPerActiveDay: cash.variablePerActiveDay * factor,
      financialFixedMonthly: cash.fixedMonthly * rate * factor,
      financialPerActiveDay: cash.variablePerActiveDay * rate * factor,
    };
  });

  const own = (Array.isArray(suppliers) ? suppliers : []).map((x) => {
    const days = financingDays({ invoiceLagDays, paymentTermDays, payDays: x.payDays });
    const factor = days / DAYS_PER_MONTH_FINANCE;
    const fixed = nonNegative(x.fixedMonthly);
    const variable = nonNegative(x.variablePerActiveDay);
    return {
      id: x.key,
      key: x.key,
      label: x.label,
      supplier: true,
      payDays: nonNegative(x.payDays),
      financingDays: days,
      cashFixedMonthly: fixed,
      cashVariablePerActiveDay: variable,
      workingCapitalFixed: fixed * factor,
      workingCapitalPerActiveDay: variable * factor,
      financialFixedMonthly: fixed * rate * factor,
      financialPerActiveDay: variable * rate * factor,
    };
  });
  // Sin plazos propios, los totales son exactamente los de siempre.
  const all = own.length ? [...groups, ...own] : groups;

  return {
    paymentTermDefined,
    paymentTermDays,
    invoiceLagDays,
    monthlyRatePct,
    groups,
    suppliers: own,
    workingCapitalFixed: all.reduce((s, g) => s + g.workingCapitalFixed, 0),
    workingCapitalPerActiveDay: all.reduce((s, g) => s + g.workingCapitalPerActiveDay, 0),
    fixedMonthly: all.reduce((s, g) => s + g.financialFixedMonthly, 0),
    variablePerActiveDay: all.reduce((s, g) => s + g.financialPerActiveDay, 0),
  };
}

/** Días financiados de un grupo de pago o de un proveedor con plazo propio (para el ajuste por salidas completas). */
export function financingDaysOf(finance, key) {
  const list = [...(finance.groups || []), ...(finance.suppliers || [])];
  const g = list.find((x) => x.id === key);
  return g ? g.financingDays : 0;
}
