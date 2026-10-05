/**
 * RATEOS — cargador del build publicado (GitHub Pages).
 *
 * Por qué existe: GitHub Pages sirve todos los archivos con caché del
 * navegador (Cache-Control: max-age=600) y sin poder cambiar los headers.
 * Si los módulos JS y los CSS tuvieran siempre la misma URL, después de un
 * deploy el navegador podría combinar módulos nuevos con módulos viejos
 * todavía en caché (cada uno vence por su lado; las vistas se cargan con
 * import() dinámico y pueden venir de builds distintos).
 *
 * Cómo lo evita: el build publica cada versión en su propia carpeta
 * (build/<commit>/js, build/<commit>/css) y escribe en version.json cuál es
 * la actual. Este archivo pide version.json SIN caché y recién ahí carga
 * los CSS y el app.js de esa carpeta. Los imports internos son relativos,
 * así que todo el grafo de módulos sale de la misma carpeta: o se carga un
 * build completo o, si un archivo no existe, falla, pero nunca se mezcla.
 * Aunque el navegador tenga un index.html o un boot.js viejos en caché,
 * la carpeta a cargar sale siempre de version.json recién pedido.
 *
 * Sólo lo usa dist/index.html (generado por scripts/build.mjs). En
 * desarrollo (npm start) index.html carga ./js/app.js directo.
 *
 * Contrato estable (no depende del build): version.json.build =
 *   { base: "build/<id>/", entry: "js/app.js", styles: ["css/…", …] }
 * con respaldo en <meta name="rateos-build" content="build/<id>/"
 * data-entry="…" data-styles="… …"> si version.json no se puede leer.
 */

const BASE_RE = /^build\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}\/$/;
const FILE_RE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css)$/;

/** Manifiesto válido o null (rutas relativas dentro de build/<id>/, sin "..", sólo .js y .css). */
function readManifest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { base, entry, styles } = raw;
  if (typeof base !== 'string' || !BASE_RE.test(base)) return null;
  if (typeof entry !== 'string' || !FILE_RE.test(entry) || !entry.endsWith('.js')) return null;
  if (!Array.isArray(styles) || !styles.every((s) => typeof s === 'string' && FILE_RE.test(s) && s.endsWith('.css'))) return null;
  return { base, entry, styles };
}

async function manifestFromVersionJson() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return readManifest(data && data.build);
  } catch {
    return null;
  }
}

function manifestFromHtml() {
  const meta = document.querySelector('meta[name="rateos-build"]');
  if (!meta) return null;
  const styles = String(meta.dataset.styles || '').split(/\s+/).filter(Boolean);
  return readManifest({ base: meta.getAttribute('content'), entry: meta.dataset.entry, styles });
}

function loadStyle(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    // Un CSS que no carga no impide abrir la aplicación.
    link.addEventListener('load', () => resolve(true));
    link.addEventListener('error', () => resolve(false));
    document.head.appendChild(link);
  });
}

function showLoadError(root) {
  if (!root) return;
  root.hidden = false;
  root.removeAttribute('aria-busy');
  const box = document.createElement('div');
  box.className = 'boot-card';
  box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = 'No se pudo cargar RATEOS. Puede que estés sin conexión o que se haya publicado una versión nueva.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Recargar';
  retry.addEventListener('click', () => window.location.reload());
  box.append(text, retry);
  root.replaceChildren(box);
}

async function start() {
  const root = document.getElementById('app');
  const manifest = (await manifestFromVersionJson()) || manifestFromHtml();
  if (!manifest) {
    showLoadError(root);
    return;
  }
  await Promise.all(manifest.styles.map((s) => loadStyle(`./${manifest.base}${s}`)));
  if (root) root.hidden = false;
  try {
    await import(`./${manifest.base}${manifest.entry}`);
  } catch {
    showLoadError(root);
  }
}

start();
