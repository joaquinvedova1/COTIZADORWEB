/**
 * Viajes y km del mes (PLAN-2026-012) — piezas de UI compartidas por
 * "Cómo se cobra", "Movilización y viajes", "Equipos" y el Resultado.
 *
 * Sólo presentan lo que ya calculó el motor (r.model.transport, de
 * transport-engine): viajes facturables, viajes físicos costeados, días de
 * trabajo, km por viaje y por mes, y la actividad de cada proveedor por km o
 * por viaje con sus equivalencias ($/viaje ↔ $/km). Nunca recalculan nada.
 */

import { h } from '../../dom.js';
import { formatMoney, formatNumber, formatValue, EMPTY } from '../../../core/format.js';
import { traceTransport } from '../../../engines/transport-engine.js';
import { workDaysText } from '../../unit-text.js';
import { activationTerms } from '../../../domain/activation-terms.js';

const num = (value, decimals = 2) => formatNumber(value, { decimals });
const plural = (n, one, many) => (Math.abs(n - 1) < 1e-9 ? one : many);

/** Resumen de transporte del resultado (o null). */
export function transportOf(r) {
  return r && r.model && r.model.transport ? r.model.transport : null;
}

/** "Neuquén → Añelo" (o "" si no hay nombres). */
export function routeName(t) {
  if (!t) return '';
  const from = t.origin || '';
  const to = t.destination || '';
  if (!from && !to) return '';
  return `${from || 'Base'} → ${to || 'destino'}`;
}

/** "Neuquén → Añelo · 100 km de ida · 200 km por viaje (ida y vuelta)". */
export function routeText(t) {
  if (!t || !(t.oneWayKm > 0)) return '';
  const name = routeName(t);
  const legs = t.roundTrip ? `${formatValue(t.kmPerTrip, 'km')} por viaje (ida y vuelta)` : `${formatValue(t.kmPerTrip, 'km')} por viaje (sólo ida)`;
  return [name, `${formatValue(t.oneWayKm, 'km')} de ida`, legs].filter(Boolean).join(' · ');
}

/** "12 viajes" / "1 viaje". */
export function tripsText(n) {
  return `${num(n)} ${plural(n, 'viaje', 'viajes')}`;
}

/**
 * Actividad de un proveedor por km o por viaje:
 * "12 viajes · 200 km/viaje · 2.400 km/mes · $ 3.250/km = $ 7.800.000".
 */
export function providerActivityText(p, t) {
  if (!p || !t) return '';
  if (p.noRoute) return 'Falta definir la ruta/distancia para calcular este proveedor.';
  const qty = p.quantity !== 1 ? ` × ${num(p.quantity)} ${plural(p.quantity, 'unidad', 'unidades')}` : '';
  if (p.unit === 'km') {
    const perUnitKm = t.routeKmPerMonth;
    return `${tripsText(t.physicalTripsPerMonth)} · ${formatValue(t.kmPerTrip, 'km')}/viaje · ${formatValue(perUnitKm, 'km')}/mes${qty} · ${formatMoney(p.price)}/km${p.minimumApplied ? ' (con el mínimo)' : ''} = ${formatMoney(p.netMonthly)}`;
  }
  const legs = t.roundTrip ? 2 : 1;
  return `${tripsText(t.physicalTripsPerMonth)} · ${num(legs, 0)} ${plural(legs, 'tramo', 'tramos')} por viaje (cada ida o vuelta) · ${num(p.unitsPerMonth)} tramos/mes${qty} · ${formatMoney(p.price)}/tramo${p.minimumApplied ? ' (con el mínimo)' : ''} = ${formatMoney(p.netMonthly)}`;
}

/**
 * Tarifa del proveedor ligada a la ruta (sin forzar $/km):
 * "Neuquén → Añelo · 200 km por viaje · $ 650.000 por viaje · equivalente $ 3.250/km".
 */
export function providerRouteText(p, t) {
  if (!p || !t || !(t.kmPerTrip > 0)) return '';
  const name = routeName(t);
  const perTrip = p.perTripNet !== null && p.perTripNet !== undefined ? `${formatMoney(p.perTripNet)} por viaje${t.roundTrip ? ' (ida y vuelta)' : ''}` : null;
  const perKm = p.perKmNet !== null && p.perKmNet !== undefined ? `equivalente ${formatMoney(p.perKmNet)}/km` : null;
  return [name, `${formatValue(t.kmPerTrip, 'km')} por viaje`, perTrip, perKm].filter(Boolean).join(' · ');
}

/**
 * Indicadores "Viajes y km del mes": viajes facturables, viajes físicos
 * costeados, días de trabajo, km por viaje, km de ruta por mes y, si se cobra
 * por km, los km facturables (dos datos distintos, PLAN-2026-014 / LAB-D4),
 * con "Ver cálculo".
 */
export function transportStats(kit, { billable = true, km = false } = {}) {
  const t = (r) => transportOf(r) || {};
  const T = (r) => activationTerms(t(r).terms);
  return kit.stats(
    // Sólo con la unidad "viaje" hay viajes facturables (con otra unidad no se muestra).
    billable
      ? kit.stat('Viajes facturables', (r) => (t(r).derived ? tripsText(t(r).billableTripsPerMonth) : EMPTY), { hint: 'Lo que cobrás en el mes.' })
      : null,
    kit.stat('Viajes físicos costeados', (r) => tripsText(t(r).physicalTripsPerMonth || 0), {
      hint: (r) => {
        const x = t(r);
        if (x.notApplicable) return 'Marcaste "Sin traslados".';
        const per = `${num(x.activationsPerMonth)} ${T(r).word(x.activationsPerMonth)} × ${tripsText(x.physicalTripsPerActivation)}`;
        return x.minimumPadding ? `${per} (el mínimo ${T(r).per} factura más viajes de los que se hacen).` : `${per}.`;
      },
      tone: (r) => (t(r).derived && !t(r).notApplicable && !t(r).minimumPadding && Math.abs((t(r).billableTripsPerMonth || 0) - (t(r).physicalTripsPerMonth || 0)) > 1e-6 ? 'orange' : null),
    }),
    kit.stat('Días de trabajo', (r) => workDaysText(t(r).workDaysPerMonth || 0), {
      hint: (r) => (t(r).derived && t(r).tripsPerActiveDay > 0 ? `${tripsText(t(r).billableTripsPerMonth)} ÷ ${num(t(r).tripsPerActiveDay)} por día.` : ''),
    }),
    kit.stat('Km por viaje', (r) => (t(r).kmPerTrip > 0 ? formatValue(t(r).kmPerTrip, 'km') : EMPTY), {
      hint: (r) => routeText(t(r)) || 'Cargá la distancia de ida en "Movilización y viajes".',
    }),
    kit.stat('Km de ruta por mes', (r) => (t(r).kmPerTrip > 0 ? formatValue(t(r).routeKmPerMonth, 'km') : EMPTY), {
      emphasis: true,
      hint: (r) => (t(r).kmPerTrip > 0 ? `Lo que se recorre y se costea: ${tripsText(t(r).physicalTripsPerMonth)} × ${formatValue(t(r).kmPerTrip, 'km')}.` : ''),
      trace: (r) => traceTransport(transportOf(r)),
      traceLabel: 'Ver cálculo: Viajes y km del mes',
    }),
    // Cobro por km: lo que se factura, aparte de la ruta (nunca se deriva uno del otro).
    km
      ? kit.stat('Km facturables', (r) => (t(r).billableKmPerMonth !== null && t(r).billableKmPerMonth !== undefined ? formatValue(t(r).billableKmPerMonth, 'km') : EMPTY), {
        hint: (r) => {
          const x = t(r);
          if (!(x.billableToRouteKm > 0)) return 'Lo que cobrás en el mes. No se calcula con la ruta.';
          return `Lo que cobrás en el mes: ${num(x.billableToRouteKm)} km facturables por km de ruta${Math.abs(x.billableToRouteKm - 1) < 0.01 ? ' (coinciden).' : '.'}`;
        },
        tone: (r) => (t(r).billableToRouteKm > 1.01 ? 'orange' : null),
      })
      : null,
  );
}

/** Lista "Distancia / actividad del proveedor" (una fila por proveedor por km o por viaje). */
export function providerActivityList(r) {
  const t = transportOf(r);
  const providers = t && Array.isArray(t.providers) ? t.providers : [];
  if (!providers.length) return null;
  return h(
    'ul',
    { class: 'qe-provider-activity' },
    ...providers.map((p) => h(
      'li',
      { class: p.noRoute ? 'is-missing' : null },
      h('strong', {}, `${p.name}${p.supplier ? ` (${p.supplier})` : ''}: `),
      h('span', { class: p.noRoute ? 'qe-warn-text' : 'mono-soft' }, providerActivityText(p, t)),
      !p.noRoute && providerRouteText(p, t) ? h('span', { class: 'qe-provider-route small muted' }, providerRouteText(p, t)) : null,
    )),
  );
}
