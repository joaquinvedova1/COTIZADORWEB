/**
 * Etapa 1 · El contrato (PLAN-2026-018).
 * Básico: nombre, cliente, cómo paga el cliente (fijo mensual / por servicio
 * prestado / precio cerrado) y qué incluye: componentes combinables
 * (personal, vehículo, equipo, terceros, insumos, químicos…; PLAN-2026-019),
 * con plantillas rápidas para los casos comunes.
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { button, card, choiceGroup, dateField, formGrid, icon, confirmDialog, infoTip, searchSelectField } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf, BILLING_UNITS } from '../../../domain/billing-units.js';
import { CONTRACT_MODES, SERVICE_COMPONENTS, SERVICE_TEMPLATES, componentsOf, contractOf, contractUnits, contractUsesMaterials, contractWithComponents, defaultUnitForContract, serviceTypeForContract, templateOf, unitFitsContract, searchTemplates, templateGroupLabel, templateById } from '../../../domain/contract.js';
import { isPlainObject } from '../../../core/object.js';
import { formatNumber, formatPeriod, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { onSessionReset } from '../../session-memory.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

/** Qué sigue según la modalidad del contrato (PLAN-2026-018). */
const MODE_TIPS = Object.freeze({
  monthly: { short: `Lo que exceda el fijo se cobra en "Adicionales" (${step('modality')}).`, more: 'Cargá lo que cubre el fijo (por ejemplo 26 días × 12 h). Fuera de horario, feriados y trabajos extra van como adicionales, con su propio precio, en la misma cotización.' },
  on_demand: { short: `Unidad y mínimo mensual: en ${step('modality')}.`, more: 'Elegí en qué unidad cobrás (hora, día, viaje, m³…) y cuánto esperás trabajar por mes. Si el cliente garantiza un mínimo mensual, se carga ahí mismo.' },
  closed: { short: `Incertidumbre: en ${step('risk')}. Fuera de alcance: "Adicionales".`, more: 'Cargá todo el alcance (personal, equipos, materiales, HSE, seguros). Los trabajos fuera del alcance con precio unitario van en "Adicionales".' },
})

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
  const rows = [
    ...missing.map((e) => h('li', { class: 'is-undefined' }, h('strong', {}, e.label), ' — Base no definida')),
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
    h('summary', {}, `Ver los valores para revisar (${formatNumber(rows.length)})`),
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
  { title: 'Materiales e insumos', steps: ['materials'], ids: ['tools', 'supplies', 'chemicals', 'materials', 'ppe', 'waste', 'other'] },
  { title: 'Viajes', steps: ['logistics'], ids: ['travel'] },
]);

/**
 * "¿Qué incluye el servicio?" (PLAN-2026-019): plantillas rápidas, componentes
 * que se suman en cualquier combinación (agrupados por el paso donde se
 * cargan, con link y cuántas líneas tiene) y componentes propios ("Otro").
 */
function componentsComposer({ quote, contract, components, custom, readOnly, ctx, apply, applyTemplate }) {
  const selected = new Set(components);
  const saved = isPlainObject(quote.contract) ? quote.contract : {};
  const current = templateOf({ ...saved, components });

  // Plantillas (PLAN-2026-024): un selector buscable y agrupado en vez de una fila de botones.
  // Es un punto de partida: marca componentes y sugiere modalidad y unidad; todo queda editable.
  const toOption = (t) => ({ value: t.id, label: t.label, hint: `${templateGroupLabel(t)} · ${t.hint}` });
  const modeText = (t) => {
    const parts = [];
    if (t.mode) parts.push((CONTRACT_MODES.find((m) => m.id === t.mode) || {}).label);
    if (t.unit) parts.push(billingUnitOf({ unit: t.unit }).label);
    return parts.filter(Boolean).join(', ');
  };
  const summary = current
    ? h('p', { class: 'qe-note qe-template-summary' },
      h('strong', {}, current.edited ? `Partiste de «${current.label}» y lo ajustaste. ` : `Partiste de «${current.label}». `),
      current.edited ? 'Los componentes de abajo son los que valen.' : `Marcó ${current.components.map((id) => (SERVICE_COMPONENTS.find((c) => c.id === id) || {}).label).filter(Boolean).join(', ')}${modeText(current) ? `; sugirió ${modeText(current)}` : ''}.`,
      ' Todo se puede cambiar: sumá o quitá componentes, recursos y condiciones de cobro.')
    : null;
  const templates = h('div', { class: 'qe-templates' },
    formGrid(2, searchSelectField({
      label: 'Empezar desde una plantilla (opcional)',
      name: 'serviceTemplate',
      value: current ? current.id : null,
      disabled: readOnly,
      allowEmpty: false,
      placeholder: 'Escribí: cuadrilla, hora-hombre, equipo, integral…',
      options: SERVICE_TEMPLATES.map(toOption),
      search: (query) => searchTemplates(query).map(toOption),
      hint: 'Es un punto de partida: marca lo que suele llevar ese servicio y, si no cargaste una tarifa, cómo se cobra. Después cambiás lo que quieras.',
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

  return h('fieldset', { class: 'choice-group qe-includes' },
    h('legend', { class: 'field-label' }, '¿Qué incluye el servicio? ', infoTip('Sumá todo lo que lleva el servicio, en cualquier combinación: por ejemplo una persona con camioneta e insumos, o una cuadrilla con químicos. Sin personal, un equipo o vehículo es alquiler sin operador. Cada componente se costea una sola vez, en el paso que se indica. Si falta algo, agregalo en "Otro componente" (se carga como otro costo en Materiales).')),
    templates,
    ...groups,
    h('div', { class: 'variant-suggest qe-custom-block' }, h('span', { class: 'variant-suggest-label' }, 'Otro componente'), customRow),
  );
}

export function render(container, ctx) {
  const { quote, kit } = ctx;

  const identity = card(
    {},
    formGrid(
      2,
      kit.text('name', { label: 'Nombre de la cotización', required: true, maxLength: 120, placeholder: 'Ej.: Hidrogrúa on-call — Añelo', hint: 'Para encontrarla después.' }),
      kit.text('client', { label: 'Cliente', maxLength: 120, placeholder: 'Ej.: Operadora' }),
    ),
  );

  /**
   * Contrato (PLAN-2026-018): primero cómo paga el cliente, después qué
   * incluye. El tipo de servicio guardado se deriva del contrato. La unidad de
   * cobro sigue a la modalidad (fijo mensual → $/mes, precio cerrado → $ global);
   * si ya hay una tarifa o un mínimo por llamado cargados, NO se cambia la
   * unidad (el número se leería en otra unidad): se avisa.
   */
  const contract = contractOf(quote);
  const saved = isPlainObject(quote.contract) ? quote.contract : null;
  const components = componentsOf(saved || contract);
  const custom = saved && Array.isArray(saved.customComponents) ? saved.customComponents : [];
  function applyContract(next) {
    const current = quote.unit || 'day';
    const fits = unitFitsContract(next, current);
    const pricing = quote.pricing || {};
    const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
    const locked = positive(pricing.knownRate) || positive(pricing.offeredRateOverride) || positive(quote.rules && quote.rules.minimumCallUnits);
    // Unidad sugerida por una plantilla (PLAN-2026-024): sólo sin tarifa ni mínimo cargados.
    const preferred = next.unit && unitFitsContract(next, next.unit) ? next.unit : null;
    const nextUnit = locked ? current : preferred || (fits ? current : defaultUnitForContract(next));
    let reopenedLogistics = false;
    ctx.mutate((q) => {
      q.contract = contractWithComponents({ ...next, templateId: next.templateId || undefined }, next.components, next.customComponents);
      q.serviceType = serviceTypeForContract(q.contract);
      q.unit = nextUnit;
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
    if (reopenedLogistics) ctx.toast(`Viáticos: revisá ${step('logistics')}, que estaba como "Sin traslados".`, 'info');
    if (nextUnit !== current) {
      ctx.toast(`Se cobra ${billingUnitOf({ unit: nextUnit }).label}: podés cambiarlo en ${step('modality')}.`, 'info');
    } else if (!fits || (next.unit && next.unit !== current && locked)) {
      const usual = contractUnits(next).map((id) => (BILLING_UNITS.find((u) => u.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
      ctx.toast(`Esta modalidad se cobra en ${usual}. Como ya cargaste una tarifa ${billingUnitOf(quote).label}, la unidad no cambió: revisala en ${step('modality')}.`, 'warning');
    }
  }

  const tip = MODE_TIPS[contract.mode];
  const withMode = (mode) => ({ mode, components, customComponents: custom, templateId: saved && saved.templateId });
  const type = card(
    {},
    choiceGroup({
      label: '¿Cómo te paga el cliente?',
      name: 'contractMode',
      value: contract.mode,
      disabled: kit.readOnly,
      options: CONTRACT_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
      onChange: (mode) => applyContract(withMode(mode)),
    }),
    tip ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, tip.short, ' ', infoTip(tip.more))) : null,
  );

  /**
   * Plantilla elegida (PLAN-2026-024): componentes + modalidad y unidad sugeridas. Los
   * componentes propios ("Otro") se conservan. Si ya hay una tarifa o un mínimo cargados, la
   * unidad no cambia (applyContract avisa). No carga montos ni recursos.
   */
  const applyTemplate = (t) => {
    const mode = t.mode || contract.mode;
    keepPlace(null, () => applyContract({ mode, components: [...t.components], customComponents: custom, templateId: t.id, unit: t.unit || null, touchedComponents: true }));
    const changes = [
      `${formatNumber(t.components.length)} componentes marcados`,
      t.mode && t.mode !== contract.mode ? `cobro: ${(CONTRACT_MODES.find((m) => m.id === t.mode) || {}).label}` : null,
    ].filter(Boolean).join(' · ');
    ctx.toast(`«${t.label}»: ${changes}. Es un punto de partida: cambiá lo que haga falta.`, 'info');
  };
  const includes = card({}, componentsComposer({ quote, contract, components, custom, readOnly: kit.readOnly, ctx, applyTemplate, apply: (list, extra = custom, focusId = null) => {
    keepPlace(focusId, () => {
      if (!list.length && !extra.length) {
        ctx.toast('El servicio tiene que incluir algo: dejá al menos un componente.', 'warning');
        ctx.rerender();
        return;
      }
      applyContract({ mode: contract.mode, components: list, customComponents: extra, templateId: saved && saved.templateId, touchedComponents: true });
    });
  } }));

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
          ? `Se usa para el descuento por continuidad (en ${step('margin')}). Con precio cerrado no multiplica el total del trabajo.`
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
  const economicBase = card(
    {
      title: 'Base económica de la oferta',
      subtitle: `De qué mes son los valores con los que calculás esta oferta. La cotización guarda sus valores: si después cambian en Recursos, te avisa y vos decidís si actualizarlos. Moneda: ${quoteCurrencyOf(quote)}.`,
    },
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

  mount(container, identity, type, includes, economicBase, more);
  return { update() {} };
}
