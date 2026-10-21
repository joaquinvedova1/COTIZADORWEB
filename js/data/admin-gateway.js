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
import { betaErrorCode } from './beta-gateway.js';

async function rpc(client, name, args) {
  try {
    const res = args === undefined ? await client.rpc(name) : await client.rpc(name, args);
    if (res && res.error) return { ok: false, code: betaErrorCode({ ...res.error, status: res.status }) || WORKSPACE_ERRORS.unknown, data: null };
    return { ok: true, code: null, data: res ? res.data : null };
  } catch (error) {
    return { ok: false, code: betaErrorCode(error) || WORKSPACE_ERRORS.unknown, data: null };
  }
}

/** Sólo los campos de metadata permitidos (aunque la base mandara más). */
const USER_FIELDS = Object.freeze([
  'full_name', 'email', 'email_confirmed', 'user_created_at', 'last_sign_in_at',
  'organization_name', 'organization_role', 'organization_members', 'organization_created_at',
  'workspace_revision', 'workspace_schema_version', 'workspace_bytes', 'workspace_updated_at', 'is_platform_admin',
]);

/** Reportes de errores (PLAN-2026-029): texto del reporte y su revisión, nunca el workspace. */
const BUG_REPORT_FIELDS = Object.freeze([
  'id', 'created_at', 'organization_name', 'reporter_email', 'category', 'screen', 'app_version', 'did', 'expected', 'happened',
  'status', 'duplicate_of', 'review_note', 'reviewed_at', 'reviewer_email', 'credits_added', 'org_quota_enabled', 'org_balance',
  'similar_reports', 'history',
]);

const CREDIT_ACCOUNT_FIELDS = Object.freeze(['organization_name', 'enabled', 'balance', 'initial', 'used', 'rewarded', 'adjusted', 'created_at']);

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

    /** Cola de reportes de errores ('open' = recibidos y en revisión; null = todos). */
    async bugReports(status = null) {
      const res = await rpc(client, 'admin_bug_reports', { p_status: status });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, reports: Array.isArray(res.data) ? res.data.map((r) => pick(r, BUG_REPORT_FIELDS)) : [] };
    },

    /**
     * Cambia el estado de un reporte. "approved" suma los créditos del premio
     * UNA sola vez (lo garantiza la base) y es definitivo.
     */
    async reviewBugReport(reportId, { status, note = null, duplicateOf = null }) {
      const res = await rpc(client, 'admin_review_bug_report', { p_report: reportId, p_status: status, p_note: note, p_duplicate_of: duplicateOf });
      if (!res.ok) return { ok: false, code: res.code };
      const d = res.data || {};
      return { ok: true, code: null, status: d.status, already: d.already === true, creditsAdded: Number(d.credits_added) || 0, balance: d.balance ?? null };
    },

    /** Saldos de créditos por empresa (metadata del ledger). */
    async creditAccounts() {
      const res = await rpc(client, 'admin_credit_accounts');
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, accounts: Array.isArray(res.data) ? res.data.map((r) => pick(r, CREDIT_ACCOUNT_FIELDS)) : [] };
    },
  };
}
