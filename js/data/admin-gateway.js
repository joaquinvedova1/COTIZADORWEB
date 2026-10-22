/**
 * RATEOS ADMIN (rol de plataforma) — única puerta a las funciones de admin
 * de Supabase (supabase/migrations/20261005034916_rateos_platform_admin.sql).
 *
 * La AUTORIDAD está en Postgres: public.am_i_platform_admin(),
 * public.admin_overview() y public.admin_users() verifican RATEOS_ADMIN con
 * auth.uid() contra private.platform_admins. Este archivo nunca decide quién
 * es admin (ni por email ni por metadata): sólo pregunta y traduce errores.
 * Lo que devuelve es METADATA de la plataforma, nunca el contenido de un
 * workspace (cotizaciones, costos, tarifas).
 */

import { WORKSPACE_ERRORS } from './workspace-gateway.js';
import { feedbackErrorCode } from './feedback-gateway.js';

async function rpc(client, name, args) {
  try {
    const res = args === undefined ? await client.rpc(name) : await client.rpc(name, args);
    if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }) || WORKSPACE_ERRORS.unknown, data: null };
    return { ok: true, code: null, data: res ? res.data : null };
  } catch (error) {
    return { ok: false, code: feedbackErrorCode(error) || WORKSPACE_ERRORS.unknown, data: null };
  }
}

/** Sólo los campos de metadata permitidos (aunque la base mandara más). */
const USER_FIELDS = Object.freeze([
  'full_name', 'email', 'email_confirmed', 'user_created_at', 'last_sign_in_at',
  'organization_name', 'organization_role', 'organization_members', 'organization_created_at',
  'workspace_revision', 'workspace_schema_version', 'workspace_bytes', 'workspace_updated_at', 'is_platform_admin',
]);

/** Feedback de la beta (PLAN-2026-029): el texto y su clasificación, nunca el workspace. */
const FEEDBACK_FIELDS = Object.freeze([
  'id', 'created_at', 'organization_name', 'author_email', 'kind', 'category', 'screen', 'app_version', 'message', 'details', 'expected',
  'status', 'duplicate_of', 'response', 'reviewed_at', 'reviewer_email', 'similar_count', 'history',
]);

const OVERVIEW_FIELDS = Object.freeze([
  'users_total', 'users_confirmed', 'users_7d', 'users_30d', 'organizations_total', 'workspaces_total', 'workspaces_active_30d', 'generated_at',
]);

function pick(source, fields) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  fields.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(source, f)) out[f] = source[f];
  });
  return out;
}

/**
 * @param {object} client cliente de Supabase
 */
export function createAdminGateway(client) {
  if (!client || typeof client.rpc !== 'function') throw new Error('Cliente de Supabase inválido.');
  return {
    /** ¿La sesión actual es RATEOS_ADMIN? (lo decide la base). Cualquier error = no. */
    async amIPlatformAdmin() {
      const res = await rpc(client, 'am_i_platform_admin');
      return { ok: res.ok, code: res.code, isAdmin: res.ok && res.data === true };
    },

    /** Conteos de la plataforma (registra ADMIN_PANEL_OPEN en la base). */
    async overview() {
      const res = await rpc(client, 'admin_overview');
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, overview: pick(res.data, OVERVIEW_FIELDS) };
    },

    /** Usuarios con su empresa y rol (metadata, nunca el workspace). */
    async users() {
      const res = await rpc(client, 'admin_users');
      if (!res.ok) return { ok: false, code: res.code };
      const rows = Array.isArray(res.data) ? res.data.map((r) => pick(r, USER_FIELDS)) : [];
      return { ok: true, code: null, users: rows };
    },

    /** Cola de feedback ('open' = sin resolver; null = todos) y, opcional, por tipo. */
    async feedback({ status = null, kind = null } = {}) {
      const res = await rpc(client, 'admin_feedback', { p_status: status, p_kind: kind });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, items: Array.isArray(res.data) ? res.data.map((r) => pick(r, FEEDBACK_FIELDS)) : [] };
    },

    /** Clasifica un comentario y, si hay texto, deja la respuesta que ve la empresa. No suma ni descuenta nada. */
    async reviewFeedback(feedbackId, { status, response = null, duplicateOf = null }) {
      const res = await rpc(client, 'admin_review_feedback', { p_feedback: feedbackId, p_status: status, p_response: response, p_duplicate_of: duplicateOf });
      if (!res.ok) return { ok: false, code: res.code };
      const d = res.data || {};
      return { ok: true, code: null, status: d.status, changed: d.changed !== false };
    },
  };
}
