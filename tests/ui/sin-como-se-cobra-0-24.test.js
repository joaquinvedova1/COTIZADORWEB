/**
 * 0.24.0 (PLAN-2026-028, PR 1): el paso "Cómo se cobra" se disolvió y el precio a mano es UN campo.
 *
 * - El ritmo de trabajo va en "El servicio"; "Horas extra del trabajo" al final de "Personal";
 *   "¿Cómo viaja el personal a la locación?" en "Movilización y viajes"; la hora fuera de horario,
 *   la guardia y los adicionales cargados antes en "El precio" (bloque "Cargado antes").
 * - "¿Ya tenés un precio?" escribe en `pricing.knownRate` (known_rate) o en
 *   `pricing.offeredRateOverride` (las demás). Mismos números (INV-33).
 * - Ningún número cambia: sólo `step` y textos de la completitud.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { QUOTE_STEPS, PRICING_MODES } from '../../js/domain/catalogs.js';
import { STAGES, stageOfStep, stepOfItem } from '../../js/ui/views/quote-editor.js';
import { stepOfPath, fieldHref } from '../../js/ui/field-links.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { createDemoState } from '../../js/domain/demo-data.js';
import { SERVICE_SCENARIOS } from '../lab/scenarios/services.js';
import { PROBES } from '../lab/scenarios/probes.js';
import { resetIds, service, person } from '../lab/lib/build.js';
import { retiredStepNames } from '../lab/lib/ux-audit.js';
import { checkQuoteInvariants } from '../lab/lib/invariants.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('sin el paso "Cómo se cobra"', () => {
  test('10 pasos y 5 etapas', () => {
    assert.equal(QUOTE_STEPS.length, 10);
    assert.ok(!QUOTE_STEPS.some((s) => s.id === 'modality'));
    assert.deepEqual(STAGES.map((s) => s.label), ['El servicio', 'Los recursos', 'Otros gastos', 'El precio', 'Resultado']);
    // Cada paso está en una etapa.
    QUOTE_STEPS.forEach((s) => assert.ok(STAGES.some((st) => st.steps.some((x) => x.id === s.id)), s.id));
    assert.equal(stageOfStep('margin').stage.label, 'El precio');
  });

  test('el modelo conserva pricingMode y sus dos modos', () => {
    assert.deepEqual(PRICING_MODES.map((m) => m.id).sort(), ['known_activity', 'known_rate']);
  });

  test('cada campo va a su paso nuevo', () => {
    const expected = {
      'pricing.knownRate': 'margin',
      'pricing.offeredRateOverride': 'margin',
      pricingMode: 'margin',
      'extras.0.price': 'margin',
      'overtimeWork.mode': 'labor',
      'overtimeWork.hours50': 'labor',
      unit: 'service',
      'activity.availability': 'margin',
      'activity.availabilityHoursPerDay': 'margin',
      'activity.guardType': 'margin',
      'activity.travelPattern': 'logistics',
      'activity.activeDaysPerMonth': 'service',
      'activity.hoursPerActiveDay': 'service',
      'activity.fullActivations': 'service',
    };
    for (const [path, step] of Object.entries(expected)) assert.equal(stepOfPath(path), step, path);
    assert.equal(fieldHref('q1', 'overtimeWork.hours50'), '#/cotizaciones/q1/labor?campo=overtimeWork.hours50');
  });

  test('ningún ítem ni aviso de la completitud apunta a "modality"', () => {
    const demo = createDemoState(1);
    const runs = [
      ...demo.quotes.map((q) => computeQuote(structuredClone(q), { settings: demo.settings })),
      ...[...SERVICE_SCENARIOS, ...PROBES].map((s) => { resetIds(); return computeQuote(structuredClone(s.build())); }),
    ];
    const steps = new Set(QUOTE_STEPS.map((s) => s.id));
    for (const r of runs) {
      for (const i of [...r.completeness.items, ...(r.completeness.notices || [])]) {
        if (i.step !== undefined) assert.ok(steps.has(i.step), `${i.id} → ${i.step}`);
        assert.doesNotMatch(String(i.message || ''), /c[oó]mo se cobra/i, i.id);
      }
      for (const i of r.completeness.items) assert.ok(steps.has(stepOfItem(i)), i.id);
    }
  });

  test('"Unidad de cobro" se revisa en "El servicio"; la tarifa que falta, en "El precio"', () => {
    const q = service({ id: 'q-rate', serviceType: 'crew', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 10 }, labor: [person()], pricing: { knownRate: 0 } });
    const items = computeQuote(q).completeness.items;
    const unit = items.find((i) => i.id === 'modality');
    assert.equal(unit.label, 'Unidad de cobro');
    assert.equal(unit.step, 'service');
    const rate = items.find((i) => i.id === 'rate');
    assert.equal(rate.step, 'margin');
    assert.equal(rate.focus, 'pricing.knownRate');
    assert.equal(rate.message, 'Falta tu precio en «El precio».');
  });

  test('ningún texto del código dice "Cómo se cobra" (UX-TERM-STEP)', () => {
    assert.deepEqual(retiredStepNames(), []);
  });

  test('un enlace viejo …/modality abre "El precio"', () => {
    const editor = code('js/ui/views/quote-editor.js');
    assert.match(editor, /requested === 'modality'/);
    // Sin "?campo=", "El precio"; con campo, el paso donde vive (revisión de la 0.24.0, C3).
    assert.match(editor, /QUOTE_STEPS\.some\(\(s\) => s\.id === target\) \? target : 'margin'/);
    assert.match(editor, /\/\$\{step\}\$\{at >= 0 \? hash\.slice\(at\) : ''\}/);
  });
});

describe('un solo campo de precio a mano', () => {
  test('"El precio" tiene un campo que escribe en knownRate o en offeredRateOverride', () => {
    const margin = code('js/ui/views/quote-steps/margin.js');
    assert.match(margin, /const priceField = isModeB \? 'pricing\.offeredRateOverride' : 'pricing\.knownRate';/);
    assert.match(margin, /'¿Ya tenés un precio\? \(opcional, sin IVA\)'/);
    assert.match(margin, /Vacío = RATEOS te sugiere el precio con tu margen/);
    assert.match(margin, /'Borrar mi precio y usar el sugerido'/);
    // Ya no hay "Tarifa ofrecida a mano" en "Más detalle" ni el campo fijo "Tu tarifa".
    assert.doesNotMatch(margin, /a mano \(opcional, de lista/);
    assert.doesNotMatch(margin, /kit\.staticField\(`Tu tarifa/);
    assert.equal((margin.match(/kit\.num\(priceField/g) || []).length, 1);
    assert.doesNotMatch(margin, /kit\.num\('pricing\.(knownRate|offeredRateOverride)'/);
  });

  test('modality.js ya no pregunta el modo ni la tarifa', () => {
    const modality = code('js/ui/views/quote-steps/modality.js');
    assert.doesNotMatch(modality, /¿Ya sabés qué/);
    assert.doesNotMatch(modality, /pricing\.knownRate/);
    assert.doesNotMatch(modality, /'Lo que ya cargaste'/);
    assert.doesNotMatch(modality, /¿Tu gente y tus equipos trabajan sólo para este servicio\?/);
    assert.doesNotMatch(modality, /Ver tarifas según el margen/);
    for (const part of ['overtime', 'travel', 'legacy']) assert.match(modality, new RegExp(`${part}: \\[`));
    assert.match(code('js/ui/views/quote-steps/labor.js'), /part: 'overtime'/);
    assert.match(code('js/ui/views/quote-steps/logistics.js'), /part: 'travel'/);
    assert.match(code('js/ui/views/quote-steps/margin.js'), /part: 'legacy'/);
  });

  test('INV-33: el mismo precio como "Tu tarifa" o "Tarifa ofrecida a mano" da los mismos números', () => {
    for (const s of SERVICE_SCENARIOS) {
      resetIds();
      const r = checkQuoteInvariants(s.build()).find((x) => x.id === 'INV-33');
      assert.ok(r && r.ok, `${s.id}: ${r && r.detail}`);
    }
  });

  test('"Borrar mi precio y usar el sugerido" deja la cotización con el precio sugerido', () => {
    const q = service({ id: 'q-reset', serviceType: 'crew', unit: 'day', pricingMode: 'known_rate', activity: { activeDaysPerMonth: 10 }, labor: [person()], pricing: { knownRate: 1500000 } });
    const before = computeQuote(structuredClone(q));
    assert.equal(before.kpis.commercialSource, 'known_rate');
    // Lo mismo que hace el botón (margin.js, useSuggested).
    q.pricingMode = 'known_activity';
    q.pricing.knownRate = 0;
    q.pricing.offeredRateOverride = null;
    const after = computeQuote(q);
    assert.equal(after.kpis.commercialSource, 'suggested');
    assert.equal(after.kpis.commercialListRate, after.kpis.suggestedListRate);
    assert.equal(after.kpis.totalCost, before.kpis.totalCost);
  });
});
