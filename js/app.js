/**
 * RATEOS — punto de entrada (bootstrap).
 *
 * 1. Instala el manejo global de errores (logger + aviso amigable).
 * 2. Lee version.json (si no existe, versión "dev").
 * 3. Restaura la sesión de Supabase Auth (mientras tanto sólo se ve
 *    "Cargando RATEOS…": nunca la app protegida) y procesa los enlaces de
 *    los emails (confirmación / recuperación).
 * 4. Con sesión, abre la cuenta: organización real + workspace en la nube
 *    (SupabaseRepository, protegido por RLS). La demo pública usa otro
 *    contexto, en memoria.
 * 5. Construye el layout, el objeto `app` (contrato de vistas) y el router,
 *    que separa rutas públicas, de ingreso y protegidas.
 *
 * Los cálculos siguen ocurriendo en el navegador (motores puros). Sin
 * analytics, sin IA. Sólo URL + publishable key de Supabase en el frontend.
 */

import { APP_NAME } from './config.js';
import { logger } from './core/logger.js';
import { track } from './core/events.js';
import { createAccountContext, createDemoContext } from './services/app-context.js';
import { createAuthService } from './services/auth-service.js';
import { loginHash } from './services/auth-routing.js';
import { createCloud } from './services/cloud.js';
import { loadVersionInfo } from './services/settings-service.js';
import { createRecoveryService } from './services/recovery-service.js';
import { h, mount, downloadText } from './ui/dom.js';
import { banner, button, card, confirmDialog, ensureToastRegion, toast } from './ui/components.js';
import { createLayout, userErrorMessage } from './ui/layout.js';
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
  if (code === 'corrupt_no_space' && error.message) return error.message;
  if (code === 'stale_state') return 'Los datos se modificaron en otra pestaña y no se pudieron leer. Recargá la página.';
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
/**
 * Staging (/preview/): sus datos de la nube son los de producción. Antes de
 * actualizar el formato se pregunta; si no se acepta, se abren en sólo lectura.
 */
function confirmStagingUpgrade(fromVersion, toVersion) {
  return confirmDialog({
    title: 'Versión de prueba: ¿actualizar el formato de tus datos?',
    message: `Esta es la versión de prueba (staging). Tus datos en la nube están en el formato ${fromVersion}, el que usa la versión publicada. Si los actualizás al formato ${toVersion}, la versión publicada los va a abrir en sólo lectura hasta que esta versión se publique. Antes de actualizar se guarda una copia en este navegador.`,
    confirmLabel: 'Actualizar mis datos',
    cancelLabel: 'Ver sin cambiar (sólo lectura)',
  });
}

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
          h('li', {}, 'Si sigue fallando, abrí RATEOS en otro navegador e importá el archivo desde Configuración → Datos y backup.'),
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

/**
 * Aviso corto y discreto de datos de ejemplo. "Cargar mis datos" lleva a
 * Configuración → Datos y backup, donde está "Empezar con mi empresa en
 * limpio" (y el detalle de qué significa ILUSTRATIVO vive en Empresa).
 */
function demoBanner() {
  const el = banner('Tu empresa y tus recursos todavía son de ejemplo (ILUSTRATIVOS).', 'warning');
  el.classList.add('banner-compact', 'banner-demo-global');
  el.setAttribute('title', 'Los valores de la empresa de ejemplo no son escalas salariales, cargas, alícuotas, precios ni costos reales.');
  el.appendChild(h('a', { class: 'banner-link', href: '#/configuracion/datos' }, 'Cargar mis datos'));
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
    el.appendChild(h('a', { class: 'banner-link', href: '#/configuracion/datos' }, 'Exportar backup'));
    out.push(el);
  }
  if (org && org.illustrative === true && !dismissed.has('illustrative')) {
    out.push(withDismiss(demoBanner(), () => dismiss('illustrative')));
  }
  return out;
}

// ------------------------------------------------------------- cuenta

const SYNC_LABELS = Object.freeze({
  idle: 'Conectando…',
  saving: 'Guardando en la nube…',
  saved: 'Guardado en la nube',
  pending: 'Cambios sin sincronizar',
  offline: 'Sin conexión: cambios sin sincronizar',
  error: 'No pudimos sincronizar',
  conflict: 'Conflicto: tus datos cambiaron en otro dispositivo',
  session_expired: 'Sesión vencida: cambios sin sincronizar',
});

function countsText(counts) {
  const parts = [];
  if (counts.quotes) parts.push(`${counts.quotes} ${counts.quotes === 1 ? 'cotización' : 'cotizaciones'}`);
  if (counts.resources) parts.push(`${counts.resources} ${counts.resources === 1 ? 'recurso' : 'recursos'}`);
  if (counts.services) parts.push(`${counts.services} ${counts.services === 1 ? 'plantilla' : 'plantillas'}`);
  return parts.join(', ');
}

/** "Tus datos cambiaron en otro dispositivo." [Recargar] [Conservar una copia] */
function conflictBanner(ctx, { onReloaded }) {
  const el = banner('Para no pisar nada, tus últimos cambios de esta pestaña no se subieron. Recargá para ver la versión más nueva; si querés, antes conservá una copia de la tuya.', 'danger', { title: 'Tus datos cambiaron en otro dispositivo.' });
  const actions = h('div', { class: 'banner-actions' },
    button('Recargar', {
      variant: 'primary',
      size: 'sm',
      onClick: async () => {
        try {
          await ctx.sync.reloadFromCloud();
          toast('Abrimos la versión más nueva. Tus cambios de esta pestaña quedaron en una copia de recuperación.', 'info', { timeout: 6000 });
          onReloaded();
        } catch (error) {
          toast(userErrorMessage(error, 'No pudimos recargar. Revisá tu conexión.'), 'danger');
        }
      },
    }),
    button('Conservar una copia', {
      variant: 'secondary',
      size: 'sm',
      icon: 'download',
      onClick: () => {
        downloadText(`rateos-copia-local-${new Date().toISOString().slice(0, 10)}.json`, ctx.sync.localCopyText());
        toast('Descargamos tu versión como backup. Ahora tocá "Recargar" para ver la más nueva.', 'success', { timeout: 6000 });
      },
    }));
  el.appendChild(actions);
  return el;
}

/** "Encontramos datos guardados en este navegador." [Importarlos a mi cuenta] [Empezar en limpio] */
function localImportBanner(ctx, info, { onDone }) {
  const el = banner(`Hay ${countsText(info.counts)} de cuando usabas RATEOS sin cuenta. Podés sumarlos a tu cuenta (los datos de ejemplo no se importan).`, 'info', { title: 'Encontramos datos guardados en este navegador.' });
  const importBtn = button('Importarlos a mi cuenta', {
    variant: 'primary',
    size: 'sm',
    onClick: async () => {
      importBtn.disabled = true;
      try {
        const res = await ctx.localImport.importToAccount();
        if (!res.ok) {
          toast(res.message, 'warning', { timeout: 6000 });
        } else {
          toast(`Importamos ${countsText(res) || 'tus datos'} a tu cuenta. Antes guardamos una copia de seguridad en este navegador.`, 'success', { timeout: 6000 });
        }
        onDone();
      } catch (error) {
        importBtn.disabled = false;
        toast(userErrorMessage(error, 'No pudimos importar tus datos. Siguen guardados en este navegador.'), 'danger', { timeout: 6000 });
      }
    },
  });
  el.appendChild(h('div', { class: 'banner-actions' },
    importBtn,
    button('Empezar en limpio', {
      variant: 'secondary',
      size: 'sm',
      onClick: () => {
        ctx.localImport.skip();
        toast('Listo. Los datos de este navegador quedan guardados acá, sin tocar.', 'info');
        onDone();
      },
    })));
  return el;
}

function syncBanner(state, ctx) {
  if (state.status === 'offline' || state.status === 'error') {
    const el = banner(state.message || 'No pudimos sincronizar tus cambios.', 'warning', { title: 'No pudimos sincronizar tus cambios.' });
    el.appendChild(h('div', { class: 'banner-actions' }, button('Reintentar', {
      variant: 'secondary',
      size: 'sm',
      onClick: () => ctx.sync.retry().then(() => toast('Cambios sincronizados.', 'success')).catch((error) => toast(userErrorMessage(error, 'Todavía no pudimos sincronizar.'), 'warning')),
    })));
    return el;
  }
  return null;
}

// ------------------------------------------------------------------ boot

async function boot(root) {
  let version = FALLBACK_VERSION;
  try {
    version = { ...FALLBACK_VERSION, ...(await loadVersionInfo()) };
  } catch {
    version = FALLBACK_VERSION;
  }

  let cloud;
  let auth;
  try {
    cloud = createCloud();
    auth = createAuthService({ gateway: cloud.authGateway });
  } catch (error) {
    logger.error('No se pudo iniciar RATEOS', { name: error && error.name });
    renderStartupError(root, error, version);
    return;
  }

  // auth-loading: mientras se restaura la sesión sólo se ve "Cargando RATEOS…".
  let redirect = null;
  try {
    ({ redirect } = await auth.init());
  } catch (error) {
    logger.warn('No se pudo restaurar la sesión', { name: error && error.name });
  }

  let account = null;
  let accountState = 'idle';
  let accountError = null;
  let demoPromise = null;
  let flash = null;
  let router = null;
  let unsubscribeSync = null;
  const dismissed = new Set();

  const layout = createLayout(root, { version });

  const renderBanners = () => {
    if (!account) {
      layout.setBanners([]);
      return;
    }
    const org = { name: account.organizationName(), illustrative: false };
    const out = buildBanners(account, org, dismissed, (id) => {
      dismissed.add(id);
      renderBanners();
    });
    const state = account.sync.getState();
    if (state.conflict) out.unshift(conflictBanner(account, { onReloaded: () => { renderBanners(); router.render(); } }));
    else {
      const sb = syncBanner(state, account);
      if (sb) out.unshift(sb);
    }
    let info = { available: false };
    try {
      info = account.localImport.inspect();
    } catch (error) {
      logger.warn('No se pudieron revisar los datos locales', { name: error && error.name });
    }
    if (info.available) out.push(localImportBanner(account, info, { onDone: () => { renderBanners(); router.render(); } }));
    layout.setBanners(out);
  };

  const app = {
    get ctx() {
      return account;
    },
    auth,
    version,
    /** Demo pública aislada (en memoria). */
    demo() {
      if (!demoPromise) demoPromise = createDemoContext({ appVersion: version.version });
      return demoPromise;
    },
    /** 'loading' | 'anonymous' | 'authenticated' | 'error' (cuenta que no se pudo abrir). */
    accessStatus() {
      if (auth.status === 'loading') return 'loading';
      if (auth.status === 'anonymous') return 'anonymous';
      if (accountState === 'ready') return 'authenticated';
      if (accountState === 'error') return 'error';
      return 'loading';
    },
    /** Mensaje de una sola vez para la próxima pantalla (p. ej. "Tu sesión terminó"). */
    setFlash(message, tone = 'info') {
      flash = message ? { message, tone } : null;
    },
    takeFlash() {
      const f = flash;
      flash = null;
      return f;
    },
    navigate: (hash, options) => router.navigate(hash, options),
    toast: (message, tone = 'info') => toast(message, tone),
    setHeader: (options) => layout.setHeader(options),
    getSettings: () => (account ? account.settings.get() : null),
    async refreshChrome() {
      if (!account) return;
      let organization = null;
      try {
        organization = await account.settings.getOrganization();
      } catch (error) {
        logger.warn('No se pudo leer la organización', { name: error && error.name });
      }
      layout.setOrganization({ ...(organization || {}), name: account.organizationName() });
      layout.setAccount({ name: account.account.user.fullName, email: account.account.user.email, role: account.account.roleLabel, platformAdmin: account.account.platformAdmin === true });
      renderBanners();
    },
    /** Cierra la sesión (avisa si hay cambios sin sincronizar). */
    async signOut() {
      if (account) {
        const state = account.sync.getState();
        if (state.dirty) {
          const ok = await confirmDialog({
            title: 'Tenés cambios sin sincronizar',
            message: 'Quedan guardados en este navegador y se suben la próxima vez que ingreses acá. ¿Cerrar sesión igual?',
            confirmLabel: 'Cerrar sesión',
          });
          if (!ok) return;
        }
      }
      const res = await auth.signOut();
      if (!res.ok && res.message) toast(res.message, 'warning');
    },
    renderAccountError(container) {
      mount(container, h('div', { class: 'auth-loading auth-error', role: 'alert' },
        h('p', {}, userErrorMessage(accountError, 'No pudimos abrir tu cuenta.')),
        h('div', { class: 'row' },
          button('Reintentar', { variant: 'primary', onClick: () => openAccount() }),
          button('Cerrar sesión', { variant: 'secondary', onClick: () => app.signOut() }))));
    },
  };

  layout.onSignOut(() => app.signOut());

  async function openAccount() {
    if (!auth.user) return;
    accountState = 'loading';
    accountError = null;
    if (router) router.render();
    const user = auth.user;
    try {
      const ctx = await createAccountContext({
        user,
        workspaceGateway: cloud.workspaceGateway,
        adminGateway: cloud.adminGateway,
        appVersion: version.version,
        // En staging (/preview/) los datos de la nube son los de producción:
        // actualizar su formato haría que la versión publicada los abra en
        // sólo lectura. Se pregunta antes; si no, se ven sin cambiarlos.
        confirmSchemaUpgrade: version.channel === 'staging' ? confirmStagingUpgrade : null,
      });
      // Mientras se abría, la sesión se cerró o cambió de persona (otra pestaña): se descarta.
      if (auth.status !== 'authenticated' || !auth.user || auth.user.id !== user.id) {
        ctx.dispose();
        accountState = 'idle';
        // Si ahora hay otra persona con sesión, se abre SU cuenta.
        if (auth.status === 'authenticated' && auth.user) await openAccount();
        return;
      }
      account = ctx;
      accountState = 'ready';
      if (unsubscribeSync) unsubscribeSync();
      let lastStatus = null;
      unsubscribeSync = ctx.sync.onChange((state) => {
        layout.setSyncStatus({ status: state.status, label: SYNC_LABELS[state.status] || '' });
        // Sólo se redibujan los avisos cuando cambia el tipo de estado.
        if (state.status !== lastStatus) {
          lastStatus = state.status;
          renderBanners();
          // La base rechazó la sesión: se renueva una vez y se reintenta; si
          // no se puede, "Tu sesión terminó. Volvé a ingresar." (los cambios
          // quedan en la copia local y se suben al volver a ingresar).
          if (state.status === 'session_expired') {
            auth.revalidate().then((res) => {
              if (res.ok && account === ctx) ctx.sync.retry().catch(() => undefined);
            }).catch(() => undefined);
          }
        }
      });
      const s = ctx.sync.getState();
      layout.setSyncStatus({ status: s.status, label: SYNC_LABELS[s.status] || '' });
      await app.refreshChrome();
      track('app_started', { isDemo: false });
    } catch (error) {
      logger.warn('No se pudo abrir la cuenta', { name: error && error.name, code: error && error.code });
      accountError = error;
      accountState = 'error';
      if (error && error.code === 'session_expired') {
        app.setFlash('Tu sesión terminó. Volvé a ingresar.', 'warning');
        await auth.signOut();
        return;
      }
    }
    if (router) router.render();
  }

  function closeAccount() {
    if (unsubscribeSync) unsubscribeSync();
    unsubscribeSync = null;
    if (account) account.dispose();
    account = null;
    accountState = 'idle';
    layout.setAccount(null);
    layout.setBanners([]);
  }

  router = createRouter({ app, layout });

  if (auth.status === 'authenticated') await openAccount();

  // Enlaces de los emails (confirmación / recuperación).
  if (redirect) {
    if (auth.snapshot().recoveryMode) router.navigate('#/recuperar-contrasena', { replace: true });
    else if (redirect.ok) {
      app.setFlash(redirect.kind === 'confirm' ? 'Tu email quedó confirmado. ¡Bienvenido a RATEOS!' : null, 'success');
      window.history.replaceState(null, '', `#${redirect.next || '/inicio'}`);
    } else if (redirect.message) {
      app.setFlash(redirect.message, 'warning');
      window.history.replaceState(null, '', '#/login');
    }
  }

  router.start();

  auth.subscribe(async (state) => {
    if (state.status === 'authenticated') {
      if (state.recoveryMode) {
        router.navigate('#/recuperar-contrasena');
        return;
      }
      // Otra persona ingresó en otra pestaña: nunca se siguen mostrando los datos de la anterior.
      if (account && state.user && account.account.user.id !== state.user.id) {
        closeAccount();
        router.navigate('#/inicio', { replace: true });
      }
      if (!account && accountState !== 'loading') await openAccount();
      return;
    }
    if (state.status === 'anonymous' && (account || accountState !== 'idle')) {
      const current = router.current();
      const path = current && current.route && current.route.access === 'auth' ? current.path : null;
      closeAccount();
      if (state.endReason === 'expired') {
        app.setFlash('Tu sesión terminó. Volvé a ingresar.', 'warning');
        router.navigate(loginHash(path, { expired: true }));
      } else {
        router.navigate('#/');
      }
    }
  });
}

/**
 * Anti-clickjacking: GitHub Pages no permite enviar X-Frame-Options ni
 * frame-ancestors (una CSP en <meta> no lo soporta), así que RATEOS se niega
 * a funcionar dentro de otra página (botones de cuenta "debajo" de otro sitio).
 */
function isFramed() {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function renderFramed(root) {
  mount(root, h('div', { class: 'auth-loading auth-error', role: 'alert' },
    h('p', {}, 'Por seguridad, RATEOS no se puede usar dentro de otra página.'),
    h('a', { href: window.location.href.split('#')[0], target: '_top', rel: 'noopener noreferrer' }, 'Abrir RATEOS en una pestaña propia')));
}

const appRoot = document.getElementById('app');
installGlobalErrorHandlers();
// La región de avisos (aria-live) existe vacía desde el inicio: así los
// lectores de pantalla anuncian también el primer aviso.
ensureToastRegion();
if (appRoot) {
  if (isFramed()) renderFramed(appRoot);
  else boot(appRoot);
}
