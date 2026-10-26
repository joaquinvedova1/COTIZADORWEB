/**
 * Cómo se CARGA la actividad en "Cuánto vas a hacer" (UXR) y qué datos del motor se escriben.
 *
 * El motor sigue leyendo los mismos datos (días de trabajo, días por llamado, horas por día, perfil de
 * llamados). Estos campos opcionales guardan sólo la forma en que la persona los cargó, para volver a
 * mostrarlos igual; si alguien cambió los datos del motor por otro camino (otra versión, una importación) y
 * ya no coinciden, se ignoran y se muestran los datos del motor:
 *   activity.hoursInput   = { value }  horas (u horas-hombre) a facturar por mes, con unidad $/hora
 *   activity.callsPerMonth             llamados por mes, cuando se trabaja a demanda
 *   activity.activationProfile         [{ count, units }] llamados de distinta duración (lo lee el motor)
 *   activity.callDurationForm          'distinct' si la persona eligió cargar duraciones distintas (aunque
 *                                      todavía no completó la lista); el motor no lo lee
 *
 * Sin cálculo económico: sólo la aritmética de la forma de carga (horas ÷ horas por día = días).
 */

import { isFiniteNumber } from '../core/money.js';
import { isPlainObject } from '../core/object.js';

const EPS = 1e-6;

function positive(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return isFiniteNumber(n) && n > 0 ? n : null;
}

/** Sin ruido de punto flotante: 12 cifras significativas. */
function clean(x) {
  return isFiniteNumber(x) ? Number(x.toPrecision(12)) : null;
}

function near(a, b) {
  return isFiniteNumber(a) && isFiniteNumber(b) && Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b));
}

/** Personas o equipos facturados en paralelo (1 si no se cargó). */
export function billedCountOf(activity = {}) {
  if (activity.billedResourceKind !== 'person' && activity.billedResourceKind !== 'equipment') return 1;
  return positive(activity.billedResources) || 1;
}

/**
 * Horas a facturar por mes cargadas por la persona, si siguen coincidiendo con los datos del motor
 * (días × horas por día × personas). null si no se cargó así o si ya no coincide.
 */
export function hoursInputOf(activity = {}) {
  const input = isPlainObject(activity.hoursInput) ? positive(activity.hoursInput.value) : null;
  if (input === null) return null;
  const D = positive(activity.activeDaysPerMonth);
  const H = positive(activity.hoursPerActiveDay);
  if (D === null || H === null) return null;
  return near(D * H * billedCountOf(activity), input) ? input : null;
}

/** Días de trabajo para facturar `hours` horas con `hoursPerDay` horas por día y `count` personas o equipos. */
export function daysFromHours(hours, hoursPerDay, count = 1) {
  const h = positive(hours);
  const H = positive(hoursPerDay);
  const n = positive(count) || 1;
  return h !== null && H !== null ? clean(h / (H * n)) : null;
}

/** Perfil de llamados válido: [{ count, units }] con cantidades y duraciones positivas. */
export function cleanProfile(profile) {
  if (!Array.isArray(profile)) return [];
  return profile
    .filter(isPlainObject)
    .map((x) => ({ count: positive(x.count), units: positive(x.units) }))
    .filter((x) => x.count !== null && x.units !== null);
}

/** { calls, mean } de un perfil (llamados y duración promedio). */
export function profileStats(profile) {
  const items = cleanProfile(profile);
  const calls = items.reduce((a, x) => a + x.count, 0);
  if (!(calls > 0)) return { calls: null, mean: null };
  return { calls, mean: clean(items.reduce((a, x) => a + x.count * x.units, 0) / calls) };
}

/**
 * Forma "a demanda" de una cotización, leída de los datos del motor:
 *   calls      llamados por mes (D ÷ días por llamado)
 *   perCall    duración de cada llamado en la unidad de cobro (horas con $/hora; días con $/día o $/mes)
 *   profile    llamados de distinta duración, si coincide con los datos (si no, [])
 *   distinct   true si se cargan duraciones distintas (perfil válido o elegido y todavía sin completar)
 * @param {object} activity
 * @param {'hour'|'day'|'month'|'quantity'|'event'} kind
 */
export function demandFormOf(activity = {}, kind = 'day') {
  const D = positive(activity.activeDaysPerMonth);
  const dpa = positive(activity.daysPerActivation) || 1;
  const H = positive(activity.hoursPerActiveDay);
  const callsFromDays = D !== null ? clean(D / dpa) : null;
  const stored = positive(activity.callsPerMonth);
  const calls = stored !== null && callsFromDays !== null && near(stored, callsFromDays) ? stored : callsFromDays;
  const perCall = kind === 'hour' ? (H !== null ? clean(dpa * H) : null) : clean(dpa);
  const items = cleanProfile(activity.activationProfile);
  const stats = profileStats(items);
  const profile = items.length && perCall !== null && near(stats.mean, perCall) ? items : [];
  return { calls, perCall, profile, distinct: profile.length > 0 || activity.callDurationForm === 'distinct' };
}

/**
 * Datos del motor para trabajar a demanda con $/hora, $/día o $/mes: `calls` llamados por mes de `perCall`
 * (horas o días) en promedio, o con un perfil de duraciones. Con $/hora, cada llamado ocupa perCall ÷ horas
 * por día días de trabajo (2 h con 8 h por día = 0,25 días); así las horas trabajadas del mes son exactas.
 * Devuelve { activeDaysPerMonth, daysPerActivation, activationProfile, callsPerMonth } o null si falta algo.
 */
export function demandActivity({ kind, calls, perCall, profile = null, hoursPerDay = null }) {
  const items = cleanProfile(profile);
  const stats = items.length ? profileStats(items) : { calls: positive(calls), mean: positive(perCall) };
  const n = stats.calls;
  const mean = stats.mean;
  if (n === null || mean === null) return null;
  let dpa;
  if (kind === 'hour') {
    const H = positive(hoursPerDay);
    if (H === null) return null;
    dpa = clean(mean / H);
  } else {
    dpa = mean;
  }
  return {
    activeDaysPerMonth: clean(n * dpa),
    daysPerActivation: dpa,
    activationProfile: items.length ? items : null,
    callsPerMonth: n,
  };
}

/**
 * Días por salida para una actividad por cantidad (m³, viajes…) a demanda: los días de trabajo del mes
 * (cantidad ÷ rendimiento) repartidos en los llamados.
 */
export function daysPerCallForQuantity({ quantity, unitsPerActiveDay, calls }) {
  const Q = positive(quantity);
  const r = positive(unitsPerActiveDay);
  const n = positive(calls);
  return Q !== null && r !== null && n !== null ? clean(Q / r / n) : null;
}
