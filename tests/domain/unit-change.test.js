/**
 * Cambio de unidad de cobro (veredicto 2026-11, V-03): cantidades, mínimos e
 * insumos cargados en la unidad anterior se limpian con aviso, nunca se leen
 * en la unidad nueva. Los seis casos reproducidos en la ronda de testeo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnitChange, hoursPerDayFromManHours } from '../../js/domain/unit-change.js';
import { billingUnitOf } from '../../js/domain/billing-units.js';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { service, person, material, otherCost, resetIds } from '../lab/lib/build.js';

/** Cambia la unidad como lo hace la pantalla: unidad nueva + applyUnitChange. */
function change(q, unit, unitName) {
  const from = billingUnitOf(q);
  q.unit = unit;
  if (unitName !== undefined) q.unitName = unitName;
  return applyUnitChange(q, from, billingUnitOf(q));
}

function quote(o = {}) {
  resetIds();
  return service({ labor: [person()], ...o });
}

describe('V-03 · applyUnitChange', () => {
  test('$/km (4.000 y 200 por día) → $/viaje: no quedan 4.000 viajes', () => {
    const q = quote({ serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 200 } });
    const notices = change(q, 'trip');
    assert.equal(q.activity.billableQuantityPerMonth, null);
    assert.equal(q.activity.unitsPerActiveDay, null);
    assert.deepEqual(notices, ['Cargá de nuevo los viajes por mes y por día: los que había estaban en km.']);
  });

  test('$ global → $/hito → $ global: los hitos no quedan como trabajos', () => {
    const q = quote({ serviceType: 'lump_sum', unit: 'job', activity: { billableQuantityPerMonth: 1, daysPerActivation: 20 } });
    assert.equal(change(q, 'milestone').length, 1);
    assert.equal(q.activity.billableQuantityPerMonth, null);
    q.activity.billableQuantityPerMonth = 3; // 3 hitos por mes
    const back = change(q, 'job');
    assert.equal(q.activity.billableQuantityPerMonth, null);
    assert.deepEqual(back, ['Cargá de nuevo la cantidad por mes en trabajos: la que había estaba en hitos.']);
    assert.equal(q.activity.daysPerActivation, 20, 'los días de cada trabajo no dependen de la unidad');
  });

  test('$/hora con mínimo 4 h → $/llamado → $/día: el mínimo se borra, no queda en 4 días', () => {
    const q = quote({ unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 5 }, rules: { minimumCallUnits: 4 } });
    const notices = change(q, 'call');
    assert.equal(q.rules.minimumCallUnits, 0);
    assert.deepEqual(notices, ['Se borró el mínimo por llamado (estaba en horas): cargalo de nuevo en "El precio".']);
    assert.deepEqual(change(q, 'day'), []);
    assert.equal(q.rules.minimumCallUnits, 0);
    assert.deepEqual(change(q, 'hour'), []);
    assert.equal(q.rules.minimumCallUnits, 0, 'al volver a hora no reaparece un mínimo de 20 h');
  });

  test('entre día y hora el mínimo por llamado se convierte con las horas por día (como siempre)', () => {
    const q = quote({ unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, rules: { minimumCallUnits: 4 } });
    assert.deepEqual(change(q, 'day'), []);
    assert.equal(q.rules.minimumCallUnits, 0.5);
    assert.deepEqual(change(q, 'hour'), []);
    assert.equal(q.rules.minimumCallUnits, 4);
    // Sin horas por día no hay cuenta segura: se borra y se avisa.
    q.activity.hoursPerActiveDay = null;
    assert.equal(change(q, 'day').length, 1);
    assert.equal(q.rules.minimumCallUnits, 0);
  });

  test('pasar por el abono también borra el mínimo por llamado', () => {
    const q = quote({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, rules: { minimumCallUnits: 2 } });
    assert.equal(change(q, 'month').filter((n) => /mínimo/.test(n)).length, 1);
    assert.equal(q.rules.minimumCallUnits, 0);
  });

  const valves = () => quote({
    serviceType: 'per_unit', unit: 'custom', unitName: 'válvula',
    activity: { billableQuantityPerMonth: 120, unitsPerActiveDay: 8, hoursPerActiveDay: 8 },
    materials: [
      material({ description: 'Kit de sellos', basis: 'per_output', quantity: 1, unitCost: 60_000 }),
      material({ description: 'Trapos', basis: 'per_active_day', quantity: 1, unitCost: 5_000 }),
      material({ description: 'Grasa', basis: 'per_output', quantity: 1, unitCost: 1_000, outputUnit: 'engrase', outputPerActiveDay: 2 }),
    ],
    otherCosts: [otherCost({ description: 'Certificado', behavior: 'per_output', amount: 10_000 })],
  });

  test('$/válvula → $/día: los insumos por válvula siguen por válvula y el costo no cambia', () => {
    const q = valves();
    const before = computeQuote(structuredClone(q), { settings: {} });
    const notices = change(q, 'day');
    assert.deepEqual(notices, ['2 insumos siguen calculándose por válvula (8 válvulas por día).']);
    assert.equal(q.materials[0].outputUnit, 'válvula');
    assert.equal(q.materials[0].outputPerActiveDay, 8);
    assert.equal(q.materials[1].outputUnit, undefined, 'una línea por día no se toca');
    assert.equal(q.materials[2].outputUnit, 'engrase', 'una línea con unidad propia no se toca');
    assert.equal(q.materials[2].outputPerActiveDay, 2);
    assert.equal(q.otherCosts[0].outputUnit, 'válvula');
    assert.equal(q.otherCosts[0].outputPerActiveDay, 8);
    // Los mismos días de trabajo (120 ÷ 8 = 15), cargados ahora en días.
    q.activity.activeDaysPerMonth = before.activity.activeDaysPerMonth;
    const after = computeQuote(structuredClone(q), { settings: {} });
    assert.equal(before.activity.activeDaysPerMonth, 15);
    assert.ok(Math.abs(after.estimate.cost.total - before.estimate.cost.total) < 1e-6, `${after.estimate.cost.total} ≠ ${before.estimate.cost.total}`);
    // Sin la corrección: el kit pasaba a "1 por día" y el costo bajaba.
    const broken = valves();
    broken.unit = 'day';
    broken.activity.activeDaysPerMonth = 15;
    assert.ok(computeQuote(broken, { settings: {} }).estimate.cost.total < before.estimate.cost.total - 1);
  });

  test('ídem con mínimo garantizado de 80 válvulas: no quedan "80 días"', () => {
    const q = valves();
    q.rules = { ...(q.rules || {}), minimumGuaranteeBasis: 'units', minimumGuaranteeUnits: 80 };
    const notices = change(q, 'day');
    assert.equal(q.rules.minimumGuaranteeUnits, 0);
    assert.ok(notices.includes('Se borró el mínimo garantizado (estaba en válvulas): cargalo de nuevo en "El precio".'));
    // Un mínimo en pesos no depende de la unidad.
    const q2 = valves();
    q2.rules = { ...(q2.rules || {}), minimumGuaranteeBasis: 'amount', minimumMonthlyGuarantee: 5_000_000 };
    change(q2, 'day');
    assert.equal(q2.rules.minimumMonthlyGuarantee, 5_000_000);
  });

  test('$/hectárea → $/m³: se limpia y se avisa', () => {
    const q = quote({ serviceType: 'per_unit', unit: 'ha', activity: { billableQuantityPerMonth: 20, unitsPerActiveDay: 1 } });
    const notices = change(q, 'm3');
    assert.equal(q.activity.billableQuantityPerMonth, null);
    assert.equal(q.activity.unitsPerActiveDay, null);
    assert.deepEqual(notices, ['Cargá de nuevo los m³ por mes y por día: los que había estaban en hectáreas.']);
  });

  test('desde día u hora los insumos por unidad producida no se tocan (siguen a la unidad que se elija)', () => {
    const q = quote({ unit: 'day', activity: { activeDaysPerMonth: 10 }, materials: [material({ basis: 'per_output', unitCost: 100 })] });
    assert.deepEqual(change(q, 'm3'), []);
    assert.equal(q.materials[0].outputUnit, undefined);
  });

  test('0.25.1 (AUD25-03): entre día y hora el insumo por unidad producida sigue por la unidad anterior, con aviso', () => {
    const q = quote({ unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, materials: [material({ basis: 'per_output', unitCost: 100 })] });
    assert.deepEqual(change(q, 'hour'), ['1 insumo sigue calculándose por día.']);
    assert.equal(q.materials[0].outputUnit, 'día');
    assert.equal(q.materials[0].outputPerActiveDay, 1);
    const h = quote({ unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, materials: [material({ basis: 'per_output', unitCost: 100 })] });
    assert.equal(change(h, 'day').length, 1);
    assert.equal(h.materials[0].outputUnit, 'hora');
    assert.equal(h.materials[0].outputPerActiveDay, 8);
  });

  test('0.25.1 (H-01): al pasar a "por mes", el recurso propio sin horas toma las del servicio', () => {
    const q = quote({ unit: 'hour', activity: { activeDaysPerMonth: 2, hoursPerActiveDay: 8 } });
    q.labor = [{ id: 'l1', role: 'Técnico', positions: 1, basicMonthly: 3200000, normalHoursPerMonth: 160 }];
    q.equipment = [{ id: 'e1', name: 'Grúa alquilada', acquisition: 'rented' }];
    const notices = change(q, 'month');
    assert.equal(q.labor[0].assignedHoursPerMonth, 16);
    assert.equal(q.labor[0].assignment, 'shared');
    assert.equal(q.labor[0].fixedCostSharePct, 10);
    assert.equal(q.equipment[0].assignedHoursPerMonth, undefined);
    assert.ok(notices.some((n) => /16 h por mes/.test(n)));
    // Con el servicio igual o más largo que su mes no se toca.
    const full = quote({ unit: 'day', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 8 } });
    full.labor = [{ id: 'l1', role: 'Técnico', positions: 1, basicMonthly: 3200000, normalHoursPerMonth: 160 }];
    change(full, 'month');
    assert.equal(full.labor[0].assignedHoursPerMonth, undefined);
  });

  test('sin cambio de unidad (o sólo de nombre de la unidad propia) no hace nada', () => {
    const q = valves();
    const info = billingUnitOf(q);
    assert.deepEqual(applyUnitChange(q, info, info), []);
    assert.deepEqual(change(q, 'custom', 'brida'), []);
    assert.equal(q.activity.billableQuantityPerMonth, 120);
  });

  test('unidad nueva por día: las cantidades cargadas no molestan y no se avisa', () => {
    const q = quote({ serviceType: 'transport', unit: 'km', activity: { billableQuantityPerMonth: 4000, unitsPerActiveDay: 200 } });
    assert.deepEqual(change(q, 'day'), []);
    // Al volver a una unidad por cantidad se limpian (sin "estaba en días": no se veían).
    assert.deepEqual(change(q, 'trip'), ['Cargá de nuevo los viajes por mes y por día.']);
    assert.equal(q.activity.billableQuantityPerMonth, null);
  });
});

describe('V-04 · horas por día desde las horas-hombre', () => {
  test('27 HH por día y 3 personas = 9 h', () => {
    assert.equal(hoursPerDayFromManHours(27, [{ positions: 3 }]), 9);
    assert.equal(hoursPerDayFromManHours(27, [{ positions: 2 }, { positions: 1 }]), 9);
  });
  test('fuera de 1 a 24 h, sin personas o sin dato: null (no se toca lo cargado)', () => {
    assert.equal(hoursPerDayFromManHours(100, [{ positions: 3 }]), null);
    assert.equal(hoursPerDayFromManHours(1, [{ positions: 3 }]), null);
    assert.equal(hoursPerDayFromManHours(27, []), null);
    assert.equal(hoursPerDayFromManHours(null, [{ positions: 3 }]), null);
    assert.equal(hoursPerDayFromManHours('', [{ positions: 3 }]), null);
  });
});
