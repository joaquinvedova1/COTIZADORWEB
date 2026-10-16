/**
 * Asignación de una persona o de un equipo propio a esta cotización
 * (PLAN-2026-006 §3.1, implementado en PLAN-2026-012).
 *
 * Personal: dedicada (100 %) · compartida (% explícito) · contratada para el
 * servicio (100 %). Equipos propios: reservado (100 %) · compartido (%).
 * Es un dato de la cotización, nunca del recurso maestro. El % mueve sólo los
 * costos FIJOS; el uso real (horas extra, viandas, combustible, mantenimiento
 * por uso, km) sigue igual. Nunca se infiere de los días trabajados.
 */

import { formGrid } from '../../components.js';
import { LABOR_ASSIGNMENTS, EQUIPMENT_ASSIGNMENTS } from '../../../domain/assignment.js';
import { formatMoney, formatPercent } from '../../../core/format.js';

export const ASSIGNMENT_HELP = 'Compartida / compartido: el recurso también trabaja para otros servicios o contratos y esta cotización carga sólo un % de sus costos fijos. Esto no depende de cuántos días trabaje: un equipo on-call puede trabajar 15 días y aun así quedar reservado 100 % para este contrato. El uso real mueve sólo los costos variables.';

/** Costo fijo completo (100 %) y asignado de una línea del modelo. */
function fixedOf(line, kind) {
  if (!line) return { base: 0, assigned: 0, unassigned: 0 };
  if (kind === 'labor') {
    const base = line.perPerson.fixedMonthly * line.headcount;
    return { base, assigned: base - line.unassignedFixedMonthly, unassigned: line.unassignedFixedMonthly };
  }
  return { base: line.fullFixedMonthly, assigned: line.fixedMonthly, unassigned: line.unassignedFixedMonthly };
}

/** "Dedicada a este servicio: 100 % de su costo fijo." / "Compartida: 25 % de su costo fijo ($ 820.009 de $ 3.280.036 por mes)." */
export function assignmentSummary(line, kind) {
  if (!line) return '';
  const fixedWord = kind === 'labor' ? 'su costo fijo' : 'sus costos fijos';
  if (!line.shared) {
    if (line.assignment === 'hired') return `Contratada específicamente para este servicio: 100 % de ${fixedWord}.`;
    return kind === 'labor' ? `Dedicada a este servicio: 100 % de ${fixedWord}.` : `Reservado para este servicio: 100 % de ${fixedWord}.`;
  }
  if (line.shareMissing) return `${kind === 'labor' ? 'Compartida' : 'Compartido'}: falta el % (mientras tanto, 100 % de ${fixedWord}).`;
  const f = fixedOf(line, kind);
  return `${kind === 'labor' ? 'Compartida' : 'Compartido'}: ${formatPercent(line.fixedCostSharePct)} de ${fixedWord} (${formatMoney(f.assigned)} de ${formatMoney(f.base)} por mes).`;
}

/** Aviso del resto no cubierto (o ''). */
export function assignmentRemainderText(line, kind) {
  if (!line || !line.shared || line.shareMissing || line.fixedCostSharePct >= 100) return '';
  const f = fixedOf(line, kind);
  const usage = kind === 'labor' ? 'Las horas extra y las viandas siguen el uso real.' : 'El combustible, el mantenimiento por uso y los neumáticos siguen el uso real.';
  return `El ${formatPercent(100 - line.fixedCostSharePct)} restante (${formatMoney(f.unassigned)} por mes) lo tiene que cubrir otro servicio o contrato: si no se concreta, queda sin cubrir. ${usage}`;
}

/**
 * Bloque "¿Trabaja sólo para este servicio?" / "¿Queda reservado para este servicio?".
 * @param {object} kit
 * @param {{ path: string, line: object, kind: 'labor'|'equipment', at: Function }} options
 */
export function assignmentBlock(kit, { path, line, kind, at }) {
  const options = kind === 'labor' ? LABOR_ASSIGNMENTS : EQUIPMENT_ASSIGNMENTS;
  const shared = Boolean(line) && line.assignment === 'shared';
  return kit.advanced(
    {
      key: `${path}:assignment`,
      title: kind === 'labor' ? '¿Trabaja sólo para este servicio?' : '¿Queda reservado para este servicio?',
      summary: (r) => assignmentSummary(at(r), kind),
      flag: () => {
        const current = kit.get(path) || {};
        const raw = current.fixedCostSharePct;
        return current.assignment === 'shared' && (raw === null || raw === undefined || raw === '') ? { tone: 'red', text: 'Falta el %' } : null;
      },
    },
    formGrid(
      2,
      kit.select(`${path}.assignment`, {
        label: kind === 'labor' ? 'Asignación de esta persona' : 'Asignación del equipo',
        options: options.map((o) => ({ value: o.id, label: o.label })),
        structural: true,
        hint: ASSIGNMENT_HELP,
      }),
      shared
        ? kit.num(`${path}.fixedCostSharePct`, {
          label: kind === 'labor' ? '¿Qué % de su costo fijo asignás a esta cotización?' : '¿Qué % de sus costos fijos asignás a esta cotización?',
          rule: 'sharePct',
          unit: '%',
          requiredMark: true,
          hint: kind === 'labor'
            ? 'Sueldo, cargas, seguros, EPP, capacitación y traslado. Lo cargás vos: no se calcula con los días que trabaje.'
            : 'Amortización, seguro, patente, certificaciones, otros, mantenimiento fijo y costo de capital. Lo cargás vos: no se calcula con los días que trabaje.',
        })
        : null,
    ),
    kit.out((r) => assignmentRemainderText(at(r), kind), { tag: 'p', className: 'qe-note is-warning', allowEmpty: true }),
  );
}
