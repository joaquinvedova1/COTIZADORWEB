/**
 * Plantillas de servicio (biblioteca de servicios reutilizables).
 *
 * Cada plantilla precarga tipo de servicio, actividad y (en algunos casos)
 * personal, equipos y materiales. Desde acá se crea una cotización a partir
 * de una plantilla, se renombra o se elimina.
 */

import { h, mount } from '../dom.js';
import { badge, button, card, confirmDialog, emptyState, openDialog, textField } from '../components.js';
import { sanitizeText } from '../../core/validation.js';
import { SERVICE_TYPES, labelOf } from '../../domain/catalogs.js';
import { illustrativeTag, userErrorMessage } from '../layout.js';

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Resumen legible del contenido precargado de una plantilla. */
export function templateContents(service) {
  const d = (service && service.defaults) || {};
  const parts = [];
  const count = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
  if (count('labor')) parts.push(plural(count('labor'), 'puesto', 'puestos'));
  if (count('equipment')) parts.push(plural(count('equipment'), 'equipo', 'equipos'));
  if (count('materials')) parts.push(plural(count('materials'), 'material', 'materiales'));
  const days = d.activity && Number.isFinite(d.activity.activeDaysPerMonth) ? d.activity.activeDaysPerMonth : null;
  return {
    resources: parts.length ? `Incluye ${parts.join(' · ')}` : 'Sin recursos precargados.',
    activity: days !== null ? `Actividad sugerida: ${plural(days, 'día activo', 'días activos')} por mes` : null,
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
    h('ul', { class: 'template-card-meta' }, h('li', {}, contents.resources), contents.activity ? h('li', {}, contents.activity) : null),
    actions.length ? h('div', { class: 'template-card-actions' }, ...actions) : null,
  );
}

export async function render(root, app) {
  const { ctx } = app;
  app.setHeader({
    title: 'Plantillas de servicio',
    breadcrumbs: [{ label: 'Inicio', href: '#/' }],
    actions: [button('Nueva cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') })],
  });

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
        card(
          {},
          emptyState(
            'No hay plantillas de servicio. Podés empezar una cotización en blanco o restaurar los datos demo desde Configuración.',
            h('div', { class: 'row' }, button('Nueva cotización', { variant: 'primary', icon: 'plus', onClick: () => app.navigate('#/cotizaciones/nueva') }), button('Ir a Configuración', { variant: 'secondary', onClick: () => app.navigate('#/configuracion') })),
          ),
        ),
      );
      return;
    }
    mount(
      host,
      h(
        'div',
        { class: 'template-grid' },
        ...services.map((service) => {
          const createBtn = button('Crear cotización', { variant: 'primary', icon: 'plus', size: 'sm' });
          createBtn.addEventListener('click', () => createFrom(service, createBtn));
          return serviceTemplateCard(service, [
            createBtn,
            button('Renombrar', { variant: 'ghost', icon: 'edit', size: 'sm', onClick: () => rename(service), attrs: { 'aria-label': `Renombrar ${service.name}` } }),
            button('', { variant: 'danger', icon: 'trash', size: 'sm', title: 'Eliminar plantilla', onClick: () => remove(service), attrs: { 'aria-label': `Eliminar ${service.name}` } }),
          ]);
        }),
      ),
    );
  }

  mount(
    root,
    h(
      'p',
      { class: 'page-intro' },
      'Servicios que cotizás seguido. Cada plantilla precarga el tipo de servicio, la actividad típica y, en algunos casos, el personal, los equipos y los materiales. Al crear una cotización se copian los valores: después podés cambiar todo.',
    ),
    host,
  );
  await load();
}
