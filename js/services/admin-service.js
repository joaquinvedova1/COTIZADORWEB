/**
 * RATEOS ADMIN — panel de administración de la PLATAFORMA (#/admin).
 *
 * RATEOS_ADMIN es un rol de plataforma, separado del rol dentro de una
 * empresa (OWNER / ADMIN / ESTIMATOR / VIEWER): se puede ser OWNER de una
 * empresa y RATEOS_ADMIN a la vez.
 *
 * Seguridad: quién es admin lo decide Postgres (private.platform_admins).
 * Acá sólo se muestra u oculta la entrada del menú; aunque alguien fuerce
 * "platformAdmin" desde DevTools, la base rechaza admin_overview/admin_users.
 * Administrar la plataforma ≠ leer los datos privados del cliente: este
 * servicio sólo maneja metadata (nunca cotizaciones, costos ni tarifas).
 */

import { WORKSPACE_ERRORS } from '../data/workspace-gateway.js';

export const PLATFORM_ADMIN_LABEL = 'RATEOS ADMIN';
export const ADMIN_NO_ACCESS = 'No tenés permisos para acceder a esta sección.';

const ADMIN_ERRORS = Object.freeze({
  [WORKSPACE_ERRORS.forbidden]: ADMIN_NO_ACCESS,
  [WORKSPACE_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y reintentá.',
  [WORKSPACE_ERRORS.sessionExpired]: 'Tu sesión terminó. Volvé a ingresar.',
});

export function adminErrorMessage(code) {
  return ADMIN_ERRORS[code] || 'No pudimos cargar la administración. Reintentá en unos minutos.';
}

const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
};

/** Los 4 indicadores del panel (en el orden en que se muestran). */
export function adminSummary(overview = {}) {
  return [
    { key: 'users_total', label: 'Usuarios totales', value: toCount(overview.users_total), hint: toCount(overview.users_confirmed) !== null ? `${toCount(overview.users_confirmed)} con email confirmado` : null },
    { key: 'organizations_total', label: 'Organizaciones totales', value: toCount(overview.organizations_total), hint: null },
    { key: 'users_recent', label: 'Usuarios registrados (7 / 30 días)', value: toCount(overview.users_7d) === null || toCount(overview.users_30d) === null ? null : `${toCount(overview.users_7d)} / ${toCount(overview.users_30d)}`, hint: null },
    { key: 'workspaces_active_30d', label: 'Workspaces activos', value: toCount(overview.workspaces_active_30d), hint: toCount(overview.workspaces_total) !== null ? `con datos guardados en los últimos 30 días, de ${toCount(overview.workspaces_total)}` : null },
  ];
}

const ROLE_NAMES = Object.freeze({ OWNER: 'Dueño/a', ADMIN: 'Administrador/a', ESTIMATOR: 'Presupuestista', VIEWER: 'Sólo lectura' });

/** Filas de la tabla de usuarios: sólo metadata, con textos para personas. */
export function adminRows(users = []) {
  return (Array.isArray(users) ? users : []).map((u) => ({
    name: typeof u.full_name === 'string' && u.full_name.trim() ? u.full_name.trim() : '—',
    email: typeof u.email === 'string' ? u.email : '—',
    emailConfirmed: u.email_confirmed === true,
    platformAdmin: u.is_platform_admin === true,
    organization: typeof u.organization_name === 'string' && u.organization_name ? u.organization_name : '—',
    role: ROLE_NAMES[u.organization_role] || '—',
    members: toCount(u.organization_members),
    createdAt: u.user_created_at || null,
    lastSignInAt: u.last_sign_in_at || null,
    updatedAt: u.workspace_updated_at || null,
    revision: toCount(u.workspace_revision),
    schemaVersion: toCount(u.workspace_schema_version),
    workspaceBytes: toCount(u.workspace_bytes),
  }));
}

/**
 * @param {ReturnType<import('../data/admin-gateway.js').createAdminGateway>} gateway
 */
export function createAdminService(gateway) {
  return {
    /** Panel completo: indicadores + usuarios. Si la base dice que no, no hay nada. */
    async load() {
      const overview = await gateway.overview();
      if (!overview.ok) return { ok: false, code: overview.code, message: adminErrorMessage(overview.code) };
      const users = await gateway.users();
      if (!users.ok) return { ok: false, code: users.code, message: adminErrorMessage(users.code) };
      return { ok: true, summary: adminSummary(overview.overview), rows: adminRows(users.users), generatedAt: overview.overview.generated_at || null };
    },
  };
}
