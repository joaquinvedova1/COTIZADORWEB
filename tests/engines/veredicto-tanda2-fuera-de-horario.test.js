/**
 * Veredicto de la ronda 2026-11-15, tanda 2 — horas fuera de horario.
 *
 * V-34 (decisión del dueño, opción a): cobrando por hora-hombre, la hora normal de
 * referencia sale de la tarifa (tarifa por HH × personas), igual que cobrando por hora.
 * Caso de la ficha: cuadrilla de 3 a $ 58.000 por HH (14 días × 9 h, 378 HH por mes).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { normalHourEquivalent, MAN_HOUR_UNIT } from '../../js/engines/out-of-hours-engine.js';
import { tariffRows, outOfHoursPer } from '../../js/ui/result-text.js';
import { outOfHoursNoteText } from '../../js/ui/views/quote-steps/modality.js';

const nb = (s) => String(s).replace(/ /g, ' ');
const crewByManHour = () => JSON.parse(readFileSync(new URL('../fixtures/v34-cuadrilla-hora-hombre.json', import.meta.url), 'utf8'));
/** La misma cuadrilla cobrada por hora (14 días × 9 h). */
const crewByHour = () => {
  const q = crewByManHour();
  q.unit = 'hour';
  q.activity.billableQuantityPerMonth = null;
  q.activity.unitsPerActiveDay = null;
  return q;
};

describe('V-34 · Hora-hombre: la hora normal sale de la tarifa × personas', () => {
  test('normalHourEquivalent: tarifa por HH × personas; sin personas no hay referencia de tarifa', () => {
    assert.equal(normalHourEquivalent({ unitKind: 'quantity', unitId: MAN_HOUR_UNIT, listRate: 58_000, people: 3 }), 174_000);
    assert.equal(normalHourEquivalent({ unitKind: 'quantity', unitId: MAN_HOUR_UNIT, listRate: 58_000, people: 0 }), null);
    // Otras unidades por cantidad siguen sin hora de tarifa (la referencia son los recursos).
    assert.equal(normalHourEquivalent({ unitKind: 'quantity', unitId: 'm3', listRate: 58_000, people: 3 }), null);
  });

  test('cuadrilla de 3 a $ 58.000 por HH: hora normal $ 174.000 y hora al 50 % ≈ $ 227.858 (antes $ 192.834)', () => {
    const r = computeQuote(crewByManHour());
    assert.equal(r.kpis.commercialListRate, 58_000);
    assert.equal(r.outOfHours.normalHourSource, 'rate');
    assert.equal(r.outOfHours.normalHourPrice, 174_000);
    assert.equal(r.outOfHours.crewHour, true);
    const [h50, h100] = r.outOfHours.lines;
    assert.ok(Math.abs(h50.price - 227_858) < 1, `50 %: ${h50.price}`);
    assert.ok(Math.abs(h100.price - 281_717) < 1, `100 %: ${h100.price}`);
    assert.equal(h50.priceBasis, 'normal_hour');
  });

  test('queda igual que la misma cuadrilla cobrada por hora, y la tarifa principal no cambia', () => {
    const hh = computeQuote(crewByManHour());
    const hour = computeQuote(crewByHour());
    assert.equal(hour.kpis.commercialListRate, 174_000);
    hh.outOfHours.lines.forEach((l, i) => assert.ok(Math.abs(l.price - hour.outOfHours.lines[i].price) < 1e-6));
    assert.ok(Math.abs(hh.kpis.revenue - hour.kpis.revenue) < 1e-6);
    const plain = crewByManHour();
    plain.extras = [];
    assert.equal(computeQuote(plain).kpis.commercialListRate, 58_000);
  });

  test('un precio cargado a mano no cambia', () => {
    const q = crewByManHour();
    q.extras[0].price = 200_000;
    const r = computeQuote(q);
    assert.equal(r.outOfHours.lines[0].price, 200_000);
    assert.equal(r.outOfHours.lines[0].priceSource, 'manual');
  });

  test('en pantalla: "por hora de toda la cuadrilla (3 personas)", no "/ hora"', () => {
    const r = computeQuote(crewByManHour());
    assert.equal(outOfHoursPer(r), 'por hora de toda la cuadrilla (3 personas)');
    const rows = tariffRows(r).map(([a, b]) => [nb(a), nb(b)]);
    assert.equal(rows[0][1], '$ 58.000 / hora-hombre');
    assert.match(rows[1][1], /^\$ 22[78]\.\d{3} por hora de toda la cuadrilla \(3 personas\) \(precio sugerido\)$/);
    assert.match(nb(outOfHoursNoteText(r)), /^Tu hora normal equivale a \$ 174\.000 \(tu tarifa por hora-hombre × 3 personas\)\..*Estos precios son por hora de toda la cuadrilla \(3 personas\), no por hora-hombre\.$/);
    // Cobrando por hora no cambia el rótulo.
    const hour = computeQuote(crewByHour());
    assert.equal(outOfHoursPer(hour), '/ hora');
    assert.match(nb(outOfHoursNoteText(hour)), /\(sale de tu tarifa\)\. El precio sugerido es esa hora más el recargo de las horas extra\. Se cobra aparte de la tarifa\.$/);
  });
});
