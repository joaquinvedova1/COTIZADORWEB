/**
 * BillingTaxesEngine — impuestos que se pagan sobre lo que se FACTURA
 * (Ingresos Brutos, impuesto a los débitos y créditos, sellos, otros cargos
 * proporcionales a lo facturado).
 *
 * No son costo: dependen del precio. Por eso no entran en la estructura de
 * costos (EECC) ni en la base de contingencia o financiero; se cubren con un
 * gross-up exacto junto con el margen (ver pricing-engine):
 *
 *     facturación necesaria = costo / (1 − margen − t)
 *
 * Datos (quote.billingTaxes): ver js/domain/billing-taxes.js (dos modos
 * EXCLUYENTES, "Un % total" o "Detalle por impuesto", y "no aplica").
 *
 * Sin definir (ni % total, ni detalle, ni "no aplica") → t = 0 y `defined`
 * false: la tarifa piso NO incluye estos impuestos y la interfaz lo avisa.
 * RATEOS nunca trae alícuotas cargadas (AGENTS.md §7).
 */

import { isFiniteNumber } from '../core/money.js';
import { isPlainObject } from '../core/object.js';
import { createTrace } from '../core/trace.js';
import { normalizeBillingTaxes } from '../domain/billing-taxes.js';

/**
 * Alícuota total t (puntos) y estado de una configuración de impuestos
 * (quote.billingTaxes o settings.defaultBillingTaxes).
 *  - pct: suma usada por el motor (0 si no aplica o sin definir).
 *  - defined: el usuario decidió (no aplica, % total cargado o algún renglón con %).
 *  - invalid: algún % negativo, no numérico o un total ≥ 100 (el motor usa 0 y la validación lo informa).
 * @returns {{ pct: number, defined: boolean, invalid: boolean, notApplicable: boolean, mode: string, items: object[], combinedPct: number|null }}
 */
export function billingTaxConfigInfo(config) {
  const cfg = normalizeBillingTaxes(config);
  if (cfg.notApplicable) return { ...cfg, pct: 0, defined: true, invalid: false };
  const bad = (v) => Number.isNaN(v) || (isFiniteNumber(v) && v < 0);
  let pct = 0;
  let defined = false;
  let invalid = false;
  if (cfg.mode === 'detailed') {
    const loaded = cfg.items.filter((it) => isFiniteNumber(it.pct));
    defined = loaded.length > 0;
    invalid = cfg.items.some((it) => bad(it.pct));
    pct = loaded.reduce((s, it) => s + Math.max(0, it.pct), 0);
  } else {
    defined = isFiniteNumber(cfg.combinedPct);
    invalid = bad(cfg.combinedPct);
    pct = isFiniteNumber(cfg.combinedPct) ? Math.max(0, cfg.combinedPct) : 0;
  }
  if (pct >= 100) invalid = true;
  return { ...cfg, pct: invalid ? 0 : pct, defined: defined && !invalid, invalid };
}

/** Impuestos sobre la facturación de una cotización (datos viejos sin el campo → sin definir). */
export function billingTaxInfo(quote) {
  return billingTaxConfigInfo(isPlainObject(quote) ? quote.billingTaxes : null);
}

/** Traza "Ver cálculo" de los impuestos sobre la facturación con una facturación dada. */
export function traceBillingTaxes(info, revenue) {
  const t = info.pct;
  const lines = info.notApplicable
    ? []
    : info.mode === 'detailed'
      ? info.items.filter((it) => isFiniteNumber(it.pct)).map((it) => ({ label: it.label, value: it.pct, format: 'percent' }))
      : isFiniteNumber(info.combinedPct)
        ? [{ label: 'Impuestos sobre la facturación (% total)', value: info.combinedPct, format: 'percent' }]
        : [];
  return createTrace({
    id: 'billing_taxes',
    title: 'Impuestos sobre lo que facturás',
    formula: 'Impuestos = t × Facturación del mes (sin IVA) · Facturación necesaria = Costo / (1 − margen − t)',
    inputs: [...lines, { label: 'Facturación del mes (sin IVA)', value: revenue, format: 'money' }],
    steps: [{ label: 't (total)', value: t, format: 'percent' }],
    result: { label: 'Impuestos sobre la facturación del mes', value: isFiniteNumber(revenue) ? (revenue * t) / 100 : null, format: 'money' },
    notes: [
      info.notApplicable ? 'Marcaste que no pagás impuestos sobre lo que facturás.' : null,
      !info.defined && !info.notApplicable ? 'Sin definir: la tarifa piso NO incluye impuestos sobre lo que facturás. Cargalos en "El precio".' : null,
      info.invalid ? 'Hay un porcentaje inválido (negativo, no numérico o un total de 100 % o más): no se aplica hasta que lo corrijas.' : null,
      'Se pagan sobre lo que facturás, no sobre lo que te cuesta: por eso RATEOS divide en lugar de sumar. No incluyen IVA, Ganancias, retenciones ni costo financiero.',
      info.items.some((it) => it.kind === 'stamp' && isFiniteNumber(it.pct)) ? 'Sellos se reparte proporcional a la facturación: es exacto con la actividad estimada y una aproximación con otra actividad.' : null,
    ],
  });
}
