/**
 * Catálogo de unidades de cobro para ELEGIR (UXR, rediseño de la cotización): todas las formas de cobrar que
 * el motor calcula de verdad, agrupadas y con sinónimos para buscarlas. No depende del tipo de servicio.
 *
 * Cada opción se guarda con los campos de siempre (sin ids nuevos en BILLING_UNITS, así una versión anterior
 * calcula igual):
 *   - una unidad del catálogo base (`unit`: hour, day, m3, trip…);
 *   - una variante por persona o por equipo de hora, día o mes (`activity.billedResourceKind`: hora-hombre,
 *     jornal, hora-equipo, día-equipo, equipo-mes; el motor multiplica por `activity.billedResources`);
 *   - una unidad propia (`unit: 'custom'` + `unitName`: litro, válvula, camión reparado, tráiler…);
 *   - el precio total del trabajo (`unit: 'job'` + `billingHorizon: 'job'`).
 *
 * Sólo datos y textos: nada de cálculo económico.
 */

import { deepFreeze } from '../core/object.js';
import { cleanUnitName, billingUnitOf } from './billing-units.js';

export const UNIT_GROUPS = deepFreeze([
  { id: 'time', label: 'Tiempo' },
  { id: 'resource', label: 'Por persona o por equipo' },
  { id: 'transport', label: 'Transporte' },
  { id: 'quantity', label: 'Cantidad producida o entregada' },
  { id: 'work', label: 'Llamados y trabajos' },
  { id: 'own', label: 'Unidades propias habituales' },
]);

/**
 * `key`: identificador de la opción (no se guarda). `name`: cómo se lee en la lista y en "ARS / …".
 * `apply`: lo que se guarda. `aliases`: palabras para encontrarla. `hint`: una frase.
 */
export const UNIT_CATALOG = deepFreeze([
  { key: 'hour', group: 'time', name: 'hora', apply: { unit: 'hour' }, aliases: ['horas', 'h', 'hora de servicio', 'hora de la cuadrilla', 'hora técnica', 'hora de equipo con operador'], hint: 'Se facturan las horas de trabajo del servicio (de toda la cuadrilla o el equipo).' },
  { key: 'day', group: 'time', name: 'día', apply: { unit: 'day' }, aliases: ['días', 'dia', 'diario', 'por día'], hint: 'Se factura cada día de trabajo.' },
  { key: 'shift', group: 'time', name: 'turno', apply: { unit: 'shift' }, aliases: ['turnos', 'guardia de 12 h', 'guardia'], hint: 'Se factura cada turno cubierto.' },
  { key: 'month', group: 'time', name: 'mes (abono)', apply: { unit: 'month' }, aliases: ['mes', 'mensual', 'abono', 'alquiler mensual', 'fijo mensual', 'canon'], hint: 'Un abono fijo por mes: la facturación no depende de cuánto se trabaje.' },
  { key: 'person_hour', group: 'resource', name: 'hora-hombre', apply: { unit: 'hour', billedResourceKind: 'person' }, aliases: ['hh', 'hora hombre', 'horas hombre', 'hora persona', 'hora-persona', 'hora por operario', 'hora técnica por persona'], hint: 'Cada persona factura sus horas: 4 personas × 10 h = 40 horas-hombre por día.' },
  { key: 'person_day', group: 'resource', name: 'jornal (día por persona)', apply: { unit: 'day', billedResourceKind: 'person' }, aliases: ['jornal', 'jornales', 'día hombre', 'día-hombre', 'día por persona', 'día persona'], hint: 'Cada persona factura sus días: 4 personas × 22 días = 88 jornales.' },
  { key: 'person_month', group: 'resource', name: 'persona por mes', apply: { unit: 'month', billedResourceKind: 'person' }, aliases: ['persona-mes', 'mes por persona', 'abono por persona', 'operario por mes'], hint: 'Un abono mensual por cada persona.' },
  { key: 'equipment_hour', group: 'resource', name: 'hora-equipo', apply: { unit: 'hour', billedResourceKind: 'equipment' }, aliases: ['hora equipo', 'hora máquina', 'hora de máquina', 'hora por equipo'], hint: 'Cada equipo factura sus horas.' },
  { key: 'equipment_day', group: 'resource', name: 'día-equipo', apply: { unit: 'day', billedResourceKind: 'equipment' }, aliases: ['día equipo', 'día de equipo', 'día máquina', 'día por equipo'], hint: 'Cada equipo factura sus días.' },
  { key: 'equipment_month', group: 'resource', name: 'equipo por mes', apply: { unit: 'month', billedResourceKind: 'equipment' }, aliases: ['equipo-mes', 'mes por equipo', 'abono por equipo', 'alquiler mensual por equipo'], hint: 'Un abono mensual por cada equipo.' },
  { key: 'trip', group: 'transport', name: 'viaje', apply: { unit: 'trip' }, aliases: ['viajes', 'flete', 'traslado', 'acarreo'], hint: 'Se factura cada viaje.' },
  { key: 'km', group: 'transport', name: 'km', apply: { unit: 'km' }, aliases: ['kilómetro', 'kilometro', 'kilómetros recorridos'], hint: 'Se factura cada km.' },
  { key: 'tonkm', group: 'transport', name: 'ton-km', apply: { unit: 'tonkm' }, aliases: ['tonelada kilómetro', 'tkm'], hint: 'Toneladas × km transportados.' },
  { key: 'ton', group: 'quantity', name: 'tonelada', apply: { unit: 'ton' }, aliases: ['t', 'toneladas', 'tn'], hint: 'Se factura cada tonelada.' },
  { key: 'm3', group: 'quantity', name: 'm³', apply: { unit: 'm3' }, aliases: ['metro cúbico', 'metros cúbicos', 'm3', 'volumen'], hint: 'Se factura cada metro cúbico.' },
  { key: 'liter', group: 'quantity', name: 'litro', apply: { unit: 'custom', unitName: 'litro' }, aliases: ['litros', 'l', 'lt'], hint: 'Se factura cada litro.' },
  { key: 'kg', group: 'quantity', name: 'kg', apply: { unit: 'kg' }, aliases: ['kilo', 'kilogramo', 'kilos'], hint: 'Se factura cada kilo.' },
  { key: 'meter', group: 'quantity', name: 'metro', apply: { unit: 'meter' }, aliases: ['metros', 'm', 'metro lineal', 'ml'], hint: 'Se factura cada metro lineal.' },
  { key: 'm2', group: 'quantity', name: 'm²', apply: { unit: 'm2' }, aliases: ['metro cuadrado', 'metros cuadrados', 'm2', 'superficie'], hint: 'Se factura cada metro cuadrado.' },
  { key: 'unit', group: 'quantity', name: 'unidad', apply: { unit: 'unit' }, aliases: ['unidades', 'pieza', 'piezas', 'u'], hint: 'Se factura cada unidad.' },
  { key: 'lot', group: 'quantity', name: 'lote', apply: { unit: 'lot' }, aliases: ['lotes', 'partida'], hint: 'Se factura cada lote.' },
  { key: 'call', group: 'work', name: 'llamado', apply: { unit: 'call' }, aliases: ['llamados', 'salida', 'call-out', 'visita', 'intervención'], hint: 'Un precio fijo por llamado, dure lo que dure.' },
  { key: 'job', group: 'work', name: 'precio total del trabajo', apply: { unit: 'job', billingHorizon: 'job' }, aliases: ['obra', 'global', 'precio cerrado', 'precio global', 'llave en mano', 'lump sum', 'total', 'trabajo completo', 'presupuesto cerrado'], hint: 'Un único precio por todo el trabajo, aunque dure varios meses.' },
  { key: 'milestone', group: 'work', name: 'hito', apply: { unit: 'milestone' }, aliases: ['hitos', 'anticipo', 'avance', 'certificado'], hint: 'El precio del trabajo se factura en partes.' },
  { key: 'own:inspección', group: 'own', name: 'inspección', apply: { unit: 'custom', unitName: 'inspección' }, aliases: ['inspecciones', 'diagnóstico', 'control'], hint: 'Unidad propia: se factura cada inspección.' },
  { key: 'own:válvula', group: 'own', name: 'válvula', apply: { unit: 'custom', unitName: 'válvula' }, aliases: ['válvulas', 'valvula', 'válvula inspeccionada'], hint: 'Unidad propia: se factura cada válvula.' },
  { key: 'own:camión reparado', group: 'own', name: 'camión reparado', apply: { unit: 'custom', unitName: 'camión reparado' }, aliases: ['camión', 'camion', 'camiones', 'reparación'], hint: 'Unidad propia: se factura cada camión.' },
  { key: 'own:tráiler', group: 'own', name: 'tráiler', apply: { unit: 'custom', unitName: 'tráiler' }, aliases: ['trailer', 'tráileres', 'semirremolque', 'carga y descarga'], hint: 'Unidad propia: se factura cada tráiler atendido.' },
  { key: 'own:operación', group: 'own', name: 'operación', apply: { unit: 'custom', unitName: 'operación' }, aliases: ['operaciones', 'maniobra', 'maniobras', 'operación de carga', 'carga', 'descarga'], hint: 'Unidad propia: se factura cada operación (no cada viaje ni cada salida).' },
  { key: 'own:ensayo', group: 'own', name: 'ensayo', apply: { unit: 'custom', unitName: 'ensayo' }, aliases: ['ensayos', 'prueba', 'test'], hint: 'Unidad propia: se factura cada ensayo.' },
  { key: 'own:muestra', group: 'own', name: 'muestra', apply: { unit: 'custom', unitName: 'muestra' }, aliases: ['muestras', 'análisis'], hint: 'Unidad propia: se factura cada muestra.' },
  { key: 'own:pozo', group: 'own', name: 'pozo', apply: { unit: 'custom', unitName: 'pozo' }, aliases: ['pozos', 'locación'], hint: 'Unidad propia: se factura cada pozo.' },
]);

/** Las que se muestran a la vista (las más comunes en los rubros de RATEOS). */
export const SUGGESTED_UNIT_KEYS = deepFreeze(['hour', 'day', 'month', 'trip', 'km', 'job']);

/** Minúsculas, sin acentos ni signos (para buscar "camion" y encontrar "camión"). */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function unitEntry(key) {
  return UNIT_CATALOG.find((e) => e.key === key) || null;
}

/**
 * Opción del catálogo que corresponde a una cotización ({ unit, unitName, activity.billedResourceKind,
 * billingHorizon }). Una unidad propia que no está en el catálogo → null (se muestra con su nombre).
 */
export function unitKeyOf(quote = {}) {
  const unit = quote.unit || 'day';
  const a = quote.activity || {};
  const res = a.billedResourceKind === 'person' || a.billedResourceKind === 'equipment' ? a.billedResourceKind : null;
  if (unit === 'custom') {
    const name = normalizeText(cleanUnitName(quote.unitName));
    const hit = UNIT_CATALOG.find((e) => e.apply.unit === 'custom' && normalizeText(e.apply.unitName) === name);
    return hit ? hit.key : null;
  }
  if (unit === 'job') return quote.billingHorizon === 'job' ? 'job' : 'job_monthly';
  if (res && ['hour', 'day', 'month'].includes(unit)) return `${res}_${unit}`;
  return UNIT_CATALOG.some((e) => e.key === unit) ? unit : null;
}

/** Nombre a mostrar de la unidad de una cotización ("hora-hombre", "precio total del trabajo", "pozo"). */
export function unitDisplayName(quote = {}) {
  const key = unitKeyOf(quote);
  if (key === 'job_monthly') return 'trabajo (por mes)';
  const entry = key ? unitEntry(key) : null;
  if (entry) return entry.name;
  return billingUnitOf(quote).singular || 'unidad';
}

/**
 * Cómo se cobra una cotización o plantilla, para listas y tarjetas (en lugar del tipo de servicio):
 * "Por hora-hombre", "Precio total del trabajo", "Abono mensual · a demanda".
 */
export function chargeSummary(quote = {}) {
  const key = unitKeyOf(quote);
  const base = key === 'job'
    ? 'Precio total del trabajo'
    : key === 'job_monthly'
      ? 'Por trabajo (trabajos por mes)'
      : key === 'month'
        ? 'Abono mensual'
        : `Por ${unitDisplayName(quote)}`;
  return quote.serviceType === 'on_call' ? `${base} · a demanda` : base;
}

/**
 * Busca en el catálogo. Devuelve [{ group, label, items: [entry] }] en el orden de UNIT_GROUPS, con las que
 * empiezan con el texto primero. Sin texto: todo el catálogo.
 */
export function searchUnits(query = '') {
  const q = normalizeText(query);
  const score = (e) => {
    if (!q) return 1;
    const words = [e.name, ...e.aliases].map(normalizeText);
    if (words.some((w) => w === q)) return 3;
    if (words.some((w) => w.startsWith(q))) return 2;
    if (words.some((w) => w.includes(q))) return 1;
    return 0;
  };
  return UNIT_GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    items: UNIT_CATALOG.filter((e) => e.group === g.id)
      .map((e) => ({ e, s: score(e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.e),
  })).filter((g) => g.items.length > 0);
}

/** ¿El texto buscado coincide exactamente con una opción? (si no, se ofrece "Usar «…» como unidad"). */
export function exactUnitMatch(query = '') {
  const q = normalizeText(query);
  if (!q) return null;
  return UNIT_CATALOG.find((e) => [e.name, ...e.aliases].some((w) => normalizeText(w) === q)) || null;
}

/** Lo que se guarda para una unidad propia escrita por la persona. */
export function customUnitApply(name) {
  const clean = cleanUnitName(name);
  return clean ? { unit: 'custom', unitName: clean } : null;
}

/**
 * Aplica una opción a una cotización (dentro de un mutate). No toca tarifas ni cantidades: eso lo decide
 * el diálogo de cambio de unidad. Devuelve la cotización.
 */
export function applyUnit(q, apply) {
  q.unit = apply.unit;
  if (apply.unit === 'custom') q.unitName = apply.unitName;
  q.activity = q.activity || {};
  if (apply.billedResourceKind) {
    q.activity.billedResourceKind = apply.billedResourceKind;
  } else if (q.activity.billedResourceKind !== undefined) {
    delete q.activity.billedResourceKind;
    delete q.activity.billedResources;
  }
  if (apply.billingHorizon) {
    q.billingHorizon = apply.billingHorizon;
  } else if (q.billingHorizon !== undefined) {
    delete q.billingHorizon;
  }
  return q;
}

/** Lo que guarda hoy una cotización, en la forma de `apply` (para comparar con otra opción). */
export function currentApply(quote = {}) {
  const a = quote.activity || {};
  return {
    unit: quote.unit || 'day',
    unitName: quote.unit === 'custom' ? cleanUnitName(quote.unitName) : undefined,
    billedResourceKind: a.billedResourceKind === 'person' || a.billedResourceKind === 'equipment' ? a.billedResourceKind : undefined,
    billingHorizon: quote.billingHorizon === 'job' ? 'job' : undefined,
  };
}

/** ¿Dos `apply` son la misma unidad? */
export function sameApply(a, b) {
  return a.unit === b.unit
    && (a.unit !== 'custom' || normalizeText(a.unitName) === normalizeText(b.unitName))
    && (a.billedResourceKind || null) === (b.billedResourceKind || null)
    && (a.billingHorizon || null) === (b.billingHorizon || null);
}
