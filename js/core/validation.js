/**
 * Validación de inputs numéricos. Determinística y sin dependencias de UI.
 *
 * Cada regla recibe el valor crudo (string del input o número) y devuelve
 * { ok: boolean, value: number|null, error: string|null }.
 */

import { toNumber } from './money.js';

export const RULES = Object.freeze({
  money: { min: 0, message: 'Ingresá un monto mayor o igual a 0.' },
  quantity: { min: 0, message: 'La cantidad debe ser mayor o igual a 0.' },
  distance: { min: 0, message: 'La distancia debe ser mayor o igual a 0.' },
  hours: { min: 0, max: 744, message: 'Las horas deben estar entre 0 y 744.' },
  hoursPerDay: { min: 0, max: 24, message: 'Las horas por día deben estar entre 0 y 24.' },
  days: { min: 0, max: 366, message: 'Los días deben estar entre 0 y 366.' },
  daysInMonth: { min: 0, max: 31, message: 'Los días del mes deben estar entre 0 y 31.' },
  availableDays: { min: 0, max: 31, exclusiveMin: true, message: 'Los días disponibles deben ser mayores a 0 y hasta 31.' },
  positiveDays: { min: 0, max: 366, exclusiveMin: true, message: 'Debe ser mayor a 0 días.' },
  paymentDays: { min: 0, max: 720, message: 'Los días deben estar entre 0 y 720.' },
  percent: { min: 0, max: 100, message: 'El porcentaje debe estar entre 0 y 100.' },
  percentOpen: { min: 0, max: 1000, message: 'El porcentaje debe estar entre 0 y 1000.' },
  margin: { min: 0, max: 100, exclusiveMax: true, message: 'El margen debe ser mayor o igual a 0 y menor a 100 %.' },
  utilization: { min: 0, max: 100, exclusiveMin: true, message: 'La utilización debe ser mayor a 0 y hasta 100 %.' },
  positive: { min: 0, exclusiveMin: true, message: 'Debe ser mayor a 0.' },
  years: { min: 0, max: 100, exclusiveMin: true, message: 'La vida útil debe ser mayor a 0 años.' },
  months: { min: 0, max: 600, message: 'Los meses deben estar entre 0 y 600.' },
  integer: { min: 0, integer: true, message: 'Ingresá un número entero mayor o igual a 0.' },
});

/**
 * Valida un valor crudo según una regla.
 * @param {string|number|null|undefined} raw
 * @param {keyof RULES} ruleName
 * @param {{ required?: boolean }} [options]
 */
export function validateNumber(raw, ruleName, { required = false } = {}) {
  const rule = RULES[ruleName] || RULES.money;
  const isEmpty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (isEmpty) {
    return required
      ? { ok: false, value: null, error: 'Campo obligatorio.' }
      : { ok: true, value: null, error: null };
  }
  const value = toNumber(typeof raw === 'string' ? raw.replace(',', '.') : raw, NaN);
  if (!Number.isFinite(value)) return { ok: false, value: null, error: 'Ingresá un número válido.' };
  if (rule.integer && !Number.isInteger(value)) return { ok: false, value: null, error: rule.message };
  if (rule.exclusiveMin ? value <= rule.min : value < rule.min) return { ok: false, value: null, error: rule.message };
  if (rule.max !== undefined && (rule.exclusiveMax ? value >= rule.max : value > rule.max)) {
    return { ok: false, value: null, error: rule.message };
  }
  return { ok: true, value, error: null };
}

/** Recorta y limita textos ingresados por el usuario. */
export function sanitizeText(raw, maxLength = 200) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength);
}

/**
 * Valida una cotización completa y devuelve una lista de problemas
 * (no bloqueantes: los motores sanean valores inválidos a 0).
 * @returns {{ path: string, message: string, severity: 'error'|'warning' }[]}
 */
export function validateQuote(quote) {
  const issues = [];
  if (!quote || typeof quote !== 'object') {
    return [{ path: '', message: 'Cotización inválida.', severity: 'error' }];
  }
  const check = (path, value, ruleName, required = false) => {
    const r = validateNumber(value, ruleName, { required });
    if (!r.ok) issues.push({ path, message: r.error, severity: 'error' });
  };

  const a = quote.activity || {};
  check('activity.activeDaysPerMonth', a.activeDaysPerMonth, 'days');
  check('activity.availableDaysPerMonth', a.availableDaysPerMonth, 'availableDays');
  check('activity.daysPerActivation', a.daysPerActivation, 'positiveDays');
  check('activity.hoursPerActiveDay', a.hoursPerActiveDay, 'hoursPerDay');
  if (toNumber(a.activeDaysPerMonth) > toNumber(a.availableDaysPerMonth) && toNumber(a.availableDaysPerMonth) > 0) {
    issues.push({
      path: 'activity.activeDaysPerMonth',
      message: 'Los días activos superan los días disponibles del mes (utilización mayor a 100 %).',
      severity: 'warning',
    });
  }

  (quote.labor || []).forEach((l, i) => {
    check(`labor.${i}.positions`, l.positions, 'quantity');
    check(`labor.${i}.peoplePerPosition`, l.peoplePerPosition, 'quantity');
    check(`labor.${i}.basicMonthly`, l.basicMonthly, 'money');
    check(`labor.${i}.normalHoursPerMonth`, l.normalHoursPerMonth, 'hours');
    check(`labor.${i}.overtimeHoursPerActiveDay`, l.overtimeHoursPerActiveDay, 'hoursPerDay');
    ['sacPct', 'vacationPct', 'employerContributionsPct', 'artPct'].forEach((k) => check(`labor.${i}.${k}`, l[k], 'percent'));
    check(`labor.${i}.overtimePremiumPct`, l.overtimePremiumPct, 'percentOpen');
  });

  (quote.equipment || []).forEach((e, i) => {
    check(`equipment.${i}.quantity`, e.quantity, 'quantity');
    check(`equipment.${i}.replacementValue`, e.replacementValue, 'money');
    check(`equipment.${i}.residualValue`, e.residualValue, 'money');
    if (toNumber(e.residualValue) > toNumber(e.replacementValue)) {
      issues.push({ path: `equipment.${i}.residualValue`, message: 'El valor residual supera el valor de reposición.', severity: 'warning' });
    }
    check(`equipment.${i}.hoursPerActiveDay`, e.hoursPerActiveDay, 'hoursPerDay');
  });

  const lg = quote.logistics || {};
  check('logistics.distanceKm', lg.distanceKm, 'distance');
  check('logistics.tripsPerActivation', lg.tripsPerActivation, 'quantity');

  const f = quote.finance || {};
  check('finance.paymentTermDays', f.paymentTermDays, 'paymentDays');
  check('finance.monthlyRatePct', f.monthlyRatePct, 'percent');

  const p = quote.pricing || {};
  check('pricing.targetMarginPct', p.targetMarginPct, 'margin');
  check('pricing.customMarginPct', p.customMarginPct, 'margin');
  check('pricing.knownRate', p.knownRate, 'money');
  check('pricing.commercialDiscountPct', p.commercialDiscountPct, 'percent');

  const rules = quote.rules || {};
  (rules.volumeTiers || []).forEach((t, i) => check(`rules.volumeTiers.${i}.discountPct`, t.discountPct, 'percent'));
  check('rules.continuityDiscountPct', rules.continuityDiscountPct, 'percent');
  return issues;
}
