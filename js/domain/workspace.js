/**
 * "Empezar con mi empresa en limpio": arma, a partir de los datos actuales
 * (formato de backup), un espacio de trabajo propio sin la empresa ficticia.
 *
 * Función pura (sin storage): el servicio la aplica con importBackup, que
 * valida y guarda ANTES una copia de recuperación. Nunca se borra nada sin
 * esa copia.
 *
 * Qué queda:
 * - Organización: la misma (mismo id), con el nombre / base / tipo de empresa
 *   indicados y `illustrative: false` (ya no es la empresa ficticia).
 * - Convenios y plantillas de servicio: se conservan como puntos de partida
 *   (siguen marcados ILUSTRATIVOS si lo eran).
 * - Configuración: se conserva (incluye el contador de códigos, que nunca se
 *   reinicia: un código COT-NNNN no se reutiliza).
 * Qué se quita: cotizaciones, perfiles de personal, equipos, materiales y
 * ubicaciones (eran de la empresa ficticia o del usuario: quedan en la copia
 * de recuperación).
 */

import { deepClone, isPlainObject } from '../core/object.js';

const KEEP_RESOURCES = Object.freeze(['agreements']);
const MAX_TEXT = 120;

function cleanText(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

/**
 * @param {object} backup  datos actuales en formato de backup (repository.exportBackup())
 * @param {{ name?: string, baseLocation?: string, industry?: string, activity?: string }} [org]
 * @returns {object} nuevo backup listo para importBackup
 */
export function createFreshWorkspace(backup, { name, baseLocation, industry, activity } = {}) {
  if (!isPlainObject(backup) || !isPlainObject(backup.organization)) throw new Error('Datos actuales inválidos.');
  const data = deepClone(backup);
  const organization = { ...data.organization, illustrative: false };
  const n = cleanText(name);
  const b = cleanText(baseLocation);
  const i = cleanText(industry);
  if (n) organization.name = n;
  else if (backup.organization.illustrative === true) organization.name = 'Mi empresa';
  if (b) organization.baseLocation = b;
  else if (backup.organization.illustrative === true) organization.baseLocation = '';
  if (i) organization.industry = i;
  const a = cleanText(activity);
  if (a) organization.activity = a;
  // Las notas de la empresa ficticia ("Empresa ficticia de demostración") no
  // pasan a la empresa propia.
  if (backup.organization.illustrative === true) organization.notes = '';
  const resources = {};
  Object.keys(isPlainObject(data.resources) ? data.resources : {}).forEach((type) => {
    resources[type] = KEEP_RESOURCES.includes(type) && Array.isArray(data.resources[type]) ? data.resources[type] : [];
  });
  return {
    ...data,
    organization,
    resources,
    services: Array.isArray(data.services) ? data.services : [],
    quotes: [],
    settings: isPlainObject(data.settings) ? data.settings : {},
  };
}
