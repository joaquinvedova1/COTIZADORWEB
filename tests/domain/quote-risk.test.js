/**
 * ECO-02: riesgo de una cotización fuera del Resultado y regla de "Enviada".
 * - riskSummary proyecta la completitud del motor (NO CONFIABLE y críticos);
 * - summarizeQuote lo suma SIN cambiar ningún indicador (kpis idénticos);
 * - sendCheck: NO CONFIABLE o sin calcular → no; críticos → confirmar; si no → sí;
 * - impliesSending: sólo el paso a Enviada (o a Ganada sin haber estado enviada).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { riskSummary, impliesSending, isSendingStatus, sendCheck, unreliablePending, isUnreliableSummary } from '../../js/domain/quote-risk.js';
import { unreliableItems } from '../../js/ui/result-text.js';
import { computeQuote, summarizeQuote } from '../../js/engines/quote-engine.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { service, person, external } from '../lab/lib/build.js';
import { sendGuardText, sendBlockedNote } from '../../js/ui/send-guard.js';

/** Abono mensual + abono de disponibilidad (ECO-01 H-02): resultado NO CONFIABLE. */
const doubleFee = () => service({ id: 'eco02-h02', serviceType: 'permanent', unit: 'month', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 22 }, labor: [person({ role: 'Técnico' })], pricing: { knownRate: 25000000 }, rules: { availabilityFeeMonthly: 25000000 } });
/** Puesto usado sin sueldo básico (ECO-01 H-03): NO CONFIABLE y, además, otro crítico. */
const unpaid = () => service({ id: 'eco02-h03', serviceType: 'on_call', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Operador de hidrogrúa', basicMonthly: null }), person({ role: 'Rigger' })] });
/** Proveedor por km sin ruta: crítico, pero no NO CONFIABLE. */
const criticalOnly = () => service({ id: 'eco02-crit', serviceType: 'transport', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Chofer' })], equipment: [external({ name: 'Camión' }, { price: 3250, unit: 'km', fuelIncluded: true })] });

describe('riskSummary: proyección de la completitud (ECO-02)', () => {
  test('sin completitud o sin pendientes: confiable y sin rótulos', () => {
    for (const c of [null, undefined, {}, { pending: null }, { pending: [] }, { pending: [null, 3, 'x'] }]) {
      assert.deepEqual(riskSummary(c), { unreliable: false, unreliableLabels: [], criticalLabels: [] });
    }
  });

  test('separa NO CONFIABLE de los demás críticos y conserva los rótulos', () => {
    const r = riskSummary({
      pending: [
        { id: 'monthly_fee_overlap', label: 'Dos abonos por mes', severity: 'critical', unreliable: true },
        { id: 'rate', label: 'Tarifa ingresada', severity: 'critical' },
        { id: 'fuel', label: 'Combustible', severity: 'review' },
        { id: 'x', label: '  ', severity: 'critical' },
      ],
    });
    assert.deepEqual(r, { unreliable: true, unreliableLabels: ['Dos abonos por mes'], criticalLabels: ['Tarifa ingresada', 'Pendiente'] });
  });

  test('con el motor: doble abono y puesto sin sueldo son NO CONFIABLES; la ruta faltante es crítica', () => {
    assert.deepEqual(riskSummary(computeQuote(doubleFee()).completeness), { unreliable: true, unreliableLabels: ['Dos abonos por mes'], criticalLabels: [] });
    const u = riskSummary(computeQuote(unpaid()).completeness);
    assert.equal(u.unreliable, true);
    assert.deepEqual(u.unreliableLabels, ['Personal']);
    const c = riskSummary(computeQuote(criticalOnly()).completeness);
    assert.equal(c.unreliable, false);
    assert.ok(c.criticalLabels.includes('Ruta del proveedor'), c.criticalLabels.join(', '));
  });
});

describe('Una sola definición de NO CONFIABLE', () => {
  test('unreliablePending = unreliableItems del Resultado; isUnreliableSummary no cuenta un error de cálculo', () => {
    for (const q of [doubleFee(), unpaid(), criticalOnly()]) {
      const c = computeQuote(q).completeness;
      assert.deepEqual(unreliableItems(c), unreliablePending(c));
      assert.equal(isUnreliableSummary(summarizeQuote(q)), unreliablePending(c).length > 0);
    }
    assert.equal(isUnreliableSummary({ error: true, unreliable: true }), false);
    assert.equal(isUnreliableSummary(null), false);
    assert.equal(isUnreliableSummary({ unreliable: 'sí' }), false);
  });
});

describe('summarizeQuote suma el riesgo sin cambiar ningún número', () => {
  const cases = () => [doubleFee(), unpaid(), criticalOnly(), ...createDemoState(1).quotes];

  test('los indicadores del resumen son exactamente los del motor (kpis)', () => {
    for (const q of cases()) {
      const s = summarizeQuote(structuredClone(q));
      const r = computeQuote(structuredClone(q));
      for (const [key, value] of Object.entries(r.kpis)) assert.deepEqual(s[key], value, `${q.id}: ${key}`);
      assert.equal(s.issuesCount, r.issues.length);
      assert.deepEqual({ unreliable: s.unreliable, unreliableLabels: s.unreliableLabels, criticalLabels: s.criticalLabels }, riskSummary(r.completeness));
    }
  });

  test('el doble abono se marca NO CONFIABLE aunque su margen sea alto y no esté "en riesgo"', () => {
    const s = summarizeQuote(doubleFee());
    assert.equal(s.unreliable, true);
    assert.equal(s.atRisk, false, 'la regla de "en riesgo" del motor no cambia: el riesgo NO CONFIABLE se suma aparte');
    assert.ok(s.marginPct > 50, 'el margen calculado es alto (y no es real)');
  });
});

describe('impliesSending: sólo el paso a Enviada (o a Ganada sin haber estado enviada)', () => {
  test('tabla de transiciones (Perdida ya se mandó: Perdida → Ganada corrige un hecho)', () => {
    const yes = [['draft', 'sent'], ['draft', 'won'], [undefined, 'sent'], [null, 'won'], ['archived', 'sent'], ['archived', 'won']];
    const no = [['sent', 'won'], ['won', 'sent'], ['sent', 'sent'], ['lost', 'won'], ['lost', 'sent'], ['draft', 'lost'], ['draft', 'archived'], ['sent', 'draft'], ['draft', 'draft'], ['draft', 'x']];
    for (const [from, to] of yes) assert.equal(impliesSending(from, to), true, `${from} → ${to}`);
    for (const [from, to] of no) assert.equal(impliesSending(from, to), false, `${from} → ${to}`);
  });

  test('isSendingStatus: sólo Enviada y Ganada', () => {
    assert.deepEqual(['draft', 'sent', 'won', 'lost', 'archived', undefined, 'x'].filter(isSendingStatus), ['sent', 'won']);
  });
});

describe('sendCheck: la regla de "Enviada"', () => {
  test('sin resumen o con error de cálculo: no se puede', () => {
    for (const s of [null, undefined, 'x', { error: true }]) {
      assert.deepEqual(sendCheck(s), { allowed: false, confirm: false, reason: 'failed', items: [] });
    }
  });

  test('NO CONFIABLE: no se puede (aunque también haya críticos), con la causa', () => {
    assert.deepEqual(sendCheck(summarizeQuote(doubleFee())), { allowed: false, confirm: false, reason: 'unreliable', items: ['Dos abonos por mes'] });
    const u = sendCheck(summarizeQuote(unpaid()));
    assert.equal(u.allowed, false);
    assert.deepEqual(u.items, ['Personal']);
    assert.equal(sendCheck({ unreliable: true }).allowed, false, 'sin rótulos también bloquea');
  });

  test('sólo críticos: se puede confirmando, nombrándolos', () => {
    const c = sendCheck(summarizeQuote(criticalOnly()));
    assert.equal(c.allowed, true);
    assert.equal(c.confirm, true);
    assert.equal(c.reason, 'critical');
    assert.ok(c.items.includes('Ruta del proveedor'));
  });

  test('sin pendientes críticos: se marca directo', () => {
    assert.deepEqual(sendCheck({ unreliable: false, unreliableLabels: [], criticalLabels: [] }), { allowed: true, confirm: false, reason: null, items: [] });
  });
});

describe('Textos del aviso de "Enviada" (send-guard)', () => {
  test('se puede sin preguntar: sin texto', () => {
    assert.equal(sendGuardText({ allowed: true, confirm: false, reason: null, items: [] }), null);
    assert.equal(sendBlockedNote({ allowed: true, confirm: true, reason: 'critical', items: ['Tarifa'] }), null);
  });

  test('NO CONFIABLE: dice que no se puede, por qué y qué hacer', () => {
    const t = sendGuardText({ allowed: false, confirm: false, reason: 'unreliable', items: ['Dos abonos por mes'] });
    assert.equal(t.kind, 'blocked');
    assert.equal(t.title, 'No se puede marcar como enviada');
    assert.match(t.message, /NO ES CONFIABLE \(Dos abonos por mes\)/);
    assert.match(t.message, /resolvé lo pendiente antes de mandarla al cliente/);
    assert.match(sendBlockedNote({ allowed: false, confirm: false, reason: 'unreliable', items: ['Personal'] }), /^No se puede marcar como enviada: el resultado de esta cotización NO ES CONFIABLE \(Personal\)/);
    assert.match(sendBlockedNote({ allowed: false, confirm: false, reason: 'unreliable', items: ['Personal'] }, { status: 'won' }), /^No se puede marcar como ganada: /);
  });

  test('sin calcular: lo dice y pide revisarla', () => {
    const t = sendGuardText({ allowed: false, confirm: false, reason: 'failed', items: [] });
    assert.equal(t.kind, 'blocked');
    assert.match(t.message, /no se pueden calcular/);
  });

  test('críticos: confirmación que los nombra; "ganada" usa su propia palabra', () => {
    const t = sendGuardText({ allowed: true, confirm: true, reason: 'critical', items: ['Tarifa ingresada', 'Costo de equipos'] }, { status: 'won' });
    assert.equal(t.kind, 'confirm');
    assert.equal(t.title, '¿Marcarla como ganada con pendientes críticos?');
    assert.match(t.message, /Tarifa ingresada y Costo de equipos/);
    assert.equal(t.confirmLabel, 'Marcar como ganada igual');
    assert.equal(t.cancelLabel, 'Revisar primero');
  });
});
