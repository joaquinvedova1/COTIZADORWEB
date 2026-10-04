/**
 * "¿En qué se va el costo?": agrupación única para todas las vistas simples.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { costBreakdown, OTHERS_KEY } from '../../js/ui/cost-breakdown.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createDemoState, DEMO_IDS } from '../../js/domain/demo-data.js';

const eecc = (pairs) => ({ rows: pairs.map(([category, amount]) => ({ category, label: category.toUpperCase(), amount })) });

describe('costBreakdown', () => {
  test('top 4 de mayor a menor + Otros; los % enteros suman exactamente 100', () => {
    const r = costBreakdown(eecc([['labor', 27], ['equipment', 34], ['fuel', 14], ['materials', 3], ['logistics', 1], ['structure', 10], ['financial', 6], ['contingency', 5]]));
    assert.deepEqual(r.map((g) => g.key), ['equipment', 'labor', 'fuel', 'structure', OTHERS_KEY]);
    assert.deepEqual(r.find((g) => g.key === OTHERS_KEY).categories, ['financial', 'contingency', 'materials', 'logistics']);
    assert.equal(r.reduce((s, g) => s + g.pct, 0), 100);
    assert.equal(r.find((g) => g.key === OTHERS_KEY).amount, 15);
  });

  test('con 2 decimales también suma 100', () => {
    const r = costBreakdown(eecc([['a', 1], ['b', 1], ['c', 1]]), { decimals: 2 });
    assert.equal(Math.round(r.reduce((s, g) => s + g.pct, 0) * 100) / 100, 100);
  });

  test('si sólo sobra un rubro no se crea "Otros"', () => {
    const r = costBreakdown(eecc([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1]]));
    assert.equal(r.length, 5);
    assert.ok(!r.some((g) => g.key === OTHERS_KEY));
  });

  test('ignora montos 0, negativos o no finitos y tolera EECC vacía', () => {
    assert.deepEqual(costBreakdown(null), []);
    assert.deepEqual(costBreakdown({ rows: [] }), []);
    const r = costBreakdown(eecc([['a', 0], ['b', NaN], ['c', -5], ['d', 10]]));
    assert.deepEqual(r.map((g) => [g.key, g.pct]), [['d', 100]]);
  });

  test('demo hidrogrúa: los montos agrupados suman el costo total del motor', () => {
    const st = createDemoState(1);
    const q = st.quotes.find((x) => x.id === DEMO_IDS.quoteHydroCrane);
    const result = computeQuote(q, { settings: st.settings });
    const r = costBreakdown(result.eecc);
    const total = r.reduce((s, g) => s + g.amount, 0);
    assert.ok(Math.abs(total - result.kpis.totalCost) < 1e-6);
    assert.equal(r.reduce((s, g) => s + g.pct, 0), 100);
  });
});
