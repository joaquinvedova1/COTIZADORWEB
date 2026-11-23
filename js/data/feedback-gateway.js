/**
 * "Reportar un problema" — única puerta a Supabase para los reportes
 * (supabase/migrations/20261107021710_rateos_bug_reports.sql).
 *
 * - submitPublic(): sin sesión, Edge Function "bug-report-submit".
 * - submit(): public.submit_bug_report (sólo con sesión; la base valida
 *   largos y limita la cantidad por persona). Es la fuente de verdad.
 * - Ningún reporte se publica solo en GitHub (repositorio público, S-04):
 *   ya no se llama a la Edge Function "bug-report-github".
 * - listForAdmin() / updateForAdmin(): public.admin_bug_reports y
 *   public.admin_update_bug_report (sólo RATEOS_ADMIN, lo decide la base).
 */

import { workspaceErrorCode, WORKSPACE_ERRORS } from './workspace-gateway.js';

export const FEEDBACK_ERRORS = Object.freeze({ ...WORKSPACE_ERRORS, rateLimited: 'rate_limited', invalid: 'invalid', notReady: 'not_ready' });

const REFERENCE_RE = /^R-[0-9A-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código propio (sin exponer detalles de Postgres). */
export function feedbackErrorCode(error) {
  if (!error) return null;
  const code = String(error.code || '');
  const message = String(error.message || '');
  if (code === '54000' || /rate_limited/.test(message)) return FEEDBACK_ERRORS.rateLimited;
  if (code === '22023' || /invalid_report/.test(message)) return FEEDBACK_ERRORS.invalid;
  // La RPC todavía no existe en la base (migración sin aplicar).
  if (code === 'PGRST202' || code === '42883') return FEEDBACK_ERRORS.notReady;
  return workspaceErrorCode(error) || FEEDBACK_ERRORS.unknown;
}

/** Sólo los campos que muestra el panel de admin. */
const ADMIN_FIELDS = Object.freeze(['id', 'reference', 'created_at', 'kind', 'severity', 'status', 'step', 'where_label', 'route', 'what_happened', 'expected', 'app_version', 'app_commit', 'browser', 'viewport', 'mode', 'triage_note', 'triaged_at', 'fixed_in_version']);
const UPDATE_FIELDS = Object.freeze(['status', 'severity', 'kind', 'fixed_in_version', 'triage_note']);

/**
 * @param {object} client cliente de Supabase
 */
export function createFeedbackGateway(client) {
  if (!client || typeof client.rpc !== 'function') throw new Error('Cliente de Supabase inválido.');
  return {
    /**
     * @param {object} payload ver js/services/feedback-service.js (buildReportPayload)
     * @returns {Promise<{ ok: boolean, code: string|null, reference: string|null }>}
     */
    async submit(payload) {
      try {
        const res = await client.rpc('submit_bug_report', { p_report: payload });
        if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }), reference: null };
        const data = res ? res.data : null;
        const reference = data && typeof data.reference === 'string' && REFERENCE_RE.test(data.reference) ? data.reference : null;
        return { ok: true, code: null, reference };
      } catch (error) {
        return { ok: false, code: feedbackErrorCode(error) || FEEDBACK_ERRORS.unknown, reference: null };
      }
    },

    /**
     * Sin sesión: Edge Function "bug-report-submit" (service_role adentro;
     * la base no le da nada a anon). Nunca crea un issue de GitHub.
     * @returns {Promise<{ ok: boolean, code: string|null, reference: string|null }>}
     */
    async submitPublic(payload) {
      if (!client.functions || typeof client.functions.invoke !== 'function') return { ok: false, code: FEEDBACK_ERRORS.unknown, reference: null };
      try {
        const res = await client.functions.invoke('bug-report-submit', { body: { report: payload } });
        if (res && res.error) {
          const status = Number(res.error.context && res.error.context.status);
          if (status === 429) return { ok: false, code: FEEDBACK_ERRORS.rateLimited, reference: null };
          if (status === 400 || status === 413) return { ok: false, code: FEEDBACK_ERRORS.invalid, reference: null };
          const name = String(res.error.name || '');
          if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return { ok: false, code: FEEDBACK_ERRORS.network, reference: null };
          return { ok: false, code: FEEDBACK_ERRORS.unknown, reference: null };
        }
        const data = res ? res.data : null;
        if (!data || data.ok !== true) return { ok: false, code: FEEDBACK_ERRORS.unknown, reference: null };
        const reference = typeof data.reference === 'string' && REFERENCE_RE.test(data.reference) ? data.reference : null;
        return { ok: true, code: null, reference };
      } catch (error) {
        return { ok: false, code: feedbackErrorCode(error) || FEEDBACK_ERRORS.unknown, reference: null };
      }
    },

    /** Reportes recibidos (RATEOS_ADMIN). */
    async listForAdmin() {
      try {
        const res = await client.rpc('admin_bug_reports');
        if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }), reports: [] };
        const rows = Array.isArray(res && res.data) ? res.data : [];
        return {
          ok: true,
          code: null,
          reports: rows.map((r) => {
            const out = {};
            ADMIN_FIELDS.forEach((f) => {
              if (r && Object.prototype.hasOwnProperty.call(r, f)) out[f] = r[f];
            });
            return out;
          }),
        };
      } catch (error) {
        return { ok: false, code: feedbackErrorCode(error) || FEEDBACK_ERRORS.unknown, reports: [] };
      }
    },

    /**
     * Seguimiento (RATEOS_ADMIN): estado, severidad, tipo, versión y nota.
     * @param {string} id
     * @param {{ status?: string, severity?: string, kind?: string, fixed_in_version?: string, triage_note?: string }} changes
     */
    async updateForAdmin(id, changes) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, code: FEEDBACK_ERRORS.invalid, report: null };
      const clean = {};
      UPDATE_FIELDS.forEach((f) => {
        if (changes && changes[f] !== undefined && changes[f] !== null) clean[f] = String(changes[f]);
      });
      try {
        const res = await client.rpc('admin_update_bug_report', { p_id: id, p_changes: clean });
        if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }), report: null };
        return { ok: true, code: null, report: res ? res.data : null };
      } catch (error) {
        return { ok: false, code: feedbackErrorCode(error) || FEEDBACK_ERRORS.unknown, report: null };
      }
    },
  };
}
