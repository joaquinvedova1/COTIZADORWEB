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
