/**
 * Etapa 3 · Costos y condiciones — Gastos de estructura (costos indirectos / overhead).
 * Cómo absorbe este servicio una parte de la estructura de la empresa.
 * Básico: el % (o monto) de estructura. Opciones avanzadas (con el método
 * visible en el resumen): método de absorción, qué incluye y detalle.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid } from '../../components.js';
import { INDIRECT_METHODS, labelOf } from '../../../domain/catalogs.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';

const METHOD_HINTS = Object.freeze({
  percent_direct: 'Se suma un % sobre todos los costos directos (personal, equipos, combustible, materiales y logística). Es el método más usado.',
  percent_labor: 'Se suma un % sólo sobre la mano de obra. Útil si la estructura crece con la dotación.',
  per_employee: 'Monto mensual de estructura por cada persona de la dotación de este servicio.',
  per_contract: 'Monto mensual fijo que este contrato tiene que aportar a la estructura.',
  per_hour: 'Monto por cada hora operativa (horas por día activo × días activos).',
  manual: 'Monto mensual de estructura que definís a mano.',
});

const AMOUNT_LABELS = Object.freeze({
  per_employee: ['Monto mensual por empleado', '$/persona/mes'],
  per_contract: ['Monto mensual asignado a este contrato', '$/mes'],
  per_hour: ['Monto por hora operativa', '$/h'],
  manual: ['Monto mensual de estructura', '$/mes'],
});

/** Qué incluye normalmente la estructura de una empresa (orientativo). */
export const STRUCTURE_ITEMS = Object.freeze([
  'Administración',
  'RRHH',
  'Comercial',
  'HSE',
  'Calidad',
  'Sistemas',
  'Contabilidad',
  'Legales',
  'Alquiler de base',
  'Vigilancia',
  'Servicios',
  'Seguros generales',
  'Vehículos administrativos',
]);

const DIRECT_CATEGORIES = ['labor', 'equipment', 'fuel', 'materials', 'logistics'];

function rowOf(result, category) {
  return result.eecc.rows.find((r) => r.category === category) || null;
}

function absorptionAtEstimate(result) {
  const s = result.model.structure;
  const D = result.activity.activeDaysPerMonth;
  return s.fixedMonthly * monthsFactor(D, result.activity.availableDaysPerMonth) + s.variablePerActiveDay * D;
}

function baseOf(result) {
  const method = result.model.structure.method;
  if (method === 'percent_direct') return DIRECT_CATEGORIES.reduce((s, c) => s + (rowOf(result, c) ? rowOf(result, c).amount : 0), 0);
  if (method === 'percent_labor') return rowOf(result, 'labor') ? rowOf(result, 'labor').amount : 0;
  if (method === 'per_employee') return result.model.labor.headcount;
  if (method === 'per_hour') return result.activity.hoursPerActiveDay * result.activity.activeDaysPerMonth;
  return null;
}

function structureTrace(result) {
  const s = result.model.structure;
  const method = s.method;
  const usesPct = method === 'percent_direct' || method === 'percent_labor';
  const formula = {
    percent_direct: 'Estructura = % × costos directos (personal + equipos + combustible + materiales + logística)',
    percent_labor: 'Estructura = % × costo de mano de obra',
    per_employee: 'Estructura = monto por empleado × dotación',
    per_contract: 'Estructura = monto mensual del contrato',
    per_hour: 'Estructura = monto por hora × horas por día activo × días activos',
    manual: 'Estructura = monto mensual manual',
  }[method] || 'Estructura = monto mensual';
  const base = baseOf(result);
  const baseFormat = method === 'per_employee' || method === 'per_hour' ? 'number' : 'money';
  const baseLabel = {
    percent_direct: 'Costos directos del mes',
    percent_labor: 'Mano de obra del mes',
    per_employee: 'Dotación (personas)',
    per_hour: 'Horas operativas del mes',
  }[method];
  return createTrace({
    id: 'structure',
    title: 'Gastos de estructura (costos indirectos)',
    formula,
    inputs: [
      { label: 'Método', value: labelOf(INDIRECT_METHODS, method), format: 'text' },
      usesPct ? { label: 'Porcentaje', value: s.pct, format: 'percent' } : { label: 'Monto', value: s.amount, format: 'money' },
      ...(baseLabel ? [{ label: baseLabel, value: base, format: baseFormat }] : []),
    ],
    result: { label: 'Estructura absorbida en el mes', value: absorptionAtEstimate(result), format: 'money' },
    notes: [
      'Los costos que cargaste como "Otros costos" con categoría Estructura también suman al rubro Gastos de estructura, pero no forman parte de la base de costos directos.',
    ],
  });
}

export function render(container, ctx) {
  const { quote, kit } = ctx;
  const method = INDIRECT_METHODS.find((m) => m.id === quote.indirect.method) || INDIRECT_METHODS[0];

  const valueField = method.uses === 'pct'
    ? kit.num('indirect.pct', {
      label: method.id === 'percent_labor' ? '% de estructura sobre la mano de obra' : '% de estructura sobre el costo directo',
      rule: 'percent',
      unit: '%',
      illustrative: Boolean(quote.illustrative),
      hint: method.id === 'percent_labor'
        ? 'Se suma este % sobre el costo del personal.'
        : 'Se suma este % sobre personal, equipos, combustible, materiales y viajes.',
    })
    : kit.num('indirect.amount', {
      label: (AMOUNT_LABELS[method.id] || AMOUNT_LABELS.manual)[0],
      rule: 'money',
      unit: (AMOUNT_LABELS[method.id] || AMOUNT_LABELS.manual)[1],
      illustrative: Boolean(quote.illustrative),
      hint: METHOD_HINTS[method.id] || null,
    });

  const basicCard = card(
    {},
    formGrid(2, valueField),
    kit.explain('Una forma simple de estimar el %: sumá los gastos mensuales de estructura de tu empresa y dividilos por el costo directo mensual de todos tus servicios.'),
    kit.keyline({
      label: 'Gastos de estructura que absorbe este servicio',
      value: (r) => `${formatMoney(absorptionAtEstimate(r))} por mes`,
      hint: (r) => {
        const row = rowOf(r, 'structure');
        return row ? `${formatPercent(row.displayPct)} del costo total (rubro Gastos de estructura: ${formatMoney(row.amount)}).` : '';
      },
      trace: structureTrace,
    }),
    kit.advanced(
      {
        key: 'indirect',
        summary: (r) => {
          const base = baseOf(r);
          const m = r.model.structure.method;
          let baseText = 'monto fijo';
          if (base !== null) {
            if (m === 'per_employee') baseText = `${formatNumber(base, { decimals: 2 })} personas`;
            else if (m === 'per_hour') baseText = `${formatNumber(base, { decimals: 1 })} h por mes`;
            else baseText = formatMoney(base);
          }
          return `Cómo se reparte: ${labelOf(INDIRECT_METHODS, method.id).toLowerCase()} · base del cálculo: ${baseText}.`;
        },
      },
      kit.choice('indirect.method', {
        label: '¿Cómo le asignás a este servicio una parte de los gastos de la empresa?',
        options: INDIRECT_METHODS.map((m) => ({ value: m.id, label: m.label, hint: METHOD_HINTS[m.id] })),
        structural: true,
      }),
      kit.group(
        '¿Qué incluye la estructura?',
        h('ul', { class: 'qe-chips' }, ...STRUCTURE_ITEMS.map((t) => h('li', { class: 'qe-chip' }, t))),
        h('p', { class: 'qe-note' }, 'Lista orientativa de gastos que normalmente no se ven en una cotización.'),
      ),
      kit.stats(
        kit.stat('Estructura mensual absorbida', (r) => formatMoney(absorptionAtEstimate(r)), { emphasis: true, trace: structureTrace }),
        kit.stat('Rubro Gastos de estructura', (r) => {
          const row = rowOf(r, 'structure');
          return row ? `${formatMoney(row.amount)} · ${formatPercent(row.displayPct)}` : EMPTY;
        }, { hint: 'Monto e incidencia sobre el costo total (incluye otros costos de categoría Estructura).' }),
        kit.stat('Base del cálculo', (r) => {
          const base = baseOf(r);
          const m = r.model.structure.method;
          if (base === null) return 'Monto fijo';
          if (m === 'per_employee') return `${formatNumber(base, { decimals: 2 })} personas`;
          if (m === 'per_hour') return `${formatNumber(base, { decimals: 1 })} h por mes`;
          return formatMoney(base);
        }, { hint: (r) => labelOf(INDIRECT_METHODS, r.model.structure.method) }),
      ),
    ),
  );

  mount(container, basicCard);
  return { update() {} };
}
