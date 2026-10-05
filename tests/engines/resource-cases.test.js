/**
 * PLAN-2026-005 — Recursos con base económica, snapshots, equipos propios /
 * externos y movilización. Casos de negocio A–F (integración de dominio y
 * motores) + reglas de doble conteo, moneda y base económica.
 *
 * RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN: la cotización calcula con los
 * valores que copió; si el recurso cambia, sólo avisa y ofrece actualizar.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { buildCostModel, costAtActivity } from '../../js/engines/cost-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { summarizeEconomicBase } from '../../js/engines/economic-base-engine.js';
import {
  createEmptyQuote, defaultSettings, laborLineFromProfile, equipmentLineFromLibrary, materialLineFromLibrary,
  externalLineFromService, blankEquipmentLine, createExternalTerms, createMobilization,
} from '../../js/domain/quote-factory.js';
import { lineSyncStatus, applyResourceUpdate, dismissResourceUpdate, resourceChanges, mainValueOf } from '../../js/domain/resource-sync.js';
import { fingerprintOf, snapshotValuesFromLine } from '../../js/domain/resource-snapshot.js';
import { deepClone } from '../../js/core/object.js';

const OCT = '2026-10-05T12:00:00.000Z';
const settings = { ...defaultSettings('org'), illustrative: false, fuelPricePerLiter: 1500, fuelPriceBase: { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' } };

const approx = (a, b, msg = '', tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b}, obtenido ${a}`);

/** Cotización mínima on-call: 1 día por llamado, 8 días activos, sin estructura, financiero ni contingencia. */
function baseQuote() {
  const q = createEmptyQuote({ organizationId: 'org', settings, now: OCT, id: 'q', code: 'COT-1' });
  q.activity.activeDaysPerMonth = 8;
  q.activity.daysPerActivation = 1;
  q.activity.hoursPerActiveDay = 10;
  q.finance.paymentTermDays = 0;
  q.finance.monthlyRatePct = 0;
  q.logistics.distanceKm = 80;
  q.logistics.roundTrip = true;
  q.logistics.tripsPerActivation = 1;
  q.materialsNotApplicable = true;
  return q;
}

const operatorProfile = (overrides = {}) => ({
  id: 'lp-operador',
  role: 'Operador Vactor',
  basicMonthly: 3200000,
  additionalsMonthly: 0,
  normalHoursPerMonth: 176,
  overtimeHoursPerActiveDay: 0,
  overtimePremiumPct: 50,
  mealPerActiveDay: 0,
  sacPct: 0,
  vacationPct: 0,
  employerContributionsPct: 0,
  artPct: 0,
  insuranceMonthly: 0,
  ppeMonthly: 0,
  trainingMonthly: 0,
  transferMonthly: 0,
  base: { period: '2026-09', currency: 'ARS', source: 'company', note: '' },
  ...overrides,
});

const vactor = (overrides = {}) => ({
  id: 'eq-014',
  name: 'Vactor EQ-014',
  internalCode: 'EQ-014',
  familyId: 'vactor',
  acquisition: 'owned',
  replacementValue: 420000000,
  usefulLifeYears: 10,
  residualValue: 0,
  insuranceAnnual: 1200000,
  licenseAnnual: 0,
  certificationsAnnual: 0,
  otherAnnual: 0,
  capitalRatePctAnnual: 0,
  maintenancePerHour: 10000,
  tiresPerHour: 2000,
  fuelLitersPerHour: 15,
  mobility: { selfPropelled: true, roadLegal: true, requiresTransport: false, requiresDriver: true, travelLitersPer100Km: 40, travelCostPerKm: 200 },
  base: { period: '2026-07', currency: 'ARS', source: 'company', note: '' },
  costsBase: { period: '2026-09', currency: 'ARS', source: 'company', note: '' },
  ...overrides,
});

describe('CASO A — snapshot histórico: cambiar Recursos no cambia la cotización', () => {
  test('la cotización conserva $ 3.200.000 base sep-26 y ofrece actualizar a mano', () => {
    const profile = operatorProfile();
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(profile, null, { id: 'l1', now: OCT }));
    const before = computeQuote(q, { settings });
    assert.equal(q.labor[0].basicMonthly, 3200000);
    assert.equal(q.labor[0].base.period, '2026-09');
    assert.equal(q.labor[0].snapshot.takenAt, OCT);
    assert.equal(q.labor[0].snapshot.legacy, false);

    // Tres meses después, el recurso maestro cambia.
    const updated = operatorProfile({ basicMonthly: 4000000, base: { period: '2027-01', currency: 'ARS', source: 'company', note: '' } });
    const resources = { laborProfiles: [updated], agreements: [] };
    const after = computeQuote(q, { settings });
    approx(after.kpis.totalCost, before.kpis.totalCost, 'la cotización histórica no cambia');
    assert.equal(q.labor[0].basicMonthly, 3200000);

    const status = lineSyncStatus('labor', q.labor[0], resources);
    assert.equal(status.state, 'changed');
    assert.equal(mainValueOf(status.type, status.used), 3200000);
    assert.equal(status.used.base.period, '2026-09');
    assert.equal(mainValueOf(status.type, status.current), 4000000);
    assert.equal(status.current.base.period, '2027-01');
    assert.equal(resourceChanges(q, resources).length, 1);

    // [Conservar valor original]: deja de avisar por ESTA versión del recurso.
    const kept = dismissResourceUpdate('labor', q.labor[0], resources);
    assert.equal(kept.basicMonthly, 3200000);
    assert.equal(lineSyncStatus('labor', kept, resources).state, 'dismissed');
    // ... pero si el recurso vuelve a cambiar, avisa de nuevo.
    const again = { laborProfiles: [operatorProfile({ basicMonthly: 4100000 })], agreements: [] };
    assert.equal(lineSyncStatus('labor', kept, again).state, 'changed');

    // [Actualizar en esta cotización]: toma el valor actual y conserva lo operativo.
    const line = { ...q.labor[0], positions: 2, peoplePerPosition: 3 };
    const next = applyResourceUpdate('labor', line, resources, { now: '2027-01-10T00:00:00.000Z' });
    assert.equal(next.basicMonthly, 4000000);
    assert.equal(next.base.period, '2027-01');
    assert.equal(next.positions, 2);
    assert.equal(next.peoplePerPosition, 3);
    assert.equal(next.id, 'l1');
    assert.equal(next.snapshot.takenAt, '2027-01-10T00:00:00.000Z');
    assert.equal(lineSyncStatus('labor', next, resources).state, 'current');
  });

  test('renombrar el recurso (dato no económico) no dispara el aviso; un ajuste en la cotización se marca como ajustado', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile(), null, { id: 'l1', now: OCT }));
    const renamed = { laborProfiles: [operatorProfile({ role: 'Operador de Vactor (nuevo nombre)' })], agreements: [] };
    assert.equal(lineSyncStatus('labor', q.labor[0], renamed).state, 'current');
    const adjusted = { ...q.labor[0], basicMonthly: 3300000 };
    const s = lineSyncStatus('labor', adjusted, renamed);
    assert.equal(s.state, 'current');
    assert.equal(s.adjusted, true);
  });

  test('si el recurso se borra, la cotización conserva sus valores (estado "missing")', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile(), null, { id: 'l1', now: OCT }));
    assert.equal(lineSyncStatus('labor', q.labor[0], { laborProfiles: [] }).state, 'missing');
    assert.equal(lineSyncStatus('labor', { id: 'x', basicMonthly: 1 }, {}).state, 'unlinked');
  });

  test('equipos y materiales también: valor de reposición y costo unitario', () => {
    const q = baseQuote();
    q.equipment.push(equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT }));
    const mat = { id: 'm1', description: 'Absorbente', unitCost: 5000, base: { period: '2026-08', currency: 'ARS', source: null, note: '' } };
    q.materials.push(materialLineFromLibrary(mat, { id: 'ml1', now: OCT }));
    const resources = { equipment: [vactor({ replacementValue: 450000000 })], materials: [{ ...mat, unitCost: 6000 }] };
    const changes = resourceChanges(q, resources);
    assert.deepEqual(changes.map((c) => c.listKey).sort(), ['equipment', 'materials']);
    const eq = changes.find((c) => c.listKey === 'equipment');
    assert.equal(mainValueOf(eq.type, eq.used), 420000000);
    assert.equal(mainValueOf(eq.type, eq.current), 450000000);
    // Actualizar el equipo conserva cantidad, horas y cómo llega al servicio.
    const line = { ...q.equipment[0], quantity: 2, hoursPerActiveDay: 6, mobilization: { ...q.equipment[0].mobilization, mode: 'none' } };
    const next = applyResourceUpdate('equipment', line, resources, { now: OCT });
    assert.equal(next.replacementValue, 450000000);
    assert.equal(next.quantity, 2);
    assert.equal(next.hoursPerActiveDay, 6);
    assert.equal(next.mobilization.mode, 'none');
  });

  test('la huella es canónica: el orden de las claves no importa', () => {
    const a = snapshotValuesFromLine('materials', { unitCost: 1, wastePct: 2, logisticsPct: 3, base: { period: '2026-01' } });
    const b = { base: a.base, logisticsPct: 3, wastePct: 2, unitCost: 1 };
    assert.equal(fingerprintOf(a), fingerprintOf(b));
  });
});

describe('CASO B — Vactor propio autopropulsado: movilización sin pickup', () => {
  function vactorQuote() {
    const q = baseQuote();
    const labor = laborLineFromProfile(operatorProfile(), null, { id: 'juan', now: OCT });
    labor.role = 'Juan Pérez (operador)';
    q.labor.push(labor);
    const eq = equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT });
    eq.operatorLaborId = 'juan';
    q.equipment.push(eq);
    return q;
  }

  test('80 km ida + 80 km vuelta: 160 km, 64 L, $ 96.000 de combustible y $ 32.000 de desgaste por llamado', () => {
    const q = vactorQuote();
    assert.equal(q.equipment[0].mobilization.mode, 'self', 'el legajo sugiere "por sus propios medios"');
    assert.equal(q.equipment[0].mobilization.driver, 'operator');
    assert.equal(q.logistics.vehicles.length, 0, 'no hay que cargar una pickup');
    const model = buildCostModel(q);
    const m = model.mobilization.lines[0];
    approx(m.km, 160);
    approx(m.liters, 64);
    approx(m.fuelPerActivation, 96000);
    approx(m.wearPerActivation, 32000);
    // 8 llamados por mes (1 día por llamado): $ 128.000 × 8 = $ 1.024.000.
    const r = computeQuote(q, { settings });
    approx(r.kpis.logisticsMonthly, 128000 * 8);
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'logistics').status, 'ok');
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'mobility').status, 'ok');
  });

  test('el combustible en ruta va a Combustible y el desgaste a Logística; la amortización no se repite', () => {
    const q = vactorQuote();
    const model = buildCostModel(q);
    const at = costAtActivity(model, 8);
    const ownership = model.equipment[0].fixedMonthly;
    approx(at.byCategory.equipment, ownership + model.equipment[0].nonFuelPerActiveDay * 8, 'equipos propios = posesión + operación (sin desgaste en ruta)');
    approx(at.byCategory.logistics, 32000 * 8, 'logística = desgaste por km en ruta');
    approx(at.byCategory.fuel, model.equipment[0].fuelPerActiveDay * 8 + 96000 * 8, 'combustible = operativo + en ruta');
  });
});

describe('CASO C — retro propia transportada en carretón tercerizado (sin duplicar)', () => {
  test('retro: posesión y operación; carretón: $ 1.200.000 por viaje × 2 viajes por llamado; la retro no suma km', () => {
    const q = baseQuote();
    const retro = equipmentLineFromLibrary(vactor({ id: 'eq-retro', name: 'Retroexcavadora', familyId: 'backhoe', mobility: { selfPropelled: true, roadLegal: false, requiresTransport: true, travelLitersPer100Km: 0, travelCostPerKm: 0 } }), { id: 'retro', now: OCT });
    assert.equal(retro.mobilization.mode, 'transported', 'requiere transporte: se sugiere "lo transporta otro equipo"');
    const carreton = externalLineFromService({
      id: 'svc-carreton', name: 'Carretón', familyId: 'lowboy', acquisition: 'outsourced',
      external: { price: 1200000, unit: 'trip', operatorIncluded: true, fuelIncluded: true, mobilizationIncluded: true, fiscal: { vatRecoverable: 'yes' } },
      base: { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' },
    }, { id: 'carreton', now: OCT });
    retro.mobilization.carrierLineId = 'carreton';
    q.equipment.push(retro, carreton);

    const model = buildCostModel(q);
    const at = costAtActivity(model, 8);
    // Carretón: 1 viaje por llamado, ida y vuelta = 2 viajes × $ 1.200.000 × 8 llamados.
    approx(model.external[0].netPerActivation, 2400000);
    approx(at.byCategory.external, 2400000 * 8);
    // La retro no se moviliza por sus medios: 0 km, 0 combustible en ruta.
    const mRetro = model.mobilization.lines[0];
    assert.equal(mRetro.mode, 'transported');
    assert.equal(mRetro.km, 0);
    assert.equal(mRetro.carrier.name, 'Carretón');
    approx(at.byCategory.logistics, 0, 'sin desgaste en ruta de la retro');
    // Equipos propios = sólo la retro (posesión + operación).
    approx(at.byCategory.equipment, model.equipment[0].fixedMonthly + model.equipment[0].nonFuelPerActiveDay * 8);
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'mobility').status, 'ok');
  });

  test('sin elegir quién lo transporta, la completitud lo advierte (no suma nada en silencio)', () => {
    const q = baseQuote();
    const retro = equipmentLineFromLibrary(vactor({ mobility: { requiresTransport: true } }), { id: 'retro', now: OCT });
    q.equipment.push(retro);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'mobility');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /transporta/);
  });
});

describe('CASO D — camión alquilado con IVA recuperable', () => {
  function rentedQuote(recovery) {
    const q = baseQuote();
    const line = blankEquipmentLine({ acquisition: 'rented', id: 'camion' });
    line.name = 'Camión alquilado';
    line.external = createExternalTerms({ price: 1000000, unit: 'day', fuelIncluded: true, mobilizationIncluded: true, operatorIncluded: true, validUntil: '2026-10-31', fiscal: { vatPct: 21, vatRecoverable: recovery } });
    line.base = { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' };
    line.mobilization = createMobilization({ mode: 'none' });
    q.equipment.push(line);
    return q;
  }

  test('costo económico $ 1.000.000/día; salida de caja $ 1.210.000/día; el IVA no se duplica en el costo', () => {
    const r = computeQuote(rentedQuote('yes'), { settings });
    approx(r.kpis.externalMonthly, 1000000 * 8);
    approx(r.kpis.externalCashMonthly, 1210000 * 8);
    approx(r.kpis.externalTaxCreditMonthly, 210000 * 8);
    const row = r.eecc.rows.find((x) => x.category === 'external');
    approx(row.amount, 1000000 * 8);
    // No es un activo propio: sin amortización ni posesión.
    approx(r.eecc.rows.find((x) => x.category === 'equipment').amount, 0);
  });

  test('con IVA NO recuperable, el IVA sí es costo', () => {
    const r = computeQuote(rentedQuote('no'), { settings });
    approx(r.kpis.externalMonthly, 1210000 * 8);
  });

  test('sin definir si es recuperable: usa el neto (no suma IVA sin saber) y la completitud lo advierte', () => {
    const q = rentedQuote(null);
    approx(computeQuote(q, { settings }).kpis.externalMonthly, 1000000 * 8);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'external_terms');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /recuperable/);
  });

  test('IVA no recuperable sin alícuota: falta un dato para el costo (rojo)', () => {
    const q = rentedQuote('no');
    q.equipment[0].external.fiscal.vatPct = null;
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'external_terms').status, 'missing');
  });

  test('oferta vencida o sin vigencia: advertencia', () => {
    const q = rentedQuote('yes');
    q.equipment[0].external.validUntil = '2026-09-30';
    assert.match(evaluateCompleteness(q).items.find((i) => i.id === 'external_terms').message, /venció/);
    q.equipment[0].external.validUntil = null;
    assert.match(evaluateCompleteness(q).items.find((i) => i.id === 'external_terms').message, /vigencia/);
  });
});

describe('CASO E — el mismo operador trabaja y maneja el Vactor: no se duplica la mano de obra', () => {
  test('la mano de obra es UNA línea; la movilización no suma personal y lo explica', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile(), null, { id: 'juan', now: OCT }));
    const eq = equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT });
    eq.operatorLaborId = 'juan';
    q.equipment.push(eq);
    const withMob = computeQuote(q, { settings });
    const noMob = deepClone(q);
    noMob.equipment[0].mobilization.mode = 'none';
    const without = computeQuote(noMob, { settings });
    approx(withMob.eecc.rows.find((r) => r.category === 'labor').amount, without.eecc.rows.find((r) => r.category === 'labor').amount, 'mano de obra igual con o sin traslado');
    approx(withMob.eecc.rows.find((r) => r.category === 'labor').amount, 3200000, 'una sola persona');
    assert.equal(withMob.model.mobilization.lines[0].operatorName, 'Operador Vactor');
    assert.ok(withMob.traces.logistics.notes.some((n) => /no suman mano de obra/.test(n)));
  });

  test('operador posiblemente duplicado: tarifa externa con operador incluido + operador de Personal asignado', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile(), null, { id: 'juan', now: OCT }));
    const ext = blankEquipmentLine({ acquisition: 'outsourced', id: 'grua' });
    ext.external = createExternalTerms({ price: 100, unit: 'day', operatorIncluded: true, mobilizationIncluded: true, fiscal: { vatRecoverable: 'yes' }, validUntil: '2026-12-31' });
    ext.operatorLaborId = 'juan';
    q.equipment.push(ext);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'duplicates');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /Operador posiblemente duplicado/);
  });

  test('externo con movilización cobrada aparte y además "por sus propios medios": posible doble conteo', () => {
    const q = baseQuote();
    const ext = blankEquipmentLine({ acquisition: 'rented', id: 'cam' });
    ext.name = 'Camión alquilado';
    ext.external = createExternalTerms({ price: 100, unit: 'day', operatorIncluded: false, mobilizationIncluded: false, mobilizationAmount: 500000, fiscal: { vatRecoverable: 'yes' }, validUntil: '2026-12-31' });
    ext.mobilization.mode = 'self';
    q.equipment.push(ext);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'duplicates');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /Movilización posiblemente duplicada/);
    // Con "no requiere" la señal desaparece (el monto del proveedor sigue en el costo externo).
    q.equipment[0].mobilization.mode = 'none';
    assert.equal(evaluateCompleteness(q).items.find((i) => i.id === 'duplicates').status, 'ok');
  });

  test('equipo autopropulsado cargado también como vehículo auxiliar: posible doble conteo', () => {
    const q = baseQuote();
    q.equipment.push(equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT }));
    q.logistics.vehicles.push({ id: 'v1', name: 'Vactor EQ-014', count: 1, consumptionLPer100Km: 40, costPerKm: 200 });
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'duplicates');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /doble conteo/);
  });
});

describe('CASO F — base económica: material con base antigua, valores sin base', () => {
  test('un material con base de hace más de 6 meses se advierte', () => {
    const q = baseQuote();
    q.materialsNotApplicable = false;
    q.materials.push(materialLineFromLibrary({ id: 'm', description: 'Absorbente', unitCost: 1000, providedBy: 'contractor', base: { period: '2025-12', currency: 'ARS', source: null, note: '' } }, { id: 'ml', now: OCT }));
    const base = summarizeEconomicBase(q);
    assert.equal(base.offerPeriod, '2026-10');
    assert.equal(base.stale.length, 1);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'base_age');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /Absorbente/);
    assert.match(it.message, /dic-25/);
  });

  test('bases muy distintas entre sí: "Esta cotización usa valores con diferentes fechas base."', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile({ base: { period: '2026-05', currency: 'ARS', source: null, note: '' } }), null, { id: 'l', now: OCT }));
    const base = summarizeEconomicBase(q);
    // combustible oct-26 vs mano de obra may-26 = 5 meses > 3.
    assert.equal(base.mixed, false, 'sin equipos el combustible no cuenta');
    q.equipment.push(equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT }));
    const mixed = summarizeEconomicBase(q);
    assert.equal(mixed.mixed, true);
    assert.match(mixed.warnings.find((w) => w.id === 'mixed').message, /diferentes fechas base/);
  });

  test('sin fecha base → "Base no definida" (no se inventa) y la completitud lo advierte', () => {
    const q = baseQuote();
    q.labor.push(laborLineFromProfile(operatorProfile({ base: undefined }), null, { id: 'l', now: OCT }));
    assert.equal(q.labor[0].base.period, null);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'economic_base');
    assert.equal(it.status, 'warning');
    assert.match(it.message, /fecha base/);
  });

  test('la base se compara contra la fecha de la OFERTA (determinístico, nunca "hoy")', () => {
    const q = baseQuote();
    q.offerDate = '2027-06-01';
    q.labor.push(laborLineFromProfile(operatorProfile(), null, { id: 'l', now: OCT }));
    assert.equal(summarizeEconomicBase(q).stale.length, 1, 'sep-26 es vieja para una oferta de jun-27');
    q.offerDate = '2026-10-01';
    assert.equal(summarizeEconomicBase(q).stale.length, 0);
  });
});

describe('Moneda: valor de reposición en USD con tipo de cambio de la cotización', () => {
  test('con tipo de cambio: USD 420.000 × 1.000 = $ 420.000.000 de reposición', () => {
    const q = baseQuote();
    const usd = equipmentLineFromLibrary(vactor({ replacementValue: 420000, base: { period: '2026-07', currency: 'USD', source: 'company', note: '' } }), { id: 'e1', now: OCT });
    usd.mobilization.mode = 'none';
    q.equipment.push(usd);
    q.exchangeRates = [{ currency: 'USD', rate: 1000, base: { period: '2026-10', currency: 'ARS', source: 'company', note: '' } }];
    const ars = baseQuote();
    const same = equipmentLineFromLibrary(vactor(), { id: 'e1', now: OCT });
    same.mobilization.mode = 'none';
    ars.equipment.push(same);
    approx(buildCostModel(q).equipment[0].fixedMonthly, buildCostModel(ars).equipment[0].fixedMonthly, 'mismo costo en pesos');
    assert.equal(computeQuote(q, { settings }).issues.filter((i) => /tipo de cambio/.test(i.message)).length, 0);
  });

  test('sin tipo de cambio: no se suma, error en rojo y completitud en rojo (nunca se inventa la conversión)', () => {
    const q = baseQuote();
    q.equipment.push(equipmentLineFromLibrary(vactor({ replacementValue: 420000, base: { period: '2026-07', currency: 'USD', source: 'company', note: '' } }), { id: 'e1', now: OCT }));
    const r = computeQuote(q, { settings });
    const issue = r.issues.find((i) => /tipo de cambio USD/.test(i.message));
    assert.ok(issue);
    assert.equal(issue.severity, 'error');
    assert.equal(r.model.equipment[0].ownership.replacement, 0);
    assert.equal(r.completeness.items.find((i) => i.id === 'currency').status, 'missing');
    assert.ok(Number.isFinite(r.kpis.totalCost));
  });

  test('tipo de cambio 0, negativo, vacío o texto = sin tipo de cambio (no se suma; nunca 1:1 en silencio)', () => {
    for (const rate of [0, -5, '', 'abc', null, Infinity]) {
      const q = baseQuote();
      q.equipment.push(equipmentLineFromLibrary(vactor({ replacementValue: 420000, base: { period: '2026-07', currency: 'USD', source: 'company', note: '' } }), { id: 'e1', now: OCT }));
      q.exchangeRates = [{ currency: 'USD', rate, base: { period: null, currency: 'ARS', source: null, note: '' } }];
      const r = computeQuote(q, { settings });
      assert.equal(r.model.equipment[0].ownership.replacement, 0, `rate=${String(rate)}`);
      assert.ok(r.issues.some((i) => /tipo de cambio USD/.test(i.message)), `rate=${String(rate)}`);
      assert.ok(Number.isFinite(r.kpis.totalCost));
    }
  });
});

describe('Externos: unidades, mínimos, combustible y movilización del proveedor', () => {
  function ext(terms, extra = {}) {
    const q = baseQuote();
    q.activity.daysPerActivation = 2;
    const line = blankEquipmentLine({ acquisition: 'rented', id: 'x' });
    line.external = createExternalTerms({ fiscal: { vatRecoverable: 'yes' }, ...terms });
    line.mobilization = createMobilization({ mode: 'none' });
    Object.assign(line, extra);
    q.equipment.push(line);
    return buildCostModel(q).external[0];
  }

  test('por día con mínimo 3 días: un llamado de 2 días factura 3', () => {
    const x = ext({ price: 900000, unit: 'day', minimumUnits: 3 });
    assert.equal(x.billedUnitsPerActivation, 3);
    approx(x.netPerActivation, 2700000);
    approx(x.variablePerActiveDay, 1350000);
  });

  test('por mes: fijo mensual; global: repartido en los meses de contrato', () => {
    approx(ext({ price: 5000000, unit: 'month' }).fixedMonthly, 5000000);
    approx(ext({ price: 12000000, unit: 'global' }).fixedMonthly, 1000000, 'contrato de 12 meses');
  });

  test('global sin meses de contrato (0, vacío o negativo): se toma 1 mes, sin dividir por 0', () => {
    for (const months of [0, null, -3, '']) {
      const q = baseQuote();
      q.contractMonths = months;
      const line = blankEquipmentLine({ acquisition: 'outsourced', id: 'g' });
      line.external = createExternalTerms({ price: 6000000, unit: 'global', fiscal: { vatRecoverable: 'yes' } });
      line.mobilization = createMobilization({ mode: 'none' });
      q.equipment.push(line);
      const x = buildCostModel(q).external[0];
      approx(x.fixedMonthly, 6000000, `contractMonths=${String(months)}`);
      assert.equal(x.contractMonths, 1);
    }
  });

  test('por km: km de ruta del llamado (160 km)', () => {
    approx(ext({ price: 1000, unit: 'km' }).netPerActivation, 160000);
  });

  test('combustible NO incluido: litros/h × horas × precio va a Combustible; incluido o sin definir: no', () => {
    approx(ext({ price: 1, unit: 'day', fuelIncluded: false, fuelLitersPerHour: 12 }).fuelPerActiveDay, 12 * 10 * 1500);
    approx(ext({ price: 1, unit: 'day', fuelIncluded: true, fuelLitersPerHour: 12 }).fuelPerActiveDay, 0);
    approx(ext({ price: 1, unit: 'day', fuelLitersPerHour: 12 }).fuelPerActiveDay, 0);
  });

  test('movilización NO incluida: monto del proveedor por llamado; incluida: 0', () => {
    approx(ext({ price: 1, unit: 'day', mobilizationIncluded: false, mobilizationAmount: 900000 }).mobilizationPerActivation, 900000);
    approx(ext({ price: 1, unit: 'day', mobilizationIncluded: true, mobilizationAmount: 900000 }).mobilizationPerActivation, 0);
  });

  test('negativos, vacíos y texto: nunca NaN ni Infinity', () => {
    for (const terms of [{ price: -5, unit: 'day' }, { price: 'abc', unit: 'hour', minimumUnits: -1 }, { price: null, unit: 'global' }, {}]) {
      const x = ext(terms);
      for (const k of ['fixedMonthly', 'variablePerActiveDay', 'mobilizationPerActiveDay', 'fuelPerActiveDay', 'cashPerActiveDay', 'creditPerActiveDay']) {
        assert.ok(Number.isFinite(x[k]) && x[k] >= 0, `${JSON.stringify(terms)} ${k}=${x[k]}`);
      }
    }
  });
});

describe('Revisión adversarial (§36): correcciones', () => {
  const service = (overrides = {}) => ({
    id: 'svc-cam',
    name: 'Camión alquilado',
    familyId: 'truck',
    acquisition: 'rented',
    external: createExternalTerms({ price: 200000, unit: 'day', operatorIncluded: false, fuelIncluded: false, fuelLitersPerHour: 0, mobilizationIncluded: true, fiscal: { vatPct: 21, vatRecoverable: 'yes' }, validUntil: '2026-12-31' }),
    base: { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' },
    ...overrides,
  });

  test('"Actualizar" en un externo conserva el consumo y el desgaste en ruta de la línea', () => {
    const line = externalLineFromService(service(), { id: 'x1', now: OCT });
    line.mobilization = createMobilization({ mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' });
    const resources = { externalServices: [service({ external: createExternalTerms({ ...service().external, price: 210000 }) })] };
    assert.equal(lineSyncStatus('equipment', line, resources).state, 'changed');
    const next = applyResourceUpdate('equipment', line, resources, { now: OCT });
    assert.equal(next.external.price, 210000);
    assert.equal(next.mobilization.travelLitersPer100Km, 35);
    assert.equal(next.mobilization.travelCostPerKm, 150);
    assert.equal(next.mobilization.mode, 'self');
    assert.equal(next.id, 'x1');
  });

  test('"Actualizar" en una línea sin id le asigna un id nuevo (nunca uno compartido)', () => {
    const resources = { materials: [{ id: 'mat', description: 'Filtros', unitCost: 300, base: { period: '2026-10', currency: 'ARS', source: null, note: '' } }] };
    const a = materialLineFromLibrary({ id: 'mat', description: 'Filtros', unitCost: 100 }, { now: OCT });
    const b = materialLineFromLibrary({ id: 'mat', description: 'Filtros', unitCost: 100 }, { now: OCT });
    delete a.id;
    delete b.id;
    const na = applyResourceUpdate('materials', a, resources, { now: OCT });
    const nb = applyResourceUpdate('materials', b, resources, { now: OCT });
    assert.ok(typeof na.id === 'string' && na.id && na.id !== 'sync');
    assert.notEqual(na.id, nb.id);
  });

  test('externo por sus propios medios: combustible en ruta sólo si la tarifa NO lo incluye; sin definir se avisa', () => {
    const run = (fuelIncluded) => {
      const q = baseQuote();
      const line = blankEquipmentLine({ acquisition: 'outsourced', id: 'o' });
      line.external = createExternalTerms({ price: 100, unit: 'day', operatorIncluded: true, fuelIncluded, fuelLitersPerHour: 10, mobilizationIncluded: false, mobilizationAmount: 0, fiscal: { vatRecoverable: 'yes' }, validUntil: '2026-12-31' });
      line.mobilization = createMobilization({ mode: 'self', travelLitersPer100Km: 40, travelCostPerKm: 0, driver: 'other' });
      q.equipment.push(line);
      return q;
    };
    const fuelOf = (q) => buildCostModel(q).mobilization.fuelPerActiveDay;
    approx(fuelOf(run(false)), 160 * 0.4 * 1500, 'no incluido: se paga');
    approx(fuelOf(run(true)), 0, 'incluido: no se paga');
    approx(fuelOf(run(null)), 0, 'sin definir: no se suma');
    assert.match(evaluateCompleteness(run(null)).items.find((i) => i.id === 'external_terms').message, /incluye combustible u operador/);
  });

  test('tarifa por km sin km en la cotización (y sin mínimo): falta un dato (rojo), nunca 0 en silencio', () => {
    const q = baseQuote();
    q.logistics.notApplicable = true;
    const line = blankEquipmentLine({ acquisition: 'outsourced', id: 'k' });
    line.external = createExternalTerms({ price: 3000, unit: 'km', operatorIncluded: true, fuelIncluded: true, mobilizationIncluded: true, fiscal: { vatRecoverable: 'yes' }, validUntil: '2026-12-31' });
    line.mobilization = createMobilization({ mode: 'none' });
    q.equipment.push(line);
    const it = evaluateCompleteness(q).items.find((i) => i.id === 'external_terms');
    assert.equal(it.status, 'missing');
    assert.match(it.message, /por km o por viaje/);
  });

  test('tarifa global sin meses de contrato: se avisa; meses de contrato inválidos se validan', () => {
    const q = baseQuote();
    q.contractMonths = null;
    const line = blankEquipmentLine({ acquisition: 'outsourced', id: 'g' });
    line.external = createExternalTerms({ price: 12000000, unit: 'global', operatorIncluded: true, fuelIncluded: true, mobilizationIncluded: true, fiscal: { vatRecoverable: 'yes' }, validUntil: '2026-12-31' });
    line.mobilization = createMobilization({ mode: 'none' });
    q.equipment.push(line);
    assert.match(evaluateCompleteness(q).items.find((i) => i.id === 'external_terms').message, /meses de contrato/);
    q.contractMonths = -2;
    assert.ok(computeQuote(q, { settings }).issues.some((i) => i.path === 'contractMonths' && i.severity === 'error'));
  });

  test('material en USD que provee el cliente (o en 0): no pide tipo de cambio', () => {
    const q = baseQuote();
    q.materialsNotApplicable = false;
    const usd = { period: '2026-10', currency: 'USD', source: null, note: '' };
    q.materials.push(materialLineFromLibrary({ id: 'm1', description: 'Químico', unitCost: 500, quantity: 1, providedBy: 'client', base: usd }, { id: 'l1', now: OCT }));
    q.materials.push(materialLineFromLibrary({ id: 'm2', description: 'Repuesto', unitCost: 0, quantity: 1, providedBy: 'contractor', base: usd }, { id: 'l2', now: OCT }));
    const r = computeQuote(q, { settings });
    assert.equal(r.issues.filter((i) => /tipo de cambio/.test(i.message)).length, 0);
    const cur = r.completeness.items.find((i) => i.id === 'currency');
    assert.ok(!cur || cur.status !== 'missing');
    // Si nos cuesta, sí lo pide.
    q.materials[1].unitCost = 10;
    assert.ok(computeQuote(q, { settings }).issues.some((i) => /tipo de cambio USD/.test(i.message)));
  });
});
