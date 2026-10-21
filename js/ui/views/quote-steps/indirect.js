/**
 * Etapa 3 · Costos y condiciones — Gastos de estructura (costos indirectos / overhead).
 * Cómo absorbe este servicio una parte de la estructura de la empresa.
 * Modo simple (el de siempre): el % (o monto) de estructura con un método.
 * Desglosar estructura (PLAN-2026-010, opcional): cada rubro con su propio
 * método (administración % directo, HSE por empleado, alquiler de base por
 * contrato…), con una política de la empresa que se guarda en Configuración
 * y se reutiliza. Cambiar la política nunca cambia cotizaciones hechas.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, table, emptyState, confirmDialog, choiceGroup } from '../../components.js';
import { createId } from '../../../core/ids.js';
import { INDIRECT_METHODS, labelOf } from '../../../domain/catalogs.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { stepName } from './shared.js';

/**
 * Impuestos sobre lo que facturás ≠ gastos de estructura (PLAN-2026-012).
 * RATEOS no trae alícuotas: sólo evita que el mismo impuesto se cargue en
 * las dos capas (como rubro de estructura y como impuesto sobre la facturación).
 */
const BILLING_TAX_WORDS = /ingresos\s+brutos|\biibb\b|impuesto\s+al\s+cheque|d[eé]bitos?\s+y\s+cr[eé]ditos|\bsellos\b|impuestos?\s+sobre\s+(la\s+)?factura/i;

/** ¿El nombre de un rubro parece un impuesto sobre la facturación? */
export function looksLikeBillingTax(label) {
  return BILLING_TAX_WORDS.test(String(label || ''));
}

function taxesNote() {
  return h('p', { class: 'qe-note' }, `No incluyas acá Ingresos Brutos, el impuesto al cheque ni sellos: son impuestos sobre lo que facturás y van en "${stepName('margin')}" → Impuestos sobre lo que facturás. Cargados en los dos lados se cuentan dos veces.`);
}

const METHOD_HINTS = Object.freeze({
  percent_direct: 'Se suma un % sobre todos los costos directos (personal, equipos, combustible, materiales y logística). Es un método simple, una forma práctica de empezar.',
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
  // Dotación equivalente (una persona compartida cuenta por su %), igual que el motor (PLAN-2026-012).
  if (method === 'per_employee') return result.model.labor.effectiveHeadcount ?? result.model.labor.headcount;
  if (method === 'per_hour') return result.activity.hoursPerActiveDay * result.activity.activeDaysPerMonth;
  return null;
}

function structureTrace(result) {
  const s = result.model.structure;
  if (s.mode === 'detailed') {
    const D = result.activity.activeDaysPerMonth;
    const f = monthsFactor(D, result.activity.availableDaysPerMonth);
    return createTrace({
      id: 'structure',
      title: 'Gastos de estructura (desglosados por rubro)',
      formula: 'Estructura = Σ rubros · cada rubro con su método (% sobre costo directo, % sobre mano de obra, por empleado, por contrato, por hora o manual)',
      inputs: s.items.map((it) => ({ label: `${it.label} (${labelOf(INDIRECT_METHODS, it.method).toLowerCase()})`, value: (INDIRECT_METHODS.find((m) => m.id === it.method) || {}).uses === 'pct' ? it.pct : it.amount, format: (INDIRECT_METHODS.find((m) => m.id === it.method) || {}).uses === 'pct' ? 'percent' : 'money' })),
      steps: s.items.map((it) => ({ label: `${it.label}: en el mes`, value: it.fixedMonthly * f + it.variablePerActiveDay * D, format: 'money' })),
      result: { label: 'Estructura absorbida en el mes', value: absorptionAtEstimate(result), format: 'money' },
      notes: ['Los costos que cargaste como "Otros costos" con categoría Estructura también suman al rubro Gastos de estructura, pero no forman parte de la base de costos directos.'],
    });
  }
  const method = s.method;
  const usesPct = method === 'percent_direct' || method === 'percent_labor';
  const formula = {
    percent_direct: 'Estructura = % × costos directos (personal + equipos + combustible + materiales + logística)',
    percent_labor: 'Estructura = % × costo de mano de obra',
    per_employee: 'Estructura = monto por empleado × dotación (una persona compartida cuenta por el % asignado)',
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

/** Rubro de estructura nuevo. */
function structureItem(label, method = 'percent_direct', pct = 0, amount = 0) {
  return { id: `str-${createId().slice(0, 8)}`, label, method, pct, amount };
}

/** Copia limpia de los rubros (para guardar como política o traerla). */
function cleanItems(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && typeof it === 'object').map((it) => ({
    id: `str-${createId().slice(0, 8)}`,
    label: typeof it.label === 'string' ? it.label.slice(0, 80) : 'Rubro',
    method: INDIRECT_METHODS.some((m) => m.id === it.method) ? it.method : 'percent_direct',
    pct: Number.isFinite(Number(it.pct)) ? Number(it.pct) : 0,
    amount: Number.isFinite(Number(it.amount)) ? Number(it.amount) : 0,
  }));
}

/** Desglose de la estructura por rubro (PLAN-2026-010). */
function detailedCard(ctx) {
  const { quote, kit, settings } = ctx;
  const items = Array.isArray(quote.indirect.items) ? quote.indirect.items : [];
  const policy = settings && settings.indirectPolicy && Array.isArray(settings.indirectPolicy.items) ? settings.indirectPolicy.items : [];
  const add = () => ctx.mutate((q) => {
    q.indirect.items = Array.isArray(q.indirect.items) ? q.indirect.items : [];
    q.indirect.items.push(structureItem('Nuevo rubro'));
  }, { focus: `indirect.items.${items.length}.label` });
  const remove = (j) => ctx.mutate((q) => {
    q.indirect.items.splice(j, 1);
  });
  const usePolicy = async () => {
    if (items.length) {
      const ok = await confirmDialog({ title: 'Usar la política de tu empresa', message: `Se reemplazan los ${items.length} rubros de esta cotización por los ${policy.length} de la política de tu empresa.`, confirmLabel: 'Reemplazar' });
      if (!ok) return;
    }
    ctx.mutate((q) => {
      q.indirect.items = cleanItems(policy);
    });
    ctx.toast('Se copió la política de estructura de tu empresa en esta cotización. Si después cambia, esta cotización no cambia sola.', 'success');
  };
  const savePolicy = async () => {
    const service = ctx.app && ctx.app.ctx && ctx.app.ctx.settings;
    if (!service || typeof service.save !== 'function') return;
    const ok = await confirmDialog({ title: 'Guardar como política de la empresa', message: `Se guardan estos ${items.length} rubros como política de estructura de tu empresa, para reutilizarla en otras cotizaciones. Las cotizaciones hechas no cambian.`, confirmLabel: 'Guardar' });
    if (!ok) return;
    try {
      const indirectPolicy = { items: cleanItems(items) };
      await service.save({ indirectPolicy });
      if (settings) settings.indirectPolicy = indirectPolicy;
      ctx.toast('Política de estructura guardada en la configuración de tu empresa.', 'success');
      ctx.rerender();
    } catch {
      ctx.toast('No se pudo guardar la política. Probá de nuevo.', 'danger');
    }
  };
  const rowsTable = items.length
    ? table({
      // Una tarjeta por rubro cuando no entra como tabla (celular y tablet); en escritorio sigue tabla (DESIGN-02 2/2).
      className: 'qe-edit-table qe-stack-narrow',
      caption: 'Rubros de estructura',
      columns: [
        { key: 'label', label: 'Rubro', render: (row, j) => kit.text(`indirect.items.${j}.label`, { label: 'Rubro', maxLength: 80 }) },
        { key: 'method', label: 'Cómo se asigna', render: (row, j) => kit.select(`indirect.items.${j}.method`, { label: 'Cómo se asigna', options: INDIRECT_METHODS.map((m) => ({ value: m.id, label: m.label })), structural: true }) },
        {
          key: 'value',
          label: 'Valor',
          render: (row, j) => ((INDIRECT_METHODS.find((m) => m.id === row.method) || INDIRECT_METHODS[0]).uses === 'pct'
            ? kit.num(`indirect.items.${j}.pct`, { label: '%', rule: 'percent', unit: '%' })
            : kit.num(`indirect.items.${j}.amount`, { label: (AMOUNT_LABELS[row.method] || AMOUNT_LABELS.manual)[0], rule: 'money', unit: (AMOUNT_LABELS[row.method] || AMOUNT_LABELS.manual)[1] })),
        },
        {
          key: 'month',
          label: 'En el mes',
          align: 'right',
          className: 'qe-col-calc',
          render: (row, j) => kit.out((r) => {
            const it = r.model.structure.items[j];
            if (!it) return EMPTY;
            const D = r.activity.activeDaysPerMonth;
            return formatMoney(it.fixedMonthly * monthsFactor(D, r.activity.availableDaysPerMonth) + it.variablePerActiveDay * D);
          }),
        },
        { key: 'remove', label: '', className: 'qe-col-remove', render: (row, j) => kit.action('', () => remove(j), { variant: 'ghost', icon: 'trash', title: 'Quitar rubro' }) },
      ],
      rows: items,
    })
    : emptyState('Todavía no hay rubros. Agregá uno o usá la política de tu empresa.');
  // Un rubro que parece un impuesto sobre la facturación (PLAN-2026-012): se avisa, no se corrige solo.
  const taxLike = kit.out((r) => {
    const names = items.filter((it) => it && looksLikeBillingTax(it.label)).map((it) => `"${String(it.label).trim()}"`);
    if (!names.length) return '';
    const both = r && r.kpis && r.kpis.billingTaxesDefined && r.kpis.billingTaxPct > 0;
    return h('p', { class: 'qe-warn' }, both
      ? `Posible doble conteo: ${names.join(', ')} parece un impuesto sobre la facturación y además cargaste ${formatPercent(r.kpis.billingTaxPct)} en "${stepName('margin')}". Dejalo en un solo lugar.`
      : `${names.join(', ')} parece un impuesto sobre la facturación: se calcula mejor sobre lo que facturás, en "${stepName('margin')}" → Impuestos sobre lo que facturás (no como % del costo).`);
  }, { tag: 'div', allowEmpty: true });
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'qe-note' }, 'Cada rubro con su propio criterio (por ejemplo: administración como % del costo directo, HSE y sistemas por empleado, alquiler de base por contrato). Los porcentajes y montos son tuyos: RATEOS no trae valores.'),
    taxesNote(),
    rowsTable,
    taxLike,
    h(
      'div',
      { class: 'qe-toolbar' },
      kit.action('Agregar rubro', add, { icon: 'plus' }),
      policy.length ? kit.action(`Usar la política de mi empresa (${policy.length} ${policy.length === 1 ? 'rubro' : 'rubros'})`, usePolicy, { icon: 'check' }) : null,
      items.length ? kit.action('Guardar como política de la empresa', savePolicy, { icon: 'check' }) : null,
    ),
  );
}

export function render(container, ctx) {
  const { quote, kit } = ctx;
  const method = INDIRECT_METHODS.find((m) => m.id === quote.indirect.method) || INDIRECT_METHODS[0];
  const detailed = quote.indirect.mode === 'detailed';

  /** Modo simple ↔ desglosado. Al desglosar por primera vez, el primer rubro replica el modo simple (mismo monto). */
  const modeWrap = choiceGroup({
    label: '¿Cómo cargás la estructura?',
    name: 'indirect.mode',
    value: detailed ? 'detailed' : 'simple',
    disabled: kit.readOnly,
    options: [
      { value: 'simple', label: 'Simple (un método para toda la estructura)', hint: 'El de siempre: un % o un monto.' },
      { value: 'detailed', label: 'Desglosar estructura', hint: 'Cada rubro con su propio criterio (administración, HSE, sistemas, alquiler de base…).' },
    ],
    onChange: (value) => ctx.mutate((q) => {
      q.indirect.mode = value === 'detailed' ? 'detailed' : 'simple';
      if (q.indirect.mode === 'detailed' && !(Array.isArray(q.indirect.items) && q.indirect.items.length)) {
        q.indirect.items = [structureItem('Estructura general', q.indirect.method || 'percent_direct', Number(q.indirect.pct) || 0, Number(q.indirect.amount) || 0)];
      }
    }),
  });
  if (detailed) {
    mount(container, card({}, modeWrap, detailedCard(ctx), kit.keyline({
      label: 'Gastos de estructura que absorbe este servicio',
      value: (r) => `${formatMoney(absorptionAtEstimate(r))} por mes`,
      hint: (r) => {
        const row = rowOf(r, 'structure');
        return row ? `${formatPercent(row.displayPct)} del costo total (rubro Gastos de estructura: ${formatMoney(row.amount)}).` : '';
      },
      trace: structureTrace,
    })));
    return { update() {} };
  }

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
    modeWrap,
    formGrid(2, valueField),
    kit.explain('Una forma simple de estimar el %: sumá los gastos mensuales de estructura de tu empresa y dividilos por el costo directo mensual de todos tus servicios.'),
    taxesNote(),
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
