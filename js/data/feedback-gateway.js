/**
 * Feedback de la beta (PLAN-2026-029,
 * supabase/migrations/20261022120000_rateos_beta_feedback.sql).
 *
 * La AUTORIDAD está en Postgres: valida, limita el spam y guarda en tablas
 * privadas que el navegador no puede leer ni escribir. Este archivo sólo
 * llama a las funciones de la API y traduce los errores.
 *
 * Si la base todavía no tiene la migración (función inexistente), responde
 * { ok: false, code: 'unsupported' }: la app sigue funcionando sin feedback.
 */

import { workspaceErrorCode, WORKSPACE_ERRORS } from './workspace-gateway.js';

export const FEEDBACK_ERRORS = Object.freeze({
  unsupported: 'unsupported',
  rateLimited: 'rate_limited',
  duplicate: 'duplicate',
  tooManyOpen: 'too_many_open',
  invalid: 'invalid',
  notFound: 'feedback_not_found',
});

/** Mensajes propios de la base (raise exception '<mensaje>') → código. */
const RPC_MESSAGES = Object.freeze({
  rateos_feedback_rate_limited: FEEDBACK_ERRORS.rateLimited,
  rateos_feedback_duplicate: FEEDBACK_ERRORS.duplicate,
  rateos_feedback_too_many_open: FEEDBACK_ERRORS.tooManyOpen,
  rateos_feedback_invalid: FEEDBACK_ERRORS.invalid,
  rateos_feedback_not_found: FEEDBACK_ERRORS.notFound,
});

/** Código de un error de una RPC del feedback o de RATEOS ADMIN (sin exponer detalles). */
export function feedbackErrorCode(error) {
  if (!error) return null;
  const message = String(error.message || '');
  if (Object.prototype.hasOwnProperty.call(RPC_MESSAGES, message)) return RPC_MESSAGES[message];
  // PostgREST: la función no existe (la migración no está aplicada).
  if (error.code === 'PGRST202' || (Number(error.status) === 404 && /function|could not find/i.test(message))) return FEEDBACK_ERRORS.unsupported;
  return workspaceErrorCode(error) || WORKSPACE_ERRORS.unknown;
}

async function rpc(client, name, args) {
  try {
    const res = await client.rpc(name, args);
    if (res && res.error) return { ok: false, code: feedbackErrorCode({ ...res.error, status: res.status }), data: null };
    return { ok: true, code: null, data: res ? res.data : null };
  } catch (error) {
    return { ok: false, code: feedbackErrorCode(error) || WORKSPACE_ERRORS.unknown, data: null };
  }
}

const FEEDBACK_FIELDS = Object.freeze(['id', 'created_at', 'kind', 'category', 'screen', 'app_version', 'message', 'details', 'expected', 'status', 'response', 'reviewed_at', 'mine']);

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
export function createFeedbackGateway(client) {
  if (!client || typeof client.rpc !== 'function') throw new Error('Cliente de Supabase inválido.');
  return {
    /** Envía un problema o una sugerencia (sólo texto y claves de listas fijas). */
    async submit(organizationId, { kind, category, message, details, expected, screen, appVersion }) {
      const res = await rpc(client, 'submit_feedback', {
        p_org: organizationId,
        p_kind: kind,
        p_category: category,
        p_message: message,
        p_details: details ?? null,
        p_expected: expected ?? null,
        p_screen: screen,
        p_app_version: appVersion,
      });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, feedback: pick(res.data, ['id', 'kind', 'status', 'created_at']) };
    },

    /** Comentarios de la empresa propia. */
    async mine(organizationId) {
      const res = await rpc(client, 'my_feedback', { p_org: organizationId });
      if (!res.ok) return { ok: false, code: res.code };
      return { ok: true, code: null, items: Array.isArray(res.data) ? res.data.map((r) => pick(r, FEEDBACK_FIELDS)) : [] };
    },
  };
}
