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
import { FEEDBACK_ERRORS } from '../data/feedback-gateway.js';
import { feedbackCategoryLabel, feedbackKindLabel, feedbackScreenLabel, feedbackStatus } from '../domain/feedback.js';

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
  [FEEDBACK_ERRORS.invalid]: 'Elegí un estado válido (y, para "Duplicado", el comentario original).',
  [FEEDBACK_ERRORS.notFound]: 'El comentario ya no existe.',
  [FEEDBACK_ERRORS.unsupported]: 'El feedback todavía no está habilitado en la base.',
});

export function reviewErrorMessage(code) {
  return REVIEW_ERRORS[code] || adminErrorMessage(code);
}

const shortId = (id) => (typeof id === 'string' ? id.slice(0, 8) : '');

/** Comentario de la cola con textos para personas (nunca datos del workspace). */
export function adminFeedbackRow(r = {}) {
  const kind = r.kind === 'suggestion' ? 'suggestion' : 'problem';
  const status = feedbackStatus(r.status, kind);
  const history = Array.isArray(r.history) ? r.history : [];
  const text = (value) => (typeof value === 'string' ? value : '');
  return {
    id: text(r.id),
    ref: shortId(r.id),
    createdAt: r.created_at || null,
    organization: text(r.organization_name) || '—',
    author: text(r.author_email) || '—',
    kind,
    kindLabel: feedbackKindLabel(kind),
    category: feedbackCategoryLabel(r.category),
    screen: feedbackScreenLabel(r.screen),
    appVersion: text(r.app_version) || '—',
    message: text(r.message),
    details: text(r.details),
    expected: text(r.expected),
    status: typeof r.status === 'string' ? r.status : 'received',
    statusLabel: status.label,
    tone: status.tone,
    open: ['received', 'in_review', 'confirmed'].includes(r.status),
    duplicateOf: shortId(r.duplicate_of) || null,
    response: text(r.response),
    reviewedAt: r.reviewed_at || null,
    reviewer: text(r.reviewer_email) || null,
    similar: toCount(r.similar_count) || 0,
    history: history.map((e) => ({
      at: e && e.at ? e.at : null,
      actor: e && typeof e.actor === 'string' ? e.actor : '—',
      from: e && e.from ? feedbackStatus(e.from, kind).label : null,
      to: e && e.to ? feedbackStatus(e.to, kind).label : '—',
      response: e && typeof e.response === 'string' ? e.response : null,
    })),
  };
}

/**
 * @param {ReturnType<import('../data/admin-gateway.js').createAdminGateway>} gateway
 */
export function createAdminService(gateway) {
  return {
    /** Cola de feedback de la beta (PLAN-2026-029): 'open' = sin resolver; kind = problemas o sugerencias. */
    async loadFeedback({ status = 'open', kind = null } = {}) {
      if (typeof gateway.feedback !== 'function') return { ok: false, code: FEEDBACK_ERRORS.unsupported, message: reviewErrorMessage(FEEDBACK_ERRORS.unsupported) };
      const res = await gateway.feedback({ status, kind });
      if (!res.ok) return { ok: false, code: res.code, message: reviewErrorMessage(res.code) };
      return { ok: true, rows: res.items.map(adminFeedbackRow) };
    },

    /** Clasifica un comentario y, si hay texto, deja la respuesta que ve la empresa. No suma ni descuenta nada. */
    async reviewFeedback(feedbackId, { status, response = null, duplicateOf = null }) {
      const res = await gateway.reviewFeedback(feedbackId, { status, response, duplicateOf });
      if (!res.ok) return { ok: false, code: res.code, message: reviewErrorMessage(res.code) };
      return { ok: true, status: res.status, changed: res.changed };
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
