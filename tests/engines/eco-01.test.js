/**
 * ECO-01 — bloqueantes de la beta encontrados en la auditoría AUD-T1 (H-01, H-02, H-03).
 *
 *  H-01  Unidades de proveedores externos: tramo ≠ viaje completo ≠ salida ≠ km.
 *        "Por viaje (cada ida o vuelta)" sigue siendo POR TRAMO (no se reinterpreta
 *        nada guardado); el viaje completo es una variante explícita
 *        (`external.tripBasis = 'round_trip'`). Un proveedor "por salida" cuya
 *        salida incluye varios viajes pide confirmación.
 *  H-02  Abono mensual ($/mes) + "Abono de disponibilidad": se sumarían dos ingresos
 *        fijos por mes. Es crítico (no es un resultado confiable) y la facturación
 *        muestra cómo se compone. Disponibilidad + tarifa por uso y mínimo mensual
 *        garantizado siguen como siempre.
 *  H-03  Puesto usado (posiciones > 0) con sueldo básico vacío o 0: crítico, con el
 *        nombre del puesto. En productos, un puesto con minutos por tanda y sin
 *        sueldo es un error.
 *
 * Regresión con cotizaciones SINTÉTICAS que reproducen los escenarios E1 a E4 de la
 * auditoría AUD-T1 (tests/fixtures/eco-01/): sólo los datos económicos; nombres,
 * notas y proveedores reemplazados por rótulos neutros (no cambian ningún número).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { computeExternalLine } from '../../js/engines/external-engine.js';
import * as commercialRules from '../../js/engines/commercial-rules-engine.js';
import { createExternalTerms } from '../../js/domain/quote-factory.js';
import * as catalogs from '../../js/domain/catalogs.js';
import { snapshotValuesFromLine } from '../../js/domain/resource-snapshot.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/eco-01/${name}.json`, import.meta.url), 'utf8'));
const approx = (actual, expected, label = '', tol = 0.01) => {
  assert.ok(Number.isFinite(actual), `${label}: no es finito (${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: esperado ${expected}, obtenido ${actual}`);
};
const pendingOf = (r, id) => (r.completeness.pending || []).find((p) => p.id === id) || null;
const carrier = (q) => q.equipment.find((e) => e.acquisition !== 'owned');

// ------------------------------------------------------------------ H-01
describe('ECO-01 · H-01: tramo, viaje completo, salida y km (E3 de AUD-T1)', () => {
  test('la base de E3 (2.900 $/km) no cambia: 41.281.757,11 y sugerida 1.377.000', () => {
    const r = computeQuote(fixture('e3-cotizacion'));
    approx(r.kpis.totalCost, 41281757.11, 'costo del mes');
    assert.equal(r.kpis.suggestedListRate, 1377000);
    assert.equal(pendingOf(r, 'external_unit_trips'), null);
  });

  test('"Por tramo" conserva su significado: 928.000 por tramo = 72 tramos (lo guardado no se reinterpreta)', () => {
    const q = fixture('e3-cotizacion');
    Object.assign(carrier(q).external, { unit: 'trip', price: 928000 });
    const r = computeQuote(q);
    approx(r.kpis.totalCost, 80094844.11, 'costo con 72 tramos');
    assert.equal(r.kpis.suggestedListRate, 2671000);
    const q2 = fixture('e3-cotizacion');
    Object.assign(carrier(q2).external, { unit: 'trip', price: 464000 });
    approx(computeQuote(q2).kpis.totalCost, 41281757.11, '464.000 por tramo = lo mismo que por km');
  });

  test('"Por viaje completo (ida y vuelta)": 928.000 por viaje = 36 viajes, el mismo costo que 2.900 $/km', () => {
    const q = fixture('e3-cotizacion');
    Object.assign(carrier(q).external, { unit: 'trip', tripBasis: 'round_trip', price: 928000 });
    const r = computeQuote(q);
    approx(r.kpis.totalCost, 41281757.11, 'costo del mes');
    assert.equal(r.kpis.suggestedListRate, 1377000);
    const p = r.model.transport.providers[0];
    approx(p.unitsPerMonth, 36, 'viajes completos facturados por mes');
    approx(p.tripsPerMonth, 36, 'viajes completos');
    approx(p.legsPerMonth, 72, 'tramos recorridos');
    approx(p.perTripNet, 928000, 'equivale por viaje completo');
    approx(p.perKmNet, 2900, 'equivale por km');
    assert.equal(p.tripBasis, 'round_trip');
  });

  test('viaje completo con mínimo y con ruta sólo de ida: cuenta viajes, no tramos', () => {
    const base = { acquisition: 'outsourced', quantity: 1, external: { unit: 'trip', tripBasis: 'round_trip', price: 100, minimumUnits: 3 } };
    const x = computeExternalLine(base, { daysPerActivation: 1, tripsPerActivation: 4, fullTripsPerActivation: 2 });
    approx(x.unitsPerActivation, 2, 'viajes por salida');
    approx(x.billedUnitsPerActivation, 3, 'rige el mínimo de 3 viajes');
    approx(x.netPerActivation, 300, 'facturado por salida');
    const leg = computeExternalLine({ ...base, external: { ...base.external, tripBasis: undefined } }, { daysPerActivation: 1, tripsPerActivation: 4, fullTripsPerActivation: 2 });
    approx(leg.unitsPerActivation, 4, 'por tramo sigue contando tramos');
  });

  test('"Por salida" con varios viajes por salida pide confirmación, nombrando salidas, viajes y el equivalente por viaje', () => {
    const q = fixture('e3-cotizacion');
    Object.assign(carrier(q).external, { unit: 'activation', price: 928000 });
    const r = computeQuote(q);
    approx(r.kpis.totalCost, 21875213.61, 'la fórmula no cambia: 18 salidas × 928.000');
    const p = pendingOf(r, 'external_unit_trips');
    assert.ok(p, 'falta el aviso de unidad');
    assert.equal(p.severity, 'review');
    assert.match(p.message, /18 salidas/);
    assert.match(p.message, /2 viajes/);
    assert.match(p.message, /36 viajes/);
    assert.match(p.message, /464\.000/);
    assert.match(p.message, /Por viaje completo/);
    assert.equal(p.focus, `equipment.${q.equipment.indexOf(carrier(q))}.external.unit`);
  });

  test('confirmado "sí, cobra por salida": el aviso se va y el costo queda igual', () => {
    const q = fixture('e3-cotizacion');
    const c = carrier(q);
    Object.assign(c.external, { unit: 'activation', price: 928000 });
    c.externalUnitConfirmed = 'activation';
    const r = computeQuote(q);
    assert.equal(pendingOf(r, 'external_unit_trips'), null);
    approx(r.kpis.totalCost, 21875213.61, 'costo');
    // Si después cambia la unidad, la confirmación anterior ya no vale.
    c.external.unit = 'day';
    c.externalUnitConfirmed = 'activation';
    assert.equal(pendingOf(computeQuote(q), 'external_unit_trips'), null, 'por día no es ambiguo');
  });

  test('"Por salida" con UN viaje por salida (on-call de siempre) no avisa: nada cambia en las cotizaciones anteriores', () => {
    const q = fixture('e2-cotizacion');
    q.equipment.push({ id: 'ext-1', name: 'Camión de apoyo', acquisition: 'outsourced', quantity: 1, external: createExternalTerms({ unit: 'activation', price: 50000 }) });
    const r = computeQuote(q);
    assert.equal(pendingOf(r, 'external_unit_trips'), null);
  });

  test('catálogo: los rótulos separan tramo, viaje completo, salida y km', () => {
    const { EXTERNAL_UNITS, EXTERNAL_TRIP_BASES = [] } = catalogs;
    const trip = EXTERNAL_UNITS.find((u) => u.id === 'trip');
    assert.match(trip.label, /tramo/i);
    assert.match(trip.label, /ida o (cada )?vuelta/i);
    assert.match(EXTERNAL_UNITS.find((u) => u.id === 'km').label, /km recorrido/i);
    const bases = EXTERNAL_TRIP_BASES.map((b) => b.id);
    assert.deepEqual(bases, ['leg', 'round_trip']);
    assert.match(EXTERNAL_TRIP_BASES.find((b) => b.id === 'round_trip').label, /viaje completo \(ida y vuelta\)/i);
  });

  test('compatibilidad: sin tripBasis es "por tramo"; tripBasis se guarda sólo con unidad "trip"; las huellas anteriores no cambian', () => {
    assert.equal(createExternalTerms({ unit: 'trip', price: 1 }).tripBasis, undefined);
    assert.equal(createExternalTerms({ unit: 'trip', tripBasis: 'round_trip', price: 1 }).tripBasis, 'round_trip');
    assert.equal(createExternalTerms({ unit: 'km', tripBasis: 'round_trip', price: 1 }).tripBasis, undefined);
    assert.equal(createExternalTerms({ unit: 'trip', tripBasis: 'cualquiera', price: 1 }).tripBasis, undefined);
    const line = { name: 'Camión', acquisition: 'outsourced', external: createExternalTerms({ unit: 'trip', price: 1 }) };
    assert.equal('tripBasis' in snapshotValuesFromLine('externalServices', line).external, false, 'la huella de un tramo es la de siempre');
    const round = { ...line, external: createExternalTerms({ unit: 'trip', tripBasis: 'round_trip', price: 1 }) };
    assert.equal(snapshotValuesFromLine('externalServices', round).external.tripBasis, 'round_trip');
  });
});

// ------------------------------------------------------------------ H-02
describe('ECO-01 · H-02: abono mensual + abono de disponibilidad (E1 de AUD-T1)', () => {
  test('la base de E1 (abono $/mes, sin abono de disponibilidad) no cambia', () => {
    const r = computeQuote(fixture('e1-cotizacion'));
    approx(r.kpis.totalCost, 26750310.14, 'costo');
    assert.equal(r.kpis.suggestedListRate, 33320000);
    assert.equal(pendingOf(r, 'monthly_fee_overlap'), null);
  });

  test('tarifa conocida 25 M + abono de disponibilidad 25 M: crítico, con la composición de la facturación', () => {
    const q = fixture('e1-cotizacion');
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 25000000;
    q.rules.availabilityFeeMonthly = 25000000;
    const r = computeQuote(q);
    // La fórmula histórica no cambia (no se elimina el abono en silencio)…
    approx(r.kpis.revenue, 50000000, 'facturación');
    // …pero el resultado deja de ser confiable.
    const p = pendingOf(r, 'monthly_fee_overlap');
    assert.ok(p, 'falta el aviso de doble abono');
    assert.equal(p.severity, 'critical');
    assert.match(p.message, /25\.000\.000/);
    assert.match(p.message, /50\.000\.000/);
    assert.equal(p.focus, 'rules.availabilityFeeMonthly');
    assert.ok(r.completeness.critical >= 1);
  });

  test('modo "calculá" con el abono sólo en "abono de disponibilidad": también crítico', () => {
    const q = fixture('e1-cotizacion');
    q.rules.availabilityFeeMonthly = 33320000;
    const p = pendingOf(computeQuote(q), 'monthly_fee_overlap');
    assert.ok(p);
    assert.equal(p.severity, 'critical');
  });

  test('modelos legítimos sin cambios: disponibilidad + tarifa por día, y mínimo mensual garantizado', () => {
    const q = fixture('e2-cotizacion');
    q.rules.availabilityFeeMonthly = 5000000;
    q.rules.minimumMonthlyGuarantee = 30000000;
    const r = computeQuote(q);
    assert.equal(pendingOf(r, 'monthly_fee_overlap'), null);
    const e1 = fixture('e1-cotizacion');
    e1.rules.minimumMonthlyGuarantee = 30000000;
    assert.equal(pendingOf(computeQuote(e1), 'monthly_fee_overlap'), null, 'abono + mínimo garantizado no es doble cobro');
  });

  test('composición de la facturación: cada componente, el ajuste por mínimo y el total (valores del motor)', () => {
    // Tarifa conocida (en modo "calculá" la sugerida ya descuenta el abono de disponibilidad).
    const q = fixture('e2-cotizacion');
    q.pricingMode = 'known_rate';
    q.pricing.knownRate = 2420000;
    q.rules.availabilityFeeMonthly = 5000000;
    const r = computeQuote(q);
    assert.equal(typeof commercialRules.revenueComposition, 'function', 'falta revenueComposition');
    const c = commercialRules.revenueComposition(r.estimate.revenue);
    const byId = Object.fromEntries(c.rows.map((x) => [x.id, x.amount]));
    approx(byId.base, 2420000 * 10, 'tarifa × días');
    approx(byId.availabilityFee, 5000000, 'abono de disponibilidad');
    assert.equal(byId.guaranteeTopUp, undefined, 'sin mínimo garantizado no hay ajuste');
    approx(c.total, r.estimate.revenue.total, 'total = facturación del motor');
    approx(c.rows.reduce((s, x) => s + x.amount, 0), c.total, 'las filas suman el total');
    assert.ok(c.rows.every((x) => x.amount > 0), 'sólo componentes que suman');
    // Con un mínimo garantizado mayor, el ajuste es una fila más y el total es el mínimo.
    q.rules.minimumMonthlyGuarantee = 60000000;
    const g = computeQuote(q);
    const cg = commercialRules.revenueComposition(g.estimate.revenue);
    approx(cg.total, g.estimate.revenue.total, 'total con mínimo');
    assert.ok(cg.total >= 60000000, 'rige el mínimo');
    approx(cg.rows.find((x) => x.id === 'guaranteeTopUp').amount, g.estimate.revenue.guaranteeTopUp, 'ajuste por mínimo');
    approx(cg.rows.reduce((s, x) => s + x.amount, 0), cg.total, 'las filas suman el total con mínimo');
  });
});

// ------------------------------------------------------------------ H-03
describe('ECO-01 · H-03: puesto sin sueldo básico (E2 de AUD-T1)', () => {
  test('la base de E2 no cambia y "Personal" sigue ok', () => {
    const r = computeQuote(fixture('e2-cotizacion'));
    approx(r.kpis.totalCost, 18584865.71, 'costo');
    assert.equal(r.kpis.suggestedListRate, 2420000);
    assert.equal(pendingOf(r, 'labor'), null);
  });

  for (const [label, patch] of [
    ['básico en 0', { basicMonthly: 0 }],
    ['básico vacío', { basicMonthly: null }],
    ['básico y adicionales vacíos', { basicMonthly: null, additionalsMonthly: null }],
  ]) {
    test(`${label}: crítico, con el nombre del puesto y el campo`, () => {
      const q = fixture('e2-cotizacion');
      Object.assign(q.labor[0], patch);
      const r = computeQuote(q);
      const p = pendingOf(r, 'labor');
      assert.ok(p, 'falta el aviso de personal');
      assert.equal(p.severity, 'critical');
      assert.match(p.message, /Operador de hidrogrúa/);
      assert.equal(p.focus, 'labor.0.basicMonthly');
      assert.deepEqual(p.targets.map((t) => t.index), [0]);
      assert.ok(r.completeness.scorePct < 100);
    });
  }

  test('un puesto sin posiciones (no se usa) no avisa; sin ningún puesto, el aviso de siempre', () => {
    const q = fixture('e2-cotizacion');
    q.labor.push({ ...q.labor[1], id: 'sin-uso', role: 'Reserva', positions: 0, basicMonthly: null });
    assert.equal(pendingOf(computeQuote(q), 'labor'), null);
    const empty = fixture('e2-cotizacion');
    empty.labor = [];
    const c = evaluateCompleteness(empty);
    const p = c.pending.find((x) => x.id === 'labor');
    assert.ok(p);
    assert.match(p.message, /No hay personal con salario cargado/);
  });

  test('productos: un puesto con minutos por tanda y sin sueldo es un error; la base de E4 no cambia', () => {
    const base = computeProduct(fixture('e4-producto'));
    approx(base.unitCost, 72209.14, 'costo por unidad');
    assert.equal(base.issues.filter((i) => i.path.endsWith('basicMonthly')).length, 0);
    const p = fixture('e4-producto');
    p.labor[0].basicMonthly = null;
    const r = computeProduct(p);
    const issue = r.issues.find((i) => i.path === 'labor.0.basicMonthly');
    assert.ok(issue, 'falta el error de sueldo');
    assert.equal(issue.severity, 'error');
    assert.match(issue.message, /Soldador/);
    const unused = fixture('e4-producto');
    unused.labor[0].basicMonthly = 0;
    unused.labor[0].minutesPerBatch = 0;
    assert.equal(computeProduct(unused).issues.filter((i) => i.path === 'labor.0.basicMonthly').length, 0, 'sin minutos no se usa');
  });
});
