/**
 * Vista "Página no encontrada" (cualquier ruta desconocida).
 */

import { h, mount } from '../dom.js';
import { emptyState, linkButton } from '../components.js';

export async function render(root, app, params = {}) {
  app.setHeader({ title: 'Página no encontrada', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const path = typeof params.path === 'string' ? params.path : '';
  mount(
    root,
    h(
      'div',
      { class: 'not-found' },
      emptyState({
        icon: 'info',
        title: 'No encontramos esta página.',
        text: 'La dirección que abriste no existe o cambió. Puede pasar con enlaces viejos o escritos a mano.',
        action: linkButton('Ir al inicio', '#/inicio', { variant: 'primary', icon: 'home' }),
        secondary: linkButton('Ir a la página principal', '#/', { variant: 'secondary' }),
      }),
      path ? h('p', { class: 'muted small not-found-path' }, 'Dirección: ', h('code', {}, `#${path}`)) : null,
    ),
  );
}
