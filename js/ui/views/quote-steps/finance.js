/**
 * Etapa 3 · Costos y condiciones — Financiación (capital de trabajo y costo financiero).
 * Básico: plazo de pago del cliente. Opciones avanzadas (con resumen visible,
 * incluida la tasa): días hasta facturar, tasa mensual y días de pago propios.
 *   días financiados = días hasta facturar + plazo de cobro − días de pago
 *   costo financiero = Σ costo en efectivo × tasa mensual × días financiados / 30
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, banner, table } from '../../components.js';
import { PAY_GROUPS } from '../../../domain/catalogs.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatPercent, formatNumber, formatDays } from '../../../core/format.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber } from './shared.js';

function groupsAtEstimate(result) {
  const D = result.activity.activeDaysPerMonth;
  const factor = monthsFactor(D, result.activity.availableDaysPerMonth);
  return result.model.finance.groups.map((g) => ({
    id: g.id,
    label: g.label,
    payDays: g.payDays,
    financingDays: g.financingDays,
    cash: g.cashFixedMonthly * factor + g.cashVariablePerActiveDay * D,
    workingCapital: g.workingCapitalFixed * factor + g.workingCapitalPerActiveDay * D,
    financial: g.financialFixedMonthly * factor + g.financialPerActiveDay * D,
  }));
}

/** "Proveedores (mantenimiento, …)" → título + detalle chico. */
function groupLabel(label) {
  const m = /^([^(]+)\((.+)\)\s*$/.exec(String(label));
  if (!m) return label;
  return h('span', { class: 'qe-group-name' }, h('span', {}, m[1].trim()), h('span', { class: 'muted small' }, m[2]));
}

export function render(container, ctx) {
  const { kit, quote, settings } = ctx;
  const term = quote.finance ? quote.finance.paymentTermDays : null;
  const termEmpty = term === null || term === undefined || term === '';
  const suggested = settings && Number.isFinite(Number(settings.defaultPaymentTermDays)) && settings.defaultPaymentTermDays !== null ? Number(settings.defaultPaymentTermDays) : null;
  const settingsIllustrative = Boolean(settings && settings.illustrative === true);
  // La tasa es ILUSTRATIVA si la cotización es demo o vino de un default/plantilla de demo.
  const rateIllustrative = quote.illustrative === true || Boolean(quote.finance && quote.finance.illustrative === true);
  // Plazo sin cargar (SPEC-02): se sugiere el de Configuración, marcado
  // ILUSTRATIVO si la configuración es la de demostración.
  const termHint = termEmpty && suggested !== null
    ? h(
      'span',
      {},
      `Días desde que presentás la factura hasta que cobrás. Sugerido en Configuración: ${formatNumber(suggested)} días`,
      settingsIllustrative ? illustrativeTag('Valor de la configuración de demostración: confirmalo con tu cliente') : null,
      settingsIllustrative ? ' (confirmalo con tu cliente).' : '.',
    )
    : 'Días desde que presentás la factura hasta que cobrás.';

  // Un solo aviso para el plazo de pago (UX-1): éste, junto al campo. No se
  // repite como "Para revisar" arriba del formulario y no alarma en rojo
  // antes de que hayas escrito algo.
  const missingTerm = kit.toggle(
    banner('Sin el plazo de pago del cliente no se puede calcular el costo financiero. Cargalo aunque sea estimado (por ejemplo 60 o 90 días).', 'warning', { title: 'Falta el plazo de pago.' }),
    (r) => !r.model.finance.paymentTermDefined,
  );

  const rateField = kit.num('finance.monthlyRatePct', {
    label: 'Tasa de financiamiento mensual',
    rule: 'percent',
    unit: '% mensual',
    illustrative: rateIllustrative,
    hint: rateIllustrative
      ? 'Lo que te cuesta financiarte (descubierto, adelantos, capital propio). Valor ILUSTRATIVO: al editarlo se quita la marca.'
      : 'Lo que te cuesta financiarte (descubierto, adelantos, capital propio).',
    onValue: (value, el) => {
      if (!(quote.finance && quote.finance.illustrative === true)) return;
      ctx.update('finance.illustrative', false);
      if (quote.illustrative === true || !el) return;
      el.classList.remove('field-illustrative');
      const tag = el.querySelector('.tag-illustrative');
      if (tag) tag.remove();
    },
  });

  const payText = () => PAY_GROUPS.map((g) => {
    const v = quote.finance && quote.finance.payDays ? quote.finance.payDays[g.id] : null;
    const short = String(g.label).replace(/\s*\(.*\)\s*$/, '').toLowerCase();
    return `${short} a ${hasNumber(v) ? formatNumber(Number(v), { decimals: 1 }) : '0'} días`;
  }).join(', ');

  const termsCard = card(
    {},
    missingTerm,
    termEmpty && suggested !== null && !settingsIllustrative
      ? h(
        'div',
        { class: 'qe-toolbar' },
        kit.action(`Usar el plazo de Configuración (${formatNumber(suggested)} días)`, () => ctx.mutate((q) => {
          q.finance.paymentTermDays = suggested;
        }, { focus: 'finance.paymentTermDays' }), { icon: 'check' }),
      )
      : null,
    formGrid(
      2,
      kit.num('finance.paymentTermDays', {
        label: '¿A cuántos días te paga el cliente?',
        rule: 'paymentDays',
        unit: 'días',
        requiredMark: true,
        placeholder: termEmpty && suggested !== null ? `Ej.: ${formatNumber(suggested)}` : '',
        hint: termHint,
      }),
    ),
    kit.keyline({
      label: 'Costo de financiar el servicio',
      value: (r) => `${formatMoney(r.kpis.financialCost)} por mes`,
      hint: (r) => {
        const impact = r.kpis.financialMarginImpactPct === null ? '' : ` · le resta ${formatPercent(r.kpis.financialMarginImpactPct)} (puntos) al margen`;
        return `Adelantás ${formatMoney(r.kpis.workingCapital)} hasta cobrar (capital de trabajo) · cobrás a ${formatDays(r.model.finance.invoiceLagDays + r.model.finance.paymentTermDays)} de prestar el servicio${impact}.`;
      },
      trace: (r) => r.traces.financialCost,
    }),
    kit.advanced(
      {
        key: 'finance',
        summary: () => {
          const fin = quote.finance || {};
          const rate = hasNumber(fin.monthlyRatePct) ? `Tasa ${formatPercent(Number(fin.monthlyRatePct))} mensual` : 'Tasa sin cargar';
          const lag = `facturás ${hasNumber(fin.invoiceLagDays) ? formatNumber(Number(fin.invoiceLagDays), { decimals: 1 }) : '0'} días después de prestar`;
          return h(
            'span',
            {},
            h('span', { class: 'qe-adv-line' }, `${rate}`, quote.illustrative === true || fin.illustrative === true ? illustrativeTag('Tasa ILUSTRATIVA: confirmala con tu costo de financiamiento') : null, ` · ${lag}.`),
            h('span', { class: 'qe-adv-line' }, `Pagás: ${payText()}.`),
          );
        },
      },
      formGrid(2, kit.num('finance.invoiceLagDays', {
        label: 'Días promedio entre que prestás el servicio y facturás',
        rule: 'paymentDays',
        unit: 'días',
        hint: 'Ej.: si facturás a fin de mes, el promedio es ~15 días.',
      }), rateField),
      kit.group(
        '¿Cuándo pagás vos? (días promedio; 0 = al contado)',
        formGrid(3, ...PAY_GROUPS.map((g) => kit.num(`finance.payDays.${g.id}`, { label: g.label, rule: 'paymentDays', unit: 'días' }))),
      ),
    ),
  );

  const groupsTable = kit.region((r) => {
    const rows = groupsAtEstimate(r);
    const total = rows.reduce((acc, g) => ({ workingCapital: acc.workingCapital + g.workingCapital, financial: acc.financial + g.financial }), { workingCapital: 0, financial: 0 });
    return table({
      caption: 'Capital de trabajo por grupo de pago',
      className: 'qe-finance-table',
      columns: [
        { key: 'label', label: 'Grupo', render: (g) => groupLabel(g.label) },
        { key: 'payDays', label: 'Pagás a (días)', align: 'right', render: (g) => formatNumber(g.payDays, { decimals: 1 }) },
        { key: 'financingDays', label: 'Días financiados', align: 'right', render: (g) => formatNumber(g.financingDays, { decimals: 1 }) },
        { key: 'workingCapital', label: 'Capital de trabajo', align: 'right', format: 'money' },
        { key: 'financial', label: 'Costo financiero', align: 'right', format: 'money' },
      ],
      rows,
      footer: { label: 'Total', payDays: '', financingDays: '', workingCapital: formatMoney(total.workingCapital), financial: formatMoney(total.financial) },
    });
  }, { className: 'qe-region' });

  const detail = kit.advanced(
    {
      key: 'finance-detail',
      title: 'Ver detalle por grupo de costos',
      variant: 'detail',
      boxed: true,
      summary: 'Capital de trabajo y costo financiero de sueldos, combustible, proveedores, materiales y estructura.',
    },
    kit.stats(
      kit.stat('Capital de trabajo a financiar', (r) => formatMoney(r.kpis.workingCapital), { hint: 'Lo que ponés antes del primer cobro.' }),
      kit.stat('Costo financiero mensual', (r) => formatMoney(r.kpis.financialCost), { emphasis: true, trace: (r) => r.traces.financialCost }),
      kit.stat('Impacto en margen', (r) => (r.kpis.financialMarginImpactPct === null ? 'Sin facturación' : `${formatPercent(r.kpis.financialMarginImpactPct)} (puntos)`), {
        hint: 'Costo financiero ÷ facturación del mes.',
      }),
      kit.stat('Cobro efectivo', (r) => formatDays(r.model.finance.invoiceLagDays + r.model.finance.paymentTermDays), { hint: 'Días hasta facturar + plazo de pago.' }),
    ),
    groupsTable,
    kit.explain('Interés simple sobre los costos que son salida de caja. La amortización y el costo de capital de los equipos no son pagos: no se financian. La contingencia tampoco.'),
  );

  mount(container, termsCard, detail);
  return { update() {} };
}
