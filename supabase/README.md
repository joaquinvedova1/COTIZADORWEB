# Supabase de RATEOS

Proyecto: **RATEOS** (`dltlnizvnvnefgbzfftu`, us-east-1). URL pública: `https://dltlnizvnvnefgbzfftu.supabase.co`.

- `migrations/` — esquema versionado. Cada archivo `<versión>_<nombre>.sql` coincide con una fila de `supabase_migrations.schema_migrations` del proyecto (se aplicó con el plugin/MCP de Supabase, `apply_migration`). **Nunca** se modifica la base a mano sin agregar la migración acá.
- `tests/rls_test.sql` — tests de Row Level Security contra la base real. Crea usuarios de prueba A y B dentro de un bloque que siempre termina en `RAISE EXCEPTION`, así que todo se deshace. Resultado esperado: `RLS_TESTS_PASSED: <n> controles`. Correrlo después de cada migración (plugin `execute_sql` o `psql` como `postgres`).
- `tests/beta_security_test.sql` — **Beta Security Gate** (PLAN-2026-015): negación entre empresas A→B y B→A con los IDs reales de la otra (leer, escribir, borrar, altas con `organization_id` ajeno, upsert, columnas de control, filtros manipulados, búsqueda por contenido), roles dentro de una empresa, un miembro quitado, un RATEOS ADMIN sintético (metadata sí, contenido no), anon, un JWT sin usuario y el catálogo en vivo (RLS, grants, `security definer`, Storage, Realtime). Mismo mecanismo (todo se deshace, sin DELETE como postgres). Resultado esperado: `BETA_SECURITY_TESTS_PASSED: <n> controles`.
- `tests/rls_admin_test.sql` — tests del rol de plataforma **RATEOS ADMIN** (bootstrap del master sólo con email confirmado y de un solo uso; metadata/claims que no dan admin; usuario normal y anon sin acceso; admin con metadata pero sin el workspace de otra empresa). Mismo mecanismo (todo se deshace). Resultado esperado: `ADMIN_TESTS_PASSED: <n> controles`.

Los tres se corren **a mano** (plugin/MCP `execute_sql` o `psql` como `postgres`) después de cada migración y antes de cada release: **no corren en CI**, que no tiene credenciales de la base a propósito (en CI el Beta Security Gate sólo verifica que los archivos existan, cubran lo previsto y siempre deshagan). Última ejecución: 2026-10-17 23:44 UTC, antes de v0.8.1 — 132 + 40 + 32 = 204 controles en verde, sin restos.

Con la CLI (opcional):

```bash
supabase link --project-ref dltlnizvnvnefgbzfftu
supabase migration list        # local y remoto deben coincidir
supabase db push               # aplica migraciones nuevas
```

Claves: en el frontend sólo la URL y la **publishable key** (`sb_publishable_…`, `js/config.js`). Nunca `service_role`, `sb_secret_…`, la contraseña de la base ni connection strings con contraseña (ver `docs/SUPABASE_PLAN.md`).
