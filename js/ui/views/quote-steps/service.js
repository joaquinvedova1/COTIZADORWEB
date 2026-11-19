/**
 * Etapa 1 · El contrato (PLAN-2026-018; 0.10.0 "La unidad primero").
 * Básico: nombre, cliente, EN QUÉ UNIDAD se le cobra al cliente (por mes, por trabajo, por hora,
 * por día, por unidad con nombre propio u otra del catálogo: el modo del contrato se deriva de
 * ahí) y qué incluye el servicio: categorías de gasto combinables (personal, vehículos, equipos,
 * terceros, herramientas, insumos, materiales, EPP, viáticos, otros; PLAN-2026-019). Sin
 * plantillas para partir (0.16.0, Joaco: no son útiles).
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { card, dateField, formGrid, icon, confirmDialog, infoTip } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { SERVICE_COMPONENTS, componentsOf, contractOf, contractUsesMaterials, contractWithComponents, lineComponentOf, modeForUnit, serviceTypeForContract } from '../../../domain/contract.js';
import { isPlainObject } from '../../../core/object.js';
import { formatMoney, formatNumber, formatPeriod, formatDayDate, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { applyModeDerivation, applyQuoteUnit, unitChoiceBlock } from './unit-choice.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

/** Qué sigue según cómo se cobra (0.10.0: se habla de la unidad, no de tipos de contrato). */
const MODE_TIPS = Object.freeze({
  monthly: { more: `Cargá lo que cubre la tarifa del mes (por ejemplo 26 días × 12 h). Si hay horas fuera de horario, elegilas en "Horas extra del trabajo" (${step('modality')}): quedan dentro del precio. Para otra variante, duplicá la cotización (Más acciones → Duplicar).` },
  on_demand: { more: 'Con eso RATEOS calcula tu precio por unidad: cuanto menos trabajes, más alto tiene que ser para pagar a tu gente y tus equipos.' },
  closed: { more: `Personal, equipos, materiales, HSE, seguros. Lo incierto se reserva en ${step('risk')}. Si hay horas fuera de horario, elegilas en "Horas extra del trabajo" (${step('modality')}): quedan dentro del precio. Un trabajo fuera del alcance es otra cotización: duplicala (Más acciones → Duplicar).` },
});

/**
 * Qué se carga después, en la unidad elegida (revisión 0.10.0, U9): "En «Cómo se cobra» cargás
 * cuántos diagnósticos hacés por mes."
 */
export function unitNextStepText(quote = {}) {
  const info = billingUnitOf(quote);
  const where = `En «${stepName('modality')}»`;
  if (info.kind === 'month') return `${where} cargás qué cubre la tarifa del mes.`;
  if (info.id === 'job') return `${where} cargás cuántos días lleva el trabajo.`;
  if (info.kind === 'hour') return `${where} cargás cuánto trabajás: cuántas horas por día y cuántos días por mes.`;
  if (info.kind === 'day') return `${where} cargás cuántos días trabajás por mes.`;
  return `${where} cargás cuántos ${info.plural || 'unidades'} hacés por mes.`;
}

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
  if (stepId === 'labor') return len(quote.labor) + len(quote.contractedStaff);
  if (stepId === 'equipment') return len(quote.equipment);
  if (stepId === 'materials') return len(quote.materials) + len(quote.otherCosts);
  if (stepId === 'logistics') {
    const l = quote.logistics || {};
    return len(l.vehicles) + (Number(l.lodgingPerActivation) > 0 ? 1 : 0) + (Number(l.tollsPerActivation) > 0 ? 1 : 0);
  }
  return 0;
}

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

/**
 * Gastos cargados de una categoría de "¿Qué incluye el servicio?" (revisión 0.10.0, U1):
 * Materiales u Otros costos por la categoría de cada línea; Personal, sus puestos; Vehículos,
 * Equipos y Terceros, las líneas de Equipos (si ninguna de las tres queda marcada en `next`).
 * @returns {{ count: number, step: string|null, one: string, many: string }}
 */
export function loadedFor(quote, id, next = []) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => isPlainObject(x)) : []);
  const def = SERVICE_COMPONENTS.find((c) => c.id === id) || {};
  if (def.step === 'materials') {
    const mats = quote.materialsNotApplicable ? [] : list(quote.materials).filter((m) => lineComponentOf(m, 'material') === id);
    const others = list(quote.otherCosts).filter((o) => lineComponentOf(o, 'other') === id);
    return { count: mats.length + others.length, step: 'materials', one: 'gasto cargado', many: 'gastos cargados' };
  }
  if (id === 'labor') return { count: list(quote.labor).length + list(quote.contractedStaff).length, step: 'labor', one: 'puesto cargado', many: 'puestos cargados' };
  if (def.equipment) {
    const stillEquipment = next.some((x) => (SERVICE_COMPONENTS.find((c) => c.id === x) || {}).equipment);
    return { count: stillEquipment ? 0 : list(quote.equipment).length, step: 'equipment', one: 'equipo cargado', many: 'equipos cargados' };
  }
  return { count: 0, step: null, one: '', many: '' };
}

/** "EPP tiene 1 gasto cargado ($ 45.000 por mes): borralo en «Materiales» para quitar la categoría." */
export function blockedRemovalText(quote, id, next = [], result = null) {
  const def = SERVICE_COMPONENTS.find((c) => c.id === id) || {};
  const l = loadedFor(quote, id, next);
  const n = l.count;
  let amount = null;
  try {
    if (result && def.step === 'materials' && result.componentCosts) {
      const part = result.componentCosts.byComponent[id];
      const total = part ? part.amount : 0;
      const jobs = result.componentCosts.jobsPerMonth;
      if (total > 0.005) amount = jobs ? `${formatMoney(total / jobs)} en el trabajo` : `${formatMoney(total)} por mes`;
    } else if (result && id === 'labor' && result.eecc) {
      const row = result.eecc.rows.find((r) => r.category === 'labor');
      const jobs = result.componentCosts ? result.componentCosts.jobsPerMonth : null;
      if (row && row.amount > 0.005) amount = jobs ? `${formatMoney(row.amount / jobs)} en el trabajo` : `${formatMoney(row.amount)} por mes`;
    }
  } catch {
    amount = null;
  }
  const what = `${formatNumber(n)} ${n === 1 ? l.one : l.many}${amount ? ` (${amount})` : ''}`;
  const subject = def.equipment ? 'Equipos' : def.label || id;
  return `${subject} tiene ${what}: ${n === 1 ? 'borralo' : 'borralos'} en «${stepName(l.step)}» para quitar la categoría.`;
}

/** Grupos de componentes, en el orden de los pasos donde se cargan. */
const COMPONENT_GROUPS = Object.freeze([
  { title: 'Personas y equipos', steps: ['labor', 'equipment'], ids: ['labor', 'vehicle', 'machinery', 'subcontract'] },
  { title: 'Materiales e insumos', steps: ['materials'], ids: ['tools', 'supplies', 'materials', 'ppe', 'other'] },
  { title: 'Viajes', steps: ['logistics'], ids: ['travel'] },
]);

/**
 * "¿Qué incluye el servicio?" (PLAN-2026-019): componentes
 * que se suman en cualquier combinación (agrupados por el paso donde se
 * cargan, con link y cuántas líneas tiene) y componentes propios ("Otro").
 */
function componentsComposer({ quote, components, custom, readOnly, ctx, apply }) {
  const selected = new Set(components);
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

  // Componentes propios guardados antes: un nombre libre que se carga como otro costo directo (paso Materiales).
  const customRow = h('div', { class: 'qe-custom-components' },
    custom.length ? h('div', { class: 'variant-suggest-list' }, ...custom.map((name) => h('span', { class: 'qe-custom-chip' }, name,
      readOnly ? null : h('button', { type: 'button', class: 'qe-chip-remove', 'aria-label': `Quitar ${name}`, on: { click: () => apply(components, custom.filter((x) => x !== name), 'cmp-custom') } }, '×')))) : null,
    // Revisión 0.10.0 (U8): ya no se agregan componentes propios (es lo mismo que "Otros costos");
    // una cotización que ya los tiene los sigue viendo, con su ×.
    null);

  return { fieldset: h('fieldset', { class: 'choice-group qe-includes' },
    h('legend', { class: 'field-label' }, '¿Qué incluye el servicio? ', infoTip('Marcá cada categoría de gasto que lleva el servicio, en cualquier combinación: por ejemplo personal con vehículo e insumos (los químicos son insumos). Sin personal, un equipo o vehículo es alquiler sin operador. Cada categoría se costea una sola vez, en el paso que se indica, y se ve con su costo en el Resultado. Si falta algo, marcá "Otros costos" (permisos, seguros, residuos…).')),
    ...groups,
    custom.length ? h('div', { class: 'variant-suggest qe-custom-block' }, h('span', { class: 'variant-suggest-label' }, 'Otro componente'), customRow) : null,
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
      // 0.10.0: el modo sale de la unidad (nunca se vuelve a guardar un modo que no le corresponde).
      const fromMode = contractOf(q).mode;
      const mode = modeForUnit(q.unit || 'day');
      q.contract = contractWithComponents({ mode, templateId: next.templateId || undefined }, next.components, next.customComponents);
      q.serviceType = serviceTypeForContract(q.contract);
      // Modo guardado que no correspondía a la unidad: se corrige con la misma regla que al cambiar la unidad.
      if (fromMode !== mode) unitNotices.push(...applyModeDerivation(q, fromMode, mode));
      // Unidad sugerida por una plantilla: la misma regla que elegirla arriba (limpia con aviso).
      if (nextUnit !== current) unitNotices.push(...applyQuoteUnit(q, nextUnit));
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
    else if (unitNotices.length) messages.push({ text: unitNotices.join(' '), tone: 'warning' });
    return messages;
  }
  const sayAll = (messages) => messages.forEach((m) => ctx.toast(m.text, m.tone));

  const tip = MODE_TIPS[contract.mode];
  const unitCard = card(
    {},
    unitChoiceBlock(ctx),
    h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, unitNextStepText(quote), tip ? ' ' : null, tip ? infoTip(tip.more) : null)),
  );

  const composer = componentsComposer({ quote, components, custom, readOnly: kit.readOnly, ctx, apply: (list, extra = custom, focusId = null) => {
    keepPlace(focusId, () => {
      // Revisión 0.10.0 (U1): una categoría con gastos cargados no se desmarca (seguiría sumando
      // sin verse): queda marcada y se dice dónde borrarlos. Misma regla que applyTemplate.
      const blocked = components.filter((id) => !list.includes(id) && loadedFor(quote, id, list).count > 0);
      if (blocked.length) {
        blocked.forEach((id) => ctx.toast(blockedRemovalText(quote, id, list, ctx.result), 'warning'));
        const kept = SERVICE_COMPONENTS.map((c) => c.id).filter((id) => list.includes(id) || blocked.includes(id));
        if (kept.length === components.length && extra === custom) {
          ctx.rerender();
          return;
        }
        list = kept;
      }
      if (!list.length && !extra.length) {
        ctx.toast('El servicio tiene que incluir algo: dejá al menos un componente.', 'warning');
        ctx.rerender();
        return;
      }
      sayAll(applyContract({ components: list, customComponents: extra, templateId: saved && saved.templateId, touchedComponents: true }));
    });
  } });
  const includes = card({}, composer.fieldset);
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
          : `Se usa para el descuento por continuidad y, si el precio queda fijo, para repartir la inflación (en ${step('margin')}).`,
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
    h('p', { class: 'qe-note' }, 'Si cambian en Recursos, te avisamos.'),
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

  mount(container, identity, unitCard, includes, economicBase, more);
  return { update() {} };
}
