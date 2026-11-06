/**
 * Etapa 1 · El contrato (PLAN-2026-018).
 * Básico: nombre, cliente, cómo paga el cliente (fijo mensual / por servicio
 * prestado / precio cerrado) y qué incluye: componentes combinables
 * (personal, vehículo, equipo, terceros, insumos, químicos…; PLAN-2026-019),
 * con plantillas rápidas para los casos comunes.
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { button, card, choiceGroup, dateField, formGrid, icon, confirmDialog, infoTip } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf, BILLING_UNITS } from '../../../domain/billing-units.js';
import { CONTRACT_MODES, SERVICE_COMPONENTS, SERVICE_TEMPLATES, componentsOf, contractOf, contractUnits, contractUsesMaterials, contractWithComponents, defaultUnitForContract, serviceTypeForContract, templateOf, unitFitsContract } from '../../../domain/contract.js';
import { isPlainObject } from '../../../core/object.js';
import { formatNumber, formatPeriod, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
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

/**
 * "¿Qué incluye el servicio?" (PLAN-2026-019): plantillas rápidas, componentes
 * que se suman en cualquier combinación, componentes propios ("Otro…") y
 * dónde se carga el costo de cada uno.
 */
function componentsComposer({ quote, components, custom, readOnly, ctx, apply }) {
  const selected = new Set(components);
  const current = custom.length ? null : templateOf(components);

  const templates = h('div', { class: 'variant-suggest qe-templates' },
    h('span', { class: 'variant-suggest-label' }, 'Plantillas rápidas'),
    h('div', { class: 'variant-suggest-list' }, ...SERVICE_TEMPLATES.map((t) => h('button', {
      type: 'button',
      class: ['chip-suggest', current && current.id === t.id ? 'is-selected' : null],
      'aria-pressed': current && current.id === t.id ? 'true' : 'false',
      disabled: readOnly,
      on: { click: () => apply([...t.components], []) },
    }, t.label))));

  const toggles = h('div', { class: 'choice-grid qe-components' }, ...SERVICE_COMPONENTS.map((c) => {
    const id = `cmp-${c.id}`;
    const input = h('input', { type: 'checkbox', id, name: 'contractComponents', value: c.id, checked: selected.has(c.id), disabled: readOnly });
    input.addEventListener('change', () => {
      const next = SERVICE_COMPONENTS.map((x) => x.id).filter((x) => (x === c.id ? input.checked : selected.has(x)));
      apply(next);
    });
    return h('label', { class: 'choice', for: id }, input, h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, c.label), h('span', { class: 'choice-hint' }, c.hint)));
  }));

  // Componentes propios: un nombre libre que se carga como otro costo directo.
  let draft = '';
  const addCustom = () => {
    const name = draft.trim();
    if (!name) return;
    apply(components, [...custom, name]);
  };
  const customInput = h('input', { type: 'text', maxlength: '60', placeholder: 'Ej.: Baño químico, Laboratorio, Andamio', 'aria-label': 'Otro componente', disabled: readOnly });
  customInput.addEventListener('input', () => { draft = customInput.value; });
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustom();
    }
  });
  const customRow = h('div', { class: 'qe-custom-components' },
    custom.length ? h('div', { class: 'variant-suggest-list' }, ...custom.map((name) => h('span', { class: 'chip-suggest is-selected qe-custom-chip' }, name,
      readOnly ? null : h('button', { type: 'button', class: 'qe-chip-remove', 'aria-label': `Quitar ${name}`, on: { click: () => apply(components, custom.filter((x) => x !== name)) } }, '×')))) : null,
    readOnly ? null : h('div', { class: 'qe-custom-add' }, h('div', { class: 'field-control' }, customInput), button('Agregar', { icon: 'plus', onClick: addCustom })));

  // Dónde se carga cada componente (el costo vive en su paso: no se carga dos veces).
  const byStep = new Map();
  SERVICE_COMPONENTS.filter((c) => selected.has(c.id)).forEach((c) => {
    if (!byStep.has(c.step)) byStep.set(c.step, []);
    byStep.get(c.step).push(c.label);
  });
  if (custom.length) {
    if (!byStep.has('materials')) byStep.set('materials', []);
    byStep.get('materials').push(...custom);
  }
  const order = ['labor', 'equipment', 'materials', 'logistics'];
  const where = byStep.size
    ? h('ul', { class: 'qe-components-where' }, ...order.filter((s) => byStep.has(s)).map((s) => {
      const n = loadedIn(quote, s);
      return h('li', {},
        h('a', { href: ctx.href(s) }, stepName(s)),
        ': ', byStep.get(s).join(', '),
        h('span', { class: ['qe-components-count', n ? 'is-loaded' : 'is-empty'] }, n ? ` · ${formatNumber(n)} ${n === 1 ? 'cargado' : 'cargados'}` : ' · sin cargar'));
    }))
    : null;

  return h('fieldset', { class: 'choice-group' },
    h('legend', { class: 'field-label' }, '¿Qué incluye el servicio? ', infoTip('Sumá todo lo que lleva el servicio, en cualquier combinación: por ejemplo una persona con camioneta e insumos, o una cuadrilla con químicos. Sin personal, un equipo o vehículo es alquiler sin operador. Cada componente se costea en su paso; si falta algo, agregalo en "Otro".')),
    templates,
    toggles,
    h('div', { class: 'variant-suggest' }, h('span', { class: 'variant-suggest-label' }, 'Otro componente'), customRow),
    where ? h('div', { class: 'qe-tip' }, icon('info'), h('div', {}, h('p', {}, 'Dónde se carga cada uno:'), where)) : null,
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
    const nextUnit = fits || locked ? current : defaultUnitForContract(next);
    let reopenedLogistics = false;
    ctx.mutate((q) => {
      q.contract = contractWithComponents(next, next.components, next.customComponents);
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
    } else if (!fits) {
      const usual = contractUnits(next).map((id) => (BILLING_UNITS.find((u) => u.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
      ctx.toast(`Esta modalidad se cobra en ${usual}. Como ya cargaste una tarifa ${billingUnitOf(quote).label}, la unidad no cambió: revisala en ${step('modality')}.`, 'warning');
    }
  }

  const tip = MODE_TIPS[contract.mode];
  const withMode = (mode) => ({ mode, components, customComponents: custom });
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

  const includes = card({}, componentsComposer({ quote, contract, components, custom, readOnly: kit.readOnly, ctx, apply: (list, extra = custom) => {
    if (!list.length && !extra.length) {
      ctx.toast('El servicio tiene que incluir algo: dejá al menos un componente.', 'warning');
      ctx.rerender();
      return;
    }
    applyContract({ mode: contract.mode, components: list, customComponents: extra, touchedComponents: true });
  } }));

  const more = kit.advanced(
    {
      key: 'service',
      title: 'Más datos de la cotización',
      boxed: true,
      summary: () => {
        const parts = [
          `Estado: ${labelOf(QUOTE_STATUSES, quote.status, 'sin estado').toLowerCase()}`,
          isFiniteNumber(Number(quote.contractMonths)) && quote.contractMonths !== null && quote.contractMonths !== ''
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
      kit.num('contractMonths', {
        label: 'Duración del contrato',
        rule: 'months',
        unit: 'meses',
        hint: `Se usa para el descuento por continuidad (en ${step('margin')}).`,
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
