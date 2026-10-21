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
import { badge, banner, button, card, confirmDialog, kpi, pageIntro, selectField, table, textField } from '../components.js';
import { formatDate, formatDateTime } from '../../core/format.js';
import { logger } from '../../core/logger.js';
import { ADMIN_NO_ACCESS, PLATFORM_ADMIN_LABEL } from '../../services/admin-service.js';

/** Filtros de la cola de reportes (PLAN-2026-029). */
export const REPORT_FILTERS = Object.freeze([
  { id: 'open', label: 'Abiertos' },
  { id: 'approved', label: 'Aprobados' },
  { id: 'rejected', label: 'No corresponde' },
  { id: 'duplicate', label: 'Duplicados' },
  { id: null, label: 'Todos' },
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

  const reportsHost = h('div', { class: 'admin-reports-host' });
  mount(
    root,
    h(
      'div',
      { class: 'admin' },
      pageIntro({ eyebrow: 'Plataforma', title: 'Usuarios y empresas de RATEOS', text: 'Metadata de usuarios y empresas. No incluye cotizaciones, costos, márgenes ni tarifas de ninguna empresa.', level: 2 }),
      h('div', { class: 'kpi-grid admin-kpis' }, ...res.summary.map((s) => kpi({ label: s.label, value: s.value === null ? '—' : String(s.value), hint: s.hint }))),
      reportsHost,
      card({ title: 'Usuarios', subtitle: res.generatedAt ? `Actualizado: ${formatDateTime(res.generatedAt)}` : null, level: 3 },
        table({ columns, rows: res.rows, emptyText: 'Todavía no hay usuarios.', className: 'admin-table table-cards' })),
    ),
  );
  await renderReports(reportsHost, app, 'open');
  return undefined;
}

/**
 * Reportes de errores y créditos de prueba (PLAN-2026-029). Aprobar suma los
 * créditos del premio UNA sola vez (lo garantiza la base) y es definitivo.
 * Sólo se muestra el texto del reporte: nunca datos del workspace.
 */
export async function renderReports(host, app, filter = 'open') {
  const ctx = app.ctx;
  if (!ctx.admin || typeof ctx.admin.loadReports !== 'function') return;
  mount(host, h('p', { class: 'muted', role: 'status' }, 'Cargando los reportes…'));
  let res;
  try {
    res = await ctx.admin.loadReports(filter);
  } catch (error) {
    logger.warn('No se pudieron cargar los reportes', { name: error && error.name });
    res = { ok: false, message: 'No pudimos cargar los reportes. Reintentá en unos minutos.' };
  }
  if (!res.ok) {
    mount(host, card({ title: 'Reportes de errores', level: 3 }, banner(res.message, res.code === 'unsupported' ? 'info' : 'warning')));
    return;
  }
  const reload = (f = filter) => renderReports(host, app, f);

  async function review(row, status, { note = null, duplicateOf = null } = {}) {
    if (status === 'approved') {
      const ok = await confirmDialog({
        title: 'Aprobar el reporte',
        message: row.quotaEnabled
          ? `¿Confirmaste que es un error real de RATEOS? Se suman los cálculos del premio (+2) a "${row.organization}". No se puede deshacer.`
          : `¿Confirmaste que es un error real de RATEOS? "${row.organization}" no tiene cuota de prueba: se aprueba sin sumar cálculos. No se puede deshacer.`,
        confirmLabel: 'Aprobar',
      });
      if (!ok) return;
    }
    const out = await ctx.admin.reviewReport(row.id, { status, note, duplicateOf });
    if (!out.ok) {
      app.toast(out.message, 'danger');
      return;
    }
    if (status === 'approved') {
      app.toast(out.already ? 'Ya estaba aprobado: no se sumó nada.' : `Reporte aprobado.${out.creditsAdded ? ` Se sumaron ${out.creditsAdded} cálculos a ${row.organization}.` : ''}`, 'success');
    } else {
      app.toast('Estado actualizado.', 'success');
    }
    await reload();
  }

  const others = res.rows;
  const reportCard = (row) => {
    const draft = { note: '', duplicateOf: null };
    const actions = row.final ? null : h(
      'div',
      { class: 'admin-report-actions stack' },
      textField({ label: 'Nota para la empresa (opcional; la ve quien reportó)', multiline: true, maxLength: 1000, onChange: (v) => { draft.note = v; } }),
      h('div', { class: 'row' },
        row.status === 'in_review' ? null : button('En revisión', { size: 'sm', onClick: () => review(row, 'in_review', { note: draft.note || null }) }),
        button(row.quotaEnabled ? 'Aprobar (+2)' : 'Aprobar', { size: 'sm', variant: 'primary', icon: 'check', onClick: () => review(row, 'approved', { note: draft.note || null }) }),
        row.status === 'rejected' ? null : button('No corresponde', { size: 'sm', variant: 'ghost', onClick: () => review(row, 'rejected', { note: draft.note || null }) })),
      others.length > 1
        ? h('div', { class: 'row admin-report-duplicate' },
          selectField({
            label: 'Duplicado de',
            includeEmpty: true,
            emptyLabel: 'Elegí el reporte original…',
            options: others.filter((o) => o.id !== row.id).map((o) => ({ value: o.id, label: `#${o.ref} · ${o.organization} · ${o.category}` })),
            onChange: (v) => { draft.duplicateOf = v; },
          }),
          button('Marcar duplicado', { size: 'sm', variant: 'ghost', onClick: () => (draft.duplicateOf ? review(row, 'duplicate', { note: draft.note || null, duplicateOf: draft.duplicateOf }) : app.toast('Elegí el reporte original.', 'warning')) }))
        : null,
    );
    return h(
      'li',
      { class: 'admin-report', dataset: { status: row.status } },
      h('div', { class: 'admin-report-head' },
        badge(row.statusLabel, row.tone),
        h('strong', {}, row.organization),
        h('span', { class: 'admin-muted' }, ` · ${row.reporter} · ${row.createdAt ? formatDateTime(row.createdAt) : '—'} · #${row.ref}`)),
      h('p', { class: 'admin-muted small' }, `${row.category} · ${row.screen} · versión ${row.appVersion}${row.similar ? ` · ${row.similar} parecido(s) (misma categoría y pantalla)` : ''}${row.duplicateOf ? ` · duplicado de #${row.duplicateOf}` : ''}`),
      h('dl', { class: 'admin-report-text' },
        h('dt', {}, 'Qué hizo'), h('dd', {}, row.did),
        h('dt', {}, 'Qué esperaba'), h('dd', {}, row.expected),
        h('dt', {}, 'Qué pasó'), h('dd', {}, row.happened)),
      h('p', { class: 'admin-muted small' }, row.quotaEnabled ? `Saldo de la empresa: ${row.balance ?? '—'} cálculos de prueba.${row.creditsAdded ? ` Este reporte sumó ${row.creditsAdded}.` : ''}` : 'Empresa sin cuota de prueba: aprobar no suma cálculos.'),
      row.reviewNote ? h('p', { class: 'small' }, h('strong', {}, 'Nota: '), row.reviewNote) : null,
      row.history.length
        ? h('ol', { class: 'admin-report-history small' }, ...row.history.map((e) => h('li', {}, `${e.at ? formatDateTime(e.at) : '—'} · ${e.actor}: ${e.from ? `${e.from} → ` : ''}${e.to}${e.credits ? ` (+${e.credits})` : ''}${e.note ? ` — ${e.note}` : ''}`)))
        : null,
      actions,
    );
  };

  const accountColumns = [
    { key: 'organization', label: 'Empresa' },
    { key: 'balance', label: 'Saldo', render: (a) => (a.enabled ? String(a.balance ?? '—') : 'Sin límite') },
    { key: 'used', label: 'Cálculos creados', render: (a) => String(a.used ?? '—') },
    { key: 'rewarded', label: 'Por reportes', render: (a) => String(a.rewarded ?? 0) },
    { key: 'adjusted', label: 'Ajustes', render: (a) => String(a.adjusted ?? 0) },
  ];

  mount(
    host,
    card(
      { title: 'Reportes de errores', subtitle: 'Revisión manual: aprobar suma +2 cálculos de prueba a la empresa una sola vez y no se puede deshacer.', level: 3 },
      h('div', { class: 'row admin-report-filters', role: 'group', 'aria-label': 'Filtrar reportes' },
        ...REPORT_FILTERS.map((f) => button(f.label, { size: 'sm', variant: f.id === filter ? 'primary' : 'ghost', attrs: { 'aria-pressed': f.id === filter ? 'true' : 'false' }, onClick: () => reload(f.id) }))),
      res.rows.length ? h('ul', { class: 'admin-report-list' }, ...res.rows.map(reportCard)) : h('p', { class: 'muted' }, 'No hay reportes con este filtro.'),
    ),
    res.accounts.length
      ? card({ title: 'Cálculos de prueba por empresa', level: 3 }, table({ columns: accountColumns, rows: res.accounts, className: 'admin-table table-cards' }))
      : null,
  );
}
