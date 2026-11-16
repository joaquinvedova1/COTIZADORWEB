/**
 * Veredicto de la ronda de testeo 2026-11-15, tanda 3 (V-15 a V-33):
 * limpieza y textos. Decisiones de pantalla sacadas a funciones puras;
 * ninguna recalcula: leen el resultado de computeQuote.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { baseOf } from '../../js/ui/views/quote-steps/indirect.js';
import { resourceCostText } from '../../js/ui/views/quote-steps/modality.js';
import { EMPTY } from '../../js/core/format.js';
import { service, person, external, resetIds } from '../lab/lib/build.js';

const norm = (s) => String(s).replace(/ /g, ' ');

describe('V-15 · Base de la estructura con proveedores', () => {
  test('el % sobre costo directo se muestra sobre la misma base que usa el motor', () => {
    resetIds();
    const q = service({
      unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person()], equipment: [external({ name: 'Grúa' }, { price: 500000, unit: 'day' })],
      indirect: { method: 'percent_direct', pct: 10 },
    });
    const r = computeQuote(q);
    const structure = r.eecc.rows.find((row) => row.category === 'structure').amount;
    assert.ok(r.eecc.rows.find((row) => row.category === 'external').amount > 0);
    assert.ok(Math.abs(baseOf(r) * 0.1 - structure) < 0.01, `${baseOf(r) * 0.1} vs ${structure}`);
  });
});

describe('V-16 · "Lo que cuestan tus recursos"', () => {
  test('con fijo y variable muestra los dos', () => {
    assert.equal(norm(resourceCostText(4200000, 350000)), '$ 4.200.000 por mes + $ 350.000 por día');
    assert.equal(norm(resourceCostText(4200000, 0)), '$ 4.200.000 por mes');
    assert.equal(norm(resourceCostText(0, 350000)), '$ 350.000 por día');
    assert.equal(resourceCostText(0, 0), EMPTY);
  });
});
