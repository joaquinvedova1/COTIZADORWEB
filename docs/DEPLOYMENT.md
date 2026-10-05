# Despliegue, versiones y rollback

RATEOS se publica como sitio estático en **GitHub Pages**:

- Sitio productivo: <https://joaquinvedova1.github.io/COTIZADORWEB/> (sub-ruta `/COTIZADORWEB/`, nunca la raíz `/`).
- Repositorio: `joaquinvedova1/COTIZADORWEB`. Rama productiva: `main` (**main = producción**).

## 1. Flujo

```
rama de trabajo ──► npm test ──► Pull Request ──► review ──► merge a main
                                                                │
                                         "Deploy RATEOS a GitHub Pages"
                                         test ──► build ──► deploy
                                                                │
                                                     nueva versión online
```

- Nunca se hace push directo ni **force push** a `main`.
- Si los tests fallan, **no se despliega**.
- El historial vive en Git: no se crean carpetas `version1/`, `version2/`. Los cambios se registran en [CHANGELOG.md](../CHANGELOG.md).

## 2. Workflows de GitHub Actions

### `.github/workflows/deploy-pages.yml` — "Deploy RATEOS a GitHub Pages"

Pages publica **un artefacto por deploy**, así que cada corrida arma el sitio completo:

| URL | Qué se publica |
|---|---|
| <https://joaquinvedova1.github.io/COTIZADORWEB/> (**producción**) | siempre `main` (o, en un rollback manual, un commit o tag que ya está en `main`) |
| <https://joaquinvedova1.github.io/COTIZADORWEB/preview/> (**staging**) | la rama de desarrollo, con la franja **"RATEOS · STAGING · rama … · build …"**, `noindex` y "[STAGING]" en el título |

| Disparador | Producción | Staging (`/preview/`) |
|---|---|---|
| `push` a `main` | el commit recién mergeado | la rama que ya estaba publicada en `/preview/` (se lee de `preview/version.json`); si esa rama ya no existe, una página "No hay un preview publicado" |
| CI terminó **en verde** en un **push** a una rama de este repo (`workflow_run`; nunca forks, `main` ni `dependabot/**`) | `main` actual (sin cambios) | **esa rama**, en el commit exacto que pasó CI |
| `workflow_dispatch` (manual, desde `main`) | input `ref`: SHA o tag **ya mergeado en `main`** (rollback); vacío = `main` actual | input `preview_ref`: rama a publicar; vacío = la publicada hoy; `none` = sin preview. También acepta la variable de repositorio `PREVIEW_BRANCH` |

**Un deploy de preview nunca reemplaza producción:**
- `workflow_run` ejecuta siempre la definición del workflow que está en `main`: una rama no puede cambiar cómo se despliega.
- La raíz se construye sólo con un commit que es ancestro de `origin/main` (`git merge-base --is-ancestor`) y pasó `npm test`.
- `scripts/stage-preview.mjs` (tomado siempre de `origin/main`) copia el build de la rama a `dist/preview/`, agrega la marca de staging y **falla si cambia cualquier archivo de producción** (hash de todo lo que no es `preview/` antes y después).

Jobs:

1. **plan**: decide qué se publica.
   - Valida el formato de `ref` y `preview_ref` (letras, números, `.`, `_`, `/`, `-`; se pasan por variables de entorno, nunca interpolados).
   - Rechaza `main` como rama de preview.
2. **test** (producción): checkout del commit de `main` → verifica que no haya dependencias npm → `npm test`.
3. **preview** (sólo si hay rama): checkout del commit de la rama **con permisos de sólo lectura y sin credenciales** → `npm test` → `npm run build` → sube el build como artefacto temporal.
4. **build**: checkout del commit de producción → `npm run build` → `dist/` y `dist/version.json`:
   ```json
   { "version": "0.1.0", "commit": "abc1234", "buildDate": "2026-10-03T15:04:05.123Z", "ref": "main", "build": { "base": "build/abc1234/", ... } }
   ```
   Después arma `dist/preview/` con `stage-preview.mjs`. El `version.json` del preview agrega `"channel": "staging"` y `"branch"`.
5. **deploy**: publica `dist/` con `actions/deploy-pages` y deja un resumen (producción, staging, URL).

Si fallan los tests de producción, no se publica nada. Si fallan los del preview:
- en un push a `main`, producción se publica igual y `/preview/` explica que la rama no pasó los tests;
- en un deploy de preview, no se publica nada (queda el sitio anterior).

Permisos mínimos **por job** (no usa secretos, sólo el `GITHUB_TOKEN` y el token OIDC que provee GitHub):

| Nivel | Permisos | Por qué |
|---|---|---|
| Workflow (por defecto: **plan**, **test**, **preview**) | `contents: read` | checkout y tests: el código (de `main` o de una rama) nunca recibe permisos de Pages ni OIDC |
| Job **build** | `contents: read`, `pages: read` | `actions/configure-pages` sólo lee la configuración de Pages; `upload-pages-artifact` no usa el token |
| Job **deploy** | `pages: write`, `id-token: write` | sólo `actions/deploy-pages` publica (no hace checkout ni ejecuta código del repo) |

Concurrencia `pages` **en el job deploy** (no en todo el workflow):
- un despliegue a la vez, nunca se cancela uno en curso;
- si se acumulan varios, se publica el más nuevo (cada corrida publica `main` actual en la raíz);
- a nivel workflow, el CI de `pull_request` de la misma rama (que después se saltea) cancelaba el deploy pendiente del preview.

Si un preview no llegó a publicarse, volvé a empujar la rama o usá **Run workflow** con `preview_ref`.

**Staging comparte origen con producción** (`joaquinvedova1.github.io`): mismo `localStorage` y, con cuentas, el **mismo proyecto de Supabase**.
- Probá el preview con una cuenta de prueba.
- **Staging comparte la base de datos con producción** (mismo proyecto de Supabase). Si la rama sube el esquema de datos (por ejemplo v2 → v3), la app de `/preview/` (que lee `"channel": "staging"` de su `version.json`) **pregunta antes** de actualizar el formato de los datos de la cuenta: "Versión de prueba: ¿actualizar el formato de tus datos?". Con "Ver sin cambiar (sólo lectura)" no escribe nada. Una cuenta **nueva** también pregunta antes de crear su espacio ("Versión de prueba: ¿usar esta cuenta acá?"). Si se actualizan, producción (con el esquema anterior) abrirá esa cuenta en **sólo lectura** hasta que se mergee la versión nueva: usá una cuenta de prueba. Lo mismo vale para `npm start` (localhost), que también usa el proyecto de producción.
- Nunca publiques en `/preview/` código que no confiarías en producción. Por eso sólo se aceptan ramas de este repositorio, nunca forks.
- Un rollback manual de producción dura hasta el próximo deploy (también uno de preview, que vuelve a publicar `main`). El rollback preferido sigue siendo `git revert` por PR (§5).

### `.github/workflows/ci.yml` — "CI"

Corre `npm test` y `npm run build` en cada **pull request** y en cada push a ramas que **no** son `main`, y verifica que `dist/` tenga `index.html`, `version.json` y `.nojekyll` y no incluya `tests`, `docs`, `scripts`, `.github` ni `package.json`. No despliega. Es la verificación que debe estar en verde antes de mergear.

### `.github/dependabot.yml`

Sólo para el ecosistema `github-actions` (mantiene actualizadas las versiones de las actions de los workflows). RATEOS no tiene dependencias npm, así que no hay configuración para npm.

## 3. Configuración única de GitHub Pages (pasar a "GitHub Actions")

**Hecho** (Source = "GitHub Actions"). Antes el repositorio publicaba con **"Deploy from a branch"**. En ese modo Pages sirve la raíz de `main` **sin pasar por los tests**. El sitio igual funciona porque todas las rutas son relativas y el repo incluye `.nojekyll`, pero no hay garantía de calidad ni `version.json` del build.

**Es obligatorio pasar a "GitHub Actions"**: mientras siga "Deploy from a branch", cada push a `main` dispara **dos** deploys que compiten ("pages build and deployment", que publica la raíz del repo, y "Deploy RATEOS a GitHub Pages", que publica `dist/`) y queda publicado el que termina último. Si gana el de la rama se publica el código **sin carpetas versionadas** (sin cache busting, ver §4.1) y "Acerca de" dice `build dev`.

Paso a paso (lo hace una persona con permisos de administración del repositorio, una sola vez):

1. Ir a **GitHub → repositorio `COTIZADORWEB` → Settings → Pages**.
2. En **Build and deployment → Source**, elegir **"GitHub Actions"** (en lugar de "Deploy from a branch").
3. No hace falta elegir ningún workflow sugerido: el repo ya tiene `.github/workflows/deploy-pages.yml`.
4. Ir a **Actions → "Deploy RATEOS a GitHub Pages" → Run workflow** (branch `main`, `ref` vacío) para hacer el primer deploy, o mergear un PR a `main`.
5. Verificar el sitio (ver §4).

Al elegir "GitHub Actions", GitHub crea el environment **`github-pages`** que, por defecto, sólo acepta deployments de runs que corren desde la rama por defecto (`main`). Dejarlo así: evita que se ejecute el job **deploy** desde una rama de trabajo (con un workflow modificado en esa rama). Esa regla mira la rama desde la que corre el run, no el código que se publica: por eso el workflow, además, sólo acepta como `ref` commits o tags que ya están en `main` (§2). Así el rollback manual (§5) se ejecuta siempre con branch `main` y el `ref` como input, y nunca puede publicar una rama sin PR.

## 4. Verificación después de cada deploy

1. **Actions**: el run de "Deploy RATEOS a GitHub Pages" terminó en verde (test, build y deploy).
2. Abrir <https://joaquinvedova1.github.io/COTIZADORWEB/> (no hace falta recarga forzada: ver §4.1). `#/` muestra la landing.
3. Ir a **Configuración → Acerca de** y confirmar que muestra `RATEOS · v0.1.0 · build abc1234`, donde `abc1234` es el SHA corto del commit desplegado, la fecha de build y la "Referencia" (`main`, o el `ref` pedido en un despliegue manual).
4. Prueba de humo: `#/inicio` abre la app (menú Inicio / Cotizaciones / Recursos / Servicios / Escenarios / Configuración); abrir la cotización demo "Hidrogrúa on-call — Añelo" y el paso Resultado; "Ver cálculo" abre la traza; la consola del navegador no muestra errores. En las herramientas de red, los JS y CSS se piden desde `build/abc1234/`.
5. Los datos existentes del usuario siguen ahí (ver §7).

### 4.1 Caché y carpetas versionadas (cache busting)

GitHub Pages sirve **todos** los archivos con `Cache-Control: max-age=600` y no permite cambiar los headers. Antes, los JS y CSS tenían siempre la misma URL (`./js/app.js`, `./js/ui/layout.js`…): después de un deploy, un navegador que había entrado en los 10 minutos previos reusaba el `index.html` y los módulos de su caché, cada uno con su propio vencimiento, y las vistas que se cargan con `import()` dinámico podían salir de otro build. Resultado: interfaz vieja o mezclada aunque "Acerca de" (que pide `version.json` sin caché) mostrara el build nuevo. Una recarga normal no lo arreglaba (sólo revalida el HTML); hacía falta Ctrl+Shift+R.

Ahora (`scripts/build.mjs`):

```
dist/
  index.html              carga sólo ./boot.js (sin CSS ni app.js directos)
  boot.js                 cargador estable: pide version.json SIN caché y carga ese build
  version.json            { version, commit, buildDate, ref, build: { base, entry, styles } }
  build/<sha corto>/js/…  todos los módulos (imports relativos: el grafo entero sale de acá)
  build/<sha corto>/css/… todos los CSS
  build/<sha corto>/assets/…
  js/app.js               shim de transición para index.html viejos en caché (recarga)
```

- Cada deploy publica sus JS, CSS y assets en una carpeta nueva: **ninguna URL cambia de contenido** y el navegador nunca puede combinar módulos de dos builds.
- Aunque el navegador tenga en caché un `index.html` o un `boot.js` anteriores, la carpeta a cargar sale de `version.json`, que `boot.js` pide con `cache: 'no-store'`.
- Cada deploy reemplaza el sitio entero, así que la carpeta del build anterior deja de existir. Una pestaña que quedó abierta durante el deploy y abre una pantalla que todavía no había cargado ve "Esta pantalla no se pudo cargar… recargá la página" con el botón **Recargar la página**, que trae el build nuevo completo.
- `npm run build` falla si `index.html` publicado referencia JS/CSS sin versionar, si un import de `build/<sha>/` sale de su carpeta o si el manifiesto apunta a archivos que no existen.
- En desarrollo (`npm start`) no hay carpetas versionadas: `index.html` carga `./js/app.js` directo y el servidor local responde con `no-store`.

Si el sitio se sirve sin build (`npm start` o "Deploy from a branch"), "Acerca de" muestra el `version.json` de desarrollo de la raíz del repo: `RATEOS · v0.1.0 · build dev`, "Sin fecha (versión local)" y referencia `local`. Si `version.json` no se puede leer, muestra `RATEOS · vdev · build local`.

## 5. Rollback

### Método 1 (preferido): `git revert` vía Pull Request

Deja el historial limpio y `main` vuelve a coincidir con producción.

```bash
git checkout main && git pull
git checkout -b revert/<descripcion-corta>
git revert <sha-del-commit-problematico>      # para un merge commit: git revert -m 1 <sha>
npm test
git push -u origin revert/<descripcion-corta>
```

Abrir el Pull Request hacia `main`, esperar CI en verde y mergear. El push a `main` dispara el deploy automático de la versión corregida.

### Método 2 (rápido): redeploy manual de una versión anterior que ya está en `main`

Para restaurar producción en minutos mientras se prepara el revert. Sólo sirve para volver a una versión que **ya estuvo en `main`** (un commit anterior de `main` o un tag `v*` creado sobre un commit de `main`):

1. Elegir la versión buena: en GitHub, **Code → Commits** (rama `main`) o **Tags**, o localmente:
   ```bash
   git fetch origin --tags
   git log --oneline origin/main            # SHAs de main, del más nuevo al más viejo
   git merge-base --is-ancestor <sha-o-tag> origin/main && echo "está en main"
   ```
2. **Actions → "Deploy RATEOS a GitHub Pages" → Run workflow**.
3. **Branch: `main`** (siempre; el environment `github-pages` rechaza otras ramas).
4. `ref`: el tag de la última versión buena (por ejemplo `v0.1.0`) o el SHA (corto o completo) de ese commit de `main`. Si el `ref` apunta a un commit que no está en `main` (por ejemplo, una rama sin mergear), el job test falla con "no está en main" y no se despliega nada.
5. **Run workflow**. Se ejecutan test → build → deploy sobre ese commit (con los tests y el build de esa versión).
6. Verificar en **Configuración → Acerca de** que el build (SHA corto) y la referencia corresponden a la versión elegida.

Importante: `main` **no cambia**. El próximo push a `main` (o un run manual con `ref` vacío) vuelve a desplegar la punta de `main`, con el problema incluido; por eso, después del método 2, hay que aplicar el método 1 (revert vía PR) o un fix antes de mergear otra cosa.

Si el arreglo que se necesita **no está en `main`** (por ejemplo, un fix en una rama), no se puede desplegar con el método 2: hay que abrir un Pull Request, esperar CI en verde y mergearlo (método 1).

Nunca: force push a `main`, borrar commits publicados ni subir archivos a mano al sitio.

## 6. Tags y versiones

- SemVer `v0.x.x`, **sólo para hitos** (no para cada commit). La versión visible sale de `package.json`.
- `v0.1.0` = este MVP. Crearlo **después** del merge a `main`, sobre el commit mergeado:
  ```bash
  git checkout main && git pull
  git tag -a v0.1.0 -m "RATEOS v0.1.0 — MVP funcional"
  git push origin v0.1.0
  ```
- Para un hito nuevo: actualizar `version` en `package.json` y la sección del [CHANGELOG.md](../CHANGELOG.md) en el mismo PR; después del merge, crear el tag.
- Los tags son el punto de retorno natural del rollback (método 2).

## 7. Qué pasa con los datos de los usuarios en cada deploy

- Los datos viven en el **navegador de cada usuario** (`localStorage` del origen `https://joaquinvedova1.github.io`), no en GitHub. Un deploy no los toca.
- La clave `rateos.state` **no depende de la versión** de la app: sobrevive a recargas, cierres del navegador y nuevos deploys.
- Si una versión nueva cambia el formato (`SCHEMA_VERSION`), la app **migra** al abrir (`migrateState`), guardando antes una copia `rateos.recovery.<fecha>.pre-migration-v<N>`. Nunca se borra nada por un cambio de estructura y nunca se usa `localStorage.clear()`.
- Rollback a una versión **más vieja** que los datos: la app detecta un `schemaVersion` mayor al que conoce y abre en **modo sólo lectura** para no pisar los datos. Por eso, un cambio de esquema exige cuidado especial con el rollback (preferir el método 1 con una corrección hacia adelante).
- Pestañas abiertas durante un deploy: si una pestaña con la versión anterior sigue abierta mientras otra (ya actualizada) migró los datos a un esquema más nuevo, la pestaña vieja los adopta en **modo sólo lectura** en lugar de pisarlos; al recargarla toma la versión nueva.
- El origen `joaquinvedova1.github.io` es compartido por todos los sitios de Pages de esa cuenta: las claves llevan prefijo `rateos.` para no chocar, y no se debe publicar en esa cuenta ningún sitio no confiable (ver [AGENTS.md](../AGENTS.md)).
- Cada usuario puede **exportar un backup JSON** desde Configuración → Backup y volver a importarlo (con validación y confirmación).

## 8. Ejecución y build locales

```bash
npm test        # node --test (Node >= 20, sin dependencias)
npm start       # http://localhost:8080/COTIZADORWEB/ (simula la sub-ruta de Pages)
npm run build   # genera dist/ igual que en Actions
npm start -- --dist   # sirve dist/ (correr antes npm run build)
```

Variables opcionales de `npm start`: `PORT` (por defecto 8080) y `HOST` (por defecto `127.0.0.1`). El servidor local sólo acepta GET/HEAD, bloquea path traversal y no sirve dotfiles.

También funciona con cualquier servidor estático (por ejemplo `python3 -m http.server 8080` desde la raíz del repo → `http://localhost:8080/`). **No funciona con `file://`** (los ES modules necesitan HTTP).

## 9. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| 404 en `https://joaquinvedova1.github.io/COTIZADORWEB/` | Pages deshabilitado, primer deploy pendiente o Source mal configurado | Settings → Pages: Source = "GitHub Actions"; correr el workflow manualmente; esperar 1–2 minutos. |
| El job **deploy** falla con error de Pages o de permisos | Source todavía en "Deploy from a branch", o se ejecutó "Run workflow" desde una rama que no es `main` (el environment `github-pages` la rechaza) | Cambiar Source a "GitHub Actions" (§3); ejecutar siempre con branch `main` y usar el input `ref`. |
| La página carga pero sin estilos o con 404 de `/js/...` | Alguna ruta absoluta (`/js/app.js`, `/css/...`) | Usar siempre rutas relativas (`./js/app.js`, `../core/x.js`) en HTML, CSS e imports; probar con `npm start` bajo `/COTIZADORWEB/`. |
| Pantalla "Cargando RATEOS…" que no avanza | Error de JavaScript o módulo que no carga | Abrir la consola; correr `npm test`; probar con `npm start` en `/COTIZADORWEB/`. |
| Se sigue viendo la versión anterior o una mezcla (p. ej. menú viejo con "Acerca de" nuevo) | Se publicó el código sin build (ganó "Deploy from a branch", ver §3) o el navegador tiene un `index.html` de antes de las carpetas versionadas (hasta 10 minutos, una sola vez) | Pasar Source a "GitHub Actions"; en la pestaña de red, los JS deben venir de `build/<sha>/`. Con el build versionado no hace falta recarga forzada (§4.1). |
| "Acerca de" muestra `build dev` en producción | Pages sigue en "Deploy from a branch" (sirve el `version.json` de desarrollo, no corre el build) | Pasar Source a "GitHub Actions". |
| El sitio no refleja un merge | El workflow no corrió o falló en test | Revisar Actions; si falló test, corregir en una rama y abrir un PR. |
| Run manual falla con "Ref inválida" o "No se encontró el commit" | El `ref` tiene caracteres no permitidos o no existe en el repo | Usar un SHA (corto o completo) o un tag existente (`v0.1.0`) de un commit de `main`. |
| Run manual falla con "'<ref>' no está en main" | El `ref` pedido (SHA, tag o rama) apunta a un commit que no está en `main` (código sin PR) | Elegir un commit o tag de `main` (`git log --oneline origin/main`); para publicar código nuevo, mergearlo a `main` vía Pull Request. |
| `npm run build` falla | Ruta absoluta, import inexistente o falta un archivo publicado | Leer el error (archivo y línea) que imprime el build y corregir la ruta. |
| Al abrir `index.html` con doble clic (`file://`) no carga nada | Los navegadores bloquean ES modules en `file://` | Usar `npm start` o cualquier servidor HTTP. |
| Usuario con "Modo sólo lectura" | Sus datos son de una versión más nueva que la desplegada (rollback) | Volver a desplegar la versión más nueva o exportar backup desde esa versión. |

## 10. CodeQL (más adelante)

No es necesario para el MVP (no hay backend ni dependencias), pero el código está preparado: JavaScript plano, sin `eval`/`new Function`/`innerHTML`, imports estáticos y relativos. Para activarlo sin workflows propios:

1. **Settings → Code security** (o "Code security and analysis").
2. En **Code scanning → CodeQL analysis**, elegir **Set up → Default**.
3. Lenguaje: JavaScript/TypeScript; disparadores por defecto (push a `main`, pull requests, semanal).
4. Revisar las alertas en **Security → Code scanning** y tratarlas como cualquier bug (rama → fix → PR).
