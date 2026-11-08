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
import { laborLineFromProfile } from '../../../domain/quote-factory.js';
import { formatMoney, formatNumber, formatPercent, EMPTY } from '../../../core/format.js';
import { nonNegative, isFiniteNumber, roundRate } from '../../../core/money.js';
import { createTrace } from '../../../core/trace.js';
import { createId } from '../../../core/ids.js';
import { baseFields, lineOriginBlock, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { assignmentBlock } from './assignment.js';
import { laborHeadcountOf } from '../../../engines/labor-engine.js';
import { reliefFromLabor } from '../../../engines/rotation-engine.js';

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
  { value: 'per_active_day', label: 'Horas por día activo' },
  { value: 'per_month', label: 'Horas promedio por mes (por persona)' },
]);

/** Tramo de horas extra nuevo (los recargos son presets editables, no normativa). */
function overtimeItem(premiumPct, label = null, hours = 0, basis = 'per_active_day') {
  return { id: `ot-${createId().slice(0, 8)}`, label: label || `HE ${premiumPct} %`, premiumPct, hours, basis, billRatePerHour: null };
}

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
  out.push({ label: 'Seguros, EPP, capacitación y traslado', amount: p.nonRemunerative * share * line.headcount * monthsFactor });
  return out.filter((x) => x.amount > 0.005 || x.label === 'Sueldo + cargas');
}

/** Parámetros que se copian de un convenio a la línea. */
export const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);


function laborTrace(result, index, source) {
  const line = result && result.model.labor.lines[index];
  if (!line) return null;
  const p = line.perPerson;
  const src = source || {};
  return createTrace({
    id: 'labor_line',
    title: `Personal — ${line.role || 'Puesto'}`,
    formula: 'Costo por persona = (Básico + Adicionales) × (1 + SAC% + Vacaciones%) × (1 + Cargas% + ART%) + Seguros + EPP + Capacitación + Traslado · Fijo total = costo por persona × % asignado (100 % si es dedicada) × cantidad de personas · Variable por día activo = (horas extra × valor hora extra × factor de cargas + vianda) × cantidad de personas',
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
      ...(line.overtimeItems || []).map((o) => ({ label: `${o.label}: horas ${o.basis === 'per_month' ? 'por mes (por persona)' : 'por día activo'} con recargo ${formatPercent(o.premiumPct)}`, value: o.hours, format: 'hours' })),
      { label: 'Vianda por día activo', value: line.perPosition.mealPerActiveDay, format: 'money' },
    ],
    steps: [
      { label: 'Factor de cargas', value: p.loadFactor, format: 'number' },
      { label: 'Remunerativo con cargas', value: p.loadedRemunerative, format: 'money' },
      { label: 'Seguros + EPP + capacitación + traslado', value: p.nonRemunerative, format: 'money' },
      { label: 'Costo mensual por persona', value: p.fixedMonthly, format: 'money' },
      { label: 'Dotación (personas)', value: line.headcount, format: 'number' },
      ...(line.shared ? [
        { label: 'Costo fijo completo (100 %)', value: p.fixedMonthly * line.headcount, format: 'money' },
        { label: '% de su costo fijo asignado a esta cotización (persona compartida)', value: line.fixedCostSharePct, format: 'percent' },
        { label: 'Lo que tiene que cubrir otro servicio', value: line.unassignedFixedMonthly, format: 'money' },
      ] : []),
      ...(line.overtimeItems || []).map((o) => ({ label: `${o.label}: valor hora con recargo y cargas`, value: o.hourlyCost, format: 'rate' })),
      ...(p.overtimeMonthly > 0 ? [{ label: 'Horas extra por mes (fijo, por persona)', value: p.overtimeMonthly, format: 'money' }] : []),
      { label: 'Variable por día activo (todas las posiciones)', value: line.variablePerActiveDay, format: 'money' },
      ...(line.overtimeBilling ? [{ label: 'Horas extra facturadas al cliente: ingreso por día activo', value: line.overtimeBilling.perActiveDay, format: 'money' }, { label: 'Horas extra facturadas al cliente: ingreso fijo del mes', value: line.overtimeBilling.fixedMonthly, format: 'money' }] : []),
    ],
    result: { label: 'Fijo mensual total del puesto', value: line.fixedMonthly, format: 'money' },
    notes: [
      'Hora extra = (básico ÷ horas normales) × (1 + recargo) × factor de cargas. Las horas por día activo son costo variable; las horas promedio por mes, fijo del mes.',
      line.overtimeBilling ? 'Las horas extra que facturás aparte siguen siendo costo: además suman ingreso (horas × precio por hora).' : null,
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
  const agreementOptions = agreements.map((a) => ({ value: a.id, label: a.illustrative ? `${a.name} (ilustrativo)` : a.name }));
  const agreementOf = (line) => agreements.find((a) => a.id === line.agreementId) || null;

  /** ¿Mostrar la etiqueta ILUSTRATIVO en un parámetro de convenio? */
  const illustrativeParam = (line, key) => isIllustrativeAgreementParam(line, key, { agreement: agreementOf(line), wholeIllustrative: Boolean(quote.illustrative) });

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
    ctx.toast(`Se agregó "${line.role}" con los valores que tiene hoy en Recursos (y su fecha base). Si después cambian, esta cotización no cambia sola.`, 'success');
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

  /**
   * Horas extra por tramos (PLAN-2026-010): HE 50 %, HE 100 % u otro recargo,
   * por día activo o promedio por mes, y si se facturan aparte. Los recargos
   * son presets editables (no normativa). Agregar el primer tramo convierte el
   * campo único (mismas horas y recargo: mismo costo).
   */
  function overtimeEditor(i, line) {
    const p = `labor.${i}`;
    const items = Array.isArray(line.overtime) ? line.overtime : null;
    const addTier = (premiumPct, label = null) => ctx.mutate((q) => {
      const l = q.labor[i];
      if (!Array.isArray(l.overtime)) {
        const legacyHours = Number(l.overtimeHoursPerActiveDay) || 0;
        const legacyPremium = Number(l.overtimePremiumPct) || 0;
        l.overtime = legacyHours > 0 ? [overtimeItem(legacyPremium, `HE ${legacyPremium} %`, legacyHours, 'per_active_day')] : [];
        l.overtimeHoursPerActiveDay = 0;
      }
      l.overtime.push(overtimeItem(premiumPct, label));
    }, { focus: `${p}.overtime.${(items ? items.length : (Number(line.overtimeHoursPerActiveDay) > 0 ? 1 : 0))}.hours` });
    const removeTier = (j) => ctx.mutate((q) => {
      q.labor[i].overtime.splice(j, 1);
    });
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
      h('p', { class: 'qe-note' }, 'Horas extra por tramo: cada una con su recargo (los 50 % y 100 % son valores de partida editables, no normativa). Por día activo son costo variable; las horas promedio por mes, fijo del mes.'),
      ...rows,
      h(
        'div',
        { class: 'qe-toolbar' },
        kit.action('HE 50 %', () => addTier(50), { icon: 'plus' }),
        kit.action('HE 100 %', () => addTier(100), { icon: 'plus' }),
        kit.action('Otro recargo', () => addTier(0, 'Otro recargo'), { icon: 'plus' }),
      ),
      kit.check(`${p}.overtimeBilled`, {
        label: '¿Estas horas extra se facturan aparte al cliente?',
        structural: true,
        hint: 'Si se facturan aparte, siguen siendo costo y además suman ingreso: horas × precio por hora de cada tramo.',
      }),
      line.overtimeBilled === true && !items
        ? h('p', { class: 'qe-warn' }, 'Para facturarlas aparte agregá los tramos (HE 50 %, HE 100 % u otro) y el precio por hora de cada uno.')
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
          if (!l) return '';
          return staffText(l);
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
      // Puesto usado sin sueldo básico (ECO-01, H-03): crítico, se nombra y lleva al campo. No se inventa un sueldo.
      kit.toggle(h(
        'div',
        { class: 'banner banner-warning qe-incomplete qe-salary-missing', role: 'status' },
        h('div', {}, h('strong', {}, kit.out(() => `"${(quote.labor[i] && quote.labor[i].role) || 'Puesto'}" no tiene sueldo básico. `)), 'Sin el básico faltan su sueldo, las cargas sociales sobre él y el valor de sus horas extra: la cotización no está completa. Si no trabaja en este servicio, poné 0 personas o quitá la línea.'),
        ctx.readOnly
          ? null
          : h('div', { class: 'qe-toolbar' },
            kit.action('Completar', () => ctx.focusField(`${p}.basicMonthly`), { variant: 'primary', icon: 'check' }),
            kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })),
      ), (r) => ((r.completeness && r.completeness.pending) || []).some((x) => x.id === 'labor' && (x.targets || []).some((t) => t.index === i))),
      formGrid(
        3,
        kit.text(`${p}.role`, { label: 'Rol', maxLength: 120, placeholder: 'Ej.: Operador' }),
        kit.select(`${p}.agreementId`, { label: 'Convenio', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio' }),
        kit.num(`${p}.positions`, { label: legacyStaff(line) ? 'Personas trabajando a la vez' : 'Cantidad de personas', rule: 'quantity', hint: legacyStaff(line) ? 'Las que trabajan en el servicio al mismo tiempo.' : 'Cuántas personas de este rol trabajan en el servicio. Son de tu nómina: se cobra su sueldo con cargas.' }),
        kit.num(`${p}.basicMonthly`, { label: 'Sueldo básico', rule: 'money', unit: '$/mes', illustrative }),
        kit.num(`${p}.additionalsMonthly`, { label: 'Adicionales', rule: 'money', unit: '$/mes', illustrative, hint: 'Zona, nocturnidad, etc.' }),
        // Horas de trabajo de cada persona (2026-11, antes "Horas por día que cubre este puesto"):
        // sólo para el aviso de horas (no cambia el costo; las horas extra se cargan aparte).
        kit.num(`${p}.coverageHoursPerDay`, { label: 'Horas por día de cada persona', rule: 'hoursPerDay', unit: 'h/día', placeholder: line.rotation && nonNegative(line.rotation.hoursPerShift) > 0 ? `${n2(nonNegative(line.rotation.hoursPerShift))} (turno cargado antes)` : serviceHours > 0 ? `${formatNumber(serviceHours, { decimals: 2 })} (las del servicio)` : 'Las del servicio', hint: 'Vacío = trabajan todas las horas por día del servicio. Si se turnan (por ejemplo 3 personas de 8 h para 24 h), cargá las de cada una. Sólo sirve para avisarte si faltan horas: no cambia el costo; las horas extra se cargan en "Opciones avanzadas".' }),
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
      // PLAN-2026-012: dedicada / compartida (% explícito del costo fijo) / contratada para el servicio.
      assignmentBlock(kit, { path: p, line, kind: 'labor', at }),
      kit.keyline({
        label: 'Costo del puesto',
        value: (r) => (at(r) ? `${formatMoney(at(r).fixedMonthly)} por mes` : EMPTY),
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          const variable = l.variablePerActiveDay > 0 ? ` + ${formatMoney(l.variablePerActiveDay)} por día activo (horas extra y vianda)` : '';
          // Desglose del mes (PLAN-2026-010): sueldo + cargas, HE por tramo, viandas, seguros/EPP.
          const D = r.activity.activeDaysPerMonth;
          const parts = laborBreakdown(l, { activeDays: D }).map((x) => `${x.label} ${formatMoney(x.amount)}`).join(' · ');
          const share = l.shared && !l.shareMissing ? ` Compartida: esta cotización carga el ${formatPercent(l.fixedCostSharePct)} de su costo fijo.` : '';
          return `${formatMoney(l.perPerson.fixedMonthly)} por persona con cargas${variable}. En el mes (${formatNumber(D, { decimals: 2 })} días): ${parts}.${share}`;
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
              l && l.overtimeItems && l.overtimeItems.length
                ? l.overtimeItems.map((o) => `${o.label} ${formatNumber(o.hours, { decimals: 2 })} h ${o.basis === 'per_month' ? 'por mes' : 'por día'}`).join(', ') + (current.overtimeBilled === true ? ' (se facturan aparte)' : '')
                : 'sin horas extra',
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
            Array.isArray(line.overtime) ? 2 : 3,
            kit.num(`${p}.normalHoursPerMonth`, { label: 'Horas normales por mes', rule: 'hours', unit: 'h/mes', illustrative: illustrativeParam(line, 'normalHoursPerMonth') }),
            // Sin tramos: el campo único de siempre (horas por día + un recargo).
            Array.isArray(line.overtime) ? null : kit.num(`${p}.overtimeHoursPerActiveDay`, { label: 'Horas extra por día activo', rule: 'hoursPerDay', unit: 'h/día', illustrative }),
            kit.num(`${p}.overtimePremiumPct`, { label: Array.isArray(line.overtime) ? 'Recargo de convenio (referencia)' : 'Recargo de horas extra', rule: 'percentOpen', unit: '%', illustrative: illustrativeParam(line, 'overtimePremiumPct'), hint: Array.isArray(line.overtime) ? 'Se usa al aplicar el convenio; cada tramo tiene su recargo.' : null }),
          ),
          overtimeEditor(i, line),
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
            kit.stat('Fijo mensual total', (r) => formatMoney(at(r) && at(r).fixedMonthly), { emphasis: true, hint: (r) => (at(r) && at(r).shared && !at(r).shareMissing ? `${formatPercent(at(r).fixedCostSharePct)} asignado a esta cotización (persona compartida).` : '') }),
            kit.stat('Variable por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: 'Horas extra por día con cargas + vianda.' }),
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
          Math.abs(headcount - positions) > 1e-6
            ? `${formatNumber(headcount, { decimals: 2 })} ${plural(headcount, 'persona', 'personas')} en nómina, ${formatNumber(positions, { decimals: 2 })} trabajando a la vez`
            : `${formatNumber(headcount, { decimals: 2 })} ${plural(headcount, 'persona', 'personas')}`,
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
    card({ title: '¿Cuántas personas lleva el servicio?', subtitle: 'Cargá cada rol (operario, chofer, supervisor) con cuántas personas van y su sueldo. Son personas de tu nómina asignadas a este servicio.' }, toolbar),
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
