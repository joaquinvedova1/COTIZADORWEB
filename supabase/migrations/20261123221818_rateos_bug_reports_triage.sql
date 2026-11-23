-- =====================================================================
-- RATEOS — Reportes: tipo, severidad, versión en que se corrigió y
-- seguimiento desde el panel de administración (beta pública).
--
-- - kind: lo elige quien reporta (error, cálculo, texto confuso, no
--   encuentro / no entiendo, sugerencia).
-- - severity, status, fixed_in_version, triage_note: los pone el admin
--   desde #/admin (public.admin_update_bug_report). Nadie más.
-- - context: sólo se guardan las claves esperadas (mode, language, kind);
--   cualquier otra cosa que mande un cliente se descarta (S-03).
-- - admin_bug_reports devuelve los campos de seguimiento. Nunca el
--   reporter_id, el email ni la empresa de quien reporta.
-- - El puente a GitHub (bug-report-github) deja de usarse: los reportes ya
--   no se publican en el repositorio público (S-04). La función SQL queda
--   pero sin uso; la Edge Function se puede borrar del proyecto.
-- =====================================================================

set local lock_timeout = '10s';

alter table private.bug_reports
  add column if not exists kind text check (kind is null or kind in ('error', 'calculo', 'texto', 'no_encuentro', 'sugerencia')),
  add column if not exists severity text check (severity is null or severity in ('critica', 'alta', 'media', 'baja')),
  add column if not exists fixed_in_version text check (fixed_in_version is null or char_length(fixed_in_version) <= 40);

create index if not exists bug_reports_status_created on private.bug_reports (status, created_at desc);

-- Auditoría: también se registra abrir y actualizar los reportes (HD-07).
alter table private.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table private.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('ADMIN_PANEL_OPEN', 'ADMIN_BUG_REPORTS_OPEN', 'ADMIN_BUG_REPORT_UPDATE'));

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
  v_kind text;
  v_mode text;
  v_context jsonb;
  v_id uuid;
begin
  v_what := private.clean_report_text(p_report ->> 'what_happened', 4000);
  if v_what is null or char_length(v_what) < 5 then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  v_kind := coalesce(p_report ->> 'kind', p_report -> 'context' ->> 'kind');
  if v_kind is null or v_kind not in ('error', 'calculo', 'texto', 'no_encuentro', 'sugerencia') then
    v_kind := null;
  end if;
  v_mode := p_report -> 'context' ->> 'mode';
  if v_mode is null or v_mode not in ('cuenta', 'demo', 'publico') then
    v_mode := null;
  end if;
  -- Sólo claves conocidas: nada de lo que un cliente agregue de más.
  v_context := jsonb_strip_nulls(jsonb_build_object(
    'mode', v_mode,
    'language', private.clean_report_text(p_report -> 'context' ->> 'language', 20),
    'kind', v_kind));
  insert into private.bug_reports (reporter_id, source_key, kind, what_happened, expected, where_label, step, route, app_version, app_commit, browser, viewport, context)
  values (
    p_reporter,
    p_source_key,
    v_kind,
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

-- Lista para el panel (sólo RATEOS_ADMIN). Sin datos de quien reporta: sólo
-- si fue con cuenta, demo o sitio público. Queda registrada la apertura.
create or replace function private.admin_bug_reports()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into private.admin_audit_log (actor, action) values (v_uid, 'ADMIN_BUG_REPORTS_OPEN');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'reference', 'R-' || upper(left(replace(b.id::text, '-', ''), 6)),
      'created_at', b.created_at,
      'kind', b.kind,
      'severity', b.severity,
      'status', b.status,
      'step', b.step,
      'where_label', b.where_label,
      'route', b.route,
      'what_happened', b.what_happened,
      'expected', b.expected,
      'app_version', b.app_version,
      'app_commit', b.app_commit,
      'browser', b.browser,
      'viewport', b.viewport,
      'mode', coalesce(b.context ->> 'mode', case when b.reporter_id is null then 'publico' else 'cuenta' end),
      'triage_note', b.triage_note,
      'triaged_at', b.triaged_at,
      'fixed_in_version', b.fixed_in_version
    ) order by b.created_at desc)
    from (select * from private.bug_reports order by created_at desc limit 500) b
  ), '[]'::jsonb);
end;
$$;

revoke all on function private.admin_bug_reports() from public, anon;
grant execute on function private.admin_bug_reports() to authenticated;

create or replace function public.admin_bug_reports()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_bug_reports();
$$;

revoke all on function public.admin_bug_reports() from public, anon;
grant execute on function public.admin_bug_reports() to authenticated;

-- Seguimiento desde el panel: estado, severidad, tipo, versión y nota.
-- Un valor null deja el campo como estaba; '' borra severidad, versión o nota.
create or replace function private.admin_update_bug_report(p_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := p_changes ->> 'status';
  v_severity text := p_changes ->> 'severity';
  v_kind text := p_changes ->> 'kind';
  v_version text := p_changes ->> 'fixed_in_version';
  v_note text := p_changes ->> 'triage_note';
  v_row private.bug_reports%rowtype;
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if v_status is not null and v_status not in ('nuevo', 'revisado', 'a_corregir', 'resuelto', 'descartado') then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if v_severity is not null and v_severity not in ('', 'critica', 'alta', 'media', 'baja') then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if v_kind is not null and v_kind not in ('error', 'calculo', 'texto', 'no_encuentro', 'sugerencia') then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  update private.bug_reports b
     set status = coalesce(v_status, b.status),
         severity = case when v_severity is null then b.severity else nullif(v_severity, '') end,
         kind = coalesce(v_kind, b.kind),
         fixed_in_version = case when v_version is null then b.fixed_in_version else private.clean_report_text(v_version, 40) end,
         triage_note = case when v_note is null then b.triage_note else private.clean_report_text(v_note, 4000) end,
         triaged_at = now()
   where b.id = p_id
  returning * into v_row;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into private.admin_audit_log (actor, action) values (v_uid, 'ADMIN_BUG_REPORT_UPDATE');
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'severity', v_row.severity, 'kind', v_row.kind,
    'fixed_in_version', v_row.fixed_in_version, 'triage_note', v_row.triage_note, 'triaged_at', v_row.triaged_at);
end;
$$;

revoke all on function private.admin_update_bug_report(uuid, jsonb) from public, anon;
grant execute on function private.admin_update_bug_report(uuid, jsonb) to authenticated;

create or replace function public.admin_update_bug_report(p_id uuid, p_changes jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_update_bug_report(p_id, p_changes);
$$;

revoke all on function public.admin_update_bug_report(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_bug_report(uuid, jsonb) to authenticated;
