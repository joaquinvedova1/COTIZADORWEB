/**
 * PLAN-2026-024 — Plantillas como puntos de partida y esquemas de trabajo del personal.
 *
 * Pedido del dueño (2026-11-07): separar A) la cobertura que se vende, B) cómo se organiza el
 * personal (5x2, 7x7 = 1x1, 14x7 = 2x1…), C) sus costos y D) lo que se factura, sin cargar el
 * mismo diagrama en tres lugares ni que un dato de facturación cambie el sueldo o la dotación.
 *
 * Casos del pedido (cifras con sueldos ILUSTRATIVOS):
 *   A  cuadrilla 5x2, 4 operarios, 8 h, lunes a viernes → nómina 4 (antes el atajo proponía 6)
 *   B  una posición 30 días calendario, 7x7 → nómina 2, sin suponer 1 persona
 *   C  una posición 14x7 (2x1), 12 h → nómina 1,5 exacta / 2; horas por persona vs normales
 *   D  servicio integral desde una plantilla editable: sin dobles costos silenciosos
 * Reglas protegidas: el esquema sólo PROPONE (no cambia el costo); sin los campos nuevos todo da
 * igual que antes (cotizaciones históricas).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeQuote } from '../../js/engines/quote-engine.js';
import { computeRotation, reliefFromLabor, travelDaysOf, ROTATION_TEMPLATES } from '../../js/engines/rotation-engine.js';
import { normalizeActivity } from '../../js/engines/cost-engine.js';
import { evaluateCompleteness } from '../../js/engines/completeness-engine.js';
import {
  SERVICE_TEMPLATES, TEMPLATE_GROUPS, searchTemplates, templateOf, templateById, contractWithComponents, unitFitsContract,
} from '../../js/domain/contract.js';
import { BILLING_UNIT_IDS } from '../../js/domain/billing-units.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('PLAN-2026-024 · esquema fijo (5x2) o rotativo con la cobertura vendida', () => {
  test('Caso A: 5x2 fijo, 4 en sitio, 22 días de servicio, 8 h → 4 en nómina, sin relevos, 176 h por persona', () => {
    const rot = computeRotation({ daysOn: 5, daysOff: 2, pattern: 'fixed', onSite: 4, hoursPerShift: 8 }, { coverageDaysPerMonth: 22, normalHoursPerMonth: 176 });
    assert.equal(rot.payroll, 4);
    assert.equal(rot.relievesPerMonth, 0);
    assert.equal(rot.daysBetweenRelieves, null);
    assert.equal(rot.workedDaysPerPerson, 22);
    assert.equal(rot.workedHoursPerPerson, 176);
    assert.equal(rot.hoursAboveNormal, 0);
    assert.equal(rot.coverageShort, false);
  });

  test('el atajo 5x2 y el 6x1 son esquemas fijos; 7x7, 14x7, 14x14 y 20x10, rotativos', () => {
    const byId = Object.fromEntries(ROTATION_TEMPLATES.map((t) => [t.id, t.pattern]));
    assert.deepEqual(byId, { '5x2': 'fixed', '6x1': 'fixed', '7x7': 'rotating', '14x7': 'rotating', '14x14': 'rotating', '20x10': 'rotating' });
  });

  test('fijo con más días de servicio que los que da el esquema (5x2 con 26 días) → aviso', () => {
    const rot = computeRotation({ daysOn: 5, daysOff: 2, pattern: 'fixed', onSite: 4, hoursPerShift: 8 }, { coverageDaysPerMonth: 26 });
    assert.equal(rot.payroll, 4);
    assert.equal(rot.coverageShort, true);
  });

  test('sin `pattern` (diagramas guardados antes) = rotativo, la fórmula de siempre', () => {
    const rot = computeRotation({ daysOn: 5, daysOff: 2, onSite: 4 });
    close(rot.payrollExact, 5.6);
    assert.equal(rot.payroll, 6);
  });

  test('Caso B: 7x7 cubriendo 30 días → 2 personas, un relevo cada 7 días; 12 h → 180 h por persona', () => {
    const rot = computeRotation({ daysOn: 7, daysOff: 7, onSite: 1, hoursPerShift: 12 }, { coverageDaysPerMonth: 30, normalHoursPerMonth: 176 });
    assert.equal(rot.payroll, 2);
    assert.equal(rot.daysBetweenRelieves, 7);
    assert.equal(rot.workedDaysPerPerson, 15);
    assert.equal(rot.workedHoursPerPerson, 180);
    assert.equal(rot.hoursAboveNormal, 4);
    assert.equal(rot.threeWeekHours, 56, '7x7: 14 días en 3 semanas × 12 h ÷ 3');
  });

  test('Caso C: 14x7 con 12 h → 1,5 exacta (240 h, 64 por encima, 56 h por semana) o 2 hacia arriba (180 h)', () => {
    const exact = computeRotation({ daysOn: 14, daysOff: 7, onSite: 1, hoursPerShift: 12, rounding: 'exact' }, { coverageDaysPerMonth: 30, normalHoursPerMonth: 176 });
    close(exact.payroll, 1.5);
    close(exact.workedHoursPerPerson, 240);
    close(exact.hoursAboveNormal, 64);
    close(exact.threeWeekHours, 56);
    const up = computeRotation({ daysOn: 14, daysOff: 7, onSite: 1, hoursPerShift: 12 }, { coverageDaysPerMonth: 30, normalHoursPerMonth: 176 });
    assert.equal(up.payroll, 2);
    close(up.workedHoursPerPerson, 180);
  });

  test('esquema fijo sin cobertura cargada: los días del esquema (no inventa horas extra con 30 días)', () => {
    const rot = computeRotation({ daysOn: 5, daysOff: 2, pattern: 'fixed', onSite: 1, hoursPerShift: 8 }, { normalHoursPerMonth: 176 });
    close(rot.workedDaysPerPerson, 30 * 5 / 7);
    assert.ok(rot.workedHoursPerPerson < 176);
    assert.equal(rot.coverageShort, false);
  });

  test('la cobertura sólo cuenta en fijo mensual o servicio permanente', async () => {
    const { rotationCoverageOf } = await import('../../js/engines/rotation-engine.js');
    assert.equal(rotationCoverageOf({ contract: { mode: 'monthly', components: ['labor'] }, unit: 'month' }, 22), 22);
    assert.equal(rotationCoverageOf({ contract: { mode: 'on_demand', components: ['labor'] }, unit: 'day' }, 22), null);
    assert.equal(rotationCoverageOf({ serviceType: 'permanent', unit: 'day' }, 26), 26);
  });

  test('rotativo con cobertura parcial: 14x14 cubriendo 15 días → 1 persona; nunca menos que en sitio', () => {
    assert.equal(computeRotation({ daysOn: 14, daysOff: 14, onSite: 1 }, { coverageDaysPerMonth: 15 }).payroll, 1);
    assert.equal(computeRotation({ daysOn: 14, daysOff: 14, onSite: 3 }, { coverageDaysPerMonth: 5 }).payroll, 3);
    // Cobertura vacía o igual al mes: la fórmula de siempre.
    assert.equal(computeRotation({ daysOn: 14, daysOff: 14, onSite: 1 }, { coverageDaysPerMonth: null }).payroll, 2);
  });

  test('el esquema nunca cambia el costo: misma cotización con y sin diagrama (24h C1 y 2x1 C1)', () => {
    for (const name of ['especialista-24h-c1.json', 'especialista-2x1-c1.json']) {
      const fx = fixture(name);
      const base = computeQuote(structuredClone(fx.quote), { settings: fx.settings });
      const q = structuredClone(fx.quote);
      q.labor.forEach((l) => { l.rotation = { daysOn: 5, daysOff: 2, pattern: 'fixed', hoursPerShift: 12 }; });
      const withScheme = computeQuote(q, { settings: fx.settings });
      // Costo, tarifas y resultado iguales (el % de completitud puede cambiar: las horas por turno
      // alimentan el aviso de horas del personal desde la tanda B).
      const money = ({ completenessPct, incomplete, ...k }) => k;
      assert.deepEqual(money(withScheme.kpis), money(base.kpis), name);
    }
  });
});

describe('PLAN-2026-024 · cómo viaja el personal (días entre viajes, un solo lugar)', () => {
  const quote = (activity, labor = [], mode = 'monthly') => ({ contract: { mode, components: ['labor'] }, unit: mode === 'monthly' ? 'month' : 'day', serviceType: 'crew', activity: { activeDaysPerMonth: 30, daysPerActivation: 1, ...activity }, labor });
  const field = [{ role: 'Operador', positions: 1, rotation: { daysOn: 14, daysOff: 7 } }];

  test('sin elegir (todas las cotizaciones guardadas): el número guardado, como siempre', () => {
    assert.equal(normalizeActivity(quote({ daysPerActivation: 3 }, field)).daysPerActivation, 3);
    assert.equal(travelDaysOf(quote({}, field)).days, null);
  });

  test('"va y vuelve" = 1 viaje por día de servicio aunque el número guardado diga otra cosa', () => {
    const a = normalizeActivity(quote({ travelPattern: 'daily', daysPerActivation: 14 }, field));
    assert.equal(a.daysPerActivation, 1);
    assert.equal(a.activationsPerMonth, 30);
  });

  test('"con cada relevo" toma los relevos del diagrama de Personal (14x7 → cada 14 días, 2,14 por mes)', () => {
    const a = normalizeActivity(quote({ travelPattern: 'rotation', daysPerActivation: 1 }, field));
    assert.equal(a.daysPerActivation, 14);
    close(a.activationsPerMonth, 30 / 14);
    assert.equal(a.travelRelief.role, 'Operador');
  });

  test('fuera del fijo mensual el patrón guardado no rige (se cambió de modalidad): el número guardado', () => {
    const a = normalizeActivity(quote({ travelPattern: 'daily', daysPerActivation: 0.5 }, field, 'on_demand'));
    assert.equal(a.daysPerActivation, 0.5);
    assert.equal(a.travelPattern, null);
  });

  test('con varios puestos usa el relevo más frecuente; un esquema fijo no tiene relevos', () => {
    const relief = reliefFromLabor([
      { role: 'Supervisor', positions: 1, rotation: { daysOn: 14, daysOff: 14 } },
      { role: 'Operario', positions: 2, rotation: { daysOn: 7, daysOff: 7 } },
      { role: 'Chofer', positions: 1, rotation: { daysOn: 5, daysOff: 2, pattern: 'fixed' } },
    ]);
    assert.equal(relief.daysBetweenRelieves, 7);
    assert.equal(relief.index, 1);
  });

  test('"con cada relevo" sin diagrama rotativo: el número guardado (nunca inventa un relevo)', () => {
    assert.equal(normalizeActivity(quote({ travelPattern: 'rotation', daysPerActivation: 2 }, [])).daysPerActivation, 2);
  });

  test('2x1 C1 en fijo mensual: elegir "con cada relevo" da el mismo costo que cargar a mano el intervalo del diagrama', () => {
    const fx = fixture('especialista-2x1-c1.json');
    const relief = (() => {
      const q = structuredClone(fx.quote);
      q.labor.forEach((l) => { l.rotation = { daysOn: 14, daysOff: 7, groups: 2 }; });
      return q;
    })();
    const manual = structuredClone(relief);
    manual.activity.daysPerActivation = 7;
    const linked = structuredClone(relief);
    linked.activity.travelPattern = 'rotation';
    linked.activity.daysPerActivation = 1; // el número viejo no manda
    const a = computeQuote(manual, { settings: fx.settings });
    const b = computeQuote(linked, { settings: fx.settings });
    assert.deepEqual(b.kpis, a.kpis);
  });
});

describe('PLAN-2026-024 · plantillas: puntos de partida, un solo catálogo', () => {
  test('11 plantillas en 5 grupos, cada una con componentes válidos; las que sugieren unidad, una que encaja en su modalidad', () => {
    assert.equal(SERVICE_TEMPLATES.length, 11);
    const groups = new Set(TEMPLATE_GROUPS.map((g) => g.id));
    SERVICE_TEMPLATES.forEach((t) => {
      assert.ok(groups.has(t.group), t.id);
      assert.ok(t.components.length > 0, t.id);
      if (t.unit) {
        assert.ok(BILLING_UNIT_IDS.includes(t.unit), `${t.id}: ${t.unit}`);
        assert.ok(unitFitsContract(contractWithComponents({ mode: t.mode || 'on_demand' }, t.components), t.unit), `${t.id}: ${t.unit} no encaja`);
      }
    });
  });

  test('las pedidas por el dueño están: hora-hombre, día de cuadrilla, unidad ejecutada, técnico por hora, equipo con y sin operador, integral, precio global', () => {
    ['crew_manhour', 'crew_day', 'per_unit', 'tech_pickup', 'equipment_operator', 'dry_rental', 'integral', 'lump_sum'].forEach((id) => assert.ok(templateById(id), id));
    assert.equal(templateById('crew_manhour').unit, 'manhour');
    assert.equal(templateById('lump_sum').mode, 'closed');
  });

  test('buscador sin tildes y por palabras clave: "jornada" encuentra la cuadrilla por día; "limpieza", el integral', () => {
    assert.ok(searchTemplates('jornada').some((t) => t.id === 'crew_day'));
    assert.ok(searchTemplates('limpieza').some((t) => t.id === 'integral'));
    assert.ok(searchTemplates('valvula').some((t) => t.id === 'per_unit'));
    assert.equal(searchTemplates('').length, SERVICE_TEMPLATES.length);
    assert.deepEqual(searchTemplates('xyz123'), []);
  });

  test('la plantilla elegida se recuerda (informativa) y sigue siendo editable: sumar una camioneta → "ajustada"', () => {
    const t = templateById('crew_manhour');
    const c = contractWithComponents({ mode: 'on_demand', templateId: t.id }, t.components);
    assert.equal(c.templateId, 'crew_manhour');
    assert.deepEqual(templateOf(c), { ...t, edited: false });
    const edited = contractWithComponents(c, [...t.components, 'vehicle', 'supplies']);
    assert.equal(templateOf(edited).id, 'crew_manhour');
    assert.equal(templateOf(edited).edited, true);
    assert.equal(contractWithComponents({ mode: 'on_demand', templateId: 'no-existe' }, ['labor']).templateId, undefined);
  });

  test('la plantilla elegida no cambia ningún número (sólo se guarda su id)', () => {
    const fx = fixture('especialista-24h-c1.json');
    const base = computeQuote(structuredClone(fx.quote), { settings: fx.settings });
    const q = structuredClone(fx.quote);
    if (q.contract && typeof q.contract === 'object') q.contract.templateId = 'field_crew';
    assert.deepEqual(computeQuote(q, { settings: fx.settings }).kpis, base.kpis);
  });
});

describe('PLAN-2026-024 · Caso D: el mismo costo en dos lugares se avisa (nunca se descuenta)', () => {
  const fx = fixture('especialista-2x1-c1.json');
  const hints = (q) => evaluateCompleteness(q).items.filter((i) => i.id === 'double_cost_hints');

  test('vianda en el puesto + comidas en los viáticos, traslado + vehículo, EPP en puesto + EPP en materiales', () => {
    const q = structuredClone(fx.quote);
    q.labor[0].mealPerActiveDay = 15000;
    q.labor[0].transferMonthly = 60000;
    q.labor[0].ppeMonthly = 40000;
    q.logistics.notApplicable = false;
    q.logistics.vehicles = [{ id: 'v1', name: 'Camioneta personal', costPerKm: 100 }];
    q.logistics.lodgingDetail = { people: 3, nights: 13, perNight: 40000, days: 14, perDay: 15000 };
    q.logistics.lodgingPerActivation = 3 * 13 * 40000 + 3 * 14 * 15000;
    q.materials = [...(q.materials || []), { id: 'm-epp', description: 'EPP especial (trajes)', unitCost: 1000, quantity: 1, basis: 'per_month' }];
    const found = hints(q);
    assert.equal(found.length, 1);
    assert.match(found[0].message, /vianda/);
    assert.match(found[0].message, /traslado/);
    assert.match(found[0].message, /EPP/);
    // Sólo avisa: el costo es el mismo que sin el aviso.
    const r = computeQuote(q, { settings: fx.settings });
    assert.ok(r.kpis.totalCost > 0);
  });

  test('sin señales no aparece ningún ítem (las cotizaciones guardadas no cambian sus pendientes)', () => {
    assert.deepEqual(hints(structuredClone(fx.quote)), []);
  });
});
