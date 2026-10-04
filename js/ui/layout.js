/**
 * Layout (chrome) con dos "shells":
 *
 * - público: landing, ingreso, registro, bienvenida y demo guiada. Sin menú
 *   lateral ni topbar: cada vista arma su propio encabezado.
 * - app: sidebar (marca, "+ Nueva cotización", navegación y empresa), topbar
 *   con breadcrumbs + título + acciones, zona de banners globales y el
 *   contenedor `.content`.
 *
 * En pantallas chicas (≤ 760 px) el sidebar se oculta y aparece una barra
 * compacta con la marca y un botón "Menú" que despliega la navegación como
 * panel (se cierra al navegar, con Escape o tocando afuera).
 *
 * No accede a datos: recibe lo que muestra (organización, versión, banners).
 */

import { APP_NAME } from '../config.js';
import { h, mount } from './dom.js';
import { icon } from './components.js';

/**
 * Navegación principal de la aplicación. `key` lo usa el router para marcar
 * aria-current. `separated: true` = va después del separador (secundario).
 */
export const NAV_ITEMS = Object.freeze([
  { key: 'home', href: '#/inicio', label: 'Inicio', icon: 'home' },
  { key: 'quotes', href: '#/cotizaciones', label: 'Cotizaciones', icon: 'quote' },
  { key: 'resources', href: '#/recursos', label: 'Recursos', icon: 'resources' },
  { key: 'services', href: '#/servicios', label: 'Servicios', icon: 'services' },
  { key: 'scenarios', href: '#/escenarios', label: 'Escenarios', icon: 'chart' },
  { key: 'settings', href: '#/configuracion', label: 'Configuración', icon: 'settings', separated: true },
]);

/** Destino del botón "+ Nueva cotización" del menú lateral. */
export const NEW_QUOTE_HREF = '#/cotizaciones/nueva';

const DEFAULT_DOCUMENT_TITLE = `${APP_NAME} — Cotizá servicios sabiendo cuánto te cuestan`;

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

/** Inicial de la empresa para el "avatar" del pie del menú (texto, nunca HTML). */
export function organizationInitial(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  const first = text ? Array.from(text)[0] : '';
  return first ? first.toLocaleUpperCase('es-AR') : 'R';
}

function brandLink(className = '') {
  return h(
    'a',
    { class: ['brand', className], href: '#/inicio', 'aria-label': `${APP_NAME}: ir al inicio` },
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'R'),
    h('span', { class: 'brand-name', 'aria-hidden': 'true' }, APP_NAME),
  );
}

/**
 * Construye el layout dentro de `container`.
 * @param {HTMLElement} container
 * @param {{ version?: { version?: string, commit?: string } }} [options]
 */
export function createLayout(container, { version = {} } = {}) {
  const navLinks = new Map();
  let shellKind = 'app';
  let navOpen = false;

  // ------------------------------------------------------------- sidebar

  const navLink = (item) => {
    const link = h(
      'a',
      { href: item.href, class: 'nav-link', title: item.label, dataset: { nav: item.key } },
      icon(item.icon),
      h('span', { class: 'nav-label' }, item.label),
    );
    navLinks.set(item.key, link);
    return link;
  };
  const nav = h(
    'nav',
    { class: 'nav', id: 'app-nav', 'aria-label': 'Navegación principal' },
    ...NAV_ITEMS.filter((item) => !item.separated).map(navLink),
    h('div', { class: 'nav-separator', role: 'separator' }),
    ...NAV_ITEMS.filter((item) => item.separated).map(navLink),
  );

  const newQuoteLink = h(
    'a',
    { class: ['btn', 'btn-secondary', 'sidebar-cta'], href: NEW_QUOTE_HREF, title: 'Nueva cotización' },
    icon('plus', { size: 18 }),
    h('span', { class: 'nav-label' }, 'Nueva cotización'),
  );

  const orgAvatarEl = h('span', { class: 'org-avatar', 'aria-hidden': 'true' }, 'R');
  const orgNameEl = h('div', { class: 'org' }, '—');
  const orgBaseEl = h('div', { class: 'org-base' });
  const buildEl = h('div', { class: 'build mono' }, `v${version.version || 'dev'} · build ${version.commit || 'local'}`);
  const sidebarFooter = h(
    'div',
    { class: 'sidebar-footer' },
    h('div', { class: 'org-card' }, orgAvatarEl, h('div', { class: 'org-text' }, orgNameEl, orgBaseEl)),
    buildEl,
  );

  const sidebar = h('aside', { class: 'sidebar', id: 'app-sidebar', 'aria-label': 'Menú de RATEOS' }, brandLink('brand-sidebar'), newQuoteLink, nav, sidebarFooter);

  // ------------------------------------------------- barra compacta (mobile)

  const menuIconHost = h('span', { class: 'menu-toggle-icon', 'aria-hidden': 'true' }, icon('menu'));
  const menuToggle = h(
    'button',
    { type: 'button', class: ['btn', 'btn-ghost', 'menu-toggle'], 'aria-expanded': 'false', 'aria-controls': 'app-sidebar' },
    menuIconHost,
    h('span', {}, 'Menú'),
  );
  const mobileBar = h('div', { class: 'mobile-bar' }, brandLink('brand-compact'), menuToggle);
  const backdrop = h('div', { class: 'nav-backdrop', 'aria-hidden': 'true' });

  function setNavOpen(open, { returnFocus = false } = {}) {
    const next = Boolean(open) && shellKind === 'app';
    if (next === navOpen) return;
    navOpen = next;
    shell.classList.toggle('is-nav-open', navOpen);
    document.body.classList.toggle('nav-open', navOpen);
    menuToggle.setAttribute('aria-expanded', navOpen ? 'true' : 'false');
    mount(menuIconHost, icon(navOpen ? 'close' : 'menu'));
    if (navOpen) {
      const current = nav.querySelector('[aria-current="page"]') || newQuoteLink;
      try {
        current.focus({ preventScroll: true });
      } catch {
        current.focus();
      }
    } else if (returnFocus) {
      menuToggle.focus();
    }
  }

  menuToggle.addEventListener('click', () => setNavOpen(!navOpen));
  backdrop.addEventListener('click', () => setNavOpen(false));
  // Tocar un enlace del menú lo cierra (aunque sea la pantalla actual).
  sidebar.addEventListener('click', (event) => {
    const target = event.target;
    if (navOpen && target && typeof target.closest === 'function' && target.closest('a')) setNavOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navOpen) {
      event.preventDefault();
      setNavOpen(false, { returnFocus: true });
    }
  });
  window.addEventListener('hashchange', () => setNavOpen(false));

  // -------------------------------------------------------------- topbar

  const crumbsEl = h('nav', { class: 'breadcrumbs', 'aria-label': 'Ruta de navegación' });
  const titleEl = h('h1', { class: 'page-title', tabindex: '-1' }, '');
  const actionsEl = h('div', { class: 'topbar-actions' });
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, crumbsEl, titleEl), actionsEl);
  const bannersEl = h('div', { class: 'global-banners', hidden: true });

  // Borde de la topbar sólo cuando la página está desplazada (menos ruido).
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  const createContent = () => h('main', { class: 'content', id: 'contenido', tabindex: '-1' });
  const createPublicContent = () => h('main', { class: 'public-content', id: 'contenido', tabindex: '-1' });
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

  const shell = h('div', { class: 'app-shell' }, mobileBar, sidebar, backdrop, main);
  const publicShell = h('div', { class: 'public-shell', hidden: true });
  mount(container, skipLink, shell, publicShell);
  container.removeAttribute('aria-busy');
  container.classList.remove('boot');

  return {
    shell,
    publicShell,

    /** Shell activo: 'public' | 'app'. */
    getShell() {
      return shellKind;
    },

    /**
     * Cambia de shell. El contenido se crea con resetContent() después.
     * @param {'public'|'app'} kind
     */
    setShell(kind) {
      shellKind = kind === 'public' ? 'public' : 'app';
      if (shellKind === 'public') setNavOpen(false);
      shell.hidden = shellKind === 'public';
      publicShell.hidden = shellKind !== 'public';
      document.body.classList.toggle('is-public', shellKind === 'public');
    },

    /** Contenedor de contenido actual. */
    getContent() {
      return content;
    },

    /**
     * Reemplaza el contenido por un nodo nuevo (en el shell activo) y lo
     * devuelve. Así una vista anterior que termine de renderizar tarde
     * escribe en un nodo desconectado y no pisa a la vista nueva.
     */
    resetContent() {
      setNavOpen(false);
      const fresh = shellKind === 'public' ? createPublicContent() : createContent();
      if (content.parentNode) content.parentNode.removeChild(content);
      if (shellKind === 'public') mount(publicShell, fresh);
      else main.appendChild(fresh);
      content = fresh;
      onScroll();
      return fresh;
    },

    /** Topbar: breadcrumbs, título y acciones. En el shell público sólo cambia el título del documento. */
    setHeader({ title = '', breadcrumbs = [], actions = [] } = {}) {
      document.title = title ? `${title} · ${APP_NAME}` : DEFAULT_DOCUMENT_TITLE;
      if (shellKind === 'public') return;
      const crumbs = Array.isArray(breadcrumbs) ? breadcrumbs.filter((c) => c && c.label) : [];
      mount(
        crumbsEl,
        ...crumbs.map((c, i) => [
          i > 0 ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/') : null,
          c.href ? h('a', { href: c.href }, String(c.label)) : h('span', {}, String(c.label)),
        ]),
      );
      crumbsEl.hidden = crumbs.length === 0;
      titleEl.textContent = String(title || '');
      const list = Array.isArray(actions) ? actions.filter((n) => n instanceof Node) : [];
      mount(actionsEl, ...list);
      actionsEl.hidden = list.length === 0;
    },

    /** Marca el ítem de navegación activo (aria-current="page"). */
    setActiveNav(key) {
      navLinks.forEach((link, k) => {
        if (k === key) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
    },

    /** Abre o cierra el menú en pantallas chicas. */
    setNavOpen(open) {
      setNavOpen(open);
    },

    /** Datos de la empresa en el pie del sidebar. */
    setOrganization(org) {
      const name = org && typeof org.name === 'string' && org.name.trim() ? org.name : 'Mi empresa';
      orgNameEl.textContent = name;
      orgAvatarEl.textContent = organizationInitial(name);
      orgBaseEl.textContent = org && typeof org.baseLocation === 'string' && org.baseLocation.trim() ? `Base: ${org.baseLocation}` : '';
      orgBaseEl.hidden = orgBaseEl.textContent === '';
    },

    /** Banners globales (debajo de la topbar; sólo en el shell de la app). */
    setBanners(nodes = []) {
      const list = nodes.filter((n) => n instanceof Node);
      mount(bannersEl, ...list);
      bannersEl.hidden = list.length === 0;
    },

    /**
     * Foco en el título (accesibilidad al cambiar de pantalla). En el shell
     * público se enfoca el primer h1 de la vista.
     */
    focusTitle() {
      let target = titleEl;
      if (shellKind === 'public') {
        target = content.querySelector('h1');
        if (!target) return;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      }
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    },
  };
}
