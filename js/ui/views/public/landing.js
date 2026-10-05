/**
 * Landing pública (#/): entender → confiar → entrar.
 *
 * Vende resultados, no funcionalidades. El "mockup" del hero NO es una
 * imagen: es el resultado real del motor (computeQuote) sobre la cotización
 * de ejemplo "Hidrogrúa on-call — Añelo", con valores ILUSTRATIVOS.
 * No lee ni escribe datos de ninguna cuenta. "Crear una cotización" lleva a
 * crear la cuenta (y después a la cotización); con sesión, directo.
 */

import { h, mount } from '../../dom.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { demoHydroCraneQuote } from '../../../domain/demo-data.js';
import { defaultSettings } from '../../../domain/quote-factory.js';
import { formatMoneyCompact, formatPercent, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { logger } from '../../../core/logger.js';
import { costBreakdown } from '../../cost-breakdown.js';
import { siteHeader, siteFooter, publicIcon, pubLink, illustrativeLabel, costGroupLabel, isSignedIn } from './public-chrome.js';
import { registerHash } from '../../../services/auth-routing.js';

/** Resultado del ejemplo ilustrativo (o null si no se pudo calcular). */
function computePreview() {
  try {
    return computeQuote(demoHydroCraneQuote(), { settings: { ...defaultSettings(), illustrative: true } });
  } catch (error) {
    logger.warn('No se pudo calcular el ejemplo de la portada', { name: error && error.name });
    return null;
  }
}

/**
 * "¿En qué se va el costo?": la misma agrupación que la demo y el resultado
 * (costBreakdown: 4 rubros más grandes + "Otros", % enteros que suman 100).
 */
function structureSegments(result) {
  const groups = costBreakdown(result && result.eecc, { top: 4, decimals: 0 });
  const total = groups.reduce((sum, g) => sum + g.amount, 0);
  return groups.map((g) => ({ ...g, label: costGroupLabel(g), share: total > 0 ? (g.amount / total) * 100 : 0 }));
}

function mockRow(label, value, unit = null, note = null) {
  return h(
    'div',
    { class: 'pub-mock-row' },
    h('dt', {}, label, note ? h('span', { class: 'pub-mock-dt-note' }, ` ${note}`) : null),
    h('dd', {}, h('span', { class: 'pub-mock-value' }, value), unit ? h('span', { class: 'pub-mock-unit' }, unit) : null),
  );
}

/** Tarjeta que representa el producto: el resultado del ejemplo, calculado en vivo. */
function productMockup(result) {
  const k = (result && result.kpis) || {};
  const unit = (result && result.unitLabel) || 'día';
  const segments = structureSegments(result);
  const breakEvenText = isFiniteNumber(k.breakEvenDays) ? formatDays(k.breakEvenDays, { decimals: 1 }) : EMPTY;
  const rateText = formatMoneyCompact(k.commercialListRate, { ceil: true });
  const daysText = isFiniteNumber(k.activeDays) && k.activeDays > 0 ? formatDays(k.activeDays, { decimals: 1 }) : null;

  return h(
    'figure',
    { class: 'pub-mock', 'aria-label': 'Ejemplo ilustrativo de un resultado de RATEOS: hidrogrúa on-call en Añelo' },
    h(
      'div',
      { class: 'pub-mock-head' },
      h('div', { class: 'pub-mock-titles' }, h('p', { class: 'pub-mock-kicker' }, 'Servicio on-call'), h('p', { class: 'pub-mock-title' }, 'Hidrogrúa — Añelo')),
      illustrativeLabel('Valores ILUSTRATIVOS'),
    ),
    h(
      'dl',
      { class: 'pub-mock-list' },
      mockRow('Costo del mes', formatMoneyCompact(k.totalCost), null, daysText ? `(con ${daysText} de trabajo)` : null),
      mockRow('Tarifa piso', formatMoneyCompact(k.floorListRate, { ceil: true }), `/${unit}`),
      mockRow('Margen objetivo', formatPercent(k.targetMarginPct)),
    ),
    h(
      'div',
      { class: 'pub-mock-need' },
      h('p', { class: 'pub-mock-need-label' }, 'Necesitás'),
      h('p', { class: 'pub-mock-need-value' }, breakEvenText, h('span', { class: 'pub-mock-need-unit' }, '/mes')),
      h('p', { class: 'pub-mock-need-hint' }, `de trabajo para no perder plata, cobrando ${rateText}/${unit} (tarifa sugerida). Con menos días también baja el costo variable.`),
    ),
    segments.length
      ? h(
          'div',
          { class: 'pub-mock-structure' },
          h('p', { class: 'pub-mock-structure-title' }, '¿En qué se va el costo?'),
          h(
            'div',
            { class: 'pub-mock-bar', 'aria-hidden': 'true' },
            ...segments.map((seg, i) => h('span', { class: ['pub-mock-seg', `pub-mock-seg-${i + 1}`], style: { width: `${seg.share}%` } })),
          ),
          h(
            'ul',
            { class: 'pub-mock-legend' },
            ...segments.map((seg, i) =>
              h('li', {}, h('span', { class: ['pub-mock-dot', `pub-mock-seg-${i + 1}`], 'aria-hidden': 'true' }), h('span', { class: 'pub-mock-legend-label' }, seg.label), h('span', { class: 'pub-mock-legend-pct' }, `${seg.pct} %`)),
            ),
          ),
        )
      : null,
    h('div', { class: 'pub-mock-foot' }, pubLink('Ver estructura', '#/demo?paso=2', { tone: 'link', size: 'md', iconAfter: 'arrowRight', className: 'pub-mock-link' })),
  );
}

function sectionHead({ eyebrow, title, id, text = null, className = '' }) {
  return h(
    'div',
    { class: ['pub-section-head', className] },
    h('p', { class: 'pub-eyebrow' }, eyebrow),
    h('h2', { class: 'pub-h2', id, tabindex: '-1' }, title),
    text ? h('p', { class: 'pub-lead' }, text) : null,
  );
}

const RESULTS = Object.freeze([
  { icon: 'layers', title: 'Sabé cuánto te cuesta.', text: 'Personal, equipos, materiales, viajes y gastos de estructura en un único cálculo.' },
  { icon: 'tag', title: 'Sabé cuánto cobrar.', text: 'Conocé tu tarifa piso y el precio necesario para el margen que buscás.' },
  { icon: 'calendar', title: 'Sabé cuánto necesitás trabajar.', text: 'En servicios on-call, descubrí cuántos días u horas necesitás facturar para no perder plata.' },
]);

const PAINS = Object.freeze([
  'Actualizamos el Excel del año pasado.',
  'No sabemos bien cuánto margen queda.',
  'Si cambia el combustible, hay que recalcular todo.',
  'No sabemos hasta cuánto podemos bajar el precio.',
  'Ganamos el trabajo... pero después no sabemos si realmente fue rentable.',
]);

const STEPS = Object.freeze([
  { n: '01', title: 'Contanos qué servicio vas a prestar.', text: 'Cuadrilla, equipo, on-call, permanente, llave en mano, etc.' },
  { n: '02', title: 'Cargá los recursos y condiciones.', text: 'Personal, equipos, materiales, viajes y condiciones comerciales.' },
  { n: '03', title: 'Conocé tu tarifa.', text: 'Costo del mes, tarifa piso, margen y escenarios.' },
]);

const AUDIENCES = Object.freeze(['PyMEs de servicios', 'Oil & Gas', 'Mantenimiento industrial', 'Transporte', 'Construcción', 'Minería']);

/** "De los recursos a la tarifa": lo que hay por debajo, sin fórmulas. */
const CHAIN_INPUTS = Object.freeze(['Personal', 'Equipos', 'Materiales', 'Logística']);
const CHAIN_STAGES = Object.freeze([
  { icon: 'calc', title: 'Costo real', text: 'Lo que te cuesta prestar el servicio cada mes, con todo incluido.' },
  { icon: 'tag', title: 'Tarifa piso', text: 'Lo mínimo que tenés que cobrar para no perder plata.' },
  { icon: 'chart', title: 'Margen', text: 'Lo que querés ganar sobre el precio de venta. Con él llegás a tu tarifa.' },
]);

function resourcesToRateChain() {
  return h(
    'ol',
    { class: 'pub-chain' },
    h(
      'li',
      { class: 'pub-chain-step pub-chain-step-inputs' },
      h('span', { class: 'pub-chain-icon', 'aria-hidden': 'true' }, publicIcon('resources', { size: 22 })),
      h('h3', { class: 'pub-chain-title' }, 'Tus recursos'),
      h('ul', { class: 'pub-chain-inputs', 'aria-label': 'Recursos que cargás' }, ...CHAIN_INPUTS.map((label) => h('li', { class: 'pub-chain-input' }, label))),
    ),
    ...CHAIN_STAGES.map((stage, i) =>
      h(
        'li',
        { class: ['pub-chain-step', i === CHAIN_STAGES.length - 1 ? 'is-final' : null] },
        h('span', { class: 'pub-chain-icon', 'aria-hidden': 'true' }, publicIcon(stage.icon, { size: 22 })),
        h('h3', { class: 'pub-chain-title' }, stage.title),
        h('p', { class: 'pub-chain-text' }, stage.text),
      ),
    ),
  );
}

/** "Crear una cotización": con sesión va directo; sin sesión, a crear la cuenta y después a la cotización. */
function newQuoteHref(app) {
  return isSignedIn(app) ? '#/cotizaciones/nueva' : registerHash('/cotizaciones/nueva');
}

/**
 * @param {HTMLElement} root
 * @param {object} app
 */
export function render(root, app) {
  app.setHeader({ title: '' });
  const preview = computePreview();

  const productSection = h(
    'section',
    { class: 'pub-section pub-section-product', 'aria-labelledby': 'pub-producto-title' },
    h(
      'div',
      { class: 'pub-container' },
      sectionHead({ eyebrow: 'Producto', title: 'Tres respuestas antes de cotizar.', id: 'pub-producto-title' }),
      h(
        'ul',
        { class: 'pub-results' },
        ...RESULTS.map((r) =>
          h('li', { class: 'pub-result' }, h('span', { class: 'pub-result-icon', 'aria-hidden': 'true' }, publicIcon(r.icon, { size: 22 })), h('h3', { class: 'pub-h3' }, r.title), h('p', {}, r.text)),
        ),
      ),
    ),
  );

  const painSection = h(
    'section',
    { class: 'pub-section pub-section-tint', 'aria-labelledby': 'pub-dolor-title' },
    h(
      'div',
      { class: 'pub-container' },
      sectionHead({ eyebrow: '¿Te pasa esto?', title: 'Una cotización no debería depender de una planilla que sólo entiende una persona.', id: 'pub-dolor-title', className: 'pub-section-head-wide' }),
      h('ul', { class: 'pub-pains' }, ...PAINS.map((text) => h('li', { class: 'pub-pain' }, h('p', {}, `“${text}”`)))),
      h('p', { class: 'pub-pains-answer' }, publicIcon('shield', { size: 22 }), h('span', {}, 'RATEOS convierte esas variables en una estructura clara y trazable.')),
    ),
  );

  const howSection = h(
    'section',
    { class: 'pub-section', 'aria-labelledby': 'pub-como-title' },
    h(
      'div',
      { class: 'pub-container' },
      sectionHead({ eyebrow: 'Cómo funciona', title: 'Tres pasos. Nada más.', id: 'pub-como-title' }),
      h(
        'ol',
        { class: 'pub-steps' },
        ...STEPS.map((step) => h('li', { class: 'pub-step' }, h('span', { class: 'pub-step-num', 'aria-hidden': 'true' }, step.n), h('h3', { class: 'pub-h3' }, step.title), h('p', {}, step.text))),
      ),
    ),
  );

  const chainSection = h(
    'section',
    { class: 'pub-section pub-section-tint', 'aria-labelledby': 'pub-recursos-title' },
    h(
      'div',
      { class: 'pub-container' },
      sectionHead({
        eyebrow: 'Por dentro',
        title: 'De los recursos a la tarifa.',
        id: 'pub-recursos-title',
        text: 'La potencia de una estructura de costos profesional, sin la complejidad de una planilla corporativa.',
      }),
      resourcesToRateChain(),
    ),
  );

  const audienceSection = h(
    'section',
    { class: 'pub-section', 'aria-labelledby': 'pub-quien-title' },
    h(
      'div',
      { class: 'pub-container pub-audience' },
      sectionHead({
        eyebrow: 'Para quién',
        title: 'Para empresas que viven de prestar servicios.',
        id: 'pub-quien-title',
        text: 'Nació en Neuquén, entre empresas que trabajan en Vaca Muerta. Sirve para cualquier servicio donde el costo depende de personas, equipos y días de trabajo.',
      }),
      h('ul', { class: 'pub-chips', 'aria-label': 'Rubros' }, ...AUDIENCES.map((label) => h('li', { class: 'pub-chip' }, label))),
    ),
  );

  const closingSection = h(
    'section',
    { class: 'pub-cta', 'aria-labelledby': 'pub-cierre-title' },
    h(
      'div',
      { class: 'pub-container pub-cta-inner' },
      h('h2', { class: 'pub-cta-title', id: 'pub-cierre-title' }, 'Probá RATEOS con un ejemplo en dos minutos.'),
      h('p', { class: 'pub-cta-text' }, 'Una hidrogrúa on-call en Añelo, paso a paso. Sin cuenta y sin cargar datos.'),
      h(
        'div',
        { class: 'pub-cta-actions' },
        pubLink('Probar con un ejemplo', '#/demo', { tone: 'light', iconBefore: 'play' }),
        pubLink('Crear una cotización', newQuoteHref(app), { tone: 'outline-light', iconAfter: 'arrowRight' }),
      ),
    ),
  );

  const header = siteHeader({
    signedIn: isSignedIn(app),
    sections: [
      { label: 'Producto', target: () => productSection },
      { label: 'Cómo funciona', target: () => howSection },
      { label: 'Para quién', target: () => audienceSection },
    ],
  });

  const heroActions = h(
    'div',
    { class: 'pub-hero-actions' },
    pubLink('Crear una cotización', newQuoteHref(app), { tone: 'primary', iconAfter: 'arrowRight' }),
    pubLink('Ver demo', '#/demo', { tone: 'secondary', iconBefore: 'play' }),
  );

  const hero = h(
    'section',
    { class: 'pub-hero', 'aria-labelledby': 'pub-hero-title' },
    h(
      'div',
      { class: 'pub-container pub-hero-grid' },
      h(
        'div',
        { class: 'pub-hero-copy' },
        h('p', { class: 'pub-pill' }, h('span', { class: 'pub-pill-dot', 'aria-hidden': 'true' }), 'Costos y tarifas para servicios industriales'),
        h('h1', { class: 'pub-hero-title', id: 'pub-hero-title', tabindex: '-1' }, 'Cotizá servicios sabiendo ', h('span', { class: 'pub-accent' }, 'cuánto te cuestan.')),
        h(
          'p',
          { class: 'pub-hero-sub' },
          'RATEOS transforma personal, equipos, materiales, logística y condiciones comerciales en una estructura de costos clara para saber cuánto cobrar sin perder rentabilidad.',
        ),
        heroActions,
        h('p', { class: 'pub-hero-note' }, publicIcon('pin', { size: 18 }), h('span', {}, 'Pensado para empresas de servicios industriales. ', h('strong', {}, 'Nacido en Neuquén.'))),
      ),
      h('div', { class: 'pub-hero-visual' }, productMockup(preview)),
    ),
  );

  mount(root, h('div', { class: 'pub-page pub-landing' }, header.el, hero, productSection, painSection, howSection, chainSection, audienceSection, closingSection, siteFooter(app)));

  // Con sesión: acceso directo discreto a la cuenta (sin un 3er botón grande).
  if (isSignedIn(app)) {
    heroActions.after(h('p', { class: 'pub-hero-return' }, publicIcon('check', { size: 18 }), h('span', {}, 'Tenés la sesión iniciada. ', h('a', { href: '#/inicio' }, 'Ir a mis cotizaciones'))));
  }

  return () => {
    header.destroy();
  };
}
