/**
 * Cambio de la unidad de cobro de una cotización (veredicto 2026-11, V-03).
 *
 * Al cambiar la unidad, los números cargados EN la unidad anterior (cantidad
 * por mes, cantidad por día, capacidad por viaje, mínimos) no se pueden leer
 * en la nueva: 4.000 km no son 4.000 viajes. Regla única: se LIMPIAN y se
 * avisa, nunca se reinterpretan ni se convierten (salvo el mínimo por llamado
 * entre día y hora, que tiene una cuenta segura con las horas por día).
 *
 * Los insumos "por unidad producida" que seguían a la unidad anterior quedan
 * atados a ella (unidad y rendimiento propios), para que su costo no cambie.
 *
 * También: horas de trabajo por día que se deducen de las horas-hombre por
 * día (V-04). Sólo reglas de dominio: nada de cálculo económico.
 */

import { isPlainObject } from '../core/object.js';
import { activationTerms } from './activation-terms.js';

const positive = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
const loaded = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const byQuantity = (info) => info.kind === 'quantity' || info.kind === 'event';
const isTime = (info) => info.kind === 'day' || info.kind === 'hour';
const fmt = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
const isPerOutput = (v) => v === 'per_output' || v === 'per_billable_unit';

/**
 * Aplica a la cotización las consecuencias de cambiar la unidad de cobro.
 * MUTA `q` (no cambia `q.unit`: eso lo hace quien llama) y devuelve los avisos
 * para mostrar, en orden. Sin cambio de unidad no hace nada.
 *
 * @param {object} q         cotización (se muta)
 * @param {object} fromInfo  billingUnitOf(...) de la unidad anterior
 * @param {object} toInfo    billingUnitOf(...) de la unidad nueva
 * @returns {string[]} avisos
 */
export function applyUnitChange(q, fromInfo, toInfo) {
  const notices = [];
  if (!isPlainObject(q) || !fromInfo || !toInfo || fromInfo.id === toInfo.id) return notices;
  const activity = isPlainObject(q.activity) ? q.activity : null;
  const rules = isPlainObject(q.rules) ? q.rules : null;
  const fromPlural = fromInfo.plural || 'la unidad anterior';
  const toPlural = toInfo.plural || 'la unidad nueva';
  // Se lee antes de limpiar: lo usan los insumos por unidad producida (punto 4).
  const previousPerDay = activity && positive(activity.unitsPerActiveDay) ? Number(activity.unitsPerActiveDay) : null;

  // 1. Cantidades en la unidad comercial.
  if (activity && byQuantity(toInfo)) {
    const keys = ['billableQuantityPerMonth', 'unitsPerActiveDay', 'unitsPerTrip'].filter((k) => loaded(activity[k]));
    if (keys.length) {
      keys.forEach((k) => {
        activity[k] = null;
      });
      notices.push(byQuantity(fromInfo)
        ? `Cargá de nuevo la cantidad por mes en ${toPlural}: la que había estaba en ${fromPlural}.`
        : `Cargá de nuevo la cantidad por mes en ${toPlural}.`);
    }
  }

  // 2. Mínimo por llamado: sólo se convierte entre día y hora, con las horas por día.
  if (rules && positive(rules.minimumCallUnits)) {
    const minimum = Number(rules.minimumCallUnits);
    const hours = activity ? Number(activity.hoursPerActiveDay) : NaN;
    if (isTime(fromInfo) && isTime(toInfo) && Number.isFinite(hours) && hours > 0) {
      rules.minimumCallUnits = fromInfo.kind === 'day' ? minimum * hours : minimum / hours;
    } else {
      rules.minimumCallUnits = 0;
      // Una magnitud, un nombre por cotización: llamado / salida / intervención (activationTerms).
      notices.push(`Se borró el mínimo ${activationTerms(q).per} (estaba en ${fromPlural}): cargalo de nuevo en "El precio".`);
    }
  }

  // 3. Mínimo garantizado en unidades.
  if (rules && rules.minimumGuaranteeBasis === 'units' && positive(rules.minimumGuaranteeUnits)) {
    rules.minimumGuaranteeUnits = 0;
    notices.push(`Se borró el mínimo garantizado (estaba en ${fromPlural}): cargalo de nuevo en "El precio".`);
  }

  // 4. Insumos "por unidad producida" que seguían a la unidad anterior.
  if (fromInfo.kind === 'quantity') {
    const name = fromInfo.singular || 'unidad';
    let frozen = 0;
    const freeze = (list, key) => {
      (Array.isArray(list) ? list : []).forEach((line) => {
        if (!isPlainObject(line) || !isPerOutput(line[key])) return;
        const ownUnit = typeof line.outputUnit === 'string' && line.outputUnit.trim() !== '';
        if (ownUnit || positive(line.outputPerActiveDay)) return;
        line.outputUnit = name;
        if (previousPerDay !== null) line.outputPerActiveDay = previousPerDay;
        frozen += 1;
      });
    };
    freeze(q.materials, 'basis');
    freeze(q.otherCosts, 'behavior');
    if (frozen > 0) {
      const perDay = previousPerDay !== null ? ` (${fmt(previousPerDay)} por día)` : '';
      notices.push(frozen === 1
        ? `1 insumo sigue calculándose por ${name}${perDay}.`
        : `${frozen} insumos siguen calculándose por ${name}${perDay}.`);
    }
  }
  return notices;
}

/**
 * Horas de trabajo por día que se deducen al cobrar por hora-hombre (V-04):
 * horas-hombre por día ÷ personas. Sólo si da entre 1 y 24; si no, null
 * (no se toca el dato cargado).
 *
 * @param {number} manHoursPerDay  horas-hombre por día de trabajo
 * @param {Array<{positions?: number}>} labor  puestos de la cotización
 * @returns {number|null}
 */
export function hoursPerDayFromManHours(manHoursPerDay, labor) {
  const hh = Number(manHoursPerDay);
  const people = (Array.isArray(labor) ? labor : []).reduce((acc, l) => {
    const n = isPlainObject(l) ? Number(l.positions) : NaN;
    return acc + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  if (!(Number.isFinite(hh) && hh > 0) || !(people > 0)) return null;
  const hours = hh / people;
  return hours >= 1 && hours <= 24 ? hours : null;
}
