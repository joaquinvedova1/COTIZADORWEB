/**
 * EconomicBaseEngine — BASE ECONÓMICA DE LA OFERTA (PLAN-2026-005).
 *
 * Responde "¿con qué costo, moneda y fecha base se calculó esta oferta?":
 *
 *   base general   = mes de la fecha de la oferta (quote.offerDate)
 *   por rubro      = la base (período) de cada valor usado: mano de obra,
 *                    equipos propios (valor y costos), equipos y servicios
 *                    externos, combustible, materiales, tipos de cambio
 *   sin definir    = valores sin período ("Base no definida": no se inventa)
 *   vieja          = más de BASE_STALE_MONTHS meses antes de la oferta
 *   bases distintas = entre la más vieja y la más nueva hay más de
 *                    BASE_SPREAD_MONTHS meses → "Esta cotización usa valores
 *                    con diferentes fechas base." (advertencia, no bloquea)
 *
 * Determinístico: compara contra la fecha de la OFERTA, nunca contra "hoy".
 * Sólo cuenta valores que pesan en el costo (un material que provee el
 * cliente o el combustible que paga el cliente no tienen base que controlar).
 */

import { BASE_STALE_MONTHS, BASE_SPREAD_MONTHS } from '../config.js';
import { isPlainObject, objectList } from '../core/object.js';
import { nonNegative } from '../core/money.js';
import { formatPeriod } from '../core/format.js';
import { isValidPeriod, monthsBetween, periodFromDate } from '../domain/economic-base.js';
import { MATERIAL_PROVIDERS } from '../domain/catalogs.js';

export const BASE_CATEGORIES = Object.freeze([
  { id: 'labor', label: 'Mano de obra' },
  { id: 'equipment', label: 'Equipos propios' },
  { id: 'external', label: 'Equipos y servicios externos' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'materials', label: 'Materiales' },
  { id: 'exchange', label: 'Tipo de cambio' },
]);

function entry(category, label, base, path) {
  const b = isPlainObject(base) ? base : {};
  return {
    category,
    label,
    path,
    period: isValidPeriod(b.period) ? b.period : null,
    currency: typeof b.currency === 'string' ? b.currency : null,
    source: typeof b.source === 'string' ? b.source : null,
  };
}

/** Valores con base que pesan en el costo de la cotización. */
export function economicBaseEntries(quote = {}) {
  const out = [];
  objectList(quote.labor).forEach((l, i) => {
    if (nonNegative(l.positions) > 0 && nonNegative(l.basicMonthly) + nonNegative(l.additionalsMonthly) > 0) {
      out.push(entry('labor', l.role || 'Personal', l.base, `labor.${i}.base`));
    }
  });
  const foreign = new Set();
  objectList(quote.equipment).forEach((e, i) => {
    const name = e.name || 'Equipo';
    const external = e.acquisition === 'rented' || e.acquisition === 'outsourced';
    if (nonNegative(e.quantity) <= 0) return;
    if (external) {
      out.push(entry('external', name, e.base, `equipment.${i}.base`));
    } else {
      out.push(entry('equipment', `${name} — valor`, e.base, `equipment.${i}.base`));
      out.push(entry('equipment', `${name} — costos`, e.costsBase, `equipment.${i}.costsBase`));
    }
    if (isPlainObject(e.base) && e.base.currency) foreign.add(e.base.currency);
  });
  const fuel = isPlainObject(quote.fuel) ? quote.fuel : {};
  const usesFuel = objectList(quote.equipment).length > 0 || (isPlainObject(quote.logistics) && !quote.logistics.notApplicable && objectList(quote.logistics.vehicles).length > 0);
  if (usesFuel && fuel.providedBy !== 'client' && nonNegative(fuel.pricePerLiter) > 0) {
    out.push(entry('fuel', 'Combustible', fuel.base, 'fuel.base'));
  }
  if (!quote.materialsNotApplicable) {
    objectList(quote.materials).forEach((m, i) => {
      const provider = MATERIAL_PROVIDERS.find((p) => p.id === m.providedBy);
      const costsUs = !(provider && provider.costForUs === false);
      if (costsUs && nonNegative(m.unitCost) * nonNegative(m.quantity) > 0) out.push(entry('materials', m.description || 'Material', m.base, `materials.${i}.base`));
      if (isPlainObject(m.base) && m.base.currency) foreign.add(m.base.currency);
    });
  }
  const quoteCurrency = typeof quote.currency === 'string' ? quote.currency : null;
  objectList(quote.exchangeRates).forEach((r, i) => {
    if (r.currency && r.currency !== quoteCurrency && foreign.has(r.currency)) out.push(entry('exchange', `Tipo de cambio ${r.currency}`, r.base, `exchangeRates.${i}.base`));
  });
  return out;
}

/**
 * Resumen de la base económica de una cotización.
 * @returns {{ offerPeriod, categories, entries, defined, undefinedCount, oldest, newest, spreadMonths, mixed, stale, warnings }}
 */
export function summarizeEconomicBase(quote = {}) {
  // Sólo la fecha de la OFERTA (nunca la de creación ni "hoy"): sin fecha, no
  // se puede decir si una base es vieja y se avisa.
  const offerPeriod = periodFromDate(quote.offerDate) || null;
  const entries = economicBaseEntries(quote).map((e) => ({
    ...e,
    monthsBeforeOffer: e.period && offerPeriod ? monthsBetween(e.period, offerPeriod) : null,
  }));
  const defined = entries.filter((e) => e.period);
  const sorted = [...defined].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const oldest = sorted.length ? sorted[0].period : null;
  const newest = sorted.length ? sorted[sorted.length - 1].period : null;
  const spreadMonths = oldest && newest ? monthsBetween(oldest, newest) : null;
  const mixed = spreadMonths !== null && spreadMonths > BASE_SPREAD_MONTHS;
  const stale = defined.filter((e) => e.monthsBeforeOffer !== null && e.monthsBeforeOffer > BASE_STALE_MONTHS);
  const undefinedEntries = entries.filter((e) => !e.period);
  const categories = BASE_CATEGORIES.map((c) => {
    const own = entries.filter((e) => e.category === c.id);
    const periods = own.filter((e) => e.period).map((e) => e.period).sort();
    return {
      id: c.id,
      label: c.label,
      count: own.length,
      undefinedCount: own.filter((e) => !e.period).length,
      oldest: periods[0] || null,
      newest: periods[periods.length - 1] || null,
    };
  }).filter((c) => c.count > 0);

  const warnings = [];
  if (mixed) warnings.push({ id: 'mixed', message: `Esta cotización usa valores con diferentes fechas base (de ${formatPeriod(oldest)} a ${formatPeriod(newest)}).` });
  if (stale.length) warnings.push({ id: 'stale', message: `${stale.length === 1 ? 'Un valor tiene' : `${stale.length} valores tienen`} una base de más de ${BASE_STALE_MONTHS} meses antes de la oferta: ${stale.slice(0, 3).map((e) => `${e.label} (${formatPeriod(e.period)})`).join(', ')}${stale.length > 3 ? '…' : ''}.` });
  if (!offerPeriod && entries.length) warnings.push({ id: 'no_offer_date', message: 'Sin fecha de la oferta: cargala en "Tipo de servicio" para comparar las fechas base de los valores.' });
  if (undefinedEntries.length) warnings.push({ id: 'undefined', message: `${undefinedEntries.length === 1 ? 'Un valor no tiene' : `${undefinedEntries.length} valores no tienen`} fecha base: ${undefinedEntries.slice(0, 3).map((e) => e.label).join(', ')}${undefinedEntries.length > 3 ? '…' : ''}.` });

  return {
    offerPeriod,
    categories,
    entries,
    defined: defined.length,
    undefinedCount: undefinedEntries.length,
    undefinedEntries,
    oldest,
    newest,
    spreadMonths,
    mixed,
    stale,
    warnings,
  };
}
