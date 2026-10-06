/**
 * Sector de la empresa y actividad / especialidad.
 *
 * Referencia: secciones de la ClaNAE (INDEC), que también usa el CLAE de ARCA (ex AFIP).
 * Sólo se usan los SECTORES AMPLIOS (las secciones con letra): RATEOS no carga
 * códigos fiscales de actividad ni los pide. "Petróleo y gas" se muestra aparte
 * de "Minería" (en la ClaNAE ambos son parte de la sección B) porque es un sector
 * frecuente entre los usuarios; RATEOS no queda limitado a él.
 *
 * Es descriptivo: el sector y la actividad NO cambian ningún cálculo.
 *
 * Datos guardados en organization:
 * - industry: id del sector (string; '' = sin definir). Ids anteriores
 *   (LEGACY_INDUSTRIES) se siguen leyendo.
 * - activity: actividad / especialidad, texto libre opcional.
 */

import { deepFreeze } from '../core/object.js';

/** Largo máximo de la actividad / especialidad (texto libre). */
export const MAX_ACTIVITY_LENGTH = 120;

/**
 * Sectores amplios. clanae: sección de referencia (letra). keywords: palabras
 * para el buscador (en minúsculas, sin tildes).
 */
export const INDUSTRY_SECTORS = deepFreeze([
  { id: 'agriculture', label: 'Agricultura, ganadería, forestal y pesca', clanae: 'A', keywords: ['campo', 'agro', 'cultivo', 'ganado', 'forestal', 'silvicultura', 'pesca', 'frutihorticola', 'chacra'] },
  { id: 'mining', label: 'Minería', clanae: 'B', keywords: ['mina', 'minas', 'canteras', 'aridos', 'litio', 'oro', 'cobre'] },
  { id: 'oil_gas', label: 'Petróleo y gas', clanae: 'B', keywords: ['petroleo', 'petrolero', 'petrolera', 'gas', 'oil', 'yacimiento', 'pozo', 'vaca muerta', 'hidrocarburos', 'upstream', 'servicios petroleros'] },
  { id: 'manufacturing', label: 'Industria manufacturera', clanae: 'C', keywords: ['industria', 'fabrica', 'fabricacion', 'metalurgica', 'metalmecanica', 'taller', 'reparacion de maquinaria', 'mantenimiento industrial'] },
  { id: 'energy', label: 'Electricidad, gas y energía', clanae: 'D', keywords: ['electricidad', 'energia', 'generacion', 'distribucion electrica', 'renovables', 'solar', 'eolica'] },
  { id: 'water_waste', label: 'Agua, saneamiento y residuos', clanae: 'E', keywords: ['agua', 'cloacas', 'saneamiento', 'residuos', 'reciclado', 'ambiental', 'tratamiento de residuos'] },
  { id: 'construction', label: 'Construcción', clanae: 'F', keywords: ['obra', 'obras', 'civil', 'montaje', 'movimiento de suelos', 'instalaciones'] },
  { id: 'commerce', label: 'Comercio', clanae: 'G', keywords: ['venta', 'mayorista', 'minorista', 'distribuidora', 'repuestos'] },
  { id: 'transport', label: 'Transporte y logística', clanae: 'H', keywords: ['transporte', 'logistica', 'cargas', 'fletes', 'camiones', 'almacenamiento', 'deposito', 'traslado de personal'] },
  { id: 'hospitality', label: 'Alojamiento y gastronomía', clanae: 'I', keywords: ['hotel', 'alojamiento', 'campamento', 'catering', 'comedor', 'gastronomia', 'viandas'] },
  { id: 'ict', label: 'Información y comunicaciones', clanae: 'J', keywords: ['software', 'telecomunicaciones', 'internet', 'sistemas', 'tecnologia', 'it'] },
  { id: 'finance', label: 'Finanzas y seguros', clanae: 'K', keywords: ['banco', 'financiera', 'seguros', 'aseguradora'] },
  { id: 'real_estate', label: 'Actividades inmobiliarias', clanae: 'L', keywords: ['inmobiliaria', 'alquiler de inmuebles', 'propiedades'] },
  { id: 'professional', label: 'Servicios profesionales, científicos y técnicos', clanae: 'M', keywords: ['ingenieria', 'consultoria', 'estudio', 'laboratorio', 'ensayos', 'arquitectura', 'topografia'] },
  { id: 'admin_support', label: 'Servicios administrativos y de apoyo', clanae: 'N', keywords: ['limpieza', 'seguridad', 'vigilancia', 'alquiler de equipos', 'personal eventual', 'apoyo'] },
  { id: 'public_admin', label: 'Administración pública', clanae: 'O', keywords: ['municipio', 'gobierno', 'estado', 'publico'] },
  { id: 'education', label: 'Educación', clanae: 'P', keywords: ['escuela', 'capacitacion', 'formacion', 'enseñanza', 'ensenanza'] },
  { id: 'health', label: 'Salud', clanae: 'Q', keywords: ['medicina', 'clinica', 'salud ocupacional', 'enfermeria', 'servicios sociales'] },
  { id: 'arts', label: 'Arte, entretenimiento y recreación', clanae: 'R', keywords: ['cultura', 'eventos', 'deportes', 'recreacion', 'espectaculos'] },
  { id: 'other_services', label: 'Otros servicios', clanae: 'S', keywords: ['asociaciones', 'servicios personales', 'reparaciones'] },
  { id: 'other', label: 'Otro / Personalizado', clanae: null, keywords: ['otro', 'otra', 'personalizado'] },
]);

export const INDUSTRY_SECTOR_IDS = deepFreeze(INDUSTRY_SECTORS.map((s) => s.id));

/**
 * Tipos de empresa de versiones anteriores → sector actual + la actividad que
 * describían. Se leen sin migrar datos; el valor nuevo se guarda recién cuando
 * la persona lo cambia.
 */
export const LEGACY_INDUSTRIES = deepFreeze({
  oil_gas_services: { sector: 'oil_gas', activity: 'Servicios petroleros' },
  industrial_maintenance: { sector: 'manufacturing', activity: 'Mantenimiento industrial' },
});

/**
 * Actividades / especialidades sugeridas (la persona puede escribir cualquier otra).
 * sectors: dónde se sugieren primero.
 */
export const ACTIVITY_SUGGESTIONS = deepFreeze([
  { label: 'Servicios al pozo', sectors: ['oil_gas'] },
  { label: 'Servicios petroleros', sectors: ['oil_gas'] },
  { label: 'Transporte de cargas', sectors: ['transport', 'oil_gas'] },
  { label: 'Transporte de personal', sectors: ['transport', 'oil_gas', 'mining'] },
  { label: 'Transporte de fluidos', sectors: ['transport', 'oil_gas'] },
  { label: 'Mantenimiento industrial', sectors: ['manufacturing', 'oil_gas', 'mining', 'energy'] },
  { label: 'Montaje', sectors: ['construction', 'manufacturing', 'oil_gas', 'energy'] },
  { label: 'Construcción civil', sectors: ['construction'] },
  { label: 'Movimiento de suelos', sectors: ['construction', 'mining', 'oil_gas'] },
  { label: 'Servicios ambientales', sectors: ['water_waste', 'oil_gas', 'mining'] },
  { label: 'Tratamiento de residuos', sectors: ['water_waste', 'oil_gas'] },
  { label: 'Limpieza industrial', sectors: ['admin_support', 'oil_gas', 'manufacturing'] },
  { label: 'Ingeniería', sectors: ['professional', 'oil_gas', 'construction', 'energy'] },
  { label: 'Alquiler de equipos', sectors: ['admin_support', 'construction', 'oil_gas'] },
  { label: 'Izaje y grúas', sectors: ['construction', 'oil_gas', 'transport'] },
  { label: 'Seguridad e higiene', sectors: ['professional', 'admin_support'] },
  { label: 'Catering y campamentos', sectors: ['hospitality', 'oil_gas', 'mining'] },
]);

/** Texto para buscar: minúsculas y sin tildes ("Petróleo" → "petroleo"). */
export function searchText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Sector por id (o null). */
export function sectorById(id) {
  return INDUSTRY_SECTORS.find((s) => s.id === id) || null;
}

/**
 * Sector y actividad de una organización, leyendo también los ids anteriores.
 * @returns {{ sector: string|null, activity: string }}
 */
export function industryOf(organization = {}) {
  const org = organization && typeof organization === 'object' ? organization : {};
  const raw = typeof org.industry === 'string' ? org.industry.trim() : '';
  const activity = typeof org.activity === 'string' ? org.activity.trim().slice(0, MAX_ACTIVITY_LENGTH) : '';
  if (INDUSTRY_SECTOR_IDS.includes(raw)) return { sector: raw, activity };
  const legacy = LEGACY_INDUSTRIES[raw];
  if (legacy) return { sector: legacy.sector, activity: activity || legacy.activity };
  return { sector: null, activity };
}

/**
 * Sectores que coinciden con lo buscado (por nombre o palabra clave), en el
 * orden del catálogo. "Otro / Personalizado" siempre está disponible.
 */
export function searchSectors(query) {
  const q = searchText(query);
  if (!q) return INDUSTRY_SECTORS.slice();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = INDUSTRY_SECTORS.filter((s) => {
    const hay = [searchText(s.label), ...s.keywords.map(searchText)].join(' | ');
    return words.every((w) => hay.includes(w));
  });
  if (!matches.some((s) => s.id === 'other')) matches.push(sectorById('other'));
  return matches;
}

/** Actividades sugeridas: primero las del sector elegido, después el resto. */
export function activitySuggestions(sectorId) {
  const first = ACTIVITY_SUGGESTIONS.filter((a) => sectorId && a.sectors.includes(sectorId));
  const rest = ACTIVITY_SUGGESTIONS.filter((a) => !first.includes(a));
  return [...first, ...rest].map((a) => a.label);
}
