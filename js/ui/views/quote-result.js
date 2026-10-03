/**
 * Paso "Resultado" de la cotización — análisis económico.
 *
 * Contrato (lo invoca el editor, js/ui/views/quote-editor.js):
 *   renderQuoteResult(container, app, { quote, result, settings, onQuoteChange })
 *     quote          cotización actual (copia)
 *     result         computeQuote(quote, { settings })
 *     settings       configuración de la organización
 *     onQuoteChange  (path, value) → el editor aplica el cambio, guarda y redibuja
 *   Devuelve una función de limpieza (timers de los sliders, observer del
 *   gráfico y listeners de impresión).
 *
 * Bloques, en orden:
 *   A. Decisión (según modalidad) + KPIs + equivalencias + alertas
 *   B. Estructura de costos (EECC)
 *   C. Matriz tarifa × utilización + gráfico
 *   D. Margen vs markup
 *   E. Descuentos por días / volumen + continuidad
 *   F. Sensibilidad (sliders, tarifa comercial fija)
 *   G. Escenarios pesimista / base / optimista
 *   H. Comparador de modelos comerciales
 *   I. Cost Completeness Score
 *   J. Acciones (imprimir, marcar como enviada)
 *
 * Reglas: sin HTML crudo (sólo h()/s()), sin storage, todo número pasa por
 * js/core/format.js (nunca NaN / Infinity) y todo resultado importante tiene
 * "Ver cálculo" (con nombre accesible "Ver cálculo: <título>").
 *
 * Tarifas: piso y precio objetivo se muestran en la base que se escribe en la
 * cotización (DE LISTA), con la neta como dato secundario; las tarifas mínimas
 * (piso, objetivo, sugerido, necesarias) se redondean hacia arriba al mostrar.
 */

import { h, s, mount, debounce, uniqueId } from '../dom.js';
import {
  button,
  badge,
  statusDot,
  card,
  kpi,
  banner,
  emptyState,
  progressBar,
  table,
  traceButton,
  openTraceDialog,
  toast as componentToast,
  barList,
} from '../components.js';
import { formatMoney, formatMoneyCeil, formatPercent, formatDays, formatNumber, formatDate, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { createTrace } from '../../core/trace.js';
import { track } from '../../core/events.js';
import { logger } from '../../core/logger.js';
import { FEATURES, SENSITIVITY_RANGES, DEFAULT_SCENARIOS, DEFAULT_MARGIN_LADDER } from '../../config.js';
import { QUOTE_STEPS, QUOTE_STATUSES, PRICING_MODES, labelOf } from '../../domain/catalogs.js';
import { illustrativeInfo } from '../../domain/quote-factory.js';
import { computeQuote } from '../../engines/quote-engine.js';
import { requiredRatesAt, evaluateAt } from '../../engines/economics-engine.js';
import { findBreakEvenDays } from '../../engines/break-even-engine.js';
import { completenessTone } from '../../engines/completeness-engine.js';
import { priceLadder, marginToMarkup, traceMarginVsMarkup, isValidMarginPct } from '../../engines/pricing-engine.js';
import { runSensitivity, sensitivityTable, runScenarios, compareCommercialModels, SENSITIVITY_VARIABLES } from '../../engines/scenario-engine.js';

// ------------------------------------------------------------------ constantes

/** Debounce del recálculo de sensibilidad al mover un slider (ms). */
export const SENSITIVITY_DEBOUNCE_MS = 120;
/** Debounce del evento interno scenario_changed (ms). */
const TRACK_DEBOUNCE_MS = 700;
/** Debounce del redibujo del gráfico al cambiar el ancho del contenedor (ms). */
const CHART_RESIZE_DEBOUNCE_MS = 150;
/** Diferencia mínima ($) para mostrar la tarifa neta junto a la de lista. */
const LIST_NET_TOLERANCE = 0.005;

const ZERO_DELTAS = Object.freeze({
  salariesPct: 0,
  fuelPct: 0,
  materialsPct: 0,
  activityPct: 0,
  paymentTermDays: 0,
  commercialDiscountPct: 0,
});

/** Textos de ayuda de cada slider (lenguaje simple). */
const SLIDER_HINTS = Object.freeze({
  salariesPct: 'Aumento o baja de sueldos básicos y adicionales.',
  fuelPct: 'Variación del precio del combustible por litro.',
  materialsPct: 'Variación del costo de los materiales.',
  activityPct: '¿Y si el equipo trabaja y factura más o menos días en el mes?',
  paymentTermDays: 'Días adicionales (o menos) que tarda el cliente en pagar.',
  commercialDiscountPct: 'Puntos de descuento adicionales sobre la tarifa de lista.',
});

/** Nombre del evento (enum en minúsculas, ver core/events.js). */
const TRACK_VARIABLE = Object.freeze({
  salariesPct: 'salaries_pct',
  fuelPct: 'fuel_pct',
  materialsPct: 'materials_pct',
  activityPct: 'activity_pct',
  paymentTermDays: 'payment_term_days',
  commercialDiscountPct: 'commercial_discount_pct',
});

const DISCOUNT_STATUS = Object.freeze({
  green: { tone: 'green', text: 'Mantiene el margen objetivo', short: 'Mantiene el margen' },
  orange: { tone: 'orange', text: 'Debajo del margen objetivo', short: 'Bajo el objetivo' },
  red: { tone: 'red', text: 'Debajo de break-even: perdés dinero', short: 'Pierde dinero' },
  unknown: { tone: 'gray', text: 'Sin datos suficientes', short: 'Sin datos' },
});

const RISK_BADGE = Object.freeze({
  low: { tone: 'green', text: 'Riesgo bajo', short: 'Bajo' },
  medium: { tone: 'orange', text: 'Riesgo medio', short: 'Medio' },
  high: { tone: 'red', text: 'Riesgo alto', short: 'Alto' },
});

const COMMERCIAL_SOURCE_TEXT = Object.freeze({
  known_rate: 'Tarifa que te pidieron cotizar',
  suggested: 'Precio comercial sugerido (precio objetivo redondeado)',
  offered: 'Tarifa ofrecida (cargada a mano)',
  override: 'Tarifa fija del escenario',
  none: 'Sin tarifa definida',
});

/**
 * Estado de los sliders por cotización (sólo memoria de la pestaña; se
 * conserva al redibujar la vista, por ejemplo al marcarla como enviada).
 */
const sliderMemory = new Map();
const SLIDER_MEMORY_LIMIT = 30;

// ------------------------------------------------------------- formateo seguro

const hasValue = (v) => isFiniteNumber(v);
const money = (v) => formatMoney(v);
const pct = (v, decimals = 2) => formatPercent(v, { decimals });

/** Tarifa por unidad: "$ 4.000.000 / día". */
function rate(value, unitLabel) {
  if (!hasValue(value)) return EMPTY;
  const decimals = Math.abs(value) > 0 && Math.abs(value) < 100 ? 2 : 0;
  return `${formatMoney(value, { decimals })} / ${unitLabel}`;
}

/** Tarifa con la unidad como sufijo chico (para KPIs y tarjetas destacadas). */
function rateNode(value, unitLabel) {
  if (!hasValue(value)) return EMPTY;
  const decimals = Math.abs(value) > 0 && Math.abs(value) < 100 ? 2 : 0;
  return h('span', { class: 'qr-rate' }, formatMoney(value, { decimals }), h('span', { class: 'qr-unit' }, ` / ${unitLabel}`));
}

/**
 * Tarifa MÍNIMA (piso, objetivo, sugerida, necesarias por margen): siempre
 * redondeada hacia arriba, para que cobrar la cifra que se ve nunca deje
 * debajo del piso ni del objetivo (4.444.444,44 → $ 4.444.445).
 */
function ceilMoney(value) {
  if (!hasValue(value)) return EMPTY;
  if (Math.abs(value) > 0 && Math.abs(value) < 100) return formatMoney(Math.ceil(value * 100 - 1e-6) / 100, { decimals: 2 });
  return formatMoneyCeil(value);
}

function minRate(value, unitLabel) {
  return hasValue(value) ? `${ceilMoney(value)} / ${unitLabel}` : EMPTY;
}

function minRateNode(value, unitLabel) {
  if (!hasValue(value)) return EMPTY;
  return h('span', { class: 'qr-rate' }, ceilMoney(value), h('span', { class: 'qr-unit' }, ` / ${unitLabel}`));
}

/** Tarifa comercial: si es la sugerida (mínima), se muestra hacia arriba. */
function commercialRate(k, unitLabel) {
  return k.commercialSource === 'suggested' ? minRate(k.commercialListRate, unitLabel) : rate(k.commercialListRate, unitLabel);
}

function commercialRateNode(k, unitLabel) {
  return k.commercialSource === 'suggested' ? minRateNode(k.commercialListRate, unitLabel) : rateNode(k.commercialListRate, unitLabel);
}

/** ¿La tarifa neta difiere de la de lista (hay descuentos)? */
function listDiffers(listValue, netValue) {
  return hasValue(listValue) && hasValue(netValue) && Math.abs(listValue - netValue) > LIST_NET_TOLERANCE;
}

/** "Margen 10 % · markup 11,11 %" sólo si el margen existe (sin "—" sueltos). */
function marginHint(marginPct, markupPct) {
  if (!hasValue(marginPct)) return 'Sin facturación: no hay margen.';
  return `Margen ${pct(marginPct)}${hasValue(markupPct) ? ` · markup ${pct(markupPct)}` : ''}`;
}

function wholeDays(value) {
  return formatDays(value, { decimals: 0 });
}

function clean(value) {
  return hasValue(value) && Math.abs(value) < 1e-9 ? 0 : value;
}

/** Antepone "+" a los valores positivos. */
function signed(value, formatter) {
  if (!hasValue(value)) return EMPTY;
  const v = clean(value);
  const text = formatter(v);
  return v > 0 ? `+${text}` : text;
}

const signedMoney = (v) => signed(v, (x) => formatMoney(x));
const signedPoints = (v) => signed(v, (x) => `${formatNumber(x, { decimals: 2 })} puntos`);
const signedDays = (v) => signed(v, (x) => formatDays(x));

/** "$ 2,5 M" — sólo para ejes de gráficos. */
function compactMoney(value) {
  if (!hasValue(value)) return EMPTY;
  const a = Math.abs(value);
  if (a >= 1e9) return `$ ${formatNumber(value / 1e9, { decimals: 2 })} mil M`;
  if (a >= 1e6) return `$ ${formatNumber(value / 1e6, { decimals: 2 })} M`;
  if (a >= 1e3) return `$ ${formatNumber(value / 1e3, { decimals: 1 })} mil`;
  return formatMoney(value);
}

/** Valor de un slider: "+10 %", "-30 días", "+5 puntos". */
function sliderText(meta, value) {
  const v = hasValue(value) ? value : 0;
  const unit = meta.unit;
  const text = `${formatNumber(Math.abs(v), { decimals: 2 })} ${unit}`;
  if (v === 0) return `0 ${unit}`;
  return v > 0 ? `+${text}` : `-${text}`;
}

// ---------------------------------------------------------------- utilidades

function profitTone(k) {
  if (!hasRate(k)) return null;
  if (hasValue(k.profit) && k.profit < -1e-6) return 'red';
  if (k.belowTarget) return 'orange';
  return 'green';
}

/** Color del margen: sin margen calculable (null) no hay semáforo. */
function marginTone(k) {
  return hasValue(k.marginPct) ? profitTone(k) : null;
}

function hasRate(k) {
  return hasValue(k.commercialListRate) && k.commercialListRate > 0;
}

function sameNumber(a, b) {
  if (!hasValue(a) || !hasValue(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-9);
}

/**
 * Paso del editor donde se corrige un ítem de completitud. La actividad
 * estimada se carga en "Modalidad" (igual criterio que el editor).
 */
function stepForItem(item) {
  if (!item) return 'service';
  if (item.id === 'utilization' || item.id === 'rate') return 'modality';
  return QUOTE_STEPS.some((st) => st.id === item.step) ? item.step : 'service';
}

function stepHref(quote, step) {
  const id = quote && quote.id ? encodeURIComponent(String(quote.id)) : '';
  return `#/cotizaciones/${id}/${step}`;
}

function stepLabel(step) {
  const found = QUOTE_STEPS.find((st) => st.id === step);
  return found ? found.label : 'Paso';
}

function stepLink(quote, step, text = null) {
  return h('a', { class: 'qr-step-link', href: stepHref(quote, step) }, text || `Ir a ${stepLabel(step)}`);
}

/** Nombre accesible de un botón "Ver cálculo": "Ver cálculo: <título>". */
function traceName(title) {
  return title ? `Ver cálculo: ${title}` : 'Ver cálculo';
}

/** "Ver cálculo" con nombre accesible que dice QUÉ cálculo abre. */
function traceBtn(trace, opts = {}) {
  const btn = traceButton(trace, opts);
  btn.setAttribute('aria-label', traceName(trace && trace.title));
  return btn;
}

/** KPI cuyo botón "Ver cálculo" anuncia el título de la traza. */
function kpiItem(opts) {
  const node = kpi(opts);
  const btn = opts.trace ? node.querySelector('.trace-btn') : null;
  if (btn) btn.setAttribute('aria-label', traceName(opts.trace.title));
  return node;
}

/** Botón "Ver cálculo" que arma la traza recién al hacer clic (datos vivos). */
function lazyTraceButton(buildTrace, title, label = 'Ver cálculo') {
  return button(label, {
    variant: 'link',
    size: 'sm',
    icon: 'calc',
    onClick: () => {
      try {
        openTraceDialog(buildTrace());
      } catch (error) {
        logger.warn('No se pudo armar el detalle del cálculo', { message: error && error.message });
      }
    },
    attrs: { class: 'btn btn-link btn-sm trace-btn', 'aria-label': traceName(title) },
  });
}

/** "Ver cálculo" compacto (sólo ícono) con nombre accesible propio. */
function iconTraceButton(trace) {
  return button('', {
    variant: 'link',
    size: 'sm',
    icon: 'calc',
    onClick: () => openTraceDialog(trace),
    attrs: { class: 'btn btn-link btn-sm trace-btn qr-trace-icon', 'aria-label': traceName(trace && trace.title), title: 'Ver cálculo' },
  });
}

/**
 * Copia de una traza de tarifa mínima con los montos de pasos y resultado
 * redondeados hacia arriba (igual que el valor que acompaña en pantalla).
 */
function ceilTrace(trace) {
  if (!trace) return null;
  const up = (item) => (item && item.format === 'money' ? { ...item, format: 'moneyCeil' } : item);
  return {
    ...trace,
    steps: (trace.steps || []).map(up),
    result: up(trace.result),
    notes: [...(trace.notes || []), 'Las tarifas mínimas se muestran redondeadas hacia arriba al peso: cobrar la cifra que ves nunca te deja debajo.'],
  };
}

/** Encabezado abreviado con el nombre completo como title y para lectores de pantalla. */
function abbrHeader(short, full, sub = null) {
  return h('span', { class: 'qr-th', title: full },
    h('span', { 'aria-hidden': 'true' }, short),
    sub ? h('span', { class: 'qr-th-sub', 'aria-hidden': 'true' }, sub) : null,
    h('span', { class: 'sr-only' }, full));
}

function marginTag(v, m) {
  if (sameNumber(m, v.r.targetMarginPct)) return 'objetivo';
  if (sameNumber(m, v.r.customMarginPct)) return 'personalizado';
  return null;
}

function marginLabel(v, m) {
  const tag = marginTag(v, m);
  return tag ? `Margen ${pct(m)} (${tag})` : `Margen ${pct(m)}`;
}

/** Encabezado de columna compacto: "Margen 10 %" + aclaración en segunda línea. */
function marginHeader(v, m) {
  const tag = marginTag(v, m);
  const full = `Tarifa neta necesaria con margen ${pct(m)} sobre el precio${tag ? ` (${tag})` : ''}`;
  return abbrHeader(`Margen ${pct(m).replace(/\s%$/, '\u00a0%')}`, full, tag);
}

function note(text) {
  return h('p', { class: 'qr-note' }, text);
}

// ------------------------------------------------------------------- trazas

function traceCommercial(v) {
  const { k, r } = v;
  const rules = r.ratesAtEstimate || {};
  return createTrace({
    id: 'commercial_rate',
    title: `Precio comercial (por ${v.unitLabel})`,
    formula: 'Tarifa neta = Tarifa de lista × (1 − descuento por tramo) × (1 − continuidad) × (1 − descuento comercial)',
    inputs: [
      { label: 'Origen de la tarifa', value: COMMERCIAL_SOURCE_TEXT[k.commercialSource] || COMMERCIAL_SOURCE_TEXT.none, format: 'text' },
      { label: 'Tarifa de lista', value: k.commercialListRate, format: 'money' },
      { label: 'Factor de descuentos con la actividad estimada', value: rules.discountFactor, format: 'number' },
      { label: 'Precio objetivo de lista', value: k.targetListRate, format: 'moneyCeil' },
      { label: 'Redondeo comercial (múltiplos de)', value: nonNegativeOrNull(v.q.pricing && v.q.pricing.roundingStep), format: 'money' },
    ],
    steps: [{ label: 'Precio comercial sugerido (objetivo redondeado hacia arriba)', value: k.suggestedListRate, format: 'moneyCeil' }],
    result: { label: 'Tarifa neta cobrada', value: k.commercialNetRate, format: 'money' },
    notes: [
      'La tarifa de lista es la que figura en la cotización; la neta es la que realmente cobrás después de descuentos.',
      'El redondeo comercial siempre es hacia arriba: nunca baja el margen.',
    ],
  });
}

function nonNegativeOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function traceMargin(v) {
  const { k } = v;
  return createTrace({
    id: 'margin',
    title: 'Margen y markup del mes',
    formula: 'Margen = Resultado / Facturación · Markup = Resultado / Costo',
    inputs: [
      { label: 'Facturación del mes', value: hasRate(k) ? k.revenue : null, format: 'money' },
      { label: 'Costo total del mes', value: k.totalCost, format: 'money' },
    ],
    steps: [
      { label: 'Resultado', value: hasRate(k) ? k.profit : null, format: 'money' },
      { label: 'Markup (sobre costo)', value: k.markupPct, format: 'percent' },
      { label: 'Margen objetivo', value: k.targetMarginPct, format: 'percent' },
    ],
    result: { label: 'Margen (sobre precio de venta)', value: k.marginPct, format: 'percent' },
    notes: [
      'El margen se calcula sobre el precio de venta; el markup, sobre el costo. No son lo mismo.',
      hasValue(k.marginPct) ? null : 'Sin tarifa comercial (o sin facturación) no hay margen ni markup de la cotización.',
    ],
  });
}

function traceTargetMarginDays(v) {
  const { r, k } = v;
  const l = r.linear || {};
  const m = (k.targetMarginPct || 0) / 100;
  const adjusted = hasValue(l.revenuePerActiveDay) ? l.revenuePerActiveDay * (1 - m) - l.variableCostPerDay : null;
  return createTrace({
    id: 'target_margin_days',
    title: `Días para lograr el margen objetivo (${pct(k.targetMarginPct)})`,
    formula: 'Días = (Costos fijos − Ingresos fijos × (1 − margen)) / (Ingreso por día × (1 − margen) − Costo variable por día)',
    inputs: [
      { label: 'Costos fijos mensuales', value: l.fixedCosts, format: 'money' },
      { label: 'Ingresos fijos (fee de disponibilidad, standby)', value: l.fixedRevenue, format: 'money' },
      { label: 'Ingreso por día activo', value: l.revenuePerActiveDay, format: 'money' },
      { label: 'Costo variable por día activo', value: l.variableCostPerDay, format: 'money' },
      { label: 'Margen objetivo', value: k.targetMarginPct, format: 'percent' },
    ],
    steps: [{ label: 'Ingreso por día después de reservar el margen − costo variable', value: adjusted, format: 'money' }],
    result: { label: 'Días activos para lograr el margen', value: r.targetMarginDays && r.targetMarginDays.reachable ? r.targetMarginDays.days : null, format: 'days' },
    notes: [
      r.targetMarginDays && !r.targetMarginDays.reachable ? r.targetMarginDays.reason : null,
      l.hasNonLinearRules ? 'Hay reglas no lineales (mínimo garantizado, minimum call o tramos de descuento): el resultado se calcula día a día.' : null,
    ],
  });
}

function traceContribution(v) {
  const l = v.r.linear || {};
  return createTrace({
    id: 'contribution_per_day',
    title: 'Contribución por día activo',
    formula: 'Contribución por día = Ingreso por día activo − Costo variable por día activo',
    inputs: [
      { label: 'Tarifa neta por día activo', value: l.netRatePerActiveDay, format: 'money' },
      { label: 'Otros ingresos por día activo (call-out, movilización, km)', value: l.otherRevenuePerActiveDay, format: 'money' },
      { label: 'Costo variable por día activo', value: l.variableCostPerDay, format: 'money' },
    ],
    steps: [{ label: 'Ingreso por día activo', value: l.revenuePerActiveDay, format: 'money' }],
    result: { label: 'Contribución por día activo', value: l.contributionPerDay, format: 'money' },
    notes: ['Es lo que deja cada día trabajado después de pagar sus costos variables. Con esa contribución se cubren los costos fijos del mes.'],
  });
}

const SUGGESTED_TITLE = 'Precio comercial sugerido';

function traceSuggested(v) {
  const { k, q } = v;
  return createTrace({
    id: 'suggested_rate',
    title: SUGGESTED_TITLE,
    formula: 'Precio comercial sugerido = Precio objetivo de lista redondeado hacia arriba al múltiplo elegido',
    inputs: [
      { label: 'Precio objetivo de lista', value: k.targetListRate, format: 'moneyCeil' },
      { label: 'Redondeo comercial (múltiplos de)', value: nonNegativeOrNull(q.pricing && q.pricing.roundingStep), format: 'money' },
    ],
    result: { label: SUGGESTED_TITLE, value: k.suggestedListRate, format: 'moneyCeil' },
    notes: [
      'Si no hay redondeo configurado, el sugerido es igual al precio objetivo.',
      'Se muestra redondeado hacia arriba al peso: cobrar la cifra que ves nunca te deja debajo del objetivo.',
    ],
  });
}

function traceSuggestedResult(v, suggested, ev) {
  const revenue = ev.revenue || {};
  const cost = ev.cost || {};
  return createTrace({
    id: 'suggested_result',
    title: 'Resultado con el precio comercial sugerido',
    formula: 'Resultado = Facturación − Costo total · Margen = Resultado / Facturación',
    inputs: [
      { label: 'Precio comercial sugerido (lista)', value: suggested, format: 'moneyCeil' },
      { label: 'Tarifa neta (después de descuentos)', value: revenue.netRate, format: 'money' },
      { label: 'Unidades facturables', value: revenue.billableUnits, format: 'number' },
      { label: 'Otros ingresos', value: revenue.otherRevenue, format: 'money' },
      { label: 'Costo total', value: cost.total, format: 'money' },
    ],
    steps: [{ label: 'Facturación total', value: revenue.total, format: 'money' }],
    result: { label: 'Resultado', value: ev.profit, format: 'money' },
    notes: ['La cotización usa otra tarifa comercial; este cálculo muestra qué pasaría con el precio sugerido.'],
  });
}

function traceRateForMargin(v, row) {
  const ra = v.r.ratesAtEstimate || {};
  const m = row.marginPct;
  const isFloor = m === 0;
  return createTrace({
    id: isFloor ? 'floor_rate_detail' : 'rate_for_margin',
    title: isFloor ? `Tarifa piso (por ${v.unitLabel})` : `${sameNumber(m, v.r.targetMarginPct) ? 'Precio objetivo' : 'Tarifa'} con margen ${pct(m)} (por ${v.unitLabel})`,
    formula: 'Tarifa neta = (Costo total / (1 − margen) − Otros ingresos) / Unidades facturables · Lista = neta / factor de descuentos',
    inputs: [
      { label: 'Costo total del mes', value: ra.totalCost, format: 'money' },
      { label: 'Margen sobre precio', value: m, format: 'percent' },
      { label: 'Otros ingresos (fees, standby, km)', value: ra.otherRevenue, format: 'money' },
      { label: `Unidades facturables (${v.unitLabel})`, value: ra.billableUnits, format: 'number' },
      { label: 'Factor de descuentos', value: ra.discountFactor, format: 'number' },
    ],
    steps: [
      { label: 'Facturación necesaria', value: isValidMarginPct(m) && hasValue(ra.totalCost) ? ra.totalCost / (1 - m / 100) : null, format: 'moneyCeil' },
      { label: 'Tarifa neta', value: row.netRate, format: 'moneyCeil' },
      { label: 'Markup equivalente', value: marginToMarkup(m), format: 'percent' },
    ],
    result: { label: 'Tarifa de lista', value: row.listRate, format: 'moneyCeil' },
    notes: ['Las tarifas mínimas se muestran redondeadas hacia arriba al peso: cobrar la cifra que ves nunca te deja debajo.'],
  });
}

function traceEquivalents(v) {
  const { r, k } = v;
  const activity = r.activity || {};
  return createTrace({
    id: 'rate_equivalents',
    title: 'Equivalencias de la tarifa comercial',
    formula: '$/hora = tarifa por día / horas por día activo · $/día = tarifa por hora × horas por día (abono: abono / días activos) · $/mes = facturación del mes con la actividad estimada',
    inputs: [
      { label: `Tarifa comercial de lista (por ${v.unitLabel})`, value: k.commercialListRate, format: 'money' },
      { label: 'Horas por día activo', value: activity.hoursPerActiveDay, format: 'hours' },
      { label: 'Días activos por mes', value: k.activeDays, format: 'days' },
    ],
    steps: [
      { label: '$ por hora', value: r.equivalents && r.equivalents.perHour, format: 'money' },
      { label: '$ por día', value: r.equivalents && r.equivalents.perDay, format: 'money' },
    ],
    result: { label: 'Facturación mensual estimada', value: r.equivalents && r.equivalents.perMonth, format: 'money' },
    notes: ['$/hora y $/día son tarifas de lista; la facturación mensual incluye descuentos y otros ingresos.'],
  });
}

function traceCompleteness(v) {
  const c = v.r.completeness || { items: [], counts: {} };
  const counts = c.counts || {};
  const weights = { ok: 1, warning: 0.5, missing: 0 };
  let total = 0;
  let earned = 0;
  (c.items || []).forEach((i) => {
    if (!(i.status in weights)) return;
    total += i.weight;
    earned += i.weight * weights[i.status];
  });
  return createTrace({
    id: 'completeness',
    title: 'Cost Completeness Score',
    formula: 'Completitud = Σ peso obtenido / Σ peso aplicable × 100 (verde suma 100 % de su peso, naranja 50 %, rojo 0 %)',
    inputs: [
      { label: 'Controles en verde', value: counts.ok || 0, format: 'number' },
      { label: 'Controles en naranja', value: counts.warning || 0, format: 'number' },
      { label: 'Controles en rojo', value: counts.missing || 0, format: 'number' },
    ],
    steps: [
      { label: 'Peso obtenido', value: earned, format: 'number' },
      { label: 'Peso aplicable', value: total, format: 'number' },
    ],
    result: { label: 'Completitud', value: c.scorePct, format: 'percent' },
    notes: ['Reglas determinísticas: detectan costos o definiciones que suelen olvidarse.'],
  });
}

// ------------------------------------------------------------ A. decisión

function heroItem({ label, value, hint = null, trace = null, lazyTrace = null, lazyTitle = null, tone = null, big = false }) {
  return h('div', { class: ['qr-hero-item', tone ? `qr-tone-${tone}` : null, big ? 'qr-hero-main' : null] },
    h('div', { class: 'qr-hero-label' }, label),
    h('div', { class: 'qr-hero-value' }, value || EMPTY),
    hint ? h('div', { class: 'qr-hero-hint' }, hint) : null,
    trace ? traceBtn(trace) : lazyTrace ? lazyTraceButton(lazyTrace, lazyTitle || label) : null);
}

/**
 * Tarifas mínimas de la actividad estimada en la base que se ESCRIBE en la
 * cotización (de lista, igual que "Tarifa conocida" y "Tarifa ofrecida"),
 * con la neta (después de descuentos) como dato secundario.
 */
function minimumRates(v) {
  const { k, r } = v;
  const ra = r.ratesAtEstimate || {};
  const showList = hasValue(ra.discountFactor) && Math.abs(ra.discountFactor - 1) > 1e-9;
  const floorIsList = hasValue(k.floorListRate);
  const targetIsList = hasValue(k.targetListRate);
  return {
    showList,
    floorIsList,
    floorMain: floorIsList ? k.floorListRate : k.floorNetRate,
    floorNetDiffers: floorIsList && listDiffers(k.floorListRate, k.floorNetRate),
    targetMain: targetIsList ? k.targetListRate : k.targetNetRate,
    targetNetDiffers: targetIsList && listDiffers(k.targetListRate, k.targetNetRate),
  };
}

function floorLabel(m) {
  return m.showList && m.floorIsList ? 'Tarifa piso de lista' : 'Tarifa piso';
}

function targetLabel(v, m) {
  return `Precio objetivo${m.showList ? ' de lista' : ''} (margen ${pct(v.k.targetMarginPct)})`;
}

function netHint(netValue, unitLabel) {
  return `Neta: ${minRate(netValue, unitLabel)} (después de descuentos).`;
}

/** "$ 2.033.055 / día de lista (neto $ 1.972.063 / día)". */
function floorPhrase(v) {
  const m = minimumRates(v);
  if (!hasValue(m.floorMain)) return EMPTY;
  return m.floorNetDiffers
    ? `${minRate(m.floorMain, v.unitLabel)} de lista (neto ${minRate(v.k.floorNetRate, v.unitLabel)})`
    : minRate(m.floorMain, v.unitLabel);
}

function targetPhrase(v) {
  const m = minimumRates(v);
  if (!hasValue(m.targetMain)) return EMPTY;
  return m.targetNetDiffers
    ? `${minRate(m.targetMain, v.unitLabel)} de lista (neto ${minRate(v.k.targetNetRate, v.unitLabel)})`
    : minRate(m.targetMain, v.unitLabel);
}

/**
 * Abono mensual: la facturación es fija y cada día activo suma costo
 * variable, así que en vez de días MÍNIMOS hay días MÁXIMOS sin pérdida.
 * Se calculan con el mismo buscador del break-even sobre el resultado
 * invertido (−resultado): el primer día desde el que el resultado ya no es
 * positivo. Con margenPct > 0 se busca el máximo que conserva ese margen.
 * @returns {null | { status: 'until'|'all'|'none', days: number|null, wholeDays: number|null, available: number, marginPct: number, listRate: number }}
 */
function monthlyCap(v, listRate, marginPct = 0) {
  const { r } = v;
  const ctx = r.ctx;
  if (r.unit !== 'month' || !ctx || !(hasValue(listRate) && listRate > 0)) return null;
  const available = ctx.activity ? ctx.activity.availableDaysPerMonth : null;
  if (!(hasValue(available) && available > 0)) return null;
  const m = isValidMarginPct(marginPct) && marginPct > 0 ? marginPct : 0;
  const gap = (d) => {
    const e = evaluateAt(ctx, d, listRate);
    return e.profit - (m / 100) * e.revenue.total;
  };
  try {
    const res = findBreakEvenDays((d) => -gap(d), { maxDays: available });
    if (!res.reachable) return { status: 'all', days: null, wholeDays: null, available, marginPct: m, listRate };
    if (!(res.days > 1e-9)) return { status: 'none', days: 0, wholeDays: 0, available, marginPct: m, listRate };
    return { status: 'until', days: res.days, wholeDays: Math.floor(res.days + 1e-7), available, marginPct: m, listRate };
  } catch (error) {
    logger.warn('No se pudieron calcular los días máximos del abono', { message: error && error.message });
    return null;
  }
}

function capTitle(cap) {
  return cap && cap.marginPct > 0 ? `Días máximos con el margen objetivo (${pct(cap.marginPct)})` : 'Días máximos de actividad sin pérdida';
}

function traceMonthlyCap(v, cap) {
  const ctx = v.r.ctx;
  const at0 = evaluateAt(ctx, 0, cap.listRate);
  const atMax = evaluateAt(ctx, cap.available, cap.listRate);
  const withMargin = cap.marginPct > 0;
  const resultValue = cap.status === 'until' ? cap.days : cap.status === 'none' ? 0 : cap.available;
  return createTrace({
    id: withMargin ? 'max_days_target_margin' : 'max_days_without_loss',
    title: capTitle(cap),
    formula: withMargin
      ? 'Días máximos = último D con Resultado(D) ≥ margen × Facturación(D) · Resultado(D) = Facturación(D) − (Costos fijos + Costo variable por día × D)'
      : 'Días máximos = último D con Resultado(D) = Facturación(D) − Costo(D) ≥ 0 · con abono fijo ≈ (Facturación del mes − Costos fijos) / Costo variable por día',
    inputs: [
      { label: 'Abono de lista', value: cap.listRate, format: 'money' },
      { label: 'Facturación del mes sin días activos (abono neto e ingresos fijos)', value: at0.revenue.total, format: 'money' },
      { label: 'Costos fijos del mes', value: at0.cost.total, format: 'money' },
      { label: 'Costo variable por día activo', value: ctx.model ? ctx.model.variablePerActiveDay : null, format: 'money' },
      ...(withMargin ? [{ label: 'Margen objetivo', value: cap.marginPct, format: 'percent' }] : []),
      { label: 'Días disponibles del mes', value: cap.available, format: 'days' },
    ],
    steps: [
      { label: 'Resultado con 0 días activos', value: at0.profit, format: 'money' },
      { label: `Resultado con ${formatDays(cap.available)} activos`, value: atMax.profit, format: 'money' },
    ],
    result: { label: cap.status === 'all' ? 'Días máximos (todos los disponibles)' : 'Días máximos', value: resultValue, format: 'days' },
    notes: [
      'Con abono mensual la facturación no depende de los días: cada día activo suma costo variable. Por eso hay un máximo de días, no un mínimo.',
      cap.status === 'all' ? 'El abono alcanza aun trabajando todos los días disponibles del mes.' : null,
      cap.status === 'none' ? 'El abono no alcanza ni sin días activos: no cubre los costos fijos del mes.' : null,
      'Se evalúa día a día (grilla de 0,1 día y bisección), igual que el break-even.',
    ],
  });
}

/** Tarjeta (hero o KPI) con los días máximos de un abono mensual. */
function capView(v, cap) {
  const D = v.k.activeDays;
  const withMargin = cap && cap.marginPct > 0;
  if (!cap) return { value: EMPTY, hint: 'Sin tarifa comercial.', tone: null };
  if (cap.status === 'all') {
    return {
      value: `Todos (${formatDays(cap.available)})`,
      hint: withMargin ? 'Conserva el margen objetivo aun con todos los días disponibles.' : 'El abono cubre los costos aun con todos los días disponibles.',
      tone: 'green',
    };
  }
  if (cap.status === 'none') {
    return {
      value: formatDays(0),
      hint: withMargin ? 'Con este abono no se llega al margen objetivo ni sin trabajar.' : 'El abono no cubre ni los costos fijos: perdés dinero aunque no se trabaje.',
      tone: 'red',
    };
  }
  const within = hasValue(D) ? D <= cap.days + 1e-9 : null;
  return {
    value: wholeDays(cap.wholeDays),
    hint: `Exacto: ${formatDays(cap.days)}. Con más días activos ${withMargin ? 'el margen cae debajo del objetivo' : 'el costo variable supera al abono'}.`,
    tone: within === null ? null : within ? 'green' : 'red',
  };
}

function capSentence(cap, D, subject) {
  if (!cap) return '';
  if (cap.status === 'all') return `${subject} no perdés dinero aun trabajando los ${formatDays(cap.available)} disponibles del mes.`;
  if (cap.status === 'none') return `${subject} perdés dinero aunque no se trabaje: no cubre ni los costos fijos del mes.`;
  const tail = hasValue(D)
    ? D <= cap.days + 1e-9
      ? ` Estimás ${formatDays(D)}: estás dentro del máximo.`
      : ` Estimás ${formatDays(D)}: con esa actividad perdés dinero.`
    : '';
  return `${subject} no perdés dinero hasta ${wholeDays(cap.wholeDays)} activos por mes (${formatDays(cap.days)} exactos): con más días, el costo variable supera al abono.${tail}`;
}

function belowFloorCoveredText(v) {
  const { k, r } = v;
  let topUp = 0;
  try {
    topUp = r.ctx ? evaluateAt(r.ctx, k.activeDays, k.commercialListRate).revenue.guaranteeTopUp : 0;
  } catch {
    topUp = 0;
  }
  const who = hasValue(topUp) && topUp > 0 ? 'el mínimo garantizado cubre la diferencia' : 'los otros ingresos cubren la diferencia';
  const marginPart = k.belowTarget && hasValue(k.marginPct) ? ` (margen ${pct(k.marginPct)}, debajo del objetivo de ${pct(k.targetMarginPct)})` : '';
  return `La tarifa está debajo de la tarifa piso (${floorPhrase(v)}), pero ${who}: con ${formatDays(k.activeDays)} activos el resultado del mes es ${money(k.profit)}${marginPart}. Si la actividad baja o cambian las condiciones, podés perder dinero.`;
}

function decisionAlerts(v) {
  const { k, r } = v;
  const out = [];
  const rateOk = hasRate(k);
  if (k.belowFloor) {
    out.push(banner(`La tarifa comercial está por debajo de la tarifa piso: perdés dinero. Con ${formatDays(k.activeDays)} activos necesitás cobrar al menos ${floorPhrase(v)} para no perder.`, 'danger', { title: 'Atención.' }));
  } else if (k.belowFloorRate) {
    out.push(banner(belowFloorCoveredText(v), 'info', { title: 'Tarifa debajo del piso.' }));
  } else if (k.belowTarget) {
    out.push(banner(`La tarifa comercial cubre los costos pero no llega al margen objetivo de ${pct(k.targetMarginPct)}. Margen esperado: ${pct(k.marginPct)}.`, 'warning', { title: 'Debajo del margen objetivo.' }));
  }
  // Sin tarifa el texto principal ya explica qué falta: el aviso sólo aparece con tarifa.
  const be = r.breakEven || {};
  if (rateOk && be.reachable === false && be.reason) {
    if (!be.notApplicable) {
      out.push(banner(be.reason, 'warning', { title: 'Días mínimos para no perder dinero.' }));
    } else if (r.pricingMode !== 'known_rate') {
      // En "Conozco la tarifa" la frase principal ya lo explica.
      out.push(banner('Con abono mensual no hay días mínimos: la facturación es fija y cada día activo suma costo variable. Por eso importa el máximo de días que cubre el abono.', 'info', { title: 'Abono mensual.' }));
    }
  }
  const issues = Array.isArray(r.issues) ? r.issues : [];
  if (issues.length) {
    out.push(h('div', { class: 'banner banner-warning qr-issues', role: 'status' },
      h('div', {},
        h('strong', {}, 'Hay datos para revisar. '),
        'Los cálculos reemplazan los valores inválidos por 0 o por un valor por defecto:',
        h('ul', {}, ...issues.slice(0, 6).map((i) => h('li', {}, String(i.message || '')))),
        issues.length > 6 ? h('span', { class: 'small' }, `y ${formatNumber(issues.length - 6)} más.`) : null)));
  }
  return out;
}

function heroKnownRate(v) {
  const { r, k, q } = v;
  const be = r.breakEven || {};
  const tm = r.targetMarginDays || {};
  const D = k.activeDays;
  const l = r.linear || {};
  const rateOk = hasRate(k);
  const isMonth = r.unit === 'month';
  const noDays = be.notApplicable ? 'No aplica' : 'No se alcanza';
  const cap = isMonth && rateOk ? monthlyCap(v, k.commercialListRate, 0) : null;
  const capTarget = isMonth && rateOk ? monthlyCap(v, k.commercialListRate, k.targetMarginPct) : null;

  let sentence;
  if (!rateOk) {
    sentence = h('p', { class: 'qr-lead' }, 'Todavía no ingresaste la tarifa que te pidieron cotizar. ', stepLink(q, 'modality', 'Cargala en Modalidad'), ' para ver los días mínimos y el resultado.');
  } else if (isMonth) {
    sentence = h('p', { class: 'qr-lead' },
      `Cotizás un abono mensual de ${rate(k.commercialListRate, v.unitLabel)}: la facturación no depende de los días trabajados, pero cada día activo suma costo variable. `,
      capSentence(cap, D, 'Con este abono'));
  } else if (be.reachable) {
    const gap = hasValue(D) && hasValue(be.days) ? D - be.days : null;
    const tail = !hasValue(gap)
      ? ''
      : gap >= -1e-9
        ? ` Estimás ${formatDays(D)}: tenés un colchón de ${formatDays(Math.max(0, gap))} sobre el mínimo.`
        : ` Estimás ${formatDays(D)}: te faltan ${formatDays(-gap)} para cubrir los costos.`;
    sentence = h('p', { class: 'qr-lead' }, `Con una tarifa de ${rate(k.commercialListRate, v.unitLabel)} necesitás al menos ${wholeDays(be.wholeDays)} activos por mes para no perder dinero.${tail}`);
  } else {
    sentence = h('p', { class: 'qr-lead' }, `Con una tarifa de ${rate(k.commercialListRate, v.unitLabel)} no se cubren los costos dentro del mes. Revisá la tarifa o los costos.`);
  }

  const resultItem = heroItem({
    label: `Resultado esperado con ${formatDays(D)}`,
    value: rateOk ? money(k.profit) : EMPTY,
    hint: rateOk ? marginHint(k.marginPct, k.markupPct) : 'Sin tarifa comercial.',
    trace: r.traces && r.traces.expectedResult,
    tone: profitTone(k),
  });

  if (isMonth) {
    const c0 = capView(v, cap);
    const c1 = capView(v, capTarget);
    return h('div', { class: 'qr-decision' },
      sentence,
      h('div', { class: 'qr-hero' },
        heroItem({ label: capTitle(cap), value: c0.value, hint: c0.hint, lazyTrace: cap ? () => traceMonthlyCap(v, cap) : null, lazyTitle: capTitle(cap), tone: c0.tone, big: true }),
        heroItem({ label: capTitle(capTarget || { marginPct: k.targetMarginPct }), value: c1.value, hint: c1.hint, lazyTrace: capTarget ? () => traceMonthlyCap(v, capTarget) : null, lazyTitle: capTitle(capTarget), tone: c1.tone }),
        resultItem,
        heroItem({
          label: 'Contribución por día activo',
          value: 'No aplica',
          hint: 'Con abono mensual el ingreso no depende de los días trabajados: cada día extra sólo suma costo variable.',
        })));
  }

  return h('div', { class: 'qr-decision' },
    sentence,
    h('div', { class: 'qr-hero' },
      heroItem({
        label: 'Días mínimos para no perder dinero',
        value: be.reachable ? wholeDays(be.wholeDays) : rateOk ? noDays : EMPTY,
        hint: be.reachable ? `Break-even exacto: ${formatDays(be.days)} por mes.` : be.reason || null,
        trace: r.traces && r.traces.breakEven,
        tone: be.reachable && hasValue(D) ? (D + 1e-9 >= be.days ? 'green' : 'red') : rateOk && !be.notApplicable ? 'red' : null,
        big: true,
      }),
      heroItem({
        label: `Días para lograr el margen objetivo (${pct(k.targetMarginPct)})`,
        value: tm.reachable ? wholeDays(tm.wholeDays) : rateOk ? noDays : EMPTY,
        hint: tm.reachable ? `Exacto: ${formatDays(tm.days)}.` : tm.reason || null,
        lazyTrace: () => traceTargetMarginDays(v),
        lazyTitle: `Días para lograr el margen objetivo (${pct(k.targetMarginPct)})`,
      }),
      resultItem,
      heroItem({
        label: 'Contribución por día activo',
        value: rateOk ? money(l.contributionPerDay) : EMPTY,
        hint: 'Lo que deja cada día trabajado después de sus costos variables.',
        lazyTrace: () => traceContribution(v),
        lazyTitle: 'Contribución por día activo',
        tone: rateOk && hasValue(l.contributionPerDay) && l.contributionPerDay <= 0 ? 'red' : null,
      }),
    ));
}

function heroKnownActivity(v) {
  const { r, k, q } = v;
  const ra = r.ratesAtEstimate || {};
  const D = k.activeDays;
  const mr = minimumRates(v);
  const showList = mr.showList;
  const ctx = r.ctx;
  const isMonth = r.unit === 'month';

  const rows = [
    { key: 'floor', marginPct: 0, netRate: ra.floorNetRate, listRate: ra.floorListRate, label: 'Tarifa piso (no perder dinero)' },
    ...(Array.isArray(ra.byMargin) ? ra.byMargin : [])
      .filter((m) => hasValue(m.marginPct) && m.marginPct > 0)
      .sort((a, b) => a.marginPct - b.marginPct)
      .map((m) => ({ key: `m${m.marginPct}`, marginPct: m.marginPct, netRate: m.netRate, listRate: m.listRate, label: marginLabel(v, m.marginPct) })),
  ];

  const columns = [
    { key: 'label', label: 'Nivel' },
    { key: 'marginPct', label: 'Margen sobre precio', align: 'right', render: (row) => pct(row.marginPct) },
    { key: 'markup', label: 'Markup equivalente', align: 'right', render: (row) => pct(marginToMarkup(row.marginPct)) },
    ...(showList ? [{ key: 'listRate', label: `Tarifa de lista por ${v.unitLabel}`, align: 'right', render: (row) => ceilMoney(row.listRate) }] : []),
    { key: 'netRate', label: showList ? `Tarifa neta por ${v.unitLabel}` : `Tarifa por ${v.unitLabel}`, align: 'right', render: (row) => ceilMoney(row.netRate) },
    { key: 'trace', label: 'Cálculo', align: 'right', render: (row) => traceBtn(traceRateForMargin(v, row)) },
  ];

  // Resultado con el precio sugerido (si la comercial es otra, se evalúa aparte).
  // Sin costos el "sugerido" sería $ 0: no se muestra como sugerencia.
  const suggested = hasValue(k.suggestedListRate) && k.suggestedListRate > 0 ? k.suggestedListRate : null;
  let suggestedEval = null;
  if (k.commercialSource === 'suggested') {
    suggestedEval = hasRate(k) ? { profit: k.profit, marginPct: k.marginPct, markupPct: k.markupPct } : null;
  } else if (ctx && hasValue(suggested) && suggested > 0) {
    try {
      suggestedEval = evaluateAt(ctx, D, suggested);
    } catch (error) {
      logger.warn('No se pudo evaluar el precio sugerido', { message: error && error.message });
    }
  }
  const sTone = suggestedEval && hasValue(suggestedEval.profit) ? (suggestedEval.profit < -1e-6 ? 'red' : hasValue(suggestedEval.marginPct) && suggestedEval.marginPct < k.targetMarginPct - 1e-9 ? 'orange' : 'green') : null;

  let sentence;
  if (!(D > 0)) {
    sentence = h('p', { class: 'qr-lead' }, 'Falta saber cuántos días del mes esperás que el equipo esté trabajando y facturando. ', stepLink(q, 'modality', 'Cargalo en Modalidad'), '.');
  } else if (!(k.totalCost > 0)) {
    sentence = h('p', { class: 'qr-lead' }, 'Todavía no hay costos cargados, así que no hay tarifa que calcular. ', stepLink(q, 'labor', 'Empezá por el personal'), '.');
  } else {
    const roundingStep = nonNegativeOrNull(q.pricing && q.pricing.roundingStep);
    const subject = k.commercialSource === 'suggested' ? 'Con el abono sugerido' : 'Con el abono cotizado';
    sentence = h('p', { class: 'qr-lead' },
      `Con ${formatDays(D)} activos por mes, cobrá al menos ${floorPhrase(v)} para no perder dinero. `,
      `Para ganar el ${pct(k.targetMarginPct)} sobre el precio, cobrá ${targetPhrase(v)}. `,
      hasValue(suggested) ? `Precio comercial sugerido${roundingStep ? ` (redondeado a múltiplos de ${money(roundingStep)})` : ''}: ${minRate(suggested, v.unitLabel)}.` : '',
      isMonth && hasRate(k) ? ` ${capSentence(monthlyCap(v, k.commercialListRate, 0), D, subject)}` : '');
  }

  return h('div', { class: 'qr-decision' },
    sentence,
    h('div', { class: 'qr-hero' },
      heroItem({
        label: floorLabel(mr),
        value: minRateNode(mr.floorMain, v.unitLabel),
        hint: mr.floorNetDiffers ? netHint(k.floorNetRate, v.unitLabel) : 'Iguala el costo del mes (margen 0).',
        trace: ceilTrace(r.traces && r.traces.floorRate),
      }),
      heroItem({
        label: targetLabel(v, mr),
        value: minRateNode(mr.targetMain, v.unitLabel),
        hint: mr.targetNetDiffers ? netHint(k.targetNetRate, v.unitLabel) : `Markup equivalente: ${pct(marginToMarkup(k.targetMarginPct))}.`,
        trace: ceilTrace(r.traces && r.traces.targetRate),
      }),
      heroItem({
        label: SUGGESTED_TITLE,
        value: minRateNode(suggested, v.unitLabel),
        hint: suggested !== null ? 'Precio objetivo redondeado hacia arriba (nunca baja el margen).' : 'Aparece cuando haya costos y días activos cargados.',
        lazyTrace: () => traceSuggested(v),
        lazyTitle: SUGGESTED_TITLE,
        big: true,
      }),
      heroItem({
        label: 'Resultado con el precio sugerido',
        value: suggestedEval ? money(suggestedEval.profit) : EMPTY,
        hint: suggestedEval ? marginHint(suggestedEval.marginPct, suggestedEval.markupPct) : 'Sin precio sugerido.',
        trace: k.commercialSource === 'suggested' && r.traces ? r.traces.expectedResult : null,
        lazyTrace: k.commercialSource !== 'suggested' && suggestedEval ? () => traceSuggestedResult(v, suggested, suggestedEval) : null,
        lazyTitle: 'Resultado con el precio comercial sugerido',
        tone: sTone,
      }),
      k.commercialSource === 'offered'
        ? heroItem({
          label: 'Con la tarifa ofrecida (cargada a mano)',
          value: money(k.profit),
          hint: `${rate(k.commercialListRate, v.unitLabel)} · ${hasValue(k.marginPct) ? `margen ${pct(k.marginPct)}` : 'sin margen calculable'}`,
          trace: r.traces && r.traces.expectedResult,
          tone: profitTone(k),
        })
        : null,
    ),
    h('h4', {}, 'Tarifas por nivel de margen'),
    table({ columns, rows, rowClass: (row) => (sameNumber(row.marginPct, r.targetMarginPct) ? 'row-highlight' : null), caption: 'Tarifas por nivel de margen', className: 'qr-rates-table' }),
    showList ? note(`La tarifa de lista ya contempla los descuentos que aplicarían con ${formatDays(D)} (factor ${formatNumber(ra.discountFactor, { decimals: 4 })}): es la que escribís en la cotización. Las tarifas mínimas se muestran redondeadas hacia arriba.`) : note('Las tarifas mínimas se muestran redondeadas hacia arriba al peso: cobrar la cifra que ves nunca te deja debajo.'));
}

function kpiGrid(v) {
  const { r, k } = v;
  const be = r.breakEven || {};
  const traces = r.traces || {};
  const rateOk = hasRate(k);
  const knownRate = r.pricingMode === 'known_rate';
  const isMonth = r.unit === 'month';
  const mr = minimumRates(v);
  const score = r.completeness ? r.completeness.scorePct : null;
  const items = [];

  items.push(kpiItem({ label: 'Costo total mensual', value: money(k.totalCost), hint: `Fijos ${money(k.fixedCosts)} · variables ${money(k.variableCosts)}`, trace: traces.totalCost }));

  // "Conozco la actividad" ya muestra piso y objetivo en el bloque principal;
  // "Conozco la tarifa" no, así que van acá (en base de lista).
  if (knownRate) {
    items.push(kpiItem({
      label: floorLabel(mr),
      value: minRateNode(mr.floorMain, v.unitLabel),
      hint: mr.floorNetDiffers ? netHint(k.floorNetRate, v.unitLabel) : 'Para no perder dinero (margen 0).',
      trace: ceilTrace(traces.floorRate),
    }));
    items.push(kpiItem({
      label: targetLabel(v, mr),
      value: minRateNode(mr.targetMain, v.unitLabel),
      hint: mr.targetNetDiffers ? netHint(k.targetNetRate, v.unitLabel) : `Markup equivalente: ${pct(marginToMarkup(k.targetMarginPct))}.`,
      trace: ceilTrace(traces.targetRate),
    }));
  }

  // Precio comercial: la tarifa conocida u ofrecida (la sugerida ya está arriba).
  if (knownRate || k.commercialSource === 'offered' || k.commercialSource === 'override') {
    const differs = rateOk && listDiffers(k.commercialListRate, k.commercialNetRate);
    items.push(kpiItem({
      label: 'Precio comercial',
      value: commercialRateNode(k, v.unitLabel),
      hint: `${COMMERCIAL_SOURCE_TEXT[k.commercialSource] || COMMERCIAL_SOURCE_TEXT.none}${differs ? `. Neta: ${rate(k.commercialNetRate, v.unitLabel)}` : ''}`,
      trace: traceCommercial(v),
      emphasis: true,
    }));
  }

  // En "Conozco la tarifa" el resultado y los días ya están en el bloque principal.
  if (!knownRate) {
    items.push(kpiItem({ label: 'Resultado esperado', value: rateOk ? money(k.profit) : EMPTY, hint: rateOk ? `Facturación ${money(k.revenue)}` : 'Sin tarifa comercial', tone: profitTone(k), trace: traces.expectedResult }));
  }

  const marginOk = rateOk && hasValue(k.marginPct);
  items.push(kpiItem({
    label: 'Margen',
    value: marginOk ? pct(k.marginPct) : EMPTY,
    hint: marginOk ? `Markup equivalente: ${pct(k.markupPct)} (sobre costo)` : rateOk ? 'Sin facturación: no hay margen' : 'Sin tarifa comercial',
    tone: marginTone(k),
    trace: traceMargin(v),
  }));

  if (!knownRate) {
    if (isMonth) {
      const cap = rateOk ? monthlyCap(v, k.commercialListRate, 0) : null;
      const view = capView(v, cap);
      items.push(kpiItem({
        label: capTitle(cap),
        value: view.value,
        hint: cap ? view.hint : 'Con abono mensual no hay días mínimos: más días suman costo.',
        tone: view.tone,
        trace: cap ? traceMonthlyCap(v, cap) : null,
      }));
    } else {
      let beValue = EMPTY;
      if (be.reachable) beValue = formatDays(be.days);
      else if (be.notApplicable) beValue = 'No aplica';
      else if (rateOk) beValue = 'No se alcanza';
      items.push(kpiItem({
        label: 'Break-even',
        value: beValue,
        hint: be.reachable ? `Días mínimos para no perder dinero (${wholeDays(be.wholeDays)} enteros)` : 'Días mínimos para no perder dinero',
        tone: be.reachable && hasValue(k.activeDays) ? (k.activeDays + 1e-9 >= be.days ? 'green' : 'red') : null,
        trace: traces.breakEven,
      }));
    }
  }

  items.push(kpiItem({ label: 'Completitud', value: pct(score, 0), hint: 'Cost Completeness Score', tone: completenessTone(score), trace: traceCompleteness(v) }));

  return h('div', { class: 'kpi-grid qr-kpis', style: { '--qr-kpi-cols': String(items.length) } }, ...items);
}

function equivalentsBlock(v) {
  const e = v.r.equivalents || {};
  if (!hasRate(v.k)) return null;
  const item = (label, value) => h('div', { class: 'qr-equiv-item' }, h('span', { class: 'qr-equiv-label' }, label), h('strong', { class: 'qr-equiv-value' }, money(value)));
  return h('div', { class: 'qr-equiv' },
    h('div', { class: 'qr-equiv-title' }, 'Equivalencias de la tarifa comercial'),
    h('div', { class: 'qr-equiv-items' },
      item('$ por hora', e.perHour),
      item('$ por día', e.perDay),
      item('Facturación del mes', e.perMonth)),
    lazyTraceButton(() => traceEquivalents(v), 'Equivalencias de la tarifa comercial'));
}

/** Insignia ILUSTRATIVO: la cotización entera o algunos de sus valores son de demostración. */
function illustrativeBadge(v) {
  const info = v.ill;
  if (!info || !info.any) return null;
  let title = 'Cotización con valores de demostración';
  if (!info.quote) {
    const parts = [];
    if (info.lines > 0) parts.push(`${formatNumber(info.lines)} ${info.lines === 1 ? 'ítem copiado' : 'ítems copiados'} de plantillas o bibliotecas de demostración`);
    if (info.fuel) parts.push('precio de combustible ilustrativo');
    title = `Incluye valores ILUSTRATIVOS: ${parts.join(' y ')}. Reemplazalos por valores propios vigentes.`;
  }
  return badge('ILUSTRATIVO', 'orange', { title });
}

function renderDecision(v) {
  const { r } = v;
  const mode = r.pricingMode === 'known_rate' ? 'known_rate' : 'known_activity';
  const modeLabel = labelOf(PRICING_MODES, mode, 'Conozco la actividad');
  return card(
    {
      title: mode === 'known_rate' ? '¿Me conviene esta tarifa?' : '¿Cuánto tengo que cobrar?',
      subtitle: mode === 'known_rate'
        ? (r.unit === 'month'
          ? 'Modalidad "Conozco la tarifa": cuántos días podés trabajar con este abono sin perder.'
          : 'Modalidad "Conozco la tarifa": cuántos días tenés que trabajar para no perder y para ganar.')
        : 'Modalidad "Conozco la actividad": qué tarifa necesitás con los días que estimás trabajar.',
      actions: [badge(modeLabel, 'navy'), illustrativeBadge(v)].filter(Boolean),
      className: 'qr-card qr-card-decision',
      id: v.ids.decision,
    },
    ...decisionAlerts(v),
    mode === 'known_rate' ? heroKnownRate(v) : heroKnownActivity(v),
    kpiGrid(v),
    equivalentsBlock(v),
  );
}

// ------------------------------------------------------------- B. EECC

function renderCostStructure(v) {
  const { r, k, q } = v;
  const e = r.eecc || { rows: [], total: 0 };
  const header = {
    title: 'Estructura de costos (EECC)',
    subtitle: `Monto e incidencia de cada categoría con ${formatDays(k.activeDays)} activos por mes.`,
    actions: r.traces && r.traces.totalCost ? [traceBtn(r.traces.totalCost, { label: 'Ver cálculo del total' })] : [],
    className: 'qr-card',
    id: v.ids.eecc,
  };
  if (!(hasValue(e.total) && e.total > 0)) {
    return card(header, emptyState('Todavía no hay costos cargados: el costo total del mes es $ 0. Cargá personal, equipos, materiales o logística para ver la estructura de costos.', stepLink(q, 'labor', 'Ir a Personal')));
  }
  const columns = [
    { key: 'label', label: 'Categoría' },
    { key: 'amount', label: abbrHeader('Monto mes', 'Monto mensual'), align: 'right', render: (row) => money(row.amount) },
    { key: 'perActiveDay', label: abbrHeader('$/día activo', 'Pesos por día activo'), align: 'right', render: (row) => money(row.perActiveDay) },
    { key: 'displayPct', label: abbrHeader('Incid. %', 'Incidencia sobre el costo total'), align: 'right', render: (row) => pct(row.displayPct) },
  ];
  const tbl = table({
    columns,
    rows: e.rows,
    rowClass: (row) => (row.amount > 0 ? null : 'row-muted'),
    footer: { label: 'TOTAL', amount: money(e.total), perActiveDay: money(k.costPerActiveDay), displayPct: pct(e.displayTotalPct) },
    caption: 'Estructura de costos por categoría',
    className: 'qr-eecc-table',
  });
  const bars = barList(e.rows.map((row) => ({ label: row.label, value: row.displayPct })));
  return card(header,
    h('div', { class: 'qr-eecc' }, tbl, h('div', { class: 'qr-eecc-bars', 'aria-hidden': 'true' }, bars)),
    note(`Fijos del mes: ${money(k.fixedCosts)} · variables: ${money(k.variableCosts)}. La incidencia se redondea a 2 decimales y suma exactamente 100 %.`));
}

// ----------------------------------------------------- C. matriz + gráfico

/** Ancho de dibujo cuando todavía no se conoce el del contenedor (px). */
const CHART_FALLBACK_WIDTH = 900;
/** Ancho de dibujo al imprimir (A4 vertical con márgenes, aprox. en px CSS). */
const CHART_PRINT_WIDTH = 700;

function niceStep(max, ticks = 4) {
  const raw = max / ticks;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * mag;
}

function pathFrom(points, px, py) {
  let d = '';
  let open = false;
  points.forEach((p) => {
    if (!hasValue(p.y)) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)} `;
    open = true;
  });
  return d.trim();
}

/**
 * Tendencia de la tarifa necesaria al aumentar los días: 'down' | 'up' | 'flat'.
 * Con abono mensual sube (más días = más costo variable, un solo abono).
 */
function rateTrend(points) {
  const valid = points.filter((p) => hasValue(p.d) && hasValue(p.rate)).sort((a, b) => a.d - b.d);
  if (valid.length < 2) return 'flat';
  const first = valid[0].rate;
  const last = valid[valid.length - 1].rate;
  const eps = Math.max(1e-6, Math.abs(first) * 1e-6);
  if (last > first + eps) return 'up';
  if (last < first - eps) return 'down';
  return 'flat';
}

/** Explicación de la tendencia, coherente con la unidad y con los números. */
function trendText(v, trend) {
  const isMonth = v.r.unit === 'month';
  if (trend === 'up') {
    return isMonth
      ? 'Con abono mensual, más días activos suman costo variable y el abono es uno solo: el abono necesario sube con los días.'
      : 'Con estos datos la tarifa necesaria sube con los días: los ingresos fijos ya cubren los costos fijos y cada día extra suma costo variable.';
  }
  if (trend === 'down') return 'A mayor utilización, los costos fijos se reparten entre más días y la tarifa necesaria baja.';
  return 'Con estos datos la tarifa necesaria casi no cambia con los días.';
}

function trendVerb(trend) {
  if (trend === 'up') return 'sube a';
  if (trend === 'down') return 'baja a';
  return 'se mantiene en';
}

/** Datos del gráfico (se calculan una vez; el dibujo depende del ancho). */
function chartData(v) {
  const { r, k } = v;
  const ctx = r.ctx;
  const days = (r.matrix || []).map((row) => row.activeDays).filter((d) => hasValue(d) && d > 0);
  if (!ctx || days.length === 0) return null;
  const target = isValidMarginPct(r.targetMarginPct) ? r.targetMarginPct : 0;
  let x0 = Math.min(...days);
  let x1 = Math.max(...days);
  if (x1 - x0 < 1e-9) {
    x0 = Math.max(0.5, x0 - 1);
    x1 += 1;
  }
  const ratesAt = (d) => {
    const rr = requiredRatesAt(ctx, d, [target]);
    return { floor: rr.floorNetRate, target: rr.byMargin[0] ? rr.byMargin[0].netRate : null };
  };
  const N = 60;
  const samples = [];
  for (let i = 0; i <= N; i += 1) {
    const d = x0 + ((x1 - x0) * i) / N;
    samples.push({ d, ...ratesAt(d) });
  }
  const markers = [...new Set(days)].sort((a, b) => a - b).map((d) => ({ d, ...ratesAt(d), isEstimate: sameNumber(d, k.activeDays) }));
  const commercial = hasValue(k.commercialNetRate) && k.commercialNetRate > 0 ? k.commercialNetRate : null;
  const values = [...samples.flatMap((p) => [p.floor, p.target]), commercial].filter((x) => hasValue(x) && x >= 0);
  const maxVal = values.length ? Math.max(...values) : 0;
  const trend = rateTrend(markers.map((m) => ({ d: m.d, rate: m.floor })));
  return { target, x0, x1, samples, markers, commercial, maxVal, trend, empty: !(maxVal > 0) };
}

/** SVG del gráfico dibujado al ancho real (1 unidad del viewBox = 1 px: el texto se lee a su tamaño). */
function chartSvg(v, data, width) {
  const { k } = v;
  const { target, x0, x1, samples, markers, commercial, maxVal } = data;
  const W = Math.max(280, Math.round(width));
  const narrow = W < 560;
  const H = narrow ? 260 : 300;
  const L = narrow ? 62 : 78;
  const R = narrow ? 14 : 132;
  const T = 18;
  const B = 42;
  const PW = W - L - R;
  const PH = H - T - B;
  const step = niceStep(maxVal);
  const yMax = Math.ceil(maxVal / step - 1e-9) * step || step;
  const px = (d) => L + ((d - x0) / (x1 - x0)) * PW;
  const py = (y) => T + PH - (Math.min(Math.max(y, 0), yMax) / yMax) * PH;

  const grid = [];
  for (let y = 0; y <= yMax + step * 1e-6; y += step) {
    grid.push(s('line', { x1: L, x2: L + PW, y1: py(y).toFixed(1), y2: py(y).toFixed(1), class: 'qr-chart-grid' }));
    grid.push(s('text', { x: L - 8, y: (py(y) + 4).toFixed(1), class: 'qr-chart-tick', 'text-anchor': 'end' }, compactMoney(y)));
  }

  // Rótulos del eje X sin superponerse (el día estimado siempre se rotula).
  const minGap = 26;
  const kept = [];
  markers.forEach((m) => {
    const x = px(m.d);
    const prev = kept[kept.length - 1];
    if (!prev || x - prev.x >= minGap) kept.push({ m, x });
    else if (m.isEstimate) kept[kept.length - 1] = { m, x };
  });
  const xTicks = kept.map(({ m, x }) => s('text', { x: x.toFixed(1), y: T + PH + 18, class: ['qr-chart-tick', m.isEstimate ? 'is-estimate' : null].filter(Boolean).join(' '), 'text-anchor': 'middle' }, formatNumber(m.d, { decimals: 2 })));

  const estimate = hasValue(k.activeDays) && k.activeDays >= x0 && k.activeDays <= x1
    ? [
      s('line', { x1: px(k.activeDays).toFixed(1), x2: px(k.activeDays).toFixed(1), y1: T, y2: T + PH, class: 'qr-chart-estimate' }),
      s('text', { x: (px(k.activeDays) + 4).toFixed(1), y: T + 10, class: 'qr-chart-note' }, 'Estimado'),
    ]
    : [];

  const floorPath = pathFrom(samples.map((p) => ({ x: p.d, y: p.floor })), px, py);
  const targetPath = pathFrom(samples.map((p) => ({ x: p.d, y: p.target })), px, py);
  const lines = [
    floorPath ? s('path', { d: floorPath, class: 'qr-chart-line qr-chart-floor' }) : null,
    targetPath ? s('path', { d: targetPath, class: 'qr-chart-line qr-chart-target' }) : null,
  ];
  const commercialLine = commercial !== null
    ? s('line', { x1: L, x2: L + PW, y1: py(commercial).toFixed(1), y2: py(commercial).toFixed(1), class: 'qr-chart-commercial' })
    : null;

  const dots = markers.flatMap((m) => [
    hasValue(m.floor) ? s('circle', { cx: px(m.d).toFixed(1), cy: py(m.floor).toFixed(1), r: 4, class: 'qr-chart-dot qr-chart-floor-dot' }) : null,
    hasValue(m.target) ? s('circle', { cx: px(m.d).toFixed(1), cy: py(m.target).toFixed(1), r: 4, class: 'qr-chart-dot qr-chart-target-dot' }) : null,
  ]);

  // Rótulos directos al final de cada línea (sólo con lugar y si no se pisan; la leyenda siempre está).
  const last = samples[samples.length - 1];
  const endLabels = narrow ? [] : [
    hasValue(last.floor) ? { y: py(last.floor), text: 'Tarifa piso' } : null,
    hasValue(last.target) ? { y: py(last.target), text: `Margen ${pct(target)}` } : null,
    commercial !== null ? { y: py(commercial), text: 'Tarifa comercial' } : null,
  ].filter(Boolean).sort((a, b) => a.y - b.y);
  const labelNodes = endLabels.filter((lbl, i) => {
    const prev = endLabels[i - 1];
    const next = endLabels[i + 1];
    return (!prev || lbl.y - prev.y >= 13) && (!next || next.y - lbl.y >= 13);
  }).map((lbl) => s('text', { x: L + PW + 8, y: (lbl.y + 4).toFixed(1), class: 'qr-chart-label' }, lbl.text));

  // Zonas de hover (tooltip nativo) por cada día de la matriz.
  const hits = markers.map((m, i) => {
    const left = i > 0 ? (px(markers[i - 1].d) + px(m.d)) / 2 : L;
    const right = i < markers.length - 1 ? (px(markers[i + 1].d) + px(m.d)) / 2 : L + PW;
    const tip = `${formatDays(m.d)}: tarifa piso ${minRate(m.floor, v.unitLabel)} · margen ${pct(target)} ${minRate(m.target, v.unitLabel)}${commercial !== null ? ` · tarifa comercial neta ${rate(commercial, v.unitLabel)}` : ''}`;
    return s('rect', { x: left.toFixed(1), y: T, width: Math.max(1, right - left).toFixed(1), height: PH, class: 'qr-chart-hit' }, s('title', {}, tip));
  });

  const first = markers[0];
  const lastMarker = markers[markers.length - 1];
  const aria = `Gráfico de tarifa necesaria por ${v.unitLabel} según los días activos del mes. `
    + (markers.length > 1
      ? `Con ${formatDays(first.d)} la tarifa piso es ${minRate(first.floor, v.unitLabel)}; con ${formatDays(lastMarker.d)} ${trendVerb(data.trend)} ${minRate(lastMarker.floor, v.unitLabel)}.`
      : `Con ${formatDays(first.d)} la tarifa piso es ${minRate(first.floor, v.unitLabel)}.`)
    + (commercial !== null ? ` Tarifa comercial neta: ${rate(commercial, v.unitLabel)}.` : '');

  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: ['qr-chart-svg', narrow ? 'is-narrow' : null].filter(Boolean).join(' '), role: 'img', 'aria-label': aria, preserveAspectRatio: 'xMidYMid meet' },
    s('title', {}, 'Tarifa necesaria vs días activos'),
    ...grid,
    s('line', { x1: L, x2: L + PW, y1: T + PH, y2: T + PH, class: 'qr-chart-axis' }),
    ...xTicks,
    s('text', { x: L + PW / 2, y: H - 4, class: 'qr-chart-axis-title', 'text-anchor': 'middle' }, 'Días activos por mes'),
    ...estimate,
    commercialLine,
    ...lines,
    ...dots,
    ...labelNodes,
    ...hits);
}

/**
 * Gráfico: tarifa neta necesaria (piso y margen objetivo) vs días activos,
 * con la tarifa comercial neta (actividad estimada) como referencia.
 * El viewBox usa el ancho real del contenedor (ResizeObserver con debounce,
 * desconectado en la limpieza de la vista).
 */
function rateChart(v) {
  const data = chartData(v);
  if (!data) return null;
  if (data.empty) return emptyState('El gráfico aparece cuando haya costos cargados.');

  const canvas = h('div', { class: 'qr-chart-canvas' });
  let drawnWidth = 0;
  const draw = (width) => {
    const w = Math.round(Number(width));
    if (!(w > 0) || Math.abs(w - drawnWidth) < 1) return;
    drawnWidth = w;
    try {
      mount(canvas, chartSvg(v, data, w));
    } catch (error) {
      logger.warn('No se pudo dibujar el gráfico de la matriz', { message: error && error.message });
    }
  };
  // Dibujo inicial (sin ResizeObserver o antes de conocer el ancho real).
  draw(CHART_FALLBACK_WIDTH);
  if (typeof ResizeObserver === 'function') {
    // Nunca se redibuja dentro del callback del observer (cambiaría el tamaño
    // observado en el mismo ciclo): la primera medición va al próximo frame y
    // las siguientes, con debounce.
    const redraw = debounce(() => draw(canvas.clientWidth), CHART_RESIZE_DEBOUNCE_MS);
    const hasFrames = typeof requestAnimationFrame === 'function';
    let frame = null;
    let measured = false;
    const observer = new ResizeObserver(() => {
      if (!measured && hasFrames) {
        measured = true;
        frame = requestAnimationFrame(() => {
          frame = null;
          draw(canvas.clientWidth);
        });
        return;
      }
      redraw();
    });
    observer.observe(canvas);
    v.cleanups.push(() => {
      redraw.cancel();
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      observer.disconnect();
    });
  }
  // Al imprimir, el ancho de la hoja no es el de la pantalla: se dibuja para la hoja y se vuelve después.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const beforePrint = () => draw(CHART_PRINT_WIDTH);
    const afterPrint = () => draw(canvas.clientWidth || CHART_FALLBACK_WIDTH);
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    v.cleanups.push(() => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
    });
  }

  const unitNoun = v.r.unit === 'month' ? 'Abonos netos por mes' : `Tarifas netas por ${v.unitLabel}`;
  const key = (cls, text) => h('span', { class: 'qr-key' }, h('span', { class: ['qr-key-swatch', cls], 'aria-hidden': 'true' }), text);
  return h('figure', { class: 'qr-chart' },
    h('div', { class: 'legend qr-chart-legend' },
      key('qr-key-floor', 'Tarifa piso (no perder dinero)'),
      key('qr-key-target', `${sameNumber(data.target, v.k.targetMarginPct) ? 'Precio objetivo' : 'Tarifa'} (margen ${pct(data.target)})`),
      data.commercial !== null ? key('qr-key-commercial', 'Tarifa comercial neta (actividad estimada)') : null),
    canvas,
    h('figcaption', { class: 'qr-note' }, `${unitNoun}. ${trendText(v, data.trend)}`));
}

function matrixRates(v, row) {
  try {
    return v.r.ctx ? requiredRatesAt(v.r.ctx, row.activeDays, []) : null;
  } catch {
    return null;
  }
}

function traceMatrixRow(v, row, rr) {
  return createTrace({
    id: 'matrix_row',
    title: `Tarifas necesarias con ${formatDays(row.activeDays)} activos`,
    formula: 'Tarifa necesaria(D, margen) = (Costo(D) / (1 − margen) − Otros ingresos(D)) / Unidades facturables(D)',
    inputs: [
      { label: 'Días activos', value: row.activeDays, format: 'days' },
      { label: 'Utilización', value: row.utilizationPct, format: 'percent' },
      { label: 'Costo total del mes', value: row.cost, format: 'money' },
      { label: 'Otros ingresos', value: rr ? rr.otherRevenue : null, format: 'money' },
      { label: `Unidades facturables (${v.unitLabel})`, value: rr ? rr.billableUnits : null, format: 'number' },
    ],
    steps: (row.byMargin || []).map((m) => ({ label: `Tarifa neta con margen ${pct(m.marginPct)}`, value: m.netRate, format: 'moneyCeil' })),
    result: { label: 'Tarifa piso neta (break-even)', value: row.floorNetRate, format: 'moneyCeil' },
    notes: [
      row.exceedsAvailability ? 'Estos días superan los disponibles del mes: se interpretan como trabajo de más de un mes.' : null,
      'Las tarifas mínimas se muestran redondeadas hacia arriba al peso.',
    ],
  });
}

function traceMatrixResult(v, row, ev) {
  const revenue = (ev && ev.revenue) || {};
  return createTrace({
    id: 'matrix_result',
    title: `Resultado con ${formatDays(row.activeDays)} activos`,
    formula: 'Resultado = Facturación − Costo total · Facturación = Tarifa neta × Unidades facturables + Otros ingresos · Margen = Resultado / Facturación',
    inputs: [
      { label: 'Tarifa comercial de lista', value: v.k.commercialListRate, format: 'money' },
      { label: 'Descuento por tramo con estos días', value: row.tierDiscountPct, format: 'percent' },
      { label: 'Tarifa neta (después de descuentos)', value: revenue.netRate, format: 'money' },
      { label: `Unidades facturables (${v.unitLabel})`, value: revenue.billableUnits, format: 'number' },
      { label: 'Otros ingresos', value: revenue.otherRevenue, format: 'money' },
      { label: 'Costo total del mes', value: row.cost, format: 'money' },
    ],
    steps: [{ label: 'Facturación del mes', value: row.revenue, format: 'money' }],
    result: { label: 'Resultado del mes', value: row.profit, format: 'money' },
    notes: [
      hasValue(row.marginPct) ? `Margen sobre precio: ${pct(row.marginPct)}.` : 'Sin facturación no hay margen.',
      row.exceedsAvailability ? 'Estos días superan los disponibles del mes: se interpretan como trabajo de más de un mes.' : null,
    ],
  });
}

function daysCell(v, row, trace) {
  const tags = [
    row.isEstimate ? badge('estimado', 'blue') : null,
    row.exceedsAvailability ? badge('supera disponibles', 'orange', { title: 'Más días que los disponibles del mes' }) : null,
  ].filter(Boolean);
  return h('span', { class: 'qr-days-cell' },
    h('span', { class: 'qr-days-line' },
      h('span', { class: 'qr-days-num' }, formatDays(row.activeDays)),
      trace ? iconTraceButton(trace) : null),
    tags.length ? h('span', { class: 'qr-days-tags' }, ...tags) : null);
}

function renderMatrix(v) {
  const { r, k } = v;
  const rows = Array.isArray(r.matrix) ? r.matrix : [];
  const margins = rows.length ? (rows[0].byMargin || []).map((m) => m.marginPct) : [];
  const rateOk = hasRate(k);
  const isMonth = r.unit === 'month';
  const rowClass = (row) => [row.isEstimate ? 'row-highlight' : null, row.exceedsAvailability ? 'qr-row-exceeds' : null].filter(Boolean).join(' ') || null;
  // Un nodo por tabla (un mismo nodo no puede estar en dos lugares del DOM).
  const daysHeader = () => abbrHeader('Días activos', 'Días activos por mes');

  // Tabla 1: tarifas NECESARIAS (netas) por cantidad de días.
  const ratesColumns = [
    { key: 'activeDays', label: daysHeader(), className: 'qr-sticky-col', render: (row) => daysCell(v, row, traceMatrixRow(v, row, matrixRates(v, row))) },
    { key: 'utilizationPct', label: abbrHeader('Utiliz.', 'Utilización: días activos sobre días disponibles del mes'), align: 'right', render: (row) => pct(row.utilizationPct, 1) },
    { key: 'floor', label: abbrHeader('Piso', 'Tarifa piso neta (break-even): no perder dinero', 'break-even'), align: 'right', render: (row) => ceilMoney(row.floorNetRate) },
    ...margins.map((m, idx) => ({
      key: `m${idx}`,
      label: marginHeader(v, m),
      align: 'right',
      render: (row) => ceilMoney(row.byMargin && row.byMargin[idx] ? row.byMargin[idx].netRate : null),
    })),
  ];

  // Tabla 2: qué pasa con TU tarifa comercial en cada cantidad de días.
  let resultTable = null;
  if (rateOk) {
    const evals = new Map();
    const evalOf = (row) => {
      if (!evals.has(row)) {
        let ev = null;
        try {
          ev = r.ctx ? evaluateAt(r.ctx, row.activeDays, k.commercialListRate) : null;
        } catch {
          ev = null;
        }
        evals.set(row, ev);
      }
      return evals.get(row);
    };
    const resultColumns = [
      { key: 'activeDays', label: daysHeader(), className: 'qr-sticky-col', render: (row) => daysCell(v, row, traceMatrixResult(v, row, evalOf(row))) },
      { key: 'netRate', label: abbrHeader('Tarifa neta', 'Tu tarifa comercial neta con esos días (después de descuentos)'), align: 'right', render: (row) => { const ev = evalOf(row); return money(ev && ev.revenue ? ev.revenue.netRate : null); } },
      { key: 'revenue', label: abbrHeader('Facturación', 'Facturación del mes'), align: 'right', render: (row) => money(row.revenue) },
      { key: 'cost', label: abbrHeader('Costo', 'Costo total del mes'), align: 'right', render: (row) => money(row.cost) },
      {
        key: 'profit',
        label: abbrHeader('Resultado', 'Resultado del mes (facturación − costo)'),
        align: 'right',
        render: (row) => h('span', { class: hasValue(row.profit) ? (row.profit < -1e-6 ? 'qr-neg' : 'qr-pos') : null }, money(row.profit)),
      },
      { key: 'marginPct', label: abbrHeader('Margen', 'Margen sobre el precio de venta'), align: 'right', render: (row) => pct(row.marginPct) },
    ];
    resultTable = table({ columns: resultColumns, rows, rowClass, caption: 'Resultado con la tarifa comercial según los días activos', className: 'qr-matrix qr-matrix-result', emptyText: 'Sin días para evaluar.' });
  }

  let chart = null;
  try {
    chart = rateChart(v);
  } catch (error) {
    logger.warn('No se pudo dibujar el gráfico de la matriz', { message: error && error.message });
  }
  const trend = rateTrend(rows.map((row) => ({ d: row.activeDays, rate: row.floorNetRate })));
  const unitNoun = isMonth ? 'Abonos netos por mes' : `Tarifas netas por ${v.unitLabel}`;
  return card(
    {
      title: 'Matriz tarifa × utilización',
      subtitle: `¿Qué tarifa necesitás según cuántos días del mes trabaje y facture el equipo? ${isMonth ? 'Abonos por mes.' : `Tarifas por ${v.unitLabel}.`}`,
      className: 'qr-card qr-card-wide',
      id: v.ids.matrix,
    },
    h('h4', { class: 'qr-subhead' }, 'Tarifas necesarias'),
    table({ columns: ratesColumns, rows, rowClass, caption: 'Matriz tarifa por utilización: tarifas necesarias', className: 'qr-matrix qr-matrix-rates', emptyText: 'Sin días para evaluar.' }),
    note(`${unitNoun}, después de descuentos y redondeadas hacia arriba. ${trendText(v, trend)} El ícono junto a cada fila muestra el cálculo.`),
    h('h4', { class: 'qr-subhead' }, rateOk ? `Resultado con tu tarifa comercial (${commercialRate(k, v.unitLabel)} de lista)` : 'Resultado con tu tarifa comercial'),
    rateOk
      ? resultTable
      : banner('Definí una tarifa comercial para ver facturación, resultado y margen de cada fila.', 'info'),
    rows.some((row) => row.exceedsAvailability) ? note('Las filas marcadas "supera disponibles" tienen más días activos que los disponibles del mes.') : null,
    chart,
  );
}

// -------------------------------------------------- D. margen vs markup

function renderMarginMarkup(v) {
  const { r, k, settings } = v;
  const ladderBase = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const margins = [...new Set([...ladderBase, r.targetMarginPct].filter((m) => isValidMarginPct(m) && m > 0))].sort((a, b) => a - b);
  const ladder = priceLadder(k.totalCost, margins, r.customMarginPct);
  const cost = k.totalCost;
  const columns = [
    { key: 'label', label: 'Nivel', render: (row) => (row.key === 'floor' ? 'Tarifa piso (margen 0)' : marginLabel(v, row.marginPct)) },
    { key: 'marginPct', label: 'Margen (sobre precio)', align: 'right', render: (row) => pct(row.marginPct) },
    { key: 'markupPct', label: 'Markup equivalente (sobre costo)', align: 'right', render: (row) => pct(row.markupPct) },
    { key: 'price', label: 'Facturación mensual necesaria', align: 'right', render: (row) => money(row.price) },
    { key: 'gain', label: 'Ganancia del mes', align: 'right', render: (row) => money(hasValue(row.price) && hasValue(cost) ? row.price - cost : null) },
  ];
  const example = traceMarginVsMarkup(100, 10);
  return card(
    {
      title: 'Margen vs markup',
      subtitle: 'No son lo mismo: el margen se mide sobre el precio de venta; el markup, sobre el costo.',
      className: 'qr-card',
      id: v.ids.markup,
    },
    h('div', { class: 'qr-split' },
      h('div', { class: 'qr-split-main' },
        cost > 0
          ? table({ columns, rows: ladder, rowClass: (row) => (sameNumber(row.marginPct, r.targetMarginPct) ? 'row-highlight' : null), caption: 'Escalera de precios por margen', className: 'qr-ladder' })
          : emptyState('Cargá costos para ver la escalera de precios.'),
        cost > 0 ? note(`Calculado sobre el costo total del mes (${money(cost)}). Tu margen objetivo de ${pct(r.targetMarginPct)} equivale a un markup de ${pct(marginToMarkup(r.targetMarginPct))}.`) : null),
      h('aside', { class: 'qr-example' },
        h('div', { class: 'qr-example-title' }, 'Ejemplo con costo $ 100'),
        h('ul', { class: 'qr-example-list' },
          h('li', {}, h('strong', {}, 'Margen 10 %'), ` → precio ${formatMoney(100 / 0.9, { decimals: 2 })}. Ganás ${formatMoney(100 / 0.9 - 100, { decimals: 2 })}, que es el 10 % del precio.`),
          h('li', {}, h('strong', {}, 'Markup 10 %'), ` → precio ${formatMoney(110, { decimals: 2 })}. Ganás ${formatMoney(10, { decimals: 2 })}: el 10 % del costo, pero sólo ${pct((10 / 110) * 100)} del precio.`)),
        note('Si confundís uno con otro, cotizás por debajo del margen que buscabas.'),
        traceBtn(example))),
  );
}

// ---------------------------------------------------- E. descuentos

function traceDiscountRow(v, row) {
  return createTrace({
    id: 'discount_tier',
    title: `Tramo ${row.label}`,
    formula: 'Tarifa neta = Tarifa de lista × (1 − descuento del tramo) × (1 − continuidad) × (1 − descuento comercial)',
    inputs: [
      { label: 'Tarifa de lista', value: row.listRate, format: 'money' },
      { label: 'Descuento del tramo', value: row.discountPct, format: 'percent' },
      { label: 'Días evaluados (peor caso del tramo)', value: row.evaluatedDays, format: 'days' },
      { label: 'Tarifa piso neta con esos días', value: row.floorNetRate, format: 'moneyCeil' },
      { label: 'Precio objetivo neto con esos días', value: row.targetNetRate, format: 'moneyCeil' },
    ],
    steps: [
      { label: 'Resultado del mes con esos días', value: row.profit, format: 'money' },
      { label: 'Margen', value: row.marginPct, format: 'percent' },
    ],
    result: { label: 'Tarifa neta', value: row.netRate, format: 'money' },
    notes: [
      `Estado: ${(DISCOUNT_STATUS[row.status] || DISCOUNT_STATUS.unknown).text}.`,
      'Verde: la tarifa neta alcanza el precio objetivo. Naranja: cubre la tarifa piso pero no el objetivo. Rojo: no cubre la tarifa piso.',
    ],
  });
}

function continuityBlock(v) {
  const c = v.r.continuity || {};
  let content;
  if (!(c.discountPct > 0)) {
    content = h('p', {}, 'No hay descuento por continuidad configurado.');
  } else if (c.applies) {
    const st = DISCOUNT_STATUS[c.status] || null;
    content = h('p', {},
      `Aplica un descuento de ${pct(c.discountPct)} porque el contrato dura ${formatNumber(c.contractMonths)} meses (mínimo ${formatNumber(c.minMonths)}). `,
      st ? statusDot(st.tone, `Con la actividad estimada: ${st.text.toLowerCase()}.`) : null);
  } else {
    content = h('p', {}, `No aplica: el contrato dura ${formatNumber(c.contractMonths)} meses y el descuento de ${pct(c.discountPct)} exige al menos ${formatNumber(c.minMonths)}.`);
  }
  return h('div', { class: 'qr-continuity' }, h('h4', {}, 'Descuento por continuidad'), content);
}

function renderDiscounts(v) {
  const { r, k } = v;
  const rows = Array.isArray(r.discounts) ? r.discounts : [];
  const legend = h('div', { class: 'legend qr-legend' },
    statusDot('green', 'Verde: mantiene el margen objetivo'),
    statusDot('orange', 'Naranja: debajo del margen objetivo'),
    statusDot('red', 'Rojo: debajo de break-even (perdés dinero)'));
  let body;
  if (r.unit === 'month') {
    body = note('Con abono mensual no se aplican descuentos por cantidad de días.');
  } else if (!rows.length) {
    body = emptyState(hasRate(k) ? 'No hay tramos de descuento configurados.' : 'Definí una tarifa comercial para evaluar los descuentos por días.');
  } else {
    body = table({
      columns: [
        {
          key: 'label',
          label: 'Tramo',
          render: (row) => h('span', { class: 'qr-days-cell' },
            h('span', { class: 'qr-days-line' }, h('span', { class: 'qr-days-num' }, row.label), iconTraceButton(traceDiscountRow(v, row))),
            row.exceedsAvailability ? h('span', { class: 'qr-days-tags' }, badge('supera disponibles', 'orange')) : null),
        },
        { key: 'evaluatedDays', label: abbrHeader('Días eval.', 'Días evaluados: el peor caso del tramo (su primer día)', 'peor caso'), align: 'right', render: (row) => formatDays(row.evaluatedDays) },
        { key: 'discountPct', label: abbrHeader('Desc.', 'Descuento del tramo'), align: 'right', render: (row) => pct(row.discountPct) },
        { key: 'netRate', label: abbrHeader('Neta', 'Tarifa neta: tarifa de lista menos descuentos'), align: 'right', render: (row) => money(row.netRate) },
        { key: 'floorNetRate', label: abbrHeader('Piso', 'Tarifa piso neta con esos días'), align: 'right', render: (row) => ceilMoney(row.floorNetRate) },
        { key: 'targetNetRate', label: abbrHeader('Objetivo', 'Precio objetivo neto con esos días'), align: 'right', render: (row) => ceilMoney(row.targetNetRate) },
        { key: 'marginPct', label: abbrHeader('Margen', 'Margen sobre el precio de venta'), align: 'right', render: (row) => pct(row.marginPct) },
        {
          key: 'status',
          label: 'Estado',
          className: 'qr-status-col',
          render: (row) => {
            const st = DISCOUNT_STATUS[row.status] || DISCOUNT_STATUS.unknown;
            return h('span', { class: 'qr-status', title: st.text }, statusDot(st.tone, st.short), h('span', { class: 'sr-only' }, `: ${st.text}`));
          },
        },
      ],
      rows,
      caption: 'Descuentos por cantidad de días',
      className: 'qr-discounts',
    });
  }
  return card(
    {
      title: 'Descuentos por días / volumen',
      subtitle: '¿Cada descuento sigue dejando ganancia? Se evalúa el peor caso de cada tramo: su primer día.',
      className: 'qr-card',
      id: v.ids.discounts,
    },
    rows.length ? legend : null,
    body,
    rows.length ? note(`Tarifas netas por ${v.unitLabel}. El tramo "1 día" muestra qué pasa si en el mes sólo se trabaja un día: los costos fijos recaen en ese único día. El ícono junto a cada tramo muestra el cálculo.`) : null,
    continuityBlock(v),
  );
}

// ---------------------------------------------------- F. sensibilidad

function sliderStateFor(quoteId) {
  const key = String(quoteId || 'sin-id');
  if (!sliderMemory.has(key)) {
    if (sliderMemory.size >= SLIDER_MEMORY_LIMIT) sliderMemory.delete(sliderMemory.keys().next().value);
    sliderMemory.set(key, { ...ZERO_DELTAS });
  }
  const state = sliderMemory.get(key);
  SENSITIVITY_VARIABLES.forEach((meta) => {
    const range = SENSITIVITY_RANGES[meta.id];
    const value = Number(state[meta.id]);
    state[meta.id] = Number.isFinite(value) && range ? Math.min(range.max, Math.max(range.min, value)) : 0;
  });
  return state;
}

const SENS_METRICS = Object.freeze([
  { key: 'totalCost', label: 'Costo total del mes', kind: 'money', better: 'down' },
  { key: 'floorNetRate', label: 'Tarifa piso (neta)', kind: 'rate', better: 'down' },
  { key: 'targetNetRate', label: 'Precio objetivo (neto)', kind: 'rate', better: 'down' },
  { key: 'marginPct', label: 'Margen', kind: 'percent', better: 'up' },
  { key: 'profit', label: 'Resultado del mes', kind: 'money', better: 'up' },
  { key: 'breakEvenDays', label: 'Break-even (días mínimos para no perder)', kind: 'days', better: 'down' },
  { key: 'activeDays', label: 'Días activos', kind: 'days', better: null },
  { key: 'revenue', label: 'Facturación del mes', kind: 'money', better: 'up' },
]);

function sensValue(kind, value, unitLabel) {
  if (kind === 'money') return money(value);
  if (kind === 'rate') return minRate(value, unitLabel);
  if (kind === 'percent') return pct(value);
  if (kind === 'days') return formatDays(value);
  return formatNumber(value, { decimals: 2 });
}

function sensDelta(kind, value) {
  if (kind === 'money' || kind === 'rate') return signedMoney(value);
  if (kind === 'percent') return signedPoints(value);
  if (kind === 'days') return signedDays(value);
  return signed(value, (x) => formatNumber(x, { decimals: 2 }));
}

function deltaTone(better, value) {
  if (!better || !hasValue(value) || Math.abs(value) < 1e-6) return null;
  const up = value > 0;
  return (better === 'up') === up ? 'good' : 'bad';
}

function sensitivityRows(v, res) {
  return SENS_METRICS.map((m) => {
    const base = res.base[m.key];
    const scen = res.scenario[m.key];
    const delta = res.delta[m.key];
    const tone = deltaTone(m.better, delta);
    return h('tr', { class: tone === 'bad' ? 'qr-row-bad' : null },
      h('th', { scope: 'row', class: 'qr-sens-metric' }, m.label),
      h('td', { class: 'ta-right', 'data-label': 'Base' }, sensValue(m.kind, base, v.unitLabel)),
      h('td', { class: 'ta-right', 'data-label': 'Escenario' }, sensValue(m.kind, scen, v.unitLabel)),
      h('td', { class: ['ta-right', tone ? `qr-delta-${tone}` : null], 'data-label': 'Diferencia' }, sensDelta(m.kind, delta)));
  });
}

function traceSensitivity(v, state, res) {
  return createTrace({
    id: 'sensitivity',
    title: 'Sensibilidad (tarifa comercial fija)',
    formula: 'Escenario = misma cotización con las variaciones aplicadas · la tarifa comercial de lista se mantiene fija',
    inputs: [
      ...SENSITIVITY_VARIABLES.map((meta) => ({ label: meta.label, value: sliderText(meta, state[meta.id]), format: 'text' })),
      { label: 'Tarifa comercial fija (lista)', value: res ? res.listRate : null, format: 'money' },
    ],
    steps: res
      ? [
        { label: 'Costo total base', value: res.base.totalCost, format: 'money' },
        { label: 'Costo total escenario', value: res.scenario.totalCost, format: 'money' },
        { label: 'Resultado base', value: res.base.profit, format: 'money' },
        { label: 'Resultado escenario', value: res.scenario.profit, format: 'money' },
      ]
      : [],
    result: { label: 'Diferencia de resultado', value: res ? res.delta.profit : null, format: 'money' },
    notes: [
      'Salarios: varía básico y adicionales del personal. Combustible: precio por litro. Materiales: costo unitario.',
      'Utilización: días activos (un aumento no supera los disponibles, salvo que la base ya los supere; en 0 no cambia nada). Plazo de pago: días que tarda en cobrar. Descuento comercial: puntos adicionales.',
      'Con todas las variaciones en 0 el escenario es idéntico a la base.',
    ],
  });
}

function tornado(low, high, maxAbs) {
  const bar = (value, kind) => {
    if (!hasValue(value) || !(maxAbs > 0) || Math.abs(value) < 1e-6) return h('div', { class: 'qr-tornado-row' });
    const w = Math.min(50, (Math.abs(value) / maxAbs) * 50);
    const left = value < 0 ? 50 - w : 50;
    return h('div', { class: 'qr-tornado-row' },
      h('span', { class: ['qr-tornado-bar', value < 0 ? 'is-neg' : 'is-pos', `is-${kind}`], style: { left: `${left.toFixed(2)}%`, width: `${w.toFixed(2)}%` } }));
  };
  return h('div', { class: 'qr-tornado', 'aria-hidden': 'true' }, h('span', { class: 'qr-tornado-axis' }), bar(low, 'low'), bar(high, 'high'));
}

function impactTable(v, rows) {
  const maxAbs = Math.max(0, ...rows.flatMap((row) => [row.profitDeltaLow, row.profitDeltaHigh]).filter(hasValue).map(Math.abs));
  const sorted = rows.slice().sort((a, b) => {
    const ia = Math.max(...[a.profitDeltaLow, a.profitDeltaHigh].filter(hasValue).map(Math.abs), 0);
    const ib = Math.max(...[b.profitDeltaLow, b.profitDeltaHigh].filter(hasValue).map(Math.abs), 0);
    return ib - ia;
  });
  const toneOf = (value) => (hasValue(value) && Math.abs(value) >= 1e-6 ? (value > 0 ? 'qr-delta-good' : 'qr-delta-bad') : null);
  const stepText = (row) => {
    const meta = SENSITIVITY_VARIABLES.find((m) => m.id === row.variable) || { unit: '' };
    return `± ${sliderText(meta, row.step).replace(/^\+/, '')}`;
  };
  return table({
    columns: [
      { key: 'label', label: 'Variable' },
      { key: 'step', label: abbrHeader('Variación', 'Variación evaluada'), align: 'right', render: (row) => stepText(row) },
      { key: 'low', label: abbrHeader('Si baja', 'Cambio del resultado si la variable baja'), align: 'right', render: (row) => h('span', { class: toneOf(row.profitDeltaLow) }, row.low ? signedMoney(row.profitDeltaLow) : 'No aplica') },
      { key: 'high', label: abbrHeader('Si sube', 'Cambio del resultado si la variable sube'), align: 'right', render: (row) => h('span', { class: toneOf(row.profitDeltaHigh) }, row.high ? signedMoney(row.profitDeltaHigh) : 'No aplica') },
      { key: 'bar', label: 'Impacto relativo', render: (row) => tornado(row.profitDeltaLow, row.profitDeltaHigh, maxAbs) },
    ],
    rows: sorted,
    caption: 'Impacto de cada variable en el resultado del mes',
    className: 'qr-impact',
  });
}

function renderSensitivity(v) {
  const { q, settings, k } = v;
  const state = sliderStateFor(q.id);
  const tbody = h('tbody');
  const summary = h('p', { class: 'qr-sens-summary', role: 'status', 'aria-live': 'polite' });
  const activityHint = h('span', { class: 'qr-slider-extra' });
  const errorBox = banner('No se pudo recalcular el escenario con estos valores.', 'warning');
  errorBox.hidden = true;
  let lastResult = null;
  const outputs = new Map();
  const inputs = new Map();

  const recompute = () => {
    let res;
    try {
      res = runSensitivity(q, { ...state }, { settings });
    } catch (error) {
      logger.warn('No se pudo recalcular la sensibilidad', { message: error && error.message });
      errorBox.hidden = false;
      return;
    }
    errorBox.hidden = true;
    lastResult = res;
    mount(tbody, ...sensitivityRows(v, res));
    const changed = SENSITIVITY_VARIABLES.some((meta) => state[meta.id] !== 0);
    // Con todo en 0 el motor devuelve exactamente la base: se verifica en vez de suponerlo.
    const identical = SENS_METRICS.every((m) => !hasValue(res.delta[m.key]) || Math.abs(res.delta[m.key]) < 1e-6);
    let text;
    if (changed) {
      text = `Resultado del escenario: ${money(res.scenario.profit)} (${signedMoney(res.delta.profit)} contra la base).${hasValue(res.scenario.marginPct) ? ` Margen: ${pct(res.scenario.marginPct)}.` : ''}`;
    } else if (identical) {
      text = 'Mové un control para ver el impacto. Con todo en 0 el escenario es idéntico a la base.';
    } else {
      text = `Con todo en 0 el escenario difiere de la base (${signedMoney(res.delta.profit)}): revisá los datos de actividad.`;
      logger.warn('La sensibilidad sin variaciones no coincide con la base');
    }
    mount(summary, text);
    activityHint.textContent = `Días activos en el escenario: ${formatDays(res.scenario.activeDays)}.`;
  };
  const scheduled = debounce(recompute, SENSITIVITY_DEBOUNCE_MS);
  const trackers = new Map();
  const trackChange = (variableId) => {
    if (!trackers.has(variableId)) {
      trackers.set(variableId, debounce(() => track('scenario_changed', { variable: TRACK_VARIABLE[variableId] || 'unknown' }), TRACK_DEBOUNCE_MS));
    }
    trackers.get(variableId)();
  };
  v.cleanups.push(() => {
    scheduled.cancel();
    trackers.forEach((fn) => fn.cancel());
  });

  const sliders = SENSITIVITY_VARIABLES.map((meta) => {
    const range = SENSITIVITY_RANGES[meta.id] || { min: -50, max: 50, step: 1 };
    const id = uniqueId('qr-sens');
    const output = h('output', { class: 'qr-slider-value', for: id }, sliderText(meta, state[meta.id]));
    const input = h('input', {
      type: 'range',
      id,
      name: `qr-sens-${meta.id}`,
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
      value: String(state[meta.id]),
      class: 'qr-range',
      'aria-valuetext': sliderText(meta, state[meta.id]),
      'aria-describedby': `${id}-hint`,
      'data-what-if': 'true',
      on: {
        input: () => {
          const value = Number(input.value);
          state[meta.id] = Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : 0;
          const text = sliderText(meta, state[meta.id]);
          output.textContent = text;
          input.setAttribute('aria-valuetext', text);
          scheduled();
          trackChange(meta.id);
        },
        change: () => scheduled.flush(),
      },
    });
    outputs.set(meta.id, output);
    inputs.set(meta.id, input);
    return h('div', { class: 'qr-slider' },
      h('div', { class: 'qr-slider-head' }, h('label', { class: 'field-label', for: id }, meta.label), output),
      input,
      h('div', { class: 'qr-slider-scale', 'aria-hidden': 'true' }, h('span', {}, sliderText(meta, range.min)), h('span', {}, sliderText(meta, range.max))),
      h('div', { class: 'field-hint', id: `${id}-hint` }, SLIDER_HINTS[meta.id] || '', meta.id === 'activityPct' ? ' ' : null, meta.id === 'activityPct' ? activityHint : null));
  });

  const reset = button('Restablecer', {
    variant: 'secondary',
    size: 'sm',
    onClick: () => {
      SENSITIVITY_VARIABLES.forEach((meta) => {
        state[meta.id] = 0;
        const input = inputs.get(meta.id);
        const output = outputs.get(meta.id);
        if (input) {
          input.value = '0';
          input.setAttribute('aria-valuetext', sliderText(meta, 0));
        }
        if (output) output.textContent = sliderText(meta, 0);
      });
      scheduled.cancel();
      recompute();
    },
    attrs: { 'data-what-if': 'true' },
  });

  recompute();

  let impact = null;
  try {
    impact = impactTable(v, sensitivityTable(q, { settings }));
  } catch (error) {
    logger.warn('No se pudo calcular la tabla de impacto', { message: error && error.message });
    impact = banner('No se pudo calcular la tabla de impacto.', 'warning');
  }

  return card(
    {
      title: 'Sensibilidad',
      subtitle: '¿Qué pasa si cambian los costos, la actividad o las condiciones? La tarifa comercial se mantiene fija para ver el impacto real.',
      actions: [lazyTraceButton(() => traceSensitivity(v, state, lastResult), 'Sensibilidad (tarifa comercial fija)'), reset],
      className: 'qr-card qr-card-wide',
      id: v.ids.sensitivity,
    },
    !hasRate(k) ? banner('Sin tarifa comercial el resultado y el margen no se pueden sensibilizar: se muestran costos y tarifas necesarias.', 'info') : null,
    errorBox,
    h('div', { class: 'qr-sens' },
      h('div', { class: 'qr-sliders no-print', role: 'group', 'aria-label': 'Variables de sensibilidad' }, ...sliders),
      h('div', { class: 'qr-sens-result' },
        summary,
        h('div', { class: 'table-wrap' },
          h('table', { class: 'table qr-sens-table' },
            h('caption', { class: 'sr-only' }, 'Comparación base contra escenario'),
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Indicador'),
              h('th', { scope: 'col', class: 'ta-right' }, 'Base'),
              h('th', { scope: 'col', class: 'ta-right' }, 'Escenario'),
              h('th', { scope: 'col', class: 'ta-right' }, 'Diferencia'))),
            tbody)),
        note('La tarifa comercial se mantiene fija para ver el impacto real de cada cambio.'))),
    h('h4', {}, 'Impacto de cada variable por separado'),
    note('Efecto en el resultado del mes de mover una sola variable hacia abajo o hacia arriba (ordenado de mayor a menor impacto). En las barras, la clara es "si baja" y la fuerte "si sube"; verde mejora el resultado y rojo lo empeora.'),
    impact,
  );
}

// ------------------------------------------------------- G. escenarios

function describeScenario(deltas) {
  if (!deltas) return 'Tus datos tal como están cargados.';
  const parts = [];
  const add = (key, label, unit) => {
    if (!(key in deltas)) return;
    const value = Number(deltas[key]);
    if (!Number.isFinite(value) || value === 0) {
      if (key === 'paymentTermDays') parts.push(`${label} sin cambios`);
      return;
    }
    parts.push(`${label} ${value > 0 ? '+' : '-'}${formatNumber(Math.abs(value), { decimals: 2 })} ${unit}`);
  };
  add('activityPct', 'actividad', '%');
  add('salariesPct', 'salarios', '%');
  add('fuelPct', 'combustible', '%');
  add('materialsPct', 'materiales', '%');
  add('paymentTermDays', 'plazo de pago', 'días');
  add('commercialDiscountPct', 'descuento comercial', 'puntos');
  if (!parts.length) return 'Sin variaciones.';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function renderScenarios(v) {
  const { q, settings } = v;
  const config = settings.scenarios || DEFAULT_SCENARIOS;
  const list = runScenarios(q, { settings });
  const byId = Object.fromEntries(list.map((sc) => [sc.id, sc]));
  const order = ['pessimistic', 'base', 'optimistic'].filter((id) => byId[id]);
  const metrics = [
    { label: 'Ventas (facturación del mes)', get: (sc) => money(sc.revenue) },
    { label: 'Costos del mes', get: (sc) => money(sc.totalCost) },
    { label: 'Margen', get: (sc) => pct(sc.marginPct) },
    { label: 'Resultado', get: (sc) => h('span', { class: hasValue(sc.profit) && hasValue(sc.commercialListRate) ? (sc.profit < -1e-6 ? 'qr-neg' : 'qr-pos') : null }, money(sc.profit)) },
    { label: 'Utilización', get: (sc) => `${pct(sc.utilizationPct, 1)} (${formatDays(sc.activeDays)})` },
    { label: 'Tarifa efectiva por día activo', get: (sc) => money(sc.effectiveRatePerActiveDay) },
    { label: 'Break-even', get: (sc) => formatDays(sc.breakEvenDays) },
  ];
  const tbl = h('div', { class: 'table-wrap' },
    h('table', { class: 'table qr-scenarios' },
      h('caption', { class: 'sr-only' }, 'Escenarios pesimista, base y optimista'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Indicador'), ...order.map((id) => h('th', { scope: 'col', class: ['ta-right', id === 'base' ? 'qr-col-base' : null] }, byId[id].label)))),
      h('tbody', {}, ...metrics.map((m) => h('tr', {},
        h('th', { scope: 'row', class: 'qr-sens-metric' }, m.label),
        ...order.map((id) => h('td', { class: ['ta-right', id === 'base' ? 'qr-col-base' : null], 'data-label': byId[id].label }, m.get(byId[id]))))))));
  const assumptions = h('ul', { class: 'qr-assumptions' },
    h('li', {}, h('strong', {}, 'Pesimista: '), describeScenario(config.pessimistic)),
    h('li', {}, h('strong', {}, 'Base: '), describeScenario(null)),
    h('li', {}, h('strong', {}, 'Optimista: '), describeScenario(config.optimistic)));
  const trace = createTrace({
    id: 'scenarios',
    title: 'Escenarios pesimista / base / optimista',
    formula: 'Cada escenario recalcula la cotización con sus variaciones · la tarifa comercial de lista se mantiene fija · Tarifa efectiva = Facturación / Días activos',
    inputs: order.map((id) => ({ label: byId[id].label, value: describeScenario(byId[id].deltas), format: 'text' })),
    steps: order.map((id) => ({ label: `Resultado ${byId[id].label.toLowerCase()}`, value: byId[id].profit, format: 'money' })),
    result: { label: 'Rango de resultado (optimista − pesimista)', value: byId.optimistic && byId.pessimistic ? byId.optimistic.profit - byId.pessimistic.profit : null, format: 'money' },
  });
  return card(
    {
      title: 'Escenarios',
      subtitle: 'Pesimista, base y optimista con la misma tarifa comercial.',
      actions: [traceBtn(trace)],
      className: 'qr-card',
      id: v.ids.scenarios,
    },
    tbl,
    h('h4', {}, 'Supuestos de cada escenario'),
    assumptions,
    note('Un aumento de actividad no supera los días disponibles del mes (si la base ya los supera, no se recorta). Sin variaciones, el escenario es idéntico a la base.'),
  );
}

// ----------------------------------------- H. comparador de modelos comerciales

/** Parámetros de cada modelo: montos calibrados para el margen objetivo (mínimos → hacia arriba). */
function modelParams(params = {}) {
  const items = [];
  if ('availabilityFee' in params) items.push(`Fee de disponibilidad: ${ceilMoney(params.availabilityFee)} / mes`);
  if ('minimumGuarantee' in params) items.push(`Mínimo garantizado: ${ceilMoney(params.minimumGuarantee)} / mes`);
  if ('packagePrice' in params) items.push(`Paquete mensual: ${ceilMoney(params.packagePrice)}`);
  if ('includedDays' in params) items.push(`Días incluidos: ${formatDays(params.includedDays)}`);
  if ('ratePerDay' in params) items.push(`Tarifa por día: ${ceilMoney(params.ratePerDay)}`);
  if ('excessRatePerDay' in params) items.push(`Excedente por día: ${ceilMoney(params.excessRatePerDay)}`);
  return items;
}

function renderComparator(v) {
  const { q, settings, k } = v;
  const header = {
    title: 'Comparador de modelos comerciales',
    subtitle: 'Información objetiva para decidir, no una recomendación automática.',
    className: 'qr-card qr-card-wide',
    id: v.ids.models,
  };
  if (!(k.totalCost > 0)) return card(header, emptyState('Cargá costos para comparar modelos comerciales.'));
  const cmp = compareCommercialModels(q, { settings });
  if (!cmp.models || !cmp.models.length) return card(header, emptyState(cmp.reason || 'No hay datos suficientes para comparar modelos.'));
  const trace = createTrace({
    id: 'commercial_models',
    title: 'Comparador de modelos comerciales',
    formula: 'Cada modelo se calibra para lograr el margen objetivo con la actividad estimada y se evalúa con actividad pesimista y con 0 días',
    inputs: [
      { label: 'Días activos estimados', value: cmp.estimatedDays, format: 'days' },
      { label: 'Días activos pesimistas', value: cmp.pessimisticDays, format: 'days' },
      { label: 'Margen objetivo', value: cmp.targetMarginPct, format: 'percent' },
      { label: 'Costos fijos del mes', value: k.fixedCosts, format: 'money' },
    ],
    steps: [
      { label: 'Sólo tarifa por día', value: 'Ingreso = tarifa × días', format: 'text' },
      { label: 'Disponibilidad + día', value: 'Ingreso = fee + tarifa × días', format: 'text' },
      { label: 'Mínimo garantizado + día', value: 'Ingreso = máx(mínimo, tarifa × días)', format: 'text' },
      { label: 'Paquete + excedentes', value: 'Ingreso = paquete + tarifa × días extra', format: 'text' },
    ],
    result: { label: 'Modelos comparados', value: cmp.models.length, format: 'number' },
    notes: [
      'Riesgo alto: con actividad pesimista perdés dinero. Medio: el margen pesimista cae a menos de la mitad del objetivo. Bajo: conserva al menos la mitad del margen objetivo.',
      'Ingreso mínimo asegurado: lo que facturás aunque el equipo no trabaje ningún día.',
    ],
  });
  const tbl = table({
    columns: [
      {
        key: 'label',
        label: 'Modelo',
        render: (row) => h('div', { class: 'qr-model' }, h('strong', {}, row.label), h('ul', { class: 'qr-model-params' }, ...modelParams(row.params).map((p) => h('li', {}, p)))),
      },
      { key: 'expectedRevenue', label: abbrHeader('Ingreso esperado', 'Ingreso esperado del mes con la actividad estimada'), align: 'right', render: (row) => money(row.expectedRevenue) },
      { key: 'expectedMarginPct', label: abbrHeader('Margen', 'Margen esperado sobre el precio'), align: 'right', render: (row) => pct(row.expectedMarginPct) },
      {
        key: 'pessimisticProfit',
        label: abbrHeader('Pesimista', `Resultado con ${formatDays(cmp.pessimisticDays)} (escenario pesimista)`, formatDays(cmp.pessimisticDays)),
        align: 'right',
        render: (row) => h('span', { class: hasValue(row.pessimisticProfit) ? (row.pessimisticProfit < -1e-6 ? 'qr-neg' : 'qr-pos') : null }, money(row.pessimisticProfit)),
      },
      { key: 'minimumAssuredRevenue', label: abbrHeader('Mínimo asegurado', 'Ingreso mínimo asegurado: lo que facturás aunque no se trabaje ningún día'), align: 'right', render: (row) => money(row.minimumAssuredRevenue) },
      {
        key: 'breakEvenDays',
        label: 'Break-even',
        align: 'right',
        render: (row) => {
          if (!row.breakEvenReachable) return 'No se alcanza';
          if (hasValue(row.breakEvenDays) && row.breakEvenDays <= 0) {
            return h('span', { class: 'qr-cell-stack', title: 'El ingreso fijo cubre los costos fijos aunque no se trabaje ningún día.' }, formatDays(0), h('span', { class: 'qr-cell-sub' }, 'fijos cubiertos'));
          }
          return formatDays(row.breakEvenDays);
        },
      },
      {
        key: 'risk',
        label: 'Riesgo',
        render: (row) => {
          const b = RISK_BADGE[row.risk] || { tone: 'gray', text: 'Sin datos', short: 'Sin datos' };
          return badge(b.short || b.text, b.tone, { title: b.text });
        },
      },
    ],
    rows: cmp.models,
    caption: 'Comparación de modelos comerciales',
    className: 'qr-models',
  });
  return card({ ...header, actions: [traceBtn(trace)] },
    tbl,
    note(`Todos los modelos están calibrados por día activo para lograr ${pct(cmp.targetMarginPct)} de margen con ${formatDays(cmp.estimatedDays)}${v.r.unit !== 'day' ? ' (aunque cotices por ' + v.unitLabel + ')' : ''}. El escenario pesimista usa ${formatDays(cmp.pessimisticDays)}.`));
}

// ------------------------------------------------------- I. completitud

function renderCompleteness(v) {
  const { r, q } = v;
  const c = r.completeness || { scorePct: 0, items: [] };
  const tone = completenessTone(c.scorePct);
  const order = { missing: 0, warning: 1, ok: 2 };
  const items = (c.items || []).filter((i) => i.status in order).slice().sort((a, b) => order[a.status] - order[b.status]);
  const pendingCount = items.filter((i) => i.status !== 'ok').length;
  const list = h('ul', { class: 'qr-checklist' }, ...items.map((item) => {
    const step = stepForItem(item);
    return h('li', { class: ['qr-check', `qr-check-${item.status}`] },
      h('div', { class: 'qr-check-main' },
        statusDot(item.color || 'gray', item.label),
        h('span', { class: 'qr-check-msg' }, item.message)),
      item.status !== 'ok' ? stepLink(q, step) : null);
  }));
  return card(
    {
      title: 'Cost Completeness Score',
      subtitle: '¿Te olvidaste de algún costo? Controles automáticos sobre lo que suele quedar afuera.',
      actions: [traceBtn(traceCompleteness(v))],
      className: 'qr-card',
      id: v.ids.completeness,
    },
    h('div', { class: 'qr-score' },
      h('div', { class: ['qr-score-value', `qr-tone-${tone}`] }, pct(c.scorePct, 0)),
      h('div', { class: 'qr-score-bar' },
        progressBar(c.scorePct, tone, { label: 'Completitud de costos' }),
        h('div', { class: 'qr-score-text' }, pendingCount ? `${formatNumber(pendingCount)} ${pendingCount === 1 ? 'punto pendiente' : 'puntos pendientes'} de revisar.` : 'No hay pendientes: la cotización está completa.'))),
    list,
  );
}

// ----------------------------------------------------------- J. acciones

function renderActions(v) {
  const { q, onQuoteChange } = v;
  const status = q.status || 'draft';
  const isDraft = status === 'draft';
  const canChange = typeof onQuoteChange === 'function';
  const sent = button(isDraft ? 'Marcar como enviada' : `Estado: ${labelOf(QUOTE_STATUSES, status, 'Borrador')}`, {
    variant: 'primary',
    icon: 'check',
    disabled: !isDraft || !canChange,
    attrs: { 'data-edit': 'status' },
    onClick: () => {
      if (!isDraft || !canChange) return;
      sent.disabled = true;
      try {
        onQuoteChange('status', 'sent');
        track('quote_completed', { completed: true });
        v.notify('Cotización marcada como enviada.', 'success');
      } catch (error) {
        sent.disabled = false;
        logger.warn('No se pudo marcar la cotización como enviada', { message: error && error.message });
        v.notify('No se pudo cambiar el estado de la cotización.', 'danger');
      }
    },
  });
  const print = button('Imprimir / guardar PDF', {
    variant: 'secondary',
    icon: 'print',
    onClick: () => {
      if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
    },
  });
  return card(
    { title: 'Acciones', className: 'qr-card no-print', id: v.ids.actions },
    h('div', { class: 'row qr-actions' }, print, sent),
    note('Al imprimir se ocultan los controles. En el diálogo de impresión elegí "Guardar como PDF" para obtener el archivo.'),
  );
}

// ------------------------------------------------------------- composición

function sectionError(title, error) {
  logger.error('No se pudo mostrar una sección del resultado', { section: title, message: error && error.message });
  return card({ title, className: 'qr-card' }, banner('No se pudo mostrar esta sección con los datos actuales. El resto del análisis sigue disponible.', 'warning'));
}

function printHeader(v) {
  const { q } = v;
  const parts = [q.code, q.name].filter((x) => typeof x === 'string' && x.trim()).join(' — ');
  return h('div', { class: 'qr-print-head' },
    h('div', { class: 'qr-print-brand' }, 'RATEOS · Análisis económico de la cotización'),
    h('div', { class: 'qr-print-title' }, parts || 'Cotización'),
    h('div', { class: 'qr-print-meta' },
      q.client ? `Cliente: ${String(q.client)} · ` : '',
      `Fecha: ${formatDate(new Date())}`,
      v.ill && v.ill.any ? (v.ill.quote ? ' · Valores ILUSTRATIVOS' : ' · Incluye valores ILUSTRATIVOS') : ''));
}

/**
 * Renderiza el análisis económico de una cotización.
 * @param {HTMLElement} container
 * @param {object} app contrato de vistas (toast, navigate, ctx…)
 * @param {{ quote: object, result: object, settings?: object, onQuoteChange?: Function }} params
 * @returns {Function} limpieza (cancela timers)
 */
export function renderQuoteResult(container, app, { quote, result, settings, onQuoteChange } = {}) {
  const cleanups = [];
  const q = quote && typeof quote === 'object' ? quote : {};
  const conf = settings && typeof settings === 'object' ? settings : {};
  let r = result;
  if (!r || !r.kpis) {
    try {
      r = computeQuote(q, { settings: conf });
    } catch (error) {
      logger.error('No se pudo calcular la cotización', { message: error && error.message });
      mount(container, banner('No se pudieron calcular los resultados con los datos actuales. Revisá los valores ingresados en los pasos anteriores.', 'danger', { title: 'Error de cálculo.' }));
      return () => {};
    }
  }
  const notify = (message, tone = 'info') => {
    if (app && typeof app.toast === 'function') app.toast(message, tone);
    else componentToast(message, tone);
  };
  const ids = Object.fromEntries(['decision', 'eecc', 'matrix', 'markup', 'discounts', 'sensitivity', 'scenarios', 'models', 'completeness', 'actions'].map((key) => [key, uniqueId(`qr-${key}`)]));
  let ill = { any: false, quote: false, lines: 0, fuel: false };
  try {
    ill = illustrativeInfo(q);
  } catch (error) {
    logger.warn('No se pudo detectar si la cotización tiene valores ilustrativos', { message: error && error.message });
    ill = { any: q.illustrative === true, quote: q.illustrative === true, lines: 0, fuel: false };
  }
  const v = {
    q,
    r,
    k: r.kpis,
    ill,
    settings: conf,
    unitLabel: r.unitLabel || 'día',
    onQuoteChange,
    notify,
    cleanups,
    ids,
  };

  const sections = [
    ['decision', 'Decisión', 'Decisión', renderDecision],
    ['eecc', 'Costos', 'Estructura de costos (EECC)', renderCostStructure],
    ['matrix', 'Matriz', 'Matriz tarifa × utilización', renderMatrix],
    ['markup', 'Margen vs markup', 'Margen vs markup', renderMarginMarkup],
    ['discounts', 'Descuentos', 'Descuentos por días / volumen', renderDiscounts],
    ['sensitivity', 'Sensibilidad', 'Sensibilidad', renderSensitivity],
    ...(FEATURES.scenarios ? [['scenarios', 'Escenarios', 'Escenarios', renderScenarios]] : []),
    ...(FEATURES.commercialModelComparator ? [['models', 'Modelos comerciales', 'Comparador de modelos comerciales', renderComparator]] : []),
    ['completeness', 'Completitud', 'Cost Completeness Score', renderCompleteness],
    ['actions', 'Acciones', 'Acciones', renderActions],
  ];

  const nodes = sections.map(([, , title, fn]) => {
    try {
      return fn(v);
    } catch (error) {
      return sectionError(title, error);
    }
  });

  const nav = h('nav', { class: 'qr-nav no-print', 'aria-label': 'Secciones del resultado' },
    h('span', { class: 'qr-nav-label' }, 'Ir a:'),
    ...sections.map(([key, short], i) => button(short, {
      variant: 'ghost',
      size: 'sm',
      onClick: () => {
        const target = nodes[i];
        if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      attrs: { 'data-section': key },
    })));

  mount(container, h('div', { class: 'qr' }, printHeader(v), nav, ...nodes));

  return () => {
    cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch (error) {
        logger.warn('Error al limpiar la vista de resultados', { message: error && error.message });
      }
    });
  };
}
