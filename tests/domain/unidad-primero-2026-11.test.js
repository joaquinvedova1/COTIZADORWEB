/**
 * 0.10.0 "La unidad primero" (pedido del dueño, 2026-11-18): lo primero que se elige es la unidad
 * en que se cobra; el modo del contrato se deriva de ella. Las categorías de gasto no se repiten
 * (químicos → insumos, residuos → otros costos) y el costo de cada categoría se ve en la EECC
 * como desglose del renglón Materiales, sin cambiar ningún total.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  modeForUnit, contractWithComponents, componentsOf, contractOf, contractLabel, componentsServiceLabel, billingUnitPhrase,
  quotedItemText, lineComponentOf, SERVICE_COMPONENTS, LINE_COMPONENT_IDS,
} from '../../js/domain/contract.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeMaterialLine, computeOtherCostLine, computeMaterials } from '../../js/engines/materials-engine.js';
import { componentCostAt, costAtActivity } from '../../js/engines/cost-engine.js';
import { validateState } from '../../js/data/schema.js';
import { SCHEMA_VERSION } from '../../js/config.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { service, person, material, otherCost, resetIds } from '../lab/lib/build.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} ≈ ${b}`);

/** Técnico por hora con herramientas, insumos, materiales, EPP y otros costos. */
function withCategories({ fullActivations = false, unit = 'hour' } = {}) {
  resetIds();
  const q = service({
    serviceType: 'on_call', unit,
    activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 8, availableDaysPerMonth: 30, daysPerActivation: 3, fullActivations },
    labor: [person({ role: 'Técnico', positions: 1, basicMonthly: 1_500_000 })],
  });
  q.materialsNotApplicable = false;
  q.contract = contractWithComponents({ mode: modeForUnit(unit) }, ['labor', 'tools', 'supplies', 'ppe', 'other']);
  q.materials = [
    material({ id: 'm1', description: 'Llave', quantity: 1, unitCost: 100_000, basis: 'per_month', component: 'tools' }),
    material({ id: 'm2', description: 'Disco', quantity: 2, unitCost: 5_000, basis: 'per_active_day', component: 'supplies' }),
    material({ id: 'm3', description: 'Caño', quantity: 3, unitCost: 7_000, basis: 'per_activation' }),
    material({ id: 'm4', description: 'Traje', quantity: 1, unitCost: 50_000, basis: 'per_month', component: 'ppe' }),
  ];
  q.otherCosts = [
    otherCost({ id: 'o1', description: 'Permiso', amount: 30_000, behavior: 'per_activation' }),
    otherCost({ id: 'o2', description: 'Laboratorio', amount: 80_000, behavior: 'fixed_monthly', category: 'external' }),
  ];
  return q;
}

describe('modo derivado de la unidad', () => {
  test('por mes → monthly; por trabajo o hito → closed; cualquier otra → on_demand', () => {
    assert.equal(modeForUnit('month'), 'monthly');
    assert.equal(modeForUnit('job'), 'closed');
    assert.equal(modeForUnit('milestone'), 'closed');
    ['hour', 'day', 'custom', 'trip', 'm3', 'km', 'manhour', 'unit', undefined, null, 'cualquiera'].forEach((u) => assert.equal(modeForUnit(u), 'on_demand', String(u)));
  });

  test('"Vas a cotizar": tarifa por mes, precio del trabajo, $ por diagnóstico', () => {
    assert.equal(quotedItemText({ unit: 'month' }), 'tarifa por mes');
    assert.equal(quotedItemText({ unit: 'job' }), 'precio del trabajo');
    assert.equal(quotedItemText({ unit: 'hour' }), '$ por hora');
    assert.equal(quotedItemText({ unit: 'custom', unitName: 'diagnóstico' }), '$ por diagnóstico');
    assert.equal(quotedItemText({ unit: 'custom' }), '$ por unidad');
  });
});

describe('categorías de gasto sin redundancias', () => {
  test('10 categorías: químicos y residuos ya no se ofrecen', () => {
    assert.deepEqual(SERVICE_COMPONENTS.map((c) => c.id), ['labor', 'vehicle', 'machinery', 'subcontract', 'tools', 'supplies', 'materials', 'ppe', 'travel', 'other']);
    assert.deepEqual(SERVICE_COMPONENTS.map((c) => c.label), ['Personal', 'Vehículos', 'Equipos y maquinaria', 'Servicios de terceros', 'Herramientas', 'Insumos y consumibles', 'Materiales', 'EPP especial', 'Viáticos y alojamiento', 'Otros gastos']);
    assert.match(SERVICE_COMPONENTS.find((c) => c.id === 'supplies').hint, /químicos/);
  });

  test('un contrato guardado con chemicals / waste se lee como insumos / otros costos, sin repetidos', () => {
    const saved = { mode: 'on_demand', components: ['labor', 'chemicals', 'supplies', 'waste', 'other'] };
    assert.deepEqual(componentsOf(saved), ['labor', 'supplies', 'other']);
    assert.deepEqual(contractWithComponents(saved, saved.components).components, ['labor', 'supplies', 'other']);
    assert.deepEqual(componentsOf({ components: ['chemicals'] }), ['supplies']);
    assert.deepEqual(componentsOf({ components: ['waste'] }), ['other']);
    assert.equal(contractOf({ contract: { mode: 'on_demand', components: ['chemicals'] } }).labor, false);
  });

  test('cada línea tiene su categoría: sin dato, material → materials y otro costo → other', () => {
    assert.equal(lineComponentOf({}, 'material'), 'materials');
    assert.equal(lineComponentOf({}, 'other'), 'other');
    assert.equal(lineComponentOf({ component: 'ppe' }, 'material'), 'ppe');
    assert.equal(lineComponentOf({ component: 'chemicals' }, 'material'), 'materials', 'un id desconocido no se inventa');
    assert.equal(computeMaterialLine({ quantity: 1, unitCost: 10 }).component, 'materials');
    assert.equal(computeMaterialLine({ quantity: 1, unitCost: 10, component: 'tools' }).component, 'tools');
    assert.equal(computeOtherCostLine({ amount: 10 }).component, 'other');
    const m = computeMaterials([{ quantity: 1, unitCost: 100, component: 'ppe' }, { quantity: 2, unitCost: 10, basis: 'per_active_day' }]);
    assert.equal(m.byComponent.ppe.fixedMonthly, 100);
    assert.equal(m.byComponent.materials.variablePerActiveDay, 20);
    assert.deepEqual(Object.keys(m.byComponent), [...LINE_COMPONENT_IDS]);
  });

  test('el campo component se valida (opcional, de la lista)', () => {
    const state = { ...createDemoState(), schemaVersion: SCHEMA_VERSION };
    const q = state.quotes[0];
    q.materials = [{ id: 'x1', description: 'EPP', component: 'ppe' }];
    q.otherCosts = [{ id: 'x2', description: 'Otro', category: 'materials', behavior: 'fixed_monthly', amount: 1 }];
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state).errors));
    q.materials[0].component = 'chemicals';
    const bad = validateState(state);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /component/.test(e)));
  });
});

describe('EECC: desglose del renglón Materiales por categoría', () => {
  for (const fullActivations of [false, true]) {
    test(`la suma de children es el monto del renglón y la de sus % es su % (cada salida completa: ${fullActivations})`, () => {
      const r = computeQuote(withCategories({ fullActivations }));
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      assert.ok(Array.isArray(row.children) && row.children.length > 0);
      assert.deepEqual(row.children.map((c) => c.component), ['tools', 'supplies', 'materials', 'ppe', 'other']);
      close(row.children.reduce((a, c) => a + c.amount, 0), row.amount, 'montos');
      close(row.children.reduce((a, c) => a + c.displayPct, 0), row.displayPct, '%');
      assert.equal(row.children.find((c) => c.component === 'ppe').label, 'EPP especial');
      // El laboratorio va a "Equipos y servicios externos" (su categoría de la EECC), no a Materiales.
      const other = row.children.find((c) => c.component === 'other');
      const permits = componentCostAt(r.model, r.activity.activeDaysPerMonth, { category: 'materials' }).other.amount;
      close(other.amount, permits);
      // En el paso Materiales la sección "Otros costos" suma los dos (permiso + laboratorio).
      const all = componentCostAt(r.model, r.activity.activeDaysPerMonth);
      assert.ok(all.other.amount > other.amount + 79_999);
    });
  }

  test('los totales no cambian: el total de la EECC es el costo del motor', () => {
    const r = computeQuote(withCategories());
    const at = costAtActivity(r.model, r.activity.activeDaysPerMonth);
    close(r.eecc.total, at.total);
    close(r.eecc.rows.reduce((a, x) => a + x.amount, 0), at.total);
  });

  test('una cotización sin categorías en sus líneas: un solo hijo "Materiales"', () => {
    const q = withCategories();
    q.materials.forEach((m) => { delete m.component; });
    q.otherCosts = [];
    const row = computeQuote(q).eecc.rows.find((x) => x.category === 'materials');
    assert.deepEqual(row.children.map((c) => c.component), ['materials']);
    close(row.children[0].amount, row.amount);
  });

  test('la demo abre y su EECC sigue cerrando', () => {
    const state = createDemoState();
    state.quotes.forEach((q) => {
      const r = computeQuote(q);
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      if (row.children) close(row.children.reduce((a, c) => a + c.amount, 0), row.amount);
    });
  });
});

describe('rótulos de listado con la unidad', () => {
  test('"Por hora · personal + vehículos" (no "Por servicio (on call)")', () => {
    const contract = contractWithComponents({ mode: 'on_demand' }, ['labor', 'vehicle']);
    assert.equal(contractLabel({ contract, unit: 'hour' }), 'Por hora · personal + vehículos');
    assert.equal(componentsServiceLabel({ contract, unit: 'month' }), 'Por mes · personal + vehículos');
    assert.equal(componentsServiceLabel({ contract, unit: 'job' }), 'Por trabajo · personal + vehículos');
    assert.equal(componentsServiceLabel({ contract, unit: 'custom', unitName: 'diagnóstico' }), 'Por diagnóstico · personal + vehículos');
    assert.equal(billingUnitPhrase({ unit: 'day' }), 'Por día');
    assert.doesNotMatch(contractLabel({ contract, unit: 'hour' }), /on call|Fijo mensual|Precio cerrado/i);
  });
});
