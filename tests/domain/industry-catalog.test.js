/**
 * Sector de la empresa (secciones ClaNAE) y actividad / especialidad.
 * Descriptivo: no cambia ningún cálculo. RATEOS no queda limitado a Oil & Gas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDUSTRY_SECTORS, INDUSTRY_SECTOR_IDS, LEGACY_INDUSTRIES, ACTIVITY_SUGGESTIONS, MAX_ACTIVITY_LENGTH,
  industryOf, searchSectors, activitySuggestions, searchText, sectorById,
} from '../../js/domain/industry-catalog.js';

const REQUIRED = [
  'Agricultura, ganadería, forestal y pesca', 'Minería', 'Petróleo y gas', 'Industria manufacturera',
  'Electricidad, gas y energía', 'Agua, saneamiento y residuos', 'Construcción', 'Comercio',
  'Transporte y logística', 'Alojamiento y gastronomía', 'Información y comunicaciones', 'Finanzas y seguros',
  'Actividades inmobiliarias', 'Servicios profesionales, científicos y técnicos', 'Servicios administrativos y de apoyo',
  'Administración pública', 'Educación', 'Salud', 'Arte, entretenimiento y recreación', 'Otros servicios',
];

describe('catálogo de sectores', () => {
  test('cubre los sectores amplios pedidos y "Otro / Personalizado", sin repetir ids', () => {
    const labels = INDUSTRY_SECTORS.map((s) => s.label);
    for (const label of REQUIRED) assert.ok(labels.includes(label), `falta "${label}"`);
    assert.ok(labels.includes('Otro / Personalizado'));
    assert.equal(new Set(INDUSTRY_SECTOR_IDS).size, INDUSTRY_SECTOR_IDS.length);
  });

  test('sólo secciones de referencia (una letra), nunca códigos fiscales de actividad', () => {
    for (const s of INDUSTRY_SECTORS) {
      assert.ok(s.clanae === null || /^[A-U]$/.test(s.clanae), `${s.id}: ${s.clanae}`);
      assert.deepEqual(Object.keys(s).sort(), ['clanae', 'id', 'keywords', 'label']);
      assert.ok(!/\d{3,}/.test([s.label, ...s.keywords].join(' ')), `${s.id}: sin códigos numéricos`);
    }
  });

  test('no está limitado a Oil & Gas: Petróleo y gas es un sector más', () => {
    assert.ok(INDUSTRY_SECTORS.length >= 21);
    assert.equal(INDUSTRY_SECTORS.filter((s) => /petr[oó]leo|oil/i.test(s.label)).length, 1);
  });
});

describe('industryOf: sector y actividad de la organización', () => {
  test('sector actual + actividad', () => {
    assert.deepEqual(industryOf({ industry: 'construction', activity: '  Construcción civil ' }), { sector: 'construction', activity: 'Construcción civil' });
  });

  test('ids de versiones anteriores se siguen leyendo (sin migrar datos)', () => {
    assert.deepEqual(industryOf({ industry: 'oil_gas_services' }), { sector: 'oil_gas', activity: 'Servicios petroleros' });
    assert.deepEqual(industryOf({ industry: 'industrial_maintenance' }), { sector: 'manufacturing', activity: 'Mantenimiento industrial' });
    // Los que no cambiaron de id.
    for (const id of ['transport', 'construction', 'other']) assert.equal(industryOf({ industry: id }).sector, id);
    // La actividad que cargó la persona manda sobre la del tipo anterior.
    assert.equal(industryOf({ industry: 'oil_gas_services', activity: 'Servicios al pozo' }).activity, 'Servicios al pozo');
    for (const legacy of Object.values(LEGACY_INDUSTRIES)) assert.ok(INDUSTRY_SECTOR_IDS.includes(legacy.sector));
  });

  test('vacío, desconocido o inválido → sin sector; nunca lanza', () => {
    assert.deepEqual(industryOf({}), { sector: null, activity: '' });
    assert.deepEqual(industryOf({ industry: 'algo-raro' }), { sector: null, activity: '' });
    assert.deepEqual(industryOf(null), { sector: null, activity: '' });
    assert.deepEqual(industryOf({ industry: 42, activity: 7 }), { sector: null, activity: '' });
    assert.equal(industryOf({ activity: 'x'.repeat(500) }).activity.length, MAX_ACTIVITY_LENGTH);
  });
});

describe('buscador de sectores', () => {
  test('sin tildes ni mayúsculas, por nombre o palabra clave', () => {
    assert.equal(searchText('Petróleo'), 'petroleo');
    assert.equal(searchSectors('petroleo')[0].id, 'oil_gas');
    assert.equal(searchSectors('Vaca Muerta')[0].id, 'oil_gas');
    assert.equal(searchSectors('CAMIONES')[0].id, 'transport');
    assert.equal(searchSectors('construcción')[0].id, 'construction');
    assert.equal(searchSectors('ingenieria')[0].id, 'professional');
  });

  test('"Otro / Personalizado" siempre está; vacío = todos', () => {
    assert.ok(searchSectors('zzz-no-existe').some((s) => s.id === 'other'));
    assert.ok(searchSectors('agua').some((s) => s.id === 'other'));
    assert.equal(searchSectors('').length, INDUSTRY_SECTORS.length);
    assert.equal(searchSectors('   ').length, INDUSTRY_SECTORS.length);
  });

  test('sectorById', () => {
    assert.equal(sectorById('oil_gas').label, 'Petróleo y gas');
    assert.equal(sectorById('nope'), null);
  });
});

describe('actividad / especialidad: sugerencias', () => {
  test('incluye los ejemplos pedidos', () => {
    const all = ACTIVITY_SUGGESTIONS.map((a) => a.label);
    for (const label of ['Servicios al pozo', 'Transporte de cargas', 'Mantenimiento industrial', 'Construcción civil', 'Servicios ambientales', 'Montaje', 'Ingeniería', 'Limpieza industrial']) {
      assert.ok(all.includes(label), `falta "${label}"`);
    }
    for (const a of ACTIVITY_SUGGESTIONS) for (const s of a.sectors) assert.ok(INDUSTRY_SECTOR_IDS.includes(s), `${a.label}: ${s}`);
  });

  test('primero las del sector elegido, sin perder ninguna ni repetir', () => {
    const oil = activitySuggestions('oil_gas');
    assert.equal(oil[0], 'Servicios al pozo');
    assert.equal(oil.length, ACTIVITY_SUGGESTIONS.length);
    assert.equal(new Set(oil).size, oil.length);
    const build = activitySuggestions('construction');
    assert.ok(build.indexOf('Construcción civil') < build.indexOf('Servicios al pozo'));
    assert.equal(activitySuggestions(null).length, ACTIVITY_SUGGESTIONS.length);
  });
});
