/**
 * 0.24.0 (PLAN-2026-028, PR 5): campos que no mueven ningún número.
 *
 * Se ocultan o se pliegan, pero nada se borra: un campo oculto con un valor guardado se sigue
 * viendo, y el número de la cotización no cambia (eso lo fija tanda4-sin-cambio.test.js).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hasText, positiveValue, unitDataParts, riskItemVisible } from '../../js/ui/optional-fields.js';
import { MATERIAL_PROVIDERS, materialProviderOptions } from '../../js/domain/catalogs.js';
import { SERVICE_COMPONENTS } from '../../js/domain/contract.js';
import { createEmptyQuote, defaultSettings } from '../../js/domain/quote-factory.js';
import { stepOfPath } from '../../js/ui/field-links.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { retiredFloorNames } from '../lab/lib/ux-audit.js';

const code = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const LIBRARY = code('js/ui/views/library.js');

describe('un campo oculto con valor guardado se sigue viendo', () => {
  test('textos y números: vacío se oculta, cargado se ve', () => {
    assert.equal(hasText(''), false);
    assert.equal(hasText('   '), false);
    assert.equal(hasText(undefined), false);
    assert.equal(hasText('Oficial'), true);
    assert.equal(positiveValue(null), false);
    assert.equal(positiveValue(0), false);
    assert.equal(positiveValue(''), false);
    assert.equal(positiveValue(80), true);
    assert.equal(positiveValue('80'), true);
  });

  test('"Categoría" del puesto: en la cotización sólo si tiene texto; en Recursos, plegada y abierta si tiene', () => {
    const labor = code('js/ui/views/quote-steps/labor.js');
    assert.match(labor, /hasText\(line\.category\)\n\s+\? kit\.text\(`\$\{p\}\.category`/);
    assert.match(LIBRARY, /title: 'Más detalle \(opcional\)',\n\s+collapsible: true,\n\s+key: 'labor-more',\n\s+openWhen: \(d\) => hasText\(d\.category\)/);
  });

  test('"Valor actual", "Velocidad estimada" y "Combustible" del modelo: sólo si ya tienen valor', () => {
    assert.match(LIBRARY, /label: 'Valor actual \(informativo\)'.*when: \(d\) => positiveValue\(d\.currentValue\)/);
    assert.match(LIBRARY, /label: 'Velocidad estimada \(opcional\)'.*when: \(d\) => positiveValue\(d\.mobility && d\.mobility\.speedKmh\)/);
    assert.match(LIBRARY, /label: 'Combustible \(opcional\)'.*when: \(d\) => hasText\(d\.fuelType\)/);
  });

  test('"Datos de la unidad (opcional)": plegada, se abre sola si tiene algo cargado y lo resume', () => {
    assert.match(LIBRARY, /title: 'Datos de la unidad \(opcional\)',\n\s+key: 'unit-data',\n\s+collapsible: true,\n\s+openWhen: \(d\) => unitDataParts\(d\)\.length > 0/);
    assert.deepEqual(unitDataParts({}), []);
    assert.deepEqual(unitDataParts({ capacity: ' 12 yd³ ', internalCode: 'EQ-014', modelId: 'm1', year: 2019, plate: 'AB123CD' }), ['12 yd³', 'interno EQ-014', 'con modelo', '2019', 'dominio AB123CD']);
    assert.deepEqual(unitDataParts({ internalCode: '  ', year: 0 }), []);
  });

  test('"¿Quién lo provee?": dos opciones; la tercera sólo donde ya está elegida', () => {
    assert.deepEqual(materialProviderOptions().map((o) => o.label), ['Lo pago yo', 'Lo pone el cliente (no es costo tuyo)']);
    assert.deepEqual(materialProviderOptions('client').map((o) => o.value), ['contractor', 'client']);
    assert.deepEqual(materialProviderOptions('third_party').map((o) => o.value), ['contractor', 'third_party', 'client']);
    // La de antes cuesta lo mismo que "Lo pago yo".
    const byId = Object.fromEntries(MATERIAL_PROVIDERS.map((m) => [m.id, m]));
    assert.equal(byId.third_party.costForUs, byId.contractor.costForUs);
    assert.match(code('js/ui/views/quote-steps/materials.js'), /options: materialProviderOptions\(quote\.materials\[i\] && quote\.materials\[i\]\.providedBy\)/);
    assert.match(LIBRARY, /options: \(d\) => materialProviderOptions\(d && d\.providedBy\)/);
  });

  test('"Suba de precios" e "Inflación": con el precio que contempla la inflación se ocultan sólo en 0', () => {
    const q = createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org'), id: 'q1', now: '2026-11-20T00:00:00.000Z' });
    q.contractMonths = 12;
    const item = (id, extra = {}) => ({ id, enabled: false, pct: 0, ...extra });
    // Sin ajuste por inflación: se ven siempre.
    assert.equal(riskItemVisible(q, item('inflation')), true);
    q.priceAdjustment = { mode: 'fixed', expectedMonthlyInflationPct: 3 };
    assert.equal(riskItemVisible(q, item('inflation')), false);
    assert.equal(riskItemVisible(q, item('prices')), false);
    // Con un valor cargado o marcado, se ve.
    assert.equal(riskItemVisible(q, item('inflation', { pct: 2 })), true);
    assert.equal(riskItemVisible(q, item('prices', { enabled: true })), true);
    // Los demás riesgos no se tocan.
    assert.equal(riskItemVisible(q, item('weather')), true);
  });

  test('"Tiempo máximo de respuesta" salió del ritmo: queda en "Detalle de la guardia" y su enlace va a "El precio"', () => {
    const modality = code('js/ui/views/quote-steps/modality.js');
    assert.equal(modality.match(/kit\.num\('activity\.responseTimeHours'/g).length, 1);
    assert.ok(modality.indexOf("kit.num('activity.responseTimeHours'") > modality.indexOf("title: 'Detalle de la guardia'"));
    assert.equal(stepOfPath('activity.responseTimeHours'), 'margin');
  });

  test('ocultar no cambia el número: el tiempo de respuesta no mueve la cotización', () => {
    const q = createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org'), id: 'q1', now: '2026-11-20T00:00:00.000Z' });
    const base = computeQuote(structuredClone(q)).kpis;
    const other = structuredClone(q);
    other.activity.responseTimeHours = 12;
    assert.deepEqual(computeQuote(other).kpis, base);
  });
});

describe('textos (0.24.0)', () => {
  test('D4: "Precio piso" pasó a "Precio mínimo" (UX-TERM-FLOOR)', () => {
    assert.deepEqual(retiredFloorNames(), []);
    assert.match(code('js/ui/views/product-editor.js'), /'Precio mínimo \(no ganás ni perdés\)'/);
    assert.match(code('js/engines/product-engine.js'), /title: 'Precio mínimo'/);
  });

  test('P-21: "Horas asignadas a este trabajo"', () => {
    for (const rel of ['js/ui/views/quote-steps/assignment.js', 'js/ui/views/quote-steps/equipment.js']) {
      const src = code(rel);
      assert.doesNotMatch(src, /Horas asignado/, rel);
      assert.match(src, /Horas asignadas a este trabajo/, rel);
    }
  });

  test('P-10: "Viáticos y alojamiento" dice lo mismo que el bloque de viajes (las comidas van en Personal)', () => {
    const travel = SERVICE_COMPONENTS.find((c) => c.id === 'travel');
    assert.doesNotMatch(travel.hint, /comidas, peajes/);
    assert.match(travel.hint, /las comidas van en Personal/);
  });
});
