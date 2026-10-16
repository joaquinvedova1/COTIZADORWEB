/**
 * RATEOS Test Lab — propiedades económicas (invariantes y relaciones
 * metamórficas) del MOTOR PRODUCTIVO (PLAN-2026-013).
 *
 * Cada invariante muta una copia de la cotización (o la evalúa tal cual) y
 * verifica una propiedad que tiene que valer siempre: "subir el margen nunca
 * baja la tarifa objetivo", "el proveedor por km sigue a los km físicos"…
 * No dependen de valores esperados: detectan contradicciones internas.
 */

import { computeQuote } from '../../../js/engines/quote-engine.js';
import { computeProduct } from '../../../js/engines/product-engine.js';
import { priceComposition } from '../../../js/engines/price-composition-engine.js';
import { findNonFinite } from './compare.js';

const TOL = (x) => Math.max(0.01, Math.abs(Number(x) || 0) * 1e-9);
const clone = (x) => structuredClone(x);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const isExt = (e) => e.acquisition === 'rented' || e.acquisition === 'outsourced';
const run = (q, opts) => computeQuote(q, opts);
/** Cotizaciones con reglas que vuelven no lineal la facturación (no aplican relaciones lineales simples). */
const nonLinear = (q) => {
  const r = q.rules || {};
  return Number(r.minimumMonthlyGuarantee) > 0 || Number(r.minimumCallUnits) > 0 || list(r.volumeTiers).some((t) => Number(t.discountPct) > 0) || (q.activity && q.activity.fullActivations === true);
};
const D = (r) => r.kpis.activeDays;
const avail = (r) => r.activity.availableDaysPerMonth;
const extEconomic = (r, i) => {
  const x = r.model.external.find((e) => e.index === i);
  return x ? x.fixedMonthly * (r.kpis.activeDays > avail(r) ? r.kpis.activeDays / avail(r) : 1) + (x.variablePerActiveDay + x.mobilizationPerActiveDay) * D(r) : 0;
};
const extNet = (r, i) => {
  const x = r.model.external.find((e) => e.index === i);
  return x ? x.netFixedMonthly + x.netPerActiveDay * D(r) : 0;
};
const ok = (detail = '') => ({ ok: true, detail });
const fail = (detail) => ({ ok: false, detail });
const notApplicable = { ok: true, na: true, detail: 'no aplica a este escenario' };

/** Cambia la actividad del mes (días, o cantidad en la unidad comercial). */
function scaleActivity(q, factor) {
  const a = q.activity || {};
  if (['m3', 'trip', 'km', 'ton', 'tonkm', 'unit', 'kg', 'meter', 'm2', 'lot', 'shift', 'custom', 'call', 'job', 'milestone'].includes(q.unit)) a.billableQuantityPerMonth = Number(a.billableQuantityPerMonth || 0) * factor;
  else a.activeDaysPerMonth = Number(a.activeDaysPerMonth || 0) * factor;
  q.activity = a;
  return q;
}

export const QUOTE_INVARIANTS = [
  {
    id: 'INV-01', title: 'Subir el margen objetivo nunca baja la tarifa objetivo',
    check(q, r) {
      const m = Number(q.pricing && q.pricing.targetMarginPct);
      if (!(r.kpis.targetListRate > 0) || !(m + 5 + r.kpis.billingTaxPct < 100)) return notApplicable;
      const q2 = clone(q); q2.pricing.targetMarginPct = m + 5;
      const r2 = run(q2);
      return r2.kpis.targetListRate >= r.kpis.targetListRate - TOL(r.kpis.targetListRate) ? ok(`${Math.round(r.kpis.targetListRate)} → ${Math.round(r2.kpis.targetListRate)}`) : fail(`margen ${m} → ${m + 5}: objetivo ${r.kpis.targetListRate} → ${r2.kpis.targetListRate}`);
    },
  },
  {
    id: 'INV-02', title: 'Subir un costo positivo nunca baja el costo total',
    check(q, r) {
      const muts = [
        ['sueldos +10 %', (x) => list(x.labor).forEach((l) => { l.basicMonthly = Number(l.basicMonthly || 0) * 1.1; })],
        ['reposición +10 %', (x) => list(x.equipment).filter((e) => !isExt(e)).forEach((e) => { e.replacementValue = Number(e.replacementValue || 0) * 1.1; })],
        ['tarifas externas +10 %', (x) => list(x.equipment).filter(isExt).forEach((e) => { e.external.price = Number(e.external.price || 0) * 1.1; })],
        ['materiales +10 %', (x) => list(x.materials).forEach((m) => { m.unitCost = Number(m.unitCost || 0) * 1.1; })],
        ['combustible +10 %', (x) => { x.fuel.pricePerLiter = Number(x.fuel.pricePerLiter || 0) * 1.1; }],
        ['distancia +10 %', (x) => { if (x.logistics) x.logistics.distanceKm = Number(x.logistics.distanceKm || 0) * 1.1; }],
        ['tasa financiera +1', (x) => { x.finance.monthlyRatePct = Number(x.finance.monthlyRatePct || 0) + 1; }],
        ['contingencia +1', (x) => { x.risk.generalPct = Number(x.risk.generalPct || 0) + 1; }],
      ];
      const bad = [];
      for (const [label, mutate] of muts) {
        const q2 = clone(q); mutate(q2);
        const r2 = run(q2);
        if (r2.kpis.totalCost < r.kpis.totalCost - TOL(r.kpis.totalCost)) bad.push(`${label}: ${r.kpis.totalCost} → ${r2.kpis.totalCost}`);
      }
      return bad.length ? fail(bad.join(' · ')) : ok(`${muts.length} subas`);
    },
  },
  {
    id: 'INV-03', title: 'Los costos fijos no desaparecen al bajar la actividad',
    check(q, r) {
      if (!(D(r) > 0)) return notApplicable;
      const r2 = run(scaleActivity(clone(q), 0.5));
      const sameFixed = Math.abs(r2.model.fixedMonthly - r.model.fixedMonthly) <= TOL(r.model.fixedMonthly);
      return sameFixed && r2.kpis.totalCost >= r2.model.fixedMonthly - TOL(r2.model.fixedMonthly) ? ok(`fijos ${Math.round(r.model.fixedMonthly)}`) : fail(`fijos ${r.model.fixedMonthly} → ${r2.model.fixedMonthly} con la mitad de actividad`);
    },
  },
  {
    id: 'INV-04', title: 'Los costos variables escalan con su driver (actividad × 2 → variables × 2)',
    check(q, r) {
      if (!(D(r) > 0) || D(r) * 2 > avail(r) || nonLinear(q)) return notApplicable;
      const r2 = run(scaleActivity(clone(q), 2));
      const v1 = r.kpis.totalCost - r.model.fixedMonthly;
      const v2 = r2.kpis.totalCost - r2.model.fixedMonthly;
      return Math.abs(v2 - 2 * v1) <= TOL(v2) * 10 ? ok(`variables ${Math.round(v1)} → ${Math.round(v2)}`) : fail(`variables ${v1} → ${v2} (esperado ${2 * v1})`);
    },
  },
  {
    id: 'INV-05', title: 'Un externo por km sigue a los km físicos (distancia × 2 → proveedor × 2)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.unit === 'km' && !(Number(e.external.minimumUnits) > 0) && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length || !(r.model.logistics.routeKmPerActivation > 0)) return notApplicable;
      const q2 = clone(q); q2.logistics.distanceKm = Number(q2.logistics.distanceKm) * 2;
      const r2 = run(q2);
      const bad = idx.filter((i) => Math.abs(extNet(r2, i) - 2 * extNet(r, i)) > TOL(extNet(r2, i)));
      return bad.length ? fail(`externo ${bad[0]}: ${extNet(r, bad[0])} → ${extNet(r2, bad[0])}`) : ok(`km de ruta ${r.model.transport.routeKmPerMonth} → ${r2.model.transport.routeKmPerMonth}`);
    },
  },
  {
    id: 'INV-06', title: 'Un externo por viaje sigue a los tramos físicos (ida y vuelta → sólo ida = la mitad)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.unit === 'trip' && !(Number(e.external.minimumUnits) > 0) && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length || !(q.logistics && q.logistics.roundTrip !== false) || !(r.model.logistics.routeKmPerActivation > 0)) return notApplicable;
      const q2 = clone(q); q2.logistics.roundTrip = false;
      const r2 = run(q2);
      const bad = idx.filter((i) => Math.abs(2 * extNet(r2, i) - extNet(r, i)) > TOL(extNet(r, i)));
      return bad.length ? fail(`externo ${bad[0]}: ${extNet(r, bad[0])} → ${extNet(r2, bad[0])}`) : ok('tramos ÷ 2');
    },
  },
  {
    id: 'INV-07', title: 'Un externo por día sigue a los días de trabajo (× 2 → × 2)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.unit === 'day' && !(Number(e.external.minimumUnits) > 0) && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length || !(D(r) > 0) || D(r) * 2 > avail(r) || nonLinear(q)) return notApplicable;
      const r2 = run(scaleActivity(clone(q), 2));
      const bad = idx.filter((i) => Math.abs(extNet(r2, i) - 2 * extNet(r, i)) > TOL(extNet(r2, i)));
      return bad.length ? fail(`externo ${bad[0]}: ${extNet(r, bad[0])} → ${extNet(r2, bad[0])}`) : ok('días × 2');
    },
  },
  {
    id: 'INV-08', title: 'Un externo por hora sigue a las horas (horas por día × 2 → × 2)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.unit === 'hour' && !(Number(e.external.minimumUnits) > 0) && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length || !(D(r) > 0)) return notApplicable;
      const q2 = clone(q);
      idx.forEach((i) => { const e = q2.equipment[i]; const h = e.hoursPerActiveDay === null || e.hoursPerActiveDay === undefined || e.hoursPerActiveDay === '' ? Number(q2.activity.hoursPerActiveDay) : Number(e.hoursPerActiveDay); e.hoursPerActiveDay = h * 2; });
      const r2 = run(q2);
      const bad = idx.filter((i) => Math.abs(extNet(r2, i) - 2 * extNet(r, i)) > TOL(extNet(r2, i)));
      return bad.length ? fail(`externo ${bad[0]}: ${extNet(r, bad[0])} → ${extNet(r2, bad[0])}`) : ok('horas × 2');
    },
  },
  {
    id: 'INV-09', title: 'Un externo por mes conserva su componente mensual (no depende de los días)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.unit === 'month' && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length || !(D(r) > 1)) return notApplicable;
      const r2 = run(scaleActivity(clone(q), 0.5));
      const bad = idx.filter((i) => Math.abs(extNet(r2, i) - extNet(r, i)) > TOL(extNet(r, i)));
      return bad.length ? fail(`externo ${bad[0]}: ${extNet(r, bad[0])} → ${extNet(r2, bad[0])}`) : ok('mensual igual');
    },
  },
  {
    id: 'INV-10', title: 'Cambiar viajes por día no cambia los km si los viajes físicos son los mismos',
    check(q, r) {
      // Con mínimo del proveedor por salida, más salidas cobran más mínimos: es correcto que cambie.
      const minimum = list(q.equipment).some((e) => isExt(e) && Number(e.external.minimumUnits) > 0);
      if (q.unit !== 'trip' || minimum || Number(q.rules && q.rules.minimumCallUnits) > 0 || !(r.model.transport.routeKmPerMonth > 0) || q.activity.fullActivations === true) return notApplicable;
      const per = Number(q.activity.unitsPerActiveDay);
      const results = [1, 2, 3].filter((x) => x !== per).map((x) => { const q2 = clone(q); q2.activity.unitsPerActiveDay = x; return run(q2); });
      // Sólo los proveedores por km o por viaje siguen a la ruta (por día u hora siguen a los días: es correcto que cambien).
      const routeProviders = (res) => (res.model.transport.providers || []).reduce((s, p) => s + p.netMonthly, 0);
      const bad = results.filter((r2) => Math.abs(r2.model.transport.routeKmPerMonth - r.model.transport.routeKmPerMonth) > 1e-6 || Math.abs(routeProviders(r2) - routeProviders(r)) > TOL(routeProviders(r)));
      return bad.length ? fail(`km ${r.model.transport.routeKmPerMonth} → ${bad[0].model.transport.routeKmPerMonth}; proveedores por km/viaje ${routeProviders(r)} → ${routeProviders(bad[0])}`) : ok(`${r.model.transport.routeKmPerMonth} km con 1, 2 y 3 viajes por día`);
    },
  },
  {
    id: 'INV-11', title: 'Combustible incluido: el precio del combustible no afecta a ese recurso',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && e.external.fuelIncluded === true).map(([, i]) => i);
      if (!idx.length) return notApplicable;
      const q2 = clone(q); q2.fuel.pricePerLiter = Number(q2.fuel.pricePerLiter || 0) * 2 + 100;
      const r2 = run(q2);
      const fuelLines = (res, i) => res.model.lines.filter((l) => l.key === `external:fuel:${q.equipment[i].id ?? i}`).reduce((s, l) => s + l.variablePerActiveDay, 0);
      const bad = idx.filter((i) => Math.abs(extEconomic(r2, i) - extEconomic(r, i)) > TOL(extEconomic(r, i)) || fuelLines(r2, i) > 0);
      return bad.length ? fail(`externo ${bad[0]} cambió con el precio del combustible`) : ok('sin cambios');
    },
  },
  {
    id: 'INV-12', title: 'Combustible provisto por el cliente: nuestro costo de combustible es 0',
    check(q) {
      const q2 = clone(q); q2.fuel.providedBy = 'client';
      const r2 = run(q2);
      const fuelOther = list(q.otherCosts).filter((o) => o.category === 'fuel').length;
      if (fuelOther) return notApplicable;
      const row = r2.eecc.rows.find((x) => x.category === 'fuel');
      return row.amount <= 0.005 ? ok('Combustible = $ 0') : fail(`Combustible = ${row.amount} con el combustible del cliente`);
    },
  },
  {
    id: 'INV-13', title: 'IVA 100 % recuperable no aumenta el costo económico (sí la caja y el financiamiento)',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e) && Number(e.external.price) > 0).map(([, i]) => i);
      if (!idx.length) return notApplicable;
      const noVat = clone(q); idx.forEach((i) => { noVat.equipment[i].external.fiscal = { vatPct: 0, vatRecoverable: 'yes', perceptionsPct: 0, nonRecoverablePct: 0 }; });
      const vat = clone(q); idx.forEach((i) => { vat.equipment[i].external.fiscal = { vatPct: 21, vatRecoverable: 'yes', perceptionsPct: 0, nonRecoverablePct: 0 }; });
      const a = run(noVat);
      const b = run(vat);
      const econSame = Math.abs(a.kpis.externalMonthly - b.kpis.externalMonthly) <= TOL(a.kpis.externalMonthly);
      const cashUp = b.kpis.externalCashMonthly >= a.kpis.externalCashMonthly - TOL(a.kpis.externalCashMonthly);
      const finNotDown = b.kpis.financialCost >= a.kpis.financialCost - TOL(a.kpis.financialCost);
      return econSame && cashUp && finNotDown ? ok(`caja ${Math.round(a.kpis.externalCashMonthly)} → ${Math.round(b.kpis.externalCashMonthly)}; financiero ${Math.round(a.kpis.financialCost)} → ${Math.round(b.kpis.financialCost)}`) : fail(`econ ${a.kpis.externalMonthly}→${b.kpis.externalMonthly}, caja ${a.kpis.externalCashMonthly}→${b.kpis.externalCashMonthly}, fin ${a.kpis.financialCost}→${b.kpis.financialCost}`);
    },
  },
  {
    id: 'INV-14', title: 'Más plazo de cobro nunca reduce el financiamiento',
    check(q, r) {
      const q2 = clone(q); q2.finance.paymentTermDays = Number(q2.finance.paymentTermDays || 0) + 30;
      const r2 = run(q2);
      return r2.kpis.financialCost >= r.kpis.financialCost - TOL(r.kpis.financialCost) ? ok(`${Math.round(r.kpis.financialCost)} → ${Math.round(r2.kpis.financialCost)}`) : fail(`${r.kpis.financialCost} → ${r2.kpis.financialCost}`);
    },
  },
  {
    id: 'INV-15', title: 'Más plazo de pago al proveedor nunca aumenta los días financiados',
    check(q, r) {
      const idx = list(q.equipment).map((e, i) => [e, i]).filter(([e]) => isExt(e)).map(([, i]) => i);
      if (!idx.length) return notApplicable;
      const q2 = clone(q); idx.forEach((i) => { const cur = q2.equipment[i].supplierPayDays; q2.equipment[i].supplierPayDays = (cur === null || cur === undefined || cur === '' ? Number(q2.finance.payDays.suppliers || 0) : Number(cur)) + 30; });
      const r2 = run(q2);
      return r2.kpis.financialCost <= r.kpis.financialCost + TOL(r.kpis.financialCost) ? ok(`${Math.round(r.kpis.financialCost)} → ${Math.round(r2.kpis.financialCost)}`) : fail(`${r.kpis.financialCost} → ${r2.kpis.financialCost}`);
    },
  },
  {
    id: 'INV-16', title: 'Margen ≥ 100 % sigue siendo inválido (sin tarifa sugerida)',
    check(q) {
      const q2 = clone(q); q2.pricing.targetMarginPct = 100;
      const r2 = run(q2);
      return r2.targetMarginInvalid && r2.kpis.suggestedListRate === null ? ok('inválido') : fail(`margen 100 % → sugerida ${r2.kpis.suggestedListRate}`);
    },
  },
  {
    id: 'INV-17', title: 'La tarifa piso recupera el costo con los impuestos configurados (resultado ≈ 0)',
    check(q, r) {
      const rr = q.rules || {};
      if (!(r.kpis.floorListRate > 0) || Number(rr.minimumMonthlyGuarantee) > 0 || r.ratesAtEstimate.floorCoveredByOtherRevenue) return notApplicable;
      const r2 = run(q, { listRateOverride: r.kpis.floorListRate });
      return Math.abs(r2.kpis.profit) <= Math.max(1, r2.kpis.revenue * 1e-9) ? ok(`resultado ${r2.kpis.profit.toFixed(4)}`) : fail(`con la tarifa piso el resultado es ${r2.kpis.profit}`);
    },
  },
  {
    id: 'INV-18', title: 'La tarifa objetivo logra exactamente el margen objetivo',
    check(q, r) {
      const rr = q.rules || {};
      if (!(r.kpis.targetListRate > 0) || Number(rr.minimumMonthlyGuarantee) > 0 || r.targetMarginInvalid) return notApplicable;
      const r2 = run(q, { listRateOverride: r.kpis.targetListRate });
      return Math.abs(r2.kpis.marginPct - r.kpis.targetMarginPct) <= 1e-6 ? ok(`margen ${r2.kpis.marginPct.toFixed(4)} %`) : fail(`margen ${r2.kpis.marginPct} ≠ ${r.kpis.targetMarginPct}`);
    },
  },
  {
    id: 'INV-19', title: 'Facturación = costo + impuestos + resultado (y margen = resultado / facturación)',
    check(q, r) {
      const k = r.kpis;
      const idOk = Math.abs(k.revenue - (k.totalCost + k.billingTaxes + k.profit)) <= TOL(k.revenue);
      const mOk = k.marginPct === null || Math.abs(k.marginPct - (k.profit / k.revenue) * 100) <= 1e-6;
      return idOk && mOk ? ok('cierra') : fail(`facturación ${k.revenue} ≠ ${k.totalCost} + ${k.billingTaxes} + ${k.profit}; margen ${k.marginPct}`);
    },
  },
  {
    id: 'INV-20', title: 'Descuentos: tarifa neta = lista × factor, sin métricas contradictorias',
    check(q, r) {
      const k = r.kpis;
      if (!(k.commercialListRate > 0)) return notApplicable;
      const factor = r.estimate.revenue.discountFactor;
      const netOk = Math.abs(k.commercialNetRate - k.commercialListRate * factor) <= TOL(k.commercialNetRate);
      const comp = priceComposition(r);
      const checksOk = !comp || !comp.checks || comp.checks.every((c) => c.ok !== false);
      return netOk && checksOk ? ok(`factor ${factor.toFixed(6)}`) : fail(`neta ${k.commercialNetRate} vs ${k.commercialListRate} × ${factor}; checks: ${comp && comp.checks ? comp.checks.filter((c) => c.ok === false).map((c) => c.id || c.label).join(', ') : '—'}`);
    },
  },
  {
    id: 'INV-21', title: 'Un recurso compartido reduce sólo sus costos FIJOS (las variables no se reducen)',
    check(q, r) {
      const shared = [...list(q.labor).map((l, i) => ['labor', i, l]), ...list(q.equipment).map((e, i) => ['equipment', i, e]).filter(([, , e]) => !isExt(e))];
      if (!shared.length) return notApplicable;
      const [kind, i] = shared[0];
      const full = clone(q); full[kind][i].assignment = kind === 'labor' ? 'dedicated' : 'reserved'; delete full[kind][i].fixedCostSharePct;
      const half = clone(q); half[kind][i].assignment = 'shared'; half[kind][i].fixedCostSharePct = 50;
      const a = run(full);
      const b = run(half);
      const line = (res) => (kind === 'labor' ? res.model.labor.lines[i] : res.model.equipment[i]);
      const fixedA = line(a).fixedMonthly;
      const fixedB = line(b).fixedMonthly;
      const otMonthly = kind === 'labor' ? line(a).perPerson.overtimeMonthly * line(a).headcount : 0;
      const expectedB = (fixedA - otMonthly) * 0.5 + otMonthly;
      const varSame = Math.abs(line(a).variablePerActiveDay - line(b).variablePerActiveDay) <= TOL(line(a).variablePerActiveDay) && Math.abs(a.model.variablePerActiveDay - b.model.variablePerActiveDay) <= TOL(a.model.variablePerActiveDay) * 10;
      const fixedOk = Math.abs(fixedB - expectedB) <= TOL(fixedB);
      return fixedOk && varSame ? ok(`${kind} ${i}: fijo ${Math.round(fixedA)} → ${Math.round(fixedB)}; variable igual`) : fail(`${kind} ${i}: fijo ${fixedA} → ${fixedB} (esperado ${expectedB}); variable ${line(a).variablePerActiveDay} → ${line(b).variablePerActiveDay}`);
    },
  },
  {
    id: 'INV-22', title: 'Nunca NaN, Infinity ni −Infinity en indicadores, EECC, trazas, matriz y tramos',
    check(q, r) {
      const bad = findNonFinite({ kpis: r.kpis, eecc: r.eecc, traces: r.traces, matrix: r.matrix, discounts: r.discounts, equivalents: r.equivalents, linear: r.linear });
      return bad.length ? fail(bad.slice(0, 5).join(', ')) : ok('todo finito');
    },
  },
  {
    id: 'INV-23', title: 'La EECC suma el costo total y sus % mostrados suman 100',
    check(q, r) {
      const sum = r.eecc.rows.reduce((s, x) => s + x.amount, 0);
      const pctSum = r.eecc.rows.reduce((s, x) => s + x.displayPct, 0);
      const okSum = Math.abs(sum - r.kpis.totalCost) <= TOL(r.kpis.totalCost);
      const okPct = r.kpis.totalCost > 0 ? Math.abs(pctSum - 100) < 1e-6 : true;
      return okSum && okPct ? ok('cierra') : fail(`Σ filas ${sum} vs costo ${r.kpis.totalCost}; Σ % ${pctSum}`);
    },
  },
  {
    id: 'INV-24', title: 'Cada número central tiene su "Ver cálculo" y la traza termina en ese número',
    check(q, r) {
      const pairs = [
        ['totalCost', 'totalCost'], ['floorRate', 'floorListRate'], ['targetRate', 'targetListRate'], ['financialCost', 'financialCost'], ['logistics', 'logisticsMonthly'],
      ];
      const bad = [];
      for (const [trace, kpi] of pairs) {
        const t = r.traces[trace];
        if (!t || !t.result) { bad.push(`falta la traza ${trace}`); continue; }
        const a = num(t.result.value);
        const b = num(r.kpis[kpi]);
        if (!(a === null && b === null) && !(a !== null && b !== null && Math.abs(a - b) <= TOL(b))) bad.push(`${trace}: traza ${a} ≠ ${kpi} ${b}`);
      }
      return bad.length ? fail(bad.join(' · ')) : ok(`${pairs.length} trazas cierran`);
    },
  },
  {
    id: 'INV-25', title: 'El equilibrio es una raíz: en ese punto ya no se pierde y justo antes sí',
    check(q, r) {
      const be = r.kpis.breakEvenDays;
      if (!(be > 0.05) || q.activity.fullActivations === true) return notApplicable;
      const at = run(q, {}).breakEven;
      if (!at.reachable) return notApplicable;
      const ctxProfit = (d) => { const q2 = scaleTo(q, r, d); return q2 ? run(q2, { listRateOverride: r.kpis.commercialListRate }).kpis.profit : null; };
      // Justo antes (1e-4 días): con tramos de descuento puede haber un salto, así que nunca "un poco antes".
      const pAt = ctxProfit(be);
      const pBefore = ctxProfit(Math.max(0, be - 1e-4));
      if (pAt === null || pBefore === null) return notApplicable;
      return pAt >= -1 && pBefore < 1e-3 ? ok(`D* = ${be.toFixed(4)}`) : fail(`resultado en D* ${pAt}; justo antes ${pBefore}`);
    },
  },
  {
    id: 'INV-26', title: 'Sugerida ≥ objetivo ≥ piso (con margen ≥ 0)',
    check(q, r) {
      const k = r.kpis;
      if (!(k.suggestedListRate > 0 && k.targetListRate > 0 && k.floorListRate !== null)) return notApplicable;
      return k.suggestedListRate >= k.targetListRate - TOL(k.targetListRate) && k.targetListRate >= k.floorListRate - TOL(k.floorListRate) ? ok('ordenadas') : fail(`sugerida ${k.suggestedListRate}, objetivo ${k.targetListRate}, piso ${k.floorListRate}`);
    },
  },
  {
    id: 'INV-27', title: 'Más impuestos sobre la facturación nunca bajan la tarifa piso',
    check(q, r) {
      if (!(r.kpis.floorListRate > 0) || r.kpis.billingTaxPct + 1 >= 100) return notApplicable;
      const q2 = clone(q); q2.billingTaxes = { mode: 'combined', notApplicable: false, combinedPct: r.kpis.billingTaxPct + 1, items: [] };
      const r2 = run(q2);
      return r2.kpis.floorListRate >= r.kpis.floorListRate - TOL(r.kpis.floorListRate) ? ok(`${Math.round(r.kpis.floorListRate)} → ${Math.round(r2.kpis.floorListRate)}`) : fail(`${r.kpis.floorListRate} → ${r2.kpis.floorListRate}`);
    },
  },
  {
    id: 'INV-28', title: 'Un redondeo comercial mayor nunca baja la tarifa sugerida',
    check(q, r) {
      if (!(r.kpis.suggestedListRate > 0)) return notApplicable;
      const q2 = clone(q); q2.pricing.roundingStep = Math.max(10000, Number(q.pricing.roundingStep || 0) * 10);
      const r2 = run(q2);
      return r2.kpis.suggestedListRate >= r.kpis.suggestedListRate - TOL(r.kpis.suggestedListRate) ? ok(`${r.kpis.suggestedListRate} → ${r2.kpis.suggestedListRate}`) : fail(`${r.kpis.suggestedListRate} → ${r2.kpis.suggestedListRate}`);
    },
  },
];

/** Copia de la cotización con D días de trabajo (o la cantidad que los produce). */
function scaleTo(q, r, days) {
  const D0 = r.kpis.activeDays;
  if (!(D0 > 0)) return null;
  return scaleActivity(clone(q), days / D0);
}

// --------------------------------------------------------------------- productos

const prun = (p) => computeProduct(p);
export const PRODUCT_INVARIANTS = [
  {
    id: 'PINV-01', title: 'Producto: subir el margen nunca baja el precio',
    check(p, r) {
      const m = Number(p.pricing && p.pricing.targetMarginPct);
      if (r.pricing.targetPrice === null || !(m + 5 + r.taxPct < 100)) return notApplicable;
      const p2 = clone(p); p2.pricing.targetMarginPct = m + 5;
      const r2 = prun(p2);
      return r2.pricing.targetPrice >= r.pricing.targetPrice - TOL(r.pricing.targetPrice) ? ok(`${r.pricing.targetPrice.toFixed(2)} → ${r2.pricing.targetPrice.toFixed(2)}`) : fail(`${r.pricing.targetPrice} → ${r2.pricing.targetPrice}`);
    },
  },
  {
    id: 'PINV-02', title: 'Producto: más unidades por mes nunca suben el costo por unidad (los fijos se reparten)',
    check(p, r) {
      if (r.unitCost === null) return notApplicable;
      const p2 = clone(p); p2.monthlyUnits = Number(p.monthlyUnits || 0) * 10;
      const r2 = prun(p2);
      const fixedOk = r.fixedPerUnit === 0 || Math.abs(r2.fixedPerUnit - r.fixedPerUnit / 10) <= TOL(r.fixedPerUnit);
      return r2.unitCost <= r.unitCost + TOL(r.unitCost) && fixedOk ? ok(`${r.unitCost.toFixed(2)} → ${r2.unitCost.toFixed(2)}`) : fail(`${r.unitCost} → ${r2.unitCost}; fijo/u ${r.fixedPerUnit} → ${r2.fixedPerUnit}`);
    },
  },
  {
    id: 'PINV-03', title: 'Producto: más % de fijos asignado nunca baja el costo por unidad',
    check(p, r) {
      if (r.unitCost === null || !list(p.fixedCosts).length) return notApplicable;
      const p2 = clone(p); p2.fixedCosts.forEach((f) => { f.sharePct = Math.min(100, Number(f.sharePct || 0) + 10); });
      const r2 = prun(p2);
      return r2.unitCost >= r.unitCost - TOL(r.unitCost) ? ok('no baja') : fail(`${r.unitCost} → ${r2.unitCost}`);
    },
  },
  {
    id: 'PINV-04', title: 'Producto: más pérdida nunca baja el costo variable por unidad',
    check(p, r) {
      if (r.variablePerUnit === null || Number(p.lossPct || 0) + 10 >= 100) return notApplicable;
      const p2 = clone(p); p2.lossPct = Number(p.lossPct || 0) + 10;
      const r2 = prun(p2);
      return r2.variablePerUnit >= r.variablePerUnit - TOL(r.variablePerUnit) ? ok('no baja') : fail(`${r.variablePerUnit} → ${r2.variablePerUnit}`);
    },
  },
  {
    id: 'PINV-05', title: 'Producto: el resultado del mes cierra (ventas − impuestos − variables − fijos)',
    check(p, r) {
      if (r.pricing.suggestedPrice === null || r.variablePerUnit === null) return notApplicable;
      const N = r.monthlyUnits;
      const expected = r.pricing.suggestedPrice * N * (1 - r.taxPct / 100) - r.variablePerUnit * N - r.fixedMonthly;
      return Math.abs(r.monthly.profit - expected) <= TOL(expected) ? ok('cierra') : fail(`${r.monthly.profit} ≠ ${expected}`);
    },
  },
  {
    id: 'PINV-06', title: 'Producto: precio actual debajo del piso → aviso "bajo el piso"',
    check(p, r) {
      if (!(r.pricing.floorPrice > 0)) return notApplicable;
      const below = clone(p); below.pricing.currentPrice = r.pricing.floorPrice * 0.9;
      const above = clone(p); above.pricing.currentPrice = r.pricing.floorPrice * 1.1 + 1;
      const a = prun(below);
      const b = prun(above);
      return a.current.belowFloor === true && b.current.belowFloor === false ? ok('avisa') : fail(`debajo: ${a.current.belowFloor}; arriba: ${b.current.belowFloor}`);
    },
  },
  {
    id: 'PINV-07', title: 'Producto: nunca NaN ni Infinity',
    check(p, r) {
      const bad = findNonFinite({ r: { ...r, traces: r.traces } });
      return bad.length ? fail(bad.slice(0, 5).join(', ')) : ok('todo finito');
    },
  },
];

/** Corre todas las invariantes de una cotización. */
export function checkQuoteInvariants(q, { settings = {} } = {}) {
  const r = run(clone(q), { settings });
  return QUOTE_INVARIANTS.map((inv) => {
    try {
      return { id: inv.id, title: inv.title, ...inv.check(clone(q), r) };
    } catch (error) {
      return { id: inv.id, title: inv.title, ok: false, detail: `excepción: ${error.message}` };
    }
  });
}

export function checkProductInvariants(p) {
  const r = prun(clone(p));
  return PRODUCT_INVARIANTS.map((inv) => {
    try {
      return { id: inv.id, title: inv.title, ...inv.check(clone(p), r) };
    } catch (error) {
      return { id: inv.id, title: inv.title, ok: false, detail: `excepción: ${error.message}` };
    }
  });
}
