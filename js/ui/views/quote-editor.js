/**
 * Editor de cotización — flujo guiado (orden obligatorio de QUOTE_STEPS).
 *
 * Los 11 pasos internos (y sus URLs #/cotizaciones/:id/:step) se mantienen,
 * pero el usuario ve 5 ETAPAS (STAGES): El servicio · Los recursos · Costos y
 * condiciones · El precio · Resultado. Los nombres de los pasos salen SIEMPRE
 * de QUOTE_STEPS (labelOf): una sola fuente para editor, resultado y listados.
 *
 * Layout:
 *   1. Barra de etapas (navegable, con estado completo / revisar / faltan
 *      datos; las etapas siguientes que todavía no visitaste en esta sesión se
 *      ven en gris como "Pendiente", sin alarmas antes de tiempo).
 *   2. Panel central: sub-pasos de la etapa como segmentos, una pregunta con
 *      su "por qué importa", el formulario (básico + "Opciones avanzadas"
 *      colapsadas) y Atrás / Continuar.
 *   3. Resumen en vivo con 4 números (costo del mes, tarifa piso, tarifa
 *      sugerida, días para no perder) + "Ver más". En pantallas chicas es una
 *      barra compacta fija abajo.
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

import { h, s as svg, mount, clear, debounce, downloadText, uniqueId } from '../dom.js';
import {
  icon,
  button,
  card,
  banner,
  numberField,
  textField,
  selectField,
  checkboxField,
  choiceGroup,
  openDialog,
  openTraceDialog,
  toast as componentToast,
  table,
  disclosure,
  badge,
} from '../components.js';
import { illustrativeTag } from '../layout.js';
import { QUOTE_STEPS, RISK_ITEMS, RATE_UNITS, SERVICE_TYPES } from '../../domain/catalogs.js';
import { defaultVolumeTiers, illustrativeInfo } from '../../domain/quote-factory.js';
import { emptyBillingTaxes } from '../../domain/billing-taxes.js';
import { computeQuote } from '../../engines/quote-engine.js';
import { completenessTone } from '../../engines/completeness-engine.js';
import { getPath, setPath, deepClone, isPlainObject } from '../../core/object.js';
import { formatMoney, formatMoneyCeil, formatMoneyCompact, formatPercent, formatDays, formatNumber, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { parseDecimalInput } from '../../core/validation.js';
import { createId } from '../../core/ids.js';
import { createTrace } from '../../core/trace.js';
import { logger } from '../../core/logger.js';
import { netRateHint, floorDisplay, floorRateTrace, targetRateTrace, unitShortOf, stepName } from './quote-steps/shared.js';

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
  pending: 'pendiente',
});

/** Etapa con sus pasos: los nombres de los pasos vienen de QUOTE_STEPS. */
function defineStage(id, label, short, stepIds) {
  return Object.freeze({ id, label, short, steps: Object.freeze(stepIds.map((stepId) => Object.freeze({ id: stepId, label: stepName(stepId) }))) });
}

/**
 * Etapas visibles del flujo. Agrupan los pasos internos (QUOTE_STEPS), que
 * siguen siendo las URLs. El orden de los pasos es el mismo de QUOTE_STEPS.
 * `short` es el rótulo para celulares, cuando el nombre completo no entra.
 */
export const STAGES = Object.freeze([
  defineStage('service', 'El servicio', 'Servicio', ['service', 'modality']),
  defineStage('resources', 'Los recursos', 'Recursos', ['labor', 'equipment', 'materials', 'logistics']),
  defineStage('conditions', 'Costos y condiciones', 'Costos', ['indirect', 'finance', 'risk']),
  defineStage('price', 'El precio', 'Precio', ['margin']),
  defineStage('result', 'Resultado', 'Resultado', ['result']),
]);

/**
 * Pasos que el usuario abrió en esta sesión, por cotización (SÓLO en
 * memoria: no se persiste). Una etapa posterior a la actual que todavía no
 * se visitó se muestra "Pendiente" en lugar de "Faltan datos".
 */
const visitedSteps = new Map();

function markVisited(quoteId, stepId) {
  if (!visitedSteps.has(quoteId)) visitedSteps.set(quoteId, new Set());
  visitedSteps.get(quoteId).add(stepId);
}

function wasVisited(quoteId, stepId) {
  return Boolean(visitedSteps.get(quoteId) && visitedSteps.get(quoteId).has(stepId));
}

/** Etapa (y posición) de un paso interno. */
export function stageOfStep(stepId) {
  const index = STAGES.findIndex((stage) => stage.steps.some((s) => s.id === stepId));
  const stage = STAGES[index >= 0 ? index : 0];
  return { stage, index: index >= 0 ? index : 0, subIndex: Math.max(0, stage.steps.findIndex((s) => s.id === stepId)) };
}

/** Nombre de un paso (p. ej. "Viajes"): el de QUOTE_STEPS. */
export function stepShortLabel(stepId) {
  return stepName(stepId);
}

/**
 * Cada paso empieza con una pregunta y una o dos líneas de POR QUÉ importa.
 * El término técnico queda como ayuda secundaria.
 */
export const STEP_COPY = Object.freeze({
  service: {
    question: '¿Qué servicio vas a prestar?',
    why: 'El tipo de servicio define cómo se cobra y qué costos aparecen.',
  },
  modality: {
    question: '¿Cómo lo vas a cobrar?',
    why: 'Contanos si ya tenés una tarifa o si querés que RATEOS calcule cuánto cobrar, y cuántos días por mes esperás trabajar.',
  },
  labor: {
    question: '¿Quiénes trabajan en el servicio?',
    why: 'El personal suele ser el costo más grande. Incluí relevos si el servicio es 24/7.',
  },
  equipment: {
    question: '¿Qué equipos usás?',
    why: 'Un equipo cuesta aunque esté parado: amortización, seguro, patente. Por eso separamos lo que cuesta tenerlo de lo que cuesta usarlo.',
  },
  materials: {
    question: '¿Qué materiales o insumos consumís?',
    why: 'Consumibles, repuestos menores y elementos que se gastan al prestar el servicio. Si los provee el cliente, no son costo tuyo.',
  },
  logistics: {
    question: '¿Cuánto cuesta llegar?',
    why: 'Combustible, kilómetros y viáticos se pagan aunque nadie los vea en la factura.',
  },
  indirect: {
    question: '¿Cuánto de la estructura de tu empresa carga este servicio?',
    why: 'Administración, base, seguridad e higiene, sistemas: cada servicio tiene que ayudar a pagar los gastos de estructura.',
    term: 'Costos indirectos (overhead)',
  },
  finance: {
    question: '¿Cuánto tiempo tenés que financiar el servicio?',
    why: 'Si cobrás a 60 días, tenés que adelantar sueldos y combustible. Esa plata tiene un costo.',
    term: 'Capital de trabajo',
  },
  risk: {
    question: '¿Qué imprevistos pueden aparecer?',
    why: 'Clima, roturas, días improductivos: reservá un porcentaje para lo que no podés anticipar, así no sale de tu ganancia.',
    term: 'Contingencia',
  },
  margin: {
    question: '¿Cuánto querés ganar?',
    why: 'El margen es lo que te queda de cada $ 100 que facturás. Con ese dato calculamos la tarifa sugerida.',
    term: 'Margen sobre el precio (no es markup)',
  },
  result: {
    question: 'Resultado',
    why: '',
  },
});

/**
 * Ítems de completitud que se corrigen dentro de unas "Opciones avanzadas":
 * el aviso del paso ofrece abrirlas y el disclosure muestra "Revisar".
 */
const ITEM_ADVANCED_KEY = Object.freeze({ standby: 'margin-rules' });

/**
 * Estado abierto/cerrado de las "Opciones avanzadas", SÓLO en memoria
 * (por cotización y sección) mientras dura la sesión: no se persiste.
 */
const advancedOpenState = new Map();

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
    case 'billingTaxes':
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

/** Estado de una etapa: el peor de sus pasos (rojo > naranja > verde > gris). */
export function stageStatus(stage, result) {
  if (!stage || !result) return 'gray';
  const statuses = stage.steps.map((s) => stepStatus(s.id, result));
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('orange')) return 'orange';
  if (statuses.includes('green')) return 'green';
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
  // Impuestos sobre la facturación: sin definir si faltan (t = 0: el cálculo no cambia).
  if (!isPlainObject(q.billingTaxes)) q.billingTaxes = emptyBillingTaxes();
  if (!Array.isArray(q.billingTaxes.items)) q.billingTaxes.items = [];
  return q;
}

/**
 * Encabezados sin saltos de nivel (WCAG 1.3.1 / A11Y-7): los pasos arman sus
 * títulos con niveles relativos (tarjeta, línea, grupo) y, según lo que haya
 * arriba, un h4 o h5 podía quedar después de un h2. Recorre los encabezados
 * en orden y baja cada uno, como mucho, a un nivel más que el anterior. Los
 * hijos (y sus salidas calculadas) se mueven al encabezado nuevo.
 */
export function normalizeHeadings(container, parentLevel = 2) {
  let previous = parentLevel;
  container.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    const level = Number(heading.tagName.slice(1));
    const allowed = Math.min(6, previous + 1);
    if (level <= allowed) {
      previous = level;
      return;
    }
    const replacement = document.createElement(`h${allowed}`);
    [...heading.attributes].forEach((attr) => replacement.setAttribute(attr.name, attr.value));
    while (heading.firstChild) replacement.appendChild(heading.firstChild);
    heading.replaceWith(replacement);
    previous = allowed;
  });
}

/**
 * Tablas que HOY hacen scroll horizontal (pantallas chicas): región con
 * nombre y, si no tienen controles adentro, enfocables para desplazarlas con
 * el teclado (A11Y-10). Las que entran completas no suman regiones de más:
 * se vuelve a evaluar en cada recálculo y al cambiar el ancho de la ventana.
 */
function labelScrollRegions(container) {
  container.querySelectorAll('.table-wrap').forEach((wrap) => {
    const scrolls = wrap.getClientRects().length > 0 && wrap.scrollWidth > wrap.clientWidth + 1;
    const labeled = wrap.dataset.qeRegion === 'true';
    if (scrolls && !labeled) {
      wrap.dataset.qeRegion = 'true';
      const caption = wrap.querySelector('caption');
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', (caption && caption.textContent.trim()) || 'Tabla');
      if (!wrap.querySelector('input, select, textarea, button, a[href]')) wrap.setAttribute('tabindex', '0');
    } else if (!scrolls && labeled) {
      delete wrap.dataset.qeRegion;
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-label');
      wrap.removeAttribute('tabindex');
    }
  });
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
function createStepKit({ getQuote, getResult, update, rerender, readOnly, confirmedLines = new Set(), openState = null }) {
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
    out(fn, { tag = 'span', className = null, allowEmpty = false } = {}) {
      const el = h(tag, { class: ['qe-out', className] });
      watch((result) => {
        const content = evaluate(fn, result);
        if (allowEmpty && (content === null || content === undefined || content === '')) {
          el.textContent = '';
          return;
        }
        setContent(el, content);
      });
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
    stat(label, fn, { hint = null, tone = null, trace = null, traceLabel = null, className = null, emphasis = false } = {}) {
      const el = h(
        'div',
        { class: ['qe-stat', emphasis ? 'is-emphasis' : null, className] },
        h('div', { class: 'qe-stat-label' }, typeof label === 'function' ? kit.out(label) : label),
        kit.out(fn, { className: 'qe-stat-value mono' }),
        // Una ayuda calculada vacía no muestra "—": el renglón se oculta (CSS).
        hint ? h('div', { class: 'qe-stat-hint' }, typeof hint === 'function' ? kit.out(hint, { allowEmpty: true }) : hint) : null,
        // "Ver cálculo" con nombre accesible que dice QUÉ cálculo abre.
        trace ? kit.trace(trace, { ariaLabel: traceLabel || (typeof label === 'string' ? `Ver cálculo: ${label}` : null) }) : null,
      );
      if (tone) kit.tone(el, tone);
      return el;
    },

    stats(...items) {
      return h('div', { class: 'qe-stats' }, ...items);
    },

    /** Botón "Ver cálculo": traceFn(result) → traza (se arma al hacer clic). */
    trace(traceFn, { label = 'Ver cálculo', ariaLabel = null } = {}) {
      return button(label, {
        variant: 'link',
        size: 'sm',
        icon: 'calc',
        attrs: { class: 'btn btn-link btn-sm trace-btn', 'aria-label': ariaLabel },
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

    /** Efecto libre que se ejecuta en cada recálculo: fn(result). */
    effect(fn) {
      watch(fn);
    },

    /**
     * "Opciones avanzadas" (o "Ver detalle"): sección colapsable con un
     * resumen VISIBLE de lo que hay adentro (no se esconden datos críticos).
     *   key      → id estable de la sección (para recordar si estaba abierta)
     *   title    → texto del summary
     *   summary  → texto/nodo o fn(result) con lo aplicado (se refresca)
     *   variant  → 'options' (campos avanzados) | 'detail' (cálculos)
     *   boxed    → con caja propia (fuera de una tarjeta)
     *   defaultOpen → abierta si el usuario todavía no la abrió ni cerró
     *   flag     → fn(result) que devuelve { tone, text } para marcar el summary
     * Si adentro hay un campo inválido o con un aviso del motor, el editor la
     * abre sola (ver syncAdvanced en createEditor).
     */
    advanced({ key, title = 'Opciones avanzadas', summary = null, variant = 'options', boxed = false, defaultOpen = false, flag = null, className = null } = {}, ...children) {
      const hint = summary === null || summary === undefined
        ? null
        : typeof summary === 'function'
          ? kit.out(summary, { className: 'qe-adv-hint', allowEmpty: true })
          : h('span', { class: 'qe-adv-hint' }, summary);
      const badgeSlot = h('span', { class: 'qe-adv-badge', hidden: true });
      // Lo que el usuario abrió o cerró en esta sesión manda; si no, defaultOpen.
      const remembered = openState && key ? openState.get(key) : undefined;
      const open = typeof remembered === 'boolean' ? remembered : Boolean(defaultOpen);
      const el = disclosure(
        {
          summary: h('span', { class: 'qe-adv-title' }, variant === 'options' ? icon('settings', { size: 16 }) : icon('calc', { size: 16 }), h('span', {}, title)),
          hint,
          badge: badgeSlot,
          open,
          className: ['qe-adv', `qe-adv-${variant}`, boxed ? null : 'disclosure-plain', className].filter(Boolean).join(' '),
          onToggle: (isOpen) => {
            if (openState && key) openState.set(key, isOpen);
          },
        },
        ...children,
      );
      if (key) el.dataset.advKey = key;
      // flag(result) → null | { tone: 'orange'|'red', text }: aviso propio de la sección.
      if (typeof flag === 'function') el.qeFlag = flag;
      return el;
    },

    /** Sub-pregunta dentro de un paso: título + por qué importa (+ término técnico). */
    question(title, why = null, { term = null, level = 3 } = {}) {
      return h(
        'div',
        { class: 'qe-question' },
        h(`h${level}`, { class: 'qe-question-title' }, title),
        why ? h('p', { class: 'qe-question-why' }, why) : null,
        term ? h('p', { class: 'qe-term' }, h('span', { class: 'qe-term-label' }, 'Término técnico:'), ` ${term}`) : null,
      );
    },

    /**
     * Línea de resultado clave (lo que este paso suma al costo):
     *   label · valor grande · detalle · "Ver cálculo".
     */
    keyline({ label, value, hint = null, trace = null, tone = null, className = null }) {
      const el = h(
        'div',
        { class: ['qe-keyline', className] },
        h(
          'div',
          { class: 'qe-keyline-main' },
          h('span', { class: 'qe-keyline-label' }, typeof label === 'function' ? kit.out(label) : label),
          kit.out(value, { className: 'qe-keyline-value' }),
          hint ? h('span', { class: 'qe-keyline-hint' }, typeof hint === 'function' ? kit.out(hint, { allowEmpty: true }) : hint) : null,
        ),
        trace ? kit.trace(trace) : null,
      );
      if (tone) kit.tone(el, tone);
      return el;
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
    known_rate: `Tu tarifa (la cargaste en "${stepName('modality')}")`,
    offered: `Tarifa ofrecida a mano (en "${stepName('margin')}")`,
    suggested: 'Sugerida: precio objetivo redondeado hacia arriba',
    override: 'Tarifa forzada',
    none: 'Sin tarifa',
  }[k.commercialSource] || 'Sin tarifa';
  return createTrace({
    id: 'commercial_rate',
    // En la superficie se llama como la ve el usuario (Tarifa sugerida / Tu tarifa…).
    title: chargedRateLabel(r),
    formula: k.commercialSource === 'suggested'
      ? 'Tarifa comercial = Precio objetivo de lista redondeado hacia arriba al múltiplo de redondeo · Tarifa neta = lista × factor de descuentos'
      : 'Tarifa comercial = tarifa ingresada · Tarifa neta = lista × factor de descuentos (tramo × continuidad × comercial)',
    inputs: [
      { label: 'Origen', value: sourceLabel, format: 'text' },
      { label: k.targetMarginInvalid ? 'Precio objetivo de lista (margen inválido)' : `Precio objetivo de lista (margen ${formatPercent(k.targetMarginPct)})`, value: k.targetListRate, format: 'money' },
      { label: 'Tarifa sugerida (redondeada)', value: k.suggestedListRate, format: 'money' },
      { label: 'Factor de descuentos con la actividad estimada', value: r.estimate && r.estimate.revenue ? r.estimate.revenue.discountFactor : null, format: 'number' },
    ],
    steps: [{ label: 'Tarifa neta (después de descuentos)', value: k.commercialNetRate, format: 'money' }],
    result: { label: `Tarifa comercial de lista (por ${unitShort(r)})`, value: k.commercialListRate, format: 'money' },
    notes: [
      k.belowFloor ? 'La tarifa neta queda DEBAJO de la tarifa piso: con la actividad estimada perdés plata.' : null,
      !k.belowFloor && k.belowFloorRate
        ? 'La tarifa neta queda debajo de la tarifa piso, pero con la actividad estimada el mínimo mensual garantizado cubre los costos. Si la actividad cambia, podés perder plata.'
        : null,
      'Margen y markup no son lo mismo: el margen se calcula sobre el precio; el markup, sobre el costo.',
    ],
  });
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

/**
 * Qué incluye la tarifa piso respecto de los impuestos sobre lo que se
 * factura (PLAN-2026-002): el usuario tiene que saber si ya los cubre.
 */
export function floorTaxesText(r) {
  const k = r && r.kpis ? r.kpis : {};
  if (k.billingTaxesInvalid) return 'No incluye los impuestos sobre lo que facturás: hay un porcentaje a revisar en "El precio".';
  if (!k.billingTaxesDefined) return 'No incluye los impuestos sobre lo que facturás (sin definir).';
  if (r.billingTaxInfo && r.billingTaxInfo.notApplicable) return 'Sin impuestos sobre lo que facturás.';
  if (!(k.billingTaxPct > 0)) return 'Sin impuestos sobre lo que facturás (cargaste 0 %).';
  return `Incluye ${formatPercent(k.billingTaxPct)} de impuestos sobre lo que facturás.`;
}

/** Nombre de la tarifa que se cobra, según su origen. */
function chargedRateLabel(r) {
  switch (r && r.kpis && r.kpis.commercialSource) {
    case 'known_rate':
      return 'Tu tarifa';
    case 'offered':
      return 'Tarifa ofrecida';
    case 'override':
      return 'Tarifa forzada';
    default:
      return 'Tarifa sugerida';
  }
}

/**
 * Días mínimos para no perder (break-even) como texto. En la superficie, con
 * 1 decimal ("6,4 días", igual que el Resultado); los 2 decimales quedan
 * para "Ver cálculo".
 */
function breakEvenText(r, { decimals = 1 } = {}) {
  const be = r.breakEven || {};
  if (be.notApplicable) return 'No aplica';
  if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
  return formatDays(be.days, { decimals });
}

function rateHint(r) {
  const k = r.kpis;
  let text;
  switch (k.commercialSource) {
    case 'known_rate':
      text = `La ingresaste en "${stepName('modality')}".`;
      break;
    case 'offered':
      text = `La cargaste a mano en "${stepName('margin')}".`;
      break;
    case 'override':
      text = 'Tarifa forzada.';
      break;
    case 'suggested':
      text = `Para ganar ${formatPercent(r.kpis.targetMarginPct)} de margen, redondeada hacia arriba.`;
      break;
    default:
      if (r.pricingMode === 'known_rate') text = `Falta ingresar tu tarifa en "${stepName('modality')}".`;
      else if (k.targetMarginInvalid) {
        text = k.billingTaxPct > 0
          ? `Sin tarifa sugerida: con ${formatPercent(k.billingTaxPct)} de impuestos sobre lo que facturás, el margen tiene que ser menor a ${formatPercent(100 - k.billingTaxPct)}. Bajalo en "El precio".`
          : 'Sin tarifa sugerida: el margen objetivo no es válido. Corregilo en "El precio".';
      } else text = 'Cargá los días por mes para calcularla.';
  }
  const net = isFiniteNumber(k.commercialNetRate) && isFiniteNumber(k.commercialListRate) && Math.abs(k.commercialNetRate - k.commercialListRate) > 0.005
    ? ` Neta: ${formatMoney(k.commercialNetRate)} (después de descuentos).`
    : '';
  return `${text}${net}`;
}

/**
 * Resumen en vivo: 4 números (costo del mes, tarifa piso, tarifa que se
 * cobra y días para no perder), cada uno con "Ver cálculo", y "Ver más" con
 * el resto (precio para el margen, resultado, margen esperado, completitud).
 * En pantallas chicas es una barra compacta fija abajo que se expande.
 */
function buildSummary({ getResult, stepHref }) {
  const rows = [];

  const item = ({ key, label, short = null, value, unit = null, compact = null, hint, tone = null, trace = null }) => {
    const labelEl = h('span', { class: 'qe-sum-label' });
    // Rótulo corto para la barra compacta (pantallas chicas); el completo queda para lectores de pantalla.
    const shortEl = short ? h('span', { class: 'qe-sum-short', 'aria-hidden': 'true' }) : null;
    const numberEl = h('span', { class: 'qe-sum-number' });
    const unitEl = h('span', { class: 'qe-sum-unit' });
    const compactNum = h('span', {});
    const compactUnit = h('span', { class: 'qe-sum-compact-unit' });
    const compactEl = compact ? h('span', { class: 'qe-sum-compact', 'aria-hidden': 'true' }, compactNum, compactUnit) : null;
    const valueEl = h('div', { class: 'qe-sum-value' }, h('span', { class: 'qe-sum-full' }, numberEl, unitEl), compactEl);
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
          else componentToast('Todavía no hay datos suficientes para mostrar este cálculo.', 'info');
        },
      })
      : null;
    const el = h('div', { class: 'qe-sum-item', dataset: { kpi: key } }, h('div', { class: 'qe-sum-labels' }, labelEl, shortEl), valueEl, hintEl, traceBtn);
    rows.push({ el, labelEl, shortEl, numberEl, unitEl, compactEl, compactNum, compactUnit, hintEl, traceBtn, label, short, value, unit, compact, hint, tone });
    return el;
  };

  const main = h(
    'div',
    { class: 'qe-sum-list qe-sum-main' },
    item({
      key: 'totalCost',
      label: 'Costo del mes',
      short: 'Costo del mes',
      value: (r) => formatMoney(r.kpis.totalCost),
      compact: (r) => formatMoneyCompact(r.kpis.totalCost),
      hint: (r) => `Con ${formatNumber(r.kpis.activeDays, { decimals: 2 })} días trabajados de ${formatNumber(r.activity.availableDaysPerMonth, { decimals: 2 })} disponibles.`,
      trace: (r) => r.traces.totalCost,
    }),
    item({
      key: 'floorRate',
      // Base de LISTA: es la que se escribe en la cotización (UX-01).
      label: (r) => (floorDisplay(r).base === 'net' ? 'Tarifa piso (neta)' : 'Tarifa piso'),
      short: 'Tarifa piso',
      value: (r) => formatMoneyCeil(floorDisplay(r).value),
      unit: (r) => `/ ${unitShort(r)}`,
      compact: (r) => formatMoneyCompact(floorDisplay(r).value, { ceil: true }),
      hint: (r) => {
        const floor = floorDisplay(r);
        if (!isFiniteNumber(floor.value)) return 'Cargá los días por mes para calcularla.';
        const net = floor.base === 'list' ? netRateHint(r.kpis.floorNetRate, r) : '';
        return `Precio mínimo para no perder (margen 0 %), sin IVA. ${floorTaxesText(r)}${net ? ` ${net}` : ''}`;
      },
      tone: (r) => (r.kpis.billingTaxesDefined || !isFiniteNumber(floorDisplay(r).value) ? null : 'orange'),
      trace: floorRateTrace,
    }),
    item({
      key: 'commercialRate',
      label: chargedRateLabel,
      short: (r) => ({ 'Tarifa sugerida': 'Sugerida', 'Tarifa ofrecida': 'Ofrecida', 'Tarifa forzada': 'Forzada' }[chargedRateLabel(r)] || chargedRateLabel(r)),
      value: (r) => (r.kpis.commercialSource === 'suggested' ? formatMoneyCeil(r.kpis.commercialListRate) : formatMoney(r.kpis.commercialListRate)),
      unit: (r) => `/ ${unitShort(r)}`,
      compact: (r) => formatMoneyCompact(r.kpis.commercialListRate, { ceil: r.kpis.commercialSource === 'suggested' }),
      hint: rateHint,
      tone: (r) => (isFiniteNumber(r.kpis.commercialListRate) ? resultTone(r) : null),
      trace: commercialRateTrace,
    }),
    item({
      key: 'breakEven',
      label: 'Días para no perder',
      short: 'Para no perder',
      value: (r) => breakEvenText(r),
      compact: (r) => breakEvenText(r),
      hint: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !be.reachable) return be.reason || '';
        return `Mínimo ${formatNumber(be.wholeDays)} días enteros · estimás ${formatNumber(r.kpis.activeDays, { decimals: 2 })} (break-even).`;
      },
      tone: breakEvenTone,
      trace: (r) => r.traces.breakEven,
    }),
  );

  const more = h(
    'div',
    { class: 'qe-sum-list qe-sum-more-list' },
    item({
      key: 'targetRate',
      label: (r) => (r.kpis.targetMarginInvalid ? 'Precio objetivo' : `Precio para tu margen de ${formatPercent(r.kpis.targetMarginPct)}`),
      value: (r) => formatMoneyCeil(r.kpis.targetListRate),
      unit: (r) => `/ ${unitShort(r)}`,
      hint: (r) => {
        if (r.kpis.targetMarginInvalid) return 'Sin precio objetivo: revisá el margen en "El precio".';
        // Recargo efectivo calculado por el motor (con impuestos sobre la facturación).
        const mk = r.kpis.targetMarkupPct;
        const net = netRateHint(r.kpis.targetNetRate, r);
        const taxed = r.kpis.billingTaxPct > 0 && isFiniteNumber(r.kpis.targetProfitOnCostPct);
        const markup = isFiniteNumber(mk)
          ? `Equivale a un markup (recargo sobre el costo) de ${formatPercent(mk)}${taxed ? `: tu ganancia es ${formatPercent(r.kpis.targetProfitOnCostPct)} del costo y el resto son impuestos` : ''}.`
          : '';
        return [`Tarifa de lista sin redondear, sin IVA.`, net, markup].filter(Boolean).join(' ');
      },
      trace: targetRateTrace,
    }),
    item({
      key: 'expectedResult',
      label: 'Resultado esperado del mes',
      value: (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatMoney(r.kpis.profit) : EMPTY),
      hint: (r) => (isFiniteNumber(r.kpis.commercialListRate) ? `Facturás ${formatMoney(r.kpis.revenue)} por mes.` : 'Sin tarifa todavía.'),
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
        const base = k.targetMarginInvalid ? 'Objetivo inválido' : `Objetivo ${formatPercent(k.targetMarginPct)}`;
        if (!isFiniteNumber(k.commercialListRate) || !isFiniteNumber(k.marginPct)) return `${base} · sin tarifa todavía.`;
        const state = k.profit < 0 ? 'perdés plata' : k.belowTarget ? 'debajo del objetivo' : 'cumple el objetivo';
        const markup = isFiniteNumber(k.markupPct) ? ` · markup ${formatPercent(k.markupPct)}` : '';
        return `${base} · ${state}${markup}.`;
      },
      tone: resultTone,
      trace: (r) => r.traces.expectedResult,
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
    h('div', { class: 'qe-sum-top' }, h('span', { class: 'qe-sum-label' }, '¿Te falta cargar algo?'), pctEl),
    bar,
    pendingEl,
  );

  const moreHint = h('span', { class: 'qe-sum-more-hint' });
  const moreEl = disclosure({ summary: 'Ver más', hint: moreHint, className: 'disclosure-plain qe-sum-more' }, more, completeness);

  // En pantallas chicas el resumen es una barra fija que se expande con
  // "Ver detalle" (aria-controls → el contenido que se expande). Escape lo
  // cierra y se cierra solo al enfocar un campo del formulario (no tapa lo que
  // se está editando).
  const inner = h('div', { class: 'qe-summary-inner', id: uniqueId('qe-resumen') });
  const toggleText = h('span', {}, 'Ver detalle');
  const setExpanded = (expanded) => {
    inner.classList.toggle('is-expanded', expanded);
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggleText.textContent = expanded ? 'Ocultar detalle' : 'Ver detalle';
  };
  const toggleBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-link btn-sm qe-sum-toggle',
      'aria-expanded': 'false',
      'aria-controls': inner.id,
      on: { click: () => setExpanded(!inner.classList.contains('is-expanded')) },
    },
    toggleText,
    icon('chevronRight', { size: 16 }),
  );
  mount(
    inner,
    h(
      'div',
      { class: 'qe-summary-head' },
      h('div', { class: 'qe-summary-titles' }, h('h2', { class: 'qe-summary-title' }, 'Resumen en vivo'), h('span', { class: 'qe-summary-sub' }, 'Se recalcula mientras editás')),
      toggleBtn,
    ),
    main,
    moreEl,
  );
  const el = h('aside', { class: 'qe-summary', 'aria-label': 'Resumen en vivo de la cotización' }, inner);
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !inner.classList.contains('is-expanded')) return;
    // Un diálogo abierto encima (Ver cálculo) maneja su propio Escape.
    if (event.defaultPrevented) return;
    event.preventDefault();
    setExpanded(false);
    toggleBtn.focus();
  });

  function resolve(v, r) {
    if (typeof v !== 'function') return v;
    try {
      return v(r);
    } catch (error) {
      logger.warn('No se pudo calcular un indicador del resumen', { message: error && error.message });
      return EMPTY;
    }
  }

  // Altura REAL de la barra plegada → --qe-sum-h en <html> (CSSOM, como la
  // topbar): css/quote.css la usa como scroll-padding-bottom para que el
  // campo enfocado nunca quede debajo de la barra fija (A11Y-1). Expandida no
  // se publica: ahí el foco está dentro del resumen.
  const rootStyle = document.documentElement.style;
  const publishHeight = () => {
    if (!el.isConnected || inner.classList.contains('is-expanded')) return;
    const height = el.getBoundingClientRect().height;
    if (height > 0) rootStyle.setProperty('--qe-sum-h', `${Math.ceil(height)}px`);
  };
  const heightObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => publishHeight()) : null;
  if (heightObserver) heightObserver.observe(el);

  return {
    el,
    /** Deja de seguir la altura de la barra (al salir del editor). */
    dispose() {
      if (heightObserver) heightObserver.disconnect();
      rootStyle.removeProperty('--qe-sum-h');
    },
    /** Cierra la barra expandida (pantallas chicas). */
    collapse() {
      if (inner.classList.contains('is-expanded')) setExpanded(false);
    },
    update(r) {
      if (!r) return;
      rows.forEach((row) => {
        row.labelEl.textContent = resolve(row.label, r) || '';
        if (row.shortEl) row.shortEl.textContent = resolve(row.short, r) || '';
        if (row.traceBtn) row.traceBtn.setAttribute('aria-label', `Ver cálculo: ${row.labelEl.textContent}`);
        const value = resolve(row.value, r) || EMPTY;
        row.numberEl.textContent = value;
        const unit = value === EMPTY ? '' : resolve(row.unit, r) || '';
        row.unitEl.textContent = unit && unit !== EMPTY ? ` ${unit}` : '';
        if (row.compactEl) {
          const compact = resolve(row.compact, r) || EMPTY;
          row.compactNum.textContent = compact;
          row.compactUnit.textContent = compact !== EMPTY && unit && unit !== EMPTY ? unit.replace('/ ', '/') : '';
        }
        const hint = resolve(row.hint, r);
        row.hintEl.textContent = hint && hint !== EMPTY ? hint : '';
        row.hintEl.hidden = !row.hintEl.textContent;
        const tone = row.tone ? resolve(row.tone, r) : null;
        if (tone && tone !== EMPTY && tone !== 'gray') row.el.dataset.tone = tone;
        else delete row.el.dataset.tone;
      });
      const pct = r.completeness ? r.completeness.scorePct : null;
      const v = isFiniteNumber(pct) ? Math.max(0, Math.min(100, pct)) : 0;
      pctEl.textContent = isFiniteNumber(pct) ? `${formatNumber(pct, { decimals: 0 })} % completo` : EMPTY;
      barFill.style.setProperty('width', `${v}%`);
      bar.className = `progress progress-${completenessColor(pct)}`;
      bar.setAttribute('aria-valuenow', String(Math.round(v)));
      const pending = (r.completeness && r.completeness.pending) || [];
      moreHint.textContent = pending.length === 0
        ? 'Precio para tu margen, resultado y margen esperados.'
        : `${pending.length} ${pending.length === 1 ? 'pendiente' : 'pendientes'} de costos · resultado y margen esperados.`;
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
          pending.length > 3 ? h('li', { class: 'qe-pending-more' }, `y ${pending.length - 3} más (ver el estado de cada etapa)`) : null,
        );
      }
    },
  };
}

// ------------------------------------------------------------------ etapas

/**
 * Estado que se MUESTRA de un paso o etapa: un paso posterior al actual que
 * todavía no se visitó en esta sesión no alarma ("Pendiente", en gris) salvo
 * que ya esté completo.
 */
function shownStatus(status, { after, visited }) {
  return after && !visited && status !== 'green' ? 'pending' : status;
}

/**
 * Barra de las 5 etapas (navegable). Cada etapa muestra si está completa,
 * si hay algo para revisar o si faltan datos (según completitud y validaciones).
 */
function buildStageBar({ currentStep, stepHref, quoteId }) {
  const { index: currentIndex } = stageOfStep(currentStep);
  const entries = STAGES.map((stage, index) => {
    const isCurrent = index === currentIndex;
    const numEl = h('span', { class: 'qe-stage-num', 'aria-hidden': 'true' }, String(index + 1));
    // Marca "!" sobre el número (cuando el texto del estado no entra): el estado no depende sólo del color.
    const flagEl = h('span', { class: 'qe-stage-flag', 'aria-hidden': 'true', hidden: true });
    const stateEl = h('span', { class: 'qe-stage-state' });
    const labelEl = h('span', { class: 'qe-stage-label' }, stage.label);
    // Rótulo corto (celulares): el nombre accesible sigue siendo el aria-label del enlace.
    const shortEl = h('span', { class: 'qe-stage-short' }, stage.short || stage.label);
    const link = h(
      'a',
      { href: stepHref(stage.steps[0].id), class: ['qe-stage-link', isCurrent ? 'is-current' : null], 'aria-current': isCurrent ? 'step' : null },
      h('span', { class: 'qe-stage-mark' }, numEl, flagEl),
      h('span', { class: 'qe-stage-text' }, labelEl, shortEl, stateEl),
    );
    const li = h('li', { class: ['qe-stage', isCurrent ? 'is-current' : null, index < currentIndex ? 'is-before' : null], dataset: { stage: stage.id } }, link);
    return { stage, index, li, link, numEl, flagEl, stateEl, labelEl, shortEl, isCurrent, flag: null };
  });
  const el = h(
    'nav',
    { class: 'qe-stages', 'aria-label': 'Etapas de la cotización' },
    h('ol', { class: 'qe-stage-list' }, ...entries.map((e) => e.li)),
  );
  const STATE_LABEL = { green: 'Completo', orange: 'Revisar', red: 'Faltan datos', gray: '', pending: 'Pendiente' };

  // En celulares sólo la etapa actual muestra su nombre. Si el nombre
  // completo no entra, se usa el corto ("Costos"); si tampoco entra, queda
  // sólo el número resaltado (el antetítulo "Etapa 3 de 5 · …" y el
  // aria-label la nombran). Nunca un nombre recortado con "…".
  const current = entries.find((e) => e.isCurrent);
  const overflows = (node) => node.getClientRects().length > 0 && node.scrollWidth > node.clientWidth + 1;
  const fitCurrentLabel = () => {
    if (!current || !el.isConnected) return;
    el.classList.remove('is-short', 'is-numbers');
    if (!overflows(current.labelEl)) return;
    el.classList.add('is-short');
    if (!overflows(current.shortEl)) return;
    el.classList.add('is-numbers');
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitCurrentLabel()) : null;
  if (resizeObserver) resizeObserver.observe(el);

  return {
    el,
    fit: fitCurrentLabel,
    dispose() {
      if (resizeObserver) resizeObserver.disconnect();
    },
    update(result) {
      entries.forEach((e) => {
        const visited = e.stage.steps.some((st) => wasVisited(quoteId, st.id));
        const status = e.stage.id === 'result' ? 'gray' : shownStatus(stageStatus(e.stage, result), { after: e.index > currentIndex, visited });
        e.li.dataset.status = status;
        const stateText = e.isCurrent ? 'Estás acá' : STATE_LABEL[status];
        e.stateEl.textContent = stateText;
        e.stateEl.hidden = !stateText;
        e.link.title = e.stage.id === 'result' ? 'Resultado' : `${e.stage.label}: ${STATUS_TEXT[status]}`;
        if (e.stage.id !== 'result' && e.isCurrent) e.link.setAttribute('aria-label', `Etapa ${e.index + 1}: ${e.stage.label} (estás acá, ${STATUS_TEXT[status]})`);
        else if (e.stage.id !== 'result') e.link.setAttribute('aria-label', `Etapa ${e.index + 1}: ${e.stage.label} (${STATUS_TEXT[status]})`);
        else e.link.setAttribute('aria-label', `Etapa ${e.index + 1}: Resultado${e.isCurrent ? ' (estás acá)' : ''}`);
        if (status === 'green' && !e.isCurrent) mount(e.numEl, icon('check', { size: 15 }));
        else e.numEl.textContent = String(e.index + 1);
        const flag = !e.isCurrent && (status === 'orange' || status === 'red') ? status : null;
        if (flag !== e.flag) {
          e.flag = flag;
          if (flag) mount(e.flagEl, substepIcon(flag));
          else clear(e.flagEl);
          e.flagEl.hidden = !flag;
        }
      });
    },
  };
}

/**
 * Ícono de estado de un sub-paso: tilde (completo) o "!" (revisar / faltan
 * datos). El "!" es un recorte del círculo (fill-rule evenodd), no un trazo
 * blanco encima: en alto contraste se ve el fondo a través del recorte y la
 * marca no se pierde (A11Y-8).
 */
const ALERT_MARK_PATH = 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM7 4.5v4a1 1 0 0 0 2 0v-4a1 1 0 0 0-2 0ZM7 11.8a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z';
function substepIcon(status) {
  if (status === 'green') return icon('check', { size: 14 });
  if (status === 'orange' || status === 'red') {
    return svg(
      'svg',
      { viewBox: '0 0 16 16', width: 14, height: 14, class: 'icon', 'aria-hidden': 'true', focusable: 'false' },
      svg('path', { d: ALERT_MARK_PATH, fill: 'currentColor', 'fill-rule': 'evenodd' }),
    );
  }
  return null;
}

/**
 * Sub-pasos de la etapa actual como segmentos simples ("Personal · Equipos · …").
 * El estado se ve con un ícono (tilde o "!"), no sólo con color, y se lee
 * como texto para lectores de pantalla.
 */
function buildSubsteps({ currentStep, stepHref, quoteId }) {
  const { stage: currentStage } = stageOfStep(currentStep);
  if (currentStage.steps.length < 2) return null;
  const currentSub = currentStage.steps.findIndex((st) => st.id === currentStep);
  const entries = currentStage.steps.map((step, index) => {
    const isCurrent = step.id === currentStep;
    const statusText = h('span', { class: 'sr-only' });
    const iconEl = h('span', { class: 'qe-substep-icon', 'aria-hidden': 'true' });
    const link = h(
      'a',
      { href: stepHref(step.id), class: ['qe-substep', isCurrent ? 'is-current' : null], 'aria-current': isCurrent ? 'step' : null },
      h('span', { class: 'qe-substep-label' }, step.label),
      iconEl,
      statusText,
    );
    return { step, index, link, statusText, iconEl, shown: null };
  });
  const el = h('nav', { class: 'qe-substeps', 'aria-label': `Pasos de ${currentStage.label}` }, h('ol', { class: 'qe-substep-list' }, ...entries.map((e) => h('li', {}, e.link))));
  return {
    el,
    update(result) {
      entries.forEach((e) => {
        const status = shownStatus(stepStatus(e.step.id, result), { after: e.index > currentSub, visited: wasVisited(quoteId, e.step.id) });
        e.link.dataset.status = status;
        e.statusText.textContent = ` (${STATUS_TEXT[status]})`;
        e.link.title = `${e.step.label}: ${STATUS_TEXT[status]}`;
        if (e.shown !== status) {
          e.shown = status;
          const iconNode = substepIcon(status);
          if (iconNode) mount(e.iconEl, iconNode);
          else clear(e.iconEl);
          e.iconEl.hidden = !iconNode;
        }
      });
    },
  };
}

// ---------------------------------------------------- avisos del paso actual

/**
 * Pendientes de completitud cuya pregunta YA está a la vista en su propio
 * paso no se repiten como "Para revisar" arriba del formulario (UX-1): el
 * campo es la pregunta, o el paso muestra su estado vacío ("Todavía no
 * agregaste…"). Siguen contando en el estado de la etapa, en "¿Te falta
 * cargar algo?" y en el Resultado.
 *
 * Si el pendiente es de una LÍNEA (un equipo sin vida útil, un puesto sin
 * sueldo, un material sin responsable) o de un dato de otro paso (consumo de
 * combustible de los equipos), la pregunta no se ve a simple vista: el aviso
 * se muestra, con "Ir al campo" cuando el campo está en este paso.
 */
const ALWAYS_ASKED = new Set(['modality', 'rate', 'utilization', 'payment_term', 'margin', 'billing_taxes', 'structure', 'contingency']);
const listOf = (value) => (Array.isArray(value) ? value.filter((v) => isPlainObject(v)) : []);
const positive = (value) => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;

export function askedOnScreen(item, quote) {
  if (!item) return false;
  if (ALWAYS_ASKED.has(item.id)) return true;
  const q = quote || {};
  const logistics = isPlainObject(q.logistics) ? q.logistics : {};
  switch (item.id) {
    case 'labor':
      return listOf(q.labor).length === 0;
    case 'equipment_cost':
      return listOf(q.equipment).length === 0;
    case 'materials':
      return listOf(q.materials).length === 0;
    case 'logistics':
      return !positive(logistics.distanceKm) && listOf(logistics.vehicles).length === 0;
    case 'fuel':
      // Precio ILUSTRATIVO por defecto: ya lo dice la línea de combustible de Viajes.
      return item.status === 'warning';
    default:
      return false;
  }
}

/**
 * Campo de ESTE paso donde se corrige un pendiente de línea (para "Ir al
 * campo"), o null. Sólo rutas que el paso dibuja (atributo name = ruta).
 */
export function pendingFieldPath(item, quote) {
  if (!item) return null;
  const q = quote || {};
  const firstIndex = (list, test) => list.findIndex(test);
  switch (item.id) {
    case 'labor': {
      const rows = listOf(q.labor);
      const i = firstIndex(rows, (l) => !positive(l.basicMonthly) || !positive(l.positions));
      if (i < 0) return null;
      return positive(rows[i].basicMonthly) ? `labor.${i}.positions` : `labor.${i}.basicMonthly`;
    }
    case 'equipment_cost': {
      const rows = listOf(q.equipment);
      const i = firstIndex(rows, (e) => !positive(e.replacementValue) || !positive(e.usefulLifeYears));
      if (i < 0) return null;
      return positive(rows[i].replacementValue) ? `equipment.${i}.usefulLifeYears` : `equipment.${i}.replacementValue`;
    }
    case 'materials': {
      const i = firstIndex(listOf(q.materials), (m) => !m.providedBy);
      return i < 0 ? null : `materials.${i}.providedBy`;
    }
    case 'logistics': {
      const logistics = isPlainObject(q.logistics) ? q.logistics : {};
      if (!positive(logistics.distanceKm)) return 'logistics.distanceKm';
      const i = firstIndex(listOf(logistics.vehicles), (v) => !positive(v.count));
      return i < 0 ? null : `logistics.vehicles.${i}.count`;
    }
    case 'fuel': {
      const fuel = isPlainObject(q.fuel) ? q.fuel : {};
      if (!fuel.providedBy) return 'fuel.providedBy';
      if (fuel.providedBy !== 'client' && !positive(fuel.pricePerLiter)) return 'fuel.pricePerLiter';
      // Consumo de los vehículos (en este paso); el de los equipos está en Equipos.
      const vehicles = listOf(q.logistics && q.logistics.vehicles);
      const i = firstIndex(vehicles, (v) => !positive(v.consumptionLPer100Km));
      return i < 0 ? null : `logistics.vehicles.${i}.consumptionLPer100Km`;
    }
    default:
      return null;
  }
}

/**
 * @param {string} stepId
 * @param {{ getQuote?: Function, onReveal?: Function, onFocusField?: Function, hasField?: Function, stepHref?: Function, didactic?: boolean }} options
 */
function buildStepNotices(stepId, { getQuote = () => null, onReveal = null, onFocusField = null, hasField = () => false, stepHref = null, didactic = false } = {}) {
  const list = h('ul', { class: 'qe-notice-list' });
  // En la cotización de ejemplo, los puntos para revisar están a propósito (UX-3).
  const title = didactic ? 'Para revisar: el ejemplo lo deja a propósito' : 'Para revisar en este paso';
  const el = h('section', { class: 'qe-notices', 'aria-label': 'Pendientes y avisos de este paso', hidden: true }, h('h3', { class: 'qe-notices-title' }, title), list);
  const goButton = (label, onClick) => button(label, { variant: 'link', size: 'sm', attrs: { class: 'btn btn-link btn-sm qe-notice-go' }, onClick });
  /** "Ir al campo" (opciones avanzadas o campo de una línea) o, si el dato es de otro paso, un enlace a ese paso. */
  const actionFor = (item, quote) => {
    const key = ITEM_ADVANCED_KEY[item.id];
    if (key && typeof onReveal === 'function') return goButton('Ir al campo', () => onReveal(key));
    const path = pendingFieldPath(item, quote);
    if (path && typeof onFocusField === 'function' && hasField(path)) return goButton('Ir al campo', () => onFocusField(path));
    // Consumo de combustible de los equipos: se carga en Equipos.
    if (item.id === 'fuel' && stepId !== 'equipment' && typeof stepHref === 'function' && listOf(quote && quote.equipment).length > 0) {
      return h('a', { class: 'qe-notice-go', href: stepHref('equipment') }, `Ir a ${stepName('equipment')}`);
    }
    return null;
  };
  return {
    el,
    update(result) {
      if (!result || stepId === 'result') {
        el.hidden = true;
        return;
      }
      const quote = getQuote();
      const items = ((result.completeness && result.completeness.items) || []).filter((i) => stepOfItem(i) === stepId && i.status !== 'ok' && i.status !== 'n/a' && !askedOnScreen(i, quote));
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
        ...items.map((i) => h(
          'li',
          { class: ['qe-notice', `is-${i.status === 'missing' ? 'red' : 'orange'}`] },
          h('span', { class: ['dot', `dot-${i.status === 'missing' ? 'red' : 'orange'}`], 'aria-hidden': 'true' }),
          h('span', {}, h('strong', {}, `${i.label}: `), i.message, ' ', actionFor(i, quote)),
        )),
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
    headerCompact: null,
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
    // Sin cambios desde que se abrió = guardado (se ve igual que "Guardado").
    saveEl.dataset.status = status === 'idle' && !ephemeral ? 'saved' : status;
    retryBtn.hidden = status !== 'error';
    downloadDraftBtn.hidden = status !== 'error';
    // Lo que importa es si tus datos están a salvo: "Guardado" también al
    // abrir (la cotización ya está guardada), "Guardando…" mientras se
    // escribe y "Sin guardar" mientras haya un campo inválido (UX-12).
    const texts = {
      idle: ephemeral ? 'Sólo en esta sesión (no se guarda)' : 'Guardado',
      pending: 'Guardando…',
      saving: 'Guardando…',
      saved: ephemeral ? 'Sólo en esta sesión (no se guarda)' : 'Guardado',
      readonly: 'Sólo lectura',
      invalid: 'Sin guardar: revisá los campos marcados',
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
    if (stepId !== 'result') syncAdvanced(state.result);
    if (hasInvalidFields()) {
      // Un campo inválido dentro de "Opciones avanzadas" nunca queda escondido.
      invalidControls().forEach((el) => openAncestors(el));
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

  /** Al enfocar un campo del formulario, el resumen expandido se cierra (no tapa lo que editás). */
  function onFormFocus(event) {
    const target = event.target;
    if (!summary || !target || typeof target.matches !== 'function') return;
    if (target.matches('input, select, textarea')) summary.collapse();
    keepAboveSummary(target);
  }

  /**
   * Red de seguridad de A11Y-1: el navegador respeta scroll-padding-bottom al
   * enfocar, salvo en un <textarea> (lleva a la vista sólo el cursor) o si el
   * foco llega por código. Si el elemento enfocado quedó en parte debajo de
   * la barra de resumen fija, se desplaza lo justo (sin tapar su borde de arriba).
   */
  function keepAboveSummary(target) {
    const adjust = () => {
      if (state.disposed || !summary || document.activeElement !== target || !target.isConnected) return;
      const bar = summary.el;
      // Sólo con la barra fija ABAJO (≤ 1180 px, como en css/quote.css); en
      // escritorio el resumen es una columna lateral.
      if (typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 1180px)').matches) return;
      if (getComputedStyle(bar).position !== 'sticky') return;
      const barTop = bar.getBoundingClientRect().top;
      if (barTop >= window.innerHeight) return;
      const rect = target.getBoundingClientRect();
      const overlap = rect.bottom - barTop + 8;
      if (overlap <= 0) return;
      const topRoom = rect.top - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
      const delta = Math.min(overlap, topRoom);
      if (delta > 1) window.scrollBy({ top: delta, behavior: 'auto' });
    };
    // Ya (antes de que el navegador lleve el cursor a la vista) y, por las
    // dudas, en el cuadro siguiente.
    adjust();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(adjust);
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
    const controls = [...stepBody.querySelectorAll(`[name="${cssEscape(path)}"]`)];
    // En un grupo de opciones, la elegida (así el teclado sigue en el mismo lugar).
    const control = controls.find((c) => c.type === 'radio' && c.checked) || controls[0];
    if (!control) return;
    // Si el campo está dentro de unas "Opciones avanzadas" cerradas, se abren.
    openAncestors(control);
    if (typeof control.scrollIntoView === 'function') control.scrollIntoView({ block: 'center' });
    try {
      control.focus({ preventScroll: true });
    } catch {
      control.focus();
    }
  }

  /** Abre los <details> que contienen un nodo (para no esconder un campo). */
  function openAncestors(node) {
    let d = node && node.parentElement ? node.parentElement.closest('details') : null;
    while (d && layout.contains(d)) {
      if (!d.open) d.open = true;
      d = d.parentElement ? d.parentElement.closest('details') : null;
    }
  }

  /** Abre unas "Opciones avanzadas" por clave y lleva la vista a ellas. */
  function revealAdvanced(key) {
    const section = stepBody.querySelector(`details[data-adv-key="${cssEscape(key)}"]`);
    if (!section) return;
    section.open = true;
    openAncestors(section);
    if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'start', behavior: 'auto' });
    const summaryEl = section.querySelector('summary');
    if (summaryEl) {
      try {
        summaryEl.focus({ preventScroll: true });
      } catch {
        summaryEl.focus();
      }
    }
  }

  /**
   * "Opciones avanzadas" con algo para corregir: se abren solas si tienen un
   * campo inválido o con aviso del motor (no se esconden errores) y muestran
   * "Revisar" si hay un pendiente de completitud que se corrige adentro.
   */
  function syncAdvanced(result) {
    const items = result && result.completeness ? result.completeness.items || [] : [];
    stepBody.querySelectorAll('details.qe-adv').forEach((section) => {
      const invalid = section.querySelector('[aria-invalid="true"]');
      const issue = section.querySelector('.qe-has-issue');
      const key = section.dataset.advKey || '';
      const flagged = items.some((i) => ITEM_ADVANCED_KEY[i.id] === key && i.status !== 'ok' && i.status !== 'n/a');
      if ((invalid || issue) && !section.open) {
        section.open = true;
        openAncestors(section);
      }
      const slot = section.querySelector('.qe-adv-badge');
      if (!slot) return;
      let custom = null;
      if (typeof section.qeFlag === 'function' && result) {
        try {
          custom = section.qeFlag(result);
        } catch (error) {
          logger.warn('No se pudo evaluar un aviso de sección', { message: error && error.message });
        }
      }
      const tone = invalid || (issue && section.querySelector('.qe-issue-error')) ? 'red' : issue || flagged ? 'orange' : custom && custom.tone ? custom.tone : null;
      if (tone) {
        const text = invalid || issue ? (tone === 'red' ? 'Corregir' : 'Revisar') : flagged ? 'Revisar' : custom.text || 'Revisar';
        const signature = `${tone}|${text}`;
        if (slot.dataset.sig !== signature) mount(slot, badge(text, tone));
        slot.dataset.sig = signature;
        slot.hidden = false;
      } else {
        clear(slot);
        delete slot.dataset.sig;
        slot.hidden = true;
      }
    });
  }

  // ------------------------------------------------------------- estructura
  const currentIndex = QUOTE_STEPS.findIndex((s) => s.id === stepId);
  const prevStep = currentIndex > 0 ? QUOTE_STEPS[currentIndex - 1] : null;
  const nextStep = currentIndex < QUOTE_STEPS.length - 1 ? QUOTE_STEPS[currentIndex + 1] : null;
  const { stage: currentStage, index: stageIndex } = stageOfStep(stepId);
  const copy = STEP_COPY[stepId] || { question: stepShortLabel(stepId), why: '' };

  markVisited(quoteId, stepId);
  const stageBar = buildStageBar({ currentStep: stepId, stepHref, quoteId });
  const substeps = buildSubsteps({ currentStep: stepId, stepHref, quoteId });
  const summary = stepId === 'result' ? null : buildSummary({ getResult: () => state.result, stepHref });
  const notices = buildStepNotices(stepId, {
    getQuote: () => state.quote,
    onReveal: (key) => revealAdvanced(key),
    onFocusField: (path) => focusField(path),
    hasField: (path) => Boolean(stepBody.querySelector(`[name="${cssEscape(path)}"]`)),
    stepHref,
    didactic: state.quote.illustrative === true,
  });
  const calcErrorBanner = banner('No se pudieron recalcular los resultados con los datos actuales. Revisá los valores ingresados.', 'danger', { title: 'Error de cálculo.' });
  calcErrorBanner.hidden = true;
  const stepBody = h('div', { class: ['qe-step-body', `qe-step-${stepId}`] });

  const unitLabel = (RATE_UNITS.find((u) => u.id === state.quote.unit) || RATE_UNITS[0]).label;
  // El sub-paso ya se ve en los segmentos de arriba: el antetítulo sólo dice la etapa.
  const kicker = `Etapa ${stageIndex + 1} de ${STAGES.length} · ${currentStage.label}`;
  // Convención de montos (PLAN-2026-002, PN1): todo se carga y se muestra sin IVA.
  const meta = h(
    'div',
    { class: 'qe-step-meta' },
    stepId === 'result' ? null : h('span', { class: 'badge badge-navy', title: 'Unidad en la que cobrás' }, unitLabel),
    stepId === 'result' || stepId === 'service' ? null : h('span', { class: 'badge badge-gray', title: 'Convención de esta cotización: costos, precios y tarifas se cargan sin IVA.' }, 'Montos sin IVA'),
    saveEl,
  );
  // En Resultado el título y la intro los pone la vista de resultados (su h2
  // "Resultado"): acá sólo queda el estado de guardado, sin duplicar títulos.
  const stepHead = stepId === 'result'
    ? h('div', { class: 'qe-step-head is-result' }, meta)
    : h(
      'div',
      { class: 'qe-step-head' },
      h(
        'div',
        { class: 'qe-step-heading' },
        h('p', { class: 'qe-step-kicker' }, kicker),
        h('h2', { class: 'qe-step-title', tabindex: '-1' }, copy.question),
        copy.why ? h('p', { class: 'qe-step-why' }, copy.why) : null,
        copy.term ? h('p', { class: 'qe-term' }, h('span', { class: 'qe-term-label' }, 'Término técnico:'), ` ${copy.term}`) : null,
        // La convención de montos se dice al empezar (no se supone en silencio).
        stepId === 'service' ? h('p', { class: 'qe-convention' }, h('strong', {}, 'Montos sin IVA. '), 'Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo.') : null,
      ),
      meta,
    );

  /** Texto del destino de "Continuar" / "Atrás". */
  function navTarget(step, direction) {
    if (!step) return null;
    const target = stageOfStep(step.id);
    if (step.id === 'result') return { kicker: 'Continuar', text: 'Ver el resultado' };
    if (target.index !== stageIndex) {
      // Hacia adelante se anuncia la etapa nueva; hacia atrás, el paso al que volvés.
      if (direction === 'next') return { kicker: 'Continuar', text: `Etapa ${target.index + 1}: ${target.stage.label}` };
      return { kicker: 'Atrás', text: target.stage.steps.length > 1 ? stepShortLabel(step.id) : `Etapa ${target.index + 1}: ${target.stage.label}` };
    }
    return { kicker: direction === 'next' ? 'Continuar' : 'Atrás', text: stepShortLabel(step.id) };
  }
  const prevTarget = navTarget(prevStep, 'prev');
  const nextTarget = navTarget(nextStep, 'next');

  const stepNav = h(
    'nav',
    { class: 'qe-step-nav', 'aria-label': 'Navegación entre pasos' },
    prevStep
      ? h('a', { class: 'btn btn-secondary qe-nav-btn', href: stepHref(prevStep.id), rel: 'prev', 'aria-label': `Atrás: ${prevTarget.text}` }, icon('chevronLeft'), h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, 'Atrás'), h('span', { class: 'qe-nav-dest' }, prevTarget.text)))
      : h('span'),
    nextStep
      ? h('a', { class: 'btn btn-primary btn-lg qe-nav-btn is-next', href: stepHref(nextStep.id), rel: 'next', 'aria-label': `${nextTarget.kicker}: ${nextTarget.text}` }, h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, nextTarget.kicker), h('span', { class: 'qe-nav-dest' }, nextTarget.text)), icon('arrowRight'))
      : h('a', { class: 'btn btn-secondary qe-nav-btn is-next', href: '#/cotizaciones' }, h('span', { class: 'qe-nav-text' }, h('span', { class: 'qe-nav-kicker' }, 'Listo'), h('span', { class: 'qe-nav-dest' }, 'Volver a Cotizaciones'))),
  );

  // Aviso de valores ILUSTRATIVOS de la cotización (se actualiza al confirmar líneas).
  const illustrativeHolder = h('div', { class: 'qe-illustrative', hidden: true });
  let illustrativeKey = null;

  /**
   * Valores ILUSTRATIVOS de la cotización, sin repetir avisos (UX-1):
   *   - cotización de ejemplo: SIEMPRE una línea en cada paso (el aviso global
   *     del shell habla de la empresa y los recursos, no de esta cotización);
   *   - líneas copiadas de plantillas o bibliotecas de ejemplo: en el paso
   *     donde están y, todas juntas con enlaces, en el Resultado;
   *   - precio del combustible por defecto: una línea, sólo en Viajes y en el
   *     Resultado. Cada campo conserva su etiqueta ILUSTRATIVO.
   */
  function syncIllustrativeBanner() {
    const info = illustrativeInfo(state.quote);
    const q = state.quote;
    const count = (list) => (Array.isArray(list) ? list.filter((l) => isPlainObject(l) && l.illustrative === true).length : 0);
    const groups = [
      { step: 'labor', label: stepName('labor'), n: count(q.labor) },
      { step: 'equipment', label: stepName('equipment'), n: count(q.equipment) },
      { step: 'materials', label: stepName('materials'), n: count(q.materials) },
      { step: 'materials', label: 'Otros costos', n: count(q.otherCosts) },
      { step: 'logistics', label: 'Vehículos', n: count(q.logistics && q.logistics.vehicles) },
    ].filter((g) => g.n > 0);
    const isResult = stepId === 'result';
    const shownGroups = isResult ? groups : groups.filter((g) => g.step === stepId);
    const fuelHere = info.fuel && (stepId === 'logistics' || isResult);
    const key = JSON.stringify([info.quote, fuelHere, shownGroups.map((g) => [g.label, g.n])]);
    if (key === illustrativeKey) return;
    illustrativeKey = key;
    const hide = () => {
      clear(illustrativeHolder);
      illustrativeHolder.hidden = true;
    };
    if (info.quote) {
      // Una línea (como la del combustible): cubre también el combustible y las líneas de ejemplo.
      const el = banner(
        h(
          'span',
          {},
          'Cotización de ejemplo: sus costos, salarios y precios son de demostración.',
          illustrativeTag('Cotización de demostración: reemplazá sus valores por los tuyos vigentes antes de cotizar'),
        ),
        'warning',
      );
      el.classList.add('qe-illustrative-line');
      illustrativeHolder.hidden = false;
      mount(illustrativeHolder, el);
      return;
    }
    if (shownGroups.length === 0 && !fuelHere) {
      hide();
      return;
    }
    const notices = [];
    const lines = shownGroups.reduce((acc, g) => acc + g.n, 0);
    if (lines > 0) {
      const text = isResult
        ? `Esta cotización tiene ${lines} ${lines === 1 ? 'línea' : 'líneas'} con valores de ejemplo (ILUSTRATIVOS): reemplazalos por los tuyos y tildá "Son valores propios y vigentes" en cada una.`
        : `${lines === 1 ? 'Una línea de este paso tiene' : `${lines} líneas de este paso tienen`} valores de ejemplo (ILUSTRATIVOS): reemplazalos por los tuyos y tildá "Son valores propios y vigentes".`;
      const el = banner(text, 'warning');
      if (isResult) {
        const body = el.lastElementChild || el;
        body.appendChild(h('span', { class: 'qe-illustrative-links' }, ...shownGroups.map((g) => h('a', { href: stepHref(g.step) }, `${g.label}: ${g.n}`))));
      }
      notices.push(el);
    }
    if (fuelHere) {
      const el = banner(h('span', {}, 'El precio del combustible es de ejemplo: cargá el tuyo.', illustrativeTag('Precio del combustible por defecto: reemplazalo por tu precio actual')), 'warning');
      el.classList.add('qe-illustrative-line');
      const body = el.lastElementChild || el;
      body.appendChild(
        isResult
          ? h('a', { class: 'qe-illustrative-go', href: stepHref('logistics') }, `Ir a ${stepName('logistics')}`)
          : button('Ir al precio', { variant: 'link', size: 'sm', attrs: { class: 'btn btn-link btn-sm qe-illustrative-go' }, onClick: () => focusField('fuel.pricePerLiter') }),
      );
      notices.push(el);
    }
    illustrativeHolder.hidden = false;
    mount(illustrativeHolder, ...notices);
  }

  const mainEl = h(
    'div',
    { class: 'qe-main' },
    readOnly
      ? banner('Los datos fueron guardados por una versión más nueva de RATEOS. Podés consultar la cotización, pero no se guardan cambios.', 'danger', { title: 'Modo sólo lectura.' })
      : null,
    illustrativeHolder,
    calcErrorBanner,
    substeps ? substeps.el : null,
    stepHead,
    notices.el,
    stepBody,
    stepNav,
  );

  const layout = h(
    'div',
    { class: ['qe', summary ? null : 'qe-no-summary', readOnly ? 'is-readonly' : null], dataset: { stage: currentStage.id } },
    stageBar.el,
    mainEl,
    summary ? summary.el : null,
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

  /**
   * Cotización todavía vacía (costo 0): las tres acciones van agrupadas en
   * "Más acciones" para no competir con la primera pregunta (UX-14).
   */
  const moreActionsBtn = h(
    'button',
    { type: 'button', class: headBtnClass, title: 'Más acciones: duplicar, guardar como plantilla o imprimir', 'aria-haspopup': 'dialog', on: { click: () => openMoreActions() } },
    svg(
      'svg',
      { viewBox: '0 0 24 24', width: 18, height: 18, class: 'icon', 'aria-hidden': 'true', focusable: 'false' },
      svg('circle', { cx: 5, cy: 12, r: 2, fill: 'currentColor' }),
      svg('circle', { cx: 12, cy: 12, r: 2, fill: 'currentColor' }),
      svg('circle', { cx: 19, cy: 12, r: 2, fill: 'currentColor' }),
    ),
    h('span', {}, 'Más acciones'),
  );

  function openMoreActions() {
    let ref = null;
    const run = (fn) => () => {
      if (ref) ref.close();
      fn();
    };
    const row = (label, iconName, text, fn, disabled = false) => h(
      'div',
      { class: 'qe-more-action' },
      button(label, { variant: 'secondary', icon: iconName, disabled, onClick: run(fn) }),
      h('p', { class: 'qe-more-action-text' }, text),
    );
    ref = openDialog({
      title: 'Más acciones',
      content: h(
        'div',
        { class: 'stack' },
        row('Duplicar', 'copy', 'Crea una copia de esta cotización para cotizar una variante.', () => duplicate(), readOnly),
        row('Guardar como plantilla', 'services', 'Reutilizá el tipo de servicio, la actividad y los recursos en cotizaciones nuevas.', () => saveAsTemplate(), readOnly),
        row('Imprimir', 'print', 'Abre el Resultado listo para imprimir o guardar como PDF.', () => print()),
      ),
      actions: [button('Cerrar', { variant: 'secondary', onClick: () => ref.close() })],
    });
  }

  function syncHeader(force = false) {
    const name = String(state.quote.name || '').trim() || 'Cotización sin nombre';
    const r = state.result;
    const compact = !(r && r.kpis && isFiniteNumber(r.kpis.totalCost) && r.kpis.totalCost > 0);
    if (!force && name === state.headerName && compact === state.headerCompact) return;
    state.headerName = name;
    state.headerCompact = compact;
    setHeaderSafe(app, {
      title: name,
      breadcrumbs: [
        { label: 'Cotizaciones', href: '#/cotizaciones' },
        { label: state.quote.code || 'Cotización', href: stepHref('service') },
      ],
      actions: compact ? [moreActionsBtn] : [duplicateBtn, templateBtn, printBtn],
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
      openState: {
        get: (key) => advancedOpenState.get(`${quoteId}:${key}`),
        set: (key, open) => advancedOpenState.set(`${quoteId}:${key}`, Boolean(open)),
      },
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
    // El título del paso es h2: los títulos de adentro no saltean niveles (A11Y-7).
    normalizeHeadings(stepBody, 2);
    if (readOnly) lockInputs(stepBody);
  }

  function refreshAll() {
    syncIllustrativeBanner();
    syncInvalidState();
    const r = state.result;
    if (!r) return;
    stageBar.update(r);
    if (substeps) substeps.update(r);
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
      syncAdvanced(r);
      labelScrollRegions(stepBody);
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

  /** Con los segmentos con scroll horizontal (pantallas chicas), centra el paso actual. */
  function revealCurrentStep() {
    if (!substeps) return;
    const nav = substeps.el;
    const current = nav.querySelector('.qe-substep.is-current');
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
      // Encabezados fijos arriba (topbar en desktop, barra compacta en celular).
      const offset = [...document.querySelectorAll('.topbar, .mobile-bar')].reduce((max, el) => {
        const pos = getComputedStyle(el).position;
        const r = el.getBoundingClientRect();
        return (pos === 'sticky' || pos === 'fixed') && r.height > 0 && r.top <= 1 ? Math.max(max, r.bottom) : max;
      }, 0);
      // Con sub-pasos, la vista arranca en los segmentos (se ve en qué paso estás).
      const anchor = substeps && substeps.el.isConnected ? substeps.el : stepHead;
      const rect = anchor.getBoundingClientRect();
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
  // Al cambiar el ancho, o al abrir unas "Opciones avanzadas" con una tabla
  // adentro, una tabla puede empezar (o dejar) de hacer scroll.
  const onResize = debounce(() => {
    if (!state.disposed && stepId !== 'result') labelScrollRegions(stepBody);
  }, 200);
  // "toggle" de <details> no burbujea: se escucha en captura.
  const onDetailsToggle = (event) => {
    if (!state.disposed && stepId !== 'result' && event.target && event.target.tagName === 'DETAILS') labelScrollRegions(stepBody);
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
      mainEl.addEventListener('focusin', onFormFocus);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('resize', onResize);
      stepBody.addEventListener('toggle', onDetailsToggle, true);
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
      mainEl.removeEventListener('focusin', onFormFocus);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('resize', onResize);
      onResize.cancel();
      stepBody.removeEventListener('toggle', onDetailsToggle, true);
      document.removeEventListener('visibilitychange', onVisibility);
      stageBar.dispose();
      if (summary) summary.dispose();
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

