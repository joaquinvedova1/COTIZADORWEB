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
import { CURRENCY } from '../config.js';
import { emptyBase, normalizeBase, dayFromDate, isKnownCurrency } from '../domain/economic-base.js';
import { familyIdOf } from '../domain/equipment-catalog.js';
import { legacySnapshot } from '../domain/resource-snapshot.js';
import { acquisitionOf, createExternalTerms, createMobilization, createEquipmentMobility, normalizeExchangeRates } from '../domain/quote-factory.js';

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

/**
 * v2 → v3 (PLAN-2026-005). Base económica, snapshots, equipos propios /
 * externos y movilización. NADA se inventa y NINGÚN número cambia:
 * - todo valor económico recibe `base` SIN período ("Base no definida": no se
 *   supone que un valor viejo es de hoy) y la moneda de la empresa (la
 *   convención vigente: RATEOS siempre calculó en una sola moneda);
 * - los equipos de "Mis equipos" pasan a tener familia (desde su tipo),
 *   obtención "propio" (lo único que RATEOS modelaba) y movilidad sin definir;
 * - cada cotización recibe moneda, fecha de la oferta (su fecha de creación)
 *   y tipos de cambio vacíos; el combustible, base sin definir;
 * - cada línea que venía de Recursos recibe un snapshot "anterior" (legacy)
 *   con los valores que ya usaba; los equipos, movilización SIN DEFINIR (los
 *   traslados siguen en los vehículos de viaje, como antes: sin doble conteo);
 * - colecciones nuevas vacías: modelos de equipos y servicios externos.
 */
export function migrateV2ToV3(state) {
  const src = isPlainObject(state) ? deepClone(state) : {};
  const settings = isPlainObject(src.settings) ? { ...src.settings } : {};
  const currency = isKnownCurrency(settings.currency) ? settings.currency : CURRENCY;
  const base = (b, { forceCurrency = false } = {}) => {
    const out = normalizeBase(b, { currency });
    return forceCurrency ? { ...out, currency } : out;
  };

  const resources = isPlainObject(src.resources) ? { ...src.resources } : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  resources.laborProfiles = list(resources.laborProfiles).map((p) => (isPlainObject(p) ? { ...p, base: base(p.base, { forceCurrency: true }) } : p));
  resources.materials = list(resources.materials).map((m) => (isPlainObject(m) ? { ...m, base: base(m.base) } : m));
  resources.equipment = list(resources.equipment).map((e) => (isPlainObject(e) ? migrateEquipmentResource(e, base) : e));
  resources.equipmentModels = list(resources.equipmentModels);
  resources.externalServices = list(resources.externalServices);
  const equipmentById = new Map(resources.equipment.filter(isPlainObject).map((e) => [e.id, e]));

  // Sólo transforma las listas que existen (una plantilla sin personal no gana "labor: []").
  const migrateLines = (q) => {
    const out = { ...q };
    const mapIf = (key, fn) => {
      if (Array.isArray(q[key])) out[key] = q[key].map(fn);
    };
    mapIf('labor', (l) => {
      if (!isPlainObject(l)) return l;
      const line = { ...l, base: base(l.base, { forceCurrency: true }) };
      if (!isPlainObject(line.snapshot)) line.snapshot = l.sourceId ? legacySnapshot('laborProfiles', line, { resourceId: l.sourceId, resourceName: l.role }) : null;
      return line;
    });
    mapIf('equipment', (e) => {
      if (!isPlainObject(e)) return e;
      const acquisition = acquisitionOf(e);
      const source = e.sourceId ? equipmentById.get(e.sourceId) : null;
      const line = {
        ...e,
        acquisition,
        familyId: typeof e.familyId === 'string' ? e.familyId : source ? familyIdOf(source) : null,
        internalCode: typeof e.internalCode === 'string' ? e.internalCode : '',
        otherAnnual: Number.isFinite(e.otherAnnual) ? e.otherAnnual : 0,
        external: acquisition === 'owned' ? null : createExternalTerms(e.external),
        base: base(e.base),
        costsBase: base(e.costsBase, { forceCurrency: true }),
        mobilization: createMobilization(e.mobilization),
        operatorLaborId: typeof e.operatorLaborId === 'string' ? e.operatorLaborId : null,
      };
      if (!isPlainObject(line.snapshot)) line.snapshot = e.sourceId ? legacySnapshot('equipment', line, { resourceId: e.sourceId, resourceName: e.name }) : null;
      return line;
    });
    mapIf('materials', (m) => {
      if (!isPlainObject(m)) return m;
      const line = { ...m, base: base(m.base) };
      if (!isPlainObject(line.snapshot)) line.snapshot = m.sourceId ? legacySnapshot('materials', line, { resourceId: m.sourceId, resourceName: m.description }) : null;
      return line;
    });
    if (isPlainObject(q.fuel)) out.fuel = { ...q.fuel, base: base(q.fuel.base, { forceCurrency: true }) };
    return out;
  };

  const quotes = list(src.quotes).map((q) => {
    if (!isPlainObject(q)) return q;
    const out = migrateLines(q);
    out.currency = isKnownCurrency(q.currency) ? q.currency : currency;
    // Fecha de la oferta = su fecha de creación (un hecho, no una suposición).
    out.offerDate = dayFromDate(q.offerDate) || dayFromDate(q.createdAt) || null;
    out.exchangeRates = normalizeExchangeRates(q.exchangeRates, { currency: out.currency });
    return out;
  });
  // Las plantillas guardan líneas con la misma forma que una cotización.
  const services = list(src.services).map((t) => {
    if (!isPlainObject(t) || !isPlainObject(t.defaults)) return t;
    return { ...t, defaults: migrateLines(t.defaults) };
  });

  if (!isPlainObject(settings.fuelPriceBase)) settings.fuelPriceBase = emptyBase({ currency });
  else settings.fuelPriceBase = { ...normalizeBase(settings.fuelPriceBase, { currency }), currency };
  settings.exchangeRates = normalizeExchangeRates(settings.exchangeRates, { currency });

  return { ...src, schemaVersion: 3, resources, quotes, services, settings };
}

/** Unidad de "Mis equipos" del esquema 2 → legajo del esquema 3 (sin cambiar valores). */
function migrateEquipmentResource(e, base) {
  const acquisition = acquisitionOf(e);
  return {
    ...e,
    familyId: familyIdOf(e),
    internalCode: typeof e.internalCode === 'string' ? e.internalCode : '',
    acquisition,
    otherAnnual: Number.isFinite(e.otherAnnual) ? e.otherAnnual : 0,
    mobility: createEquipmentMobility(e.mobility),
    external: acquisition === 'owned' ? null : createExternalTerms(e.external),
    base: base(e.base),
    costsBase: base(e.costsBase, { forceCurrency: true }),
  };
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
  2: migrateV2ToV3,
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
