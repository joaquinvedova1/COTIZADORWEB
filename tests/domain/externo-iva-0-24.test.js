/**
 * 0.24.0 (PLAN-2026-028, PR 3, P-11): un externo NUEVO de una empresa responsable inscripta nace
 * con "¿Recuperás ese IVA?" = Sí. Da el mismo costo que "sin definir" (recoverableShare = 1).
 * Las líneas guardadas no cambian solas (decisión D6): sin `settings`, createExternalTerms deja
 * lo que había.
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
  test('responsable inscripto → "Sí"; el resto, sin definir', () => {
    assert.equal(newExternalVatRecoverable(registered), 'yes');
    for (const vatCondition of [null, 'monotributo', 'exempt']) assert.equal(newExternalVatRecoverable({ vatCondition }), null, String(vatCondition));
    assert.equal(createExternalTerms({ unit: 'day' }, { settings: registered }).fiscal.vatRecoverable, 'yes');
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

  test('INV-34: mismo costo, misma caja y misma tarifa', () => {
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
