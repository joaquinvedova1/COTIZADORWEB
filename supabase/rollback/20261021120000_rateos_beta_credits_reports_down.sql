-- =====================================================================
-- VUELTA ATRÁS de 20261021120000_rateos_beta_credits_reports.sql
-- (PLAN-2026-029). NO es una migración: se corre a mano, sólo con
-- autorización del dueño, como postgres (SQL Editor o plugin).
--
-- Quita los triggers, las funciones y las tablas de créditos y reportes.
-- NO toca workspace_states.state ni ninguna tabla anterior: el cobro nunca
-- modificó el workspace, así que las cotizaciones y productos quedan como
-- estaban. Se PIERDEN el ledger, los saldos y los reportes: antes,
-- exportarlos con las consultas de docs/BETA_CREDITS.md §7.
-- Después, borrar la fila de la migración en
-- supabase_migrations.schema_migrations (version = '20261021120000') si
-- se aplicó con la CLI o el plugin.
-- =====================================================================

set local lock_timeout = '10s';

drop trigger if exists workspace_states_credit_guard on public.workspace_states;
drop trigger if exists organizations_credit_account on public.organizations;

drop function if exists public.get_my_credits(uuid);
drop function if exists public.credit_preview(uuid, text[], text[]);
drop function if exists public.submit_bug_report(uuid, text, text, text, text, text, text);
drop function if exists public.my_bug_reports(uuid);
drop function if exists public.admin_bug_reports(text);
drop function if exists public.admin_review_bug_report(uuid, text, text, uuid);
drop function if exists public.admin_credit_accounts();

drop function if exists private.get_my_credits(uuid);
drop function if exists private.credit_preview(uuid, text[], text[]);
drop function if exists private.submit_bug_report(uuid, text, text, text, text, text, text);
drop function if exists private.my_bug_reports(uuid);
drop function if exists private.admin_bug_reports(text);
drop function if exists private.admin_review_bug_report(uuid, text, text, uuid);
drop function if exists private.admin_credit_accounts();
drop function if exists private.enable_credit_quota(uuid, integer, text);
drop function if exists private.admin_adjust_credits(uuid, integer, text);
drop function if exists private.workspace_credit_guard();
drop function if exists private.handle_new_organization_credits();
drop function if exists private.workspace_calculation_ids(jsonb, text);
drop function if exists private.clean_report_text(text);

drop table if exists private.credit_ledger;
drop table if exists private.bug_report_events;
drop table if exists private.bug_reports;
drop table if exists private.credit_accounts;
drop table if exists private.beta_policy;
