/**
 * Inicio (#/inicio): una pregunta principal ("¿Qué querés cotizar hoy?"),
 * "Continuar cotización" (el borrador más reciente), tres indicadores con
 * "Ver cálculo" y "Tus cotizaciones". Lo demás (más indicadores, atajos,
 * exportar backup y los conceptos de RATEOS) queda colapsado al final.
 *
 * Cotizaciones propias vs. de ejemplo: si hay al menos una cotización propia,
 * los indicadores, "Continuar cotización" y "Tus cotizaciones" usan SÓLO las
 * propias (las de ejemplo se pueden sumar a la lista con "Ver también los
 * ejemplos"). Si todas son de ejemplo, se muestran con una nota visible:
 * "Calculado sobre cotizaciones de ejemplo (ILUSTRATIVAS)".
 */

import { indicatorsFor } from '../../services/quote-service.js';
import { h, s, mount, downloadText } from '../dom.js';
import { bigStat, button, card, disclosure, icon, linkButton, progressBar, table, traceButton } from '../components.js';
import { createTrace } from '../../core/trace.js';
import { formatDateTime, formatMoney, formatNumber, formatPercent, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { ACTIVE_QUOTE_STATUSES, QUOTE_STATUSES, QUOTE_STEPS, labelOf } from '../../domain/catalogs.js';
import { chargeSummary } from '../../domain/unit-catalog.js';
import { DEMO_IDS } from '../../domain/demo-data.js';
import { summaryCriticalCount } from '../../domain/quote-risk.js';
import { COMPLETENESS_RISK_THRESHOLD } from '../../engines/completeness-engine.js';
import { priceFromMargin, priceFromMarkup, markupToMargin, marginToMarkup, traceMarginVsMarkup } from '../../engines/pricing-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { NEW_PRODUCT_HREF, NEW_SERVICE_HREF } from './new-calc.js';
import { productHref, unitMoney } from './products.js';
import {
  DEMO_FROM_APP_HREF,
  attachRowNavigation,
  completenessTone,
  detailLink,
  failedQuotesBanner,
  isExampleQuote,
  noQuotesState,
  quoteDetailHref,
  quoteHref,
  quoteIllustrative,
  quoteRateNode,
  quoteSummaryColumns,
  statusBadge,
  summaryFailed,
  summaryUnreliable,
  unreliableTag,
} from './quotes-list.js';
import { joinList } from '../result-text.js';

const RECENT_LIMIT = 6;

const text = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
const quoteLabel = (quote) => `${text(quote.code, 'Sin código')} · ${text(quote.name, 'Sin nombre')}`;

function activeStatusesText() {
  return ACTIVE_QUOTE_STATUSES.map((st) => labelOf(QUOTE_STATUSES, st).toLowerCase()).join(', ');
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Indicadores de un conjunto de cotizaciones: la regla vive en el servicio
 * (indicatorsFor), la misma que usa dashboardStats(). Acá sólo se elige el
 * conjunto (las propias, o todas si sólo hay de ejemplo).
 */
export const quoteIndicators = indicatorsFor;

/** Nota de alcance para las trazas ("Ver cálculo") de los indicadores. */
function scopeNote(scope) {
  return scope.mode === 'own'
    ? scope.exampleCount
      ? `Sólo tus cotizaciones: no incluye ${plural(scope.exampleCount, 'cotización de ejemplo', 'cotizaciones de ejemplo')} (ILUSTRATIVAS).`
      : null
    : 'Calculado sobre cotizaciones de ejemplo (ILUSTRATIVAS): cuando crees la tuya, los indicadores usan sólo las tuyas.';
}

/** Nota de las cotizaciones con resultado NO CONFIABLE que quedan fuera de los montos (ECO-02). */
function unreliableNote(count) {
  return count > 0
    ? `No incluye ${plural(count, 'cotización activa con resultado NO CONFIABLE', 'cotizaciones activas con resultado NO CONFIABLE')}: sus números no son reales (sí cuentan como en riesgo).`
    : null;
}

const reliableOf = (items) => items.filter(({ summary }) => !summaryUnreliable(summary));

// ---------------------------------------------------------------- trazas

function activeCountTrace(items, activeCount, scope) {
  return createTrace({
    id: 'dashboard_active_quotes',
    title: 'Cotizaciones activas',
    formula: `Activas = cantidad de cotizaciones en estado ${activeStatusesText()}`,
    inputs: QUOTE_STATUSES.map((st) => ({
      label: `${st.label}${ACTIVE_QUOTE_STATUSES.includes(st.id) ? ' (activa)' : ' (no cuenta)'}`,
      value: items.filter(({ quote }) => quote.status === st.id).length,
      format: 'number',
    })),
    result: { label: 'Cotizaciones activas', value: activeCount, format: 'number' },
    notes: ['Las perdidas y las archivadas no cuentan como activas.', scopeNote(scope)],
  });
}

function totalQuotedTrace(active, total, scope) {
  const reliable = reliableOf(active);
  return createTrace({
    id: 'dashboard_total_quoted',
    title: 'Valor total cotizado (mensual)',
    formula: 'Valor total = Σ facturación mensual esperada de cada cotización activa con resultado confiable',
    inputs: reliable.map(({ quote, summary }) => ({ label: summary.jobMonths > 0 ? `${quoteLabel(quote)} (precio total ÷ ${formatNumber(summary.jobMonths, { decimals: 2 })} meses)` : quoteLabel(quote), value: isFiniteNumber(summary.monthlyRevenue) ? summary.monthlyRevenue : isFiniteNumber(summary.revenue) ? summary.revenue : 0, format: 'money' })),
    result: { label: 'Valor total cotizado por mes', value: total, format: 'money' },
    notes: [
      `Cotizaciones activas: estados ${activeStatusesText()}.`,
      'Facturación esperada = tarifa (la sugerida o la que ofrecés) × unidades facturables con la actividad estimada + otros ingresos (abonos, equipo en espera, km).',
      'Una cotización sin tarifa suma sólo sus otros ingresos; una que no se pudo calcular suma 0.',
      unreliableNote(active.length - reliable.length),
      scopeNote(scope),
    ],
  });
}

function averageMarginTrace(active, average, scope) {
  const reliable = reliableOf(active);
  const withMargin = reliable.filter(({ summary }) => isFiniteNumber(summary.marginPct));
  return createTrace({
    id: 'dashboard_average_margin',
    title: 'Margen promedio',
    formula: 'Margen promedio = Σ márgenes / cantidad de cotizaciones activas con tarifa y resultado confiable (promedio simple) · Margen = Resultado / Facturación',
    inputs: withMargin.map(({ quote, summary }) => ({ label: quoteLabel(quote), value: summary.marginPct, format: 'percent' })),
    steps: [{ label: 'Cotizaciones promediadas', value: withMargin.length, format: 'number' }],
    result: { label: 'Margen promedio', value: average, format: 'percent' },
    notes: ['Es margen sobre precio de venta, no markup sobre costo.', 'Promedio simple: no pondera por facturación.', unreliableNote(active.length - reliable.length), scopeNote(scope)],
  });
}

function atRiskTrace(active, scope) {
  const risky = active.filter(({ summary }) => summary.atRisk || summaryUnreliable(summary));
  return createTrace({
    id: 'dashboard_at_risk',
    title: 'Cotizaciones en riesgo',
    formula: `En riesgo = sin tarifa definida, resultado negativo, margen esperado menor al margen objetivo, menos del ${COMPLETENESS_RISK_THRESHOLD} % de los costos cargados o resultado NO CONFIABLE`,
    inputs: risky.map(({ quote, summary }) =>
      summaryFailed(summary)
        ? { label: `${quoteLabel(quote)} (no se pudo calcular)`, value: null, format: 'percent' }
        : summaryUnreliable(summary)
          ? { label: `${quoteLabel(quote)} (resultado NO CONFIABLE: ${joinList(summary.unreliableLabels || [])})`, value: null, format: 'percent' }
          : { label: `${quoteLabel(quote)} (margen esperado)`, value: summary.marginPct, format: 'percent' },
    ),
    result: { label: 'Cotizaciones activas en riesgo', value: risky.length, format: 'number' },
    notes: [
      'Un "—" en el margen indica que la cotización todavía no tiene tarifa, que no se pudo calcular o que su resultado NO ES CONFIABLE (su margen no es real).',
      'Las cotizaciones que no se pudieron calcular cuentan como en riesgo: abrilas para revisar sus datos.',
      scopeNote(scope),
    ],
  });
}

function belowFloorTrace(active, scope) {
  const reliable = reliableOf(active);
  const below = reliable.filter(({ summary }) => summary.belowFloor);
  return createTrace({
    id: 'dashboard_below_floor',
    title: 'Servicios bajo piso',
    formula: 'Bajo piso = tarifa neta ofrecida < tarifa piso neta (la que iguala el costo, margen 0 %) y resultado esperado negativo',
    inputs: below.flatMap(({ quote, summary }) => [
      { label: `${quoteLabel(quote)}: tarifa neta`, value: summary.commercialNetRate, format: 'money' },
      { label: `${quoteLabel(quote)}: tarifa piso neta`, value: summary.floorNetRate, format: 'moneyCeil' },
      { label: `${quoteLabel(quote)}: resultado esperado`, value: summary.profit, format: 'money' },
    ]),
    result: { label: 'Cotizaciones activas bajo piso', value: below.length, format: 'number' },
    notes: [
      'Cotizar bajo piso significa perder plata con la actividad estimada.',
      'Si un mínimo garantizado cubre la diferencia y el mes no da pérdida, la cotización no se cuenta acá.',
      'La tarifa piso se muestra redondeada hacia arriba: cobrar esa cifra nunca deja debajo del piso.',
      unreliableNote(active.length - reliable.length),
      scopeNote(scope),
    ],
  });
}

// ------------------------------------------------------------- bienvenida

/** Ilustración abstracta (cordillera en capas), sólo decorativa. */
function heroArt() {
  return s(
    'svg',
    { class: 'home-hero-art', viewBox: '0 0 360 160', 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMaxYMax slice' },
    s('path', { d: 'M0 160 L70 92 L112 120 L176 48 L232 104 L268 78 L360 140 L360 160 Z', class: 'art-far' }),
    s('path', { d: 'M0 160 L54 122 L98 140 L162 86 L214 132 L262 106 L318 138 L360 120 L360 160 Z', class: 'art-mid' }),
    s('path', { d: 'M0 160 L80 142 L150 150 L230 128 L300 146 L360 136 L360 160 Z', class: 'art-near' }),
    s('circle', { cx: 300, cy: 40, r: 14, class: 'art-sun' }),
  );
}

/** Primer nombre para el saludo ("Hola, Joaquín."), sin datos internos. */
export function greetingName(fullName) {
  const first = typeof fullName === 'string' ? fullName.trim().split(/\s+/)[0] : '';
  return first ? first.slice(0, 40) : '';
}

function heroSection({ hasQuotes, name }) {
  const hello = name ? `Hola, ${name}.` : 'Hola.';
  return h(
    'section',
    { class: 'home-hero', 'aria-labelledby': 'home-question' },
    h(
      'div',
      { class: 'home-hero-text' },
      h('p', { class: 'home-hello' }, hello),
      h('h2', { class: 'home-question', id: 'home-question' }, hasQuotes ? '¿Qué querés calcular hoy?' : '¿Qué querés calcular primero?'),
      h('p', { class: 'home-lead' }, 'Sabé cuánto te cuesta y definí cuánto cobrar: un servicio (por día, hora, mes o trabajo terminado) o un producto (por unidad, docena o kilo).'),
      h(
        'div',
        { class: 'home-actions home-actions-split' },
        linkButton('Nuevo servicio', NEW_SERVICE_HREF, { variant: 'primary', size: 'lg', icon: 'plus', attrs: { 'aria-label': 'Nuevo servicio: calculá cuánto cuesta prestarlo y cuánto cobrar' } }),
        linkButton('Nuevo producto', NEW_PRODUCT_HREF, { variant: 'primary', size: 'lg', icon: 'plus', attrs: { 'aria-label': 'Nuevo producto: calculá cuánto cuesta cada unidad y a qué precio venderla' } }),
      ),
      hasQuotes
        ? h('p', { class: 'home-demo-link' }, '¿Querés ver cómo funciona con un servicio? ', h('a', { href: DEMO_FROM_APP_HREF }, 'Probá el ejemplo'), '.')
        : h('p', { class: 'home-demo-link' }, '¿Querés ver primero cómo funciona? ', h('a', { href: DEMO_FROM_APP_HREF }, 'Probá la demo'), ' (está aparte y no toca tus datos), ', h('a', { href: '#/configuracion/empresa' }, 'configurá tu empresa'), ' o cargá tu personal y tus equipos en ', h('a', { href: '#/recursos/personal' }, 'Recursos'), ' para usarlos en cada cotización.'),
    ),
    heroArt(),
  );
}

function continueSection(draft) {
  if (!draft || !draft.quote) return null;
  const { quote, summary } = draft;
  const failed = summaryFailed(summary);
  const client = text(quote.client, null);
  const pct = failed ? null : summary.completenessPct;
  return h(
    'section',
    { class: 'continue-card', 'aria-labelledby': 'continue-title' },
    h(
      'div',
      { class: 'continue-main' },
      h('p', { class: 'eyebrow' }, 'Continuar cotización'),
      h('h3', { class: 'continue-title', id: 'continue-title' }, text(quote.name, 'Sin nombre'), unreliableTag(summary), quoteIllustrative(quote).any ? illustrativeTag('Tiene valores ILUSTRATIVOS: reemplazalos por valores propios vigentes') : null),
      h(
        'p',
        { class: 'continue-meta' },
        statusBadge(quote.status),
        h('span', {}, [client, chargeSummary(quote), `Modificada: ${formatDateTime(quote.updatedAt)}`].filter(Boolean).join(' · ')),
      ),
      // ECO-02: el riesgo se ve antes de abrirla, no sólo dentro del Resultado.
      summaryUnreliable(summary)
        ? h('p', { class: 'continue-risk' }, h('strong', {}, 'Resultado NO CONFIABLE: '), `${joinList(summary.unreliableLabels || [])}. Resolvelo antes de usar la tarifa.`)
        : null,
    ),
    h(
      'dl',
      { class: 'continue-facts' },
      h('div', {}, h('dt', {}, 'Tarifa'), h('dd', {}, quoteRateNode(quote, summary))),
      h(
        'div',
        {},
        h('dt', {}, 'Costos cargados'),
        h(
          'dd',
          { class: 'continue-progress' },
          isFiniteNumber(pct) ? progressBar(pct, completenessTone(pct, summaryCriticalCount(summary)), { label: 'Costos cargados' }) : null,
          h('span', { class: 'mono small' }, isFiniteNumber(pct) ? formatPercent(pct, { decimals: 0 }) : EMPTY),
        ),
      ),
    ),
    linkButton('Continuar', quoteHref(quote), { variant: 'secondary', iconAfter: 'arrowRight', attrs: { 'aria-label': `Continuar la cotización ${text(quote.name, 'sin nombre')}` } }),
  );
}

// ---------------------------------------------------------- indicadores

function marginToneFor(avg, target) {
  if (!isFiniteNumber(avg)) return null;
  if (avg < 0) return 'red';
  if (target !== null && avg < target) return 'orange';
  return 'green';
}

function indicatorsSection(stats, settings, scope) {
  const active = stats.items.filter(({ quote }) => ACTIVE_QUOTE_STATUSES.includes(quote.status));
  const target = isFiniteNumber(settings.defaultTargetMarginPct) ? settings.defaultTargetMarginPct : null;
  const avg = stats.averageMarginPct;

  const more = disclosure(
    { summary: 'Ver más indicadores', hint: 'Valor total cotizado, servicios bajo piso y total de cotizaciones.', className: 'disclosure-plain' },
    h(
      'div',
      { class: 'stat-row stat-row-secondary' },
      bigStat({
        label: 'Valor total cotizado',
        value: formatMoney(stats.totalQuotedMonthly),
        unit: '/mes',
        hint: stats.unreliableCount > 0 ? 'Facturación mensual esperada de las cotizaciones activas, sin las de resultado NO CONFIABLE.' : 'Facturación mensual esperada de las cotizaciones activas.',
        trace: totalQuotedTrace(active, stats.totalQuotedMonthly, scope),
      }),
      bigStat({
        label: 'Servicios bajo piso',
        value: formatNumber(stats.belowFloorCount),
        hint: stats.unreliableCount > 0 ? 'La tarifa no cubre el costo y el mes da pérdida (sin las de resultado NO CONFIABLE).' : 'La tarifa no cubre el costo y el mes da pérdida.',
        tone: stats.belowFloorCount > 0 ? 'red' : null,
        trace: belowFloorTrace(active, scope),
      }),
      bigStat({
        label: 'Cotizaciones en total',
        value: formatNumber(stats.totalCount),
        hint: 'Incluye perdidas y archivadas.',
      }),
    ),
  );

  // Alcance visible: sólo las propias (y cuántas de ejemplo quedan afuera) o
  // todas de ejemplo (ILUSTRATIVAS).
  const scopeLine =
    scope.mode === 'examples'
      ? h('p', { class: 'indicators-scope is-examples' }, icon('info', { size: 16 }), 'Calculado sobre cotizaciones de ejemplo (ILUSTRATIVAS).')
      : scope.exampleCount
        ? h('p', { class: 'indicators-scope' }, `Sólo tus cotizaciones (no incluye ${scope.exampleCount === 1 ? 'la de ejemplo' : `las ${scope.exampleCount} de ejemplo`}).`)
        : null;

  return h(
    'section',
    { class: 'indicators', 'aria-label': 'Indicadores' },
    scopeLine,
    h(
      'div',
      { class: 'stat-row' },
      bigStat({
        label: 'Cotizaciones activas',
        value: formatNumber(stats.activeCount),
        hint: `En borrador, enviadas o ganadas.`,
        trace: activeCountTrace(stats.items, stats.activeCount, scope),
      }),
      bigStat({
        label: 'Margen promedio',
        value: formatPercent(avg),
        hint: [target !== null ? `Sobre el precio · tu objetivo: ${formatPercent(target)}` : 'Sobre el precio de venta', stats.unreliableCount > 0 ? `sin ${plural(stats.unreliableCount, 'no confiable', 'no confiables')}` : null].filter(Boolean).join(' · '),
        tone: marginToneFor(avg, target),
        trace: averageMarginTrace(active, avg, scope),
      }),
      bigStat({
        label: 'Cotizaciones en riesgo',
        value: formatNumber(stats.atRiskCount),
        hint: stats.unreliableCount > 0
          ? `Incluye ${plural(stats.unreliableCount, 'con resultado NO CONFIABLE', 'con resultado NO CONFIABLE')}. También: sin tarifa, con pérdida, debajo del objetivo o con costos incompletos.`
          : 'Sin tarifa, con pérdida, debajo del objetivo, con costos incompletos o con resultado no confiable.',
        tone: stats.atRiskCount > 0 ? 'orange' : 'green',
        trace: atRiskTrace(active, scope),
      }),
    ),
    more,
  );
}

// ------------------------------------------------------- tus cotizaciones

function quotesSection(app, { all, own, scope }) {
  const total = all.length;
  const header = h(
    'div',
    { class: 'section-head' },
    h('h2', { class: 'section-title', id: 'home-quotes' }, 'Tus cotizaciones'),
    total ? h('a', { class: 'section-link', href: '#/cotizaciones' }, total > RECENT_LIMIT ? `Ver todas (${total})` : 'Ver todas') : null,
  );
  if (total === 0) {
    return h('section', { class: 'home-section', 'aria-labelledby': 'home-quotes' }, header, noQuotesState());
  }

  // Con cotizaciones propias, las de ejemplo se muestran sólo si se piden, en
  // su propia tabla debajo de las tuyas (por fecha nunca entrarían entre las
  // más recientes: traen la fecha fija de los datos de ejemplo).
  const examples = scope.mode === 'own' ? all.filter(({ quote }) => isExampleQuote(quote)) : [];
  let showExamples = false;
  const listHost = h('div', { class: 'home-list-host', id: 'home-quotes-list' });
  const toggle =
    examples.length
      ? button('', { variant: 'link', size: 'sm', attrs: { class: 'btn btn-link btn-sm examples-toggle', 'aria-controls': 'home-quotes-list', 'aria-expanded': 'false' } })
      : null;

  /** Tabla de cotizaciones con "Ver detalle" y filas clickeables. */
  function quotesTable(rows, caption) {
    const tableEl = table({
      columns: quoteSummaryColumns({ action: ({ quote, summary }) => detailLink(quote, summary) }),
      rows,
      caption,
      className: 'quotes-table table-cards',
    });
    attachRowNavigation(tableEl, rows, ({ quote, summary }) => app.navigate(quoteDetailHref(quote, summary)));
    return tableEl;
  }

  function paintList() {
    // Propias (o, si sólo hay de ejemplo, todas): las más recientes.
    const rows = (scope.mode === 'own' ? own : all).slice(0, RECENT_LIMIT);
    const exampleRows = showExamples ? examples : [];
    // Las de ejemplo tienen su propia tabla rotulada ILUSTRATIVAS: la nota es para las de arriba.
    const illustrative = rows.filter(({ quote }) => quoteIllustrative(quote).any).length;
    mount(
      listHost,
      failedQuotesBanner([...rows, ...exampleRows]),
      card(
        { className: 'list-card' },
        quotesTable(rows, scope.mode === 'own' ? 'Tus cotizaciones más recientes' : 'Cotizaciones de ejemplo (ILUSTRATIVAS), más recientes primero'),
        illustrative
          ? h(
              'p',
              { class: 'footnote' },
              `${illustrative === 1 ? 'Una cotización tiene' : `${illustrative} cotizaciones tienen`} valores ILUSTRATIVOS (de ejemplo o que todavía no reemplazaste, como el precio del combustible o la tasa de financiación). Su Resultado dice cuáles: reemplazalos por los tuyos antes de enviarlas.`,
            )
          : null,
      ),
      exampleRows.length
        ? card(
            { title: 'Cotizaciones de ejemplo (ILUSTRATIVAS)', subtitle: 'De la empresa ficticia: no cuentan en tus indicadores.', className: 'list-card examples-card', level: 3 },
            quotesTable(exampleRows, 'Cotizaciones de ejemplo (ILUSTRATIVAS)'),
          )
        : null,
    );
    if (toggle) {
      toggle.setAttribute('aria-expanded', showExamples ? 'true' : 'false');
      mount(toggle, h('span', {}, showExamples ? 'Ocultar los ejemplos' : 'Ver también los ejemplos'));
    }
  }

  if (toggle) {
    toggle.addEventListener('click', () => {
      showExamples = !showExamples;
      paintList();
    });
  }
  paintList();

  return h(
    'section',
    { class: 'home-section', 'aria-labelledby': 'home-quotes' },
    header,
    listHost,
    toggle
      ? h(
          'p',
          { class: 'examples-note muted small' },
          `Además hay ${plural(scope.exampleCount, 'cotización de ejemplo', 'cotizaciones de ejemplo')} (ILUSTRATIVAS). `,
          toggle,
        )
      : null,
  );
}

// ------------------------------------------------------ atajos y conceptos

/** Descarga el backup JSON directamente (igual que Configuración → Datos y backup). */
function exportBackupButton(app) {
  const btn = button('Exportar backup', { variant: 'secondary', icon: 'download' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { filename, json } = await app.ctx.backup.exportBackup();
      downloadText(filename, json);
      app.toast(`Backup descargado: ${filename}`, 'success');
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo exportar el backup.'), 'danger');
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function shortcutsSection(app, stats) {
  const has = (id) => stats.items.some(({ quote }) => quote.id === id);
  return disclosure(
    { summary: 'Atajos', hint: 'Ejemplos, recursos y backup.' },
    h(
      'div',
      { class: 'shortcut-grid' },
      has(DEMO_IDS.quoteHydroCrane) ? linkButton('Abrir el ejemplo Hidrogrúa on-call', `#/cotizaciones/${DEMO_IDS.quoteHydroCrane}`, { variant: 'secondary', icon: 'quote' }) : null,
      has(DEMO_IDS.quoteReference) ? linkButton('Ejemplo: tarifa que no cubre los costos', `#/cotizaciones/${DEMO_IDS.quoteReference}`, { variant: 'secondary', icon: 'calc' }) : null,
      linkButton('Recursos', '#/recursos/personal', { variant: 'secondary', icon: 'resources' }),
      linkButton('Analizar escenarios', '#/escenarios', { variant: 'secondary', icon: 'chart' }),
      exportBackupButton(app),
    ),
    h('p', { class: 'muted small' }, 'Tus datos se guardan en tu cuenta. Igual podés exportar un backup cuando quieras.'),
  );
}

/** "y imprevistos" → "e imprevistos" (la conjunción cambia antes de "i" / "hi"). */
const andBefore = (word) => `${/^h?i(?![aeou])/i.test(word) ? 'e' : 'y'} ${word}`;

const CONCEPTS = [
  {
    key: 'cost',
    name: 'Costo',
    // Rubros con los mismos nombres que los pasos del editor (QUOTE_STEPS).
    text: `Lo que realmente te cuesta prestar el servicio en el mes: ${[
      ...['labor', 'equipment'].map((id) => labelOf(QUOTE_STEPS, id).toLowerCase()),
      'combustible',
      ...['materials', 'logistics', 'indirect', 'finance'].map((id) => labelOf(QUOTE_STEPS, id).toLowerCase()),
    ].join(', ')} ${andBefore(labelOf(QUOTE_STEPS, 'risk').toLowerCase())}.`,
  },
  { key: 'floor', name: 'Tarifa piso', text: 'El precio mínimo para no perder plata: con esa tarifa el resultado es cero (margen 0 %).' },
  { key: 'target', name: 'Precio objetivo', text: 'El precio necesario para lograr el margen que buscás con la actividad que estimás.' },
  { key: 'commercial', name: 'Precio comercial', text: 'El precio que finalmente le ofrecés al cliente, con redondeos y descuentos. Lo comparamos contra el piso y el objetivo.' },
];

function learnSection() {
  const cost = 100;
  const pct = 10;
  const byMargin = priceFromMargin(cost, pct);
  const byMarkup = priceFromMarkup(cost, pct);
  const fmt = (v) => formatNumber(v, { decimals: 2 });
  return disclosure(
    { summary: 'Cómo piensa RATEOS', hint: 'Costo, tarifa piso, precio objetivo, precio comercial y margen vs markup.' },
    h(
      'div',
      { class: 'concept-grid' },
      ...CONCEPTS.map((c, i) => h('div', { class: ['concept', `concept-${c.key}`] }, h('div', { class: 'concept-step' }, String(i + 1)), h('div', { class: 'concept-name' }, c.name), h('p', { class: 'concept-text' }, c.text))),
    ),
    h(
      'div',
      { class: 'mvm' },
      h('h3', { class: 'mvm-title' }, 'Margen y markup NO son lo mismo'),
      h(
        'div',
        { class: 'mvm-grid' },
        h(
          'div',
          { class: 'mvm-item' },
          h('div', { class: 'mvm-label' }, `Margen ${pct} % (sobre el precio)`),
          h('div', { class: 'mvm-value mono' }, `${fmt(cost)} → ${fmt(byMargin)}`),
          h('p', { class: 'small' }, `Precio = costo / (1 − ${pct} %). De cada $ ${fmt(byMargin)} que cobrás, $ ${fmt(byMargin - cost)} son ganancia. Equivale a un markup de ${formatPercent(marginToMarkup(pct))}.`),
        ),
        h(
          'div',
          { class: 'mvm-item' },
          h('div', { class: 'mvm-label' }, `Markup ${pct} % (sobre el costo)`),
          h('div', { class: 'mvm-value mono' }, `${fmt(cost)} → ${fmt(byMarkup)}`),
          h('p', { class: 'small' }, `Precio = costo × (1 + ${pct} %). La ganancia real es ${formatPercent(markupToMargin(pct))} del precio, no ${pct} %.`),
        ),
      ),
      traceButton(traceMarginVsMarkup(cost, pct)),
    ),
  );
}

// ----------------------------------------------------------- tus productos

/** "Tus productos" (sólo si hay alguno): costo por unidad y precio sugerido. */
function productsSection(app, items) {
  if (!items.length) return null;
  const rows = items.slice(0, RECENT_LIMIT);
  const tableEl = table({
    className: 'products-table table-cards',
    caption: 'Tus productos más recientes',
    rows,
    columns: [
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
      { key: 'go', label: 'Acciones', align: 'right', render: ({ product }) => linkButton('Abrir', productHref(product), { size: 'sm', attrs: { 'aria-label': `Abrir ${product.name || 'producto'}` } }) },
    ],
  });
  return h(
    'section',
    { class: 'home-section', 'aria-labelledby': 'home-products' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { class: 'section-title', id: 'home-products' }, 'Tus productos'),
      h('a', { class: 'section-link', href: '#/productos' }, items.length > RECENT_LIMIT ? `Ver todos (${items.length})` : 'Ver todos'),
    ),
    card({ className: 'list-card' }, tableEl),
  );
}

// ------------------------------------------------------------------ vista

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Inicio', breadcrumbs: [] });

  const [stats, settings, products] = await Promise.all([
    ctx.quotes.dashboardStats(),
    app.getSettings(),
    // Los productos son otro modelo: si no se pueden leer, Inicio sigue igual.
    ctx.products ? ctx.products.listProducts().catch(() => []) : Promise.resolve([]),
  ]);
  // listQuotes() ya viene ordenado: la modificada más recientemente primero.
  const all = Array.isArray(stats.items) ? stats.items : [];
  const own = all.filter(({ quote }) => !isExampleQuote(quote));
  const scope = { mode: own.length > 0 ? 'own' : 'examples', exampleCount: all.length - own.length };
  const shown = scope.mode === 'own' ? own : all;
  const indicators = quoteIndicators(shown);
  // "Continuar cotización": el último borrador propio (o, si sólo hay
  // ejemplos, el último borrador de ejemplo).
  const draft = shown.find(({ quote }) => quote.status === 'draft') || null;
  const hasQuotes = all.length > 0;

  mount(
    root,
    h(
      'div',
      { class: 'home' },
      heroSection({ hasQuotes: hasQuotes || products.length > 0, name: greetingName(ctx.account && ctx.account.user ? ctx.account.user.fullName : '') }),
      hasQuotes ? continueSection(draft) : null,
      hasQuotes ? indicatorsSection(indicators, settings, scope) : null,
      // Sin cotizaciones, el saludo ya es el estado vacío (sin botones repetidos).
      hasQuotes ? quotesSection(app, { all, own, scope }) : null,
      productsSection(app, products),
      h('div', { class: 'home-more disclosure-list' }, shortcutsSection(app, { items: all }), learnSection()),
    ),
  );
}
