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
import { normalizeRules } from '../engines/commercial-rules-engine.js';
import { DEMO_IDS } from '../domain/demo-data.js';
import { isQuantityUnit, quantityCeilText } from './unit-text.js';
import { unitTexts } from '../domain/billing-units.js';
import { activationTerms } from '../domain/activation-terms.js';
import { unreliablePending } from '../domain/quote-risk.js';
import { DEFAULT_ROUNDING_MAX_PCT } from '../domain/rounding.js';

const EPS = 1e-9;

// ----------------------------------------------------------------- días

/** Decimales de un resultado en días en superficie: 1; 2 debajo de 1 día. */
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

/** "6,4 días activos" / "1 día activo". */
export function activeDaysText(value, decimals = 1) {
  if (!isFiniteNumber(value)) return EMPTY;
  const text = formatDays(shownDays(value, decimals), { decimals });
  return `${text} ${/\bdía$/.test(text) ? 'activo' : 'activos'}`;
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

/**
 * Cuánto sobra o falta sobre el mínimo para no perder, en cualquier unidad (horas, horas-hombre, m³, días…),
 * con los valores que SE MUESTRAN: el mínimo redondeado hacia arriba y lo estimado, así la resta cierra con lo
 * que se lee ("Estimás 880 horas-hombre: te sobran 153 horas-hombre."). Si al redondear el signo no coincide
 * con el real (o da 0), dice "justo en el mínimo" o "apenas debajo". '' si falta un dato.
 * @param {{ est: number, min: number, estShown: number, minShown: number, decimals?: number, fmt: (value: number, decimals: number) => string }} p
 */
export function spareText({ est, min, estShown, minShown, decimals = 2, fmt } = {}) {
  if (![est, min, estShown, minShown].every(isFiniteNumber) || typeof fmt !== 'function') return '';
  const real = est - min;
  const gap = roundTo(estShown - minShown, decimals);
  const head = `Estimás ${fmt(estShown, decimals)}`;
  if (Math.abs(gap) < EPS || (real >= -EPS) !== (gap > 0)) {
    return real >= -EPS ? `${head}: estás justo en el mínimo.` : `${head}: estás apenas debajo del mínimo.`;
  }
  return real >= -EPS ? `${head}: te sobran ${fmt(gap, decimals)}.` : `${head}: te faltan ${fmt(-gap, decimals)}.`;
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

// ------------------------------------------- redondeo de la sugerida (ECO-03)

/**
 * Cómo se redondeó la tarifa sugerida, para el medio de una frase:
 * "redondeada hacia arriba a múltiplos de $ 10 (automático: hasta 1 % sobre el
 * precio objetivo)", "redondeada hacia arriba a múltiplos de $ 1.000" o "sin redondeo".
 * @param {object} kpis  computeQuote().kpis
 */
export function roundingText(kpis) {
  const k = kpis || {};
  const step = isFiniteNumber(k.roundingStep) && k.roundingStep > 0 ? k.roundingStep : 0;
  if (k.roundingMode === 'auto') {
    const maxPct = isFiniteNumber(k.roundingMaxPct) ? k.roundingMaxPct : DEFAULT_ROUNDING_MAX_PCT;
    const limit = formatPercent(maxPct);
    if (step) return `redondeada hacia arriba a múltiplos de ${formatMoney(step)} (automático: hasta ${limit} sobre el precio objetivo)`;
    return maxPct > 0 ? `sin redondeo (automático: el ${limit} de esta tarifa no llega a $ 1)` : 'sin redondeo (automático con tope 0 %)';
  }
  return step ? `redondeada hacia arriba a múltiplos de ${formatMoney(step)}` : 'sin redondeo';
}

/**
 * Margen objetivo y margen real con una tarifa: "Objetivo: 10 % de margen · con
 * esta tarifa: 10,06 %" (por defecto, el real con la tarifa sugerida). null si
 * falta alguno de los dos.
 */
export function marginPairText(kpis, { realPct } = {}) {
  const k = kpis || {};
  const real = realPct === undefined ? k.suggestedMarginPct : realPct;
  if (!isFiniteNumber(k.targetMarginPct) || !isFiniteNumber(real)) return null;
  return `Objetivo: ${formatPercent(k.targetMarginPct)} de margen · con esta tarifa: ${formatPercent(real)}`;
}

/**
 * Aviso de un múltiplo fijo que sube la tarifa sugerida más de ROUNDING_WARN_PCT
 * (1 %) sobre el precio objetivo (ECO-03, VAL-01-F1); null si no hace falta. El
 * automático nunca lo dispara.
 * @param {object} kpis  computeQuote().kpis
 * @param {string} [unitShort]  "ton-km", "día"…
 */
export function roundingWarning(kpis, unitShort = '') {
  const k = kpis || {};
  if (k.roundingExceedsLimit !== true) return null;
  const per = unitShort ? ` / ${unitShort}` : '';
  const margin = isFiniteNumber(k.targetMarginPct) && isFiniteNumber(k.suggestedMarginPct)
    ? `: el margen pasa de ${formatPercent(k.targetMarginPct)} a ${formatPercent(k.suggestedMarginPct)}`
    : '';
  return {
    title: `La tarifa sugerida quedó ${formatPercent(k.suggestedRoundUpPct, { decimals: 1 })} arriba de tu precio objetivo por el redondeo`,
    message: `Tu precio objetivo es ${formatMoneyCeil(k.targetListRate)}${per}, pero el múltiplo fijo de ${formatMoney(k.roundingStep)} la lleva a ${formatMoney(k.suggestedListRate)}${per}${margin}. El redondeo automático la deja a lo sumo ${formatPercent(DEFAULT_ROUNDING_MAX_PCT)} arriba.`,
  };
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
 * plata antes del break-even): el último cuyo primer día (en días activos,
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
    return { tone: 'red', count: red, text, title: `${text}: con ese descuento la tarifa neta queda debajo de la tarifa piso` };
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
 * (ingresos fijos), cargos por llamado / movilización / km (por día activo),
 * mínimo mensual garantizado o un mínimo por llamado que de verdad se aplica.
 */
function hasOtherCharges(result) {
  const l = result.linear || {};
  if ((isFiniteNumber(l.fixedRevenue) && l.fixedRevenue > 1e-6) || (isFiniteNumber(l.otherRevenuePerActiveDay) && l.otherRevenuePerActiveDay > 1e-6)) return true;
  const estimate = (result.estimate && result.estimate.revenue) || {};
  if (estimate.minimumCallApplied) return true;
  try {
    return normalizeRules((result.ctx && result.ctx.rules) || {}).minimumMonthlyGuarantee > 0;
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
export function draftBannerText({ critical = 0, review = 0, unreliable = 0 } = {}) {
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
      title: 'RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA.',
      text: `${u === 1 ? 'Un dato hace' : `${u} datos hacen`} que el costo, la facturación o el margen de abajo no sean reales: resolvelo antes de cotizar. ${counts}`,
    };
  }
  return {
    tone: c > 0 ? 'danger' : 'warning',
    title: `BORRADOR — revisar ${total} ${total === 1 ? 'punto' : 'puntos'} antes de usar esta tarifa.`,
    text: counts,
  };
}

/** Pendientes que vuelven NO CONFIABLE el resultado (ECO-01): `unreliable` del motor de completitud (única definición en js/domain/quote-risk.js). */
export function unreliableItems(completeness) {
  return unreliablePending(completeness);
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
  // V-7 (VALIDACIONES-01): cada activación dura más que el mes (obra de varios meses): no sugerir la opción,
  // que contaría dos veces los costos de la obra.
  if (r.longerThanMonth) {
    return { tone: 'warning', text: `${head(r.estimated)}: cada ${T.one} dura más que el mes y se muestra la parte de un mes. No marques esta opción: contaría dos veces los costos ${T.per}.` };
  }
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
  return byQuantity
    ? `Cubrís todos tus costos aunque no factures ${t.ningun} ${singular}${rate}: los ingresos fijos (abono, equipo en espera) ya cubren los costos fijos.`
    : `Cubrís todos tus costos aunque no trabajes ningún día${rate}: los ingresos fijos (abono, equipo en espera) ya cubren los costos fijos.`;
}
