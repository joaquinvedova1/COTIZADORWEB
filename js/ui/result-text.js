/**
 * Textos y números de presentación del Resultado — funciones puras, sin DOM
 * ni storage (se testean con node --test, ver tests/ui/result-text.test.js).
 *
 * No calculan nada económico: sólo deciden CÓMO mostrar lo que ya devolvió
 * el motor (computeQuote): con cuántos decimales, qué resta ve el usuario,
 * a qué se atribuye una pérdida y qué aclaración corresponde.
 *
 * Días en superficie: 1 decimal ("6,4 días"), 2 debajo de 1 día (para que
 * 0,45 no se lea "0,5"). El valor mostrado se arma con el MISMO redondeo que
 * formatDays (core/format.js: primero a 2 decimales, como en "Ver cálculo", y
 * después a los decimales pedidos) y se formatea ya redondeado, así lo que
 * se lee y lo que se resta (colchón, diferencias) siempre cierran.
 */

import { formatDays, formatNumber, formatPercent, formatMoney, formatMoneyCeil, EMPTY } from '../core/format.js';
import { isFiniteNumber, roundTo, roundDays } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { normalizeRules } from '../engines/commercial-rules-engine.js';
import { resourceNormalHourCost } from '../engines/out-of-hours-engine.js';
import { monthsFactor } from '../engines/cost-engine.js';
import { effectiveRoundingStep } from '../engines/pricing-engine.js';
import { DEMO_IDS } from '../domain/demo-data.js';
import { isQuantityUnit, quantityCeilText, quantityText } from './unit-text.js';
import { unitTexts, billingUnitOf } from '../domain/billing-units.js';
import { activationTerms, GUARD_FEE_LABEL } from '../domain/activation-terms.js';

const EPS = 1e-9;

// ----------------------------------------------------------------- días

/** Decimales de un resultado en días en superficie: 1; 2 debajo de 1 día. */
/**
 * Puntos del precio que se descuentan de lo facturado (motor): impuestos sobre la facturación +
 * costo financiero del IVA (K-03). Sin K-03 son los impuestos de siempre.
 */
export function deductedPct(k = {}) {
  const g = isFiniteNumber(k.grossUpPct) ? k.grossUpPct : isFiniteNumber(k.billingTaxPct) ? k.billingTaxPct : 0;
  return g > 0 ? g : 0;
}

/**
 * "Con X de impuestos sobre lo que facturás [y Y de costo financiero del IVA], el margen tiene que
 * ser menor a Z" (margen + impuestos + t_iva ≥ 100). Sin K-03, el texto de siempre.
 * @param {object} k  kpis del motor
 * @param {(v: number) => string} [pctText]
 */
export function marginLimitText(k = {}, pctText = (v) => formatPercent(v), { capital = false, subject = 'el margen' } = {}) {
  const t = isFiniteNumber(k.billingTaxPct) && k.billingTaxPct > 0 ? k.billingTaxPct : 0;
  const tv = isFiniteNumber(k.vatFinancePct) && k.vatFinancePct > 0 ? k.vatFinancePct : 0;
  const what = tv > 0
    ? `${t > 0 ? `${pctText(t)} de impuestos sobre lo que facturás y ` : ''}${pctText(tv)} de costo financiero del IVA`
    : `${pctText(t)} de impuestos sobre lo que facturás`;
  const limit = 100 - deductedPct(k);
  if (!(limit > 0)) return `${capital ? 'Con' : 'con'} ${what} no hay precio posible: revisá esos datos`;
  return `${capital ? 'Con' : 'con'} ${what}, ${subject} tiene que ser menor a ${pctText(limit)}`;
}

export function dayDecimals(value) {
  return isFiniteNumber(value) && Math.abs(value) < 1 ? 2 : 1;
}

/**
 * Valor en días tal como se MUESTRA (mismo redondeo que formatDays: a 2
 * decimales y después a `decimals`). 6,3496 → 6,35 → 6,4. null si no es finito.
 */
export function shownDays(value, decimals = dayDecimals(value)) {
  if (!isFiniteNumber(value)) return null;
  const v = roundTo(roundDays(value), decimals);
  return Object.is(v, -0) ? 0 : v;
}

/** "6,4 días" (resultado en días: break-even, días para el margen). */
export function resultDays(value) {
  if (!isFiniteNumber(value)) return EMPTY;
  const decimals = dayDecimals(value);
  return formatDays(shownDays(value, decimals), { decimals });
}

/** "6,4 días de trabajo" / "1 día de trabajo". */
export function activeDaysText(value, decimals = 1) {
  if (!isFiniteNumber(value)) return EMPTY;
  const text = formatDays(shownDays(value, decimals), { decimals });
  return `${text} de trabajo`;
}

/** "+1,5 días" / "-1 día" / "0 días" (diferencias; singular también en negativo). */
export function signedDays(value, decimals = 2) {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = shownDays(value, decimals);
  if (v === 0) return formatDays(0, { decimals });
  return v > 0 ? `+${formatDays(v, { decimals })}` : `-${formatDays(-v, { decimals })}`;
}

/**
 * Diferencia entre dos resultados en días, restando lo que se MUESTRA de
 * cada uno (base 6,4 y escenario 7,1 → 0,7), para que la cuenta cierre.
 */
export function resultDaysDelta(base, scenario) {
  if (!isFiniteNumber(base) || !isFiniteNumber(scenario)) return null;
  return roundTo(shownDays(scenario) - shownDays(base), 2);
}

/**
 * " Estimás 8 días: tenés un colchón de 1,6 días sobre el mínimo." El colchón
 * se calcula con los valores MOSTRADOS: los días estimados (2 decimales) y el
 * mínimo (`beDecimals`, por defecto 1 —o 2 debajo de 1 día—). Si al redondear
 * el signo no coincide con el real (o da 0), se dice "justo" o "apenas debajo".
 */
export function cushionText(D, beDays, { beDecimals = dayDecimals(beDays) } = {}) {
  if (!isFiniteNumber(D) || !isFiniteNumber(beDays)) return '';
  const gap = D - beDays;
  const shownGap = roundTo(shownDays(D, 2) - shownDays(beDays, beDecimals), 2);
  const estimate = ` Estimás ${formatDays(shownDays(D, 2))}:`;
  if (Math.abs(shownGap) < EPS || (gap >= -EPS) !== (shownGap > 0)) {
    return gap >= -EPS ? `${estimate} estás justo en el mínimo.` : `${estimate} estás apenas debajo del mínimo.`;
  }
  return gap >= -EPS
    ? `${estimate} tenés un colchón de ${formatDays(shownGap)} sobre el mínimo.`
    : `${estimate} te faltan ${formatDays(-shownGap)} para no perder plata.`;
}

// ------------------------------------------------------- textos generales

/** "a", "a y b", "a, b y c". */
export function joinList(items) {
  const list = (Array.isArray(items) ? items : []).filter((x) => typeof x === 'string' && x);
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

/** ¿El margen objetivo es 0 (sólo cubrir costos)? */
function isZeroMargin(marginPct) {
  return isFiniteNumber(marginPct) && Math.abs(marginPct) < EPS;
}

/**
 * Para qué es la tarifa sugerida / objetivo: "Para ganar el 10 % sobre el
 * precio." o, con margen objetivo 0, "Cubre tus costos (margen objetivo 0 %)."
 */
export function targetGoalHint(marginPct) {
  if (!isFiniteNumber(marginPct)) return 'Definí un margen objetivo válido para calcularla.';
  if (isZeroMargin(marginPct)) return `Cubre tus costos (margen objetivo ${formatPercent(0)}).`;
  return `Para ganar el ${formatPercent(marginPct)} sobre el precio.`;
}

/** Comienzo de frase: "Para ganar el 10 %" / "Para cubrir tus costos" (margen 0). */
export function targetGoalPrefix(marginPct) {
  if (!isFiniteNumber(marginPct)) return 'Con un margen objetivo válido';
  return isZeroMargin(marginPct) ? 'Para cubrir tus costos' : `Para ganar el ${formatPercent(marginPct)}`;
}

// ------------------------------------------------- tramos de descuento

const hasDiscount = (row) => Boolean(row) && isFiniteNumber(row.discountPct) && row.discountPct > 0;

/**
 * Tramos por días (result.discounts) con el criterio del resultado y del
 * editor: sólo cuentan como DESCUENTO los tramos de más de 0 %. Un tramo sin
 * descuento que pierde plata no pierde por el descuento: es la actividad
 * mínima (pocos días para cubrir los costos fijos).
 */
export function tierDiscountFindings(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const granted = list.filter(hasDiscount);
  return {
    granted: granted.length,
    red: granted.filter((row) => row.status === 'red').length,
    orange: granted.filter((row) => row.status === 'orange').length,
    lowActivity: list.filter((row) => row.status === 'red' && !hasDiscount(row)),
  };
}

/**
 * Tramo en el que cae la actividad JUSTO DEBAJO de `days` (donde se pierde
 * plata antes del break-even): el último cuyo primer día (en días de trabajo,
 * `evaluatedDays`) es menor que `days`. null si `days` está antes del primero.
 */
export function tierBelow(rows, days) {
  if (!isFiniteNumber(days)) return null;
  const list = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && isFiniteNumber(row.evaluatedDays))
    .slice()
    .sort((a, b) => a.evaluatedDays - b.evaluatedDays);
  let found = null;
  list.forEach((row) => {
    if (row.evaluatedDays < days - EPS) found = row;
  });
  return found;
}

/**
 * Aviso de actividad mínima (resultado y editor, el mismo texto) o null.
 *  - Sólo si algún tramo SIN descuento pierde plata y hay break-even (> 0).
 *  - Si el break-even cae en un tramo sin descuento, el número se puede
 *    atribuir a la actividad: con menos días siempre se pierde plata.
 *  - Si cae en un tramo CON descuento, el número también depende del
 *    descuento: no se da un número, se nombran los tramos que pierden por
 *    pocos días.
 * @param {object} result computeQuote(...)
 */
export function minActivityNotice(result) {
  if (!result || result.unit === 'month') return null;
  const rows = Array.isArray(result.discounts) ? result.discounts : [];
  const findings = tierDiscountFindings(rows);
  if (!findings.lowActivity.length) return null;
  const be = result.breakEven || {};
  if (be.notApplicable || !be.reachable || !isFiniteNumber(be.days) || !(be.days > 0)) return null;
  if (!hasDiscount(tierBelow(rows, be.days))) {
    const days = resultDays(be.days);
    return findings.granted > 0
      ? `Con menos de ${days} trabajados perdés plata (no es por el descuento: es la actividad mínima).`
      : `Con menos de ${days} trabajados perdés plata: es la actividad mínima para cubrir tus costos.`;
  }
  const labels = joinList(findings.lowActivity.map((row) => `"${row.label}"`));
  return findings.lowActivity.length === 1
    ? `El tramo ${labels} pierde plata en su primer día por la actividad mínima (pocos días para cubrir los costos fijos), no por un descuento.`
    : `Los tramos ${labels} pierden plata en su primer día por la actividad mínima (pocos días para cubrir los costos fijos), no por un descuento.`;
}

/**
 * Aviso de los descuentos (insignia de "Ver reglas comerciales"): sólo los
 * tramos de más de 0 % y el descuento por continuidad. null si ninguno
 * pierde plata ni baja del objetivo.
 * @returns {null | { tone: 'red'|'orange', count: number, text: string, title: string }}
 */
export function discountAlert(result) {
  const findings = tierDiscountFindings(result && result.discounts);
  let { red, orange } = findings;
  const c = (result && result.continuity) || {};
  if (c.applies && c.status === 'red') red += 1;
  else if (c.applies && c.status === 'orange') orange += 1;
  if (red) {
    const text = red === 1 ? 'Un descuento pierde plata' : `${formatNumber(red)} descuentos pierden plata`;
    return { tone: 'red', count: red, text, title: `${text}: con ese descuento la tarifa neta queda debajo de la tarifa mínima` };
  }
  if (orange) {
    const text = orange === 1 ? 'Un descuento bajo el objetivo' : `${formatNumber(orange)} descuentos bajo el objetivo`;
    return { tone: 'orange', count: orange, text, title: `${text}: cubren los costos pero dejan el margen debajo del objetivo` };
  }
  return null;
}

/**
 * Qué descuentos separan la tarifa de lista de la neta con la actividad
 * estimada: "del descuento del tramo" si es sólo el tramo por días;
 * "de los descuentos" si también hay continuidad o descuento comercial.
 */
export function discountWords(result) {
  const r = result || {};
  const estimateRow = (Array.isArray(r.matrix) ? r.matrix : []).find((row) => row && row.isEstimate);
  const tier = Boolean(estimateRow) && isFiniteNumber(estimateRow.tierDiscountPct) && estimateRow.tierDiscountPct > 0;
  const continuity = Boolean(r.continuity && r.continuity.applies && r.continuity.discountPct > 0);
  const commercial = Boolean(r.ctx && isFiniteNumber(r.ctx.commercialDiscountPct) && r.ctx.commercialDiscountPct > 0);
  return tier && !continuity && !commercial ? 'del descuento del tramo' : 'de los descuentos';
}

// ------------------------------------------------ comparador de modelos

/**
 * ¿La cotización cobra algo además de la tarifa? Abono o equipo en espera
 * (ingresos fijos), cargos por llamado / movilización / km (por día de trabajo),
 * mínimo mensual garantizado o un mínimo por llamado que de verdad se aplica.
 */
function hasOtherCharges(result) {
  const l = result.linear || {};
  if ((isFiniteNumber(l.fixedRevenue) && l.fixedRevenue > 1e-6) || (isFiniteNumber(l.otherRevenuePerActiveDay) && l.otherRevenuePerActiveDay > 1e-6)) return true;
  const estimate = (result.estimate && result.estimate.revenue) || {};
  if (estimate.minimumCallApplied) return true;
  try {
    return normalizeRules((result.ctx && result.ctx.rules) || {}).hasMinimumGuarantee;
  } catch {
    return false;
  }
}

/**
 * Nota del comparador: por qué el break-even de los modelos difiere del de
 * la cotización. Cada modelo usa la tarifa objetivo (calibrada para el
 * margen), sin las reglas propias de la cotización. La causa se arma según
 * el caso; si el break-even de "Sólo tarifa por día" se ve igual al de la
 * cotización, no hace falta nota ('').
 * @param {object} result computeQuote(...)
 * @param {Array<{ id: string, breakEvenDays: number|null, breakEvenReachable: boolean }>} models compareCommercialModels(...).models
 * @param {{ roundingStep?: number|null }} [options] redondeo comercial de la cotización
 */
export function comparatorNote(result, models, { roundingStep = null } = {}) {
  const r = result || {};
  const be = r.breakEven || {};
  if (r.unit === 'month' || !be.reachable || !isFiniteNumber(be.days)) return '';
  // "Sólo tarifa por día" o, por cantidad (PLAN-2026-010), "Sólo tarifa por m³".
  const dayRate = (Array.isArray(models) ? models : []).find((m) => m && (m.id === 'day_rate' || m.id === 'unit_rate'));
  if (dayRate && dayRate.breakEvenReachable && isFiniteNumber(dayRate.breakEvenDays) && resultDays(dayRate.breakEvenDays) === resultDays(be.days)) return '';
  const source = r.kpis ? r.kpis.commercialSource : null;
  const own = source !== 'suggested';
  const extras = [];
  if (tierDiscountFindings(r.discounts).granted > 0) extras.push('sin tramos de descuento');
  if (hasOtherCharges(r)) extras.push(`sin los otros cobros de tu cotización (abono, cargos ${termsOfResult(r).per}, equipo en espera y mínimos)`);
  if (!own && !extras.length && isFiniteNumber(roundingStep) && roundingStep > 0) extras.push('sin el redondeo de la tarifa sugerida');
  const cause = `${own ? ' (no tu tarifa)' : ''}${extras.length ? `, ${joinList(extras)}` : ''}`;
  const verb = own || extras.length ? 'difiere' : 'puede diferir';
  const own2 = isQuantityUnit(r) && isFiniteNumber(be.quantity) ? quantityCeilText(be.quantity, r) : resultDays(be.days);
  return `El break-even de cada modelo usa la tarifa objetivo${cause}: por eso ${verb} del de tu cotización (${own2}).`;
}

// ------------------------------------------------------- completitud

/**
 * Nota de los pendientes en una cotización ILUSTRATIVA. La demo (hidrogrúa)
 * deja a propósito puntos para revisar (decisión UX-3); en otros ejemplos
 * (p. ej. el caso de referencia del motor) la nota es neutra.
 * @returns {string|null}
 */
export function completenessExampleNote({ quoteId = null, illustrative = false, pendingCount = 0 } = {}) {
  if (!illustrative || !(pendingCount > 0)) return null;
  if (quoteId === DEMO_IDS.quoteHydroCrane) {
    return 'Es un ejemplo: deja estos puntos para revisar a propósito, para que veas cómo RATEOS te avisa lo que suele faltar.';
  }
  return 'Es un ejemplo: puede dejar puntos sin completar. En tu cotización, revisalos antes de cotizar.';
}

/**
 * Banner de borrador (PLAN-2026-010): si quedan pendientes críticos o para
 * revisar, la tarifa no está lista para usar. Los informativos no cuentan.
 * Devuelve null si no hay nada material.
 */
export function draftBannerText({ critical = 0, review = 0, unreliable = 0, closed = false } = {}) {
  // Precio cerrado: "este precio" (tanda novato).
  const what = closed ? 'ESTE PRECIO' : 'ESTA TARIFA';
  const c = Number.isFinite(critical) && critical > 0 ? Math.floor(critical) : 0;
  const rv = Number.isFinite(review) && review > 0 ? Math.floor(review) : 0;
  const u = Number.isFinite(unreliable) && unreliable > 0 ? Math.floor(unreliable) : 0;
  const total = c + rv;
  if (total === 0) return null;
  const parts = [];
  if (c > 0) parts.push(c === 1 ? '1 crítico (cambia el costo o el precio)' : `${c} críticos (cambian el costo o el precio)`);
  if (rv > 0) parts.push(`${rv} para revisar`);
  const counts = `${parts.join(' y ')}.`.replace(/^./, (x) => x.toUpperCase());
  // ECO-01: los números se muestran (no se reinterpreta nada) pero no son reales: se dice primero.
  if (u > 0) {
    return {
      tone: 'danger',
      unreliable: true,
      title: `RESULTADO NO CONFIABLE — NO UTILIZAR ${what}.`,
      text: `${u === 1 ? 'Un dato hace' : `${u} datos hacen`} que el costo, la facturación o el margen de abajo no sean reales: resolvelo antes de cotizar. ${counts}`,
    };
  }
  return {
    tone: c > 0 ? 'danger' : 'warning',
    title: `BORRADOR — revisar ${total} ${total === 1 ? 'punto' : 'puntos'} antes de usar ${what.toLowerCase()}.`,
    text: counts,
  };
}

/** Pendientes que vuelven NO CONFIABLE el resultado (ECO-01): `unreliable` del motor de completitud. */
export function unreliableItems(completeness) {
  const pending = completeness && Array.isArray(completeness.pending) ? completeness.pending : [];
  return pending.filter((i) => i && i.unreliable === true);
}

/** "NO CONFIABLE (Dos abonos por mes): no uses este número." o null (para el margen y el resultado). */
export function unreliableText(completeness, what = 'este número') {
  const items = unreliableItems(completeness);
  if (!items.length) return null;
  return `NO CONFIABLE (${items.map((i) => i.label).join(', ')}): no uses ${what} hasta resolverlo.`;
}

/**
 * "Cada salida se cuenta completa" (PLAN-2026-011; semántica explícita en
 * PLAN-2026-014, LAB-D1): salidas PROMEDIO, salidas COSTEADAS y EFECTO DEL
 * REDONDEO. Apagada, la frecuencia es un promedio y los costos por salida se
 * cuentan en proporción; encendida, los costos indivisibles por salida se
 * cuentan con salidas completas (⌈promedio⌉). `r` = result.activationRounding
 * (con `preview`); `terms` = activationTerms(quote). Null si no hay salidas.
 */
/** Nombre de la activación de la cotización de un resultado (llamado / salida / intervención…, PLAN-2026-014). */
export function termsOfResult(result) {
  const r = result && result.model && result.model.activationRounding;
  return activationTerms(r ? r.terms : null);
}

export function activationRoundingText(r, terms = activationTerms()) {
  if (!r || !(r.estimated > 1e-9)) return null;
  const T = terms;
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  const whole = Math.abs(r.estimated - Math.round(r.estimated)) < 1e-6;
  const preview = r.preview || r;
  const hasDiscrete = preview.perActivationDiscrete > 0;
  const head = (costed) => `${T.Many} promedio por mes: ${n(r.estimated)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${n(costed)}`;
  if (r.enabled) {
    if (whole) return { tone: 'info', text: `${head(r.costed)}. Ya son ${T.g('enteras', 'enteros')}: la opción no cambia el costo.` };
    if (!hasDiscrete) return { tone: 'info', text: `${head(r.costed)}. No hay costos por ${T.one} cargados: la opción no cambia el costo.` };
    return {
      tone: 'warning',
      text: `${head(r.costed)} (${T.each} ${T.whole}). Efecto del redondeo: +${formatMoney(r.total)} por mes (movilización, viajes y cargos por ${T.one}, con su estructura, financiación y contingencia). La producción y la facturación siguen con ${n(r.estimated)}.`,
    };
  }
  if (whole || !hasDiscrete) return null;
  return {
    tone: 'info',
    text: `${head(r.estimated)} (promedio: los costos por ${T.one} se cuentan en proporción). Si ${T.each} se paga ${T.whole}, activá la opción: se costearía${preview.wholeActivations === 1 ? '' : 'n'} ${n(preview.wholeActivations)} (efecto del redondeo: +${formatMoney(preview.total)} por mes).`,
  };
}

/**
 * Equilibrio en 0 (PLAN-2026-012): nunca "0 viajes" sin explicación.
 *   no_fixed_costs  sin costos fijos: cada unidad vendida cubre su costo variable
 *   fixed_revenue   los ingresos fijos (abono, standby) ya cubren los costos fijos
 * @param {{ breakEven?: object, unitInfo?: object, unit?: string }} result
 * @param {{ compact?: boolean, rateText?: string }} [options]  compact: para un KPI o un resumen;
 *   rateText: con qué tarifa ("a la tarifa sugerida de $ 1.262.000 / viaje")
 * @returns {string|null}  null si el equilibrio no es 0
 */
export function breakEvenZeroText(result, { compact = false, rateText = '' } = {}) {
  const r = result || {};
  const be = r.breakEven || {};
  const reason = be.zeroReason;
  if (!be.reachable || (reason !== 'no_fixed_costs' && reason !== 'fixed_revenue')) return null;
  const byQuantity = isQuantityUnit(r);
  const u = r.unitInfo || {};
  const t = unitTexts(u);
  const singular = byQuantity ? u.singular || 'unidad' : 'día';
  const first = byQuantity ? `${t.elPrimer} ${singular}` : 'el primer día';
  const rate = rateText ? ` ${rateText}` : '';
  if (reason === 'no_fixed_costs') {
    if (compact) return `Desde ${first}`;
    const each = byQuantity ? `cada ${singular} ${t.vendido}` : 'cada día trabajado';
    return `Sin costos fijos: ${each} cubre su costo variable. Desde ${first} hay contribución positiva${rate}.`;
  }
  if (compact) return 'Cubierto con ingresos fijos';
  // Con mínimo garantizado (B-3) se nombra: es lo que más suele cubrir los fijos.
  let guarantee = false;
  try {
    guarantee = Boolean(normalizeRules((r.ctx && r.ctx.rules) || {}).hasMinimumGuarantee);
  } catch {
    guarantee = false;
  }
  const sources = `${guarantee ? 'mínimo garantizado, ' : ''}abono, equipo en espera, adicionales estimados`;
  return byQuantity
    ? `Cubrís todos tus costos aunque no factures ${t.ningun} ${singular}${rate}: los ingresos fijos (${sources}) ya cubren los costos fijos.`
    : `Cubrís todos tus costos aunque no trabajes ningún día${rate}: los ingresos fijos (${sources}) ya cubren los costos fijos.`;
}

// ------------------------------------------------- testeo con especialistas (2026-11)

/**
 * Ventana de pérdida con mínimo garantizado (tanda B 2026-11, B-3, H-29). El motor da los tramos
 * (`breakEven.lossWindows`); acá sólo se escriben. null si el mínimo no protege los primeros días
 * (entonces el break-even de siempre ya lo dice todo).
 *   "Con el mínimo garantizado, hasta 15,85 días el mínimo cubre tus costos; entre 15,85 y 20,97 días
 *    perdés plata (el mínimo ya no alcanza y lo trabajado todavía no cubre); desde 20,97 días ganás."
 * @param {object} result computeQuote(...)
 * @param {{ estimateDays?: number|null }} [options] con los días estimados agrega dónde caen
 */
export function lossWindowText(result, { estimateDays = null } = {}) {
  const r = result || {};
  const be = r.breakEven || {};
  const windows = Array.isArray(be.lossWindows) ? be.lossWindows : [];
  if (!be.guaranteeProtects || !windows.length) return null;
  const byQuantity = isQuantityUnit(r);
  const u = r.unitInfo || {};
  const at = (days, quantity) => (byQuantity && isFiniteNumber(quantity)
    ? `${formatNumber(quantity, { decimals: Math.abs(quantity - Math.round(quantity)) < 1e-9 ? 0 : 2 })} ${Math.abs(quantity - 1) < 1e-9 ? u.singular || 'unidad' : u.plural || 'unidades'}`
    : formatDays(days));
  const first = windows[0];
  const parts = windows.map((w) => (w.open ? `desde ${at(w.fromDays, w.fromQuantity)} perdés plata` : `entre ${at(w.fromDays, w.fromQuantity)} y ${at(w.toDays, w.toQuantity)} perdés plata`));
  const last = windows[windows.length - 1];
  const gains = last.open ? '' : `; desde ${at(last.toDays, last.toQuantity)} ganás`;
  let where = '';
  if (isFiniteNumber(estimateDays)) {
    const inside = windows.some((w) => estimateDays > w.fromDays + 1e-9 && (w.open || estimateDays < w.toDays - 1e-9));
    where = inside ? ' Tu estimación cae en el tramo en que perdés.' : '';
  }
  return `Con el mínimo garantizado, hasta ${at(first.fromDays, first.fromQuantity)} el mínimo cubre tus costos; ${parts.join('; ')} (el mínimo ya no alcanza y lo trabajado todavía no cubre)${gains}.${where}`;
}

/**
 * Tramos de la ventana de pérdida para dibujarlos (B-3): cubre el mínimo → perdés → ganás…, con
 * los textos de los bordes ("15,85 días" / "95,7 válvulas"). Sólo escribe lo que dio el motor.
 * @returns {{ kind: 'covered'|'loss'|'gain', from: string|null, to: string|null, fromDays: number, toDays: number|null, here: boolean }[]|null}
 */
export function lossWindowSegments(result, { estimateDays = null } = {}) {
  const r = result || {};
  const be = r.breakEven || {};
  const windows = Array.isArray(be.lossWindows) ? be.lossWindows : [];
  if (!be.guaranteeProtects || !windows.length) return null;
  const byQuantity = isQuantityUnit(r);
  const u = r.unitInfo || {};
  const at = (days, quantity) => (byQuantity && isFiniteNumber(quantity)
    ? `${formatNumber(quantity, { decimals: Math.abs(quantity - Math.round(quantity)) < 1e-9 ? 0 : 2 })} ${Math.abs(quantity - 1) < 1e-9 ? u.singular || 'unidad' : u.plural || 'unidades'}`
    : formatDays(days));
  const segs = [{ kind: 'covered', from: null, to: at(windows[0].fromDays, windows[0].fromQuantity), fromDays: 0, toDays: windows[0].fromDays }];
  windows.forEach((w, i) => {
    segs.push({ kind: 'loss', from: at(w.fromDays, w.fromQuantity), to: w.open ? null : at(w.toDays, w.toQuantity), fromDays: w.fromDays, toDays: w.open ? null : w.toDays });
    if (w.open) return;
    const next = windows[i + 1];
    segs.push({ kind: 'gain', from: at(w.toDays, w.toQuantity), to: next ? at(next.fromDays, next.fromQuantity) : null, fromDays: w.toDays, toDays: next ? next.fromDays : null });
  });
  const D = isFiniteNumber(estimateDays) ? estimateDays : null;
  return segs.map((sg) => ({ ...sg, here: D !== null && D > sg.fromDays - 1e-9 && (sg.toDays === null || D < sg.toDays - 1e-9) }));
}

/**
 * Título de la insignia ILUSTRATIVO (A-9, H-19): nombra cada causa, también la
 * tasa de financiamiento de ejemplo (antes quedaba "Incluye valores ILUSTRATIVOS: .").
 * @param {{ any?: boolean, quote?: boolean, lines?: number, fuel?: boolean, finance?: boolean }} info  illustrativeInfo(quote)
 * @returns {string|null}
 */
export function illustrativeTitle(info) {
  if (!info || !info.any) return null;
  if (info.quote) return 'Cotización con valores de demostración';
  const parts = [];
  if (info.lines > 0) parts.push(`${formatNumber(info.lines)} ${info.lines === 1 ? 'ítem copiado' : 'ítems copiados'} de plantillas o bibliotecas de demostración`);
  if (info.fuel) parts.push('precio de combustible ilustrativo');
  if (info.finance) parts.push('tasa de financiamiento de ejemplo (en Financiación)');
  if (!parts.length) return 'Incluye valores ILUSTRATIVOS. Reemplazalos por valores propios vigentes.';
  return `Incluye valores ILUSTRATIVOS: ${joinList(parts)}. Reemplazalos por valores propios vigentes.`;
}

/**
 * Texto de la insignia de valores de ejemplo (tanda novato): dice QUÉ es de ejemplo
 * ("Combustible de ejemplo", "Cargas de ejemplo (2)", "Valores de ejemplo (2)"); el
 * detalle queda en el title (illustrativeTitle). "ILUSTRATIVO" a secas sólo si TODA la
 * cotización es de demostración.
 * @param {{ any?: boolean, quote?: boolean, lines?: number, fuel?: boolean, finance?: boolean }} info  illustrativeInfo(quote)
 * @returns {string|null}
 */
export function illustrativeBadgeText(info) {
  if (!info || !info.any) return null;
  if (info.quote) return 'ILUSTRATIVO';
  const lines = info.lines > 0 ? info.lines : 0;
  const kinds = [lines > 0, Boolean(info.fuel), Boolean(info.finance)].filter(Boolean).length;
  if (kinds > 1) return `Valores de ejemplo (${kinds})`;
  if (info.fuel) return 'Combustible de ejemplo';
  if (info.finance) return 'Tasa de financiación de ejemplo';
  if (lines > 0) return lines === 1 ? 'Carga de ejemplo' : `Cargas de ejemplo (${formatNumber(lines)})`;
  return 'Valores de ejemplo';
}

// ------------------------------------------------- precio cerrado: palabras

/** ¿Precio cerrado? (contract.mode = 'closed'): se habla de "precio", no de "tarifa". */
export function isClosedPrice(r) {
  return Boolean(r && r.contract && r.contract.mode === 'closed');
}

/**
 * Precio cerrado con UN trabajo por mes: las cifras "del mes" son las del trabajo y se rotulan
 * así ("Costo del equipo en el trabajo"). Mismo criterio que el Resultado (closedOf).
 */
export function isSingleClosedJob(r) {
  const q = r && r.kpis ? r.kpis.billableQuantity : null;
  return isClosedPrice(r) && Number.isFinite(q) && Math.abs(q - 1) < 1e-9;
}

/**
 * Precio cerrado (Joaco 2026-11-18, "toda la cotización en la unidad que defino"): trabajos
 * por mes con los que se pasa una cifra del mes a "en el trabajo". Mismo divisor que el
 * "Total del trabajo" del Resultado (price-composition: revenue.activations). null fuera de
 * precio cerrado o sin trabajos cargados todavía.
 */
export function closedJobsPerMonth(r) {
  if (!isClosedPrice(r)) return null;
  const a = r.estimate && r.estimate.revenue ? r.estimate.revenue.activations : null;
  return Number.isFinite(a) && a > 1e-9 ? a : null;
}

/**
 * Una cifra del mes en la unidad de la cotización: en precio cerrado, "en el trabajo"
 * (lo del mes ÷ trabajos por mes); si no, "por mes". Sólo presentación: no cambia cálculos.
 * @returns {{ amount: number, closed: boolean, text: string, where: string }}
 */
export function perQuoteUnit(r, monthly) {
  const v = Number.isFinite(monthly) ? monthly : 0;
  const jobs = closedJobsPerMonth(r);
  if (jobs !== null) return { amount: v / jobs, closed: true, where: 'en el trabajo', text: `${formatMoney(v / jobs)} en el trabajo` };
  return { amount: v, closed: false, where: 'por mes', text: `${formatMoney(v)} por mes` };
}

/** Lo del mes de una línea (fijo × meses de costo fijo + lo de cada día × días), como el motor. */
export function lineMonthAtEstimate(r, line) {
  if (!r || !line) return 0;
  const D = r.activity ? r.activity.activeDaysPerMonth : 0;
  const factor = monthsFactor(D, r.activity ? r.activity.availableDaysPerMonth : 0);
  return (line.fixedMonthly || 0) * factor + (line.variablePerActiveDay || 0) * (D || 0);
}

/**
 * Horas extra del trabajo de un puesto en el mes estimado (M2, 2026-11-18): lo que el motor suma
 * DENTRO del personal para ese puesto (overtime-work-engine `perRole[].monthly`). 0 si no hay.
 */
export function roleOvertimeMonth(r, index) {
  const o = r && r.model ? r.model.overtimeWork : null;
  if (!o || !o.active || !Array.isArray(o.perRole)) return 0;
  const role = o.perRole.find((x) => x.index === index);
  if (!role || !(role.monthly > 0)) return 0;
  // Fijo mensual: lo del mes, con los meses de costo fijo si el trabajo dura más que los disponibles.
  if (o.mode === 'some' && o.perMonth) return role.monthly * monthsFactor(r.activity ? r.activity.activeDaysPerMonth : 0, r.activity ? r.activity.availableDaysPerMonth : 0);
  return role.monthly;
}

/** "Horas extra del trabajo (todo al 50 %)" / "Horas extra del trabajo": rótulo corto para explicaciones. */
export function overtimeWorkLabel(r) {
  const o = r && r.model ? r.model.overtimeWork : null;
  if (!o || !o.active) return '';
  return o.mode === 'all' ? `horas extra (todo el trabajo al ${o.premiumPct}\u00a0%)` : 'horas extra del trabajo';
}

/**
 * Por servicio prestado (hora, día, jornada, m³…), al lado de lo del mes: " · ≈ $ X por día"
 * = lo del mes ÷ unidades que facturás en el mes (Joaco 2026-11-18: ver el costo en la unidad
 * que cotizás). Vacío en precio cerrado, en fijo mensual o sin unidades cargadas.
 */
/** "≈ $ X por hora" sin cortes de línea adentro (UX 2026-11): una sola función para todos lados. */
export function approxAmountText(amount, unitSingular) {
  return `≈\u00a0${formatMoney(amount)}\u00a0por\u00a0${String(unitSingular).replace(/ /g, '\u00a0')}`;
}

export function perBilledUnitSuffix(r, quote, monthly) {
  if (isClosedPrice(r) || !quote) return '';
  const info = billingUnitOf(quote);
  if (info.kind === 'month') return '';
  const units = r && r.estimate && r.estimate.revenue ? r.estimate.revenue.billableUnits : null;
  if (!(Number.isFinite(units) && units > 1e-9) || !(monthly > 0.005)) return '';
  // Espacios de no separación (UX, 2026-11): "≈ $ X por hora" no se corta en celular.
  return ` · ${approxAmountText(monthly / units, info.singular)}`;
}

/**
 * Una cifra del mes dicha en la unidad de cobro de la cotización (regla 2, 2026-11-18):
 * precio cerrado → "$ X en el trabajo"; fijo mensual → "$ X por mes"; por hora, día o
 * cantidad → "$ X por mes · ≈ $ Y por hora". Sólo presentación.
 */
export function unitAmountText(r, quote, monthly) {
  const v = Number.isFinite(monthly) ? monthly : 0;
  if (closedJobsPerMonth(r) !== null) return perQuoteUnit(r, v).text;
  // 0.20.0: primero en la unidad de cobro; el mes, como dato secundario.
  const per = perBilledUnitAmount(r, quote, v);
  if (per === null) return `${formatMoney(v)} por mes`;
  return `${formatMoney(per)}\u00a0por\u00a0${unitSingularOf(quote)} · ${formatMoney(v)}\u00a0por\u00a0mes`;
}

/** Singular de la unidad de cobro, sin cortes de línea ("metro\u00a0lineal"). */
function unitSingularOf(quote) {
  return String(billingUnitOf(quote).singular || 'unidad').replace(/ /g, '\u00a0');
}

/**
 * Una cifra del mes llevada a la unidad de cobro (÷ unidades a facturar por mes), o null si no
 * aplica: precio cerrado (se dice "en el trabajo"), cobro por mes o sin unidades cargadas.
 * Sólo presentación (0.20.0: todo se lee primero en la unidad de cobro).
 */
export function perBilledUnitAmount(r, quote, monthly) {
  if (isClosedPrice(r) || !quote) return null;
  const info = billingUnitOf(quote);
  if (info.kind === 'month') return null;
  const units = r && r.estimate && r.estimate.revenue ? r.estimate.revenue.billableUnits : null;
  if (!(Number.isFinite(units) && units > 1e-9) || !(monthly > 0.005)) return null;
  return monthly / units;
}

/**
 * Rótulo de un total por categoría en la unidad de la cotización (0.20.0): "Equipos en el costo
 * por válvula" / "… del trabajo" / "… del mes".
 */
export function costPlaceLabel(r, quote, what) {
  if (closedJobsPerMonth(r) !== null) return `${what} en el costo del trabajo`;
  const info = quote ? billingUnitOf(quote) : null;
  const units = r && r.estimate && r.estimate.revenue ? r.estimate.revenue.billableUnits : null;
  if (!info || isClosedPrice(r) || info.kind === 'month' || !(Number.isFinite(units) && units > 1e-9)) return `${what} en el costo del mes`;
  // El valor ya dice "por válvula · por mes": el rótulo no lo repite.
  return `${what} en el costo`;
}

/** "trabajo" / "mes" para rótulos ("Costo del equipo en el trabajo"): trabajo sólo con trabajos cargados. */
export function quoteUnitPlace(r) {
  return closedJobsPerMonth(r) !== null ? 'trabajo' : 'mes';
}

/** "Tarifa sugerida" o, en precio cerrado, "Precio sugerido". */
export function suggestedRateName(r) {
  return isClosedPrice(r) ? 'Precio sugerido' : 'Tarifa sugerida';
}

/** "Tarifa mínima (para no perder)" o, en precio cerrado, "Precio mínimo (para no perder)". */
export function floorRateName(r, { short = false } = {}) {
  const base = isClosedPrice(r) ? 'Precio mínimo' : 'Tarifa mínima';
  return short ? base : `${base} (para no perder)`;
}

/**
 * "Ver cálculo" de la tarifa sugerida (tanda novato): la cuenta en palabras, reutilizando la
 * traza del precio objetivo del motor (r.traces.targetRate) y sus valores. No calcula nada:
 * costo + impuestos + ganancia = facturación necesaria (motor) → − otros ingresos → ÷ cantidad
 * = precio objetivo (motor) → redondeo hacia arriba = sugerida (motor).
 * @param {object} r resultado de computeQuote
 * @param {{ roundingStep?: number|null, effectiveStep?: number|null, title?: string }} [o]
 */
export function suggestedRateTrace(r, { roundingStep = null, effectiveStep = null, title = null } = {}) {
  const base = r && r.traces ? r.traces.targetRate : null;
  if (!base) return null;
  const k = r.kpis || {};
  const ra = r.ratesAtEstimate || {};
  const name = title || suggestedRateName(r);
  const t = isFiniteNumber(k.billingTaxPct) && k.billingTaxPct > 0 ? k.billingTaxPct : 0;
  // Costo financiero del IVA (K-03): también se cubre con la facturación.
  const tv = isFiniteNumber(k.vatFinancePct) && k.vatFinancePct > 0 ? k.vatFinancePct : 0;
  const m = isFiniteNumber(k.targetMarginPct) && !k.targetMarginInvalid ? k.targetMarginPct : null;
  const stepOf = (label) => (base.steps || []).find((x) => x.label === label) || null;
  const required = stepOf('Facturación necesaria');
  const net = stepOf('Tarifa objetivo neta');
  const other = isFiniteNumber(ra.otherRevenue) && ra.otherRevenue > 0 ? ra.otherRevenue : 0;
  const factor = isFiniteNumber(ra.discountFactor) ? ra.discountFactor : 1;
  const discounted = Math.abs(factor - 1) > EPS;
  const unitsWord = r.unitInfo && r.unitInfo.plural ? r.unitInfo.plural : 'unidades';
  const units = isFiniteNumber(ra.billableUnits) ? `${formatNumber(ra.billableUnits, { decimals: Math.abs(ra.billableUnits - Math.round(ra.billableUnits)) < EPS ? 0 : 2 })} ${Math.abs(ra.billableUnits - 1) < EPS && r.unitInfo && r.unitInfo.singular ? r.unitInfo.singular : unitsWord}` : `los ${unitsWord} del mes`;
  const configured = isFiniteNumber(Number(roundingStep)) && Number(roundingStep) > 0 ? Number(roundingStep) : 0;
  // El mismo paso que usó el motor (acotado al 1 % de la tarifa).
  const step = isFiniteNumber(Number(effectiveStep)) && Number(effectiveStep) > 0
    ? Number(effectiveStep)
    : configured > 0 && isFiniteNumber(k.targetListRate) ? effectiveRoundingStep(k.targetListRate, configured) : configured;
  const parts = ['costo', t > 0 ? 'impuestos sobre lo que facturás' : null, tv > 0 ? 'costo financiero del IVA' : null, 'tu ganancia'].filter(Boolean).join(' + ');
  const formula = `${name} = (${parts}${other > 0 ? ' − otros ingresos' : ''}) ÷ ${unitsWord}${discounted ? ', antes de descuentos' : ''}${step > 0 ? ', redondeado hacia arriba' : ''}`;
  const share = m !== null
    ? ` (de cada $ 100 facturados: $ ${formatNumber(100 - m - t - tv, { decimals: 2 })} de costo${t > 0 ? `, $ ${formatNumber(t, { decimals: 2 })} de impuestos` : ''}${tv > 0 ? `, $ ${formatNumber(tv, { decimals: 2 })} de costo financiero del IVA` : ''} y $ ${formatNumber(m, { decimals: 2 })} de ganancia)`
    : '';
  const steps = [
    required ? { label: `1. Lo que tenés que facturar para cubrir ${parts}${share}`, value: required.value, format: 'moneyCeil' } : null,
    other > 0 ? { label: '2. Menos lo que ya cobrás aparte (otros ingresos)', value: other, format: 'money' } : null,
    net ? { label: `${other > 0 ? '3' : '2'}. Dividido ${units}: precio objetivo${discounted ? ' neto' : ''}`, value: net.value, format: 'moneyCeil' } : null,
    discounted ? { label: 'Antes de descuentos (neto ÷ factor de descuentos): precio objetivo de lista', value: k.targetListRate, format: 'moneyCeil' } : null,
    step > 0 ? { label: `Redondeo hacia arriba a múltiplos de ${formatMoney(step)} (nunca baja el margen)`, value: step, format: 'money' } : null,
  ].filter(Boolean);
  return createTrace({
    id: 'suggested_rate',
    title: name,
    formula,
    inputs: (base.inputs || []).filter((x) => !(x.label && x.label.startsWith('Factor de descuentos') && !discounted)),
    steps,
    result: { label: name, value: k.suggestedListRate, format: 'moneyCeil' },
    notes: [
      step > 0
        ? `Precio objetivo sin redondear: ${formatMoneyCeil(k.targetListRate)}. ${name}: ${formatMoneyCeil(k.suggestedListRate)}.`
        : 'Sin redondeo comercial: es igual al precio objetivo.',
      'Se muestra redondeado hacia arriba al peso: cobrar la cifra que ves nunca te deja debajo del objetivo.',
      ...(base.notes || []).filter((n) => !/^Tarifa sugerida: redondeada/.test(n)),
    ],
  });
}

/** Tarifa mínima hacia arriba, como la tarifa mínima (nunca se lee de menos). */
function ceilRateText(value, unitLabel) {
  const money = Math.abs(value) > 0 && Math.abs(value) < 100 ? formatMoney(Math.ceil(value * 100 - 1e-6) / 100, { decimals: 2 }) : formatMoneyCeil(value);
  return `${money} / ${unitLabel}`;
}

/**
 * Tarifa mínima sin contar adicionales (A-7, H-09): la línea visible y su explicación.
 * `floor` es floorWithoutOtherRevenue(r.ratesAtEstimate) (motor); null → sin texto.
 * Se muestra en la misma base que la tarifa mínima (de lista si la hay; si no, neta).
 * @param {{ otherRevenue: number, netRate: number, listRate: number|null } | null} floor
 * @param {string} unitLabel  "día", "válvula"…
 * @returns {{ text: string, tip: string } | null}
 */
export function floorWithoutExtrasText(floor, unitLabel = 'día') {
  if (!floor || !isFiniteNumber(floor.netRate)) return null;
  const rate = ceilRateText(isFiniteNumber(floor.listRate) ? floor.listRate : floor.netRate, unitLabel);
  return {
    text: `Sin contar adicionales: ${rate}`,
    tip: `La tarifa mínima supone que facturás ${formatMoney(floor.otherRevenue)} de adicionales por mes (adicionales, reventa, horas extra o abonos que se cobran aparte). Si no hay adicionales, cobrá al menos ${rate}.`,
  };
}

/**
 * Aclaración del abono que alcanza aun trabajando todos los días (A-12, H-18): con
 * personal, las horas extra de días fuera de la jornada no entran en esa cuenta.
 * @param {boolean} hasStaff  ¿la cotización tiene personal?
 * @param {{ overtimeWork?: boolean }} [o]  ¿hay horas extra del trabajo? (entonces sí se cuentan)
 */
export function capAllDaysNote(hasStaff, { overtimeWork = false } = {}) {
  // B1 (2026-11-18): con "Horas extra del trabajo" las horas extra ya están en la cuenta.
  return hasStaff && !overtimeWork ? ' (sin contar horas extra)' : '';
}

/**
 * Por qué hora se cobra una hora fuera de horario (V-34, V-26): cobrando por hora-hombre la
 * tarifa principal es por persona y la hora fuera de horario por toda la cuadrilla; se dice.
 * @param {object} r resultado de computeQuote
 * @returns {string} "/ hora" o "por hora de toda la cuadrilla (3 personas)"
 */
export function outOfHoursPer(r) {
  const o = (r && r.outOfHours) || {};
  const people = o.basis ? o.basis.people : 0;
  if (!o.crewHour || !(people > 0)) return '/ hora';
  return `por hora de toda la cuadrilla (${formatNumber(people, { decimals: 2 })} ${Math.abs(people - 1) < 1e-9 ? 'persona' : 'personas'})`;
}

/**
 * Filas de "Tus tarifas (sin IVA)" del Resultado (PLAN-2026-025, ampliado por V-12): todo lo que
 * el cliente va a ver en la cotización además de la tarifa principal. Sólo lee valores del motor.
 *   Horario normal · cada hora fuera de horario · fijo por estar de guardia y plus por cada llamado ·
 *   mínimo por llamado · mínimo garantizado por mes · cada adicional cargado a mano con precio.
 * Devuelve [] si no hay nada más que la tarifa principal (que ya está arriba en el Resultado).
 * @param {object} r resultado de computeQuote
 * @returns {Array<[string, string]>} [rótulo, valor]
 */
export function tariffRows(r) {
  if (!r) return [];
  const T = termsOfResult(r);
  const k = r.kpis || {};
  const rules = normalizeRules((r.ctx && r.ctx.rules) || {});
  const unitInfo = r.unitInfo || {};
  const overtime = (r.outOfHours && Array.isArray(r.outOfHours.lines) ? r.outOfHours.lines : []);
  const extras = (r.extras && Array.isArray(r.extras.lines) ? r.extras.lines : []).filter((l) => l && !l.derived && isFiniteNumber(l.price) && l.price > 0);
  const guardFee = rules.availabilityFeeMonthly > 0 && r.unit !== 'month';
  const callout = rules.calloutFeePerActivation > 0;
  const minimumCall = rules.minimumCallUnits > 0 && r.unit !== 'month' && r.unit !== 'event';
  const guarantee = rules.hasMinimumGuarantee;
  if (!overtime.length && !extras.length && !guardFee && !callout && !minimumCall && !guarantee) return [];
  // Guardia que cubre todo (V-28): no hay tarifa necesaria; "—" parecía un error (revisión UX).
  const main = isFiniteNumber(k.commercialListRate)
    ? `${k.commercialSource === 'suggested' ? formatMoneyCeil(k.commercialListRate) : formatMoney(k.commercialListRate)} / ${unitInfo.singular || r.unitLabel}`
    : coveredByOtherRevenue(r) ? 'La que acuerdes' : EMPTY;
  const count = (n, one, many) => `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? one : many}`;
  const minimumCallText = () => {
    const n = rules.minimumCallUnits;
    if (r.unit === 'hour') return count(n, 'hora', 'horas');
    if (r.unit === 'quantity') return quantityText(n, r);
    return count(n, 'día', 'días');
  };
  return [
    ['Horario normal', main],
    ...overtime.map((l) => [l.label, l.price !== null ? `${l.priceSource === 'suggested' ? formatMoneyCeil(l.price) : formatMoney(l.price)} ${outOfHoursPer(r)}${l.priceSource === 'suggested' ? ' (precio sugerido)' : ''}` : EMPTY]),
    guardFee ? [GUARD_FEE_LABEL, `${formatMoney(rules.availabilityFeeMonthly)} / mes`] : null,
    // El rótulo ya dice "por cada …": el valor va solo (revisión UX).
    callout ? [`Plus por cada ${T.one}`, formatMoney(rules.calloutFeePerActivation)] : null,
    minimumCall ? [`Mínimo ${T.per}`, `${minimumCallText()} ${T.per}`] : null,
    guarantee
      ? ['Mínimo garantizado por mes', rules.minimumGuaranteeBasis === 'units'
        ? count(rules.minimumGuaranteeUnits, unitInfo.singular || 'unidad', unitInfo.plural || 'unidades')
        : formatMoney(rules.minimumMonthlyGuarantee)]
      : null,
    ...extras.map((l) => [l.label, `${formatMoney(l.price)} por ${l.unitName}`]),
  ].filter(Boolean);
}

/**
 * Aclaración del margen cuando el mes se completa con el mínimo garantizado (V-12): parte de
 * la ganancia viene de lo que se factura sin trabajarlo. '' si el ajuste es 0.
 * @param {object} r resultado de computeQuote
 */
export function guaranteeMarginNote(r) {
  const rev = r && r.estimate && r.estimate.revenue;
  if (!rev || !isFiniteNumber(rev.guaranteeTopUp) || !(rev.guaranteeTopUp > 0.005)) return '';
  const unitInfo = r.unitInfo || {};
  const units = (n) => `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? unitInfo.singular || 'unidad' : unitInfo.plural || 'unidades'}`;
  const detail = rev.guaranteeBasis === 'units' && isFiniteNumber(rev.guaranteedUnits)
    ? `estimás ${units(rev.billableUnits)}, se facturan ${units(rev.guaranteedUnits)}`
    : `estimás ${formatMoney(rev.guarantee - rev.guaranteeTopUp)}, se facturan ${formatMoney(rev.guarantee)}`;
  return `Incluye ${formatMoney(rev.guaranteeTopUp)} del mínimo garantizado (${detail}).`;
}

/** Horas fuera de horario con horas estimadas (las únicas que suman al mes). */
function estimatedOutOfHours(r) {
  const lines = r && r.outOfHours && Array.isArray(r.outOfHours.lines) ? r.outOfHours.lines : [];
  return lines.filter((l) => l && l.quantity > 0);
}

/**
 * Aclaración del margen cuando hay horas fuera de horario estimadas (V-27): parte de la
 * ganancia del mes viene de esas horas, que pueden no ocurrir. '' si no suman ganancia.
 * @param {object} r resultado de computeQuote
 */
export function outOfHoursMarginNote(r) {
  const profit = estimatedOutOfHours(r).reduce((acc, l) => acc + (isFiniteNumber(l.profit) ? l.profit : 0), 0);
  return profit > 0.005 ? `Incluye ${formatMoney(profit)} de ganancia de las horas fuera de horario, si ocurren.` : '';
}

/**
 * Aclaración del equilibrio con horas fuera de horario estimadas (V-27): su facturación
 * se cuenta entera aunque se trabajen menos días. '' si no hay.
 * @param {object} r resultado de computeQuote
 */
export function outOfHoursBreakEvenNote(r) {
  const revenue = estimatedOutOfHours(r).reduce((acc, l) => acc + (isFiniteNumber(l.revenue) ? l.revenue : 0), 0);
  return revenue > 0.005 ? `Supone que además facturás ${formatMoney(revenue)} por mes de horas fuera de horario; si no ocurren, necesitás más días.` : '';
}

/**
 * Guardia que cubre todo (V-28): los otros ingresos del mes (guardia, adicionales) ya pagan el
 * costo y el margen objetivo, así que el motor no necesita ninguna tarifa por unidad (piso 0 y
 * sin sugerida). No aplica si ya hay una tarifa cargada o si se cotiza con tarifa conocida.
 * @param {object} r resultado de computeQuote
 */
export function coveredByOtherRevenue(r) {
  const k = (r && r.kpis) || {};
  const covered = Boolean(r && r.ratesAtEstimate && r.ratesAtEstimate.floorCoveredByOtherRevenue);
  const noRate = !(isFiniteNumber(k.commercialListRate) && k.commercialListRate > 0) && !(isFiniteNumber(k.suggestedListRate) && k.suggestedListRate > 0);
  return covered && noRate && r.pricingMode !== 'known_rate' && !k.targetMarginInvalid && k.totalCost > 0;
}

/** Texto de "la guardia ya cubre todo" (V-28), con la unidad de cobro. */
export function coveredRateText(r) {
  const unit = (r && r.unitInfo && r.unitInfo.singular) || 'unidad';
  return `La guardia y los adicionales ya cubren tu costo y tu margen: la tarifa por ${unit} puede ser la que acuerdes.`;
}

/**
 * Advertencia (V-28): la guardia y los adicionales cubren casi todo y la tarifa sugerida queda
 * por debajo de lo que cuesta una hora de los recursos. '' si no aplica (sólo cobrando por
 * hora, por día o por hora-hombre, donde la tarifa se puede leer como hora normal).
 * @param {object} r resultado de computeQuote
 */
export function rateBelowHourCostText(r) {
  const k = (r && r.kpis) || {};
  const o = (r && r.outOfHours) || {};
  const other = r && r.ratesAtEstimate ? r.ratesAtEstimate.otherRevenue : 0;
  if (k.commercialSource !== 'suggested' || !(other > 0) || !isFiniteNumber(o.rateHourPrice) || !(o.rateHourPrice > 0)) return '';
  const hourCost = resourceNormalHourCost(o.basis);
  if (!(hourCost > 0) || !(o.rateHourPrice < hourCost - 0.005)) return '';
  const unit = (r.unitInfo && r.unitInfo.singular) || 'unidad';
  return `La guardia y los adicionales ya cubren casi todo tu costo y tu margen: la tarifa por ${unit} queda por debajo de lo que te cuesta una hora de tus recursos (${formatMoney(hourCost)}). Puede ser la que acuerdes.`;
}

/** Meses de sueldo que paga el trabajo estimado: D ÷ días disponibles si D los supera; si no, 1. */
export function salaryMonthsAt(r) {
  const a = r && r.activity ? r.activity : {};
  return monthsFactor(a.activeDaysPerMonth || 0, a.availableDaysPerMonth || 0);
}

/**
 * "$ X" o, si el trabajo dura más que los días disponibles, "$ X × 1,5 = $ Y (1,5 meses de sueldo)"
 * (verificación 2026-11, N1): así la explicación cierra con el total.
 */
export function salaryMonthsText(r, fixedMonthly) {
  const f = salaryMonthsAt(r);
  const v = Number.isFinite(fixedMonthly) ? fixedMonthly : 0;
  if (!(f > 1 + 1e-9)) return formatMoney(v);
  const n = formatNumber(f, { decimals: 2 });
  return `${formatMoney(v)} × ${n} = ${formatMoney(v * f)} (${n} meses de sueldo)`;
}

/**
 * Cuenta del costo de un puesto en precio cerrado, en el trabajo (N1): sueldo con cargas
 * (con los meses de sueldo si el trabajo es largo) + lo variable por día + horas extra = total.
 * `line` es la línea del motor (fixedMonthly, variablePerActiveDay); `overtime`, lo del mes.
 * Sólo texto: los montos son los del motor.
 */
export function closedLaborCostText(r, line, { overtime = 0, share = '' } = {}) {
  const jobs = closedJobsPerMonth(r);
  if (jobs === null || !line) return '';
  // Por tiempo usado (2026-11-18) no hay "meses de sueldo": horas del trabajo × valor de la hora.
  if (line.timeBasis) return timeLaborCostText(r, line, { overtime });
  const single = Math.abs(jobs - 1) < 1e-9;
  const D = r.activity ? r.activity.activeDaysPerMonth || 0 : 0;
  const f = salaryMonthsAt(r);
  const fixed = (line.fixedMonthly || 0) * f;
  const variable = (line.variablePerActiveDay || 0) * D;
  const parts = [];
  if (line.fixedMonthly > 0) {
    parts.push(single
      ? `sueldo con cargas ${salaryMonthsText(r, line.fixedMonthly)}${share}`
      : `sueldo con cargas ${salaryMonthsText(r, line.fixedMonthly)}${share} ÷ ${formatNumber(jobs, { decimals: 2 })} trabajos = ${formatMoney(fixed / jobs)}`);
  }
  if (line.variablePerActiveDay > 0) parts.push(`${formatMoney(line.variablePerActiveDay)} por día × ${formatNumber(D / jobs, { decimals: 2 })} días del trabajo`);
  if (overtime > 0) parts.push(`${overtimeWorkLabel(r)}: ${formatMoney(overtime / jobs)}`);
  if (!parts.length) return '';
  const total = (fixed + variable + overtime) / jobs;
  const text = parts.join(' + ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${parts.length > 1 || f > 1 + 1e-9 ? ` = ${formatMoney(total)} en el trabajo` : ''}`;
}

/**
 * UX 1 (2026-11): precio cerrado de UN trabajo que dura más que los días disponibles del mes
 * (una obra de 45 días). No es un error: se pagan 1,5 meses de sueldo. Texto informativo, o
 * '' si no corresponde (otros contratos, varios trabajos por mes o un trabajo que entra en el mes).
 */
export function longClosedJobNote(r) {
  if (!isClosedPrice(r) || !r.activity) return '';
  const jobs = closedJobsPerMonth(r);
  if (jobs !== null && jobs > 1 + 1e-9) return '';
  const f = salaryMonthsAt(r);
  if (!(f > 1 + 1e-9)) return '';
  const n = formatNumber(f, { decimals: 2 });
  // Por tiempo usado (I4, 2026-11-18) no hay meses de sueldo: se cotizan las horas de esos días.
  if (r.model && r.model.timeBasis) {
    const fixedLeft = Number(r.model.fixedMonthly) > 0.005 ? ` De los gastos fijos del mes que cargaste se pagan ${n} meses.` : '';
    return `El trabajo dura ${formatDays(r.activity.activeDaysPerMonth, { decimals: 1 })}: se cotizan las horas de tu gente y tus equipos en esos días.${fixedLeft}`;
  }
  return `El trabajo dura ${n} meses (${formatDays(r.activity.activeDaysPerMonth, { decimals: 1 })}; el mes tiene ${formatNumber(r.activity.availableDaysPerMonth)} días disponibles): se pagan ${n} meses de sueldo y de gastos fijos. Está bien así, no es un error.`;
}

// ------------------------------------------------- por tiempo usado (2026-11-18)

/** Campo de las horas facturables de un puesto (M7): igual en Recursos, en la cotización y en el aviso. */
export const BILLABLE_HOURS_LABEL = 'Horas que le cobrás a clientes por mes (opcional)';
export const BILLABLE_HOURS_HINT = 'Las horas que de verdad trabaja para clientes en un mes. Ejemplo: de 176 h normales, 140. Con esto se calcula la hora para cotizar trabajos: las horas sin cliente (esperas, taller, días flojos) quedan cubiertas en cada hora. Vacío = las horas normales. Si son más que las normales, esas horas son extra: no las cargues acá.';
/** Aviso (M7): cargaron más horas facturables que las normales. */
export const BILLABLE_OVER_NORMAL_NOTE = 'Cargaste más horas que las normales: la hora para cotizar queda más barata que la normal. Las horas de más son horas extra.';

/** "8" / "4,5" (hasta 2 decimales). */
function n2(v) {
  const x = Number.isFinite(v) ? v : 0;
  return formatNumber(x, { decimals: Math.abs(x - Math.round(x)) < EPS ? 0 : 2 });
}

/** "1 persona" / "3 personas". */
function peopleText(n) {
  return `${n2(n)} ${Math.abs(n - 1) < EPS ? 'persona' : 'personas'}`;
}

/** "3 días" / "1 día". */
function daysCountText(n) {
  return `${n2(n)} ${Math.abs(n - 1) < EPS ? 'día' : 'días'}`;
}

/**
 * ¿La cotización costea su gente y sus equipos propios por tiempo usado y no le queda ningún costo
 * fijo del mes? Entonces no hay "días para no perder" ni "costos fijos del mes" que contar.
 */
export function timeBasisWithoutFixed(r) {
  const m = r && r.model;
  return Boolean(m && m.timeBasis) && !(Number(m.fixedMonthly) > 0.005);
}

/**
 * Costo de un puesto por tiempo usado (2026-11-18), en palabras y con los montos del motor:
 *   "1 persona × 8 h por día × 3 días × $ 11.364 la hora"
 * más lo demás de cada día (vianda, horas extra por día), las horas extra del trabajo y lo fijo
 * del mes que quede (horas extra por mes cargadas antes). Precio cerrado → "en el trabajo"; si no,
 * "en el mes"; sin días todavía, "por día de trabajo". Sirve para una línea del motor
 * (`line.time`) o para el total del personal (`timePerActiveDay`). '' si no es por tiempo usado.
 */
export function timeLaborCostText(r, line, { overtime = 0 } = {}) {
  if (!r || !line || !line.timeBasis) return '';
  const jobs = closedJobsPerMonth(r);
  const D = r.activity ? r.activity.activeDaysPerMonth || 0 : 0;
  const div = jobs !== null ? jobs : 1;
  const t = line.time || null;
  const timePerDay = t ? t.perActiveDay || 0 : line.timePerActiveDay || 0;
  const otherPerDay = Math.max(0, (line.variablePerActiveDay || 0) - timePerDay);
  const otherLabel = line.perPosition ? (line.perPosition.overtimePerActiveDay > 0 ? 'horas extra y vianda' : 'vianda') : 'vianda y otros gastos';
  const hoursPart = t ? `${peopleText(line.positions || 0)} × ${n2(t.hoursPerDay)} h por día` : 'horas de tu gente';
  if (!(D > 0)) {
    // Sin días todavía: lo de cada día de trabajo.
    const parts = [];
    if (timePerDay > 0.005) parts.push(t ? `${hoursPart} × ${formatMoney(t.hourlyCost)} la hora` : `${hoursPart} ${formatMoney(timePerDay)}`);
    if (otherPerDay > 0.005) parts.push(`${otherLabel} ${formatMoney(otherPerDay)}`);
    if (!parts.length) return '';
    const text = parts.join(' + ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} = ${formatMoney(timePerDay + otherPerDay)} por día de trabajo`;
  }
  const days = D / div;
  const f = salaryMonthsAt(r);
  const fixed = (line.fixedMonthly || 0) * f;
  const parts = [];
  if (timePerDay > 0.005) {
    parts.push(t
      ? `${hoursPart} × ${daysCountText(days)} × ${formatMoney(t.hourlyCost)} la hora`
      : `${hoursPart} ${formatMoney(timePerDay)} por día × ${daysCountText(days)}`);
  }
  if (otherPerDay > 0.005) parts.push(`${otherLabel} ${formatMoney(otherPerDay)} por día × ${daysCountText(days)}`);
  if (fixed > 0.005) parts.push(`horas extra por mes (cargadas antes) ${formatMoney(fixed / div)}`);
  if (overtime > 0.005) parts.push(`${overtimeWorkLabel(r)}: ${formatMoney(overtime / div)}`);
  if (!parts.length) return '';
  const total = ((timePerDay + otherPerDay) * D + fixed + (overtime > 0.005 ? overtime : 0)) / div;
  const text = parts.join(' + ');
  const where = jobs !== null ? 'en el trabajo' : 'en el mes';
  // Una sola parte en precio cerrado: el total ya está en el valor de al lado (como closedLaborCostText).
  const showTotal = parts.length > 1 || jobs === null;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${showTotal ? ` = ${formatMoney(total)} ${where}` : ''}`;
}

/**
 * "Hora normal" de un puesto en Personal (2026-11-18). Por tiempo usado, la hora con la que se
 * cotiza (costo del mes ÷ horas que vende, o ÷ las normales); si no, la de siempre.
 * @param {object} line línea del motor (r.model.labor.lines[i])
 * @param {number} normalHours horas normales por mes cargadas en la línea
 * @returns {{ value: number|null, hint: string }}
 */
export function laborHourStat(line, normalHours) {
  const p = line && line.perPerson ? line.perPerson : null;
  const normal = `Costo por mes ÷ ${formatNumber(Number.isFinite(normalHours) ? normalHours : 0, { decimals: 2 })} horas normales por mes.`;
  if (!p) return { value: null, hint: normal };
  if (!line.timeBasis) return { value: p.loadedHourlyCost, hint: normal };
  const own = Boolean(p.ownBillableHours);
  return {
    value: p.billableHourlyCost,
    hint: own ? `Costo por mes ÷ ${formatNumber(p.billableHoursPerMonth, { decimals: 2 })} horas que le cobrás a clientes por mes.` : normal,
  };
}

/**
 * Tenerlo y usarlo, de un equipo propio por tiempo usado (2026-11-18):
 *   "Tenerlo: $ 95.000 por día de trabajo (8 h × $ 11.875 la hora) · usarlo: $ 40.000 por día de trabajo"
 * '' si la línea no es por tiempo usado. Sólo texto: los montos son los del motor.
 */
/**
 * Valor hora COMPLETO de un equipo propio por tiempo usado (0.19.0): tenerlo + usarlo, por hora y
 * por unidad, cuando todas sus horas asignadas llevan el motor andando (lo normal). null si las
 * horas andando son otras (ahí la cuenta se muestra en dos partes). Sale de los montos del motor.
 */
export function equipmentFullHourRate(line) {
  if (!line || !line.timeBasis || !line.time) return null;
  const h = line.time.hoursPerDay;
  const q = line.quantity > 0 ? line.quantity : 0;
  // Un solo valor hora: todas las horas con el motor andando, o ninguna (vehículo: sólo tenerlo).
  const run = line.hoursPerActiveDay || 0;
  if (!(h > 0) || !(q > 0) || (Math.abs(run - h) > 1e-6 && run > 1e-6)) return null;
  return ((line.ownershipPerActiveDay || 0) + (line.variablePerActiveDay || 0)) / (h * q);
}

export function timeEquipmentUseText(line) {
  if (!line || !line.timeBasis || !line.time) return '';
  const t = line.time;
  const units = line.quantity > 0 && Math.abs(line.quantity - 1) > EPS ? ` × ${n2(line.quantity)} unidades` : '';
  const full = equipmentFullHourRate(line);
  if (full !== null) return `${n2(t.hoursPerDay)} h asignado × ${formatMoney(full)} la hora${units} = ${formatMoney((line.ownershipPerActiveDay || 0) + (line.variablePerActiveDay || 0))} por día de trabajo`;
  return `Asignado: ${formatMoney(line.ownershipPerActiveDay)} por día de trabajo (${n2(t.hoursPerDay)} h × ${formatMoney(t.hourlyCost)} la hora${units}) · motor andando: ${formatMoney(line.variablePerActiveDay)} por día de trabajo`;
}

/** "horas que lo usás o alquilás por mes" / "horas por mes (si trabaja todo el mes a este ritmo)". */
function equipmentHoursNoun(t) {
  return t && t.ownBillableHours ? 'horas que lo usás o alquilás por mes' : 'horas por mes (si trabaja todo el mes a este ritmo)';
}

/** "Tenerlo en el mes $ 2.090.000 ÷ 220 horas por mes (…) × 8 h del día de trabajo" (o ''). */
export function timeEquipmentOwnershipHint(line) {
  if (!line || !line.timeBasis || !line.time || !line.ownership) return '';
  const t = line.time;
  const units = line.quantity > 0 && Math.abs(line.quantity - 1) > EPS ? ` × ${n2(line.quantity)} unidades` : '';
  return `Tenerlo en el mes ${formatMoney(line.ownership.totalMonthly)} ÷ ${n2(t.billableHoursPerMonth)} ${equipmentHoursNoun(t)} × ${n2(t.hoursPerDay)} h ${t.ownHours ? 'asignado por día' : 'del día de trabajo'}${units}.`;
}

/** "Tenerlo en el mes $ 2.090.000 ÷ 220 horas por mes (…), por unidad." (o ''): la hora de tenerlo (I7). */
export function timeEquipmentHourHint(line) {
  if (!line || !line.timeBasis || !line.time || !line.ownership) return '';
  const t = line.time;
  const unit = line.quantity > 0 && Math.abs(line.quantity - 1) > EPS ? ', por unidad' : '';
  return `Tenerlo en el mes ${formatMoney(line.ownership.totalMonthly)} ÷ ${n2(t.billableHoursPerMonth)} ${equipmentHoursNoun(t)}${unit}.`;
}

/**
 * Equipo propio por tiempo usado en precio cerrado (M1, 2026-11-18), con los montos del motor:
 *   "Tenerlo: 8 h × 3 días × $ 2.367 la hora = $ 56.818 · uso efectivo (combustible y mantenimiento): $ 360.000 · en el trabajo"
 * '' si no es por tiempo usado, no es precio cerrado o todavía no hay días.
 */
export function timeEquipmentJobText(r, line) {
  if (!r || !line || !line.timeBasis || !line.time) return '';
  const jobs = closedJobsPerMonth(r);
  const D = r.activity ? r.activity.activeDaysPerMonth || 0 : 0;
  if (jobs === null || !(jobs > 0) || !(D > 0)) return '';
  const days = D / jobs;
  const t = line.time;
  const units = line.quantity > 0 && Math.abs(line.quantity - 1) > EPS ? `${n2(line.quantity)} unidades × ` : '';
  const full = equipmentFullHourRate(line);
  if (full !== null) return `${units}${n2(t.hoursPerDay)} h × ${daysCountText(days)} × ${formatMoney(full)} la hora = ${formatMoney(((line.ownershipPerActiveDay || 0) + (line.variablePerActiveDay || 0)) * days)} en el trabajo`;
  return `Asignado: ${units}${n2(t.hoursPerDay)} h × ${daysCountText(days)} × ${formatMoney(t.hourlyCost)} la hora = ${formatMoney((line.ownershipPerActiveDay || 0) * days)} · motor andando (combustible y mantenimiento): ${formatMoney((line.variablePerActiveDay || 0) * days)} · en el trabajo`;
}

/**
 * Total de Equipos por tiempo usado (M3): "$ 416.818 en el trabajo: tenerlos $ 56.818 + usarlos $ 360.000."
 * o, sin precio cerrado, "$ X por día de trabajo: tenerlos $ A + usarlos $ B." `total` es el valor
 * que ya muestra la pantalla en el trabajo (con lo que sumen los externos); '' si no corresponde.
 */
export function timeEquipmentTotalText(r, total = null) {
  const m = r && r.model;
  if (!m || !m.timeBasis || !Array.isArray(m.equipment)) return '';
  if (m.equipment.reduce((acc, e) => acc + (e.fixedMonthly || 0), 0) > 0.005) return '';
  const own = m.equipment.reduce((acc, e) => acc + (e.timeBasis ? e.ownershipPerActiveDay || 0 : 0), 0);
  const use = m.equipment.reduce((acc, e) => acc + (e.variablePerActiveDay || 0), 0);
  const jobs = closedJobsPerMonth(r);
  const D = r.activity ? r.activity.activeDaysPerMonth || 0 : 0;
  if (jobs !== null && jobs > 0 && D > 0) {
    const job = Number.isFinite(total) ? total : ((own + use) * D) / jobs;
    return `${formatMoney(job)} en el trabajo: las horas asignadas de cada equipo × su valor hora.`;
  }
  return `${formatMoney(own + use)} por día de trabajo: las horas asignadas de cada equipo × su valor hora.`;
}

/**
 * "Personal: 1 persona × 24 h × $ 12.446 la hora" (I8, 2026-11-18): cada puesto por tiempo usado con
 * sus horas en el trabajo (precio cerrado) o por día ("× 8 h por día"). Sólo multiplica las horas que
 * ya muestra la pantalla; el valor de la hora es el del motor. '' si la línea no es por tiempo usado.
 */
export function timeStaffHoursText(r, line) {
  if (!r || !line || !line.timeBasis || !line.time) return '';
  return `${peopleText(line.positions || 0)} × ${jobHoursText(r, line.time.hoursPerDay)} × ${formatMoney(line.time.hourlyCost)} la hora`;
}

/** "Generador: 24 h × $ 2.367 la hora" (I8): un equipo propio por tiempo usado ('' si no). */
export function timeEquipmentHoursText(r, line) {
  if (!r || !line || !line.timeBasis || !line.time) return '';
  const units = line.quantity > 0 && Math.abs(line.quantity - 1) > EPS ? `${n2(line.quantity)} unidades × ` : '';
  const full = equipmentFullHourRate(line);
  return `${line.name || 'Equipo'}: ${units}${jobHoursText(r, line.time.hoursPerDay)} × ${formatMoney(full !== null ? full : line.time.hourlyCost)} la hora`;
}

/** "24 h" (horas del trabajo, precio cerrado) o "8 h por día". */
function jobHoursText(r, hoursPerDay) {
  const jobs = closedJobsPerMonth(r);
  const D = r.activity ? r.activity.activeDaysPerMonth || 0 : 0;
  if (jobs !== null && jobs > 0 && D > 0) return `${n2((hoursPerDay || 0) * (D / jobs))} h`;
  return `${n2(hoursPerDay || 0)} h por día`;
}

/** Lo de cada día de trabajo de un equipo: operación y, por tiempo usado, también tenerlo. */
export function equipmentPerActiveDay(line) {
  if (!line) return 0;
  return (line.variablePerActiveDay || 0) + (line.timeBasis ? line.ownershipPerActiveDay || 0 : 0);
}

/**
 * Margen que se muestra junto a la ganancia (revisión de la 0.24.0, B-2 de costos y C4 de UX).
 * El que pediste sólo si la diferencia con el real es del redondeo: precio sugerido, real ≥ pedido,
 * menos de 1 punto de diferencia y sin el completo del mínimo garantizado. Si no, el real del motor.
 * Lo usan el Resultado y "El precio".
 */
export function shownMarginPct(k, { covered = false, losing = null, marginPct = null, guaranteeTopUp = 0 } = {}) {
  const real = isFiniteNumber(marginPct) ? marginPct : k.marginPct;
  const lose = losing === null ? isFiniteNumber(k.profit) && k.profit < -1e-6 : losing;
  const asked = k.commercialSource === 'suggested' && !covered && !lose && isFiniteNumber(k.targetMarginPct) && !k.targetMarginInvalid
    && isFiniteNumber(real) && real >= k.targetMarginPct - 1e-9 && real - k.targetMarginPct < 1
    && !(Number(guaranteeTopUp) > 0.005);
  return asked ? k.targetMarginPct : real;
}
