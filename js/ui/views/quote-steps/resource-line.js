/**
 * Línea de cotización ↔ recurso maestro (PLAN-2026-005).
 *
 * RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN: cada línea guarda los valores que
 * usó (snapshot). Si después cambia el recurso en Recursos, la cotización NO
 * cambia sola: se muestra "valor utilizado vs valor actual" y la persona
 * elige [Actualizar en esta cotización] o [Conservar valor original].
 *
 * Sólo presentación: el estado lo calcula domain/resource-sync.js.
 */

import { h } from '../../dom.js';
import { formGrid, periodField, selectField, textField } from '../../components.js';
import { CURRENCY } from '../../../config.js';
import { BASE_SOURCES, CURRENCIES } from '../../../domain/catalogs.js';
import { lineSyncStatus, applyResourceUpdate, dismissResourceUpdate } from '../../../domain/resource-sync.js';
import { syncNotice, lineOrigin, baseTag } from '../../economic-base-ui.js';

/** Moneda de la cotización (la de la empresa al crearla). */
export function quoteCurrencyOf(quote) {
  return quote && typeof quote.currency === 'string' && quote.currency ? quote.currency : CURRENCY;
}

/** Recursos que necesita la comparación con el maestro. */
function syncResources(resources = {}) {
  return {
    laborProfiles: resources.laborProfiles || [],
    agreements: resources.agreements || [],
    equipment: resources.equipment || [],
    externalServices: resources.externalServices || [],
    materials: resources.materials || [],
  };
}

/** Estado de la línea frente a su recurso (unlinked | missing | current | changed | dismissed). */
export function statusOfLine(ctx, listKey, index) {
  const line = ctx.quote[listKey] && ctx.quote[listKey][index];
  if (!line) return null;
  return lineSyncStatus(listKey, line, syncResources(ctx.resources), { currency: quoteCurrencyOf(ctx.quote) });
}

/**
 * Aviso de cambio en Recursos para una línea (o null). Nunca actualiza solo.
 * @param {object} ctx  contexto del paso (quote, resources, mutate, toast, readOnly)
 */
export function resourceSyncNotice(ctx, listKey, index, { name }) {
  const status = statusOfLine(ctx, listKey, index);
  if (!status) return null;
  const resources = syncResources(ctx.resources);
  const currency = quoteCurrencyOf(ctx.quote);
  return syncNotice(status, {
    name,
    readOnly: ctx.readOnly,
    onUpdate: () => {
      ctx.mutate((q) => {
        const line = q[listKey][index];
        if (line) q[listKey][index] = applyResourceUpdate(listKey, line, resources, { now: new Date().toISOString(), currency });
      });
      ctx.toast(`"${name}" usa ahora los valores actuales de Recursos (sólo en esta cotización).`, 'success');
    },
    onKeep: () => {
      ctx.mutate((q) => {
        const line = q[listKey][index];
        if (line) q[listKey][index] = dismissResourceUpdate(listKey, line, resources, { currency });
      });
      ctx.toast(`Se conserva el valor original de "${name}" en esta cotización.`, 'info');
    },
  });
}

/** Texto corto del estado para el origen de la línea. */
function stateNote(status) {
  if (!status) return null;
  if (status.state === 'missing') return 'El recurso ya no está en Recursos: la cotización conserva sus valores.';
  if (status.state === 'dismissed') return 'Recursos cambió y elegiste conservar el valor original.';
  if (status.adjusted) return 'Con ajustes en esta cotización (Recursos no cambia).';
  return null;
}

/**
 * Origen + bases de una línea: "De Recursos · copiado el … · Base: sep-26".
 * @param {{ prefix?: string, base: object }[]} bases
 */
export function lineOriginBlock(ctx, listKey, index, bases) {
  const line = ctx.quote[listKey] && ctx.quote[listKey][index];
  if (!line) return null;
  const status = statusOfLine(ctx, listKey, index);
  const note = stateNote(status);
  return h('div', { class: 'line-origin-wrap' }, lineOrigin(line, { bases }), note ? h('p', { class: 'line-origin-note small' }, note) : null);
}

/** Etiqueta de base para encabezados de línea. */
export function lineBaseBadge(base, prefix = 'Base') {
  return baseTag(base, { prefix });
}

/**
 * Campos de la base de un valor DENTRO de la cotización (período, moneda,
 * fuente, referencia). Cambian sólo esta cotización.
 * @param {object} ctx
 * @param {string} path  ruta del objeto base (p. ej. "materials.2.base")
 * @param {{ currency?: boolean, periodLabel?: string }} options
 */
export function baseFields(ctx, path, { currency = false, periodLabel = 'Mes del valor (fecha base)' } = {}) {
  const get = (k) => ctx.kit.get(`${path}.${k}`);
  return formGrid(
    currency ? 4 : 3,
    periodField({ label: periodLabel, value: get('period'), name: `${path}.period`, hint: 'Vacío = "Base no definida".', disabled: ctx.readOnly, onChange: (v) => ctx.update(`${path}.period`, v) }),
    currency
      ? selectField({ label: 'Moneda', name: `${path}.currency`, value: get('currency') || quoteCurrencyOf(ctx.quote), options: CURRENCIES.map((c) => ({ value: c.id, label: c.label })), disabled: ctx.readOnly, onChange: (v) => { ctx.update(`${path}.currency`, v); ctx.rerender(); } })
      : null,
    selectField({ label: 'Fuente', name: `${path}.source`, value: get('source') || '', options: BASE_SOURCES.map((s) => ({ value: s.id, label: s.label })), includeEmpty: true, emptyLabel: 'Sin indicar', disabled: ctx.readOnly, onChange: (v) => ctx.update(`${path}.source`, v || null) }),
    textField({ label: 'Referencia (opcional)', name: `${path}.note`, value: get('note') || '', maxLength: 160, disabled: ctx.readOnly, onChange: (v) => ctx.update(`${path}.note`, String(v || '').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 160)) }),
  );
}

/** Monedas distintas de la de la cotización que usan sus líneas (en orden). */
export function foreignCurrenciesOf(quote) {
  const own = quoteCurrencyOf(quote);
  const out = [];
  const add = (base) => {
    const c = base && typeof base.currency === 'string' ? base.currency : null;
    if (c && c !== own && CURRENCIES.some((x) => x.id === c) && !out.includes(c)) out.push(c);
  };
  (Array.isArray(quote.equipment) ? quote.equipment : []).forEach((e) => e && add(e.base));
  (Array.isArray(quote.materials) ? quote.materials : []).forEach((m) => m && add(m.base));
  (Array.isArray(quote.exchangeRates) ? quote.exchangeRates : []).forEach((r) => r && r.currency && r.currency !== own && !out.includes(r.currency) && out.push(r.currency));
  return out;
}

/**
 * Tipos de cambio PROPIOS de la cotización (uno por moneda usada). Los carga
 * la empresa: RATEOS no consulta cotizaciones de moneda. Cambiarlos acá no
 * toca Configuración ni otras cotizaciones.
 */
export function exchangeRatesEditor(ctx) {
  const quote = ctx.quote;
  const own = quoteCurrencyOf(quote);
  const currencies = foreignCurrenciesOf(quote);
  if (currencies.length === 0) {
    return h('p', { class: 'small' }, `Todo se cotiza en ${own}. Si un equipo, tarifa o material está en otra moneda, acá vas a cargar su tipo de cambio.`);
  }
  const indexOf = (currency) => (Array.isArray(quote.exchangeRates) ? quote.exchangeRates.findIndex((r) => r && r.currency === currency) : -1);
  const ensure = (currency) => {
    let i = indexOf(currency);
    if (i < 0) {
      ctx.mutate((q) => {
        if (!Array.isArray(q.exchangeRates)) q.exchangeRates = [];
        q.exchangeRates.push({ currency, rate: null, base: { period: null, currency: own, source: null, note: '' } });
      });
      i = indexOf(currency);
    }
    return i;
  };
  return h(
    'div',
    { class: 'stack' },
    ...currencies.map((currency) => {
      const i = indexOf(currency);
      if (i < 0) {
        return h(
          'div',
          { class: 'exchange-row' },
          h('p', { class: 'small' }, `Hay valores en ${currency} y esta cotización no tiene su tipo de cambio: no se suman al costo hasta cargarlo.`),
          ctx.kit.action(`Cargar tipo de cambio ${currency}`, () => ensure(currency), { variant: 'primary', icon: 'plus' }),
        );
      }
      return formGrid(
        2,
        ctx.kit.num(`exchangeRates.${i}.rate`, { label: `Tipo de cambio: ${own} por 1 ${currency}`, rule: 'money', unit: own, hint: 'Lo cargás vos (RATEOS no consulta cotizaciones). Sólo para esta cotización.' }),
        periodField({ label: 'Mes del tipo de cambio', name: `exchangeRates.${i}.base.period`, value: ctx.kit.get(`exchangeRates.${i}.base.period`), disabled: ctx.readOnly, onChange: (v) => ctx.update(`exchangeRates.${i}.base.period`, v) }),
      );
    }),
  );
}
