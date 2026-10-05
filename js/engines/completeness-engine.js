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
 */

import { objectList } from '../core/object.js';
import { nonNegative, toNumber } from '../core/money.js';
import { EQUIPMENT_SERVICE_TYPES, CONTINUOUS_SERVICE_TYPES, SERVICE_TYPES, PRICING_MODES, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { contingencyPctOf } from './cost-engine.js';
import { isValidMarginAndTaxes, readMarginInput } from './pricing-engine.js';
import { formatPercent } from '../core/format.js';
import { billingTaxInfo } from './billing-taxes-engine.js';
import { summarizeEconomicBase } from './economic-base-engine.js';
import { externalFiscal } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { conversionFactor, currencyOfBase } from './currency-engine.js';
import { isPlainObject } from '../core/object.js';

const STATUS_WEIGHT = { ok: 1, warning: 0.5, missing: 0 };

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

  // 3. Utilización on-call
  if (isOnCall || quote.pricingMode === 'known_activity') {
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
    const ownOk = equipment.filter((e) => !isExt(e)).every((e) => nonNegative(e.replacementValue) > 0 && nonNegative(e.usefulLifeYears) > 0);
    const extOk = equipment.filter(isExt).every((e) => nonNegative(extOf(e).price) > 0);
    const ok = equipment.length > 0 && ownOk && extOk;
    items.push(rule('equipment_cost', 'Costo de equipos', 'equipment', 2, ok ? 'ok' : 'missing',
      ok
        ? 'Equipos propios con valor de reposición y vida útil; externos con tarifa.'
        : equipment.length === 0
          ? 'El servicio usa equipos pero no hay equipos cargados.'
          : !ownOk
            ? 'Hay equipos propios sin valor de reposición o sin vida útil (falta su amortización).'
            : 'Hay equipos alquilados o tercerizados sin tarifa del proveedor.'));
  }

  // 7. Combustible
  const consumesFuel = equipment.some((e) => nonNegative(e.fuelLitersPerHour) > 0)
    || equipment.some((e) => isExt(e) && extOf(e).fuelIncluded === false && nonNegative(extOf(e).fuelLitersPerHour) > 0)
    || equipment.some((e) => isPlainObject(e.mobilization) && e.mobilization.mode === 'self' && nonNegative(e.mobilization.travelLitersPer100Km) > 0)
    || (!logistics.notApplicable && vehicles.some((v) => nonNegative(v.consumptionLPer100Km) > 0));
  const hasFuelUsers = equipment.length > 0 || (!logistics.notApplicable && vehicles.length > 0);
  if (hasFuelUsers) {
    let status = 'ok';
    let message = 'Combustible definido.';
    if (!fuel.providedBy) {
      status = 'missing';
      message = 'Combustible sin responsable: definí si lo pagás vos o lo provee el cliente.';
    } else if (fuel.providedBy !== 'client' && (nonNegative(fuel.pricePerLiter) <= 0 || !consumesFuel)) {
      status = 'missing';
      message = nonNegative(fuel.pricePerLiter) <= 0 ? 'Falta el precio del combustible.' : 'Falta el consumo de combustible de equipos o vehículos.';
    } else if (fuel.providedBy !== 'client' && fuel.illustrative === true) {
      status = 'warning';
      message = 'El precio del combustible es un valor ILUSTRATIVO por defecto: confirmalo con tu precio actual.';
    }
    items.push(rule('fuel', 'Combustible', 'logistics', 2, status, message));
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
    // Por km o por viaje sin km / viajes en la cotización (y sin mínimo): la tarifa queda en 0.
    const routeKm = logistics.notApplicable ? 0 : nonNegative(logistics.distanceKm);
    const noUnits = externals.filter((e) => {
      const x = extOf(e);
      if (nonNegative(x.price) <= 0 || nonNegative(x.minimumUnits) > 0) return false;
      if (x.unit === 'km') return routeKm <= 0;
      if (x.unit === 'trip') return Boolean(logistics.notApplicable);
      return false;
    });
    // Global: se reparte en los meses de contrato (sin dato se toma 1 mes).
    const globalNoContract = externals.filter((e) => extOf(e).unit === 'global' && !(nonNegative(quote.contractMonths) >= 1));
    const names = (list) => list.slice(0, 3).map((x) => `"${x.name || 'Externo'}"`).join(', ');
    let status = 'ok';
    let message = 'Recursos externos con tratamiento fiscal y vigencia definidos.';
    if (fiscalMissing.length) {
      status = 'missing';
      message = `Falta la alícuota de IVA (o la parte recuperable) de ${names(fiscalMissing)}: sin ese dato no se puede calcular el IVA que no recuperás.`;
    } else if (noUnits.length) {
      status = 'missing';
      message = `La tarifa de ${names(noUnits)} es por km o por viaje y esta cotización no tiene km ni viajes: no suma costo. Cargá la distancia y los viajes en "Movilización y viajes" o un mínimo.`;
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
  const indirectOk = ['percent_direct', 'percent_labor'].includes(indirect.method) ? nonNegative(indirect.pct) > 0 : nonNegative(indirect.amount) > 0;
  items.push(rule('structure', 'Gastos de estructura', 'indirect', 1, indirectOk ? 'ok' : 'warning',
    indirectOk ? 'Absorción de estructura definida.' : 'No se absorbe estructura de empresa (administración, base, seguros generales).'));

  // 11. Plazo de pago
  const termOk = !isBlank(finance.paymentTermDays) && Number.isFinite(toNumber(finance.paymentTermDays, NaN));
  items.push(rule('payment_term', 'Plazo de pago', 'finance', 2, termOk ? 'ok' : 'missing',
    termOk ? 'Plazo de cobro definido.' : 'Plazo de pago sin definir: no se puede calcular el costo financiero.'));

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
  const order = { missing: 0, warning: 1, ok: 2 };
  const pending = items.filter((i) => i.status !== 'ok').sort((a, b) => order[a.status] - order[b.status]);
  return { scorePct, items, pending, counts };
}
