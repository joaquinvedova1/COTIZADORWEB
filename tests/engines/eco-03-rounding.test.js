/**
 * ECO-03 (PLAN-2026-020, VAL-01-F1): redondeo comercial de la tarifa sugerida.
 *
 * Compatibilidad (se escribió ANTES de cambiar la regla y tiene que seguir en verde después): una
 * cotización guardada sin `roundingMode` usa el múltiplo fijo que tiene guardado, en las 18 unidades
 * (17 + la propia) y con 0, 1, 10 y 1.000: la sugerida es la objetivo redondeada hacia arriba a ese
 * múltiplo, exactamente como en `main`.
 *
 * Regla nueva: automático (el múltiplo de 1, 10, 100… más grande que no suba la objetivo más del tope, 1 %
 * por defecto) para empresas y cotizaciones nuevas, con el margen objetivo y el real a la vista.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { createEmptyQuote, createQuoteFromTemplate, defaultSettings } from '../../js/domain/quote-factory.js';
import { autoRoundingStep, quoteRounding, roundingStepFor, settingsRounding, roundingMaxPctOf, roundingModeChange, DEFAULT_ROUNDING_MAX_PCT } from '../../js/domain/rounding.js';
import { createSettingsService } from '../../js/services/settings-service.js';
import { roundingText, marginPairText, roundingWarning } from '../../js/ui/result-text.js';
import { BILLING_UNITS } from '../../js/domain/billing-units.js';
import { roundUpToStep } from '../../js/core/money.js';
import { service, person, owned, LAB_SETTINGS } from '../lab/lib/build.js';

/** Actividad de cada unidad (sintética): cuánto se factura por mes y cuánto se hace por día de trabajo. */
const ACTIVITY = {
  hour: { serviceType: 'on_call', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 } },
  day: { serviceType: 'on_call', activity: { activeDaysPerMonth: 8, hoursPerActiveDay: 8 } },
  month: { serviceType: 'permanent', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10 } },
  call: { serviceType: 'on_call', activity: { billableQuantityPerMonth: 4, daysPerActivation: 2 } },
  shift: { serviceType: 'crew', activity: { billableQuantityPerMonth: 44, unitsPerActiveDay: 2, hoursPerActiveDay: 24 } },
  trip: { serviceType: 'transport', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2 } },
  km: { serviceType: 'transport', activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400 } },
  ton: { serviceType: 'transport', activity: { billableQuantityPerMonth: 1200, unitsPerActiveDay: 120 } },
  tonkm: { serviceType: 'transport', activity: { billableQuantityPerMonth: 75000, unitsPerActiveDay: 3750 } },
  m3: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 5000, unitsPerActiveDay: 250 } },
  unit: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 300, unitsPerActiveDay: 15 } },
  kg: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 40000, unitsPerActiveDay: 2000 } },
  meter: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 3000, unitsPerActiveDay: 150 } },
  m2: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 200 } },
  lot: { serviceType: 'per_unit', activity: { billableQuantityPerMonth: 40, unitsPerActiveDay: 2 } },
  job: { serviceType: 'turnkey', activity: { billableQuantityPerMonth: 1, daysPerActivation: 10 } },
  milestone: { serviceType: 'lump_sum', activity: { billableQuantityPerMonth: 3, daysPerActivation: 20, unitsPerActivation: 3 } },
  custom: { serviceType: 'configurable', unitName: 'pozo', activity: { billableQuantityPerMonth: 6, unitsPerActiveDay: 0.5, daysPerActivation: 2 } },
};

/** Cotización base de una unidad, con el redondeo que se le pase en `pricing`. */
export function unitQuote(unitId, pricing = {}) {
  const a = ACTIVITY[unitId];
  return service({
    id: `eco03-${unitId}`,
    unit: unitId,
    unitName: a.unitName || '',
    serviceType: a.serviceType,
    activity: { availableDaysPerMonth: 30, ...a.activity },
    labor: [person({ role: 'Operador' })],
    equipment: [owned({ name: 'Camión', replacementValue: 300000000, usefulLifeYears: 10 })],
    pricing,
  });
}

/** Saca `roundingMode` y `roundingMaxPct` (como una cotización guardada antes de ECO-03). */
function legacy(quote) {
  const q = structuredClone(quote);
  delete q.pricing.roundingMode;
  delete q.pricing.roundingMaxPct;
  return q;
}

describe('ECO-03 · compatibilidad: lo guardado sin roundingMode no cambia (18 unidades × 0/1/10/1.000)', () => {
  test('las 18 opciones de unidad tienen su cotización de prueba', () => {
    assert.deepEqual(Object.keys(ACTIVITY).sort(), BILLING_UNITS.map((u) => u.id).sort());
  });

  for (const unit of BILLING_UNITS.map((u) => u.id)) {
    test(`${unit}: sugerida = objetivo redondeada hacia arriba al múltiplo guardado`, () => {
      for (const step of [0, 1, 10, 1000]) {
        const k = computeQuote(legacy(unitQuote(unit, { roundingStep: step }))).kpis;
        assert.ok(Number.isFinite(k.targetListRate) && k.targetListRate > 0, `${unit}/${step}: hay tarifa objetivo`);
        assert.equal(k.suggestedListRate, roundUpToStep(k.targetListRate, step), `${unit}/${step}`);
        assert.ok(k.suggestedListRate >= k.targetListRate - 1e-9, `${unit}/${step}: nunca baja`);
        assert.equal(k.commercialSource, 'suggested');
        assert.equal(k.commercialListRate, k.suggestedListRate, `${unit}/${step}: se ofrece la sugerida`);
      }
    });
  }

  test('una empresa con sus parámetros confirmados conserva su múltiplo en las cotizaciones nuevas', () => {
    for (const step of [0, 1, 10, 1000, 500]) {
      const q = createEmptyQuote({ organizationId: 'org', settings: { ...LAB_SETTINGS, roundingStep: step, illustrative: false } });
      assert.equal(q.pricing.roundingStep, step);
      assert.equal(computeQuote(legacy(q)).kpis.suggestedListRate, computeQuote(q).kpis.suggestedListRate, `${step}: igual que sin roundingMode`);
    }
  });
});

// ------------------------------------------------------------------ regla nueva (ECO-03)

describe('ECO-03 · redondeo automático: el múltiplo de 1, 10, 100… más grande que no suba más del tope', () => {
  test('tabla de muestras (tope 1 %): VAL-01 y bordes', () => {
    const cases = [
      [277.8, 1], [609.87, 1], [3003.52, 10], [12018.31, 100], [10235.19, 100], [8777.41, 10],
      [41209.47, 100], [11838.54, 100], [2408340.32, 10000], [93.94, 0], [99.99, 0], [100, 1],
      [999.99, 1], [1000, 10], [100000, 1000], [0, 0], [-5, 0], [NaN, 0], [null, 0],
    ];
    for (const [target, step] of cases) assert.equal(autoRoundingStep(target), step, `${target}`);
  });

  test('el tope se puede configurar (0 a 10 %); uno inválido usa el 1 % de fábrica', () => {
    assert.equal(autoRoundingStep(277.8, 0), 0, 'tope 0: sin redondeo');
    assert.equal(autoRoundingStep(277.8, 10), 10);
    assert.equal(autoRoundingStep(2408340.32, 0.1), 1000, 'tope 0,1 %: el múltiplo de siempre en $/día');
    for (const bad of [-1, 11, 'x', null, undefined]) assert.equal(autoRoundingStep(277.8, bad), 1, String(bad));
    assert.equal(roundingMaxPctOf(2.5), 2.5);
    assert.equal(roundingMaxPctOf(''), DEFAULT_ROUNDING_MAX_PCT);
  });

  test('nunca baja, nunca sube más del tope y el múltiplo es el más grande posible (2.000 objetivos al azar)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 2000; i += 1) {
      const target = Math.round(10 ** (rnd() * 9) * 100) / 100;
      const maxPct = [0.5, 1, 2, 10][i % 4];
      const step = autoRoundingStep(target, maxPct);
      const room = (target * maxPct) / 100;
      const rounded = roundUpToStep(target, step);
      assert.ok(rounded >= target - 1e-9, `${target}: nunca baja`);
      assert.ok(rounded - target <= room + 1e-6, `${target} (${maxPct} %): sube ${rounded - target}, tope ${room}`);
      if (step > 0) assert.ok(step <= room + 1e-9 && step * 10 > room, `${target}: ${step} es el más grande`);
      else assert.ok(room < 1, `${target}: sin redondeo sólo si el tope no llega a $ 1`);
    }
  });

  test('regla de una cotización: sin roundingMode, el múltiplo guardado; con "auto", el tope', () => {
    assert.deepEqual(quoteRounding({ roundingStep: 1000 }), { mode: 'step', step: 1000 });
    assert.deepEqual(quoteRounding({}), { mode: 'step', step: 0 });
    assert.deepEqual(quoteRounding(null), { mode: 'step', step: 0 });
    assert.deepEqual(quoteRounding({ roundingMode: 'step', roundingStep: 10 }), { mode: 'step', step: 10 });
    assert.deepEqual(quoteRounding({ roundingMode: 'auto', roundingMaxPct: 2, roundingStep: 1000 }), { mode: 'auto', maxPct: 2 });
    assert.deepEqual(quoteRounding({ roundingMode: 'auto', roundingMaxPct: 50 }), { mode: 'auto', maxPct: 1 });
    assert.equal(roundingStepFor({ mode: 'auto', maxPct: 1 }, 3003.52), 10);
    assert.equal(roundingStepFor({ mode: 'step', step: 1000 }, 3003.52), 1000);
  });
});

describe('ECO-03 · empresa y cotizaciones nuevas (interpretación de PLAN-2026-020 §2)', () => {
  test('lo guardado en la empresa antes de ECO-03 se interpreta así', () => {
    const auto1 = { roundingMode: 'auto', roundingMaxPct: 1, roundingStep: 0 };
    assert.deepEqual(settingsRounding({ illustrative: true, roundingStep: 1000 }), auto1, 'parámetros de fábrica sin confirmar + $ 1.000 → automático');
    assert.deepEqual(settingsRounding({ illustrative: true, roundingStep: 500 }), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 500 }, 'otro múltiplo: elegido');
    assert.deepEqual(settingsRounding({ illustrative: false, roundingStep: 1000 }), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 1000 }, 'confirmados: se conserva');
    assert.deepEqual(settingsRounding({ roundingStep: 0 }), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 0 });
    assert.deepEqual(settingsRounding({}), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 0 });
    assert.deepEqual(settingsRounding({ roundingMode: 'auto', roundingMaxPct: 2, roundingStep: 1000 }), { roundingMode: 'auto', roundingMaxPct: 2, roundingStep: 0 });
    assert.deepEqual(settingsRounding({ roundingMode: 'step', roundingStep: 10, illustrative: true }), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 10 });
  });

  test('empresa nueva: automático hasta 1 %, y sus cotizaciones nuevas también (con el múltiplo en 0)', () => {
    const s = defaultSettings('org');
    assert.equal(s.roundingMode, 'auto');
    assert.equal(s.roundingMaxPct, 1);
    assert.equal(s.roundingStep, 0);
    const q = createEmptyQuote({ organizationId: 'org', settings: s });
    assert.deepEqual([q.pricing.roundingMode, q.pricing.roundingMaxPct, q.pricing.roundingStep], ['auto', 1, 0]);
  });

  test('una plantilla de antes de ECO-03 conserva su múltiplo; una nueva, su regla', () => {
    const settings = defaultSettings('org');
    const legacyTemplate = { id: 't1', name: 'Vieja', serviceType: 'on_call', defaults: { pricing: { targetMarginPct: 10, roundingStep: 1000 } } };
    const a = createQuoteFromTemplate(legacyTemplate, { organizationId: 'org', settings });
    assert.deepEqual([a.pricing.roundingMode, a.pricing.roundingStep], ['step', 1000]);
    const newTemplate = { id: 't2', name: 'Nueva', serviceType: 'on_call', defaults: { pricing: { targetMarginPct: 10, roundingMode: 'auto', roundingMaxPct: 2, roundingStep: 0 } } };
    const b = createQuoteFromTemplate(newTemplate, { organizationId: 'org', settings: { ...LAB_SETTINGS } });
    assert.deepEqual([b.pricing.roundingMode, b.pricing.roundingMaxPct], ['auto', 2]);
    const noPricing = createQuoteFromTemplate({ id: 't3', name: 'Sin precio', defaults: {} }, { organizationId: 'org', settings });
    assert.equal(noPricing.pricing.roundingMode, 'auto', 'sin precio en la plantilla: la regla de la empresa');
  });
});

describe('ECO-03 · motor: automático en las 18 unidades y aviso del múltiplo fijo', () => {
  for (const unit of BILLING_UNITS.map((u) => u.id)) {
    test(`${unit}: la sugerida sube a lo sumo 1 % y su margen es el objetivo o un poco más`, () => {
      for (const maxPct of [undefined, 0.5, 1, 5]) {
        const k = computeQuote(unitQuote(unit, { roundingMode: 'auto', roundingMaxPct: maxPct ?? null, roundingStep: 1000 })).kpis;
        const limit = maxPct ?? 1;
        assert.equal(k.roundingMode, 'auto');
        assert.equal(k.roundingMaxPct, limit);
        assert.equal(k.roundingStep, autoRoundingStep(k.targetListRate, limit), `${unit}/${limit}: múltiplo`);
        assert.equal(k.suggestedListRate, roundUpToStep(k.targetListRate, k.roundingStep));
        assert.ok(k.suggestedRoundUpPct >= -1e-9 && k.suggestedRoundUpPct <= limit + 1e-9, `${unit}/${limit}: sube ${k.suggestedRoundUpPct} %`);
        assert.ok(k.suggestedMarginPct >= k.targetMarginPct - 1e-9, `${unit}/${limit}: margen ${k.suggestedMarginPct}`);
        assert.ok(k.suggestedMarginPct <= k.targetMarginPct + limit, `${unit}/${limit}: margen real cerca del objetivo`);
        assert.equal(k.marginPct, k.suggestedMarginPct, 'se cotiza la sugerida: el margen del resultado es el de la sugerida');
        assert.equal(k.roundingExceedsLimit, false, 'el automático nunca dispara el aviso');
      }
    });
  }

  test('múltiplo fijo de $ 1.000: avisa sólo donde sube más de 1 % (VAL-01-F1)', () => {
    const exceeds = Object.fromEntries(BILLING_UNITS.map((u) => [u.id, computeQuote(unitQuote(u.id, { roundingMode: 'step', roundingStep: 1000 })).kpis]));
    for (const id of ['tonkm', 'kg', 'm3', 'meter', 'km', 'm2', 'ton', 'unit']) assert.equal(exceeds[id].roundingExceedsLimit, true, id);
    for (const id of ['day', 'month', 'call', 'job', 'milestone', 'custom', 'hour', 'shift', 'trip', 'lot']) assert.equal(exceeds[id].roundingExceedsLimit, false, id);
    const tonkm = exceeds.tonkm;
    assert.ok(tonkm.suggestedRoundUpPct > 900, `ton-km sube ${tonkm.suggestedRoundUpPct} %`);
    assert.ok(tonkm.suggestedMarginPct > 80);
  });

  test('con otra tarifa ofrecida, el margen de la sugerida igual se calcula (para mostrarlo junto al objetivo)', () => {
    const k = computeQuote(unitQuote('tonkm', { roundingMode: 'step', roundingStep: 1000, offeredRateOverride: 100 })).kpis;
    assert.equal(k.commercialSource, 'offered');
    assert.ok(Number.isFinite(k.suggestedMarginPct) && k.suggestedMarginPct > 80);
    assert.notEqual(k.marginPct, k.suggestedMarginPct);
  });

  test('vuelta atrás: una cotización nueva en automático, leída por una versión sin ECO-03, no queda inflada', () => {
    for (const unit of BILLING_UNITS.map((u) => u.id)) {
      const q = createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org') });
      const fresh = unitQuote(unit, { ...q.pricing, targetMarginPct: 10 });
      const old = legacy(fresh); // una versión anterior no conoce roundingMode: usa roundingStep (0)
      const kOld = computeQuote(old).kpis;
      const kNew = computeQuote(fresh).kpis;
      assert.equal(kOld.suggestedListRate, kOld.targetListRate, `${unit}: sin redondeo en la versión anterior`);
      assert.ok(kNew.suggestedListRate >= kOld.suggestedListRate, unit);
    }
  });
});

describe('ECO-03 · textos: margen objetivo y real, regla y aviso', () => {
  test('margen objetivo y real, la regla aplicada y el aviso del múltiplo fijo', () => {
    const auto = computeQuote(unitQuote('km', { roundingMode: 'auto' })).kpis;
    assert.match(marginPairText(auto), /^Objetivo: 10 % de margen · con esta tarifa: 10(,\d+)? %$/);
    assert.match(roundingText(auto), /^redondeada hacia arriba a múltiplos de \$\s?1 \(automático: hasta 1\s%\ssobre el precio objetivo\)$/);
    assert.equal(roundingWarning(auto), null);
    const low = computeQuote(unitQuote('tonkm', { roundingMode: 'auto' })).kpis;
    assert.match(roundingText(low), /^sin redondeo \(automático: el 1 % de esta tarifa no llega a \$ 1\)$/);
    const step = computeQuote(unitQuote('tonkm', { roundingMode: 'step', roundingStep: 1000 })).kpis;
    assert.equal(roundingText(step).replace(/\s/g, ' '), 'redondeada hacia arriba a múltiplos de $ 1.000');
    const w = roundingWarning(step, 'ton-km');
    assert.match(w.title, /^La tarifa sugerida quedó [\d.,]+ % arriba de tu precio objetivo por el redondeo$/);
    assert.match(w.message, /Tu precio objetivo es \$\s?94 \/ ton-km, pero el múltiplo fijo de \$\s?1\.000 la lleva a \$\s?1\.000 \/ ton-km: el margen pasa de 10\s% a [\d,]+\s%\. El redondeo automático la deja a lo sumo 1 % arriba\./);
    assert.equal(roundingText(computeQuote(unitQuote('day', { roundingMode: 'step', roundingStep: 0 })).kpis), 'sin redondeo');
    assert.equal(marginPairText({ targetMarginPct: null, suggestedMarginPct: 10 }), null);
  });
});

describe('ECO-03 · correcciones de la revisión de código', () => {
  test('la configuración guardada antes de ECO-03 no se completa con el automático de fábrica (Configuración no la pisa)', async () => {
    const make = (stored) => createSettingsService({ repository: { getOrganization: async () => ({ id: 'org' }), getSettings: async () => stored } });
    const legacy = await make({ illustrative: false, roundingStep: 1000, fuelPricePerLiter: 1500 }).get();
    assert.equal(legacy.roundingMode, undefined);
    assert.equal(legacy.roundingMaxPct, undefined);
    assert.deepEqual(settingsRounding(legacy), { roundingMode: 'step', roundingMaxPct: null, roundingStep: 1000 }, 'confirmada: múltiplo fijo');
    assert.equal(createEmptyQuote({ organizationId: 'org', settings: legacy }).pricing.roundingMode, 'step');
    const noStep = await make({ illustrative: false }).get();
    assert.equal(noStep.roundingStep, 1000, 'sin múltiplo guardado: el de fábrica de entonces');
    const fresh = await make(defaultSettings('org')).get();
    assert.equal(fresh.roundingMode, 'auto', 'empresa nueva: automático');
  });

  test('plantillas: la regla de fábrica vale igual que para la empresa', () => {
    const settings = { ...LAB_SETTINGS }; // empresa confirmada con $ 1.000 (múltiplo fijo)
    const autoCompany = defaultSettings('org');
    const tpl = (illustrative, step) => ({ id: 't', name: 'T', serviceType: 'on_call', illustrative, defaults: { pricing: { targetMarginPct: 10, roundingStep: step } } });
    const rule = (q) => [q.pricing.roundingMode, q.pricing.roundingStep];
    assert.deepEqual(rule(createQuoteFromTemplate(tpl(false, 1000), { organizationId: 'org', settings: autoCompany })), ['step', 1000], 'propia: se conserva');
    assert.deepEqual(rule(createQuoteFromTemplate(tpl(true, 500), { organizationId: 'org', settings: autoCompany })), ['step', 500], 'otro múltiplo: elegido');
    assert.deepEqual(rule(createQuoteFromTemplate(tpl(true, 1000), { organizationId: 'org', settings: autoCompany })), ['auto', 0], 'de fábrica: la regla de la empresa');
    assert.deepEqual(rule(createQuoteFromTemplate(tpl(true, 1000), { organizationId: 'org', settings })), ['step', 1000], 'de fábrica en una empresa con múltiplo: el de la empresa');
  });

  test('cambiar a automático deja el múltiplo en 0 (una versión anterior no la infla); a múltiplo fijo, sin tope', () => {
    assert.deepEqual(roundingModeChange('auto', { roundingStep: 1000 }), { roundingMode: 'auto', roundingMaxPct: 1, roundingStep: 0 });
    assert.deepEqual(roundingModeChange('auto', { roundingMaxPct: 0.5, roundingStep: 1000 }), { roundingMode: 'auto', roundingMaxPct: 0.5, roundingStep: 0 });
    assert.deepEqual(roundingModeChange('auto', { roundingMaxPct: 50 }), { roundingMode: 'auto', roundingMaxPct: 1, roundingStep: 0 });
    assert.deepEqual(roundingModeChange('step', { roundingMode: 'auto', roundingMaxPct: 2 }), { roundingMode: 'step', roundingMaxPct: null });
    const q = unitQuote('tonkm', { roundingMode: 'step', roundingStep: 1000 });
    Object.assign(q.pricing, roundingModeChange('auto', q.pricing));
    const old = computeQuote(legacy(q)).kpis;
    assert.equal(old.suggestedListRate, old.targetListRate, 'leída por una versión anterior: sin redondeo, nunca inflada');
  });

  test('tope 0: "sin redondeo" dice por qué; con una tarifa forzada (matriz, escenarios) no se calcula el margen de la sugerida', () => {
    const zero = computeQuote(unitQuote('day', { roundingMode: 'auto', roundingMaxPct: 0 })).kpis;
    assert.equal(zero.roundingStep, 0);
    assert.equal(roundingText(zero), 'sin redondeo (automático con tope 0 %)');
    const forced = computeQuote(unitQuote('day', { roundingMode: 'auto' }), { listRateOverride: 900000 }).kpis;
    assert.equal(forced.suggestedMarginPct, null);
    assert.ok(Number.isFinite(computeQuote(unitQuote('day', { roundingMode: 'auto' })).kpis.suggestedMarginPct));
  });
});
