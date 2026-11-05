/**
 * Etapa 1 · El contrato (PLAN-2026-018).
 * Básico: nombre, cliente, cómo paga el cliente (fijo mensual / por servicio
 * prestado / precio cerrado) y qué incluye (personal / equipo con operador /
 * equipo sin operador).
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { card, choiceGroup, dateField, formGrid, icon, confirmDialog } from '../../components.js';
import { QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf, BILLING_UNITS } from '../../../domain/billing-units.js';
import { CONTRACT_MODES, CONTRACT_RESOURCES, contractOf, contractUnits, defaultUnitForContract, resourceChoiceOf, serviceTypeForContract, unitFitsContract } from '../../../domain/contract.js';
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
  monthly: `En ${step('modality')} cargá lo que cubre el fijo (por ejemplo 26 días × 12 h). Lo que se trabaje fuera de eso (fuera de horario, feriados, trabajos extra) va en "Adicionales", con su propio precio, en la misma cotización.`,
  on_demand: `En ${step('modality')} elegí en qué unidad cobrás (hora, día, viaje, m³…) y cuánto esperás trabajar por mes. Si el cliente garantiza un mínimo mensual, se carga ahí mismo.`,
  closed: `Cargá todo el alcance (personal, equipos, materiales, HSE, seguros) y usá ${step('risk')} para cubrir la incertidumbre. Si hay trabajos fuera del alcance con precio unitario, van en "Adicionales".`,
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
  function applyContract(next) {
    const current = quote.unit || 'day';
    const fits = unitFitsContract(next, current);
    const pricing = quote.pricing || {};
    const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
    const locked = positive(pricing.knownRate) || positive(pricing.offeredRateOverride) || positive(quote.rules && quote.rules.minimumCallUnits);
    const nextUnit = fits || locked ? current : defaultUnitForContract(next);
    ctx.mutate((q) => {
      q.contract = { mode: next.mode, labor: next.labor, equipment: next.equipment };
      q.serviceType = serviceTypeForContract(next);
      q.unit = nextUnit;
    });
    if (nextUnit !== current) {
      ctx.toast(`Se cobra ${billingUnitOf({ unit: nextUnit }).label}: podés cambiarlo en ${step('modality')}.`, 'info');
    } else if (!fits) {
      const usual = contractUnits(next).map((id) => (BILLING_UNITS.find((u) => u.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
      ctx.toast(`Esta modalidad se cobra en ${usual}. Como ya cargaste una tarifa ${billingUnitOf(quote).label}, la unidad no cambió: revisala en ${step('modality')}.`, 'warning');
    }
  }

  const tip = MODE_TIPS[contract.mode];
  const type = card(
    {},
    choiceGroup({
      label: '¿Cómo te paga el cliente?',
      name: 'contractMode',
      value: contract.mode,
      disabled: kit.readOnly,
      options: CONTRACT_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
      onChange: (mode) => applyContract({ ...contract, mode }),
    }),
    choiceGroup({
      label: '¿Qué incluye?',
      name: 'contractResources',
      value: resourceChoiceOf(contract),
      disabled: kit.readOnly,
      options: CONTRACT_RESOURCES.map((r) => ({ value: r.id, label: r.label, hint: r.hint })),
      onChange: (id) => {
        const r = CONTRACT_RESOURCES.find((x) => x.id === id);
        if (r) applyContract({ ...contract, labor: r.labor, equipment: r.equipment });
      },
    }),
    tip ? h('div', { class: 'qe-tip' }, icon('info'), h('p', {}, tip)) : null,
  );

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

  mount(container, identity, type, economicBase, more);
  return { update() {} };
}
