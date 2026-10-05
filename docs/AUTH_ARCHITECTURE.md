# Arquitectura de autenticación y permisos

> **Estado: implementado (cuentas reales con Supabase Auth).** RATEOS separa tres estados: **visitante** (sitio público), **demo** (sin cuenta, en memoria) y **usuario autenticado** (datos reales de su empresa en Supabase, protegidos con Row Level Security). Base de datos y RLS en [SUPABASE_PLAN.md](SUPABASE_PLAN.md); entidades en [DATA_MODEL.md](DATA_MODEL.md); capas en [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Tres estados que nunca se mezclan

| Estado | Rutas | Datos |
|---|---|---|
| **Visitante** (sin sesión) | `#/` (landing), `#/login`, `#/registro`, `#/recuperar-contrasena`, `#/demo`, `#/demo/analisis` y el retorno de los enlaces de email (`?auth=…`) | Ninguno. |
| **Demo** (sin cuenta) | `#/demo`, `#/demo/analisis` | Caso "Hidrogrúa on-call — Añelo" **ILUSTRATIVO**, en memoria (`createDemoContext`): otro repositorio y otro storage. Nunca escribe en el navegador ni en la nube y nunca se importa a una cuenta. |
| **Usuario autenticado** | `#/inicio` y toda la app (`#/cotizaciones…`, `#/recursos`, `#/servicios`, `#/escenarios`, `#/configuracion…`, `#/bienvenida`) | Los de su organización, en Supabase (`createAccountContext` → `SupabaseRepository`). |

- Cada ruta declara su acceso en `js/ui/router.js` (`access: 'public' | 'guest' | 'auth'`) y `resolveAccess()` (`js/services/auth-routing.js`) decide: mostrar, esperar o redirigir.
- Sin sesión, una ruta protegida redirige a `#/login?next=/ruta` y, al ingresar, vuelve a ese destino. Con sesión, `#/login` y `#/registro` llevan a la app.
- **Sin destello de contenido protegido:** la app no dibuja nada hasta que el SDK restauró (o no) la sesión (`await auth.init()` antes de crear el layout); mientras se abre la cuenta se ve "Abriendo tu cuenta…".
- `next` sólo acepta rutas internas (`isSafeNextPath`): nada con `//`, protocolos, `..`, `\`, espacios ni las pantallas de ingreso. Evita redirecciones abiertas.

## 2. Proveedor: Supabase Auth (email + contraseña)

- SDK oficial `@supabase/supabase-js` 2.117.2, **vendorizado** en `js/data/vendor/supabase.js` (UMD + 2 líneas de export ES; licencia MIT al lado; hash SHA-256 verificado por `tests/data/supabase-vendor.test.js`). Sin npm, sin CDN: la CSP sigue sin terceros.
- El único archivo que lo importa es `js/data/supabase-client.js`. Configuración: `flowType: 'pkce'`, `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false` (el canje del código lo hace RATEOS, ver §4) y `storageKey: 'rateos.auth'`.
- En el navegador existen **sólo** la URL del proyecto y la **publishable key** (`js/config.js`, `SUPABASE`). Nunca `service_role`, secret keys (`sb_secret_…`), contraseña de la base, connection strings ni el JWT secret: un test de arquitectura busca esos patrones en todo el repo.
- **RATEOS no guarda contraseñas** en ningún lado (ni localStorage, sessionStorage, Postgres, logs ni eventos). Van directo del formulario al SDK por HTTPS; el campo se vacía después de cada intento. Las administra Supabase Auth (hash en `auth.users`).
- La sesión (JWT de acceso + refresh token) la guarda el SDK en `localStorage['rateos.auth']`. Cerrar sesión la borra (`signOut({ scope: 'local' })`); nunca `localStorage.clear()`.

Capas:

```
js/ui/views/public/auth.js        formularios (ingreso, registro, recuperación)
        │
js/services/auth-service.js       estado (loading | anonymous | authenticated), validación,
        │                         mensajes humanos, enlaces de email, sesión vencida
js/data/auth-gateway.js           única puerta al SDK: errores → códigos propios, publicUser()
        │
js/data/supabase-client.js → js/data/vendor/supabase.js
```

## 3. Registro, confirmación de email y alta de la empresa

1. `#/registro` pide **Tu nombre, Empresa, Email y Contraseña** (mínimo 8 caracteres). Nombre y empresa viajan como `user_metadata` (`full_name`, `company`).
2. **La confirmación de email está activada** en el proyecto: no hay sesión hasta confirmar. La pantalla dice "Revisá tu email" con el email usado.
3. Al crearse el usuario, el trigger `on_auth_user_created` (función `private.handle_new_user`, `security definer`, `search_path` vacío) crea en la misma transacción: `profiles` (nombre), `organizations` (empresa; "Mi empresa" si vino vacía), `organization_members` con rol **OWNER** y un `workspace_states` **vacío**. El cliente no puede crear organizaciones ni membresías (sin grants de `insert`).
4. La primera vez que se abre la cuenta, `SupabaseRepository` sube el estado vacío con la empresa real (`emptyWorkspaceState`): **sin demo, sin datos ILUSTRATIVOS, sin seeds**.
5. Un email ya registrado no se revela (Supabase devuelve un usuario sin identidades); RATEOS lo detecta y dice "Ese email ya está registrado. Ingresá o recuperá tu contraseña."

## 4. Enlaces de email con GitHub Pages y router por hash

GitHub Pages sirve RATEOS bajo `/COTIZADORWEB/` y la app usa rutas `#/…`. Los enlaces de Supabase (PKCE) agregan `?code=…` a la URL de retorno, así que RATEOS la arma **con query antes del `#`**:

```
https://joaquinvedova1.github.io/COTIZADORWEB/?auth=confirm&next=%2Fcotizaciones%2Fnueva   (confirmación)
https://joaquinvedova1.github.io/COTIZADORWEB/?auth=recovery                                 (recuperación)
```

- `authRedirectUrl()` usa el sitio público; en desarrollo local (`http://localhost…/COTIZADORWEB/`) usa el servidor local (`siteUrlFor`). Cualquier otro origen usa el sitio público.
- Al volver, `auth.init()` lee la query (`parseAuthRedirect`), canjea el código (`exchangeCodeForSession`), **limpia la URL** con `history.replaceState` (el código no queda en el historial ni en la barra) y navega a `#<next>` o `#/inicio`. Errores ("El enlace venció o ya se usó…") se muestran en `#/login` sin detalles técnicos.
- **Sólo PKCE.** El enlace funciona en el **mismo navegador** donde se pidió (ahí está el `code_verifier`). En otro navegador se ve "Ingresá con tu email y contraseña" (el email igual queda confirmado). Es a propósito: nadie puede mandarte un enlace que abra **su** cuenta en tu navegador (y reciba lo que cargues), porque canjearlo exige el `code_verifier` que sólo existe donde se pidió. Por la misma razón los enlaces con `?token_hash=` se **rechazan** (no exigen nada del navegador).

**Configuración necesaria en Supabase (Dashboard → Authentication → URL Configuration):**

| Campo | Valor |
|---|---|
| Site URL | `https://joaquinvedova1.github.io/COTIZADORWEB/` |
| Redirect URLs | `https://joaquinvedova1.github.io/COTIZADORWEB/**` |

Para probar el registro en desarrollo local, agregá temporalmente `http://localhost:8080/COTIZADORWEB/**` (o usá un proyecto de Supabase aparte para desarrollo) y sacala después: en producción conviene que la lista tenga sólo el sitio público.

## 5. Sesión: restaurar, renovar, vencer, cerrar

```
Abrir RATEOS
  └─ auth.init(): ¿hay ?auth=…? → canjear código y limpiar la URL
       ├─ sin sesión  → status "anonymous": sitio público; rutas protegidas → #/login?next=…
       └─ con sesión  → status "authenticated" → createAccountContext:
             ├─ organization_members (RLS: sólo las propias) → organización + rol
             ├─ SupabaseRepository.init() → workspace de esa organización
             └─ app: "Hola, <nombre>", empresa real en el menú, estado de sincronización
```

- **Recargar** la página restaura la sesión (el SDK la renueva sola con el refresh token).
- **Sesión vencida o revocada:** si el SDK no puede renovarla, o si la base rechaza el token (401) y un `refreshSession()` tampoco funciona, la sesión local se cierra con motivo `expired`: "Tu sesión terminó. Volvé a ingresar." en `#/login?next=<donde estabas>&sesion=vencida`. **Los cambios sin subir no se pierden:** quedan en la copia local (`rateos.cloud.<usuario>.<organización>`) y se suben al volver a ingresar. Sin conexión no se cierra la sesión.
- **Cerrar sesión** (menú lateral o Configuración → Cuenta): si hay cambios sin sincronizar, pide confirmación. Vuelve a la landing y la cuenta en memoria se descarta. La sesión guardada (`rateos.auth`, el `code_verifier` de PKCE) se borra **siempre**, aunque el SDK falle (token vencido y sin conexión): nadie puede volver a entrar con ella al recargar.
- **Otra persona ingresa en otra pestaña:** la cuenta abierta se cierra y se abre la nueva; nunca quedan a la vista datos de una persona con la sesión de otra.
- **Recuperar contraseña:** `#/recuperar-contrasena` responde siempre lo mismo ("Si hay una cuenta con ese email…", no revela si existe). El enlace abre "Elegí una contraseña nueva" (evento `PASSWORD_RECOVERY` / `?auth=recovery`).

## 6. Modelo de pertenencia y roles

```
auth.users ──1:1── profiles
     │
     └──< organization_members >── organizations ──1:1── workspace_states
              role: OWNER | ADMIN | ESTIMATOR | VIEWER
```

Hoy cada cuenta nueva tiene **una** organización (la crea el alta) y queda OWNER. No hay invitaciones todavía, así que en la práctica cada organización tiene un solo miembro.

| Rol | Hoy (implementado en RLS) |
|---|---|
| **OWNER** | Lee y guarda el workspace; renombra la organización. |
| **ADMIN** | Igual que OWNER (renombrar y guardar). |
| **ESTIMATOR** | Lee y guarda el workspace; no renombra la organización. |
| **VIEWER** | Sólo lectura (la app se abre en modo sólo lectura y la base rechaza el guardado). |

Nadie puede, desde el cliente: crear o borrar organizaciones, crear/borrar/cambiar membresías o roles, borrar el workspace, cambiar `revision`, `organization_id` o `updated_by`. La matriz de permisos fina por entidad (cotizaciones vs. bibliotecas, borrar sólo propias…) requiere el modelo normalizado ([SUPABASE_PLAN.md §10](SUPABASE_PLAN.md#10-plan-por-fases)).

### Matriz de permisos prevista (modelo normalizado, con invitaciones)

| Entidad / acción | OWNER | ADMIN | ESTIMATOR | VIEWER |
|---|:-:|:-:|:-:|:-:|
| Ver organización, configuración, bibliotecas, plantillas | Sí | Sí | Sí | Sí |
| Editar datos de la organización | Sí | Sí | — | — |
| Eliminar organización / transferir propiedad | Sí | — | — | — |
| Invitar o quitar miembros, cambiar roles | Sí (todos) | Sí (sólo ESTIMATOR y VIEWER) | — | — |
| Editar configuración (`settings`) | Sí | Sí | — | — |
| Crear / editar / eliminar convenios, perfiles, equipos, materiales, ubicaciones | Sí | Sí | — | — |
| Crear / editar / eliminar plantillas de servicio | Sí | Sí | — | — |
| Ver cotizaciones, resultados y trazas "Ver cálculo" | Sí | Sí | Sí | Sí |
| Crear, editar y duplicar cotizaciones | Sí | Sí | Sí | — |
| Cambiar estado de una cotización (enviada, ganada, perdida, archivada) | Sí | Sí | Sí | — |
| Eliminar cotizaciones | Sí | Sí | Sólo propias en borrador | — |
| Guardar escenarios (`quote_scenarios`) | Sí | Sí | Sí | — |
| Snapshots de EECC (`cost_structures`) | Sí | Sí | Sí (los genera el sistema al enviar/ganar) | — |
| Cargar costos reales (`actual_costs`) | Sí | Sí | Sí | — |
| Exportar backup completo | Sí | Sí | — | — |
| Importar backup (sobrescribir datos) | Sí | — | — | — |

"Propias" = `created_by = auth.uid()`.

## 7. Qué se valida en el frontend y qué en la base

| Control | Frontend | Base de datos |
|---|---|---|
| Mostrar u ocultar acciones según el rol | Sí (sólo UX) | — |
| Validación de inputs (rangos, finitos, textos) | Sí (`validateNumber`, `validateQuote`, `sanitizeText`, `validateState`) | `CHECK` (estado JSON objeto, ≤ 5 MB, nombres 1–120 caracteres, roles válidos) |
| Pertenencia a la organización | Filtros por `organization_id` = **comodidad** | **RLS** (`private.is_member`) |
| Permiso por rol | Modo sólo lectura para VIEWER | **RLS** (`private.has_role`) + grants por columna |
| `revision`, `updated_by`, `updated_at`, `organization_id` del workspace | Nunca se envían | Trigger `workspace_before_update` (revisión + 1, `auth.uid()`, `now()`, organización fija) |
| Concurrencia | Envía la revisión base | `update … where revision = <base>`: 0 filas = conflicto |

**Nunca confiar en filtros del frontend.** Cambiar un `organizationId` desde DevTools no sirve: la base no devuelve ni acepta filas de organizaciones ajenas. Tests: `supabase/tests/rls_test.sql` (40 controles: usuarios A/B, anon, escalada de rol, columnas de control, revisión vieja, usuario sin membresía).

## 8. Errores para personas

`js/data/auth-gateway.js` traduce los errores del SDK a códigos propios (`invalid_credentials`, `email_not_confirmed`, `email_taken`, `weak_password`, `rate_limited`, `link_invalid`, `network`, …) y `js/services/auth-service.js` los convierte en mensajes en español ("No pudimos iniciar sesión. Revisá el email y la contraseña."). Nunca se muestran mensajes internos, stack traces, errores de Postgres, JWT, ids de usuario ni detalles de Supabase. `publicUser()` sólo expone `id` (uso interno), `email`, `fullName` y `emailConfirmed`; la UI nunca muestra el id.

## 9. Pendientes conocidos

- **SMTP propio:** el SMTP de Supabase por defecto sólo entrega a miembros del equipo del proyecto y tiene un límite bajo por hora. Antes de abrir el registro a clientes hay que configurar un SMTP propio (Dashboard → Authentication → Emails → SMTP Settings).
- **Invitaciones** (organizaciones con varias personas): previstas con `organization_invitations` y una Edge Function con token de un solo uso; fuera de esta versión.
- **Google OAuth** y otros proveedores: fuera de esta versión.
- **Ingreso anónimo de Supabase:** debe seguir **desactivado** (es el valor por defecto). Si se activara, el trigger de alta le daría a cada visitante anónimo una organización y un workspace.

## 9.1 Riesgos conocidos y mitigaciones

| Riesgo | Mitigación hoy | Recomendación |
|---|---|---|
| **Origen compartido de GitHub Pages:** todos los sitios de `joaquinvedova1.github.io` comparten `localStorage`. Un sitio malicioso publicado en esa cuenta podría leer `rateos.auth` (incluye el refresh token) y entrar a la cuenta. | No publicar en esa cuenta sitios no confiables (ya era regla en [AGENTS.md §13](../AGENTS.md#13-seguridad)). | **Dominio propio** para RATEOS (o una cuenta/organización de GitHub dedicada) antes de tener clientes. |
| **Clickjacking:** Pages no permite enviar `X-Frame-Options` ni `frame-ancestors` (no funciona en una CSP `<meta>`). | RATEOS se niega a funcionar dentro de un iframe (`isFramed()` en `js/app.js`). | Con dominio propio y un proxy/CDN, agregar `frame-ancestors 'none'` como header. |
| **Cambios sin subir en el navegador:** si no hay conexión, la copia local recuperable (`rateos.cloud.<usuario>.<organización>`) queda en el navegador hasta que se suba. | Es por usuario y organización, se valida al leerla y se borra al confirmar la subida. Cerrar sesión con cambios pendientes pide confirmación. | En equipos compartidos, cerrar sesión con todo sincronizado. |
| **Sin historial en el servidor:** un OWNER/ADMIN/ESTIMATOR puede sobrescribir el workspace completo. | Hoy cada organización tiene un solo miembro; control de revisión; copias de recuperación locales; backup JSON. | Con invitaciones: tabla de historial o versiones del workspace. |

## 10. Privacidad

- Del usuario se guarda sólo email (en `auth.users`) y nombre visible (`profiles.full_name`).
- Los datos empresariales quedan aislados por organización (RLS).
- Ningún dato de cotizaciones, costos, salarios, emails ni ids se envía a analytics (no hay analytics) ni a logs de producción (ver [ARCHITECTURE.md §8](ARCHITECTURE.md#8-eventos-internos-y-privacidad)).
