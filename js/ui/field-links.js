/**
 * Enlaces a un campo de la cotización (PLAN-2026-012) — funciones puras.
 *
 * "Completar" de un pendiente lleva al campo exacto: "#/cotizaciones/<id>/<paso>?campo=<ruta>".
 * El router ignora la query; el editor la lee, valida la ruta con lista blanca y
 * enfoca el campo (abre las "Opciones avanzadas" que lo contengan).
 */

/**
 * Campo a enfocar desde el enlace "Completar" de un pendiente:
 * "#/cotizaciones/<id>/<paso>?campo=<ruta>" (PLAN-2026-012). Lista blanca:
 * sólo rutas de la forma "logistics.distanceKm" o "equipment.0.external.price".
 */
export function fieldFromHash(hash) {
  const raw = String(hash || '');
  const at = raw.indexOf('?');
  if (at < 0) return null;
  let value = null;
  try {
    value = new URLSearchParams(raw.slice(at + 1)).get('campo');
  } catch {
    return null;
  }
  return typeof value === 'string' && value.length <= 120 && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/.test(value) ? value : null;
}

/** Enlace a un paso que enfoca un campo ("…/logistics?campo=logistics.distanceKm"). */
export function fieldHref(quoteId, path) {
  const field = fieldFromHash(`?campo=${encodeURIComponent(String(path || ''))}`);
  const step = stepOfPath(path);
  const base = `#/cotizaciones/${encodeURIComponent(String(quoteId || ''))}/${step}`;
  return field ? `${base}?campo=${encodeURIComponent(field)}` : base;
}

/** Paso del flujo en el que vive un campo (ruta de validateQuote). */
export function stepOfPath(path) {
  const p = String(path || '');
  const head = p.split('.')[0];
  // UXR: la unidad de cobro y la tarifa conocida se eligen en "Qué cotizás".
  if (p === 'pricing.knownRate') return 'service';
  // Cómo llega cada equipo al servicio se define en Movilización y viajes.
  if (/^equipment\.\d+\.mobilization(\.|$)/.test(p)) return 'logistics';
  switch (head) {
    case 'activity':
    case 'contractMonths':
      return 'modality';
    case 'pricingMode':
    case 'unit':
    case 'unitName':
      return 'service';
    case 'labor':
      return 'labor';
    case 'equipment':
      return 'equipment';
    case 'materials':
    case 'materialsNotApplicable':
    case 'otherCosts':
      return 'materials';
    case 'logistics':
    case 'fuel':
      return 'logistics';
    case 'indirect':
      return 'indirect';
    case 'finance':
      return 'finance';
    case 'risk':
      return 'risk';
    case 'pricing':
    case 'rules':
    case 'billingTaxes':
      return 'margin';
    default:
      return 'service';
  }
}
