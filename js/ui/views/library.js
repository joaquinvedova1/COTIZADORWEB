/**
 * Recursos reutilizables: Personal, Equipos, Materiales y Ubicaciones
 * (#/recursos/:tab) y Convenios (se muestran dentro de Configuración →
 * Convenios con `renderAgreements`). CRUD con diálogos; los cálculos (costo
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
import { formatMoney, formatMoneyIn, formatNumber, formatPercent, formatValue, formatDayDate, EMPTY } from '../../core/format.js';
import { isFiniteNumber, toNumber } from '../../core/money.js';
import { deepClone, getPath, setPath } from '../../core/object.js';
import { sanitizeText } from '../../core/validation.js';
import { AGREEMENT_TYPES, ILLUSTRATIVE_AGREEMENT_PARAMS, MATERIAL_BASES, MATERIAL_PROVIDERS, ACQUISITION_MODES, EXTERNAL_UNITS, VAT_RECOVERY, MAINTENANCE_MODES, BUDGET_PERIODS, TIRE_MODES, labelOf } from '../../domain/catalogs.js';
import { conversionFactor, currencyOfBase } from '../../engines/currency-engine.js';
import { maintenanceOf } from '../../engines/equipment-engine.js';
import { wearNote } from '../equipment-wear-ui.js';
import { EQUIPMENT_FAMILIES, familyById, familyIdOf, familyVariants, modelLabel, suggestedMobility } from '../../domain/equipment-catalog.js';
import { emptyBase } from '../../domain/economic-base.js';
import { createExternalTerms, createEquipmentMobility, acquisitionOf } from '../../domain/quote-factory.js';
import { externalFiscal } from '../../engines/external-engine.js';
import { baseTag, baseFormFields } from '../economic-base-ui.js';
import { CURRENCY } from '../../config.js';
import { laborLoadFactor } from '../../engines/labor-engine.js';
import { computeMaterialLine } from '../../engines/materials-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { render as renderNotFound } from './not-found.js';

// ----------------------------------------------------------------- catálogo

const TABS = Object.freeze([
  {
    id: 'personal',
    label: 'Personal',
    type: 'laborProfiles',
    addLabel: 'Agregar perfil',
    icon: 'resources',
    intro: 'Cada puesto con su sueldo, convenio y cargas, calculado por persona. Al sumar personal a una cotización se copian estos valores.',
    emptyTitle: 'Todavía no agregaste personal.',
    emptyText: 'Cargá cada puesto una vez (sueldo, convenio y cargas) y reutilizalo en tus cotizaciones.',
  },
  {
    id: 'convenios',
    label: 'Convenios',
    type: 'agreements',
    addLabel: 'Nuevo convenio',
    icon: 'library',
    intro: 'Parámetros de cada convenio: horas normales, recargo de horas extra, SAC, vacaciones, cargas patronales y ART. Se aplican a los perfiles de personal.',
    emptyTitle: 'Todavía no cargaste convenios.',
    emptyText: 'Cargá los parámetros de tu convenio vigente una vez y aplicalos a cada perfil de personal.',
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

/** Pestañas visibles en Recursos (#/recursos/:tab). Convenios vive en Configuración. */
export const RESOURCE_TAB_IDS = Object.freeze(['personal', 'equipos', 'externos', 'materiales', 'ubicaciones', 'catalogo']);

const LOCATION_TYPES = Object.freeze([
  { id: 'base', label: 'Base operativa' },
  { id: 'destination', label: 'Destino / locación' },
]);

const BASIS_SUFFIX = Object.freeze({ per_month: '/mes', per_active_day: '/día activo', per_activation: '/llamado' });

/** Pestañas con vista Simple / Detallada (Ubicaciones ya es una tabla corta). */
const VIEW_TABS = Object.freeze(['laborProfiles', 'equipment', 'materials']);

/** Vista elegida (simple | detailed), sólo en memoria: se mantiene al cambiar de pestaña. */
let resourceView = 'simple';

const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);

/** Convención de montos de RATEOS (PLAN-2026-002, PN1): todo sin IVA. */
const VAT_HINT = 'Montos sin IVA: si tu proveedor te pasa un precio con IVA, descontalo antes de cargarlo.';
const ILLUSTRATIVE_AGREEMENT_NOTICE = 'Parámetros GENÉRICOS e ILUSTRATIVOS, no son valores de ningún CCT; cargá los vigentes.';

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
    formula: 'Costo mensual por persona = (Básico + Adicionales) × Factor de cargas + Seguros + EPP + Capacitación + Traslado · Factor de cargas = (1 + SAC % + Vacaciones %) × (1 + Cargas patronales % + ART %)',
    inputs: [
      { label: 'Básico mensual', value: p.basic, format: 'money' },
      { label: 'Adicionales mensuales', value: p.additionals, format: 'money' },
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
      { label: 'Remunerativo (básico + adicionales)', value: p.remunerative, format: 'money' },
      { label: 'SAC', value: p.sac, format: 'money' },
      { label: 'Vacaciones', value: p.vacation, format: 'money' },
      { label: 'Cargas patronales', value: p.employerContributions, format: 'money' },
      { label: 'ART', value: p.art, format: 'money' },
      { label: 'Remunerativo cargado', value: p.loadedRemunerative, format: 'money' },
      { label: 'No remunerativo (seguros, EPP, capacitación, traslado)', value: p.nonRemunerative, format: 'money' },
      { label: 'Factor de cargas', value: p.loadFactor, format: 'number' },
      { label: 'Costo hora cargado (costo mensual / horas normales)', value: p.loadedHourlyCost, format: 'rate' },
      { label: 'Variable por día activo (horas extra cargadas + vianda)', value: cost.perPosition.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Costo mensual por persona', value: p.fixedMonthly, format: 'money' },
    notes: [
      'La vianda y las horas extra no forman parte del costo mensual fijo: dentro de la cotización se suman por cada día activo.',
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
      { label: 'Consumo de combustible', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      { label: 'Precio del combustible (Configuración)', value: op.fuelPricePerLiter, format: 'rate' },
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
  const unit = (EXTERNAL_UNITS.find((u) => u.id === x.unit) || {}).short || '';
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
        return selectField({ label: field.label, value: getPath(draft, field.key) ?? '', options: opts, includeEmpty: field.includeEmpty, emptyLabel: field.emptyLabel, hint: field.hint, onChange: set });
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
        return numberField({ label: field.label, value: isFiniteNumber(value) ? value : null, rule: field.rule || 'money', unit: unit || null, hint: field.hint, required: field.required, placeholder: field.nullable ? 'Sin definir' : '', onChange: set });
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

  function rerender() {
    if (typeof prepare === 'function') prepare(draft);
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

function laborSections(agreements, app) {
  const agreementOptions = agreements.map((a) => ({ value: a.id, label: a.name || labelOf(AGREEMENT_TYPES, a.code, 'Convenio') }));
  return [
    {
      title: 'Puesto',
      fields: [
        { key: 'role', label: 'Rol / puesto', kind: 'text', required: true, placeholder: 'Ej.: Operador de hidrogrúa' },
        { key: 'agreementId', label: 'Convenio', kind: 'select', options: agreementOptions, includeEmpty: true, emptyLabel: 'Sin convenio' },
        { key: 'category', label: 'Categoría', kind: 'text', placeholder: 'Según tu convenio' },
      ],
    },
    {
      // El sueldo y su fecha base van juntos: sin período, nadie sabe de cuándo es el valor.
      title: 'Sueldo y base económica (por persona)',
      hint: 'De qué mes es este sueldo (y el resto de los valores de este perfil). Cada cotización guarda una foto: si después lo actualizás, las cotizaciones hechas no cambian.',
      cols: 4,
      fields: [
        { key: 'basicMonthly', label: 'Sueldo básico mensual', rule: 'money', unit: '$', required: true },
        ...baseFormFields('base', { periodLabel: 'Período base (mes del sueldo)' }),
      ],
    },
    {
      title: 'Adicionales y horas (por persona)',
      fields: [
        { key: 'additionalsMonthly', label: 'Adicionales mensuales', rule: 'money', unit: '$', hint: 'Zona, presentismo, títulos, etc.' },
        { key: 'mealPerActiveDay', label: 'Vianda por día activo', rule: 'money', unit: '$' },
        { key: 'normalHoursPerMonth', label: 'Horas normales por mes', rule: 'hours', unit: 'h' },
        { key: 'overtimeHoursPerActiveDay', label: 'Horas extra por día activo', rule: 'hoursPerDay', unit: 'h' },
        { key: 'overtimePremiumPct', label: 'Recargo de horas extra', rule: 'percentOpen', unit: '%' },
      ],
    },
    {
      title: 'Cargas sobre la remuneración',
      hint: 'Porcentajes de tu convenio vigente. RATEOS no trae valores legales: los parámetros de demostración son ILUSTRATIVOS.',
      cols: 4,
      fields: [
        { key: 'sacPct', label: 'SAC', rule: 'percent', unit: '%' },
        { key: 'vacationPct', label: 'Vacaciones', rule: 'percent', unit: '%' },
        { key: 'employerContributionsPct', label: 'Cargas patronales', rule: 'percent', unit: '%' },
        { key: 'artPct', label: 'ART', rule: 'percent', unit: '%' },
      ],
      extra: ({ draft, rerender }) =>
        h(
          'div',
          { class: 'form-section-actions' },
          button('Aplicar parámetros del convenio', {
            variant: 'secondary',
            size: 'sm',
            icon: 'check',
            onClick: () => {
              const agreement = agreements.find((a) => a.id === draft.agreementId);
              if (!agreement) {
                app.toast('Elegí un convenio para aplicar sus parámetros.', 'warning');
                return;
              }
              const params = { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(agreement.params || {}) };
              AGREEMENT_PARAM_KEYS.forEach((k) => {
                draft[k] = toNumber(params[k], 0);
              });
              if (agreement.illustrative) draft.illustrative = true;
              rerender();
              app.toast(`Se aplicaron los parámetros de "${agreement.name}": horas normales, recargo de horas extra, SAC, vacaciones, cargas y ART.`, 'info');
            },
          }),
          h('span', { class: 'muted small' }, 'Copia horas normales, recargo HE, SAC, vacaciones, cargas patronales y ART del convenio elegido.'),
        ),
    },
    {
      title: 'Otros costos por persona (mensuales)',
      cols: 4,
      fields: [
        { key: 'insuranceMonthly', label: 'Seguros', rule: 'money', unit: '$' },
        { key: 'ppeMonthly', label: 'EPP', rule: 'money', unit: '$' },
        { key: 'trainingMonthly', label: 'Capacitación', rule: 'money', unit: '$' },
        { key: 'transferMonthly', label: 'Traslado', rule: 'money', unit: '$' },
      ],
    },
    { title: 'Marca', cols: 2, fields: [illustrativeField] },
  ];
}

function newLaborProfile(agreements) {
  const agreement = agreements[0] || null;
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
    sacPct: params.sacPct,
    vacationPct: params.vacationPct,
    employerContributionsPct: params.employerContributionsPct,
    artPct: params.artPct,
    insuranceMonthly: 0,
    ppeMonthly: 0,
    trainingMonthly: 0,
    transferMonthly: 0,
    base: emptyBase({ currency: CURRENCY }),
    illustrative: Boolean(agreement && agreement.illustrative),
  };
}

function agreementSections() {
  return [
    {
      title: 'Convenio',
      cols: 2,
      fields: [
        { key: 'name', label: 'Nombre', kind: 'text', required: true, placeholder: 'Ej.: Petroleros Privados — mi categoría' },
        { key: 'code', label: 'Tipo de convenio', kind: 'select', options: options(AGREEMENT_TYPES) },
      ],
    },
    {
      title: 'Parámetros',
      hint: ILLUSTRATIVE_AGREEMENT_NOTICE,
      fields: [
        { key: 'params.normalHoursPerMonth', label: 'Horas normales por mes', rule: 'hours', unit: 'h' },
        { key: 'params.overtimePremiumPct', label: 'Recargo de horas extra', rule: 'percentOpen', unit: '%' },
        { key: 'params.sacPct', label: 'SAC', rule: 'percent', unit: '%' },
        { key: 'params.vacationPct', label: 'Vacaciones', rule: 'percent', unit: '%' },
        { key: 'params.employerContributionsPct', label: 'Cargas patronales', rule: 'percent', unit: '%' },
        { key: 'params.artPct', label: 'ART', rule: 'percent', unit: '%' },
      ],
    },
    { title: 'Notas y marca', cols: 2, fields: [{ key: 'notes', label: 'Notas', kind: 'textarea', maxLength: 600 }, illustrativeField] },
  ];
}

const ACQ_OPTIONS = ACQUISITION_MODES.map((a) => ({ value: a.id, label: a.label }));
const UNIT_OPTIONS = EXTERNAL_UNITS.map((u) => ({ value: u.id, label: u.label }));
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
        { key: 'external.unit', label: 'Por', kind: 'select', options: UNIT_OPTIONS },
        { key: 'external.minimumUnits', label: 'Mínimo por llamado (opcional)', rule: 'quantity', nullable: true, hint: 'Ej.: mínimo 8 h o 3 días.' },
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
        { key: 'external.fuelLitersPerHour', label: 'Consumo (si el combustible es tuyo)', rule: 'quantity', unit: 'L/h', when: (d) => d.external && d.external.fuelIncluded === false },
        { key: 'external.mobilizationIncluded', label: 'Movilización incluida', kind: 'tristate', rerender: true },
        { key: 'external.mobilizationAmount', label: 'Movilización por llamado', rule: 'money', unit: (d) => currencySymbol(d), when: (d) => d.external && d.external.mobilizationIncluded === false },
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

/** Movilidad de una unidad: ¿cómo se traslada? (sugerida por su familia, siempre editable). */
function mobilitySection() {
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
      { key: 'mobility.travelLitersPer100Km', label: 'Consumo trasladándose', rule: 'quantity', unit: 'L/100 km' },
      { key: 'mobility.travelCostPerKm', label: 'Mantenimiento y neumáticos en ruta', rule: 'money', unit: '$/km', hint: 'Si cargaste los neumáticos como juego + vida útil en km, acá va sólo el mantenimiento en ruta (los neumáticos se suman aparte).' },
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
            { key: 'capitalRatePctAnnual', label: 'Costo de capital (% anual)', rule: 'percent', unit: '%', hint: 'Lo que te cuesta tener plata invertida en el equipo. 0 si no lo considerás.' },
            ...baseFormFields('costsBase', { periodLabel: 'Base de estos costos (mes)' }),
          ],
        },
        ...wearSections(settings),
        {
          title: 'Combustible (sólo cuando trabaja, por hora de uso)',
          cols: 2,
          fields: [
            { key: 'fuelLitersPerHour', label: 'Consumo trabajando', rule: 'quantity', unit: 'L/h', hint: 'Litros por hora de trabajo. El precio por litro se toma de Configuración.' },
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
    sections.push(mobilitySection(), { title: 'Marca', cols: 2, fields: [illustrativeField] });
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

function materialSections() {
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
        { key: 'unitCost', label: 'Costo unitario', rule: 'money', unit: '$' },
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
 * Recursos: #/recursos/:tab (personal, equipos, materiales, ubicaciones).
 */
export async function render(root, app, params = {}) {
  const tabId = params.tab || 'personal';
  const tab = RESOURCE_TAB_IDS.includes(tabId) ? TABS.find((t) => t.id === tabId) : null;
  if (!tab) return renderNotFound(root, app, { path: `/recursos/${params.tab}` });
  return renderLibraryTab(root, app, tab, { embedded: false });
}

/**
 * Gestión de convenios (se muestra dentro de Configuración → Convenios).
 * No cambia la topbar: el botón "Nuevo convenio" va dentro del contenido.
 */
export async function renderAgreements(root, app) {
  return renderLibraryTab(root, app, TABS.find((t) => t.id === 'convenios'), { embedded: true });
}

async function renderLibraryTab(root, app, tab, { embedded = false } = {}) {
  const { ctx } = app;
  const data = { resources: {}, equipmentCards: new Map(), settings: {} };

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
    const [resources, settings] = await Promise.all([ctx.resources.list(), app.getSettings()]);
    data.resources = resources || {};
    data.settings = settings || {};
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
        const agreements = list('agreements');
        openResourceForm(app, {
          title: isNew ? 'Nuevo perfil de personal' : `Editar perfil — ${item.role || ''}`,
          initial: isNew ? newLaborProfile(agreements) : item,
          sections: laborSections(agreements, app),
          preview: (draft) => {
            const cost = ctx.resources.laborProfileCost(draft);
            return previewKpis(
              [
                { label: 'Costo mensual por persona', value: formatMoney(cost.perPerson.fixedMonthly), emphasis: true },
                { label: 'Costo hora cargado', value: formatValue(cost.perPerson.loadedHourlyCost, 'rate') },
                { label: 'Factor de cargas', value: factorText(cost.perPerson.loadFactor) },
                { label: 'Variable por día activo', value: formatMoney(cost.perPosition.variablePerActiveDay), hint: 'Horas extra cargadas + vianda' },
              ],
              laborTrace(draft, cost),
            );
          },
          onSave,
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
          onSave,
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
          sections: materialSections(),
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
          { key: 'role', label: 'Puesto', render: ({ item }) => nameCell(item.role, item.category, item.illustrative) },
          laborBaseColumn,
          { key: 'hourly', label: 'Costo por hora', align: 'right', render: ({ cost }) => rate(cost.perPerson.loadedHourlyCost) },
          { key: 'monthly', label: 'Costo por mes (por persona)', align: 'right', render: ({ item, cost }) => withTrace(h('strong', { class: 'nowrap' }, formatMoney(cost.perPerson.fixedMonthly)), laborTrace(item, cost)) },
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
          label: 'Básico + adicionales',
          align: 'right',
          render: ({ item }) => h('div', { class: 'cell-main cell-num' }, money(item.basicMonthly), h('span', { class: 'cell-sub nowrap' }, `+ ${formatMoney(toNumber(item.additionalsMonthly, 0))} adicionales`)),
        },
        { key: 'monthly', label: 'Costo mensual por persona', align: 'right', render: ({ item, cost }) => withTrace(h('strong', { class: 'nowrap' }, formatMoney(cost.perPerson.fixedMonthly)), laborTrace(item, cost)) },
        { key: 'hourly', label: 'Costo hora cargado', align: 'right', render: ({ cost }) => rate(cost.perPerson.loadedHourlyCost) },
        { key: 'factor', label: 'Factor de cargas', align: 'right', render: ({ cost }) => h('span', { class: 'mono nowrap' }, factorText(cost.perPerson.loadFactor)) },
        actions,
      ],
      rows,
    });
  }

  function agreementsTable() {
    const profiles = list('laborProfiles');
    const rows = list('agreements').map((a) => ({ item: a, p: { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(a.params || {}) }, used: profiles.filter((p) => p.agreementId === a.id).length }));
    return table({
      caption: 'Convenios',
      className: 'lib-table table-cards',
      columns: [
        { key: 'name', label: 'Convenio', render: ({ item }) => nameCell(item.name, labelOf(AGREEMENT_TYPES, item.code, 'Personalizado'), item.illustrative) },
        { key: 'hours', label: 'Horas normales/mes', align: 'right', render: ({ p }) => formatNumber(toNumber(p.normalHoursPerMonth, NaN), { decimals: 2 }) },
        { key: 'ot', label: 'Recargo HE', align: 'right', render: ({ p }) => percent(toNumber(p.overtimePremiumPct, NaN)) },
        { key: 'sac', label: 'SAC', align: 'right', render: ({ p }) => percent(toNumber(p.sacPct, NaN)) },
        { key: 'vac', label: 'Vacaciones', align: 'right', render: ({ p }) => percent(toNumber(p.vacationPct, NaN)) },
        { key: 'contrib', label: 'Cargas patronales', align: 'right', render: ({ p }) => percent(toNumber(p.employerContributionsPct, NaN)) },
        { key: 'art', label: 'ART', align: 'right', render: ({ p }) => percent(toNumber(p.artPct, NaN)) },
        { key: 'factor', label: 'Factor de cargas', align: 'right', render: ({ item, p }) => withTrace(h('span', { class: 'mono nowrap' }, factorText(laborLoadFactor(p))), agreementTrace(item)) },
        { key: 'used', label: 'Perfiles', align: 'right', render: ({ used }) => formatNumber(used) },
        {
          key: 'actions',
          label: 'Acciones',
          align: 'right',
          render: ({ item, used }) =>
            rowActions({
              name: item.name || 'convenio',
              onEdit: () => openEditor(item),
              onDelete: () => removeResource(item, item.name || 'convenio', used ? `${used === 1 ? 'Hay 1 perfil' : `Hay ${used} perfiles`} de personal que lo usan: quedarán sin convenio asignado.` : ''),
            }),
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
      return h('span', { class: 'nowrap' }, h('strong', {}, formatMoneyIn(toNumber(x.price, 0), item.base && item.base.currency)), h('span', { class: 'unit-suffix' }, ` ${(EXTERNAL_UNITS.find((u) => u.id === x.unit) || {}).short || ''}`));
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
            return h('div', { class: 'cell-main cell-num' }, h('strong', { class: 'nowrap' }, `${formatMoneyIn(toNumber(x.price, 0), item.base && item.base.currency)} ${(EXTERNAL_UNITS.find((u) => u.id === x.unit) || {}).short || ''}`), toNumber(x.minimumUnits, 0) > 0 ? h('span', { class: 'cell-sub' }, `Mínimo ${formatNumber(toNumber(x.minimumUnits, 0), { decimals: 2 })}`) : null);
          },
        },
        { key: 'includes', label: 'Incluye', render: ({ item }) => includesText(item.external) },
        { key: 'fiscal', label: 'IVA', render: ({ item }) => fiscalBadge(item.external) },
        { key: 'valid', label: 'Vigencia', render: ({ item }) => (item.external && item.external.validUntil ? `Hasta ${formatDayDate(item.external.validUntil)}` : badge('Sin vigencia', 'orange')) },
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
    laborProfiles: 'Suma convenio, básico y adicionales y factor de cargas',
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
        ? [' Los convenios se configuran en ', h('a', { href: '#/configuracion/convenios' }, 'Configuración → Convenios'), '.']
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
