/**
 * Router por hash (window.location.hash). Funciona bajo cualquier sub-ruta
 * (p. ej. /COTIZADORWEB/) porque nunca toca el pathname.
 *
 * - Rutas exactas con parámetros `:id`, `:step`, `:tab`.
 * - Dos "shells": público (landing, ingreso, registro, bienvenida, demo) y
 *   aplicación (con menú lateral). Cada ruta declara el suyo.
 * - Redirige enlaces viejos (#/biblioteca, #/dashboard) a las rutas nuevas.
 * - Carga las vistas con import() dinámico (rutas relativas).
 * - Llama a la función de limpieza de la vista anterior.
 * - Marca aria-current="page" en la navegación, vuelve al inicio de la
 *   página y enfoca el título.
 * - Si una vista falla, muestra una tarjeta de error sin romper la app.
 */

import { h, mount } from './dom.js';
import { button, card } from './components.js';
import { logger } from '../core/logger.js';
import { render as renderNotFound } from './views/not-found.js';

/** Pestañas válidas de Recursos (#/recursos/:tab). */
export const RESOURCE_TABS = Object.freeze(['personal', 'equipos', 'materiales', 'ubicaciones']);

/** Pestañas válidas de Configuración (#/configuracion/:tab). */
export const SETTINGS_TABS = Object.freeze(['empresa', 'parametros', 'convenios', 'datos', 'acerca']);

/** Pestañas de la antigua "Biblioteca" (sólo para redirigir enlaces viejos). */
export const LIBRARY_TABS = Object.freeze(['personal', 'convenios', 'equipos', 'materiales', 'ubicaciones']);

/** Hash de la pantalla de inicio de la aplicación (la raíz "#/" es la landing pública). */
export const APP_HOME = '#/inicio';

/**
 * Tabla de rutas. El orden importa: gana la primera que coincide
 * (por eso `cotizaciones/nueva` va antes que `cotizaciones/:id`).
 *
 * - shell: 'public' (landing, ingreso, registro, bienvenida, demo; sin
 *   menú lateral) | 'app' (aplicación con menú lateral).
 * - redirect(params): hash al que se redirige (enlaces viejos).
 */
export const ROUTES = Object.freeze([
  // ------------------------------------------------------------ públicas
  { name: 'landing', segments: [], shell: 'public', nav: null, title: '', load: () => import('./views/public/landing.js'), view: 'render' },
  { name: 'login', segments: ['login'], shell: 'public', nav: null, title: 'Ingresar', load: () => import('./views/public/auth.js'), view: 'renderLogin' },
  { name: 'register', segments: ['registro'], shell: 'public', nav: null, title: 'Crear cuenta', load: () => import('./views/public/auth.js'), view: 'renderRegister' },
  { name: 'onboarding', segments: ['bienvenida'], shell: 'public', nav: null, title: 'Bienvenido', load: () => import('./views/public/onboarding.js'), view: 'render' },
  { name: 'demo', segments: ['demo'], shell: 'public', nav: null, title: 'Probar con un ejemplo', load: () => import('./views/public/demo-tour.js'), view: 'render' },
  // ---------------------------------------------------------- aplicación
  { name: 'home', segments: ['inicio'], shell: 'app', nav: 'home', title: 'Inicio', load: () => import('./views/dashboard.js'), view: 'render' },
  { name: 'quotes', segments: ['cotizaciones'], shell: 'app', nav: 'quotes', title: 'Cotizaciones', load: () => import('./views/quotes-list.js'), view: 'render' },
  { name: 'new-quote', segments: ['cotizaciones', 'nueva'], shell: 'app', nav: 'quotes', title: 'Nueva cotización', load: () => import('./views/quotes-list.js'), view: 'renderNewQuote' },
  { name: 'quote-editor', segments: ['cotizaciones', ':id'], shell: 'app', nav: 'quotes', title: 'Cotización', defaults: { step: 'service' }, load: () => import('./views/quote-editor.js'), view: 'render' },
  { name: 'quote-editor-step', segments: ['cotizaciones', ':id', ':step'], shell: 'app', nav: 'quotes', title: 'Cotización', load: () => import('./views/quote-editor.js'), view: 'render' },
  { name: 'resources', segments: ['recursos'], shell: 'app', nav: 'resources', title: 'Recursos', defaults: { tab: 'personal' }, load: () => import('./views/library.js'), view: 'render' },
  { name: 'resources-tab', segments: ['recursos', ':tab'], shell: 'app', nav: 'resources', title: 'Recursos', validate: (p) => RESOURCE_TABS.includes(p.tab), load: () => import('./views/library.js'), view: 'render' },
  { name: 'services', segments: ['servicios'], shell: 'app', nav: 'services', title: 'Servicios', load: () => import('./views/services.js'), view: 'render' },
  { name: 'scenarios', segments: ['escenarios'], shell: 'app', nav: 'scenarios', title: 'Escenarios', load: () => import('./views/scenarios.js'), view: 'render' },
  { name: 'scenarios-quote', segments: ['escenarios', ':id'], shell: 'app', nav: 'scenarios', title: 'Escenarios', load: () => import('./views/scenarios.js'), view: 'render' },
  { name: 'settings', segments: ['configuracion'], shell: 'app', nav: 'settings', title: 'Configuración', defaults: { tab: 'empresa' }, load: () => import('./views/settings.js'), view: 'render' },
  { name: 'settings-tab', segments: ['configuracion', ':tab'], shell: 'app', nav: 'settings', title: 'Configuración', validate: (p) => SETTINGS_TABS.includes(p.tab), load: () => import('./views/settings.js'), view: 'render' },
  // ------------------------------------------------- enlaces viejos (redirigen)
  { name: 'legacy-dashboard', segments: ['dashboard'], shell: 'app', nav: 'home', title: 'Inicio', redirect: () => APP_HOME },
  { name: 'legacy-library', segments: ['biblioteca'], shell: 'app', nav: 'resources', title: 'Recursos', redirect: () => '#/recursos/personal' },
  {
    name: 'legacy-library-tab',
    segments: ['biblioteca', ':tab'],
    shell: 'app',
    nav: 'resources',
    title: 'Recursos',
    validate: (p) => LIBRARY_TABS.includes(p.tab),
    redirect: (p) => (p.tab === 'convenios' ? '#/configuracion/convenios' : `#/recursos/${p.tab}`),
  },
]);

const NOT_FOUND = Object.freeze({ name: 'not-found', shell: 'app', nav: null, title: 'Página no encontrada' });

/**
 * Normaliza un hash a una ruta: "" | "#" → "/", "#/a/b/" → "/a/b".
 * Ignora una eventual query (?x=1).
 */
export function hashToPath(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const withoutQuery = raw.split('?')[0];
  if (withoutQuery === '' || withoutQuery === '/') return '/';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Busca la ruta que corresponde a un hash. Función pura (testeable).
 * @returns {{ route: object, params: object, nav: string|null, path: string, notFound: boolean }}
 */
export function matchRoute(hash) {
  const path = hashToPath(hash);
  const rawHash = String(hash || '').replace(/^#/, '');
  // Un hash que no empieza con "/" (p. ej. "#contenido") no es una ruta.
  if (rawHash !== '' && !rawHash.startsWith('/')) return { route: NOT_FOUND, params: { path }, nav: null, path, notFound: true };
  const parts = path === '/' ? [] : path.slice(1).split('/');
  let decoded;
  try {
    decoded = parts.map((p) => decodeURIComponent(p));
  } catch {
    return { route: NOT_FOUND, params: { path }, nav: null, path, notFound: true };
  }
  for (const route of ROUTES) {
    if (route.segments.length !== decoded.length) continue;
    const params = { ...(route.defaults || {}) };
    let ok = true;
    for (let i = 0; i < route.segments.length; i += 1) {
      const seg = route.segments[i];
      const value = decoded[i];
      if (seg.startsWith(':')) {
        if (value === '') {
          ok = false;
          break;
        }
        params[seg.slice(1)] = value;
      } else if (seg !== value) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (typeof route.validate === 'function' && !route.validate(params)) break;
    return { route, params, nav: route.nav, path, notFound: false };
  }
  return { route: NOT_FOUND, params: { path }, nav: null, path, notFound: true };
}

function safeCleanup(fn) {
  if (typeof fn !== 'function') return;
  try {
    fn();
  } catch (error) {
    logger.error('Error al limpiar la vista anterior', { message: error && error.message });
  }
}

/**
 * Crea el router.
 * @param {{ app: object, layout: ReturnType<import('./layout.js').createLayout> }} deps
 */
export function createRouter({ app, layout }) {
  let sequence = 0;
  let cleanup = null;
  let current = null;
  let started = false;

  function errorCard(content, { title, message, retry }) {
    mount(
      content,
      card(
        { title, className: 'view-error' },
        h('p', {}, message),
        h('p', { class: 'muted small' }, 'Tus datos guardados no se modificaron.'),
        h(
          'div',
          { class: 'row' },
          retry ? button('Reintentar', { variant: 'primary', onClick: retry }) : null,
          button('Ir al inicio', { variant: 'secondary', icon: 'home', onClick: () => app.navigate(APP_HOME) }),
        ),
      ),
    );
  }

  async function render() {
    const token = ++sequence;
    const isCurrent = () => token === sequence;

    if (window.location.hash === '' || window.location.hash === '#') {
      window.history.replaceState(null, '', '#/');
    }
    const match = matchRoute(window.location.hash);
    if (!match.notFound && typeof match.route.redirect === 'function') {
      const target = match.route.redirect(match.params);
      window.history.replaceState(null, '', target);
      return render();
    }
    current = match;

    const previousCleanup = cleanup;
    cleanup = null;
    safeCleanup(previousCleanup);

    layout.setShell(match.route.shell === 'public' ? 'public' : 'app');
    layout.setActiveNav(match.nav);
    const content = layout.resetContent();
    content.setAttribute('aria-busy', 'true');
    mount(content, h('div', { class: 'loading', role: 'status' }, 'Cargando…'));
    layout.setHeader({ title: match.route.title, breadcrumbs: [] });
    window.scrollTo(0, 0);

    // La vista recibe una copia de `app` cuyo setHeader se ignora si el
    // usuario ya navegó a otra pantalla mientras ésta cargaba.
    const viewApp = {
      ...app,
      setHeader: (opts) => {
        if (isCurrent()) layout.setHeader(opts);
      },
    };

    try {
      let viewFn;
      if (match.notFound) {
        viewFn = renderNotFound;
      } else {
        const mod = await match.route.load();
        if (!isCurrent()) return;
        viewFn = mod[match.route.view];
        if (typeof viewFn !== 'function') throw new Error(`La vista "${match.route.name}" no exporta ${match.route.view}().`);
      }
      const result = await viewFn(content, viewApp, { ...match.params });
      if (!isCurrent()) {
        safeCleanup(result);
        return;
      }
      cleanup = typeof result === 'function' ? result : null;
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('No se pudo mostrar la pantalla', { route: match.route.name, message: error && error.message });
      layout.setHeader({ title: match.route.title || 'Error', breadcrumbs: [{ label: 'Inicio', href: APP_HOME }] });
      const isLoadError = error instanceof TypeError && /import|module|fetch/i.test(String(error.message));
      errorCard(content, {
        title: 'No se pudo mostrar esta pantalla',
        message: isLoadError
          ? 'Esta pantalla no se pudo cargar. Puede que estés sin conexión o que la aplicación se haya actualizado: recargá la página.'
          : 'Ocurrió un error inesperado al preparar esta pantalla.',
        retry: () => render(),
      });
    }
    if (!isCurrent()) return;
    content.removeAttribute('aria-busy');
    layout.focusTitle();
  }

  return {
    start() {
      if (started) return;
      started = true;
      window.addEventListener('hashchange', () => render());
      render();
    },
    render,
    /** Navega a un hash. Si ya es el actual, vuelve a renderizar. */
    navigate(hash, { replace = false } = {}) {
      const target = String(hash || '#/').startsWith('#') ? String(hash || '#/') : `#${hash}`;
      if (replace) {
        window.history.replaceState(null, '', target);
        return render();
      }
      if (window.location.hash === target) return render();
      window.location.hash = target;
      return undefined;
    },
    current() {
      return current;
    },
  };
}
