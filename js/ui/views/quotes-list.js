/**
 * Cotizaciones: listado (búsqueda, filtro por estado, vista simple o
 * detallada, acciones) y pantalla "Nueva cotización" (en blanco o desde
 * plantilla de servicio).
 *
 * La vista simple muestra sólo Servicio, Cliente, Estado, Tarifa y Margen;
 * el resto (código, costo mensual, break-even, completitud, cambiar estado,
 * duplicar, eliminar) queda en "Más opciones" de cada fila o en la vista
 * detallada.
 *
 * También exporta columnas y helpers de presentación de cotizaciones que
 * reutilizan Inicio y Escenarios.
 */

import { h, s, mount, debounce, uniqueId } from '../dom.js';
import { badge, banner, button, card, confirmDialog, disclosure, emptyState, icon, linkButton, openDialog, pageIntro, progressBar, table } from '../components.js';
import { formatDateTime, formatDays, formatMoney, formatPercent, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { PRICING_MODES, QUOTE_STATUSES, SERVICE_TYPES, labelOf } from '../../domain/catalogs.js';
import { illustrativeInfo } from '../../domain/quote-factory.js';
import { completenessTone } from '../../engines/completeness-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';

export { completenessTone };

// ------------------------------------------------------- helpers compartidos

export const UNIT_SHORT = Object.freeze({ day: 'día', hour: 'hora', month: 'mes' });

const STATUS_TONES = Object.freeze({ draft: 'gray', sent: 'blue', won: 'green', lost: 'red', archived: 'navy' });

/** Etapas del editor (para explicar "cómo sigue" sin mostrar los 11 pasos). */
const QUOTE_STAGES = Object.freeze([
  { title: 'El servicio', text: 'Qué servicio vas a prestar y cómo lo vas a cobrar.' },
  { title: 'Los recursos', text: 'Personal, equipos, materiales y viajes.' },
  { title: 'Las condiciones', text: 'Gastos de estructura, plazo de cobro e imprevistos.' },
  { title: 'El precio', text: 'Cuánto querés ganar y tus reglas comerciales.' },
  { title: 'Resultado', text: 'Costo, tarifa piso, tarifa sugerida y días para no perder plata.' },
]);

/** Ruta del editor de una cotización. */
export function quoteHref(quote, step = null) {
  const base = `#/cotizaciones/${encodeURIComponent(quote.id)}`;
  return step ? `${base}/${step}` : base;
}

/**
 * "Ver detalle": el resultado de la cotización. Si no se pudo calcular
 * (datos inválidos), se abre el editor para revisarla.
 */
export function quoteDetailHref(quote, summary) {
  return summaryFailed(summary) ? quoteHref(quote) : quoteHref(quote, 'result');
}

export function statusBadge(status) {
  return badge(labelOf(QUOTE_STATUSES, status, 'Sin estado'), STATUS_TONES[status] || 'gray');
}

/**
 * Color del margen: rojo si pierde plata (resultado negativo o bajo piso con
 * pérdida), naranja si no llega al objetivo. Sin tarifa comercial no hay
 * margen: gris.
 */
export function marginTone(summary) {
  if (!summary || !isFiniteNumber(summary.marginPct)) return 'gray';
  if (summary.marginPct < 0 || summary.belowFloor) return 'red';
  if (summary.belowTarget) return 'orange';
  return 'green';
}

/** true si la cotización no se pudo calcular (datos inválidos). */
export function summaryFailed(summary) {
  return !summary || summary.error === true;
}

/** Marca ILUSTRATIVO de una cotización (nunca lanza, aun con datos raros). */
export function quoteIllustrative(quote) {
  try {
    return illustrativeInfo(quote && typeof quote === 'object' ? quote : {});
  } catch {
    return { any: false, quote: false, lines: 0, fuel: false };
  }
}

function illustrativeQuoteTag(quote) {
  const info = quoteIllustrative(quote);
  if (!info.any) return null;
  return illustrativeTag(
    info.quote
      ? 'Cotización de demostración con valores ilustrativos'
      : 'Tiene valores ILUSTRATIVOS copiados de plantillas, recursos o Configuración: reemplazalos por valores propios vigentes',
  );
}

/** Texto seguro para mostrar (los datos importados pueden traer cualquier tipo). */
function textOf(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function completenessCell(pct) {
  return h(
    'div',
    { class: 'completeness-cell', title: 'Qué tan completa está la estructura de costos (Cost Completeness Score)' },
    progressBar(pct, completenessTone(pct), { label: 'Completitud de costos' }),
    h('span', { class: 'mono small' }, formatPercent(pct, { decimals: 0 })),
  );
}

const muted = (text = EMPTY) => h('span', { class: 'muted' }, text);

/** Ícono "más opciones" (tres puntos), dibujado acá porque components.js no lo trae. */
function moreIcon() {
  return s(
    'svg',
    { viewBox: '0 0 24 24', width: 18, height: 18, class: 'icon', 'aria-hidden': 'true' },
    s('circle', { cx: 5, cy: 12, r: 2, fill: 'currentColor' }),
    s('circle', { cx: 12, cy: 12, r: 2, fill: 'currentColor' }),
    s('circle', { cx: 19, cy: 12, r: 2, fill: 'currentColor' }),
  );
}

/** Tarifa comercial de lista con su unidad ("$ 2.259.000 /día") o "Sin tarifa". */
export function quoteRateNode(quote, summary) {
  if (summaryFailed(summary)) return muted();
  return isFiniteNumber(summary.commercialListRate)
    ? h('span', { class: 'nowrap' }, formatMoney(summary.commercialListRate), h('span', { class: 'unit-suffix' }, ` /${UNIT_SHORT[quote.unit] || 'unidad'}`))
    : muted('Sin tarifa');
}

/** Margen esperado como insignia de color (o "—" si no hay tarifa). */
export function quoteMarginNode(summary) {
  return !summaryFailed(summary) && isFiniteNumber(summary.marginPct)
    ? badge(formatPercent(summary.marginPct), marginTone(summary), { title: 'Margen sobre precio de venta (no es markup)' })
    : h('span', { class: 'muted', title: summaryFailed(summary) ? 'No se pudo calcular' : 'Sin tarifa comercial no hay margen' }, EMPTY);
}

function failedBadge(quote) {
  return h(
    'span',
    { class: 'cell-error' },
    badge('No se pudo calcular', 'red', { title: 'Esta cotización tiene datos que no se pueden calcular. Abrila para revisarlos.' }),
    h('a', { href: quoteHref(quote), class: 'cell-error-link' }, 'Abrir y revisar'),
  );
}

/** Celda "Servicio": nombre (enlace), código y tipo, ILUSTRATIVO y error. */
function serviceCell({ quote, summary }, href) {
  return h(
    'div',
    { class: 'cell-main' },
    h('a', { href, class: 'cell-title' }, textOf(quote.name, 'Sin nombre')),
    h('span', { class: 'cell-sub' }, h('span', { class: 'mono' }, textOf(quote.code, EMPTY)), ` · ${labelOf(SERVICE_TYPES, quote.serviceType)}`),
    summaryFailed(summary) ? failedBadge(quote) : null,
    illustrativeQuoteTag(quote),
  );
}

/**
 * Columnas de la lista simple (Servicio, Cliente, Estado, Tarifa, Margen y
 * una acción por fila). Cada fila es `{ quote, summary }`.
 * @param {{ action?: (row) => Node, showStatus?: boolean, href?: (row) => string }} [options]
 */
export function quoteSummaryColumns({ action = null, showStatus = true, href = ({ quote, summary }) => quoteDetailHref(quote, summary) } = {}) {
  return [
    { key: 'service', label: 'Servicio', className: 'col-service', render: (row) => serviceCell(row, href(row)) },
    { key: 'client', label: 'Cliente', render: ({ quote }) => (typeof quote.client === 'string' && quote.client.trim() ? quote.client : muted()) },
    showStatus ? { key: 'status', label: 'Estado', render: ({ quote }) => statusBadge(quote.status) } : null,
    { key: 'rate', label: 'Tarifa', align: 'right', render: ({ quote, summary }) => quoteRateNode(quote, summary) },
    { key: 'margin', label: 'Margen', align: 'right', render: ({ summary }) => quoteMarginNode(summary) },
    action ? { key: 'action', label: h('span', { class: 'sr-only' }, 'Acciones'), align: 'right', className: 'col-actions', render: action } : null,
  ].filter(Boolean);
}

/** Botón "Ver detalle" de una fila. */
export function detailLink(quote, summary) {
  return linkButton('Ver detalle', quoteDetailHref(quote, summary), {
    variant: 'secondary',
    size: 'sm',
    attrs: { 'aria-label': `Ver detalle de ${quoteRef(quote)}` },
  });
}

/**
 * Columnas estándar (detalladas) de una tabla de cotizaciones. Cada fila es
 * `{ quote, summary }` (resultado de quotes.listQuotes()).
 */
export function quoteColumns({ statusCell = null } = {}) {
  return [
    {
      key: 'quote',
      label: 'Cotización',
      className: 'col-service',
      render: ({ quote, summary }) => {
        const failed = summaryFailed(summary);
        return h(
          'div',
          { class: 'cell-main' },
          h('a', { href: quoteHref(quote), class: 'cell-title' }, textOf(quote.name, 'Sin nombre')),
          h('span', { class: 'cell-sub' }, h('span', { class: 'mono' }, textOf(quote.code, EMPTY)), ` · ${labelOf(SERVICE_TYPES, quote.serviceType)}`),
          h('span', { class: 'cell-sub' }, `Modalidad: ${labelOf(PRICING_MODES, quote.pricingMode)}`),
          failed ? failedBadge(quote) : null,
          illustrativeQuoteTag(quote),
        );
      },
    },
    { key: 'client', label: 'Cliente', render: ({ quote }) => (typeof quote.client === 'string' && quote.client.trim() ? quote.client : muted()) },
    {
      key: 'totalCost',
      label: 'Costo mensual',
      align: 'right',
      render: ({ summary }) => (summaryFailed(summary) ? muted() : h('span', { class: 'nowrap' }, formatMoney(summary.totalCost))),
    },
    { key: 'rate', label: 'Tarifa comercial', align: 'right', render: ({ quote, summary }) => quoteRateNode(quote, summary) },
    {
      key: 'margin',
      label: 'Margen esperado',
      align: 'right',
      // Sin tarifa comercial el margen es null: se muestra "—" sin badge.
      render: ({ summary }) => quoteMarginNode(summary),
    },
    {
      key: 'breakEven',
      label: 'Días para no perder',
      align: 'right',
      render: ({ quote, summary }) => breakEvenNode(quote, summary),
    },
    { key: 'completeness', label: 'Completitud', render: ({ summary }) => (summaryFailed(summary) ? muted() : completenessCell(summary.completenessPct)) },
    { key: 'status', label: 'Estado', render: statusCell || (({ quote }) => statusBadge(quote.status)) },
  ];
}

function breakEvenNode(quote, summary) {
  if (summaryFailed(summary)) return muted();
  return quote.unit === 'month'
    ? h('span', { class: 'muted', title: 'Con abono mensual la facturación no depende de los días: no hay break-even en días.' }, 'No aplica')
    : h('span', { class: 'nowrap', title: 'Días activos por mes necesarios para no perder plata (break-even)' }, formatDays(summary.breakEvenDays));
}

/** Código o nombre de la cotización para textos y etiquetas accesibles. */
export function quoteRef(quote) {
  return textOf(quote && quote.code, textOf(quote && quote.name, 'cotización sin nombre'));
}

/** Hace clickeables las filas de una tabla (los links y botones siguen funcionando). */
export function attachRowNavigation(tableWrap, rows, onOpen) {
  if (!rows.length) return;
  const trs = tableWrap.querySelectorAll('tbody tr');
  trs.forEach((tr, i) => {
    const row = rows[i];
    if (!row) return;
    tr.classList.add('row-link');
    tr.addEventListener('click', (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('a, button, select, input, textarea, label')) return;
      onOpen(row);
    });
  });
}

function normalizeSearch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Filtro puro por texto (nombre, cliente, código) y estado. */
export function filterQuoteItems(items, { query = '', status = '' } = {}) {
  const q = normalizeSearch(query);
  return items.filter(({ quote }) => {
    if (status && quote.status !== status) return false;
    if (!q) return true;
    return [quote.name, quote.client, quote.code].some((v) => normalizeSearch(v).includes(q));
  });
}

function kvList(entries) {
  return h('dl', { class: 'kv-list' }, ...entries.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

/** Banner de cotizaciones que no se pudieron calcular (null si no hay). */
export function failedQuotesBanner(items) {
  const failed = items.filter(({ summary }) => summaryFailed(summary)).length;
  if (!failed) return null;
  return banner(
    `${failed === 1 ? 'Una cotización no se pudo calcular' : `${failed} cotizaciones no se pudieron calcular`} porque tiene${failed === 1 ? '' : 'n'} datos inválidos (por ejemplo, de un backup importado). Abrila${failed === 1 ? '' : 's'} para revisar los valores.`,
    'warning',
  );
}

/** Estado vacío "todavía no creaste ninguna cotización". */
export function noQuotesState() {
  return emptyState({
    icon: 'quote',
    title: 'Todavía no creaste ninguna cotización.',
    text: 'Empezá calculando cuánto cuesta uno de tus servicios.',
    action: linkButton('Crear primera cotización', '#/cotizaciones/nueva', { variant: 'primary', icon: 'plus' }),
    secondary: linkButton('Probar con un ejemplo', '#/demo', { variant: 'secondary', icon: 'play' }),
  });
}

// -------------------------------------------------------------------- listado

export async function render(root, app) {
  const { ctx } = app;
  const newQuoteAction = () => linkButton('Nueva cotización', '#/cotizaciones/nueva', { variant: 'primary', icon: 'plus' });
  app.setHeader({ title: 'Cotizaciones', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }], actions: [newQuoteAction()] });

  const state = { query: '', status: '', items: [], view: 'simple' };
  const listHost = h('div', { class: 'quotes-list-host' });
  const countEl = h('span', { class: 'muted small toolbar-count', role: 'status' });

  const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: 'Buscar por nombre, cliente o código', 'aria-label': 'Buscar cotizaciones', maxlength: '100' });
  const applySearch = debounce(() => {
    state.query = searchInput.value;
    renderList();
  }, 200);
  searchInput.addEventListener('input', applySearch);

  const statusSelect = h(
    'select',
    { class: 'filter-select', 'aria-label': 'Filtrar por estado' },
    h('option', { value: '' }, 'Todos los estados'),
    ...QUOTE_STATUSES.map((s) => h('option', { value: s.id }, s.label)),
  );
  statusSelect.addEventListener('change', () => {
    state.status = statusSelect.value;
    renderList();
  });

  // Vista simple / detallada (sólo en memoria mientras se usa la pantalla).
  const viewButtons = [
    { id: 'simple', label: 'Simple', title: 'Servicio, cliente, estado, tarifa y margen' },
    { id: 'detailed', label: 'Detallada', title: 'Suma costo mensual, días para no perder, completitud y acciones' },
  ].map((v) => {
    const btn = h('button', { type: 'button', class: 'segmented-btn', title: v.title, 'aria-pressed': v.id === state.view ? 'true' : 'false' }, v.label);
    btn.addEventListener('click', () => {
      state.view = v.id;
      viewButtons.forEach((b) => b.el.setAttribute('aria-pressed', b.id === state.view ? 'true' : 'false'));
      renderList();
    });
    return { id: v.id, el: btn };
  });
  const viewToggle = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Vista del listado' }, ...viewButtons.map((b) => b.el));

  const toolbar = h('div', { class: 'toolbar' }, searchInput, statusSelect, h('span', { class: 'spacer' }), countEl, viewToggle);

  async function load() {
    state.items = await ctx.quotes.listQuotes();
    renderList();
  }

  async function changeStatus(quote, status, select) {
    select.disabled = true;
    try {
      const fresh = await ctx.quotes.getQuote(quote.id);
      if (!fresh) throw new Error('not_found');
      await ctx.quotes.saveQuote({ ...fresh, status });
      app.toast(`${textOf(quote.code, 'Cotización')}: estado "${labelOf(QUOTE_STATUSES, status)}".`, 'success');
      await load();
      return true;
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo cambiar el estado.'), 'danger');
      select.value = quote.status;
      select.disabled = false;
      return false;
    }
  }

  async function duplicate(quote) {
    try {
      const copy = await ctx.quotes.duplicateQuote(quote.id);
      if (!copy) throw new Error('not_found');
      app.toast(`Se creó ${copy.code}: copia de ${quoteRef(quote)}.`, 'success');
      await load();
      return true;
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo duplicar la cotización.'), 'danger');
      return false;
    }
  }

  async function remove(quote) {
    const ok = await confirmDialog({
      title: 'Eliminar cotización',
      message: `¿Eliminar "${textOf(quote.name, 'Sin nombre')}" (${textOf(quote.code, 'sin código')})? No se puede deshacer. Si querés conservarla, exportá un backup antes desde Configuración → Datos y backup.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return false;
    try {
      await ctx.quotes.deleteQuote(quote.id);
      app.toast('Cotización eliminada.', 'success');
      await load();
      return true;
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo eliminar la cotización.'), 'danger');
      return false;
    }
  }

  const statusSelectFor = (quote, { id = null, label = `Estado de ${quoteRef(quote)}` } = {}) => {
    const select = h(
      'select',
      { class: 'status-select', id, 'aria-label': id ? null : label, dataset: { tone: STATUS_TONES[quote.status] || 'gray' } },
      ...QUOTE_STATUSES.map((s) => h('option', { value: s.id, selected: s.id === quote.status }, s.label)),
    );
    select.value = quote.status;
    return select;
  };

  /** "Más opciones" de una fila: datos secundarios y acciones. */
  function openOptions({ quote, summary }) {
    const failed = summaryFailed(summary);
    const statusId = uniqueId('estado');
    const select = statusSelectFor(quote, { id: statusId });
    let dialogRef = null;
    select.addEventListener('change', async () => {
      if (await changeStatus(quote, select.value, select)) dialogRef.close();
    });
    const dupBtn = button('Duplicar', { variant: 'secondary', icon: 'copy' });
    dupBtn.addEventListener('click', async () => {
      dupBtn.disabled = true;
      if (await duplicate(quote)) dialogRef.close();
      else dupBtn.disabled = false;
    });
    const delBtn = button('Eliminar', { variant: 'danger', icon: 'trash' });
    delBtn.addEventListener('click', async () => {
      if (await remove(quote)) dialogRef.close();
    });
    const content = h(
      'div',
      { class: 'stack quote-options' },
      kvList([
        ['Código', h('span', { class: 'mono' }, textOf(quote.code, EMPTY))],
        ['Servicio', labelOf(SERVICE_TYPES, quote.serviceType)],
        ['Modalidad', labelOf(PRICING_MODES, quote.pricingMode)],
        ['Costo mensual', failed ? EMPTY : formatMoney(summary.totalCost)],
        ['Tarifa', quoteRateNode(quote, summary)],
        ['Margen esperado', quoteMarginNode(summary)],
        ['Días para no perder', breakEvenNode(quote, summary)],
        ['Completitud de costos', failed ? EMPTY : completenessCell(summary.completenessPct)],
        ['Última modificación', formatDateTime(quote.updatedAt)],
      ]),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: statusId }, 'Estado'), h('div', {}, select)),
      quoteIllustrative(quote).any ? h('p', { class: 'muted small' }, illustrativeQuoteTag(quote), ' Tiene valores ILUSTRATIVOS: reemplazalos por valores propios antes de enviarla.') : null,
    );
    dialogRef = openDialog({
      title: textOf(quote.name, 'Cotización sin nombre'),
      content,
      actions: [delBtn, h('span', { class: 'spacer' }), dupBtn, linkButton('Abrir en el editor', quoteHref(quote), { variant: 'primary', icon: 'edit' })],
    });
  }

  const simpleActions = (row) =>
    h(
      'div',
      { class: 'table-actions' },
      detailLink(row.quote, row.summary),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost btn-sm btn-icon',
          title: 'Más opciones',
          'aria-label': `Más opciones de ${quoteRef(row.quote)}`,
          'aria-haspopup': 'dialog',
          on: { click: () => openOptions(row) },
        },
        moreIcon(),
      ),
    );

  const detailedActions = ({ quote, summary }) =>
    h(
      'div',
      { class: 'table-actions' },
      linkButton('', quoteDetailHref(quote, summary), { variant: 'secondary', size: 'sm', icon: 'chevronRight', attrs: { title: 'Ver detalle', 'aria-label': `Ver detalle de ${quoteRef(quote)}` } }),
      button('', { variant: 'ghost', size: 'sm', icon: 'copy', title: 'Duplicar', onClick: () => duplicate(quote), attrs: { 'aria-label': `Duplicar ${quoteRef(quote)}` } }),
      button('', { variant: 'danger', size: 'sm', icon: 'trash', title: 'Eliminar', onClick: () => remove(quote), attrs: { 'aria-label': `Eliminar ${quoteRef(quote)}` } }),
    );

  const detailedStatusCell = ({ quote }) => {
    const select = statusSelectFor(quote);
    select.addEventListener('change', () => changeStatus(quote, select.value, select));
    return select;
  };

  function renderList() {
    const filtered = filterQuoteItems(state.items, state);
    const total = state.items.length;
    countEl.textContent = total === 0 ? '' : filtered.length === total ? `${total} ${total === 1 ? 'cotización' : 'cotizaciones'}` : `${filtered.length} de ${total} cotizaciones`;
    toolbar.hidden = total === 0;
    app.setHeader({ title: 'Cotizaciones', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }], actions: total === 0 ? [] : [newQuoteAction()] });
    if (total === 0) {
      mount(listHost, noQuotesState());
      return;
    }
    if (filtered.length === 0) {
      mount(
        listHost,
        emptyState({
          icon: 'info',
          title: 'Ninguna cotización coincide con la búsqueda.',
          text: 'Probá con otro nombre, cliente o código, o mostrá todos los estados.',
          action: button('Limpiar filtros', {
            variant: 'secondary',
            onClick: () => {
              searchInput.value = '';
              statusSelect.value = '';
              state.query = '';
              state.status = '';
              renderList();
            },
          }),
        }),
      );
      return;
    }
    const detailed = state.view === 'detailed';
    const columns = detailed
      ? [...quoteColumns({ statusCell: detailedStatusCell }), { key: 'actions', label: h('span', { class: 'sr-only' }, 'Acciones'), align: 'right', className: 'col-actions', render: detailedActions }]
      : quoteSummaryColumns({ action: simpleActions });
    const tableEl = table({ columns, rows: filtered, caption: 'Listado de cotizaciones', className: ['quotes-table', 'table-cards', detailed ? 'quotes-table-detailed' : null].filter(Boolean).join(' ') });
    attachRowNavigation(tableEl, filtered, ({ quote, summary }) => app.navigate(quoteDetailHref(quote, summary)));
    mount(
      listHost,
      failedQuotesBanner(filtered),
      tableEl,
      h('p', { class: 'footnote' }, 'Montos con la actividad estimada de cada cotización. El margen es sobre el precio de venta (no es markup).'),
    );
  }

  mount(root, card({ className: 'list-card' }, toolbar, listHost));
  await load();
  return () => applySearch.cancel();
}

// ---------------------------------------------------------- nueva cotización

function choiceCard({ title, text = null, tags = [], iconName = null, className = '', onChoose }) {
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

export async function renderNewQuote(root, app) {
  const { ctx } = app;
  app.setHeader({
    title: 'Nueva cotización',
    breadcrumbs: [
      { label: 'Inicio', href: '#/inicio' },
      { label: 'Cotizaciones', href: '#/cotizaciones' },
    ],
  });

  const services = await ctx.resources.listServices();
  const choices = [];
  let busy = false;

  async function create(templateId) {
    if (busy) return;
    busy = true;
    choices.forEach((b) => {
      b.disabled = true;
    });
    try {
      const quote = await ctx.quotes.createQuote({ templateId });
      app.toast(`Cotización ${quote.code || ''} creada.`, 'success');
      app.navigate(quoteHref(quote, 'service'));
    } catch (error) {
      busy = false;
      choices.forEach((b) => {
        b.disabled = false;
      });
      app.toast(userErrorMessage(error, 'No se pudo crear la cotización.'), 'danger');
    }
  }

  choices.push(
    choiceCard({
      title: 'Empezar en blanco',
      text: 'Armás la estructura de costos desde cero, paso a paso.',
      iconName: 'plus',
      className: 'quote-choice-blank',
      onChoose: () => create(null),
    }),
  );
  services.forEach((service) => {
    choices.push(
      choiceCard({
        title: textOf(service.name, 'Plantilla sin nombre'),
        text: textOf(service.description, null),
        tags: [
          badge(labelOf(SERVICE_TYPES, service.serviceType, 'Servicio configurable'), 'navy'),
          service.illustrative ? illustrativeTag('Plantilla de demostración con valores ilustrativos') : null,
        ].filter(Boolean),
        onChoose: () => create(service.id),
      }),
    );
  });

  mount(
    root,
    h(
      'div',
      { class: 'view-narrow stack-lg' },
      pageIntro({
        title: '¿Qué servicio vas a cotizar?',
        text: 'Elegí un servicio parecido al tuyo para empezar con los recursos típicos cargados, o empezá en blanco. Después podés cambiar todo.',
      }),
      h('div', { class: 'quote-choice-grid' }, ...choices),
      services.length
        ? h('p', { class: 'muted small' }, 'Las plantillas marcadas ILUSTRATIVO traen valores de ejemplo: reemplazalos por los tuyos. Gestioná tus plantillas en ', h('a', { href: '#/servicios' }, 'Servicios'), '.')
        : h('p', { class: 'muted small' }, 'Todavía no tenés plantillas de servicio. Podés guardar cualquier cotización como plantilla desde su resultado.'),
      disclosure(
        { summary: '¿Cómo sigue?', hint: 'Cinco etapas, de la descripción del servicio a la tarifa.', className: 'disclosure-plain' },
        h(
          'ol',
          { class: 'stage-list' },
          ...QUOTE_STAGES.map((s, i) => h('li', {}, h('span', { class: 'stage-num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'stage-body' }, h('strong', {}, s.title), h('span', { class: 'muted' }, s.text)))),
        ),
        h(
          'p',
          { class: 'muted small' },
          'Podés volver a cualquier etapa y los resultados se recalculan solos. Se usan los valores por defecto de Configuración → Parámetros económicos (combustible, tasa financiera, margen objetivo, imprevistos y plazo de cobro). Si esos valores son ILUSTRATIVOS, los imprevistos y el plazo de cobro quedan para que los cargues vos.',
        ),
      ),
    ),
  );
}

