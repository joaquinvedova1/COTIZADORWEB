/**
 * Etapa 4 · El precio — Margen, impuestos sobre lo que facturás y reglas
 * comerciales.
 * Básico: margen objetivo (sobre el precio; el markup equivalente va en el (i)
 * del campo), impuestos sobre lo que facturás (un % total o detalle; RATEOS no
 * trae alícuotas) y UNA cifra de precio: la tarifa sugerida (el precio objetivo
 * sin redondear queda en su "Ver cálculo") con el margen esperado. Debajo del
 * margen, UN campo de precio a mano (0.24.0, P-12): "¿Ya tenés un precio?".
 * Opcional: "Más detalle" (margen personalizado, descuento, redondeo y el
 * ejemplo margen vs markup), "Opciones comerciales" (reglas comerciales y,
 * salvo en precio cerrado, descuentos por cantidad de días) y "Cargado antes"
 * (hora fuera de horario, guardia y adicionales de cotizaciones anteriores).
 *
 * MARGEN (sobre precio) y MARKUP (sobre costo) NO son sinónimos:
 *   costo 100, margen 10 % → precio 111,11 · costo 100, markup 10 % → precio 110
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, emptyState, table, badge, icon, button, confirmDialog, infoTip } from '../../components.js';
import { fieldHref } from '../../field-links.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { copyBillingTaxes, billingTaxesDecided, emptyBillingTaxes } from '../../../domain/billing-taxes.js';
import { billingTaxConfigInfo } from '../../../engines/billing-taxes-engine.js';
import { priceFromMargin, priceFromMarkup, traceMarginVsMarkup } from '../../../engines/pricing-engine.js';
import { tierLabel } from '../../../engines/commercial-rules-engine.js';
import { formatMoney, formatPercent, formatNumber, formatValue, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { createId } from '../../../core/ids.js';
import { isPlainObject } from '../../../core/object.js';
import { perUnitCeil, perUnitMoney, netRateHint, confirmRemove, hasNumber, stepName, plural, minimumGuaranteeFields, guaranteeLoaded } from './shared.js';
import { minActivityNotice, suggestedRateTrace, suggestedRateName, isClosedPrice, deductedPct, marginLimitText, shownMarginPct } from '../../result-text.js';
import { billingTaxesFields, billingTaxesHelp, describeBillingTaxes, shortBillingTaxes, sameBillingTaxes, invalidTaxesText } from '../../billing-taxes-form.js';
import { userErrorMessage } from '../../layout.js';
import { activationTerms, activationFieldLabels } from '../../../domain/activation-terms.js';
import { contractOf } from '../../../domain/contract.js';
import { normalizePriceAdjustment, priceAdjustmentApplies } from '../../../domain/price-adjustment.js';
import { render as renderCharge } from './modality.js';
import { COMPANY_LABELS } from '../../company-defaults.js';

const DISCOUNT_STATUS = Object.freeze({
  green: ['Mantiene el margen', 'green'],
  orange: ['Bajo el margen objetivo', 'orange'],
  red: ['Pierde plata', 'red'],
  unknown: ['Sin tarifa', 'gray'],
  no_target: ['Cubre costos (sin objetivo)', 'gray'],
});

/**
 * Tramos de descuento con el MISMO criterio que el Resultado (rulesBadge):
 * sólo cuentan los tramos que dan un descuento (> 0 %). Un tramo sin
 * descuento que pierde plata no es culpa del descuento: es la actividad
 * mínima (pocos días para cubrir los costos fijos), y se avisa aparte.
 */
export function tierFindings(result) {
  const rows = Array.isArray(result && result.discounts) ? result.discounts : [];
  const granted = rows.filter((d) => isFiniteNumber(d.discountPct) && d.discountPct > 0);
  const losingByActivity = rows.some((d) => !(isFiniteNumber(d.discountPct) && d.discountPct > 0) && d.status === 'red');
  return {
    granted,
    red: granted.filter((d) => d.status === 'red').length,
    orange: granted.filter((d) => d.status === 'orange').length,
    losingByActivity,
  };
}

/**
 * Aviso de actividad mínima: el MISMO texto y criterio que el Resultado
 * (js/ui/result-text.js). Sólo da un número de días si el break-even cae en
 * un tramo sin descuento (si no, ese número también depende del descuento).
 */
export function minimumActivityText(result) {
  return minActivityNotice(result);
}

/** Una regla comercial: título + explicación en una línea + campos + valor calculado. */
function ruleRow(title, explanation, fields, output = null) {
  return h(
    'div',
    { class: 'qe-rule' },
    h('div', { class: 'qe-rule-text' }, h('h4', { class: 'qe-rule-title' }, title), h('p', { class: 'qe-rule-explain' }, explanation), output ? h('div', { class: 'qe-rule-output' }, output) : null),
    h('div', { class: 'qe-rule-fields' }, ...fields),
  );
}

/**
 * "Usar los de mi empresa" / "Guardar como valor de mi empresa": el valor de la
 * empresa (Configuración → Parámetros económicos) es el punto de partida de
 * las cotizaciones nuevas. Reemplaza, nunca suma (modos excluyentes).
 */
function companyTaxesActions(ctx) {
  if (ctx.kit.readOnly) return null;
  const settings = ctx.settings || {};
  const company = settings.defaultBillingTaxes;
  const own = ctx.quote.billingTaxes;
  const companyDecided = billingTaxesDecided(company) && !billingTaxConfigInfo(company).invalid;
  const ownDecided = billingTaxesDecided(own);
  const ownValid = ownDecided && !billingTaxConfigInfo(own).invalid;
  const same = companyDecided && ownDecided && sameBillingTaxes(company, own);
  const actions = [];
  // Después de reemplazar o guardar, el foco va a la elección del modo (no se pierde).
  const focusPath = 'billingTaxes.mode';
  if (companyDecided && !same) {
    actions.push(button(`Usar los de mi empresa (${shortBillingTaxes(company)})`, {
      size: 'sm',
      onClick: async () => {
        if (ownDecided) {
          const ok = await confirmDialog({
            title: 'Usar los impuestos de tu empresa',
            message: `Se reemplazan los de esta cotización (${describeBillingTaxes(own)}) por los de tu empresa (${describeBillingTaxes(company)}).`,
            confirmLabel: 'Reemplazar',
          });
          if (!ok) return;
        }
        ctx.mutate((q) => { q.billingTaxes = copyBillingTaxes(company); }, { focus: company.notApplicable === true ? 'billingTaxes.notApplicable' : focusPath });
        ctx.toast('Se cargaron los impuestos de tu empresa.', 'success');
      },
    }));
  }
  if (ownValid && !same) {
    actions.push(button('Guardar como valor de mi empresa', {
      size: 'sm',
      variant: 'secondary',
      onClick: async () => {
        const value = copyBillingTaxes(ctx.quote.billingTaxes);
        if (companyDecided) {
          const ok = await confirmDialog({
            title: 'Guardar como valor de tu empresa',
            message: `Las cotizaciones nuevas van a arrancar con ${describeBillingTaxes(value)} (hoy: ${describeBillingTaxes(company)}). Las cotizaciones que ya tenés no cambian.`,
            confirmLabel: 'Guardar',
          });
          if (!ok) return;
        }
        try {
          await ctx.app.ctx.settings.save({ defaultBillingTaxes: value });
          settings.defaultBillingTaxes = value;
          ctx.toast('Guardado: las cotizaciones nuevas van a arrancar con estos impuestos.', 'success');
          ctx.rerender();
          ctx.focusField(value.notApplicable === true ? 'billingTaxes.notApplicable' : focusPath);
        } catch (error) {
          ctx.toast(userErrorMessage(error, 'No se pudo guardar el valor de tu empresa.'), 'danger');
        }
      },
    }));
  }
  if (actions.length === 0) {
    return same ? h('p', { class: 'footnote' }, 'Son los impuestos de tu empresa (Configuración → Parámetros económicos).') : null;
  }
  return h(
    'div',
    { class: 'bt-company-wrap' },
    h('div', { class: 'qe-toolbar bt-company' }, ...actions),
    companyDecided && !same ? h('p', { class: 'footnote' }, `Tu empresa: ${describeBillingTaxes(company)}.`) : null,
  );
}

/**
 * Nota de la regla "Mínimo por llamado" (V-13). Con una unidad por cantidad dice qué factura
 * cada llamado y cuántos llamados son la cantidad del mes (antes: "suma unidades facturables",
 * que con el mínimo aplicado no es cierto: la cantidad del mes es la misma, repartida en menos llamados).
 */
export function minimumCallNote(r, T, unitInfo) {
  const rev = (r && r.estimate && r.estimate.revenue) || {};
  if (!rev.minimumCallApplied) return `Hoy no cambia la facturación (${T.each} ya supera el mínimo).`;
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  if (!unitInfo || unitInfo.kind !== 'quantity') {
    // Hora y día (revisión UX): "cada llamado factura 8 horas aunque se trabajen 6", sin jerga.
    const billed = rev.billableUnitsPerActivation;
    const worked = rev.unitsPerActivation;
    if (!unitInfo || !isFiniteNumber(billed) || !isFiniteNumber(worked)) return `Se está aplicando: cada ${T.one} factura el mínimo aunque se trabaje menos.`;
    const word = (v) => (Math.abs(v - 1) < 1e-9 ? unitInfo.singular : unitInfo.plural);
    return `Se está aplicando: cada ${T.one} factura ${n(billed)} ${word(billed)} aunque se ${Math.abs(worked - 1) < 1e-9 ? 'trabaje' : 'trabajen'} ${n(worked)}.`;
  }
  const acts = rev.activations;
  const quantity = r.activity ? r.activity.billableQuantityPerMonth : null;
  const head = `Se está aplicando: cada ${T.one} factura ${n(rev.billableUnitsPerActivation)} ${unitInfo.plural} aunque haga ${n(rev.unitsPerActivation)}.`;
  return isFiniteNumber(quantity) && isFiniteNumber(acts)
    ? `${head} Tus ${n(quantity)} ${unitInfo.plural} por mes son ${n(acts)} ${T.word(acts)}.`
    : head;
}

/** Aviso del equipo en espera con días cargados (V-29): esos días bajan la tarifa principal. */
export const STANDBY_DAYS_NOTE = 'Estos días se cuentan como ingreso seguro y bajan tu tarifa principal. Si la espera es eventual, dejá los días en 0 y cargá sólo la tarifa.';

/**
 * Línea de resultado de "Equipo en espera" (V-29).
 * @param {object} r resultado de computeQuote
 * @param {{ off?: boolean, days?: number }} [o] "No aplica" marcado y días en espera cargados
 */
export function standbyOutputText(r, { off = false, days = 0, note = true } = {}) {
  if (off) return 'No aplica equipo en espera: los días y la tarifa cargados no se usan. Ingreso y costo en espera: $ 0.';
  const base = `Ingreso por equipo en espera: ${formatMoney(r.estimate.revenue.components.standby)} · costo del personal en espera: ${formatMoney(r.model.standby.monthly)} por mes.`;
  return note && Number(days) > 0 ? `${base} ${STANDBY_DAYS_NOTE}` : base;
}

/**
 * "Equipo en espera" es un cobro aparte del precio único (regla de un ítem, 2026-11-18): sólo
 * se muestra en las cotizaciones que ya lo tenían cargado (días o tarifa), con "Quitar".
 * "No aplica" solo no cobra nada: no lo muestra (B5).
 */
export function showStandbyRule(quote = {}) {
  const rules = quote.rules || {};
  return Number(rules.standbyDaysPerMonth) > 0 || Number(rules.standbyRatePerDay) > 0;
}

/**
 * Cobros aparte del precio único cargados antes (regla de un ítem, 2026-11-18): fijo por estar de
 * guardia, plus por llamado, movilización, km adicional y equipo en espera. Las cotizaciones
 * nuevas no los ofrecen; las que ya los tenían los siguen mostrando (mismos números) con "Quitar".
 */
export function legacySeparateCharges(quote = {}) {
  const rules = (quote && quote.rules) || {};
  const pos = (k) => Number(rules[k]) > 0;
  return {
    guardFee: pos('availabilityFeeMonthly'),
    guardPlus: pos('calloutFeePerActivation'),
    mobilization: pos('mobilizationFeePerActivation'),
    extraKm: pos('extraKmRate') || pos('includedKmPerActivation'),
    standby: showStandbyRule(quote),
  };
}

export function render(container, ctx) {
  const { quote, kit } = ctx;
  const unitInfo = billingUnitOf(quote);
  // "$/día", "$/hora", "$/mes (abono)" como siempre; "$/m³", "$/viaje", "$/pozo"… (PLAN-2026-009).
  const unit = { label: unitInfo.legacy ? unitInfo.label : `$/${unitInfo.singular}` };
  const unitKind = unitInfo.kind;
  const dayTiers = unitKind === 'day' || unitKind === 'hour';
  const isModeB = quote.pricingMode !== 'known_rate';
  const standbyOff = Boolean(quote.rules && quote.rules.standbyNotApplicable);
  // Precio cerrado: se habla de "precio" y "del trabajo" (tanda novato).
  const closed = contractOf(quote).mode === 'closed';
  /** Un solo trabajo en el mes: las cifras del mes son las del trabajo. */
  const closedSingle = (r) => isClosedPrice(r) && isFiniteNumber(r.kpis.billableQuantity) && Math.abs(r.kpis.billableQuantity - 1) < 1e-9;
  const commercialLabel = (r) => {
    const src = r.kpis.commercialSource;
    // C5 (revisión de la 0.24.0): el precio a mano se llama igual en sus dos modos y en el Resultado.
    if (src === 'known_rate' || src === 'offered') return 'Tu precio (de lista)';
    return isClosedPrice(r) ? 'Precio forzado (de lista)' : 'Tarifa forzada (de lista)';
  };

  // ------------------------------------------------------------ margen
  // Margen vs markup se explica UNA vez, en el (i) del campo (COPY-8; tanda novato:
  // fuera de la vista principal). El ejemplo lado a lado queda en "Más detalle".
  const markupLine = (r) => {
    const k = r.kpis;
    const t = k.billingTaxPct > 0 ? k.billingTaxPct : 0;
    // Costo financiero del IVA (K-03): también es parte del recargo.
    const tv = k.vatFinancePct > 0 ? k.vatFinancePct : 0;
    // Markup (precio = costo × (1 + markup)) y ganancia sobre el costo: los calcula el motor.
    const mk = k.targetMarkupPct;
    if (k.targetMarginInvalid || !isFiniteNumber(mk)) return '';
    const what = tv > 0
      ? `${t > 0 ? `${formatPercent(t)} de impuestos sobre lo que facturás y ` : ''}${formatPercent(tv)} de costo financiero del IVA`
      : `${formatPercent(t)} de impuestos sobre lo que facturás`;
    const rest = tv > 0 ? (t > 0 ? 'impuestos y el costo financiero del IVA' : 'el costo financiero del IVA') : 'impuestos';
    return t + tv > 0
      ? `Con ${what}, ganar ${formatPercent(k.targetMarginPct)} sobre el precio es cobrar el costo + ${formatPercent(mk)} (markup: recargo sobre el costo); de eso, ${formatPercent(k.targetProfitOnCostPct)} del costo es tu ganancia y el resto, ${rest}. No son lo mismo: el ejemplo está en "Más detalle".`
      : `Un margen de ${formatPercent(k.targetMarginPct)} sobre el precio equivale a un markup (recargo sobre el costo) de ${formatPercent(mk)}: no son lo mismo. El ejemplo está en "Más detalle".`;
  };
  const marginCard = card(
    {},
    formGrid(
      2,
      kit.num('pricing.targetMarginPct', {
        label: COMPANY_LABELS.targetMarginPct,
        rule: 'margin',
        unit: '%',
        requiredMark: true,
        hint: h(
          'span',
          {},
          'Lo que querés que te quede de cada $ 100 facturados, después de pagar los costos y los impuestos sobre lo que facturás (antes del impuesto a las Ganancias). ',
          kit.out(markupLine, { allowEmpty: true }),
        ),
      }),
    ),
  );

  // ------------------------------------------- precio a mano (P-12, 0.24.0)
  // UN solo campo (PLAN-2026-028): escribe en `pricing.knownRate` si la cotización es "Ya tengo la
  // tarifa" (known_rate) y en `pricing.offeredRateOverride` en las demás. Los dos dan los mismos
  // números con el mismo precio (INV-33 del Test Lab). La pantalla ya no ofrece elegir el modo.
  const priceField = isModeB ? 'pricing.offeredRateOverride' : 'pricing.knownRate';
  // Revisión de la 0.24.0 (C-1, C-2 de costos; C1 de UX): en "ya tengo la tarifa", vaciar el campo
  // hace lo mismo que "Borrar mi precio y usar el sugerido" (con la misma confirmación). Si faltan
  // los días (o la cantidad) del mes, la confirmación lo dice y después se va a ese campo.
  const knownBefore = Number(quote.pricing && quote.pricing.knownRate);
  const useSuggested = async ({ fromEmpty = false } = {}) => {
    const plan = useSuggestedPlan(ctx.quote || quote, { closed, known: fromEmpty ? knownBefore : undefined });
    const ok = await confirmDialog({
      title: closed ? 'Usar el precio sugerido' : 'Usar la tarifa sugerida',
      message: plan.message,
      confirmLabel: 'Usar el sugerido',
    });
    if (!ok) {
      // Vaciado y después "Cancelar": vuelve el precio que tenía.
      if (fromEmpty) ctx.mutate((q) => {
        if (!isPlainObject(q.pricing)) q.pricing = {};
        q.pricing.knownRate = Number.isFinite(knownBefore) ? knownBefore : 0;
      }, { focus: 'pricing.knownRate' });
      return;
    }
    ctx.mutate((q) => {
      if (!isPlainObject(q.pricing)) q.pricing = {};
      q.pricingMode = 'known_activity';
      q.pricing.knownRate = 0;
      // "Usar el sugerido" es eso: si había un precio a mano escondido de antes, también se va.
      q.pricing.offeredRateOverride = null;
    }, { focus: plan.missingPath ? null : 'pricing.offeredRateOverride' });
    if (plan.missingPath && typeof window !== 'undefined' && window.location) window.location.hash = fieldHref(quote.id, plan.missingPath);
  };
  const ownPriceCard = card(
    { className: 'qe-own-price' },
    formGrid(
      2,
      kit.num(priceField, {
        // Opcional en los dos modos: vacío = el precio sugerido (sin asterisco).
        label: '¿Ya tenés un precio? (opcional, sin IVA)',
        rule: 'money',
        unit: unit.label,
        placeholder: isModeB ? 'Usar el sugerido' : 'Escribí tu precio',
        blankZero: !isModeB,
        hint: isModeB
          ? `Vacío = RATEOS te sugiere el precio con tu margen. De lista (${unit.label}), antes de descuentos.`
          : `Es tu precio (de lista, ${unit.label}, antes de descuentos): RATEOS calcula cuánto ganás con él. Si lo borrás, usa el que sugiere con tu margen.`,
        onValue: isModeB ? null : (value) => {
          if (!(Number(value) > 0)) useSuggested({ fromEmpty: true });
        },
      }),
    ),
    !isModeB && !kit.readOnly
      ? h('div', { class: 'qe-toolbar' }, kit.action('Borrar mi precio y usar el sugerido', () => useSuggested(), { variant: 'secondary' }))
      : null,
  );

  // ------------------------------------ impuestos sobre lo que facturás
  const taxesCard = card(
    { title: '¿Qué parte de lo que facturás se va en impuestos?', level: 3, className: 'qe-taxes' },
    billingTaxesHelp(),
    billingTaxesFields({
      get: () => quote.billingTaxes,
      update: (rel, value) => ctx.update(`billingTaxes.${rel}`, value),
      mutate: (fn, options) => ctx.mutate((q) => {
        if (!isPlainObject(q.billingTaxes)) q.billingTaxes = emptyBillingTaxes();
        if (!Array.isArray(q.billingTaxes.items)) q.billingTaxes.items = [];
        fn(q.billingTaxes);
      }, options),
      readOnly: kit.readOnly,
      namePrefix: 'billingTaxes',
    }),
    // Se reevalúa en cada recálculo: aparece apenas la cotización tiene impuestos decididos.
    kit.out(() => companyTaxesActions(ctx), { tag: 'div', allowEmpty: true, className: 'bt-company-holder' }),
    kit.toggle(
      h('div', { class: 'qe-tip qe-tip-warning', role: 'status' }, icon('alert'), h('p', {}, closed
        ? 'Sin definir: el precio mínimo y el sugerido NO incluyen estos impuestos. Si cobrás esos precios, los pagás de tu bolsillo. Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".'
        : 'Sin definir: la tarifa mínima y la sugerida NO incluyen estos impuestos. Si cobrás esas tarifas, los pagás de tu bolsillo. Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".')),
      (r) => !r.kpis.billingTaxesDefined && !r.kpis.billingTaxesInvalid,
    ),
    kit.toggle(
      h('div', { class: 'qe-tip qe-tip-danger', role: 'status' }, icon('alert'), kit.out((r) => `Revisá los impuestos: ${invalidTaxesText(r.billingTaxInfo)}. Mientras tanto no se aplican.`, { tag: 'p' })),
      (r) => r.kpis.billingTaxesInvalid,
    ),
    kit.toggle(
      h('div', { class: 'qe-tip qe-tip-danger', role: 'status' }, icon('alert'), kit.out((r) => `${marginLimitText(r.kpis, undefined, { capital: true, subject: 'el margen objetivo' })}: no hay un precio que deje ese margen.`, { tag: 'p' })),
      (r) => r.kpis.targetMarginInvalid && deductedPct(r.kpis) > 0,
    ),
    kit.stats(
      kit.stat('Impuestos sobre lo que facturás', (r) => (r.kpis.billingTaxesInvalid ? 'Revisar' : r.kpis.billingTaxesDefined ? formatPercent(r.kpis.billingTaxPct) : 'Sin definir'), {
        hint: (r) => {
          if (r.kpis.billingTaxesInvalid) return `${invalidTaxesText(r.billingTaxInfo).replace(/^./, (c) => c.toUpperCase())}.`;
          if (r.billingTaxInfo && r.billingTaxInfo.notApplicable) return 'Elegiste no incluir impuestos sobre la facturación en esta cotización.';
          if (r.kpis.billingTaxesDefined && !(r.kpis.billingTaxPct > 0)) return 'Cargaste 0 %: la tarifa no suma impuestos.';
          return 'Sobre la facturación sin IVA.';
        },
        tone: (r) => (r.kpis.billingTaxesInvalid ? 'red' : r.kpis.billingTaxesDefined ? null : 'orange'),
      }),
      kit.stat((r) => (closedSingle(r) ? 'Impuestos del trabajo' : 'Impuestos del mes'), (r) => (isFiniteNumber(r.kpis.commercialListRate) && r.kpis.billingTaxesDefined ? formatMoney(r.kpis.billingTaxes) : EMPTY), {
        hint: (r) => {
          if (!r.kpis.billingTaxesDefined) return 'Cargá el % para verlos.';
          if (!isFiniteNumber(r.kpis.commercialListRate)) return 'Sin tarifa.';
          const names = isClosedPrice(r)
            ? { known_rate: 'tu precio', offered: 'el precio ofrecido', override: 'el precio forzado', suggested: 'el precio sugerido' }
            : { known_rate: 'tu tarifa', offered: 'la tarifa ofrecida', override: 'la tarifa forzada', suggested: 'la tarifa sugerida' };
          return `Con ${names[r.kpis.commercialSource] || names.suggested} y la actividad estimada.`;
        },
        trace: (r) => r.traces.billingTaxes,
        traceLabel: 'Ver cálculo de los impuestos',
      }),
    ),
  );

  // Una sola cifra de precio (tanda novato): la sugerida. El precio objetivo sin
  // redondear va en su "Ver cálculo", con la cuenta en palabras.
  const priceCard = card(
    {},
    kit.stats(
      kit.stat((r) => suggestedRateName(r), (r) => perUnitCeil(r.kpis.suggestedListRate, r), {
        trace: (r) => suggestedRateTrace(r, { roundingStep: kit.get('pricing.roundingStep') }),
        traceLabel: 'Ver cálculo del precio sugerido',
        hint: (r) => {
          if (r.kpis.targetMarginInvalid) return 'Sin precio: revisá el margen.';
          const net = netRateHint(r.kpis.targetNetRate, r);
          const taxes = r.kpis.billingTaxPct > 0 ? ' Incluye los impuestos sobre lo que facturás.' : '';
          return `Para ganar ${formatPercent(r.kpis.targetMarginPct)} sobre el precio, redondeado hacia arriba (nunca baja el margen). De lista, antes de descuentos, sin IVA.${taxes}${net ? ` ${net}` : ''}`;
        },
        emphasis: true,
      }),
      kit.toggle(
        kit.stat((r) => commercialLabel(r), (r) => perUnitMoney(r.kpis.commercialListRate, r), {
          emphasis: true,
          hint: (r) => (isFiniteNumber(r.kpis.commercialNetRate) ? `Neta después de descuentos: ${formatMoney(r.kpis.commercialNetRate)}` : 'Sin tarifa'),
          trace: (r) => r.traces.expectedResult,
        }),
        (r) => r.kpis.commercialSource !== 'suggested' && r.kpis.commercialSource !== 'none',
      ),
      // Revisión de la 0.24.0 (C4 de UX): el mismo margen que el Resultado (shownMarginPct): el que
      // pediste si la diferencia es del redondeo; el real, en la pista.
      kit.stat('Margen esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) && isFiniteNumber(r.kpis.marginPct) ? formatPercent(shownMarginPct(r.kpis, { guaranteeTopUp: r.estimate && r.estimate.revenue ? r.estimate.revenue.guaranteeTopUp : 0 })) : EMPTY), {
        // Con la tarifa sugerida el markup equivalente está en el (i) del margen
        // (COPY-8): acá sólo cuando la tarifa es la tuya u ofrecida.
        hint: (r) => {
          if (r.kpis.commercialSource !== 'suggested') return isFiniteNumber(r.kpis.markupPct) ? `Markup sobre el costo: ${formatPercent(r.kpis.markupPct)}` : '';
          const shown = isFiniteNumber(r.kpis.marginPct) ? shownMarginPct(r.kpis, { guaranteeTopUp: r.estimate && r.estimate.revenue ? r.estimate.revenue.guaranteeTopUp : 0 }) : null;
          return shown !== null && Math.abs(shown - r.kpis.marginPct) > 1e-9 ? `${formatPercent(r.kpis.marginPct)} con el redondeo.` : '';
        },
        tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        trace: (r) => r.traces.expectedResult,
      }),
    ),
  );

  // ------------------------------- precio fijo con inflación esperada (K-01)
  // Una pregunta y, si el precio queda fijo, un solo número (el % mensual que esperás). Sólo
  // fuera de precio cerrado y con más de un mes de contrato. La duración se cambia en su paso
  // (Servicio): acá sólo se muestra. La cuenta la hace el motor (Ver cálculo).
  const adjustment = normalizePriceAdjustment(quote.priceAdjustment);
  const showAdjustment = priceAdjustmentApplies(quote) || (adjustment.mode === 'fixed' && priceAdjustmentApplies({ ...quote, contractMonths: 2 }));
  const inflationRow = (r) => ((r.eecc && r.eecc.rows) || []).find((x) => x.category === 'inflation') || null;
  const inflationOf = (r) => (r.model && r.model.inflation && r.model.inflation.active ? r.model.inflation : null);
  const months = Number(quote.contractMonths);
  const monthsText = Number.isFinite(months) && months > 0 ? `Contrato de ${formatNumber(months, { decimals: 2 })} ${months === 1 ? 'mes' : 'meses'}` : 'Sin duración de contrato';
  const adjustmentQuestion = showAdjustment
    ? kit.question('¿El precio se ajusta durante el contrato?', 'Si el precio queda fijo y los costos suben, cada mes ganás menos. RATEOS lo cubre con la inflación que esperás.', { level: 3 })
    : null;
  const adjustmentCard = showAdjustment
    ? card(
      { className: 'qe-price-adjustment' },
      kit.choice('priceAdjustment.mode', {
        label: h('span', { class: 'sr-only' }, '¿El precio se ajusta durante el contrato?'),
        options: [
          { value: 'adjusted', label: 'Sí, con una cláusula de ajuste' },
          { value: 'fixed', label: 'No, queda fijo todo el contrato' },
        ],
        structural: true,
      }),
      adjustment.mode === 'adjusted'
        ? h('p', { class: 'qe-note' }, 'Usá ', h('a', { href: '#/cotizaciones' }, 'Actualizar tarifa'), ' (en Cotizaciones) cuando suban los costos.')
        : null,
      adjustment.mode === 'fixed'
        ? h('p', { class: 'qe-note qe-contract-months' }, `${monthsText} · `, ctx.readOnly ? null : h('a', { href: fieldHref(quote.id, 'contractMonths') }, 'Cambiar'))
        : null,
      adjustment.mode === 'fixed'
        ? formGrid(
          2,
          kit.num('priceAdjustment.expectedMonthlyInflationPct', {
            label: 'Inflación mensual que esperás',
            rule: 'inflationPct',
            unit: '%',
            placeholder: 'ej.: 3',
            hint: h('span', {}, 'Promedio mensual para todo el contrato ', infoTip('RATEOS reparte la suba: el precio queda parejo, al principio ganás un poco más y al final un poco menos.')),
          }),
        )
        : null,
      adjustment.mode === 'fixed'
        ? kit.toggle(
          h('p', { class: 'qe-note qe-inflation-sum' },
            kit.out((r) => (inflationRow(r) ? `Suma ${formatMoney(inflationRow(r).amount)} al costo del mes (ya incluido en la tarifa sugerida).` : ''), { allowEmpty: true }),
            ' ',
            kit.trace((r) => r.traces.inflation, { label: 'Ver cálculo' })),
          (r) => Boolean(inflationOf(r)),
        )
        : null,
    )
    : null;

  // ---------------------------------------------------- margen vs markup
  const educational = kit.advanced(
    {
      key: 'margin-vs-markup',
      title: 'Ejemplo: margen vs markup',
      variant: 'detail',
      summary: 'Los dos cálculos lado a lado, con un costo de 100.',
    },
    h(
      'div',
      { class: 'qe-compare' },
      h(
        'div',
        { class: 'qe-compare-col' },
        h('span', { class: 'qe-compare-kicker' }, 'Margen 10 % (sobre precio)'),
        h('strong', { class: 'qe-compare-value mono' }, formatValue(priceFromMargin(100, 10), 'number')),
        h('span', { class: 'qe-compare-formula' }, 'Precio = costo ÷ (1 − 10 %) = 100 ÷ 0,90'),
      ),
      h(
        'div',
        { class: 'qe-compare-col' },
        h('span', { class: 'qe-compare-kicker' }, 'Markup 10 % (sobre costo)'),
        h('strong', { class: 'qe-compare-value mono' }, formatValue(priceFromMarkup(100, 10), 'number')),
        h('span', { class: 'qe-compare-formula' }, 'Precio = costo × (1 + 10 %) = 100 × 1,10'),
      ),
    ),
    h('p', { class: 'qe-explain' }, 'Con un markup de 10 % tu margen real es 9,09 %: confundirlos hace cotizar más barato de lo que creés.'),
    kit.trace(() => traceMarginVsMarkup(100, 10), { label: 'Ver cálculo del ejemplo' }),
  );
  educational.id = 'qe-margin-example';

  // --------------------------------- descuento, redondeo y tarifa ofrecida
  const pricingOptions = kit.advanced(
    {
      key: 'margin-pricing',
      title: 'Más detalle (opcional): descuento y redondeo',
      boxed: true,
      summary: () => {
        const pr = quote.pricing || {};
        const parts = [
          hasNumber(pr.customMarginPct) ? `margen personalizado ${formatPercent(Number(pr.customMarginPct))}` : 'sin margen personalizado',
          `descuento comercial ${hasNumber(pr.commercialDiscountPct) ? formatPercent(Number(pr.commercialDiscountPct)) : '0 %'}`,
          hasNumber(pr.roundingStep) && Number(pr.roundingStep) > 0 ? `redondeo hacia arriba a ${formatMoney(Number(pr.roundingStep))}` : 'sin redondeo',
        ];
        const text = parts.join(' · ');
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
      },
    },
    formGrid(
      2,
      kit.num('pricing.customMarginPct', {
        label: 'Margen personalizado (opcional)',
        rule: 'margin',
        unit: '%',
        hint: 'Se agrega a la escalera de márgenes y a la tabla de tarifas del Resultado.',
      }),
      kit.num('pricing.commercialDiscountPct', {
        label: 'Descuento comercial',
        rule: 'percent',
        unit: '%',
        hint: 'Descuento sobre la tarifa de lista para este cliente.',
      }),
      kit.num('pricing.roundingStep', {
        label: COMPANY_LABELS.roundingStep,
        rule: 'money',
        unit: '$',
        hint: 'La tarifa sugerida se redondea HACIA ARRIBA a múltiplos de este valor (nunca baja el margen). Si el paso es más del 1 % de la tarifa (p. ej. $ 1.000 sobre 100 $/kg), se usa un paso menor. 0 = sin redondeo.',
      }),
    ),
    kit.stat((r) => `${r.kpis.commercialSource === 'suggested' || r.kpis.commercialSource === 'none' ? suggestedRateName(r) : commercialLabel(r).replace(' (de lista)', '')} (de lista)`, (r) => (r.kpis.commercialSource === 'suggested' ? perUnitCeil(r.kpis.commercialListRate, r) : perUnitMoney(r.kpis.commercialListRate, r)), {
      emphasis: true,
      hint: (r) => (isFiniteNumber(r.kpis.commercialNetRate) ? `Neta después de descuentos: ${formatMoney(r.kpis.commercialNetRate)}` : 'Sin tarifa'),
      trace: (r) => r.traces.expectedResult,
    }),
    educational,
  );

  // ----------------------------------------------------- reglas comerciales
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const L = activationFieldLabels(T);
  const minimumCallUnit = unitKind === 'hour' ? 'horas' : unitKind === 'quantity' ? unitInfo.plural : 'días';
  // Mínimo garantizado en $ o en unidades (tanda B 2026-11, B-3).
  const guarantee = minimumGuaranteeFields(kit, quote, unitInfo);
  const RULE_NAMES = [
    ['availabilityFeeMonthly', 'fijo por estar de guardia'],
    ['calloutFeePerActivation', `plus por cada ${T.one}`],
    ['mobilizationFeePerActivation', 'movilización'],
    ['extraKmRate', 'km adicional'],
    ['minimumCallUnits', `mínimo ${T.per}`],
    ['minimumMonthlyGuarantee', 'mínimo mensual'],
    ['minimumGuaranteeUnits', 'mínimo mensual'],
    ['continuityDiscountPct', 'descuento por continuidad'],
  ];
  /** Pendiente crítico "Dos abonos por mes" (completitud, ECO-01), o null. */
  const feeOverlapOf = (r) => ((r && r.completeness && r.completeness.pending) || []).find((x) => x.id === 'monthly_fee_overlap') || null;
  const rulesApplied = () => {
    const rules = quote.rules || {};
    // Del mínimo garantizado cuenta sólo el dato del modo elegido ($ o unidades, B-3).
    const skip = rules.minimumGuaranteeBasis === 'units' ? 'minimumMonthlyGuarantee' : 'minimumGuaranteeUnits';
    const active = RULE_NAMES.filter(([key]) => key !== skip && hasNumber(rules[key]) && Number(rules[key]) > 0).map(([, label]) => label);
    // B5: "No aplica equipo en espera" no es una regla aplicada (no cobra nada).
    if (rules.standbyNotApplicable !== true) {
      if (hasNumber(rules.standbyRatePerDay) && Number(rules.standbyRatePerDay) > 0) active.push('equipo en espera');
      else if (showStandbyRule(quote)) active.push('equipo en espera sin definir');
    }
    return active;
  };
  // Sin reglas activas: "Ninguna aplicada" (antes quedaba "Aplicadas: .").
  const rulesSummary = () => {
    const active = rulesApplied();
    return active.length ? `Aplicadas: ${active.join(', ')}.` : 'Ninguna aplicada.';
  };
  const legacy = legacySeparateCharges(quote);
  // 0.10.0 (simplicidad): el mínimo por llamado, el mínimo mensual y los descuentos por días
  // sólo se muestran si la cotización ya los trae cargados. Los motores no cambian.
  const showMinimumCall = Number(quote.rules && quote.rules.minimumCallUnits) > 0;
  const showGuarantee = guaranteeLoaded(quote);
  const hadGuardPlus = legacy.guardPlus;
  // "Quitar" de un cobro aparte cargado antes (mismo patrón que "Quitar la guardia").
  const removeCharge = (name, keys) => (kit.readOnly ? null : kit.action('Quitar', async () => {
    const ok = await confirmDialog({
      title: `Quitar ${name}`,
      message: `Se borra ${name} de esta cotización. El precio se vuelve a calcular sin ese cobro aparte.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    ctx.mutate((q) => {
      if (!isPlainObject(q.rules)) q.rules = {};
      keys.forEach((k) => { q.rules[k] = null; });
    });
  }, { variant: 'ghost', icon: 'trash' }));
  const LEGACY_NOTE = 'Esta cotización ya lo tenía cargado: se sigue cobrando igual. Las cotizaciones nuevas ya no lo ofrecen (un solo precio).';
  // Mismo criterio que el Resultado: el descuento por continuidad también cuenta.
  const rulesFlag = (r) => {
    const c = r.continuity || {};
    if (feeOverlapOf(r)) return { tone: 'red', text: 'Dos abonos por mes' };
    if (c.applies && c.status === 'red') return { tone: 'red', text: 'Un descuento pierde plata' };
    if (c.applies && c.status === 'orange') return { tone: 'orange', text: 'Un descuento bajo el objetivo' };
    return null;
  };
  // UX 2026-11: las reglas van como grupo dentro de "Opciones comerciales" (antes, un desplegable
  // dentro de otro con casi el mismo nombre: dos clics seguidos). El resumen y la marca (p. ej.
  // "Dos abonos por mes") siguen en el desplegable de afuera.
  const rulesCard = kit.group(
    'Reglas comerciales',
    h('p', { class: 'qe-note' }, `Mínimos y descuentos de ${closed ? 'tu precio' : 'tu tarifa'}. Dejá en 0 lo que no aplica.`),
    // Regla de un ítem (2026-11-18): fijo de guardia, plus, movilización, km adicional y equipo en
    // espera se cobran aparte del precio único. Sólo los ve una cotización que ya los tenía, con Quitar.
    legacy.guardFee ? ruleRow(
      `${L.guardFee} (cargado antes)`,
      unitKind === 'month'
        ? `${LEGACY_NOTE} Tu tarifa ya es un abono mensual: si es el mismo abono, se facturarían los dos.`
        : LEGACY_NOTE,
      [kit.num('rules.availabilityFeeMonthly', { label: 'Fijo por mes', rule: 'money', unit: '$/mes' }), removeCharge('el fijo por estar de guardia', ['availabilityFeeMonthly'])],
      kit.out((r) => {
        const item = feeOverlapOf(r);
        return item ? h('p', { class: 'qe-warn' }, icon('alert', { size: 14 }), h('span', {}, item.message)) : '';
      }, { tag: 'div', allowEmpty: true }),
    ) : null,
    hadGuardPlus ? ruleRow(
      `${L.guardPlus} (cargado antes)`,
      LEGACY_NOTE,
      [kit.num('rules.calloutFeePerActivation', { label: L.perActivation, rule: 'money', unit: '$' }), removeCharge(`el plus por ${T.one}`, ['calloutFeePerActivation'])],
    ) : null,
    legacy.mobilization ? ruleRow(
      'Movilización (cargada antes)',
      `${LEGACY_NOTE} Lo que cuesta llegar ya está en tu costo (Movilización y viajes).`,
      [kit.num('rules.mobilizationFeePerActivation', { label: L.perActivation, rule: 'money', unit: '$' }), removeCharge('la movilización cobrada aparte', ['mobilizationFeePerActivation'])],
    ) : null,
    legacy.extraKm ? ruleRow(
      'Km incluidos y km adicional (cargado antes)',
      LEGACY_NOTE,
      [
        kit.num('rules.includedKmPerActivation', { label: L.includedKm, rule: 'distance', unit: 'km' }),
        kit.num('rules.extraKmRate', { label: '$ por km adicional', rule: 'money', unit: '$/km' }),
        removeCharge('el km adicional', ['includedKmPerActivation', 'extraKmRate']),
      ],
      kit.out((r) => {
        const rev = r.estimate.revenue;
        const route = formatValue(r.model.logistics.routeKmPerActivation, 'km');
        if (!(rev.components.extraKm > 0)) return `Km de ruta ${T.per}: ${route}. Cargá un $ por km para cobrar los que superen los incluidos.`;
        return `Se cobran ${formatValue(rev.extraKmPerActivation, 'km')} adicionales ${T.per} (de ${route} de ruta): ${formatMoney(rev.components.extraKm)} por mes.`;
      }),
    ) : null,
    // UX 2026-11: el mínimo por llamado sigue (es parte del precio único, no un cobro aparte). Se
    // esconde en 0 cuando no aplica (abono mensual o por trabajo) o en una cotización vieja, para
    // que no se mezcle con los renglones "(cargado antes)".
    showMinimumCall ? ruleRow(
      `${L.minimumCall} (minimum call)`,
      unitKind === 'month'
        ? `Con abono mensual no aplica: la facturación no depende de ${T.theMany} ${T.many}.`
        : unitKind === 'event'
          ? `Cobrás ${unit.label}: cada ${unitInfo.singular} ya se factura entero, el mínimo ${T.per} no aplica.`
          : `Mínimo de ${minimumCallUnit} facturables ${T.per}, aunque se trabaje menos.`,
      [kit.num('rules.minimumCallUnits', { label: `${L.minimumCall} (${minimumCallUnit})`, rule: 'quantity', unit: minimumCallUnit })],
      kit.out((r) => minimumCallNote(r, T, unitInfo)),
    ) : null,
    legacy.standby ? ruleRow(
      'Equipo en espera (cargado antes)',
      `${LEGACY_NOTE} Días por mes que el equipo queda en locación sin operar y se cobran a tarifa de espera.`,
      [
        kit.num('rules.standbyDaysPerMonth', {
          label: 'Días en espera por mes',
          rule: 'daysInMonth',
          unit: 'días',
          disabled: standbyOff,
          hint: standbyOff ? 'No se usa: marcaste "No aplica equipo en espera".' : null,
        }),
        kit.num('rules.standbyRatePerDay', {
          label: 'Tarifa en espera (standby)',
          rule: 'money',
          unit: '$/día',
          disabled: standbyOff,
          hint: standbyOff ? 'No se usa: marcaste "No aplica equipo en espera".' : null,
        }),
        kit.check('rules.standbyNotApplicable', {
          label: 'No aplica equipo en espera',
          structural: true,
          hint: 'Marcalo si el equipo nunca queda en locación sin operar: los días y la tarifa en espera no se usan (ingreso y costo en $ 0).',
        }),
        removeCharge('el equipo en espera', ['standbyDaysPerMonth', 'standbyRatePerDay']),
      ],
      // La nota de los días va en su propio párrafo, debajo del ingreso (revisión UX).
      kit.out((r) => {
        const days = quote.rules && quote.rules.standbyDaysPerMonth;
        const withNote = !standbyOff && Number(days) > 0;
        return h('div', {},
          h('p', {}, standbyOutputText(r, { off: standbyOff, days, note: false })),
          withNote ? h('p', { class: 'qe-rule-output-note' }, STANDBY_DAYS_NOTE) : null);
      }, { tag: 'div' }),
    ) : null,
    showGuarantee ? ruleRow(
      'Mínimo mensual garantizado',
      'La facturación del mes nunca es menor a este mínimo: un monto en $ o una cantidad de unidades a la tarifa.',
      guarantee.fields,
      h('div', {}, guarantee.note, kit.out((r) => (r.estimate.revenue.guaranteeTopUp > 0 ? '' : 'Con la actividad estimada no hace falta completar el mínimo.'), { allowEmpty: true })),
    ) : null,
    ruleRow(
      'Descuento por continuidad',
      'Si el contrato dura al menos los meses indicados, se descuenta este % de la tarifa.',
      [
        kit.num('rules.continuityDiscountPct', { label: 'Descuento', rule: 'percent', unit: '%' }),
        kit.num('rules.continuityMinMonths', { label: 'Meses mínimos de contrato', rule: 'months', unit: 'meses' }),
      ],
      kit.out((r) => {
        const c = r.continuity || {};
        if (!(c.discountPct > 0)) return 'Sin descuento por continuidad.';
        const status = c.status ? ` · ${DISCOUNT_STATUS[c.status] ? DISCOUNT_STATUS[c.status][0].toLowerCase() : ''}` : '';
        return c.applies
          ? `Aplica: el contrato dura ${formatNumber(c.contractMonths)} meses (mínimo ${formatNumber(c.minMonths)})${status}.`
          : `No aplica: el contrato dura ${formatNumber(c.contractMonths)} meses y el mínimo es ${formatNumber(c.minMonths)}.`;
      }),
    ),
  );

  // ------------------------------------------------- tramos por cantidad
  const tiers = quote.rules.volumeTiers;
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const lastTo = last && last.toDays !== null && last.toDays !== undefined && last.toDays !== '' ? Number(last.toDays) : null;
    const from = Number.isFinite(lastTo) ? lastTo + 1 : last ? Number(last.fromDays) + 1 || 1 : 1;
    const index = tiers.length;
    ctx.mutate((q) => q.rules.volumeTiers.push({ id: `tier-${createId().slice(0, 8)}`, fromDays: from, toDays: null, discountPct: 0 }), { focus: `rules.volumeTiers.${index}.discountPct` });
  };
  const removeTier = async (index) => {
    const tier = tiers[index];
    if (!tier) return;
    const ok = await confirmRemove({ title: 'Quitar tramo', name: `Tramo ${tierLabel(tier)}`, extra: '' });
    if (ok) ctx.mutate((q) => q.rules.volumeTiers.splice(index, 1));
  };

  const tierStatus = (r, id) => {
    const d = (r.discounts || []).find((x) => x.id === id);
    if (!d) return badge(!dayTiers ? 'No aplica' : 'Sin tarifa', 'gray');
    const granted = isFiniteNumber(d.discountPct) && d.discountPct > 0;
    // Sin descuento, perder plata es por la actividad (pocos días), no por el tramo.
    const [text, tone] = !granted && d.status === 'red' ? ['Pocos días: pierde plata', 'red'] : DISCOUNT_STATUS[d.status] || DISCOUNT_STATUS.unknown;
    return h(
      'span',
      { class: 'qe-tier-eval' },
      badge(text, tone),
      h('span', { class: 'muted small mono' }, isFiniteNumber(d.marginPct) ? `Margen ${formatPercent(d.marginPct)} con ${formatNumber(d.evaluatedDays)} ${d.evaluatedDays === 1 ? 'día' : 'días'}` : EMPTY),
    );
  };

  // Mismo criterio que el Resultado: sólo cuentan los tramos CON descuento (PROD-2).
  const tiersSummary = (r) => {
    const withDiscount = tiers.filter((t) => hasNumber(t.discountPct) && Number(t.discountPct) > 0);
    if (withDiscount.length === 0) return `${tiers.length} ${plural(tiers.length, 'tramo', 'tramos')}, ninguno con descuento.`;
    const list = withDiscount.map((t) => `${tierLabel(t)}: ${formatPercent(Number(t.discountPct))}`).join(' · ');
    const f = tierFindings(r);
    const warn = f.red > 0
      ? ` ${f.red === 1 ? 'Con 1 de esos descuentos perdés plata.' : `Con ${f.red} de esos descuentos perdés plata.`}`
      : f.orange > 0
        ? ` ${f.orange === 1 ? '1 queda debajo del margen objetivo.' : `${f.orange} quedan debajo del margen objetivo.`}`
        : '';
    return `${withDiscount.length} ${plural(withDiscount.length, 'tramo', 'tramos')} con descuento (${list}).${warn}`;
  };
  const activityNote = kit.toggle(
    h('div', { class: 'qe-tip qe-tip-warning' }, icon('alert'), kit.out((r) => minimumActivityText(r) || '', { tag: 'p', allowEmpty: true })),
    (r) => dayTiers && tierFindings(r).losingByActivity && Boolean(minimumActivityText(r)),
  );
  const tiersFlag = (r) => {
    const f = tierFindings(r);
    if (f.red > 0) return { tone: 'red', text: f.red === 1 ? 'Un descuento pierde plata' : `${f.red} descuentos pierden plata` };
    if (f.orange > 0) return { tone: 'orange', text: f.orange === 1 ? 'Un descuento bajo el objetivo' : `${f.orange} descuentos bajo el objetivo` };
    return null;
  };
  // En precio cerrado los descuentos por cantidad de días no se muestran (un precio por trabajo).
  // Tampoco si no cobrás por día u hora (abono mensual, por cantidad): ahí no se aplican
  // (revisión UX tanda novatos). Los tramos guardados quedan como estaban.
  // 0.10.0: sólo si algún tramo ya tiene descuento cargado.
  const tiersLoaded = Array.isArray(tiers) && tiers.some((t) => t && hasNumber(t.discountPct) && Number(t.discountPct) > 0);
  const tiersCard = closed || !dayTiers || !tiersLoaded ? null : kit.advanced(
    {
      key: 'margin-tiers',
      title: 'Descuentos por cantidad de días',
      summary: tiersSummary,
      flag: tiersFlag,
    },
    h('p', { class: 'qe-note' }, 'Semáforo: verde mantiene el margen, naranja queda debajo del objetivo, rojo pierde plata.'),
    // Lo decide quien cotiza (auditoría 2026-11): con mínimo por llamado, los días facturados superan a los trabajados.
    dayTiers
      ? formGrid(2, kit.select('rules.volumeTierBasis', {
        label: '¿Con qué días se elige el tramo?',
        options: [
          { value: 'billed', label: `Días facturados (incluye el mínimo ${T.per})` },
          { value: 'worked', label: 'Días trabajados' },
        ],
        hint: `Sólo cambia algo si hay mínimo ${T.per}: con 20 días trabajados y ${T.many} cortos podés facturar 32 días de mínimos. "Facturados" da el tramo de 32 días; "trabajados", el de 20. Si dudás, dejá "facturados".`,
      }))
      : null,
    unitKind === 'month' ? h('p', { class: 'qe-explain' }, 'Con abono mensual los tramos por cantidad de días no se aplican.') : null,
    !dayTiers && unitKind !== 'month' ? h('p', { class: 'qe-explain' }, `Cobrás ${unit.label}: los tramos por cantidad de días no se aplican (sólo con tarifa por día u hora).`) : null,
    activityNote,
    tiers.length
      ? table({
        className: 'qe-edit-table qe-tiers-table',
        caption: 'Tramos de descuento por cantidad de días',
        columns: [
          { key: 'from', label: 'Desde (días)', render: (row, i) => kit.num(`rules.volumeTiers.${i}.fromDays`, { label: 'Desde (días)', rule: 'days' }) },
          { key: 'to', label: 'Hasta (días)', render: (row, i) => kit.num(`rules.volumeTiers.${i}.toDays`, { label: 'Hasta (días)', rule: 'days', placeholder: 'Sin tope' }) },
          { key: 'pct', label: 'Descuento (%)', render: (row, i) => kit.num(`rules.volumeTiers.${i}.discountPct`, { label: 'Descuento (%)', rule: 'percent' }) },
          {
            key: 'status',
            label: 'Tramo y evaluación (peor caso)',
            render: (row, i) => h(
              'div',
              { class: 'qe-tier-cell' },
              kit.out(() => (quote.rules.volumeTiers[i] ? tierLabel(quote.rules.volumeTiers[i]) : EMPTY), { className: 'qe-tier-label' }),
              kit.out((r) => tierStatus(r, row.id), { className: 'qe-tier-status' }),
            ),
          },
          { key: 'remove', label: '', render: (row, i) => kit.action('', () => removeTier(i), { variant: 'ghost', icon: 'trash', title: 'Quitar tramo' }) },
        ],
        rows: tiers,
      })
      : emptyState('No hay tramos de descuento.'),
    h('p', { class: 'footnote' }, '"Hasta" vacío = sin tope. Cada tramo se evalúa en su peor caso (el primer día del tramo).'),
    h('div', { class: 'qe-toolbar' }, kit.action('Agregar tramo', addTier, { icon: 'plus' })),
  );

  // Reglas comerciales y descuentos por días en UN plegable (tanda novato).
  const standbyPending = (r) => ((r && r.completeness && r.completeness.items) || []).some((i) => i.id === 'standby' && i.status !== 'ok' && i.status !== 'n/a');
  const commercialCard = kit.advanced(
    {
      key: 'margin-commercial',
      title: 'Opciones comerciales (opcional)',
      boxed: true,
      summary: (r) => {
        const active = rulesApplied();
        const rules = `Reglas comerciales: ${active.length ? active.join(', ') : 'ninguna aplicada'}.`;
        return tiersCard ? `${rules} Descuentos por días: ${tiersSummary(r)}` : rules;
      },
      flag: (r) => rulesFlag(r) || (tiersCard ? tiersFlag(r) : null) || (standbyPending(r) ? { tone: 'orange', text: 'Revisar' } : null),
    },
    rulesCard,
    tiersCard,
  );

  // Precio cerrado (revisión UX tanda novatos): sin reglas cargadas no se monta (abonos, km y
  // mínimos por mes no hacen a un precio por trabajo). Con alguna regla guardada, se ve como siempre.
  const showCommercial = !closed || rulesApplied().length > 0;
  // Lo cargado antes que ya no se ofrece (0.24.0, antes en "Cómo se cobra"): hora fuera de horario,
  // guardia y adicionales. Sólo en las cotizaciones que lo tienen.
  const legacySlot = h('div', { class: 'qe-legacy-slot' });
  renderCharge(legacySlot, { ...ctx, part: 'legacy' });
  const legacyShown = legacySlot.dataset.empty !== 'true';
  mount(
    container,
    marginCard,
    ownPriceCard,
    taxesCard,
    priceCard,
    adjustmentQuestion,
    adjustmentCard,
    // C2 (revisión de la 0.24.0): lo cargado antes cobra plata hoy, así que va antes de los dos
    // pliegues opcionales; "Opciones comerciales" queda más abajo, como dice la guardia.
    legacyShown ? kit.question('Cargado antes', 'Esta cotización ya tenía estos cobros: se siguen cobrando igual. Las cotizaciones nuevas no los ofrecen.', { level: 3 }) : null,
    legacyShown ? legacySlot : null,
    kit.question('¿Querés ajustar descuentos o redondeo?', `Si no los usás, dejalos como están: no cambian ${closed ? 'el precio sugerido' : 'la tarifa sugerida'}.`, { level: 3 }),
    pricingOptions,
    showCommercial ? commercialCard : null,
  );
  return { update() {} };
}

/**
 * Qué dice "Borrar mi precio y usar el sugerido" y adónde lleva (revisión de la 0.24.0, C-2).
 * Al pasar a calcular la tarifa, la completitud pide la actividad del mes: si falta, se avisa y
 * después se enfoca ese campo (en «El servicio»). Sin "$ 0" cuando no había precio.
 */
export function useSuggestedPlan(quote, { closed = false, known: knownArg } = {}) {
  const info = billingUnitOf(quote);
  const activity = (quote && quote.activity) || {};
  const byQuantity = info.kind === 'quantity' || info.kind === 'event';
  const missingPath = byQuantity
    ? (Number(activity.billableQuantityPerMonth) > 0 ? null : 'activity.billableQuantityPerMonth')
    : (Number(activity.activeDaysPerMonth) > 0 ? null : 'activity.activeDaysPerMonth');
  const known = Number(knownArg !== undefined ? knownArg : quote && quote.pricing && quote.pricing.knownRate);
  const what = closed ? 'el precio' : 'la tarifa';
  const first = known > 0
    ? `Se borra tu precio de esta cotización (${formatMoney(known)}) y se usa ${what} que sugiere RATEOS con tu margen.`
    : `Esta cotización no tiene precio cargado: se usa ${what} que sugiere RATEOS con tu margen.`;
  const missing = missingPath
    ? ` Para sugerirte un precio falta ${byQuantity ? `cuántos ${info.plural} hacés por mes` : 'cuántos días por mes trabajás'} (en «El servicio»): te llevamos a ese campo.`
    : '';
  return { message: `${first}${missing} Podés volver a escribir un precio cuando quieras.`, missingPath };
}
