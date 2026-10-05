/**
 * Catálogo semilla de familias de equipos y variantes descriptivas.
 * Sin precios, costos, consumos ni especificaciones económicas: son sugerencias
 * de texto y la persona siempre puede escribir la suya.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_FAMILIES, EQUIPMENT_FAMILY_IDS, LEGACY_TYPE_TO_FAMILY, familyById, familyIdOf, familyVariants, suggestedMobility } from '../../js/domain/equipment-catalog.js';

const REQUIRED_LABELS = [
  'Vactor / camión combinado', 'Camión atmosférico / vacío', 'Hidrogrúa (camión con hidrogrúa)', 'Grúa', 'Camión tractor',
  'Semirremolque', 'Carretón', 'Batea', 'Tanque', 'Camioneta', 'Minibús', 'Retroexcavadora', 'Excavadora',
  'Cargadora frontal', 'Motoniveladora', 'Autoelevador', 'Generador', 'Compresor / motocompresor', 'Bomba',
  'Equipo de soldadura', 'Torre de iluminación', 'Otro / Personalizado',
];

// Familias de v0.2.0: unidades y modelos guardados las usan, no se pueden quitar.
const V020_IDS = ['vactor', 'crane_truck', 'truck', 'tractor', 'semitrailer', 'lowboy', 'backhoe', 'excavator', 'telehandler', 'crane', 'forklift', 'generator', 'compressor', 'pump', 'flushby', 'wireline', 'frac_tank', 'tank_truck', 'pickup', 'minibus', 'tools', 'other'];

describe('familias de equipos', () => {
  test('están las familias pedidas, sin ids repetidos', () => {
    const labels = EQUIPMENT_FAMILIES.map((f) => f.label);
    for (const label of REQUIRED_LABELS) assert.ok(labels.includes(label), `falta "${label}"`);
    assert.equal(new Set(EQUIPMENT_FAMILY_IDS).size, EQUIPMENT_FAMILY_IDS.length);
  });

  test('ninguna familia anterior desaparece (los datos guardados la siguen encontrando)', () => {
    for (const id of V020_IDS) assert.ok(familyById(id), id);
    for (const family of Object.values(LEGACY_TYPE_TO_FAMILY)) assert.ok(familyById(family), family);
    assert.equal(familyIdOf({ familyId: 'lowboy' }), 'lowboy');
    assert.equal(familyIdOf({ type: 'trailer' }), 'semitrailer');
    assert.equal(familyIdOf({ familyId: 'no-existe' }), 'other');
  });

  test('sólo características generales: sin precios, costos ni consumos', () => {
    const allowed = ['consumption', 'id', 'label', 'requiresDriver', 'requiresTransport', 'roadLegal', 'selfPropelled', 'short', 'variants'];
    for (const f of EQUIPMENT_FAMILIES) {
      assert.deepEqual(Object.keys(f).sort(), allowed, f.id);
      for (const key of ['selfPropelled', 'roadLegal', 'requiresTransport', 'requiresDriver']) assert.ok(f[key] === null || typeof f[key] === 'boolean', `${f.id}.${key}`);
      assert.ok(['per_hour', 'none'].includes(f.consumption));
      for (const v of f.variants) {
        if (typeof v === 'object') assert.deepEqual(Object.keys(v).sort().filter((k) => k !== 'name'), ['label'], `${f.id}: variante con datos extra`);
        const text = typeof v === 'string' ? v : `${v.label} ${v.name || ''}`;
        assert.ok(!/\$|ARS|USD|EUR|L\/h|L\/100|km\/h|precio|costo/i.test(text), `${f.id}: "${text}" parece un dato económico`);
      }
    }
  });
});

describe('variantes descriptivas', () => {
  test('Vactor, camión tractor y semirremolque con las variantes pedidas', () => {
    assert.deepEqual(familyVariants('vactor').map((v) => v.label), ['5 yd³ / 1.000 gal', '10 yd³ / 1.300 gal', '12 yd³ / 1.500 gal', '15 yd³ / 1.500 gal']);
    assert.deepEqual(familyVariants('tractor').map((v) => v.label), ['4x2', '6x2', '6x4']);
    assert.deepEqual(familyVariants('semitrailer').map((v) => v.label), ['3 ejes tándem', '3 ejes 1+2', '3 ejes 1+1+1', 'Sider', 'Carretón', 'Batea', 'Tanque']);
  });

  test('nombre sugerido: familia + variante (o el propio de la variante)', () => {
    assert.equal(familyVariants('vactor')[2].name, 'Vactor 12 yd³ / 1.500 gal');
    assert.equal(familyVariants('tractor')[2].name, 'Camión tractor 6x4');
    assert.equal(familyVariants('semitrailer')[3].name, 'Semirremolque sider');
    assert.equal(familyVariants('excavator').find((v) => v.label === 'Miniexcavadora').name, 'Miniexcavadora');
  });

  test('"Otro / Personalizado", familias sin variantes o desconocidas → ninguna sugerencia (se escribe libre)', () => {
    assert.deepEqual(familyVariants('other'), []);
    assert.deepEqual(familyVariants('motor_grader'), []);
    assert.deepEqual(familyVariants('no-existe'), []);
    assert.deepEqual(familyVariants(null), []);
  });

  test('las familias nuevas sugieren movilidad (siempre editable)', () => {
    assert.deepEqual(suggestedMobility('dump_trailer'), { selfPropelled: false, roadLegal: true, requiresTransport: true, requiresDriver: false });
    assert.deepEqual(suggestedMobility('vacuum_truck'), { selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true });
    assert.deepEqual(suggestedMobility('motor_grader'), { selfPropelled: true, roadLegal: null, requiresTransport: null, requiresDriver: true });
  });
});
