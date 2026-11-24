/**
 * 0.24.0 (PLAN-2026-028, PR 3, P-11), corregido en la revisión (B-1): un externo NUEVO nace con
 * "¿Recuperás ese IVA?" sin definir, también en responsable inscripto. "Sí" recupera la misma parte
 * (recoverableShare = 1) pero, con el IVA de la cotización aplicado (K-03), su crédito conocido
 * baja el costo financiero. Pasar a "Sí" es una acción de la persona (botón con confirmación).
 * Las líneas guardadas no cambian solas (decisión D6).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createExternalTerms, newExternalVatRecoverable, defaultSettings, createEmptyQuote } from '../../js/domain/quote-factory.js';
import { externalFiscal } from '../../js/engines/external-engine.js';
import { vatFinanceForNewQuote } from '../../js/domain/vat-finance.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { resetIds, service, person, external } from '../lab/lib/build.js';
import { checkQuoteInvariants } from '../lab/lib/invariants.js';

const registered = { ...defaultSettings('org'), vatCondition: 'registered', illustrative: false };

describe('externo nuevo con la condición de la empresa', () => {
  test('nace sin definir con cualquier condición (B-1)', () => {
    for (const vatCondition of ['registered', null, 'monotributo', 'exempt']) assert.equal(newExternalVatRecoverable({ vatCondition }), null, String(vatCondition));
    assert.equal(createExternalTerms({ unit: 'day' }, { settings: registered }).fiscal.vatRecoverable, null);
    assert.equal(createExternalTerms({ unit: 'day' }, { settings: { vatCondition: 'monotributo' } }).fiscal.vatRecoverable, null);
  });

  test('una línea guardada no cambia sola (D6)', () => {
    assert.equal(createExternalTerms({ fiscal: { vatRecoverable: null } }).fiscal.vatRecoverable, null);
    assert.equal(createExternalTerms({ fiscal: { vatRecoverable: 'no' } }, { settings: registered }).fiscal.vatRecoverable, 'no');
    assert.equal(createExternalTerms({ fiscal: { vatRecoverable: 'partial' } }, { settings: registered }).fiscal.vatRecoverable, 'partial');
  });

  test('"Sí" y "sin definir" recuperan lo mismo', () => {
    assert.equal(externalFiscal({ vatPct: 21, vatRecoverable: 'yes' }).recoverableShare, externalFiscal({ vatPct: 21, vatRecoverable: null }).recoverableShare);
  });

  test('INV-34: igual sin el IVA aplicado; con el IVA aplicado, "Sí" ≤ sin definir', () => {
    resetIds();
    const q = service({ id: 'q-ext', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [external({ name: 'Grúa', price: 500000, unit: 'day' })] });
    const r = checkQuoteInvariants(q).find((x) => x.id === 'INV-34');
    assert.ok(r && r.ok && !r.na, r && r.detail);
    const a = structuredClone(q);
    a.equipment[0].external.fiscal = { ...a.equipment[0].external.fiscal, vatPct: 21, vatRecoverable: null };
    const b = structuredClone(a);
    b.equipment[0].external.fiscal.vatRecoverable = 'yes';
    const ra = computeQuote(a);
    const rb = computeQuote(b);
    for (const k of ['totalCost', 'financialCost', 'workingCapital', 'suggestedListRate']) assert.equal(rb.kpis[k], ra.kpis[k], k);
    // Con el IVA aplicado (K-03), "Sí" baja el financiero (el caso del revisor: 449.625 → 386.625).
    resetIds();
    const mk = (rec) => {
      const c = service({ id: 'q-k03', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 15, daysPerActivation: 5, hoursPerActiveDay: 8 },
        equipment: [external({ name: 'Grúa', acquisition: 'rented' }, { price: 500000, unit: 'day', fiscal: { vatPct: 21, vatRecoverable: rec } })] });
      c.finance.vat = { applies: true, ratePct: 21, payLagDays: 20 };
      return c;
    };
    const va = mk(null);
    const vb = mk('yes');
    const rva = computeQuote(va);
    const rvb = computeQuote(vb);
    assert.ok(rvb.kpis.totalCost < rva.kpis.totalCost, `${rvb.kpis.totalCost} ≥ ${rva.kpis.totalCost}`);
    assert.ok(rvb.kpis.financialCost < rva.kpis.financialCost);
    // El invariante prueba los dos casos y pasa.
    const rv = checkQuoteInvariants(va).find((x) => x.id === 'INV-34');
    assert.ok(rv && rv.ok && !rv.na, rv && rv.detail);
    assert.match(rv.detail, /con IVA/);
  });

});

describe('IVA de la cotización nueva', () => {
  test('responsable inscripto con los dos valores: nace con "Sí" y los valores de la empresa', () => {
    const settings = { ...registered, defaultVat: { ratePct: 21, payLagDays: 20 } };
    assert.deepEqual(vatFinanceForNewQuote(settings), { applies: true, ratePct: 21, payLagDays: 20 });
    const q = createEmptyQuote({ organizationId: 'org', settings, id: 'q-vat', now: '2026-11-20T00:00:00.000Z' });
    assert.deepEqual(q.finance.vat, { applies: true, ratePct: 21, payLagDays: 20 });
  });

  test('sin condición o con valores incompletos, la pregunta sigue sin responder', () => {
    assert.equal(vatFinanceForNewQuote({ ...registered, defaultVat: { ratePct: 21, payLagDays: null } }).applies, null);
    assert.equal(vatFinanceForNewQuote({ ...registered, vatCondition: null, defaultVat: { ratePct: 21, payLagDays: 20 } }).applies, null);
  });
});
