/**
 * Personal agrupado por convenio (RES-02, PLAN-2026-023). Funciones puras: la
 * vista de Recursos sólo dibuja lo que devuelven.
 *
 * - Un grupo por convenio de la empresa, con su nombre.
 * - "Fuera de convenio": los perfiles con un convenio del tipo `fuera_convenio`.
 * - "Sin convenio indicado": sin convenio o con uno que ya no existe.
 *
 * Un perfil no es una persona: `peopleCount` es un dato opcional e informativo
 * (no se copia a las cotizaciones ni entra en la huella). Los montos suman
 * costo por persona × personas sólo de los perfiles con cantidad; si falta en
 * alguno, el monto es un subtotal parcial.
 *
 * El sueldo se carga como bruto y se descompone en los dos campos de siempre
 * (`basicMonthly` + `additionalsMonthly`), así que el motor no cambia y no se
 * puede sumar dos veces.
 */

import { isFiniteNumber, roundMoney, toNumber } from '../core/money.js';
import { isPlainObject } from '../core/object.js';
import { linkedResourceId } from './resource-usage.js';

/** Tipo de convenio que agrupa a los perfiles "Fuera de convenio". */
export const OUTSIDE_AGREEMENT_CODE = 'fuera_convenio';
/** Claves de los grupos especiales (las de los convenios son sus ids). */
export const GROUP_OUTSIDE = 'fuera';
export const GROUP_NONE = 'sin';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Personas informadas de un perfil (entero ≥ 0), o null sin un dato válido. */
export function peopleOf(profile) {
  const v = isPlainObject(profile) ? profile.peopleCount : undefined;
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/** Bruto mensual remunerativo de un perfil: básico + adicionales. */
export function grossOf(profile) {
  if (!isPlainObject(profile)) return 0;
  return roundMoney(toNumber(profile.basicMonthly, 0) + toNumber(profile.additionalsMonthly, 0));
}

/**
 * Descompone el bruto en los dos campos de siempre: `basicMonthly` = básico (o
 * el bruto, si no se carga) y `additionalsMonthly` = bruto − básico. Así,
 * básico + adicionales = bruto siempre.
 * @param {{ gross: number, basic?: number|null }} input
 * @returns {{ ok: true, basicMonthly: number, additionalsMonthly: number, basicGiven: boolean } | { ok: false, field: 'gross'|'basic', error: string }}
 */
export function splitGross({ gross, basic = null } = {}) {
  if (!isFiniteNumber(gross) || gross <= 0) return { ok: false, field: 'gross', error: 'Cargá el bruto mensual (mayor que 0).' };
  if (basic === null || basic === undefined) return { ok: true, basicMonthly: gross, additionalsMonthly: 0, basicGiven: false };
  if (!isFiniteNumber(basic) || basic <= 0) return { ok: false, field: 'basic', error: 'El básico tiene que ser mayor que 0, o dejalo vacío.' };
  if (basic > gross) return { ok: false, field: 'basic', error: 'El básico no puede ser mayor que el bruto.' };
  return { ok: true, basicMonthly: basic, additionalsMonthly: roundMoney(gross - basic), basicGiven: true };
}

/**
 * Horas extra que se valúan con este perfil: las del perfil y las de las
 * cotizaciones guardadas que lo usan (cualquier estado: una puede volver a
 * actualizarse desde el recurso).
 * @returns {{ inProfile: boolean, quotesCount: number, any: boolean }}
 */
export function overtimeUse(profile, quotes = []) {
  const inProfile = isPlainObject(profile) && toNumber(profile.overtimeHoursPerActiveDay, 0) > 0;
  const id = isPlainObject(profile) && typeof profile.id === 'string' ? profile.id : null;
  let quotesCount = 0;
  if (id) {
    (Array.isArray(quotes) ? quotes : []).forEach((q) => {
      if (!isPlainObject(q) || !Array.isArray(q.labor)) return;
      const uses = q.labor.some((line) => isPlainObject(line) && linkedResourceId(line) === id && toNumber(line.overtimeHoursPerActiveDay, 0) > 0);
      if (uses) quotesCount += 1;
    });
  }
  return { inProfile, quotesCount, any: inProfile || quotesCount > 0 };
}

function summarize(group) {
  group.items.sort((a, b) => collator.compare(text(a.profile.role), text(b.profile.role))
    || collator.compare(text(a.profile.category), text(b.profile.category))
    || collator.compare(String(a.profile.id || ''), String(b.profile.id || '')));
  const known = group.items.filter((i) => i.people !== null);
  const counted = known.filter((i) => i.cost !== null);
  group.profilesCount = group.items.length;
  group.peopleKnown = known.length;
  group.people = known.reduce((s, i) => s + i.people, 0);
  group.subtotal = counted.length ? roundMoney(counted.reduce((s, i) => s + i.cost * i.people, 0)) : null;
  // Parcial: algún perfil no dice cuántas personas tiene (o su costo no se puede calcular).
  group.partial = group.subtotal !== null && counted.length < group.items.length;
  return group;
}

/**
 * Agrupa los perfiles por convenio.
 * @param {object[]} profiles    laborProfiles
 * @param {object[]} agreements  agreements
 * @param {{ costOf?: (profile: object) => number }} options  costo empresa por persona y por mes
 * @returns {Array<{ key: string, kind: 'agreement'|'outside'|'none', title: string, agreement: object|null, items: Array<{ profile: object, people: number|null, cost: number|null }>, profilesCount: number, peopleKnown: number, people: number, subtotal: number|null, partial: boolean }>}
 */
export function groupLaborProfiles(profiles = [], agreements = [], { costOf = () => null } = {}) {
  const byId = new Map((Array.isArray(agreements) ? agreements : [])
    .filter((a) => isPlainObject(a) && typeof a.id === 'string' && a.id)
    .map((a) => [a.id, a]));
  const groups = new Map();
  const groupFor = (profile) => {
    const agreement = typeof profile.agreementId === 'string' ? byId.get(profile.agreementId) : undefined;
    if (!agreement) return { key: GROUP_NONE, kind: 'none', title: 'Sin convenio indicado', agreement: null };
    if (agreement.code === OUTSIDE_AGREEMENT_CODE) return { key: GROUP_OUTSIDE, kind: 'outside', title: 'Fuera de convenio', agreement: null };
    return { key: agreement.id, kind: 'agreement', title: text(agreement.name) || 'Convenio sin nombre', agreement };
  };
  (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
    if (!isPlainObject(profile)) return;
    const base = groupFor(profile);
    if (!groups.has(base.key)) groups.set(base.key, { ...base, items: [] });
    const cost = costOf(profile);
    groups.get(base.key).items.push({ profile, people: peopleOf(profile), cost: isFiniteNumber(cost) ? cost : null });
  });
  const list = [...groups.values()].map(summarize);
  const rank = { agreement: 0, outside: 1, none: 2 };
  return list.sort((a, b) => rank[a.kind] - rank[b.kind]
    || b.profilesCount - a.profilesCount
    || collator.compare(a.title, b.title)
    || collator.compare(a.key, b.key));
}

/** Texto de búsqueda sin mayúsculas ni tildes. */
export function searchKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Filtra los grupos: por grupo (`group` = clave) y por texto (puesto,
 * categoría o nombre del convenio). Si el texto coincide con el convenio, se
 * ve el grupo entero. Los grupos que quedan vacíos no se muestran.
 */
export function filterLaborGroups(groups = [], { query = '', group = '' } = {}) {
  const q = searchKey(query);
  return groups
    .filter((g) => !group || g.key === group)
    .map((g) => {
      if (!q || searchKey(g.title).includes(q)) return g;
      const items = g.items.filter((i) => searchKey(i.profile.role).includes(q) || searchKey(i.profile.category).includes(q));
      return items.length === g.items.length ? g : summarize({ ...g, items });
    })
    .filter((g) => g.items.length > 0);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Conteos del encabezado de un grupo. Las personas salen sólo de `peopleCount`:
 * nunca se cuentan "N personas" por tener N perfiles.
 *   "2 perfiles · 5 personas" · "6 personas en 2 de 3 perfiles" · "1 perfil · personas sin cargar"
 */
export function groupCountsText(group) {
  const profiles = plural(group.profilesCount, 'perfil', 'perfiles');
  if (group.peopleKnown === 0) return `${profiles} · personas sin cargar`;
  if (group.peopleKnown < group.profilesCount) return `${plural(group.people, 'persona', 'personas')} en ${group.peopleKnown} de ${profiles}`;
  return `${profiles} · ${plural(group.people, 'persona', 'personas')}`;
}
