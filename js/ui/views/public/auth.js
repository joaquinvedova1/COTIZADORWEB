/**
 * Ingreso (#/login) y registro (#/registro).
 *
 * RATEOS TODAVÍA NO TIENE CUENTAS (ver docs/AUTH_ARCHITECTURE.md). Estas
 * pantallas son el flujo visual preparado para conectar Supabase Auth a
 * través de `app.ctx.auth` (js/services/auth-service.js), SIN autenticación
 * ficticia:
 *
 * - Los formularios interceptan el envío (preventDefault; además la CSP
 *   tiene form-action 'none'). Nunca se leen, guardan ni envían el email
 *   ni la contraseña; el campo contraseña se vacía al enviar.
 * - El registro sólo usa el nombre de la EMPRESA, que se guarda en la
 *   organización local (saveOrganization({ name })).
 * - Un aviso honesto, visible antes de enviar, explica que todo funciona en
 *   este navegador, sin usuario ni contraseña.
 *
 * Cuando exista un proveedor real (`app.ctx.auth.available === true`), el
 * envío llamará a `app.ctx.auth.signIn()` / `signUp()`; las credenciales
 * irán directo al servicio y nunca se guardarán en el navegador.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { icon } from '../../components.js';
import { sanitizeText } from '../../../core/validation.js';
import { logger } from '../../../core/logger.js';
import { userErrorMessage } from '../../layout.js';
import { brand, headerLink, isReadOnly, pubLink, publicIcon } from './public-chrome.js';

const MAX_COMPANY_LENGTH = 120;
const LOCAL_MODE_NOTICE = 'Las cuentas de RATEOS todavía no están habilitadas. Por ahora todo funciona en este navegador, sin usuario ni contraseña: tus datos no salen de tu computadora.';

/** Campo de formulario con label real (sin valores precargados). */
function field({ label, type = 'text', name, autocomplete, hint = null, maxLength = 200, inputmode = null, placeholder = '' }) {
  const id = uniqueId('pub-f');
  const input = h('input', {
    id,
    name,
    type,
    autocomplete,
    maxlength: String(maxLength),
    inputmode,
    placeholder: placeholder || null,
    autocapitalize: type === 'email' || type === 'password' ? 'none' : null,
    spellcheck: type === 'email' || type === 'password' ? 'false' : null,
    'aria-describedby': hint ? `${id}-hint` : null,
  });
  return {
    input,
    el: h('div', { class: 'pub-field' }, h('label', { class: 'pub-label', for: id }, label), input, hint ? h('p', { class: 'pub-field-hint', id: `${id}-hint` }, hint) : null),
  };
}

function localNotice() {
  return h('div', { class: 'pub-notice', role: 'note' }, publicIcon('info', { size: 18 }), h('p', {}, LOCAL_MODE_NOTICE));
}

/** Estructura común: Volver, marca arriba, tarjeta angosta y salida sin cuenta. */
function authLayout({ title, subtitle, form, switchText, switchLabel, switchHref }) {
  return h(
    'div',
    { class: 'pub-page pub-auth' },
    h('div', { class: 'pub-auth-top' }, headerLink('Volver', '#/', { iconBefore: 'arrowLeft' })),
    h(
      'div',
      { class: 'pub-auth-center' },
      brand({ className: 'pub-auth-brand' }),
      h(
        'div',
        { class: 'pub-auth-card' },
        h('h1', { class: 'pub-auth-title', tabindex: '-1' }, title),
        h('p', { class: 'pub-auth-sub' }, subtitle),
        localNotice(),
        form,
        h('p', { class: 'pub-auth-switch' }, `${switchText} `, h('a', { href: switchHref }, switchLabel)),
      ),
      h(
        'a',
        { class: 'pub-auth-local', href: '#/inicio' },
        h('span', { class: 'pub-auth-local-text' }, h('strong', {}, 'Entrar sin cuenta'), h('span', {}, ' (modo local)')),
        icon('arrowRight', { size: 18 }),
      ),
      h('p', { class: 'pub-auth-foot' }, publicIcon('lock', { size: 16 }), h('span', {}, 'Tus datos se guardan en este navegador. No se envían a ningún servidor.')),
    ),
  );
}

/** Vacía el campo contraseña (nunca se lee su valor). */
function clearPassword(input) {
  input.value = '';
}

export function renderLogin(root, app) {
  app.setHeader({ title: 'Ingresar' });

  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
  const password = field({ label: 'Contraseña', type: 'password', name: 'password', autocomplete: 'current-password', maxLength: 200 });
  const feedback = h('div', { class: 'pub-form-feedback', role: 'status', 'aria-live': 'polite' });

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Ingresar a RATEOS' },
    email.el,
    password.el,
    h('button', { type: 'submit', class: 'btn btn-primary btn-lg pub-btn pub-btn-block' }, 'Ingresar'),
    feedback,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // No se leen el email ni la contraseña: no hay cuentas todavía.
    clearPassword(password.input);
    mount(
      feedback,
      h(
        'div',
        { class: 'pub-feedback-card' },
        h('p', {}, h('strong', {}, 'Todavía no hay cuentas para ingresar. '), 'Podés seguir en este navegador.'),
        pubLink('Entrar sin cuenta', '#/inicio', { tone: 'secondary', size: 'md', iconAfter: 'arrowRight' }),
      ),
    );
  });

  mount(
    root,
    authLayout({
      title: 'Bienvenido de nuevo.',
      subtitle: 'Ingresá para seguir con tus cotizaciones.',
      form,
      switchText: '¿Todavía no tenés cuenta?',
      switchLabel: 'Crear cuenta',
      switchHref: '#/registro',
    }),
  );
}

export function renderRegister(root, app) {
  app.setHeader({ title: 'Crear cuenta' });

  const name = field({ label: 'Nombre', name: 'name', autocomplete: 'name', maxLength: 120 });
  const company = field({
    label: 'Empresa',
    name: 'organization',
    autocomplete: 'organization',
    maxLength: MAX_COMPANY_LENGTH,
    hint: 'Es lo único que guardamos, en este navegador, para tus cotizaciones.',
  });
  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
  const password = field({ label: 'Contraseña', type: 'password', name: 'new-password', autocomplete: 'new-password', maxLength: 200 });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg pub-btn pub-btn-block' }, 'Comenzar');

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Crear una cuenta de RATEOS' },
    name.el,
    company.el,
    email.el,
    password.el,
    submit,
    h('p', { class: 'pub-form-note' }, 'Nombre, email y contraseña no se guardan mientras las cuentas no estén habilitadas.'),
  );

  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Sólo se usa el nombre de la empresa. El email y la contraseña no se leen.
    clearPassword(password.input);
    if (busy) return;
    busy = true;
    submit.disabled = true;
    const companyName = sanitizeText(company.input.value, MAX_COMPANY_LENGTH);
    try {
      if (companyName && isReadOnly(app)) {
        app.toast('Tus datos están en modo sólo lectura: el nombre de la empresa no se guardó.', 'warning');
      } else if (companyName) {
        await app.ctx.settings.saveOrganization({ name: companyName });
        await app.refreshChrome();
      }
    } catch (error) {
      logger.warn('No se pudo guardar el nombre de la empresa', { name: error && error.name });
      app.toast(userErrorMessage(error, 'No se pudo guardar el nombre de la empresa. Podés cargarlo después en Configuración.'), 'warning');
    }
    busy = false;
    submit.disabled = false;
    app.navigate('#/bienvenida');
  });

  mount(
    root,
    authLayout({
      title: 'Creá tu cuenta',
      subtitle: 'Empezá a cotizar sabiendo cuánto te cuesta cada servicio.',
      form,
      switchText: '¿Ya tenés cuenta?',
      switchLabel: 'Ingresar',
      switchHref: '#/login',
    }),
  );
}
