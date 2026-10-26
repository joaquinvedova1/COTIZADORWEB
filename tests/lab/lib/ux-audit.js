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
 *   T. terminología de la activación (PLAN-2026-014, LAB-D8): una magnitud = un
 *      nombre por cotización (llamado / salida / intervención…), sin palabras
 *      fijas en el código fuera de una lista justificada
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
import { activationTerms, activationFieldLabels, EVERY_ACTIVATION_TERMS } from '../../../js/domain/activation-terms.js';
import { activationRoundingText } from '../../../js/ui/result-text.js';

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

/**
 * Rótulos que la interfaz arma con el nombre de la activación (PLAN-2026-014): no están
 * literales en el código, salen de activationFieldLabels (la misma función que usa el campo).
 */
const DYNAMIC_LABELS = new Set(EVERY_ACTIVATION_TERMS.flatMap((T) => Object.values(activationFieldLabels(T))).map((x) => x.toLowerCase()));

/** Valor plausible para "completar" cada campo al que lleva un pendiente (la persona lo carga). */
const FIX_VALUES = {
  distanceKm: 100, pricePerLiter: 1500, providedBy: 'contractor', fuelLitersPerHour: 10, fuelLitersPer100Km: 30, fuelKmPerLiter: 3,
  travelLitersPer100Km: 30, consumptionLPer100Km: 12, unitsPerActiveDay: 1, tripsPerActivation: 1, notApplicable: false,
  fixedCostSharePct: 50, billableQuantityPerMonth: 10, activeDaysPerMonth: 10, knownRate: 1000000, targetMarginPct: 10,
  paymentTermDays: 60, price: 100000, replacementValue: 100000000, usefulLifeYears: 10, vatPct: 21, generalPct: 3, pct: 10,
  quantity: 1, unitCost: 1000, hoursPerActiveDay: 8,
  // Horas de cobertura del personal (PLAN-2026-014): con 6 personas por posición alcanza hasta 24 h × 31 días.
  peoplePerPosition: 6,
  // ECO-04: dónde está el costo de tenerlo de un vehículo de apoyo (H-08) y asignar el chofer u
  // operador de Personal a un externo que ya lo trae (F2: el aviso pasa a "operador duplicado").
  ownershipCostsIn: 'per_km',
  operatorLaborId: (quote) => (list(quote.labor).find((l) => Number(l.positions) > 0) || {}).id,
  // BETA-CR (P1-2): elegir un convenio del puesto (las cargas genéricas dejan de ser "de ejemplo").
  agreementId: 'cct-lab',
  // BETA-LANZ (ESC-03): el aviso de cargas genéricas lleva a las cargas patronales del puesto; un valor
  // propio (distinto del genérico de 24 %) lo resuelve.
  employerContributionsPct: 26.4,
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
    // Un valor que depende de la cotización (un id de otra línea) se calcula.
    const fix = typeof FIX_VALUES[field] === 'function' ? FIX_VALUES[field](quote, item) : FIX_VALUES[field];
    const candidates = [fix];
    if (typeof fix === 'number' && Number(current) === fix) candidates.push(fix * 2, fix + 1);
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
      if (lineNames.has(label) || FALLBACK_NAMES.has(label) || uiSource().includes(label) || DYNAMIC_LABELS.has(label)) continue;
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
 * F (terminología, nivel interfaz): magnitudes distintas con nombres distintos.
 * Se corre una vez por campaña.
 *   - viajes facturables ≠ viajes físicos, km por viaje ≠ km de ruta por mes,
 *     km facturables ≠ km de ruta, tarifa piso ≠ sugerida, margen ≠ markup:
 *     cada una tiene su rótulo propio (P1 UX si falta)
 *   - T estático (PLAN-2026-014, LAB-D8): la activación se nombra con
 *     activationTerms (llamado / salida / intervención según la cotización).
 *     Ningún texto del código usa "llamado", "salida" o "intervención" fijo,
 *     salvo los de ACTIVATION_WORDS_ALLOWED (cada uno con su motivo): P1 UX.
 *   - Jornada (PLAN-2026-014, LAB-D2): sin un dato de jornada diaria, ningún
 *     texto del código habla de "jornada": P1 UX.
 */
export function auditTerminology() {
  const src = uiSource();
  const findings = [];
  const DISTINCT = [
    ['viajes facturables', 'viajes físicos costeados'],
    ['km por viaje', 'km de ruta por mes'],
    ['km facturables', 'km de ruta'],
    ['tarifa piso', 'tarifa sugerida'],
    ['margen', 'markup'],
  ];
  for (const pair of DISTINCT) {
    const missing = pair.filter((t) => !src.includes(t));
    if (missing.length) findings.push(finding('UX-TERM-DISTINCT', 'P1', 'P1 UX', 'Dos magnitudes distintas sin rótulo propio', `Falta en la interfaz: ${missing.map((t) => `"${t}"`).join(', ')} (par ${pair.join(' / ')}).`, { pair }));
  }
  for (const hit of hardcodedActivationWords()) {
    findings.push(finding('UX-TERM-HARDCODED', 'P1', 'P1 UX', 'Texto con la activación escrita a mano', `${hit.file}: ${hit.text} — usar activationTerms (llamado / salida / intervención según la cotización) o agregarlo a ACTIVATION_WORDS_ALLOWED con su motivo.`, hit));
  }
  for (const hit of jornadaWords()) {
    findings.push(finding('UX-TERM-JORNADA', 'P1', 'P1 UX', 'Texto que habla de "jornada" sin un dato de jornada diaria', `${hit.file}: ${hit.text} — el control de horas del personal es de cobertura mensual: "horas de cobertura" / "horas cargadas para este puesto".`, hit));
  }
  return findings;
}

/** Palabras que nombran la activación en algún servicio ("salida de caja" es otra magnitud). */
const ACTIVATION_WORD = /\b(llamados?|salidas?|intervenci(?:ón|ones)|cambios? de turno)\b/i;
const CASH_OUT = /salidas? de caja/gi;

/**
 * Textos del código que pueden nombrar la activación a mano (archivo → textos exactos o "*").
 * Cada entrada tiene su motivo: son el nombre correcto en su contexto.
 */
export const ACTIVATION_WORDS_ALLOWED = Object.freeze({
  // La definición de los nombres.
  'domain/activation-terms.js': '*',
  // UXR: el catálogo para ELEGIR la unidad de cobro: "llamado" es el nombre de una unidad (que ES la
  // activación) y los sinónimos de búsqueda ("salida", "visita", "intervención") llevan a esa unidad.
  'domain/unit-catalog.js': '*',
  // La unidad de facturación "llamado" ES la activación (en esa cotización se nombra "llamado").
  'domain/billing-units.js': ["'llamado'", "'llamados'", "'$/llamado'", "'Se factura cada llamado, dure lo que dure.'"],
  // Recursos (sin tipo de servicio): etiqueta genérica; en la cotización se nombra como su activación.
  'domain/catalogs.js': ["'Por intervención (llamado o salida)'", "'/intervención'"],
  // Datos de la demo on-call (Hidrogrúa): ahí la activación es "llamado".
  'domain/demo-data.js': ["'Consumibles menores por llamado'", "'Hidrogrúa con operador disponible 24/7, se activa por llamado.'"],
  // Unidad "llamado" (sólo con esa unidad) y on-call (tiempo de respuesta).
  'ui/views/quote-steps/modality.js': ["'Llamados que esperás facturar en el mes. Si no estás seguro, cargá una estimación.'", "'Desde el llamado hasta estar operativo en locación.'"],
  // Consejo sólo del tipo on-call.
  'ui/views/quote-steps/service.js': ['on_call'],
});

/** Literales de texto del código (js/, sin vendor ni comentarios), por archivo (ruta relativa a js/). */
function jsLiterals() {
  const files = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'vendor') walk(p); } else if (d.name.endsWith('.js')) files.push(p);
  });
  walk(JS_DIR);
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  return files.sort().map((f) => ({
    rel: path.relative(JS_DIR, f).split(path.sep).join('/'),
    literals: strip(readFileSync(f, 'utf8')).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [],
  }));
}

/** Literales del código (js/, sin vendor ni comentarios) que nombran la activación a mano fuera de la lista. */
export function hardcodedActivationWords() {
  const hits = [];
  for (const { rel, literals } of jsLiterals()) {
    const allowed = ACTIVATION_WORDS_ALLOWED[rel];
    if (allowed === '*') continue;
    for (const lit of literals) {
      if (!ACTIVATION_WORD.test(lit.replace(CASH_OUT, ''))) continue;
      if (Array.isArray(allowed) && allowed.some((a) => (a === 'on_call' ? false : a === lit))) continue;
      // service.js: el consejo del tipo on-call (y sólo ese) puede decir "llamado".
      if (rel === 'ui/views/quote-steps/service.js' && /contá cuántos días por mes esperás trabajar/.test(lit)) continue;
      hits.push({ file: rel, text: lit.slice(0, 140) });
    }
  }
  return hits;
}

/**
 * "Jornada" (PLAN-2026-014, LAB-D2): RATEOS no tiene un dato de jornada diaria. El control de
 * horas del personal es de cobertura MENSUAL (días × horas por día contra horas normales por
 * mes y horas extra). Mientras no exista ese dato, ningún texto habla de jornada.
 */
const JORNADA_WORD = /\bjornadas?\b/i;

/** Literales del código (js/, sin vendor ni comentarios) que hablan de "jornada". */
export function jornadaWords() {
  return jsLiterals().flatMap(({ rel, literals }) => literals.filter((lit) => JORNADA_WORD.test(lit)).map((lit) => ({ file: rel, text: lit.slice(0, 140) })));
}

/** Nombres que cargó la persona (puestos, equipos, materiales…): no son rótulos. */
function userNames(quote) {
  return [
    ...list(quote.labor).map((l) => l.role),
    ...list(quote.equipment).map((e) => e.name),
    ...list(quote.materials).map((m) => m.description),
    ...list(quote.otherCosts).map((o) => o.description),
    ...list(quote.logistics && quote.logistics.vehicles).map((v) => v.name),
  ].filter((x) => typeof x === 'string' && x.trim());
}

/** Lo que muestra el motor de una cotización: pendientes, avisos, "Ver cálculo" y "cada salida completa". */
function resultTexts(result, T) {
  const texts = [];
  const walk = (v, where) => {
    if (typeof v === 'string') texts.push({ where, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') ['title', 'formula', 'label', 'message', 'text', 'notes', 'inputs', 'steps', 'result'].forEach((k) => { if (k in v) walk(v[k], `${where}.${k}`); });
  };
  const comp = result.completeness || {};
  walk(comp.items || [], 'completeness.items');
  walk(comp.notices || [], 'completeness.notices');
  Object.entries(result.traces || {}).forEach(([k, tr]) => walk(tr, `traces.${k}`));
  const rounding = activationRoundingText(result.activationRounding, T);
  if (rounding) walk(rounding, 'activationRoundingText');
  return texts;
}

/** Dinámico (PLAN-2026-014, LAB-D2): nada de lo que muestra el motor habla de "jornada" (P1 UX). */
export function auditJornadaWording(quote, result) {
  const names = userNames(quote);
  return resultTexts(result, activationTerms(quote)).flatMap(({ where, text }) => {
    let clean = text;
    names.forEach((n) => { clean = clean.split(n).join(''); });
    return JORNADA_WORD.test(clean)
      ? [finding('UX-TERM-JORNADA', 'P1', 'P1 UX', 'Habla de "jornada" sin un dato de jornada diaria', `${where}: ${text.slice(0, 160)}`, { where })]
      : [];
  });
}

/**
 * T dinámico (PLAN-2026-014, LAB-D8): en una cotización, todo lo que muestra el
 * motor (pendientes, avisos, "Ver cálculo") y el texto de "cada salida
 * completa" nombra la activación SÓLO con el nombre de esa cotización. Otro
 * nombre ("salida" en un on-call, "llamado" en un transporte) es P1 UX.
 */
export function auditActivationTerms(quote, result) {
  const T = activationTerms(quote);
  const own = new RegExp(`\\b(${T.one}|${T.many})\\b`, 'gi');
  const names = userNames(quote);
  const texts = resultTexts(result, T);
  const findings = [];
  for (const { where, text } of texts) {
    let clean = text.replace(CASH_OUT, '');
    names.forEach((n) => { clean = clean.split(n).join(''); });
    const foreign = clean.replace(own, '').match(ACTIVATION_WORD);
    if (foreign) {
      findings.push(finding('UX-TERM-FOREIGN', 'P1', 'P1 UX', 'Otra palabra para la misma magnitud',
        `${where}: "${foreign[0]}" en una cotización que la llama "${T.one}" — ${text.slice(0, 160)}`, { where, word: foreign[0], term: T.one }));
    }
  }
  return findings;
}

/**
 * Productos (PLAN-2026-014, LAB-D3): la financiación de un producto se calcula sobre costos
 * NETOS (el IVA de compras no se modela). Con financiación cargada, "Ver cálculo" tiene que
 * decirlo; si no, parece una simulación completa de caja (P1 UX). Se busca el sentido del texto,
 * no la constante: cambiar la redacción sin esa aclaración también falla.
 */
const NET_SCOPE = [/estimación financiera sobre costos netos/i, /iva de compras no está incluido/i];
export function auditProductFinanceScope(product, engine) {
  const f = engine && engine.finance;
  if (!f || !f.defined) return [];
  const notes = (engine.traces && engine.traces.finance && engine.traces.finance.notes) || [];
  const text = notes.join(' ');
  return NET_SCOPE.every((re) => re.test(text))
    ? []
    : [finding('UX-PRODUCT-FINANCE-SCOPE', 'P1', 'P1 UX', 'Financiación de un producto sin aclarar que es sobre costos netos', `"Ver cálculo" de la financiación: ${text.slice(0, 160) || '(sin notas)'}`, { product: product && product.id })];
}

/** Ruta de un pendiente → ¿existe en la cotización? (para el auditor de navegador). */
export function focusTargets(quote, result) {
  return result.completeness.pending.filter((p) => p.focus).map((p) => ({ id: p.id, focus: p.focus, step: stepOfPath(p.focus), exists: getPath(quote, p.focus) !== undefined }));
}
