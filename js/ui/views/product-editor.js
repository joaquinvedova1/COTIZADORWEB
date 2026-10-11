/**
 * Editor de un PRODUCTO, paso a paso (PLAN-2026-008).
 *
 *   1 El producto · 2 Ingredientes y materiales · 3 Personal · 4 Máquinas y
 *   equipos · 5 Gastos fijos · 6 Precio y margen · 7 Resultado
 *
 * - En cada paso se ve en vivo "Así va tu producto" (costo por unidad, precio
 *   sugerido, ganancia y equilibrio) y cada número importante tiene su
 *   "Ver cálculo". Los números los calcula el motor (product-engine.js): esta
 *   vista sólo arma textos con lo que devuelve.
 * - Escribir en un campo NO redibuja el paso: se recalcula (debounce) y se
 *   refrescan sólo las salidas. Agregar o quitar una línea sí lo redibuja.
 * - Guardado automático con debounce vía ProductService (nunca storage).
 * - Las líneas traídas de Recursos guardan una COPIA: si el recurso cambia, se
 *   avisa con [Actualizar en este producto] / [Conservar valor original].
 * - El % de los costos fijos que le toca al producto lo decide la persona:
 *   nunca se infiere del uso.
 */

import { h, mount, debounce } from '../dom.js';
import {
  banner, barList, bigStat, button, card, choiceGroup, confirmDialog, disclosure, formGrid, icon, illustrativeBanner,
  linkButton, numberField, openTraceDialog, selectField, stepIndicator, table, textField, toast as componentToast,
} from '../components.js';
import { formatMoney, formatNumber, formatPercent, formatDateTime, EMPTY } from '../../core/format.js';
import { deepClone, getPath, setPath } from '../../core/object.js';
import { isFiniteNumber } from '../../core/money.js';
import { logger } from '../../core/logger.js';
import { CURRENCY } from '../../config.js';
import { computeProduct } from '../../engines/product-engine.js';
import { maintenanceOf } from '../../engines/equipment-engine.js';
import {
  PRODUCT_STEPS, MEASURE_UNITS, PRODUCT_PRICE_MODES, PRODUCT_MATERIAL_PER, SALE_UNIT_SUGGESTIONS, MAINTENANCE_MODES,
  BUDGET_PERIODS, ILLUSTRATIVE_AGREEMENT_PARAMS, CURRENCIES,
} from '../../domain/catalogs.js';
import {
  normalizeProductShape, productMaterialLine, blankProductMaterialLine, productLaborLine, blankProductLaborLine,
  productEquipmentLine, blankProductEquipmentLine, createFixedCost,
} from '../../domain/product-factory.js';
import { lineSyncStatus, applyResourceUpdate, dismissResourceUpdate } from '../../domain/resource-sync.js';
import { syncNotice, baseTag } from '../economic-base-ui.js';
import { maintenanceInterpretation } from '../equipment-wear-ui.js';
import { billingTaxesFields } from '../billing-taxes-form.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { STEP_HINTS, unitMoney, productHref } from './products.js';

export const RECALC_DELAY_MS = 150;
export const SAVE_DELAY_MS = 400;

const RESOURCE_LISTS = Object.freeze(['agreements', 'laborProfiles', 'equipment', 'materials']);
const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);
const ROUNDING_STEPS = Object.freeze([0, 1, 5, 10, 50, 100, 500, 1000]);
const FIXED_COST_SUGGESTIONS = Object.freeze(['Alquiler del local', 'Luz y gas (parte fija)', 'Internet y teléfono', 'Contador', 'Seguro del local', 'Sueldos de administración']);

const CLOUD_SAVE_LABELS = Object.freeze({
  sync_failed: 'Sin sincronizar: guardado sólo en este navegador',
  conflict: 'Sin guardar: tus datos cambiaron en otro dispositivo',
  session_expired: 'Sin sincronizar: tu sesión terminó',
  forbidden: 'Sin guardar: tu rol no permite editar',
  too_large: 'Error al guardar',
});

/** ¿En qué paso se corrige cada problema? (primer tramo de la ruta del aviso) */
const ISSUE_STEPS = Object.freeze({
  unitsPerBatch: 'producto',
  lossPct: 'producto',
  monthlyUnits: 'producto',
  materials: 'insumos',
  labor: 'personal',
  equipment: 'maquinas',
  fixedCosts: 'fijos',
  exchangeRates: 'insumos',
  pricing: 'precio',
  billingTaxes: 'precio',
});

const STATUS_TEXT = Object.freeze({ green: 'listo', orange: 'revisá un dato', red: 'falta un dato', gray: 'sin cargar' });

/** Cambios que no se pudieron guardar (por id): al volver se recuperan. */
const unsavedDrafts = new Map();
/** Guardados en curso (por id): el paso siguiente espera a que terminen. */
const pendingSaves = new Map();
let activeEditor = null;
let renderSequence = 0;

// ------------------------------------------------------------- helpers puros

export function stepOfIssue(path) {
  const head = String(path || '').split('.')[0];
  return ISSUE_STEPS[head] || 'producto';
}

/** Estado de un paso para el menú de pasos: green | orange | red | gray (null en Resultado). */
export function productStepStatus(stepId, product, result) {
  if (stepId === 'resultado') return null;
  const issues = result && Array.isArray(result.issues) ? result.issues.filter((i) => stepOfIssue(i.path) === stepId) : [];
  if (issues.some((i) => i.severity === 'error')) return 'red';
  if (issues.length) return 'orange';
  const p = product || {};
  const filled = {
    producto: Number(p.unitsPerBatch) > 0,
    insumos: Array.isArray(p.materials) && p.materials.length > 0,
    personal: Array.isArray(p.labor) && p.labor.length > 0,
    maquinas: Array.isArray(p.equipment) && p.equipment.length > 0,
    fijos: Array.isArray(p.fixedCosts) && p.fixedCosts.length > 0,
    precio: Boolean(p.pricing) && isFiniteNumber(p.pricing.targetMarginPct),
  };
  return filled[stepId] ? 'green' : 'gray';
}

/** "unidad" → "unidades", "docena" → "docenas", "porción" → "porciones", "kg" → "kg". */
export function pluralUnit(word) {
  const w = typeof word === 'string' && word.trim() ? word.trim() : 'unidad';
  if (/^(kg|g|l|ml)$/i.test(w)) return w;
  if (/ón$/i.test(w)) return `${w.slice(0, -2)}ones`;
  if (/[aeiouáéíóú]$/i.test(w)) return `${w}s`;
  if (/s$/i.test(w)) return w;
  return `${w}es`;
}

/** ¿Cómo se asignan los costos fijos de una máquina? 'dedicated' (100 %) | 'shared' (un %) | '' (sin decidir). */
export function shareModeOf(line = {}) {
  if (line.shareMode === 'dedicated' || line.shareMode === 'shared') return line.shareMode;
  if (line.fixedSharePct === 100) return 'dedicated';
  if (isFiniteNumber(line.fixedSharePct)) return 'shared';
  return '';
}

const money0 = (v) => (Number.isFinite(v) ? formatMoney(v) : EMPTY);
const num = (v, decimals = 2) => formatNumber(v, { decimals });
const pctText = (v) => formatPercent(v, { decimals: 2 });

/** "por unidad", "por kg", "por docena": nombre de la unidad del precio. */
function perName(unit) {
  const known = MEASURE_UNITS.find((u) => u.id === unit);
  return known ? known.label : String(unit || '');
}

function cleanText(raw, maxLength, multiline = false) {
  const text = String(raw ?? '');
  const cleaned = multiline ? text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ') : text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return cleaned.slice(0, maxLength);
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function setContent(el, content) {
  if (content instanceof Node) mount(el, content);
  else el.textContent = content === null || content === undefined ? '' : String(content);
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

function tip(text, tone = null) {
  return h('div', { class: ['qe-tip', tone ? `qe-tip-${tone}` : null] }, icon(tone ? 'alert' : 'info'), h('p', {}, text));
}

function emptyHint(text) {
  return h('p', { class: 'pe-empty muted' }, text);
}

// ------------------------------------------------------------------ editor

function createEditor(root, app, { product, resources, stepId, restoredDraft = false }) {
  const productId = product.id;
  const readOnly = Boolean(app.ctx && app.ctx.init && app.ctx.init.readOnly);
  // Sin almacenamiento persistente (modo memoria) no hay que decir "Guardado".
  const ephemeral = Boolean(app.ctx && app.ctx.persistent === false);
  const stepIndex = Math.max(0, PRODUCT_STEPS.findIndex((s) => s.id === stepId));
  const step = PRODUCT_STEPS[stepIndex];
  const state = {
    product: normalizeProductShape(product),
    result: null,
    dirty: false,
    disposed: false,
    saveStatus: readOnly ? 'readonly' : 'idle',
    saveErrorCode: null,
    headerName: null,
  };
  const syncResources = {
    laborProfiles: resources.laborProfiles || [],
    agreements: resources.agreements || [],
    equipment: resources.equipment || [],
    externalServices: [],
    materials: resources.materials || [],
  };
  const agreements = syncResources.agreements;

  const notify = (message, tone = 'info') => {
    if (app && typeof app.toast === 'function') app.toast(message, tone);
    else componentToast(message, tone);
  };
  const currency = () => (typeof state.product.currency === 'string' && state.product.currency ? state.product.currency : CURRENCY);
  const saleUnit = () => (typeof state.product.saleUnit === 'string' && state.product.saleUnit.trim() ? state.product.saleUnit.trim() : 'unidad');
  const units = () => pluralUnit(saleUnit());
  const href = (id) => productHref(state.product, id);

  // ---------------------------------------------------------- salidas vivas
  const fixedOutputs = [];
  let stepOutputs = [];
  function refreshList(list) {
    list.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        logger.warn('No se pudo actualizar un valor calculado', { message: error && error.message });
      }
    });
  }
  function refreshAll() {
    refreshList(fixedOutputs);
    refreshList(stepOutputs);
  }
  /** Texto (o nodo) calculado que se refresca con cada recálculo. */
  function out(fn, { tag = 'span', className = null, fixed = false } = {}) {
    const el = h(tag, { class: ['pe-out', className] });
    const refresh = () => {
      setContent(el, state.result ? fn(state.result) : '');
    };
    (fixed ? fixedOutputs : stepOutputs).push(refresh);
    if (state.result) refresh();
    return el;
  }
  /** "Ver cálculo" que abre la traza ACTUAL (no la del momento en que se dibujó). */
  function liveTrace(key, label = 'Ver cálculo') {
    const initial = state.result && state.result.traces ? state.result.traces[key] : null;
    return button(label, {
      variant: 'link',
      size: 'sm',
      icon: 'calc',
      onClick: () => {
        const trace = state.result && state.result.traces ? state.result.traces[key] : null;
        if (trace) openTraceDialog(trace);
      },
      attrs: { class: 'btn btn-link btn-sm trace-btn', 'aria-label': `${label}: ${initial && initial.title ? initial.title : 'cálculo'}` },
    });
  }
  function calc(fn) {
    return h('p', { class: 'pe-calc' }, icon('calc', { size: 16 }), out(fn));
  }

  // ------------------------------------------------------------- cálculo
  const calcErrorBanner = banner('No se pudo calcular el producto con estos datos. Revisá los valores cargados.', 'danger');
  calcErrorBanner.hidden = true;
  function recompute() {
    try {
      state.result = computeProduct(state.product);
      calcErrorBanner.hidden = true;
    } catch (error) {
      calcErrorBanner.hidden = false;
      logger.error('No se pudo calcular el producto', { message: error && error.message });
    }
  }

  // ------------------------------------------------------------- guardado
  const saveTextEl = h('span', { class: 'qe-save-text' });
  const retryBtn = button('Reintentar', { variant: 'link', size: 'sm', onClick: () => save() });
  retryBtn.hidden = true;
  const saveEl = h('div', { class: 'qe-save pe-save', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'qe-save-dot', 'aria-hidden': 'true' }), saveTextEl, retryBtn);

  function setSaveStatus(status, error = null) {
    const previous = state.saveStatus;
    state.saveStatus = status;
    saveEl.dataset.status = status === 'idle' && !ephemeral ? 'saved' : status;
    retryBtn.hidden = status !== 'error' || Boolean(error && error.code === 'conflict');
    const texts = {
      idle: ephemeral ? 'Sólo en esta sesión (no se guarda)' : 'Guardado',
      pending: 'Guardando…',
      saving: 'Guardando…',
      saved: ephemeral ? 'Sólo en esta sesión (no se guarda)' : 'Guardado',
      readonly: 'Sólo lectura',
      invalid: 'Sin guardar: revisá los campos marcados',
    };
    if (status === 'error') {
      const code = error && error.code;
      state.saveErrorCode = code || null;
      const cloud = Object.prototype.hasOwnProperty.call(CLOUD_SAVE_LABELS, code);
      const quota = code === 'quota_exceeded';
      const message = (cloud || quota) && error.message
        ? error.message
        : code === 'restored_draft'
          ? 'Hay cambios sin guardar recuperados: tocá Reintentar.'
          : 'No se pudieron guardar los cambios.';
      saveTextEl.textContent = cloud ? CLOUD_SAVE_LABELS[code] : 'Error al guardar';
      if (code === 'sync_failed' || code === 'session_expired') saveEl.dataset.sync = 'pending';
      else delete saveEl.dataset.sync;
      saveEl.title = message;
      if (previous !== 'error' && code !== 'conflict' && code !== 'session_expired') notify(cloud ? message : `Error al guardar. ${message}`, code === 'sync_failed' ? 'warning' : 'danger');
    } else {
      state.saveErrorCode = null;
      delete saveEl.dataset.sync;
      saveTextEl.textContent = texts[status] || '';
      saveEl.title = status === 'invalid' ? 'Hay valores fuera de rango: no se guardan cambios hasta corregirlos.' : '';
    }
  }

  // Mientras un campo esté marcado como inválido NO se guarda (nunca queda
  // guardado un valor intermedio). Al confirmarlo, el campo vuelve solo a su
  // valor anterior válido.
  let layoutEl = null;
  function hasInvalidFields() {
    return Boolean(layoutEl && layoutEl.querySelector('[aria-invalid="true"]'));
  }
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
  function revertInvalidFields() {
    if (!layoutEl) return;
    layoutEl.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
      try {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        logger.warn('No se pudo restaurar un campo inválido', { message: error && error.message });
      }
    });
  }

  async function save() {
    scheduleSave.cancel();
    if (readOnly || !state.dirty) return pendingSaves.get(productId);
    if (hasInvalidFields()) {
      if (state.saveStatus !== 'error') setSaveStatus('invalid');
      return pendingSaves.get(productId);
    }
    state.dirty = false;
    setSaveStatus('saving');
    const snapshot = deepClone(state.product);
    let promise;
    try {
      promise = Promise.resolve(app.ctx.products.saveProduct(snapshot));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const tracked = promise.then(() => true, () => false);
    pendingSaves.set(productId, tracked);
    tracked.finally(() => {
      if (pendingSaves.get(productId) === tracked) pendingSaves.delete(productId);
    });
    try {
      await promise;
      unsavedDrafts.delete(productId);
      if (!state.dirty) setSaveStatus('saved');
    } catch (error) {
      state.dirty = true;
      unsavedDrafts.set(productId, deepClone(state.product));
      logger.warn('No se pudo guardar el producto', { code: error && error.code });
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

  /** Cambio de un valor (sin redibujar los campos). */
  function update(path, value) {
    if (readOnly || state.disposed) return;
    try {
      setPath(state.product, path, value === undefined ? null : value);
    } catch {
      logger.warn('Ruta de campo inválida', { path: String(path) });
      return;
    }
    markDirty();
    scheduleRecalc();
  }

  /** Cambio estructural: aplica fn(producto) y vuelve a dibujar el paso. */
  function mutate(fn, { focus = null } = {}) {
    if (readOnly || state.disposed) return;
    try {
      fn(state.product);
    } catch (error) {
      logger.warn('No se pudo aplicar el cambio', { message: error && error.message });
      return;
    }
    markDirty();
    scheduleRecalc.cancel();
    recompute();
    renderStep();
    refreshAll();
    if (focus) focusField(focus);
  }

  function focusField(path) {
    if (!stepBody) return;
    const controls = [...stepBody.querySelectorAll(`[name="${cssEscape(path)}"]`)];
    const control = controls.find((c) => c.type === 'radio' && c.checked) || controls[0];
    if (!control) return;
    const details = control.closest('details');
    if (details && !details.open) details.open = true;
    control.focus();
  }

  // ------------------------------------------------------------- campos
  const kit = {
    num(path, { label, rule = 'money', unit = null, hint = null, required = false, placeholder = '', illustrative = false } = {}) {
      const v = getPath(state.product, path);
      return numberField({
        label, rule, unit, hint, required, placeholder, illustrative, name: path, disabled: readOnly,
        value: isFiniteNumber(v) ? v : null,
        onChange: (value) => update(path, value),
      });
    },
    text(path, { label, maxLength = 120, hint = null, placeholder = '', multiline = false } = {}) {
      const v = getPath(state.product, path);
      return textField({
        label, maxLength, hint, placeholder, multiline, name: path, disabled: readOnly,
        value: typeof v === 'string' ? v : '',
        onChange: (value) => update(path, cleanText(value, maxLength, multiline)),
      });
    },
    select(path, { label, options, hint = null, includeEmpty = false, emptyLabel = 'Seleccionar…', structural = false, toValue = (v) => v } = {}) {
      const v = getPath(state.product, path);
      return selectField({
        label, options, hint, includeEmpty, emptyLabel, name: path, disabled: readOnly,
        value: v ?? '',
        onChange: (value) => (structural
          ? mutate((p) => setPath(p, path, toValue(value)), { focus: path })
          : update(path, toValue(value))),
      });
    },
  };

  function unitOptions(current) {
    const opts = MEASURE_UNITS.map((u) => ({ value: u.id, label: u.label }));
    if (typeof current === 'string' && current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
    return opts;
  }

  // --------------------------------------------------- líneas (tarjetas)
  function originNote(line, status) {
    const snap = line && line.snapshot;
    if (!snap || !snap.resourceId) return null;
    const from = `De Recursos${snap.takenAt ? ` · copiado el ${formatDateTime(snap.takenAt)}` : ''}`;
    const extra = !status
      ? null
      : status.state === 'missing'
        ? 'El recurso ya no está en Recursos: el producto conserva sus valores.'
        : status.state === 'dismissed'
          ? 'Recursos cambió y elegiste conservar el valor original.'
          : status.adjusted
            ? 'Con valores cambiados en este producto (Recursos no cambia).'
            : null;
    return h('div', { class: 'line-origin-wrap' },
      h('div', { class: 'line-origin' }, h('span', { class: 'line-origin-from' }, from), baseTag(line.base)),
      extra ? h('p', { class: 'line-origin-note small' }, extra) : null);
  }

  async function removeLine(listKey, index, title) {
    const ok = await confirmDialog({
      title: 'Quitar del producto',
      message: `¿Quitar "${title}" de este producto? Tus Recursos no cambian.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (ok) mutate((p) => p[listKey].splice(index, 1));
  }

  /**
   * Tarjeta de una línea. El título se actualiza en vivo con lo que se escribe.
   * @param {{ listKey: string, index: number, titleOf: Function, illustrative?: boolean, body: Node[], compact?: boolean, extraBadges?: Node[] }} opts
   */
  function lineCard({ listKey, index, titleOf, illustrative = false, body, compact = false, extraBadges = [] }) {
    const line = state.product[listKey][index];
    const title = titleOf(line);
    const synced = listKey === 'materials' || listKey === 'labor' || listKey === 'equipment';
    const status = synced ? lineSyncStatus(listKey, line, syncResources, { currency: currency() }) : null;
    const notice = status
      ? syncNotice(status, {
        name: title,
        readOnly,
        subject: 'product',
        onUpdate: () => {
          mutate((p) => {
            const current = p[listKey][index];
            if (current) p[listKey][index] = applyResourceUpdate(listKey, current, syncResources, { now: new Date().toISOString(), currency: currency() });
          });
          notify(`"${title}" usa ahora los valores actuales de Recursos (sólo en este producto).`, 'success');
        },
        onKeep: () => {
          mutate((p) => {
            const current = p[listKey][index];
            if (current) p[listKey][index] = dismissResourceUpdate(listKey, current, syncResources, { currency: currency() });
          });
          notify(`Se conserva el valor original de "${title}" en este producto.`, 'info');
        },
      })
      : null;
    const badges = [illustrative ? illustrativeTag('Valor de ejemplo: reemplazalo por uno propio') : null, ...extraBadges].filter(Boolean);
    return h(
      'section',
      { class: ['qe-line', 'pe-line', compact ? 'qe-line-compact' : null], dataset: { list: listKey, index } },
      h(
        'div',
        { class: 'qe-line-head' },
        h('div', { class: 'qe-line-titles' },
          h('h3', { class: 'qe-line-title' }, out(() => titleOf(state.product[listKey][index]) || title)),
          badges.length ? h('div', { class: 'qe-line-badges' }, ...badges) : null),
        readOnly
          ? null
          : h('div', { class: 'qe-line-actions' },
            button('Quitar', { variant: 'ghost', size: 'sm', icon: 'trash', onClick: () => removeLine(listKey, index, titleOf(state.product[listKey][index]) || title), attrs: { 'aria-label': `Quitar ${title}`, 'data-edit': 'true' } })),
      ),
      notice,
      ...body,
      synced ? originNote(line, status) : null,
    );
  }

  function group(title, ...children) {
    return h('div', { class: 'qe-group' }, h('h4', { class: 'qe-group-title' }, title), ...children);
  }

  // ------------------------------------------------ tipo de cambio (moneda)
  function foreignCurrencies() {
    const own = currency();
    const out2 = [];
    const add = (base) => {
      const c = base && typeof base.currency === 'string' ? base.currency : null;
      if (c && c !== own && CURRENCIES.some((x) => x.id === c) && !out2.includes(c)) out2.push(c);
    };
    state.product.materials.forEach((m) => add(m.base));
    state.product.equipment.forEach((e) => add(e.base));
    return out2;
  }

  function exchangeRatesBlock() {
    const own = currency();
    const foreign = foreignCurrencies();
    if (!foreign.length) return null;
    return card(
      { title: 'Tipo de cambio', subtitle: `Hay valores en ${foreign.join(', ')}. Cargá cuántos ${own} vale cada uno: lo cargás vos (RATEOS no consulta cotizaciones). Sin tipo de cambio, esos valores no se suman.` },
      ...foreign.map((cur) => {
        const i = state.product.exchangeRates.findIndex((r) => r && r.currency === cur);
        if (i < 0) {
          if (readOnly) return h('p', { class: 'small' }, `Falta el tipo de cambio de ${cur}.`);
          const next = state.product.exchangeRates.length;
          return button(`Cargar tipo de cambio ${cur}`, {
            icon: 'plus',
            attrs: { 'data-edit': 'true' },
            onClick: () => mutate((p) => {
              p.exchangeRates.push({ currency: cur, rate: null, base: { period: null, currency: own, source: null, note: '' } });
            }, { focus: `exchangeRates.${next}.rate` }),
          });
        }
        return formGrid(2, kit.num(`exchangeRates.${i}.rate`, { label: `${own} por 1 ${cur}`, unit: own, hint: 'Sólo para este producto.' }));
      }),
    );
  }

  // ------------------------------------------------------- paso: producto
  function stepProducto() {
    const p = state.product;
    const saleOptions = [...SALE_UNIT_SUGGESTIONS];
    if (p.saleUnit && !saleOptions.includes(p.saleUnit)) saleOptions.unshift(p.saleUnit);
    const U = units().charAt(0).toUpperCase() + units().slice(1);
    return [
      card(
        { title: '¿Qué producto es?' },
        formGrid(
          2,
          kit.text('name', { label: 'Nombre del producto', maxLength: 120, placeholder: 'Por ejemplo: Chipá, medialunas, vianda' }),
          kit.select('saleUnit', { label: '¿Cómo lo vendés?', options: saleOptions.map((u) => ({ value: u, label: `Por ${u}` })), hint: 'El costo y el precio se calculan para esta unidad.', structural: true }),
        ),
      ),
      card(
        { title: 'Una tanda', subtitle: 'Una tanda es lo que hacés de una vez con una receta: una horneada, una olla, una producción.' },
        formGrid(
          2,
          kit.num('unitsPerBatch', { label: `¿Cuántas ${units()} salen de una tanda?`, rule: 'quantity', required: true, hint: 'Por ejemplo: de una receta salen 60 chipás.' }),
          kit.num('lossPct', { label: '¿Qué parte se pierde o no se vende?', rule: 'percent', unit: '%', hint: 'Se queman, se rompen, se regalan o sobran. Si no se pierde nada, dejalo en 0.' }),
        ),
        calc((r) => {
          if (!(r.unitsPerBatch > 0)) return 'Cargá cuántas salen de una tanda.';
          const lost = r.lossPct > 0 ? ` (${num(r.unitsPerBatch)} menos ${pctText(r.lossPct)} que se pierde)` : '';
          return `De cada tanda te quedan ${num(r.sellablePerBatch)} ${units()} para vender${lost}.`;
        }),
      ),
      card(
        { title: '¿Cuántas vendés por mes?' },
        formGrid(2, kit.num('monthlyUnits', { label: `${U} que vendés por mes`, rule: 'quantity', hint: 'Un promedio realista. Sirve para repartir los gastos fijos (alquiler, servicios) entre lo que vendés.' })),
        calc((r) => (r.monthlyUnits > 0 && r.sellablePerBatch > 0 ? `Son unas ${num(r.batchesPerMonth, 1)} tandas por mes.` : 'Si todavía no sabés, poné una estimación: después lo podés cambiar.')),
      ),
      disclosure({ summary: 'Notas (opcional)', open: Boolean(p.notes) }, kit.text('notes', { label: 'Notas', multiline: true, maxLength: 2000 })),
    ];
  }

  // ------------------------------------------------------- paso: insumos
  function materialText(i) {
    if (!i) return '';
    const perText = i.per === 'unit' ? `por ${saleUnit()}` : 'por tanda';
    if (i.issue === 'incompatible_units') return `No se puede pasar ${i.useUnit} a ${i.priceUnit}: usá unidades del mismo tipo (peso, volumen o unidades).`;
    if (i.issue === 'pack_size_missing') return 'Cargá cuánto trae el paquete para saber el precio por unidad.';
    if (i.currencyGap) return 'El precio está en otra moneda: cargá el tipo de cambio abajo.';
    if (!(i.quantity > 0)) return `Cargá la cantidad que usás ${perText}.`;
    const converted = i.useUnit !== i.priceUnit ? ` = ${num(i.quantityInPriceUnit, 3)} ${i.priceUnit}` : '';
    const waste = i.wastePct > 0 ? ` + ${pctText(i.wastePct)} de merma` : '';
    return `${num(i.quantity, 3)} ${i.useUnit}${converted} × ${unitMoney(i.unitPrice)} por ${perName(i.priceUnit)}${waste} = ${unitMoney(i.cost)} ${perText}.`;
  }

  function materialCard(i) {
    const line = state.product.materials[i];
    const base = `materials.${i}`;
    const per = line.per === 'unit' ? 'unit' : 'batch';
    const pack = line.priceMode === 'pack';
    const ill = line.illustrative === true;
    const foreign = line.base && line.base.currency && line.base.currency !== currency() ? line.base.currency : null;
    const wasteField = kit.num(`${base}.wastePct`, { label: 'Merma', rule: 'percent', unit: '%', hint: 'Lo que se tira o se pierde al usarlo.' });
    return lineCard({
      listKey: 'materials',
      index: i,
      titleOf: (l) => (l && l.description) || (per === 'unit' ? 'Empaque' : 'Ingrediente'),
      illustrative: ill,
      extraBadges: foreign ? [h('span', { class: 'badge badge-blue' }, `Precio en ${foreign}`)] : [],
      body: [
        formGrid(
          3,
          kit.text(`${base}.description`, { label: per === 'unit' ? 'Material' : 'Ingrediente', maxLength: 120 }),
          kit.num(`${base}.quantity`, { label: per === 'unit' ? `Cantidad por ${saleUnit()}` : 'Cantidad por tanda', rule: 'quantity', illustrative: ill }),
          kit.select(`${base}.useUnit`, { label: 'Unidad', options: unitOptions(line.useUnit) }),
        ),
        choiceGroup({
          label: '¿Cómo cargás el precio?',
          name: `${base}.priceMode`,
          value: pack ? 'pack' : 'unit',
          disabled: readOnly,
          options: PRODUCT_PRICE_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
          onChange: (v) => mutate((p) => { p.materials[i].priceMode = v; }, { focus: `${base}.priceMode` }),
        }),
        pack
          ? formGrid(
            4,
            kit.num(`${base}.packPrice`, { label: 'Precio del paquete', unit: '$', illustrative: ill }),
            kit.num(`${base}.packSize`, { label: 'El paquete trae', rule: 'quantity' }),
            kit.select(`${base}.unit`, { label: 'Unidad del contenido', options: unitOptions(line.unit) }),
            wasteField,
          )
          : formGrid(
            3,
            kit.num(`${base}.unitCost`, { label: 'Precio', unit: '$', illustrative: ill }),
            kit.select(`${base}.unit`, { label: 'Por', options: unitOptions(line.unit) }),
            wasteField,
          ),
        pack ? calc((r) => {
          const m = r.materials[i];
          return m && m.unitPrice !== null ? `Precio por ${perName(m.priceUnit)}: ${unitMoney(m.unitPrice)}.` : '';
        }) : null,
        calc((r) => materialText(r.materials[i])),
        kit.select(`${base}.per`, { label: '¿Dónde va?', options: PRODUCT_MATERIAL_PER.map((o) => ({ value: o.id, label: o.label })), structural: true }),
      ],
    });
  }

  function addMaterialFromLibrary(id) {
    const mat = syncResources.materials.find((m) => m.id === id);
    if (!mat) return;
    const index = state.product.materials.length;
    mutate((p) => p.materials.push(productMaterialLine(mat, { now: new Date().toISOString(), currency: currency() })), { focus: `materials.${index}.quantity` });
  }

  function addBlankMaterial(per) {
    const index = state.product.materials.length;
    mutate((p) => p.materials.push(blankProductMaterialLine({ per, currency: currency() })), { focus: `materials.${index}.description` });
  }

  function stepInsumos() {
    const lines = state.product.materials;
    const batch = lines.map((l, i) => (l.per === 'unit' ? -1 : i)).filter((i) => i >= 0);
    const perUnit = lines.map((l, i) => (l.per === 'unit' ? i : -1)).filter((i) => i >= 0);
    const library = syncResources.materials;
    const toolbar = (per) => (readOnly
      ? null
      : h(
        'div',
        { class: 'qe-toolbar pe-toolbar' },
        button(per === 'unit' ? 'Agregar empaque' : 'Agregar ingrediente', { variant: 'primary', icon: 'plus', onClick: () => addBlankMaterial(per), attrs: { 'data-edit': 'true' } }),
        per === 'batch' && library.length
          ? selectField({
            label: 'O traelo de Recursos → Materiales',
            name: 'pe-add-material',
            value: '',
            includeEmpty: true,
            emptyLabel: 'Elegí un material…',
            options: library.map((m) => ({ value: m.id, label: `${m.description || m.name || 'Material'}${m.illustrative ? ' (ilustrativo)' : ''}` })),
            onChange: (v) => v && addMaterialFromLibrary(v),
          })
          : null,
      ));
    return [
      tip('Cargá lo que usás en UNA tanda y cuánto te cuesta. RATEOS pasa solo de gramos a kilos y de mililitros a litros. Si comprás por bolsa o paquete, elegí "Precio del paquete".'),
      h(
        'section',
        { class: 'pe-section stack' },
        h('h3', { class: 'pe-section-title' }, 'En la receta (por tanda)'),
        h('p', { class: 'muted small pe-section-text' }, 'Harina, queso, huevos, grasa: lo que lleva cada tanda.'),
        batch.length ? h('div', { class: 'qe-lines' }, ...batch.map(materialCard)) : emptyHint('Todavía no cargaste ingredientes.'),
        toolbar('batch'),
      ),
      h(
        'section',
        { class: 'pe-section stack' },
        h('h3', { class: 'pe-section-title' }, `En cada ${saleUnit()} que vendés`),
        h('p', { class: 'muted small pe-section-text' }, 'Bolsita, etiqueta, caja o bandeja: lo que va en cada unidad.'),
        perUnit.length ? h('div', { class: 'qe-lines' }, ...perUnit.map(materialCard)) : emptyHint('Sin empaques por unidad.'),
        toolbar('unit'),
      ),
      exchangeRatesBlock(),
      h(
        'div',
        { class: 'pe-total' },
        calc((r) => {
          if (!r.materials.length) return 'Sin ingredientes ni materiales todavía.';
          if (!(r.sellablePerBatch > 0)) return `Receta: ${unitMoney(r.perBatch.materials)} por tanda. Cargá cuántas salen de una tanda (paso 1) para pasarlo a cada ${saleUnit()}.`;
          const pack = r.materialsPerUnitDirect > 0 ? ` + empaque ${unitMoney(r.materialsPerUnitDirect)}` : '';
          return `Receta: ${unitMoney(r.perBatch.materials)} por tanda ÷ ${num(r.sellablePerBatch)} ${units()} = ${unitMoney(r.perUnit.materialsBatch)}${pack} → ${unitMoney(r.perUnit.materials)} por ${saleUnit()}.`;
        }),
        liveTrace('materials'),
      ),
    ];
  }

  // ------------------------------------------------------- paso: personal
  function laborCard(i) {
    const line = state.product.labor[i];
    const base = `labor.${i}`;
    const agreement = agreements.find((a) => a.id === line.agreementId) || null;
    const ill = (key) => line.illustrative === true || Boolean(agreement && agreement.illustrative) || line[key] === ILLUSTRATIVE_AGREEMENT_PARAMS[key];
    const anyIll = ['normalHoursPerMonth', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct'].some(ill);
    return lineCard({
      listKey: 'labor',
      index: i,
      titleOf: (l) => (l && l.role) || 'Puesto',
      illustrative: line.illustrative === true,
      extraBadges: agreement ? [h('span', { class: ['badge', agreement.illustrative ? 'badge-orange' : 'badge-gray'] }, agreement.illustrative ? `${agreement.name} (ilustrativo)` : agreement.name)] : [],
      body: [
        formGrid(
          3,
          kit.text(`${base}.role`, { label: 'Puesto', placeholder: 'Por ejemplo: Panadero/a' }),
          selectField({
            label: 'Convenio',
            name: `${base}.agreementId`,
            value: line.agreementId || '',
            includeEmpty: true,
            emptyLabel: 'Sin convenio',
            disabled: readOnly,
            options: agreements.map((a) => ({ value: a.id, label: a.illustrative ? `${a.name} (ilustrativo)` : a.name })),
            hint: 'Al elegirlo se cargan sus cargas sociales y horas del mes.',
            onChange: (v) => chooseAgreement(i, v),
          }),
          kit.num(`${base}.people`, { label: 'Personas', rule: 'quantity', hint: 'Cuántas personas hacen esta tarea a la vez.' }),
        ),
        formGrid(
          3,
          kit.num(`${base}.basicMonthly`, { label: 'Sueldo básico mensual (por persona)', unit: '$', illustrative: line.illustrative === true }),
          kit.num(`${base}.additionalsMonthly`, { label: 'Adicionales mensuales', unit: '$', hint: 'Presentismo, antigüedad u otros adicionales remunerativos.' }),
          kit.num(`${base}.minutesPerBatch`, { label: 'Minutos por tanda (cada persona)', rule: 'minutes', unit: 'min', hint: 'Su tiempo de trabajo en una tanda: preparar, hornear, empaquetar.' }),
        ),
        calc((r) => {
          const l = r.labor[i];
          if (!l) return '';
          if (l.hourlyCost === null) return 'Cargá las horas normales del mes (en "Cargas sociales y horas del mes") para calcular el costo por hora.';
          return `Cada hora de trabajo cuesta ${unitMoney(l.hourlyCost)} con cargas (${money0(l.monthlyPerPerson)} por mes ÷ ${num(l.normalHoursPerMonth)} h). Por tanda: ${num(l.people)} × ${num(l.minutesPerBatch)} min = ${unitMoney(l.costPerBatch)}.`;
        }),
        calc((r) => {
          const l = r.labor[i];
          if (!l || l.hoursPerMonth === null || !(l.minutesPerBatch > 0) || !Number.isFinite(l.usedPct)) return '';
          const rest = l.usedPct < 100
            ? ' Las horas restantes no entran en el costo de este producto: si no las dedica a otros productos, sumá esa parte del sueldo en "Gastos fijos".'
            : '';
          return `Con unas ${num(r.batchesPerMonth, 1)} tandas por mes, cada persona dedica ${num(l.hoursPerMonth, 1)} h de las ${num(l.normalHoursPerMonth)} h que trabaja (${pctText(l.usedPct)}).${rest}`;
        }),
        disclosure(
          { summary: 'Cargas sociales y horas del mes', hint: anyIll ? 'Valores ILUSTRATIVOS: reemplazalos por los de tu convenio' : 'Aguinaldo, vacaciones, contribuciones, ART' },
          anyIll ? h('p', { class: 'small' }, 'Estos valores son genéricos e ILUSTRATIVOS: no son los de ningún convenio real. Cargá los vigentes de tu CCT o elegí un convenio con tus valores.') : null,
          formGrid(
            3,
            kit.num(`${base}.normalHoursPerMonth`, { label: 'Horas normales por mes', rule: 'hours', unit: 'h', illustrative: ill('normalHoursPerMonth') }),
            kit.num(`${base}.sacPct`, { label: 'Aguinaldo (SAC)', rule: 'percent', unit: '%', illustrative: ill('sacPct') }),
            kit.num(`${base}.vacationPct`, { label: 'Vacaciones', rule: 'percent', unit: '%', illustrative: ill('vacationPct') }),
            kit.num(`${base}.employerContributionsPct`, { label: 'Contribuciones patronales', rule: 'percent', unit: '%', illustrative: ill('employerContributionsPct') }),
            kit.num(`${base}.artPct`, { label: 'ART', rule: 'percent', unit: '%', illustrative: ill('artPct') }),
            kit.num(`${base}.ppeMonthly`, { label: 'Ropa de trabajo por mes', unit: '$' }),
            kit.num(`${base}.insuranceMonthly`, { label: 'Seguro de vida u otros por mes', unit: '$' }),
            kit.num(`${base}.trainingMonthly`, { label: 'Capacitación por mes', unit: '$' }),
          ),
        ),
      ],
    });
  }

  function chooseAgreement(i, id) {
    const agreement = agreements.find((a) => a.id === id) || null;
    mutate((p) => {
      const line = p.labor[i];
      line.agreementId = id || null;
      if (agreement) {
        const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(agreement.params || {}) };
        AGREEMENT_PARAM_KEYS.forEach((key) => {
          if (isFiniteNumber(params[key])) line[key] = params[key];
        });
      }
    }, { focus: `labor.${i}.agreementId` });
    if (agreement) notify(`Se cargaron las cargas sociales de "${agreement.name}"${agreement.illustrative ? ' (ILUSTRATIVAS)' : ''}.`, 'success');
  }

  function stepPersonal() {
    const lines = state.product.labor;
    const library = syncResources.laborProfiles;
    return [
      tip('Cargá quién hace el producto y cuánto tiempo le dedica a cada tanda. RATEOS calcula cuánto cuesta cada hora de trabajo con las cargas sociales (aguinaldo, vacaciones, contribuciones y ART) del convenio.'),
      agreements.length
        ? null
        : banner(h('span', {}, 'Todavía no cargaste convenios. Podés agregarlos en ', h('a', { href: '#/configuracion/convenios' }, 'Configuración → Convenios'), ' (por ejemplo Empleados de Comercio, Panaderos o Gastronómicos) con los valores vigentes de tu CCT. Mientras tanto, las cargas sociales son ILUSTRATIVAS.'), 'info'),
      lines.length ? h('div', { class: 'qe-lines' }, ...lines.map((_, i) => laborCard(i))) : emptyHint('Si lo hacés vos, cargate igual: tu tiempo también cuesta.'),
      readOnly
        ? null
        : h(
          'div',
          { class: 'qe-toolbar pe-toolbar' },
          button('Agregar puesto', {
            variant: 'primary',
            icon: 'plus',
            attrs: { 'data-edit': 'true' },
            onClick: () => {
              const index = state.product.labor.length;
              mutate((p) => p.labor.push(blankProductLaborLine({ currency: currency() })), { focus: `labor.${index}.role` });
            },
          }),
          library.length
            ? selectField({
              label: 'O traelo de Recursos → Personal',
              name: 'pe-add-labor',
              value: '',
              includeEmpty: true,
              emptyLabel: 'Elegí un puesto…',
              options: library.map((pr) => ({ value: pr.id, label: `${pr.role || 'Puesto'}${pr.illustrative ? ' (ilustrativo)' : ''}` })),
              onChange: (v) => {
                const profile = library.find((pr) => pr.id === v);
                if (!profile) return;
                const agreement = agreements.find((a) => a.id === profile.agreementId) || null;
                const index = state.product.labor.length;
                mutate((p) => p.labor.push(productLaborLine(profile, agreement, { now: new Date().toISOString(), currency: currency() })), { focus: `labor.${index}.minutesPerBatch` });
              },
            })
            : null,
        ),
      h(
        'div',
        { class: 'pe-total' },
        calc((r) => {
          if (!r.labor.length) return 'Sin personal cargado todavía.';
          if (!(r.sellablePerBatch > 0)) return `Personal: ${unitMoney(r.perBatch.labor)} por tanda. Cargá cuántas salen de una tanda (paso 1) para pasarlo a cada ${saleUnit()}.`;
          return `Personal: ${unitMoney(r.perBatch.labor)} por tanda ÷ ${num(r.sellablePerBatch)} ${units()} = ${unitMoney(r.perUnit.labor)} por ${saleUnit()}.`;
        }),
        liveTrace('labor'),
      ),
    ];
  }

  // ------------------------------------------------------- paso: máquinas
  function maintenanceFields(i) {
    const line = state.product.equipment[i];
    const base = `equipment.${i}`;
    const mode = maintenanceOf(line).mode;
    if (mode === 'service') {
      return formGrid(
        3,
        kit.num(`${base}.maintenanceServiceCost`, { label: 'Costo de cada service', unit: '$' }),
        kit.num(`${base}.maintenanceServiceHours`, { label: 'Cada cuántas horas de uso', rule: 'intervalHours', unit: 'h' }),
      );
    }
    if (mode === 'budget') {
      return formGrid(
        3,
        kit.num(`${base}.maintenanceBudget`, { label: 'Presupuesto de mantenimiento', unit: '$' }),
        kit.select(`${base}.maintenanceBudgetPeriod`, { label: 'Período', options: BUDGET_PERIODS.map((b) => ({ value: b.id, label: b.label })) }),
      );
    }
    return formGrid(3, kit.num(`${base}.maintenancePerHour`, { label: 'Mantenimiento por hora de uso', unit: '$/h', hint: 'Repuestos, service y arreglos, repartidos por hora de uso.' }));
  }

  function chooseShare(i, value) {
    const base = `equipment.${i}`;
    mutate((p) => {
      const l = p.equipment[i];
      l.shareMode = value || null;
      if (value === 'dedicated') l.fixedSharePct = 100;
      else if (value === 'shared') {
        if (l.fixedSharePct === 100) l.fixedSharePct = null;
      } else l.fixedSharePct = null;
    }, { focus: value === 'shared' ? `${base}.fixedSharePct` : `${base}.shareMode` });
  }

  function equipmentCard(i) {
    const line = state.product.equipment[i];
    const base = `equipment.${i}`;
    const ill = line.illustrative === true;
    const shareMode = shareModeOf(line);
    const foreign = line.base && line.base.currency && line.base.currency !== currency() ? line.base.currency : null;
    return lineCard({
      listKey: 'equipment',
      index: i,
      titleOf: (l) => (l && l.name) || 'Máquina',
      illustrative: ill,
      extraBadges: foreign ? [h('span', { class: 'badge badge-blue' }, `Valor en ${foreign}`)] : [],
      body: [
        formGrid(2, kit.text(`${base}.name`, { label: 'Máquina o equipo', placeholder: 'Por ejemplo: Horno, amasadora, heladera' })),
        group(
          'Al usarla (va por tanda)',
          formGrid(
            3,
            kit.num(`${base}.minutesPerBatch`, { label: 'Minutos de uso por tanda', rule: 'minutes', unit: 'min' }),
            kit.num(`${base}.energyPerHour`, { label: 'Luz o gas por hora de uso', unit: '$/h', hint: 'Lo que suma a tu factura cada hora que está prendida.', illustrative: ill }),
            selectField({
              label: 'Mantenimiento',
              name: `${base}.maintenanceMode`,
              value: maintenanceOf(line).mode,
              disabled: readOnly,
              options: MAINTENANCE_MODES.map((m) => ({ value: m.id, label: m.label })),
              onChange: (v) => mutate((p) => { p.equipment[i].maintenanceMode = v; }, { focus: `${base}.maintenanceMode` }),
            }),
          ),
          maintenanceFields(i),
          h('p', { class: 'small muted pe-interpretation' }, out(() => maintenanceInterpretation(state.product.equipment[i]))),
          calc((r) => {
            const e = r.equipment[i];
            if (!e) return '';
            if (!(e.minutesPerBatch > 0)) return 'Cargá cuántos minutos se usa en cada tanda.';
            return `Por tanda: ${num(e.minutesPerBatch)} min × ${unitMoney(e.usePerHour)} por hora = ${unitMoney(e.useCostPerBatch)}.`;
          }),
        ),
        group(
          'Por tenerla (gasto fijo del mes)',
          formGrid(
            4,
            kit.num(`${base}.replacementValue`, { label: '¿Cuánto cuesta comprarla hoy?', unit: '$', illustrative: ill }),
            kit.num(`${base}.usefulLifeYears`, { label: 'Años de vida útil', rule: 'years', unit: 'años' }),
            kit.num(`${base}.residualValue`, { label: 'Valor al final (opcional)', unit: '$', hint: 'Lo que valdría al venderla usada.' }),
            kit.num(`${base}.insuranceAnnual`, { label: 'Seguro por año', unit: '$' }),
          ),
          disclosure(
            { summary: 'Más costos de tenerla (opcional)', hint: 'Habilitaciones, controles, costo de capital' },
            formGrid(
              4,
              kit.num(`${base}.licenseAnnual`, { label: 'Habilitaciones o patente por año', unit: '$' }),
              kit.num(`${base}.certificationsAnnual`, { label: 'Controles o certificaciones por año', unit: '$' }),
              kit.num(`${base}.otherAnnual`, { label: 'Otros por año', unit: '$' }),
              kit.num(`${base}.capitalRatePctAnnual`, { label: 'Costo de capital (% anual)', rule: 'percent', unit: '%', hint: 'Lo que ganarías con esa plata en otra inversión. Si no sabés, dejalo vacío.' }),
            ),
          ),
          calc((r) => {
            const e = r.equipment[i];
            if (!e) return '';
            const o = e.ownership;
            if (!(o.totalMonthly > 0)) return 'Sin costos de tenerla cargados.';
            const parts = [`amortización ${money0(o.depreciationMonthly)}`];
            if (o.cashMonthly > 0) parts.push(`seguro y otros ${money0(o.cashMonthly)}`);
            if (o.capitalCostMonthly > 0) parts.push(`costo de capital ${money0(o.capitalCostMonthly)}`);
            return `Tenerla cuesta ${money0(o.totalMonthly)} por mes (${parts.join(' + ')}).`;
          }),
          selectField({
            label: '¿La usás sólo para este producto?',
            name: `${base}.shareMode`,
            value: shareMode,
            includeEmpty: true,
            emptyLabel: 'Elegí una opción…',
            disabled: readOnly,
            options: [
              { value: 'dedicated', label: 'Sí, sólo para este producto (le toca el 100 %)' },
              { value: 'shared', label: 'No, también la uso para otras cosas' },
            ],
            onChange: (v) => chooseShare(i, v),
          }),
          shareMode === 'shared'
            ? formGrid(2, kit.num(`${base}.fixedSharePct`, { label: '¿Qué parte de sus costos fijos le toca a este producto?', rule: 'percent', unit: '%', hint: 'Lo decidís vos: por ejemplo, si la mitad de las horneadas son de este producto, 50 %. RATEOS no lo calcula solo.' }))
            : null,
          calc((r) => {
            const e = r.equipment[i];
            if (!e) return '';
            if (e.sharePct === null) return e.ownershipMonthly > 0 ? 'Elegí si la usás sólo para este producto: hasta entonces, su amortización no se suma.' : '';
            return `A este producto le tocan ${money0(e.fixedAssigned)} por mes (${pctText(e.sharePct)} de ${money0(e.ownershipMonthly)}). Se reparte en "Gastos fijos".`;
          }),
        ),
        disclosure(
          { summary: 'Combustible (si usa gasoil, nafta o garrafa por litro)' },
          formGrid(
            3,
            kit.num(`${base}.fuelLitersPerHour`, { label: 'Litros por hora de uso', rule: 'quantity', unit: 'l/h' }),
            kit.num('fuelPricePerLiter', { label: 'Precio del litro', unit: '$', hint: 'Vale para todas las máquinas de este producto.' }),
          ),
        ),
      ],
    });
  }

  function stepMaquinas() {
    const lines = state.product.equipment;
    const library = syncResources.equipment.filter((e) => !e.acquisition || e.acquisition === 'owned');
    return [
      tip('Una máquina cuesta de dos formas: al USARLA (luz o gas y mantenimiento), que va por tanda, y por TENERLA (amortización y seguro), que se paga aunque esté apagada y es un gasto fijo del mes.'),
      lines.length ? h('div', { class: 'qe-lines' }, ...lines.map((_, i) => equipmentCard(i))) : emptyHint('¿Usás horno, amasadora, heladera, freidora o cortadora? Agregalas para sumar lo que gastan y su amortización. Si no usás máquinas, seguí al paso siguiente.'),
      readOnly
        ? null
        : h(
          'div',
          { class: 'qe-toolbar pe-toolbar' },
          button('Agregar máquina', {
            variant: 'primary',
            icon: 'plus',
            attrs: { 'data-edit': 'true' },
            onClick: () => {
              const index = state.product.equipment.length;
              mutate((p) => p.equipment.push(blankProductEquipmentLine({ currency: currency() })), { focus: `equipment.${index}.name` });
            },
          }),
          library.length
            ? selectField({
              label: 'O traela de Recursos → Mis equipos',
              name: 'pe-add-equipment',
              value: '',
              includeEmpty: true,
              emptyLabel: 'Elegí un equipo…',
              options: library.map((e) => ({ value: e.id, label: `${e.name || 'Equipo'}${e.illustrative ? ' (ilustrativo)' : ''}` })),
              onChange: (v) => {
                const eq = library.find((e) => e.id === v);
                if (!eq) return;
                const index = state.product.equipment.length;
                mutate((p) => p.equipment.push(productEquipmentLine(eq, { now: new Date().toISOString(), currency: currency() })), { focus: `equipment.${index}.minutesPerBatch` });
              },
            })
            : null,
        ),
      exchangeRatesBlock(),
      h(
        'div',
        { class: 'pe-total' },
        calc((r) => {
          if (!r.equipment.length) return 'Sin máquinas cargadas.';
          const use = r.sellablePerBatch > 0 ? `Uso: ${unitMoney(r.perBatch.equipmentUse)} por tanda ÷ ${num(r.sellablePerBatch)} ${units()} = ${unitMoney(r.perUnit.equipmentUse)} por ${saleUnit()}.` : `Uso: ${unitMoney(r.perBatch.equipmentUse)} por tanda.`;
          return `${use} Tenencia asignada: ${money0(r.equipmentFixedMonthly)} por mes.`;
        }),
        liveTrace('equipmentUse'),
      ),
    ];
  }

  // ------------------------------------------------------- paso: fijos
  function fixedRow(i) {
    const base = `fixedCosts.${i}`;
    return lineCard({
      listKey: 'fixedCosts',
      index: i,
      compact: true,
      titleOf: (l) => (l && l.description) || 'Gasto fijo',
      illustrative: /\(ejemplo\)/.test(state.product.fixedCosts[i].description || '') && state.product.illustrative === true,
      body: [
        formGrid(
          3,
          kit.text(`${base}.description`, { label: 'Gasto', maxLength: 120 }),
          kit.num(`${base}.monthlyAmount`, { label: 'Total por mes', unit: '$' }),
          kit.num(`${base}.sharePct`, { label: 'Parte para este producto', rule: 'percent', unit: '%' }),
        ),
        calc((r) => {
          const f = r.fixedCosts[i];
          if (!f) return '';
          if (f.sharePct === null) return f.monthlyAmount > 0 ? 'Cargá qué parte le toca a este producto: hasta entonces no se suma.' : '';
          return `${money0(f.monthlyAmount)} × ${pctText(f.sharePct)} = ${money0(f.assigned)} por mes para este producto.`;
        }),
      ],
    });
  }

  function addFixed(description) {
    const index = state.product.fixedCosts.length;
    mutate((p) => p.fixedCosts.push(createFixedCost({ description })), { focus: `fixedCosts.${index}.monthlyAmount` });
  }

  function stepFijos() {
    const lines = state.product.fixedCosts;
    let shareAll = null;
    const applyAll = !readOnly && lines.length > 1
      ? h(
        'div',
        { class: 'qe-toolbar pe-toolbar pe-apply-all' },
        numberField({ label: 'Mismo % para todos los gastos', name: 'pe-share-all', rule: 'percent', unit: '%', value: null, onChange: (v) => { shareAll = v; } }),
        button('Aplicar a todos', {
          icon: 'check',
          attrs: { 'data-edit': 'true' },
          onClick: () => {
            if (!isFiniteNumber(shareAll)) {
              notify('Escribí primero el %.', 'warning');
              return;
            }
            const value = shareAll;
            mutate((p) => p.fixedCosts.forEach((l) => { l.sharePct = value; }));
            notify(`Se aplicó ${pctText(value)} a todos los gastos fijos.`, 'success');
          },
        }),
      )
      : null;
    const missing = FIXED_COST_SUGGESTIONS.filter((s) => !lines.some((l) => l.description === s));
    return [
      tip('Son los gastos que pagás todos los meses aunque no hagas ni una tanda: alquiler, la parte fija de la luz y el gas, internet, contador, sueldos de administración. Cargá el total del mes y qué parte le toca a ESTE producto.'),
      h('p', { class: 'small muted' }, 'Ejemplo: si en tu local hacés 4 productos parecidos, a cada uno le podría tocar 25 % del alquiler. Lo decidís vos: RATEOS no lo calcula solo.'),
      lines.length ? h('div', { class: 'qe-lines' }, ...lines.map((_, i) => fixedRow(i))) : emptyHint('Todavía no cargaste gastos fijos.'),
      readOnly
        ? null
        : h(
          'div',
          { class: 'pe-chips' },
          h('span', { class: 'small muted' }, 'Agregar:'),
          ...missing.map((s) => button(s, { size: 'sm', icon: 'plus', onClick: () => addFixed(s), attrs: { 'data-edit': 'true' } })),
          button('Otro gasto', { size: 'sm', icon: 'plus', onClick: () => addFixed('Gasto fijo'), attrs: { 'data-edit': 'true' } }),
        ),
      applyAll,
      h(
        'div',
        { class: 'pe-total' },
        calc((r) => {
          if (!(r.fixedMonthly > 0)) return 'Todavía no hay gastos fijos asignados a este producto.';
          const split = r.equipmentFixedMonthly > 0 ? ` (máquinas ${money0(r.equipmentFixedMonthly)} + negocio ${money0(r.otherFixedMonthly)})` : '';
          if (!(r.monthlyUnits > 0)) return `Fijos de este producto: ${money0(r.fixedMonthly)} por mes${split}. Falta cuántas vendés por mes (paso 1) para repartirlos.`;
          return `Fijos de este producto: ${money0(r.fixedMonthly)} por mes${split} ÷ ${num(r.monthlyUnits)} ${units()} = ${unitMoney(r.fixedPerUnit)} por ${saleUnit()}.`;
        }),
        liveTrace('fixed'),
      ),
      h('p', { class: 'small muted' }, 'Si vendés menos, a cada unidad le toca más gasto fijo: por eso conviene una estimación realista de lo que vendés por mes.'),
    ];
  }

  // ------------------------------------------------------- paso: precio
  function stat(label, fn, { emphasis = false, trace = null, hint = null } = {}) {
    return h('div', { class: ['qe-stat', emphasis ? 'is-emphasis' : null] },
      h('span', { class: 'qe-stat-label' }, label),
      h('span', { class: 'qe-stat-value mono' }, out(fn)),
      hint ? h('span', { class: 'qe-stat-hint' }, out(hint)) : null,
      trace ? liveTrace(trace) : null);
  }

  function stepPrecio() {
    return [
      card(
        { title: '¿Cuánto querés ganar?' },
        formGrid(2, kit.num('pricing.targetMarginPct', { label: 'Margen que querés ganar', rule: 'margin', unit: '%', hint: 'Sobre el precio: con 30 %, de cada $ 100 que cobrás (sin IVA ni impuestos) te quedan $ 30 de ganancia.' })),
        calc((r) => {
          const pr = r.pricing;
          if (pr.marginInput === null || pr.marginInput === undefined) return 'Sin margen cargado, el precio sugerido es el precio piso: no ganás nada.';
          if (pr.markupPct === null) return '';
          return `Con este precio, el recargo sobre el costo (markup) es ${pctText(pr.markupPct)}. Margen y markup no son lo mismo: el margen se mide sobre el precio y el markup sobre el costo.`;
        }),
      ),
      card(
        { title: 'Impuestos sobre lo que vendés', subtitle: 'Ingresos Brutos, tasa municipal sobre las ventas, impuesto al cheque. El % te lo pasa tu contador. No incluyas el IVA (va abajo) ni Ganancias.' },
        billingTaxesFields({
          get: () => state.product.billingTaxes,
          update: (rel, value) => update(`billingTaxes.${rel}`, value),
          mutate: (fn, opts = {}) => mutate((prod) => fn(prod.billingTaxes), { focus: opts.focus || null }),
          readOnly,
          namePrefix: 'billingTaxes',
          scope: 'product',
        }),
      ),
      card(
        { title: 'Redondeo, IVA y tu precio de hoy' },
        formGrid(
          3,
          kit.select('pricing.roundingStep', {
            label: 'Redondear el precio hacia arriba',
            options: ROUNDING_STEPS.map((s) => ({ value: String(s), label: s === 0 ? 'Sin redondeo' : `A múltiplos de ${formatMoney(s)}` })),
            toValue: (v) => Number(v) || 0,
            hint: 'Siempre hacia arriba: nunca baja tu margen.',
          }),
          kit.num('pricing.vatPct', { label: 'IVA para el precio al público (opcional)', rule: 'percent', unit: '%', hint: 'Cargalo vos si corresponde: RATEOS no trae alícuotas. El IVA no es costo ni ganancia.' }),
          kit.num('pricing.currentPrice', { label: `¿A cuánto lo vendés hoy? (opcional)`, unit: '$', hint: 'Sin IVA. Para compararlo con el precio sugerido.' }),
        ),
      ),
      card(
        { title: `Tu precio por ${saleUnit()}` },
        h(
          'div',
          { class: 'qe-stats' },
          stat(`Costo por ${saleUnit()}`, (r) => unitMoney(r.unitCost), { trace: 'unitCost' }),
          stat('Precio piso (no ganás ni perdés)', (r) => unitMoney(r.pricing.floorPrice), { trace: 'floor' }),
          stat('Precio con tu margen', (r) => unitMoney(r.pricing.targetPrice), { hint: () => 'Exacto, antes de redondear.' }),
          stat('Precio sugerido (sin IVA)', (r) => unitMoney(r.pricing.suggestedPrice), { emphasis: true, trace: 'target' }),
          stat('Precio al público con IVA', (r) => (r.pricing.priceWithVat === null ? 'Sin IVA cargado' : unitMoney(r.pricing.priceWithVat))),
        ),
      ),
    ];
  }

  // ------------------------------------------------------- paso: resultado
  function issuesBox(title, issues, tone) {
    return h(
      'div',
      { class: ['qe-tip', tone === 'danger' ? 'qe-tip-danger' : 'qe-tip-warning', 'pe-issues'] },
      icon('alert'),
      h(
        'div',
        {},
        h('strong', {}, title),
        h('ul', { class: 'pe-issue-list' }, ...issues.map((i) => {
          const target = PRODUCT_STEPS.find((s) => s.id === stepOfIssue(i.path));
          return h('li', {}, i.message, target && target.id !== step.id ? [' ', h('a', { href: href(target.id) }, `Ir a "${target.label}"`)] : null);
        })),
      ),
    );
  }

  function breakEvenText(value, price) {
    if (value === null) return price === null ? EMPTY : 'No se alcanza';
    return formatNumber(Math.ceil(value));
  }

  function stepResultado() {
    const r = state.result;
    const p = state.product;
    if (!r) return [banner('No se pudo calcular el producto. Revisá los datos de cada paso.', 'danger')];
    const pr = r.pricing;
    const errors = r.issues.filter((i) => i.severity === 'error');
    const warnings = r.issues.filter((i) => i.severity !== 'error');
    const u = saleUnit();
    const N = r.monthlyUnits;
    const be = pr.breakEvenUnits;
    const beHint = be === null
      ? (pr.suggestedPrice === null ? 'Faltan datos.' : `Con este precio cada ${u} no cubre lo que cuesta hacerla.`)
      : !(r.fixedMonthly > 0)
        ? 'Sin gastos fijos asignados: cada venta ya deja ganancia.'
        : N > 0
          ? (N >= be ? `Vendés ${num(N, 0)} por mes: estás por encima.` : `Vendés ${num(N, 0)} por mes: todavía no llegás.`)
          : 'Para cubrir los gastos fijos del mes.';
    const traceCell = (key) => (r.traces[key] ? liveTrace(key) : null);
    const breakdownRows = r.breakdown.map((b) => ({ ...b, trace: { materials: 'materials', labor: 'labor', equipmentUse: 'equipmentUse', equipmentFixed: 'fixed', otherFixed: 'fixed' }[b.key] }));
    const current = r.current;
    const nodes = [
      p.illustrative ? illustrativeBanner('Este es un producto de EJEMPLO con valores ILUSTRATIVOS: no son precios, sueldos ni costos reales. Cambialos por los tuyos o borralo.') : null,
      errors.length ? issuesBox('Faltan datos para calcular bien:', errors, 'danger') : null,
      warnings.length ? issuesBox('Revisá:', warnings, 'warning') : null,
      h(
        'div',
        { class: 'pe-hero' },
        bigStat({ label: `Te cuesta cada ${u}`, value: unitMoney(r.unitCost), hint: 'Ingredientes, personal, máquinas y gastos fijos.', trace: r.traces.unitCost, size: 'lg' }),
        bigStat({
          label: 'Precio sugerido (sin IVA)',
          value: unitMoney(pr.suggestedPrice),
          hint: `Con ${pctText(pr.marginPct)} de margen${pr.taxPct > 0 ? ` y ${pctText(pr.taxPct)} de impuestos sobre la venta` : ''}${pr.roundingStep > 0 ? `, redondeado a ${formatMoney(pr.roundingStep)}` : ''}.`,
          trace: r.traces.target,
          tone: 'blue',
          size: 'lg',
        }),
        bigStat({ label: `Ganás por cada ${u}`, value: unitMoney(pr.gainPerUnit), hint: 'Después de los impuestos sobre la venta y de todos los costos.', tone: pr.gainPerUnit > 0 ? 'green' : pr.gainPerUnit < 0 ? 'red' : null }),
        bigStat({ label: 'Para no perder plata', value: breakEvenText(be, pr.suggestedPrice), unit: be !== null ? `${units()} por mes` : null, hint: beHint, trace: r.traces.breakEven, tone: be !== null && N > 0 && N < be ? 'orange' : null }),
      ),
      pr.priceWithVat !== null
        ? h('p', { class: 'pe-vat' }, `Precio al público con IVA (${pctText(pr.vatPct)}): `, h('strong', { class: 'mono' }, unitMoney(pr.priceWithVat)), ' ', traceCell('vat'))
        : null,
      card(
        { title: `¿Cómo se forma el costo de cada ${u}?` },
        barList(breakdownRows.map((b) => ({ label: b.label, value: b.displayPct }))),
        table({
          className: 'pe-table pe-breakdown',
          caption: `Costo por ${u}, por rubro`,
          columns: [
            { key: 'label', label: 'Rubro' },
            { key: 'amount', label: `Por ${u}`, align: 'right', render: (row) => h('span', { class: 'mono' }, unitMoney(row.amount)) },
            { key: 'pct', label: 'Incidencia', align: 'right', render: (row) => pctText(row.displayPct) },
            { key: 'calc', label: 'Cálculo', align: 'right', render: (row) => traceCell(row.trace) },
          ],
          rows: breakdownRows,
          footer: { label: 'Total', amount: h('strong', { class: 'mono' }, unitMoney(r.unitCost)), pct: r.unitCost > 0 ? '100 %' : '', calc: traceCell('unitCost') },
        }),
        h('p', { class: 'footnote' }, `Variable (cambia con lo que producís): ${unitMoney(r.variablePerUnit)} · Fijo (se paga igual cada mes): ${unitMoney(r.fixedPerUnit)} por ${u}.`),
      ),
      card(
        { title: 'Precios' },
        table({
          className: 'pe-table',
          caption: 'Precios por unidad',
          columns: [
            { key: 'label', label: 'Precio' },
            { key: 'value', label: `Por ${u}`, align: 'right', render: (row) => h('span', { class: 'mono' }, row.value) },
            { key: 'calc', label: 'Cálculo', align: 'right', render: (row) => (row.trace ? traceCell(row.trace) : '') },
          ],
          rows: [
            { label: 'Precio piso (no ganás ni perdés)', value: unitMoney(pr.floorPrice), trace: 'floor' },
            { label: `Precio con ${pctText(pr.marginPct)} de margen (exacto)`, value: unitMoney(pr.targetPrice), trace: null },
            { label: 'Precio sugerido (sin IVA)', value: unitMoney(pr.suggestedPrice), trace: 'target' },
            pr.priceWithVat !== null ? { label: 'Precio al público con IVA', value: unitMoney(pr.priceWithVat), trace: 'vat' } : null,
            { label: 'Markup equivalente (recargo sobre el costo)', value: pr.markupPct === null ? EMPTY : pctText(pr.markupPct), trace: null },
          ].filter(Boolean),
        }),
        h('p', { class: 'footnote' }, 'Margen ≠ markup: el margen se mide sobre el precio y el markup sobre el costo. Los precios son sin IVA salvo donde se indica.'),
      ),
      card(
        { title: 'Una tanda' },
        table({
          className: 'pe-table',
          caption: 'Costos de una tanda',
          columns: [
            { key: 'label', label: 'Concepto' },
            { key: 'value', label: 'Valor', align: 'right', render: (row) => h('span', { class: 'mono' }, row.value) },
          ],
          rows: [
            { label: 'Unidades por tanda', value: num(r.unitsPerBatch) },
            { label: 'Se pierde', value: pctText(r.lossPct) },
            { label: `${units().charAt(0).toUpperCase()}${units().slice(1)} para vender`, value: num(r.sellablePerBatch) },
            { label: 'Ingredientes (receta)', value: unitMoney(r.perBatch.materials) },
            { label: 'Personal', value: unitMoney(r.perBatch.labor) },
            { label: 'Uso de máquinas', value: unitMoney(r.perBatch.equipmentUse) },
            { label: 'Costo variable de la tanda', value: unitMoney(r.perBatch.variable) },
          ],
        }),
      ),
      N > 0 && pr.suggestedPrice !== null
        ? card(
          { title: `Un mes vendiendo ${num(N, 0)} ${units()} al precio sugerido` },
          table({
            className: 'pe-table',
            caption: 'Resultado del mes',
            columns: [
              { key: 'label', label: 'Concepto' },
              { key: 'value', label: 'Por mes', align: 'right', render: (row) => h('span', { class: ['mono', row.strong ? 'pe-strong' : null] }, row.value) },
            ],
            rows: [
              { label: 'Ventas (sin IVA)', value: money0(r.monthly.revenue) },
              { label: 'Impuestos sobre la venta', value: `− ${money0(r.monthly.salesTaxes)}` },
              { label: 'Costos variables (ingredientes, personal, uso de máquinas)', value: `− ${money0(r.monthly.variable)}` },
              { label: 'Gastos fijos asignados', value: `− ${money0(r.monthly.fixed)}` },
              { label: 'Ganancia del mes', value: money0(r.monthly.profit), strong: true },
            ],
          }),
        )
        : null,
      current
        ? card(
          { title: `Tu precio de hoy: ${unitMoney(current.price)}` },
          current.belowVariable
            ? banner(`Con este precio cada ${u} no cubre ni lo que cuesta hacerla: cuanto más vendés, más perdés.`, 'danger')
            : current.belowFloor
              ? banner('Tu precio de hoy está por debajo del precio piso: no cubre todos tus costos.', 'danger')
              : pr.suggestedPrice !== null && current.price < pr.suggestedPrice
                ? banner('Cubre tus costos, pero está por debajo del precio sugerido: ganás menos que el margen que querés.', 'warning')
                : banner('Tu precio de hoy cubre tus costos y el margen que querés.', 'success'),
          h(
            'div',
            { class: 'qe-stats' },
            h('div', { class: 'qe-stat' }, h('span', { class: 'qe-stat-label' }, 'Margen real'), h('span', { class: 'qe-stat-value mono' }, current.marginPct === null ? EMPTY : pctText(current.marginPct))),
            h('div', { class: 'qe-stat' }, h('span', { class: 'qe-stat-label' }, `Ganás por ${u}`), h('span', { class: 'qe-stat-value mono' }, unitMoney(current.profitPerUnit))),
            h('div', { class: 'qe-stat' }, h('span', { class: 'qe-stat-label' }, 'Para no perder plata'), h('span', { class: 'qe-stat-value mono' }, `${breakEvenText(current.breakEvenUnits, current.price)}${current.breakEvenUnits !== null ? ` ${units()}/mes` : ''}`)),
            N > 0 ? h('div', { class: 'qe-stat' }, h('span', { class: 'qe-stat-label' }, 'Resultado del mes'), h('span', { class: 'qe-stat-value mono' }, money0(current.monthlyProfit))) : null,
          ),
        )
        : null,
      h(
        'div',
        { class: 'row pe-result-actions' },
        linkButton('Cambiar el margen o el precio', href('precio'), { icon: 'edit' }),
        linkButton('Revisar desde el principio', href('producto'), { variant: 'ghost' }),
        linkButton('Volver a Productos', '#/productos', { variant: 'ghost', icon: 'arrowLeft' }),
      ),
    ];
    return nodes;
  }

  // ------------------------------------------------------------- layout
  function syncHeader() {
    const name = (state.product.name || '').trim() || 'Producto';
    if (state.headerName === name) return;
    state.headerName = name;
    if (typeof app.setHeader === 'function') {
      app.setHeader({ title: name, breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }, { label: 'Productos', href: '#/productos' }] });
    }
  }
  fixedOutputs.push(syncHeader);

  const stepsNav = h(
    'nav',
    { class: 'pe-steps', 'aria-label': 'Pasos del producto' },
    h('ol', { class: 'pe-steps-list' }, ...PRODUCT_STEPS.map((s, i) => {
      const sr = h('span', { class: 'sr-only' });
      const current = s.id === step.id;
      const li = h(
        'li',
        { class: 'pe-step' },
        h(
          'a',
          { href: productHref(state.product, s.id), class: ['pe-step-link', current ? 'is-current' : null], 'aria-current': current ? 'step' : null },
          h('span', { class: 'pe-step-num', 'aria-hidden': 'true' }, String(i + 1)),
          h('span', { class: 'pe-step-label' }, s.label),
          sr,
        ),
      );
      fixedOutputs.push(() => {
        const st = productStepStatus(s.id, state.product, state.result);
        li.dataset.status = st || '';
        sr.textContent = st ? ` (${STATUS_TEXT[st]})` : '';
      });
      return li;
    })),
  );

  const asideRow = (label, fn, { strong = false } = {}) => h('div', { class: ['pe-aside-row', strong ? 'is-strong' : null] }, h('dt', {}, label), h('dd', { class: 'mono' }, out(fn, { fixed: true })));
  const aside = step.id === 'resultado'
    ? null
    : h(
      'aside',
      { class: 'pe-aside', 'aria-label': 'Así va tu producto' },
      h('h2', { class: 'pe-aside-title' }, 'Así va tu producto'),
      h(
        'dl',
        { class: 'pe-aside-list' },
        asideRow('Costo por unidad', (r) => unitMoney(r.unitCost)),
        asideRow('Precio sugerido', (r) => unitMoney(r.pricing.suggestedPrice), { strong: true }),
        asideRow('Ganás por unidad', (r) => unitMoney(r.pricing.gainPerUnit)),
        asideRow('Para no perder', (r) => (r.pricing.breakEvenUnits === null ? (r.pricing.suggestedPrice === null ? EMPTY : 'No se alcanza') : `${formatNumber(Math.ceil(r.pricing.breakEvenUnits))} por mes`)),
      ),
      out((r) => (r.unitCost > 0 ? barList(r.breakdown.filter((b) => b.displayPct > 0).map((b) => ({ label: b.label, value: b.displayPct }))) : h('p', { class: 'small muted' }, 'A medida que cargues datos, acá vas a ver cómo se forma el costo.')), { tag: 'div', className: 'pe-aside-bars', fixed: true }),
      out((r) => {
        const errors = r.issues.filter((i) => i.severity === 'error').length;
        const warnings = r.issues.length - errors;
        if (!errors && !warnings) return '';
        return h('p', { class: ['small', errors ? 'pe-aside-alert' : 'pe-aside-warn'] }, errors ? `${errors === 1 ? 'Falta 1 dato' : `Faltan ${errors} datos`} para calcular bien.` : `${warnings === 1 ? 'Hay 1 dato' : `Hay ${warnings} datos`} para revisar.`);
      }, { tag: 'div', fixed: true }),
      h('p', { class: 'footnote' }, 'Precios sin IVA. El margen se mide sobre el precio.'),
      linkButton('Ver el resultado', href('resultado'), { size: 'sm', iconAfter: 'arrowRight' }),
    );

  const prev = PRODUCT_STEPS[stepIndex - 1];
  const next = PRODUCT_STEPS[stepIndex + 1];
  const stepNav = h(
    'div',
    { class: 'pe-step-nav' },
    prev ? linkButton(`Anterior: ${prev.label}`, href(prev.id), { icon: 'arrowLeft' }) : linkButton('Volver a Productos', '#/productos', { icon: 'arrowLeft' }),
    next ? linkButton(`Siguiente: ${next.label}`, href(next.id), { variant: 'primary', iconAfter: 'arrowRight' }) : null,
  );

  const stepIssues = step.id === 'resultado'
    ? null
    : out((r) => {
      const list = r.issues.filter((i) => stepOfIssue(i.path) === step.id);
      if (!list.length) return '';
      const errors = list.filter((i) => i.severity === 'error');
      return issuesBox(errors.length ? 'Falta completar:' : 'Revisá:', list, errors.length ? 'danger' : 'warning');
    }, { tag: 'div', fixed: true });

  const stepBody = h('div', { class: 'pe-step-body stack' });
  const mainEl = h(
    'div',
    { class: 'pe-main stack' },
    h(
      'div',
      { class: 'pe-step-head' },
      stepIndicator({ current: stepIndex + 1, total: PRODUCT_STEPS.length }),
      h('h2', { class: 'pe-step-title' }, step.label),
      h('p', { class: 'pe-step-hint' }, STEP_HINTS[step.id] || ''),
    ),
    calcErrorBanner,
    stepIssues,
    stepBody,
    stepNav,
  );

  const STEP_RENDERERS = {
    producto: stepProducto,
    insumos: stepInsumos,
    personal: stepPersonal,
    maquinas: stepMaquinas,
    fijos: stepFijos,
    precio: stepPrecio,
    resultado: stepResultado,
  };

  function renderStep() {
    stepOutputs = [];
    let nodes;
    try {
      nodes = STEP_RENDERERS[step.id]();
    } catch (error) {
      logger.error('No se pudo dibujar el paso del producto', { step: step.id, message: error && error.message });
      nodes = [banner('No se pudo mostrar este paso. Tus datos guardados no se modificaron.', 'danger')];
    }
    mount(stepBody, ...nodes);
    if (readOnly) {
      stepBody.querySelectorAll('input, select, textarea').forEach((el) => {
        el.disabled = true;
      });
    }
  }

  layoutEl = h(
    'div',
    { class: ['pe', step.id === 'resultado' ? 'pe-is-result' : null, readOnly ? 'is-readonly' : null], dataset: { step: step.id } },
    h(
      'div',
      { class: 'pe-head' },
      h('p', { class: 'pe-head-name' }, out(() => `Costo y precio por ${saleUnit()}`, { fixed: true })),
      saveEl,
    ),
    state.product.illustrative && step.id !== 'resultado' ? illustrativeBanner('Producto de EJEMPLO: los valores son ILUSTRATIVOS (no son precios, sueldos ni costos reales). Cambialos por los tuyos.') : null,
    stepsNav,
    h('div', { class: 'pe-body' }, mainEl, aside),
  );

  // ------------------------------------------------------------- ciclo de vida
  function onFieldInput() {
    syncInvalidState();
  }
  const onPageHide = () => {
    revertInvalidFields();
    if (state.dirty) save();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden' && state.dirty && !hasInvalidFields()) save();
  };
  const onBeforeUnload = (event) => {
    if (state.dirty && state.saveStatus === 'error') {
      event.preventDefault();
      event.returnValue = '';
    }
  };

  let unsubscribeSync = () => {};
  const api = {
    productId,
    mount() {
      setSaveStatus(state.saveStatus);
      if (app.ctx && app.ctx.sync && typeof app.ctx.sync.onChange === 'function') {
        unsubscribeSync = app.ctx.sync.onChange((sync) => {
          if (state.disposed || state.saveStatus !== 'error') return;
          if (state.saveErrorCode === 'conflict' && !sync.conflict) {
            state.dirty = false;
            unsavedDrafts.delete(productId);
            scheduleSave.cancel();
            setSaveStatus('saved');
            return;
          }
          if (!['sync_failed', 'session_expired'].includes(state.saveErrorCode)) return;
          if (sync.status === 'saved' && !sync.dirty) {
            state.dirty = false;
            unsavedDrafts.delete(productId);
            setSaveStatus('saved');
          }
        });
      }
      recompute();
      mount(root, layoutEl);
      renderStep();
      refreshAll();
      // En pantallas angostas la barra de pasos se desplaza: el paso actual queda a la vista.
      const currentLink = stepsNav.querySelector('.pe-step-link.is-current');
      if (currentLink && stepsNav.scrollWidth > stepsNav.clientWidth) {
        stepsNav.scrollLeft = Math.max(0, currentLink.offsetLeft - (stepsNav.clientWidth - currentLink.offsetWidth) / 2);
      }
      layoutEl.addEventListener('input', onFieldInput);
      layoutEl.addEventListener('change', onFieldInput);
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
      if (state.disposed) return pendingSaves.get(productId) || Promise.resolve(true);
      scheduleRecalc.cancel();
      revertInvalidFields();
      const flushing = state.dirty ? save() : pendingSaves.get(productId) || Promise.resolve(true);
      state.disposed = true;
      unsubscribeSync();
      layoutEl.removeEventListener('input', onFieldInput);
      layoutEl.removeEventListener('change', onFieldInput);
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
  if (typeof app.setHeader === 'function') app.setHeader({ title: 'Producto no encontrado', breadcrumbs: [{ label: 'Productos', href: '#/productos' }] });
  mount(
    root,
    card(
      { title: 'Producto no encontrado', subtitle: 'Puede haber sido eliminado o el enlace no es correcto.' },
      h('p', {}, 'Volvé a la lista para abrir otro producto o crear uno nuevo.'),
      h('a', { class: 'btn btn-primary', href: '#/productos' }, 'Ir a Productos'),
    ),
  );
}

/**
 * Vista del editor de productos.
 * @param {HTMLElement} root
 * @param {object} app
 * @param {{ id: string, step?: string }} params
 * @returns {Promise<Function|undefined>} limpieza (fuerza el guardado pendiente)
 */
export async function render(root, app, params = {}) {
  const token = ++renderSequence;
  const id = params && typeof params.id === 'string' ? params.id : '';
  const requested = params && typeof params.step === 'string' && params.step !== '' ? params.step : null;
  const validStep = requested !== null && PRODUCT_STEPS.some((s) => s.id === requested);
  if (requested !== null && !validStep && id && typeof app.navigate === 'function') {
    app.navigate(`#/productos/${encodeURIComponent(id)}/producto`, { replace: true });
    return undefined;
  }
  const stepId = validStep ? requested : 'producto';

  // El editor anterior (otro paso u otro producto) guarda antes de seguir.
  if (activeEditor) await activeEditor.dispose();
  if (token !== renderSequence) return undefined;

  mount(root, h('div', { class: 'loading', role: 'status' }, 'Cargando producto…'));
  if (pendingSaves.has(id)) await pendingSaves.get(id);

  let product;
  let resources;
  try {
    [product, resources] = await Promise.all([app.ctx.products.getProduct(id), loadResources(app)]);
  } catch (error) {
    if (token !== renderSequence) return undefined;
    logger.error('No se pudo abrir el producto', { message: error && error.message });
    if (typeof app.setHeader === 'function') app.setHeader({ title: 'No se pudo abrir el producto', breadcrumbs: [{ label: 'Productos', href: '#/productos' }] });
    mount(
      root,
      card(
        { title: 'No se pudo abrir el producto' },
        h('p', {}, userErrorMessage(error, 'Ocurrió un error al leer los datos guardados. Tus datos no se modificaron.')),
        h('a', { class: 'btn btn-primary', href: '#/productos' }, 'Ir a Productos'),
      ),
    );
    return undefined;
  }
  if (token !== renderSequence) return undefined;
  if (!product) {
    renderNotFound(root, app);
    return undefined;
  }

  const draft = unsavedDrafts.get(id);
  const editor = createEditor(root, app, { product: draft ? deepClone(draft) : product, resources, stepId, restoredDraft: Boolean(draft) });
  activeEditor = editor;
  editor.mount();
  return () => {
    editor.dispose();
  };
}
