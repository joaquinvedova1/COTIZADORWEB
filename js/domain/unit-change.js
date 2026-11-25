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
import { roundRate } from '../core/money.js';
import { serviceMonthHours, monthBaseHoursOf } from './cost-basis.js';
import { activationTerms } from './activation-terms.js';
import { contractOf } from './contract.js';

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
      // Si también se borró la cantidad por día, el aviso la nombra (revisión UX).
      if (keys.includes('unitsPerActiveDay')) {
        notices.push(byQuantity(fromInfo)
          ? `Cargá de nuevo los ${toPlural} por mes y por día: los que había estaban en ${fromPlural}.`
          : `Cargá de nuevo los ${toPlural} por mes y por día.`);
      } else {
        notices.push(byQuantity(fromInfo)
          ? `Cargá de nuevo la cantidad por mes en ${toPlural}: la que había estaba en ${fromPlural}.`
          : `Cargá de nuevo la cantidad por mes en ${toPlural}.`);
      }
    }
  }

  // 1b. Horas de cada recurso cargadas en la unidad anterior ("horas por válvula", 0.19.0): se limpian.
  let clearedHours = 0;
  ['labor', 'equipment'].forEach((key) => {
    (Array.isArray(q[key]) ? q[key] : []).forEach((line) => {
      if (isPlainObject(line) && positive(line.assignedHoursPerUnit)) {
        line.assignedHoursPerUnit = null;
        clearedHours += 1;
      }
    });
  });
  if (clearedHours > 0) notices.push(`Cargá de nuevo las horas de cada recurso en "Los recursos": las que había estaban por ${fromInfo.singular || 'la unidad anterior'}.`);

  // 1c. A "por mes" (0.25.1, auditoría de lanzamiento H-01): un recurso propio sin horas por mes cuenta
  // su mes entero. Viniendo de otra unidad, sus horas arrancan en las del servicio (días × horas),
  // igual que al agregarlo en una cotización por mes (W-07): un técnico de 16 h no pasa a cobrar 160.
  if (toInfo.kind === 'month' && activity) {
    const service = serviceMonthHours(activity);
    let prefilled = 0;
    const blank = (v) => v === null || v === undefined || v === '' || !(Number(v) > 0);
    const prefill = (list, kind) => {
      (Array.isArray(list) ? list : []).forEach((line) => {
        if (!isPlainObject(line) || line.fullMonth || line.assignment === 'shared' || !blank(line.assignedHoursPerMonth)) return;
        if (kind === 'equipment' && (line.acquisition === 'rented' || line.acquisition === 'outsourced')) return;
        const base = monthBaseHoursOf(q, line, kind, activity);
        if (!(service > 0) || !(base > service)) return;
        line.assignedHoursPerMonth = roundRate(service);
        line.assignment = 'shared';
        line.fixedCostSharePct = roundRate((service / base) * 100);
        prefilled += 1;
      });
    };
    prefill(q.labor, 'labor');
    prefill(q.equipment, 'equipment');
    if (prefilled > 0) notices.push(`Cobrando por mes, cada recurso paga sus horas en este servicio: quedaron en ${fmt(service)} h por mes (días × horas del servicio). Si alguno trabaja sólo para este cliente, borrá sus horas en "Los recursos" y cuenta su mes entero.`);
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
  // 0.25.1 (auditoría de lanzamiento, AUD25-03): también entre día y hora. Un insumo cargado "por día"
  // pasaba a valer "por hora" (×8) sin aviso; ahora sigue calculándose por la unidad anterior. De día u
  // hora a una unidad propia (m³, válvula) sigue como siempre: el insumo acompaña a la unidad elegida.
  const hoursPerDay = activity && positive(activity.hoursPerActiveDay) ? Number(activity.hoursPerActiveDay) : null;
  const freezePerDay = fromInfo.kind === 'quantity' ? previousPerDay : fromInfo.kind === 'day' ? 1 : fromInfo.kind === 'hour' ? hoursPerDay : null;
  if (fromInfo.kind === 'quantity' || (isTime(fromInfo) && isTime(toInfo) && freezePerDay !== null)) {
    const previousPerDay = freezePerDay; // eslint-disable-line no-shadow
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
      const perDayUnit = previousPerDay === 1 ? name : fromInfo.plural || name;
      const perDay = previousPerDay !== null && fromInfo.kind !== 'day' ? ` (${fmt(previousPerDay)} ${perDayUnit} por día)` : '';
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

/**
 * Cambio de modalidad (M8, 2026-11-18): las horas de "Sí, algunas horas" de "Horas extra del
 * trabajo" son POR MES en fijo mensual y POR TRABAJO / LLAMADO en las demás. Si cambia esa base,
 * el mismo número no se puede leer en la nueva (4 h por trabajo no son 4 h por mes): se LIMPIAN
 * y se avisa (misma regla que V-03). MUTA `q` y devuelve los avisos.
 *
 * Revisión 0.10.0 (C6): al pasar a un modo que no es "por servicio" (por mes o por trabajo), los
 * cobros aparte de la guardia (fijo por estar de guardia, plus por cada llamado) y el mínimo
 * mensual garantizado en $ ya no se muestran en esas pantallas y seguían pesando en el precio:
 * se LIMPIAN con aviso (misma regla que el mínimo garantizado en unidades de applyUnitChange).
 *
 * @param {object} q          cotización (se muta)
 * @param {string|null} fromMode  modalidad anterior (contractOf(q).mode)
 * @param {string|null} toMode    modalidad nueva
 * @param {object} [fromTerms]    activationTerms de la cotización ANTES del cambio (nombre del plus)
 * @returns {string[]} avisos
 */
export function applyContractModeChange(q, fromMode, toMode, fromTerms = null) {
  const notices = [];
  if (!isPlainObject(q) || fromMode === toMode) return notices;
  if ((fromMode === 'monthly') !== (toMode === 'monthly') && isPlainObject(q.overtimeWork)) {
    const ow = q.overtimeWork;
    if (ow.mode === 'some' && (positive(ow.hours50) || positive(ow.hours100))) {
      const was = fromMode === 'monthly' ? 'por mes' : 'por trabajo';
      ow.hours50 = 0;
      ow.hours100 = 0;
      notices.push(`Se borraron las horas extra del trabajo (estaban ${was}): cargalas de nuevo en "Horas extra del trabajo" (al final de Personal).`);
    }
  }
  const rules = isPlainObject(q.rules) ? q.rules : null;
  if (rules && toMode !== 'on_demand') {
    const T = fromTerms || activationTerms(q);
    const cleared = [];
    if (positive(rules.availabilityFeeMonthly)) {
      rules.availabilityFeeMonthly = 0;
      cleared.push('el fijo por mes por estar de guardia');
    }
    if (positive(rules.calloutFeePerActivation)) {
      rules.calloutFeePerActivation = 0;
      cleared.push(`el plus por cada ${T.one}`);
    }
    if (rules.minimumGuaranteeBasis !== 'units' && positive(rules.minimumMonthlyGuarantee)) {
      rules.minimumMonthlyGuarantee = 0;
      cleared.push('el mínimo mensual garantizado');
    }
    if (cleared.length) {
      const list = cleared.length === 1 ? cleared[0] : `${cleared.slice(0, -1).join(', ')} y ${cleared[cleared.length - 1]}`;
      const how = toMode === 'monthly' ? 'por mes' : 'por trabajo';
      notices.push(`Se ${cleared.length === 1 ? 'borró' : 'borraron'} ${list}: cobrando ${how} no se cobra${cleared.length === 1 ? '' : 'n'} aparte.`);
    }
  }
  return notices;
}

/**
 * Cambio de unidad completo (verificación 2026-11, N2): limpia lo cargado en la
 * unidad anterior (applyUnitChange) y, si con la unidad cambia el modo del
 * contrato (en cotizaciones sin contrato el modo sale de la unidad), también
 * las "algunas horas" extra, que se leen por mes o por trabajo según el modo.
 * Cambia q.unit y devuelve los avisos.
 */
export function applyUnitChangeWithMode(q, nextUnit, fromInfo, toInfo) {
  if (!isPlainObject(q)) return [];
  const fromMode = contractOf(q).mode;
  q.unit = nextUnit;
  const notices = applyUnitChange(q, fromInfo, toInfo);
  return [...notices, ...applyContractModeChange(q, fromMode, contractOf(q).mode)];
}
