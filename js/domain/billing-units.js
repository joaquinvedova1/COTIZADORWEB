/**
 * Unidades de FACTURACIÓN de una cotización (PLAN-2026-009).
 *
 * UNIDAD DE VENTA ≠ UNIDAD DE COSTO: los costos se siguen calculando con sus
 * drivers reales (días de trabajo, horas, km, litros…) y la facturación se
 * expresa en la unidad comercial que elige la empresa:
 *
 *   kind 'day'      $/día     → cantidad facturable = días de trabajo (+ mínimo por llamado)
 *   kind 'hour'     $/hora    → días de trabajo × horas por día (+ mínimo por llamado)
 *   kind 'month'    $/mes     → 1 abono por mes
 *   kind 'event'    $/llamado, $/trabajo, $/hito → llamados o trabajos (× hitos por trabajo)
 *   kind 'quantity' $/m³, $/viaje, $/tonelada, $/turno, …, o una unidad propia
 *                   → días de trabajo × cantidad por día de trabajo (+ mínimo por llamado)
 *
 * La actividad se pide en la unidad comercial ("¿Cuántos m³ esperás facturar
 * por mes?") y los días de trabajo se DERIVAN (cantidad ÷ rendimiento).
 *
 * Sólo datos y textos: nada de cálculo económico.
 */

import { deepFreeze } from '../core/object.js';

const MAX_UNIT_NAME = 30;

/**
 * Catálogo de unidades. `short` es lo que va después de "$ /" y en los
 * rótulos de cantidad ("1.240 m³"); `perDayQuestion` pide el rendimiento.
 */
export const BILLING_UNITS = deepFreeze([
  { id: 'hour', kind: 'hour', singular: 'hora', plural: 'horas', short: 'hora', label: '$/hora', hint: 'Se factura cada hora trabajada (días de trabajo × horas por día).' },
  { id: 'day', kind: 'day', singular: 'día', plural: 'días', short: 'día', label: '$/día', hint: 'Se factura cada día de trabajo.' },
  { id: 'month', kind: 'month', singular: 'mes', plural: 'meses', short: 'mes', label: '$/mes (abono)', hint: 'Abono fijo mensual: la facturación no depende de cuánto trabajes.' },
  { id: 'call', kind: 'event', singular: 'llamado', plural: 'llamados', short: 'llamado', label: '$/llamado', hint: 'Se factura cada llamado, dure lo que dure.' },
  { id: 'shift', kind: 'quantity', singular: 'turno', plural: 'turnos', short: 'turno', label: '$/turno', hint: 'Se factura cada turno cubierto.' },
  { id: 'trip', kind: 'quantity', singular: 'viaje', plural: 'viajes', short: 'viaje', label: '$/viaje', hint: 'Se factura cada viaje.' },
  { id: 'km', kind: 'quantity', singular: 'km', plural: 'km', short: 'km', label: '$/km', hint: 'Se factura cada km recorrido.' },
  { id: 'ton', kind: 'quantity', singular: 'tonelada', plural: 'toneladas', short: 't', label: '$/tonelada', hint: 'Se factura cada tonelada.' },
  { id: 'tonkm', kind: 'quantity', singular: 'ton-km', plural: 'ton-km', short: 'ton-km', label: '$/ton-km', hint: 'Toneladas × km transportados.' },
  { id: 'm3', kind: 'quantity', singular: 'm³', plural: 'm³', short: 'm³', label: '$/m³', hint: 'Se factura cada metro cúbico.' },
  { id: 'unit', kind: 'quantity', singular: 'unidad', plural: 'unidades', short: 'u.', label: '$/unidad', hint: 'Se factura cada unidad producida o realizada.' },
  { id: 'kg', kind: 'quantity', singular: 'kg', plural: 'kg', short: 'kg', label: '$/kg', hint: 'Se factura cada kilo.' },
  { id: 'meter', kind: 'quantity', singular: 'metro', plural: 'metros', short: 'm', label: '$/metro', hint: 'Se factura cada metro lineal.' },
  { id: 'm2', kind: 'quantity', singular: 'm²', plural: 'm²', short: 'm²', label: '$/m²', hint: 'Se factura cada metro cuadrado.' },
  { id: 'lot', kind: 'quantity', singular: 'lote', plural: 'lotes', short: 'lote', label: '$/lote', hint: 'Se factura cada lote.' },
  // Unidades de cuenta y medida habituales (UN/ECE Rec. 20, en español):
  // pieza (H87), pozo (E56), ensayo (E53), hora-hombre, litro (LTR),
  // barril (BLL), hectárea (HAR) y juego (SET).
  { id: 'piece', kind: 'quantity', singular: 'pieza', plural: 'piezas', short: 'pieza', label: '$/pieza', hint: 'Se factura cada pieza o equipo atendido (válvula, instrumento, motor…).' },
  { id: 'well', kind: 'quantity', singular: 'pozo', plural: 'pozos', short: 'pozo', label: '$/pozo', hint: 'Se factura cada pozo intervenido.' },
  { id: 'test', kind: 'quantity', singular: 'ensayo', plural: 'ensayos', short: 'ensayo', label: '$/ensayo', hint: 'Se factura cada ensayo o prueba (hidráulica, END, laboratorio…).' },
  { id: 'manhour', kind: 'quantity', singular: 'hora-hombre', plural: 'horas-hombre', short: 'HH', label: '$/hora-hombre', hint: 'Se factura cada hora de cada persona (personas × horas).' },
  { id: 'liter', kind: 'quantity', singular: 'litro', plural: 'litros', short: 'l', label: '$/litro', hint: 'Se factura cada litro.' },
  { id: 'barrel', kind: 'quantity', singular: 'barril', plural: 'barriles', short: 'bbl', label: '$/barril', hint: 'Se factura cada barril (159 litros).' },
  { id: 'ha', kind: 'quantity', singular: 'hectárea', plural: 'hectáreas', short: 'ha', label: '$/hectárea', hint: 'Se factura cada hectárea (10.000 m²).' },
  { id: 'set', kind: 'quantity', singular: 'juego', plural: 'juegos', short: 'juego', label: '$/juego o kit', hint: 'Se factura cada juego o kit completo.' },
  // Ampliación 2026-11 (pedido de Joaco, catálogo UN/ECE Rec. 20 + práctica del
  // sector en Argentina). Energía y potencia: la potencia (kW, kVA, HP) se cobra
  // siempre por tiempo (kVA-día, HP-hora); volt, amper, psi o caudal describen
  // el equipo, no se cobran.
  { id: 'kwh', kind: 'quantity', group: 'energy', singular: 'kWh', plural: 'kWh', short: 'kWh', label: '$/kWh', hint: 'Se factura cada kilovatio-hora de energía entregada (generación, energía en locación).', keywords: 'energia electrica kilovatio kilowatt hora electricidad' },
  { id: 'mwh', kind: 'quantity', group: 'energy', singular: 'MWh', plural: 'MWh', short: 'MWh', label: '$/MWh', hint: 'Se factura cada megavatio-hora (1 MWh = 1.000 kWh = 3,6 GJ).', keywords: 'energia electrica megavatio megawatt' },
  { id: 'mj', kind: 'quantity', group: 'energy', singular: 'MJ', plural: 'MJ', short: 'MJ', label: '$/MJ (megajoule)', hint: 'Se factura cada megajoule de energía (1 kWh = 3,6 MJ).', keywords: 'joule julio megajulio energia calor' },
  { id: 'gj', kind: 'quantity', group: 'energy', singular: 'GJ', plural: 'GJ', short: 'GJ', label: '$/GJ (gigajoule)', hint: 'Se factura cada gigajoule (≈ 25,7 m³ de gas de 9.300 kcal; ≈ 0,95 MMBTU).', keywords: 'joule julio gigajulio energia gas' },
  { id: 'mmbtu', kind: 'quantity', group: 'energy', singular: 'MMBTU', plural: 'MMBTU', short: 'MMBTU', label: '$/MMBTU (millón de BTU)', hint: 'Se factura cada millón de BTU, como el gas en boca de pozo (1 MMBTU ≈ 27 m³ de gas de 9.300 kcal).', keywords: 'btu gas energia millon' },
  { id: 'kw_day', kind: 'quantity', group: 'energy', singular: 'kW-día', plural: 'kW-día', short: 'kW-día', label: '$/kW-día (potencia)', hint: 'Potencia puesta a disposición por día: kW × días (cargo por potencia, generación en alquiler).', perDayQuestion: '¿Cuántos kW ponés a disposición por día de trabajo?', perDayLabel: 'kW disponibles por día de trabajo', perDayUnit: 'kW', feminine: false, keywords: 'kw kilovatio kilowatt potencia generador' },
  { id: 'kva_day', kind: 'quantity', group: 'energy', singular: 'kVA-día', plural: 'kVA-día', short: 'kVA-día', label: '$/kVA-día (grupo electrógeno)', hint: 'Alquiler de grupos electrógenos por tamaño: kVA × días (1 kVA ≈ 0,8 kW).', perDayQuestion: '¿Cuántos kVA ponés a disposición por día de trabajo?', perDayLabel: 'kVA disponibles por día de trabajo', perDayUnit: 'kVA', feminine: false, keywords: 'kva potencia generador grupo electrogeno transformador' },
  { id: 'hp_hour', kind: 'quantity', group: 'energy', singular: 'HP-hora', plural: 'HP-hora', short: 'HP-hora', label: '$/HP-hora (potencia de máquina)', hint: 'Potencia de bombas o compresores por hora de uso: HP × horas (1 HP = 0,746 kW; 1 CV = 0,736 kW).', perDayQuestion: '¿Cuántos HP-hora hacés por día de trabajo? (HP × horas)', feminine: false, keywords: 'hp hhp cv caballo fuerza vapor potencia maquina bomba compresor fractura' },
  { id: 'gas_m3', kind: 'quantity', group: 'volume', singular: 'm³ de gas', plural: 'm³ de gas', short: 'm³ gas', label: '$/m³ de gas', hint: 'Se factura cada metro cúbico de gas en condiciones estándar (9.300 kcal/m³): compresión, transporte, venta.', keywords: 'gas natural sm3 nm3 metro cubico estandar compresion' },
  // Equipos y personal por tiempo.
  { id: 'equipment_hour', kind: 'quantity', group: 'time', singular: 'hora de equipo', plural: 'horas de equipo', short: 'h-equipo', label: '$/hora de equipo', hint: 'Se factura cada hora de cada equipo (equipos × horas): pulling, grúas, bombeo, compresores.', perDayQuestion: '¿Cuántas horas de equipo hacés por día de trabajo? (equipos × horas)', feminine: true, keywords: 'hora maquina equipo pulling workover grua' },
  { id: 'equipment_day', kind: 'quantity', group: 'time', singular: 'día-equipo', plural: 'días-equipo', short: 'día-equipo', label: '$/día-equipo', hint: 'Se factura cada día de cada equipo (equipos × días): tarifa diaria de perforación, workover, herramientas.', perDayQuestion: '¿Cuántos equipos facturás por día de trabajo?', perDayLabel: 'Equipos por día de trabajo', perDayUnit: 'equipos', feminine: false, keywords: 'day rate tarifa diaria equipo perforador workover' },
  { id: 'manday', kind: 'quantity', group: 'time', singular: 'jornal', plural: 'jornales', short: 'jornal', label: '$/jornal (día-hombre)', hint: 'Se factura cada día de cada persona (personas × días), como las cuadrillas por convenio.', perDayQuestion: '¿Cuántos jornales hacés por día de trabajo? (personas)', perDayLabel: 'Personas por día de trabajo', perDayUnit: 'personas', keywords: 'dia hombre cuadrilla convenio uocra petroleros' },
  { id: 'guard', kind: 'quantity', group: 'time', singular: 'guardia', plural: 'guardias', short: 'guardia', label: '$/guardia', hint: 'Se factura cada guardia cubierta (mantenimiento, seguridad e higiene, ambulancia, standby).', keywords: 'guardia standby disponibilidad' },
  // Pozo, montaje y obra.
  { id: 'stage', kind: 'quantity', group: 'oilfield', singular: 'etapa', plural: 'etapas', short: 'etapa', label: '$/etapa', hint: 'Se factura cada etapa (fractura, punzado, wireline, coiled tubing, tapones).', keywords: 'fractura punzado wireline coiled tubing tapon' },
  { id: 'drilled_meter', kind: 'quantity', group: 'oilfield', singular: 'metro perforado', plural: 'metros perforados', short: 'm perf.', label: '$/metro perforado', hint: 'Se factura cada metro perforado (pozos, pozos de agua, pilotes).', keywords: 'perforacion pozo agua pilote metro' },
  { id: 'connection', kind: 'quantity', group: 'oilfield', singular: 'conexión', plural: 'conexiones', short: 'conexión', label: '$/conexión', hint: 'Se factura cada conexión (tie-in, armado de cabezal, conexiones de pozo).', keywords: 'conexion tie-in cabezal' },
  { id: 'inch_dia', kind: 'quantity', group: 'assembly', singular: 'pulgada-diámetro', plural: 'pulgadas-diámetro', short: 'pulg-Ø', label: '$/pulgada-diámetro', hint: 'Montaje de cañerías: juntas × diámetro nominal en pulgadas (una junta de 6" = 6 pulgadas-diámetro).', feminine: true, keywords: 'pulgada soldadura diametro cañeria inch dia montaje' },
  { id: 'joint', kind: 'quantity', group: 'assembly', singular: 'junta', plural: 'juntas', short: 'junta', label: '$/junta soldada', hint: 'Se factura cada junta o unión soldada (ductos, radiografiado y END por junta).', keywords: 'junta soldadura union radiografia end ducto' },
  { id: 'point', kind: 'quantity', group: 'assembly', singular: 'boca', plural: 'bocas', short: 'boca', label: '$/boca o punto', hint: 'Se factura cada boca o punto de instalación (eléctrica, sanitaria, de inspección).', keywords: 'boca punto instalacion electrica sanitaria tablero' },
  // Logística y residuos.
  { id: 'pallet', kind: 'quantity', group: 'logistics', singular: 'pallet', plural: 'pallets', short: 'pallet', label: '$/pallet', hint: 'Se factura cada pallet movido o almacenado.', keywords: 'pallet palet deposito almacenaje' },
  { id: 'container', kind: 'quantity', group: 'logistics', singular: 'contenedor', plural: 'contenedores', short: 'contenedor', label: '$/contenedor', hint: 'Se factura cada contenedor (20\' o 40\') transportado o almacenado.', keywords: 'contenedor container teu' },
  { id: 'drum', kind: 'quantity', group: 'logistics', singular: 'tambor', plural: 'tambores', short: 'tambor', label: '$/tambor', hint: 'Se factura cada tambor (residuos peligrosos, lubricantes).', keywords: 'tambor residuo peligroso lubricante' },
  { id: 'bag', kind: 'quantity', group: 'logistics', singular: 'bolsa', plural: 'bolsas', short: 'bolsa', label: '$/bolsa o big bag', hint: 'Se factura cada bolsa o big bag (arena, cemento, residuos).', keywords: 'bolsa big bag arena cemento' },
  // Laboratorio.
  { id: 'sample', kind: 'quantity', group: 'count', singular: 'muestra', plural: 'muestras', short: 'muestra', label: '$/muestra', hint: 'Se factura cada muestra tomada o analizada (aguas, suelos, hidrocarburos).', keywords: 'muestra laboratorio agua suelo' },
  { id: 'analysis', kind: 'quantity', group: 'count', singular: 'análisis', plural: 'análisis', short: 'análisis', label: '$/análisis o determinación', hint: 'Se factura cada análisis o determinación de laboratorio (por parámetro).', feminine: false, keywords: 'analisis determinacion laboratorio parametro' },
  { id: 'job', kind: 'event', singular: 'trabajo', plural: 'trabajos', short: 'trabajo', label: '$ global (por trabajo)', hint: 'Un único precio por todo el trabajo.' },
  { id: 'milestone', kind: 'event', singular: 'hito', plural: 'hitos', short: 'hito', label: '$/hito', hint: 'El precio del trabajo se factura en partes, por hito.', perActivation: true },
  { id: 'custom', kind: 'quantity', singular: '', plural: '', short: '', label: 'Otra / personalizada', hint: 'Escribí tu unidad: válvula, muestra, junta…', custom: true },
]);

export const BILLING_UNIT_IDS = deepFreeze(BILLING_UNITS.map((u) => u.id));

/** Grupos para ordenar y buscar las unidades (sólo presentación). */
export const BILLING_UNIT_GROUPS = deepFreeze([
  { id: 'time', label: 'Tiempo' },
  { id: 'event', label: 'Por evento o trabajo' },
  { id: 'count', label: 'Cantidad' },
  { id: 'length', label: 'Longitud y superficie' },
  { id: 'volume', label: 'Volumen' },
  { id: 'mass', label: 'Peso y transporte' },
  { id: 'energy', label: 'Energía y potencia' },
  { id: 'oilfield', label: 'Pozo' },
  { id: 'assembly', label: 'Montaje e instalaciones' },
  { id: 'logistics', label: 'Logística y residuos' },
  { id: 'other', label: 'Otra' },
]);

/** Grupo de las unidades anteriores a la ampliación 2026-11 (las nuevas lo traen en `group`). */
const LEGACY_GROUPS = {
  hour: 'time', day: 'time', month: 'time', shift: 'time', manhour: 'time',
  call: 'event', job: 'event', milestone: 'event',
  unit: 'count', piece: 'count', set: 'count', lot: 'count', well: 'oilfield', test: 'count',
  meter: 'length', m2: 'length', ha: 'length', km: 'mass', trip: 'mass',
  m3: 'volume', liter: 'volume', barrel: 'volume',
  kg: 'mass', ton: 'mass', tonkm: 'mass',
  custom: 'other',
};

/** Grupo de una unidad del catálogo: { id, label }. */
export function unitGroupOf(unit) {
  const def = typeof unit === 'string' ? BILLING_UNITS.find((u) => u.id === unit) : unit;
  const id = (def && (def.group || LEGACY_GROUPS[def.id])) || 'other';
  return BILLING_UNIT_GROUPS.find((g) => g.id === id);
}

const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Unidades que coinciden con lo que se escribe ("joule", "potencia", "kva"):
 * busca en el rótulo, los nombres, el grupo y las palabras clave, sin tildes.
 */
export function searchUnits(units, query) {
  const words = fold(query).split(/[\s/$]+/).filter(Boolean);
  if (!words.length) return [...units];
  return units.filter((u) => {
    const hay = fold([u.label, u.singular, u.plural, u.short, u.keywords, unitGroupOf(u).label].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Unidades que existían antes de PLAN-2026-009 (calculan exactamente igual). */
export const LEGACY_BILLING_UNITS = deepFreeze(['day', 'hour', 'month']);

/**
 * Unidades habituales según el tipo de servicio (la primera es la sugerida).
 * "Otra / personalizada" se ofrece siempre; "Servicio configurable", todas.
 */
export const SERVICE_TYPE_UNITS = deepFreeze({
  on_call: ['day', 'hour', 'call', 'month'],
  permanent: ['month', 'day', 'hour', 'shift'],
  crew: ['day', 'hour', 'manhour', 'shift', 'month', 'manday', 'guard'],
  equipment_with_operator: ['day', 'hour', 'month', 'trip', 'equipment_hour', 'equipment_day', 'kva_day', 'kw_day', 'hp_hour', 'kwh'],
  equipment_only: ['day', 'hour', 'month', 'trip', 'equipment_hour', 'equipment_day', 'kva_day', 'kw_day', 'hp_hour', 'kwh'],
  per_unit: ['unit', 'piece', 'well', 'test', 'manhour', 'm3', 'ton', 'kg', 'meter', 'm2', 'ha', 'liter', 'barrel', 'km', 'lot', 'set',
    'stage', 'drilled_meter', 'connection', 'inch_dia', 'joint', 'point', 'sample', 'analysis', 'kwh', 'mwh', 'mj', 'gj', 'mmbtu', 'gas_m3', 'pallet', 'drum', 'bag'],
  transport: ['trip', 'km', 'ton', 'tonkm', 'm3', 'liter', 'barrel', 'hour', 'day', 'pallet', 'container', 'drum', 'bag', 'gas_m3'],
  turnkey: ['job', 'milestone'],
  lump_sum: ['job', 'milestone'],
  time_materials: ['hour', 'manhour', 'day', 'manday', 'equipment_hour'],
  configurable: BILLING_UNIT_IDS.filter((id) => id !== 'custom'),
});

/** Plural simple de una unidad escrita por la persona ("pozo" → "pozos"). */
export function pluralizeUnit(word) {
  const w = typeof word === 'string' ? word.trim() : '';
  if (!w) return 'unidades';
  // Varias palabras: "prueba hidráulica" → "pruebas hidráulicas", "metro lineal" → "metros lineales";
  // con "de" sólo la primera: "punto de inspección" → "puntos de inspección".
  if (/\s/.test(w)) {
    const parts = w.split(/\s+/);
    const cut = parts.findIndex((p, i) => i > 0 && /^(de|del|para|por|con|a)$/i.test(p));
    const head = cut === -1 ? parts : parts.slice(0, cut);
    const tail = cut === -1 ? [] : parts.slice(cut);
    return [...head.map((p) => pluralizeUnit(p)), ...tail].join(' ');
  }
  if (/[²³]|^[a-z]{1,2}$/i.test(w) || /-/.test(w)) return w;
  // Sigla en mayúsculas de hasta 4 letras (PSV, END, ROV): no se pluraliza ("3 PSV", no "3 PSVES").
  if (/^[A-ZÁÉÍÓÚÑ]{1,4}$/.test(w)) return w;
  // En mayúsculas ("UNIDAD") el plural también va en mayúsculas ("UNIDADES", no "UNIDADes").
  const upper = w === w.toUpperCase() && w !== w.toLowerCase();
  let out;
  if (/ón$/i.test(w)) out = `${w.slice(0, -2)}ones`;
  else if (/[aeiouáéíóú]$/i.test(w)) out = `${w}s`;
  else if (/s$/i.test(w)) out = w;
  else if (/z$/i.test(w)) out = `${w.slice(0, -1)}ces`;
  // Consonantes del plural en "-es" (papel, camión, motor, unidad, reloj, fax, rey); con otra
  // terminación (casi siempre palabras tomadas de otro idioma) va "+s": kit → kits, chip → chips.
  else if (/[lnrdjxy]$/i.test(w)) out = `${w}es`;
  else out = `${w}s`;
  return upper ? out.toUpperCase() : out;
}

/** Nombre de unidad propia saneado (sin caracteres de control, máx. 30). */
export function cleanUnitName(raw) {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/^\s*\$?\s*\/?\s*/, '').trim().slice(0, MAX_UNIT_NAME) : '';
}

/**
 * Unidad de facturación de una cotización, resuelta para mostrar y calcular.
 * Una unidad desconocida (o vacía) es "día", como siempre.
 * @param {object} quote
 * @returns {{ id: string, kind: 'day'|'hour'|'month'|'event'|'quantity', singular: string, plural: string, short: string, label: string, custom: boolean, legacy: boolean }}
 */
export function billingUnitOf(quote = {}) {
  const id = quote && typeof quote.unit === 'string' && BILLING_UNIT_IDS.includes(quote.unit) ? quote.unit : 'day';
  const def = BILLING_UNITS.find((u) => u.id === id);
  if (def.custom) {
    const name = cleanUnitName(quote.unitName) || 'unidad';
    const plural = name === 'unidad' ? 'unidades' : pluralizeUnit(name);
    return { id, kind: def.kind, singular: name, plural, short: name, label: `$/${name}`, custom: true, legacy: false };
  }
  const info = { id, kind: def.kind, singular: def.singular, plural: def.plural, short: def.short, label: def.label, custom: false, legacy: LEGACY_BILLING_UNITS.includes(id) };
  if (typeof def.feminine === 'boolean') info.feminine = def.feminine;
  if (def.perDayQuestion) info.perDayQuestion = def.perDayQuestion;
  if (def.perDayLabel) info.perDayLabel = def.perDayLabel;
  if (def.perDayUnit) info.perDayUnit = def.perDayUnit;
  return info;
}

/** Unidades para elegir según el tipo de servicio (+ la actual, si no está, + "Otra"). */
export function unitChoicesFor(serviceType, currentUnit = null) {
  const list = [...(SERVICE_TYPE_UNITS[serviceType] || SERVICE_TYPE_UNITS.configurable)];
  if (currentUnit && BILLING_UNIT_IDS.includes(currentUnit) && currentUnit !== 'custom' && !list.includes(currentUnit)) list.push(currentUnit);
  list.push('custom');
  return list.map((id) => BILLING_UNITS.find((u) => u.id === id));
}

/** Unidad sugerida para un tipo de servicio. */
export function defaultUnitFor(serviceType) {
  const list = SERVICE_TYPE_UNITS[serviceType];
  return list && list.length ? list[0] : 'day';
}

/** ¿La unidad es una de las habituales para el tipo de servicio? */
export function unitFitsServiceType(serviceType, unit) {
  if (unit === 'custom') return true;
  const list = SERVICE_TYPE_UNITS[serviceType];
  return !list || list.includes(unit || 'day');
}

/** Género gramatical aproximado de una unidad ("muestra", "inspección" → femenino). */
export function isFeminineUnit(singular) {
  const w = typeof singular === 'string' ? singular.trim().toLowerCase() : '';
  if (!w || ['día', 'dia', 'mapa', 'problema', 'sistema', 'programa'].includes(w)) return false;
  if (/^hora-/.test(w)) return true; // hora-hombre, hora-equipo
  if (w === 'bbl') return false;
  return /(a|ción|sión|dad|tud)$/.test(w);
}

/** Mayúscula inicial para palabras ("Válvulas"), nunca para símbolos (m³, kg, t). */
export function capitalizeUnitWord(text) {
  const t = typeof text === 'string' ? text : '';
  return /^[a-zñáéíóú]{4,}/i.test(t) ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t;
}

/** Textos de la actividad y del equilibrio en la unidad comercial. */
export function unitTexts(info) {
  const u = info || billingUnitOf({});
  const plural = u.plural || 'unidades';
  const fem = typeof u.feminine === 'boolean' ? u.feminine : isFeminineUnit(u.singular);
  const cuantos = fem ? 'Cuántas' : 'Cuántos';
  return {
    // Concordancia ("las unidades", "cuántas toneladas", "ningún viaje").
    los: fem ? 'las' : 'los',
    cuantos: fem ? 'cuántas' : 'cuántos',
    Cuantos: cuantos,
    ningun: fem ? 'ninguna' : 'ningún',
    facturados: fem ? 'facturadas' : 'facturados',
    elPrimer: fem ? 'la primera' : 'el primer',
    vendido: fem ? 'vendida' : 'vendido',
    quantityQuestion: `¿${cuantos} ${plural} esperás facturar por mes?`,
    perDayQuestion: u.perDayQuestion || `¿${cuantos} ${plural} hacés por día de trabajo?`,
    // Los símbolos (m³, km, kg, t) no se escriben con mayúscula.
    breakEvenLabel: `${capitalizeUnitWord(plural)} para no perder`,
    perMonth: `${plural}/mes`,
    perDay: u.perDayUnit || `${plural}/día`,
    // Rótulo del rendimiento ("kVA disponibles por día de trabajo" en vez de "kVA-día por día de trabajo").
    perDayLabel: u.perDayLabel || `${capitalizeUnitWord(plural)} por día de trabajo`,
  };
}
