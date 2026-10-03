# Arquitectura de autenticación y permisos (futura)

> **Estado: NO implementado.** RATEOS v0.1.0 no tiene login, usuarios ni roles. Este documento define cómo se agregarán cuando exista backend, para que el diseño actual no lo impida. Plan de base de datos en [SUPABASE_PLAN.md](SUPABASE_PLAN.md); entidades en [DATA_MODEL.md](DATA_MODEL.md).

## 1. Por qué hoy no hay login

- El MVP es **sólo frontend** en GitHub Pages: no hay servidor que pueda verificar una identidad.
- Todo el JavaScript es público: un login sin backend sería **autenticación ficticia** (cualquiera podría saltearlo editando el código) y daría una falsa sensación de seguridad. Está prohibido explícitamente (ver [AGENTS.md](../AGENTS.md), "No sobreingeniería").
- Los datos nunca salen del navegador del usuario: el control de acceso hoy es el del propio dispositivo. Para compartir datos se exporta un backup JSON.

Lo que **sí** está preparado:

- Todas las entidades principales tienen `organizationId`, `createdBy` y `updatedBy` (hoy `null`).
- Toda la persistencia pasa por `StorageRepository` (`js/data/storage-repository.js`): un `SupabaseRepository` autenticado puede reemplazar a `LocalStorageRepository` sin tocar pantallas ni motores.
- Feature flags `FEATURES.supabase` y `FEATURES.multiOrganization` (`js/config.js`), hoy en `false`.

## 2. Proveedor previsto: Supabase Auth

- Métodos: email + contraseña y/o enlace mágico por email; OAuth (Google/Microsoft) opcional más adelante.
- El frontend usa **sólo la URL del proyecto y la anon key** (pública por diseño). La `SUPABASE_SERVICE_ROLE_KEY` **nunca** va al navegador, a GitHub Pages, al JavaScript público ni al repositorio.
- La sesión (JWT de acceso + refresh token) la maneja el cliente oficial de Supabase. Ese código vive sólo en `js/data/` (por ejemplo `js/data/supabase-repository.js` y un adaptador de sesión); la UI recibe el estado de sesión a través de servicios.

## 3. Modelo de pertenencia

```
users (auth.users) ──< organization_members >── organizations
                         role: OWNER | ADMIN | ESTIMATOR | VIEWER
```

- Un usuario puede pertenecer a varias organizaciones, con un rol por organización (`organization_members`, PK `organization_id` + `user_id`).
- Toda fila con datos empresariales tiene `organization_id`. La regla conceptual es: **un usuario sólo puede leer o modificar registros de organizaciones de las cuales es miembro**, y sólo con las acciones que su rol permite.
- Con `FEATURES.multiOrganization = false` la UI trabaja con una organización por sesión; el modelo de datos ya soporta varias.

## 4. Roles

| Rol | Descripción |
|---|---|
| **OWNER** | Control total de la empresa: datos de la organización, miembros y roles, importación de backups, eliminación de la organización. Debe existir al menos uno. |
| **ADMIN** | Gestiona recursos (bibliotecas, plantillas) y configuración; invita miembros ESTIMATOR/VIEWER. |
| **ESTIMATOR** | Crea y modifica cotizaciones (y sus escenarios); ve bibliotecas y configuración. |
| **VIEWER** | Sólo lectura. |

### Matriz de permisos

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

## 5. Flujo de sesión

```
Abrir RATEOS
  ├─ sin sesión ──► pantalla de ingreso (email / enlace mágico)
  │                   └─► Supabase Auth emite la sesión (JWT)
  └─ con sesión
        ├─► leer organization_members del usuario
        │     ├─ 0 organizaciones ──► crear organización (el usuario queda OWNER)
        │     ├─ 1 organización   ──► abrir esa
        │     └─ varias           ──► elegir (si FEATURES.multiOrganization)
        ├─► createRepository({ mode: 'supabase' }) con organization_id activo
        ├─► servicios y vistas igual que hoy (mismos objetos quote planos)
        └─► cerrar sesión: el cliente de Supabase borra SÓLO su propia sesión
                           (nunca localStorage.clear())
```

- La sesión se renueva con el refresh token; si expira, la UI vuelve a pedir ingreso sin perder el borrador en edición (se reintenta el guardado).
- Los datos locales previos (`rateos.state`) **no se borran** al iniciar sesión: se ofrecen para importar (ver [SUPABASE_PLAN.md](SUPABASE_PLAN.md#6-migración-de-localstorage-a-supabase)).

## 6. Qué se valida en el frontend y qué en la base (RLS)

| Control | Frontend | Base de datos |
|---|---|---|
| Mostrar u ocultar acciones según el rol | Sí (sólo UX) | — |
| Validación de inputs (rangos, números finitos, textos) | Sí (`validateNumber`, `validateQuote`, `sanitizeText`) | Sí: `CHECK`, `NOT NULL`, tipos, FKs |
| Pertenencia a la organización | — | **RLS** con `organization_members` |
| Permiso por rol (insertar, actualizar, borrar) | — | **RLS** por operación |
| `organization_id` de una fila nueva | La UI lo envía | RLS `WITH CHECK` exige que sea una organización del usuario |
| `created_by`, `updated_by`, `updated_at` | Nunca confiar en lo que envía el cliente | Triggers con `auth.uid()` y `now()` |
| Invitaciones, cambio de OWNER, borrado de organización | Formularios | Edge Function / función `SECURITY DEFINER` revisada |

**Nunca confiar únicamente en filtros del frontend.** Ocultar un botón no es seguridad: cualquier persona puede llamar a la API con su JWT. La autoridad es RLS.

## 7. `createdBy` / `updatedBy`

- Hoy: `null` (sin autenticación). `LocalStorageRepository.stamp()` conserva `createdBy` existente y acepta `updatedBy`.
- Futuro: triggers `before insert/update` asignan `created_by = auth.uid()` (sólo al insertar), `updated_by = auth.uid()` y `updated_at = now()`. El cliente no puede falsificarlos.
- Al migrar datos locales, las filas importadas reciben como `created_by` al usuario que importa.

## 8. Invitaciones

Tabla adicional prevista `organization_invitations` (`id`, `organization_id`, `email`, `role`, `token_hash`, `expires_at`, `invited_by`, `accepted_at`):

1. OWNER/ADMIN invita (un ADMIN no puede invitar OWNER ni ADMIN).
2. Una Edge Function genera un token de un solo uso (se guarda sólo su hash), con vencimiento, y envía el email.
3. El invitado inicia sesión con **ese mismo email**; la función valida token, vencimiento y email y crea la fila en `organization_members`.
4. Las invitaciones vencidas o usadas no se reutilizan. Se puede revocar una invitación pendiente.

## 9. Privacidad

- Guardar sólo lo necesario del usuario: id, email (en `auth.users`) y nombre visible. Sin DNI, CUIL, domicilios ni datos de salud del personal (`employees_or_roles` usa alias o puesto).
- Los datos empresariales quedan aislados por organización (RLS).
- Ningún dato de cotizaciones, costos o salarios se envía a analytics (ver eventos permitidos en [ARCHITECTURE.md](ARCHITECTURE.md#8-eventos-internos-y-privacidad)).
