/**
 * Etapa 1 · El servicio — Qué cotizás (UXR).
 * Básico: nombre, cliente, cómo le cobrás al cliente (unidad de cobro, sin "tipo de servicio": la elección
 * de 11 tipos excluyentes se quitó porque no cambiaba ninguna cifra y encerraba las unidades) y si ya tenés
 * una tarifa. Opciones avanzadas: código, estado, duración del contrato y notas.
 * La actividad (cuánto vas a hacer, llamados, salidas) va en el paso siguiente.
 */

import { h, mount } from '../../dom.js';
import { card, dateField, formGrid, confirmDialog, addInfoTip, textField } from '../../components.js';
import { QUOTE_STATUSES, PRICING_MODES, labelOf } from '../../../domain/catalogs.js';
import { billingUnitOf, cleanUnitName } from '../../../domain/billing-units.js';
import { formatNumber, formatPeriod, EMPTY } from '../../../core/format.js';
import { assignOfferBase } from '../../../domain/economic-base.js';
import { isFiniteNumber } from '../../../core/money.js';
import { stepName } from './shared.js';
import { economicBaseSummary } from '../../economic-base-ui.js';
import { exchangeRatesEditor, quoteCurrencyOf } from './resource-line.js';
import { impliesSending, riskSummary, sendCheck } from '../../../domain/quote-risk.js';
import { computeQuote } from '../../../engines/quote-engine.js';
import { guardSending } from '../../send-guard.js';
import { unitPicker } from './unit-picker.js';
import { changeUnitTo } from './unit-change.js';

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

  // ---- Cómo le cobrás (UXR): la unidad no depende de ningún tipo; al cambiarla con datos cargados se
  // convierten o se borran (unit-change.js), nunca se leen en otra unidad.
  const info = billingUnitOf(quote);
  const currency = quoteCurrencyOf(quote);
  const jobHorizon = quote.unit === 'job' && quote.billingHorizon === 'job';
  const picker = unitPicker({ quote, currency, readOnly: kit.readOnly, onSelect: (apply) => changeUnitTo(ctx, apply) });

  // Nombre de la unidad propia ("válvula", "camión reparado"): al salir del campo se redibujan los rótulos.
  let unitNameField = null;
  if (info.custom) {
    // Renombrar la unidad propia es cambiar de unidad: con datos cargados pregunta como el buscador (SIM-02:
    // 60 válvulas no pasan a ser 60 juntas sin avisar). Se guarda al salir del campo, no con cada letra.
    unitNameField = textField({
      label: '¿Cómo se llama tu unidad?',
      name: 'unitName',
      value: quote.unitName || '',
      maxLength: 30,
      placeholder: 'Ej.: válvula, camión reparado, tráiler',
      hint: `En singular: vas a cobrar "${currency} por ${info.singular || 'válvula'}".`,
      disabled: ctx.readOnly,
    });
    const input = unitNameField.querySelector('input');
    if (input) {
      input.addEventListener('change', async () => {
        const clean = cleanUnitName(input.value);
        if (!clean) {
          input.value = quote.unitName || '';
          return;
        }
        const changed = await changeUnitTo(ctx, { unit: 'custom', unitName: clean });
        if (!changed) input.value = quote.unitName || '';
      });
    }
  }

  const per = jobHorizon ? 'el precio total del trabajo' : `una tarifa por ${info.singular || 'unidad'}`;
  const modeOptions = PRICING_MODES.map((m) => (m.id === 'known_rate'
    ? { value: m.id, label: jobHorizon ? 'Sí, ya tengo el precio' : 'Sí, ya tengo la tarifa', hint: jobHorizon ? 'RATEOS calcula cuánto ganás con ese precio.' : 'RATEOS calcula cuánto tenés que facturar para no perder y cuánto ganás.' }
    : { value: m.id, label: jobHorizon ? 'No, calculá el precio' : 'No, calculá cuánto cobrar', hint: 'RATEOS calcula la tarifa piso y la tarifa con tu margen.' }));
  const rateLabel = info.legacy ? info.label : `$/${info.singular || 'unidad'}`;
  const rateSuffix = info.legacy ? info.label.replace(/\s*\(.*\)$/, '') : `$/${info.short || info.singular || 'u.'}`;
  const knownRateField = quote.pricingMode === 'known_rate'
    ? addInfoTip(kit.num('pricing.knownRate', {
      label: jobHorizon ? 'Tu precio total del trabajo (sin IVA)' : `Tu tarifa (${rateLabel}, sin IVA)`,
      rule: 'money',
      unit: jobHorizon ? '$' : rateSuffix,
      requiredMark: true,
      hint: 'De lista, sin IVA, antes de descuentos.',
    }), `Los descuentos y otros cargos (espera, movilización, abono de disponibilidad) se cargan en "${stepName('margin')}".`)
    : null;

  const charge = card(
    { className: 'qe-charge-card' },
    picker,
    unitNameField ? formGrid(2, unitNameField) : null,
    kit.choice('pricingMode', {
      label: `¿Ya tenés ${per}?`,
      options: modeOptions,
      structural: true,
    }),
    knownRateField ? formGrid(2, knownRateField) : null,
  );

  const more = kit.advanced(
    {
      key: 'service',
      title: 'Más datos de la cotización',
      boxed: true,
      summary: () => {
        const parts = [
          `Estado: ${labelOf(QUOTE_STATUSES, quote.status, 'sin estado').toLowerCase()}`,
          quote.code ? `código ${quote.code}` : null,
          String(quote.notes || '').trim() ? 'con notas' : null,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : EMPTY;
      },
    },
    formGrid(
      2,
      kit.staticField('Código', quote.code, 'Se asigna automáticamente y no se puede cambiar.'),
      // ECO-02: pasar a Enviada (o a Ganada sin haber estado enviada) sigue la misma regla que el Resultado y la lista.
      kit.select('status', {
        label: 'Estado',
        options: QUOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })),
        guard: (next, previous) => (impliesSending(previous, next)
          ? guardSending(currentSendCheck(ctx), { status: next, reviewHref: quote.id ? `#/cotizaciones/${encodeURIComponent(String(quote.id))}/result` : null })
          : true),
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
  // UXR: secundaria en este paso (no cambia cómo se cobra): plegada, con un resumen a la vista. Se abre sola
  // si hay un aviso (valores sin fecha base o viejos).
  const economicBase = kit.advanced(
    {
      key: 'service-base',
      title: 'Fecha de la oferta, base económica y tipos de cambio',
      boxed: true,
      summary: (r) => {
        const info = r && r.economicBase;
        const date = quote.offerDate ? `Oferta del ${String(quote.offerDate).split('-').reverse().join('/')}` : 'Sin fecha de la oferta';
        const pending = info ? (info.undefinedEntries || []).length + (info.stale || []).length : 0;
        return pending ? `${date} · ${pending === 1 ? 'un valor para revisar' : `${formatNumber(pending)} valores para revisar`}` : `${date} · moneda ${quoteCurrencyOf(quote)}`;
      },
      flag: (r) => {
        const info = r && r.economicBase;
        const pending = info ? (info.undefinedEntries || []).length + (info.stale || []).length : 0;
        return pending ? { tone: 'orange', text: 'Revisar' } : null;
      },
    },
    h('p', { class: 'qe-note' }, `De qué mes son los valores con los que calculás esta oferta. La cotización guarda sus valores: si después cambian en Recursos, te avisa y vos decidís si actualizarlos. Moneda: ${quoteCurrencyOf(quote)}.`),
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

  mount(container, identity, charge, economicBase, more);
  return { update() {} };
}
