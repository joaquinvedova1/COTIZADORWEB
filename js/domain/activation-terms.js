/**
 * Terminología de la ACTIVACIÓN (PLAN-2026-014, LAB-D8).
 *
 * Internamente hay UNA sola magnitud: la activación (`activationsPerMonth`,
 * `daysPerActivation`, costos "por activación"): cada vez que el servicio se
 * pone en marcha (sale de la base, se moviliza, cobra un llamado). En la
 * interfaz se nombra según la cotización y, dentro de una cotización, siempre
 * con el mismo nombre:
 *
 *   unidad "llamado"            llamado        se factura cada llamado
 *   unidad "trabajo" o "hito"   trabajo        cada trabajo es una activación
 *   on-call                     llamado        el cliente llama y el equipo sale
 *   transporte                  salida         una salida agrupa uno o más viajes
 *   llave en mano / cerrado     trabajo
 *   configurable (cotizaciones  salida         (UXR: sin tipo de servicio; cada salida de la base)
 *   nuevas, sin tipo)
 *   el resto                    intervención   (servicios técnicos, cuadrillas, equipos…)
 *
 * Un servicio permanente usa "intervención": RATEOS no sabe si cada activación
 * es un relevo o un cambio de turno (no hay un dato que lo diga), así que no lo
 * nombra así.
 *
 * Otras magnitudes NO son activaciones y tienen su propio nombre: "viaje" (un
 * viaje físico; con la unidad "viaje", lo que se factura), "día de trabajo",
 * "turno" (unidad de facturación) y "salida de caja" (plata que sale).
 * Una magnitud = un significado económico.
 */

const LLAMADO = Object.freeze({ id: 'llamado', one: 'llamado', many: 'llamados', feminine: false });
const SALIDA = Object.freeze({ id: 'salida', one: 'salida', many: 'salidas', feminine: true });
const TRABAJO = Object.freeze({ id: 'trabajo', one: 'trabajo', many: 'trabajos', feminine: false });
const INTERVENCION = Object.freeze({ id: 'intervencion', one: 'intervención', many: 'intervenciones', feminine: true });

/** La unidad que se factura ES la activación: manda su nombre. */
const BY_UNIT = Object.freeze({ call: LLAMADO, job: TRABAJO, milestone: TRABAJO });
const BY_SERVICE = Object.freeze({ on_call: LLAMADO, transport: SALIDA, turnkey: TRABAJO, lump_sum: TRABAJO, configurable: SALIDA });

/** Nombres posibles de una activación (para la auditoría de terminología de Test Lab). */
export const ACTIVATION_TERMS = Object.freeze([LLAMADO, SALIDA, TRABAJO, INTERVENCION]);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Nombre base de la activación de una cotización ({ serviceType, unit }) o de un tipo de servicio. */
export function activationTermOf(serviceTypeOrQuote) {
  const isQuote = serviceTypeOrQuote !== null && typeof serviceTypeOrQuote === 'object';
  const type = isQuote ? serviceTypeOrQuote.serviceType : serviceTypeOrQuote;
  const unit = isQuote ? serviceTypeOrQuote.unit : null;
  return BY_UNIT[unit] || BY_SERVICE[type] || INTERVENCION;
}

/**
 * Nombres de la activación para una cotización ({ serviceType, unit }) o un
 * tipo de servicio. Sin datos (por ejemplo, un recurso de la biblioteca) →
 * "intervención".
 * @param {string|{serviceType?: string, unit?: string}} [serviceTypeOrQuote]
 */
export function activationTerms(serviceTypeOrQuote) {
  return termsOf(activationTermOf(serviceTypeOrQuote));
}

/** Formas derivadas de un nombre base. */
function termsOf(t) {
  return Object.freeze({
    id: t.id,
    one: t.one,
    many: t.many,
    One: cap(t.one),
    Many: cap(t.many),
    feminine: t.feminine,
    /** "el llamado" / "la salida" */
    the: t.feminine ? 'la' : 'el',
    /** "los llamados" / "las salidas" */
    theMany: t.feminine ? 'las' : 'los',
    /** "un llamado" / "una salida" */
    a: t.feminine ? 'una' : 'un',
    /** "por llamado" / "por salida" */
    per: `por ${t.one}`,
    /** "cada llamado" / "cada salida" */
    each: `cada ${t.one}`,
    /** "Cada llamado" / "Cada salida" */
    Each: `Cada ${t.one}`,
    /** "completo" / "completa" (cada salida se cuenta completa) */
    whole: t.feminine ? 'completa' : 'completo',
    /** "completos" / "completas" (salidas completas) */
    wholeMany: t.feminine ? 'completas' : 'completos',
    /** Concordancia: g('costeadas', 'costeados'). */
    g: (fem, masc) => (t.feminine ? fem : masc),
    /** Singular o plural según la cantidad. */
    word: (n) => (Math.abs(Number(n) - 1) < 1e-9 ? t.one : t.many),
  });
}

/** Los nombres de todas las formas posibles (para la auditoría de terminología de Test Lab). */
export const EVERY_ACTIVATION_TERMS = Object.freeze(ACTIVATION_TERMS.map(termsOf));

/**
 * Rótulos de campos que nombran la activación. Los usan el formulario y los
 * avisos que citan esos campos: un aviso nunca nombra un campo que no existe.
 * @param {ReturnType<typeof activationTerms>} T
 */
export function activationFieldLabels(T) {
  return Object.freeze({
    fullActivations: `${T.Each} se cuenta ${T.whole}`,
    tripsPerActivation: `Viajes ${T.per}`,
    tollsPerActivation: `Peajes ${T.per}`,
    lodgingPerActivation: `Alojamiento y viáticos ${T.per}`,
    minimumCall: `Mínimo ${T.per}`,
    externalMinimum: `Mínimo ${T.per} (opcional)`,
    externalMobilization: `Movilización ${T.per}`,
    includedKm: `Km incluidos ${T.per}`,
    perActivation: `Por ${T.one}`,
  });
}

/** Ids de las opciones de catálogo que significan "por activación" (materiales, otros costos, tarifas externas). */
const PER_ACTIVATION_IDS = Object.freeze(['per_activation', 'activation']);

/**
 * Opciones de un catálogo con la opción "por activación" nombrada como en la
 * cotización ("Por llamado", "Por salida"…). `short` ("/salida") también.
 * @param {{id: string, label: string, short?: string}[]} options
 */
export function withActivationOptions(options, T) {
  return (Array.isArray(options) ? options : []).map((o) => (PER_ACTIVATION_IDS.includes(o.id)
    ? { ...o, label: `Por ${T.one}`, ...(typeof o.short === 'string' ? { short: `/${T.one}` } : {}) }
    : o));
}

