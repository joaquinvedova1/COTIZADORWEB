/**
 * Componentes de interfaz reutilizables (sin lógica de negocio).
 * Todo el texto se inserta con nodos de texto: seguro frente a XSS.
 */

import { h, s, uniqueId, mount } from './dom.js';
import { formatValue, EMPTY } from '../core/format.js';
import { validateNumber, numberToInputText } from '../core/validation.js';
import { track } from '../core/events.js';

// ------------------------------------------------------------------ íconos

const ICONS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  quote: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h5v2H8v-2z',
  library: 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  services: 'M12 2 2 7l10 5 10-5-10-5zm0 13L2 10v2l10 5 10-5v-2l-10 5zm0 4L2 14v2l10 5 10-5v-2l-10 5z',
  settings: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4L10.6 6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  upload: 'M5 20h14v-2H5v2zm4-4h6v-6h4l-7-7-7 7h4v6z',
  chevronRight: 'M10 6 8.6 7.4 13.2 12l-4.6 4.6L10 18l6-6z',
  chevronLeft: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z',
  info: 'M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z',
  alert: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  calc: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-6.5 4.5h5V9h-5V7.5zm0 7h5V16h-5v-1.5zm0-2.5h5v1.5h-5V12zM6 8.25h1.75V6.5h1.5v1.75H11v1.5H9.25V11.5h-1.5V9.75H6v-1.5zm.6 9.3L8 16.1l-1.4-1.4 1.06-1.06 1.4 1.4 1.4-1.4 1.06 1.06-1.4 1.4 1.4 1.4-1.06 1.06-1.4-1.4-1.4 1.4-1.06-1.06z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  print: 'M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8v5zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-1-9H6v4h12V3z',
  edit: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
};

/** Ícono SVG inline (formas estáticas internas, nunca datos de usuario). */
export function icon(name, { size = 18, label = null } = {}) {
  const path = ICONS[name] || ICONS.info;
  return s(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, class: 'icon', 'aria-hidden': label ? null : 'true', role: label ? 'img' : null, 'aria-label': label },
    s('path', { d: path, fill: 'currentColor' }),
  );
}

// ---------------------------------------------------------------- básicos

/**
 * Botón.
 * @param {string} label
 * @param {{ variant?: 'primary'|'secondary'|'ghost'|'danger'|'link', onClick?: Function, icon?: string, title?: string, type?: string, size?: 'sm'|'md', disabled?: boolean, attrs?: object }} [opts]
 */
export function button(label, { variant = 'secondary', onClick, icon: iconName, title, type = 'button', size = 'md', disabled = false, attrs = {} } = {}) {
  return h(
    'button',
    {
      type,
      class: ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : null],
      title: title || null,
      disabled,
      on: onClick ? { click: onClick } : undefined,
      ...attrs,
    },
    iconName ? icon(iconName, { size: size === 'sm' ? 16 : 18 }) : null,
    label ? h('span', {}, label) : null,
  );
}

/** Badge de estado. tone: green | orange | red | blue | gray | navy */
export function badge(text, tone = 'gray', { title = null } = {}) {
  return h('span', { class: ['badge', `badge-${tone}`], title }, text);
}

/** Punto de semáforo + texto. */
export function statusDot(tone, text) {
  return h('span', { class: 'status' }, h('span', { class: ['dot', `dot-${tone}`], 'aria-hidden': 'true' }), text);
}

/**
 * Tarjeta.
 * @param {{ title?: string, subtitle?: string, actions?: Node[], className?: string, id?: string }} opts
 */
export function card({ title = null, subtitle = null, actions = [], className = '', id = null } = {}, ...children) {
  const header = title || subtitle || (actions && actions.length)
    ? h('div', { class: 'card-header' },
      h('div', { class: 'card-titles' }, title ? h('h3', { class: 'card-title' }, title) : null, subtitle ? h('p', { class: 'card-subtitle' }, subtitle) : null),
      actions && actions.length ? h('div', { class: 'card-actions' }, ...actions) : null)
    : null;
  return h('section', { class: ['card', className], id }, header, h('div', { class: 'card-body' }, ...children));
}

/**
 * Tarjeta KPI.
 * @param {{ label: string, value: string, hint?: string, tone?: string, trace?: object, emphasis?: boolean }} opts
 */
export function kpi({ label, value, hint = null, tone = null, trace = null, emphasis = false }) {
  return h('div', { class: ['kpi', tone ? `kpi-${tone}` : null, emphasis ? 'kpi-emphasis' : null] },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value' }, value ?? EMPTY),
    hint ? h('div', { class: 'kpi-hint' }, hint) : null,
    trace ? traceButton(trace, { compact: true }) : null);
}

/** Banner de aviso. tone: info | warning | danger | success */
export function banner(text, tone = 'info', { title = null } = {}) {
  const iconName = tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert';
  return h('div', { class: ['banner', `banner-${tone}`], role: tone === 'danger' ? 'alert' : 'status' },
    icon(iconName),
    h('div', {}, title ? h('strong', {}, title, ' ') : null, text));
}

/** Aviso estándar de valores ilustrativos. */
export function illustrativeBanner(text = 'Los valores de demostración son ILUSTRATIVOS: no son escalas salariales, cargas, alícuotas ni costos reales. Reemplazalos por valores propios vigentes antes de cotizar.') {
  return banner(text, 'warning', { title: 'Datos ilustrativos.' });
}

/** Estado vacío. */
export function emptyState(text, action = null) {
  return h('div', { class: 'empty-state' }, h('p', {}, text), action);
}

/** Barra de progreso 0–100. */
export function progressBar(value, tone = 'blue', { label = null } = {}) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return h('div', { class: ['progress', `progress-${tone}`], role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(v)), 'aria-label': label },
    h('div', { class: 'progress-bar', style: { width: `${v}%` } }));
}

// ------------------------------------------------------------------ tabla

/**
 * Tabla de datos.
 * columns: [{ key, label, align?: 'left'|'right'|'center', format?: string, render?: (row) => Node|string, className?: string }]
 */
export function table({ columns, rows, footer = null, className = '', emptyText = 'Sin datos.', rowClass = null, caption = null }) {
  const thead = h('thead', {}, h('tr', {}, ...columns.map((c) => h('th', { class: [c.align ? `ta-${c.align}` : null, c.className], scope: 'col' }, c.label))));
  const body = rows.length
    ? rows.map((row, i) => h('tr', { class: rowClass ? rowClass(row, i) : null },
      ...columns.map((c) => {
        const content = c.render ? c.render(row, i) : formatValue(row[c.key], c.format || 'text');
        return h('td', { class: [c.align ? `ta-${c.align}` : null, c.className], 'data-label': c.label }, content);
      })))
    : [h('tr', {}, h('td', { colspan: String(columns.length), class: 'ta-center muted' }, emptyText))];
  const tfoot = footer
    ? h('tfoot', {}, h('tr', {}, ...columns.map((c) => {
      const v = footer[c.key];
      const content = v instanceof Node ? v : v === undefined ? '' : c.footerFormat ? formatValue(v, c.footerFormat) : String(v);
      return h('td', { class: [c.align ? `ta-${c.align}` : null] }, content);
    })))
    : null;
  return h('div', { class: ['table-wrap', className] },
    h('table', { class: 'table' }, caption ? h('caption', { class: 'sr-only' }, caption) : null, thead, h('tbody', {}, ...body), tfoot));
}

// -------------------------------------------------------------- formulario

function fieldShell({ id, label, hint, unit, error, required, illustrative }, control) {
  const errorEl = h('div', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: !error }, error || '');
  return {
    el: h('div', { class: ['field', illustrative ? 'field-illustrative' : null] },
      h('label', { class: 'field-label', for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null,
        illustrative ? h('span', { class: 'tag-illustrative', title: 'Valor ilustrativo' }, 'ILUSTRATIVO') : null),
      h('div', { class: ['field-control', unit ? 'has-unit' : null] }, control, unit ? h('span', { class: 'field-unit' }, unit) : null),
      hint ? h('div', { class: 'field-hint', id: `${id}-hint` }, hint) : null,
      errorEl),
    errorEl,
  };
}

/**
 * Campo numérico con validación (formato argentino: "1.800.000,50").
 * - onChange(value:number|null) se llama en vivo SÓLO con valores válidos.
 * - Si al confirmar (salir del campo / Enter) el valor es inválido, se
 *   restaura el valor que tenía al entrar al campo: nunca queda guardado un
 *   prefijo intermedio (p. ej. "15" al tipear "150" en un margen).
 * @param {{ label: string, value: number|null, rule?: string, onChange: Function, hint?: string, unit?: string, required?: boolean, step?: string|number, placeholder?: string, disabled?: boolean, illustrative?: boolean, name?: string }} opts
 */
export function numberField({ label, value, rule = 'money', onChange, hint = null, unit = null, required = false, placeholder = '', disabled = false, illustrative = false, name = null }) {
  const id = uniqueId('num');
  const input = h('input', {
    id,
    name,
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: numberToInputText(value),
    placeholder,
    disabled,
    'aria-describedby': hint ? `${id}-hint ${id}-error` : `${id}-error`,
  });
  const { el, errorEl } = fieldShell({ id, label, hint, unit, required, illustrative }, input);
  let committedValue = value === undefined ? null : value;
  let focusValue = committedValue;
  let focusText = input.value;
  const showError = (message) => {
    input.setAttribute('aria-invalid', 'true');
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const clearError = () => {
    input.removeAttribute('aria-invalid');
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  const emit = (v) => {
    committedValue = v;
    if (typeof onChange === 'function') onChange(v);
  };
  input.addEventListener('focus', () => {
    focusValue = committedValue;
    focusText = input.value;
  });
  input.addEventListener('input', () => {
    const r = validateNumber(input.value, rule, { required });
    if (!r.ok) {
      showError(r.error);
      return;
    }
    clearError();
    emit(r.value);
  });
  input.addEventListener('change', () => {
    const r = validateNumber(input.value, rule, { required });
    if (r.ok) {
      clearError();
      if (r.value !== committedValue) emit(r.value);
      return;
    }
    // Valor inválido al confirmar: se vuelve al valor previo al foco.
    const message = r.error;
    input.value = focusText;
    if (committedValue !== focusValue) emit(focusValue);
    showError(`${message} Se restauró el valor anterior.`);
  });
  return el;
}

/** Campo de texto. onChange(texto) en cada cambio. */
export function textField({ label, value = '', onChange, placeholder = '', maxLength = 200, hint = null, required = false, multiline = false, name = null, disabled = false }) {
  const id = uniqueId('txt');
  const control = multiline
    ? h('textarea', { id, name, rows: '3', maxlength: String(maxLength), placeholder, disabled })
    : h('input', { id, name, type: 'text', maxlength: String(maxLength), placeholder, value: value ?? '', disabled });
  if (multiline) control.value = value ?? '';
  control.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange(control.value.slice(0, maxLength));
  });
  return fieldShell({ id, label, hint, required }, control).el;
}

/**
 * Selector.
 * options: [{ value, label, disabled? }]
 */
export function selectField({ label, value, options, onChange, hint = null, name = null, includeEmpty = false, emptyLabel = 'Seleccionar…', disabled = false }) {
  const id = uniqueId('sel');
  const select = h('select', { id, name, disabled },
    includeEmpty ? h('option', { value: '' }, emptyLabel) : null,
    ...options.map((o) => h('option', { value: String(o.value), disabled: Boolean(o.disabled), selected: String(o.value) === String(value ?? '') }, o.label)));
  select.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange(select.value === '' ? null : select.value);
  });
  return fieldShell({ id, label, hint }, select).el;
}

/** Casilla de verificación. */
export function checkboxField({ label, checked = false, onChange, hint = null, name = null, disabled = false }) {
  const id = uniqueId('chk');
  const input = h('input', { id, name, type: 'checkbox', checked, disabled });
  input.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange(input.checked);
  });
  return h('div', { class: 'field field-check' },
    h('label', { class: 'check', for: id }, input, h('span', {}, label)),
    hint ? h('div', { class: 'field-hint' }, hint) : null);
}

/** Grupo de opciones tipo "tarjeta" (radio). options: [{ value, label, hint }] */
export function choiceGroup({ label, value, options, onChange, name = uniqueId('choice'), disabled = false }) {
  return h('fieldset', { class: 'choice-group' },
    h('legend', { class: 'field-label' }, label),
    h('div', { class: 'choice-grid' }, ...options.map((o) => {
      const id = uniqueId('opt');
      const input = h('input', { type: 'radio', id, name, value: String(o.value), checked: String(o.value) === String(value), disabled: disabled || Boolean(o.disabled) });
      input.addEventListener('change', () => {
        if (input.checked && typeof onChange === 'function') onChange(o.value);
      });
      return h('label', { class: 'choice', for: id }, input, h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, o.label), o.hint ? h('span', { class: 'choice-hint' }, o.hint) : null));
    })));
}

/** Grilla de campos. cols: 2 | 3 | 4 */
export function formGrid(cols = 3, ...fields) {
  return h('div', { class: ['form-grid', `cols-${cols}`] }, ...fields);
}

// ------------------------------------------------------------- diálogos

function ensureDialogRoot() {
  let root = document.getElementById('dialog-root');
  if (!root) {
    root = h('div', { id: 'dialog-root' });
    document.body.appendChild(root);
  }
  return root;
}

/** Abre un diálogo modal accesible. Devuelve { dialog, close }. */
export function openDialog({ title, content, actions = [], wide = false, onClose = null }) {
  const root = ensureDialogRoot();
  const titleId = uniqueId('dlg');
  const dialog = h('dialog', { class: ['dialog', wide ? 'dialog-wide' : null], 'aria-labelledby': titleId });
  const close = () => {
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (typeof onClose === 'function') onClose();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  mount(dialog,
    h('div', { class: 'dialog-header' },
      h('h2', { id: titleId, class: 'dialog-title' }, title),
      button('', { variant: 'ghost', icon: 'close', onClick: close, attrs: { 'aria-label': 'Cerrar' } })),
    h('div', { class: 'dialog-body' }, content),
    actions.length ? h('div', { class: 'dialog-actions' }, ...actions) : null);
  root.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return { dialog, close };
}

/** Confirmación. Devuelve Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, details = null }) {
  return new Promise((resolve) => {
    let result = false;
    const { close } = openDialog({
      title,
      content: h('div', {}, h('p', {}, message), details),
      actions: [
        button(cancelLabel, { variant: 'secondary', onClick: () => close() }),
        button(confirmLabel, { variant: danger ? 'danger' : 'primary', onClick: () => { result = true; close(); } }),
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Contenido de una traza de cálculo. */
export function traceContent(trace) {
  const rows = (items) => items.map((it) => h('tr', {}, h('th', { scope: 'row' }, it.label), h('td', { class: 'ta-right mono' }, formatValue(it.value, it.format, it.unit))));
  return h('div', { class: 'trace' },
    h('div', { class: 'trace-formula' }, h('span', { class: 'trace-kicker' }, 'Fórmula'), h('code', {}, trace.formula)),
    trace.inputs.length ? h('div', {}, h('h4', {}, 'Datos de entrada'), h('table', { class: 'table table-compact' }, h('tbody', {}, ...rows(trace.inputs)))) : null,
    trace.steps.length ? h('div', {}, h('h4', {}, 'Pasos intermedios'), h('table', { class: 'table table-compact' }, h('tbody', {}, ...rows(trace.steps)))) : null,
    h('div', { class: 'trace-result' }, h('span', {}, trace.result.label), h('strong', { class: 'mono' }, formatValue(trace.result.value, trace.result.format, trace.result.unit))),
    trace.notes.length ? h('ul', { class: 'trace-notes' }, ...trace.notes.map((n) => h('li', {}, n))) : null);
}

/** Abre el diálogo "Ver cálculo". */
export function openTraceDialog(trace) {
  track('calculation_trace_opened', { traceId: String(trace.id || 'unknown').replace(/[^a-z0-9_]/gi, '_').toLowerCase() });
  if (trace.id === 'break_even') track('break_even_viewed', {});
  return openDialog({ title: `Ver cálculo — ${trace.title}`, content: traceContent(trace), wide: true });
}

/** Botón "Ver cálculo". */
export function traceButton(trace, { compact = false, label = 'Ver cálculo' } = {}) {
  return button(compact ? label : label, { variant: 'link', size: 'sm', icon: 'calc', onClick: () => openTraceDialog(trace), attrs: { class: 'btn btn-link btn-sm trace-btn' } });
}

// ------------------------------------------------------------------ toasts

/** Notificación breve. tone: info | success | warning | danger */
export function toast(message, tone = 'info', { timeout = 3500 } = {}) {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = h('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
  }
  const el = h('div', { class: ['toast', `toast-${tone}`] }, message);
  region.appendChild(el);
  setTimeout(() => el.remove(), timeout);
  return el;
}

// ----------------------------------------------------------- gráfico barras

/**
 * Barras horizontales simples (incidencia %). items: [{ label, value (0–100), tone? }]
 */
export function barList(items, { format = 'percent' } = {}) {
  return h('div', { class: 'bar-list' }, ...items.map((it) => h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label' }, it.label),
    h('div', { class: 'bar-track' }, h('div', { class: ['bar-fill', it.tone ? `bar-${it.tone}` : null], style: { width: `${Math.max(0, Math.min(100, Number.isFinite(it.value) ? it.value : 0))}%` } })),
    h('div', { class: 'bar-value mono' }, formatValue(it.value, format)))));
}
