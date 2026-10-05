/**
 * Piezas compartidas del sitio público (landing, ingreso, registro,
 * bienvenida y demo guiada): marca, encabezados, pie, íconos propios y
 * utilidades de foco y desplazamiento.
 *
 * Sólo presentación: no lee ni escribe datos. Todo el texto se inserta como
 * nodos de texto (h() / s() de dom.js).
 */

import { h, s } from '../../dom.js';
import { icon } from '../../components.js';
import { APP_NAME } from '../../../config.js';

// ------------------------------------------------------------------ íconos

/** Íconos propios del sitio público (formas estáticas internas, 24×24). */
const PUBLIC_ICON_PATHS = Object.freeze({
  tag: 'M21.41 11.58 12.41 2.58A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  calendar: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5a2 2 0 0 0-1.99 2L3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V1h-2zm3 18H5V8h14v11z',
  layers: 'M12 2 2 7l10 5 10-5-10-5zm0 13L2 10v2l10 5 10-5v-2l-10 5zm0 4L2 14v2l10 5 10-5v-2l-10 5z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  shield: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  trace: 'M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h8v2H3v-2zm14.5-3.5L21 17l-3.5 3.5-1.4-1.4 1.1-1.1H13v-2h4.2l-1.1-1.1 1.4-1.4z',
});

/**
 * Ícono SVG del sitio público. Si el nombre no es propio, usa los íconos
 * de components.js (arrowRight, play, close, menu, info, check, lock…).
 */
export function publicIcon(name, { size = 20, className = '' } = {}) {
  const path = PUBLIC_ICON_PATHS[name];
  if (!path) return icon(name, { size });
  return s(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, class: ['icon', className].filter(Boolean).join(' '), 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: path, fill: 'currentColor' }),
  );
}

// ---------------------------------------------------------------- botones

/**
 * Enlace con aspecto de botón para el sitio público.
 * tone: 'primary' | 'secondary' | 'light' (sobre fondo oscuro) | 'outline-light' | 'link'
 */
export function pubLink(label, href, { tone = 'primary', size = 'lg', iconBefore = null, iconAfter = null, className = '', attrs = {} } = {}) {
  const variant = tone === 'light' || tone === 'outline-light' ? `pub-btn-${tone}` : `btn-${tone}`;
  return h(
    'a',
    { ...attrs, href, class: ['btn', variant, size === 'lg' ? 'btn-lg' : null, size === 'sm' ? 'btn-sm' : null, 'pub-btn', className] },
    iconBefore ? publicIcon(iconBefore, { size: 18 }) : null,
    h('span', {}, label),
    iconAfter ? publicIcon(iconAfter, { size: 18 }) : null,
  );
}

// ------------------------------------------------------------------- marca

/** Marca RATEOS (logo "R" + nombre) como enlace. */
export function brand({ href = '#/', className = '', label = `${APP_NAME}: página principal` } = {}) {
  return h(
    'a',
    { class: ['pub-brand', className], href, 'aria-label': label },
    h('span', { class: 'pub-brand-mark', 'aria-hidden': 'true' }, 'R'),
    h('span', { class: 'pub-brand-name', 'aria-hidden': 'true' }, APP_NAME),
  );
}

/**
 * Nombre de un rubro de costBreakdown() en las vistas simples. Glosario de
 * superficie: el rubro "Estructura" se lee "Gastos de estructura".
 */
export function costGroupLabel(group) {
  if (!group) return '';
  return group.key === 'structure' ? 'Gastos de estructura' : group.label;
}

/** Etiqueta de valores de demostración. */
export function illustrativeLabel(text = 'Ejemplo ilustrativo') {
  return h('span', { class: 'pub-tag-illustrative' }, text);
}

// ----------------------------------------------------------- foco y scroll

/** true si el usuario pidió reducir el movimiento. */
export function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Enfoca un encabezado sin desplazar la página (lo hace focuseable). */
export function focusHeading(el) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/**
 * Lleva a una sección de la página (sin anclas "#seccion": con ruteo por
 * hash, el ancla cambiaría la ruta) y enfoca su título para lectores de
 * pantalla y teclado.
 */
export function scrollToSection(section) {
  if (!section) return;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  focusHeading(section.querySelector('h2, h1'));
}

/** true si los datos están en modo sólo lectura (no se puede escribir). */
export function isReadOnly(app) {
  return Boolean(app && app.ctx && app.ctx.init && app.ctx.init.status === 'read_only');
}

/**
 * Parámetros de la "query" del hash (#/demo?paso=2&desde=app). El router
 * ignora la query para elegir la pantalla; cada pantalla lee lo que necesita.
 */
export function hashParams() {
  try {
    const hash = String(window.location.hash || '');
    const index = hash.indexOf('?');
    return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : '');
  } catch {
    return new URLSearchParams('');
  }
}

// ------------------------------------------- del registro a la bienvenida

/**
 * Nombre de la empresa escrito en #/registro, para usarlo en #/bienvenida.
 * Vive SÓLO en memoria (se pierde al recargar la página): el registro no
 * escribe nada; la empresa recién se crea si en la bienvenida la persona
 * elige empezar con sus datos (y confirma).
 */
let pendingCompanyName = '';

export function setPendingCompanyName(name) {
  pendingCompanyName = typeof name === 'string' ? name : '';
}

export function getPendingCompanyName() {
  return pendingCompanyName;
}

/**
 * Respuestas de #/bienvenida mientras la persona mira el ejemplo
 * (#/demo?desde=bienvenida) y vuelve: así no tiene que contestar de nuevo.
 * Igual que el nombre de la empresa, vive SÓLO en memoria (se pierde al
 * recargar) y nunca se escribe en el almacenamiento. La bienvenida la toma
 * (y la borra) al mostrarse.
 */
let onboardingDraft = null;

export function setOnboardingDraft(draft) {
  onboardingDraft = draft && typeof draft === 'object' ? { ...draft } : null;
}

export function takeOnboardingDraft() {
  const draft = onboardingDraft;
  onboardingDraft = null;
  return draft;
}

// ------------------------------------------------------------ encabezados

/**
 * Encabezado del sitio (landing): marca, secciones, Ingresar y Comenzar.
 * En pantallas angostas las secciones se pliegan detrás de un botón "Menú"
 * accesible (aria-expanded / aria-controls; Escape y clic afuera cierran).
 *
 * @param {{ sections?: { label: string, target: () => HTMLElement|null }[] }} opts
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function siteHeader({ sections = [] } = {}) {
  const navId = 'pub-site-nav';
  let open = false;

  const toggleLabel = h('span', {}, 'Menú');
  const toggleIcon = h('span', { class: 'pub-menu-icon', 'aria-hidden': 'true' }, icon('menu', { size: 20 }));
  const toggle = h(
    'button',
    { type: 'button', class: 'pub-menu-toggle', 'aria-expanded': 'false', 'aria-controls': navId },
    toggleIcon,
    toggleLabel,
  );

  const nav = h(
    'nav',
    { class: 'pub-nav', id: navId, 'aria-label': 'Secciones del sitio' },
    h(
      'ul',
      { class: 'pub-nav-list' },
      ...sections.map((item) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'pub-nav-item',
              on: {
                click: () => {
                  setOpen(false, { restoreFocus: false });
                  scrollToSection(item.target());
                },
              },
            },
            item.label,
          ),
        ),
      ),
      h('li', { class: 'pub-nav-login-item' }, h('a', { class: 'pub-nav-item pub-nav-login', href: '#/login' }, 'Ingresar')),
    ),
  );

  const header = h(
    'header',
    { class: 'pub-header' },
    h(
      'div',
      { class: 'pub-container pub-header-inner' },
      brand(),
      nav,
      h('div', { class: 'pub-header-actions' }, pubLink('Comenzar', '#/registro', { tone: 'primary', size: 'md', className: 'pub-header-cta' }), toggle),
    ),
  );

  function setOpen(value, { restoreFocus = true } = {}) {
    open = Boolean(value);
    nav.classList.toggle('is-open', open);
    header.classList.toggle('is-menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggleLabel.textContent = open ? 'Cerrar' : 'Menú';
    toggleIcon.replaceChildren(icon(open ? 'close' : 'menu', { size: 20 }));
    if (!open && restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => {
    setOpen(!open, { restoreFocus: false });
    // Las opciones están antes del botón en el orden del documento: al abrir,
    // el foco pasa a la primera para que el teclado no las saltee.
    if (open) {
      const first = nav.querySelector('.pub-nav-item');
      if (first) first.focus();
    }
  });

  const onKeydown = (event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };
  const onPointerDown = (event) => {
    if (open && !header.contains(event.target)) setOpen(false, { restoreFocus: false });
  };
  // Si el foco sale del panel (Tab / Shift+Tab) el menú se cierra: no queda
  // abierto tapando el contenido. El botón Menú/Cerrar cuenta como parte del
  // panel (si no, al tocarlo se cerraría y se volvería a abrir).
  nav.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !nav.contains(next) && next !== toggle && !toggle.contains(next)) {
      setOpen(false, { restoreFocus: false });
    }
  });
  let mql = null;
  const onViewportChange = () => {
    if (open && mql && !mql.matches) setOpen(false, { restoreFocus: false });
  };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onPointerDown);
  try {
    mql = window.matchMedia('(max-width: 880px)');
    mql.addEventListener('change', onViewportChange);
  } catch {
    mql = null;
  }

  return {
    el: header,
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('pointerdown', onPointerDown);
      if (mql) mql.removeEventListener('change', onViewportChange);
    },
  };
}

/**
 * Encabezado simple de las pantallas de un solo objetivo (ingreso,
 * bienvenida, demo): marca a la izquierda y acciones a la derecha.
 */
export function flowHeader({ brandHref = '#/', brandLabel = undefined, middle = null, actions = [] } = {}) {
  return h(
    'header',
    { class: 'pub-flow-header' },
    h(
      'div',
      { class: 'pub-container pub-flow-header-inner' },
      h('div', { class: 'pub-flow-header-start' }, brand({ href: brandHref, label: brandLabel }), middle),
      h('div', { class: 'pub-flow-header-actions' }, ...actions.filter(Boolean)),
    ),
  );
}

/** Enlace discreto de encabezado (Volver, Saltar, Salir…), táctil ≥ 44 px. */
export function headerLink(label, href, { iconBefore = null } = {}) {
  return h('a', { class: 'pub-header-link', href }, iconBefore ? publicIcon(iconBefore, { size: 18 }) : null, h('span', {}, label));
}

// --------------------------------------------------------------------- pie

/** Pie mínimo del sitio público con la versión del build. */
export function siteFooter(app) {
  const version = (app && app.version) || {};
  const versionText = `v${version.version || 'dev'} · build ${version.commit || 'local'}`;
  return h(
    'footer',
    { class: 'pub-footer' },
    h(
      'div',
      { class: 'pub-container pub-footer-inner' },
      h(
        'div',
        { class: 'pub-footer-main' },
        h('div', { class: 'pub-footer-brand' }, brand({ className: 'pub-brand-sm' }), h('p', {}, 'Hecho en Neuquén, Patagonia argentina.')),
        h('p', { class: 'pub-footer-privacy' }, publicIcon('lock', { size: 16 }), h('span', {}, 'Tus datos se guardan en tu navegador: no se envían a ningún servidor.')),
      ),
      h('div', { class: 'pub-footer-meta' }, h('a', { href: '#/login', class: 'pub-footer-link' }, 'Ingresar'), h('span', { class: 'pub-footer-version mono' }, versionText)),
    ),
  );
}
