/**
 * RATEOS Test Lab — núcleo de la campaña (PLAN-2026-013).
 *
 * Corre cada escenario por las seis dimensiones, que nunca se reemplazan
 * entre sí:
 *   MATH       motor productivo vs oráculo independiente + valores de negocio esperados
 *   DRIVERS    invariantes y relaciones metamórficas (cada costo sigue a su driver)
 *   INPUTS     sondas de contradicción y campos redundantes
 *   COMPLETENESS / UX  auditor determinístico (avisos resolubles, cero silencioso, no aplica…)
 *   MARKET     plausibilidad contra referencias (informativo, nunca cambia una fórmula)
 * y clasifica los hallazgos:
 *   P0 ECONOMIC · P0 CONSISTENCY · P1 COMPLETENESS · P1 UX · P2 PRESENTATION ·
 *   MARKET REVIEW · HUMAN DECISION REQUIRED
 */

import { computeQuote } from '../../../js/engines/quote-engine.js';
import { compareQuote, compareProduct, resolvePath, sameValue, findNonFinite } from './compare.js';
import { checkQuoteInvariants, checkProductInvariants } from './invariants.js';
import { auditQuoteUx, auditTerminology, auditActivationTerms } from './ux-audit.js';
import { driverTrace } from './driver-trace.js';
import { marketCheck, loadReferences } from './market.js';
import { quoteFeatures, productFeatures, computeCoverage } from './coverage.js';
import { checkGoldenLock } from './golden-lock.js';
import { ENGINES, loadCases, assertMatches } from '../../golden-cases/harness.js';
import { DOC_GAPS, CONFIRMED_RULES } from './oracle.js';
import { resetIds } from './build.js';
import { SERVICE_SCENARIOS } from '../scenarios/services.js';
import { PRODUCT_SCENARIOS } from '../scenarios/products.js';
import { PROBES } from '../scenarios/probes.js';
import { generateScenarios } from '../scenarios/generate.js';
import { KNOWN_FINDINGS } from '../known-findings.js';

export const CLASSES = Object.freeze(['P0 ECONOMIC', 'P0 CONSISTENCY', 'P1 COMPLETENESS', 'P1 UX', 'P2 PRESENTATION', 'MARKET REVIEW', 'HUMAN DECISION REQUIRED']);
/** Las que frenan el gate (si no están registradas como decisión pendiente del dueño). */
export const BLOCKING = Object.freeze(['P0 ECONOMIC', 'P0 CONSISTENCY', 'P1 COMPLETENESS', 'P1 UX']);
const RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]));

/** Clave estable de un hallazgo (para el registro de decisiones y fixes). */
export const findingKey = (subject, code) => `${subject}:${code}`;

/** Registro que corresponde a un hallazgo: por clave exacta, o por código (+ escenarios y/o texto del detalle). */
function knownFor(key, finding) {
  return KNOWN_FINDINGS.find((k) => k.key === key || (k.code && key.endsWith(`:${k.code}`) && (!k.subjects || k.subjects.some((s) => key.startsWith(`${s}:`))) && (!k.match || k.match.test(String(finding.detail || ''))))) || null;
}

function classify(finding, subject) {
  const key = findingKey(subject, finding.code);
  const known = knownFor(key, finding);
  const classification = known && known.classification ? known.classification : finding.classification;
  return { ...finding, key, classification, known: known ? { id: known.id, status: known.status, decision: known.decision || null, rootCause: known.rootCause || null, fix: known.fix || null } : null };
}

/** Resumen de inputs relevantes (sin datos privados: los escenarios son sintéticos). */
function inputsOf(q) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const a = q.activity || {};
  return {
    serviceType: q.serviceType,
    unit: q.unit === 'custom' ? `custom:${q.unitName}` : q.unit,
    pricingMode: q.pricingMode,
    activity: { activeDaysPerMonth: a.activeDaysPerMonth ?? null, billableQuantityPerMonth: a.billableQuantityPerMonth ?? null, unitsPerActiveDay: a.unitsPerActiveDay ?? null, daysPerActivation: a.daysPerActivation ?? null, hoursPerActiveDay: a.hoursPerActiveDay ?? null, fullActivations: a.fullActivations === true },
    labor: list(q.labor).map((l) => `${l.role || 'Puesto'} ×${l.positions ?? 1}${Number(l.peoplePerPosition) > 1 ? ` (relevo ×${l.peoplePerPosition})` : ''}${l.assignment && l.assignment !== 'dedicated' ? ` [${l.assignment}${l.fixedCostSharePct ? ` ${l.fixedCostSharePct} %` : ''}]` : ''}`),
    equipment: list(q.equipment).map((e) => (e.acquisition === 'rented' || e.acquisition === 'outsourced' ? `${e.name} (${e.acquisition}) ${e.external && e.external.price}/${e.external && e.external.unit}${e.external && e.external.fuelIncluded === false ? ` comb. ${e.external.fuelMode || 'per_hour'}` : ''}` : `${e.name} (propio)${e.mobilization && e.mobilization.mode ? ` mov. ${e.mobilization.mode}` : ''}`)),
    materials: q.materialsNotApplicable ? 'no aplica' : list(q.materials).length,
    logistics: q.logistics && q.logistics.notApplicable ? 'sin traslados' : { distanceKm: q.logistics && q.logistics.distanceKm, roundTrip: q.logistics && q.logistics.roundTrip !== false, tripsPerActivation: q.logistics && q.logistics.tripsPerActivation },
    structure: q.indirect && q.indirect.mode === 'detailed' ? 'desglosada' : `${q.indirect && q.indirect.method} ${q.indirect && (q.indirect.pct || q.indirect.amount)}`,
    finance: q.finance ? { paymentTermDays: q.finance.paymentTermDays, invoiceLagDays: q.finance.invoiceLagDays, monthlyRatePct: q.finance.monthlyRatePct } : null,
    contingencyPct: q.risk ? q.risk.generalPct : null,
    billingTaxes: q.billingTaxes ? (q.billingTaxes.notApplicable ? 'no aplica' : q.billingTaxes.mode === 'detailed' ? (q.billingTaxes.items || []).map((i) => i.pct) : q.billingTaxes.combinedPct) : null,
    margin: q.pricing ? q.pricing.targetMarginPct : null,
  };
}

const KPI_VIEW = ['activeDays', 'billableQuantity', 'totalCost', 'floorListRate', 'targetListRate', 'suggestedListRate', 'commercialListRate', 'revenue', 'profit', 'marginPct', 'breakEvenQuantity', 'financialCost', 'completenessPct'];

/** Un escenario de servicio por todas las dimensiones. */
export function runServiceScenario(s, { refs = loadReferences(), invariants = true } = {}) {
  resetIds();
  const quote = s.build();
  const findings = [];
  let cmp;
  try {
    cmp = compareQuote(quote);
  } catch (error) {
    return { id: s.id, title: s.title, kind: 'service', status: 'FAIL', findings: [classify({ code: 'MATH-EXCEPTION', classification: 'P0 ECONOMIC', title: 'El motor lanzó una excepción', detail: error.message }, s.id)] };
  }
  const { engine, oracle, diffs } = cmp;
  for (const d of diffs) findings.push({ code: `MATH-ORACLE:${d.path}`, classification: 'P0 ECONOMIC', title: 'El motor difiere del oráculo independiente', detail: `${d.path}: motor ${d.actual} · oráculo ${d.expected} (Δ ${d.delta})` });
  const expect = Object.entries(s.expect || {}).map(([path, expected]) => {
    const actual = path in (engine || {}) ? engine[path] : resolvePath(engine, path);
    return { path, expected, actual, ok: sameValue(actual, expected, typeof expected === 'number' && Math.abs(expected) < 1e6 && !Number.isInteger(expected) ? 'qty' : 'money') };
  });
  expect.filter((e) => !e.ok).forEach((e) => findings.push({ code: `MATH-EXPECT:${e.path}`, classification: 'P0 ECONOMIC', title: 'Valor de negocio esperado distinto', detail: `${e.path}: esperado ${JSON.stringify(e.expected)} · motor ${JSON.stringify(e.actual)}` }));
  const nonFinite = findNonFinite({ kpis: engine.kpis, eecc: engine.eecc, traces: engine.traces });
  if (nonFinite.length) findings.push({ code: 'MATH-NONFINITE', classification: 'P0 ECONOMIC', title: 'NaN o Infinity en el resultado', detail: nonFinite.slice(0, 5).join(', ') });
  const inv = invariants ? checkQuoteInvariants(quote) : [];
  inv.filter((r) => !r.ok).forEach((r) => findings.push({ code: r.id, classification: 'P0 ECONOMIC', title: r.title, detail: r.detail }));
  auditQuoteUx(quote, engine, { scenario: s }).forEach((f) => findings.push({ code: f.code, classification: f.category, title: f.title, detail: f.detail }));
  // Terminología de la activación en lo que muestra el motor (PLAN-2026-014, LAB-D8).
  auditActivationTerms(quote, engine).forEach((f) => findings.push({ code: f.code, classification: f.category, title: f.title, detail: f.detail }));
  const market = marketCheck(s, quote, engine, refs);
  market.filter((m) => m.status === 'REVIEW').forEach((m) => findings.push({ code: `MARKET:${m.concept}`, classification: 'MARKET REVIEW', title: `Mercado: ${m.concept}`, detail: m.message }));
  const classified = findings.map((f) => classify(f, s.id));
  return {
    id: s.id,
    title: s.title,
    kind: 'service',
    family: s.family,
    generated: Boolean(s.combo),
    seed: s.seed ?? null,
    serviceType: quote.serviceType,
    unit: engine.unitInfo ? engine.unitInfo.label : quote.unit,
    inputs: inputsOf(quote),
    expected: Object.fromEntries(KPI_VIEW.filter((k) => k !== 'completenessPct').map((k) => [k, oracle.kpis[k] ?? null])),
    actual: Object.fromEntries(KPI_VIEW.map((k) => [k, engine.kpis[k] ?? null])),
    deltas: diffs,
    businessExpect: expect,
    transport: { physicalTripsPerMonth: engine.model.transport.physicalTripsPerMonth, kmPerTrip: engine.model.transport.kmPerTrip, routeKmPerMonth: engine.model.transport.routeKmPerMonth },
    drivers: driverTrace(quote, oracle),
    invariants: { total: inv.length, notApplicable: inv.filter((r) => r.na).length, failed: inv.filter((r) => !r.ok).map((r) => ({ id: r.id, title: r.title, detail: r.detail })) },
    completeness: { scorePct: engine.completeness.scorePct, critical: engine.completeness.critical, review: engine.completeness.review, pending: engine.completeness.pending.map((p) => `${p.id}${p.severity === 'critical' ? '!' : ''}`), notices: (engine.completeness.notices || []).map((n) => n.id) },
    market,
    findings: classified,
    status: statusOf(classified),
    features: quoteFeatures(quote),
  };
}

/** Un producto por todas las dimensiones que aplican. */
export function runProductScenario(s) {
  resetIds();
  const product = s.build();
  const { engine, oracle, diffs } = compareProduct(product);
  const findings = diffs.map((d) => ({ code: `MATH-ORACLE:${d.path}`, classification: 'P0 ECONOMIC', title: 'El motor de productos difiere del oráculo', detail: `${d.path}: motor ${d.actual} · oráculo ${d.expected}` }));
  const expect = Object.entries(s.expect || {}).map(([path, expected]) => ({ path, expected, actual: resolvePath(engine, path), ok: sameValue(resolvePath(engine, path), expected, 'money') }));
  expect.filter((e) => !e.ok).forEach((e) => findings.push({ code: `MATH-EXPECT:${e.path}`, classification: 'P0 ECONOMIC', title: 'Valor de negocio esperado distinto', detail: `${e.path}: esperado ${e.expected} · motor ${e.actual}` }));
  const inv = checkProductInvariants(product);
  inv.filter((r) => !r.ok).forEach((r) => findings.push({ code: r.id, classification: 'P0 ECONOMIC', title: r.title, detail: r.detail }));
  if (s.gap) findings.push({ code: `GAP:${s.gap.id}`, classification: 'HUMAN DECISION REQUIRED', title: 'Funcionalidad no modelada (no se inventa)', detail: s.gap.text });
  // Silencios del producto: errores que dejan el precio igual al costo de los datos cargados.
  engine.issues.filter((i) => i.severity === 'warning' && /packSize/.test(i.path)).forEach((i) => findings.push({ code: 'UX-PRODUCT-PACK', classification: 'P1 COMPLETENESS', title: 'Ingrediente sin contenido del paquete suma $ 0 con sólo un aviso', detail: i.message }));
  const classified = findings.map((f) => classify(f, s.id));
  return {
    id: s.id,
    title: s.title,
    kind: 'product',
    family: s.family,
    saleUnit: product.saleUnit,
    inputs: { saleUnit: product.saleUnit, unitsPerBatch: product.unitsPerBatch, lossPct: product.lossPct, monthlyUnits: product.monthlyUnits, materials: product.materials.length, labor: product.labor.length, equipment: product.equipment.length, fixedCosts: product.fixedCosts.length, margin: product.pricing.targetMarginPct },
    expected: { unitCost: oracle.unitCost, floorPrice: oracle.floorPrice, suggestedPrice: oracle.suggestedPrice, breakEvenUnits: oracle.breakEvenUnits },
    actual: { unitCost: engine.unitCost, floorPrice: engine.pricing.floorPrice, suggestedPrice: engine.pricing.suggestedPrice, breakEvenUnits: engine.pricing.breakEvenUnits },
    deltas: diffs,
    businessExpect: expect,
    drivers: [
      `${product.unitsPerBatch} por tanda × (1 − ${product.lossPct} %) = ${oracle.sellablePerBatch} vendibles`,
      `Variable por unidad ${oracle.variablePerUnit === null ? '—' : oracle.variablePerUnit.toFixed(2)} + fijo por unidad ${oracle.fixedPerUnit === null ? '—' : oracle.fixedPerUnit.toFixed(2)} = costo ${oracle.unitCost === null ? '—' : oracle.unitCost.toFixed(2)}`,
      `Precio = costo ÷ (1 − ${oracle.marginPct} % − ${oracle.taxPct} %) = ${oracle.targetPrice === null ? '—' : oracle.targetPrice.toFixed(2)} → sugerido ${oracle.suggestedPrice === null ? '—' : oracle.suggestedPrice}`,
    ],
    invariants: { total: inv.length, notApplicable: inv.filter((r) => r.na).length, failed: inv.filter((r) => !r.ok).map((r) => ({ id: r.id, title: r.title, detail: r.detail })) },
    issues: engine.issues.map((i) => `${i.severity}:${i.path}`),
    findings: classified,
    status: statusOf(classified),
    features: productFeatures(product),
  };
}

/** Una sonda de contradicción: ¿RATEOS derivó, avisó o marcó crítico? */
export function runProbe(p) {
  resetIds();
  const quote = p.build();
  const r = computeQuote(structuredClone(quote));
  const resp = p.respond(quote, r);
  const enough = p.expect === 'derive' ? resp.how === 'derive' : p.expect === 'critical' ? ['critical', 'derive'].includes(resp.how) : resp.how !== 'silent';
  const findings = enough ? [] : [classify({
    code: `PROBE:${p.id}`,
    classification: p.onSilent.category,
    title: p.title,
    detail: `Se esperaba que RATEOS ${p.expect === 'derive' ? 'derive el dato' : p.expect === 'critical' ? 'lo marque como crítico' : 'avise'}; respondió: ${resp.how} (${resp.evidence}).${p.explain ? ` ${p.explain}` : ''}`,
  }, p.id)];
  return { id: p.id, title: p.title, dimension: p.dimension, expect: p.expect, response: resp.how, evidence: resp.evidence, completenessPct: r.completeness.scorePct, findings, status: statusOf(findings) };
}

/** PASS sin hallazgos; FAIL si hay un P0/P1 sin decisión registrada; REVIEW si sólo quedan P2, mercado o decisiones del dueño. */
function statusOf(findings) {
  if (!findings.length) return 'PASS';
  const blocking = findings.some((f) => BLOCKING.includes(f.classification) && !(f.known && ['human', 'accepted'].includes(f.known.status)));
  return blocking ? 'FAIL' : 'REVIEW';
}

/** Golden cases: corre el harness compartido y el candado de huellas. */
export function runGoldens() {
  const lock = checkGoldenLock();
  const results = loadCases().map(({ data }) => {
    try {
      const result = ENGINES[data.engine](structuredClone(data.inputs));
      for (const [path, expected] of Object.entries(data.expected)) {
        const actual = path === 'value' ? result.value : resolvePath(result, path);
        assertMatches(actual, expected, data.tolerance, `${data.id} → ${path}`);
      }
      return { id: data.id, ok: true };
    } catch (error) {
      return { id: data.id, ok: false, error: error.message };
    }
  });
  return { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), lock };
}

/**
 * Campaña completa.
 * @param {{ mode?: 'stable'|'extended', seed?: number, count?: number }} options
 */
export function runCampaign({ mode = 'stable', seed = 20261016, count = 120 } = {}) {
  const refs = loadReferences();
  const goldens = runGoldens();
  const services = SERVICE_SCENARIOS.map((s) => runServiceScenario(s, { refs }));
  const products = PRODUCT_SCENARIOS.map((s) => runProductScenario(s));
  const generated = mode === 'extended' ? generateScenarios({ seed, count }).map((s) => runServiceScenario(s, { refs })) : [];
  const probes = PROBES.map((p) => runProbe(p));
  // Terminología de la interfaz (auditor UX F): una vez por campaña.
  const termFindings = auditTerminology().map((f) => classify({ code: f.code, classification: f.category, title: f.title, detail: f.detail }, 'UI-TERMS'));
  const terminology = { id: 'UI-TERMS', title: 'Terminología de la interfaz (magnitudes distintas, sinónimos)', findings: termFindings, status: statusOf(termFindings) };
  const coverage = computeCoverage([...services, ...products].map((r) => ({ id: r.id, kind: r.kind, features: r.features })));
  const scenarios = [...services, ...products, ...generated];
  const allFindings = [...scenarios, ...probes, terminology].flatMap((r) => r.findings.map((f) => ({ ...f, subject: r.id })));
  const blocking = allFindings.filter((f) => BLOCKING.includes(f.classification) && !(f.known && ['human', 'accepted'].includes(f.known.status)));
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, allFindings.filter((f) => f.classification === c).length]));
  // Por escenario: la peor clasificación (la suma da el total, como pide el reporte).
  const perScenario = { PASS: 0, ...Object.fromEntries(CLASSES.map((c) => [c, 0])) };
  for (const r of [...scenarios, ...probes, terminology]) {
    if (!r.findings.length) perScenario.PASS += 1;
    else perScenario[r.findings.reduce((acc, f) => (RANK[f.classification] < RANK[acc] ? f.classification : acc), 'HUMAN DECISION REQUIRED')] += 1;
  }
  const gateOk = goldens.lock.ok && goldens.failed.length === 0 && coverage.ok && blocking.length === 0;
  return {
    meta: { mode, seed: mode === 'extended' ? seed : null, count: mode === 'extended' ? count : null, scenarios: scenarios.length, probes: probes.length },
    goldens,
    coverage,
    scenarios,
    probes,
    terminology,
    findings: allFindings,
    blocking,
    byClass,
    perScenario,
    docGaps: DOC_GAPS,
    confirmedRules: CONFIRMED_RULES,
    // Un fix "volvió a aparecer" si algún hallazgo de esta corrida coincide con su registro.
    fixes: KNOWN_FINDINGS.filter((k) => k.status === 'fixed').map((k) => ({ ...k, stillPresent: allFindings.some((f) => f.known && f.known.id === k.id) })),
    decisions: KNOWN_FINDINGS.filter((k) => k.status === 'human'),
    accepted: KNOWN_FINDINGS.filter((k) => k.status === 'accepted'),
    gate: { ok: gateOk, reasons: [!goldens.lock.ok ? 'candado de golden' : null, goldens.failed.length ? 'golden en rojo' : null, !coverage.ok ? 'cobertura incompleta' : null, blocking.length ? `${blocking.length} hallazgos P0/P1 sin resolver` : null].filter(Boolean) },
  };
}

