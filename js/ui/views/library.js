/**
 * Recursos reutilizables: Personal, Convenios (con sus aumentos), Equipos,
 * Materiales y Ubicaciones (#/recursos/:tab). CRUD con diálogos; los cálculos (costo
 * por persona, ficha de equipo, costo de material) vienen de los servicios /
 * motores.
 *
 * Los valores de las cotizaciones se COPIAN desde los recursos: editar o
 * borrar un recurso no cambia cotizaciones existentes.
 *
 * Personal, Equipos y Materiales tienen vista Simple (nombre, costo por día /
 * hora y por mes, Editar) y Detallada (la tabla completa). La elección se
 * recuerda sólo en memoria mientras se usa la aplicación.
 */

import { h, mount, uniqueId } from '../dom.js';
import {
  badge,
  banner,
  button,
  card,
  checkboxField,
  confirmDialog,
  dateField,
  disclosure,
  emptyState,
  formGrid,
  kpi,
  numberField,
  openDialog,
  periodField,
  selectField,
  table,
  textField,
  traceButton,
  triStateField,
} from '../components.js';
import { createTrace } from '../../core/trace.js';
import { createId } from '../../core/ids.js';
import { formatMoney, formatMoneyIn, formatNumber, formatPercent, formatPeriod, formatValue, formatDayDate, EMPTY } from '../../core/format.js';
import { isFiniteNumber, toNumber } from '../../core/money.js';
import { deepClone, getPath, setPath } from '../../core/object.js';
import { sanitizeText } from '../../core/validation.js';
import { AGREEMENT_TYPES, AGREEMENT_TYPES_SORTED, ILLUSTRATIVE_AGREEMENT_PARAMS, MATERIAL_BASES, MATERIAL_PROVIDERS, ACQUISITION_MODES, EXTERNAL_UNITS, EXTERNAL_TRIP_BASES, EXTERNAL_FUEL_MODES, VAT_RECOVERY, MAINTENANCE_MODES, BUDGET_PERIODS, TIRE_MODES, QUOTE_STATUSES, externalUnitShort, labelOf, vatIsCost } from '../../domain/catalogs.js';
import { conversionFactor, currencyOfBase } from '../../engines/currency-engine.js';
import { maintenanceOf } from '../../engines/equipment-engine.js';
import { wearNote } from '../equipment-wear-ui.js';
import { EQUIPMENT_FAMILIES, familyById, familyIdOf, familyVariants, isVehicleFamily, modelLabel, suggestedMobility } from '../../domain/equipment-catalog.js';
import { emptyBase } from '../../domain/economic-base.js';
import { createExternalTerms, createEquipmentMobility, acquisitionOf } from '../../domain/quote-factory.js';
import { externalFiscal } from '../../engines/external-engine.js';
import { baseTag, baseFormFields } from '../economic-base-ui.js';
import { BILLABLE_HOURS_LABEL, BILLABLE_HOURS_HINT, BILLABLE_OVER_NORMAL_NOTE } from '../result-text.js';
import { CURRENCY } from '../../config.js';
import { laborLoadFactor } from '../../engines/labor-engine.js';
import { computeMaterialLine } from '../../engines/materials-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { render as renderNotFound } from './not-found.js';
import { resourceUsage } from '../../domain/resource-usage.js';
import { activationTerms, activationFieldLabels } from '../../domain/activation-terms.js';
import { agreementParamsOf, applyAgreementRaise, ownParamKeys, profilesToPropagate, undoLastAgreementRaise, withAgreementParams } from '../../domain/agreement-raises.js';

// ----------------------------------------------------------------- catálogo

const TABS = Object.freeze([
  {
    id: 'personal',
    label: 'Personal',
    type: 'laborProfiles',
    addLabel: 'Agregar puesto',
    icon: 'resources',
    intro: 'Cada puesto con su convenio y su sueldo, como en el recibo.',
    emptyTitle: 'Todavía no agregaste personal.',
    emptyText: 'Cargá cada puesto una vez (sueldo, convenio y cargas) y reutilizalo en tus cotizaciones.',
  },
  {
    id: 'convenios',
    label: 'Convenios',
    type: 'agreements',
    addLabel: 'Nuevo convenio',
    icon: 'library',
    intro: 'Cada convenio define las cargas sociales de sus puestos. Con "Aplicar aumento" subís los sueldos de todos de una vez.',
    emptyTitle: 'Todavía no cargaste convenios.',
    emptyText: 'Elegí tu convenio (Petroleros, UOCRA, Camioneros, Comercio…), cargá sus porcentajes y asignalo a tus puestos.',
  },
  {
    id: 'equipos',
    label: 'Equipos',
    type: 'equipment',
    addLabel: 'Agregar equipo',
    icon: 'services',
    intro: 'Mis equipos: las unidades reales de tu empresa (interno, modelo, valor, base y movilidad). En las propias, RATEOS separa lo que cuesta tenerlas (COSTO DE POSESIÓN, aunque no trabajen) de lo que cuesta usarlas (COSTO DE OPERACIÓN).',
    emptyTitle: 'Todavía no agregaste equipos.',
    emptyText: 'Guardá tus equipos una vez y reutilizalos en futuras cotizaciones.',
  },
  {
    id: 'externos',
    label: 'Servicios externos',
    type: 'externalServices',
    addLabel: 'Agregar servicio externo',
    icon: 'services',
    intro: 'Equipos alquilados y servicios tercerizados que contratás a proveedores (grúa con operador, carretón, camión alquilado…): tarifa neta, qué incluye, vigencia y tratamiento fiscal. No son activos propios.',
    emptyTitle: 'Todavía no cargaste servicios externos.',
    emptyText: 'Guardá las tarifas de tus proveedores una vez y usalas en tus cotizaciones (cada una guarda una foto del precio).',
  },
  {
    id: 'materiales',
    label: 'Materiales',
    type: 'materials',
    addLabel: 'Agregar material',
    icon: 'quote',
    intro: 'Materiales e insumos con merma, logística y quién los provee.',
    emptyTitle: 'Todavía no agregaste materiales.',
    emptyText: 'Guardá los materiales e insumos que usás seguido y reutilizalos en tus cotizaciones.',
  },
  {
    id: 'ubicaciones',
    label: 'Ubicaciones',
    type: 'locations',
    addLabel: 'Agregar ubicación',
    icon: 'home',
    intro: 'Tu base operativa y los destinos frecuentes, con la distancia desde la base.',
    emptyTitle: 'Todavía no agregaste ubicaciones.',
    emptyText: 'Guardá tu base y los destinos frecuentes con su distancia para calcular los viajes más rápido.',
  },
  {
    id: 'catalogo',
    label: 'Catálogo de equipos',
    type: 'equipmentModels',
    addLabel: 'Agregar modelo',
    icon: 'library',
    intro: 'Qué tipos y modelos de equipo existen (familia, marca, modelo, año). Es descriptivo: los valores económicos son de cada unidad en "Equipos". Los modelos que agregás son privados de tu empresa.',
    emptyTitle: 'Todavía no agregaste modelos.',
    emptyText: 'No hace falta cargar todos los equipos del mundo: agregá los modelos de tus unidades cuando los necesites.',
  },
]);

/** Pestañas visibles en Recursos (#/recursos/:tab). Convenios volvió a Recursos (0.12.0). */
export const RESOURCE_TAB_IDS = Object.freeze(['personal', 'convenios', 'equipos', 'externos', 'materiales', 'ubicaciones', 'catalogo']);

const LOCATION_TYPES = Object.freeze([
  { id: 'base', label: 'Base operativa' },
  { id: 'destination', label: 'Destino / locación' },
]);

// Recursos no tienen tipo de servicio: la activación se nombra "intervención" (PLAN-2026-014).
const BASIS_SUFFIX = Object.freeze({ per_month: '/mes', per_active_day: '/día de trabajo', per_activation: `/${activationTerms().one}` });
const RESOURCE_LABELS = activationFieldLabels(activationTerms());

/** Pestañas con vista Simple / Detallada (Ubicaciones ya es una tabla corta). */
const VIEW_TABS = Object.freeze(['laborProfiles', 'equipment', 'materials']);

/** Vista elegida (simple | detailed), sólo en memoria: se mantiene al cambiar de pestaña. */
let resourceView = 'simple';

const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);

/** Convención de montos de RATEOS (PLAN-2026-002, PN1): todo sin IVA. */
const VAT_HINT = 'Montos sin IVA: si tu proveedor te pasa un precio con IVA, descontalo antes de cargarlo.';
const ILLUSTRATIVE_AGREEMENT_NOTICE = 'Parámetros GENÉRICOS e ILUSTRATIVOS, no son valores de ningún CCT; cargá los vigentes.';

/** Mes actual 'AAAA-MM' (hora local). */
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const options = (list) => list.map((o) => ({ value: o.id ?? o.code, label: o.label }));

// ------------------------------------------------------------- celdas comunes

function nameCell(main, sub, illustrative) {
  const same = sub && main && String(sub).trim().toLowerCase() === String(main).trim().toLowerCase();
  return h(
    'div',
    { class: 'cell-main' },
    h('span', { class: 'cell-title' }, main || 'Sin nombre'),
    illustrative ? illustrativeTag() : null,
    sub && !same ? h('span', { class: 'cell-sub' }, sub) : null,
  );
}

function rowActions({ name, onEdit, onDelete }) {
  return h(
    'div',
    { class: 'table-actions' },
    button('Editar', { variant: 'secondary', size: 'sm', icon: 'edit', onClick: onEdit, attrs: { 'aria-label': `Editar ${name}` } }),
    button('', { variant: 'danger', size: 'sm', icon: 'trash', title: 'Eliminar', onClick: onDelete, attrs: { 'aria-label': `Eliminar ${name}` } }),
  );
}

/** Resultado + "Ver cálculo" debajo (la traza queda junto al número que explica). */
const withTrace = (node, trace) => h('div', { class: 'cell-result' }, node, traceButton(trace));
const money = (v) => h('span', { class: 'nowrap' }, formatMoney(v));
const rate = (v) => h('span', { class: 'nowrap' }, formatValue(v, 'rate'));
const percent = (v) => formatPercent(v);
const factorText = (f) => (isFiniteNumber(f) ? `× ${formatNumber(f, { decimals: 4, minDecimals: 2 })}` : EMPTY);

// ------------------------------------------------------------------ trazas

function laborTrace(profile, cost) {
  const p = cost.perPerson;
  return createTrace({
    id: 'labor_profile_cost',
    title: `Costo de personal — ${profile.role || 'perfil'}`,
    formula: 'Costo mensual por persona = Remunerativo × Factor de cargas + No remunerativo × (1 + Cargas sobre el no remunerativo %) + Contribuciones fijas del convenio + Seguros + EPP + Capacitación + Traslado · Factor de cargas = (1 + SAC % + Vacaciones %) × (1 + Cargas patronales % + ART %)',
    inputs: [
      { label: 'Remunerativo mensual', value: p.basic, format: 'money' },
      p.additionals > 0 ? { label: 'Otros pagos remunerativos (cargados antes)', value: p.additionals, format: 'money' } : null,
      { label: 'No remunerativo mensual', value: p.nonRemunerativePay, format: 'money' },
      { label: 'Contribuciones fijas del convenio', value: p.fixedContributions, format: 'money' },
      { label: 'SAC', value: toNumber(profile.sacPct), format: 'percent' },
      { label: 'Vacaciones', value: toNumber(profile.vacationPct), format: 'percent' },
      { label: 'Cargas patronales', value: toNumber(profile.employerContributionsPct), format: 'percent' },
      { label: 'ART', value: toNumber(profile.artPct), format: 'percent' },
      { label: 'Seguros', value: p.insurance, format: 'money' },
      { label: 'EPP', value: p.ppe, format: 'money' },
      { label: 'Capacitación', value: p.training, format: 'money' },
      { label: 'Traslado', value: p.transfer, format: 'money' },
      { label: 'Horas normales por mes', value: toNumber(profile.normalHoursPerMonth), format: 'hours' },
    ],
    steps: [
      { label: 'Remunerativo', value: p.remunerative, format: 'money' },
      { label: 'SAC', value: p.sac, format: 'money' },
      { label: 'Vacaciones', value: p.vacation, format: 'money' },
      { label: 'Cargas patronales', value: p.employerContributions, format: 'money' },
      { label: 'ART', value: p.art, format: 'money' },
      { label: 'Remunerativo cargado', value: p.loadedRemunerative, format: 'money' },
      { label: 'Cargas sobre el no remunerativo', value: p.nonRemunerativeCharges, format: 'money' },
      { label: 'Otras cargas y provisiones del convenio', value: p.otherCharges, format: 'money' },
      { label: 'Fuera del factor de cargas (no remunerativo y sus cargas, contribuciones fijas, otras cargas, seguros, EPP, capacitación, traslado)', value: p.nonRemunerative, format: 'money' },
      { label: 'Factor de cargas', value: p.loadFactor, format: 'number' },
      { label: 'Costo hora cargado (costo mensual / horas normales)', value: p.loadedHourlyCost, format: 'rate' },
      { label: 'Variable por día de trabajo (horas extra cargadas + vianda)', value: cost.perPosition.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Costo mensual por persona', value: p.fixedMonthly, format: 'money' },
    notes: [
      `Bruto ${formatMoney(p.grossMonthly)} − aportes del trabajador ${formatMoney(p.workerContributions)} (${formatPercent(p.workerContributionsPct)} del remunerativo) = neto ${formatMoney(p.netMonthly)}. Los aportes los paga el trabajador de su bruto: no cambian el costo de la empresa.`,
      'La vianda y las horas extra no forman parte del costo mensual fijo: dentro de la cotización se suman por cada día de trabajo.',
      profile.illustrative ? 'Perfil con valores ILUSTRATIVOS: reemplazalos por los de tu convenio vigente.' : null,
    ],
  });
}

function agreementTrace(agreement) {
  const p = agreement.params || {};
  const a = 1 + toNumber(p.sacPct) / 100 + toNumber(p.vacationPct) / 100;
  const b = 1 + toNumber(p.employerContributionsPct) / 100 + toNumber(p.artPct) / 100;
  return createTrace({
    id: 'agreement_load_factor',
    title: `Factor de cargas — ${agreement.name || 'convenio'}`,
    formula: 'Factor de cargas = (1 + SAC % + Vacaciones %) × (1 + Cargas patronales % + ART %)',
    inputs: [
      { label: 'SAC', value: toNumber(p.sacPct), format: 'percent' },
      { label: 'Vacaciones', value: toNumber(p.vacationPct), format: 'percent' },
      { label: 'Cargas patronales', value: toNumber(p.employerContributionsPct), format: 'percent' },
      { label: 'ART', value: toNumber(p.artPct), format: 'percent' },
    ],
    steps: [
      { label: '1 + SAC + Vacaciones', value: a, format: 'number' },
      { label: '1 + Cargas patronales + ART', value: b, format: 'number' },
    ],
    result: { label: 'Factor de cargas', value: laborLoadFactor(p), format: 'number' },
    notes: ['Multiplica la remuneración (básico + adicionales) para obtener el costo cargado.', agreement.illustrative ? ILLUSTRATIVE_AGREEMENT_NOTICE : null],
  });
}

function equipmentTrace(eq, c) {
  const o = c.ownership;
  const op = c.operation;
  const cap = c.capacity;
  const r = c.rates;
  return createTrace({
    id: 'equipment_card',
    title: `Costo de equipo — ${eq.name || 'equipo'}`,
    formula:
      'Posesión/mes = amortización + seguro + patente + certificaciones + otros + mantenimiento fijo (presupuesto) + costo de capital · Operación/h = mantenimiento/h + neumáticos/h + litros/h × precio combustible (service = costo / horas entre services; juego = costo / vida útil en horas) · $/mes = posesión + operación/h × horas usadas · $/hora = $/mes / horas usadas · $/día = $/mes / días usados',
    inputs: [
      { label: 'Valor de reposición', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil', value: o.lifeYears, format: 'number', unit: 'años' },
      { label: 'Seguro anual', value: o.insuranceMonthly * 12, format: 'money' },
      { label: 'Patente anual', value: o.licenseMonthly * 12, format: 'money' },
      { label: 'Certificaciones anuales', value: o.certificationsMonthly * 12, format: 'money' },
      { label: 'Costo de capital (anual)', value: toNumber(eq.capitalRatePctAnnual), format: 'percent' },
      { label: `Mantenimiento por hora (${labelOf(MAINTENANCE_MODES, op.maintenanceMode, 'por hora').toLowerCase()})`, value: op.maintenancePerHour, format: 'rate' },
      o.maintenanceFixedMonthly > 0 ? { label: 'Mantenimiento fijo por mes (presupuesto)', value: o.maintenanceFixedMonthly, format: 'money' } : null,
      { label: `Neumáticos por hora (${labelOf(TIRE_MODES, op.tiresMode, 'por hora').toLowerCase()})`, value: op.tiresPerHour, format: 'rate' },
      op.tiresPerKm > 0 ? { label: 'Neumáticos por km (se suman en la ruta)', value: op.tiresPerKm, format: 'rate' } : null,
      op.fuelNotApplicable
        ? { label: 'Combustible', value: 'No usa combustible', format: 'text' }
        : { label: 'Consumo de combustible', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      op.fuelNotApplicable ? null : { label: 'Precio del combustible (Configuración)', value: op.fuelPricePerLiter, format: 'rate' },
      { label: 'Horas disponibles por mes', value: cap.availableHoursPerMonth, format: 'hours' },
      { label: 'Días disponibles por mes', value: cap.availableDaysPerMonth, format: 'number', unit: 'días' },
      { label: 'Utilización esperada', value: cap.utilizationPct, format: 'percent' },
    ],
    steps: [
      { label: 'Amortización mensual', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones + otros + mantenimiento fijo (mensual)', value: o.cashMonthly, format: 'money' },
      { label: 'Costo de capital mensual', value: o.capitalCostMonthly, format: 'money' },
      { label: 'COSTO DE POSESIÓN mensual', value: o.totalMonthly, format: 'money' },
      { label: 'COSTO DE OPERACIÓN por hora', value: op.totalPerHour, format: 'rate' },
      { label: 'Horas usadas por mes', value: cap.usedHoursPerMonth, format: 'hours' },
      { label: 'Días usados por mes', value: cap.usedDaysPerMonth, format: 'number', unit: 'días' },
      { label: 'Operación mensual', value: r.operationMonthly, format: 'money' },
      { label: '$/hora usada', value: r.costPerUsedHour, format: 'rate' },
      { label: '$/día usado', value: r.costPerUsedDay, format: 'money' },
    ],
    result: { label: 'Costo mensual a la utilización configurada', value: r.costPerMonth, format: 'money' },
    notes: [
      'La amortización y el costo de capital no son salidas de caja mensuales, pero sí son costo: el equipo se desgasta y la plata invertida tiene un costo.',
      'Con menos utilización, el costo de posesión se reparte en menos horas y sube el $/hora.',
    ],
  });
}

function materialTrace(m, c) {
  const basis = labelOf(MATERIAL_BASES, c.basis).toLowerCase();
  return createTrace({
    id: 'material_cost',
    title: `Costo de material — ${m.description || 'material'}`,
    formula: 'Costo = cantidad × costo unitario × (1 + merma %) × (1 + logística %) · Si lo provee el cliente, el costo para nosotros es 0 · Precio de reventa (informativo) = costo × (1 + markup de reventa %)',
    inputs: [
      { label: 'Cantidad', value: c.quantity, format: 'number', unit: m.unit || '' },
      { label: 'Costo unitario', value: c.unitCost, format: 'money' },
      { label: 'Merma', value: toNumber(m.wastePct), format: 'percent' },
      { label: 'Logística', value: toNumber(m.logisticsPct), format: 'percent' },
      { label: 'Quién lo provee', value: labelOf(MATERIAL_PROVIDERS, m.providedBy, 'Sin definir'), format: 'text' },
    ],
    steps: [
      { label: 'Costo bruto', value: c.grossCost, format: 'money' },
      { label: 'Markup de reventa (sobre costo)', value: toNumber(m.resaleMarkupPct), format: 'percent' },
      { label: 'Precio de reventa (informativo)', value: c.resalePrice, format: 'money' },
    ],
    result: { label: `Costo para nosotros (${basis})`, value: c.costForUs, format: 'money' },
    notes: ['El markup de reventa es sobre el costo y no es margen: sólo informa a cuánto se revende el material.'],
  });
}

// --------------------------------------------------------- externos (resumen)

/** "Operador, combustible y movilización" incluidos (o lo que falte definir). */
function includesText(ext = {}) {
  const x = ext || {};
  const parts = [
    ['operador', x.operatorIncluded],
    ['combustible', x.fuelIncluded],
    ['movilización', x.mobilizationIncluded],
    ['seguros', x.insuranceIncluded],
  ];
  const yes = parts.filter(([, v]) => v === true).map(([n]) => n);
  const unknown = parts.filter(([, v]) => v !== true && v !== false).map(([n]) => n);
  return h('span', { class: 'cell-main' }, yes.length ? `Incluye ${yes.join(', ')}` : 'Sin inclusiones', unknown.length ? h('span', { class: 'cell-sub' }, `Sin definir: ${unknown.join(', ')}`) : null);
}

/** IVA recuperable / no recuperable / sin definir. */
function fiscalBadge(ext = {}) {
  const f = externalFiscal((ext || {}).fiscal);
  if (f.recovery === null) return badge('Sin definir', 'orange', { title: 'Sin definir si el IVA es recuperable: el costo usa el precio neto.' });
  if (f.missingVatRate || f.missingPartialPct) return badge('Falta alícuota', 'red');
  return badge(labelOf(VAT_RECOVERY, f.recovery).replace(/ \(.*\)$/, ''), f.recovery === 'yes' ? 'green' : 'orange');
}

/** Vista previa de una tarifa externa: costo económico vs salida de caja por unidad. */
function externalPreview(draft) {
  const x = draft.external || {};
  const f = externalFiscal(x.fiscal);
  const price = toNumber(x.price, 0);
  const cur = draft.base && draft.base.currency;
  const unit = externalUnitShort(x);
  return previewKpis([
    { label: `Costo económico ${unit}`, value: formatMoneyIn(price * f.economicFactor, cur), emphasis: true, hint: 'Neto + IVA no recuperable + cargos no recuperables' },
    { label: `Salida de caja ${unit}`, value: f.vatDefined ? formatMoneyIn(price * f.cashFactor, cur) : 'IVA sin cargar', hint: 'Neto + IVA + percepciones + cargos' },
    { label: `Crédito fiscal ${unit}`, value: f.vatDefined || f.perceptionsPct ? formatMoneyIn(price * f.creditFactor, cur) : EMPTY, hint: 'No es costo: caja que se recupera' },
  ]);
}

// ---------------------------------------------------------- formulario genérico

function isBlankValue(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Formulario de recurso en un diálogo.
 * sections: [{ title, hint?, cols?, fields: [field], extra?: ({ draft, rerender }) => Node }]
 * field: { key, label, kind: 'number'|'text'|'textarea'|'select'|'checkbox', rule?, unit?, hint?, required?, options?, includeEmpty?, emptyLabel?, maxLength?, rerender? }
 */
function openResourceForm(app, { title, initial, sections, preview = null, validate = null, prepare = null, onSave }) {
  const draft = deepClone(initial);
  const body = h('div', { class: 'resource-form' });
  const previewHost = preview ? h('div', { class: 'form-preview', 'aria-live': 'polite' }) : null;
  // Secciones fijas o según el borrador (p. ej. propio vs alquilado); `when` las muestra u oculta.
  const sectionsNow = () => (typeof sections === 'function' ? sections(draft) : sections).filter((sec) => sec && (typeof sec.when !== 'function' || sec.when(draft)));
  const fieldsNow = () => sectionsNow().flatMap((sec) => sec.fields.filter(Boolean).filter((f) => typeof f.when !== 'function' || f.when(draft)));
  const openSections = new Set();
  // Bloques "en vivo" de una sección (se vuelven a dibujar con cada cambio, como la vista previa).
  let liveHosts = [];
  let previewSeq = 0;

  const updateLive = () => {
    liveHosts.forEach(({ host, fn }) => {
      try {
        mount(host, fn(draft));
      } catch {
        mount(host, null);
      }
    });
  };

  const updatePreview = () => {
    updateLive();
    if (!preview) return;
    previewSeq += 1;
    const seq = previewSeq;
    Promise.resolve(preview(draft))
      .then((node) => {
        if (seq === previewSeq) mount(previewHost, node);
      })
      .catch(() => mount(previewHost, h('p', { class: 'muted small' }, 'No se pudo calcular la vista previa.')));
  };

  const buildField = (field) => {
    const value = getPath(draft, field.key);
    const set = (v) => {
      setPath(draft, field.key, v);
      if (field.rerender) rerender();
      else updatePreview();
    };
    switch (field.kind) {
      case 'text':
        return textField({ label: field.label, value: value ?? '', required: field.required, hint: field.hint, maxLength: field.maxLength || 120, placeholder: field.placeholder || '', name: field.name || null, onChange: set });
      case 'textarea':
        return textField({ label: field.label, value: value ?? '', hint: field.hint, maxLength: field.maxLength || 600, multiline: true, onChange: set });
      case 'select': {
        const opts = typeof field.options === 'function' ? field.options(draft) : field.options;
        // Sin opción vacía, un valor ausente o desconocido toma la primera opción (lo que se ve es lo que se guarda).
        if (!field.includeEmpty && opts.length && !opts.some((o) => String(o.value) === String(value ?? ''))) setPath(draft, field.key, opts[0].value);
        if (field.includeEmpty && !isBlankValue(value) && !opts.some((o) => String(o.value) === String(value))) setPath(draft, field.key, null);
        return selectField({ label: field.label, value: getPath(draft, field.key) ?? '', options: opts, includeEmpty: field.includeEmpty, emptyLabel: field.emptyLabel, hint: typeof field.hint === 'function' ? field.hint(draft) : field.hint, onChange: set });
      }
      case 'checkbox':
        return checkboxField({ label: field.label, checked: Boolean(value), hint: field.hint, onChange: set });
      case 'period':
        return periodField({ label: field.label, value: typeof value === 'string' ? value : null, hint: field.hint, onChange: set });
      case 'date':
        return dateField({ label: field.label, value: typeof value === 'string' ? value : null, hint: field.hint, onChange: set });
      case 'tristate':
        return triStateField({ label: field.label, value: typeof value === 'boolean' ? value : null, hint: field.hint, yesLabel: field.yesLabel, noLabel: field.noLabel, onChange: set });
      default: {
        const unit = typeof field.unit === 'function' ? field.unit(draft) : field.unit;
        return numberField({ label: field.label, value: isFiniteNumber(value) ? value : null, rule: field.rule || 'money', unit: unit || null, hint: field.hint, required: field.required, placeholder: field.placeholder || (field.nullable ? 'Sin definir' : ''), onChange: set });
      }
    }
  };

  function sectionNode(section, index) {
    const fields = section.fields.filter(Boolean).filter((f) => typeof f.when !== 'function' || f.when(draft));
    let liveHost = null;
    if (typeof section.live === 'function') {
      liveHost = h('div', { class: 'form-section-live', 'aria-live': 'polite' });
      liveHosts.push({ host: liveHost, fn: section.live });
    }
    const content = [
      section.hint ? h('p', { class: 'form-section-hint' }, section.hint) : null,
      fields.length ? formGrid(section.cols || 3, ...fields.map(buildField)) : null,
      liveHost,
      section.extra ? section.extra({ draft, rerender }) : null,
    ];
    if (!section.collapsible) {
      return h('fieldset', { class: 'form-section' }, h('legend', {}, section.title), ...content);
    }
    // Opciones avanzadas: cerradas, con un resumen VISIBLE de lo que hay adentro.
    const key = section.key || `s${index}`;
    const summary = typeof section.summary === 'function' ? section.summary(draft) : section.summary;
    return disclosure(
      { summary: section.title, hint: summary || null, open: openSections.has(key), className: 'form-section-collapsible', onToggle: (isOpen) => (isOpen ? openSections.add(key) : openSections.delete(key)) },
      h('div', { class: 'form-section' }, ...content),
    );
  }

  // Secciones plegables que arrancan abiertas según el dato guardado (`openWhen`), sólo al abrir el formulario.
  let seededOpen = false;
  function rerender() {
    if (typeof prepare === 'function') prepare(draft);
    if (!seededOpen) {
      seededOpen = true;
      sectionsNow().forEach((sec, idx) => {
        if (sec.collapsible && typeof sec.openWhen === 'function' && sec.openWhen(draft)) openSections.add(sec.key || `s${idx}`);
      });
    }
    liveHosts = [];
    mount(
      body,
      draft.illustrative ? banner('Este ítem tiene valores ILUSTRATIVOS de demostración. Reemplazalos por valores propios vigentes y desmarcá "Valores ilustrativos".', 'warning') : null,
      ...sectionsNow().map(sectionNode),
      previewHost,
    );
    updatePreview();
  }

  rerender();
  const saveBtn = button('Guardar', { variant: 'primary', icon: 'check' });
  const { close } = openDialog({ title, content: body, wide: true, actions: [button('Cancelar', { variant: 'secondary', onClick: () => close() }), saveBtn] });

  saveBtn.addEventListener('click', async () => {
    const invalid = body.querySelector('[aria-invalid="true"]');
    if (invalid) {
      app.toast('Revisá los campos marcados en rojo.', 'warning');
      invalid.focus();
      return;
    }
    const allFields = fieldsNow();
    const missing = allFields.filter((f) => f.required && isBlankValue(f.kind === 'text' ? sanitizeText(getPath(draft, f.key)) : getPath(draft, f.key)));
    if (missing.length) {
      app.toast(`Completá: ${missing.map((f) => f.label).join(', ')}.`, 'warning');
      return;
    }
    const problem = validate ? validate(draft) : null;
    if (problem) {
      app.toast(problem, 'warning');
      return;
    }
    // Normalización: textos saneados y números vacíos como 0.
    const entity = deepClone(draft);
    allFields.forEach((f) => {
      const v = getPath(entity, f.key);
      if (f.kind === 'text') setPath(entity, f.key, sanitizeText(v, f.maxLength || 120));
      else if (f.kind === 'textarea') setPath(entity, f.key, sanitizeText(v, f.maxLength || 600));
      else if (f.kind === 'checkbox') setPath(entity, f.key, Boolean(v));
      else if (f.kind === 'period' || f.kind === 'date') setPath(entity, f.key, typeof v === 'string' && v ? v : null);
      else if (f.kind === 'tristate') setPath(entity, f.key, typeof v === 'boolean' ? v : null);
      // Números opcionales ("sin definir" = null, p. ej. una alícuota que no se cargó): no se convierten en 0.
      else if (f.kind === 'number' || !f.kind) setPath(entity, f.key, isFiniteNumber(v) ? v : f.nullable ? null : 0);
    });
    saveBtn.disabled = true;
    try {
      await onSave(entity);
      close();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo guardar.'), 'danger');
      saveBtn.disabled = false;
    }
  });
}

function previewKpis(items, trace) {
  return h('div', { class: 'preview-box' }, h('div', { class: 'preview-title' }, 'Vista previa del cálculo'), h('div', { class: 'kpi-grid preview-kpis' }, ...items.map((i) => kpi(i))), trace ? traceButton(trace) : null);
}

const illustrativeField = { key: 'illustrative', label: 'Valores ilustrativos (de ejemplo, no vigentes)', kind: 'checkbox', rerender: true, hint: 'Desmarcalo cuando cargues valores propios y vigentes.' };

// --------------------------------------------------------------- definición de pestañas

/** Prefijo del valor de un convenio del catálogo que la empresa todavía no cargó (0.15.0). */
const CATALOG_AGREEMENT = 'catalog:';

/**
 * Convenios para elegir en un puesto (0.15.0, pedido de Joaco 2026-11-19): los que la empresa ya
 * cargó y, además, los del catálogo que todavía no tiene (Comercio, UOCRA, Petroleros…). Elegir
 * uno del catálogo lo crea al guardar el puesto, con porcentajes de EJEMPLO marcados ilustrativos
 * (RATEOS no trae valores legales): se revisan en la pestaña Convenios.
 * @returns {object[]} convenios reales + los del catálogo como convenios "por crear" (`pending`)
 */
export function agreementChoices(agreements = []) {
  const own = Array.isArray(agreements) ? agreements : [];
  const loaded = new Set(own.map((a) => a.code).filter((code) => code && code !== 'personalizado'));
  const pending = AGREEMENT_TYPES_SORTED
    .filter((t) => t.code !== 'personalizado' && !loaded.has(t.code))
    .map((t) => ({ id: `${CATALOG_AGREEMENT}${t.code}`, code: t.code, name: t.label, params: { ...ILLUSTRATIVE_AGREEMENT_PARAMS }, notes: '', illustrative: true, pending: true }));
  return [...own, ...pending];
}

/** Convenio nuevo (sin id) a partir de uno "por crear" del catálogo. */
export function agreementFromChoice(choice) {
  return { code: choice.code, name: choice.name, params: { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(choice.params || {}) }, notes: '', illustrative: true };
}

function laborSections(agreements, app, { profileCost = null } = {}) {
  const agreementOptions = agreements.map((a) => ({ value: a.id, label: `${a.name || labelOf(AGREEMENT_TYPES, a.code, 'Convenio')}${a.pending ? ' (nuevo, con valores de ejemplo)' : ''}` }));
  const hasValue = (v) => isFiniteNumber(v) && v > 0;
  const agreementOf = (draft) => agreements.find((a) => a.id === draft.agreementId) || null;
  return [
    {
      title: 'Puesto',
      fields: [
        { key: 'role', label: 'Rol / puesto', kind: 'text', required: true, placeholder: 'Ej.: Técnico HSE, operario, chofer' },
        { key: 'agreementId', label: 'Convenio', kind: 'select', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio', rerender: true, hint: (d) => (String(d.agreementId || '').startsWith(CATALOG_AGREEMENT) ? 'Se agrega a tus Convenios al guardar, con porcentajes de ejemplo: revisalos ahí con los de tu convenio vigente.' : 'De él salen las cargas sociales y los aumentos.') },
        { key: 'category', label: 'Categoría', kind: 'text', placeholder: 'Según tu convenio' },
      ],
    },
    {
      // 0.12.0 (Joaco, 2026-11-18): remunerativo, no remunerativo y aportes, como en el recibo.
      title: 'Sueldo mensual por persona',
      hint: 'Copiá los totales del recibo. Las cargas las suma RATEOS.',
      cols: 4,
      fields: [
        { key: 'basicMonthly', label: 'Remunerativo', rule: 'money', unit: '$', required: true, hint: 'Básico, presentismo, antigüedad y adicionales remunerativos.' },
        { key: 'nonRemunerativeMonthly', label: 'No remunerativo', rule: 'money', unit: '$', hint: 'Viandas, asignaciones y sumas no remunerativas. Si no hay: 0.' },
        { key: 'additionalsMonthly', label: 'Otros pagos remunerativos (cargado antes)', rule: 'money', unit: '$', when: (d) => hasValue(d.additionalsMonthly), hint: 'Se suma al remunerativo.' },
        { key: 'workerContributionsPct', label: 'Aportes del trabajador', rule: 'percent', unit: '%', hint: 'Jubilación, ley 19.032 y obra social (17 % habitual). Sólo para ver el neto.' },
        { ...baseFormFields('base', { periodLabel: '¿De qué mes es este sueldo?' })[0], hint: 'Los aumentos del convenio lo actualizan solos.' },
      ],
      live: profileCost ? (draft) => {
        const p = profileCost(draft).perPerson;
        const cell = (label, value, note) => h('div', { class: 'hour-rate' }, h('span', { class: 'hour-rate-label' }, label), h('strong', { class: 'hour-rate-value' }, value > 0 ? formatMoney(value) : EMPTY), h('span', { class: 'hour-rate-note' }, note));
        return h('div', { class: 'hour-rates' },
          cell('Bruto', p.grossMonthly, 'Remun. + no remun.'),
          cell('Neto aproximado', p.netMonthly, 'Bruto − aportes (sin Ganancias)'),
          cell('Costo empleador del mes', p.payslipEmployerCost, 'Como en tu recibo'),
          cell('Te cuesta por mes', p.fixedMonthly, 'Con aguinaldo y vacaciones: el que usa la cotización'));
      } : null,
    },
    {
      title: 'Cargas sociales del convenio',
      collapsible: true,
      key: 'labor-charges',
      openWhen: (d) => ownParamKeys(d, agreementOf(d)).length > 0 || !agreementOf(d),
      summary: (draft) => {
        const agreement = agreementOf(draft);
        if (!agreement) return 'Sin convenio: cargá los porcentajes de este puesto.';
        const own = ownParamKeys(draft, agreement);
        if (agreement.pending) return `Porcentajes de ejemplo: cargá los de "${agreement.name}" acá o, después, en la pestaña Convenios.`;
        return own.length ? `Este puesto tiene valores propios (no sigue a "${agreement.name}").` : `Usa los de "${agreement.name}": si cambiás el convenio, este puesto se actualiza solo.`;
      },
      hint: 'Porcentajes sobre el remunerativo. Las contribuciones fijas son un monto por persona y por mes que fija el convenio (sin cargas encima).',
      cols: 4,
      fields: [
        { key: 'sacPct', label: 'Aguinaldo (SAC)', rule: 'percent', unit: '%' },
        { key: 'vacationPct', label: 'Vacaciones', rule: 'percent', unit: '%' },
        { key: 'employerContributionsPct', label: 'Cargas patronales', rule: 'percent', unit: '%' },
        { key: 'artPct', label: 'ART', rule: 'percent', unit: '%' },
        { key: 'fixedContributionsMonthly', label: 'Contribuciones fijas', rule: 'money', unit: '$/mes', hint: 'Ej.: contribución extraordinaria, seguro de vida colectivo.' },
        { key: 'nonRemunerativeChargesPct', label: 'Cargas sobre el no remunerativo', rule: 'percent', unit: '%', hint: 'Obra social, cuota sindical… Si no hay: 0.' },
        { key: 'otherChargesPct', label: 'Otras cargas y provisiones', rule: 'percent', unit: '%', hint: 'Sobre el remunerativo: fondo de cese laboral, provisión por despido, ausentismo, licencias… Si no hay: 0.' },
      ],
      extra: ({ draft, rerender }) => {
        const agreement = agreementOf(draft);
        if (!agreement || ownParamKeys(draft, agreement).length === 0) return null;
        return h(
          'div',
          { class: 'form-section-actions' },
          button('Volver a los valores del convenio', {
            variant: 'secondary',
            size: 'sm',
            icon: 'check',
            onClick: () => {
              Object.assign(draft, withAgreementParams(draft, agreement));
              if (agreement.illustrative) draft.illustrative = true;
              rerender();
              app.toast(`Este puesto vuelve a usar los valores de "${agreement.name}".`, 'info');
            },
          }),
        );
      },
    },
    {
      // PLAN-2026-026: el valor de la hora (normal, al 50 % y al 100 %) es de cada recurso.
      title: 'Valor de la hora (normal, para cotizar, al 50 % y al 100 %)',
      hint: 'Lo que te cuesta una hora de esta persona, con cargas. RATEOS lo calcula con el sueldo; si tu convenio paga otro valor, escribilo y se usa ése. Lo habitual: al 50 % los días de semana después del horario y el sábado a la mañana; al 100 % el sábado a la tarde, domingos y feriados (depende de cada convenio).',
      cols: 3,
      fields: [
        { key: 'normalHoursPerMonth', label: 'Horas normales por mes', rule: 'hours', unit: 'h', hint: 'Las horas que trabaja en un mes normal (por ejemplo 176 = 8 h × 22 días). Con esto sale el valor de la hora.' },
        // Horas que de verdad le cobra a clientes por mes (2026-11-18, M7): con ellas sale la hora para cotizar trabajos (tiempo usado).
        { key: 'billableHoursPerMonth', label: BILLABLE_HOURS_LABEL, rule: 'hours', unit: 'h', nullable: true, placeholder: 'Igual a las normales', hint: BILLABLE_HOURS_HINT },
        { key: 'overtimeRate50', label: 'Hora al 50 % (opcional)', rule: 'money', unit: '$/h', nullable: true, placeholder: 'Se calcula sola', hint: 'Vacío = la calculada (abajo).' },
        { key: 'overtimeRate100', label: 'Hora al 100 % (opcional)', rule: 'money', unit: '$/h', nullable: true, placeholder: 'Se calcula sola', hint: 'Vacío = la calculada (abajo).' },
      ],
      live: profileCost ? (draft) => {
        const p = profileCost(draft).perPerson;
        const cell = (label, value, note) => h('div', { class: 'hour-rate' }, h('span', { class: 'hour-rate-label' }, label), h('strong', { class: 'hour-rate-value' }, value > 0 ? formatMoney(value) : EMPTY), h('span', { class: 'hour-rate-note' }, note));
        // Un valor propio más bajo que la hora normal casi siempre es la hora "de bolsillo" del convenio, sin cargas.
        const low = (own, value) => own && p.loadedHourlyCost > 0 && value < p.loadedHourlyCost - 0.005;
        const note = (own, value, calc) => (low(own, value) ? 'Ojo: es menor que la hora normal. Cargá el costo con cargas sociales, no la hora del recibo.' : own ? 'Valor que cargaste' : calc);
        // M7: más horas para clientes que las normales abaratan la hora para cotizar (son horas extra).
        const over = p.ownBillableHours && p.billableHoursPerMonth > toNumber(draft.normalHoursPerMonth, 0) + 1e-9 && toNumber(draft.normalHoursPerMonth, 0) > 0;
        const rates = h('div', { class: 'hour-rates' },
          cell('Hora normal', p.loadedHourlyCost, 'Costo del mes ÷ horas normales'),
          cell('Hora al 50 %', p.overtimeHourlyCost50, note(p.overtimeRate50Own, p.overtimeHourlyCost50, 'Calculada: hora de sueldo × 1,5, con cargas')),
          cell('Hora al 100 %', p.overtimeHourlyCost100, note(p.overtimeRate100Own, p.overtimeHourlyCost100, 'Calculada: hora de sueldo × 2, con cargas')),
          // Hora para cotizar trabajos (tiempo usado): costo del mes ÷ horas que vende. Igual a la normal si no las cargó.
          cell('Hora para cotizar', p.ownBillableHours ? p.billableHourlyCost : p.loadedHourlyCost, p.ownBillableHours ? 'Costo del mes ÷ horas que le cobrás a clientes' : 'Igual a la hora normal (no cargaste horas para clientes)'));
        return over ? h('div', {}, rates, h('p', { class: 'hour-rates-warning', role: 'status' }, BILLABLE_OVER_NORMAL_NOTE)) : rates;
      } : null,
    },
    {
      title: 'Más detalle (opcional)',
      collapsible: true,
      key: 'labor-more',
      summary: (draft) => {
        const others = toNumber(draft.insuranceMonthly, 0) + toNumber(draft.ppeMonthly, 0) + toNumber(draft.trainingMonthly, 0) + toNumber(draft.transferMonthly, 0);
        const meal = toNumber(draft.mealPerActiveDay, 0);
        return `Seguros, ropa, capacitación y traslado: ${formatMoney(others)} por mes${meal > 0 ? ` · vianda ${formatMoney(meal)} por día` : ''}.`;
      },
      cols: 4,
      fields: [
        { key: 'mealPerActiveDay', label: 'Vianda o comida por día de trabajo', rule: 'money', unit: '$', hint: 'Sólo si no está en el no remunerativo. Se suma por cada día que trabaja.' },
        { key: 'insuranceMonthly', label: 'Seguros', rule: 'money', unit: '$/mes' },
        { key: 'ppeMonthly', label: 'Ropa y elementos de protección', rule: 'money', unit: '$/mes' },
        { key: 'trainingMonthly', label: 'Capacitación', rule: 'money', unit: '$/mes' },
        { key: 'transferMonthly', label: 'Traslado', rule: 'money', unit: '$/mes' },
        ...baseFormFields('base').slice(1),
        // Datos de perfiles anteriores: se ven sólo si ya estaban cargados (las cantidades van en la cotización).
        { key: 'overtimeHoursPerActiveDay', label: 'Horas extra por día de trabajo (cargado antes)', rule: 'hoursPerDay', unit: 'h', when: (d) => hasValue(d.overtimeHoursPerActiveDay), hint: 'Ya no se copian a las cotizaciones nuevas: las horas extra se eligen en cada cotización, en "Horas extra del trabajo" (paso "Cómo se cobra").' },
        { key: 'overtimePremiumPct', label: 'Recargo de esas horas extra', rule: 'percentOpen', unit: '%', when: (d) => hasValue(d.overtimeHoursPerActiveDay) },
        illustrativeField,
      ],
    },
  ];
}

function newLaborProfile(agreements) {
  // El primero que la empresa ya cargó (nunca uno del catálogo sin crear).
  const agreement = agreements.find((a) => !a.pending) || null;
  const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...((agreement && agreement.params) || {}) };
  return {
    role: '',
    agreementId: agreement ? agreement.id : null,
    category: '',
    basicMonthly: null,
    additionalsMonthly: 0,
    mealPerActiveDay: 0,
    normalHoursPerMonth: params.normalHoursPerMonth,
    overtimeHoursPerActiveDay: 0,
    overtimePremiumPct: params.overtimePremiumPct,
    overtimeRate50: null,
    overtimeRate100: null,
    billableHoursPerMonth: null,
    sacPct: params.sacPct,
    vacationPct: params.vacationPct,
    employerContributionsPct: params.employerContributionsPct,
    artPct: params.artPct,
    // 0.12.0: no remunerativo, aportes del trabajador y contribuciones fijas (estos dos, del convenio).
    nonRemunerativeMonthly: 0,
    nonRemunerativeChargesPct: params.nonRemunerativeChargesPct,
    otherChargesPct: params.otherChargesPct,
    workerContributionsPct: params.workerContributionsPct,
    fixedContributionsMonthly: params.fixedContributionsMonthly,
    insuranceMonthly: 0,
    ppeMonthly: 0,
    trainingMonthly: 0,
    transferMonthly: 0,
    base: emptyBase({ currency: CURRENCY }),
    illustrative: Boolean(agreement && agreement.illustrative),
  };
}

/**
 * Al cambiar el convenio de un puesto: si el puesto usaba los valores del convenio
 * anterior (o no tenía convenio), toma los del nuevo. Valores propios no se tocan.
 */
function laborAgreementWatcher(agreements, initial) {
  let lastId = initial ? initial.agreementId ?? null : null;
  return (draft) => {
    const id = draft.agreementId ?? null;
    if (id === lastId) return;
    const before = agreements.find((a) => a.id === lastId) || null;
    const after = agreements.find((a) => a.id === id) || null;
    lastId = id;
    if (!after) return;
    if (before && ownParamKeys(draft, before).length > 0) return;
    Object.assign(draft, withAgreementParams(draft, after));
    if (after.illustrative) draft.illustrative = true;
  };
}

function agreementSections() {
  return [
    {
      title: 'Convenio',
      cols: 2,
      fields: [
        { key: 'name', label: 'Nombre', kind: 'text', required: true, placeholder: 'Ej.: Petroleros Privados — mi empresa' },
        { key: 'code', label: 'Tipo de convenio', kind: 'select', options: options(AGREEMENT_TYPES_SORTED) },
      ],
    },
    {
      title: 'Cargas sociales',
      hint: 'Porcentajes de tu convenio vigente (RATEOS no trae valores legales). Los puestos de este convenio toman estos valores: si los cambiás acá, se actualizan (salvo los que tienen valores propios).',
      cols: 4,
      fields: [
        { key: 'params.sacPct', label: 'Aguinaldo (SAC)', rule: 'percent', unit: '%' },
        { key: 'params.vacationPct', label: 'Vacaciones', rule: 'percent', unit: '%' },
        { key: 'params.employerContributionsPct', label: 'Cargas patronales', rule: 'percent', unit: '%', hint: 'Sobre el remunerativo.' },
        { key: 'params.artPct', label: 'ART', rule: 'percent', unit: '%' },
        { key: 'params.fixedContributionsMonthly', label: 'Contribuciones fijas por persona', rule: 'money', unit: '$/mes', hint: 'Montos fijos del convenio (contribución extraordinaria, seguro de vida…). Sin cargas encima.' },
        { key: 'params.nonRemunerativeChargesPct', label: 'Cargas sobre el no remunerativo', rule: 'percent', unit: '%', hint: 'Obra social, cuota sindical… que el acuerdo aplica a las sumas no remunerativas. Si no hay: 0.' },
        { key: 'params.otherChargesPct', label: 'Otras cargas y provisiones', rule: 'percent', unit: '%', hint: 'Sobre el remunerativo, sin cargas encima: fondo de cese laboral (UOCRA), provisión por despido, ausentismo, licencias… Lo define tu convenio o tu contador. Si no hay: 0.' },
        { key: 'params.workerContributionsPct', label: 'Aportes del trabajador', rule: 'percent', unit: '%', hint: 'Sólo para mostrar el neto: no cambian tu costo.' },
      ],
    },
    {
      title: 'Horas',
      cols: 2,
      fields: [
        { key: 'params.normalHoursPerMonth', label: 'Horas normales por mes', rule: 'hours', unit: 'h' },
        { key: 'params.overtimePremiumPct', label: 'Recargo de horas extra', rule: 'percentOpen', unit: '%' },
      ],
    },
    { title: 'Notas y marca', cols: 2, fields: [{ key: 'notes', label: 'Notas', kind: 'textarea', maxLength: 600 }, illustrativeField] },
  ];
}

const ACQ_OPTIONS = ACQUISITION_MODES.map((a) => ({ value: a.id, label: a.label }));
const UNIT_OPTIONS = EXTERNAL_UNITS.map((u) => ({ value: u.id, label: u.label }));
const TRIP_BASIS_OPTIONS = EXTERNAL_TRIP_BASES.map((b) => ({ value: b.id, label: b.label }));
const FAMILY_OPTIONS = EQUIPMENT_FAMILIES.map((f) => ({ value: f.id, label: f.label }));
const isExternalDraft = (d) => acquisitionOf(d) !== 'owned';
const currencySymbol = (d, key = 'base') => {
  const c = d && d[key] && d[key].currency;
  return c && c !== CURRENCY ? c : '$';
};
const yesNo = (v) => (v === true ? 'sí' : v === false ? 'no' : 'sin definir');

/**
 * Tarifa de un recurso EXTERNO (alquilado / tercerizado): precio NETO del
 * proveedor, qué incluye y tratamiento fiscal (sin alícuotas inventadas).
 */
function externalTermSections() {
  return [
    {
      title: 'Tarifa del proveedor',
      hint: 'Precio NETO (sin IVA). El IVA y lo que se recupera se definen en "Tratamiento fiscal".',
      fields: [
        { key: 'external.supplier', label: 'Proveedor (opcional)', kind: 'text', maxLength: 120 },
        { key: 'external.price', label: 'Precio neto', rule: 'money', unit: (d) => currencySymbol(d), required: true },
        { key: 'external.unit', label: 'Por', kind: 'select', options: UNIT_OPTIONS, rerender: true },
        // ECO-01 (H-01): con "Por tramo", si el proveedor cobra el viaje completo (ida y vuelta).
        { key: 'external.tripBasis', label: '¿Qué cobra?', kind: 'select', options: TRIP_BASIS_OPTIONS, when: (d) => d.external && d.external.unit === 'trip', hint: 'Un viaje ida y vuelta son 2 tramos y 1 viaje completo.' },
        { key: 'external.minimumUnits', label: RESOURCE_LABELS.externalMinimum, rule: 'quantity', nullable: true, hint: 'Ej.: mínimo 8 h o 3 días.' },
        { key: 'external.validUntil', label: 'Vigencia de la oferta', kind: 'date', hint: 'Hasta qué fecha vale este precio.' },
        ...baseFormFields('base', { currency: true, periodLabel: 'Base de la tarifa (mes)' }),
      ],
    },
    {
      title: '¿Qué incluye la tarifa?',
      hint: 'Lo que no esté incluido y pagues vos se suma aparte (sin duplicar).',
      fields: [
        { key: 'external.operatorIncluded', label: 'Operador incluido', kind: 'tristate' },
        { key: 'external.fuelIncluded', label: 'Combustible incluido', kind: 'tristate', rerender: true },
        // PLAN-2026-012: por hora (L/h) o por km de ruta (L/100 km o km/L), nunca las dos.
        { key: 'external.fuelMode', label: '¿Cómo cargás el consumo?', kind: 'select', options: EXTERNAL_FUEL_MODES.map((m) => ({ value: m.id, label: m.label })), rerender: true, when: (d) => d.external && d.external.fuelIncluded === false },
        { key: 'external.fuelLitersPerHour', label: 'Consumo (si el combustible es tuyo)', rule: 'quantity', unit: 'L/h', when: (d) => d.external && d.external.fuelIncluded === false && !['per_100km', 'km_per_liter'].includes(d.external.fuelMode) },
        { key: 'external.fuelLitersPer100Km', label: 'Consumo por km de ruta (si el combustible es tuyo)', rule: 'quantity', unit: 'L/100 km', when: (d) => d.external && d.external.fuelIncluded === false && d.external.fuelMode === 'per_100km' },
        { key: 'external.fuelKmPerLiter', label: 'Rendimiento (si el combustible es tuyo)', rule: 'quantity', unit: 'km/L', when: (d) => d.external && d.external.fuelIncluded === false && d.external.fuelMode === 'km_per_liter' },
        { key: 'external.mobilizationIncluded', label: 'Movilización incluida', kind: 'tristate', rerender: true },
        { key: 'external.mobilizationAmount', label: RESOURCE_LABELS.externalMobilization, rule: 'money', unit: (d) => currencySymbol(d), when: (d) => d.external && d.external.mobilizationIncluded === false },
        { key: 'external.insuranceIncluded', label: 'Seguros incluidos', kind: 'tristate' },
      ],
    },
    {
      key: 'fiscal',
      title: 'Tratamiento fiscal',
      collapsible: true,
      summary: (d) => {
        const f = externalFiscal(d.external && d.external.fiscal);
        const rec = d.external && d.external.fiscal && d.external.fiscal.vatRecoverable ? labelOf(VAT_RECOVERY, d.external.fiscal.vatRecoverable) : 'IVA: sin definir si es recuperable';
        return `${f.vatDefined ? `IVA ${formatPercent(f.vatPct)}` : 'Alícuota sin cargar'} · ${rec}${f.perceptionsPct ? ` · percepciones ${formatPercent(f.perceptionsPct)}` : ''}${f.nonRecoverablePct ? ` · no recuperables ${formatPercent(f.nonRecoverablePct)}` : ''}.`;
      },
      hint: 'RATEOS no trae alícuotas: cargá las que correspondan a tu empresa. El IVA recuperable y las percepciones son crédito fiscal (caja adelantada), no costo. Ganancias no se suma acá.',
      fields: [
        { key: 'external.fiscal.vatPct', label: 'IVA del proveedor', rule: 'percent', unit: '%', nullable: true },
        { key: 'external.fiscal.vatRecoverable', label: '¿Recuperás ese IVA?', kind: 'select', options: VAT_RECOVERY.map((v) => ({ value: v.id, label: v.label })), includeEmpty: true, emptyLabel: 'Sin definir', rerender: true },
        { key: 'external.fiscal.vatRecoverablePct', label: 'Parte que recuperás', rule: 'percent', unit: '%', nullable: true, when: (d) => d.external && d.external.fiscal && d.external.fiscal.vatRecoverable === 'partial' },
        { key: 'external.fiscal.perceptionsPct', label: 'Percepciones / retenciones', rule: 'percent', unit: '%', nullable: true, hint: 'Pagos a cuenta: caja, no costo.' },
        { key: 'external.fiscal.nonRecoverablePct', label: 'Cargos no recuperables', rule: 'percent', unit: '%', nullable: true, hint: 'Sí son costo.' },
        { key: 'external.fiscal.paymentTermDays', label: 'Condición de pago', rule: 'paymentDays', unit: 'días', nullable: true },
      ],
    },
  ];
}

const TRAVEL_FUEL_FIELD = { key: 'mobility.travelLitersPer100Km', label: 'Consumo trasladándose', rule: 'quantity', unit: 'L/100 km' };
const TRAVEL_WEAR_FIELD = { key: 'mobility.travelCostPerKm', label: 'Mantenimiento y neumáticos en ruta', rule: 'money', unit: '$/km', hint: 'Si cargaste los neumáticos como juego + vida útil en km, acá va sólo el mantenimiento en ruta (los neumáticos se suman aparte).' };

/** Movilidad de una unidad: ¿cómo se traslada? (sugerida por su familia, siempre editable). */
function mobilitySection({ vehicle = false } = {}) {
  return {
    key: 'mobility',
    title: 'Movilidad: ¿cómo se traslada?',
    collapsible: true,
    summary: (d) => {
      const m = d.mobility || {};
      const travel = toNumber(m.travelLitersPer100Km, 0) > 0 ? ` · en ruta ${formatNumber(toNumber(m.travelLitersPer100Km, 0), { decimals: 1 })} L/100 km` : '';
      return `Autopropulsado: ${yesNo(m.selfPropelled)} · circula por ruta: ${yesNo(m.roadLegal)} · requiere transporte: ${yesNo(m.requiresTransport)}${travel}.`;
    },
    hint: 'Sirve para sugerir cómo llega al servicio en cada cotización. El desgaste por km NO incluye amortización (ya está en el costo de tenerlo).',
    fields: [
      { key: 'mobility.selfPropelled', label: 'Autopropulsado', kind: 'tristate' },
      { key: 'mobility.roadLegal', label: 'Puede circular por ruta', kind: 'tristate' },
      { key: 'mobility.requiresTransport', label: 'Requiere transporte externo', kind: 'tristate' },
      { key: 'mobility.requiresDriver', label: 'Requiere conductor', kind: 'tristate' },
      // Un vehículo los pide arriba, a la vista ("Consumo en ruta").
      vehicle ? null : TRAVEL_FUEL_FIELD,
      vehicle ? null : TRAVEL_WEAR_FIELD,
      { key: 'mobility.speedKmh', label: 'Velocidad estimada (opcional)', rule: 'quantity', unit: 'km/h', nullable: true },
    ],
    extra: ({ draft, rerender }) =>
      h(
        'div',
        { class: 'form-section-actions' },
        button('Usar lo típico de la familia', {
          variant: 'secondary',
          size: 'sm',
          onClick: () => {
            draft.mobility = { ...createEquipmentMobility(draft.mobility), ...suggestedMobility(draft.familyId) };
            rerender();
          },
        }),
        h('span', { class: 'muted small' }, 'Características generales sugeridas (no son especificaciones técnicas): confirmalas para tu unidad.'),
      ),
  };
}

/** Nombre que se completó solo, por borrador: si la persona no lo tocó, otra variante lo reemplaza. */
const autoNames = new WeakMap();

const CAPACITY_FIELD = {
  key: 'capacity',
  name: 'capacity',
  label: 'Capacidad / especificación (opcional)',
  kind: 'text',
  maxLength: 80,
  placeholder: 'Ej.: 12 yd³ / 1.500 gal · 6x4 · 3 ejes tándem',
};

/**
 * Variantes comunes de la familia (SUGERENCIAS de texto, sin precios ni
 * consumos): un clic completa "Capacidad / especificación" y, si el nombre está
 * vacío (o es el que se sugirió antes), también el nombre. Todo queda editable;
 * "Personalizado" deja el campo libre para escribir la propia.
 */
function variantSuggestions({ draft, rerender, nameKey = 'name' }) {
  const variants = familyVariants(draft.familyId);
  const current = typeof draft.capacity === 'string' ? draft.capacity.trim() : '';
  if (!variants.length) {
    return h('p', { class: 'muted small variant-suggest-empty' }, draft.familyId && draft.familyId !== 'other'
      ? 'Esta familia no tiene variantes sugeridas: escribí la capacidad o especificación de tu unidad.'
      : 'Elegí una familia para ver variantes comunes, o escribí la tuya (personalizado).');
  }
  const pick = (variant) => {
    draft.capacity = variant.label;
    if (nameKey) {
      const name = typeof draft[nameKey] === 'string' ? draft[nameKey].trim() : '';
      if (!name || name === autoNames.get(draft)) {
        draft[nameKey] = variant.name;
        autoNames.set(draft, variant.name);
      }
    }
    rerender();
  };
  const custom = current !== '' && !variants.some((v) => v.label === current);
  const chip = (label, selected, onClick) => h('button', { type: 'button', class: ['chip-suggest', selected ? 'is-selected' : null], 'aria-pressed': selected ? 'true' : 'false', on: { click: onClick } }, label);
  return h(
    'div',
    { class: 'variant-suggest' },
    h('span', { class: 'variant-suggest-label', id: uniqueId('variants') }, 'Variantes comunes (sugerencias, editables):'),
    h(
      'div',
      { class: 'variant-suggest-list', role: 'group', 'aria-label': 'Variantes comunes' },
      ...variants.map((v) => chip(v.label, current === v.label, () => pick(v))),
      chip('Personalizado', custom, () => {
        if (variants.some((v) => v.label === current)) draft.capacity = '';
        rerender();
        const input = document.querySelector('dialog[open] input[name="capacity"]');
        if (input) input.focus();
      }),
    ),
  );
}

/**
 * Equipo con el valor de reposición en la moneda de la empresa (para comparar
 * con mantenimiento y neumáticos). Sin tipo de cambio: no se compara.
 */
function comparableEquipment(draft, settings) {
  const f = conversionFactor(currencyOfBase(draft && draft.base), settings || {});
  if (f === null) return { eq: draft, comparable: false };
  if (f === 1) return { eq: draft, comparable: true };
  return { eq: { ...draft, replacementValue: toNumber(draft.replacementValue, 0) * f, residualValue: toNumber(draft.residualValue, 0) * f }, comparable: true };
}

const MAINTENANCE_OPTIONS = MAINTENANCE_MODES.map((m) => ({ value: m.id, label: m.label }));
const BUDGET_PERIOD_OPTIONS = BUDGET_PERIODS.map((p) => ({ value: p.id, label: p.label }));
const TIRE_OPTIONS = TIRE_MODES.map((t) => ({ value: t.id, label: t.label }));
const maintenanceModeIs = (mode) => (d) => (d.maintenanceMode || 'per_hour') === mode;
const tiresModeIs = (...modes) => (d) => modes.includes(d.tiresMode || 'per_hour');

/**
 * Mantenimiento y neumáticos (PLAN-2026-007): la persona elige CÓMO lo carga
 * y ve, antes de guardar, cómo lo interpreta RATEOS (+ avisos de sentido común).
 */
function wearSections(settings) {
  const note = (group) => (d) => {
    const { eq, comparable } = comparableEquipment(d, settings);
    return wearNote(eq, group, { comparable });
  };
  return [
    {
      key: 'maintenance',
      title: 'Mantenimiento',
      hint: 'Elegí cómo lo cargás. El costo por hora y el service se suman por cada hora de uso; un presupuesto mensual o anual es un costo FIJO de tenerlo (no se divide por horas).',
      fields: [
        { key: 'maintenanceMode', label: '¿Cómo lo cargás?', kind: 'select', options: MAINTENANCE_OPTIONS, rerender: true },
        { key: 'maintenancePerHour', label: 'Costo por hora de uso', rule: 'money', unit: '$/h', when: maintenanceModeIs('per_hour') },
        { key: 'maintenanceServiceCost', label: 'Costo de cada service', rule: 'money', unit: '$', when: maintenanceModeIs('service') },
        { key: 'maintenanceServiceHours', label: 'Cada cuántas horas de uso', rule: 'intervalHours', unit: 'h', when: maintenanceModeIs('service') },
        { key: 'maintenanceBudget', label: 'Presupuesto de mantenimiento', rule: 'money', unit: '$', when: maintenanceModeIs('budget') },
        { key: 'maintenanceBudgetPeriod', label: 'Por', kind: 'select', options: BUDGET_PERIOD_OPTIONS, when: maintenanceModeIs('budget') },
      ],
      live: note('maintenance'),
    },
    {
      key: 'tires',
      title: 'Neumáticos',
      hint: 'Por hora de uso, o el costo del juego y su vida útil. Para equipos de ruta, la vida útil en km da un costo por km (se suma en los traslados).',
      fields: [
        { key: 'tiresMode', label: '¿Cómo lo cargás?', kind: 'select', options: TIRE_OPTIONS, rerender: true },
        { key: 'tiresPerHour', label: 'Costo por hora de uso', rule: 'money', unit: '$/h', when: tiresModeIs('per_hour') },
        { key: 'tiresSetCost', label: 'Costo del juego de neumáticos', rule: 'money', unit: '$', when: tiresModeIs('set_hours', 'set_km') },
        { key: 'tiresLifeHours', label: 'Vida útil del juego', rule: 'intervalHours', unit: 'h', when: tiresModeIs('set_hours') },
        { key: 'tiresLifeKm', label: 'Vida útil del juego', rule: 'lifeKm', unit: 'km', when: tiresModeIs('set_km') },
      ],
      live: note('tires'),
    },
  ];
}

/** Legajo de una unidad de "Mis equipos": identificación, economía, operación y movilidad. */
function equipmentSections(models = [], settings = {}) {
  return (draft) => {
    const familyModels = models.filter((m) => m.familyId === draft.familyId);
    const vehicle = !isExternalDraft(draft) && isVehicleFamily(draft.familyId);
    const sections = [
      {
        title: '¿Qué equipo es?',
        hint: 'Elegí la familia y, si querés, una variante común: completa la capacidad y sugiere el nombre. Podés cambiar todo o cargarlo desde cero.',
        fields: [
          { key: 'familyId', label: 'Familia', kind: 'select', options: FAMILY_OPTIONS, rerender: true },
          CAPACITY_FIELD,
          { key: 'name', label: 'Nombre', kind: 'text', required: true, placeholder: 'Ej.: Vactor 12 yd³ / 1.500 gal' },
        ],
        extra: ({ draft: d, rerender }) => variantSuggestions({ draft: d, rerender }),
      },
      {
        title: 'Identificación de la unidad',
        cols: 4,
        fields: [
          { key: 'internalCode', label: 'Interno', kind: 'text', maxLength: 40, placeholder: 'Ej.: EQ-014' },
          {
            key: 'modelId',
            label: 'Modelo (de tu catálogo)',
            kind: 'select',
            options: () => familyModels.map((m) => ({ value: m.id, label: modelLabel(m) })),
            includeEmpty: true,
            emptyLabel: familyModels.length ? 'Sin modelo' : 'Sin modelos de esta familia (agregalos en Catálogo)',
          },
          { key: 'year', label: 'Año (opcional)', rule: 'integer', nullable: true },
          { key: 'plate', label: 'Dominio (opcional)', kind: 'text', maxLength: 20 },
        ],
      },
      {
        title: '¿Cómo lo obtenés?',
        cols: 2,
        fields: [{ key: 'acquisition', label: 'Obtención', kind: 'select', options: ACQ_OPTIONS, rerender: true, hint: labelOf(ACQUISITION_MODES.map((a) => ({ id: a.id, label: a.hint })), acquisitionOf(draft), '') }],
      },
    ];
    if (isExternalDraft(draft)) {
      sections.push(...externalTermSections());
    } else {
      sections.push(
        {
          title: 'Valor del equipo',
          hint: VAT_HINT,
          fields: [
            { key: 'replacementValue', label: 'Valor de reposición', rule: 'money', unit: (d) => currencySymbol(d), hint: 'Lo que costaría reemplazarlo hoy.' },
            { key: 'usefulLifeYears', label: 'Vida útil', rule: 'years', unit: 'años' },
            ...baseFormFields('base', { currency: true, periodLabel: 'Base del valor (mes)' }),
          ],
          // Residual mayor que reposición o sin vida útil: aviso (sólo si hay algo que avisar).
          live: (d) => {
            const note = wearNote(d, 'value');
            return note.childElementCount ? note : null;
          },
        },
        // Vehículo (camioneta, camión, colectivo): su consumo es en ruta, a la vista y primero.
        vehicle
          ? {
            title: 'Consumo en ruta',
            cols: 2,
            hint: 'Lo que gasta manejando. Es el consumo que importa en un vehículo que lleva gente o carga.',
            fields: [{ ...TRAVEL_FUEL_FIELD, label: 'Consumo en ruta' }, TRAVEL_WEAR_FIELD],
          }
          : null,
        {
          key: 'holding',
          title: 'Más costos de tenerlo (aunque no trabaje)',
          collapsible: true,
          summary: (d) => {
            const m = maintenanceOf(d);
            const fixedMaintenance = m.mode === 'budget' ? ` · mantenimiento fijo ${formatMoney(m.fixedMonthly)}/mes` : '';
            return `Residual ${formatMoneyIn(toNumber(d.residualValue, 0), d.base && d.base.currency)} · seguro ${formatMoney(toNumber(d.insuranceAnnual, 0))}/año · patente ${formatMoney(toNumber(d.licenseAnnual, 0))}/año · certificaciones ${formatMoney(toNumber(d.certificationsAnnual, 0))}/año · otros ${formatMoney(toNumber(d.otherAnnual, 0))}/año${fixedMaintenance}.`;
          },
          fields: [
            { key: 'residualValue', label: 'Valor residual', rule: 'money', unit: (d) => currencySymbol(d), hint: 'Mismo período y moneda que el valor de reposición.' },
            { key: 'currentValue', label: 'Valor actual (informativo)', rule: 'money', unit: '$' },
            { key: 'insuranceAnnual', label: 'Seguro anual', rule: 'money', unit: '$' },
            { key: 'licenseAnnual', label: 'Patente / impuestos anuales', rule: 'money', unit: '$' },
            { key: 'certificationsAnnual', label: 'Certificaciones e inspecciones (anual)', rule: 'money', unit: '$' },
            { key: 'otherAnnual', label: 'GPS y otros costos anuales', rule: 'money', unit: '$' },
            { key: 'capitalRatePctAnnual', label: 'Costo de capital (% anual)', rule: 'percent', unit: '%', hint: 'Tasa anual sin inflación (real): lo que te cuesta tener plata invertida en el equipo, por encima de la suba de precios. Como el valor de reposición ya está actualizado, no sumes la inflación de nuevo. 0 si no lo considerás.' },
            ...baseFormFields('costsBase', { periodLabel: 'Base de estos costos (mes)' }),
          ],
        },
        ...wearSections(settings),
        {
          // Un vehículo trabajando parado en la locación es opcional: plegado (abierto si ya tiene consumo).
          ...(vehicle
            ? { key: 'works-at-site', title: '¿También trabaja parado en la locación? (bombeo, grúa, generador…)', collapsible: true, openWhen: (d) => toNumber(d.fuelLitersPerHour, 0) > 0, summary: (d) => (d.fuelNotApplicable === true ? 'No usa combustible.' : toNumber(d.fuelLitersPerHour, 0) > 0 ? `Sí: ${formatNumber(toNumber(d.fuelLitersPerHour, 0), { decimals: 2 })} L/h trabajando.` : 'No: sólo viaja.') }
            : { title: 'Combustible (sólo cuando trabaja, por hora de uso)' }),
          cols: 2,
          fields: [
            // PLAN-2026-014 (LAB-D5): explícito; un consumo 0 sin marcar sigue siendo un dato faltante en la cotización.
            { key: 'fuelNotApplicable', label: 'No usa combustible', kind: 'checkbox', rerender: true, hint: 'Eléctrico, manual o estacionario: no se pide consumo ni se suma combustible (tampoco al trasladarse).' },
            { key: 'fuelLitersPerHour', label: 'Consumo trabajando', rule: 'quantity', unit: 'L/h', hint: vehicle ? 'Sólo con el motor trabajando parado (bomba, hidrogrúa). Si sólo lleva gente o carga: 0.' : 'Litros por hora de trabajo. El precio por litro se toma de Configuración.', when: (d) => d.fuelNotApplicable !== true },
          ],
        },
        {
          title: 'Disponibilidad y uso',
          fields: [
            { key: 'availableHoursPerMonth', label: 'Horas disponibles por mes', rule: 'hours', unit: 'h', required: true },
            { key: 'availableDaysPerMonth', label: 'Días disponibles por mes', rule: 'daysInMonth', unit: 'días', required: true },
            {
              key: 'utilizationPct',
              label: '¿Qué parte de ese tiempo esperás que trabaje y facture?',
              rule: 'utilization',
              unit: '%',
              required: true,
              hint: 'Utilización esperada. Con menos uso, cada hora y cada día cuestan más.',
            },
          ],
        },
      );
    }
    sections.push(mobilitySection({ vehicle }), { title: 'Marca', cols: 2, fields: [illustrativeField] });
    return sections;
  };
}

/** Al cambiar a alquilado / tercerizado se arman sus condiciones; nunca se borran datos del propio. */
function prepareEquipmentDraft(draft) {
  if (isExternalDraft(draft) && !(draft.external && typeof draft.external === 'object')) draft.external = createExternalTerms({ unit: 'day' });
  if (!draft.mobility || typeof draft.mobility !== 'object') draft.mobility = createEquipmentMobility({});
  if (!draft.base || typeof draft.base !== 'object') draft.base = emptyBase({ currency: CURRENCY });
  if (!draft.costsBase || typeof draft.costsBase !== 'object') draft.costsBase = emptyBase({ currency: CURRENCY });
}

function newEquipment() {
  return {
    name: '',
    internalCode: '',
    familyId: 'other',
    capacity: '',
    modelId: null,
    year: null,
    plate: '',
    acquisition: 'owned',
    currentValue: 0,
    replacementValue: 0,
    usefulLifeYears: null,
    residualValue: 0,
    insuranceAnnual: 0,
    licenseAnnual: 0,
    certificationsAnnual: 0,
    otherAnnual: 0,
    capitalRatePctAnnual: 0,
    maintenancePerHour: 0,
    tiresPerHour: 0,
    fuelLitersPerHour: 0,
    availableHoursPerMonth: null,
    availableDaysPerMonth: 30,
    utilizationPct: null,
    mobility: createEquipmentMobility({}),
    external: null,
    base: emptyBase({ currency: CURRENCY }),
    costsBase: emptyBase({ currency: CURRENCY }),
    illustrative: false,
  };
}

/** Oferta de un proveedor sin unidad propia (Servicios externos). */
function externalServiceSections() {
  return () => [
    {
      title: 'Servicio',
      fields: [
        { key: 'name', label: 'Nombre', kind: 'text', required: true, maxLength: 120, placeholder: 'Ej.: Grúa 90 t con operador' },
        { key: 'acquisition', label: 'Obtención', kind: 'select', options: ACQ_OPTIONS.filter((o) => o.value !== 'owned') },
        { key: 'familyId', label: 'Tipo de equipo (opcional)', kind: 'select', options: FAMILY_OPTIONS, includeEmpty: true, emptyLabel: 'No es un equipo / otro servicio' },
      ],
    },
    ...externalTermSections(),
    { title: 'Notas y marca', cols: 2, fields: [{ key: 'notes', label: 'Notas', kind: 'textarea', maxLength: 600 }, illustrativeField] },
  ];
}

function newExternalService() {
  return { name: '', acquisition: 'outsourced', familyId: null, external: createExternalTerms({ unit: 'day' }), base: emptyBase({ currency: CURRENCY }), notes: '', illustrative: false };
}

/** Modelo del catálogo de la empresa (descriptivo: sin precios). */
function modelSections() {
  return [
    {
      title: 'Modelo',
      hint: 'El catálogo describe QUÉ equipo es. Los valores económicos van en cada unidad de "Mis equipos". No cargues datos que no tengas confirmados.',
      fields: [
        { key: 'familyId', label: 'Familia', kind: 'select', options: FAMILY_OPTIONS, rerender: true },
        { key: 'brand', label: 'Marca', kind: 'text', maxLength: 60, placeholder: 'Ej.: Vac-Con' },
        { key: 'model', label: 'Modelo', kind: 'text', required: true, maxLength: 60, placeholder: 'Ej.: PD4211' },
        { key: 'year', label: 'Año / generación (opcional)', rule: 'integer', nullable: true },
        { key: 'capacity', name: 'capacity', label: 'Capacidad / especificación (opcional)', kind: 'text', maxLength: 80, placeholder: 'Ej.: 12 yd³ / 1.500 gal' },
        { key: 'fuelType', label: 'Combustible (opcional)', kind: 'text', maxLength: 40, placeholder: 'Ej.: gasoil' },
      ],
      extra: ({ draft, rerender }) => variantSuggestions({ draft, rerender, nameKey: null }),
    },
    {
      title: 'Características generales',
      cols: 4,
      fields: [
        { key: 'selfPropelled', label: 'Autopropulsado', kind: 'tristate' },
        { key: 'roadLegal', label: 'Circula por ruta', kind: 'tristate' },
        { key: 'requiresTransport', label: 'Requiere transporte', kind: 'tristate' },
        { key: 'requiresDriver', label: 'Requiere conductor', kind: 'tristate' },
      ],
    },
    { title: 'Notas', cols: 1, fields: [{ key: 'notes', label: 'Observaciones', kind: 'textarea', maxLength: 600 }] },
  ];
}

function newModel() {
  return { familyId: 'other', brand: '', model: '', year: null, capacity: '', fuelType: '', selfPropelled: null, roadLegal: null, requiresTransport: null, requiresDriver: null, notes: '' };
}

function materialSections(settings = {}) {
  return [
    {
      title: 'Material',
      fields: [
        { key: 'description', label: 'Descripción', kind: 'text', required: true, maxLength: 160 },
        { key: 'unit', label: 'Unidad', kind: 'text', maxLength: 30, placeholder: 'unidad, kg, m³, kit…' },
        { key: 'providedBy', label: '¿Quién lo provee?', kind: 'select', options: options(MATERIAL_PROVIDERS), includeEmpty: true, emptyLabel: 'Sin definir' },
      ],
    },
    {
      title: 'Costo',
      hint: VAT_HINT,
      fields: [
        { key: 'unitCost', label: vatIsCost(settings) ? 'Costo unitario (con IVA)' : 'Costo unitario', rule: 'money', unit: '$' },
        { key: 'quantity', label: 'Cantidad', rule: 'quantity' },
        { key: 'basis', label: 'Base de cálculo', kind: 'select', options: options(MATERIAL_BASES) },
        { key: 'wastePct', label: 'Merma', rule: 'percent', unit: '%' },
        { key: 'logisticsPct', label: 'Logística (flete, manipuleo)', rule: 'percent', unit: '%' },
        { key: 'resaleMarkupPct', label: 'Markup de reventa (sobre costo)', rule: 'percentOpen', unit: '%', hint: 'Sólo informativo. Es markup sobre costo, no margen.' },
      ],
    },
    { title: 'Base económica', hint: 'De qué mes y en qué moneda es el costo unitario.', fields: baseFormFields('base', { currency: true }) },
    { title: 'Marca', cols: 2, fields: [illustrativeField] },
  ];
}

function newMaterial() {
  return { description: '', unit: 'unidad', unitCost: 0, quantity: 1, basis: 'per_month', wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor', base: emptyBase({ currency: CURRENCY }), illustrative: false };
}

function locationSections() {
  return [
    {
      title: 'Ubicación',
      fields: [
        { key: 'name', label: 'Nombre', kind: 'text', required: true, placeholder: 'Ej.: Añelo' },
        { key: 'type', label: 'Tipo', kind: 'select', options: options(LOCATION_TYPES) },
        { key: 'distanceFromBaseKm', label: 'Distancia desde la base', rule: 'distance', unit: 'km', hint: 'Sólo ida.' },
      ],
    },
    { title: 'Marca', cols: 2, fields: [illustrativeField] },
  ];
}

function newLocation() {
  return { name: '', type: 'destination', distanceFromBaseKm: 0, illustrative: false };
}

// -------------------------------------------------------------------- vista

/**
 * "Nuevo puesto" de Recursos abierto desde otra pantalla (0.15.0, pedido de Joaco 2026-11-19): el
 * personal propio se carga UNA vez en Recursos, con su convenio y su sueldo completos. Desde una
 * cotización se abre este mismo formulario: el puesto queda guardado en Recursos y `onSaved` lo
 * recibe (con su convenio) para sumarlo a la cotización.
 * @param {object} app
 * @param {{ agreements?: object[], onSaved?: (profile: object, agreement: object|null, created: object|null) => void }} [options]
 */
export function openNewLaborProfileDialog(app, { agreements = [], onSaved = null } = {}) {
  const { ctx } = app;
  const choices = agreementChoices(agreements);
  openResourceForm(app, {
    title: 'Nuevo puesto (se guarda en Recursos)',
    initial: newLaborProfile(choices),
    sections: laborSections(choices, app, { profileCost: (d) => ctx.resources.laborProfileCost(d) }),
    prepare: laborAgreementWatcher(choices, newLaborProfile(choices)),
    preview: (draft) => {
      const cost = ctx.resources.laborProfileCost(draft);
      return previewKpis(
        [
          { label: 'Te cuesta por mes (con cargas)', value: formatMoney(cost.perPerson.fixedMonthly), emphasis: true },
          { label: 'Hora normal', value: formatMoney(cost.perPerson.loadedHourlyCost) },
          { label: 'Hora al 50\u00a0%', value: formatMoney(cost.perPerson.overtimeHourlyCost50) },
          { label: 'Hora al 100\u00a0%', value: formatMoney(cost.perPerson.overtimeHourlyCost100) },
        ],
        laborTrace(draft, cost),
      );
    },
    onSave: async (entity) => {
      const choice = choices.find((a) => a.pending && a.id === entity.agreementId) || null;
      const created = choice ? await ctx.resources.save('agreements', agreementFromChoice(choice)) : null;
      const saved = await ctx.resources.save('laborProfiles', created ? { ...entity, agreementId: created.id } : entity);
      const agreement = created || choices.find((a) => !a.pending && a.id === saved.agreementId) || null;
      if (typeof onSaved === 'function') onSaved(saved, agreement, created);
      return saved;
    },
  });
}

/**
 * Recursos: #/recursos/:tab (personal, equipos, materiales, ubicaciones).
 */
export async function render(root, app, params = {}) {
  const tabId = params.tab || 'personal';
  const tab = RESOURCE_TAB_IDS.includes(tabId) ? TABS.find((t) => t.id === tabId) : null;
  if (!tab) return renderNotFound(root, app, { path: `/recursos/${params.tab}` });
  return renderLibraryTab(root, app, tab, { embedded: false });
}

async function renderLibraryTab(root, app, tab, { embedded = false } = {}) {
  const { ctx } = app;
  const data = { resources: {}, equipmentCards: new Map(), settings: {}, quotes: [] };

  const addButton = () => button(tab.addLabel, { variant: 'primary', icon: 'plus', onClick: () => openEditor(null) });
  const setHeader = (hasItems) => {
    if (embedded) return;
    app.setHeader({
      title: 'Recursos',
      breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }],
      // Sin recursos, la acción principal es la del estado vacío (no se duplica).
      actions: hasItems ? [addButton()] : [],
    });
  };
  setHeader(true);

  const list = (type) => (Array.isArray(data.resources[type]) ? data.resources[type] : []);

  async function load() {
    // "Usado en" (PLAN-2026-012): las cotizaciones tal como están guardadas (sin calcular).
    const readQuotes = ctx.quotes && typeof ctx.quotes.listQuoteRecords === 'function' ? ctx.quotes.listQuoteRecords().catch(() => []) : Promise.resolve([]);
    const [resources, settings, quotes] = await Promise.all([ctx.resources.list(), app.getSettings(), readQuotes]);
    data.resources = resources || {};
    data.settings = settings || {};
    data.quotes = Array.isArray(quotes) ? quotes : [];
    data.equipmentCards = new Map();
    if (tab.type === 'equipment') {
      const items = list('equipment').filter((eq) => acquisitionOf(eq) === 'owned');
      const cards = await Promise.all(items.map((eq) => ctx.resources.equipmentCard(eq)));
      items.forEach((eq, i) => data.equipmentCards.set(eq.id, cards[i]));
    }
  }

  async function saveResource(entity, verb) {
    const saved = await ctx.resources.save(tab.type, entity);
    app.toast(`${verb === 'create' ? 'Agregado' : 'Guardado'}: ${saved.name || saved.role || saved.description || 'ítem'}.`, 'success');
    await refresh();
  }

  /**
   * Guarda un puesto. Si eligió un convenio del catálogo que la empresa no tenía (0.15.0), primero
   * lo crea (con porcentajes de ejemplo, ilustrativo) y el puesto queda asignado a ese convenio.
   */
  async function saveLaborProfile(entity, verb, agreements) {
    const choice = agreements.find((a) => a.pending && a.id === entity.agreementId) || null;
    if (!choice) return saveResource(entity, verb);
    const created = await ctx.resources.save('agreements', agreementFromChoice(choice));
    const saved = await ctx.resources.save('laborProfiles', { ...entity, agreementId: created.id });
    app.toast(`${verb === 'create' ? 'Agregado' : 'Guardado'}: ${saved.role || 'puesto'}. Se agregó "${created.name}" a tus Convenios: revisá sus porcentajes.`, 'success');
    await refresh();
    return saved;
  }

  /** Guarda un convenio y actualiza los puestos que usaban sus valores (0.12.0). */
  async function saveAgreement(before, entity, verb) {
    const saved = await ctx.resources.save('agreements', entity);
    const updates = profilesToPropagate(before, saved, list('laborProfiles'));
    for (const profile of updates) await ctx.resources.save('laborProfiles', profile);
    const extra = updates.length ? ` Se actualizaron ${updates.length === 1 ? '1 puesto' : `${updates.length} puestos`} que usan este convenio.` : '';
    app.toast(`${verb === 'create' ? 'Agregado' : 'Guardado'}: ${saved.name || 'convenio'}.${extra}`, 'success');
    await refresh();
  }

  /** "Aplicar aumento": % sobre el remunerativo y el no remunerativo, desde un mes, a todos los puestos del convenio. */
  function openRaiseDialog(agreement) {
    const profiles = list('laborProfiles').filter((p) => p.agreementId === agreement.id);
    const draft = { fromPeriod: currentPeriod(), remunerativePct: null, nonRemunerativePct: null, note: '' };
    const body = h('div', { class: 'resource-form' });
    const previewHost = h('div', { class: 'form-preview', 'aria-live': 'polite' });
    const paintPreview = () => {
      const result = applyAgreementRaise(agreement, profiles, { ...draft, nonRemunerativePct: draft.nonRemunerativePct ?? draft.remunerativePct });
      if (!result) {
        mount(previewHost, h('p', { class: 'muted small' }, 'Cargá el % y el mes para ver cuánto cambia cada puesto.'));
        return;
      }
      if (!profiles.length) {
        mount(previewHost, h('p', { class: 'small' }, 'Ningún puesto usa este convenio todavía: el aumento queda en el historial y se ve en las actualizaciones de tarifa.'));
        return;
      }
      mount(previewHost, table({
        caption: 'Cómo queda cada puesto',
        className: 'lib-table table-cards',
        columns: [
          { key: 'role', label: 'Puesto', render: ({ before }) => before.role || 'Puesto' },
          { key: 'before', label: 'Te cuesta por mes hoy', align: 'right', render: ({ before }) => money(ctx.resources.laborProfileCost(before).perPerson.fixedMonthly) },
          { key: 'after', label: 'Con el aumento', align: 'right', render: ({ after }) => h('strong', { class: 'nowrap' }, formatMoney(ctx.resources.laborProfileCost(after).perPerson.fixedMonthly)) },
        ],
        rows: profiles.map((before, i) => ({ before, after: result.profiles[i] })),
      }));
    };
    const field = (node) => node;
    mount(
      body,
      h('p', {}, h('strong', {}, `Sube el sueldo de ${profiles.length === 1 ? 'el puesto' : `los ${profiles.length} puestos`} de ${agreement.name}.`)),
      h('p', { class: 'form-section-hint' }, 'Las cotizaciones ya hechas no cambian: te avisan que hay valores nuevos.'),
      formGrid(2,
        field(periodField({ label: 'Desde el mes', value: draft.fromPeriod, onChange: (v) => { draft.fromPeriod = v; paintPreview(); } })),
        field(numberField({ label: 'Aumento del remunerativo', value: null, rule: 'percentOpen', unit: '%', required: true, onChange: (v) => { draft.remunerativePct = isFiniteNumber(v) ? v : null; paintPreview(); } })),
        field(numberField({ label: 'Aumento del no remunerativo', value: null, rule: 'percentOpen', unit: '%', placeholder: 'Igual que el remunerativo', onChange: (v) => { draft.nonRemunerativePct = isFiniteNumber(v) ? v : null; paintPreview(); } })),
        field(textField({ label: 'Nota (opcional)', value: '', maxLength: 160, placeholder: 'Ej.: Acta julio 2026', onChange: (v) => { draft.note = v; } })),
      ),
      previewHost,
    );
    paintPreview();
    const applyBtn = button('Aplicar aumento', { variant: 'primary', icon: 'check' });
    const { close } = openDialog({ title: `Aplicar aumento — ${agreement.name || 'convenio'}`, content: body, wide: true, actions: [button('Cancelar', { variant: 'secondary', onClick: () => close() }), applyBtn] });
    applyBtn.addEventListener('click', async () => {
      // Los puestos como están ahora (por si cambiaron con el diálogo abierto).
      const result = applyAgreementRaise(agreement, list('laborProfiles').filter((p) => p.agreementId === agreement.id), { ...draft, note: sanitizeText(draft.note, 160) }, { id: createId(), now: new Date().toISOString() });
      if (!result) {
        app.toast('Completá el mes y el % de aumento.', 'warning');
        return;
      }
      applyBtn.disabled = true;
      try {
        for (const profile of result.profiles) await ctx.resources.save('laborProfiles', profile);
        await ctx.resources.save('agreements', result.agreement);
        app.toast(`Aumento aplicado a ${result.profiles.length === 1 ? '1 puesto' : `${result.profiles.length} puestos`} de "${agreement.name}".`, 'success');
        close();
        await refresh();
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudo aplicar el aumento.'), 'danger');
        applyBtn.disabled = false;
      }
    });
  }

  /** Historial de aumentos de un convenio, con "Deshacer el último". */
  function openRaiseHistory(agreement) {
    const raises = Array.isArray(agreement.raises) ? [...agreement.raises].reverse() : [];
    const last = raises[0] || null;
    const lastText = last ? `${formatPercent(last.remunerativePct)} de ${formatPeriod(last.fromPeriod)}` : '';
    const undoBtn = last ? button(`Deshacer el aumento de ${formatPeriod(last.fromPeriod)}`, { variant: 'secondary' }) : null;
    const withNotes = raises.some((r) => r.note);
    const content = raises.length
      ? h('div', {},
        h('p', { class: 'form-section-hint' }, 'El más reciente arriba.'),
        table({
          caption: 'Aumentos aplicados',
          className: 'lib-table table-cards',
          columns: [
            { key: 'from', label: 'Desde', render: ({ r }) => formatPeriod(r.fromPeriod) },
            { key: 'rem', label: 'Remunerativo', align: 'right', render: ({ r }) => percent(r.remunerativePct) },
            { key: 'nonrem', label: 'No remunerativo', align: 'right', render: ({ r }) => percent(r.nonRemunerativePct) },
            { key: 'n', label: 'Puestos', align: 'right', render: ({ r }) => formatNumber((r.changes || []).length) },
            withNotes ? { key: 'note', label: 'Nota', render: ({ r }) => r.note || EMPTY } : null,
          ].filter(Boolean),
          rows: raises.map((r) => ({ r })),
        }))
      : h('p', { class: 'muted' }, 'Todavía no aplicaste aumentos a este convenio.');
    const { close } = openDialog({ title: `Aumentos — ${agreement.name || 'convenio'}`, content, wide: true, actions: [undoBtn, button('Cerrar', { variant: 'secondary', onClick: () => close() })].filter(Boolean) });
    if (undoBtn) {
      undoBtn.addEventListener('click', async () => {
        const n = (last.changes || []).length;
        const ok = await confirmDialog({
          title: 'Deshacer aumento',
          message: `¿Deshacer el aumento de ${lastText}? ${n === 1 ? 'El sueldo de 1 puesto vuelve' : `Los sueldos de ${n} puestos vuelven`} al valor anterior.`,
          confirmLabel: 'Deshacer',
          danger: true,
        });
        if (!ok) return;
        const result = undoLastAgreementRaise(agreement, list('laborProfiles'));
        if (!result) return;
        undoBtn.disabled = true;
        try {
          for (const profile of result.profiles) await ctx.resources.save('laborProfiles', profile);
          await ctx.resources.save('agreements', result.agreement);
          const skipped = result.skipped.length ? ` ${result.skipped.length === 1 ? '1 puesto no se tocó' : `${result.skipped.length} puestos no se tocaron`} porque lo editaste después.` : '';
          app.toast(`Se deshizo el aumento de ${lastText}.${skipped}`, 'success');
          close();
          await refresh();
        } catch (error) {
          app.toast(userErrorMessage(error, 'No se pudo deshacer.'), 'danger');
          undoBtn.disabled = false;
        }
      });
    }
  }

  async function removeResource(item, displayName, extraMessage = '') {
    const ok = await confirmDialog({
      title: 'Eliminar recurso',
      message: `¿Eliminar "${displayName}"? Las cotizaciones que ya lo usan no cambian (guardan una copia de los valores).${extraMessage ? ` ${extraMessage}` : ''}`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.resources.remove(tab.type, item.id);
      app.toast(`Eliminado: ${displayName}.`, 'success');
      await refresh();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo eliminar.'), 'danger');
    }
  }

  // ---------------------------------------------------------- editores

  function openEditor(item) {
    const isNew = !item;
    const verb = isNew ? 'create' : 'update';
    const onSave = (entity) => saveResource(entity, verb);
    switch (tab.type) {
      case 'laborProfiles': {
        // 0.15.0: los convenios de la empresa y los del catálogo que todavía no cargó.
        const agreements = agreementChoices(list('agreements'));
        openResourceForm(app, {
          title: isNew ? 'Nuevo puesto' : `Editar puesto — ${item.role || ''}`,
          initial: isNew ? newLaborProfile(agreements) : item,
          sections: laborSections(agreements, app, { profileCost: (d) => ctx.resources.laborProfileCost(d) }),
          prepare: laborAgreementWatcher(agreements, isNew ? newLaborProfile(agreements) : item),
          preview: (draft) => {
            const cost = ctx.resources.laborProfileCost(draft);
            return previewKpis(
              [
                { label: 'Te cuesta por mes (con cargas)', value: formatMoney(cost.perPerson.fixedMonthly), emphasis: true },
                { label: 'Hora normal', value: formatMoney(cost.perPerson.loadedHourlyCost) },
                { label: 'Hora al 50\u00a0%', value: formatMoney(cost.perPerson.overtimeHourlyCost50) },
                { label: 'Hora al 100\u00a0%', value: formatMoney(cost.perPerson.overtimeHourlyCost100) },
              ],
              laborTrace(draft, cost),
            );
          },
          onSave: (entity) => saveLaborProfile(entity, verb, agreements),
        });
        break;
      }
      case 'agreements':
        openResourceForm(app, {
          title: isNew ? 'Nuevo convenio personalizado' : `Editar convenio — ${item.name || ''}`,
          initial: isNew
            ? { code: 'personalizado', name: 'Convenio personalizado', params: { ...ILLUSTRATIVE_AGREEMENT_PARAMS }, notes: '', illustrative: true }
            : { ...item, params: { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(item.params || {}) } },
          sections: agreementSections(),
          preview: (draft) => previewKpis([{ label: 'Factor de cargas', value: factorText(laborLoadFactor(draft.params || {})), hint: '(1 + SAC + Vacaciones) × (1 + Cargas + ART)' }], agreementTrace(draft)),
          onSave: (entity) => saveAgreement(isNew ? null : item, entity, verb),
        });
        break;
      case 'equipment':
        openResourceForm(app, {
          title: isNew ? 'Nuevo equipo' : `Legajo del equipo — ${item.internalCode ? `${item.internalCode} · ` : ''}${item.name || ''}`,
          initial: isNew ? newEquipment() : { ...newEquipment(), ...item, familyId: familyIdOf(item) },
          sections: equipmentSections(list('equipmentModels'), data.settings),
          prepare: prepareEquipmentDraft,
          validate: (d) => (!isExternalDraft(d) && toNumber(d.residualValue) > toNumber(d.replacementValue) ? 'El valor residual no puede superar el valor de reposición.' : null),
          preview: async (draft) => {
            if (isExternalDraft(draft)) return externalPreview(draft);
            const c = await ctx.resources.equipmentCard(draft);
            if (c.currency && !c.currency.converted) {
              return h('p', { class: 'small' }, `El valor está en ${c.currency.code}: la ficha se calcula en cada cotización con su tipo de cambio (o cargá uno por defecto en Configuración → Parámetros económicos).`);
            }
            return previewKpis(
              [
                { label: 'Posesión por mes', value: formatMoney(c.ownership.totalMonthly), hint: 'COSTO DE POSESIÓN' },
                { label: 'Operación por hora', value: formatValue(c.operation.totalPerHour, 'rate'), hint: 'COSTO DE OPERACIÓN' },
                { label: '$/hora', value: formatValue(c.rates.costPerUsedHour, 'rate') },
                { label: '$/día', value: formatMoney(c.rates.costPerUsedDay) },
                { label: '$/mes', value: formatMoney(c.rates.costPerMonth), emphasis: true },
              ],
              equipmentTrace(draft, c),
            );
          },
          onSave,
        });
        break;
      case 'materials':
        openResourceForm(app, {
          title: isNew ? 'Nuevo material' : `Editar material — ${item.description || ''}`,
          initial: isNew ? newMaterial() : item,
          sections: materialSections(data.settings),
          preview: (draft) => {
            const c = computeMaterialLine(draft);
            return previewKpis(
              [
                { label: `Costo para nosotros (${BASIS_SUFFIX[c.basis] || '/mes'})`, value: formatMoneyIn(c.costForUs, draft.base && draft.base.currency), emphasis: true },
                { label: 'Costo bruto', value: formatMoneyIn(c.grossCost, draft.base && draft.base.currency) },
                { label: 'Precio de reventa (informativo)', value: formatMoneyIn(c.resalePrice, draft.base && draft.base.currency) },
              ],
              materialTrace(draft, c),
            );
          },
          onSave,
        });
        break;
      case 'externalServices':
        openResourceForm(app, {
          title: isNew ? 'Nuevo servicio externo' : `Editar servicio externo — ${item.name || ''}`,
          initial: isNew ? newExternalService() : { ...newExternalService(), ...item, external: createExternalTerms(item.external) },
          sections: externalServiceSections(),
          preview: (draft) => externalPreview(draft),
          onSave,
        });
        break;
      case 'equipmentModels':
        openResourceForm(app, {
          title: isNew ? 'Nuevo modelo de equipo' : `Editar modelo — ${modelLabel(item)}`,
          initial: isNew ? newModel() : { ...newModel(), ...item },
          sections: modelSections(),
          onSave,
        });
        break;
      default:
        openResourceForm(app, {
          title: isNew ? 'Nueva ubicación' : `Editar ubicación — ${item.name || ''}`,
          initial: isNew ? newLocation() : item,
          sections: locationSections(),
          onSave,
        });
    }
  }

  // ------------------------------------------------------------ tablas

  // ------------------------------------------------ "Usado en" (PLAN-2026-012)

  /** Una fila del diálogo: "COT-0010 · Transporte — Borrador · 1 persona × 25 % = 25 %". */
  function usageRowNode(row, type) {
    const statusLabel = labelOf(QUOTE_STATUSES, row.status, row.status);
    const who = row.code || row.name ? `${row.code}${row.code && row.name ? ' · ' : ''}${row.name}` : 'Cotización sin nombre';
    const unitsWord = type === 'laborProfiles' ? (Math.abs(row.units - 1) < 1e-9 ? 'persona' : 'personas') : Math.abs(row.units - 1) < 1e-9 ? 'unidad' : 'unidades';
    const detail = row.assignedPct === null
      ? `${formatNumber(row.units, { decimals: 2 })} ${unitsWord} · se paga por uso (sin % de costos fijos)`
      : `${formatNumber(row.units, { decimals: 2 })} ${unitsWord} × ${formatPercent(row.sharePct)}${row.shared ? ' (compartido)' : ''} = ${formatPercent(row.assignedPct)}`;
    return h('li', { class: 'lib-usage-row' },
      h('a', { href: `#/cotizaciones/${encodeURIComponent(String(row.quoteId || ''))}/result` }, who),
      row.client ? h('span', { class: 'muted small' }, ` (${row.client})`) : null,
      ' ',
      badge(statusLabel, row.group === 'committed' ? 'green' : 'gray'),
      h('div', { class: 'small' }, detail));
  }

  function openUsage(item, type, usage) {
    const committed = usage.rows.filter((r) => r.group === 'committed');
    const potential = usage.rows.filter((r) => r.group === 'potential');
    const name = item.role || item.name || 'Recurso';
    const { close } = openDialog({
      title: `Usado en: ${name}`,
      content: h('div', { class: 'stack lib-usage' },
        h('p', { class: 'small muted' }, 'Las cotizaciones guardan su propia copia de los valores: cambiar este recurso no las modifica. El % es la parte de sus costos fijos que carga cada cotización (100 % si está dedicado o reservado).'),
        h('h4', {}, `Adjudicadas (compromiso real): ${formatPercent(usage.committedPct)}`),
        committed.length ? h('ul', {}, ...committed.map((r) => usageRowNode(r, type))) : h('p', { class: 'small muted' }, 'Ninguna cotización ganada lo usa.'),
        h('h4', {}, `Borradores y enviadas (uso potencial): ${formatPercent(usage.potentialPct)}`),
        potential.length ? h('ul', {}, ...potential.map((r) => usageRowNode(r, type))) : h('p', { class: 'small muted' }, 'Ninguna cotización en curso lo usa.'),
        usage.overCommitted
          ? h('p', { class: 'banner banner-warning' }, `Lo adjudicado suma ${formatPercent(usage.committedPct)}: más del 100 %. Si es ${type === 'laborProfiles' ? 'una sola persona' : 'un solo equipo'}, está asignado de más (no se bloquea: revisalo).`)
          : usage.overWithPotential
            ? h('p', { class: 'small' }, `Si se adjudican las que están en curso, sumaría ${formatPercent(usage.committedPct + usage.potentialPct)}.`)
            : null,
        h('p', { class: 'small muted' }, 'Las perdidas y archivadas no cuentan.')),
      actions: [button('Cerrar', { variant: 'secondary', onClick: () => close() })],
    });
  }

  /** Celda "Usado en": cuántas cotizaciones, % adjudicado y aviso si supera el 100 %. */
  function usageColumn(type) {
    return {
      key: 'usage',
      label: 'Usado en',
      render: ({ item }) => {
        const usage = resourceUsage(type, item.id, data.quotes);
        if (!usage.rows.length) return h('span', { class: 'muted small' }, 'Sin cotizaciones');
        const count = `${formatNumber(usage.quotesCount)} ${usage.quotesCount === 1 ? 'cotización' : 'cotizaciones'}`;
        const withPct = usage.rows.some((r) => r.assignedPct !== null);
        return h('div', { class: 'cell-stack' },
          button(count, { variant: 'link', size: 'sm', onClick: () => openUsage(item, type, usage), attrs: { 'aria-label': `Usado en: ${count} (${item.role || item.name || 'recurso'})` } }),
          withPct ? h('span', { class: 'cell-sub nowrap' }, `Adjudicado ${formatPercent(usage.committedPct)} · en curso ${formatPercent(usage.potentialPct)}`) : null,
          usage.overCommitted ? badge('Más del 100 % adjudicado', 'orange') : null);
      },
    };
  }

  function laborTable(detailed) {
    const agreements = list('agreements');
    const agreementName = (id) => {
      const a = agreements.find((x) => x.id === id);
      return a ? a.name : 'Sin convenio';
    };
    const rows = list('laborProfiles').map((p) => ({ item: p, cost: ctx.resources.laborProfileCost(p) }));
    const actions = {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      render: ({ item }) => rowActions({ name: item.role || 'perfil', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.role || 'perfil') }),
    };
    // Siempre visible (también en la vista de tarjetas): "Base: sep-26" o "Base no definida".
    const laborBaseColumn = { key: 'base', label: 'Base del sueldo', render: ({ item }) => baseTag(item.base) };
    if (!detailed) {
      return table({
        caption: 'Perfiles de personal',
        className: 'lib-table lib-table-simple table-cards',
        columns: [
          { key: 'role', label: 'Puesto', render: ({ item }) => nameCell(item.role, [agreementName(item.agreementId), item.category].filter(Boolean).join(' · '), item.illustrative) },
          laborBaseColumn,
          { key: 'hourly', label: 'Hora normal', align: 'right', render: ({ cost }) => rate(cost.perPerson.loadedHourlyCost) },
          { key: 'h50', label: 'Hora al 50\u00a0%', align: 'right', render: ({ cost }) => rate(cost.perPerson.overtimeHourlyCost50) },
          { key: 'h100', label: 'Hora al 100\u00a0%', align: 'right', render: ({ cost }) => rate(cost.perPerson.overtimeHourlyCost100) },
          { key: 'monthly', label: 'Costo por mes (por persona)', align: 'right', render: ({ item, cost }) => withTrace(h('strong', { class: 'nowrap' }, formatMoney(cost.perPerson.fixedMonthly)), laborTrace(item, cost)) },
          usageColumn('laborProfiles'),
          actions,
        ],
        rows,
      });
    }
    return table({
      caption: 'Perfiles de personal',
      className: 'lib-table table-cards',
      columns: [
        { key: 'role', label: 'Rol', render: ({ item }) => nameCell(item.role, item.category, item.illustrative) },
        laborBaseColumn,
        { key: 'agreement', label: 'Convenio', render: ({ item }) => agreementName(item.agreementId) },
        {
          key: 'basic',
          label: 'Remunerativo + no remunerativo',
          align: 'right',
          render: ({ item, cost }) => h('div', { class: 'cell-main cell-num' }, money(cost.perPerson.remunerative), h('span', { class: 'cell-sub nowrap' }, `+ ${formatMoney(cost.perPerson.nonRemunerativePay)} no rem. · neto ${formatMoney(cost.perPerson.netMonthly)}`)),
        },
        { key: 'monthly', label: 'Costo mensual por persona', align: 'right', render: ({ item, cost }) => withTrace(h('strong', { class: 'nowrap' }, formatMoney(cost.perPerson.fixedMonthly)), laborTrace(item, cost)) },
        { key: 'hourly', label: 'Costo hora cargado', align: 'right', render: ({ cost }) => rate(cost.perPerson.loadedHourlyCost) },
        { key: 'factor', label: 'Factor de cargas', align: 'right', render: ({ cost }) => h('span', { class: 'mono nowrap' }, factorText(cost.perPerson.loadFactor)) },
        usageColumn('laborProfiles'),
        actions,
      ],
      rows,
    });
  }

  function agreementsTable() {
    const profiles = list('laborProfiles');
    const rows = list('agreements').map((a) => ({ item: a, p: agreementParamsOf(a), used: profiles.filter((p) => p.agreementId === a.id).length }));
    const lastRaise = (a) => (Array.isArray(a.raises) && a.raises.length ? a.raises[a.raises.length - 1] : null);
    return table({
      caption: 'Convenios',
      className: 'lib-table table-cards',
      columns: [
        { key: 'name', label: 'Convenio', render: ({ item }) => nameCell(item.name, labelOf(AGREEMENT_TYPES, item.code, 'Personalizado'), item.illustrative) },
        { key: 'factor', label: 'Factor de cargas', align: 'right', render: ({ item, p }) => withTrace(h('span', { class: 'mono nowrap' }, factorText(laborLoadFactor(p))), agreementTrace(item)) },
        { key: 'contrib', label: 'Cargas patronales + ART', align: 'right', render: ({ p }) => percent(toNumber(p.employerContributionsPct, 0) + toNumber(p.artPct, 0)) },
        { key: 'fixed', label: 'Contribuciones fijas', align: 'right', render: ({ p }) => (toNumber(p.fixedContributionsMonthly, 0) > 0 ? h('span', { class: 'nowrap' }, `${formatMoney(p.fixedContributionsMonthly)}/mes`) : EMPTY) },
        { key: 'used', label: 'Puestos', align: 'right', render: ({ used }) => formatNumber(used) },
        {
          key: 'raise',
          label: 'Último aumento',
          render: ({ item }) => {
            const r = lastRaise(item);
            return h('div', { class: 'cell-stack' },
              r ? h('span', { class: 'nowrap' }, `${formatPercent(r.remunerativePct)} desde ${formatPeriod(r.fromPeriod)}`) : h('span', { class: 'muted' }, 'Sin aumentos'),
              r ? button('Ver historial', { variant: 'link', size: 'sm', onClick: () => openRaiseHistory(item), attrs: { 'aria-label': `Historial de aumentos de ${item.name || 'convenio'}` } }) : null);
          },
        },
        {
          key: 'actions',
          label: 'Acciones',
          align: 'right',
          render: ({ item, used }) =>
            h('div', { class: 'table-actions' },
              button('Aplicar aumento', { variant: 'primary', size: 'sm', icon: 'plus', onClick: () => openRaiseDialog(item), attrs: { 'aria-label': `Aplicar aumento a ${item.name || 'convenio'}` } }),
              rowActions({
                name: item.name || 'convenio',
                onEdit: () => openEditor(item),
                onDelete: () => removeResource(item, item.name || 'convenio', used ? `${used === 1 ? 'Hay 1 puesto' : `Hay ${used} puestos`} de personal que lo usan: quedarán sin convenio asignado.` : ''),
              })),
        },
      ],
      rows,
    });
  }

  function equipmentSub(item) {
    const fam = familyById(familyIdOf(item));
    const model = list('equipmentModels').find((m) => m.id === item.modelId);
    const capacity = typeof item.capacity === 'string' && item.capacity.trim() ? item.capacity.trim() : null;
    return [item.internalCode, fam ? fam.label : null, capacity, model ? modelLabel(model) : null].filter(Boolean).join(' · ');
  }

  function equipmentTable(detailed) {
    const rows = list('equipment').map((eq) => ({ item: eq, c: data.equipmentCards.get(eq.id) || null, external: acquisitionOf(eq) !== 'owned' }));
    // Valor en otra moneda sin tipo de cambio en Configuración: no se mezclan monedas.
    const noRate = (c) => Boolean(c && c.currency && !c.currency.converted);
    const noRateNote = (c) => h('span', { class: 'muted small' }, `Valor en ${c.currency.code}: se calcula en cada cotización con su tipo de cambio`);
    const actions = { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.name || 'equipo', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.name || 'equipo') }) };
    const nameCol = { key: 'name', label: 'Equipo', render: ({ item }) => h('div', { class: 'cell-stack' }, nameCell(item.name, equipmentSub(item), item.illustrative), baseTag(item.base, { prefix: acquisitionOf(item) === 'owned' ? 'Base del valor' : 'Base' })) };
    const acqCol = { key: 'acq', label: 'Obtención', render: ({ item }) => badge(labelOf(ACQUISITION_MODES, acquisitionOf(item), 'Propio'), acquisitionOf(item) === 'owned' ? 'navy' : 'blue') };
    const tariff = (item) => {
      const x = item.external || {};
      return h('span', { class: 'nowrap' }, h('strong', {}, formatMoneyIn(toNumber(x.price, 0), item.base && item.base.currency)), h('span', { class: 'unit-suffix' }, ` ${externalUnitShort(x)}`));
    };
    if (!detailed) {
      return table({
        caption: 'Equipos',
        className: 'lib-table lib-table-simple table-cards',
        columns: [
          nameCol,
          acqCol,
          { key: 'perDay', label: 'Costo por día usado', align: 'right', render: ({ c, external, item }) => (external ? tariff(item) : noRate(c) ? noRateNote(c) : money(c && c.rates.costPerUsedDay)) },
          { key: 'perMonth', label: 'Costo por mes', align: 'right', render: ({ item, c, external }) => (external ? h('span', { class: 'muted small' }, 'Según uso en cada cotización') : noRate(c) ? EMPTY : withTrace(h('strong', { class: 'nowrap' }, formatMoney(c && c.rates.costPerMonth)), equipmentTrace(item, c))) },
          usageColumn('equipment'),
          actions,
        ],
        rows,
      });
    }
    return table({
      caption: 'Equipos',
      className: 'lib-table table-cards',
      columns: [
        nameCol,
        acqCol,
        { key: 'ownership', label: 'Posesión $/mes', align: 'right', className: 'col-ownership', render: ({ c, external, item }) => (external ? tariff(item) : noRate(c) ? noRateNote(c) : money(c && c.ownership.totalMonthly)) },
        { key: 'operation', label: 'Operación $/h', align: 'right', className: 'col-operation', render: ({ c, external }) => (external ? EMPTY : rate(c && c.operation.totalPerHour)) },
        { key: 'util', label: 'Utilización', align: 'right', render: ({ c, external }) => (external ? EMPTY : percent(c && c.capacity.utilizationPct)) },
        { key: 'perHour', label: '$/hora', align: 'right', render: ({ c, external }) => (external || noRate(c) ? EMPTY : rate(c && c.rates.costPerUsedHour)) },
        { key: 'perDay', label: '$/día', align: 'right', render: ({ c, external }) => (external || noRate(c) ? EMPTY : money(c && c.rates.costPerUsedDay)) },
        { key: 'perMonth', label: '$/mes', align: 'right', render: ({ item, c, external }) => (external || noRate(c) ? EMPTY : withTrace(h('strong', { class: 'nowrap' }, formatMoney(c && c.rates.costPerMonth)), equipmentTrace(item, c))) },
        usageColumn('equipment'),
        actions,
      ],
      rows,
    });
  }

  function externalTable() {
    const rows = list('externalServices').map((x) => ({ item: x }));
    return table({
      caption: 'Servicios externos',
      className: 'lib-table table-cards',
      columns: [
        { key: 'name', label: 'Servicio', render: ({ item }) => h('div', { class: 'cell-stack' }, nameCell(item.name, [item.external && item.external.supplier, familyById(item.familyId) ? familyById(item.familyId).label : null].filter(Boolean).join(' · '), item.illustrative), baseTag(item.base)) },
        { key: 'acq', label: 'Obtención', render: ({ item }) => badge(labelOf(ACQUISITION_MODES, acquisitionOf(item) === 'owned' ? 'outsourced' : acquisitionOf(item)), 'blue') },
        {
          key: 'tariff',
          label: 'Tarifa neta (sin IVA)',
          align: 'right',
          render: ({ item }) => {
            const x = item.external || {};
            return h('div', { class: 'cell-main cell-num' }, h('strong', { class: 'nowrap' }, `${formatMoneyIn(toNumber(x.price, 0), item.base && item.base.currency)} ${externalUnitShort(x)}`), toNumber(x.minimumUnits, 0) > 0 ? h('span', { class: 'cell-sub' }, `Mínimo ${formatNumber(toNumber(x.minimumUnits, 0), { decimals: 2 })}`) : null);
          },
        },
        { key: 'includes', label: 'Incluye', render: ({ item }) => includesText(item.external) },
        { key: 'fiscal', label: 'IVA', render: ({ item }) => fiscalBadge(item.external) },
        { key: 'valid', label: 'Vigencia', render: ({ item }) => (item.external && item.external.validUntil ? `Hasta ${formatDayDate(item.external.validUntil)}` : badge('Sin vigencia', 'orange')) },
        usageColumn('externalServices'),
        { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.name || 'servicio', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.name || 'servicio') }) },
      ],
      rows,
    });
  }

  function modelsTable() {
    const units = list('equipment');
    const rows = list('equipmentModels').map((m) => ({ item: m, used: units.filter((u) => u.modelId === m.id).length }));
    return table({
      caption: 'Modelos de equipos',
      className: 'lib-table table-cards',
      columns: [
        { key: 'model', label: 'Modelo', render: ({ item }) => nameCell(modelLabel(item), familyById(item.familyId) ? familyById(item.familyId).label : 'Otro', false) },
        { key: 'capacity', label: 'Capacidad', render: ({ item }) => item.capacity || EMPTY },
        { key: 'traits', label: 'Características', render: ({ item }) => `Autopropulsado: ${yesNo(item.selfPropelled)} · ruta: ${yesNo(item.roadLegal)} · transporte: ${yesNo(item.requiresTransport)}` },
        { key: 'used', label: 'Unidades', align: 'right', render: ({ used }) => formatNumber(used) },
        { key: 'actions', label: 'Acciones', align: 'right', render: ({ item, used }) => rowActions({ name: modelLabel(item), onEdit: () => openEditor(item), onDelete: () => removeResource(item, modelLabel(item), used ? `${used === 1 ? 'Hay 1 unidad' : `Hay ${used} unidades`} de "Equipos" con este modelo: conservan sus datos.` : '') }) },
      ],
      rows,
    });
  }

  function familiesReference() {
    return disclosure(
      { summary: `Familias del catálogo (${EQUIPMENT_FAMILIES.length})`, hint: 'Características generales y variantes comunes SUGERIDAS (no son especificaciones técnicas ni precios).', className: 'disclosure-plain' },
      table({
        caption: 'Familias de equipos',
        className: 'lib-table table-cards',
        columns: [
          { key: 'label', label: 'Familia', render: (f) => f.label },
          { key: 'variants', label: 'Variantes sugeridas', render: (f) => familyVariants(f.id).map((v) => v.label).join(' · ') || EMPTY },
          { key: 'self', label: 'Autopropulsado', render: (f) => yesNo(f.selfPropelled) },
          { key: 'road', label: 'Circula por ruta', render: (f) => yesNo(f.roadLegal) },
          { key: 'transport', label: 'Suele requerir transporte', render: (f) => yesNo(f.requiresTransport) },
        ],
        rows: EQUIPMENT_FAMILIES,
      }),
    );
  }

  function materialsTable(detailed) {
    const rows = list('materials').map((m) => ({ item: m, c: computeMaterialLine(m) }));
    const costCell = ({ item, c }) => withTrace(h('span', { class: 'nowrap' }, h('strong', {}, formatMoneyIn(c.costForUs, item.base && item.base.currency)), h('span', { class: 'unit-suffix' }, ` ${BASIS_SUFFIX[c.basis] || ''}`)), materialTrace(item, c));
    const actions = { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.description || 'material', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.description || 'material') }) };
    if (!detailed) {
      return table({
        caption: 'Materiales',
        className: 'lib-table lib-table-simple table-cards',
        columns: [
          { key: 'description', label: 'Material', render: ({ item }) => h('div', { class: 'cell-stack' }, nameCell(item.description, null, item.illustrative), baseTag(item.base)) },
          { key: 'provider', label: 'Quién lo provee', render: ({ item }) => (item.providedBy ? labelOf(MATERIAL_PROVIDERS, item.providedBy) : badge('Sin definir', 'orange')) },
          { key: 'cost', label: 'Costo para nosotros', align: 'right', render: costCell },
          actions,
        ],
        rows,
      });
    }
    return table({
      caption: 'Materiales',
      className: 'lib-table table-cards',
      columns: [
        { key: 'description', label: 'Descripción', render: ({ item }) => h('div', { class: 'cell-stack' }, nameCell(item.description, null, item.illustrative), baseTag(item.base)) },
        {
          key: 'unitCost',
          label: 'Costo unitario × cantidad',
          align: 'right',
          render: ({ item }) =>
            h('div', { class: 'cell-main cell-num' }, money(item.unitCost), h('span', { class: 'cell-sub nowrap' }, `× ${formatNumber(toNumber(item.quantity, NaN), { decimals: 2 })} ${item.unit || 'unidad'}`)),
        },
        { key: 'basis', label: 'Base', render: ({ item }) => labelOf(MATERIAL_BASES, item.basis, 'Por mes') },
        { key: 'waste', label: 'Merma', align: 'right', render: ({ item }) => percent(toNumber(item.wastePct, 0)) },
        { key: 'logistics', label: 'Logística', align: 'right', render: ({ item }) => percent(toNumber(item.logisticsPct, 0)) },
        { key: 'markup', label: 'Markup reventa', align: 'right', render: ({ item }) => percent(toNumber(item.resaleMarkupPct, 0)) },
        { key: 'provider', label: 'Quién provee', render: ({ item }) => (item.providedBy ? labelOf(MATERIAL_PROVIDERS, item.providedBy) : badge('Sin definir', 'orange')) },
        { key: 'cost', label: 'Costo para nosotros', align: 'right', render: costCell },
        actions,
      ],
      rows,
    });
  }

  function locationsTable() {
    const rows = list('locations').map((l) => ({ item: l }));
    return table({
      caption: 'Ubicaciones',
      className: 'lib-table table-cards',
      columns: [
        { key: 'name', label: 'Nombre', render: ({ item }) => nameCell(item.name, null, item.illustrative) },
        { key: 'type', label: 'Tipo', render: ({ item }) => badge(labelOf(LOCATION_TYPES, item.type, 'Destino / locación'), item.type === 'base' ? 'navy' : 'blue') },
        { key: 'distance', label: 'Distancia desde la base (ida)', align: 'right', render: ({ item }) => formatValue(toNumber(item.distanceFromBaseKm, NaN), 'km') },
        { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.name || 'ubicación', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.name || 'ubicación') }) },
      ],
      rows,
    });
  }

  // ------------------------------------------------------------- render

  function tabsNav() {
    return h(
      'nav',
      { class: 'tabs library-tabs', 'aria-label': 'Tipos de recurso' },
      ...TABS.filter((t) => RESOURCE_TAB_IDS.includes(t.id)).map((t) =>
        h(
          'a',
          { href: `#/recursos/${t.id}`, 'aria-current': t.id === tab.id ? 'page' : null },
          t.label,
          // Nombre accesible "Personal (5)": el número visible es decorativo.
          h('span', { class: 'tab-count', 'aria-hidden': 'true' }, String(list(t.type).length)),
          h('span', { class: 'sr-only' }, ` (${list(t.type).length})`),
        ),
      ),
    );
  }

  function notices() {
    const items = list(tab.type);
    const anyIllustrative = items.some((i) => i.illustrative);
    if (tab.type === 'agreements') {
      return anyIllustrative
        ? banner(ILLUSTRATIVE_AGREEMENT_NOTICE, 'warning', { title: 'Atención.' })
        : banner('RATEOS no trae valores legales: estos parámetros los cargaste vos. Mantenelos actualizados con tu convenio vigente.', 'info');
    }
    if (tab.type === 'equipment') {
      const fuel = data.settings.fuelPricePerLiter;
      return h(
        'div',
        { class: 'cost-legend' },
        h('div', { class: 'cost-legend-item cost-legend-ownership' }, h('strong', {}, 'COSTO DE POSESIÓN'), h('span', {}, 'Existe aunque el equipo no trabaje: amortización, seguro, patente, certificaciones y costo de capital.')),
        h('div', { class: 'cost-legend-item cost-legend-operation' }, h('strong', {}, 'COSTO DE OPERACIÓN'), h('span', {}, `Sólo cuando trabaja: mantenimiento, neumáticos y combustible (a ${formatValue(fuel, 'rate')}/L según Configuración).`)),
      );
    }
    if (tab.type === 'externalServices') {
      return banner('Tarifas NETAS (sin IVA). El costo de una cotización usa el neto más el IVA que NO recuperás y los cargos no recuperables; el IVA recuperable y las percepciones son caja adelantada, no costo.', anyIllustrative ? 'warning' : 'info', { title: anyIllustrative ? 'Ejemplos ILUSTRATIVOS.' : null });
    }
    if (anyIllustrative) return banner('Los ítems marcados ILUSTRATIVO tienen valores de demostración: reemplazalos por valores propios vigentes.', 'warning');
    return null;
  }

  function emptyFor() {
    return emptyState({
      icon: tab.icon,
      title: tab.emptyTitle,
      text: tab.emptyText,
      action: button(tab.addLabel, { variant: 'primary', icon: 'plus', onClick: () => openEditor(null) }),
    });
  }

  function tableFor() {
    const detailed = !VIEW_TABS.includes(tab.type) || resourceView === 'detailed';
    switch (tab.type) {
      case 'laborProfiles':
        return laborTable(detailed);
      case 'agreements':
        return agreementsTable();
      case 'equipment':
        return equipmentTable(detailed);
      case 'materials':
        return materialsTable(detailed);
      case 'externalServices':
        return externalTable();
      case 'equipmentModels':
        return h('div', {}, modelsTable(), familiesReference());
      default:
        return locationsTable();
    }
  }

  const VIEW_HINTS = Object.freeze({
    laborProfiles: 'Suma convenio, remunerativo, no remunerativo, neto y factor de cargas',
    equipment: 'Suma posesión, operación, utilización y costo por hora',
    materials: 'Suma costo unitario, base, merma, logística y markup de reventa',
  });

  /** Barra de la lista: cantidad y vista Simple / Detallada. */
  function listToolbar(count) {
    const countEl = h('span', { class: 'muted small toolbar-count' }, `${count} ${count === 1 ? 'ítem' : 'ítems'}`);
    if (!VIEW_TABS.includes(tab.type)) return null;
    const buttons = [
      { id: 'simple', label: 'Simple', title: 'Nombre, costo por día u hora, costo por mes y Editar' },
      { id: 'detailed', label: 'Detallada', title: VIEW_HINTS[tab.type] },
    ].map((v) =>
      h(
        'button',
        {
          type: 'button',
          class: 'segmented-btn',
          title: v.title,
          'aria-pressed': v.id === resourceView ? 'true' : 'false',
          on: {
            click: () => {
              if (resourceView === v.id) return;
              resourceView = v.id;
              paint({ keepFocus: v.id });
            },
          },
          dataset: { view: v.id },
        },
        v.label,
      ),
    );
    return h('div', { class: 'toolbar resource-toolbar' }, countEl, h('span', { class: 'spacer' }), h('div', { class: 'segmented', role: 'group', 'aria-label': 'Vista de la lista' }, ...buttons));
  }

  function introFor() {
    const extra =
      tab.id === 'personal'
        ? [' Las cargas sociales y los aumentos se cargan en ', h('a', { href: '#/recursos/convenios' }, 'Convenios'), '.']
        : [];
    return h('p', { class: 'resource-intro-text' }, tab.intro, ...extra);
  }

  function paint({ keepFocus = null } = {}) {
    const count = list(tab.type).length;
    const hasItems = count > 0;
    setHeader(hasItems);
    const headingId = uniqueId('recurso');
    mount(
      root,
      embedded ? null : tabsNav(),
      // Encabezado de la sección (para lectores de pantalla): la pestaña ya lo muestra.
      h('h2', { class: 'sr-only', id: headingId }, tab.label),
      h('div', { class: 'resource-intro' }, introFor(), embedded && hasItems ? addButton() : null),
      hasItems ? notices() : null,
      hasItems
        ? card(
            { className: 'list-card' },
            listToolbar(count),
            tableFor(),
            h('p', { class: 'footnote' }, tab.type === 'equipmentModels'
              ? 'El catálogo describe equipos; no tiene precios. Cambiar un modelo no modifica unidades ni cotizaciones.'
              : 'Cada cotización guarda una foto de estos valores con su base: cambiar un recurso no modifica las cotizaciones existentes (te avisa y podés actualizar a mano).'),
          )
        : h('div', {}, emptyFor(), tab.type === 'equipmentModels' ? card({ className: 'list-card' }, familiesReference()) : null),
    );
    if (keepFocus) {
      const again = root.querySelector(`.resource-toolbar [data-view="${keepFocus}"]`);
      if (again) again.focus();
    }
  }

  async function refresh() {
    await load();
    paint();
  }

  await refresh();
  return undefined;
}
