/**
 * Vista "Página no encontrada" (cualquier ruta desconocida).
 */

import { h, mount } from '../dom.js';
import { button, card } from '../components.js';

export async function render(root, app, params = {}) {
  app.setHeader({ title: 'Página no encontrada', breadcrumbs: [{ label: 'Inicio', href: '#/' }] });
  const path = typeof params.path === 'string' ? params.path : '';
  mount(
    root,
    card(
      { title: 'No encontramos esta pantalla', className: 'not-found' },
      h('p', {}, 'La dirección que abriste no existe o cambió. Puede pasar con enlaces viejos o escritos a mano.'),
      path ? h('p', { class: 'muted small' }, 'Dirección: ', h('code', {}, `#${path}`)) : null,
      h(
        'div',
        { class: 'row' },
        button('Ir al Dashboard', { variant: 'primary', icon: 'dashboard', onClick: () => app.navigate('#/') }),
        button('Ver cotizaciones', { variant: 'secondary', icon: 'quote', onClick: () => app.navigate('#/cotizaciones') }),
      ),
    ),
  );
}
