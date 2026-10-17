/**
 * RATEOS Test Lab — SONDAS de contradicción, campos redundantes y cero
 * silencioso (PLAN-2026-013, auditor UX A / C / E).
 *
 * Cada sonda arma una cotización donde dos datos describen realidades
 * incompatibles (o falta un driver obligatorio) y verifica que RATEOS
 * responda: DERIVA uno, ADVIERTE o marca CRÍTICO. Aceptarlo en silencio como
 * una cotización completa es un hallazgo.
 *
 *   expect   'derive' | 'warn' | 'critical'   (respuesta mínima aceptable)
 *   onSilent clasificación si RATEOS no responde
 *   respond(q, r) → { how: 'derive'|'warn'|'critical'|'silent', evidence }
 */

import { service, person, owned, external, material, vehicle } from '../lib/build.js';
import { cot0010Quote, cot0011Quote } from '../../fixtures/cot-0010.js';
import { validateQuote } from '../../../js/core/validation.js';

const route = (o = {}) => ({ notApplicable: false, baseName: 'Neuquén', destinationName: 'Locación', distanceKm: 100, roundTrip: true, tripsPerActivation: 1, vehicles: [], ...o });

/** Respuesta de RATEOS ante un problema: busca pendientes, avisos y errores de validación relacionados. */
function responseOf(q, r, { items = [], messages = [], notices = [], paths = [] } = {}) {
  const pending = r.completeness.pending.filter((p) => items.includes(p.id) || messages.some((re) => re.test(p.message || '')));
  const critical = pending.filter((p) => p.severity === 'critical');
  const notice = (r.completeness.notices || []).filter((n) => notices.includes(n.id) || messages.some((re) => re.test(n.message || '')));
  const issues = [...validateQuote(q), ...r.issues].filter((i) => paths.some((p) => i.path === p || i.path.startsWith(`${p}.`)) || messages.some((re) => re.test(i.message || '')));
  if (critical.length) return { how: 'critical', evidence: critical.map((p) => p.message).join(' | ') };
  if (pending.length || notice.length || issues.length) return { how: 'warn', evidence: [...pending, ...notice, ...issues].map((x) => x.message).join(' | ') };
  return { how: 'silent', evidence: `completitud ${r.completeness.scorePct.toFixed(1)} %, sin avisos relacionados` };
}

export const PROBES = [
  {
    id: 'PRB-01', dimension: 'A', title: 'Unidad "viaje": "Viajes por llamado" guardado (1) ≠ viajes por día × días por intervención (2)',
    expect: 'derive', onSilent: { severity: 'P0', category: 'P0 CONSISTENCY' },
    build: () => cot0011Quote({ tripsPerActivation: 1, code: 'PRB-01' }),
    respond: (q, r) => (Math.abs(r.model.transport.physicalTripsPerMonth - 12) < 1e-9 && (r.completeness.notices || []).some((n) => n.id === 'transport_trips')
      ? { how: 'derive', evidence: `12 viajes físicos derivados + aviso "${r.completeness.notices.find((n) => n.id === 'transport_trips').label}"` }
      : { how: 'silent', evidence: `${r.model.transport.physicalTripsPerMonth} viajes físicos` }),
  },
  {
    id: 'PRB-02', dimension: 'A', title: 'Días de trabajo (35) mayores que los días disponibles del mes (30)',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 UX' },
    build: () => service({ id: 'prb-02', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 35, availableDaysPerMonth: 30 }, labor: [person()] }),
    respond: (q, r) => responseOf(q, r, { paths: ['activity.activeDaysPerMonth'] }),
  },
  {
    id: 'PRB-03', dimension: 'A', title: 'Unidad "km": km facturados (8.000) ≠ km físicos de la ruta (20 salidas × 1 viaje × 200 km = 4.000)',
    expect: 'warn', onSilent: { severity: 'P0', category: 'P0 CONSISTENCY' },
    explain: 'Con la unidad "viaje" los viajes físicos se derivan (v0.7.2). Con la unidad "km" no: un proveedor por km, el combustible por km y la movilización usan los km de la ruta (distancia × viajes por llamado), que pueden ser la mitad de los km que se facturan. Mismo tipo de error que COT-0011 antes de v0.7.2.',
    build: () => service({
      id: 'prb-03', serviceType: 'transport', unit: 'km',
      activity: { billableQuantityPerMonth: 8000, unitsPerActiveDay: 400, daysPerActivation: 1 },
      labor: [person({ role: 'Coordinador', basicMonthly: 2000000 })],
      equipment: [external({ name: 'Camión tercerizado' }, { price: 1100, unit: 'km' })],
      logistics: route({ distanceKm: 100, tripsPerActivation: 1 }),
    }),
    respond: (q, r) => {
      const billed = r.kpis.billableQuantity;
      const physical = r.model.transport.routeKmPerMonth;
      if (Math.abs(billed - physical) <= 1e-6) return { how: 'derive', evidence: `km físicos = facturados (${physical})` };
      return responseOf(q, r, { messages: [/km.*factur|factur.*km/i], paths: ['logistics.tripsPerActivation', 'logistics.distanceKm'] });
    },
  },
  {
    id: 'PRB-04', dimension: 'A', title: '"Sin traslados" marcado y un equipo que "se traslada por sus propios medios"',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 UX' },
    explain: 'Dos datos describen realidades incompatibles: la cotización dice que no hay viajes y el equipo dice que viaja desde la base. El motor toma 0 km (la movilización desaparece) y la regla de movilización no se evalúa con "Sin traslados".',
    build: () => service({
      id: 'prb-04', serviceType: 'equipment_with_operator', unit: 'day',
      activity: { activeDaysPerMonth: 10, daysPerActivation: 1 },
      labor: [person({ id: 'op-prb4' })],
      equipment: [owned({ name: 'Camión grúa', fuelLitersPerHour: 8, operatorLaborId: 'op-prb4', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
      logistics: { notApplicable: true, distanceKm: 120 },
    }),
    respond: (q, r) => responseOf(q, r, { messages: [/sin traslados|propios medios/i] }),
  },
  {
    id: 'PRB-05', dimension: 'A', title: 'Unidad "viaje" (se facturan 20 viajes) con "Sin traslados" y camión propio por sus medios',
    expect: 'warn', onSilent: { severity: 'P0', category: 'P0 CONSISTENCY' },
    explain: 'Se venden viajes pero no se costea ningún km: combustible y desgaste en ruta del camión quedan en $ 0.',
    build: () => service({
      id: 'prb-05', serviceType: 'transport', unit: 'trip',
      activity: { billableQuantityPerMonth: 20, unitsPerActiveDay: 2, daysPerActivation: 1 },
      labor: [person({ id: 'ch-prb5', role: 'Chofer' })],
      equipment: [owned({ name: 'Camión', operatorLaborId: 'ch-prb5', mobilization: { mode: 'self', travelLitersPer100Km: 35, travelCostPerKm: 150, driver: 'operator' } })],
      logistics: { notApplicable: true, distanceKm: 0 },
    }),
    respond: (q, r) => responseOf(q, r, { messages: [/sin traslados|ruta|distancia|viajes/i], items: ['logistics'] }),
  },
  {
    id: 'PRB-06', dimension: 'C', title: 'Externo $/hora con 0 horas por día en su línea: tarifa > 0 y $ 0 en el mes',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => service({
      id: 'prb-06', serviceType: 'equipment_only', unit: 'day',
      activity: { activeDaysPerMonth: 10, daysPerActivation: 1, hoursPerActiveDay: 8 },
      equipment: [external({ name: 'Grúa por hora', hoursPerActiveDay: 0 }, { price: 300000, unit: 'hour' })],
    }),
    respond: (q, r) => responseOf(q, r, { messages: [/Grúa por hora/], paths: ['equipment.0.hoursPerActiveDay'] }),
  },
  {
    id: 'PRB-07', dimension: 'C', title: 'Cobro $/hora con 0 horas por día de trabajo: no hay unidades facturables (tarifa "—")',
    expect: 'critical', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    explain: 'La completitud sólo mira los días de trabajo: con 0 horas por día la tarifa queda sin calcular y la cotización puede estar "completa".',
    build: () => service({ id: 'prb-07', serviceType: 'crew', unit: 'hour', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 0 }, labor: [person()] }),
    respond: (q, r) => responseOf(q, r, { messages: [/horas/i], paths: ['activity.hoursPerActiveDay'] }),
  },
  {
    id: 'PRB-08', dimension: 'E', title: 'Externo con operador incluido y además un operador de Personal asignado (doble conteo)',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => service({
      id: 'prb-08', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person({ id: 'op-prb8' })],
      equipment: [external({ name: 'Grúa con operador', operatorLaborId: 'op-prb8' }, { price: 500000, unit: 'day', operatorIncluded: true })],
    }),
    respond: (q, r) => responseOf(q, r, { items: ['duplicates'] }),
  },
  {
    id: 'PRB-09', dimension: 'E', title: 'Equipo por sus propios medios que también figura como vehículo de la logística auxiliar',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => service({
      id: 'prb-09', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10 },
      labor: [person({ id: 'op-prb9' })],
      equipment: [owned({ name: 'Camioneta Hilux', operatorLaborId: 'op-prb9', mobilization: { mode: 'self', travelLitersPer100Km: 12, travelCostPerKm: 80, driver: 'operator' } })],
      logistics: route({ vehicles: [vehicle({ name: 'Camioneta Hilux' })] }),
    }),
    respond: (q, r) => responseOf(q, r, { items: ['duplicates'] }),
  },
  {
    id: 'PRB-10', dimension: 'E', title: 'Proveedor que cobra la movilización aparte y además el equipo "va por sus propios medios"',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => service({
      id: 'prb-10', serviceType: 'equipment_only', unit: 'day', activity: { activeDaysPerMonth: 10 },
      equipment: [external({ name: 'Retro alquilada', acquisition: 'rented', mobilization: { mode: 'self', travelLitersPer100Km: 30, travelCostPerKm: 100, driver: 'other' } }, { price: 400000, unit: 'day', mobilizationIncluded: false, mobilizationAmount: 250000, fuelIncluded: false, fuelLitersPerHour: 10 })],
      logistics: route(),
    }),
    respond: (q, r) => responseOf(q, r, { items: ['duplicates'] }),
  },
  {
    id: 'PRB-11', dimension: 'C', title: 'Material con costo unitario y cantidad 0 (lo pagamos): suma $ 0',
    expect: 'warn', onSilent: { severity: 'P2', category: 'P2 PRESENTATION' },
    explain: 'Puede ser un material todavía sin cantidad: el costo queda en $ 0 sin aviso.',
    build: () => service({ id: 'prb-11', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Electrodos', basis: 'per_active_day', quantity: 0, unitCost: 18000 })] }),
    respond: (q, r) => responseOf(q, r, { messages: [/Electrodos/], paths: ['materials.0.quantity'] }),
  },
  {
    id: 'PRB-12', dimension: 'C', title: 'Puesto con sueldo y 0 posiciones junto a otro puesto completo: no suma y no avisa',
    expect: 'warn', onSilent: { severity: 'P2', category: 'P2 PRESENTATION' },
    build: () => service({ id: 'prb-12', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ role: 'Oficial' }), person({ role: 'Ayudante', positions: 0, basicMonthly: 1200000 })] }),
    respond: (q, r) => responseOf(q, r, { messages: [/Ayudante/], paths: ['labor.1.positions'] }),
  },
  {
    id: 'PRB-13', dimension: 'A', title: 'Persona "compartida" sin el % asignado',
    expect: 'warn', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => service({ id: 'prb-13', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person({ assignment: 'shared', fixedCostSharePct: null })] }),
    respond: (q, r) => responseOf(q, r, { paths: ['labor.0.fixedCostSharePct'] }),
  },
  {
    id: 'PRB-14', dimension: 'A', title: 'Menos de una intervención por mes (2 días de trabajo con intervenciones de 5 días) y costos por salida prorrateados',
    expect: 'warn', onSilent: { severity: 'HUMAN', category: 'HUMAN DECISION REQUIRED' },
    explain: 'Con 0,4 intervenciones por mes se costea 0,4 de la movilización. "Cada salida se cuenta completa" (PLAN-2026-011) es opcional y apagado: ¿se avisa cuando hay menos de una salida entera?',
    build: () => service({
      id: 'prb-14', serviceType: 'equipment_with_operator', unit: 'day',
      activity: { activeDaysPerMonth: 2, daysPerActivation: 5 },
      labor: [person({ id: 'op-prb14' })],
      equipment: [owned({ name: 'Equipo pesado', operatorLaborId: 'op-prb14', mobilization: { mode: 'self', travelLitersPer100Km: 40, travelCostPerKm: 300, driver: 'operator' } })],
      logistics: route({ distanceKm: 250 }),
    }),
    respond: (q, r) => (r.activationRounding && r.activationRounding.enabled ? { how: 'derive', evidence: 'salidas completas activas' } : responseOf(q, r, { messages: [/salida|intervenci/i] })),
  },
  {
    id: 'PRB-15', dimension: 'A', title: '"No usa materiales" marcado con materiales cargados (se ignoran)',
    expect: 'warn', onSilent: { severity: 'P2', category: 'P2 PRESENTATION' },
    build: () => {
      const q = service({ id: 'prb-15', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], materials: [material({ description: 'Pintura', basis: 'per_month', quantity: 10, unitCost: 20000 })] });
      q.materialsNotApplicable = true;
      return q;
    },
    respond: (q, r) => responseOf(q, r, { notices: ['materials_ignored'], messages: [/Pintura|materiales? cargados?/i] }),
  },
  {
    id: 'PRB-16', dimension: 'A', title: '12 horas de trabajo por día con personal de jornada normal y sin horas extra',
    expect: 'warn', onSilent: { severity: 'HUMAN', category: 'HUMAN DECISION REQUIRED' },
    explain: 'Las horas por día de la actividad mueven equipos y facturación por hora, pero no el costo del personal: 12 h diarias con 176 h normales por mes y 0 horas extra se cotizan como jornada normal. ¿Turnos/relevos u horas extra? Hay dos modelos válidos.',
    build: () => service({ id: 'prb-16', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 20, hoursPerActiveDay: 12 }, labor: [person({ positions: 2, overtimeHoursPerActiveDay: 0 })] }),
    respond: (q, r) => responseOf(q, r, { messages: [/horas extra|jornada/i] }),
  },
  {
    id: 'PRB-17', dimension: 'C', title: 'Equipo propio con mantenimiento y consumo por hora pero 0 horas por día en su línea',
    expect: 'warn', onSilent: { severity: 'P2', category: 'P2 PRESENTATION' },
    build: () => service({ id: 'prb-17', serviceType: 'equipment_with_operator', unit: 'day', activity: { activeDaysPerMonth: 10, hoursPerActiveDay: 9 }, labor: [person()], equipment: [owned({ name: 'Excavadora', hoursPerActiveDay: 0, maintenancePerHour: 9000, fuelLitersPerHour: 15 })] }),
    respond: (q, r) => responseOf(q, r, { messages: [/Excavadora/], paths: ['equipment.0.hoursPerActiveDay'] }),
  },
  {
    id: 'PRB-18', dimension: 'C', title: 'Proveedor $/km sin distancia (crítico desde v0.7.2)',
    expect: 'critical', onSilent: { severity: 'P0', category: 'P0 CONSISTENCY' },
    build: () => { const q = cot0010Quote({ code: 'PRB-18' }); q.logistics.distanceKm = 0; return q; },
    respond: (q, r) => responseOf(q, r, { items: ['external_route'] }),
  },
  {
    id: 'PRB-20', dimension: 'D', title: 'Equipo propio que no usa combustible (andamio): RATEOS pide su consumo y no hay forma de decir "no usa"',
    expect: 'derive', onSilent: { severity: 'HUMAN', category: 'HUMAN DECISION REQUIRED' },
    explain: 'El consumo de un equipo propio se pide siempre (0 se lee como "falta"): la completitud no llega a 100 % sin cargar un consumo falso. Un dato nuevo ("No usa combustible") o leer 0 como "no usa" son dos modelos válidos.',
    build: () => service({ id: 'prb-20', serviceType: 'crew', unit: 'day', activity: { activeDaysPerMonth: 10 }, labor: [person()], equipment: [owned({ name: 'Andamio multidireccional', replacementValue: 30000000, usefulLifeYears: 8 })] }),
    respond: (q, r) => {
      const f = r.completeness.items.find((x) => x.id === 'fuel');
      return !f || f.status === 'ok' ? { how: 'derive', evidence: f ? f.message : 'sin regla de combustible' } : { how: 'warn', evidence: `${f.status}: ${f.message}` };
    },
  },
  {
    id: 'PRB-19', dimension: 'D', title: 'Combustible incluido en la tarifa: no se pide consumo (v0.7.2)',
    expect: 'derive', onSilent: { severity: 'P1', category: 'P1 COMPLETENESS' },
    build: () => cot0010Quote({ code: 'PRB-19' }),
    respond: (q, r) => {
      const f = r.completeness.items.find((x) => x.id === 'fuel');
      return f && f.status === 'ok' && /^No aplica/.test(f.message) ? { how: 'derive', evidence: f.message } : { how: 'silent', evidence: f ? `${f.status}: ${f.message}` : 'sin regla de combustible' };
    },
  },
];
