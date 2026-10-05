# Supabase de RATEOS

Proyecto: **RATEOS** (`dltlnizvnvnefgbzfftu`, us-east-1). URL pública: `https://dltlnizvnvnefgbzfftu.supabase.co`.

- `migrations/` — esquema versionado. Cada archivo `<versión>_<nombre>.sql` coincide con una fila de `supabase_migrations.schema_migrations` del proyecto (se aplicó con el plugin/MCP de Supabase, `apply_migration`). **Nunca** se modifica la base a mano sin agregar la migración acá.
- `tests/rls_test.sql` — tests de Row Level Security contra la base real. Crea usuarios de prueba A y B dentro de un bloque que siempre termina en `RAISE EXCEPTION`, así que todo se deshace. Resultado esperado: `RLS_TESTS_PASSED: <n> controles`. Correrlo después de cada migración (plugin `execute_sql` o `psql` como `postgres`).

Con la CLI (opcional):

```bash
supabase link --project-ref dltlnizvnvnefgbzfftu
supabase migration list        # local y remoto deben coincidir
supabase db push               # aplica migraciones nuevas
```

Claves: en el frontend sólo la URL y la **publishable key** (`sb_publishable_…`, `js/config.js`). Nunca `service_role`, `sb_secret_…`, la contraseña de la base ni connection strings con contraseña (ver `docs/SUPABASE_PLAN.md`).
