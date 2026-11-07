/**
 * Etapa 2 · Los recursos — Materiales y otros costos directos.
 * Básico: descripción, cantidad, costo unitario y quién lo provee.
 * Opciones avanzadas (con resumen visible): base, unidad, merma, logística y
 * markup de reventa (recargo sobre el costo del material: no es margen).
 *   costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%)
 *   (si lo provee el cliente, no es costo nuestro)
 * Si los materiales se facturan aparte (horas y materiales, PLAN-2026-009):
 *   facturación de materiales = costo × (1 + markup de reventa)
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, emptyState, table } from '../../components.js';
import { QUOTE_MATERIAL_BASES, MATERIAL_PROVIDERS, COST_BEHAVIORS, COST_CATEGORIES, DIRECT_CATEGORY_IDS, MATERIAL_UNIT_PRESETS } from '../../../domain/catalogs.js';
import { materialLineFromLibrary, createOtherCost } from '../../../domain/quote-factory.js';
import { formatMoney, formatPercent, formatNumber, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { confirmRemove, hasNumber, stepName } from './shared.js';
import { baseFields, lineOriginBlock, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { CURRENCIES } from '../../../domain/catalogs.js';
import { conversionFactor } from '../../../engines/currency-engine.js';
import { activationTerms, withActivationOptions } from '../../../domain/activation-terms.js';
import { billingUnitOf, pluralizeUnit } from '../../../domain/billing-units.js';
import { onSessionReset } from '../../session-memory.js';
import { normalizeBasisId } from '../../../engines/materials-engine.js';

/** Grilla de la línea de material: la descripción más ancha que los números. */
function materialGrid(...fields) {
  const grid = formGrid(4, ...fields);
  grid.classList.add('qe-material-grid');
  return grid;
}

/** "por mes", "por día activo", "por llamado" / "por salida"… (la activación con el nombre de la cotización, PLAN-2026-014). */
const basisShort = (basis, T, out = 'unidad') => ({ per_month: 'por mes', per_active_day: 'por día activo', per_activation: T.per, per_output: `por ${out}` }[basis] || basis);
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
export function materialFormulaText(line, model, { activeDays = 0, activationsPerMonth = 0, terms = activationTerms(), outputUnit = 'unidad' } = {}) {
  if (!line || !model) return '';
  const unit = String(line.unit || '').trim() || 'u.';
  const per = basisPer(model.basis, terms, outputUnit);
  const factor = model.quantity * model.unitCost > 0 ? model.grossCost / (model.quantity * model.unitCost) : 1;
  const extras = Math.abs(factor - 1) > 1e-9 ? ' (con merma y logística)' : '';
  const head = `${formatNumber(model.quantity, { decimals: 2 })} ${unit}/${per} × ${formatMoney(model.unitCost, { decimals: model.unitCost < 100 ? 2 : 0 })}/${unit}${extras} = ${formatMoney(model.grossCost)}/${per}`;
  if (model.basis === 'per_active_day') return `${head} · ${formatNumber(activeDays, { decimals: 2 })} días = ${formatMoney(model.grossCost * activeDays)}/mes`;
  if (model.basis === 'per_output') {
    // % de las unidades que lo usan (PLAN-2026-022): costo promedio por unidad producida.
    const partial = model.usageShare < 1 - 1e-9;
    const share = partial ? ` × ${formatPercent(model.usageShare * 100)} que lo usan = ${formatMoney(model.costPerOutputUnit)}/${per} promedio` : '';
    const perUnit = partial ? model.costPerOutputUnit : model.grossCost;
    const perDay = model.outputPerActiveDay || 0;
    if (!(perDay > 0)) return `${head}${share} · falta la producción por día`;
    return `${head}${share} · ${formatNumber(perDay, { decimals: 2 })} ${outputUnit}/día × ${formatNumber(activeDays, { decimals: 2 })} días = ${formatMoney(perUnit * perDay * activeDays)}/mes`;
  }
  if (model.basis === 'per_activation') return `${head} · ${formatNumber(activationsPerMonth, { decimals: 2 })} ${terms.word(activationsPerMonth)} = ${formatMoney(model.grossCost * activationsPerMonth)}/mes`;
  return head;
}

function splitLabel(line, perUnitText = null) {
  if (!line) return EMPTY;
  if (perUnitText && Number.isFinite(line.costPerOutputUnit)) return `${formatMoney(line.costPerOutputUnit)} ${perUnitText} · ${formatMoney(line.monthlyAtEstimate)} / mes`;
  if (line.fixedMonthly > 0) return `${formatMoney(line.fixedMonthly)} fijo / mes`;
  if (line.variablePerActiveDay > 0) return `${formatMoney(line.variablePerActiveDay)} / día activo`;
  return formatMoney(0);
}

function materialsTrace(result, T, quote) {
  const lines = result.model.materials.lines;
  const row = result.eecc.rows.find((r) => r.category === 'materials');
  const perUnit = lines.some((l) => l.basis === 'per_output');
  return createTrace({
    id: 'materials',
    title: 'Materiales',
    formula: `Costo para nosotros = cantidad × costo unitario × (1 + merma%) × (1 + logística%) · Por mes → fijo; por día activo → variable; ${T.per} → variable ÷ días ${T.per}${perUnit ? ' · por unidad producida → costo × % de las unidades que lo usan × unidades producidas por día' : ''} · Si lo provee el cliente, no es costo nuestro`,
    inputs: lines.map((l, i) => ({ label: `${l.description || 'Material'} (${basisShort(l.basis, T, outputUnitOf((quote.materials || [])[i], quote))}${l.basis === 'per_output' && l.usageShare < 1 - 1e-9 ? `, ${formatPercent(l.usageShare * 100)} de las unidades` : ''})`, value: l.costForUs, format: 'money' })),
    steps: [
      { label: 'Fijo mensual de materiales', value: result.model.materials.fixedMonthly, format: 'money' },
      { label: 'Variable por día activo', value: result.model.materials.variablePerActiveDay, format: 'money' },
      { label: 'Días activos', value: result.activity.activeDaysPerMonth, format: 'days' },
    ],
    result: { label: 'Materiales en la estructura de costos (incluye otros costos de categoría Materiales)', value: row ? row.amount : null, format: 'money' },
    notes: ['El precio de reventa con markup es sólo informativo: sirve si facturás materiales aparte. No cambia el costo.'],
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

  let selectedId = null;
  const addFromLibrary = () => {
    const mat = library.find((m) => m.id === selectedId);
    if (!mat) {
      ctx.toast('Elegí un material de la biblioteca para agregarlo.', 'warning');
      return;
    }
    const line = materialLineFromLibrary(mat, { now: new Date().toISOString(), currency: quoteCurrencyOf(quote) });
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.quantity` });
    ctx.toast(`Se agregó "${line.description}" con los valores que tiene hoy en Recursos (y su fecha base). Si después cambian, esta cotización no cambia sola.`, 'success');
  };
  const addBlank = () => {
    const line = materialLineFromLibrary({}, { currency: quoteCurrencyOf(quote) });
    const index = quote.materials.length;
    ctx.mutate((q) => q.materials.push(line), { focus: `materials.${index}.description` });
  };
  const removeMaterial = async (index) => {
    const line = quote.materials[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar material', name: line.description || 'Material' });
    if (ok) ctx.mutate((q) => q.materials.splice(index, 1));
  };

  // Horas y materiales (PLAN-2026-009): los materiales se pueden facturar
  // aparte, al costo más el markup de reventa de cada uno. Siguen siendo
  // costo; lo que se cobra por ellos suma a la facturación.
  const billedSeparately = !notApplicable && Boolean(quote.pricing && quote.pricing.materialsBilledSeparately === true);
  // Por línea (tanda A 2026-11, A-8): true / false / sin definir (= sigue la opción de arriba).
  const lineBilled = (m) => (m && (m.billedSeparately === true || m.billedSeparately === false) ? m.billedSeparately : billedSeparately);
  const anyBilled = !notApplicable && (quote.materials || []).some((m) => lineBilled(m));
  const toggleCard = card(
    {},
    kit.check('materialsNotApplicable', { label: 'El servicio no usa materiales', structural: true, hint: 'Marcalo para confirmar que no te olvidaste de cargarlos.' }),
    notApplicable
      ? null
      : kit.check('pricing.materialsBilledSeparately', {
        label: 'Facturo los materiales aparte (al costo más un recargo)',
        structural: true,
        hint: quote.serviceType === 'time_materials'
          ? 'Horas y materiales: la tarifa cubre la mano de obra y los equipos; los materiales se cobran aparte, a su costo × (1 + markup de reventa de cada uno).'
          : 'La tarifa cubre el resto del servicio; los materiales se cobran aparte, a su costo × (1 + markup de reventa de cada uno).',
      }),
    anyBilled
      ? kit.out((r) => {
        const c = r.estimate.revenue.components;
        const billed = (c.materialsFixed || 0) + (c.materialsVariable || 0);
        const n = (quote.materials || []).filter((m) => lineBilled(m)).length;
        const which = billedSeparately && n === (quote.materials || []).length ? '' : ` (${n} ${n === 1 ? 'material' : 'materiales'}: se elige en cada uno, en "¿Se factura aparte?")`;
        return `Se facturan aparte ${formatMoney(billed)} por mes de materiales${which} (con la actividad estimada). Siguen siendo costo: lo que cobrás por ellos suma a la facturación y baja la tarifa que necesitás.`;
      }, { tag: 'p', className: 'qe-note' })
      : null,
  );


  const materialCards = notApplicable
    ? []
    : quote.materials.map((line, i) => {
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
      return kit.lineCard(
        {
          title: kit.out(() => (quote.materials[i] && quote.materials[i].description) || 'Material sin descripción'),
          badges: ill.tag ? [ill.tag] : [],
          actions: [kit.action('Quitar', () => removeMaterial(i), { variant: 'danger', icon: 'trash' })],
          className: 'qe-line-compact',
        },
        lineOriginBlock(ctx, 'materials', i, [{ prefix: 'Base', base: line.base }]),
        resourceSyncNotice(ctx, 'materials', i, { name: line.description || 'Material' }),
        ill.control,
        noRate ? h('p', { class: 'qe-warn' }, `Este costo está en ${cur} y la cotización no tiene ese tipo de cambio: no se suma hasta que lo cargues en "${stepName('service')}".`) : null,
        materialGrid(
          kit.text(`${p}.description`, { label: 'Descripción', maxLength: 160 }),
          kit.select(`${p}.basis`, { label: '¿Cada cuánto se consume?', options: withActivationOptions(QUOTE_MATERIAL_BASES, T).map((b) => ({ value: b.id, label: b.label })), structural: true }),
          kit.select(`${p}.providedBy`, {
            label: '¿Quién lo provee?',
            options: MATERIAL_PROVIDERS.map((m) => ({ value: m.id, label: m.label })),
            includeEmpty: true,
            emptyLabel: 'Elegí quién lo provee…',
          }),
        ),
        line.basis === 'per_output' ? formGrid(
          2,
          kit.text(`${p}.outputUnit`, {
            label: 'Unidad producida',
            maxLength: 30,
            placeholder: autoOutputKnown(quote) ? '' : 'Ej.: m², m³, pozo',
            hint: autoOutputKnown(quote)
              ? `Lo que producís: m² pintado, m³ tratado, pieza inspeccionada… Vacío = ${billingUnitOf(quote).singular}, la unidad en que cobrás.`
              : 'Lo que producís: m² pintado, m³ tratado, pieza inspeccionada…',
          }),
          kit.num(`${p}.outputPerActiveDay`, {
            label: 'Producción por día',
            rule: 'quantity',
            unit: kit.out(() => `${outputUnitOf(quote.materials[i], quote)}/día`),
            hint: autoOutputKnown(quote)
              ? 'Vacío = lo que cargaste en "Cómo se cobra". Cargalo si esta unidad es otra.'
              : 'Cuántas producís en un día de trabajo: con eso se calcula el consumo del mes.',
          }),
        ) : null,
        formGrid(
          showCustomUnit ? 4 : 3,
          kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: kit.out(() => `${String((quote.materials[i] && quote.materials[i].unit) || '').trim() || 'u.'}/${basisPer(quote.materials[i] && quote.materials[i].basis, T, outputUnitOf(quote.materials[i], quote))}`) }),
          unitSelect,
          showCustomUnit ? kit.text(`${p}.unit`, { label: 'Tu unidad', maxLength: 30, placeholder: 'Ej.: bidón, rollo, kit' }) : null,
          kit.num(`${p}.unitCost`, { label: 'Costo unitario (sin IVA)', rule: 'money', unit: kit.out(() => `${sym}/${String((quote.materials[i] && quote.materials[i].unit) || '').trim() || 'u.'}`), illustrative }),
        ),
        // Por unidad producida (PLAN-2026-022): no todas las unidades lo usan (p. ej. 30 % de las PSV llevan repuesto).
        line.basis === 'per_output'
          ? formGrid(
            3,
            kit.num(`${p}.usagePct`, {
              label: `% de ${outputPluralOf(line, quote)} que lo usan`,
              rule: 'percent',
              unit: '%',
              placeholder: '100',
              hint: `Vacío = 100 % (cada ${outputUnitOf(line, quote)} lo usa). Por ejemplo, si 3 de cada 10 llevan este repuesto, cargá 30.`,
            }),
          )
          : null,
        kit.keyline({
          label: 'Costo para vos',
          value: (r) => {
            const l = at(r);
            if (!l) return EMPTY;
            return `${formatMoney(l.monthlyAtEstimate)} por mes`;
          },
          hint: (r) => {
            const l = at(r);
            if (!l) return '';
            if (!l.providedBy) return 'Falta definir quién lo provee.';
            if (l.costForUs === 0 && l.grossCost > 0) return 'Lo provee el cliente: no es costo tuyo.';
            return materialFormulaText(quote.materials[i], l, { activeDays: r.activity.activeDaysPerMonth, activationsPerMonth: r.activity.activationsPerMonth, terms: T, outputUnit: outputUnitOf(quote.materials[i], quote) });
          },
          tone: (r) => (at(r) && !at(r).providedBy ? 'red' : null),
        }),
        kit.advanced(
          {
            key: `materials:${line.id || i}`,
            summary: () => {
              const m = quote.materials[i] || {};
              const parts = [
                `merma ${hasNumber(m.wastePct) ? formatPercent(Number(m.wastePct)) : '0 %'}`,
                `logística ${hasNumber(m.logisticsPct) ? formatPercent(Number(m.logisticsPct)) : '0 %'}`,
                hasNumber(m.resaleMarkupPct) && Number(m.resaleMarkupPct) > 0 ? `markup de reventa ${formatPercent(Number(m.resaleMarkupPct))}` : null,
                m.billedSeparately === true ? 'se factura aparte' : m.billedSeparately === false ? 'lo cubre la tarifa' : null,
              ].filter(Boolean).join(' · ');
              return `${parts.charAt(0).toUpperCase()}${parts.slice(1)}.`;
            },
          },
          formGrid(
            4,
            kit.num(`${p}.wastePct`, { label: 'Merma', rule: 'percent', unit: '%', illustrative, hint: 'Lo que se pierde o desperdicia.' }),
            kit.num(`${p}.logisticsPct`, { label: 'Logística', rule: 'percent', unit: '%', illustrative, hint: 'Flete y manipuleo del material.' }),
            kit.num(`${p}.resaleMarkupPct`, { label: 'Markup de reventa', rule: 'percentOpen', unit: '%', hint: lineBilled(line) ? 'Recargo sobre el costo del material (no es margen): es lo que cobrás de más al facturarlo aparte.' : 'Recargo sobre el costo del material (no es margen). Se usa si facturás los materiales aparte (opción de arriba).' }),
            selectField({
              label: '¿Se factura aparte?',
              name: `${p}.billedSeparately`,
              value: line.billedSeparately === true ? 'yes' : line.billedSeparately === false ? 'no' : '',
              includeEmpty: true,
              emptyLabel: billedSeparately ? 'Como el resto (sí, aparte)' : 'Como el resto (no, en la tarifa)',
              options: [{ value: 'yes', label: 'Sí, lo facturo aparte' }, { value: 'no', label: 'No, lo cubre la tarifa' }],
              disabled: kit.readOnly,
              hint: 'Sólo para este material. Sin elegir, sigue la opción "Facturo los materiales aparte" de arriba. Aparte se cobra su costo × (1 + markup de reventa); siempre sigue siendo costo.',
              onChange: (value) => {
                ctx.mutate((q) => {
                  const m = q.materials[i];
                  if (!m) return;
                  if (value === 'yes') m.billedSeparately = true;
                  else if (value === 'no') m.billedSeparately = false;
                  else delete m.billedSeparately;
                });
              },
            }),
          ),
          kit.stats(
            kit.stat('Fijo mensual / variable por día', (r) => splitLabel(at(r))),
            kit.stat('Precio de reventa (informativo)', (r) => formatMoney(at(r) && at(r).resalePrice), { hint: 'Costo × (1 + markup). No es margen.' }),
          ),
        ),
        kit.advanced(
          {
            key: `materials-base:${line.id || i}`,
            title: 'Fecha base y moneda',
            summary: () => baseText(quote.materials[i] && quote.materials[i].base),
          },
          h('p', { class: 'small' }, 'De qué mes es el costo unitario. Cambiarlo acá sólo afecta esta cotización.'),
          baseFields(ctx, `${p}.base`, { currency: true, periodLabel: 'Mes del costo' }),
        ),
      );
    });

  const materialsSection = notApplicable
    ? null
    : h(
      'div',
      { class: 'stack' },
      card(
        {},
        h(
          'div',
          { class: 'qe-toolbar' },
          h(
            'div',
            { class: 'qe-toolbar-pick' },
            selectField({
              label: 'Agregar desde tus recursos de materiales',
              value: null,
              includeEmpty: true,
              emptyLabel: library.length ? 'Elegí un material…' : 'Todavía no cargaste materiales',
              options: library.map((m) => ({ value: m.id, label: m.description })),
              onChange: (v) => {
                selectedId = v;
              },
            }),
            kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
          ),
          kit.action('Agregar material en blanco', addBlank, { icon: 'plus', size: 'md' }),
        ),
      ),
      materialCards.length
        ? h('div', { class: 'qe-lines' }, ...materialCards)
        : emptyState({
          title: 'Todavía no cargaste materiales.',
          text: 'Agregá los insumos que se consumen al prestar el servicio. Si no usa materiales, marcá la casilla de arriba.',
          icon: 'resources',
        }),
    );

  // ------------------------------------------------- otros costos directos
  const categoryOptions = COST_CATEGORIES.filter((c) => DIRECT_CATEGORY_IDS.includes(c.id)).map((c) => ({ value: c.id, label: c.label }));
  // "Por unidad producida" (PLAN-2026-022): las unidades de "Cómo se cobra"; con abono mensual no hay
  // unidades por día y no se ofrece (una línea que ya la tiene la sigue viendo).
  const behaviorOptionsFor = (row) => {
    const list = withActivationOptions(COST_BEHAVIORS, T).map((b) => ({ value: b.id, label: b.label }));
    const show = autoOutputKnown(quote) || normalizeBasisId(row && row.behavior) === 'per_output';
    return show ? [...list, { value: 'per_output', label: 'Por unidad producida' }] : list;
  };
  const addOther = () => {
    const index = quote.otherCosts.length;
    ctx.mutate((q) => q.otherCosts.push(createOtherCost()), { focus: `otherCosts.${index}.description` });
  };
  const removeOther = async (index) => {
    const line = quote.otherCosts[index];
    if (!line) return;
    const ok = await confirmRemove({ title: 'Quitar costo', name: line.description || 'Otro costo', extra: '' });
    if (ok) ctx.mutate((q) => q.otherCosts.splice(index, 1));
  };

  // Marca ILUSTRATIVO por línea (copiadas de una plantilla de demostración).
  const otherIll = quote.otherCosts.map((row, i) => kit.lineIllustrative(`otherCosts.${i}`, { what: 'este costo' }));

  const otherTable = quote.otherCosts.length
    ? table({
      className: 'qe-edit-table qe-stack-table',
      caption: 'Otros costos directos',
      columns: [
        {
          key: 'description',
          label: 'Descripción',
          render: (row, i) => h('div', { class: 'qe-cell-stack' }, kit.text(`otherCosts.${i}.description`, { label: 'Descripción', maxLength: 160 }), otherIll[i].control),
        },
        { key: 'category', label: 'Categoría', render: (row, i) => kit.select(`otherCosts.${i}.category`, { label: 'Categoría', options: categoryOptions }) },
        {
          key: 'behavior',
          label: 'Comportamiento',
          className: 'qe-col-behavior',
          render: (row, i) => h(
            'div',
            { class: 'qe-cell-stack' },
            kit.select(`otherCosts.${i}.behavior`, { label: 'Comportamiento', options: behaviorOptionsFor(row), structural: true }),
            // Por unidad producida (PLAN-2026-022): % de las unidades que lo llevan (vacío = 100 %).
            row && normalizeBasisId(row.behavior) === 'per_output'
              ? kit.num(`otherCosts.${i}.usagePct`, { label: `% de ${outputPluralOf(row, quote)} que lo usan`, rule: 'percent', unit: '%', placeholder: '100' })
              : null,
            row && normalizeBasisId(row.behavior) === 'per_output' && !autoOutputKnown(quote)
              ? h('p', { class: 'qe-warn' }, 'Cobrando por mes no hay unidades por día: este costo suma $ 0. Elegí otro comportamiento.')
              : null,
          ),
        },
        {
          key: 'amount',
          label: 'Monto',
          render: (row, i) => h(
            'div',
            { class: 'qe-cell-stack' },
            kit.num(`otherCosts.${i}.amount`, { label: 'Monto', rule: 'money', unit: '$', illustrative: otherIll[i].marked }),
            otherIll[i].marked ? h('span', { class: 'qe-cell-tag' }, illustrativeTag()) : null,
          ),
        },
        {
          key: 'calc',
          label: 'En el costo',
          align: 'right',
          className: 'qe-col-calc',
          render: (row, i) => kit.out((r) => splitLabel(r.model.otherCosts[i], `por ${outputUnitOf(quote.otherCosts[i], quote)}`), { className: 'mono nowrap' }),
        },
        { key: 'remove', label: '', className: 'qe-col-remove', render: (row, i) => kit.action('', () => removeOther(i), { variant: 'ghost', icon: 'trash', title: 'Quitar este costo' }) },
      ],
      rows: quote.otherCosts,
    })
    : h('p', { class: 'qe-note' }, 'No hay otros costos directos.');

  const otherCount = quote.otherCosts.length;
  const otherSection = kit.advanced(
    {
      key: 'other-costs',
      title: 'Otros costos directos (terceros, subcontratos, manuales)',
      boxed: true,
      // Si hay otros costos cargados, la sección arranca abierta (no se esconden).
      defaultOpen: otherCount > 0,
      summary: (r) => {
        if (otherCount === 0) return 'Para costos que no encajan en personal, equipos, materiales o viajes. No cargaste ninguno.';
        const fixed = r.model.otherCosts.reduce((acc, l) => acc + (l.fixedMonthly || 0), 0);
        const variable = r.model.otherCosts.reduce((acc, l) => acc + (l.variablePerActiveDay || 0), 0);
        return `${otherCount} ${otherCount === 1 ? 'costo cargado' : 'costos cargados'}: ${formatMoney(fixed)} fijo por mes + ${formatMoney(variable)} por día activo.`;
      },
    },
    h('p', { class: 'qe-note' }, 'Elegí la categoría para que aparezcan bien en la estructura de costos.'),
    otherTable,
    h('div', { class: 'qe-toolbar' }, kit.action('Agregar costo', addOther, { icon: 'plus' })),
  );

  const totals = kit.keyline({
    label: 'Materiales en el costo del mes',
    value: (r) => {
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      return row ? formatMoney(row.amount) : EMPTY;
    },
    hint: (r) => {
      const row = r.eecc.rows.find((x) => x.category === 'materials');
      const share = row ? `${formatPercent(row.displayPct)} del costo total · ` : '';
      return `${share}fijo ${formatMoney(r.model.materials.fixedMonthly)} por mes + ${formatMoney(r.model.materials.variablePerActiveDay)} por día activo (incluye otros costos de categoría Materiales).`;
    },
    trace: (r) => materialsTrace(r, T, quote),
    className: 'qe-keyline-total',
  });

  mount(container, toggleCard, materialsSection, otherSection, totals);
  return { update() {} };
}
