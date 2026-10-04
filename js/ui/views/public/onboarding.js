/**
 * Bienvenida (#/bienvenida): onboarding de 3 pantallas después del registro.
 *
 * 1. ¿Qué tipo de empresa tenés?   → organization.industry
 * 2. ¿Desde dónde operás?          → organization.baseLocation
 * 3. ¿Qué querés hacer primero?    → crear cotización / configurar recursos
 *
 * Las respuestas viven en memoria. Qué se guarda y cuándo (sin autenticación):
 * - Empresa PROPIA (organization.illustrative !== true): al terminar la
 *   pantalla 2, saveOrganization({ industry, baseLocation }).
 * - Empresa de EJEMPLO (ILUSTRATIVA): nada hasta la pantalla 3. Ahí se elige
 *   "Con mi empresa, sin datos de ejemplo" → confirmación → backup.startFresh()
 *   (guarda antes una copia de recuperación), o "Con los datos de ejemplo,
 *   para explorar" → no se escribe nada (la empresa ficticia queda intacta).
 * - Sólo lectura: nunca se escribe.
 * El nombre de la empresa llega del registro EN MEMORIA (getPendingCompanyName).
 * "Ver un ejemplo primero" abre #/demo?desde=bienvenida y deja las respuestas
 * EN MEMORIA (setOnboardingDraft): al volver, la bienvenida las retoma.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { button, confirmDialog, stepIndicator } from '../../components.js';
import { sanitizeText } from '../../../core/validation.js';
import { logger } from '../../../core/logger.js';
import { userErrorMessage } from '../../layout.js';
import { flowHeader, focusHeading, getPendingCompanyName, headerLink, isReadOnly, publicIcon, setOnboardingDraft, setPendingCompanyName, takeOnboardingDraft } from './public-chrome.js';

/** Tipos de empresa (ids estables: se guardan en organization.industry). */
export const INDUSTRIES = Object.freeze([
  { id: 'oil_gas_services', label: 'Servicios petroleros', hint: 'Yacimientos, pozos, Vaca Muerta.' },
  { id: 'industrial_maintenance', label: 'Mantenimiento industrial', hint: 'Plantas, paradas, montajes.' },
  { id: 'transport', label: 'Transporte', hint: 'Cargas, equipos y personal.' },
  { id: 'construction', label: 'Construcción', hint: 'Obras civiles e industriales.' },
  { id: 'other', label: 'Otra', hint: 'Otro tipo de servicio.' },
]);

/** ¿Con qué datos empezás? (sólo si la empresa actual es la de ejemplo). */
const DATA_CHOICES = Object.freeze([
  { id: 'mine', label: 'Con mi empresa, sin datos de ejemplo', hint: 'Quitamos la empresa ficticia y sus cotizaciones; guardamos una copia de recuperación.' },
  { id: 'demo', label: 'Con los datos de ejemplo, para explorar', hint: 'No guardamos nada: la empresa de ejemplo queda como está. Podés pasar a tus datos después, desde Configuración.' },
]);

const TOTAL = 3;
const MAX_BASE_LENGTH = 120;
const MAX_COMPANY_LENGTH = 120;
const BASE_SUGGESTIONS = Object.freeze(['Neuquén Capital', 'Añelo', 'Rincón de los Sauces', 'Centenario', 'Plottier', 'Cutral Có', 'Cipolletti', 'Allen']);

export async function render(root, app) {
  app.setHeader({ title: 'Bienvenido' });

  let organization = null;
  let locations = [];
  try {
    organization = await app.ctx.settings.getOrganization();
  } catch (error) {
    logger.warn('No se pudo leer la organización', { name: error && error.name });
  }
  try {
    locations = await app.ctx.resources.list('locations');
  } catch {
    locations = [];
  }

  // Datos de una empresa de ejemplo (ILUSTRATIVA) no se precargan como si fueran del usuario.
  const illustrative = Boolean(organization && organization.illustrative === true);
  const own = Boolean(organization) && !illustrative;
  const companyName = sanitizeText(getPendingCompanyName(), MAX_COMPANY_LENGTH);
  const currentName = own && typeof organization.name === 'string' ? organization.name.trim() : '';
  const state = {
    step: 1,
    industry: INDUSTRIES.some((i) => i.id === (organization && organization.industry)) ? organization.industry : null,
    baseLocation: own && typeof organization.baseLocation === 'string' ? organization.baseLocation : '',
    dataChoice: 'mine',
    // Empresa propia con otro nombre: cambiarlo sólo si la persona lo marca.
    renameTo: own && companyName && companyName !== currentName ? companyName : '',
    rename: false,
  };
  // Vuelve del ejemplo (#/demo?desde=bienvenida): retoma sus respuestas y el paso.
  const draft = takeOnboardingDraft();
  if (draft) {
    if (INDUSTRIES.some((i) => i.id === draft.industry)) state.industry = draft.industry;
    if (typeof draft.baseLocation === 'string') state.baseLocation = draft.baseLocation;
    if (DATA_CHOICES.some((c) => c.id === draft.dataChoice)) state.dataChoice = draft.dataChoice;
    if (typeof draft.rename === 'boolean') state.rename = draft.rename;
    if (Number.isInteger(draft.step) && draft.step >= 1 && draft.step <= TOTAL) state.step = draft.step;
  }
  const readOnly = isReadOnly(app);
  let saving = false;
  let starting = false;

  const body = h('div', { class: 'pub-flow-body pub-container pub-container-narrow' });

  function actions(...nodes) {
    return h('div', { class: 'pub-flow-actions' }, ...nodes);
  }

  function backButton() {
    return button('Atrás', { variant: 'ghost', size: 'lg', icon: 'arrowLeft', onClick: () => go(state.step - 1) });
  }

  function readOnlyNotice(text) {
    return h('p', { class: 'pub-notice pub-notice-warning', role: 'note' }, publicIcon('info', { size: 18 }), h('span', {}, text));
  }

  /** Grupo de opciones (radio) con título y ayuda por opción. */
  function optionGroup({ legend = null, labelledBy = null, options, selected, onSelect, className = '' }) {
    const name = uniqueId('pub-opt-group');
    return h(
      'fieldset',
      { class: ['pub-options', className], 'aria-labelledby': labelledBy },
      legend ? h('legend', { class: 'pub-options-legend' }, legend) : null,
      ...options.map((opt) => {
        const id = uniqueId('pub-opt');
        const input = h('input', { type: 'radio', id, name, value: opt.id, checked: selected === opt.id, class: 'pub-option-input' });
        input.addEventListener('change', () => {
          if (input.checked) onSelect(opt.id);
        });
        return h('label', { class: 'pub-option', for: id }, input, h('span', { class: 'pub-option-body' }, h('span', { class: 'pub-option-title' }, opt.label), h('span', { class: 'pub-option-hint' }, opt.hint)));
      }),
    );
  }

  /** Cuándo se guarda la respuesta: sólo se promete lo que de verdad pasa. */
  function industrySaveText() {
    if (readOnly) return 'Tus datos están en modo sólo lectura: esta respuesta no se va a guardar. No cambia ningún cálculo.';
    if (illustrative) return 'Lo guardamos cuando empieces con tu empresa (en el último paso). No cambia ningún cálculo.';
    return 'Lo guardamos con los datos de tu empresa. No cambia ningún cálculo.';
  }

  function screenIndustry() {
    const titleId = uniqueId('pub-ob');
    return [
      h('p', { class: 'pub-eyebrow' }, 'Bienvenido a RATEOS'),
      h('h1', { class: 'pub-flow-title', id: titleId, tabindex: '-1' }, '¿Qué tipo de empresa tenés?'),
      h('p', { class: 'pub-flow-text' }, industrySaveText()),
      optionGroup({
        labelledBy: titleId,
        options: INDUSTRIES,
        selected: state.industry,
        onSelect: (id) => {
          state.industry = id;
        },
      }),
      actions(h('span'), button('Continuar', { variant: 'primary', size: 'lg', icon: null, onClick: () => go(2), attrs: { class: 'btn btn-primary btn-lg pub-btn' } })),
    ];
  }

  function renameField() {
    if (!state.renameTo || readOnly) return null;
    const id = uniqueId('pub-rename');
    const input = h('input', { type: 'checkbox', id, checked: state.rename, class: 'pub-check-input' });
    input.addEventListener('change', () => {
      state.rename = input.checked;
    });
    return h(
      'label',
      { class: 'pub-check', for: id },
      input,
      h('span', {}, `Cambiar el nombre de la empresa a “${state.renameTo}”`, currentName ? h('span', { class: 'pub-check-hint' }, ` (hoy: “${currentName}”)`) : null),
    );
  }

  function screenBase() {
    const id = uniqueId('pub-base');
    const listId = uniqueId('pub-base-list');
    const suggestions = [...new Set([...locations.map((l) => (l && typeof l.name === 'string' ? l.name.trim() : '')).filter(Boolean), ...BASE_SUGGESTIONS])].slice(0, 20);
    const input = h('input', {
      id,
      type: 'text',
      name: 'base-location',
      autocomplete: 'address-level2',
      maxlength: String(MAX_BASE_LENGTH),
      value: state.baseLocation,
      list: listId,
      placeholder: 'Ej.: Neuquén Capital, Añelo',
      'aria-describedby': `${id}-hint`,
    });
    input.addEventListener('input', () => {
      state.baseLocation = input.value;
    });
    const continueBtn = button(saving ? 'Guardando…' : 'Continuar', { variant: 'primary', size: 'lg', disabled: saving, onClick: () => saveAndContinue(), attrs: { class: 'btn btn-primary btn-lg pub-btn' } });
    const form = h(
      'form',
      {
        class: 'pub-flow-form',
        novalidate: true,
        on: {
          submit: (event) => {
            event.preventDefault();
            saveAndContinue();
          },
        },
      },
      h(
        'div',
        { class: 'pub-field pub-field-lg' },
        h('label', { class: 'pub-label', for: id }, 'Base operativa'),
        input,
        h('datalist', { id: listId }, ...suggestions.map((v) => h('option', { value: v }))),
        h('p', { class: 'pub-field-hint', id: `${id}-hint` }, 'La usamos como origen de tus viajes en cada cotización nueva. Las distancias las cargás vos (o desde Recursos → Ubicaciones).'),
      ),
      own ? renameField() : null,
      readOnly ? readOnlyNotice('Tus datos están en modo sólo lectura: estas respuestas no se van a guardar.') : null,
      actions(backButton(), continueBtn),
    );
    return [
      h('p', { class: 'pub-eyebrow' }, 'Tu empresa'),
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, '¿Desde dónde operás?'),
      h('p', { class: 'pub-flow-text' }, 'La ciudad o el yacimiento desde donde salen tu gente y tus equipos.'),
      form,
    ];
  }

  function choiceCard({ title, text, target, iconName, primary = false }) {
    return h(
      'button',
      { type: 'button', class: ['pub-choice-card', primary ? 'is-primary' : null], on: { click: () => start(target) } },
      h('span', { class: 'pub-choice-icon', 'aria-hidden': 'true' }, publicIcon(iconName, { size: 22 })),
      h('span', { class: 'pub-choice-body' }, h('span', { class: 'pub-choice-title' }, title), h('span', { class: 'pub-choice-text' }, text)),
      h('span', { class: 'pub-choice-arrow', 'aria-hidden': 'true' }, publicIcon('arrowRight', { size: 20 })),
    );
  }

  function screenStart() {
    const askData = illustrative && !readOnly;
    return [
      h('p', { class: 'pub-eyebrow' }, 'Último paso'),
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, '¿Qué querés hacer primero?'),
      h('p', { class: 'pub-flow-text' }, 'Podés empezar por cualquiera de los dos. Después vas y venís cuando quieras.'),
      askData
        ? optionGroup({
            legend: '¿Con qué datos empezás?',
            options: DATA_CHOICES,
            selected: state.dataChoice,
            onSelect: (id) => {
              state.dataChoice = id;
            },
            className: 'pub-options-data',
          })
        : null,
      readOnly ? readOnlyNotice('Tus datos están en modo sólo lectura: no se va a guardar nada.') : null,
      h(
        'div',
        { class: 'pub-choice-list' },
        choiceCard({ title: 'Crear cotización', text: 'Calculá cuánto te cuesta un servicio y cuánto cobrarlo.', target: '#/cotizaciones/nueva', iconName: 'tag', primary: true }),
        choiceCard({ title: 'Configurar recursos', text: 'Cargá tu personal y tus equipos una vez, y reutilizalos en cada cotización.', target: '#/recursos/personal', iconName: 'layers' }),
      ),
      h(
        'p',
        { class: 'pub-flow-more' },
        h(
          'a',
          {
            href: '#/demo?desde=bienvenida',
            // Al volver del ejemplo, la bienvenida retoma estas respuestas (en memoria).
            on: { click: () => setOnboardingDraft({ step: 3, industry: state.industry, baseLocation: state.baseLocation, dataChoice: state.dataChoice, rename: state.rename }) },
          },
          'Ver un ejemplo primero',
        ),
      ),
      actions(backButton(), h('span')),
    ];
  }

  /** Explica, antes de confirmar, qué se quita, qué se conserva y cómo volver atrás. */
  async function confirmStartFresh() {
    let total = 0;
    let mine = 0;
    try {
      const items = await app.ctx.quotes.listQuotes();
      total = items.length;
      mine = items.filter((i) => i && i.quote && i.quote.illustrative !== true).length;
    } catch (error) {
      logger.warn('No se pudieron contar las cotizaciones', { name: error && error.name });
    }
    const quotesText = total === 1 ? 'la cotización guardada' : total > 1 ? `las ${total} cotizaciones guardadas` : 'las cotizaciones';
    // Corto a propósito: en un celular chico (320 × 640) tiene que entrar con los botones a la vista.
    const details = h(
      'ul',
      { class: 'pub-confirm-list' },
      h('li', {}, h('strong', {}, 'Se quitan '), `la empresa ficticia, ${quotesText} y los recursos (personal, equipos, materiales y ubicaciones).`),
      mine > 0 ? h('li', { class: 'pub-confirm-warning' }, h('strong', {}, 'Ojo: '), `incluye ${mine === 1 ? '1 cotización que creaste vos' : `${mine} cotizaciones que creaste vos`}.`) : null,
      h('li', {}, h('strong', {}, 'Se conservan '), 'convenios, plantillas y configuración, y antes guardamos una copia de recuperación (la restaurás en Configuración → Datos y backup).'),
      companyName ? null : h('li', {}, 'Tu empresa va a figurar como “Mi empresa”: el nombre lo cambiás en Configuración.'),
    );
    return confirmDialog({
      title: '¿Empezar con tu empresa, sin datos de ejemplo?',
      message: companyName ? `Dejamos RATEOS listo para “${companyName}”, en este navegador.` : 'Dejamos RATEOS listo para tus datos, en este navegador.',
      confirmLabel: 'Empezar con mi empresa',
      cancelLabel: 'Cancelar',
      danger: mine > 0,
      details,
    });
  }

  async function start(target) {
    if (starting) return;
    if (readOnly || !illustrative || state.dataChoice !== 'mine') {
      // Nada que escribir: la empresa propia ya se guardó en la pantalla 2 y
      // "explorar" deja la empresa de ejemplo como está.
      app.navigate(target);
      return;
    }
    starting = true;
    const confirmed = await confirmStartFresh();
    if (!confirmed) {
      starting = false;
      return;
    }
    setChoicesBusy(true);
    try {
      await app.ctx.backup.startFresh({
        name: companyName || '',
        baseLocation: sanitizeText(state.baseLocation, MAX_BASE_LENGTH),
        industry: state.industry || '',
      });
      setPendingCompanyName('');
      await app.refreshChrome();
      app.toast('Listo: empezaste con tu empresa. Los datos de ejemplo quedaron en una copia de recuperación.', 'success');
      starting = false;
      app.navigate(target);
    } catch (error) {
      logger.warn('No se pudo empezar con la empresa propia', { name: error && error.name });
      app.toast(userErrorMessage(error, 'No se pudo preparar tu empresa. Probá de nuevo o hacelo después desde Configuración → Datos y backup.'), 'danger');
      starting = false;
      setChoicesBusy(false);
    }
  }

  /** Mientras se prepara la empresa, las opciones no se pueden volver a tocar. */
  function setChoicesBusy(busy) {
    body.querySelectorAll('.pub-choice-card').forEach((el) => {
      if (busy) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    });
    if (busy) body.setAttribute('aria-busy', 'true');
    else body.removeAttribute('aria-busy');
  }

  async function saveAndContinue() {
    if (saving) return;
    // Empresa de ejemplo: no se escribe nada acá (se decide en la pantalla 3).
    if (own && !readOnly) {
      const patch = {};
      if (state.industry) patch.industry = state.industry;
      const base = sanitizeText(state.baseLocation, MAX_BASE_LENGTH);
      if (base) patch.baseLocation = base;
      if (state.renameTo && state.rename) patch.name = state.renameTo;
      if (Object.keys(patch).length) {
        saving = true;
        draw(false);
        try {
          await app.ctx.settings.saveOrganization(patch);
          if (patch.name) setPendingCompanyName('');
          await app.refreshChrome();
        } catch (error) {
          logger.warn('No se pudieron guardar los datos de la empresa', { name: error && error.name });
          app.toast(userErrorMessage(error, 'No se pudieron guardar tus respuestas. Podés cargarlas después en Configuración.'), 'warning');
        }
        saving = false;
      }
    }
    go(3);
  }

  function draw(moveFocus = true) {
    const screens = { 1: screenIndustry, 2: screenBase, 3: screenStart };
    mount(body, stepIndicator({ current: state.step, total: TOTAL }), h('div', { class: 'pub-flow-screen' }, ...screens[state.step]()));
    if (moveFocus) focusHeading(body.querySelector('h1'));
  }

  function go(step) {
    state.step = Math.min(TOTAL, Math.max(1, step));
    window.scrollTo(0, 0);
    draw(true);
  }

  draw(false);
  mount(
    root,
    h('div', { class: 'pub-page pub-flow' }, flowHeader({ brandHref: '#/', actions: [headerLink('Saltar por ahora', '#/inicio')] }), body),
  );
}
