# Plan de evolución a Supabase

> **Estado: fases 1 y 2 implementadas** (identidad, Auth, workspace por organización con RLS y `SupabaseRepository`). Proyecto `dltlnizvnvnefgbzfftu` (us-east-1). Migraciones versionadas en [`supabase/migrations/`](../supabase/migrations/) y aplicadas con el plugin/MCP de Supabase; tests de RLS en [`supabase/tests/rls_test.sql`](../supabase/tests/rls_test.sql). El modelo **normalizado** (una tabla por entidad) de §2 y §4 sigue siendo el plan para las fases siguientes. Motores, modelos de cálculo, reglas comerciales y escenarios **no cambiaron**.

Documentos relacionados: [DATA_MODEL.md](DATA_MODEL.md) (tablas y mapeo), [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md) (roles y sesión), [ARCHITECTURE.md](ARCHITECTURE.md) (capas), [`supabase/README.md`](../supabase/README.md) (cómo aplicar migraciones y correr los tests).

## 0. Qué está implementado

### Decisión: un workspace JSON por organización (no el modelo normalizado, todavía)

Se evaluaron dos opciones para la primera versión con cuentas:

| | `workspace_states` (jsonb por organización) | Modelo normalizado (§2) |
|---|---|---|
| Cambios en motores / dominio / validación | Ninguno: es el **mismo estado versionado** (`schemaVersion`, migraciones, `validateState`, backup) | Mapeo filas ↔ objetos para cada entidad |
| Riesgo de romper datos o cálculos | Bajo: `SupabaseRepository` hereda de `LocalStorageRepository` | Alto: ~15 tablas, importador, idempotencia |
| RLS | 4 tablas, 7 políticas, fáciles de probar | Políticas por tabla y operación |
| Concurrencia | Una revisión por organización (conflicto visible) | Por fila (más fino) |
| Límites | Tamaño (≤ 5 MB por organización), sin consultas SQL por entidad | Escala sin límite práctico |

**Se eligió `workspace_states`** por ser lo más simple que cumple las reglas (datos por cuenta, RLS en Postgres, sin tocar motores) y porque una PyME tiene decenas o pocos cientos de cotizaciones (muy por debajo de 5 MB). Pasar al modelo normalizado es una migración futura: el formato del estado es el mismo que el del backup, que ya está documentado en [DATA_MODEL.md](DATA_MODEL.md#mapeo-modelo-actual--tablas).

### Tablas (schema `public`)

| Tabla | Columnas principales | Quién escribe |
|---|---|---|
| `organizations` | `id`, `name` (1–120), `created_at`, `updated_at` | Alta (trigger). `name`: OWNER / ADMIN. |
| `profiles` | `id` → `auth.users`, `full_name` (≤ 120) | Alta (trigger). `full_name`: el propio usuario. |
| `organization_members` | PK (`organization_id`, `user_id`), `role` ∈ OWNER / ADMIN / ESTIMATOR / VIEWER | Sólo el alta (trigger). Sin `insert/update/delete` desde el cliente. |
| `workspace_states` | `organization_id` (único), `state` jsonb (objeto, ≤ 5 MB), `schema_version`, `revision`, `updated_by`, `updated_at` | `state` y `schema_version`: OWNER / ADMIN / ESTIMATOR, con control de revisión. |

### Seguridad en Postgres

- **RLS habilitada en las 4 tablas.** `revoke all` a `anon` y `authenticated`; después sólo: `select` en las 4 tablas y `update` **por columna** (`organizations.name`, `profiles.full_name`, `workspace_states.state` y `schema_version`). `anon` no tiene ningún permiso.
- Políticas: `profiles_select_own` / `profiles_update_own` (`id = auth.uid()`), `organizations_select_member` / `organizations_update_admin`, `organization_members_select` (miembros de mis organizaciones), `workspace_states_select_member` / `workspace_states_update_editor` (OWNER, ADMIN, ESTIMATOR). Sin políticas de `insert` ni `delete`.
- Funciones auxiliares en el schema **`private`** (no expuesto por la API): `private.is_member(org)` y `private.has_role(org, roles[])`, `security definer` con `search_path = ''` (evitan recursión de RLS en `organization_members`). `usage` del schema sólo para `authenticated`.
- Triggers: `private.workspace_before_update` fija `revision = old.revision + 1`, `organization_id = old.organization_id`, `updated_by = auth.uid()` y `updated_at = now()` (el cliente no puede falsificarlos); `private.touch_row` para `updated_at`; `on_auth_user_created` → `private.handle_new_user` (alta, ver [AUTH_ARCHITECTURE.md §3](AUTH_ARCHITECTURE.md#3-registro-confirmación-de-email-y-alta-de-la-empresa)), que sanea nombre y empresa (sin caracteres de control, ≤ 120).
- `public.rls_auto_enable()` (función que trae el proyecto) quedó sin permiso de ejecución para `public`, `anon` y `authenticated`.
- **Tests:** `supabase/tests/rls_test.sql` (40 controles, todo dentro de un bloque que termina con `RAISE EXCEPTION`: no deja nada en la base) — lectura y escritura cruzada A/B, anon, autoasignarse OWNER, sumar miembros, borrar, columnas de control, revisión vieja, usuario sin membresía. `tests/supabase/migrations.test.js` verifica en cada `npm test` que las migraciones habiliten RLS en toda tabla, no den permisos a `anon`, no tengan políticas de `insert/delete`, que las funciones `security definer` vivan en `private` con `search_path` vacío y que no haya secretos.
- Advisors de seguridad de Supabase: sin hallazgos.

### Control de concurrencia (revisión)

```
guardar:  update workspace_states set state = …, schema_version = …
          where organization_id = <org> and revision = <revisión con la que se abrió>
          → 1 fila: OK (la base devuelve la revisión nueva)
          → 0 filas: se relee la revisión: distinta = CONFLICTO; igual = sin permiso (RLS)
```

Nunca hay *last-write-wins* silencioso: ante un conflicto la app muestra "Tus datos cambiaron en otro dispositivo." con **[Recargar]** (abre la versión de la nube; antes guarda la versión local en una copia de recuperación) y **[Conservar una copia]** (descarga la versión local como backup JSON), y bloquea más escrituras hasta resolverlo.

## 1. Qué NO cambia

- `js/engines/**` (CostEngine, PricingEngine, BreakEvenEngine, UtilizationEngine, ScenarioEngine, FinancialEngine, CommercialRulesEngine) y sus tests, incluidos los golden cases.
- `js/domain/**` (catálogos, fábricas) y `js/core/**`.
- El objeto `quote` plano que reciben los motores: `SupabaseRepository` lo reconstruye igual que hoy.
- El formato del backup JSON (sigue existiendo como exportación portable).
- Las vistas: siguen usando servicios (`app.ctx.*`); sólo se agregan pantallas de ingreso, organización y miembros.

## 2. Modelo normalizado previsto (fase 4): tablas y relaciones

Detalle de columnas en [DATA_MODEL.md §4](DATA_MODEL.md#4-modelo-futuro-relacional-supabase--postgresql).

| Tabla | Relación principal | Origen en el modelo actual |
|---|---|---|
| `organizations` | raíz de la multiempresa | `organization` |
| `users` | 1:1 con `auth.users` | — |
| `organization_members` | `users` N:M `organizations` con `role` | — |
| `settings` | 1:1 `organizations` | `settings` |
| `labor_agreements` | N:1 `organizations` | `resources.agreements` |
| `labor_profiles` | N:1 `labor_agreements` | `resources.laborProfiles` |
| `employees_or_roles` | N:1 `labor_profiles` | (nuevo) |
| `equipment` | N:1 `organizations` | `resources.equipment` |
| `materials` | N:1 `organizations` | `resources.materials` |
| `locations` | N:1 `organizations` | `resources.locations` |
| `service_templates` | N:1 `organizations` | `services` |
| `quotes` | N:1 `organizations`, N:1 `service_templates` | `quotes[]` |
| `quote_resources` | N:1 `quotes` | `quote.labor/equipment/materials/otherCosts/logistics.vehicles` |
| `commercial_rules` | 1:1 `quotes` | `quote.rules` |
| `quote_scenarios` | N:1 `quotes` | (nuevo; hoy se calculan) |
| `cost_structures` | N:1 `quotes` (snapshots) | (nuevo) |
| `services` | N:1 `quotes` (servicio en ejecución) | (nuevo) |
| `actual_costs` | N:1 `services` / `quotes` | (nuevo, estimado vs real) |

Todas las tablas con datos empresariales llevan `organization_id` (también las hijas como `quote_resources`, desnormalizado a propósito para que las políticas RLS sean simples y rápidas).

## 3. Roles

`OWNER`, `ADMIN`, `ESTIMATOR`, `VIEWER` en `organization_members.role`. Hoy y matriz prevista en [AUTH_ARCHITECTURE.md §6](AUTH_ARCHITECTURE.md#6-modelo-de-pertenencia-y-roles).

## 4. Estrategia de Row Level Security (modelo normalizado, fase 4)

Reglas:

1. **TODAS** las tablas con datos empresariales tienen RLS habilitada (`alter table … enable row level security`). Una tabla sin políticas no devuelve nada: es el estado seguro por defecto.
2. Regla conceptual: **un usuario sólo puede leer o modificar registros de organizaciones de las cuales es miembro**, con las acciones que permite su rol.
3. **Nunca** confiar sólo en filtros del frontend (`.eq('organization_id', …)` es comodidad, no seguridad).
4. Las políticas se prueban con tests automáticos (usuario miembro, no miembro, cada rol) antes de usarlas en producción (como `supabase/tests/rls_test.sql`).

Funciones auxiliares (ejemplo; las implementadas viven en el schema `private`, ver §0):

```sql
create or replace function public.is_member(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_role(org uuid, roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;
```

Políticas de ejemplo para `quotes` (el mismo patrón aplica a `quote_resources`, `commercial_rules`, `quote_scenarios`, `cost_structures`, `services`, `actual_costs`):

```sql
alter table public.quotes enable row level security;

create policy quotes_select on public.quotes
  for select to authenticated
  using (public.is_member(organization_id));

create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (public.has_role(organization_id, array['OWNER','ADMIN','ESTIMATOR']));

create policy quotes_update on public.quotes
  for update to authenticated
  using (public.has_role(organization_id, array['OWNER','ADMIN','ESTIMATOR']))
  with check (public.has_role(organization_id, array['OWNER','ADMIN','ESTIMATOR']));

create policy quotes_delete on public.quotes
  for delete to authenticated
  using (
    public.has_role(organization_id, array['OWNER','ADMIN'])
    or (public.has_role(organization_id, array['ESTIMATOR'])
        and created_by = (select auth.uid()) and status = 'draft')
  );
```

Bibliotecas, plantillas y configuración (`labor_agreements`, `labor_profiles`, `equipment`, `materials`, `locations`, `service_templates`, `settings`): `select` para miembros; `insert/update/delete` sólo `OWNER` y `ADMIN`.

`organization_members`: cada usuario ve las membresías de sus organizaciones; altas, bajas y cambios de rol sólo por Edge Function o función `security definer` revisada (evita que un ADMIN se promueva a OWNER).

Auditoría (trigger en todas las tablas empresariales):

```sql
create or replace function public.set_audit_fields()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := coalesce(new.created_at, now());   -- conserva la fecha original al importar
  else
    new.organization_id := old.organization_id;          -- una fila no cambia de organización
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
```

## 5. Claves y secretos

| Credencial | Dónde puede vivir | Dónde NUNCA |
|---|---|---|
| URL del proyecto y **publishable key** (`sb_publishable_…`; o la anon key en proyectos con el esquema anterior) | Frontend: `js/config.js` (`SUPABASE`). Son públicas por diseño: la seguridad la da RLS. | — |
| **Secret keys** (`sb_secret_…`), **`service_role`**, contraseña de la base, connection string, JWT secret | Sólo en el Dashboard de Supabase o en secretos de Edge Functions / servidor. | Navegador, GitHub Pages, JavaScript, HTML, CSS, `dist/`, `version.json`, repositorio (aunque sea privado), backups JSON, issues, logs. |
| Sesión del usuario (JWT + refresh token) | La maneja el SDK en `localStorage['rateos.auth']`. | Logs, eventos, backups, URLs. |
| Contraseñas | Sólo Supabase Auth (hash). | Cualquier lugar de RATEOS. |

- `tests/architecture.test.js` busca en todo el repo patrones de secretos (incluidos `sb_secret_`, JWT de `service_role` y connection strings con contraseña) y falla si encuentra alguno. La publishable key no se marca.
- La CSP de `index.html` permite `connect-src` sólo a `'self'` y a la URL del proyecto.
- Las operaciones privilegiadas futuras (invitaciones, cambio de OWNER, borrado de organización) irán en **Edge Functions** que validan JWT, membresía y rol.
- `.gitignore` excluye `.env`, `.env.local`, `.env.*` (salvo `.env.example`), `secrets` (archivo o carpeta), `secrets.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*credentials*`, `*credenciales*`, `*service-account*.json` y `.npmrc`.

## 6. Migración de localStorage a Supabase

**Implementado (datos del modo local anterior → cuenta):** quien usó RATEOS sin cuenta tiene sus datos en `localStorage['rateos.state']`. Al ingresar:

1. `readLegacyLocalData()` (`js/data/legacy-local.js`) **lee sin escribir** `rateos.state`, lo migra en memoria (`migrateState`) y `extractRealData()` (`js/domain/real-data.js`) separa los datos propios: **nunca** la demo, nada `illustrative: true`, ni los ids de la demo (`00000000-0000-4000-8000-…`), ni la empresa ficticia, ni la configuración ILUSTRATIVA.
2. Si hay datos propios, la app muestra **"Encontramos datos guardados en este navegador."** con **[Importarlos a mi cuenta]** y **[Empezar en limpio]**. Nada se importa solo.
3. Importar: copia de seguridad del texto original (copia de recuperación `before-cloud-import` de la cuenta, visible en Configuración → Datos y backup), copia de recuperación del estado de la nube (`before-local-import`), y después `importLocalData()` **suma** lo que falta por `id` (no pisa lo que ya está en la cuenta), reasigna `organizationId` a la organización de la cuenta y renumera códigos `COT-…` repetidos. Se sube a la nube con control de revisión.
4. `rateos.state` **nunca se borra** (ni con "Empezar en limpio"). La decisión se recuerda por usuario (`rateos.cloud.<usuario>.local-import`).

Un **backup JSON** importado en Configuración → Datos y backup también queda dentro de la organización de la cuenta: todos sus `organizationId` se reemplazan por el de la cuenta (`remapToCloudOrganization`), aunque el archivo diga otra cosa.

**Pendiente para el modelo normalizado (fase 3):** importador transaccional por tabla con estas reglas:

Reglas de mapeo e idempotencia:

| Regla | Detalle |
|---|---|
| Remapear `organizationId` | Todos los `organizationId` del backup se reemplazan por el id de la organización destino. Nunca se confía en el del archivo. |
| Idempotencia por `id` UUID | Se hace *upsert* por `id`: reimportar el mismo backup en la misma organización actualiza, no duplica. |
| Colisiones de ids | Los datos demo usan UUID **fijos** (`00000000-0000-4000-8000-…`) que se repiten entre usuarios, y datos legados pueden tener ids no UUID. Si un id no es UUID o ya existe en **otra** organización, se genera un UUID nuevo y se remapean las referencias internas (`agreementId`, `templateId`, `sourceId`). |
| Referencias | `laborProfiles.agreementId` → `labor_profiles.agreement_id`; `quote.templateId` → `quotes.template_id`; `sourceId` de líneas → `quote_resources.source_id` (referencia blanda: el recurso pudo haberse borrado). |
| Metadatos | Se conservan `createdAt`/`updatedAt` originales; `created_by`/`updated_by` = usuario que importa. |
| `legacy` | No se importa (queda en el archivo). |
| Datos ILUSTRATIVOS | Se importan con `illustrative = true` y la UI sigue mostrando el aviso. |

## 7. `SupabaseRepository`

Implementado en `js/data/supabase-repository.js`:

- **Extiende `LocalStorageRepository`** sobre un storage en memoria: entidades, sellos, validación, migraciones, backup e importación son el mismo código. Los motores no saben que existe.
- `init()` carga el workspace de la organización (RLS), retoma cambios locales pendientes si la revisión coincide, o — si otro dispositivo guardó mientras tanto — abre la nube y deja los cambios locales en una copia de recuperación (nunca pisa nada).
- **Cada escritura espera la confirmación de la nube:** "Guardado" significa guardado en la cuenta. Si falla, el método rechaza con un `RepositoryError` claro (`sync_failed`, `conflict`, `session_expired`, `forbidden`, `too_large`), el cambio queda en memoria y en la **copia local recuperable** (`localStorage['rateos.cloud.<usuario>.<organización>']`, sólo mientras haya cambios sin subir), y se reintenta (3 s, 10 s, 30 s, 60 s). La interfaz nunca dice "guardado" si sólo quedó en el navegador: "No pudimos sincronizar tus cambios."
- La copia local es por usuario **y** organización y se valida al leerla: otra persona en el mismo navegador nunca la toma. Las **copias de recuperación** de la cuenta (conflictos, antes de importar) también: van con el prefijo `rateos.cloud.<usuario>.<organización>.recovery.` y sólo esa cuenta las ve, descarga o restaura (en pantalla y en el archivo, sólo fecha y motivo).
- `resetToDemo()` está deshabilitado: la demo vive sólo en la página pública.
- VIEWER → sólo lectura.
- `js/data/workspace-gateway.js` es la única puerta a PostgREST; `createAccountContext()` (`js/services/app-context.js`) arma los servicios de la cuenta con este repositorio.

## 8. Estrategia de backup

| Capa | Mecanismo |
|---|---|
| Usuario | El **export JSON** sigue existiendo para todos los roles con permiso (portabilidad, auditoría, salida del proveedor). |
| Base de datos | Backups diarios automáticos de Supabase (según plan) y **PITR** (Point-in-Time Recovery) cuando el volumen de datos lo justifique. |
| Organización | Export lógico periódico (`pg_dump` o export por organización) guardado cifrado fuera del repositorio. |
| Verificación | Prueba de restauración periódica en un proyecto separado; nunca restaurar sobre producción sin un backup previo. |
| Borrados | Las cotizaciones pueden usar borrado lógico (`deleted_at`) para poder restaurarlas; el borrado definitivo, por política explícita. |

## 9. Checklist de seguridad

Para el workspace actual (cumplido) y para cada tabla nueva del modelo normalizado:

- [x] RLS habilitada en **todas** las tablas con datos empresariales (test estático en `npm test` + `rls_test.sql`).
- [x] Políticas por operación y por rol, con tests para miembro / no miembro / anon / cada operación prohibida.
- [x] Sin secretos en el repo ni en el frontend (sólo URL + publishable key); test de patrones de secretos.
- [x] Columnas de control (`revision`, `updated_by`, `updated_at`, `organization_id`) fijadas por trigger; el cliente no tiene grants sobre ellas.
- [x] Funciones `security definer` en `private`, con `search_path` vacío.
- [x] Remapeo de `organizationId` al importar (backup o datos locales); límite de tamaño (5 MB) en la base.
- [x] CSP con `connect-src` sólo al proyecto de Supabase.
- [x] Sin datos sensibles en logs (logger de producción sin contexto) ni analytics (no hay).
- [x] Confirmación de email activada.
- [ ] **SMTP propio** antes de abrir el registro a clientes (el de Supabase sólo entrega al equipo del proyecto y tiene límite por hora).
- [ ] Revisar los límites de Auth (rate limits) en el Dashboard.
- [ ] Plan de backup y restauración probado (el plan gratuito no incluye PITR).
- [x] Motores y golden cases sin cambios.

## 10. Plan por fases

Cada fase se planifica en [.agent/PLANS.md](../.agent/PLANS.md) y llega a `main` por Pull Request con tests.

| Fase | Alcance | Estado |
|---|---|---|
| 0 | localStorage, `StorageRepository`, `schemaVersion`, backup JSON, documentación | Hecho (v0.1.0) |
| 1 — Esquema | Identidad (`profiles`, `organizations`, `organization_members`), `workspace_states`, RLS, triggers, tests de políticas | **Hecho** |
| 2 — Auth + repositorio | Supabase Auth (registro, confirmación, ingreso, recuperación), `SupabaseRepository`, demo aislada, importación desde el modo local | **Hecho** |
| 3 — Equipo | Invitaciones (Edge Function + token de un solo uso), gestión de roles, SMTP propio | Pendiente |
| 4 — Modelo normalizado | Tablas por entidad (§2), políticas por tabla (§4), importador transaccional, `cost_structures` | Pendiente |
| 5 — Multiempresa y estimado vs real | `FEATURES.multiOrganization`, selector de organización; `services`, `actual_costs`, `FEATURES.historicalComparison` | Pendiente |
