/**
 * Etapa 1 · El servicio — Cómo se cobra (modalidad).
 * Básico: modo (conozco la tarifa / conozco la actividad), unidad, tarifa
 * conocida, días activos por mes y días por llamado (y horas por día si se
 * cobra por hora).
 * Opciones avanzadas: días disponibles, horas por día, disponibilidad on-call
 * y tiempo de respuesta (con un resumen visible de lo aplicado).
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, choiceGroup, openDialog, button } from '../../components.js';
import { PRICING_MODES, RATE_UNITS, AVAILABILITY_OPTIONS } from '../../../domain/catalogs.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace, hasNumber, stepName } from './shared.js';

const MODE_LABELS = Object.freeze({
  known_rate: 'Sí, ya tengo la tarifa',
  known_activity: 'No: calculá cuánto cobrar',
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
  if (serviceType === 'on_call') return '¿Cuántos días dura cada llamado?';
  if (serviceType === 'permanent') return 'Días entre traslados / cambio de turno';
  return 'Días por viaje o llamado';
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
      { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
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
    {},
    kit.choice('pricingMode', {
      label: '¿Ya tenés una tarifa?',
      options: PRICING_MODES.map((m) => ({ value: m.id, label: MODE_LABELS[m.id] || m.label, hint: m.hint })),
      structural: true,
    }),
    choiceGroup({
      label: '¿En qué unidad cobrás?',
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
          label: `Tu tarifa (${unit.label}, sin IVA)`,
          rule: 'money',
          unit: unit.label,
          requiredMark: true,
          hint: 'Tarifa de lista, sin IVA, antes de descuentos por días, continuidad o comerciales.',
        }),
      )
      : null,
  );

  // Horas por día activo: dato básico si cobrás por hora (define las horas facturables).
  const hoursField = () => kit.num('activity.hoursPerActiveDay', {
    label: 'Horas trabajadas por día activo',
    rule: 'hoursPerDay',
    unit: 'h/día',
    hint: quote.unit === 'hour' ? 'Cobrás por hora: se facturan días activos × horas por día.' : 'Se usa para el uso de equipos, la tarifa por hora y la estructura por hora.',
  });
  const hourly = quote.unit === 'hour';

  const activityCard = card(
    {},
    formGrid(
      hourly ? 3 : 2,
      kit.num('activity.activeDaysPerMonth', {
        label: 'Días trabajados y facturados por mes',
        rule: 'days',
        unit: 'días/mes',
        requiredMark: true,
        placeholder: 'Ej.: 8',
        hint: 'Si no estás seguro, cargá una estimación: en el Resultado ves la tarifa para otras cantidades de días.',
      }),
      kit.num('activity.daysPerActivation', {
        label: daysPerActivationLabel(quote.serviceType),
        rule: 'positiveDays',
        unit: 'días',
        hint: 'Sirve para saber cuántos llamados o viajes hay por mes.',
      }),
      hourly ? hoursField() : null,
    ),
    kit.keyline({
      label: 'Con estos datos',
      value: (r) => (hasNumber(quote.activity && quote.activity.activeDaysPerMonth) ? `${formatNumber(r.activity.activationsPerMonth, { decimals: 2 })} ${isOnCall ? 'llamados' : 'viajes o llamados'} por mes` : EMPTY),
      hint: (r) => {
        if (!hasNumber(quote.activity && quote.activity.activeDaysPerMonth)) return 'Cargá los días por mes para ver cuántos llamados y días facturás.';
        const billable = unitsLabel(r.unit, r.estimate.revenue.billableUnits);
        const extra = r.estimate.revenue.minimumCallApplied ? ' (incluye el mínimo por llamado)' : '';
        return `Facturás ${billable} por mes${extra}. Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles (utilización).`;
      },
    }),
    kit.advanced(
      {
        key: 'modality',
        summary: () => {
          const a = quote.activity || {};
          const parts = [
            isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días disponibles por mes` : 'días disponibles sin cargar',
            hourly ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día activo` : 'horas por día sin cargar',
            isOnCall ? `disponibilidad ${a.availability === 'window' ? 'por franja horaria' : '24/7'}` : null,
            isOnCall && isFiniteNumber(Number(a.responseTimeHours)) && a.responseTimeHours !== null && a.responseTimeHours !== '' ? `respuesta en ${formatNumber(Number(a.responseTimeHours), { decimals: 1 })} h` : null,
          ].filter(Boolean);
          return parts.join(' · ');
        },
      },
      formGrid(
        2,
        kit.num('activity.availableDaysPerMonth', {
          label: 'Días disponibles en el mes',
          rule: 'daysInMonth',
          unit: 'días',
          placeholder: '30',
          hint: 'Normalmente 30 para servicios 24/7; 22 si sólo trabajás días hábiles.',
        }),
        hourly ? null : hoursField(),
      ),
      isOnCall
        ? kit.group(
          'Disponibilidad on-call',
          kit.choice('activity.availability', {
            label: 'Disponibilidad requerida',
            options: AVAILABILITY_OPTIONS.map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
            structural: true,
          }),
          formGrid(
            2,
            quote.activity && quote.activity.availability === 'window'
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
        : null,
      kit.stats(
        kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: 'Días activos ÷ días disponibles.' }),
        kit.stat(isOnCall ? 'Llamados por mes' : 'Viajes o llamados por mes', (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: 'Días activos ÷ días por llamado.' }),
        kit.stat('Unidades facturables por mes', (r) => unitsLabel(r.unit, r.estimate.revenue.billableUnits), {
          hint: (r) => (r.estimate.revenue.minimumCallApplied ? 'Incluye el mínimo por llamado.' : `En la unidad elegida (${unit.label}).`),
        }),
      ),
    ),
  );

  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const calcCard = knownRate
    ? card(
      { title: 'Con tu tarifa', subtitle: 'Lo que calcula RATEOS cuando ya tenés la tarifa.' },
      kit.stats(
        kit.stat('Días mínimos para no perder (break-even)', (r) => {
          const be = r.breakEven || {};
          if (be.notApplicable) return 'No aplica';
          if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
          // 1 decimal en la superficie (6,4 días); los 2 decimales, en "Ver cálculo".
          return formatDays(be.days, { decimals: 1 });
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
    : kit.advanced(
      {
        key: 'modality-ladder',
        title: 'Ver tarifas según el margen',
        variant: 'detail',
        boxed: true,
        summary: (r) => {
          const floor = floorDisplay(r);
          return isFiniteNumber(floor.value)
            ? `Tarifa piso ${perUnitCeil(floor.value, r.unit)} y las tarifas para ganar ${ladder.map((m) => formatPercent(m)).join(', ')} sobre el precio.`
            : 'Cargá los días por mes para ver las tarifas.';
        },
      },
      h('p', { class: 'qe-note' }, 'Son tarifas DE LISTA (antes de descuentos), redondeadas hacia arriba: las que escribís en la cotización.'),
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

  mount(
    container,
    modeCard,
    kit.question('¿Cuántos días por mes esperás trabajar?', 'En servicios on-call, cuantos menos días trabajes, mayor deberá ser la tarifa para cubrir los costos fijos.', { term: 'utilización (días trabajados ÷ días disponibles)' }),
    activityCard,
    calcCard,
  );
  return { update() {} };
}
