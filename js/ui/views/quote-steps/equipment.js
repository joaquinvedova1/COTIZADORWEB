/**
 * Etapa 2 · Los recursos — Equipos.
 *
 * PROPIOS: separa COSTO DE TENERLO / posesión (existe aunque el equipo no
 * trabaje) de COSTO DE USARLO / operación (existe sólo cuando trabaja).
 * Básico: nombre, cantidad, horas por día, valor de reposición, vida útil y
 * consumo. Opciones avanzadas (con resumen visible): residual, seguro,
 * patente, otros costos, certificaciones, costo de capital, mantenimiento y
 * neumáticos.
 *
 * ALQUILADOS / TERCERIZADOS (PLAN-2026-005): no son activos propios (sin
 * amortización ni seguro propio). Tarifa NETA del proveedor por unidad, con
 * mínimo, qué incluye (operador, combustible, movilización, seguro) y su
 * tratamiento fiscal (IVA recuperable o no, percepciones): el costo es el
 * económico; la salida de caja y el crédito fiscal se informan aparte.
 *
 * Cada línea guarda los valores que usó (snapshot): si cambian en Recursos,
 * se avisa y la persona decide (nunca se actualiza sola).
 */

import { h, mount } from '../../dom.js';
import { badge, card, dateField, formGrid, selectField, triStateField, confirmDialog, emptyState, icon } from '../../components.js';
import { equipmentLineFromLibrary, externalLineFromService, blankEquipmentLine, createExternalTerms, createMobilization, acquisitionOf } from '../../../domain/quote-factory.js';
import { ACQUISITION_MODES, CURRENCIES, EXTERNAL_UNITS, VAT_RECOVERY, MAINTENANCE_MODES, BUDGET_PERIODS, TIRE_MODES, labelOf } from '../../../domain/catalogs.js';
import { computeEquipmentUnit, maintenanceOf, tiresOf } from '../../../engines/equipment-engine.js';
import { wearNote, wearWarnings } from '../../equipment-wear-ui.js';
import { monthsFactor } from '../../../engines/cost-engine.js';
import { conversionFactor } from '../../../engines/currency-engine.js';
import { formatMoney, formatNumber, formatPercent, formatValue, EMPTY } from '../../../core/format.js';
import { createTrace } from '../../../core/trace.js';
import { illustrativeTag } from '../../layout.js';
import { hasNumber, moneyText, plural, stepName } from './shared.js';
import { baseFields, lineOriginBlock, quoteCurrencyOf, resourceSyncNotice } from './resource-line.js';
import { baseText } from '../../economic-base-ui.js';
import { MOBILIZATION_MODES } from '../../../domain/catalogs.js';

const isExternalLine = (line) => acquisitionOf(line) !== 'owned';

/** Símbolo de la moneda de un valor ("$", "US$"). */
function currencyUnit(base, quote) {
  const code = base && typeof base.currency === 'string' && base.currency ? base.currency : quoteCurrencyOf(quote);
  const c = CURRENCIES.find((x) => x.id === code);
  return c ? c.symbol : '$';
}

const unitShort = (unit) => (EXTERNAL_UNITS.find((u) => u.id === unit) || EXTERNAL_UNITS[1]).short;

/** "Por qué" de cada unidad de tarifa (cómo se cuentan las unidades por llamado). */
const UNIT_HINTS = Object.freeze({
  hour: 'Unidades por llamado = horas de uso por día × días por llamado.',
  day: 'Unidades por llamado = días por llamado.',
  month: 'Costo fijo por mes (trabaje o no).',
  trip: 'Unidades por llamado = viajes de ida o vuelta (de "Viajes").',
  km: 'Unidades por llamado = km de ruta por llamado (de "Viajes").',
  activation: 'Un cobro por cada llamado.',
  global: 'Monto por todo el contrato, repartido en los meses de contrato.',
});

/** Ficha del equipo a la utilización de la cotización (por unidad). */
export function equipmentCardAtQuote(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const activity = result.activity;
  const hours = line.hoursPerActiveDay;
  // Mismo tipo de cambio que el costo de la cotización (un valor en USD no se mezcla con pesos).
  const f = Number.isFinite(line.conversion) ? line.conversion : 1;
  const src = source || {};
  return computeEquipmentUnit(
    {
      ...src,
      replacementValue: (Number(src.replacementValue) || 0) * f,
      residualValue: (Number(src.residualValue) || 0) * f,
      availableHoursPerMonth: activity.availableDaysPerMonth * hours,
      availableDaysPerMonth: activity.availableDaysPerMonth,
      utilizationPct: activity.utilizationPct,
    },
    { fuelPricePerLiter: result.model.fuel.pricePerLiter, fuelPaidByUs: result.model.fuel.paidByUs },
  );
}

function monthlyAtEstimate(result, line) {
  const D = result.activity.activeDaysPerMonth;
  return line.fixedMonthly * monthsFactor(D, result.activity.availableDaysPerMonth) + line.variablePerActiveDay * D;
}

function equipmentTrace(result, index, source) {
  const line = result && result.model.equipment[index];
  if (!line) return null;
  const o = line.ownership;
  const op = line.operation;
  return createTrace({
    id: 'equipment_line',
    title: `Equipo — ${line.name || 'Equipo'}`,
    formula: 'Posesión/mes = (reposición − residual) / (vida útil × 12) + (seguro + patente + certificaciones + otros) / 12 + mantenimiento fijo (presupuesto) + inversión promedio × tasa de capital / 12 · Operación/h = mantenimiento/h + neumáticos/h + litros/h × precio combustible (service = costo / horas entre services; juego = costo / vida útil en horas) · Costo del mes = posesión × cantidad + operación/h × horas por día × días activos × cantidad',
    inputs: [
      line.conversion !== undefined && line.conversion !== 1 ? { label: `Tipo de cambio de la cotización (${(source && source.base && source.base.currency) || ''})`, value: line.conversion, format: 'number' } : null,
      { label: 'Valor de reposición (en la moneda de la cotización)', value: o.replacement, format: 'money' },
      { label: 'Valor residual', value: o.residual, format: 'money' },
      { label: 'Vida útil (años)', value: o.lifeYears, format: 'number' },
      { label: 'Cantidad', value: line.quantity, format: 'number' },
      { label: 'Horas de uso por día activo', value: line.hoursPerActiveDay, format: 'hours' },
      { label: 'Días activos por mes', value: result.activity.activeDaysPerMonth, format: 'days' },
      { label: 'Precio combustible (si lo pagamos)', value: op.fuelPricePerLiter, format: 'rate' },
      { label: 'Consumo', value: op.fuelLitersPerHour, format: 'number', unit: 'L/h' },
      { label: `Mantenimiento (${labelOf(MAINTENANCE_MODES, op.maintenanceMode, 'por hora').toLowerCase()})`, value: o.maintenanceFixedMonthly > 0 ? o.maintenanceFixedMonthly : op.maintenancePerHour, format: 'money', unit: o.maintenanceFixedMonthly > 0 ? 'por mes (fijo)' : 'por hora' },
      { label: `Neumáticos (${labelOf(TIRE_MODES, op.tiresMode, 'por hora').toLowerCase()})`, value: op.tiresPerKm > 0 ? op.tiresPerKm : op.tiresPerHour, format: 'money', unit: op.tiresPerKm > 0 ? 'por km (en la ruta)' : 'por hora' },
    ].filter(Boolean),
    steps: [
      { label: 'Amortización mensual (por unidad)', value: o.depreciationMonthly, format: 'money' },
      { label: 'Seguro + patente + certificaciones + otros + mantenimiento fijo (por unidad)', value: o.cashMonthly, format: 'money' },
      { label: 'Costo de capital mensual (por unidad)', value: o.capitalCostMonthly, format: 'money' },
      { label: 'Posesión mensual × cantidad', value: line.fixedMonthly, format: 'money' },
      { label: 'Operación por hora (por unidad)', value: op.totalPerHour, format: 'money' },
      { label: 'Operación por día activo × cantidad', value: line.variablePerActiveDay, format: 'money' },
    ],
    result: { label: 'Costo del equipo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'La amortización y el costo de capital no son salidas de caja: no se financian en el costo financiero.',
      source && (source.hoursPerActiveDay === null || source.hoursPerActiveDay === undefined || source.hoursPerActiveDay === '')
        ? 'Horas de uso vacías: se usan las horas por día activo de la cotización.'
        : null,
    ],
  });
}

/** Resumen corto de mantenimiento y neumáticos según cómo se cargaron. */
function wearSummary(e = {}) {
  const m = maintenanceOf(e);
  const t = tiresOf(e);
  const maintenance = m.mode === 'budget'
    ? `mantenimiento fijo ${formatMoney(m.fixedMonthly)}/mes`
    : `mantenimiento ${formatMoney(m.perHour)}/h${m.mode === 'service' ? ' (service)' : ''}`;
  const tires = t.mode === 'set_km' ? `neumáticos ${formatMoney(t.perKm, { decimals: 2 })}/km` : `neumáticos ${formatMoney(t.perHour)}/h${t.mode === 'set_hours' ? ' (juego)' : ''}`;
  return { maintenance, tires };
}

function externalTrace(result, index, source) {
  const line = result && result.model.equipment[index];
  const x = line && line.external;
  if (!x) return null;
  const f = x.fiscal;
  return createTrace({
    id: 'external_line',
    title: `${x.acquisition === 'rented' ? 'Alquiler' : 'Servicio tercerizado'} — ${x.name || 'Externo'}`,
    formula: 'Facturado por llamado = máx(unidades por llamado, mínimo) × tarifa neta × cantidad · Costo económico = neto × (1 + cargos no recuperables % + IVA % × (1 − parte recuperable)) · Por día activo = por llamado / días por llamado',
    inputs: [
      x.conversion !== 1
        ? { label: `Tarifa neta (sin IVA) ${unitShort(x.unit)} en ${(source && source.base && source.base.currency) || 'otra moneda'}`, value: x.priceOriginal, format: 'number' }
        : { label: `Tarifa neta (sin IVA) ${unitShort(x.unit)}`, value: x.priceOriginal, format: 'money' },
      x.conversion !== 1 ? { label: 'Tipo de cambio de la cotización', value: x.conversion, format: 'number' } : null,
      x.conversion !== 1 ? { label: 'Tarifa neta convertida', value: x.price, format: 'money' } : null,
      { label: 'Unidades por llamado', value: x.unitsPerActivation, format: 'number' },
      { label: 'Mínimo facturable', value: x.minimum, format: 'number' },
      { label: 'Cantidad', value: x.quantity, format: 'number' },
      { label: 'Días por llamado', value: result.activity.daysPerActivation, format: 'days' },
      { label: 'IVA del proveedor', value: f.vatPct, format: 'percent' },
      { label: 'Parte del IVA que recuperás', value: f.recoverableShare * 100, format: 'percent' },
      { label: 'Cargos no recuperables', value: f.nonRecoverablePct, format: 'percent' },
    ].filter(Boolean),
    steps: [
      { label: 'Unidades facturadas por llamado', value: x.billedUnitsPerActivation, format: 'number' },
      { label: 'Neto facturado por llamado', value: x.netPerActivation, format: 'money' },
      { label: 'Fijo mensual neto (tarifas por mes o globales)', value: x.netFixedMonthly, format: 'money' },
      { label: 'Costo económico por día activo', value: x.variablePerActiveDay, format: 'money' },
      x.mobilizationPerActiveDay > 0 ? { label: 'Movilización del proveedor por día activo', value: x.mobilizationPerActiveDay, format: 'money' } : null,
      x.fuelPerActiveDay > 0 ? { label: 'Combustible no incluido por día activo', value: x.fuelPerActiveDay, format: 'money' } : null,
      { label: 'Salida de caja con impuestos por día activo (informativo)', value: x.cashPerActiveDay, format: 'money' },
      { label: 'Crédito fiscal por día activo (no es costo)', value: x.creditPerActiveDay, format: 'money' },
    ].filter(Boolean),
    result: { label: 'Costo del recurso externo en el mes (actividad estimada)', value: monthlyAtEstimate(result, line), format: 'money' },
    notes: [
      'El IVA recuperable y las percepciones son caja que se adelanta, no costo: no se suman al costo de la cotización.',
      f.recovery === null ? 'Sin definir si el IVA es recuperable: se usa el precio neto (sin IVA).' : null,
      'Sin amortización, seguro propio ni costo de capital: el equipo no es tuyo.',
      'Ganancias no se carga como % sobre el alquiler y el IIBB del proveedor ya está en su precio.',
    ],
  });
}

export function render(container, ctx) {
  const { quote, kit, resources } = ctx;
  const library = Array.isArray(resources.equipment) ? resources.equipment : [];
  const services = Array.isArray(resources.externalServices) ? resources.externalServices : [];
  const lines = quote.equipment;
  const activityHours = quote.activity ? quote.activity.hoursPerActiveDay : null;
  const currency = quoteCurrencyOf(quote);
  const hoursDefault = () => (Number.isFinite(Number(activityHours)) && activityHours !== null ? Number(activityHours) : null);

  let selectedId = null;
  const addFromLibrary = () => {
    const [kind, id] = String(selectedId || '').split(':');
    const eq = kind === 'eq' ? library.find((e) => e.id === id) : null;
    const service = kind === 'ext' ? services.find((e) => e.id === id) : null;
    if (!eq && !service) {
      ctx.toast('Elegí un equipo o un servicio externo de tus recursos para agregarlo.', 'warning');
      return;
    }
    const opts = { hoursPerActiveDay: hoursDefault(), now: new Date().toISOString(), currency };
    const line = eq ? equipmentLineFromLibrary(eq, opts) : externalLineFromService(service, opts);
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.quantity` });
    ctx.toast(`Se agregó "${line.name}" con los valores que tiene hoy en Recursos (y su fecha base). Si después cambian, esta cotización no cambia sola.`, 'success');
  };
  const addBlank = (acquisition = 'owned') => {
    const line = blankEquipmentLine({ acquisition, hoursPerActiveDay: null, currency });
    const index = lines.length;
    ctx.mutate((q) => q.equipment.push(line), { focus: `equipment.${index}.name` });
  };
  const removeLine = async (index) => {
    const line = quote.equipment[index];
    if (!line) return;
    const ok = await confirmDialog({
      title: 'Quitar equipo',
      message: `¿Quitar "${line.name || 'Equipo'}" de esta cotización? Esto no modifica tus recursos.`,
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (!ok) return;
    ctx.mutate((q) => {
      const removed = q.equipment.splice(index, 1)[0];
      // Si otro equipo lo usaba para trasladarse, queda "sin definir" (no apunta a nada).
      if (removed && removed.id) {
        q.equipment.forEach((e) => {
          if (e && e.mobilization && e.mobilization.carrierLineId === removed.id) {
            e.mobilization.carrierLineId = null;
          }
        });
      }
    });
  };
  /** Cambiar propio ↔ alquilado ↔ tercerizado (conserva lo cargado). */
  const setAcquisition = (index, value) => {
    let reset = false;
    ctx.mutate((q) => {
      const line = q.equipment[index];
      if (!line) return;
      const before = acquisitionOf(line);
      line.acquisition = ['owned', 'rented', 'outsourced'].includes(value) ? value : 'owned';
      // Propio ↔ externo: la base deja de describir el mismo valor (valor del
      // equipo vs tarifa del proveedor, quizás en otra moneda): se reinicia en
      // la moneda de la cotización y sin fecha (nunca se arrastra un USD a la tarifa).
      if ((before === 'owned') !== (line.acquisition === 'owned')) {
        line.base = { period: null, currency, source: null, note: '' };
        reset = true;
      }
      if (line.acquisition !== 'owned') line.external = createExternalTerms(line.external);
      if (!line.mobilization) line.mobilization = createMobilization();
    });
    if (reset) ctx.toast(`La fecha base y la moneda de esta línea se reiniciaron (${currency}, sin fecha): cargá las del nuevo valor en "Fecha base y moneda".`, 'info');
  };

  const pickerOptions = [
    ...library.map((e) => ({ value: `eq:${e.id}`, label: `${e.internalCode ? `${e.internalCode} · ` : ''}${e.name || 'Equipo sin nombre'} (${labelOf(ACQUISITION_MODES, acquisitionOf(e), 'Propio').toLowerCase()})` })),
    ...services.map((e) => ({ value: `ext:${e.id}`, label: `Externo · ${e.name || 'Servicio sin nombre'}${e.external && e.external.supplier ? ` — ${e.external.supplier}` : ''}` })),
  ];

  const toolbar = h(
    'div',
    { class: 'qe-toolbar' },
    h(
      'div',
      { class: 'qe-toolbar-pick' },
      selectField({
        label: 'Agregar desde tus recursos (Mis equipos y Externos)',
        value: null,
        includeEmpty: true,
        emptyLabel: pickerOptions.length ? 'Elegí un equipo o servicio…' : 'Todavía no cargaste equipos ni servicios externos',
        options: pickerOptions,
        onChange: (v) => {
          selectedId = v;
        },
      }),
      kit.action('Agregar', addFromLibrary, { variant: 'primary', icon: 'plus', size: 'md' }),
    ),
    kit.action('Agregar equipo propio en blanco', () => addBlank('owned'), { icon: 'plus', size: 'md' }),
    kit.action('Agregar alquilado o tercerizado', () => addBlank('rented'), { icon: 'plus', size: 'md' }),
  );

  const fuelNote = h(
    'div',
    { class: 'qe-tip' },
    icon('info'),
    kit.out((r) => {
      if (!r.model.fuel.paidByUs) return `El combustible lo provee el cliente: no se suma al costo de uso (se define en "${stepName('logistics')}").`;
      const fuelIllustrative = Boolean(quote.illustrative || (quote.fuel && quote.fuel.illustrative === true));
      return `Combustible: ${formatValue(r.model.fuel.pricePerLiter, 'rate')} por litro (se edita en "${stepName('logistics')}").${fuelIllustrative ? ' Es un valor ILUSTRATIVO: confirmalo con tu precio actual.' : ''}`;
    }, { tag: 'p' }),
  );

  const operatorOptions = () => (Array.isArray(quote.labor) ? quote.labor : [])
    .filter((l) => l && typeof l.id === 'string')
    .map((l) => ({ value: l.id, label: l.role || 'Puesto sin nombre' }));
  const acquisitionField = (i) => {
    const current = acquisitionOf(quote.equipment[i]);
    return selectField({
      label: '¿Cómo lo obtenés?',
      name: `equipment.${i}.acquisition`,
      value: current,
      options: ACQUISITION_MODES.map((m) => ({ value: m.id, label: m.label })),
      hint: (ACQUISITION_MODES.find((m) => m.id === current) || ACQUISITION_MODES[0]).hint,
      disabled: ctx.readOnly,
      onChange: (v) => setAcquisition(i, v),
    });
  };
  const operatorField = (i) => {
    const line = quote.equipment[i] || {};
    const included = isExternalLine(line) && line.external && line.external.operatorIncluded === true;
    const options = operatorOptions();
    return kit.select(`equipment.${i}.operatorLaborId`, {
      label: 'Operador (de Personal)',
      includeEmpty: true,
      emptyLabel: options.length ? 'Sin operador asignado' : `Todavía no cargaste puestos en "${stepName('labor')}"`,
      options,
      structural: true,
      hint: included
        ? 'La tarifa ya incluye operador: no le asignes uno de Personal (se contaría dos veces).'
        : 'El puesto de Personal que lo opera. No suma costo acá: si además maneja en el traslado, no se agrega otra persona.',
    });
  };
  /** Avisos de la línea: operador duplicado y moneda sin tipo de cambio. */
  const lineWarnings = (i) => {
    const line = quote.equipment[i] || {};
    const out = [];
    if (isExternalLine(line) && line.external && line.external.operatorIncluded === true && typeof line.operatorLaborId === 'string' && operatorOptions().some((o) => o.value === line.operatorLaborId)) {
      out.push('La tarifa del proveedor incluye operador y además le asignaste uno de Personal: revisá que no estés pagando dos veces la misma persona.');
    }
    const cur = line.base && line.base.currency;
    if (cur && conversionFactor(cur, quote) === null) {
      out.push(`Este valor está en ${cur} y la cotización no tiene ese tipo de cambio: no se suma al costo hasta que lo cargues en "${stepName('service')}".`);
    }
    return out.length ? h('div', { class: 'qe-line-warnings' }, ...out.map((t) => h('p', { class: 'qe-warn' }, icon('alert', { size: 14 }), h('span', {}, t)))) : null;
  };
  const mobilityNote = (i) => {
    const line = quote.equipment[i] || {};
    const mode = line.mobilization && line.mobilization.mode;
    const included = isExternalLine(line) && line.external && line.external.mobilizationIncluded === true;
    const text = included
      ? 'la movilización está incluida en la tarifa del proveedor'
      : mode ? labelOf(MOBILIZATION_MODES, mode, '').toLowerCase() : 'sin definir';
    return h('p', { class: 'small line-mobility-note' }, `Cómo llega al lugar del servicio: ${text}. Se define en "${stepName('logistics')}".`);
  };
  const baseAdvanced = (i, line) => {
    const p = `equipment.${i}`;
    const owned = !isExternalLine(line);
    return kit.advanced(
      {
        key: `equipment-base:${line.id || i}`,
        title: 'Fecha base y moneda',
        summary: () => {
          const e = quote.equipment[i] || {};
          return owned
            ? `${baseText(e.base, { prefix: 'Valor' })} · ${baseText(e.costsBase, { prefix: 'Costos' })}`
            : baseText(e.base, { prefix: 'Tarifa' });
        },
      },
      h('p', { class: 'small' }, 'De qué mes son estos valores. Cambiarlos acá sólo afecta esta cotización (Recursos no cambia).'),
      baseFields(ctx, `${p}.base`, { currency: true, periodLabel: owned ? 'Mes del valor del equipo' : 'Mes de la tarifa' }),
      owned ? baseFields(ctx, `${p}.costsBase`, { periodLabel: 'Mes de los costos de tenerlo y usarlo' }) : null,
    );
  };

  /** Línea con el valor de reposición en la moneda de la cotización (para los avisos). */
  const comparableLine = (r, i) => {
    const line = quote.equipment[i];
    if (!line) return null;
    const f = r && r.model && r.model.equipment[i] ? r.model.equipment[i].conversion : 1;
    const comparable = f !== undefined && f !== null && f > 0;
    const eq = comparable && f !== 1 ? { ...line, replacementValue: Number(line.replacementValue || 0) * f, residualValue: Number(line.residualValue || 0) * f } : line;
    return { eq, comparable };
  };
  /** "Así lo calcula RATEOS" de un grupo (dentro de las opciones). */
  const wearRegion = (r, i, group) => {
    const c = comparableLine(r, i);
    return c ? wearNote(c.eq, group, { comparable: c.comparable, warnings: false }) : null;
  };
  /** Avisos de sentido común, siempre a la vista (fuera de las opciones avanzadas). */
  const wearWarningsRegion = (r, i) => {
    const c = comparableLine(r, i);
    return c ? wearWarnings(c.eq, { comparable: c.comparable }) : null;
  };

  /** Mantenimiento y neumáticos: cómo se cargan + "Así lo calcula RATEOS" (PLAN-2026-007). */
  const wearGroups = (i, illustrative) => {
    const p = `equipment.${i}`;
    const line = quote.equipment[i] || {};
    const mMode = line.maintenanceMode || 'per_hour';
    const tMode = line.tiresMode || 'per_hour';
    return [
      kit.group(
        'Mantenimiento',
        formGrid(
          3,
          kit.select(`${p}.maintenanceMode`, { label: '¿Cómo lo cargás?', options: MAINTENANCE_MODES.map((m) => ({ value: m.id, label: m.label })), structural: true }),
          ...(mMode === 'service'
            ? [
                kit.num(`${p}.maintenanceServiceCost`, { label: 'Costo de cada service', rule: 'money', unit: '$', illustrative }),
                kit.num(`${p}.maintenanceServiceHours`, { label: 'Cada cuántas horas de uso', rule: 'intervalHours', unit: 'h' }),
              ]
            : mMode === 'budget'
              ? [
                  kit.num(`${p}.maintenanceBudget`, { label: 'Presupuesto de mantenimiento', rule: 'money', unit: '$', illustrative }),
                  kit.select(`${p}.maintenanceBudgetPeriod`, { label: 'Por', options: BUDGET_PERIODS.map((b) => ({ value: b.id, label: b.label })) }),
                ]
              : [kit.num(`${p}.maintenancePerHour`, { label: 'Costo por hora de uso', rule: 'money', unit: '$/h', illustrative })]),
        ),
        kit.region((r) => wearRegion(r, i, 'maintenance')),
      ),
      kit.group(
        'Neumáticos',
        formGrid(
          3,
          kit.select(`${p}.tiresMode`, { label: '¿Cómo lo cargás?', options: TIRE_MODES.map((t) => ({ value: t.id, label: t.label })), structural: true }),
          ...(tMode === 'per_hour'
            ? [kit.num(`${p}.tiresPerHour`, { label: 'Costo por hora de uso', rule: 'money', unit: '$/h', illustrative })]
            : [
                kit.num(`${p}.tiresSetCost`, { label: 'Costo del juego de neumáticos', rule: 'money', unit: '$', illustrative }),
                tMode === 'set_km'
                  ? kit.num(`${p}.tiresLifeKm`, { label: 'Vida útil del juego', rule: 'lifeKm', unit: 'km' })
                  : kit.num(`${p}.tiresLifeHours`, { label: 'Vida útil del juego', rule: 'intervalHours', unit: 'h' }),
              ]),
        ),
        kit.region((r) => wearRegion(r, i, 'tires')),
      ),
    ];
  };

  const ownedCard = (line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    // Valores copiados de una plantilla o equipo de demostración (UX-02).
    const ill = kit.lineIllustrative(p, { what: 'este equipo' });
    const illustrative = ill.marked;
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Equipo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} ${plural(l.quantity, 'unidad', 'unidades')} · ${formatNumber(l.hoursPerActiveDay, { decimals: 2 })} h de uso por día activo` : '';
        }),
        badges: [badge('Propio', 'gray'), ill.tag].filter(Boolean),
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      lineOriginBlock(ctx, 'equipment', i, [{ prefix: 'Valor', base: line.base }, { prefix: 'Costos', base: line.costsBase }]),
      resourceSyncNotice(ctx, 'equipment', i, { name: line.name || 'Equipo' }),
      ill.control,
      lineWarnings(i),
      formGrid(
        3,
        acquisitionField(i),
        operatorField(i),
      ),
      formGrid(
        3,
        kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
        kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
        kit.num(`${p}.hoursPerActiveDay`, {
          label: 'Horas de uso por día activo',
          rule: 'hoursPerDay',
          unit: 'h/día',
          placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
          hint: 'Vacío = usa las horas por día de la cotización.',
        }),
        kit.num(`${p}.replacementValue`, { label: 'Valor de reposición', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, hint: 'Lo que costaría comprarlo hoy.' }),
        kit.num(`${p}.usefulLifeYears`, { label: 'Vida útil', rule: 'years', unit: 'años', illustrative }),
        kit.num(`${p}.fuelLitersPerHour`, { label: 'Consumo de combustible', rule: 'quantity', unit: 'L/h', illustrative }),
      ),
      kit.region((r) => wearWarningsRegion(r, i)),
      kit.keyline({
        label: 'Costo del equipo en el mes',
        value: (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY),
        hint: (r) => {
          const l = at(r);
          if (!l) return '';
          return `Tenerlo: ${formatMoney(l.fixedMonthly)} por mes (aunque no trabaje) · usarlo: ${formatMoney(l.variablePerActiveDay)} por día activo · con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`;
        },
        trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
      }),
      mobilityNote(i),
      kit.advanced(
        {
          key: `equipment:${line.id || i}`,
          summary: () => {
            const e = quote.equipment[i] || {};
            const parts = [
              `residual ${moneyText(e.residualValue) || '$ 0'}`,
              `seguro ${moneyText(e.insuranceAnnual) || '$ 0'}/año`,
              `patente ${moneyText(e.licenseAnnual) || '$ 0'}/año`,
              hasNumber(e.otherAnnual) && Number(e.otherAnnual) > 0 ? `otros ${moneyText(e.otherAnnual)}/año` : null,
              `certificaciones ${moneyText(e.certificationsAnnual) || '$ 0'}/año`,
              wearSummary(e).maintenance,
              wearSummary(e).tires,
              hasNumber(e.capitalRatePctAnnual) && Number(e.capitalRatePctAnnual) > 0 ? `costo de capital ${formatPercent(Number(e.capitalRatePctAnnual))} anual` : 'sin costo de capital',
            ];
            const text = parts.filter(Boolean).join(' · ');
            return illustrative ? h('span', {}, `${text.charAt(0).toUpperCase()}${text.slice(1)}.`, illustrativeTag()) : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
          },
        },
        kit.group(
          'Costo de tenerlo (existe aunque no trabaje)',
          formGrid(
            3,
            kit.num(`${p}.residualValue`, { label: 'Valor residual', rule: 'money', unit: currencyUnit(line.base, quote), illustrative, hint: 'Lo que vale al final de su vida útil (en la misma moneda que el valor de reposición).' }),
            kit.num(`${p}.insuranceAnnual`, { label: 'Seguro anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.licenseAnnual`, { label: 'Patente anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.otherAnnual`, { label: 'Otros costos anuales de tenerlo', rule: 'money', unit: '$/año', hint: 'Habilitaciones, GPS, cocheras… lo que pagás aunque no trabaje.' }),
            kit.num(`${p}.certificationsAnnual`, { label: 'Certificaciones anual', rule: 'money', unit: '$/año', illustrative }),
            kit.num(`${p}.capitalRatePctAnnual`, { label: 'Costo de capital (opcional)', rule: 'percent', unit: '% anual', hint: 'Rendimiento que le pedís a la plata invertida en el equipo.' }),
          ),
        ),
        ...wearGroups(i, illustrative),
      ),
      kit.advanced(
        {
          key: `equipment-detail:${line.id || i}`,
          title: 'Ver detalle del costo',
          variant: 'detail',
          summary: (r) => {
            const l = at(r);
            return l ? `Amortización, seguros y capital por mes; mantenimiento, neumáticos y combustible por hora; costo por hora y por día usado.` : '';
          },
        },
        h(
          'div',
          { class: 'qe-split' },
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Tenerlo: por mes (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const o = l.ownership;
              return kit.breakdown(
                [
                  ['Amortización', formatMoney(o.depreciationMonthly)],
                  ['Seguro', formatMoney(o.insuranceMonthly)],
                  ['Patente', formatMoney(o.licenseMonthly)],
                  ['Certificaciones', formatMoney(o.certificationsMonthly)],
                  ['Otros', formatMoney(o.otherMonthly)],
                  o.maintenanceFixedMonthly > 0 ? ['Mantenimiento (presupuesto)', formatMoney(o.maintenanceFixedMonthly)] : null,
                  ['Costo de capital', formatMoney(o.capitalCostMonthly)],
                ].filter(Boolean),
                { totalLabel: 'Tenerlo por mes', total: formatMoney(o.totalMonthly) },
              );
            }),
          ),
          h(
            'div',
            { class: 'qe-split-col' },
            h('h5', { class: 'qe-group-title' }, 'Usarlo: por hora (por unidad)'),
            kit.region((r) => {
              const l = at(r);
              if (!l) return EMPTY;
              const op = l.operation;
              return kit.breakdown(
                [
                  [op.maintenanceMode === 'service' ? 'Mantenimiento (service)' : 'Mantenimiento', formatMoney(op.maintenancePerHour)],
                  [op.tiresMode === 'set_km' ? 'Neumáticos (van por km, en la ruta)' : op.tiresMode === 'set_hours' ? 'Neumáticos (juego)' : 'Neumáticos', formatMoney(op.tiresPerHour)],
                  [`Combustible (${formatNumber(op.fuelLitersPerHour, { decimals: 2 })} L/h)`, formatMoney(op.fuelPerHour)],
                ],
                { totalLabel: 'Usarlo por hora', total: formatMoney(op.totalPerHour) },
              );
            }),
          ),
        ),
        h('h5', { class: 'qe-group-title' }, 'En esta cotización (todas las unidades)'),
        kit.stats(
          kit.stat('Tenerlo por mes (fijo)', (r) => formatMoney(at(r) && at(r).fixedMonthly)),
          kit.stat('Usarlo por día activo', (r) => formatMoney(at(r) && at(r).variablePerActiveDay), { hint: (r) => (at(r) ? `${formatNumber(at(r).fuelLitersPerActiveDay, { decimals: 1 })} L de combustible por día` : '') }),
          kit.stat('Costo mensual con la actividad estimada', (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY), {
            emphasis: true,
            hint: (r) => `Con ${formatNumber(r.activity.activeDaysPerMonth, { decimals: 2 })} días activos.`,
            trace: (r) => equipmentTrace(r, i, quote.equipment[i]),
          }),
        ),
        h('h5', { class: 'qe-group-title' }, 'Ficha con los días de esta cotización (por unidad)'),
        kit.stats(
          kit.stat('$ por hora usada', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedHour) : EMPTY;
          }),
          kit.stat('$ por día usado', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerUsedDay) : EMPTY;
          }),
          kit.stat('$ por mes', (r) => {
            const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
            return c ? formatMoney(c.rates.costPerMonth) : EMPTY;
          }, {
            hint: (r) => {
              const c = equipmentCardAtQuote(r, i, quote.equipment[i]);
              return c ? `Utilización ${formatNumber(c.capacity.utilizationPct, { decimals: 2 })} % · ${formatNumber(c.capacity.usedHoursPerMonth, { decimals: 1 })} h usadas de ${formatNumber(c.capacity.availableHoursPerMonth, { decimals: 1 })} disponibles` : '';
            },
          }),
        ),
      ),
      baseAdvanced(i, line),
    );
  };

  const triField = (path, label, hint = null) => triStateField({
    label,
    hint,
    name: path,
    value: kit.get(path),
    yesLabel: 'Sí, incluido',
    noLabel: 'No, lo pago aparte',
    disabled: ctx.readOnly,
    onChange: (v) => {
      ctx.update(path, v);
      ctx.rerender();
    },
  });

  const externalCard = (line, i) => {
    const p = `equipment.${i}`;
    const at = (r) => r.model.equipment[i];
    const ill = kit.lineIllustrative(p, { what: 'este recurso externo' });
    const illustrative = ill.marked;
    const acq = acquisitionOf(line);
    const ext = line.external || {};
    const sym = currencyUnit(line.base, quote);
    const unit = ext.unit || 'day';
    const fiscal = ext.fiscal || {};
    return kit.lineCard(
      {
        title: kit.out(() => (quote.equipment[i] && quote.equipment[i].name) || 'Recurso externo sin nombre'),
        subtitle: kit.out((r) => {
          const l = at(r);
          const e = (quote.equipment[i] && quote.equipment[i].external) || {};
          return l ? `${formatNumber(l.quantity, { decimals: 2 })} ${plural(l.quantity, 'unidad', 'unidades')}${e.supplier ? ` · ${e.supplier}` : ''}` : '';
        }),
        badges: [badge(labelOf(ACQUISITION_MODES, acq, 'Externo'), 'blue'), ill.tag].filter(Boolean),
        actions: [kit.action('Quitar', () => removeLine(i), { variant: 'danger', icon: 'trash' })],
      },
      lineOriginBlock(ctx, 'equipment', i, [{ prefix: 'Tarifa', base: line.base }]),
      resourceSyncNotice(ctx, 'equipment', i, { name: line.name || 'Recurso externo' }),
      ill.control,
      lineWarnings(i),
      formGrid(3, acquisitionField(i), operatorField(i)),
      formGrid(
        3,
        kit.text(`${p}.name`, { label: 'Nombre', maxLength: 120 }),
        kit.text(`${p}.external.supplier`, { label: 'Proveedor', maxLength: 120 }),
        kit.num(`${p}.quantity`, { label: 'Cantidad', rule: 'quantity', unit: 'u.' }),
        kit.num(`${p}.external.price`, { label: 'Tarifa neta (sin IVA)', rule: 'money', unit: `${sym}${unitShort(unit)}`, illustrative, hint: 'El precio del proveedor SIN IVA: el IVA se trata aparte.' }),
        kit.select(`${p}.external.unit`, { label: 'Unidad de la tarifa', options: EXTERNAL_UNITS.map((u) => ({ value: u.id, label: u.label })), hint: UNIT_HINTS[unit], structural: true }),
        kit.num(`${p}.external.minimumUnits`, { label: 'Mínimo facturable', rule: 'quantity', unit: unitShort(unit).replace('/', '').trim() || 'u.', hint: 'Unidades mínimas por llamado. Vacío = sin mínimo.' }),
        unit === 'hour'
          ? kit.num(`${p}.hoursPerActiveDay`, {
            label: 'Horas de uso por día activo',
            rule: 'hoursPerDay',
            unit: 'h/día',
            placeholder: activityHours !== null && activityHours !== undefined ? String(activityHours) : '',
            hint: 'Vacío = usa las horas por día de la cotización.',
          })
          : null,
        dateField({ label: 'Oferta del proveedor válida hasta', name: `${p}.external.validUntil`, value: kit.get(`${p}.external.validUntil`), disabled: ctx.readOnly, onChange: (v) => ctx.update(`${p}.external.validUntil`, v) }),
      ),
      kit.group(
        '¿Qué incluye la tarifa?',
        formGrid(
          2,
          triField(`${p}.external.operatorIncluded`, 'Operador'),
          triField(`${p}.external.fuelIncluded`, 'Combustible'),
          ext.fuelIncluded === false ? kit.num(`${p}.external.fuelLitersPerHour`, { label: 'Consumo que pagás vos', rule: 'quantity', unit: 'L/h', hint: 'Se suma como combustible con el precio de la cotización.' }) : null,
          triField(`${p}.external.mobilizationIncluded`, 'Movilización (llevarlo y traerlo)'),
          ext.mobilizationIncluded === false ? kit.num(`${p}.external.mobilizationAmount`, { label: 'Movilización del proveedor por llamado (neta)', rule: 'money', unit: sym, hint: 'Lo que te cobra por llevarlo y traerlo en cada llamado.' }) : null,
          triField(`${p}.external.insuranceIncluded`, 'Seguro'),
        ),
      ),
      kit.keyline({
        label: `Costo del ${acq === 'rented' ? 'alquiler' : 'servicio'} en el mes`,
        value: (r) => (at(r) ? formatMoney(monthlyAtEstimate(r, at(r))) : EMPTY),
        hint: (r) => {
          const x = at(r) && at(r).external;
          if (!x) return '';
          const fixed = x.fixedMonthly > 0 ? `Fijo: ${formatMoney(x.fixedMonthly)} por mes (trabaje o no). ` : '';
          const billed = x.netPerActivation > 0 ? `Facturado por llamado: ${formatNumber(x.billedUnitsPerActivation, { decimals: 2 })} × ${formatMoney(x.price)} × ${formatNumber(x.quantity, { decimals: 2 })} = ${formatMoney(x.netPerActivation)} neto. ` : '';
          return `${fixed}${billed}Salida de caja con impuestos: ${formatMoney(x.cashPerActiveDay)} por día activo; el crédito fiscal (${formatMoney(x.creditPerActiveDay)}) no es costo.`;
        },
        trace: (r) => externalTrace(r, i, quote.equipment[i]),
      }),
      mobilityNote(i),
      kit.advanced(
        {
          key: `equipment-fiscal:${line.id || i}`,
          title: 'Tratamiento fiscal',
          summary: () => {
            const f = ((quote.equipment[i] || {}).external || {}).fiscal || {};
            const vat = hasNumber(f.vatPct) ? `IVA ${formatPercent(Number(f.vatPct))}` : 'IVA sin definir';
            const rec = f.vatRecoverable ? labelOf(VAT_RECOVERY, f.vatRecoverable, '').toLowerCase() : 'sin definir si lo recuperás';
            return `${vat} · ${rec}${hasNumber(f.perceptionsPct) && Number(f.perceptionsPct) > 0 ? ` · percepciones ${formatPercent(Number(f.perceptionsPct))}` : ''}.`;
          },
          flag: () => {
            const f = ((quote.equipment[i] || {}).external || {}).fiscal || {};
            if ((f.vatRecoverable === 'no' || f.vatRecoverable === 'partial') && !hasNumber(f.vatPct)) return { tone: 'red', text: 'Falta la alícuota' };
            if (!f.vatRecoverable) return { tone: 'orange', text: 'Revisar' };
            return null;
          },
        },
        h('p', { class: 'small' }, 'RATEOS no trae alícuotas: cargá las que te informa tu contador o el proveedor. El IVA que recuperás y las percepciones son caja que adelantás, no costo. No cargues Ganancias como % del alquiler y no dupliques el IIBB: el del proveedor ya está dentro de su precio.'),
        formGrid(
          3,
          kit.num(`${p}.external.fiscal.vatPct`, { label: 'IVA que te factura', rule: 'percent', unit: '%' }),
          kit.select(`${p}.external.fiscal.vatRecoverable`, { label: '¿Recuperás ese IVA?', options: VAT_RECOVERY.map((v) => ({ value: v.id, label: v.label })), includeEmpty: true, emptyLabel: 'Sin definir', structural: true }),
          fiscal.vatRecoverable === 'partial' ? kit.num(`${p}.external.fiscal.vatRecoverablePct`, { label: 'Parte del IVA que recuperás', rule: 'percent', unit: '%' }) : null,
          kit.num(`${p}.external.fiscal.perceptionsPct`, { label: 'Percepciones / retenciones', rule: 'percent', unit: '%', hint: 'Caja adelantada: no es costo.' }),
          kit.num(`${p}.external.fiscal.nonRecoverablePct`, { label: 'Otros cargos que no recuperás', rule: 'percent', unit: '%', hint: 'Sí es costo (un cargo que no podés computar).' }),
          kit.num(`${p}.external.fiscal.paymentTermDays`, { label: 'Plazo de pago al proveedor', rule: 'paymentDays', unit: 'días', hint: 'Informativo.' }),
        ),
      ),
      baseAdvanced(i, line),
    );
  };

  const lineCards = lines.map((line, i) => (isExternalLine(line) ? externalCard(line, i) : ownedCard(line, i)));

  const totals = kit.keyline({
    label: 'Equipos en el costo del mes',
    value: (r) => formatMoney(r.model.equipment.reduce((acc, e) => acc + monthlyAtEstimate(r, e), 0)),
    hint: (r) => `Fijo: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.fixedMonthly, 0))} por mes · variable: ${formatMoney(r.model.equipment.reduce((acc, e) => acc + e.variablePerActiveDay, 0))} por día activo (incluye combustible y la movilización que cobran los proveedores). En la estructura de costos, el combustible y los externos se informan aparte.`,
    className: 'qe-keyline-total',
  });

  mount(
    container,
    card({ title: 'Equipos', subtitle: `Cargá cada equipo afectado al servicio: propio, alquilado o tercerizado. Cómo llega cada uno al lugar del servicio y los vehículos de apoyo se definen en "${stepName('logistics')}".` }, toolbar, fuelNote),
    lineCards.length
      ? h('div', { class: 'qe-lines' }, ...lineCards)
      : emptyState({
        title: 'Todavía no agregaste equipos.',
        text: 'Agregá uno desde tus recursos o en blanco (propio, alquilado o tercerizado). Si el servicio no usa equipos, seguí al próximo paso.',
        icon: 'resources',
      }),
    lineCards.length ? totals : null,
  );
  return { update() {} };
}
