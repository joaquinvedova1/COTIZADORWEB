# Supabase de RATEOS

Proyecto: **RATEOS** (`dltlnizvnvnefgbzfftu`, us-east-1). URL pública: `https://dltlnizvnvnefgbzfftu.supabase.co`.

- `migrations/` — esquema versionado. Cada archivo `<versión>_<nombre>.sql` coincide con una fila de `supabase_migrations.schema_migrations` del proyecto (se aplicó con el plugin/MCP de Supabase, `apply_migration`). **Nunca** se modifica la base a mano sin agregar la migración acá.
- `tests/rls_test.sql` — tests de Row Level Security contra la base real. Crea usuarios de prueba A y B dentro de un bloque que siempre termina en `RAISE EXCEPTION`, así que todo se deshace. Resultado esperado: `RLS_TESTS_PASSED: <n> controles`. Correrlo después de cada migración (plugin `execute_sql` o `psql` como `postgres`).
- `tests/beta_security_test.sql` — **Beta Security Gate** (PLAN-2026-015): negación entre empresas A→B y B→A con los IDs reales de la otra (leer, escribir, borrar, altas con `organization_id` ajeno, upsert, columnas de control, filtros manipulados, búsqueda por contenido), roles dentro de una empresa, un miembro quitado, un RATEOS ADMIN sintético (metadata sí, contenido no), anon, un JWT sin usuario y el catálogo en vivo (RLS, grants, `security definer`, Storage, Realtime). Mismo mecanismo (todo se deshace, sin DELETE como postgres). Resultado esperado: `BETA_SECURITY_TESTS_PASSED: <n> controles`.
- `tests/rls_admin_test.sql` — tests del rol de plataforma **RATEOS ADMIN** (bootstrap del master sólo con email confirmado y de un solo uso; metadata/claims que no dan admin; usuario normal y anon sin acceso; admin con metadata pero sin el workspace de otra empresa). Mismo mecanismo (todo se deshace). Resultado esperado: `ADMIN_TESTS_PASSED: <n> controles`.

- `tests/feedback_test.sql` — feedback de la beta: problemas y sugerencias (PLAN-2026-029, migración `20261022120000`, [docs/BETA_FEEDBACK.md](../docs/BETA_FEEDBACK.md)). Cubre:
  - anon y acceso directo a las tablas, sin permisos;
  - envío con texto limpio y validación;
  - límites contra el spam (por persona, por empresa, abiertos y repetidos);
  - A↔B;
  - RATEOS ADMIN: cola, filtros, estados, respuesta, duplicados e historial;
  - la empresa ve la respuesta;
  - sin cupos ni créditos en el guardado;
  - catálogo.

  Mismo mecanismo (todo se deshace). Resultado esperado: `FEEDBACK_TESTS_PASSED: 64 controles`.
- `tests/local/` — Postgres local **SIMULADO**:
  - `scaffold.sql`: andamiaje mínimo de Supabase.
  - `reset.sh`: recrea la base `rateos_synth` con todas las migraciones.
  - `feedback_concurrency.sh`: concurrencia real con varias sesiones (límite por persona y por empresa con envíos simultáneos, dos revisiones a la vez, feedback y guardado del workspace a la vez). Confirma transacciones, así que **se niega a correr fuera de `rateos_synth`**: nunca contra Supabase.
- `rollback/20261022120000_rateos_beta_feedback_down.sql` — vuelta atrás del feedback (no es una migración; sólo con autorización del dueño; no toca `workspace_states`).

Los tres primeros (y `feedback_test.sql` una vez aplicada su migración) se corren **a mano** (plugin/MCP `execute_sql` o `psql` como `postgres`) después de cada migración y antes de cada release: **no corren en CI**, que no tiene credenciales de la base a propósito (en CI el Beta Security Gate sólo verifica que los archivos existan, cubran lo previsto y siempre deshagan). Última ejecución: 2026-10-17 23:44 UTC, antes de v0.8.1 — 132 + 40 + 32 = 204 controles en verde, sin restos.

`tests/live_ab.sql` es otra cosa: el soporte de la **prueba A/B real** (PLAN-2026-016, `tests/live/perimeter-ab.mjs`, ver [docs/BETA_PERIMETER.md §4](../docs/BETA_PERIMETER.md#4-prueba-ab-real-contra-supabase)). **No se deshace solo**: el bloque 1 deja dos cuentas sintéticas (`perimetro-a@rateos.invalid`, `perimetro-b@rateos.invalid`, contraseñas que se reemplazan al correrlo y nunca van al repo) para poder ingresar de verdad. Los bloques 2 y 3 son de sólo lectura y el 4 borra **sólo** lo sintético (se niega si encuentra cualquier otra cosa), con autorización del dueño. Se corre bloque por bloque, a mano; nunca en CI.

Con la CLI (opcional):

```bash
supabase link --project-ref dltlnizvnvnefgbzfftu
supabase migration list        # local y remoto deben coincidir
supabase db push               # aplica migraciones nuevas
```

Claves: en el frontend sólo la URL y la **publishable key** (`sb_publishable_…`, `js/config.js`). Nunca `service_role`, `sb_secret_…`, la contraseña de la base ni connection strings con contraseña (ver `docs/SUPABASE_PLAN.md`).
