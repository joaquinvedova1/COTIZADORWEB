/**
 * Paso 5 — Materiales y otros costos directos.
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
import { confirmRemove } from './shared.js';

const BASIS_SHORT = Object.freeze({ per_month: 'por mes', per_active_day: 'por día activo', per_activation: 'por activación' });

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
    formula: 'Costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%) · Por mes → fijo; por día activo → variable; por activación → variable ÷ días por activación · Si lo provee el cliente, no es costo nuestro',
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
    { title: 'Materiales', subtitle: 'Insumos, consumibles y materiales menores del servicio.' },
    kit.check('materialsNotApplicable', { label: 'El servicio no usa materiales', structural: true, hint: 'Marcalo para confirmar que no te olvidaste de cargarlos.' }),
  );

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
        formGrid(
          4,
          kit.text(`${p}.description`, { label: 'Descripción', maxLength: 160 }),
          kit.text(`${p}.unit`, { label: 'Unidad', maxLength: 30, placeholder: 'kit, kg, m, unidad' }),
          kit.select(`${p}.basis`, { label: 'Base', options: MATERIAL_BASES.map((b) => ({ value: b.id, label: b.label })) }),
          kit.select(`${p}.providedBy`, {
            label: '¿Quién lo provee?',
            options: MATERIAL_PROVIDERS.map((m) => ({ value: m.id, label: m.label })),
            includeEmpty: true,
            emptyLabel: 'Elegí quién lo provee…',
          }),
          kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', hint: 'Por mes, día activo o activación (según la base).' }),
          kit.num(`${p}.unitCost`, { label: 'Costo unitario', rule: 'money', unit: '$', illustrative }),
          kit.num(`${p}.wastePct`, { label: 'Merma', rule: 'percent', unit: '%', illustrative }),
          kit.num(`${p}.logisticsPct`, { label: 'Logística', rule: 'percent', unit: '%', illustrative, hint: 'Flete y manipuleo del material.' }),
          kit.num(`${p}.resaleMarkupPct`, { label: 'Markup de reventa', rule: 'percentOpen', unit: '%', hint: 'Sólo informativo, si facturás materiales aparte.' }),
        ),
        kit.stats(
          kit.stat('Costo para nosotros', (r) => formatMoney(at(r) && at(r).costForUs), {
            hint: (r) => {
              const l = at(r);
              if (!l) return '';
              if (!l.providedBy) return 'Falta definir quién lo provee.';
              return l.costForUs === 0 && l.grossCost > 0 ? 'Lo provee el cliente: no es costo nuestro.' : BASIS_SHORT[l.basis] || '';
            },
            tone: (r) => (at(r) && !at(r).providedBy ? 'red' : null),
          }),
          kit.stat('Fijo mensual / variable por día', (r) => splitLabel(at(r))),
          kit.stat('Precio de reventa (informativo)', (r) => formatMoney(at(r) && at(r).resalePrice), { hint: 'Costo × (1 + markup). No es margen.' }),
        ),
      );
    });

  const materialsSection = notApplicable
    ? null
    : h(
      'div',
      { class: 'stack' },
      card(
        { title: 'Agregar materiales' },
        h(
          'div',
          { class: 'qe-toolbar' },
          h(
            'div',
            { class: 'qe-toolbar-pick' },
            selectField({
              label: 'Desde la biblioteca de materiales',
              value: null,
              includeEmpty: true,
              emptyLabel: library.length ? 'Elegí un material…' : 'La biblioteca está vacía',
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
      materialCards.length ? h('div', { class: 'qe-lines' }, ...materialCards) : card({}, emptyState('No hay materiales cargados. Si el servicio no usa materiales, marcá la casilla de arriba.')),
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
    : emptyState('No hay otros costos directos.');

  const otherCard = card(
    {
      title: 'Otros costos directos (terceros, subcontratos, manuales)',
      subtitle: 'Costos que no encajan en las líneas anteriores. Elegí la categoría para que aparezcan bien en la estructura de costos.',
      actions: [kit.action('Agregar costo', addOther, { icon: 'plus' })],
    },
    otherTable,
  );

  const totals = card(
    { title: 'Totales' },
    kit.stats(
      kit.stat('Materiales: fijo mensual', (r) => formatMoney(r.model.materials.fixedMonthly)),
      kit.stat('Materiales: variable por día activo', (r) => formatMoney(r.model.materials.variablePerActiveDay)),
      kit.stat('Materiales en la estructura de costos', (r) => {
        const row = r.eecc.rows.find((x) => x.category === 'materials');
        return row ? `${formatMoney(row.amount)} · ${formatPercent(row.displayPct)}` : EMPTY;
      }, { emphasis: true, trace: materialsTrace }),
    ),
  );

  mount(container, toggleCard, materialsSection, otherCard, totals);
  return { update() {} };
}
