/**
 * Etapa 1 · El servicio — Tipo de servicio.
 * Básico: nombre, cliente y tipo de servicio.
 * Opciones avanzadas: código, estado, duración del contrato y notas.
 */

import { h, mount } from '../../dom.js';
import { card, choiceGroup, dateField, formGrid, icon, confirmDialog } from '../../components.js';
import { SERVICE_TYPES, QUOTE_STATUSES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf, defaultUnitFor, unitFitsServiceType, SERVICE_TYPE_UNITS, BILLING_UNITS } from '../../../domain/billing-units.js';
import { formatNumber, formatPeriod, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';
import { impliesSending, riskSummary, sendCheck } from '../../../domain/quote-risk.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { guardSending } from '../../send-guard.js';

/**
 * Regla de "Enviada" (ECO-02) con la cotización tal como está AHORA en el editor (no con el último
 * resultado bueno: si hoy no se puede calcular, no se puede marcar como enviada).
 */
function currentSendCheck(ctx) {
  try {
    return sendCheck(riskSummary(computeQuote(ctx.quote, { settings: ctx.settings }).completeness));
  } catch {
    return sendCheck(null);
  }
}

/** Nombre de un paso entre comillas ("Viajes"): siempre el de QUOTE_STEPS. */
const step = (id) => `"${stepName(id)}"`;

/** Qué conviene revisar según el tipo de servicio (orientativo, sin normativa). */
const TYPE_TIPS = Object.freeze({
  on_call: `En ${step('modality')} contá cuántos días por mes esperás trabajar (y la disponibilidad 24/7 o por franja). En ${step('margin')} podés definir cuánto cobrar en espera (standby), por llamado (call-out) y el mínimo por llamado.`,
  permanent: `Pensá en POSICIONES CUBIERTAS, no en personas: en ${step('labor')} cargá cuántas personas necesitás por posición para cubrir francos, vacaciones y relevos.`,
  crew: `Cargá cada puesto en ${step('labor')} y los traslados de la cuadrilla en ${step('logistics')}.`,
  equipment_with_operator: `Cargá el equipo en ${step('equipment')} (lo que cuesta tenerlo y usarlo) y el operador en ${step('labor')}.`,
  equipment_only: `Alquiler sin operador: el costo principal está en ${step('equipment')}. No hace falta cargar personal.`,
  per_unit: `En ${step('modality')} elegí la unidad que cobrás (unidad, m³, tonelada, metro… u otra propia) y cargá cuánto facturás por mes y cuánto hacés por día de trabajo: los costos se calculan con los días de trabajo y la tarifa sale por unidad.`,
  transport: `Cargá los vehículos en ${step('equipment')} (tenerlos y usarlos) y los recorridos en ${step('logistics')}. En ${step('modality')} elegí si cobrás por viaje, km, tonelada, ton-km, m³, hora o día.`,
  turnkey: `Revisá todo el alcance: personal, supervisión, materiales menores, HSE, QA/QC, dossier, seguros, garantías e imprevistos. En ${step('modality')} cobrás un precio global por trabajo (o por hito).`,
  time_materials: `Cargá las horas en ${step('labor')}. La tarifa (por hora o por día) cubre la mano de obra y los equipos; en ${step('materials')} podés facturar los materiales aparte, al costo más un recargo.`,
  lump_sum: `Precio cerrado por todo el alcance: usá ${step('risk')} (contingencia) para cubrir la incertidumbre.`,
  configurable: `Armá la estructura a medida con "Otros costos directos" en el paso ${step('materials')}.`,
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
    ? ctx.kit.action(`Usar ${formatPeriod(info.offerPeriod)} (mes de la oferta) en ${missing.length === 1 ? 'el valor' : `los ${formatNumber(missing.length)} valores`} sin base…`, async () => {
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
   * Cambio de tipo de servicio (PLAN-2026-009): la unidad de cobro sigue al
   * tipo ("Por unidad producida" → $/unidad, "Transporte" → $/viaje). Si ya
   * hay una tarifa o un mínimo por llamado cargados, NO se cambia la unidad
   * (el número se leería en otra unidad): se avisa y la persona decide en
   * "Cómo se cobra".
   */
  function changeServiceType(next) {
    if (next === quote.serviceType) return;
    const current = quote.unit || 'day';
    const fits = unitFitsServiceType(next, current);
    const pricing = quote.pricing || {};
    const positive = (v) => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
    const locked = positive(pricing.knownRate) || positive(pricing.offeredRateOverride) || positive(quote.rules && quote.rules.minimumCallUnits);
    const nextUnit = fits || locked ? current : defaultUnitFor(next);
    // Horas y materiales: por defecto, los materiales se facturan aparte (si nunca se decidió).
    const materialsApart = next === 'time_materials' && Boolean(quote.pricing) && quote.pricing.materialsBilledSeparately === undefined && !quote.materialsNotApplicable;
    ctx.mutate((q) => {
      q.serviceType = next;
      q.unit = nextUnit;
      if (materialsApart) q.pricing.materialsBilledSeparately = true;
    });
    const typeLabel = labelOf(SERVICE_TYPES, next, 'Este servicio');
    const materialsNote = materialsApart ? ` Los materiales se facturan aparte, al costo más un recargo (podés cambiarlo en ${step('materials')}).` : '';
    if (nextUnit !== current) {
      ctx.toast(`"${typeLabel}" se cobra ${billingUnitOf({ unit: nextUnit }).label}: podés cambiar la unidad en ${step('modality')}.${materialsNote}`, 'info');
    } else if (materialsNote && fits) {
      ctx.toast(materialsNote.trim(), 'info');
    } else if (!fits) {
      const usual = (SERVICE_TYPE_UNITS[next] || []).map((id) => (BILLING_UNITS.find((u) => u.id === id) || {}).label).filter(Boolean).slice(0, 4).join(', ');
      ctx.toast(`"${typeLabel}" se suele cobrar en ${usual}. Como ya cargaste una tarifa ${billingUnitOf(quote).label}, la unidad no cambió: revisala en ${step('modality')}.`, 'warning');
    }
  }

  const tip = TYPE_TIPS[quote.serviceType];
  const type = card(
    {},
    choiceGroup({
      label: '¿Qué tipo de servicio es?',
      name: 'serviceType',
      value: quote.serviceType,
      disabled: kit.readOnly,
      options: SERVICE_TYPES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
      onChange: (value) => changeServiceType(value),
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
      // ECO-02: pasar a Enviada (o a Ganada sin haber estado enviada) sigue la misma regla que el Resultado y la lista.
      kit.select('status', {
        label: 'Estado',
        options: QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })),
        guard: (next, previous) => (impliesSending(previous, next)
          ? guardSending(currentSendCheck(ctx), { status: next, reviewHref: quote.id ? `#/cotizaciones/${encodeURIComponent(String(quote.id))}/result` : null })
          : true),
      }),
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
