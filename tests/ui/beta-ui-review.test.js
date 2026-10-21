/**
 * Revisión de frontend de la beta (BETA-RC2): lo que la interfaz afirma con color y unidades.
 *
 *  UI-02  "Costos cargados" en verde con un pendiente crítico (el 90 % se leía como "listo").
 *  UI-19  "Mínimo 8" debajo de la tarifa de un servicio externo no decía 8 qué.
 *
 * Funciones puras: el orden de las alertas (UI-01), los objetivos táctiles (UI-12) y los filtros de
 * Recursos (UI-11) se prueban en el navegador (tests/lab/e2e/ui-lab.mjs, bloque BETA-RC2 UI).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { completenessTone } from '../../js/engines/completeness-engine.js';
import { computeQuote, summarizeQuote } from '../../js/engines/quote-engine.js';
import * as quoteRisk from '../../js/domain/quote-risk.js';
import { readFileSync } from 'node:fs';
// Import de espacio de nombres: contra el candidato anterior (sin la función) el test falla por su cuenta.
import * as library from '../../js/ui/views/library.js';

describe('UI-02 · tono de "Costos cargados"', () => {
  test('sin pendientes críticos, los umbrales de siempre', () => {
    assert.equal(completenessTone(100), 'green');
    assert.equal(completenessTone(100, 0), 'green');
    assert.equal(completenessTone(70), 'orange');
    assert.equal(completenessTone(20), 'red');
    assert.equal(completenessTone(NaN), 'red');
  });

  test('con un pendiente crítico nunca es verde, aunque el porcentaje sea alto', () => {
    assert.equal(completenessTone(100, 1), 'orange');
    assert.equal(completenessTone(95, 3), 'orange');
  });

  test('un crítico no mejora un tono peor', () => {
    assert.equal(completenessTone(70, 1), 'orange');
    assert.equal(completenessTone(20, 1), 'red');
  });

  test('listas e Inicio cuentan también los críticos que vuelven NO CONFIABLE el resultado (revisión de código)', () => {
    assert.equal(typeof quoteRisk.summaryCriticalCount, 'function', 'falta summaryCriticalCount');
    // AUD-T1 E1: el abono con más días que los disponibles (ECO-04, H-04) es crítico y NO CONFIABLE.
    const q = JSON.parse(readFileSync(new URL('../fixtures/eco-01/e1-cotizacion.json', import.meta.url), 'utf8'));
    q.activity.activeDaysPerMonth = (q.activity.availableDaysPerMonth || 30) + 5;
    const r = computeQuote(structuredClone(q));
    const s = summarizeQuote(q);
    const unreliableCritical = r.completeness.pending.filter((p) => p.severity === 'critical' && p.unreliable === true).length;
    assert.ok(unreliableCritical > 0, 'el caso tiene un crítico NO CONFIABLE');
    assert.ok(quoteRisk.summaryCriticalCount(s) > 0);
    assert.notEqual(completenessTone(100, quoteRisk.summaryCriticalCount(s)), 'green');
    assert.equal(quoteRisk.summaryCriticalCount(null), 0);
  });
});

describe('UI-19 · mínimo facturable de un servicio externo con su unidad', () => {
  const text = (external) => {
    assert.equal(typeof library.externalMinimumText, 'function', 'falta externalMinimumText');
    return library.externalMinimumText(external);
  };

  test('por hora: "Mínimo 8 h"', () => {
    assert.equal(text({ unit: 'hour', minimumUnits: 8 }), 'Mínimo 8 h');
  });

  test('por día, en plural y en singular', () => {
    assert.equal(text({ unit: 'day', minimumUnits: 3 }), 'Mínimo 3 días');
    assert.equal(text({ unit: 'day', minimumUnits: 1 }), 'Mínimo 1 día');
  });

  test('por km, por tramo y por viaje completo', () => {
    assert.equal(text({ unit: 'km', minimumUnits: 200 }), 'Mínimo 200 km');
    assert.equal(text({ unit: 'trip', minimumUnits: 2 }), 'Mínimo 2 tramos');
    assert.equal(text({ unit: 'trip', tripBasis: 'round_trip', minimumUnits: 2 }), 'Mínimo 2 viajes');
  });

  test('por intervención, con el nombre de la activación', () => {
    assert.equal(text({ unit: 'activation', minimumUnits: 2 }), 'Mínimo 2 intervenciones');
    assert.equal(text({ unit: 'activation', minimumUnits: 1 }), 'Mínimo 1 intervención');
  });

  test('global: sin unidad', () => {
    assert.equal(text({ unit: 'global', minimumUnits: 1 }), 'Mínimo 1');
  });
});
