/**
 * Reporte de errores de la beta (PLAN-2026-029): listas fijas y validación.
 *
 * Un reporte es SÓLO texto de la persona y dos claves de listas fijas
 * (categoría y pantalla) más la versión de la app. Nunca lleva costos,
 * cotizaciones, ids, sesión, tokens ni capturas. La base vuelve a validar
 * todo (private.submit_bug_report); esto es para avisar antes de enviar.
 */

export const BUG_TEXT_MIN = 3;
export const BUG_TEXT_MAX = 2000;

export const BUG_CATEGORIES = Object.freeze([
  { id: 'calculo', label: 'Un cálculo da un resultado raro o equivocado' },
  { id: 'guardado', label: 'Guardar, abrir o sincronizar mis datos' },
  { id: 'pdf', label: 'El PDF o la exportación' },
  { id: 'cuenta', label: 'Registro, ingreso o mi cuenta' },
  { id: 'pantalla', label: 'Pantallas, botones o el celular' },
  { id: 'otro', label: 'Otra cosa' },
]);

export const BUG_SCREENS = Object.freeze([
  { id: 'inicio', label: 'Inicio' },
  { id: 'nuevo', label: 'Nuevo cálculo' },
  { id: 'cotizaciones', label: 'Lista de cotizaciones' },
  { id: 'cotizacion', label: 'Editor de una cotización' },
  { id: 'resultado', label: 'Resultado de una cotización' },
  { id: 'escenarios', label: 'Escenarios' },
  { id: 'productos', label: 'Lista de productos' },
  { id: 'producto', label: 'Un producto (pasos o resultado)' },
  { id: 'recursos', label: 'Recursos' },
  { id: 'plantillas', label: 'Servicios (plantillas)' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'cuenta', label: 'Mi cuenta' },
  { id: 'registro', label: 'Registro o ingreso' },
  { id: 'pdf', label: 'El PDF' },
  { id: 'otra', label: 'Otra pantalla' },
]);

/** Estados de un reporte, con el texto que ve la empresa. */
export const BUG_STATUSES = Object.freeze({
  received: { label: 'Recibido', tone: 'gray' },
  in_review: { label: 'En revisión', tone: 'blue' },
  approved: { label: 'Validado y aprobado', tone: 'green' },
  rejected: { label: 'No corresponde', tone: 'gray' },
  duplicate: { label: 'Duplicado', tone: 'gray' },
});

const labelOf = (list, id, fallback) => (list.find((x) => x.id === id) || { label: fallback }).label;
export const bugCategoryLabel = (id) => labelOf(BUG_CATEGORIES, id, 'Otra cosa');
export const bugScreenLabel = (id) => labelOf(BUG_SCREENS, id, 'Otra pantalla');
export const bugStatus = (status) => BUG_STATUSES[status] || { label: 'Recibido', tone: 'gray' };

/**
 * Pantalla de la lista fija a partir del hash actual, sin ids ni parámetros
 * (#/cotizaciones/<id>/resultado → "resultado").
 */
export function bugScreenFromHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [first, second, third] = parts;
  if (!first) return 'otra';
  if (first === 'inicio' || first === 'dashboard') return 'inicio';
  if (first === 'nuevo') return 'nuevo';
  if (first === 'cotizaciones') {
    if (!second) return 'cotizaciones';
    if (second === 'nueva') return 'nuevo';
    return third === 'result' || third === 'resultado' ? 'resultado' : 'cotizacion';
  }
  if (first === 'productos') {
    if (!second) return 'productos';
    return second === 'nuevo' ? 'nuevo' : 'producto';
  }
  if (first === 'recursos' || first === 'biblioteca') return 'recursos';
  if (first === 'servicios') return 'plantillas';
  if (first === 'escenarios') return 'escenarios';
  if (first === 'configuracion') return second === 'cuenta' ? 'cuenta' : 'configuracion';
  if (first === 'login' || first === 'registro' || first === 'recuperar-contrasena') return 'registro';
  return 'otra';
}

/**
 * Texto de una persona: sin caracteres de control (salvo salto de línea y tabulación), sin los
 * invisibles que disfrazan un texto (ancho cero, marcas y controles de dirección, BOM) y sin
 * espacios en los extremos. Igual que private.clean_report_text en la base.
 */
export function cleanBugText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim();
}

/**
 * @param {{ category?: string, did?: string, expected?: string, happened?: string, screen?: string }} input
 * @returns {{ ok: boolean, errors: Record<string, string>, report: { category: string, did: string, expected: string, happened: string, screen: string } }}
 */
export function validateBugReport(input = {}) {
  const report = {
    category: BUG_CATEGORIES.some((c) => c.id === input.category) ? input.category : '',
    did: cleanBugText(input.did),
    expected: cleanBugText(input.expected),
    happened: cleanBugText(input.happened),
    screen: BUG_SCREENS.some((s) => s.id === input.screen) ? input.screen : 'otra',
  };
  const errors = {};
  if (!report.category) errors.category = 'Elegí de qué se trata.';
  const text = (field, what) => {
    const n = report[field].length;
    if (n < BUG_TEXT_MIN) errors[field] = `Contanos ${what} (al menos ${BUG_TEXT_MIN} letras).`;
    else if (n > BUG_TEXT_MAX) errors[field] = `Hasta ${BUG_TEXT_MAX} caracteres (tiene ${n}).`;
  };
  text('did', 'qué hiciste');
  text('expected', 'qué esperabas');
  text('happened', 'qué pasó');
  return { ok: Object.keys(errors).length === 0, errors, report };
}
