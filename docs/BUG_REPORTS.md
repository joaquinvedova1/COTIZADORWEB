# Reportes de problemas ("Reportar un problema")

Cómo llegan los reportes de los usuarios y cómo se revisan (PLAN-2026-020).

## 1. Dónde está el botón

- **En todas las pantallas** (app, demo, sitio público): pestaña fija **Reportar un problema** al costado derecho (desde 2026-11-10).
- Además, en el pie de la página principal.

El formulario pregunta **¿En qué paso fue?** (ya elegido según dónde está la persona: los 11 pasos de la cotización, "Fuera de una cotización" o "En general / no sé"), **¿Qué pasó?** (obligatorio) y **¿Qué esperabas que pasara?** (opcional). Se agrega solo: pantalla y paso, versión, build, navegador, tamaño de ventana, idioma y si era la demo o una cuenta. "Ver exactamente lo que se envía" muestra el texto completo antes de enviarlo.

## 2. Qué pasa al enviar

| Quién | Qué pasa |
| --- | --- |
| Con sesión (cuenta de RATEOS), con `FEATURES.bugReportsCloud = true` | Se guarda en Supabase (`private.bug_reports`) y la Edge Function `bug-report-github` crea un **issue en GitHub** con el label `reporte-app`. La persona ve "¡Gracias!" y una referencia `R-XXXXXX`. No necesita cuenta de GitHub. |
| Sin sesión (landing, demo) | Se guarda en Supabase (`private.bug_reports`) por la Edge Function `bug-report-submit` (service_role; la base no le da nada a anon). Límite por origen (hash del IP, nunca el IP): 5 cada 10 min y 30 por día; tope global sin sesión: 40 cada 10 min y 300 por día. No va a GitHub. |
| Si el envío falla | Plan B: GitHub con el issue ya escrito, o copiar el texto. |

El issue **nunca** lleva nombre, email, empresa ni id de quien reporta (el repositorio es público). La ruta va como patrón (`/cotizaciones/:id/equipment`), sin ids. Límite: 5 reportes cada 10 minutos y 30 por día por persona.

## 3. Cómo se revisan

1. **GitHub (principal):** [issues con label `reporte-app`](https://github.com/joaquinvedova1/COTIZADORWEB/issues?q=is%3Aissue+label%3Areporte-app). Cada issue tiene la referencia `R-XXXXXX` en el título. Se responde, se etiqueta (`bug`, `ux`, `duda`…) y se cierra cuando el arreglo está en `main`, con un enlace al PR.
2. **Supabase (respaldo y fuente de verdad):** todos los reportes, aunque GitHub falle o el token no esté configurado. Desde el plugin/MCP de Supabase (`execute_sql`) o el SQL Editor:

   ```sql
   select 'R-' || upper(left(replace(id::text, '-', ''), 6)) as ref, created_at, step, where_label, what_happened, expected,
          app_version, app_commit, browser, viewport, context ->> 'mode' as modo, status, triage_note
   from private.bug_reports order by created_at desc limit 50;
   ```

   Reportes que todavía no tienen issue: `where github_issue_number is null`. Estados: `nuevo` · `revisado` · `a_corregir` · `resuelto` · `descartado`. Al revisar: `update private.bug_reports set status = 'a_corregir', triage_note = 'por qué / PR', triaged_at = now() where id = …`.

   **Triage (lo que hace Claude):** leer los `nuevo`, reproducir cada uno en la versión indicada, decidir `a_corregir` (bien reportado) / `descartado` (no es error: explicar en `triage_note`) / `revisado` (duda de uso → mejorar texto), corregir en un PR y pasar a `resuelto` con el PR en `triage_note`. Resumen al dueño: "hay N reportes, los analicé, estos están bien reportados y los corregimos".
3. Desde una sesión de Claude Code del proyecto se pueden leer ambos (GitHub y Supabase) y armar el informe de evaluación.

## 4. Configuración del puente a GitHub (una vez)

Sin este paso los reportes se guardan igual en Supabase, pero no se crean issues.

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → *Generate new token*.
   - Repository access: **Only select repositories** → `joaquinvedova1/COTIZADORWEB`.
   - Permissions → Repository → **Issues: Read and write** (nada más).
   - Vencimiento: el que prefieras (al vencer, se repite este paso).
2. Supabase → proyecto RATEOS → **Edge Functions → Secrets** → *Add new secret*: nombre `GITHUB_ISSUES_TOKEN`, valor = el token.
3. (Opcional) `GITHUB_REPO` = `dueño/repo` si alguna vez se muda el repositorio.

El token **nunca** va al repositorio, al frontend ni a un chat: sólo a los secretos de Supabase.

## 5. Piezas

- `supabase/migrations/20261107021710_rateos_bug_reports.sql` — tabla, RPC y permisos.
- `supabase/migrations/20261110153000_rateos_bug_reports_anon.sql` — alta sin sesión (sólo service_role), paso, triage.
- `supabase/functions/bug-report-submit/index.ts` — Edge Function del alta sin sesión (`verify_jwt` off; sin secretos propios).
- `supabase/functions/bug-report-github/index.ts` — Edge Function (se despliega con el plugin/MCP de Supabase o `supabase functions deploy bug-report-github --no-verify-jwt`; verifica la sesión adentro).
- `js/data/feedback-gateway.js`, `js/services/feedback-service.js`, `js/ui/report-problem.js` — app.
- `.github/ISSUE_TEMPLATE/reporte-app.yml` — formulario para quien reporte directo en GitHub.

## 6. Encendido

`FEATURES.bugReportsCloud` (`js/config.js`) está en `true` desde el 2026-11-07: migración `20261107021710_rateos_bug_reports` aplicada (9 controles de permisos y límites en verde, todo deshecho) y Edge Function `bug-report-github` desplegada (sin `verify_jwt`; verifica la sesión adentro). Con `false`, todos (con o sin sesión) reportan por GitHub con el issue ya escrito.

Reportes enviados antes de cargar `GITHUB_ISSUES_TOKEN` quedan sólo en la base (`github_issue_number is null`).
