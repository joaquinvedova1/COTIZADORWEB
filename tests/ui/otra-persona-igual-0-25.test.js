/**
 * 0.25.0 (D3): sin "Cantidad" en el puesto. "Agregar otra persona igual" copia la línea y el
 * selector de operador numera los puestos repetidos ("Chofer 1", "Chofer 2").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laborOptionLabels } from '../../js/ui/views/quote-steps/shared.js';

const source = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('D3: otra persona igual', () => {
  test('los repetidos se numeran en el selector; los únicos quedan como están', () => {
    const labels = laborOptionLabels([
      { id: 'a', role: 'Chofer' }, { id: 'b', role: 'Operador' }, { id: 'c', role: 'Chofer' }, { id: 'd', role: '' }, { id: 'e' }, { role: 'sin id' },
    ]);
    assert.deepEqual(labels, [
      { value: 'a', label: 'Chofer 1' }, { value: 'b', label: 'Operador' }, { value: 'c', label: 'Chofer 2' },
      { value: 'd', label: 'Puesto sin nombre 1' }, { value: 'e', label: 'Puesto sin nombre 2' },
    ]);
    assert.deepEqual(laborOptionLabels(null), []);
  });
  test('el operador de Equipos usa esos rótulos', () => {
    assert.match(source('js/ui/views/quote-steps/equipment.js'), /const operatorOptions = \(\) => laborOptionLabels\(quote\.labor\);/);
  });
  test('"Agregar otra persona igual" copia la línea con otro id, debajo; no hay "Cantidad" nueva', () => {
    const src = source('js/ui/views/quote-steps/labor.js');
    assert.match(src, /kit\.action\('Agregar otra persona igual'/);
    assert.match(src, /copy\.id = createId\(\);\n\s+q\.labor\.splice\(index \+ 1, 0, copy\);/);
    assert.match(src, /!legacyStaff\(line\) && singleUnit\(line\.positions\) \? null :/);
  });
});

describe('D3 con números (revisión 0.25.0, P-2)', () => {
  test('la copia suma exactamente lo que suma la línea (demo, COT-0009/0010/0011 y escenarios del Test Lab)', async () => {
    const { computeQuote } = await import('../../js/engines/quote-engine.js');
    const { createDemoState } = await import('../../js/domain/demo-data.js');
    const { deepClone } = await import('../../js/core/object.js');
    const { cot0009Quote } = await import('../fixtures/cot-0009.js');
    const { cot0010Quote, cot0011Quote } = await import('../fixtures/cot-0010.js');
    const { SERVICE_SCENARIOS } = await import('../lab/scenarios/services.js');
    const { resetIds } = await import('../lab/lib/build.js');
    const demo = createDemoState(1);
    const cases = [
      ...demo.quotes.map((q) => [q.code || q.id, q, demo.settings]),
      ['COT-0009', cot0009Quote()], ['COT-0010', cot0010Quote()], ['COT-0011', cot0011Quote()],
      ...SERVICE_SCENARIOS.map((s) => { resetIds(); return [`lab:${s.id}`, s.build()]; }),
    ];
    // Mismo criterio que el botón: sin nómina ni personas por puesto distintas de 1.
    const legacy = (l) => (l.payrollHeadcount !== null && l.payrollHeadcount !== undefined && l.payrollHeadcount !== '')
      || (l.peoplePerPosition !== null && l.peoplePerPosition !== undefined && l.peoplePerPosition !== '' && Math.abs(Number(l.peoplePerPosition) - 1) > 1e-9);
    const cost = (q, s) => computeQuote(structuredClone(q), s ? { settings: s } : undefined).kpis.totalCost;
    let checked = 0;
    for (const [id, q, s] of cases) {
      (q.labor || []).forEach((l, i) => {
        if (legacy(l)) return;
        const base = cost(q, s);
        const without = structuredClone(q); without.labor.splice(i, 1);
        const line = base - cost(without, s);
        const dup = structuredClone(q);
        const copy = deepClone(dup.labor[i]); copy.id = 'copia-d3';
        dup.labor.splice(i + 1, 0, copy);
        const added = cost(dup, s) - base;
        assert.ok(Math.abs(added - line) <= Math.max(1e-6, Math.abs(line) * 1e-9), `${id} · ${l.role}: la copia suma ${added}, la línea ${line}`);
        checked += 1;
      });
    }
    assert.ok(checked >= 50, `sólo ${checked} líneas`);
  });
  test('una línea de antes con varias personas dice cuántas copia', () => {
    const src = source('js/ui/views/quote-steps/labor.js');
    assert.match(src, /`Agregar otro puesto igual \(\$\{formatNumber\(laborHeadcountOf\(line\), \{ decimals: 2 \}\)\} personas\)`/);
  });
  test('UX C8: la tarjeta lleva el mismo rótulo que el selector de operador', () => {
    assert.match(source('js/ui/views/quote-steps/labor.js'), /laborOptionLabels\(quote\.labor\)\.find\(\(o\) => o\.value === l\.id\)/);
  });
});
