/**
 * Ingreso y registro (en construcción: la completa el rediseño UX).
 */

import { h, mount } from '../../dom.js';
import { linkButton } from '../../components.js';

function placeholder(root, app, title) {
  app.setHeader({ title });
  mount(root, h('div', { class: 'public-placeholder' }, h('h1', {}, title), linkButton('Entrar sin cuenta', '#/inicio', { variant: 'primary' })));
}

export function renderLogin(root, app) {
  placeholder(root, app, 'Ingresar');
}

export function renderRegister(root, app) {
  placeholder(root, app, 'Crear cuenta');
}
