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
import { card, formGrid, choiceGroup, searchSelectField, openDialog, button, infoTip } from '../../components.js';
import { PRICING_MODES, AVAILABILITY_OPTIONS, AVAILABILITY_WINDOW } from '../../../domain/catalogs.js';
import { billingUnitOf, unitChoicesFor, unitTexts, cleanUnitName, unitGroupOf, searchUnits, BILLING_UNIT_GROUPS } from '../../../domain/billing-units.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { applyUnitChange, hoursPerDayFromManHours } from '../../../domain/unit-change.js';
import { numberToInputText } from '../../../core/validation.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatMoneyCeil, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
import { isFiniteNumber, roundRate } from '../../../core/money.js';
import { perUnitCeil, netRateHint, floorDisplay, floorRateTrace, hasNumber, stepName, minimumGuaranteeFields } from './shared.js';
import { quantityText, quantityCeilText, workDaysText, capitalizeUnitPhrase, activationPaceText } from '../../unit-text.js';
import { activationRoundingText } from '../../result-text.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { transportStats } from './transport.js';
import { CAPACITY_UNITS } from '../../../engines/transport-engine.js';
import { contractOf, unitChoicesForContract } from '../../../domain/contract.js';
import { extrasSection } from './extras.js';
import { outsideWindowHours, outsideWindowMessage, activeGuardCoverage, activeGuardLineCheck } from '../../../engines/completeness-engine.js';
import { reliefFromLabor } from '../../../engines/rotation-engine.js';
import { staffText } from './labor.js';
import { isOutOfHoursExtra, OUT_OF_HOURS_KIND, OUT_OF_HOURS_PRESETS } from '../../../engines/out-of-hours-engine.js';
import { proposeServiceShares, staleDedicationOf, staleDedicationMessage } from '../../../engines/utilization-engine.js';
import { createId } from '../../../core/ids.js';
import { SPARSE_ACTIVATIONS_ISSUE } from '../../../engines/quote-engine.js';
import { dedicationChoiceOf } from '../../../domain/assignment.js';

const MODE_LABELS = Object.freeze({
  known_rate: 'Sí, ya tengo la tarifa',
  known_activity: 'No: calculá cuánto cobrar',
});

const AVAILABILITY_HINTS = Object.freeze({
  none: 'Salís cuando te llaman, en tu horario. Ej.: cuadrilla de 8 a 17.',
  '24/7': 'Guardia todos los días, a toda hora. Normalmente exige relevos.',
  window: 'Guardia sólo unas horas por día acordadas.',
});

/**
 * Rótulo de los días por activación con el nombre de la cotización (PLAN-2026-014, LAB-D8).
 * En un servicio permanente es un intervalo (cada cuántos días), no una duración.
 */
function daysPerActivationLabel(T, serviceType) {
  if (serviceType === 'permanent') return `¿Cada cuántos días hay ${T.a} ${T.one}?`;
  return `¿Cuántos días dura ${T.each}?`;
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

/** ¿Salta el aviso "cada llamado hace menos de una unidad"? (V-08: ahí el ritmo de los llamados va a la vista). */
export function sparseActivationsWarned(result) {
  return Boolean(result && Array.isArray(result.issues) && result.issues.some((i) => i && i.code === SPARSE_ACTIVATIONS_ISSUE));
}

/**
 * Ayuda del "Precio sugerido por hora" de una hora fuera de horario: de qué sale y, si el
 * motor lo redondeó como la tarifa (V-38), que está redondeado hacia arriba.
 */
export function suggestedHourHint(line) {
  const l = line || {};
  const rounded = isFiniteNumber(l.suggestedPrice) && isFiniteNumber(l.suggestedPriceExact) && l.suggestedPrice - l.suggestedPriceExact > 0.005
    ? ' Redondeado hacia arriba, como tu tarifa.'
    : '';
  return `${l.priceBasis === 'normal_hour'
    ? `Tu hora normal (${formatMoney(l.referenceHourPrice)}) más el recargo de las horas extra con tu margen (${formatMoney(l.surchargePrice || 0)}). Así nunca queda más barata que una hora normal.`
    : 'El costo de esa hora con tus gastos de estructura, tu margen y los impuestos.'}${rounded}`;
}

/**
 * Nota al pie de "Trabajo fuera del horario normal": de dónde sale la hora normal de referencia.
 * Cobrando por hora-hombre (V-34) la hora normal es la tarifa × las personas de la cuadrilla y
 * los precios son por hora de toda la cuadrilla, no por hora-hombre: se dice.
 */
export function outOfHoursNoteText(r) {
  const o = (r && r.outOfHours) || {};
  if (!isFiniteNumber(o.normalHourPrice)) return 'Cargá las horas de trabajo por día para comparar con tu hora normal.';
  const people = o.basis ? o.basis.people : 0;
  const crew = o.crewHour && people > 0 ? `${formatNumber(people, { decimals: 2 })} ${Math.abs(people - 1) < 1e-9 ? 'persona' : 'personas'}` : null;
  const source = o.normalHourSource === 'resources'
    ? 'lo que cuestan tu gente y tus equipos por hora, con tu margen'
    : crew ? `tu tarifa por hora-hombre × ${crew}` : 'sale de tu tarifa';
  const tail = crew ? ` Estos precios son por hora de toda la cuadrilla (${crew}), no por hora-hombre.` : '';
  return `Tu hora normal equivale a ${formatMoney(o.normalHourPrice)} (${source}). El precio sugerido es esa hora más el recargo de las horas extra. Se cobra aparte de la tarifa.${tail}`;
}

/**
 * Aviso de la fila de una hora fuera de horario (V-09): el precio cargado a mano queda por
 * debajo de la hora normal de referencia. '' si no aplica.
 */
export function cheaperThanNormalHourText(line) {
  if (!line || line.priceSource !== 'manual' || !isFiniteNumber(line.price) || !isFiniteNumber(line.referenceHourPrice)) return '';
  if (!(line.price < line.referenceHourPrice - 1e-9)) return '';
  return `Queda más barata que tu hora normal (${formatMoney(line.referenceHourPrice)}).`;
}

export function render(container, ctx) {
  const { quote, kit, settings } = ctx;
  const info = billingUnitOf(quote);
  // Unidad "viaje" (PLAN-2026-012): los viajes físicos por intervención se
  // derivan de los viajes por día × días por intervención. Al editar esos
  // datos se deja el mismo número en "Viajes por llamado" (que con esta unidad
  // no rige), así nunca queda un dato viejo distinto.
  const tripUnit = info.id === 'trip' && info.kind === 'quantity';
  const syncRouteTrips = () => {
    if (!tripUnit) return;
    const perDay = Number(kit.get('activity.unitsPerActiveDay'));
    const dpaRaw = kit.get('activity.daysPerActivation');
    const dpa = dpaRaw === null || dpaRaw === undefined || dpaRaw === '' ? 1 : Number(dpaRaw);
    if (!(Number.isFinite(perDay) && perDay > 0) || !(Number.isFinite(dpa) && dpa > 0)) return;
    ctx.update('logistics.tripsPerActivation', perDay * dpa);
  };
  const texts = unitTexts(info);
  const kind = info.kind;
  // Por cantidad (m³, viajes, turnos…) o por evento (llamados, trabajos, hitos):
  // la actividad se carga en la unidad comercial y los días de trabajo se derivan.
  const byQuantity = kind === 'quantity' || kind === 'event';
  // Contrato (PLAN-2026-018): fijo mensual / por servicio prestado / precio cerrado.
  const contract = contractOf(quote);
  const monthlyContract = !contract.legacy && contract.mode === 'monthly';
  const isOnCall = contract.legacy ? quote.serviceType === 'on_call' : contract.mode === 'on_demand' && contract.equipment;
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  const num = (v) => formatNumber(v, { decimals: 2 });
  // Atajos de cobertura (PLAN-2026-024): cargan el número a la vista; se puede escribir otro.
  function coverageShortcutsSlot() {
  const setActivity = (key, value) => ctx.mutate((q) => {
    if (!q.activity || typeof q.activity !== 'object') q.activity = {};
    q.activity[key] = value;
  });
  const shortcut = (key, value, label) => {
    const el = kit.action(label, () => setActivity(key, value), { title: `Cargar ${value}` });
    const now = quote.activity ? Number(quote.activity[key]) : NaN;
    if (Math.abs(now - value) < 1e-9) el.classList.add('is-selected');
    return el;
  };
  const hourShortcut = (n) => {
    const el = shortcut('hoursPerActiveDay', n, `${n} h`);
    el.dataset.hoursShortcut = String(n);
    return el;
  };
  if (kit.readOnly) return null;
  if (monthlyContract) {
    return h('div', { class: 'qe-toolbar qe-coverage-shortcuts' },
      h('span', { class: 'small' }, 'Días:'),
      shortcut('activeDaysPerMonth', 22, 'Lun a vie (22)'),
      shortcut('activeDaysPerMonth', 26, 'Lun a sáb (26)'),
      shortcut('activeDaysPerMonth', 30, 'Todos los días (30)'),
      h('span', { class: 'small' }, 'Horas:'),
      ...[8, 9, 12, 24].map(hourShortcut));
  }
  // On call y precio cerrado (V-04): el 10 con que nace una cotización es una opción entre
  // otras, no algo ya contestado.
  return hoursInMain
    ? h('div', { class: 'qe-toolbar qe-coverage-shortcuts' },
      h('span', { class: 'small' }, 'Horas por día:'),
      ...[8, 9, 10, 12].map(hourShortcut))
    : null;
  }

  // Personal del servicio: sólo muestra (se carga en Personal). Sin diagramas (2026-11).
  function staffForCoverageSlot() {
  return monthlyContract && Array.isArray(quote.labor) && quote.labor.length
    ? kit.keyline({
      label: 'Personal del servicio',
      value: (r) => {
        const lines = (r.model.labor.lines || []).filter((l) => l.positions > 0);
        return lines.length ? staffText({ positions: lines.reduce((a, l) => a + l.positions, 0), headcount: lines.reduce((a, l) => a + l.headcount, 0) }) : EMPTY;
      },
      hint: (r) => {
        const lines = (r.model.labor.lines || []).filter((l) => l.positions > 0);
        const parts = lines.slice(0, 4).map((l) => `${l.role || 'Puesto'}: ${staffText(l)}`);
        return `${parts.join(' · ')}. Se cambia en "${stepName('labor')}".`;
      },
    })
    : null;
  }

  const knownRate = quote.pricingMode === 'known_rate';
  const Plural = capitalizeUnitPhrase(info.plural);

  /**
   * Cambio de unidad (QA-E2E-08): si hay una tarifa conocida u ofrecida
   * cargada, se ofrece convertirla (día ↔ hora) o borrarla. Nunca se
   * reinterpreta el mismo número en otra unidad sin avisar. El mínimo por
   * llamado (que está en la unidad de la tarifa) se convierte con las horas
   * por día activo; si no se puede (p. ej. de días a m³), se borra y se avisa,
   * igual que las cantidades y el mínimo garantizado (V-03, applyUnitChange).
   */
  async function changeUnit(nextUnit) {
    const fromUnit = quote.unit || 'day';
    if (nextUnit === fromUnit) return;
    const from = billingUnitOf(quote);
    const to = billingUnitOf({ ...quote, unit: nextUnit });
    const pricing = quote.pricing || {};
    const hours = quote.activity ? quote.activity.hoursPerActiveDay : null;
    const timeToTime = ['day', 'hour'].includes(from.kind) && ['day', 'hour'].includes(to.kind);
    const minCall = Number(quote.rules && quote.rules.minimumCallUnits);
    // V-03: cantidades, mínimos e insumos cargados en la unidad anterior se limpian (o, el
    // mínimo entre día y hora, se convierte) con una sola regla: applyUnitChange. Devuelve
    // los avisos para el cartel.
    let unitNotices = [];
    const applyChange = (q) => {
      q.unit = nextUnit;
      unitNotices = applyUnitChange(q, from, to);
    };
    const minCallUnitText = (n, u) => (u.kind === 'hour'
      ? `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? 'hora' : 'horas'}`
      : formatDays(n));
    /** Texto de lo que cambió además de la unidad (después de mutar). */
    const changeNote = () => {
      const now = Number(quote.rules && quote.rules.minimumCallUnits);
      const converted = Number.isFinite(minCall) && minCall > 0 && timeToTime && Number.isFinite(now) && now > 0 && Math.abs(now - minCall) > 1e-9
        ? ` Mínimo ${T.per}: ${minCallUnitText(minCall, from)} → ${minCallUnitText(now, to)}.`
        : '';
      return `${converted}${unitNotices.length ? ` ${unitNotices.join(' ')}` : ''}`;
    };
    const rates = [
      { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
      { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
    ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
    if (rates.length === 0) {
      ctx.mutate(applyChange);
      const note = changeNote();
      if (note) ctx.toast(`Unidad cambiada a ${to.label}.${note}`, unitNotices.length ? 'warning' : 'success');
      return;
    }
    rates.forEach((r) => {
      r.converted = timeToTime ? convertRateUnit(r.value, fromUnit, nextUnit, hours) : null;
    });
    const convertible = rates.every((r) => isFiniteNumber(r.converted));
    const choice = await askUnitChange({ from, to, fromUnit, rates, convertible, hours: Number(hours) });
    if (choice === 'convert' && convertible) {
      ctx.mutate((q) => {
        applyChange(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.converted;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. ${rates.map((r) => `${r.label}: ${formatMoney(r.converted)} ${perText(to)}`).join(' · ')}.${changeNote()}`, unitNotices.length ? 'warning' : 'success');
    } else if (choice === 'clear') {
      ctx.mutate((q) => {
        applyChange(q);
        rates.forEach((r) => {
          q.pricing[r.path] = r.path === 'knownRate' ? 0 : null;
        });
      });
      ctx.toast(`Unidad cambiada a ${to.label}. Se borró la tarifa: cargala de nuevo ${perText(to)}.${changeNote()}`, 'warning');
    } else {
      // Cancelado: vuelve a mostrar la unidad anterior.
      ctx.rerender();
    }
  }

  // Unidades habituales del tipo de servicio (+ la actual si no está, + "Otra / personalizada").
  const unitOptions = contract.legacy ? unitChoicesFor(quote.serviceType, info.id) : unitChoicesForContract(contract, info.id);
  const compactUnits = unitOptions.length > 5;
  const manyUnits = unitOptions.length > 8;
  const selectedDef = unitOptions.find((u) => u.id === info.id);
  // Para el buscador: ordenadas por grupo (Tiempo, Cantidad, Volumen, Energía…), cada una con su grupo.
  const groupRank = (u) => BILLING_UNIT_GROUPS.findIndex((g) => g.id === unitGroupOf(u).id);
  const sortedUnits = unitOptions.map((u, i) => ({ u, i })).sort((a, b) => groupRank(a.u) - groupRank(b.u) || a.i - b.i).map((x) => x.u);
  const toUnitOption = (u) => ({ value: u.id, label: u.label, hint: unitGroupOf(u).label });
  const unitOptionsByGroup = sortedUnits.map(toUnitOption);

  // Nombre de la unidad propia ("pozo", "muestra"): al salir del campo se
  // vuelven a dibujar los rótulos ("Pozos a facturar por mes").
  let unitNameField = null;
  if (info.custom) {
    unitNameField = kit.text('unitName', {
      label: '¿Cómo se llama tu unidad?',
      maxLength: 30,
      placeholder: 'Ej.: válvula, muestra, junta',
      hint: 'En singular. Vas a cobrar "$/válvula" y cargar cuántas válvulas facturás por mes.',
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
    // Con una sola unidad posible (fijo mensual → $/mes) no se pregunta.
    unitOptions.length === 1 && unitOptions[0].id === info.id ? null : h(
      'div',
      { class: ['qe-unit-choice', compactUnits ? 'is-compact' : null] },
      // Muchas unidades: una lista desplegable (menos ruido que 16 tarjetas).
      manyUnits
        // Con decenas de unidades (energía, pozo, montaje, logística…): un buscador
        // ("joule", "potencia", "kva") con el grupo de cada una al lado.
        ? formGrid(2, searchSelectField({
          label: '¿En qué unidad cobrás?',
          name: 'unit',
          value: info.id,
          disabled: kit.readOnly,
          allowEmpty: false,
          placeholder: 'Escribí: hora, m³, kWh, potencia, junta…',
          options: unitOptionsByGroup,
          // Sin resultados: "Otra / personalizada" (la escribís vos), si se ofrece.
          search: (query) => {
            const found = searchUnits(sortedUnits, query);
            const custom = sortedUnits.find((u) => u.custom);
            return (found.length ? found : custom ? [custom] : []).map((u) => (found.length ? toUnitOption(u) : { ...toUnitOption(u), hint: 'No está en la lista: escribila vos' }));
          },
          hint: [selectedDef && selectedDef.hint ? selectedDef.hint : null, byQuantity ? `Los costos se siguen calculando con los días de trabajo (personal, equipos, combustible, viajes); la tarifa y el resultado, ${perText(info)}.` : null].filter(Boolean).join(' '),
          onChange: (value) => changeUnit(value),
        }), unitNameField)
        : choiceGroup({
          label: '¿En qué unidad cobrás?',
          name: 'unit',
          value: info.id,
          disabled: kit.readOnly,
          options: unitOptions.map((u) => ({ value: u.id, label: u.label, hint: compactUnits ? null : u.hint })),
          onChange: (value) => changeUnit(value),
        }),
      !manyUnits && compactUnits && selectedDef && selectedDef.hint ? h('p', { class: 'qe-note qe-unit-hint' }, `${selectedDef.label}: ${selectedDef.hint}`) : null,
    ),
    unitNameField && !manyUnits ? formGrid(2, unitNameField) : null,
    byQuantity && !manyUnits
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
  // On call (franja horaria, 2026-11): a la vista, al lado de los días, para no confundirlas
  // con las horas de guardia (cuándo te pueden llamar): éstas son las que se trabajan.
  const asksAvailability = quote.serviceType === 'on_call';
  // ¿Hay guardia? (2026-11): sin guardia (cuadrilla que sale en su horario cuando la llaman) no
  // hay días ni horas de guardia que preguntar. Sin elegir (cotizaciones anteriores, nuevas) se
  // muestra como siempre hasta que se elija.
  const availabilityValue = quote.activity ? quote.activity.availability : null;
  const guardChosen = asksAvailability && (availabilityValue === '24/7' || availabilityValue === AVAILABILITY_WINDOW);
  const availableNoun = guardChosen ? 'días de guardia' : 'días del mes';
  const hoursField = () => kit.num('activity.hoursPerActiveDay', {
    // Un solo nombre (2026-11): "Horas trabajadas por día con llamado" no se entendía. Son las
    // horas que se trabaja cada día que se sale (de 8 a 17 = 9 h), haya guardia o no.
    label: monthlyContract ? 'Horas de servicio por día' : 'Horas de trabajo por día (horario normal)',
    rule: 'hoursPerDay',
    unit: 'h/día',
    hint: monthlyContract
      ? 'Las horas del día que el cliente tiene cubiertas (8, 12, 24…). No son las horas de cada persona: ésas salen del esquema de cada puesto en Personal. Se usan para el uso de equipos y la tarifa por hora.'
      // V-04: por cantidad o por evento el campo también va a la vista (antes quedaba en 10, oculto).
      : byQuantity
      ? 'Las horas que se trabaja cada día. Se usan para el combustible y el uso de los equipos, y para calcular qué parte del mes les ocupa este servicio.'
      : quote.unit === 'hour'
      ? `Tu horario normal: las horas que se trabaja cada día que salís (de 8 a 17 = 9 h). Cobrás por hora: se facturan días con trabajo × estas horas${guardChosen ? ' (no las horas de guardia)' : ''}. Lo que se trabaje fuera de este horario se cotiza aparte, más abajo.`
      : `Tu horario normal: las horas que se trabaja cada día que salís (de 8 a 17 = 9 h). Se usan para el uso de equipos y combustible${guardChosen ? '; no son las horas de guardia' : ''}. Lo que se trabaje fuera de este horario se cotiza aparte, más abajo.`,
  });
  const hourly = quote.unit === 'hour';
  const hoursInMain = hourly || monthlyContract || asksAvailability || byQuantity;
  const monthlyAvailableConflict = monthlyContract && hasNumber(quote.activity && quote.activity.availableDaysPerMonth)
    && hasNumber(quote.activity && quote.activity.activeDaysPerMonth)
    && Number(quote.activity.availableDaysPerMonth) < Number(quote.activity.activeDaysPerMonth) - 1e-9;
  // Se evalúa en cada recálculo (la persona carga la cantidad sin redibujar el paso).
  const hasQuantity = () => hasNumber(quote.activity && quote.activity.billableQuantityPerMonth);

  /**
   * Hora-hombre (V-04): las horas de trabajo por día salen de las HH por día ÷ personas
   * (27 HH y 3 personas = 9 h). Queda a la vista en su campo y se puede corregir.
   */
  function deriveManHourDay(manHoursPerDay) {
    if (info.id !== 'manhour') return;
    const derived = hoursPerDayFromManHours(manHoursPerDay, quote.labor);
    if (derived === null) return;
    const hours = Math.round(derived * 100) / 100;
    ctx.update('activity.hoursPerActiveDay', hours);
    const input = container.querySelector('input[name="activity.hoursPerActiveDay"]');
    if (input) {
      input.value = numberToInputText(hours);
      input.removeAttribute('aria-invalid');
    }
    container.querySelectorAll('[data-hours-shortcut]').forEach((b) => b.classList.toggle('is-selected', Math.abs(Number(b.dataset.hoursShortcut) - hours) < 1e-9));
  }

  /** Actividad por cantidad (m³, viajes…) o por evento (llamados, trabajos, hitos). */
  function quantityFields() {
    if (kind === 'event') {
      const isCall = info.id === 'call';
      const isMilestone = info.id === 'milestone';
      return formGrid(
        // Con las horas por día (V-04): 3 campos en una fila; 4 (por hito), de a 2.
        isMilestone ? 2 : 3,
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
              : 'Trabajos que esperás terminar y facturar en el mes. Si cada trabajo lleva más de un mes, poné la fracción (0,5 = uno cada dos meses).',
        }),
        kit.num('activity.daysPerActivation', {
          label: info.id === 'job' ? 'Días que lleva cada trabajo' : `Días de trabajo ${T.per}`,
          rule: 'positiveDays',
          unit: 'días',
          requiredMark: true,
          hint: `Puede ser menos de 1 (0,5 = medio día). Con esto se calculan los días de trabajo del mes: lo que consume personal, equipos y combustible.`,
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
        hoursField(),
      );
    }
    // Por m³ / t / litro / barril / kg: con la capacidad del equipo, RATEOS calcula los viajes.
    const byCapacityUnit = CAPACITY_UNITS.includes(info.id);
    return formGrid(
      byCapacityUnit ? 2 : 3,
      kit.num('activity.billableQuantityPerMonth', {
        label: `${Plural} a facturar por mes`,
        rule: 'quantity',
        unit: texts.perMonth,
        requiredMark: true,
        placeholder: 'Ej.: 10.000',
        hint: `Si no estás seguro, cargá una estimación: en el Resultado ves la tarifa para otras cantidades.`,
      }),
      kit.num('activity.unitsPerActiveDay', {
        label: texts.perDayLabel,
        rule: 'quantity',
        unit: texts.perDay,
        requiredMark: true,
        placeholder: tripUnit ? 'Ej.: 2' : 'Ej.: 500',
        hint: tripUnit
          ? `Viajes que hacés en un día de trabajo. Con esto se calculan los días de trabajo (personal, equipos) y los viajes ${T.per}; los km del mes salen de los viajes que facturás.`
          : 'Lo que hacés en un día de trabajo (rendimiento). Con esto se calculan los días de trabajo: lo que consume personal, equipos y combustible.',
        onValue: (value) => {
          syncRouteTrips();
          deriveManHourDay(value);
        },
      }),
      byCapacityUnit
        ? kit.num('activity.unitsPerTrip', {
          label: 'Capacidad por viaje (opcional)',
          rule: 'quantity',
          unit: `${info.short}/viaje`,
          placeholder: 'Ej.: 30',
          hint: `Lo que lleva el equipo en un viaje (cisterna, batea…). Si la cargás, los viajes ${T.per} se calculan solos: ${info.plural} ${T.per} ÷ capacidad, redondeado hacia arriba. Vacío = los cargás a mano en "${stepName('logistics')}".`,
        })
        : null,
      hoursField(),
    );
  }

  const daysKeyline = kit.keyline({
    label: 'Con estos datos',
    value: (r) => {
      if (!hasNumber(quote.activity && quote.activity.activeDaysPerMonth)) return EMPTY;
      // Fijo mensual (PLAN-2026-018): lo que cubre el abono, no las activaciones.
      if (monthlyContract) {
        const acts = r.activity.activationsPerMonth;
        const relief = r.activity.daysPerActivation > 1 + 1e-9 ? ` · ${num(acts)} ${T.word(acts)} por mes` : '';
        return `${num(r.activity.activeDaysPerMonth)} días × ${num(r.activity.hoursPerActiveDay)} h incluidos${relief}`;
      }
      return `${num(r.activity.activationsPerMonth)} ${T.word(r.activity.activationsPerMonth)} por mes`;
    },
    hint: (r) => {
      if (!hasNumber(quote.activity && quote.activity.activeDaysPerMonth)) return `Cargá los días por mes para ver ${T.g('cuántas', 'cuántos')} ${T.many} y días facturás.`;
      // Fijo mensual (PLAN-2026-024): se factura 1 abono; la utilización no dice nada acá.
      if (monthlyContract) return 'Facturás 1 abono por mes. Lo que exceda esta cobertura se cobra en "Adicionales".';
      const billable = unitsLabel(r, r.estimate.revenue.billableUnits);
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      const acts = r.activity.activationsPerMonth;
      const fractional = acts > 0 && Math.abs(acts - Math.round(acts)) > 1e-6
        ? (r.activationRounding && r.activationRounding.enabled
          ? ` Son ${num(acts)} ${T.many} promedio por mes; los costos ${T.per} se cuentan con ${T.many} ${T.wholeMany} (abajo).`
          : ` Son ${num(acts)} ${T.many} promedio por mes: la movilización y los costos ${T.per} se calculan como promedio (abajo podés contar ${T.each} ${T.whole}).`)
        : '';
      const over = r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9;
      const usage = over
        ? `Son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} ${availableNoun} (utilización ${formatPercent(r.activity.utilizationPct)}).`
        : `Trabajás ${num(r.activity.activeDaysPerMonth)} de los ${formatNumber(r.activity.availableDaysPerMonth)} ${availableNoun} (utilización ${formatPercent(r.activity.utilizationPct)}).`;
      return `Facturás ${billable} por mes${extra}. ${usage}${fractional}`;
    },
    tone: (r) => (hasNumber(quote.activity && quote.activity.activeDaysPerMonth) && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
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
      const extra = r.estimate.revenue.minimumCallApplied ? ` (incluye el mínimo ${T.per})` : '';
      const over = r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9
        ? ` Ojo: son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} ${availableNoun}.`
        : '';
      // Por intervención (PLAN-2026-010): volumen ↔ días ↔ movilización.
      const acts = r.activity.activationsPerMonth;
      const perAct = acts > 0 ? r.estimate.revenue.billableUnits / acts : null;
      const perIntervention = kind === 'quantity' && acts > 0
        ? ` ${quantityText(perAct, r)} ${T.per} · ${num(acts)} ${T.word(acts)} por mes (${activationPaceText(r.activity.daysPerActivation, T)}).`
        : '';
      // Salidas fraccionarias: el costo por salida (movilización…) es un PROMEDIO.
      const fractional = acts > 0 && Math.abs(acts - Math.round(acts)) > 1e-6
        ? (r.activationRounding && r.activationRounding.enabled
          ? ` Son ${num(acts)} ${T.many} promedio por mes; los costos ${T.per} se cuentan con ${T.many} ${T.wholeMany} (abajo).`
          : ` Son ${num(acts)} ${T.many} promedio por mes: la movilización y los costos ${T.per} se calculan como promedio (abajo podés contar ${T.each} ${T.whole}).`)
        : '';
      return `Facturás ${billable} por mes${extra} en ${workDaysText(r.activity.activeDaysPerMonth)}. Utilización: ${formatPercent(r.activity.utilizationPct)} de los ${formatNumber(r.activity.availableDaysPerMonth)} ${availableNoun}.${perIntervention}${fractional}${over}`;
    },
    tone: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
  });

  // Días disponibles: el techo de la utilización (y, con guardia activa, los días de guardia que
  // se cubren con personas). Sólo cambia el costo si los días con trabajo los superan (trabajo de
  // más de un mes). 2026-11: con guardia elegida va a la vista como "Días de guardia por mes";
  // sin guardia es sólo el tope del mes y va a Opciones avanzadas (vuelve a la vista si los días
  // con trabajo lo superan, para que se vea y se corrija).
  const availableConflict = hasNumber(quote.activity && quote.activity.availableDaysPerMonth)
    && hasNumber(quote.activity && quote.activity.activeDaysPerMonth)
    && Number(quote.activity.availableDaysPerMonth) < Number(quote.activity.activeDaysPerMonth) - 1e-9;
  // PLAN-2026-025: con guardia, los días de guardia van en la tarjeta "Guardia" (opcional, al final).
  const availableInGuard = guardChosen && !byQuantity && !monthlyContract;
  const availableInMain = !byQuantity && !monthlyContract && !guardChosen && (!asksAvailability || availableConflict);
  const availableField = () => kit.num('activity.availableDaysPerMonth', {
    label: guardChosen ? 'Días de guardia por mes' : 'Días del mes en que podés trabajar',
    rule: 'daysInMonth',
    unit: 'días',
    placeholder: '30',
    hint: guardChosen
      ? `Días del mes en que tenés que estar de guardia, esperando ${T.many}: 30 si es todo el mes; 22 si sólo días hábiles. Con guardia activa definen cuántas horas cubre el personal.`
      : 'Máximo de días que podrías trabajar en el mes (30 corridos, 22 hábiles). Sólo cambia el costo si cargás más días con trabajo que éstos.',
  });
  // Disponibilidad (A-16, H-26): a la vista, junto a los días, donde cambia algo (el aviso
  // de relevos de un servicio on call). Una cotización nueva la trae sin definir: nunca
  // 24/7 escondida. Con franja (2026-11) se cargan las horas de guardia por día como número
  // (antes era texto libre que la app no leía): avisa si se trabajan más horas que la franja.
  // No mueve costo ni facturación.
  const availability = quote.activity ? quote.activity.availability : null;
  const oldWindowText = quote.activity && typeof quote.activity.availabilityWindow === 'string' ? quote.activity.availabilityWindow.trim() : '';
  // La pregunta de guardia va primero (revisión UX 2026-11): explica los días de guardia que
  // aparecen debajo. El detalle (horas de la franja, tipo de guardia) va después de los días.
  const availabilityChoice = asksAvailability && guardChosen
    ? h('div', { class: 'qe-availability' },
      kit.choice('activity.availability', {
        label: '¿Cuándo estás de guardia?',
        options: AVAILABILITY_OPTIONS.filter((o) => o.id !== 'none').map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
        structural: true,
      }))
    : null;
  const availabilityRow = asksAvailability
    ? h('div', { class: 'qe-availability' },
      availability === AVAILABILITY_WINDOW
        ? formGrid(2, kit.num('activity.availabilityHoursPerDay', {
          label: 'Horas de guardia por día',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: 'Ej.: 12',
          hint: `Las horas del día en que el cliente puede llamarte (por ejemplo 12 h, de 7 a 19). Si trabajás más horas que éstas, el excedente es fuera de horario.`,
        }))
        : null,
      availability === AVAILABILITY_WINDOW
        ? kit.out(() => {
          const o = outsideWindowHours(quote);
          if (o) return h('p', { class: ['qe-note', 'is-warning'] }, outsideWindowMessage(quote, o, { short: true }));
          // Cotización con la franja escrita a mano: a la vista hasta cargar el número.
          const empty = !hasNumber(quote.activity && quote.activity.availabilityHoursPerDay);
          return empty && oldWindowText ? h('p', { class: 'qe-note' }, `Antes cargaste: "${oldWindowText}". Pasalo a horas por día.`) : '';
        }, { tag: 'div', allowEmpty: true })
        : null,
      // Guardia activa o pasiva (2026-11): define si las horas de guardia se cubren con
      // personas (relevos con números, en Personal) o se rota quién está de guardia.
      guardChosen
        ? kit.choice('activity.guardType', {
          label: h('span', {}, 'Tipo de guardia', infoTip('Activa: el personal está en la base o en la locación; esas horas cuentan como trabajo y piden más personas (horas de guardia del mes ÷ horas normales por persona, más francos y vacaciones; se revisa en Personal). Pasiva: está localizable y sale si lo llaman; se suele pagar un adicional de guardia y alcanza con rotar quién está de guardia.')),
          options: [
            { value: 'active', label: 'Activa (en el lugar)', hint: 'Cuentan como horas de trabajo.' },
            { value: 'passive', label: 'Pasiva (localizable)', hint: 'Sale sólo si lo llaman.' },
          ],
          structural: true,
        })
        : null,
      guardChosen && quote.activity && quote.activity.guardType === 'active'
        ? kit.out((r) => {
          const g = activeGuardCoverage(quote);
          if (!g) return '';
          const f = (n) => formatNumber(n, { decimals: Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1 });
          const lines = (Array.isArray(quote.labor) ? quote.labor : []).map((l) => activeGuardLineCheck(g, l, r.activity.activeDaysPerMonth)).filter(Boolean);
          const line = lines.find((c) => c.short) || lines[0];
          const people = line ? ` ≈ ${f(line.needed)} personas por posición${line.short ? ' · faltan en Personal' : ''}` : '';
          return h('p', { class: ['qe-note', line && line.short ? 'is-warning' : null] }, `${f(line ? line.required : g.required)} h de guardia por posición por mes${people}.`);
        }, { tag: 'div', allowEmpty: true })
        : null)
    : null;
  // Por cantidad: "¿Cómo son los llamados?" vive en "Opciones avanzadas" (no es la unidad que se
  // cobra). V-08: cuando salta el aviso "cada llamado hace menos de una unidad" pasa a la vista,
  // debajo de la cantidad, y ahí se queda hasta que se vuelve a dibujar el paso (no se va
  // mientras se corrige el dato).
  const quantityPace = kind === 'quantity'
    ? kit.activationPace({
      T,
      label: `¿Cómo son ${T.theMany} ${T.many}?`,
      hint: tripUnit
        ? `Viajes ${T.per} = viajes por día × días ${T.per}.`
        : `No es la unidad que cobrás: define cuántas ${T.many} (movilizaciones, mínimos ${T.per}) hay en el mes.`,
      onValue: () => syncRouteTrips(),
    })
    : null;
  const quantityPaceSlot = quantityPace ? h('div', {}, quantityPace) : null;
  const quantityPaceMain = quantityPace ? h('div', { class: 'qe-pace-main' }) : null;
  if (quantityPace) {
    kit.toggle(quantityPaceMain, (r) => {
      if (quantityPace.parentNode !== quantityPaceMain && sparseActivationsWarned(r)) quantityPaceMain.appendChild(quantityPace);
      return quantityPace.parentNode === quantityPaceMain;
    });
  }
  const activityCard = card(
    {},
    byQuantity
      ? quantityFields()
      : formGrid(
        monthlyContract ? 2 : (() => {
          // Días + los campos que acompañan: 2 o 3 campos van en una fila de 3; 1 o 4, de a 2.
          const fields = 1 + [hoursInMain, availableInMain, quote.serviceType === 'permanent'].filter(Boolean).length;
          return fields === 2 || fields === 3 ? 3 : 2;
        })(),
        monthlyContract
          ? kit.num('activity.activeDaysPerMonth', {
            label: 'Días de servicio por mes',
            rule: 'days',
            unit: 'días/mes',
            requiredMark: true,
            placeholder: 'Ej.: 22',
            hint: 'Los días que cubre el abono (lunes a viernes ≈ 22, lunes a sábado ≈ 26, todos los días = 30). No cambia los sueldos: el personal se carga en Personal. Lo que se trabaje fuera de eso va en "Adicionales".',
          })
          : kit.num('activity.activeDaysPerMonth', {
            label: isOnCall ? 'Días con trabajo por mes' : 'Días trabajados y facturados por mes',
            rule: 'days',
            unit: 'días/mes',
            requiredMark: true,
            placeholder: 'Ej.: 8',
            hint: isOnCall
              ? `Días en que salís a atender ${T.many}. Si no estás seguro, cargá una estimación: en el Resultado ves la tarifa para otras cantidades de días.`
              : 'Si no estás seguro, cargá una estimación: en el Resultado ves la tarifa para otras cantidades de días.',
          }),
        quote.serviceType === 'permanent'
          ? kit.num('activity.daysPerActivation', {
            label: daysPerActivationLabel(T, quote.serviceType),
            rule: 'positiveDays',
            unit: 'días',
            hint: `Sirve para saber ${T.g('cuántas', 'cuántos')} ${T.many} hay por mes.`,
          })
          : null,
        // "Días entre viajes o relevos" (A-6) salió de acá (PLAN-2026-024): es cómo viaja el
        // personal, no lo que se vende. Va en su propia pregunta, abajo (travelCard).
        availableInMain ? availableField() : null,
        hoursInMain ? hoursField() : null,
      ),
    coverageShortcutsSlot(),
    !byQuantity && quote.serviceType !== 'permanent' && !monthlyContract
      ? kit.activationPace({
        T,
        label: `¿Cómo son ${T.theMany} ${T.many}?`,
        hint: `${T.g('Una', 'Un')} ${T.one} es cada vez que ${isOnCall ? 'el cliente te convoca y salís a trabajar' : 'salís de la base a hacer un trabajo'}. ${T.Each} suma su movilización, el mínimo ${T.per} y los costos ${T.per}.`,
      })
      : null,
    byQuantity ? quantityKeyline : daysKeyline,
    quantityPaceMain,
    staffForCoverageSlot(),
    // PLAN-2026-012: viajes facturables, físicos, días de trabajo y km (unidad "viaje").
    tripUnit ? kit.group('Viajes y km del mes', transportStats(kit)) : null,
    // Cobro por km (PLAN-2026-014, LAB-D4): km facturables y km de ruta, por separado.
    info.id === 'km' ? kit.group('Viajes y km del mes', transportStats(kit, { billable: false, km: true })) : null,
    // PLAN-2026-011: cada salida completa (apagado por defecto). Sólo los costos
    // físicamente indivisibles por salida; producción y facturación no cambian.
    // Sólo aparece cuando cambia algo: con un promedio no entero de activaciones
    // por mes (o si ya está encendida, para no dejar un estado oculto).
    kit.toggle(h('div', { class: 'qe-full-activations' },
      kit.check('activity.fullActivations', {
        label: `${T.Each} se cuenta ${T.whole}`,
        hint: `Apagada, ${T.theMany} ${T.many} por mes son un promedio (por ejemplo 10,42) y los costos ${T.per} se cuentan en proporción. Encendida, esos costos —movilización, peajes, viáticos, cargos del proveedor ${T.per} y mínimos ${T.per}— se costean con ${T.many} ${T.wholeMany} (11). Sueldos, tenencia de equipos, producción, facturación y estructura mensual no cambian.`,
      }),
      kit.out((r) => {
        const info = activationRoundingText(r.activationRounding, T);
        if (!info) return '';
        return h('p', { class: ['qe-note', info.tone === 'warning' ? 'is-warning' : null] }, info.text);
      }, { tag: 'div', allowEmpty: true })), (r) => {
      if (quote.activity && quote.activity.fullActivations === true) return true;
      const acts = r.activity.activationsPerMonth;
      return acts > 0 && Math.abs(acts - Math.round(acts)) > 1e-6;
    }),
    // Fijo mensual (2026-11): "Días disponibles" repetía los días de servicio del abono (y la
    // utilización y las intervenciones no dicen nada en un abono). Se esconde; sólo vuelve si
    // una cotización anterior guardó menos días disponibles que días de servicio (ahí cambia
    // el costo), para que se vea y se pueda corregir.
    monthlyContract && !monthlyAvailableConflict ? null : kit.advanced(
      {
        key: 'modality',
        summary: () => {
          const a = quote.activity || {};
          const parts = [
            availableInMain ? null : isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `hasta ${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días por mes` : 'días del mes sin cargar',
            hoursInMain ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día activo` : 'horas por día sin cargar',
            kind === 'quantity' && hasNumber(a.daysPerActivation) ? activationPaceText(Number(a.daysPerActivation), T) : null,
            isOnCall && !asksAvailability && a.availability !== 'none' && isFiniteNumber(Number(a.responseTimeHours)) && a.responseTimeHours !== null && a.responseTimeHours !== '' ? `respuesta en ${formatNumber(Number(a.responseTimeHours), { decimals: 1 })} h` : null,
          ].filter(Boolean);
          return parts.join(' · ');
        },
      },
      formGrid(
        2,
        availableInMain ? null : availableField(),
        hoursInMain ? null : hoursField(),
        // Por cantidad: los días por llamado o salida cuentan las movilizaciones y el mínimo por llamado.
      ),
      // Por cantidad: cuántas intervenciones (movilizaciones, mínimos) hay.
      // Puede durar varios días o haber varias en un día (se guarda 1 / N).
      quantityPaceSlot,
      isOnCall && !asksAvailability && !(quote.activity && quote.activity.availability === 'none')
        ? kit.group(
          'Respuesta on-call',
          formGrid(
            2,
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
        kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: byQuantity ? `Días de trabajo ÷ ${availableNoun}.` : `Días con trabajo ÷ ${availableNoun}.` }),
        byQuantity
          ? kit.stat('Días de trabajo por mes', (r) => (r.activity.activeDaysPerMonth > 0 ? formatDays(r.activity.activeDaysPerMonth, { decimals: 2 }) : EMPTY), {
            hint: kind === 'quantity' ? `${Plural} por mes ÷ ${info.plural} por día de trabajo.` : `${Plural} por mes × días de trabajo de cada uno.`,
          })
          : null,
        kit.stat(`${T.Many} por mes`, (r) => formatNumber(r.activity.activationsPerMonth, { decimals: 2 }), { hint: byQuantity ? `Días de trabajo ÷ duración de ${T.each}. Es un promedio (puede tener decimales).` : `Días activos ÷ días ${T.per}. Es un promedio (puede tener decimales).` }),
        kit.stat(byQuantity ? `${Plural} facturables por mes` : 'Unidades facturables por mes', (r) => unitsLabel(r, r.estimate.revenue.billableUnits), {
          hint: (r) => (r.estimate.revenue.minimumCallApplied ? `Incluye el mínimo ${T.per}.` : `En la unidad elegida (${info.label}).`),
        }),
      ),
    ),
  );

  // ------------------------------------------------------------------------------------
  // PLAN-2026-025 · Cotización guiada por recursos
  // ------------------------------------------------------------------------------------
  const setActivityValue = (key, value) => ctx.mutate((q) => {
    if (!q.activity || typeof q.activity !== 'object') q.activity = {};
    q.activity[key] = value;
  });
  const yesNo = ({ label, name, value, onChange, yes, no }) => choiceGroup({
    label,
    name,
    value,
    disabled: kit.readOnly,
    options: [
      { value: 'no', label: no.label, hint: no.hint },
      { value: 'yes', label: yes.label, hint: yes.hint },
    ],
    onChange,
  });

  // 1. Lo que cuestan tus recursos (lo cargado en la etapa anterior): de acá sale la tarifa.
  const sumLines = (r, test, key) => (r.model.lines || []).filter(test).reduce((acc, l) => acc + (l[key] || 0), 0);
  const isLabor = (l) => l.category === 'labor';
  const isEquipment = (l) => l.category === 'equipment' || l.category === 'external';
  const isOther = (l) => !isLabor(l) && !isEquipment(l) && l.category !== 'structure' && l.category !== 'financial' && l.category !== 'contingency';
  const resourceStat = (label, test, stepId, emptyText) => kit.stat(label, (r) => {
    const fixed = sumLines(r, test, 'fixedMonthly');
    return fixed > 0.005 ? `${formatMoney(fixed)} por mes` : sumLines(r, test, 'variablePerActiveDay') > 0.005 ? `${formatMoney(sumLines(r, test, 'variablePerActiveDay'))} por día` : EMPTY;
  }, {
    hint: (r) => {
      const fixed = sumLines(r, test, 'fixedMonthly');
      const variable = sumLines(r, test, 'variablePerActiveDay');
      if (!(fixed > 0.005) && !(variable > 0.005)) return `${emptyText} Se carga en "${stepName(stepId)}".`;
      return `${fixed > 0.005 && variable > 0.005 ? `Más ${formatMoney(variable)} por cada día de trabajo. ` : ''}Se cambia en "${stepName(stepId)}".`;
    },
  });
  const resourcesCard = card(
    { title: 'Lo que cuestan tus recursos', subtitle: 'La parte de tus recursos que paga este servicio (cambia si también hacen otros trabajos). Con esto y con cuánto esperás trabajar sale la tarifa.', className: 'qe-resources-card' },
    kit.stats(
      resourceStat('Personal', isLabor, 'labor', 'Sin personal cargado.'),
      resourceStat('Equipos y vehículos', isEquipment, 'equipment', 'Sin equipos cargados.'),
      resourceStat('Materiales, combustible y viajes', isOther, 'materials', 'Sin materiales ni viajes cargados.'),
    ),
    kit.out((r) => {
      const b = r.outOfHours && r.outOfHours.basis;
      if (!b || !(b.people > 0)) return h('p', { class: ['qe-note', 'is-warning'] }, 'Todavía no cargaste personal con sueldo: ', h('a', { href: ctx.href('labor') }, `cargalo en "${stepName('labor')}"`), ' para que RATEOS calcule tu tarifa.');
      return '';
    }, { tag: 'div', allowEmpty: true }),
  );

  // 2. ¿Trabajan sólo para este servicio? (asignación explícita de cada línea, con un % propuesto).
  const laborList = Array.isArray(quote.labor) ? quote.labor : [];
  const equipmentList = Array.isArray(quote.equipment) ? quote.equipment : [];
  const ownedEquipment = equipmentList.map((e, i) => ({ e, i })).filter(({ e }) => e && e.acquisition !== 'rented' && e.acquisition !== 'outsourced');
  const shareTargets = [
    ...laborList.map((l, i) => ({ kind: 'labor', i, line: l, name: (l && l.role) || 'Puesto' })),
    ...ownedEquipment.map(({ e, i }) => ({ kind: 'equipment', i, line: e, name: (e && e.name) || 'Equipo' })),
  ].filter((t) => t.line && typeof t.line === 'object');
  const sharedCount = shareTargets.filter((t) => t.line.assignment === 'shared').length;
  // V-01: "Sí" sólo se muestra marcado si alguien lo eligió (alguna línea con respuesta
  // explícita). Sin dato el costo es 100 %, pero no es una respuesta.
  const dedicationValue = dedicationChoiceOf(shareTargets.map((t) => t.line));
  const applyShares = (onlyMissing = false) => {
    const result = ctx.result;
    ctx.mutate((q) => {
      const proposal = proposeServiceShares(q, result ? result.activity : (q.activity || {}));
      (Array.isArray(q.labor) ? q.labor : []).forEach((l, i) => {
        if (!l || typeof l !== 'object') return;
        l.assignment = 'shared';
        const has = l.fixedCostSharePct !== null && l.fixedCostSharePct !== undefined && l.fixedCostSharePct !== '';
        if (proposal.labor[i] !== null && !(onlyMissing && has)) l.fixedCostSharePct = proposal.labor[i];
      });
      (Array.isArray(q.equipment) ? q.equipment : []).forEach((e, i) => {
        if (!e || typeof e !== 'object' || e.acquisition === 'rented' || e.acquisition === 'outsourced') return;
        e.assignment = 'shared';
        const has = e.fixedCostSharePct !== null && e.fixedCostSharePct !== undefined && e.fixedCostSharePct !== '';
        if (proposal.equipment[i] !== null && !(onlyMissing && has)) e.fixedCostSharePct = proposal.equipment[i];
      });
    });
  };
  // "Sí": la respuesta se escribe en todas las líneas (V-01; antes sólo en las compartidas, y en
  // una cotización nueva no guardaba nada). No cambia ningún número: sin dato ya era 100 %.
  const applyDedicated = () => ctx.mutate((q) => {
    (Array.isArray(q.labor) ? q.labor : []).forEach((l) => {
      if (l && typeof l === 'object' && l.assignment !== 'hired') l.assignment = 'dedicated';
    });
    (Array.isArray(q.equipment) ? q.equipment : []).forEach((e) => {
      if (e && typeof e === 'object' && e.acquisition !== 'rented' && e.acquisition !== 'outsourced') e.assignment = 'reserved';
    });
  });
  const pctText = (v) => formatPercent(Number(v));
  const dedicationCard = shareTargets.length && !monthlyContract
    ? card(
      { title: '¿Tu gente y tus equipos trabajan sólo para este servicio?', subtitle: 'Define cuánto de sus sueldos y de la amortización tiene que pagar este servicio.', className: 'qe-dedication-card' },
      choiceGroup({
        label: 'Elegí una opción',
        name: 'resourcesDedication',
        value: dedicationValue,
        disabled: kit.readOnly,
        options: [
          { value: 'yes', label: 'Sí, sólo para este servicio', hint: 'Este servicio paga todo su mes, trabajen los días que trabajen. Elegilo si el resto del tiempo quedan esperando.' },
          { value: 'no', label: 'No, también hacen otros trabajos', hint: 'Este servicio paga sólo la parte del mes que les ocupa. El resto lo pagan los otros trabajos.' },
        ],
        onChange: (v) => (v === 'no' ? applyShares(true) : applyDedicated()),
      }),
      sharedCount > 0
        ? h('div', { class: 'qe-dedication-detail' },
          formGrid(3, ...shareTargets.filter((t) => t.line.assignment === 'shared').map((t) => kit.num(`${t.kind}.${t.i}.fixedCostSharePct`, {
            label: `${t.name}: % de su mes`,
            rule: 'sharePct',
            unit: '%',
            hint: t.kind === 'labor' ? 'Qué parte de su sueldo con cargas paga este servicio.' : 'Qué parte de su amortización, seguro y patente paga este servicio.',
          }))),
          kit.out((r) => {
            const proposal = proposeServiceShares(quote, r.activity);
            const first = [...proposal.labor, ...proposal.equipment].find((v) => v !== null);
            if (first === undefined || first === null) return h('p', { class: 'qe-note' }, 'Cargá arriba los días con trabajo y las horas por día: RATEOS te propone el % (horas de este servicio ÷ horas normales del mes).');
            const stale = shareTargets.some((t) => {
              if (t.line.assignment !== 'shared') return false;
              const p = t.kind === 'labor' ? proposal.labor[t.i] : proposal.equipment[t.i];
              const now = Number((kit.get(`${t.kind}.${t.i}`) || {}).fixedCostSharePct);
              return p !== null && (!Number.isFinite(now) || Math.abs(now - p) > 0.05);
            });
            // V-11: más de 5 puntos de diferencia ya no es un detalle: se avisa en naranja.
            const old = staleDedicationOf(quote, r.activity);
            return h('p', { class: ['qe-note', old ? 'is-warning' : null] },
              old ? `${staleDedicationMessage(old)} ` : null,
              `Hoy este servicio les ocupa ${num(proposal.serviceHours)} h por mes: el ${pctText(first)} de su mes. `,
              stale && !kit.readOnly ? button(`Usar ${pctText(first)}`, { variant: 'secondary', size: 'sm', onClick: () => applyShares(false) }) : null,
              ' Si cambiás los días, revisá este porcentaje. Si los otros trabajos no aparecen, esa parte del sueldo queda sin cubrir.');
          }, { tag: 'div', allowEmpty: true }))
        : null,
      // Sin elegir (V-01): el precio ya carga el mes completo; se dice acá, donde se decide.
      dedicationValue === null && sharedCount === 0
        ? kit.out((r) => {
          const absorbed = ((r.completeness && r.completeness.notices) || []).find((n) => n.id === 'fixed_costs_absorbed');
          const amount = absorbed && isFiniteNumber(absorbed.amount) && absorbed.amount > 0 ? `: ${formatMoney(absorbed.amount)}` : '';
          return h('p', { class: ['qe-note', 'is-warning'] }, `Todavía no elegiste. Mientras tanto, este servicio paga todo el mes de tu gente y tus equipos${amount}.`);
        }, { tag: 'div', allowEmpty: true })
        : null,
      dedicationValue === null && sharedCount > 0
        ? h('p', { class: 'qe-note' }, 'Hoy algunos recursos están compartidos y otros no (se cambia en cada persona o equipo). Elegí una opción para dejarlos todos iguales.')
        : null,
    )
    : null;

  // 3. Fuera del horario normal: tarifas de hora extra derivadas de los recursos (extras 'overtime').
  const allExtras = Array.isArray(quote.extras) ? quote.extras : [];
  const oohEntries = allExtras.map((x, i) => ({ x, i })).filter(({ x }) => isOutOfHoursExtra(x));
  const oohOn = oohEntries.length > 0;
  const setOutOfHours = (on) => ctx.mutate((q) => {
    if (!Array.isArray(q.extras)) q.extras = [];
    if (on) {
      if (!q.extras.some(isOutOfHoursExtra)) {
        OUT_OF_HOURS_PRESETS.forEach((preset) => q.extras.push({ id: createId(), kind: OUT_OF_HOURS_KIND, premiumPct: preset.premiumPct, label: preset.label, unitName: 'hora', category: 'labor', quantityPerMonth: null, costPerUnit: null, price: null }));
      }
    } else {
      q.extras = q.extras.filter((x) => !isOutOfHoursExtra(x));
    }
  });
  const oohLine = (r, i) => (r.extras && r.extras.lines ? r.extras.lines[i] : null);
  const oohRows = oohEntries.map(({ x, i }) => h('div', { class: 'qe-ooh-row' },
    h('div', { class: 'qe-ooh-head' },
      h('strong', {}, kit.out((r) => (oohLine(r, i) ? oohLine(r, i).label : x.label || 'Hora fuera de horario'))),
      h('span', { class: 'small muted' }, Number(x.premiumPct) >= 100 ? 'Lo habitual: sábados a la tarde, domingos y feriados (revisá tu convenio).' : 'Lo habitual: días de semana fuera del horario y sábados a la mañana (revisá tu convenio).')),
    kit.stats(
      kit.stat('Te cuesta por hora (gente + equipos)', (r) => (oohLine(r, i) && oohLine(r, i).costPerUnit > 0 ? formatMoney(oohLine(r, i).costPerUnit) : EMPTY), {
        hint: (r) => {
          const b = r.outOfHours && r.outOfHours.basis;
          if (!b) return '';
          return `Lo que pagás de más por esa hora: las horas extra de ${num(b.people)} ${b.people === 1 ? 'persona' : 'personas'} con cargas${b.equipmentPerHour > 0 ? ` y el uso de los equipos (${formatMoney(b.equipmentPerHour)} por hora de combustible y mantenimiento)` : ''}. Sueldos y amortización ya están en el mes.`;
        },
      }),
      kit.stat(info.id === 'manhour' ? 'Precio sugerido por hora de toda la cuadrilla' : 'Precio sugerido por hora', (r) => (oohLine(r, i) && isFiniteNumber(oohLine(r, i).suggestedPrice) ? formatMoneyCeil(oohLine(r, i).suggestedPrice) : EMPTY), {
        emphasis: true,
        hint: (r) => {
          const l = oohLine(r, i);
          if (!l || !isFiniteNumber(l.suggestedPrice)) return 'Cargá el personal, los días y las horas para ver el precio.';
          return suggestedHourHint(l);
        },
      }),
    ),
    formGrid(2,
      kit.num(`extras.${i}.price`, { label: 'Tu precio por hora (opcional)', rule: 'money', unit: '$/h', placeholder: 'Usar el sugerido', hint: info.id === 'manhour' ? 'Sin IVA, por hora de toda la cuadrilla (no por hora-hombre). Vacío = se usa el sugerido.' : 'Sin IVA. Vacío = se usa el sugerido.' }),
      kit.num(`extras.${i}.quantityPerMonth`, { label: 'Horas estimadas por mes (opcional)', rule: 'quantity', unit: 'h/mes', placeholder: '0', hint: 'Si no sabés, dejalo vacío: el precio queda en la cotización como tarifa y no suma al mes.' })),
    // V-09: un precio a mano por debajo de la hora normal se avisa acá, al lado del campo.
    kit.out((r) => {
      const text = cheaperThanNormalHourText(oohLine(r, i));
      return text ? h('p', { class: ['qe-note', 'is-warning'] }, text) : '';
    }, { tag: 'div', allowEmpty: true })));
  const outOfHoursCard = monthlyContract || !byQuantity || kind === 'quantity' || kind === 'event' ? card(
    { title: 'Trabajo fuera del horario normal (opcional)', subtitle: 'Si te piden trabajar fuera de tu horario, a tu gente le pagás horas extra: esa hora tiene otra tarifa.', className: 'qe-ooh-card' },
    yesNo({
      label: '¿Querés cotizar una tarifa fuera de horario?',
      name: 'outOfHours',
      value: oohOn ? 'yes' : 'no',
      no: { label: 'No', hint: 'Sólo se trabaja en el horario normal.' },
      yes: { label: 'Sí, con horas extra', hint: 'RATEOS calcula la hora al 50 % y al 100 % con tus recursos.' },
      onChange: (v) => setOutOfHours(v === 'yes'),
    }),
    oohOn ? h('div', { class: 'qe-ooh-rows' }, ...oohRows) : null,
    oohOn
      ? kit.out((r) => {
        const o = r.outOfHours || {};
        if (!o.basis || !(o.basis.people > 0)) return h('p', { class: ['qe-note', 'is-warning'] }, `Falta el personal con su sueldo (en "${stepName('labor')}"): sin eso no se puede calcular la hora extra.`);
        return h('p', { class: 'qe-note' }, outOfHoursNoteText(r));
      }, { tag: 'div', allowEmpty: true })
      : null,
  ) : null;

  // 4. Guardia (opcional, al final): un fijo bajo por estar disponible + un plus por cada llamado.
  const feeNow = Number(quote.rules && quote.rules.availabilityFeeMonthly) > 0;
  const calloutNow = Number(quote.rules && quote.rules.calloutFeePerActivation) > 0;
  const guardCard = asksAvailability
    ? card(
      { title: 'Guardia (opcional)', subtitle: 'Sólo si el cliente te pide estar disponible aunque no te llame. Si salís cuando te llaman, en tu horario, dejalo en "No".', className: 'qe-guard-card' },
      yesNo({
        label: '¿El cliente te paga por estar de guardia?',
        name: 'guardOnOff',
        value: guardChosen ? 'yes' : 'no',
        no: { label: 'No, sin guardia', hint: 'Cobrás sólo lo que trabajás.' },
        yes: { label: 'Sí, con guardia', hint: 'Un fijo por estar disponible y un plus cuando te llaman.' },
        onChange: (v) => setActivityValue('availability', v === 'yes' ? '24/7' : 'none'),
      }),
      guardChosen || feeNow || calloutNow
        ? formGrid(2,
          kit.num('rules.availabilityFeeMonthly', {
            label: 'Guardia pasiva: fijo por mes',
            rule: 'money',
            unit: '$/mes',
            placeholder: 'Ej.: 500.000',
            hint: `Lo que cobrás por estar disponible, haya ${T.many} o no. Se suma a lo trabajado y baja la tarifa que necesitás por cada ${T.one}.`,
          }),
          kit.num('rules.calloutFeePerActivation', {
            label: `Guardia activa: plus por cada ${T.one}`,
            rule: 'money',
            unit: '$',
            placeholder: 'Ej.: 150.000',
            hint: `Un cargo fijo cada vez que te llaman y salís, además de las horas o los días trabajados.`,
          }))
        : null,
      !guardChosen && (feeNow || calloutNow) ? h('p', { class: 'qe-note' }, 'Aunque no haya guardia, estos cargos se siguen cobrando. Poné 0 si no corresponden.') : null,
      guardChosen
        ? h('p', { class: 'qe-note' }, `Si a tu gente le pagás un adicional por estar de guardia, sumalo en "${stepName('labor')}" → Adicionales: es parte de tu costo.`)
        : null,
      guardChosen
        ? kit.advanced(
          {
            key: 'guard-detail',
            title: 'Detalle de la guardia',
            summary: () => {
              const a = quote.activity || {};
              return [
                a.availability === AVAILABILITY_WINDOW ? 'en una franja' : '24/7',
                a.guardType === 'active' ? 'activa (en el lugar)' : a.guardType === 'passive' ? 'pasiva (localizable)' : null,
                hasNumber(a.availableDaysPerMonth) ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días de guardia por mes` : null,
                hasNumber(a.responseTimeHours) ? `respuesta en ${formatNumber(Number(a.responseTimeHours), { decimals: 1 })} h` : null,
              ].filter(Boolean).join(' · ');
            },
          },
          availabilityChoice,
          availabilityRow,
          formGrid(2,
            availableInGuard ? availableField() : null,
            kit.num('activity.responseTimeHours', {
              label: 'Tiempo máximo de respuesta',
              rule: 'hours',
              unit: 'h',
              hint: 'Desde el llamado hasta estar operativo en locación.',
            })),
        )
        : null,
    )
    : null;

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
        // Fijo mensual: "días para no perder" no aplica (se factura 1 abono): no se muestra.
        monthlyContract ? null : breakEvenStat,
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

  const question = monthlyContract
    ? kit.question('¿Qué cobertura vendés en el abono?', 'Los días y las horas de servicio que el cliente tiene cubiertos. Cuántas personas hacen falta, cómo rotan y cuánto cuestan sale de Personal (el esquema de cada puesto). Lo que exceda se cobra en "Adicionales".')
    : byQuantity
    ? kit.question(texts.quantityQuestion, `Los costos se calculan con los días de trabajo que lleva hacerlo; la facturación, con ${texts.los} ${info.plural}. Cuanto menos factures, mayor deberá ser la tarifa ${perText(info)} para cubrir los costos fijos.`)
    : kit.question('¿Cuánto esperás trabajar por mes?', 'Los días con trabajo y tu horario normal. Cuantos menos días trabajes, mayor tiene que ser la tarifa para pagar a tu gente y tus equipos.');

  // ¿Cómo viaja el personal? (PLAN-2026-024): reemplaza "Días entre viajes o relevos".
  const hasPeople = contract.labor || (Array.isArray(quote.labor) && quote.labor.length > 0);
  const savedPattern = quote.activity ? quote.activity.travelPattern : null;
  // Sin elegir (cotizaciones anteriores): se muestra lo que el motor ya usa, el número guardado:
  // 1 = "va y vuelve cada día"; otro = "otro intervalo" con su número a la vista.
  const storedDpa = quote.activity && hasNumber(quote.activity.daysPerActivation) ? Number(quote.activity.daysPerActivation) : 1;
  const travelPattern = ['daily', 'rotation', 'custom'].includes(savedPattern) ? savedPattern : Math.abs(storedDpa - 1) < 1e-9 ? 'daily' : 'custom';
  const relief = reliefFromLabor(quote.labor);
  const travelCard = monthlyContract && quote.serviceType !== 'permanent'
    ? card(
      { title: hasPeople ? '¿Cómo viaja el personal a la locación?' : '¿Cada cuánto hay un viaje a la locación?', subtitle: `Define cuántos viajes (movilización, viáticos y peajes ${T.per}) hay en el mes. No cambia sueldos ni dotación.` },
      choiceGroup({
        label: 'Viajes del personal',
        name: 'activity.travelPattern',
        value: ['daily', 'rotation', 'custom'].includes(travelPattern) ? travelPattern : null,
        disabled: kit.readOnly,
        // Sin diagramas (2026-11): "va y vuelve" o "se queda en campo" con los días entre viajes.
        // "Según el diagrama" sólo aparece en cotizaciones anteriores que lo eligieron (mismos números).
        options: [
          { value: 'daily', label: hasPeople ? 'Va y vuelve cada día de servicio' : 'Un viaje por día de servicio', hint: 'Un viaje por día (base cercana, trabajo de día).' },
          { value: 'custom', label: hasPeople ? 'Se queda en campo' : 'Cada varios días', hint: 'Cargás cada cuántos días hay un viaje (ida y vuelta).' },
          travelPattern === 'rotation'
            ? { value: 'rotation', label: 'Según el diagrama del puesto (anterior)', hint: relief ? `Un viaje cada ${num(relief.daysBetweenRelieves)} días. Elegí "Se queda en campo" para cargarlo vos.` : 'Elegí "Se queda en campo" para cargar los días entre viajes.' }
            : null,
        ].filter(Boolean),
        onChange: (v) => ctx.mutate((q) => {
          if (!q.activity || typeof q.activity !== 'object') q.activity = {};
          q.activity.travelPattern = v;
          // El número guardado sigue al patrón (lo leen otras pantallas); el motor lo deriva igual.
          if (v === 'daily') q.activity.daysPerActivation = 1;
          if (v === 'rotation' && relief) q.activity.daysPerActivation = roundRate(relief.daysBetweenRelieves);
        }),
      }),
      travelPattern === 'custom'
        ? formGrid(2, kit.num('activity.daysPerActivation', {
          label: 'Días entre viajes',
          rule: 'positiveDays',
          unit: 'días',
          placeholder: 'Ej.: 14',
          hint: `Cada cuántos días hay un viaje a la locación (por ejemplo 14 si el personal está 14 días en campo y vuelve). Cada viaje suma la movilización y los costos ${T.per}.`,
        }))
        : null,
      kit.out((r) => {
        const a = r.activity;
        if (travelPattern === 'rotation' && !relief) {
          return h('p', { class: ['qe-note', 'is-warning'] }, `Ningún puesto tiene un diagrama: elegí "Se queda en campo" y cargá los días entre viajes. Mientras tanto se usa un viaje cada ${num(a.daysPerActivation)} ${a.daysPerActivation === 1 ? 'día' : 'días'}.`);
        }
        return h('p', { class: 'qe-note' }, `${num(a.activationsPerMonth)} ${a.activationsPerMonth === 1 ? 'viaje' : 'viajes'} por mes (uno cada ${num(a.daysPerActivation)} ${a.daysPerActivation === 1 ? 'día' : 'días'}).`);
      }, { tag: 'div', allowEmpty: true }),
    )
    : null;

  mount(
    container,
    resourcesCard,
    modeCard,
    question,
    activityCard,
    travelCard,
    dedicationCard,
    outOfHoursCard,
    guardCard,
    // Por servicio prestado con mínimo mensual garantizado (PLAN-2026-018).
    // En $ o en unidades de cobro ("mínimo 20 días por mes", tanda B 2026-11, B-3).
    !contract.legacy && contract.mode === 'on_demand'
      ? (() => {
        const g = minimumGuaranteeFields(kit, quote, info, {
          amountLabel: 'Mínimo por mes',
          amountPlaceholder: 'Ej.: 3.000.000',
          amountHint: 'Si el cliente garantiza un piso por mes: se factura lo trabajado o el mínimo, lo que sea mayor. Vacío o 0 = sin mínimo.',
        });
        // Con título: "¿Cómo se expresa el mínimo?" sola no dice de qué mínimo se trata.
        return card({ title: 'Mínimo mensual garantizado (opcional)', className: 'qe-guarantee-card' }, formGrid(2, ...g.fields), g.note);
      })()
      : null,
    calcCard,
    extrasSection(ctx, contract),
  );
  return { update() {} };
}
