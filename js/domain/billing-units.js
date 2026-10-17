/**
 * Unidades de FACTURACIÓN de una cotización (PLAN-2026-009).
 *
 * UNIDAD DE VENTA ≠ UNIDAD DE COSTO: los costos se siguen calculando con sus
 * drivers reales (días de trabajo, horas, km, litros…) y la facturación se
 * expresa en la unidad comercial que elige la empresa:
 *
 *   kind 'day'      $/día     → cantidad facturable = días de trabajo (+ mínimo por llamado)
 *   kind 'hour'     $/hora    → días de trabajo × horas por día (+ mínimo por llamado)
 *   kind 'month'    $/mes     → 1 abono por mes
 *   kind 'event'    $/llamado, $/trabajo, $/hito → llamados o trabajos (× hitos por trabajo)
 *   kind 'quantity' $/m³, $/viaje, $/tonelada, $/turno, …, o una unidad propia
 *                   → días de trabajo × cantidad por día de trabajo (+ mínimo por llamado)
 *
 * La actividad se pide en la unidad comercial ("¿Cuántos m³ esperás facturar
 * por mes?") y los días de trabajo se DERIVAN (cantidad ÷ rendimiento).
 *
 * Sólo datos y textos: nada de cálculo económico.
 */

import { deepFreeze } from '../core/object.js';

const MAX_UNIT_NAME = 30;

/**
 * Catálogo de unidades. `short` es lo que va después de "$ /" y en los
 * rótulos de cantidad ("1.240 m³"); `perDayQuestion` pide el rendimiento.
 */
export const BILLING_UNITS = deepFreeze([
  { id: 'hour', kind: 'hour', singular: 'hora', plural: 'horas', short: 'hora', label: '$/hora', hint: 'Se factura cada hora trabajada (días de trabajo × horas por día).' },
  { id: 'day', kind: 'day', singular: 'día', plural: 'días', short: 'día', label: '$/día', hint: 'Se factura cada día de trabajo.' },
  { id: 'month', kind: 'month', singular: 'mes', plural: 'meses', short: 'mes', label: '$/mes (abono)', hint: 'Abono fijo mensual: la facturación no depende de cuánto trabajes.' },
  { id: 'call', kind: 'event', singular: 'llamado', plural: 'llamados', short: 'llamado', label: '$/llamado', hint: 'Se factura cada llamado, dure lo que dure.' },
  { id: 'shift', kind: 'quantity', singular: 'turno', plural: 'turnos', short: 'turno', label: '$/turno', hint: 'Se factura cada turno cubierto.' },
  { id: 'trip', kind: 'quantity', singular: 'viaje', plural: 'viajes', short: 'viaje', label: '$/viaje', hint: 'Se factura cada viaje.' },
  { id: 'km', kind: 'quantity', singular: 'km', plural: 'km', short: 'km', label: '$/km', hint: 'Se factura cada km recorrido.' },
  { id: 'ton', kind: 'quantity', singular: 'tonelada', plural: 'toneladas', short: 't', label: '$/tonelada', hint: 'Se factura cada tonelada.' },
  { id: 'tonkm', kind: 'quantity', singular: 'ton-km', plural: 'ton-km', short: 'ton-km', label: '$/ton-km', hint: 'Toneladas × km transportados.' },
  { id: 'm3', kind: 'quantity', singular: 'm³', plural: 'm³', short: 'm³', label: '$/m³', hint: 'Se factura cada metro cúbico.' },
  { id: 'unit', kind: 'quantity', singular: 'unidad', plural: 'unidades', short: 'u.', label: '$/unidad', hint: 'Se factura cada unidad producida o realizada.' },
  { id: 'kg', kind: 'quantity', singular: 'kg', plural: 'kg', short: 'kg', label: '$/kg', hint: 'Se factura cada kilo.' },
  { id: 'meter', kind: 'quantity', singular: 'metro', plural: 'metros', short: 'm', label: '$/metro', hint: 'Se factura cada metro lineal.' },
  { id: 'm2', kind: 'quantity', singular: 'm²', plural: 'm²', short: 'm²', label: '$/m²', hint: 'Se factura cada metro cuadrado.' },
  { id: 'lot', kind: 'quantity', singular: 'lote', plural: 'lotes', short: 'lote', label: '$/lote', hint: 'Se factura cada lote.' },
  { id: 'job', kind: 'event', singular: 'trabajo', plural: 'trabajos', short: 'trabajo', label: '$ global (por trabajo)', hint: 'Un único precio por todo el trabajo.' },
  { id: 'milestone', kind: 'event', singular: 'hito', plural: 'hitos', short: 'hito', label: '$/hito', hint: 'El precio del trabajo se factura en partes, por hito.', perActivation: true },
  { id: 'custom', kind: 'quantity', singular: '', plural: '', short: '', label: 'Otra / personalizada', hint: 'Escribí tu unidad: pozo, muestra, ensayo…', custom: true },
]);

export const BILLING_UNIT_IDS = deepFreeze(BILLING_UNITS.map((u) => u.id));

/** Unidades que existían antes de PLAN-2026-009 (calculan exactamente igual). */
export const LEGACY_BILLING_UNITS = deepFreeze(['day', 'hour', 'month']);

/**
 * Unidades habituales según el tipo de servicio (la primera es la sugerida).
 * "Otra / personalizada" se ofrece siempre; "Servicio configurable", todas.
 */
export const SERVICE_TYPE_UNITS = deepFreeze({
  on_call: ['day', 'hour', 'call', 'month'],
  permanent: ['month', 'day', 'hour', 'shift'],
  crew: ['day', 'hour', 'shift', 'month'],
  equipment_with_operator: ['day', 'hour', 'month', 'trip'],
  equipment_only: ['day', 'hour', 'month', 'trip'],
  per_unit: ['unit', 'm3', 'ton', 'kg', 'meter', 'm2', 'km', 'lot'],
  transport: ['trip', 'km', 'ton', 'tonkm', 'm3', 'hour', 'day'],
  turnkey: ['job', 'milestone'],
  lump_sum: ['job', 'milestone'],
  time_materials: ['hour', 'day'],
  configurable: BILLING_UNIT_IDS.filter((id) => id !== 'custom'),
});

/** Plural simple de una unidad escrita por la persona ("pozo" → "pozos"). */
export function pluralizeUnit(word) {
  const w = typeof word === 'string' ? word.trim() : '';
  if (!w) return 'unidades';
  if (/[²³]|^[a-z]{1,2}$/i.test(w) || /-/.test(w)) return w;
  if (/ón$/i.test(w)) return `${w.slice(0, -2)}ones`;
  if (/[aeiouáéíóú]$/i.test(w)) return `${w}s`;
  if (/s$/i.test(w)) return w;
  return `${w}es`;
}

/** Nombre de unidad propia saneado (sin caracteres de control, máx. 30). */
export function cleanUnitName(raw) {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/^\s*\$?\s*\/?\s*/, '').trim().slice(0, MAX_UNIT_NAME) : '';
}

/**
 * Unidad de facturación de una cotización, resuelta para mostrar y calcular.
 * Una unidad desconocida (o vacía) es "día", como siempre.
 * @param {object} quote
 * @returns {{ id: string, kind: 'day'|'hour'|'month'|'event'|'quantity', singular: string, plural: string, short: string, label: string, custom: boolean, legacy: boolean }}
 */
export function billingUnitOf(quote = {}) {
  const id = quote && typeof quote.unit === 'string' && BILLING_UNIT_IDS.includes(quote.unit) ? quote.unit : 'day';
  const def = BILLING_UNITS.find((u) => u.id === id);
  if (def.custom) {
    const name = cleanUnitName(quote.unitName) || 'unidad';
    const plural = name === 'unidad' ? 'unidades' : pluralizeUnit(name);
    return { id, kind: def.kind, singular: name, plural, short: name, label: `$/${name}`, custom: true, legacy: false };
  }
  return { id, kind: def.kind, singular: def.singular, plural: def.plural, short: def.short, label: def.label, custom: false, legacy: LEGACY_BILLING_UNITS.includes(id) };
}

/** Unidades para elegir según el tipo de servicio (+ la actual, si no está, + "Otra"). */
export function unitChoicesFor(serviceType, currentUnit = null) {
  const list = [...(SERVICE_TYPE_UNITS[serviceType] || SERVICE_TYPE_UNITS.configurable)];
  if (currentUnit && BILLING_UNIT_IDS.includes(currentUnit) && currentUnit !== 'custom' && !list.includes(currentUnit)) list.push(currentUnit);
  list.push('custom');
  return list.map((id) => BILLING_UNITS.find((u) => u.id === id));
}

/** Unidad sugerida para un tipo de servicio. */
export function defaultUnitFor(serviceType) {
  const list = SERVICE_TYPE_UNITS[serviceType];
  return list && list.length ? list[0] : 'day';
}

/** ¿La unidad es una de las habituales para el tipo de servicio? */
export function unitFitsServiceType(serviceType, unit) {
  if (unit === 'custom') return true;
  const list = SERVICE_TYPE_UNITS[serviceType];
  return !list || list.includes(unit || 'day');
}

/** Género gramatical aproximado de una unidad ("muestra", "inspección" → femenino). */
export function isFeminineUnit(singular) {
  const w = typeof singular === 'string' ? singular.trim().toLowerCase() : '';
  if (!w || ['día', 'dia', 'mapa', 'problema', 'sistema', 'programa'].includes(w)) return false;
  return /(a|ción|sión|dad|tud)$/.test(w);
}

/** Textos de la actividad y del equilibrio en la unidad comercial. */
export function unitTexts(info) {
  const u = info || billingUnitOf({});
  const plural = u.plural || 'unidades';
  const fem = isFeminineUnit(u.singular);
  const cuantos = fem ? 'Cuántas' : 'Cuántos';
  return {
    // Concordancia ("las unidades", "cuántas toneladas", "ningún viaje").
    los: fem ? 'las' : 'los',
    cuantos: fem ? 'cuántas' : 'cuántos',
    Cuantos: cuantos,
    ningun: fem ? 'ninguna' : 'ningún',
    facturados: fem ? 'facturadas' : 'facturados',
    elPrimer: fem ? 'la primera' : 'el primer',
    vendido: fem ? 'vendida' : 'vendido',
    quantityQuestion: `¿${cuantos} ${plural} esperás facturar por mes?`,
    perDayQuestion: `¿${cuantos} ${plural} hacés por día de trabajo?`,
    // Los símbolos (m³, km, kg, t) no se escriben con mayúscula.
    breakEvenLabel: `${/^[a-zñáéíóú]{4,}/i.test(plural) ? `${plural.charAt(0).toUpperCase()}${plural.slice(1)}` : plural} para no perder`,
    perMonth: `${plural}/mes`,
    perDay: `${plural}/día`,
  };
}
