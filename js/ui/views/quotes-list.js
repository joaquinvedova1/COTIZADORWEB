/**
 * Cotizaciones: listado (búsqueda, filtro por estado, acciones) y pantalla
 * "Nueva cotización" (en blanco o desde plantilla de servicio).
 *
 * También exporta columnas y helpers de presentación de cotizaciones que
 * reutiliza el Dashboard.
 */

import { h, mount, debounce } from '../dom.js';
import { badge, button, card, confirmDialog, emptyState, progressBar, table } from '../components.js';
import { formatDays, formatMoney, formatPercent, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { PRICING_MODES, QUOTE_STATUSES, QUOTE_STEPS, SERVICE_TYPES, labelOf } from '../../domain/catalogs.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { serviceTemplateCard } from './services.js';

// ------------------------------------------------------- helpers compartidos

export const UNIT_SHORT = Object.freeze({ day: 'día', hour: 'hora', month: 'mes' });

const STATUS_TONES = Object.freeze({ draft: 'gray', sent: 'blue', won: 'green', lost: 'red', archived: 'navy' });

/** Ruta del editor de una cotización. */
export function quoteHref(quote, step = null) {
  const base = `#/cotizaciones/${encodeURIComponent(quote.id)}`;
  return step ? `${base}/${step}` : base;
}

export function statusBadge(status) {
  return badge(labelOf(QUOTE_STATUSES, status, 'Sin estado'), STATUS_TONES[status] || 'gray');
}

/** Color del margen: rojo si pierde plata o está bajo piso, naranja si no llega al objetivo. */
export function marginTone(summary) {
  if (!summary || !isFiniteNumber(summary.marginPct)) return 'gray';
  if (summary.marginPct < 0 || summary.belowFloor) return 'red';
  if (summary.belowTarget) return 'orange';
  return 'green';
}

export function completenessTone(pct) {
  if (!isFiniteNumber(pct)) return 'red';
  if (pct >= 80) return 'green';
  if (pct >= 50) return 'orange';
  return 'red';
}

function completenessCell(pct) {
  return h(
    'div',
    { class: 'completeness-cell', title: 'Cost Completeness Score: qué tan completa está la estructura de costos' },
    progressBar(pct, completenessTone(pct), { label: 'Completitud de costos' }),
    h('span', { class: 'mono small' }, formatPercent(pct, { decimals: 0 })),
  );
}

/**
 * Columnas estándar de una tabla de cotizaciones. Cada fila es
 * `{ quote, summary }` (resultado de quotes.listQuotes()).
 */
export function quoteColumns({ statusCell = null } = {}) {
  return [
    {
      key: 'quote',
      label: 'Cotización',
      render: ({ quote }) =>
        h(
          'div',
          { class: 'cell-main' },
          h('a', { href: quoteHref(quote), class: 'cell-title' }, quote.name || 'Sin nombre'),
          h('span', { class: 'cell-sub' }, h('span', { class: 'mono' }, quote.code || EMPTY), ` · ${labelOf(SERVICE_TYPES, quote.serviceType)}`),
          h('span', { class: 'cell-sub' }, `Modalidad: ${labelOf(PRICING_MODES, quote.pricingMode)}`),
          quote.illustrative ? illustrativeTag('Cotización de demostración con valores ilustrativos') : null,
        ),
    },
    { key: 'client', label: 'Cliente', render: ({ quote }) => (quote.client ? quote.client : h('span', { class: 'muted' }, EMPTY)) },
    { key: 'totalCost', label: 'Costo mensual', align: 'right', render: ({ summary }) => h('span', { class: 'nowrap' }, formatMoney(summary.totalCost)) },
    {
      key: 'rate',
      label: 'Tarifa comercial',
      align: 'right',
      render: ({ quote, summary }) =>
        isFiniteNumber(summary.commercialListRate)
          ? h('span', { class: 'nowrap' }, formatMoney(summary.commercialListRate), h('span', { class: 'unit-suffix' }, ` /${UNIT_SHORT[quote.unit] || 'unidad'}`))
          : h('span', { class: 'muted' }, 'Sin tarifa'),
    },
    {
      key: 'margin',
      label: 'Margen esperado',
      align: 'right',
      render: ({ summary }) => (isFiniteNumber(summary.marginPct) ? badge(formatPercent(summary.marginPct), marginTone(summary), { title: 'Margen sobre precio de venta (no es markup)' }) : h('span', { class: 'muted' }, EMPTY)),
    },
    {
      key: 'breakEven',
      label: 'Break-even',
      align: 'right',
      render: ({ quote, summary }) =>
        quote.unit === 'month'
          ? h('span', { class: 'muted', title: 'Con abono mensual la facturación no depende de los días: no hay break-even en días.' }, 'No aplica')
          : h('span', { class: 'nowrap', title: 'Días activos por mes necesarios para no perder plata' }, formatDays(summary.breakEvenDays)),
    },
    { key: 'completeness', label: 'Completitud', render: ({ summary }) => completenessCell(summary.completenessPct) },
    { key: 'status', label: 'Estado', render: statusCell || (({ quote }) => statusBadge(quote.status)) },
  ];
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

// -------------------------------------------------------------------- listado

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({
    title: 'Cotizaciones',
    breadcrumbs: [{ label: 'Inicio', href: '#/' }],
    actions: [button('Nueva cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') })],
  });

  const state = { query: '', status: '', items: [] };
  const listHost = h('div', { class: 'quotes-list-host' });
  const countEl = h('span', { class: 'muted small', role: 'status' });

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
      app.toast(`${quote.code || 'Cotización'}: estado "${labelOf(QUOTE_STATUSES, status)}".`, 'success');
      await load();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo cambiar el estado.'), 'danger');
      select.value = quote.status;
      select.disabled = false;
    }
  }

  async function duplicate(quote) {
    try {
      const copy = await ctx.quotes.duplicateQuote(quote.id);
      if (!copy) throw new Error('not_found');
      app.toast(`Se creó ${copy.code}: copia de ${quote.code || quote.name}.`, 'success');
      await load();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo duplicar la cotización.'), 'danger');
    }
  }

  async function remove(quote) {
    const ok = await confirmDialog({
      title: 'Eliminar cotización',
      message: `¿Eliminar "${quote.name}" (${quote.code || 'sin código'})? No se puede deshacer. Si querés conservarla, exportá un backup antes desde Configuración.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.quotes.deleteQuote(quote.id);
      app.toast('Cotización eliminada.', 'success');
      await load();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo eliminar la cotización.'), 'danger');
    }
  }

  const statusCell = ({ quote }) => {
    const select = h(
      'select',
      { class: 'status-select', 'aria-label': `Estado de ${quote.code || quote.name}`, dataset: { tone: STATUS_TONES[quote.status] || 'gray' } },
      ...QUOTE_STATUSES.map((s) => h('option', { value: s.id, selected: s.id === quote.status }, s.label)),
    );
    select.value = quote.status;
    select.addEventListener('change', () => changeStatus(quote, select.value, select));
    return select;
  };

  const actionsCell = ({ quote }) =>
    h(
      'div',
      { class: 'table-actions' },
      button('', { variant: 'secondary', size: 'sm', icon: 'chevronRight', title: 'Abrir', onClick: () => app.navigate(quoteHref(quote)), attrs: { 'aria-label': `Abrir ${quote.code || quote.name}` } }),
      button('', { variant: 'ghost', size: 'sm', icon: 'copy', title: 'Duplicar', onClick: () => duplicate(quote), attrs: { 'aria-label': `Duplicar ${quote.code || quote.name}` } }),
      button('', { variant: 'danger', size: 'sm', icon: 'trash', title: 'Eliminar', onClick: () => remove(quote), attrs: { 'aria-label': `Eliminar ${quote.code || quote.name}` } }),
    );

  function renderList() {
    const filtered = filterQuoteItems(state.items, state);
    const total = state.items.length;
    countEl.textContent = total === 0 ? '' : filtered.length === total ? `${total} ${total === 1 ? 'cotización' : 'cotizaciones'}` : `${filtered.length} de ${total} cotizaciones`;
    if (total === 0) {
      mount(listHost, emptyState('Todavía no hay cotizaciones.', button('Crear la primera cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') })));
      return;
    }
    if (filtered.length === 0) {
      mount(
        listHost,
        emptyState(
          'Ninguna cotización coincide con la búsqueda.',
          button('Limpiar filtros', {
            variant: 'secondary',
            onClick: () => {
              searchInput.value = '';
              statusSelect.value = '';
              state.query = '';
              state.status = '';
              renderList();
            },
          }),
        ),
      );
      return;
    }
    const columns = [...quoteColumns({ statusCell }), { key: 'actions', label: 'Acciones', align: 'right', render: actionsCell }];
    const tableEl = table({ columns, rows: filtered, caption: 'Listado de cotizaciones', className: 'quotes-table' });
    attachRowNavigation(tableEl, filtered, ({ quote }) => app.navigate(quoteHref(quote)));
    mount(listHost, tableEl);
  }

  mount(
    root,
    card(
      { title: 'Todas las cotizaciones', subtitle: 'Montos mensuales con la actividad estimada de cada cotización. El margen es sobre precio de venta (no es markup).' },
      h('div', { class: 'toolbar' }, searchInput, statusSelect, h('span', { class: 'spacer' }), countEl),
      listHost,
    ),
  );
  await load();
  return () => applySearch.cancel();
}

// ---------------------------------------------------------- nueva cotización

export async function renderNewQuote(root, app) {
  const { ctx } = app;
  app.setHeader({
    title: 'Nueva cotización',
    breadcrumbs: [
      { label: 'Inicio', href: '#/' },
      { label: 'Cotizaciones', href: '#/cotizaciones' },
    ],
  });

  const services = await ctx.resources.listServices();
  const buttons = [];
  let busy = false;

  async function create(templateId) {
    if (busy) return;
    busy = true;
    buttons.forEach((b) => {
      b.disabled = true;
    });
    try {
      const quote = await ctx.quotes.createQuote({ templateId });
      app.toast(`Cotización ${quote.code || ''} creada.`, 'success');
      app.navigate(quoteHref(quote, 'service'));
    } catch (error) {
      busy = false;
      buttons.forEach((b) => {
        b.disabled = false;
      });
      app.toast(userErrorMessage(error, 'No se pudo crear la cotización.'), 'danger');
    }
  }

  const blankBtn = button('Empezar en blanco', { variant: 'primary', icon: 'plus', onClick: () => create(null) });
  buttons.push(blankBtn);

  const flow = h(
    'ol',
    { class: 'flow-steps', 'aria-label': 'Pasos de la cotización' },
    ...QUOTE_STEPS.map((step, i) => h('li', {}, h('span', { class: 'flow-num', 'aria-hidden': 'true' }, String(i + 1)), h('span', {}, step.label))),
  );

  const templateCards = services.map((service) => {
    const useBtn = button('Usar esta plantilla', { variant: 'secondary', size: 'sm', icon: 'chevronRight', onClick: () => create(service.id) });
    buttons.push(useBtn);
    return serviceTemplateCard(service, [useBtn]);
  });

  mount(
    root,
    h('p', { class: 'page-intro' }, 'Elegí cómo empezar. Después recorrés los pasos en orden; podés volver a cualquiera y los resultados se recalculan solos.'),
    flow,
    h(
      'div',
      { class: 'new-quote-grid' },
      card(
        { title: 'Empezar en blanco', subtitle: 'Armás la estructura de costos desde cero.', className: 'new-quote-blank' },
        h('p', {}, 'En el primer paso elegís el tipo de servicio (on-call, permanente, cuadrilla, equipo con operador, etc.) y cómo te pidieron cotizar.'),
        h('p', { class: 'muted small' }, 'Se usan los valores por defecto de Configuración (combustible, tasa financiera, margen objetivo, contingencia).'),
        blankBtn,
      ),
      card(
        { title: 'Desde una plantilla de servicio', subtitle: 'Precargan tipo de servicio, actividad y recursos típicos. Todo se puede cambiar después.' },
        templateCards.length
          ? h('div', { class: 'template-grid' }, ...templateCards)
          : emptyState('No hay plantillas de servicio cargadas.', button('Ver plantillas', { variant: 'secondary', onClick: () => app.navigate('#/servicios') })),
      ),
    ),
  );
}
