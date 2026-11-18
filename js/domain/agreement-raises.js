/**
 * Convenios y aumentos (versión 0.11.0, 2026-11-18).
 *
 * - Un puesto de personal SIGUE a su convenio mientras sus parámetros (horas,
 *   SAC, vacaciones, cargas, ART, aportes, contribuciones fijas) sean los del
 *   convenio. Al cambiar el convenio, los puestos que lo siguen se actualizan;
 *   los que tienen valores propios no se tocan.
 * - "Aplicar aumento": un % sobre el remunerativo y otro sobre el no
 *   remunerativo, desde un mes, a todos los puestos del convenio. Queda en el
 *   historial del convenio (con los valores anteriores de cada puesto, para
 *   poder deshacer el último).
 * - agreementRaiseFactor: aumento acumulado entre dos meses, para actualizar
 *   tarifas (lo usa el módulo de actualización de tarifas de Cotizaciones).
 *
 * Funciones puras: no leen la fecha actual ni guardan nada.
 */

import { AGREEMENT_PARAM_KEYS, ILLUSTRATIVE_AGREEMENT_PARAMS } from './catalogs.js';
import { isValidPeriod } from './economic-base.js';
import { isPlainObject } from '../core/object.js';

const EPS = 1e-9;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Parámetros completos de un convenio (los que no cargó, con los de ejemplo). */
export function agreementParamsOf(agreement) {
  const params = agreement && isPlainObject(agreement.params) ? agreement.params : {};
  return { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...params };
}

/**
 * ¿El puesto usa los parámetros del convenio? Un parámetro que el puesto no
 * tiene cargado (dato anterior a 0.11.0) cuenta como igual.
 */
export function profileFollowsParams(profile, params) {
  const p = isPlainObject(profile) ? profile : {};
  return AGREEMENT_PARAM_KEYS.every((k) => {
    const own = num(p[k]);
    if (own === null) return true;
    const ref = num(params[k]);
    return ref !== null && Math.abs(own - ref) < EPS;
  });
}

/** ¿El puesto sigue a su convenio? (false si no tiene convenio). */
export function profileFollowsAgreement(profile, agreement) {
  if (!agreement || !profile || profile.agreementId !== agreement.id) return false;
  return profileFollowsParams(profile, agreementParamsOf(agreement));
}

/** Parámetros de un puesto que difieren de su convenio (claves). */
export function ownParamKeys(profile, agreement) {
  if (!agreement) return [];
  const params = agreementParamsOf(agreement);
  const p = isPlainObject(profile) ? profile : {};
  return AGREEMENT_PARAM_KEYS.filter((k) => {
    const own = num(p[k]);
    if (own === null) return false;
    const ref = num(params[k]);
    return ref === null || Math.abs(own - ref) >= EPS;
  });
}

/** Copia de un puesto con los parámetros de su convenio. */
export function withAgreementParams(profile, agreement) {
  const params = agreementParamsOf(agreement);
  const out = { ...profile };
  AGREEMENT_PARAM_KEYS.forEach((k) => {
    const v = num(params[k]);
    if (v !== null) out[k] = v;
  });
  return out;
}

/**
 * Puestos a actualizar al guardar un convenio: los que seguían los parámetros
 * ANTERIORES del convenio pasan a los nuevos. Devuelve sólo los que cambian.
 * @param {object|null} before  convenio como estaba (null si es nuevo)
 * @param {object} after        convenio guardado
 * @param {object[]} profiles   todos los puestos
 */
export function profilesToPropagate(before, after, profiles = []) {
  if (!after || !after.id) return [];
  const oldParams = agreementParamsOf(before || after);
  const newParams = agreementParamsOf(after);
  const changed = AGREEMENT_PARAM_KEYS.some((k) => num(oldParams[k]) !== num(newParams[k]));
  if (!changed) return [];
  return (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && p.agreementId === after.id && profileFollowsParams(p, oldParams))
    .map((p) => withAgreementParams(p, after));
}

/** Valores de sueldo de un puesto que mueve un aumento. */
const PAY_KEYS = Object.freeze({
  remunerative: ['basicMonthly', 'additionalsMonthly', 'overtimeRate50', 'overtimeRate100'],
  nonRemunerative: ['nonRemunerativeMonthly', 'mealPerActiveDay'],
});

function payOf(profile) {
  const out = {};
  [...PAY_KEYS.remunerative, ...PAY_KEYS.nonRemunerative].forEach((k) => {
    out[k] = num(profile[k]);
  });
  out.basePeriod = profile.base && typeof profile.base.period === 'string' ? profile.base.period : null;
  return out;
}

/** Datos de un aumento, normalizados. null si no es válido. */
export function normalizeRaise(input = {}) {
  const fromPeriod = isValidPeriod(input.fromPeriod) ? input.fromPeriod : null;
  const remunerativePct = num(input.remunerativePct);
  const nonRemunerativePct = num(input.nonRemunerativePct) ?? remunerativePct;
  if (!fromPeriod || remunerativePct === null) return null;
  if (remunerativePct <= -100 || (nonRemunerativePct !== null && nonRemunerativePct <= -100)) return null;
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 160) : '';
  return { fromPeriod, remunerativePct, nonRemunerativePct: nonRemunerativePct ?? 0, note };
}

/** Un puesto con el aumento aplicado (montos redondeados al centavo). */
export function raisedProfile(profile, raise) {
  const r = 1 + raise.remunerativePct / 100;
  const n = 1 + raise.nonRemunerativePct / 100;
  const out = { ...profile };
  PAY_KEYS.remunerative.forEach((k) => {
    const v = num(profile[k]);
    if (v !== null && v > 0) out[k] = round2(v * r);
  });
  PAY_KEYS.nonRemunerative.forEach((k) => {
    const v = num(profile[k]);
    if (v !== null && v > 0) out[k] = round2(v * n);
  });
  // El sueldo pasa a ser "de" el mes del aumento (si es posterior al que tenía).
  const base = isPlainObject(profile.base) ? profile.base : {};
  if (!(typeof base.period === 'string' && base.period > raise.fromPeriod)) out.base = { ...base, period: raise.fromPeriod };
  return out;
}

/**
 * Aplica un aumento a todos los puestos de un convenio.
 * @returns {{ agreement: object, profiles: object[], raise: object }|null}
 *   agreement con el aumento en su historial y los puestos que cambian.
 */
export function applyAgreementRaise(agreement, profiles = [], input = {}, { id, now } = {}) {
  const raise = normalizeRaise(input);
  if (!agreement || !agreement.id || !raise) return null;
  const affected = (Array.isArray(profiles) ? profiles : []).filter((p) => p && p.agreementId === agreement.id);
  const updated = affected.map((p) => raisedProfile(p, raise));
  const record = {
    id: id || `raise-${raise.fromPeriod}-${(agreement.raises || []).length + 1}`,
    ...raise,
    appliedAt: now || null,
    changes: affected.map((p, i) => ({ profileId: p.id, before: payOf(p), after: payOf(updated[i]) })),
  };
  const raises = [...(Array.isArray(agreement.raises) ? agreement.raises : []), record];
  return { agreement: { ...agreement, raises }, profiles: updated, raise: record };
}

/**
 * Deshace el último aumento: cada puesto vuelve a sus valores anteriores si
 * todavía tiene los que dejó el aumento (si alguien lo editó después, no se toca).
 * @returns {{ agreement: object, profiles: object[], skipped: string[] }|null}
 */
export function undoLastAgreementRaise(agreement, profiles = []) {
  const raises = agreement && Array.isArray(agreement.raises) ? agreement.raises : [];
  if (!raises.length) return null;
  const last = raises[raises.length - 1];
  const byId = new Map((Array.isArray(profiles) ? profiles : []).filter(Boolean).map((p) => [p.id, p]));
  const restored = [];
  const skipped = [];
  (last.changes || []).forEach((c) => {
    const p = byId.get(c.profileId);
    if (!p) return;
    const now = payOf(p);
    const same = Object.keys(c.after || {}).every((k) => {
      const a = c.after[k];
      const b = now[k];
      return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b;
    });
    if (!same) {
      skipped.push(p.id);
      return;
    }
    const out = { ...p };
    Object.entries(c.before || {}).forEach(([k, v]) => {
      if (k === 'basePeriod') return;
      if (v !== null) out[k] = v;
    });
    if (isPlainObject(p.base)) out.base = { ...p.base, period: c.before ? c.before.basePeriod : p.base.period };
    restored.push(out);
  });
  return { agreement: { ...agreement, raises: raises.slice(0, -1) }, profiles: restored, skipped };
}

/**
 * Aumento acumulado del remunerativo de un convenio entre dos meses: producto
 * de (1 + % / 100) de los aumentos con "desde" en (fromPeriod, toPeriod].
 * null si el convenio no tiene historial de aumentos o los meses no son válidos.
 * @param {object} agreement
 * @param {string} fromPeriod  'AAAA-MM' (período base de la tarifa)
 * @param {string} toPeriod    'AAAA-MM' (período al que se actualiza)
 * @param {{ part?: 'remunerative'|'nonRemunerative' }} [options]
 */
export function agreementRaiseFactor(agreement, fromPeriod, toPeriod, { part = 'remunerative' } = {}) {
  const raises = agreement && Array.isArray(agreement.raises) ? agreement.raises : [];
  if (!raises.length || !isValidPeriod(fromPeriod) || !isValidPeriod(toPeriod)) return null;
  const key = part === 'nonRemunerative' ? 'nonRemunerativePct' : 'remunerativePct';
  return raises
    .filter((r) => r && isValidPeriod(r.fromPeriod) && r.fromPeriod > fromPeriod && r.fromPeriod <= toPeriod)
    .reduce((f, r) => f * (1 + (num(r[key]) ?? 0) / 100), 1);
}
