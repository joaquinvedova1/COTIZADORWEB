/**
 * Mantenimiento y neumáticos (PLAN-2026-007): cómo los va a interpretar RATEOS
 * y avisos de sentido común, en lenguaje simple. Lo usan el legajo del equipo
 * (Recursos) y la línea del equipo en la cotización.
 *
 * Nunca corrige valores: muestra la interpretación ANTES de guardar y avisa.
 */

import { h } from './dom.js';
import { icon } from './components.js';
import { formatMoney, formatNumber } from '../core/format.js';
import { maintenanceOf, tiresOf, equipmentChecks } from '../engines/equipment-engine.js';

const money = (v) => formatMoney(v, { decimals: v > 0 && v < 100 ? 2 : 0 });

/** "Así lo calcula RATEOS" para el mantenimiento. */
export function maintenanceInterpretation(eq = {}) {
  const m = maintenanceOf(eq);
  if (m.mode === 'service') {
    if (!(m.serviceHours > 0)) return 'Service: falta cada cuántas horas de uso se hace. Mientras tanto, el mantenimiento queda en $ 0.';
    return `Service de ${money(m.serviceCost)} cada ${formatNumber(m.serviceHours, { decimals: 1 })} h = ${money(m.perHour)} por hora de uso. Se suma cada hora que el equipo trabaje en una cotización.`;
  }
  if (m.mode === 'budget') {
    const period = m.budgetPeriod === 'year' ? `${money(m.budget)} por año ÷ 12 = ` : '';
    return `Presupuesto: ${period}${money(m.fixedMonthly)} por mes de COSTO FIJO de tenerlo. Se suma aunque el equipo no trabaje y no se divide por horas.`;
  }
  return `${money(m.perHour)} POR HORA de uso. Se suma cada hora que el equipo trabaje (si es un monto mensual o anual, cambiá la forma de carga a "Presupuesto").`;
}

/** "Así lo calcula RATEOS" para los neumáticos. */
export function tiresInterpretation(eq = {}) {
  const t = tiresOf(eq);
  if (t.mode === 'set_hours') {
    if (!(t.lifeHours > 0)) return 'Juego de neumáticos: falta la vida útil en horas. Mientras tanto, los neumáticos quedan en $ 0.';
    return `Juego de ${money(t.setCost)} ÷ ${formatNumber(t.lifeHours)} h = ${money(t.perHour)} por hora de uso.`;
  }
  if (t.mode === 'set_km') {
    if (!(t.lifeKm > 0)) return 'Juego de neumáticos: falta la vida útil en km. Mientras tanto, los neumáticos quedan en $ 0.';
    return `Juego de ${money(t.setCost)} ÷ ${formatNumber(t.lifeKm)} km = ${money(t.perKm)} por km recorrido. Se suma en "Movilización y viajes" cuando el equipo va por sus propios medios (no por hora de trabajo).`;
  }
  return `${money(t.perHour)} POR HORA de uso.`;
}

/** Texto de cada aviso de sentido común. */
export function checkText(w = {}) {
  switch (w.id) {
    case 'maintenance_per_hour_high':
      return w.mode === 'service'
        ? 'Revisá el service. Con el costo y las horas cargadas, 100 horas de uso cuestan más que el valor del equipo. ¿Las horas entre services están bien?'
        : 'Revisá este valor. Con el mantenimiento cargado, 100 horas de uso cuestan más que el valor del equipo. ¿Seguro que el importe está expresado por hora?';
    case 'maintenance_per_hour_elevated':
      return 'El mantenimiento por hora es alto: en 1.000 horas de uso supera el valor del equipo. Revisá que el importe sea por hora.';
    case 'maintenance_budget_high':
      return `Revisá este valor: el presupuesto de mantenimiento de un año supera el valor del equipo. ¿Seguro que el importe es ${w.period === 'year' ? 'anual' : 'mensual'}?`;
    case 'tires_per_hour_high':
      return w.mode === 'set_hours'
        ? 'Revisá la vida útil de los neumáticos: con el juego cargado, 100 horas de uso cuestan más que el valor del equipo. ¿La vida útil está en horas?'
        : 'Revisá este valor. Con los neumáticos cargados, 100 horas de uso cuestan más que el valor del equipo. ¿Seguro que el importe está expresado por hora?';
    case 'tires_per_hour_elevated':
      return 'Los neumáticos por hora son altos: en 1.000 horas de uso superan el valor del equipo. Revisá el importe.';
    case 'tires_per_km_high':
      return 'Revisá la vida útil de los neumáticos: con el juego cargado, 1.000 km cuestan más que el valor del equipo. ¿La vida útil está en km?';
    case 'residual_over_replacement':
      return 'El valor residual supera el valor de reposición: la amortización queda en $ 0. Revisá los dos valores.';
    case 'useful_life_missing':
      return 'Sin vida útil no se calcula la amortización (queda en $ 0).';
    case 'service_hours_missing':
      return 'Cargá cada cuántas horas de uso se hace el service: sin eso, el mantenimiento queda en $ 0.';
    case 'tires_life_missing':
      return `Cargá la vida útil del juego en ${w.unit === 'km' ? 'km' : 'horas'}: sin eso, los neumáticos quedan en $ 0.`;
    default:
      return null;
  }
}

const MAINTENANCE_CHECKS = Object.freeze(['maintenance_per_hour_high', 'maintenance_per_hour_elevated', 'maintenance_budget_high', 'service_hours_missing']);
const TIRE_CHECKS = Object.freeze(['tires_per_hour_high', 'tires_per_hour_elevated', 'tires_per_km_high', 'tires_life_missing']);
const VALUE_CHECKS = Object.freeze(['residual_over_replacement', 'useful_life_missing']);
const GROUPS = Object.freeze({ maintenance: MAINTENANCE_CHECKS, tires: TIRE_CHECKS, value: VALUE_CHECKS });

/** Avisos de un grupo ('maintenance' | 'tires' | 'value'), como textos. */
export function checkTexts(eq, group, { comparable = true } = {}) {
  const ids = GROUPS[group] || [];
  return equipmentChecks(eq, { comparable }).filter((w) => ids.includes(w.id)).map(checkText).filter(Boolean);
}

function warnList(texts) {
  return texts.length ? h('div', { class: 'qe-line-warnings' }, ...texts.map((t) => h('p', { class: 'qe-warn', role: 'note' }, icon('alert', { size: 14 }), h('span', {}, t)))) : null;
}

/**
 * Bloque "Así lo calcula RATEOS" + avisos para mantenimiento o neumáticos.
 * @param {'maintenance'|'tires'|'value'} group
 * @param {{ comparable?: boolean, warnings?: boolean }} options  warnings=false: sólo la interpretación
 */
export function wearNote(eq, group, { comparable = true, warnings = true } = {}) {
  const text = group === 'maintenance' ? maintenanceInterpretation(eq) : group === 'tires' ? tiresInterpretation(eq) : null;
  return h(
    'div',
    { class: 'wear-note' },
    text ? h('p', { class: 'wear-interpretation' }, h('strong', {}, 'Así lo calcula RATEOS: '), text) : null,
    warnings ? warnList(checkTexts(eq, group, { comparable })) : null,
  );
}

/** Todos los avisos de un equipo (valor, mantenimiento y neumáticos), o null si no hay. */
export function wearWarnings(eq, { comparable = true } = {}) {
  const texts = ['value', 'maintenance', 'tires'].flatMap((g) => checkTexts(eq, g, { comparable }));
  return warnList(texts);
}
