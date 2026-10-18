# RATEOS — Seguridad para la beta cerrada (Beta Readiness v1)

Plan: [PLAN-2026-015](../.agent/PLANS.md). Base: `main` `0c213a3` (v0.8.0, esquema 10; tag `v0.8.0`). Publicado como **v0.8.1** (esquema 10). Fecha: 2026-10-17.

> **Estado (decisión del dueño, 2026-10-17): todavía NO hay beta con empresas externas.** Antes de habilitar usuarios reales son **requisitos obligatorios** HD-01 (dominio propio para producción), HD-02 (staging separado de producción en origen y en base de datos, o `/preview/` deshabilitado temporalmente) y HD-03 (registro cerrado o por invitación): ver §6. El Beta Security Gate los informa como REQUISITO pendiente en cada corrida.

Objetivo: que una empresa **nunca** pueda leer, modificar ni inferir datos económicos de otra, que el admin de plataforma no lea contenido de clientes, que no queden datos de una sesión anterior a la vista y que nunca se pierda en silencio el último dato válido. Esta tarea no agrega fórmulas ni toca los motores de costos y precios.

## 1. Frontera real de tenant

**La unidad de aislamiento es la organización** y la frontera la pone **Postgres (RLS)**, no la interfaz:

- Todo el contenido económico de una empresa (cotizaciones, recursos, productos, plantillas, configuración, tarifas, márgenes) vive en **una fila** de `public.workspace_states` (columna `state` jsonb), una por organización (`organization_id` único).
- **Leer** esa fila: sólo miembros (`private.is_member(organization_id)`, por `auth.uid()`). **Guardarla**: OWNER, ADMIN o ESTIMATOR (`private.has_role`), y sólo las columnas `state` y `schema_version` (grant por columna). `id`, `organization_id`, `revision` y `updated_by` los fija un trigger. Nadie puede crear, borrar ni vaciar filas desde la API (sin INSERT, DELETE ni TRUNCATE).
- `organizations`: la ven sus miembros y la renombran OWNER/ADMIN. `organization_members`: cada uno ve las de sus empresas; nadie las escribe desde la API (las crea el trigger de alta). `profiles`: cada persona sólo la suya. `anon`: ningún permiso.
- `private.*` (admins de plataforma, bootstrap, auditoría): RLS sin políticas y sin grants. Las funciones `security definer` viven sólo en `private` con `search_path` vacío.
- **El `organizationId` dentro del JSON es una etiqueta, no un control.** Desde esta versión el navegador además lo fuerza a la organización de la cuenta en cada escritura: nunca confía en el que mande el cliente o un archivo.
- **RATEOS ADMIN** (rol de plataforma, `private.platform_admins`) ve metadata por funciones `admin_*` (conteos, emails, nombres, roles, revisión, tamaño y fecha del workspace) y **nunca** `workspace_states.state`. Por la API de tablas es una cuenta más: sólo ve su propia empresa.
- El navegador (publishable key) usa sólo: `select` de 4 tablas, `update` del workspace, la organización y el perfil propios, y 3 RPC de admin. Nada de Storage, Realtime, Edge Functions ni `auth.admin` (control SEC-02 del gate).

## 2. Inventario (base en vivo, 2026-10-17, consultas de sólo lectura)

| Objeto | Estado |
|---|---|
| Migraciones | 2 en la base = 2 en el repo (`20261005013833_rateos_identity_workspace`, `20261005034916_rateos_platform_admin`). |
| Tablas `public` | `organizations`, `profiles`, `organization_members`, `workspace_states`: RLS habilitada en las 4. |
| Políticas | `profiles_select_own` / `profiles_update_own` (id = auth.uid()); `organizations_select_member` / `organizations_update_admin` (OWNER, ADMIN); `organization_members_select` (propias o de su empresa); `workspace_states_select_member` / `workspace_states_update_editor` (OWNER, ADMIN, ESTIMATOR). Todas `to authenticated`. Ninguna de insert/delete. |
| Grants | `authenticated`: SELECT en las 4 tablas; UPDATE sólo de `organizations.name`, `profiles.full_name`, `workspace_states.state` y `.schema_version`. `anon`: nada. |
| Tablas `private` | `platform_admins`, `platform_admin_bootstrap`, `admin_audit_log`: RLS sin políticas (deny-all), sin grants. |
| Funciones | `private.is_member`, `has_role`, `is_platform_admin`, `admin_overview`, `admin_users` (security definer, `search_path=""`, sólo `authenticated`); triggers sin permisos para nadie; wrappers `public.am_i_platform_admin`, `admin_overview`, `admin_users` (security invoker). `public.rls_auto_enable` (de Supabase): nadie de la API la ejecuta. `anon` no ejecuta ninguna. |
| Schemas | `private`: sin acceso para `anon`. `vault`: sin acceso para la API. |
| Storage | 0 buckets, 0 políticas. |
| Realtime | publicación `supabase_realtime` sin tablas. |
| GraphQL | `pg_graphql` no instalado. |
| Event triggers | `ensure_rls` activo (RLS automática en tablas nuevas de `public`). Ojo: los *default privileges* de Supabase dan todo a `anon`/`authenticated` en tablas nuevas de `public` → cada migración debe revocarlos (lo verifican `tests/supabase/migrations.test.js` y el gate). |
| Advisors de seguridad | INFO `rls_enabled_no_policy` ×3 (tablas de `private`: deny-all a propósito). WARN `auth_leaked_password_protection` (requiere plan Pro: decisión HD-04). |
| Datos reales | 2 usuarios, 2 organizaciones, 2 workspaces, 2 membresías, 1 RATEOS ADMIN. **Ninguna prueba los leyó ni los modificó.** |

Persistencia en el navegador, import/export, auth, logs y eventos: ver [DATA_MODEL.md](DATA_MODEL.md), [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md) y §4.

## 3. Pruebas ejecutadas

Qué se prueba dónde (y qué **no** corre solo):

| Dónde | Qué | Cuántos | Cómo se corre |
|---|---|---|---|
| **Base real de Supabase** (el proyecto de producción), con usuarios y empresas sintéticos; todo se deshace | `supabase/tests/beta_security_test.sql`, `rls_test.sql`, `rls_admin_test.sql` | **204 controles** (132 + 40 + 32) | **A mano**, con el plugin/MCP de Supabase (`execute_sql` como `postgres`) o `psql`: después de cada migración y antes de cada release. **No corren en CI** (CI no tiene credenciales de la base, a propósito). Es la única prueba de RLS real. |
| Node, con un **Supabase simulado** que imita RLS (`tests/helpers/fake-supabase.js`) | `tests/data/beta-security.test.js` (23) y el resto de los tests de datos, sesión y recuperación | dentro de `npm test` | `npm test`, local y en CI ("Tests y build"). Prueban el navegador (repositorio, pestañas, sesión), **no** la base. |
| **Navegador real** (Chromium, escritorio y celular) con Supabase simulado | E2E `tests/lab/e2e/ui-lab.mjs`, incluidos `SESION-01/02` | 574 controles | A mano y en CI (Test Lab → "PR gate", en cada PR). |
| **Estático** (código, migraciones y archivos SQL) | Beta Security Gate SEC-01…SEC-16 + SEC-10b. SEC-03 revisa las migraciones; **SEC-04 revisa que los 3 archivos SQL existan, cubran lo previsto, no tengan DELETE sin protección y siempre deshagan, pero no los ejecuta** | 17 controles + 15 archivos de tests | `npm test`, `npm run test:security` y el paso "Beta Security Gate" de CI. |

### 3.1 En la base real, con datos sintéticos (todo se deshace)

Se corrieron con el plugin/MCP de Supabase (`execute_sql`, rol `postgres`) los bloques `DO` de los tres archivos, tal cual están en el repo. Cada bloque crea usuarios/empresas **sintéticos** (`@rateos.invalid`), simula cada rol como la API (`SET ROLE authenticated|anon` + claims del JWT) y **siempre** termina con `RAISE EXCEPTION`: Postgres deshace todo.

| Archivo | Resultado |
|---|---|
| `supabase/tests/beta_security_test.sql` (nuevo) | `BETA_SECURITY_TESTS_PASSED: 132 controles` |
| `supabase/tests/rls_test.sql` | `RLS_TESTS_PASSED: 40 controles` |
| `supabase/tests/rls_admin_test.sql` | `ADMIN_TESTS_PASSED: 32 controles` |

Ejecuciones registradas (las dos con el mismo resultado, sobre las mismas 2 migraciones):

1. 2026-10-17, durante la auditoría (antes de abrir el PR #25).
2. 2026-10-17 23:44 UTC, otra vez antes del release v0.8.1 (AGENTS.md §13: deben pasar antes de cada release).

Verificación (sólo conteos, nunca contenido): después de cada ejecución, 0 usuarios sintéticos y los mismos conteos que antes (2 usuarios, 2 organizaciones, 2 workspaces, 2 membresías, 1 admin y 0 filas de auditoría). En la segunda, además, la revisión máxima y la fecha del último guardado de los workspaces fueron las mismas antes y después: ninguna escritura real.

Qué prueba `beta_security_test.sql`, **en las dos direcciones (A→B y B→A) y con los IDs reales de la otra empresa** (organización, fila del workspace, usuario):

- **Lectura:** por `organization_id`, por `id` de la fila, con `IN (propia, ajena)`, con "distinto de la mía", sin filtro (ve **1** workspace, el propio: ninguna empresa real), buscando la marca sintética de la otra por texto; organizaciones, membresías y perfiles ajenos; `is_member` / `has_role` sobre la empresa ajena.
- **Escritura y borrado:** `update` del `state` y del `schema_version` ajenos (por organización y por id), renombrar la organización ajena, el perfil ajeno; `delete` de workspace, organización, perfil y membresías → sin permiso.
- **Altas falsificando la empresa ajena:** `insert` de workspace con el `organization_id` ajeno, **upsert** (`on conflict do update`), sumarse como miembro, crear la organización o el perfil con el id ajeno → sin permiso.
- **Columnas de control:** mover el workspace a la otra empresa, copiar el `id` ajeno, escribir `revision`/`updated_by`, cambiar ids de organización/perfil/membresía → sin permiso.
- **El JSON propio con el `organization_id` ajeno adentro** queda en la fila propia; al final, cada fila tiene sólo lo de su empresa (sin la marca ni el contenido de la otra), nombres y `schema_version` intactos, sin membresías cruzadas.
- **RPC de admin** como usuario normal → sin permiso.
- **Roles dentro de una empresa:** VIEWER lee pero no guarda ni renombra ni se sube el rol ni lee perfiles de otros; ESTIMATOR guarda pero no renombra ni se sube el rol; ADMIN de empresa renombra la suya, nada de la otra, y **no** es RATEOS ADMIN.
- **Miembro quitado** (la membresía existe dentro de un savepoint que se deshace: sin ningún DELETE): mientras está, lee; después, no lee, no guarda, no ve la empresa ni sus membresías.
- **RATEOS ADMIN sintético** (dado de alta dentro de la transacción): `admin_users` lista metadata pero nunca la columna `state` ni la marca de nadie; `admin_overview` tampoco; por la API de tablas no ve ni modifica workspaces, organizaciones ni perfiles de clientes (ve 1 workspace: el suyo); no lee la auditoría.
- **JWT sin usuario** (sin `sub`): no ve nada. **anon:** no lee, no escribe, no crea membresías, no ejecuta RPC ni funciones de `private`.
- **Catálogo en vivo:** RLS en todas las tablas de `public` y `private`; `anon` sin permisos de tabla ni de ejecución; `authenticated` sin INSERT/DELETE/TRUNCATE y con UPDATE sólo en las 4 columnas previstas; `security definer` sólo en `private` y con `search_path`; sin buckets públicos ni tablas en Realtime.

Nota de ejecución: el plugin de Supabase pide confirmación para sentencias destructivas. Por eso el test no ejecuta ningún DELETE como `postgres` (el "miembro quitado" se arma con un savepoint) y los DELETE que quedan son intentos de ataque que la base rechaza por permisos.

### 3.2 En el navegador (servidor falso que imita RLS, datos sintéticos)

- `tests/data/beta-security.test.js` (23 tests): tenancy A→B y B→A con IDs conocidos; `organizationId` del cliente y de un backup (con recursos referenciados por id de otra empresa); varias pestañas; una copia pendiente de v0.8.0; dos pestañas sobre la misma cotización; falla a mitad de guardado; nube dañada, con estructura inesperada, de una versión más nueva y "Recargar" con nube dañada; copia local ilegible; miembro quitado; otra persona en el mismo navegador; borradores por cuenta; datos del modo local ya importados.
- `tests/security/beta-security-gate.test.js` (8 tests): el gate dentro de `npm test`, las autopruebas de sus detectores y que HD-01/02/03 sigan informados como requisitos pendientes antes de usuarios reales.
- E2E (`node tests/lab/e2e/ui-lab.mjs`, escritorio y celular, Supabase simulado): `SESION-01` (al cerrar sesión no queda en pantalla ni en el DOM oculto la empresa, el email ni las cotizaciones; la sesión se borra del navegador) y `SESION-02` (otra cuenta en la **misma pestaña**, sin recargar, ve su empresa y nada de la anterior, ni abriendo por id una cotización o un producto de A; nada de A llega a su workspace).

### 3.3 Beta Security Gate

`npm run test:security` (también corre dentro de `npm test` y como paso de CI): 17 controles estáticos y dinámicos + 15 archivos de tests de seguridad, tenancy, sesión, privacidad y recuperación. Escribe `reports/security/latest/beta-security-gate.{json,md}`. Falla si cualquier control P0/P1 o algún test falla; las decisiones del dueño (HD-…) se informan siempre y no bloquean.

| Control | Severidad | Qué verifica |
|---|---|---|
| SEC-01 | P0 SECURITY | Sin secret keys, JWT de service_role, contraseñas ni claves privadas en lo publicado (incluido `dist/`); sólo la publishable key. |
| SEC-02 | P0 SECURITY | Superficie mínima de Supabase desde el navegador (4 tablas, 3 RPC, sin insert/upsert/delete, Storage, Realtime ni `auth.admin`; el SDK y el cliente, sólo en su módulo). |
| SEC-03 | P0 SECURITY | Migraciones: RLS en cada tabla, revoke de `anon`, nada de grants a `anon`/`public`, políticas sólo para `authenticated` y nunca `true`, `security definer` sólo en `private` con `search_path` vacío. |
| SEC-04 | P0 SECURITY | El test SQL de negación existe, cubre todo lo de §3.1, no tiene DELETE sin protección y siempre deshace. |
| SEC-05 | P0 DATA LOSS | La nube nunca se reemplaza sola por un espacio vacío o "reparado" (al abrir y al "Recargar"). |
| SEC-06 | P0 DATA LOSS | Una pestaña nunca borra ni pisa los cambios sin subir de otra. |
| SEC-07 | P0 SECURITY | El `organizationId` del cliente o de un backup nunca decide. |
| SEC-08 | P1 SESSION | Al cerrar o cambiar de cuenta: repositorio liberado, memoria de vistas, menú y barra limpios; borradores por cuenta; logout borra la sesión local; PKCE. |
| SEC-09 | P1 SESSION | Enlaces de email sólo con `?code=` (nunca `?token_hash=`) y `?next=` sólo a rutas internas. |
| SEC-10 / 10b | P1 PRIVACY | Logs de producción sólo warn/error y sin contexto; mensajes literales; nada de `console.*` fuera del logger. |
| SEC-11 | P1 PRIVACY | Eventos con lista blanca (sin montos, nombres ni texto libre); analytics apagado. |
| SEC-12 | P1 PRIVACY | El backup exportado no lleva sesión, tokens ni id de usuario. |
| SEC-13 | P1 SECURITY | CSP estricta (scripts y conexiones sólo a `'self'` y al proyecto de Supabase) y anti-framing. |
| SEC-14 | P0 SECURITY | RATEOS ADMIN ≠ lector de datos: las funciones de admin nunca devuelven `state`. |
| SEC-15 | P1 SECURITY | Cero dependencias npm. |
| SEC-16 | P2 PRIVACY | Reportes y builds fuera de git. |

Contra `main` (v0.8.0) el gate **falla** en SEC-05, SEC-06, SEC-07 (P0) y SEC-08 (P1); con esta rama pasa.

## 4. Hallazgos

| ID | Clasificación | Hallazgo | Estado |
|---|---|---|---|
| BS-01 | **P0 DATA LOSS** | Si los datos de la nube no se podían leer (dañados o con estructura inesperada; por ejemplo escritos por otra versión con el mismo esquema, como el staging, que comparte la base), al abrir la cuenta la app "recuperaba" cargando un espacio **vacío** o una versión "reparada" y **lo subía solo**, pisando la única copia compartida. El original quedaba sólo en una copia de recuperación de ese navegador. Pasaba también al "Recargar". | **Corregido**: se abre en sólo lectura con un aviso claro, nada se sube y queda la copia en el navegador. Si lo ilegible era una copia local sin subir, se abre la nube y la copia queda en recuperación. |
| BS-02 | **P0 DATA LOSS** | Varias pestañas compartían **una sola** copia de cambios sin subir: si la pestaña 2 tenía cambios sin subir (sin conexión, conflicto) y la pestaña 1 guardaba bien, la pestaña 1 **borraba** (o pisaba) esa copia; al cerrar la pestaña 2, sus cambios se perdían sin aviso. | **Corregido**: una copia por pestaña; al abrir se retoma la más nueva sobre la revisión actual y las demás pasan a copias de recuperación; una copia se suelta sólo cuando quedó a salvo. La clave de v0.8.0 se sigue leyendo. |
| BS-03 | P1 SESSION | La memoria de las vistas (borradores no guardados, sliders, secciones abiertas) sobrevivía al cierre de sesión y al cambio de cuenta en la misma pestaña; un borrador no guardado se restauraba **por id de cotización** sin mirar la cuenta (una cotización importada de un backup ajeno con el mismo id podía mostrar el borrador de otra empresa). | **Corregido**: borradores por cuenta; el resto se borra al cerrar la cuenta. |
| BS-04 | P1 SESSION | El menú y la barra de la app (ocultos en las pantallas públicas) conservaban la empresa, su base, el nombre y el email de la persona, el título y las migas (nombre de cotización/cliente) de la sesión anterior. | **Corregido** (`layout.clearSession()`); E2E `SESION-01/02`. |
| BS-05 | P1 SESSION / PRIVACY | Los datos del modo local anterior (`rateos.state`) se ofrecían a **cualquier** cuenta que ingresara en ese navegador, aun después de que otra cuenta ya los hubiera importado (con cantidades y botón de importar). | **Corregido**: una vez importados, quedan "reclamados" (huella del texto, sin datos ni ids) y no se ofrecen a otra cuenta. `rateos.state` nunca se borra. |
| BS-06 | P2 SESSION | Un miembro quitado de la empresa, al guardar, veía "Tu rol en esta empresa no permite guardar cambios" y seguía con los datos en pantalla. | **Corregido**: `access_lost` → se cierra la cuenta en pantalla ("Ya no tenés acceso a esta empresa"), sin reintentos; los cambios sin subir quedan en el navegador. Limitación en HD-09. |
| BS-07 | P2 (integridad) | El repositorio guardaba el `organizationId` que mandaba el cliente (siempre dentro de la fila propia: **sin acceso cruzado**). | **Corregido**: cada mutación fuerza la organización de la cuenta. |
| BS-08 | P2 (recuperación) | Si al abrir se había apartado una copia vieja de cambios sin subir, un conflicto posterior en esa pestaña descargaba con "Conservar una copia" **esa copia vieja** en lugar de la versión actual (la actual no se perdía: "Recargar" la guarda en una copia de recuperación). | **Corregido**: "Conservar una copia" descarga siempre la versión actual de la pestaña; las apartadas al abrir están en Configuración → Datos y backup. |
| BS-09 | P2 (recuperación) | Las copias de recuperación de cambios que nunca llegaron a la nube compartían el cupo de 3 con las de importar o migrar: unas importaciones seguidas podían borrar la única copia de esos cambios. | **Corregido**: cupo propio de 3. |

**P0 SECURITY: 0.** Ninguna lectura, escritura o borrado entre empresas fue posible, ni con IDs conocidos; no hay service-role ni secretos en el navegador; no hay bypass de RLS; el admin de plataforma no lee contenido económico; no hay fuga entre sesiones del lado de la base.

P2 UX SECURITY (sin fuga): si la nube guardó pero la respuesta se perdió, el reintento muestra "Tus datos cambiaron en otro dispositivo" aunque fue la misma pestaña (no se pierde ni se pisa nada: "Recargar" abre la versión que ya tiene ese cambio).

## 5. Correcciones (qué cambió)

- `js/data/supabase-repository.js`: copia de cambios sin subir **por pestaña** (`cloudPendingPrefix`, `readPendingCopies`, `tabId`); apertura protegida (`protectUnreadableCloud`, también en `reloadFromCloud`); `mutate` fuerza la organización de la cuenta (`claimForCloudOrganization`); `access_lost` (`ACCESS_LOST_CODE`).
- `js/data/workspace-gateway.js`: un guardado de 0 filas cuya fila ya no se ve devuelve `not_found` (acceso perdido) en lugar de `forbidden`.
- `js/data/local-storage-repository.js`: las copias de recuperación de cambios que nunca llegaron a la nube (`cloud-unsynced`, `cloud-conflict-local`) tienen su propio cupo de 3: una importación o migración ya no las rota.
- `js/data/legacy-local.js` + `js/services/local-import-service.js`: marca de datos locales ya importados.
- `js/ui/session-memory.js` (nuevo): `createDraftStore()`, `onSessionReset()`, `resetSessionMemory()`; usado por el editor de cotizaciones, el de productos, el Resultado y Materiales.
- `js/ui/layout.js`: `clearSession()`; `setAccount(null)` borra nombre y email.
- `js/app.js`: `closeAccount()` limpia memoria de vistas, menú y barra; `access_lost` cierra la cuenta en pantalla; "Recargar" avisa si la nube no se puede leer.
- Tests, gate, CI y documentación (§3).

Sin cambios en la base (ninguna migración), en el esquema de datos (sigue en 10), en los motores ni en ningún golden.

## 6. Decisiones del dueño (HUMAN DECISION REQUIRED)

Ninguna se "arregló" sola: cambian el modelo de permisos, la infraestructura o el costo.

**HD-01, HD-02 y HD-03 son requisitos obligatorios antes de habilitar usuarios reales** (decisión del dueño, 2026-10-17). Hasta que estén cumplidos los tres no se habilitan usuarios reales ni se abre la beta a empresas externas. No son controles del código: se cumplen en la infraestructura (dominio, Supabase, Auth), y el Beta Security Gate los lista como REQUISITO pendiente en cada corrida, sin bloquear el CI del código.

| ID | Sev. | Riesgo | Requisito o recomendación |
|---|---|---|---|
| HD-01 | P1 | **Origen compartido** `joaquinvedova1.github.io`: todo sitio de Pages de esa cuenta comparte `localStorage` con RATEOS, incluida la sesión de Supabase (refresh token). | **Requisito obligatorio:** dominio propio para producción. Mientras tanto, ningún otro sitio de Pages en esa cuenta. |
| HD-02 | P1 | **Staging comparte origen y base** con producción: el código de cualquier rama con CI verde corre junto a sesiones y datos reales. | **Requisito obligatorio:** staging separado de producción en origen **y** en base de datos (proyecto o branch de Supabase propio), o `/preview/` deshabilitado temporalmente. |
| HD-03 | P1 | **Registro abierto** en una beta "cerrada" (no expone datos de otras empresas: cada cuenta nace con su empresa). | **Requisito obligatorio:** registro cerrado o por invitación (signups desactivados en Supabase Auth y alta a mano, o lista de emails permitidos). |
| HD-04 | P2 | Protección de contraseñas filtradas apagada (advisor). | Requiere plan Pro de Supabase. |
| HD-05 | P2 | Al cerrar sesión quedan en el navegador las copias pendientes y de recuperación de la cuenta (no se muestran a otra cuenta; con DevTools se leen en una computadora compartida). | Ofrecer "Cerrar sesión y borrar las copias de este navegador" sólo cuando no hay cambios sin subir. |
| HD-06 | P2 | El email de la cuenta master está en una migración del repo público. | Aceptarlo o cargar el bootstrap fuera del repo en una próxima migración (hoy AGENTS.md pide el alta por migración). |
| HD-07 | P2 | La auditoría registra la apertura del panel (`admin_overview`) pero no cada `admin_users`. | Auditar también `admin_users` (migración nueva). |
| HD-08 | P2 | "Ese email ya está registrado" permite saber si un email tiene cuenta. | Elegir entre ayuda a la persona y mensaje uniforme. |
| HD-09 | P2 | Un miembro quitado sigue viendo lo que ya tenía en pantalla hasta que la app vuelve a hablar con la nube (Realtime apagado a propósito). | Hoy no se pueden quitar miembros desde la app; revisarlo cuando haya invitaciones. |

## 7. Riesgos que quedan y límites de esta auditoría

- Las pruebas de la base se corrieron **a mano** con el plugin (no hay credenciales en CI, a propósito). Hay que volver a correrlas después de cada migración y antes de cada release (§8).
- No se probó un JWT **falsificado**: sin el secreto de Supabase no se puede firmar; los tests prueban que, aunque los claims digan otra cosa, la autoridad es `auth.uid()` + membresías.
- Sin historial en el servidor (fuera de alcance por pedido del dueño): un OWNER/ADMIN/ESTIMATOR puede sobrescribir el workspace completo; hay control de revisión, copias locales y backup.
- Las copias de recuperación se conservan de a 3 por grupo (otras · datos dañados · cambios que nunca llegaron a la nube): desde esta versión, importar o migrar ya no rota las copias de cambios sin subir; pero un cuarto conflicto sí rota el más viejo. Mitigación: avisos y descarga desde Configuración → Datos y backup.
- HD-01, HD-02 y HD-03 son requisitos obligatorios antes de habilitar usuarios reales (§6), no bugs del código: siguen pendientes.

## 8. Cómo correr todo

```bash
npm test                 # incluye el gate (P0/P1)
npm run test:security    # gate completo + reporte en reports/security/latest/
```

En la base (después de cada migración y antes de cada release), con el plugin/MCP de Supabase (`execute_sql`) o `psql` como `postgres`, el bloque `DO` de cada archivo:

1. `supabase/tests/beta_security_test.sql` → `BETA_SECURITY_TESTS_PASSED: <n> controles`
2. `supabase/tests/rls_test.sql` → `RLS_TESTS_PASSED: <n> controles`
3. `supabase/tests/rls_admin_test.sql` → `ADMIN_TESTS_PASSED: <n> controles`
4. Advisors de seguridad (`get_advisors security`).

Cualquier otro resultado bloquea la beta.

## 9. Impacto en datos y esquema

- Versión: **0.8.1** (parche sobre v0.8.0; tag `v0.8.0` = `0c213a3`).
- Base: **sin cambios** (ninguna migración nueva; sólo un archivo de tests).
- Esquema de datos de RATEOS: **10, sin cambios**; backups iguales.
- Navegador: la copia de cambios sin subir pasa de `rateos.cloud.<u>.<o>` a `rateos.cloud.<u>.<o>.pending.<pestaña>`; la clave vieja se sigue leyendo y se suelta recién cuando su contenido quedó a salvo. Nueva marca `rateos.cloud.local-import.claimed` (sin datos ni ids).
