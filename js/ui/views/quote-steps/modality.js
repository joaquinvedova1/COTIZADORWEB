/**
 * Etapa 1 · El servicio — Cuánto vas a hacer (actividad; UXR).
 *
 * La unidad de cobro y la tarifa se eligen en "Qué cotizás". Acá se carga la actividad EN LA UNIDAD QUE SE
 * COBRA y sólo se pregunta lo que aplica:
 *   $/hora (o hora-hombre/hora-equipo)  horas a facturar por mes (o días de trabajo) + horas por día
 *   $/día, jornal, día-equipo           días de trabajo por mes
 *   $/mes (abono)                       días de trabajo por mes (mueven los costos; el abono es fijo)
 *   $/m³, $/viaje, una unidad propia    cantidad a facturar por mes + rendimiento (UX-UNITS)
 *   $/llamado, $/hito                   llamados o hitos por mes + días de cada uno
 *   precio total del trabajo            días de trabajo de todo el trabajo (no se presenta como mensual)
 * "¿Trabajás a demanda?" (guardia/on-call) muestra los llamados, su duración (también distinta por llamado:
 * el mínimo se aplica a cada uno), el mínimo, el abono de disponibilidad y la disponibilidad. Sin demanda,
 * las salidas de la base sólo se preguntan si cambian algún costo (o si ya se cargaron).
 * Los días de trabajo (lo que consume personal, equipos y combustible) se derivan en el motor.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, numberField, addInfoTip, button, choiceGroup } from '../../components.js';
import { AVAILABILITY_OPTIONS } from '../../../domain/catalogs.js';
import { billingUnitOf, unitTexts } from '../../../domain/billing-units.js';
import {
  rateNumeratorsFor, loadUnitOf, rateInputOf, isNativeRate, unitsPerActiveDayFrom, quantityFromWorkdays,
  workdaysFromQuantity, quantityBasisOf,
} from '../../../domain/unit-pairs.js';
import {
  hoursInputOf, daysFromHours, demandFormOf, demandActivity, daysPerCallForQuantity, profileStats, billedCountOf,
} from '../../../domain/activity-forms.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { numberToInputText } from '../../../core/validation.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace, hasNumber, stepName } from './shared.js';
import { quantityText, quantityCeilText, workDaysText, capitalizeUnitPhrase } from '../../unit-text.js';
import { activationRoundingText } from '../../result-text.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { transportStats } from './transport.js';
import { multiMonthAssumption, multiMonthHolds } from '../../../engines/completeness-engine.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { priceComposition } from '../../../engines/price-composition-engine.js';
import { minimumCallApplies } from './unit-change.js';

/** "m³ por día de trabajo", "viajes por hora". */
function rateFormText(plural, denominator) {
  return `${plural} por ${denominator === 'hour' ? 'hora' : 'día de trabajo'}`;
}

/**
 * El dato del motor que este campo carga de otra forma (las horas del mes en lugar de los días, los llamados
 * a demanda): "Ir al campo" y los avisos en el campo lo encuentran igual.
 */
function aliasFor(field, ...paths) {
  const control = field && field.querySelector('input, select, textarea');
  if (control) control.dataset.fieldAlias = paths.join(' ');
  return field;
}

function positiveOrNull(v) {
  return isFiniteNumber(v) && v > 0 ? v : null;
}

const AVAILABILITY_HINTS = Object.freeze({
  '24/7': 'Disponible todos los días, a toda hora. Normalmente exige relevos.',
  window: 'Disponible sólo en una franja horaria acordada.',
});

/** Unidades facturables en la unidad comercial ("8 días", "160 horas", "880 horas-hombre", "10.000 m³"). */
function unitsLabel(r, value) {
  const u = r.unitInfo || {};
  if (u.resource) return quantityText(value, r);
  if (r.unit === 'hour') return `${formatNumber(value, { decimals: 2 })} horas`;
  if (r.unit === 'month') return `${formatNumber(value, { decimals: 2 })} ${Math.abs(value - 1) < 1e-9 ? 'abono' : 'abonos'}`;
  if (r.unit === 'quantity' || r.unit === 'event') return quantityText(value, r);
  return `${formatNumber(value, { decimals: 2 })} días`;
}

/** "por llamado", "por m³"… */
function perText(info) {
  return `por ${info.singular || 'unidad'}`;
}

function rateRowFor(result, marginPct) {
  return (result.ratesAtEstimate.byMargin || []).find((m) => m.marginPct === marginPct) || null;
}

let activationsMemo = { key: null, settings: null, value: false };
/**
 * ¿Las salidas de la base (días por salida) cambian algún costo o ingreso de esta cotización? Se prueba con
 * otro valor (D, costo, facturación): así cubre cualquier costo "por salida" sin una lista de reglas.
 */
function activationsMatter(quote, settings) {
  // Dos cálculos completos: se recuerda el último resultado para la misma cotización (revisión de código).
  let key = null;
  try {
    key = JSON.stringify(quote);
  } catch {
    key = null;
  }
  if (key !== null && activationsMemo.key === key && activationsMemo.settings === settings) return activationsMemo.value;
  const value = activationsDiffer(quote, settings);
  activationsMemo = { key, settings, value };
  return value;
}

function activationsDiffer(quote, settings) {
  try {
    const base = computeQuote(quote, { settings });
    const alt = structuredClone(quote);
    alt.activity = alt.activity || {};
    const dpa = Number(alt.activity.daysPerActivation) > 0 ? Number(alt.activity.daysPerActivation) : 1;
    alt.activity.daysPerActivation = dpa * 2;
    const other = computeQuote(alt, { settings });
    const diff = (a, b) => Math.abs((a || 0) - (b || 0)) > 0.5;
    return diff(base.kpis.totalCost, other.kpis.totalCost) || diff(base.kpis.revenue, other.kpis.revenue) || diff(base.kpis.floorNetRate, other.kpis.floorNetRate);
  } catch {
    return false;
  }
}

export function render(container, ctx) {
  const { quote, kit, settings } = ctx;
  const info = billingUnitOf(quote);
  const texts = unitTexts(info);
  const kind = info.kind;
  // Precio total del trabajo (UXR): la actividad es UN trabajo; los resultados son del trabajo completo.
  const jobHorizon = info.id === 'job' && quote.billingHorizon === 'job';
  // Por cantidad (m³, viajes, turnos…) o por evento (llamados, hitos): se carga en la unidad comercial.
  const byQuantity = !jobHorizon && (kind === 'quantity' || kind === 'event');
  const onDemand = quote.serviceType === 'on_call';
  const resource = info.resource || null;
  // Unidad "viaje" (PLAN-2026-012): los viajes físicos por salida = viajes por día × días por salida.
  const tripUnit = info.id === 'trip' && info.kind === 'quantity';
  const syncRouteTrips = () => {
    if (!tripUnit) return;
    const perDay = Number(kit.get('activity.unitsPerActiveDay'));
    const dpaRaw = kit.get('activity.daysPerActivation');
    const dpa = dpaRaw === null || dpaRaw === undefined || dpaRaw === '' ? 1 : Number(dpaRaw);
    if (!(Number.isFinite(perDay) && perDay > 0) || !(Number.isFinite(dpa) && dpa > 0)) return;
    ctx.update('logistics.tripsPerActivation', perDay * dpa);
  };
  // Una magnitud, un nombre por cotización: llamado / salida / trabajo… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const num = (v) => formatNumber(v, { decimals: 2 });
  const knownRate = quote.pricingMode === 'known_rate';
  const Plural = capitalizeUnitPhrase(info.plural);
  const activity = quote.activity || {};

  // Horas de trabajo por día: dato básico con $/hora (define las horas facturables) y para el uso de equipos.
  const hoursField = ({ onValue = null } = {}) => kit.num('activity.hoursPerActiveDay', {
    label: 'Horas de trabajo por día',
    rule: 'hoursPerDay',
    unit: 'h/día',
    requiredMark: kind === 'hour',
    hint: kind === 'hour' ? 'Las horas de un día de trabajo (por persona o equipo).' : 'Para el uso de equipos y la estructura por hora.',
    onValue,
  });
  const hourly = kind === 'hour';
  // Se evalúa en cada recálculo (la persona carga la cantidad sin redibujar el paso).
  const hasQuantity = () => hasNumber(quote.activity && quote.activity.billableQuantityPerMonth);


  // ---- UXR: salidas de la base. Se preguntan sólo si cambian algo (o si ya se cargaron), a demanda o por
  // llamado (ahí son los llamados). Si no, cada día de trabajo cuenta como una salida (el motor usa 1).
  const dpaStored = Number(activity.daysPerActivation);
  // Un mínimo por salida guardado en una cotización que no trabaja a demanda (cargado con la versión anterior):
  // sigue sumando, así que se muestra y se puede editar o poner en 0 (SIM-02 S1: nada oculto que sume).
  const legacyMinimum = !onDemand && Number(quote.rules && quote.rules.minimumCallUnits) > 0;
  const salidasMatter = !jobHorizon && kind !== 'event' && !onDemand
    && ((Number.isFinite(dpaStored) && dpaStored > 0 && Math.abs(dpaStored - 1) > 1e-9) || activity.fullActivations === true || legacyMinimum || activationsMatter(quote, settings));
  const showActivations = onDemand || salidasMatter || kind === 'event';

  // ---- UX-UNITS: rendimiento y cantidad del mes como unidades compuestas (sólo por cantidad).
  const composite = kind === 'quantity';
  const numerators = composite ? rateNumeratorsFor(info) : [];
  const numeratorOf = (id) => numerators.find((n) => n.id === id) || info;
  const rateIn = composite ? rateInputOf(quote.activity, info) : null;
  const basis = composite ? quantityBasisOf(quote.activity) : 'quantity';
  const workdaysValue = () => {
    const qi = quote.activity && quote.activity.quantityInput;
    return qi && typeof qi === 'object' ? positiveOrNull(Number(qi.value)) : null;
  };

  /**
   * Qué falta para tener el rendimiento, en la forma elegida (revisión UX-UNITS, H6 y N1): el número, la carga
   * por viaje o las horas por día. null si no falta nada o si es la forma de siempre (el aviso del motor vale).
   */
  function rateMissingText() {
    const current = rateInputOf(quote.activity, info);
    if (isNativeRate(current, info)) return null;
    const form = rateFormText(numeratorOf(current.numerator).plural, current.denominator);
    if (current.value === null) return `Cargá el rendimiento en ${form}`;
    const loadUnit = loadUnitOf(info, current.numerator);
    if (loadUnit && current.load === null) return `Cargá la carga por viaje (${numeratorOf(loadUnit).short} por viaje) para pasar el rendimiento a ${info.plural}`;
    if (current.denominator === 'hour' && current.hours === null) return `Cargá las horas ${info.id === 'km' ? 'de marcha' : 'productivas'} por día para pasar el rendimiento a días de trabajo`;
    return null;
  }
  let rateFieldEl = null;
  const syncRateIssue = () => {
    if (!rateFieldEl) return;
    const missing = rateMissingText();
    if (missing) rateFieldEl.dataset.issueMessage = `${missing}: sin eso no se pueden calcular los días de trabajo ni los costos.`;
    else delete rateFieldEl.dataset.issueMessage;
  };

  /** Marca de obligatorio (como kit.num con requiredMark). */
  const markRequired = (el) => {
    const label = el.querySelector('.field-label');
    if (label) label.appendChild(h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));
    const input = el.querySelector('input');
    if (input) input.setAttribute('aria-required', 'true');
    return el;
  };

  /** Selector chico al lado del número ("m³ ▾", "día de trabajo ▾"). */
  const miniSelect = ({ name, label, value, options, onChange }) => {
    const select = h(
      'select',
      { name, 'aria-label': label, disabled: kit.readOnly },
      ...options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
    );
    select.addEventListener('change', () => onChange(select.value));
    return h('div', { class: 'field-control qe-mini-select' }, select);
  };

  /** Pone el número y su unidad en la misma fila: [número] [numerador ▾] / [denominador ▾]. */
  const withUnitControls = (field, ...controls) => {
    const control = field.querySelector('.field-control');
    if (!control) return field;
    const row = h('div', { class: 'qe-compound' });
    control.replaceWith(row);
    row.append(control, h('div', { class: 'qe-compound-unit' }, ...controls.filter(Boolean)));
    return field;
  };

  /**
   * Guarda lo cargado y recalcula los datos que lee el motor: el rendimiento por
   * día de trabajo y, si la cantidad se cargó en días de trabajo, la cantidad del
   * mes. En la forma de siempre no se guarda nada nuevo (mismo dato que K0).
   */
  function writeRate(next) {
    const native = isNativeRate(next, info);
    const perDay = native ? positiveOrNull(next.value) : unitsPerActiveDayFrom(next, info);
    if (native) {
      if (quote.activity && quote.activity.rateInput) ctx.update('activity.rateInput', null);
    } else {
      ctx.update('activity.rateInput', { value: next.value, numerator: next.numerator, denominator: next.denominator, load: next.load, hours: next.hours });
    }
    ctx.update('activity.unitsPerActiveDay', native ? next.value : perDay);
    // La forma de la cantidad es la de este dibujo (se cambia sólo con changeBasis, que redibuja).
    if (basis === 'workdays') ctx.update('activity.billableQuantityPerMonth', quantityFromWorkdays(workdaysValue(), perDay));
    syncRouteTrips();
    syncRateIssue();
  }

  /**
   * Otro numerador o denominador: el número se carga de nuevo (20 m³ por día no
   * pasan a ser 20 viajes por día). La carga por viaje y las horas se conservan
   * si siguen valiendo; las horas arrancan con las de la cotización.
   */
  function changeRateForm(patch) {
    const next = { ...rateIn, ...patch, value: null };
    if (next.numerator === rateIn.numerator && next.denominator === rateIn.denominator) return;
    if (loadUnitOf(info, next.numerator) !== loadUnitOf(info, rateIn.numerator)) next.load = null;
    // Las horas por día no se suponen (revisión UX-UNITS, H2): con todas las horas trabajadas, una velocidad en
    // km/h daría más km de los que se recorren. Se piden, como el número.
    if (next.denominator !== 'hour') next.hours = null;
    const before = rateIn.value !== null ? ` Antes: ${num(rateIn.value)} ${rateFormText(numeratorOf(rateIn.numerator).plural, rateIn.denominator)}.` : '';
    ctx.mutate((q) => {
      if (!q.activity) q.activity = {};
      if (isNativeRate(next, info)) {
        if (q.activity.rateInput) q.activity.rateInput = null;
      } else {
        q.activity.rateInput = { value: null, numerator: next.numerator, denominator: next.denominator, load: next.load, hours: next.hours };
      }
      q.activity.unitsPerActiveDay = null;
      if (basis === 'workdays') q.activity.billableQuantityPerMonth = null;
    }, { focus: 'activity.unitsPerActiveDay' });
    ctx.toast(`Cargá el rendimiento en ${rateFormText(numeratorOf(next.numerator).plural, next.denominator)}.${before}`, 'info');
  }

  /** Rendimiento: [número] [m³ | viajes ▾] / [día de trabajo | hora ▾] (+ carga por viaje u horas, si hacen falta). */
  function rateFields() {
    const loadUnit = loadUnitOf(info, rateIn.numerator);
    const hourly = rateIn.denominator === 'hour';
    const form = rateFormText(numeratorOf(rateIn.numerator).plural, rateIn.denominator);
    const why = 'Con esto se calculan los días de trabajo, que mueven los costos.';
    let rateHint = `Lo que hacés en ${hourly ? 'una hora' : 'un día de trabajo'}. ${why}`;
    if (info.id === 'km' && hourly) rateHint = `Velocidad promedio con paradas, no la máxima. ${why}`;
    else if (tripUnit && rateIn.numerator === 'trip' && !hourly) rateHint = `Viajes que hacés en un día de trabajo. ${why}`;
    const field = markRequired(numberField({
      label: 'Rendimiento',
      name: 'activity.unitsPerActiveDay',
      rule: 'quantity',
      value: rateIn.value,
      placeholder: hourly ? (info.id === 'km' ? 'Ej.: 50' : 'Ej.: 2') : rateIn.numerator === 'trip' ? 'Ej.: 2' : 'Ej.: 500',
      hint: rateHint,
      disabled: kit.readOnly,
      onChange: (v) => {
        rateIn.value = v;
        writeRate(rateIn);
      },
    }));
    // El lector de pantalla no lee los selectores de al lado al entrar al número: la unidad va en el rótulo (GOV.UK).
    const label = field.querySelector('.field-label');
    if (label) label.insertBefore(h('span', { class: 'sr-only' }, ` (${form})`), label.querySelector('.req'));
    // El aviso del motor ("Cargá cuántos m³ hacés por día de trabajo") habla de la forma nativa: con otra, dice
    // lo que falta en la elegida (el número, la carga por viaje o las horas) y se actualiza al cargar.
    rateFieldEl = field;
    syncRateIssue();
    withUnitControls(
      field,
      numerators.length > 1
        ? miniSelect({ name: 'activity.rateInput.numerator', label: 'Unidad del rendimiento', value: rateIn.numerator, options: numerators.map((n) => ({ value: n.id, label: n.plural })), onChange: (v) => changeRateForm({ numerator: v }) })
        : h('span', { class: 'qe-compound-fixed' }, info.plural),
      h('span', { class: 'qe-compound-sep', 'aria-hidden': 'true' }, '/'),
      miniSelect({ name: 'activity.rateInput.denominator', label: 'Rendimiento por', value: rateIn.denominator, options: [{ value: 'day', label: 'día de trabajo' }, { value: 'hour', label: 'hora' }], onChange: (v) => changeRateForm({ denominator: v }) }),
    );
    addInfoTip(field, tripUnit
      ? `Los días de trabajo son lo que consume personal, equipos y combustible; con el rendimiento también salen los viajes ${T.per}, y los km del mes salen de los viajes que facturás.`
      : 'Los días de trabajo son lo que consume personal, equipos y combustible. Podés cargarlo por día o por hora; el resultado se calcula por día de trabajo.');
    const loadField = loadUnit
      ? markRequired(numberField({
        label: 'Carga por viaje',
        name: 'activity.rateInput.load',
        rule: 'quantity',
        unit: `${numeratorOf(loadUnit).short}/viaje`,
        value: rateIn.load,
        placeholder: 'Ej.: 20',
        hint: info.id === 'trip' ? `Para pasar ${numeratorOf(loadUnit).plural} a viajes.` : `Para pasar viajes a ${info.plural}.`,
        disabled: kit.readOnly,
        onChange: (v) => {
          rateIn.load = v;
          writeRate(rateIn);
        },
      }))
      : null;
    const hoursInput = rateIn.denominator === 'hour'
      ? markRequired(numberField({
        label: info.id === 'km' ? 'Horas de marcha por día' : 'Horas productivas por día',
        name: 'activity.rateInput.hours',
        rule: 'hoursPerDay',
        unit: 'h/día',
        value: rateIn.hours,
        placeholder: 'Ej.: 6',
        // SIM-02 (S2 P3-3): no se copia sola (productivas ≤ trabajadas), pero se dice cuántas tiene el día.
        hint: info.id === 'km'
          ? 'Sólo las horas manejando: sin carga, espera ni descarga.'
          : Number(quote.activity.hoursPerActiveDay) > 0
            ? `Las horas del día de trabajo en que rendís eso. Si rendís todas, son ${numberToInputText(quote.activity.hoursPerActiveDay)} (las del día de trabajo).`
            : 'Las horas del día de trabajo en que rendís eso.',
        disabled: kit.readOnly,
        onChange: (v) => {
          rateIn.hours = v;
          writeRate(rateIn);
        },
      }))
      : null;
    if (hoursInput && info.id === 'km') addInfoTip(hoursInput, 'La velocidad (km/h) no se factura: se facturan los km recorridos. Con las horas de marcha se pasa a km por día de trabajo.');
    // La equivalencia en la unidad del motor, a la vista: "= 20 m³ por día de trabajo".
    const equivalence = kit.out(() => {
      const current = rateInputOf(quote.activity, info);
      if (isNativeRate(current, info)) return '';
      const perDay = unitsPerActiveDayFrom(current, info);
      if (perDay !== null) {
        // km por hora con TODAS las horas trabajadas: casi nunca se maneja el día entero (H2).
        const allDay = info.id === 'km' && current.denominator === 'hour' && current.hours !== null && Math.abs(current.hours - Number(quote.activity && quote.activity.hoursPerActiveDay)) < 1e-9;
        const equal = `= ${num(perDay)} ${rateFormText(info.plural, 'day')}`;
        return allDay
          ? [equal, '. ', h('strong', { class: 'qe-warn-inline' }, 'Ojo: son todas las horas del día de trabajo; si hay carga, espera o descarga, las horas de marcha son menos.')]
          : equal;
      }
      if (current.value === null) return '';
      return `${rateMissingText() || 'Falta un dato para pasarlo a días de trabajo'}.`;
    }, { tag: 'p', className: 'qe-note qe-rate-equiv', allowEmpty: true });
    return [field, equivalence, loadField || hoursInput ? formGrid(2, loadField, hoursInput) : null];
  }

  /** Cantidad del mes: [número] [m³ por mes | días de trabajo por mes ▾]. */
  function quantityField() {
    const workdays = basis === 'workdays';
    const field = markRequired(numberField({
      label: workdays ? 'Días de trabajo por mes' : `${Plural} a facturar por mes`,
      name: 'activity.billableQuantityPerMonth',
      rule: workdays ? 'days' : 'quantity',
      value: workdays ? workdaysValue() : quote.activity && quote.activity.billableQuantityPerMonth,
      placeholder: workdays ? 'Ej.: 10' : 'Ej.: 10.000',
      hint: workdays ? `La cantidad del mes es días de trabajo × rendimiento (en ${info.plural}).` : 'Una estimación alcanza: en el Resultado ves otras cantidades.',
      disabled: kit.readOnly,
      onChange: (v) => {
        if (workdays) {
          ctx.update('activity.quantityInput', { basis: 'workdays', value: v });
          ctx.update('activity.billableQuantityPerMonth', quantityFromWorkdays(v, quote.activity && quote.activity.unitsPerActiveDay));
        } else {
          ctx.update('activity.billableQuantityPerMonth', v);
        }
      },
    }));
    return withUnitControls(field, miniSelect({
      name: 'activity.quantityInput.basis',
      label: 'Cargás la cantidad en',
      value: basis,
      options: [{ value: 'quantity', label: `${info.plural} por mes` }, { value: 'workdays', label: 'días de trabajo por mes' }],
      onChange: (v) => changeBasis(v),
    }));
  }

  /**
   * Cambia cómo se carga la cantidad del mes. Se pasa con el rendimiento que
   * cargó la persona (200 m³ ÷ 20 m³ por día = 10 días); sin rendimiento, queda
   * sin cargar. La cantidad que lee el motor no cambia hasta que se edite.
   */
  function changeBasis(next) {
    if (next === basis) return;
    const perDay = quote.activity && quote.activity.unitsPerActiveDay;
    ctx.mutate((q) => {
      if (!q.activity) q.activity = {};
      if (next === 'workdays') q.activity.quantityInput = { basis: 'workdays', value: workdaysFromQuantity(q.activity.billableQuantityPerMonth, perDay) };
      else if (q.activity.quantityInput) q.activity.quantityInput = null;
    }, { focus: 'activity.billableQuantityPerMonth' });
  }

  /** Actividad por cantidad (m³, viajes…) o por evento (llamados, trabajos, hitos). */
  function quantityFields() {
    if (kind === 'event') {
      const isCall = info.id === 'call';
      const isMilestone = info.id === 'milestone';
      return formGrid(
        isMilestone ? 3 : 2,
        kit.num('activity.billableQuantityPerMonth', {
          label: `${Plural} por mes`,
          rule: 'quantity',
          unit: texts.perMonth,
          requiredMark: true,
          placeholder: isCall ? 'Ej.: 6' : 'Ej.: 1',
          hint: isCall
            ? 'Llamados que esperás facturar en el mes. Si no estás seguro, cargá una estimación.'
            : isMilestone
              ? 'Hitos que esperás facturar en el mes.'
              : 'Trabajos que esperás terminar y facturar en el mes (0,5 = uno cada dos meses).',
        }),
        kit.num('activity.daysPerActivation', {
          label: `¿Cuántos días de trabajo lleva ${T.each}?`,
          rule: 'positiveDays',
          unit: 'días',
          requiredMark: true,
          hint: 'Con esto se calculan los días de trabajo del mes.',
        }),
        isMilestone
          ? kit.num('activity.unitsPerActivation', {
            label: 'Hitos por trabajo',
            rule: 'positive',
            unit: 'hitos',
            placeholder: 'Ej.: 3',
            hint: 'En cuántas partes facturás cada trabajo (por ejemplo: anticipo, avance y entrega).',
          })
          : null,
      );
    }
    // Cada campo compuesto en su fila: "[200] [m³ por mes ▾]" y "[20] [m³ ▾] / [día de trabajo ▾]" no se parten.
    const [rate, equivalence, extra] = rateFields();
    return h('div', { class: 'qe-quantity-fields' }, quantityField(), rate, equivalence, extra);
  }
  /** "200 m³ × $ 45.000 por m³ = $ 9.000.000 por mes" (la cantidad × la tarifa, con los números del motor). */
  const revenueLine = (r) => {
    const rev = r.estimate && r.estimate.revenue;
    if (!rev || !isFiniteNumber(r.kpis.commercialListRate) || !(rev.billableUnits > 0)) return '';
    const net = Math.abs((rev.discountFactor ?? 1) - 1) > 1e-9;
    const total = isFiniteNumber(rev.total) && rev.total > rev.components.base + 0.5 ? ` Con los otros cargos del mes (espera, abono, km, movilización…), la facturación total es ${formatMoney(rev.total)}.` : '';
    return `${unitsLabel(r, rev.billableUnits)} × ${formatMoney(rev.netRate, { decimals: rev.netRate < 100 ? 2 : 0 })} ${perText(info)}${net ? ' (neta)' : ''} = ${formatMoney(rev.components.base)} por mes.${total}`;
  };

  /** La explicación de la línea clave en renglones: actividad, facturación y uso de los días. */
  const lines = (...items) => h('span', { class: 'qe-keyline-lines' }, ...items.filter(Boolean).map((t) => h('span', { class: 'qe-keyline-line' }, t)));

  /** Salidas fraccionarias: el costo por salida (movilización…) es un PROMEDIO. */
  const fractionalText = (r) => {
    const acts = r.activity.activationsPerMonth;
    if (!(acts > 0) || Math.abs(acts - Math.round(acts)) <= 1e-6) return '';
    return r.activationRounding && r.activationRounding.enabled
      ? ` Son ${num(acts)} ${T.many} promedio por mes; los costos ${T.per} se cuentan con ${T.many} ${T.wholeMany} (abajo).`
      : ` Son ${num(acts)} ${T.many} promedio por mes: la movilización y los costos ${T.per} se calculan como promedio (abajo podés contar ${T.each} ${T.whole}).`;
  };

  // V-1 (VALIDACIONES-01; SIM-01, RFQ-12): más días de trabajo que disponibles (fuera del abono). Se
  // revisa el dato o se confirma que es un trabajo de más de un mes; la confirmación queda atada a esos
  // días (multiMonthAssumption) y no cambia el costo.
  const multiMonthPending = (r) => ((r && r.completeness && r.completeness.pending) || []).some((x) => x.id === 'multi_month');
  const multiMonthBanner = kind === 'month' ? null : h('div', { class: 'qe-coverage-confirm-wrap qe-multi-month' },
    kit.toggle(h('div', { class: 'banner banner-warning qe-coverage-confirm', role: 'status' },
      kit.out((r) => {
        if (!multiMonthPending(r)) return '';
        const a = r.activity;
        return h('div', {}, h('strong', {}, '¿Es un trabajo de más de un mes? '),
          `${num(a.activeDaysPerMonth)} días de trabajo no entran en un mes de ${num(a.availableDaysPerMonth)}. Confirmalo para usar esta tarifa, o revisá ${byQuantity ? 'la cantidad o el rendimiento' : 'los días de trabajo'}.`);
      }, { tag: 'div', allowEmpty: true }),
      ctx.readOnly ? null : h('div', { class: 'qe-toolbar' },
        kit.action('Revisar el dato', () => ctx.focusField(byQuantity ? 'activity.billableQuantityPerMonth' : 'activity.activeDaysPerMonth'), { icon: 'edit' }),
        kit.action('Es un trabajo de más de un mes', () => ctx.mutate((q) => { q.activity = q.activity || {}; q.activity.multiMonthConfirmed = multiMonthAssumption(q); }), { icon: 'check' }))),
    multiMonthPending),
    kit.toggle(h('div', { class: 'banner banner-info qe-coverage-confirm is-confirmed', role: 'status' },
      h('div', {}, h('strong', {}, 'Confirmado: es un trabajo de más de un mes. '), 'Si cambian los días de trabajo o los disponibles, se vuelve a preguntar.'),
      ctx.readOnly ? null : h('div', { class: 'qe-toolbar' }, kit.action('Revisar', () => ctx.mutate((q) => { if (q.activity) delete q.activity.multiMonthConfirmed; }), { icon: 'edit' }))),
    (r) => !multiMonthPending(r) && Boolean(r && r.activity) && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 && multiMonthHolds(ctx.quote || quote)));

  const quantityKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => {
      if (!hasQuantity() || !(r.activity.activeDaysPerMonth > 0)) return EMPTY;
      // Lo que no cargó la persona es lo que se calcula: días de trabajo o cantidad del mes.
      return basis === 'workdays' ? `${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes` : `${workDaysText(r.activity.activeDaysPerMonth)} por mes`;
    },
    hint: (r) => {
      if (!hasQuantity()) {
        return basis === 'workdays' ? 'Cargá los días de trabajo y el rendimiento para ver la cantidad del mes.' : `Cargá ${texts.los} ${info.plural} por mes para ver cuántos días de trabajo lleva.`;
      }
      if (!(r.activity.activeDaysPerMonth > 0)) {
        if (kind !== 'quantity') return 'Cargá cuántos días de trabajo lleva cada uno.';
        const missing = rateMissingText();
        // "Cargá la carga por viaje … para pasar el rendimiento a viajes" ya dice para qué: no se agrega otro "para".
        if (missing) return / para /.test(missing) ? `${missing}.` : `${missing} para calcular los días de trabajo.`;
        return `Cargá ${texts.cuantos} ${info.plural} hacés por día de trabajo para calcular los días de trabajo.`;
      }
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      const over = r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9
        ? ` Ojo: son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} disponibles del mes.`
        : '';
      const perDay = r.activity.unitsPerActiveDay;
      // La cadena en el sentido en que se cargó: cantidad ÷ rendimiento = días, o rendimiento × días = cantidad.
      let chain;
      if (kind === 'quantity' && isFiniteNumber(perDay) && perDay > 0) {
        const rateText = `${quantityText(perDay, r)} por día`;
        chain = basis === 'workdays'
          ? `${rateText} × ${workDaysText(r.activity.activeDaysPerMonth)} = ${billable} por mes${extra}.`
          : `${billable} ÷ ${rateText} = ${workDaysText(r.activity.activeDaysPerMonth)}${extra}.`;
      } else {
        chain = `Facturás ${billable} por mes${extra} en ${workDaysText(r.activity.activeDaysPerMonth)}.`;
      }
      // Por intervención (PLAN-2026-010): volumen ↔ días ↔ movilización.
      const acts = r.activity.activationsPerMonth;
      // UXR: las salidas sólo se nombran si importan (a demanda, o si cambian algún costo).
      const perIntervention = kind === 'quantity' && acts > 0 && showActivations
        ? ` ${quantityText(r.estimate.revenue.billableUnits / acts, r)} ${T.per} · ${num(acts)} ${T.word(acts)} por mes.`
        : '';
      return lines(chain, revenueLine(r), `Ocupás ${formatDays(r.activity.activeDaysPerMonth, { decimals: 1 })} de ${num(r.activity.availableDaysPerMonth)} disponibles (${formatPercent(r.activity.utilizationPct)}).${perIntervention}${showActivations ? fractionalText(r) : ''}${over}`);
    },
    tone: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
  });

  // ---- $/hora: horas a facturar por mes (o días de trabajo) + horas por día (+ personas o equipos).
  const hoursIn = hourly ? hoursInputOf(activity) : null;
  // Sin datos de días todavía, se carga en horas (lo natural cobrando por hora).
  const hoursBasis = hourly && !onDemand && (hoursIn !== null || !hasNumber(activity.activeDaysPerMonth)) ? 'hours' : 'days';
  const count = () => billedCountOf(ctx.quote ? ctx.quote.activity || {} : activity);
  const resourceWord = resource === 'person' ? 'personas' : 'equipos';

  /** Recalcula los días con las horas cargadas (al cambiar las horas, las horas por día o las personas). */
  function syncDaysFromHours() {
    const a = (ctx.quote && ctx.quote.activity) || activity;
    const input = a.hoursInput && Number(a.hoursInput.value);
    if (!(input > 0)) return;
    const D = daysFromHours(input, a.hoursPerActiveDay, billedCountOf(a));
    if (D !== null) ctx.update('activity.activeDaysPerMonth', D);
  }

  /** Personas o equipos que se facturan en paralelo (hora-hombre, jornal, día-equipo, equipo-mes). */
  const resourceField = resource
    ? addInfoTip(kit.num('activity.billedResources', {
      label: resource === 'person' ? 'Personas que facturan en paralelo' : 'Equipos que facturan en paralelo',
      rule: 'positive',
      unit: resourceWord,
      requiredMark: true,
      placeholder: 'Ej.: 4',
      hint: resource === 'person'
        ? `Cada una factura sus ${info.plural}: 4 personas × 10 h = 40 ${info.plural} por día.`
        : `Cada uno factura sus ${info.plural}.`,
      // Se conserva el número que escribió la persona y cambia el que se calcula (SIM-02 ronda 2, P0): cargando
      // en horas-hombre del mes, cambian los días; cargando en días, cambian las horas-hombre.
      onValue: () => {
        if (hoursBasis === 'hours') syncDaysFromHours();
        syncDemand();
      },
    }), `No es la cantidad de personal cargado en "${stepName('labor')}": es cuántos ${resourceWord} le cobrás al cliente al mismo tiempo. Si el personal cargado es otro número, revisalo.`)
    : null;

  /** [número] [horas por mes ▾ | días de trabajo por mes]. */
  function hoursActivityField() {
    const byHours = hoursBasis === 'hours';
    const field = numberField({
      label: byHours ? `${Plural} a facturar por mes` : 'Días de trabajo por mes',
      name: byHours ? 'activity.hoursInput.value' : 'activity.activeDaysPerMonth',
      rule: byHours ? 'quantity' : 'days',
      value: byHours ? hoursIn : activity.activeDaysPerMonth,
      placeholder: byHours ? 'Ej.: 160' : 'Ej.: 20',
      hint: byHours ? 'Una estimación alcanza: en el Resultado ves otras cantidades.' : `Los días se multiplican por las horas por día${resource ? ` y por ${resourceWord}` : ''}.`,
      disabled: kit.readOnly,
      onChange: (v) => {
        if (byHours) {
          ctx.update('activity.hoursInput', v === null ? null : { value: v });
          const a = ctx.quote.activity || {};
          // Sin horas por día no se pueden calcular los días: se conservan hasta que se carguen (revisión de código).
          const D = v === null ? null : daysFromHours(v, a.hoursPerActiveDay, billedCountOf(a));
          if (v === null || D !== null) ctx.update('activity.activeDaysPerMonth', D);
        } else {
          ctx.update('activity.activeDaysPerMonth', v);
        }
      },
    });
    const label = field.querySelector('.field-label');
    if (label) label.appendChild(h('span', { class: 'req', 'aria-hidden': 'true' }, ' *'));
    const control = field.querySelector('.field-control');
    if (control) {
      const select = h('select', { name: 'activity.hoursBasis', 'aria-label': 'Cargás la actividad en', disabled: kit.readOnly },
        h('option', { value: 'hours', selected: byHours }, `${info.plural} por mes`),
        h('option', { value: 'days', selected: !byHours }, 'días de trabajo por mes'));
      select.addEventListener('change', () => {
        ctx.mutate((q) => {
          q.activity = q.activity || {};
          const a = q.activity;
          if (select.value === 'hours') {
            const D = Number(a.activeDaysPerMonth);
            const H = Number(a.hoursPerActiveDay);
            a.hoursInput = D > 0 && H > 0 ? { value: Number((D * H * billedCountOf(a)).toPrecision(12)) } : null;
          } else {
            a.hoursInput = null;
          }
        }, { focus: select.value === 'hours' ? 'activity.hoursInput.value' : 'activity.activeDaysPerMonth' });
      });
      const row = h('div', { class: 'qe-compound' });
      control.replaceWith(row);
      row.append(control, h('div', { class: 'qe-compound-unit' }, h('div', { class: 'field-control qe-mini-select' }, select)));
    }
    if (byHours) aliasFor(field, 'activity.activeDaysPerMonth');
    return field;
  }

  /** "Cada llamado se cuenta completo" (PLAN-2026-011): con salidas de la base o a demanda. */
  function fullActivationsBlock() {
    return h('div', { class: 'qe-full-activations' },
      addInfoTip(kit.check('activity.fullActivations', {
        label: `${T.Each} se cuenta ${T.whole}`,
        hint: 'Para costos que no se dividen: movilización, peajes, viáticos.',
      }), `Apagada, ${T.theMany} ${T.many} por mes son un promedio (por ejemplo 10,42) y los costos ${T.per} se cuentan en proporción. Encendida, esos costos se costean con ${T.many} ${T.wholeMany} (11). Sueldos, tenencia de equipos, producción, facturación y estructura mensual no cambian.`),
      kit.out((r) => {
        const note = activationRoundingText(r.activationRounding, T);
        if (!note) return '';
        return h('p', { class: ['qe-note', note.tone === 'warning' ? 'is-warning' : null] }, note.text);
      }, { tag: 'div', allowEmpty: true }));
  }

  // ---- A demanda (guardia / on-call): llamados, su duración (o distinta por llamado), mínimo, abono y
  // disponibilidad. Con $/hora, $/día o $/mes los días de trabajo salen de los llamados.
  const demand = onDemand ? demandFormOf(activity, kind) : null;
  const callUnits = hourly ? 'horas' : 'días';
  const demandByProfile = Boolean(demand && demand.distinct);
  // Lo que se cargó en esta pantalla (llamados, duración, perfil): se escribe todo junto en los datos del motor.
  const form = {
    calls: demand ? demand.calls : null,
    perCall: demand ? demand.perCall : null,
    // Duraciones distintas elegidas pero sin lista válida todavía: arranca con una fila (los llamados y la
    // duración promedio, si ya estaban).
    profile: demand && demand.profile.length ? demand.profile.map((x) => ({ ...x })) : demandByProfile ? [{ count: demand.calls, units: demand.perCall }] : [],
    distinct: demandByProfile,
  };
  function syncDemand() {
    if (!onDemand) return;
    const a = ctx.quote.activity || {};
    if (kind === 'quantity') {
      const dpa = daysPerCallForQuantity({ quantity: a.billableQuantityPerMonth, unitsPerActiveDay: a.unitsPerActiveDay, calls: form.calls });
      ctx.update('activity.callsPerMonth', form.calls);
      if (dpa !== null) {
        ctx.update('activity.daysPerActivation', dpa);
        syncRouteTrips();
      }
      return;
    }
    if (kind === 'event') return;
    const next = demandActivity({ kind: hourly ? 'hour' : 'day', calls: form.calls, perCall: form.perCall, profile: form.distinct ? form.profile : null, hoursPerDay: a.hoursPerActiveDay });
    ctx.update('activity.callsPerMonth', form.distinct ? profileStats(form.profile).calls : form.calls);
    if (!next) return;
    ctx.update('activity.activeDaysPerMonth', next.activeDaysPerMonth);
    ctx.update('activity.daysPerActivation', next.daysPerActivation);
    ctx.update('activity.activationProfile', next.activationProfile);
  }

  /** Llamados de distinta duración: [cantidad] llamados de [horas] h, con agregar y quitar. */
  function profileEditor() {
    const rows = h('div', { class: 'qe-profile-rows' });
    const total = kit.out(() => {
      const s = profileStats(form.profile);
      if (!(s.calls > 0)) return `Cargá cuántos ${T.many} duran cuánto.`;
      return `${num(s.calls)} ${T.many} por mes · ${num(s.mean)} ${callUnits} en promedio.`;
    }, { tag: 'p', className: 'qe-note' });
    const draw = () => {
      rows.replaceChildren(...form.profile.map((item, i) => h('div', { class: 'qe-profile-row' },
        (i === 0 ? (f) => aliasFor(f, 'activity.activeDaysPerMonth', 'activity.daysPerActivation') : (f) => f)(numberField({ label: T.Many, name: `activity.activationProfile.${i}.count`, rule: 'positive', value: item.count, unit: 'por mes', disabled: kit.readOnly, onChange: (v) => { form.profile[i].count = v; syncDemand(); } })),
        numberField({ label: hourly ? "De cuántas horas" : "De cuántos días", name: `activity.activationProfile.${i}.units`, rule: 'positive', value: item.units, unit: hourly ? 'h' : 'días', disabled: kit.readOnly, onChange: (v) => { form.profile[i].units = v; syncDemand(); } }),
        kit.readOnly || form.profile.length <= 1 ? null : button('Quitar', { variant: 'link', size: 'sm', onClick: () => { form.profile.splice(i, 1); draw(); syncDemand(); } }),
      )));
    };
    draw();
    return h('div', { class: 'qe-profile' },
      rows,
      kit.readOnly ? null : button('Agregar otra duración', { variant: 'secondary', size: 'sm', icon: 'plus', onClick: () => { form.profile.push({ count: null, units: null }); draw(); } }),
      total);
  }

  function demandBody() {
    if (!onDemand) return null;
    const parts = [];
    // Con duraciones distintas los llamados del mes salen de la lista (se ven en su total).
    if (kind !== 'event' && !form.distinct) {
      const callsField = numberField({
        label: `${T.Many} por mes`,
        name: 'activity.callsPerMonth',
        rule: 'positive',
        value: form.calls,
        unit: `${T.many}/mes`,
        placeholder: 'Ej.: 8',
        hint: `Una estimación alcanza: en el Resultado ves qué pasa con más o menos ${T.many}.`,
        disabled: kit.readOnly,
        onChange: (v) => { form.calls = v; syncDemand(); },
      });
      parts.push(aliasFor(callsField, 'activity.activeDaysPerMonth'));
    }
    if (kind === 'hour' || kind === 'day' || kind === 'month') {
      const durationChoice = choiceGroup({
        label: `¿Cuánto dura ${T.each}?`,
        name: 'activity.callDurationForm',
        value: form.distinct ? 'distinct' : 'same',
        disabled: kit.readOnly,
        options: [
          { value: 'same', label: 'Todos duran parecido', hint: `Cargás la duración promedio en ${callUnits}.` },
          { value: 'distinct', label: 'Duran distinto', hint: `Cargás cuántos ${T.many} duran cuánto: el mínimo se aplica a ${T.each}.` },
        ],
        onChange: (v) => {
          ctx.mutate((q) => {
            q.activity = q.activity || {};
            q.activity.callDurationForm = v;
            // Una sola fila con los llamados y la duración de antes: el mismo promedio (no cambia ninguna cifra).
            const n = form.calls > 0 ? form.calls : null;
            const u = form.perCall > 0 ? form.perCall : null;
            q.activity.activationProfile = v === 'distinct' && n !== null && u !== null ? [{ count: n, units: u }] : null;
          }, { focus: 'activity.callDurationForm' });
        },
      });
      parts.push(durationChoice);
      if (form.distinct) {
        parts.push(profileEditor());
      } else {
        parts.push(aliasFor(numberField({
          label: `${hourly ? 'Horas' : 'Días'} ${T.per} (promedio)`,
          name: 'activity.perCall',
          rule: 'positive',
          value: form.perCall,
          unit: hourly ? 'h' : 'días',
          placeholder: hourly ? 'Ej.: 4' : 'Ej.: 2',
          hint: `Lo que se trabaja en ${T.each}, en promedio.`,
          disabled: kit.readOnly,
          onChange: (v) => { form.perCall = v; syncDemand(); },
        }), 'activity.daysPerActivation'));
      }
    }
    if (minimumCallApplies(kind)) {
      parts.push(addInfoTip(kit.num('rules.minimumCallUnits', {
        label: `Mínimo ${T.per} (opcional)`,
        rule: 'quantity',
        unit: hourly ? 'h' : kind === 'day' ? 'días' : info.plural,
        hint: 'Se factura aunque se trabaje menos.',
      }), form.distinct ? `Se aplica a ${T.each} de la lista.` : `Se aplica ${T.a === 'una' ? 'a la' : 'al'} ${T.one} promedio. Si ${T.theMany} ${T.many} duran distinto, elegí "Duran distinto": así el mínimo se aplica a ${T.each}.`));
    }
    parts.push(kit.num('rules.availabilityFeeMonthly', {
      label: 'Abono de disponibilidad por mes (opcional)',
      rule: 'money',
      unit: '$/mes',
      hint: 'Lo que cobrás por estar disponible, además de lo que se trabaja.',
    }));
    // A demanda también hay costos por llamado (movilización, peajes): si cambian algo, se puede contar cada
    // llamado completo (antes estaba en "Cómo se cobra" para todos los on-call).
    const perCallCostsMatter = activity.fullActivations === true || activationsMatter(quote, settings);
    return h('div', { class: 'qe-demand-body' },
      formGrid(2, ...parts.filter(Boolean)),
      perCallCostsMatter ? fullActivationsBlock() : null,
      kit.group('Disponibilidad',
        kit.choice('activity.availability', {
          label: 'Disponibilidad requerida',
          options: AVAILABILITY_OPTIONS.map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
          structural: true,
        }),
        formGrid(2,
          activity.availability === 'window'
            ? kit.text('activity.availabilityWindow', { label: 'Franja horaria', maxLength: 120, placeholder: 'Ej.: lunes a sábado de 7 a 19 h' })
            : null,
          kit.num('activity.responseTimeHours', { label: 'Tiempo máximo de respuesta', rule: 'hours', unit: 'h', hint: 'Desde que te llaman hasta estar operativo en la locación.' }))));
  }

  const demandCard = jobHorizon
    ? null
    : card(
      { className: 'qe-demand-card' },
      choiceGroup({
        label: '¿Trabajás a demanda?',
        name: 'serviceOnDemand',
        value: onDemand ? 'yes' : 'no',
        disabled: kit.readOnly,
        options: [
          { value: 'no', label: 'No', hint: 'Trabajo planificado o continuo.' },
          { value: 'yes', label: 'Sí, el cliente llama y salís', hint: 'Guardia u on-call: el cliente pide el servicio cuando lo necesita.' },
        ],
        onChange: (v) => {
          const minBefore = Number(ctx.quote.rules && ctx.quote.rules.minimumCallUnits);
          ctx.mutate((q) => {
            if (v === 'yes') {
              q.serviceType = 'on_call';
              return;
            }
            if (q.serviceType === 'on_call') q.serviceType = 'configurable';
            // SIM-02 S1: sin trabajo a demanda no quedan reglas de llamados ocultas que sigan sumando (el mínimo
            // por llamado y las duraciones distintas). Los días de trabajo y las salidas quedan como estaban.
            q.activity = q.activity || {};
            q.activity.activationProfile = null;
            delete q.activity.callDurationForm;
            delete q.activity.callsPerMonth;
            if (q.rules && Number(q.rules.minimumCallUnits) > 0) q.rules.minimumCallUnits = null;
          }, { focus: 'serviceOnDemand' });
          if (v !== 'yes' && minBefore > 0) ctx.toast(`Se quitó el mínimo ${T.per}: sin trabajo a demanda no se aplica.`, 'warning');
        },
      }),
      demandBody(),
    );

  // ---- Salidas de la base (sin demanda): sólo si cambian algo; si no, un renglón que dice qué se supone.
  const salidasCard = jobHorizon || onDemand || kind === 'event'
    ? null
    : kit.advanced(
      {
        key: 'modality-departures',
        title: 'Cada cuánto salís de la base',
        variant: 'options',
        boxed: true,
        defaultOpen: salidasMatter,
        summary: () => {
          const dpa = Number(kit.get('activity.daysPerActivation')) > 0 ? Number(kit.get('activity.daysPerActivation')) : 1;
          return Math.abs(dpa - 1) < 1e-9
            ? `Cada día de trabajo cuenta como ${T.a} ${T.one} (movilización, viajes, viáticos).`
            : `${T.a === 'una' ? 'Una' : 'Un'} ${T.one} cada ${formatDays(dpa, { decimals: 2 })} de trabajo.`;
        },
      },
      salidasMatter ? null : h('p', { class: 'qe-note' }, `Hoy no cambia ningún costo: sirve si cargás movilización, viajes o viáticos ${T.per}.`),
      formGrid(2,
        addInfoTip(kit.num('activity.daysPerActivation', {
          label: '¿Cada cuántos días de trabajo salís de la base?',
          rule: 'positiveDays',
          unit: 'días',
          hint: '1 = salís y volvés cada día. Si te quedás en el lugar todo el trabajo, poné los días que dura.',
          onValue: () => syncRouteTrips(),
        }), tripUnit
          ? `Viajes ${T.per} = viajes por día × estos días. Si es 1, cada día de trabajo es ${T.a} ${T.one}.`
          : `Cuenta las movilizaciones, los viajes y los viáticos ${T.per}. No es la unidad que cobrás.`)),
      legacyMinimum && minimumCallApplies(kind)
        ? formGrid(2, kit.num('rules.minimumCallUnits', {
          label: `Mínimo ${T.per}`,
          rule: 'quantity',
          unit: hourly ? 'h' : kind === 'day' ? 'días' : info.plural,
          hint: `Se factura aunque se trabaje menos. Si no cobrás un mínimo ${T.per}, ponelo en 0.`,
        }))
        : null,
      fullActivationsBlock(),
    );

  // ---- Precio total del trabajo: días de trabajo de todo el trabajo (no un mes).
  const jobKeyline = jobHorizon ? kit.keyline({
    label: 'El trabajo completo',
    value: (r) => (r.activity && r.activity.jobHorizon && r.activity.activeDaysPerMonth > 0 ? `≈ ${num(r.activity.jobMonths)} ${Math.abs(r.activity.jobMonths - 1) < 1e-9 ? 'mes' : 'meses'}` : EMPTY),
    hint: (r) => {
      const a = r.activity || {};
      if (!(a.activeDaysPerMonth > 0)) return 'Cargá los días de trabajo de todo el trabajo.';
      // SIM A2: con 30 disponibles (todos los días) una obra de 66 días hábiles daba 2,2 meses en vez de 3.
      const allDays = Number(a.availableDaysPerMonth) >= 30;
      return `${workDaysText(a.activeDaysPerMonth)} con ${num(a.availableDaysPerMonth)} días disponibles por mes: los costos fijos del mes (sueldos, estructura) se cuentan ${num(a.jobMonths)} ${Math.abs(a.jobMonths - 1) < 1e-9 ? 'vez' : 'veces'}.${allDays ? ' Si no se trabaja todos los días, poné los días hábiles (por ejemplo 22).' : ''} El costo, el precio y la ganancia son los del trabajo completo, no de un mes.`;
    },
  }) : null;

  // ---- Línea clave con día, hora o mes: lo que se factura y cómo se llega.
  const daysKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => (r.activity && r.activity.activeDaysPerMonth > 0 ? `${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes` : EMPTY),
    hint: (r) => {
      const a = r.activity || {};
      if (!(a.activeDaysPerMonth > 0)) return onDemand ? `Cargá ${T.theMany} ${T.many} y su duración para ver qué facturás.` : 'Cargá la actividad para ver qué facturás.';
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      // La actividad normalizada del motor trae `billedResources` (ya vale 1 sin personas o equipos facturados).
      const n = Number(a.billedResources) > 0 ? Number(a.billedResources) : 1;
      const H = a.hoursPerActiveDay;
      let chain;
      if (onDemand && kind !== 'month') {
        const perCall = hourly ? a.daysPerActivation * H : a.daysPerActivation;
        chain = `${num(a.activationsPerMonth)} ${T.many} × ${num(perCall)} ${callUnits} = ${num(hourly ? a.activeDaysPerMonth * H : a.activeDaysPerMonth)} ${callUnits} trabajadas${n > 1 ? ` × ${num(n)} ${resourceWord}` : ''} → ${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes${extra}.`;
      } else if (hourly && isFiniteNumber(H)) {
        chain = `${formatDays(a.activeDaysPerMonth, { decimals: 2 })} × ${num(H)} h por día${n > 1 ? ` × ${num(n)} ${resourceWord}` : ''} = ${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes${extra}.`;
      } else if (kind === 'month') {
        chain = `${n > 1 ? `${num(n)} ${info.plural}` : 'Un abono'} por mes, con ${workDaysText(a.activeDaysPerMonth)}.`;
      } else {
        chain = `${formatDays(a.activeDaysPerMonth, { decimals: 2 })}${n > 1 ? ` × ${num(n)} ${resourceWord}` : ''} = ${unitsLabel(r, r.estimate.revenue.billableUnits)} por mes${extra}.`;
      }
      const used = `Ocupás ${formatDays(a.activeDaysPerMonth, { decimals: 1 })} de ${num(a.availableDaysPerMonth)} disponibles (${formatPercent(a.utilizationPct)}).`;
      return lines(chain, kind === 'month' ? null : revenueLine(r), `${used}${showActivations ? fractionalText(r) : ''}`);
    },
  });

  const question = jobHorizon
    ? kit.question('¿Cuánto lleva el trabajo completo?', 'Con los días de trabajo de toda la obra se calculan el costo y el precio del trabajo completo (no de un mes).')
    : hourly
      ? kit.question(onDemand ? `¿Cuántos ${T.many} esperás y cuánto duran?` : `¿Cuántas ${info.plural} vas a facturar por mes?`, `Cuanto menos factures, más alta tiene que ser la tarifa ${perText(info)} para cubrir los costos fijos.`)
      : kind === 'month'
        ? kit.question('¿Cuántos días por mes vas a trabajar?', 'El abono es fijo: los días mueven los costos (personal, equipos, combustible).')
        : kind === 'day'
          ? kit.question(onDemand ? `¿Cuántos ${T.many} esperás y cuánto duran?` : `¿Cuántos ${resource ? info.plural : 'días'} vas a facturar por mes?`, `Cuanto menos factures, más alta tiene que ser la tarifa ${perText(info)} para cubrir los costos fijos.`)
          : kit.question(texts.quantityQuestion, `Cuanto menos factures, más alta tiene que ser la tarifa ${perText(info)} para cubrir los costos fijos.`);

  let activityFields;
  if (jobHorizon) {
    activityFields = formGrid(3,
      kit.num('activity.daysPerActivation', {
        label: 'Días de trabajo de todo el trabajo',
        rule: 'positiveDays',
        unit: 'días',
        requiredMark: true,
        placeholder: 'Ej.: 66',
        hint: 'Los días en que se trabaja, sumando todos los meses.',
      }),
      kit.num('activity.availableDaysPerMonth', {
        label: 'Días de trabajo disponibles por mes',
        rule: 'daysInMonth',
        unit: 'días',
        placeholder: '22',
        hint: 'Con esto sale cuántos meses dura (22 si son días hábiles).',
      }),
      hoursField());
  } else if (byQuantity) {
    activityFields = quantityFields();
  } else if (onDemand) {
    activityFields = formGrid(2, hourly ? hoursField({ onValue: () => syncDemand() }) : null, resourceField);
  } else if (hourly) {
    activityFields = formGrid(3, hoursActivityField(), hoursField({ onValue: () => { if (hoursBasis === 'hours') syncDaysFromHours(); } }), resourceField);
  } else {
    activityFields = formGrid(2,
      kit.num('activity.activeDaysPerMonth', {
        label: 'Días de trabajo por mes',
        rule: 'days',
        unit: 'días/mes',
        requiredMark: true,
        placeholder: 'Ej.: 20',
        hint: kind === 'month' ? 'Mueven los costos; el abono es fijo.' : 'Una estimación alcanza: en el Resultado ves otras cantidades de días.',
      }),
      resourceField);
  }

  // UXR (SIM A2): la duración del contrato estaba escondida en "Más datos" con 12 meses por defecto y el
  // Resultado mostraba el total de 12 meses aun para un trabajo puntual. Va a la vista, junto a la actividad.
  // Con precio total del trabajo no se pregunta: el contrato es ese trabajo.
  const contractCard = jobHorizon
    ? null
    : card(
      { className: 'qe-contract-card' },
      formGrid(2,
        kit.num('contractMonths', {
          label: '¿Cuántos meses dura el contrato?',
          rule: 'months',
          unit: 'meses',
          hint: 'Poné 1 si es un trabajo puntual. Con esto se calcula el total del contrato, se reparte un precio global de un proveedor y se ve si aplica el descuento por continuidad.',
        }),
        kit.out((r) => {
          // La misma cuenta que el Resultado y el PDF (priceComposition).
          let c = null;
          try { c = priceComposition(r).contract; } catch { c = null; }
          if (!c || !isFiniteNumber(c.revenue) || !(c.revenue > 0) || !(c.months > 0)) return '';
          return `Total del contrato: ${formatMoney(c.revenue)} (${formatMoney(c.revenue / c.months)} por mes × ${num(c.months)} ${c.months === 1 ? 'mes' : 'meses'}).`;
        }, { tag: 'p', className: 'qe-note', allowEmpty: true })));

  const activityCard = card(
    { className: 'qe-activity-card' },
    activityFields,
    jobHorizon ? jobKeyline : byQuantity ? quantityKeyline : daysKeyline,
    jobHorizon ? null : multiMonthBanner,
    // PLAN-2026-012: viajes facturables, físicos, días de trabajo y km (unidad "viaje").
    tripUnit ? kit.group('Viajes y km del mes', transportStats(kit)) : null,
    // Cobro por km (PLAN-2026-014, LAB-D4): km facturables y km de ruta, por separado.
    info.id === 'km' ? kit.group('Viajes y km del mes', transportStats(kit, { billable: false, km: true })) : null,
    kit.advanced(
      {
        key: 'modality',
        summary: () => {
          const a = quote.activity || {};
          return [
            isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días disponibles por mes` : 'días disponibles sin cargar',
            hourly || jobHorizon ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día` : 'horas por día sin cargar',
          ].filter(Boolean).join(' · ');
        },
      },
      formGrid(2,
        jobHorizon ? null : kit.num('activity.availableDaysPerMonth', {
          label: 'Días disponibles en el mes',
          rule: 'daysInMonth',
          unit: 'días',
          placeholder: '30',
          hint: 'Normalmente 30 para servicios 24/7; 22 si sólo trabajás días hábiles.',
        }),
        hourly || jobHorizon ? null : hoursField()),
      kit.stats(
        jobHorizon ? null : kit.stat('Ocupación del mes (utilización)', (r) => formatPercent(r.activity.utilizationPct), { hint: 'Días de trabajo ÷ días disponibles.' }),
        byQuantity
          ? kit.stat('Días de trabajo por mes', (r) => (r.activity.activeDaysPerMonth > 0 ? formatDays(r.activity.activeDaysPerMonth, { decimals: 2 }) : EMPTY), {
            hint: kind === 'quantity' ? `${Plural} por mes ÷ ${info.plural} por día de trabajo.` : `${Plural} por mes × días de trabajo de cada uno.`,
          })
          : null,
        showActivations ? kit.stat(`${T.Many} por mes`, (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: 'Es un promedio (puede tener decimales).' }) : null,
        jobHorizon ? null : kit.stat(`${Plural} facturables por mes`, (r) => unitsLabel(r, r.estimate.revenue.billableUnits), {
          hint: (r) => (r.estimate.revenue.minimumCallApplied ? `Incluye el mínimo ${T.per}.` : `En la unidad elegida (${info.label}).`),
        }),
      ),
    ),
  );
  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  // UXR: con $/hora (o por persona o equipo) el mínimo para no perder va en la unidad de cobro, no en días.
  const breakEvenStat = byQuantity || hourly || resource
    ? kit.stat(`${texts.breakEvenLabel} (break-even)`, (r) => {
      const be = r.breakEven || {};
      if (be.notApplicable) return 'No aplica';
      if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
      return quantityCeilText(be.quantity, r);
    }, {
      hint: (r) => (r.breakEven && (r.breakEven.reason || (r.breakEven.reachable ? `${workDaysText(r.breakEven.days)} por mes, a ${formatMoney(r.kpis.commercialListRate)} / ${r.unitLabel}` : ''))) || '',
      trace: (r) => r.traces.breakEven,
      tone: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !isFiniteNumber(r.kpis.commercialListRate)) return 'gray';
        return !be.reachable || be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
      },
    })
    : kit.stat('Días mínimos para no perder (break-even)', (r) => {
      const be = r.breakEven || {};
      if (be.notApplicable) return 'No aplica';
      if (!be.reachable) return isFiniteNumber(r.kpis.commercialListRate) ? 'No se alcanza' : EMPTY;
      // 1 decimal en la superficie (6,4 días); los 2 decimales, en "Ver cálculo".
      return formatDays(be.days, { decimals: 1 });
    }, {
      hint: (r) => (r.breakEven && (r.breakEven.reason || (r.breakEven.reachable ? `${formatNumber(r.breakEven.wholeDays)} días enteros, a ${formatMoney(r.kpis.commercialListRate)} / ${r.unitLabel}` : ''))) || '',
      trace: (r) => r.traces.breakEven,
      tone: (r) => {
        const be = r.breakEven || {};
        if (be.notApplicable || !isFiniteNumber(r.kpis.commercialListRate)) return 'gray';
        return !be.reachable || be.days > r.kpis.activeDays + 1e-9 ? 'red' : 'green';
      },
    });
  const calcCard = knownRate
    ? card(
      { title: 'Con tu tarifa', subtitle: 'Lo que calcula RATEOS cuando ya tenés la tarifa.' },
      kit.stats(
        breakEvenStat,
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
          // Sin costos cargados la tarifa piso da $ 0: no se muestra como si fuera una tarifa.
          if (isFiniteNumber(floor.value) && !(r.kpis.totalCost > 0)) return 'Cargá los costos (personal, equipos u otros gastos) para ver las tarifas.';
          return isFiniteNumber(floor.value)
            ? `Tarifa piso ${perUnitCeil(floor.value, r)} y las tarifas para ganar ${ladder.map((m) => formatPercent(m)).join(', ')} sobre el precio.`
            : byQuantity ? `Cargá ${texts.los} ${info.plural} por mes para ver las tarifas.` : 'Cargá la actividad para ver las tarifas.';
        },
      },
      h('p', { class: 'qe-note' }, 'Son tarifas DE LISTA (antes de descuentos), redondeadas hacia arriba: las que escribís en la cotización.'),
      kit.stats(
        kit.stat(
          (r) => (floorDisplay(r).base === 'net' ? 'Tarifa piso neta (margen 0 %)' : 'Tarifa piso de lista (margen 0 %)'),
          (r) => perUnitCeil(floorDisplay(r).value, r),
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
          return perUnitCeil(row ? row.listRate : null, r);
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
    question,
    activityCard,
    demandCard,
    contractCard,
    salidasCard,
    calcCard,
  );
  return { update() {} };
}
