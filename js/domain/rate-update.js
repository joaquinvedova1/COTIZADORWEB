/**
 * Actualización de tarifas por estructura de costos (EECC), versión 0.11.
 *
 * Una cotización es UN ítem con UN precio. Con el tiempo sus costos suben: en lugar de
 * rehacer la cotización, el usuario la ACTUALIZA a un período nuevo con un % por categoría
 * de la EECC, y la tarifa vigente sale ponderada por la incidencia de cada categoría:
 *
 *   tarifa nueva = tarifa × (1 + Σ incidencia_i × %_i)
 *
 * La actualización NO toca los datos de la cotización (sueldos, equipos, materiales): queda
 * guardada aparte, en `quote.rateUpdate`, con su historial, y se puede deshacer.
 *
 *   quote.rateUpdate = {
 *     basePeriod: 'AAAA-MM' | null,   // período de los costos con que se armó la tarifa
 *     base: { rate, amounts: { [categoría]: $ } } | null,   // FOTO de la tarifa y la EECC al
 *                                     // actualizar por primera vez: la tarifa vigente se calcula
 *                                     // siempre sobre esta foto (editar la cotización después no
 *                                     // reescribe el historial ni cuenta dos veces un aumento)
 *     previous: [{ basePeriod, base, steps }],  // historiales anteriores (al "tomar la
 *                                     // cotización actual como nueva base")
 *     steps: [{ id, toPeriod: 'AAAA-MM', pcts: { [categoría]: número }, appliedAt, note }],
 *   }
 *
 * Funciones puras: sin fecha actual (la pasa quien llama).
 */

import { isPlainObject, deepFreeze } from '../core/object.js';
import { isValidPeriod, monthsBetween } from './economic-base.js';
import { MATERIAL_TYPE_IDS, materialTypeShort } from './material-types.js';

/** Qué entra en cada tipo de "Insumos y materiales", en la actualización de tarifas. */
const RATE_UPDATE_TYPE_HINTS = Object.freeze({
  tools: 'Herramientas menores y su reposición.',
  supplies: 'Electrodos, discos, gas, filtros, químicos.',
  materials: 'Lo que queda en la obra: caños, cables, pintura.',
  ppe: 'Sólo el EPP especial del trabajo; la ropa y el EPP de cada persona van con Mano de obra.',
  other: 'Permisos, seguros del trabajo, residuos, ingeniería.',
});

/**
 * Categorías estándar de la EECC que se actualizan. Son los renglones del Resultado; los
 * Materiales se abren en sus categorías de gasto (0.10.0) porque cada una sigue precios
 * distintos (el EPP no sube como los caños). `source` dice de qué renglón de la EECC sale.
 */
export const RATE_UPDATE_CATEGORIES = deepFreeze([
  { id: 'labor', label: 'Mano de obra', hint: 'Sueldos y cargas: el aumento del convenio (paritaria) entre los dos meses.', source: 'labor' },
  { id: 'equipment', label: 'Equipos propios', hint: 'Reposición, mantenimiento y seguros de tus equipos y vehículos.', source: 'equipment' },
  { id: 'external', label: 'Equipos y servicios de terceros', hint: 'Lo que te aumentaron tus proveedores y subcontratistas.', source: 'external' },
  { id: 'fuel', label: 'Combustible', hint: 'Variación del precio del gasoil o la nafta.', source: 'fuel' },
  // Los 5 tipos de "Insumos y materiales" salen del mismo catálogo (PLAN-2026-027): mismos ids y
  // mismo orden de siempre (las fotos guardadas siguen valiendo).
  ...MATERIAL_TYPE_IDS.map((id) => ({ id, label: materialTypeShort(id), hint: RATE_UPDATE_TYPE_HINTS[id], source: 'materials' })),
  { id: 'logistics', label: 'Logística y viáticos', hint: 'Traslados, desarraigo, hotel y comidas.', source: 'logistics' },
  { id: 'structure', label: 'Gastos de estructura', hint: 'Oficina, administración y otros gastos generales.', source: 'structure' },
]);

export const RATE_UPDATE_CATEGORY_IDS = deepFreeze(RATE_UPDATE_CATEGORIES.map((c) => c.id));

/**
 * Renglones de la EECC que NO se actualizan con un % propio: se calculan como un % del resto
 * (costo financiero, imprevistos, inflación esperada con precio fijo), así que acompañan solos al
 * promedio de las demás.
 */
export const FOLLOWING_EECC_CATEGORIES = deepFreeze(['financial', 'contingency', 'inflation']);

/** Límites del % de actualización de una categoría (puede bajar: un combustible más barato). */
export const RATE_UPDATE_PCT_MIN = -90;
export const RATE_UPDATE_PCT_MAX = 500;
/** Máximo de actualizaciones guardadas por cotización. */
export const MAX_RATE_UPDATE_STEPS = 120;
export const MAX_RATE_UPDATE_NOTE = 160;

/** ¿Es un % de actualización válido? */
export function isValidUpdatePct(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= RATE_UPDATE_PCT_MIN && value <= RATE_UPDATE_PCT_MAX;
}

/** % por categoría, sólo categorías conocidas y valores válidos (0 se omite). */
export function normalizeUpdatePcts(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  RATE_UPDATE_CATEGORY_IDS.forEach((id) => {
    const v = raw[id];
    if (isValidUpdatePct(v) && v !== 0) out[id] = v;
  });
  return out;
}

/** Foto de la base: tarifa > 0 y montos ≥ 0 por categoría conocida, o null. */
export function normalizeRateBase(raw) {
  if (!isPlainObject(raw) || typeof raw.rate !== 'number' || !Number.isFinite(raw.rate) || raw.rate <= 0) return null;
  const amounts = {};
  if (isPlainObject(raw.amounts)) {
    RATE_UPDATE_CATEGORY_IDS.forEach((id) => {
      const v = raw.amounts[id];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) amounts[id] = v;
    });
  }
  return Object.keys(amounts).length ? { rate: raw.rate, amounts } : null;
}

export const MAX_PREVIOUS_RATE_HISTORIES = 20;

/**
 * `quote.rateUpdate` saneado: nunca lanza. Un paso con período inválido o que no avanza en el
 * tiempo se descarta (los períodos de los pasos van siempre hacia adelante).
 */
export function normalizeRateUpdate(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const basePeriod = isValidPeriod(src.basePeriod) ? src.basePeriod : null;
  const steps = [];
  let last = basePeriod;
  (Array.isArray(src.steps) ? src.steps : []).slice(0, MAX_RATE_UPDATE_STEPS).forEach((s) => {
    if (!isPlainObject(s) || !isValidPeriod(s.toPeriod)) return;
    if (last && monthsBetween(last, s.toPeriod) <= 0) return;
    steps.push({
      id: typeof s.id === 'string' && s.id ? s.id : `paso-${steps.length + 1}`,
      toPeriod: s.toPeriod,
      pcts: normalizeUpdatePcts(s.pcts),
      appliedAt: typeof s.appliedAt === 'string' ? s.appliedAt : null,
      note: typeof s.note === 'string' ? s.note.slice(0, MAX_RATE_UPDATE_NOTE) : '',
    });
    last = s.toPeriod;
  });
  const previous = (Array.isArray(src.previous) ? src.previous : [])
    .filter((p) => isPlainObject(p))
    .slice(-MAX_PREVIOUS_RATE_HISTORIES)
    .map((p) => ({ basePeriod: isValidPeriod(p.basePeriod) ? p.basePeriod : null, base: normalizeRateBase(p.base), steps: Array.isArray(p.steps) ? p.steps.slice(0, MAX_RATE_UPDATE_STEPS) : [] }));
  return { basePeriod, base: normalizeRateBase(src.base), steps, previous };
}
