/**
 * Formulario de impuestos sobre lo que se factura (PLAN-2026-002).
 *
 * Lo usan el editor de cotizaciones (etapa "El precio") y Configuración →
 * Parámetros económicos (valor de la empresa). Sólo edita la configuración:
 * el cálculo (gross-up) lo hace el motor (js/engines/billing-taxes-engine.js).
 *
 * Modos EXCLUYENTES: "Un % total" o "Detalle por impuesto" (nunca se suman).
 * RATEOS no trae alícuotas: los campos arrancan vacíos (AGENTS.md §7).
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
  detailed: 'Ingresos Brutos, débitos y créditos, sellos y otros cargos, uno por uno.',
});

/** Renglones con los que arranca el detalle (sin %: los carga cada empresa). */
export function defaultTaxItems() {
  return ['gross_income', 'debits_credits', 'stamp'].map((kind) => ({
    id: `tax-${createId().slice(0, 8)}`,
    kind,
    label: labelOf(BILLING_TAX_KINDS, kind, 'Impuesto'),
    pct: null,
  }));
}

/**
 * Descripción corta de una configuración, para botones y resúmenes:
 * "4,5 % en total", "Ingresos Brutos 3 % + Sellos 1 % = 4 %", "no pagás…", "sin definir".
 */
export function describeBillingTaxes(config) {
  const info = billingTaxConfigInfo(config);
  if (info.notApplicable) return 'no pagás impuestos sobre lo que facturás';
  if (info.invalid) return 'hay un porcentaje inválido';
  if (!info.defined) return 'sin definir';
  if (info.mode === 'detailed') {
    const parts = info.items.filter((it) => isFiniteNumber(it.pct)).map((it) => `${it.label} ${formatPercent(it.pct)}`);
    return parts.length > 1 ? `${parts.join(' + ')} = ${formatPercent(info.pct)}` : parts[0];
  }
  return `${formatPercent(info.pct)} en total`;
}

/** ¿Dos configuraciones dicen lo mismo? (para no ofrecer "usar los de mi empresa" si ya son esos). */
export function sameBillingTaxes(a, b) {
  const strip = (cfg) => {
    const n = normalizeBillingTaxes(cfg);
    return JSON.stringify({ ...n, items: n.items.map(({ id, ...rest }) => rest) });
  };
  return strip(a) === strip(b);
}

/** Ayuda: qué incluir y qué no (doble conteo e IVA). */
export function billingTaxesHelp() {
  return h(
    'div',
    { class: 'qe-tip bt-help' },
    icon('info'),
    h(
      'div',
      {},
      h('p', {}, 'Ingresos Brutos, el impuesto a los débitos y créditos (como % equivalente sobre tu facturación sin IVA) y sellos, si el contrato los paga. Te los pasa tu contador.'),
      h('p', {}, h('strong', {}, 'No incluyas '), 'IVA, Ganancias, retenciones ni percepciones (son pagos a cuenta) ni costo financiero (RATEOS lo calcula por plazos). ', h('strong', {}, 'Si ya los cargaste como otro costo o en imprevistos, sacalos de ahí: '), 'si no, los contás dos veces.'),
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
export function billingTaxesFields({ get, update, mutate, readOnly = false, namePrefix = 'billingTaxes' }) {
  const cfg = get() || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  const na = cfg.notApplicable === true;
  const mode = BILLING_TAX_MODES.some((m) => m.id === cfg.mode) ? cfg.mode : 'combined';
  const name = (rel) => `${namePrefix}.${rel}`;

  const notApplicable = checkboxField({
    label: 'No pago impuestos sobre lo que facturo',
    name: name('notApplicable'),
    checked: na,
    disabled: readOnly,
    hint: na ? 'Los porcentajes no se usan: la tarifa se calcula sin estos impuestos.' : 'Marcalo sólo si de verdad no pagás Ingresos Brutos ni otros impuestos sobre lo que facturás.',
    onChange: (checked) => mutate((c) => { c.notApplicable = Boolean(checked); }),
  });
  if (na) return h('div', { class: 'bt-fields stack' }, notApplicable);

  const modeChoice = choiceGroup({
    label: '¿Cómo los querés cargar?',
    name: name('mode'),
    value: mode,
    disabled: readOnly,
    options: BILLING_TAX_MODES.map((m) => ({ value: m.id, label: m.label, hint: MODE_HINTS[m.id] })),
    onChange: (value) => mutate((c) => {
      c.mode = value;
      if (value === 'detailed' && (!Array.isArray(c.items) || c.items.length === 0)) c.items = defaultTaxItems();
    }, { focus: value === 'detailed' ? name('items.0.pct') : name('combinedPct') }),
  });

  let body;
  if (mode === 'combined') {
    body = formGrid(
      2,
      numberField({
        label: 'Impuestos sobre lo que facturás (total)',
        name: name('combinedPct'),
        rule: 'billingTax',
        unit: '%',
        value: isFiniteNumber(cfg.combinedPct) ? cfg.combinedPct : null,
        disabled: readOnly,
        hint: 'Suma de los porcentajes sobre tu facturación sin IVA.',
        onChange: (value) => update('combinedPct', value),
      }),
    );
  } else {
    const rows = items.map((it, i) => {
      const kind = BILLING_TAX_KINDS.find((k) => k.id === it.kind) || BILLING_TAX_KINDS[BILLING_TAX_KINDS.length - 1];
      const isOther = it.kind === 'other' || !BILLING_TAX_KINDS.some((k) => k.id === it.kind);
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
          value: isFiniteNumber(it.pct) ? it.pct : null,
          disabled: readOnly,
          hint: kind.hint,
          onChange: (value) => update(`items.${i}.pct`, value),
        }),
        readOnly
          ? null
          : (() => {
            const title = `Quitar ${typeof it.label === 'string' && it.label ? it.label : 'este renglón'}`;
            return button('', {
              variant: 'ghost',
              size: 'sm',
              icon: 'trash',
              title,
              attrs: { 'aria-label': title, 'data-edit': 'true' },
              onClick: () => mutate((c) => { c.items.splice(i, 1); }),
            });
          })(),
      );
    });
    body = h(
      'div',
      { class: 'bt-detail stack' },
      h('div', { class: 'bt-rows' }, ...rows),
      h('p', { class: 'footnote' }, 'Un renglón vacío no se cuenta. Se suman sólo los porcentajes cargados.'),
      readOnly
        ? null
        : h('div', { class: 'qe-toolbar' }, button('Agregar otro cargo', {
          size: 'sm',
          icon: 'plus',
          onClick: () => mutate((c) => {
            if (!Array.isArray(c.items)) c.items = [];
            c.items.push({ id: `tax-${createId().slice(0, 8)}`, kind: 'other', label: 'Otro cargo', pct: null });
          }, { focus: name(`items.${items.length}.pct`) }),
        })),
    );
  }
  return h('div', { class: 'bt-fields stack' }, modeChoice, body, notApplicable);
}

export { billingTaxesDecided };
