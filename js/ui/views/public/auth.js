/**
 * Ingreso (#/login) y registro (#/registro).
 *
 * RATEOS TODAVÍA NO TIENE CUENTAS (ver docs/AUTH_ARCHITECTURE.md). Estas
 * pantallas son el flujo visual preparado para conectar Supabase Auth a
 * través de `app.ctx.auth` (js/services/auth-service.js), SIN autenticación
 * ficticia y sin prometer lo que todavía no existe:
 *
 * - Los campos de cuenta (nombre, email y contraseña) se ven, pero están
 *   DESHABILITADOS ("Próximamente"): no se pueden completar, no se envían,
 *   no se leen ni se guardan, y el gestor de contraseñas no ofrece guardar
 *   nada. Además la CSP tiene form-action 'none'.
 * - La acción real es "Entrar sin cuenta" (modo local, todo en este navegador).
 * - El registro sólo toma el nombre de la EMPRESA (opcional) y lo pasa EN
 *   MEMORIA a la bienvenida (#/bienvenida). No escribe nada: la empresa se
 *   crea recién si la persona elige empezar con sus datos y lo confirma.
 *
 * Cuando exista un proveedor real (`app.ctx.auth.available === true`), los
 * campos se habilitarán y el envío llamará a `app.ctx.auth.signIn()` /
 * `signUp()`; las credenciales irán directo al servicio y nunca se guardarán
 * en el navegador.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { sanitizeText } from '../../../core/validation.js';
import { brand, headerLink, pubLink, publicIcon, setOnboardingDraft, setPendingCompanyName } from './public-chrome.js';

const MAX_COMPANY_LENGTH = 120;
const ACCOUNTS_SOON = 'Disponible cuando habilitemos las cuentas.';

/** Campo de formulario con label real (sin valores precargados). */
function field({ label, type = 'text', name, autocomplete, hint = null, maxLength = 200, inputmode = null, describedBy = null }) {
  const id = uniqueId('pub-f');
  const hintId = hint ? `${id}-hint` : null;
  const input = h('input', {
    id,
    name,
    type,
    autocomplete,
    maxlength: String(maxLength),
    inputmode,
    autocapitalize: type === 'email' || type === 'password' ? 'none' : null,
    spellcheck: type === 'email' || type === 'password' ? 'false' : null,
    'aria-describedby': [hintId, describedBy].filter(Boolean).join(' ') || null,
  });
  return {
    input,
    el: h('div', { class: 'pub-field' }, h('label', { class: 'pub-label', for: id }, label), input, hint ? h('p', { class: 'pub-field-hint', id: hintId }, hint) : null),
  };
}

/**
 * Grupo de campos de cuenta, visibles pero deshabilitados hasta que existan
 * las cuentas (fieldset disabled: no se completan ni se envían).
 */
function accountFields(title, specs) {
  const noteId = uniqueId('pub-soon');
  const fields = specs.map((spec) => field({ ...spec, describedBy: noteId }));
  return h(
    'fieldset',
    { class: 'pub-account-fields', disabled: true },
    h('legend', { class: 'pub-account-legend' }, h('span', {}, title), h('span', { class: 'pub-soon-tag' }, 'Próximamente')),
    ...fields.map((f) => f.el),
    h('p', { class: 'pub-field-hint pub-account-note', id: noteId }, publicIcon('lock', { size: 16 }), h('span', {}, ACCOUNTS_SOON)),
  );
}

/** Estructura común: Volver, marca arriba y tarjeta angosta. */
function authLayout({ title, subtitle, content, switchText, switchLabel, switchHref }) {
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
        content,
        h('p', { class: 'pub-auth-switch' }, `${switchText} `, h('a', { href: switchHref }, switchLabel)),
      ),
      h('p', { class: 'pub-auth-foot' }, publicIcon('lock', { size: 16 }), h('span', {}, 'Tus datos se guardan en este navegador. No se envían a ningún servidor.')),
    ),
  );
}

export function renderLogin(root, app) {
  app.setHeader({ title: 'Ingresar' });

  const content = h(
    'div',
    { class: 'pub-form' },
    accountFields('Tu cuenta', [
      { label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 },
      { label: 'Contraseña', type: 'password', name: 'password', autocomplete: 'current-password', maxLength: 200 },
    ]),
    pubLink('Entrar sin cuenta', '#/inicio', { tone: 'primary', iconAfter: 'arrowRight', className: 'pub-btn-block' }),
  );

  mount(
    root,
    authLayout({
      title: 'Bienvenido de nuevo.',
      subtitle: 'Por ahora RATEOS funciona en este navegador. Entrá sin cuenta y seguí con tus cotizaciones.',
      content,
      switchText: '¿Todavía no tenés cuenta?',
      switchLabel: 'Crear cuenta',
      switchHref: '#/registro',
    }),
  );
}

export function renderRegister(root, app) {
  app.setHeader({ title: 'Crear cuenta' });

  const company = field({
    label: 'Empresa (opcional)',
    name: 'organization',
    autocomplete: 'organization',
    maxLength: MAX_COMPANY_LENGTH,
    hint: 'La usamos en el paso siguiente. No se guarda hasta que elijas empezar con tus datos.',
  });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg pub-btn pub-btn-block' }, h('span', {}, 'Comenzar sin cuenta'), publicIcon('arrowRight', { size: 18 }));

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Empezar a usar RATEOS' },
    company.el,
    accountFields('Tu cuenta', [
      { label: 'Nombre', name: 'name', autocomplete: 'name', maxLength: 120 },
      { label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 },
      { label: 'Contraseña', type: 'password', name: 'new-password', autocomplete: 'new-password', maxLength: 200 },
    ]),
    submit,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Sólo se toma la empresa, y sólo en memoria: no se escribe nada acá.
    setPendingCompanyName(sanitizeText(company.input.value, MAX_COMPANY_LENGTH));
    // Un registro nuevo empieza la bienvenida desde el principio.
    setOnboardingDraft(null);
    app.navigate('#/bienvenida');
  });

  mount(
    root,
    authLayout({
      title: 'Creá tu cuenta',
      subtitle: 'Por ahora no hace falta una cuenta: RATEOS funciona en este navegador. Empezá con el nombre de tu empresa.',
      content: form,
      switchText: '¿Ya tenés cuenta?',
      switchLabel: 'Ingresar',
      switchHref: '#/login',
    }),
  );
}
