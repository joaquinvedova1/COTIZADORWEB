/**
 * Vista "Página no encontrada" (cualquier ruta desconocida).
 * El título del estado vacío es un h2 (debajo del h1 de la topbar), para no
 * saltear niveles de encabezado.
 */

import { h, mount } from '../dom.js';
import { icon, linkButton } from '../components.js';

export async function render(root, app, params = {}) {
  app.setHeader({ title: 'Página no encontrada', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const path = typeof params.path === 'string' ? params.path : '';
  mount(
    root,
    h(
      'div',
      { class: 'not-found' },
      h(
        'div',
        { class: ['empty-state', 'empty-state-rich'] },
        h('span', { class: 'empty-state-icon', 'aria-hidden': 'true' }, icon('info', { size: 26 })),
        h('h2', { class: 'empty-state-title' }, 'No encontramos esta página.'),
        h('p', { class: 'empty-state-text' }, 'La dirección que abriste no existe o cambió. Puede pasar con enlaces viejos o escritos a mano.'),
        h(
          'div',
          { class: 'empty-state-actions' },
          linkButton('Ir al inicio', '#/inicio', { variant: 'primary', icon: 'home' }),
          linkButton('Ir a la página principal', '#/', { variant: 'secondary' }),
        ),
      ),
      path ? h('p', { class: 'muted small not-found-path' }, 'Dirección: ', h('code', {}, `#${path}`)) : null,
    ),
  );
}
