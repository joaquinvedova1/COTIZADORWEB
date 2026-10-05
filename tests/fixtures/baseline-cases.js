/**
 * Casos del baseline de regresión del motor (PLAN-2026-002, PN0).
 *
 * Sólo datos demo ILUSTRATIVOS y variantes sintéticas: nada de planillas
 * reales. Los resultados esperados se generaron UNA vez con el motor anterior
 * a los impuestos sobre la facturación (tests/fixtures/baseline-v1.json) y
 * deben seguir siendo idénticos con impuestos sin definir (0 %).
 */

import { createDemoState, DEMO_IDS } from '../../js/domain/demo-data.js';
import { createQuoteFromTemplate } from '../../js/domain/quote-factory.js';
import { deepClone } from '../../js/core/object.js';

const NOW = '2026-10-01T12:00:00.000Z';

export function baselineCases() {
  const state = createDemoState(1);
  const settings = state.settings;
  const hydro = state.quotes.find((q) => q.id === DEMO_IDS.quoteHydroCrane);
  const reference = state.quotes.find((q) => q.id === DEMO_IDS.quoteReference);
  const cases = [
    { id: 'demo-hidrogrua', quote: hydro },
    { id: 'demo-referencia', quote: reference },
  ];
  state.services.forEach((t, i) => {
    cases.push({ id: `plantilla-${t.id}`, quote: createQuoteFromTemplate(t, { organizationId: state.organization.id, settings, now: NOW, id: `00000000-0000-4000-8000-0000000090${String(i).padStart(2, '0')}`, code: `COT-9${i}` }) });
  });
  const variant = (id, mutate) => {
    const q = deepClone(hydro);
    mutate(q);
    cases.push({ id, quote: q });
  };
  variant('hidrogrua-tarifa-conocida', (q) => { q.pricingMode = 'known_rate'; q.pricing.knownRate = 2500000; });
  variant('hidrogrua-por-hora', (q) => { q.unit = 'hour'; });
  variant('hidrogrua-abono', (q) => { q.unit = 'month'; });
  variant('hidrogrua-actividad-0', (q) => { q.activity.activeDaysPerMonth = 0; });
  variant('hidrogrua-utilizacion-100', (q) => { q.activity.activeDaysPerMonth = 30; q.pricing.targetMarginPct = 0; });
  variant('hidrogrua-reglas', (q) => {
    q.pricing.offeredRateOverride = 2000000;
    q.rules.availabilityFeeMonthly = 1500000;
    q.rules.calloutFeePerActivation = 200000;
    q.rules.standbyDaysPerMonth = 2;
    q.rules.standbyRatePerDay = 300000;
    q.rules.minimumMonthlyGuarantee = 9000000;
    q.rules.continuityDiscountPct = 2;
    q.contractMonths = 24;
    q.pricing.commercialDiscountPct = 3;
  });
  variant('hidrogrua-precio-bajo-costo', (q) => { q.pricingMode = 'known_rate'; q.pricing.knownRate = 900000; });
  return cases.map((c) => ({ ...c, settings }));
}

/** Números que se comparan (sin completitud: PN2 agrega una regla de completitud). */
export function pickBaseline(result) {
  const k = result.kpis;
  const keys = ['totalCost', 'fixedCosts', 'variableCosts', 'floorNetRate', 'floorListRate', 'targetNetRate', 'targetListRate', 'suggestedListRate', 'commercialListRate', 'commercialNetRate', 'revenue', 'profit', 'marginPct', 'markupPct', 'breakEvenDays', 'targetMarginDays', 'financialCost', 'workingCapital'];
  return {
    kpis: Object.fromEntries(keys.map((key) => [key, k[key] ?? null])),
    // PLAN-2026-005 agregó la fila "Equipos y servicios externos": en estos
    // casos (sin externos) vale 0 y las demás filas no cambian.
    eecc: result.eecc.rows.filter((r) => r.category !== 'external').map((r) => [r.category, r.amount, r.displayPct]),
    externalRow: (result.eecc.rows.find((r) => r.category === 'external') || {}).amount ?? null,
    matrix: result.matrix.map((m) => [m.activeDays, m.floorNetRate, m.byMargin.map((b) => [b.marginPct, b.netRate, b.listRate]), m.revenue, m.profit, m.marginPct]),
    discounts: result.discounts.map((d) => [d.id, d.netRate, d.floorNetRate, d.targetNetRate, d.profit, d.status]),
  };
}
