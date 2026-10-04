/**
 * Servicios: plantillas de servicio reutilizables.
 *
 * Cada plantilla precarga tipo de servicio, actividad y (en algunos casos)
 * personal, equipos, materiales, otros costos y vehículos; las guardadas
 * desde una cotización copian también sus condiciones (gastos de estructura,
 * financiación, imprevistos, margen y precio). Desde acá se crea una cotización a partir
 * de una plantilla, se renombra o se elimina.
 */

import { h, mount } from '../dom.js';
import { badge, button, confirmDialog, emptyState, linkButton, openDialog, pageIntro, textField } from '../components.js';
import { sanitizeText } from '../../core/validation.js';
import { QUOTE_STEPS, SERVICE_TYPES, labelOf } from '../../domain/catalogs.js';
import { isPlainObject } from '../../core/object.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Condiciones que una plantilla puede traer (las guardadas desde una
 * cotización traen todo), con el nombre del paso donde se editan.
 */
const TEMPLATE_CONDITIONS = Object.freeze([
  { key: 'indirect', step: 'indirect' },
  { key: 'finance', step: 'finance' },
  { key: 'risk', step: 'risk' },
  { key: 'pricing', step: 'margin' },
  { key: 'rules', step: 'margin' },
]);

/**
 * Resumen legible del contenido precargado de una plantilla: qué líneas trae
 * ("Incluye 1 puesto · 2 equipos · 3 materiales · 2 vehículos"), qué
 * condiciones copia (gastos de estructura, financiación, imprevistos, margen
 * y precio) y la actividad sugerida. "Sólo tipo de servicio y actividad"
 * únicamente si no trae nada de eso.
 * @returns {{ resources: string, conditions: string|null, activity: string|null, hasContent: boolean }}
 */
export function templateContents(service) {
  const d = service && isPlainObject(service.defaults) ? service.defaults : {};
  const len = (v) => (Array.isArray(v) ? v.filter(isPlainObject).length : 0);
  const lines = [
    [len(d.labor), 'puesto', 'puestos'],
    [len(d.equipment), 'equipo', 'equipos'],
    [len(d.materials), 'material', 'materiales'],
    [len(d.otherCosts), 'otro costo', 'otros costos'],
    [len(isPlainObject(d.logistics) ? d.logistics.vehicles : null), 'vehículo', 'vehículos'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => plural(n, one, many));
  const steps = [...new Set(TEMPLATE_CONDITIONS.filter((c) => isPlainObject(d[c.key])).map((c) => labelOf(QUOTE_STEPS, c.step).toLowerCase()))];
  const days = isPlainObject(d.activity) && Number.isFinite(d.activity.activeDaysPerMonth) ? d.activity.activeDaysPerMonth : null;
  let resources = 'Sólo tipo de servicio y actividad';
  let conditions = null;
  if (lines.length) {
    resources = `Incluye ${lines.join(' · ')}`;
    if (steps.length) conditions = `También trae: ${steps.join(' · ')}`;
  } else if (steps.length) {
    resources = `Incluye ${steps.join(' · ')}`;
  }
  return {
    resources,
    conditions,
    activity: days !== null ? `Actividad sugerida: ${plural(days, 'día activo', 'días activos')} por mes` : null,
    hasContent: lines.length > 0 || steps.length > 0,
  };
}

/** Tarjeta de plantilla (se reutiliza en "Nueva cotización"). */
export function serviceTemplateCard(service, actions = []) {
  const contents = templateContents(service);
  return h(
    'article',
    { class: 'template-card' },
    h(
      'div',
      { class: 'template-card-head' },
      h('h3', { class: 'template-card-title' }, service.name || 'Plantilla sin nombre'),
      h('div', { class: 'row template-card-tags' }, badge(labelOf(SERVICE_TYPES, service.serviceType, 'Servicio configurable'), 'navy'), service.illustrative ? illustrativeTag('Plantilla de demostración con valores ilustrativos') : null),
    ),
    service.description ? h('p', { class: 'template-card-desc' }, service.description) : null,
    h('ul', { class: 'template-card-meta' }, h('li', {}, contents.resources), contents.conditions ? h('li', {}, contents.conditions) : null, contents.activity ? h('li', {}, contents.activity) : null),
    actions.length ? h('div', { class: 'template-card-actions' }, ...actions) : null,
  );
}

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({ title: 'Servicios', breadcrumbs: [{ label: 'Inicio', href: '#/inicio' }] });

  const host = h('div', { class: 'stack' });
  let busy = false;

  async function createFrom(service, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const quote = await ctx.quotes.createQuote({ templateId: service.id });
      app.toast(`Cotización ${quote.code || ''} creada desde "${service.name}".`, 'success');
      app.navigate(`#/cotizaciones/${encodeURIComponent(quote.id)}/service`);
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo crear la cotización.'), 'danger');
      btn.disabled = false;
    } finally {
      busy = false;
    }
  }

  function rename(service) {
    const draft = { name: service.name || '', description: service.description || '' };
    const saveBtn = button('Guardar', { variant: 'primary', icon: 'check' });
    const { close } = openDialog({
      title: 'Renombrar plantilla',
      content: h(
        'div',
        { class: 'stack' },
        textField({ label: 'Nombre', value: draft.name, required: true, maxLength: 120, onChange: (v) => { draft.name = v; } }),
        textField({ label: 'Descripción', value: draft.description, multiline: true, maxLength: 400, onChange: (v) => { draft.description = v; } }),
        h('p', { class: 'muted small' }, 'Las cotizaciones ya creadas desde esta plantilla no cambian.'),
      ),
      actions: [button('Cancelar', { variant: 'secondary', onClick: () => close() }), saveBtn],
    });
    saveBtn.addEventListener('click', async () => {
      const name = sanitizeText(draft.name, 120);
      if (!name) {
        app.toast('Ingresá un nombre para la plantilla.', 'warning');
        return;
      }
      saveBtn.disabled = true;
      try {
        const defaults = { ...(service.defaults || {}) };
        // Si el nombre por defecto de la cotización era el de la plantilla, se actualiza también.
        if (!defaults.name || defaults.name === service.name) defaults.name = name;
        await ctx.resources.saveService({ ...service, name, description: sanitizeText(draft.description, 400), defaults });
        app.toast('Plantilla actualizada.', 'success');
        close();
        await load();
      } catch (error) {
        app.toast(userErrorMessage(error, 'No se pudo guardar la plantilla.'), 'danger');
        saveBtn.disabled = false;
      }
    });
  }

  async function remove(service) {
    const ok = await confirmDialog({
      title: 'Eliminar plantilla',
      message: `¿Eliminar la plantilla "${service.name}"? Las cotizaciones ya creadas desde ella no se modifican.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.resources.removeService(service.id);
      app.toast('Plantilla eliminada.', 'success');
      await load();
    } catch (error) {
      app.toast(userErrorMessage(error, 'No se pudo eliminar la plantilla.'), 'danger');
    }
  }

  async function load() {
    const services = await ctx.resources.listServices();
    if (!services.length) {
      mount(
        host,
        emptyState({
          icon: 'services',
          title: 'Todavía no tenés plantillas de servicio.',
          text: 'Una plantilla guarda un servicio que cotizás seguido (tipo de servicio, actividad típica, personal y equipos) para empezar más rápido. Se crea desde el resultado de una cotización con "Guardar como plantilla".',
          action: linkButton('Crear una cotización', '#/cotizaciones/nueva', { variant: 'primary', icon: 'plus' }),
          secondary: linkButton('Restaurar los datos de ejemplo', '#/configuracion/datos', { variant: 'secondary' }),
        }),
      );
      return;
    }
    mount(
      host,
      h(
        'div',
        { class: 'template-grid' },
        ...services.map((service) => {
          // El nombre accesible empieza con el texto visible (WCAG 2.5.3).
          const createBtn = button('Crear cotización', { variant: 'secondary', icon: 'plus', size: 'sm', attrs: { 'aria-label': `Crear cotización: ${service.name || 'plantilla sin nombre'}` } });
          createBtn.addEventListener('click', () => createFrom(service, createBtn));
          return serviceTemplateCard(service, [
            createBtn,
            h(
              'span',
              { class: 'template-card-tools' },
              button('', { variant: 'ghost', icon: 'edit', size: 'sm', title: 'Renombrar plantilla', onClick: () => rename(service), attrs: { 'aria-label': `Renombrar ${service.name}`, class: 'btn btn-ghost btn-sm btn-icon' } }),
              button('', { variant: 'ghost', icon: 'trash', size: 'sm', title: 'Eliminar plantilla', onClick: () => remove(service), attrs: { 'aria-label': `Eliminar ${service.name}`, class: 'btn btn-ghost btn-sm btn-icon btn-ghost-danger' } }),
            ),
          ]);
        }),
      ),
    );
  }

  mount(
    root,
    pageIntro({
      title: 'Tus servicios',
      text: 'Los servicios que cotizás seguido, listos para reutilizar. Al crear una cotización desde una plantilla se copian sus valores: después podés cambiar todo.',
    }),
    host,
  );
  await load();
}
