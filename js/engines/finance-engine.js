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
 */
export function computeFinance(cashByGroup = {}, finance = {}) {
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

  return {
    paymentTermDefined,
    paymentTermDays,
    invoiceLagDays,
    monthlyRatePct,
    groups,
    workingCapitalFixed: groups.reduce((s, g) => s + g.workingCapitalFixed, 0),
    workingCapitalPerActiveDay: groups.reduce((s, g) => s + g.workingCapitalPerActiveDay, 0),
    fixedMonthly: groups.reduce((s, g) => s + g.financialFixedMonthly, 0),
    variablePerActiveDay: groups.reduce((s, g) => s + g.financialPerActiveDay, 0),
  };
}
