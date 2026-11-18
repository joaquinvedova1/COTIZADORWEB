// Auditoría externa (2026-11-16): A-01, A-04, A-05, A-06 y A-03.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimalInput, validateQuote } from '../../js/core/validation.js';
import { productFixedCostOverAssignment } from '../../js/domain/resource-usage.js';
import { validateProduct } from '../../js/engines/product-engine.js';

test('A-01: "0.250" es 0,25 (un grupo de miles nunca empieza en 0)', () => {
  assert.equal(parseDecimalInput('0.250'), 0.25);
  assert.equal(parseDecimalInput('-0.500'), -0.5);
  assert.equal(parseDecimalInput('1.250'), 1250);
  assert.equal(parseDecimalInput('1.234.567,89'), 1234567.89);
  assert.equal(parseDecimalInput('12.5'), 12.5);
  assert.ok(Number.isNaN(parseDecimalInput('0.250,5')));
});

test('A-05: descuento del 100 % es error; 99 % no', () => {
  const issues = validateQuote({ pricing: { commercialDiscountPct: 100 }, rules: { continuityDiscountPct: 100, volumeTiers: [{ discountPct: 100 }] } });
  const paths = issues.filter((i) => i.severity === 'error' && /100 %/.test(i.message)).map((i) => i.path);
  assert.deepEqual(paths.sort(), ['pricing.commercialDiscountPct', 'rules.continuityDiscountPct', 'rules.volumeTiers.0.discountPct'].sort());
  assert.equal(validateQuote({ pricing: { commercialDiscountPct: 99 } }).filter((i) => /descuento/.test(i.message)).length, 0);
});

test('A-04: contingencia de 100 % o más avisa; sólo cuentan los riesgos elegidos', () => {
  const over = validateQuote({ risk: { generalPct: 50, items: [{ enabled: true, pct: 20 }, { enabled: true, pct: 20 }, { enabled: true, pct: 20 }] } });
  assert.ok(over.some((i) => i.path === 'risk.generalPct' && i.severity === 'warning' && /110 %/.test(i.message)));
  const ok = validateQuote({ risk: { generalPct: 50, items: [{ enabled: false, pct: 60 }] } });
  assert.ok(!ok.some((i) => /contingencia/i.test(i.message)));
});

test('A-06: IVA de 100 % o más avisa', () => {
  assert.ok(validateProduct({ unitsPerBatch: 1, pricing: { vatPct: 100 } }).some((i) => i.path === 'pricing.vatPct'));
  assert.ok(!validateProduct({ unitsPerBatch: 1, pricing: { vatPct: 21 } }).some((i) => i.path === 'pricing.vatPct'));
});

test('A-03: el mismo gasto fijo o máquina en dos productos por encima de 100 % se avisa', () => {
  const rent = (pct) => ({ description: 'Alquiler', monthlyAmount: 600000, sharePct: pct });
  const over = productFixedCostOverAssignment([
    { id: 'a', name: 'Chipá', fixedCosts: [rent(100)] },
    { id: 'b', name: 'Medialunas', fixedCosts: [{ ...rent(100), description: '  alquiler (ejemplo) ' }] },
  ]);
  assert.equal(over.length, 1);
  assert.equal(over[0].totalPct, 200);
  assert.equal(productFixedCostOverAssignment([{ fixedCosts: [rent(60)] }, { fixedCosts: [rent(40)] }]).length, 0);
  const machine = (pct) => ({ name: 'Horno', snapshot: { resourceId: 'eq-1' }, fixedSharePct: pct });
  assert.equal(productFixedCostOverAssignment([{ equipment: [machine(70)] }, { equipment: [machine(50)] }])[0].totalPct, 120);
});
