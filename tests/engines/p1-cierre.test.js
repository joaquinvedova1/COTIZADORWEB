/**
 * P1 CIERRE — señales engañosas antes del autoservicio (PLAN-2026-028, Gate A de la revisión
 * del 21/10). Ninguna fórmula cambia: cambian la completitud, los avisos y los textos.
 *
 *  H-09  Externo cobrado por km o por tramo con cantidad mayor que 1: cada unidad cuenta todo el
 *        recorrido (AUD-T1: +94 % si en realidad se reparten los viajes). Pendiente CRÍTICO, sin
 *        volver NO CONFIABLE el resultado, hasta poner cantidad 1 o confirmar el supuesto.
 *  H-10  Avisos de personal ("Horas del personal" y "Relevos"): son una revisión, no una orden de
 *        sumar personal. Cada puesto puede confirmar que la cobertura está prevista; la
 *        confirmación vale mientras el supuesto siga igual.
 *  H-13  Productos: el margen que viene de la configuración de EJEMPLO y las cargas sociales
 *        genéricas sin convenio quedan para revisar. Lo guardado no se reinterpreta.
 *
 * Cotizaciones y productos SINTÉTICOS (tests/fixtures/eco-01). Las cifras fijadas son las del
 * candidato `f7e8a29` antes de este cambio.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
// Import de espacio de nombres: contra el candidato anterior (sin estas funciones) cada test falla por su cuenta.
import * as completenessEngine from '../../js/engines/completeness-engine.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { createEmptyProduct, exampleProduct, blankProductLaborLine } from '../../js/domain/product-factory.js';
import { defaultSettings } from '../../js/domain/quote-factory.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS } from '../../js/domain/catalogs.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/eco-01/${name}.json`, import.meta.url), 'utf8'));
const pendingOf = (r, id) => (r.completeness.pending || []).find((p) => p.id === id) || null;
const itemOf = (r, id) => (r.completeness.items || []).find((p) => p.id === id) || null;
const fn = (name) => {
  const f = completenessEngine[name];
  assert.equal(typeof f, 'function', `falta ${name} en completeness-engine`);
  return f;
};

// ------------------------------------------------------------------ H-09
/** E3: transporte con un externo por km (2.900 $/km, 36 viajes de 320 km). */
function e3(quantity = 2, ext = {}) {
  const q = fixture('e3-cotizacion');
  q.equipment[0].quantity = quantity;
  Object.assign(q.equipment[0].external, ext);
  return q;
}

describe('P1 CIERRE · H-09: cantidad de un externo por km o por tramo', () => {
  test('por km con cantidad 2: pendiente CRÍTICO que explica los km por unidad, sin volver NO CONFIABLE', () => {
    const r = computeQuote(e3(2));
    const p = pendingOf(r, 'external_quantity');
    assert.ok(p, 'hay pendiente');
    assert.equal(p.severity, 'critical');
    assert.notEqual(p.unreliable, true);
    assert.match(p.message, /"Externo 1"/);
    assert.match(p.message, /cantidad 2/);
    assert.match(p.message, /11\.520 km/, 'los km de la ruta en el mes');
    assert.match(p.message, /23\.040 km/, 'lo que se factura con la cantidad');
    assert.match(p.message, /cantidad 1/, 'cómo corregirlo si se reparten los viajes');
    assert.equal(p.focus, 'equipment.0.quantity');
    assert.deepEqual(p.targets.map((t) => t.index), [0]);
  });

  test('las cifras no cambian: son las del candidato antes del cambio', () => {
    const r1 = computeQuote(e3(1));
    const r2 = computeQuote(e3(2));
    assert.ok(Math.abs(r1.kpis.totalCost - 41281757.10758784) < 0.01);
    assert.ok(Math.abs(r2.kpis.totalCost - 80094844.10918784) < 0.01);
    assert.equal(r1.kpis.suggestedListRate, 1377000);
    assert.equal(r2.kpis.suggestedListRate, 2671000);
  });

  test('cantidad 1, o una tarifa por hora o por día con cantidad 2: sin pendiente', () => {
    assert.equal(pendingOf(computeQuote(e3(1)), 'external_quantity'), null);
    assert.equal(pendingOf(computeQuote(e3(2, { unit: 'day' })), 'external_quantity'), null);
    assert.equal(pendingOf(computeQuote(e3(2, { unit: 'hour' })), 'external_quantity'), null);
  });

  test('por tramo y por viaje completo con cantidad 2 también preguntan', () => {
    assert.ok(pendingOf(computeQuote(e3(2, { unit: 'trip' })), 'external_quantity'));
    assert.ok(pendingOf(computeQuote(e3(2, { unit: 'trip', tripBasis: 'round_trip' })), 'external_quantity'));
  });

  test('confirmado ("cada unidad hace todo el recorrido"): sin pendiente; otra cantidad u otra unidad vuelven a preguntar', () => {
    const assumption = fn('externalQuantityAssumption');
    const q = e3(2);
    q.equipment[0].externalQuantityConfirmed = assumption(q, q.equipment[0]);
    const r = computeQuote(q);
    assert.equal(pendingOf(r, 'external_quantity'), null);
    assert.equal(r.kpis.totalCost, computeQuote(e3(2)).kpis.totalCost, 'confirmar no cambia el costo');

    const more = structuredClone(q);
    more.equipment[0].quantity = 3;
    const stale = pendingOf(computeQuote(more), 'external_quantity');
    assert.ok(stale, 'otra cantidad');
    assert.match(stale.message, /ya no vale/);

    const otherUnit = structuredClone(q);
    otherUnit.equipment[0].external.unit = 'trip';
    assert.ok(pendingOf(computeQuote(otherUnit), 'external_quantity'), 'otra unidad');
  });

  test('sin tarifa o con cantidad 0 no pregunta (no hay costo que duplicar)', () => {
    assert.equal(pendingOf(computeQuote(e3(2, { price: 0 })), 'external_quantity'), null);
    assert.equal(pendingOf(computeQuote(e3(0)), 'external_quantity'), null);
  });

  test('externalQuantityHolds: la confirmación vale sólo con la cantidad y la unidad confirmadas, aunque la regla no se aplique (revisión de código)', () => {
    const holds = fn('externalQuantityHolds');
    const q = e3(3);
    q.equipment[0].externalQuantityConfirmed = fn('externalQuantityAssumption')(q, q.equipment[0]);
    assert.equal(holds(q, q.equipment[0]), true);
    q.equipment[0].external.price = 0; // la regla deja de aplicarse
    q.equipment[0].quantity = 2;
    assert.equal(pendingOf(computeQuote(q), 'external_quantity'), null);
    assert.equal(holds(q, q.equipment[0]), false, 'confirmada con 3, ahora 2: el aviso "Confirmado" no se muestra');
    assert.equal(holds(q, {}), false, 'sin confirmación');
  });

  test('sin ruta ("Sin traslados" o sin distancia) no pregunta: lo pide "Ruta del proveedor" (revisión de código)', () => {
    for (const [name, patch] of [['Sin traslados', (q) => { q.logistics.notApplicable = true; }], ['sin distancia', (q) => { q.logistics.distanceKm = 0; }]]) {
      const q = e3(2);
      patch(q);
      const r = computeQuote(q);
      assert.equal(pendingOf(r, 'external_quantity'), null, name);
      assert.ok(pendingOf(r, 'external_route'), `${name}: la ruta sigue pedida`);
    }
  });
});

// ------------------------------------------------------------------ H-10
describe('P1 CIERRE · H-10: avisos de personal (revisión, no una orden de sumar personal)', () => {
  test('"Horas del personal" aclara que puede estar cubierto y se puede confirmar en el puesto', () => {
    const r = computeQuote(fixture('e3-cotizacion'));
    const it = itemOf(r, 'labor_hours');
    assert.ok(it, 'el coordinador compartido dispara el aviso (AUD-T1 C-E3-04)');
    assert.ok(it.message.startsWith(completenessEngine.LABOR_COVERAGE_MESSAGE));
    assert.match(it.message, /no hace falta sumar personas/i);
    assert.match(it.message, /La cobertura está prevista/);
  });

  test('confirmar la cobertura del puesto saca "Horas del personal"; otras horas por día vuelven a preguntar', () => {
    const assumption = fn('laborCoverageAssumption');
    const q = fixture('e3-cotizacion');
    q.labor[0].coverageConfirmed = assumption(q, q.labor[0]);
    const r = computeQuote(q);
    assert.equal(itemOf(r, 'labor_hours'), null);
    assert.equal(r.kpis.totalCost, computeQuote(fixture('e3-cotizacion')).kpis.totalCost, 'confirmar no cambia el costo');

    const longer = structuredClone(q);
    longer.activity.hoursPerActiveDay = 12;
    assert.ok(itemOf(computeQuote(longer), 'labor_hours'), 'cambió el supuesto: vuelve el aviso');
  });

  test('"Relevos" en un servicio permanente sin 24/7 no dice "24/7" y ofrece confirmar', () => {
    const q = fixture('e1-cotizacion');
    q.serviceType = 'permanent';
    q.activity.availability = 'window';
    const it = itemOf(computeQuote(q), 'relief');
    assert.ok(it);
    assert.equal(it.status, 'warning');
    assert.doesNotMatch(it.message, /24\/7/);
    assert.match(it.message, /servicio permanente/i);
    assert.match(it.message, /La cobertura está prevista/);
  });

  test('"Relevos" con disponibilidad 24/7 dice de dónde sale y que se puede cambiar en la modalidad', () => {
    const q = fixture('e2-cotizacion');
    q.activity.availability = '24/7';
    const it = itemOf(computeQuote(q), 'relief');
    assert.ok(it);
    assert.match(it.message, /disponibilidad 24\/7/i);
  });

  test('confirmar la cobertura de todos los puestos deja "Relevos" en ok, sin sumar personas ni costo', () => {
    const assumption = fn('laborCoverageAssumption');
    const q = fixture('e1-cotizacion');
    q.serviceType = 'permanent';
    const before = computeQuote(structuredClone(q));
    assert.equal(itemOf(before, 'relief').status, 'warning');
    q.labor.forEach((l) => { l.coverageConfirmed = assumption(q, l); });
    const r = computeQuote(q);
    assert.equal(itemOf(r, 'relief').status, 'ok');
    assert.equal(r.kpis.totalCost, before.kpis.totalCost);
    assert.deepEqual(q.labor.map((l) => l.peoplePerPosition), fixture('e1-cotizacion').labor.map((l) => l.peoplePerPosition), 'no se tocan las personas por posición');
  });
});

// ------------------------------------------------------------------ H-13
const productWithLabor = (overrides = {}) => {
  const settings = defaultSettings('org-p1');
  const p = createEmptyProduct({ settings, now: '2026-10-21T00:00:00.000Z', id: 'p-h13' });
  p.unitsPerBatch = 10;
  p.monthlyUnits = 100;
  p.billingTaxes = { ...p.billingTaxes, notApplicable: true };
  const line = blankProductLaborLine({ id: 'lab-1' });
  line.role = 'Operario';
  line.basicMonthly = 1200000;
  line.minutesPerBatch = 60;
  p.labor = [{ ...line, ...overrides }];
  return p;
};

describe('P1 CIERRE · H-13: supuestos ILUSTRATIVOS en productos', () => {
  test('un producto nuevo con la configuración de ejemplo marca el margen heredado; con configuración propia, no', () => {
    const demo = createEmptyProduct({ settings: defaultSettings('o'), id: 'p1' });
    assert.equal(demo.pricing.targetMarginPct, 10, 'el valor no cambia');
    assert.equal(demo.pricing.marginFromExample, true);
    const own = createEmptyProduct({ settings: { ...defaultSettings('o'), illustrative: false, defaultTargetMarginPct: 22 }, id: 'p2' });
    assert.equal(own.pricing.targetMarginPct, 22);
    assert.equal(own.pricing.marginFromExample, undefined);
  });

  test('el margen de ejemplo queda para revisar (aviso), sin cambiar el precio', () => {
    const p = productWithLabor();
    const r = computeProduct(p);
    const issue = r.issues.find((i) => i.path === 'pricing.targetMarginPct');
    assert.ok(issue, 'aviso del margen');
    assert.equal(issue.severity, 'warning');
    assert.match(issue.message, /ejemplo/i);
    const confirmed = structuredClone(p);
    delete confirmed.pricing.marginFromExample;
    const r2 = computeProduct(confirmed);
    assert.equal(r2.issues.find((i) => i.path === 'pricing.targetMarginPct'), undefined);
    assert.equal(r.pricing.suggestedPrice, r2.pricing.suggestedPrice);
  });

  test('un puesto sin convenio con las cargas genéricas de ejemplo queda para revisar', () => {
    const r = computeProduct(productWithLabor());
    const issue = r.issues.find((i) => i.path === 'labor.0.agreementId');
    assert.ok(issue);
    assert.equal(issue.severity, 'warning');
    assert.match(issue.message, /"Operario"/);
    assert.match(issue.message, /genéricas/);
  });

  test('con un convenio elegido, o con un parámetro propio, no hay aviso de cargas', () => {
    assert.equal(computeProduct(productWithLabor({ agreementId: 'cct-1' })).issues.find((i) => i.path === 'labor.0.agreementId'), undefined);
    assert.equal(computeProduct(productWithLabor({ artPct: ILLUSTRATIVE_AGREEMENT_PARAMS.artPct + 1.5 })).issues.find((i) => i.path === 'labor.0.agreementId'), undefined);
  });

  test('lo guardado antes no se reinterpreta: sin el campo, el margen no se marca y las cifras son las mismas', () => {
    const saved = fixture('e4-producto');
    const r = computeProduct(saved);
    assert.equal(r.issues.find((i) => i.path === 'pricing.targetMarginPct'), undefined);
    assert.ok(Math.abs(r.unitCost - 72209.14480575846) < 1e-6);
    assert.equal(r.pricing.suggestedPrice, 102000);
  });

  test('el producto de ejemplo ya está marcado entero: no suma estos avisos', () => {
    const chipa = exampleProduct({ settings: defaultSettings('o'), id: 'p-chipa' });
    const r = computeProduct(chipa);
    assert.equal(r.issues.find((i) => i.path === 'pricing.targetMarginPct'), undefined);
    assert.equal(r.issues.filter((i) => /\.agreementId$/.test(i.path)).length, 0);
  });
});
