/**
 * Dashboard: indicadores de cotizaciones activas, cotizaciones recientes,
 * accesos rápidos y una explicación breve de los conceptos de RATEOS.
 */

import { h, mount, downloadText } from '../dom.js';
import { banner, button, card, emptyState, kpi, table, traceButton } from '../components.js';
import { createTrace } from '../../core/trace.js';
import { formatMoney, formatNumber, formatPercent } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { ACTIVE_QUOTE_STATUSES, QUOTE_STATUSES, labelOf } from '../../domain/catalogs.js';
import { DEMO_IDS } from '../../domain/demo-data.js';
import { COMPLETENESS_RISK_THRESHOLD } from '../../engines/completeness-engine.js';
import { priceFromMargin, priceFromMarkup, markupToMargin, marginToMarkup, traceMarginVsMarkup } from '../../engines/pricing-engine.js';
import { userErrorMessage } from '../layout.js';
import { attachRowNavigation, quoteColumns, quoteHref, quoteIllustrative, summaryFailed } from './quotes-list.js';

const RECENT_LIMIT = 8;

const text = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
const quoteLabel = (quote) => `${text(quote.code, 'Sin código')} · ${text(quote.name, 'Sin nombre')}`;

function activeStatusesText() {
  return ACTIVE_QUOTE_STATUSES.map((s) => labelOf(QUOTE_STATUSES, s).toLowerCase()).join(', ');
}

// ---------------------------------------------------------------- trazas

function totalQuotedTrace(active, total) {
  return createTrace({
    id: 'dashboard_total_quoted',
    title: 'Valor total cotizado (mensual)',
    formula: 'Valor total = Σ facturación mensual esperada de cada cotización activa',
    inputs: active.map(({ quote, summary }) => ({ label: quoteLabel(quote), value: isFiniteNumber(summary.revenue) ? summary.revenue : 0, format: 'money' })),
    result: { label: 'Valor total cotizado por mes', value: total, format: 'money' },
    notes: [
      `Cotizaciones activas: estados ${activeStatusesText()}.`,
      'Facturación esperada = tarifa comercial × unidades facturables con la actividad estimada + otros ingresos (fees, standby, km).',
      'Una cotización sin tarifa suma sólo sus otros ingresos; una que no se pudo calcular suma 0.',
    ],
  });
}

function averageMarginTrace(active, average) {
  const withMargin = active.filter(({ summary }) => isFiniteNumber(summary.marginPct));
  return createTrace({
    id: 'dashboard_average_margin',
    title: 'Margen promedio',
    formula: 'Margen promedio = Σ márgenes / cantidad de cotizaciones activas con tarifa (promedio simple) · Margen = Resultado / Facturación',
    inputs: withMargin.map(({ quote, summary }) => ({ label: quoteLabel(quote), value: summary.marginPct, format: 'percent' })),
    steps: [{ label: 'Cotizaciones promediadas', value: withMargin.length, format: 'number' }],
    result: { label: 'Margen promedio', value: average, format: 'percent' },
    notes: ['Es margen sobre precio de venta, no markup sobre costo.', 'Promedio simple: no pondera por facturación.'],
  });
}

function atRiskTrace(active) {
  const risky = active.filter(({ summary }) => summary.atRisk);
  return createTrace({
    id: 'dashboard_at_risk',
    title: 'Cotizaciones con riesgo',
    formula: `Con riesgo = sin tarifa definida, resultado negativo, margen esperado menor al margen objetivo o completitud de costos menor a ${COMPLETENESS_RISK_THRESHOLD} %`,
    inputs: risky.map(({ quote, summary }) =>
      summaryFailed(summary)
        ? { label: `${quoteLabel(quote)} (no se pudo calcular)`, value: null, format: 'percent' }
        : { label: `${quoteLabel(quote)} (margen esperado)`, value: summary.marginPct, format: 'percent' },
    ),
    result: { label: 'Cotizaciones activas con riesgo', value: risky.length, format: 'number' },
    notes: [
      'Un "—" en el margen indica que la cotización todavía no tiene tarifa comercial (o que no se pudo calcular).',
      'Las cotizaciones que no se pudieron calcular cuentan como con riesgo: abrilas para revisar sus datos.',
    ],
  });
}

function belowFloorTrace(active) {
  const below = active.filter(({ summary }) => summary.belowFloor);
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
    ],
  });
}

// ----------------------------------------------------------- componentes

function kpiSection(stats, settings) {
  const active = stats.items.filter(({ quote }) => ACTIVE_QUOTE_STATUSES.includes(quote.status));
  const target = isFiniteNumber(settings.defaultTargetMarginPct) ? settings.defaultTargetMarginPct : null;
  const avg = stats.averageMarginPct;
  let marginTone = null;
  if (isFiniteNumber(avg)) marginTone = avg < 0 ? 'red' : target !== null && avg < target ? 'orange' : 'green';

  return h(
    'div',
    { class: 'kpi-grid dashboard-kpis' },
    kpi({ label: 'Cotizaciones activas', value: formatNumber(stats.activeCount), hint: `De ${formatNumber(stats.totalCount)} en total (${activeStatusesText()})` }),
    kpi({
      label: 'Valor total cotizado',
      value: formatMoney(stats.totalQuotedMonthly),
      hint: 'Facturación mensual esperada de las cotizaciones activas',
      emphasis: true,
      trace: totalQuotedTrace(active, stats.totalQuotedMonthly),
    }),
    kpi({
      label: 'Margen promedio',
      value: formatPercent(avg),
      hint: target !== null ? `Sobre precio de venta · objetivo por defecto ${formatPercent(target)}` : 'Sobre precio de venta',
      tone: marginTone,
      trace: averageMarginTrace(active, avg),
    }),
    kpi({
      label: 'Cotizaciones con riesgo',
      value: formatNumber(stats.atRiskCount),
      hint: 'Sin tarifa, con pérdida, debajo del margen objetivo o con costos incompletos',
      tone: stats.atRiskCount > 0 ? 'orange' : 'green',
      trace: atRiskTrace(active),
    }),
    kpi({
      label: 'Servicios bajo piso',
      value: formatNumber(stats.belowFloorCount),
      hint: 'La tarifa no cubre el costo y el mes da pérdida',
      tone: stats.belowFloorCount > 0 ? 'red' : 'green',
      trace: belowFloorTrace(active),
    }),
  );
}

function recentSection(app, stats) {
  const actions = [button('Ver todas', { variant: 'secondary', size: 'sm', onClick: () => app.navigate('#/cotizaciones') })];
  if (stats.items.length === 0) {
    return card(
      { title: 'Cotizaciones recientes' },
      emptyState(
        'Todavía no tenés cotizaciones. Creá la primera: en pocos pasos vas a saber cuánto te cuesta el servicio y a qué tarifa conviene cotizarlo.',
        button('Crear mi primera cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') }),
      ),
    );
  }
  const rows = stats.items.slice(0, RECENT_LIMIT);
  const tableEl = table({ columns: quoteColumns(), rows, caption: 'Cotizaciones recientes', className: 'quotes-table' });
  attachRowNavigation(tableEl, rows, ({ quote }) => app.navigate(quoteHref(quote)));
  const failed = stats.items.filter(({ summary }) => summaryFailed(summary)).length;
  const illustrative = stats.items.filter(({ quote }) => quoteIllustrative(quote).any).length;
  return card(
    {
      title: 'Cotizaciones recientes',
      subtitle: 'Montos mensuales con la actividad estimada de cada cotización. Hacé clic en una fila para abrirla.',
      actions,
    },
    h(
      'div',
      { class: 'stack stack-tight' },
      failed
        ? banner(
            `${failed === 1 ? 'Una cotización no se pudo calcular' : `${failed} cotizaciones no se pudieron calcular`}: abrila${failed === 1 ? '' : 's'} desde Cotizaciones para revisar sus datos. El resto de los indicadores se calcula igual.`,
            'warning',
          )
        : null,
      illustrative
        ? h(
            'p',
            { class: 'muted small' },
            `${illustrative === 1 ? 'Una cotización tiene' : `${illustrative} cotizaciones tienen`} valores ILUSTRATIVOS (de la demo, de plantillas o de bibliotecas de ejemplo): reemplazalos por valores propios antes de enviarlas.`,
          )
        : null,
      tableEl,
    ),
  );
}

/** Descarga el backup JSON directamente (igual que Configuración → Backup). */
function exportBackupButton(app) {
  const btn = button('Exportar backup', { variant: 'ghost', icon: 'download' });
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

function quickActionsSection(app, stats) {
  const has = (id) => stats.items.some(({ quote }) => quote.id === id);
  return card(
    { title: 'Accesos rápidos', className: 'quick-actions-card' },
    h(
      'div',
      { class: 'quick-actions' },
      button('Nueva cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') }),
      has(DEMO_IDS.quoteHydroCrane)
        ? button('Abrir demo Hidrogrúa on-call', { variant: 'secondary', icon: 'quote', onClick: () => app.navigate(`#/cotizaciones/${DEMO_IDS.quoteHydroCrane}`) })
        : null,
      has(DEMO_IDS.quoteReference)
        ? button('Caso de referencia break-even', { variant: 'secondary', icon: 'calc', onClick: () => app.navigate(`#/cotizaciones/${DEMO_IDS.quoteReference}`) })
        : null,
      button('Bibliotecas de recursos', { variant: 'secondary', icon: 'library', onClick: () => app.navigate('#/biblioteca') }),
      exportBackupButton(app),
    ),
    h('p', { class: 'muted small' }, 'Tus datos se guardan sólo en este navegador. Exportá un backup de vez en cuando.'),
  );
}

const CONCEPTS = [
  { key: 'cost', name: 'Costo', text: 'Lo que realmente te cuesta prestar el servicio en el mes: personal, equipos, combustible, materiales, logística, estructura, financiero y contingencia.' },
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
  return card(
    { title: 'Cómo piensa RATEOS', subtitle: 'Cuatro conceptos separados para no confundir costo con precio.', className: 'learn-card' },
    h(
      'div',
      { class: 'concept-grid' },
      ...CONCEPTS.map((c, i) => h('div', { class: ['concept', `concept-${c.key}`] }, h('div', { class: 'concept-step' }, String(i + 1)), h('div', { class: 'concept-name' }, c.name), h('p', { class: 'concept-text' }, c.text))),
    ),
    h(
      'div',
      { class: 'mvm' },
      h('h4', {}, 'Margen y markup NO son lo mismo'),
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

// ------------------------------------------------------------------ vista

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({
    title: 'Dashboard',
    breadcrumbs: [{ label: 'Inicio' }],
    actions: [button('Nueva cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') })],
  });

  const [stats, settings] = await Promise.all([ctx.quotes.dashboardStats(), app.getSettings()]);

  mount(
    root,
    h('p', { class: 'page-intro' }, 'Resumen de tus cotizaciones activas. Todo se calcula en tu navegador con los datos que cargaste.'),
    kpiSection(stats, settings),
    recentSection(app, stats),
    h('div', { class: 'dashboard-grid' }, quickActionsSection(app, stats), learnSection()),
  );
}
