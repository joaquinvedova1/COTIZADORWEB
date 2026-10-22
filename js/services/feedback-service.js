/**
 * Feedback de la beta (PLAN-2026-029), para las pantallas: enviar un problema
 * o una sugerencia y seguir su estado.
 *
 * La autoridad está en Postgres (valida y limita el spam). En la demo y en el
 * modo local no hay feedback (supported: false): se envía desde una cuenta.
 */

import { WORKSPACE_ERRORS } from '../data/workspace-gateway.js';
import { FEEDBACK_ERRORS } from '../data/feedback-gateway.js';
import { feedbackCategoryLabel, feedbackKindLabel, feedbackScreenLabel, feedbackStatus, validateFeedback } from '../domain/feedback.js';

/** Mensaje de agradecimiento después de enviar (igual para los dos tipos). */
export const FEEDBACK_THANKS = 'Gracias por ayudarnos a mejorar RATEOS. Recibimos tu comentario y vas a poder seguir su estado acá abajo.';

const SUBMIT_ERRORS = Object.freeze({
  [FEEDBACK_ERRORS.rateLimited]: 'Ya enviaste varios comentarios en las últimas 24 horas. Probá más tarde; lo que escribiste sigue acá.',
  [FEEDBACK_ERRORS.duplicate]: 'Ya recibimos un comentario de tu empresa con el mismo texto.',
  [FEEDBACK_ERRORS.tooManyOpen]: 'Tu empresa tiene muchos comentarios sin revisar. Esperá a que los revisemos antes de mandar otro.',
  [FEEDBACK_ERRORS.invalid]: 'Revisá los campos: falta alguno o es demasiado largo.',
  [FEEDBACK_ERRORS.unsupported]: 'Todavía no se pueden enviar comentarios desde RATEOS.',
  [WORKSPACE_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y volvé a enviarlo: lo que escribiste sigue acá.',
  [WORKSPACE_ERRORS.sessionExpired]: 'Tu sesión terminó. Volvé a ingresar para enviarlo.',
  [WORKSPACE_ERRORS.forbidden]: 'Tu cuenta no puede enviar comentarios para esta empresa.',
});

export function feedbackErrorMessage(code) {
  return SUBMIT_ERRORS[code] || 'No pudimos enviarlo. Probá de nuevo en unos minutos.';
}

const text = (value) => (typeof value === 'string' ? value : '');

/** Fila de "Comentarios de tu empresa" con textos para personas. */
export function feedbackRow(r = {}) {
  const kind = r.kind === 'suggestion' ? 'suggestion' : 'problem';
  const status = feedbackStatus(r.status, kind);
  return {
    id: text(r.id),
    createdAt: r.created_at || null,
    kind,
    kindLabel: feedbackKindLabel(kind),
    category: feedbackCategoryLabel(r.category),
    screen: feedbackScreenLabel(r.screen),
    message: text(r.message),
    details: text(r.details),
    expected: text(r.expected),
    status: typeof r.status === 'string' ? r.status : 'received',
    statusLabel: status.label,
    tone: status.tone,
    response: typeof r.response === 'string' && r.response.trim() ? r.response : null,
    reviewedAt: r.reviewed_at || null,
    mine: r.mine === true,
  };
}

/**
 * @param {{ gateway?: ReturnType<import('../data/feedback-gateway.js').createFeedbackGateway>|null, organizationId?: string|null, appVersion?: string }} options
 */
export function createFeedbackService({ gateway = null, organizationId = null, appVersion = 'dev' } = {}) {
  const supported = Boolean(gateway && organizationId);
  const version = /^[0-9A-Za-z.+-]{1,40}$/.test(String(appVersion)) ? String(appVersion) : 'dev';
  return {
    supported,
    appVersion: version,

    /**
     * Envía un problema o una sugerencia. Valida antes (la base vuelve a validar).
     * @returns {Promise<{ ok: true, feedback: object }|{ ok: false, code: string, message: string, errors?: Record<string, string> }>}
     */
    async submit(input) {
      if (!supported) return { ok: false, code: FEEDBACK_ERRORS.unsupported, message: feedbackErrorMessage(FEEDBACK_ERRORS.unsupported) };
      const check = validateFeedback(input);
      if (!check.ok) return { ok: false, code: FEEDBACK_ERRORS.invalid, message: feedbackErrorMessage(FEEDBACK_ERRORS.invalid), errors: check.errors };
      let res;
      try {
        res = await gateway.submit(organizationId, { ...check.feedback, appVersion: version });
      } catch {
        res = { ok: false, code: WORKSPACE_ERRORS.unknown };
      }
      if (!res.ok) return { ok: false, code: res.code, message: feedbackErrorMessage(res.code) };
      return { ok: true, feedback: res.feedback };
    },

    /** Comentarios de la empresa (más nuevos primero). */
    async list() {
      if (!supported) return { ok: false, code: FEEDBACK_ERRORS.unsupported, message: feedbackErrorMessage(FEEDBACK_ERRORS.unsupported), rows: [] };
      let res;
      try {
        res = await gateway.mine(organizationId);
      } catch {
        res = { ok: false, code: WORKSPACE_ERRORS.unknown };
      }
      if (!res.ok) return { ok: false, code: res.code, message: res.code === FEEDBACK_ERRORS.unsupported ? feedbackErrorMessage(res.code) : 'No pudimos cargar los comentarios. Reintentá en unos minutos.', rows: [] };
      return { ok: true, rows: res.items.map(feedbackRow) };
    },
  };
}
