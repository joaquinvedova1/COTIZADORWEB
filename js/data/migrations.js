/**
 * Migraciones explícitas de esquema.
 *
 * Reglas:
 * - Cada migración transforma la versión N en la N+1 sin perder datos.
 * - Nunca se borran datos porque cambió la estructura.
 * - Antes de migrar, el repositorio guarda una copia del estado original
 *   (clave de recuperación) en localStorage.
 * - Si los datos son de una versión MÁS NUEVA que la app, no se tocan.
 *
 * Para agregar una versión nueva:
 *   1. Subir SCHEMA_VERSION en js/config.js.
 *   2. Agregar migrateV{N}ToV{N+1} y registrarla en MIGRATIONS.
 *   3. Agregar tests en tests/data/migrations.test.js.
 */

import { CURRENT_SCHEMA_VERSION, detectSchemaVersion, normalizeState, createEmptyState } from './schema.js';
import { isPlainObject, deepClone } from '../core/object.js';
import { createId } from '../core/ids.js';
import { emptyBillingTaxes } from '../domain/billing-taxes.js';

export class MigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
  }
}

/**
 * v0 → v1. "v0" representa datos sin schemaVersion (formato legado o
 * exportaciones parciales). Se conservan todas las colecciones reconocidas
 * y se guarda cualquier clave desconocida en `legacy` para no perderla.
 */
export function migrateV0ToV1(state, { now = new Date().toISOString(), idFactory = createId } = {}) {
  const src = isPlainObject(state) ? deepClone(state) : {};
  const base = createEmptyState();
  const orgId = isPlainObject(src.organization) && typeof src.organization.id === 'string' ? src.organization.id : idFactory();
  const organization = isPlainObject(src.organization)
    ? { ...src.organization, id: orgId }
    : { id: orgId, name: 'Mi empresa', createdAt: now, updatedAt: now, createdBy: null, updatedBy: null };

  const known = new Set(['schemaVersion', 'organization', 'resources', 'services', 'quotes', 'settings']);
  const legacy = {};
  Object.keys(src).forEach((k) => {
    if (!known.has(k)) legacy[k] = src[k];
  });

  const withOrg = (list) => {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
      .filter(isPlainObject)
      .map((item) => {
        let id = typeof item.id === 'string' && item.id ? item.id : idFactory();
        // Ids duplicados en datos legados: se conservan ambos registros, el repetido con id nuevo.
        while (seen.has(id)) id = idFactory();
        seen.add(id);
        return {
          ...item,
          id,
          organizationId: item.organizationId ?? orgId,
          createdAt: item.createdAt ?? now,
          updatedAt: item.updatedAt ?? now,
        };
      });
  };

  const resources = isPlainObject(src.resources) ? src.resources : {};
  // Colecciones de recursos desconocidas: se guardan en legacy para no perderlas.
  const unknownResourceTypes = Object.keys(resources).filter((t) => !Object.hasOwn(base.resources, t));
  if (unknownResourceTypes.length > 0) {
    legacy.resources = Object.fromEntries(unknownResourceTypes.map((t) => [t, resources[t]]));
  }
  const out = {
    ...base,
    schemaVersion: 1,
    organization,
    resources: Object.fromEntries(Object.keys(base.resources).map((t) => [t, withOrg(resources[t])])),
    services: withOrg(src.services).map((s) => ({ ...s, name: typeof s.name === 'string' ? s.name : 'Servicio' })),
    quotes: withOrg(src.quotes).map((q) => ({ ...q, name: typeof q.name === 'string' ? q.name : 'Cotización' })),
    settings: isPlainObject(src.settings) ? src.settings : {},
  };
  if (Object.keys(legacy).length > 0) out.legacy = legacy;
  return out;
}

/**
 * v1 → v2 (PLAN-2026-002). Impuestos sobre la facturación y convención de IVA:
 * - cada cotización recibe `vatTreatment: 'excluded'` (montos sin IVA: lo que
 *   RATEOS siempre calculó), explícito y no supuesto;
 * - cada cotización recibe `billingTaxes` SIN DEFINIR (nunca se inventan
 *   alícuotas): sus números no cambian (t = 0) y la interfaz avisa que la
 *   tarifa piso no incluye esos impuestos;
 * - `settings.defaultBillingTaxes` (valor de la empresa) arranca en null;
 * - un `billingTaxes` que no sea objeto (dato ajeno a v1) se guarda en
 *   `legacy.billingTaxes` de la cotización: no se pierde nada.
 */
export function migrateV1ToV2(state) {
  const src = isPlainObject(state) ? deepClone(state) : {};
  const quotes = (Array.isArray(src.quotes) ? src.quotes : []).map((q) => {
    if (!isPlainObject(q)) return q;
    // Convención de montos explícita: RATEOS siempre calculó sin IVA.
    const out = { ...q, vatTreatment: typeof q.vatTreatment === 'string' && q.vatTreatment ? q.vatTreatment : 'excluded' };
    if (isPlainObject(q.billingTaxes)) return out;
    out.billingTaxes = emptyBillingTaxes();
    if (q.billingTaxes !== undefined && q.billingTaxes !== null) out.legacy = withLegacy(q.legacy, 'billingTaxes', q.billingTaxes);
    return out;
  });
  const settings = isPlainObject(src.settings) ? { ...src.settings } : {};
  if (!Object.hasOwn(settings, 'defaultBillingTaxes')) settings.defaultBillingTaxes = null;
  const out = { ...src, schemaVersion: 2, quotes, settings };
  // Una configuración que no es objeto no se descarta: queda en legacy.
  if (src.settings !== undefined && src.settings !== null && !isPlainObject(src.settings)) out.legacy = withLegacy(src.legacy, 'settings', src.settings);
  return out;
}

/** Agrega un valor a `legacy` sin perder lo que ya hubiera (aunque no fuera un objeto). */
function withLegacy(legacy, key, value) {
  const base = isPlainObject(legacy) ? legacy : legacy === undefined || legacy === null ? {} : { previous: legacy };
  return { ...base, [key]: value };
}

/** Registro de migraciones: clave = versión de origen. */
export const MIGRATIONS = Object.freeze({
  0: migrateV0ToV1,
  1: migrateV1ToV2,
});

/**
 * Lleva un estado a la versión actual.
 * @returns {{ state: object, fromVersion: number, toVersion: number, applied: string[] }}
 * @throws {MigrationError}
 */
export function migrateState(state, { targetVersion = CURRENT_SCHEMA_VERSION, ...options } = {}) {
  const fromVersion = detectSchemaVersion(state);
  if (fromVersion === null) throw new MigrationError('Formato de datos no reconocido.', 'invalid');
  if (fromVersion > targetVersion) {
    throw new MigrationError(
      `Los datos son de una versión más nueva de RATEOS (esquema ${fromVersion}). Actualizá la aplicación.`,
      'newer_version',
    );
  }
  let current = deepClone(state);
  const applied = [];
  for (let v = fromVersion; v < targetVersion; v += 1) {
    const step = MIGRATIONS[v];
    if (typeof step !== 'function') throw new MigrationError(`Falta la migración ${v} → ${v + 1}.`, 'missing_migration');
    current = step(current, options);
    current.schemaVersion = v + 1;
    applied.push(`${v}→${v + 1}`);
  }
  return { state: normalizeState(current), fromVersion, toVersion: targetVersion, applied };
}
