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
import { badge, button, card, disclosure, formGrid, infoTip, numberField, selectField, emptyState, table, icon, checkboxField } from '../../components.js';
import { lodgingFromDetail } from '../../../domain/lodging.js';
import { ACQUISITION_MODES, DRIVER_OPTIONS, FUEL_PROVIDERS, MOBILIZATION_MODES, labelOf } from '../../../domain/catalogs.js';
import { createVehicle, acquisitionOf } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { nonNegative, isFiniteNumber } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, moneyText, numberText, stepName } from './shared.js';
import { capacityPerTripOf } from '../../../engines/transport-engine.js';
import { baseFields } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { transportStats, transportOf, providerActivityList, routeText, tripsText } from './transport.js';
import { activationTerms, activationFieldLabels } from '../../../domain/activation-terms.js';

const WARNING_TEXT = Object.freeze({
  travel_consumption: 'Falta el consumo en ruta (L/100 km): el combustible del traslado queda en 0.',
  driver: 'Falta definir quién maneja en el traslado.',
  carrier_missing: 'Elegí qué equipo lo transporta (de los cargados en Equipos).',
  carrier_cycle: 'Dos equipos se transportan entre sí: revisá cuál lleva a cuál.',
  support_missing: 'Elegí el vehículo de apoyo que lo lleva (de la logística auxiliar).',
});

/** "Ver cálculo" de la movilización de un equipo que va por sus propios medios. */
function mobilizationTrace(result, index, T) {
  const m = result && result.model.mobilization && result.model.mobilization.lines[index];
  if (!m) return null;
  return createTrace({
    id: 'mobilization_line',
    title: `Movilización — ${m.name || 'Equipo'}`,
    formula: `km ${T.per} = km de ruta ${T.per} × cantidad · litros = km × consumo en ruta / 100 · combustible = litros × precio · desgaste = km × ($/km + neumáticos $/km si se cargaron por km) (sin combustible ni amortización) · por día activo = ${T.per} / días ${T.per}`,
    inputs: [
      { label: `Km de ruta ${T.per}`, value: result.model.mobilization.routeKmPerActivation, format: 'km' },
      { label: 'Cantidad', value: m.quantity, format: 'number' },
      { label: 'Consumo en ruta', value: m.travelLitersPer100Km, format: 'number', unit: 'L/100 km' },
      { label: 'Precio del combustible (si lo pagás)', value: result.model.fuel.paidByUs ? result.model.fuel.pricePerLiter : 0, format: 'rate' },
      { label: 'Desgaste por km', value: m.travelCostPerKm, format: 'rate' },
      m.tiresPerKm > 0 ? { label: 'Neumáticos por km (juego ÷ vida útil en km)', value: m.tiresPerKm, format: 'rate' } : null,
      { label: `Días ${T.per}`, value: result.activity.daysPerActivation, format: 'days' },
    ].filter(Boolean),
    steps: [
      { label: `Km ${T.per}`, value: m.km, format: 'km' },
      { label: `Litros ${T.per}`, value: m.liters, format: 'liters' },
      { label: `Combustible en ruta ${T.per}`, value: m.fuelPerActivation, format: 'money' },
      { label: `Desgaste ${T.per}`, value: m.wearPerActivation, format: 'money' },
      { label: 'Por día activo', value: m.perActiveDay, format: 'money' },
    ],
    result: { label: `Movilización ${T.per}`, value: m.perActivation, format: 'money' },
    notes: [
      m.driver === 'operator' ? `Maneja su operador${m.operatorName ? ` (${m.operatorName})` : ''}: no se suma mano de obra (ya está en Personal).` : null,
      m.driver === 'other' ? 'Maneja otra persona: tiene que estar cargada en Personal (RATEOS no la agrega sola).' : null,
      'La amortización del equipo ya está en su costo de tenerlo: no se vuelve a sumar por km.',
    ],
  });
}

/** "Ver cálculo" de un remolque arrastrado (A-3): rueda la ruta, sin combustible ni conductor. */
function towedTrace(result, index, T) {
  const m = result && result.model.mobilization && result.model.mobilization.lines[index];
  if (!m || !m.towed) return null;
  return createTrace({
    id: 'mobilization_towed',
    title: `Movilización — ${m.name || 'Equipo'} (enganchado)`,
    formula: `km ${T.per} = km de ruta ${T.per} × cantidad · desgaste = km × ($/km + neumáticos $/km si se cargaron por km) · sin combustible ni conductor (los pone el equipo que lo arrastra) · por día activo = ${T.per} / días ${T.per}`,
    inputs: [
      { label: `Km de ruta ${T.per}`, value: result.model.mobilization.routeKmPerActivation, format: 'km' },
      { label: 'Cantidad', value: m.quantity, format: 'number' },
      { label: 'Desgaste por km', value: m.travelCostPerKm, format: 'rate' },
      { label: 'Neumáticos por km (juego ÷ vida útil en km)', value: m.tiresPerKm, format: 'rate' },
      { label: `Días ${T.per}`, value: result.activity.daysPerActivation, format: 'days' },
    ],
    steps: [
      { label: `Km ${T.per}`, value: m.km, format: 'km' },
      { label: `Desgaste ${T.per}`, value: m.wearPerActivation, format: 'money' },
      { label: 'Por día activo', value: m.perActiveDay, format: 'money' },
    ],
    result: { label: `Movilización ${T.per}`, value: m.perActivation, format: 'money' },
    notes: [
      m.carrier ? `Lo arrastra "${m.carrier.name}": su combustible y su conductor están en esa línea.` : null,
      'La amortización del equipo ya está en su costo de tenerlo: no se vuelve a sumar por km.',
    ],
  });
}

/**
 * Viáticos por personas y noches (PLAN-2026-021): una cuenta de ayuda que
 * llena "Alojamiento y viáticos" por salida. El motor sigue usando ese monto
 * (no cambia ninguna fórmula); el detalle se guarda para poder rehacerla.
 */
function lodgingCalculator(ctx, T) {
  const { quote } = ctx;
  if (ctx.readOnly) return null;
  const saved = quote.logistics && quote.logistics.lodgingDetail && typeof quote.logistics.lodgingDetail === 'object' ? quote.logistics.lodgingDetail : {};
  // Días con comidas: si no se cargaron, los días de cada salida (redondeados hacia arriba).
  const dpa = Number(quote.activity && quote.activity.daysPerActivation);
  const defaultDays = Number.isFinite(dpa) && dpa >= 1 ? Math.ceil(dpa) : null;
  const d = { people: saved.people ?? null, nights: saved.nights ?? null, perNight: saved.perNight ?? null, days: saved.days ?? defaultDays, perDay: saved.perDay ?? null };
  // Comidas ya cargadas en Personal: se avisa a la vista para no contarlas dos veces.
  const laborMeals = (Array.isArray(quote.labor) ? quote.labor : []).some((l) => l && nonNegative(l.mealPerActiveDay) > 0);
  const current = nonNegative(quote.logistics && quote.logistics.lodgingPerActivation);
  const matches = current > 0 && Math.abs(lodgingFromDetail(saved) - current) < 0.005;
  const total = h('strong', { 'aria-live': 'polite' });
  const note = h('span', { class: 'small muted' });
  const useBtn = button('Usar este monto', { variant: 'primary', icon: 'check', onClick: () => {
    const value = lodgingFromDetail(d);
    ctx.mutate((q) => {
      q.logistics.lodgingDetail = { ...d };
      q.logistics.lodgingPerActivation = value;
    }, { focus: 'logistics.lodgingPerActivation' });
    ctx.toast(`Viáticos ${T.per}: ${formatMoney(value)}.`, 'success');
  } });
  const refresh = () => {
    const v = lodgingFromDetail(d);
    total.textContent = `${formatMoney(v)} ${T.per}`;
    useBtn.disabled = !(v > 0);
    note.textContent = !(v > 0)
      ? 'Completá personas y noches o días.'
      : current > 0 && !matches && Math.abs(v - current) >= 0.005 ? `Reemplaza los ${formatMoney(current)} cargados.` : '';
  };
  const field = (key, label, rule, unit, hint = null) => numberField({ label, value: d[key], rule, unit, hint, onChange: (v) => { d[key] = v; refresh(); } });
  refresh();
  return disclosure(
    {
      summary: 'Calcular por personas y noches',
      hint: matches ? `${formatNumber(Number(saved.people) || 0)} personas × ${formatNumber(Number(saved.nights) || 0)} noches + comidas.` : null,
      className: 'qe-lodging-calc',
    },
    formGrid(
      3,
      field('people', 'Personas que viajan', 'quantity', 'personas'),
      field('nights', `Noches ${T.per}`, 'quantity', 'noches'),
      field('perNight', 'Alojamiento por persona y noche', 'money', '$'),
      field('days', `Días con comidas ${T.per}`, 'quantity', 'días'),
      field('perDay', 'Comidas por persona y día', 'money', '$', 'Comidas y desarraigo. Si ya están en cada puesto de Personal, poné 0 para no contarlas dos veces.'),
    ),
    laborMeals ? h('p', { class: 'qe-warn' }, 'Personal ya tiene comidas por día cargadas: si son las mismas, dejá las comidas en 0 acá.') : null,
    h('div', { class: 'qe-toolbar' },
      h('span', {}, 'Total: ', total, ' ', infoTip('Personas × noches × alojamiento + personas × días × comidas.')),
      useBtn, note),
  );
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const lg = quote.logistics;
  const notApplicable = Boolean(lg.notApplicable);
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const L = activationFieldLabels(T);
  // Unidad "viaje" (PLAN-2026-012): los viajes por intervención se derivan.
  const unitInfo = billingUnitOf(quote);
  const tripUnit = unitInfo.id === 'trip' && unitInfo.kind === 'quantity';
  // Por m³ / t…: con capacidad por viaje los viajes se calculan solos (auditoría 2026-11).
  const capacityTrips = capacityPerTripOf(quote) !== null;
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
      kit.out((r) => routeText(transportOf(r)), { tag: 'p', className: 'small muted qe-route-line', allowEmpty: true }),
      // Viajes facturables, físicos, días y km (PLAN-2026-012).
      kit.toggle(kit.group('Viajes y km del mes', transportStats(kit, { billable: tripUnit, km: unitInfo.id === 'km' })), (r) => Boolean(transportOf(r) && transportOf(r).applicable)),
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
          kit.num(`${p}.travelCostPerKm`, {
            label: 'Desgaste por km',
            rule: 'money',
            unit: '$/km',
            hint: (quote.equipment[i] && quote.equipment[i].tiresMode) === 'set_km'
              ? 'Mantenimiento en ruta, SIN neumáticos: los neumáticos de este equipo se suman aparte por km (juego ÷ vida útil). Sin combustible ni amortización.'
              : 'Mantenimiento y neumáticos en ruta. Sin combustible ni amortización (ya está en el costo de tenerlo).',
          }),
          kit.select(`${p}.driver`, { label: '¿Quién maneja?', options: DRIVER_OPTIONS.map((o) => ({ value: o.id, label: o.label })), includeEmpty: true, emptyLabel: 'Sin definir', structural: true, hint: driverHint }),
        ),
        kit.region((r) => {
          const ml = r.model.mobilization && r.model.mobilization.lines[i];
          if (!ml) return EMPTY;
          return h(
            'div',
            { class: 'mob-calc' },
            h('span', { class: 'mono' }, `${formatValue(ml.km, 'km')} · ${formatValue(ml.liters, 'liters')} ${T.per}`),
            h('span', {}, `Combustible ${formatMoney(ml.fuelPerActivation)} + desgaste ${formatMoney(ml.wearPerActivation)} = `, h('strong', { class: 'mono' }, formatMoney(ml.perActivation)), ` ${T.per}`),
          );
        }),
        kit.trace((r) => mobilizationTrace(r, i, T)),
      );
    } else if (m.mode === 'transported') {
      const carriers = equipmentLines.filter((e, j) => j !== i && e && e.id).map((e) => ({ value: e.id, label: `${e.name || 'Equipo'} (${labelOf(ACQUISITION_MODES, acquisitionOf(e), 'Propio').toLowerCase()})` }));
      const towed = m.towed === true;
      const tiresByKm = (quote.equipment[i] && quote.equipment[i].tiresMode) === 'set_km';
      detail = h(
        'div',
        { class: 'stack' },
        formGrid(
          2,
          kit.select(`${p}.carrierLineId`, {
            label: '¿Qué equipo lo transporta?',
            options: carriers,
            includeEmpty: true,
            emptyLabel: carriers.length ? 'Elegí el equipo…' : 'Primero cargá en Equipos el carretón, batea o camión',
            structural: true,
            hint: towed
              ? 'El combustible y el conductor están en ese equipo (el que lo arrastra). Acá se suma sólo el desgaste de este equipo por los km que rueda.'
              : 'El costo del traslado está en ese equipo (por ejemplo, un carretón tercerizado por viaje). Acá no se suma nada.',
          }),
          // Remolque arrastrado (A-3): elección explícita; sin elegir = va cargado arriba (como siempre),
          // pero el aviso de neumáticos por km pide elegir una de las dos.
          selectField({
            label: '¿Cómo viaja?',
            name: `${p}.towed`,
            value: m.towed === true ? 'towed' : m.towed === false ? 'loaded' : '',
            includeEmpty: true,
            emptyLabel: 'Elegí…',
            options: [{ value: 'loaded', label: 'Va cargado arriba' }, { value: 'towed', label: 'Va enganchado y rueda' }],
            disabled: kit.readOnly,
            hint: 'Va enganchado y rueda: remolque, carretón o batea arrastrada que recorre la ruta sobre sus propias ruedas; suma su desgaste por km (mantenimiento y neumáticos), sin combustible ni conductor. Va cargado arriba: viaja sobre el otro equipo y acá no se suma nada. Sin elegir, se toma como cargado arriba.',
            onChange: (value) => {
              ctx.mutate((q) => {
                const line = q.equipment[i];
                if (!line || !line.mobilization) return;
                if (value === 'towed') line.mobilization.towed = true;
                else if (value === 'loaded') line.mobilization.towed = false;
                else delete line.mobilization.towed;
              });
            },
          }),
        ),
        towed
          ? formGrid(
            2,
            kit.num(`${p}.travelCostPerKm`, {
              label: 'Desgaste por km',
              rule: 'money',
              unit: '$/km',
              hint: tiresByKm
                ? 'Mantenimiento en ruta, SIN neumáticos: los neumáticos de este equipo se suman aparte por km (juego ÷ vida útil). Sin combustible ni amortización.'
                : 'Mantenimiento y neumáticos en ruta. Sin combustible ni amortización (ya está en el costo de tenerlo).',
            }),
          )
          : null,
        towed
          ? kit.region((r) => {
            const ml = r.model.mobilization && r.model.mobilization.lines[i];
            if (!ml) return EMPTY;
            return h(
              'div',
              { class: 'mob-calc' },
              h('span', { class: 'mono' }, `${formatValue(ml.km, 'km')} ${T.per}`),
              h('span', {}, 'Desgaste = ', h('strong', { class: 'mono' }, formatMoney(ml.wearPerActivation)), ` ${T.per} (sin combustible ni conductor)`),
            );
          })
          : null,
        towed ? kit.trace((r) => towedTrace(r, i, T)) : null,
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
              label: L.perActivation,
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
            tripUnit
              ? `viajes ${T.per} según los viajes por día`
              : capacityTrips
              ? `viajes ${T.per} según la capacidad por viaje`
              : `${numberText(lg.tripsPerActivation, { decimals: 2 }) || '0'} ${Number(lg.tripsPerActivation) === 1 ? 'viaje' : 'viajes'} ${T.per}`,
            wear ? `desgaste: ${wear}` : null,
            `peajes ${moneyText(lg.tollsPerActivation) || '$ 0'}`,
          ].filter(Boolean);
          return `${parts.join(' · ')}.`;
        },
      },
      formGrid(
        2,
        kit.check('logistics.roundTrip', { label: 'Ida y vuelta', hint: 'Duplica los km de cada viaje.' }),
        capacityTrips
          ? h('div', { class: 'field' },
            h('span', { class: 'field-label' }, L.tripsPerActivation),
            kit.out((r) => {
              const t = transportOf(r);
              return t ? tripsText(t.physicalTripsPerActivation) : EMPTY;
            }, { tag: 'div', className: 'qe-static' }),
            kit.out((r) => {
              const t = transportOf(r);
              if (!t || !t.byCapacity) return '';
              return `Se calcula solo: ${formatNumber(t.unitsPerTripActivation, { decimals: 2 })} ${T.per} ÷ ${formatNumber(t.capacityPerTrip, { decimals: 2 })} por viaje, redondeado hacia arriba (capacidad en "${stepName('modality')}").`;
            }, { tag: 'div', className: 'field-hint', allowEmpty: true }))
          : tripUnit
          ? h('div', { class: 'field' },
            h('span', { class: 'field-label' }, L.tripsPerActivation),
            kit.out((r) => {
              const t = transportOf(r);
              return t ? tripsText(t.physicalTripsPerActivation) : EMPTY;
            }, { tag: 'div', className: 'qe-static' }),
            kit.out((r) => {
              const t = transportOf(r);
              if (!t) return '';
              return `Se calcula solo: ${formatNumber(t.tripsPerActiveDay || 0, { decimals: 2 })} viajes por día × ${formatNumber(t.daysPerActivation, { decimals: 2 })} ${t.daysPerActivation === 1 ? 'día' : 'días'} ${T.per} (en "${stepName('modality')}"). Con la unidad "viaje" los km del mes salen de los viajes que facturás.`;
            }, { tag: 'div', className: 'field-hint', allowEmpty: true }))
          : kit.num('logistics.tripsPerActivation', {
            label: L.tripsPerActivation,
            rule: 'quantity',
            hint: `Cuántos viajes hacés en ${T.each}.`,
          }),
      ),
      // Cotización anterior con otro "Viajes por llamado" (PLAN-2026-012): se avisa y se puede dar por visto.
      tripUnit
        ? kit.toggle(h('div', { class: 'qe-note is-warning qe-trips-notice' },
          kit.out((r) => {
            const t = transportOf(r);
            if (!t || !t.storedDiffers) return '';
            return `Esta cotización tenía cargado ${tripsText(t.storedTripsPerActivation)} ${T.per}: con la unidad "viaje" ya no se usa. Se costean ${tripsText(t.physicalTripsPerMonth)} físicos (${formatNumber(t.routeKmPerMonth, { decimals: 0 })} km) para los ${tripsText(t.billableTripsPerMonth)} que facturás.`;
          }, { tag: 'p', allowEmpty: true }),
          kit.action('Entendido', () => ctx.mutate((q) => {
            const t = transportOf(ctx.result);
            const perDay = Number(q.activity && q.activity.unitsPerActiveDay);
            const dpa = q.activity && q.activity.daysPerActivation !== null && q.activity.daysPerActivation !== undefined && q.activity.daysPerActivation !== '' ? Number(q.activity.daysPerActivation) : 1;
            if (t && Number.isFinite(t.physicalTripsPerActivation)) q.logistics.tripsPerActivation = t.physicalTripsPerActivation;
            else if (Number.isFinite(perDay) && Number.isFinite(dpa)) q.logistics.tripsPerActivation = perDay * dpa;
          }), { icon: 'check' })), (r) => Boolean(transportOf(r) && transportOf(r).storedDiffers))
        : null,
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
        kit.num('logistics.tollsPerActivation', { label: L.tollsPerActivation, rule: 'money', unit: '$', illustrative }),
      ),
    );

  // Viáticos a la vista (PLAN-2026-021): un costo frecuente, no un ajuste fino.
  const lodgingCard = notApplicable
    ? null
    : card(
      { title: 'Viáticos' },
      formGrid(
        2,
        kit.num('logistics.lodgingPerActivation', { label: L.lodgingPerActivation, rule: 'money', unit: '$', illustrative, hint: 'Alojamiento, comidas y desarraigo de la gente que viaja. Abajo lo podés calcular por personas y noches.' }),
      ),
      lodgingCalculator(ctx, T),
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
    hint: fuelFlag && !illustrative
      ? `Valor ILUSTRATIVO de ejemplo (${baseText(quote.fuel.base, { prefix: 'Base' })}): cargá tu precio actual o, si ya es el tuyo, tildá "Es mi precio vigente". RATEOS nunca lo actualiza solo.`
      : null,
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
        // Los km que cobra un proveedor por km o por viaje están en Equipos (PLAN-2026-012).
        const providers = (transportOf(r) && transportOf(r).providers) || [];
        const providerNote = providers.length
          ? ` Los viajes del proveedor (${providers.map((p) => `${p.name}: ${formatMoney(p.netMonthly)} neto`).join('; ')}) están en "${stepName('equipment')}", no acá.`
          : '';
        return `${share}${formatMoney(perActivation)} ${T.per}${split} × ${formatNumber(r.model.logistics.activationsPerMonth, { decimals: 2 })} ${T.many} por mes.${providerNote}`;
      },
      trace: (r) => r.traces.logistics,
      className: 'qe-keyline-total',
    });

  // Detalle de km y litros (PLAN-2026-010): A. movilización de los equipos
  // principales, B. logística auxiliar (vehículos de apoyo), C. total. Los
  // montos son los mismos del costo (no se suman dos veces).
  const mobOf = (r) => r.model.mobilization || { kmPerActivation: 0, litersPerActivation: 0, fuelPerActivation: 0, wearPerActivation: 0, perActivation: 0, routeKmPerActivation: 0 };
  const activationsOf = (r) => r.model.logistics.activationsPerMonth;
  const perMonth = (r, v) => v * activationsOf(r);
  const activationsText = (r) => `${formatNumber(activationsOf(r), { decimals: 2 })} ${T.word(activationsOf(r))} por mes`;
  const resultsDetail = notApplicable
    ? null
    : kit.advanced(
      {
        key: 'logistics-detail',
        title: 'Ver detalle de kilómetros y litros',
        variant: 'detail',
        boxed: true,
        summary: (r) => {
          const m = mobOf(r);
          const km = perMonth(r, m.kmPerActivation) + r.model.logistics.kmPerMonth;
          const liters = perMonth(r, m.litersPerActivation) + r.model.logistics.litersPerMonth;
          return `${formatValue(km, 'km')} y ${formatValue(liters, 'liters')} por mes (equipos ${formatValue(perMonth(r, m.kmPerActivation), 'km')} + vehículos auxiliares ${formatValue(r.model.logistics.kmPerMonth, 'km')}) · ${activationsText(r)}.`;
        },
      },
      // Distancia / actividad de los proveedores por km o por viaje (PLAN-2026-012):
      // aparte de la movilización propia (cada costo en un solo lugar).
      kit.toggle(kit.group(
        'Distancia / actividad del proveedor (tarifa por km o por viaje, en Equipos)',
        kit.region((r) => providerActivityList(r) || ''),
      ), (r) => Boolean(transportOf(r) && transportOf(r).providers.length)),
      kit.group(
        'A. Movilización propia (equipos que van por sus medios)',
        kit.stats(
          kit.stat(`${T.Many} por mes`, (r) => formatNumber(activationsOf(r), { decimals: 2 }), { hint: `Días de trabajo ÷ días ${T.per}.` }),
          kit.stat(`Km ${T.per}`, (r) => formatValue(mobOf(r).kmPerActivation, 'km'), { hint: (r) => `Ruta de ${formatValue(mobOf(r).routeKmPerActivation, 'km')} ${T.per} × equipos que van por sus medios.` }),
          kit.stat('Km por mes', (r) => formatValue(perMonth(r, mobOf(r).kmPerActivation), 'km')),
          kit.stat('Litros por mes', (r) => formatValue(perMonth(r, mobOf(r).litersPerActivation), 'liters'), { hint: (r) => `${formatValue(mobOf(r).litersPerActivation, 'liters')} ${T.per} (consumo en ruta).` }),
          kit.stat('Combustible por mes', (r) => formatMoney(perMonth(r, mobOf(r).fuelPerActivation))),
          kit.stat('Desgaste por mes', (r) => formatMoney(perMonth(r, mobOf(r).wearPerActivation)), { hint: 'Mantenimiento y neumáticos por km (sin amortización).' }),
          kit.stat('Costo mensual de movilización', (r) => formatMoney(perMonth(r, mobOf(r).perActivation)), { emphasis: true }),
        ),
      ),
      kit.group(
        'B. Vehículos y logística auxiliar',
        kit.stats(
          kit.stat(`Km de vehículos ${T.per}`, (r) => formatValue(r.model.logistics.vehicleKmPerActivation, 'km'), { hint: (r) => `${formatValue(r.model.logistics.kmPerMonth, 'km')} por mes` }),
          kit.stat('Litros por mes', (r) => formatValue(r.model.logistics.litersPerMonth, 'liters'), { hint: (r) => `${formatValue(r.model.logistics.litersPerActivation, 'liters')} ${T.per}` }),
          kit.stat(`Costo ${T.per}`, (r) => formatMoney(r.model.logistics.costPerActivation), { hint: 'Combustible + desgaste + peajes + viáticos.' }),
          kit.stat('Costo mensual auxiliar', (r) => formatMoney(r.model.logistics.monthlyCost), { emphasis: true }),
        ),
      ),
      kit.group(
        'C. Total',
        kit.stats(
          kit.stat('Km por mes', (r) => formatValue(perMonth(r, mobOf(r).kmPerActivation) + r.model.logistics.kmPerMonth, 'km')),
          kit.stat('Litros por mes', (r) => formatValue(perMonth(r, mobOf(r).litersPerActivation) + r.model.logistics.litersPerMonth, 'liters')),
          kit.stat('Costo mensual de movilización y viajes', (r) => formatMoney(r.kpis.logisticsMonthly), { emphasis: true, trace: (r) => r.traces.logistics }),
          kit.stat('Incidencia sobre el costo total', (r) => formatPercent(r.kpis.logisticsIncidencePct), { hint: 'Movilización de equipos + logística auxiliar.' }),
        ),
      ),
      h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, 'En la estructura de costos, el combustible de la movilización y de los viajes se informa en "Combustible" y el resto (desgaste, peajes, viáticos) en "Logística". Cada costo está en un solo lugar.')),
    );

  mount(container, toggleCard, routeCard, mobilizationCard, vehiclesCard, lodgingCard, fuelCard, advancedCard, keyline, resultsDetail);
  return { update() {} };
}
