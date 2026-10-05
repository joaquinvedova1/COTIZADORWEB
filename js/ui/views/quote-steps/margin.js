/**
 * Etapa 4 · El precio — Margen, impuestos sobre lo que facturás y reglas
 * comerciales.
 * Básico: margen objetivo (sobre el precio), con margen vs markup explicado
 * una sola vez (recuadro + "Ver ejemplo"), e impuestos sobre lo que facturás
 * (un % total o detalle; RATEOS no trae alícuotas). Opciones avanzadas: margen
 * personalizado, descuento comercial, redondeo, tarifa ofrecida, reglas
 * comerciales y tramos de descuento (cada una con un resumen visible).
 *
 * MARGEN (sobre precio) y MARKUP (sobre costo) NO son sinónimos:
 *   costo 100, margen 10 % → precio 111,11 · costo 100, markup 10 % → precio 110
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, emptyState, table, badge, icon, button, confirmDialog } from '../../components.js';
import { RATE_UNITS } from '../../../domain/catalogs.js';
import { copyBillingTaxes, billingTaxesDecided, emptyBillingTaxes } from '../../../domain/billing-taxes.js';
import { billingTaxConfigInfo } from '../../../engines/billing-taxes-engine.js';
import { priceFromMargin, priceFromMarkup, traceMarginVsMarkup } from '../../../engines/pricing-engine.js';
import { tierLabel } from '../../../engines/commercial-rules-engine.js';
import { formatMoney, formatPercent, formatNumber, formatValue, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { createId } from '../../../core/ids.js';
import { isPlainObject } from '../../../core/object.js';
import { perUnitCeil, perUnitMoney, netRateHint, targetRateTrace, confirmRemove, hasNumber, stepName, plural } from './shared.js';
import { minActivityNotice } from '../../result-text.js';
import { billingTaxesFields, billingTaxesHelp, describeBillingTaxes, shortBillingTaxes, sameBillingTaxes, invalidTaxesText } from '../../billing-taxes-form.js';
import { userErrorMessage } from '../../layout.js';

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

export function render(container, ctx) {
  const { quote, kit } = ctx;
  const unit = RATE_UNITS.find((u) => u.id === quote.unit) || RATE_UNITS[0];
  const isModeB = quote.pricingMode !== 'known_rate';
  const standbyOff = Boolean(quote.rules && quote.rules.standbyNotApplicable);

  // ------------------------------------------------------------ margen
  const marginCard = card(
    {},
    formGrid(
      2,
      kit.num('pricing.targetMarginPct', {
        label: 'Margen que querés ganar (sobre el precio)',
        rule: 'margin',
        unit: '%',
        requiredMark: true,
        hint: 'Lo que querés que te quede de cada $ 100 facturados, después de pagar los costos y los impuestos sobre lo que facturás (antes del impuesto a las Ganancias).',
      }),
    ),
    // Margen vs markup se explica UNA vez: este recuadro + "Ver ejemplo" (COPY-8).
    // Con un margen inválido no se muestra: ya lo dicen el campo y el aviso rojo.
    kit.toggle(
      h(
        'div',
        { class: 'qe-tip' },
        icon('info'),
        h(
          'p',
          {},
          kit.out((r) => {
            const k = r.kpis;
            const t = k.billingTaxPct;
            // Markup (precio = costo × (1 + markup)) y ganancia sobre el costo: los calcula el motor.
            const mk = k.targetMarkupPct;
            if (!isFiniteNumber(mk)) return 'Definí un margen objetivo válido (de 0 a menos de 100 %).';
            return t > 0
              ? `Con ${formatPercent(t)} de impuestos sobre lo que facturás, para ganar ${formatPercent(k.targetMarginPct)} sobre el precio cobrás el costo + ${formatPercent(mk)} (markup: recargo sobre el costo). De ese recargo, ${formatPercent(k.targetProfitOnCostPct)} del costo es tu ganancia y el resto son impuestos.`
              : `Un margen de ${formatPercent(k.targetMarginPct)} sobre el precio equivale a un markup (recargo sobre el costo) de ${formatPercent(mk)}: no son lo mismo.`;
          }),
          ' ',
          h('button', { type: 'button', class: 'btn btn-link btn-sm qe-inline-link', 'aria-controls': 'qe-margin-example', on: { click: () => showExample() } }, 'Ver ejemplo'),
        ),
      ),
      (r) => !r.kpis.targetMarginInvalid,
    ),
  );

  // ------------------------------------ impuestos sobre lo que facturás
  const taxesCard = card(
    { title: '¿Qué parte de lo que facturás se va en impuestos?', subtitle: 'No son un costo más: se pagan sobre lo que cobrás. RATEOS los incluye en la tarifa junto con tu margen.', level: 3, className: 'qe-taxes' },
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
      h('div', { class: 'qe-tip qe-tip-warning', role: 'status' }, icon('alert'), h('p', {}, 'Sin definir: la tarifa piso y la sugerida NO incluyen estos impuestos. Si cobrás esas tarifas, los pagás de tu bolsillo. Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".')),
      (r) => !r.kpis.billingTaxesDefined && !r.kpis.billingTaxesInvalid,
    ),
    kit.toggle(
      h('div', { class: 'qe-tip qe-tip-danger', role: 'status' }, icon('alert'), kit.out((r) => `Revisá los impuestos: ${invalidTaxesText(r.billingTaxInfo)}. Mientras tanto no se aplican.`, { tag: 'p' })),
      (r) => r.kpis.billingTaxesInvalid,
    ),
    kit.toggle(
      h('div', { class: 'qe-tip qe-tip-danger', role: 'status' }, icon('alert'), kit.out((r) => `Con ${formatPercent(r.kpis.billingTaxPct)} de impuestos sobre lo que facturás, el margen objetivo tiene que ser menor a ${formatPercent(100 - r.kpis.billingTaxPct)}: no hay un precio que deje ese margen.`, { tag: 'p' })),
      (r) => r.kpis.targetMarginInvalid && r.kpis.billingTaxPct > 0,
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
      kit.stat('Impuestos del mes', (r) => (isFiniteNumber(r.kpis.commercialListRate) && r.kpis.billingTaxesDefined ? formatMoney(r.kpis.billingTaxes) : EMPTY), {
        hint: (r) => {
          if (!r.kpis.billingTaxesDefined) return 'Cargá el % para verlos.';
          if (!isFiniteNumber(r.kpis.commercialListRate)) return 'Sin tarifa.';
          return `Con ${{ known_rate: 'tu tarifa', offered: 'la tarifa ofrecida', override: 'la tarifa forzada' }[r.kpis.commercialSource] || 'la tarifa sugerida'} y la actividad estimada.`;
        },
        trace: (r) => r.traces.billingTaxes,
        traceLabel: 'Ver cálculo de los impuestos del mes',
      }),
    ),
  );

  const priceCard = card(
    {},
    kit.stats(
      kit.stat((r) => (r.kpis.targetMarginInvalid ? 'Precio objetivo' : `Precio para ganar ${formatPercent(r.kpis.targetMarginPct)}`), (r) => perUnitCeil(r.kpis.targetListRate, r.unit), {
        trace: targetRateTrace,
        hint: (r) => {
          if (r.kpis.targetMarginInvalid) return 'Sin precio objetivo: revisá el margen.';
          const net = netRateHint(r.kpis.targetNetRate, r);
          const taxes = r.kpis.billingTaxPct > 0 ? ' Incluye los impuestos sobre lo que facturás.' : '';
          return `Tarifa de lista, antes de descuentos, sin IVA.${taxes}${net ? ` ${net}` : ''}`;
        },
      }),
      kit.stat('Tarifa sugerida', (r) => perUnitCeil(r.kpis.suggestedListRate, r.unit), { hint: 'El precio anterior redondeado hacia arriba (nunca baja el margen).', emphasis: true }),
      kit.toggle(
        kit.stat((r) => (r.kpis.commercialSource === 'known_rate' ? 'Tu tarifa (de lista)' : 'Tarifa ofrecida (de lista)'), (r) => perUnitMoney(r.kpis.commercialListRate, r.unit), {
          emphasis: true,
          hint: (r) => (isFiniteNumber(r.kpis.commercialNetRate) ? `Neta después de descuentos: ${formatMoney(r.kpis.commercialNetRate)}` : 'Sin tarifa'),
          trace: (r) => r.traces.expectedResult,
        }),
        (r) => r.kpis.commercialSource !== 'suggested' && r.kpis.commercialSource !== 'none',
      ),
      kit.stat('Margen esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) && isFiniteNumber(r.kpis.marginPct) ? formatPercent(r.kpis.marginPct) : EMPTY), {
        // Con la tarifa sugerida el recuadro de arriba ya dice el markup
        // equivalente (COPY-8): acá sólo cuando la tarifa es la tuya u ofrecida.
        hint: (r) => (r.kpis.commercialSource !== 'suggested' && isFiniteNumber(r.kpis.markupPct) ? `Markup sobre el costo: ${formatPercent(r.kpis.markupPct)}` : ''),
        tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        trace: (r) => r.traces.expectedResult,
      }),
    ),
  );

  // ---------------------------------------------------- margen vs markup
  const educational = kit.advanced(
    {
      key: 'margin-vs-markup',
      title: 'Ejemplo: margen vs markup',
      variant: 'detail',
      boxed: true,
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
  /** "Ver ejemplo": abre la sección y lleva la vista (y el foco) a ella. */
  function showExample() {
    educational.open = true;
    if (typeof educational.scrollIntoView === 'function') educational.scrollIntoView({ block: 'nearest' });
    const summaryEl = educational.querySelector('summary');
    if (summaryEl) summaryEl.focus();
  }

  // --------------------------------- descuento, redondeo y tarifa ofrecida
  const pricingOptions = kit.advanced(
    {
      key: 'margin-pricing',
      title: 'Opciones avanzadas: descuento, redondeo y tarifa ofrecida',
      boxed: true,
      summary: () => {
        const pr = quote.pricing || {};
        const parts = [
          hasNumber(pr.customMarginPct) ? `margen personalizado ${formatPercent(Number(pr.customMarginPct))}` : 'sin margen personalizado',
          `descuento comercial ${hasNumber(pr.commercialDiscountPct) ? formatPercent(Number(pr.commercialDiscountPct)) : '0 %'}`,
          hasNumber(pr.roundingStep) && Number(pr.roundingStep) > 0 ? `redondeo hacia arriba a ${formatMoney(Number(pr.roundingStep))}` : 'sin redondeo',
          isModeB
            ? (hasNumber(pr.offeredRateOverride) && Number(pr.offeredRateOverride) > 0 ? `tarifa ofrecida a mano ${formatMoney(Number(pr.offeredRateOverride))}` : 'se ofrece la tarifa sugerida')
            : `tu tarifa (en "${stepName('modality')}")`,
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
        label: 'Redondeo comercial',
        rule: 'money',
        unit: '$',
        hint: 'La tarifa sugerida se redondea HACIA ARRIBA a múltiplos de este valor (nunca baja el margen). 0 = sin redondeo.',
      }),
      isModeB
        ? kit.num('pricing.offeredRateOverride', {
          label: `Tarifa ofrecida a mano (opcional, de lista, ${unit.label}, sin IVA)`,
          rule: 'money',
          unit: unit.label,
          hint: 'Tarifa de lista, sin IVA, antes de descuentos. Si la dejás vacía, se ofrece la tarifa sugerida.',
        })
        : kit.staticField(`Tu tarifa (${unit.label})`, isFiniteNumber(Number(quote.pricing.knownRate)) && Number(quote.pricing.knownRate) > 0 ? formatMoney(Number(quote.pricing.knownRate)) : 'Sin cargar', `Elegiste "Sí, ya tengo la tarifa": se edita en "${stepName('modality')}".`),
    ),
    kit.stat((r) => `${{ known_rate: 'Tu tarifa', offered: 'Tarifa ofrecida', override: 'Tarifa forzada' }[r.kpis.commercialSource] || 'Tarifa sugerida'} (de lista)`, (r) => (r.kpis.commercialSource === 'suggested' ? perUnitCeil(r.kpis.commercialListRate, r.unit) : perUnitMoney(r.kpis.commercialListRate, r.unit)), {
      emphasis: true,
      hint: (r) => (isFiniteNumber(r.kpis.commercialNetRate) ? `Neta después de descuentos: ${formatMoney(r.kpis.commercialNetRate)}` : 'Sin tarifa'),
      trace: (r) => r.traces.expectedResult,
    }),
  );

  // ----------------------------------------------------- reglas comerciales
  const minimumCallUnit = quote.unit === 'hour' ? 'horas' : 'días';
  const RULE_NAMES = [
    ['availabilityFeeMonthly', 'abono de disponibilidad'],
    ['calloutFeePerActivation', 'cargo por salida'],
    ['mobilizationFeePerActivation', 'movilización'],
    ['extraKmRate', 'km adicional'],
    ['minimumCallUnits', 'mínimo por llamado'],
    ['minimumMonthlyGuarantee', 'mínimo mensual'],
    ['continuityDiscountPct', 'descuento por continuidad'],
  ];
  const rulesSummary = () => {
    const rules = quote.rules || {};
    const active = RULE_NAMES.filter(([key]) => hasNumber(rules[key]) && Number(rules[key]) > 0).map(([, label]) => label);
    if (rules.standbyNotApplicable === true) active.push('equipo en espera: no aplica');
    else if (hasNumber(rules.standbyRatePerDay) && Number(rules.standbyRatePerDay) > 0) active.push('equipo en espera');
    else active.push('equipo en espera sin definir');
    return `Abono, cargos por llamado, mínimos, equipo en espera y continuidad. Aplicadas: ${active.join(', ')}.`;
  };
  const rulesCard = kit.advanced(
    {
      key: 'margin-rules',
      title: 'Reglas comerciales',
      boxed: true,
      summary: rulesSummary,
      // Mismo criterio que el Resultado: el descuento por continuidad también cuenta.
      flag: (r) => {
        const c = r.continuity || {};
        if (c.applies && c.status === 'red') return { tone: 'red', text: 'Un descuento pierde plata' };
        if (c.applies && c.status === 'orange') return { tone: 'orange', text: 'Un descuento bajo el objetivo' };
        return null;
      },
    },
    h('p', { class: 'qe-note' }, 'Cómo se factura el servicio además de la tarifa. Dejá en 0 lo que no aplica.'),
    ruleRow(
      'Abono de disponibilidad',
      'Monto fijo por mes por tener el recurso reservado, se trabaje o no.',
      [kit.num('rules.availabilityFeeMonthly', { label: 'Abono mensual', rule: 'money', unit: '$/mes' })],
    ),
    ruleRow(
      'Cargo por salida (call-out)',
      'Monto fijo que se cobra cada vez que el cliente llama.',
      [kit.num('rules.calloutFeePerActivation', { label: 'Por llamado', rule: 'money', unit: '$' })],
    ),
    ruleRow(
      'Movilización',
      'Cobro por llevar los recursos a la locación en cada llamado.',
      [kit.num('rules.mobilizationFeePerActivation', { label: 'Por llamado', rule: 'money', unit: '$' })],
    ),
    ruleRow(
      'Km incluidos y km adicional',
      'Los km de ruta de cada llamado que superen los incluidos se cobran aparte.',
      [
        kit.num('rules.includedKmPerActivation', { label: 'Km incluidos por llamado', rule: 'distance', unit: 'km' }),
        kit.num('rules.extraKmRate', { label: '$ por km adicional', rule: 'money', unit: '$/km' }),
      ],
      kit.out((r) => {
        const rev = r.estimate.revenue;
        const route = formatValue(r.model.logistics.routeKmPerActivation, 'km');
        if (!(rev.components.extraKm > 0)) return `Km de ruta por llamado: ${route}. Cargá un $ por km para cobrar los que superen los incluidos.`;
        return `Se cobran ${formatValue(rev.extraKmPerActivation, 'km')} adicionales por llamado (de ${route} de ruta): ${formatMoney(rev.components.extraKm)} por mes.`;
      }),
    ),
    ruleRow(
      'Mínimo por llamado (minimum call)',
      quote.unit === 'month'
        ? 'Con abono mensual no aplica: la facturación no depende de los llamados.'
        : `Mínimo de ${minimumCallUnit} facturables por llamado, aunque se trabaje menos.`,
      [kit.num('rules.minimumCallUnits', { label: `Mínimo por llamado (${minimumCallUnit})`, rule: 'quantity', unit: minimumCallUnit })],
      kit.out((r) => (r.estimate.revenue.minimumCallApplied ? 'Se está aplicando: suma unidades facturables.' : 'Hoy no cambia la facturación (cada llamado ya supera el mínimo).')),
    ),
    ruleRow(
      'Equipo en espera (standby)',
      'Días por mes que el equipo queda en locación sin operar y se cobran a tarifa de espera. El personal en espera también es costo.',
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
      ],
      kit.out((r) => (standbyOff
        ? 'No aplica equipo en espera: los días y la tarifa cargados no se usan. Ingreso y costo en espera: $ 0.'
        : `Ingreso por equipo en espera: ${formatMoney(r.estimate.revenue.components.standby)} · costo del personal en espera: ${formatMoney(r.model.standby.monthly)} por mes.`)),
    ),
    ruleRow(
      'Mínimo mensual garantizado',
      'La facturación del mes nunca es menor a este monto.',
      [kit.num('rules.minimumMonthlyGuarantee', { label: 'Mínimo mensual', rule: 'money', unit: '$/mes' })],
      kit.out((r) => (r.estimate.revenue.guaranteeTopUp > 0 ? `Con la actividad estimada suma ${formatMoney(r.estimate.revenue.guaranteeTopUp)} para llegar al mínimo.` : 'Con la actividad estimada no hace falta completar el mínimo.')),
    ),
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
    if (!d) return badge(quote.unit === 'month' ? 'No aplica' : 'Sin tarifa', 'gray');
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
    (r) => quote.unit !== 'month' && tierFindings(r).losingByActivity && Boolean(minimumActivityText(r)),
  );
  const tiersCard = kit.advanced(
    {
      key: 'margin-tiers',
      title: 'Descuentos por cantidad de días',
      boxed: true,
      summary: tiersSummary,
      flag: (r) => {
        const f = tierFindings(r);
        if (f.red > 0) return { tone: 'red', text: f.red === 1 ? 'Un descuento pierde plata' : `${f.red} descuentos pierden plata` };
        if (f.orange > 0) return { tone: 'orange', text: f.orange === 1 ? 'Un descuento bajo el objetivo' : `${f.orange} descuentos bajo el objetivo` };
        return null;
      },
    },
    h('p', { class: 'qe-note' }, 'Tramos según los días facturables del mes. Semáforo: verde mantiene el margen, naranja queda debajo del objetivo, rojo pierde plata.'),
    quote.unit === 'month' ? h('p', { class: 'qe-explain' }, 'Con abono mensual los tramos por cantidad de días no se aplican.') : null,
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

  mount(container, marginCard, taxesCard, priceCard, educational, kit.question('¿Querés ajustar cómo se cobra?', 'Descuentos, redondeo, abonos y mínimos. Si no los usás, dejalos como están: no cambian la tarifa sugerida.', { level: 3 }), pricingOptions, rulesCard, tiersCard);
  return { update() {} };
}
