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
import { card, dateField, formGrid, confirmDialog, infoTip } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { INCLUDE_BLOCKS, SERVICE_COMPONENTS, blockOfComponent, blocksOf, componentsOf, contractOf, contractUsesMaterials, contractWithComponents, modeForUnit, serviceTypeForContract, withBlock } from '../../../domain/contract.js';
import { isPlainObject } from '../../../core/object.js';
import { formatMoney, formatNumber, formatPeriod, formatDayDate, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { applyModeDerivation, applyQuoteUnit, unitChoiceBlock } from './unit-choice.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';
import { render as renderCharge } from './modality.js';

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

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
 * Gastos cargados de un componente de "¿Qué incluye el servicio?", contados POR BLOQUE
 * (PLAN-2026-027): Insumos y materiales, todas sus líneas y los gastos cargados antes; Personal,
 * sus puestos; Equipos y vehículos, las líneas de Equipos. Un bloque sólo "tiene" gastos si
 * ninguno de sus componentes queda marcado en `next` (si queda uno, el bloque sigue elegido).
 * @returns {{ count: number, step: string|null, one: string, many: string }}
 */
export function loadedFor(quote, id, next = []) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => isPlainObject(x)) : []);
  const block = blockOfComponent(id);
  if (!block) return { count: 0, step: null, one: '', many: '' };
  const stillChosen = next.some((x) => block.ids.includes(x));
  if (block.id === 'materials') {
    const mats = quote.materialsNotApplicable ? [] : list(quote.materials);
    return { count: stillChosen ? 0 : mats.length + list(quote.otherCosts).length, step: 'materials', one: 'gasto cargado', many: 'gastos cargados' };
  }
  if (block.id === 'labor') return { count: stillChosen ? 0 : list(quote.labor).length + list(quote.contractedStaff).length, step: 'labor', one: 'puesto cargado', many: 'puestos cargados' };
  if (block.id === 'equipment') return { count: stillChosen ? 0 : list(quote.equipment).length, step: 'equipment', one: 'equipo cargado', many: 'equipos cargados' };
  return { count: 0, step: null, one: '', many: '' };
}

/** "Insumos y materiales tiene 1 gasto cargado ($ 45.000 por mes): borralo en «Insumos y materiales» para desmarcarlo." */
export function blockedRemovalText(quote, id, next = [], result = null) {
  const block = blockOfComponent(id) || {};
  const l = loadedFor(quote, id, next);
  const n = l.count;
  let amount = null;
  try {
    const jobs = result && result.componentCosts ? result.componentCosts.jobsPerMonth : null;
    const say = (total) => (total > 0.005 ? (jobs ? `${formatMoney(total / jobs)} en el trabajo` : `${formatMoney(total)} por mes`) : null);
    if (result && block.id === 'materials' && result.componentCosts) {
      amount = say(Object.values(result.componentCosts.byComponent || {}).reduce((acc, part) => acc + (part && Number.isFinite(part.amount) ? part.amount : 0), 0));
    } else if (result && block.id === 'labor' && result.eecc) {
      const row = result.eecc.rows.find((r) => r.category === 'labor');
      amount = row ? say(row.amount) : null;
    }
  } catch {
    amount = null;
  }
  const what = `${formatNumber(n)} ${n === 1 ? l.one : l.many}${amount ? ` (${amount})` : ''}`;
  return `${block.label || id} tiene ${what}: ${n === 1 ? 'borralo' : 'borralos'} en «${stepName(l.step)}» para desmarcarlo.`;
}

/**
 * "¿Qué incluye el servicio?" en 4 casillas (PLAN-2026-027, decisión D4): Personal, Equipos y
 * vehículos, Insumos y materiales y Viajes, cada una con el paso donde se carga y cuántas líneas
 * tiene. En disco se siguen guardando los componentes de siempre (withBlock); los componentes
 * propios guardados antes se ven con su ×.
 */
function componentsComposer({ quote, components, custom, readOnly, ctx, apply }) {
  const chosenBlocks = new Set(blocksOf({ components }));
  const loadedText = (stepId) => {
    const n = loadedIn(quote, stepId);
    return h('span', { class: 'qe-components-step' },
      h('a', { href: ctx.href(stepId) }, stepName(stepId)),
      h('span', { class: ['qe-components-count', n ? 'is-loaded' : 'is-empty'] }, n ? ` · ${formatNumber(n)} ${n === 1 ? 'cargado' : 'cargados'}` : ' · sin cargar'));
  };
  const toggle = (block) => {
    const id = `cmp-${block.id}`;
    const on = chosenBlocks.has(block.id) || (block.id === 'materials' && custom.length > 0);
    const input = h('input', { type: 'checkbox', id, name: 'contractComponents', value: block.id, checked: on, disabled: readOnly });
    input.addEventListener('change', () => apply(withBlock(components, block.id, input.checked), custom, id));
    return h('label', { class: 'choice qe-include-block', for: id, title: block.hint },
      input,
      h('span', { class: 'choice-body' },
        h('span', { class: 'choice-title' }, block.label),
        h('span', { class: 'choice-hint' }, block.hint),
        on ? h('span', { class: 'choice-hint qe-component-group-where small' }, 'Se carga en ', loadedText(block.step)) : null));
  };

  // Componentes propios guardados antes: un nombre libre que se carga en "Insumos y materiales".
  const customRow = h('div', { class: 'qe-custom-components' },
    custom.length ? h('div', { class: 'variant-suggest-list' }, ...custom.map((name) => h('span', { class: 'qe-custom-chip' }, name,
      readOnly ? null : h('button', { type: 'button', class: 'qe-chip-remove', 'aria-label': `Quitar ${name}`, on: { click: () => apply(components, custom.filter((x) => x !== name), 'cmp-custom') } }, '×')))) : null);

  return { fieldset: h('fieldset', { class: 'choice-group qe-includes' },
    h('legend', { class: 'field-label' }, '¿Qué incluye el servicio? ', infoTip('Marcá lo que lleva el servicio, en cualquier combinación: por ejemplo personal con una camioneta e insumos. Sin personal, un equipo o vehículo es alquiler sin operador. Cada cosa se costea una sola vez, en el paso que se indica, y se ve con su costo en el Resultado. Permisos, seguros del trabajo o residuos van en Insumos y materiales, con el tipo "Otro gasto".')),
    h('div', { class: 'choice-grid qe-components qe-include-blocks' }, ...INCLUDE_BLOCKS.map(toggle)),
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

  const unitCard = card(
    {},
    unitChoiceBlock(ctx),
  );
  // 0.20.0: el ritmo se pregunta acá, apenas se elige la unidad (antes, después de los recursos).
  const rhythm = h('div', { class: 'qe-rhythm' });
  renderCharge(rhythm, { ...ctx, part: 'rhythm' });

  const composer = componentsComposer({ quote, components, custom, readOnly: kit.readOnly, ctx, apply: (list, extra = custom, focusId = null) => {
    keepPlace(focusId, () => {
      // Revisión 0.10.0 (U1): una categoría con gastos cargados no se desmarca (seguiría sumando
      // sin verse): queda marcada y se dice dónde borrarlos. Misma regla que applyTemplate.
      const blocked = components.filter((id) => !list.includes(id) && loadedFor(quote, id, list).count > 0);
      if (blocked.length) {
        // Un aviso por bloque (PLAN-2026-027: los componentes de un bloque se desmarcan juntos).
        const seen = new Set();
        blocked.forEach((id) => {
          const key = (blockOfComponent(id) || { id }).id;
          if (seen.has(key)) return;
          seen.add(key);
          ctx.toast(blockedRemovalText(quote, id, list, ctx.result), 'warning');
        });
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

  mount(container, identity, unitCard, rhythm, includes, economicBase, more);
  return { update() {} };
}
