/**
 * RES-02 (PLAN-2026-023) · Personal agrupado por convenio, perfiles ≠ personas,
 * sueldo bruto sin doble conteo, horas extra con base explícita y convenios
 * borrados sin referencias colgadas. Datos sintéticos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GROUP_NONE,
  GROUP_OUTSIDE,
  filterLaborGroups,
  grossOf,
  groupCountsText,
  groupLaborProfiles,
  overtimeUse,
  peopleOf,
  splitGross,
} from '../../js/domain/labor-groups.js';
import { computeLaborLine } from '../../js/engines/labor-engine.js';
import { SNAPSHOT_FIELDS, economicFingerprint, snapshotValuesFromLine } from '../../js/domain/resource-snapshot.js';
import { LocalStorageRepository } from '../../js/data/local-storage-repository.js';
import { MemoryStorage } from '../../js/data/memory-storage.js';
import { configureLogger } from '../../js/core/logger.js';

configureLogger({ consoleImpl: null });

const PARAMS = { normalHoursPerMonth: 176, overtimePremiumPct: 50, sacPct: 8.33, vacationPct: 4, employerContributionsPct: 24, artPct: 6 };
const profile = (id, o = {}) => ({ id, role: `Puesto ${id}`, basicMonthly: 1000000, additionalsMonthly: 0, insuranceMonthly: 0, ppeMonthly: 0, trainingMonthly: 0, transferMonthly: 0, mealPerActiveDay: 0, overtimeHoursPerActiveDay: 0, ...PARAMS, ...o });
const agreement = (id, name, code = 'personalizado') => ({ id, name, code, params: { ...PARAMS } });
const costOf = (p) => computeLaborLine({ ...p, positions: 1, peoplePerPosition: 1 }).perPerson.fixedMonthly;

const AGREEMENTS = [
  agreement('a-pp', 'Petroleros Privados'),
  agreement('a-uocra', 'UOCRA Yacimientos'),
  agreement('a-fuera', 'Administración', 'fuera_convenio'),
];

describe('RES-02 · agrupar el personal por convenio', () => {
  test('un grupo por convenio con su nombre; "Fuera de convenio" y "Sin convenio indicado" aparte', () => {
    const groups = groupLaborProfiles([
      profile('p1', { agreementId: 'a-pp' }),
      profile('p2', { agreementId: 'a-uocra' }),
      profile('p3', { agreementId: 'a-fuera' }),
      profile('p4', { agreementId: null }),
      profile('p5', { agreementId: '' }),
      profile('p6', { agreementId: 'borrado' }),
      profile('p7'),
    ], AGREEMENTS, { costOf });
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    assert.equal(byKey['a-pp'].title, 'Petroleros Privados');
    assert.equal(byKey['a-uocra'].title, 'UOCRA Yacimientos');
    assert.equal(byKey[GROUP_OUTSIDE].title, 'Fuera de convenio');
    assert.deepEqual(byKey[GROUP_OUTSIDE].items.map((i) => i.profile.id), ['p3']);
    // Sin convenio, vacío o que apunta a uno borrado (RES-02-G1): "Sin convenio indicado", sin romper.
    assert.deepEqual(byKey[GROUP_NONE].items.map((i) => i.profile.id).sort(), ['p4', 'p5', 'p6', 'p7']);
  });

  test('dos convenios con el mismo nombre y distinto id son dos grupos', () => {
    const groups = groupLaborProfiles([profile('p1', { agreementId: 'x1' }), profile('p2', { agreementId: 'x2' })], [agreement('x1', 'Camioneros'), agreement('x2', 'Camioneros')], { costOf });
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((g) => g.title), ['Camioneros', 'Camioneros']);
  });

  test('orden: los convenios con más perfiles primero; "Fuera de convenio" y "Sin convenio indicado" al final', () => {
    const groups = groupLaborProfiles([
      profile('p0'),
      profile('p1', { agreementId: 'a-fuera' }),
      profile('p2', { agreementId: 'a-pp' }),
      profile('p3', { agreementId: 'a-uocra' }),
      profile('p4', { agreementId: 'a-uocra' }),
    ], AGREEMENTS, { costOf });
    assert.deepEqual(groups.map((g) => g.key), ['a-uocra', 'a-pp', GROUP_OUTSIDE, GROUP_NONE]);
  });

  test('dentro del grupo, por puesto (sin importar mayúsculas ni tildes)', () => {
    const [g] = groupLaborProfiles([
      profile('p1', { agreementId: 'a-pp', role: 'Supervisor' }),
      profile('p2', { agreementId: 'a-pp', role: 'ayudante' }),
      profile('p3', { agreementId: 'a-pp', role: 'Operador' }),
    ], AGREEMENTS, { costOf });
    assert.deepEqual(g.items.map((i) => i.profile.role), ['ayudante', 'Operador', 'Supervisor']);
  });

  test('sin perfiles no hay grupos; datos basura no rompen', () => {
    assert.deepEqual(groupLaborProfiles([], AGREEMENTS, { costOf }), []);
    assert.deepEqual(groupLaborProfiles(null, null), []);
    const groups = groupLaborProfiles([null, 'x', profile('p1', { agreementId: 'a-pp' })], [null, { name: 'sin id' }, ...AGREEMENTS], { costOf });
    assert.equal(groups.length, 1);
  });
});

describe('RES-02 · un perfil no es una persona', () => {
  test('peopleCount sólo vale como entero ≥ 0; si no, "sin dato"', () => {
    assert.equal(peopleOf({ peopleCount: 3 }), 3);
    assert.equal(peopleOf({ peopleCount: 0 }), 0);
    [undefined, null, -1, 1.5, '3', Number.NaN, Infinity].forEach((v) => assert.equal(peopleOf({ peopleCount: v }), null, String(v)));
    assert.equal(peopleOf(null), null);
  });

  test('las personas salen de peopleCount: nunca "N personas" por tener N perfiles', () => {
    const [none] = groupLaborProfiles([profile('p1', { agreementId: 'a-pp' }), profile('p2', { agreementId: 'a-pp' })], AGREEMENTS, { costOf });
    assert.equal(none.profilesCount, 2);
    assert.equal(none.people, 0);
    assert.equal(groupCountsText(none), '2 perfiles · personas sin cargar');
    assert.doesNotMatch(groupCountsText(none), /2 personas/);

    const [all] = groupLaborProfiles([profile('p1', { agreementId: 'a-pp', peopleCount: 2 }), profile('p2', { agreementId: 'a-pp', peopleCount: 3 })], AGREEMENTS, { costOf });
    assert.equal(groupCountsText(all), '2 perfiles · 5 personas');

    const [some] = groupLaborProfiles([
      profile('p1', { agreementId: 'a-pp', peopleCount: 4 }),
      profile('p2', { agreementId: 'a-pp', peopleCount: 2 }),
      profile('p3', { agreementId: 'a-pp' }),
    ], AGREEMENTS, { costOf });
    assert.equal(groupCountsText(some), '6 personas en 2 de 3 perfiles');

    const [one] = groupLaborProfiles([profile('p1', { agreementId: 'a-pp', peopleCount: 1 })], AGREEMENTS, { costOf });
    assert.equal(groupCountsText(one), '1 perfil · 1 persona');
  });

  test('monto del grupo = Σ costo por persona × personas, sólo de los perfiles con cantidad; si falta alguna, es parcial', () => {
    const p1 = profile('p1', { agreementId: 'a-pp', peopleCount: 2, basicMonthly: 2300000, additionalsMonthly: 600000 });
    const p2 = profile('p2', { agreementId: 'a-pp', peopleCount: 3, basicMonthly: 1600000, additionalsMonthly: 300000 });
    const p3 = profile('p3', { agreementId: 'a-pp', basicMonthly: 5000000 });
    const [complete] = groupLaborProfiles([p1, p2], AGREEMENTS, { costOf });
    assert.equal(complete.partial, false);
    assert.ok(Math.abs(complete.subtotal - (costOf(p1) * 2 + costOf(p2) * 3)) < 0.01);
    const [partial] = groupLaborProfiles([p1, p2, p3], AGREEMENTS, { costOf });
    assert.equal(partial.partial, true);
    assert.equal(partial.subtotal, complete.subtotal, 'el perfil sin cantidad no suma');
    const [noPeople] = groupLaborProfiles([p3], AGREEMENTS, { costOf });
    assert.equal(noPeople.subtotal, null, 'sin ninguna cantidad no hay monto');
    assert.equal(noPeople.partial, false);
  });

  test('peopleCount no entra en la huella ni se copia a las cotizaciones', () => {
    assert.ok(!SNAPSHOT_FIELDS.laborProfiles.includes('peopleCount'));
    const p = profile('p1');
    const fp = economicFingerprint(snapshotValuesFromLine('laborProfiles', p));
    assert.equal(economicFingerprint(snapshotValuesFromLine('laborProfiles', { ...p, peopleCount: 7 })), fp);
  });
});

describe('RES-02 · buscar y filtrar', () => {
  const groups = groupLaborProfiles([
    profile('p1', { agreementId: 'a-pp', role: 'Operador de hidrogrúa', category: 'Categoría C' }),
    profile('p2', { agreementId: 'a-pp', role: 'Chofer de camión' }),
    profile('p3', { agreementId: 'a-uocra', role: 'Oficial albañil' }),
    profile('p4', { role: 'Supervisor' }),
  ], AGREEMENTS, { costOf });

  test('por convenio (la clave del grupo)', () => {
    assert.deepEqual(filterLaborGroups(groups, { group: 'a-uocra' }).map((g) => g.key), ['a-uocra']);
    assert.deepEqual(filterLaborGroups(groups, { group: GROUP_NONE }).map((g) => g.key), [GROUP_NONE]);
  });

  test('por texto: puesto o categoría, sin mayúsculas ni tildes; los grupos vacíos no se muestran', () => {
    const r = filterLaborGroups(groups, { query: 'HIDROGRUA' });
    assert.deepEqual(r.map((g) => g.key), ['a-pp']);
    assert.deepEqual(r[0].items.map((i) => i.profile.id), ['p1']);
    assert.equal(r[0].profilesCount, 1, 'los conteos son los de lo que se ve');
    assert.deepEqual(filterLaborGroups(groups, { query: 'categoria c' })[0].items.map((i) => i.profile.id), ['p1']);
    assert.deepEqual(filterLaborGroups(groups, { query: 'nada que coincida' }), []);
  });

  test('si el texto coincide con el convenio, se ve el grupo entero', () => {
    const r = filterLaborGroups(groups, { query: 'petroleros' });
    assert.deepEqual(r.map((g) => g.key), ['a-pp']);
    assert.equal(r[0].items.length, 2);
  });
});

describe('RES-02 · sueldo bruto que se descompone (sin doble conteo)', () => {
  test('sólo bruto: básico = bruto y adicionales = 0', () => {
    assert.deepEqual(splitGross({ gross: 2900000 }), { ok: true, basicMonthly: 2900000, additionalsMonthly: 0, basicGiven: false });
  });

  test('bruto y básico: adicionales = bruto − básico', () => {
    assert.deepEqual(splitGross({ gross: 2900000, basic: 2300000 }), { ok: true, basicMonthly: 2300000, additionalsMonthly: 600000, basicGiven: true });
    assert.deepEqual(splitGross({ gross: 2900000.55, basic: 2300000.3 }), { ok: true, basicMonthly: 2300000.3, additionalsMonthly: 600000.25, basicGiven: true });
  });

  test('errores: básico mayor que el bruto, bruto 0, negativo o no numérico, básico 0 o negativo', () => {
    assert.equal(splitGross({ gross: 1000, basic: 1001 }).field, 'basic');
    [0, -5, Number.NaN, null, undefined, '1000'].forEach((g) => assert.equal(splitGross({ gross: g }).field, 'gross', String(g)));
    [0, -1, Number.NaN].forEach((b) => assert.equal(splitGross({ gross: 1000, basic: b }).field, 'basic', String(b)));
  });

  test('básico + adicionales = bruto siempre', () => {
    for (let i = 1; i <= 200; i += 1) {
      const gross = Math.round((i * 137.31 + 500000) * 100) / 100;
      const basic = Math.round(gross * ((i % 10) / 10 + 0.05) * 100) / 100;
      const r = splitGross({ gross, basic: basic > gross ? gross : basic });
      assert.ok(r.ok);
      assert.ok(Math.abs(r.basicMonthly + r.additionalsMonthly - gross) < 0.005, `${gross} ${basic}`);
    }
  });

  test('un perfil existente: el bruto es básico + adicionales y abrir y guardar sin cambios lo deja igual (misma huella)', () => {
    const p = profile('p1', { basicMonthly: 2300000, additionalsMonthly: 600000 });
    assert.equal(grossOf(p), 2900000);
    const r = splitGross({ gross: grossOf(p), basic: p.basicMonthly });
    const again = { ...p, basicMonthly: r.basicMonthly, additionalsMonthly: r.additionalsMonthly };
    assert.deepEqual(again, p);
    assert.equal(economicFingerprint(snapshotValuesFromLine('laborProfiles', again)), economicFingerprint(snapshotValuesFromLine('laborProfiles', p)));
  });

  test('mismo costo que hoy: 20 perfiles sintéticos dan el mismo costo empresa descompuestos desde su bruto', () => {
    for (let i = 0; i < 20; i += 1) {
      const p = profile(`p${i}`, { basicMonthly: 900000 + i * 75000, additionalsMonthly: (i % 4) * 110000, insuranceMonthly: 30000, ppeMonthly: 20000 + i * 1000 });
      const r = splitGross({ gross: grossOf(p), basic: p.basicMonthly });
      const after = { ...p, basicMonthly: r.basicMonthly, additionalsMonthly: r.additionalsMonthly };
      assert.ok(Math.abs(costOf(after) - costOf(p)) < 0.005, p.id);
    }
  });

  test('el caso del diseño: bruto 2.900.000 con básico 2.300.000 cuesta 4.309.841 (no 5.186.015 del doble conteo)', () => {
    const p = profile('chofer', { basicMonthly: 2300000, additionalsMonthly: 600000, insuranceMonthly: 35000, ppeMonthly: 40000 });
    assert.ok(Math.abs(costOf(p) - 4309841) < 1, String(costOf(p)));
    const doubled = { ...p, basicMonthly: 2900000, additionalsMonthly: 600000 };
    assert.ok(costOf(doubled) > costOf(p) * 1.19, 'el doble conteo encarece ~20 %');
    const r = splitGross({ gross: 2900000, basic: 2300000 });
    assert.equal(r.basicMonthly + r.additionalsMonthly, 2900000);
  });
});

describe('RES-02 · horas extra: el bruto no se toma como básico sin decirlo', () => {
  const p = profile('p1');
  const quote = (lines, status = 'draft') => ({ id: `q-${Math.random()}`, status, labor: lines });

  test('en el perfil', () => {
    assert.deepEqual(overtimeUse({ ...p, overtimeHoursPerActiveDay: 2 }, []), { inProfile: true, quotesCount: 0, any: true });
    assert.deepEqual(overtimeUse(p, []), { inProfile: false, quotesCount: 0, any: false });
  });

  test('en cotizaciones que lo usan (por snapshot o por el vínculo anterior), de cualquier estado', () => {
    const quotes = [
      quote([{ snapshot: { resourceId: 'p1' }, overtimeHoursPerActiveDay: 3 }]),
      quote([{ sourceId: 'p1', overtimeHoursPerActiveDay: 1 }], 'lost'),
      quote([{ snapshot: { resourceId: 'p1' }, overtimeHoursPerActiveDay: 0 }]),
      quote([{ snapshot: { resourceId: 'otro' }, overtimeHoursPerActiveDay: 5 }]),
      quote(null),
      null,
    ];
    assert.deepEqual(overtimeUse(p, quotes), { inProfile: false, quotesCount: 2, any: true });
  });
});

describe('RES-02-G1 · borrar un convenio no deja referencias colgadas', () => {
  test('sus perfiles quedan sin convenio en la misma operación; los otros y las cotizaciones no cambian', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.init();
    const profiles = await repo.getResources('laborProfiles');
    const target = (await repo.getResources('agreements')).find((a) => profiles.some((p) => p.agreementId === a.id));
    assert.ok(target, 'la demo tiene un convenio con perfiles');
    const usedBy = (await repo.getResources('laborProfiles')).filter((p) => p.agreementId === target.id).map((p) => p.id);
    const others = (await repo.getResources('laborProfiles')).filter((p) => p.agreementId !== target.id);
    const quotesBefore = JSON.stringify(await repo.getQuotes());
    assert.ok(usedBy.length > 0);

    assert.equal(await repo.deleteResource('agreements', target.id), true);

    const after = await repo.getResources('laborProfiles');
    usedBy.forEach((id) => assert.equal(after.find((p) => p.id === id).agreementId, null, id));
    others.forEach((p) => assert.equal(after.find((x) => x.id === p.id).agreementId, p.agreementId, p.id));
    assert.ok(!after.some((p) => p.agreementId === target.id));
    assert.equal(JSON.stringify(await repo.getQuotes()), quotesBefore, 'las cotizaciones no cambian');
  });
});

describe('RES-02 · sin aumentos automáticos', () => {
  test('ningún módulo de Recursos multiplica el básico o los adicionales por un porcentaje', () => {
    for (const file of ['js/ui/views/library.js', 'js/domain/labor-groups.js']) {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /(basicMonthly|additionalsMonthly)\s*\*|\*\s*[\w.]*(basicMonthly|additionalsMonthly)/, file);
    }
  });
});
