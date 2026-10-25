/**
 * Riesgo de una cotización fuera del Resultado y regla de "Enviada" (ECO-02).
 *
 * El motor de completitud ya marca los pendientes con los que el resultado
 * NO ES CONFIABLE (ECO-01: doble abono, "por salida" sin confirmar, puesto sin
 * sueldo) y los críticos (cambian el costo o el precio). Acá sólo se proyectan
 * para las listas, Inicio, Escenarios y la regla de estado: nada de esto cambia
 * un número.
 *
 * Regla de "Enviada": una cotización pasa a Enviada (o a Ganada sin haber
 * estado enviada) sólo con un resultado confiable y sin pendientes críticos.
 * Con un resultado NO CONFIABLE, con pendientes críticos (cambian el costo o el
 * precio) o si no se pudo calcular, no se puede: primero hay que resolver lo que
 * lo causa (VALIDACIONES-01, V-5: beta abierta, decisión del dueño del
 * 2026-10-25; antes los críticos se podían mandar confirmando).
 * La aplican las pantallas (con su aviso) y QuoteService.saveQuote (ECO-02 R1);
 * es una regla de esta app, no del servidor: ver docs/CALCULATION_RULES.md.
 */

/** Estados que suponen mandarla al cliente. */
const SENDING_STATUSES = Object.freeze(['sent', 'won']);
/** Estados desde los que la cotización ya se mandó (Perdida → Ganada corrige un hecho, no la manda de nuevo). */
const ALREADY_SENT_STATUSES = Object.freeze(['sent', 'won', 'lost']);

const labelsOf = (items) => items.map((i) => (typeof i.label === 'string' && i.label.trim() ? i.label.trim() : 'Pendiente'));
const pendingOf = (completeness) => (completeness && Array.isArray(completeness.pending) ? completeness.pending.filter((i) => i && typeof i === 'object') : []);

/**
 * Pendientes de la completitud que vuelven NO CONFIABLE el resultado (ECO-01): única definición, la usan
 * el Resultado (`unreliableItems` de result-text.js), las listas y la regla de "Enviada".
 * @param {object|null} completeness  `computeQuote().completeness`
 */
export function unreliablePending(completeness) {
  return pendingOf(completeness).filter((i) => i.unreliable === true);
}

/**
 * Riesgo del resultado a partir de la completitud del motor: si es NO
 * CONFIABLE y los rótulos de lo que lo causa, y los rótulos de los demás
 * pendientes críticos.
 * @param {object|null} completeness  `computeQuote().completeness`
 * @returns {{ unreliable: boolean, unreliableLabels: string[], criticalLabels: string[] }}
 */
export function riskSummary(completeness) {
  const unreliable = unreliablePending(completeness);
  const critical = pendingOf(completeness).filter((i) => i.severity === 'critical' && i.unreliable !== true);
  return { unreliable: unreliable.length > 0, unreliableLabels: labelsOf(unreliable), criticalLabels: labelsOf(critical) };
}

/**
 * Pendientes críticos del resumen de una cotización (`summarizeQuote`), contando los que la vuelven NO CONFIABLE
 * (que `criticalLabels` deja aparte). Es lo que decide que "Costos cargados" nunca vaya en verde (UI-02).
 */
export function summaryCriticalCount(summary) {
  if (!summary || typeof summary !== 'object') return 0;
  const n = (list) => (Array.isArray(list) ? list.length : 0);
  return n(summary.criticalLabels) + n(summary.unreliableLabels);
}

/** true si el resumen de una cotización (`summarizeQuote`) dice que su resultado NO ES CONFIABLE (no cuenta un error de cálculo). */
export function isUnreliableSummary(summary) {
  return Boolean(summary) && typeof summary === 'object' && summary.error !== true && summary.unreliable === true;
}

/** true si el estado supone que la cotización se mandó al cliente (Enviada o Ganada). */
export function isSendingStatus(status) {
  return SENDING_STATUSES.includes(status);
}

/**
 * true si pasar de `from` a `to` supone mandarla al cliente por primera vez: a Enviada, o a Ganada, desde
 * un estado en el que todavía no se mandó (Borrador, Archivada o sin estado). Perdida → Ganada no cuenta:
 * registra un hecho (el cliente la aceptó después), no autoriza a mandar una propuesta nueva; si hoy es NO
 * CONFIABLE, el Resultado lo sigue avisando ("resolvé lo pendiente antes de volver a mandarla").
 */
export function impliesSending(from, to) {
  return isSendingStatus(to) && !ALREADY_SENT_STATUSES.includes(from);
}

/**
 * ¿Se puede marcar como enviada? A partir del resumen de la lista
 * (`summarizeQuote`) o de `riskSummary()`; null o `{ error: true }` = no se
 * pudo calcular.
 * @returns {{ allowed: boolean, confirm: boolean, reason: 'failed'|'unreliable'|'critical'|null, items: string[] }}
 */
export function sendCheck(summary) {
  if (!summary || typeof summary !== 'object' || summary.error === true) return { allowed: false, confirm: false, reason: 'failed', items: [] };
  const unreliable = Array.isArray(summary.unreliableLabels) ? summary.unreliableLabels.filter((x) => typeof x === 'string') : [];
  if (summary.unreliable === true || unreliable.length) return { allowed: false, confirm: false, reason: 'unreliable', items: unreliable };
  const critical = Array.isArray(summary.criticalLabels) ? summary.criticalLabels.filter((x) => typeof x === 'string') : [];
  if (critical.length) return { allowed: false, confirm: false, reason: 'critical', items: critical };
  return { allowed: true, confirm: false, reason: null, items: [] };
}
