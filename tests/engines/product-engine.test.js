/**
 * Costeo de productos (PLAN-2026-008): costo por unidad, precio con margen y
 * punto de equilibrio en unidades. Caso de referencia (chipá, ILUSTRATIVO):
 * tanda de 60, ingredientes $ 6.000, empaque $ 20/u, personal 90 min a
 * $ 6.000/h, horno 40 min a $ 1.500/h, fijos $ 175.000/mes, 3.000 u/mes,
 * margen 30 % → costo $ 345, precio $ 492,86, equilibrio 848,7 u/mes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeProduct, convertQuantity, unitIdOf, productBreakEvenUnits, summarizeProduct, computeProductMaterialLine } from '../../js/engines/product-engine.js';
import { exampleProduct, createEmptyProduct, productLaborLine, productEquipmentLine, productMaterialLine, normalizeProductShape } from '../../js/domain/product-factory.js';
import { defaultSettings } from '../../js/domain/quote-factory.js';
import { lineSyncStatus, applyResourceUpdate } from '../../js/domain/resource-sync.js';

const approx = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

/** Producto de referencia con montos redondos (el horno sólo tiene seguro: tenencia $ 50.000/mes). */
function chipa(overrides = {}) {
  return {
    name: 'Chipá',
    saleUnit: 'unidad',
    unitsPerBatch: 60,
    lossPct: 0,
    monthlyUnits: 3000,
    materials: [
      { id: 'm1', description: 'Receta', per: 'batch', unit: 'u', quantity: 1, unitCost: 6000 },
      { id: 'm2', description: 'Bolsita', per: 'unit', unit: 'u', quantity: 1, unitCost: 20 },
    ],
    labor: [{ id: 'l1', role: 'Panadero', basicMonthly: 1056000, normalHoursPerMonth: 176, people: 1, minutesPerBatch: 90 }],
    equipment: [{ id: 'e1', name: 'Horno', minutesPerBatch: 40, energyPerHour: 1500, fixedSharePct: 50, insuranceAnnual: 600000 }],
    fixedCosts: [{ id: 'f1', description: 'Alquiler', monthlyAmount: 600000, sharePct: 25 }],
    pricing: { targetMarginPct: 30, roundingStep: 0 },
    ...overrides,
  };
}

/** Recorre un objeto y devuelve las rutas con NaN o ±Infinity. */
function nonFinitePaths(value, path = '') {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => nonFinitePaths(v, path ? `${path}.${k}` : k));
}

describe('producto: caso de referencia (chipá)', () => {
  const r = computeProduct(chipa());

  test('variable por unidad = (receta + personal + uso de horno) / 60 + empaque = 286,67', () => {
    approx(r.perBatch.materials, 6000);
    approx(r.perBatch.labor, 9000);
    approx(r.perBatch.equipmentUse, 1000);
    approx(r.variablePerUnit, 16000 / 60 + 20);
  });

  test('fijos: horno $ 50.000 × 50 % + alquiler $ 600.000 × 25 % = $ 175.000/mes → $ 58,33 por unidad', () => {
    approx(r.equipmentFixedMonthly, 25000);
    approx(r.otherFixedMonthly, 150000);
    approx(r.fixedPerUnit, 175000 / 3000);
  });

  test('costo $ 345, precio con 30 % $ 492,86 (margen sobre el precio), markup 42,86 %', () => {
    approx(r.unitCost, 345);
    approx(r.pricing.targetPrice, 345 / 0.7);
    approx(r.pricing.suggestedPrice, 345 / 0.7);
    approx(r.pricing.markupPct, (1 / 0.7 - 1) * 100);
    approx(r.pricing.realMarginPct, 30);
    assert.ok(r.pricing.markupPct > r.pricing.marginPct, 'margen ≠ markup');
  });

  test('equilibrio: $ 175.000 / ($ 492,86 − $ 286,67) = 848,7 unidades por mes', () => {
    approx(r.pricing.breakEvenUnits, 175000 / (345 / 0.7 - (16000 / 60 + 20)));
  });

  test('resultado del mes con 3.000 unidades: facturación − variables − fijos', () => {
    approx(r.monthly.revenue, (345 / 0.7) * 3000);
    approx(r.monthly.profit, (345 / 0.7) * 3000 - (16000 / 60 + 20) * 3000 - 175000);
    approx(r.monthly.profit, 0.3 * r.monthly.revenue, 1e-6);
  });

  test('la incidencia suma 100 % y sólo avisa que faltan decidir los impuestos sobre la venta', () => {
    approx(r.breakdown.reduce((s, x) => s + x.displayPct, 0), 100, 1e-9);
    assert.deepEqual(r.issues.map((i) => [i.path, i.severity]), [['billingTaxes', 'warning']]);
    assert.deepEqual(nonFinitePaths(r), []);
  });

  test('horas del mes del personal: 50 tandas × 90 min = 75 h de 176 h (informativo, no cambia el costo)', () => {
    approx(r.batchesPerMonth, 50);
    approx(r.labor[0].hoursPerMonth, 75);
    approx(r.labor[0].usedPct, (75 / 176) * 100);
    // Más horas de las que se trabajan en el mes → aviso (no error) y el costo sigue igual.
    const busy = computeProduct(chipa({ monthlyUnits: 9000, billingTaxes: { notApplicable: true } }));
    approx(busy.labor[0].hoursPerMonth, 225);
    assert.ok(busy.issues.some((i) => i.path === 'labor.0.minutesPerBatch' && i.severity === 'warning'));
    approx(busy.variablePerUnit, 16000 / 60 + 20);
    // Sin ventas cargadas no hay horas del mes (nunca NaN ni Infinity).
    const noSales = computeProduct(chipa({ monthlyUnits: null, fixedCosts: [], equipment: [] }));
    assert.equal(noSales.labor[0].hoursPerMonth, null);
    assert.equal(noSales.labor[0].usedPct, null);
  });

  test('impuestos sobre la venta decididos (no corresponden, o un %) → sin avisos y mismo costo', () => {
    const none = computeProduct(chipa({ billingTaxes: { notApplicable: true } }));
    assert.deepEqual(none.issues, []);
    approx(none.pricing.suggestedPrice, 345 / 0.7);
    const withTax = computeProduct(chipa({ billingTaxes: { mode: 'combined', combinedPct: 5 } }));
    assert.deepEqual(withTax.issues, []);
    approx(withTax.unitCost, 345);
    approx(withTax.pricing.suggestedPrice, 345 / (1 - 0.3 - 0.05));
  });

  test('cada resultado importante tiene "Ver cálculo"', () => {
    for (const key of ['sellable', 'materials', 'labor', 'equipmentUse', 'fixed', 'unitCost', 'floor', 'target', 'breakEven']) {
      assert.ok(r.traces[key] && r.traces[key].formula && r.traces[key].result, key);
    }
    approx(r.traces.unitCost.result.value, 345);
  });
});

describe('producto: fijos vs variables', () => {
  test('los fijos del mes no cambian con las unidades; a cada unidad le toca menos si vendés más', () => {
    const a = computeProduct(chipa({ monthlyUnits: 1500 }));
    const b = computeProduct(chipa({ monthlyUnits: 6000 }));
    approx(a.fixedMonthly, b.fixedMonthly);
    approx(a.variablePerUnit, b.variablePerUnit);
    approx(a.fixedPerUnit, 4 * b.fixedPerUnit);
  });

  test('la tenencia del horno NO entra en el uso por tanda (es fija y va por %)', () => {
    const base = computeProduct(chipa());
    const bigOven = computeProduct(chipa({ equipment: [{ ...chipa().equipment[0], replacementValue: 12000000, usefulLifeYears: 10 }] }));
    approx(bigOven.perBatch.equipmentUse, base.perBatch.equipmentUse);
    approx(bigOven.equipmentFixedMonthly - base.equipmentFixedMonthly, (12000000 / 120) * 0.5);
  });

  test('sin % asignado: la tenencia no se suma y se avisa (nunca se infiere del uso)', () => {
    const r = computeProduct(chipa({ equipment: [{ ...chipa().equipment[0], fixedSharePct: null }] }));
    approx(r.equipmentFixedMonthly, 0);
    assert.ok(r.issues.some((i) => i.path === 'equipment.0.fixedSharePct' && i.severity === 'warning'));
  });

  test('pérdida 5 %: se venden 57 de 60 y el variable por unidad sube', () => {
    const r = computeProduct(chipa({ lossPct: 5 }));
    approx(r.sellablePerBatch, 57);
    approx(r.variablePerUnit, 16000 / 57 + 20);
  });
});

describe('producto: ingredientes, unidades y paquetes', () => {
  test('conversiones g ↔ kg, ml ↔ l, unidad ↔ docena; incompatibles → null', () => {
    approx(convertQuantity(250, 'g', 'kg'), 0.25);
    approx(convertQuantity(1.5, 'l', 'ml'), 1500);
    approx(convertQuantity(6, 'u', 'docena'), 0.5);
    approx(convertQuantity(3, 'Kilos', 'g'), 3000);
    assert.equal(convertQuantity(1, 'kg', 'l'), null);
    assert.equal(convertQuantity(2, 'bolsa', 'bolsa'), 2);
    assert.equal(convertQuantity(2, 'bolsa', 'kg'), null);
    assert.equal(unitIdOf('Litros'), 'l');
    assert.equal(unitIdOf('caja'), null);
  });

  test('600 g de queso a $ 9.000 el kilo = $ 5.400; con 5 % de merma = $ 5.670', () => {
    approx(computeProductMaterialLine({ unit: 'kg', useUnit: 'g', quantity: 600, unitCost: 9000 }).cost, 5400);
    approx(computeProductMaterialLine({ unit: 'kg', useUnit: 'g', quantity: 600, unitCost: 9000, wastePct: 5 }).cost, 5670);
  });

  test('precio del paquete: bolsa de 25 kg a $ 30.000 → $ 1.200 el kilo; sin contenido → aviso y $ 0', () => {
    const ok = computeProductMaterialLine({ unit: 'kg', useUnit: 'kg', quantity: 2, priceMode: 'pack', packPrice: 30000, packSize: 25 });
    approx(ok.unitPrice, 1200);
    approx(ok.cost, 2400);
    const missing = computeProductMaterialLine({ unit: 'kg', quantity: 2, priceMode: 'pack', packPrice: 30000, packSize: 0 });
    assert.equal(missing.cost, 0);
    assert.equal(missing.issue, 'pack_size_missing');
  });

  test('unidades incompatibles: no suma y es un error que hay que corregir', () => {
    const r = computeProduct(chipa({ materials: [{ id: 'x', description: 'Leche', per: 'batch', unit: 'l', useUnit: 'kg', quantity: 1, unitCost: 1000 }] }));
    approx(r.perBatch.materials, 0);
    assert.ok(r.issues.some((i) => i.path === 'materials.0.useUnit' && i.severity === 'error'));
  });

  test('en otra moneda sin tipo de cambio: no suma y es un error; con tipo de cambio, se convierte', () => {
    const usd = { id: 'x', description: 'Insumo importado', per: 'batch', unit: 'u', quantity: 1, unitCost: 10, base: { period: null, currency: 'USD', source: null, note: '' } };
    const gap = computeProduct(chipa({ materials: [usd] }));
    approx(gap.perBatch.materials, 0);
    assert.ok(gap.issues.some((i) => i.path === 'materials.0.base.currency' && i.severity === 'error'));
    const ok = computeProduct(chipa({ materials: [usd], exchangeRates: [{ currency: 'USD', rate: 1000 }] }));
    approx(ok.perBatch.materials, 10000);
  });
});

describe('producto: precio, impuestos, IVA y precio actual', () => {
  test('impuestos sobre la venta con gross-up: piso = costo / (1 − t); con margen = costo / (1 − m − t)', () => {
    const r = computeProduct(chipa({ billingTaxes: { mode: 'combined', combinedPct: 5, items: [], notApplicable: false } }));
    approx(r.pricing.floorPrice, 345 / 0.95);
    approx(r.pricing.targetPrice, 345 / 0.65);
    approx(r.pricing.breakEvenUnits, 175000 / ((345 / 0.65) * 0.95 - (16000 / 60 + 20)));
  });

  test('margen 0 → el precio sugerido es el piso; redondeo comercial siempre hacia arriba', () => {
    const zero = computeProduct(chipa({ pricing: { targetMarginPct: 0, roundingStep: 0 } }));
    approx(zero.pricing.suggestedPrice, zero.pricing.floorPrice);
    const rounded = computeProduct(chipa({ pricing: { targetMarginPct: 30, roundingStep: 50 } }));
    assert.equal(rounded.pricing.suggestedPrice, 500);
    assert.ok(rounded.pricing.realMarginPct >= 30);
  });

  test('IVA sólo si la empresa lo carga: precio al público = precio × (1 + IVA)', () => {
    assert.equal(computeProduct(chipa()).pricing.priceWithVat, null);
    approx(computeProduct(chipa({ pricing: { targetMarginPct: 30, roundingStep: 0, vatPct: 21 } })).pricing.priceWithVat, (345 / 0.7) * 1.21);
  });

  test('precio actual: por debajo del piso, margen negativo; por debajo del variable, equilibrio inalcanzable', () => {
    const below = computeProduct(chipa({ pricing: { targetMarginPct: 30, roundingStep: 0, currentPrice: 300 } }));
    assert.equal(below.current.belowFloor, true);
    assert.ok(below.current.marginPct < 0);
    approx(below.current.profitPerUnit, 300 - 345);
    const underVariable = computeProduct(chipa({ pricing: { targetMarginPct: 30, roundingStep: 0, currentPrice: 250 } }));
    assert.equal(underVariable.current.belowVariable, true);
    assert.equal(underVariable.current.breakEvenUnits, null);
    assert.deepEqual(nonFinitePaths(underVariable), []);
  });

  test('margen ≥ 100 y margen + impuestos ≥ 100 → error, sin precio ni Infinity', () => {
    const bad = computeProduct(chipa({ pricing: { targetMarginPct: 100, roundingStep: 0 } }));
    assert.ok(bad.issues.some((i) => i.path === 'pricing.targetMarginPct' && i.severity === 'error'));
    const tooMuch = computeProduct(chipa({ pricing: { targetMarginPct: 96, roundingStep: 0 }, billingTaxes: { mode: 'combined', combinedPct: 5, items: [] } }));
    assert.equal(tooMuch.pricing.targetPrice, null);
    assert.ok(tooMuch.issues.some((i) => i.path === 'pricing.targetMarginPct' && i.severity === 'error'));
    assert.deepEqual(nonFinitePaths(tooMuch), []);
  });

  test('equilibrio: sin fijos = 0 unidades; contribución ≤ 0 = inalcanzable (null)', () => {
    assert.equal(productBreakEvenUnits({ fixedMonthly: 0, variablePerUnit: 100, price: 200 }), 0);
    assert.equal(productBreakEvenUnits({ fixedMonthly: 1000, variablePerUnit: 200, price: 200 }), null);
    assert.equal(productBreakEvenUnits({ fixedMonthly: 1000, variablePerUnit: 100, price: 200, taxPct: 50 }), null);
  });
});

describe('producto: casos extremos (sin NaN ni Infinity)', () => {
  const cases = {
    'tanda vacía': chipa({ unitsPerBatch: 0 }),
    'pérdida 100 %': chipa({ lossPct: 100 }),
    'sin ventas por mes con fijos': chipa({ monthlyUnits: 0 }),
    'sin ventas por mes y sin fijos': chipa({ monthlyUnits: 0, equipment: [], fixedCosts: [] }),
    'todo vacío': {},
    'valores negativos': chipa({ unitsPerBatch: -10, monthlyUnits: -5, lossPct: -3 }),
    'personal sin horas normales': chipa({ labor: [{ role: 'X', basicMonthly: 100000, normalHoursPerMonth: 0, minutesPerBatch: 60 }] }),
  };
  for (const [name, product] of Object.entries(cases)) {
    test(name, () => {
      const r = computeProduct(product);
      assert.deepEqual(nonFinitePaths(r), [], name);
    });
  }

  test('tanda 0 → sin costo por unidad y error que dice qué cargar', () => {
    const r = computeProduct(chipa({ unitsPerBatch: 0 }));
    assert.equal(r.unitCost, null);
    assert.equal(r.pricing.suggestedPrice, null);
    assert.ok(r.issues.some((i) => i.path === 'unitsPerBatch' && i.severity === 'error'));
  });

  test('sin ventas por mes con fijos → no se puede repartir el fijo: error; sin fijos, el costo es el variable', () => {
    const withFixed = computeProduct(chipa({ monthlyUnits: 0 }));
    assert.equal(withFixed.fixedPerUnit, null);
    assert.ok(withFixed.issues.some((i) => i.path === 'monthlyUnits'));
    const noFixed = computeProduct(chipa({ monthlyUnits: 0, equipment: [], fixedCosts: [] }));
    approx(noFixed.unitCost, noFixed.variablePerUnit);
  });

  test('no modifica el producto recibido y es determinístico', () => {
    const p = chipa();
    const before = JSON.stringify(p);
    const a = computeProduct(p);
    const b = computeProduct(p);
    assert.equal(JSON.stringify(p), before);
    assert.deepEqual(a, b);
  });

  test('resumen para listas nunca lanza', () => {
    assert.equal(summarizeProduct(null).error, false);
    approx(summarizeProduct(chipa()).unitCost, 345);
  });
});

describe('producto: factory, ejemplo y Recursos', () => {
  const NOW = '2026-10-11T00:00:00.000Z';
  let n = 0;
  const ids = () => `id-${++n}`;

  test('producto vacío: sin redondeo de servicios, impuestos de la empresa, IVA sin cargar', () => {
    const settings = { ...defaultSettings('org'), roundingStep: 1000 };
    const p = createEmptyProduct({ organizationId: 'org', settings, now: NOW, id: 'p' });
    assert.equal(p.pricing.roundingStep, 0);
    assert.equal(p.pricing.vatPct, null);
    assert.deepEqual(normalizeProductShape(p), p);
    assert.equal(computeProduct(p).unitCost, null);
  });

  test('ejemplo "Chipá": todo marcado ILUSTRATIVO, sin errores y con números finitos', () => {
    const p = exampleProduct({ settings: defaultSettings('org'), now: NOW, id: 'p', idFactory: ids });
    assert.equal(p.illustrative, true);
    for (const list of ['materials', 'labor', 'equipment']) assert.ok(p[list].every((l) => l.illustrative === true), list);
    const r = computeProduct(p);
    assert.equal(r.issues.filter((i) => i.severity === 'error').length, 0);
    assert.ok(r.unitCost > 0 && r.pricing.suggestedPrice > r.unitCost);
    assert.deepEqual(nonFinitePaths(r), []);
  });

  test('líneas desde Recursos guardan una copia: el recurso cambia, el producto no (y se puede actualizar)', () => {
    const profile = { id: 'lp', role: 'Panadero', basicMonthly: 1000000, normalHoursPerMonth: 176 };
    const line = { ...productLaborLine(profile, null, { id: 'l', now: NOW }), minutesPerBatch: 90, people: 2 };
    const resources = { laborProfiles: [profile], agreements: [] };
    assert.equal(lineSyncStatus('labor', line, resources).state, 'current');
    const changed = { laborProfiles: [{ ...profile, basicMonthly: 1200000 }], agreements: [] };
    assert.equal(lineSyncStatus('labor', line, changed).state, 'changed');
    assert.equal(line.basicMonthly, 1000000);
    const updated = applyResourceUpdate('labor', line, changed, { now: NOW });
    assert.equal(updated.basicMonthly, 1200000);
    assert.equal(updated.minutesPerBatch, 90, 'conserva el tiempo por tanda');
    assert.equal(updated.people, 2, 'conserva las personas');
  });

  test('máquina desde Recursos: % de fijos sin cargar; al actualizar conserva tiempo, energía y %', () => {
    const eq = { id: 'eq', name: 'Horno', acquisition: 'owned', replacementValue: 3000000, usefulLifeYears: 10, residualValue: 0 };
    const line = { ...productEquipmentLine(eq, { id: 'e', now: NOW }), minutesPerBatch: 40, energyPerHour: 1500, fixedSharePct: 50 };
    assert.equal(productEquipmentLine(eq, { id: 'e2', now: NOW }).fixedSharePct, null);
    const changed = { equipment: [{ ...eq, replacementValue: 3600000 }] };
    assert.equal(lineSyncStatus('equipment', line, { equipment: [eq] }).state, 'current');
    const updated = applyResourceUpdate('equipment', line, changed, { now: NOW });
    assert.equal(updated.replacementValue, 3600000);
    assert.deepEqual([updated.minutesPerBatch, updated.energyPerHour, updated.fixedSharePct], [40, 1500, 50]);
  });

  test('material desde Recursos: unidad de texto libre normalizada y cantidad por cargar', () => {
    const mat = { id: 'mt', description: 'Harina', unit: 'Kilos', unitCost: 1200 };
    const line = productMaterialLine(mat, { id: 'x', now: NOW });
    assert.equal(line.unit, 'kg');
    assert.equal(line.quantity, null);
    assert.equal(lineSyncStatus('materials', line, { materials: [mat] }).state, 'current');
    approx(computeProductMaterialLine({ ...line, quantity: 500, useUnit: 'g' }).cost, 600);
  });
});
