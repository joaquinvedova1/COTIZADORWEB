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
import { formatMoney, formatNumber, formatPercent } from '../../../core/format.js';
import { roundRate } from '../../../core/money.js';

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
    // Sin respuesta todavía: lo mismo que dice "Cómo se cobra" ("Todavía no elegiste").
    if (!line.assignment) return 'Sin elegir: por ahora paga el 100 % (se elige en "Cómo se cobra").';
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
            ? 'Sueldo, cargas, seguros, EPP, capacitación y traslado. Lo cargás vos: no se calcula con los días que trabaje. Vacío = 100 %.'
            : 'Amortización, seguro, patente, certificaciones, otros, mantenimiento fijo y costo de capital. Lo cargás vos: no se calcula con los días que trabaje. Vacío = 100 %.',
        })
        : null,
    ),
    kit.out((r) => assignmentRemainderText(at(r), kind), { tag: 'p', className: 'qe-note is-warning', allowEmpty: true }),
  );
}

/** ¿Hay un número cargado (no vacío)? */
const filled = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/**
 * ¿La línea tiene un % de su mes cargado a mano (antes de la 0.18.0), sin horas por mes? Se sigue
 * mostrando y editando como %, con los mismos números.
 */
export function hasManualSharePct(line) {
  return Boolean(line) && line.assignment === 'shared' && !filled(line.assignedHoursPerMonth);
}

/**
 * Horas por mes en este servicio (0.18.0, cotizaciones que se cobran por mes): el recurso se paga
 * por mes y el servicio usa una parte de sus horas. Un solo campo:
 *   vacío (o las horas del mes, o más)  → todo el mes (100 %)
 *   menos horas                         → compartido, % = horas ÷ horas del mes del recurso
 * El % queda guardado como dato explícito de la línea (regla de siempre, AGENTS §5.1): el motor no
 * cambia. `baseHours` = horas del mes del recurso (las que cobra a clientes o las normales).
 */
export function monthHoursField(kit, ctx, { path, baseHours, kind }) {
  const base = Number(baseHours) > 0 ? Number(baseHours) : 0;
  const baseText = base > 0 ? formatNumber(base, { decimals: 2 }) : '';
  return kit.num(`${path}.assignedHoursPerMonth`, {
    label: 'Horas por mes en este servicio',
    rule: 'hours',
    unit: 'h/mes',
    placeholder: baseText ? `${baseText} (todo el mes)` : 'Todo el mes',
    hint: `${kind === 'labor' ? 'Las horas por mes que le dedica a este servicio (si van varias personas, las de cada una)' : 'Las horas por mes que está en este servicio'}. Vacío = todo el mes. Con menos horas, el servicio paga esa parte de su costo mensual${baseText ? ` (horas ÷ ${baseText} h del mes)` : ''}.`,
    onValue: (value) => {
      const hours = filled(value) ? Number(value) : 0;
      if (hours > 0 && base > 0 && hours < base) {
        ctx.update(`${path}.assignment`, 'shared');
        ctx.update(`${path}.fixedCostSharePct`, roundRate((hours / base) * 100));
      } else {
        ctx.update(`${path}.assignment`, kind === 'labor' ? 'dedicated' : 'reserved');
        ctx.update(`${path}.fixedCostSharePct`, null);
        // 0 no es "nada de su mes": es sin dato (todo el mes), como vacío.
        if (!(hours > 0) && filled(value)) ctx.update(`${path}.assignedHoursPerMonth`, null);
      }
    },
  });
}
