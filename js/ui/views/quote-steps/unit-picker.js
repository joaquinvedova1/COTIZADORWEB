/**
 * Selector de la unidad de cobro (UXR): las más comunes a la vista como botones de opción y TODO el catálogo
 * en un buscador (combobox con lista agrupada, sinónimos y "Usar «…» como unidad"). No depende del tipo de
 * servicio. Patrón combobox de la APG (WAI-ARIA): flechas, Enter, Esc; la opción activa con
 * aria-activedescendant; el foco no se pierde al elegir con las flechas.
 */

import { h, uniqueId } from '../../dom.js';
import { icon } from '../../components.js';
import {
  SUGGESTED_UNIT_KEYS, unitEntry, unitKeyOf, unitDisplayName, searchUnits, exactUnitMatch, customUnitApply,
} from '../../../domain/unit-catalog.js';
import { cleanUnitName } from '../../../domain/billing-units.js';

/** Vuelve a poner el foco en un control después de que el paso se redibuja. */
function refocus(selector) {
  setTimeout(() => {
    const el = document.querySelector(selector);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }, 0);
}

/**
 * @param {{ quote: object, currency: string, readOnly: boolean, onSelect: (apply: object) => Promise<boolean>|boolean }} opts
 */
export function unitPicker({ quote, currency, readOnly, onSelect }) {
  const currentKey = unitKeyOf(quote);
  const id = uniqueId('unitpick');
  const keys = [...SUGGESTED_UNIT_KEYS];
  // La unidad actual siempre a la vista (si no es una de las sugeridas).
  const extraChip = currentKey && !keys.includes(currentKey) ? currentKey : null;
  const customName = quote.unit === 'custom' && !currentKey ? cleanUnitName(quote.unitName) : null;

  const choose = async (apply, focusSelector) => {
    if (readOnly) return;
    await onSelect(apply);
    if (focusSelector) refocus(focusSelector);
  };

  const chip = (key, label, apply) => {
    const input = h('input', { type: 'radio', name: 'unitChoice', value: key, checked: key === (currentKey || (customName ? 'custom:current' : null)), disabled: readOnly });
    input.addEventListener('change', () => {
      if (input.checked && apply) choose(apply, `input[name="unitChoice"][value="${key.replace(/"/g, '\\"')}"]`);
    });
    return h('label', { class: 'qe-chip' }, input, h('span', {}, label));
  };

  const chips = [
    ...keys.map((k) => chip(k, unitEntry(k).name, unitEntry(k).apply)),
    extraChip && unitEntry(extraChip) ? chip(extraChip, unitEntry(extraChip).name, unitEntry(extraChip).apply) : null,
    extraChip === 'job_monthly' ? chip('job_monthly', 'trabajo (por mes)', null) : null,
    customName ? chip('custom:current', customName, null) : null,
  ].filter(Boolean);

  // ---- Buscador
  const listId = `${id}-list`;
  const input = h('input', {
    type: 'text',
    id: `${id}-search`,
    class: 'qe-unit-search-input',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    autocomplete: 'off',
    placeholder: 'Buscá: hora-hombre, tonelada, m³, válvula, camión…',
    disabled: readOnly,
  });
  const list = h('div', { class: 'qe-unit-list', id: listId, role: 'listbox', 'aria-label': 'Unidades de cobro', hidden: true });
  let options = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const setActive = (i) => {
    options.forEach((o, j) => o.el.classList.toggle('is-active', j === i));
    active = i;
    if (i >= 0 && options[i]) {
      input.setAttribute('aria-activedescendant', options[i].el.id);
      options[i].el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const pick = (i) => {
    const o = options[i];
    if (!o) return;
    close();
    input.value = '';
    choose(o.apply, `input[name="unitChoice"][value="${String(o.key).replace(/"/g, '\\"')}"]`);
  };
  const render = () => {
    const q = input.value;
    const groups = searchUnits(q);
    options = [];
    const children = [];
    groups.forEach((g) => {
      const gid = uniqueId('ug');
      children.push(h('div', { class: 'qe-unit-group', role: 'group', 'aria-labelledby': gid },
        h('div', { class: 'qe-unit-group-label', id: gid }, g.label),
        ...g.items.map((e) => {
          const el = h('div', { class: ['qe-unit-option', e.key === currentKey ? 'is-current' : null], role: 'option', id: uniqueId('uo'), 'aria-selected': e.key === currentKey ? 'true' : 'false' },
            h('span', { class: 'qe-unit-option-name' }, e.name),
            h('span', { class: 'qe-unit-option-hint' }, e.hint));
          const index = options.length;
          el.addEventListener('mousedown', (ev) => ev.preventDefault());
          el.addEventListener('click', () => pick(index));
          options.push({ key: e.key, apply: e.apply, el });
          return el;
        })));
    });
    const clean = cleanUnitName(q);
    if (clean && !exactUnitMatch(clean)) {
      const el = h('div', { class: 'qe-unit-option qe-unit-own', role: 'option', id: uniqueId('uo'), 'aria-selected': 'false' },
        icon('plus', { size: 16 }), h('span', { class: 'qe-unit-option-name' }, `Usar «${clean}» como unidad`), h('span', { class: 'qe-unit-option-hint' }, `Tu tarifa va a ser ${currency} por ${clean}.`));
      const index = options.length;
      el.addEventListener('mousedown', (ev) => ev.preventDefault());
      el.addEventListener('click', () => pick(index));
      options.push({ key: 'custom:current', apply: customUnitApply(clean), el });
      children.push(el);
    }
    if (!options.length) children.push(h('div', { class: 'qe-unit-empty' }, 'Escribí el nombre de tu unidad.'));
    list.replaceChildren(...children);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    // Con texto, la primera coincidencia queda activa (Enter la elige).
    setActive(q.trim() && options.length ? 0 : -1);
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (!readOnly) render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (list.hidden) render();
      setActive(Math.min(active + 1, options.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (ev.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        ev.preventDefault();
        pick(active);
      }
    } else if (ev.key === 'Escape') {
      if (!list.hidden) {
        ev.preventDefault();
        close();
      }
    }
  });

  const selected = currentKey && unitEntry(currentKey);
  const hintText = selected
    ? selected.hint
    : currentKey === 'job_monthly'
      ? 'Trabajos por mes (cómo se cargaba antes). Elegí "precio total del trabajo" para cotizar la obra completa.'
      : customName
        ? `Unidad propia: tu tarifa va en ${currency} por ${customName}.`
        : '';

  return h(
    'fieldset',
    { class: 'choice-group qe-unit-field qe-unit-picker', 'aria-describedby': `${id}-hint` },
    h('legend', { class: 'field-label qe-unit-legend' }, '¿Cómo le cobrás al cliente?'),
    h('p', { class: 'qe-unit-lead' }, 'Elegí la unidad de tu tarifa. Los costos se calculan igual con cualquiera.'),
    h('div', { class: 'qe-compound' },
      h('span', { class: 'qe-compound-fixed', 'aria-hidden': 'true' }, `${currency} /`),
      h('div', { class: 'qe-chips' }, ...chips)),
    h('div', { class: 'qe-unit-search' },
      h('label', { class: 'qe-unit-search-label', for: `${id}-search` }, 'Otra unidad'),
      h('div', { class: 'qe-unit-search-box' }, icon('search', { size: 16 }), input, list)),
    h('div', { class: 'field-hint', id: `${id}-hint` }, hintText ? `${currency} / ${unitDisplayName(quote)}: ${hintText}` : ''),
  );
}
