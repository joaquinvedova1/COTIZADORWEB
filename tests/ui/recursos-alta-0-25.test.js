/**
 * 0.25.0 (PLAN-2026-029, PR 9): Recursos, alta más corta (W-14, W-18, lo mínimo de W-19). Sólo pantalla.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { familyOptionsFor } from '../../js/ui/views/library.js';
import { WELL_FAMILY_IDS, EQUIPMENT_FAMILIES } from '../../js/domain/equipment-catalog.js';
import { unitDataParts } from '../../js/ui/optional-fields.js';

const lib = readFileSync(new URL('../../js/ui/views/library.js', import.meta.url), 'utf8');

describe('Familias: primero las generales', () => {
  test('fuera de petróleo y gas, las de pozo van al final (antes de "Otro") y lo dicen', () => {
    const opts = familyOptionsFor(null);
    assert.equal(opts.length, EQUIPMENT_FAMILIES.length);
    const tail = opts.slice(-1 - WELL_FAMILY_IDS.length, -1);
    assert.deepEqual(tail.map((o) => o.value), [...WELL_FAMILY_IDS]);
    assert.ok(tail.every((o) => / \(pozo\)$/.test(o.label)));
    assert.equal(opts.at(-1).value, 'other');
    assert.ok(!WELL_FAMILY_IDS.includes(opts[0].value));
  });
  test('en petróleo y gas, el orden de siempre', () => {
    assert.deepEqual(familyOptionsFor('oil_gas').map((o) => o.value), EQUIPMENT_FAMILIES.map((f) => f.id));
  });
});

describe('Equipo: textos', () => {
  test('"¿Cuánto cuesta uno nuevo hoy?", "Patente" y un ejemplo general', () => {
    assert.match(lib, /label: '¿Cuánto cuesta uno nuevo hoy\?'/);
    assert.match(lib, /label: 'Patente \(opcional\)'/);
    assert.doesNotMatch(lib, /placeholder: 'Ej\.: Vactor 12 yd³/);
    assert.ok(unitDataParts({ plate: 'AB123CD' }).includes('patente AB123CD'));
  });
  test('el desgaste de mantenimiento y cubiertas va plegado', () => {
    assert.match(lib, /openWhen: \(d\) => [^\n]*maintenanceOf/);
    assert.match(lib, /openWhen: \(d\) => [^\n]*tiresOf/);
  });
});

describe('Puesto', () => {
  test('la hora al 50 % y al 100 % van plegadas', () => {
    assert.match(lib, /title: 'Hora al 50 % y al 100 % \(opcional\)',\n\s+collapsible: true,/);
    assert.match(lib, /title: 'Valor de la hora',/);
  });
  test('sin convenio, el título no dice "del convenio"; el convenio por crear dice "(nuevo)"', () => {
    assert.match(lib, /agreementOf\(d\) \? 'Cargas sociales del convenio' : 'Cargas sociales de este puesto'/);
    assert.doesNotMatch(lib, /nuevo, con valores de ejemplo/);
    assert.match(lib, /a\.pending \? ' \(nuevo\)' : ''/);
  });
});

describe('W-19: el número de la pestaña se lee una vez', () => {
  test('aria-label con el número; el visible queda decorativo y no hay copia para lectores', () => {
    assert.match(lib, /'aria-label': `\$\{t\.label\} \(\$\{list\(t\.type\)\.length\}\)`/);
    assert.doesNotMatch(lib, /h\('span', \{ class: 'sr-only' \}, ` \(\$\{list\(t\.type\)\.length\}\)`\)/);
  });
});
