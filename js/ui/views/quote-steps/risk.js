/**
 * Etapa 3 · Las condiciones — Imprevistos (riesgo / contingencia).
 * Básico: contingencia general %. Opciones avanzadas (con resumen visible de
 * los riesgos marcados): checklist de riesgos con su %.
 *   contingencia % = general % + Σ % de riesgos marcados
 *   contingencia $ = % × (directos + estructura + financiero)
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, checkboxField } from '../../components.js';
import { RISK_ITEMS } from '../../../domain/catalogs.js';
import { contingencyPctOf, monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatPercent, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { nonNegative } from '../../../core/money.js';
import { illustrativeTag } from '../../layout.js';

const RISK_HINTS = Object.freeze({
  activity_variation: 'Que se trabaje menos días que lo estimado.',
  unproductive: 'Horas pagas sin producción (esperas, permisos).',
  weather: 'Viento, nieve o lluvia que frenan la operación.',
  rework: 'Trabajos que hay que repetir.',
  equipment_failure: 'Roturas y reparaciones no previstas.',
  prices: 'Suba de insumos, repuestos o servicios.',
  inflation: 'Pérdida de valor entre cotizar y cobrar.',
  logistics: 'Demoras o desvíos en los traslados.',
  penalties: 'Multas o descuentos del contrato.',
  warranty: 'Reclamos y trabajos en garantía.',
  accidents: 'Incidentes con personas o equipos.',
  scope_uncertainty: 'Alcance poco definido por el cliente.',
});

function contingencyTrace(result, quote) {
  const m = result.model;
  const D = result.activity.activeDaysPerMonth;
  const factor = monthsFactor(D, result.activity.availableDaysPerMonth);
  const row = result.eecc.rows.find((r) => r.category === 'contingency');
  const base = (m.fixedMonthly - m.contingency.fixedMonthly) * factor + (m.variablePerActiveDay - m.contingency.variablePerActiveDay) * D;
  const items = (quote.risk.items || []).filter((i) => i && i.enabled);
  return createTrace({
    id: 'contingency',
    title: 'Contingencia',
    formula: 'Contingencia % = general % + Σ % de riesgos marcados · Contingencia $ = % × (costos directos + estructura + financiero)',
    inputs: [
      { label: 'Contingencia general', value: nonNegative(quote.risk.generalPct), format: 'percent' },
      ...items.map((i) => ({ label: i.label || i.id, value: nonNegative(i.pct), format: 'percent' })),
      { label: 'Base (costo sin contingencia)', value: base, format: 'money' },
    ],
    steps: [{ label: 'Contingencia total', value: m.contingency.pct, format: 'percent' }],
    result: { label: 'Contingencia del mes', value: row ? row.amount : null, format: 'money' },
    notes: ['La contingencia es una reserva para imprevistos: no se financia.'],
  });
}

export function render(container, ctx) {
  const { quote, kit, settings } = ctx;
  // Con la configuración de demostración la contingencia arranca en 0 (no se
  // da por definida): se muestra el valor sugerido, marcado ILUSTRATIVO.
  const suggested = settings && Number(settings.defaultContingencyPct) > 0 ? Number(settings.defaultContingencyPct) : null;
  const unset = !(nonNegative(quote.risk && quote.risk.generalPct) > 0);
  const generalHint = unset && suggested !== null
    ? h(
      'span',
      {},
      `Se aplica sobre el costo directo + estructura + financiero. Sugerida en Configuración: ${formatPercent(suggested)}`,
      settings.illustrative === true ? illustrativeTag('Valor de la configuración de demostración') : null,
      '.',
    )
    : 'Se aplica sobre el costo directo + estructura + financiero.';

  const rows = RISK_ITEMS.map((item) => {
    const index = quote.risk.items.findIndex((r) => r && r.id === item.id);
    if (index < 0) return null;
    const p = `risk.items.${index}`;
    const row = h(
      'div',
      { class: 'qe-risk-row' },
      checkboxField({
        label: item.label,
        name: `${p}.enabled`,
        checked: Boolean(quote.risk.items[index].enabled),
        hint: RISK_HINTS[item.id] || null,
        onChange: (checked) => {
          ctx.update(`${p}.enabled`, Boolean(checked));
          row.classList.toggle('is-on', Boolean(checked));
        },
      }),
      kit.num(`${p}.pct`, { label: `% por ${item.label.toLowerCase()}`, rule: 'percent', unit: '%' }),
    );
    row.classList.toggle('is-on', Boolean(quote.risk.items[index].enabled));
    return row;
  });

  const riskSummary = () => {
    const on = (quote.risk.items || []).filter((i) => i && i.enabled);
    if (on.length === 0) return 'No marcaste riesgos puntuales: sólo cuenta la contingencia general.';
    const list = on.map((i) => `${String(i.label || i.id).toLowerCase()} ${formatPercent(nonNegative(i.pct))}`).join(', ');
    return `${on.length} ${on.length === 1 ? 'riesgo marcado' : 'riesgos marcados'}: ${list}.`;
  };

  const card1 = card(
    {},
    formGrid(2, kit.num('risk.generalPct', { label: 'Contingencia general', rule: 'percent', unit: '%', hint: generalHint })),
    kit.keyline({
      label: 'Imprevistos en el costo del mes',
      value: (r) => {
        const row = r.eecc.rows.find((x) => x.category === 'contingency');
        return row ? formatMoney(row.amount) : EMPTY;
      },
      hint: (r) => {
        const row = r.eecc.rows.find((x) => x.category === 'contingency');
        const share = row ? ` · ${formatPercent(row.displayPct)} del costo total` : '';
        return `Contingencia total ${formatPercent(contingencyPctOf(quote.risk))} (general + riesgos marcados)${share}.`;
      },
      trace: (r) => contingencyTrace(r, quote),
    }),
    kit.advanced(
      { key: 'risk', title: 'Opciones avanzadas: riesgos puntuales', summary: riskSummary },
      h('p', { class: 'qe-note' }, 'Marcá los riesgos que aplican y asignales un %. Sólo suman los marcados.'),
      h('div', { class: 'qe-risk-list' }, ...rows),
      kit.stats(
        kit.stat('Contingencia total', () => formatPercent(contingencyPctOf(quote.risk)), { hint: 'General + riesgos marcados.' }),
        kit.stat('Monto mensual', (r) => {
          const row = r.eecc.rows.find((x) => x.category === 'contingency');
          return row ? formatMoney(row.amount) : EMPTY;
        }, { emphasis: true, trace: (r) => contingencyTrace(r, quote) }),
        kit.stat('Incidencia en el costo total', (r) => {
          const row = r.eecc.rows.find((x) => x.category === 'contingency');
          return row ? formatPercent(row.displayPct) : EMPTY;
        }),
      ),
    ),
  );

  mount(container, card1);
  return { update() {} };
}
