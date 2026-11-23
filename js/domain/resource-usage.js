/**
 * "Usado en" (PLAN-2026-006 §3.2, implementado en PLAN-2026-012): en qué
 * cotizaciones se usa un recurso de Recursos y qué parte de sus costos fijos
 * tiene asignada en cada una. Función pura: sin storage ni fecha actual.
 *
 * Sin módulo de contratos: usa las cotizaciones y sus estados de siempre.
 *   borrador / enviada  → uso POTENCIAL (todavía no comprometido)
 *   ganada (adjudicada) → COMPROMISO real
 *   perdida / archivada → no cuenta
 *
 * % asignado de una línea = % de su costo fijo (100 si está dedicada,
 * reservada o contratada para el servicio) × personas (personal) o unidades
 * (equipos). Un externo (alquilado / tercerizado) se paga por uso: se lista
 * sin %. Si lo comprometido supera el 100 % se avisa; nunca se bloquea.
 *
 * Por tiempo usado (0.22.0): la cotización paga horas, no un %. Su parte del mes del recurso
 * son las horas que le ocupa con la actividad estimada ÷ las horas del mes del recurso
 * (`timeShareOf`). Sin actividad estimada no se puede saber: queda sin %.
 */

import { isPlainObject } from '../core/object.js';
import { fixedCostShareOf } from './assignment.js';
import { usesTimeBasis, monthBaseHoursOf } from './cost-basis.js';
import { billingUnitOf } from './billing-units.js';

const POTENTIAL_STATUSES = Object.freeze(['draft', 'sent']);
const COMMITTED_STATUSES = Object.freeze(['won']);

/** Lista de la cotización donde vive cada tipo de recurso. */
const LIST_OF_TYPE = Object.freeze({ laborProfiles: 'labor', equipment: 'equipment', externalServices: 'equipment' });

/** Recurso maestro de una línea (snapshot o el vínculo anterior `sourceId`). */
function linkedResourceId(line) {
  if (isPlainObject(line.snapshot) && typeof line.snapshot.resourceId === 'string' && line.snapshot.resourceId) return line.snapshot.resourceId;
  return typeof line.sourceId === 'string' && line.sourceId ? line.sourceId : null;
}

function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Días de trabajo por mes que estima la cotización (dato crudo, sin motor). 0 = sin estimar. */
function estimatedDaysOf(quote) {
  const a = isPlainObject(quote.activity) ? quote.activity : {};
  const unit = billingUnitOf(quote);
  if (unit.kind === 'quantity') return num(a.unitsPerActiveDay) > 0 ? num(a.billableQuantityPerMonth) / num(a.unitsPerActiveDay) : 0;
  if (unit.kind === 'event') return num(a.billableQuantityPerMonth) * (num(a.daysPerActivation) > 0 ? num(a.daysPerActivation) : 1);
  return num(a.activeDaysPerMonth);
}

/**
 * Parte del mes de un recurso propio que ocupa una cotización por tiempo usado (0.22.0).
 * @returns {{ hoursPerMonth: number, monthHours: number, sharePct: number }|null} null = sin actividad estimada
 */
export function timeShareOf(quote, line, kind) {
  if (!isPlainObject(quote) || !isPlainObject(line)) return null;
  const a = isPlainObject(quote.activity) ? quote.activity : {};
  const dayHours = Math.min(num(a.hoursPerActiveDay), 24);
  const days = estimatedDaysOf(quote);
  if (!(dayHours > 0) || !(days > 0)) return null;
  const own = kind === 'labor' ? num(line.coverageHoursPerDay) : Math.max(num(line.assignedHoursPerDay), Math.min(num(line.hoursPerActiveDay), dayHours));
  const hoursPerDay = own > 0 ? Math.min(own, dayHours) : dayHours;
  const monthHours = monthBaseHoursOf(quote, line, kind, a);
  if (!(monthHours > 0)) return null;
  const hoursPerMonth = hoursPerDay * days;
  return { hoursPerMonth, monthHours, sharePct: (hoursPerMonth / monthHours) * 100 };
}

/**
 * @param {'laborProfiles'|'equipment'|'externalServices'} type
 * @param {string} resourceId
 * @param {object[]} quotes  cotizaciones (sin calcular)
 * @returns {{ rows: object[], quotesCount: number, committedPct: number, potentialPct: number, overCommitted: boolean, overWithPotential: boolean }}
 */
export function resourceUsage(type, resourceId, quotes = []) {
  const listKey = LIST_OF_TYPE[type];
  const rows = [];
  if (!listKey || typeof resourceId !== 'string' || !resourceId) {
    return { rows, quotesCount: 0, committedPct: 0, potentialPct: 0, overCommitted: false, overWithPotential: false };
  }
  (Array.isArray(quotes) ? quotes : []).forEach((q) => {
    if (!isPlainObject(q)) return;
    const status = typeof q.status === 'string' ? q.status : 'draft';
    const group = COMMITTED_STATUSES.includes(status) ? 'committed' : POTENTIAL_STATUSES.includes(status) ? 'potential' : null;
    if (!group) return;
    (Array.isArray(q[listKey]) ? q[listKey] : []).forEach((line, index) => {
      if (!isPlainObject(line) || linkedResourceId(line) !== resourceId) return;
      const external = line.acquisition === 'rented' || line.acquisition === 'outsourced';
      // Personal: nómina cargada (B-1) o posiciones × personas por posición.
      const units = listKey === 'labor'
        ? (num(line.payrollHeadcount) > 0 && num(line.positions) > 0 ? num(line.payrollHeadcount) : num(line.positions) * num(line.peoplePerPosition, 1))
        : num(line.quantity);
      // Por tiempo usado (2026-11-18): la cotización paga las horas del trabajo, sin % de costos fijos.
      const byTime = !external && usesTimeBasis(q);
      const time = byTime ? timeShareOf(q, line, listKey) : null;
      const share = external || byTime ? (time ? { assignment: null, sharePct: time.sharePct, shared: false } : null) : fixedCostShareOf(line);
      rows.push({
        quoteId: typeof q.id === 'string' ? q.id : null,
        code: typeof q.code === 'string' ? q.code : '',
        name: typeof q.name === 'string' ? q.name : '',
        client: typeof q.client === 'string' ? q.client : '',
        status,
        group,
        index,
        external,
        units,
        assignment: share ? share.assignment : null,
        sharePct: share ? share.sharePct : null,
        shared: share ? share.shared : false,
        // Personas o unidades × % de su costo fijo (en puntos: 100 = uno entero).
        assignedPct: share ? share.sharePct * units : null,
        // Por tiempo usado: horas por mes que ocupa de las del mes del recurso (por persona o unidad).
        byHours: !!time,
        hoursPerMonth: time ? time.hoursPerMonth : null,
        monthHours: time ? time.monthHours : null,
      });
    });
  });
  const total = (group) => rows.filter((r) => r.group === group && r.assignedPct !== null).reduce((acc, r) => acc + r.assignedPct, 0);
  const committedPct = total('committed');
  const potentialPct = total('potential');
  return {
    rows,
    quotesCount: new Set(rows.map((r) => r.quoteId)).size,
    committedPct,
    potentialPct,
    overCommitted: committedPct > 100 + 1e-9,
    overWithPotential: committedPct + potentialPct > 100 + 1e-9,
  };
}

/** Clave de un gasto fijo de producto: el nombre sin mayúsculas, espacios repetidos ni "(ejemplo)". */
function fixedCostKey(description) {
  return String(description ?? '').toLowerCase().replace(/\(ejemplo\)/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Costos fijos asignados DE MÁS entre productos (auditoría externa A-03): por máquina
 * (vínculo con Recursos) y por gasto fijo (mismo nombre), la suma de los % que cada
 * producto se asigna. Más de 100 % = ese costo se cobra más de una vez. Sólo avisa:
 * no cambia ningún cálculo.
 * @param {object[]} products
 * @returns {{ key: string, kind: 'equipment'|'fixed', label: string, totalPct: number, products: { productId: string|null, name: string, sharePct: number }[], inconsistentAmount: boolean }[]}
 */
export function productFixedCostOverAssignment(products = []) {
  const groups = new Map();
  const add = (key, kind, label, product, sharePct, monthlyAmount) => {
    const g = groups.get(key) || { key, kind, label, totalPct: 0, products: [], amounts: new Set() };
    g.totalPct += sharePct;
    g.products.push({ productId: typeof product.id === 'string' ? product.id : null, name: typeof product.name === 'string' ? product.name : '', sharePct });
    if (monthlyAmount !== null) g.amounts.add(monthlyAmount);
    groups.set(key, g);
  };
  (Array.isArray(products) ? products : []).filter(isPlainObject).forEach((p) => {
    (Array.isArray(p.equipment) ? p.equipment : []).filter(isPlainObject).forEach((line) => {
      const id = linkedResourceId(line);
      if (id && Number.isFinite(line.fixedSharePct)) add(`equipment:${id}`, 'equipment', line.name || 'Máquina', p, num(line.fixedSharePct), null);
    });
    (Array.isArray(p.fixedCosts) ? p.fixedCosts : []).filter(isPlainObject).forEach((line) => {
      const key = fixedCostKey(line.description);
      if (key && Number.isFinite(line.sharePct)) add(`fixed:${key}`, 'fixed', line.description, p, num(line.sharePct), num(line.monthlyAmount));
    });
  });
  return [...groups.values()]
    .filter((g) => g.products.length > 1 && g.totalPct > 100 + 1e-9)
    .map(({ amounts, ...g }) => ({ ...g, inconsistentAmount: amounts.size > 1 }));
}
