/**
 * RATEOS — servidor estático local, sin dependencias (node:http).
 *
 * Simula GitHub Pages: el sitio se sirve bajo el prefijo /COTIZADORWEB/,
 * igual que en https://joaquinvedova1.github.io/COTIZADORWEB/, para detectar
 * rutas absolutas ("/js/…") que funcionarían en "/" pero no en producción.
 *
 *   npm start                  → sirve la raíz del repo
 *   npm start -- --dist        → sirve dist/ (ejecutar antes npm run build)
 *   PORT=9000 npm start        → otro puerto (por defecto 8080)
 *   HOST=0.0.0.0 npm start     → escuchar en todas las interfaces (por defecto 127.0.0.1)
 *
 * Seguridad (aunque es sólo para desarrollo):
 *  - sólo GET/HEAD;
 *  - bloquea path traversal (la ruta resuelta debe quedar dentro de la raíz,
 *    también después de resolver enlaces simbólicos);
 *  - no sirve dotfiles (.git, .env, …) salvo .nojekyll, ni node_modules;
 *  - sin listado de directorios.
 */

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_PATH = '/COTIZADORWEB/';

export const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});

const ALLOWED_DOTFILES = new Set(['.nojekyll']);
const BLOCKED_SEGMENTS = new Set(['node_modules']);

/** Tipo de contenido por extensión (.nojekyll y desconocidos → text/plain u octet-stream). */
export function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (CONTENT_TYPES[ext]) return CONTENT_TYPES[ext];
  if (path.basename(filePath) === '.nojekyll') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function isInsideOrEqual(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Traduce la ruta pedida (relativa al prefijo, ya sin él) a un archivo dentro
 * de `root`. Devuelve null si la ruta es inválida, sale de la raíz o apunta a
 * un dotfile/directorio bloqueado.
 */
export function resolveSafePath(root, relativeUrlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativeUrlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter((seg) => seg !== '');
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return null;
    if (seg.startsWith('.') && !ALLOWED_DOTFILES.has(seg)) return null;
    if (BLOCKED_SEGMENTS.has(seg)) return null;
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (!isInsideOrEqual(resolvedRoot, target)) return null;
  return target;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

function redirect(res, location) {
  send(res, 302, `Redirigiendo a ${location}\n`, { Location: location });
}

/**
 * Crea (sin escuchar) el servidor estático.
 * @param {{root?: string, basePath?: string, log?: (line: string) => void}} [options]
 */
export function createStaticServer({ root = ROOT_DIR, basePath = BASE_PATH, log = () => {} } = {}) {
  const resolvedRoot = path.resolve(root);
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const prefixNoSlash = prefix.slice(0, -1);
  let realRootPromise = null;
  const realRoot = () => {
    realRootPromise = realRootPromise || realpath(resolvedRoot);
    return realRootPromise;
  };

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Método no permitido\n', { Allow: 'GET, HEAD' });
        return;
      }
      const rawPath = String(req.url || '/').split('?')[0].split('#')[0];

      if (rawPath === '/' || rawPath === '' || rawPath === prefixNoSlash) {
        redirect(res, prefix);
        return;
      }
      if (!rawPath.startsWith(prefix)) {
        send(res, 404, `404 — No encontrado. El sitio se sirve bajo ${prefix}\n`);
        return;
      }

      const relative = rawPath.slice(prefix.length);
      const target = resolveSafePath(resolvedRoot, relative);
      if (!target) {
        send(res, 404, '404 — No encontrado\n');
        return;
      }

      let filePath = target;
      let info;
      try {
        info = await stat(filePath);
      } catch {
        send(res, 404, '404 — No encontrado\n');
        return;
      }
      if (info.isDirectory()) {
        if (!rawPath.endsWith('/')) {
          redirect(res, `${rawPath}/`);
          return;
        }
        filePath = path.join(filePath, 'index.html');
        try {
          info = await stat(filePath);
        } catch {
          send(res, 404, '404 — No encontrado\n');
          return;
        }
      }
      if (!info.isFile()) {
        send(res, 404, '404 — No encontrado\n');
        return;
      }

      // Los enlaces simbólicos tampoco pueden sacar al cliente de la raíz.
      const [realFile, rootReal] = await Promise.all([realpath(filePath), realRoot()]);
      if (!isInsideOrEqual(rootReal, realFile)) {
        send(res, 404, '404 — No encontrado\n');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(filePath);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (error) {
      log(`Error sirviendo ${req.url}: ${error && error.message}`);
      if (!res.headersSent) send(res, 500, 'Error interno\n');
      else res.destroy();
    }
  });
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const useDist = process.argv.slice(2).includes('--dist');
  const root = useDist ? path.join(ROOT_DIR, 'dist') : ROOT_DIR;
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST || '127.0.0.1';

  let rootOk = false;
  try {
    rootOk = (await stat(root)).isDirectory();
  } catch {
    rootOk = false;
  }
  if (!rootOk) {
    process.stderr.write(`No existe ${root}. ${useDist ? 'Ejecutá primero: npm run build' : ''}\n`);
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`PORT inválido: ${process.env.PORT}\n`);
    process.exit(1);
  }

  const server = createStaticServer({ root, log: (line) => process.stderr.write(`${line}\n`) });
  server.on('error', (error) => {
    process.stderr.write(`No se pudo iniciar el servidor: ${error.message}\n`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const shownHost = ['0.0.0.0', '::', '127.0.0.1', '::1'].includes(host) ? 'localhost' : host;
    const actualPort = server.address().port;
    process.stdout.write(`RATEOS (${useDist ? 'dist/' : 'repo'}) en http://${shownHost}:${actualPort}${BASE_PATH}  — Ctrl+C para detener\n`);
  });
}
