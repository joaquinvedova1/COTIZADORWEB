/**
 * Etapa 2 · Los recursos — Personal.
 * Puestos con convenio parametrizable, posiciones cubiertas y relevos.
 * Básico: rol, convenio, posiciones, personas por posición, sueldo básico y
 * adicionales. Opciones avanzadas (con resumen visible de las cargas
 * aplicadas): horas, extras, recargo, SAC, vacaciones, cargas, ART, vianda,
 * seguros, EPP, capacitación, traslado y categoría.
 * Los parámetros de convenio de la demo son GENÉRICOS e ILUSTRATIVOS.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, confirmDialog, emptyState, badge } from '../../components.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, plural, stepName } from './shared.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS, CONTINUOUS_SERVICE_TYPES } from '../../../domain/catalogs.js';
import { laborLineFromProfile } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { nonNegative, isFiniteNumber } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';
import { baseFields, lineOriginBlock, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';

/** Parámetros que se copian de un convenio a la línea. */
export const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);

const RELIEF_HINT = 'Para cubrir 24/7 normalmente se necesita más de una persona por posición (francos, vacaciones, relevos).';

function laborTrace(result, index, source) {
  const line = result && result.model.labor.lines[index];
  if (!line) return null;
  const p = line.perPerson;
  const src = source || {};
  return createTrace({
    id: 'labor_line',
    title: `Personal — ${line.role || 'Puesto'}`,
    formula: 'Costo por persona = (Básico + Adicionales) × (1 + SAC% + Vacaciones%) × (1 + Cargas% + ART%) + Seguros + EPP + Capacitación + Traslado · Fijo total = costo por persona × posiciones × personas por posición · Variable por día activo = (horas extra × valor hora extra × factor de cargas + vianda) × posiciones',
    inputs: [
      { label: 'Básico mensual', value: p.basic, format: 'money' },
      { label: 'Adicionales mensuales', value: p.additionals, format: 'money' },
      { label: 'SAC', value: nonNegative(src.sacPct), format: 'percent' },
      { label: 'Vacaciones', value: nonNegative(src.vacationPct), format: 'percent' },
      { label: 'Cargas patronales', value: nonNegative(src.employerContributionsPct), format: 'percent' },
      { label: 'ART', value: nonNegative(src.artPct), format: 'percent' },
      { label: 'Posiciones a cubrir', value: line.positions, format: 'number' },
      { label: 'Personas por posición (relevos)', value: line.peoplePerPosition, format: 'number' },
      { label: 'Horas normales por mes', value: nonNegative(src.normalHoursPerMonth), format: 'hours' },
      { label: 'Horas extra por día activo', value: nonNegative(src.overtimeHoursPerActiveDay), format: 'hours' },
      { label: 'Recargo de horas extra', value: nonNegative(src.overtimePremiumPct), format: 'percent' },
      { label: 'Vianda por día activo', value: line.perPosition.mealPerActiveDay, format: 'money' },
    ],
    steps: [
      { label: 'Factor de cargas', value: p.loadFactor, format: 'number' },
      { label: 'Remunerativo con cargas', value: p.loadedRemunerative, format: 'money' },
      { label: 'Seguros + EPP + capacitación + traslado', value: p.nonRemunerative, format: 'money' },
      { label: 'Costo mensual por persona', value: p.fixedMonthly, format: 'money' },
      { label: 'Dotación (personas)', value: line.headcount, format: 'number' },
      { label: 'Valor hora extra (sin cargas)', value: p.overtimeHourly, format: 'rate' },
      { label: 'Variable por día activo (todas las posiciones)', value: line.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Fijo mensual total del puesto', value: line.fixedMonthly, format: 'money' },
    notes: ['Los porcentajes de convenio son parámetros que cargás vos: los de la demostración son ILUSTRATIVOS, no valores de ningún CCT.'],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const agreements = Array.isArray(resources.agreements) ? resources.agreements : [];
  const profiles = Array.isArray(resources.laborProfiles) ? resources.laborProfiles : [];
  const lines = quote.labor;
  const continuous = CONTINUOUS_SERVICE_TYPES.includes(quote.serviceType) && (quote.serviceType === 'permanent' || (quote.activity && quote.activity.availability === '24/7'));
  const reliefHint = continuous ? `${RELIEF_HINT} Este servicio requiere cobertura continua.` : RELIEF_HINT;
  const agreementOptions = agreements.map((a) => ({ value: a.id, label: a.illustrative ? `${a.name} (ilustrativo)` : a.name }));
  const agreementOf = (line) => agreements.find((a) => a.id === line.agreementId) || null;

  /** ¿Mostrar la etiqueta ILUSTRATIVO en un parámetro de convenio? */
  const illustrativeParam = (line, key) => {
    const agreement = agreementOf(line);
    return Boolean(quote.illustrative) || line.illustrative === true || Boolean(agreement && agreement.illustrative) || line[key] === ILLUSTRATIVE_AGREEMENT_PARAMS[key];
  };

  // ------------------------------------------------------------ acciones
  let selectedProfileId = null;
  const addFromLibrary = () => {
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) {
      ctx.toast('Elegí un perfil de la biblioteca para agregarlo.', 'warning');
      return;
    }
    const agreement = agreements.find((a) => a.id === profile.agreementId) || null;
    const line = laborLineFromProfile(profile, agreement, { now: new Date().toISOString(), currency: quoteCurrencyOf(quote) });
    const index = lines.length;
    ctx.mutate((q) => q.labor.push(line), { focus: `labor.${index}.positions` });
    ctx.toast(`Se agregó "${line.role}" desde tus recursos con sus valores de hoy. Si después cambian en Recursos, esta cotización no cambia sola.`, 'success');
  };
  const addBlank = () => {
    const line = laborLineFromProfile({}, null, { currency: quoteCurrencyOf(quote) });
    const index = lines.length;
    ctx.mutate((q) => q.labor.push(line), { focus: `labor.${index}.role` });
  };
  const applyAgreement = (index) => {
    const line = quote.labor[index];
    const agreement = line ? agreementOf(line) : null;
    if (!agreement) {
      ctx.toast('Elegí primero el convenio del puesto.', 'warning');
      return;
    }
    const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(agreement.params || {}) };
    ctx.mutate((q) => {
      AGREEMENT_PARAM_KEYS.forEach((key) => {
        if (isFiniteNumber(params[key])) q.labor[index][key] = params[key];
      });
    });
    ctx.toast(`Se aplicaron los parámetros de "${agreement.name}"${agreement.illustrative ? ' (ILUSTRATIVOS)' : ''}.`, 'success');
  };
  const removeLine = async (index) => {
    const line = quote.labor[index];
    if (!line) return;
    const ok = await confirmDialog({
      title: 'Quitar puesto',
      message: `¿Quitar "${line.role || 'Puesto'}" de esta cotización? Esto no modifica la biblioteca.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (ok) ctx.mutate((q) => q.labor.splice(index, 1));
  };

  const toolbar = h(
    'div',
    { class: 'qe-toolbar' },
    h(
      'div',
      { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Agregar desde tus recursos de personal',
        value: null,
        includeEmpty: true,
        emptyLabel: profiles.length ? 'Elegí un perfil…' : 'Todavía no cargaste perfiles',
        options: profiles.map((p) => ({ value: p.id, label: `${p.role}${p.category ? ` — ${p.category}` : ''}` })),
        onChange: (v) => {
          selectedProfileId = v;
        },
      }),
      kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Agregar puesto en blanco', addBlank, { icon: 'plus', size: 'md' }),
  );

  /** "SAC 8,33 % · vacaciones 4 % · …" con lo cargado en la línea. */
  const loadsText = (line) => [
    ['SAC', line.sacPct],
    ['vacaciones', line.vacationPct],
    ['contribuciones', line.employerContributionsPct],
    ['ART', line.artPct],
  ].map(([label, v]) => `${label} ${hasNumber(v) ? formatPercent(Number(v)) : 'sin cargar'}`).join(' · ');

  // -------------------------------------------------------------- líneas
  const lineCards = lines.map((line, i) => {
    const p = `labor.${i}`;
    const at = (r) => r.model.labor.lines[i];
    const agreement = agreementOf(line);
    // Valores copiados de una plantilla o perfil de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este puesto' });
    const illustrative = ill.marked;
    const anyIllustrativeParam = AGREEMENT_PARAM_KEYS.some((key) => illustrativeParam(line, key));
    return kit.lineCard(
      {
        title: kit.out(() => (quote.labor[i] && quote.labor[i].role) || 'Puesto sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l
            ? `${formatNumber(l.positions, { decimals: 2 })} ${plural(l.positions, 'posición', 'posiciones')} × ${formatNumber(l.peoplePerPosition, { decimals: 2 })} ${plural(l.peoplePerPosition, 'persona', 'personas')} = ${formatNumber(l.headcount, { decimals: 2 })} ${plural(l.headcount, 'persona', 'personas')}`
            : '';
        }),
        badges: [ill.tag, agreement && agreement.illustrative ? badge('Convenio ilustrativo', 'orange') : null].filter(Boolean),
        actions: [
          kit.action('Aplicar parámetros del convenio', () => applyAgreement(i), { icon: 'check', title: 'Copia horas normales, recargo de horas extra, SAC, vacaciones, cargas y ART del convenio elegido' }),
          kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' }),
        ],
      },
      lineOriginBlock(ctx, 'labor', i, [{ prefix: 'Base', base: line.base }]),
      resourceSyncNotice(ctx, 'labor', i, { name: line.role || 'Puesto' }),
      ill.control,
      formGrid(
        3,
        kit.text(`${p}.role`, { label: 'Rol', maxLength: 120, placeholder: 'Ej.: Operador' }),
        kit.select(`${p}.agreementId`, { label: 'Convenio', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio' }),
        kit.num(`${p}.positions`, { label: 'Posiciones a cubrir', rule: 'quantity', hint: 'Puestos que tienen que estar cubiertos a la vez.' }),
        // Mayor a 0: con 0 personas el puesto no tendría costo (QA-E2E-12).
        kit.num(`${p}.peoplePerPosition`, { label: 'Personas por posición (relevos)', rule: 'positive', hint: reliefHint }),
        kit.num(`${p}.basicMonthly`, { label: 'Sueldo básico', rule: 'money', unit: '$/mes', illustrative }),
        kit.num(`${p}.additionalsMonthly`, { label: 'Adicionales', rule: 'money', unit: '$/mes', illustrative, hint: 'Zona, diagrama, nocturnidad, etc.' }),
      ),
      kit.keyline({
        label: 'Costo del puesto',
        value: (r) => (at(r) ? `${formatMoney(at(r).fixedMonthly)} por mes` : EMPTY),
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          const variable = l.variablePerActiveDay > 0 ? ` + ${formatMoney(l.variablePerActiveDay)} por día activo (horas extra y vianda)` : '';
          return `${formatMoney(l.perPerson.fixedMonthly)} por persona con cargas${variable}.`;
        },
        trace: (r) => laborTrace(r, i, quote.labor[i]),
      }),
      kit.advanced(
        {
          key: `labor:${line.id || i}`,
          summary: (r) => {
            const current = quote.labor[i] || {};
            const l = at(r);
            const factor = l ? ` → factor × ${formatNumber(l.perPerson.loadFactor, { decimals: 4 })}` : '';
            const extras = [
              hasNumber(current.overtimeHoursPerActiveDay) && Number(current.overtimeHoursPerActiveDay) > 0 ? `${formatNumber(Number(current.overtimeHoursPerActiveDay), { decimals: 2 })} h extra por día` : 'sin horas extra',
              hasNumber(current.mealPerActiveDay) && Number(current.mealPerActiveDay) > 0 ? `vianda ${formatMoney(Number(current.mealPerActiveDay))}/día` : null,
              l && l.perPerson.nonRemunerative > 0 ? `seguros, EPP, capacitación y traslado ${formatMoney(l.perPerson.nonRemunerative)}/mes` : null,
            ].filter(Boolean).join(' · ');
            return h(
              'span',
              {},
              h('span', { class: 'qe-adv-line' }, `Cargas aplicadas: ${loadsText(current)}${factor}.`, anyIllustrativeParam ? illustrativeTag('Parámetros de convenio GENÉRICOS e ILUSTRATIVOS: cargá los vigentes de tu convenio') : null),
              h('span', { class: 'qe-adv-line' }, `${extras.charAt(0).toUpperCase()}${extras.slice(1)}.`),
            );
          },
        },
        anyIllustrativeParam
          ? h('p', { class: 'qe-note' }, 'Los parámetros de convenio (horas, recargo de horas extra, SAC, vacaciones, cargas patronales y ART) son GENÉRICOS e ILUSTRATIVOS: no son valores de ningún CCT. Cargá los vigentes de tu convenio o tocá "Aplicar parámetros del convenio".')
          : null,
        kit.group(
          'Cargas sobre el sueldo',
          formGrid(
            4,
            kit.num(`${p}.sacPct`, { label: 'SAC (aguinaldo)', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'sacPct') }),
            kit.num(`${p}.vacationPct`, { label: 'Vacaciones', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'vacationPct') }),
            kit.num(`${p}.employerContributionsPct`, { label: 'Cargas patronales', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'employerContributionsPct') }),
            kit.num(`${p}.artPct`, { label: 'ART', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'artPct') }),
          ),
        ),
        kit.group(
          'Horas',
          formGrid(
            3,
            kit.num(`${p}.normalHoursPerMonth`, { label: 'Horas normales por mes', rule: 'hours', unit: 'h/mes', illustrative: illustrativeParam(line, 'normalHoursPerMonth') }),
            kit.num(`${p}.overtimeHoursPerActiveDay`, { label: 'Horas extra por día activo', rule: 'hoursPerDay', unit: 'h/día', illustrative }),
            kit.num(`${p}.overtimePremiumPct`, { label: 'Recargo de horas extra', rule: 'percentOpen', unit: '%', illustrative: illustrativeParam(line, 'overtimePremiumPct') }),
          ),
        ),
        kit.group(
          'Otros costos por persona',
          formGrid(
            3,
            kit.num(`${p}.mealPerActiveDay`, { label: 'Vianda por día activo', rule: 'money', unit: '$/día', illustrative }),
            kit.num(`${p}.insuranceMonthly`, { label: 'Seguros', rule: 'money', unit: '$/mes', illustrative }),
            kit.num(`${p}.ppeMonthly`, { label: 'EPP (ropa y elementos de protección)', rule: 'money', unit: '$/mes', illustrative }),
            kit.num(`${p}.trainingMonthly`, { label: 'Capacitación', rule: 'money', unit: '$/mes', illustrative }),
            kit.num(`${p}.transferMonthly`, { label: 'Traslado', rule: 'money', unit: '$/mes', illustrative }),
            kit.text(`${p}.category`, { label: 'Categoría', maxLength: 120, hint: 'Sólo informativa (no cambia el costo).' }),
          ),
        ),
        kit.group(
          'Detalle del costo',
          kit.stats(
            kit.stat('Costo mensual por persona', (r) => formatMoney(at(r) && at(r).perPerson.fixedMonthly)),
            kit.stat('Dotación (personas)', (r) => formatNumber(at(r) && at(r).headcount, { decimals: 2 })),
            kit.stat('Fijo mensual total', (r) => formatMoney(at(r) && at(r).fixedMonthly), { emphasis: true }),
            kit.stat('Variable por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: 'Horas extra con cargas + vianda.' }),
            kit.stat('Costo hora cargado', (r) => formatMoney(at(r) && at(r).perPerson.loadedHourlyCost), { hint: 'Costo por persona ÷ horas normales.' }),
            kit.stat('Factor de cargas', (r) => {
              const l = at(r);
              return l ? `× ${formatNumber(l.perPerson.loadFactor, { decimals: 4 })}` : EMPTY;
            }, { hint: '(1 + SAC + vac.) × (1 + cargas + ART)' }),
          ),
        ),
      ),
      kit.advanced(
        {
          key: `labor-base:${line.id || i}`,
          title: 'Fecha base',
          summary: () => baseText(quote.labor[i] && quote.labor[i].base),
        },
        h('p', { class: 'small' }, 'De qué mes son el sueldo y los adicionales (por ejemplo, la escala de un convenio). Cambiarlo acá sólo afecta esta cotización.'),
        baseFields(ctx, `${p}.base`, { periodLabel: 'Mes del sueldo (escala)' }),
      ),
    );
  });

  // -------------------------------------------------------------- totales
  // Se muestra siempre que la mano de obra pese en la estructura de costos,
  // aunque no haya puestos: puede venir de "Otros costos" con categoría Mano
  // de obra (REG-3).
  const laborRow = (r) => r.eecc.rows.find((x) => x.category === 'labor') || null;
  const totals = kit.toggle(
    kit.keyline({
      label: lines.length ? 'Personal en el costo del mes' : 'Mano de obra en la estructura de costos',
      value: (r) => {
        const row = laborRow(r);
        if (!row) return EMPTY;
        // Sin puestos: "$ X · Y %" (monto e incidencia en la estructura de costos).
        return lines.length ? formatMoney(row.amount) : `${formatMoney(row.amount)} · ${formatPercent(row.displayPct)}`;
      },
      hint: (r) => {
        const row = laborRow(r);
        if (!lines.length) return `Viene de otros costos con categoría Mano de obra (se cargan en "${stepName('materials')}").`;
        const standby = r.model.standby.monthly > 0 ? ` Incluye el personal en espera (standby): ${formatMoney(r.model.standby.monthly)} por mes.` : '';
        const headcount = r.model.labor.headcount;
        const positions = r.model.labor.positions;
        const parts = [
          row ? `${formatPercent(row.displayPct)} del costo total` : null,
          `${formatNumber(headcount, { decimals: 2 })} ${plural(headcount, 'persona', 'personas')} en ${formatNumber(positions, { decimals: 2 })} ${plural(positions, 'posición', 'posiciones')}`,
          `fijo ${formatMoney(r.model.labor.fixedMonthly)} + ${formatMoney(r.model.labor.variablePerActiveDay)} por día activo`,
        ].filter(Boolean);
        return `${parts.join(' · ')}.${standby}`;
      },
      className: 'qe-keyline-total',
    }),
    (r) => lines.length > 0 || Boolean(laborRow(r) && laborRow(r).amount > 0),
  );

  mount(
    container,
    card({ title: 'Puestos', subtitle: 'Pensá en posiciones cubiertas: cada posición puede necesitar más de una persona.' }, toolbar),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : emptyState({
        title: 'Todavía no cargaste personal.',
        text: 'Agregá un perfil desde tus recursos o un puesto en blanco. Si el servicio no lleva personal propio, seguí al próximo paso.',
        icon: 'resources',
      }),
    totals,
  );
  return { update() {} };
}
