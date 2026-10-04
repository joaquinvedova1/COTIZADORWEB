/**
 * Bienvenida (#/bienvenida): onboarding de 3 pantallas después del registro.
 *
 * 1. ¿Qué tipo de empresa tenés?   → organization.industry
 * 2. ¿Desde dónde operás?          → organization.baseLocation
 * 3. ¿Qué querés hacer primero?    → crear cotización / configurar recursos
 *
 * Estado en memoria; al terminar la pantalla 2 se guarda en la organización
 * local con saveOrganization({ industry, baseLocation }). Sin autenticación.
 */

import { h, mount, uniqueId } from '../../dom.js';
import { button, stepIndicator } from '../../components.js';
import { sanitizeText } from '../../../core/validation.js';
import { logger } from '../../../core/logger.js';
import { userErrorMessage } from '../../layout.js';
import { flowHeader, focusHeading, headerLink, isReadOnly, publicIcon } from './public-chrome.js';

/** Tipos de empresa (ids estables: se guardan en organization.industry). */
export const INDUSTRIES = Object.freeze([
  { id: 'oil_gas_services', label: 'Servicios petroleros', hint: 'Yacimientos, pozos, Vaca Muerta.' },
  { id: 'industrial_maintenance', label: 'Mantenimiento industrial', hint: 'Plantas, paradas, montajes.' },
  { id: 'transport', label: 'Transporte', hint: 'Cargas, equipos y personal.' },
  { id: 'construction', label: 'Construcción', hint: 'Obras civiles e industriales.' },
  { id: 'other', label: 'Otra', hint: 'Otro tipo de servicio.' },
]);

const TOTAL = 3;
const MAX_BASE_LENGTH = 120;
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
  const own = organization && organization.illustrative !== true;
  const state = {
    step: 1,
    industry: INDUSTRIES.some((i) => i.id === (organization && organization.industry)) ? organization.industry : null,
    baseLocation: own && typeof organization.baseLocation === 'string' ? organization.baseLocation : '',
  };
  const readOnly = isReadOnly(app);
  let saving = false;

  const body = h('div', { class: 'pub-flow-body pub-container pub-container-narrow' });

  function actions(...nodes) {
    return h('div', { class: 'pub-flow-actions' }, ...nodes);
  }

  function backButton() {
    return button('Atrás', { variant: 'ghost', size: 'lg', icon: 'arrowLeft', onClick: () => go(state.step - 1) });
  }

  function screenIndustry() {
    const titleId = uniqueId('pub-ob');
    const name = uniqueId('industry');
    return [
      h('p', { class: 'pub-eyebrow' }, 'Bienvenido a RATEOS.'),
      h('h1', { class: 'pub-flow-title', id: titleId, tabindex: '-1' }, '¿Qué tipo de empresa tenés?'),
      h('p', { class: 'pub-flow-text' }, 'Lo guardamos con los datos de tu empresa. No cambia ningún cálculo.'),
      h(
        'fieldset',
        { class: 'pub-options', 'aria-labelledby': titleId },
        ...INDUSTRIES.map((opt) => {
          const id = uniqueId('pub-opt');
          const input = h('input', { type: 'radio', id, name, value: opt.id, checked: state.industry === opt.id, class: 'pub-option-input' });
          input.addEventListener('change', () => {
            if (input.checked) state.industry = opt.id;
          });
          return h('label', { class: 'pub-option', for: id }, input, h('span', { class: 'pub-option-body' }, h('span', { class: 'pub-option-title' }, opt.label), h('span', { class: 'pub-option-hint' }, opt.hint)));
        }),
      ),
      actions(h('span'), button('Continuar', { variant: 'primary', size: 'lg', icon: null, onClick: () => go(2), attrs: { class: 'btn btn-primary btn-lg pub-btn' } })),
    ];
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
        h('p', { class: 'pub-field-hint', id: `${id}-hint` }, 'Es tu punto de partida para calcular viajes y logística. Podés cambiarla cuando quieras en Configuración.'),
      ),
      readOnly ? h('p', { class: 'pub-notice pub-notice-warning', role: 'note' }, publicIcon('info', { size: 18 }), h('span', {}, 'Tus datos están en modo sólo lectura: estas respuestas no se van a guardar.')) : null,
      actions(backButton(), continueBtn),
    );
    return [
      h('p', { class: 'pub-eyebrow' }, 'Tu empresa'),
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, '¿Desde dónde operás?'),
      h('p', { class: 'pub-flow-text' }, 'La ciudad o el yacimiento desde donde salen tu gente y tus equipos.'),
      form,
    ];
  }

  function choiceCard({ title, text, href, iconName, primary = false }) {
    return h(
      'a',
      { class: ['pub-choice-card', primary ? 'is-primary' : null], href },
      h('span', { class: 'pub-choice-icon', 'aria-hidden': 'true' }, publicIcon(iconName, { size: 22 })),
      h('span', { class: 'pub-choice-body' }, h('span', { class: 'pub-choice-title' }, title), h('span', { class: 'pub-choice-text' }, text)),
      h('span', { class: 'pub-choice-arrow', 'aria-hidden': 'true' }, publicIcon('arrowRight', { size: 20 })),
    );
  }

  function screenStart() {
    return [
      h('p', { class: 'pub-eyebrow' }, 'Último paso'),
      h('h1', { class: 'pub-flow-title', tabindex: '-1' }, '¿Qué querés hacer primero?'),
      h('p', { class: 'pub-flow-text' }, 'Podés empezar por cualquiera de los dos. Después vas y venís cuando quieras.'),
      h(
        'div',
        { class: 'pub-choice-list' },
        choiceCard({ title: 'Crear cotización', text: 'Calculá cuánto te cuesta un servicio y cuánto cobrarlo.', href: '#/cotizaciones/nueva', iconName: 'tag', primary: true }),
        choiceCard({ title: 'Configurar recursos', text: 'Cargá tu personal y tus equipos una vez, y reutilizalos en cada cotización.', href: '#/recursos/personal', iconName: 'layers' }),
      ),
      h('p', { class: 'pub-flow-more' }, h('a', { href: '#/demo' }, 'Ver un ejemplo primero')),
      actions(backButton(), h('span')),
    ];
  }

  async function saveAndContinue() {
    if (saving) return;
    const patch = {};
    if (state.industry) patch.industry = state.industry;
    const base = sanitizeText(state.baseLocation, MAX_BASE_LENGTH);
    if (base) patch.baseLocation = base;
    if (!readOnly && Object.keys(patch).length) {
      saving = true;
      draw(false);
      try {
        await app.ctx.settings.saveOrganization(patch);
        await app.refreshChrome();
      } catch (error) {
        logger.warn('No se pudieron guardar los datos de la empresa', { name: error && error.name });
        app.toast(userErrorMessage(error, 'No se pudieron guardar tus respuestas. Podés cargarlas después en Configuración.'), 'warning');
      }
      saving = false;
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
