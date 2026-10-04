/**
 * Etapa 2 · Los recursos — Materiales y otros costos directos.
 * Básico: descripción, cantidad, costo unitario y quién lo provee.
 * Opciones avanzadas (con resumen visible): base, unidad, merma, logística y
 * markup de reventa (recargo sobre el costo del material: no es margen).
 *   costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%)
 *   (si lo provee el cliente, no es costo nuestro; el markup de reventa es informativo)
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, emptyState, table } from '../../components.js';
import { MATERIAL_BASES, MATERIAL_PROVIDERS, COST_BEHAVIORS, COST_CATEGORIES, DIRECT_CATEGORY_IDS } from '../../../domain/catalogs.js';
import { materialLineFromLibrary, createOtherCost } from '../../../domain/quote-factory.js';
import { formatMoney, formatPercent, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, hasNumber } from './shared.js';

/** Grilla de la línea de material: la descripción más ancha que los números. */
function materialGrid(...fields) {
  const grid = formGrid(4, ...fields);
  grid.classList.add('qe-material-grid');
  return grid;
}

const BASIS_SHORT = Object.freeze({ per_month: 'por mes', per_active_day: 'por día activo', per_activation: 'por llamado' });

function splitLabel(line) {
  if (!line) return EMPTY;
  if (line.fixedMonthly > 0) return `${formatMoney(line.fixedMonthly)} fijo / mes`;
  if (line.variablePerActiveDay > 0) return `${formatMoney(line.variablePerActiveDay)} / día activo`;
  return formatMoney(0);
}

function materialsTrace(result) {
  const lines = result.model.materials.lines;
  const row = result.eecc.rows.find((r) => r.category === 'materials');
  return createTrace({
    id: 'materials',
    title: 'Materiales',
    formula: 'Costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%) · Por mes → fijo; por día activo → variable; por llamado → variable ÷ días por llamado · Si lo provee el cliente, no es costo nuestro',
    inputs: lines.map((l) => ({ label: `${l.description || 'Material'} (${BASIS_SHORT[l.basis] || l.basis})`, value: l.costForUs, format: 'money' })),
    steps: [
      { label: 'Fijo mensual de materiales', value: result.model.materials.fixedMonthly, format: 'money' },
      { label: 'Variable por día activo', value: result.model.materials.variablePerActiveDay, format: 'money' },
      { label: 'Días activos', value: result.activity.activeDaysPerMonth, format: 'days' },
    ],
    result: { label: 'Materiales en la estructura de costos (incluye otros costos de categoría Materiales)', value: row ? row.amount : null, format: 'money' },
    notes: ['El precio de reventa con markup es sólo informativo: sirve si facturás materiales aparte. No cambia el costo.'],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const library = Array.isArray(resources.materials) ? resources.materials : [];
  const notApplicable = Boolean(quote.materialsNotApplicable);

  let selectedId = null;
  const addFromLibrary = () => {
    const mat = library.find((m) => m.id === selectedId);
    if (!mat) {
      ctx.toast('Elegí un material de la biblioteca para agregarlo.', 'warning');
      return;
    }
    const line = materialLineFromLibrary(mat);
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.quantity` });
  };
  const addBlank = () => {
    const line = materialLineFromLibrary({});
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.description` });
  };
  const removeMaterial = async (index) => {
    const line = quote.materials[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar material', name: line.description || 'Material' });
    if (ok) ctx.mutate((q) => q.materials.splice(index, 1));
  };

  const toggleCard = card(
    {},
    kit.check('materialsNotApplicable', { label: 'El servicio no usa materiales', structural: true, hint: 'Marcalo para confirmar que no te olvidaste de cargarlos.' }),
  );

  const basisLabel = (id) => (MATERIAL_BASES.find((b) => b.id === id) || { label: 'sin base' }).label.toLowerCase();

  const materialCards = notApplicable
    ? []
    : quote.materials.map((line, i) => {
      const p = `materials.${i}`;
      const at = (r) => r.model.materials.lines[i];
      // Valores copiados de una plantilla o material de demostración (UX-02).
      const ill = kit.lineIllustrative(p, { what: 'este material' });
      const illustrative = ill.marked;
      return kit.lineCard(
        {
          title: kit.out(() => (quote.materials[i] && quote.materials[i].description) || 'Material sin descripción'),
          badges: ill.tag ? [ill.tag] : [],
          actions: [kit.action('Quitar', () => removeMaterial(i), { variant: 'danger', icon: 'trash' })],
          className: 'qe-line-compact',
        },
        ill.control,
        materialGrid(
          kit.text(`${p}.description`, { label: 'Descripción', maxLength: 160 }),
          kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', hint: kit.out(() => `${basisLabel(quote.materials[i] && quote.materials[i].basis)} (se cambia en opciones avanzadas)`) }),
          kit.num(`${p}.unitCost`, { label: 'Costo unitario (sin IVA)', rule: 'money', unit: '$', illustrative }),
          kit.select(`${p}.providedBy`, {
            label: '¿Quién lo provee?',
            options: MATERIAL_PROVIDERS.map((m) => ({ value: m.id, label: m.label })),
            includeEmpty: true,
            emptyLabel: 'Elegí quién lo provee…',
          }),
        ),
        kit.keyline({
          label: 'Costo para vos',
          value: (r) => formatMoney(at(r) && at(r).costForUs),
          hint: (r) => {
            const l = at(r);
            if (!l) return '';
            if (!l.providedBy) return 'Falta definir quién lo provee.';
            if (l.costForUs === 0 && l.grossCost > 0) return 'Lo provee el cliente: no es costo tuyo.';
            return `${BASIS_SHORT[l.basis] || ''} · en el mes: ${splitLabel(l)}`;
          },
          tone: (r) => (at(r) && !at(r).providedBy ? 'red' : null),
        }),
        kit.advanced(
          {
            key: `materials:${line.id || i}`,
            summary: () => {
              const m = quote.materials[i] || {};
              const parts = [
                `se cuenta ${basisLabel(m.basis)}`,
                `unidad: ${String(m.unit || '').trim() || 'sin unidad'}`,
                `merma ${hasNumber(m.wastePct) ? formatPercent(Number(m.wastePct)) : '0 %'}`,
                `logística ${hasNumber(m.logisticsPct) ? formatPercent(Number(m.logisticsPct)) : '0 %'}`,
                hasNumber(m.resaleMarkupPct) && Number(m.resaleMarkupPct) > 0 ? `markup de reventa ${formatPercent(Number(m.resaleMarkupPct))}` : null,
              ].filter(Boolean).join(' · ');
              return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}.`;
            },
          },
          formGrid(
            3,
            kit.select(`${p}.basis`, { label: '¿Cada cuánto se consume?', options: MATERIAL_BASES.map((b) => ({ value: b.id, label: b.label })) }),
            kit.text(`${p}.unit`, { label: 'Unidad', maxLength: 30, placeholder: 'kit, kg, m, unidad' }),
            kit.num(`${p}.wastePct`, { label: 'Merma', rule: 'percent', unit: '%', illustrative, hint: 'Lo que se pierde o desperdicia.' }),
            kit.num(`${p}.logisticsPct`, { label: 'Logística', rule: 'percent', unit: '%', illustrative, hint: 'Flete y manipuleo del material.' }),
            kit.num(`${p}.resaleMarkupPct`, { label: 'Markup de reventa', rule: 'percentOpen', unit: '%', hint: 'Recargo sobre el costo del material (no es margen). Sólo informativo, si facturás materiales aparte.' }),
          ),
          kit.stats(
            kit.stat('Fijo mensual / variable por día', (r) => splitLabel(at(r))),
            kit.stat('Precio de reventa (informativo)', (r) => formatMoney(at(r) && at(r).resalePrice), { hint: 'Costo × (1 + markup). No es margen.' }),
          ),
        ),
      );
    });

  const materialsSection = notApplicable
    ? null
    : h(
      'div',
      { class: 'stack' },
      card(
        {},
        h(
          'div',
          { class: 'qe-toolbar' },
          h(
            'div',
            { class: 'qe-toolbar-pick' },
            selectField({
              label: 'Agregar desde tus recursos de materiales',
              value: null,
              includeEmpty: true,
              emptyLabel: library.length ? 'Elegí un material…' : 'Todavía no cargaste materiales',
              options: library.map((m) => ({ value: m.id, label: m.description })),
              onChange: (v) => {
                selectedId = v;
              },
            }),
            kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
          ),
          kit.action('Agregar material en blanco', addBlank, { icon: 'plus', size: 'md' }),
        ),
      ),
      materialCards.length
        ? h('div', { class: 'qe-lines' }, ...materialCards)
        : emptyState({
          title: 'Todavía no cargaste materiales.',
          text: 'Agregá los insumos que se consumen al prestar el servicio. Si no usa materiales, marcá la casilla de arriba.',
          icon: 'resources',
        }),
    );

  // ------------------------------------------------- otros costos directos
  const categoryOptions = COST_CATEGORIES.filter((c) => DIRECT_CATEGORY_IDS.includes(c.id)).map((c) => ({ value: c.id, label: c.label }));
  const behaviorOptions = COST_BEHAVIORS.map((b) => ({ value: b.id, label: b.label }));
  const addOther = () => {
    const index = quote.otherCosts.length;
    ctx.mutate((q) => q.otherCosts.push(createOtherCost()), { focus: `otherCosts.${index}.description` });
  };
  const removeOther = async (index) => {
    const line = quote.otherCosts[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar costo', name: line.description || 'Otro costo', extra: '' });
    if (ok) ctx.mutate((q) => q.otherCosts.splice(index, 1));
  };

  // Marca ILUSTRATIVO por línea (copiadas de una plantilla de demostración).
  const otherIll = quote.otherCosts.map((row, i) => kit.lineIllustrative(`otherCosts.${i}`, { what: 'este costo' }));

  const otherTable = quote.otherCosts.length
    ? table({
      className: 'qe-edit-table qe-stack-table',
      caption: 'Otros costos directos',
      columns: [
        {
          key: 'description',
          label: 'Descripción',
          render: (row, i) => h('div', { class: 'qe-cell-stack' }, kit.text(`otherCosts.${i}.description`, { label: 'Descripción', maxLength: 160 }), otherIll[i].control),
        },
        { key: 'category', label: 'Categoría', render: (row, i) => kit.select(`otherCosts.${i}.category`, { label: 'Categoría', options: categoryOptions }) },
        { key: 'behavior', label: 'Comportamiento', render: (row, i) => kit.select(`otherCosts.${i}.behavior`, { label: 'Comportamiento', options: behaviorOptions }) },
        {
          key: 'amount',
          label: 'Monto',
          render: (row, i) => h(
            'div',
            { class: 'qe-cell-stack' },
            kit.num(`otherCosts.${i}.amount`, { label: 'Monto', rule: 'money', unit: '$', illustrative: otherIll[i].marked }),
            otherIll[i].marked ? h('span', { class: 'qe-cell-tag' }, illustrativeTag()) : null,
          ),
        },
        {
          key: 'calc',
          label: 'En el costo',
          align: 'right',
          className: 'qe-col-calc',
          render: (row, i) => kit.out((r) => splitLabel(r.model.otherCosts[i]), { className: 'mono nowrap' }),
        },
        { key: 'remove', label: '', className: 'qe-col-remove', render: (row, i) => kit.action('', () => removeOther(i), { variant: 'ghost', icon: 'trash', title: 'Quitar este costo' }) },
      ],
      rows: quote.otherCosts,
    })
    : h('p', { class: 'qe-note' }, 'No hay otros costos directos.');

  const otherCount = quote.otherCosts.length;
  const otherSection = kit.advanced(
    {
      key: 'other-costs',
      title: 'Otros costos directos (terceros, subcontratos, manuales)',
      boxed: true,
      // Si hay otros costos cargados, la sección arranca abierta (no se esconden).
      defaultOpen: otherCount > 0,
      summary: (r) => {
        if (otherCount === 0) return 'Para costos que no encajan en personal, equipos, materiales o viajes. No cargaste ninguno.';
        const fixed = r.model.otherCosts.reduce((acc, l) => acc + (l.fixedMonthly || 0), 0);
        const variable = r.model.otherCosts.reduce((acc, l) => acc + (l.variablePerActiveDay || 0), 0);
        return `${otherCount} ${otherCount === 1 ? 'costo cargado' : 'costos cargados'}: ${formatMoney(fixed)} fijo por mes + ${formatMoney(variable)} por día activo.`;
      },
    },
    h('p', { class: 'qe-note' }, 'Elegí la categoría para que aparezcan bien en la estructura de costos.'),
    otherTable,
    h('div', { class: 'qe-toolbar' }, kit.action('Agregar costo', addOther, { icon: 'plus' })),
  );

  const totals = kit.keyline({
    label: 'Materiales en el costo del mes',
    value: (r) => {
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      return row ? formatMoney(row.amount) : EMPTY;
    },
    hint: (r) => {
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      const share = row ? `${formatPercent(row.displayPct)} del costo total · ` : '';
      return `${share}fijo ${formatMoney(r.model.materials.fixedMonthly)} por mes + ${formatMoney(r.model.materials.variablePerActiveDay)} por día activo (incluye otros costos de categoría Materiales).`;
    },
    trace: materialsTrace,
    className: 'qe-keyline-total',
  });

  mount(container, toggleCard, materialsSection, otherSection, totals);
  return { update() {} };
}
