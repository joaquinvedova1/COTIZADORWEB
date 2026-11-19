/**
 * 0.15.0 (pedido del dueño, 2026-11-19) — carga más simple: convenio al crear un puesto, personal
 * tercerizado en la cotización y tarjeta de insumo por pasos.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { agreementChoices, agreementFromChoice } from '../../js/ui/views/library.js';
import { AGREEMENT_TYPES_SORTED } from '../../js/domain/catalogs.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('Nuevo puesto · se elige el convenio aunque todavía no esté cargado', () => {
  const catalog = AGREEMENT_TYPES_SORTED.filter((t) => t.code !== 'personalizado');

  test('sin convenios propios se ofrecen todos los del catálogo, por crear', () => {
    const list = agreementChoices([]);
    assert.equal(list.length, catalog.length);
    assert.ok(list.length > 0);
    assert.ok(list.every((a) => a.pending && a.illustrative && a.id.startsWith('catalog:')));
  });

  test('los propios van primero y su tipo no se repite', () => {
    const own = { id: 'a1', code: catalog[0].code, name: 'Mi convenio', params: {} };
    const list = agreementChoices([own]);
    assert.equal(list[0], own);
    assert.equal(list.filter((a) => a.code === own.code).length, 1);
    assert.equal(list.length, catalog.length);
  });

  test('al guardar, el elegido del catálogo se crea como convenio ILUSTRATIVO sin id', () => {
    const created = agreementFromChoice(agreementChoices([])[0]);
    assert.equal(created.id, undefined);
    assert.equal(created.illustrative, true);
    assert.equal(created.code, catalog[0].code);
    assert.ok(created.params && typeof created.params === 'object');
  });
});

describe('Personal de la cotización · propio desde Recursos, tercerizado con valor fijo', () => {
  const labor = src('js/ui/views/quote-steps/labor.js');

  test('ya no se carga un puesto suelto en la cotización', () => {
    assert.doesNotMatch(labor, /Cargar uno que no está en Recursos/);
    assert.match(labor, /openNewLaborProfileDialog/);
  });

  test('ofrece agregar personal tercerizado por hora, día o mes', () => {
    assert.match(labor, /Agregar personal tercerizado/);
    assert.match(labor, /createContractedStaff/);
  });
});

describe('Insumos · tarjeta por pasos', () => {
  const materials = src('js/ui/views/quote-steps/materials.js');

  test('pregunta qué es, cuánto se usa y cuánto cuesta; el costo se llama "Te cuesta"', () => {
    for (const text of ['¿Qué es?', '¿Cuánto usás?', '¿Cada cuánto se consume?', '¿Cuánto te cuesta?', 'Te cuesta']) assert.ok(materials.includes(text), text);
    assert.doesNotMatch(materials, /Costo para vos/);
  });
});
