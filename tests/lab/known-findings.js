/**
 * RATEOS Test Lab — registro de hallazgos TRIADOS (PLAN-2026-013 §10–§11).
 *
 * Cada hallazgo que encuentra la campaña queda acá con su decisión:
 *   status 'fixed'     corregido con el protocolo (test que falla antes, fix,
 *                      golden, suite, lab de nuevo); si vuelve a aparecer, el
 *                      gate falla igual que la primera vez.
 *   status 'human'     HUMAN DECISION REQUIRED: hay más de una interpretación
 *                      válida o es política comercial. No se inventa la regla:
 *                      se informa y no frena el gate hasta que el dueño decida.
 *   status 'accepted'  aceptado por el dueño (con motivo).
 *
 * key = "<escenario o sonda>:<código>" (o `code`, acotado con `subjects` y/o
 * `match` sobre el detalle, para el mismo problema en varios escenarios).
 * `test` = el test de regresión que falló antes del fix.
 */

const REGRESSION = 'tests/engines/lab-findings.test.js';

export const KNOWN_FINDINGS = [
  // ---- Corregidos en esta rama (primera campaña, 2026-10-16) ----
  {
    id: 'LAB-F1',
    status: 'fixed',
    classification: 'P0 CONSISTENCY',
    code: 'MATH-ORACLE:kpis.externalMonthly',
    title: 'Con "cada salida se cuenta completa", el indicador "Costo económico" de externos sumaba el combustible por km del proveedor (≠ fila de externos de la EECC)',
    rootCause: 'quote-engine sumaba al indicador el ajuste por salidas completas de TODAS las líneas de origen "externo", incluida la de combustible no incluido en la tarifa (categoría "Combustible"). El costo total y los precios estaban bien; sólo el indicador y la salida de caja de externos quedaban altos.',
    fix: 'El ajuste del indicador usa sólo las líneas de tarifa y movilización del proveedor (categoría "external"), igual que el resto del indicador.',
    test: `${REGRESSION} › LAB-F1`,
  },
  {
    id: 'LAB-F1b',
    status: 'fixed',
    classification: 'P0 CONSISTENCY',
    code: 'MATH-ORACLE:kpis.externalCashMonthly',
    title: 'Mismo caso que LAB-F1 en la salida de caja de externos',
    rootCause: 'Ver LAB-F1.',
    fix: 'Ver LAB-F1.',
    test: `${REGRESSION} › LAB-F1`,
  },
  {
    id: 'LAB-F2',
    status: 'fixed',
    classification: 'P1 COMPLETENESS',
    code: 'UX-UNRESOLVABLE',
    match: /^"Combustible" \(logistics\.distanceKm\)/,
    title: 'Combustible por km con "Sin traslados": el botón llevaba a la distancia, que con "Sin traslados" no resuelve nada',
    rootCause: 'La regla de combustible no distinguía "sin distancia" de "Sin traslados" (la distancia se ignora con "Sin traslados").',
    fix: 'Con "Sin traslados" el pendiente dice por qué y lleva a esa opción; sin distancia sigue llevando a la distancia; sin viajes, a los viajes.',
    test: `${REGRESSION} › LAB-F2`,
  },
  {
    id: 'LAB-F3',
    status: 'fixed',
    classification: 'P0 CONSISTENCY',
    key: 'PRB-03:PROBE:PRB-03',
    title: 'Unidad "km": 8.000 km facturados con una ruta que recorre 4.000 km, aceptado como 100 % completo',
    rootCause: 'Con la unidad "km" los costos por km (proveedor, combustible, desgaste) usan los km de la ruta (distancia × viajes por salida) y nada comparaba esos km con los que se facturan.',
    fix: 'Nuevo aviso "Viajes y km de la ruta" (a revisar, resta puntaje) con los dos números y botón a los viajes por salida. No se deriva: ver la decisión LAB-D4.',
    test: `${REGRESSION} › LAB-F3`,
  },
  {
    id: 'LAB-F4',
    status: 'fixed',
    classification: 'P0 CONSISTENCY',
    key: 'PRB-05:PROBE:PRB-05',
    title: 'Unidad "viaje" o "km" con "Sin traslados": se venden viajes sin km ni costos de ruta, en silencio',
    rootCause: 'Ninguna regla cruzaba la unidad comercial con la opción "Sin traslados".',
    fix: 'El aviso "Viajes y km de la ruta" lo marca y lleva a "Sin traslados".',
    test: `${REGRESSION} › LAB-F4`,
  },
  {
    id: 'LAB-F5',
    status: 'fixed',
    classification: 'P1 UX',
    key: 'PRB-04:PROBE:PRB-04',
    title: '"Sin traslados" con un equipo que viaja por sus propios medios o con vehículo de apoyo: esa movilización no se suma y no se avisaba',
    rootCause: 'Con "Sin traslados" la regla de movilización no se evaluaba.',
    fix: 'La regla de movilización avisa (a revisar) nombrando los equipos y lleva a "Sin traslados".',
    test: `${REGRESSION} › LAB-F5`,
  },
  {
    id: 'LAB-F6',
    status: 'fixed',
    classification: 'P1 COMPLETENESS',
    key: 'PRB-06:PROBE:PRB-06',
    title: 'Externo $/hora sin horas por día (ni en la línea ni en la actividad): tarifa > 0 y $ 0 en el mes, sin aviso',
    rootCause: 'La regla de costo de equipos sólo miraba que el externo tuviera tarifa, no su driver (horas).',
    fix: 'Nuevo pendiente crítico "Horas del proveedor" con botón a las horas de la línea (o de la actividad si la línea las hereda). Con mínimo por llamado no aplica (factura el mínimo).',
    test: `${REGRESSION} › LAB-F6`,
  },
  {
    id: 'LAB-F7',
    status: 'fixed',
    classification: 'P1 COMPLETENESS',
    key: 'PRB-07:PROBE:PRB-07',
    title: 'Cobro por hora con 0 horas por día: no hay unidades facturables (tarifa "—") y la actividad figuraba completa',
    rootCause: 'La regla de actividad sólo miraba los días.',
    fix: 'Con unidad "hora" sin horas por día, la actividad queda crítica con botón a las horas por día (también para "Ya tengo la tarifa").',
    test: `${REGRESSION} › LAB-F7`,
  },
  {
    id: 'LAB-F8',
    status: 'fixed',
    classification: 'P1 COMPLETENESS',
    code: 'UX-SILENT-ZERO-MATERIAL',
    title: 'Material que pagamos con precio y cantidad 0 o negativa: suma $ 0 sin aviso (y la cantidad negativa no se validaba)',
    rootCause: 'La regla de materiales sólo pedía el responsable; validateQuote no revisaba materiales ni otros costos.',
    fix: 'La regla de materiales avisa (a revisar) la primera línea incompleta con botón a su cantidad o precio; validateQuote valida cantidad, costo, merma, logística y markup de reventa de materiales y el monto de otros costos con las mismas reglas que sus campos.',
    test: `${REGRESSION} › LAB-F8`,
  },
  {
    id: 'LAB-F8b',
    status: 'fixed',
    classification: 'P2 PRESENTATION',
    key: 'PRB-11:PROBE:PRB-11',
    title: 'Material con costo unitario y cantidad 0: $ 0 sin aviso',
    rootCause: 'Ver LAB-F8.',
    fix: 'Ver LAB-F8.',
    test: `${REGRESSION} › LAB-F8`,
  },
  {
    id: 'LAB-F9',
    status: 'fixed',
    classification: 'P2 PRESENTATION',
    key: 'PRB-12:PROBE:PRB-12',
    title: 'Puesto con sueldo y 0 posiciones junto a otro completo: no suma y no avisaba',
    rootCause: 'La regla de personal queda en verde si hay al menos un puesto completo.',
    fix: 'Aviso informativo "Puesto sin posiciones" (no resta puntaje) que nombra el puesto.',
    test: `${REGRESSION} › LAB-F9`,
  },
  {
    id: 'LAB-F9b',
    status: 'fixed',
    classification: 'P2 PRESENTATION',
    key: 'PRB-15:PROBE:PRB-15',
    title: '"El servicio no usa materiales" con materiales cargados: se ignoran en silencio',
    rootCause: 'Con esa opción la regla de materiales queda en verde y las líneas no se suman.',
    fix: 'Aviso informativo "Materiales sin sumar" con la cantidad de líneas ignoradas.',
    test: `${REGRESSION} › LAB-F9`,
  },
  {
    id: 'LAB-F10',
    status: 'fixed',
    classification: 'P2 PRESENTATION',
    code: 'UX-CRITICAL-NO-LINK',
    title: 'Críticos de un solo campo (actividad, margen, tarifa conocida, costo de equipos) sin botón al campo exacto',
    rootCause: 'Esas reglas no declaraban `focus` (el botón llevaba al paso, no al campo).',
    fix: 'Actividad (días, horas, cantidad del mes o por día según falte), margen, tarifa conocida, plazo de cobro y costo de equipos (reposición, vida útil o tarifa de la primera línea incompleta) llevan al campo. Sin equipos cargados el botón sigue yendo al paso (no hay campo: hay que agregar uno).',
    test: `${REGRESSION} › LAB-F10 y LAB-F11`,
  },

  // ---- Decisiones del dueño (HUMAN DECISION REQUIRED): no se inventa la regla ----
  {
    id: 'LAB-D1',
    status: 'human',
    key: 'PRB-14:PROBE:PRB-14',
    title: 'Menos de una intervención por mes con costos por salida prorrateados',
    decision: '¿Avisar cuando hay menos de una salida entera por mes (0,4 de movilización), o activar "Cada salida se cuenta completa" por defecto en ese caso? Hoy es opcional y está apagado (PLAN-2026-011).',
  },
  {
    id: 'LAB-D2',
    status: 'human',
    key: 'PRB-16:PROBE:PRB-16',
    title: 'Horas de trabajo por día mayores que la jornada del personal',
    decision: '12 h diarias con jornada normal y 0 horas extra se cotizan como jornada normal. ¿Se modelan como horas extra o como turnos/relevos? Dos modelos válidos: elegir antes de agregar un aviso o un cálculo.',
  },
  {
    id: 'LAB-D3',
    status: 'human',
    key: 'PRD-04-FINANCING-GAP:GAP:product-financing',
    title: 'Productos sin financiación',
    decision: 'El motor de productos no tiene plazos de cobro y pago ni costo financiero (las cotizaciones sí). ¿Se agrega? Es una funcionalidad nueva (PLAN propio).',
  },
  {
    id: 'LAB-D4',
    status: 'human',
    title: 'Unidad "km": ¿derivar los km de la ruta de los km facturados?',
    decision: 'Con la unidad "viaje" los viajes físicos se derivan (v0.7.2). Con "km", desde esta rama se AVISA cuando los km facturados no coinciden con los de la ruta (LAB-F3), pero no se deriva: un km facturado puede no ser un km recorrido (km cargados vs. vacíos, tarifa por km de distancia). ¿Derivar los viajes de la ruta, o dejar el aviso?',
  },
  {
    id: 'LAB-D5',
    status: 'human',
    key: 'PRB-20:PROBE:PRB-20',
    title: 'Equipo propio que no usa combustible',
    decision: 'El consumo de un equipo propio se pide siempre (0 = falta). Un andamio o una herramienta eléctrica no consume: la completitud no llega a 100 % sin cargar un consumo falso. Opciones: un dato nuevo "No usa combustible" por equipo, o leer 0 como "no usa" y vacío como "falta" (cambia el significado de un dato guardado).',
  },
  {
    id: 'LAB-D6',
    status: 'human',
    title: 'Huecos de CALCULATION_RULES (el oráculo sigue al motor, a confirmar)',
    decision: 'Tres comportamientos del motor que la documentación no dice: IVA "Parcial" sin % recuperable = 0 % recuperable (todo costo, y queda pendiente); "Otros costos" con categoría "external" se acepta como costo directo; las horas por día de una línea de equipo no se limitan a 24. ¿Se documentan así o se cambian?',
  },
  {
    id: 'LAB-D8',
    status: 'human',
    key: 'UI-TERMS:UX-TERM-SYNONYMS',
    title: '"Llamado", "salida" e "intervención" nombran la misma magnitud',
    decision: 'No es un error de cálculo (es una sola magnitud: cada intervención del servicio), pero en un mismo flujo aparece "Duración promedio de cada salida / intervención" y "Viajes por llamado". ¿Se elige un término por tipo de servicio (llamado en on-call, salida en transporte, intervención en el resto) y se unifica el copy?',
  },
  {
    id: 'LAB-D7',
    status: 'human',
    code: 'MARKET:fuel.diesel.ars_per_liter',
    classification: 'MARKET REVIEW',
    title: 'Combustible de los escenarios ($ 1.500/l) 19 % debajo del gasoil de referencia sin IVA (sep-2026)',
    decision: 'Es un input sintético de los escenarios (la matemática da PASS). El precio ILUSTRATIVO por defecto de una cuenta sin configuración propia también es $ 1.500/l (quote-factory, marcado ILUSTRATIVO y con pendiente "confirmalo"). ¿Se actualiza ese valor de ejemplo? Es decisión del dueño: el mercado nunca cambia una fórmula.',
  },
];
