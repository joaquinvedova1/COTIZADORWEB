/**
 * Datos REALES de un estado RATEOS: lo que una persona cargó, sin la demo
 * ni nada marcado ILUSTRATIVO. Se usa para ofrecer importar a una cuenta los
 * datos del modo local anterior (nunca se importa la empresa ficticia, sus
 * recursos, plantillas ni cotizaciones de ejemplo).
 *
 * Función pura (sin storage).
 */

import { deepClone, isPlainObject } from '../core/object.js';
import { DEMO_ORG_ID } from './demo-data.js';

/** Los datos de la demo usan UUID fijos con este prefijo (js/domain/demo-data.js). */
const DEMO_ID_PREFIX = '00000000-0000-4000-8000-';

function isDemoItem(item) {
  if (!isPlainObject(item)) return true;
  if (item.illustrative === true) return true;
  if (typeof item.id === 'string' && item.id.startsWith(DEMO_ID_PREFIX)) return true;
  return false;
}

/**
 * @param {object} state estado RATEOS (esquema actual)
 * @returns {{ data: object, counts: { quotes: number, resources: number, services: number, settings: boolean, organization: boolean }, hasRealData: boolean }}
 */
export function extractRealData(state) {
  const empty = { data: null, counts: { quotes: 0, resources: 0, services: 0, settings: false, organization: false }, hasRealData: false };
  if (!isPlainObject(state)) return empty;
  const resources = {};
  let resourceCount = 0;
  Object.entries(isPlainObject(state.resources) ? state.resources : {}).forEach(([type, list]) => {
    const kept = (Array.isArray(list) ? list : []).filter((item) => !isDemoItem(item));
    resources[type] = deepClone(kept);
    resourceCount += kept.length;
  });
  const services = (Array.isArray(state.services) ? state.services : []).filter((s) => !isDemoItem(s));
  const quotes = (Array.isArray(state.quotes) ? state.quotes : []).filter((q) => !isDemoItem(q));
  const org = isPlainObject(state.organization) ? state.organization : null;
  const realOrg = Boolean(org && org.illustrative !== true && org.id !== DEMO_ORG_ID);
  const settings = isPlainObject(state.settings) && state.settings.illustrative !== true ? state.settings : null;
  const counts = { quotes: quotes.length, resources: resourceCount, services: services.length, settings: Boolean(settings), organization: realOrg };
  const hasRealData = quotes.length > 0 || resourceCount > 0 || services.length > 0;
  return {
    data: {
      schemaVersion: state.schemaVersion,
      organization: realOrg ? deepClone(org) : null,
      resources,
      services: deepClone(services),
      quotes: deepClone(quotes),
      settings: settings ? deepClone(settings) : null,
    },
    counts,
    hasRealData,
  };
}
