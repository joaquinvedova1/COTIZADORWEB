/**
 * Resultado: textos y números de presentación (js/ui/result-text.js).
 * Cada test protege un error de presentación ya corregido (AGENTS.md §10):
 * lo que se lee y lo que se resta tiene que cerrar, y los avisos no pueden
 * afirmar algo falso. Funciones puras: no necesitan DOM.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  dayDecimals,
  shownDays,
  resultDays,
  activeDaysText,
  signedDays,
  resultDaysDelta,
  cushionText,
  joinList,
  targetGoalHint,
  targetGoalPrefix,
  tierDiscountFindings,
  tierBelow,
  minActivityNotice,
  discountAlert,
  discountWords,
  comparatorNote,
  completenessExampleNote,
} from '../../js/ui/result-text.js';
import { formatDays } from '../../js/core/format.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateAt } from '../../js/engines/economics-engine.js';
import { compareCommercialModels } from '../../js/engines/scenario-engine.js';
import { createEmptyQuote, createOtherCost, defaultSettings } from '../../js/domain/quote-factory.js';
import { createDemoState, DEMO_IDS } from '../../js/domain/demo-data.js';

/** "1,6 días" → 1.6 (sólo para leer en los tests lo que muestra la pantalla). */
const num = (text) => Number(String(text).match(/-?\d+(?:,\d+)?/)[0].replace(',', '.'));

/** Cotización mínima: un costo fijo mensual + un costo por día activo, sin financiación, riesgo ni combustible. */
function quoteWith({ activeDays = 10, fixed = 0, perDay = 0, mode = 'known_rate', knownRate = null, margin, tiers, roundingStep } = {}) {
  const settings = defaultSettings('org');
  const q = createEmptyQuote({ organizationId: 'org', settings, id: '00000000-0000-4000-8000-000000009901', now: '2026-01-01T00:00:00.000Z' });
  q.pricingMode = mode;
  q.unit = 'day';
  q.activity.activeDaysPerMonth = activeDays;
  q.finance.paymentTermDays = 0;
  q.finance.monthlyRatePct = 0;
  q.risk.generalPct = 0;
  q.fuel.pricePerLiter = 0;
  q.otherCosts = [];
  if (fixed) q.otherCosts.push(createOtherCost({ id: 'c-fijo', description: 'Fijo', category: 'equipment', behavior: 'fixed_monthly', amount: fixed }));
  if (perDay) q.otherCosts.push(createOtherCost({ id: 'c-dia', description: 'Por día', category: 'labor', behavior: 'per_active_day', amount: perDay }));
  if (knownRate !== null) q.pricing.knownRate = knownRate;
  if (margin !== undefined) q.pricing.targetMarginPct = margin;
  if (roundingStep !== undefined) q.pricing.roundingStep = roundingStep;
  if (tiers) q.rules.volumeTiers = tiers;
  return { q, settings, r: computeQuote(q, { settings }) };
}

/** Tramos del hallazgo PROD-2: 1 día 0 %, 2–7 0 %, 8–15 `mid` %, 16–30 10 %, +30 0 %. */
const tiersWith = (mid) => [
  { id: 't1', fromDays: 1, toDays: 1, discountPct: 0 },
  { id: 't2', fromDays: 2, toDays: 7, discountPct: 0 },
  { id: 't3', fromDays: 8, toDays: 15, discountPct: mid },
  { id: 't4', fromDays: 16, toDays: 30, discountPct: 10 },
  { id: 't5', fromDays: 31, toDays: null, discountPct: 0 },
];

function demoResult(id) {
  const state = createDemoState();
  const q = state.quotes.find((x) => x.id === id);
  return { q, settings: state.settings, r: computeQuote(q, { settings: state.settings }) };
}

describe('días en superficie (1 decimal; 2 debajo de 1 día)', () => {
  test('mismo redondeo que formatDays: 6,3496 → 6,4 y 6,2496 → 6,3 (6,25 en "Ver cálculo")', () => {
    assert.equal(shownDays(6.3496), 6.4);
    assert.equal(resultDays(6.3496), '6,4 días');
    assert.equal(shownDays(6.2496), 6.3);
    assert.equal(resultDays(6.2496), '6,3 días');
    assert.equal(formatDays(6.2496), '6,25 días');
    assert.equal(resultDays(6.378726865071805), '6,4 días', 'demo hidrogrúa');
    assert.equal(resultDays(10), '10 días', 'caso de referencia');
  });

  test('debajo de 1 día usa 2 decimales (0,45 no se lee 0,5) y nunca muestra NaN', () => {
    assert.equal(dayDecimals(0.45), 2);
    assert.equal(dayDecimals(6.38), 1);
    assert.equal(resultDays(0.45), '0,45 días');
    assert.equal(resultDays(0.996), '1 día');
    assert.equal(resultDays(1.04), '1 día', 'singular aunque el valor de 2 decimales sea 1,04');
    assert.equal(resultDays(NaN), '—');
    assert.equal(resultDays(null), '—');
    assert.equal(activeDaysText(1), '1 día activo');
    assert.equal(activeDaysText(6.3496), '6,4 días activos');
    assert.equal(activeDaysText(Infinity), '—');
  });

  test('lo que se muestra coincide con formatDays (mismos decimales) en todo el rango: igual que el resto de la app', () => {
    for (let i = 100; i < 31000; i += 1) {
      const x = i / 1000 + 0.0004;
      // Mismo número que formatDays (el rótulo puede diferir: formatDays(1,04, 1 decimal) dice "1 días"; acá, "1 día").
      assert.equal(num(resultDays(x)), num(formatDays(x, { decimals: dayDecimals(x) })), `x = ${x}`);
    }
  });

  test('diferencias con signo: singular también en negativo y sin "-0"', () => {
    assert.equal(signedDays(-1), '-1 día');
    assert.equal(signedDays(1), '+1 día');
    assert.equal(signedDays(1.5), '+1,5 días');
    assert.equal(signedDays(-0.004), '0 días');
    assert.equal(signedDays(NaN), '—');
  });

  test('diferencia de break-even: se restan los valores mostrados', () => {
    assert.equal(resultDaysDelta(6.3496, 7.06), 0.7);
    assert.equal(resultDaysDelta(6.2496, 6.3496), 0.1);
    assert.equal(resultDaysDelta(0.45, 0.5), 0.05);
    assert.equal(resultDaysDelta(null, 3), null);
  });
});

describe('colchón sobre el mínimo (REG-6)', () => {
  test('Q1: estimás 8 días con mínimo 6,4 → colchón de 1,6 (8 − 6,4)', () => {
    assert.equal(cushionText(8, 6.3496), ' Estimás 8 días: tenés un colchón de 1,6 días sobre el mínimo.');
  });

  test('doble redondeo: mínimo 6,2496 se ve 6,3 → colchón 1,7 (no 1,8)', () => {
    assert.equal(cushionText(8, 6.2496), ' Estimás 8 días: tenés un colchón de 1,7 días sobre el mínimo.');
  });

  test('debajo de 1 día: 0,5 − 0,45 = 0,05', () => {
    assert.equal(cushionText(0.5, 0.45), ' Estimás 0,5 días: tenés un colchón de 0,05 días sobre el mínimo.');
  });

  test('justo en el mínimo y apenas debajo (cuando el redondeo cambia el signo)', () => {
    assert.equal(cushionText(6.4, 6.38), ' Estimás 6,4 días: estás justo en el mínimo.');
    assert.equal(cushionText(6.42, 6.44), ' Estimás 6,42 días: estás apenas debajo del mínimo.');
    assert.equal(cushionText(6, 6.38), ' Estimás 6 días: te faltan 0,4 días para no perder plata.');
  });

  test('con 2 decimales en el mínimo (break-even exacto), la resta también cierra', () => {
    assert.equal(cushionText(8, 6.345, { beDecimals: 2 }), ' Estimás 8 días: tenés un colchón de 1,65 días sobre el mínimo.');
  });

  test('barrido: días estimados − mínimo mostrado = colchón mostrado', () => {
    for (const D of [0.5, 1, 6.43, 8, 12.25, 20]) {
      for (let i = 10; i < 2500; i += 7) {
        const be = i / 100 + 0.0046;
        const text = cushionText(D, be);
        if (!/colchón|faltan/.test(text)) continue;
        const gap = num(text.split(':')[1]);
        const expected = Math.round((num(formatDays(D)) - num(resultDays(be))) * 100) / 100;
        assert.equal(/faltan/.test(text) ? -gap : gap, expected, `D = ${D}, be = ${be}: ${text}`);
      }
    }
  });

  test('sin datos no hay frase', () => {
    assert.equal(cushionText(null, 6), '');
    assert.equal(cushionText(8, NaN), '');
  });
});

describe('tramos de descuento y actividad mínima (PROD-2 / REG-8)', () => {
  test('el tramo con descuento que corre el break-even: no se atribuye el número a la actividad', () => {
    const { r } = quoteWith({ fixed: 1000000, perDay: 100000, knownRate: 250000, tiers: tiersWith(25) });
    // El break-even (11,4 días) cae en el tramo 8–15 días con 25 % de descuento…
    assert.equal(resultDays(r.breakEven.days), '11,4 días');
    assert.equal(tierBelow(r.discounts, r.breakEven.days).label, '8–15 días');
    // …y con menos días NO siempre se pierde plata (7 días: + $ 50.000; 7,5 días: + $ 125.000).
    assert.ok(evaluateAt(r.ctx, 7, 250000).profit > 0);
    assert.ok(evaluateAt(r.ctx, 7.5, 250000).profit > 0);
    const text = minActivityNotice(r);
    assert.ok(text, 'hay tramos sin descuento que pierden');
    assert.doesNotMatch(text, /11,4/);
    assert.doesNotMatch(text, /Con menos de/);
    assert.match(text, /"1 día" y "2–7 días" pierden plata en su primer día por la actividad mínima/);
    // La insignia cuenta sólo el descuento que pierde (8–15 días, 25 %).
    const alert = discountAlert(r);
    assert.equal(alert.tone, 'red');
    assert.equal(alert.text, 'Un descuento pierde plata');
    assert.deepEqual(
      { granted: tierDiscountFindings(r.discounts).granted, red: tierDiscountFindings(r.discounts).red },
      { granted: 2, red: 1 },
    );
  });

  test('si el break-even cae en un tramo sin descuento, el número es de la actividad mínima', () => {
    const { r } = quoteWith({ fixed: 1000000, perDay: 100000, knownRate: 250000, tiers: tiersWith(5) });
    assert.equal(minActivityNotice(r), 'Con menos de 6,7 días trabajados perdés plata (no es por el descuento: es la actividad mínima).');
    assert.equal(discountAlert(r).tone, 'orange');
  });

  test('sin ningún tramo con descuento no se menciona "el descuento"', () => {
    const { r } = demoResult(DEMO_IDS.quoteReference);
    assert.equal(r.breakEven.days, 10, 'golden: break-even 10 días');
    assert.equal(minActivityNotice(r), 'Con menos de 10 días trabajados perdés plata: es la actividad mínima para cubrir tus costos.');
    assert.equal(discountAlert(r), null, 'tramos de 0 % no son descuentos');
    assert.equal(tierDiscountFindings(r.discounts).granted, 0);
  });

  test('demo: 3 tramos con descuento, ninguno pierde; los de 0 % pierden por pocos días', () => {
    const { r } = demoResult(DEMO_IDS.quoteHydroCrane);
    assert.equal(tierDiscountFindings(r.discounts).granted, 3);
    assert.equal(discountAlert(r), null);
    assert.equal(minActivityNotice(r), 'Con menos de 6,4 días trabajados perdés plata (no es por el descuento: es la actividad mínima).');
    assert.equal(discountWords(r), 'del descuento del tramo');
  });

  test('sin break-even alcanzable, con abono mensual o sin tramos que pierdan, no hay aviso', () => {
    const unreachable = quoteWith({ fixed: 1000000, perDay: 100000, knownRate: 90000 }).r;
    assert.equal(unreachable.breakEven.reachable, false);
    assert.equal(minActivityNotice(unreachable), null);
    assert.equal(minActivityNotice({ unit: 'month', discounts: [{ status: 'red', discountPct: 0 }], breakEven: { reachable: true, days: 5 } }), null);
    assert.equal(minActivityNotice({ unit: 'day', discounts: [{ status: 'green', discountPct: 0 }], breakEven: { reachable: true, days: 5 } }), null);
    assert.equal(minActivityNotice(null), null);
  });

  test('un solo tramo que pierde: singular', () => {
    const r = {
      unit: 'day',
      breakEven: { reachable: true, days: 9 },
      discounts: [
        { label: '1 día', evaluatedDays: 1, discountPct: 0, status: 'red' },
        { label: '2–15 días', evaluatedDays: 2, discountPct: 20, status: 'red' },
      ],
    };
    assert.match(minActivityNotice(r), /^El tramo "1 día" pierde plata en su primer día/);
  });

  test('continuidad: también cuenta en la insignia', () => {
    assert.equal(discountAlert({ discounts: [], continuity: { applies: true, status: 'red' } }).text, 'Un descuento pierde plata');
    assert.equal(discountAlert({ discounts: [], continuity: { applies: false, status: 'red' } }), null);
  });
});

describe('nota del comparador de modelos (UX-5)', () => {
  const noteFor = ({ q, settings, r }) => comparatorNote(r, compareCommercialModels(q, { settings }).models, { roundingStep: q.pricing.roundingStep });

  test('tu tarifa (caso de referencia): la causa es la tarifa, no los tramos', () => {
    const text = noteFor(demoResult(DEMO_IDS.quoteReference));
    assert.equal(text, 'El break-even de cada modelo usa la tarifa objetivo (no tu tarifa): por eso difiere del de tu cotización (10 días).');
  });

  test('demo (tarifa sugerida con tramos de descuento): sin tramos de descuento', () => {
    const text = noteFor(demoResult(DEMO_IDS.quoteHydroCrane));
    assert.equal(text, 'El break-even de cada modelo usa la tarifa objetivo, sin tramos de descuento: por eso difiere del de tu cotización (6,4 días).');
  });

  test('tarifa sugerida sin tramos: la diferencia es el redondeo', () => {
    const text = noteFor(quoteWith({ fixed: 1000000, perDay: 100000, mode: 'known_activity' }));
    assert.equal(text, 'El break-even de cada modelo usa la tarifa objetivo, sin el redondeo de la tarifa sugerida: por eso difiere del de tu cotización (8,1 días).');
  });

  test('si el break-even se ve igual, no hay nota; con abono mensual tampoco', () => {
    const r = { unit: 'day', breakEven: { reachable: true, days: 6.38 }, kpis: { commercialSource: 'suggested' } };
    assert.equal(comparatorNote(r, [{ id: 'day_rate', breakEvenReachable: true, breakEvenDays: 6.41 }]), '');
    assert.equal(comparatorNote({ ...r, unit: 'month' }, []), '');
    assert.equal(comparatorNote({ ...r, breakEven: { reachable: false, days: null } }, []), '');
  });
});

describe('ayudas de margen y notas', () => {
  test('margen objetivo 0 %: "cubre tus costos", nunca "ganar el 0 %"', () => {
    assert.equal(targetGoalHint(0), 'Cubre tus costos (margen objetivo 0 %).');
    assert.equal(targetGoalPrefix(0), 'Para cubrir tus costos');
    assert.equal(targetGoalHint(10), 'Para ganar el 10 % sobre el precio.');
    assert.equal(targetGoalPrefix(12.5), 'Para ganar el 12,5 %');
  });

  test('nota de pendientes: didáctica sólo en la demo; neutra en otros ejemplos; nada en cotizaciones propias', () => {
    assert.match(completenessExampleNote({ quoteId: DEMO_IDS.quoteHydroCrane, illustrative: true, pendingCount: 2 }), /a propósito/);
    const neutral = completenessExampleNote({ quoteId: DEMO_IDS.quoteReference, illustrative: true, pendingCount: 3 });
    assert.equal(neutral, 'Es un ejemplo: puede dejar puntos sin completar. En tu cotización, revisalos antes de cotizar.');
    assert.equal(completenessExampleNote({ quoteId: DEMO_IDS.quoteHydroCrane, illustrative: true, pendingCount: 0 }), null);
    assert.equal(completenessExampleNote({ quoteId: 'propia', illustrative: false, pendingCount: 4 }), null);
  });

  test('joinList', () => {
    assert.equal(joinList([]), '');
    assert.equal(joinList(['a']), 'a');
    assert.equal(joinList(['a', 'b']), 'a y b');
    assert.equal(joinList(['a', 'b', 'c']), 'a, b y c');
  });
});
