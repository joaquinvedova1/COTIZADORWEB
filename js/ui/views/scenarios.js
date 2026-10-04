/**
 * Escenarios.
 *
 * - #/escenarios: "¿Qué cotización querés analizar?" (lista para elegir).
 * - #/escenarios/:id: análisis de "¿Qué pasa si…?" (sensibilidad, escenarios
 *   y comparador de modelos) de una cotización, sin modificarla. El análisis
 *   lo dibuja `renderScenarioAnalysis` de la pantalla de resultado; si no
 *   está disponible, se ofrece el resultado completo de la cotización.
 */

import { h, mount } from '../dom.js';
import { banner, card, emptyState, linkButton, pageIntro, table } from '../components.js';
import { computeQuote } from '../../engines/quote-engine.js';
import { logger } from '../../core/logger.js';
import { illustrativeTag } from '../layout.js';
import * as resultView from './quote-result.js';
import { attachRowNavigation, failedQuotesBanner, quoteHref, quoteIllustrative, quoteRef, quoteSummaryColumns, summaryFailed } from './quotes-list.js';

const text = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);

const scenarioHref = (quote) => `#/escenarios/${encodeURIComponent(quote.id)}`;

function resultHref(quote) {
  return quoteHref(quote, 'result');
}

// ------------------------------------------------------------------ lista

async function renderPicker(root, app) {
  app.setHeader({ title: 'Escenarios', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const items = await app.ctx.quotes.listQuotes();
  const intro = pageIntro({
    title: '¿Qué cotización querés analizar?',
    text: 'Probá qué pasa si cambian los costos, los días de trabajo o las condiciones, sin modificar tu cotización.',
  });

  if (!items.length) {
    mount(
      root,
      h(
        'div',
        { class: 'stack-lg' },
        intro,
        emptyState({
          icon: 'chart',
          title: 'Todavía no tenés cotizaciones para analizar.',
          text: 'Creá una cotización y después volvé acá para ver qué pasa si cambian los costos o los días de trabajo.',
          action: linkButton('Crear una cotización', '#/cotizaciones/nueva', { variant: 'primary', icon: 'plus' }),
          secondary: linkButton('Probar con un ejemplo', '#/demo', { variant: 'secondary', icon: 'play' }),
        }),
      ),
    );
    return;
  }

  const analyzeLink = ({ quote, summary }) =>
    summaryFailed(summary)
      ? linkButton('Revisar', quoteHref(quote), { variant: 'secondary', size: 'sm', attrs: { 'aria-label': `Revisar ${quoteRef(quote)}` } })
      : linkButton('Analizar', scenarioHref(quote), { variant: 'secondary', size: 'sm', iconAfter: 'arrowRight', attrs: { 'aria-label': `Analizar escenarios de ${quoteRef(quote)}` } });

  const tableEl = table({
    columns: quoteSummaryColumns({ action: analyzeLink, href: ({ quote, summary }) => (summaryFailed(summary) ? quoteHref(quote) : scenarioHref(quote)) }),
    rows: items,
    caption: 'Cotizaciones para analizar',
    className: 'quotes-table table-cards',
  });
  attachRowNavigation(tableEl, items, ({ quote, summary }) => app.navigate(summaryFailed(summary) ? quoteHref(quote) : scenarioHref(quote)));

  mount(
    root,
    h(
      'div',
      { class: 'stack-lg' },
      intro,
      failedQuotesBanner(items),
      card({ className: 'list-card' }, tableEl, h('p', { class: 'footnote' }, 'Analizar no cambia la cotización: los "¿Qué pasa si…?" se calculan aparte.')),
    ),
  );
}

// --------------------------------------------------------------- análisis

function fallback(quote, message) {
  return emptyState({
    icon: 'chart',
    title: 'El análisis de escenarios no está disponible acá.',
    text: message || 'Podés ver la sensibilidad, los escenarios y el comparador de modelos dentro del resultado de la cotización, en "Analizar escenarios".',
    action: linkButton('Ver el resultado completo', resultHref(quote), { variant: 'primary', iconAfter: 'arrowRight' }),
  });
}

async function renderAnalysis(root, app, id) {
  const { ctx } = app;
  const [quote, settings] = await Promise.all([ctx.quotes.getQuote(id), app.getSettings()]);
  if (!quote) {
    app.setHeader({ title: 'Escenarios', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }, { label: 'Escenarios', href: '#/escenarios' }] });
    mount(
      root,
      emptyState({
        icon: 'info',
        title: 'No encontramos esa cotización.',
        text: 'Puede que se haya eliminado. Elegí otra para analizar.',
        action: linkButton('Elegir una cotización', '#/escenarios', { variant: 'primary' }),
      }),
    );
    return undefined;
  }

  const name = text(quote.name, 'Cotización sin nombre');
  app.setHeader({
    title: name,
    breadcrumbs: [
      { label: 'Inicio', href: '#/inicio' },
      { label: 'Escenarios', href: '#/escenarios' },
    ],
    actions: [linkButton('Ver cotización', resultHref(quote), { variant: 'secondary', icon: 'quote' })],
  });

  const head = h(
    'div',
    { class: 'scenario-head' },
    pageIntro({
      eyebrow: 'Escenarios',
      title: '¿Qué pasa si…?',
      text: 'Cambiá costos, días de trabajo o condiciones y mirá cómo se mueven la tarifa y el margen. Tu cotización no se modifica.',
    }),
    h(
      'p',
      { class: 'scenario-quote muted small' },
      'Cotización: ',
      h('a', { href: resultHref(quote) }, `${text(quote.code, 'Sin código')} · ${name}`),
      // La marca ILUSTRATIVO la muestra el propio análisis (renderScenarioAnalysis); en el
      // respaldo (sin análisis) se agrega acá para no perderla.
      quoteIllustrative(quote).any && typeof resultView.renderScenarioAnalysis !== 'function'
        ? illustrativeTag('Tiene valores ILUSTRATIVOS: reemplazalos por valores propios vigentes')
        : null,
    ),
  );
  const host = h('div', { class: 'scenario-host' });
  mount(root, h('div', { class: 'stack-lg' }, head, host));

  let result;
  try {
    result = computeQuote(quote, { settings });
  } catch (error) {
    logger.warn('No se pudo calcular la cotización para escenarios', { name: error && error.name });
    mount(
      host,
      banner('Esta cotización tiene datos que no se pueden calcular. Abrila para revisarlos.', 'warning'),
      linkButton('Abrir y revisar', quoteHref(quote), { variant: 'primary' }),
    );
    return undefined;
  }

  if (typeof resultView.renderScenarioAnalysis !== 'function') {
    mount(host, fallback(quote));
    return undefined;
  }
  try {
    const returned = await resultView.renderScenarioAnalysis(host, app, { quote, result, settings });
    return typeof returned === 'function' ? returned : undefined;
  } catch (error) {
    logger.error('No se pudo mostrar el análisis de escenarios', { message: error && error.message });
    mount(host, fallback(quote, 'Ocurrió un error al preparar el análisis. Tus datos no se modificaron: podés verlo dentro del resultado de la cotización.'));
    return undefined;
  }
}

// ------------------------------------------------------------------ vista

export async function render(root, app, params = {}) {
  if (params && typeof params.id === 'string' && params.id !== '') return renderAnalysis(root, app, params.id);
  return renderPicker(root, app);
}
