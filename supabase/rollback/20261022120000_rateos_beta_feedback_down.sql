-- =====================================================================
-- VUELTA ATRÁS de 20261022120000_rateos_beta_feedback.sql
-- (PLAN-2026-029). NO es una migración: se corre a mano, sólo con
-- autorización del dueño, como postgres (SQL Editor o plugin).
--
-- Quita las funciones y las tablas del feedback de la beta. NO toca
-- workspace_states ni ninguna tabla anterior: el feedback nunca lee ni
-- modifica el workspace. Se PIERDEN los problemas y sugerencias recibidos
-- y su historial: antes, exportarlos con las consultas de
-- docs/BETA_FEEDBACK.md §6.
-- Después, borrar la fila de la migración en
-- supabase_migrations.schema_migrations (version = '20261022120000') si
-- se aplicó con la CLI o el plugin.
-- =====================================================================

set local lock_timeout = '10s';

drop function if exists public.submit_feedback(uuid, text, text, text, text, text, text, text);
drop function if exists public.my_feedback(uuid);
drop function if exists public.admin_feedback(text, text);
drop function if exists public.admin_review_feedback(uuid, text, text, uuid);

drop function if exists private.submit_feedback(uuid, text, text, text, text, text, text, text);
drop function if exists private.my_feedback(uuid);
drop function if exists private.admin_feedback(text, text);
drop function if exists private.admin_review_feedback(uuid, text, text, uuid);
drop function if exists private.clean_feedback_text(text);

drop table if exists private.feedback_events;
drop table if exists private.feedback;
