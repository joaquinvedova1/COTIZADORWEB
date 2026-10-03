/**
 * Paso 2 — Modalidad de cotización.
 * Modo (conozco la tarifa / conozco la actividad), unidad, actividad
 * estimada y disponibilidad on-call.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, icon, choiceGroup, openDialog, button } from '../../components.js';
import { PRICING_MODES, RATE_UNITS, AVAILABILITY_OPTIONS } from '../../../domain/catalogs.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace } from './shared.js';

const MODE_DETAILS = Object.freeze({
  known_rate: 'Ingresás la tarifa que te pidieron o que querés ofrecer. RATEOS calcula los días mínimos para no perder plata (break-even), el resultado y el margen esperados con tu actividad estimada.',
  known_activity: 'Ingresás cuántos días esperás trabajar. RATEOS calcula la tarifa piso (margen 0 %) y las tarifas necesarias para ganar 5 %, 10 % o 15 % sobre el precio.',
});

const UNIT_HINTS = Object.freeze({
  day: 'Se factura cada día activo.',
  hour: 'Se factura cada hora trabajada (días activos × horas por día).',
  month: 'Abono fijo mensual: la facturación no depende de los días activos.',
});

const AVAILABILITY_HINTS = Object.freeze({
  '24/7': 'Disponible todos los días, a toda hora. Normalmente exige relevos.',
  window: 'Disponible sólo en una franja horaria acordada.',
});

function daysPerActivationLabel(serviceType) {
  if (serviceType === 'on_call') return 'Duración promedio de cada llamado (días)';
  if (serviceType === 'permanent') return 'Días entre traslados / cambio de turno';
  return 'Días por activación o viaje';
}

function unitsLabel(unit, value) {
  if (unit === 'hour') return `${formatNumber(value, { decimals: 2 })} horas`;
  if (unit === 'month') return `${formatNumber(value, { decimals: 2 })} ${Math.abs(value - 1) < 1e-9 ? 'abono' : 'abonos'}`;
  return `${formatNumber(value, { decimals: 2 })} días`;
}

function rateRowFor(result, marginPct) {
  return (result.ratesAtEstimate.byMargin || []).find((m) => m.marginPct === marginPct) || null;
}

const unitById = (id) => RATE_UNITS.find((u) => u.id === id) || RATE_UNITS[0];

/** Diálogo al cambiar la unidad con tarifas cargadas: 'convert' | 'clear' | null. */
function askUnitChange({ fromUnit, toUnit, rates, convertible, hours }) {
  return new Promise((resolve) => {
    let choice = null;
    const from = unitById(fromUnit);
    const to = unitById(toUnit);
    const list = h(
      'ul',
      {},
      ...rates.map((r) => h('li', {}, `${r.label}: ${formatMoney(r.value)} ${from.long}${convertible ? ` → ${formatMoney(r.converted)} ${to.long}` : ''}`)),
    );
    const explanation = convertible
      ? `Podés convertirla con las ${formatNumber(hours, { decimals: 2 })} horas trabajadas por día activo (${fromUnit === 'day' ? '÷' : '×'} ${formatNumber(hours, { decimals: 2 })}, redondeado hacia arriba) o borrarla y cargarla de nuevo.`
      : 'Entre estas unidades no hay una conversión segura: borrala y cargala de nuevo en la unidad nueva.';
    const { close } = openDialog({
      title: `Cambiar la unidad a ${to.label}`,
      content: h(
        'div',
        {},
        h('p', {}, `Hay tarifas cargadas en ${from.label}. Si cambiás la unidad sin convertirlas, el mismo número se leería ${to.long} y el resultado sería engañoso.`),
        list,
        h('p', {}, explanation),
      ),
      actions: [
        button('Cancelar', { variant: 'secondary', onClick: () => close() }),
        button('Borrar la tarifa y cambiar', { variant: convertible ? 'secondary' : 'primary', onClick: () => { choice = 'clear'; close(); } }),
        convertible ? button(`Convertir a ${to.label}`, { variant: 'primary', onClick: () => { choice = 'convert'; close(); } }) : null,
      ].filter(Boolean),
      onClose: () => resolve(choice),
    });
  });
}

export function render(container, ctx) {
  const { quote, kit, settings } = ctx;
  const unit = RATE_UNITS.find((u) => u.id === quote.unit) || RATE_UNITS[0];
  const isOnCall = quote.serviceType === 'on_call';
  const knownRate = quote.pricingMode === 'known_rate';

  /**
   * Cambio de unidad (QA-E2E-08): si hay una tarifa conocida u ofrecida
   * cargada, se ofrece convertirla (día ↔ hora) o borrarla. Nunca se
   * reinterpreta el mismo número en otra unidad sin avisar.
   */
  async function changeUnit(nextUnit) {
    const fromUnit = quote.unit || 'day';
    if (nextUnit === fromUnit) return;
    const pricing = quote.pricing || {};
    const rates = [
      { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
      { path: 'offeredRateOverride', label: 'Tarifa ofrecida manual (paso Margen)', value: Number(pricing.offeredRateOverride) },
    ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
    const to = unitById(nextUnit);
    if (rates.length === 0) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
      });
      return;
    }
    const hours = quote.activity ? quote.activity.hoursPerActiveDay : null;
    rates.forEach((r) => {
      r.converted = convertRateUnit(r.value, fromUnit, nextUnit, hours);
    });
    const convertible = rates.every((r) => isFiniteNumber(r.converted));
    const choice = await askUnitChange({ fromUnit, toUnit: nextUnit, rates, convertible, hours: Number(hours) });
    if (choice === 'convert' && convertible) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        rates.forEach((r) => {
          q.pricing[r.path] = r.converted;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. ${rates.map((r) => `${r.label}: ${formatMoney(r.converted)} ${to.long}`).join(' · ')}.`, 'success');
    } else if (choice === 'clear') {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        rates.forEach((r) => {
          q.pricing[r.path] = r.path === 'knownRate' ? 0 : null;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. Se borró la tarifa: cargala de nuevo en ${to.label}.`, 'warning');
    } else {
      // Cancelado: vuelve a mostrar la unidad anterior.
      ctx.rerender();
    }
  }

  const modeCard = card(
    { title: '¿Cómo vas a cotizar?', subtitle: 'Elegí según lo que ya sabés del pedido del cliente.' },
    kit.choice('pricingMode', {
      label: 'Modo de cotización',
      options: PRICING_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
      structural: true,
    }),
    MODE_DETAILS[quote.pricingMode] ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, MODE_DETAILS[quote.pricingMode])) : null,
    choiceGroup({
      label: 'Unidad de cotización',
      name: 'unit',
      value: quote.unit,
      disabled: kit.readOnly,
      options: RATE_UNITS.map((u) => ({ value: u.id, label: u.label, hint: UNIT_HINTS[u.id] })),
      onChange: (value) => changeUnit(value),
    }),
    knownRate
      ? formGrid(
        2,
        kit.num('pricing.knownRate', {
          label: `Tarifa conocida (${unit.label})`,
          rule: 'money',
          unit: unit.label,
          requiredMark: true,
          hint: 'Tarifa de lista, antes de descuentos por días, continuidad o comerciales.',
        }),
      )
      : null,
  );

  const activityCard = card(
    { title: 'Actividad estimada', subtitle: 'Con estos datos RATEOS reparte los costos fijos entre los días que facturás.' },
    formGrid(
      2,
      kit.num('activity.activeDaysPerMonth', {
        label: '¿Cuántos días del mes esperás que el equipo esté trabajando y facturando?',
        rule: 'days',
        unit: 'días/mes',
        requiredMark: true,
        placeholder: 'Ej.: 8',
        hint: 'Días activos (facturables) estimados: es el dato con el que se reparten los costos fijos. Si no estás seguro, cargá una estimación y mirá la matriz tarifa × utilización en Resultado.',
      }),
      kit.num('activity.availableDaysPerMonth', {
        label: 'Días disponibles en el mes',
        rule: 'daysInMonth',
        unit: 'días',
        placeholder: '30',
        hint: 'Normalmente 30 para servicios 24/7; 22 si sólo trabajás días hábiles.',
      }),
      kit.num('activity.daysPerActivation', {
        label: daysPerActivationLabel(quote.serviceType),
        rule: 'positiveDays',
        unit: 'días',
        hint: 'Sirve para calcular cuántas activaciones (llamados, viajes) hay por mes.',
      }),
      kit.num('activity.hoursPerActiveDay', {
        label: 'Horas trabajadas por día activo',
        rule: 'hoursPerDay',
        unit: 'h/día',
        hint: 'Se usa para el uso de equipos, la tarifa por hora y la estructura por hora.',
      }),
    ),
    kit.stats(
      kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: 'Días activos ÷ días disponibles.' }),
      kit.stat('Activaciones por mes', (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: 'Días activos ÷ días por activación.' }),
      kit.stat('Unidades facturables por mes', (r) => unitsLabel(r.unit, r.estimate.revenue.billableUnits), {
        hint: (r) => (r.estimate.revenue.minimumCallApplied ? 'Incluye el minimum call por activación.' : `En la unidad elegida (${unit.label}).`),
      }),
    ),
  );

  const availabilityHint = quote.activity && quote.activity.availability === 'window';
  const onCallCard = isOnCall
    ? card(
      { title: 'Disponibilidad on-call', subtitle: 'Recursos reservados que se activan cuando el cliente llama.' },
      kit.choice('activity.availability', {
        label: 'Disponibilidad requerida',
        options: AVAILABILITY_OPTIONS.map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
        structural: true,
      }),
      formGrid(
        2,
        availabilityHint
          ? kit.text('activity.availabilityWindow', { label: 'Franja horaria', maxLength: 120, placeholder: 'Ej.: lunes a sábado de 7 a 19 h' })
          : null,
        kit.num('activity.responseTimeHours', {
          label: 'Tiempo máximo de respuesta',
          rule: 'hours',
          unit: 'h',
          hint: 'Desde el llamado hasta estar operativo en locación.',
        }),
      ),
    )
    : null;

  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const calcCard = knownRate
    ? card(
      { title: 'Con tu tarifa', subtitle: 'Lo que calcula RATEOS en el modo "Conozco la tarifa".' },
      kit.stats(
        kit.stat('Días mínimos para no perder (break-even)', (r) => {
          const be = r.breakEven || {};
          if (be.notApplicable) return 'No aplica';
          if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
          return formatDays(be.days);
        }, {
          hint: (r) => (r.breakEven && (r.breakEven.reason || (r.breakEven.reachable ? `${formatNumber(r.breakEven.wholeDays)} días enteros` : ''))) || '',
          trace: (r) => r.traces.breakEven,
          tone: (r) => {
            const be = r.breakEven || {};
            if (be.notApplicable || !isFiniteNumber(r.kpis.commercialListRate)) return 'gray';
            return !be.reachable || be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
          },
        }),
        kit.stat('Resultado esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatMoney(r.kpis.profit) : EMPTY), {
          trace: (r) => r.traces.expectedResult,
          tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        }),
        kit.stat('Margen esperado', (r) => (isFiniteNumber(r.kpis.commercialListRate) ? formatPercent(r.kpis.marginPct) : EMPTY), {
          hint: (r) => `Objetivo ${formatPercent(r.kpis.targetMarginPct)}`,
          tone: (r) => (!isFiniteNumber(r.kpis.commercialListRate) ? 'gray' : r.kpis.profit < 0 ? 'red' : r.kpis.belowTarget ? 'orange' : 'green'),
        }),
      ),
    )
    : card(
      {
        title: 'Tarifas necesarias con tu actividad',
        subtitle: 'Lo que calcula RATEOS en el modo "Conozco la actividad". Son tarifas DE LISTA (antes de descuentos), redondeadas hacia arriba: las que escribís en la cotización.',
      },
      kit.stats(
        kit.stat(
          (r) => (floorDisplay(r).base === 'net' ? 'Tarifa piso neta (margen 0 %)' : 'Tarifa piso de lista (margen 0 %)'),
          (r) => perUnitCeil(floorDisplay(r).value, r.unit),
          {
            trace: floorRateTrace,
            hint: (r) => {
              const net = floorDisplay(r).base === 'list' ? netRateHint(r.kpis.floorNetRate, r) : '';
              return `Sólo cubre los costos.${net ? ` ${net}` : ''}`;
            },
          },
        ),
        ...ladder.map((m) => kit.stat(`Tarifa de lista con margen ${formatPercent(m)}`, (r) => {
          const row = rateRowFor(r, m);
          return perUnitCeil(row ? row.listRate : null, r.unit);
        }, {
          hint: (r) => {
            const row = rateRowFor(r, m);
            const net = row ? netRateHint(row.netRate, r) : '';
            return `Margen sobre el precio de venta.${net ? ` ${net}` : ''}`;
          },
        })),
      ),
    );

  mount(container, modeCard, activityCard, onCallCard, calcCard);
  return { update() {} };
}
