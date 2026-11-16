/**
 * Veredicto de la ronda 2026-11-15, tanda 2 — horas fuera de horario.
 *
 * V-34 (decisión del dueño, opción a): cobrando por hora-hombre, la hora normal de
 * referencia sale de la tarifa (tarifa por HH × personas), igual que cobrando por hora.
 * Caso de la ficha: cuadrilla de 3 a $ 58.000 por HH (14 días × 9 h, 378 HH por mes).
 *
 * V-38 (decisión del dueño): la hora fuera de horario SUGERIDA se redondea como la tarifa
 * sugerida, hacia arriba. Se redondea en el motor (no sólo al mostrar) para que el precio
 * publicado, la facturación estimada, el Resultado y el PDF usen el mismo número.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { normalHourEquivalent, MAN_HOUR_UNIT } from '../../js/engines/out-of-hours-engine.js';
import { tariffRows, outOfHoursPer } from '../../js/ui/result-text.js';
import { outOfHoursNoteText, suggestedHourHint } from '../../js/ui/views/quote-steps/modality.js';
import { computeExtras } from '../../js/engines/extras-engine.js';

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
    assert.ok(Math.abs(h50.suggestedPriceExact - 227_858) < 1, `50 %: ${h50.suggestedPriceExact}`);
    assert.ok(Math.abs(h100.suggestedPriceExact - 281_717) < 1, `100 %: ${h100.suggestedPriceExact}`);
    assert.equal(h50.priceBasis, 'normal_hour');
    // V-38: lo que se publica y se factura va redondeado como la tarifa (paso de $ 1.000).
    assert.equal(h50.price, 228_000);
    assert.equal(h100.price, 282_000);
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
    assert.match(rows[1][1], /^\$ 228\.000 por hora de toda la cuadrilla \(3 personas\) \(precio sugerido\)$/);
    assert.match(nb(outOfHoursNoteText(r)), /^Tu tarifa por hora normal es \$ 174\.000 \(tu tarifa por hora-hombre × 3 personas\)\..*Estos precios son por hora de toda la cuadrilla \(3 personas\), no por hora-hombre\.$/);
    // Cobrando por hora no cambia el rótulo.
    const hour = computeQuote(crewByHour());
    assert.equal(outOfHoursPer(hour), '/ hora');
    assert.match(nb(outOfHoursNoteText(hour)), /\(sale de tu tarifa\)\. El precio sugerido es esa hora más el recargo de las horas extra\. Se cobra aparte de la tarifa\.$/);
  });
});

describe('V-38 · La hora fuera de horario sugerida se redondea como la tarifa', () => {
  const overtime = (more = {}) => ({ id: 'x', kind: 'overtime', premiumPct: 50, costPerUnit: 100_000, surchargePerUnit: 30_000, quantityPerMonth: 10, price: null, ...more });
  const opts = { targetMarginPct: 10, billingTaxPct: 5, referenceHourPrice: 150_300 };

  test('sugerido $ 185.594,12 con paso de $ 1.000 → $ 186.000; el exacto queda a la vista', () => {
    const [l] = computeExtras([overtime()], { ...opts, roundingStep: 1000 }).lines;
    assert.ok(Math.abs(l.suggestedPriceExact - (150_300 + 30_000 / 0.85)) < 1e-6);
    assert.equal(l.suggestedPrice, 186_000);
    assert.equal(l.price, 186_000);
    assert.equal(l.revenue, 1_860_000, 'la facturación estimada usa el precio publicado');
    assert.match(suggestedHourHint(l), /Redondeado hacia arriba, como tu tarifa\.$/);
  });

  test('nunca redondea hacia abajo y un sugerido que ya es múltiplo no cambia', () => {
    const [up] = computeExtras([overtime()], { ...opts, referenceHourPrice: 150_000.01, roundingStep: 1000 }).lines;
    assert.ok(up.price >= up.suggestedPriceExact);
    const [same] = computeExtras([overtime({ surchargePerUnit: 0 })], { ...opts, referenceHourPrice: 150_000, roundingStep: 1000 }).lines;
    assert.equal(same.price, 150_000);
    assert.doesNotMatch(suggestedHourHint(same), /Redondeado/);
  });

  test('sin paso de redondeo no se redondea; el precio a mano y los demás adicionales tampoco', () => {
    const [none] = computeExtras([overtime()], { ...opts, roundingStep: 0 }).lines;
    assert.equal(none.price, none.suggestedPriceExact);
    const [manual] = computeExtras([overtime({ price: 123_456.78 })], { ...opts, roundingStep: 1000 }).lines;
    assert.equal(manual.price, 123_456.78);
    const [plain] = computeExtras([{ id: 'f', label: 'Feriado', costPerUnit: 100_000, quantityPerMonth: 1, price: null }], { ...opts, roundingStep: 1000 }).lines;
    assert.ok(Math.abs(plain.price - 100_000 / 0.85) < 1e-6);
  });

  test('el paso se acota al 1 % del precio, como en la tarifa sugerida', () => {
    const [l] = computeExtras([overtime({ costPerUnit: 400, surchargePerUnit: 0 })], { targetMarginPct: 10, billingTaxPct: 5, roundingStep: 1000 }).lines;
    assert.ok(l.price < 1000 && l.price >= l.suggestedPriceExact, `${l.price}`);
  });

  test('redondear no mueve la tarifa principal ni el costo: sólo sube la facturación de esas horas', () => {
    const q = crewByManHour();
    const rounded = computeQuote(q);
    const exact = computeQuote({ ...q, pricing: { ...q.pricing, roundingStep: 0 } });
    const plain = computeQuote({ ...q, extras: [] });
    assert.equal(rounded.kpis.commercialListRate, plain.kpis.commercialListRate);
    assert.ok(Math.abs(rounded.kpis.totalCost - exact.kpis.totalCost) < 1e-6);
    const extra = rounded.outOfHours.lines.reduce((s, l) => s + (l.price - l.suggestedPriceExact) * l.quantity, 0);
    assert.ok(extra > 0 && extra < 2 * 1000 * 18);
  });
});
