/**
 * Configuración central de RATEOS.
 *
 * Único lugar donde viven valores de configuración que se repiten en la app.
 * No contiene secretos: todo JavaScript frontend es público.
 */

export const APP_NAME = 'RATEOS';
export const APP_TAGLINE = 'Motor de costos y tarifas para servicios industriales';

/** Versión del esquema de datos persistidos (localStorage y backups JSON). */
export const SCHEMA_VERSION = 2;

/**
 * Modo de almacenamiento. Hoy sólo existe "local" (localStorage).
 * En el futuro podrá ser "supabase" sin tocar motores ni pantallas.
 */
export const STORAGE_MODE = 'local';

/** Claves de localStorage. Nunca se usa localStorage.clear(). */
export const STORAGE_KEYS = Object.freeze({
  state: 'rateos.state',
  recoveryPrefix: 'rateos.recovery.',
  uiPrefs: 'rateos.ui',
});

/**
 * Feature flags simples. Se habilitan módulos gradualmente.
 * Ninguna de estas banderas activa servicios externos hoy.
 */
export const FEATURES = Object.freeze({
  historicalComparison: false, // Estimado vs real (diseñado en docs/DATA_MODEL.md)
  supabase: false,
  multiOrganization: false,
  analytics: false, // Eventos internos desacoplados; sin envío a terceros.
  commercialModelComparator: true,
  scenarios: true,
});

export const LOCALE = 'es-AR';
export const CURRENCY = 'ARS';

/** Días que muestra la matriz tarifa × utilización. */
export const DEFAULT_MATRIX_DAYS = Object.freeze([5, 8, 10, 15, 20]);

/** Escalera de márgenes estándar (sobre precio de venta). */
export const DEFAULT_MARGIN_LADDER = Object.freeze([5, 10, 15]);

/** Tolerancia numérica usada por los motores para comparaciones. */
export const NUMERIC_EPSILON = 1e-9;

/** Límite de tamaño para importar backups (protege al navegador). */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

/** Escenarios pesimista / optimista por defecto (variaciones porcentuales). */
export const DEFAULT_SCENARIOS = Object.freeze({
  pessimistic: Object.freeze({ activityPct: -25, salariesPct: 10, fuelPct: 10, materialsPct: 10, paymentTermDays: 30 }),
  optimistic: Object.freeze({ activityPct: 25, salariesPct: -5, fuelPct: -5, materialsPct: -5, paymentTermDays: 0 }),
});

/** Rangos de los sliders de sensibilidad. */
export const SENSITIVITY_RANGES = Object.freeze({
  salariesPct: Object.freeze({ min: -30, max: 50, step: 1 }),
  fuelPct: Object.freeze({ min: -30, max: 50, step: 1 }),
  materialsPct: Object.freeze({ min: -30, max: 50, step: 1 }),
  activityPct: Object.freeze({ min: -50, max: 100, step: 5 }),
  paymentTermDays: Object.freeze({ min: -90, max: 120, step: 15 }),
  commercialDiscountPct: Object.freeze({ min: 0, max: 30, step: 1 }),
});

/**
 * Entorno. En GitHub Pages (u otro hosting) se considera producción.
 * Se usa sólo para decidir el nivel de logging.
 */
export function detectEnvironment(location = globalThis.location) {
  const host = location && typeof location.hostname === 'string' ? location.hostname : '';
  if (host === '' || host === 'localhost' || host === '127.0.0.1') return 'development';
  return 'production';
}
