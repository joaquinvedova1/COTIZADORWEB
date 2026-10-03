/**
 * Layout de la aplicación (chrome): sidebar con marca y navegación, topbar
 * con breadcrumbs + título + acciones, zona de banners globales y el
 * contenedor `.content` donde se montan las vistas.
 *
 * No accede a datos: recibe lo que muestra (organización, versión, banners).
 */

import { APP_NAME, APP_TAGLINE } from '../config.js';
import { h, mount } from './dom.js';
import { icon } from './components.js';

/** Navegación principal (agrupada). `key` lo usa el router para marcar aria-current. */
export const NAV_SECTIONS = Object.freeze([
  {
    label: 'Cotizar',
    items: [
      { key: 'dashboard', href: '#/', label: 'Dashboard', icon: 'dashboard' },
      { key: 'quotes', href: '#/cotizaciones', label: 'Cotizaciones', icon: 'quote' },
      { key: 'new-quote', href: '#/cotizaciones/nueva', label: 'Nueva cotización', icon: 'plus' },
    ],
  },
  {
    label: 'Datos',
    items: [
      { key: 'library', href: '#/biblioteca', label: 'Bibliotecas', icon: 'library' },
      { key: 'services', href: '#/servicios', label: 'Plantillas de servicio', icon: 'services' },
    ],
  },
  {
    label: 'Sistema',
    items: [{ key: 'settings', href: '#/configuracion', label: 'Configuración', icon: 'settings' }],
  },
]);

const DEFAULT_DOCUMENT_TITLE = `${APP_NAME} — Motor de costos y tarifas`;

/** Etiqueta estándar para valores de demostración. */
export function illustrativeTag(title = 'Valor ilustrativo: reemplazalo por uno propio vigente') {
  return h('span', { class: 'tag-illustrative', title }, 'ILUSTRATIVO');
}

/**
 * Mensaje apto para mostrar al usuario a partir de un error.
 * Los errores de la capa de datos ya vienen redactados en español y sin
 * datos sensibles; cualquier otro error se reemplaza por un texto genérico.
 */
export function userErrorMessage(error, fallback = 'Ocurrió un error inesperado. Probá de nuevo.') {
  const known = error && (error.name === 'RepositoryError' || error.name === 'MigrationError');
  if (known && typeof error.message === 'string' && error.message.trim() !== '') return error.message;
  return fallback;
}

/**
 * Construye el layout dentro de `container`.
 * @param {HTMLElement} container
 * @param {{ version?: { version?: string, commit?: string } }} [options]
 */
export function createLayout(container, { version = {} } = {}) {
  const navLinks = new Map();

  const brand = h(
    'a',
    { class: 'brand', href: '#/', 'aria-label': `${APP_NAME}: ir al Dashboard` },
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'R'),
    h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, APP_NAME), h('span', { class: 'brand-tag' }, APP_TAGLINE)),
  );

  const nav = h(
    'nav',
    { class: 'nav', 'aria-label': 'Navegación principal' },
    ...NAV_SECTIONS.map((section) => [
      h('div', { class: 'nav-section', 'aria-hidden': 'true' }, section.label),
      ...section.items.map((item) => {
        const link = h('a', { href: item.href, title: item.label, 'aria-label': item.label, dataset: { nav: item.key } }, icon(item.icon), h('span', {}, item.label));
        navLinks.set(item.key, link);
        return link;
      }),
    ]),
  );

  const orgNameEl = h('div', { class: 'org' }, '—');
  const orgBaseEl = h('div', { class: 'org-base' });
  const buildEl = h('div', { class: 'build mono' }, `${APP_NAME} · build ${version.commit || 'local'}`);
  const sidebar = h('aside', { class: 'sidebar' }, brand, nav, h('div', { class: 'sidebar-footer' }, orgNameEl, orgBaseEl, buildEl));

  const crumbsEl = h('nav', { class: 'breadcrumbs', 'aria-label': 'Ruta de navegación' });
  const titleEl = h('h1', { class: 'page-title', tabindex: '-1' }, '');
  const actionsEl = h('div', { class: 'topbar-actions' });
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, crumbsEl, titleEl), actionsEl);
  const bannersEl = h('div', { class: 'global-banners', hidden: true });

  const createContent = () => h('main', { class: 'content', id: 'contenido', tabindex: '-1' });
  let content = createContent();
  const main = h('div', { class: 'main' }, topbar, bannersEl, content);

  const skipLink = h(
    'a',
    {
      class: 'skip-link',
      href: '#contenido',
      on: {
        click: (event) => {
          // Con ruteo por hash, el ancla cambiaría la ruta: se enfoca a mano.
          event.preventDefault();
          content.focus();
        },
      },
    },
    'Saltar al contenido',
  );

  const shell = h('div', { class: 'app-shell' }, sidebar, main);
  mount(container, skipLink, shell);
  container.removeAttribute('aria-busy');
  container.classList.remove('boot');

  return {
    shell,

    /** Contenedor `.content` actual. */
    getContent() {
      return content;
    },

    /**
     * Reemplaza `.content` por un nodo nuevo y lo devuelve. Así una vista
     * anterior que termine de renderizar tarde escribe en un nodo
     * desconectado y no pisa a la vista nueva.
     */
    resetContent() {
      const fresh = createContent();
      main.replaceChild(fresh, content);
      content = fresh;
      return fresh;
    },

    /** Topbar: breadcrumbs, título y acciones. */
    setHeader({ title = '', breadcrumbs = [], actions = [] } = {}) {
      const crumbs = Array.isArray(breadcrumbs) ? breadcrumbs.filter((c) => c && c.label) : [];
      mount(
        crumbsEl,
        ...crumbs.map((c, i) => [
          i > 0 ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null,
          c.href ? h('a', { href: c.href }, String(c.label)) : h('span', {}, String(c.label)),
        ]),
      );
      crumbsEl.hidden = crumbs.length === 0;
      titleEl.textContent = String(title || '');
      mount(actionsEl, ...(Array.isArray(actions) ? actions.filter((n) => n instanceof Node) : []));
      document.title = title ? `${title} · ${APP_NAME}` : DEFAULT_DOCUMENT_TITLE;
    },

    /** Marca el ítem de navegación activo (aria-current="page"). */
    setActiveNav(key) {
      navLinks.forEach((link, k) => {
        if (k === key) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },

    /** Datos de la empresa en el pie del sidebar. */
    setOrganization(org) {
      orgNameEl.textContent = org && typeof org.name === 'string' && org.name.trim() ? org.name : 'Mi empresa';
      orgBaseEl.textContent = org && typeof org.baseLocation === 'string' && org.baseLocation.trim() ? `Base: ${org.baseLocation}` : '';
    },

    /** Banners globales (debajo de la topbar). */
    setBanners(nodes = []) {
      const list = nodes.filter((n) => n instanceof Node);
      mount(bannersEl, ...list);
      bannersEl.hidden = list.length === 0;
    },

    /** Foco en el título (accesibilidad al cambiar de pantalla). */
    focusTitle() {
      try {
        titleEl.focus({ preventScroll: true });
      } catch {
        titleEl.focus();
      }
    },
  };
}
