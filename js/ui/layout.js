/**
 * Layout (chrome) con dos "shells":
 *
 * - público: landing, ingreso, registro, bienvenida y demo guiada. Sin menú
 *   lateral ni topbar: cada vista arma su propio encabezado.
 * - app: sidebar (marca, "+ Nueva cotización", navegación, empresa, cuenta
 *   —nombre, email, "Mi cuenta", "Cerrar sesión"— y estado de
 *   sincronización con la nube), topbar
 *   con breadcrumbs + título + acciones, zona de banners globales y el
 *   contenedor `.content`.
 *
 * Entre 761 y 1100 px el sidebar pasa a riel con ícono y texto corto debajo.
 * En pantallas chicas (≤ 760 px) el sidebar se oculta y aparece una barra
 * compacta con la marca y un botón "Menú" que despliega la navegación como
 * panel modal: mientras está abierto, el resto de la pantalla queda inerte
 * (no se puede tabular detrás). Se cierra al navegar, con Escape, tocando
 * afuera, al sacar el foco del panel o al agrandar la ventana.
 *
 * La altura real de la topbar fija se publica en la variable CSS
 * --topbar-h para que el elemento enfocado nunca quede tapado (WCAG 2.4.11).
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

/**
 * Entrada del panel de la PLATAFORMA. No está en NAV_ITEMS: sólo se agrega al
 * menú cuando la base confirma que la sesión es RATEOS_ADMIN (y aun así el
 * panel vuelve a verificarlo en Postgres en cada consulta).
 */
export const ADMIN_NAV_ITEM = Object.freeze({ key: 'admin', href: '#/admin', label: 'RATEOS Admin', icon: 'lock' });

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
  let activeNavKey = null;
  let shellKind = 'app';
  let navOpen = false;

  // ------------------------------------------------------------- sidebar

  const navLink = (item) => {
    const link = h(
      'a',
      { href: item.href, class: 'nav-link', dataset: { nav: item.key } },
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
    { class: ['btn', 'btn-secondary', 'sidebar-cta'], href: NEW_QUOTE_HREF },
    icon('plus', { size: 18 }),
    h('span', { class: 'nav-label' }, 'Nueva cotización'),
  );

  const orgAvatarEl = h('span', { class: 'org-avatar', 'aria-hidden': 'true' }, 'R');
  const orgNameEl = h('div', { class: 'org' }, '—');
  const orgBaseEl = h('div', { class: 'org-base' });
  const buildEl = h('div', { class: 'build mono' }, `v${version.version || 'dev'} · build ${version.commit || 'local'}`);
  // Cuenta: nombre / email, rol y acciones. Nunca ids internos, tokens ni claves.
  let signOutHandler = null;
  const userNameEl = h('div', { class: 'account-name' });
  const userEmailEl = h('div', { class: 'account-email' });
  // Rol de plataforma: se muestra aparte del rol en la empresa (no lo reemplaza).
  const platformBadgeEl = h('div', { class: 'account-platform', hidden: true }, 'RATEOS ADMIN');
  let adminLink = null;
  const signOutBtn = h('button', { type: 'button', class: 'account-action', on: { click: () => signOutHandler && signOutHandler() } }, icon('logout', { size: 16 }), h('span', {}, 'Cerrar sesión'));
  const accountEl = h(
    'div',
    { class: 'account-card', hidden: true },
    h('div', { class: 'account-text' }, userNameEl, platformBadgeEl, userEmailEl),
    h('div', { class: 'account-actions' },
      h('a', { class: 'account-action', href: '#/configuracion/cuenta' }, icon('user', { size: 16 }), h('span', {}, 'Mi cuenta')),
      signOutBtn),
  );
  const syncDotEl = h('span', { class: 'sync-dot', 'aria-hidden': 'true' });
  const syncTextEl = h('span', { class: 'sync-text' });
  const syncEl = h('div', { class: 'sync-status', role: 'status', hidden: true }, syncDotEl, syncTextEl);
  const sidebarFooter = h(
    'div',
    { class: 'sidebar-footer' },
    h('div', { class: 'org-card' }, orgAvatarEl, h('div', { class: 'org-text' }, orgNameEl, orgBaseEl)),
    accountEl,
    syncEl,
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
    // Menú modal: lo que queda detrás (topbar, avisos y contenido) no recibe
    // foco ni clics mientras el panel está abierto.
    main.toggleAttribute('inert', navOpen);
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
  // Con el menú abierto, Tab recorre sólo la barra (marca y "Menú") y el
  // panel: del último enlace vuelve a la marca y al revés (trampa de foco).
  const focusablesIn = (el) => [...el.querySelectorAll('a[href], button:not([disabled])')];
  document.addEventListener('keydown', (event) => {
    if (!navOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setNavOpen(false, { returnFocus: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const ring = [...focusablesIn(mobileBar), ...focusablesIn(sidebar)];
    if (!ring.length) return;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  });
  window.addEventListener('hashchange', () => setNavOpen(false));
  // Al pasar a pantalla ancha el panel no existe: se cierra (y se quita el inert).
  if (typeof window.matchMedia === 'function') {
    const mobileQuery = window.matchMedia('(max-width: 760px)');
    const onViewportChange = (event) => {
      if (!event.matches) setNavOpen(false);
    };
    if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', onViewportChange);
    else if (typeof mobileQuery.addListener === 'function') mobileQuery.addListener(onViewportChange);
  }

  // -------------------------------------------------------------- topbar

  const crumbsEl = h('nav', { class: 'breadcrumbs', 'aria-label': 'Ruta de navegación' });
  const titleEl = h('h1', { class: 'page-title', tabindex: '-1' }, '');
  const actionsEl = h('div', { class: 'topbar-actions' });
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'topbar-title' }, crumbsEl, titleEl), actionsEl);
  const bannersEl = h('div', { class: 'global-banners', hidden: true });

  // Borde de la topbar sólo cuando la página está desplazada (menos ruido).
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  // Altura real de la topbar fija → --topbar-h (la usa scroll-padding-top para
  // que el elemento enfocado no quede debajo de la barra; cambia con el ancho,
  // las migas y las acciones de cada pantalla). En el shell público no aplica.
  const rootStyle = document.documentElement.style;
  const publishTopbarHeight = () => {
    const height = shellKind === 'app' ? topbar.getBoundingClientRect().height : 0;
    if (height > 0) rootStyle.setProperty('--topbar-h', `${Math.ceil(height)}px`);
    else rootStyle.removeProperty('--topbar-h');
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(publishTopbarHeight).observe(topbar);

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
          setNavOpen(false);
          content.focus();
        },
      },
    },
    'Saltar al contenido',
  );

  const shell = h('div', { class: 'app-shell' }, mobileBar, sidebar, backdrop, main);
  // Si igual el foco sale del panel y de la barra del menú (p. ej. con un
  // atajo del lector de pantalla), el menú se cierra: nunca queda abierto
  // detrás del foco.
  const insideMenu = (node) => node instanceof Node && (sidebar.contains(node) || mobileBar.contains(node));
  document.addEventListener('focusin', (event) => {
    if (navOpen && !insideMenu(event.target)) setNavOpen(false);
  });
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
      publishTopbarHeight();
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
      activeNavKey = key;
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

    /** Cuenta en el pie del menú (null = sin sesión). */
    setAccount(info) {
      this.setPlatformAdmin(Boolean(info && info.platformAdmin === true));
      if (!info) {
        accountEl.hidden = true;
        syncEl.hidden = true;
        return;
      }
      const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : '';
      userNameEl.textContent = name || info.email || '';
      userEmailEl.textContent = name ? `${info.email || ''}${info.role ? ` · ${info.role}` : ''}` : info.role || '';
      accountEl.hidden = false;
    },
    /**
     * Muestra "RATEOS ADMIN" en la cuenta y la entrada del panel. Para el resto
     * de los usuarios la entrada no existe en el DOM.
     */
    setPlatformAdmin(isAdmin) {
      platformBadgeEl.hidden = !isAdmin;
      if (isAdmin && !adminLink) {
        adminLink = navLink(ADMIN_NAV_ITEM);
        adminLink.classList.add('nav-admin');
        if (activeNavKey === ADMIN_NAV_ITEM.key) adminLink.setAttribute('aria-current', 'page');
        nav.appendChild(adminLink);
      } else if (!isAdmin && adminLink) {
        adminLink.remove();
        navLinks.delete(ADMIN_NAV_ITEM.key);
        adminLink = null;
      }
    },
    /** Acción de "Cerrar sesión". */
    onSignOut(handler) {
      signOutHandler = typeof handler === 'function' ? handler : null;
    },
    /** Estado de sincronización con la nube (texto + punto de color). */
    setSyncStatus({ status, label } = {}) {
      syncEl.hidden = !label;
      syncTextEl.textContent = label || '';
      syncEl.dataset.status = status || '';
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
