/**
 * Etapa 2 · Los recursos — Personal.
 * Roles con convenio parametrizable y cuántas personas de tu nómina lleva el
 * servicio (sin diagramas de rotación, 2026-11). Básico: rol, convenio,
 * cantidad de personas, sueldo básico y adicionales. Opciones avanzadas (con resumen visible de las cargas
 * aplicadas): horas, extras, recargo, SAC, vacaciones, cargas, ART, vianda,
 * seguros, EPP, capacitación, traslado y categoría.
 * Los parámetros de convenio de la demo son GENÉRICOS e ILUSTRATIVOS.
 */

import { h, mount } from '../../dom.js';
import { card, formGrid, selectField, confirmDialog, emptyState, badge } from '../../components.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, plural, stepName } from './shared.js';
import { ILLUSTRATIVE_AGREEMENT_PARAMS, isIllustrativeAgreementParam } from '../../../domain/catalogs.js';
import { laborLineFromProfile, createContractedStaff } from '../../../domain/quote-factory.js';
import { vatIsCost } from '../../../domain/catalogs.js';
import { openNewLaborProfileDialog } from '../library.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { closedJobsPerMonth, lineMonthAtEstimate, perBilledUnitSuffix, unitAmountText, costPlaceLabel, roleOvertimeMonth, overtimeWorkLabel, closedLaborCostText, timeLaborCostText, laborHourStat, BILLABLE_HOURS_LABEL, BILLABLE_HOURS_HINT } from '../../result-text.js';
import { usesTimeBasis, unitHoursConversion, showsPerUnit, unitHoursFactor } from '../../../domain/cost-basis.js';
import { nonNegative, isFiniteNumber, roundRate } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';
import { baseFields, lineOriginBlock, offerPeriodOf, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { onSessionReset } from '../../session-memory.js';
import { hasText } from '../../optional-fields.js';
import { baseText } from '../../economic-base-ui.js';
import { assignmentBlock, monthHoursField, prefillMonthHours, unitHoursField, asksUnitHours, hasManualSharePct, fullMonthField } from './assignment.js';
import { billableHoursOf, serviceMonthHours, monthBaseHoursOf } from '../../../domain/cost-basis.js';
import { billingUnitOf } from '../../../domain/billing-units.js';
import { laborHeadcountOf } from '../../../engines/labor-engine.js';
import { render as renderCharge } from './modality.js';
import { reliefFromLabor } from '../../../engines/rotation-engine.js';

/**
 * Puestos recién agregados en blanco que la persona todavía no tocó (sólo en memoria, tanda
 * novatos 2026-11): no se les muestra el aviso de "falta el sueldo" hasta que sale de un campo.
 */
const untouchedLines = new Set();
onSessionReset(() => untouchedLines.clear());

/** "4,5" / "5" (hasta 2 decimales). */
const n2 = (v) => formatNumber(v, { decimals: Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2 });

/** "4 personas" (o "2 trabajando · 4 en nómina" en cotizaciones anteriores con relevos). */
export function staffText(l) {
  if (!l) return '';
  const people = (n) => `${n2(n)} ${Math.abs(n - 1) < 1e-9 ? 'persona' : 'personas'}`;
  // Cotizaciones anteriores con relevos o nómina total: las dos cifras.
  if (Math.abs(nonNegative(l.positions) - nonNegative(l.headcount)) > 1e-6) return `${n2(l.positions)} trabajando · ${n2(l.headcount)} en nómina`;
  return people(nonNegative(l.headcount));
}

/** Bases de las horas extra (PLAN-2026-010). */
const OVERTIME_BASIS_OPTIONS = Object.freeze([
  { value: 'per_active_day', label: 'Horas por día de trabajo' },
  { value: 'per_month', label: 'Horas promedio por mes (por persona)' },
]);

/**
 * Monto mensual de cada concepto del puesto con la actividad estimada (PLAN-2026-010):
 * sueldo + cargas, cada tramo de horas extra, viandas y seguros / EPP / capacitación / traslado.
 */
export function laborBreakdown(line, { activeDays = 0, monthsFactor = 1 } = {}) {
  if (!line) return [];
  const p = line.perPerson;
  // Persona compartida (PLAN-2026-012): sueldo, cargas y no remunerativos al % asignado; las HE y viandas no.
  const share = line.shared && Number.isFinite(line.fixedCostSharePct) ? line.fixedCostSharePct / 100 : 1;
  const out = [{ label: 'Sueldo + cargas', amount: p.loadedRemunerative * share * line.headcount * monthsFactor }];
  (line.overtimeItems || []).forEach((o) => {
    const amount = o.basis === 'per_month' ? o.monthlyPerPerson * line.headcount * monthsFactor : o.perActiveDayPerPosition * line.positions * activeDays;
    out.push({ label: o.label, amount });
  });
  out.push({ label: 'Viandas', amount: line.perPosition.mealPerActiveDay * line.positions * activeDays });
  out.push({ label: 'Otros costos de la persona (no remunerativo, seguros, ropa y EPP, capacitación, traslado, otras cargas del convenio)', amount: p.nonRemunerative * share * line.headcount * monthsFactor });
  return out.filter((x) => x.amount > 0.005 || x.label === 'Sueldo + cargas');
}

/** Parámetros que se copian de un convenio a la línea. */
export const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);
/** Cargas del convenio fuera del factor de cargas que también se copian al aplicar el convenio. */
export const AGREEMENT_EXTRA_COST_KEYS = Object.freeze(['fixedContributionsMonthly', 'nonRemunerativeChargesPct', 'otherChargesPct', 'workerContributionsPct']);


/**
 * Resultado del "Ver cálculo" de un puesto por tiempo usado (I2): el mismo número que el
 * "Costo de este puesto" de al lado (en el trabajo, en el mes o por día de trabajo).
 */
function timeLaborTraceResult(result, line, index) {
  const month = lineMonthAtEstimate(result, line) + roleOvertimeMonth(result, index);
  const jobs = closedJobsPerMonth(result);
  if (jobs !== null) return { label: 'Costo del puesto en el trabajo', value: month / jobs, format: 'money' };
  const D = result.activity ? result.activity.activeDaysPerMonth : 0;
  if (!(D > 0)) return { label: 'Costo del puesto por día de trabajo', value: line.variablePerActiveDay, format: 'money' };
  return { label: 'Costo del puesto en el mes (actividad estimada)', value: month, format: 'money' };
}

function laborTrace(result, index, source) {
  const line = result && result.model.labor.lines[index];
  if (!line) return null;
  const p = line.perPerson;
  const src = source || {};
  return createTrace({
    id: 'labor_line',
    title: `Personal — ${line.role || 'Puesto'}`,
    formula: line.timeBasis
      // Por tiempo usado (2026-11-18): no hay fijo del mes; el puesto cuesta sus horas en el trabajo.
      ? 'Costo por persona = (Sueldo bruto + Otros pagos fijos) × (1 + Aguinaldo% + Vacaciones%) × (1 + Cargas patronales% + ART%) + Seguros + Ropa de trabajo y EPP básico + Capacitación + Traslado · Valor de la hora = costo por mes por persona ÷ horas que trabaja para clientes por mes (todos tus trabajos) (vacío = las normales) · Costo = personas × horas por día × días del trabajo × valor de la hora + vianda × días'
      : 'Costo por persona = (Sueldo bruto + Otros pagos fijos) × (1 + Aguinaldo% + Vacaciones%) × (1 + Cargas patronales% + ART%) + Seguros + Ropa de trabajo y EPP básico + Capacitación + Traslado · Fijo total = costo por persona × % asignado (100 % si es dedicada) × cantidad de personas · Variable por día de trabajo = (horas extra × valor hora extra × factor de cargas + vianda) × cantidad de personas',
    inputs: [
      { label: 'Sueldo bruto', value: p.basic, format: 'money' },
      { label: 'Otros pagos fijos', value: p.additionals, format: 'money' },
      { label: 'Aguinaldo (SAC)', value: nonNegative(src.sacPct), format: 'percent' },
      { label: 'Vacaciones', value: nonNegative(src.vacationPct), format: 'percent' },
      { label: 'Cargas patronales', value: nonNegative(src.employerContributionsPct), format: 'percent' },
      { label: 'ART', value: nonNegative(src.artPct), format: 'percent' },
      { label: 'Posiciones a cubrir', value: line.positions, format: 'number' },
      { label: 'Personas por posición (relevos)', value: line.peoplePerPosition, format: 'number' },
      { label: 'Horas normales por mes', value: nonNegative(src.normalHoursPerMonth), format: 'hours' },
      ...(line.overtimeItems || []).map((o) => ({ label: `${o.label}: horas ${o.basis === 'per_month' ? 'por mes (por persona)' : 'por día de trabajo'} con recargo ${formatPercent(o.premiumPct)}`, value: o.hours, format: 'hours' })),
      { label: 'Vianda por día de trabajo', value: line.perPosition.mealPerActiveDay, format: 'money' },
    ],
    steps: [
      { label: 'Factor de cargas', value: p.loadFactor, format: 'number' },
      { label: 'Remunerativo con cargas', value: p.loadedRemunerative, format: 'money' },
      { label: 'Otros costos de la persona (no remunerativo, seguros, EPP, capacitación, traslado, otras cargas del convenio)', value: p.nonRemunerative, format: 'money' },
      { label: 'Costo mensual por persona', value: p.fixedMonthly, format: 'money' },
      { label: 'Dotación (personas)', value: line.headcount, format: 'number' },
      // Por tiempo usado (2026-11-18): el puesto cuesta sus horas en el trabajo × el valor de su hora.
      ...(line.timeBasis && line.time ? [
        { label: line.time.ownBillableHours ? 'Horas que trabaja para clientes por mes (todos tus trabajos)' : 'Horas por mes (las normales)', value: line.time.billableHoursPerMonth, format: 'hours' },
        { label: 'Valor de la hora para cotizar (costo mensual por persona ÷ horas por mes)', value: line.time.hourlyCost, format: 'rate' },
        { label: 'Horas por día en el trabajo (de cada persona)', value: line.time.hoursPerDay, format: 'hours' },
        { label: 'Sus horas por día de trabajo (personas × horas × valor de la hora)', value: line.time.perActiveDay, format: 'money' },
      ] : []),
      ...(line.shared ? [
        { label: 'Costo fijo completo (100 %)', value: p.fixedMonthly * line.headcount, format: 'money' },
        { label: '% de su costo fijo asignado a esta cotización (persona compartida)', value: line.fixedCostSharePct, format: 'percent' },
        { label: 'Lo que tiene que cubrir otro servicio', value: line.unassignedFixedMonthly, format: 'money' },
      ] : []),
      ...(line.overtimeItems || []).map((o) => ({ label: `${o.label}: valor hora con recargo y cargas`, value: o.hourlyCost, format: 'rate' })),
      ...(p.overtimeMonthly > 0 ? [{ label: 'Horas extra por mes (fijo, por persona)', value: p.overtimeMonthly, format: 'money' }] : []),
      { label: 'Variable por día de trabajo (todas las posiciones)', value: line.variablePerActiveDay, format: 'money' },
      ...(line.overtimeBilling ? [{ label: 'Horas extra facturadas al cliente: ingreso por día de trabajo', value: line.overtimeBilling.perActiveDay, format: 'money' }, { label: 'Horas extra facturadas al cliente: ingreso fijo del mes', value: line.overtimeBilling.fixedMonthly, format: 'money' }] : []),
      // Horas extra del trabajo (M2): se suman dentro del costo de este puesto.
      ...(roleOvertimeMonth(result, index) > 0 ? [{ label: `Más ${overtimeWorkLabel(result)} de este puesto, en el mes estimado`, value: roleOvertimeMonth(result, index), format: 'money' }] : []),
    ],
    result: line.timeBasis
      ? timeLaborTraceResult(result, line, index)
      : { label: 'Fijo mensual total del puesto', value: line.fixedMonthly, format: 'money' },
    notes: [
      line.timeBasis ? 'Por tiempo usado: el puesto no carga su mes completo ni un % de su mes. Cuesta las horas del trabajo × el valor de su hora (costo del mes ÷ horas que trabaja para clientes por mes (todos tus trabajos); vacío = las normales). Así las horas sin cliente quedan cubiertas en cada hora.' : null,
      'Hora extra = (sueldo bruto ÷ horas normales) × (1 + recargo) × factor de cargas. Las "Horas al 50 % / 100 % por mes" usan el valor de la hora del recurso (sueldo con adicionales, o el valor que cargaste). Las horas por día de trabajo son costo variable; las horas promedio por mes, fijo del mes.',
      line.overtimeBilling ? 'Las horas extra que facturás aparte siguen siendo costo: además suman ingreso (horas × precio por hora).' : null,
      roleOvertimeMonth(result, index) > 0 ? `Las ${overtimeWorkLabel(result)} se eligen abajo, en "Horas extra del trabajo", y se suman al costo de este puesto, dentro de tu único precio.` : null,
      'Los porcentajes de convenio son parámetros que cargás vos: los de la demostración son ILUSTRATIVOS, no valores de ningún CCT.',
    ],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const agreements = Array.isArray(resources.agreements) ? resources.agreements : [];
  const profiles = Array.isArray(resources.laborProfiles) ? resources.laborProfiles : [];
  const lines = quote.labor;
  const serviceHours = Number(quote.activity && quote.activity.hoursPerActiveDay);
  // Por tiempo usado (cotizaciones nuevas que no se cobran por mes, 2026-11-18): cada puesto cuesta
  // sus horas en el trabajo × el valor de su hora. No hay "% de su mes" ni pregunta de dedicación.
  const timeBasis = usesTimeBasis(quote);
  const agreementOptions = agreements.map((a) => ({ value: a.id, label: a.illustrative ? `${a.name} (ilustrativo)` : a.name }));
  const agreementOf = (line) => agreements.find((a) => a.id === line.agreementId) || null;

  /** ¿Mostrar la etiqueta ILUSTRATIVO en un parámetro de convenio? */
  const illustrativeParam = (line, key) => isIllustrativeAgreementParam(line, key, { agreement: agreementOf(line), wholeIllustrative: Boolean(quote.illustrative) });

  // 0.18.0: lo que se pide de cada recurso asignado son sus horas (por día de trabajo o por mes).
  // 0.19.0: en la unidad de cobro (por válvula, en el trabajo) cuando la unidad lo permite.
  // Cómo se convierte el dato "en la unidad": 'job' (horas en el trabajo) o 'unit' (heredado de la 0.19.0).
  const hoursBasis = unitHoursConversion(quote);
  const perUnitShown = showsPerUnit(quote);
  /** Cobro por unidad contable con el rendimiento cargado: las cuentas se dicen "por válvula". */
  const perUnitView = (r) => {
    const f = perUnitShown && r && r.activity ? nonNegative(r.activity.unitsPerActiveDay) : 0;
    return f > 0 ? { f, one: billingUnitOf(quote).singular || 'unidad' } : null;
  };
  const hoursKey = timeBasis ? (hoursBasis === 'job' ? 'assignedHoursPerUnit' : 'coverageHoursPerDay') : billingUnitOf(quote).kind === 'month' ? 'assignedHoursPerMonth' : 'positions';
  // Cobro por mes (0.21.0, W-07): horas del servicio (días × horas por día) para arrancar cada recurso.
  const monthUnitQuote = !timeBasis && billingUnitOf(quote).kind === 'month';
  const serviceHoursMonth = monthUnitQuote ? serviceMonthHours(quote.activity || {}) : 0;
  const serviceHoursText = serviceHoursMonth > 0 ? `${formatNumber(nonNegative(quote.activity.activeDaysPerMonth), { decimals: 2 })} días × ${formatNumber(nonNegative(quote.activity.hoursPerActiveDay), { decimals: 2 })} h` : '';
  const withServiceHours = (line) => (monthUnitQuote ? prefillMonthHours(line, { serviceHours: serviceHoursMonth, baseHours: monthBaseHoursOf(quote, line, 'labor') }) : line);
  const hoursWhat = timeBasis || billingUnitOf(quote).kind === 'month' ? 'horas efectivas de trabajo' : 'datos en esta cotización';

  // ------------------------------------------------------------ acciones
  let selectedProfileId = null;
  const addFromLibrary = () => {
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) {
      ctx.toast('Elegí un puesto de la lista para asignarlo.', 'warning');
      return;
    }
    const agreement = agreements.find((a) => a.id === profile.agreementId) || null;
    const line = withServiceHours(laborLineFromProfile(profile, agreement, { now: new Date().toISOString(), currency: quoteCurrencyOf(quote) }));
    const index = lines.length;
    ctx.mutate((q) => q.labor.push(line), { focus: `labor.${index}.${hoursKey}` });
    ctx.toast(`Se asignó "${line.role}" con su costo de Recursos. Indicá sus ${hoursWhat}.`, 'success');
  };
  // 0.15.0 (Joaco, 2026-11-19): el personal propio se carga en Recursos, con su convenio y su sueldo
  // completos; la cotización no crea puestos a medias. "Crear un puesto nuevo" abre el formulario
  // de Recursos acá mismo: el puesto queda guardado en Recursos y se suma a la cotización.
  const createInResources = () => {
    openNewLaborProfileDialog(ctx.app, {
      agreements,
      onSaved: (profile, agreement, created) => {
        // La copia de Recursos de esta pantalla también lo tiene (lista para elegir, convenio).
        if (created && Array.isArray(resources.agreements)) resources.agreements.push(created);
        if (Array.isArray(resources.laborProfiles)) resources.laborProfiles.push(profile);
        const line = withServiceHours(laborLineFromProfile(profile, agreement, { now: new Date().toISOString(), currency: quoteCurrencyOf(quote) }));
        const index = quote.labor.length;
        ctx.mutate((q) => q.labor.push(line), { focus: `labor.${index}.${hoursKey}` });
        ctx.toast(`"${line.role}" quedó guardado en Recursos y se asignó a la cotización. Indicá sus ${hoursWhat}.`, 'success');
      },
    });
  };
  // Personal tercerizado: la excepción. Se contrata afuera por un valor fijo (hora, día o mes).
  const contracted = Array.isArray(quote.contractedStaff) ? quote.contractedStaff : [];
  const addContracted = () => {
    const index = contracted.length;
    ctx.mutate((q) => {
      if (!Array.isArray(q.contractedStaff)) q.contractedStaff = [];
      q.contractedStaff.push(createContractedStaff());
    }, { focus: `contractedStaff.${index}.role` });
  };
  const removeContracted = async (index) => {
    const line = contracted[index];
    if (!line) return;
    const ok = await confirmDialog({
      title: 'Quitar personal tercerizado',
      message: `¿Quitar "${line.role || 'Personal tercerizado'}" de esta cotización?`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (ok) ctx.mutate((q) => q.contractedStaff.splice(index, 1));
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
      // También las cargas del convenio fuera del factor (0.12.0 y auditoría externa K-09).
      [...AGREEMENT_PARAM_KEYS, ...AGREEMENT_EXTRA_COST_KEYS].forEach((key) => {
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
    // V-25: sin puestos cargados no se ofrece una lista vacía; crear uno pasa a ser el botón principal.
    !profiles.length ? null : h(
      'div',
      { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Asignar personal de tus Recursos',
        value: null,
        includeEmpty: true,
        emptyLabel: 'Elegí un puesto…',
        options: profiles.map((p) => ({ value: p.id, label: `${p.role}${p.category ? ` — ${p.category}` : ''}` })),
        onChange: (v) => {
          selectedProfileId = v;
        },
      }),
      kit.action('Asignar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Crear un puesto nuevo', createInResources, { icon: 'plus', size: 'md', title: 'Abre el formulario de Recursos: convenio, sueldo y cargas. Queda guardado para tus próximas cotizaciones.', ...(profiles.length ? {} : { variant: 'primary' }) }),
    kit.action('Agregar personal tercerizado', addContracted, { icon: 'plus', size: 'md', title: 'Alguien que contratás afuera por un valor fijo por hora, por día o por mes.' }),
  );
  const toolbarNote = h('p', { class: 'qe-note' },
    'Sueldos y convenios: en ',
    h('a', { href: '#/recursos/personal' }, 'Recursos'),
    '.');

  /** "SAC 8,33 % · vacaciones 4 % · …" con lo cargado en la línea. */
  const loadsText = (line) => [
    ['SAC', line.sacPct],
    ['vacaciones', line.vacationPct],
    ['cargas patronales', line.employerContributionsPct],
    ['ART', line.artPct],
  ].map(([label, v]) => `${label} ${hasNumber(v) ? formatPercent(Number(v)) : 'sin cargar'}`).join(' · ');

  /**
   * Horas extra por tramos (PLAN-2026-010), cargadas antes en el puesto: se editan o se quitan.
   * Regla de un ítem (2026-11-18): no se agregan tramos nuevos ni se ofrece facturarlas aparte;
   * las horas extra se eligen al final de Personal, en "Horas extra del trabajo".
   */
  function overtimeEditor(i, line) {
    const p = `labor.${i}`;
    const items = Array.isArray(line.overtime) ? line.overtime : null;
    const removeTier = (j) => ctx.mutate((q) => {
      q.labor[i].overtime.splice(j, 1);
    });
    const removeLegacyOvertime = async () => {
      const ok = await confirmDialog({
        title: 'Quitar las horas extra del puesto',
        message: `Se borran las horas extra cargadas antes en este puesto${line.overtimeBilled === true ? ' y lo que se facturaba aparte por ellas' : ''}. Si el trabajo lleva horas extra, elegilas abajo, en "Horas extra del trabajo": se suman dentro del costo de tu gente.`,
        confirmLabel: 'Quitar',
        danger: true,
      });
      if (!ok) return;
      ctx.mutate((q) => {
        const l = q.labor[i];
        if (!l) return;
        delete l.overtime;
        delete l.overtimeBilled;
        l.overtimeHoursPerActiveDay = 0;
      });
    };
    const rows = items
      ? items.map((o, j) => h(
        'div',
        { class: 'qe-ot-row' },
        formGrid(
          line.overtimeBilled === true ? 4 : 3,
          kit.text(`${p}.overtime.${j}.label`, { label: 'Concepto', maxLength: 60, placeholder: 'Ej.: HE 50 %' }),
          kit.num(`${p}.overtime.${j}.premiumPct`, { label: 'Recargo', rule: 'percentOpen', unit: '%' }),
          kit.num(`${p}.overtime.${j}.hours`, { label: 'Horas', rule: 'hours', unit: kit.out(() => ((quote.labor[i] && quote.labor[i].overtime && quote.labor[i].overtime[j] && quote.labor[i].overtime[j].basis) === 'per_month' ? 'h/mes' : 'h/día')) }),
          line.overtimeBilled === true ? kit.num(`${p}.overtime.${j}.billRatePerHour`, { label: 'Precio por hora al cliente', rule: 'money', unit: '$/h', hint: 'Lo que le cobrás por cada hora extra (sin IVA).' }) : null,
        ),
        h(
          'div',
          { class: 'qe-toolbar' },
          kit.select(`${p}.overtime.${j}.basis`, { label: '¿Cómo la estimás?', options: OVERTIME_BASIS_OPTIONS, structural: true }),
          kit.action('Quitar tramo', () => removeTier(j), { variant: 'ghost', icon: 'trash' }),
        ),
      ))
      : [];
    return h(
      'div',
      { class: 'qe-ot' },
      h('p', { class: 'qe-note' }, 'Horas extra por tramo: cada una con su recargo (los 50 % y 100 % son valores de partida editables, no normativa). Por día de trabajo son costo variable; las horas promedio por mes, fijo del mes.'),
      ...rows,
      // Regla de un ítem (A5, 2026-11-18): no se agregan tramos nuevos ni se ofrece facturarlas
      // aparte. Lo cargado antes se edita o se quita (mismos números mientras quede).
      ctx.readOnly ? null : h(
        'div',
        { class: 'qe-toolbar' },
        kit.action('Quitar las horas extra del puesto', () => removeLegacyOvertime(), { variant: 'ghost', icon: 'trash', title: 'Las horas extra ahora se eligen abajo, en "Horas extra del trabajo".' }),
      ),
      line.overtimeBilled === true
        ? kit.check(`${p}.overtimeBilled`, {
          label: 'Estas horas extra se facturan aparte al cliente (cargado antes)',
          structural: true,
          hint: 'Esta cotización ya las facturaba aparte: se sigue cobrando igual. Destildalo para que queden dentro de tu único precio. Las cotizaciones nuevas ya no lo ofrecen.',
        })
        : null,
      line.overtimeBilled === true && !items
        ? h('p', { class: 'qe-warn' }, 'Se facturan aparte pero no tienen tramos con precio por hora: no suman ingreso. Destildalo o quitá las horas extra del puesto.')
        : null,
    );
  }

  // ------------------------------------------------- personas del servicio
  // Sin diagramas (2026-11, pedido del dueño): el personal es de tu nómina y se asigna al
  // servicio. Se carga "cuántas personas" por rol. Las cotizaciones de antes con personas por
  // posición o nómina total distintas siguen mostrando esos campos (mismos números).
  const payrollMode = (line) => Boolean(line) && Number(line.payrollHeadcount) > 0;
  const legacyStaff = (line) => payrollMode(line) || (hasNumber(line && line.peoplePerPosition) && Math.abs(Number(line.peoplePerPosition) - 1) > 1e-9);
  /** Vuelve a "N personas" (posiciones × 1): cambia el costo si había relevos; es explícito. */
  const useSimplePeople = async (i) => {
    const l = quote.labor[i];
    if (!l) return;
    const people = laborHeadcountOf(l);
    const perDay = nonNegative(l.mealPerActiveDay) > 0 || nonNegative(l.overtimeHoursPerActiveDay) > 0
      || (Array.isArray(l.overtime) && l.overtime.some((o) => o && o.basis !== 'per_month' && nonNegative(o.hours) > 0));
    if (perDay) {
      const ok = await confirmDialog({
        title: 'Simplificar a cantidad de personas',
        message: `Quedan ${n2(people)} personas trabajando. Los sueldos no cambian, pero la vianda y las horas extra por día se cuentan para las ${n2(people)} (hoy para ${n2(nonNegative(l.positions))}): el costo sube. ¿Seguir?`,
        confirmLabel: 'Simplificar',
      });
      if (!ok) return;
    }
    ctx.mutate((q) => {
      const x = q.labor[i];
      x.positions = people > 0 ? roundRate(people) : x.positions;
      x.peoplePerPosition = 1;
      x.payrollHeadcount = null;
    }, { focus: `labor.${i}.positions` });
  };
  /** Diagrama guardado en una cotización anterior: ya no se edita; lo aplicado quedó en el puesto. */
  const removeRotation = (i) => ctx.mutate((q) => {
    const l = q.labor[i];
    const rot = l.rotation || {};
    // Lo que el diagrama todavía movía queda a la vista (mismos números): sus horas por turno
    // pasan a "Horas por día de cada persona" y, si los viajes seguían al diagrama, su
    // intervalo pasa a "Se queda en campo" con los mismos días entre viajes.
    const shift = Math.min(nonNegative(rot.hoursPerShift), 24);
    if (shift > 0 && !(nonNegative(l.coverageHoursPerDay) > 0)) l.coverageHoursPerDay = shift;
    const relief = reliefFromLabor(q.labor);
    if (q.activity && q.activity.travelPattern === 'rotation' && relief && relief.index === i) {
      q.activity.travelPattern = 'custom';
      q.activity.daysPerActivation = roundRate(relief.daysBetweenRelieves);
    }
    delete l.rotation;
  });
  function legacyRotationNote(i, line) {
    if (!line || !line.rotation || typeof line.rotation !== 'object') return null;
    const label = line.rotation.daysOn && line.rotation.daysOff ? ` (${line.rotation.daysOn}x${line.rotation.daysOff})` : '';
    const shift = nonNegative(line.rotation.hoursPerShift);
    const shiftText = shift > 0 && !(nonNegative(line.coverageHoursPerDay) > 0) ? ` Sus turnos de ${n2(shift)} h se siguen usando para el aviso de horas hasta que cargues las horas por día de cada persona.` : '';
    return h('div', { class: 'qe-note qe-legacy-rotation' },
      `Este puesto tenía un diagrama de rotación${label}. Ya no se usa: las personas que aplicaste quedaron en el puesto.${shiftText}`,
      ctx.readOnly ? null : h('span', { class: 'qe-toolbar' }, kit.action('Quitar el diagrama', () => removeRotation(i), { variant: 'ghost', icon: 'trash', title: 'Quita el dato viejo. Las personas y el sueldo del puesto no cambian.' })));
  }

  /** ¿La línea tiene horas extra cargadas con el método anterior (por día o por tramos)? */
  const hasLegacyOvertime = (line) => Boolean(line) && (Array.isArray(line.overtime) || nonNegative(line.overtimeHoursPerActiveDay) > 0 || line.overtimeBilled === true);

  // -------------------------------------------------------------- líneas
  /** ¿La cantidad es 1 (o no está)? Entonces no se muestra: un recurso asignado es ese recurso. */
  const singleUnit = (v) => v !== null && v !== undefined && v !== '' && Math.abs(Number(v) - 1) < 1e-9;
  /** Horas por día de cada persona en el trabajo (vacío = las del servicio). */
  const hoursPerDayField = (i, line) => kit.num(`labor.${i}.coverageHoursPerDay`, {
    label: timeBasis ? 'Horas efectivas de trabajo' : 'Horas por día de cada persona',
    rule: 'hoursPerDay',
    unit: 'h/día',
    placeholder: line.rotation && nonNegative(line.rotation.hoursPerShift) > 0
      ? `${n2(nonNegative(line.rotation.hoursPerShift))} (turno cargado antes)`
      : serviceHours > 0 ? `${formatNumber(serviceHours, { decimals: 2 })} (${timeBasis ? 'todo el día' : 'las del servicio'})` : `Las del servicio («${stepName('service')}»)`,
    hint: timeBasis
      ? `Las horas efectivas de trabajo de este puesto para esta cotización, por día de trabajo. Su costo = esas horas × el valor de su hora. Ejemplo: de un día de 8 h, el chofer maneja 5 → 5. Vacío = todo el día de trabajo${serviceHours > 0 ? ` (${formatNumber(serviceHours, { decimals: 2 })} h)` : ` (se carga en «${stepName('service')}»)`}; más que eso no se cuenta.`
      : 'Vacío = trabajan todas las horas por día del servicio. Si se turnan (por ejemplo 3 personas de 8 h para 24 h), cargá las de cada una. Sirve para avisarte si faltan horas.',
  });
  /**
   * Cuánto de su tiempo usa esta cotización (0.16.0), en la tarjeta del puesto:
   *  - trabajo / hora / día (por tiempo usado): horas por día de cada persona → paga esas horas;
   *  - por mes: todo su mes (100 %) o una parte (el % del costo fijo, regla de siempre).
   * No cambia ninguna fórmula: son los mismos datos que antes estaban en "Más detalle".
   */
  const dedicationField = (i, line) => {
    if (timeBasis) {
      if (!asksUnitHours(hoursBasis, line, 'coverageHoursPerDay')) return hoursPerDayField(i, line);
      const ready = unitHoursFactor(hoursBasis, ctx.result && ctx.result.activity ? ctx.result.activity : {}) > 0;
      return unitHoursField(kit, { path: `labor.${i}`, kind: 'labor', basis: hoursBasis, unit: billingUnitOf(quote), ready, where: stepName('service') });
    }
    const p = `labor.${i}`;
    // 0.18.0: por mes se piden las horas por mes en el servicio (vacío = todo el mes). Un % cargado
    // a mano antes (o "contratada para este servicio") se sigue viendo como estaba.
    // Sólo cobrando por mes: en una cotización anterior por día o por trabajo sigue la pregunta de
    // "Cómo se cobra" (¿trabajan sólo para este servicio?); desde 0.24.0, el % de cada línea.
    if (billingUnitOf(quote).kind === 'month' && !hasManualSharePct(line) && line.assignment !== 'hired') {
      return monthHoursField(kit, ctx, { path: p, kind: 'labor', baseHours: billableHoursOf(line, nonNegative(line.normalHoursPerMonth)), serviceHours: serviceHoursMonth, serviceText: serviceHoursText });
    }
    const options = [
      { value: 'dedicated', label: 'Todo su mes (100 %)' },
      { value: 'shared', label: 'Una parte de su mes' },
      ...(line.assignment === 'hired' ? [{ value: 'hired', label: 'Contratada para este servicio (100 %)' }] : []),
    ];
    return h('div', { class: 'qe-dedication-field' },
      kit.select(`${p}.assignment`, { label: '¿Cuánto de su tiempo usa esta cotización?', options, structural: true, hint: 'Si también trabaja en otros servicios, elegí "Una parte" y poné el %: esta cotización paga sólo esa parte de su sueldo.' }),
      line.assignment === 'shared'
        ? kit.num(`${p}.fixedCostSharePct`, { label: '¿Qué % de su mes?', rule: 'sharePct', unit: '%', requiredMark: true, hint: 'Ej.: 2 semanas de 4 → 50. Vacío = 100 %.' })
        : null);
  };

  const lineCards = lines.map((line, i) => {
    const p = `labor.${i}`;
    const at = (r) => r.model.labor.lines[i];
    const agreement = agreementOf(line);
    // Valores copiados de una plantilla o perfil de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este puesto' });
    const illustrative = ill.marked;
    const anyIllustrativeParam = AGREEMENT_PARAM_KEYS.some((key) => illustrativeParam(line, key));
    // ¿Viene de Recursos? Entonces sus datos ya están cargados allá: acá sólo cantidades.
    const fromResource = typeof line.sourceId === 'string' && line.sourceId !== '';
    // Aviso de sueldo faltante: recién cuando la persona sale de un campo del puesto (no al agregarlo).
    const lineKey = line.id || null;
    let lastResult = null;
    const salaryMissing = (r) => ((r && r.completeness && r.completeness.pending) || []).some((x) => x.id === 'labor' && (x.targets || []).some((t) => t.index === i));
    const showSalaryBanner = (r) => {
      lastResult = r;
      return !(lineKey && untouchedLines.has(lineKey)) && salaryMissing(r);
    };
    const salaryBanner = kit.toggle(h(
      'div',
      { class: 'banner banner-warning qe-incomplete qe-salary-missing', role: 'status' },
      h('div', {}, h('strong', {}, kit.out(() => `"${(quote.labor[i] && quote.labor[i].role) || 'Puesto'}" no tiene sueldo. `)), 'Sin el sueldo faltan sus cargas sociales y el valor de sus horas extra: la cotización no está completa. Si no trabaja en este servicio, poné 0 personas o quitá la línea.'),
      ctx.readOnly
        ? null
        : h('div', { class: 'qe-toolbar' },
          kit.action('Completar', () => ctx.focusField(`${p}.basicMonthly`), { variant: 'primary', icon: 'check' }),
          kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })),
    ), showSalaryBanner);
    const salaryTag = h('span', { class: 'base-tag is-undefined qe-salary-tag' }, 'Falta el sueldo');
    kit.toggle(salaryTag, () => {
      const l = quote.labor[i];
      return !(lineKey && untouchedLines.has(lineKey)) && Boolean(l) && !(nonNegative(l.basicMonthly) > 0);
    });
    const origin = lineOriginBlock(ctx, 'labor', i, nonNegative(line.basicMonthly) > 0 ? [{ prefix: 'Base', base: line.base }] : []);
    if (origin) {
      const row = origin.querySelector('.line-origin');
      if (row) row.appendChild(salaryTag);
    }
    const card = kit.lineCard(
      {
        title: kit.out(() => (quote.labor[i] && quote.labor[i].role) || 'Puesto sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          if (!l) return '';
          // 0.18.0: con las horas cargadas, el subtítulo las dice (como en Equipos).
          const cur = quote.labor[i] || {};
          const one = Math.abs(l.positions - 1) < 1e-9 && Math.abs(l.headcount - 1) < 1e-9;
          if (l.timeBasis && l.time && l.time.hoursPerDay > 0) return `${one ? '' : `${staffText(l)} · `}${perUnitView(r) ? `${formatNumber(l.time.hoursPerDay / perUnitView(r).f, { decimals: 2 })} h efectivas por ${perUnitView(r).one}` : `${formatNumber(l.time.hoursPerDay, { decimals: 2 })} h efectivas por día`}`;
          if (!l.timeBasis && l.shared && nonNegative(cur.assignedHoursPerMonth) > 0) return `${staffText(l)} · ${formatNumber(nonNegative(cur.assignedHoursPerMonth), { decimals: 2 })} h por mes`;
          return staffText(l);
        }),
        badges: [ill.tag, agreement && agreement.illustrative ? badge('Convenio ilustrativo', 'orange') : null].filter(Boolean),
        actions: [
          line.agreementId ? kit.action('Usar las cargas del convenio', () => applyAgreement(i), { icon: 'check', title: 'Copia horas normales, recargo de horas extra, SAC, vacaciones, cargas y ART del convenio elegido' }) : null,
          kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' }),
        ],
      },
      origin,
      resourceSyncNotice(ctx, 'labor', i, { name: line.role || 'Puesto' }),
      ill.control,
      // Puesto usado sin sueldo (ECO-01, H-03): crítico, se nombra y lleva al campo. No se inventa un sueldo.
      salaryBanner,
      // PLAN-2026-026: lo NECESARIO a la vista. Un puesto que viene de Recursos trae su sueldo,
      // cargas y valor de la hora: acá sólo se carga cuántas personas van (y, si hacen, las horas
      // extra del mes). Un puesto en blanco pide además el rol y el sueldo.
      formGrid(
        3,
        fromResource ? null : kit.text(`${p}.role`, { label: 'Rol', maxLength: 120, placeholder: 'Ej.: Chofer' }),
        // 0.16.0 (Joaco: "Cantidad de personas en este puesto… no entiendo"): el puesto de Recursos es
        // un sueldo tipo; acá se dice cuántas personas con ese sueldo van y, al lado, cuánto de su
        // tiempo usa esta cotización (horas por día en un trabajo; todo o parte del mes si se cobra por mes).
        // 0.18.0 (Joaco, 2026-11-20): un recurso asignado es ese recurso. Primero sus horas; la
        // cantidad ya viene en 1 y sólo se cambia si van varias personas con ese mismo sueldo.
        legacyStaff(line) ? null : dedicationField(i, line),
        // 0.23.1: la decisión "sólo tiene este trabajo" va en la tarjeta de cada puesto (una por recurso, se deshace destildando).
        timeBasis && !legacyStaff(line) ? fullMonthField(kit, { path: p, kind: 'labor', list: 'labor', index: i, quote }) : null,
        // 0.19.0 (Joaco, 2026-11-20): sin "Cantidad". Si van dos choferes, el puesto se asigna dos
        // veces. Una línea que ya tiene otra cantidad la sigue mostrando (mismos números).
        !legacyStaff(line) && singleUnit(line.positions) ? null : kit.num(`${p}.positions`, {
          label: legacyStaff(line) ? 'Personas trabajando a la vez' : 'Cantidad',
          rule: 'quantity',
          requiredMark: legacyStaff(line),
          unit: legacyStaff(line) ? null : 'pers.',
          placeholder: '1',
          hint: legacyStaff(line) ? 'Las que trabajan en el servicio al mismo tiempo.' : 'Cargada antes. Para sumar otra persona, asigná el puesto otra vez.',
        }),
        fromResource ? null : kit.num(`${p}.basicMonthly`, { label: 'Sueldo bruto por mes', rule: 'money', unit: '$/mes', requiredMark: true, illustrative, hint: 'El bruto de recibo, sin cargas: RATEOS las suma.' }),
        // Horas extra: ya no se cargan en el puesto (Joaco, 2026-11-18). Van al final de Personal →
        // "Horas extra del trabajo". Las cotizaciones que ya las tenían las siguen viendo (mismos números).
        nonNegative(line.overtime50HoursPerMonth) > 0 ? kit.num(`${p}.overtime50HoursPerMonth`, { label: 'Horas extra al 50 % que le pagás por mes (opcional)', rule: 'hours', unit: 'h/mes', placeholder: '0', hint: `Las horas extra que le PAGÁS a CADA persona en un mes, si las hace siempre en este servicio. Ej.: sábados de 8 a 12 = 4 h × 4,33 semanas ≈ 17 h. Si no hace: vacío. Lo que se trabaja fuera de horario en este trabajo va abajo, en "Horas extra del trabajo".` }) : null,
        nonNegative(line.overtime100HoursPerMonth) > 0 ? kit.num(`${p}.overtime100HoursPerMonth`, { label: 'Horas extra al 100 % que le pagás por mes (opcional)', rule: 'hours', unit: 'h/mes', placeholder: '0', hint: `Las horas que le PAGÁS a CADA persona en un mes en sábados a la tarde, domingos o feriados, si las hace siempre en este servicio. Si no hace: vacío. Lo que se trabaja fuera de horario en este trabajo va abajo, en "Horas extra del trabajo".` }) : null,
      ),
      // Cotizaciones anteriores con relevos o nómina total: se ven y se editan igual (mismos números).
      legacyStaff(line)
        ? h('div', { class: 'qe-legacy-staff' },
          formGrid(
            3,
            payrollMode(line)
              ? kit.num(`${p}.payrollHeadcount`, { label: 'Personas en nómina (total del puesto)', rule: 'quantity', hint: 'Cargado antes: todas las personas que cobran sueldo en este puesto.' })
              : kit.num(`${p}.peoplePerPosition`, { label: 'Personas por posición (relevos)', rule: 'positive', hint: 'Cargado antes: cada persona trabajando se cubre con esta cantidad en nómina.' }),
          ),
          ctx.readOnly ? null : h('div', { class: 'qe-toolbar' },
            kit.action('Simplificar a cantidad de personas', () => useSimplePeople(i), { variant: 'ghost', title: 'Deja sólo "Cantidad de personas" con el total en nómina de hoy. Los sueldos no cambian; si hay vianda u horas extra por día, pasan a contarse para todas (te lo pregunta antes).' })))
        : null,
      legacyRotationNote(i, line),
      // Lo que cuesta cada persona (viene de Recursos): por mes y por hora (normal, 50 % y 100 %).
      h('div', { class: 'qe-person-rates' },
        h('p', { class: 'qe-person-rates-title' }, fromResource ? 'Lo que te cuesta cada persona (viene de Recursos)' : 'Lo que te cuesta cada persona'),
        kit.stats(
          kit.stat('Por mes con cargas', (r) => (at(r) && at(r).perPerson.fixedMonthly > 0 ? formatMoney(at(r).perPerson.fixedMonthly) : EMPTY), { emphasis: true, hint: 'Sueldo y otros pagos fijos con aguinaldo, vacaciones, cargas patronales y ART, más seguros, ropa y capacitación.' }),
          // Por tiempo usado: la hora con la que se cotiza (÷ horas que vende, si las cargó).
          kit.stat(timeBasis ? 'Valor de la hora' : 'Hora normal', (r) => {
            const v = laborHourStat(at(r), nonNegative(quote.labor[i] && quote.labor[i].normalHoursPerMonth)).value;
            return v > 0 ? formatMoney(v) : EMPTY;
          }, { hint: (r) => laborHourStat(at(r), nonNegative(quote.labor[i] && quote.labor[i].normalHoursPerMonth)).hint }),
          kit.stat('Hora al 50 %', (r) => (at(r) && at(r).perPerson.overtimeHourlyCost50 > 0 ? formatMoney(at(r).perPerson.overtimeHourlyCost50) : EMPTY), { hint: (r) => (at(r) && at(r).perPerson.overtimeRate50Own ? 'El valor que cargaste para este puesto (por su convenio).' : 'Lo que te cuesta cada hora con recargo del 50 %: hora de sueldo × 1,5, con cargas.') }),
          kit.stat('Hora al 100 %', (r) => (at(r) && at(r).perPerson.overtimeHourlyCost100 > 0 ? formatMoney(at(r).perPerson.overtimeHourlyCost100) : EMPTY), { hint: (r) => (at(r) && at(r).perPerson.overtimeRate100Own ? 'El valor que cargaste para este puesto (por su convenio).' : 'Lo que te cuesta cada hora con recargo del 100 % (lo habitual en domingos y feriados; revisá tu convenio): hora de sueldo × 2, con cargas.') }),
        )),
      kit.keyline({
        label: 'Costo de este puesto',
        value: (r) => {
          const l = at(r);
          if (!l) return EMPTY;
          // Precio cerrado (Joaco 2026-11-18): lo del puesto en el trabajo, no por mes.
          // Las horas extra del trabajo de este puesto van dentro de su costo (M2).
          const ot = roleOvertimeMonth(r, i);
          const jobs = closedJobsPerMonth(r);
          if (jobs !== null) return `${formatMoney((lineMonthAtEstimate(r, l) + ot) / jobs)} en el trabajo`;
          // Por tiempo usado sin días cargados todavía: lo de cada día de trabajo (no hay fijo del mes).
          if (l.timeBasis && !(r.activity.activeDaysPerMonth > 0)) return `${formatMoney(l.variablePerActiveDay)} por día de trabajo`;
          const month = r.activity.activeDaysPerMonth > 0 ? lineMonthAtEstimate(r, l) + ot : l.fixedMonthly;
          // 0.19.0: cobrando por unidad contable, primero lo del puesto por unidad; el mes, después.
          const v = l.timeBasis ? perUnitView(r) : null;
          const billed = nonNegative(r.activity.billableQuantityPerMonth);
          if (v && r.activity.activeDaysPerMonth > 0) return `${formatMoney(month / (billed > 0 ? billed : r.activity.activeDaysPerMonth * v.f))} por ${v.one} · ${formatMoney(month)} por mes`;
          return unitAmountText(r, quote, month);
        },
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          const jobs = closedJobsPerMonth(r);
          // Por tiempo usado: personas × horas por día × días × valor de la hora (+ vianda y horas extra).
          if (l.timeBasis) {
            const body = timeLaborCostText(r, l, { overtime: roleOvertimeMonth(r, i) });
            // 0.17.0 (menos texto): la cuenta en una línea; el detalle sigue en "Ver cálculo".
            // 0.18.0 (revisión de uso): sólo de dónde sale la hora; las horas del mes se cambian en el desplegable.
            const hours = l.time ? ` Hora = costo del mes ÷ ${formatNumber(l.time.billableHoursPerMonth, { decimals: 2 })} h.` : '';
            const v = perUnitView(r);
            const perUnit = v && l.time && l.time.hoursPerDay > 0 ? `${Math.abs((l.positions || 1) - 1) > 1e-9 ? `${formatNumber(l.positions, { decimals: 2 })} personas × ` : ''}${formatNumber(l.time.hoursPerDay / v.f, { decimals: 2 })} h por ${v.one} × ${formatMoney(l.time.hourlyCost)} la hora = ${formatMoney((l.time.perActiveDay || 0) / v.f)} por ${v.one}. En el mes: ` : '';
            return `${perUnit}${body ? `${body}.` : staffText(l)}${hours}`;
          }
          if (jobs !== null) {
            // N1: la cuenta cierra con el total (meses de sueldo si el trabajo dura más que el mes).
            const share = l.shared && !l.shareMissing ? ` (este servicio paga el ${formatPercent(l.fixedCostSharePct)} de su mes)` : '';
            const body = closedLaborCostText(r, l, { overtime: roleOvertimeMonth(r, i), share });
            return `${staffText(l)}.${body ? ` ${body}.` : ''} Si también hace otros trabajos ese mes, elegí «Una parte de su mes» en su línea.`;
          }
          const variable = l.variablePerActiveDay > 0 ? ` + ${formatMoney(l.variablePerActiveDay)} por día de trabajo (${l.perPosition.overtimePerActiveDay > 0 ? 'horas extra y vianda' : 'vianda'})` : '';
          // Desglose del mes (PLAN-2026-010): sueldo + cargas, HE por tramo, viandas, seguros/EPP.
          const D = r.activity.activeDaysPerMonth;
          const parts = laborBreakdown(l, { activeDays: D }).map((x) => `${x.label} ${formatMoney(x.amount)}`).join(' · ');
          // 0.16.0: el % va en la cuenta (2 personas × $ 2.190.435 × 50 % de su mes), no al final.
          // 0.18.0: con las horas por mes cargadas, el % se explica con ellas (88 h por mes = 50 % de su mes).
          const monthHours = nonNegative(quote.labor[i] && quote.labor[i].assignedHoursPerMonth);
          const share = l.shared && !l.shareMissing ? ` × ${formatPercent(l.fixedCostSharePct)} de su mes${monthHours > 0 ? ` (${formatNumber(monthHours, { decimals: 2 })} h por mes en este servicio)` : ''}` : '';
          // Sin días cargados todavía (los recursos van antes que el ritmo cargado): sólo el fijo del mes.
          const month = D > 0 ? ` En el mes (${formatNumber(D, { decimals: 2 })} días): ${parts}.` : '';
          const extraMonth = l.perPerson.overtimeMonthly > 0 ? ` + ${formatMoney(l.perPerson.overtimeMonthly)} de horas extra` : '';
          const ot = roleOvertimeMonth(r, i);
          const otText = ot > 0 ? ` + ${overtimeWorkLabel(r)}: ${formatMoney(ot)} en el mes (elegidas abajo, en "Horas extra del trabajo").` : '';
          return `${staffText(l)} × (${formatMoney(l.perPerson.fixedMonthly)}${extraMonth})${share}${variable}.${month}${otText}`.replace(/× \((\$[^()+]*)\)/, '× $1');
        },
        trace: (r) => laborTrace(r, i, quote.labor[i]),
      }),
      // Todo lo demás, en un solo lugar y plegado: sueldo y cargas (ya vienen de Recursos), si
      // trabaja sólo para este servicio y de qué mes es el sueldo.
      kit.advanced(
        {
          key: `labor:${line.id || i}`,
          title: fromResource ? 'Cambiar sus datos sólo en esta cotización (opcional)' : 'Más detalle (opcional)',
          summary: (r) => {
            const current = quote.labor[i] || {};
            const l = at(r);
            const legacyOt = l && l.overtimeItems ? l.overtimeItems.filter((o) => !o.resourceRate) : [];
            const extras = [
              legacyOt.length
                ? legacyOt.map((o) => `${o.label} ${formatNumber(o.hours, { decimals: 2 })} h ${o.basis === 'per_month' ? 'por mes' : 'por día'}`).join(', ') + (current.overtimeBilled === true ? ' (se facturan aparte)' : '')
                : null,
              nonNegative(current.mealPerActiveDay) > 0 ? `vianda ${formatMoney(nonNegative(current.mealPerActiveDay))} por día` : null,
              baseText(current.base, { prefix: 'Sueldo de', fallbackPeriod: offerPeriodOf(quote) }),
            ].filter(Boolean).join(' · ');
            return h(
              'span',
              {},
              h('span', { class: 'qe-adv-line' }, fromResource
                ? `Sueldo ${formatMoney(nonNegative(current.basicMonthly))} · cargas: ${loadsText(current)}.`
                : `Cargas: ${loadsText(current)}.`, anyIllustrativeParam ? illustrativeTag('Parámetros de convenio GENÉRICOS e ILUSTRATIVOS: cargá los vigentes de tu convenio') : null),
              h('span', { class: 'qe-adv-line' }, `${extras.charAt(0).toUpperCase()}${extras.slice(1)}.`),
            );
          },
        },
        fromResource
          ? h('p', { class: 'qe-note' }, 'Estos datos se cargan una sola vez en ', h('a', { href: '#/recursos' }, 'Recursos'), '. Si los cambiás acá, cambian sólo en esta cotización.')
          : null,
        anyIllustrativeParam
          ? h('p', { class: 'qe-note' }, 'Los parámetros de convenio (horas, recargo de horas extra, SAC, vacaciones, cargas patronales y ART) son GENÉRICOS e ILUSTRATIVOS: no son valores de ningún CCT. Cargá los vigentes de tu convenio o tocá "Aplicar parámetros del convenio".')
          : null,
        kit.group(
          'Puesto y sueldo',
          formGrid(
            3,
            fromResource ? kit.text(`${p}.role`, { label: 'Rol', maxLength: 120, placeholder: 'Ej.: Operario' }) : null,
            kit.select(`${p}.agreementId`, { label: 'Convenio', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio' }),
            fromResource ? kit.num(`${p}.basicMonthly`, { label: 'Sueldo bruto por mes', rule: 'money', unit: '$/mes', illustrative, hint: 'El bruto de recibo, sin cargas: RATEOS las suma.' }) : null,
            kit.num(`${p}.additionalsMonthly`, { label: 'Otros pagos fijos por mes', rule: 'money', unit: '$/mes', illustrative, hint: 'Zona, presentismo, nocturnidad, etc.' }),
            // V-06: comidas en un solo lugar (Viajes no las pide; ahí va sólo el alojamiento).
            kit.num(`${p}.mealPerActiveDay`, { label: 'Vianda o comidas por día', rule: 'money', unit: '$/día', illustrative, hint: 'Por persona y por día de trabajo. Es el único lugar donde se cargan las comidas. Si las da el cliente: 0.' }),
            // 0.16.0: "Horas por día de cada persona" y "¿trabaja sólo para este servicio?" pasaron a la
            // tarjeta del puesto, al lado de cuántas personas van (dedicationField).
            legacyStaff(line) || !timeBasis ? hoursPerDayField(i, line) : null,
          ),
        ),
        kit.group(
          'Cargas sociales sobre el sueldo',
          formGrid(
            4,
            kit.num(`${p}.sacPct`, { label: 'Aguinaldo (SAC)', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'sacPct') }),
            kit.num(`${p}.vacationPct`, { label: 'Vacaciones', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'vacationPct') }),
            kit.num(`${p}.employerContributionsPct`, { label: 'Cargas patronales', rule: 'percent', unit: '%', hint: 'Sólo sobre lo remunerativo (con aguinaldo y vacaciones): nunca sobre las sumas no remunerativas.', illustrative: illustrativeParam(line, 'employerContributionsPct') }),
            kit.num(`${p}.artPct`, { label: 'ART', rule: 'percent', unit: '%', illustrative: illustrativeParam(line, 'artPct') }),
          ),
        ),
        kit.group(
          'Valor de la hora',
          formGrid(
            3,
            kit.num(`${p}.normalHoursPerMonth`, { label: 'Horas normales por mes', rule: 'hours', unit: 'h/mes', illustrative: illustrativeParam(line, 'normalHoursPerMonth') }),
            // Por tiempo usado (2026-11-18): las horas que de verdad vende; con ellas sale la hora para cotizar.
            timeBasis ? kit.num(`${p}.billableHoursPerMonth`, { label: BILLABLE_HOURS_LABEL, rule: 'hours', unit: 'h/mes', placeholder: 'Igual a las normales', hint: BILLABLE_HOURS_HINT }) : null,
            kit.num(`${p}.overtimeRate50`, { label: 'Hora al 50 %', rule: 'money', unit: '$/h', placeholder: 'Se calcula sola', hint: 'Vacío = hora de sueldo × 1,5, con cargas.' }),
            kit.num(`${p}.overtimeRate100`, { label: 'Hora al 100 %', rule: 'money', unit: '$/h', placeholder: 'Se calcula sola', hint: 'Vacío = hora de sueldo × 2, con cargas.' }),
          ),
          // Horas extra cargadas con el método anterior (por día o por tramos): se siguen viendo y editando.
          hasLegacyOvertime(line)
            ? h('div', { class: 'qe-legacy-ot' },
              formGrid(
                2,
                Array.isArray(line.overtime) ? null : kit.num(`${p}.overtimeHoursPerActiveDay`, { label: 'Horas extra por día de trabajo (cargado antes)', rule: 'hoursPerDay', unit: 'h/día', illustrative }),
                kit.num(`${p}.overtimePremiumPct`, { label: Array.isArray(line.overtime) ? 'Recargo de convenio (referencia)' : 'Recargo de esas horas extra', rule: 'percentOpen', unit: '%', illustrative: illustrativeParam(line, 'overtimePremiumPct'), hint: Array.isArray(line.overtime) ? 'Se usa al aplicar el convenio; cada tramo tiene su recargo.' : null }),
              ),
              overtimeEditor(i, line))
            : null,
        ),
        kit.group(
          'Otros costos por persona',
          formGrid(
            3,
            kit.num(`${p}.insuranceMonthly`, { label: 'Seguros', rule: 'money', unit: '$/mes', illustrative }),
            kit.num(`${p}.ppeMonthly`, { label: 'Ropa de trabajo y EPP básico (por persona)', rule: 'money', unit: '$/mes', illustrative, hint: `El EPP especial del trabajo (trajes, respiradores, arneses) va en "${stepName('materials')}".` }),
            kit.num(`${p}.trainingMonthly`, { label: 'Capacitación', rule: 'money', unit: '$/mes', illustrative }),
            // Pasajes de la persona (micro o avión de los relevos): no es el vehículo, que va en Equipos.
            kit.num(`${p}.transferMonthly`, { label: 'Pasajes o traslado de la persona', rule: 'money', unit: '$/mes', illustrative, hint: `Por persona y mes: micro, avión o reintegro. Si viaja en un vehículo de "${stepName('equipment')}", ya está ahí: dejalo en 0.` }),
            // 0.24.0 (P-14): sólo informativa; se ve sólo si ya tiene texto (no se borra nada).
            hasText(line.category)
              ? kit.text(`${p}.category`, { label: 'Categoría', maxLength: 120, hint: 'Sólo informativa (no cambia el costo).' })
              : null,
          ),
        ),
        // PLAN-2026-012: dedicada / compartida (% explícito del costo fijo) / contratada para el servicio.
        legacyStaff(line) && !timeBasis ? assignmentBlock(kit, { path: p, line, kind: 'labor', at }) : null,
        kit.advanced(
          {
            key: `labor-base:${line.id || i}`,
            title: '¿De qué mes es el sueldo?',
            summary: () => baseText(quote.labor[i] && quote.labor[i].base, { fallbackPeriod: offerPeriodOf(quote) }),
          },
          h('p', { class: 'small' }, 'De qué mes son el sueldo y los otros pagos (por ejemplo, la escala de un convenio). Cambiarlo acá sólo afecta esta cotización.'),
          baseFields(ctx, `${p}.base`, { periodLabel: 'Mes del sueldo (escala)' }),
        ),
        kit.group(
          'Detalle del costo',
          kit.stats(
            kit.stat('Costo mensual por persona', (r) => formatMoney(at(r) && at(r).perPerson.fixedMonthly)),
            kit.stat('Personas', (r) => formatNumber(at(r) && at(r).headcount, { decimals: 2 })),
            timeBasis
              ? kit.stat('Sus horas por día de trabajo', (r) => formatMoney(at(r) && at(r).time ? at(r).time.perActiveDay : 0), { emphasis: true, hint: (r) => (at(r) && at(r).time ? `${formatNumber(at(r).positions, { decimals: 2 })} × ${formatNumber(at(r).time.hoursPerDay, { decimals: 2 })} h × ${formatMoney(at(r).time.hourlyCost)} la hora.` : '') })
              : kit.stat('Fijo por mes del puesto', (r) => formatMoney(at(r) && at(r).fixedMonthly), { emphasis: true, hint: (r) => (at(r) && at(r).shared && !at(r).shareMissing ? `${formatPercent(at(r).fixedCostSharePct)} asignado a esta cotización (persona compartida).` : '') }),
            kit.stat('Por cada día de trabajo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: timeBasis ? 'Sus horas en el trabajo, vianda (y horas extra por día, si las hay).' : 'Vianda (y horas extra por día, si las hay).' }),
            kit.stat('Factor de cargas', (r) => {
              const l = at(r);
              return l ? `× ${formatNumber(l.perPerson.loadFactor, { decimals: 4 })}` : EMPTY;
            }, { hint: '(1 + SAC + vac.) × (1 + cargas + ART)' }),
          ),
        ),
      ),
    );
    // Validar recién al salir del campo (tanda novatos 2026-11): al dejar el campo del sueldo,
    // el aviso de sueldo faltante pasa a mostrarse si corresponde.
    if (lineKey && untouchedLines.has(lineKey)) {
      card.addEventListener('focusout', (event) => {
        const target = event.target;
        if (!target || target.name !== `${p}.basicMonthly`) return;
        if (!untouchedLines.delete(lineKey)) return;
        salaryBanner.hidden = !showSalaryBanner(lastResult);
        const l = quote.labor[i];
        salaryTag.hidden = !(l && !(nonNegative(l.basicMonthly) > 0));
      });
    }
    return card;
  });

  // ------------------------------------------------ personal tercerizado
  // 0.15.0: una persona contratada afuera cuesta un valor fijo por hora, por día o por mes. Sin
  // sueldo, convenio ni cargas. Los montos los da el motor (contracted-staff-engine).
  const CONTRACTED_UNITS = [
    { value: 'hour', label: 'Por hora' },
    { value: 'day', label: 'Por día' },
    { value: 'month', label: 'Por mes' },
  ];
  const unitWord = (unit) => ({ hour: 'hora', day: 'día', month: 'mes' }[unit] || 'día');
  const withVat = vatIsCost(ctx.settings);
  const contractedCards = contracted.map((line, i) => {
    const p = `contractedStaff.${i}`;
    const at = (r) => (r.model.contractedStaff ? r.model.contractedStaff.lines[i] : null);
    const byHour = line.unit === 'hour';
    return kit.lineCard(
      {
        title: kit.out(() => (quote.contractedStaff[i] && quote.contractedStaff[i].role) || 'Personal tercerizado'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l ? `${n2(l.people)} ${plural(l.people, 'persona', 'personas')}` : '';
        }),
        badges: [badge('Tercerizado', 'blue')],
        actions: [kit.action('Quitar', () => removeContracted(i), { variant: 'danger', icon: 'trash' })],
        className: 'qe-line-compact qe-contracted-staff',
      },
      h('p', { class: 'qe-note' }, 'Lo contratás afuera: no lleva sueldo, convenio ni cargas. Sólo cuánto le pagás.'),
      formGrid(
        2,
        kit.text(`${p}.role`, { label: '¿Qué hace?', maxLength: 120, placeholder: 'Ej.: soldador, ayudante, técnico' }),
        kit.num(`${p}.people`, { label: 'Cantidad de personas', rule: 'quantity', requiredMark: true }),
      ),
      formGrid(
        byHour ? 3 : 2,
        kit.num(`${p}.rate`, {
          label: withVat ? '¿Cuánto le pagás? (con IVA)' : '¿Cuánto le pagás? (sin IVA)',
          rule: 'money',
          unit: `$/${unitWord(line.unit)}`,
          requiredMark: true,
          hint: withVat ? 'Por persona. Como monotributista o exento, el IVA de la factura es costo: cargalo con IVA.' : 'Por persona, sin IVA.',
        }),
        kit.select(`${p}.unit`, { label: '¿Cada cuánto?', options: CONTRACTED_UNITS, structural: true }),
        byHour ? kit.num(`${p}.hoursPerDay`, {
          label: 'Horas por día (opcional)',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: serviceHours > 0 ? `${formatNumber(serviceHours, { decimals: 2 })} (las del trabajo)` : 'Las del trabajo',
          hint: `Vacío = las horas por día del trabajo (se cargan en "${stepName('service')}").`,
        }) : null,
      ),
      kit.keyline({
        label: 'Te cuesta',
        value: (r) => {
          const l = at(r);
          if (!l) return EMPTY;
          const jobs = closedJobsPerMonth(r);
          const month = lineMonthAtEstimate(r, l);
          if (jobs !== null) return `${formatMoney(month / jobs)} en el trabajo`;
          if (l.unit === 'month') return `${formatMoney(l.fixedMonthly)} por mes${perBilledUnitSuffix(r, quote, month)}`;
          if (!(r.activity.activeDaysPerMonth > 0)) return `${formatMoney(l.variablePerActiveDay)} por día de trabajo`;
          return unitAmountText(r, quote, month);
        },
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          if (!(l.rate > 0)) return 'Falta cuánto le pagás.';
          if (l.hoursMissing) return `Faltan las horas por día: cargalas acá o en "${stepName('service')}".`;
          const who = `${n2(l.people)} ${plural(l.people, 'persona', 'personas')}`;
          const D = r.activity.activeDaysPerMonth;
          const days = D > 0 ? ` · ${formatNumber(D, { decimals: 2 })} días de trabajo en el mes` : '';
          if (l.unit === 'hour') return `${who} × ${formatNumber(l.hoursPerDay, { decimals: 2 })} h × ${formatMoney(l.rate)} la hora = ${formatMoney(l.variablePerActiveDay)} por día de trabajo${days}.`;
          if (l.unit === 'day') return `${who} × ${formatMoney(l.rate)} por día = ${formatMoney(l.variablePerActiveDay)} por día de trabajo${days}.`;
          return `${who} × ${formatMoney(l.rate)} por mes. Se paga el mes entero, trabaje los días que trabaje: si sólo viene algunos días, cargalo por día.`;
        },
        tone: (r) => (at(r) && (!(at(r).rate > 0) || at(r).hoursMissing) && at(r).people > 0 ? 'red' : null),
      }),
    );
  });

  // -------------------------------------------------------------- totales
  // Se muestra siempre que la mano de obra pese en la estructura de costos,
  // aunque no haya puestos: puede venir de "Otros costos" con categoría Mano
  // de obra (REG-3).
  const laborRow = (r) => r.eecc.rows.find((x) => x.category === 'labor') || null;
  // Horas extra del trabajo en el mes estimado (la línea del motor, con sus meses de costo fijo).
  const overtimeMonth = (r) => {
    const line = (r.model.lines || []).find((x) => x.key === 'labor:overtime-work');
    return line ? lineMonthAtEstimate(r, line) : 0;
  };
  const anyStaff = lines.length + contracted.length > 0;
  /** Personal tercerizado en el mes estimado (líneas del motor). */
  const contractedMonth = (r) => (r.model.contractedStaff ? r.model.contractedStaff.lines.reduce((acc, l) => acc + lineMonthAtEstimate(r, l), 0) : 0);
  const totals = kit.toggle(
    kit.keyline({
      label: (r) => (anyStaff ? costPlaceLabel(r, quote, 'Personal') : 'Mano de obra en la estructura de costos'),
      value: (r) => {
        const row = laborRow(r);
        if (!row) return EMPTY;
        const jobs = closedJobsPerMonth(r);
        if (jobs !== null && anyStaff) return formatMoney(row.amount / jobs);
        if (anyStaff) return unitAmountText(r, quote, row.amount);
        // Sin puestos: "$ X · Y %" (monto e incidencia en la estructura de costos).
        return `${formatMoney(row.amount)} · ${formatPercent(row.displayPct)}`;
      },
      hint: (r) => {
        const row = laborRow(r);
        if (!anyStaff) return `Viene de gastos cargados antes con «Suma en: Mano de obra» (se ven en "${stepName('materials')}").`;
        const standby = r.model.standby.monthly > 0 ? ` Incluye el personal en espera (standby): ${formatMoney(r.model.standby.monthly)} por mes.` : '';
        const headcount = r.model.labor.headcount;
        const positions = r.model.labor.positions;
        const parts = [
          row ? `${formatPercent(row.displayPct)} del costo total` : null,
          !lines.length ? null : Math.abs(headcount - positions) > 1e-6
            ? `${formatNumber(headcount, { decimals: 2 })} ${plural(headcount, 'persona', 'personas')} en nómina, ${formatNumber(positions, { decimals: 2 })} trabajando a la vez`
            : `${formatNumber(headcount, { decimals: 2 })} ${plural(headcount, 'persona', 'personas')}`,
          r.model.contractedStaff && r.model.contractedStaff.people > 0
            ? `${formatNumber(r.model.contractedStaff.people, { decimals: 2 })} ${plural(r.model.contractedStaff.people, 'tercerizada', 'tercerizadas')}`
            : null,
          // N1: en precio cerrado, la cuenta en el trabajo cierra con el total (meses de sueldo).
          !lines.length ? null : closedJobsPerMonth(r) !== null
            ? closedLaborCostText(r, r.model.labor, { overtime: overtimeMonth(r) }).replace(/^Sueldo/, 'sueldos').replace(/^Horas de tu gente/, 'horas de tu gente')
            : r.model.labor.timeBasis
              // Por tiempo usado no hay fijo del mes: todo es por día de trabajo.
              ? `${perUnitView(r) ? `${formatMoney(r.model.labor.variablePerActiveDay / perUnitView(r).f)} por ${perUnitView(r).one}` : `${formatMoney(r.model.labor.variablePerActiveDay)} por día de trabajo`} (sus horas, vianda y horas extra)${r.model.labor.fixedMonthly > 0.005 ? ` + ${formatMoney(r.model.labor.fixedMonthly)} por mes` : ''}`
              : `fijo ${formatMoney(r.model.labor.fixedMonthly)} + ${formatMoney(r.model.labor.variablePerActiveDay)} por día de trabajo`,
          // M2: las horas extra del trabajo están en el total; se dicen para que la cuenta cierre.
          r.model.overtimeWork && r.model.overtimeWork.active && closedJobsPerMonth(r) === null
            ? `más ${overtimeWorkLabel(r)}: ${formatMoney(overtimeMonth(r))} en el mes`
            : null,
          // 0.15.0: el personal tercerizado está en el total; se dice para que la cuenta cierre.
          r.model.contractedStaff && !(r.activity.activeDaysPerMonth > 0) && r.model.contractedStaff.variablePerActiveDay > 0.005
            ? `tercerizados: ${formatMoney(r.model.contractedStaff.variablePerActiveDay)} por día de trabajo${r.model.contractedStaff.fixedMonthly > 0.005 ? ` + ${formatMoney(r.model.contractedStaff.fixedMonthly)} por mes` : ''}`
            : contractedMonth(r) > 0.005
            ? `tercerizados: ${closedJobsPerMonth(r) !== null ? `${formatMoney(contractedMonth(r) / closedJobsPerMonth(r))} en el trabajo` : `${formatMoney(contractedMonth(r))} en el mes`}`
            : null,
        ].filter(Boolean);
        return `${parts.join(' · ')}.${standby}`;
      },
      className: 'qe-keyline-total',
    }),
    (r) => anyStaff || Boolean(laborRow(r) && laborRow(r).amount > 0),
  );

  // 0.24.0 (PLAN-2026-028): "Horas extra del trabajo" (antes en "Cómo se cobra"), al final, antes del total.
  const overtimeSlot = h('div', { class: 'qe-overtime-slot' });
  renderCharge(overtimeSlot, { ...ctx, part: 'overtime' });
  mount(
    container,
    card({ title: 'Agregá los puestos' }, toolbar, toolbarNote),
    lineCards.length + contractedCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards, ...contractedCards)
      : emptyState({
        title: 'Todavía no cargaste personal.',
        text: profiles.length
          ? 'Agregá un puesto de tus Recursos o creá uno nuevo. Si lo contratás afuera, sumalo como personal tercerizado. Si el servicio no lleva personal, seguí al próximo paso.'
          : 'Creá tu primer puesto (queda guardado en Recursos) o, si lo contratás afuera, sumalo como personal tercerizado. Si el servicio no lleva personal, seguí al próximo paso.',
        icon: 'resources',
      }),
    // P4 (revisión de la 0.24.0): las horas extra cambian el costo de Personal: van antes del total.
    overtimeSlot.dataset.empty === 'true' ? null : overtimeSlot,
    totals,
  );
  return { update() {} };
}
