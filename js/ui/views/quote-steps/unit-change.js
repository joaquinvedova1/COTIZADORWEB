/**
 * Cambio de la unidad de cobro con datos cargados (QA-E2E-08, UX-UNITS; UXR: la unidad se elige en
 * "Qué cotizás" y puede ser una variante por persona o por equipo, una unidad propia o el precio total).
 *
 * Tarifas (conocida y ofrecida), cantidad del mes, rendimiento y mínimo por llamado se convierten sólo con un
 * factor conocido (día ↔ hora con las horas por día; kg ↔ t y metro ↔ km, exactos) o se borran y se piden de
 * nuevo. Nunca se lee el mismo número en otra unidad (200 m³ no pasan a ser 200 viajes; $ 100.000 por hora de
 * la cuadrilla no pasan a ser $ 100.000 por hora-hombre).
 */

import { h } from '../../dom.js';
import { openDialog, button } from '../../components.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { applyUnit, currentApply, sameApply } from '../../../domain/unit-catalog.js';
import {
  rateNumeratorsFor, rateInputOf, isNativeRate, quantityFactorBetween, convertExact,
} from '../../../domain/unit-pairs.js';
import { convertRateUnit } from '../../../engines/pricing-engine.js';
import { convertMinimumCallUnits } from '../../../engines/commercial-rules-engine.js';
import { formatMoney, formatNumber, formatDays } from '../../../core/format.js';
import { isFiniteNumber } from '../../../core/money.js';
import { quantityText } from '../../unit-text.js';
import { activationTerms } from '../../../domain/activation-terms.js';
import { stepName } from './shared.js';

/** "por llamado", "por m³"… */
function perText(info) {
  return `por ${info.singular || 'unidad'}`;
}

/** ¿El mínimo por llamado se aplica con esta unidad? (no con abono ni por llamado/trabajo). */
export function minimumCallApplies(kind) {
  return kind === 'day' || kind === 'hour' || kind === 'quantity';
}

function positiveOrNull(v) {
  return isFiniteNumber(v) && v > 0 ? v : null;
}

/** "m³ por día de trabajo", "viajes por hora". */
function rateFormText(plural, denominator) {
  return `${plural} por ${denominator === 'hour' ? 'hora' : 'día de trabajo'}`;
}

/**
 * Diálogo: cada renglón dice cómo queda (se convierte con un factor conocido o se borra para cargarlo de
 * nuevo). → 'convert' | 'clear' | null.
 */
function askUnitChange({ from, to, items, convertible, explanation }) {
  return new Promise((resolve) => {
    let choice = null;
    const list = h('ul', {}, ...items.map((it) => h('li', {}, `${it.label}: ${it.before}${convertible && it.after ? ` → ${it.after}` : ''}`)));
    const { close } = openDialog({
      title: `Cambiar la unidad a ${to.label}`,
      content: h(
        'div',
        {},
        h('p', {}, `Hay datos cargados en ${from.label}. Si cambiás la unidad sin convertirlos, el mismo número se leería ${perText(to)} y el resultado sería engañoso.`),
        list,
        h('p', {}, explanation),
      ),
      actions: [
        button('Cancelar', { variant: 'secondary', onClick: () => close() }),
        button(convertible ? 'Borrar y cambiar' : 'Borrar y cargar de nuevo', { variant: convertible ? 'secondary' : 'primary', onClick: () => { choice = 'clear'; close(); } }),
        convertible ? button(`Convertir a ${to.label}`, { variant: 'primary', onClick: () => { choice = 'convert'; close(); } }) : null,
      ].filter(Boolean),
      onClose: () => resolve(choice),
    });
  });
}

/** La cotización como quedaría con otra unidad (sólo para leer rótulos). */
function withApply(quote, apply) {
  return applyUnit(structuredClone({ unit: quote.unit, unitName: quote.unitName, billingHorizon: quote.billingHorizon, activity: { ...(quote.activity || {}) } }), apply);
}

/**
 * Cambia la unidad de cobro de la cotización del editor. `apply` es lo que se guarda (ver unit-catalog.js).
 * Devuelve true si cambió.
 */
export async function changeUnitTo(ctx, apply) {
  const quote = ctx.quote;
  const before = currentApply(quote);
  if (sameApply(before, apply)) return false;
  const from = billingUnitOf(quote);
  const to = billingUnitOf(withApply(quote, apply));
  const T = activationTerms(quote);
  const pricing = quote.pricing || {};
  const activity = quote.activity || {};
  const hours = activity.hoursPerActiveDay;
  // Misma unidad base con otra variante (hora ↔ hora-hombre, día ↔ jornal…): la tarifa significa otra cosa y
  // no hay un factor seguro (depende de cuántas personas o equipos se facturan): se borra y se pide de nuevo.
  const variantOnly = from.kind === to.kind && quote.unit === apply.unit && (from.resource || null) !== (to.resource || null);
  // Precio total ↔ trabajos por mes: la tarifa sigue siendo por trabajo (no se convierte nada).
  const horizonOnly = quote.unit === 'job' && apply.unit === 'job';
  const timeToTime = !variantOnly && ['day', 'hour'].includes(from.kind) && ['day', 'hour'].includes(to.kind) && quote.unit !== apply.unit && !from.resource && !to.resource;
  const exactFactor = from.kind === 'quantity' && to.kind === 'quantity' && quote.unit !== 'custom' && apply.unit !== 'custom' ? quantityFactorBetween(quote.unit, apply.unit) : null;
  const factorNote = exactFactor === null ? '' : ['kg', 'ton'].includes(quote.unit) ? '1 t = 1.000 kg' : '1 km = 1.000 m';
  const minCall = Number(quote.rules && quote.rules.minimumCallUnits);
  const hasMinCall = Number.isFinite(minCall) && minCall > 0 && minimumCallApplies(from.kind) && !horizonOnly && (from.id !== to.id || variantOnly || from.singular !== to.singular);
  let minCallConverted = null;
  if (hasMinCall && timeToTime) minCallConverted = convertMinimumCallUnits(minCall, quote.unit, apply.unit, hours);
  else if (hasMinCall && exactFactor !== null) minCallConverted = convertExact(minCall, exactFactor);
  else if (hasMinCall && variantOnly) minCallConverted = minCall; // 4 h por llamado siguen siendo 4 h por persona o equipo.
  const minCallUnitText = (n, u) => {
    if (u.kind === 'hour') return `${formatNumber(n, { decimals: 2 })} ${Math.abs(n - 1) < 1e-9 ? 'hora' : 'horas'}`;
    if (u.kind === 'day') return formatDays(n);
    return quantityText(n, { unitInfo: u });
  };
  let minCallNote = '';
  // Un mínimo que no se puede convertir se borra (nunca se lee en la unidad nueva) y se vuelve a pedir.
  const minCallLost = hasMinCall && !isFiniteNumber(minCallConverted);
  if (hasMinCall) {
    if (!minCallLost && !variantOnly) minCallNote = ` Mínimo ${T.per}: ${minCallUnitText(minCall, from)} → ${minCallUnitText(minCallConverted, to)}.`;
    else if (minCallLost) minCallNote = ` El mínimo ${T.per} (${formatNumber(minCall, { decimals: 2 })} en ${from.plural || 'la unidad anterior'}) se borró: cargalo de nuevo en ${to.plural || 'la unidad nueva'}.`;
  }
  const applyMinCall = (q) => {
    if (!hasMinCall || !q.rules) return;
    q.rules.minimumCallUnits = minCallLost ? null : minCallConverted;
  };
  const rates = horizonOnly ? [] : [
    { path: 'knownRate', label: 'Tarifa conocida', value: Number(pricing.knownRate) },
    { path: 'offeredRateOverride', label: `Tarifa ofrecida a mano (en "${stepName('margin')}")`, value: Number(pricing.offeredRateOverride) },
  ].filter((r) => pricing[r.path] !== null && pricing[r.path] !== '' && Number.isFinite(r.value) && r.value > 0);
  rates.forEach((r) => {
    if (timeToTime) r.converted = convertRateUnit(r.value, quote.unit, apply.unit, hours);
    else if (exactFactor !== null) r.converted = convertExact(r.value, 1 / exactFactor);
    else r.converted = null;
    r.before = `${formatMoney(r.value)} ${perText(from)}`;
    r.after = isFiniteNumber(r.converted) ? `${formatMoney(r.converted)} ${perText(to)}` : null;
  });
  // Cantidad del mes y rendimiento: están en la unidad de cobro. Entre día y hora no se usan; en cualquier
  // otro cambio se convierten con un factor exacto o se borran.
  const quantityKinds = ['quantity', 'event'];
  const touchesQuantities = !horizonOnly && (quantityKinds.includes(from.kind) || quantityKinds.includes(to.kind)) && (quote.unit !== apply.unit || from.singular !== to.singular);
  const inFrom = quantityKinds.includes(from.kind);
  const qty = touchesQuantities ? positiveOrNull(Number(activity.billableQuantityPerMonth)) : null;
  const perDay = touchesQuantities ? positiveOrNull(Number(activity.unitsPerActiveDay)) : null;
  const quantities = [];
  if (qty !== null) {
    const converted = exactFactor !== null ? convertExact(qty, exactFactor) : null;
    quantities.push({
      path: 'billableQuantityPerMonth',
      label: 'Cantidad del mes',
      value: qty,
      converted,
      before: inFrom ? `${quantityText(qty, { unitInfo: from })} por mes` : `${formatNumber(qty, { decimals: 2 })} (de una unidad anterior)`,
      after: converted !== null ? `${quantityText(converted, { unitInfo: to })} por mes` : null,
    });
  }
  if (perDay !== null) {
    const converted = exactFactor !== null ? convertExact(perDay, exactFactor) : null;
    const input = from.kind === 'quantity' ? rateInputOf(activity, from) : null;
    const shownBefore = input && input.value !== null && !isNativeRate(input, from)
      ? `${formatNumber(input.value, { decimals: 2 })} ${rateFormText(rateNumeratorsFor(from).find((n) => n.id === input.numerator).plural, input.denominator)}`
      : `${formatNumber(perDay, { decimals: 2 })} ${from.kind === 'quantity' ? rateFormText(from.plural, 'day') : '(de una unidad anterior)'}`;
    quantities.push({
      path: 'unitsPerActiveDay',
      label: 'Rendimiento',
      value: perDay,
      converted,
      before: shownBefore,
      after: converted !== null ? `${formatNumber(converted, { decimals: 2 })} ${rateFormText(to.plural, 'day')}` : null,
    });
  }
  const tone = minCallLost ? 'warning' : 'success';
  const items = [...rates, ...quantities];
  // Lo que queda de la forma de carga (UX-UNITS): se quita si los datos cambian de unidad o se borran.
  const resetInputs = (q, { keepWorkdays }) => {
    if (!q.activity) return;
    if (q.activity.rateInput) q.activity.rateInput = null;
    if (!keepWorkdays && q.activity.quantityInput) q.activity.quantityInput = null;
  };
  // Precio total del trabajo: la actividad es UN trabajo (la cantidad por mes vale 1 para versiones anteriores).
  // "Días por llamado" y "días de todo el trabajo" se guardan en el mismo dato: al entrar o salir del precio total
  // no se reinterpreta (1 día por salida no pasa a ser una obra de 1 día, ni 66 días de obra 66 días por salida).
  // Entre "trabajo (por mes)" y precio total el dato significa lo mismo (días de cada trabajo) y se conserva.
  const wasJobTotal = quote.unit === 'job' && quote.billingHorizon === 'job';
  const toJobTotal = apply.unit === 'job' && apply.billingHorizon === 'job';
  const applyHorizon = (q) => {
    q.activity = q.activity || {};
    if (toJobTotal) {
      q.activity.billableQuantityPerMonth = 1;
      if (quote.unit !== 'job') {
        q.activity.daysPerActivation = null;
        q.activity.activationProfile = null;
      }
    } else if (wasJobTotal && apply.unit !== 'job') {
      q.activity.daysPerActivation = 1;
    }
  };
  if (items.length === 0) {
    ctx.mutate((q) => {
      applyUnit(q, apply);
      applyMinCall(q);
      applyHorizon(q);
    });
    if (minCallNote) ctx.toast(`Unidad cambiada a ${to.label}.${minCallNote}`, tone);
    return true;
  }
  const convertible = items.every((it) => isFiniteNumber(it.converted));
  let explanation;
  if (convertible && timeToTime) {
    explanation = `Podés convertirla con las ${formatNumber(Number(hours), { decimals: 2 })} horas trabajadas por día (${quote.unit === 'day' ? '÷' : '×'} ${formatNumber(Number(hours), { decimals: 2 })}, redondeado hacia arriba) o borrarla y cargarla de nuevo.`;
  } else if (convertible) {
    explanation = `Podés convertirlos con el factor exacto (${factorNote}) o borrarlos y cargarlos de nuevo.`;
  } else if (variantOnly) {
    explanation = `Una tarifa ${perText(from)} y una ${perText(to)} no son lo mismo (depende de cuántas personas o equipos facturás): se borra y la cargás de nuevo.`;
  } else {
    explanation = `Entre estas unidades no hay una conversión segura: se borran y los cargás de nuevo en ${to.plural || 'la unidad nueva'}.`;
  }
  const choice = await askUnitChange({ from, to, items, convertible, explanation });
  if (choice === 'convert' && convertible) {
    ctx.mutate((q) => {
      applyUnit(q, apply);
      applyMinCall(q);
      applyHorizon(q);
      rates.forEach((r) => {
        q.pricing[r.path] = r.converted;
      });
      quantities.forEach((it) => {
        q.activity[it.path] = it.converted;
      });
      // Con un factor exacto los días de trabajo no cambian.
      if (quantities.length) resetInputs(q, { keepWorkdays: true });
    });
    ctx.toast(`Unidad cambiada a ${to.label}. ${items.map((it) => `${it.label}: ${it.after}`).join(' · ')}.${minCallNote}`, tone);
    return true;
  }
  if (choice === 'clear') {
    ctx.mutate((q) => {
      applyUnit(q, apply);
      applyMinCall(q);
      applyHorizon(q);
      rates.forEach((r) => {
        q.pricing[r.path] = r.path === 'knownRate' ? 0 : null;
      });
      quantities.forEach((it) => {
        q.activity[it.path] = null;
      });
      if (quantities.length) resetInputs(q, { keepWorkdays: false });
    });
    const cleared = [rates.length ? 'la tarifa' : null, ...quantities.map((it) => (it.path === 'unitsPerActiveDay' ? 'el rendimiento' : 'la cantidad del mes'))].filter(Boolean);
    const what = cleared.length > 1 ? `Se borraron ${cleared.slice(0, -1).join(', ')} y ${cleared[cleared.length - 1]}` : `Se borró ${cleared[0]}`;
    ctx.toast(`Unidad cambiada a ${to.label}. ${what}: cargá los datos de nuevo en ${to.label}.${minCallNote}`, 'warning');
    return true;
  }
  // Cancelado: vuelve a mostrar la unidad anterior.
  ctx.rerender();
  return false;
}
