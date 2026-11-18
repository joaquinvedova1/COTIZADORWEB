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
 */

import { isPlainObject } from '../core/object.js';
import { fixedCostShareOf } from './assignment.js';
import { usesTimeBasis } from './cost-basis.js';

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
      const share = external || usesTimeBasis(q) ? null : fixedCostShareOf(line);
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
