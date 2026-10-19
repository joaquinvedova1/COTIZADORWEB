/**
 * CostEngine — arma la estructura de costos de una cotización.
 *
 * Toda la economía del servicio se expresa como:
 *
 *   Costo(D) = F × factorMeses(D) + v × D
 *
 *   F = costos fijos mensuales (existen aunque no haya actividad)
 *   v = costos variables por día activo
 *   D = días activos (facturables) en el mes
 *   factorMeses(D) = max(1, D / díasDisponiblesMes)  (sólo > 1 si D supera
 *                    los días disponibles: se interpreta como trabajo de
 *                    varios meses y se prorratean los fijos)
 *
 * Orden de cálculo:
 *   1. Costos directos (personal, standby, equipos propios, equipos y
 *      servicios externos, combustible, materiales, movilización, logística
 *      auxiliar, otros)
 *   2. Estructura (costos indirectos) según método de absorción
 *   3. Financiero (sobre costos en efectivo: directos + estructura)
 *   4. Contingencia = % × (directos + estructura + financiero)
 *
 * "Cada salida se cuenta completa" (PLAN-2026-011, opcional, apagado por
 * defecto): las intervenciones estimadas A = D / días por intervención siguen
 * siendo un promedio (producción y facturación no cambian), pero los costos
 * físicamente indivisibles POR SALIDA (movilización, peajes, viáticos,
 * vehículos de apoyo, cargos de proveedor por llamado / viaje / km o con
 * mínimo por llamado, materiales y otros costos por llamado) se costean con
 * ⌈A⌉ salidas:
 *   ajuste(D) = (⌈A⌉ − A) × costo discreto por salida
 *               (+ su estructura si es %, su financiación y su contingencia)
 * Apagado (o con A entero) el costo es exactamente el de siempre.
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide, roundPercentagesToTotal, roundPercentage, toNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { COST_CATEGORIES, CATEGORY_PAY_GROUP, DIRECT_CATEGORY_IDS, PAY_GROUPS, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { computeLabor } from './labor-engine.js';
import { computeEquipmentLine } from './equipment-engine.js';
import { computeLogistics } from './logistics-engine.js';
import { computeMaterials, computeOtherCostLine } from './materials-engine.js';
import { computeFinance, financingDaysOf } from './finance-engine.js';
import { computeExternalLine } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { routeTrips, transportSummary } from './transport-engine.js';
import { conversionFactor, currencyOfBase, quoteCurrency } from './currency-engine.js';
import { billingUnitOf } from '../domain/billing-units.js';
import { activationTerms } from '../domain/activation-terms.js';
import { formatMoney, formatNumber } from '../core/format.js';

/**
 * Días de trabajo que lleva facturar una cantidad (PLAN-2026-009). UNIDAD DE
 * VENTA ≠ UNIDAD DE COSTO: los costos se calculan con los días de trabajo y
 * la facturación se expresa en la unidad comercial.
 *
 *   por cantidad (m³, viaje…): llamados = cantidad / max(días por llamado × cantidad por día, mínimo por llamado)
 *                              días     = llamados × días por llamado      (sin mínimo: cantidad / cantidad por día)
 *   por evento (llamado, trabajo, hito): llamados = cantidad / hitos por trabajo (1 si no es por hito)
 *                              días     = llamados × días por llamado (o por trabajo)
 */
export function activeDaysForQuantity({ kind, quantity, unitsPerActiveDay, unitsPerActivation, daysPerActivation, minimumCallUnits = 0 }) {
  const Q = nonNegative(quantity);
  const dpa = nonNegative(daysPerActivation) > 0 ? nonNegative(daysPerActivation) : 1;
  if (kind === 'event') {
    const upa = nonNegative(unitsPerActivation) > 0 ? nonNegative(unitsPerActivation) : 1;
    return (Q / upa) * dpa;
  }
  const perActivation = Math.max(dpa * nonNegative(unitsPerActiveDay), nonNegative(minimumCallUnits));
  return perActivation > 0 ? (Q / perActivation) * dpa : 0;
}

/** Normaliza los parámetros de actividad de una cotización. */
export function normalizeActivity(quote = {}) {
  const a = quote.activity || {};
  const availableRaw = Math.min(nonNegative(a.availableDaysPerMonth, 30), 31);
  // 0 o inválido no tiene sentido económico: se usa 30 (y validateQuote lo informa).
  const availableDaysPerMonth = availableRaw > 0 ? availableRaw : 30;
  const dpaRaw = nonNegative(a.daysPerActivation, 1);
  const daysPerActivation = dpaRaw > 0 ? dpaRaw : 1;
  const hoursPerActiveDay = Math.min(nonNegative(a.hoursPerActiveDay), 24);
  // Por día, hora o mes la actividad se carga en días (como siempre). Por
  // cantidad o por evento se carga en la unidad comercial y los días de
  // trabajo se derivan (PLAN-2026-009).
  const unit = billingUnitOf(quote);
  const byQuantity = unit.kind === 'quantity' || unit.kind === 'event';
  const billableQuantityPerMonth = byQuantity ? nonNegative(a.billableQuantityPerMonth) : null;
  const unitsPerActiveDay = unit.kind === 'quantity' ? nonNegative(a.unitsPerActiveDay) : null;
  const unitsPerActivation = unit.kind === 'event' ? (unit.id === 'milestone' && nonNegative(a.unitsPerActivation) > 0 ? nonNegative(a.unitsPerActivation) : 1) : null;
  const activeDaysPerMonth = byQuantity
    ? activeDaysForQuantity({
      kind: unit.kind,
      quantity: billableQuantityPerMonth,
      unitsPerActiveDay,
      unitsPerActivation,
      daysPerActivation,
      minimumCallUnits: quote.rules ? quote.rules.minimumCallUnits : 0,
    })
    : nonNegative(a.activeDaysPerMonth);
  return {
    unitKind: unit.kind,
    billableQuantityPerMonth,
    unitsPerActiveDay,
    unitsPerActivation,
    availability: a.availability || '24/7',
    availabilityWindow: a.availabilityWindow || '',
    responseTimeHours: nonNegative(a.responseTimeHours),
    availableDaysPerMonth,
    activeDaysPerMonth,
    daysPerActivation,
    hoursPerActiveDay,
    activationsPerMonth: activeDaysPerMonth / daysPerActivation,
    utilizationPct: availableDaysPerMonth > 0 ? (activeDaysPerMonth / availableDaysPerMonth) * 100 : null,
    // PLAN-2026-011: cada salida se cuenta completa (sólo los costos por salida).
    fullActivations: a.fullActivations === true,
  };
}

/** Porcentaje total de contingencia (general + ítems de riesgo habilitados). */
export function contingencyPctOf(risk = {}) {
  const general = nonNegative(risk.generalPct);
  const items = objectList(risk.items)
    .filter((i) => i && i.enabled)
    .reduce((s, i) => s + nonNegative(i.pct), 0);
  return general + items;
}

function emptyBucket() {
  return { fixedMonthly: 0, variablePerActiveDay: 0 };
}

function addTo(bucket, fixed, variable) {
  bucket.fixedMonthly += fixed;
  bucket.variablePerActiveDay += variable;
}

/**
 * Construye el modelo de costos completo.
 * @param {object} quote
 * @returns {object} costModel
 */
export function buildCostModel(quote = {}) {
  const activity = normalizeActivity(quote);
  const fuelPaidByUs = (quote.fuel && quote.fuel.providedBy) !== 'client';
  const fuelPricePerLiter = nonNegative(quote.fuel && quote.fuel.pricePerLiter);
  const lines = [];

  // 1. Personal
  const labor = computeLabor(quote.labor);
  labor.lines.forEach((l, i) => {
    lines.push({
      key: `labor:${l.id ?? i}`,
      source: 'labor',
      label: l.role || 'Personal',
      category: 'labor',
      payGroup: 'salaries',
      fixedMonthly: l.fixedMonthly,
      variablePerActiveDay: l.variablePerActiveDay,
      cashFixedMonthly: l.fixedMonthly,
      cashVariablePerActiveDay: l.variablePerActiveDay,
    });
  });

  // Standby: días en locación sin operar. Se costea el variable de personal
  // (vianda + horas extra) de cada día de standby. Es un monto mensual estimado.
  const rules = quote.rules || {};
  const standbyDays = rules.standbyNotApplicable === true ? 0 : nonNegative(rules.standbyDaysPerMonth);
  const standbyCostPerDay = labor.variablePerActiveDay;
  const standbyMonthly = standbyDays * standbyCostPerDay;
  if (standbyMonthly > 0) {
    lines.push({
      key: 'labor:standby',
      source: 'standby',
      label: 'Standby (personal en locación sin operar)',
      category: 'labor',
      payGroup: 'salaries',
      fixedMonthly: standbyMonthly,
      variablePerActiveDay: 0,
      cashFixedMonthly: standbyMonthly,
      cashVariablePerActiveDay: 0,
    });
  }

  // Moneda (PLAN-2026-005): los valores en otra moneda se convierten con el
  // tipo de cambio de la cotización; si falta, no se suman (factor 0) y la
  // validación lo marca en rojo.
  const currency = quoteCurrency(quote);
  const currencyGaps = [];
  // Sólo es un faltante si el valor nos cuesta algo (un material que provee el
  // cliente o un precio en 0 no necesitan tipo de cambio).
  const factorFor = (base, where, relevant = true) => {
    const cur = currencyOfBase(base);
    const f = conversionFactor(cur, quote);
    if (f === null) {
      if (relevant) currencyGaps.push({ ...where, currency: cur });
      return 0;
    }
    return f;
  };

  // Logística (ruta): la usan la movilización y las tarifas externas por km o
  // viaje. Con la unidad "viaje" los viajes físicos por intervención se derivan
  // de los viajes por día (PLAN-2026-012): "Viajes por llamado" no rige.
  const route = routeTrips(quote, activity);
  const logisticsInput = route.derived ? { ...(quote.logistics || {}), tripsPerActivation: route.tripsPerActivation } : quote.logistics || {};
  const logistics = computeLogistics(logisticsInput, {
    activationsPerMonth: activity.activationsPerMonth,
    daysPerActivation: activity.daysPerActivation,
    fuelPricePerLiter,
    fuelPaidByUs,
  });
  const oneWayTripsPerActivation = logistics.notApplicable ? 0 : logistics.tripsPerActivation * (logistics.roundTrip ? 2 : 1);

  // 2. Equipos. PROPIOS: posesión → fijo, operación → variable, combustible
  // aparte. ALQUILADOS / TERCERIZADOS: costo externo (tarifa del proveedor,
  // costo económico sin IVA recuperable). model.equipment queda alineado con
  // quote.equipment (mismo índice).
  const equipmentInput = objectList(quote.equipment);
  const external = [];
  const equipment = equipmentInput.map((e, index) => {
    const acquisition = e.acquisition === 'rented' || e.acquisition === 'outsourced' ? e.acquisition : 'owned';
    if (acquisition === 'owned') {
      const f = factorFor(e.base, { list: 'equipment', index, field: 'base', label: e.name || 'Equipo' }, nonNegative(e.quantity) > 0 && (nonNegative(e.replacementValue) > 0 || nonNegative(e.residualValue) > 0));
      const converted = f === 1 ? e : { ...e, replacementValue: nonNegative(e.replacementValue) * f, residualValue: nonNegative(e.residualValue) * f };
      return { ...computeEquipmentLine(converted, { fuelPricePerLiter, fuelPaidByUs, defaultHoursPerActiveDay: activity.hoursPerActiveDay }), acquisition, conversion: f, external: null };
    }
    const ext = e.external && typeof e.external === 'object' ? e.external : {};
    const f = factorFor(e.base, { list: 'equipment', index, field: 'base', label: e.name || 'Equipo externo' }, nonNegative(e.quantity) > 0 && (nonNegative(ext.price) > 0 || (ext.mobilizationIncluded === false && nonNegative(ext.mobilizationAmount) > 0)));
    const x = computeExternalLine({ ...e, acquisition }, {
      daysPerActivation: activity.daysPerActivation,
      defaultHoursPerActiveDay: activity.hoursPerActiveDay,
      routeKmPerActivation: logistics.routeKmPerActivation,
      tripsPerActivation: oneWayTripsPerActivation,
      // Viajes completos de la ruta (ECO-01): para un proveedor que cobra por viaje ida y vuelta.
      fullTripsPerActivation: logistics.notApplicable ? 0 : logistics.tripsPerActivation,
      contractMonths: quote.contractMonths,
      fuelPricePerLiter,
      fuelPaidByUs,
      conversion: f,
    });
    external.push({ ...x, index });
    return {
      id: x.id,
      name: x.name,
      acquisition,
      quantity: x.quantity,
      hoursPerActiveDay: x.hoursPerActiveDay,
      conversion: f,
      ownership: null,
      operation: null,
      external: x,
      fixedMonthly: x.fixedMonthly,
      fixedCashMonthly: x.fixedMonthly,
      nonFuelPerActiveDay: x.variablePerActiveDay + x.mobilizationPerActiveDay,
      fuelPerActiveDay: x.fuelPerActiveDay,
      fuelLitersPerActiveDay: x.fuelLitersPerActiveDay,
      variablePerActiveDay: x.variablePerActiveDay + x.mobilizationPerActiveDay + x.fuelPerActiveDay,
    };
  });
  equipment.forEach((e, i) => {
    const name = e.name || 'Equipo';
    if (e.acquisition !== 'owned') {
      const x = e.external;
      const kind = e.acquisition === 'rented' ? 'alquilado' : 'tercerizado';
      // Plazo de pago propio de este proveedor (PLAN-2026-011): vacío = el de "Proveedores".
      const ownTerm = optionalNumber((equipmentInput[i] || {}).supplierPayDays);
      const finance = ownTerm !== null && ownTerm >= 0 ? { key: `supplier:${e.id ?? i}`, label: name, payDays: ownTerm, index: i } : null;
      lines.push({
        key: `external:${e.id ?? i}`,
        source: 'external',
        label: `${name} — ${kind}`,
        category: 'external',
        payGroup: 'suppliers',
        fixedMonthly: x.fixedMonthly,
        variablePerActiveDay: x.variablePerActiveDay,
        // Se financia la SALIDA DE CAJA (neto + IVA + percepciones + cargos), no
        // el costo económico: el IVA recuperable y las percepciones son caja que
        // la empresa adelanta al proveedor hasta cobrar. Sin tratamiento fiscal
        // definido, caja = costo (como siempre).
        cashFixedMonthly: x.cashFixedMonthly,
        cashVariablePerActiveDay: x.cashVariablePerActiveDay,
        discretePerActivation: x.discretePerActivation,
        cashDiscretePerActivation: x.cashDiscretePerActivation,
        finance,
      });
      if (x.mobilizationPerActiveDay > 0) {
        lines.push({
          key: `external:mobilization:${e.id ?? i}`,
          source: 'external',
          label: `${name} — movilización del proveedor`,
          category: 'external',
          payGroup: 'suppliers',
          fixedMonthly: 0,
          variablePerActiveDay: x.mobilizationPerActiveDay,
          cashFixedMonthly: 0,
          cashVariablePerActiveDay: x.cashMobilizationPerActiveDay,
          discretePerActivation: x.mobilizationPerActivation,
          cashDiscretePerActivation: x.cashMobilizationPerActivation,
          finance,
        });
      }
      if (x.fuelPerActiveDay > 0) {
        lines.push({
          key: `external:fuel:${e.id ?? i}`,
          source: 'external',
          label: `${name} — combustible (no incluido en la tarifa)`,
          category: 'fuel',
          payGroup: 'fuel',
          fixedMonthly: 0,
          variablePerActiveDay: x.fuelPerActiveDay,
          cashFixedMonthly: 0,
          cashVariablePerActiveDay: x.fuelPerActiveDay,
          // Por km de ruta (PLAN-2026-012) es un costo por salida; por hora, no.
          discretePerActivation: x.fuelPerActivationRoute,
          cashDiscretePerActivation: x.fuelPerActivationRoute,
        });
      }
      return;
    }
    lines.push({
      key: `equipment:ownership:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — posesión`,
      category: 'equipment',
      payGroup: 'suppliers',
      fixedMonthly: e.fixedMonthly,
      variablePerActiveDay: 0,
      cashFixedMonthly: e.fixedCashMonthly,
      cashVariablePerActiveDay: 0,
    });
    lines.push({
      key: `equipment:operation:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — operación (mant. y neumáticos)`,
      category: 'equipment',
      payGroup: 'suppliers',
      fixedMonthly: 0,
      variablePerActiveDay: e.nonFuelPerActiveDay,
      cashFixedMonthly: 0,
      cashVariablePerActiveDay: e.nonFuelPerActiveDay,
    });
    lines.push({
      key: `equipment:fuel:${e.id ?? i}`,
      source: 'equipment',
      label: `${name} — combustible operativo`,
      category: 'fuel',
      payGroup: 'fuel',
      fixedMonthly: 0,
      variablePerActiveDay: e.fuelPerActiveDay,
      cashFixedMonthly: 0,
      cashVariablePerActiveDay: e.fuelPerActiveDay,
    });
  });

  // Movilización del recurso principal (¿cómo llega cada equipo?): combustible
  // en ruta → Combustible; desgaste por km → Logística. Sin amortización (ya
  // está en la posesión) y sin mano de obra (el operador ya está en Personal).
  const mobilization = computeMobilization(equipmentInput, {
    notApplicable: logistics.notApplicable,
    routeKmPerActivation: logistics.routeKmPerActivation,
    daysPerActivation: activity.daysPerActivation,
    activationsPerMonth: activity.activationsPerMonth,
    fuelPricePerLiter,
    fuelPaidByUs,
    vehicles: (quote.logistics || {}).vehicles,
    labor: quote.labor,
  });
  lines.push({
    key: 'mobilization:fuel',
    source: 'mobilization',
    label: 'Movilización de equipos — combustible en ruta',
    category: 'fuel',
    payGroup: 'fuel',
    fixedMonthly: 0,
    variablePerActiveDay: mobilization.fuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: mobilization.fuelPerActiveDay,
    discretePerActivation: mobilization.fuelPerActivation,
    cashDiscretePerActivation: mobilization.fuelPerActivation,
  });
  lines.push({
    key: 'mobilization:other',
    source: 'mobilization',
    label: 'Movilización de equipos — desgaste por km',
    category: 'logistics',
    payGroup: 'suppliers',
    fixedMonthly: 0,
    variablePerActiveDay: mobilization.wearPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: mobilization.wearPerActiveDay,
    discretePerActivation: mobilization.wearPerActivation,
    cashDiscretePerActivation: mobilization.wearPerActivation,
  });

  // 3. Logística AUXILIAR (vehículos de apoyo y de personal): combustible →
  // Combustible; desgaste, peajes y viáticos → Logística.
  lines.push({
    key: 'logistics:fuel',
    source: 'logistics',
    label: 'Traslados — combustible',
    category: 'fuel',
    payGroup: 'fuel',
    fixedMonthly: 0,
    variablePerActiveDay: logistics.fuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: logistics.fuelPerActiveDay,
    discretePerActivation: logistics.fuelPerActivation,
    cashDiscretePerActivation: logistics.fuelPerActivation,
  });
  lines.push({
    key: 'logistics:other',
    source: 'logistics',
    label: 'Traslados — desgaste, peajes y viáticos',
    category: 'logistics',
    payGroup: 'suppliers',
    fixedMonthly: 0,
    variablePerActiveDay: logistics.nonFuelPerActiveDay,
    cashFixedMonthly: 0,
    cashVariablePerActiveDay: logistics.nonFuelPerActiveDay,
    discretePerActivation: logistics.nonFuelPerActivation,
    cashDiscretePerActivation: logistics.nonFuelPerActivation,
  });

  // 4. Materiales
  const materialInput = quote.materialsNotApplicable ? [] : objectList(quote.materials).map((m, index) => {
    const provider = MATERIAL_PROVIDERS.find((p) => p.id === m.providedBy);
    const costsUs = !(provider && provider.costForUs === false) && nonNegative(m.unitCost) > 0 && nonNegative(m.quantity) > 0;
    const f = factorFor(m.base, { list: 'materials', index, field: 'base', label: m.description || 'Material' }, costsUs);
    return f === 1 ? m : { ...m, unitCost: nonNegative(m.unitCost) * f };
  });
  const materials = computeMaterials(materialInput, {
    daysPerActivation: activity.daysPerActivation,
  });
  materials.lines.forEach((m, i) => {
    lines.push({
      key: `materials:${m.id ?? i}`,
      source: 'materials',
      label: m.description || 'Material',
      category: 'materials',
      payGroup: 'materials',
      fixedMonthly: m.fixedMonthly,
      variablePerActiveDay: m.variablePerActiveDay,
      cashFixedMonthly: m.fixedMonthly,
      cashVariablePerActiveDay: m.variablePerActiveDay,
      discretePerActivation: m.basis === 'per_activation' ? m.costForUs : 0,
      cashDiscretePerActivation: m.basis === 'per_activation' ? m.costForUs : 0,
    });
  });

  // 5. Otros costos (terceros, subcontratos, manuales)
  const otherCosts = objectList(quote.otherCosts).map((o) =>
    computeOtherCostLine(o, { daysPerActivation: activity.daysPerActivation }),
  );
  otherCosts.forEach((o, i) => {
    const category = DIRECT_CATEGORY_IDS.includes(o.category) ? o.category : 'materials';
    lines.push({
      key: `other:${o.id ?? i}`,
      source: 'other',
      label: o.description || 'Otro costo',
      category,
      payGroup: CATEGORY_PAY_GROUP[category] || 'suppliers',
      fixedMonthly: o.fixedMonthly,
      variablePerActiveDay: o.variablePerActiveDay,
      cashFixedMonthly: o.fixedMonthly,
      cashVariablePerActiveDay: o.variablePerActiveDay,
      discretePerActivation: o.behavior === 'per_activation' ? o.amount : 0,
      cashDiscretePerActivation: o.behavior === 'per_activation' ? o.amount : 0,
    });
  });

  // Base directa (excluye lo cargado manualmente como "estructura")
  const direct = emptyBucket();
  const laborBucket = emptyBucket();
  lines.forEach((l) => {
    if (l.category !== 'structure') addTo(direct, l.fixedMonthly, l.variablePerActiveDay);
    if (l.category === 'labor') addTo(laborBucket, l.fixedMonthly, l.variablePerActiveDay);
  });

  // 6. Estructura (indirectos). Modo simple (el de siempre): un método para
  // toda la estructura. Modo desglosado (PLAN-2026-010, opcional): cada rubro
  // con su propio método (administración % directo, HSE por empleado…).
  const indirect = quote.indirect || {};
  const method = indirect.method || 'percent_direct';
  const indirectPct = nonNegative(indirect.pct);
  const indirectAmount = nonNegative(indirect.amount);
  const structureBy = (m, pctValue, amount) => {
    switch (m) {
      case 'percent_direct':
        return { fixed: direct.fixedMonthly * pct(pctValue), variable: direct.variablePerActiveDay * pct(pctValue) };
      case 'percent_labor':
        return { fixed: laborBucket.fixedMonthly * pct(pctValue), variable: laborBucket.variablePerActiveDay * pct(pctValue) };
      case 'per_employee':
        // Dotación equivalente: una persona compartida cuenta por su % asignado (PLAN-2026-012).
        return { fixed: amount * labor.effectiveHeadcount, variable: 0 };
      case 'per_hour':
        return { fixed: 0, variable: amount * activity.hoursPerActiveDay };
      case 'per_contract':
      case 'manual':
      default:
        return { fixed: amount, variable: 0 };
    }
  };
  const detailed = indirect.mode === 'detailed' && Array.isArray(indirect.items);
  const structureItems = detailed
    ? objectList(indirect.items).map((it, idx) => {
      const m = typeof it.method === 'string' && it.method ? it.method : 'percent_direct';
      const value = structureBy(m, nonNegative(it.pct), nonNegative(it.amount));
      return { id: it.id ?? `item-${idx}`, label: typeof it.label === 'string' && it.label.trim() ? it.label.trim() : 'Rubro de estructura', method: m, pct: nonNegative(it.pct), amount: nonNegative(it.amount), fixedMonthly: value.fixed, variablePerActiveDay: value.variable };
    })
    : [];
  const simple = detailed ? null : structureBy(method, indirectPct, indirectAmount);
  const structureFixed = detailed ? structureItems.reduce((acc, it) => acc + it.fixedMonthly, 0) : simple.fixed;
  const structureVariable = detailed ? structureItems.reduce((acc, it) => acc + it.variablePerActiveDay, 0) : simple.variable;
  lines.push({
    key: 'structure:absorption',
    source: 'structure',
    label: 'Estructura de empresa (absorción)',
    category: 'structure',
    payGroup: 'structure',
    fixedMonthly: structureFixed,
    variablePerActiveDay: structureVariable,
    cashFixedMonthly: structureFixed,
    cashVariablePerActiveDay: structureVariable,
  });

  // 7. Financiero. Un externo con plazo de pago propio se financia aparte
  // (PLAN-2026-011); sin plazo propio, en su grupo como siempre.
  const cashByGroup = Object.fromEntries(PAY_GROUPS.map((g) => [g.id, emptyBucket()]));
  const supplierTerms = new Map();
  lines.forEach((l) => {
    if (l.finance) {
      if (!supplierTerms.has(l.finance.key)) supplierTerms.set(l.finance.key, { ...l.finance, fixedMonthly: 0, variablePerActiveDay: 0 });
      addTo(supplierTerms.get(l.finance.key), l.cashFixedMonthly, l.cashVariablePerActiveDay);
      return;
    }
    addTo(cashByGroup[l.payGroup] || cashByGroup.suppliers, l.cashFixedMonthly, l.cashVariablePerActiveDay);
  });
  const finance = computeFinance(cashByGroup, quote.finance || {}, { suppliers: [...supplierTerms.values()] });

  // 8. Contingencia
  const preContingency = emptyBucket();
  lines.forEach((l) => addTo(preContingency, l.fixedMonthly, l.variablePerActiveDay));
  addTo(preContingency, finance.fixedMonthly, finance.variablePerActiveDay);
  const contingencyPct = contingencyPctOf(quote.risk || {});
  const contingency = {
    pct: contingencyPct,
    fixedMonthly: preContingency.fixedMonthly * pct(contingencyPct),
    variablePerActiveDay: preContingency.variablePerActiveDay * pct(contingencyPct),
  };

  // Totales por categoría (EECC)
  const byCategory = Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, emptyBucket()]));
  lines.forEach((l) => addTo(byCategory[l.category], l.fixedMonthly, l.variablePerActiveDay));
  addTo(byCategory.financial, finance.fixedMonthly, finance.variablePerActiveDay);
  addTo(byCategory.contingency, contingency.fixedMonthly, contingency.variablePerActiveDay);

  const total = emptyBucket();
  Object.values(byCategory).forEach((b) => addTo(total, b.fixedMonthly, b.variablePerActiveDay));

  // "Cada salida se cuenta completa" (PLAN-2026-011): costo de UNA salida
  // completa de lo físicamente indivisible, con su estructura (sólo la que es
  // %), su financiación y su contingencia. Se calcula siempre (para mostrar
  // cuánto sumaría) y sólo se aplica si la opción está activa.
  const perActivation = (() => {
    const byCat = Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, 0]));
    const cashByKey = {};
    const bySource = {};
    let direct = 0;
    let laborDirect = 0;
    lines.forEach((l) => {
      const amount = nonNegative(l.discretePerActivation);
      const cash = nonNegative(l.cashDiscretePerActivation);
      if (!(amount > 0) && !(cash > 0)) return;
      byCat[l.category] += amount;
      bySource[l.source] = (bySource[l.source] || 0) + amount;
      if (l.category !== 'structure') direct += amount;
      if (l.category === 'labor') laborDirect += amount;
      const key = l.finance ? l.finance.key : PAY_GROUPS.some((g) => g.id === l.payGroup) ? l.payGroup : 'suppliers';
      cashByKey[key] = (cashByKey[key] || 0) + cash;
    });
    // Estructura: sólo la parte que es un % del costo (la mensual fija no cambia).
    const structurePart = (m, pctValue) => (m === 'percent_direct' ? direct * pct(pctValue) : m === 'percent_labor' ? laborDirect * pct(pctValue) : 0);
    const structure = detailed
      ? structureItems.reduce((acc, it) => acc + structurePart(it.method, it.pct), 0)
      : structurePart(method, indirectPct);
    byCat.structure += structure;
    cashByKey.structure = (cashByKey.structure || 0) + structure;
    const rate = pct(finance.monthlyRatePct);
    let financial = 0;
    let workingCapital = 0;
    Object.entries(cashByKey).forEach(([key, cash]) => {
      const days = financingDaysOf(finance, key);
      workingCapital += cash * (days / 30);
      financial += cash * rate * (days / 30);
    });
    byCat.financial += financial;
    const preCont = COST_CATEGORIES.filter((c) => c.id !== 'contingency').reduce((acc, c) => acc + byCat[c.id], 0);
    const contingencyAmount = preCont * pct(contingencyPct);
    byCat.contingency += contingencyAmount;
    const totalAmount = COST_CATEGORIES.reduce((acc, c) => acc + byCat[c.id], 0);
    return { direct, structure, financial, contingency: contingencyAmount, workingCapital, byCategory: byCat, bySource, cashByKey, total: totalAmount };
  })();

  // Resumen de transporte (PLAN-2026-012): viajes facturables, físicos y km.
  const transport = transportSummary({ quote, activity, route, logistics, external });

  return {
    activity,
    transport,
    fuel: { pricePerLiter: fuelPricePerLiter, paidByUs: fuelPaidByUs, providedBy: quote.fuel && quote.fuel.providedBy ? quote.fuel.providedBy : null },
    labor,
    standby: { days: standbyDays, costPerDay: standbyCostPerDay, monthly: standbyMonthly },
    equipment,
    external,
    mobilization,
    logistics,
    materials,
    otherCosts,
    currency: { code: currency, gaps: currencyGaps },
    lines,
    direct,
    structure: {
      mode: detailed ? 'detailed' : 'simple',
      method,
      pct: indirectPct,
      amount: indirectAmount,
      items: structureItems,
      fixedMonthly: structureFixed,
      variablePerActiveDay: structureVariable,
    },
    finance,
    contingency,
    byCategory,
    fixedMonthly: total.fixedMonthly,
    variablePerActiveDay: total.variablePerActiveDay,
    activationRounding: {
      enabled: activity.fullActivations === true,
      daysPerActivation: activity.daysPerActivation,
      perActivation,
      // Para nombrar la activación en las trazas (llamado / salida / intervención, PLAN-2026-014).
      terms: { serviceType: typeof quote.serviceType === 'string' ? quote.serviceType : null, unit: typeof quote.unit === 'string' ? quote.unit : null },
    },
  };
}

/**
 * Salidas estimadas y costeadas con D días (PLAN-2026-011). `force` calcula el
 * ajuste aunque la opción esté apagada (para mostrar cuánto sumaría).
 */
export function activationRoundingAt(model, activeDays, { force = false } = {}) {
  const r = model && model.activationRounding;
  const D = nonNegative(activeDays);
  const dpa = r && r.daysPerActivation > 0 ? r.daysPerActivation : 1;
  const estimated = D / dpa;
  const costed = estimated > 1e-12 ? Math.ceil(estimated - 1e-9) : 0;
  const extra = Math.max(0, costed - estimated);
  const enabled = Boolean(r && r.enabled);
  const apply = Boolean(r) && (enabled || force);
  const per = apply ? r.perActivation : null;
  const scale = (v) => (per ? v * extra : 0);
  return {
    enabled,
    estimated,
    costed: enabled ? Math.max(costed, estimated) : estimated,
    wholeActivations: costed,
    extraActivations: extra,
    perActivationDiscrete: per ? per.total : 0,
    direct: scale(per ? per.direct : 0),
    structure: scale(per ? per.structure : 0),
    financial: scale(per ? per.financial : 0),
    contingency: scale(per ? per.contingency : 0),
    workingCapital: scale(per ? per.workingCapital : 0),
    total: scale(per ? per.total : 0),
    byCategory: Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, per ? per.byCategory[c.id] * extra : 0])),
    bySource: per ? Object.fromEntries(Object.entries(per.bySource).map(([k, v]) => [k, v * extra])) : {},
    cashByKey: per ? Object.fromEntries(Object.entries(per.cashByKey).map(([k, v]) => [k, v * extra])) : {},
  };
}

/** Días de trabajo donde empieza una salida nueva (saltos del costo con "cada salida completa"). */
export function activationBreakpoints(model, maxDays) {
  const r = model && model.activationRounding;
  if (!r || !r.enabled || !(r.perActivation && r.perActivation.total > 0)) return [];
  const dpa = r.daysPerActivation > 0 ? r.daysPerActivation : 1;
  const limit = nonNegative(maxDays);
  const out = [];
  for (let k = 1; k * dpa <= limit + 1e-9 && out.length < 500; k += 1) out.push(k * dpa);
  return out;
}

/** Factor de prorrateo de fijos cuando D supera los días disponibles. */
export function monthsFactor(activeDays, availableDays) {
  const d = nonNegative(activeDays);
  const a = nonNegative(availableDays);
  if (a <= 0 || d <= a) return 1;
  return d / a;
}

/** Costo total y por categoría con D días activos. */
export function costAtActivity(model, activeDays) {
  const D = nonNegative(activeDays);
  const factor = monthsFactor(D, model.activity.availableDaysPerMonth);
  const byCategory = {};
  let total = 0;
  for (const c of COST_CATEGORIES) {
    const b = model.byCategory[c.id];
    const amount = b.fixedMonthly * factor + b.variablePerActiveDay * D;
    byCategory[c.id] = amount;
    total += amount;
  }
  const fixed = model.fixedMonthly * factor;
  let variable = model.variablePerActiveDay * D;
  // "Cada salida se cuenta completa" (PLAN-2026-011): sólo si está activa.
  let rounding = null;
  if (model.activationRounding && model.activationRounding.enabled) {
    rounding = activationRoundingAt(model, D);
    if (rounding.total > 0) {
      for (const c of COST_CATEGORIES) {
        byCategory[c.id] += rounding.byCategory[c.id];
        total += rounding.byCategory[c.id];
      }
      variable += rounding.total;
    }
  }
  return {
    activeDays: D,
    monthsFactor: factor,
    fixed,
    variable,
    total,
    byCategory,
    rounding,
    perActiveDay: safeDivide(total, D, null),
  };
}

/**
 * Estructura de costos (EECC): monto + incidencia %.
 * La incidencia mostrada (2 decimales) suma exactamente 100 %.
 */
export function costStructure(model, activeDays) {
  const at = costAtActivity(model, activeDays);
  const amounts = COST_CATEGORIES.map((c) => at.byCategory[c.id]);
  const displayPcts = roundPercentagesToTotal(amounts, 2, 100);
  const byCat = model.byCategory || {};
  const rows = COST_CATEGORIES.map((c, i) => ({
    category: c.id,
    label: c.label,
    amount: amounts[i],
    // Fijo del mes y variable por día de trabajo de la categoría (PLAN-2026-010):
    // "monto ÷ días" mezcla los fijos y no es un costo por día.
    fixedMonthly: (byCat[c.id] ? byCat[c.id].fixedMonthly : 0) * at.monthsFactor,
    variablePerActiveDay: byCat[c.id] ? byCat[c.id].variablePerActiveDay : 0,
    // Ajuste por "cada salida se cuenta completa" (PLAN-2026-011; 0 si está apagado).
    activationRounding: at.rounding ? at.rounding.byCategory[c.id] : 0,
    // Equivalente por día AL NIVEL ESTIMADO (incluye fijos): sólo una referencia.
    perActiveDay: safeDivide(amounts[i], at.activeDays, null),
    share: at.total > 0 ? amounts[i] / at.total : 0,
    sharePct: at.total > 0 ? (amounts[i] / at.total) * 100 : 0,
    displayPct: displayPcts[i],
  }));
  return {
    activeDays: at.activeDays,
    rows,
    total: at.total,
    totalPct: at.total > 0 ? 100 : 0,
    displayTotalPct: roundPercentage(displayPcts.reduce((s, p) => s + p, 0)),
  };
}

/** Traza del costo total mensual. */
export function traceTotalCost(model, activeDays) {
  const at = costAtActivity(model, activeDays);
  // Salidas promedio, costeadas y efecto del redondeo (PLAN-2026-014, LAB-D1), con el nombre del servicio.
  const T = activationTerms(model.activationRounding && model.activationRounding.terms);
  const preview = at.rounding ? null : activationRoundingAt(model, activeDays, { force: true });
  const averageOnly = preview && preview.total > 0;
  const n = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });
  return createTrace({
    id: 'total_cost',
    title: 'Costo total mensual',
    formula: 'Costo = Fijos mensuales × meses de costo fijo + Variable por día activo × Días activos',
    inputs: [
      { label: 'Costos fijos mensuales (incluye estructura, financiero y contingencia)', value: model.fixedMonthly, format: 'money' },
      { label: 'Costo variable por día activo', value: model.variablePerActiveDay, format: 'money' },
      { label: 'Días activos', value: at.activeDays, format: 'days' },
      { label: 'Meses de costo fijo (1 = un mes; más si los días superan los disponibles)', value: at.monthsFactor, format: 'number' },
    ],
    steps: [
      { label: 'Fijos', value: at.fixed, format: 'money' },
      ...(at.rounding && at.rounding.total > 0
        ? [
          { label: 'Variables (por día de trabajo)', value: at.variable - at.rounding.total, format: 'money' },
          { label: `${T.Many} promedio por mes`, value: at.rounding.estimated, format: 'number' },
          { label: `${T.Many} ${T.g('costeadas', 'costeados')} (${T.each} ${T.whole})`, value: at.rounding.costed, format: 'number' },
          { label: `Efecto del redondeo (costos por ${T.one}, con su estructura, financiación y contingencia)`, value: at.rounding.total, format: 'money' },
        ]
        : []),
      { label: 'Variables', value: at.variable, format: 'money' },
    ],
    result: { label: 'Costo total', value: at.total, format: 'money' },
    notes: [
      at.monthsFactor > 1 ? 'Los días superan los disponibles del mes: se prorratean los fijos como trabajo de más de un mes.' : null,
      at.rounding && at.rounding.total > 0 ? `${T.Each} se cuenta ${T.whole}: sólo los costos por ${T.one} (movilización, peajes, viáticos, cargos por ${T.one}…) se costean con ${T.theMany} ${T.many} ${T.wholeMany}. Sueldos, tenencia, producción y estructura mensual no cambian.` : null,
      averageOnly
        ? `${T.Many} promedio por mes: ${n(preview.estimated)} · ${T.many} ${T.g('costeadas', 'costeados')}: ${n(preview.estimated)} (los costos por ${T.one} se cuentan en proporción). Con "${T.Each} se cuenta ${T.whole}" se costearía${preview.wholeActivations === 1 ? '' : 'n'} ${n(preview.wholeActivations)}: efecto del redondeo +${formatMoney(preview.total)} por mes (no incluido).`
        : null,
    ].filter(Boolean),
  });
}

/** Utilidad: lee un número opcional (null si vacío). */
export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = toNumber(value, NaN);
  return Number.isFinite(n) ? n : null;
}
