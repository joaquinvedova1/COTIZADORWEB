/**
 * "Reportar un error" (#/reportar) y "Mis reportes" (PLAN-2026-029).
 *
 * El reporte es SÓLO lo que la persona escribe, una categoría y una pantalla
 * de listas fijas, y la versión de la app: nunca costos, cotizaciones, ids,
 * sesión ni capturas. Lo recibe RATEOS ADMIN; si confirma el error, aprueba
 * a mano +2 cálculos de prueba para la empresa (nada de eso pasa acá).
 * Todo texto se muestra como texto (h() nunca interpreta HTML).
 */

import { h, mount } from '../dom.js';
import { badge, banner, button, card, disclosure, emptyState, pageIntro, selectField, textField } from '../components.js';
import { formatDateTime } from '../../core/format.js';
import { BUG_CATEGORIES, BUG_SCREENS, BUG_TEXT_MAX, bugScreenFromHash } from '../../domain/bug-report.js';

/** Pantalla de origen: ?desde=<clave de la lista> (la pone el enlace del menú). */
export function reportOrigin(hash) {
  const query = String(hash || '').split('?')[1] || '';
  const from = new URLSearchParams(query).get('desde');
  return BUG_SCREENS.some((s) => s.id === from) ? from : 'otra';
}

/** Enlace a esta pantalla desde donde está la persona (sin ids ni datos). */
export function reportHrefFrom(hash) {
  return `#/reportar?desde=${bugScreenFromHash(hash)}`;
}

function reportItem(row) {
  return h(
    'li',
    { class: 'report-item', dataset: { status: row.status } },
    h('div', { class: 'report-item-head' },
      badge(row.statusLabel, row.tone),
      h('span', { class: 'report-item-meta muted small' }, `${row.category} · ${row.screen}${row.createdAt ? ` · ${formatDateTime(row.createdAt)}` : ''}${row.mine ? '' : ' · de otra persona de tu empresa'}`)),
    h('p', { class: 'report-item-text' }, row.happened),
    row.reviewNote ? h('p', { class: 'report-item-note' }, h('strong', {}, 'Respuesta de RATEOS: '), row.reviewNote) : null,
    disclosure({ summary: 'Ver lo que se envió', className: 'disclosure-plain' },
      h('dl', { class: 'report-item-detail' },
        h('dt', {}, 'Qué hizo'), h('dd', {}, row.did),
        h('dt', {}, 'Qué esperaba'), h('dd', {}, row.expected),
        h('dt', {}, 'Qué pasó'), h('dd', {}, row.happened))),
  );
}

/** #/reportar */
export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Reportar un error', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });
  const service = ctx.bugReports;
  if (!service || !service.supported) {
    mount(root, emptyState({ title: 'Los reportes se envían desde tu cuenta', text: 'Ingresá con tu cuenta de RATEOS para contarnos qué falló.' }));
    return undefined;
  }
  const credits = ctx.credits ? await ctx.credits.status({ refresh: true }) : { enabled: false };
  const reward = credits.enabled && credits.reportReward > 0 ? credits.reportReward : 0;

  const draft = { category: null, screen: reportOrigin(window.location.hash), did: '', expected: '', happened: '' };
  const statusEl = h('div', { class: 'report-status', 'aria-live': 'polite' });
  const listHost = h('div', { class: 'report-list-host' }, h('p', { class: 'muted', role: 'status' }, 'Cargando tus reportes…'));
  let sending = false;

  const fields = () => [
    selectField({
      label: '¿De qué se trata?',
      value: draft.category,
      includeEmpty: true,
      emptyLabel: 'Elegí una opción…',
      options: BUG_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
      onChange: (v) => {
        draft.category = v;
      },
    }),
    selectField({
      label: '¿En qué pantalla?',
      value: draft.screen,
      options: BUG_SCREENS.map((s) => ({ value: s.id, label: s.label })),
      onChange: (v) => {
        draft.screen = v || 'otra';
      },
    }),
    textField({ label: '¿Qué hiciste?', value: draft.did, multiline: true, maxLength: BUG_TEXT_MAX, required: true, hint: 'Los pasos, en orden. Por ejemplo: abrí una cotización, cambié los días a 20 y fui a Resultado.', onChange: (v) => { draft.did = v; } }),
    textField({ label: '¿Qué esperabas que pasara?', value: draft.expected, multiline: true, maxLength: BUG_TEXT_MAX, required: true, onChange: (v) => { draft.expected = v; } }),
    textField({ label: '¿Qué pasó?', value: draft.happened, multiline: true, maxLength: BUG_TEXT_MAX, required: true, hint: 'Lo que viste: un mensaje, un número que no cierra, un botón que no responde…', onChange: (v) => { draft.happened = v; } }),
  ];
  const formFields = h('div', { class: 'stack' }, ...fields());
  const sendBtn = button('Enviar reporte', { variant: 'primary', icon: 'check', type: 'submit' });
  const form = h(
    'form',
    { class: 'stack report-form', novalidate: true },
    formFields,
    h('p', { class: 'muted small' }, `Se envía con la versión de RATEOS que estás usando (${service.appVersion}).`),
    h('div', { class: 'row' }, sendBtn),
  );

  async function loadList() {
    const res = await service.list();
    if (!res.ok) {
      mount(listHost, banner(res.message, 'warning'));
      return;
    }
    if (!res.rows.length) {
      mount(listHost, h('p', { class: 'muted' }, 'Tu empresa todavía no envió reportes.'));
      return;
    }
    mount(listHost, h('ul', { class: 'report-list' }, ...res.rows.map(reportItem)));
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
        const details = res.errors ? Object.values(res.errors) : [];
        mount(statusEl, banner(details.length ? h('span', {}, res.message, h('ul', {}, ...details.map((d) => h('li', {}, d)))) : res.message, 'warning'));
        return;
      }
      Object.assign(draft, { category: null, did: '', expected: '', happened: '' });
      mount(formFields, ...fields());
      mount(statusEl, banner(reward
        ? `Recibimos tu reporte. Lo revisamos a mano: si confirmamos que es un error de RATEOS, le sumamos ${reward} cálculos de prueba a tu empresa. El estado aparece abajo.`
        : 'Recibimos tu reporte. Lo revisamos a mano y el estado aparece abajo.', 'success'));
      await loadList();
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  });

  mount(
    root,
    h(
      'div',
      { class: 'view-narrow stack-lg report-bug' },
      pageIntro({
        title: '¿Algo no funcionó como esperabas?',
        text: reward
          ? `Contanos qué pasó. Si confirmamos que es un error de RATEOS, le sumamos ${reward} cálculos de prueba a tu empresa.`
          : 'Contanos qué pasó: lo revisamos a mano.',
      }),
      banner('Sólo enviamos lo que escribas acá, la pantalla y la versión de RATEOS: no mandamos capturas ni datos de tus cotizaciones. No hace falta que pongas montos, precios, nombres de clientes ni datos personales.', 'info', { title: 'Tus datos no salen.' }),
      card({ title: 'Nuevo reporte', level: 2 }, form, statusEl),
      card({ title: 'Reportes de tu empresa', subtitle: credits.enabled ? `Cálculos de prueba disponibles: ${credits.balance}${credits.rewarded ? ` (${credits.rewarded} sumados por reportes aprobados)` : ''}.` : null, level: 2 }, listHost),
    ),
  );
  await loadList();
  return undefined;
}
