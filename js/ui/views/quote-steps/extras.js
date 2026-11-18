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
import { isOutOfHoursExtra } from '../../../engines/out-of-hours-engine.js';

/** Adicionales frecuentes (un clic los agrega; después se edita todo). */
const PRESETS = Object.freeze([
  { label: 'Feriado o fin de semana', unitName: 'día', category: 'labor' },
  { label: 'Llamado fuera de horario', unitName: 'llamado', category: 'labor' },
  { label: 'Km excedente', unitName: 'km', category: 'fuel' },
]);

/** Presets que ya cubre "Trabajo fuera del horario normal" (hora al 50 % y al 100 %). */
const OUT_OF_HOURS_PRESET_LABELS = Object.freeze(['Feriado o fin de semana', 'Llamado fuera de horario']);

/** Aviso en lugar de esos dos botones (V-17). */
export const OUT_OF_HOURS_PRESETS_NOTE = 'Feriados y fuera de horario ya se cotizan arriba, con la hora al 50 % y al 100 %.';

/**
 * Botones de adicionales frecuentes que se ofrecen (V-17): con fuera de horario
 * activo no se ofrecen los que cotizarían lo mismo dos veces; tampoco los que
 * ya están cargados.
 * @param {object[]} extras `quote.extras`
 */
export function extraPresetsFor(extras) {
  const list = Array.isArray(extras) ? extras : [];
  const outOfHoursOn = list.some((x) => isOutOfHoursExtra(x));
  const used = new Set(list.filter((x) => !isOutOfHoursExtra(x)).map((x) => x && x.label));
  return PRESETS.filter((p) => !used.has(p.label) && !(outOfHoursOn && OUT_OF_HOURS_PRESET_LABELS.includes(p.label)));
}

const MODE_INTRO = Object.freeze({
  monthly: 'Lo que el fijo no cubre.',
  on_demand: 'Ítems aparte de la tarifa principal.',
  closed: 'Trabajos fuera del alcance.',
});

/**
 * Tarjeta de adicionales.
 * @param {object} ctx contexto del paso (quote, kit, mutate)
 * @param {{ mode: string }} contract
 */
export function extrasSection(ctx, contract) {
  const { quote, kit } = ctx;
  const extras = Array.isArray(quote.extras) ? quote.extras : [];
  // Las tarifas fuera de horario (PLAN-2026-025) se cargan en su propia tarjeta: acá no se repiten.
  // Cada fila recuerda su posición real en quote.extras (los campos usan ese índice).
  const manual = extras.map((x, i) => ({ x, i })).filter(({ x }) => !isOutOfHoursExtra(x));
  // Cada cotización da UN solo precio (Joaco, 2026-11-18): los adicionales sólo se ven en las
  // cotizaciones que ya los tenían (mismos números), para editarlos o quitarlos. No se agregan nuevos.
  if (!manual.length) return null;
  const categoryOptions = COST_CATEGORIES.filter((c) => DIRECT_CATEGORY_IDS.includes(c.id) && c.id !== 'structure').map((c) => ({ value: c.id, label: c.label }));

  const remove = async (index) => {
    const line = extras[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar adicional', name: line.label || 'Adicional', extra: '' });
    if (ok) ctx.mutate((q) => q.extras.splice(index, 1));
  };
  const lineOf = (r, i) => (r.extras && r.extras.lines ? r.extras.lines[i] : null);

  const rows = manual.length
    ? table({
      className: 'qe-edit-table qe-stack-table',
      caption: 'Adicionales',
      columns: [
        { key: 'label', label: 'Concepto', render: ({ i }) => kit.text(`extras.${i}.label`, { label: 'Concepto', maxLength: 80, placeholder: 'Ej.: Hora de espera' }) },
        { key: 'unitName', label: 'Unidad', render: ({ i }) => kit.text(`extras.${i}.unitName`, { label: 'Unidad', maxLength: 30, placeholder: 'hora' }) },
        { key: 'qty', label: 'Por mes', render: ({ i }) => kit.num(`extras.${i}.quantityPerMonth`, { label: 'Cantidad estimada por mes', rule: 'quantity', placeholder: 'Ej.: 20' }) },
        {
          key: 'cost',
          label: 'Tu costo',
          render: ({ i }) => h('div', { class: 'qe-cell-stack' },
            kit.num(`extras.${i}.costPerUnit`, { label: 'Tu costo por unidad', rule: 'money', unit: '$' }),
            kit.select(`extras.${i}.category`, { label: 'Tipo de costo', options: categoryOptions })),
        },
        {
          key: 'price',
          label: 'Precio',
          render: ({ i }) => h('div', { class: 'qe-cell-stack' },
            kit.num(`extras.${i}.price`, { label: 'Precio al cliente por unidad (sin IVA)', rule: 'money', unit: '$', placeholder: 'Sugerido' }),
            kit.out((r) => {
              const l = lineOf(r, i);
              if (!l || (l.suggestedPrice === null && !(l.costPerUnit > 0))) return 'Cargá tu costo para ver el precio sugerido.';
              if (l.suggestedPrice === null) return 'Sin sugerido: revisá el margen objetivo.';
              return l.priceSource === 'manual'
                ? `Sugerido con tu margen: ${formatMoney(l.suggestedPrice)}`
                : `Se usa el sugerido: ${formatMoney(l.suggestedPrice)}`;
            }, { className: 'small muted' })),
        },
        {
          key: 'month',
          label: 'Por mes',
          align: 'right',
          className: 'qe-col-calc',
          render: ({ i }) => kit.out((r) => {
            const l = lineOf(r, i);
            return l && l.quantity > 0 ? formatMoney(l.revenue) : EMPTY;
          }, { className: 'mono nowrap' }),
        },
        { key: 'remove', label: '', className: 'qe-col-remove', render: ({ i }) => kit.action('', () => remove(i), { variant: 'ghost', icon: 'trash', title: 'Quitar este adicional' }) },
      ],
      rows: manual,
    })
    : null;

  const outOfHoursOn = extras.some((x) => isOutOfHoursExtra(x));

  return kit.advanced(
    {
      key: 'extras',
      title: 'Adicionales (cargados antes)',
      boxed: true,
      defaultOpen: manual.length > 0,
      summary: (r) => {
        if (!manual.length) return outOfHoursOn ? 'Ninguno. Ej.: km excedente, hora de espera.' : 'Ninguno. Ej.: km excedente, feriados, llamados extra.';
        const lines = ((r.extras && r.extras.lines) || []).filter((l) => !l.derived);
        const sum = (key) => lines.reduce((acc, l) => acc + (l[key] || 0), 0);
        return `${manual.length} ${manual.length === 1 ? 'adicional' : 'adicionales'}: ${formatMoney(sum('revenue'))} por mes facturados (costo ${formatMoney(sum('cost'))}).`;
      },
    },
    h('p', { class: 'qe-note' },
      MODE_INTRO[contract.mode] || MODE_INTRO.on_demand,
      ' ',
      infoTip('Suma ingreso y costo al mes, aparte del precio principal. Cargá el costo directo de una unidad; si dejás el precio vacío, RATEOS lo sugiere con tu margen.')),
    rows,
    outOfHoursOn ? h('p', { class: 'qe-note' }, OUT_OF_HOURS_PRESETS_NOTE) : null,
    h('p', { class: 'qe-note' }, 'Las cotizaciones nuevas dan un solo precio, sin adicionales aparte. Estos se siguen cobrando igual hasta que los quites.'),
  );
}
