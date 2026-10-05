/**
 * Configuración central de RATEOS.
 *
 * Único lugar donde viven valores de configuración que se repiten en la app.
 * No contiene secretos: todo JavaScript frontend es público.
 */

export const APP_NAME = 'RATEOS';
export const APP_TAGLINE = 'Motor de costos y tarifas para servicios industriales';

/** Versión del esquema de datos persistidos (localStorage y backups JSON). */
export const SCHEMA_VERSION = 3;

/**
 * Modo de almacenamiento por defecto de LocalStorageRepository. Con sesión,
 * los datos reales viven en Supabase (SupabaseRepository); "local" queda
 * para la demo (en memoria), los tests y la importación de datos viejos.
 */
export const STORAGE_MODE = 'local';

/**
 * Proyecto Supabase de RATEOS. SÓLO valores públicos por diseño: la URL y la
 * publishable key (la seguridad la da Row Level Security en Postgres).
 * NUNCA poner acá ni en ningún archivo del frontend: service_role,
 * sb_secret_…, la contraseña de la base, connection strings ni el JWT secret.
 */
export const SUPABASE = Object.freeze({
  url: 'https://dltlnizvnvnefgbzfftu.supabase.co',
  publishableKey: 'sb_publishable_0zN4iQ1quvW2kC8XScqNGw_ZQ1F6ztW',
});

/** URL pública del sitio (GitHub Pages). Base de los enlaces de los emails de Auth. */
export const PUBLIC_SITE_URL = 'https://joaquinvedova1.github.io/COTIZADORWEB/';

/** Claves de localStorage. Nunca se usa localStorage.clear(). */
export const STORAGE_KEYS = Object.freeze({
  /** Datos del modo local anterior (sin cuenta). Nunca se borran: se ofrecen para importar. */
  state: 'rateos.state',
  recoveryPrefix: 'rateos.recovery.',
  uiPrefs: 'rateos.ui',
  /** Sesión de Supabase Auth (la escribe el cliente oficial; nunca contiene contraseñas). */
  authSession: 'rateos.auth',
  /** Copia local recuperable del workspace en la nube: rateos.cloud.<usuario>.<organización>. */
  cloudCachePrefix: 'rateos.cloud.',
});

/**
 * Feature flags simples. Se habilitan módulos gradualmente.
 * Ninguna de estas banderas activa servicios externos hoy.
 */
export const FEATURES = Object.freeze({
  historicalComparison: false, // Estimado vs real (diseñado en docs/DATA_MODEL.md)
  supabase: true, // Cuentas reales (Supabase Auth) y datos en la nube con RLS.
  multiOrganization: false,
  analytics: false, // Eventos internos desacoplados; sin envío a terceros.
  commercialModelComparator: true,
  scenarios: true,
});

export const LOCALE = 'es-AR';
export const CURRENCY = 'ARS';

/**
 * Base económica (PLAN-2026-005): una base es "vieja" si tiene más de estos
 * meses respecto de la fecha de la oferta, y las bases de una cotización son
 * "muy distintas" si entre la más vieja y la más nueva hay más de estos meses.
 * Sólo generan advertencias (no bloquean).
 */
export const BASE_STALE_MONTHS = 6;
export const BASE_SPREAD_MONTHS = 3;

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
