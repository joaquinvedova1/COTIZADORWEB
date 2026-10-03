/**
 * Cotizaciones: listado (búsqueda, filtro por estado, acciones) y pantalla
 * "Nueva cotización" (en blanco o desde plantilla de servicio).
 *
 * También exporta columnas y helpers de presentación de cotizaciones que
 * reutiliza el Dashboard.
 */

import { h, mount, debounce } from '../dom.js';
import { badge, banner, button, card, confirmDialog, emptyState, progressBar, table } from '../components.js';
import { formatDays, formatMoney, formatPercent, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { PRICING_MODES, QUOTE_STATUSES, QUOTE_STEPS, SERVICE_TYPES, labelOf } from '../../domain/catalogs.js';
import { illustrativeInfo } from '../../domain/quote-factory.js';
import { completenessTone } from '../../engines/completeness-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { serviceTemplateCard } from './services.js';

export { completenessTone };

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
      : 'Tiene valores ILUSTRATIVOS copiados de plantillas, bibliotecas o Configuración: reemplazalos por valores propios vigentes',
  );
}

/** Texto seguro para mostrar (los datos importados pueden traer cualquier tipo). */
function textOf(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function completenessCell(pct) {
  return h(
    'div',
    { class: 'completeness-cell', title: 'Cost Completeness Score: qué tan completa está la estructura de costos' },
    progressBar(pct, completenessTone(pct), { label: 'Completitud de costos' }),
    h('span', { class: 'mono small' }, formatPercent(pct, { decimals: 0 })),
  );
}

const muted = (text = EMPTY) => h('span', { class: 'muted' }, text);

/**
 * Columnas estándar de una tabla de cotizaciones. Cada fila es
 * `{ quote, summary }` (resultado de quotes.listQuotes()).
 */
export function quoteColumns({ statusCell = null } = {}) {
  return [
    {
      key: 'quote',
      label: 'Cotización',
      render: ({ quote, summary }) => {
        const failed = summaryFailed(summary);
        return h(
          'div',
          { class: 'cell-main' },
          h('a', { href: quoteHref(quote), class: 'cell-title' }, textOf(quote.name, 'Sin nombre')),
          h('span', { class: 'cell-sub' }, h('span', { class: 'mono' }, textOf(quote.code, EMPTY)), ` · ${labelOf(SERVICE_TYPES, quote.serviceType)}`),
          h('span', { class: 'cell-sub' }, `Modalidad: ${labelOf(PRICING_MODES, quote.pricingMode)}`),
          failed
            ? h(
                'span',
                { class: 'cell-error' },
                badge('No se pudo calcular', 'red', { title: 'Esta cotización tiene datos que no se pueden calcular. Abrila para revisarlos.' }),
                h('a', { href: quoteHref(quote), class: 'cell-error-link' }, 'Abrir y revisar'),
              )
            : null,
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
    {
      key: 'rate',
      label: 'Tarifa comercial',
      align: 'right',
      render: ({ quote, summary }) => {
        if (summaryFailed(summary)) return muted();
        return isFiniteNumber(summary.commercialListRate)
          ? h('span', { class: 'nowrap' }, formatMoney(summary.commercialListRate), h('span', { class: 'unit-suffix' }, ` /${UNIT_SHORT[quote.unit] || 'unidad'}`))
          : muted('Sin tarifa');
      },
    },
    {
      key: 'margin',
      label: 'Margen esperado',
      align: 'right',
      // Sin tarifa comercial el margen es null: se muestra "—" sin badge.
      render: ({ summary }) =>
        !summaryFailed(summary) && isFiniteNumber(summary.marginPct)
          ? badge(formatPercent(summary.marginPct), marginTone(summary), { title: 'Margen sobre precio de venta (no es markup)' })
          : h('span', { class: 'muted', title: summaryFailed(summary) ? 'No se pudo calcular' : 'Sin tarifa comercial no hay margen' }, EMPTY),
    },
    {
      key: 'breakEven',
      label: 'Break-even',
      align: 'right',
      render: ({ quote, summary }) => {
        if (summaryFailed(summary)) return muted();
        return quote.unit === 'month'
          ? h('span', { class: 'muted', title: 'Con abono mensual la facturación no depende de los días: no hay break-even en días.' }, 'No aplica')
          : h('span', { class: 'nowrap', title: 'Días activos por mes necesarios para no perder plata' }, formatDays(summary.breakEvenDays));
      },
    },
    { key: 'completeness', label: 'Completitud', render: ({ summary }) => (summaryFailed(summary) ? muted() : completenessCell(summary.completenessPct)) },
    { key: 'status', label: 'Estado', render: statusCell || (({ quote }) => statusBadge(quote.status)) },
  ];
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
      app.toast(`${textOf(quote.code, 'Cotización')}: estado "${labelOf(QUOTE_STATUSES, status)}".`, 'success');
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
      app.toast(`Se creó ${copy.code}: copia de ${quoteRef(quote)}.`, 'success');
      await load();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo duplicar la cotización.'), 'danger');
    }
  }

  async function remove(quote) {
    const ok = await confirmDialog({
      title: 'Eliminar cotización',
      message: `¿Eliminar "${textOf(quote.name, 'Sin nombre')}" (${textOf(quote.code, 'sin código')})? No se puede deshacer. Si querés conservarla, exportá un backup antes desde Configuración.`,
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
      { class: 'status-select', 'aria-label': `Estado de ${quoteRef(quote)}`, dataset: { tone: STATUS_TONES[quote.status] || 'gray' } },
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
      button('', { variant: 'secondary', size: 'sm', icon: 'chevronRight', title: 'Abrir', onClick: () => app.navigate(quoteHref(quote)), attrs: { 'aria-label': `Abrir ${quoteRef(quote)}` } }),
      button('', { variant: 'ghost', size: 'sm', icon: 'copy', title: 'Duplicar', onClick: () => duplicate(quote), attrs: { 'aria-label': `Duplicar ${quoteRef(quote)}` } }),
      button('', { variant: 'danger', size: 'sm', icon: 'trash', title: 'Eliminar', onClick: () => remove(quote), attrs: { 'aria-label': `Eliminar ${quoteRef(quote)}` } }),
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
    const failed = filtered.filter(({ summary }) => summaryFailed(summary)).length;
    mount(
      listHost,
      failed
        ? banner(
            `${failed === 1 ? 'Una cotización no se pudo calcular' : `${failed} cotizaciones no se pudieron calcular`} porque tiene${failed === 1 ? '' : 'n'} datos inválidos (por ejemplo, de un backup importado). Abrila${failed === 1 ? '' : 's'} para revisar los valores.`,
            'warning',
          )
        : null,
      tableEl,
    );
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
        h('p', { class: 'muted small' }, 'Se usan los valores por defecto de Configuración (combustible, tasa financiera, margen objetivo, contingencia y plazo de cobro). Si esos valores son ILUSTRATIVOS, la contingencia y el plazo de cobro quedan para que los cargues vos.'),
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
