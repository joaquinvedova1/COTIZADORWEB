/**
 * UXR: catálogo de unidades de cobro para elegir (sin depender del tipo de servicio), búsqueda con
 * sinónimos y cómo se guarda cada opción con los campos de siempre.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  UNIT_CATALOG, SUGGESTED_UNIT_KEYS, searchUnits, exactUnitMatch, unitKeyOf, unitDisplayName, applyUnit, currentApply, sameApply, customUnitApply, normalizeText, chargeSummary,
} from '../../js/domain/unit-catalog.js';
import { billingUnitOf, billedResourcesOf, BILLING_UNIT_IDS } from '../../js/domain/billing-units.js';

describe('Catálogo de unidades', () => {
  test('cada opción se guarda con unidades que el motor ya conoce (sin ids nuevos: una versión anterior calcula igual)', () => {
    UNIT_CATALOG.forEach((e) => {
      assert.ok(BILLING_UNIT_IDS.includes(e.apply.unit), `${e.key}: ${e.apply.unit}`);
      if (e.apply.unit === 'custom') assert.ok(e.apply.unitName, e.key);
    });
    SUGGESTED_UNIT_KEYS.forEach((k) => assert.ok(UNIT_CATALOG.some((e) => e.key === k), k));
  });

  test('la búsqueda encuentra por sinónimos y sin acentos', () => {
    const keys = (q) => searchUnits(q).flatMap((g) => g.items.map((e) => e.key));
    assert.ok(keys('hh').includes('person_hour'));
    assert.ok(keys('camion').includes('own:camión reparado'));
    assert.ok(keys('obra').includes('job'));
    assert.ok(keys('m3').includes('m3'));
    assert.ok(keys('valvula')[0] === 'own:válvula');
    // La coincidencia exacta va primero aunque su grupo esté después (Enter elige la primera).
    assert.equal(keys('tonelada')[0], 'ton');
    assert.equal(keys('m3')[0], 'm3');
    assert.equal(keys('jornal')[0], 'person_day');
    // SIM-02: "hora técnica" es la hora de cada técnico (hora-hombre), no la de toda la cuadrilla.
    assert.equal(keys('hora técnica')[0], 'person_hour');
    assert.equal(keys('zzz').length, 0);
    assert.equal(exactUnitMatch('Hora hombre').key, 'person_hour');
    assert.equal(exactUnitMatch('pieza rara'), null);
    assert.equal(normalizeText('  Camión  Reparado '), 'camion reparado');
  });

  test('hora-hombre: unidad hora + personas facturadas en paralelo; el rótulo dice $/hora-hombre', () => {
    const q = applyUnit({ unit: 'day', activity: {} }, UNIT_CATALOG.find((e) => e.key === 'person_hour').apply);
    assert.equal(q.unit, 'hour');
    assert.equal(q.activity.billedResourceKind, 'person');
    assert.equal(unitKeyOf(q), 'person_hour');
    const info = billingUnitOf(q);
    assert.equal(info.kind, 'hour');
    assert.equal(info.label, '$/hora-hombre');
    assert.equal(info.plural, 'horas-hombre');
    // Volver a "hora" quita la variante; la cantidad de personas queda guardada sin efecto y vuelve con hora-hombre.
    q.activity.billedResources = 4;
    applyUnit(q, { unit: 'hour' });
    assert.equal(q.activity.billedResourceKind, undefined);
    assert.equal(billedResourcesOf(q), 1);
    assert.equal(billingUnitOf(q).label, '$/hora');
    applyUnit(q, UNIT_CATALOG.find((e) => e.key === 'person_hour').apply);
    assert.equal(billedResourcesOf(q), 4);
  });

  test('precio total del trabajo: unidad job con horizonte; un "job" viejo (por mes) se distingue', () => {
    const q = applyUnit({ unit: 'day', activity: {} }, { unit: 'job', billingHorizon: 'job' });
    assert.equal(unitKeyOf(q), 'job');
    assert.equal(unitDisplayName(q), 'precio total del trabajo');
    assert.equal(unitKeyOf({ unit: 'job' }), 'job_monthly');
    applyUnit(q, { unit: 'hour' });
    assert.equal(q.billingHorizon, undefined);
  });

  test('unidades propias: las del catálogo se reconocen; una escrita a mano se usa tal cual', () => {
    assert.equal(unitKeyOf({ unit: 'custom', unitName: 'válvula' }), 'own:válvula');
    assert.equal(unitKeyOf({ unit: 'custom', unitName: 'litro' }), 'liter');
    assert.equal(unitKeyOf({ unit: 'custom', unitName: 'junta' }), null);
    assert.equal(unitDisplayName({ unit: 'custom', unitName: 'junta' }), 'junta');
    assert.deepEqual(customUnitApply('  $/junta  '), { unit: 'custom', unitName: 'junta' });
    assert.equal(customUnitApply('   '), null);
  });

  test('sameApply compara la unidad completa (variante, nombre propio y horizonte)', () => {
    const q = { unit: 'hour', activity: { billedResourceKind: 'person' } };
    assert.ok(sameApply(currentApply(q), { unit: 'hour', billedResourceKind: 'person' }));
    assert.ok(!sameApply(currentApply(q), { unit: 'hour' }));
    assert.ok(sameApply(currentApply({ unit: 'custom', unitName: 'Válvula' }), { unit: 'custom', unitName: 'valvula' }));
    assert.ok(!sameApply(currentApply({ unit: 'job' }), { unit: 'job', billingHorizon: 'job' }));
  });

  test('chargeSummary: listas y tarjetas dicen cómo se cobra (no el tipo de servicio)', () => {
    assert.equal(chargeSummary({ unit: 'hour', activity: { billedResourceKind: 'person' } }), 'Por hora-hombre');
    assert.equal(chargeSummary({ unit: 'job', billingHorizon: 'job' }), 'Precio total del trabajo');
    assert.equal(chargeSummary({ unit: 'job' }), 'Por trabajo (trabajos por mes)');
    assert.equal(chargeSummary({ unit: 'month', serviceType: 'on_call' }), 'Abono mensual · a demanda');
    assert.equal(chargeSummary({ unit: 'custom', unitName: 'junta' }), 'Por junta');
    assert.equal(billingUnitOf({ unit: 'custom', unitName: 'camión reparado' }).plural, 'camiones reparados');
    assert.equal(chargeSummary({ serviceType: 'equipment_with_operator' }), 'Por día');
    assert.ok(searchUnits('maniobra').flatMap((g) => g.items.map((e) => e.key)).includes('own:operación'));
  });
});

describe('Combustible en uso (marca ILUSTRATIVO)', async () => {
  const { fuelInUse, illustrativeInfo } = await import('../../js/domain/quote-factory.js');
  test('sin equipos que consuman ni traslados, el precio de ejemplo del combustible no se marca', () => {
    const base = { fuel: { illustrative: true }, logistics: { notApplicable: true, vehicles: [{ id: 'v' }] } };
    assert.equal(fuelInUse({ ...base, equipment: [{ acquisition: 'owned', fuelNotApplicable: true }] }), false);
    assert.equal(illustrativeInfo({ ...base, equipment: [{ acquisition: 'owned', fuelNotApplicable: true }] }).fuel, false);
    assert.equal(fuelInUse({ ...base, equipment: [{ acquisition: 'rented', external: { fuelIncluded: true } }] }), false);
    // Un equipo propio sin la marca (aunque falte su consumo) sí lo usa; un externo con el combustible aparte, también.
    assert.equal(illustrativeInfo({ ...base, equipment: [{ acquisition: 'owned' }] }).fuel, true);
    assert.equal(fuelInUse({ ...base, equipment: [{ acquisition: 'outsourced', external: { fuelIncluded: false } }] }), true);
    assert.equal(fuelInUse({ ...base, logistics: { notApplicable: false, vehicles: [{ id: 'v' }] } }), true);
  });
});
