/**
 * Landing pública (#/): entender → confiar → entrar.
 *
 * Vende resultados, no funcionalidades. El "mockup" del hero NO es una
 * imagen: es el resultado real del motor (computeQuote) sobre la cotización
 * de ejemplo "Hidrogrúa on-call — Añelo", con valores ILUSTRATIVOS.
 * No lee ni escribe datos guardados.
 */

import { h, mount } from '../../dom.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { demoHydroCraneQuote } from '../../../domain/demo-data.js';
import { defaultSettings } from '../../../domain/quote-factory.js';
import { formatMoneyCompact, formatPercent, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber, roundPercentagesToTotal } from '../../../core/money.js';
import { logger } from '../../../core/logger.js';
import { siteHeader, siteFooter, publicIcon, pubLink, illustrativeLabel } from './public-chrome.js';

/** Resultado del ejemplo ilustrativo (o null si no se pudo calcular). */
function computePreview() {
  try {
    return computeQuote(demoHydroCraneQuote(), { settings: { ...defaultSettings(), illustrative: true } });
  } catch (error) {
    logger.warn('No se pudo calcular el ejemplo de la portada', { name: error && error.name });
    return null;
  }
}

/** Cuatro rubros principales + "Otros" (resto), con % enteros que suman 100. */
function structureSegments(result) {
  const rows = result && result.eecc && Array.isArray(result.eecc.rows) ? result.eecc.rows.filter((r) => isFiniteNumber(r.amount) && r.amount > 0) : [];
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  const top = sorted.slice(0, 4).map((r) => ({ label: r.label, amount: r.amount }));
  const rest = sorted.slice(4).reduce((sum, r) => sum + r.amount, 0);
  if (rest > 0) top.push({ label: 'Otros', amount: rest });
  const total = top.reduce((sum, r) => sum + r.amount, 0);
  const pcts = roundPercentagesToTotal(top.map((r) => r.amount), 0, 100);
  return top.map((r, i) => ({ ...r, share: total > 0 ? (r.amount / total) * 100 : 0, pct: pcts[i] }));
}

function mockRow(label, value, unit = null) {
  return h(
    'div',
    { class: 'pub-mock-row' },
    h('dt', {}, label),
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

  return h(
    'figure',
    { class: 'pub-mock', 'aria-label': 'Ejemplo ilustrativo de un resultado de RATEOS: hidrogrúa on-call en Añelo' },
    h(
      'div',
      { class: 'pub-mock-head' },
      h('div', { class: 'pub-mock-titles' }, h('p', { class: 'pub-mock-kicker' }, 'Servicio on-call'), h('p', { class: 'pub-mock-title' }, 'Hidrogrúa — Añelo')),
      illustrativeLabel(),
    ),
    h(
      'dl',
      { class: 'pub-mock-list' },
      mockRow('Costo estimado del mes', formatMoneyCompact(k.totalCost)),
      mockRow('Tarifa piso', formatMoneyCompact(k.floorListRate, { ceil: true }), `/${unit}`),
      mockRow('Margen objetivo', formatPercent(k.targetMarginPct)),
    ),
    h(
      'div',
      { class: 'pub-mock-need' },
      h('p', { class: 'pub-mock-need-label' }, 'Necesitás'),
      h('p', { class: 'pub-mock-need-value' }, breakEvenText, h('span', { class: 'pub-mock-need-unit' }, '/mes')),
      h('p', { class: 'pub-mock-need-hint' }, `de trabajo para no perder plata, cobrando ${rateText}/${unit} (tarifa sugerida).`),
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
    h(
      'div',
      { class: 'pub-mock-foot' },
      h('span', { class: 'pub-mock-foot-note' }, 'Valores ILUSTRATIVOS'),
      pubLink('Ver estructura', '#/demo?paso=2', { tone: 'link', size: 'md', iconAfter: 'arrowRight', className: 'pub-mock-link' }),
    ),
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
  { icon: 'layers', title: 'Sabé cuánto te cuesta.', text: 'Personal, equipos, materiales, viajes y estructura en un único cálculo.' },
  { icon: 'tag', title: 'Sabé cuánto cobrar.', text: 'Conocé tu tarifa piso y el precio necesario para el margen que buscás.' },
  { icon: 'calendar', title: 'Sabé cuánto necesitás trabajar.', text: 'En servicios on-call, descubrí cuántos días u horas necesitás facturar para no perder dinero.' },
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
  { n: '03', title: 'Conocé tu tarifa.', text: 'Costo total, tarifa piso, margen y escenarios.' },
]);

const AUDIENCES = Object.freeze(['PyMEs de servicios', 'Oil & Gas', 'Mantenimiento industrial', 'Transporte', 'Construcción', 'Minería']);

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

  const audienceSection = h(
    'section',
    { class: 'pub-section pub-section-tint', 'aria-labelledby': 'pub-quien-title' },
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
        pubLink('Crear una cotización', '#/cotizaciones/nueva', { tone: 'outline-light', iconAfter: 'arrowRight' }),
      ),
    ),
  );

  const header = siteHeader({
    sections: [
      { label: 'Producto', target: () => productSection },
      { label: 'Cómo funciona', target: () => howSection },
      { label: 'Para quién', target: () => audienceSection },
    ],
  });

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
        h(
          'div',
          { class: 'pub-hero-actions' },
          pubLink('Crear una cotización', '#/cotizaciones/nueva', { tone: 'primary', iconAfter: 'arrowRight' }),
          pubLink('Ver demo', '#/demo', { tone: 'secondary', iconBefore: 'play' }),
        ),
        h('p', { class: 'pub-hero-note' }, publicIcon('pin', { size: 18 }), h('span', {}, 'Pensado para empresas de servicios industriales. ', h('strong', {}, 'Nacido en Neuquén.'))),
      ),
      h('div', { class: 'pub-hero-visual' }, productMockup(preview)),
    ),
  );

  mount(root, h('div', { class: 'pub-page pub-landing' }, header.el, hero, productSection, painSection, howSection, audienceSection, closingSection, siteFooter(app)));

  return () => header.destroy();
}
