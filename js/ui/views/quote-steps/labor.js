/**
 * Paso 3 — Personal.
 * Puestos con convenio parametrizable, posiciones cubiertas y relevos.
 * Los parámetros de convenio de la demo son GENÉRICOS e ILUSTRATIVOS.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, banner, selectField, confirmDialog, emptyState, badge } from '../../components.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS, CONTINUOUS_SERVICE_TYPES } from '../../../domain/catalogs.js';
import { laborLineFromProfile } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { nonNegative, isFiniteNumber } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';

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
    const line = laborLineFromProfile(profile, agreement);
    const index = lines.length;
    ctx.mutate((q) => q.labor.push(line), { focus: `labor.${index}.positions` });
    ctx.toast(`Se agregó "${line.role}" desde la biblioteca.`, 'success');
  };
  const addBlank = () => {
    const line = laborLineFromProfile({}, null);
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
        label: 'Agregar desde la biblioteca de personal',
        value: null,
        includeEmpty: true,
        emptyLabel: profiles.length ? 'Elegí un perfil…' : 'La biblioteca está vacía',
        options: profiles.map((p) => ({ value: p.id, label: `${p.role}${p.category ? ` — ${p.category}` : ''}` })),
        onChange: (v) => {
          selectedProfileId = v;
        },
      }),
      kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Agregar puesto en blanco', addBlank, { icon: 'plus', size: 'md' }),
  );

  // -------------------------------------------------------------- líneas
  const lineCards = lines.map((line, i) => {
    const p = `labor.${i}`;
    const agreement = agreementOf(line);
    // Valores copiados de una plantilla o perfil de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este puesto' });
    const illustrative = ill.marked;
    return kit.lineCard(
      {
        title: kit.out(() => (quote.labor[i] && quote.labor[i].role) || 'Puesto sin nombre'),
        subtitle: kit.out((r) => {
          const l = r.model.labor.lines[i];
          return l ? `${formatNumber(l.positions, { decimals: 2 })} posición(es) × ${formatNumber(l.peoplePerPosition, { decimals: 2 })} persona(s) = dotación ${formatNumber(l.headcount, { decimals: 2 })}` : '';
        }),
        badges: [ill.tag, agreement && agreement.illustrative ? badge('Convenio ilustrativo', 'orange') : null].filter(Boolean),
        actions: [
          kit.action('Aplicar parámetros del convenio', () => applyAgreement(i), { icon: 'check', title: 'Copia horas normales, recargo de horas extra, SAC, vacaciones, cargas y ART del convenio elegido' }),
          kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' }),
        ],
      },
      ill.control,
      kit.group(
        'Puesto',
        formGrid(
          3,
          kit.text(`${p}.role`, { label: 'Rol', maxLength: 120, placeholder: 'Ej.: Operador' }),
          kit.select(`${p}.agreementId`, { label: 'Convenio', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio' }),
          kit.text(`${p}.category`, { label: 'Categoría', maxLength: 120 }),
          kit.num(`${p}.positions`, { label: 'Posiciones a cubrir', rule: 'quantity', hint: 'Puestos que tienen que estar cubiertos a la vez.' }),
          // Mayor a 0: con 0 personas el puesto no tendría costo (QA-E2E-12).
          kit.num(`${p}.peoplePerPosition`, { label: 'Personas por posición (relevos)', rule: 'positive', hint: reliefHint }),
        ),
      ),
      kit.group(
        'Remuneración',
        formGrid(
          3,
          kit.num(`${p}.basicMonthly`, { label: 'Básico mensual', rule: 'money', unit: '$/mes', illustrative }),
          kit.num(`${p}.additionalsMonthly`, { label: 'Adicionales mensuales', rule: 'money', unit: '$/mes', illustrative, hint: 'Zona, diagrama, nocturnidad, etc.' }),
          kit.num(`${p}.mealPerActiveDay`, { label: 'Vianda por día activo', rule: 'money', unit: '$/día', illustrative }),
          kit.num(`${p}.normalHoursPerMonth`, { label: 'Horas normales por mes', rule: 'hours', unit: 'h/mes', illustrative: illustrativeParam(line, 'normalHoursPerMonth') }),
          kit.num(`${p}.overtimeHoursPerActiveDay`, { label: 'Horas extra por día activo', rule: 'hoursPerDay', unit: 'h/día', illustrative }),
          kit.num(`${p}.overtimePremiumPct`, { label: 'Recargo horas extra', rule: 'percentOpen', unit: '%', illustrative: illustrativeParam(line, 'overtimePremiumPct') }),
        ),
      ),
      kit.group(
        'Cargas sobre remunerativo',
        formGrid(
          4,
          kit.num(`${p}.sacPct`, { label: 'SAC', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'sacPct') }),
          kit.num(`${p}.vacationPct`, { label: 'Vacaciones', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'vacationPct') }),
          kit.num(`${p}.employerContributionsPct`, { label: 'Cargas patronales', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'employerContributionsPct') }),
          kit.num(`${p}.artPct`, { label: 'ART', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'artPct') }),
        ),
      ),
      kit.group(
        'Otros costos mensuales por persona',
        formGrid(
          4,
          kit.num(`${p}.insuranceMonthly`, { label: 'Seguros', rule: 'money', unit: '$/mes', illustrative }),
          kit.num(`${p}.ppeMonthly`, { label: 'EPP', rule: 'money', unit: '$/mes', illustrative }),
          kit.num(`${p}.trainingMonthly`, { label: 'Capacitación', rule: 'money', unit: '$/mes', illustrative }),
          kit.num(`${p}.transferMonthly`, { label: 'Traslado', rule: 'money', unit: '$/mes', illustrative }),
        ),
      ),
      h(
        'div',
        { class: 'qe-line-results' },
        kit.stats(
          kit.stat('Costo mensual por persona', (r) => formatMoney(r.model.labor.lines[i] && r.model.labor.lines[i].perPerson.fixedMonthly)),
          kit.stat('Dotación (personas)', (r) => formatNumber(r.model.labor.lines[i] && r.model.labor.lines[i].headcount, { decimals: 2 })),
          kit.stat('Fijo mensual total', (r) => formatMoney(r.model.labor.lines[i] && r.model.labor.lines[i].fixedMonthly), { emphasis: true }),
          kit.stat('Variable por día activo', (r) => formatMoney(r.model.labor.lines[i] && r.model.labor.lines[i].variablePerActiveDay), { hint: 'Horas extra con cargas + vianda.' }),
          kit.stat('Costo hora cargado', (r) => formatMoney(r.model.labor.lines[i] && r.model.labor.lines[i].perPerson.loadedHourlyCost), { hint: 'Costo por persona ÷ horas normales.' }),
          kit.stat('Factor de cargas', (r) => {
            const l = r.model.labor.lines[i];
            return l ? `× ${formatNumber(l.perPerson.loadFactor, { decimals: 4 })}` : EMPTY;
          }, { hint: '(1 + SAC + vac.) × (1 + cargas + ART)' }),
        ),
        kit.trace((r) => laborTrace(r, i, quote.labor[i])),
      ),
    );
  });

  // -------------------------------------------------------------- totales
  const totals = card(
    { title: 'Totales de personal', subtitle: 'Con la actividad estimada de la cotización.' },
    kit.stats(
      kit.stat('Dotación total', (r) => `${formatNumber(r.model.labor.headcount, { decimals: 2 })} personas`, { hint: (r) => `${formatNumber(r.model.labor.positions, { decimals: 2 })} posiciones cubiertas` }),
      kit.stat('Costo fijo mensual de personal', (r) => formatMoney(r.model.labor.fixedMonthly), { emphasis: true }),
      kit.stat('Variable por día activo', (r) => formatMoney(r.model.labor.variablePerActiveDay)),
      kit.stat('Mano de obra en la estructura de costos', (r) => {
        const row = r.eecc.rows.find((x) => x.category === 'labor');
        return row ? `${formatMoney(row.amount)} · ${formatPercent(row.displayPct)}` : EMPTY;
      }, { hint: (r) => (r.model.standby.monthly > 0 ? `Incluye standby: ${formatMoney(r.model.standby.monthly)} por mes.` : 'Fijo + variable × días activos.') }),
    ),
  );

  mount(
    container,
    banner(
      'Los parámetros de convenio (horas, recargo de horas extra, SAC, vacaciones, cargas patronales y ART) son GENÉRICOS e ILUSTRATIVOS: no son valores de ningún CCT. Cargá los vigentes de tu convenio.',
      'info',
      { title: 'Convenios parametrizables.' },
    ),
    card({ title: 'Puestos', subtitle: 'Pensá en posiciones cubiertas: cada posición puede necesitar más de una persona.' }, toolbar),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : card({}, emptyState('No hay personal cargado. Agregá un perfil desde la biblioteca o un puesto en blanco.')),
    totals,
  );
  return { update() {} };
}
