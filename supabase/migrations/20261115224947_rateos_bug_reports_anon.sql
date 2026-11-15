-- =====================================================================
-- RATEOS — "Reportar un problema" para TODOS (con o sin cuenta) y en qué
-- paso fue.
--
-- Hasta acá sólo se podía enviar con sesión; sin sesión (demo, sitio
-- público) el reporte iba a GitHub y pedía una cuenta de GitHub, así que en
-- la práctica no llegaba ninguno. Ahora:
--
-- - Sin sesión el reporte entra por la Edge Function "bug-report-submit"
--   (service_role). La base NO le da nada a anon (SEC-03 sigue igual): la
--   función de alta sin sesión sólo la ejecuta service_role.
-- - Límite sin sesión: por origen (source_key = hash del IP que arma la
--   Edge Function; nunca el IP) 5 cada 10 minutos y 30 por día, y un tope
--   GLOBAL de 40 cada 10 minutos y 300 por día para que nadie llene la tabla.
-- - Columnas nuevas: step (paso de la cotización que eligió la persona),
--   source_key, triage_note y triaged_at (revisión). Estado nuevo:
--   'a_corregir'.
-- =====================================================================

set local lock_timeout = '10s';

alter table private.bug_reports
  add column if not exists step text check (step is null or char_length(step) <= 80),
  add column if not exists source_key text check (source_key is null or source_key ~ '^[a-f0-9]{16,64}$'),
  add column if not exists triage_note text check (triage_note is null or char_length(triage_note) <= 4000),
  add column if not exists triaged_at timestamptz;

alter table private.bug_reports drop constraint if exists bug_reports_status_check;
alter table private.bug_reports add constraint bug_reports_status_check
  check (status in ('nuevo', 'revisado', 'a_corregir', 'resuelto', 'descartado'));

create index if not exists bug_reports_source_created on private.bug_reports (source_key, created_at desc) where reporter_id is null;

-- Inserta un reporte ya validado (común a con y sin sesión).
create or replace function private.insert_bug_report(p_report jsonb, p_reporter uuid, p_source_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_what text;
  v_context jsonb;
  v_id uuid;
begin
  v_what := private.clean_report_text(p_report ->> 'what_happened', 4000);
  if v_what is null or char_length(v_what) < 5 then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  v_context := case when jsonb_typeof(p_report -> 'context') = 'object' and pg_column_size(p_report -> 'context') <= 8192
                    then p_report -> 'context' else '{}'::jsonb end;
  insert into private.bug_reports (reporter_id, source_key, what_happened, expected, where_label, step, route, app_version, app_commit, browser, viewport, context)
  values (
    p_reporter,
    p_source_key,
    v_what,
    private.clean_report_text(p_report ->> 'expected', 2000),
    private.clean_report_text(p_report ->> 'where_label', 200),
    private.clean_report_text(p_report ->> 'step', 80),
    private.clean_report_text(p_report ->> 'route', 200),
    private.clean_report_text(p_report ->> 'app_version', 40),
    private.clean_report_text(p_report ->> 'app_commit', 64),
    private.clean_report_text(p_report ->> 'browser', 400),
    private.clean_report_text(p_report ->> 'viewport', 40),
    v_context
  )
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'reference', 'R-' || upper(left(replace(v_id::text, '-', ''), 6)));
end;
$$;

revoke all on function private.insert_bug_report(jsonb, uuid, text) from public, anon, authenticated;

-- Con sesión: igual que antes (sólo con auth.uid(), 5 cada 10 min / 30 por día), ahora guarda el paso.
create or replace function private.submit_bug_report(p_report jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if (select count(*) from private.bug_reports b where b.reporter_id = v_uid and b.created_at >= now() - interval '10 minutes') >= 5
     or (select count(*) from private.bug_reports b where b.reporter_id = v_uid and b.created_at >= now() - interval '1 day') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return private.insert_bug_report(p_report, v_uid, null);
end;
$$;

-- Sin sesión: sólo service_role (Edge Function bug-report-submit).
create or replace function private.submit_public_bug_report(p_report jsonb, p_source_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if p_source_key is null or p_source_key !~ '^[a-f0-9]{16,64}$' then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if (select count(*) from private.bug_reports b where b.reporter_id is null and b.source_key = p_source_key and b.created_at >= now() - interval '10 minutes') >= 5
     or (select count(*) from private.bug_reports b where b.reporter_id is null and b.source_key = p_source_key and b.created_at >= now() - interval '1 day') >= 30
     or (select count(*) from private.bug_reports b where b.reporter_id is null and b.created_at >= now() - interval '10 minutes') >= 40
     or (select count(*) from private.bug_reports b where b.reporter_id is null and b.created_at >= now() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  return private.insert_bug_report(p_report, null, p_source_key);
end;
$$;

revoke all on function private.submit_public_bug_report(jsonb, text) from public, anon, authenticated;
grant execute on function private.submit_public_bug_report(jsonb, text) to service_role;

create or replace function public.submit_public_bug_report(p_report jsonb, p_source_key text)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.submit_public_bug_report(p_report, p_source_key);
$$;

revoke all on function public.submit_public_bug_report(jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_public_bug_report(jsonb, text) to service_role;
