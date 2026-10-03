/**
 * Bibliotecas reutilizables: Personal, Convenios, Equipos, Materiales y
 * Ubicaciones. CRUD con diálogos; los cálculos (costo por persona, ficha de
 * equipo, costo de material) vienen de los servicios / motores.
 *
 * Los valores de las cotizaciones se COPIAN desde la biblioteca: editar o
 * borrar un recurso no cambia cotizaciones existentes.
 */

import { h, mount } from '../dom.js';
import {
  badge,
  banner,
  button,
  card,
  checkboxField,
  confirmDialog,
  emptyState,
  formGrid,
  kpi,
  numberField,
  openDialog,
  selectField,
  table,
  textField,
  traceButton,
} from '../components.js';
import { createTrace } from '../../core/trace.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../core/format.js';
import { isFiniteNumber, toNumber } from '../../core/money.js';
import { deepClone, getPath, setPath } from '../../core/object.js';
import { sanitizeText } from '../../core/validation.js';
import { AGREEMENT_TYPES, EQUIPMENT_TYPES, ILLUSTRATIVE_AGREEMENT_PARAMS, MATERIAL_BASES, MATERIAL_PROVIDERS, labelOf } from '../../domain/catalogs.js';
import { laborLoadFactor } from '../../engines/labor-engine.js';
import { computeMaterialLine } from '../../engines/materials-engine.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { render as renderNotFound } from './not-found.js';

// ----------------------------------------------------------------- catálogo

const TABS = Object.freeze([
  { id: 'personal', label: 'Personal', type: 'laborProfiles', addLabel: 'Agregar perfil', intro: 'Perfiles de personal reutilizables: rol, convenio, remuneración, cargas y costos por persona. Al sumar personal a una cotización se copian estos valores.' },
  { id: 'convenios', label: 'Convenios', type: 'agreements', addLabel: 'Nuevo convenio personalizado', intro: 'Parámetros por convenio (horas normales, recargo de horas extra, SAC, vacaciones, cargas patronales y ART). Se aplican a los perfiles de personal.' },
  { id: 'equipos', label: 'Equipos', type: 'equipment', addLabel: 'Agregar equipo', intro: 'Fichas de equipos y vehículos. RATEOS separa el COSTO DE POSESIÓN (existe aunque el equipo no trabaje) del COSTO DE OPERACIÓN (sólo cuando trabaja).' },
  { id: 'materiales', label: 'Materiales', type: 'materials', addLabel: 'Agregar material', intro: 'Materiales y consumibles con merma, logística y responsable de provisión.' },
  { id: 'ubicaciones', label: 'Ubicaciones', type: 'locations', addLabel: 'Agregar ubicación', intro: 'Bases operativas y destinos frecuentes con su distancia desde la base.' },
]);

const LOCATION_TYPES = Object.freeze([
  { id: 'base', label: 'Base operativa' },
  { id: 'destination', label: 'Destino / locación' },
]);

const BASIS_SUFFIX = Object.freeze({ per_month: '/mes', per_active_day: '/día activo', per_activation: '/activación' });

const AGREEMENT_PARAM_KEYS = Object.freeze(['normalHoursPerMonth', 'overtimePremiumPct', 'sacPct', 'vacationPct', 'employerContributionsPct', 'artPct']);

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
      'Posesión/mes = amortización + seguro + patente + certificaciones + costo de capital · Operación/h = mantenimiento + neumáticos + litros/h × precio combustible · $/mes = posesión + operación/h × horas usadas · $/hora = $/mes / horas usadas · $/día = $/mes / días usados',
    inputs: [
      { label: 'Valor de reposición', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil', value: o.lifeYears, format: 'number', unit: 'años' },
      { label: 'Seguro anual', value: o.insuranceMonthly * 12, format: 'money' },
      { label: 'Patente anual', value: o.licenseMonthly * 12, format: 'money' },
      { label: 'Certificaciones anuales', value: o.certificationsMonthly * 12, format: 'money' },
      { label: 'Costo de capital (anual)', value: toNumber(eq.capitalRatePctAnnual), format: 'percent' },
      { label: 'Mantenimiento por hora', value: op.maintenancePerHour, format: 'rate' },
      { label: 'Neumáticos por hora', value: op.tiresPerHour, format: 'rate' },
      { label: 'Consumo de combustible', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      { label: 'Precio del combustible (Configuración)', value: op.fuelPricePerLiter, format: 'rate' },
      { label: 'Horas disponibles por mes', value: cap.availableHoursPerMonth, format: 'hours' },
      { label: 'Días disponibles por mes', value: cap.availableDaysPerMonth, format: 'number', unit: 'días' },
      { label: 'Utilización esperada', value: cap.utilizationPct, format: 'percent' },
    ],
    steps: [
      { label: 'Amortización mensual', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones (mensual)', value: o.cashMonthly, format: 'money' },
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
      'La amortización y el costo de capital no son salidas de caja mensuales, pero sí son costo: el equipo se desgasta y el dinero invertido tiene un costo.',
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

// ---------------------------------------------------------- formulario genérico

function isBlankValue(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/**
 * Formulario de recurso en un diálogo.
 * sections: [{ title, hint?, cols?, fields: [field], extra?: ({ draft, rerender }) => Node }]
 * field: { key, label, kind: 'number'|'text'|'textarea'|'select'|'checkbox', rule?, unit?, hint?, required?, options?, includeEmpty?, emptyLabel?, maxLength?, rerender? }
 */
function openResourceForm(app, { title, initial, sections, preview = null, validate = null, onSave }) {
  const draft = deepClone(initial);
  const body = h('div', { class: 'resource-form' });
  const previewHost = preview ? h('div', { class: 'form-preview', 'aria-live': 'polite' }) : null;
  const allFields = sections.flatMap((s) => s.fields);
  let previewSeq = 0;

  const updatePreview = () => {
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
        return textField({ label: field.label, value: value ?? '', required: field.required, hint: field.hint, maxLength: field.maxLength || 120, placeholder: field.placeholder || '', onChange: set });
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
      default:
        return numberField({ label: field.label, value: isFiniteNumber(value) ? value : null, rule: field.rule || 'money', unit: field.unit || null, hint: field.hint, required: field.required, onChange: set });
    }
  };

  function rerender() {
    mount(
      body,
      draft.illustrative ? banner('Este ítem tiene valores ILUSTRATIVOS de demostración. Reemplazalos por valores propios vigentes y desmarcá "Valores ilustrativos".', 'warning') : null,
      ...sections.map((section) =>
        h(
          'fieldset',
          { class: 'form-section' },
          h('legend', {}, section.title),
          section.hint ? h('p', { class: 'form-section-hint' }, section.hint) : null,
          formGrid(section.cols || 3, ...section.fields.map(buildField)),
          section.extra ? section.extra({ draft, rerender }) : null,
        ),
      ),
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
      else if (f.kind === 'number' || !f.kind) setPath(entity, f.key, isFiniteNumber(v) ? v : 0);
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
      title: 'Remuneración (por persona)',
      fields: [
        { key: 'basicMonthly', label: 'Básico mensual', rule: 'money', unit: '$', required: true },
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

function equipmentSections() {
  return [
    {
      title: 'Equipo',
      cols: 2,
      fields: [
        { key: 'name', label: 'Nombre', kind: 'text', required: true, placeholder: 'Ej.: Camión con hidrogrúa 12 t' },
        { key: 'type', label: 'Tipo', kind: 'select', options: options(EQUIPMENT_TYPES) },
      ],
    },
    {
      title: 'COSTO DE POSESIÓN (existe aunque el equipo no trabaje)',
      fields: [
        { key: 'currentValue', label: 'Valor actual', rule: 'money', unit: '$', hint: 'Informativo. La amortización usa el valor de reposición.' },
        { key: 'replacementValue', label: 'Valor de reposición', rule: 'money', unit: '$', hint: 'Lo que costaría reemplazarlo hoy.' },
        { key: 'usefulLifeYears', label: 'Vida útil', rule: 'years', unit: 'años' },
        { key: 'residualValue', label: 'Valor residual', rule: 'money', unit: '$', hint: 'Valor estimado al final de la vida útil.' },
        { key: 'insuranceAnnual', label: 'Seguro anual', rule: 'money', unit: '$' },
        { key: 'licenseAnnual', label: 'Patente anual', rule: 'money', unit: '$' },
        { key: 'certificationsAnnual', label: 'Certificaciones e inspecciones (anual)', rule: 'money', unit: '$' },
        { key: 'capitalRatePctAnnual', label: 'Costo de capital (% anual)', rule: 'percent', unit: '%', hint: 'Lo que te cuesta tener plata invertida en el equipo. 0 si no lo considerás.' },
      ],
    },
    {
      title: 'COSTO DE OPERACIÓN (sólo cuando trabaja, por hora de uso)',
      fields: [
        { key: 'maintenancePerHour', label: 'Mantenimiento', rule: 'money', unit: '$/h' },
        { key: 'tiresPerHour', label: 'Neumáticos', rule: 'money', unit: '$/h' },
        { key: 'fuelLitersPerHour', label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', hint: 'El precio por litro se toma de Configuración.' },
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
    { title: 'Marca', cols: 2, fields: [illustrativeField] },
  ];
}

function newEquipment() {
  return {
    name: '',
    type: 'other',
    currentValue: 0,
    replacementValue: 0,
    usefulLifeYears: null,
    residualValue: 0,
    insuranceAnnual: 0,
    licenseAnnual: 0,
    certificationsAnnual: 0,
    capitalRatePctAnnual: 0,
    maintenancePerHour: 0,
    tiresPerHour: 0,
    fuelLitersPerHour: 0,
    availableHoursPerMonth: null,
    availableDaysPerMonth: 30,
    utilizationPct: null,
    illustrative: false,
  };
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
      fields: [
        { key: 'unitCost', label: 'Costo unitario', rule: 'money', unit: '$' },
        { key: 'quantity', label: 'Cantidad', rule: 'quantity' },
        { key: 'basis', label: 'Base de cálculo', kind: 'select', options: options(MATERIAL_BASES) },
        { key: 'wastePct', label: 'Merma', rule: 'percent', unit: '%' },
        { key: 'logisticsPct', label: 'Logística (flete, manipuleo)', rule: 'percent', unit: '%' },
        { key: 'resaleMarkupPct', label: 'Markup de reventa (sobre costo)', rule: 'percentOpen', unit: '%', hint: 'Sólo informativo. Es markup sobre costo, no margen.' },
      ],
    },
    { title: 'Marca', cols: 2, fields: [illustrativeField] },
  ];
}

function newMaterial() {
  return { description: '', unit: 'unidad', unitCost: 0, quantity: 1, basis: 'per_month', wastePct: 0, logisticsPct: 0, resaleMarkupPct: 0, providedBy: 'contractor', illustrative: false };
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

export async function render(root, app, params = {}) {
  const { ctx } = app;
  const tab = TABS.find((t) => t.id === (params.tab || 'personal'));
  if (!tab) return renderNotFound(root, app, { path: `/biblioteca/${params.tab}` });

  const data = { resources: {}, equipmentCards: new Map(), settings: {} };

  const addBtn = button(tab.addLabel, { variant: 'primary', icon: 'plus', onClick: () => openEditor(null) });
  app.setHeader({
    title: `Bibliotecas · ${tab.label}`,
    breadcrumbs: [
      { label: 'Inicio', href: '#/' },
      { label: 'Bibliotecas', href: '#/biblioteca' },
    ],
    actions: [addBtn],
  });

  const list = (type) => (Array.isArray(data.resources[type]) ? data.resources[type] : []);

  async function load() {
    const [resources, settings] = await Promise.all([ctx.resources.list(), app.getSettings()]);
    data.resources = resources || {};
    data.settings = settings || {};
    data.equipmentCards = new Map();
    if (tab.type === 'equipment') {
      const items = list('equipment');
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
      title: 'Eliminar de la biblioteca',
      message: `¿Eliminar "${displayName}"? Las cotizaciones que ya lo usan no cambian (guardan una copia de los valores).${extraMessage ? ` ${extraMessage}` : ''}`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.resources.remove(tab.type, item.id);
      app.toast('Eliminado de la biblioteca.', 'success');
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
          title: isNew ? 'Nuevo equipo' : `Editar equipo — ${item.name || ''}`,
          initial: isNew ? newEquipment() : item,
          sections: equipmentSections(),
          validate: (d) => (toNumber(d.residualValue) > toNumber(d.replacementValue) ? 'El valor residual no puede superar el valor de reposición.' : null),
          preview: async (draft) => {
            const c = await ctx.resources.equipmentCard(draft);
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
                { label: `Costo para nosotros (${BASIS_SUFFIX[c.basis] || '/mes'})`, value: formatMoney(c.costForUs), emphasis: true },
                { label: 'Costo bruto', value: formatMoney(c.grossCost) },
                { label: 'Precio de reventa (informativo)', value: formatMoney(c.resalePrice) },
              ],
              materialTrace(draft, c),
            );
          },
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

  function laborTable() {
    const agreements = list('agreements');
    const agreementName = (id) => {
      const a = agreements.find((x) => x.id === id);
      return a ? a.name : 'Sin convenio';
    };
    const rows = list('laborProfiles').map((p) => ({ item: p, cost: ctx.resources.laborProfileCost(p) }));
    return table({
      caption: 'Perfiles de personal',
      className: 'lib-table',
      columns: [
        { key: 'role', label: 'Rol', render: ({ item }) => nameCell(item.role, item.category, item.illustrative) },
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
        {
          key: 'actions',
          label: 'Acciones',
          align: 'right',
          render: ({ item }) => rowActions({ name: item.role || 'perfil', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.role || 'perfil') }),
        },
      ],
      rows,
    });
  }

  function agreementsTable() {
    const profiles = list('laborProfiles');
    const rows = list('agreements').map((a) => ({ item: a, p: { ...ILLUSTRATIVE_AGREEMENT_PARAMS, ...(a.params || {}) }, used: profiles.filter((p) => p.agreementId === a.id).length }));
    return table({
      caption: 'Convenios',
      className: 'lib-table',
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

  function equipmentTable() {
    const rows = list('equipment').map((eq) => ({ item: eq, c: data.equipmentCards.get(eq.id) })).filter((r) => r.c);
    return table({
      caption: 'Equipos',
      className: 'lib-table',
      columns: [
        { key: 'name', label: 'Equipo', render: ({ item }) => nameCell(item.name, labelOf(EQUIPMENT_TYPES, item.type, 'Otro'), item.illustrative) },
        { key: 'ownership', label: 'Posesión $/mes', align: 'right', className: 'col-ownership', render: ({ c }) => money(c.ownership.totalMonthly) },
        { key: 'operation', label: 'Operación $/h', align: 'right', className: 'col-operation', render: ({ c }) => rate(c.operation.totalPerHour) },
        { key: 'util', label: 'Utilización', align: 'right', render: ({ c }) => percent(c.capacity.utilizationPct) },
        { key: 'perHour', label: '$/hora', align: 'right', render: ({ c }) => rate(c.rates.costPerUsedHour) },
        { key: 'perDay', label: '$/día', align: 'right', render: ({ c }) => money(c.rates.costPerUsedDay) },
        { key: 'perMonth', label: '$/mes', align: 'right', render: ({ item, c }) => withTrace(h('strong', { class: 'nowrap' }, formatMoney(c.rates.costPerMonth)), equipmentTrace(item, c)) },
        { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.name || 'equipo', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.name || 'equipo') }) },
      ],
      rows,
    });
  }

  function materialsTable() {
    const rows = list('materials').map((m) => ({ item: m, c: computeMaterialLine(m) }));
    return table({
      caption: 'Materiales',
      className: 'lib-table',
      columns: [
        { key: 'description', label: 'Descripción', render: ({ item }) => nameCell(item.description, null, item.illustrative) },
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
        { key: 'cost', label: 'Costo para nosotros', align: 'right', render: ({ item, c }) => withTrace(h('span', { class: 'nowrap' }, h('strong', {}, formatMoney(c.costForUs)), h('span', { class: 'unit-suffix' }, ` ${BASIS_SUFFIX[c.basis] || ''}`)), materialTrace(item, c)) },
        { key: 'actions', label: 'Acciones', align: 'right', render: ({ item }) => rowActions({ name: item.description || 'material', onEdit: () => openEditor(item), onDelete: () => removeResource(item, item.description || 'material') }) },
      ],
      rows,
    });
  }

  function locationsTable() {
    const rows = list('locations').map((l) => ({ item: l }));
    return table({
      caption: 'Ubicaciones',
      className: 'lib-table',
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
      { class: 'tabs library-tabs', 'aria-label': 'Secciones de la biblioteca' },
      ...TABS.map((t) => h('a', { href: `#/biblioteca/${t.id}`, 'aria-current': t.id === tab.id ? 'page' : null }, t.label, h('span', { class: 'tab-count' }, String(list(t.type).length)))),
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
    if (anyIllustrative) return banner('Los ítems marcados ILUSTRATIVO tienen valores de demostración: reemplazalos por valores propios vigentes.', 'warning');
    return null;
  }

  function tableFor() {
    if (list(tab.type).length === 0) {
      return emptyState(`Todavía no hay ítems en ${tab.label.toLowerCase()}.`, button(tab.addLabel, { variant: 'primary', icon: 'plus', onClick: () => openEditor(null) }));
    }
    switch (tab.type) {
      case 'laborProfiles':
        return laborTable();
      case 'agreements':
        return agreementsTable();
      case 'equipment':
        return equipmentTable();
      case 'materials':
        return materialsTable();
      default:
        return locationsTable();
    }
  }

  function paint() {
    mount(
      root,
      tabsNav(),
      h('p', { class: 'page-intro' }, tab.intro),
      notices(),
      card({ title: tab.label, subtitle: 'Los valores se copian a cada cotización: cambiar la biblioteca no modifica cotizaciones existentes.' }, tableFor()),
    );
  }

  async function refresh() {
    await load();
    paint();
  }

  await refresh();
  return undefined;
}
