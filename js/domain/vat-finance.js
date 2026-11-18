/**
 * Costo financiero del IVA (K-03, 0.14.0).
 *
 * El IVA no es costo ni ganancia: la empresa lo cobra al cliente y lo paga al fisco. Pero si el
 * fisco lo cobra ANTES de que pague el cliente, la empresa lo adelanta y eso cuesta financiarlo.
 * Pregunta única al cotizar: "¿Facturás con IVA?".
 *
 *   v = IVA que facturás (%), lo carga la empresa (RATEOS no trae alícuotas)
 *   L = días entre que facturás y pagás el IVA (lo carga la empresa: no se asume el día 20)
 *   d = max(0, plazo de cobro − L)                       días que adelantás el IVA
 *   t_iva = v × tasa mensual/100 × d/30                  puntos del precio (sin IVA)
 *
 * t_iva va al divisor junto con el margen y los impuestos sobre la facturación:
 *   precio = costo / (1 − margen − impuestos − t_iva)
 *
 * Crédito fiscal (alivio, criterio conservador): sólo el IVA recuperable que se conoce de los
 * equipos y servicios externos cargados (IVA % × parte recuperable) reduce el IVA a pagar y
 * por eso el costo financiero: alivio = crédito × tasa × d/30 (piso 0). Todo lo demás cuenta
 * como crédito 0.
 *
 * Campo `quote.finance.vat = { applies: null|true|false, ratePct, payLagDays }`. Ausente, null,
 * false o con un número faltante → apagado: los números son los de siempre. Monotributo o
 * exento (Configuración) → nunca aplica (la pregunta no se muestra).
 */

import { isPlainObject } from '../core/object.js';

/** Condiciones frente al IVA de la empresa en las que K-03 nunca aplica. */
export const VAT_FINANCE_EXCLUDED_CONDITIONS = Object.freeze(['monotributo', 'exempt']);

/** Valor por defecto: sin decidir y sin números (no se precarga 21 % ni día 20). */
export function emptyVatFinance() {
  return { applies: null, ratePct: null, payLagDays: null };
}

function readNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** IVA válido: 0 ≤ v < 100. */
export function isValidVatRatePct(v) {
  return v !== null && Number.isFinite(v) && v >= 0 && v < 100;
}

/** Días válidos: 0 ≤ L ≤ 720 (regla paymentDays). */
export function isValidPayLagDays(v) {
  return v !== null && Number.isFinite(v) && v >= 0 && v <= 720;
}

/**
 * Lectura defensiva del campo.
 * @returns {{ present: boolean, applies: boolean|null, ratePct: number|null, payLagDays: number|null }}
 */
export function normalizeVatFinance(raw) {
  if (!isPlainObject(raw)) return { present: false, applies: null, ratePct: null, payLagDays: null };
  return {
    present: true,
    applies: typeof raw.applies === 'boolean' ? raw.applies : null,
    ratePct: readNumber(raw.ratePct),
    payLagDays: readNumber(raw.payLagDays),
  };
}

/** ¿La condición frente al IVA de la empresa permite K-03? (registrada o sin definir). */
export function companyAllowsVatFinance(settings) {
  const c = isPlainObject(settings) ? settings.vatCondition : null;
  return !VAT_FINANCE_EXCLUDED_CONDITIONS.includes(c);
}

/** Valores de la empresa (Configuración): { ratePct, payLagDays } con null si faltan. */
export function companyVatDefaults(settings) {
  const d = isPlainObject(settings) && isPlainObject(settings.defaultVat) ? settings.defaultVat : {};
  const ratePct = readNumber(d.ratePct);
  const payLagDays = readNumber(d.payLagDays);
  return {
    ratePct: isValidVatRatePct(ratePct) ? ratePct : null,
    payLagDays: isValidPayLagDays(payLagDays) ? payLagDays : null,
  };
}

/** ¿La empresa cargó los dos valores? */
export function hasCompanyVatDefaults(settings) {
  const d = companyVatDefaults(settings);
  return d.ratePct !== null && d.payLagDays !== null;
}

/**
 * Campo de una cotización nueva: copia los valores de la empresa. applies = true sólo si están
 * los dos números y la empresa es responsable inscripta; si no, sin decidir.
 */
export function vatFinanceForNewQuote(settings) {
  const d = companyVatDefaults(settings);
  const complete = d.ratePct !== null && d.payLagDays !== null;
  const registered = isPlainObject(settings) && settings.vatCondition === 'registered';
  return { applies: complete && registered ? true : null, ratePct: d.ratePct, payLagDays: d.payLagDays };
}

/**
 * La cotización como la calcula RATEOS según la condición de la empresa: monotributo o exento
 * → sin el campo (K-03 apagado, ni pregunta ni costo). Si no cambia nada, la misma referencia.
 */
export function withCompanyVatCondition(quote, settings) {
  if (companyAllowsVatFinance(settings)) return quote;
  if (!isPlainObject(quote) || !isPlainObject(quote.finance) || !('vat' in quote.finance)) return quote;
  const finance = { ...quote.finance };
  delete finance.vat;
  return { ...quote, finance };
}

/**
 * Estado del costo financiero del IVA de una cotización.
 * active: respondió "Sí" y cargó un IVA (0–<100) y los días (0–720) válidos.
 * pct: t_iva en puntos del precio (0 si no está activo o d ≤ 0).
 * @returns {{ present: boolean, applies: boolean|null, active: boolean, ratePct: number|null, payLagDays: number|null,
 *   paymentTermDays: number, monthlyRatePct: number, days: number, pct: number, missing: string[] }}
 */
export function vatFinanceOf(quote = {}) {
  const q = isPlainObject(quote) ? quote : {};
  const finance = isPlainObject(q.finance) ? q.finance : {};
  const v = normalizeVatFinance(finance.vat);
  const term = readNumber(finance.paymentTermDays);
  const rate = readNumber(finance.monthlyRatePct);
  const paymentTermDays = term !== null && term > 0 ? term : 0;
  const monthlyRatePct = rate !== null && rate > 0 ? rate : 0;
  const rateOk = isValidVatRatePct(v.ratePct);
  const lagOk = isValidPayLagDays(v.payLagDays);
  const missing = v.applies === true ? [...(rateOk ? [] : ['ratePct']), ...(lagOk ? [] : ['payLagDays'])] : [];
  const active = v.applies === true && rateOk && lagOk;
  const days = active ? Math.max(0, paymentTermDays - v.payLagDays) : 0;
  const pct = active ? (v.ratePct * monthlyRatePct / 100) * (days / 30) : 0;
  return {
    present: v.present,
    applies: v.applies,
    active,
    ratePct: rateOk ? v.ratePct : null,
    payLagDays: lagOk ? v.payLagDays : null,
    paymentTermDays,
    monthlyRatePct,
    days,
    pct,
    missing,
  };
}
