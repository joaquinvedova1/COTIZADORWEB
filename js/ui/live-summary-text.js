/**
 * Textos del resumen en vivo del editor (DESIGN-02 2/2, PLAN-2026-026).
 * Funciones puras, sin DOM.
 */

import { isFiniteNumber } from '../core/money.js';
import { unreliableText } from './result-text.js';

/**
 * Estado del margen esperado en una palabra, para la barra compacta: el
 * estado no se lee sólo por el color (WCAG 1.4.1) y coincide con el tono del
 * resumen. Con un resultado NO CONFIABLE (ECO-01) dice "no confiable" antes
 * que cualquier otra cosa.
 * @param {{ kpis?: object, completeness?: object }|null} result
 * @returns {{ word: string, tone: 'green'|'orange'|'red'|null }}
 */
export function marginStateWord(result) {
  const k = result && result.kpis;
  if (!k) return { word: '', tone: null };
  if (unreliableText(result.completeness)) return { word: 'no confiable', tone: 'red' };
  if (!isFiniteNumber(k.commercialListRate) || !isFiniteNumber(k.marginPct)) return { word: 'sin tarifa', tone: null };
  if (isFiniteNumber(k.profit) && k.profit < 0) return { word: 'pierde', tone: 'red' };
  if (k.targetMarginInvalid) return { word: 'sin objetivo', tone: null };
  if (k.belowTarget) return { word: 'debajo', tone: 'orange' };
  return { word: 'cumple', tone: 'green' };
}
