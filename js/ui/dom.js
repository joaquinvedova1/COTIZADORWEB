/**
 * Helpers de DOM seguros.
 *
 * Reglas de seguridad:
 * - Nunca se usa innerHTML con datos de usuario: el texto se inserta como
 *   nodos de texto (textContent).
 * - No se usa eval() ni new Function().
 * - Los atributos de evento (on*) no se pueden setear como string.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      if (cls) el.setAttribute('class', cls);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        if (typeof handler === 'function') el.addEventListener(event, handler);
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) el.dataset[k] = String(v);
      }
    } else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) el.style.setProperty(k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(v));
      }
    } else if (/^on/i.test(key)) {
      throw new Error(`Usá la propiedad "on" para eventos (recibido "${key}").`);
    } else if (key === 'value' && 'value' in el) {
      el.value = String(value);
    } else if (key === 'checked' && 'checked' in el) {
      el.checked = Boolean(value);
    } else if (key === 'selected' && 'selected' in el) {
      el.selected = Boolean(value);
    } else if (key === 'disabled' && 'disabled' in el) {
      el.disabled = Boolean(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

/**
 * Crea un elemento HTML.
 *   h('div', { class: 'card', on: { click: fn } }, 'texto', otroNodo)
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** Crea un elemento SVG (sólo para gráficos e íconos internos). */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (/^on/i.test(k)) throw new Error('No se permiten atributos de evento en SVG.');
    else el.setAttribute(k, String(v));
  }
  appendChildren(el, children);
  return el;
}

/** Vacía un nodo. */
export function clear(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Reemplaza el contenido de un nodo. */
export function mount(el, ...children) {
  clear(el);
  appendChildren(el, children);
  return el;
}

/** Fragmento con varios hijos. */
export function fragment(...children) {
  const f = document.createDocumentFragment();
  appendChildren(f, children);
  return f;
}

/** Debounce simple. */
export function debounce(fn, wait = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

let idCounter = 0;
/** Id único para asociar label/input. */
export function uniqueId(prefix = 'f') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Descarga un texto como archivo (sin servidores externos). */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, class: 'sr-only' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lee un archivo de texto elegido por el usuario. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}
