/**
 * Vista pública (en construcción: la completa el rediseño UX).
 */

import { h, mount } from '../../dom.js';
import { linkButton } from '../../components.js';

export function render(root, app) {
  app.setHeader({ title: '' });
  mount(root, h('div', { class: 'public-placeholder' }, h('h1', {}, 'RATEOS'), linkButton('Ir a la aplicación', '#/inicio', { variant: 'primary' })));
}
