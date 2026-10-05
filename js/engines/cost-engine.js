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
 */

import { objectList } from '../core/object.js';
import { nonNegative, pct, safeDivide, roundPercentagesToTotal, roundPercentage, toNumber } from '../core/money.js';
import { createTrace } from '../core/trace.js';
import { COST_CATEGORIES, CATEGORY_PAY_GROUP, DIRECT_CATEGORY_IDS, PAY_GROUPS, MATERIAL_PROVIDERS } from '../domain/catalogs.js';
import { computeLabor } from './labor-engine.js';
import { computeEquipmentLine } from './equipment-engine.js';
import { computeLogistics } from './logistics-engine.js';
import { computeMaterials, computeOtherCostLine } from './materials-engine.js';
import { computeFinance } from './finance-engine.js';
import { computeExternalLine } from './external-engine.js';
import { computeMobilization } from './mobilization-engine.js';
import { conversionFactor, currencyOfBase, quoteCurrency } from './currency-engine.js';

/** Normaliza los parámetros de actividad de una cotización. */
export function normalizeActivity(quote = {}) {
  const a = quote.activity || {};
  const availableRaw = Math.min(nonNegative(a.availableDaysPerMonth, 30), 31);
  // 0 o inválido no tiene sentido económico: se usa 30 (y validateQuote lo informa).
  const availableDaysPerMonth = availableRaw > 0 ? availableRaw : 30;
  const activeDaysPerMonth = nonNegative(a.activeDaysPerMonth);
  const dpaRaw = nonNegative(a.daysPerActivation, 1);
  const daysPerActivation = dpaRaw > 0 ? dpaRaw : 1;
  const hoursPerActiveDay = Math.min(nonNegative(a.hoursPerActiveDay), 24);
  return {
    availability: a.availability || '24/7',
    availabilityWindow: a.availabilityWindow || '',
    responseTimeHours: nonNegative(a.responseTimeHours),
    availableDaysPerMonth,
    activeDaysPerMonth,
    daysPerActivation,
    hoursPerActiveDay,
    activationsPerMonth: activeDaysPerMonth / daysPerActivation,
    utilizationPct: availableDaysPerMonth > 0 ? (activeDaysPerMonth / availableDaysPerMonth) * 100 : null,
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

  // Logística (ruta): la usan la movilización y las tarifas externas por km o viaje.
  const logistics = computeLogistics(quote.logistics || {}, {
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
      lines.push({
        key: `external:${e.id ?? i}`,
        source: 'external',
        label: `${name} — ${kind}`,
        category: 'external',
        payGroup: 'suppliers',
        fixedMonthly: x.fixedMonthly,
        variablePerActiveDay: x.variablePerActiveDay,
        cashFixedMonthly: x.fixedMonthly,
        cashVariablePerActiveDay: x.variablePerActiveDay,
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
          cashVariablePerActiveDay: x.mobilizationPerActiveDay,
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
    });
  });

  // Base directa (excluye lo cargado manualmente como "estructura")
  const direct = emptyBucket();
  const laborBucket = emptyBucket();
  lines.forEach((l) => {
    if (l.category !== 'structure') addTo(direct, l.fixedMonthly, l.variablePerActiveDay);
    if (l.category === 'labor') addTo(laborBucket, l.fixedMonthly, l.variablePerActiveDay);
  });

  // 6. Estructura (indirectos)
  const indirect = quote.indirect || {};
  const method = indirect.method || 'percent_direct';
  const indirectPct = nonNegative(indirect.pct);
  const indirectAmount = nonNegative(indirect.amount);
  let structureFixed = 0;
  let structureVariable = 0;
  switch (method) {
    case 'percent_direct':
      structureFixed = direct.fixedMonthly * pct(indirectPct);
      structureVariable = direct.variablePerActiveDay * pct(indirectPct);
      break;
    case 'percent_labor':
      structureFixed = laborBucket.fixedMonthly * pct(indirectPct);
      structureVariable = laborBucket.variablePerActiveDay * pct(indirectPct);
      break;
    case 'per_employee':
      structureFixed = indirectAmount * labor.headcount;
      break;
    case 'per_hour':
      structureVariable = indirectAmount * activity.hoursPerActiveDay;
      break;
    case 'per_contract':
    case 'manual':
    default:
      structureFixed = indirectAmount;
      break;
  }
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

  // 7. Financiero
  const cashByGroup = Object.fromEntries(PAY_GROUPS.map((g) => [g.id, emptyBucket()]));
  lines.forEach((l) => addTo(cashByGroup[l.payGroup] || cashByGroup.suppliers, l.cashFixedMonthly, l.cashVariablePerActiveDay));
  const finance = computeFinance(cashByGroup, quote.finance || {});

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

  return {
    activity,
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
      method,
      pct: indirectPct,
      amount: indirectAmount,
      fixedMonthly: structureFixed,
      variablePerActiveDay: structureVariable,
    },
    finance,
    contingency,
    byCategory,
    fixedMonthly: total.fixedMonthly,
    variablePerActiveDay: total.variablePerActiveDay,
  };
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
  return {
    activeDays: D,
    monthsFactor: factor,
    fixed,
    variable: model.variablePerActiveDay * D,
    total,
    byCategory,
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
  const rows = COST_CATEGORIES.map((c, i) => ({
    category: c.id,
    label: c.label,
    amount: amounts[i],
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
      { label: 'Variables', value: at.variable, format: 'money' },
    ],
    result: { label: 'Costo total', value: at.total, format: 'money' },
    notes: at.monthsFactor > 1 ? ['Los días superan los disponibles del mes: se prorratean los fijos como trabajo de más de un mes.'] : [],
  });
}

/** Utilidad: lee un número opcional (null si vacío). */
export function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = toNumber(value, NaN);
  return Number.isFinite(n) ? n : null;
}
