/**
 * Ingreso (#/login), registro (#/registro) y recuperación de contraseña
 * (#/recuperar-contrasena) con Supabase Auth, a través de app.auth
 * (js/services/auth-service.js).
 *
 * - Los formularios interceptan el envío (la CSP tiene form-action 'none'):
 *   las credenciales van directo al SDK por HTTPS. Nunca se guardan ni se
 *   loguean; el campo contraseña se vacía después de cada intento.
 * - ?next=/ruta conserva el destino pedido (p. ej. "Crear una cotización").
 * - Registro público (FEATURES.publicSignup = true, HD-03): nombre, empresa,
 *   email y contraseña; después, "Revisá tu correo" con la misma respuesta sea
 *   el email nuevo o ya registrado, y reenvío del correo de confirmación (también
 *   desde el ingreso, si la cuenta todavía no está confirmada).
 * - Beta por invitación (publicSignup = false): #/registro no tiene formulario;
 *   explica el primer ingreso con "¿Olvidaste tu contraseña?".
 * - Recuperación en dos pasos: pedir el correo (respuesta neutra, espera antes
 *   de reenviar, sólo de UX) y elegir la contraseña con el enlace PKCE (este
 *   navegador) o con el código del correo (cualquier navegador, si nadie abrió
 *   antes el enlace: son la misma credencial).
 * - Errores en lenguaje humano: nunca mensajes internos ni detalles técnicos.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { brand, headerLink, publicIcon } from './public-chrome.js';
import { MIN_PASSWORD_LENGTH, RECOVER_REQUEST_SUBTITLE } from '../../../services/auth-service.js';
import { accountEntry, nextFromHash, hashQuery } from '../../../services/auth-routing.js';

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

/**
 * Botón de reenvío con espera visible. La espera es sólo de UX (recargar la
 * saltea): los límites reales los pone Supabase.
 */
function resendButton(label, onClick) {
  const el = h('button', { type: 'button', class: 'btn btn-secondary pub-btn pub-btn-block pub-auth-resend' }, label);
  let timer = null;
  const wait = (seconds = 0) => {
    if (timer) clearInterval(timer);
    timer = null;
    let left = seconds;
    const tick = () => {
      el.disabled = left > 0;
      el.textContent = left > 0 ? `${label} (en ${left} s)` : label;
    };
    tick();
    if (left > 0) {
      timer = setInterval(() => {
        left -= 1;
        tick();
        if (left <= 0) {
          clearInterval(timer);
          timer = null;
        }
      }, 1000);
    }
  };
  el.addEventListener('click', () => {
    el.disabled = true;
    onClick(wait);
  });
  return { el, wait };
}

/** Reenvío del correo de confirmación: respuesta neutra (no revela si la cuenta existe). */
function confirmationResend(app, emailText, next, message) {
  return resendButton('Reenviar el correo de confirmación', async (wait) => {
    const res = await app.auth.resendConfirmation(emailText, next);
    message.show(res.message, res.ok ? 'success' : 'error');
    wait(res.ok ? res.cooldownSeconds || 0 : 0);
  });
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
  // Cuenta sin confirmar (la contraseña era correcta): ofrece reenviar la confirmación.
  const unconfirmed = h('div', { class: 'pub-auth-unconfirmed' });
  if (flash) message.show(flash.message, flash.tone === 'success' ? 'success' : 'warning');
  else if (expired) message.show('Tu sesión terminó. Volvé a ingresar.', 'warning');

  const form = h(
    'form',
    { class: 'pub-form', novalidate: true, 'aria-label': 'Ingresar a RATEOS' },
    message.el,
    unconfirmed,
    email.el,
    password.el,
    h('p', { class: 'pub-auth-forgot' }, h('a', { href: '#/recuperar-contrasena' }, '¿Olvidaste tu contraseña?')),
    submit.el,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.show('');
    mount(unconfirmed);
    submit.busy(true, 'Ingresando…');
    const res = await app.auth.signIn({ email: email.input.value, password: password.input.value });
    password.input.value = '';
    submit.busy(false);
    if (!res.ok) {
      applyErrors({ email, password }, res.errors);
      message.show(res.message, 'error');
      if (res.unconfirmed) mount(unconfirmed, confirmationResend(app, email.input.value.trim(), next, message).el);
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
      footer: h('div', {},
        accountEntry().signup
          ? switchLine('¿Todavía no tenés cuenta?', 'Crear cuenta', withNext('#/registro', next))
          : switchLine('¿Todavía no tenés cuenta?', 'RATEOS está en beta por invitación', '#/registro'),
        switchLine('¿Querés ver cómo funciona?', 'Probar la demo sin cuenta', '#/demo')),
    }),
  );
}

// ------------------------------------------------------------------ registro

export function renderRegister(root, app) {
  const next = nextFromHash(window.location.hash);
  if (!accountEntry().signup) {
    renderInviteOnly(root, app, next);
    return;
  }
  app.setHeader({ title: 'Crear cuenta' });

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

  /** Después del registro: la misma pantalla sea el email nuevo o ya registrado. */
  const done = (emailText, res) => {
    const sent = formMessage();
    sent.show(res.message, 'success');
    const again = confirmationResend(app, emailText, next, sent);
    again.wait(res.cooldownSeconds || 0);
    return h(
      'div',
      { class: 'pub-auth-done stack' },
      h('p', { class: 'pub-field-hint pub-auth-account' }, 'Email: ', h('strong', {}, emailText)),
      sent.el,
      h('p', { class: 'pub-field-hint' }, 'El enlace de confirmación sirve una sola vez y vence en una hora. Si lo abrís en otro dispositivo, tu email queda confirmado igual: después ingresá con tu email y contraseña.'),
      again.el,
    );
  };

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
      mount(card, h('h1', { class: 'pub-auth-title', tabindex: '-1' }, 'Revisá tu correo'), done(email.input.value.trim(), res), switchLine('¿Ya confirmaste?', 'Ingresar', withNext('#/login', next)));
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

/**
 * Beta cerrada (HD-03): sin formulario de registro. Las cuentas las da de alta
 * el dueño desde Supabase; la persona entra con su email y, la primera vez,
 * elige su contraseña con "¿Olvidaste tu contraseña?" (enlace PKCE o código del
 * correo). Sin alta previa Supabase no envía ningún correo: se dice antes.
 */
function renderInviteOnly(root, app, next) {
  app.setHeader({ title: 'Acceso por invitación' });
  const content = h(
    'div',
    { class: 'pub-auth-invite' },
    h('p', {}, '¿Te invitaron? Así es el primer ingreso:'),
    h(
      'ol',
      { class: 'pub-auth-steps' },
      h('li', {}, 'Quien te invita te da de alta en RATEOS con tu email. ', h('strong', {}, 'Hasta que no lo haga, no te llega ningún correo de RATEOS.')),
      h('li', {}, 'Cuando te avise, tocá ', h('strong', {}, '«Elegir mi contraseña»'), ' y escribí ese email.'),
      h('li', {}, 'Abrí el correo que te llega: usá el enlace en este mismo navegador o, si lo leés en otro dispositivo, no toques el enlace y escribí el código que trae.'),
    ),
    h('p', { class: 'pub-field-hint' }, 'Si querés probar RATEOS y todavía no tenés invitación, pedísela a quien te compartió este enlace. Mientras tanto, podés ver la demo sin cuenta.'),
  );
  mount(
    root,
    authLayout({
      title: 'RATEOS está en beta cerrada',
      subtitle: 'Por ahora, las cuentas se crean sólo por invitación.',
      content,
      footer: h('div', {},
        switchLine('¿Ya te dieron acceso?', 'Ingresar', withNext('#/login', next)),
        switchLine('¿Es tu primer ingreso?', 'Elegir mi contraseña', '#/recuperar-contrasena'),
        switchLine('¿Querés ver cómo funciona?', 'Probar la demo sin cuenta', '#/demo')),
    }),
  );
}

// --------------------------------------------------------- recuperar contraseña

export function renderRecover(root, app) {
  app.setHeader({ title: 'Recuperar contraseña' });
  const snapshot = app.auth.snapshot();
  const message = formMessage();

  if (snapshot.recoveryMode) {
    // Llegó desde el enlace o el código del correo: elegir la contraseña nueva.
    const password = field({ label: 'Contraseña nueva', type: 'password', name: 'new-password', autocomplete: 'new-password', maxLength: 200, hint: `Al menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    const submit = submitButton('Guardar contraseña');
    const who = snapshot.user && snapshot.user.email
      ? h('p', { class: 'pub-field-hint pub-auth-account' }, 'Cuenta: ', h('strong', {}, snapshot.user.email))
      : null;
    const form = h('form', { class: 'pub-form', novalidate: true, 'aria-label': 'Elegir una contraseña nueva' }, message.el, who, password.el, submit.el);
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

  let typedEmail = '';
  let cooldownTimer = null;

  /** Paso 2: el código del correo (sirve en cualquier navegador). */
  const codeForm = ({ sentMessage = null, cooldown = 0 } = {}) => {
    const codeMessage = formMessage();
    const email = field({ label: 'Email de tu cuenta', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
    email.input.value = typedEmail;
    const code = field({ label: 'Código del correo', name: 'code', autocomplete: 'one-time-code', inputmode: 'numeric', maxLength: 12, hint: 'Son los números que trae el correo. Sirve aunque lo hayas abierto en otro dispositivo.' });
    const submit = submitButton('Verificar código');
    const resend = h('button', { type: 'button', class: 'btn btn-secondary pub-btn pub-btn-block pub-auth-resend' }, 'Volver a enviar el correo');
    const tick = (left) => {
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? `Volver a enviar el correo (en ${left} s)` : 'Volver a enviar el correo';
    };
    if (cooldownTimer) clearInterval(cooldownTimer);
    let left = cooldown;
    tick(left);
    if (left > 0) {
      cooldownTimer = setInterval(() => {
        left -= 1;
        tick(left);
        if (left <= 0) {
          clearInterval(cooldownTimer);
          cooldownTimer = null;
        }
      }, 1000);
    }
    resend.addEventListener('click', () => {
      typedEmail = email.input.value.trim();
      showRequest();
    });
    const form = h('form', { class: 'pub-form', novalidate: true, 'aria-label': 'Ingresar el código del correo' }, codeMessage.el, email.el, code.el, submit.el);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      codeMessage.show('');
      submit.busy(true, 'Verificando…');
      const res = await app.auth.verifyRecoveryCode(email.input.value, code.input.value);
      code.input.value = '';
      submit.busy(false);
      if (!res.ok) {
        applyErrors({ email, code }, res.errors);
        codeMessage.show(res.message, 'error');
        return;
      }
      if (cooldownTimer) clearInterval(cooldownTimer);
      renderRecover(root, app);
    });
    if (sentMessage) codeMessage.show(sentMessage, 'success');
    mount(root, authLayout({
      title: sentMessage ? 'Revisá tu correo' : 'Ingresá el código del correo',
      subtitle: sentMessage ? 'Abrí el enlace en este mismo navegador o, si leés el correo en otro dispositivo, escribí acá su código sin tocar el enlace.' : 'Escribí tu email y el código que te llegó.',
      content: h('div', { class: 'stack' }, form, resend),
      footer: switchLine('¿La recordaste?', 'Ingresar', '#/login'),
    }));
    (sentMessage ? code.input : (email.input.value ? code.input : email.input)).focus();
  };

  /** Paso 1: pedir el correo. */
  const showRequest = () => {
    const email = field({ label: 'Email de tu cuenta', type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', maxLength: 254 });
    email.input.value = typedEmail;
    const submit = submitButton('Enviarme el correo');
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
      typedEmail = email.input.value.trim();
      codeForm({ sentMessage: res.message, cooldown: res.cooldownSeconds || 0 });
    });
    const haveCode = h('button', { type: 'button', class: 'pub-link-button' }, 'Ya tengo un código');
    haveCode.addEventListener('click', () => {
      typedEmail = email.input.value.trim();
      codeForm();
    });
    mount(root, authLayout({
      title: 'Elegí o recuperá tu contraseña',
      subtitle: RECOVER_REQUEST_SUBTITLE,
      content: form,
      footer: h('div', {},
        h('p', { class: 'pub-auth-switch' }, '¿Ya te llegó el correo? ', haveCode),
        switchLine('¿La recordaste?', 'Ingresar', '#/login'),
        accountEntry().signup ? switchLine('¿Todavía no tenés cuenta?', 'Crear cuenta', '#/registro') : null),
    }));
  };

  showRequest();
}
