/**
 * Etapa 4 · El precio — Margen y reglas comerciales.
 * Básico: margen objetivo (sobre el precio). Opciones avanzadas: margen
 * personalizado, descuento comercial, redondeo, tarifa ofrecida, reglas
 * comerciales y tramos de descuento (cada una con un resumen visible).
 *
 * MARGEN (sobre precio) y MARKUP (sobre costo) NO son sinónimos:
 *   costo 100, margen 10 % → precio 111,11 · costo 100, markup 10 % → precio 110
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, emptyState, table, badge, icon } from '../../components.js';
import { RATE_UNITS } from '../../../domain/catalogs.js';
import { priceFromMargin, priceFromMarkup, marginToMarkup, traceMarginVsMarkup } from '../../../engines/pricing-engine.js';
import { tierLabel } from '../../../engines/commercial-rules-engine.js';
import { formatMoney, formatPercent, formatNumber, formatValue, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { createId } from '../../../core/ids.js';
import { perUnitCeil, perUnitMoney, netRateHint, targetRateTrace, confirmRemove, hasNumber } from './shared.js';

const DISCOUNT_STATUS = Object.freeze({
  green: ['Mantiene el margen', 'green'],
  orange: ['Bajo el margen objetivo', 'orange'],
  red: ['Bajo break-even', 'red'],
  unknown: ['Sin tarifa', 'gray'],
});

/** Una regla comercial: título + explicación en una línea + campos + valor calculado. */
function ruleRow(title, explanation, fields, output = null) {
  return h(
    'div',
    { class: 'qe-rule' },
    h('div', { class: 'qe-rule-text' }, h('h4', { class: 'qe-rule-title' }, title), h('p', { class: 'qe-rule-explain' }, explanation), output ? h('div', { class: 'qe-rule-output' }, output) : null),
    h('div', { class: 'qe-rule-fields' }, ...fields),
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
        hint: 'Lo que querés que te quede de cada $ 100 facturados.',
      }),
    ),
    h(
      'div',
      { class: 'qe-tip' },
      icon('info'),
      kit.out((r) => {
        const mk = marginToMarkup(r.targetMarginPct);
        return isFiniteNumber(mk)
          ? `Un margen de ${formatPercent(r.targetMarginPct)} sobre el precio equivale a un markup (recargo sobre el costo) de ${formatPercent(mk)}. No son lo mismo.`
          : 'Definí un margen objetivo válido (de 0 a menos de 100 %).';
      }, { tag: 'p' }),
    ),
    kit.stats(
      kit.stat((r) => `Precio para ganar ${formatPercent(r.targetMarginPct)}`, (r) => perUnitCeil(r.kpis.targetListRate, r.unit), {
        trace: targetRateTrace,
        hint: (r) => {
          const net = netRateHint(r.kpis.targetNetRate, r);
          return `Tarifa de lista, antes de descuentos.${net ? ` ${net}` : ''}`;
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
        hint: (r) => (isFiniteNumber(r.kpis.markupPct) ? `Markup sobre el costo: ${formatPercent(r.kpis.markupPct)}` : ''),
        tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        trace: (r) => r.traces.expectedResult,
      }),
    ),
  );

  // ---------------------------------------------------- margen vs markup
  const educational = kit.advanced(
    {
      key: 'margin-vs-markup',
      title: 'Margen y markup no son lo mismo',
      variant: 'detail',
      boxed: true,
      summary: 'Con un costo de 100: margen 10 % → precio 111,11 · markup 10 % → precio 110. Confundirlos hace cotizar más barato de lo que creés.',
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
    h('p', { class: 'qe-explain' }, 'Con un costo de 100: un margen de 10 % lleva el precio a 111,11; un markup de 10 % lo deja en 110. Con markup de 10 % tu margen real es 9,09 %.'),
    kit.trace(() => traceMarginVsMarkup(100, 10), { label: 'Ver cálculo del ejemplo' }),
  );

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
            : 'tarifa conocida (en "Cómo se cobra")',
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
          label: `Tarifa ofrecida a mano (opcional, de lista, ${unit.label})`,
          rule: 'money',
          unit: unit.label,
          hint: 'Tarifa de lista, antes de descuentos. Si la dejás vacía, se ofrece la tarifa sugerida.',
        })
        : kit.staticField(`Tu tarifa (${unit.label})`, isFiniteNumber(Number(quote.pricing.knownRate)) && Number(quote.pricing.knownRate) > 0 ? formatMoney(Number(quote.pricing.knownRate)) : 'Sin cargar', 'Elegiste "Sí, ya tengo la tarifa": se edita en "Cómo se cobra".'),
    ),
    kit.stat('Tarifa comercial (de lista)', (r) => (r.kpis.commercialSource === 'suggested' ? perUnitCeil(r.kpis.commercialListRate, r.unit) : perUnitMoney(r.kpis.commercialListRate, r.unit)), {
      emphasis: true,
      hint: (r) => (isFiniteNumber(r.kpis.commercialNetRate) ? `Neta después de descuentos: ${formatMoney(r.kpis.commercialNetRate)}` : 'Sin tarifa'),
      trace: (r) => r.traces.expectedResult,
    }),
  );

  // ----------------------------------------------------- reglas comerciales
  const minimumCallUnit = quote.unit === 'hour' ? 'horas' : 'días';
  const RULE_NAMES = [
    ['availabilityFeeMonthly', 'fee de disponibilidad'],
    ['calloutFeePerActivation', 'call-out'],
    ['mobilizationFeePerActivation', 'movilización'],
    ['extraKmRate', 'km adicional'],
    ['minimumCallUnits', 'minimum call'],
    ['minimumMonthlyGuarantee', 'mínimo mensual'],
    ['continuityDiscountPct', 'descuento por continuidad'],
  ];
  const rulesSummary = () => {
    const rules = quote.rules || {};
    const active = RULE_NAMES.filter(([key]) => hasNumber(rules[key]) && Number(rules[key]) > 0).map(([, label]) => label);
    if (rules.standbyNotApplicable === true) active.push('standby: no aplica');
    else if (hasNumber(rules.standbyRatePerDay) && Number(rules.standbyRatePerDay) > 0) active.push('standby');
    else active.push('standby sin definir');
    return `Fees, mínimos, standby y continuidad. Aplicadas: ${active.join(', ')}.`;
  };
  const rulesCard = kit.advanced(
    { key: 'margin-rules', title: 'Reglas comerciales', boxed: true, summary: rulesSummary },
    h('p', { class: 'qe-note' }, 'Cómo se factura el servicio además de la tarifa. Dejá en 0 lo que no aplica.'),
    ruleRow(
      'Fee de disponibilidad',
      'Monto fijo por mes por tener el recurso reservado, se trabaje o no.',
      [kit.num('rules.availabilityFeeMonthly', { label: 'Fee mensual', rule: 'money', unit: '$/mes' })],
    ),
    ruleRow(
      'Call-out fee',
      'Monto fijo que se cobra cada vez que el cliente llama (activación).',
      [kit.num('rules.calloutFeePerActivation', { label: 'Por activación', rule: 'money', unit: '$' })],
    ),
    ruleRow(
      'Movilización',
      'Cobro por llevar los recursos a la locación en cada activación.',
      [kit.num('rules.mobilizationFeePerActivation', { label: 'Por activación', rule: 'money', unit: '$' })],
    ),
    ruleRow(
      'Km incluidos y km adicional',
      'Los km de ruta de cada activación que superen los incluidos se cobran aparte.',
      [
        kit.num('rules.includedKmPerActivation', { label: 'Km incluidos por activación', rule: 'distance', unit: 'km' }),
        kit.num('rules.extraKmRate', { label: '$ por km adicional', rule: 'money', unit: '$/km' }),
      ],
      kit.out((r) => {
        const rev = r.estimate.revenue;
        const route = formatValue(r.model.logistics.routeKmPerActivation, 'km');
        if (!(rev.components.extraKm > 0)) return `Km de ruta por activación: ${route}. Cargá un $ por km para cobrar los que superen los incluidos.`;
        return `Se cobran ${formatValue(rev.extraKmPerActivation, 'km')} adicionales por activación (de ${route} de ruta): ${formatMoney(rev.components.extraKm)} por mes.`;
      }),
    ),
    ruleRow(
      'Minimum call',
      quote.unit === 'month'
        ? 'Con abono mensual no aplica: la facturación no depende de las activaciones.'
        : `Mínimo de ${minimumCallUnit} facturables por activación, aunque se trabaje menos.`,
      [kit.num('rules.minimumCallUnits', { label: `Mínimo por activación (${minimumCallUnit})`, rule: 'quantity', unit: minimumCallUnit })],
      kit.out((r) => (r.estimate.revenue.minimumCallApplied ? 'Se está aplicando: suma unidades facturables.' : 'Hoy no cambia la facturación (cada activación ya supera el mínimo).')),
    ),
    ruleRow(
      'Standby',
      'Días por mes que el equipo queda en locación sin operar y se cobran a tarifa standby. El personal en standby también es costo.',
      [
        kit.num('rules.standbyDaysPerMonth', {
          label: 'Días de standby por mes',
          rule: 'daysInMonth',
          unit: 'días',
          disabled: standbyOff,
          hint: standbyOff ? 'No se usa: marcaste "No aplica standby".' : null,
        }),
        kit.num('rules.standbyRatePerDay', {
          label: 'Tarifa standby',
          rule: 'money',
          unit: '$/día',
          disabled: standbyOff,
          hint: standbyOff ? 'No se usa: marcaste "No aplica standby".' : null,
        }),
        kit.check('rules.standbyNotApplicable', {
          label: 'No aplica standby',
          structural: true,
          hint: 'Marcalo si el servicio no tiene standby: los días y la tarifa de standby no se usan (ingreso y costo de standby en $ 0).',
        }),
      ],
      kit.out((r) => (standbyOff
        ? 'No aplica standby: los días y la tarifa de standby cargados no se usan. Ingreso y costo de standby: $ 0.'
        : `Ingreso por standby: ${formatMoney(r.estimate.revenue.components.standby)} · costo de personal en standby: ${formatMoney(r.model.standby.monthly)} por mes.`)),
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
    const [text, tone] = DISCOUNT_STATUS[d.status] || DISCOUNT_STATUS.unknown;
    return h(
      'span',
      { class: 'qe-tier-eval' },
      badge(text, tone),
      h('span', { class: 'muted small mono' }, isFiniteNumber(d.marginPct) ? `Margen ${formatPercent(d.marginPct)} con ${formatNumber(d.evaluatedDays)} ${d.evaluatedDays === 1 ? 'día' : 'días'}` : EMPTY),
    );
  };

  const tiersSummary = (r) => {
    const withDiscount = tiers.filter((t) => hasNumber(t.discountPct) && Number(t.discountPct) > 0);
    if (withDiscount.length === 0) return `${tiers.length} ${tiers.length === 1 ? 'tramo' : 'tramos'}, ninguno con descuento.`;
    const list = withDiscount.map((t) => `${tierLabel(t)}: ${formatPercent(Number(t.discountPct))}`).join(' · ');
    const statuses = (r.discounts || []).map((d) => d.status);
    const warn = statuses.includes('red') ? ' Alguno pierde plata.' : statuses.includes('orange') ? ' Alguno queda debajo del margen objetivo.' : '';
    return `${withDiscount.length} ${withDiscount.length === 1 ? 'tramo' : 'tramos'} con descuento (${list}).${warn}`;
  };
  const tiersCard = kit.advanced(
    {
      key: 'margin-tiers',
      title: 'Descuentos por cantidad de días',
      boxed: true,
      summary: tiersSummary,
      flag: (r) => {
        const statuses = (r.discounts || []).map((d) => d.status);
        if (statuses.includes('red')) return { tone: 'red', text: 'Un tramo pierde plata' };
        if (statuses.includes('orange')) return { tone: 'orange', text: 'Debajo del objetivo' };
        return null;
      },
    },
    h('p', { class: 'qe-note' }, 'Tramos según los días facturables del mes. Semáforo: verde mantiene el margen, naranja queda debajo del objetivo, rojo pierde dinero.'),
    quote.unit === 'month' ? h('p', { class: 'qe-explain' }, 'Con abono mensual los tramos por cantidad de días no se aplican.') : null,
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

  mount(container, marginCard, educational, kit.question('¿Querés ajustar cómo se cobra?', 'Descuentos, redondeo, fees y mínimos. Si no los usás, dejalos como están: no cambian la tarifa sugerida.', { level: 3 }), pricingOptions, rulesCard, tiersCard);
  return { update() {} };
}
