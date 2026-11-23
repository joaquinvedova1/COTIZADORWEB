/**
 * RATEOS Admin › Reportes: lo que mandan los usuarios con «Reportar un
 * problema» y su seguimiento (tipo, severidad, estado, versión en que se
 * corrigió y nota). Sólo RATEOS_ADMIN: la base lo vuelve a verificar.
 *
 * Nunca muestra quién reportó (ni email ni empresa): sólo si fue con cuenta,
 * desde la demo o desde el sitio público. El texto lo escribió un usuario:
 * se muestra como texto, nunca como HTML.
 */

import { h, mount } from '../dom.js';
import { badge, banner, button, card, kpi, selectField, textField, toast } from '../components.js';
import { formatDateTime } from '../../core/format.js';
import { REPORT_KINDS, reportKind } from '../../services/feedback-service.js';

export const REPORT_STATUSES = Object.freeze([
  { value: 'nuevo', label: 'Nuevo', tone: 'blue' },
  { value: 'revisado', label: 'Revisado (duda de uso)', tone: 'gray' },
  { value: 'a_corregir', label: 'A corregir', tone: 'orange' },
  { value: 'resuelto', label: 'Resuelto', tone: 'green' },
  { value: 'descartado', label: 'Descartado', tone: 'gray' },
]);
export const REPORT_SEVERITIES = Object.freeze([
  { value: 'critica', label: 'Crítica (precio o datos mal)', tone: 'red' },
  { value: 'alta', label: 'Alta (no puede seguir)', tone: 'orange' },
  { value: 'media', label: 'Media (molesta, hay atajo)', tone: 'blue' },
  { value: 'baja', label: 'Baja (detalle)', tone: 'gray' },
]);
const MODES = Object.freeze({ cuenta: 'Con cuenta', demo: 'Demo', publico: 'Sitio público' });

/** Filtros del listado. */
export const REPORT_FILTERS = Object.freeze([
  { value: 'pendientes', label: 'Pendientes', test: (r) => r.status === 'nuevo' || r.status === 'a_corregir' },
  { value: 'nuevo', label: 'Sin revisar', test: (r) => r.status === 'nuevo' },
  { value: 'a_corregir', label: 'A corregir', test: (r) => r.status === 'a_corregir' },
  { value: 'cerrados', label: 'Resueltos y descartados', test: (r) => ['resuelto', 'descartado', 'revisado'].includes(r.status) },
  { value: 'todos', label: 'Todos', test: () => true },
]);

const SEVERITY_ORDER = { critica: 0, alta: 1, media: 2, baja: 3 };

/** Orden: severidad (sin severidad al final), después el más nuevo primero. */
export function sortReports(reports) {
  return [...reports].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 4;
    const sb = SEVERITY_ORDER[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

/** Conteos para los indicadores. */
export function summarizeReports(reports) {
  const count = (fn) => reports.filter(fn).length;
  return {
    nuevos: count((r) => r.status === 'nuevo'),
    aCorregir: count((r) => r.status === 'a_corregir'),
    criticos: count((r) => (r.status === 'nuevo' || r.status === 'a_corregir') && (r.severity === 'critica' || r.severity === 'alta')),
    resueltos: count((r) => r.status === 'resuelto'),
  };
}

const statusInfo = (value) => REPORT_STATUSES.find((s) => s.value === value) || REPORT_STATUSES[0];
const severityInfo = (value) => REPORT_SEVERITIES.find((s) => s.value === value) || null;

function reportCard(report, { onSave, canEdit }) {
  const changes = {};
  const sev = severityInfo(report.severity);
  const st = statusInfo(report.status);
  const head = h('div', { class: 'admin-report-head' },
    h('strong', { class: 'mono' }, report.reference || 'R-??????'),
    badge(st.label, st.tone),
    sev ? badge(sev.label.split(' (')[0], sev.tone) : badge('Sin severidad', 'gray'),
    badge(report.kind ? reportKind(report.kind).short : 'Sin tipo', 'gray'),
    h('span', { class: 'admin-muted' }, `${report.created_at ? formatDateTime(report.created_at) : '—'} · ${MODES[report.mode] || '—'} · v${report.app_version || '—'}`));

  const quote = (label, text) => (text ? h('div', { class: 'admin-report-text' }, h('span', { class: 'admin-muted' }, label), h('p', {}, text)) : null);
  const where = [report.step, report.where_label].filter(Boolean).join(' · ');
  const body = h('div', { class: 'admin-report-body' },
    quote(report.kind ? reportKind(report.kind).what : '¿Qué pasó?', report.what_happened),
    quote(report.kind ? reportKind(report.kind).expected.replace(' (opcional)', '') : '¿Qué esperaba?', report.expected),
    h('p', { class: 'admin-muted admin-report-tech' }, `Dónde: ${where || '—'} (${report.route || '—'}) · Ventana ${report.viewport || '—'} · build ${report.app_commit || '—'}`),
    report.browser ? h('p', { class: 'admin-muted admin-report-tech' }, report.browser) : null);

  if (!canEdit) return h('article', { class: 'admin-report' }, head, body);

  const saveBtn = button('Guardar seguimiento', { variant: 'primary', size: 'sm', onClick: async () => {
    if (!Object.keys(changes).length) {
      toast('No cambiaste nada.', 'info');
      return;
    }
    saveBtn.setAttribute('aria-busy', 'true');
    const ok = await onSave(report, { ...changes });
    saveBtn.removeAttribute('aria-busy');
    if (ok) Object.keys(changes).forEach((k) => delete changes[k]);
  } });
  const edit = h('div', { class: 'admin-report-edit' },
    selectField({ label: 'Estado', value: report.status || 'nuevo', options: REPORT_STATUSES, onChange: (v) => { changes.status = v; } }),
    selectField({ label: 'Severidad', value: report.severity || '', options: REPORT_SEVERITIES, includeEmpty: true, emptyLabel: 'Sin definir', onChange: (v) => { changes.severity = v || ''; } }),
    selectField({ label: 'Tipo', value: report.kind || 'error', options: REPORT_KINDS.map((k) => ({ value: k.value, label: k.label })), onChange: (v) => { changes.kind = v; } }),
    textField({ label: 'Corregido en la versión', value: report.fixed_in_version || '', maxLength: 40, placeholder: 'Ej.: 0.22.0', onChange: (v) => { changes.fixed_in_version = v; } }),
    textField({ label: 'Nota de seguimiento', value: report.triage_note || '', maxLength: 4000, multiline: true, placeholder: 'Qué era, qué se hizo (PR), o por qué se descarta.', onChange: (v) => { changes.triage_note = v; } }),
    h('div', { class: 'row' }, saveBtn));
  return h('article', { class: 'admin-report' }, head, body, edit);
}

/**
 * Sección "Reportes" del panel.
 * @param {HTMLElement} root
 * @param {{ listForAdmin: Function, updateForAdmin: Function }|null} service
 */
export async function renderReports(root, service) {
  if (!service || typeof service.listForAdmin !== 'function') {
    mount(root, banner('Los reportes no están disponibles en esta versión.', 'warning'));
    return;
  }
  mount(root, h('p', { class: 'admin-muted', role: 'status' }, 'Cargando reportes…'));
  const res = await service.listForAdmin();
  if (!res.ok) {
    mount(root, h('div', {}, banner(res.message, res.code === 'not_ready' ? 'warning' : 'danger'),
      h('div', { class: 'row' }, button('Reintentar', { variant: 'secondary', onClick: () => renderReports(root, service) }))));
    return;
  }
  let reports = res.reports;
  // Antes de la migración de seguimiento la base no devuelve el id: se ven, pero no se editan.
  const canEdit = reports.every((r) => typeof r.id === 'string');
  let filter = 'pendientes';

  const list = h('div', { class: 'admin-report-list' });
  const kpis = h('div', { class: 'kpi-grid admin-kpis' });
  const filters = h('div', { class: 'admin-report-filters', role: 'group', 'aria-label': 'Filtrar reportes' });

  async function save(report, changes) {
    const out = await service.updateForAdmin(report.id, changes);
    if (!out.ok) {
      toast(out.message, 'warning', { timeout: 6000 });
      return false;
    }
    reports = reports.map((r) => (r.id === report.id ? { ...r, ...changes, severity: changes.severity === '' ? null : (changes.severity ?? r.severity) } : r));
    toast(`Guardado ${report.reference || ''}.`, 'success');
    draw();
    return true;
  }

  function draw() {
    const s = summarizeReports(reports);
    mount(kpis,
      kpi({ label: 'Sin revisar', value: String(s.nuevos) }),
      kpi({ label: 'A corregir', value: String(s.aCorregir) }),
      kpi({ label: 'Críticos o altos abiertos', value: String(s.criticos), tone: s.criticos ? 'red' : null }),
      kpi({ label: 'Resueltos', value: String(s.resueltos) }));
    mount(filters, ...REPORT_FILTERS.map((f) => button(`${f.label} (${reports.filter(f.test).length})`, {
      variant: f.value === filter ? 'primary' : 'secondary',
      size: 'sm',
      attrs: { 'aria-pressed': f.value === filter ? 'true' : 'false' },
      onClick: () => { filter = f.value; draw(); },
    })));
    const active = REPORT_FILTERS.find((f) => f.value === filter) || REPORT_FILTERS[0];
    const rows = sortReports(reports.filter(active.test));
    mount(list, ...(rows.length
      ? rows.map((r) => reportCard(r, { onSave: save, canEdit }))
      : [h('p', { class: 'admin-muted' }, reports.length ? 'No hay reportes con este filtro.' : 'Todavía no llegó ningún reporte.')]));
  }

  draw();
  mount(root,
    card({ title: 'Reportes de usuarios', subtitle: 'Lo que mandan con «Reportar un problema». No se publican en ningún lado; quién reportó no se muestra.', level: 3 },
      canEdit ? null : banner('Para clasificar y marcar como resueltos falta aplicar la migración de seguimiento de reportes (20261124120000) en Supabase. Mientras tanto se pueden leer.', 'warning'),
      kpis, filters, list));
}
