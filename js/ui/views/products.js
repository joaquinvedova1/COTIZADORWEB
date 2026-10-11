/**
 * Productos (PLAN-2026-008): lista y "Nuevo producto".
 *
 * Un producto se costea por tandas (receta) y se vende por unidad: el editor
 * paso a paso (product-editor.js) arma el costo por unidad y el precio con el
 * margen que la persona quiere ganar.
 */

import { h, mount } from '../dom.js';
import { badge, button, confirmDialog, emptyState, icon, linkButton, pageIntro, table } from '../components.js';
import { formatMoney, formatNumber, formatPercent, formatDateTime } from '../../core/format.js';
import { PRODUCT_STEPS } from '../../domain/catalogs.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';

const EMPTY = '—';

/** Monto por unidad: con centavos si es chico ($ 286,67), sin centavos si no. */
export function unitMoney(value) {
  if (!Number.isFinite(value)) return EMPTY;
  return formatMoney(value, { decimals: Math.abs(value) < 1000 ? 2 : 0 });
}

export function productHref(product, step = null) {
  const id = encodeURIComponent(product && product.id ? product.id : '');
  return step ? `#/productos/${id}/${step}` : `#/productos/${id}`;
}

function choiceCard({ title, text, iconName, tags = [], onChoose, className = '' }) {
  const btn = h(
    'button',
    { type: 'button', class: ['quote-choice', className] },
    iconName ? h('span', { class: 'quote-choice-icon', 'aria-hidden': 'true' }, icon(iconName, { size: 22 })) : null,
    h('span', { class: 'quote-choice-title' }, title),
    text ? h('span', { class: 'quote-choice-text' }, text) : null,
    tags.length ? h('span', { class: 'quote-choice-tags' }, ...tags) : null,
    h('span', { class: 'quote-choice-go', 'aria-hidden': 'true' }, icon('arrowRight', { size: 18 })),
  );
  btn.addEventListener('click', onChoose);
  return btn;
}

/** #/productos */
export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Productos', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const readOnly = Boolean(ctx.init && ctx.init.readOnly);
  let items = [];
  try {
    items = await ctx.products.listProducts();
  } catch (error) {
    mount(root, emptyState({ title: 'No se pudieron leer tus productos', text: userErrorMessage(error, 'Probá recargar la página.') }));
    return undefined;
  }

  async function duplicate(product) {
    try {
      const copy = await ctx.products.duplicateProduct(product.id);
      if (copy) {
        app.toast('Producto duplicado.', 'success');
        app.navigate(productHref(copy));
      }
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo duplicar el producto.'), 'danger');
    }
  }

  async function remove(product) {
    const ok = await confirmDialog({
      title: 'Eliminar producto',
      message: `¿Eliminar "${product.name || 'Producto'}"? No se puede deshacer. Tus Recursos (personal, equipos y materiales) no cambian.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.products.deleteProduct(product.id);
      app.toast('Producto eliminado.', 'success');
      await render(root, app);
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo eliminar el producto.'), 'danger');
    }
  }

  const intro = pageIntro({
    title: 'Productos',
    text: 'Calculá cuánto te cuesta hacer cada producto (ingredientes, personal, máquinas y gastos fijos) y a qué precio venderlo para ganar lo que querés.',
    actions: readOnly ? [] : [linkButton('Nuevo producto', '#/productos/nuevo', { variant: 'primary', icon: 'plus' })],
  });

  if (!items.length) {
    mount(
      root,
      h(
        'div',
        { class: 'view-narrow stack-lg' },
        intro,
        emptyState({
          icon: 'product',
          title: 'Todavía no tenés productos',
          text: 'Armá tu primer producto paso a paso, o mirá primero un ejemplo con valores ilustrativos.',
          action: readOnly ? null : linkButton('Nuevo producto', '#/productos/nuevo', { variant: 'primary', icon: 'plus' }),
          level: 2,
        }),
      ),
    );
    return undefined;
  }

  const rows = items.map(({ product, summary }) => ({ product, summary }));
  const columns = [
    {
      key: 'name',
      label: 'Producto',
      render: ({ product }) => h('div', { class: 'pe-name-cell' },
        h('a', { href: productHref(product), class: 'pe-name-link' }, product.name || 'Producto'),
        h('span', { class: 'muted small' }, `por ${product.saleUnit || 'unidad'}`),
        product.illustrative ? illustrativeTag('Producto de ejemplo con valores ilustrativos') : null),
    },
    { key: 'cost', label: 'Costo por unidad', align: 'right', render: ({ summary }) => h('span', { class: 'mono' }, unitMoney(summary.unitCost)) },
    { key: 'price', label: 'Precio sugerido', align: 'right', render: ({ summary }) => h('span', { class: 'mono' }, unitMoney(summary.suggestedPrice)) },
    { key: 'margin', label: 'Margen', align: 'right', render: ({ summary }) => (Number.isFinite(summary.marginPct) ? formatPercent(summary.marginPct, { decimals: 1 }) : EMPTY) },
    { key: 'be', label: 'Equilibrio (u/mes)', align: 'right', render: ({ summary }) => (Number.isFinite(summary.breakEvenUnits) ? formatNumber(Math.ceil(summary.breakEvenUnits)) : EMPTY) },
    {
      key: 'state',
      label: 'Estado',
      render: ({ summary }) => (summary.errors ? badge(`Faltan datos (${summary.errors})`, 'orange') : summary.currentBelowFloor ? badge('Precio actual bajo el costo', 'red') : badge('Completo', 'green')),
    },
    { key: 'updated', label: 'Actualizado', render: ({ product }) => h('span', { class: 'muted small' }, formatDateTime(product.updatedAt)) },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      render: ({ product }) => h('div', { class: 'row-actions' },
        linkButton('Abrir', productHref(product), { size: 'sm' }),
        readOnly ? null : button('Duplicar', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => duplicate(product), attrs: { 'aria-label': `Duplicar ${product.name || 'producto'}` } }),
        readOnly ? null : button('Eliminar', { size: 'sm', variant: 'ghost', icon: 'trash', onClick: () => remove(product), attrs: { 'aria-label': `Eliminar ${product.name || 'producto'}` } })),
    },
  ];

  mount(
    root,
    h(
      'div',
      { class: 'stack-lg' },
      intro,
      h('div', { class: 'card list-card product-list' }, table({ columns, rows, className: 'table-products table-cards', caption: 'Tus productos con su costo y precio por unidad' })),
      h('p', { class: 'muted small' }, 'Los precios son sin IVA. El margen se mide sobre el precio (no es el markup).'),
    ),
  );
  return undefined;
}

/** #/productos/nuevo */
export async function renderNew(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Nuevo producto', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }, { label: 'Productos', href: '#/productos' }] });
  const cards = [];
  let busy = false;

  async function create(example) {
    if (busy) return;
    busy = true;
    cards.forEach((c) => {
      c.disabled = true;
    });
    try {
      const product = await ctx.products.createProduct({ example });
      app.toast(example ? 'Se creó el ejemplo "Chipá" con valores ILUSTRATIVOS.' : 'Producto creado.', 'success');
      app.navigate(productHref(product, example ? 'resultado' : 'producto'));
    } catch (error) {
      busy = false;
      cards.forEach((c) => {
        c.disabled = false;
      });
      app.toast(userErrorMessage(error, 'No se pudo crear el producto.'), 'danger');
    }
  }

  cards.push(
    choiceCard({ title: 'Empezar en blanco', text: 'Cargás tu receta, tu personal, tus máquinas y tus gastos, paso a paso.', iconName: 'plus', className: 'quote-choice-blank', onChoose: () => create(false) }),
    choiceCard({
      title: 'Ver un ejemplo: Chipá',
      text: 'Un producto ya armado para ver cómo funciona. Después lo cambiás o lo borrás.',
      iconName: 'product',
      tags: [illustrativeTag('Valores de ejemplo: no son precios, sueldos ni costos reales')],
      onChoose: () => create(true),
    }),
  );

  mount(
    root,
    h(
      'div',
      { class: 'view-narrow stack-lg' },
      pageIntro({
        title: '¿Qué producto querés costear?',
        text: 'Chipá, facturas, viandas, tortas, conservas… Pensá en una tanda: lo que hacés de una vez con una receta. RATEOS calcula cuánto te cuesta cada unidad y a qué precio venderla.',
      }),
      h('div', { class: 'quote-choice-grid' }, ...cards),
      h(
        'div',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Cómo sigue'),
        h(
          'ol',
          { class: 'stage-list' },
          ...PRODUCT_STEPS.map((s, i) => h('li', {}, h('span', { class: 'stage-num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'stage-body' }, h('strong', {}, s.label), h('span', { class: 'muted' }, STEP_HINTS[s.id] || '')))),
        ),
      ),
    ),
  );
  return undefined;
}

/** Qué se carga en cada paso (también lo usa el editor). */
export const STEP_HINTS = Object.freeze({
  producto: 'Nombre, cuántas unidades salen de cada tanda y cuántas vendés por mes.',
  insumos: 'Lo que lleva la receta (harina, queso…) y lo que va en cada unidad (bolsita, etiqueta).',
  personal: 'Quién lo hace, con su sueldo y su convenio, y cuánto tiempo le dedica a cada tanda.',
  maquinas: 'Horno, amasadora, heladera: lo que gastan al usarlas y lo que cuesta tenerlas.',
  fijos: 'Alquiler, servicios, contador… y qué parte le toca a este producto.',
  precio: 'Cuánto querés ganar, impuestos sobre lo que vendés, redondeo e IVA.',
  resultado: 'Costo por unidad, precio piso, precio sugerido y cuántas tenés que vender.',
});

export { formatMoney };
