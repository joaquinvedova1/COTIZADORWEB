/**
 * Etapa 2 · Los recursos — "Insumos y materiales" (PLAN-2026-027, 0.22.0): UNA sola lista.
 * Cada línea tiene un Tipo (material que queda en la obra, insumo o consumible, herramienta menor,
 * EPP especial u otro gasto) que se elige una vez, en Recursos, y viaja con la línea. Sin
 * secciones ni "Va a": el tipo dice en qué parte del renglón "Insumos y materiales" suma.
 * Básico: qué es, tipo, cantidad, unidad, cada cuánto, costo unitario y quién lo provee.
 * Más detalle: merma, logística (y, sólo en cotizaciones que ya lo tenían, facturar aparte).
 *   costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%)
 *   (si lo provee el cliente, no es costo nuestro)
 * Los "otros costos" guardados antes (otherCosts[]) se ven en "Gastos cargados antes": siguen
 * sumando igual, no se crean nuevos y los que suman en este renglón se pueden "Pasar a la lista"
 * con el mismo costo (otherCostToMaterialLine). El motor no cambia.
 */

import { h, mount } from '../../dom.js';
import { button, card, formGrid, selectField, table, confirmDialog } from '../../components.js';
import { QUOTE_MATERIAL_BASES, MATERIAL_PROVIDERS, COST_BEHAVIORS, COST_CATEGORIES, DIRECT_CATEGORY_IDS, MATERIAL_UNIT_PRESETS, vatIsCost } from '../../../domain/catalogs.js';
import { materialLineFromLibrary, blankMaterialLine, otherCostToMaterialLine } from '../../../domain/quote-factory.js';
import { formatMoney, formatPercent, formatNumber, EMPTY } from '../../../core/format.js';
import { workDaysText } from '../../unit-text.js';
import { closedJobsPerMonth, isClosedPrice, lineMonthAtEstimate } from '../../result-text.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, hasNumber, stepName } from './shared.js';
import { baseFields, lineOriginBlock, offerPeriodOf, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { lineComponentOf } from '../../../domain/contract.js';
import { MATERIAL_TYPES, MATERIAL_TYPE_IDS, DEFAULT_BLANK_TYPE, defaultMaterialBasis, materialTypeLabel, materialTypeShort, resourceMaterialType } from '../../../domain/material-types.js';
import { costRowLabel } from '../../cost-breakdown.js';

/** Nombre con que se titula una línea todavía sin nombre ("Insumo sin nombre"). */
const NEW_LINE_NAMES = Object.freeze({ tools: 'Herramienta', supplies: 'Insumo', materials: 'Material', ppe: 'EPP', other: 'Gasto' });
/** Ejemplo que se ve en "¿Qué es?" mientras está vacío (0.15.0): una línea nueva no nace con un nombre cargado. */
const exampleOf = (type) => (MATERIAL_TYPES.find((t) => t.id === type) || {}).example || 'Ej.: electrodos, juntas, gas';
/** Opciones del selector "Tipo" (con lo que entra en cada uno, como ayuda). */
const TYPE_OPTIONS = MATERIAL_TYPES.map((t) => ({ value: t.id, label: t.label }));
/** Renglones a los que un gasto cargado antes puede ir con su índice propio (se avisa en la fila). */
const INDEXED_ELSEWHERE = Object.freeze(['labor', 'equipment', 'external', 'fuel', 'logistics']);
import { baseText } from '../../economic-base-ui.js';
import { CURRENCIES } from '../../../domain/catalogs.js';
import { conversionFactor } from '../../../engines/currency-engine.js';
import { activationTerms, withActivationOptions } from '../../../domain/activation-terms.js';
import { billingUnitOf, pluralizeUnit } from '../../../domain/billing-units.js';
import { onSessionReset } from '../../session-memory.js';
import { normalizeBasisId } from '../../../engines/materials-engine.js';

/**
 * Tipo elegido para la próxima línea en blanco (decisión D1): "Insumo o consumible" al empezar y,
 * después, el último usado. Sólo en la memoria de la pantalla (se olvida al cerrar la sesión).
 */
let lastBlankType = DEFAULT_BLANK_TYPE;
onSessionReset(() => { lastBlankType = DEFAULT_BLANK_TYPE; });

/**
 * ¿La cotización ya facturaba materiales aparte? (regla de un ítem, 2026-11-18): la opción general
 * o algún material marcado "se factura aparte". Sólo entonces se muestran esas opciones.
 */
export function materialsBilledBefore(quote = {}) {
  if (quote && quote.pricing && quote.pricing.materialsBilledSeparately === true) return true;
  return (Array.isArray(quote && quote.materials) ? quote.materials : []).some((m) => m && m.billedSeparately === true);
}

/** "por mes", "por día de trabajo", "por llamado" / "por salida"… (la activación con el nombre de la cotización, PLAN-2026-014). */
const basisShort = (basis, T, out = 'unidad') => ({ per_month: 'por mes', per_active_day: 'por día de trabajo', per_activation: T.per, per_output: `por ${out}` }[basis] || basis);
/** "/día", "/mes", "/salida", "/válvula" (cada cuánto se consume la cantidad). */
const basisPer = (basis, T, out = 'unidad') => ({ per_month: 'mes', per_active_day: 'día', per_activation: T.one, per_output: out }[basis] || 'mes');

/**
 * Unidad producida de una línea "por unidad producida" (PLAN-2026-021): la
 * propia de la línea o, si no, la unidad en que se cobra (por cantidad, hora,
 * día, llamado, trabajo o hito: PLAN-2026-022). Por mes no hay una: "unidad".
 */
export function outputUnitOf(line = {}, quote = {}) {
  const own = String((line && line.outputUnit) || '').trim();
  if (own) return own;
  const u = billingUnitOf(quote);
  if (u.kind !== 'month') return u.singular;
  return 'unidad';
}

/** Plural de la unidad producida de una línea ("válvulas", "m²", "PSV"). */
export function outputPluralOf(line = {}, quote = {}) {
  const own = String((line && line.outputUnit) || '').trim();
  if (own) return pluralizeUnit(own);
  const u = billingUnitOf(quote);
  return u.kind !== 'month' ? u.plural : 'unidades';
}

/** ¿Se cobra por día o por hora? (V-07: ahí "unidad producida" vacía no es una unidad de producción). */
const billsByTime = (quote) => ['day', 'hour'].includes(billingUnitOf(quote).kind);

/**
 * Rótulo de "Producción por día" de una línea (V-07): cobrando por día o por hora sin unidad
 * escrita, "unidades/día" (nunca "día/día" ni "hora/día").
 */
export function outputPerDayUnitLabel(line = {}, quote = {}) {
  const own = String((line && line.outputUnit) || '').trim();
  if (!own && billsByTime(quote)) return 'unidades/día';
  return `${outputUnitOf(line, quote)}/día`;
}

/**
 * Unidad producida para mostrar (revisión UX, V-07): cobrando por día o por hora sin unidad
 * escrita, "unidad" / "unidades" (nunca "día/día" ni "cada día lo usa").
 */
export function outputUnitShownOf(line = {}, quote = {}) {
  const own = String((line && line.outputUnit) || '').trim();
  if (!own && billsByTime(quote)) return 'unidad';
  return outputUnitOf(line, quote);
}

/** Plural de outputUnitShownOf ("unidades", "hectáreas", "m³"). */
export function outputPluralShownOf(line = {}, quote = {}) {
  const own = String((line && line.outputUnit) || '').trim();
  if (!own && billsByTime(quote)) return 'unidades';
  return outputPluralOf(line, quote);
}

/** ¿La cotización ya sabe cuánto se produce por día? (toda unidad de cobro salvo el abono mensual). */
const autoOutputKnown = (quote) => billingUnitOf(quote).kind !== 'month';
/** Valor del selector de unidad para "Otra / personalizada". */
const CUSTOM_UNIT = '__custom';
/** Líneas en las que la persona eligió "Otra…" y todavía no escribió la unidad (sólo en pantalla). */
const customUnitLines = new Set();
onSessionReset(() => customUnitLines.clear());

/**
 * La cuenta visible de una línea (PLAN-2026-010, no cambia el cálculo):
 *   "10 L/día × $ 5.000/L = $ 50.000/día · 20 días = $ 1.000.000/mes"
 */
export function materialFormulaText(line, model, { activeDays = 0, activationsPerMonth = 0, terms = activationTerms(), outputUnit = 'unidad', outputPlural = null, jobsPerMonth = null, closed = false, outputMissingText = 'falta la producción por día' } = {}) {
  if (!line || !model) return '';
  const unit = String(line.unit || '').trim() || 'u.';
  const per = basisPer(model.basis, terms, outputUnit);
  const factor = model.quantity * model.unitCost > 0 ? model.grossCost / (model.quantity * model.unitCost) : 1;
  const extras = Math.abs(factor - 1) > 1e-9 ? ' (con merma y logística)' : '';
  const head = `${formatNumber(model.quantity, { decimals: 2 })} ${unit}/${per} × ${formatMoney(model.unitCost, { decimals: model.unitCost < 100 ? 2 : 0 })}/${unit}${extras} = ${formatMoney(model.grossCost)}/${per}`;
  // Precio cerrado (Joaco 2026-11-18): todo en el trabajo, no por mes.
  const jobs = jobsPerMonth !== null && jobsPerMonth > 0 ? jobsPerMonth : null;
  if (closed) {
    if (model.basis === 'per_activation') return `${head.slice(0, head.length - `/${per}`.length)} en el trabajo`;
    if (jobs === null) return `${head} · cargá cuántos trabajos y de cuántos días en "${stepName('service')}" para ver lo del trabajo`;
    const daysPerJob = activeDays / jobs;
    const daysText = `${formatNumber(daysPerJob, { decimals: 2 })} ${Math.abs(daysPerJob - 1) < 1e-9 ? 'día' : 'días'} de trabajo`;
    if (model.basis === 'per_active_day') return `${head} · ${daysText} = ${formatMoney(model.grossCost * daysPerJob)} en el trabajo`;
    if (model.basis === 'per_output') {
      const perUnit = model.usageShare < 1 - 1e-9 ? model.costPerOutputUnit : model.grossCost;
      const perDay = model.outputPerActiveDay || 0;
      if (!(perDay > 0)) return `${head} · ${outputMissingText}`;
      return `${head} · ${formatNumber(perDay * daysPerJob, { decimals: 2 })} ${outputPlural || pluralizeUnit(outputUnit)} en ${daysText} = ${formatMoney(perUnit * perDay * daysPerJob)} en el trabajo`;
    }
    return `${head} · con ${daysText} en el trabajo`;
  }
  if (model.basis === 'per_active_day') return `${head} · ${formatNumber(activeDays, { decimals: 2 })} días = ${formatMoney(model.grossCost * activeDays)}/mes`;
  if (model.basis === 'per_output') {
    // % de las unidades que lo usan (PLAN-2026-022): costo promedio por unidad producida.
    const partial = model.usageShare < 1 - 1e-9;
    const share = partial ? ` × ${formatPercent(model.usageShare * 100)} que lo usan = ${formatMoney(model.costPerOutputUnit)}/${per} promedio` : '';
    const perUnit = partial ? model.costPerOutputUnit : model.grossCost;
    const perDay = model.outputPerActiveDay || 0;
    if (!(perDay > 0)) return `${head}${share} · ${outputMissingText}`;
    // "40 hectáreas/día", no "40 hectárea/día" (revisión UX).
    const perDayUnit = Math.abs(perDay - 1) < 1e-9 ? outputUnit : outputPlural || pluralizeUnit(outputUnit);
    // 0.15.0: sin días de trabajo todavía no se muestra "× 0 días = $ 0/mes" (parecía un error).
    if (!(activeDays > 0)) return `${head}${share} · ${formatNumber(perDay, { decimals: 2 })} ${perDayUnit}/día · lo del mes sale cuando cargues los días de trabajo`;
    return `${head}${share} · ${formatNumber(perDay, { decimals: 2 })} ${perDayUnit}/día × ${formatNumber(activeDays, { decimals: 2 })} días = ${formatMoney(perUnit * perDay * activeDays)}/mes`;
  }
  if (model.basis === 'per_activation') return `${head} · ${formatNumber(activationsPerMonth, { decimals: 2 })} ${terms.word(activationsPerMonth)} = ${formatMoney(model.grossCost * activationsPerMonth)}/mes`;
  return head;
}

function splitLabel(line, perUnitText = null, r = null) {
  if (!line) return EMPTY;
  // Precio cerrado (Joaco 2026-11-18): lo del trabajo, no "fijo / mes" ni "/ día de trabajo".
  const jobs = closedJobsPerMonth(r);
  if (jobs !== null) return `${formatMoney(lineMonthAtEstimate(r, line) / jobs)} en el trabajo`;
  if (perUnitText && Number.isFinite(line.costPerOutputUnit)) return `${formatMoney(line.costPerOutputUnit)} ${perUnitText} · ${formatMoney(line.monthlyAtEstimate)} / mes`;
  if (line.fixedMonthly > 0) return `${formatMoney(line.fixedMonthly)} fijo / mes`;
  if (line.variablePerActiveDay > 0) return `${formatMoney(line.variablePerActiveDay)} / día de trabajo`;
  return formatMoney(0);
}

function materialsTrace(result, T, quote) {
  const lines = result.model.materials.lines;
  const row = result.eecc.rows.find((r) => r.category === 'materials');
  const perUnit = lines.some((l) => l.basis === 'per_output');
  return createTrace({
    id: 'materials',
    title: 'Insumos y materiales',
    formula: `Costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%) · Por mes → fijo; por día de trabajo → variable; ${T.per} → variable ÷ días ${T.per}${perUnit ? ' · por unidad producida → costo × % de las unidades que lo usan × unidades producidas por día' : ''} · Si lo provee el cliente, no es costo nuestro`,
    inputs: lines.map((l, i) => ({ label: `${l.description || 'Material'} (${materialTypeShort(l.component)}, ${basisShort(l.basis, T, outputUnitOf((quote.materials || [])[i], quote))}${l.basis === 'per_output' && l.usageShare < 1 - 1e-9 ? `, ${formatPercent(l.usageShare * 100)} de las unidades` : ''})`, value: l.costForUs, format: 'money' })),
    steps: [
      { label: 'Fijo mensual de insumos y materiales', value: result.model.materials.fixedMonthly, format: 'money' },
      { label: 'Variable por día de trabajo', value: result.model.materials.variablePerActiveDay, format: 'money' },
      { label: 'Días de trabajo', value: result.activity.activeDaysPerMonth, format: 'days' },
    ],
    result: { label: 'Insumos y materiales en la estructura de costos (incluye los gastos cargados antes que suman en este renglón)', value: row ? row.amount : null, format: 'money' },
    notes: materialsBilledBefore(quote) ? ['El precio de reventa con markup es sólo informativo: sirve si facturás materiales aparte. No cambia el costo.'] : [],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  // Una magnitud, un nombre por cotización: llamado / salida / intervención… (PLAN-2026-014, LAB-D8).
  const T = activationTerms(quote);
  // Por unidad producida (PLAN-2026-022): la unidad de la cotización, para "% de válvulas que lo usan".
  const unitInfo = billingUnitOf(quote);
  const library = Array.isArray(resources.materials) ? resources.materials : [];
  const notApplicable = Boolean(quote.materialsNotApplicable);
  // Revisión 0.10.0 (U3): "¿Cada cuánto se consume?" en la unidad de cobro. Por cantidad, "por unidad
  // producida" se llama como la unidad ("Por diagnóstico") y va primera. Por llamado o trabajo, la
  // activación ES la unidad ("Por trabajo"): va primera y "por unidad producida" (lo mismo) sólo se
  // ve si una línea ya la usa. "Por llamado / intervención" no se ofrece en cotizaciones por
  // componentes que no cobran por llamado o trabajo (salvo en una línea que ya lo usa).
  const withComponents = Boolean(quote.contract && Array.isArray(quote.contract.components));
  const byQuantityUnit = unitInfo.kind === 'quantity';
  const byEventUnit = unitInfo.kind === 'event';
  const basisChoices = (catalog, current, { perOutputAllowed = true } = {}) => {
    const list = withActivationOptions(catalog, T).map((b) => ({ value: b.id, label: b.label }));
    const used = normalizeBasisId(current);
    const keepActivation = !withComponents || byEventUnit || used === 'per_activation';
    const keepOutput = perOutputAllowed && (!byEventUnit || used === 'per_output' || unitInfo.id === 'milestone');
    const out = list.filter((o) => (o.value !== 'per_activation' || keepActivation) && (o.value !== 'per_output' || keepOutput))
      .map((o) => (o.value === 'per_output' && byQuantityUnit ? { ...o, label: `Por ${unitInfo.singular || 'unidad'}` } : o));
    const first = byQuantityUnit ? 'per_output' : byEventUnit ? 'per_activation' : null;
    return first ? [...out.filter((o) => o.value === first), ...out.filter((o) => o.value !== first)] : out;
  };

  /** Material de Recursos de una línea (por su foto o su origen), o null. */
  const masterOf = (line) => {
    const id = (line && line.snapshot && line.snapshot.resourceId) || (line && line.sourceId) || null;
    return id ? library.find((m) => m && m.id === id) || null : null;
  };

  /**
   * Agrega un material de Recursos (P-03, PLAN-2026-027): con su tipo, su precio y su fecha base;
   * la cantidad vacía (se pide acá) y la base de la unidad en que se cobra, nunca la del maestro.
   */
  const addFromLibrary = (selectedId) => {
    const mat = library.find((m) => m.id === selectedId);
    if (!mat) {
      ctx.toast('Elegí un material de la lista para agregarlo.', 'warning');
      return;
    }
    const line = materialLineFromLibrary(mat, { now: new Date().toISOString(), currency: quoteCurrencyOf(quote) });
    line.basis = defaultMaterialBasis(quote, resourceMaterialType(mat) || 'materials');
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.quantity` });
    ctx.toast(`Se agregó «${line.description}» con su precio de Recursos. Cargá cuánto usás ${basisShort(line.basis, T, outputUnitShownOf(line, quote))}.`, 'success');
  };
  const removeMaterial = async (index) => {
    const line = quote.materials[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar de la lista', name: line.description || 'Material' });
    if (ok) ctx.mutate((q) => q.materials.splice(index, 1));
  };
  /** "Guardar este tipo en Recursos": el tipo se elige una vez y lo heredan las próximas líneas. */
  const saveTypeInResources = async (mat, type) => {
    const service = ctx.app && ctx.app.ctx && ctx.app.ctx.resources;
    if (!service || typeof service.save !== 'function') return;
    try {
      const saved = await service.save('materials', { ...mat, component: type });
      mat.component = (saved && saved.component) || type;
      ctx.toast(`«${mat.description || 'Material'}» quedó como ${materialTypeLabel(type).toLowerCase()} en Recursos.`, 'success');
      ctx.rerender();
    } catch {
      ctx.toast('No se pudo guardar el tipo en Recursos. Probá de nuevo o elegilo en Recursos → Insumos y materiales.', 'error');
    }
  };

  // Horas y materiales (PLAN-2026-009): los materiales se pueden facturar
  // aparte, al costo más el markup de reventa de cada uno. Siguen siendo
  // costo; lo que se cobra por ellos suma a la facturación.
  const billedSeparately = !notApplicable && Boolean(quote.pricing && quote.pricing.materialsBilledSeparately === true);
  // Por línea (tanda A 2026-11, A-8): true / false / sin definir (= sigue la opción de arriba).
  const lineBilled = (m) => (m && (m.billedSeparately === true || m.billedSeparately === false) ? m.billedSeparately : billedSeparately);
  const anyBilled = !notApplicable && (quote.materials || []).some((m) => lineBilled(m));
  // Regla de un ítem (2026-11-18): una cotización nueva no ofrece facturar materiales aparte (un
  // solo precio). Sólo la que ya lo tenía elegido lo sigue mostrando (mismos números), con Quitar.
  const legacyBilled = materialsBilledBefore(quote);
  const removeBilled = async () => {
    const ok = await confirmDialog({
      title: 'Dejar de facturar los materiales aparte',
      message: 'Los materiales quedan dentro de tu único precio. El precio se vuelve a calcular sin ese cobro aparte.',
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    ctx.mutate((q) => {
      if (q.pricing && typeof q.pricing === 'object') q.pricing.materialsBilledSeparately = false;
      (q.materials || []).forEach((m) => { if (m && m.billedSeparately === true) delete m.billedSeparately; });
    });
  };
  const toggleCard = card(
    {},
    kit.check('materialsNotApplicable', { label: 'El servicio no usa insumos ni materiales', structural: true, hint: 'Marcalo para confirmar que no te olvidaste de cargarlos.' }),
    notApplicable || !legacyBilled
      ? null
      : kit.check('pricing.materialsBilledSeparately', {
        label: 'Le facturo los materiales aparte al cliente (cargado antes)',
        structural: true,
        hint: quote.serviceType === 'time_materials'
          ? 'Horas y materiales: la tarifa cubre la mano de obra y los equipos; los materiales se cobran aparte, a su costo × (1 + markup de reventa de cada uno). Si sólo facturás algunos, elegilo en cada material ("Más detalle").'
          : 'La tarifa cubre el resto del servicio; los materiales se cobran aparte, a su costo × (1 + markup de reventa de cada uno). Si sólo facturás algunos, elegilo en cada material ("Más detalle").',
      }),
    !notApplicable && legacyBilled && !kit.readOnly
      ? h('div', { class: 'qe-toolbar' },
        h('p', { class: 'qe-note' }, 'Esta cotización ya facturaba materiales aparte: se sigue cobrando igual. Las cotizaciones nuevas ya no lo ofrecen (un solo precio).'),
        kit.action('Quitar', removeBilled, { variant: 'ghost', icon: 'trash' }))
      : null,
    anyBilled
      ? kit.out((r) => {
        const c = r.estimate.revenue.components;
        const billed = (c.materialsFixed || 0) + (c.materialsVariable || 0);
        const n = (quote.materials || []).filter((m) => lineBilled(m)).length;
        const which = billedSeparately && n === (quote.materials || []).length ? '' : ` (${n} ${n === 1 ? 'material' : 'materiales'}: se elige en cada uno, en "¿Se factura aparte?")`;
        const jobs = closedJobsPerMonth(r);
        const amountText = jobs !== null ? `${formatMoney(billed / jobs)} en el trabajo` : `${formatMoney(billed)} por mes`;
        return `Se facturan aparte ${amountText} de materiales${which} (con la actividad estimada). Siguen siendo costo: lo que cobrás por ellos suma a la facturación y baja la tarifa que necesitás.`;
      }, { tag: 'p', className: 'qe-note' })
      : null,
  );

  /** Tipo de la línea frente al de Recursos: "En Recursos es…" o "Elegilo una vez en Recursos…". */
  const typeNote = (line, i) => {
    const master = masterOf(line);
    if (!master) return null;
    const own = lineComponentOf(line, 'material');
    const inResources = resourceMaterialType(master);
    if (inResources && inResources !== own) {
      return h('p', { class: 'qe-note qe-type-note' },
        `En Recursos es ${materialTypeLabel(inResources).toLowerCase()}. `,
        kit.readOnly ? null : kit.action('Usar el de Recursos', () => ctx.mutate((q) => { if (q.materials[i]) q.materials[i].component = inResources; }), { variant: 'link' }));
    }
    if (!inResources) {
      return h('p', { class: 'qe-note qe-type-note' },
        'Elegilo una vez en Recursos → Insumos y materiales. ',
        kit.readOnly ? null : kit.action('Guardar este tipo en Recursos', () => saveTypeInResources(master, own), { variant: 'link' }));
    }
    return null;
  };

  const materialCard = (line, i) => {
      const p = `materials.${i}`;
      const at = (r) => r.model.materials.lines[i];
      // Valores copiados de una plantilla o material de demostración (UX-02).
      const ill = kit.lineIllustrative(p, { what: 'este material' });
      const illustrative = ill.marked;
      const cur = line.base && line.base.currency;
      const sym = (CURRENCIES.find((c) => c.id === cur) || { symbol: '$' }).symbol;
      const noRate = cur && conversionFactor(cur, quote) === null;
      // Unidad visible en la línea (PLAN-2026-010): presets + "Otra / personalizada".
      const unitNow = String(line.unit || '').trim();
      const unitIsPreset = MATERIAL_UNIT_PRESETS.includes(unitNow);
      const lineKey = line.id || `i${i}`;
      const showCustomUnit = (unitNow && !unitIsPreset) || customUnitLines.has(lineKey);
      const unitSelect = selectField({
        label: 'Unidad',
        name: `${p}.unitPreset`,
        value: showCustomUnit ? CUSTOM_UNIT : unitNow,
        includeEmpty: true,
        emptyLabel: 'Elegí la unidad…',
        options: [...MATERIAL_UNIT_PRESETS.map((u) => ({ value: u, label: u })), { value: CUSTOM_UNIT, label: 'Otra / personalizada…' }],
        disabled: kit.readOnly,
        onChange: (value) => {
          if (value === CUSTOM_UNIT) {
            customUnitLines.add(lineKey);
            ctx.mutate((q) => {
              if (MATERIAL_UNIT_PRESETS.includes(String(q.materials[i].unit || '').trim())) q.materials[i].unit = '';
            }, { focus: `${p}.unit` });
            return;
          }
          customUnitLines.delete(lineKey);
          ctx.mutate((q) => {
            q.materials[i].unit = value || '';
          });
        },
      });
      // 0.15.0 (Joaco, 2026-11-19): la tarjeta se lee de arriba abajo como una cuenta: qué es,
      // cuánto usás (cantidad, unidad y cada cuánto), cuánto cuesta y lo que te sale EN ESA UNIDAD
      // ("$ 10.000 por diagnóstico", no "por mes"). Lo que casi nunca se toca va en "Más detalle".
      const component = lineComponentOf(line, 'material');
      const perOutput = normalizeBasisId(line.basis) === 'per_output';
      const ownOutput = String(line.outputUnit || '').trim() !== '' || hasNumber(line.outputPerActiveDay);
      // "Unidad producida" y "Producción por día" sólo a la vista si la cotización no las sabe
      // (abono mensual, por día o por hora) o si la línea ya tiene las suyas. Cobrando por
      // diagnóstico la producción ya se cargó en "Cómo se cobra": no se vuelve a preguntar.
      const outputInMain = perOutput && (ownOutput || !autoOutputKnown(quote) || billsByTime(quote));
      const partialUse = perOutput && hasNumber(line.usagePct) && Math.abs(Number(line.usagePct) - 100) > 1e-9;
      const outputFields = () => formGrid(
        2,
        kit.text(`${p}.outputUnit`, {
          label: 'Unidad producida',
          maxLength: 30,
          placeholder: autoOutputKnown(quote) ? '' : 'Ej.: m², m³, pozo',
          hint: billsByTime(quote)
            ? 'Escribí qué producís (hectárea, válvula, m²). Si después cobrás en esa unidad, el rendimiento se carga una sola vez, en "Cómo se cobra".'
            : autoOutputKnown(quote)
              ? `Lo que producís: m² pintado, m³ tratado, pieza inspeccionada… Vacío = ${billingUnitOf(quote).singular}, la unidad en que cobrás.`
              : 'Lo que producís: m² pintado, m³ tratado, pieza inspeccionada…',
        }),
        kit.num(`${p}.outputPerActiveDay`, {
          label: 'Producción por día',
          rule: 'quantity',
          unit: kit.out(() => outputPerDayUnitLabel(quote.materials[i], quote)),
          hint: autoOutputKnown(quote)
            ? 'Vacío = lo que cargaste en "Cómo se cobra". Cargalo si esta unidad es otra.'
            : 'Cuántas producís en un día de trabajo: con eso se calcula el consumo del mes.',
        }),
      );
      const usageField = () => formGrid(
        3,
        kit.num(`${p}.usagePct`, {
          label: `% de ${outputPluralShownOf(line, quote)} que lo usan`,
          rule: 'percent',
          unit: '%',
          placeholder: '100',
          hint: `Vacío = 100 % (cada ${outputUnitShownOf(line, quote)} lo usa). Por ejemplo, si 3 de cada 10 llevan este repuesto, cargá 30.`,
        }),
      );
      const nameNow = () => String((quote.materials[i] && quote.materials[i].description) || '').trim();
      return kit.lineCard(
        {
          title: kit.out(() => nameNow() || `${NEW_LINE_NAMES[lineComponentOf(quote.materials[i], 'material')] || 'Material'} sin nombre`),
          badges: ill.tag ? [ill.tag] : [],
          actions: [kit.action('Quitar', () => removeMaterial(i), { variant: 'danger', icon: 'trash' })],
          className: 'qe-line-compact qe-material-card',
        },
        lineOriginBlock(ctx, 'materials', i, [{ prefix: 'Base', base: line.base }]),
        resourceSyncNotice(ctx, 'materials', i, { name: line.description || 'Material' }),
        ill.control,
        noRate ? h('p', { class: 'qe-warn' }, `Este costo está en ${cur} y la cotización no tiene ese tipo de cambio: no se suma hasta que lo cargues en "${stepName('service')}".`) : null,
        // 1 · Qué es y de qué tipo (PLAN-2026-027: el tipo al lado del nombre, no en "Más detalle").
        formGrid(
          2,
          kit.text(`${p}.description`, { label: '¿Qué es?', maxLength: 160, placeholder: exampleOf(component) }),
          selectField({
            label: 'Tipo',
            name: `${p}.component`,
            value: component,
            options: TYPE_OPTIONS,
            disabled: kit.readOnly,
            hint: (MATERIAL_TYPES.find((t) => t.id === component) || {}).hint || null,
            onChange: (value) => ctx.mutate((q) => { if (q.materials[i]) q.materials[i].component = value; }),
          }),
        ),
        typeNote(line, i),
        // 2 · Cuánto usás: cantidad, en qué unidad y cada cuánto ("2 · unidad · por diagnóstico").
        h('p', { class: 'qe-material-step' }, '¿Cuánto usás?'),
        formGrid(
          showCustomUnit ? 4 : 3,
          kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: kit.out(() => `${String((quote.materials[i] && quote.materials[i].unit) || '').trim() || 'u.'}/${basisPer(quote.materials[i] && quote.materials[i].basis, T, outputUnitShownOf(quote.materials[i], quote))}`) }),
          unitSelect,
          showCustomUnit ? kit.text(`${p}.unit`, { label: 'Tu unidad', maxLength: 30, placeholder: 'Ej.: bidón, rollo, kit' }) : null,
          kit.select(`${p}.basis`, { label: '¿Cada cuánto se consume?', options: basisChoices(QUOTE_MATERIAL_BASES, line.basis), structural: true }),
        ),
        outputInMain ? outputFields() : null,
        partialUse ? usageField() : null,
        // 3 · Cuánto cuesta.
        h('p', { class: 'qe-material-step' }, '¿Cuánto te cuesta?'),
        formGrid(
          3,
          kit.num(`${p}.unitCost`, { label: `${component === 'other' ? 'Monto' : 'Costo unitario'} (${vatIsCost(ctx.settings) ? 'con' : 'sin'} IVA)`, hint: vatIsCost(ctx.settings) ? 'Como monotributista o exento, el IVA de lo que comprás es costo: cargá el precio con IVA.' : null, rule: 'money', unit: kit.out(() => `${sym}/${String((quote.materials[i] && quote.materials[i].unit) || '').trim() || 'u.'}`), illustrative }),
          kit.select(`${p}.providedBy`, {
            label: '¿Quién lo provee?',
            options: MATERIAL_PROVIDERS.map((m) => ({ value: m.id, label: m.label })),
            includeEmpty: true,
            emptyLabel: 'Elegí quién lo provee…',
          }),
        ),
        kit.keyline({
          label: 'Te cuesta',
          value: (r) => {
            const l = at(r);
            if (!l) return EMPTY;
            // En la unidad de la cotización (Joaco 2026-11-18): precio cerrado → en el trabajo.
            const month = lineMonthAtEstimate(r, l);
            const jobs = closedJobsPerMonth(r);
            if (jobs !== null) return `${formatMoney(month / jobs)} en el trabajo`;
            // En la unidad en que se consume (0.15.0): "$ 10.000 por diagnóstico", "por día de
            // trabajo", "por salida". Lo del mes va en la cuenta de abajo.
            if (l.basis !== 'per_month') return `${formatMoney(l.costForUs * (l.usageShare || 1))} ${basisShort(l.basis, T, outputUnitShownOf(quote.materials[i], quote))}`;
            return `${formatMoney(month)} por mes`;
          },
          hint: (r) => {
            const l = at(r);
            if (!l) return '';
            if (!l.providedBy) return 'Falta definir quién lo provee.';
            if (l.costForUs === 0 && l.grossCost > 0) return 'Lo provee el cliente: no es costo tuyo.';
            // Cobrando por cantidad, la producción por día se carga más adelante, en "Cómo se cobra".
            const auto = !ownOutput && autoOutputKnown(quote) && !billsByTime(quote);
            return materialFormulaText(quote.materials[i], l, {
              activeDays: r.activity.activeDaysPerMonth,
              activationsPerMonth: r.activity.activationsPerMonth,
              terms: T,
              outputUnit: outputUnitShownOf(quote.materials[i], quote),
              outputPlural: outputPluralShownOf(quote.materials[i], quote),
              jobsPerMonth: closedJobsPerMonth(r),
              closed: isClosedPrice(r),
              ...(auto ? { outputMissingText: `lo del mes sale cuando cargues cuántos ${outputPluralShownOf(quote.materials[i], quote)} hacés, en "${stepName('service')}"` } : {}),
            });
          },
          tone: (r) => (at(r) && !at(r).providedBy ? 'red' : null),
        }),
        kit.advanced(
          {
            key: `materials:${line.id || i}`,
            summary: () => {
              const m = quote.materials[i] || {};
              const parts = [
                perOutput && !partialUse ? `lo usan todos los ${outputPluralShownOf(m, quote)}` : null,
                `merma ${hasNumber(m.wastePct) ? formatPercent(Number(m.wastePct)) : '0 %'}`,
                `logística ${hasNumber(m.logisticsPct) ? formatPercent(Number(m.logisticsPct)) : '0 %'}`,
                legacyBilled && hasNumber(m.resaleMarkupPct) && Number(m.resaleMarkupPct) > 0 ? `markup de reventa ${formatPercent(Number(m.resaleMarkupPct))}` : null,
                m.billedSeparately === true ? 'se factura aparte' : m.billedSeparately === false ? 'lo cubre la tarifa' : null,
              ].filter(Boolean).join(' · ');
              return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}.`;
            },
          },
          perOutput && !partialUse ? usageField() : null,
          perOutput && !outputInMain
            ? kit.group(`Si se consume por otra unidad (no por ${outputUnitShownOf(line, quote)})`, outputFields())
            : null,
          formGrid(
            legacyBilled ? 4 : 2,
            kit.num(`${p}.wastePct`, { label: 'Merma', rule: 'percent', unit: '%', illustrative, hint: 'Lo que se pierde o desperdicia.' }),
            kit.num(`${p}.logisticsPct`, { label: 'Logística', rule: 'percent', unit: '%', illustrative, hint: 'Flete y manipuleo del material.' }),
            legacyBilled ? kit.num(`${p}.resaleMarkupPct`, { label: 'Markup de reventa', rule: 'percentOpen', unit: '%', hint: lineBilled(line) ? 'Recargo sobre el costo del material (no es margen): es lo que cobrás de más al facturarlo aparte.' : 'Recargo sobre el costo del material (no es margen). Se usa si facturás los materiales aparte (opción de arriba).' }) : null,
            legacyBilled ? selectField({
              label: '¿Este material se factura aparte?',
              name: `${p}.billedSeparately`,
              value: line.billedSeparately === true ? 'yes' : line.billedSeparately === false ? 'no' : '',
              includeEmpty: true,
              emptyLabel: billedSeparately ? 'Como el resto (sí, aparte)' : 'Como el resto (no, en la tarifa)',
              options: [{ value: 'yes', label: 'Sí, lo facturo aparte' }, { value: 'no', label: 'No, lo cubre la tarifa' }],
              disabled: kit.readOnly,
              hint: 'Sólo para este material. Sin elegir, sigue la opción "Le facturo los materiales aparte" de arriba. Aparte se cobra su costo × (1 + markup de reventa); siempre sigue siendo costo.',
              onChange: (value) => {
                ctx.mutate((q) => {
                  const m = q.materials[i];
                  if (!m) return;
                  if (value === 'yes') m.billedSeparately = true;
                  else if (value === 'no') m.billedSeparately = false;
                  else delete m.billedSeparately;
                });
              },
            }) : null,
          ),
          kit.stats(
            kit.stat((r) => (closedJobsPerMonth(r) !== null ? 'En el trabajo' : 'Fijo mensual / variable por día'), (r) => splitLabel(at(r), null, r)),
            legacyBilled ? kit.stat('Precio de reventa (informativo)', (r) => formatMoney(at(r) && at(r).resalePrice), { hint: 'Costo × (1 + markup). No es margen.' }) : null,
          ),
        ),
        kit.advanced(
          {
            key: `materials-base:${line.id || i}`,
            title: 'Fecha base y moneda',
            summary: () => baseText(quote.materials[i] && quote.materials[i].base, { fallbackPeriod: offerPeriodOf(quote) }),
          },
          h('p', { class: 'small' }, 'De qué mes es el costo unitario. Cambiarlo acá sólo afecta esta cotización.'),
          baseFields(ctx, `${p}.base`, { currency: true, periodLabel: 'Mes del costo' }),
        ),
      );
  };

  // ------------------------------------------------- gastos cargados antes (otherCosts[])
  // PLAN-2026-027 (decisión D2): ya no se crean. Los guardados siguen sumando igual, en el renglón
  // que tenían ("Suma en: …", sólo lectura). Los que suman en este renglón se pueden pasar a la lista.
  // "Por unidad producida" (PLAN-2026-022): las unidades de "Cómo se cobra"; con abono mensual no hay
  // unidades por día y no se ofrece (una línea que ya la tiene la sigue viendo).
  const behaviorOptionsFor = (row) => {
    const show = autoOutputKnown(quote) || normalizeBasisId(row && row.behavior) === 'per_output';
    const catalog = [...COST_BEHAVIORS, { id: 'per_output', label: 'Por unidad producida' }];
    return basisChoices(catalog, row && row.behavior, { perOutputAllowed: show });
  };
  const removeOther = async (index) => {
    const line = quote.otherCosts[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar gasto', name: line.description || 'Gasto', extra: '' });
    if (ok) ctx.mutate((q) => q.otherCosts.splice(index, 1));
  };
  /** Renglón de la estructura de costos donde suma un gasto cargado antes (el mismo criterio del motor). */
  const categoryOf = (o) => (o && DIRECT_CATEGORY_IDS.includes(o.category) ? o.category : 'materials');
  const rowName = (category) => costRowLabel(category, (COST_CATEGORIES.find((c) => c.id === category) || {}).label);
  const moveToList = async (index) => {
    const o = quote.otherCosts[index];
    if (!o || notApplicable) return;
    const type = lineComponentOf(o, 'other');
    const ok = await confirmDialog({
      title: 'Pasar a la lista',
      message: `«${o.description || 'Gasto'}» pasa a la lista de insumos y materiales como ${materialTypeLabel(type).toLowerCase()}: cantidad 1, unidad global y el mismo monto. Suma exactamente lo mismo. Va a aparecer "sin fecha base" hasta que cargues de qué mes es el monto (en "Fecha base y moneda").`,
      confirmLabel: 'Pasar a la lista',
    });
    if (!ok) return;
    const at = quote.materials.length;
    ctx.mutate((q) => {
      const line = otherCostToMaterialLine(q.otherCosts[index], q);
      if (!line) return;
      q.materials.push(line);
      q.otherCosts.splice(index, 1);
    }, { focus: `materials.${at}.description` });
  };

  // Marca ILUSTRATIVO por línea (copiadas de una plantilla de demostración).
  const otherIll = quote.otherCosts.map((row, i) => kit.lineIllustrative(`otherCosts.${i}`, { what: 'este gasto' }));
  const structureLoaded = (() => {
    const ind = quote.indirect || {};
    return Number(ind.pct) > 0 || Number(ind.amount) > 0 || (Array.isArray(ind.items) && ind.items.some((x) => x && (Number(x.pct) > 0 || Number(x.amount) > 0)));
  })();
  const rowNote = (o) => {
    const cat = categoryOf(o);
    if (cat === 'structure' && structureLoaded) return h('p', { class: 'qe-warn small' }, `Puede estar contado también en "${stepName('indirect')}".`);
    if (INDEXED_ELSEWHERE.includes(cat)) return h('p', { class: 'qe-note small' }, `Se actualiza con el índice de ${rowName(cat)}.`);
    return null;
  };

  const legacyTable = () => table({
    className: 'qe-edit-table qe-stack-table',
    caption: 'Gastos cargados antes',
    columns: [
      {
        key: 'description',
        label: 'Descripción',
        render: (row) => h('div', { class: 'qe-cell-stack' }, kit.text(`otherCosts.${row.i}.description`, { label: 'Descripción', maxLength: 160 }), otherIll[row.i].control),
      },
      {
        key: 'sum',
        label: 'Suma en',
        render: (row) => h('div', { class: 'qe-cell-stack' }, h('span', {}, `Suma en: ${rowName(categoryOf(row.line))} (cargado antes)`), rowNote(row.line)),
      },
      {
        key: 'behavior',
        label: '¿Cada cuánto lo pagás?',
        className: 'qe-col-behavior',
        render: (row) => h(
          'div',
          { class: 'qe-cell-stack' },
          kit.select(`otherCosts.${row.i}.behavior`, { label: '¿Cada cuánto lo pagás?', options: behaviorOptionsFor(row.line), structural: true }),
          // Por unidad producida (PLAN-2026-022): % de las unidades que lo llevan (vacío = 100 %).
          row.line && normalizeBasisId(row.line.behavior) === 'per_output'
            ? kit.num(`otherCosts.${row.i}.usagePct`, { label: `% de ${outputPluralOf(row.line, quote)} que lo usan`, rule: 'percent', unit: '%', placeholder: '100' })
            : null,
          row.line && normalizeBasisId(row.line.behavior) === 'per_output' && !autoOutputKnown(quote)
            ? h('p', { class: 'qe-warn' }, 'Cobrando por mes no hay unidades por día: este gasto suma $ 0. Elegí otra frecuencia.')
            : null,
        ),
      },
      {
        key: 'amount',
        label: 'Monto',
        render: (row) => h(
          'div',
          { class: 'qe-cell-stack' },
          kit.num(`otherCosts.${row.i}.amount`, { label: 'Monto', rule: 'money', unit: '$', illustrative: otherIll[row.i].marked }),
          otherIll[row.i].marked ? h('span', { class: 'qe-cell-tag' }, illustrativeTag()) : null,
        ),
      },
      {
        key: 'calc',
        label: 'En el costo',
        align: 'right',
        className: 'qe-col-calc',
        render: (row) => kit.out((r) => splitLabel(r.model.otherCosts[row.i], `por ${outputUnitOf(quote.otherCosts[row.i], quote)}`, r), { className: 'mono nowrap' }),
      },
      {
        key: 'actions',
        label: '',
        className: 'qe-col-remove',
        render: (row) => h('div', { class: 'qe-cell-stack' },
          // Sólo lo que suma en "Insumos y materiales" (otherCostToMaterialLine). Con "no usa insumos
          // ni materiales" la lista no suma: pasarlo cambiaría el costo, así que no se puede.
          row.line && row.line.category === 'materials' && !kit.readOnly
            ? button('Pasar a la lista', {
              size: 'sm',
              icon: 'plus',
              disabled: notApplicable,
              title: notApplicable ? 'Desmarcá "El servicio no usa insumos ni materiales" para pasarlo a la lista.' : null,
              onClick: () => moveToList(row.i),
              attrs: { 'data-edit': 'true' },
            })
            : null,
          kit.action('', () => removeOther(row.i), { variant: 'ghost', icon: 'trash', title: 'Quitar este gasto' })),
      },
    ],
    rows: quote.otherCosts.map((line, i) => ({ i, line, id: (line && line.id) || `o${i}` })),
  });

  // ------------------------------------------------- una sola lista (PLAN-2026-027)
  const shownIndexes = notApplicable ? [] : quote.materials.map((m, i) => i);
  const addBlank = (type) => {
    lastBlankType = MATERIAL_TYPE_IDS.includes(type) ? type : DEFAULT_BLANK_TYPE;
    // 0.15.0: nace sin nombre (con un ejemplo a la vista); "Insumo" se leía como un dato cargado.
    const line = { ...blankMaterialLine({ currency: quoteCurrencyOf(quote) }), component: lastBlankType, description: '' };
    line.basis = defaultMaterialBasis(quote, lastBlankType);
    // Otro gasto (permiso, seguro, residuos): un monto global, editable.
    if (lastBlankType === 'other') line.unit = 'global';
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.description` });
  };
  const pick = { id: null, type: lastBlankType };
  const toolbar = kit.readOnly || notApplicable ? null : h('div', { class: 'qe-toolbar qe-materials-add' },
    library.length
      ? h('div', { class: 'qe-toolbar-pick' },
        selectField({
          label: 'Desde tus recursos',
          value: null,
          includeEmpty: true,
          emptyLabel: 'Elegí un insumo o material…',
          options: library.map((m) => ({ value: m.id, label: m.description })),
          onChange: (v) => { pick.id = v; },
        }),
        kit.action('Agregar', () => addFromLibrary(pick.id), { variant: 'primary', icon: 'plus', size: 'md' }))
      : null,
    h('div', { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Tipo',
        name: 'newMaterialType',
        value: lastBlankType,
        options: TYPE_OPTIONS,
        onChange: (v) => { pick.type = v; lastBlankType = MATERIAL_TYPE_IDS.includes(v) ? v : DEFAULT_BLANK_TYPE; },
      }),
      kit.action('Agregar en blanco', () => addBlank(pick.type), { icon: 'plus', size: 'md', ...(library.length ? {} : { variant: 'primary' }) })),
  );
  const forgot = notApplicable ? null : h('p', { class: 'qe-note qe-materials-forgot' }, '¿Te olvidaste de algo? EPP especial del trabajo, herramientas que se gastan, permisos, seguros del trabajo o disposición de residuos van en esta lista, cada uno con su tipo.');

  const inQuoteUnit = (x) => (x.perJob !== null && x.perJob !== undefined ? `${formatMoney(x.perJob)} en el trabajo` : `${formatMoney(x.amount)} por mes`);
  // Un renglón por tipo con monto (lo que suma en "Insumos y materiales", igual que los hijos del Resultado).
  const byType = kit.region((r) => {
    const parts = r.componentCosts && r.componentCosts.byComponent ? r.componentCosts.byComponent : null;
    if (!parts) return null;
    const items = MATERIAL_TYPE_IDS.filter((id) => parts[id] && parts[id].inMaterials && parts[id].inMaterials.amount > 0.005)
      .map((id) => h('li', {}, h('span', {}, materialTypeShort(id)), h('span', { class: 'mono' }, inQuoteUnit(parts[id].inMaterials))));
    return items.length > 1 ? h('ul', { class: 'qe-type-subtotals' }, ...items) : null;
  }, { className: 'qe-type-subtotals-host' });

  const list = card(
    { title: 'Insumos y materiales', subtitle: 'Todo lo que se compra para el trabajo, en una sola lista. El tipo de cada uno se elige una vez, en Recursos.', className: 'qe-component-section' },
    shownIndexes.length ? h('div', { class: 'qe-lines' }, ...shownIndexes.map((i) => materialCard(quote.materials[i], i))) : null,
    toolbar,
    forgot,
    byType,
  );
  const legacy = quote.otherCosts.length
    ? card(
      { title: 'Gastos cargados antes', subtitle: 'Se cargaron con una versión anterior y siguen sumando igual, en el renglón que se ve. Ya no se agregan nuevos: los que suman en "Insumos y materiales" se pueden pasar a la lista.', className: 'qe-legacy-costs' },
      legacyTable(),
    )
    : null;

  const totals = kit.keyline({
    label: 'Insumos y materiales',
    value: (r) => {
      const m = r.componentCosts ? r.componentCosts.materials : null;
      if (!m) return EMPTY;
      if (m.perJob !== null) return `${formatMoney(m.perJob)} en el trabajo`;
      const per = m.perBilledUnit !== null && m.amount > 0.005 ? ` · ≈\u00a0${formatMoney(m.perBilledUnit)} por\u00a0${unitInfo.singular || 'unidad'}` : '';
      return `${formatMoney(m.amount)} por mes${per}`;
    },
    hint: (r) => {
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      const share = row ? `${formatPercent(row.displayPct)} del costo total` : '';
      const jobs = closedJobsPerMonth(r);
      if (jobs !== null) return `${share} · lo del mes con ${workDaysText(r.activity.activeDaysPerMonth)}, dividido por ${formatNumber(jobs, { decimals: 2 })} ${Math.abs(jobs - 1) < 1e-9 ? 'trabajo' : 'trabajos'}.`;
      return `${share} · fijo ${formatMoney(r.model.materials.fixedMonthly)} por mes + ${formatMoney(r.model.materials.variablePerActiveDay)} por día de trabajo.`;
    },
    trace: (r) => materialsTrace(r, T, quote),
    className: 'qe-keyline-total',
  });

  mount(container, toggleCard, list, legacy, totals);
  return { update() {} };
}
