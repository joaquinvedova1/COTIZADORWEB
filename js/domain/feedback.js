/**
 * Feedback de la beta (PLAN-2026-029): "Encontré un problema" y "Tengo una
 * sugerencia". Listas fijas, estados y validación.
 *
 * Un comentario es SÓLO texto de la persona, dos claves de listas fijas
 * (categoría y pantalla) y la versión de la app. Nunca lleva costos,
 * cotizaciones, ids, sesión, tokens ni capturas. La base vuelve a validar
 * todo (private.submit_feedback); esto es para avisar antes de enviar.
 * No hay premios, créditos ni cupos: ningún estado suma ni descuenta nada.
 */

export const FEEDBACK_TEXT_MIN = 3;
export const FEEDBACK_TEXT_MAX = 2000;

export const FEEDBACK_KINDS = Object.freeze([
  { id: 'problem', label: 'Encontré un problema', hint: 'Algo no funcionó, un número no cierra o no se entiende.' },
  { id: 'suggestion', label: 'Tengo una sugerencia', hint: 'Algo que te ahorraría tiempo o se podría explicar mejor.' },
]);

/** Pedido de la URL (?tipo=problema|sugerencia) → tipo. */
export function feedbackKindFromParam(value) {
  return value === 'sugerencia' || value === 'suggestion' ? 'suggestion' : 'problem';
}
export const feedbackKindParam = (kind) => (kind === 'suggestion' ? 'sugerencia' : 'problema');

export const FEEDBACK_CATEGORIES = Object.freeze([
  { id: 'calculo', label: 'Un cálculo o un resultado' },
  { id: 'guardado', label: 'Guardar, abrir o sincronizar mis datos' },
  { id: 'pdf', label: 'El PDF o la exportación' },
  { id: 'cuenta', label: 'Registro, ingreso o mi cuenta' },
  { id: 'pantalla', label: 'Pantallas, botones o el celular' },
  { id: 'otro', label: 'Otra cosa' },
]);

export const FEEDBACK_SCREENS = Object.freeze([
  { id: 'inicio', label: 'Inicio' },
  { id: 'nuevo', label: 'Nuevo cálculo' },
  { id: 'cotizaciones', label: 'Lista de cotizaciones' },
  { id: 'cotizacion', label: 'Editor de una cotización' },
  { id: 'resultado', label: 'Resultado de una cotización' },
  { id: 'escenarios', label: 'Escenarios' },
  { id: 'productos', label: 'Lista de productos' },
  { id: 'producto', label: 'Un producto (pasos o resultado)' },
  { id: 'recursos', label: 'Recursos' },
  { id: 'plantillas', label: 'Servicios (plantillas)' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'cuenta', label: 'Mi cuenta' },
  { id: 'registro', label: 'Registro o ingreso' },
  { id: 'pdf', label: 'El PDF' },
  { id: 'otra', label: 'Otra pantalla o en general' },
]);

/**
 * Estados de un comentario, con el texto que ve la empresa. "Confirmado" en
 * un problema es un error real de RATEOS; "Resuelto", que la corrección ya
 * está publicada. En una sugerencia se lee como algo que tomamos en cuenta o
 * que ya está disponible. Ninguno implica un premio.
 */
const STATUS = Object.freeze({
  received: { tone: 'gray', problem: 'Recibido', suggestion: 'Recibida' },
  in_review: { tone: 'blue', problem: 'En revisión', suggestion: 'En revisión' },
  confirmed: { tone: 'orange', problem: 'Confirmado', suggestion: 'La tenemos en cuenta' },
  resolved: { tone: 'green', problem: 'Resuelto', suggestion: 'Ya está disponible' },
  not_applicable: { tone: 'gray', problem: 'No corresponde', suggestion: 'No corresponde' },
  duplicate: { tone: 'gray', problem: 'Duplicado', suggestion: 'Duplicada' },
});
export const FEEDBACK_STATUS_IDS = Object.freeze(Object.keys(STATUS));
/** Estados que RATEOS ADMIN puede elegir (Recibido es sólo el inicial). */
export const FEEDBACK_REVIEW_STATUSES = Object.freeze(['in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate']);

export function feedbackStatus(status, kind = 'problem') {
  const s = STATUS[status] || STATUS.received;
  return { label: kind === 'suggestion' ? s.suggestion : s.problem, tone: s.tone };
}

const labelOf = (list, id, fallback) => (list.find((x) => x.id === id) || { label: fallback }).label;
export const feedbackKindLabel = (id) => (id === 'suggestion' ? 'Sugerencia' : 'Problema');
export const feedbackCategoryLabel = (id) => labelOf(FEEDBACK_CATEGORIES, id, 'Otra cosa');
export const feedbackScreenLabel = (id) => labelOf(FEEDBACK_SCREENS, id, 'Otra pantalla o en general');

/**
 * Pantalla de la lista fija a partir del hash actual, sin ids ni parámetros
 * (#/cotizaciones/<id>/resultado → "resultado").
 */
export function feedbackScreenFromHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (!first) return 'otra';
  if (first === 'inicio' || first === 'dashboard') return 'inicio';
  if (first === 'nuevo') return 'nuevo';
  if (first === 'cotizaciones') {
    if (!second) return 'cotizaciones';
    if (second === 'nueva') return 'nuevo';
    return third === 'result' || third === 'resultado' ? 'resultado' : 'cotizacion';
  }
  if (first === 'productos') {
    if (!second) return 'productos';
    return second === 'nuevo' ? 'nuevo' : 'producto';
  }
  if (first === 'recursos' || first === 'biblioteca') return 'recursos';
  if (first === 'servicios') return 'plantillas';
  if (first === 'escenarios') return 'escenarios';
  if (first === 'configuracion') return second === 'cuenta' ? 'cuenta' : 'configuracion';
  if (first === 'login' || first === 'registro' || first === 'recuperar-contrasena') return 'registro';
  return 'otra';
}

/**
 * Texto de una persona: sin caracteres de control (salvo salto de línea y tabulación), sin los
 * invisibles que disfrazan un texto (ancho cero, marcas y controles de dirección, BOM) y sin
 * espacios en los extremos. Igual que private.clean_feedback_text en la base.
 */
export function cleanFeedbackText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g, '').trim();
}

/**
 * @param {{ kind?: string, category?: string, message?: string, details?: string, expected?: string, screen?: string }} input
 * @returns {{ ok: boolean, errors: Record<string, string>, feedback: { kind: string, category: string, message: string, details: string|null, expected: string|null, screen: string } }}
 */
export function validateFeedback(input = {}) {
  const kind = input.kind === 'suggestion' ? 'suggestion' : 'problem';
  const optional = (value) => {
    const text = cleanFeedbackText(value);
    return text ? text : null;
  };
  const feedback = {
    kind,
    category: FEEDBACK_CATEGORIES.some((c) => c.id === input.category) ? input.category : 'otro',
    message: cleanFeedbackText(input.message),
    details: optional(input.details),
    // "Qué esperabas" sólo en un problema.
    expected: kind === 'problem' ? optional(input.expected) : null,
    screen: FEEDBACK_SCREENS.some((s) => s.id === input.screen) ? input.screen : 'otra',
  };
  const errors = {};
  const n = feedback.message.length;
  if (n < FEEDBACK_TEXT_MIN) errors.message = kind === 'suggestion' ? `Contanos tu idea (al menos ${FEEDBACK_TEXT_MIN} letras).` : `Contanos qué pasó (al menos ${FEEDBACK_TEXT_MIN} letras).`;
  else if (n > FEEDBACK_TEXT_MAX) errors.message = `Hasta ${FEEDBACK_TEXT_MAX} caracteres (tiene ${n}).`;
  ['details', 'expected'].forEach((field) => {
    const len = feedback[field] ? feedback[field].length : 0;
    if (len > FEEDBACK_TEXT_MAX) errors[field] = `Hasta ${FEEDBACK_TEXT_MAX} caracteres (tiene ${len}).`;
  });
  return { ok: Object.keys(errors).length === 0, errors, feedback };
}
