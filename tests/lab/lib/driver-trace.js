/**
 * RATEOS Test Lab — DRIVER TRACE (PLAN-2026-013 §8).
 *
 * Explica cada escenario con los números del ORÁCULO independiente:
 * actividad → unidades físicas → proveedores → directos → estructura →
 * financiación → contingencia → precio → margen. Si un número central del
 * motor no se puede explicar así (no coincide con el oráculo o no tiene "Ver
 * cálculo"), se marca como problema de trazabilidad.
 */

const fmt = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n));
const money = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `$ ${fmt(n, 0)}`);
const num = (n) => fmt(n, Number.isInteger(n) ? 0 : 2);

const UNIT_WORD = { trip: 'viajes', km: 'km', m3: 'm³', ton: 't', tonkm: 'ton-km', unit: 'unidades', kg: 'kg', meter: 'metros', m2: 'm²', lot: 'lotes', shift: 'turnos', custom: 'unidades', call: 'llamados', job: 'trabajos', milestone: 'hitos', day: 'días', hour: 'horas', month: 'meses' };

/**
 * @param {object} quote
 * @param {object} oracle oracleQuote(quote)
 * @returns {string[]} renglones en lenguaje de negocio
 */
export function driverTrace(quote, oracle) {
  const act = oracle.activity;
  const m = oracle.model;
  const k = oracle.kpis;
  const word = UNIT_WORD[act.unitId] || 'unidades';
  const lines = [];
  if (act.kind === 'quantity') {
    const per = Math.max(act.dpa * act.r, act.minCall);
    lines.push(`${num(act.Q)} ${word} facturables ÷ ${num(per)} por intervención${act.minCall > act.dpa * act.r ? ' (mínimo por llamado)' : ''} × ${num(act.dpa)} días = ${num(act.D)} días de trabajo`);
  } else if (act.kind === 'event') {
    lines.push(`${num(act.Q)} ${word} ÷ ${num(act.upa)} por trabajo × ${num(act.dpa)} días = ${num(act.D)} días de trabajo`);
  } else {
    lines.push(`${num(act.D)} días de trabajo (${num((act.D / act.available) * 100)} % de ${num(act.available)} disponibles)`);
  }
  lines.push(`${num(act.D)} días ÷ ${num(act.dpa)} días por intervención = ${num(act.A)} intervenciones`);
  if (!m.route.notApplicable && m.route.kmPerTrip > 0) {
    lines.push(`${num(act.A)} intervenciones × ${num(m.route.tripsPerActivation)} viajes${m.route.derived ? ' (derivados: viajes por día × días por intervención)' : ''} = ${num(oracle.transport.physicalTripsPerMonth)} viajes físicos`);
    lines.push(`${num(oracle.transport.physicalTripsPerMonth)} viajes × ${num(m.route.kmPerTrip)} km = ${num(oracle.transport.routeKmPerMonth)} km`);
  } else if (m.route.notApplicable) {
    lines.push('Sin traslados: 0 km de ruta');
  }
  for (const x of m.externals) {
    if (x.unit === 'month' || x.unit === 'global') lines.push(`Externo ${x.index + 1}: ${money(x.netFixed)} netos por mes (${x.unit === 'global' ? 'global ÷ meses de contrato' : 'tarifa mensual'})`);
    else lines.push(`Externo ${x.index + 1}: ${num(x.billedPerActivation * act.A)} ${x.unit === 'km' ? 'km' : x.unit === 'trip' ? 'tramos' : x.unit === 'hour' ? 'horas' : x.unit === 'day' ? 'días' : 'llamados'}${x.minimumApplied || (x.billedPerActivation > x.unitsPerActivation + 1e-9) ? ' (con mínimo)' : ''} × ${money(x.price)} × ${num(x.qty)} = ${money(x.netPerActivation * act.A)} netos`);
  }
  const c = oracle.byCategory;
  const direct = c.labor + c.equipment + c.external + c.fuel + c.materials + c.logistics;
  lines.push(`Directos ${money(direct)} (personal ${money(c.labor)} · equipos ${money(c.equipment)} · externos ${money(c.external)} · combustible ${money(c.fuel)} · materiales ${money(c.materials)} · logística ${money(c.logistics)})`);
  lines.push(`Estructura ${money(c.structure)} → financiación ${money(c.financial)} → contingencia ${money(c.contingency)} (${num(m.contingencyPct)} %) = costo ${money(k.totalCost)}`);
  if (k.floorListRate !== null) lines.push(`Piso = (costo ÷ (1 − ${num(oracle.t)} %) − otros ingresos) ÷ ${num(k.billableQuantity)} ${word} = ${money(k.floorListRate)} de lista`);
  if (k.targetListRate !== null) lines.push(`Objetivo (margen ${num(Number(quote.pricing && quote.pricing.targetMarginPct) || 0)} %) = ${money(k.targetListRate)} → sugerida ${money(k.suggestedListRate)}`);
  if (k.commercialListRate !== null) lines.push(`Con ${money(k.commercialListRate)}: facturación ${money(k.revenue)} − impuestos ${money(k.billingTaxes)} − costo ${money(k.totalCost)} = ${money(k.profit)} (margen ${num(k.marginPct)} %)`);
  if (k.breakEvenDays !== null) lines.push(`Equilibrio: ${num(k.breakEvenDays)} días = ${num(k.breakEvenQuantity)} ${word}${k.breakEvenZeroReason ? ` (${k.breakEvenZeroReason === 'no_fixed_costs' ? 'sin costos fijos' : 'los ingresos fijos cubren los fijos'})` : ''}`);
  return lines;
}
