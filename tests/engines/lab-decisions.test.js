/**
 * Decisiones del dueño sobre los hallazgos LAB-D1…D8 de Test Lab (PLAN-2026-014).
 *
 * Cada bloque fija la regla decidida con la cotización mínima que la muestra
 * (cada test falló antes de implementar la decisión).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import { service, person, owned, external } from '../lab/lib/build.js';
import { traceTransport } from '../../js/engines/transport-engine.js';
import { computeProduct } from '../../js/engines/product-engine.js';
import { computeExternalLine } from '../../js/engines/external-engine.js';
import { validateQuote } from '../../js/core/validation.js';
import { otherCost } from '../lab/lib/build.js';
import { normalizeProductShape, createEmptyProduct } from '../../js/domain/product-factory.js';
import { equipmentLineFromLibrary, createEmptyQuote, createQuoteFromTemplate, defaultSettings } from '../../js/domain/quote-factory.js';
import { demoServiceTemplates, demoReferenceQuote } from '../../js/domain/demo-data.js';
import { activationRoundingText } from '../../js/ui/result-text.js';
import { activationTerms } from '../../js/domain/activation-terms.js';
import { snapshotValuesFromLine, economicFingerprint } from '../../js/domain/resource-snapshot.js';
import { lineSyncStatus, applyResourceUpdate } from '../../js/domain/resource-sync.js';

const item = (q, id) => evaluateCompleteness(q).items.find((x) => x.id === id);

describe('LAB-D5 · Equipo propio que no usa combustible', () => {
  const quote = (o = {}) => service({
    id: 'd5', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 },
    labor: [person()],
    equipment: [owned({ name: 'Andamio multidireccional', replacementValue: 30000000, usefulLifeYears: 8, ...o })],
  });

  test('sin el dato, consumo 0 sigue siendo "falta" (0 puede ser un dato faltante)', () => {
    const fuel = item(quote(), 'fuel');
    assert.equal(fuel.status, 'missing');
    assert.equal(fuel.focus, 'equipment.0.fuelLitersPerHour');
  });

  test('"No usa combustible": no pide consumo ni precio y no impide el 100 %', () => {
    const q = quote({ fuelNotApplicable: true });
    q.fuel = { ...q.fuel, pricePerLiter: null };
    const fuel = item(q, 'fuel');
    assert.equal(fuel.status, 'ok');
    assert.match(fuel.message, /No aplica/);
    assert.equal(evaluateCompleteness(q).pending.filter((p) => p.id === 'fuel').length, 0);
  });

  test('marcado, no suma combustible aunque tenga un consumo cargado (ni trabajando ni en ruta)', () => {
    const base = quote({ fuelLitersPerHour: 10, mobilization: { mode: 'self', travelLitersPer100Km: 30, travelCostPerKm: 100, driver: 'other' } });
    base.logistics = { ...base.logistics, notApplicable: false, distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [] };
    const before = computeQuote(structuredClone(base));
    const fuelBefore = before.eecc.rows.find((x) => x.category === 'fuel').amount;
    assert.ok(fuelBefore > 0, 'sin el dato el consumo cargado suma combustible (como siempre)');
    const flagged = structuredClone(base);
    flagged.equipment[0].fuelNotApplicable = true;
    const after = computeQuote(flagged);
    assert.equal(after.eecc.rows.find((x) => x.category === 'fuel').amount, 0);
    // El desgaste en ruta sigue (no es combustible).
    assert.ok(after.model.mobilization.lines[0].wearPerActivation > 0);
    assert.equal(after.model.mobilization.lines[0].fuelPerActivation, 0);
  });

  test('sin marcar, ninguna cotización cambia (mismo costo al centavo)', () => {
    const q = quote({ fuelLitersPerHour: 12 });
    const a = computeQuote(structuredClone(q)).kpis.totalCost;
    const b = computeQuote(structuredClone({ ...q, equipment: q.equipment.map((e) => ({ ...e, fuelNotApplicable: false })) })).kpis.totalCost;
    assert.equal(a, b);
  });
});

describe('LAB-D5 · "No usa combustible" entre Recursos y la cotización', () => {
  const master = (o = {}) => ({ id: 'eq-1', name: 'Andamio', acquisition: 'owned', replacementValue: 30000000, usefulLifeYears: 8, fuelLitersPerHour: 0, ...o });

  test('la línea copia la marca del recurso (sólo si está marcada)', () => {
    assert.equal(equipmentLineFromLibrary(master({ fuelNotApplicable: true }), { id: 'l1' }).fuelNotApplicable, true);
    assert.equal('fuelNotApplicable' in equipmentLineFromLibrary(master(), { id: 'l2' }), false);
    assert.equal('fuelNotApplicable' in equipmentLineFromLibrary(master({ fuelNotApplicable: false }), { id: 'l3' }), false);
  });

  test('las huellas de las líneas sin marcar no cambian (no aparecen avisos falsos)', () => {
    const line = equipmentLineFromLibrary(master(), { id: 'l1' });
    const values = snapshotValuesFromLine('equipment', line);
    assert.equal('fuelNotApplicable' in values, false);
    assert.equal(economicFingerprint(values), economicFingerprint(snapshotValuesFromLine('equipment', { ...line, fuelNotApplicable: false })));
  });

  test('marcarlo en Recursos avisa a la cotización y "Actualizar" lo aplica; la cotización no cambia sola', () => {
    const line = equipmentLineFromLibrary(master({ fuelLitersPerHour: 4 }), { id: 'l1' });
    const resources = { equipment: [master({ fuelLitersPerHour: 4, fuelNotApplicable: true })] };
    const status = lineSyncStatus('equipment', line, resources);
    assert.equal(status.state, 'changed');
    assert.deepEqual(status.changes, ['fuelNotApplicable']);
    assert.equal('fuelNotApplicable' in line, false, 'la línea sigue igual hasta que la persona elige');
    const updated = applyResourceUpdate('equipment', line, resources);
    assert.equal(updated.fuelNotApplicable, true);
    assert.equal(lineSyncStatus('equipment', updated, resources).state, 'current');
  });
});

describe('LAB-D7 · Precio de combustible ILUSTRATIVO', () => {
  const ownSettings = () => ({ ...defaultSettings('org'), illustrative: false, fuelPricePerLiter: 1720, fuelPriceBase: { period: '2026-10', currency: 'ARS', source: 'supplier', note: '' } });
  // Un equipo que consume combustible a nuestro cargo: la regla de combustible aplica.
  const withFuelUser = (q) => ({ ...q, equipment: [owned({ name: 'Hidrogrúa', fuelLitersPerHour: 12 })] });

  test('cotización real NUEVA con el precio de ejemplo: pide confirmarlo (no cuenta como definido)', () => {
    const q = withFuelUser(createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org') }));
    assert.equal(q.fuel.illustrative, true);
    assert.equal(q.fuel.requiresConfirmation, true);
    const fuel = item(q, 'fuel');
    assert.equal(fuel.status, 'missing');
    assert.equal(fuel.focus, 'fuel.pricePerLiter');
    assert.match(fuel.message, /ILUSTRATIVO/);
    assert.match(fuel.message, /1\.500/);
    assert.match(fuel.message, /Base no definida/);
  });

  test('desde una plantilla de ejemplo, también pide confirmarlo', () => {
    const template = demoServiceTemplates().find((t) => t.defaults && t.defaults.fuel && t.defaults.fuel.pricePerLiter !== undefined);
    assert.ok(template, 'hay una plantilla de ejemplo con precio de combustible');
    const q = createQuoteFromTemplate(template, { organizationId: 'org', settings: ownSettings() });
    assert.equal(q.fuel.illustrative, true);
    assert.equal(q.fuel.requiresConfirmation, true);
  });

  test('con el precio propio de la empresa no hay nada que confirmar', () => {
    const q = withFuelUser(createEmptyQuote({ organizationId: 'org', settings: ownSettings() }));
    assert.equal(q.fuel.illustrative, false);
    assert.equal('requiresConfirmation' in q.fuel, false);
    assert.equal(item(q, 'fuel').status, 'ok');
  });

  test('cotizaciones anteriores (sin el pedido) y la demo siguen igual: aviso, no falta', () => {
    const old = withFuelUser(createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org') }));
    delete old.fuel.requiresConfirmation;
    assert.equal(item(old, 'fuel').status, 'warning');
    const demo = { ...withFuelUser(createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org') })), illustrative: true };
    assert.equal(item(demo, 'fuel').status, 'warning');
  });

  test('confirmado ("Es mi precio vigente") queda definido; el número nunca cambia solo', () => {
    const q = withFuelUser(createEmptyQuote({ organizationId: 'org', settings: defaultSettings('org') }));
    const pending = computeQuote(structuredClone(q)).kpis.totalCost;
    const confirmed = structuredClone(q);
    confirmed.fuel.illustrative = false;
    assert.equal(item(confirmed, 'fuel').status, 'ok');
    assert.equal(computeQuote(confirmed).kpis.totalCost, pending, 'confirmar no cambia el costo');
    assert.equal(confirmed.fuel.pricePerLiter, 1500);
  });
});

describe('LAB-D1 · Menos de 1 salida por mes (semántica explícita, sin cambiar la fórmula)', () => {
  // Fijos 3.000.000, variable 200.000/día, 2 días de trabajo, 4 días por intervención (0,5 por mes),
  // peajes 100.000 por intervención (costo indivisible por salida).
  const quote = ({ days = 2, dpa = 4, full = false, tolls = 100000, serviceType } = {}) => {
    const q = demoReferenceQuote();
    if (serviceType) q.serviceType = serviceType;
    q.otherCosts[0].amount = 3000000;
    q.otherCosts[1].amount = 200000;
    Object.assign(q.activity, { activeDaysPerMonth: days, daysPerActivation: dpa, availableDaysPerMonth: 30, fullActivations: full });
    q.pricingMode = 'known_activity';
    q.pricing = { ...q.pricing, knownRate: 0, targetMarginPct: 0, roundingStep: 0, offeredRateOverride: null };
    q.logistics = { ...q.logistics, notApplicable: tolls === null, distanceKm: 0, tollsPerActivation: tolls ?? 0, lodgingPerActivation: 0, vehicles: [] };
    return q;
  };
  const notice = (r) => r.completeness.notices.find((n) => n.id === 'activations_below_one');

  test('apagada: la frecuencia es un promedio (0,5) y se avisa cuánto sumaría cada salida completa', () => {
    const r = computeQuote(quote());
    assert.equal(r.activationRounding.estimated, 0.5);
    assert.equal(r.activationRounding.costed, 0.5, 'se costea el promedio');
    assert.equal(r.kpis.logisticsMonthly, 50000, '100.000 × 0,5 (la fórmula de siempre)');
    assert.equal(r.activationRounding.preview.wholeActivations, 1);
    assert.equal(r.activationRounding.preview.total, 50000);
    const n = notice(r);
    assert.ok(n, 'aviso informativo de menos de 1 salida por mes');
    assert.equal(n.focus, 'activity.fullActivations');
    assert.match(n.message, /0,5/);
    assert.match(n.message, /\$\s?50\.000/);
    assert.match(n.message, /promedio/);
  });

  test('encendida: los costos indivisibles se costean completos (⌈0,5⌉ = 1), producción y facturación no cambian', () => {
    const off = computeQuote(quote());
    const on = computeQuote(quote({ full: true }));
    assert.equal(on.activationRounding.costed, 1);
    assert.equal(on.activationRounding.total, 50000);
    assert.equal(on.kpis.totalCost - off.kpis.totalCost, 50000);
    assert.equal(on.estimate.revenue.billableUnits, off.estimate.revenue.billableUnits);
    assert.equal(notice(on), undefined, 'elegida la opción, no hay nada que avisar');
  });

  test('sin aviso con 1 o más salidas, o sin costos por salida', () => {
    assert.equal(notice(computeQuote(quote({ days: 4 }))), undefined, 'exactamente 1');
    assert.equal(notice(computeQuote(quote({ days: 6 }))), undefined, '1,5: lo explica el paso, sin aviso extra');
    assert.equal(notice(computeQuote(quote({ tolls: null }))), undefined, 'sin costos por salida el redondeo no cambia nada');
  });

  test('textos: salidas promedio, salidas costeadas y efecto del redondeo, con el nombre del servicio', () => {
    const off = computeQuote(quote({ serviceType: 'transport' }));
    const t = activationRoundingText(off.activationRounding, activationTerms('transport'));
    assert.match(t.text, /Salidas promedio por mes: 0,5/);
    assert.match(t.text, /salidas costeadas: 0,5/);
    assert.match(t.text, /efecto del redondeo: \+\$\s?50\.000/i);
    const on = computeQuote(quote({ full: true, serviceType: 'on_call' }));
    const u = activationRoundingText(on.activationRounding, activationTerms('on_call'));
    assert.match(u.text, /Llamados promedio por mes: 0,5 · llamados costeados: 1/);
    assert.match(u.text, /Efecto del redondeo: \+\$\s?50\.000/);
  });
});

describe('LAB-D2 · La operación pide más horas de cobertura que las cargadas para el puesto (control mensual; nunca se inventan HE, turnos ni convenio)', () => {
  const MSG = 'La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra.';
  // 20 días de trabajo; 176 h normales por mes por persona (RATEOS no tiene un dato de jornada diaria).
  const quote = ({ hours, ppp = 1, overtime = 0, perMonth = null } = {}) => service({
    id: 'd2', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: hours },
    labor: [person({
      role: 'Soldador', positions: 2, peoplePerPosition: ppp, overtimeHoursPerActiveDay: overtime,
      ...(perMonth !== null ? { overtime: [{ label: 'HE 50 %', premiumPct: 50, hours: perMonth, basis: 'per_month' }] } : {}),
    })],
  });
  const check = (q) => item(q, 'labor_hours');

  test('8 h × 20 días = 160 h ≤ 176 h: sin aviso (la regla no aparece y el puntaje no cambia)', () => {
    assert.equal(check(quote({ hours: 8 })), undefined);
  });

  test('12 h con 1 persona por posición: avisa, explica las horas y lleva a la dotación', () => {
    const it = check(quote({ hours: 12 }));
    assert.ok(it, 'hay aviso');
    assert.equal(it.status, 'warning');
    assert.ok(it.message.startsWith(MSG));
    assert.match(it.message, /"Soldador"/);
    assert.match(it.message, /240 h/);
    assert.match(it.message, /176 h/);
    assert.match(it.message, /Faltan 64 h/);
    assert.equal(it.focus, 'labor.0.peoplePerPosition');
    assert.deepEqual(it.targets.map((t) => t.index), [0]);
  });

  test('es un control MENSUAL de cobertura: muestra el cálculo del mes y nunca habla de "jornada" (no hay ese dato)', () => {
    const it = check(quote({ hours: 12 }));
    assert.match(it.message, /20 días × 12 h = 240 h de cobertura por posición en el mes/);
    assert.match(it.message, /lo cargado cubre 176 h \(1 persona × 176 h normales por mes\)/);
    assert.doesNotMatch(it.message, /jornada/i);
    assert.doesNotMatch(check(quote({ hours: 24, ppp: 2 })).message, /jornada/i);
  });

  test('12 h con 2 personas por posición (relevo) o con las horas extra cargadas: sin aviso', () => {
    assert.equal(check(quote({ hours: 12, ppp: 2 })), undefined);
    assert.equal(check(quote({ hours: 12, overtime: 4 })), undefined, '176 + 4 h × 20 días = 256 h ≥ 240 h');
    assert.equal(check(quote({ hours: 12, perMonth: 64 })), undefined, 'HE por mes: 176 + 64 = 240 h');
  });

  test('24 h: hace falta dotación; con 4 personas (704 h) alcanza, con 2 (352 h) no', () => {
    assert.match(check(quote({ hours: 24, ppp: 2 })).message, /Faltan 128 h/);
    assert.equal(check(quote({ hours: 24, ppp: 4 })), undefined);
    assert.equal(check(quote({ hours: 24, ppp: 5 })), undefined);
  });

  test('el aviso nunca cambia el costo: no agrega horas extra ni personas', () => {
    const q = quote({ hours: 12 });
    const r = computeQuote(structuredClone(q));
    const flat = computeQuote(structuredClone({ ...q, activity: { ...q.activity, hoursPerActiveDay: 8 } }));
    assert.equal(r.model.labor.lines[0].variablePerActiveDay, flat.model.labor.lines[0].variablePerActiveDay);
    assert.equal(r.model.labor.fixedMonthly, flat.model.labor.fixedMonthly);
  });
});

describe('LAB-D4 · Km facturables ≠ km de ruta (nunca se deriva uno del otro)', () => {
  // Cobro por km: 2.400 km facturables por mes, 400 km por día de trabajo (6 días, 6 salidas de 1 día).
  // Ruta: 100 km de ida, ida y vuelta, `trips` viajes por salida → 6 × trips × 200 km.
  const quote = ({ billed = 2400, trips = 2 } = {}) => service({
    id: 'd4', serviceType: 'transport', unit: 'km',
    activity: { billableQuantityPerMonth: billed, unitsPerActiveDay: 400, daysPerActivation: 1 },
    labor: [person()],
    equipment: [external({ name: 'Camión', mobilization: { mode: null } }, { price: 3250, unit: 'km', fuelIncluded: true })],
    logistics: { notApplicable: false, baseName: 'Neuquén', destinationName: 'Añelo', distanceKm: 100, roundTrip: true, tripsPerActivation: trips, vehicles: [] },
  });

  test('el resumen tiene los dos números y su relación; los datos cargados no cambian', () => {
    const q = quote();
    const before = structuredClone(q);
    const t = computeQuote(q).model.transport;
    assert.equal(t.billableKmPerMonth, 2400);
    assert.equal(t.routeKmPerMonth, 2400, '6 salidas × 2 viajes × 200 km');
    assert.equal(t.billableToRouteKm, 1);
    assert.deepEqual(q, before, 'no se pisa ningún dato');
  });

  test('"Ver cálculo" muestra km facturables, km de ruta y la relación', () => {
    const t = computeQuote(quote({ trips: 1 })).model.transport;
    const trace = traceTransport(t);
    const labels = [...trace.inputs, ...trace.steps].map((x) => x.label);
    assert.ok(labels.some((l) => /^Km facturables por mes/.test(l)));
    assert.ok(labels.some((l) => /^Km de ruta por mes/.test(l)));
    const ratio = trace.steps.find((x) => /^Km facturables por km de ruta/.test(x.label));
    assert.equal(ratio.value, 2);
    assert.ok(trace.notes.some((n) => /no se deriva/.test(n)));
    assert.ok(trace.notes.some((n) => /quedan cortos/.test(n)), 'facturás más km de los que recorre la ruta');
  });

  test('facturás más km que la ruta: aviso a revisar (los costos por km quedarían cortos); al revés no', () => {
    const over = evaluateCompleteness(quote({ trips: 1 })).items.find((x) => x.id === 'route_consistency');
    assert.equal(over.status, 'warning');
    assert.equal(over.focus, 'logistics.tripsPerActivation');
    assert.equal(evaluateCompleteness(quote({ trips: 3 })).items.find((x) => x.id === 'route_consistency'), undefined, 'vuelta vacía: lo físico manda');
  });

  test('el costo del proveedor por km sigue los km de ruta, no los facturados (no se deriva)', () => {
    const a = computeQuote(quote({ trips: 1 })).model.transport.providers[0];
    const b = computeQuote(quote({ trips: 2 })).model.transport.providers[0];
    assert.equal(a.unitsPerMonth, 1200);
    assert.equal(b.unitsPerMonth, 2400);
  });

  test('con otra unidad (viaje, día) no hay km facturables', () => {
    const q = quote();
    q.unit = 'day';
    q.activity = { ...q.activity, activeDaysPerMonth: 6 };
    assert.equal(computeQuote(q).model.transport.billableKmPerMonth, null);
  });
});

describe('LAB-D3 · Financiación de productos (el mismo motor que las cotizaciones)', () => {
  // Chipá del golden "producto-chipa-costo-y-precio": costo 345, precio con margen 30 % = 492,86.
  const chipa = (finance) => ({
    unitsPerBatch: 60, lossPct: 0, monthlyUnits: 3000,
    materials: [
      { id: 'm1', description: 'Receta', per: 'batch', unit: 'u', quantity: 1, unitCost: 6000 },
      { id: 'm2', description: 'Bolsita', per: 'unit', unit: 'u', quantity: 1, unitCost: 20 },
    ],
    labor: [{ id: 'l1', role: 'Panadero', basicMonthly: 1056000, normalHoursPerMonth: 176, people: 1, minutesPerBatch: 90 }],
    equipment: [{ id: 'e1', name: 'Horno', minutesPerBatch: 40, energyPerHour: 1500, fixedSharePct: 50, insuranceAnnual: 600000 }],
    fixedCosts: [{ id: 'f1', description: 'Alquiler', monthlyAmount: 600000, sharePct: 25 }],
    pricing: { targetMarginPct: 30, roundingStep: 0 },
    ...(finance ? { finance } : {}),
  });
  const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
  // 10 días entre producir y vender + 20 días de cobro − 0 días de pago = 30 días financiados (factor 1).
  const FIN = { invoiceLagDays: 10, paymentTermDays: 20, monthlyRatePct: 3, payDays: { materials: 0, salaries: 0, fuel: 0, suppliers: 0, structure: 0 } };

  test('sin financiación cargada todo queda igual que siempre (golden intacto, sin avisos nuevos)', () => {
    const a = computeProduct(chipa());
    const b = computeProduct(normalizeProductShape(chipa()));
    for (const r of [a, b]) {
      assert.equal(r.unitCost, 345);
      close(r.pricing.suggestedPrice, 492.85714285714283);
      close(r.pricing.breakEvenUnits, 848.7297921478062);
      assert.equal(r.finance.financialPerUnit, 0);
      assert.equal(r.breakdown.length, 5, 'sin fila de financiación');
    }
    assert.deepEqual(b.issues, a.issues);
  });

  test('con plazos y tasa: capital financiado, costo financiero y efecto en el costo y el precio objetivo', () => {
    const r = computeProduct(chipa(FIN));
    const f = r.finance;
    // Caja por unidad: ingredientes 120 + personal 150 + energía 16,67 = 286,67 (× 3 % × 30/30 = 8,60).
    close(f.variablePerUnit, 8.6);
    // Fijos en efectivo: seguro del horno 25.000 + alquiler 150.000 = 175.000 (× 3 % = 5.250 por mes).
    close(f.fixedMonthly, 5250);
    close(f.financialPerUnit, 8.6 + 5250 / 3000);
    close(f.workingCapitalMonthly, 286.6666666666667 * 3000 + 175000);
    close(f.financialMonthly, 31050);
    close(r.unitCost, 355.35);
    close(r.pricing.targetPrice, 355.35 / 0.7);
    close(r.pricing.financeEffect, 355.35 / 0.7 - 345 / 0.7);
    assert.ok(r.breakdown.some((x) => x.key === 'financial' && Math.abs(x.amount - f.financialPerUnit) < 1e-9));
    assert.ok(r.traces.finance, '"Ver cálculo" de la financiación');
    // Alcance: estimación sobre costos netos; el IVA de compras no se modela (no es una simulación completa de caja).
    assert.equal(r.traces.finance.notes[0], 'Estimación financiera sobre costos netos. El IVA de compras no está incluido en este capital de trabajo.');
    // Equilibrio con la financiación fija y variable.
    close(r.pricing.breakEvenUnits, (175000 + 5250) / (r.pricing.suggestedPrice - (286.6666666666667 + 8.6)));
  });

  test('la amortización y el costo de capital no se financian (no son salidas de caja)', () => {
    const base = computeProduct(chipa(FIN)).finance.financialMonthly;
    const p = chipa(FIN);
    p.equipment[0] = { ...p.equipment[0], replacementValue: 12000000, usefulLifeYears: 10, capitalRatePctAnnual: 12 };
    close(computeProduct(p).finance.financialMonthly, base);
  });

  test('pagar más tarde a un proveedor nunca aumenta la financiación; cobrar más tarde nunca la reduce; tasa 0 → 0', () => {
    const at = (o) => computeProduct(chipa({ ...FIN, ...o, payDays: { ...FIN.payDays, ...(o.payDays || {}) } })).finance.financialMonthly;
    const base = at({});
    assert.ok(at({ payDays: { materials: 30 } }) < base);
    close(at({ payDays: { materials: 30 } }), base - 120 * 3000 * 0.03, 1e-6);
    assert.ok(at({ paymentTermDays: 50 }) > base);
    assert.equal(at({ monthlyRatePct: 0 }), 0);
  });

  test('avisos sólo si se empezó a cargar: tasa sin plazo de cobro, o plazos sin tasa (nunca se inventan)', () => {
    const noTerm = computeProduct(chipa({ ...FIN, paymentTermDays: null })).issues.find((i) => i.path === 'finance.paymentTermDays');
    assert.ok(noTerm && noTerm.severity === 'warning');
    const noRate = computeProduct(chipa({ ...FIN, monthlyRatePct: null })).issues.find((i) => i.path === 'finance.monthlyRatePct');
    assert.ok(noRate && noRate.severity === 'warning');
    assert.equal(computeProduct(chipa()).issues.some((i) => /^finance/.test(i.path)), false);
  });

  test('un producto nuevo arranca sin plazos ni tasa (nada inventado)', () => {
    const p = createEmptyProduct({ settings: { financeMonthlyRatePct: 3, defaultPaymentTermDays: 60 } });
    assert.deepEqual(p.finance, { invoiceLagDays: null, paymentTermDays: null, monthlyRatePct: null, payDays: { materials: null, salaries: null, fuel: null, suppliers: null, structure: null } });
  });
});

describe('LAB-D8 · Un nombre por cotización; un servicio permanente usa "intervención" (neutral)', () => {
  test('on-call → llamado · transporte → salida · llave en mano / precio cerrado → trabajo · permanente y el resto → intervención', () => {
    assert.equal(activationTerms('on_call').one, 'llamado');
    assert.equal(activationTerms('transport').one, 'salida');
    assert.equal(activationTerms('turnkey').one, 'trabajo');
    assert.equal(activationTerms('lump_sum').one, 'trabajo');
    assert.equal(activationTerms('permanent').one, 'intervención', 'RATEOS no sabe si cada activación es un relevo o un cambio de turno');
    assert.equal(activationTerms('crew').one, 'intervención');
  });

  test('una cotización permanente nunca dice "cambio de turno" (avisos, notas y "Ver cálculo"); los números no cambian', () => {
    const q = service({
      id: 'd8p', serviceType: 'permanent', unit: 'month', activity: { activeDaysPerMonth: 30, daysPerActivation: 7, hoursPerActiveDay: 8 },
      labor: [person({ role: 'Vigilador', positions: 1, peoplePerPosition: 2 })],
      logistics: { notApplicable: false, distanceKm: 40, roundTrip: true, tripsPerActivation: 1, tollsPerActivation: 5000, lodgingPerActivation: 0, vehicles: [] },
    });
    const r = computeQuote(structuredClone(q));
    const shown = JSON.stringify({ items: r.completeness.items, notices: r.completeness.notices, traces: r.traces });
    assert.doesNotMatch(shown, /cambios? de turno/i);
    assert.match(shown, /intervenci(ón|ones)/);
    const asCrew = computeQuote(structuredClone({ ...q, serviceType: 'crew' }));
    assert.equal(r.kpis.logisticsMonthly, asCrew.kpis.logisticsMonthly, 'sólo cambia el nombre, no la cuenta');
  });
});

describe('LAB-D6 · Reglas reales que CALCULATION_RULES no decía (se documentan, el motor no cambia)', () => {
  test('§4.1 IVA "Parcial" sin % recuperable: 0 % recuperable (todo el IVA es costo) y pendiente rojo', () => {
    const line = (fiscal) => computeExternalLine({ acquisition: 'rented', quantity: 1, external: { price: 1000000, unit: 'month', fiscal } }, { daysPerActivation: 1 });
    const partial = line({ vatPct: 21, vatRecoverable: 'partial', vatRecoverablePct: null });
    const no = line({ vatPct: 21, vatRecoverable: 'no' });
    assert.equal(partial.fixedMonthly, no.fixedMonthly, 'como "No recuperable"');
    assert.equal(partial.fixedMonthly, 1210000);
    const q = service({ id: 'd6a', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()],
      equipment: [external({ name: 'Grúa' }, { price: 1000000, unit: 'month', fiscal: { vatPct: 21, vatRecoverable: 'partial', vatRecoverablePct: null } })] });
    const it = item(q, 'external_terms');
    assert.equal(it.status, 'missing');
    assert.match(it.message, /parte recuperable/);
  });

  test('§6 "Otros costos" con categoría "Equipos y servicios externos": costo directo del grupo de pago Proveedores', () => {
    const base = service({ id: 'd6b', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()] });
    const withOther = { ...structuredClone(base), otherCosts: [otherCost({ description: 'Subcontrato', category: 'external', behavior: 'fixed_monthly', amount: 500000 })] };
    const r0 = computeQuote(structuredClone(base));
    const r1 = computeQuote(withOther);
    const row = (r, c) => r.eecc.rows.find((x) => x.category === c).amount;
    assert.equal(row(r1, 'external') - row(r0, 'external'), 500000);
    const line = r1.model.lines.find((l) => l.source === 'other');
    assert.equal(line.category, 'external');
    assert.equal(line.payGroup, 'suppliers');
  });

  test('§4 Horas por día de una línea de equipo: no se limitan a 24 (la validación marca error y se usa lo cargado)', () => {
    const q = service({ id: 'd6c', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 8 }, labor: [person()],
      equipment: [owned({ name: 'Bomba', hoursPerActiveDay: 30, maintenancePerHour: 1000 })] });
    const r = computeQuote(q);
    assert.equal(r.model.equipment[0].hoursPerActiveDay, 30);
    assert.ok(validateQuote(q).some((e) => e.path === 'equipment.0.hoursPerActiveDay' && e.severity === 'error'));
    // Las de la actividad sí se limitan a 24 (§2).
    const q2 = { ...structuredClone(q), activity: { ...q.activity, hoursPerActiveDay: 30 } };
    assert.equal(computeQuote(q2).activity.hoursPerActiveDay, 24);
  });
});

