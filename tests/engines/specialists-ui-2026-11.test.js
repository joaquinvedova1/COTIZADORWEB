/**
 * Testeo con especialistas (2026-11), tanda A — parte de interfaz y textos
 * (docs/informes/2026-11-especialistas-auditado.md §5). Ningún número de una
 * cotización existente cambia: sólo cotizaciones nuevas, textos y datos que se
 * muestran al lado.
 *
 *   A-2  cotización en blanco con contrato (sólo Personal; al sumar Vehículo, $/viaje y $/km)
 *   A-6  fijo mensual: cada cuántos días hay un viaje o relevo (default 1 = como antes)
 *   A-7  tarifa piso sin contar adicionales (motor)
 *   A-9  insignia ILUSTRATIVO que nombra la tasa de financiamiento de ejemplo
 *   A-10 parámetros de convenio: ILUSTRATIVO por valor sólo en líneas sin origen
 *   A-12 textos ("sin fecha base", "sin contar horas extra")
 *   A-16 disponibilidad sin definir en una cotización nueva (no 24/7 escondida)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { floorWithoutOtherRevenue, requiredNetRate } from '../../js/engines/commercial-rules-engine.js';
import { createEmptyQuote, createBlankQuote, createQuoteFromTemplate, createOtherCost, defaultSettings, laborLineFromProfile } from '../../js/domain/quote-factory.js';
import { componentsOf, contractOf, contractUnits, contractWithComponents, serviceTypeForContract } from '../../js/domain/contract.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS, isIllustrativeAgreementParam } from '../../js/domain/catalogs.js';
import { illustrativeTitle, floorWithoutExtrasText, capAllDaysNote } from '../../js/ui/result-text.js';
import { baseText } from '../../js/ui/economic-base-ui.js';

const NOW = '2026-11-01T00:00:00.000Z';
const SETTINGS = { ...defaultSettings('org'), illustrative: false, defaultBillingTaxes: null };
const approx = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);
const norm = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ');
const itemOf = (r, id) => (r.items || []).find((i) => i.id === id) || null;

function laborLine(over = {}) {
  return {
    id: 'l1', role: 'Operario', positions: 1, peoplePerPosition: 1, basicMonthly: 1_000_000, additionalsMonthly: 0,
    normalHoursPerMonth: 200, overtimeHoursPerActiveDay: 0, overtimePremiumPct: 50, mealPerActiveDay: 0,
    sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6, ...over,
  };
}

describe('A-2 · cotización en blanco con contrato', () => {
  test('en blanco: por servicio prestado con sólo Personal (no "Equipo o maquinaria")', () => {
    const q = createBlankQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-blank' });
    assert.deepEqual(componentsOf(q.contract), ['labor']);
    const c = contractOf(q);
    assert.deepEqual(c, { mode: 'on_demand', labor: true, equipment: false, legacy: false });
    assert.equal(q.serviceType, 'on_call', 'el tipo de servicio guardado no cambia');
    assert.equal(q.unit, 'day');
    assert.ok(contractUnits(q.contract).includes('day'));
  });

  test('al sumar Vehículo aparecen $/viaje y $/km', () => {
    const q = createBlankQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-blank' });
    assert.ok(!contractUnits(q.contract).includes('trip'), 'sólo personal: sin unidades de transporte');
    const next = contractWithComponents(q.contract, [...componentsOf(q.contract), 'vehicle']);
    const units = contractUnits(next);
    assert.ok(units.includes('trip') && units.includes('km'), units.join(','));
    assert.equal(serviceTypeForContract(next), 'on_call');
  });

  test('una cotización guardada sin contrato sigue leyéndose como antes (legacy)', () => {
    const q = createEmptyQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-old' });
    assert.equal(q.contract, undefined);
    assert.deepEqual(contractOf(q), { mode: 'on_demand', labor: true, equipment: true, legacy: true });
  });

  test('una plantilla no recibe el contrato de la cotización en blanco', () => {
    const q = createQuoteFromTemplate({ id: 't', name: 'Grúa', serviceType: 'equipment_only', defaults: {} }, { organizationId: 'org', settings: SETTINGS, now: NOW });
    assert.equal(q.contract, undefined);
    assert.equal(contractOf(q).legacy, true);
  });

  test('la cotización en blanco calcula sin NaN ni Infinity', () => {
    const q = createBlankQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-blank' });
    const r = computeQuote(q);
    const bad = Object.entries(r.kpis).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v));
    assert.deepEqual(bad, []);
  });
});

describe('A-16 · disponibilidad sin definir en una cotización nueva', () => {
  test('en blanco y desde una plantilla sin dato: sin definir; la de la plantilla se respeta', () => {
    assert.equal(createBlankQuote({ settings: SETTINGS, now: NOW }).activity.availability, null);
    assert.equal(createQuoteFromTemplate({ id: 't', serviceType: 'on_call', defaults: {} }, { settings: SETTINGS, now: NOW }).activity.availability, null);
    assert.equal(createQuoteFromTemplate({ id: 't', serviceType: 'permanent', defaults: { activity: { availability: '24/7' } } }, { settings: SETTINGS, now: NOW }).activity.availability, '24/7');
    // La base de siempre (y por lo tanto las cotizaciones guardadas) no cambia.
    assert.equal(createEmptyQuote({ settings: SETTINGS, now: NOW }).activity.availability, '24/7');
  });

  test('el aviso de relevos aparece sólo si la persona elige 24/7', () => {
    const q = createBlankQuote({ settings: SETTINGS, now: NOW, id: 'q' });
    q.labor = [laborLine()];
    q.activity.activeDaysPerMonth = 10;
    assert.equal(itemOf(evaluateCompleteness(q), 'relief'), null);
    q.activity.availability = '24/7';
    assert.equal(itemOf(evaluateCompleteness(q), 'relief').status, 'warning');
    q.activity.availability = 'window';
    assert.equal(itemOf(evaluateCompleteness(q), 'relief'), null);
  });

  test('la disponibilidad no mueve ningún número', () => {
    const q = createBlankQuote({ settings: SETTINGS, now: NOW, id: 'q' });
    q.labor = [laborLine()];
    q.activity.activeDaysPerMonth = 12;
    const a = computeQuote(q).kpis;
    q.activity.availability = '24/7';
    const b = computeQuote(q).kpis;
    for (const key of ['totalCost', 'floorNetRate', 'targetNetRate', 'suggestedListRate', 'breakEvenDays']) assert.equal(a[key], b[key], key);
  });
});

describe('A-6 · fijo mensual: cada cuántos días hay un viaje o relevo', () => {
  function monthly(dpa) {
    const q = createEmptyQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-m' });
    q.contract = { mode: 'monthly', labor: true, equipment: false };
    q.serviceType = serviceTypeForContract(q.contract);
    q.unit = 'month';
    q.pricingMode = 'known_activity';
    q.logistics.notApplicable = true;
    q.materialsNotApplicable = true;
    q.activity = { ...q.activity, activeDaysPerMonth: 30, availableDaysPerMonth: 30, hoursPerActiveDay: 12 };
    if (dpa !== undefined) q.activity.daysPerActivation = dpa;
    // Sin estructura, contingencia ni financiación: se ve sólo el costo por intervención.
    q.indirect = { method: 'percent_direct', pct: 0, amount: 0 };
    q.risk = { generalPct: 0, items: [] };
    q.finance.monthlyRatePct = 0;
    q.otherCosts = [createOtherCost({ id: 'rel', description: 'Traslado del relevo', category: 'logistics', behavior: 'per_activation', amount: 140_000 })];
    return q;
  }

  test('con 1 (default) no cambia nada: 30 intervenciones por mes', () => {
    const base = computeQuote(monthly());
    const one = computeQuote(monthly(1));
    approx(base.activity.activationsPerMonth, 30);
    assert.equal(one.kpis.totalCost, base.kpis.totalCost);
  });

  test('relevo cada 14 días (14x14): 30 ÷ 14 intervenciones y el costo por intervención se divide', () => {
    const one = computeQuote(monthly(1));
    const r = computeQuote(monthly(14));
    approx(r.activity.activationsPerMonth, 30 / 14);
    approx(one.kpis.totalCost - r.kpis.totalCost, 140_000 * (30 - 30 / 14), 'diferencia = costo por intervención × intervenciones de menos');
  });
});

describe('A-7 · tarifa piso sin contar adicionales', () => {
  test('sin otros ingresos no hay dato aparte (null)', () => {
    assert.equal(floorWithoutOtherRevenue({ totalCost: 900, billingTaxPct: 10, billableUnits: 10, otherRevenue: 0, discountFactor: 1 }), null);
    assert.equal(floorWithoutOtherRevenue(null), null);
  });

  test('costo 900, impuestos 10 %, 10 unidades, adicionales 200: piso 80, sin adicionales 100', () => {
    const rates = { totalCost: 900, billingTaxPct: 10, billableUnits: 10, otherRevenue: 200, discountFactor: 1 };
    approx(requiredNetRate({ ...rates, marginPct: 0 }).rate, 80);
    const x = floorWithoutOtherRevenue(rates);
    approx(x.netRate, 100);
    approx(x.listRate, 100);
    approx(x.otherRevenue, 200);
    // De lista con descuentos: neta / factor.
    approx(floorWithoutOtherRevenue({ ...rates, discountFactor: 0.8 }).listRate, 125);
    // Sin unidades facturables no hay tarifa posible.
    assert.equal(floorWithoutOtherRevenue({ ...rates, billableUnits: 0 }), null);
  });

  test('el texto da el piso sin adicionales hacia arriba y los adicionales que supone', () => {
    const t = floorWithoutExtrasText({ otherRevenue: 373_000, netRate: 1_000_000.4, listRate: 1_000_000.4 }, 'válvula');
    assert.equal(norm(t.text), 'Sin contar adicionales: $ 1.000.001 / válvula');
    assert.match(norm(t.tip), /facturás \$ 373\.000 de adicionales por mes/);
    assert.match(norm(t.tip), /cobrá al menos \$ 1\.000\.001 \/ válvula/);
    assert.equal(floorWithoutExtrasText(null), null);
  });

  test('con adicionales en la cotización el piso sin adicionales es mayor que el piso', () => {
    const q = createEmptyQuote({ organizationId: 'org', settings: SETTINGS, now: NOW, id: 'q-x' });
    q.labor = [laborLine()];
    q.activity.activeDaysPerMonth = 10;
    q.logistics.notApplicable = true;
    q.materialsNotApplicable = true;
    q.extras = [{ id: 'x', label: 'Llamado extra', unitName: 'llamado', category: 'labor', quantityPerMonth: 2, costPerUnit: 0, price: 100_000 }];
    const r = computeQuote(q);
    assert.ok(r.ratesAtEstimate.otherRevenue > 0);
    const x = floorWithoutOtherRevenue(r.ratesAtEstimate);
    assert.ok(x.netRate > r.kpis.floorNetRate, `${x.netRate} > ${r.kpis.floorNetRate}`);
    approx((x.netRate - r.kpis.floorNetRate) * r.ratesAtEstimate.billableUnits, r.ratesAtEstimate.otherRevenue, 'la diferencia es justo lo de los adicionales');
  });
});

describe('A-9 · insignia ILUSTRATIVO', () => {
  test('nombra la tasa de financiamiento de ejemplo cuando es la única causa', () => {
    const t = illustrativeTitle({ any: true, quote: false, lines: 0, fuel: false, finance: true });
    assert.match(t, /tasa de financiamiento de ejemplo/);
    assert.doesNotMatch(t, /: \./);
  });

  test('varias causas, en una lista legible; sin valores ilustrativos, sin insignia', () => {
    const t = illustrativeTitle({ any: true, quote: false, lines: 2, fuel: true, finance: true });
    assert.match(t, /2 ítems copiados .*, precio de combustible ilustrativo y tasa de financiamiento de ejemplo/);
    assert.equal(illustrativeTitle({ any: false }), null);
    assert.equal(illustrativeTitle({ any: true, quote: true }), 'Cotización con valores de demostración');
  });
});

describe('A-10 · ILUSTRATIVO por valor sólo en líneas sin origen', () => {
  const own = { id: 'cct', illustrative: false };
  test('una carga real igual al valor de ejemplo, con convenio o perfil propio, no es ilustrativa', () => {
    const line = { sacPct: ILLUSTRATIVE_AGREEMENT_PARAMS.sacPct, agreementId: 'cct', illustrative: false };
    assert.equal(isIllustrativeAgreementParam(line, 'sacPct', { agreement: own }), false);
    const fromProfile = laborLineFromProfile({ id: 'p1', role: 'Soldador', sacPct: 8.33, normalHoursPerMonth: 176 }, null, { now: NOW });
    assert.equal(isIllustrativeAgreementParam(fromProfile, 'normalHoursPerMonth'), false);
  });

  test('sin origen se sigue comparando por valor; con marca, siempre ilustrativo', () => {
    assert.equal(isIllustrativeAgreementParam({ sacPct: 8.33 }, 'sacPct'), true);
    assert.equal(isIllustrativeAgreementParam({ sacPct: 9 }, 'sacPct'), false);
    assert.equal(isIllustrativeAgreementParam({ sacPct: 9, illustrative: true }, 'sacPct'), true);
    assert.equal(isIllustrativeAgreementParam({ sacPct: 9, agreementId: 'demo' }, 'sacPct', { agreement: { id: 'demo', illustrative: true } }), true);
    assert.equal(isIllustrativeAgreementParam({ sacPct: 9, sourceId: 'p1' }, 'sacPct', { wholeIllustrative: true }), true);
  });
});

describe('A-12 · textos', () => {
  test('sin fecha base: "Base no definida" o "Valor: sin fecha base" (sin "Valor no definida")', () => {
    assert.equal(baseText(null), 'Base no definida');
    assert.equal(baseText(null, { prefix: 'Valor' }), 'Valor: sin fecha base');
    assert.equal(baseText({ period: null }, { prefix: 'Costos' }), 'Costos: sin fecha base');
    assert.equal(baseText({ period: '2026-09' }, { prefix: 'Valor' }), 'Valor: sep-26');
  });

  test('abono que alcanza todos los días: con personal, sin contar horas extra', () => {
    assert.equal(capAllDaysNote(true), ' (sin contar horas extra)');
    assert.equal(capAllDaysNote(false), '');
  });
});
