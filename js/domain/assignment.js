/**
 * Asignación de un recurso a una cotización (PLAN-2026-006 §3.1, implementado
 * en PLAN-2026-012).
 *
 * Qué parte del COSTO FIJO de una persona o de un equipo PROPIO carga esta
 * cotización. Es un dato de la LÍNEA de la cotización (cómo se usa el recurso
 * acá), nunca del recurso maestro.
 *
 *   Personal:  dedicada (100 %) · compartida (% explícito) · contratada
 *              específicamente para este servicio (100 %)
 *   Equipos:   reservado para este servicio (100 %) · compartido (% explícito)
 *
 * Reglas:
 * - Sin dato = 100 %: las cotizaciones anteriores no cambian.
 * - Nunca se infiere del uso ("trabaja 15 días" no es "50 % del fijo"): el uso
 *   real mueve sólo los costos variables (horas extra, viandas, combustible,
 *   mantenimiento por uso, km), que NO se reducen.
 * - Compartido sin % válido (vacío, ≤ 0 o no numérico) → 100 %: nunca se
 *   esconde costo (la validación lo marca). Más de 100 → 100.
 * - No aplica a alquilados / tercerizados: se pagan por unidad usada.
 */

import { isPlainObject } from '../core/object.js';

export const LABOR_ASSIGNMENTS = Object.freeze([
  Object.freeze({ id: 'dedicated', label: 'Dedicada a este servicio (100 %)', short: 'Dedicada' }),
  Object.freeze({ id: 'shared', label: 'Compartida (asignás un %)', short: 'Compartida' }),
  Object.freeze({ id: 'hired', label: 'Contratada para este servicio (100 %)', short: 'Contratada para este servicio' }),
]);

export const EQUIPMENT_ASSIGNMENTS = Object.freeze([
  Object.freeze({ id: 'reserved', label: 'Reservado para este servicio (100 %)', short: 'Reservado' }),
  Object.freeze({ id: 'shared', label: 'Compartido (asignás un %)', short: 'Compartido' }),
]);

export const FULL_SHARE_PCT = 100;

/** Lee el % de costo fijo cargado (sin aplicar reglas): número o null. */
function readPct(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * % del costo fijo que carga esta cotización (en puntos, 0 < % ≤ 100).
 * @param {object} line  línea de personal o de equipo propio
 * @returns {{ assignment: string|null, shared: boolean, sharePct: number, share: number, missing: boolean }}
 */
export function fixedCostShareOf(line) {
  const l = isPlainObject(line) ? line : {};
  const assignment = typeof l.assignment === 'string' && l.assignment ? l.assignment : null;
  if (assignment !== 'shared') return { assignment, shared: false, sharePct: FULL_SHARE_PCT, share: 1, missing: false };
  const raw = readPct(l.fixedCostSharePct);
  if (raw === null || raw <= 0) return { assignment, shared: true, sharePct: FULL_SHARE_PCT, share: 1, missing: true };
  const sharePct = Math.min(raw, FULL_SHARE_PCT);
  return { assignment, shared: true, sharePct, share: sharePct / 100, missing: false };
}

/**
 * Respuesta a "¿Tu gente y tus equipos trabajan sólo para este servicio?" que
 * se lee de las líneas (personal y equipos propios) de una cotización (V-01):
 *
 *   'no'   todas compartidas
 *   'yes'  ninguna compartida y al menos una con respuesta explícita
 *          (dedicada, reservado, contratada)
 *   null   sin elegir: ninguna línea tiene respuesta, o están mezcladas
 *
 * Sin dato el costo es 100 % (como siempre), pero la pantalla no lo muestra
 * como una respuesta: nadie la eligió.
 * @param {object[]} lines líneas de personal y de equipos PROPIOS
 * @returns {'yes'|'no'|null}
 */
export function dedicationChoiceOf(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter(isPlainObject);
  if (!list.length) return null;
  const sharedCount = list.filter((l) => l.assignment === 'shared').length;
  const explicitCount = list.filter((l) => typeof l.assignment === 'string' && l.assignment !== '' && l.assignment !== 'shared').length;
  if (sharedCount === list.length) return 'no';
  if (sharedCount === 0 && explicitCount > 0) return 'yes';
  return null;
}
