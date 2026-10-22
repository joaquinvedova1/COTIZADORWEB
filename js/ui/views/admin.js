/**
 * RATEOS Admin (#/admin) — administración de la PLATAFORMA, sólo metadata.
 *
 * - Sin RATEOS_ADMIN: "No tenés permisos para acceder a esta sección." y
 *   ninguna consulta de admin (no hay nada que mostrar).
 * - Con RATEOS_ADMIN: indicadores y tabla de usuarios/empresas. La base vuelve
 *   a verificar el rol en cada consulta: si dice que no, se ve el mismo aviso.
 * - Nunca muestra cotizaciones, costos, márgenes, recursos, tarifas ni el
 *   workspace de nadie (la base no los devuelve).
 */

import { h, mount } from '../dom.js';
import { badge, banner, button, card, kpi, pageIntro, selectField, table, textField } from '../components.js';
import { formatDate, formatDateTime } from '../../core/format.js';
import { logger } from '../../core/logger.js';
import { ADMIN_NO_ACCESS, PLATFORM_ADMIN_LABEL } from '../../services/admin-service.js';
import { feedbackStatus } from '../../domain/feedback.js';

/** Filtros de la cola de feedback (PLAN-2026-029). */
export const FEEDBACK_FILTERS = Object.freeze([
  { id: 'open', label: 'Sin resolver' },
  { id: 'received', label: 'Recibidos' },
  { id: 'confirmed', label: 'Confirmados' },
  { id: 'resolved', label: 'Resueltos' },
  { id: null, label: 'Todos' },
]);
export const FEEDBACK_KIND_FILTERS = Object.freeze([
  { id: null, label: 'Problemas y sugerencias' },
  { id: 'problem', label: 'Problemas' },
  { id: 'suggestion', label: 'Sugerencias' },
]);

/** ¿Se puede intentar abrir el panel? (sólo UX: la autoridad es Postgres). */
export function canOpenAdmin(ctx) {
  return Boolean(ctx && ctx.account && ctx.account.platformAdmin === true && ctx.admin && typeof ctx.admin.load === 'function');
}

function noAccess(root) {
  mount(root, h('div', { class: 'admin-denied' }, banner(ADMIN_NO_ACCESS, 'warning')));
}

const dateOr = (value, fn = formatDate) => (value ? fn(value) : '—');

export async function render(root, app) {
  app.setHeader({ title: 'RATEOS Admin' });
  const ctx = app.ctx;
  if (!canOpenAdmin(ctx)) {
    noAccess(root);
    return undefined;
  }
  mount(root, h('div', { class: 'auth-loading', role: 'status' }, 'Cargando la administración…'));
  let res;
  try {
    res = await ctx.admin.load();
  } catch (error) {
    logger.warn('No se pudo cargar RATEOS Admin', { name: error && error.name });
    res = { ok: false, code: 'unknown', message: 'No pudimos cargar la administración. Reintentá en unos minutos.' };
  }
  if (!res.ok) {
    if (res.code === 'forbidden') noAccess(root);
    else mount(root, h('div', {}, banner(res.message, 'danger'), h('div', { class: 'row' }, button('Reintentar', { variant: 'primary', onClick: () => render(root, app) }))));
    return undefined;
  }

  const columns = [
    { key: 'name', label: 'Usuario', render: (r) => h('span', {}, r.name, r.platformAdmin ? h('span', { class: 'admin-tag' }, PLATFORM_ADMIN_LABEL) : null) },
    { key: 'email', label: 'Email', render: (r) => h('span', { class: 'admin-email' }, r.email, r.emailConfirmed ? null : h('span', { class: 'admin-muted' }, ' (sin confirmar)')) },
    { key: 'organization', label: 'Empresa', render: (r) => h('span', {}, r.organization, r.members !== null && r.members > 1 ? h('span', { class: 'admin-muted' }, ` · ${r.members} miembros`) : null) },
    { key: 'role', label: 'Rol empresa' },
    { key: 'createdAt', label: 'Fecha alta', render: (r) => dateOr(r.createdAt) },
    { key: 'updatedAt', label: 'Última actualización', render: (r) => h('span', { title: r.revision !== null ? `Revisión ${r.revision} · esquema ${r.schemaVersion ?? '—'} · ${r.workspaceBytes ?? '—'} bytes` : '' }, dateOr(r.updatedAt, formatDateTime)) },
  ];

  const feedbackHost = h('div', { class: 'admin-reports-host' });
  mount(
    root,
    h(
      'div',
      { class: 'admin' },
      pageIntro({ eyebrow: 'Plataforma', title: 'Usuarios y empresas de RATEOS', text: 'Metadata de usuarios y empresas. No incluye cotizaciones, costos, márgenes ni tarifas de ninguna empresa.', level: 2 }),
      h('div', { class: 'kpi-grid admin-kpis' }, ...res.summary.map((s) => kpi({ label: s.label, value: s.value === null ? '—' : String(s.value), hint: s.hint }))),
      feedbackHost,
      card({ title: 'Usuarios', subtitle: res.generatedAt ? `Actualizado: ${formatDateTime(res.generatedAt)}` : null, level: 3 },
        table({ columns, rows: res.rows, emptyText: 'Todavía no hay usuarios.', className: 'admin-table table-cards' })),
    ),
  );
  await renderFeedback(feedbackHost, app, { status: 'open', kind: null });
  return undefined;
}

/** Última carga pedida por cada lista: con clics rápidos en los filtros, gana el último (no el que llega último). */
const feedbackRenders = new WeakMap();

/**
 * Feedback de la beta (PLAN-2026-029): problemas y sugerencias de las
 * empresas. Se clasifican y se responden; ningún estado suma ni descuenta
 * nada. Sólo se muestra lo que escribió la persona: nunca datos del workspace.
 */
export async function renderFeedback(host, app, filters = { status: 'open', kind: null }) {
  const ctx = app.ctx;
  if (!ctx.admin || typeof ctx.admin.loadFeedback !== 'function') return;
  const { status = 'open', kind = null } = filters;
  const seq = (feedbackRenders.get(host) || 0) + 1;
  feedbackRenders.set(host, seq);
  const stale = () => feedbackRenders.get(host) !== seq;
  mount(host, h('p', { class: 'muted', role: 'status' }, 'Cargando el feedback…'));
  let res;
  try {
    res = await ctx.admin.loadFeedback({ status, kind });
  } catch (error) {
    logger.warn('No se pudo cargar el feedback', { name: error && error.name });
    res = { ok: false, message: 'No pudimos cargar el feedback. Reintentá en unos minutos.' };
  }
  if (stale()) return;
  if (!res.ok) {
    mount(host, card({ title: 'Feedback de la beta', level: 3 }, banner(res.message, res.code === 'unsupported' ? 'info' : 'warning')));
    return;
  }
  const reload = (next = {}) => renderFeedback(host, app, { status, kind, ...next });

  async function review(row, nextStatus, { response = null, duplicateOf = null, responseOnly = false } = {}) {
    const out = await ctx.admin.reviewFeedback(row.id, { status: nextStatus, response, duplicateOf });
    if (!out.ok) {
      app.toast(out.message, 'danger');
      return;
    }
    if (responseOnly) app.toast('Respuesta guardada: la empresa la ve en "Comentarios de tu empresa".', 'success');
    else app.toast(out.changed ? `Quedó como "${feedbackStatus(nextStatus, row.kind).label}".` : 'Ya estaba en ese estado.', 'success');
    await reload();
  }

  // Candidatos a "original" de un duplicado: de TODOS los estados, no sólo del filtro activo. El
  // duplicado más común es el de algo ya resuelto (ESC-05).
  const all = res.rows;
  let candidates = all;
  if (all.length && (status !== null || kind !== null)) {
    try {
      const every = await ctx.admin.loadFeedback({ status: null, kind: null });
      if (every.ok) candidates = every.rows;
    } catch (error) {
      logger.warn('No se pudieron cargar los originales posibles', { name: error && error.name });
    }
    if (stale()) return;
  }
  const excerpt = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 48 ? `${t.slice(0, 47)}…` : t;
  };
  const originalsFor = (row) => candidates.filter((o) => o.id !== row.id && o.kind === row.kind && o.status !== 'duplicate');
  const actionsFor = (row) => {
    const originals = originalsFor(row);
    const draft = { response: '', duplicateOf: null };
    const choice = (to, label, variant = 'secondary') => (row.status === to ? null
      : button(label, { size: 'sm', variant, onClick: () => review(row, to, { response: draft.response || null }) }));
    // Responder sin reclasificar (la base acepta el mismo estado con una respuesta nueva). En "Recibido" se
    // responde al pasarlo a "En revisión"; un duplicado, con "Marcar duplicado".
    const replyOnly = ['in_review', 'confirmed', 'resolved', 'not_applicable'].includes(row.status)
      ? button('Guardar respuesta', {
        size: 'sm',
        variant: 'ghost',
        onClick: () => (draft.response.trim() ? review(row, row.status, { response: draft.response, responseOnly: true }) : app.toast('Escribí la respuesta.', 'warning')),
      })
      : null;
    return h(
      'div',
      { class: 'admin-report-actions stack' },
      textField({ label: 'Respuesta para la empresa (opcional; la ven en "Comentarios de tu empresa")', multiline: true, maxLength: 1000, onChange: (v) => { draft.response = v; } }),
      h('div', { class: 'row admin-report-buttons' },
        choice('in_review', 'En revisión'),
        choice('confirmed', row.kind === 'suggestion' ? 'La tenemos en cuenta' : 'Confirmado'),
        choice('resolved', row.kind === 'suggestion' ? 'Ya está disponible' : 'Resuelto', 'primary'),
        choice('not_applicable', 'No corresponde', 'ghost'),
        replyOnly),
      originals.length
        ? h('div', { class: 'row admin-report-duplicate' },
          selectField({
            label: 'Duplicado de',
            includeEmpty: true,
            emptyLabel: 'Elegí el original…',
            options: originals.map((o) => ({ value: o.id, label: `#${o.ref} · ${o.statusLabel} · ${o.organization} · "${excerpt(o.message)}"` })),
            onChange: (v) => { draft.duplicateOf = v; },
          }),
          button('Marcar duplicado', { size: 'sm', variant: 'ghost', onClick: () => (draft.duplicateOf ? review(row, 'duplicate', { response: draft.response || null, duplicateOf: draft.duplicateOf }) : app.toast('Elegí el original.', 'warning')) }))
        : null,
    );
  };
  const itemCard = (row) => {
    const extra = [
      row.details ? [row.kind === 'suggestion' ? 'Para qué le serviría' : 'Qué estaba haciendo', row.details] : null,
      row.expected ? ['Qué esperaba', row.expected] : null,
    ].filter(Boolean);
    return h(
      'li',
      { class: 'admin-report', dataset: { status: row.status, kind: row.kind } },
      h('div', { class: 'admin-report-head' },
        badge(row.kindLabel, row.kind === 'suggestion' ? 'blue' : 'orange'),
        badge(row.statusLabel, row.tone),
        h('strong', {}, row.organization),
        h('span', { class: 'admin-muted' }, ` · ${row.author} · ${row.createdAt ? formatDateTime(row.createdAt) : '—'} · #${row.ref}`)),
      h('p', { class: 'admin-muted small' }, `${row.category} · ${row.screen} · versión ${row.appVersion}${row.similar ? ` · ${row.similar} parecido(s)` : ''}${row.duplicateOf ? ` · duplicado de #${row.duplicateOf}` : ''}`),
      h('p', { class: 'report-item-text' }, row.message),
      extra.length ? h('dl', { class: 'admin-report-text' }, ...extra.flatMap(([dt, dd]) => [h('dt', {}, dt), h('dd', {}, dd)])) : null,
      row.response ? h('p', { class: 'small' }, h('strong', {}, 'Respuesta: '), row.response) : null,
      row.history.length
        ? h('ol', { class: 'admin-report-history small' }, ...row.history.map((e) => h('li', {}, `${e.at ? formatDateTime(e.at) : '—'} · ${e.actor}: ${e.from ? `${e.from} → ` : ''}${e.to}${e.response ? ` — ${e.response}` : ''}`)))
        : null,
      actionsFor(row),
    );
  };

  const filterRow = (label, list, current, key) => h('div', { class: 'row admin-report-filters', role: 'group', 'aria-label': label },
    ...list.map((f) => button(f.label, { size: 'sm', variant: f.id === current ? 'primary' : 'ghost', attrs: { 'aria-pressed': f.id === current ? 'true' : 'false' }, onClick: () => reload({ [key]: f.id }) })));

  mount(
    host,
    card(
      { title: 'Feedback de la beta', subtitle: 'Problemas y sugerencias de las empresas. Clasificalos y respondé: la empresa ve el estado y tu respuesta.', level: 3 },
      filterRow('Filtrar por estado', FEEDBACK_FILTERS, status, 'status'),
      filterRow('Filtrar por tipo', FEEDBACK_KIND_FILTERS, kind, 'kind'),
      all.length ? h('ul', { class: 'admin-report-list' }, ...all.map(itemCard)) : h('p', { class: 'muted' }, 'No hay comentarios con este filtro.'),
    ),
  );
}
