/**
 * RATEOS — punto de entrada (bootstrap).
 *
 * 1. Instala el manejo global de errores (logger + aviso amigable).
 * 2. Lee version.json (si no existe, versión "dev").
 * 3. Crea el contexto de la aplicación (repositorio + servicios).
 *    Si falla, muestra una pantalla de error con opción de descargar los
 *    datos guardados crudos (nada se borra).
 * 4. Construye el layout, el objeto `app` (contrato de vistas) y el router.
 *
 * Todo se calcula en el navegador: sin backend, sin analytics, sin IA.
 */

import { APP_NAME } from './config.js';
import { logger } from './core/logger.js';
import { track } from './core/events.js';
import { createAppContext } from './services/app-context.js';
import { loadVersionInfo } from './services/settings-service.js';
import { createRecoveryService } from './services/recovery-service.js';
import { h, mount, downloadText } from './ui/dom.js';
import { banner, button, card, illustrativeBanner, toast } from './ui/components.js';
import { createLayout } from './ui/layout.js';
import { createRouter } from './ui/router.js';

const FALLBACK_VERSION = Object.freeze({ version: 'dev', commit: 'local', buildDate: null, ref: null });
const ERROR_TOAST_INTERVAL_MS = 5000;

/** Tono del banner según el resultado de inicializar los datos. */
const INIT_STATUS_TONE = Object.freeze({ migrated: 'warning', recovered: 'warning', repaired: 'warning', read_only: 'danger' });

// ------------------------------------------------------------ errores globales

let lastErrorToastAt = 0;

function reportUnexpectedError(kind, error) {
  // Sólo nombre y mensaje técnico; en producción el logger descarta el contexto.
  logger.error(`Error inesperado (${kind})`, { name: error && error.name, message: error && error.message });
  const now = Date.now();
  if (now - lastErrorToastAt < ERROR_TOAST_INTERVAL_MS) return;
  lastErrorToastAt = now;
  toast('Ocurrió un error inesperado. Tus datos guardados no se perdieron; si el problema sigue, recargá la página.', 'danger', { timeout: 6000 });
}

function installGlobalErrorHandlers(target = window) {
  target.addEventListener('error', (event) => reportUnexpectedError('error', event.error || { name: 'Error', message: event.message }));
  target.addEventListener('unhandledrejection', (event) => reportUnexpectedError('promesa', event.reason));
}

// -------------------------------------------------------- pantalla de error

function startupReason(error) {
  const code = error && error.code;
  if (code === 'read_failed') return 'El navegador no permite leer los datos guardados (puede estar en modo privado estricto o con el almacenamiento bloqueado).';
  if (code === 'quota_exceeded' && error.message) return error.message;
  if (code === 'write_failed') return 'El navegador no permitió guardar datos en este dispositivo.';
  if (code === 'unsupported_mode') return 'La configuración de almacenamiento de esta versión no es válida.';
  return 'Ocurrió un error inesperado al abrir tus datos.';
}

function rawUnavailableReason(recovery) {
  let info = { available: false, readable: false, hasState: false };
  try {
    info = recovery.inspect();
  } catch {
    /* se usa el diagnóstico por defecto */
  }
  if (!info.available) return 'El almacenamiento del navegador no está disponible, así que no se puede generar la copia.';
  if (!info.readable) return 'El navegador no deja leer los datos guardados en este momento, así que no se puede generar la copia. Cerrá otras pestañas de RATEOS y recargá.';
  return 'No hay datos guardados en este navegador.';
}

function recoveryKeyLabel(key) {
  return key.replace(/^rateos\.recovery\./, '');
}

/** Pantalla mostrada si createAppContext() falla. No accede al almacenamiento directamente. */
function renderStartupError(root, error, version) {
  const recovery = createRecoveryService();
  let rawDownload = null;
  let recoveryKeys = [];
  try {
    rawDownload = recovery.buildRawStateDownload();
    recoveryKeys = recovery.listRecoveryKeys();
  } catch {
    rawDownload = null;
    recoveryKeys = [];
  }

  const download = (file) => {
    if (!file) return;
    downloadText(file.filename, file.text);
    toast('Archivo descargado. Guardalo en un lugar seguro.', 'success');
  };

  root.removeAttribute('aria-busy');
  root.classList.remove('boot');
  document.title = `Error al iniciar · ${APP_NAME}`;

  const technical = `${(error && error.name) || 'Error'}${error && error.code ? ` · ${error.code}` : ''} · v${version.version} · build ${version.commit}`;

  mount(
    root,
    h(
      'main',
      { class: 'fatal-screen' },
      h(
        'div',
        { class: 'fatal-card' },
        h('div', { class: 'fatal-brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'R'), h('span', { class: 'fatal-brand-name' }, APP_NAME)),
        h('h1', {}, `${APP_NAME} no pudo iniciar`),
        banner(startupReason(error), 'danger', { title: 'No se pudieron abrir tus datos.' }),
        h('p', {}, 'Tus datos guardados en este navegador NO se borraron. Antes de probar otra cosa, descargá una copia tal como está guardada.'),
        h(
          'ol',
          { class: 'fatal-steps' },
          h('li', {}, 'Descargá los datos guardados (archivo .json).'),
          h('li', {}, 'Recargá la página. Si el problema era momentáneo, RATEOS va a abrir normalmente.'),
          h('li', {}, 'Si sigue fallando, abrí RATEOS en otro navegador e importá el archivo desde Configuración → Backup.'),
        ),
        h(
          'div',
          { class: 'row' },
          button('Descargar datos guardados', { variant: 'primary', icon: 'download', disabled: !rawDownload, onClick: () => download(recovery.buildRawStateDownload()) }),
          button('Reintentar', { variant: 'secondary', onClick: () => window.location.reload() }),
        ),
        rawDownload ? null : h('p', { class: 'muted small' }, rawUnavailableReason(recovery)),
        recoveryKeys.length
          ? card(
              { title: 'Copias de recuperación', subtitle: 'Copias automáticas guardadas antes de migrar, importar o restaurar datos.' },
              h(
                'ul',
                { class: 'recovery-list' },
                ...recoveryKeys.map((key) =>
                  h(
                    'li',
                    {},
                    h('code', {}, recoveryKeyLabel(key)),
                    button('Descargar', { variant: 'secondary', size: 'sm', icon: 'download', onClick: () => download(recovery.buildRecoveryDownload(key)) }),
                  ),
                ),
              ),
            )
          : null,
        h('p', { class: 'footnote' }, 'Detalle técnico: ', h('code', {}, technical)),
      ),
    ),
  );
}

// ---------------------------------------------------------------- banners

function withDismiss(el, onDismiss) {
  const close = button('', { variant: 'ghost', size: 'sm', icon: 'close', onClick: onDismiss, attrs: { 'aria-label': 'Ocultar este aviso', title: 'Ocultar este aviso' } });
  close.classList.add('banner-close');
  el.appendChild(close);
  return el;
}

function buildBanners(ctx, org, dismissed, dismiss) {
  const out = [];
  const init = ctx.init || {};
  const tone = INIT_STATUS_TONE[init.status];
  if (tone) {
    (Array.isArray(init.messages) ? init.messages : []).forEach((message, i) => {
      const id = `init-${i}`;
      if (tone === 'danger') {
        out.push(banner(message, 'danger', { title: 'Modo sólo lectura.' }));
      } else if (!dismissed.has(id)) {
        out.push(withDismiss(banner(message, 'warning', { title: 'Revisá tus datos.' }), () => dismiss(id)));
      }
    });
  }
  if (ctx.persistent === false) {
    const el = banner('Tu navegador no permite guardar datos: exportá un backup antes de cerrar.', 'warning', { title: 'Los cambios no se guardan.' });
    el.appendChild(h('a', { class: 'banner-link', href: '#/configuracion' }, 'Ir a Backup'));
    out.push(el);
  }
  if (org && org.illustrative === true && !dismissed.has('illustrative')) {
    const el = illustrativeBanner(
      'Estás usando datos de demostración de una empresa ficticia. Todos los valores son ILUSTRATIVOS: no son escalas salariales, cargas, alícuotas, precios ni costos reales. Reemplazalos por valores propios vigentes antes de cotizar.',
    );
    el.appendChild(h('a', { class: 'banner-link', href: '#/configuracion' }, 'Configurar mi empresa'));
    out.push(withDismiss(el, () => dismiss('illustrative')));
  }
  return out;
}

// ------------------------------------------------------------------ boot

async function boot(root) {
  let version = FALLBACK_VERSION;
  try {
    version = { ...FALLBACK_VERSION, ...(await loadVersionInfo()) };
  } catch {
    version = FALLBACK_VERSION;
  }

  let ctx;
  try {
    ctx = await createAppContext({ appVersion: version.version });
  } catch (error) {
    logger.error('No se pudo iniciar RATEOS', { name: error && error.name, code: error && error.code });
    renderStartupError(root, error, version);
    return;
  }

  try {
    const layout = createLayout(root, { version });
    const dismissed = new Set();
    let organization = null;
    let router = null;

    const renderBanners = () => {
      layout.setBanners(
        buildBanners(ctx, organization, dismissed, (id) => {
          dismissed.add(id);
          renderBanners();
        }),
      );
    };

    const app = {
      ctx,
      version,
      navigate: (hash, options) => router.navigate(hash, options),
      toast: (message, tone = 'info') => toast(message, tone),
      setHeader: (options) => layout.setHeader(options),
      getSettings: () => app.ctx.settings.get(),
      async refreshChrome() {
        try {
          organization = await ctx.settings.getOrganization();
        } catch (error) {
          logger.warn('No se pudo leer la organización', { name: error && error.name });
        }
        layout.setOrganization(organization);
        renderBanners();
      },
    };

    router = createRouter({ app, layout });
    await app.refreshChrome();
    router.start();
    track('app_started', { isDemo: Boolean(organization && organization.illustrative) });
  } catch (error) {
    logger.error('Error al construir la interfaz', { name: error && error.name, message: error && error.message });
    renderStartupError(root, error, version);
  }
}

const appRoot = document.getElementById('app');
installGlobalErrorHandlers();
if (appRoot) boot(appRoot);
