/**
 * "Ayudanos a mejorar RATEOS" (#/mejorar): reportar un problema o sugerir una
 * mejora, y seguir el estado de los comentarios de la empresa (PLAN-2026-029).
 *
 * Breve a propósito (NN/g, gov.uk): un solo campo obligatorio; lo demás es
 * opcional y está plegado. El comentario es SÓLO lo que la persona escribe,
 * una categoría y una pantalla de listas fijas y la versión de la app: nunca
 * costos, cotizaciones, ids, sesión ni capturas. Lo clasifica RATEOS ADMIN y
 * la respuesta aparece acá. No hay premios ni créditos.
 * Todo texto se muestra como texto (h() nunca interpreta HTML).
 */

import { h, mount } from '../dom.js';
import { badge, banner, button, card, choiceGroup, disclosure, emptyState, selectField, textField } from '../components.js';
import { formatDateTime } from '../../core/format.js';
import { FEEDBACK_CATEGORIES, FEEDBACK_KINDS, FEEDBACK_SCREENS, FEEDBACK_TEXT_MAX, feedbackKindFromParam } from '../../domain/feedback.js';
import { FEEDBACK_THANKS } from '../../services/feedback-service.js';

export const FEEDBACK_INTRO = 'Estamos construyendo RATEOS junto a empresas que cotizan todos los días. Si algo no funcionó o se podría entender mejor, contanos. Revisamos cada comentario y nos ayuda a priorizar mejoras.';

/** Parámetros de #/mejorar?tipo=…&desde=…&acerca=1 (sólo claves de listas fijas). */
export function feedbackParams(hash) {
  const query = String(hash || '').split('?')[1] || '';
  const params = new URLSearchParams(query);
  const from = params.get('desde');
  return {
    kind: feedbackKindFromParam(params.get('tipo')),
    screen: FEEDBACK_SCREENS.some((s) => s.id === from) ? from : 'otra',
    about: params.get('acerca') === '1',
  };
}

/** "Acerca de la beta": agradece y explica, sin prometer beneficios. */
export function aboutBeta({ open = false } = {}) {
  return disclosure({ summary: 'Acerca de la beta', id: 'acerca-beta', open, className: 'feedback-about' },
    h('p', {}, 'Durante la beta, RATEOS es gratuito y sin límites de cotizaciones ni productos.'),
    h('p', {}, 'Gracias por ser de las primeras empresas en usarlo: tus comentarios nos ayudan a decidir qué mejorar primero. No hace falta ser experto; si algo no se entiende, también nos sirve saberlo.'),
    h('p', { class: 'muted small' }, 'Enviar un comentario no da premios ni beneficios.'));
}

function feedbackItem(row) {
  const extra = [
    row.details ? [row.kind === 'suggestion' ? 'Para qué te serviría' : 'Qué estabas haciendo', row.details] : null,
    row.expected ? ['Qué esperabas', row.expected] : null,
  ].filter(Boolean);
  return h(
    'li',
    { class: 'report-item', dataset: { status: row.status, kind: row.kind } },
    h('div', { class: 'report-item-head' },
      badge(row.statusLabel, row.tone),
      h('span', { class: 'report-item-meta muted small' }, `${row.kindLabel} · ${row.screen}${row.createdAt ? ` · ${formatDateTime(row.createdAt)}` : ''}${row.mine ? '' : ' · de otra persona de tu empresa'}`)),
    h('p', { class: 'report-item-text' }, row.message),
    row.response ? h('p', { class: 'report-item-note' }, h('strong', {}, 'Respuesta de RATEOS: '), row.response) : null,
    extra.length
      ? disclosure({ summary: 'Ver lo que se envió', className: 'disclosure-plain' },
        h('dl', { class: 'report-item-detail' }, ...extra.flatMap(([dt, dd]) => [h('dt', {}, dt), h('dd', {}, dd)])))
      : null,
  );
}

/** #/mejorar */
export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Ayudanos a mejorar RATEOS', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const params = feedbackParams(window.location.hash);
  const service = ctx.feedback;
  const about = aboutBeta({ open: params.about });
  // El título ya es el de la página (h1): acá sólo el pedido, sin repetirlo.
  const intro = h('div', { class: 'page-intro' }, h('p', { class: 'page-intro-text' }, FEEDBACK_INTRO));

  if (!service || !service.supported) {
    mount(root, h('div', { class: 'view-narrow stack-lg feedback-view' },
      intro,
      emptyState({ title: 'Los comentarios se envían desde tu cuenta', text: 'Ingresá con tu cuenta de RATEOS para reportar un problema o sugerir una mejora.' }),
      about));
    if (params.about) about.scrollIntoView({ block: 'start' });
    return undefined;
  }

  const draft = { kind: params.kind, category: 'otro', message: '', details: '', expected: '', screen: params.screen };
  const statusEl = h('div', { class: 'report-status', 'aria-live': 'polite', tabindex: '-1' });
  const listHost = h('div', { class: 'report-list-host' }, h('p', { class: 'muted', role: 'status' }, 'Cargando los comentarios…'));
  const kindHost = h('div', {});
  const fieldsHost = h('div', { class: 'stack' });
  /** Campos de texto dibujados, por clave del borrador (para marcar el error junto a cada uno). */
  const fieldRefs = {};
  let sending = false;

  const isSuggestion = () => draft.kind === 'suggestion';
  const renderKind = () => mount(kindHost, choiceGroup({
    label: '¿Qué nos querés contar?',
    value: draft.kind,
    options: FEEDBACK_KINDS.map((k) => ({ value: k.id, label: k.label, hint: k.hint })),
    onChange: (v) => {
      draft.kind = v;
      renderFields();
    },
  }));
  const keep = (key, node) => {
    fieldRefs[key] = node;
    return node;
  };
  const renderFields = () => mount(fieldsHost,
    keep('message', textField({
      label: isSuggestion() ? '¿Qué te gustaría mejorar o agregar?' : '¿Qué pasó?',
      value: draft.message,
      multiline: true,
      maxLength: FEEDBACK_TEXT_MAX,
      required: true,
      hint: isSuggestion() ? 'Una idea, algo que te costó encontrar o que se podría explicar mejor.' : 'Lo que viste: un mensaje, un número que no cierra, un botón que no responde…',
      onChange: (v) => { draft.message = v; },
    })),
    disclosure({ summary: 'Agregar detalles', hint: 'Opcional', className: 'disclosure-plain feedback-details' },
      h('div', { class: 'stack' },
        keep('details', textField({
          label: isSuggestion() ? '¿Para qué te serviría? (opcional)' : '¿Qué estabas haciendo? (opcional)',
          value: draft.details,
          multiline: true,
          maxLength: FEEDBACK_TEXT_MAX,
          hint: isSuggestion() ? null : 'Los pasos, si te acordás. Por ejemplo: abrí una cotización, cambié los días a 20 y fui a Resultado.',
          onChange: (v) => { draft.details = v; },
        })),
        isSuggestion() ? null : keep('expected', textField({ label: '¿Qué esperabas que pasara? (opcional)', value: draft.expected, multiline: true, maxLength: FEEDBACK_TEXT_MAX, onChange: (v) => { draft.expected = v; } })),
        selectField({
          label: '¿En qué pantalla?',
          value: draft.screen,
          options: FEEDBACK_SCREENS.map((s) => ({ value: s.id, label: s.label })),
          onChange: (v) => { draft.screen = v || 'otra'; },
        }),
        selectField({
          label: '¿Sobre qué es? (opcional)',
          value: draft.category,
          options: FEEDBACK_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
          onChange: (v) => { draft.category = v || 'otro'; },
        }))));

  const sendBtn = button('Enviar', { variant: 'primary', icon: 'check', type: 'submit' });
  const form = h(
    'form',
    { class: 'stack report-form', novalidate: true },
    kindHost,
    fieldsHost,
    h('p', { class: 'muted small' }, `Sólo enviamos lo que escribas, la pantalla y la versión de RATEOS (${service.appVersion}). No incluyas datos de clientes, costos, precios ni contratos.`),
    h('div', { class: 'row' }, sendBtn),
  );

  /** El error va junto a su campo (con aria-invalid) y el foco, al primero (ESC-17, CEL-12). */
  function showFieldErrors(errors) {
    let first = null;
    for (const [key, message] of Object.entries(errors || {})) {
      const node = fieldRefs[key];
      if (!node || !node.isConnected) continue;
      const control = node.querySelector('textarea, input');
      const errorEl = node.querySelector('.field-error');
      if (!control || !errorEl) continue;
      errorEl.textContent = message;
      errorEl.hidden = false;
      control.setAttribute('aria-invalid', 'true');
      control.addEventListener('input', () => {
        control.removeAttribute('aria-invalid');
        errorEl.hidden = true;
      }, { once: true });
      if (!first) first = control;
    }
    if (!first) return false;
    const details = first.closest('details');
    if (details) details.open = true;
    first.focus();
    return true;
  }

  async function loadList() {
    const res = await service.list();
    if (!res.ok) {
      mount(listHost, banner(res.message, 'warning'));
      return;
    }
    if (!res.rows.length) {
      mount(listHost, h('p', { class: 'muted' }, 'Tu empresa todavía no envió comentarios.'));
      return;
    }
    mount(listHost, h('ul', { class: 'report-list' }, ...res.rows.map(feedbackItem)));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    sendBtn.disabled = true;
    mount(statusEl, null);
    try {
      const res = await service.submit(draft);
      if (!res.ok) {
        if (res.errors && showFieldErrors(res.errors)) return;
        mount(statusEl, banner(res.message, 'warning'));
        statusEl.focus();
        return;
      }
      Object.assign(draft, { message: '', details: '', expected: '', category: 'otro' });
      renderFields();
      mount(statusEl, banner(FEEDBACK_THANKS, 'success'));
      statusEl.focus();
      await loadList();
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  });

  // El menú de la cuenta, estando acá, cambia el tipo sin perder lo escrito.
  const onKind = (event) => {
    if (!root.isConnected || !form.isConnected) {
      window.removeEventListener('rateos:feedback-kind', onKind);
      return;
    }
    draft.kind = event.detail && event.detail.kind === 'suggestion' ? 'suggestion' : 'problem';
    renderKind();
    renderFields();
  };
  window.addEventListener('rateos:feedback-kind', onKind);

  renderKind();
  renderFields();
  mount(
    root,
    h(
      'div',
      { class: 'view-narrow stack-lg feedback-view' },
      intro,
      card({ title: 'Nuevo comentario', level: 2 }, form, statusEl),
      card({ title: 'Comentarios de tu empresa', subtitle: 'El estado y nuestra respuesta aparecen acá.', level: 2 }, listHost),
      about,
    ),
  );
  await loadList();
  // Después de la lista: si no, la lista empuja "Acerca de la beta" fuera de la pantalla (ESC-06).
  if (params.about && about.isConnected) about.scrollIntoView({ block: 'start' });
  return undefined;
}
