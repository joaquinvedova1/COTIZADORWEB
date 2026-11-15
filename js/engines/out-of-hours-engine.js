/**
 * OutOfHoursEngine — tarifas FUERA DEL HORARIO NORMAL (PLAN-2026-025).
 *
 * El servicio se cotiza para un horario normal (por ejemplo de 8 a 17). Si el
 * cliente pide trabajar fuera de ese horario, a la gente se le pagan horas
 * extra (recargo del 50 % o del 100 %) y la tarifa tiene que ser otra. En vez
 * de pedir el costo a mano, se DERIVA de los recursos de la cotización:
 *
 *   horaBaseCuadrilla = Σ personas trabajando × (básico ÷ horas normales) × factor de cargas
 *   usoEquiposHora    = Σ equipos propios en uso × (combustible + mantenimiento + neumáticos por hora)
 *
 *   costo de una hora fuera de horario (recargo r)
 *       = horaBaseCuadrilla × (1 + r) + usoEquiposHora
 *     (lo que se paga DE MÁS por esa hora: las horas extra de la gente y el uso
 *      de los equipos. Sueldos, amortización y seguros ya están en el mes.)
 *
 *   recargo de la hora (lo que la hace más cara que una normal)
 *       = horaBaseCuadrilla × r
 *
 *   precio sugerido = el mayor entre
 *       a) costo de la hora cargado ÷ (1 − margen − impuestos)          (cubre su costo)
 *       b) hora normal equivalente + recargo cargado ÷ (1 − margen − impuestos)
 *     (b) evita que una hora fuera de horario salga más barata que una normal:
 *     la hora normal también paga sueldos, amortización y estructura.
 *
 *   hora normal equivalente = tarifa principal × unidades facturadas por mes
 *                             ÷ (días con trabajo × horas por día)
 *     calculada SIN las horas fuera de horario (así no hay cuenta circular).
 *
 * Las líneas viven en `quote.extras` con `kind: 'overtime'` y `premiumPct`
 * (50, 100 u otro): se cobran aparte, como cualquier adicional. Alquilados y
 * tercerizados no suman uso por hora (su tarifa depende de cada proveedor).
 *
 * Funciones puras: sin DOM, sin storage, sin fecha actual.
 */

import { isPlainObject, objectList } from '../core/object.js';
import { nonNegative, isFiniteNumber, safeDivide } from '../core/money.js';

export const OUT_OF_HOURS_KIND = 'overtime';

/** Recargos de partida (editables; los del 50 % y 100 % son los habituales, no normativa). */
export const OUT_OF_HOURS_PRESETS = Object.freeze([
  Object.freeze({ premiumPct: 50, label: 'Hora fuera de horario (extra 50 %)' }),
  Object.freeze({ premiumPct: 100, label: 'Hora fuera de horario (extra 100 %)' }),
]);

/** ¿El adicional es una tarifa fuera de horario derivada de los recursos? */
export function isOutOfHoursExtra(extra) {
  return isPlainObject(extra) && extra.kind === OUT_OF_HOURS_KIND;
}

/** ¿La cotización tiene tarifas fuera de horario? */
export function hasOutOfHours(extras) {
  return objectList(extras).some(isOutOfHoursExtra);
}

/**
 * Base de costo por hora de los recursos de la cotización.
 * @param {object} labor resultado de computeLabor
 * @param {object[]} equipment líneas de equipos del modelo de costos
 * @returns {{ crewBasePerHour: number, equipmentPerHour: number, people: number, equipmentUnits: number }}
 */
export function outOfHoursBasis(labor = null, equipment = []) {
  const lines = labor && Array.isArray(labor.lines) ? labor.lines : [];
  let crewBasePerHour = 0;
  let people = 0;
  lines.forEach((l) => {
    const positions = nonNegative(l && l.positions);
    if (!(positions > 0) || !l.perPerson) return;
    crewBasePerHour += positions * nonNegative(l.perPerson.hourlyBase) * nonNegative(l.perPerson.loadFactor, 1);
    people += positions;
  });
  let equipmentPerHour = 0;
  let equipmentUnits = 0;
  (Array.isArray(equipment) ? equipment : []).forEach((e) => {
    if (!e || e.acquisition !== 'owned' || !e.operation) return;
    const quantity = nonNegative(e.quantity);
    // Un equipo cargado con 0 horas de uso por día no trabaja en la locación (sólo traslada).
    if (!(quantity > 0) || !(nonNegative(e.hoursPerActiveDay) > 0)) return;
    equipmentPerHour += nonNegative(e.operation.totalPerHour) * quantity;
    equipmentUnits += quantity;
  });
  return { crewBasePerHour, equipmentPerHour, people, equipmentUnits };
}

/** Costo de UNA hora fuera de horario con recargo `premiumPct` (horas extra de la gente + uso de equipos). */
export function outOfHoursCostPerHour(basis, premiumPct) {
  const b = basis || {};
  return nonNegative(b.crewBasePerHour) * (1 + nonNegative(premiumPct) / 100) + nonNegative(b.equipmentPerHour);
}

/** Recargo por hora: lo que la hora extra cuesta de más que una hora normal de la misma gente. */
export function outOfHoursSurchargePerHour(basis, premiumPct) {
  return nonNegative(basis && basis.crewBasePerHour) * (nonNegative(premiumPct) / 100);
}

/**
 * Adicionales con el costo de las tarifas fuera de horario ya derivado (el
 * resto queda igual). No modifica la cotización.
 */
export function resolveExtras(extras, basis) {
  if (!Array.isArray(extras)) return extras;
  return extras.map((e) => {
    if (!isOutOfHoursExtra(e)) return e;
    const premiumPct = nonNegative(e.premiumPct);
    return {
      ...e,
      unitName: 'hora',
      category: 'labor',
      premiumPct,
      costPerUnit: outOfHoursCostPerHour(basis, premiumPct),
      surchargePerUnit: outOfHoursSurchargePerHour(basis, premiumPct),
    };
  });
}

/**
 * Hora normal equivalente de una cotización ya calculada (SIN tarifas fuera de
 * horario): lo que el cliente paga por una hora de trabajo en horario normal.
 * @returns {number|null} null si falta la tarifa o las horas de trabajo
 */
export function normalHourEquivalent({ listRate, billableUnits, activeDays, hoursPerActiveDay } = {}) {
  if (!isFiniteNumber(listRate) || !(listRate > 0)) return null;
  const hours = nonNegative(activeDays) * nonNegative(hoursPerActiveDay);
  const value = safeDivide(listRate * nonNegative(billableUnits), hours, null);
  return isFiniteNumber(value) && value > 0 ? value : null;
}
