/**
 * Etapa 1 · El contrato (PLAN-2026-018; 0.10.0 "La unidad primero").
 * Básico: nombre, cliente, EN QUÉ UNIDAD se le cobra al cliente (por mes, por trabajo, por hora,
 * por día, por unidad con nombre propio u otra del catálogo: el modo del contrato se deriva de
 * ahí) y qué incluye el servicio: categorías de gasto combinables (personal, vehículos, equipos,
 * terceros, herramientas, insumos, materiales, EPP, viáticos, otros; PLAN-2026-019). Las
 * plantillas quedan como ayuda opcional, al final.
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { button, card, dateField, formGrid, icon, confirmDialog, infoTip, searchSelectField } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { SERVICE_COMPONENTS, SERVICE_TEMPLATES, componentsOf, contractOf, contractUsesMaterials, contractWithComponents, serviceTypeForContract, templateOf, searchTemplates, templateGroupLabel, templateById } from '../../../domain/contract.js';
import { isPlainObject } from '../../../core/object.js';
import { formatNumber, formatPeriod, formatDayDate, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { applyQuoteUnit, unitChoiceBlock } from './unit-choice.js';
import { onSessionReset } from '../../session-memory.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

/** Qué sigue según cómo se cobra (0.10.0: se habla de la unidad, no de tipos de contrato). */
const MODE_TIPS = Object.freeze({
  monthly: { short: `Un solo precio por mes: en ${step('modality')} cargás lo que cubre.`, more: `Cargá lo que cubre la tarifa del mes (por ejemplo 26 días × 12 h). Si hay horas fuera de horario, elegilas en "Horas extra del trabajo" (${step('modality')}): quedan dentro del precio. Para otra variante, duplicá la cotización (Más acciones → Duplicar).` },
  on_demand: { short: `En ${step('modality')} cargás cuánto esperás trabajar por mes.`, more: 'Con eso RATEOS calcula tu precio por unidad: cuanto menos trabajes, más alto tiene que ser para pagar a tu gente y tus equipos.' },
  closed: { short: 'Cargá todo el alcance del trabajo.', more: `Personal, equipos, materiales, HSE, seguros. Lo incierto se reserva en ${step('risk')}. Si hay horas fuera de horario, elegilas en "Horas extra del trabajo" (${step('modality')}): quedan dentro del precio. Un trabajo fuera del alcance es otra cotización: duplicala (Más acciones → Duplicar).` },
});

/**
 * Valores sin fecha base o con base vieja, uno por uno (PLAN-2026-010), y la
 * opción de usar el mes de la oferta para los que no tienen base. Nunca se
 * asigna sola: se confirma viendo la lista. Las bases definidas no se tocan
 * (cada recurso puede tener la suya).
 */
function baseDetail(info, ctx) {
  if (!info) return null;
  const missing = Array.isArray(info.undefinedEntries) ? info.undefinedEntries : [];
  const stale = Array.isArray(info.stale) ? info.stale : [];
  if (!missing.length && !stale.length) return null;
  // Tanda novatos 2026-11: un valor sin fecha propia no es un pendiente: se muestra con el mes de la oferta.
  const fallback = info.offerPeriod ? ` — sin fecha propia: se toma ${formatPeriod(info.offerPeriod)} (mes de la oferta)` : ' — sin fecha propia: se toma el mes de la oferta';
  const rows = [
    ...missing.map((e) => h('li', { class: 'is-undefined' }, h('strong', {}, e.label), fallback)),
    ...stale.map((e) => h('li', { class: 'is-stale' }, h('strong', {}, e.label), ` — Base ${formatPeriod(e.period)} (${formatNumber(e.monthsBeforeOffer)} meses antes de la oferta)`)),
  ];
  const canAssign = missing.length > 0 && info.offerPeriod && !ctx.readOnly;
  const assign = canAssign
    ? ctx.kit.action(`Usar ${formatPeriod(info.offerPeriod)} (mes de la oferta) en los ${formatNumber(missing.length)} sin base…`, async () => {
      const ok = await confirmDialog({
        title: 'Usar el mes de la oferta como base',
        message: `Estos valores no tienen fecha base. Si sabés que son de ${formatPeriod(info.offerPeriod)}, RATEOS les asigna ese mes y lo marca como "Mes de la oferta". No cambia ningún monto ni las bases que ya están definidas.`,
        confirmLabel: 'Asignar el mes de la oferta',
        details: h('ul', { class: 'base-assign-list' }, ...missing.map((e) => h('li', {}, e.label))),
      });
      if (!ok) return;
      const paths = missing.map((e) => e.path);
      ctx.mutate((q) => {
        assignOfferBase(q, paths, info.offerPeriod);
      });
    }, { icon: 'check' })
    : null;
  return h(
    'details',
    { class: 'base-detail' },
    h('summary', {}, stale.length ? `Ver los valores para revisar (${formatNumber(stale.length)})` : `Ver los valores sin fecha propia (${formatNumber(missing.length)})`),
    h('ul', { class: 'base-detail-list' }, ...rows),
    h('p', { class: 'small muted' }, 'Las bases se cargan en cada recurso (en Recursos o en la línea de esta cotización). Si un valor es viejo, actualizalo o confirmá que sigue vigente.'),
    assign ? h('div', { class: 'qe-toolbar' }, assign) : null,
    missing.length && !info.offerPeriod ? h('p', { class: 'small' }, 'Cargá la fecha de la oferta para poder usar su mes como base.') : null,
  );
}

/** Cuántas líneas hay cargadas en el paso donde va cada componente. */
function loadedIn(quote, stepId) {
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  if (stepId === 'labor') return len(quote.labor);
  if (stepId === 'equipment') return len(quote.equipment);
  if (stepId === 'materials') return len(quote.materials) + len(quote.otherCosts);
  if (stepId === 'logistics') {
    const l = quote.logistics || {};
    return len(l.vehicles) + (Number(l.lodgingPerActivation) > 0 ? 1 : 0) + (Number(l.tollsPerActivation) > 0 ? 1 : 0);
  }
  return 0;
}

/** Lo escrito en "Otro componente" y todavía no agregado (sobrevive a los redibujos del paso). */
let customDraft = '';
onSessionReset(() => { customDraft = ''; });

/**
 * Redibuja sin perder el lugar: el control con `id` queda a la misma altura
 * de la pantalla y con el foco (el paso entero se vuelve a dibujar al cambiar).
 */
function keepPlace(id, run) {
  const el = id ? document.getElementById(id) : null;
  const top = el ? el.getBoundingClientRect().top : null;
  run();
  const again = id ? document.getElementById(id) : null;
  if (!again) return;
  if (top !== null) window.scrollBy(0, again.getBoundingClientRect().top - top);
  try {
    again.focus({ preventScroll: true });
  } catch {
    again.focus();
  }
}

/** Grupos de componentes, en el orden de los pasos donde se cargan. */
const COMPONENT_GROUPS = Object.freeze([
  { title: 'Personas y equipos', steps: ['labor', 'equipment'], ids: ['labor', 'vehicle', 'machinery', 'subcontract'] },
  { title: 'Materiales e insumos', steps: ['materials'], ids: ['tools', 'supplies', 'materials', 'ppe', 'other'] },
  { title: 'Viajes', steps: ['logistics'], ids: ['travel'] },
]);

/**
 * "¿Qué incluye el servicio?" (PLAN-2026-019): plantillas rápidas, componentes
 * que se suman en cualquier combinación (agrupados por el paso donde se
 * cargan, con link y cuántas líneas tiene) y componentes propios ("Otro").
 */
function componentsComposer({ quote, contract, components, custom, readOnly, ctx, apply, applyTemplate, applySuggestion, pricingLoaded }) {
  const selected = new Set(components);
  const saved = isPlainObject(quote.contract) ? quote.contract : {};
  // Sólo la plantilla elegida (guardada): en cotizaciones anteriores no se adivina por componentes
  // (no se muestra "Partiste de…" ni una sugerencia de cobro que nunca eligieron).
  const current = saved.templateId ? templateOf({ ...saved, components }) : null;

  // Plantillas (PLAN-2026-024): un selector buscable y agrupado en vez de una fila de botones.
  // Es un punto de partida: marca componentes y sugiere la unidad; todo queda editable.
  const toOption = (t) => ({ value: t.id, label: t.label, hint: `${templateGroupLabel(t)} · ${t.hint}` });
  // ¿La unidad de hoy difiere de la que sugiere la plantilla? (no se pisa sola).
  const unitNow = quote.unit || 'day';
  const differs = current && current.unit && current.unit !== unitNow;
  const unitPhrase = (unit) => `por ${billingUnitOf({ unit }).singular || 'unidad'}`;
  const summary = current
    ? h('div', { class: 'qe-template-summary' },
      h('p', { class: 'qe-note' },
        h('strong', {}, current.edited ? `Partiste de «${current.label}» y lo ajustaste. ` : `Partiste de «${current.label}». `),
        current.edited ? 'Lo que marcaste en "¿Qué incluye el servicio?" es lo que vale.' : `Marcó ${current.components.map((id) => (SERVICE_COMPONENTS.find((c) => c.id === id) || {}).label).filter(Boolean).join(', ')}.`,
        ' Todo se puede cambiar.'),
      differs && !readOnly
        ? h('p', { class: 'qe-note qe-template-suggest' },
          `La plantilla sugiere cobrar ${unitPhrase(current.unit)}. Hoy cobrás ${unitPhrase(unitNow)}. `,
          pricingLoaded
            ? 'Como ya cargaste una tarifa, no se cambia sola: si querés cobrar así, cambiá la unidad arriba.'
            : button('Usar la sugerencia', { variant: 'secondary', size: 'sm', onClick: () => applySuggestion(current) }))
        : null)
    : null;
  const templates = h('div', { class: 'qe-templates' },
    formGrid(2, searchSelectField({
      label: 'Plantilla',
      name: 'serviceTemplate',
      value: current ? current.id : null,
      disabled: readOnly,
      allowEmpty: false,
      placeholder: 'Buscá: cuadrilla, hora-hombre, grúa, limpieza…',
      options: SERVICE_TEMPLATES.map(toOption),
      search: (query) => searchTemplates(query).map(toOption),
      hint: 'Un punto de partida: marca lo que suele llevar ese servicio y, si todavía no cargaste una tarifa, la unidad en que se cobra. Después cambiás lo que quieras.',
      onChange: (id) => {
        const t = templateById(id);
        if (t) applyTemplate(t);
      },
    })),
    summary);

  const toggle = (c) => {
    const id = `cmp-${c.id}`;
    const input = h('input', { type: 'checkbox', id, name: 'contractComponents', value: c.id, checked: selected.has(c.id), disabled: readOnly });
    input.addEventListener('change', () => {
      const next = SERVICE_COMPONENTS.map((x) => x.id).filter((x) => (x === c.id ? input.checked : selected.has(x)));
      apply(next, custom, id);
    });
    return h('label', { class: 'choice', for: id, title: c.hint }, input, h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, c.label), h('span', { class: 'choice-hint' }, c.hint)));
  };

  const loadedText = (steps) => steps.map((s) => {
    const n = loadedIn(quote, s);
    return h('span', { class: 'qe-components-step' },
      h('a', { href: ctx.href(s) }, stepName(s)),
      h('span', { class: ['qe-components-count', n ? 'is-loaded' : 'is-empty'] }, n ? ` · ${formatNumber(n)} ${n === 1 ? 'cargado' : 'cargados'}` : ' · sin cargar'));
  });

  const groups = COMPONENT_GROUPS.map((g) => {
    const used = g.ids.some((id) => selected.has(id)) || (g.steps.includes('materials') && custom.length > 0);
    return h('div', { class: 'qe-component-group' },
      h('div', { class: 'qe-component-group-head' },
        h('span', { class: 'qe-component-group-title' }, g.title),
        used ? h('span', { class: 'qe-component-group-where small' }, 'Se carga en ', ...loadedText(g.steps.filter((s) => SERVICE_COMPONENTS.some((c) => c.step === s && selected.has(c.id)) || (s === 'materials' && custom.length)))) : null),
      h('div', { class: 'choice-grid qe-components' }, ...g.ids.map((id) => toggle(SERVICE_COMPONENTS.find((c) => c.id === id)))));
  });

  // Componentes propios: un nombre libre que se carga como otro costo directo (paso Materiales).
  const customInput = h('input', { type: 'text', id: 'cmp-custom', maxlength: '60', placeholder: 'Ej.: Baño químico', 'aria-label': 'Otro componente', value: customDraft, disabled: readOnly });
  const addCustom = () => {
    const name = customInput.value.trim();
    if (!name) return;
    customDraft = '';
    apply(components, [...custom, name], 'cmp-custom');
  };
  customInput.addEventListener('input', () => { customDraft = customInput.value; });
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
  });
  const customRow = h('div', { class: 'qe-custom-components' },
    custom.length ? h('div', { class: 'variant-suggest-list' }, ...custom.map((name) => h('span', { class: 'qe-custom-chip' }, name,
      readOnly ? null : h('button', { type: 'button', class: 'qe-chip-remove', 'aria-label': `Quitar ${name}`, on: { click: () => apply(components, custom.filter((x) => x !== name), 'cmp-custom') } }, '×')))) : null,
    readOnly ? null : h('div', { class: 'qe-custom-add' }, h('div', { class: 'field-control' }, customInput), button('Agregar', { icon: 'plus', onClick: addCustom })));

  return { templates, fieldset: h('fieldset', { class: 'choice-group qe-includes' },
    h('legend', { class: 'field-label' }, '¿Qué incluye el servicio? ', infoTip('Marcá cada categoría de gasto que lleva el servicio, en cualquier combinación: por ejemplo personal con vehículo e insumos (los químicos son insumos). Sin personal, un equipo o vehículo es alquiler sin operador. Cada categoría se costea una sola vez, en el paso que se indica, y se ve con su costo en el Resultado. Si falta algo, agregalo en "Otro componente" (se carga como otro costo en Materiales).')),
    ...groups,
    h('div', { class: 'variant-suggest qe-custom-block' }, h('span', { class: 'variant-suggest-label' }, 'Otro componente'), customRow),
  ) };
}

export function render(container, ctx) {
  const { quote, kit } = ctx;

  const identity = card(
    {},
    formGrid(
      2,
      kit.text('name', { label: 'Nombre de la cotización', required: true, maxLength: 120, placeholder: 'Ej.: Hidrogrúa por hora — Añelo', hint: 'Para encontrarla después.' }),
      kit.text('client', { label: 'Cliente', maxLength: 120, placeholder: 'Ej.: Operadora' }),
    ),
  );

  /**
   * 0.10.0 ("La unidad primero"): primero en qué unidad se le cobra al cliente (el modo del
   * contrato se deriva de la unidad, unit-choice.js), después qué incluye el servicio. El tipo de
   * servicio guardado se sigue derivando del contrato. Cambiar lo que incluye no cambia la unidad
   * ni el modo.
   */
  const contract = contractOf(quote);
  const saved = isPlainObject(quote.contract) ? quote.contract : null;
  const components = componentsOf(saved || contract);
  const custom = saved && Array.isArray(saved.customComponents) ? saved.customComponents : [];
  const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
  const pricingNow = quote.pricing || {};
  // Con tarifa o mínimo cargados, la plantilla no cambia la unidad (se ofrece aparte).
  const pricingLoaded = positive(pricingNow.knownRate) || positive(pricingNow.offeredRateOverride) || positive(quote.rules && quote.rules.minimumCallUnits);

  /**
   * Guarda lo que incluye el servicio (y, desde una plantilla sin tarifa cargada, la unidad que
   * sugiere). Devuelve los avisos para juntarlos en uno.
   * @param {{ components: string[], customComponents: string[], templateId?: string|null, unit?: string|null, touchedComponents?: boolean }} next
   */
  function applyContract(next) {
    const messages = [];
    const current = quote.unit || 'day';
    const nextUnit = next.unit && !pricingLoaded ? next.unit : current;
    let reopenedLogistics = false;
    let unitNotices = [];
    ctx.mutate((q) => {
      const mode = contractOf(q).mode;
      q.contract = contractWithComponents({ mode, templateId: next.templateId || undefined }, next.components, next.customComponents);
      q.serviceType = serviceTypeForContract(q.contract);
      // Unidad sugerida por una plantilla: la misma regla que elegirla arriba (limpia con aviso).
      if (nextUnit !== current) unitNotices = applyQuoteUnit(q, nextUnit);
      if (!next.touchedComponents) return;
      // Al sumar un componente de materiales, si estaba "no usa materiales" se
      // vuelve a pedir (nunca se marca solo: es una confirmación de la persona).
      const noMaterials = !Array.isArray(q.materials) || q.materials.length === 0;
      if (contractUsesMaterials(q.contract) === true && q.materialsNotApplicable === true && noMaterials) q.materialsNotApplicable = false;
      // Viáticos se cargan en "Movilización y viajes": si estaba "Sin traslados", se vuelve a pedir (con aviso).
      if (q.contract.components.includes('travel') && q.logistics && q.logistics.notApplicable === true) {
        q.logistics.notApplicable = false;
        reopenedLogistics = true;
      }
    });
    if (reopenedLogistics) messages.push({ text: `Viáticos: revisá ${step('logistics')}, que estaba como "Sin traslados".`, tone: 'info' });
    if (nextUnit !== current) messages.push({ text: `Cobrás por ${billingUnitOf({ unit: nextUnit, unitName: quote.unitName }).singular || 'unidad'}.${unitNotices.length ? ` ${unitNotices.join(' ')}` : ''}`, tone: unitNotices.length ? 'warning' : 'info' });
    return messages;
  }
  const sayAll = (messages) => messages.forEach((m) => ctx.toast(m.text, m.tone));

  const tip = MODE_TIPS[contract.mode];
  const unitCard = card(
    {},
    unitChoiceBlock(ctx),
    tip ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, tip.short, ' ', infoTip(tip.more))) : null,
  );

  /**
   * Plantilla elegida (PLAN-2026-024): componentes + unidad sugerida. Los componentes propios
   * ("Otro") se conservan. Si ya hay una tarifa o un mínimo cargados, la unidad no cambia. No
   * carga montos ni recursos.
   */
  const applyTemplate = (t) => {
    // Nunca se quita un componente que ya tiene líneas cargadas en su paso.
    const kept = components.filter((id) => !t.components.includes(id) && loadedIn(quote, (SERVICE_COMPONENTS.find((c) => c.id === id) || {}).step) > 0);
    const list = [...t.components, ...kept];
    let messages = [];
    keepPlace(null, () => {
      messages = applyContract({ components: list, customComponents: custom, templateId: t.id, unit: t.unit || null, touchedComponents: true });
    });
    const keptText = kept.length ? ` Se mantuvo ${kept.map((id) => (SERVICE_COMPONENTS.find((c) => c.id === id) || {}).label).join(', ')} porque ya tiene líneas cargadas.` : '';
    const how = pricingLoaded && t.unit && t.unit !== (quote.unit || 'day') ? ' Como ya cargaste una tarifa, la unidad no cambió.' : '';
    // Un solo aviso (tanda novatos 2026-11): la plantilla y, si cambió, la unidad.
    const extra = messages.map((m) => ` ${m.text}`).join('');
    const tone = messages.some((m) => m.tone === 'warning') ? 'warning' : 'info';
    ctx.toast(`«${t.label}» aplicada.${extra}${keptText}${how}`, tone);
  };
  const applySuggestion = (t) => sayAll(applyContract({ components, customComponents: custom, templateId: t.id, unit: t.unit || null }));
  const composer = componentsComposer({ quote, contract, components, custom, readOnly: kit.readOnly, ctx, applyTemplate, applySuggestion, pricingLoaded, apply: (list, extra = custom, focusId = null) => {
    keepPlace(focusId, () => {
      if (!list.length && !extra.length) {
        ctx.toast('El servicio tiene que incluir algo: dejá al menos un componente.', 'warning');
        ctx.rerender();
        return;
      }
      sayAll(applyContract({ components: list, customComponents: extra, templateId: saved && saved.templateId, touchedComponents: true }));
    });
  } });
  const includes = card({}, composer.fieldset);
  // Plantillas: ayuda opcional, plegada y al final (0.10.0): la primera decisión es la unidad.
  const templatesCard = kit.advanced(
    {
      key: 'service-templates',
      title: 'Partir de una plantilla (opcional)',
      boxed: true,
      defaultOpen: Boolean(saved && saved.templateId),
      summary: () => {
        const t = saved && saved.templateId ? templateById(saved.templateId) : null;
        return t ? `Partiste de «${t.label}».` : 'Cuadrilla por hora-hombre, equipo con operador, servicio técnico… Marca lo que suele llevar y sugiere la unidad.';
      },
    },
    composer.templates,
  );

  const more = kit.advanced(
    {
      key: 'service',
      title: 'Más datos de la cotización',
      boxed: true,
      summary: () => {
        const parts = [
          `Estado: ${labelOf(QUOTE_STATUSES, quote.status, 'sin estado').toLowerCase()}`,
          // Precio cerrado (A-1): lo que muestra el Resultado es el total por trabajo(s), no por meses.
          contract.mode === 'closed'
            ? (isFiniteNumber(Number(quote.contractJobs)) && Number(quote.contractJobs) > 0 && quote.contractJobs !== null && quote.contractJobs !== ''
              ? `total de ${formatNumber(Number(quote.contractJobs), { decimals: 2 })} trabajos`
              : 'total de 1 trabajo')
            : isFiniteNumber(Number(quote.contractMonths)) && quote.contractMonths !== null && quote.contractMonths !== ''
              ? `contrato de ${formatNumber(Number(quote.contractMonths))} meses`
              : 'sin duración de contrato',
          quote.code ? `código ${quote.code}` : null,
          String(quote.notes || '').trim() ? 'con notas' : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : EMPTY;
      },
    },
    formGrid(
      3,
      kit.staticField('Código', quote.code, 'Se asigna automáticamente y no se puede cambiar.'),
      kit.select('status', { label: 'Estado', options: QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })) }),
      // Precio cerrado (tanda A 2026-11, A-1): el total del Resultado es por trabajo, no por
      // meses; por eso va antes que la duración del contrato.
      contract.mode === 'closed'
        ? kit.num('contractJobs', {
          label: 'Trabajos que cubre el total',
          rule: 'quantity',
          unit: 'trabajos',
          placeholder: '1',
          hint: 'El Resultado muestra el total de un trabajo. Si la obra son varios trabajos iguales, cargá cuántos. Vacío = 1.',
        })
        : null,
      kit.num('contractMonths', {
        label: 'Duración del contrato',
        rule: 'months',
        unit: 'meses',
        hint: contract.mode === 'closed'
          ? `Se usa para el descuento por continuidad (en ${step('margin')}). Cobrando por trabajo no multiplica el precio del trabajo.`
          : `Se usa para el descuento por continuidad (en ${step('margin')}).`,
      }),
    ),
    kit.text('notes', {
      label: 'Notas internas',
      multiline: true,
      maxLength: 2000,
      hint: 'Supuestos, alcance, exclusiones o aclaraciones. Quedan guardadas con la cotización, en tu cuenta: no se comparten con nadie fuera de tu empresa.',
    }),
  );

  // Base económica de la oferta (PLAN-2026-005): con qué fecha base, moneda
  // y tipo de cambio se calculó. Se compara contra la fecha de la OFERTA.
  // PLAN-2026-026: plegada (no hace falta para empezar); se abre sola si hay algo que corregir.
  const economicBase = kit.advanced(
    {
      key: 'service-economic-base',
      title: 'Fecha de la oferta y de los precios (opcional)',
      boxed: true,
      summary: () => {
        const d = kit.get('offerDate');
        return typeof d === 'string' && d ? `Oferta del ${formatDayDate(d)} · moneda ${quoteCurrencyOf(quote)}.` : `Sin fecha de oferta · moneda ${quoteCurrencyOf(quote)}.`;
      },
    },
    h('p', { class: 'qe-note' }, 'De qué mes son los valores con los que calculás esta oferta. La cotización guarda sus valores: si después cambian en Recursos, te avisa y vos decidís si actualizarlos.'),
    formGrid(
      2,
      dateField({
        label: 'Fecha de la oferta',
        name: 'offerDate',
        value: kit.get('offerDate'),
        hint: 'La base general de la oferta es el mes de esta fecha. Las bases de cada valor se comparan contra ella.',
        disabled: ctx.readOnly,
        onChange: (v) => ctx.update('offerDate', v),
      }),
    ),
    kit.region((r) => economicBaseSummary(r.economicBase)),
    kit.region((r) => baseDetail(r.economicBase, ctx)),
    h('h4', { class: 'qe-group-title' }, 'Tipos de cambio de esta cotización'),
    exchangeRatesEditor(ctx),
  );

  mount(container, identity, unitCard, includes, templatesCard, economicBase, more);
  return { update() {} };
}
