/**
 * Editor de cotización — flujo paso a paso (orden obligatorio de QUOTE_STEPS).
 *
 * Layout de 3 zonas:
 *   1. Stepper con los 11 pasos y su estado (Cost Completeness Score).
 *   2. Panel central con el formulario del paso + Anterior / Siguiente.
 *   3. Resumen en vivo (sticky) con los KPIs de computeQuote().
 *
 * Estado y guardado:
 *   - Se edita una COPIA de trabajo de la cotización.
 *   - Cada campo llama a update(path, value): setPath + recálculo con
 *     debounce (~150 ms) que actualiza SÓLO los valores calculados (no se
 *     re-renderizan los inputs, para no perder el foco).
 *   - Guardado automático con debounce (~400 ms) vía QuoteService.
 *   - Los cambios estructurales (agregar/quitar filas, tipo de servicio,
 *     modalidad, unidad, aplicar convenio) re-renderizan el paso.
 *   - Al salir de la vista se fuerza el guardado pendiente.
 *
 * La UI no accede al almacenamiento: usa app.ctx.quotes / app.ctx.resources.
 */

import { h, mount, clear, debounce, downloadText } from '../dom.js';
import {
  icon,
  button,
  card,
  banner,
  illustrativeBanner,
  numberField,
  textField,
  selectField,
  checkboxField,
  choiceGroup,
  openDialog,
  openTraceDialog,
  toast as componentToast,
  table,
} from '../components.js';
import { illustrativeTag } from '../layout.js';
import { QUOTE_STEPS, RISK_ITEMS, RATE_UNITS, SERVICE_TYPES } from '../../domain/catalogs.js';
import { defaultVolumeTiers, illustrativeInfo } from '../../domain/quote-factory.js';
import { computeQuote } from '../../engines/quote-engine.js';
import { marginToMarkup } from '../../engines/pricing-engine.js';
import { completenessTone } from '../../engines/completeness-engine.js';
import { getPath, setPath, deepClone, isPlainObject } from '../../core/object.js';
import { formatMoney, formatPercent, formatDays, formatNumber, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { parseDecimalInput } from '../../core/validation.js';
import { createId } from '../../core/ids.js';
import { createTrace } from '../../core/trace.js';
import { logger } from '../../core/logger.js';
import { perUnitCeil, perUnitMoney, netRateHint, floorDisplay, floorRateTrace, targetRateTrace, unitShortOf } from './quote-steps/shared.js';

import * as serviceStep from './quote-steps/service.js';
import * as modalityStep from './quote-steps/modality.js';
import * as laborStep from './quote-steps/labor.js';
import * as equipmentStep from './quote-steps/equipment.js';
import * as materialsStep from './quote-steps/materials.js';
import * as logisticsStep from './quote-steps/logistics.js';
import * as indirectStep from './quote-steps/indirect.js';
import * as financeStep from './quote-steps/finance.js';
import * as riskStep from './quote-steps/risk.js';
import * as marginStep from './quote-steps/margin.js';

const STEP_MODULES = Object.freeze({
  service: serviceStep,
  modality: modalityStep,
  labor: laborStep,
  equipment: equipmentStep,
  materials: materialsStep,
  logistics: logisticsStep,
  indirect: indirectStep,
  finance: financeStep,
  risk: riskStep,
  margin: marginStep,
});

export const RECALC_DELAY_MS = 150;
export const SAVE_DELAY_MS = 400;

const RESOURCE_LISTS = Object.freeze(['agreements', 'laborProfiles', 'equipment', 'materials', 'locations']);

const STATUS_TEXT = Object.freeze({
  red: 'faltan datos',
  orange: 'revisar',
  green: 'completo',
  gray: 'sin controles',
});

/** Guardados en curso por cotización (para no leer datos viejos al cambiar de paso). */
const pendingSaves = new Map();

/**
 * Borradores que NO se pudieron guardar (p. ej. almacenamiento lleno), por id
 * de cotización. Si el usuario sale del editor y vuelve, se recupera el
 * borrador en lugar de la versión guardada, para no perder cambios.
 */
const unsavedDrafts = new Map();
/** Editor activo (sólo uno a la vez). */
let activeEditor = null;
/** Secuencia de renders (descarta cargas viejas si el usuario navega rápido). */
let renderSequence = 0;
/** "Imprimir" desde otro paso: navega a Resultado e imprime al terminar. */
let printRequested = false;
/**
 * Cotización cuyo editor se cerró para ir a OTRO PASO de la misma cotización:
 * el editor nuevo lleva la vista al encabezado del paso (UX-03).
 */
let stepChangeQuoteId = null;

// ------------------------------------------------------------ utilidades puras

/** Paso del flujo en el que vive un campo (ruta de validateQuote). */
export function stepOfPath(path) {
  const p = String(path || '');
  const head = p.split('.')[0];
  if (p === 'pricing.knownRate') return 'modality';
  switch (head) {
    case 'activity':
    case 'pricingMode':
    case 'unit':
      return 'modality';
    case 'labor':
      return 'labor';
    case 'equipment':
      return 'equipment';
    case 'materials':
    case 'materialsNotApplicable':
    case 'otherCosts':
      return 'materials';
    case 'logistics':
    case 'fuel':
      return 'logistics';
    case 'indirect':
      return 'indirect';
    case 'finance':
      return 'finance';
    case 'risk':
      return 'risk';
    case 'pricing':
    case 'rules':
      return 'margin';
    default:
      return 'service';
  }
}

/**
 * Paso de un ítem de completitud. El motor ubica "utilization" en el paso
 * service, pero la actividad estimada se carga en Modalidad.
 */
export function stepOfItem(item) {
  if (!item) return 'service';
  if (item.id === 'utilization') return 'modality';
  return QUOTE_STEPS.some((s) => s.id === item.step) ? item.step : 'service';
}

/** Estado (semáforo) de un paso según completitud y validaciones. */
export function stepStatus(stepId, result) {
  if (!result) return 'gray';
  const items = (result.completeness && result.completeness.items) || [];
  if (stepId === 'result') {
    const counts = (result.completeness && result.completeness.counts) || {};
    if (counts.missing > 0) return 'red';
    if (counts.warning > 0) return 'orange';
    return items.length ? 'green' : 'gray';
  }
  // El ítem "modality" también valida el tipo de servicio: cuenta en ambos pasos.
  const own = items.filter((i) => stepOfItem(i) === stepId || (stepId === 'service' && i.id === 'modality'));
  const issues = (result.issues || []).filter((i) => stepOfPath(i.path) === stepId);
  if (own.some((i) => i.status === 'missing') || issues.some((i) => i.severity === 'error')) return 'red';
  if (own.some((i) => i.status === 'warning') || issues.length > 0) return 'orange';
  if (own.length > 0) return 'green';
  return 'gray';
}

/** Tono del resultado esperado: rojo pierde plata, naranja bajo objetivo, verde cumple. */
export function resultTone(result) {
  const k = result && result.kpis;
  if (!k || !isFiniteNumber(k.commercialListRate)) return 'gray';
  if (isFiniteNumber(k.profit) && k.profit < 0) return 'red';
  if (k.belowTarget) return 'orange';
  return 'green';
}

function unitShort(result) {
  return unitShortOf(result && result.unit);
}

function inputNumber(value) {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Limpia texto libre (sin caracteres de control; conserva saltos de línea si es multilínea). */
function cleanText(raw, maxLength, multiline) {
  const text = String(raw ?? '');
  const re = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return text.replace(re, ' ').slice(0, maxLength);
}

/**
 * Completa contenedores faltantes (listas y objetos) SIN cambiar valores
 * escalares: así el cálculo no cambia por abrir la cotización.
 */
export function normalizeQuoteShape(quote) {
  const q = quote;
  ['activity', 'fuel', 'logistics', 'indirect', 'finance', 'risk', 'pricing', 'rules'].forEach((k) => {
    if (!isPlainObject(q[k])) q[k] = {};
  });
  ['labor', 'equipment', 'materials', 'otherCosts'].forEach((k) => {
    if (!Array.isArray(q[k])) q[k] = [];
  });
  if (!Array.isArray(q.logistics.vehicles)) q.logistics.vehicles = [];
  // El motor trata "sin dato" como ida y vuelta: se refleja en la casilla.
  if (typeof q.logistics.roundTrip !== 'boolean') q.logistics.roundTrip = q.logistics.roundTrip !== false;
  if (!isPlainObject(q.finance.payDays)) q.finance.payDays = {};
  if (!Array.isArray(q.risk.items)) q.risk.items = [];
  RISK_ITEMS.forEach((item) => {
    if (!q.risk.items.some((r) => r && r.id === item.id)) q.risk.items.push({ id: item.id, label: item.label, pct: 0, enabled: false });
  });
  if (!Array.isArray(q.rules.volumeTiers) || q.rules.volumeTiers.length === 0) q.rules.volumeTiers = defaultVolumeTiers();
  return q;
}

function lockInputs(container) {
  container.querySelectorAll('input, select, textarea').forEach((el) => {
    // Los controles "qué pasaría si" (sensibilidad) no modifican la cotización.
    if (el.closest('[data-what-if]')) return;
    el.disabled = true;
  });
  container.querySelectorAll('[data-edit]').forEach((el) => {
    el.disabled = true;
  });
}

/**
 * Muestra el monto con separadores debajo de un input de dinero grande
 * (250000000 → $ 250.000.000) para evitar errores de magnitud.
 */
const MONEY_ECHO_FROM = 10000;
function attachMoneyEcho(fieldEl) {
  const input = fieldEl.querySelector('input');
  const control = fieldEl.querySelector('.field-control');
  if (!input || !control) return;
  const echoEl = h('div', { class: 'qe-num-echo', 'aria-hidden': 'true' });
  const sync = () => {
    const raw = String(input.value || '').trim();
    // Mismo intérprete que el campo (formato argentino: "1.800.000,50").
    const n = parseDecimalInput(raw);
    const show = raw !== '' && Number.isFinite(n) && Math.abs(n) >= MONEY_ECHO_FROM;
    echoEl.textContent = show ? formatMoney(n) : '';
    echoEl.hidden = !show;
  };
  input.addEventListener('input', sync);
  // Si el campo restaura el valor anterior (valor inválido confirmado).
  input.addEventListener('change', sync);
  sync();
  control.after(echoEl);
}

function setContent(el, content) {
  if (content instanceof Node) mount(el, content);
  else if (Array.isArray(content)) mount(el, ...content);
  else el.textContent = content === null || content === undefined || content === '' ? EMPTY : String(content);
}

function cssEscape(value) {
  return globalThis.CSS && typeof globalThis.CSS.escape === 'function' ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

/** Avisos de validación junto al campo correspondiente (por atributo name = ruta). */
function decorateFieldIssues(container, issues) {
  container.querySelectorAll('.qe-issue-note').forEach((n) => n.remove());
  container.querySelectorAll('.qe-has-issue').forEach((n) => n.classList.remove('qe-has-issue'));
  issues.forEach((issue) => {
    if (!issue.path) return;
    const control = container.querySelector(`[name="${cssEscape(issue.path)}"]`);
    const field = control && control.closest('.field, .choice-group');
    if (!field) return;
    field.classList.add('qe-has-issue');
    field.appendChild(h('div', { class: ['qe-issue-note', `qe-issue-${issue.severity === 'error' ? 'error' : 'warning'}`] }, issue.message));
  });
}

async function loadResources(app) {
  const out = {};
  await Promise.all(
    RESOURCE_LISTS.map(async (type) => {
      try {
        const list = await app.ctx.resources.list(type);
        out[type] = Array.isArray(list) ? list : [];
      } catch (error) {
        logger.warn('No se pudo leer una biblioteca', { type, message: error && error.message });
        out[type] = [];
      }
    }),
  );
  return out;
}

function setHeaderSafe(app, options) {
  if (app && typeof app.setHeader === 'function') app.setHeader(options);
}

// ------------------------------------------------------------- kit de pasos

/**
 * Kit de UI ligado a la cotización. Se inyecta a cada paso (stepCtx.kit):
 * crea campos conectados a una ruta y "salidas" que se refrescan con cada
 * recálculo sin volver a dibujar los inputs.
 */
function createStepKit({ getQuote, getResult, update, rerender, readOnly, confirmedLines = new Set() }) {
  const watchers = [];

  function watch(run) {
    const safeRun = (result) => {
      try {
        run(result);
      } catch (error) {
        logger.warn('No se pudo actualizar un valor calculado', { message: error && error.message });
      }
    };
    watchers.push(safeRun);
    if (getResult()) safeRun(getResult());
  }

  function evaluate(fn, result) {
    try {
      return fn(result);
    } catch (error) {
      logger.warn('Valor calculado no disponible', { message: error && error.message });
      return EMPTY;
    }
  }

  const kit = {
    readOnly,

    /** Valor actual de la cotización en una ruta. */
    get(path) {
      return getPath(getQuote(), path);
    },

    /**
     * Campo numérico conectado a una ruta.
     * - disabled: además de sólo lectura (p. ej. "No aplica standby").
     * - onValue(value, el): efecto adicional después de guardar el valor en la
     *   cotización (p. ej. quitar la marca ILUSTRATIVO al editar un precio).
     */
    num(path, { structural = false, requiredMark = false, echo = true, disabled = false, onValue = null, ...opts } = {}) {
      let el = null;
      el = numberField({
        rule: 'money',
        ...opts,
        name: path,
        value: inputNumber(kit.get(path)),
        disabled: readOnly || Boolean(disabled),
        onChange: (value) => {
          update(path, value);
          if (typeof onValue === 'function') {
            try {
              onValue(value, el);
            } catch (error) {
              logger.warn('No se pudo aplicar un efecto del campo', { message: error && error.message });
            }
          }
          if (structural) rerender();
        },
      });
      if (requiredMark) {
        const label = el.querySelector('.field-label');
        if (label) label.insertBefore(h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'), label.querySelector('.tag-illustrative'));
      }
      if (echo && (opts.rule || 'money') === 'money') attachMoneyEcho(el);
      return el;
    },

    text(path, { maxLength = 200, multiline = false, ...opts } = {}) {
      const current = kit.get(path);
      return textField({
        ...opts,
        maxLength,
        multiline,
        name: path,
        value: current === null || current === undefined ? '' : String(current),
        onChange: (value) => update(path, cleanText(value, maxLength, multiline)),
      });
    },

    select(path, { structural = false, ...opts } = {}) {
      return selectField({
        ...opts,
        name: path,
        value: kit.get(path),
        onChange: (value) => {
          update(path, value);
          if (structural) rerender();
        },
      });
    },

    check(path, { structural = false, ...opts } = {}) {
      return checkboxField({
        ...opts,
        name: path,
        checked: Boolean(kit.get(path)),
        onChange: (value) => {
          update(path, Boolean(value));
          if (structural) rerender();
        },
      });
    },

    choice(path, { structural = false, ...opts } = {}) {
      return choiceGroup({
        ...opts,
        name: path,
        value: kit.get(path),
        onChange: (value) => {
          update(path, value);
          if (structural) rerender();
        },
      });
    },

    /**
     * Marca ILUSTRATIVO de una línea copiada de una plantilla o biblioteca de
     * demostración: { marked, tag, control }.
     *   marked  → quote.illustrative || line.illustrative (para los campos)
     *   tag     → etiqueta para el encabezado de la línea (o null)
     *   control → casilla "Son valores propios y vigentes" que pone
     *             line.illustrative = false (o null si no corresponde).
     * En una cotización de demostración (quote.illustrative) la marca es de
     * toda la cotización: no se ofrece la casilla por línea.
     */
    lineIllustrative(path, { what = 'esta línea' } = {}) {
      const quote = getQuote();
      const line = kit.get(path);
      const whole = Boolean(quote && quote.illustrative === true);
      const own = Boolean(line && line.illustrative === true);
      const key = (line && typeof line.id === 'string' && line.id) || path;
      const marked = whole || own;
      const showCheck = !whole && isPlainObject(line) && (own || confirmedLines.has(key));
      const control = showCheck
        ? checkboxField({
          label: 'Son valores propios y vigentes',
          name: `${path}.illustrative`,
          checked: !own,
          disabled: readOnly,
          hint: own
            ? `Tildala cuando reemplaces los valores ILUSTRATIVOS de ${what} por los tuyos: se quita la marca.`
            : 'Se quitó la marca ILUSTRATIVO. Destildala si todavía no son tus valores.',
          onChange: (checked) => {
            if (checked) confirmedLines.add(key);
            update(`${path}.illustrative`, !checked);
            rerender();
          },
        })
        : null;
      if (control) control.classList.add('qe-own-values');
      return { marked, tag: marked ? illustrativeTag('Valores ILUSTRATIVOS: reemplazalos por valores propios vigentes') : null, control };
    },

    /** Campo de sólo lectura. */
    staticField(label, value, hint = null) {
      return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), h('div', { class: 'qe-static' }, value === null || value === undefined || value === '' ? EMPTY : String(value)), hint ? h('div', { class: 'field-hint' }, hint) : null);
    },

    /** Salida calculada: fn(result) → texto o nodo. Se refresca en cada recálculo. */
    out(fn, { tag = 'span', className = null } = {}) {
      const el = h(tag, { class: ['qe-out', className] });
      watch((result) => setContent(el, evaluate(fn, result)));
      return el;
    },

    /** Región que se vuelve a dibujar en cada recálculo (sin inputs dentro). */
    region(fn, { className = null } = {}) {
      return kit.out(fn, { tag: 'div', className });
    },

    /** Tono (data-tone) según el resultado: green | orange | red | gray. */
    tone(el, fn) {
      watch((result) => {
        const tone = evaluate(fn, result);
        if (tone && tone !== EMPTY) el.dataset.tone = tone;
        else delete el.dataset.tone;
      });
      return el;
    },

    /** Muestra u oculta un nodo según el resultado. */
    toggle(el, predicate) {
      watch((result) => {
        let visible = false;
        try {
          visible = Boolean(predicate(result));
        } catch {
          visible = false;
        }
        el.hidden = !visible;
      });
      return el;
    },

    /** Indicador compacto: etiqueta + valor calculado (+ pista, + "Ver cálculo"). */
    stat(label, fn, { hint = null, tone = null, trace = null, className = null, emphasis = false } = {}) {
      const el = h(
        'div',
        { class: ['qe-stat', emphasis ? 'is-emphasis' : null, className] },
        h('div', { class: 'qe-stat-label' }, typeof label === 'function' ? kit.out(label) : label),
        kit.out(fn, { className: 'qe-stat-value mono' }),
        hint ? h('div', { class: 'qe-stat-hint' }, typeof hint === 'function' ? kit.out(hint) : hint) : null,
        trace ? kit.trace(trace) : null,
      );
      if (tone) kit.tone(el, tone);
      return el;
    },

    stats(...items) {
      return h('div', { class: 'qe-stats' }, ...items);
    },

    /** Botón "Ver cálculo": traceFn(result) → traza (se arma al hacer clic). */
    trace(traceFn, { label = 'Ver cálculo' } = {}) {
      return button(label, {
        variant: 'link',
        size: 'sm',
        icon: 'calc',
        attrs: { class: 'btn btn-link btn-sm trace-btn' },
        onClick: () => {
          let trace = null;
          try {
            trace = traceFn(getResult());
          } catch (error) {
            logger.warn('No se pudo armar el detalle del cálculo', { message: error && error.message });
          }
          if (trace) openTraceDialog(trace);
          else componentToast('Todavía no hay datos suficientes para mostrar este cálculo.', 'info');
        },
      });
    },

    /** Botón que modifica la cotización (se deshabilita en sólo lectura). */
    action(label, onClick, { variant = 'secondary', icon: iconName = null, size = 'sm', title = null } = {}) {
      return button(label, { variant, icon: iconName, size, title, disabled: readOnly, onClick, attrs: { 'data-edit': 'true', 'aria-label': label ? null : title } });
    },

    /** Tarjeta de una línea editable (personal, equipo, material…). */
    lineCard({ title, subtitle = null, badges = [], actions = [], className = null }, ...children) {
      return h(
        'article',
        { class: ['qe-line', className] },
        h(
          'header',
          { class: 'qe-line-head' },
          h('div', { class: 'qe-line-titles' }, h('h4', { class: 'qe-line-title' }, title), subtitle ? h('div', { class: 'qe-line-subtitle' }, subtitle) : null, badges.length ? h('div', { class: 'qe-line-badges' }, ...badges) : null),
          actions.length ? h('div', { class: 'qe-line-actions' }, ...actions) : null,
        ),
        ...children,
      );
    },

    /** Grupo de campos con título. */
    group(title, ...children) {
      return h('div', { class: 'qe-group' }, title ? h('h5', { class: 'qe-group-title' }, title) : null, ...children);
    },

    /** Texto explicativo breve. */
    explain(...children) {
      return h('p', { class: 'qe-explain' }, ...children);
    },

    /** Desglose "concepto → valor" (para regiones calculadas). */
    breakdown(rows, { totalLabel = null, total = null } = {}) {
      return h(
        'dl',
        { class: 'qe-breakdown' },
        ...rows.map(([label, value]) => h('div', { class: 'qe-breakdown-row' }, h('dt', {}, label), h('dd', { class: 'mono' }, value))),
        totalLabel ? h('div', { class: 'qe-breakdown-row is-total' }, h('dt', {}, totalLabel), h('dd', { class: 'mono' }, total)) : null,
      );
    },

    refresh(result) {
      watchers.forEach((run) => run(result));
    },
  };
  return kit;
}

// ----------------------------------------------------------------- resumen

function commercialRateTrace(r) {
  const k = r.kpis;
  const sourceLabel = {
    known_rate: 'Tarifa conocida (modo "Conozco la tarifa")',
    offered: 'Tarifa ofrecida manual (paso Margen)',
    suggested: 'Sugerida: precio objetivo redondeado hacia arriba',
    override: 'Tarifa forzada',
    none: 'Sin tarifa',
  }[k.commercialSource] || 'Sin tarifa';
  return createTrace({
    id: 'commercial_rate',
    title: 'Tarifa comercial',
    formula: k.commercialSource === 'suggested'
      ? 'Tarifa comercial = Precio objetivo de lista redondeado hacia arriba al múltiplo de redondeo · Tarifa neta = lista × factor de descuentos'
      : 'Tarifa comercial = tarifa ingresada · Tarifa neta = lista × factor de descuentos (tramo × continuidad × comercial)',
    inputs: [
      { label: 'Origen', value: sourceLabel, format: 'text' },
      { label: `Precio objetivo de lista (margen ${formatPercent(r.targetMarginPct)})`, value: k.targetListRate, format: 'money' },
      { label: 'Tarifa sugerida (redondeada)', value: k.suggestedListRate, format: 'money' },
      { label: 'Factor de descuentos con la actividad estimada', value: r.estimate && r.estimate.revenue ? r.estimate.revenue.discountFactor : null, format: 'number' },
    ],
    steps: [{ label: 'Tarifa neta (después de descuentos)', value: k.commercialNetRate, format: 'money' }],
    result: { label: `Tarifa comercial de lista (por ${unitShort(r)})`, value: k.commercialListRate, format: 'money' },
    notes: [
      k.belowFloor ? 'La tarifa neta queda DEBAJO de la tarifa piso: con la actividad estimada se pierde dinero.' : null,
      !k.belowFloor && k.belowFloorRate
        ? 'La tarifa neta queda debajo de la tarifa piso, pero con la actividad estimada el mínimo mensual garantizado cubre los costos. Si la actividad cambia, podés perder dinero.'
        : null,
      'Margen y markup no son lo mismo: el margen se calcula sobre el precio; el markup, sobre el costo.',
    ],
  });
}

/** Tarifa comercial: la sugerida es una tarifa mínima (se muestra hacia arriba). */
function commercialRateText(r) {
  const k = r.kpis;
  return k.commercialSource === 'suggested' ? perUnitCeil(k.commercialListRate, r.unit) : perUnitMoney(k.commercialListRate, r.unit);
}

function sourceHint(r) {
  const k = r.kpis;
  switch (k.commercialSource) {
    case 'known_rate':
      return 'Tarifa conocida (la ingresaste en Modalidad).';
    case 'offered':
      return 'Tarifa ofrecida manual (paso Margen).';
    case 'suggested':
      return 'Sugerida: precio objetivo redondeado hacia arriba.';
    case 'override':
      return 'Tarifa forzada.';
    default:
      return r.pricingMode === 'known_rate' ? 'Falta ingresar la tarifa en Modalidad.' : 'Sin tarifa calculada todavía.';
  }
}

function breakEvenTone(r) {
  const be = r.breakEven || {};
  if (be.notApplicable) return 'gray';
  if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'red' : 'gray';
  return be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
}

/** Semáforo del Cost Completeness Score: mismos umbrales que el motor y el Resultado. */
function completenessColor(pct) {
  return isFiniteNumber(pct) ? completenessTone(pct) : 'gray';
}

function buildSummary({ getResult, stepHref }) {
  const rows = [];

  const item = ({ key, label, value, hint, tone = null, trace = null, emphasis = false }) => {
    const labelEl = h('span', { class: 'qe-sum-label' });
    const valueEl = h('div', { class: 'qe-sum-value mono' });
    const hintEl = h('div', { class: 'qe-sum-hint' });
    const traceBtn = trace
      ? button('Ver cálculo', {
        variant: 'link',
        size: 'sm',
        icon: 'calc',
        // El nombre accesible se completa con la etiqueta visible en cada
        // recálculo (nunca la clave interna).
        attrs: { class: 'btn btn-link btn-sm trace-btn', 'aria-label': typeof label === 'string' ? `Ver cálculo: ${label}` : 'Ver cálculo' },
        onClick: () => {
          const r = getResult();
          const t = r ? trace(r) : null;
          if (t) openTraceDialog(t);
        },
      })
      : null;
    const el = h('div', { class: ['qe-sum-item', emphasis ? 'is-emphasis' : null], dataset: { kpi: key } }, h('div', { class: 'qe-sum-top' }, labelEl, traceBtn), valueEl, hintEl);
    rows.push({ el, labelEl, valueEl, hintEl, traceBtn, label, value, hint, tone });
    return el;
  };

  const list = h(
    'div',
    { class: 'qe-sum-list' },
    item({
      key: 'totalCost',
      label: 'Costo mensual total',
      value: (r) => formatMoney(r.kpis.totalCost),
      hint: (r) => `Con ${formatNumber(r.kpis.activeDays, { decimals: 2 })} días activos (${formatPercent(r.kpis.utilizationPct)} de utilización).`,
      trace: (r) => r.traces.totalCost,
    }),
    item({
      key: 'floorRate',
      // Base de LISTA: es la que se escribe en la cotización (UX-01).
      label: (r) => (floorDisplay(r).base === 'net' ? 'Tarifa piso (neta)' : 'Tarifa piso (de lista)'),
      value: (r) => perUnitCeil(floorDisplay(r).value, r.unit),
      hint: (r) => {
        const floor = floorDisplay(r);
        if (!isFiniteNumber(floor.value)) return 'Cargá la actividad estimada para calcularla.';
        const net = floor.base === 'list' ? netRateHint(r.kpis.floorNetRate, r) : '';
        return `Margen 0 %: sólo cubre los costos.${net ? ` ${net}` : ''}`;
      },
      trace: floorRateTrace,
    }),
    item({
      key: 'targetRate',
      label: (r) => `Precio objetivo (de lista, margen ${formatPercent(r.targetMarginPct)})`,
      value: (r) => perUnitCeil(r.kpis.targetListRate, r.unit),
      hint: (r) => {
        const mk = marginToMarkup(r.targetMarginPct);
        const net = netRateHint(r.kpis.targetNetRate, r);
        const markup = isFiniteNumber(mk) ? `Equivale a un markup de ${formatPercent(mk)} sobre el costo.` : '';
        return [net, markup].filter(Boolean).join(' ');
      },
      trace: targetRateTrace,
    }),
    item({
      key: 'commercialRate',
      label: 'Tarifa comercial (de lista)',
      value: commercialRateText,
      hint: (r) => {
        const k = r.kpis;
        const net = isFiniteNumber(k.commercialNetRate) && isFiniteNumber(k.commercialListRate) && Math.abs(k.commercialNetRate - k.commercialListRate) > 0.005
          ? ` Neta: ${formatMoney(k.commercialNetRate)} (después de descuentos).`
          : '';
        return `${sourceHint(r)}${net}`;
      },
      trace: commercialRateTrace,
      emphasis: true,
    }),
    item({
      key: 'expectedResult',
      label: 'Resultado esperado',
      value: (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatMoney(r.kpis.profit) : EMPTY),
      hint: (r) => (isFiniteNumber(r.kpis.commercialListRate) ? `Facturación ${formatMoney(r.kpis.revenue)} por mes.` : 'Sin tarifa comercial.'),
      tone: resultTone,
      trace: (r) => r.traces.expectedResult,
    }),
    item({
      key: 'expectedMargin',
      label: 'Margen esperado',
      // Sin tarifa comercial el motor no informa margen (null) → "—".
      value: (r) => (isFiniteNumber(r.kpis.commercialListRate) && isFiniteNumber(r.kpis.marginPct) ? formatPercent(r.kpis.marginPct) : EMPTY),
      hint: (r) => {
        const k = r.kpis;
        const base = `Objetivo ${formatPercent(k.targetMarginPct)}`;
        if (!isFiniteNumber(k.commercialListRate) || !isFiniteNumber(k.marginPct)) return `${base} · sin tarifa comercial.`;
        const state = k.profit < 0 ? 'pierde dinero' : k.belowTarget ? 'debajo del objetivo' : 'cumple el objetivo';
        const markup = isFiniteNumber(k.markupPct) ? ` · markup ${formatPercent(k.markupPct)}` : '';
        return `${base} · ${state}${markup}.`;
      },
      tone: resultTone,
      trace: (r) => r.traces.expectedResult,
    }),
    item({
      key: 'breakEven',
      label: 'Break-even (días activos)',
      value: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable) return 'No aplica';
        if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
        return formatDays(be.days);
      },
      hint: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !be.reachable) return be.reason || '';
        return `Mínimo ${formatNumber(be.wholeDays)} días enteros · estimás ${formatNumber(r.kpis.activeDays, { decimals: 2 })}.`;
      },
      tone: breakEvenTone,
      trace: (r) => r.traces.breakEven,
    }),
  );

  // Completitud
  const pctEl = h('span', { class: 'qe-sum-pct mono' });
  const barFill = h('div', { class: 'progress-bar' });
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Completitud de costos' }, barFill);
  const pendingEl = h('ul', { class: 'qe-pending' });
  const completeness = h(
    'div',
    { class: 'qe-sum-complete', dataset: { kpi: 'completeness' } },
    h('div', { class: 'qe-sum-top' }, h('span', { class: 'qe-sum-label' }, 'Completitud de costos'), pctEl),
    bar,
    pendingEl,
  );

  const el = h(
    'div',
    { class: 'qe-summary-inner' },
    h('div', { class: 'qe-summary-head' }, h('h2', { class: 'qe-summary-title' }, 'Resumen en vivo'), h('span', { class: 'qe-summary-sub' }, 'Se recalcula mientras editás')),
    list,
    completeness,
  );

  function resolve(v, r) {
    if (typeof v !== 'function') return v;
    try {
      return v(r);
    } catch (error) {
      logger.warn('No se pudo calcular un indicador del resumen', { message: error && error.message });
      return EMPTY;
    }
  }

  return {
    el,
    update(r) {
      if (!r) return;
      rows.forEach((row) => {
        row.labelEl.textContent = resolve(row.label, r) || '';
        if (row.traceBtn) row.traceBtn.setAttribute('aria-label', `Ver cálculo: ${row.labelEl.textContent}`);
        row.valueEl.textContent = resolve(row.value, r) || EMPTY;
        const hint = resolve(row.hint, r);
        row.hintEl.textContent = hint && hint !== EMPTY ? hint : '';
        row.hintEl.hidden = !row.hintEl.textContent;
        const tone = row.tone ? resolve(row.tone, r) : null;
        if (tone && tone !== EMPTY) row.el.dataset.tone = tone;
        else delete row.el.dataset.tone;
      });
      const pct = r.completeness ? r.completeness.scorePct : null;
      const v = isFiniteNumber(pct) ? Math.max(0, Math.min(100, pct)) : 0;
      pctEl.textContent = isFiniteNumber(pct) ? `${formatNumber(pct, { decimals: 0 })} %` : EMPTY;
      barFill.style.setProperty('width', `${v}%`);
      bar.className = `progress progress-${completenessColor(pct)}`;
      bar.setAttribute('aria-valuenow', String(Math.round(v)));
      const pending = (r.completeness && r.completeness.pending) || [];
      if (pending.length === 0) {
        mount(pendingEl, h('li', { class: 'qe-pending-ok' }, h('span', { class: 'dot dot-green', 'aria-hidden': 'true' }), 'No hay pendientes de costos.'));
      } else {
        mount(
          pendingEl,
          ...pending.slice(0, 3).map((p) => h(
            'li',
            {},
            h('span', { class: ['dot', `dot-${p.color === 'red' ? 'red' : 'orange'}`], 'aria-hidden': 'true' }),
            h('div', {}, h('a', { href: stepHref(stepOfItem(p)) }, p.label), h('div', { class: 'qe-pending-msg' }, p.message)),
          )),
          pending.length > 3 ? h('li', { class: 'qe-pending-more' }, `y ${pending.length - 3} más (ver estado en cada paso)`) : null,
        );
      }
    },
  };
}

// ----------------------------------------------------------------- stepper

function buildStepper({ currentStep, stepHref }) {
  const entries = QUOTE_STEPS.map((step, index) => {
    const statusText = h('span', { class: 'sr-only' });
    const isCurrent = step.id === currentStep;
    const link = h(
      'a',
      { href: stepHref(step.id), class: ['qe-step-link', isCurrent ? 'is-current' : null], 'aria-current': isCurrent ? 'step' : null },
      h('span', { class: 'qe-step-num', 'aria-hidden': 'true' }, String(index + 1)),
      h('span', { class: 'qe-step-label' }, step.label),
      h('span', { class: 'qe-step-dot', 'aria-hidden': 'true' }),
      statusText,
    );
    const li = h('li', { class: 'qe-step', dataset: { step: step.id } }, link);
    return { step, li, link, statusText };
  });
  const el = h('nav', { class: 'qe-stepper', 'aria-label': 'Pasos de la cotización' }, h('ol', { class: 'qe-steps' }, ...entries.map((e) => e.li)));
  return {
    el,
    update(result) {
      entries.forEach((e) => {
        const status = stepStatus(e.step.id, result);
        e.li.dataset.status = status;
        e.statusText.textContent = ` (${STATUS_TEXT[status]})`;
        e.link.title = `${e.step.label}: ${STATUS_TEXT[status]}`;
      });
    },
  };
}

// ---------------------------------------------------- avisos del paso actual

function buildStepNotices(stepId) {
  const list = h('ul', { class: 'qe-notice-list' });
  const el = h('section', { class: 'qe-notices', 'aria-label': 'Pendientes y avisos de este paso', hidden: true }, h('h3', { class: 'qe-notices-title' }, 'Pendientes de este paso'), list);
  return {
    el,
    update(result) {
      if (!result || stepId === 'result') {
        el.hidden = true;
        return;
      }
      const items = ((result.completeness && result.completeness.items) || []).filter((i) => stepOfItem(i) === stepId && i.status !== 'ok' && i.status !== 'n/a');
      const issues = (result.issues || []).filter((i) => stepOfPath(i.path) === stepId);
      if (items.length === 0 && issues.length === 0) {
        el.hidden = true;
        clear(list);
        return;
      }
      el.hidden = false;
      el.classList.toggle('has-red', items.some((i) => i.status === 'missing') || issues.some((i) => i.severity === 'error'));
      mount(
        list,
        ...items.map((i) => h('li', { class: ['qe-notice', `is-${i.status === 'missing' ? 'red' : 'orange'}`] }, h('span', { class: ['dot', `dot-${i.status === 'missing' ? 'red' : 'orange'}`], 'aria-hidden': 'true' }), h('span', {}, h('strong', {}, `${i.label}: `), i.message))),
        ...issues.map((i) => h('li', { class: ['qe-notice', `is-${i.severity === 'error' ? 'red' : 'orange'}`] }, h('span', { class: ['dot', `dot-${i.severity === 'error' ? 'red' : 'orange'}`], 'aria-hidden': 'true' }), h('span', {}, i.message))),
      );
    },
  };
}

// ------------------------------------------------- respaldo del paso Resultado

function resultFallback(result, error) {
  const rows = result && result.eecc ? result.eecc.rows : [];
  return h(
    'div',
    { class: 'stack' },
    banner(
      'No se pudo cargar la vista completa de resultados. Te mostramos un resumen básico; recargá la página para intentar de nuevo. Tus datos están guardados.',
      'warning',
      { title: 'Resultado no disponible.' },
    ),
    result
      ? card(
        { title: 'Estructura de costos (EECC)', subtitle: 'Monto e incidencia % con la actividad estimada.' },
        table({
          columns: [
            { key: 'label', label: 'Categoría' },
            { key: 'amount', label: 'Monto mensual', align: 'right', format: 'money' },
            { key: 'displayPct', label: 'Incidencia', align: 'right', format: 'percent' },
          ],
          rows,
          footer: { label: 'Total', amount: formatMoney(result.eecc.total), displayPct: formatPercent(result.eecc.displayTotalPct) },
          caption: 'Estructura de costos',
        }),
      )
      : null,
    error && error.message ? h('p', { class: 'footnote' }, `Detalle técnico: ${error.message}`) : null,
  );
}

// ------------------------------------------------------------------ editor

function createEditor(root, app, { quote, settings, resources, stepId, restoredDraft = false, revealStep = false }) {
  const quoteId = quote.id;
  const readOnly = Boolean(app.ctx && app.ctx.init && app.ctx.init.readOnly);
  // Sin almacenamiento persistente (modo memoria) no hay que decir "Guardado".
  const ephemeral = Boolean(app.ctx && app.ctx.persistent === false);
  const state = {
    quote: normalizeQuoteShape(quote),
    settings: settings || {},
    result: null,
    dirty: false,
    disposed: false,
    saveStatus: readOnly ? 'readonly' : 'idle',
    headerName: null,
    calcError: null,
    lastScorePct: null,
    // Líneas a las que el usuario les quitó la marca ILUSTRATIVO en esta
    // sesión (la casilla sigue visible para poder deshacerlo).
    confirmedLines: new Set(),
  };

  const notify = (message, tone = 'info') => {
    if (app && typeof app.toast === 'function') app.toast(message, tone);
    else componentToast(message, tone);
  };
  const navigate = (hash) => {
    if (app && typeof app.navigate === 'function') app.navigate(hash);
    else window.location.hash = hash;
  };
  const stepHref = (id) => `#/cotizaciones/${encodeURIComponent(quoteId)}/${id}`;

  // ------------------------------------------------------------- cálculo
  function recompute() {
    try {
      state.result = computeQuote(state.quote, { settings: state.settings });
      state.calcError = null;
    } catch (error) {
      state.calcError = error;
      logger.error('No se pudo calcular la cotización', { message: error && error.message });
    }
    calcErrorBanner.hidden = !state.calcError;
  }

  // ------------------------------------------------------------- guardado
  const saveTextEl = h('span', { class: 'qe-save-text' });
  const retryBtn = button('Reintentar', { variant: 'link', size: 'sm', onClick: () => save() });
  retryBtn.hidden = true;
  // Si no se puede guardar, el backup exportado debe incluir los cambios de
  // esta cotización (si no, exportar no sirve para salvarlos).
  const downloadDraftBtn = button('Descargar backup con estos cambios', { variant: 'link', size: 'sm', icon: 'download', onClick: () => downloadBackupWithDraft() });
  downloadDraftBtn.hidden = true;
  const saveEl = h('div', { class: 'qe-save', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'qe-save-dot', 'aria-hidden': 'true' }), saveTextEl, retryBtn, downloadDraftBtn);

  async function downloadBackupWithDraft() {
    try {
      const { filename, data } = await app.ctx.backup.exportBackup();
      const draft = deepClone(state.quote);
      const exists = data.quotes.some((q) => q.id === quoteId);
      data.quotes = exists ? data.quotes.map((q) => (q.id === quoteId ? draft : q)) : [...data.quotes, draft];
      downloadText(filename, JSON.stringify(data, null, 2));
      notify('Backup descargado con los cambios sin guardar de esta cotización.', 'success');
    } catch (error) {
      logger.error('No se pudo exportar el backup con el borrador', { name: error && error.name });
      notify('No se pudo descargar el backup.', 'danger');
    }
  }

  function setSaveStatus(status, error = null) {
    const previous = state.saveStatus;
    state.saveStatus = status;
    saveEl.dataset.status = status;
    retryBtn.hidden = status !== 'error';
    downloadDraftBtn.hidden = status !== 'error';
    const texts = {
      idle: ephemeral ? 'Sin cambios (no se guarda)' : 'Sin cambios',
      pending: 'Guardando…',
      saving: 'Guardando…',
      saved: ephemeral ? 'Sólo en esta sesión (no se guarda)' : 'Guardado',
      readonly: 'Sólo lectura',
      invalid: 'Revisá los campos marcados',
    };
    if (status === 'error') {
      const quota = error && error.code === 'quota_exceeded';
      const restored = error && error.code === 'restored_draft';
      const message = quota && error.message
        ? error.message
        : restored
          ? 'Hay cambios sin guardar recuperados: reintentá o descargá un backup con estos cambios.'
          : 'No se pudieron guardar los cambios en este navegador.';
      saveTextEl.textContent = quota ? `Error al guardar: ${message}` : 'Error al guardar';
      saveEl.title = message;
      if (previous !== 'error') notify(`Error al guardar. ${message}`, 'danger');
    } else {
      saveTextEl.textContent = texts[status] || '';
      saveEl.title = status === 'invalid' ? 'Hay valores fuera de rango: no se guardan cambios hasta corregirlos.' : '';
    }
  }

  // ------------------------------------------- campos inválidos (QA-E2E-03)
  // Mientras haya un campo marcado como inválido NO se guarda: así nunca
  // queda guardado un valor intermedio (p. ej. "15" al tipear "150" en un
  // margen). Un campo que restauró su valor anterior al confirmarse con un
  // valor inválido ya volvió a un valor válido: no bloquea el guardado.
  function invalidControls() {
    return [...layout.querySelectorAll('[aria-invalid="true"]')].filter((el) => el.dataset.qeRestored !== 'true' && !el.closest('[data-what-if]'));
  }

  function hasInvalidFields() {
    return invalidControls().length > 0;
  }

  /** Actualiza el indicador y retoma el guardado cuando se corrigen los campos. */
  function syncInvalidState() {
    if (readOnly || state.disposed) return;
    if (hasInvalidFields()) {
      if (state.saveStatus !== 'invalid' && state.saveStatus !== 'error') setSaveStatus('invalid');
      return;
    }
    if (state.saveStatus === 'invalid') {
      if (state.dirty) {
        setSaveStatus('pending');
        scheduleSave();
      } else {
        setSaveStatus('saved');
      }
    }
  }

  /**
   * Antes de salir o cerrar: los campos con un valor inválido vuelven a su
   * valor anterior (el campo lo restaura al confirmarse) y recién ahí se guarda.
   */
  function revertInvalidFields() {
    invalidControls().forEach((el) => {
      try {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        logger.warn('No se pudo restaurar un campo inválido', { message: error && error.message });
      }
    });
  }

  function onFieldInput(event) {
    const target = event.target;
    if (target && target.dataset && target.dataset.qeRestored) delete target.dataset.qeRestored;
    syncInvalidState();
  }

  function onFieldChange(event) {
    const target = event.target;
    // numberField: si al confirmar sigue inválido, ya restauró el valor anterior.
    if (target && target.getAttribute && target.getAttribute('aria-invalid') === 'true' && target.getAttribute('inputmode') === 'decimal') {
      target.dataset.qeRestored = 'true';
    }
    syncInvalidState();
  }

  async function save() {
    scheduleSave.cancel();
    if (readOnly || !state.dirty) return pendingSaves.get(quoteId);
    if (hasInvalidFields()) {
      if (state.saveStatus !== 'error') setSaveStatus('invalid');
      return pendingSaves.get(quoteId);
    }
    state.dirty = false;
    setSaveStatus('saving');
    const snapshot = deepClone(state.quote);
    let promise;
    try {
      // La llamada se hace YA (el repositorio local persiste en forma síncrona).
      promise = Promise.resolve(app.ctx.quotes.saveQuote(snapshot));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const tracked = promise.then(() => true, () => false);
    pendingSaves.set(quoteId, tracked);
    tracked.finally(() => {
      if (pendingSaves.get(quoteId) === tracked) pendingSaves.delete(quoteId);
    });
    try {
      await promise;
      unsavedDrafts.delete(quoteId);
      if (!state.dirty) setSaveStatus('saved');
    } catch (error) {
      state.dirty = true;
      unsavedDrafts.set(quoteId, deepClone(state.quote));
      logger.warn('No se pudo guardar la cotización', { code: error && error.code });
      setSaveStatus('error', error);
    }
    return tracked;
  }

  const scheduleSave = debounce(() => {
    save();
  }, SAVE_DELAY_MS);

  const scheduleRecalc = debounce(() => {
    if (state.disposed) return;
    recompute();
    refreshAll();
  }, RECALC_DELAY_MS);

  function markDirty() {
    state.dirty = true;
    setSaveStatus(hasInvalidFields() ? 'invalid' : 'pending');
    scheduleSave();
  }

  /** Aplica un cambio de campo (sin re-renderizar inputs). */
  function update(path, value) {
    if (readOnly || state.disposed) return;
    try {
      setPath(state.quote, path, value === undefined ? null : value);
    } catch {
      logger.warn('Ruta de campo inválida', { path: String(path) });
      return;
    }
    markDirty();
    scheduleRecalc();
  }

  /** Cambio estructural: aplica fn(quote) y vuelve a dibujar el paso. */
  function mutate(fn, { focus = null } = {}) {
    if (readOnly || state.disposed) return;
    try {
      fn(state.quote);
    } catch (error) {
      logger.warn('No se pudo aplicar el cambio', { message: error && error.message });
      return;
    }
    markDirty();
    rerenderStep();
    if (focus) focusField(focus);
  }

  function focusField(path) {
    const control = stepBody.querySelector(`[name="${cssEscape(path)}"]`);
    if (!control) return;
    if (typeof control.scrollIntoView === 'function') control.scrollIntoView({ block: 'center' });
    try {
      control.focus({ preventScroll: true });
    } catch {
      control.focus();
    }
  }

  // ------------------------------------------------------------- estructura
  const currentIndex = QUOTE_STEPS.findIndex((s) => s.id === stepId);
  const currentStep = QUOTE_STEPS[currentIndex];
  const prevStep = currentIndex > 0 ? QUOTE_STEPS[currentIndex - 1] : null;
  const nextStep = currentIndex < QUOTE_STEPS.length - 1 ? QUOTE_STEPS[currentIndex + 1] : null;

  const stepper = buildStepper({ currentStep: stepId, stepHref });
  const summary = stepId === 'result' ? null : buildSummary({ getResult: () => state.result, stepHref });
  const notices = buildStepNotices(stepId);
  const calcErrorBanner = banner('No se pudieron recalcular los resultados con los datos actuales. Revisá los valores ingresados.', 'danger', { title: 'Error de cálculo.' });
  calcErrorBanner.hidden = true;
  const stepBody = h('div', { class: ['qe-step-body', `qe-step-${stepId}`] });

  const unitLabel = (RATE_UNITS.find((u) => u.id === state.quote.unit) || RATE_UNITS[0]).label;
  const stepHead = h(
    'div',
    { class: 'qe-step-head' },
    h(
      'div',
      { class: 'qe-step-heading' },
      h('span', { class: 'qe-step-kicker' }, `Paso ${currentIndex + 1} de ${QUOTE_STEPS.length}`),
      h('h2', { class: 'qe-step-title', tabindex: '-1' }, currentStep.label),
    ),
    h('div', { class: 'qe-step-meta' }, h('span', { class: 'badge badge-navy', title: 'Unidad de cotización' }, unitLabel), saveEl),
  );

  const stepNav = h(
    'nav',
    { class: 'qe-step-nav', 'aria-label': 'Navegación entre pasos' },
    prevStep
      ? h('a', { class: 'btn btn-secondary qe-nav-btn', href: stepHref(prevStep.id), rel: 'prev', 'aria-label': `Anterior: ${prevStep.label}` }, icon('chevronLeft'), h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, 'Anterior'), h('span', {}, prevStep.label)))
      : h('span'),
    nextStep
      ? h('a', { class: 'btn btn-primary qe-nav-btn is-next', href: stepHref(nextStep.id), rel: 'next', 'aria-label': `Siguiente: ${nextStep.label}` }, h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, 'Siguiente'), h('span', {}, nextStep.label)), icon('chevronRight'))
      : h('a', { class: 'btn btn-secondary qe-nav-btn is-next', href: '#/cotizaciones' }, h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, 'Listo'), h('span', {}, 'Volver a Cotizaciones'))),
  );

  // Aviso de valores ILUSTRATIVOS de la cotización (se actualiza al confirmar líneas).
  const illustrativeHolder = h('div', { class: 'qe-illustrative', hidden: true });
  let illustrativeKey = null;

  /** ¿Está visible el aviso global de datos de demostración? (para no repetirlo). */
  function globalDemoBannerVisible() {
    const region = document.querySelector('.global-banners');
    if (!region || region.hidden) return false;
    return [...region.querySelectorAll('.banner')].some((b) => /ILUSTRATIVO/.test(b.textContent || ''));
  }

  function syncIllustrativeBanner() {
    const info = illustrativeInfo(state.quote);
    const q = state.quote;
    const count = (list) => (Array.isArray(list) ? list.filter((l) => isPlainObject(l) && l.illustrative === true).length : 0);
    const groups = [
      { step: 'labor', label: 'Personal', n: count(q.labor) },
      { step: 'equipment', label: 'Equipos', n: count(q.equipment) },
      { step: 'materials', label: 'Materiales', n: count(q.materials) },
      { step: 'materials', label: 'Otros costos', n: count(q.otherCosts) },
      { step: 'logistics', label: 'Vehículos', n: count(q.logistics && q.logistics.vehicles) },
    ].filter((g) => g.n > 0);
    // La cotización de demostración ya está explicada por el aviso global.
    const demoCovered = info.quote && globalDemoBannerVisible();
    const key = JSON.stringify([info.any, info.quote, info.fuel, demoCovered, groups.map((g) => [g.label, g.n])]);
    if (key === illustrativeKey) return;
    illustrativeKey = key;
    if (!info.any || demoCovered) {
      clear(illustrativeHolder);
      illustrativeHolder.hidden = true;
      return;
    }
    illustrativeHolder.hidden = false;
    if (info.quote) {
      mount(illustrativeHolder, illustrativeBanner('Esta es una cotización de DEMOSTRACIÓN: todos sus costos, salarios, cargas y precios son ILUSTRATIVOS. Reemplazalos por valores propios vigentes antes de cotizar.'));
      return;
    }
    const lines = groups.reduce((acc, g) => acc + g.n, 0);
    const parts = [];
    if (lines > 0) parts.push(`${lines} ${lines === 1 ? 'línea copiada' : 'líneas copiadas'} de plantillas o bibliotecas de demostración`);
    if (info.fuel) parts.push('el precio del combustible (valor por defecto de la demo)');
    const el = illustrativeBanner(
      `Esta cotización tiene valores ILUSTRATIVOS: ${parts.join(' y ')}. Están marcados con la etiqueta ILUSTRATIVO. Reemplazalos por valores propios vigentes y tildá "Son valores propios y vigentes" en cada línea${info.fuel ? ' (el combustible se desmarca al editar su precio)' : ''}.`,
    );
    const links = [...groups.map((g) => ({ href: stepHref(g.step), text: `${g.label}: ${g.n}` })), ...(info.fuel ? [{ href: stepHref('logistics'), text: 'Combustible' }] : [])];
    if (links.length) {
      const body = el.lastElementChild || el;
      body.appendChild(h('span', { class: 'qe-illustrative-links' }, ...links.map((l) => h('a', { href: l.href }, l.text))));
    }
    mount(illustrativeHolder, el);
  }

  const mainEl = h(
    'div',
    { class: 'qe-main' },
    readOnly
      ? banner('Los datos fueron guardados por una versión más nueva de RATEOS. Podés consultar la cotización, pero no se guardan cambios.', 'danger', { title: 'Modo sólo lectura.' })
      : null,
    illustrativeHolder,
    calcErrorBanner,
    stepHead,
    notices.el,
    stepBody,
    stepNav,
  );

  const layout = h(
    'div',
    { class: ['qe', summary ? null : 'qe-no-summary', readOnly ? 'is-readonly' : null] },
    stepper.el,
    mainEl,
    summary ? h('aside', { class: 'qe-summary', 'aria-label': 'Resumen en vivo de la cotización' }, summary.el) : null,
  );

  // ------------------------------------------------------------ encabezado
  // En pantallas chicas los botones del encabezado quedan sólo con ícono
  // (el texto sigue disponible para lectores de pantalla y como tooltip).
  const headBtnClass = 'btn btn-secondary qe-head-btn';
  const duplicateBtn = button('Duplicar', { variant: 'secondary', icon: 'copy', title: 'Duplicar', disabled: readOnly, onClick: () => duplicate(), attrs: { class: headBtnClass } });
  const templateBtn = button('Guardar como plantilla', {
    variant: 'secondary',
    icon: 'services',
    disabled: readOnly,
    title: 'Guardar como plantilla: reutilizá esta cotización como plantilla de servicio',
    onClick: () => saveAsTemplate(),
    attrs: { class: headBtnClass },
  });
  const printBtn = button('Imprimir', { variant: 'secondary', icon: 'print', title: 'Imprimir', onClick: () => print(), attrs: { class: headBtnClass } });

  function syncHeader(force = false) {
    const name = String(state.quote.name || '').trim() || 'Cotización sin nombre';
    if (!force && name === state.headerName) return;
    state.headerName = name;
    setHeaderSafe(app, {
      title: name,
      breadcrumbs: [
        { label: 'Cotizaciones', href: '#/cotizaciones' },
        { label: state.quote.code || 'Cotización', href: stepHref('service') },
      ],
      actions: [duplicateBtn, templateBtn, printBtn],
    });
  }

  async function duplicate() {
    if (readOnly) return;
    duplicateBtn.disabled = true;
    try {
      await save();
      const copy = await app.ctx.quotes.duplicateQuote(quoteId);
      if (!copy) {
        notify('No se encontró la cotización para duplicar.', 'warning');
        return;
      }
      notify(`Se creó ${copy.code || 'la copia'}: ${copy.name}.`, 'success');
      navigate(`#/cotizaciones/${encodeURIComponent(copy.id)}/${stepId}`);
    } catch (error) {
      logger.warn('No se pudo duplicar la cotización', { code: error && error.code });
      notify(error && error.code === 'quota_exceeded' && error.message ? error.message : 'No se pudo duplicar la cotización.', 'danger');
    } finally {
      duplicateBtn.disabled = readOnly;
    }
  }

  /**
   * Plantilla de servicio a partir de la cotización (UX-13): copia tipo de
   * servicio, actividad, líneas (con su marca ILUSTRATIVO) y reglas, sin
   * identidad, cliente, código ni estado.
   */
  function templateDefaults(name) {
    const copy = deepClone(state.quote);
    ['id', 'organizationId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'code', 'status', 'client', 'illustrative', 'templateId'].forEach((key) => {
      delete copy[key];
    });
    copy.name = name;
    return copy;
  }

  function saveAsTemplate() {
    if (readOnly) return;
    if (hasInvalidFields()) {
      notify('Revisá los campos marcados antes de guardar la plantilla.', 'warning');
      return;
    }
    const info = illustrativeInfo(state.quote);
    let name = String(state.quote.name || '').trim().slice(0, 120) || 'Plantilla sin nombre';
    let description = state.quote.code ? `Creada desde ${state.quote.code}.` : '';
    const nameField = textField({
      label: 'Nombre de la plantilla',
      value: name,
      maxLength: 120,
      required: true,
      onChange: (v) => {
        name = cleanText(v, 120, false);
      },
    });
    const descField = textField({
      label: 'Descripción',
      value: description,
      maxLength: 300,
      multiline: true,
      hint: 'Para qué sirve, alcance o supuestos.',
      onChange: (v) => {
        description = cleanText(v, 300, true);
      },
    });
    let saving = false;
    const confirmBtn = button('Guardar plantilla', {
      variant: 'primary',
      icon: 'check',
      onClick: async () => {
        if (saving) return;
        const finalName = String(name || '').trim();
        if (!finalName) {
          notify('Poné un nombre para la plantilla.', 'warning');
          return;
        }
        saving = true;
        confirmBtn.disabled = true;
        try {
          const saved = await app.ctx.resources.saveService({
            id: createId(),
            organizationId: state.quote.organizationId ?? null,
            name: finalName,
            description: String(description || '').trim(),
            serviceType: state.quote.serviceType,
            illustrative: info.any,
            defaults: templateDefaults(finalName),
          });
          dialog.close();
          notify(
            h(
              'span',
              {},
              `Se guardó la plantilla "${(saved && saved.name) || finalName}". `,
              h('a', { href: '#/servicios' }, 'Ver plantillas de servicio'),
            ),
            'success',
          );
        } catch (error) {
          logger.warn('No se pudo guardar la plantilla', { code: error && error.code });
          notify(error && error.code === 'quota_exceeded' && error.message ? error.message : 'No se pudo guardar la plantilla.', 'danger');
        } finally {
          saving = false;
          confirmBtn.disabled = false;
        }
      },
    });
    const dialog = openDialog({
      title: 'Guardar como plantilla',
      content: h(
        'div',
        { class: 'stack' },
        h('p', {}, 'La plantilla copia el tipo de servicio, la actividad, el personal, los equipos, los materiales, la logística y las reglas comerciales de esta cotización. No copia el cliente, el código ni el estado. Después la usás desde "Nueva cotización".'),
        info.any ? banner('Esta cotización tiene valores ILUSTRATIVOS: la plantilla también va a quedar marcada como ILUSTRATIVA.', 'warning') : null,
        nameField,
        descField,
      ),
      actions: [button('Cancelar', { variant: 'secondary', onClick: () => dialog.close() }), confirmBtn],
    });
  }

  function print() {
    if (stepId === 'result') {
      window.print();
      return;
    }
    printRequested = true;
    navigate(stepHref('result'));
  }

  // ------------------------------------------------------------- pasos
  let kit = null;
  let stepHandle = null;
  let resultModule = null;
  let resultCleanup = null;
  let resultToken = 0;

  const stepCtx = {
    get quote() {
      return state.quote;
    },
    get settings() {
      return state.settings;
    },
    get result() {
      return state.result;
    },
    get kit() {
      return kit;
    },
    app,
    readOnly,
    quoteId,
    stepId,
    resources,
    update: (path, value) => update(path, value),
    rerender: () => rerenderStep(),
    mutate: (fn, options) => mutate(fn, options),
    focusField: (path) => focusField(path),
    href: stepHref,
    toast: notify,
  };

  function runResultCleanup() {
    const fn = resultCleanup;
    resultCleanup = null;
    if (typeof fn === 'function') {
      try {
        fn();
      } catch (error) {
        logger.warn('Error al limpiar la vista de resultados', { message: error && error.message });
      }
    }
  }

  function drawResult(holder) {
    if (!resultModule || state.disposed) return;
    // Conserva el foco del control activo (por atributo name) al redibujar.
    const active = document.activeElement;
    const focusName = active && holder.contains(active) && active.getAttribute ? active.getAttribute('name') : null;
    runResultCleanup();
    clear(holder);
    try {
      const returned = resultModule.renderQuoteResult(holder, app, {
        quote: deepClone(state.quote),
        result: state.result,
        settings: state.settings,
        onQuoteChange: (path, value) => {
          if (readOnly) {
            notify('Modo sólo lectura: no se guardan cambios.', 'warning');
            return;
          }
          update(path, value);
          scheduleRecalc.cancel();
          recompute();
          refreshAll();
          drawResult(holder);
        },
      });
      if (typeof returned === 'function') resultCleanup = returned;
      else if (returned && typeof returned.then === 'function') {
        returned
          .then((fn) => {
            if (typeof fn !== 'function') return;
            if (state.disposed) fn();
            else resultCleanup = fn;
          })
          .catch((error) => {
            logger.error('Error en la vista de resultados', { message: error && error.message });
            mount(holder, resultFallback(state.result, error));
          });
      }
    } catch (error) {
      logger.error('Error en la vista de resultados', { message: error && error.message });
      mount(holder, resultFallback(state.result, error));
      return;
    }
    if (focusName) {
      const again = holder.querySelector(`[name="${cssEscape(focusName)}"]`);
      if (again) again.focus();
    }
    if (readOnly) lockInputs(holder);
    printIfRequested();
  }

  /** "Imprimir" pedido desde otro paso: imprime cuando el Resultado ya está dibujado. */
  function printIfRequested() {
    if (!printRequested) return;
    printRequested = false;
    setTimeout(() => {
      if (!state.disposed) window.print();
    }, 300);
  }

  async function renderResultStep() {
    const token = ++resultToken;
    const holder = h('div', { class: 'qe-result' }, h('div', { class: 'loading', role: 'status' }, 'Cargando resultados…'));
    mount(stepBody, holder);
    try {
      resultModule = resultModule || (await import('./quote-result.js'));
    } catch (error) {
      if (token !== resultToken || state.disposed) return;
      logger.error('No se pudo cargar la vista de resultados', { message: error && error.message });
      resultModule = null;
      mount(holder, resultFallback(state.result, error));
      printIfRequested();
      return;
    }
    if (token !== resultToken || state.disposed) return;
    if (!resultModule || typeof resultModule.renderQuoteResult !== 'function') {
      const missing = new Error('La vista de resultados no exporta renderQuoteResult().');
      resultModule = null;
      mount(holder, resultFallback(state.result, missing));
      printIfRequested();
      return;
    }
    drawResult(holder);
  }

  function renderStep() {
    runResultCleanup();
    stepHandle = null;
    clear(stepBody);
    kit = createStepKit({
      getQuote: () => state.quote,
      getResult: () => state.result,
      update,
      rerender: () => rerenderStep(),
      readOnly,
      confirmedLines: state.confirmedLines,
    });
    if (stepId === 'result') {
      renderResultStep();
      return;
    }
    const mod = STEP_MODULES[stepId];
    try {
      const handle = mod.render(stepBody, stepCtx);
      stepHandle = handle && typeof handle === 'object' ? handle : null;
    } catch (error) {
      logger.error('No se pudo mostrar el paso', { step: stepId, message: error && error.message });
      mount(stepBody, banner('No se pudo mostrar este paso. Tus datos no se modificaron: probá recargar la página.', 'danger', { title: 'Error en el formulario.' }));
    }
    if (readOnly) lockInputs(stepBody);
  }

  function refreshAll() {
    syncIllustrativeBanner();
    syncInvalidState();
    const r = state.result;
    if (!r) return;
    stepper.update(r);
    if (summary) summary.update(r);
    notices.update(r);
    if (stepId !== 'result') {
      if (kit) kit.refresh(r);
      if (stepHandle && typeof stepHandle.update === 'function') {
        try {
          stepHandle.update(r);
        } catch (error) {
          logger.warn('No se pudieron actualizar los valores del paso', { step: stepId, message: error && error.message });
        }
      }
      decorateFieldIssues(stepBody, (r.issues || []).filter((i) => stepOfPath(i.path) === stepId));
    }
    syncHeader();
    trackCompletion(r);
  }

  /** Evento interno (sin datos sensibles) cuando la completitud llega a 100 % editando. */
  function trackCompletion(r) {
    const score = r.completeness ? r.completeness.scorePct : null;
    const previous = state.lastScorePct;
    state.lastScorePct = score;
    if (previous === null || !isFiniteNumber(score) || previous >= 100 - 1e-9 || score < 100 - 1e-9) return;
    const trackFn = app.ctx && typeof app.ctx.track === 'function' ? app.ctx.track : null;
    const serviceType = SERVICE_TYPES.some((t) => t.id === state.quote.serviceType) ? state.quote.serviceType : 'unknown';
    if (trackFn) trackFn('quote_completed', { serviceType, completed: true });
  }

  /** Con el stepper horizontal (pantallas chicas), centra el paso actual. */
  function revealCurrentStep() {
    const nav = stepper.el;
    const current = nav.querySelector('.qe-step-link.is-current');
    if (!current || nav.scrollWidth <= nav.clientWidth) return;
    const offset = current.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft += offset - (nav.clientWidth - current.offsetWidth) / 2;
  }

  function rerenderStep() {
    if (state.disposed) return;
    scheduleRecalc.cancel();
    recompute();
    renderStep();
    refreshAll();
  }

  /**
   * Al cambiar de paso (UX-03): el título del paso y sus primeros campos
   * tienen que quedar a la vista sin scrollear (en pantallas chicas el
   * formulario va arriba del resumen, pero los avisos pueden empujarlo).
   * Se ejecuta después de que el router enfoca el título de la pantalla.
   */
  function revealStepHead() {
    setTimeout(() => {
      if (state.disposed || !stepHead.isConnected) return;
      const title = stepHead.querySelector('.qe-step-title');
      if (title) {
        try {
          title.focus({ preventScroll: true });
        } catch {
          /* foco opcional */
        }
      }
      const topbar = document.querySelector('.topbar');
      const topbarRect = topbar ? topbar.getBoundingClientRect() : null;
      const offset = topbarRect && getComputedStyle(topbar).position === 'sticky' ? Math.max(0, topbarRect.bottom) : 0;
      const rect = stepHead.getBoundingClientRect();
      // En desktop se tolera que los avisos queden arriba; en pantallas chicas
      // el paso tiene que arrancar cerca del borde superior.
      const share = window.innerWidth <= 980 ? 0.25 : 0.45;
      const comfortable = rect.top >= offset && rect.top <= offset + Math.max(120, (window.innerHeight - offset) * share);
      if (comfortable) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - offset - 12), behavior: 'auto' });
    }, 0);
  }

  // ------------------------------------------------------- ciclo de vida
  const onPageHide = () => {
    revertInvalidFields();
    if (state.dirty) save();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden' && state.dirty && !hasInvalidFields()) save();
  };
  // Si hay cambios que no se pudieron guardar, el navegador pide confirmación
  // antes de cerrar o recargar la pestaña.
  const onBeforeUnload = (event) => {
    if (state.dirty && state.saveStatus === 'error') {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  const api = {
    quoteId,
    mount() {
      setSaveStatus(state.saveStatus);
      recompute();
      mount(root, layout);
      syncHeader(true);
      renderStep();
      refreshAll();
      revealCurrentStep();
      if (revealStep) revealStepHead();
      layout.addEventListener('input', onFieldInput);
      layout.addEventListener('change', onFieldChange);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('beforeunload', onBeforeUnload);
      document.addEventListener('visibilitychange', onVisibility);
      if (restoredDraft) {
        state.dirty = true;
        setSaveStatus('error', { code: 'restored_draft' });
      }
    },
    /** Fuerza el guardado pendiente y libera recursos. Idempotente. */
    dispose() {
      if (state.disposed) return pendingSaves.get(quoteId) || Promise.resolve(true);
      scheduleRecalc.cancel();
      // Un valor inválido sin confirmar vuelve al anterior antes de guardar.
      revertInvalidFields();
      // ¿Se sale hacia otro paso de esta misma cotización?
      const prefix = `#/cotizaciones/${encodeURIComponent(quoteId)}/`;
      stepChangeQuoteId = String(window.location.hash || '').startsWith(prefix) ? quoteId : null;
      const flushing = state.dirty ? save() : pendingSaves.get(quoteId) || Promise.resolve(true);
      state.disposed = true;
      resultToken += 1;
      runResultCleanup();
      layout.removeEventListener('input', onFieldInput);
      layout.removeEventListener('change', onFieldChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      if (activeEditor === api) activeEditor = null;
      return flushing;
    },
  };
  return api;
}

function renderNotFound(root, app) {
  setHeaderSafe(app, {
    title: 'Cotización no encontrada',
    breadcrumbs: [{ label: 'Cotizaciones', href: '#/cotizaciones' }],
    actions: [],
  });
  mount(
    root,
    card(
      { title: 'Cotización no encontrada', subtitle: 'Puede haber sido eliminada o el enlace no es correcto.', className: 'qe-not-found' },
      h('p', {}, 'Volvé al listado para abrir otra cotización o crear una nueva.'),
      h('a', { class: 'btn btn-primary', href: '#/cotizaciones' }, 'Ir a Cotizaciones'),
    ),
  );
}

/**
 * Vista del editor.
 * @param {HTMLElement} root contenedor `.content`
 * @param {object} app contrato de vistas (ctx, navigate, toast, setHeader, getSettings…)
 * @param {{ id: string, step?: string }} params
 * @returns {Promise<Function|undefined>} función de limpieza (fuerza el guardado pendiente)
 */
export async function render(root, app, params = {}) {
  const token = ++renderSequence;
  const id = params && typeof params.id === 'string' ? params.id : '';
  const requested = params && typeof params.step === 'string' && params.step !== '' ? params.step : null;
  const validStep = requested !== null && QUOTE_STEPS.some((s) => s.id === requested);

  // Paso inexistente en la URL (p. ej. …/foo): se corrige la URL al primer
  // paso para que coincida con lo que se ve (QA-E2E-13).
  if (requested !== null && !validStep && id && app && typeof app.navigate === 'function') {
    app.navigate(`#/cotizaciones/${encodeURIComponent(id)}/service`, { replace: true });
    return undefined;
  }
  const stepId = validStep ? requested : 'service';

  // Un editor anterior (otro paso u otra cotización) guarda antes de seguir.
  if (activeEditor) await activeEditor.dispose();
  // Cambio de paso dentro de la misma cotización: se lleva la vista al
  // encabezado del paso nuevo (UX-03).
  const revealStep = Boolean(id) && stepChangeQuoteId === id;
  stepChangeQuoteId = null;
  if (token !== renderSequence) return undefined;

  mount(root, h('div', { class: 'loading', role: 'status' }, 'Cargando cotización…'));
  if (pendingSaves.has(id)) await pendingSaves.get(id);

  let quote;
  let settings;
  let resources;
  try {
    [quote, settings, resources] = await Promise.all([app.ctx.quotes.getQuote(id), app.getSettings(), loadResources(app)]);
  } catch (error) {
    if (token !== renderSequence) return undefined;
    logger.error('No se pudo abrir la cotización', { message: error && error.message });
    setHeaderSafe(app, { title: 'No se pudo abrir la cotización', breadcrumbs: [{ label: 'Cotizaciones', href: '#/cotizaciones' }], actions: [] });
    mount(
      root,
      card(
        { title: 'No se pudo abrir la cotización' },
        h('p', {}, 'Ocurrió un error al leer los datos guardados. Tus datos no se modificaron.'),
        h('a', { class: 'btn btn-primary', href: '#/cotizaciones' }, 'Ir a Cotizaciones'),
      ),
    );
    return undefined;
  }
  if (token !== renderSequence) return undefined;
  if (!quote) {
    renderNotFound(root, app);
    return undefined;
  }

  // Cambios que no se pudieron guardar antes (p. ej. almacenamiento lleno).
  const draft = unsavedDrafts.get(id);
  const editor = createEditor(root, app, { quote: draft ? deepClone(draft) : quote, settings, resources, stepId, restoredDraft: Boolean(draft), revealStep });
  activeEditor = editor;
  editor.mount();
  return () => {
    editor.dispose();
  };
}

