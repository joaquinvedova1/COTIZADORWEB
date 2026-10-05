/**
 * Validación de inputs numéricos. Determinística y sin dependencias de UI.
 *
 * Cada regla recibe el valor crudo (string del input o número) y devuelve
 * { ok: boolean, value: number|null, error: string|null }.
 */

import { toNumber } from './money.js';
import { isPlainObject } from './object.js';

export const RULES = Object.freeze({
  money: { min: 0, max: 1e15, message: 'Ingresá un monto mayor o igual a 0 (hasta 1.000 billones).' },
  quantity: { min: 0, max: 1e9, message: 'La cantidad debe ser mayor o igual a 0.' },
  distance: { min: 0, max: 100000, message: 'La distancia debe estar entre 0 y 100.000 km.' },
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
  billingTax: { min: 0, max: 100, exclusiveMax: true, message: 'El impuesto sobre la facturación debe ser mayor o igual a 0 y menor a 100 %.' },
  utilization: { min: 0, max: 100, exclusiveMin: true, message: 'La utilización debe ser mayor a 0 y hasta 100 %.' },
  positive: { min: 0, exclusiveMin: true, message: 'Debe ser mayor a 0.' },
  years: { min: 0, max: 100, exclusiveMin: true, message: 'La vida útil debe ser mayor a 0 años.' },
  months: { min: 0, max: 600, message: 'Los meses deben estar entre 0 y 600.' },
  integer: { min: 0, integer: true, message: 'Ingresá un número entero mayor o igual a 0.' },
});

/**
 * Interpreta un número escrito como lo escribe una persona en Argentina.
 *   "1.800.000"     → 1800000   (punto = separador de miles)
 *   "1.800.000,50"  → 1800000.5 (coma = decimal)
 *   "8,5" / "8.5"   → 8.5       (un único separador no agrupado de a 3 = decimal)
 *   "$ 250.000"     → 250000    (se ignoran $, % y espacios)
 * Formatos ambiguos o mixtos inválidos ("1,234.56", "1.2.3", "1e5") → NaN.
 * @param {string|number|null|undefined} raw
 * @returns {number} número, o NaN si no se puede interpretar sin ambigüedad
 */
export function parseDecimalInput(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw === null || raw === undefined) return NaN;
  const t = String(raw)
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/^\$|^ARS/i, '')
    .replace(/%$/, '');
  if (t === '' || t === '-') return NaN;
  if (/^-?\d+$/.test(t)) return Number(t);
  const hasDot = t.includes('.');
  const hasComma = t.includes(',');
  if (hasDot && hasComma) {
    // es-AR: punto de miles y coma decimal.
    return /^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
  }
  if (hasComma) return /^-?\d*,\d+$/.test(t) ? Number(t.replace(',', '.')) : NaN;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return /^-?\d*\.\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * Texto para mostrar un número dentro de un input editable (coma decimal,
 * sin separador de miles): ida y vuelta segura con parseDecimalInput.
 */
export function numberToInputText(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseDecimalInput(value);
  if (!Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}

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
  const value = typeof raw === 'string' ? parseDecimalInput(raw) : toNumber(raw, NaN);
  if (!Number.isFinite(value)) {
    return { ok: false, value: null, error: 'Ingresá un número válido (usá coma para decimales y punto para miles, p. ej. 1.800.000,50).' };
  }
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

  const a = isPlainObject(quote.activity) ? quote.activity : {};
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

  (Array.isArray(quote.labor) ? quote.labor : []).forEach((l, i) => {
    if (!isPlainObject(l)) return;
    check(`labor.${i}.positions`, l.positions, 'quantity');
    check(`labor.${i}.peoplePerPosition`, l.peoplePerPosition, 'positive');
    check(`labor.${i}.basicMonthly`, l.basicMonthly, 'money');
    check(`labor.${i}.normalHoursPerMonth`, l.normalHoursPerMonth, 'hours');
    check(`labor.${i}.overtimeHoursPerActiveDay`, l.overtimeHoursPerActiveDay, 'hoursPerDay');
    ['sacPct', 'vacationPct', 'employerContributionsPct', 'artPct'].forEach((k) => check(`labor.${i}.${k}`, l[k], 'percent'));
    check(`labor.${i}.overtimePremiumPct`, l.overtimePremiumPct, 'percentOpen');
  });

  (Array.isArray(quote.equipment) ? quote.equipment : []).forEach((e, i) => {
    if (!isPlainObject(e)) return;
    check(`equipment.${i}.quantity`, e.quantity, 'quantity');
    check(`equipment.${i}.replacementValue`, e.replacementValue, 'money');
    check(`equipment.${i}.residualValue`, e.residualValue, 'money');
    if (toNumber(e.residualValue) > toNumber(e.replacementValue)) {
      issues.push({ path: `equipment.${i}.residualValue`, message: 'El valor residual supera el valor de reposición.', severity: 'warning' });
    }
    check(`equipment.${i}.hoursPerActiveDay`, e.hoursPerActiveDay, 'hoursPerDay');
  });

  const lg = isPlainObject(quote.logistics) ? quote.logistics : {};
  check('logistics.distanceKm', lg.distanceKm, 'distance');
  check('logistics.tripsPerActivation', lg.tripsPerActivation, 'quantity');

  const f = isPlainObject(quote.finance) ? quote.finance : {};
  check('finance.paymentTermDays', f.paymentTermDays, 'paymentDays');
  check('finance.monthlyRatePct', f.monthlyRatePct, 'percent');

  const p = isPlainObject(quote.pricing) ? quote.pricing : {};
  check('pricing.targetMarginPct', p.targetMarginPct, 'margin');
  check('pricing.customMarginPct', p.customMarginPct, 'margin');
  check('pricing.knownRate', p.knownRate, 'money');
  check('pricing.commercialDiscountPct', p.commercialDiscountPct, 'percent');

  // Convención de IVA: esta versión sólo trabaja con montos sin IVA.
  if (quote.vatTreatment !== undefined && quote.vatTreatment !== null && quote.vatTreatment !== 'excluded') {
    issues.push({ path: 'vatTreatment', message: 'Esta versión de RATEOS trabaja sólo con montos sin IVA: revisá los montos de esta cotización.', severity: 'error' });
  }

  // Impuestos sobre la facturación: cada % entre 0 y < 100, el total < 100 y
  // margen + impuestos < 100 (si no, no existe un precio que deje ese margen).
  const bt = isPlainObject(quote.billingTaxes) ? quote.billingTaxes : {};
  if (bt.notApplicable !== true) {
    let taxTotal = 0;
    let taxesOk = true;
    const checkTax = (path, value) => {
      const r = validateNumber(value, 'billingTax');
      if (!r.ok) {
        taxesOk = false;
        issues.push({ path, message: r.error, severity: 'error' });
      } else if (r.value !== null) {
        taxTotal += r.value;
      }
    };
    if (bt.mode === 'detailed') {
      (Array.isArray(bt.items) ? bt.items : []).forEach((it, i) => {
        if (isPlainObject(it)) checkTax(`billingTaxes.items.${i}.pct`, it.pct);
      });
    } else {
      checkTax('billingTaxes.combinedPct', bt.combinedPct);
    }
    if (taxesOk && taxTotal >= 100) {
      taxesOk = false;
      issues.push({ path: 'billingTaxes', message: `Los impuestos sobre lo que facturás suman ${String(Math.round(taxTotal * 100) / 100).replace('.', ',')} %: tienen que sumar menos de 100 %.`, severity: 'error' });
    }
    const margin = validateNumber(p.targetMarginPct, 'margin');
    if (taxesOk && taxTotal > 0 && margin.ok && margin.value !== null && margin.value + taxTotal >= 100) {
      const limit = Math.round((100 - taxTotal) * 100) / 100;
      issues.push({
        path: 'pricing.targetMarginPct',
        message: `Con ${String(Math.round(taxTotal * 100) / 100).replace('.', ',')} % de impuestos sobre lo que facturás, el margen tiene que ser menor a ${String(limit).replace('.', ',')} %.`,
        severity: 'error',
      });
    }
  }

  const rules = isPlainObject(quote.rules) ? quote.rules : {};
  (Array.isArray(rules.volumeTiers) ? rules.volumeTiers : []).forEach((t, i) => {
    if (isPlainObject(t)) check(`rules.volumeTiers.${i}.discountPct`, t.discountPct, 'percent');
  });
  check('rules.continuityDiscountPct', rules.continuityDiscountPct, 'percent');
  return issues;
}
