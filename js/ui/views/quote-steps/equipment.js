/**
 * Paso 4 — Equipos.
 * Separa COSTO DE POSESIÓN (existe aunque el equipo no trabaje) de
 * COSTO DE OPERACIÓN (existe sólo cuando trabaja).
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, confirmDialog, emptyState, icon } from '../../components.js';
import { equipmentLineFromLibrary } from '../../../domain/quote-factory.js';
import { computeEquipmentUnit } from '../../../engines/equipment-engine.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatNumber, formatValue, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';

/** Ficha del equipo a la utilización de la cotización (por unidad). */
export function equipmentCardAtQuote(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const activity = result.activity;
  const hours = line.hoursPerActiveDay;
  return computeEquipmentUnit(
    {
      ...source,
      availableHoursPerMonth: activity.availableDaysPerMonth * hours,
      availableDaysPerMonth: activity.availableDaysPerMonth,
      utilizationPct: activity.utilizationPct,
    },
    { fuelPricePerLiter: result.model.fuel.pricePerLiter, fuelPaidByUs: result.model.fuel.paidByUs },
  );
}

function monthlyAtEstimate(result, line) {
  const D = result.activity.activeDaysPerMonth;
  return line.fixedMonthly * monthsFactor(D, result.activity.availableDaysPerMonth) + line.variablePerActiveDay * D;
}

function equipmentTrace(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const o = line.ownership;
  const op = line.operation;
  return createTrace({
    id: 'equipment_line',
    title: `Equipo — ${line.name || 'Equipo'}`,
    formula: 'Posesión/mes = (reposición − residual) / (vida útil × 12) + (seguro + patente + certificaciones) / 12 + inversión promedio × tasa de capital / 12 · Operación/h = mantenimiento + neumáticos + litros/h × precio combustible · Costo del mes = posesión × cantidad + operación/h × horas por día × días activos × cantidad',
    inputs: [
      { label: 'Valor de reposición', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil (años)', value: o.lifeYears, format: 'number' },
      { label: 'Cantidad', value: line.quantity, format: 'number' },
      { label: 'Horas de uso por día activo', value: line.hoursPerActiveDay, format: 'hours' },
      { label: 'Días activos por mes', value: result.activity.activeDaysPerMonth, format: 'days' },
      { label: 'Precio combustible (si lo pagamos)', value: op.fuelPricePerLiter, format: 'rate' },
      { label: 'Consumo', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
    ],
    steps: [
      { label: 'Amortización mensual (por unidad)', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones (por unidad)', value: o.cashMonthly, format: 'money' },
      { label: 'Costo de capital mensual (por unidad)', value: o.capitalCostMonthly, format: 'money' },
      { label: 'Posesión mensual × cantidad', value: line.fixedMonthly, format: 'money' },
      { label: 'Operación por hora (por unidad)', value: op.totalPerHour, format: 'money' },
      { label: 'Operación por día activo × cantidad', value: line.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Costo del equipo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'La amortización y el costo de capital no son salidas de caja: no se financian en el costo financiero.',
      source && (source.hoursPerActiveDay === null || source.hoursPerActiveDay === undefined || source.hoursPerActiveDay === '')
        ? 'Horas de uso vacías: se usan las horas por día activo de la cotización.'
        : null,
    ],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const library = Array.isArray(resources.equipment) ? resources.equipment : [];
  const lines = quote.equipment;
  const activityHours = quote.activity ? quote.activity.hoursPerActiveDay : null;
  const illustrative = Boolean(quote.illustrative);

  let selectedId = null;
  const addFromLibrary = () => {
    const eq = library.find((e) => e.id === selectedId);
    if (!eq) {
      ctx.toast('Elegí un equipo de la biblioteca para agregarlo.', 'warning');
      return;
    }
    const line = equipmentLineFromLibrary(eq, { hoursPerActiveDay: Number.isFinite(Number(activityHours)) && activityHours !== null ? Number(activityHours) : null });
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.quantity` });
    ctx.toast(`Se agregó "${line.name}" desde la biblioteca.`, 'success');
  };
  const addBlank = () => {
    const line = equipmentLineFromLibrary({}, { hoursPerActiveDay: null });
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.name` });
  };
  const removeLine = async (index) => {
    const line = quote.equipment[index];
    if (!line) return;
    const ok = await confirmDialog({
      title: 'Quitar equipo',
      message: `¿Quitar "${line.name || 'Equipo'}" de esta cotización? Esto no modifica la biblioteca.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (ok) ctx.mutate((q) => q.equipment.splice(index, 1));
  };

  const toolbar = h(
    'div',
    { class: 'qe-toolbar' },
    h(
      'div',
      { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Agregar desde la biblioteca de equipos',
        value: null,
        includeEmpty: true,
        emptyLabel: library.length ? 'Elegí un equipo…' : 'La biblioteca está vacía',
        options: library.map((e) => ({ value: e.id, label: e.name })),
        onChange: (v) => {
          selectedId = v;
        },
      }),
      kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Agregar equipo en blanco', addBlank, { icon: 'plus', size: 'md' }),
  );

  const fuelNote = h(
    'div',
    { class: 'qe-tip' },
    icon('info'),
    kit.out((r) => (r.model.fuel.paidByUs
      ? `Precio de combustible vigente en esta cotización: ${formatValue(r.model.fuel.pricePerLiter, 'rate')} por litro (se edita en Logística).`
      : 'El combustible lo provee el cliente: no se suma al costo de operación (se define en Logística).'), { tag: 'p' }),
  );

  const lineCards = lines.map((line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Equipo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} unidad(es) · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h de uso por día activo` : '';
        }),
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      kit.group(
        'Equipo',
        formGrid(
          3,
          kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
          kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
          kit.num(`${p}.hoursPerActiveDay`, {
            label: 'Horas de uso por día activo',
            rule: 'hoursPerDay',
            unit: 'h/día',
            placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
            hint: 'Vacío = usa las horas por día activo de la cotización.',
          }),
        ),
      ),
      kit.group(
        'Costo de posesión (existe aunque no trabaje)',
        formGrid(
          4,
          kit.num(`${p}.replacementValue`, { label: 'Valor de reposición', rule: 'money', unit: '$', illustrative }),
          kit.num(`${p}.usefulLifeYears`, { label: 'Vida útil', rule: 'years', unit: 'años', illustrative }),
          kit.num(`${p}.residualValue`, { label: 'Valor residual', rule: 'money', unit: '$', illustrative }),
          kit.num(`${p}.capitalRatePctAnnual`, { label: 'Costo de capital (opcional)', rule: 'percent', unit: '% anual', hint: 'Rendimiento que le pedís a la inversión.' }),
          kit.num(`${p}.insuranceAnnual`, { label: 'Seguro anual', rule: 'money', unit: '$/año', illustrative }),
          kit.num(`${p}.licenseAnnual`, { label: 'Patente anual', rule: 'money', unit: '$/año', illustrative }),
          kit.num(`${p}.certificationsAnnual`, { label: 'Certificaciones anual', rule: 'money', unit: '$/año', illustrative }),
        ),
      ),
      kit.group(
        'Costo de operación (sólo cuando trabaja)',
        formGrid(
          3,
          kit.num(`${p}.maintenancePerHour`, { label: 'Mantenimiento', rule: 'money', unit: '$/h', illustrative }),
          kit.num(`${p}.tiresPerHour`, { label: 'Neumáticos', rule: 'money', unit: '$/h', illustrative }),
          kit.num(`${p}.fuelLitersPerHour`, { label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', illustrative }),
        ),
      ),
      h(
        'div',
        { class: 'qe-line-results qe-equipment-results' },
        h(
          'div',
          { class: 'qe-split' },
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Posesión mensual (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const o = l.ownership;
              return kit.breakdown(
                [
                  ['Amortización', formatMoney(o.depreciationMonthly)],
                  ['Seguro', formatMoney(o.insuranceMonthly)],
                  ['Patente', formatMoney(o.licenseMonthly)],
                  ['Certificaciones', formatMoney(o.certificationsMonthly)],
                  ['Costo de capital', formatMoney(o.capitalCostMonthly)],
                ],
                { totalLabel: 'Posesión por mes', total: formatMoney(o.totalMonthly) },
              );
            }),
          ),
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Operación por hora (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const op = l.operation;
              return kit.breakdown(
                [
                  ['Mantenimiento', formatMoney(op.maintenancePerHour)],
                  ['Neumáticos', formatMoney(op.tiresPerHour)],
                  [`Combustible (${formatNumber(op.fuelLitersPerHour, { decimals: 2 })} L/h)`, formatMoney(op.fuelPerHour)],
                ],
                { totalLabel: 'Operación por hora', total: formatMoney(op.totalPerHour) },
              );
            }),
          ),
        ),
        h('h5', { class: 'qe-group-title' }, 'En esta cotización (todas las unidades)'),
        kit.stats(
          kit.stat('Posesión mensual (fijo)', (r) => formatMoney(at(r) && at(r).fixedMonthly)),
          kit.stat('Operación por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: (r) => (at(r) ? `${formatNumber(at(r).fuelLitersPerActiveDay, { decimals: 1 })} L de combustible por día` : '') }),
          kit.stat('Costo mensual con la actividad estimada', (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY), {
            emphasis: true,
            hint: (r) => `Con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`,
            trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
          }),
        ),
        h('h5', { class: 'qe-group-title' }, 'Ficha a la utilización de esta cotización (por unidad)'),
        kit.stats(
          kit.stat('$ por hora usada', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedHour) : EMPTY;
          }),
          kit.stat('$ por día usado', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedDay) : EMPTY;
          }),
          kit.stat('$ por mes', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerMonth) : EMPTY;
          }, {
            hint: (r) => {
              const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
              return c ? `Utilización ${formatNumber(c.capacity.utilizationPct, { decimals: 2 })} % · ${formatNumber(c.capacity.usedHoursPerMonth, { decimals: 1 })} h usadas de ${formatNumber(c.capacity.availableHoursPerMonth, { decimals: 1 })} disponibles` : '';
            },
          }),
        ),
      ),
    );
  });

  const totals = card(
    { title: 'Totales de equipos', subtitle: 'Con la actividad estimada de la cotización.' },
    kit.stats(
      kit.stat('Posesión mensual (fijo)', (r) => formatMoney(r.model.equipment.reduce((s, e) => s + e.fixedMonthly, 0))),
      kit.stat('Operación por día activo', (r) => formatMoney(r.model.equipment.reduce((s, e) => s + e.variablePerActiveDay, 0)), { hint: 'Incluye combustible operativo.' }),
      kit.stat('Costo mensual de equipos', (r) => formatMoney(r.model.equipment.reduce((s, e) => s + monthlyAtEstimate(r, e), 0)), {
        emphasis: true,
        hint: 'En la estructura de costos, el combustible operativo se informa en "Combustible".',
      }),
    ),
  );

  mount(
    container,
    card({ title: 'Equipos', subtitle: 'Cargá cada equipo propio afectado al servicio. Los vehículos de traslado por km se cargan en Logística.' }, toolbar, fuelNote),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : card({}, emptyState('No hay equipos cargados. Agregá uno desde la biblioteca o en blanco. Si el servicio no usa equipos propios, seguí al próximo paso.')),
    lineCards.length ? totals : null,
  );
  return { update() {} };
}
