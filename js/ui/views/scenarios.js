/**
 * Escenarios (en construcción: la completa el rediseño UX).
 */

import { h, mount } from '../dom.js';
import { linkButton } from '../components.js';

export function render(root, app) {
  app.setHeader({ title: 'Escenarios', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  mount(root, h('p', {}, 'Elegí una cotización para analizar escenarios.'), linkButton('Ver cotizaciones', '#/cotizaciones'));
}
