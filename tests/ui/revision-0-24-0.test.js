/**
 * Revisión de la 0.24.0 (project files auditoria-beta/revision-0-24-0, UX.md y COSTOS.md).
 * Ningún número de una cotización cambia: son pantalla y textos.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { shownMarginPct } from '../../js/ui/result-text.js';
import { resetIds, service, person } from '../lab/lib/build.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const load = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('B-2: el margen de "ganás" es el pedido sólo si la diferencia es del redondeo', () => {
  const crew24 = load('especialista-24h-c2');
  const withMin = (d) => {
    const q = structuredClone(crew24.quote);
    q.activity.activeDaysPerMonth = d;
    Object.assign(q.rules, { minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 20 });
    return computeQuote(q, { settings: crew24.settings });
  };

  test('24 h C2 con 10 días y mínimo de 20 unidades: se muestra el margen real del motor (55,4 %), no el 15 % pedido', () => {
    const r = withMin(10);
    const k = r.kpis;
    assert.equal(k.commercialSource, 'suggested');
    assert.ok(r.estimate.revenue.guaranteeTopUp > 0, 'el mínimo completa la facturación');
    assert.ok(k.marginPct > 55 && k.marginPct < 56, String(k.marginPct));
    assert.equal(shownMarginPct(k, { guaranteeTopUp: r.estimate.revenue.guaranteeTopUp }), k.marginPct);
  });

  test('diferencia de redondeo (menos de 1 punto, real ≥ pedido): se muestra el pedido', () => {
    resetIds();
    const r = computeQuote(service({ id: 'q-b2', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] }));
    const k = r.kpis;
    assert.ok(k.marginPct > k.targetMarginPct && k.marginPct - k.targetMarginPct < 1);
    assert.equal(shownMarginPct(k), k.targetMarginPct);
  });

  test('real por debajo del pedido, 1 punto o más arriba, o con otro precio: el real', () => {
    const base = { commercialSource: 'suggested', targetMarginPct: 10, profit: 1, targetMarginInvalid: false };
    assert.equal(shownMarginPct({ ...base, marginPct: 9.99 }), 9.99);
    assert.equal(shownMarginPct({ ...base, marginPct: 11 }), 11);
    assert.equal(shownMarginPct({ ...base, marginPct: 10.6 }), 10);
    assert.equal(shownMarginPct({ ...base, marginPct: 10.6 }, { guaranteeTopUp: 100 }), 10.6);
    assert.equal(shownMarginPct({ ...base, commercialSource: 'offered', marginPct: 10.6 }), 10.6);
  });

  test('el Resultado y "El precio" usan el mismo criterio (C4 de UX)', () => {
    assert.match(code('js/ui/views/quote-result.js'), /shownMarginPct\(k, \{ covered, losing, marginPct, guaranteeTopUp: rev\.guaranteeTopUp \}\)/);
    assert.match(code('js/ui/views/quote-steps/margin.js'), /kit\.stat\('Margen esperado', \(r\) => [^\n]*shownMarginPct\(/);
  });
});

describe('B1 de UX / C-7 de costos: "Te cuesta · impuestos · ganás" cierra con lo facturado', () => {
  test('el motor: facturación = costo + impuestos + ganancia', () => {
    resetIds();
    const r = computeQuote(service({ id: 'q-b1', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] }));
    const k = r.kpis;
    assert.ok(k.billingTaxes > 0);
    assert.ok(Math.abs(k.revenue - k.totalCost - k.billingTaxes - k.profit) < 0.01);
  });

  test('la línea muestra los impuestos del motor entre el costo y la ganancia', () => {
    const src = code('js/ui/views/quote-result.js');
    assert.match(src, /impuestos sobre lo que facturás \$\{money\(/);
    assert.match(src, /k\.billingTaxes > 0\.005 \? k\.billingTaxes : null/);
  });
});

describe('C-1 / C-2 de costos, C1 de UX: el campo de precio en "ya tengo la tarifa"', async () => {
  const { useSuggestedPlan } = await import('../../js/ui/views/quote-steps/margin.js');
  const margin = code('js/ui/views/quote-steps/margin.js');

  test('opcional en los dos modos: sin asterisco; el texto de muestra depende del modo', () => {
    assert.doesNotMatch(margin, /requiredMark: !isModeB/);
    assert.match(margin, /placeholder: isModeB \? 'Usar el sugerido' : 'Escribí tu precio'/);
    assert.match(margin, /blankZero: !isModeB/);
  });

  test('vaciar el campo hace lo mismo que el botón', () => {
    // Al confirmar el campo (change), no mientras se escribe.
    assert.match(margin, /ownPriceInput\.addEventListener\('change', \(\) => \{\n\s+if \(!\(Number\(kit\.get\('pricing\.knownRate'\)\) > 0\) && knownBefore > 0\) useSuggested\(\{ fromEmpty: true \}\);/);
  });

  test('la confirmación avisa si faltan los días y lleva a ese campo; sin "$ 0"', () => {
    const noDays = useSuggestedPlan({ pricingMode: 'known_rate', unit: 'day', activity: { activeDaysPerMonth: null }, pricing: { knownRate: 0 } });
    assert.equal(noDays.missingPath, 'activity.activeDaysPerMonth');
    assert.match(noDays.message, /falta cuántos días por mes trabajás \(en «El servicio»\)/);
    assert.doesNotMatch(noDays.message, /\$\s?0\b/);
    const ok = useSuggestedPlan({ pricingMode: 'known_rate', unit: 'day', activity: { activeDaysPerMonth: 10 }, pricing: { knownRate: 1500000 } });
    assert.equal(ok.missingPath, null);
    assert.match(ok.message, /Se borra tu precio de esta cotización \(\$\s1\.500\.000\)/);
    // Vaciado: el precio que tenía antes de vaciarlo.
    const emptied = useSuggestedPlan({ pricingMode: 'known_rate', unit: 'day', activity: { activeDaysPerMonth: 10 }, pricing: { knownRate: null } }, { known: 1500000 });
    assert.match(emptied.message, /1\.500\.000/);
  });
});

describe('C-3 de costos: "¿Cómo viaja el personal?" con el paso de viajes oculto', async () => {
  const { travelInService } = await import('../../js/ui/views/quote-steps/service.js');
  const { isStepHidden } = await import('../../js/ui/views/quote-editor.js');
  const { material } = await import('../lab/lib/build.js');
  const mk = (dpa, { perActivation = true } = {}) => {
    resetIds();
    const q = service({ id: 'q-c3', serviceType: 'on_call', unit: 'month', activity: { activeDaysPerMonth: 20, daysPerActivation: dpa, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Técnico' })],
      materials: perActivation ? [material({ description: 'Kit por salida', basis: 'per_activation', quantity: 1, unitCost: 100000 })] : [] });
    q.contract = { mode: 'monthly', components: perActivation ? ['labor', 'materials'] : ['labor'] };
    return q;
  };

  test('cobro por mes, viajes ocultos y algo por salida: el dato mueve números y se monta en "El servicio"', () => {
    const q1 = mk(1);
    const q14 = mk(14);
    assert.equal(isStepHidden('logistics', q1), true);
    assert.notEqual(Math.round(computeQuote(q1).kpis.totalCost), Math.round(computeQuote(q14).kpis.totalCost));
    assert.equal(travelInService(q1), true);
    assert.equal(travelInService(q14), true);
  });

  test('sin nada por salida, sólo si ya tiene un ritmo distinto de uno por día', () => {
    assert.equal(travelInService(mk(1, { perActivation: false })), false);
    assert.equal(travelInService(mk(14, { perActivation: false })), true);
  });

  test('con el paso de viajes a la vista, queda en "Movilización y viajes"', () => {
    const q = mk(14);
    q.contract.components.push('travel');
    assert.equal(isStepHidden('logistics', q), false);
    assert.equal(travelInService(q), false);
  });

  test('service.js monta la parte "travel" del ritmo', () => {
    assert.match(code('js/ui/views/quote-steps/service.js'), /if \(travelInService\(quote\)\) \{[\s\S]{0,200}renderCharge\(travelSlot, \{ \.\.\.ctx, part: 'travel' \}\)/);
  });
});

describe('UX: textos y orden (C2, C3, C5, C6, C10, C11; C-6 de costos)', async () => {
  const { retiredFloorNames } = await import('../lab/lib/ux-audit.js');

  test('C10: ningún literal dice "piso" (UX-TERM-FLOOR ampliado)', () => {
    assert.deepEqual(retiredFloorNames(), []);
    assert.match(code('tests/lab/lib/ux-audit.js'), /const RETIRED_FLOOR_NAME = \/\\bpiso\\b\/i;/);
    assert.match(code('js/ui/views/dashboard.js'), /'Servicios por debajo de la tarifa mínima'/);
    assert.match(code('js/ui/views/quote-result.js'), /'Tarifa por debajo de la mínima\.'/);
    assert.match(code('js/ui/result-text.js'), /`La tarifa mínima supone que facturás/);
  });

  test('C2: "Cargado antes" va antes de "Opciones comerciales" (la guardia dice "más abajo")', () => {
    const margin = code('js/ui/views/quote-steps/margin.js');
    assert.ok(margin.indexOf("legacyShown ? legacySlot : null,") < margin.indexOf('showCommercial ? commercialCard : null,'));
    assert.match(code('js/ui/views/quote-steps/modality.js'), /se cambian más abajo, en "Opciones comerciales"/);
  });

  test('C3: un enlace viejo …/modality?campo= va al paso del campo', () => {
    assert.match(code('js/ui/views/quote-editor.js'), /const target = campo \? stepOfPath\(campo\) : null;/);
  });

  test('C5: el precio a mano se llama "Tu precio" en el resumen en vivo y en "El precio"', () => {
    const editor = code('js/ui/views/quote-editor.js');
    assert.match(editor, /case 'known_rate':\n\s+case 'offered':\n\s+return 'Tu precio';/);
    assert.match(code('js/ui/views/quote-steps/margin.js'), /if \(src === 'known_rate' \|\| src === 'offered'\) return 'Tu precio \(de lista\)';/);
    const result = code('js/ui/views/quote-result.js');
    assert.match(result, /`El precio que cargaste en «\$\{stepLabel\('margin'\)\}»\.`/);
    assert.match(result, /'este precio' : 'tu precio'/);
  });

  test('C6 y C-6: la cifra grande en rojo si se pierde, naranja bajo el objetivo; con descuento dice lo que cobrás', () => {
    const result = code('js/ui/views/quote-result.js');
    assert.match(result, /k\.profit < -1e-6 \? 'red' : k\.belowTarget \? 'orange' : null/);
    assert.match(result, /`De lista\. Con tu descuento cobrás \$\{rate\(k\.commercialNetRate, v\.unitLabel\)\}\.`/);
    // SRV-01 con 10 % de descuento: lista y neta difieren (el caso del revisor).
    resetIds();
    const q = service({ id: 'q-c6', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] });
    q.pricing = { ...(q.pricing || {}), commercialDiscountPct: 10 };
    const k = computeQuote(q).kpis;
    assert.ok(k.commercialNetRate < k.commercialListRate);
  });

  test('C11: la barra del celular usa el rótulo y la cifra enteros', () => {
    const editor = code('js/ui/views/quote-editor.js');
    assert.doesNotMatch(editor, /'Tarifa sugerida': 'Sugerida'/);
    assert.match(code('css/quote.css'), /\.qe-sum-main \.qe-sum-item \{ display: flex; flex-wrap: wrap; align-items: baseline;/);
  });
});

describe('para después, los baratos (P2, P3, P4, P5, P6, P10 de UX)', () => {
  test('P2 y P3: la hora fuera de horario dice dónde están las horas extra y se quita con confirmación', () => {
    const src = code('js/ui/views/quote-steps/modality.js');
    assert.match(src, /se cargan en "Horas extra del trabajo" \(al final de Personal\)\.', className: 'qe-ooh-card'/);
    assert.match(src, /kit\.action\('Quitar el precio fuera de horario', async \(\) => \{\n\s+const ok = await confirmDialog\(/);
    assert.doesNotMatch(src, /name: 'outOfHours',/);
  });

  test('P4: "Horas extra del trabajo" antes del total de Personal', () => {
    const src = code('js/ui/views/quote-steps/labor.js');
    assert.ok(src.indexOf("overtimeSlot.dataset.empty === 'true' ? null : overtimeSlot,") < src.indexOf('    totals,\n  );'));
  });

  test('P5: "Usar $ X como tu precio", en el campo del modo', () => {
    const src = code('js/ui/views/quote-editor.js');
    assert.match(src, /como tu precio`/);
    assert.match(src, /const field = state\.quote\.pricingMode === 'known_rate' \? 'knownRate' : 'offeredRateOverride';/);
  });

  test('P6 y P10: el pliegue nombra el ejemplo; el plazo de cobro lleva la pregunta', () => {
    assert.match(code('js/ui/views/quote-steps/margin.js'), /'Más detalle \(opcional\): descuento, redondeo y ejemplo de margen'/);
    assert.match(code('js/ui/views/quote-steps/finance.js'), /'¿A cuántos días te paga el cliente\? Desde que presentás la factura hasta que cobrás\.'/);
  });
});
