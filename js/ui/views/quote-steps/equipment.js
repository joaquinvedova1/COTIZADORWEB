/**
 * Etapa 2 · Los recursos — Equipos.
 * Separa COSTO DE TENERLO / posesión (existe aunque el equipo no trabaje) de
 * COSTO DE USARLO / operación (existe sólo cuando trabaja).
 * Básico: nombre, cantidad, horas por día, valor de reposición, vida útil y
 * consumo. Opciones avanzadas (con resumen visible): residual, seguro,
 * patente, certificaciones, costo de capital, mantenimiento y neumáticos.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, confirmDialog, emptyState, icon } from '../../components.js';
import { equipmentLineFromLibrary } from '../../../domain/quote-factory.js';
import { computeEquipmentUnit } from '../../../engines/equipment-engine.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, moneyText } from './shared.js';

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
        label: 'Agregar desde tus recursos de equipos',
        value: null,
        includeEmpty: true,
        emptyLabel: library.length ? 'Elegí un equipo…' : 'Todavía no cargaste equipos',
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
    kit.out((r) => {
      if (!r.model.fuel.paidByUs) return 'El combustible lo provee el cliente: no se suma al costo de uso (se define en "Viajes").';
      const fuelIllustrative = Boolean(quote.illustrative || (quote.fuel && quote.fuel.illustrative === true));
      return `Combustible: ${formatValue(r.model.fuel.pricePerLiter, 'rate')} por litro (se edita en "Viajes").${fuelIllustrative ? ' Es un valor ILUSTRATIVO: confirmalo con tu precio actual.' : ''}`;
    }, { tag: 'p' }),
  );

  const lineCards = lines.map((line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    // Valores copiados de una plantilla o equipo de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este equipo' });
    const illustrative = ill.marked;
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Equipo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} unidad(es) · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h de uso por día activo` : '';
        }),
        badges: ill.tag ? [ill.tag] : [],
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      ill.control,
      formGrid(
        3,
        kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
        kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
        kit.num(`${p}.hoursPerActiveDay`, {
          label: 'Horas de uso por día activo',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
          hint: 'Vacío = usa las horas por día de la cotización.',
        }),
        kit.num(`${p}.replacementValue`, { label: 'Valor de reposición', rule: 'money', unit: '$', illustrative, hint: 'Lo que costaría comprarlo hoy.' }),
        kit.num(`${p}.usefulLifeYears`, { label: 'Vida útil', rule: 'years', unit: 'años', illustrative }),
        kit.num(`${p}.fuelLitersPerHour`, { label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', illustrative }),
      ),
      kit.keyline({
        label: 'Costo del equipo en el mes',
        value: (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY),
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          return `Tenerlo: ${formatMoney(l.fixedMonthly)} por mes (aunque no trabaje) · usarlo: ${formatMoney(l.variablePerActiveDay)} por día activo · con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`;
        },
        trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
      }),
      kit.advanced(
        {
          key: `equipment:${line.id || i}`,
          summary: () => {
            const e = quote.equipment[i] || {};
            const parts = [
              `residual ${moneyText(e.residualValue) || '$ 0'}`,
              `seguro ${moneyText(e.insuranceAnnual) || '$ 0'}/año`,
              `patente ${moneyText(e.licenseAnnual) || '$ 0'}/año`,
              `certificaciones ${moneyText(e.certificationsAnnual) || '$ 0'}/año`,
              `mantenimiento ${moneyText(e.maintenancePerHour) || '$ 0'}/h`,
              `neumáticos ${moneyText(e.tiresPerHour) || '$ 0'}/h`,
              hasNumber(e.capitalRatePctAnnual) && Number(e.capitalRatePctAnnual) > 0 ? `costo de capital ${formatPercent(Number(e.capitalRatePctAnnual))} anual` : 'sin costo de capital',
            ];
            const text = parts.join(' · ');
            return illustrative ? h('span', {}, `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, illustrativeTag()) : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
          },
        },
        kit.group(
          'Costo de tenerlo (existe aunque no trabaje)',
          formGrid(
            3,
            kit.num(`${p}.residualValue`, { label: 'Valor residual', rule: 'money', unit: '$', illustrative, hint: 'Lo que vale al final de su vida útil.' }),
            kit.num(`${p}.insuranceAnnual`, { label: 'Seguro anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.licenseAnnual`, { label: 'Patente anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.certificationsAnnual`, { label: 'Certificaciones anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.capitalRatePctAnnual`, { label: 'Costo de capital (opcional)', rule: 'percent', unit: '% anual', hint: 'Rendimiento que le pedís a la plata invertida en el equipo.' }),
          ),
        ),
        kit.group(
          'Costo de usarlo (sólo cuando trabaja)',
          formGrid(
            3,
            kit.num(`${p}.maintenancePerHour`, { label: 'Mantenimiento', rule: 'money', unit: '$/h', illustrative }),
            kit.num(`${p}.tiresPerHour`, { label: 'Neumáticos', rule: 'money', unit: '$/h', illustrative }),
          ),
        ),
      ),
      kit.advanced(
        {
          key: `equipment-detail:${line.id || i}`,
          title: 'Ver detalle del costo',
          variant: 'detail',
          summary: (r) => {
            const l = at(r);
            return l ? `Amortización, seguros y capital por mes; mantenimiento, neumáticos y combustible por hora; costo por hora y por día usado.` : '';
          },
        },
        h(
          'div',
          { class: 'qe-split' },
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Tenerlo: por mes (por unidad)'),
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
                { totalLabel: 'Tenerlo por mes', total: formatMoney(o.totalMonthly) },
              );
            }),
          ),
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Usarlo: por hora (por unidad)'),
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
                { totalLabel: 'Usarlo por hora', total: formatMoney(op.totalPerHour) },
              );
            }),
          ),
        ),
        h('h5', { class: 'qe-group-title' }, 'En esta cotización (todas las unidades)'),
        kit.stats(
          kit.stat('Tenerlo por mes (fijo)', (r) => formatMoney(at(r) && at(r).fixedMonthly)),
          kit.stat('Usarlo por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: (r) => (at(r) ? `${formatNumber(at(r).fuelLitersPerActiveDay, { decimals: 1 })} L de combustible por día` : '') }),
          kit.stat('Costo mensual con la actividad estimada', (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY), {
            emphasis: true,
            hint: (r) => `Con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`,
            trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
          }),
        ),
        h('h5', { class: 'qe-group-title' }, 'Ficha con los días de esta cotización (por unidad)'),
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

  const totals = kit.keyline({
    label: 'Equipos en el costo del mes',
    value: (r) => formatMoney(r.model.equipment.reduce((acc, e) => acc + monthlyAtEstimate(r, e), 0)),
    hint: (r) => `Tenerlos: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.fixedMonthly, 0))} por mes · usarlos: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.variablePerActiveDay, 0))} por día activo (incluye combustible). En la estructura de costos, el combustible se informa aparte.`,
    className: 'qe-keyline-total',
  });

  mount(
    container,
    card({ title: 'Equipos propios', subtitle: 'Cargá cada equipo afectado al servicio. Los vehículos que sólo te llevan a la locación se cargan en "Viajes".' }, toolbar, fuelNote),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : emptyState({
        title: 'Todavía no agregaste equipos.',
        text: 'Agregá uno desde tus recursos o en blanco. Si el servicio no usa equipos propios, seguí al próximo paso.',
        icon: 'resources',
      }),
    lineCards.length ? totals : null,
  );
  return { update() {} };
}
