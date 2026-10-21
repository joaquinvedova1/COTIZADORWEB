/**
 * Margen esperado en la barra compacta del resumen en vivo (DESIGN-02 2/2,
 * PLAN-2026-026): el estado se lee con una palabra, no sólo con el color
 * (WCAG 1.4.1), y coincide con el tono del resumen. Con un resultado NO
 * CONFIABLE (ECO-01) dice "no confiable" antes que cualquier otra cosa.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { marginStateWord } from '../../js/ui/live-summary-text.js';

const result = (kpis, pending = []) => ({ kpis: { commercialListRate: 1000, marginPct: 10, profit: 100, belowTarget: false, ...kpis }, completeness: { pending } });

describe('palabra del margen esperado', () => {
  test('cumple, debajo del objetivo o pierde plata', () => {
    assert.deepEqual(marginStateWord(result({})), { word: 'cumple', tone: 'green' });
    assert.deepEqual(marginStateWord(result({ marginPct: 6, belowTarget: true })), { word: 'debajo', tone: 'orange' });
    assert.deepEqual(marginStateWord(result({ marginPct: -4, profit: -40, belowTarget: true })), { word: 'pierde', tone: 'red' });
  });

  test('NO CONFIABLE va primero, aunque el margen parezca bueno', () => {
    const unreliable = [{ label: 'Personal', unreliable: true }];
    assert.deepEqual(marginStateWord(result({}, unreliable)), { word: 'no confiable', tone: 'red' });
    assert.deepEqual(marginStateWord(result({ commercialListRate: null, marginPct: null }, unreliable)), { word: 'no confiable', tone: 'red' });
    // Un pendiente común (no marcado como no confiable) no cambia la palabra.
    assert.deepEqual(marginStateWord(result({}, [{ label: 'Combustible' }])), { word: 'cumple', tone: 'green' });
  });

  test('sin tarifa o sin objetivo válido no dice "cumple"', () => {
    assert.deepEqual(marginStateWord(result({ commercialListRate: null, marginPct: null })), { word: 'sin tarifa', tone: null });
    assert.deepEqual(marginStateWord(result({ marginPct: Number.NaN })), { word: 'sin tarifa', tone: null });
    assert.deepEqual(marginStateWord(result({ targetMarginInvalid: true })), { word: 'sin objetivo', tone: null });
    // Con pérdida, "pierde" aunque el objetivo sea inválido.
    assert.deepEqual(marginStateWord(result({ targetMarginInvalid: true, profit: -1, marginPct: -1 })), { word: 'pierde', tone: 'red' });
  });

  test('sin resultado: sin palabra', () => {
    assert.deepEqual(marginStateWord(null), { word: '', tone: null });
    assert.deepEqual(marginStateWord({}), { word: '', tone: null });
  });
});
