/**
 * RATEOS Test Lab — cobertura automática contra los CATÁLOGOS del proyecto
 * (PLAN-2026-013).
 *
 * La cobertura se calcula con los datos de cada escenario armado (no con
 * etiquetas escritas a mano). Si mañana se agrega una unidad, un tipo de
 * servicio o una modalidad y ningún escenario la usa, la cobertura falla.
 */

import {
  SERVICE_TYPES, PRICING_MODES, ACQUISITION_MODES, EXTERNAL_UNITS, EXTERNAL_FUEL_MODES, VAT_RECOVERY, MOBILIZATION_MODES, DRIVER_OPTIONS,
  MAINTENANCE_MODES, TIRE_MODES, MATERIAL_BASES, MATERIAL_PROVIDERS, COST_BEHAVIORS, INDIRECT_METHODS, BILLING_TAX_MODES, FUEL_PROVIDERS,
  MEASURE_UNITS, PRODUCT_MATERIAL_PER, PRODUCT_PRICE_MODES, SALE_UNIT_SUGGESTIONS, CURRENCIES, RISK_ITEMS,
} from '../../../js/domain/catalogs.js';
import { BILLING_UNITS } from '../../../js/domain/billing-units.js';
import { LABOR_ASSIGNMENTS, EQUIPMENT_ASSIGNMENTS } from '../../../js/domain/assignment.js';

const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const isExt = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';

/** Rasgos que ejercita una cotización armada: { dimensión: Set(valor) }. */
export function quoteFeatures(q) {
  const f = {};
  const add = (dim, value) => { if (value === undefined || value === null || value === '') return; (f[dim] ||= new Set()).add(String(value)); };
  add('serviceType', q.serviceType);
  add('unit', q.unit || 'day');
  add('pricingMode', q.pricingMode);
  add('fuelProvider', (q.fuel && q.fuel.providedBy) || 'contractor');
  const equipment = list(q.equipment);
  equipment.forEach((e) => {
    add('acquisition', e.acquisition || 'owned');
    if (isExt(e)) {
      const x = e.external || {};
      add('externalUnit', x.unit);
      if (x.fuelIncluded === false) add('externalFuelMode', x.fuelMode || 'per_hour');
      if (x.fuelIncluded === true) add('feature', 'external-fuel-included');
      if (x.mobilizationIncluded === false && Number(x.mobilizationAmount) > 0) add('feature', 'external-mobilization-charged');
      if (Number(x.minimumUnits) > 0) add('feature', 'external-minimum');
      add('vatRecovery', x.fiscal && x.fiscal.vatRecoverable);
      if (e.supplierPayDays !== null && e.supplierPayDays !== undefined && e.supplierPayDays !== '') add('feature', 'supplier-pay-days');
    } else {
      add('maintenanceMode', e.maintenanceMode || 'per_hour');
      add('tiresMode', e.tiresMode || 'per_hour');
      add('equipmentAssignment', e.assignment || 'reserved');
      if (Number(e.capitalRatePctAnnual) > 0) add('feature', 'capital-cost');
    }
    const m = e.mobilization || {};
    if (m.mode) add('mobilizationMode', m.mode);
    if (m.mode === 'self' && m.driver) add('driver', m.driver);
    if (e.base && e.base.currency && e.base.currency !== (q.currency || 'ARS')) add('currency', e.base.currency);
  });
  list(q.labor).forEach((l) => {
    add('laborAssignment', l.assignment || 'dedicated');
    if (Array.isArray(l.overtime)) list(l.overtime).forEach((o) => add('overtimeBasis', o.basis || 'per_active_day'));
    else if (Number(l.overtimeHoursPerActiveDay) > 0) add('overtimeBasis', 'per_active_day');
    if (l.overtimeBilled === true) add('feature', 'overtime-billed');
    if (Number(l.peoplePerPosition) > 1) add('feature', 'relief');
  });
  if (!q.materialsNotApplicable) {
    list(q.materials).forEach((m) => {
      add('materialBasis', m.basis || 'per_month');
      add('materialProvider', m.providedBy);
      if (m.base && m.base.currency && m.base.currency !== (q.currency || 'ARS')) add('currency', m.base.currency);
    });
  }
  list(q.otherCosts).forEach((o) => add('otherBehavior', o.behavior || 'fixed_monthly'));
  const ind = q.indirect || {};
  if (ind.mode === 'detailed') { add('indirect', 'detailed'); list(ind.items).forEach((it) => add('indirectMethod', it.method)); } else add('indirectMethod', ind.method || 'percent_direct');
  const bt = q.billingTaxes || {};
  add('billingTaxes', bt.notApplicable ? 'not_applicable' : bt.mode === 'detailed' && list(bt.items).length ? 'detailed' : bt.combinedPct === null || bt.combinedPct === undefined ? 'undefined' : 'combined');
  const r = q.rules || {};
  const rule = (k, name) => { if (Number(r[k]) > 0) add('rule', name); };
  rule('minimumCallUnits', 'minimum-call');
  if (r.standbyNotApplicable !== true && Number(r.standbyDaysPerMonth) > 0) add('rule', 'standby');
  rule('calloutFeePerActivation', 'callout');
  rule('mobilizationFeePerActivation', 'mobilization-fee');
  rule('extraKmRate', 'extra-km');
  rule('availabilityFeeMonthly', 'availability-fee');
  rule('minimumMonthlyGuarantee', 'guarantee');
  rule('continuityDiscountPct', 'continuity');
  if (list(r.volumeTiers).some((t) => Number(t.discountPct) > 0)) add('rule', 'volume-tiers');
  if (Number(q.pricing && q.pricing.commercialDiscountPct) > 0) add('rule', 'commercial-discount');
  if (Number(q.pricing && q.pricing.offeredRateOverride) > 0) add('feature', 'offered-rate');
  if (q.pricing && q.pricing.materialsBilledSeparately === true) add('feature', 'materials-billed');
  if (q.activity && q.activity.fullActivations === true) add('feature', 'full-activations');
  const lg = q.logistics || {};
  if (lg.notApplicable) add('feature', 'no-travel');
  else {
    if (Number(lg.distanceKm) > 0) add('feature', 'route');
    if (lg.roundTrip === false) add('feature', 'one-way');
    if (list(lg.vehicles).length) add('feature', 'support-vehicles');
    if (Number(lg.tollsPerActivation) > 0 || Number(lg.lodgingPerActivation) > 0) add('feature', 'tolls-lodging');
  }
  const risk = q.risk || {};
  if (Number(risk.generalPct) > 0) add('feature', 'contingency');
  list(risk.items).filter((i) => i.enabled).forEach((i) => add('riskItem', i.id));
  if (Number(q.finance && q.finance.paymentTermDays) > 0 && Number(q.finance && q.finance.monthlyRatePct) > 0) add('feature', 'financing');
  return f;
}

/** Rasgos que ejercita un producto. */
export function productFeatures(p) {
  const f = {};
  const add = (dim, value) => { if (value === undefined || value === null || value === '') return; (f[dim] ||= new Set()).add(String(value)); };
  add('saleUnit', p.saleUnit);
  list(p.materials).forEach((m) => {
    add('materialPer', m.per || 'batch');
    add('priceMode', m.priceMode || 'unit');
    add('measureUnit', m.unit);
    add('measureUnit', m.useUnit);
    if (m.base && m.base.currency && m.base.currency !== (p.currency || 'ARS')) add('currency', m.base.currency);
  });
  if (list(p.labor).length) add('feature', 'labor');
  if (list(p.equipment).length) add('feature', 'equipment');
  if (list(p.fixedCosts).length) add('feature', 'fixed-costs');
  const bt = p.billingTaxes || {};
  if (!bt.notApplicable && (Number(bt.combinedPct) > 0 || list(bt.items).length)) add('feature', 'sales-taxes');
  if (p.pricing && Number(p.pricing.vatPct) > 0) add('feature', 'vat');
  if (p.pricing && Number(p.pricing.currentPrice) > 0) add('feature', 'current-price');
  if (Number(p.lossPct) > 0) add('feature', 'loss');
  return f;
}

const ids = (catalog) => catalog.map((x) => x.id);
const MEASURE_ALIASES_IN_USE = { unidad: 'u', u: 'u', kg: 'kg', g: 'g', l: 'l', ml: 'ml', docena: 'docena' };

/**
 * Requisitos de cobertura: cada valor de cada catálogo necesita al menos un escenario.
 * `optional` = valores que no se exigen (con motivo).
 */
export function coverageRequirements() {
  return [
    { dim: 'serviceType', label: 'Tipos de servicio', kind: 'service', values: ids(SERVICE_TYPES) },
    { dim: 'unit', label: 'Unidades comerciales', kind: 'service', values: ids(BILLING_UNITS) },
    { dim: 'pricingMode', label: 'Modalidad de precio', kind: 'service', values: ids(PRICING_MODES) },
    { dim: 'acquisition', label: 'Obtención de equipos', kind: 'service', values: ids(ACQUISITION_MODES) },
    { dim: 'externalUnit', label: 'Unidades de externos', kind: 'service', values: ids(EXTERNAL_UNITS) },
    { dim: 'externalFuelMode', label: 'Combustible de externos a nuestro cargo', kind: 'service', values: ids(EXTERNAL_FUEL_MODES) },
    { dim: 'vatRecovery', label: 'IVA de externos', kind: 'service', values: ids(VAT_RECOVERY) },
    { dim: 'mobilizationMode', label: 'Movilización de equipos', kind: 'service', values: ids(MOBILIZATION_MODES) },
    { dim: 'driver', label: 'Quién maneja', kind: 'service', values: ids(DRIVER_OPTIONS) },
    { dim: 'maintenanceMode', label: 'Mantenimiento', kind: 'service', values: ids(MAINTENANCE_MODES) },
    { dim: 'tiresMode', label: 'Neumáticos', kind: 'service', values: ids(TIRE_MODES) },
    { dim: 'materialBasis', label: 'Base de materiales', kind: 'service', values: ids(MATERIAL_BASES) },
    { dim: 'materialProvider', label: 'Quién provee los materiales', kind: 'service', values: ids(MATERIAL_PROVIDERS) },
    { dim: 'otherBehavior', label: 'Otros costos', kind: 'service', values: ids(COST_BEHAVIORS) },
    { dim: 'indirectMethod', label: 'Métodos de estructura', kind: 'service', values: ids(INDIRECT_METHODS) },
    { dim: 'indirect', label: 'Estructura desglosada', kind: 'service', values: ['detailed'] },
    { dim: 'billingTaxes', label: 'Impuestos sobre la facturación', kind: 'service', values: [...ids(BILLING_TAX_MODES), 'not_applicable', 'undefined'] },
    { dim: 'fuelProvider', label: 'Combustible', kind: 'service', values: ids(FUEL_PROVIDERS) },
    { dim: 'laborAssignment', label: 'Asignación de personal', kind: 'service', values: ids(LABOR_ASSIGNMENTS) },
    { dim: 'equipmentAssignment', label: 'Asignación de equipos propios', kind: 'service', values: ids(EQUIPMENT_ASSIGNMENTS) },
    { dim: 'overtimeBasis', label: 'Horas extra', kind: 'service', values: ['per_active_day', 'per_month'] },
    { dim: 'currency', label: 'Monedas extranjeras', kind: 'service', values: ids(CURRENCIES).filter((c) => c !== 'ARS'), optional: { EUR: 'misma regla que USD (tipo de cambio de la cotización)' } },
    { dim: 'riskItem', label: 'Ítems de riesgo', kind: 'service', values: ids(RISK_ITEMS), optional: Object.fromEntries(ids(RISK_ITEMS).slice(1).map((id) => [id, 'todos los ítems suman igual (§9): alcanza con uno habilitado'])) },
    { dim: 'rule', label: 'Reglas comerciales', kind: 'service', values: ['minimum-call', 'standby', 'callout', 'mobilization-fee', 'extra-km', 'availability-fee', 'guarantee', 'continuity', 'volume-tiers', 'commercial-discount'] },
    { dim: 'feature', label: 'Variantes económicas', kind: 'service', values: ['external-fuel-included', 'external-mobilization-charged', 'external-minimum', 'supplier-pay-days', 'capital-cost', 'overtime-billed', 'relief', 'offered-rate', 'materials-billed', 'full-activations', 'no-travel', 'route', 'one-way', 'support-vehicles', 'tolls-lodging', 'contingency', 'financing'] },
    { dim: 'saleUnit', label: 'Unidades de venta de productos', kind: 'product', values: [...SALE_UNIT_SUGGESTIONS] },
    { dim: 'materialPer', label: 'Ingredientes por tanda / por unidad', kind: 'product', values: ids(PRODUCT_MATERIAL_PER) },
    { dim: 'priceMode', label: 'Precio por unidad / por paquete', kind: 'product', values: ids(PRODUCT_PRICE_MODES) },
    { dim: 'measureUnit', label: 'Unidades de medida (masa, volumen, conteo)', kind: 'product', values: MEASURE_UNITS.map((u) => u.id), normalize: (v) => MEASURE_ALIASES_IN_USE[String(v).toLowerCase()] || String(v) },
    { dim: 'feature', label: 'Variantes de productos', kind: 'product', values: ['labor', 'equipment', 'fixed-costs', 'sales-taxes', 'vat', 'current-price', 'loss'] },
  ];
}

/**
 * Cobertura de una campaña. scenarios = [{ id, kind: 'service'|'product', features }].
 * @returns {{ ok: boolean, rows: { dim, label, kind, value, covered: string[], optional: string|null }[], missing: object[], summary: object[] }}
 */
export function computeCoverage(scenarios) {
  const rows = [];
  for (const req of coverageRequirements()) {
    for (const value of req.values) {
      const covered = scenarios.filter((s) => s.kind === req.kind && s.features[req.dim] && [...s.features[req.dim]].some((v) => (req.normalize ? req.normalize(v) : v) === value)).map((s) => s.id);
      rows.push({ dim: req.dim, label: req.label, kind: req.kind, value, covered, optional: req.optional && req.optional[value] ? req.optional[value] : null });
    }
  }
  const missing = rows.filter((r) => r.covered.length === 0 && !r.optional);
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.kind}:${r.label}`;
    const g = groups.get(key) || { label: r.label, kind: r.kind, total: 0, covered: 0 };
    g.total += 1;
    if (r.covered.length) g.covered += 1;
    groups.set(key, g);
  }
  return { ok: missing.length === 0, rows, missing, summary: [...groups.values()] };
}
