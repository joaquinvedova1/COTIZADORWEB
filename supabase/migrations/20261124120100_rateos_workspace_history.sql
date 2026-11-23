-- =====================================================================
-- RATEOS — Historial del workspace de cada empresa (beta pública, S-09).
--
-- Todo el contenido de una empresa es UNA fila de public.workspace_states.
-- Un guardado equivocado (error de la app, versión vieja abierta en otra
-- pestaña) la pisa sin vuelta atrás. En el plan gratuito de Supabase no hay
-- backups diarios descargables, así que guardamos acá una foto de cada
-- empresa como mucho cada 30 minutos mientras trabaja (la app guarda sola
-- cada pocos segundos: guardar todas sería llenar la base), hasta 100 fotos
-- y 25 MB por empresa, y ninguna de más de 30 días. Con un workspace típico
-- de 50 kB son ~5 MB por empresa.
--
-- - private.workspace_state_history: sin acceso desde la API (ni anon ni
--   authenticated ni el admin de la app). Sólo el dueño del proyecto desde
--   el SQL Editor, para restaurar (docs/BACKUPS.md).
-- - Se llena con un trigger AFTER UPDATE: guarda la versión ANTERIOR cuando
--   cambia el contenido y la última foto de esa empresa tiene más de 30 min.
-- - private.restore_workspace_revision(org, revision): vuelve a poner esa
--   versión como actual (nueva revisión, así la app la toma al abrir).
--   Sólo service_role / postgres.
-- =====================================================================

set local lock_timeout = '10s';

create table if not exists private.workspace_state_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  revision bigint not null,
  schema_version integer not null,
  state jsonb,
  saved_at timestamptz not null,
  saved_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz not null default now()
);

create index if not exists workspace_state_history_org on private.workspace_state_history (organization_id, revision desc);

alter table private.workspace_state_history enable row level security;
revoke all on table private.workspace_state_history from public, anon, authenticated;

create index if not exists workspace_state_history_archived on private.workspace_state_history (archived_at);

-- Poda: nada de más de 30 días (de ninguna empresa) y, por empresa, las 100
-- fotos más nuevas que entren en 25 MB (una empresa no puede llenar la base).
create or replace function private.prune_workspace_history(p_organization uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from private.workspace_state_history h where h.archived_at < now() - interval '30 days';
  delete from private.workspace_state_history h
   where h.organization_id = p_organization
     and h.id not in (
       select k.id from (
         select h2.id,
                row_number() over (order by h2.revision desc, h2.id desc) as n,
                sum(pg_column_size(h2.state)) over (order by h2.revision desc, h2.id desc) as bytes
           from private.workspace_state_history h2
          where h2.organization_id = p_organization
       ) k
       where k.n <= 100 and (k.n = 1 or k.bytes <= 26214400));
$$;

revoke all on function private.prune_workspace_history(uuid) from public, anon, authenticated;

create or replace function private.archive_workspace_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is not null and old.state is distinct from new.state
     and not exists (select 1 from private.workspace_state_history h
                      where h.organization_id = old.organization_id
                        and h.archived_at > now() - interval '30 minutes') then
    insert into private.workspace_state_history (organization_id, revision, schema_version, state, saved_at, saved_by)
    values (old.organization_id, old.revision, old.schema_version, old.state, old.updated_at, old.updated_by);
    perform private.prune_workspace_history(old.organization_id);
  end if;
  return new;
end;
$$;

revoke all on function private.archive_workspace_state() from public, anon, authenticated;

drop trigger if exists workspace_states_archive on public.workspace_states;
create trigger workspace_states_archive
  after update on public.workspace_states
  for each row execute function private.archive_workspace_state();

-- Restaurar una versión guardada (sólo desde el SQL Editor del dueño).
create or replace function private.restore_workspace_revision(p_organization uuid, p_revision bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hist private.workspace_state_history%rowtype;
  v_new bigint;
begin
  select * into v_hist from private.workspace_state_history h
   where h.organization_id = p_organization and h.revision = p_revision
   order by h.id desc limit 1;
  if not found then
    raise exception 'revision_not_found' using errcode = 'P0002';
  end if;
  -- La versión actual queda guardada antes de pisarla: restaurar se puede deshacer.
  insert into private.workspace_state_history (organization_id, revision, schema_version, state, saved_at, saved_by)
  select w.organization_id, w.revision, w.schema_version, w.state, w.updated_at, w.updated_by
    from public.workspace_states w
   where w.organization_id = p_organization and w.state is not null;
  update public.workspace_states w
     set state = v_hist.state,
         schema_version = v_hist.schema_version,
         revision = w.revision + 1,
         updated_at = now(),
         updated_by = null
   where w.organization_id = p_organization
  returning w.revision into v_new;
  return jsonb_build_object('organization_id', p_organization, 'restored_revision', p_revision, 'new_revision', v_new);
end;
$$;

revoke all on function private.restore_workspace_revision(uuid, bigint) from public, anon, authenticated;
