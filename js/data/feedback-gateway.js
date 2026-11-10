/**
 * "Reportar un problema" — única puerta a Supabase para los reportes
 * (supabase/migrations/20261107021710_rateos_bug_reports.sql).
 *
 * - submitPublic(): sin sesión, Edge Function "bug-report-submit".
 * - submit(): public.submit_bug_report (sólo con sesión; la base valida
 *   largos y limita la cantidad por persona). Es la fuente de verdad.
 * - Después avisa a la Edge Function "bug-report-github", que crea el issue
 *   en GitHub sin datos de la persona. Si esa parte falla, el reporte ya
 *   quedó guardado: nunca se muestra como error.
 * - listForAdmin(): public.admin_bug_reports (sólo RATEOS_ADMIN, lo decide
 *   la base).
 */

import { workspaceErrorCode, WORKSPACE_ERRORS } from './workspace-gateway.js';

export const FEEDBACK_ERRORS = Object.freeze({ ...WORKSPACE_ERRORS, rateLimited: 'rate_limited', invalid: 'invalid' });

const REFERENCE_RE = /^R-[0-9A-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código propio (sin exponer detalles de Postgres). */
export function feedbackErrorCode(error) {
  if (!error) return null;
  const code = String(error.code || '');
  const message = String(error.message || '');
  if (code === '54000' || /rate_limited/.test(message)) return FEEDBACK_ERRORS.rateLimited;
  if (code === '22023' || /invalid_report/.test(message)) return FEEDBACK_ERRORS.invalid;
  return workspaceErrorCode(error) || FEEDBACK_ERRORS.unknown;
}

/** Sólo los campos que muestra el panel de admin. */
const ADMIN_FIELDS = Object.freeze(['reference', 'created_at', 'what_happened', 'expected', 'where_label', 'app_version', 'app_commit', 'browser', 'status', 'github_issue_url']);

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
      let id = null;
      let reference = null;
      try {
        const res = await client.rpc('submit_bug_report', { p_report: payload });
        if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }), reference: null };
        const data = res ? res.data : null;
        id = data && typeof data.id === 'string' && UUID_RE.test(data.id) ? data.id : null;
        reference = data && typeof data.reference === 'string' && REFERENCE_RE.test(data.reference) ? data.reference : null;
      } catch (error) {
        return { ok: false, code: feedbackErrorCode(error) || FEEDBACK_ERRORS.unknown, reference: null };
      }
      // Puente a GitHub: en segundo plano y sin bloquear el "¡Gracias!".
      if (id && client.functions && typeof client.functions.invoke === 'function') {
        try {
          client.functions.invoke('bug-report-github', { body: { id } }).catch(() => undefined);
        } catch {
          /* el reporte ya quedó guardado */
        }
      }
      return { ok: true, code: null, reference };
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
  };
}
