/**
 * Etapa 1 · El servicio — Cómo se cobra (modalidad).
 * Básico: modo (conozco la tarifa / conozco la actividad), unidad (las
 * habituales del tipo de servicio + "Otra / personalizada", PLAN-2026-009),
 * tarifa conocida y la actividad EN LA UNIDAD COMERCIAL:
 *   $/día, $/hora, $/mes      días trabajados por mes y días por llamado (como siempre)
 *   $/m³, $/viaje, $/turno…   cantidad a facturar por mes + cantidad por día de trabajo
 *   $/llamado, $/trabajo, $/hito  llamados o trabajos por mes + días de trabajo de cada uno
 * Los días de trabajo (lo que consume personal, equipos y combustible) se
 * derivan en el motor: UNIDAD DE COSTO ≠ UNIDAD DE VENTA.
 * Opciones avanzadas: días disponibles, horas por día, disponibilidad on-call
 * y tiempo de respuesta (con un resumen visible de lo aplicado).
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, choiceGroup, openDialog, button } from '../../components.js';
import { PRICING_MODES, AVAILABILITY_OPTIONS } from '../../../domain/catalogs.js';
import { billingUnitOf, unitChoicesFor, unitTexts, cleanUnitName } from '../../../domain/billing-units.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { convertMinimumCallUnits } from '../../../engines/commercial-rules-engine.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace, hasNumber, stepName } from './shared.js';
import { quantityText, quantityCeilText, workDaysText, capitalizeUnitPhrase } from '../../unit-text.js';

const MODE_LABELS = Object.freeze({
  known_rate: 'Sí, ya tengo la tarifa',
  known_activity: 'No: calculá cuánto cobrar',
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

/** Unidades facturables en la unidad comercial ("8 días", "160 horas", "1 abono", "10.000 m³"). */
function unitsLabel(r, value) {
  const unit = r.unit;
  if (unit === 'hour') return `${formatNumber(value, { decimals: 2 })} horas`;
  if (unit === 'month') return `${formatNumber(value, { decimals: 2 })} ${Math.abs(value - 1) < 1e-9 ? 'abono' : 'abonos'}`;
  if (unit === 'quantity' || unit === 'event') return quantityText(value, r);
  return `${formatNumber(value, { decimals: 2 })} días`;
}

/** Rótulo de la tarifa: "$/día", "$/mes (abono)" (como siempre) o "$/m³", "$/viaje", "$/pozo". */
function rateLabelOf(info) {
  return info.legacy ? info.label : `$/${info.singular}`;
}

/** Sufijo del campo de tarifa: "$/día", "$/m³", "$/u.". */
function rateSuffixOf(info) {
  return info.legacy ? info.label.replace(/\s*\(.*\)$/, '') : `$/${info.short}`;
}

/** "Por llamado", "por m³"… (diálogo de cambio de unidad). */
function perText(info) {
  return `por ${info.singular || 'unidad'}`;
}

/** ¿El mínimo por llamado se aplica con esta unidad? (no con abono ni por llamado/trabajo). */
function minimumCallApplies(kind) {
  return kind === 'day' || kind === 'hour' || kind === 'quantity';
}

function rateRowFor(result, marginPct) {
  return (result.ratesAtEstimate.byMargin || []).find((m) => m.marginPct === marginPct) || null;
}

/** Diálogo al cambiar la unidad con tarifas cargadas: 'convert' | 'clear' | null. */
function askUnitChange({ from, to, fromUnit, rates, convertible, hours }) {
  return new Promise((resolve) => {
    let choice = null;
    const list = h(
      'ul',
      {},
      ...rates.map((r) => h('li', {}, `${r.label}: ${formatMoney(r.value)} ${perText(from)}${convertible ? ` → ${formatMoney(r.converted)} ${perText(to)}` : ''}`)),
    );
    const explanation = convertible
      ? `Podés convertirla con las ${formatNumber(hours, { decimals: 2 })} horas trabajadas por día activo (${fromUnit === 'day' ? '÷' : '×'} ${formatNumber(hours, { decimals: 2 })}, redondeado hacia arriba) o borrarla y cargarla de nuevo.`
      : 'Entre estas unidades no hay una conversión segura: borrala y cargala de nuevo en la unidad nueva.';
    const { close } = openDialog({
      title: `Cambiar la unidad a ${to.label}`,
      content: h(
        'div',
        {},
        h('p', {}, `Hay tarifas cargadas en ${from.label}. Si cambiás la unidad sin convertirlas, el mismo número se leería ${perText(to)} y el resultado sería engañoso.`),
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
  const info = billingUnitOf(quote);
  const texts = unitTexts(info);
  const kind = info.kind;
  // Por cantidad (m³, viajes, turnos…) o por evento (llamados, trabajos, hitos):
  // la actividad se carga en la unidad comercial y los días de trabajo se derivan.
  const byQuantity = kind === 'quantity' || kind === 'event';
  const isOnCall = quote.serviceType === 'on_call';
  const knownRate = quote.pricingMode === 'known_rate';
  const Plural = capitalizeUnitPhrase(info.plural);

  /**
   * Cambio de unidad (QA-E2E-08): si hay una tarifa conocida u ofrecida
   * cargada, se ofrece convertirla (día ↔ hora) o borrarla. Nunca se
   * reinterpreta el mismo número en otra unidad sin avisar. El mínimo por
   * llamado (que está en la unidad de la tarifa) se convierte con las horas
   * por día activo; si no se puede (p. ej. de días a m³), se avisa.
   */
  async function changeUnit(nextUnit) {
    const fromUnit = quote.unit || 'day';
    if (nextUnit === fromUnit) return;
    const from = billingUnitOf(quote);
    const to = billingUnitOf({ ...quote, unit: nextUnit });
    const pricing = quote.pricing || {};
    const hours = quote.activity ? quote.activity.hoursPerActiveDay : null;
    const minCall = Number(quote.rules && quote.rules.minimumCallUnits);
    const hasMinCall = Number.isFinite(minCall) && minCall > 0 && minimumCallApplies(from.kind) && minimumCallApplies(to.kind) && from.id !== to.id;
    const timeToTime = ['day', 'hour'].includes(from.kind) && ['day', 'hour'].includes(to.kind);
    const minCallConverted = hasMinCall && timeToTime ? convertMinimumCallUnits(minCall, fromUnit, nextUnit, hours) : null;
    const applyMinCall = (q) => {
      if (hasMinCall && isFiniteNumber(minCallConverted) && q.rules) q.rules.minimumCallUnits = minCallConverted;
    };
    const minCallUnitText = (n, u) => {
      if (u.kind === 'hour') return `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? 'hora' : 'horas'}`;
      if (u.kind === 'day') return formatDays(n);
      return quantityText(n, { unitInfo: u });
    };
    let minCallNote = '';
    if (hasMinCall) {
      if (isFiniteNumber(minCallConverted)) {
        minCallNote = ` Mínimo por llamado: ${minCallUnitText(minCall, from)} → ${minCallUnitText(minCallConverted, to)}.`;
      } else if (timeToTime) {
        minCallNote = ` Revisá el mínimo por llamado en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir (faltan las horas por día activo).`;
      } else {
        minCallNote = ` Revisá el mínimo por llamado en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir y ahora se lee en ${to.plural || 'la unidad nueva'}.`;
      }
    }
    const rates = [
      { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
      { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
    ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
    const minCallTone = minCallNote && !isFiniteNumber(minCallConverted) ? 'warning' : 'success';
    if (rates.length === 0) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
      });
      if (minCallNote) ctx.toast(`Unidad cambiada a ${to.label}.${minCallNote}`, minCallTone);
      return;
    }
    rates.forEach((r) => {
      r.converted = timeToTime ? convertRateUnit(r.value, fromUnit, nextUnit, hours) : null;
    });
    const convertible = rates.every((r) => isFiniteNumber(r.converted));
    const choice = await askUnitChange({ from, to, fromUnit, rates, convertible, hours: Number(hours) });
    if (choice === 'convert' && convertible) {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.converted;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. ${rates.map((r) => `${r.label}: ${formatMoney(r.converted)} ${perText(to)}`).join(' · ')}.${minCallNote}`, minCallTone);
    } else if (choice === 'clear') {
      ctx.mutate((q) => {
        q.unit = nextUnit;
        applyMinCall(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.path === 'knownRate' ? 0 : null;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. Se borró la tarifa: cargala de nuevo ${perText(to)}.${minCallNote}`, 'warning');
    } else {
      // Cancelado: vuelve a mostrar la unidad anterior.
      ctx.rerender();
    }
  }

  // Unidades habituales del tipo de servicio (+ la actual si no está, + "Otra / personalizada").
  const unitOptions = unitChoicesFor(quote.serviceType, info.id);
  const compactUnits = unitOptions.length > 5;
  const selectedDef = unitOptions.find((u) => u.id === info.id);

  // Nombre de la unidad propia ("pozo", "muestra"): al salir del campo se
  // vuelven a dibujar los rótulos ("Pozos a facturar por mes").
  let unitNameField = null;
  if (info.custom) {
    unitNameField = kit.text('unitName', {
      label: '¿Cómo se llama tu unidad?',
      maxLength: 30,
      placeholder: 'Ej.: pozo, muestra, ensayo',
      hint: 'En singular. Vas a cobrar "$/pozo" y cargar cuántos pozos facturás por mes.',
    });
    const input = unitNameField.querySelector('input');
    if (input) {
      input.addEventListener('change', () => {
        const clean = cleanUnitName(input.value);
        ctx.mutate((q) => {
          q.unitName = clean;
        });
      });
    }
  }

  const modeCard = card(
    {},
    kit.choice('pricingMode', {
      label: '¿Ya tenés una tarifa?',
      options: PRICING_MODES.map((m) => ({ value: m.id, label: MODE_LABELS[m.id] || m.label, hint: m.hint })),
      structural: true,
    }),
    h(
      'div',
      { class: ['qe-unit-choice', compactUnits ? 'is-compact' : null] },
      choiceGroup({
        label: '¿En qué unidad cobrás?',
        name: 'unit',
        value: info.id,
        disabled: kit.readOnly,
        options: unitOptions.map((u) => ({ value: u.id, label: u.label, hint: compactUnits ? null : u.hint })),
        onChange: (value) => changeUnit(value),
      }),
      compactUnits && selectedDef && selectedDef.hint ? h('p', { class: 'qe-note qe-unit-hint' }, `${selectedDef.label}: ${selectedDef.hint}`) : null,
    ),
    unitNameField ? formGrid(2, unitNameField) : null,
    byQuantity
      ? h('p', { class: 'qe-note' }, `Los costos se siguen calculando con los días de trabajo (personal, equipos, combustible, viajes); la tarifa y el resultado, ${perText(info)}.`)
      : null,
    knownRate
      ? formGrid(
        2,
        kit.num('pricing.knownRate', {
          label: `Tu tarifa (${rateLabelOf(info)}, sin IVA)`,
          rule: 'money',
          unit: rateSuffixOf(info),
          requiredMark: true,
          hint: kind === 'day' || kind === 'hour'
            ? 'Tarifa de lista, sin IVA, antes de descuentos por días, continuidad o comerciales.'
            : 'Tarifa de lista, sin IVA, antes de descuentos por continuidad o comerciales.',
        }),
      )
      : null,
  );

  // Horas por día activo: dato básico si cobrás por hora (define las horas facturables).
  const hoursField = () => kit.num('activity.hoursPerActiveDay', {
    label: byQuantity ? 'Horas trabajadas por día de trabajo' : 'Horas trabajadas por día activo',
    rule: 'hoursPerDay',
    unit: 'h/día',
    hint: quote.unit === 'hour' ? 'Cobrás por hora: se facturan días activos × horas por día.' : 'Se usa para el uso de equipos, la tarifa por hora y la estructura por hora.',
  });
  const hourly = quote.unit === 'hour';
  // Se evalúa en cada recálculo (la persona carga la cantidad sin redibujar el paso).
  const hasQuantity = () => hasNumber(quote.activity && quote.activity.billableQuantityPerMonth);

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
            ? 'Llamados o salidas que esperás facturar en el mes. Si no estás seguro, cargá una estimación.'
            : isMilestone
              ? 'Hitos que esperás facturar en el mes.'
              : 'Trabajos que esperás terminar y facturar en el mes. Si cada trabajo lleva más de un mes, poné la fracción (0,5 = uno cada dos meses).',
        }),
        kit.num('activity.daysPerActivation', {
          label: isCall ? '¿Cuántos días de trabajo lleva cada llamado?' : '¿Cuántos días de trabajo lleva cada trabajo?',
          rule: 'positiveDays',
          unit: 'días',
          requiredMark: true,
          hint: 'Con esto se calculan los días de trabajo del mes: lo que consume personal, equipos y combustible.',
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
    return formGrid(
      2,
      kit.num('activity.billableQuantityPerMonth', {
        label: `${Plural} a facturar por mes`,
        rule: 'quantity',
        unit: texts.perMonth,
        requiredMark: true,
        placeholder: 'Ej.: 10.000',
        hint: `Si no estás seguro, cargá una estimación: en el Resultado ves la tarifa para otras cantidades.`,
      }),
      kit.num('activity.unitsPerActiveDay', {
        label: `${Plural} por día de trabajo`,
        rule: 'quantity',
        unit: texts.perDay,
        requiredMark: true,
        placeholder: 'Ej.: 500',
        hint: 'Lo que hacés en un día de trabajo (rendimiento). Con esto se calculan los días de trabajo: lo que consume personal, equipos y combustible.',
      }),
    );
  }

  const daysKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => (hasNumber(quote.activity && quote.activity.activeDaysPerMonth) ? `${formatNumber(r.activity.activationsPerMonth, { decimals: 2 })} ${isOnCall ? 'llamados' : 'viajes o llamados'} por mes` : EMPTY),
    hint: (r) => {
      if (!hasNumber(quote.activity && quote.activity.activeDaysPerMonth)) return 'Cargá los días por mes para ver cuántos llamados y días facturás.';
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ' (incluye el mínimo por llamado)' : '';
      const acts = r.activity.activationsPerMonth;
      const fractional = acts > 0 && Math.abs(acts - Math.round(acts)) > 1e-6
        ? ` Son ${formatNumber(acts, { decimals: 2 })} llamados promedio por mes: la movilización y los costos por llamado se calculan como promedio.`
        : '';
      return `Facturás ${billable} por mes${extra}. Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles (utilización).${fractional}`;
    },
  });

  const quantityKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > 0 ? `${workDaysText(r.activity.activeDaysPerMonth)} por mes` : EMPTY),
    hint: (r) => {
      if (!hasQuantity()) return `Cargá ${texts.los} ${info.plural} por mes para ver cuántos días de trabajo lleva.`;
      if (!(r.activity.activeDaysPerMonth > 0)) {
        return kind === 'quantity' ? `Cargá ${texts.cuantos} ${info.plural} hacés por día de trabajo para calcular los días de trabajo.` : 'Cargá cuántos días de trabajo lleva cada uno.';
      }
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ' (incluye el mínimo por llamado)' : '';
      const over = r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9
        ? ` Ojo: son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} disponibles del mes.`
        : '';
      // Por intervención (PLAN-2026-010): volumen ↔ días ↔ movilización.
      const acts = r.activity.activationsPerMonth;
      const perAct = acts > 0 ? r.estimate.revenue.billableUnits / acts : null;
      const perIntervention = kind === 'quantity' && acts > 0
        ? ` ${quantityText(perAct, r)} por intervención · ${formatNumber(acts, { decimals: 2 })} ${Math.abs(acts - 1) < 1e-9 ? 'intervención' : 'intervenciones'} (salidas) por mes de ${formatDays(r.activity.daysPerActivation, { decimals: 2 })} cada una.`
        : '';
      // Salidas fraccionarias: el costo por salida (movilización…) es un PROMEDIO.
      const fractional = acts > 0 && Math.abs(acts - Math.round(acts)) > 1e-6
        ? ` Son ${formatNumber(acts, { decimals: 2 })} salidas promedio por mes: la movilización y los costos por salida se calculan como promedio. Si cada salida se paga completa, ajustá la duración de cada salida.`
        : '';
      return `Facturás ${billable} por mes${extra} en ${workDaysText(r.activity.activeDaysPerMonth)}. Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles (utilización).${perIntervention}${fractional}${over}`;
    },
    tone: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
  });

  const activityCard = card(
    {},
    byQuantity
      ? quantityFields()
      : formGrid(
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
    byQuantity ? quantityKeyline : daysKeyline,
    kit.advanced(
      {
        key: 'modality',
        summary: () => {
          const a = quote.activity || {};
          const parts = [
            isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días disponibles por mes` : 'días disponibles sin cargar',
            hourly ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día activo` : 'horas por día sin cargar',
            kind === 'quantity' && hasNumber(a.daysPerActivation) ? `${formatDays(Number(a.daysPerActivation))} por llamado o salida` : null,
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
        // Por cantidad: los días por llamado o salida cuentan las movilizaciones y el mínimo por llamado.
        kind === 'quantity'
          ? kit.num('activity.daysPerActivation', {
            label: 'Duración promedio de cada salida / intervención',
            rule: 'positiveDays',
            unit: 'días',
            hint: 'Dato OPERATIVO (no es la unidad que cobrás): cuántos días de trabajo seguidos dura cada salida. Cuenta las movilizaciones y el mínimo por llamado. Ej.: 20 días de trabajo ÷ 2 días por intervención = 10 intervenciones por mes. Si es 1, cada día de trabajo es una salida.',
          })
          : null,
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
        kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: byQuantity ? 'Días de trabajo ÷ días disponibles.' : 'Días activos ÷ días disponibles.' }),
        byQuantity
          ? kit.stat('Días de trabajo por mes', (r) => (r.activity.activeDaysPerMonth > 0 ? formatDays(r.activity.activeDaysPerMonth, { decimals: 2 }) : EMPTY), {
            hint: kind === 'quantity' ? `${Plural} por mes ÷ ${info.plural} por día de trabajo.` : `${Plural} por mes × días de trabajo de cada uno.`,
          })
          : null,
        kit.stat(isOnCall && !byQuantity ? 'Llamados por mes' : byQuantity ? 'Salidas / intervenciones por mes' : 'Viajes o llamados por mes', (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: byQuantity ? 'Días de trabajo ÷ duración de cada salida. Es un promedio (puede tener decimales).' : 'Días activos ÷ días por llamado.' }),
        kit.stat(byQuantity ? `${Plural} facturables por mes` : 'Unidades facturables por mes', (r) => unitsLabel(r, r.estimate.revenue.billableUnits), {
          hint: (r) => (r.estimate.revenue.minimumCallApplied ? 'Incluye el mínimo por llamado.' : `En la unidad elegida (${info.label}).`),
        }),
      ),
    ),
  );

  const ladder = Array.isArray(settings.marginLadder) && settings.marginLadder.length ? settings.marginLadder : [...DEFAULT_MARGIN_LADDER];
  const breakEvenStat = byQuantity
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
          return isFiniteNumber(floor.value)
            ? `Tarifa piso ${perUnitCeil(floor.value, r)} y las tarifas para ganar ${ladder.map((m) => formatPercent(m)).join(', ')} sobre el precio.`
            : byQuantity ? `Cargá ${texts.los} ${info.plural} por mes para ver las tarifas.` : 'Cargá los días por mes para ver las tarifas.';
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

  const question = byQuantity
    ? kit.question(texts.quantityQuestion, `Los costos se calculan con los días de trabajo que lleva hacerlo; la facturación, con ${texts.los} ${info.plural}. Cuanto menos factures, mayor deberá ser la tarifa ${perText(info)} para cubrir los costos fijos.`)
    : kit.question('¿Cuántos días por mes esperás trabajar?', 'En servicios on-call, cuantos menos días trabajes, mayor deberá ser la tarifa para cubrir los costos fijos.', { term: 'utilización (días trabajados ÷ días disponibles)' });

  mount(
    container,
    modeCard,
    question,
    activityCard,
    calcCard,
  );
  return { update() {} };
}
