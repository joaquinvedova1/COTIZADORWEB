/**
 * 0.10.0 "La unidad primero" (UI): el paso 1 pregunta en qué unidad se cobra (no los tres tipos de
 * contrato), el modo se deriva de la unidad al cambiarla, la estructura de costos se muestra por
 * categoría elegida y los rótulos nombran la unidad.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIRST_UNITS, OPEN_UNIT_LABEL, unitOptions, searchUnitOptions, applyQuoteUnit } from '../../js/ui/views/quote-steps/unit-choice.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';
import { guaranteeLoaded } from '../../js/ui/views/quote-steps/shared.js';
import { unitBadgeText } from '../../js/ui/views/quote-editor.js';
import { displayCostRows } from '../../js/ui/cost-breakdown.js';
import { createBlankQuote } from '../../js/domain/quote-factory.js';
import { contractOf } from '../../js/domain/contract.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person, material, resetIds } from '../lab/lib/build.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
/** Sólo el código (sin comentarios), para buscar textos de pantalla. */
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('paso 1: primero la unidad', () => {
  test('un solo desplegable (0.15.0): $/mes, $/día, $/hora y $/trabajo primero; al final "$/ otro…"', () => {
    assert.deepEqual(FIRST_UNITS.map((u) => [u.value, u.label]), [
      ['month', '$/mes'], ['day', '$/día'], ['hour', '$/hora'], ['job', '$/trabajo'],
    ]);
    const options = unitOptions(billingUnitOf({ unit: 'day' }));
    assert.deepEqual(options.slice(0, 4).map((o) => o.value), ['month', 'day', 'hour', 'job']);
    const last = options[options.length - 1];
    assert.equal(last.value, 'custom');
    assert.equal(last.label, OPEN_UNIT_LABEL);
    // Cada unidad una sola vez (no hay tarjetas y, además, un buscador con las mismas).
    assert.equal(new Set(options.map((o) => o.value)).size, options.length);
    assert.ok(!options.some((o) => o.value === 'milestone'), '"hito" sólo si ya está elegido');
    assert.ok(unitOptions(billingUnitOf({ unit: 'milestone' })).some((o) => o.value === 'milestone'));
  });

  test('la unidad propia se ve con su nombre y lo que se escribe se puede usar como unidad', () => {
    const named = unitOptions(billingUnitOf({ unit: 'custom', unitName: 'diagnóstico' }));
    // La unidad propia con nombre va primera; después, mes, día, hora y trabajo siempre a la vista.
    assert.equal(named[0].label, '$/diagnóstico');
    assert.deepEqual(named.slice(1, 5).map((o) => o.value), ['month', 'day', 'hour', 'job']);
    const chosen = unitOptions(billingUnitOf({ unit: 'trip' }));
    assert.equal(chosen[0].value, 'trip');
    assert.equal(new Set(chosen.map((o) => o.value)).size, chosen.length);
    const options = unitOptions(billingUnitOf({ unit: 'day' }));
    // Sin texto: todas. Con una unidad del catálogo: la encuentra y no ofrece duplicarla.
    assert.equal(searchUnitOptions(options, '').length, options.length);
    const viaje = searchUnitOptions(options, 'viaje');
    assert.ok(viaje.some((o) => o.value === 'trip'));
    assert.ok(!viaje.some((o) => String(o.value).startsWith('__typed:')), 'viaje ya existe: no se ofrece como propia');
    // Algo que no está: se ofrece usarlo como unidad propia.
    const own = searchUnitOptions(options, 'diagnóstico');
    assert.deepEqual(own.map((o) => [o.value, o.label, o.hint]), [['__typed:diagnóstico', '$/diagnóstico', 'Usar como unidad propia']]);
    // "$/" escrito adelante no forma parte del nombre.
    assert.equal(searchUnitOptions(options, '$/ inspección')[0].label, '$/inspección');
  });

  test('no ofrece los tres tipos de contrato como elección', () => {
    const service = code('js/ui/views/quote-steps/service.js');
    const unitChoice = code('js/ui/views/quote-steps/unit-choice.js');
    assert.doesNotMatch(service, /¿Cómo te paga el cliente\?/);
    assert.doesNotMatch(service, /CONTRACT_MODES/);
    assert.match(unitChoice, /¿En qué unidad le cobrás al cliente\?/);
    // 0.15.0: sin tarjetas "Por mes / Por trabajo…" ni "Otra unidad…": sólo el desplegable.
    assert.doesNotMatch(unitChoice, /Otra unidad…|choiceGroup|'Por unidad'/);
    assert.match(unitChoice, /searchSelectField/);
    [service, unitChoice].forEach((s) => assert.doesNotMatch(s, /Fijo mensual|on call|Por servicio prestado|Precio cerrado/));
    // "Cómo se cobra" ya no tiene el selector de unidad: sólo dice cuál es y lleva al paso 1.
    const modality = code('js/ui/views/quote-steps/modality.js');
    assert.doesNotMatch(modality, /¿En qué unidad cobrás\?/);
    assert.doesNotMatch(modality, /¿Cómo se llama tu unidad\?/);
    assert.match(modality, /Se cambia en «/);
  });
});

describe('cambiar la unidad deriva el modo', () => {
  test('por día → por trabajo: precio del trabajo, arranca en 1 trabajo por mes', () => {
    const q = createBlankQuote({ organizationId: 'org', id: 'q1' });
    assert.equal(contractOf(q).mode, 'on_demand');
    q.activity.billableQuantityPerMonth = null;
    applyQuoteUnit(q, 'job');
    assert.equal(q.unit, 'job');
    assert.equal(q.contract.mode, 'closed');
    assert.equal(q.serviceType, 'lump_sum');
    assert.equal(q.activity.billableQuantityPerMonth, 1);
    assert.deepEqual(q.contract.components, ['labor'], 'lo que incluye no cambia');
  });

  test('por mes → monthly; por unidad (diagnóstico) → on_demand', () => {
    const q = createBlankQuote({ organizationId: 'org', id: 'q2' });
    applyQuoteUnit(q, 'month');
    assert.equal(q.contract.mode, 'monthly');
    q.unitName = 'diagnóstico';
    applyQuoteUnit(q, 'custom');
    assert.equal(q.contract.mode, 'on_demand');
    assert.equal(unitBadgeText(q), 'Por diagnóstico');
  });

  test('las horas extra "algunas horas" se limpian con aviso si cambia la base (por mes ↔ por trabajo)', () => {
    const q = createBlankQuote({ organizationId: 'org', id: 'q3' });
    applyQuoteUnit(q, 'month');
    q.overtimeWork = { mode: 'some', hours50: 10, hours100: 2 };
    const notices = applyQuoteUnit(q, 'job');
    assert.equal(q.overtimeWork.hours50, 0);
    assert.ok(notices.some((n) => /horas extra/.test(n)));
  });

  test('lo cargado en la unidad anterior se limpia (V-03): 4.000 km no son 4.000 viajes', () => {
    resetIds();
    const q = service({ serviceType: 'transport', unit: 'km', labor: [person()], activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 200 } });
    const notices = applyQuoteUnit(q, 'trip');
    assert.equal(q.activity.billableQuantityPerMonth, null);
    assert.ok(notices.length > 0);
  });
});

describe('opciones que sólo aparecen si ya estaban cargadas', () => {
  test('mínimo mensual garantizado', () => {
    assert.equal(guaranteeLoaded({ rules: {} }), false);
    assert.equal(guaranteeLoaded({ rules: { minimumMonthlyGuarantee: 0, minimumGuaranteeUnits: null } }), false);
    assert.equal(guaranteeLoaded({ rules: { minimumMonthlyGuarantee: 3_000_000 } }), true);
    assert.equal(guaranteeLoaded({ rules: { minimumGuaranteeUnits: 20 } }), true);
  });
});

describe('estructura de costos por categoría elegida', () => {
  function quote() {
    resetIds();
    const q = service({ serviceType: 'on_call', unit: 'custom', unitName: 'diagnóstico', labor: [person()], activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2, hoursPerActiveDay: 8, availableDaysPerMonth: 30 } });
    q.materialsNotApplicable = false;
    q.contract = { mode: 'on_demand', components: ['labor', 'tools', 'supplies', 'ppe'] };
    q.materials = [
      material({ description: 'Multímetro', quantity: 1, unitCost: 60_000, component: 'tools' }),
      material({ description: 'Precintos', quantity: 1, unitCost: 10_000, component: 'supplies' }),
    ];
    return q;
  }

  test('Materiales se reemplaza por sus categorías; las elegidas sin líneas van en $ 0; nada de renglones en $ 0 no elegidos', () => {
    const q = quote();
    const r = computeQuote(q);
    const rows = displayCostRows(r.eecc, q.contract.components);
    const cats = rows.map((x) => x.category);
    assert.ok(!cats.includes('materials'));
    assert.deepEqual(cats.filter((c) => c.startsWith('materials:')), ['materials:tools', 'materials:supplies', 'materials:ppe']);
    assert.equal(rows.find((x) => x.category === 'materials:ppe').amount, 0);
    assert.equal(rows.find((x) => x.category === 'materials:ppe').label, 'EPP');
    // Sin vehículos ni equipos elegidos (y en $ 0): no hay renglón de equipos ni de combustible.
    assert.ok(!cats.includes('equipment'));
    assert.ok(!cats.includes('fuel'));
    assert.ok(cats.includes('labor'));
    ['structure', 'financial', 'contingency'].forEach((c) => assert.ok(cats.includes(c), c));
    // La suma de lo mostrado es el total del motor.
    const sum = rows.reduce((a, x) => a + x.amount, 0);
    assert.ok(Math.abs(sum - r.eecc.total) < 1e-6);
  });

  test('sin componentes elegidos (cotización vieja) no se esconde nada', () => {
    const q = quote();
    const r = computeQuote(q);
    const rows = displayCostRows(r.eecc, null);
    assert.ok(rows.some((x) => x.category === 'fuel'));
    assert.ok(rows.some((x) => x.category === 'materials:tools'));
  });
});
