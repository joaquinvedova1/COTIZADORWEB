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

| Disparador | Qué despliega |
|---|---|
| `push` a `main` | el commit recién mergeado |
| `workflow_dispatch` (manual) | input opcional `ref`: SHA, tag o branch a desplegar; vacío = commit actual de la rama elegida |

Jobs (en cadena; si uno falla, los siguientes no corren):

1. **test**: checkout con historial completo → resuelve el `ref` pedido (SHA corto o completo, tag o branch; se valida el formato para evitar inyección) → verifica que `package.json` no declare dependencias → `npm test` (Node 22 en Actions; el proyecto requiere Node ≥ 20).
2. **build**: checkout del **mismo commit** que pasó los tests → `npm run build` → genera `dist/` (sólo `index.html`, `.nojekyll`, `assets/`, `css/`, `js/`; valida que todas las rutas sean relativas y existan) y `dist/version.json`:
   ```json
   { "version": "0.1.0", "commit": "abc1234", "buildDate": "2026-10-03T15:04:05.123Z", "ref": "main" }
   ```
   `version` sale de `package.json`, `commit` es el SHA corto (7 caracteres), `buildDate` la fecha ISO en UTC y `ref` lo que se pidió desplegar (o la rama).
3. **deploy**: publica el artefacto de `dist/` con `actions/deploy-pages` en el environment `github-pages` y deja un resumen (versión, commit, ref, fecha, URL) en la página del run.

Permisos del workflow: `contents: read`, `pages: write`, `id-token: write` (los mínimos que exige Pages; no usa secretos). Concurrencia `pages`: un despliegue a la vez, nunca se cancela uno en curso.

### `.github/workflows/ci.yml` — "CI"

Corre `npm test` y `npm run build` en cada **pull request** y en cada push a ramas que **no** son `main`, y verifica que `dist/` tenga `index.html`, `version.json` y `.nojekyll` y no incluya `tests`, `docs`, `scripts`, `.github` ni `package.json`. No despliega. Es la verificación que debe estar en verde antes de mergear.

### `.github/dependabot.yml`

Sólo para el ecosistema `github-actions` (mantiene actualizadas las versiones de las actions de los workflows). RATEOS no tiene dependencias npm, así que no hay configuración para npm.

## 3. Configuración única de GitHub Pages (pasar a "GitHub Actions")

Hoy el repositorio publica con **"Deploy from a branch"**. En ese modo Pages sirve la raíz de `main` **sin pasar por los tests**. El sitio igual funciona porque todas las rutas son relativas y el repo incluye `.nojekyll`, pero no hay garantía de calidad ni `version.json` del build.

Paso a paso (lo hace una persona con permisos de administración del repositorio, una sola vez):

1. Ir a **GitHub → repositorio `COTIZADORWEB` → Settings → Pages**.
2. En **Build and deployment → Source**, elegir **"GitHub Actions"** (en lugar de "Deploy from a branch").
3. No hace falta elegir ningún workflow sugerido: el repo ya tiene `.github/workflows/deploy-pages.yml`.
4. Ir a **Actions → "Deploy RATEOS a GitHub Pages" → Run workflow** (branch `main`, `ref` vacío) para hacer el primer deploy, o mergear un PR a `main`.
5. Verificar el sitio (ver §4).

Al elegir "GitHub Actions", GitHub crea el environment **`github-pages`** que, por defecto, sólo acepta deployments desde la rama por defecto (`main`). Dejarlo así: protege producción de despliegues desde ramas de trabajo. Por eso el rollback manual (§5) se ejecuta siempre con branch `main` y el `ref` como input.

## 4. Verificación después de cada deploy

1. **Actions**: el run de "Deploy RATEOS a GitHub Pages" terminó en verde (test, build y deploy).
2. Abrir <https://joaquinvedova1.github.io/COTIZADORWEB/> (recarga forzada: Ctrl+Shift+R / Cmd+Shift+R).
3. Ir a **Configuración → Acerca de** y confirmar que muestra `RATEOS · v0.1.0 · build abc1234`, donde `abc1234` es el SHA corto del commit desplegado, la fecha de build y la "Referencia" (`main`, o el `ref` pedido en un despliegue manual).
4. Prueba de humo: Dashboard carga; abrir la cotización demo "Hidrogrúa on-call — Añelo" y el paso Resultado; "Ver cálculo" abre la traza; la consola del navegador no muestra errores.
5. Los datos existentes del usuario siguen ahí (ver §7).

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

### Método 2 (rápido): redeploy manual de una versión anterior

Para restaurar producción en minutos mientras se prepara el revert:

1. **Actions → "Deploy RATEOS a GitHub Pages" → Run workflow**.
2. Branch: `main`.
3. `ref`: el tag de la última versión buena (por ejemplo `v0.1.0`) o el SHA del commit anterior.
4. **Run workflow**. Se ejecutan test → build → deploy sobre ese `ref`.
5. Verificar en **Configuración → Acerca de** que el build y la referencia corresponden a la versión elegida.

Importante: `main` **no cambia**. El próximo push a `main` vuelve a desplegar `main`; por eso, después del método 2, hay que aplicar el método 1 (o un fix) antes de mergear otra cosa.

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
| Se sigue viendo la versión anterior | Caché del navegador o de la CDN de Pages | Recarga forzada; esperar unos minutos; confirmar el build en Configuración → Acerca de. |
| "Acerca de" muestra `build dev` en producción | Pages sigue en "Deploy from a branch" (sirve el `version.json` de desarrollo, no corre el build) | Pasar Source a "GitHub Actions". |
| El sitio no refleja un merge | El workflow no corrió o falló en test | Revisar Actions; si falló test, corregir en una rama y abrir un PR. |
| Run manual falla con "Ref inválida" o "No se encontró el commit" | El `ref` tiene caracteres no permitidos o no existe en el repo | Usar un SHA (corto o completo), un tag existente (`v0.1.0`) o un branch. |
| `npm run build` falla | Ruta absoluta, import inexistente o falta un archivo publicado | Leer el error (archivo y línea) que imprime el build y corregir la ruta. |
| Al abrir `index.html` con doble clic (`file://`) no carga nada | Los navegadores bloquean ES modules en `file://` | Usar `npm start` o cualquier servidor HTTP. |
| Usuario con "Modo sólo lectura" | Sus datos son de una versión más nueva que la desplegada (rollback) | Volver a desplegar la versión más nueva o exportar backup desde esa versión. |

## 10. CodeQL (más adelante)

No es necesario para el MVP (no hay backend ni dependencias), pero el código está preparado: JavaScript plano, sin `eval`/`new Function`/`innerHTML`, imports estáticos y relativos. Para activarlo sin workflows propios:

1. **Settings → Code security** (o "Code security and analysis").
2. En **Code scanning → CodeQL analysis**, elegir **Set up → Default**.
3. Lenguaje: JavaScript/TypeScript; disparadores por defecto (push a `main`, pull requests, semanal).
4. Revisar las alertas en **Security → Code scanning** y tratarlas como cualquier bug (rama → fix → PR).
