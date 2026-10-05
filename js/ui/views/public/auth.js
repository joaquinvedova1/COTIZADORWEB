/**
 * Ingreso (#/login), registro (#/registro) y recuperación de contraseña
 * (#/recuperar-contrasena) con Supabase Auth, a través de app.auth
 * (js/services/auth-service.js).
 *
 * - Los formularios interceptan el envío (la CSP tiene form-action 'none'):
 *   las credenciales van directo al SDK por HTTPS. Nunca se guardan ni se
 *   loguean; el campo contraseña se vacía después de cada intento.
 * - ?next=/ruta conserva el destino pedido (p. ej. "Crear una cotización").
 * - Errores en lenguaje humano: nunca mensajes internos ni detalles técnicos.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { brand, headerLink, publicIcon } from './public-chrome.js';
import { MIN_PASSWORD_LENGTH } from '../../../services/auth-service.js';
import { nextFromHash, hashQuery } from '../../../services/auth-routing.js';

/** Campo con label real, ayuda y error accesibles. */
function field({ label, type = 'text', name, autocomplete, hint = null, maxLength = 200, inputmode = null }) {
  const id = uniqueId('pub-f');
  const hintId = hint ? `${id}-hint` : null;
  const errorId = `${id}-error`;
  const input = h('input', {
    id,
    name,
    type,
    autocomplete,
    maxlength: String(maxLength),
    inputmode,
    required: true,
    autocapitalize: type === 'email' || type === 'password' ? 'none' : null,
    spellcheck: type === 'email' || type === 'password' ? 'false' : null,
    'aria-describedby': hintId || null,
  });
  const errorEl = h('p', { class: 'pub-field-error', id: errorId, hidden: true });
  const setError = (message) => {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [hintId, errorId].filter(Boolean).join(' '));
    } else {
      input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', hintId || '');
    }
  };
  return {
    input,
    setError,
    el: h('div', { class: 'pub-field' }, h('label', { class: 'pub-label', for: id }, label), input, hint ? h('p', { class: 'pub-field-hint', id: hintId }, hint) : null, errorEl),
  };
}

function submitButton(label) {
  const text = h('span', {}, label);
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg pub-btn pub-btn-block' }, text, publicIcon('arrowRight', { size: 18 }));
  return {
    el: btn,
    busy(on, busyLabel) {
      btn.disabled = on;
      btn.setAttribute('aria-busy', on ? 'true' : 'false');
      text.textContent = on ? busyLabel : label;
    },
  };
}

/** Mensaje del formulario (role="alert" para errores, "status" para avisos). */
function formMessage() {
  const el = h('div', { class: 'pub-form-message', hidden: true });
  return {
    el,
    show(text, tone = 'error') {
      el.textContent = text || '';
      el.hidden = !text;
      el.className = `pub-form-message is-${tone}`;
      el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    },
  };
}

function applyErrors(fields, errors = {}) {
  let first = null;
  Object.entries(fields).forEach(([key, f]) => {
    const msg = errors[key] || null;
    f.setError(msg);
    if (msg && !first) first = f.input;
  });
  if (first) first.focus();
}

/** Estructura común: Volver, marca arriba y tarjeta angosta. */
function authLayout({ title, subtitle, content, footer = null }) {
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
        subtitle ? h('p', { class: 'pub-auth-sub' }, subtitle) : null,
        content,
        footer,
      ),
      h('p', { class: 'pub-auth-foot' }, publicIcon('lock', { size: 16 }), h('span', {}, 'Tus datos quedan en tu cuenta, protegidos: sólo las personas de tu empresa pueden verlos.')),
    ),
  );
}

function switchLine(text, label, href) {
  return h('p', { class: 'pub-auth-switch' }, `${text} `, h('a', { href }, label));
}

function withNext(base, next) {
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

// ------------------------------------------------------------------ ingreso

export function renderLogin(root, app) {
  app.setHeader({ title: 'Ingresar' });
  const next = nextFromHash(window.location.hash);
  const expired = hashQuery(window.location.hash).get('sesion') === 'vencida';
  const flash = typeof app.takeFlash === 'function' ? app.takeFlash() : null;

  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
  const password = field({ label: 'Contraseña', type: 'password', name: 'password', autocomplete: 'current-password', maxLength: 200 });
  const message = formMessage();
  const submit = submitButton('Ingresar');
  if (flash) message.show(flash.message, flash.tone === 'success' ? 'success' : 'warning');
  else if (expired) message.show('Tu sesión terminó. Volvé a ingresar.', 'warning');

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Ingresar a RATEOS' },
    message.el,
    email.el,
    password.el,
    h('p', { class: 'pub-auth-forgot' }, h('a', { href: '#/recuperar-contrasena' }, '¿Olvidaste tu contraseña?')),
    submit.el,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.show('');
    submit.busy(true, 'Ingresando…');
    const res = await app.auth.signIn({ email: email.input.value, password: password.input.value });
    password.input.value = '';
    submit.busy(false);
    if (!res.ok) {
      applyErrors({ email, password }, res.errors);
      message.show(res.message, 'error');
      if (!res.errors || !Object.keys(res.errors).length) password.input.focus();
      return;
    }
    // La cuenta se abre sola (app.js escucha la sesión); se va al destino.
    app.navigate(`#${next || '/inicio'}`, { replace: true });
  });

  mount(
    root,
    authLayout({
      title: 'Bienvenido de nuevo.',
      subtitle: 'Ingresá con tu email y contraseña.',
      content: form,
      footer: h('div', {}, switchLine('¿Todavía no tenés cuenta?', 'Crear cuenta', withNext('#/registro', next)), switchLine('¿Querés ver cómo funciona?', 'Probar la demo sin cuenta', '#/demo')),
    }),
  );
}

// ------------------------------------------------------------------ registro

export function renderRegister(root, app) {
  app.setHeader({ title: 'Crear cuenta' });
  const next = nextFromHash(window.location.hash);

  const fullName = field({ label: 'Tu nombre', name: 'name', autocomplete: 'name', maxLength: 120 });
  const company = field({ label: 'Empresa', name: 'organization', autocomplete: 'organization', maxLength: 120, hint: 'Así se va a llamar tu espacio de trabajo. Podés cambiarlo después.' });
  const email = field({ label: 'Email', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
  const password = field({ label: 'Contraseña', type: 'password', name: 'new-password', autocomplete: 'new-password', maxLength: 200, hint: `Al menos ${MIN_PASSWORD_LENGTH} caracteres.` });
  const message = formMessage();
  const submit = submitButton('Crear cuenta');

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Crear una cuenta de RATEOS' },
    message.el,
    fullName.el,
    company.el,
    email.el,
    password.el,
    submit.el,
  );

  const done = (emailText) => h(
    'div',
    { class: 'pub-auth-done', role: 'status' },
    h('h2', { class: 'pub-h3' }, 'Revisá tu email'),
    h('p', {}, 'Te enviamos un enlace a ', h('strong', {}, emailText), ' para confirmar tu cuenta. Abrilo desde este mismo navegador para entrar directo a RATEOS.'),
    h('p', { class: 'pub-field-hint' }, '¿No llegó? Revisá la carpeta de spam. El enlace vence en unas horas.'),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.show('');
    submit.busy(true, 'Creando tu cuenta…');
    const res = await app.auth.signUp({
      fullName: fullName.input.value,
      company: company.input.value,
      email: email.input.value,
      password: password.input.value,
      next,
    });
    password.input.value = '';
    submit.busy(false);
    if (!res.ok) {
      applyErrors({ fullName, company, email, password }, res.errors);
      message.show(res.message, 'error');
      return;
    }
    if (res.needsConfirmation) {
      mount(card, h('h1', { class: 'pub-auth-title', tabindex: '-1' }, 'Ya casi está.'), done(email.input.value.trim()), switchLine('¿Ya confirmaste?', 'Ingresar', withNext('#/login', next)));
      const title = card.querySelector('h1');
      if (title) title.focus();
      return;
    }
    app.navigate(`#${next || '/inicio'}`, { replace: true });
  });

  const view = authLayout({
    title: 'Creá tu cuenta',
    subtitle: 'Empezá con tu empresa vacía: cargás tus costos y RATEOS te dice cuánto cobrar.',
    content: form,
    footer: h('div', {}, switchLine('¿Ya tenés cuenta?', 'Ingresar', withNext('#/login', next)), switchLine('¿Primero querés verlo?', 'Probar la demo sin cuenta', '#/demo')),
  });
  const card = view.querySelector('.pub-auth-card');
  mount(root, view);
}

// --------------------------------------------------------- recuperar contraseña

export function renderRecover(root, app) {
  app.setHeader({ title: 'Recuperar contraseña' });
  const snapshot = app.auth.snapshot();
  const message = formMessage();

  if (snapshot.recoveryMode) {
    // Llegó desde el enlace del email: elegir la contraseña nueva.
    const password = field({ label: 'Contraseña nueva', type: 'password', name: 'new-password', autocomplete: 'new-password', maxLength: 200, hint: `Al menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    const submit = submitButton('Guardar contraseña');
    const form = h('form', { class: 'pub-form', novalidate: true, 'aria-label': 'Elegir una contraseña nueva' }, message.el, password.el, submit.el);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.show('');
      submit.busy(true, 'Guardando…');
      const res = await app.auth.updatePassword(password.input.value);
      password.input.value = '';
      submit.busy(false);
      if (!res.ok) {
        applyErrors({ password }, res.errors);
        message.show(res.message, 'error');
        return;
      }
      app.toast(res.message, 'success');
      app.navigate('#/inicio', { replace: true });
    });
    mount(root, authLayout({ title: 'Elegí una contraseña nueva', subtitle: 'Vas a usarla para ingresar desde ahora.', content: form }));
    return;
  }

  const email = field({ label: 'Email de tu cuenta', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
  const submit = submitButton('Enviarme el enlace');
  const form = h('form', { class: 'pub-form', novalidate: true, 'aria-label': 'Recuperar la contraseña' }, message.el, email.el, submit.el);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.show('');
    submit.busy(true, 'Enviando…');
    const res = await app.auth.requestPasswordReset(email.input.value);
    submit.busy(false);
    if (!res.ok) {
      applyErrors({ email }, res.errors);
      message.show(res.message, 'error');
      return;
    }
    message.show(res.message, 'success');
  });
  mount(root, authLayout({
    title: 'Recuperá tu contraseña',
    subtitle: 'Te mandamos un enlace para elegir una nueva.',
    content: form,
    footer: switchLine('¿La recordaste?', 'Ingresar', '#/login'),
  }));
}
