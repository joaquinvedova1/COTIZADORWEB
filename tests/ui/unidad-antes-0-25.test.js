/**
 * 0.25.0 (PLAN-2026-029, PR 4): la unidad de cobro antes de crear la cotización (W-12, W-13, W-09).
 *
 * - "Nuevo servicio" pregunta "¿Cómo le cobrás al cliente?" con 4 botones y "Otra unidad…".
 * - createBlankQuote(options, { unit }) da el mismo objeto que crear en blanco y elegir la unidad
 *   en el paso 1 (applyQuoteUnit).
 * - El buscador de unidades muestra una lista corta sin escribir; al escribir, todo el catálogo.
 * - Las listas muestran la unidad ("Por hora"), no el tipo de servicio interno.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBlankQuote, withTimeCostBasis } from '../../js/domain/quote-factory.js';
import { BILLING_UNITS, billingUnitOf } from '../../js/domain/billing-units.js';
import { contractOf } from '../../js/domain/contract.js';
import { applyQuoteUnit, unitOptions, searchUnitOptions, unitShownWithoutTyping, COMMON_UNITS } from '../../js/ui/views/quote-steps/unit-choice.js';
import { START_UNITS } from '../../js/ui/views/quotes-list.js';
import { templateUnitLabel } from '../../js/ui/views/services.js';
import { computeQuote } from '../../js/engines/quote-engine.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const opts = () => ({ organizationId: 'org', now: '2026-11-24T00:00:00.000Z', id: 'q-1', code: 'COT-1' });

describe('createBlankQuote con la unidad elegida', () => {
  for (const unit of ['hour', 'day', 'month', 'job']) {
    test(`${unit}: igual que crear en blanco y elegir la unidad en el paso 1`, () => {
      const viaStep = createBlankQuote(opts());
      const notices = applyQuoteUnit(viaStep, unit);
      assert.deepEqual(notices, []);
      const direct = createBlankQuote(opts(), { unit });
      assert.deepEqual(direct, viaStep);
      // Y los números son los mismos (con el costeo por tiempo que aplica el servicio al crear).
      assert.deepEqual(computeQuote(withTimeCostBasis(structuredClone(direct))).kpis, computeQuote(withTimeCostBasis(structuredClone(viaStep))).kpis);
    });
  }
  test('"Por hora" nace por servicio prestado (on_demand) y por trabajo con 1 trabajo por mes', () => {
    assert.equal(contractOf(createBlankQuote(opts(), { unit: 'hour' })).mode, 'on_demand');
    assert.equal(createBlankQuote(opts(), { unit: 'hour' }).unit, 'hour');
    const job = createBlankQuote(opts(), { unit: 'job' });
    assert.equal(contractOf(job).mode, 'closed');
    assert.equal(job.activity.billableQuantityPerMonth, 1);
    assert.equal(contractOf(createBlankQuote(opts(), { unit: 'month' })).mode, 'monthly');
  });
  test('sin unidad (o una que no existe) queda como siempre: por día', () => {
    assert.deepEqual(createBlankQuote(opts(), {}), createBlankQuote(opts()));
    assert.deepEqual(createBlankQuote(opts(), { unit: 'inventada' }), createBlankQuote(opts()));
    assert.deepEqual(createBlankQuote(opts(), { unit: 'custom' }), createBlankQuote(opts()));
    assert.equal(createBlankQuote(opts()).unit, 'day');
  });
});

describe('"¿Cómo le cobrás al cliente?" en "Nuevo servicio"', () => {
  test('4 botones en este orden, nada preelegido, y "Otra unidad…"', () => {
    assert.deepEqual(START_UNITS.map((u) => [u.unit, u.title]), [['hour', 'Por hora'], ['day', 'Por día'], ['month', 'Por mes'], ['job', 'Por trabajo']]);
    const src = source('js/ui/views/quotes-list.js');
    assert.match(src, /'¿Cómo le cobrás al cliente\?'/);
    assert.match(src, /title: 'Otra unidad…'/);
    assert.match(src, /\?campo=unit/);
    assert.doesNotMatch(src, /'Empezar en blanco'/);
  });
  test('el servicio pasa la unidad a createBlankQuote', () => {
    assert.match(source('js/services/quote-service.js'), /createBlankQuote\(options, \{ unit, unitPending \}\)/);
  });
});

describe('buscador de unidades: lista corta sin escribir', () => {
  const options = unitOptions(billingUnitOf({ unit: 'day' }));
  test('sin escribir: las 4 de siempre, las comunes y "otra unidad"', () => {
    const shown = searchUnitOptions(options, '', { current: 'day', sector: null }).map((o) => o.value);
    assert.deepEqual(shown.slice(0, 4), ['month', 'day', 'hour', 'job']);
    COMMON_UNITS.forEach((id) => assert.ok(shown.includes(id), id));
    assert.ok(shown.includes('custom'));
    ['manday', 'equipment_day', 'equipment_hour', 'shift', 'guard', 'mmbtu', 'stage', 'kva_day'].forEach((id) => assert.ok(!shown.includes(id), id));
    assert.ok(shown.length <= 16, `${shown.length} unidades`);
  });
  test('al escribir aparecen todas: MMBTU, jornal, día-equipo, etapa', () => {
    assert.ok(searchUnitOptions(options, 'mmbtu', { current: 'day' }).some((o) => o.value === 'mmbtu'));
    assert.ok(searchUnitOptions(options, 'jornal', { current: 'day' }).some((o) => o.value === 'manday'));
    assert.ok(searchUnitOptions(options, 'día-equipo', { current: 'day' }).some((o) => o.value === 'equipment_day'));
    assert.ok(searchUnitOptions(options, 'etapa', { current: 'day' }).some((o) => o.value === 'stage'));
  });
  test('la unidad elegida se ve siempre, aunque no sea común', () => {
    const chosen = unitOptions(billingUnitOf({ unit: 'manday' }));
    assert.ok(searchUnitOptions(chosen, '', { current: 'manday' }).some((o) => o.value === 'manday'));
  });
  test('petróleo y gas, minería o energía: pozos y energía se ven sin escribir', () => {
    for (const sector of ['oil_gas', 'mining', 'energy']) {
      const shown = searchUnitOptions(options, '', { current: 'day', sector }).map((o) => o.value);
      ['stage', 'well', 'mmbtu', 'kva_day'].forEach((id) => assert.ok(shown.includes(id), `${sector}: ${id}`));
    }
    const other = searchUnitOptions(options, '', { current: 'day', sector: 'construction' }).map((o) => o.value);
    assert.ok(!other.includes('stage') && !other.includes('mmbtu'));
  });
  test('no se borra ninguna unidad del catálogo', () => {
    assert.ok(BILLING_UNITS.length >= 50);
    const all = new Set(options.map((o) => o.value));
    BILLING_UNITS.filter((u) => !u.custom && u.id !== 'milestone').forEach((u) => assert.ok(all.has(u.id), u.id));
    assert.equal(unitShownWithoutTyping(null), false);
  });
  test('el paso 1 pasa la unidad elegida y el sector al buscador', () => {
    assert.match(source('js/ui/views/quote-steps/unit-choice.js'), /searchUnitOptions\(options, query, pending \? \{ current: null, sector: ctx\.sector \|\| null, preferCommon: true \} : \{ current: info\.id, sector: ctx\.sector \|\| null \}\)/);
  });
});

describe('revisión 0.25.0 (UX C1): "Otra unidad…" no nace "por día" elegida', () => {
  test('la cotización se guarda por día con la marca de unidad pendiente; los números son los mismos', () => {
    const pending = createBlankQuote(opts(), { unitPending: true });
    assert.equal(pending.unit, 'day');
    assert.equal(pending.unitPending, true);
    const { unitPending, ...rest } = pending;
    assert.deepEqual(rest, createBlankQuote(opts()));
    const a = computeQuote(withTimeCostBasis(structuredClone(pending)));
    const b = computeQuote(withTimeCostBasis(createBlankQuote(opts())));
    assert.deepEqual(a.kpis, b.kpis);
    assert.equal(a.completeness.scorePct, b.completeness.scorePct);
    assert.deepEqual(a.completeness.pending.map((x) => x.id), b.completeness.pending.map((x) => x.id));
  });
  test('con una unidad elegida no hay marca', () => {
    assert.ok(!('unitPending' in createBlankQuote(opts(), { unit: 'hour', unitPending: true })));
  });
  test('mientras falta, un aviso informativo; al elegir la unidad se borra', () => {
    const q = withTimeCostBasis(createBlankQuote(opts(), { unitPending: true }));
    const n = computeQuote(structuredClone(q)).completeness.notices.find((x) => x.id === 'unit_pending');
    assert.ok(n);
    assert.equal(n.severity, 'info');
    assert.equal(n.message, 'Todavía no elegiste la unidad. Si no elegís, queda por día.');
    applyQuoteUnit(q, 'trip');
    assert.ok(!('unitPending' in q));
    assert.ok(!computeQuote(q).completeness.notices.some((x) => x.id === 'unit_pending'));
  });
  test('el buscador arranca vacío y muestra primero las comunes', () => {
    const shown = searchUnitOptions(unitOptions(billingUnitOf({ unit: 'day' })), '', { current: null, sector: null, preferCommon: true }).map((o) => o.value);
    assert.deepEqual(shown.slice(0, COMMON_UNITS.length), [...COMMON_UNITS]);
    assert.deepEqual(shown.slice(COMMON_UNITS.length, COMMON_UNITS.length + 4), ['month', 'day', 'hour', 'job']);
    const src = source('js/ui/views/quote-steps/unit-choice.js');
    assert.match(src, /value: pending \? null : info\.id,/);
    assert.match(src, /'Escribí: viaje, m³, km, tonelada…'/);
    assert.match(source('js/ui/views/quotes-list.js'), /createQuote\(\{ templateId, unit, unitPending: pickUnit \}\)/);
  });
});

describe('W-13: la unidad en lugar del tipo de servicio interno', () => {
  test('una plantilla se presenta por su unidad', () => {
    assert.equal(templateUnitLabel({ defaults: { unit: 'hour' } }), 'Por hora');
    assert.equal(templateUnitLabel({ defaults: { unit: 'm3' } }), 'Por m³');
    assert.equal(templateUnitLabel({ serviceType: 'on_call' }), null);
    // Sin unidad guardada nace por día: la etiqueta lo dice (revisión 0.25.0).
    assert.equal(templateUnitLabel({ defaults: {} }), 'Por día');
  });
  test('listas, Inicio y Servicios no muestran SERVICE_TYPES', () => {
    ['js/ui/views/quotes-list.js', 'js/ui/views/dashboard.js', 'js/ui/views/services.js'].forEach((p) => {
      assert.doesNotMatch(source(p), /labelOf\(SERVICE_TYPES/, p);
    });
  });
});

describe('W-09: "Más detalle" del ritmo sólo con campos', () => {
  test('sin campos adentro no se dibuja (sólo tenía cifras repetidas)', () => {
    const src = source('js/ui/views/quote-steps/modality.js');
    assert.match(src, /!foldHasFields \? longJobNote\(\) : kit\.advanced\(/);
    assert.doesNotMatch(src, /oohInFold/);
  });
});
