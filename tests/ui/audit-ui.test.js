/**
 * PLAN-2026-010 · Textos de la auditoría COT-0009 que explican un número sin
 * recalcularlo: fórmula visible de materiales y asistente de datos del
 * proveedor de un externo (nunca inventa tasas ni valores).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { materialFormulaText } from '../../js/ui/views/quote-steps/materials.js';
import { externalChecklist, externalCashText } from '../../js/ui/views/quote-steps/equipment.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';

const norm = (s) => String(s).replace(/ /g, ' ');

test('materiales: la fórmula visible reproduce el costo del mes de COT-0009', () => {
  const q = cot0009Quote();
  const r = computeQuote(q);
  const text = norm(materialFormulaText(q.materials[0], r.model.materials.lines[0], { activeDays: r.activity.activeDaysPerMonth }));
  assert.equal(text, '10 L/día × $ 5.000/L = $ 50.000/día · 20 días = $ 1.000.000/mes');
  const row = r.eecc.rows.find((x) => x.category === 'materials');
  assert.equal(row.amount, 1000000);
});

test('externo: el asistente marca lo que falta sin inventar valores', () => {
  const items = externalChecklist({ acquisition: 'outsourced', external: { price: 2800000, unit: 'month', fiscal: { vatPct: null, vatRecoverable: null } } });
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));
  assert.equal(byId.price.ok, true);
  assert.equal(byId.vat.ok, false);
  assert.equal(byId.recovery.ok, false);
  assert.equal(byId.operator.ok, false);
  const complete = externalChecklist({
    acquisition: 'rented',
    external: {
      price: 100, unit: 'day', operatorIncluded: false, fuelIncluded: true, insuranceIncluded: true, mobilizationIncluded: true,
      fiscal: { vatPct: 21, vatRecoverable: 'yes', perceptionsPct: 0 },
    },
  });
  assert.ok(complete.every((x) => x.ok), JSON.stringify(complete.filter((x) => !x.ok)));
});

test('externo con tarifa fija mensual: la salida de caja es por mes, no "$ 0 por día activo" (V-18)', () => {
  const norm = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
  assert.equal(norm(externalCashText({ cashFixedMonthly: 2420000, cashPerActiveDay: 0, creditFixedMonthly: 420000, creditPerActiveDay: 0 })),
    'Salida de caja con impuestos: $ 2.420.000 por mes; el crédito fiscal ($ 420.000 por mes) no es costo.');
  assert.equal(norm(externalCashText({ cashFixedMonthly: 0, cashPerActiveDay: 605000, creditFixedMonthly: 0, creditPerActiveDay: 105000 })),
    'Salida de caja con impuestos: $ 605.000 por día activo; el crédito fiscal ($ 105.000 por día activo) no es costo.');
  assert.equal(norm(externalCashText({ cashFixedMonthly: 2420000, cashPerActiveDay: 60500, creditFixedMonthly: 420000, creditPerActiveDay: 10500 })),
    'Salida de caja con impuestos: $ 2.420.000 por mes + $ 60.500 por día activo; el crédito fiscal ($ 420.000 por mes + $ 10.500 por día activo) no es costo.');
});
