/**
 * Adicionales que se cobran aparte (PLAN-2026-018), en "Cómo se cobra".
 *
 * Como una planilla de cotización: el ítem principal (fijo mensual, hora on
 * call, precio cerrado) y debajo los adicionales con precio unitario (hora
 * fuera de horario, feriado, llamado fuera de horario, km excedente…). Cada
 * uno con su cantidad estimada por mes, su costo por unidad y su precio (si
 * se deja vacío, RATEOS lo sugiere con el margen objetivo).
 */

import { h } from '../../dom.js';
import { table, infoTip } from '../../components.js';
import { COST_CATEGORIES, DIRECT_CATEGORY_IDS } from '../../../domain/catalogs.js';
import { createExtra } from '../../../domain/quote-factory.js';
import { formatMoney, EMPTY } from '../../../core/format.js';
import { confirmRemove } from './shared.js';

/** Adicionales frecuentes (un clic los agrega; después se edita todo). */
const PRESETS = Object.freeze([
  { label: 'Hora fuera de horario', unitName: 'hora', category: 'labor' },
  { label: 'Feriado o fin de semana', unitName: 'día', category: 'labor' },
  { label: 'Llamado fuera de horario', unitName: 'llamado', category: 'labor' },
  { label: 'Km excedente', unitName: 'km', category: 'fuel' },
]);

const MODE_INTRO = Object.freeze({
  monthly: 'Lo que el fijo no cubre y se cobra aparte: horas fuera de horario, feriados, llamados extra, km excedentes…',
  on_demand: 'Ítems que se cobran aparte de la tarifa principal: horas fuera de horario, feriados, km excedentes…',
  closed: 'Trabajos fuera del alcance con precio unitario.',
});

/**
 * Tarjeta de adicionales.
 * @param {object} ctx contexto del paso (quote, kit, mutate)
 * @param {{ mode: string }} contract
 */
export function extrasSection(ctx, contract) {
  const { quote, kit } = ctx;
  const extras = Array.isArray(quote.extras) ? quote.extras : [];
  const categoryOptions = COST_CATEGORIES.filter((c) => DIRECT_CATEGORY_IDS.includes(c.id) && c.id !== 'structure').map((c) => ({ value: c.id, label: c.label }));

  const add = (preset = {}) => {
    const index = extras.length;
    ctx.mutate((q) => {
      if (!Array.isArray(q.extras)) q.extras = [];
      q.extras.push(createExtra(preset));
    }, { focus: `extras.${index}.quantityPerMonth` });
  };
  const remove = async (index) => {
    const line = extras[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar adicional', name: line.label || 'Adicional', extra: '' });
    if (ok) ctx.mutate((q) => q.extras.splice(index, 1));
  };
  const lineOf = (r, i) => (r.extras && r.extras.lines ? r.extras.lines[i] : null);

  const rows = extras.length
    ? table({
      className: 'qe-edit-table qe-stack-table',
      caption: 'Adicionales',
      columns: [
        { key: 'label', label: 'Concepto', render: (row, i) => kit.text(`extras.${i}.label`, { label: 'Concepto', maxLength: 80 }) },
        { key: 'unitName', label: 'Unidad', render: (row, i) => kit.text(`extras.${i}.unitName`, { label: 'Unidad', maxLength: 30, placeholder: 'hora' }) },
        { key: 'qty', label: 'Por mes', render: (row, i) => kit.num(`extras.${i}.quantityPerMonth`, { label: 'Cantidad estimada por mes', rule: 'quantity', placeholder: 'Ej.: 20' }) },
        {
          key: 'cost',
          label: 'Tu costo',
          render: (row, i) => h('div', { class: 'qe-cell-stack' },
            kit.num(`extras.${i}.costPerUnit`, { label: 'Tu costo por unidad', rule: 'money', unit: '$' }),
            kit.select(`extras.${i}.category`, { label: 'Tipo de costo', options: categoryOptions })),
        },
        {
          key: 'price',
          label: 'Precio',
          render: (row, i) => h('div', { class: 'qe-cell-stack' },
            kit.num(`extras.${i}.price`, { label: 'Precio al cliente por unidad (sin IVA)', rule: 'money', unit: '$', placeholder: 'Sugerido' }),
            kit.out((r) => {
              const l = lineOf(r, i);
              if (!l || l.suggestedPrice === null) return 'Cargá tu costo para ver el precio sugerido.';
              return l.priceSource === 'manual'
                ? `Sugerido con tu margen: ${formatMoney(l.suggestedPrice)}`
                : `Se usa el sugerido: ${formatMoney(l.suggestedPrice)}`;
            }, { className: 'small muted' })),
        },
        {
          key: 'month',
          label: 'Del mes',
          align: 'right',
          className: 'qe-col-calc',
          render: (row, i) => kit.out((r) => {
            const l = lineOf(r, i);
            return l && l.quantity > 0 ? `${formatMoney(l.revenue)} (costo ${formatMoney(l.cost)})` : EMPTY;
          }, { className: 'mono nowrap' }),
        },
        { key: 'remove', label: '', className: 'qe-col-remove', render: (row, i) => kit.action('', () => remove(i), { variant: 'ghost', icon: 'trash', title: 'Quitar este adicional' }) },
      ],
      rows: extras,
    })
    : null;

  const used = new Set(extras.map((x) => x && x.label));
  const presetButtons = PRESETS.filter((p) => !used.has(p.label)).map((p) => kit.action(p.label, () => add(p), { icon: 'plus', variant: 'secondary' }));

  return kit.advanced(
    {
      key: 'extras',
      title: 'Adicionales (se cobran aparte)',
      boxed: true,
      defaultOpen: extras.length > 0 || contract.mode === 'monthly',
      summary: (r) => {
        if (!extras.length) return 'Ninguno. Ej.: horas fuera de horario, feriados, llamados extra.';
        const x = r.extras || { revenue: 0, cost: 0 };
        return `${extras.length} ${extras.length === 1 ? 'adicional' : 'adicionales'}: ${formatMoney(x.revenue)} por mes facturados (costo ${formatMoney(x.cost)}).`;
      },
    },
    h('p', { class: 'qe-note' },
      MODE_INTRO[contract.mode] || MODE_INTRO.on_demand,
      ' ',
      infoTip('Cada adicional suma su ingreso y su costo al mes, aparte del precio principal y sin cambiar los días de trabajo. Cargá el costo directo de una unidad (horas extra del personal, combustible…): si dejás el precio vacío, RATEOS lo sugiere con tu margen objetivo y los impuestos sobre la facturación. La estructura y los imprevistos los cubre el precio principal.')),
    rows,
    h('div', { class: 'qe-toolbar' }, ...presetButtons, kit.action('Otro adicional', () => add({ label: 'Otro adicional', unitName: 'unidad' }), { icon: 'plus' })),
  );
}
