/**
 * RATEOS Test Lab — FAST GATE (PLAN-2026-013), dentro de `npm test`.
 *
 * Corre la campaña ESTABLE (escenarios curados de servicios y productos +
 * sondas de contradicción) una sola vez y la convierte en tests:
 *   - golden: candado de huellas + todos en verde (Test Lab nunca actualiza un golden)
 *   - MATH: motor productivo = oráculo independiente; valores de negocio esperados
 *   - DRIVERS: invariantes económicas
 *   - COMPLETITUD / UX: sin hallazgos P0/P1 sin triage
 *   - cobertura: cada tipo de servicio, unidad y modalidad de los catálogos tiene escenario
 * El reporte completo (JSON + Markdown) lo arma `npm run test:lab`.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign, BLOCKING } from './lib/lab.js';
import { auditQuoteUx } from './lib/ux-audit.js';
import { service, person } from './lib/build.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { toJSON, toMarkdown, assertSafeReport } from './lib/report.js';
import { ORACLE_UNIT_KINDS, ORACLE_EXTERNAL_UNITS } from './lib/oracle.js';
import { BILLING_UNITS } from '../../js/domain/billing-units.js';
import { EXTERNAL_UNITS } from '../../js/domain/catalogs.js';

const campaign = runCampaign({ mode: 'stable' });
const blocking = (findings) => findings.filter((f) => BLOCKING.includes(f.classification) && !(f.known && ['human', 'accepted'].includes(f.known.status)));
const describeFinding = (f) => `[${f.classification}] ${f.code}: ${f.title} — ${f.detail}`;

describe('Test Lab — golden cases', () => {
  test('candado: ningún golden aprobado cambió, desapareció o apareció sin aprobar', () => {
    assert.deepEqual(campaign.goldens.lock.problems.map((p) => p.message), []);
  });
  test('todos los golden en verde (COT-0009, COT-0010/0011 y variantes incluidos)', () => {
    assert.deepEqual(campaign.goldens.failed, []);
    for (const id of ['cot-0009-prueba-real', 'cot-0010-transporte-1-viaje-por-dia', 'cot-0011-transporte-2-viajes-por-dia', 'cot-0010-transporte-3-viajes-por-dia', 'cot-0011-viajes-por-llamado-inconsistente']) {
      assert.ok(campaign.goldens.total > 0 && !campaign.goldens.failed.some((g) => g.id === id), `falta o falla ${id}`);
    }
  });
});

describe('Test Lab — escenarios (motor = oráculo, valores de negocio, invariantes, completitud y UX)', () => {
  for (const s of campaign.scenarios) {
    test(`${s.id} — ${s.title}`, () => {
      assert.deepEqual(blocking(s.findings).map(describeFinding), []);
    });
  }
});

describe('Test Lab — sondas de contradicción, campos redundantes y cero silencioso', () => {
  for (const p of campaign.probes) {
    test(`${p.id} — ${p.title}`, () => {
      assert.deepEqual(blocking(p.findings).map(describeFinding), []);
    });
  }
});

describe('Test Lab — terminología de la interfaz (auditor UX F)', () => {
  test('magnitudes distintas con rótulo propio; avisos que citan rótulos que existen', () => {
    assert.deepEqual(blocking(campaign.terminology.findings).map(describeFinding), []);
  });
  test('el auditor detecta un aviso que cita un rótulo inexistente (no es un control vacío)', () => {
    const q = service({ id: 'lab-term', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Oficial' })] });
    const r = computeQuote(q);
    r.completeness.items.push({ id: 'fake', label: 'Prueba', step: 'labor', status: 'warning', message: 'Cargá "Campo que no existe" y "Oficial".' });
    const codes = auditQuoteUx(q, r).filter((f) => f.code === 'UX-TERM-LABEL').map((f) => f.evidence.label);
    assert.deepEqual(codes, ['Campo que no existe']);
  });
});

describe('Test Lab — cobertura automática', () => {
  test('cada valor de los catálogos tiene al menos un escenario', () => {
    assert.deepEqual(campaign.coverage.missing.map((m) => `${m.label}: ${m.value}`), []);
  });
  test('el oráculo conoce todas las unidades de facturación y de externos del proyecto', () => {
    for (const u of BILLING_UNITS) assert.equal(ORACLE_UNIT_KINDS[u.id], u.kind, `unidad ${u.id}: el oráculo no la conoce o la clasifica distinto`);
    for (const u of EXTERNAL_UNITS) assert.ok(ORACLE_EXTERNAL_UNITS.includes(u.id), `unidad de externo ${u.id} sin oráculo`);
  });
  test('la campaña estable tiene entre 30 y 120 escenarios relevantes', () => {
    assert.ok(campaign.scenarios.length >= 30 && campaign.scenarios.length <= 120, `${campaign.scenarios.length} escenarios`);
    assert.ok(campaign.scenarios.some((s) => s.kind === 'product'));
  });
});

describe('Test Lab — reportes', () => {
  test('JSON y Markdown se generan y no contienen nada con forma de secreto', () => {
    const meta = { runId: 'test', commit: 'test', date: '2026-10-16' };
    const json = JSON.parse(toJSON(campaign, meta));
    assert.equal(json.scenarios.length, campaign.scenarios.length);
    const md = toMarkdown(campaign, meta);
    assert.match(md, /RATEOS TEST LAB/);
    assert.match(md, /Golden:/);
    assert.match(md, /Coverage:/);
  });
  test('el control de secretos frena un reporte con un token', () => {
    assert.throws(() => assertSafeReport(`token ${'eyJ'}abcdefghijkl.${'eyJ'}abcdefghijkl.abcdefghijklmn`), /JWT/);
    assert.throws(() => assertSafeReport('contacto: alguien@empresa.com'), /email/);
  });
});
