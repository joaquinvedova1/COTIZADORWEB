/**
 * Catálogos del dominio (listas cerradas). Sin lógica de cálculo.
 */

import { deepFreeze } from '../core/object.js';

export const SERVICE_TYPES = deepFreeze([
  { id: 'on_call', label: 'Servicio on-call', hint: 'Recursos reservados que se activan cuando el cliente llama.' },
  { id: 'permanent', label: 'Servicio permanente', hint: 'Posiciones cubiertas en forma continua (turnos, diagramas, relevos).' },
  { id: 'crew', label: 'Cuadrilla / personal', hint: 'Personal propio afectado a tareas del cliente.' },
  { id: 'equipment_with_operator', label: 'Equipo con operador', hint: 'Equipo propio operado por personal propio.' },
  { id: 'equipment_only', label: 'Equipo sin operador', hint: 'Alquiler de equipo; opera el cliente.' },
  { id: 'per_unit', label: 'Servicio por unidad producida', hint: 'Se factura por m³, tonelada, metro, etc.' },
  { id: 'transport', label: 'Transporte', hint: 'Traslado de cargas o personas.' },
  { id: 'turnkey', label: 'Servicio llave en mano', hint: 'Alcance cerrado con entregables definidos.' },
  { id: 'time_materials', label: 'Time & Materials', hint: 'Horas y materiales a costo + fee.' },
  { id: 'lump_sum', label: 'Precio global / Lump Sum', hint: 'Un único precio por todo el alcance.' },
  { id: 'configurable', label: 'Servicio configurable', hint: 'Armá la estructura a medida.' },
]);

/** Tipos de servicio que normalmente requieren equipos propios. */
export const EQUIPMENT_SERVICE_TYPES = deepFreeze(['on_call', 'equipment_with_operator', 'equipment_only', 'transport']);

/** Tipos de servicio con cobertura continua (requieren pensar en relevos). */
export const CONTINUOUS_SERVICE_TYPES = deepFreeze(['on_call', 'permanent']);

export const PRICING_MODES = deepFreeze([
  { id: 'known_rate', label: 'Conozco la tarifa', hint: 'Ingresás la tarifa y RATEOS calcula días mínimos, break-even y resultado.' },
  { id: 'known_activity', label: 'Conozco la actividad', hint: 'Ingresás la actividad estimada y RATEOS calcula la tarifa piso y las tarifas con margen.' },
]);

export const RATE_UNITS = deepFreeze([
  { id: 'day', label: '$/día', long: 'por día' },
  { id: 'hour', label: '$/hora', long: 'por hora' },
  { id: 'month', label: '$/mes (abono)', long: 'por mes' },
]);

export const COST_CATEGORIES = deepFreeze([
  { id: 'labor', label: 'Mano de obra' },
  { id: 'equipment', label: 'Equipos' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'materials', label: 'Materiales' },
  { id: 'logistics', label: 'Logística' },
  { id: 'structure', label: 'Estructura' },
  { id: 'financial', label: 'Financiero' },
  { id: 'contingency', label: 'Contingencia' },
]);

export const COST_CATEGORY_IDS = deepFreeze(COST_CATEGORIES.map((c) => c.id));

/** Categorías que un usuario puede asignar a "otros costos" (directos). */
export const DIRECT_CATEGORY_IDS = deepFreeze(['labor', 'equipment', 'fuel', 'materials', 'logistics', 'structure']);

/**
 * Convenios parametrizables. Los parámetros por defecto son GENÉRICOS e
 * ILUSTRATIVOS (idénticos entre convenios): NO son valores de ningún CCT.
 * Cada empresa debe cargar los valores vigentes de su convenio.
 */
export const AGREEMENT_TYPES = deepFreeze([
  { code: 'petroleros_privados', label: 'Petroleros Privados' },
  { code: 'petroleros_jerarquicos', label: 'Petroleros Jerárquicos' },
  { code: 'camioneros', label: 'Camioneros' },
  { code: 'uocra', label: 'UOCRA' },
  { code: 'fuera_convenio', label: 'Fuera de convenio' },
  { code: 'personalizado', label: 'Personalizado' },
]);

export const ILLUSTRATIVE_AGREEMENT_PARAMS = deepFreeze({
  normalHoursPerMonth: 176,
  overtimePremiumPct: 50,
  sacPct: 8.33,
  vacationPct: 4,
  employerContributionsPct: 24,
  artPct: 6,
});

export const MATERIAL_PROVIDERS = deepFreeze([
  { id: 'contractor', label: 'Nosotros (contratista)', costForUs: true },
  { id: 'third_party', label: 'Tercero contratado por nosotros', costForUs: true },
  { id: 'client', label: 'Cliente (no es costo nuestro)', costForUs: false },
]);

export const FUEL_PROVIDERS = deepFreeze([
  { id: 'contractor', label: 'Lo pagamos nosotros' },
  { id: 'client', label: 'Lo provee el cliente' },
]);

export const COST_BEHAVIORS = deepFreeze([
  { id: 'fixed_monthly', label: 'Fijo mensual' },
  { id: 'per_active_day', label: 'Por día activo' },
  { id: 'per_activation', label: 'Por activación / viaje' },
]);

export const MATERIAL_BASES = deepFreeze([
  { id: 'per_month', label: 'Por mes' },
  { id: 'per_active_day', label: 'Por día activo' },
  { id: 'per_activation', label: 'Por activación' },
]);

export const INDIRECT_METHODS = deepFreeze([
  { id: 'percent_direct', label: '% sobre costo directo', uses: 'pct' },
  { id: 'percent_labor', label: '% sobre mano de obra', uses: 'pct' },
  { id: 'per_employee', label: 'Monto mensual por empleado', uses: 'amount' },
  { id: 'per_contract', label: 'Monto mensual por contrato', uses: 'amount' },
  { id: 'per_hour', label: 'Monto por hora operativa', uses: 'amount' },
  { id: 'manual', label: 'Monto mensual manual', uses: 'amount' },
]);

export const RISK_ITEMS = deepFreeze([
  { id: 'activity_variation', label: 'Variación de actividad' },
  { id: 'unproductive', label: 'Improductivos' },
  { id: 'weather', label: 'Clima' },
  { id: 'rework', label: 'Retrabajos' },
  { id: 'equipment_failure', label: 'Rotura de equipos' },
  { id: 'prices', label: 'Variación de precios' },
  { id: 'inflation', label: 'Inflación' },
  { id: 'logistics', label: 'Logística' },
  { id: 'penalties', label: 'Penalidades' },
  { id: 'warranty', label: 'Garantía' },
  { id: 'accidents', label: 'Accidentes' },
  { id: 'scope_uncertainty', label: 'Incertidumbre del alcance' },
]);

export const QUOTE_STATUSES = deepFreeze([
  { id: 'draft', label: 'Borrador' },
  { id: 'sent', label: 'Enviada' },
  { id: 'won', label: 'Ganada' },
  { id: 'lost', label: 'Perdida' },
  { id: 'archived', label: 'Archivada' },
]);

/** Estados de cotización considerados "activos" para el dashboard. */
export const ACTIVE_QUOTE_STATUSES = deepFreeze(['draft', 'sent', 'won']);

export const AVAILABILITY_OPTIONS = deepFreeze([
  { id: '24/7', label: '24/7' },
  { id: 'window', label: 'Franja horaria' },
]);

/** Agrupación de pagos para el cálculo de capital de trabajo. */
export const PAY_GROUPS = deepFreeze([
  { id: 'salaries', label: 'Salarios y cargas' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'suppliers', label: 'Proveedores (mantenimiento, repuestos, seguros, logística)' },
  { id: 'materials', label: 'Materiales' },
  { id: 'structure', label: 'Estructura y alquileres' },
]);

/** Grupo de pago por defecto de cada categoría de costo directo. */
export const CATEGORY_PAY_GROUP = deepFreeze({
  labor: 'salaries',
  equipment: 'suppliers',
  fuel: 'fuel',
  materials: 'materials',
  logistics: 'suppliers',
  structure: 'structure',
});

/** Pasos del flujo de cotización (orden obligatorio). */
export const QUOTE_STEPS = deepFreeze([
  { id: 'service', label: 'Tipo de servicio' },
  { id: 'modality', label: 'Modalidad de cotización' },
  { id: 'labor', label: 'Personal' },
  { id: 'equipment', label: 'Equipos' },
  { id: 'materials', label: 'Materiales' },
  { id: 'logistics', label: 'Logística' },
  { id: 'indirect', label: 'Costos indirectos' },
  { id: 'finance', label: 'Financiamiento' },
  { id: 'risk', label: 'Riesgo / contingencia' },
  { id: 'margin', label: 'Margen y reglas comerciales' },
  { id: 'result', label: 'Resultado' },
]);

/** Busca una etiqueta en un catálogo por id. */
export function labelOf(catalog, id, fallback = '—') {
  const item = catalog.find((c) => c.id === id || c.code === id);
  return item ? item.label : fallback;
}
