/**
 * Paso 8 — Financiamiento (capital de trabajo y costo financiero).
 *   días financiados = días hasta facturar + plazo de cobro − días de pago
 *   costo financiero = Σ costo en efectivo × tasa mensual × días financiados / 30
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, banner, table } from '../../components.js';
import { PAY_GROUPS } from '../../../domain/catalogs.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatPercent, formatNumber, formatDays } from '../../../core/format.js';

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
  const { kit } = ctx;

  const missingTerm = kit.toggle(
    banner('Sin el plazo de pago del cliente no se puede calcular el costo financiero. Cargalo aunque sea estimado (por ejemplo 60 o 90 días).', 'danger', { title: 'Falta el plazo de pago.' }),
    (r) => !r.model.finance.paymentTermDefined,
  );

  const termsCard = card(
    { title: 'Cobro del cliente', subtitle: 'Cuánto tarda en entrar la plata desde que prestás el servicio.' },
    missingTerm,
    formGrid(
      3,
      kit.num('finance.paymentTermDays', {
        label: 'Plazo de pago del cliente',
        rule: 'paymentDays',
        unit: 'días',
        requiredMark: true,
        hint: 'Días desde que presentás la factura hasta que cobrás.',
      }),
      kit.num('finance.invoiceLagDays', {
        label: 'Días promedio entre que prestás el servicio y facturás',
        rule: 'paymentDays',
        unit: 'días',
        hint: 'Ej.: si facturás a fin de mes, el promedio es ~15 días.',
      }),
      kit.num('finance.monthlyRatePct', {
        label: 'Tasa de financiamiento mensual',
        rule: 'percent',
        unit: '% mensual',
        illustrative: true,
        hint: 'Lo que te cuesta financiarte (descubierto, adelantos, capital propio). Valor ILUSTRATIVO.',
      }),
    ),
  );

  const payCard = card(
    { title: '¿Cuándo pagás vos?', subtitle: 'Días promedio de pago de cada grupo de costos (0 = al contado).' },
    formGrid(3, ...PAY_GROUPS.map((g) => kit.num(`finance.payDays.${g.id}`, { label: g.label, rule: 'paymentDays', unit: 'días' }))),
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

  const resultsCard = card(
    { title: 'Costo financiero', subtitle: 'Con la actividad estimada. Interés simple sobre los costos que son salida de caja.' },
    kit.stats(
      kit.stat('Capital de trabajo a financiar', (r) => formatMoney(r.kpis.workingCapital), { hint: 'Lo que ponés antes del primer cobro.' }),
      kit.stat('Costo financiero mensual', (r) => formatMoney(r.kpis.financialCost), { emphasis: true, trace: (r) => r.traces.financialCost }),
      kit.stat('Impacto en margen', (r) => (r.kpis.financialMarginImpactPct === null ? 'Sin facturación' : `${formatPercent(r.kpis.financialMarginImpactPct)} (puntos)`), {
        hint: 'Costo financiero ÷ facturación del mes.',
      }),
      kit.stat('Cobro efectivo', (r) => formatDays(r.model.finance.invoiceLagDays + r.model.finance.paymentTermDays), { hint: 'Días hasta facturar + plazo de pago.' }),
    ),
    groupsTable,
    kit.explain('La amortización y el costo de capital de los equipos no son pagos: no se financian. La contingencia tampoco.'),
  );

  mount(container, termsCard, payCard, resultsCard);
  return { update() {} };
}
