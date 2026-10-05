-- =====================================================================
-- RATEOS ADMIN — rol de PLATAFORMA (separado de los roles de empresa).
--
--   Rol de empresa (organization_members.role): OWNER | ADMIN | ESTIMATOR | VIEWER
--   Rol de plataforma (private.platform_admins): RATEOS_ADMIN
--
-- Principio: ADMINISTRAR LA PLATAFORMA ≠ LEER LOS DATOS PRIVADOS DEL CLIENTE.
-- RATEOS_ADMIN ve METADATA (usuarios, empresas, membresías, fechas, tamaño y
-- revisión del workspace) por funciones que nunca devuelven workspace_states.state.
-- Las políticas RLS de las tablas de clientes NO cambian: ser admin no da
-- acceso a cotizaciones, costos, márgenes, recursos ni tarifas de nadie.
--
-- Autoridad 100 % en Postgres:
-- - private.platform_admins vive en el schema private (no expuesto por la
--   API), con RLS y sin grants: nadie lo lee ni lo escribe desde el cliente.
-- - El alta del master es por BOOTSTRAP server-side: un trigger en auth.users
--   asocia como RATEOS_ADMIN a la cuenta cuyo email CONFIRMADO coincide
--   (normalizado) con private.platform_admin_bootstrap. Es de UN SOLO USO.
--   No se mira user_metadata, app_metadata, claims del JWT ni nada que el
--   cliente pueda mandar.
-- - private.is_platform_admin() consulta sólo esa tabla con auth.uid().
-- =====================================================================

-- Nunca esperar indefinidamente un lock sobre auth.users (Auth en uso).
set local lock_timeout = '10s';

-- --------------------------------------------------------------- tablas

create table private.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_via text not null check (granted_via in ('bootstrap')),
  bootstrap_email text,
  created_at timestamptz not null default now()
);
alter table private.platform_admins enable row level security;

create table private.platform_admin_bootstrap (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references auth.users (id) on delete set null
);
alter table private.platform_admin_bootstrap enable row level security;

-- Auditoría de acciones administrativas. Nunca contraseñas, tokens, JWT,
-- costos ni cotizaciones: sólo quién, cuándo y qué acción.
create table private.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  action text not null check (action in ('ADMIN_PANEL_OPEN')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048)
);
alter table private.admin_audit_log enable row level security;
create index admin_audit_log_at_idx on private.admin_audit_log (at desc);

revoke all on table private.platform_admins, private.platform_admin_bootstrap, private.admin_audit_log from public, anon, authenticated;

-- La cuenta master (se asocia cuando exista y esté confirmada).
insert into private.platform_admin_bootstrap (email) values ('joaquinvedova@hotmail.com') on conflict (email) do nothing;

-- ------------------------------------------------------------ bootstrap

create or replace function private.grant_platform_admin_bootstrap(p_user uuid, p_email text, p_confirmed_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_user is null or p_confirmed_at is null or v_email = '' then
    return;
  end if;
  -- Un solo uso: si ya se consumió, nadie más lo obtiene (aunque cambie su email).
  update private.platform_admin_bootstrap b
     set consumed_at = now(), consumed_by = p_user
   where b.email = v_email and b.consumed_at is null;
  if found then
    insert into private.platform_admins (user_id, granted_via, bootstrap_email)
    values (p_user, 'bootstrap', v_email)
    on conflict (user_id) do nothing;
  end if;
end;
$$;

revoke all on function private.grant_platform_admin_bootstrap(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function private.handle_platform_admin_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sólo cuentas no anónimas con el email CONFIRMADO. GoTrue cambia
  -- auth.users.email recién cuando se confirma el email nuevo.
  if new.email_confirmed_at is not null
     and new.is_anonymous is not true
     and (tg_op = 'INSERT' or old.email_confirmed_at is null or old.email is distinct from new.email) then
    perform private.grant_platform_admin_bootstrap(new.id, new.email, new.email_confirmed_at);
  end if;
  return new;
exception when others then
  -- Nunca bloquear un registro o una confirmación por esto.
  raise warning 'rateos platform admin bootstrap: %', sqlstate;
  return new;
end;
$$;

revoke all on function private.handle_platform_admin_bootstrap() from public, anon, authenticated;

-- Sin "drop trigger if exists": pide ACCESS EXCLUSIVE sobre auth.users y
-- queda esperando detrás de las conexiones de Auth. create trigger alcanza.
create trigger on_auth_user_platform_admin
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.handle_platform_admin_bootstrap();

-- Si la cuenta master ya existía y estaba confirmada al aplicar la migración.
select private.grant_platform_admin_bootstrap(u.id, u.email, u.email_confirmed_at)
  from auth.users u
 where u.email_confirmed_at is not null
   and u.is_anonymous is not true
   and lower(btrim(u.email)) in (select b.email from private.platform_admin_bootstrap b where b.consumed_at is null);

-- --------------------------------------------------------------- helpers

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.platform_admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function private.is_platform_admin() from public, anon;
grant execute on function private.is_platform_admin() to authenticated;

-- Metadata de la plataforma: conteos. Registra ADMIN_PANEL_OPEN.
create or replace function private.admin_overview()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into private.admin_audit_log (actor, action) values (v_uid, 'ADMIN_PANEL_OPEN');
  select jsonb_build_object(
    'users_total', (select count(*) from auth.users u where u.is_anonymous is not true),
    'users_confirmed', (select count(*) from auth.users u where u.is_anonymous is not true and u.email_confirmed_at is not null),
    'users_7d', (select count(*) from auth.users u where u.is_anonymous is not true and u.created_at >= now() - interval '7 days'),
    'users_30d', (select count(*) from auth.users u where u.is_anonymous is not true and u.created_at >= now() - interval '30 days'),
    'organizations_total', (select count(*) from public.organizations),
    'workspaces_total', (select count(*) from public.workspace_states),
    'workspaces_active_30d', (select count(*) from public.workspace_states w where w.revision > 0 and w.updated_at >= now() - interval '30 days'),
    'generated_at', now()
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function private.admin_overview() from public, anon;
grant execute on function private.admin_overview() to authenticated;

-- Metadata por usuario y empresa. NUNCA devuelve workspace_states.state:
-- sólo revisión, versión de esquema, tamaño aproximado y fecha de guardado.
create or replace function private.admin_users()
returns table (
  full_name text,
  email text,
  email_confirmed boolean,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  organization_name text,
  organization_role text,
  organization_members bigint,
  organization_created_at timestamptz,
  workspace_revision bigint,
  workspace_schema_version integer,
  workspace_bytes integer,
  workspace_updated_at timestamptz,
  is_platform_admin boolean
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
  return query
  select
    p.full_name,
    u.email::text,
    (u.email_confirmed_at is not null),
    u.created_at,
    u.last_sign_in_at,
    o.name,
    m.role,
    (select count(*) from public.organization_members mm where mm.organization_id = o.id),
    o.created_at,
    w.revision,
    w.schema_version,
    pg_column_size(w.state),
    w.updated_at,
    exists (select 1 from private.platform_admins a where a.user_id = u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.organization_members m on m.user_id = u.id
  left join public.organizations o on o.id = m.organization_id
  left join public.workspace_states w on w.organization_id = o.id
  where u.is_anonymous is not true
  order by u.created_at desc
  limit 1000;
end;
$$;

revoke all on function private.admin_users() from public, anon;
grant execute on function private.admin_users() to authenticated;

-- ---------------------------------------------- API (wrappers sin privilegios)
-- Security INVOKER en public (lo que expone PostgREST): sólo delegan en las
-- funciones de private, que verifican RATEOS_ADMIN con auth.uid().

create or replace function public.am_i_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_platform_admin();
$$;

create or replace function public.admin_overview()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_overview();
$$;

create or replace function public.admin_users()
returns table (
  full_name text,
  email text,
  email_confirmed boolean,
  user_created_at timestamptz,
  last_sign_in_at timestamptz,
  organization_name text,
  organization_role text,
  organization_members bigint,
  organization_created_at timestamptz,
  workspace_revision bigint,
  workspace_schema_version integer,
  workspace_bytes integer,
  workspace_updated_at timestamptz,
  is_platform_admin boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_users();
$$;

revoke all on function public.am_i_platform_admin() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users() to authenticated;
