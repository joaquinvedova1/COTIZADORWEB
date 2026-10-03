/**
 * Eventos internos de producto, desacoplados de cualquier herramienta
 * de analytics. HOY NO SE ENVÍA NADA A TERCEROS (FEATURES.analytics = false).
 *
 * Privacidad por diseño:
 * - Sólo se aceptan nombres de evento de una lista blanca.
 * - Sólo se aceptan propiedades de una lista blanca, con valores booleanos,
 *   enums cortos o contadores enteros pequeños.
 * - Nunca se aceptan montos, salarios, costos, tarifas, nombres de clientes
 *   ni textos libres.
 */

import { FEATURES } from '../config.js';

export const EVENT_NAMES = Object.freeze([
  'app_started',
  'quote_created',
  'quote_completed',
  'quote_duplicated',
  'quote_deleted',
  'scenario_changed',
  'break_even_viewed',
  'calculation_trace_opened',
  'backup_exported',
  'backup_imported',
  'resource_saved',
]);

const ALLOWED_PROPS = Object.freeze({
  serviceType: 'enum',
  pricingMode: 'enum',
  unit: 'enum',
  step: 'enum',
  traceId: 'enum',
  variable: 'enum',
  resourceType: 'enum',
  source: 'enum',
  completed: 'boolean',
  isDemo: 'boolean',
  count: 'smallInt',
});

// Sólo letras minúsculas y guion bajo: ningún enum legítimo tiene dígitos,
// así se bloquean montos o identificadores disfrazados de enum.
const ENUM_RE = /^[a-z][a-z_]{0,39}$/;

/** Filtra propiedades: descarta todo lo que no esté permitido. */
export function sanitizeEventProps(props = {}) {
  const clean = {};
  if (props === null || typeof props !== 'object') return clean;
  for (const [key, kind] of Object.entries(ALLOWED_PROPS)) {
    if (!Object.hasOwn(props, key)) continue;
    const v = props[key];
    if (kind === 'boolean' && typeof v === 'boolean') clean[key] = v;
    if (kind === 'enum' && typeof v === 'string' && ENUM_RE.test(v)) clean[key] = v;
    if (kind === 'smallInt' && Number.isInteger(v) && v >= 0 && v <= 10000) clean[key] = v;
  }
  return clean;
}

const sinks = new Set();

/**
 * Registra un destino de eventos (p. ej. un futuro adaptador PostHog).
 * Sólo recibe eventos si FEATURES.analytics está habilitado o si
 * `force` es true (tests / depuración local).
 */
export function addEventSink(sink, { force = false } = {}) {
  const entry = { sink, force };
  sinks.add(entry);
  return () => sinks.delete(entry);
}

/** Emite un evento interno. Ignora nombres desconocidos. */
export function track(name, props = {}) {
  if (!EVENT_NAMES.includes(name)) return false;
  const event = { name, props: sanitizeEventProps(props) };
  sinks.forEach(({ sink, force }) => {
    if (!FEATURES.analytics && !force) return;
    try {
      sink(event);
    } catch {
      /* nunca romper la app por analytics */
    }
  });
  return true;
}
