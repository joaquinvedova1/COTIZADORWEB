/**
 * Créditos de prueba y reportes de errores de la beta (PLAN-2026-029,
 * supabase/migrations/20261021120000_rateos_beta_credits_reports.sql).
 *
 * La AUTORIDAD está en Postgres: el saldo vive en tablas privadas que el
 * navegador no puede leer ni escribir, el cobro lo hace un trigger al guardar
 * el workspace y el premio de un reporte lo aprueba RATEOS ADMIN. Este
 * archivo sólo consulta y traduce errores; nada de lo que mande el cliente
 * cambia un saldo.
 *
 * Si la base todavía no tiene la migración (función inexistente), responde
 * { ok: false, code: 'unsupported' }: la app sigue funcionando sin créditos
 * ni reportes.
 */

import { workspaceErrorCode, WORKSPACE_ERRORS } from './workspace-gateway.js';

export const BETA_ERRORS = Object.freeze({
  unsupported: 'unsupported',
  rateLimited: 'rate_limited',
  duplicate: 'duplicate',
  tooManyOpen: 'too_many_open',
  invalid: 'invalid',
  final: 'final',
  selfReview: 'self_review',
  notFound: 'report_not_found',
});

/** Mensajes propios de la base (raise exception '<mensaje>') → código. */
const RPC_MESSAGES = Object.freeze({
  rateos_report_rate_limited: BETA_ERRORS.rateLimited,
  rateos_report_duplicate: BETA_ERRORS.duplicate,
  rateos_report_too_many_open: BETA_ERRORS.tooManyOpen,
  rateos_report_invalid: BETA_ERRORS.invalid,
  rateos_report_final: BETA_ERRORS.final,
  rateos_report_self_review: BETA_ERRORS.selfReview,
  rateos_report_not_found: BETA_ERRORS.notFound,
});

/** Código de un error de una RPC de la beta (sin exponer detalles). */
export function betaErrorCode(error) {
  if (!error) return null;
  const message = String(error.message || '');
  if (Object.prototype.hasOwnProperty.call(RPC_MESSAGES, message)) return RPC_MESSAGES[message];
  // PostgREST: la función no existe (la migración no está aplicada).
  if (error.code === 'PGRST202' || (Number(error.status) === 404 && /function|could not find/i.test(message))) return BETA_ERRORS.unsupported;
  return workspaceErrorCode(error) || WORKSPACE_ERRORS.unknown;
}

async function rpc(client, name, args) {
  try {
    const res = await client.rpc(name, args);
    if (res && res.error) return { ok: false, code: betaErrorCode({ ...res.error, status: res.status }), data: null };
    return { ok: true, code: null, data: res ? res.data : null };
  } catch (error) {
    return { ok: false, code: betaErrorCode(error) || WORKSPACE_ERRORS.unknown, data: null };
  }
}

const toInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Saldo con sólo los campos esperados (aunque la base mandara más). */
export function normalizeCredits(data) {
  if (!data || typeof data !== 'object' || data.enabled !== true) return { enabled: false };
  return {
    enabled: true,
    balance: Math.max(0, toInt(data.balance) ?? 0),
    initial: Math.max(0, toInt(data.initial) ?? 0),
    used: Math.max(0, toInt(data.used) ?? 0),
    rewarded: Math.max(0, toInt(data.rewarded) ?? 0),
    reportReward: Math.max(0, toInt(data.report_reward) ?? 0),
  };
}

const REPORT_FIELDS = Object.freeze(['id', 'created_at', 'category', 'screen', 'app_version', 'did', 'expected', 'happened', 'status', 'review_note', 'reviewed_at', 'mine', 'credits_added']);

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
export function createBetaGateway(client) {
  if (!client || typeof client.rpc !== 'function') throw new Error('Cliente de Supabase inválido.');
  return {
    /** Saldo de la empresa ({ enabled: false } si no tiene cuota). */
    async credits(organizationId) {
      const res = await rpc(client, 'get_my_credits', { p_org: organizationId });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, credits: normalizeCredits(res.data) };
    },

    /** Cuántos de estos ids cobraría la base (no reserva nada). */
    async preview(organizationId, { quoteIds = [], productIds = [] } = {}) {
      const res = await rpc(client, 'credit_preview', { p_org: organizationId, p_quote_ids: quoteIds, p_product_ids: productIds });
      if (!res.ok) return { ok: false, code: res.code };
      const d = res.data || {};
      return { ok: true, code: null, enabled: d.enabled === true, balance: toInt(d.balance), chargeable: Math.max(0, toInt(d.chargeable) ?? 0) };
    },

    /** Envía un reporte (sólo texto y claves de listas fijas). */
    async submitReport(organizationId, { category, did, expected, happened, screen, appVersion }) {
      const res = await rpc(client, 'submit_bug_report', {
        p_org: organizationId,
        p_category: category,
        p_did: did,
        p_expected: expected,
        p_happened: happened,
        p_screen: screen,
        p_app_version: appVersion,
      });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, report: pick(res.data, ['id', 'status', 'created_at']) };
    },

    /** Reportes de la empresa propia. */
    async myReports(organizationId) {
      const res = await rpc(client, 'my_bug_reports', { p_org: organizationId });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, reports: Array.isArray(res.data) ? res.data.map((r) => pick(r, REPORT_FIELDS)) : [] };
    },
  };
}
