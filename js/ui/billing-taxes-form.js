/**
 * Formulario de impuestos sobre lo que se factura (PLAN-2026-002).
 *
 * Lo usan el editor de cotizaciones (etapa "El precio") y Configuración →
 * Parámetros económicos (valor de la empresa). Sólo edita la configuración:
 * el cálculo (gross-up) lo hace el motor (js/engines/billing-taxes-engine.js).
 *
 * Modos EXCLUYENTES: "Un % total" o "Detalle por impuesto" (nunca se suman;
 * lo del otro modo queda guardado si el usuario vuelve). RATEOS no trae
 * alícuotas: los campos arrancan vacíos (AGENTS.md §7).
 */

import { h } from './dom.js';
import { button, checkboxField, choiceGroup, formGrid, icon, numberField, textField } from './components.js';
import { BILLING_TAX_KINDS, BILLING_TAX_MODES, labelOf } from '../domain/catalogs.js';
import { normalizeBillingTaxes, billingTaxesDecided } from '../domain/billing-taxes.js';
import { billingTaxConfigInfo } from '../engines/billing-taxes-engine.js';
import { formatPercent } from '../core/format.js';
import { isFiniteNumber } from '../core/money.js';
import { sanitizeText } from '../core/validation.js';
import { createId } from '../core/ids.js';

const MODE_HINTS = Object.freeze({
  combined: 'Lo más simple: la suma que te pasa tu contador.',
  detailed: 'Ingresos Brutos, impuesto al cheque, sellos y otros cargos, uno por uno.',
});

/** Tipos que se ofrecen como renglón propio (el resto, "Otro cargo"). */
const STANDARD_KINDS = Object.freeze(['gross_income', 'debits_credits', 'stamp']);

/** "4,5 %" sin que el número y el % queden en líneas distintas. */
const pctText = (value) => formatPercent(value).replace(' %', ' %');

function newItem(kind, label = null) {
  return { id: `tax-${createId().slice(0, 8)}`, kind, label: label || labelOf(BILLING_TAX_KINDS, kind, 'Impuesto'), pct: null };
}

/** Renglones con los que arranca el detalle (sin %: los carga cada empresa). */
export function defaultTaxItems() {
  return STANDARD_KINDS.map((kind) => newItem(kind));
}

/**
 * Descripción de una configuración, para resúmenes y confirmaciones:
 * "4,5 % en total", "Ingresos Brutos 3 % + Sellos 1 % = 4 %", "sin impuestos…", "sin definir".
 */
export function describeBillingTaxes(config) {
  const info = billingTaxConfigInfo(config);
  if (info.notApplicable) return 'sin impuestos sobre la facturación';
  if (info.invalid) return invalidTaxesText(info);
  if (!info.defined) return 'sin definir';
  if (info.mode === 'detailed') {
    const parts = info.items.filter((it) => isFiniteNumber(it.pct)).map((it) => `${it.label} ${pctText(it.pct)}`);
    return parts.length > 1 ? `${parts.join(' + ')} = ${pctText(info.pct)}` : parts[0];
  }
  return `${pctText(info.pct)} en total`;
}

/** Versión corta para botones: "4,7 %" o "sin impuestos". */
export function shortBillingTaxes(config) {
  const info = billingTaxConfigInfo(config);
  if (info.notApplicable) return 'sin impuestos';
  if (info.invalid || !info.defined) return describeBillingTaxes(config);
  return pctText(info.pct);
}

/** Por qué una configuración es inválida, en palabras del usuario. */
export function invalidTaxesText(info) {
  if (!info || !info.invalid) return '';
  if (info.invalidReason === 'total') return `los impuestos suman ${pctText(info.rawTotal)}: tienen que sumar menos de 100 %`;
  if (info.invalidReason === 'negative') return 'hay un porcentaje negativo';
  return 'hay un porcentaje que no es un número';
}

/** ¿Dos configuraciones dicen lo mismo? (para no ofrecer "usar los de mi empresa" si ya son esos). */
export function sameBillingTaxes(a, b) {
  const strip = (cfg) => {
    const n = normalizeBillingTaxes(cfg);
    return JSON.stringify({ ...n, items: n.items.map(({ id, ...rest }) => rest) });
  };
  return strip(a) === strip(b);
}

/** Ayuda: qué incluir (visible) y qué no (desplegable, para no recargar). */
export function billingTaxesHelp() {
  return h(
    'div',
    { class: 'qe-tip bt-help' },
    icon('info'),
    h(
      'div',
      {},
      h('p', {}, 'Incluí Ingresos Brutos, el impuesto al cheque (débitos y créditos) y sellos, si el contrato los paga. El % te lo pasa tu contador.'),
      h(
        'details',
        { class: 'bt-help-more' },
        h('summary', {}, '¿Qué no tengo que incluir?'),
        h('p', {}, 'IVA, impuesto a las Ganancias, retenciones o percepciones (son pagos a cuenta) ni el costo financiero (RATEOS ya lo calcula con los plazos de cobro). Si ya los cargaste como otro costo o en imprevistos, sacalos de ahí para no contarlos dos veces.'),
      ),
    ),
  );
}

/**
 * Campos de la configuración.
 * @param {{
 *   get: () => object,                          configuración actual (forma de js/domain/billing-taxes.js)
 *   update: (relPath: string, value: any) => void,  cambio de un valor (sin redibujar)
 *   mutate: (fn: (cfg: object) => void, opts?: { focus?: string }) => void,  cambio estructural (redibuja)
 *   readOnly?: boolean,
 *   namePrefix?: string,                        prefijo de los name (rutas de validateQuote)
 * }} options
 */
export function billingTaxesFields({ get, update, mutate, readOnly = false, namePrefix = 'billingTaxes', scope = 'quote' }) {
  const cfg = get() || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const na = cfg.notApplicable === true;
  const mode = BILLING_TAX_MODES.some((m) => m.id === cfg.mode) ? cfg.mode : 'combined';
  const name = (rel) => `${namePrefix}.${rel}`;

  const notApplicable = checkboxField({
    // Elección de cálculo, no una afirmación fiscal sobre la empresa.
    label: scope === 'company' ? 'No incluir impuestos sobre la facturación en las cotizaciones nuevas' : 'No incluir impuestos sobre la facturación en esta cotización',
    name: name('notApplicable'),
    checked: na,
    disabled: readOnly,
    hint: na
      ? `Los porcentajes no se usan: ${scope === 'company' ? 'las cotizaciones nuevas se calculan' : 'la tarifa se calcula'} sin estos impuestos.`
      : 'Elegilo sólo si estos impuestos no corresponden. Ante la duda, consultalo con tu contador.',
    // El foco vuelve a la misma casilla después de redibujar.
    onChange: (checked) => mutate((c) => { c.notApplicable = Boolean(checked); }, { focus: name('notApplicable') }),
  });
  if (na) return h('div', { class: 'bt-fields stack' }, notApplicable);

  const modeChoice = choiceGroup({
    label: '¿Cómo los querés cargar?',
    name: name('mode'),
    value: mode,
    disabled: readOnly,
    options: BILLING_TAX_MODES.map((m) => ({ value: m.id, label: m.label, hint: MODE_HINTS[m.id] })),
    // Con teclado (flechas) el foco queda en la opción elegida.
    onChange: (value) => mutate((c) => {
      c.mode = value;
      if (value === 'detailed' && (!Array.isArray(c.items) || c.items.length === 0)) c.items = defaultTaxItems();
    }, { focus: name('mode') }),
  });

  let body;
  if (mode === 'combined') {
    const otherInfo = billingTaxConfigInfo({ ...cfg, mode: 'detailed' });
    body = h(
      'div',
      { class: 'stack' },
      formGrid(
        2,
        numberField({
          label: 'Impuestos sobre lo que facturás (total)',
          name: name('combinedPct'),
          rule: 'billingTax',
          unit: '%',
          value: cfg.combinedPct === undefined ? null : cfg.combinedPct,
          disabled: readOnly,
          hint: 'Suma de los porcentajes sobre tu facturación sin IVA.',
          onChange: (value) => update('combinedPct', value),
        }),
      ),
      otherInfo.defined
        ? h('p', { class: 'footnote' }, `El detalle que cargaste (${describeBillingTaxes({ ...cfg, mode: 'detailed' })}) no se suma mientras uses un % total; queda guardado si volvés al detalle.`)
        : null,
    );
  } else {
    const rows = items.map((it, i) => {
      const kind = BILLING_TAX_KINDS.find((k) => k.id === it.kind) || BILLING_TAX_KINDS[BILLING_TAX_KINDS.length - 1];
      const isOther = it.kind === 'other' || !BILLING_TAX_KINDS.some((k) => k.id === it.kind);
      const rowLabel = typeof it.label === 'string' && it.label ? it.label : 'este renglón';
      const title = `Quitar ${rowLabel}`;
      return h(
        'div',
        { class: ['bt-row', isOther ? 'bt-row-other' : null] },
        isOther
          ? textField({
            label: 'Nombre del cargo',
            name: name(`items.${i}.label`),
            value: typeof it.label === 'string' ? it.label : '',
            maxLength: 80,
            disabled: readOnly,
            onChange: (value) => update(`items.${i}.label`, sanitizeText(value, 80)),
          })
          : null,
        numberField({
          label: isOther ? 'Porcentaje' : kind.label,
          name: name(`items.${i}.pct`),
          rule: 'billingTax',
          unit: '%',
          value: it.pct === undefined ? null : it.pct,
          disabled: readOnly,
          hint: kind.hint,
          onChange: (value) => update(`items.${i}.pct`, value),
        }),
        readOnly
          ? null
          : button('', {
            variant: 'ghost',
            size: 'sm',
            icon: 'trash',
            title,
            attrs: { 'aria-label': title, 'data-edit': 'true' },
            // Después de quitar, el foco va al % de al lado (o a la elección del modo).
            onClick: () => mutate((c) => { c.items.splice(i, 1); }, {
              focus: items.length > 1 ? name(`items.${Math.min(i, items.length - 2)}.pct`) : name('mode'),
            }),
          }),
      );
    });
    const missing = STANDARD_KINDS.filter((kind) => !items.some((it) => it.kind === kind));
    const add = (kind, label = null) => mutate((c) => {
      if (!Array.isArray(c.items)) c.items = [];
      c.items.push(newItem(kind, label));
    }, { focus: name(`items.${items.length}.pct`) });
    body = h(
      'div',
      { class: 'bt-detail stack' },
      h('div', { class: 'bt-rows' }, ...rows),
      h('p', { class: 'footnote' }, 'Un renglón vacío no se cuenta. Se suman sólo los porcentajes cargados.'),
      isFiniteNumber(normalizeBillingTaxes(cfg).combinedPct)
        ? h('p', { class: 'footnote' }, `El % total que cargaste (${pctText(normalizeBillingTaxes(cfg).combinedPct)}) no se suma mientras uses el detalle; queda guardado si volvés a "Un % total".`)
        : null,
      readOnly
        ? null
        : h(
          'div',
          { class: 'qe-toolbar bt-add' },
          ...missing.map((kind) => button(`Agregar ${labelOf(BILLING_TAX_KINDS, kind, 'impuesto')}`, { size: 'sm', icon: 'plus', onClick: () => add(kind) })),
          button('Agregar otro cargo', { size: 'sm', icon: 'plus', onClick: () => add('other', 'Otro cargo') }),
        ),
    );
  }
  return h('div', { class: 'bt-fields stack' }, modeChoice, body, notApplicable);
}

export { billingTaxesDecided };
