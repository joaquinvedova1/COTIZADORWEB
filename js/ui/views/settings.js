/**
 * Configuración, en pestañas (#/configuracion/:tab):
 *   Empresa · Parámetros económicos · Convenios · Datos y backup · Acerca de.
 *
 * - Empresa: nombre, base, tipo de empresa y marca de datos de ejemplo.
 * - Parámetros económicos: valores por defecto de cada cotización nueva.
 * - Convenios: la gestión de convenios de library.js (renderAgreements).
 * - Datos y backup: exportar / importar JSON, restaurar los datos de ejemplo
 *   y copias de recuperación.
 * - Acerca de: versión, build, esquema, almacenamiento, privacidad y
 *   funciones disponibles.
 *
 * Empresa y parámetros se guardan solos (debounce ~600 ms) cuando todos los
 * campos son válidos, con el indicador "Guardando… / Guardado", igual que el
 * editor de cotizaciones.
 */

import { h, mount, uniqueId, downloadText, readFileAsText } from '../dom.js';
import { badge, banner, button, card, checkboxField, confirmDialog, formGrid, numberField, selectField, textField } from '../components.js';
import { APP_NAME, FEATURES, MAX_BACKUP_BYTES, SCHEMA_VERSION, STORAGE_MODE, DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../../config.js';
import { formatDateTime, formatNumber, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { sanitizeText, validateNumber } from '../../core/validation.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';
import { renderAgreements } from './library.js';

const MAX_MATRIX_DAYS = 12;
const MAX_LADDER_STEPS = 6;

/** Espera desde el último cambio válido hasta guardar. */
export const SETTINGS_AUTOSAVE_DELAY_MS = 600;

/**
 * Funciones que ve el usuario en "Acerca de", con nombre de negocio. Sólo se
 * listan las activas; los flags técnicos (persistencia remota, envío de
 * eventos) no se muestran.
 */
const BUSINESS_FEATURE_LABELS = Object.freeze({
  scenarios: 'Escenarios pesimista, base y optimista',
  commercialModelComparator: 'Comparador de modelos comerciales',
  historicalComparison: 'Comparación entre lo estimado y lo real',
  multiOrganization: 'Varias empresas en la misma cuenta',
});

/** Funciones activas para mostrar al usuario: [{ key, label }]. */
export function activeBusinessFeatures(features = FEATURES) {
  return Object.entries(BUSINESS_FEATURE_LABELS)
    .filter(([key]) => features && features[key] === true)
    .map(([key, label]) => ({ key, label }));
}

const SAVE_TEXTS = Object.freeze({
  idle: 'Se guarda automáticamente',
  pending: 'Guardando…',
  saving: 'Guardando…',
  saved: 'Guardado',
  invalid: 'Revisá los campos marcados',
  error: 'Error al guardar',
  readonly: 'Sólo lectura',
});

const RECOVERY_REASONS = Object.freeze({
  corrupt: 'Datos dañados al iniciar',
  invalid: 'Datos con estructura inesperada',
  'before-import': 'Antes de importar un backup',
  'before-demo-reset': 'Antes de restaurar los datos de ejemplo',
});

// --------------------------------------------------------- parseo de listas

function splitList(text) {
  return String(text ?? '')
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "5, 8, 10" → [5, 8, 10]. Enteros 1–31, sin repetidos, ordenados. */
export function parseMatrixDays(text) {
  const parts = splitList(text);
  if (parts.length === 0) return { ok: false, error: 'Ingresá al menos un día (ej.: 5, 8, 10, 15, 20).' };
  if (parts.length > MAX_MATRIX_DAYS) return { ok: false, error: `Máximo ${MAX_MATRIX_DAYS} valores.` };
  const values = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { ok: false, error: `"${p}" no es un número entero de días.` };
    const n = Number(p);
    if (n < 1 || n > 31) return { ok: false, error: 'Cada valor debe ser un entero entre 1 y 31 días.' };
    values.push(n);
  }
  return { ok: true, value: [...new Set(values)].sort((a, b) => a - b) };
}

/** "5, 10, 15" → [5, 10, 15]. Márgenes mayores a 0 y menores a 100 (decimales con punto). */
export function parseMarginLadder(text) {
  const parts = splitList(text);
  if (parts.length === 0) return { ok: false, error: 'Ingresá al menos un margen (ej.: 5, 10, 15).' };
  if (parts.length > MAX_LADDER_STEPS) return { ok: false, error: `Máximo ${MAX_LADDER_STEPS} márgenes.` };
  const values = [];
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return { ok: false, error: `"${p}" no es un porcentaje válido (decimales con punto, ej.: 7.5).` };
    const n = Number(p);
    if (!(n > 0 && n < 100)) return { ok: false, error: 'Cada margen debe ser mayor a 0 y menor a 100 %.' };
    values.push(n);
  }
  return { ok: true, value: [...new Set(values)].sort((a, b) => a - b) };
}

/**
 * Campo de texto para listas con validación propia. Como numberField: si al
 * salir del campo el texto es inválido, se restaura el último valor válido.
 * Devuelve `{ el, input, isValid }`.
 */
function listField({ label, value, hint, parse, onValid, illustrative = false }) {
  const id = uniqueId('lst');
  const input = h('input', { id, type: 'text', value, maxlength: '80', autocomplete: 'off', 'aria-describedby': `${id}-hint ${id}-error` });
  const error = h('div', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: true });
  let lastValidText = input.value;
  const showError = (message) => {
    input.setAttribute('aria-invalid', 'true');
    error.textContent = message;
    error.hidden = false;
  };
  input.addEventListener('input', () => {
    const r = parse(input.value);
    if (!r.ok) {
      showError(r.error);
      return;
    }
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    error.hidden = true;
    lastValidText = input.value;
    onValid(r.value);
  });
  input.addEventListener('change', () => {
    const r = parse(input.value);
    if (r.ok) return;
    input.value = lastValidText;
    const restored = parse(lastValidText);
    if (restored.ok) onValid(restored.value);
    showError(`${r.error} Se restauró el valor anterior.`);
  });
  const el = h(
    'div',
    { class: ['field', illustrative ? 'field-illustrative' : null] },
    h('label', { class: 'field-label', for: id }, label, illustrative ? illustrativeTag() : null),
    h('div', { class: 'field-control' }, input),
    h('div', { class: 'field-hint', id: `${id}-hint` }, hint),
    error,
  );
  return { el, input, isValid: () => parse(input.value).ok };
}

// ------------------------------------------------------ guardado automático

/** Indicador de guardado ("Guardando… / Guardado / Revisá los campos marcados"). */
function saveChip({ ephemeral = false } = {}) {
  const text = h('span', { class: 'save-chip-text' });
  const el = h('span', { class: 'save-chip', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'save-chip-dot', 'aria-hidden': 'true' }), text);
  const set = (status) => {
    el.dataset.status = status;
    text.textContent = status === 'saved' && ephemeral ? 'Sólo en esta sesión (no se guarda)' : SAVE_TEXTS[status] || '';
  };
  set('idle');
  return { el, set };
}

/**
 * Guardado automático con debounce. Sólo guarda si `isValid()`; si no,
 * muestra "Revisá los campos marcados". Nunca navega.
 */
function createAutosave({ chip, isValid, save, onError, readOnly = false, delay = SETTINGS_AUTOSAVE_DELAY_MS }) {
  let timer = null;
  let inFlight = null;
  let again = false;
  let disposed = false;

  async function run() {
    timer = null;
    if (disposed || readOnly) return;
    if (inFlight) {
      again = true;
      await inFlight;
      return;
    }
    if (!isValid()) {
      chip.set('invalid');
      return;
    }
    chip.set('saving');
    inFlight = (async () => {
      try {
        await save();
        if (timer === null && !again) chip.set('saved');
      } catch (error) {
        chip.set('error');
        onError(error);
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (again && !disposed) {
      again = false;
      await run();
    }
  }

  if (readOnly) chip.set('readonly');

  return {
    /** Programa un guardado (o marca el formulario como inválido). */
    schedule() {
      if (disposed || readOnly) return;
      clearTimeout(timer);
      timer = null;
      if (!isValid()) {
        chip.set('invalid');
        return;
      }
      chip.set('pending');
      timer = setTimeout(run, delay);
    },
    /** Guarda ya lo pendiente (al salir de la pantalla o antes de importar). */
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        return run();
      }
      return inFlight ? inFlight.then(() => undefined) : Promise.resolve();
    },
    /** Deja de guardar (después de reemplazar los datos: importar o restaurar la demo). */
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}

function kvList(entries) {
  return h('dl', { class: 'kv-list' }, ...entries.filter(Boolean).map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function recoveryLabel(key) {
  const rest = key.replace(/^rateos\.recovery\./, '');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.(.+)$/.exec(rest);
  if (!match) return { date: EMPTY, reason: rest };
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const reasonKey = match[6];
  const reason = RECOVERY_REASONS[reasonKey] || (/^pre-migration-v\d+$/.test(reasonKey) ? 'Antes de actualizar el formato de datos' : reasonKey);
  return { date: formatDateTime(iso), reason };
}

function recoveryFilename(key) {
  return `${key.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.json`;
}

// -------------------------------------------------------------------- vista

/** Pestañas de Configuración (#/configuracion/:tab). */
export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'empresa', label: 'Empresa' },
  { id: 'parametros', label: 'Parámetros económicos' },
  { id: 'convenios', label: 'Convenios' },
  { id: 'datos', label: 'Datos y backup' },
  { id: 'acerca', label: 'Acerca de' },
]);

/** Tipo de empresa (mismos ids que la bienvenida). */
const INDUSTRIES = Object.freeze([
  { value: 'oil_gas_services', label: 'Servicios petroleros' },
  { value: 'industrial_maintenance', label: 'Mantenimiento industrial' },
  { value: 'transport', label: 'Transporte' },
  { value: 'construction', label: 'Construcción' },
  { value: 'other', label: 'Otra' },
]);

function sectionTabs(active) {
  return h(
    'nav',
    { class: 'tabs settings-tabs', 'aria-label': 'Secciones de Configuración' },
    ...SETTINGS_SECTIONS.map((s) => h('a', { href: `#/configuracion/${s.id}`, 'aria-current': s.id === active ? 'page' : null }, s.label)),
  );
}

export async function render(root, app, params = {}) {
  const { ctx } = app;
  const section = SETTINGS_SECTIONS.some((s) => s.id === params.tab) ? params.tab : 'empresa';
  app.setHeader({ title: 'Configuración', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });

  const readOnly = Boolean(ctx.init && ctx.init.readOnly);
  const ephemeral = ctx.persistent === false;
  const lockInputs = (container) => {
    if (!readOnly) return;
    container.querySelectorAll('input, select, textarea').forEach((el) => {
      el.disabled = true;
    });
  };

  const savers = [];
  /** Guarda lo pendiente de la pestaña (empresa o parámetros). */
  const flushAll = () => Promise.all(savers.map((saver) => saver.flush()));
  /** Después de reemplazar los datos, lo que quedó en pantalla no se guarda. */
  const disposeAll = () => savers.forEach((saver) => saver.dispose());

  const panel = h('div', { class: 'settings-panel' });
  mount(root, sectionTabs(section), panel);

  // ------------------------------------------------------- empresa

  async function buildCompany() {
    const org = await ctx.settings.getOrganization();
    const knownIndustry = INDUSTRIES.some((i) => i.value === org.industry) ? org.industry : null;
    const orgDraft = { name: org.name || '', baseLocation: org.baseLocation || '', industry: knownIndustry, illustrative: org.illustrative === true };
    let industryTouched = false;
    let lastValidOrgName = sanitizeText(orgDraft.name, 120);
    const orgChip = saveChip({ ephemeral });
    const orgSaver = createAutosave({
      chip: orgChip,
      readOnly,
      isValid: () => sanitizeText(orgDraft.name, 120) !== '',
      save: async () => {
        const patch = {
          name: sanitizeText(orgDraft.name, 120),
          baseLocation: sanitizeText(orgDraft.baseLocation, 120),
          illustrative: Boolean(orgDraft.illustrative),
        };
        // El tipo de empresa sólo se escribe si se cambió acá (no se pisa un valor desconocido).
        if (industryTouched) patch.industry = orgDraft.industry;
        await ctx.settings.saveOrganization(patch);
        // Nombre de la empresa en el menú y aviso de datos de ejemplo.
        await app.refreshChrome();
        guide.hidden = !orgDraft.illustrative;
      },
      onError: (error) => app.toast(userErrorMessage(error, 'No se pudo guardar la empresa.'), 'danger'),
    });
    savers.push(orgSaver);

    const nameField = textField({ label: 'Nombre de la empresa', value: orgDraft.name, required: true, maxLength: 120, onChange: (v) => { orgDraft.name = v; } });
    const nameInput = nameField.querySelector('input');
    const nameError = nameField.querySelector('.field-error');
    const setNameError = (message) => {
      if (!nameInput || !nameError) return;
      if (message) {
        nameInput.setAttribute('aria-invalid', 'true');
        nameError.textContent = message;
        nameError.hidden = false;
      } else {
        nameInput.removeAttribute('aria-invalid');
        nameError.textContent = '';
        nameError.hidden = true;
      }
    };
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        const name = sanitizeText(orgDraft.name, 120);
        setNameError(name ? null : 'Ingresá el nombre de la empresa.');
        if (name) lastValidOrgName = name;
      });
      // Al salir del campo vacío se restaura el último nombre válido.
      nameInput.addEventListener('change', () => {
        if (sanitizeText(orgDraft.name, 120) !== '' || !lastValidOrgName) return;
        nameInput.value = lastValidOrgName;
        orgDraft.name = lastValidOrgName;
        setNameError('El nombre es obligatorio. Se restauró el nombre anterior.');
      });
    }

    const orgForm = h(
      'div',
      { class: 'stack' },
      formGrid(
        3,
        nameField,
        textField({
          label: 'Base operativa',
          value: orgDraft.baseLocation,
          maxLength: 120,
          placeholder: 'Ej.: Neuquén Capital',
          hint: 'Origen por defecto para calcular viajes y logística.',
          onChange: (v) => { orgDraft.baseLocation = v; },
        }),
        selectField({
          label: 'Tipo de empresa',
          value: orgDraft.industry ?? '',
          options: INDUSTRIES,
          includeEmpty: true,
          emptyLabel: 'Sin definir',
          onChange: (v) => {
            orgDraft.industry = v;
            industryTouched = true;
          },
        }),
      ),
      checkboxField({
        label: 'Son datos de ejemplo (mostrar el aviso de valores ILUSTRATIVOS)',
        checked: orgDraft.illustrative,
        hint: 'Desmarcalo cuando cargues los datos reales de tu empresa.',
        onChange: (v) => { orgDraft.illustrative = v; },
      }),
    );
    // Cualquier cambio (texto, selector o casilla) programa el guardado automático.
    orgForm.addEventListener('input', () => orgSaver.schedule());
    orgForm.addEventListener('change', () => orgSaver.schedule());
    lockInputs(orgForm);

    const orgCard = card(
      { title: 'Tu empresa', subtitle: 'Se muestra en el menú y se guarda en los backups. Los cambios se guardan solos.', actions: [orgChip.el], className: 'autosave-card' },
      orgForm,
    );

    const guide = card(
      { title: 'Cómo pasar a tus datos', subtitle: 'Estás usando una empresa de ejemplo.', className: 'guide-card' },
      banner('Los datos de ejemplo son de una empresa ficticia. Todos los valores son ILUSTRATIVOS: no son escalas salariales, cargas, alícuotas, precios ni costos reales. Reemplazalos por valores propios vigentes antes de cotizar.', 'warning', { title: 'Datos ilustrativos.' }),
      h(
        'ol',
        { class: 'guide-steps' },
        h('li', {}, h('strong', {}, 'Tu empresa. '), 'Cargá el nombre, la base operativa y el tipo de empresa (arriba).'),
        h('li', {}, h('strong', {}, 'Tus parámetros. '), 'Combustible, tasa financiera, margen objetivo e imprevistos vigentes en ', h('a', { href: '#/configuracion/parametros' }, 'Parámetros económicos'), '.'),
        h('li', {}, h('strong', {}, 'Tu convenio. '), 'Horas, SAC, vacaciones, cargas y ART en ', h('a', { href: '#/configuracion/convenios' }, 'Convenios'), '.'),
        h('li', {}, h('strong', {}, 'Tus recursos. '), 'Personal, equipos, materiales y ubicaciones en ', h('a', { href: '#/recursos/personal' }, 'Recursos'), '.'),
        h('li', {}, h('strong', {}, 'Listo. '), 'Desmarcá "Son datos de ejemplo" y empezá a cotizar.'),
      ),
    );
    guide.hidden = !orgDraft.illustrative;

    mount(panel, h('div', { class: 'stack' }, orgCard, guide));
  }

  // ---------------------------------------------- parámetros económicos

  async function buildParams() {
    const settings = await app.getSettings();
    const params = {
      fuelPricePerLiter: settings.fuelPricePerLiter,
      financeMonthlyRatePct: settings.financeMonthlyRatePct,
      defaultTargetMarginPct: settings.defaultTargetMarginPct,
      defaultContingencyPct: settings.defaultContingencyPct,
      defaultPaymentTermDays: settings.defaultPaymentTermDays,
      roundingStep: settings.roundingStep,
      matrixDays: Array.isArray(settings.matrixDays) && settings.matrixDays.length ? [...settings.matrixDays] : [...DEFAULT_MATRIX_DAYS],
      marginLadder: Array.isArray(settings.marginLadder) && settings.marginLadder.length ? [...settings.marginLadder] : [...DEFAULT_MARGIN_LADDER],
      ownValues: settings.illustrative !== true,
    };
    const REQUIRED_PARAMS = ['fuelPricePerLiter', 'financeMonthlyRatePct', 'defaultTargetMarginPct', 'defaultContingencyPct', 'defaultPaymentTermDays', 'roundingStep'];

    // Los campos se crean con la etiqueta ILUSTRATIVO y se muestra u oculta
    // según lo guardado (sin volver a dibujar la pantalla).
    const numericInputs = [];
    const num = (key, label, rule, unit, hint) => {
      const field = numberField({ label, value: isFiniteNumber(params[key]) ? params[key] : null, rule, unit, hint, required: true, illustrative: true, onChange: (v) => { params[key] = v; } });
      const input = field.querySelector('input');
      if (input) numericInputs.push({ input, rule });
      return field;
    };
    const matrixField = listField({
      label: 'Días a comparar en "Tarifa según días trabajados"',
      value: params.matrixDays.join(', '),
      hint: 'Días activos por mes, separados por comas (enteros de 1 a 31). Es la matriz tarifa × utilización del resultado.',
      parse: parseMatrixDays,
      onValid: (v) => { params.matrixDays = v; },
      illustrative: true,
    });
    const ladderField = listField({
      label: 'Márgenes a comparar',
      value: params.marginLadder.join(', '),
      hint: 'Márgenes sobre el precio (no markup), separados por comas. Decimales con punto, ej.: 7.5.',
      parse: parseMarginLadder,
      onValid: (v) => { params.marginLadder = v; },
      illustrative: true,
    });

    const paramsFields = h(
      'div',
      { class: 'stack params-groups' },
      h(
        'section',
        { class: 'params-group', 'aria-labelledby': 'params-costs' },
        h('h3', { class: 'params-group-title', id: 'params-costs' }, 'Costos y cobro'),
        formGrid(
          2,
          num('fuelPricePerLiter', 'Precio del combustible', 'money', '$/L', 'Se usa en equipos, vehículos y logística.'),
          num('defaultPaymentTermDays', 'Plazo de pago del cliente', 'paymentDays', 'días', '¿A cuántos días te pagan normalmente?'),
          num('financeMonthlyRatePct', 'Tasa financiera mensual', 'percent', '%', 'Lo que te cuesta la plata que adelantás hasta cobrar (capital de trabajo).'),
          num('defaultContingencyPct', 'Imprevistos (contingencia)', 'percent', '%', 'Colchón sobre el costo para lo que no se puede prever.'),
        ),
      ),
      h(
        'section',
        { class: 'params-group', 'aria-labelledby': 'params-price' },
        h('h3', { class: 'params-group-title', id: 'params-price' }, 'Precio y resultado'),
        formGrid(
          2,
          num('defaultTargetMarginPct', 'Margen objetivo', 'margin', '%', 'Sobre el precio de venta (no es markup).'),
          num('roundingStep', 'Redondeo de tarifas', 'money', '$', 'Las tarifas sugeridas se redondean hacia arriba a este múltiplo. 0 = sin redondeo.'),
          matrixField.el,
          ladderField.el,
        ),
      ),
    );

    /** Válido = todos los parámetros cargados y el texto de cada campo pasa su regla. */
    const paramsValid = () =>
      REQUIRED_PARAMS.every((k) => isFiniteNumber(params[k])) &&
      numericInputs.every(({ input, rule }) => validateNumber(input.value, rule, { required: true }).ok) &&
      matrixField.isValid() &&
      ladderField.isValid();

    const paramsBanner = banner('Estos parámetros son ILUSTRATIVOS. Cargá los valores vigentes de tu empresa y marcá la casilla de abajo.', 'warning');
    const applyIllustrative = (on) => {
      paramsBanner.hidden = !on;
      paramsFields.querySelectorAll('.tag-illustrative').forEach((tag) => {
        tag.hidden = !on;
      });
      paramsFields.querySelectorAll('.field').forEach((field) => field.classList.toggle('field-illustrative', on));
    };
    applyIllustrative(!params.ownValues);

    const paramsChip = saveChip({ ephemeral });
    const paramsSaver = createAutosave({
      chip: paramsChip,
      readOnly,
      isValid: paramsValid,
      save: async () => {
        const { ownValues, ...rest } = params;
        const snapshot = { ...rest, matrixDays: [...rest.matrixDays], marginLadder: [...rest.marginLadder], illustrative: !ownValues };
        await ctx.settings.save(snapshot);
        applyIllustrative(snapshot.illustrative);
      },
      onError: (error) => app.toast(userErrorMessage(error, 'No se pudieron guardar los parámetros.'), 'danger'),
    });
    savers.push(paramsSaver);

    const paramsForm = h(
      'div',
      { class: 'stack' },
      paramsBanner,
      paramsFields,
      checkboxField({
        label: 'Son valores propios y vigentes (quitar la marca ILUSTRATIVO)',
        checked: params.ownValues,
        onChange: (v) => { params.ownValues = v; },
      }),
    );
    paramsForm.addEventListener('input', () => paramsSaver.schedule());
    paramsForm.addEventListener('change', () => paramsSaver.schedule());
    lockInputs(paramsForm);

    mount(
      panel,
      card(
        {
          title: 'Parámetros económicos',
          subtitle: 'Punto de partida de cada cotización nueva (las existentes conservan sus valores). Los días y márgenes a comparar se aplican a todos los resultados. Se guardan solos cuando todos los campos son válidos.',
          actions: [paramsChip.el],
          className: 'autosave-card',
        },
        paramsForm,
      ),
    );
  }

  // -------------------------------------------------------- convenios

  async function buildAgreements() {
    const host = h('div', { class: 'stack' });
    mount(panel, host);
    await renderAgreements(host, app);
  }

  // --------------------------------------------------- datos y backup

  async function buildData() {
    const recoveryKeys = await Promise.resolve(ctx.backup.listRecoverySnapshots());
    const importHost = h('div', { class: 'import-result', 'aria-live': 'polite' });
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-label': 'Elegir archivo de backup JSON' });

    const exportBtn = button('Exportar backup', { variant: 'primary', icon: 'download' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        // El backup incluye lo último que se cargó en esta pantalla.
        await flushAll();
        const { filename, json } = await ctx.backup.exportBackup();
        downloadText(filename, json);
        app.toast(`Backup descargado: ${filename}`, 'success');
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudo exportar el backup.'), 'danger');
      } finally {
        exportBtn.disabled = false;
      }
    });

    const importBtn = button('Importar backup', { variant: 'secondary', icon: 'upload', disabled: readOnly, onClick: () => fileInput.click() });

    function showImportErrors(errors) {
      mount(
        importHost,
        h(
          'div',
          { class: 'banner banner-danger', role: 'alert' },
          h('div', {}, h('strong', {}, 'No se puede importar este archivo. '), 'Tus datos actuales no se modificaron.', h('ul', { class: 'error-list' }, ...errors.slice(0, 10).map((e) => h('li', {}, e)))),
        ),
      );
    }

    function showImportSummary(parsed, fileName) {
      const s = parsed.summary || {};
      const r = s.resources || {};
      const n = (v) => formatNumber(isFiniteNumber(v) ? v : 0);
      const count = (v) => (isFiniteNumber(v) && v > 0 ? v : 0);
      const resourcesTotal = ['laborProfiles', 'agreements', 'equipment', 'materials', 'locations'].reduce((acc, k) => acc + count(r[k]), 0);
      // Un backup sin cotizaciones ni recursos deja la empresa vacía: puede ser otro archivo .json.
      const looksEmpty = count(s.quotes) === 0 && resourcesTotal === 0;
      const emptyWarning = 'Este backup no tiene cotizaciones ni recursos. Si lo importás, tus datos actuales se reemplazan por una empresa vacía. Revisá que sea el archivo correcto.';
      const applyBtn = button('Reemplazar mis datos con este backup', { variant: 'danger', icon: 'upload' });
      applyBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Importar backup',
          message: looksEmpty
            ? `Atención: ${emptyWarning} Esto REEMPLAZA todos tus datos actuales. Antes se guarda una copia de recuperación.`
            : 'Esto REEMPLAZA todos tus datos actuales. Antes se guarda una copia de recuperación.',
          confirmLabel: 'Reemplazar mis datos',
          danger: true,
        });
        if (!ok) return;
        applyBtn.disabled = true;
        try {
          // Lo pendiente se guarda antes: así queda en la copia de recuperación.
          await flushAll();
          const result = await ctx.backup.applyBackup(parsed.data);
          disposeAll();
          app.toast(`Backup importado (${n(result.quotes)} cotizaciones). Se guardó una copia de recuperación de los datos anteriores.`, 'success');
          await app.refreshChrome();
          app.navigate('#/inicio');
        } catch (error) {
          app.toast(userErrorMessage(error, 'No se pudo importar el backup.'), 'danger');
          applyBtn.disabled = false;
        }
      });
      const fromVersion = isFiniteNumber(parsed.fromVersion) ? parsed.fromVersion : null;
      mount(
        importHost,
        h(
          'div',
          { class: 'import-summary' },
          h('h4', {}, 'Resumen del backup'),
          looksEmpty ? banner(emptyWarning, 'danger', { title: 'Backup sin datos.' }) : null,
          kvList([
            ['Archivo', fileName],
            ['Empresa', s.organization || EMPTY],
            ['Cotizaciones', n(s.quotes)],
            ['Plantillas de servicio', n(s.services)],
            ['Recursos', `${n(r.laborProfiles)} perfiles de personal · ${n(r.agreements)} convenios · ${n(r.equipment)} equipos · ${n(r.materials)} materiales · ${n(r.locations)} ubicaciones`],
            ['Fecha de exportación', s.exportedAt ? formatDateTime(s.exportedAt) : EMPTY],
            ['Versión de RATEOS', s.appVersion || EMPTY],
            fromVersion !== null ? ['Formato de datos', fromVersion < SCHEMA_VERSION ? `v${fromVersion} (se actualiza a v${SCHEMA_VERSION} al importar)` : `v${fromVersion}`] : null,
          ]),
          banner('Importar REEMPLAZA todos tus datos actuales. Antes se guarda una copia de recuperación.', 'warning'),
          h('div', { class: 'row' }, applyBtn, button('Cancelar', { variant: 'ghost', onClick: () => mount(importHost) })),
        ),
      );
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      if (file.size > MAX_BACKUP_BYTES) {
        showImportErrors(['El archivo supera el tamaño máximo permitido (5 MB).']);
        return;
      }
      let text;
      try {
        text = await readFileAsText(file);
      } catch {
        showImportErrors(['No se pudo leer el archivo.']);
        return;
      }
      const parsed = ctx.backup.parseBackupText(text);
      if (!parsed.ok) showImportErrors(Array.isArray(parsed.errors) && parsed.errors.length ? parsed.errors : ['El archivo no es un backup válido de RATEOS.']);
      else showImportSummary(parsed, sanitizeText(file.name, 120));
    });

    const backupCard = card(
      { title: 'Backup', subtitle: 'Tus datos viven sólo en este navegador. Exportá un backup seguido y guardalo en un lugar seguro.' },
      h(
        'div',
        { class: 'stack' },
        ephemeral ? banner('Este navegador no permite guardar datos: exportá un backup antes de cerrar.', 'warning') : null,
        readOnly ? banner('Modo sólo lectura: podés exportar un backup, pero no importar ni restaurar datos en esta versión de RATEOS.', 'info') : null,
        h('div', { class: 'row' }, exportBtn, importBtn, fileInput),
        h('p', { class: 'muted small' }, 'El backup es un archivo JSON versionado con tu empresa, recursos, plantillas, cotizaciones y configuración. Antes de importar se muestra un resumen y se pide confirmación.'),
        importHost,
      ),
    );

    // ----------------------------------------------------- restaurar demo

    const resetBtn = button('Restaurar datos de ejemplo', { variant: 'danger', icon: 'upload', disabled: readOnly });
    resetBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Restaurar datos de ejemplo',
        message: 'Esto REEMPLAZA todos tus datos actuales por los datos de ejemplo ILUSTRATIVOS. Antes se guarda una copia de recuperación.',
        confirmLabel: 'Restaurar datos de ejemplo',
        danger: true,
      });
      if (!ok) return;
      resetBtn.disabled = true;
      try {
        await flushAll();
        await ctx.backup.resetToDemo();
        disposeAll();
        app.toast('Se restauraron los datos de ejemplo. Tus datos anteriores quedaron en una copia de recuperación.', 'success');
        await app.refreshChrome();
        app.navigate('#/inicio');
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudieron restaurar los datos de ejemplo.'), 'danger');
        resetBtn.disabled = false;
      }
    });
    const demoCard = card(
      { title: 'Datos de ejemplo', subtitle: 'Empresa ficticia con la cotización "Hidrogrúa on-call — Añelo" y el caso de referencia del break-even.' },
      h('p', { class: 'small' }, 'Útil para explorar RATEOS o volver a empezar. Todos los valores de ejemplo son ILUSTRATIVOS.'),
      resetBtn,
    );

    // --------------------------------------------- copias de recuperación

    const downloadRecovery = async (key) => {
      try {
        const raw = await Promise.resolve(ctx.backup.getRecoverySnapshot(key));
        if (typeof raw !== 'string') {
          app.toast('La copia ya no está disponible.', 'warning');
          return;
        }
        downloadText(recoveryFilename(key), raw);
        app.toast('Copia descargada.', 'success');
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudo descargar la copia.'), 'danger');
      }
    };
    const recoveryHost = h('div', { class: 'recovery-host' });
    const deleteRecovery = async (key, info) => {
      const ok = await confirmDialog({
        title: 'Eliminar copia de recuperación',
        message: `Se eliminará la copia "${info.reason}" del ${info.date}. Tus datos actuales no se modifican. Si querés conservarla, descargala antes.`,
        confirmLabel: 'Eliminar copia',
        danger: true,
      });
      if (!ok) return;
      try {
        const removed = await Promise.resolve(ctx.backup.deleteRecoverySnapshot(key));
        app.toast(removed ? 'Copia eliminada. Se liberó espacio en el navegador.' : 'La copia ya no existía.', removed ? 'success' : 'info');
        renderRecoveryList(await Promise.resolve(ctx.backup.listRecoverySnapshots()));
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudo eliminar la copia.'), 'danger');
      }
    };
    function renderRecoveryList(keys) {
      const list = Array.isArray(keys) ? keys : [];
      mount(
        recoveryHost,
        list.length
          ? h(
              'ul',
              { class: 'recovery-list' },
              ...list.map((key) => {
                const info = recoveryLabel(key);
                return h(
                  'li',
                  {},
                  h('div', { class: 'cell-main' }, h('span', { class: 'cell-title' }, info.reason), h('span', { class: 'cell-sub mono' }, `${info.date} · ${key}`)),
                  h(
                    'div',
                    { class: 'row' },
                    button('Descargar', { variant: 'secondary', size: 'sm', icon: 'download', onClick: () => downloadRecovery(key), attrs: { 'aria-label': `Descargar copia ${info.reason} ${info.date}` } }),
                    button('Eliminar', { variant: 'danger', size: 'sm', icon: 'trash', disabled: readOnly, onClick: () => deleteRecovery(key, info), attrs: { 'aria-label': `Eliminar copia ${info.reason} ${info.date}`, 'data-edit': 'true' } }),
                  ),
                );
              }),
            )
          : h('p', { class: 'muted small' }, 'Todavía no hay copias de recuperación.'),
      );
    }
    renderRecoveryList(recoveryKeys);
    const recoveryCard = card(
      { title: 'Copias de recuperación', subtitle: 'RATEOS guarda una copia automática antes de importar, restaurar los datos de ejemplo o actualizar el formato de datos. Se conservan las más recientes.' },
      recoveryHost,
      h('p', { class: 'footnote' }, 'Una copia descargada se puede importar desde "Importar backup". Las copias ocupan espacio del navegador: si se llena, eliminá las que ya no necesites.'),
    );

    mount(panel, h('div', { class: 'settings-grid' }, backupCard, h('div', { class: 'stack' }, demoCard, recoveryCard)));
  }

  // ----------------------------------------------------------- acerca de

  function buildAbout() {
    const v = app.version || {};
    const features = activeBusinessFeatures();
    const storageText = STORAGE_MODE === 'local'
      ? ephemeral
        ? 'memoria — este navegador no permite guardar: los datos se pierden al cerrar'
        : 'local — datos sólo en este navegador'
      : STORAGE_MODE;
    const aboutCard = card(
      { title: 'Acerca de', className: 'about-card' },
      h('p', { class: 'about-version mono' }, `${APP_NAME} · v${v.version || 'dev'} · build ${v.commit || 'local'}`),
      kvList([
        ['Fecha de build', v.buildDate ? formatDateTime(v.buildDate) : 'Sin fecha (versión local)'],
        v.ref ? ['Referencia', v.ref] : null,
        ['Esquema de datos', `v${SCHEMA_VERSION}`],
        ['Almacenamiento', storageText],
        [
          'Funciones activas',
          h('div', { class: 'flag-list' }, ...(features.length ? features.map((f) => badge(f.label, 'green')) : [h('span', { class: 'muted' }, 'Las funciones básicas de cotización')])),
        ],
      ]),
      banner('RATEOS no tiene backend, no usa analytics ni IA. Todo se calcula en tu navegador y tus datos no salen de este dispositivo, salvo que exportes un backup.', 'info', { title: 'Privacidad.' }),
    );
    mount(panel, h('div', { class: 'view-narrow' }, aboutCard));
  }

  const builders = { empresa: buildCompany, parametros: buildParams, convenios: buildAgreements, datos: buildData, acerca: buildAbout };
  await builders[section]();

  // Si se cierra o se oculta la pestaña, se guarda lo pendiente.
  const onPageHide = () => {
    flushAll();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushAll();
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);

  // Al salir de la pantalla se fuerza el guardado pendiente (sin navegar).
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    flushAll();
  };
}
