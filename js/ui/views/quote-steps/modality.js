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
import { convertMinimumCallUnits } from '../../../engines/commercial-rules-engine.js';
import { DEFAULT_MARGIN_LADDER } from '../../../config.js';
import { formatMoney, formatPercent, formatNumber, formatDays, EMPTY } from '../../../core/format.js';
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

const MODE_LABELS = Object.freeze({
  known_rate: 'Sí, ya tengo la tarifa',
  known_activity: 'No: calculá cuánto cobrar',
});

const AVAILABILITY_HINTS = Object.freeze({
  '24/7': 'Disponible todos los días, a toda hora. Normalmente exige relevos.',
  window: 'Disponible sólo unas horas por día acordadas.',
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
  const coverageShortcuts = monthlyContract && !kit.readOnly
    ? h('div', { class: 'qe-toolbar qe-coverage-shortcuts' },
      h('span', { class: 'small' }, 'Días:'),
      shortcut('activeDaysPerMonth', 22, 'Lun a vie (22)'),
      shortcut('activeDaysPerMonth', 26, 'Lun a sáb (26)'),
      shortcut('activeDaysPerMonth', 30, 'Todos los días (30)'),
      h('span', { class: 'small' }, 'Horas:'),
      ...[8, 9, 12, 24].map((n) => shortcut('hoursPerActiveDay', n, `${n} h`)))
    : null;
  return coverageShortcuts;
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
        minCallNote = ` Mínimo ${T.per}: ${minCallUnitText(minCall, from)} → ${minCallUnitText(minCallConverted, to)}.`;
      } else if (timeToTime) {
        minCallNote = ` Revisá el mínimo ${T.per} en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir (faltan las horas por día activo).`;
      } else {
        minCallNote = ` Revisá el mínimo ${T.per} en "${stepName('margin')}": quedó en ${formatNumber(minCall, { decimals: 2 })} sin convertir y ahora se lee en ${to.plural || 'la unidad nueva'}.`;
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
  const hoursField = () => kit.num('activity.hoursPerActiveDay', {
    label: monthlyContract ? 'Horas de servicio por día' : asksAvailability ? `Horas trabajadas por día con ${T.one}` : 'Horas por día de trabajo',
    rule: 'hoursPerDay',
    unit: 'h/día',
    hint: monthlyContract
      ? 'Las horas del día que el cliente tiene cubiertas (8, 12, 24…). No son las horas de cada persona: ésas salen del esquema de cada puesto en Personal. Se usan para el uso de equipos y la tarifa por hora.'
      : quote.unit === 'hour'
      ? `Cobrás por hora: se facturan días ${asksAvailability ? 'con trabajo' : 'activos'} × estas horas${asksAvailability ? ' (no las horas de guardia)' : ''}.`
      : 'Se usa para el uso de equipos, la tarifa por hora y la estructura por hora.',
  });
  const hourly = quote.unit === 'hour';
  const hoursInMain = hourly || monthlyContract || asksAvailability;
  const monthlyAvailableConflict = monthlyContract && hasNumber(quote.activity && quote.activity.availableDaysPerMonth)
    && hasNumber(quote.activity && quote.activity.activeDaysPerMonth)
    && Number(quote.activity.availableDaysPerMonth) < Number(quote.activity.activeDaysPerMonth) - 1e-9;
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
      );
    }
    // Por m³ / t / litro / barril / kg: con la capacidad del equipo, RATEOS calcula los viajes.
    const byCapacityUnit = CAPACITY_UNITS.includes(info.id);
    return formGrid(
      byCapacityUnit ? 3 : 2,
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
        onValue: () => syncRouteTrips(),
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
        ? `Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles: más días que los ${formatNumber(r.activity.availableDaysPerMonth)} disponibles.`
        : `Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles (utilización).`;
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
        ? ` Ojo: son más días que los ${formatNumber(r.activity.availableDaysPerMonth)} disponibles del mes.`
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
      return `Facturás ${billable} por mes${extra} en ${workDaysText(r.activity.activeDaysPerMonth)}. Trabajás el ${formatPercent(r.activity.utilizationPct)} de los días disponibles (utilización).${perIntervention}${fractional}${over}`;
    },
    tone: (r) => (hasQuantity() && r.activity.activeDaysPerMonth > r.activity.availableDaysPerMonth + 1e-9 ? 'orange' : null),
  });

  // Días disponibles: el techo de la utilización. Por días (on call, por día…)
  // va a la vista, al lado de los días trabajados: el aviso de más de 100 % sale
  // de comparar esos dos números y ninguno debe quedar escondido.
  const availableInMain = !byQuantity && !monthlyContract;
  const availableField = () => kit.num('activity.availableDaysPerMonth', {
    label: isOnCall ? 'Días disponibles (de guardia)' : 'Días disponibles en el mes',
    rule: 'daysInMonth',
    unit: 'días',
    placeholder: '30',
    hint: isOnCall
      ? `Días en que podés recibir ${T.many} (el máximo que podrías trabajar): 30 si estás de guardia todo el mes; 22 si sólo días hábiles.`
      : 'El máximo que podrías trabajar en el mes: normalmente 30 para servicios 24/7; 22 si sólo trabajás días hábiles.',
  });
  // Disponibilidad (A-16, H-26): a la vista, junto a los días, donde cambia algo (el aviso
  // de relevos de un servicio on call). Una cotización nueva la trae sin definir: nunca
  // 24/7 escondida. Con franja (2026-11) se cargan las horas de guardia por día como número
  // (antes era texto libre que la app no leía): avisa si se trabajan más horas que la franja.
  // No mueve costo ni facturación.
  const availability = quote.activity ? quote.activity.availability : null;
  const oldWindowText = quote.activity && typeof quote.activity.availabilityWindow === 'string' ? quote.activity.availabilityWindow.trim() : '';
  const availabilityRow = asksAvailability
    ? h('div', { class: 'qe-availability' },
      kit.choice('activity.availability', {
        label: h('span', {}, 'Disponibilidad requerida', infoTip(`Cuándo el cliente te puede convocar. No son las horas que facturás: ésas son las horas trabajadas por día con ${T.one}. 24/7 normalmente exige relevos del personal.`)),
        options: AVAILABILITY_OPTIONS.map((o) => ({ value: o.id, label: o.label, hint: AVAILABILITY_HINTS[o.id] })),
        structural: true,
      }),
      availability === AVAILABILITY_WINDOW
        ? formGrid(2, kit.num('activity.availabilityHoursPerDay', {
          label: 'Horas de guardia por día',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: 'Ej.: 12',
          hint: `Las horas del día en que el cliente puede convocarte (por ejemplo 12 h, de 7 a 19). Si trabajás más horas que éstas, el excedente es fuera de horario.`,
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
      availability
        ? kit.choice('activity.guardType', {
          label: h('span', {}, 'Tipo de guardia', infoTip('Activa: el personal está en la base o en la locación; esas horas cuentan como trabajo y piden relevos (horas de guardia del mes ÷ horas normales por persona, más francos y vacaciones; se revisa en Personal). Pasiva: está localizable y sale si lo convocan; se suele pagar un adicional de guardia y alcanza con rotar quién está de guardia.')),
          options: [
            { value: 'active', label: 'Activa (en el lugar)', hint: 'Cuentan como horas de trabajo.' },
            { value: 'passive', label: 'Pasiva (localizable)', hint: 'Sale sólo si lo convocan.' },
          ],
          structural: true,
        })
        : null,
      availability && quote.activity && quote.activity.guardType === 'active'
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
    availabilityRow,
    !byQuantity && quote.serviceType !== 'permanent' && !monthlyContract
      ? kit.activationPace({
        T,
        label: `¿Cómo son ${T.theMany} ${T.many}?`,
        hint: `${T.g('Una', 'Un')} ${T.one} es cada vez que ${isOnCall ? 'el cliente te convoca y salís a trabajar' : 'salís de la base a hacer un trabajo'}. ${T.Each} suma su movilización, el mínimo ${T.per} y los costos ${T.per}.`,
      })
      : null,
    byQuantity ? quantityKeyline : daysKeyline,
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
            availableInMain ? null : isFiniteNumber(Number(a.availableDaysPerMonth)) && a.availableDaysPerMonth !== null && a.availableDaysPerMonth !== '' ? `${formatNumber(Number(a.availableDaysPerMonth), { decimals: 2 })} días disponibles por mes` : 'días disponibles sin cargar',
            hoursInMain ? null : isFiniteNumber(Number(a.hoursPerActiveDay)) && a.hoursPerActiveDay !== null && a.hoursPerActiveDay !== '' ? `${formatNumber(Number(a.hoursPerActiveDay), { decimals: 2 })} h por día activo` : 'horas por día sin cargar',
            kind === 'quantity' && hasNumber(a.daysPerActivation) ? activationPaceText(Number(a.daysPerActivation), T) : null,
            isOnCall && isFiniteNumber(Number(a.responseTimeHours)) && a.responseTimeHours !== null && a.responseTimeHours !== '' ? `respuesta en ${formatNumber(Number(a.responseTimeHours), { decimals: 1 })} h` : null,
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
      kind === 'quantity'
        ? kit.activationPace({
          T,
          label: `¿Cómo son ${T.theMany} ${T.many}?`,
          hint: tripUnit
            ? `Viajes ${T.per} = viajes por día × días ${T.per}.`
            : `No es la unidad que cobrás: define cuántas ${T.many} (movilizaciones, mínimos ${T.per}) hay en el mes.`,
          onValue: () => syncRouteTrips(),
        })
        : null,
      isOnCall
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
        kit.stat('Utilización', (r) => formatPercent(r.activity.utilizationPct), { hint: byQuantity ? 'Días de trabajo ÷ días disponibles.' : 'Días activos ÷ días disponibles.' }),
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
    : kit.question('¿Cuántos días por mes esperás trabajar?', 'En servicios on-call, cuantos menos días trabajes, mayor deberá ser la tarifa para cubrir los costos fijos.', { term: 'utilización (días trabajados ÷ días disponibles)' });

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
    modeCard,
    question,
    activityCard,
    travelCard,
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
