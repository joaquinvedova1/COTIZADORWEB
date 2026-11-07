/**
 * Viáticos por personas y noches (PLAN-2026-021): una ayuda para llenar
 * "Alojamiento y viáticos" por salida. Pura: sin estado ni DOM.
 *   total = personas × noches × alojamiento por noche + personas × días × comidas por día
 */

const n = (v) => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function lodgingFromDetail(detail = {}) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const people = n(d.people);
  return people * n(d.nights) * n(d.perNight) + people * n(d.days) * n(d.perDay);
}
