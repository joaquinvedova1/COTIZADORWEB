/**
 * Etapa 2 · Los recursos — Movilización y viajes (logística).
 *
 * Separa (PLAN-2026-005):
 *   MOVILIZACIÓN DEL RECURSO PRINCIPAL: ¿cómo llega cada equipo al lugar del
 *     servicio? Por sus propios medios (km, combustible en ruta y desgaste por
 *     km, sin amortización ni otra persona si maneja su operador), lo
 *     transporta otro equipo (el costo está en ese equipo), va con un vehículo
 *     de apoyo (el costo está en ese vehículo) o no requiere.
 *   LOGÍSTICA AUXILIAR: vehículos de apoyo y de personal (por km recorrido),
 *     peajes y viáticos.
 * Un mismo vehículo nunca se carga en los dos lados.
 *
 * Básico: base, destino, distancia, movilización de cada equipo, vehículos
 * de apoyo, precio del combustible (con su fecha base) y quién lo paga.
 * Opciones avanzadas: ida y vuelta, viajes por llamado, desgaste por
 * vehículo, peajes y viáticos.
 */

import { h, mount } from '../../dom.js';
import { badge, card, formGrid, selectField, emptyState, table, icon, checkboxField } from '../../components.js';
import { ACQUISITION_MODES, DRIVER_OPTIONS, FUEL_PROVIDERS, MOBILIZATION_MODES, labelOf } from '../../../domain/catalogs.js';
import { createVehicle, acquisitionOf } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { nonNegative, isFiniteNumber } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, moneyText, numberText, stepName } from './shared.js';
import { baseFields } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';

const WARNING_TEXT = Object.freeze({
  travel_consumption: 'Falta el consumo en ruta (L/100 km): el combustible del traslado queda en 0.',
  driver: 'Falta definir quién maneja en el traslado.',
  carrier_missing: 'Elegí qué equipo lo transporta (de los cargados en Equipos).',
  carrier_cycle: 'Dos equipos se transportan entre sí: revisá cuál lleva a cuál.',
  support_missing: 'Elegí el vehículo de apoyo que lo lleva (de la logística auxiliar).',
});

/** "Ver cálculo" de la movilización de un equipo que va por sus propios medios. */
function mobilizationTrace(result, index) {
  const m = result && result.model.mobilization && result.model.mobilization.lines[index];
  if (!m) return null;
  return createTrace({
    id: 'mobilization_line',
    title: `Movilización — ${m.name || 'Equipo'}`,
    formula: 'km por llamado = km de ruta por llamado × cantidad · litros = km × consumo en ruta / 100 · combustible = litros × precio · desgaste = km × $/km (sin combustible ni amortización) · por día activo = por llamado / días por llamado',
    inputs: [
      { label: 'Km de ruta por llamado', value: result.model.mobilization.routeKmPerActivation, format: 'km' },
      { label: 'Cantidad', value: m.quantity, format: 'number' },
      { label: 'Consumo en ruta', value: m.travelLitersPer100Km, format: 'number', unit: 'L/100 km' },
      { label: 'Precio del combustible (si lo pagás)', value: result.model.fuel.paidByUs ? result.model.fuel.pricePerLiter : 0, format: 'rate' },
      { label: 'Desgaste por km', value: m.travelCostPerKm, format: 'rate' },
      { label: 'Días por llamado', value: result.activity.daysPerActivation, format: 'days' },
    ],
    steps: [
      { label: 'Km por llamado', value: m.km, format: 'km' },
      { label: 'Litros por llamado', value: m.liters, format: 'liters' },
      { label: 'Combustible en ruta por llamado', value: m.fuelPerActivation, format: 'money' },
      { label: 'Desgaste por llamado', value: m.wearPerActivation, format: 'money' },
      { label: 'Por día activo', value: m.perActiveDay, format: 'money' },
    ],
    result: { label: 'Movilización por llamado', value: m.perActivation, format: 'money' },
    notes: [
      m.driver === 'operator' ? `Maneja su operador${m.operatorName ? ` (${m.operatorName})` : ''}: no se suma mano de obra (ya está en Personal).` : null,
      m.driver === 'other' ? 'Maneja otra persona: tiene que estar cargada en Personal (RATEOS no la agrega sola).' : null,
      'La amortización del equipo ya está en su costo de tenerlo: no se vuelve a sumar por km.',
    ],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const lg = quote.logistics;
  const notApplicable = Boolean(lg.notApplicable);
  const illustrative = Boolean(quote.illustrative);
  // Marca ILUSTRATIVO por vehículo (copiados de una plantilla de demostración).
  const vehicleIll = lg.vehicles.map((v, i) => kit.lineIllustrative(`logistics.vehicles.${i}`, { what: 'este vehículo' }));
  const cellTag = (marked) => (marked ? h('span', { class: 'qe-cell-tag' }, illustrativeTag()) : null);
  const locations = Array.isArray(resources.locations) ? resources.locations : [];
  const bases = locations.filter((l) => l.type === 'base');
  const destinations = locations.filter((l) => l.type !== 'base');

  const pickBase = (id) => {
    const loc = bases.find((l) => l.id === id);
    if (!loc) return;
    ctx.mutate((q) => {
      q.logistics.baseName = String(loc.name || '');
    });
  };
  const pickDestination = (id) => {
    const loc = destinations.find((l) => l.id === id);
    if (!loc) return;
    ctx.mutate((q) => {
      q.logistics.destinationName = String(loc.name || '');
      q.logistics.distanceKm = nonNegative(loc.distanceFromBaseKm);
    });
    ctx.toast(`Destino "${loc.name}" a ${formatNumber(nonNegative(loc.distanceFromBaseKm), { decimals: 1 })} km de la base.`, 'success');
  };

  const addVehicle = () => {
    const index = lg.vehicles.length;
    ctx.mutate((q) => q.logistics.vehicles.push(createVehicle()), { focus: `logistics.vehicles.${index}.name` });
  };
  const removeVehicle = async (index) => {
    const vehicle = lg.vehicles[index];
    if (!vehicle) return;
    const ok = await confirmRemove({ title: 'Quitar vehículo', name: vehicle.name || 'Vehículo', extra: '' });
    if (ok) ctx.mutate((q) => q.logistics.vehicles.splice(index, 1));
  };

  const toggleCard = card(
    {},
    kit.check('logistics.notApplicable', { label: 'Sin traslados', structural: true, hint: 'Marcalo si el servicio se presta en tu base o el cliente traslada todo.' }),
  );

  const routeCard = notApplicable
    ? null
    : card(
      { title: '¿Adónde vas?', subtitle: 'Distancia de UNA vía entre tu base y la locación del cliente.' },
      locations.length
        ? formGrid(
          2,
          bases.length
            ? selectField({ label: 'Completar la base desde tus ubicaciones', value: null, includeEmpty: true, emptyLabel: 'Elegí una base…', options: bases.map((l) => ({ value: l.id, label: l.name })), onChange: pickBase })
            : null,
          destinations.length
            ? selectField({
              label: 'Completar destino y distancia desde tus ubicaciones',
              value: null,
              includeEmpty: true,
              emptyLabel: 'Elegí un destino…',
              options: destinations.map((l) => ({ value: l.id, label: `${l.name} (${formatNumber(nonNegative(l.distanceFromBaseKm), { decimals: 1 })} km)` })),
              onChange: pickDestination,
            })
            : null,
        )
        : null,
      formGrid(
        3,
        kit.text('logistics.baseName', { label: 'Base', maxLength: 120, placeholder: 'Ej.: Neuquén Capital' }),
        kit.text('logistics.destinationName', { label: 'Destino / locación', maxLength: 120, placeholder: 'Ej.: Añelo' }),
        kit.num('logistics.distanceKm', { label: 'Distancia (una vía)', rule: 'distance', unit: 'km' }),
      ),
    );

  // ---- Movilización del recurso principal: ¿cómo llega cada equipo?
  const equipmentLines = Array.isArray(quote.equipment) ? quote.equipment : [];
  const laborById = new Map((Array.isArray(quote.labor) ? quote.labor : []).filter((l) => l && l.id).map((l) => [l.id, l]));
  const mobilizationRow = (line, i) => {
    const p = `equipment.${i}.mobilization`;
    const m = line.mobilization || {};
    const acq = acquisitionOf(line);
    const external = acq !== 'owned';
    const included = external && line.external && line.external.mobilizationIncluded === true;
    const head = h(
      'div',
      { class: 'mob-head' },
      h('strong', {}, line.name || 'Equipo'),
      badge(labelOf(ACQUISITION_MODES, acq, 'Propio'), external ? 'blue' : 'gray'),
      line.quantity !== undefined && Number(line.quantity) !== 1 ? h('span', { class: 'small' }, `${formatNumber(nonNegative(line.quantity), { decimals: 2 })} unidades`) : null,
    );
    if (included) {
      return h('div', { class: 'mob-row' }, head, h('p', { class: 'small' }, 'La movilización está incluida en la tarifa del proveedor: no se suma nada acá (se cambia en Equipos).'));
    }
    const providerFee = external && line.external && line.external.mobilizationIncluded === false && Number(line.external.mobilizationAmount) > 0;
    const modeField = kit.select(`${p}.mode`, {
      label: '¿Cómo llega al lugar del servicio?',
      options: MOBILIZATION_MODES.map((o) => ({ value: o.id, label: o.label })),
      includeEmpty: true,
      emptyLabel: 'Sin definir',
      structural: true,
      hint: m.mode ? (MOBILIZATION_MODES.find((o) => o.id === m.mode) || {}).hint : 'Definilo para que la movilización no quede afuera ni se cuente dos veces.',
    });
    let detail = null;
    if (m.mode === 'self') {
      const operator = typeof line.operatorLaborId === 'string' ? laborById.get(line.operatorLaborId) : null;
      const driverHint = m.driver === 'operator'
        ? operator
          ? `Maneja ${operator.role || 'su operador'} (ya está en Personal): no se suma otra persona.`
          : 'Asignale el operador en Equipos (de los puestos de Personal). No se suma otra persona.'
        : m.driver === 'other'
          ? `Cargá al chofer en "${stepName('labor')}": RATEOS no lo agrega solo.`
          : null;
      detail = h(
        'div',
        { class: 'stack' },
        formGrid(
          3,
          kit.num(`${p}.travelLitersPer100Km`, { label: 'Consumo en ruta', rule: 'quantity', unit: 'L/100 km', hint: 'En ruta, no el consumo trabajando (L/h).' }),
          kit.num(`${p}.travelCostPerKm`, { label: 'Desgaste por km', rule: 'money', unit: '$/km', hint: 'Mantenimiento y neumáticos en ruta. Sin combustible ni amortización (ya está en el costo de tenerlo).' }),
          kit.select(`${p}.driver`, { label: '¿Quién maneja?', options: DRIVER_OPTIONS.map((o) => ({ value: o.id, label: o.label })), includeEmpty: true, emptyLabel: 'Sin definir', structural: true, hint: driverHint }),
        ),
        kit.region((r) => {
          const ml = r.model.mobilization && r.model.mobilization.lines[i];
          if (!ml) return EMPTY;
          return h(
            'div',
            { class: 'mob-calc' },
            h('span', { class: 'mono' }, `${formatValue(ml.km, 'km')} · ${formatValue(ml.liters, 'liters')} por llamado`),
            h('span', {}, `Combustible ${formatMoney(ml.fuelPerActivation)} + desgaste ${formatMoney(ml.wearPerActivation)} = `, h('strong', { class: 'mono' }, formatMoney(ml.perActivation)), ' por llamado'),
          );
        }),
        kit.trace((r) => mobilizationTrace(r, i)),
      );
    } else if (m.mode === 'transported') {
      const carriers = equipmentLines.filter((e, j) => j !== i && e && e.id).map((e) => ({ value: e.id, label: `${e.name || 'Equipo'} (${labelOf(ACQUISITION_MODES, acquisitionOf(e), 'Propio').toLowerCase()})` }));
      detail = formGrid(
        2,
        kit.select(`${p}.carrierLineId`, {
          label: '¿Qué equipo lo transporta?',
          options: carriers,
          includeEmpty: true,
          emptyLabel: carriers.length ? 'Elegí el equipo…' : 'Primero cargá en Equipos el carretón, batea o camión',
          structural: true,
          hint: 'El costo del traslado está en ese equipo (por ejemplo, un carretón tercerizado por viaje). Acá no se suma nada.',
        }),
      );
    } else if (m.mode === 'support') {
      const supports = lg.vehicles.filter((v) => v && v.id).map((v) => ({ value: v.id, label: v.name || 'Vehículo' }));
      detail = formGrid(
        2,
        kit.select(`${p}.supportVehicleId`, {
          label: '¿Con qué vehículo de apoyo?',
          options: supports,
          includeEmpty: true,
          emptyLabel: supports.length ? 'Elegí el vehículo…' : 'Agregá el vehículo en la logística auxiliar',
          structural: true,
          hint: 'El costo está en ese vehículo (por km recorrido). Acá no se suma nada.',
        }),
      );
    }
    const warnings = kit.out((r) => {
      const ml = r.model.mobilization && r.model.mobilization.lines[i];
      const list = ml ? ml.warnings.map((w) => WARNING_TEXT[w]).filter(Boolean) : [];
      return list.length ? h('div', { class: 'qe-line-warnings' }, ...list.map((t) => h('p', { class: 'qe-warn' }, icon('alert', { size: 14 }), h('span', {}, t)))) : '';
    }, { tag: 'div', allowEmpty: true });
    const feeNote = providerFee
      ? h('p', { class: m.mode === 'self' ? 'qe-warn' : 'small' }, m.mode === 'self'
        ? 'El proveedor ya te cobra la movilización aparte (en Equipos). Si él lo lleva, elegí "No requiere movilización" para no sumar también km, combustible y desgaste.'
        : 'El proveedor te cobra la movilización aparte: ese monto ya está en Equipos.')
      : null;
    return h('div', { class: 'mob-row' }, head, formGrid(2, modeField), feeNote, detail, warnings);
  };

  const mobilizationCard = notApplicable || equipmentLines.length === 0
    ? null
    : card(
      {
        title: '¿Cómo llega cada equipo al lugar del servicio?',
        subtitle: 'La movilización del equipo principal. Cada costo va en un solo lugar: si lo transporta otro equipo o un vehículo de apoyo, el costo está en ese equipo o vehículo.',
      },
      h('div', { class: 'stack mob-list' }, ...equipmentLines.map((line, i) => (line ? mobilizationRow(line, i) : null))),
    );

  const vehiclesCard = notApplicable
    ? null
    : card(
      {
        title: 'Logística auxiliar: vehículos de apoyo y de personal',
        subtitle: `Camionetas, traslado de personal o vehículos de apoyo, costeados por km recorrido. No cargues acá un equipo que ya se moviliza por sus propios medios (se contaría dos veces). Si el vehículo también trabaja en locación, sus horas de uso van en "${stepName('equipment')}".`,
        actions: [kit.action('Agregar vehículo', addVehicle, { icon: 'plus' })],
      },
      lg.vehicles.length
        ? table({
          className: 'qe-edit-table qe-stack-table qe-vehicles-table',
          caption: 'Vehículos de traslado',
          columns: [
            {
              key: 'name',
              label: 'Vehículo',
              render: (row, i) => h('div', { class: 'qe-cell-stack' }, kit.text(`logistics.vehicles.${i}.name`, { label: 'Vehículo', maxLength: 80 }), vehicleIll[i].control),
            },
            { key: 'count', label: 'Cantidad', render: (row, i) => kit.num(`logistics.vehicles.${i}.count`, { label: 'Cantidad', rule: 'quantity' }) },
            {
              key: 'cons',
              label: 'Consumo (L/100 km)',
              render: (row, i) => h(
                'div',
                { class: 'qe-cell-stack' },
                kit.num(`logistics.vehicles.${i}.consumptionLPer100Km`, { label: 'Consumo (L/100 km)', rule: 'quantity', illustrative: vehicleIll[i].marked }),
                cellTag(vehicleIll[i].marked),
              ),
            },
            {
              key: 'calc',
              label: 'Por llamado o viaje',
              align: 'right',
              className: 'qe-col-calc',
              render: (row, i) => kit.out((r) => {
                const v = r.model.logistics.vehicles[i];
                if (!v) return EMPTY;
                return h('span', { class: 'qe-cell-calc' }, h('strong', { class: 'mono' }, formatMoney(v.totalPerActivation)), h('span', { class: 'muted small' }, `${formatValue(v.kmPerActivation, 'km')} · ${formatValue(v.litersPerActivation, 'liters')}`));
              }),
            },
            { key: 'remove', label: '', className: 'qe-col-remove', render: (row, i) => kit.action('', () => removeVehicle(i), { variant: 'ghost', icon: 'trash', title: 'Quitar vehículo' }) },
          ],
          rows: lg.vehicles,
        })
        : emptyState(equipmentLines.length ? 'Sin vehículos de apoyo. Agregá uno si llevás personal o un equipo con un vehículo de apoyo.' : 'No hay vehículos de traslado. Agregá al menos uno o marcá "Sin traslados".'),
    );

  const advancedCard = notApplicable
    ? null
    : kit.advanced(
      {
        key: 'logistics',
        boxed: true,
        summary: () => {
          const wear = lg.vehicles
            .map((v) => `${String((v && v.name) || 'Vehículo')} ${moneyText(v && v.costPerKm) || '$ 0'}/km`)
            .join(', ');
          const parts = [
            lg.roundTrip === false ? 'Sólo ida' : 'Ida y vuelta',
            `${numberText(lg.tripsPerActivation, { decimals: 2 }) || '0'} ${Number(lg.tripsPerActivation) === 1 ? 'viaje' : 'viajes'} por llamado`,
            wear ? `desgaste: ${wear}` : null,
            `peajes ${moneyText(lg.tollsPerActivation) || '$ 0'}`,
            `viáticos ${moneyText(lg.lodgingPerActivation) || '$ 0'} por llamado`,
          ].filter(Boolean);
          return `${parts.join(' · ')}.`;
        },
      },
      formGrid(
        2,
        kit.check('logistics.roundTrip', { label: 'Ida y vuelta', hint: 'Duplica los km de cada viaje.' }),
        kit.num('logistics.tripsPerActivation', {
          label: 'Viajes por llamado',
          rule: 'quantity',
          hint: quote.serviceType === 'permanent' ? 'Para servicios permanentes: viajes por cada cambio de turno.' : 'Cuántos viajes hacés en cada llamado.',
        }),
      ),
      lg.vehicles.length
        ? kit.group(
          'Desgaste de cada vehículo (sin combustible)',
          formGrid(
            3,
            ...lg.vehicles.map((v, i) => kit.num(`logistics.vehicles.${i}.costPerKm`, {
              label: `Desgaste de ${String((v && v.name) || 'Vehículo')}`,
              rule: 'money',
              unit: '$/km',
              illustrative: vehicleIll[i].marked,
              hint: 'Neumáticos, mantenimiento y amortización por km.',
            })),
          ),
        )
        : null,
      formGrid(
        2,
        kit.num('logistics.tollsPerActivation', { label: 'Peajes por llamado', rule: 'money', unit: '$', illustrative }),
        kit.num('logistics.lodgingPerActivation', { label: 'Alojamiento y viáticos por llamado', rule: 'money', unit: '$', illustrative }),
      ),
    );

  // Precio de combustible ILUSTRATIVO (default de una configuración de demo
  // o de una plantilla de demostración): se desmarca al editarlo o al
  // confirmar que es el precio vigente (UX-02 / SPEC-01).
  const fuelFlag = Boolean(quote.fuel && quote.fuel.illustrative === true);
  const fuelMarked = illustrative || fuelFlag;
  let fuelConfirm = null;
  const clearFuelFlag = (fieldEl) => {
    if (!(quote.fuel && quote.fuel.illustrative === true)) return;
    ctx.update('fuel.illustrative', false);
    if (illustrative) return; // cotización de demostración: la marca es de toda la cotización
    if (fieldEl) {
      fieldEl.classList.remove('field-illustrative');
      const tag = fieldEl.querySelector('.tag-illustrative');
      if (tag) tag.remove();
      const hint = fieldEl.querySelector('.field-hint');
      if (hint) hint.textContent = 'Precio propio: se quitó la marca ILUSTRATIVO.';
    }
    if (fuelConfirm) fuelConfirm.hidden = true;
  };
  const fuelPriceField = kit.num('fuel.pricePerLiter', {
    label: 'Precio del combustible (sin IVA)',
    rule: 'money',
    unit: '$/L',
    illustrative: fuelMarked,
    hint: fuelFlag && !illustrative ? 'Valor ILUSTRATIVO por defecto: cargá tu precio actual (al editarlo se quita la marca).' : null,
    onValue: (value, el) => clearFuelFlag(el),
  });
  if (fuelFlag && !illustrative) {
    fuelConfirm = checkboxField({
      label: 'Es mi precio vigente',
      name: 'fuel.illustrative',
      checked: false,
      hint: 'Tildala si el precio cargado ya es el tuyo: se quita la marca ILUSTRATIVO.',
      onChange: (checked) => {
        if (!checked) return;
        clearFuelFlag(fuelPriceField);
        ctx.rerender();
      },
    });
    fuelConfirm.classList.add('qe-own-values');
  }

  const fuelCard = card(
    { title: 'Combustible', subtitle: 'Se usa para los viajes, la movilización y el consumo de los equipos cuando trabajan.' },
    formGrid(
      2,
      fuelPriceField,
      kit.select('fuel.providedBy', {
        label: '¿Quién paga el combustible?',
        options: FUEL_PROVIDERS.map((f) => ({ value: f.id, label: f.label })),
        includeEmpty: true,
        emptyLabel: 'Elegí quién lo paga…',
      }),
    ),
    fuelConfirm,
    kit.advanced(
      {
        key: 'fuel-base',
        title: 'Fecha base del precio',
        summary: () => baseText(quote.fuel && quote.fuel.base, { prefix: 'Base' }),
      },
      baseFields(ctx, 'fuel.base', { periodLabel: 'Mes del precio del combustible' }),
    ),
  );

  const keyline = notApplicable
    ? null
    : kit.keyline({
      label: 'Movilización y viajes en el costo del mes',
      value: (r) => formatMoney(r.kpis.logisticsMonthly),
      hint: (r) => {
        const share = isFiniteNumber(r.kpis.logisticsIncidencePct) ? `${formatPercent(r.kpis.logisticsIncidencePct)} del costo total · ` : '';
        const mob = r.model.mobilization ? r.model.mobilization.perActivation : 0;
        const perActivation = r.model.logistics.costPerActivation + mob;
        const split = mob > 0 ? ` (movilización de equipos ${formatMoney(mob)} + logística auxiliar ${formatMoney(r.model.logistics.costPerActivation)})` : '';
        return `${share}${formatMoney(perActivation)} por llamado${split} × ${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} llamados por mes.`;
      },
      trace: (r) => r.traces.logistics,
      className: 'qe-keyline-total',
    });

  const resultsDetail = notApplicable
    ? null
    : kit.advanced(
      {
        key: 'logistics-detail',
        title: 'Ver detalle de kilómetros y litros',
        variant: 'detail',
        boxed: true,
        summary: (r) => `${formatValue(r.model.logistics.kmPerMonth, 'km')} y ${formatValue(r.model.logistics.litersPerMonth, 'liters')} por mes.`,
      },
      kit.stats(
        kit.stat('Km de ruta por llamado', (r) => formatValue(r.model.logistics.routeKmPerActivation, 'km'), { hint: 'Distancia × (ida y vuelta) × viajes.' }),
        kit.stat('Km de vehículos', (r) => formatValue(r.model.logistics.vehicleKmPerActivation, 'km'), { hint: (r) => `Por llamado · ${formatValue(r.model.logistics.kmPerMonth, 'km')} por mes` }),
        kit.stat('Litros', (r) => formatValue(r.model.logistics.litersPerActivation, 'liters'), { hint: (r) => `Por llamado · ${formatValue(r.model.logistics.litersPerMonth, 'liters')} por mes` }),
        kit.stat('Costo por llamado', (r) => formatMoney(r.model.logistics.costPerActivation), { hint: (r) => `${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} viajes o llamados por mes` }),
        kit.stat('Costo logístico mensual', (r) => formatMoney(r.kpis.logisticsMonthly), { emphasis: true, trace: (r) => r.traces.logistics }),
        kit.stat('Incidencia sobre el costo total', (r) => formatPercent(r.kpis.logisticsIncidencePct), { hint: 'Combustible de traslados + desgaste + peajes + viáticos.' }),
      ),
      h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, 'En la estructura de costos, el combustible de los viajes se informa en "Combustible" y el resto (desgaste, peajes, viáticos) en "Logística".')),
    );

  mount(container, toggleCard, routeCard, mobilizationCard, vehiclesCard, fuelCard, advancedCard, keyline, resultsDetail);
  return { update() {} };
}
