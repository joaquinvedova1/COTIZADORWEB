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
 *   hora normal equivalente
 *       cobrando por hora: la tarifa · por día: tarifa ÷ horas por día
 *       por hora-hombre: tarifa × personas de la cuadrilla (V-34)
 *         (calculada SIN las horas fuera de horario: no hay cuenta circular)
 *       abono, precio cerrado o por unidad: hora normal de los recursos con margen
 *         (Σ personas × costo del mes ÷ horas normales + uso de equipos)
 *
 *   Las horas estimadas no abaratan la tarifa principal: al calcularla, cada hora
 *   fuera de horario cuenta sólo por el precio que cubre su costo.
 *
 *   Valor propio por recurso (PLAN-2026-026): si un perfil de Recursos trae su hora al 50 % o al
 *   100 % (por convenio), la hora de la cuadrilla es la SUMA de la de cada persona (no base × (1 + r))
 *   y el recargo es esa suma menos la hora base. Sin valores propios: el cálculo de siempre.
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

/** Unidad de cobro "hora-hombre" (`billing-units.js`): su hora normal sale de la tarifa × personas (V-34). */
export const MAN_HOUR_UNIT = 'manhour';

/** Recargos de partida (editables; los del 50 % y 100 % son los habituales, no normativa). */
export const OUT_OF_HOURS_PRESETS = Object.freeze([
  Object.freeze({ premiumPct: 50, label: 'Hora fuera de horario (extra 50\u00a0%)' }),
  Object.freeze({ premiumPct: 100, label: 'Hora fuera de horario (extra 100\u00a0%)' }),
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
 * @returns {{ crewBasePerHour: number, crewNormalPerHour: number, equipmentPerHour: number, people: number, equipmentUnits: number }}
 */
export function outOfHoursBasis(labor = null, equipment = []) {
  const lines = labor && Array.isArray(labor.lines) ? labor.lines : [];
  let crewBasePerHour = 0;
  let crewNormalPerHour = 0;
  let people = 0;
  // Hora al 50 % y al 100 % de la cuadrilla, sumando la de CADA persona (PLAN-2026-026): con un
  // valor propio cargado en el recurso (convenio) no alcanza con base × (1 + recargo).
  let crewPerHour50 = 0;
  let crewPerHour100 = 0;
  let ownRates = false;
  const perRole = [];
  lines.forEach((l) => {
    const positions = nonNegative(l && l.positions);
    if (!(positions > 0) || !l.perPerson) return;
    const base = isFiniteNumber(l.perPerson.overtimeBaseHourly) ? l.perPerson.overtimeBaseHourly : l.perPerson.hourlyBase;
    crewBasePerHour += positions * nonNegative(base) * nonNegative(l.perPerson.loadFactor, 1);
    // Hora normal de la gente: todo su costo del mes ÷ horas normales.
    crewNormalPerHour += positions * nonNegative(l.perPerson.loadedHourlyCost);
    people += positions;
    const lineBase = nonNegative(base) * nonNegative(l.perPerson.loadFactor, 1);
    const c50 = isFiniteNumber(l.perPerson.overtimeHourlyCost50) ? l.perPerson.overtimeHourlyCost50 : lineBase * 1.5;
    const c100 = isFiniteNumber(l.perPerson.overtimeHourlyCost100) ? l.perPerson.overtimeHourlyCost100 : lineBase * 2;
    crewPerHour50 += positions * c50;
    crewPerHour100 += positions * c100;
    if (l.perPerson.overtimeRate50Own || l.perPerson.overtimeRate100Own) ownRates = true;
    perRole.push({ role: l.role || '', people: positions, normalPerHour: nonNegative(l.perPerson.loadedHourlyCost), basePerHour: lineBase, perHour50: c50, perHour100: c100 });
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
  return {
    crewBasePerHour, crewNormalPerHour, equipmentPerHour, people, equipmentUnits,
    // Sólo cuando algún recurso trae su propio valor de hora: si no, el cálculo es el de siempre.
    crewPerHourByPremium: ownRates ? { 50: crewPerHour50, 100: crewPerHour100 } : null,
    // Detalle por rol (para mostrar "cada uno acumulado"): no cambia el cálculo.
    perRole,
  };
}

/** Hora extra de la gente con recargo `premiumPct`: la suma de la de cada persona. */
function crewOvertimePerHour(b, premiumPct) {
  const own = b.crewPerHourByPremium;
  if (own && (premiumPct === 50 || premiumPct === 100) && isFiniteNumber(own[premiumPct])) return nonNegative(own[premiumPct]);
  return nonNegative(b.crewBasePerHour) * (1 + premiumPct / 100);
}

/** Costo de UNA hora fuera de horario con recargo `premiumPct` (horas extra de la gente + uso de equipos). */
export function outOfHoursCostPerHour(basis, premiumPct) {
  const b = basis || {};
  return crewOvertimePerHour(b, nonNegative(premiumPct)) + nonNegative(b.equipmentPerHour);
}

/** Recargo por hora: lo que la hora extra cuesta de más que una hora normal de la misma gente. */
export function outOfHoursSurchargePerHour(basis, premiumPct) {
  const b = basis || {};
  const p = nonNegative(premiumPct);
  if (b.crewPerHourByPremium && (p === 50 || p === 100)) return Math.max(0, crewOvertimePerHour(b, p) - nonNegative(b.crewBasePerHour));
  return nonNegative(b.crewBasePerHour) * (p / 100);
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

/** Costo de UNA hora normal de los recursos (gente con todo su costo del mes + uso de equipos). */
export function resourceNormalHourCost(basis) {
  const b = basis || {};
  return nonNegative(b.crewNormalPerHour) + nonNegative(b.equipmentPerHour);
}

/**
 * Hora normal que paga el cliente, leída de la tarifa principal (cotización
 * calculada SIN tarifas fuera de horario). Sólo tiene sentido cuando se cobra
 * por hora (la tarifa misma), por día (tarifa ÷ horas por día) o por hora-hombre
 * (tarifa × personas de la cuadrilla, V-34). Con abono,
 * precio cerrado o por unidad producida la tarifa incluye otras cosas
 * (materiales, mínimos, guardia): ahí la referencia es la hora normal de los
 * recursos (`resourceNormalHourCost`, con margen).
 * @returns {number|null}
 */
export function normalHourEquivalent({ unitKind, unitId = null, listRate, hoursPerActiveDay, people = 0 } = {}) {
  if (!isFiniteNumber(listRate) || !(listRate > 0)) return null;
  if (unitKind === 'hour') return listRate;
  // Hora-hombre (V-34): una hora de la cuadrilla factura una hora-hombre por persona. Así la
  // misma cuadrilla tiene la misma hora fuera de horario se cobre por hora o por hora-hombre.
  if (unitId === MAN_HOUR_UNIT) {
    const crew = nonNegative(people);
    return crew > 0 ? listRate * crew : null;
  }
  if (unitKind === 'day') {
    const value = safeDivide(listRate, nonNegative(hoursPerActiveDay), null);
    return isFiniteNumber(value) && value > 0 ? value : null;
  }
  return null;
}
