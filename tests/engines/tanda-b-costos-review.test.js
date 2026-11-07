/**
 * Revisión económica adversarial de la tanda B (2026-11): correcciones de la revisión de costos.
 *   1. Nómina total menor que las personas en sitio → aviso (el costo fijo queda corto).
 *   2. Mínimo garantizado en unidades por encima de la estimación con la tarifa sugerida →
 *      aviso informativo con la tarifa que da el margen objetivo si el cliente paga el mínimo.
 *   3. Ventana de pérdida: coincide con un barrido fino del resultado del mes.
 * (El aviso del proveedor sin "cómo llega" sigue crítico: tests en eco-01.test.js.)
 * Ningún número de las cotizaciones existentes cambia.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createEconomicsContext, evaluateAt } from '../../js/engines/economics-engine.js';

const close = (a, b, tol = 1e-6) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
const crew2x1 = load('especialista-2x1-c1');
const crew24 = load('especialista-24h-c2');
const run2x1 = (q) => computeQuote(q, { settings: crew2x1.settings });
const run24 = (q) => computeQuote(q, { settings: crew24.settings });
const itemOf = (r, id) => r.completeness.items.find((i) => i.id === id) || null;
const noticeOf = (r, id) => r.completeness.notices.find((i) => i.id === id) || null;

describe('Revisión de costos B-1: nómina total menor que en sitio', () => {
  test('2x1 C1 con 3 en sitio y 2 en nómina: aviso (warning) que lleva a "Personas en nómina"; el costo no cambia', () => {
    const q = structuredClone(crew2x1.quote);
    q.labor[0].payrollHeadcount = 2;
    const r = run2x1(q);
    const item = itemOf(r, 'labor_payroll_below_positions');
    assert.ok(item, 'falta el aviso');
    assert.equal(item.status, 'warning');
    assert.equal(item.focus, 'labor.0.payrollHeadcount');
    assert.match(item.message, /3 en sitio a la vez y 2 en nómina/);
    close(r.kpis.totalCost, 58202195, 1e-7);
  });

  test('nómina igual o mayor que en sitio, o sin nómina cargada: sin aviso (las cotizaciones de siempre no cambian)', () => {
    for (const p of [undefined, 3, 5]) {
      const q = structuredClone(crew2x1.quote);
      if (p !== undefined) q.labor[0].payrollHeadcount = p;
      assert.equal(itemOf(run2x1(q), 'labor_payroll_below_positions'), null, `nómina ${p}`);
    }
    const plain = run2x1(structuredClone(crew2x1.quote));
    close(plain.kpis.totalCost, 84542140, 1e-7);
    assert.equal(plain.kpis.suggestedListRate, 105022000);
  });
});

describe('Revisión de costos B-3: mínimo en unidades por encima de la estimación con la sugerida', () => {
  const withMin = (d, extra = {}) => {
    const q = structuredClone(crew24.quote);
    q.activity.activeDaysPerMonth = d;
    Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 });
    Object.assign(q.pricing, extra);
    return q;
  };

  test('24 h C2 con 10 días y mínimo 20: la sugerida (sin el mínimo) da 55 % de margen; el aviso propone 3.621.000 (15 %) y avisa que con 20 días baja', () => {
    const r = run24(withMin(10));
    assert.equal(r.kpis.suggestedListRate, 7242000, 'la sugerida no cambia (criterio conservador)');
    const n = noticeOf(r, 'guarantee_above_estimate');
    assert.ok(n, 'falta el aviso');
    assert.equal(n.severity, 'info');
    close(n.marginAtEstimatePct, r.estimate.marginPct);
    assert.ok(n.marginAtEstimatePct > 55 && n.marginAtEstimatePct < 56);
    assert.equal(n.listRateWithMinimum, 3621000);
    close(n.guaranteeWorkedDays, 20, 1e-6);
    assert.ok(n.marginAtGuaranteeWorkedPct > 6 && n.marginAtGuaranteeWorkedPct < 8);
    assert.match(n.message, /calculada sin el mínimo/);
    // Con esa tarifa ofrecida el margen estimado es el objetivo (redondeo de $ 1.000 hacia arriba).
    const offered = run24(withMin(10, { offeredRateOverride: n.listRateWithMinimum }));
    assert.ok(offered.estimate.marginPct >= 15 - 1e-9 && offered.estimate.marginPct < 15.1);
    assert.equal(noticeOf(offered, 'guarantee_above_estimate'), null, 'con tarifa ofrecida no hay aviso');
  });

  test('sin aviso con la estimación sobre el mínimo, con mínimo en $ o sin mínimo', () => {
    assert.equal(noticeOf(run24(withMin(20)), 'guarantee_above_estimate'), null);
    assert.equal(noticeOf(run24(withMin(26)), 'guarantee_above_estimate'), null);
    const amount = structuredClone(crew24.quote);
    amount.activity.activeDaysPerMonth = 10;
    amount.rules.minimumMonthlyGuarantee = 64660000;
    assert.equal(noticeOf(run24(amount), 'guarantee_above_estimate'), null);
    assert.equal(noticeOf(run24(structuredClone(crew24.quote)), 'guarantee_above_estimate'), null);
  });
});

describe('Revisión de costos B-3: ventana de pérdida contra un barrido fino', () => {
  test('24 h C2 con tarifa fija y mínimos de 10, 20 y 25 días: los tramos coinciden con el barrido a 0,005 día', () => {
    for (const [rate, minUnits] of [[3233000, 20], [3000000, 25], [3600000, 10], [2900000, 20]]) {
      const q = structuredClone(crew24.quote);
      q.pricing.offeredRateOverride = rate;
      Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: minUnits });
      const r = run24(q);
      const ctx = createEconomicsContext(q, r.model);
      const brute = [];
      let start = null;
      const max = q.activity.availableDaysPerMonth;
      for (let i = 0; i <= max * 200; i += 1) {
        const d = i / 200;
        const loss = evaluateAt(ctx, d, rate).profit < -0.01;
        if (loss && start === null) start = d;
        if (!loss && start !== null) { brute.push([start, d]); start = null; }
      }
      if (start !== null) brute.push([start, max]);
      const got = (r.breakEven.lossWindows || []).map((w) => [w.fromDays, w.toDays]);
      assert.equal(got.length, brute.length, `${rate}/${minUnits}: ${JSON.stringify(got)} vs ${JSON.stringify(brute)}`);
      got.forEach((w, i) => {
        assert.ok(Math.abs(w[0] - brute[i][0]) <= 0.006 && Math.abs(w[1] - brute[i][1]) <= 0.006, `${rate}/${minUnits}: ${w} vs ${brute[i]}`);
      });
    }
  });
});
