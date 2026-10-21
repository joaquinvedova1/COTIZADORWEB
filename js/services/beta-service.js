/**
 * Beta con empresas testers (PLAN-2026-029): créditos de prueba y reportes de
 * errores, para las pantallas.
 *
 * La autoridad está en Postgres: el saldo que muestra este servicio es sólo
 * para avisar antes de crear. Aunque alguien lo cambie desde DevTools, la base
 * cobra al guardar y rechaza un cálculo nuevo sin saldo. Los premios por
 * reportes los aprueba RATEOS ADMIN; nada de acá los otorga.
 *
 * En la demo y en el modo local no hay créditos ni reportes (enabled: false).
 */

import { WORKSPACE_ERRORS } from '../data/workspace-gateway.js';
import { BETA_ERRORS } from '../data/beta-gateway.js';
import { CREDITS_EXHAUSTED_MESSAGE } from '../data/supabase-repository.js';
import { bugCategoryLabel, bugScreenLabel, bugStatus, validateBugReport } from '../domain/bug-report.js';

export { CREDITS_EXHAUSTED_MESSAGE };

/** Sin cuota: nada que mostrar ni bloquear. */
const NO_CREDITS = Object.freeze({ enabled: false });

/** ¿El error es el rechazo de la base por falta de créditos? */
export function isCreditsExhausted(error) {
  return Boolean(error) && error.code === WORKSPACE_ERRORS.creditsExhausted;
}

/**
 * Texto del saldo para las pantallas de creación.
 * @param {{ enabled: boolean, balance?: number, initial?: number, rewarded?: number, reportReward?: number }} credits
 * @returns {{ tone: 'info'|'warning', title: string, text: string }|null}
 */
export function creditsNotice(credits) {
  if (!credits || credits.enabled !== true) return null;
  const n = credits.balance;
  if (n <= 0) {
    return { tone: 'warning', title: 'Sin cálculos de prueba', text: CREDITS_EXHAUSTED_MESSAGE };
  }
  const reward = credits.reportReward > 0 ? ` Si nos reportás un error y lo confirmamos, te sumamos ${credits.reportReward}.` : '';
  return {
    tone: 'info',
    title: n === 1 ? 'Te queda 1 cálculo nuevo de prueba' : `Te quedan ${n} cálculos nuevos de prueba`,
    text: `Crear una cotización, un producto o un duplicado usa 1. Editar, recalcular, guardar o exportar lo que ya tenés no usa ninguno.${reward}`,
  };
}

/**
 * @param {{ gateway?: ReturnType<import('../data/beta-gateway.js').createBetaGateway>|null, organizationId?: string|null }} options
 */
export function createCreditsService({ gateway = null, organizationId = null } = {}) {
  let cache = null;
  let supported = Boolean(gateway && organizationId);
  return {
    /** Saldo de la empresa. Ante cualquier error, el último conocido (o sin cuota). */
    async status({ refresh = false } = {}) {
      if (!supported) return NO_CREDITS;
      if (cache && !refresh) return cache;
      let res;
      try {
        res = await gateway.credits(organizationId);
      } catch {
        res = { ok: false, code: WORKSPACE_ERRORS.unknown };
      }
      if (!res.ok) {
        if (res.code === BETA_ERRORS.unsupported) supported = false;
        return cache || NO_CREDITS;
      }
      cache = res.credits;
      return cache;
    },

    /** Último saldo conocido (sin consultar). */
    cached() {
      return cache || NO_CREDITS;
    },

    /** ¿Se puede intentar crear un cálculo nuevo? Sólo para avisar: decide la base. */
    canCreate() {
      return !(cache && cache.enabled === true && cache.balance <= 0);
    },

    /**
     * Cuántos cálculos nuevos cobraría un respaldo o una importación.
     * @returns {Promise<{ enabled: boolean, balance?: number, chargeable: number }>}
     */
    async preview({ quoteIds = [], productIds = [] } = {}) {
      if (!supported) return { enabled: false, chargeable: 0 };
      try {
        const res = await gateway.preview(organizationId, { quoteIds, productIds });
        return res.ok ? { enabled: res.enabled, balance: res.balance, chargeable: res.chargeable } : { enabled: false, chargeable: 0, unavailable: true };
      } catch {
        return { enabled: false, chargeable: 0, unavailable: true };
      }
    },

    exhaustedMessage: CREDITS_EXHAUSTED_MESSAGE,
  };
}

const REPORT_ERRORS = Object.freeze({
  [BETA_ERRORS.rateLimited]: 'Ya enviaste varios reportes en las últimas 24 horas. Probá más tarde, o sumá lo nuevo a un reporte que ya mandaste.',
  [BETA_ERRORS.duplicate]: 'Ya recibimos un reporte de tu empresa con el mismo texto.',
  [BETA_ERRORS.tooManyOpen]: 'Tu empresa tiene muchos reportes sin revisar. Esperá a que los revisemos antes de mandar otro.',
  [BETA_ERRORS.invalid]: 'Revisá los campos: falta alguno o es demasiado largo.',
  [BETA_ERRORS.unsupported]: 'Todavía no se pueden enviar reportes desde RATEOS.',
  [WORKSPACE_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y volvé a enviarlo: lo que escribiste sigue acá.',
  [WORKSPACE_ERRORS.sessionExpired]: 'Tu sesión terminó. Volvé a ingresar para enviar el reporte.',
  [WORKSPACE_ERRORS.forbidden]: 'Tu cuenta no puede enviar reportes para esta empresa.',
});

export function reportErrorMessage(code) {
  return REPORT_ERRORS[code] || 'No pudimos enviar el reporte. Probá de nuevo en unos minutos.';
}

/** Fila de "Mis reportes" con textos para personas. */
export function reportRow(r = {}) {
  const status = bugStatus(r.status);
  const credits = Number(r.credits_added) > 0 ? Math.trunc(Number(r.credits_added)) : 0;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    createdAt: r.created_at || null,
    category: bugCategoryLabel(r.category),
    screen: bugScreenLabel(r.screen),
    did: typeof r.did === 'string' ? r.did : '',
    expected: typeof r.expected === 'string' ? r.expected : '',
    happened: typeof r.happened === 'string' ? r.happened : '',
    status: typeof r.status === 'string' ? r.status : 'received',
    statusLabel: r.status === 'approved' && credits > 0 ? `${status.label} (+${credits})` : status.label,
    tone: status.tone,
    reviewNote: typeof r.review_note === 'string' && r.review_note.trim() ? r.review_note : null,
    reviewedAt: r.reviewed_at || null,
    mine: r.mine === true,
    creditsAdded: credits,
  };
}

/**
 * @param {{ gateway?: ReturnType<import('../data/beta-gateway.js').createBetaGateway>|null, organizationId?: string|null, appVersion?: string }} options
 */
export function createBugReportService({ gateway = null, organizationId = null, appVersion = 'dev' } = {}) {
  const supported = Boolean(gateway && organizationId);
  const version = /^[0-9A-Za-z.+-]{1,40}$/.test(String(appVersion)) ? String(appVersion) : 'dev';
  return {
    supported,
    appVersion: version,

    /**
     * Envía un reporte. Valida antes (la base vuelve a validar).
     * @returns {Promise<{ ok: true, report: object }|{ ok: false, code: string, message: string, errors?: Record<string, string> }>}
     */
    async submit(input) {
      if (!supported) return { ok: false, code: BETA_ERRORS.unsupported, message: reportErrorMessage(BETA_ERRORS.unsupported) };
      const check = validateBugReport(input);
      if (!check.ok) return { ok: false, code: BETA_ERRORS.invalid, message: reportErrorMessage(BETA_ERRORS.invalid), errors: check.errors };
      let res;
      try {
        res = await gateway.submitReport(organizationId, { ...check.report, appVersion: version });
      } catch {
        res = { ok: false, code: WORKSPACE_ERRORS.unknown };
      }
      if (!res.ok) return { ok: false, code: res.code, message: reportErrorMessage(res.code) };
      return { ok: true, report: res.report };
    },

    /** Reportes de la empresa (más nuevos primero). */
    async list() {
      if (!supported) return { ok: false, code: BETA_ERRORS.unsupported, message: reportErrorMessage(BETA_ERRORS.unsupported), rows: [] };
      let res;
      try {
        res = await gateway.myReports(organizationId);
      } catch {
        res = { ok: false, code: WORKSPACE_ERRORS.unknown };
      }
      if (!res.ok) return { ok: false, code: res.code, message: res.code === BETA_ERRORS.unsupported ? reportErrorMessage(res.code) : 'No pudimos cargar tus reportes. Reintentá en unos minutos.', rows: [] };
      return { ok: true, rows: res.reports.map(reportRow) };
    },
  };
}
