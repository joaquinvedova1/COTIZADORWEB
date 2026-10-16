/**
 * CompletenessEngine — Cost Completeness Score.
 *
 * Reglas determinísticas que detectan costos u definiciones faltantes.
 * Cada regla tiene un peso y un estado:
 *   ok      (verde)   → suma el 100 % de su peso
 *   warning (naranja) → suma el 50 % de su peso
 *   missing (rojo)    → suma 0
 *   n/a               → no participa
 *
 *   score % = Σ peso obtenido / Σ peso aplicable × 100
 *
 * Severidad de cada pendiente (PLAN-2026-010; no cambia el puntaje):
 *   critical  falta algo que cambia el costo o el precio (externo sin tarifa,
 *             moneda sin tipo de cambio, actividad o productividad faltante,
 *             tarifa o margen faltantes)
 *   review    revisar antes de usar la tarifa (IVA de externos, fechas base,
 *             contingencia 0, movilización sin definir…)
 * Además, `notices` lleva avisos INFORMATIVOS que no participan del puntaje
 * (por ejemplo, equipo propio sin costo de capital).
 */

import { objectList } from '../core/object.js';
import { nonNegative, toNumber } from '../core/money.js';
import { EQUIPMENT_SERVICE_TYPES, CONTINUOUS_SERVICE_TYPES, SERVICE_TYPES, PRICING_MODES, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { billingUnitOf, unitTexts } from '../domain/billing-units.js';
import { isValidMarginAndTaxes, readMarginInput } from './pricing-engine.js';
import { formatPercent, formatNumber } from '../core/format.js';
import { billingTaxInfo } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { externalFiscal, externalFuelMode } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { contingencyPctOf, normalizeActivity } from './cost-engine.js';
import { routeTrips } from './transport-engine.js';
import { fixedCostShareOf } from '../domain/assignment.js';
import { conversionFactor, currencyOfBase } from './currency-engine.js';
import { isPlainObject } from '../core/object.js';

const STATUS_WEIGHT = { ok: 1, warning: 0.5, missing: 0 };

/** Pendientes que cambian el costo o el precio: se muestran como críticos (PLAN-2026-010 / 012). */
const CRITICAL_RULES = Object.freeze(['equipment_cost', 'external_route', 'currency', 'utilization', 'rate', 'margin']);

/** Debajo de este puntaje la cotización se considera con riesgo (pueden faltar costos). */
export const COMPLETENESS_RISK_THRESHOLD = 60;

/** Colores del puntaje en toda la interfaz: verde ≥ 85, naranja ≥ 60, rojo < 60. */
export const COMPLETENESS_GREEN_THRESHOLD = 85;

/** Tono (green | orange | red) de un puntaje de completitud. */
export function completenessTone(scorePct) {
  if (!Number.isFinite(scorePct)) return 'red';
  if (scorePct >= COMPLETENESS_GREEN_THRESHOLD) return 'green';
  if (scorePct >= COMPLETENESS_RISK_THRESHOLD) return 'orange';
  return 'red';
}

function rule(id, label, step, weight, status, message) {
  return { id, label, step, weight, status, color: status === 'ok' ? 'green' : status === 'warning' ? 'orange' : status === 'missing' ? 'red' : 'gray', message };
}

function isBlank(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
}

/**
 * Evalúa la completitud de una cotización.
 * @param {object} quote
 * @returns {{ scorePct: number, items: object[], pending: object[], counts: {ok:number, warning:number, missing:number} }}
 */
export function evaluateCompleteness(quote = {}) {
  const items = [];
  const serviceType = quote.serviceType;
  const isOnCall = serviceType === 'on_call';
  const activity = quote.activity || {};
  const labor = objectList(quote.labor);
  const equipment = objectList(quote.equipment);
  const materials = objectList(quote.materials);
  const logistics = quote.logistics || {};
  const vehicles = objectList(logistics.vehicles);
  const pricing = quote.pricing || {};
  const rules = quote.rules || {};
  const finance = quote.finance || {};
  const fuel = quote.fuel || {};

  // 1. Modalidad / tipo de servicio
  const validType = SERVICE_TYPES.some((t) => t.id === serviceType);
  const validMode = PRICING_MODES.some((m) => m.id === quote.pricingMode);
  items.push(rule('modality', 'Cómo se cobra', 'modality', 2,
    validType && validMode ? 'ok' : 'missing',
    validType && validMode ? 'Tipo de servicio y modalidad definidos.' : 'Falta definir el tipo de servicio o cómo se cobra (ya tengo la tarifa / calcular la tarifa).'));

  // 2. Tarifa o actividad según modalidad
  if (quote.pricingMode === 'known_rate') {
    const ok = nonNegative(pricing.knownRate) > 0;
    items.push(rule('rate', 'Tarifa ingresada', 'modality', 2, ok ? 'ok' : 'missing', ok ? 'Tarifa definida.' : 'Elegiste "Ya tengo la tarifa" pero falta ingresarla.'));
  }

  // 3. Actividad: por cantidad o evento (m³, viajes, llamados…; PLAN-2026-009) en la unidad comercial.
  const unit = billingUnitOf(quote);
  if (unit.kind === 'quantity' || unit.kind === 'event') {
    const qOk = nonNegative(activity.billableQuantityPerMonth) > 0;
    const yieldOk = unit.kind !== 'quantity' || nonNegative(activity.unitsPerActiveDay) > 0;
    const ok = qOk && yieldOk;
    const texts = unitTexts(unit);
    items.push(rule('utilization', `${unit.plural.charAt(0).toUpperCase()}${unit.plural.slice(1)} por mes`, 'modality', 2,
      ok ? 'ok' : 'missing',
      ok ? `Cantidad por mes definida (${unit.plural}).` : !qOk ? `${texts.quantityQuestion} Falta ese dato.` : `${texts.perDayQuestion} Falta ese dato para calcular los días de trabajo.`));
  } else if (isOnCall || quote.pricingMode === 'known_activity') {
    const ok = nonNegative(activity.activeDaysPerMonth) > 0;
    items.push(rule('utilization', isOnCall ? 'Días de trabajo por mes' : 'Actividad estimada', 'modality', 2,
      ok ? 'ok' : 'missing',
      ok ? 'Días activos estimados por mes definidos.' : '¿Cuántos días del mes esperás que el equipo esté trabajando y facturando? Falta ese dato.'));
  }

  // 4. Personal
  if (serviceType !== 'equipment_only') {
    const ok = labor.some((l) => nonNegative(l.basicMonthly) > 0 && nonNegative(l.positions) > 0);
    items.push(rule('labor', 'Personal', 'labor', 2, ok ? 'ok' : 'missing', ok ? 'Personal cargado.' : 'No hay personal con salario cargado.'));
  }

  // 5. Relevos (cobertura continua)
  const continuous = CONTINUOUS_SERVICE_TYPES.includes(serviceType) && (serviceType === 'permanent' || activity.availability === '24/7');
  if (continuous && labor.length > 0) {
    const ok = labor.every((l) => nonNegative(l.peoplePerPosition, 1) > 1);
    items.push(rule('relief', 'Relevos', 'labor', 1, ok ? 'ok' : 'warning',
      ok ? 'Relevos configurados.' : 'Cobertura 24/7 con una sola persona por posición: revisá relevos, francos y vacaciones.'));
  }

  // 6. Costo de equipos (propios: reposición y vida útil; externos: tarifa)
  const isExt = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';
  const extOf = (e) => (isPlainObject(e.external) ? e.external : {});
  const needsEquipment = EQUIPMENT_SERVICE_TYPES.includes(serviceType);
  if (needsEquipment || equipment.length > 0) {
    // Cuáles líneas están incompletas (PLAN-2026-010): se nombran, nunca se ocultan.
    const ownMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => !isExt(e) && !(nonNegative(e.replacementValue) > 0 && nonNegative(e.usefulLifeYears) > 0));
    const extMissing = equipment.map((e, index) => ({ e, index })).filter(({ e }) => isExt(e) && !(nonNegative(extOf(e).price) > 0));
    const ownOk = ownMissing.length === 0;
    const extOk = extMissing.length === 0;
    const ok = equipment.length > 0 && ownOk && extOk;
    const names = (list, fallback) => list.map(({ e }) => `"${(typeof e.name === 'string' && e.name.trim()) || fallback}"`).join(', ');
    const item = rule('equipment_cost', 'Costo de equipos', 'equipment', 2, ok ? 'ok' : 'missing',
      ok
        ? 'Equipos propios con valor de reposición y vida útil; externos con tarifa.'
        : equipment.length === 0
          ? 'El servicio usa equipos pero no hay equipos cargados.'
          : !ownOk
            ? `Hay equipos propios sin valor de reposición o sin vida útil (falta su amortización): ${names(ownMissing, 'Equipo')}.`
            : `Hay equipos alquilados o tercerizados sin tarifa del proveedor: ${names(extMissing, 'Recurso externo')}. Completá la tarifa o quitá la línea.`);
    item.targets = [...ownMissing, ...extMissing].map(({ e, index }) => ({ list: 'equipment', index, name: (typeof e.name === 'string' && e.name.trim()) || 'Equipo' }));
    items.push(item);
  }

  // Ruta física (PLAN-2026-012): con la unidad "viaje" los viajes por
  // intervención se derivan de los viajes por día (igual que el motor).
  const route = routeTrips(quote, normalizeActivity(quote));
  const oneWayKm = logistics.notApplicable ? 0 : nonNegative(logistics.distanceKm);
  const routeKmPerActivation = oneWayKm * (logistics.roundTrip === false ? 1 : 2) * route.tripsPerActivation;
  const lineName = (e, fallback = 'Equipo') => (typeof e.name === 'string' && e.name.trim()) || fallback;

  // 7. Combustible: sólo lo que consume combustible A TU CARGO (PLAN-2026-012).
  // Un externo con el combustible incluido no necesita consumo; si lo provee
  // el cliente, no hay costo. Cada pendiente lleva al campo exacto (`focus`).
  const fuelUsers = [];
  equipment.forEach((e, i) => {
    if (!isExt(e)) {
      fuelUsers.push({ name: lineName(e), consumes: nonNegative(e.fuelLitersPerHour) > 0, path: `equipment.${i}.fuelLitersPerHour` });
    } else if (extOf(e).fuelIncluded === false) {
      const x = extOf(e);
      const mode = externalFuelMode(x);
      if (mode === 'per_hour') {
        fuelUsers.push({ name: lineName(e, 'Externo'), consumes: nonNegative(x.fuelLitersPerHour) > 0, path: `equipment.${i}.external.fuelLitersPerHour` });
      } else {
        const value = mode === 'per_100km' ? x.fuelLitersPer100Km : x.fuelKmPerLiter;
        const loaded = nonNegative(value) > 0;
        fuelUsers.push({ name: lineName(e, 'Externo'), consumes: loaded && routeKmPerActivation > 0, noRoute: loaded && !(routeKmPerActivation > 0), path: `equipment.${i}.external.${mode === 'per_100km' ? 'fuelLitersPer100Km' : 'fuelKmPerLiter'}` });
      }
    }
    // Movilización por sus propios medios que paga combustible en ruta.
    const m = isPlainObject(e.mobilization) ? e.mobilization : {};
    const includedByProvider = isExt(e) && extOf(e).mobilizationIncluded === true;
    const paysRouteFuel = !isExt(e) || (extOf(e).fuelIncluded === false && externalFuelMode(extOf(e)) === 'per_hour');
    if (!logistics.notApplicable && m.mode === 'self' && !includedByProvider && paysRouteFuel) {
      fuelUsers.push({ name: lineName(e), consumes: nonNegative(m.travelLitersPer100Km) > 0, path: `equipment.${i}.mobilization.travelLitersPer100Km` });
    }
  });
  if (!logistics.notApplicable) {
    vehicles.forEach((v, i) => {
      fuelUsers.push({ name: (typeof v.name === 'string' && v.name.trim()) || 'Vehículo', consumes: nonNegative(v.consumptionLPer100Km) > 0, path: `logistics.vehicles.${i}.consumptionLPer100Km` });
    });
  }
  const hasFuelUsers = equipment.length > 0 || (!logistics.notApplicable && vehicles.length > 0);
  if (hasFuelUsers) {
    let status = 'ok';
    let message = 'Combustible definido.';
    let focus = null;
    if (fuelUsers.length === 0) {
      message = 'No aplica: ningún equipo ni vehículo usa combustible a tu cargo (los externos lo tienen incluido en su tarifa).';
    } else if (!fuel.providedBy) {
      status = 'missing';
      message = 'Combustible sin responsable: definí si lo pagás vos o lo provee el cliente.';
      focus = 'fuel.providedBy';
    } else if (fuel.providedBy === 'client') {
      message = 'Lo provee el cliente: no se suma costo de combustible.';
    } else if (nonNegative(fuel.pricePerLiter) <= 0) {
      status = 'missing';
      message = 'Falta el precio del combustible.';
      focus = 'fuel.pricePerLiter';
    } else if (!fuelUsers.some((u) => u.consumes)) {
      status = 'missing';
      const routeless = fuelUsers.find((u) => u.noRoute);
      if (routeless) {
        message = `Falta la distancia de la ruta: sin km no se calcula el combustible por km de "${routeless.name}".`;
        focus = 'logistics.distanceKm';
      } else {
        const names = [...new Set(fuelUsers.map((u) => `"${u.name}"`))].slice(0, 3).join(', ');
        message = `Falta el consumo de combustible de ${names}: lo pagás vos y sin consumo no suma costo.`;
        focus = fuelUsers[0].path;
      }
    } else if (fuel.illustrative === true) {
      status = 'warning';
      message = 'El precio del combustible es un valor ILUSTRATIVO por defecto: confirmalo con tu precio actual.';
      focus = 'fuel.pricePerLiter';
    }
    // El pendiente se muestra en el paso de su campo (el consumo de un equipo, en Equipos).
    const step = focus && /^equipment\.\d+\.(?!mobilization)/.test(focus) ? 'equipment' : 'logistics';
    const item = rule('fuel', 'Combustible', step, 2, status, message);
    if (focus) item.focus = focus;
    items.push(item);
  }

  // 8. Materiales y responsable
  if (quote.materialsNotApplicable) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'ok', 'Marcado como "el servicio no usa materiales".'));
  } else if (materials.length === 0) {
    items.push(rule('materials', 'Materiales', 'materials', 1, 'warning', 'No hay materiales cargados: confirmá si el servicio no usa materiales.'));
  } else {
    const ok = materials.every((m) => Boolean(m.providedBy));
    items.push(rule('materials', 'Responsable de materiales', 'materials', 2, ok ? 'ok' : 'missing',
      ok ? 'Todos los materiales tienen responsable.' : 'Hay materiales sin definir quién los provee (cliente, nosotros o tercero).'));
  }

  // 9. Logística: ruta + cómo se llega (equipos que se movilizan o vehículos auxiliares)
  if (logistics.notApplicable) {
    items.push(rule('logistics', 'Viajes', 'logistics', 1, 'ok', 'Marcado como "sin traslados".'));
  } else {
    const moves = vehicles.some((v) => nonNegative(v.count) > 0)
      || equipment.some((e) => isPlainObject(e.mobilization) && ['self', 'transported', 'support'].includes(e.mobilization.mode))
      || equipment.some((e) => isExt(e) && extOf(e).mobilizationIncluded === true);
    const ok = nonNegative(logistics.distanceKm) > 0 && moves;
    items.push(rule('logistics', 'Viajes', 'logistics', 2, ok ? 'ok' : 'missing',
      ok ? 'Distancia y movilización definidas.' : nonNegative(logistics.distanceKm) > 0 ? 'Falta definir cómo llegan los equipos o el personal a la locación.' : 'Falta la distancia a la locación.'));
  }

  // 9b. Movilización de cada equipo (¿cómo llega al lugar del servicio?)
  if (!logistics.notApplicable && equipment.length > 0) {
    const mob = computeMobilization(equipment, { notApplicable: false, routeKmPerActivation: nonNegative(logistics.distanceKm), vehicles, labor });
    const pending = equipment.filter((e) => !(isExt(e) && extOf(e).mobilizationIncluded === true) && !(isPlainObject(e.mobilization) && e.mobilization.mode));
    const broken = mob.lines.filter((l) => l.warnings.some((w) => ['carrier_missing', 'carrier_cycle', 'support_missing'].includes(w)));
    const noDriver = mob.lines.filter((l) => l.warnings.includes('driver'));
    const ok = pending.length === 0 && broken.length === 0 && noDriver.length === 0;
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Equipo'}"`).join(', ');
    items.push(rule('mobility', 'Movilización de equipos', 'logistics', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Cada equipo tiene definido cómo llega al lugar del servicio.'
        : pending.length
          ? `Falta definir cómo llega al lugar del servicio: ${names(pending)}.`
          : broken.length
            ? `Revisá qué equipo o vehículo transporta a ${names(broken)}.`
            : `Falta definir quién maneja ${names(noDriver)} en el traslado.`));
  }

  // 9c. Equipos y servicios externos: tratamiento fiscal y vigencia de la oferta
  const externals = equipment.filter(isExt);
  if (externals.length > 0) {
    const offerDay = typeof quote.offerDate === 'string' ? quote.offerDate : null;
    const fiscalMissing = externals.filter((e) => {
      const f = externalFiscal(extOf(e).fiscal);
      return f.missingVatRate || f.missingPartialPct;
    });
    const recoveryUndefined = externals.filter((e) => externalFiscal(extOf(e).fiscal).recovery === null);
    const noValidity = externals.filter((e) => !extOf(e).validUntil);
    const expired = externals.filter((e) => extOf(e).validUntil && offerDay && extOf(e).validUntil < offerDay);
    // Qué incluye la tarifa: sin definir el combustible o el operador no se suma nada (puede faltar costo).
    const inclusionsUndefined = externals.filter((e) => typeof extOf(e).fuelIncluded !== 'boolean' || typeof extOf(e).operatorIncluded !== 'boolean');
    // Global: se reparte en los meses de contrato (sin dato se toma 1 mes).
    const globalNoContract = externals.filter((e) => extOf(e).unit === 'global' && !(nonNegative(quote.contractMonths) >= 1));
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Externo'}"`).join(', ');
    let status = 'ok';
    let message = 'Recursos externos con tratamiento fiscal y vigencia definidos.';
    if (fiscalMissing.length) {
      status = 'missing';
      message = `Falta la alícuota de IVA (o la parte recuperable) de ${names(fiscalMissing)}: sin ese dato no se puede calcular el IVA que no recuperás.`;
    } else if (recoveryUndefined.length) {
      status = 'warning';
      message = `Sin definir si el IVA de ${names(recoveryUndefined)} es recuperable: RATEOS usa el precio neto (sin IVA). Si no lo recuperás, el costo es mayor.`;
    } else if (inclusionsUndefined.length) {
      status = 'warning';
      message = `Sin definir si la tarifa de ${names(inclusionsUndefined)} incluye combustible u operador: si no lo incluye y no lo cargás, falta costo.`;
    } else if (globalNoContract.length) {
      status = 'warning';
      message = `La tarifa global de ${names(globalNoContract)} se reparte en los meses de contrato: cargá la duración del contrato (sin ese dato se toma todo en 1 mes).`;
    } else if (expired.length) {
      status = 'warning';
      message = `La oferta de ${names(expired)} venció antes de la fecha de esta cotización: pedí un precio vigente.`;
    } else if (noValidity.length) {
      status = 'warning';
      message = `Sin vigencia de la oferta del proveedor: ${names(noValidity)}.`;
    }
    items.push(rule('external_terms', 'Equipos y servicios externos', 'equipment', 1, status, message));

    // 9c'. Externo por km o por viaje sin ruta (PLAN-2026-012): CRÍTICO. Su
    // tarifa no se puede calcular (no es un $ 0 válido): nunca pasa en silencio.
    const legs = (logistics.roundTrip === false ? 1 : 2) * route.tripsPerActivation;
    const routeless = externals.filter((e) => {
      const x = extOf(e);
      if (!(x.unit === 'km' || x.unit === 'trip') || nonNegative(x.price) <= 0 || nonNegative(x.minimumUnits) > 0) return false;
      return x.unit === 'km' ? !(routeKmPerActivation > 0) : !(legs > 0);
    });
    if (routeless.length) {
      const routeFocus = logistics.notApplicable
        ? 'logistics.notApplicable'
        : !(oneWayKm > 0)
          ? 'logistics.distanceKm'
          : route.derived ? 'activity.unitsPerActiveDay' : 'logistics.tripsPerActivation';
      const item = rule('external_route', 'Ruta del proveedor', routeFocus.startsWith('activity.') ? 'modality' : 'logistics', 2, 'missing',
        `Falta definir la ruta/distancia para calcular este proveedor: ${names(routeless)} (tarifa por ${extOf(routeless[0]).unit === 'km' ? 'km' : 'viaje'}). ${logistics.notApplicable ? 'Marcaste "Sin traslados".' : !(oneWayKm > 0) ? 'Cargá la distancia de ida en "Movilización y viajes".' : 'No hay viajes en la cotización.'} Hasta entonces no suma costo.`);
      item.focus = routeFocus;
      item.targets = routeless.map((e) => ({ list: 'equipment', index: equipment.indexOf(e), name: lineName(e, 'Externo') }));
      items.push(item);
    }
  }

  // 9d. Posible doble conteo (operador o vehículo cargado dos veces)
  if (equipment.length > 0) {
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const operatorTwice = equipment.filter((e) => isExt(e) && extOf(e).operatorIncluded === true && typeof e.operatorLaborId === 'string' && labor.some((l) => l.id === e.operatorLaborId));
    const selfMoving = equipment.filter((e) => isPlainObject(e.mobilization) && e.mobilization.mode === 'self');
    const vehicleTwice = logistics.notApplicable ? [] : selfMoving.filter((e) => {
      const n = norm(e.name);
      return n.length >= 4 && vehicles.some((v) => {
        const vn = norm(v.name);
        return vn.length >= 4 && (vn.includes(n) || n.includes(vn));
      });
    });
    // Un externo cuya movilización cobra el proveedor aparte y que además "va por sus propios medios".
    const mobilizationTwice = logistics.notApplicable ? [] : selfMoving.filter((e) => isExt(e) && extOf(e).mobilizationIncluded === false && nonNegative(extOf(e).mobilizationAmount) > 0);
    const ok = operatorTwice.length === 0 && vehicleTwice.length === 0 && mobilizationTwice.length === 0;
    items.push(rule('duplicates', 'Costos posiblemente duplicados', 'logistics', 1, ok ? 'ok' : 'warning',
      ok
        ? 'Sin señales de operadores, vehículos o movilizaciones cargados dos veces.'
        : operatorTwice.length
          ? `Operador posiblemente duplicado: la tarifa de "${operatorTwice[0].name || 'Externo'}" ya incluye operador y además le asignaste uno de Personal.`
          : vehicleTwice.length
            ? `Posible doble conteo: "${vehicleTwice[0].name || 'Equipo'}" se moviliza por sus propios medios y también está como vehículo de la logística auxiliar.`
            : `Movilización posiblemente duplicada: el proveedor de "${mobilizationTwice[0].name || 'Externo'}" cobra la movilización aparte y además lo marcaste "por sus propios medios" (se suman km, combustible y desgaste).`));
  }

  // 9e. Base económica (fecha base de los valores) y su antigüedad
  const baseInfo = summarizeEconomicBase(quote);
  if (baseInfo.entries.length > 0) {
    items.push(rule('economic_base', 'Fecha base de los valores', 'service', 1, baseInfo.undefinedCount === 0 ? 'ok' : 'warning',
      baseInfo.undefinedCount === 0
        ? 'Todos los valores tienen fecha base.'
        : `${baseInfo.undefinedCount === 1 ? 'Un valor no tiene' : `${baseInfo.undefinedCount} valores no tienen`} fecha base (${baseInfo.undefinedEntries.slice(0, 3).map((e) => e.label).join(', ')}${baseInfo.undefinedCount > 3 ? '…' : ''}): no se sabe de cuándo son.`));
    if (baseInfo.defined > 0 && !baseInfo.offerPeriod) {
      items.push(rule('base_age', 'Antigüedad de las bases', 'service', 1, 'warning', 'Sin fecha de la oferta: no se puede saber si las bases son viejas. Cargala en "Tipo de servicio".'));
    } else if (baseInfo.defined > 0) {
      const old = baseInfo.stale.length > 0;
      items.push(rule('base_age', 'Antigüedad de las bases', 'service', 1, old || baseInfo.mixed ? 'warning' : 'ok',
        old
          ? (baseInfo.warnings.find((w) => w.id === 'stale') || {}).message
          : baseInfo.mixed
            ? (baseInfo.warnings.find((w) => w.id === 'mixed') || {}).message
            : 'Bases actuales y parejas respecto de la fecha de la oferta.'));
    }
  }

  // 9f. Moneda: un valor en otra moneda necesita el tipo de cambio de la cotización
  const priced = [
    ...equipment.map((e) => ({ name: e.name || 'Equipo', base: e.base, relevant: nonNegative(e.quantity) > 0 && (isExt(e) ? nonNegative(extOf(e).price) > 0 : nonNegative(e.replacementValue) > 0) })),
    ...(quote.materialsNotApplicable ? [] : materials.map((m) => {
      const provider = MATERIAL_PROVIDERS.find((p) => p.id === m.providedBy);
      return { name: m.description || 'Material', base: m.base, relevant: nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0 && !(provider && provider.costForUs === false) };
    })),
  ].filter((x) => x.relevant);
  const foreign = priced.filter((x) => currencyOfBase(x.base) && conversionFactor(currencyOfBase(x.base), quote) !== 1);
  const noRate = foreign.filter((x) => conversionFactor(currencyOfBase(x.base), quote) === null);
  const noCurrency = priced.filter((x) => isPlainObject(x.base) && !currencyOfBase(x.base));
  if (foreign.length > 0 || noCurrency.length > 0) {
    items.push(rule('currency', 'Moneda y tipo de cambio', 'service', 2, noRate.length ? 'missing' : noCurrency.length ? 'warning' : 'ok',
      noRate.length
        ? `Falta el tipo de cambio ${currencyOfBase(noRate[0].base)} de esta cotización: "${noRate[0].name}" no se suma al costo hasta cargarlo.`
        : noCurrency.length
          ? `Sin moneda definida: ${noCurrency.slice(0, 3).map((x) => `"${x.name}"`).join(', ')}.`
          : 'Valores en otra moneda convertidos con el tipo de cambio de la cotización.'));
  }

  // 10. Estructura
  const indirect = quote.indirect || {};
  const itemOk = (it) => (['percent_direct', 'percent_labor'].includes(it.method) ? nonNegative(it.pct) > 0 : nonNegative(it.amount) > 0);
  // Desglosada por rubro (PLAN-2026-010): alcanza con un rubro con valor.
  const indirectOk = indirect.mode === 'detailed' && Array.isArray(indirect.items)
    ? indirect.items.some((it) => it && itemOk(it))
    : itemOk(indirect);
  items.push(rule('structure', 'Gastos de estructura', 'indirect', 1, indirectOk ? 'ok' : 'warning',
    indirectOk ? 'Absorción de estructura definida.' : 'No se absorbe estructura de empresa (administración, base, seguros generales).'));

  // 11. Plazo de pago
  const termOk = !isBlank(finance.paymentTermDays) && Number.isFinite(toNumber(finance.paymentTermDays, NaN));
  items.push(rule('payment_term', 'Plazo de pago', 'finance', 2, termOk ? 'ok' : 'missing',
    termOk ? 'Plazo de cobro definido.' : 'Falta el plazo de cobro para completar el costo financiero: mientras tanto sólo se considera el desfase hasta facturar.'));

  // 12. Contingencia
  const contOk = contingencyPctOf(quote.risk || {}) > 0;
  items.push(rule('contingency', 'Imprevistos (contingencia)', 'risk', 1, contOk ? 'ok' : 'warning',
    contOk ? 'Contingencia configurada.' : 'Sin contingencia: cualquier imprevisto sale del margen.'));

  // 13. Margen (un margen inválido — ≥ 100 %, negativo o texto — no cuenta como
  // definido; tampoco uno que, sumado a los impuestos sobre la facturación, llega a 100 %)
  const taxes = billingTaxInfo(quote);
  // Mismo lector que la validación y el motor (texto es-AR "10,5" incluido).
  const marginRead = readMarginInput(pricing.targetMarginPct);
  const marginBlank = marginRead.state === 'empty';
  const marginValue = marginRead.value;
  const marginInvalid = marginRead.state === 'invalid';
  const marginTooHighWithTaxes = !marginBlank && !marginInvalid && !isValidMarginAndTaxes(marginValue, taxes.pct);
  const marginPositive = !marginBlank && !marginInvalid && marginValue > 0;
  items.push(rule('margin', 'Margen objetivo', 'margin', 2, marginBlank || marginInvalid || marginTooHighWithTaxes ? 'missing' : marginPositive ? 'ok' : 'warning',
    marginBlank
      ? 'Falta definir el margen objetivo.'
      : marginInvalid
        ? 'El margen objetivo debe ser mayor o igual a 0 y menor a 100 %.'
        : marginTooHighWithTaxes
          ? `Con ${formatPercent(taxes.pct)} de impuestos sobre lo que facturás, el margen tiene que ser menor a ${formatPercent(100 - taxes.pct)}.`
          : marginPositive
            ? 'Margen objetivo definido.'
            : 'Margen objetivo en 0 %: cotizás sin ganancia.'));

  // 13b. Impuestos sobre lo que facturás (Ingresos Brutos, débitos y créditos, sellos…)
  items.push(rule('billing_taxes', 'Impuestos sobre lo que facturás', 'margin', 1,
    taxes.invalid ? 'missing' : taxes.defined ? 'ok' : 'warning',
    taxes.invalid
      ? 'Hay un porcentaje de impuestos inválido (negativo, no numérico o un total de 100 % o más): corregilo.'
      : taxes.notApplicable
        ? 'Elegiste no incluir impuestos sobre la facturación en esta cotización.'
        : taxes.defined
          ? 'Impuestos sobre la facturación definidos.'
          : 'Sin definir: la tarifa piso no incluye los impuestos que pagás sobre lo que facturás (Ingresos Brutos, impuesto al cheque, sellos). Cargalos o elegí "No incluir impuestos sobre la facturación en esta cotización".'));

  // 14. Standby (on-call)
  if (isOnCall) {
    const ok = nonNegative(rules.standbyRatePerDay) > 0 || rules.standbyNotApplicable === true;
    items.push(rule('standby', 'Equipo en espera (standby)', 'margin', 1, ok ? 'ok' : 'warning',
      ok ? 'Standby definido.' : '¿Qué cobrás si el equipo queda en locación sin operar? Definilo o marcá que no aplica.'));
  }

  let earned = 0;
  let total = 0;
  const counts = { ok: 0, warning: 0, missing: 0 };
  items.forEach((i) => {
    if (!(i.status in STATUS_WEIGHT)) return;
    total += i.weight;
    earned += i.weight * STATUS_WEIGHT[i.status];
    counts[i.status] += 1;
  });
  const scorePct = total > 0 ? (earned / total) * 100 : 0;
  // Severidad (PLAN-2026-010): crítico si falta algo que cambia el costo o el precio.
  items.forEach((i) => {
    i.severity = i.status === 'ok' || i.status === 'n/a' ? null : CRITICAL_RULES.includes(i.id) && i.status === 'missing' ? 'critical' : 'review';
  });
  const order = { missing: 0, warning: 1, ok: 2 };
  const pending = items.filter((i) => i.status !== 'ok').sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) || order[a.status] - order[b.status]);
  // Informativos: no participan del puntaje ni de los pendientes.
  const notices = [];
  // Unidad "viaje" con un "Viajes por llamado" anterior distinto (PLAN-2026-012).
  if (route.storedDiffers) {
    const fmt = (n) => formatNumber(n, { decimals: 2 });
    notices.push({
      id: 'transport_trips',
      step: 'logistics',
      severity: 'info',
      label: 'Viajes físicos',
      message: `Con la unidad "viaje", los viajes por intervención se calculan con los viajes por día: ${fmt(route.tripsPerActiveDay)} × ${fmt(route.daysPerActivation)} ${route.daysPerActivation === 1 ? 'día' : 'días'} = ${fmt(route.tripsPerActivation)}. El dato anterior de esta cotización (${fmt(route.storedTripsPerActivation)} por llamado) ya no se usa: los km se calculan con los viajes que facturás.`,
    });
  }
  // Recursos compartidos: el resto del costo fijo lo cubre otro servicio.
  const sharedNotice = (line, list, index, fallback) => {
    const share = fixedCostShareOf(line);
    if (!share.shared || share.missing || share.sharePct >= 100) return;
    notices.push({
      id: 'shared_fixed',
      step: list,
      severity: 'info',
      label: list === 'labor' ? 'Personal compartido' : 'Equipo compartido',
      message: `"${(typeof line.role === 'string' && line.role.trim()) || (typeof line.name === 'string' && line.name.trim()) || fallback}" se comparte: esta cotización carga el ${formatPercent(share.sharePct)} de su costo fijo. El ${formatPercent(100 - share.sharePct)} restante lo tiene que cubrir otro servicio o contrato (si no se concreta, queda sin cubrir).`,
      targets: [{ list, index }],
    });
  };
  labor.forEach((l, index) => sharedNotice(l, 'labor', index, 'Personal'));
  equipment.forEach((e, index) => {
    if (!isExt(e)) sharedNotice(e, 'equipment', index, 'Equipo');
  });
  equipment.forEach((e, index) => {
    if (!isExt(e) && nonNegative(e.replacementValue) > 0 && !(nonNegative(e.capitalRatePctAnnual) > 0)) {
      notices.push({
        id: 'capital_cost',
        step: 'equipment',
        severity: 'info',
        label: 'Costo de capital',
        message: `Sin costo de capital en "${(typeof e.name === 'string' && e.name.trim()) || 'Equipo'}": RATEOS no está imputando rendimiento ni costo del dinero invertido en este equipo (es opcional y no es la financiación del contrato).`,
        targets: [{ list: 'equipment', index }],
      });
    }
  });
  return {
    scorePct,
    items,
    pending,
    counts,
    notices,
    critical: pending.filter((i) => i.severity === 'critical').length,
    review: pending.filter((i) => i.severity === 'review').length,
  };
}
