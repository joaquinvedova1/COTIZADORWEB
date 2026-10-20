/**
 * Textos de referencia del precio y del documento impreso (DESIGN-02,
 * PLAN-2026-025). Funciones puras, sin DOM.
 *
 * - VAL-G4 (VAL-01): la beta dice que el precio sale de los costos y supuestos
 *   de la empresa y que no es un precio de mercado.
 * - AUD-T1 C-E2-11: el PDF lleva la fecha de la oferta, además de la de
 *   impresión.
 */

import { formatDayDate } from '../core/format.js';
import { dayFromDate } from '../domain/economic-base.js';

/** Va junto a los montos del resultado (servicios y productos) y se imprime con ellos. */
export const REFERENCE_PRICE_NOTE = 'Calculado con tus costos y tus supuestos: no es un precio de mercado.';

/** Fecha local de un Date como "AAAA-MM-DD". */
function localDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Fechas del encabezado impreso: "Oferta del 01/10/2026 · impreso el 20/10/2026".
 * Sin una fecha de oferta válida, sólo "Impreso el 20/10/2026": nunca se inventa una.
 * @param {{ offerDate?: string|null, printedAt?: Date }} options
 */
export function documentDatesText({ offerDate = null, printedAt = new Date() } = {}) {
  const printed = formatDayDate(localDay(printedAt));
  // El día de la oferta se toma del texto (dayFromDate): nunca pasa por zonas horarias.
  const offer = dayFromDate(offerDate);
  return offer ? `Oferta del ${formatDayDate(offer)} · impreso el ${printed}` : `Impreso el ${printed}`;
}
