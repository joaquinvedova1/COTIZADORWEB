/**
 * Paso 6 — Logística.
 * Traslados entre base y locación (por activación) y combustible.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, emptyState, table, icon } from '../../components.js';
import { FUEL_PROVIDERS } from '../../../domain/catalogs.js';
import { createVehicle } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { nonNegative } from '../../../core/money.js';

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const lg = quote.logistics;
  const notApplicable = Boolean(lg.notApplicable);
  const illustrative = Boolean(quote.illustrative);
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
  const removeVehicle = (index) => ctx.mutate((q) => q.logistics.vehicles.splice(index, 1));

  const toggleCard = card(
    { title: 'Traslados', subtitle: 'Viajes entre la base y la locación del cliente.' },
    kit.check('logistics.notApplicable', { label: 'Sin traslados', structural: true, hint: 'Marcalo si el servicio se presta en tu base o el cliente traslada todo.' }),
  );

  const routeCard = notApplicable
    ? null
    : card(
      { title: 'Ruta', subtitle: 'Distancia de UNA vía; marcá ida y vuelta si el vehículo vuelve a la base.' },
      locations.length
        ? formGrid(
          2,
          bases.length
            ? selectField({ label: 'Completar base desde ubicaciones', value: null, includeEmpty: true, emptyLabel: 'Elegí una base…', options: bases.map((l) => ({ value: l.id, label: l.name })), onChange: pickBase })
            : null,
          destinations.length
            ? selectField({
              label: 'Completar destino y distancia desde ubicaciones',
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
        kit.num('logistics.distanceKm', { label: 'Distancia base → locación (una vía)', rule: 'distance', unit: 'km' }),
        kit.check('logistics.roundTrip', { label: 'Ida y vuelta', hint: 'Duplica los km de cada viaje.' }),
        kit.num('logistics.tripsPerActivation', {
          label: 'Viajes por activación',
          rule: 'quantity',
          hint: quote.serviceType === 'permanent' ? 'Para servicios permanentes: viajes por cada cambio de turno.' : 'Viajes completos en cada llamado o activación.',
        }),
      ),
    );

  const vehiclesCard = notApplicable
    ? null
    : card(
      {
        title: 'Vehículos de traslado',
        subtitle: 'Se costean por km recorrido. El uso en locación (horas) se carga en Equipos.',
        actions: [kit.action('Agregar vehículo', addVehicle, { icon: 'plus' })],
      },
      lg.vehicles.length
        ? table({
          className: 'qe-edit-table',
          caption: 'Vehículos de traslado',
          columns: [
            { key: 'name', label: 'Vehículo', render: (row, i) => kit.text(`logistics.vehicles.${i}.name`, { label: 'Vehículo', maxLength: 80 }) },
            { key: 'count', label: 'Cantidad', render: (row, i) => kit.num(`logistics.vehicles.${i}.count`, { label: 'Cantidad', rule: 'quantity' }) },
            { key: 'cons', label: 'Consumo (L/100 km)', render: (row, i) => kit.num(`logistics.vehicles.${i}.consumptionLPer100Km`, { label: 'Consumo (L/100 km)', rule: 'quantity', illustrative }) },
            { key: 'wear', label: 'Desgaste ($/km, sin combustible)', render: (row, i) => kit.num(`logistics.vehicles.${i}.costPerKm`, { label: 'Desgaste ($/km, sin combustible)', rule: 'money', illustrative }) },
            {
              key: 'calc',
              label: 'Por activación',
              align: 'right',
              render: (row, i) => kit.out((r) => {
                const v = r.model.logistics.vehicles[i];
                if (!v) return EMPTY;
                return h('span', { class: 'qe-cell-calc' }, h('strong', { class: 'mono' }, formatMoney(v.totalPerActivation)), h('span', { class: 'muted small' }, `${formatValue(v.kmPerActivation, 'km')} · ${formatValue(v.litersPerActivation, 'liters')}`));
              }),
            },
            { key: 'remove', label: '', render: (row, i) => kit.action('', () => removeVehicle(i), { variant: 'ghost', icon: 'trash', title: 'Quitar vehículo' }) },
          ],
          rows: lg.vehicles,
        })
        : emptyState('No hay vehículos de traslado. Agregá al menos uno o marcá "Sin traslados".'),
      formGrid(
        2,
        kit.num('logistics.tollsPerActivation', { label: 'Peajes por activación', rule: 'money', unit: '$' }),
        kit.num('logistics.lodgingPerActivation', { label: 'Alojamiento / viáticos por activación', rule: 'money', unit: '$' }),
      ),
    );

  const fuelCard = card(
    { title: 'Combustible', subtitle: 'Se usa para traslados y para el consumo de los equipos en operación.' },
    formGrid(
      2,
      kit.num('fuel.pricePerLiter', { label: 'Precio del combustible', rule: 'money', unit: '$/L', illustrative }),
      kit.select('fuel.providedBy', {
        label: '¿Quién paga el combustible?',
        options: FUEL_PROVIDERS.map((f) => ({ value: f.id, label: f.label })),
        includeEmpty: true,
        emptyLabel: 'Elegí quién lo paga…',
      }),
    ),
    h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, 'En la estructura de costos, el combustible de traslados se informa en "Combustible" y el resto (desgaste, peajes, viáticos) en "Logística".')),
  );

  const resultsCard = notApplicable
    ? null
    : card(
      { title: 'Costo logístico', subtitle: 'Con la actividad estimada de la cotización.' },
      kit.stats(
        kit.stat('Km de ruta por activación', (r) => formatValue(r.model.logistics.routeKmPerActivation, 'km'), { hint: 'Distancia × (ida y vuelta) × viajes.' }),
        kit.stat('Km de vehículos', (r) => formatValue(r.model.logistics.vehicleKmPerActivation, 'km'), { hint: (r) => `Por activación · ${formatValue(r.model.logistics.kmPerMonth, 'km')} por mes` }),
        kit.stat('Litros', (r) => formatValue(r.model.logistics.litersPerActivation, 'liters'), { hint: (r) => `Por activación · ${formatValue(r.model.logistics.litersPerMonth, 'liters')} por mes` }),
        kit.stat('Costo por activación', (r) => formatMoney(r.model.logistics.costPerActivation), { hint: (r) => `${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} activaciones por mes` }),
        kit.stat('Costo logístico mensual', (r) => formatMoney(r.kpis.logisticsMonthly), { emphasis: true, trace: (r) => r.traces.logistics }),
        kit.stat('Incidencia sobre el costo total', (r) => formatPercent(r.kpis.logisticsIncidencePct), { hint: 'Combustible de traslados + desgaste + peajes + viáticos.' }),
      ),
    );

  mount(container, toggleCard, routeCard, vehiclesCard, fuelCard, resultsCard);
  return { update() {} };
}
