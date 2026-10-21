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
import { BETA_ERRORS } from '../data/beta-gateway.js';
import { bugCategoryLabel, bugScreenLabel, bugStatus } from '../domain/bug-report.js';

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

const REVIEW_ERRORS = Object.freeze({
  [BETA_ERRORS.final]: 'Este reporte ya está aprobado: es definitivo.',
  [BETA_ERRORS.selfReview]: 'No podés revisar reportes de una empresa de la que sos miembro.',
  [BETA_ERRORS.invalid]: 'Elegí un estado válido (y, para "Duplicado", el reporte original).',
  [BETA_ERRORS.notFound]: 'El reporte ya no existe.',
  [BETA_ERRORS.unsupported]: 'Los reportes todavía no están habilitados en la base.',
});

export function reviewErrorMessage(code) {
  return REVIEW_ERRORS[code] || adminErrorMessage(code);
}

const shortId = (id) => (typeof id === 'string' ? id.slice(0, 8) : '');

/** Reporte de la cola con textos para personas (nunca datos del workspace). */
export function adminReportRow(r = {}) {
  const status = bugStatus(r.status);
  const history = Array.isArray(r.history) ? r.history : [];
  return {
    id: typeof r.id === 'string' ? r.id : '',
    ref: shortId(r.id),
    createdAt: r.created_at || null,
    organization: typeof r.organization_name === 'string' && r.organization_name ? r.organization_name : '—',
    reporter: typeof r.reporter_email === 'string' && r.reporter_email ? r.reporter_email : '—',
    category: bugCategoryLabel(r.category),
    screen: bugScreenLabel(r.screen),
    appVersion: typeof r.app_version === 'string' ? r.app_version : '—',
    did: typeof r.did === 'string' ? r.did : '',
    expected: typeof r.expected === 'string' ? r.expected : '',
    happened: typeof r.happened === 'string' ? r.happened : '',
    status: typeof r.status === 'string' ? r.status : 'received',
    statusLabel: status.label,
    tone: status.tone,
    open: r.status === 'received' || r.status === 'in_review',
    final: r.status === 'approved',
    duplicateOf: shortId(r.duplicate_of) || null,
    reviewNote: typeof r.review_note === 'string' ? r.review_note : '',
    reviewedAt: r.reviewed_at || null,
    reviewer: typeof r.reviewer_email === 'string' ? r.reviewer_email : null,
    creditsAdded: toCount(r.credits_added) || 0,
    quotaEnabled: r.org_quota_enabled === true,
    balance: toCount(r.org_balance),
    similar: toCount(r.similar_reports) || 0,
    history: history.map((e) => ({
      at: e && e.at ? e.at : null,
      actor: e && typeof e.actor === 'string' ? e.actor : '—',
      from: e && e.from ? bugStatus(e.from).label : null,
      to: e && e.to ? bugStatus(e.to).label : '—',
      note: e && typeof e.note === 'string' ? e.note : null,
      credits: e ? toCount(e.credits) || 0 : 0,
    })),
  };
}

/**
 * @param {ReturnType<import('../data/admin-gateway.js').createAdminGateway>} gateway
 */
export function createAdminService(gateway) {
  return {
    /** Cola de reportes de errores y saldos por empresa (PLAN-2026-029). */
    async loadReports(status = 'open') {
      if (typeof gateway.bugReports !== 'function') return { ok: false, code: BETA_ERRORS.unsupported, message: reviewErrorMessage(BETA_ERRORS.unsupported) };
      const [reports, accounts] = await Promise.all([gateway.bugReports(status), gateway.creditAccounts()]);
      if (!reports.ok) return { ok: false, code: reports.code, message: reviewErrorMessage(reports.code) };
      return {
        ok: true,
        rows: reports.reports.map(adminReportRow),
        accounts: accounts.ok ? accounts.accounts.map((a) => ({
          organization: typeof a.organization_name === 'string' ? a.organization_name : '—',
          enabled: a.enabled === true,
          balance: toCount(a.balance),
          initial: toCount(a.initial),
          used: toCount(a.used),
          rewarded: toCount(a.rewarded),
          adjusted: Number.isFinite(Number(a.adjusted)) ? Math.trunc(Number(a.adjusted)) : 0,
        })) : [],
      };
    },

    /**
     * Cambia el estado de un reporte. "approved" suma los créditos del premio
     * una sola vez (lo garantiza la base) y no se puede deshacer.
     */
    async reviewReport(reportId, { status, note = null, duplicateOf = null }) {
      const res = await gateway.reviewBugReport(reportId, { status, note, duplicateOf });
      if (!res.ok) return { ok: false, code: res.code, message: reviewErrorMessage(res.code) };
      return { ok: true, status: res.status, already: res.already, creditsAdded: res.creditsAdded, balance: res.balance };
    },

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
