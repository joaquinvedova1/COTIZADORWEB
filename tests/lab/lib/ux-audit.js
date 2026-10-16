/**
 * RATEOS Test Lab — auditor de consistencia UX DETERMINÍSTICO (PLAN-2026-013).
 *
 * Busca diseño capaz de inducir una cotización equivocada, sin navegador
 * (la parte visual — campo real enfocado, responsive, mismas cifras en cada
 * pantalla — la hace tests/lab/e2e/ui-lab.mjs):
 *
 *   B. aviso resoluble: cada pendiente con botón lleva a un campo que lo resuelve
 *   C. cero silencioso: un costo con tarifa > 0 que da $ 0 tiene que estar marcado
 *   D. no aplica: nunca pedir datos de algo que no aplica (combustible incluido…)
 *   G. 100 % de completitud = sin faltantes ni errores que cambien el resultado
 *   H. pendientes visibles en un paso existente; textos no vacíos
 *
 * Cada hallazgo: { code, severity (P0/P1/P2), category, title, detail, evidence }.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCompleteness } from '../../../js/engines/completeness-engine.js';
import { validateQuote } from '../../../js/core/validation.js';
import { QUOTE_STEPS } from '../../../js/domain/catalogs.js';
import { fieldFromHash, stepOfPath } from '../../../js/ui/field-links.js';

const JS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../js');
let uiSourceCache = null;
/** Texto de la interfaz (js/ui + catálogos y unidades del dominio), en minúsculas: los rótulos que un aviso puede citar. */
export function uiSource() {
  if (uiSourceCache !== null) return uiSourceCache;
  const files = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name.endsWith('.js')) files.push(p);
  });
  walk(path.join(JS_DIR, 'ui'));
  files.push(path.join(JS_DIR, 'domain', 'catalogs.js'), path.join(JS_DIR, 'domain', 'billing-units.js'));
  uiSourceCache = files.sort().map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase();
  return uiSourceCache;
}
/** Nombres por defecto de líneas sin nombre (no son rótulos de la interfaz). */
const FALLBACK_NAMES = new Set(['equipo', 'externo', 'personal', 'material', 'vehículo', 'recurso externo', 'servicio externo', 'equipo propio']);

const STEP_IDS = new Set(QUOTE_STEPS.map((s) => s.id));
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const isExt = (e) => e && (e.acquisition === 'rented' || e.acquisition === 'outsourced');

/** Valor plausible para "completar" cada campo al que lleva un pendiente (la persona lo carga). */
const FIX_VALUES = {
  distanceKm: 100, pricePerLiter: 1500, providedBy: 'contractor', fuelLitersPerHour: 10, fuelLitersPer100Km: 30, fuelKmPerLiter: 3,
  travelLitersPer100Km: 30, consumptionLPer100Km: 12, unitsPerActiveDay: 1, tripsPerActivation: 1, notApplicable: false,
  fixedCostSharePct: 50, billableQuantityPerMonth: 10, activeDaysPerMonth: 10, knownRate: 1000000, targetMarginPct: 10,
  paymentTermDays: 60, price: 100000, replacementValue: 100000000, usefulLifeYears: 10, vatPct: 21, generalPct: 3, pct: 10,
  quantity: 1, unitCost: 1000, hoursPerActiveDay: 8,
};
/** Efectos de la interfaz al editar un campo (editar el precio del combustible lo confirma, etc.). */
const UI_SIDE_EFFECTS = {
  'fuel.pricePerLiter': (q) => { if (q.fuel) q.fuel.illustrative = false; },
  'finance.monthlyRatePct': (q) => { if (q.finance) q.finance.illustrative = false; },
};

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = /^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}
function getPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);
}

const finding = (code, severity, category, title, detail, evidence = {}) => ({ code, severity, category, title, detail, evidence });

/**
 * Audita una cotización ya calculada.
 * @param {object} quote
 * @param {object} result computeQuote(quote)
 * @param {{ scenario?: object }} [options]
 */
export function auditQuoteUx(quote, result, { scenario = null } = {}) {
  const findings = [];
  const comp = result.completeness;
  const D = result.kpis.activeDays;

  // ---- H: cada pendiente se muestra en un paso real y con texto.
  for (const item of comp.items) {
    if (!STEP_IDS.has(item.step)) findings.push(finding('UX-STEP', 'P1', 'P1 UX', 'Pendiente en un paso que no existe', `"${item.label}" apunta al paso "${item.step}".`, { item: item.id }));
    if (item.status !== 'ok' && !(typeof item.message === 'string' && item.message.trim())) findings.push(finding('UX-EMPTY', 'P2', 'P2 PRESENTATION', 'Pendiente sin texto', `"${item.label}" no explica qué falta.`, { item: item.id }));
  }

  // ---- B: avisos resolubles desde su botón ("Ir al campo").
  for (const item of comp.pending) {
    if (!item.focus) {
      // Sin equipos cargados no hay campo que enfocar: el botón lleva al paso ("Agregar equipo").
      const nothingToFocus = item.id === 'equipment_cost' && list(quote.equipment).length === 0;
      if (item.severity === 'critical' && !nothingToFocus) findings.push(finding('UX-CRITICAL-NO-LINK', 'P2', 'P2 PRESENTATION', 'Crítico sin enlace al campo exacto', `"${item.label}": ${item.message}`, { item: item.id }));
      continue;
    }
    if (fieldFromHash(`?campo=${encodeURIComponent(item.focus)}`) !== item.focus) {
      findings.push(finding('UX-FOCUS-INVALID', 'P1', 'P1 UX', 'El botón del pendiente apunta a una ruta inválida', `"${item.label}" → ${item.focus}`, { item: item.id, focus: item.focus }));
      continue;
    }
    const step = stepOfPath(item.focus);
    if (!STEP_IDS.has(step)) findings.push(finding('UX-FOCUS-STEP', 'P1', 'P1 UX', 'El campo del pendiente no está en ningún paso', `${item.focus} → paso "${step}"`, { item: item.id }));
    // El campo tiene que existir en la cotización (o en una línea que existe).
    const head = item.focus.split('.');
    const lineMissing = /^\d+$/.test(head[1] || '') && !list(quote[head[0]])[Number(head[1])];
    if (lineMissing) {
      findings.push(finding('UX-FOCUS-LINE', 'P1', 'P1 UX', 'El pendiente lleva a una línea que no existe', item.focus, { item: item.id }));
      continue;
    }
    // Resolución: con un valor plausible en ese campo, el pendiente cambia (se resuelve o pasa al siguiente dato).
    const field = head[head.length - 1];
    if (!(field in FIX_VALUES)) {
      findings.push(finding('LAB-FIX-UNKNOWN', 'P2', 'P2 PRESENTATION', 'Test Lab no sabe completar este campo (agregarlo a FIX_VALUES)', item.focus, { item: item.id }));
      continue;
    }
    // Si el valor de prueba ya es el cargado (p. ej. 1 viaje por salida), la persona cargaría otro:
    // se prueba también el doble y uno más.
    const current = getPath(quote, item.focus);
    const candidates = [FIX_VALUES[field]];
    if (typeof FIX_VALUES[field] === 'number' && Number(current) === FIX_VALUES[field]) candidates.push(FIX_VALUES[field] * 2, FIX_VALUES[field] + 1);
    const resolved = candidates.some((value) => {
      const q2 = structuredClone(quote);
      setPath(q2, item.focus, value);
      if (UI_SIDE_EFFECTS[item.focus]) UI_SIDE_EFFECTS[item.focus](q2);
      const after = evaluateCompleteness(q2).items.find((x) => x.id === item.id);
      return !after || after.status === 'ok' || after.message !== item.message || after.focus !== item.focus;
    });
    if (!resolved) {
      findings.push(finding('UX-UNRESOLVABLE', 'P1', 'P1 COMPLETENESS', 'Aviso que no se resuelve desde su campo', `"${item.label}" (${item.focus}): con un valor cargado sigue diciendo "${item.message}"`, { item: item.id, focus: item.focus }));
    }
  }

  // ---- C: cero silencioso. Un externo con tarifa que no suma nada tiene que estar marcado.
  const flagged = new Set();
  comp.pending.forEach((p) => (p.targets || []).forEach((t) => flagged.add(`${t.list}.${t.index}`)));
  if (D > 0) {
    list(quote.equipment).forEach((e, i) => {
      if (!isExt(e)) return;
      const x = result.model.external.find((y) => y.index === i);
      const price = Number(e.external && e.external.price) || 0;
      const qty = Number(e.quantity) || 0;
      if (!(price > 0 && qty > 0) || !x) return;
      const monthly = x.netFixedMonthly + x.netPerActiveDay * D;
      if (monthly > 0) return;
      const named = comp.pending.some((p) => (p.targets || []).some((t) => t.list === 'equipment' && t.index === i) || (typeof p.message === 'string' && p.message.includes(e.name || '§')));
      if (!named) {
        findings.push(finding('UX-SILENT-ZERO', 'P1', 'P1 COMPLETENESS', 'Costo en $ 0 sin aviso', `"${e.name}" tiene tarifa ${price} ${e.external.unit} pero suma $ 0 en el mes (${e.external.unit === 'hour' ? 'sin horas por día' : 'sin driver'}) y ningún pendiente lo menciona.`, { line: i, unit: e.external.unit }));
      }
    });
    // Material con costo unitario pero sin cantidad (lo paga la empresa): $ 0 sin aviso.
    if (!quote.materialsNotApplicable) {
      list(quote.materials).forEach((m, i) => {
        if (m.providedBy === 'client') return;
        if (Number(m.unitCost) > 0 && !(Number(m.quantity) > 0)) {
          // Marcado = un pendiente lo nombra o la validación rechaza su cantidad.
          const named = flagged.has(`materials.${i}`) || (result.issues || []).some((x) => x.path === `materials.${i}.quantity`);
          if (named) return;
          findings.push(finding('UX-SILENT-ZERO-MATERIAL', 'P1', 'P1 COMPLETENESS', 'Material con precio y sin cantidad suma $ 0 sin aviso', `"${m.description}": costo ${m.unitCost} por ${m.unit} y cantidad ${m.quantity}.`, { line: i }));
        }
      });
    }
    // Persona con sueldo y sin posiciones: $ 0 sin aviso (si hay otra persona, la regla de personal queda en verde).
    list(quote.labor).forEach((l, i) => {
      const noticed = (comp.notices || []).some((n) => (n.targets || []).some((t) => t.list === 'labor' && t.index === i));
      if (Number(l.basicMonthly) > 0 && !(Number(l.positions) > 0) && !noticed && comp.items.some((x) => x.id === 'labor' && x.status === 'ok')) {
        findings.push(finding('UX-SILENT-ZERO-LABOR', 'P2', 'P2 PRESENTATION', 'Puesto con sueldo y 0 posiciones (no suma) sin aviso', `"${l.role}"`, { line: i }));
      }
    });
  }

  // ---- D: no pedir datos que no aplican.
  const fuelItem = comp.items.find((x) => x.id === 'fuel');
  if (fuelItem && fuelItem.focus) {
    const m = /^equipment\.(\d+)\.external\./.exec(fuelItem.focus);
    if (m) {
      const e = list(quote.equipment)[Number(m[1])];
      if (e && e.external && e.external.fuelIncluded !== false) findings.push(finding('UX-ASKS-NA', 'P1', 'P1 COMPLETENESS', 'Pide consumo de un externo con combustible incluido', fuelItem.message, { focus: fuelItem.focus }));
    }
  }
  if (fuelItem && quote.fuel && quote.fuel.providedBy === 'client' && fuelItem.status !== 'ok') {
    findings.push(finding('UX-ASKS-NA', 'P1', 'P1 COMPLETENESS', 'Pide datos de combustible aunque lo provee el cliente', fuelItem.message));
  }
  const usersOfFuel = list(quote.equipment).some((e) => !isExt(e) || (e.external && e.external.fuelIncluded === false)) || (!(quote.logistics && quote.logistics.notApplicable) && list(quote.logistics && quote.logistics.vehicles).length > 0);
  if (fuelItem && !usersOfFuel && quote.fuel && quote.fuel.providedBy !== 'client' && !/^No aplica/.test(fuelItem.message)) {
    findings.push(finding('UX-NA-TEXT', 'P2', 'P2 PRESENTATION', 'Combustible que no aplica sin decir "No aplica"', fuelItem.message));
  }

  // ---- F: terminología. Todo rótulo que un aviso cita entre comillas existe en la interfaz
  // (si el aviso nombra un campo o una opción que no está, no se puede resolver). Los nombres
  // de las líneas de la cotización (equipos, puestos, materiales) no son rótulos.
  const lineNames = new Set([
    ...list(quote.labor).map((l) => l.role),
    ...list(quote.equipment).map((e) => e.name),
    ...list(quote.materials).map((m) => m.description),
    ...list(quote.otherCosts).map((o) => o.description),
    ...list(quote.logistics && quote.logistics.vehicles).map((v) => v.name),
    quote.unitName,
  ].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().toLowerCase()));
  for (const item of [...comp.items, ...(comp.notices || [])]) {
    for (const m of String(item.message || '').matchAll(/"([^"]{3,80})"/g)) {
      const label = m[1].trim().toLowerCase();
      if (lineNames.has(label) || FALLBACK_NAMES.has(label) || uiSource().includes(label)) continue;
      findings.push(finding('UX-TERM-LABEL', 'P1', 'P1 UX', 'El aviso cita un rótulo que no existe en la interfaz', `"${item.label}" cita "${m[1]}": no hay un campo, opción ni paso con ese nombre.`, { item: item.id, label: m[1] }));
    }
  }

  // ---- G: 100 % de completitud = nada material pendiente.
  const errors = validateQuote(quote).filter((x) => x.severity === 'error');
  if (comp.scorePct >= 100 - 1e-9) {
    if (comp.critical > 0) findings.push(finding('UX-100-CRITICAL', 'P0', 'P0 CONSISTENCY', '100 % de completitud con un crítico', comp.pending.filter((p) => p.severity === 'critical').map((p) => p.message).join(' | ')));
    if (errors.length) findings.push(finding('UX-100-ERRORS', 'P1', 'P1 COMPLETENESS', '100 % de completitud con errores de validación', errors.map((e) => `${e.path}: ${e.message}`).join(' | '), { errors: errors.map((e) => e.path) }));
    if (findings.some((f) => f.code.startsWith('UX-SILENT-ZERO') && f.severity !== 'P2')) findings.push(finding('UX-100-SILENT-ZERO', 'P0', 'P0 CONSISTENCY', '100 % de completitud con un costo en $ 0 sin aviso', 'Ver los hallazgos de cero silencioso de este escenario.'));
  }

  // ---- Expectativas del escenario (lo que la completitud TIENE que decir).
  const ux = scenario && scenario.ux ? scenario.ux : null;
  if (ux) {
    if (ux.completeness !== undefined && Math.abs(comp.scorePct - ux.completeness) > 1e-6) findings.push(finding('UX-EXPECT-SCORE', 'P1', 'P1 COMPLETENESS', 'Completitud distinta de la esperada', `${comp.scorePct} % (esperado ${ux.completeness} %): ${comp.pending.map((p) => p.message).join(' | ')}`));
    for (const id of ux.critical || []) {
      const item = comp.pending.find((p) => p.id === id && p.severity === 'critical');
      if (!item) findings.push(finding('UX-EXPECT-CRITICAL', 'P1', 'P1 COMPLETENESS', `Falta el crítico "${id}"`, 'La cotización tiene un faltante que cambia el costo y no se marca como crítico.'));
      else if (ux.focus && ux.focus[id] && item.focus !== ux.focus[id]) findings.push(finding('UX-EXPECT-FOCUS', 'P1', 'P1 UX', `El crítico "${id}" lleva a otro campo`, `${item.focus} (esperado ${ux.focus[id]})`));
    }
    for (const [id, status] of Object.entries(ux.itemStatus || {})) {
      const item = comp.items.find((x) => x.id === id);
      if (!item || item.status !== status) findings.push(finding('UX-EXPECT-ITEM', 'P1', 'P1 COMPLETENESS', `"${id}" debería estar en ${status}`, item ? `${item.status}: ${item.message}` : 'no aparece'));
    }
    for (const id of ux.notices || []) {
      if (!(comp.notices || []).some((n) => n.id === id)) findings.push(finding('UX-EXPECT-NOTICE', 'P1', 'P0 CONSISTENCY', `Falta el aviso "${id}"`, 'Un dato contradictorio se resolvió sin avisar.'));
    }
  }
  return findings;
}

/**
 * F (terminología, nivel interfaz): magnitudes distintas con nombres distintos y
 * sinónimos de una misma magnitud. Se corre una vez por campaña.
 *   - viajes facturables ≠ viajes físicos, km por viaje ≠ km por mes, días de
 *     trabajo ≠ intervenciones: cada una tiene su rótulo propio (P1 UX si falta)
 *   - "llamado", "salida" e "intervención" nombran la MISMA magnitud (una
 *     intervención del servicio): se informa el inventario para que el dueño
 *     elija el término (HUMAN DECISION; no se cambia copy por cuenta propia)
 */
export function auditTerminology() {
  const src = uiSource();
  const findings = [];
  const DISTINCT = [
    ['viajes facturables', 'viajes físicos costeados'],
    ['km por viaje', 'km por mes'],
    ['días de trabajo', 'intervenciones'],
    ['tarifa piso', 'tarifa sugerida'],
    ['margen', 'markup'],
  ];
  for (const pair of DISTINCT) {
    const missing = pair.filter((t) => !src.includes(t));
    if (missing.length) findings.push(finding('UX-TERM-DISTINCT', 'P1', 'P1 UX', 'Dos magnitudes distintas sin rótulo propio', `Falta en la interfaz: ${missing.map((t) => `"${t}"`).join(', ')} (par ${pair.join(' / ')}).`, { pair }));
  }
  const count = (re) => (src.match(re) || []).length;
  const synonyms = { llamado: count(/\bllamados?\b/g), salida: count(/\bsalidas?\b/g), 'intervención': count(/\bintervenci(?:ón|ones)\b/g) };
  if (Object.values(synonyms).filter((n) => n > 0).length > 1) {
    findings.push(finding('UX-TERM-SYNONYMS', 'HUMAN', 'HUMAN DECISION REQUIRED', 'La misma magnitud (una intervención del servicio) se nombra de tres formas',
      `En la interfaz: "llamado" ${synonyms.llamado} veces, "salida" ${synonyms.salida}, "intervención" ${synonyms['intervención']}. P. ej. en "Cómo se cobra" (por cantidad) el campo es "Duración promedio de cada salida / intervención" y en "Movilización y viajes" el de viajes es "Viajes por llamado". No es un error de cálculo: ¿se elige un término por tipo de servicio?`, { synonyms }));
  }
  return findings;
}

/** Ruta de un pendiente → ¿existe en la cotización? (para el auditor de navegador). */
export function focusTargets(quote, result) {
  return result.completeness.pending.filter((p) => p.focus).map((p) => ({ id: p.id, focus: p.focus, step: stepOfPath(p.focus), exists: getPath(quote, p.focus) !== undefined }));
}
