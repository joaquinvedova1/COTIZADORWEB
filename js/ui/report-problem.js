/**
 * Diálogo "Reportar un problema" (PLAN-2026-020).
 *
 * Dos preguntas en lenguaje simple (qué pasó / qué esperabas) y una línea que
 * dice qué se adjunta solo (pantalla, versión, navegador). Con sesión se
 * envía desde acá; sin sesión (sitio público o demo) se abre el reporte ya
 * completo en GitHub. Lo escrito sobrevive a cerrar el diálogo por error
 * (sólo en la memoria de la pestaña, y se borra al cerrar la cuenta).
 */

import { h, mount } from './dom.js';
import { button, disclosure, icon, openDialog, textField, toast } from './components.js';
import { onSessionReset } from './session-memory.js';
import {
  MAX_EXPECTED_LENGTH,
  MAX_WHAT_LENGTH,
  buildReportPayload,
  githubIssueUrl,
  reportText,
  technicalContext,
  validateReport,
} from '../services/feedback-service.js';

let draft = { whatHappened: '', expected: '' };
onSessionReset(() => {
  draft = { whatHappened: '', expected: '' };
});

/**
 * @param {{
 *   location: { label: string, route: string },
 *   version?: object,
 *   mode: 'cuenta'|'demo'|'publico',
 *   loginTip?: boolean,  sugerir ingresar para enviar sin GitHub
 *   submit?: ((payload: object) => Promise<{ ok: boolean, message: string|null, reference: string|null }>)|null,
 *   openUrl?: (url: string) => void,
 * }} options  submit null = sin sesión (se ofrece GitHub)
 */
export function openReportProblem({ location, version = {}, mode = 'cuenta', loginTip = false, submit = null, openUrl = (url) => window.open(url, '_blank', 'noopener') }) {
  const canSend = typeof submit === 'function';
  const tech = technicalContext();
  const payload = () => buildReportPayload(draft, { location, version, mode, tech });

  const errorEl = h('p', { class: 'report-error', role: 'alert', hidden: true });
  const showError = (message) => {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  };
  const previewEl = h('pre', { class: 'report-preview' });
  const refreshPreview = () => {
    previewEl.textContent = reportText(payload());
  };

  const whatField = textField({
    label: '¿Qué pasó?',
    value: draft.whatHappened,
    multiline: true,
    required: true,
    maxLength: MAX_WHAT_LENGTH,
    placeholder: 'Ej.: en Equipos toco «Siguiente» y no pasa nada.',
    onChange: (v) => {
      draft.whatHappened = v;
      if (!errorEl.hidden) showError(null);
      clearInvalid();
      refreshPreview();
    },
  });
  const expectedField = textField({
    label: '¿Qué esperabas que pasara? (opcional)',
    value: draft.expected,
    multiline: true,
    maxLength: MAX_EXPECTED_LENGTH,
    placeholder: 'Ej.: que me lleve al paso Materiales.',
    onChange: (v) => {
      draft.expected = v;
      refreshPreview();
    },
  });
  refreshPreview();

  const auto = h('p', { class: 'report-auto' },
    icon('info', { size: 16 }),
    h('span', {}, 'Se agrega solo: dónde estabas (', h('strong', {}, location.label), `), la versión${version.version ? ` ${version.version}` : ''} y tu navegador.`));
  const privacy = h('p', { class: 'report-privacy' },
    icon('lock', { size: 16 }),
    h('span', {}, canSend
      ? 'Ojo: el reporte queda publicado en GitHub, en una lista pública de errores de RATEOS. No lleva tu nombre, email ni empresa. No escribas nombres de clientes, precios ni otros datos confidenciales.'
      : `Te llevamos a GitHub (un sitio público que pide una cuenta gratuita) con el reporte ya escrito. No escribas nombres de clientes ni precios.${!loginTip ? '' : ' Si tenés cuenta de RATEOS, ingresá y mandalo desde ahí, sin GitHub.'}`));

  const form = h('form', { class: 'report-form', novalidate: true },
    h('p', { class: 'report-intro' }, 'Contanos qué no funcionó o qué te confundió. Lo revisamos para corregir RATEOS.'),
    privacy,
    whatField,
    expectedField,
    auto,
    disclosure({ summary: 'Ver lo que se envía', className: 'report-preview-box' }, previewEl),
    errorEl);

  const body = h('div', { class: 'report-problem' }, form);
  let sending = false;
  const cancelBtn = button('Cancelar', { variant: 'secondary', onClick: () => close() });
  const sendBtn = button(canSend ? 'Enviar reporte' : 'Continuar en GitHub', {
    variant: 'primary',
    icon: canSend ? 'flag' : 'arrowRight',
    onClick: () => send(),
    attrs: canSend ? {} : { 'aria-label': 'Continuar en GitHub (se abre en otra pestaña)' },
  });
  let closed = false;
  const { dialog, close } = openDialog({ title: 'Reportar un problema', content: body, actions: [cancelBtn, sendBtn], onClose: () => { closed = true; } });
  dialog.classList.add('dialog-report');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  const firstInput = whatField.querySelector('textarea');
  const fieldError = whatField.querySelector('.field-error');
  if (firstInput) {
    firstInput.setAttribute('aria-required', 'true');
    firstInput.focus();
  }

  // Error de validación: debajo del campo y ligado a él (se ve aunque la pantalla sea chica).
  function invalid(message) {
    if (fieldError) {
      fieldError.textContent = message;
      fieldError.hidden = false;
    } else showError(message);
    if (firstInput) {
      firstInput.setAttribute('aria-invalid', 'true');
      if (fieldError && fieldError.id) firstInput.setAttribute('aria-describedby', fieldError.id);
      firstInput.focus();
    }
    try {
      (fieldError || errorEl).scrollIntoView({ block: 'nearest' });
    } catch {
      /* sin scroll */
    }
  }
  function clearInvalid() {
    if (fieldError && !fieldError.hidden) {
      fieldError.hidden = true;
      fieldError.textContent = '';
    }
    if (firstInput) {
      firstInput.removeAttribute('aria-invalid');
      firstInput.removeAttribute('aria-describedby');
    }
  }

  async function send() {
    if (sending) return;
    const check = validateReport(draft);
    if (!check.ok) {
      invalid(check.message);
      return;
    }
    clearInvalid();
    if (!canSend) {
      openUrl(githubIssueUrl(payload()));
      close();
      return;
    }
    sending = true;
    // aria-disabled (no disabled): el foco se queda en el botón mientras se envía.
    sendBtn.setAttribute('aria-disabled', 'true');
    sendBtn.setAttribute('aria-busy', 'true');
    const label = sendBtn.querySelector('span:last-child');
    const previous = label ? label.textContent : '';
    if (label) label.textContent = 'Enviando…';
    showError(null);
    let res;
    try {
      res = await submit(payload());
    } catch {
      res = { ok: false, message: 'No pudimos enviar el reporte. Probá de nuevo en unos minutos.' };
    }
    sending = false;
    sendBtn.removeAttribute('aria-disabled');
    sendBtn.removeAttribute('aria-busy');
    if (label) label.textContent = previous;
    const ok = Boolean(res && res.ok);
    if (ok) draft = { whatHappened: '', expected: '' };
    // Si cerraron el diálogo mientras se enviaba, el resultado llega como aviso.
    if (closed) {
      toast(ok ? `¡Gracias! Recibimos tu reporte${res.reference ? ` (${res.reference})` : ''}.` : 'No pudimos enviar el reporte. Lo que escribiste sigue guardado: abrí «Reportar un problema» y probá de nuevo.', ok ? 'success' : 'warning', { timeout: 6000 });
      return;
    }
    if (!ok) {
      showError((res && res.message) || 'No pudimos enviar el reporte.');
      // Plan B: si la base no lo recibió (salvo por el límite), se puede mandar por GitHub.
      if (!res || !res.rateLimited) showFallback();
      try {
        (form.querySelector('.report-fallback') || errorEl).scrollIntoView({ block: 'nearest' });
      } catch {
        /* sin scroll */
      }
      return;
    }
    showThanks(res.reference);
  }

  function showFallback() {
    if (form.querySelector('.report-fallback')) return;
    form.appendChild(h('p', { class: 'report-fallback' },
      'También podés enviarlo por GitHub (necesitás una cuenta gratuita) o copiar lo que escribiste: ',
      button('Enviar por GitHub', { variant: 'link', size: 'sm', onClick: () => { openUrl(githubIssueUrl(payload())); close(); }, attrs: { 'aria-label': 'Enviar por GitHub (se abre en otra pestaña)' } }),
      ' · ',
      button('Copiar texto', { variant: 'link', size: 'sm', onClick: () => copyText() })));
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(reportText(payload()));
      toast('Copiado. Pegalo donde quieras enviarlo.', 'success');
    } catch {
      toast('No se pudo copiar. Abrí «Ver lo que se envía» y copialo a mano.', 'warning');
    }
  }

  function showThanks(reference) {
    const done = button('Listo', { variant: 'primary', onClick: () => close() });
    mount(body, h('div', { class: 'report-thanks', role: 'status' },
      h('span', { class: 'report-thanks-icon', 'aria-hidden': 'true' }, icon('check', { size: 28 })),
      h('p', { class: 'report-thanks-title', tabindex: '-1' }, '¡Gracias! Recibimos tu reporte.'),
      reference
        ? h('p', {}, 'Referencia ', h('strong', { class: 'mono' }, reference), '. Guardala por si nos consultás por este problema.')
        : h('p', {}, 'Lo vamos a revisar pronto.')));
    const actions = dialog.querySelector('.dialog-actions');
    if (actions) mount(actions, done);
    const title = body.querySelector('.report-thanks-title');
    if (title) title.focus();
    else done.focus();
  }

  return { dialog, close };
}
