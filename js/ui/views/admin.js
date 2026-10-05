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
import { banner, button, card, kpi, pageIntro, table } from '../components.js';
import { formatDate, formatDateTime } from '../../core/format.js';
import { logger } from '../../core/logger.js';
import { ADMIN_NO_ACCESS, PLATFORM_ADMIN_LABEL } from '../../services/admin-service.js';

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

  mount(
    root,
    h(
      'div',
      { class: 'admin' },
      pageIntro({ eyebrow: 'Plataforma', title: 'Usuarios y empresas de RATEOS', text: 'Metadata de usuarios y empresas. No incluye cotizaciones, costos, márgenes ni tarifas de ninguna empresa.', level: 2 }),
      h('div', { class: 'kpi-grid admin-kpis' }, ...res.summary.map((s) => kpi({ label: s.label, value: s.value === null ? '—' : String(s.value), hint: s.hint }))),
      card({ title: 'Usuarios', subtitle: res.generatedAt ? `Actualizado: ${formatDateTime(res.generatedAt)}` : null, level: 3 },
        table({ columns, rows: res.rows, emptyText: 'Todavía no hay usuarios.', className: 'admin-table table-cards' })),
    ),
  );
  return undefined;
}
