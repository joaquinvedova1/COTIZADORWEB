/**
 * "Reportar un problema" (PLAN-2026-020): arma el reporte y lo envía.
 *
 * Privacidad (AGENTS.md §14): el reporte lleva SÓLO lo que la persona
 * escribe y contexto técnico (pantalla, paso, versión, build, navegador,
 * tamaño de ventana, idioma, cuenta o demo). Nunca montos, nombres de
 * clientes, recursos, ids internos ni el contenido del workspace: la ruta se
 * manda como PATRÓN (p. ej. "cotizaciones/:id/equipment"), no con el id real.
 *
 * Con sesión: se guarda en Supabase (private.bug_reports). Sin sesión
 * (sitio público y demo): se guarda igual en private.bug_reports por la
 * Edge Function bug-report-submit. Ningún reporte se publica solo en
 * GitHub (el repositorio es público): el dueño los ve y los sigue desde
 * #/admin. GitHub con el issue ya escrito queda sólo como plan B, y lo
 * manda la persona a mano.
 */

import { QUOTE_STEPS } from '../domain/catalogs.js';
import { FEEDBACK_ERRORS } from '../data/feedback-gateway.js';

export const REPORT_REPO_URL = 'https://github.com/joaquinvedova1/COTIZADORWEB';
export const REPORT_LABEL = 'reporte-app';
export const REPORT_TEMPLATE = 'reporte-app.yml';
export const MIN_WHAT_LENGTH = 5;
export const MAX_WHAT_LENGTH = 4000;
export const MAX_EXPECTED_LENGTH = 2000;

const SAFE_SEGMENT = /^[a-z][a-z0-9-]{0,39}$/;

const clean = (value, max) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

/** Nombre del paso de una cotización (p. ej. "Equipos"), o null. */
function stepLabel(step) {
  const found = QUOTE_STEPS.find((s) => s.id === step);
  return found ? found.label : null;
}

/**
 * Dónde está la persona, sin datos: título de la pantalla + paso, y la ruta
 * como patrón. `current` es lo que devuelve router.current().
 * @returns {{ label: string, route: string }}
 */
export function describeLocation(current) {
  const route = current && current.route ? current.route : null;
  if (!route) return { label: 'Pantalla desconocida', route: '' };
  const params = (current && current.params) || {};
  const segments = Array.isArray(route.segments) ? route.segments : [];
  const pattern = segments
    .map((seg) => {
      if (!String(seg).startsWith(':')) return seg;
      const key = String(seg).slice(1);
      const value = String(params[key] ?? '');
      // Pasos y pestañas son nombres fijos; los ids nunca salen.
      return key !== 'id' && SAFE_SEGMENT.test(value) ? value : seg;
    })
    .join('/');
  const title = route.name === 'landing' ? 'Página principal' : String(route.title || '').trim() || 'Pantalla sin título';
  const step = params.step && SAFE_SEGMENT.test(String(params.step)) ? stepLabel(params.step) || null : null;
  return { label: step ? `${title} › ${step}` : title, route: `/${pattern}`, step };
}

/**
 * Qué quiere contarnos la persona. Se elige primero y cambia las preguntas.
 * Los valores son los de private.bug_reports.kind.
 */
export const REPORT_KINDS = Object.freeze([
  { value: 'error', label: 'Algo no funciona', short: 'Error', what: '¿Qué pasó?', whatPlaceholder: 'Ej.: en Equipos toco «Siguiente» y no pasa nada.', expected: '¿Qué esperabas que pasara? (opcional)', expectedPlaceholder: 'Ej.: que me lleve al paso Materiales.' },
  { value: 'calculo', label: 'Un cálculo no me cierra', short: 'Cálculo', what: '¿Qué número te parece mal y dónde lo ves?', whatPlaceholder: 'Ej.: el costo del personal por día me da el doble de lo que calculo a mano.', expected: '¿Cuánto esperabas y cómo lo calculás? (opcional)', expectedPlaceholder: 'Ej.: 2 operarios × 9 h × valor hora; no hace falta poner precios reales.' },
  { value: 'texto', label: 'Un texto o campo confuso', short: 'Texto confuso', what: '¿Qué texto o campo no se entiende?', whatPlaceholder: 'Ej.: no sé qué poner en «Horas por mes en este servicio».', expected: '¿Cómo lo dirías vos? (opcional)', expectedPlaceholder: 'Ej.: «¿Cuántas horas por mes trabaja en este cliente?».' },
  { value: 'no_encuentro', label: 'No encuentro o no entiendo algo', short: 'No lo encuentro', what: '¿Qué querías hacer?', whatPlaceholder: 'Ej.: quiero cargar un alquiler de grúa y no sé en qué paso va.', expected: '¿Dónde lo buscaste? (opcional)', expectedPlaceholder: 'Ej.: lo busqué en Equipos y en Recursos.' },
  { value: 'sugerencia', label: 'Una sugerencia', short: 'Sugerencia', what: '¿Qué te gustaría que haga RATEOS?', whatPlaceholder: 'Ej.: poder copiar una cotización para otro cliente.', expected: '¿Para qué te serviría? (opcional)', expectedPlaceholder: 'Ej.: cotizo el mismo servicio a varias plantas.' },
]);
export const DEFAULT_KIND = 'error';

/** Definición del tipo (si no existe, la de "Algo no funciona"). */
export function reportKind(value) {
  return REPORT_KINDS.find((k) => k.value === value) || REPORT_KINDS[0];
}

export const STEP_OTHER = 'Fuera de una cotización';
export const STEP_GENERAL = 'En general / no sé';

/**
 * Opciones de "¿En qué paso fue?": los pasos de la cotización y dos más.
 * @returns {{ value: string, label: string }[]}
 */
export function stepOptions() {
  return [
    ...QUOTE_STEPS.map((s, i) => ({ value: s.label, label: `${i + 1}. ${s.label}` })),
    { value: STEP_OTHER, label: STEP_OTHER },
    { value: STEP_GENERAL, label: STEP_GENERAL },
  ];
}

/** Paso sugerido según dónde está la persona. */
export function defaultStep(location) {
  if (location && location.step && QUOTE_STEPS.some((s) => s.label === location.step)) return location.step;
  const route = String((location && location.route) || '');
  if (/^\/cotizaciones\/[^/]+$/.test(route) || route === '/cotizaciones/:id') return STEP_GENERAL;
  return route && route !== '/' && !route.startsWith('/demo') ? STEP_OTHER : STEP_GENERAL;
}

/**
 * Contexto técnico del navegador (sin huellas extra: nada de plugins,
 * zona horaria fina ni resolución de pantalla completa).
 */
export function technicalContext(env = globalThis) {
  const nav = env && env.navigator ? env.navigator : {};
  const width = Number(env && env.innerWidth);
  const height = Number(env && env.innerHeight);
  return {
    browser: clean(nav.userAgent, 400),
    viewport: Number.isFinite(width) && Number.isFinite(height) && width > 0 ? `${Math.round(width)}×${Math.round(height)}` : '',
    language: clean(nav.language, 20),
  };
}

/**
 * Payload para public.submit_bug_report (y para el issue prellenado).
 * @param {{ whatHappened: string, expected?: string, step?: string }} form
 * @param {{ location: { label: string, route: string }, version?: object, mode: 'cuenta'|'demo'|'publico', tech?: object }} ctx
 */
export function buildReportPayload(form, { location, version = {}, mode = 'cuenta', tech = {} } = {}) {
  const kind = reportKind(form && form.kind).value;
  return {
    kind,
    what_happened: clean(form && form.whatHappened, MAX_WHAT_LENGTH),
    expected: clean(form && form.expected, MAX_EXPECTED_LENGTH),
    where_label: clean(location && location.label, 200),
    step: clean(form && form.step, 80),
    route: clean(location && location.route, 200),
    app_version: clean(version.version, 40),
    app_commit: clean(version.commit, 64),
    browser: clean(tech.browser, 400),
    viewport: clean(tech.viewport, 40),
    context: { mode: ['cuenta', 'demo', 'publico'].includes(mode) ? mode : 'cuenta', language: clean(tech.language, 20), kind },
  };
}

/** Validación del formulario (mismo mínimo que la base). */
export function validateReport(form) {
  const what = clean(form && form.whatHappened, MAX_WHAT_LENGTH);
  if (what.length < MIN_WHAT_LENGTH) return { ok: false, message: 'Contanos en pocas palabras qué pasó (al menos 5 letras).' };
  return { ok: true, message: null };
}

/** Texto del informe (mismo formato que el issue que crea la base). */
export function reportText(payload) {
  const q = (t) => (t ? t.split('\n').map((l) => `> ${l}`).join('\n') : '> —');
  return [
    `### Tipo: ${reportKind(payload.kind).label}`,
    '',
    '### ¿Qué pasó?',
    q(payload.what_happened),
    '',
    '### ¿Qué esperaba que pasara?',
    q(payload.expected),
    '',
    '### Contexto técnico (automático)',
    `- Paso que eligió: ${payload.step || '—'}`,
    `- Dónde estaba: ${payload.where_label || '—'}`,
    `- Pantalla (ruta): ${payload.route || '—'}`,
    `- Versión: ${payload.app_version || '—'} · build ${payload.app_commit || '—'}`,
    `- Modo: ${payload.context && payload.context.mode ? payload.context.mode : '—'}`,
    `- Navegador: ${payload.browser || '—'}`,
    `- Ventana: ${payload.viewport || '—'} · idioma ${payload.context && payload.context.language ? payload.context.language : '—'}`,
  ].join('\n');
}

/** Título corto del issue. */
export function reportTitle(payload) {
  const first = String(payload.what_happened || '').split('\n')[0].replace(/\s+/g, ' ').trim();
  return `[Reporte] ${first.length > 70 ? `${first.slice(0, 67)}…` : first || 'Problema en la app'}`;
}

/**
 * URL de "nuevo issue" ya completo en GitHub (para quien no tiene sesión).
 * Se recorta para no pasar el límite de largo de una URL.
 */
export function githubIssueUrl(payload, { repoUrl = REPORT_REPO_URL } = {}) {
  // Con la plantilla (formulario) el label "reporte-app" se aplica aunque quien
  // reporta no tenga permisos en el repo; cada campo se completa por su id.
  const params = new URLSearchParams({
    template: REPORT_TEMPLATE,
    title: reportTitle(payload),
    'que-paso': String(payload.what_happened || '').slice(0, 3000),
    'que-esperabas': String(payload.expected || '').slice(0, 1500),
    donde: `${payload.step ? `${payload.step} · ` : ''}${payload.where_label || '—'} (${payload.route || '—'})`,
    version: `${payload.app_version || '—'} · build ${payload.app_commit || '—'} · ${payload.context && payload.context.mode ? payload.context.mode : '—'}`,
    navegador: `${payload.browser || '—'} · ${payload.viewport || '—'}`.slice(0, 450),
  });
  return `${repoUrl}/issues/new?${params.toString()}`;
}

const MESSAGES = Object.freeze({
  [FEEDBACK_ERRORS.rateLimited]: 'Ya mandaste varios reportes seguidos. Esperá unos minutos y probá de nuevo.',
  [FEEDBACK_ERRORS.invalid]: 'Contanos en pocas palabras qué pasó (al menos 5 letras).',
  [FEEDBACK_ERRORS.network]: 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo: lo que escribiste sigue acá.',
  [FEEDBACK_ERRORS.sessionExpired]: 'Tu sesión terminó. Podés enviarlo por GitHub acá abajo, o copiar lo que escribiste antes de volver a ingresar.',
  [FEEDBACK_ERRORS.forbidden]: 'Tu sesión terminó. Podés enviarlo por GitHub acá abajo, o copiar lo que escribiste antes de volver a ingresar.',
});

/** Mensajes del panel de reportes (admin). */
export function adminErrorMessage(code) {
  if (code === FEEDBACK_ERRORS.forbidden) return 'No tenés permisos para ver los reportes.';
  if (code === FEEDBACK_ERRORS.network) return 'No pudimos conectarnos. Revisá tu conexión y reintentá.';
  if (code === FEEDBACK_ERRORS.notReady) return 'Falta aplicar en Supabase la migración de seguimiento de reportes (20261123221818). Mientras tanto los reportes se guardan igual.';
  return 'No pudimos cargar o guardar los reportes. Reintentá en unos minutos.';
}

export function feedbackErrorMessage(code) {
  return MESSAGES[code] || 'No pudimos enviar el reporte. Probá de nuevo en unos minutos.';
}

/**
 * @param {ReturnType<import('../data/feedback-gateway.js').createFeedbackGateway>} gateway
 */
export function createFeedbackService(gateway) {
  return {
    /**
     * Envía el reporte. Con sesión va por la base (y al puente a GitHub);
     * sin sesión, por la Edge Function bug-report-submit. Ambos quedan en
     * private.bug_reports.
     */
    async submit(payload, { signedIn = true } = {}) {
      const check = validateReport({ whatHappened: payload && payload.what_happened });
      if (!check.ok) return { ok: false, message: check.message, reference: null };
      const res = signedIn || typeof gateway.submitPublic !== 'function' ? await gateway.submit(payload) : await gateway.submitPublic(payload);
      if (!res.ok) return { ok: false, message: feedbackErrorMessage(res.code), reference: null, rateLimited: res.code === FEEDBACK_ERRORS.rateLimited };
      return { ok: true, message: null, reference: res.reference };
    },
    /** Reportes recibidos (sólo RATEOS_ADMIN). */
    async listForAdmin() {
      const res = await gateway.listForAdmin();
      if (!res.ok) return { ok: false, code: res.code, message: adminErrorMessage(res.code), reports: [] };
      return { ok: true, code: null, message: null, reports: res.reports };
    },
    /** Seguimiento de un reporte desde el panel (sólo RATEOS_ADMIN). */
    async updateForAdmin(id, changes) {
      if (typeof gateway.updateForAdmin !== 'function') return { ok: false, message: adminErrorMessage(FEEDBACK_ERRORS.unknown), report: null };
      const res = await gateway.updateForAdmin(id, changes);
      if (!res.ok) return { ok: false, code: res.code, message: adminErrorMessage(res.code), report: null };
      return { ok: true, code: null, message: null, report: res.report };
    },
  };
}
