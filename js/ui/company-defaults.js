/**
 * Datos de la empresa una sola vez (0.24.0, PLAN-2026-028, PR 3: W-10, P-11, P-19).
 *
 * - COMPANY_LABELS: el mismo rótulo en Configuración y en la cotización (P-19).
 * - companySetupCard: tarjeta "Datos de tu empresa" mientras la Configuración sea de ejemplo
 *   (settings.illustrative === true). Los valores de ejemplo van como texto de muestra, no
 *   cargados; "Guardar" los guarda como valores de la empresa (illustrative: false).
 * - saveAsCompanyAction: "Guardar como valor de mi empresa" desde una cotización.
 *
 * Nada de esto cambia un número de una cotización guardada: sólo las cotizaciones NUEVAS
 * arrancan con los valores de la empresa (createEmptyQuote).
 */

import { h } from './dom.js';
import { button, card, confirmDialog, formGrid, numberField, selectField } from './components.js';
import { formatNumber } from '../core/format.js';
import { isFiniteNumber } from '../core/money.js';
import { VAT_CONDITIONS } from '../domain/catalogs.js';
import { defaultSettings } from '../domain/quote-factory.js';
import { userErrorMessage } from './layout.js';

/** Rótulos iguales en los dos lados (P-19). */
export const COMPANY_LABELS = Object.freeze({
  fuelPricePerLiter: 'Precio del combustible (sin IVA)',
  paymentTermDays: 'Plazo de cobro',
  monthlyRatePct: 'Tasa de financiamiento mensual',
  contingencyPct: 'Imprevistos (contingencia)',
  targetMarginPct: 'Margen objetivo',
  roundingStep: 'Redondeo',
  vatCondition: 'Tu condición frente al IVA',
});

/** ¿La Configuración todavía es la de ejemplo? */
export function companyIsExample(settings) {
  return !settings || settings.illustrative === true;
}

/** Campos de la tarjeta, con su regla y el valor de ejemplo (sólo como texto de muestra). */
export const COMPANY_SETUP_FIELDS = Object.freeze([
  { key: 'fuelPricePerLiter', label: COMPANY_LABELS.fuelPricePerLiter, rule: 'money', unit: '$/L', hint: 'Se usa en equipos, vehículos y viajes. En cada cotización se cambia en "Movilización y viajes".' },
  { key: 'defaultPaymentTermDays', label: COMPANY_LABELS.paymentTermDays, rule: 'paymentDays', unit: 'días', hint: '¿A cuántos días te paga el cliente?' },
  { key: 'financeMonthlyRatePct', label: COMPANY_LABELS.monthlyRatePct, rule: 'percent', unit: '%', hint: 'Lo que te cuesta la plata que adelantás hasta cobrar.' },
  { key: 'defaultContingencyPct', label: COMPANY_LABELS.contingencyPct, rule: 'percent', unit: '%', hint: 'Colchón sobre el costo para lo que no se puede prever.' },
  { key: 'defaultTargetMarginPct', label: COMPANY_LABELS.targetMarginPct, rule: 'margin', unit: '%', hint: 'Sobre el precio de venta (no es markup).' },
]);

/**
 * Lo que guarda "Guardar" de la tarjeta (función pura): los cinco números y la condición frente
 * al IVA, con illustrative: false. Null si falta o no vale un número.
 */
export function companySetupPatch(values = {}) {
  const patch = {};
  for (const f of COMPANY_SETUP_FIELDS) {
    const v = values[f.key];
    // El campo sólo entrega números que pasan su regla (numberField).
    if (!isFiniteNumber(v) || v < 0) return null;
    patch[f.key] = v;
  }
  const condition = VAT_CONDITIONS.some((c) => c.id === values.vatCondition) ? values.vatCondition : null;
  return { ...patch, vatCondition: condition, illustrative: false };
}

/**
 * Tarjeta "Datos de tu empresa" (W-10). Null si la Configuración ya es propia o si no se puede
 * guardar. onSaved(settings) después de guardar; "Ahora no" la oculta y deja todo como está.
 */
export function companySetupCard({ app, settings, readOnly = false, onSaved = null, level = 2 } = {}) {
  if (!companyIsExample(settings) || readOnly || !app || !app.ctx || !app.ctx.settings) return null;
  const example = defaultSettings();
  const values = { vatCondition: null };
  const error = h('p', { class: 'field-error company-setup-error', role: 'alert', hidden: true });
  const fields = COMPANY_SETUP_FIELDS.map((f) => numberField({
    label: f.label,
    name: `company.${f.key}`,
    value: null,
    rule: f.rule,
    unit: f.unit,
    hint: f.hint,
    required: true,
    placeholder: isFiniteNumber(example[f.key]) ? `Ej.: ${formatNumber(example[f.key])}` : '',
    onChange: (v) => { values[f.key] = v; error.hidden = true; },
  }));
  const vatField = selectField({
    label: COMPANY_LABELS.vatCondition,
    name: 'company.vatCondition',
    value: '',
    includeEmpty: true,
    emptyLabel: 'Sin definir',
    options: VAT_CONDITIONS.map((c) => ({ value: c.id, label: c.label })),
    hint: 'Si sos responsable inscripto, los externos nuevos nacen con "Sí, lo recupero".',
    onChange: (v) => { values.vatCondition = v; },
  });
  let el = null;
  const save = button('Guardar', {
    variant: 'primary',
    icon: 'check',
    onClick: async () => {
      const patch = companySetupPatch(values);
      if (!patch) {
        error.textContent = 'Completá los cinco números para guardar (o tocá "Ahora no").';
        error.hidden = false;
        return;
      }
      save.disabled = true;
      try {
        await app.ctx.settings.save(patch);
        Object.assign(settings, patch);
        if (typeof app.toast === 'function') app.toast('Listo: las cotizaciones nuevas arrancan con los datos de tu empresa.', 'success');
        if (el) el.hidden = true;
        if (typeof onSaved === 'function') onSaved(settings);
      } catch (err) {
        save.disabled = false;
        if (typeof app.toast === 'function') app.toast(userErrorMessage(err, 'No se pudieron guardar los datos de tu empresa.'), 'danger');
      }
    },
  });
  const later = button('Ahora no', { variant: 'secondary', onClick: () => { if (el) el.hidden = true; } });
  el = card(
    {
      title: 'Datos de tu empresa',
      subtitle: 'Cargalos una vez y cada cotización nueva arranca con ellos. Hoy RATEOS usa valores de ejemplo.',
      className: 'company-setup',
      level,
    },
    formGrid(2, ...fields, vatField),
    error,
    h('div', { class: 'company-setup-actions' }, save, later),
    h('p', { class: 'small muted' }, 'Las cotizaciones que ya tenés no cambian. El resto de los valores está en ', h('a', { href: '#/configuracion/parametros' }, 'Configuración → Parámetros económicos'), '.'),
  );
  return el;
}

/**
 * "Guardar como valor de mi empresa" (W-10) para un número de la cotización (combustible, tasa).
 * Null si la Configuración es de ejemplo o la cotización es de sólo lectura; si no, una barra que
 * se ve sólo cuando el valor de la cotización es válido y distinto del de la empresa.
 * El patrón de los impuestos sobre la facturación (margin.js): confirma y guarda en Configuración.
 */
export function saveAsCompanyAction(ctx, { settingsKey, getValue, describe, focus = null }) {
  const settings = ctx && ctx.settings;
  if (!settings || companyIsExample(settings) || ctx.readOnly || !ctx.kit) return null;
  const read = () => {
    const v = getValue();
    return isFiniteNumber(v) && v >= 0 ? v : null;
  };
  const differs = () => {
    const v = read();
    const current = ctx.settings[settingsKey];
    return v !== null && !(isFiniteNumber(current) && Math.abs(current - v) < 1e-9);
  };
  const holder = h('div', { class: 'qe-toolbar qe-company-save' }, button('Guardar como valor de mi empresa', {
    size: 'sm',
    variant: 'secondary',
    attrs: { 'data-company-save': settingsKey },
    onClick: async () => {
      const value = read();
      if (value === null) return;
      const current = ctx.settings[settingsKey];
      const ok = await confirmDialog({
        title: 'Guardar como valor de tu empresa',
        message: `Las cotizaciones nuevas van a arrancar con ${describe(value)}${isFiniteNumber(current) ? ` (hoy: ${describe(current)})` : ''}. Las cotizaciones que ya tenés no cambian.`,
        confirmLabel: 'Guardar',
      });
      if (!ok) return;
      try {
        await ctx.app.ctx.settings.save({ [settingsKey]: value });
        ctx.settings[settingsKey] = value;
        ctx.toast('Guardado: las cotizaciones nuevas van a arrancar con este valor.', 'success');
        ctx.rerender();
        if (focus) ctx.focusField(focus);
      } catch (error) {
        ctx.toast(userErrorMessage(error, 'No se pudo guardar el valor de tu empresa.'), 'danger');
      }
    },
  }));
  return ctx.kit.toggle(holder, () => differs());
}
