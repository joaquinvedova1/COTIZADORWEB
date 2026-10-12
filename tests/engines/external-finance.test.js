/**
 * PLAN-2026-010 · P0: el costo financiero de un equipo o servicio EXTERNO se
 * calcula sobre la SALIDA DE CAJA (neto + IVA + percepciones + cargos no
 * recuperables), no sobre el costo económico. El IVA recuperable y las
 * percepciones no son costo, pero son caja que la empresa adelanta al
 * proveedor hasta cobrar al cliente. Sin tratamiento fiscal definido, caja =
 * costo y nada cambia.
 *
 * Caso del pedido: pickup tercerizada $ 2.800.000/mes, IVA 21 %.
 *   costo económico 2.800.000 · salida de caja 3.388.000 · crédito fiscal 588.000
 * En COT-0009 los proveedores se financian 15 + 60 − 30 = 45 días al 3 % mensual:
 *   cada $ 1 de caja adelantada cuesta 0,03 × 45 / 30 = 0,045.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeExternalLine } from '../../js/engines/external-engine.js';
import { buildCostModel } from '../../js/engines/cost-engine.js';
import { cot0009Quote } from '../fixtures/cot-0009.js';

const close = (actual, expected, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `esperado ${expected}, obtenido ${actual}`);
const FIN_PER_PESO = 0.03 * 45 / 30; // 0,045
// La estructura (10 % del costo directo) se paga a 20 días: 15 + 60 − 20 = 55 días.
const STRUCTURE_FIN_PER_PESO = 0.03 * 55 / 30; // 0,055

const base = computeQuote(cot0009Quote());
const baseFinance = base.kpis.financialCost;
const baseCost = base.kpis.totalCost;
const externalRow = (r) => r.eecc.rows.find((x) => x.category === 'external').amount;

function withFiscal(fiscal) {
  return computeQuote(cot0009Quote({ pickupFiscal: fiscal }));
}

describe('externos: costo económico, salida de caja y crédito fiscal', () => {
  test('pickup $ 2.800.000 + IVA 21 % recuperable: costo 2.800.000, caja 3.388.000, crédito 588.000', () => {
    const x = computeExternalLine(
      { acquisition: 'outsourced', quantity: 1, external: { price: 2800000, unit: 'month', fiscal: { vatPct: 21, vatRecoverable: 'yes' } } },
      { daysPerActivation: 1 },
    );
    close(x.fixedMonthly, 2800000);
    close(x.cashFixedMonthly, 3388000);
    close(x.creditFixedMonthly, 588000);
  });
});

describe('financiación de externos sobre la salida de caja (sin doble conteo)', () => {
  test('sin tratamiento fiscal definido: idéntico al golden COT-0009 (caja = costo)', () => {
    close(baseCost, 28367260.167);
    close(baseFinance, 1422700.767);
    const model = buildCostModel(cot0009Quote());
    const line = model.lines.find((l) => l.key === 'external:e2');
    assert.equal(line.cashFixedMonthly, line.fixedMonthly);
  });

  test('IVA 21 % recuperable: el costo económico NO cambia; se financia el IVA adelantado (588.000 × 0,045 = 26.460)', () => {
    const r = withFiscal({ vatPct: 21, vatRecoverable: 'yes' });
    close(externalRow(r), 2800000);
    close(r.kpis.financialCost - baseFinance, 588000 * FIN_PER_PESO);
    close(r.kpis.financialCost - baseFinance, 26460);
    // El único cambio del costo total es el financiero (la estructura se calcula sobre el costo, no sobre la caja).
    close(r.kpis.totalCost - baseCost, 26460);
    const credit = r.traces.financialCost.inputs.find((i) => /IVA y percepciones/.test(i.label));
    assert.ok(credit, 'Ver cálculo muestra el IVA adelantado');
    close(credit.value, 588000);
  });

  test('IVA 21 % NO recuperable: el IVA es costo (y lleva estructura) y se financia una sola vez', () => {
    const r = withFiscal({ vatPct: 21, vatRecoverable: 'no' });
    close(externalRow(r), 3388000);
    // Caja del proveedor (588.000 × 0,045) + la estructura extra que también se paga (58.800 × 0,055).
    const financed = 588000 * FIN_PER_PESO + 58800 * STRUCTURE_FIN_PER_PESO;
    close(r.kpis.financialCost - baseFinance, financed);
    close(financed, 29694);
    // + 588.000 de costo + 10 % de estructura + financiero.
    close(r.kpis.totalCost - baseCost, 588000 + 58800 + financed);
  });

  test('recuperación parcial 50 %: costo 3.094.000; se financia la caja completa 3.388.000', () => {
    const r = withFiscal({ vatPct: 21, vatRecoverable: 'partial', vatRecoverablePct: 50 });
    close(externalRow(r), 3094000);
    const financed = 588000 * FIN_PER_PESO + 29400 * STRUCTURE_FIN_PER_PESO;
    close(r.kpis.financialCost - baseFinance, financed);
    close(r.kpis.totalCost - baseCost, 294000 + 29400 + financed);
  });

  test('percepciones 3 % con IVA recuperable: caja 3.472.000, costo 2.800.000', () => {
    const r = withFiscal({ vatPct: 21, vatRecoverable: 'yes', perceptionsPct: 3 });
    close(externalRow(r), 2800000);
    close(r.kpis.financialCost - baseFinance, 672000 * FIN_PER_PESO);
  });

  test('IVA recuperable sin alícuota cargada: no se inventa el IVA (caja = costo, sin cambios)', () => {
    const r = withFiscal({ vatPct: null, vatRecoverable: 'yes' });
    close(r.kpis.totalCost, baseCost);
    close(r.kpis.financialCost, baseFinance);
  });

  test('movilización del proveedor no incluida: también se financia su salida de caja', () => {
    const q = cot0009Quote();
    q.equipment[2] = {
      id: 'e3', name: 'Grúa alquilada', acquisition: 'rented', quantity: 1, hoursPerActiveDay: null,
      external: { price: 100000, unit: 'day', minimumUnits: 0, mobilizationIncluded: false, mobilizationAmount: 200000, fiscal: { vatPct: 21, vatRecoverable: 'yes' } },
    };
    const model = buildCostModel(q);
    const mob = model.lines.find((l) => l.key === 'external:mobilization:e3');
    // 200.000 por llamado ÷ 2 días por llamado = 100.000 por día; caja con IVA 121.000.
    close(mob.variablePerActiveDay, 100000);
    close(mob.cashVariablePerActiveDay, 121000);
    const line = model.lines.find((l) => l.key === 'external:e3');
    close(line.variablePerActiveDay, 100000);
    close(line.cashVariablePerActiveDay, 121000);
  });
});
