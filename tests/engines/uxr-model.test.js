/**
 * UXR (rediseño de la cotización, 2026-10-25): tres modalidades nuevas del motor, opcionales. Sin sus campos
 * todo calcula como siempre (prueba de compatibilidad abajo y foto del motor en regression-baseline). Cada
 * cifra esperada sale de una cuenta a mano (oráculo), no del motor:
 *   - `activity.activationProfile`: llamados de distinta duración; el mínimo por llamado se aplica a CADA uno.
 *   - `activity.billedResources`: personas o equipos facturados en paralelo (hora-hombre, jornal, abono por equipo).
 *   - `quote.billingHorizon = 'job'`: precio total del trabajo (una obra de varios meses, no una mensualidad).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuote } from '../../js/engines/quote-engine.js';
import { priceComposition } from '../../js/engines/price-composition-engine.js';
import { service, person, owned, external, material, vehicle, taxes, LAB_SETTINGS, resetIds } from '../lab/lib/build.js';

const run = (q) => computeQuote(structuredClone(q), { settings: LAB_SETTINGS });
const close = (got, want, tol = 1e-6) => assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${got} ≠ ${want}`);
const profileOf = (list) => Object.entries(list.reduce((m, h) => ({ ...m, [h]: (m[h] || 0) + 1 }), {})).map(([u, c]) => ({ count: c, units: Number(u) }));
const billedWithMinimum = (list, min) => list.reduce((a, h) => a + Math.max(h, min), 0);
const mean = (list) => list.reduce((a, h) => a + h, 0) / list.length;

describe('Llamados de distinta duración: el mínimo por llamado se aplica a cada uno', () => {
  const CALLS = [2, 2, 3, 3, 5, 5, 8, 8]; // 8 llamados de una hidrogrúa; mínimo 4 h por llamado
  const crane = () => owned({ name: 'Hidrogrúa', replacementValue: 250000000, maintenancePerHour: 12000, fuelLitersPerHour: 12 });
  const quote = (profile) => {
    resetIds();
    const q = service({
      serviceType: 'on_call', unit: 'hour', pricingMode: 'known_rate',
      activity: { activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: mean(CALLS) },
      labor: [person({ peoplePerPosition: 2 })], equipment: [crane()],
      rules: { availabilityFeeMonthly: 3000000, mobilizationFeePerActivation: 250000, minimumCallUnits: 4 },
      pricing: { knownRate: 150000 },
    });
    if (profile) q.activity.activationProfile = profileOf(CALLS);
    return q;
  };

  test('8 llamados de 2, 3, 5 y 8 h con mínimo 4 h: 42 h facturadas (al promedio daban 36)', () => {
    const avg = run(quote(false));
    const each = run(quote(true));
    close(avg.kpis.billableQuantity, 8 * Math.max(mean(CALLS), 4)); // 36
    close(each.kpis.billableQuantity, billedWithMinimum(CALLS, 4)); // 42
    close(each.kpis.revenue, 3000000 + 250000 * 8 + 150000 * 42);
    close(each.kpis.totalCost, avg.kpis.totalCost); // las horas trabajadas no cambian: el costo propio tampoco
    assert.ok(!(each.completeness.notices || []).some((n) => n.id === 'minimum_on_average'), 'con la duración de cada llamado, el aviso V-6 no corresponde');
    assert.ok((avg.completeness.notices || []).some((n) => n.id === 'minimum_on_average'));
  });

  test('si los datos ya no coinciden con la lista (otras horas por día), rige el promedio como siempre', () => {
    const q = quote(true);
    q.activity.hoursPerActiveDay = 5;
    close(run(q).kpis.billableQuantity, 8 * Math.max(5, 4)); // 40
  });

  test('la matriz de días escala por llamado (10 llamados → 52,5 h)', () => {
    const row = run(quote(true)).matrix.find((x) => x.activeDays === 10);
    close(row.billableUnits, (10 * billedWithMinimum(CALLS, 4)) / 8);
  });

  test('el mínimo del proveedor (por hora, con las horas de la actividad) también va por llamado', () => {
    const q = quote(true);
    q.equipment = [external({ name: 'Hidrogrúa tercerizada' }, { price: 120000, unit: 'hour', minimumUnits: 4 })];
    const line = run(q).model.external[0];
    close(line.billedUnitsPerActivation * 8, billedWithMinimum(CALLS, 4));
  });

  test('técnico: 6 visitas de 2 h y 4 de 8 h, mínimo 3 h → 50 h', () => {
    const VIS = [...Array(6).fill(2), ...Array(4).fill(8)];
    resetIds();
    const q = service({
      serviceType: 'configurable', unit: 'hour',
      activity: { activeDaysPerMonth: 10, daysPerActivation: 1, hoursPerActiveDay: mean(VIS), activationProfile: profileOf(VIS) },
      labor: [person({ role: 'Técnico' })], logistics: { notApplicable: false, distanceKm: 50, vehicles: [vehicle()] }, rules: { minimumCallUnits: 3 },
    });
    close(run(q).kpis.billableQuantity, billedWithMinimum(VIS, 3)); // 6 × 3 + 4 × 8 = 50
  });
});

describe('Personas o equipos facturados en paralelo (hora-hombre, abono por equipo)', () => {
  test('4 operarios × 22 días × 10 h por hora-hombre: 880 hh; los tramos por días siguen en 22', () => {
    resetIds();
    const q = service({
      serviceType: 'configurable', unit: 'hour',
      activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10, daysPerActivation: 22, availableDaysPerMonth: 22, billedResourceKind: 'person', billedResources: 4 },
      labor: [person({ positions: 4 })],
    });
    const r = run(q);
    close(r.kpis.billableQuantity, 4 * 22 * 10);
    close(r.ratesAtEstimate.billableDays, 22);
    // Tarifa piso por hora-hombre × horas-hombre = el costo más los impuestos sobre la facturación (5 % en el lab).
    close(r.kpis.floorNetRate * 880, r.kpis.totalCost / 0.95);
  });

  test('sin el campo calcula exactamente igual (la misma cotización con 1 recurso)', () => {
    resetIds();
    const base = service({ serviceType: 'crew', unit: 'hour', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10 }, labor: [person({ positions: 4 })] });
    const one = structuredClone(base);
    one.activity.billedResources = 1;
    assert.deepEqual(run(one).kpis, run(base).kpis);
  });

  test('abono mensual por equipo con 3 generadores: 3 abonos', () => {
    resetIds();
    const q = service({
      serviceType: 'equipment_only', unit: 'month',
      activity: { activeDaysPerMonth: 30, availableDaysPerMonth: 30, hoursPerActiveDay: 24, billedResourceKind: 'equipment', billedResources: 3 },
      equipment: [owned({ name: 'Generador', quantity: 3, replacementValue: 60000000, fuelNotApplicable: true })],
    });
    const r = run(q);
    close(r.kpis.billableQuantity, 3);
    close(r.kpis.floorNetRate * 3, r.kpis.totalCost / 0.95);
  });

  test('2 hidrogrúas con mínimo 4 h por llamado y por equipo', () => {
    resetIds();
    const CALLS = [2, 2, 3, 3, 5, 5, 8, 8];
    const q = service({
      serviceType: 'on_call', unit: 'hour',
      activity: { activeDaysPerMonth: 8, daysPerActivation: 1, hoursPerActiveDay: mean(CALLS), activationProfile: profileOf(CALLS), billedResourceKind: 'equipment', billedResources: 2 },
      labor: [person({ peoplePerPosition: 2 })], equipment: [owned({ name: 'Hidrogrúa', quantity: 2 })], rules: { minimumCallUnits: 4 },
    });
    close(run(q).kpis.billableQuantity, 2 * billedWithMinimum(CALLS, 4)); // 84
  });
});

describe('Precio total del trabajo (obra de 3 meses)', () => {
  const plain = () => person({ positions: 1, basicMonthly: 1000000, sacPct: 0, vacationPct: 0, employerContributionsPct: 0, artPct: 0 });
  const job = ({ contractMonths, horizon, perMonth }) => {
    resetIds();
    const q = service({
      serviceType: 'lump_sum', unit: 'job', contractMonths,
      labor: [plain()],
      equipment: [external({ name: 'Subcontrato global' }, { price: 30000000, unit: 'global' })],
      materials: [material({ basis: 'per_activation', unitCost: 45000000 })],
      indirect: { method: 'percent_direct', pct: 0 }, finance: { monthlyRatePct: 0 }, risk: { generalPct: 0, items: [] }, billingTaxes: taxes('na'),
      pricing: { targetMarginPct: 10 },
      activity: { availableDaysPerMonth: 22, hoursPerActiveDay: 8, daysPerActivation: 66, billableQuantityPerMonth: perMonth },
    });
    if (horizon) q.billingHorizon = horizon;
    return q;
  };
  // Oráculo: 3 meses de sueldo + el subcontrato una vez + los materiales una vez; precio con 10 % de margen.
  const jobCost = 3 * 1000000 + 30000000 + 45000000;
  const jobPrice = jobCost / 0.9;

  for (const contractMonths of [3, 12]) {
    test(`con contrato de ${contractMonths} meses: el costo y el precio son los del trabajo completo`, () => {
      const r = run(job({ contractMonths, horizon: 'job', perMonth: 1 }));
      close(r.kpis.totalCost, jobCost);
      close(r.kpis.targetListRate, jobPrice);
      close(priceComposition(r).contract.revenue, r.kpis.revenue); // el "total del contrato" es UN trabajo
      assert.equal(r.activity.jobHorizon, true);
      close(r.activity.jobMonths, 3);
      const ids = r.completeness.pending.map((p) => p.id);
      assert.ok(!ids.includes('multi_month') && !ids.includes('labor_hours'), ids.join(', '));
      assert.equal(r.breakEven.notApplicable, true);
    });
  }

  test('sin el horizonte, una cotización "por trabajo" calcula como siempre', () => {
    const a = run(job({ contractMonths: 12, perMonth: 1 / 3 }));
    const b = structuredClone(job({ contractMonths: 12, perMonth: 1 / 3 }));
    b.billingHorizon = 'month';
    assert.deepEqual(run(b).kpis, a.kpis);
  });

  test('el horizonte sólo rige con precio global (con otra unidad se ignora)', () => {
    resetIds();
    const q = service({ serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] });
    const withHorizon = structuredClone(q);
    withHorizon.billingHorizon = 'job';
    assert.deepEqual(run(withHorizon).kpis, run(q).kpis);
  });
});

describe('Materiales "por unidad facturada" (por camión reparado, por válvula, por hora-hombre)', () => {
  const monthlyOf = (r, i = 0) => {
    const l = r.model.materials.lines[i];
    return l.fixedMonthly + l.variablePerActiveDay * r.activity.activeDaysPerMonth;
  };
  const base = (o) => {
    resetIds();
    return service({ serviceType: 'configurable', pricingMode: 'known_activity', labor: [person()], ...o });
  };

  test('60 válvulas por mes a 6 por día: 2 juntas de $ 5.000 por válvula = $ 600.000 por mes (no por día ni por salida)', () => {
    const q = base({
      unit: 'custom', unitName: 'válvula',
      activity: { billableQuantityPerMonth: 60, unitsPerActiveDay: 6, daysPerActivation: 2 },
      materials: [material({ basis: 'per_billed_unit', quantity: 2, unitCost: 5000 })],
    });
    const r = run(q);
    close(r.activity.activeDaysPerMonth, 10);
    close(monthlyOf(r), 60 * 2 * 5000);
    // Por salida (cada 2 días) habría sido 5 salidas × $ 10.000: la diferencia que encontró la simulación.
    q.materials[0].basis = 'per_activation';
    close(monthlyOf(run(q)), 5 * 2 * 5000);
  });

  test('hora-hombre: 4 personas × 10 h × 22 días = 880 horas-hombre × $ 100 de consumibles', () => {
    const q = base({
      unit: 'hour',
      activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10, billedResourceKind: 'person', billedResources: 4 },
      materials: [material({ basis: 'per_billed_unit', quantity: 1, unitCost: 100 })],
    });
    close(monthlyOf(run(q)), 880 * 100);
  });

  test('abono por equipo: 3 equipos por mes → el consumo por equipo es fijo × 3', () => {
    const q = base({
      unit: 'month',
      activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 9, billedResourceKind: 'equipment', billedResources: 3 },
      materials: [material({ basis: 'per_billed_unit', quantity: 1, unitCost: 40000 })],
    });
    const r = run(q);
    close(r.model.materials.lines[0].fixedMonthly, 3 * 40000);
    close(monthlyOf(r), 120000);
  });

  test('precio total del trabajo: "por trabajo" se consume una sola vez en toda la obra (66 días)', () => {
    const q = base({
      unit: 'job',
      activity: { daysPerActivation: 66, availableDaysPerMonth: 22, hoursPerActiveDay: 9 },
      materials: [material({ basis: 'per_billed_unit', quantity: 1, unitCost: 500000 })],
    });
    q.billingHorizon = 'job';
    const r = run(q);
    close(r.activity.activeDaysPerMonth, 66);
    close(monthlyOf(r), 500000);
  });
});

describe('Combustible duplicado en transporte (SIM A2)', () => {
  test('camión que cobra por viaje con L/h trabajando y L/100 km en ruta: el control de duplicados avisa', () => {
    resetIds();
    const truck = owned({ name: 'Tractor con semirremolque', fuelLitersPerHour: 20, mobilization: { mode: 'self', travelLitersPer100Km: 35 } });
    const q = service({
      serviceType: 'configurable', unit: 'trip',
      activity: { billableQuantityPerMonth: 20, unitsPerActiveDay: 1, hoursPerActiveDay: 5 },
      labor: [person()], equipment: [truck],
      logistics: { notApplicable: false, baseName: 'Neuquén', destinationName: 'Añelo', distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [] },
    });
    const dup = (r) => r.completeness.items.find((i) => i.id === 'duplicates');
    const r = run(q);
    assert.equal(dup(r).status, 'warning');
    assert.match(dup(r).message, /Combustible posiblemente duplicado/);
    // Con $/día (no es transporte) no se presume: el equipo puede trabajar detenido.
    q.unit = 'day';
    q.activity = { activeDaysPerMonth: 20, hoursPerActiveDay: 5 };
    assert.equal(dup(run(q)).status, 'ok');
  });
});

describe('Precio total del trabajo: completitud', () => {
  test('no pide "trabajos por mes" (se vende uno); sí pide los días de todo el trabajo', () => {
    resetIds();
    const q = service({ serviceType: 'configurable', unit: 'job', activity: { daysPerActivation: 66, availableDaysPerMonth: 22, hoursPerActiveDay: 9 }, labor: [person()] });
    q.billingHorizon = 'job';
    const util = (r) => r.completeness.items.find((i) => i.id === 'utilization');
    assert.equal(util(run(q)).status, 'ok');
    q.activity.daysPerActivation = null;
    assert.equal(util(run(q)).status, 'missing');
    assert.equal(util(run(q)).focus, 'activity.daysPerActivation');
  });
});

describe('Personas facturadas sin variante (SIM-02 S1)', () => {
  test('un número de personas guardado sin la unidad por persona no multiplica nada', () => {
    resetIds();
    const q = service({ serviceType: 'configurable', unit: 'hour', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10, billedResources: 4 }, labor: [person()] });
    close(run(q).kpis.billableQuantity, 220);
    q.activity.billedResourceKind = 'person';
    close(run(q).kpis.billableQuantity, 880);
  });
});

describe('Personas facturadas vs personal cargado (SIM-02 S1, P0)', () => {
  const hh = (billed, positions) => {
    resetIds();
    return service({ serviceType: 'configurable', unit: 'hour', activity: { activeDaysPerMonth: 22, hoursPerActiveDay: 10, billedResourceKind: 'person', billedResources: billed }, labor: [person({ positions })] });
  };
  test('facturar 5 personas con 4 puestos es crítico (la tarifa sale baja); con 3, un aviso', () => {
    const crit = (r) => r.completeness.items.find((i) => i.id === 'billed_resources_crew');
    const r5 = run(hh(5, 4));
    assert.equal(crit(r5).status, 'missing');
    assert.ok((r5.completeness.pending || []).some((p) => p.id === 'billed_resources_crew'));
    const r3 = run(hh(3, 4));
    assert.equal(crit(r3), undefined);
    assert.ok((r3.completeness.notices || []).some((n) => n.id === 'billed_resources_fewer'));
    const r4 = run(hh(4, 4));
    assert.equal(crit(r4), undefined);
    assert.ok(!(r4.completeness.notices || []).some((n) => n.id === 'billed_resources_fewer'));
  });
});
