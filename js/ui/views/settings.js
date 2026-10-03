/**
 * Configuración: organización, parámetros por defecto, backup
 * (exportar / importar JSON), restaurar demo, copias de recuperación y
 * "Acerca de" (versión, build, esquema, almacenamiento, privacidad, flags).
 */

import { h, mount, uniqueId, downloadText, readFileAsText } from '../dom.js';
import { badge, banner, button, card, checkboxField, confirmDialog, formGrid, numberField, textField } from '../components.js';
import { APP_NAME, FEATURES, MAX_BACKUP_BYTES, SCHEMA_VERSION, STORAGE_MODE, DEFAULT_MATRIX_DAYS, DEFAULT_MARGIN_LADDER } from '../../config.js';
import { formatDateTime, formatNumber, EMPTY } from '../../core/format.js';
import { isFiniteNumber } from '../../core/money.js';
import { sanitizeText } from '../../core/validation.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';

const MAX_MATRIX_DAYS = 12;
const MAX_LADDER_STEPS = 6;

const FEATURE_LABELS = Object.freeze({
  historicalComparison: 'Estimado vs real',
  supabase: 'Supabase (futuro)',
  multiOrganization: 'Multiempresa',
  analytics: 'Analytics',
  commercialModelComparator: 'Comparador de modelos comerciales',
  scenarios: 'Escenarios',
});

const RECOVERY_REASONS = Object.freeze({
  corrupt: 'Datos dañados al iniciar',
  invalid: 'Datos con estructura inesperada',
  'before-import': 'Antes de importar un backup',
  'before-demo-reset': 'Antes de restaurar la demo',
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

/** Campo de texto para listas con validación propia. */
function listField({ label, value, hint, parse, onValid, illustrative = false }) {
  const id = uniqueId('lst');
  const input = h('input', { id, type: 'text', value, maxlength: '80', autocomplete: 'off', 'aria-describedby': `${id}-hint ${id}-error` });
  const error = h('div', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: true });
  input.addEventListener('input', () => {
    const r = parse(input.value);
    if (!r.ok) {
      input.setAttribute('aria-invalid', 'true');
      error.textContent = r.error;
      error.hidden = false;
      return;
    }
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    error.hidden = true;
    onValid(r.value);
  });
  return h(
    'div',
    { class: ['field', illustrative ? 'field-illustrative' : null] },
    h('label', { class: 'field-label', for: id }, label, illustrative ? illustrativeTag() : null),
    h('div', { class: 'field-control' }, input),
    h('div', { class: 'field-hint', id: `${id}-hint` }, hint),
    error,
  );
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

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Configuración', breadcrumbs: [{ label: 'Inicio', href: '#/' }] });

  const [org, settings] = await Promise.all([ctx.settings.getOrganization(), app.getSettings()]);
  const recoveryKeys = await Promise.resolve(ctx.backup.listRecoverySnapshots());

  // ------------------------------------------------------- organización

  const orgDraft = { name: org.name || '', baseLocation: org.baseLocation || '', illustrative: org.illustrative === true };
  const orgSave = button('Guardar organización', { variant: 'primary', icon: 'check' });
  orgSave.addEventListener('click', async () => {
    const name = sanitizeText(orgDraft.name, 120);
    if (!name) {
      app.toast('Ingresá el nombre de la empresa.', 'warning');
      return;
    }
    orgSave.disabled = true;
    try {
      await ctx.settings.saveOrganization({ name, baseLocation: sanitizeText(orgDraft.baseLocation, 120), illustrative: Boolean(orgDraft.illustrative) });
      app.toast('Organización guardada.', 'success');
      await app.refreshChrome();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo guardar la organización.'), 'danger');
    } finally {
      orgSave.disabled = false;
    }
  });
  const orgCard = card(
    { title: 'Organización', subtitle: 'Se muestra en el menú y se guarda en los backups.' },
    h(
      'div',
      { class: 'stack' },
      formGrid(
        2,
        textField({ label: 'Nombre de la empresa', value: orgDraft.name, required: true, maxLength: 120, onChange: (v) => { orgDraft.name = v; } }),
        textField({ label: 'Base operativa', value: orgDraft.baseLocation, maxLength: 120, placeholder: 'Ej.: Neuquén Capital', onChange: (v) => { orgDraft.baseLocation = v; } }),
      ),
      checkboxField({
        label: 'Son datos de demostración (mostrar aviso de valores ILUSTRATIVOS)',
        checked: orgDraft.illustrative,
        hint: 'Desmarcalo cuando cargues los datos reales de tu empresa.',
        onChange: (v) => { orgDraft.illustrative = v; },
      }),
      h('div', { class: 'row' }, orgSave),
    ),
  );

  // ------------------------------------------------- parámetros por defecto

  const illustrative = settings.illustrative === true;
  const params = {
    fuelPricePerLiter: settings.fuelPricePerLiter,
    financeMonthlyRatePct: settings.financeMonthlyRatePct,
    defaultTargetMarginPct: settings.defaultTargetMarginPct,
    defaultContingencyPct: settings.defaultContingencyPct,
    defaultPaymentTermDays: settings.defaultPaymentTermDays,
    roundingStep: settings.roundingStep,
    matrixDays: Array.isArray(settings.matrixDays) && settings.matrixDays.length ? [...settings.matrixDays] : [...DEFAULT_MATRIX_DAYS],
    marginLadder: Array.isArray(settings.marginLadder) && settings.marginLadder.length ? [...settings.marginLadder] : [...DEFAULT_MARGIN_LADDER],
    ownValues: !illustrative,
  };
  const num = (key, label, rule, unit, hint) =>
    numberField({ label, value: isFiniteNumber(params[key]) ? params[key] : null, rule, unit, hint, required: true, illustrative, onChange: (v) => { params[key] = v; } });

  const paramsGrid = formGrid(
    3,
    num('fuelPricePerLiter', 'Precio del combustible', 'money', '$/L', 'Se usa en equipos, vehículos y logística.'),
    num('financeMonthlyRatePct', 'Tasa financiera mensual', 'percent', '%', 'Costo de financiar el capital de trabajo hasta cobrar.'),
    num('defaultTargetMarginPct', 'Margen objetivo', 'margin', '%', 'Sobre precio de venta (no es markup).'),
    num('defaultContingencyPct', 'Contingencia', 'percent', '%', 'Colchón para imprevistos sobre el costo.'),
    num('defaultPaymentTermDays', 'Plazo de pago del cliente', 'paymentDays', 'días', '¿A cuántos días te pagan normalmente?'),
    num('roundingStep', 'Redondeo de tarifas', 'money', '$', 'Las tarifas sugeridas se redondean hacia arriba a este múltiplo. 0 = sin redondeo.'),
    listField({
      label: 'Días de la matriz tarifa × utilización',
      value: params.matrixDays.join(', '),
      hint: 'Días activos por mes, separados por comas (enteros de 1 a 31).',
      parse: parseMatrixDays,
      onValid: (v) => { params.matrixDays = v; },
      illustrative,
    }),
    listField({
      label: 'Escalera de márgenes',
      value: params.marginLadder.join(', '),
      hint: 'Márgenes sobre precio, separados por comas (decimales con punto, ej.: 7.5).',
      parse: parseMarginLadder,
      onValid: (v) => { params.marginLadder = v; },
      illustrative,
    }),
  );

  const paramsSave = button('Guardar parámetros', { variant: 'primary', icon: 'check' });
  paramsSave.addEventListener('click', async () => {
    if (paramsGrid.querySelector('[aria-invalid="true"]')) {
      app.toast('Revisá los campos marcados en rojo.', 'warning');
      return;
    }
    const required = ['fuelPricePerLiter', 'financeMonthlyRatePct', 'defaultTargetMarginPct', 'defaultContingencyPct', 'defaultPaymentTermDays', 'roundingStep'];
    if (required.some((k) => !isFiniteNumber(params[k]))) {
      app.toast('Completá todos los parámetros.', 'warning');
      return;
    }
    paramsSave.disabled = true;
    try {
      const { ownValues, ...rest } = params;
      await ctx.settings.save({ ...rest, illustrative: !ownValues });
      app.toast('Parámetros guardados.', 'success');
      app.navigate('#/configuracion');
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudieron guardar los parámetros.'), 'danger');
      paramsSave.disabled = false;
    }
  });

  const paramsCard = card(
    { title: 'Parámetros por defecto', subtitle: 'Punto de partida de cada cotización nueva (las existentes conservan sus valores). Los días de la matriz y la escalera de márgenes se aplican a todos los resultados.' },
    h(
      'div',
      { class: 'stack' },
      illustrative ? banner('Estos parámetros son ILUSTRATIVOS. Cargá los valores vigentes de tu empresa y marcá la casilla de abajo.', 'warning') : null,
      paramsGrid,
      checkboxField({
        label: 'Son valores propios y vigentes (quitar la marca ILUSTRATIVO)',
        checked: params.ownValues,
        onChange: (v) => { params.ownValues = v; },
      }),
      h('div', { class: 'row' }, paramsSave),
    ),
  );

  // ----------------------------------------------------------------- backup

  const importHost = h('div', { class: 'import-result', 'aria-live': 'polite' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-label': 'Elegir archivo de backup JSON' });

  const exportBtn = button('Exportar backup JSON', { variant: 'primary', icon: 'download' });
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const { filename, json } = await ctx.backup.exportBackup();
      downloadText(filename, json);
      app.toast(`Backup descargado: ${filename}`, 'success');
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo exportar el backup.'), 'danger');
    } finally {
      exportBtn.disabled = false;
    }
  });

  const importBtn = button('Importar backup JSON', { variant: 'secondary', icon: 'upload', onClick: () => fileInput.click() });

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
    const applyBtn = button('Reemplazar mis datos con este backup', { variant: 'danger', icon: 'upload' });
    applyBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Importar backup',
        message: 'Esto REEMPLAZA todos tus datos actuales. Antes se guarda una copia de recuperación.',
        confirmLabel: 'Reemplazar mis datos',
        danger: true,
      });
      if (!ok) return;
      applyBtn.disabled = true;
      try {
        const result = await ctx.backup.applyBackup(parsed.data);
        app.toast(`Backup importado (${n(result.quotes)} cotizaciones). Se guardó una copia de recuperación de los datos anteriores.`, 'success');
        await app.refreshChrome();
        app.navigate('#/');
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
        kvList([
          ['Archivo', fileName],
          ['Organización', s.organization || EMPTY],
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
      ctx.persistent === false ? banner('Este navegador no permite guardar datos: exportá un backup antes de cerrar.', 'warning') : null,
      h('div', { class: 'row' }, exportBtn, importBtn, fileInput),
      h('p', { class: 'muted small' }, 'El backup es un archivo JSON versionado con tu organización, recursos, plantillas, cotizaciones y configuración. Antes de importar se muestra un resumen y se pide confirmación.'),
      importHost,
    ),
  );

  // ----------------------------------------------------- restaurar demo

  const resetBtn = button('Restaurar datos demo', { variant: 'danger', icon: 'upload' });
  resetBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Restaurar datos demo',
      message: 'Esto REEMPLAZA todos tus datos actuales por los datos de demostración ILUSTRATIVOS. Antes se guarda una copia de recuperación.',
      confirmLabel: 'Restaurar demo',
      danger: true,
    });
    if (!ok) return;
    resetBtn.disabled = true;
    try {
      await ctx.backup.resetToDemo();
      app.toast('Se restauraron los datos demo. Tus datos anteriores quedaron en una copia de recuperación.', 'success');
      await app.refreshChrome();
      app.navigate('#/');
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudieron restaurar los datos demo.'), 'danger');
      resetBtn.disabled = false;
    }
  });
  const demoCard = card(
    { title: 'Datos demo', subtitle: 'Empresa ficticia con la cotización Hidrogrúa on-call — Añelo y el caso de referencia del break-even.' },
    h('p', { class: 'small' }, 'Útil para explorar RATEOS o volver a empezar. Todos los valores demo son ILUSTRATIVOS.'),
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
  const recoveryCard = card(
    { title: 'Copias de recuperación', subtitle: 'RATEOS guarda una copia automática antes de importar, restaurar la demo o actualizar el formato de datos. Se conservan las más recientes.' },
    recoveryKeys.length
      ? h(
          'ul',
          { class: 'recovery-list' },
          ...recoveryKeys.map((key) => {
            const info = recoveryLabel(key);
            return h(
              'li',
              {},
              h('div', { class: 'cell-main' }, h('span', { class: 'cell-title' }, info.reason), h('span', { class: 'cell-sub mono' }, `${info.date} · ${key}`)),
              button('Descargar', { variant: 'secondary', size: 'sm', icon: 'download', onClick: () => downloadRecovery(key), attrs: { 'aria-label': `Descargar copia ${info.reason} ${info.date}` } }),
            );
          }),
        )
      : h('p', { class: 'muted small' }, 'Todavía no hay copias de recuperación.'),
    h('p', { class: 'footnote' }, 'Una copia descargada se puede importar desde "Importar backup JSON".'),
  );

  // ----------------------------------------------------------- acerca de

  const v = app.version || {};
  const activeFlags = Object.entries(FEATURES).filter(([, on]) => on);
  const inactiveFlags = Object.entries(FEATURES).filter(([, on]) => !on);
  const storageText = STORAGE_MODE === 'local'
    ? ctx.persistent === false
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
        h('div', { class: 'flag-list' }, ...(activeFlags.length ? activeFlags.map(([k]) => badge(FEATURE_LABELS[k] || k, 'green', { title: k })) : [h('span', { class: 'muted' }, 'Ninguna')])),
      ],
      inactiveFlags.length ? ['Desactivadas', h('div', { class: 'flag-list' }, ...inactiveFlags.map(([k]) => badge(FEATURE_LABELS[k] || k, 'gray', { title: k })))] : null,
    ]),
    banner('RATEOS no tiene backend, no usa analytics ni IA. Todo se calcula en tu navegador y tus datos no salen de este dispositivo, salvo que exportes un backup.', 'info', { title: 'Privacidad.' }),
  );

  mount(
    root,
    h('div', { class: 'settings-grid' }, orgCard, aboutCard),
    paramsCard,
    h('div', { class: 'settings-grid' }, backupCard, h('div', { class: 'stack' }, demoCard, recoveryCard)),
  );
}
