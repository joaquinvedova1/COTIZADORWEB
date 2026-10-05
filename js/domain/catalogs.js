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
  { id: 'time_materials', label: 'Horas y materiales (time & materials)', hint: 'Cobrás horas y materiales al costo más un recargo.' },
  { id: 'lump_sum', label: 'Precio cerrado (lump sum)', hint: 'Un único precio por todo el alcance.' },
  { id: 'configurable', label: 'Servicio configurable', hint: 'Armá la estructura a medida.' },
]);

/** Tipos de servicio que normalmente requieren equipos propios. */
export const EQUIPMENT_SERVICE_TYPES = deepFreeze(['on_call', 'equipment_with_operator', 'equipment_only', 'transport']);

/** Tipos de servicio con cobertura continua (requieren pensar en relevos). */
export const CONTINUOUS_SERVICE_TYPES = deepFreeze(['on_call', 'permanent']);

export const PRICING_MODES = deepFreeze([
  { id: 'known_rate', label: 'Ya tengo la tarifa', hint: 'Ingresás la tarifa y RATEOS calcula días mínimos, break-even y resultado.' },
  { id: 'known_activity', label: 'Calcular la tarifa', hint: 'Ingresás la actividad estimada y RATEOS calcula la tarifa piso y las tarifas con margen.' },
]);

export const RATE_UNITS = deepFreeze([
  { id: 'day', label: '$/día', long: 'por día' },
  { id: 'hour', label: '$/hora', long: 'por hora' },
  { id: 'month', label: '$/mes (abono)', long: 'por mes' },
]);

export const COST_CATEGORIES = deepFreeze([
  { id: 'labor', label: 'Mano de obra' },
  { id: 'equipment', label: 'Equipos propios' },
  // Alquilados y tercerizados (PLAN-2026-005): costo externo, no un activo propio.
  { id: 'external', label: 'Equipos y servicios externos' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'materials', label: 'Materiales' },
  { id: 'logistics', label: 'Logística' },
  { id: 'structure', label: 'Gastos de estructura' },
  { id: 'financial', label: 'Financiero' },
  { id: 'contingency', label: 'Contingencia' },
]);

export const COST_CATEGORY_IDS = deepFreeze(COST_CATEGORIES.map((c) => c.id));

/** Categorías que un usuario puede asignar a "otros costos" (directos). */
export const DIRECT_CATEGORY_IDS = deepFreeze(['labor', 'equipment', 'external', 'fuel', 'materials', 'logistics', 'structure']);

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

/** Tipos de equipo de la biblioteca. */
export const EQUIPMENT_TYPES = deepFreeze([
  { id: 'vehicle', label: 'Vehículo liviano / pickup' },
  { id: 'truck', label: 'Camión' },
  { id: 'crane_truck', label: 'Camión con hidrogrúa' },
  { id: 'crane', label: 'Grúa' },
  { id: 'backhoe', label: 'Retroexcavadora' },
  { id: 'generator', label: 'Generador' },
  { id: 'compressor', label: 'Compresor' },
  { id: 'pump', label: 'Bomba' },
  { id: 'trailer', label: 'Tráiler / semirremolque' },
  { id: 'tools', label: 'Herramientas especiales' },
  { id: 'other', label: 'Otro' },
]);

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
  { id: 'per_activation', label: 'Por llamado / viaje' },
]);

export const MATERIAL_BASES = deepFreeze([
  { id: 'per_month', label: 'Por mes' },
  { id: 'per_active_day', label: 'Por día activo' },
  { id: 'per_activation', label: 'Por llamado' },
]);

export const INDIRECT_METHODS = deepFreeze([
  { id: 'percent_direct', label: '% sobre costo directo', uses: 'pct' },
  { id: 'percent_labor', label: '% sobre mano de obra', uses: 'pct' },
  { id: 'per_employee', label: 'Monto mensual por empleado', uses: 'amount' },
  { id: 'per_contract', label: 'Monto mensual por contrato', uses: 'amount' },
  { id: 'per_hour', label: 'Monto por hora operativa', uses: 'amount' },
  { id: 'manual', label: 'Monto mensual manual', uses: 'amount' },
]);

/**
 * Impuestos que se pagan sobre lo que se FACTURA (no sobre el costo). Sólo
 * nombres: RATEOS no trae alícuotas (las carga cada empresa con su contador).
 * No incluye IVA, Ganancias, retenciones/percepciones (pagos a cuenta) ni
 * costo financiero (RATEOS lo calcula por plazos de cobro y pago).
 */
export const BILLING_TAX_KINDS = deepFreeze([
  { id: 'gross_income', label: 'Ingresos Brutos', hint: 'Alícuota sobre lo que facturás, según tu actividad y jurisdicción.' },
  { id: 'debits_credits', label: 'Impuesto al cheque (débitos y créditos)', hint: 'Como el cobro entra con IVA, pedile a tu contador el % sobre tu facturación sin IVA.' },
  { id: 'stamp', label: 'Sellos', hint: 'Si el contrato paga sellos. RATEOS lo reparte proporcional a la facturación.' },
  { id: 'other', label: 'Otro cargo sobre lo facturado', hint: 'Por ejemplo, un seguro de caución sobre el valor del contrato.' },
]);

/**
 * Convención de IVA de una cotización (quote.vatTreatment). Hoy RATEOS sólo
 * trabaja con montos SIN IVA (los motores no calculan IVA); el campo deja la
 * convención explícita y permite agregar otra en el futuro sin romper el
 * modelo (con su migración).
 */
export const VAT_TREATMENTS = deepFreeze([
  { id: 'excluded', label: 'Montos sin IVA', hint: 'Costos, precios y tarifas se cargan y se muestran sin IVA.' },
]);
export const DEFAULT_VAT_TREATMENT = 'excluded';

/** Modos de carga de los impuestos sobre la facturación (excluyentes). */
export const BILLING_TAX_MODES = deepFreeze([
  { id: 'combined', label: 'Un % total' },
  { id: 'detailed', label: 'Detalle por impuesto' },
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
  external: 'suppliers',
  fuel: 'fuel',
  materials: 'materials',
  logistics: 'suppliers',
  structure: 'structure',
});

/**
 * Pasos del flujo de cotización (orden obligatorio). Estos nombres son la
 * ÚNICA fuente de los nombres de paso en la interfaz (editor, resultado,
 * avisos "Ir a…"): no repetirlos a mano en las vistas.
 */
export const QUOTE_STEPS = deepFreeze([
  { id: 'service', label: 'Tipo de servicio' },
  { id: 'modality', label: 'Cómo se cobra' },
  { id: 'labor', label: 'Personal' },
  { id: 'equipment', label: 'Equipos' },
  { id: 'materials', label: 'Materiales' },
  { id: 'logistics', label: 'Viajes' },
  { id: 'indirect', label: 'Gastos de estructura' },
  { id: 'finance', label: 'Financiación' },
  { id: 'risk', label: 'Imprevistos' },
  { id: 'margin', label: 'Margen y precio' },
  { id: 'result', label: 'Resultado' },
]);

// ------------------------------------------------ base económica (PLAN-2026-005)

/**
 * Monedas en las que se puede cargar un valor. La cotización calcula en la
 * moneda de la empresa; otra moneda necesita un tipo de cambio explícito
 * de la cotización (RATEOS nunca lo busca solo).
 */
export const CURRENCIES = deepFreeze([
  { id: 'ARS', label: 'Pesos (ARS)', symbol: '$' },
  { id: 'USD', label: 'Dólares (USD)', symbol: 'US$' },
  { id: 'EUR', label: 'Euros (EUR)', symbol: '€' },
]);

/** De dónde sale un valor económico (base). */
export const BASE_SOURCES = deepFreeze([
  { id: 'company', label: 'Carga de la empresa' },
  { id: 'supplier', label: 'Cotización de proveedor' },
  { id: 'agreement', label: 'Convenio / escala vigente' },
  { id: 'index', label: 'Índice o publicación' },
  { id: 'other', label: 'Otra fuente' },
]);

/** Cómo se obtiene un recurso. */
export const ACQUISITION_MODES = deepFreeze([
  { id: 'owned', label: 'Propio', hint: 'Es de tu empresa: RATEOS calcula amortización, seguros, mantenimiento y consumos.' },
  { id: 'rented', label: 'Alquilado', hint: 'Lo alquilás a un proveedor y lo operás vos: es un costo externo (tarifa).' },
  { id: 'outsourced', label: 'Tercerizado', hint: 'Un proveedor presta el servicio (normalmente con su operador): es un costo externo.' },
]);

/** Unidad de la tarifa de un recurso externo. */
export const EXTERNAL_UNITS = deepFreeze([
  { id: 'hour', label: 'Por hora', short: '/h' },
  { id: 'day', label: 'Por día', short: '/día' },
  { id: 'month', label: 'Por mes', short: '/mes' },
  { id: 'trip', label: 'Por viaje (cada ida o vuelta)', short: '/viaje' },
  { id: 'km', label: 'Por km', short: '/km' },
  { id: 'activation', label: 'Por llamado', short: '/llamado' },
  { id: 'global', label: 'Global (todo el contrato)', short: ' global' },
]);

/** ¿El IVA que cobra el proveedor es recuperable (crédito fiscal) para tu empresa? */
export const VAT_RECOVERY = deepFreeze([
  { id: 'yes', label: 'Sí, lo recupero (crédito fiscal)' },
  { id: 'no', label: 'No lo recupero (es costo)' },
  { id: 'partial', label: 'Lo recupero en parte' },
]);

/** ¿Cómo llega el equipo al lugar del servicio? */
export const MOBILIZATION_MODES = deepFreeze([
  { id: 'self', label: 'Se traslada por sus propios medios', hint: 'Va por ruta desde la base: RATEOS suma km, combustible en ruta y desgaste por km.' },
  { id: 'transported', label: 'Lo transporta otro equipo', hint: 'Carretón, batea o camión (propio, alquilado o tercerizado): el costo está en ese equipo.' },
  { id: 'support', label: 'Va con un vehículo de apoyo', hint: 'Lo lleva un vehículo de la logística auxiliar: el costo está en ese vehículo.' },
  { id: 'none', label: 'No requiere movilización', hint: 'Ya está en la locación o el servicio se presta en tu base.' },
]);

/** Quién maneja un equipo que se traslada por sus propios medios. */
export const DRIVER_OPTIONS = deepFreeze([
  { id: 'operator', label: 'Su operador (ya está en Personal)', hint: 'No se suma otra persona: el tiempo de manejo está dentro del costo del operador.' },
  { id: 'other', label: 'Otra persona', hint: 'Cargala en Personal (chofer): RATEOS no la agrega sola.' },
]);

/** Busca una etiqueta en un catálogo por id. */
export function labelOf(catalog, id, fallback = '—') {
  const item = catalog.find((c) => c.id === id || c.code === id);
  return item ? item.label : fallback;
}

/** Tramos de descuento por cantidad de días (por defecto sin descuento). */
export const DEFAULT_VOLUME_TIERS = deepFreeze([
  { id: 'tier-1', fromDays: 1, toDays: 1, discountPct: 0 },
  { id: 'tier-2', fromDays: 2, toDays: 7, discountPct: 0 },
  { id: 'tier-3', fromDays: 8, toDays: 15, discountPct: 0 },
  { id: 'tier-4', fromDays: 16, toDays: 30, discountPct: 0 },
  { id: 'tier-5', fromDays: 31, toDays: null, discountPct: 0 },
]);
