-- =====================================================================
-- RATEOS BETA — canal de feedback: problemas y sugerencias
-- (PLAN-2026-029, docs/BETA_FEEDBACK.md).
--
--   * Los miembros de una empresa envían un problema ("Encontré un
--     problema") o una sugerencia ("Tengo una sugerencia"): sólo texto
--     breve, una categoría y una pantalla de listas fijas y la versión de la
--     app. Nunca datos económicos, adjuntos, ids de sesión ni tokens.
--   * Ven el estado y la respuesta de los de su empresa (nunca de otra).
--   * RATEOS ADMIN los clasifica y responde. Estados: Recibido, En revisión,
--     Confirmado, Resuelto, No corresponde y Duplicado. Ningún estado suma
--     ni descuenta nada: no hay créditos, cupos ni premios.
--   * Límites técnicos contra el spam (por persona, por empresa, abiertos y
--     texto repetido), no cuotas de negocio.
--
-- Autoridad 100 % en Postgres. Las tablas viven en `private` (no expuesto
-- por la API), con RLS y sin grants. El cliente sólo usa funciones
-- `security invoker` de public que delegan en funciones `security definer`
-- de private con search_path vacío y verifican auth.uid() y la membresía
-- (mismo patrón que RATEOS ADMIN). Ninguna función lee workspace_states:
-- esta migración no cambia el guardado ni las empresas existentes.
-- =====================================================================

-- Nunca esperar indefinidamente un lock sobre tablas en uso.
set local lock_timeout = '10s';

-- --------------------------------------------------------------- tablas

create table private.feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('problem', 'suggestion')),
  category text not null default 'otro' check (category in ('calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro')),
  -- Problema: qué pasó. Sugerencia: qué te gustaría mejorar o agregar.
  message text not null check (char_length(message) between 3 and 2000),
  -- Problema: qué estabas haciendo. Sugerencia: para qué te serviría. Opcional.
  details text check (details is null or char_length(details) between 1 and 2000),
  -- Sólo problemas: qué esperabas que pasara. Opcional.
  expected text check (expected is null or char_length(expected) between 1 and 2000),
  screen text not null check (screen ~ '^[a-z_]{1,30}$'),
  app_version text not null check (app_version ~ '^[0-9A-Za-z.+-]{1,40}$'),
  status text not null default 'received' check (status in ('received', 'in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate')),
  duplicate_of uuid references private.feedback (id) on delete set null,
  -- Respuesta de RATEOS: la ve la empresa.
  response text check (response is null or char_length(response) <= 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_expected_only_problems check (kind = 'problem' or expected is null),
  -- "duplicate" exige duplicate_of: lo controla admin_review_feedback (si se borra el
  -- original, con su empresa, este no debe impedirlo).
  constraint feedback_not_self_duplicate check (duplicate_of is distinct from id)
);
create index feedback_org_created_idx on private.feedback (organization_id, created_at desc);
create index feedback_author_created_idx on private.feedback (author, created_at desc);
create index feedback_status_idx on private.feedback (status, created_at desc);
-- "Parecidos" de la cola de admin (mismo tipo, categoría y pantalla).
create index feedback_similar_idx on private.feedback (kind, category, screen, status);

create table private.feedback_events (
  id bigint generated always as identity primary key,
  feedback_id uuid not null references private.feedback (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  from_status text,
  to_status text not null,
  response text check (response is null or char_length(response) <= 1000),
  created_at timestamptz not null default now()
);
create index feedback_events_feedback_idx on private.feedback_events (feedback_id, created_at);

alter table private.feedback enable row level security;
alter table private.feedback_events enable row level security;

revoke all on table private.feedback, private.feedback_events from public, anon, authenticated;

-- --------------------------------------------------- envío (miembros)

-- Texto de una persona: sin caracteres de control (C0 salvo salto de línea y
-- tabulación, DEL y C1), sin los invisibles que disfrazan un texto (ancho cero,
-- marcas y controles de dirección, BOM) y sin espacios en los extremos: también
-- saltos de línea, tabulaciones y espacios Unicode, como .trim() en el cliente
-- (btrim sólo quitaba el espacio común).
create or replace function private.clean_feedback_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F​-‏‪-‮⁠-⁩﻿]', '', 'g'),
                        '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$', '', 'g');
$$;

revoke all on function private.clean_feedback_text(text) from public, anon, authenticated;

create or replace function private.submit_feedback(
  p_org uuid, p_kind text, p_category text, p_message text, p_details text, p_expected text, p_screen text, p_app_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_category text := coalesce(nullif(p_category, ''), 'otro');
  v_message text := private.clean_feedback_text(p_message);
  v_details text := nullif(private.clean_feedback_text(p_details), '');
  v_expected text := nullif(private.clean_feedback_text(p_expected), '');
  v_screen text := coalesce(p_screen, '');
  v_version text := coalesce(p_app_version, '');
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null or p_org is null or not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('problem', 'suggestion') then
    raise exception 'rateos_feedback_invalid' using errcode = 'P0001';
  end if;
  -- "Qué esperabas" sólo tiene sentido en un problema.
  if p_kind = 'suggestion' then
    v_expected := null;
  end if;
  if v_category not in ('calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro')
     or v_screen not in ('inicio', 'nuevo', 'cotizacion', 'resultado', 'escenarios', 'cotizaciones', 'productos', 'producto',
                         'recursos', 'plantillas', 'configuracion', 'cuenta', 'registro', 'pdf', 'otra')
     or v_version !~ '^[0-9A-Za-z.+-]{1,40}$'
     or char_length(v_message) not between 3 and 2000
     or coalesce(char_length(v_details), 0) > 2000
     or coalesce(char_length(v_expected), 0) > 2000 then
    raise exception 'rateos_feedback_invalid' using errcode = 'P0001';
  end if;

  -- Límites contra el spam, por persona y por empresa, sin carreras entre envíos simultáneos.
  -- Primero la persona (su límite vale en todas sus empresas) y después la empresa: siempre en
  -- ese orden, así dos envíos nunca se esperan en cruz.
  perform pg_advisory_xact_lock(hashtextextended('rateos_feedback_author:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rateos_feedback:' || p_org::text, 0));
  if (select count(*) from private.feedback f where f.author = v_uid and f.created_at > now() - interval '24 hours') >= 5
     or (select count(*) from private.feedback f where f.organization_id = p_org and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rateos_feedback_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from private.feedback f where f.organization_id = p_org and f.status in ('received', 'in_review')) >= 20 then
    raise exception 'rateos_feedback_too_many_open' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from private.feedback f
     where f.organization_id = p_org and f.kind = p_kind and f.created_at > now() - interval '7 days'
       and f.message = v_message
       and f.details is not distinct from v_details
       and f.expected is not distinct from v_expected
  ) then
    raise exception 'rateos_feedback_duplicate' using errcode = 'P0001';
  end if;

  insert into private.feedback (organization_id, author, kind, category, message, details, expected, screen, app_version)
  values (p_org, v_uid, p_kind, v_category, v_message, v_details, v_expected, v_screen, v_version)
  returning id, created_at into v_id, v_created;
  insert into private.feedback_events (feedback_id, actor, from_status, to_status) values (v_id, v_uid, null, 'received');
  return jsonb_build_object('id', v_id, 'kind', p_kind, 'status', 'received', 'created_at', v_created);
end;
$$;

-- Feedback de la empresa propia (nunca de otra). Sin quién revisó: el estado,
-- la fecha y la respuesta de RATEOS.
create or replace function private.my_feedback(p_org uuid)
returns table (
  id uuid,
  created_at timestamptz,
  kind text,
  category text,
  screen text,
  app_version text,
  message text,
  details text,
  expected text,
  status text,
  response text,
  reviewed_at timestamptz,
  mine boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_org is null or not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select f.id, f.created_at, f.kind, f.category, f.screen, f.app_version, f.message, f.details, f.expected, f.status,
         f.response, f.reviewed_at, coalesce(f.author = (select auth.uid()), false)
    from private.feedback f
   where f.organization_id = p_org
   order by f.created_at desc
   limit 200;
end;
$$;

revoke all on function private.submit_feedback(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function private.my_feedback(uuid) from public, anon;
grant execute on function private.submit_feedback(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function private.my_feedback(uuid) to authenticated;

-- ---------------------------------------------- revisión (RATEOS ADMIN)

-- Cola de feedback con el contexto para clasificar. Nunca lee workspace_states.
-- 'open' = recibidos, en revisión y confirmados (todavía sin resolver).
create or replace function private.admin_feedback(p_status text default null, p_kind text default null)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  author_email text,
  kind text,
  category text,
  screen text,
  app_version text,
  message text,
  details text,
  expected text,
  status text,
  duplicate_of uuid,
  response text,
  reviewed_at timestamptz,
  reviewer_email text,
  similar_count bigint,
  history jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_status is not null and p_status not in ('open', 'received', 'in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate'))
     or (p_kind is not null and p_kind not in ('problem', 'suggestion')) then
    raise exception 'rateos_feedback_invalid' using errcode = 'P0001';
  end if;
  return query
  select f.id, f.created_at, o.name, fu.email::text, f.kind, f.category, f.screen, f.app_version, f.message, f.details, f.expected,
         f.status, f.duplicate_of, f.response, f.reviewed_at, rv.email::text,
         (select count(*) from private.feedback s
           where s.id <> f.id and s.kind = f.kind and s.category = f.category and s.screen = f.screen and s.status <> 'not_applicable'),
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', eu.email, 'from', e.from_status, 'to', e.to_status, 'response', e.response) order by e.created_at, e.id)
             from private.feedback_events e left join auth.users eu on eu.id = e.actor
            where e.feedback_id = f.id
         ), '[]'::jsonb)
    from private.feedback f
    join public.organizations o on o.id = f.organization_id
    left join auth.users fu on fu.id = f.author
    left join auth.users rv on rv.id = f.reviewed_by
   where (p_kind is null or f.kind = p_kind)
     and (p_status is null
          or (p_status = 'open' and f.status in ('received', 'in_review', 'confirmed'))
          or f.status = p_status)
   order by (f.status in ('received', 'in_review')) desc, f.created_at desc
   limit 500;
end;
$$;

-- Clasifica un feedback y, si hay texto, deja la respuesta que ve la empresa.
-- No suma ni descuenta nada. Repetir el mismo estado sin respuesta nueva no
-- deja otro evento.
create or replace function private.admin_review_feedback(p_feedback uuid, p_status text, p_response text default null, p_duplicate_of uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row private.feedback%rowtype;
  v_response text := nullif(left(private.clean_feedback_text(p_response), 1000), '');
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('in_review', 'confirmed', 'resolved', 'not_applicable', 'duplicate') then
    raise exception 'rateos_feedback_invalid' using errcode = 'P0001';
  end if;
  select * into v_row from private.feedback f where f.id = p_feedback for update;
  if not found then
    raise exception 'rateos_feedback_not_found' using errcode = 'P0001';
  end if;
  if p_status = 'duplicate' then
    -- El original existe, es otro y no es a su vez un duplicado: sin ciclos (A de B y B de A).
    if p_duplicate_of is null or p_duplicate_of = p_feedback
       or not exists (select 1 from private.feedback d where d.id = p_duplicate_of and d.status <> 'duplicate') then
      raise exception 'rateos_feedback_invalid' using errcode = 'P0001';
    end if;
  end if;
  if v_row.status = p_status and v_response is null
     and (p_status <> 'duplicate' or v_row.duplicate_of is not distinct from p_duplicate_of) then
    return jsonb_build_object('status', p_status, 'changed', false);
  end if;

  update private.feedback f
     set status = p_status,
         duplicate_of = case when p_status = 'duplicate' then p_duplicate_of else null end,
         response = coalesce(v_response, f.response),
         reviewed_by = v_uid,
         reviewed_at = now(),
         updated_at = now()
   where f.id = p_feedback;

  insert into private.feedback_events (feedback_id, actor, from_status, to_status, response)
  values (p_feedback, v_uid, v_row.status, p_status, v_response);
  return jsonb_build_object('status', p_status, 'changed', true);
end;
$$;

revoke all on function private.admin_feedback(text, text) from public, anon;
revoke all on function private.admin_review_feedback(uuid, text, text, uuid) from public, anon;
grant execute on function private.admin_feedback(text, text) to authenticated;
grant execute on function private.admin_review_feedback(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------- API (wrappers sin privilegios)

create or replace function public.submit_feedback(
  p_org uuid, p_kind text, p_category text, p_message text, p_details text, p_expected text, p_screen text, p_app_version text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.submit_feedback(p_org, p_kind, p_category, p_message, p_details, p_expected, p_screen, p_app_version);
$$;

create or replace function public.my_feedback(p_org uuid)
returns table (
  id uuid,
  created_at timestamptz,
  kind text,
  category text,
  screen text,
  app_version text,
  message text,
  details text,
  expected text,
  status text,
  response text,
  reviewed_at timestamptz,
  mine boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_feedback(p_org);
$$;

create or replace function public.admin_feedback(p_status text default null, p_kind text default null)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  author_email text,
  kind text,
  category text,
  screen text,
  app_version text,
  message text,
  details text,
  expected text,
  status text,
  duplicate_of uuid,
  response text,
  reviewed_at timestamptz,
  reviewer_email text,
  similar_count bigint,
  history jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_feedback(p_status, p_kind);
$$;

create or replace function public.admin_review_feedback(p_feedback uuid, p_status text, p_response text default null, p_duplicate_of uuid default null)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_review_feedback(p_feedback, p_status, p_response, p_duplicate_of);
$$;

revoke all on function public.submit_feedback(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.my_feedback(uuid) from public, anon;
revoke all on function public.admin_feedback(text, text) from public, anon;
revoke all on function public.admin_review_feedback(uuid, text, text, uuid) from public, anon;
grant execute on function public.submit_feedback(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.my_feedback(uuid) to authenticated;
grant execute on function public.admin_feedback(text, text) to authenticated;
grant execute on function public.admin_review_feedback(uuid, text, text, uuid) to authenticated;
