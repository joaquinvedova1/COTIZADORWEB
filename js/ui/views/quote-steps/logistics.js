/**
 * Etapa 2 · Los recursos — Viajes (logística).
 * Traslados entre base y locación (por activación) y combustible.
 * Básico: base, destino, distancia, vehículos, precio del combustible y quién
 * lo paga. Opciones avanzadas (con resumen visible): ida y vuelta, viajes por
 * llamado, desgaste por vehículo, peajes y viáticos.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, emptyState, table, icon, checkboxField } from '../../components.js';
import { FUEL_PROVIDERS } from '../../../domain/catalogs.js';
import { createVehicle } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { nonNegative } from '../../../core/money.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, moneyText, numberText } from './shared.js';

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

  const vehiclesCard = notApplicable
    ? null
    : card(
      {
        title: '¿Con qué vehículos?',
        subtitle: 'Se costean por km recorrido. Si el vehículo también trabaja en locación, sus horas de uso van en "Equipos".',
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
        : emptyState('No hay vehículos de traslado. Agregá al menos uno o marcá "Sin traslados".'),
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
          label: 'Viajes por llamado o activación',
          rule: 'quantity',
          hint: quote.serviceType === 'permanent' ? 'Para servicios permanentes: viajes por cada cambio de turno.' : 'Viajes completos en cada llamado o activación.',
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
    label: 'Precio del combustible',
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
    { title: 'Combustible', subtitle: 'Se usa para los viajes y para el consumo de los equipos cuando trabajan.' },
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
  );

  const keyline = notApplicable
    ? null
    : kit.keyline({
      label: 'Viajes en el costo del mes',
      value: (r) => formatMoney(r.kpis.logisticsMonthly),
      hint: (r) => `${formatPercent(r.kpis.logisticsIncidencePct)} del costo total · ${formatMoney(r.model.logistics.costPerActivation)} por llamado × ${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} llamados por mes.`,
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
        kit.stat('Costo por llamado', (r) => formatMoney(r.model.logistics.costPerActivation), { hint: (r) => `${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} llamados o activaciones por mes` }),
        kit.stat('Costo logístico mensual', (r) => formatMoney(r.kpis.logisticsMonthly), { emphasis: true, trace: (r) => r.traces.logistics }),
        kit.stat('Incidencia sobre el costo total', (r) => formatPercent(r.kpis.logisticsIncidencePct), { hint: 'Combustible de traslados + desgaste + peajes + viáticos.' }),
      ),
      h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, 'En la estructura de costos, el combustible de los viajes se informa en "Combustible" y el resto (desgaste, peajes, viáticos) en "Logística".')),
    );

  mount(container, toggleCard, routeCard, vehiclesCard, fuelCard, advancedCard, keyline, resultsDetail);
  return { update() {} };
}
