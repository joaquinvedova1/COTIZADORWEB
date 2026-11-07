-- =====================================================================
-- RATEOS — Reportes de problemas desde la app ("Reportar un problema").
--
-- Qué guarda: lo que la persona escribe (qué pasó, qué esperaba, dónde) y
-- contexto TÉCNICO que arma la app (versión, build, pantalla, navegador,
-- tamaño de ventana). NUNCA montos, nombres de clientes, recursos ni el
-- contenido del workspace: la app no los manda y esta función tampoco los
-- busca.
--
-- Seguridad (mismo patrón que RATEOS ADMIN):
-- - private.bug_reports vive en private (no expuesto por la API), con RLS y
--   sin grants: nadie lo lee ni lo escribe directo desde el cliente.
-- - Alta: public.submit_bug_report (invoker) → private.submit_bug_report
--   (definer): sólo con sesión (auth.uid()), valida largos y limita la
--   cantidad por persona (5 cada 10 minutos, 30 por día).
-- - Lectura: sólo RATEOS_ADMIN (public.admin_bug_reports) y la Edge
--   Function bug-report-github (service_role), que crea el issue en GitHub
--   SIN nombre, email ni empresa de quien reporta.
-- =====================================================================

set local lock_timeout = '10s';

create table private.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter_id uuid references auth.users (id) on delete set null,
  what_happened text not null check (char_length(what_happened) between 5 and 4000),
  expected text check (expected is null or char_length(expected) <= 2000),
  where_label text check (where_label is null or char_length(where_label) <= 200),
  route text check (route is null or char_length(route) <= 200),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  app_commit text check (app_commit is null or char_length(app_commit) <= 64),
  browser text check (browser is null or char_length(browser) <= 400),
  viewport text check (viewport is null or char_length(viewport) <= 40),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 8192),
  status text not null default 'nuevo' check (status in ('nuevo', 'revisado', 'resuelto', 'descartado')),
  github_sync_at timestamptz,
  github_issue_number integer,
  github_issue_url text check (github_issue_url is null or github_issue_url like 'https://github.com/%')
);

create index bug_reports_reporter_created on private.bug_reports (reporter_id, created_at desc);
create index bug_reports_created on private.bug_reports (created_at desc);

alter table private.bug_reports enable row level security;
revoke all on table private.bug_reports from public, anon, authenticated;

-- Texto limpio: sin caracteres de control (salvo saltos de línea), recortado.
create or replace function private.clean_report_text(p_value text, p_max integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p_value, ''), '[\x01-\x09\x0b-\x1f\x7f]', '', 'g')), p_max), '');
$$;

revoke all on function private.clean_report_text(text, integer) from public, anon;
grant execute on function private.clean_report_text(text, integer) to authenticated;

create or replace function private.submit_bug_report(p_report jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_what text;
  v_context jsonb;
  v_id uuid;
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
  v_what := private.clean_report_text(p_report ->> 'what_happened', 4000);
  if v_what is null or char_length(v_what) < 5 then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  v_context := case when jsonb_typeof(p_report -> 'context') = 'object' and pg_column_size(p_report -> 'context') <= 8192
                    then p_report -> 'context' else '{}'::jsonb end;
  insert into private.bug_reports (reporter_id, what_happened, expected, where_label, route, app_version, app_commit, browser, viewport, context)
  values (
    v_uid,
    v_what,
    private.clean_report_text(p_report ->> 'expected', 2000),
    private.clean_report_text(p_report ->> 'where_label', 200),
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

revoke all on function private.submit_bug_report(jsonb) from public, anon;
grant execute on function private.submit_bug_report(jsonb) to authenticated;

-- Lista para RATEOS_ADMIN (los últimos 200). Sin email ni nombre de quien reporta.
create or replace function private.admin_bug_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'reference', 'R-' || upper(left(replace(b.id::text, '-', ''), 6)),
      'created_at', b.created_at,
      'what_happened', b.what_happened,
      'expected', b.expected,
      'where_label', b.where_label,
      'app_version', b.app_version,
      'app_commit', b.app_commit,
      'browser', b.browser,
      'status', b.status,
      'github_issue_url', b.github_issue_url
    ) order by b.created_at desc)
    from (select * from private.bug_reports order by created_at desc limit 200) b
  ), '[]'::jsonb);
end;
$$;

revoke all on function private.admin_bug_reports() from public, anon;
grant execute on function private.admin_bug_reports() to authenticated;

-- Puente a GitHub (sólo service_role, desde la Edge Function bug-report-github).
-- Reserva el reporte de QUIEN LO MANDÓ si todavía no tiene issue (una sola
-- vez cada 10 minutos, así dos llamadas no crean dos issues).
create or replace function private.claim_bug_report_for_github(p_id uuid, p_reporter uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row private.bug_reports%rowtype;
begin
  update private.bug_reports b
     set github_sync_at = now()
   where b.id = p_id
     and b.reporter_id = p_reporter
     and b.github_issue_number is null
     and (b.github_sync_at is null or b.github_sync_at < now() - interval '10 minutes')
  returning * into v_row;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'reference', 'R-' || upper(left(replace(v_row.id::text, '-', ''), 6)),
    'created_at', v_row.created_at,
    'what_happened', v_row.what_happened,
    'expected', v_row.expected,
    'where_label', v_row.where_label,
    'route', v_row.route,
    'app_version', v_row.app_version,
    'app_commit', v_row.app_commit,
    'browser', v_row.browser,
    'viewport', v_row.viewport,
    'context', v_row.context
  );
end;
$$;

create or replace function private.set_bug_report_github(p_id uuid, p_number integer, p_url text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update private.bug_reports set github_issue_number = p_number, github_issue_url = p_url where id = p_id;
$$;

revoke all on function private.claim_bug_report_for_github(uuid, uuid) from public, anon, authenticated;
revoke all on function private.set_bug_report_github(uuid, integer, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.claim_bug_report_for_github(uuid, uuid) to service_role;
grant execute on function private.set_bug_report_github(uuid, integer, text) to service_role;

-- ---------------------------------------------- API (wrappers sin privilegios)

create or replace function public.submit_bug_report(p_report jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.submit_bug_report(p_report);
$$;

create or replace function public.admin_bug_reports()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.admin_bug_reports();
$$;

create or replace function public.claim_bug_report_for_github(p_id uuid, p_reporter uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.claim_bug_report_for_github(p_id, p_reporter);
$$;

create or replace function public.set_bug_report_github(p_id uuid, p_number integer, p_url text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_bug_report_github(p_id, p_number, p_url);
$$;

revoke all on function public.submit_bug_report(jsonb) from public, anon;
revoke all on function public.admin_bug_reports() from public, anon;
revoke all on function public.claim_bug_report_for_github(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_bug_report_github(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.submit_bug_report(jsonb) to authenticated;
grant execute on function public.admin_bug_reports() to authenticated;
grant execute on function public.claim_bug_report_for_github(uuid, uuid) to service_role;
grant execute on function public.set_bug_report_github(uuid, integer, text) to service_role;
