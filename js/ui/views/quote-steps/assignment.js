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
import { h } from '../../dom.js';
import { capacityRows } from '../../../engines/completeness-engine.js';

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
/**
 * Horas del recurso EN LA UNIDAD DE COBRO (0.19.0, pedido del dueño): "horas por válvula" o "horas
 * en el trabajo". El motor las lleva a horas por día con el rendimiento de la cotización.
 * @param {{ path: string, kind: 'labor'|'equipment', basis: 'unit'|'job', unit: object, ready: boolean, where: string }} o
 *   `ready` = ya está cargado el rendimiento (unidades por día / días del trabajo); `where` = dónde se carga.
 */
export function unitHoursField(kit, { path, kind, basis, unit, ready, where, onValue = null }) {
  const one = basis === 'job' ? `cada ${unit.singular || 'trabajo'}` : `cada ${unit.singular || 'unidad'}`;
  const who = kind === 'labor' ? 'Las horas efectivas de trabajo de este puesto' : 'Las horas que el equipo queda asignado';
  const cost = kind === 'labor' ? 'el valor de su hora' : 'su valor hora (amortización, seguro, patente, mantenimiento y combustible)';
  const pending = ready ? '' : ` Falta cargar ${basis === 'job' ? 'los días del trabajo' : `cuántos ${unit.plural || 'unidades'} hacés por día`} en «${where}»: hasta entonces cuenta todo el día.`;
  return kit.num(`${path}.assignedHoursPerUnit`, {
    label: kind === 'labor' ? 'Horas efectivas de trabajo' : 'Horas asignado a esta cotización',
    rule: 'hours',
    unit: `h/${unit.short || unit.singular || 'unidad'}`,
    placeholder: 'Todo el día de trabajo',
    hint: `${who} en ${one}. Su costo = esas horas × ${cost}. Vacío = todo el día de trabajo; más que eso no se cuenta.${pending}`,
    ...(typeof onValue === 'function' ? { onValue } : {}),
  });
}

/** ¿La línea pide sus horas en la unidad de cobro? No, si ya tiene horas por día cargadas antes. */
export function asksUnitHours(basis, line, perDayKey) {
  if (basis !== 'unit' && basis !== 'job') return false;
  const has = (v) => v !== null && v !== undefined && v !== '' && Number(v) > 0;
  // 0.20.0: por unidad sólo se sigue mostrando el dato ya cargado (heredado); lo nuevo va por día.
  if (basis === 'unit') return has(line && line.assignedHoursPerUnit);
  return has(line && line.assignedHoursPerUnit) || !has(line && line[perDayKey]);
}

/**
 * Cobro por mes (0.21.0, auditoría beta W-07): al asignar un recurso propio, sus horas por mes
 * arrancan en las del servicio (días × horas por día del paso 1) si son menos que su mes. Antes
 * quedaban vacías = todo el mes, y un técnico de 4 días × 8 h costaba el mes entero sin avisar.
 * Queda como dato explícito de la línea (horas + % de su mes): el motor no cambia y los fijos
 * siguen fijos si después baja la actividad. Muta la línea nueva antes de sumarla.
 */
export function prefillMonthHours(line, { serviceHours, baseHours }) {
  const service = Number(serviceHours) > 0 ? Number(serviceHours) : 0;
  const base = Number(baseHours) > 0 ? Number(baseHours) : 0;
  if (!line || !(service > 0) || !(base > service)) return line;
  line.assignedHoursPerMonth = roundRate(service);
  line.assignment = 'shared';
  line.fixedCostSharePct = roundRate((service / base) * 100);
  return line;
}

export function monthHoursField(kit, ctx, { path, baseHours, kind, serviceHours = 0, serviceText = '' }) {
  const base = Number(baseHours) > 0 ? Number(baseHours) : 0;
  const service = Number(serviceHours) > 0 ? Number(serviceHours) : 0;
  const baseText = base > 0 ? formatNumber(base, { decimals: 2 }) : '';
  const serviceHoursText = formatNumber(service, { decimals: 2 });
  const apply = (value) => {
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
  };
  const field = kit.num(`${path}.assignedHoursPerMonth`, {
    label: kind === 'labor' ? 'Horas efectivas de trabajo' : 'Horas asignado a esta cotización',
    rule: 'hours',
    unit: 'h/mes',
    placeholder: baseText ? `${baseText} (todo el mes)` : 'Todo el mes',
    hint: `${kind === 'labor' ? 'Las horas efectivas de trabajo de este puesto para esta cotización, por mes' : 'Las horas por mes que el equipo queda asignado a esta cotización, esté andando o quieto'}. Vacío = todo el mes. Con menos horas, el servicio paga esa parte de su costo mensual${baseText ? ` (horas ÷ ${baseText} h del mes)` : ''}.`,
    onValue: apply,
  });
  if (kit.readOnly) return field;
  const current = () => {
    const v = kit.get(`${path}.assignedHoursPerMonth`);
    return filled(v) && Number(v) > 0 ? Number(v) : null;
  };
  const useService = () => kit.action(`Usar ${serviceHoursText} h`, () => {
    ctx.update(`${path}.assignedHoursPerMonth`, roundRate(service));
    apply(service);
    if (typeof ctx.rerender === 'function') ctx.rerender();
  });
  const serviceLabel = serviceText || `${serviceHoursText} h`;
  const notes = [];
  if (service > 0 && base > service) {
    // W-07: vacío con un servicio más corto que el mes → se avisa y se ofrece usar las horas del servicio.
    const blankWarn = h('div', { class: 'qe-note is-warning' },
      h('span', {}, `Vacío cuenta todo su mes (${baseText} h). El servicio son ${serviceLabel} por mes: si no trabaja sólo para este cliente, usá esas horas.`),
      ' ',
      useService());
    kit.toggle(blankWarn, () => current() === null && kit.get(`${path}.assignment`) !== 'shared');
    notes.push(blankWarn);
  }
  if (service > 0) {
    // Revisión 0.21.0: si después cambian los días u horas del servicio, las horas cargadas no se mueven solas.
    const driftWarn = h('div', { class: 'qe-note is-warning' },
      h('span', {}, `El servicio son ${serviceLabel} = ${serviceHoursText} h por mes y acá hay otras horas cargadas.`),
      ' ',
      useService());
    kit.toggle(driftWarn, () => current() !== null && current() < base && Math.abs(current() - service) > 0.01);
    notes.push(driftWarn);
  }
  if (base > 0) {
    // Revisión 0.21.0: con menos horas que su mes, el resto lo pagan otros trabajos (se dice).
    const rest = kit.out(() => {
      const hours = current();
      if (hours === null || !(hours < base)) return '';
      return `El resto de su mes (${formatNumber(base - hours, { decimals: 2 })} h) lo tienen que pagar otros trabajos. Si ${kind === 'labor' ? 'trabaja' : 'queda'} sólo para este cliente, dejá el campo vacío (todo el mes).`;
    }, { tag: 'p', className: 'qe-note', allowEmpty: true });
    notes.push(rest);
  }
  return h('div', { class: 'qe-month-hours' }, field, ...notes);
}

/**
 * "Sólo tiene este trabajo: cobrar su mes completo acá" (0.23.1, CALCULATION_RULES §36.5), en la
 * tarjeta de cada recurso propio de una cotización por tiempo usado. Guarda la DECISIÓN
 * (`fullMonth`), no un número: el motor cobra su mes entero como costo fijo aunque cambien los
 * días. Se deshace destildando. Abajo dice, con las cifras del motor, qué paga hoy la cotización.
 */
export function fullMonthField(kit, { path, kind, list, index, quote }) {
  const hours = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1 });
  const rowOf = (r) => (r && r.model && r.activity ? capacityRows(quote, r.model, r.activity.activeDaysPerMonth).find((x) => x.list === list && x.index === index) : null);
  const field = kit.check(`${path}.fullMonth`, {
    structural: true,
    label: 'Sólo tiene este trabajo: cobrar su mes completo acá',
    hint: kind === 'labor'
      ? 'Sin marcar, esta cotización paga sólo sus horas en el trabajo y el resto de su mes lo pagan tus otros trabajos. Marcado, paga su sueldo del mes entero, haga las horas que haga. Marcalo en una sola cotización por persona.'
      : 'Sin marcar, esta cotización paga tenerlo sólo por las horas del trabajo y el resto del mes lo pagan tus otros trabajos. Marcado, paga tenerlo el mes entero (amortización, seguro, patente), se use lo que se use. Marcalo en una sola cotización por equipo.',
  });
  const note = kit.out((r) => {
    const row = rowOf(r);
    if (!row) return kit.get(`${path}.fullMonth`) === true ? 'Esta cotización cobra su mes completo.' : '';
    if (row.fullMonth) return `Esta cotización cobra su mes completo: ${formatMoney(row.fullAmount)} por mes, aunque trabaje ${hours(row.used)} h. Si tiene otros trabajos, desmarcalo.`;
    return `Hoy esta cotización paga ${hours(row.used)} de sus ${hours(row.month)} h del mes: ${formatMoney(row.paidAmount)} de ${formatMoney(row.fullAmount)}.`;
  }, { tag: 'p', className: 'qe-note qe-full-month-note', allowEmpty: true });
  note.setAttribute('aria-live', 'polite');
  return h('div', { class: 'qe-full-month' }, field, note);
}
