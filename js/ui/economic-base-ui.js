/**
 * Piezas de interfaz de la base económica y los snapshots (PLAN-2026-005).
 *
 * - baseTag: "Base: sep-26" / "Base no definida" (nunca una fecha ISO).
 * - baseFormFields: campos de base para los formularios de Recursos.
 * - syncNotice: "El costo de X fue actualizado desde que hiciste esta
 *   cotización." con valor utilizado vs actual y [Actualizar] [Conservar].
 *   Nunca actualiza solo.
 */

import { h } from './dom.js';
import { button, icon } from './components.js';
import { formatPeriod, formatMoneyIn, formatDateTime, EMPTY } from '../core/format.js';
import { BASE_SOURCES, CURRENCIES, labelOf } from '../domain/catalogs.js';
import { baseDefined } from '../domain/economic-base.js';
import { mainValueOf } from '../domain/resource-sync.js';
import { CURRENCY } from '../config.js';

const isForeign = (currency) => typeof currency === 'string' && currency && currency !== CURRENCY;

/** Etiqueta compacta de una base: "Base: sep-26 · USD" o "Base no definida". */
export function baseTag(base, { prefix = 'Base', showCurrency = true } = {}) {
  const defined = baseDefined(base);
  const text = defined ? `${prefix}: ${formatPeriod(base.period)}` : `${prefix} no definida`;
  const currency = showCurrency && base && isForeign(base.currency) ? ` · ${base.currency}` : '';
  const source = defined && base.source ? labelOf(BASE_SOURCES, base.source, '') : '';
  return h('span', {
    class: ['base-tag', defined ? null : 'is-undefined'],
    title: defined ? `Período base ${formatPeriod(base.period)}${source ? ` · ${source}` : ''}${base.note ? ` · ${base.note}` : ''}` : 'Sin fecha base: no se sabe de cuándo es este valor.',
  }, `${text}${currency}`);
}

/** Texto plano de una base (para resúmenes y trazas). */
export function baseText(base, { prefix = 'Base' } = {}) {
  if (!baseDefined(base)) return `${prefix} no definida`;
  const currency = isForeign(base.currency) ? ` · ${base.currency}` : '';
  return `${prefix}: ${formatPeriod(base.period)}${currency}`;
}

/**
 * Campos de base para openResourceForm (Recursos).
 * @param {string} key  ruta del objeto base (p. ej. 'base' o 'costsBase')
 * @param {{ currency?: boolean, periodLabel?: string }} options
 */
export function baseFormFields(key, { currency = false, periodLabel = 'Período base (mes del valor)' } = {}) {
  return [
    { key: `${key}.period`, label: periodLabel, kind: 'period', hint: 'De qué mes es este valor. Vacío = "Base no definida".' },
    currency
      ? { key: `${key}.currency`, label: 'Moneda', kind: 'select', options: CURRENCIES.map((c) => ({ value: c.id, label: c.label })), hint: 'Otra moneda se convierte con el tipo de cambio de cada cotización.' }
      : null,
    { key: `${key}.source`, label: 'Fuente', kind: 'select', options: BASE_SOURCES.map((s) => ({ value: s.id, label: s.label })), includeEmpty: true, emptyLabel: 'Sin indicar' },
    { key: `${key}.note`, label: 'Referencia (opcional)', kind: 'text', maxLength: 160, placeholder: 'Ej.: lista de precios de octubre' },
  ].filter(Boolean);
}

/** Valor principal formateado ("$ 3.200.000" o "US$ 420.000"). */
function mainValueText(type, values) {
  const v = mainValueOf(type, values);
  if (v === null || v === undefined) return EMPTY;
  const currency = values && values.base && values.base.currency ? values.base.currency : CURRENCY;
  return formatMoneyIn(v, currency);
}

/**
 * Aviso de cambio en Recursos para una línea (o null si no corresponde).
 * @param {object} status  lineSyncStatus(...)
 * @param {{ name: string, onUpdate: Function, onKeep: Function, readOnly?: boolean }} opts
 */
export function syncNotice(status, { name, onUpdate, onKeep, readOnly = false }) {
  if (!status || status.state !== 'changed') return null;
  const title = status.legacy
    ? `El valor de "${name}" en Recursos es distinto del que usa esta cotización.`
    : `El costo de "${name}" fue actualizado desde que hiciste esta cotización.`;
  return h(
    'div',
    { class: 'sync-notice', role: 'status' },
    h('div', { class: 'sync-notice-head' }, icon('info', { size: 16 }), h('strong', {}, title)),
    h(
      'dl',
      { class: 'sync-notice-values' },
      h('div', {}, h('dt', {}, 'Valor utilizado'), h('dd', { class: 'mono' }, mainValueText(status.type, status.used)), h('dd', {}, baseText(status.used && status.used.base))),
      h('div', {}, h('dt', {}, 'Valor actual en Recursos'), h('dd', { class: 'mono' }, mainValueText(status.type, status.current)), h('dd', {}, baseText(status.current && status.current.base))),
    ),
    h('p', { class: 'sync-notice-hint' }, 'La cotización no cambia sola. Elegí qué hacer con este recurso:'),
    h(
      'div',
      { class: 'sync-notice-actions' },
      button('Actualizar en esta cotización', { variant: 'primary', size: 'sm', icon: 'check', disabled: readOnly, onClick: onUpdate, attrs: { 'data-edit': 'true' } }),
      button('Conservar valor original', { variant: 'secondary', size: 'sm', disabled: readOnly, onClick: onKeep, attrs: { 'data-edit': 'true' } }),
    ),
  );
}

/**
 * Origen de una línea: "De Recursos · copiado el 05/10/26 14:30" + base.
 * @param {object} line
 */
export function lineOrigin(line, { bases = [] } = {}) {
  const snap = line && line.snapshot;
  const from = snap && snap.resourceId
    ? `De Recursos${snap.takenAt ? ` · copiado el ${formatDateTime(snap.takenAt)}` : ''}`
    : 'Cargado en esta cotización';
  return h('div', { class: 'line-origin' }, h('span', { class: 'line-origin-from' }, from), ...bases.map((b) => baseTag(b.base, { prefix: b.prefix || 'Base' })));
}
