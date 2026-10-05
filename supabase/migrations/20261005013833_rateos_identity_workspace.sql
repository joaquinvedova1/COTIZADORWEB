-- =====================================================================
-- RATEOS — identidad (profiles, organizations, organization_members) y
-- workspace cloud (workspace_states), con Row Level Security.
--
-- Modelo (ver docs/SUPABASE_PLAN.md y docs/DATA_MODEL.md):
--   auth.users 1─1 profiles
--   auth.users N─M organizations  vía organization_members(role)
--   organizations 1─1 workspace_states (estado RATEOS versionado en jsonb)
--
-- Seguridad:
--   * RLS en TODAS las tablas. anon no tiene ningún permiso.
--   * Un usuario sólo ve/modifica organizaciones de las que es miembro.
--   * Desde el cliente NO se puede crear, borrar ni cambiar membresías ni
--     organizaciones: las crea el trigger de alta de usuario (OWNER).
--   * workspace_states: el cliente sólo puede actualizar state y
--     schema_version (grant por columna); revision, updated_by y
--     organization_id los fija un trigger (control de concurrencia).
--   * Funciones security definer en el esquema `private` (no expuesto por
--     la API) y con search_path vacío.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ------------------------------------------------------------- tablas

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'ESTIMATOR', 'VIEWER')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id);

-- Un workspace por organización: el estado RATEOS completo (mismo formato
-- que el backup JSON, con schemaVersion). state null = cuenta nueva sin
-- estado todavía (el cliente arma uno VACÍO; nunca datos de demo).
create table public.workspace_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  schema_version integer not null default 2 check (schema_version >= 1),
  state jsonb,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint workspace_state_is_object check (state is null or jsonb_typeof(state) = 'object'),
  constraint workspace_state_max_size check (state is null or pg_column_size(state) <= 5242880)
);
create index workspace_states_updated_by_idx on public.workspace_states (updated_by);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspace_states enable row level security;

-- --------------------------------------------- funciones de membresía

create or replace function private.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.has_role(uuid, text[]) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, text[]) to authenticated;

-- ------------------------------------------- triggers de integridad

-- organizations / profiles: id y created_at no cambian; updated_at lo fija la base.
create or replace function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_row();
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_row();

-- workspace_states: cada guardado incrementa la revisión (control de
-- concurrencia optimista); la fila no cambia de organización.
create or replace function private.workspace_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := old.id;
  new.organization_id := old.organization_id;
  new.created_at := old.created_at;
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger workspace_states_before_update before update on public.workspace_states
  for each row execute function private.workspace_before_update();

revoke all on function private.touch_row() from public, anon, authenticated;
revoke all on function private.workspace_before_update() from public, anon, authenticated;

-- ------------------------------------------------- alta de usuario

-- Al registrarse: perfil + organización propia + membresía OWNER +
-- workspace vacío, en la misma transacción que crea el usuario.
-- Nombre y empresa vienen de raw_user_meta_data (los escribe el usuario):
-- se limpian (sin caracteres de control), se recortan y se limitan.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_company text;
  v_org uuid;
begin
  v_name := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[[:cntrl:]]', '', 'g')), 120);
  v_company := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'company', ''), '[[:cntrl:]]', '', 'g')), 120);
  if v_company = '' then
    v_company := 'Mi empresa';
  end if;

  insert into public.profiles (id, full_name) values (new.id, v_name);
  insert into public.organizations (name) values (v_company) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, new.id, 'OWNER');
  insert into public.workspace_states (organization_id) values (v_org);
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ------------------------------------------------------------ grants

-- Supabase da por defecto todos los permisos a anon/authenticated en las
-- tablas nuevas de public: se quitan y se otorga sólo lo necesario.
revoke all on table public.organizations, public.profiles, public.organization_members, public.workspace_states from anon, authenticated;

grant select on table public.organizations to authenticated;
grant update (name) on table public.organizations to authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

grant select on table public.organization_members to authenticated;

grant select on table public.workspace_states to authenticated;
grant update (state, schema_version) on table public.workspace_states to authenticated;

-- ---------------------------------------------------------- políticas

-- profiles: cada persona ve y edita sólo su perfil.
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organizations: la ven sus miembros; la editan OWNER y ADMIN.
-- Sin políticas de insert/delete: el cliente no crea ni borra organizaciones.
create policy organizations_select_member on public.organizations
  for select to authenticated
  using ((select private.is_member(id)));
create policy organizations_update_admin on public.organizations
  for update to authenticated
  using ((select private.has_role(id, array['OWNER', 'ADMIN'])))
  with check ((select private.has_role(id, array['OWNER', 'ADMIN'])));

-- organization_members: se ven las membresías de las organizaciones propias.
-- Sin insert/update/delete: nadie puede darse un rol (ni OWNER) desde el cliente.
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_member(organization_id)));

-- workspace_states: lo leen los miembros; lo guardan OWNER, ADMIN y ESTIMATOR.
create policy workspace_states_select_member on public.workspace_states
  for select to authenticated
  using ((select private.is_member(organization_id)));
create policy workspace_states_update_editor on public.workspace_states
  for update to authenticated
  using ((select private.has_role(organization_id, array['OWNER', 'ADMIN', 'ESTIMATOR'])))
  with check ((select private.has_role(organization_id, array['OWNER', 'ADMIN', 'ESTIMATOR'])));

-- ------------------------------------------- endurecimiento existente

-- public.rls_auto_enable() la crea Supabase (event trigger "ensure_rls" que
-- activa RLS en cada tabla nueva de public). Sólo corre como event trigger:
-- nadie de la API necesita ejecutarla (advisor 0028/0029).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
