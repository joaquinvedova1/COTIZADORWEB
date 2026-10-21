/**
 * "Nuevo cálculo" (#/nuevo): la puerta de entrada única para costear algo.
 *
 * Primero se elige QUÉ se calcula —un servicio o un producto— y recién
 * después se entra al flujo de cada uno, que no cambia:
 *   Servicio → #/cotizaciones/nueva  ("¿Qué servicio vas a cotizar?" y el editor de cotizaciones)
 *   Producto → #/productos/nuevo     (el editor de productos paso a paso)
 *
 * Son modelos distintos por debajo (cotizaciones y productos); para la
 * persona es una misma experiencia de costeo y precio.
 */

import { h, mount } from '../dom.js';
import { icon, pageIntro } from '../components.js';
import { creditsBanner } from '../credits-ui.js';

/** Destino de cada opción (también lo usan Inicio y otras pantallas). */
export const NEW_SERVICE_HREF = '#/cotizaciones/nueva';
export const NEW_PRODUCT_HREF = '#/productos/nuevo';

/** Las dos opciones de "¿Qué querés calcular?". */
export const CALC_KINDS = Object.freeze([
  Object.freeze({
    id: 'service',
    title: 'Servicio',
    text: 'Calculá cuánto cuesta prestar un servicio y cuánto deberías cobrar.',
    examples: 'On-call, cuadrilla, equipo con operador, transporte, llave en mano, abono mensual…',
    unit: 'Por día, hora, mes, m³, viaje, tonelada o trabajo terminado.',
    href: NEW_SERVICE_HREF,
    icon: 'quote',
  }),
  Object.freeze({
    id: 'product',
    title: 'Producto',
    text: 'Calculá cuánto cuesta producir cada unidad y a qué precio venderla según el margen que buscás.',
    examples: 'Panificados, viandas, conservas, piezas de taller, productos de comercio…',
    unit: 'Por unidad, docena, kilo o paquete.',
    href: NEW_PRODUCT_HREF,
    icon: 'product',
  }),
]);

function kindCard(kind, { disabled = false } = {}) {
  // Sin créditos de prueba (PLAN-2026-029) la opción se ve pero no lleva a crear.
  return h(
    disabled ? 'div' : 'a',
    disabled
      ? { class: ['quote-choice', 'calc-choice', 'is-disabled'], dataset: { kind: kind.id }, 'aria-disabled': 'true', 'aria-label': `${kind.title}: no quedan cálculos de prueba` }
      : { href: kind.href, class: ['quote-choice', 'calc-choice'], dataset: { kind: kind.id }, 'aria-label': `${kind.title}: ${kind.text}` },
    h('span', { class: 'quote-choice-icon calc-choice-icon', 'aria-hidden': 'true' }, icon(kind.icon, { size: 26 })),
    h('span', { class: 'calc-choice-title' }, kind.title),
    h('span', { class: 'quote-choice-text calc-choice-text' }, kind.text),
    h('span', { class: 'calc-choice-examples' }, kind.examples),
    h('span', { class: 'calc-choice-unit' }, kind.unit),
    h('span', { class: 'quote-choice-go', 'aria-hidden': 'true' }, icon('arrowRight', { size: 20 })),
  );
}

/** #/nuevo */
export async function render(root, app) {
  app.setHeader({ title: 'Nuevo cálculo', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const credits = app.ctx && app.ctx.credits ? await app.ctx.credits.status({ refresh: true }) : { enabled: false };
  const exhausted = credits.enabled === true && credits.balance <= 0;
  mount(
    root,
    h(
      'div',
      { class: 'view-narrow stack-lg calc-start' },
      pageIntro({
        title: '¿Qué querés calcular?',
        text: 'Sabé cuánto te cuesta y definí cuánto cobrar. Los dos usan tu mismo personal, tus equipos y tus materiales de Recursos.',
      }),
      creditsBanner(credits),
      // Producto sigue disponible: el ejemplo "Chipá" no usa créditos (ahí se bloquea sólo "Empezar en blanco").
      h('div', { class: 'calc-choice-grid' }, ...CALC_KINDS.map((kind) => kindCard(kind, { disabled: exhausted && kind.id === 'service' }))),
      h(
        'p',
        { class: 'muted small calc-start-help' },
        '¿No sabés cuál elegir? Si cobrás por tiempo de trabajo o por un trabajo terminado, es un servicio. Si vendés unidades que hacés vos (por unidad, docena o kilo), es un producto.',
      ),
    ),
  );
  return undefined;
}
