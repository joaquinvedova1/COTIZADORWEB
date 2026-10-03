# Plan de evolución a Supabase

> **Estado: NO implementado.** RATEOS v0.1.0 funciona 100 % en el navegador con `localStorage`. No hay Supabase, backend, login ni RLS. Este plan describe cómo llegar a **RATEOS + Supabase + Auth + multiempresa** sin reescribir motores económicos, modelos de cálculo, reglas comerciales ni escenarios.

Documentos relacionados: [DATA_MODEL.md](DATA_MODEL.md) (tablas y mapeo), [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md) (roles y sesión), [ARCHITECTURE.md](ARCHITECTURE.md) (capas).

## 1. Qué NO cambia

- `js/engines/**` (CostEngine, PricingEngine, BreakEvenEngine, UtilizationEngine, ScenarioEngine, FinancialEngine, CommercialRulesEngine) y sus tests, incluidos los golden cases.
- `js/domain/**` (catálogos, fábricas) y `js/core/**`.
- El objeto `quote` plano que reciben los motores: `SupabaseRepository` lo reconstruye igual que hoy.
- El formato del backup JSON (sigue existiendo como exportación portable).
- Las vistas: siguen usando servicios (`app.ctx.*`); sólo se agregan pantallas de ingreso, organización y miembros.

## 2. Tablas previstas y relaciones

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

`OWNER`, `ADMIN`, `ESTIMATOR`, `VIEWER` en `organization_members.role`. Matriz completa en [AUTH_ARCHITECTURE.md §4](AUTH_ARCHITECTURE.md#4-roles).

## 4. Estrategia de Row Level Security

Reglas:

1. **TODAS** las tablas con datos empresariales tienen RLS habilitada (`alter table … enable row level security`). Una tabla sin políticas no devuelve nada: es el estado seguro por defecto.
2. Regla conceptual: **un usuario sólo puede leer o modificar registros de organizaciones de las cuales es miembro**, con las acciones que permite su rol.
3. **Nunca** confiar sólo en filtros del frontend (`.eq('organization_id', …)` es comodidad, no seguridad).
4. Las políticas se prueban con tests automáticos (usuario miembro, no miembro, cada rol) antes de habilitar `FEATURES.supabase`.

Funciones auxiliares (ejemplo):

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
| URL del proyecto y **anon key** | Frontend (`js/config.js` o similar). Son públicas por diseño: la seguridad la da RLS. | — |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Sólo en secretos de Edge Functions / entorno de servidor. | Navegador, GitHub Pages, JavaScript público, repositorio (aunque sea privado), backups JSON, issues, logs. |
| Tokens de sesión de usuario | Los maneja el cliente de Supabase dentro de `js/data/`. | Logs, analytics, backups. |

- Las operaciones privilegiadas (invitaciones, importación masiva, cambio de OWNER, borrado de organización) se ejecutan en **Edge Functions** que validan JWT, membresía y rol.
- `.gitignore` ya excluye `.env`, `.env.*`, `secrets/`, `*.pem`, `*.key` y credenciales. No se versiona `.env` con claves reales.

## 6. Migración de localStorage a Supabase

Flujo para el usuario (sin perder datos locales):

```
Exportar backup local (JSON)  ──►  Iniciar sesión  ──►  Crear organización (queda OWNER)
        ──►  Importar el backup  ──►  Guardar en Supabase  ──►  Verificar  ──►  (opcional) seguir usando local
```

1. **Exportar**: Configuración → Backup → Exportar (formato `schemaVersion` versionado, ver [DATA_MODEL.md §2](DATA_MODEL.md#2-modelo-actual--formato-del-estado-y-del-backup)). Si el usuario ya está logueado, la app puede leer el estado local directamente (mismo formato).
2. **Login** con Supabase Auth.
3. **Crear organización** (RPC/Edge Function `create_organization`): crea `organizations`, `settings` y la membresía `OWNER`.
4. **Importar** (Edge Function `import-backup`, en una transacción):
   - Validar tamaño (≤ 5 MB) y JSON; aplicar **las mismas** funciones puras `migrateState` y `validateState` de `js/data/` (no dependen del navegador).
   - Mostrar el mismo resumen que hoy y pedir confirmación.
   - Mapear el JSON a tablas según [DATA_MODEL.md](DATA_MODEL.md#mapeo-modelo-actual--tablas).
5. **Guardar** y verificar conteos (cotizaciones, recursos, plantillas) contra el resumen.
6. Los datos locales **no se borran** automáticamente (nunca `localStorage.clear()`); el usuario decide.

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

- Archivo previsto: `js/data/supabase-repository.js`; clase que extiende `StorageRepository` e implementa **todos** sus métodos asíncronos (`init`, `getOrganization`, `saveOrganization`, `getResources`, `getResource`, `saveResource`, `updateResource`, `deleteResource`, `getQuotes`, `getQuote`, `saveQuote`, `updateQuote`, `deleteQuote`, `getServices`, `saveService`, `deleteService`, `getSettings`, `saveSettings`, `exportBackup`, `importBackup`).
- Se activa con `STORAGE_MODE = 'supabase'` (o elección en tiempo de ejecución tras el login) y `FEATURES.supabase = true`, sólo en `js/data/repository-factory.js`.
- Convierte filas ↔ objetos planos idénticos a los actuales (`quote` reconstruido desde `quotes` + `quote_resources` + `commercial_rules`).
- Errores como `RepositoryError` con códigos (`not_found`, `read_only`, `write_failed`, `validation_failed`, …) para que la UI los muestre igual que hoy.
- `exportBackup()` genera el mismo JSON versionado (portabilidad y salida del proveedor).
- Guardado: mismo patrón actual (debounce en el editor, una escritura por cambio); conflictos de edición concurrente se detectan con `updated_at` (si cambió en el servidor, avisar en lugar de pisar).

## 8. Estrategia de backup

| Capa | Mecanismo |
|---|---|
| Usuario | El **export JSON** sigue existiendo para todos los roles con permiso (portabilidad, auditoría, salida del proveedor). |
| Base de datos | Backups diarios automáticos de Supabase (según plan) y **PITR** (Point-in-Time Recovery) cuando el volumen de datos lo justifique. |
| Organización | Export lógico periódico (`pg_dump` o export por organización) guardado cifrado fuera del repositorio. |
| Verificación | Prueba de restauración periódica en un proyecto separado; nunca restaurar sobre producción sin un backup previo. |
| Borrados | Las cotizaciones pueden usar borrado lógico (`deleted_at`) para poder restaurarlas; el borrado definitivo, por política explícita. |

## 9. Checklist de seguridad (antes de habilitar `FEATURES.supabase`)

- [ ] RLS habilitada en **todas** las tablas con datos empresariales (consulta que lo verifique en CI).
- [ ] Políticas por operación (`select`, `insert`, `update`, `delete`) y por rol, con tests para miembro / no miembro / cada rol.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` sólo en Edge Functions; búsqueda de secretos en el repo sin resultados.
- [ ] Triggers de auditoría (`created_by`, `updated_by`, `updated_at`) y bloqueo de cambio de `organization_id`.
- [ ] Funciones `security definer` con `search_path` fijo y revisadas por el rol Security (ver [AGENT_ROLES.md](AGENT_ROLES.md)).
- [ ] Importación transaccional, con validación, límite de tamaño, remapeo de `organizationId` e ids.
- [ ] CSP de `index.html` actualizada para permitir sólo el dominio del proyecto Supabase en `connect-src`.
- [ ] Sin datos sensibles en logs (logger de producción sin contexto) ni en analytics.
- [ ] Rate limiting y confirmación de email en Auth; invitaciones con token de un solo uso.
- [ ] Plan de backup y restauración probado.
- [ ] Los motores y golden cases pasan sin cambios.

## 10. Plan por fases

Cada fase se planifica en [.agent/PLANS.md](../.agent/PLANS.md) y llega a `main` por Pull Request con tests.

| Fase | Alcance | Criterio de salida |
|---|---|---|
| 0 — hoy (v0.1.0) | localStorage, `StorageRepository`, `schemaVersion`, backup JSON, documentación | MVP en producción |
| 1 — Esquema | Proyecto Supabase, tablas, índices, RLS, triggers, tests de políticas. Sin cambios en la UI. | Tests de RLS en verde |
| 2 — Auth + repositorio | Supabase Auth, `SupabaseRepository` detrás de `FEATURES.supabase`; el modo local sigue siendo el predeterminado | Mismos tests de servicios con ambos repositorios |
| 3 — Migración e invitaciones | Importador local → Supabase, roles, invitaciones | Migración idempotente probada con el backup demo |
| 4 — Multiempresa | `FEATURES.multiOrganization`, selector de organización, snapshots `cost_structures` | Aislamiento verificado entre organizaciones |
| 5 — Estimado vs real | `services`, `actual_costs`, `FEATURES.historicalComparison` | Comparación reproducible con el mismo motor |
