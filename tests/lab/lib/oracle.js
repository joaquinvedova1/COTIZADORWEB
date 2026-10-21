/**
 * RATEOS Test Lab — ORÁCULO ECONÓMICO INDEPENDIENTE de cotizaciones (PLAN-2026-013).
 *
 * Calcula una cotización con fórmulas cortas escritas a partir de
 * docs/CALCULATION_RULES.md (el § de cada bloque). NO importa js/engines/ ni
 * helpers con lógica del dominio (tests/lab/oracle-independence.test.js lo
 * verifica): si el motor productivo se equivoca, este cálculo no se equivoca
 * igual. Cuando la especificación no dice algo, la decisión del oráculo queda
 * anotada como "hueco de la especificación" (DOC_GAPS) para revisarla.
 *
 * Unidades: todo en la moneda de la cotización, sin IVA, por mes con D días de
 * trabajo. Porcentajes en puntos (10 = 10 %).
 */

// ------------------------------------------------------------------ lectura

/** Número finito ≥ 0 (vacío, texto no numérico o negativo → `fb`). §21 "Valores vacíos / negativos". */
export function n(value, fb = 0) {
  let x = value;
  if (typeof x === 'string') x = x.trim() === '' ? NaN : Number(x.trim());
  if (typeof x !== 'number' || !Number.isFinite(x)) return fb;
  return x < 0 ? fb : x;
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => (isObj(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
const blank = (v) => v === null || v === undefined || v === '';
const frac = (pts) => n(pts) / 100;
/** División: divisor ~0 o no finito → `fb` (nunca Infinity / NaN). §18 safeDivide. */
export function div(a, b, fb = null) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < 1e-9) return fb;
  return a / b;
}
/** Número "como lo escribe una persona" (es-AR) para márgenes e impuestos. §18. */
export function readDecimal(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  const t = raw.replace(/[\s  ]/g, '').replace(/^\$|^ARS/i, '').replace(/%$/, '');
  if (t === '' || t === '-') return NaN;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t.includes('.') && t.includes(',')) return /^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) ? Number(t.replace(/\./g, '').replace(',', '.')) : NaN;
  if (t.includes(',')) return /^-?\d*,\d+$/.test(t) ? Number(t.replace(',', '.')) : NaN;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return /^-?\d*\.\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * Decisiones del oráculo donde la especificación no es explícita (se informan en el reporte).
 * Vacío desde PLAN-2026-014 (LAB-D6): los tres huecos anteriores se documentaron como reglas
 * reales en CALCULATION_RULES (ver CONFIRMED_RULES) y el oráculo los sigue desde la documentación.
 */
export const DOC_GAPS = Object.freeze([]);

/** Reglas que eran huecos y hoy están escritas en CALCULATION_RULES (PLAN-2026-014, LAB-D6). */
export const CONFIRMED_RULES = Object.freeze([
  { id: 'vat-partial-without-pct', rule: '§4.1', text: 'IVA "Parcial" sin % recuperable = 0 % recuperable (todo el IVA es costo) + pendiente rojo.' },
  { id: 'other-cost-category-external', rule: '§6', text: 'Otros costos con categoría "external": costo directo del grupo de pago Proveedores.' },
  { id: 'line-hours-cap', rule: '§4', text: 'Horas por día de una línea de equipo (propia o externa): son POR UNIDAD y como mucho 24, igual que las de la actividad (§2); un dato mayor es error de validación y se calcula con 24; más horas = más equipos (cantidad). Decisión del dueño (PLAN-2026-014).' },
]);

// ------------------------------------------------------------- catálogos (§12.1, §6.1)

/** Familia de cada unidad de facturación (§12.1). Unidad desconocida o vacía = día. */
export const ORACLE_UNIT_KINDS = Object.freeze({
  day: 'day', hour: 'hour', month: 'month',
  call: 'event', job: 'event', milestone: 'event',
  shift: 'quantity', trip: 'quantity', km: 'quantity', ton: 'quantity', tonkm: 'quantity', m3: 'quantity',
  unit: 'quantity', kg: 'quantity', meter: 'quantity', m2: 'quantity', lot: 'quantity', custom: 'quantity',
});
/** Unidades de la tarifa de un externo (§4.1). */
export const ORACLE_EXTERNAL_UNITS = Object.freeze(['hour', 'day', 'month', 'trip', 'km', 'activation', 'global']);
const KNOWN_CURRENCIES = ['ARS', 'USD', 'EUR'];
const DIRECT_CATEGORIES = ['labor', 'equipment', 'external', 'fuel', 'materials', 'logistics', 'structure'];
const CATEGORY_GROUP = { labor: 'salaries', equipment: 'suppliers', external: 'suppliers', fuel: 'fuel', materials: 'materials', logistics: 'suppliers', structure: 'structure' };
const GROUPS = ['salaries', 'fuel', 'suppliers', 'materials', 'structure'];
export const ORACLE_CATEGORIES = Object.freeze(['labor', 'equipment', 'external', 'fuel', 'materials', 'logistics', 'structure', 'financial', 'contingency']);

/** Factor de moneda (§6.1): 1 misma moneda o sin moneda; tipo de cambio de la cotización; null si falta. */
export function currencyFactor(base, quote) {
  const cur = isObj(base) && KNOWN_CURRENCIES.includes(base.currency) ? base.currency : null;
  const quoteCur = KNOWN_CURRENCIES.includes(quote.currency) ? quote.currency : 'ARS';
  if (!cur || cur === quoteCur) return 1;
  const row = list(quote.exchangeRates).find((r) => r.currency === cur);
  const rate = row ? Number(row.rate) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

// ------------------------------------------------------------------ actividad (§2, §12.1)

export function oracleActivity(q) {
  const a = obj(q.activity);
  const unitId = typeof q.unit === 'string' && ORACLE_UNIT_KINDS[q.unit] ? q.unit : 'day';
  const kind = ORACLE_UNIT_KINDS[unitId];
  const availRaw = Math.min(n(a.availableDaysPerMonth, 30), 31);
  const available = availRaw > 0 ? availRaw : 30; // 0, negativo o vacío → 30
  const dpaRaw = n(a.daysPerActivation, 1);
  const dpa = dpaRaw > 0 ? dpaRaw : 1; // ≤ 0 o vacío → 1
  const hours = Math.min(n(a.hoursPerActiveDay), 24);
  const minCall = n(obj(q.rules).minimumCallUnits);
  let D;
  let Q = null;
  let r = null;
  let upa = null;
  if (kind === 'quantity') {
    // D = Q / max(días por llamado × r, mínimo por llamado) × días por llamado
    Q = n(a.billableQuantityPerMonth);
    r = n(a.unitsPerActiveDay);
    const perActivation = Math.max(dpa * r, minCall);
    D = perActivation > 0 ? (Q / perActivation) * dpa : 0;
  } else if (kind === 'event') {
    // D = Q / hitos por trabajo × días por llamado (1 hito si no es "por hito")
    Q = n(a.billableQuantityPerMonth);
    upa = unitId === 'milestone' && n(a.unitsPerActivation) > 0 ? n(a.unitsPerActivation) : 1;
    D = (Q / upa) * dpa;
  } else {
    D = n(a.activeDaysPerMonth);
  }
  return { unitId, kind, available, dpa, hours, minCall, D, Q, r, upa, A: D / dpa, fullActivations: a.fullActivations === true };
}

/** Meses de costo fijo (§1): 1, o D / disponibles si D los supera. */
export const monthsFactor = (D, available) => (available > 0 && D > available ? D / available : 1);

/** Unidades facturables con D días (§12 tabla y §12.1). */
export function billableAt(act, D) {
  const A = D / act.dpa;
  if (act.kind === 'month') return { A, units: monthsFactor(D, act.available), billableDays: D, minimumApplied: false };
  if (act.kind === 'event') return { A, units: A * act.upa, billableDays: D, minimumApplied: false };
  const worked = act.kind === 'hour' ? act.dpa * act.hours : act.kind === 'quantity' ? act.dpa * act.r : act.dpa;
  const perActivation = Math.max(worked, act.minCall);
  const units = A * perActivation;
  const billableDays = act.kind === 'hour' ? (act.hours > 0 ? units / act.hours : D) : act.kind === 'quantity' ? D : units;
  return { A, units, billableDays, minimumApplied: act.minCall > worked + 1e-9 && A > 0 };
}

// ---------------------------------------------------------------------- personal (§3, §3.1, §4.2)

/** % de los costos FIJOS que carga la cotización (§4.2): compartido sin % válido → 100; más de 100 → 100. */
export function sharedFraction(line) {
  if (line.assignment !== 'shared') return { shared: false, f: 1 };
  const raw = blank(line.fixedCostSharePct) ? NaN : typeof line.fixedCostSharePct === 'number' ? line.fixedCostSharePct : Number(String(line.fixedCostSharePct).replace(',', '.'));
  if (!Number.isFinite(raw) || raw <= 0) return { shared: true, f: 1, missing: true };
  return { shared: true, f: Math.min(raw, 100) / 100 };
}

export function oracleLaborLine(l) {
  const positions = n(l.positions);
  const people = n(l.peoplePerPosition, 1);
  const headcount = positions * people;
  const remunerative = n(l.basicMonthly) + n(l.additionalsMonthly);
  const loadFactor = (1 + frac(l.sacPct) + frac(l.vacationPct)) * (1 + frac(l.employerContributionsPct) + frac(l.artPct));
  const nonRemunerative = n(l.insuranceMonthly) + n(l.ppeMonthly) + n(l.trainingMonthly) + n(l.transferMonthly);
  const fixedPerPerson = remunerative * loadFactor + nonRemunerative;
  const hourly = div(n(l.basicMonthly), n(l.normalHoursPerMonth), 0); // sólo el básico
  // Tramos de horas extra (§3.1) o el campo único de siempre.
  const tranches = Array.isArray(l.overtime)
    ? list(l.overtime).map((o) => ({ premium: n(o.premiumPct), hours: n(o.hours), basis: o.basis === 'per_month' ? 'per_month' : 'per_active_day', bill: n(o.billRatePerHour) }))
    : n(l.overtimeHoursPerActiveDay) > 0 ? [{ premium: n(l.overtimePremiumPct), hours: n(l.overtimeHoursPerActiveDay), basis: 'per_active_day', bill: n(l.overtimeBillRatePerHour) }] : [];
  let otPerDayPerPosition = 0;
  let otMonthlyPerPerson = 0;
  let billedPerDay = 0;
  let billedMonthly = 0;
  for (const t of tranches) {
    const cost = t.hours * hourly * (1 + t.premium / 100) * loadFactor;
    if (t.basis === 'per_month') { otMonthlyPerPerson += cost; billedMonthly += t.hours * t.bill; } else { otPerDayPerPosition += cost; billedPerDay += t.hours * t.bill; }
  }
  const share = sharedFraction(l);
  const billed = l.overtimeBilled === true;
  return {
    headcount,
    positions,
    effectiveHeadcount: share.shared ? headcount * share.f : headcount,
    fixedPerPerson,
    // fijo = (costo fijo por persona × % asignado + horas extra por mes) × dotación
    fixed: (fixedPerPerson * share.f + otMonthlyPerPerson) * headcount,
    // variable por día activo = (horas extra cargadas + vianda) × posiciones
    variable: (otPerDayPerPosition + n(l.mealPerActiveDay)) * positions,
    overtimeRevenueFixed: billed ? billedMonthly * headcount : 0,
    overtimeRevenuePerDay: billed ? billedPerDay * positions : 0,
  };
}

// ----------------------------------------------------------------------- equipos (§4, §4.1)

function maintenance(e) {
  const mode = ['per_hour', 'service', 'budget'].includes(e.maintenanceMode) ? e.maintenanceMode : 'per_hour';
  if (mode === 'service') return { perHour: div(n(e.maintenanceServiceCost), n(e.maintenanceServiceHours), 0), fixed: 0 };
  if (mode === 'budget') return { perHour: 0, fixed: e.maintenanceBudgetPeriod === 'year' ? n(e.maintenanceBudget) / 12 : n(e.maintenanceBudget) };
  return { perHour: n(e.maintenancePerHour), fixed: 0 };
}
function tires(e) {
  const mode = ['per_hour', 'set_hours', 'set_km'].includes(e.tiresMode) ? e.tiresMode : 'per_hour';
  if (mode === 'set_hours') return { perHour: div(n(e.tiresSetCost), n(e.tiresLifeHours), 0), perKm: 0 };
  if (mode === 'set_km') return { perHour: 0, perKm: div(n(e.tiresSetCost), n(e.tiresLifeKm), 0) };
  return { perHour: n(e.tiresPerHour), perKm: 0 };
}

/** Posesión mensual de UNA unidad (§4). `factor` = moneda del valor de reposición. */
export function ownership(e, factor = 1) {
  const replacement = n(e.replacementValue) * factor;
  const residual = Math.min(n(e.residualValue) * factor, replacement);
  const life = n(e.usefulLifeYears);
  const depreciation = div(replacement - residual, life * 12, 0);
  const capital = (((replacement + residual) / 2) * frac(e.capitalRatePctAnnual)) / 12;
  const cash = n(e.insuranceAnnual) / 12 + n(e.licenseAnnual) / 12 + n(e.certificationsAnnual) / 12 + n(e.otherAnnual) / 12 + maintenance(e).fixed;
  return { depreciation, capital, cash, total: cash + depreciation + capital };
}

/** Uso por hora de UNA unidad (§4): mantenimiento + neumáticos + combustible. */
export function operation(e, fuelPrice) {
  const m = maintenance(e);
  const t = tires(e);
  // "No usa combustible" (§4, PLAN-2026-014): explícito; un consumo 0 sin marcar es otra cosa (falta el dato).
  const liters = e.fuelNotApplicable === true ? 0 : n(e.fuelLitersPerHour);
  return { nonFuelPerHour: m.perHour + t.perHour, fuelPerHour: liters * fuelPrice, tiresPerKm: t.perKm };
}

// Horas de uso por día de UNA unidad, propia o externa: como mucho 24 (§4; la cantidad multiplica).
const lineHours = (line, act) => Math.min(blank(line.hoursPerActiveDay) ? act.hours : n(line.hoursPerActiveDay), 24);
const isExternal = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';

/** Factores fiscales de un externo (§4.1). */
export function externalFiscal(fiscalRaw) {
  const f = obj(fiscalRaw);
  const vatDefined = !blank(f.vatPct) && Number.isFinite(Number(f.vatPct));
  const vat = vatDefined ? n(f.vatPct) : 0;
  let recoverable = 1; // sin definir → se usa el neto (+ aviso)
  if (f.vatRecoverable === 'no') recoverable = 0;
  else if (f.vatRecoverable === 'partial') recoverable = blank(f.vatRecoverablePct) || !Number.isFinite(Number(f.vatRecoverablePct)) ? 0 : Math.min(Math.max(Number(f.vatRecoverablePct), 0), 100) / 100;
  const perceptions = n(f.perceptionsPct);
  const nonRecoverable = n(f.nonRecoverablePct);
  return {
    economic: 1 + nonRecoverable / 100 + (vat * (1 - recoverable)) / 100,
    cash: 1 + vat / 100 + perceptions / 100 + nonRecoverable / 100,
    credit: (vat * recoverable) / 100 + perceptions / 100,
  };
}

// ------------------------------------------------------------------- ruta (§5, §5.2)

export function oracleRoute(q, act) {
  const lg = obj(q.logistics);
  const notApplicable = Boolean(lg.notApplicable);
  const distance = notApplicable ? 0 : n(lg.distanceKm);
  const roundTrip = lg.roundTrip !== false;
  // Unidad "viaje": viajes por intervención = viajes por día × días por intervención (se derivan).
  const derived = act.unitId === 'trip';
  const tripsPerActivation = notApplicable ? 0 : derived ? act.r * act.dpa : n(lg.tripsPerActivation, 1);
  const kmPerTrip = distance * (roundTrip ? 2 : 1);
  const routeKmPerActivation = kmPerTrip * tripsPerActivation;
  return {
    notApplicable,
    derived,
    distance,
    roundTrip,
    tripsPerActivation,
    legsPerActivation: tripsPerActivation * (roundTrip ? 2 : 1),
    kmPerTrip,
    routeKmPerActivation,
    tolls: notApplicable ? 0 : n(lg.tollsPerActivation),
    lodging: notApplicable ? 0 : n(lg.lodgingPerActivation),
    vehicles: notApplicable ? [] : list(lg.vehicles),
  };
}

// ---------------------------------------------------------------- modelo de costos (§1–§9)

/**
 * Construye el modelo: líneas con categoría, grupo de pago, fijo mensual,
 * variable por día activo, parte en efectivo (para el financiero) y costo
 * discreto por salida (para "cada salida se cuenta completa").
 */
export function oracleModel(q) {
  const act = oracleActivity(q);
  const fuelPrice = obj(q.fuel).providedBy === 'client' ? 0 : n(obj(q.fuel).pricePerLiter);
  const route = oracleRoute(q, act);
  const lines = [];
  const add = (line) => lines.push({ fixed: 0, variable: 0, cashFixed: null, cashVariable: null, discrete: 0, cashDiscrete: null, supplierKey: null, ...line });

  // 1. Personal (§3) y standby (§3: días × variable diario del personal, fijo del mes).
  const labor = list(q.labor).map(oracleLaborLine);
  labor.forEach((l, i) => add({ key: `labor:${i}`, category: 'labor', group: 'salaries', fixed: l.fixed, variable: l.variable }));
  const rules = obj(q.rules);
  const standbyDays = rules.standbyNotApplicable === true ? 0 : n(rules.standbyDaysPerMonth);
  const laborVariablePerDay = labor.reduce((s, l) => s + l.variable, 0);
  if (standbyDays * laborVariablePerDay > 0) add({ key: 'standby', category: 'labor', group: 'salaries', fixed: standbyDays * laborVariablePerDay });

  // 2. Equipos propios (§4) y externos (§4.1).
  const externals = [];
  list(q.equipment).forEach((e, i) => {
    const qty = n(e.quantity);
    const hours = lineHours(e, act);
    if (!isExternal(e)) {
      const own = ownership(e, currencyFactor(e.base, q) ?? 0);
      const op = operation(e, fuelPrice);
      const share = sharedFraction(e);
      add({ key: `equipment:ownership:${i}`, category: 'equipment', group: 'suppliers', fixed: own.total * qty * share.f, cashFixed: own.cash * qty * share.f });
      add({ key: `equipment:operation:${i}`, category: 'equipment', group: 'suppliers', variable: op.nonFuelPerHour * hours * qty });
      add({ key: `equipment:fuel:${i}`, category: 'fuel', group: 'fuel', variable: op.fuelPerHour * hours * qty });
      return;
    }
    const x = obj(e.external);
    const factor = currencyFactor(e.base, q) ?? 0;
    const unit = ORACLE_EXTERNAL_UNITS.includes(x.unit) ? x.unit : 'day';
    const price = n(x.price) * factor;
    const minimum = n(x.minimumUnits);
    const fiscal = externalFiscal(x.fiscal);
    const contractMonths = n(q.contractMonths) >= 1 ? n(q.contractMonths) : 1;
    const unitsPerActivation = { hour: hours * act.dpa, day: act.dpa, trip: route.legsPerActivation, km: route.routeKmPerActivation, activation: 1 }[unit] ?? null;
    let netPerActivation = 0;
    let netFixed = 0;
    let billedPerActivation = null;
    if (unit === 'month') netFixed = price * qty;
    else if (unit === 'global') netFixed = (price * qty) / contractMonths;
    else {
      billedPerActivation = unit === 'activation' ? 1 : Math.max(unitsPerActivation, minimum);
      netPerActivation = billedPerActivation * price * qty;
    }
    const minimumApplied = (unit === 'hour' || unit === 'day') && minimum > unitsPerActivation + 1e-9;
    const discreteNet = unit === 'activation' || unit === 'trip' || unit === 'km' || minimumApplied ? netPerActivation : 0;
    const ownTerm = blank(e.supplierPayDays) || !Number.isFinite(Number(e.supplierPayDays)) || Number(e.supplierPayDays) < 0 ? null : Number(e.supplierPayDays);
    const supplierKey = ownTerm === null ? null : `supplier:${i}`;
    add({
      key: `external:${i}`, category: 'external', group: 'suppliers', supplierKey, supplierDays: ownTerm,
      fixed: netFixed * fiscal.economic, variable: (netPerActivation / act.dpa) * fiscal.economic,
      cashFixed: netFixed * fiscal.cash, cashVariable: (netPerActivation / act.dpa) * fiscal.cash,
      discrete: discreteNet * fiscal.economic, cashDiscrete: discreteNet * fiscal.cash,
      credit: { fixed: netFixed * fiscal.credit, variable: (netPerActivation / act.dpa) * fiscal.credit },
    });
    // Movilización cobrada por el proveedor (sólo si NO está incluida).
    const mobNet = x.mobilizationIncluded === false ? n(x.mobilizationAmount) * factor * qty : 0;
    if (mobNet > 0) {
      add({
        key: `external:mobilization:${i}`, category: 'external', group: 'suppliers', supplierKey, supplierDays: ownTerm,
        variable: (mobNet / act.dpa) * fiscal.economic, cashVariable: (mobNet / act.dpa) * fiscal.cash,
        discrete: mobNet * fiscal.economic, cashDiscrete: mobNet * fiscal.cash,
        credit: { fixed: 0, variable: (mobNet / act.dpa) * fiscal.credit },
      });
    }
    // Combustible a nuestro cargo (sólo si NO está incluido): por hora o por km de ruta, nunca los dos.
    let fuelPerDay = 0;
    let fuelRoutePerActivation = 0;
    if (x.fuelIncluded === false) {
      const mode = ['per_100km', 'km_per_liter'].includes(x.fuelMode) ? x.fuelMode : 'per_hour';
      if (mode === 'per_hour') fuelPerDay = n(x.fuelLitersPerHour) * hours * qty * fuelPrice;
      else {
        const km = route.routeKmPerActivation * qty;
        const liters = mode === 'per_100km' ? (km * n(x.fuelLitersPer100Km)) / 100 : div(km, n(x.fuelKmPerLiter), 0);
        fuelRoutePerActivation = liters * fuelPrice;
        fuelPerDay = fuelRoutePerActivation / act.dpa;
      }
    }
    if (fuelPerDay > 0) add({ key: `external:fuel:${i}`, category: 'fuel', group: 'fuel', variable: fuelPerDay, discrete: fuelRoutePerActivation });
    externals.push({ index: i, unit, price, qty, billedPerActivation, netPerActivation, netFixed, unitsPerActivation, minimumApplied });
  });

  // 3. Movilización del recurso principal (§5.1): combustible en ruta → Combustible; desgaste → Logística.
  let mobFuelPerActivation = 0;
  let mobWearPerActivation = 0;
  list(q.equipment).forEach((e) => {
    const m = obj(e.mobilization);
    const external = isExternal(e);
    const x = obj(e.external);
    if (m.mode !== 'self' || (external && x.mobilizationIncluded === true)) return;
    const km = route.routeKmPerActivation * n(e.quantity);
    const liters = !external && e.fuelNotApplicable === true ? 0 : (km * n(m.travelLitersPer100Km)) / 100;
    const perKmFuelMode = external && ['per_100km', 'km_per_liter'].includes(x.fuelMode);
    const paysFuel = (!external || x.fuelIncluded === false) && !perKmFuelMode;
    mobFuelPerActivation += paysFuel ? liters * fuelPrice : 0;
    mobWearPerActivation += km * (n(m.travelCostPerKm) + tires(e).perKm); // sin amortización
  });
  add({ key: 'mobilization:fuel', category: 'fuel', group: 'fuel', variable: mobFuelPerActivation / act.dpa, discrete: mobFuelPerActivation });
  add({ key: 'mobilization:wear', category: 'logistics', group: 'suppliers', variable: mobWearPerActivation / act.dpa, discrete: mobWearPerActivation });

  // 4. Logística auxiliar (§5): vehículos (combustible y desgaste), peajes y viáticos por activación.
  let auxFuel = 0;
  let auxOther = route.tolls + route.lodging;
  for (const v of route.vehicles) {
    const km = route.routeKmPerActivation * n(v.count);
    auxFuel += ((km * n(v.consumptionLPer100Km)) / 100) * fuelPrice;
    auxOther += km * n(v.costPerKm);
  }
  add({ key: 'logistics:fuel', category: 'fuel', group: 'fuel', variable: auxFuel / act.dpa, discrete: auxFuel });
  add({ key: 'logistics:other', category: 'logistics', group: 'suppliers', variable: auxOther / act.dpa, discrete: auxOther });

  // 5. Materiales (§6): cantidad × costo × (1 + merma) × (1 + logística); el cliente → 0.
  const materials = q.materialsNotApplicable ? [] : list(q.materials);
  let resaleFixed = 0;
  let resalePerDay = 0;
  materials.forEach((m, i) => {
    const factor = currencyFactor(m.base, q) ?? 0;
    const gross = n(m.quantity) * n(m.unitCost) * factor * (1 + frac(m.wastePct)) * (1 + frac(m.logisticsPct));
    const cost = m.providedBy === 'client' ? 0 : gross;
    const basis = ['per_month', 'per_active_day', 'per_activation'].includes(m.basis) ? m.basis : 'per_month';
    const fixed = basis === 'per_month' ? cost : 0;
    const variable = basis === 'per_active_day' ? cost : basis === 'per_activation' ? cost / act.dpa : 0;
    add({ key: `materials:${i}`, category: 'materials', group: 'materials', fixed, variable, discrete: basis === 'per_activation' ? cost : 0 });
    resaleFixed += fixed * (1 + frac(m.resaleMarkupPct));
    resalePerDay += variable * (1 + frac(m.resaleMarkupPct));
  });

  // 6. Otros costos (§6).
  list(q.otherCosts).forEach((o, i) => {
    const amount = n(o.amount);
    const behavior = ['fixed_monthly', 'per_active_day', 'per_activation'].includes(o.behavior) ? o.behavior : 'fixed_monthly';
    const category = DIRECT_CATEGORIES.includes(o.category) ? o.category : 'materials';
    add({
      key: `other:${i}`, category, group: CATEGORY_GROUP[category],
      fixed: behavior === 'fixed_monthly' ? amount : 0,
      variable: behavior === 'per_active_day' ? amount : behavior === 'per_activation' ? amount / act.dpa : 0,
      discrete: behavior === 'per_activation' ? amount : 0,
    });
  });

  // 7. Estructura (§7): base directa = todo lo directo salvo la categoría Estructura; base MO = Mano de obra.
  const sumOf = (pred, k) => lines.filter(pred).reduce((s, l) => s + l[k], 0);
  const direct = { fixed: sumOf((l) => l.category !== 'structure', 'fixed'), variable: sumOf((l) => l.category !== 'structure', 'variable') };
  const laborBase = { fixed: sumOf((l) => l.category === 'labor', 'fixed'), variable: sumOf((l) => l.category === 'labor', 'variable') };
  const effectiveHeadcount = labor.reduce((s, l) => s + l.effectiveHeadcount, 0);
  const structureOf = (method, pctValue, amount) => {
    switch (method) {
      case 'percent_direct': return { fixed: direct.fixed * frac(pctValue), variable: direct.variable * frac(pctValue) };
      case 'percent_labor': return { fixed: laborBase.fixed * frac(pctValue), variable: laborBase.variable * frac(pctValue) };
      case 'per_employee': return { fixed: n(amount) * effectiveHeadcount, variable: 0 };
      case 'per_hour': return { fixed: 0, variable: n(amount) * act.hours };
      default: return { fixed: n(amount), variable: 0 }; // per_contract, manual
    }
  };
  const ind = obj(q.indirect);
  const detailed = ind.mode === 'detailed' && Array.isArray(ind.items);
  const items = detailed ? list(ind.items).map((it) => ({ method: typeof it.method === 'string' && it.method ? it.method : 'percent_direct', pct: it.pct, amount: it.amount })) : [{ method: ind.method || 'percent_direct', pct: ind.pct, amount: ind.amount }];
  const structure = items.map((it) => structureOf(it.method, it.pct, it.amount)).reduce((a, b) => ({ fixed: a.fixed + b.fixed, variable: a.variable + b.variable }), { fixed: 0, variable: 0 });
  add({ key: 'structure', category: 'structure', group: 'structure', fixed: structure.fixed, variable: structure.variable });

  // 8. Financiero (§8): efectivo de cada grupo × tasa × días financiados / 30.
  const f = obj(q.finance);
  const lag = n(f.invoiceLagDays);
  const term = n(f.paymentTermDays);
  const rate = frac(f.monthlyRatePct);
  const payDays = obj(f.payDays);
  const daysOf = (payDaysValue) => Math.max(0, lag + term - n(payDaysValue));
  const financing = {};
  for (const g of GROUPS) financing[g] = { days: daysOf(payDays[g]), fixed: 0, variable: 0 };
  for (const l of lines) {
    const key = l.supplierKey || l.group;
    if (!financing[key]) financing[key] = { days: daysOf(l.supplierDays), fixed: 0, variable: 0 };
    financing[key].fixed += l.cashFixed ?? l.fixed;
    financing[key].variable += l.cashVariable ?? l.variable;
  }
  const finance = Object.values(financing).reduce((acc, g) => ({
    fixed: acc.fixed + g.fixed * rate * (g.days / 30),
    variable: acc.variable + g.variable * rate * (g.days / 30),
    wcFixed: acc.wcFixed + g.fixed * (g.days / 30),
    wcVariable: acc.wcVariable + g.variable * (g.days / 30),
  }), { fixed: 0, variable: 0, wcFixed: 0, wcVariable: 0 });

  // 9. Contingencia (§9): % × (directos + estructura + financiero), fijo y variable por separado.
  const risk = obj(q.risk);
  const contingencyPct = n(risk.generalPct) + list(risk.items).filter((i) => i.enabled).reduce((s, i) => s + n(i.pct), 0);
  const pre = { fixed: lines.reduce((s, l) => s + l.fixed, 0) + finance.fixed, variable: lines.reduce((s, l) => s + l.variable, 0) + finance.variable };
  const contingency = { fixed: pre.fixed * (contingencyPct / 100), variable: pre.variable * (contingencyPct / 100) };

  const byCategory = Object.fromEntries(ORACLE_CATEGORIES.map((c) => [c, { fixed: 0, variable: 0 }]));
  for (const l of lines) { byCategory[l.category].fixed += l.fixed; byCategory[l.category].variable += l.variable; }
  byCategory.financial = { fixed: finance.fixed, variable: finance.variable };
  byCategory.contingency = contingency;
  const F = ORACLE_CATEGORIES.reduce((s, c) => s + byCategory[c].fixed, 0);
  const v = ORACLE_CATEGORIES.reduce((s, c) => s + byCategory[c].variable, 0);

  // "Cada salida se cuenta completa" (§2.1): costo de UNA salida completa de lo indivisible.
  const perActivation = (() => {
    const byCat = Object.fromEntries(ORACLE_CATEGORIES.map((c) => [c, 0]));
    const cashBy = {};
    const bySource = {};
    let disc = 0;
    let discLabor = 0;
    for (const l of lines) {
      const amount = l.discrete;
      const cash = l.cashDiscrete ?? l.discrete;
      if (!(amount > 0) && !(cash > 0)) continue;
      byCat[l.category] += amount;
      const source = l.key.split(':')[0];
      bySource[source] = (bySource[source] || 0) + amount;
      if (l.category !== 'structure') disc += amount;
      if (l.category === 'labor') discLabor += amount;
      const key = l.supplierKey || l.group;
      cashBy[key] = (cashBy[key] || 0) + cash;
    }
    // Estructura: sólo la parte que es un % del costo (la fija mensual no cambia).
    const part = items.reduce((s, it) => s + (it.method === 'percent_direct' ? disc * frac(it.pct) : it.method === 'percent_labor' ? discLabor * frac(it.pct) : 0), 0);
    byCat.structure += part;
    cashBy.structure = (cashBy.structure || 0) + part;
    let fin = 0;
    let wc = 0;
    for (const [key, cash] of Object.entries(cashBy)) {
      const days = financing[key] ? financing[key].days : 0;
      fin += cash * rate * (days / 30);
      wc += cash * (days / 30);
    }
    byCat.financial += fin;
    const before = ORACLE_CATEGORIES.filter((c) => c !== 'contingency').reduce((s, c) => s + byCat[c], 0);
    byCat.contingency += before * (contingencyPct / 100);
    const total = ORACLE_CATEGORIES.reduce((s, c) => s + byCat[c], 0);
    return { byCategory: byCat, bySource, workingCapital: wc, total };
  })();

  return {
    act, route, fuelPrice, labor, lines, externals, byCategory, F, v, finance, financing, contingencyPct, structure, direct,
    mobilization: { fuelPerActivation: mobFuelPerActivation, wearPerActivation: mobWearPerActivation },
    auxiliary: { fuelPerActivation: auxFuel, otherPerActivation: auxOther },
    materialsResale: q.pricing && q.pricing.materialsBilledSeparately === true && !q.materialsNotApplicable ? { fixed: resaleFixed, perDay: resalePerDay } : null,
    overtimeRevenue: labor.some((l) => l.overtimeRevenueFixed > 0 || l.overtimeRevenuePerDay > 0) ? { fixed: labor.reduce((s, l) => s + l.overtimeRevenueFixed, 0), perDay: labor.reduce((s, l) => s + l.overtimeRevenuePerDay, 0) } : null,
    perActivation,
  };
}

/** Salidas costeadas con "cada salida completa" (§2.1): C = ⌈A⌉ (si está activa). */
export function roundingAt(model, D) {
  if (!model.act.fullActivations) return { extra: 0, total: 0, byCategory: Object.fromEntries(ORACLE_CATEGORIES.map((c) => [c, 0])), bySource: {}, workingCapital: 0 };
  const A = D / model.act.dpa;
  const C = A > 1e-12 ? Math.ceil(A - 1e-9) : 0;
  const extra = Math.max(0, C - A);
  const p = model.perActivation;
  return {
    extra,
    total: p.total * extra,
    byCategory: Object.fromEntries(ORACLE_CATEGORIES.map((c) => [c, p.byCategory[c] * extra])),
    bySource: Object.fromEntries(Object.entries(p.bySource).map(([k, val]) => [k, val * extra])),
    workingCapital: p.workingCapital * extra,
  };
}

/** Costo del mes con D días (§1, §10): F × meses + v × D (+ ajuste por salidas completas). */
export function costAt(model, D) {
  const mf = monthsFactor(D, model.act.available);
  const rounding = roundingAt(model, D);
  const byCategory = Object.fromEntries(ORACLE_CATEGORIES.map((c) => [c, model.byCategory[c].fixed * mf + model.byCategory[c].variable * D + rounding.byCategory[c]]));
  return { D, mf, fixed: model.F * mf, variable: model.v * D + rounding.total, total: model.F * mf + model.v * D + rounding.total, byCategory, rounding };
}

// ------------------------------------------------------------------- facturación (§12, §14)

/** Impuestos sobre la facturación t (§13.1): sin definir, inválidos o "no aplica" → 0. */
export function billingTaxPct(raw) {
  const b = obj(raw);
  if (b.notApplicable === true) return { t: 0, defined: true, invalid: false };
  const read = (v) => (blank(v) ? null : readDecimal(typeof v === 'number' ? v : String(v)));
  const values = b.mode === 'detailed' ? list(b.items).map((it) => read(it.pct)) : [read(b.combinedPct)];
  const loaded = values.filter((x) => x !== null);
  const invalid = loaded.some((x) => !Number.isFinite(x) || x < 0) || loaded.filter(Number.isFinite).reduce((s, x) => s + Math.max(0, x), 0) >= 100;
  const total = loaded.filter(Number.isFinite).reduce((s, x) => s + Math.max(0, x), 0);
  return { t: invalid ? 0 : total, defined: !invalid && loaded.length > 0, invalid };
}

function normalizedTiers(rules) {
  const valid = list(rules.volumeTiers);
  const tiers = (valid.length ? valid : [{ fromDays: 1, discountPct: 0 }]).map((t) => ({ fromDays: n(t.fromDays), discountPct: Math.min(n(t.discountPct), 100) }));
  return tiers.sort((a, b) => a.fromDays - b.fromDays);
}

/** Factor de descuentos (§12): (1 − tramo) × (1 − continuidad) × (1 − comercial). Tramos sólo por día u hora. */
export function discountAt(q, act, billableDays) {
  const rules = obj(q.rules);
  let tierPct = 0;
  if ((act.kind === 'day' || act.kind === 'hour') && billableDays > 0) {
    for (const t of normalizedTiers(rules)) if (t.fromDays <= billableDays + 1e-9) tierPct = t.discountPct;
  }
  const contPct = Math.min(n(rules.continuityDiscountPct), 100);
  const continuity = contPct > 0 && n(rules.continuityMinMonths) > 0 && n(q.contractMonths) >= n(rules.continuityMinMonths) ? contPct : 0;
  const commercial = Math.min(n(obj(q.pricing).commercialDiscountPct), 100);
  return { tierPct, continuity, commercial, factor: (1 - tierPct / 100) * (1 - continuity / 100) * (1 - commercial / 100) };
}

/** Facturación del mes con D días y una tarifa de lista (§12). */
export function revenueAt(q, model, D, listRate) {
  const act = model.act;
  const rules = obj(q.rules);
  const u = billableAt(act, D);
  const months = monthsFactor(D, act.available);
  const disc = discountAt(q, act, u.billableDays);
  const net = n(listRate) * disc.factor;
  const standbyOff = rules.standbyNotApplicable === true;
  const extraKmPerActivation = Math.max(0, model.route.routeKmPerActivation - n(rules.includedKmPerActivation));
  const other = {
    availabilityFee: n(rules.availabilityFeeMonthly) * months,
    callout: n(rules.calloutFeePerActivation) * u.A,
    mobilization: n(rules.mobilizationFeePerActivation) * u.A,
    extraKm: extraKmPerActivation * n(rules.extraKmRate) * u.A,
    standby: (standbyOff ? 0 : n(rules.standbyDaysPerMonth) * n(rules.standbyRatePerDay)) * months,
    materials: model.materialsResale ? model.materialsResale.fixed * months + model.materialsResale.perDay * D : 0,
    overtime: model.overtimeRevenue ? model.overtimeRevenue.fixed * months + model.overtimeRevenue.perDay * D : 0,
  };
  const otherTotal = Object.values(other).reduce((s, x) => s + x, 0);
  const base = net * u.units;
  const guarantee = n(rules.minimumMonthlyGuarantee) * months;
  const subtotal = base + otherTotal;
  const topUp = Math.max(0, guarantee - subtotal);
  return { ...u, months, discount: disc, net, base, other, otherTotal, guarantee, topUp, total: subtotal + topUp };
}

// --------------------------------------------------------------------- precios (§11, §13)

/** Margen objetivo como lo lee la validación (§13): vacío → 0 (completitud), inválido → null. */
export function readMargin(raw) {
  if (blank(raw) || (typeof raw === 'string' && raw.trim() === '')) return { state: 'empty', value: 0 };
  const x = typeof raw === 'number' ? raw : readDecimal(String(raw));
  return Number.isFinite(x) && x >= 0 && x < 100 ? { state: 'ok', value: x } : { state: 'invalid', value: null };
}

/** Tarifa NETA necesaria para un margen m con D días (§13): (Costo / (1 − m − t) − otros ingresos) / unidades. */
export function requiredNetRate(q, model, D, marginPct, t) {
  if (!(marginPct + t < 100)) return null;
  const cost = costAt(model, D).total;
  const rev0 = revenueAt(q, model, D, 0);
  const needed = (cost * 100) / (100 - marginPct - t);
  const rate = div(needed - rev0.otherTotal, rev0.units, null);
  if (rate === null) return null;
  return { net: Math.max(0, rate), list: div(Math.max(0, rate), rev0.discount.factor, null), requiredRevenue: needed, covered: rate < 0 };
}

/** Redondeo comercial hacia arriba al múltiplo del paso (§13): nunca baja el margen. */
export const commercialRound = (price, step) => (price === null || !Number.isFinite(price) ? null : n(step) > 0 ? Math.ceil(price / n(step) - 1e-9) * n(step) : price);

/**
 * Múltiplo del redondeo de la sugerida (ECO-03, escrito desde CALCULATION_RULES §13, sin importar la app):
 * con `roundingMode: 'auto'`, la potencia de 10 más grande que no supere el tope (`roundingMaxPct`, 1 % si
 * falta o no es válido, 0 a 10) aplicado a la objetivo; si ese tope no llega a $ 1, sin redondeo. Sin
 * `roundingMode` o con 'step', el múltiplo guardado.
 */
export function oracleRoundingStep(pricing, target) {
  if (pricing.roundingMode !== 'auto') return n(pricing.roundingStep);
  const raw = Number(pricing.roundingMaxPct);
  const maxPct = pricing.roundingMaxPct !== null && pricing.roundingMaxPct !== '' && Number.isFinite(raw) && raw >= 0 && raw <= 10 ? raw : 1;
  if (target === null || !Number.isFinite(target) || target <= 0) return 0;
  const room = (target * maxPct) / 100;
  if (room < 1) return 0;
  return 10 ** Math.floor(Math.log10(room) + 1e-12);
}

/** Resultado con D días y una tarifa de lista (§13): facturación − impuestos − costo. */
export function evaluate(q, model, D, listRate, t) {
  const cost = costAt(model, D);
  const revenue = revenueAt(q, model, D, listRate);
  const taxes = (revenue.total * t) / 100;
  return { cost, revenue, taxes, profit: revenue.total - taxes - cost.total };
}

/**
 * Equilibrio (§15): menor D desde el cual el resultado ya no es negativo hasta
 * los días disponibles. Búsqueda propia (grilla fina + bisección), con los
 * saltos de "cada salida completa" como puntos de control.
 */
export function breakEvenSearch(fn, maxDays, breakpoints = []) {
  const points = new Set();
  const steps = Math.ceil(maxDays / 0.01);
  for (let i = 0; i <= steps; i += 1) points.add(Math.min(maxDays, i * 0.01));
  // Cada salto (una salida nueva empieza justo DESPUÉS del entero) puede abrir una ventana de pérdida angosta.
  for (const b of breakpoints) if (b <= maxDays) { points.add(b); points.add(Math.max(0, b - 1e-7)); if (b + 1e-7 <= maxDays) points.add(b + 1e-7); }
  const grid = [...points].sort((a, b) => a - b);
  let lastNeg = -1;
  grid.forEach((d, i) => { if (fn(d) < -1e-6) lastNeg = i; });
  if (lastNeg === -1) return { reachable: true, days: 0 };
  if (lastNeg === grid.length - 1) return { reachable: false, days: null };
  let lo = grid[lastNeg];
  let hi = grid[lastNeg + 1];
  for (let k = 0; k < 200 && hi - lo > 1e-12; k += 1) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < -1e-6) lo = mid; else hi = mid;
  }
  return { reachable: true, days: hi };
}

// ------------------------------------------------------------------------- cotización

/**
 * Cotización completa según el oráculo.
 * @param {object} q cotización (la misma entrada que computeQuote)
 * @param {{ listRateOverride?: number|null }} [options]
 */
export function oracleQuote(q, { listRateOverride = null } = {}) {
  const model = oracleModel(q);
  const act = model.act;
  const D = act.D;
  const taxes = billingTaxPct(q.billingTaxes);
  const t = taxes.t;
  const pricing = obj(q.pricing);
  const margin = readMargin(pricing.targetMarginPct);
  const targetMarginInvalid = margin.state === 'invalid' || !(margin.value + t < 100);
  const m = margin.value ?? 0;

  const floor = requiredNetRate(q, model, D, 0, t);
  const target = targetMarginInvalid ? null : requiredNetRate(q, model, D, m, t);
  const suggested = commercialRound(target ? target.list : null, oracleRoundingStep(pricing, target ? target.list : null));

  let commercial = null;
  let source = 'none';
  if (listRateOverride !== null && Number.isFinite(listRateOverride)) { commercial = n(listRateOverride); source = 'override'; }
  else if (q.pricingMode === 'known_rate') { commercial = n(pricing.knownRate) > 0 ? n(pricing.knownRate) : null; source = 'known_rate'; }
  else if (n(pricing.offeredRateOverride) > 0) { commercial = n(pricing.offeredRateOverride); source = 'offered'; }
  else if (suggested !== null && Number.isFinite(suggested)) { commercial = suggested; source = 'suggested'; }
  const hasRate = commercial !== null && commercial > 0;

  const est = evaluate(q, model, D, hasRate ? commercial : 0, t);
  const revenue = est.revenue.total;
  const marginPct = hasRate ? div((revenue - est.cost.total - est.taxes) * 100, revenue, null) : null;
  const markupPct = hasRate ? div((revenue - est.cost.total) * 100, est.cost.total, null) : null;

  // Equilibrio y días para el margen objetivo (§15).
  let breakEven = { reachable: false, days: null, notApplicable: act.kind === 'month' };
  let targetDays = { reachable: false, days: null };
  if (act.kind !== 'month' && hasRate) {
    const bps = act.fullActivations ? Array.from({ length: Math.floor(act.available / act.dpa + 1e-9) }, (_, k) => (k + 1) * act.dpa) : [];
    breakEven = breakEvenSearch((d) => evaluate(q, model, d, commercial, t).profit, act.available, bps);
    if (!targetMarginInvalid) {
      targetDays = breakEvenSearch((d) => {
        const e = evaluate(q, model, d, commercial, t);
        return e.profit - (m / 100) * e.revenue.total;
      }, act.available, bps);
    }
  }
  const quantityAt = (days) => (days === null ? null : billableAt(act, days).units);
  const zeroReason = breakEven.reachable && breakEven.days !== null && breakEven.days <= 1e-9 ? (model.F > 0.005 ? 'fixed_revenue' : 'no_fixed_costs') : null;

  // Transporte (§5.2): viajes físicos y km del mes.
  const route = model.route;
  const transport = {
    physicalTripsPerMonth: act.A * route.tripsPerActivation,
    kmPerTrip: route.kmPerTrip,
    routeKmPerMonth: act.A * route.routeKmPerActivation,
    providers: model.externals.filter((x) => x.unit === 'km' || x.unit === 'trip').map((x) => ({ index: x.index, unit: x.unit, unitsPerMonth: n(x.billedPerActivation) * act.A, netMonthly: x.netPerActivation * act.A })),
  };

  // Externos: costo económico, salida de caja y crédito fiscal del mes (§4.1).
  const mf = est.cost.mf;
  const extLines = model.lines.filter((l) => l.key.startsWith('external:') && !l.key.startsWith('external:fuel'));
  const rounding = est.cost.rounding;
  // Sin el combustible no incluido (va a Combustible): tarifa y movilización del proveedor.
  const extRoundingEconomic = extLines.reduce((s, l) => s + l.discrete, 0) * rounding.extra;
  const extEconomic = extLines.reduce((s, l) => s + l.fixed * mf + l.variable * D, 0) + extRoundingEconomic;
  const extCashRounding = extLines.reduce((s, l) => s + (l.cashDiscrete ?? l.discrete), 0) * rounding.extra;
  const extCash = extLines.reduce((s, l) => s + (l.cashFixed ?? l.fixed) * mf + (l.cashVariable ?? l.variable) * D, 0) + extCashRounding;
  const extCredit = extLines.reduce((s, l) => s + (l.credit ? l.credit.fixed * mf + l.credit.variable * D : 0), 0) + Math.max(0, extCashRounding - extRoundingEconomic);

  return {
    model,
    activity: act,
    t,
    taxesDefined: taxes.defined,
    targetMarginInvalid,
    kpis: {
      activeDays: D,
      activations: act.A,
      billableQuantity: est.revenue.units,
      totalCost: est.cost.total,
      fixedCosts: est.cost.fixed,
      variableCosts: est.cost.variable,
      floorNetRate: floor ? floor.net : null,
      floorListRate: floor ? floor.list : null,
      targetNetRate: target ? target.net : null,
      targetListRate: target ? target.list : null,
      suggestedListRate: suggested,
      commercialListRate: hasRate ? commercial : null,
      commercialNetRate: hasRate ? est.revenue.net : null,
      commercialSource: hasRate ? source : 'none',
      revenue,
      billingTaxes: est.taxes,
      profit: est.profit,
      marginPct,
      markupPct,
      breakEvenDays: breakEven.days,
      breakEvenQuantity: breakEven.reachable ? quantityAt(breakEven.days) : null,
      breakEvenZeroReason: zeroReason,
      targetMarginDays: targetDays.days,
      financialCost: est.cost.byCategory.financial,
      workingCapital: model.finance.wcFixed * mf + model.finance.wcVariable * D + rounding.workingCapital,
      logisticsMonthly: (model.mobilization.fuelPerActivation + model.mobilization.wearPerActivation + model.auxiliary.fuelPerActivation + model.auxiliary.otherPerActivation) / act.dpa * D + (rounding.bySource.logistics || 0) + (rounding.bySource.mobilization || 0),
      externalMonthly: extEconomic,
      externalCashMonthly: extCash,
      externalTaxCreditMonthly: extCredit,
      contingency: est.cost.byCategory.contingency,
      structure: est.cost.byCategory.structure,
    },
    byCategory: est.cost.byCategory,
    revenueDetail: est.revenue,
    transport,
  };
}
