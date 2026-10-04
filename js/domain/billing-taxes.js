/**
 * Impuestos sobre la facturación — forma de los datos (dominio).
 *
 * quote.billingTaxes (y settings.defaultBillingTaxes, el valor de la empresa)
 * tiene dos modos EXCLUYENTES para no contar dos veces lo mismo:
 *
 *   { mode: 'combined' | 'detailed', notApplicable: boolean,
 *     combinedPct: number|null,                 // modo "Un % total"
 *     items: [{ id, kind, label, pct }] }       // modo "Detalle por impuesto"
 *
 * RATEOS nunca trae alícuotas cargadas (AGENTS.md §7): el valor por defecto
 * es "sin definir". El cálculo vive en js/engines/billing-taxes-engine.js.
 */

import { isFiniteNumber } from '../core/money.js';
import { isPlainObject } from '../core/object.js';
import { parseDecimalInput } from '../core/validation.js';
import { BILLING_TAX_KINDS, BILLING_TAX_MODES, labelOf } from './catalogs.js';

/** Valor por defecto: sin definir. */
export function emptyBillingTaxes() {
  return { mode: 'combined', notApplicable: false, combinedPct: null, items: [] };
}

/** % leído como lo valida validateQuote (texto es-AR "4,5" → 4,5); vacío → null; inválido → NaN. */
function readPct(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseDecimalInput(value) : NaN;
  return isFiniteNumber(n) ? n : NaN;
}

/**
 * Normaliza la configuración (tolera datos viejos o incompletos). Un % que no
 * es número queda como NaN para que el motor lo marque inválido (nunca se
 * toma como 0 en silencio).
 * @returns {{ mode: string, notApplicable: boolean, combinedPct: number|null, items: { id: string, kind: string, label: string, pct: number|null }[] }}
 */
export function normalizeBillingTaxes(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const mode = BILLING_TAX_MODES.some((m) => m.id === src.mode) ? src.mode : 'combined';
  const items = (Array.isArray(src.items) ? src.items : []).filter(isPlainObject).map((it, i) => {
    const kind = BILLING_TAX_KINDS.some((k) => k.id === it.kind) ? it.kind : 'other';
    return {
      id: typeof it.id === 'string' && it.id ? it.id : `tax-${i + 1}`,
      kind,
      label: typeof it.label === 'string' && it.label.trim() ? it.label.trim() : labelOf(BILLING_TAX_KINDS, kind, 'Otro cargo'),
      pct: readPct(it.pct),
    };
  });
  return { mode, notApplicable: src.notApplicable === true, combinedPct: readPct(src.combinedPct), items };
}

/**
 * ¿El usuario ya decidió? ("no aplica", un % total o algún renglón con %).
 * Sirve para no pisar el valor de la empresa con uno sin definir.
 */
export function billingTaxesDecided(raw) {
  if (!isPlainObject(raw)) return false;
  const cfg = normalizeBillingTaxes(raw);
  if (cfg.notApplicable) return true;
  return cfg.mode === 'detailed' ? cfg.items.some((it) => isFiniteNumber(it.pct)) : isFiniteNumber(cfg.combinedPct);
}
