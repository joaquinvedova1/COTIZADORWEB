-- =====================================================================
-- RATEOS BETA — créditos de prueba por empresa y reporte de errores
-- (PLAN-2026-029, docs/BETA_CREDITS.md).
--
-- Créditos:
--   * Cada empresa tester tiene una cuenta con saldo (10 al registrarse).
--     Las empresas que ya existían NO tienen cuenta: para ellas nada cambia.
--   * Un cálculo nuevo (cotización o producto con un id que la empresa nunca
--     tuvo) cuesta 1 crédito. Lo cobra Postgres al guardar el workspace, en
--     la misma transacción: si no alcanza, se rechaza TODA la escritura.
--     Editar, recalcular, guardar, exportar o restaurar lo que ya existió no
--     cuesta nada; borrar no reintegra.
--   * El trigger nunca modifica workspace_states.state: sólo acepta o rechaza.
--
-- Reportes de errores:
--   * Los miembros de una empresa envían reportes de texto (sin datos
--     económicos) y ven el estado de los de su empresa.
--   * RATEOS ADMIN los revisa. Aprobar suma report_reward créditos UNA sola
--     vez por reporte, en una transacción; "aprobado" es definitivo.
--
-- Autoridad 100 % en Postgres. Todas las tablas nuevas viven en `private`
-- (no expuesto por la API), con RLS y sin grants. El cliente sólo usa
-- funciones `security invoker` de public que delegan en funciones
-- `security definer` de private con search_path vacío y verifican
-- auth.uid() y la membresía (mismo patrón que RATEOS ADMIN).
-- Ninguna función de esta migración lee workspace_states.state salvo el
-- trigger de cobro (ids de quotes[] y products[]) y la activación manual.
-- =====================================================================

-- Nunca esperar indefinidamente un lock sobre tablas en uso.
set local lock_timeout = '10s';

-- --------------------------------------------------------------- tablas

-- Política de la beta (una sola fila). quota_for_new_orgs = las empresas que
-- se registran desde ahora son testers con cuota.
create table private.beta_policy (
  id boolean primary key default true check (id),
  quota_for_new_orgs boolean not null default true,
  initial_credits integer not null default 10 check (initial_credits between 0 and 1000),
  report_reward integer not null default 2 check (report_reward between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into private.beta_policy (id) values (true) on conflict (id) do nothing;

create table private.credit_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  balance integer not null check (balance >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.bug_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  category text not null check (category in ('calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro')),
  did text not null check (char_length(did) between 3 and 2000),
  expected text not null check (char_length(expected) between 3 and 2000),
  happened text not null check (char_length(happened) between 3 and 2000),
  screen text not null check (screen ~ '^[a-z_]{1,30}$'),
  app_version text not null check (app_version ~ '^[0-9A-Za-z.+-]{1,40}$'),
  status text not null default 'received' check (status in ('received', 'in_review', 'approved', 'rejected', 'duplicate')),
  duplicate_of uuid references private.bug_reports (id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "duplicate" exige duplicate_of: lo controla admin_review_bug_report (si se borra el
  -- reporte original, con su empresa, este no debe impedirlo).
  constraint bug_report_not_self_duplicate check (duplicate_of is distinct from id)
);
create index bug_reports_org_created_idx on private.bug_reports (organization_id, created_at desc);
create index bug_reports_reporter_created_idx on private.bug_reports (reporter, created_at desc);
create index bug_reports_status_idx on private.bug_reports (status, created_at desc);

-- Movimientos de créditos. delta 0 sólo para los cálculos que ya existían al
-- activar la cuota a mano (quedan registrados para no cobrarlos nunca).
create table private.credit_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('initial_grant', 'new_calculation', 'existing_at_activation', 'bug_report_reward', 'admin_adjustment')),
  entity_kind text check (entity_kind in ('quote', 'product')),
  entity_id text check (entity_id is null or char_length(entity_id) between 1 and 100),
  bug_report_id uuid references private.bug_reports (id) on delete set null,
  actor uuid references auth.users (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint credit_ledger_shape check (
    case reason
      when 'new_calculation' then delta = -1 and entity_kind is not null and entity_id is not null
      when 'existing_at_activation' then delta = 0 and entity_kind is not null and entity_id is not null
      when 'initial_grant' then delta > 0 and entity_id is null
      when 'bug_report_reward' then delta > 0 and entity_id is null
      else delta <> 0 and entity_id is null
    end
  )
);
-- Un cálculo se cobra (o se registra como existente) UNA sola vez por empresa.
create unique index credit_ledger_entity_once on private.credit_ledger (organization_id, entity_kind, entity_id) where entity_id is not null;
-- Un premio por reporte y una asignación inicial por empresa.
create unique index credit_ledger_reward_once on private.credit_ledger (bug_report_id) where reason = 'bug_report_reward';
create unique index credit_ledger_initial_once on private.credit_ledger (organization_id) where reason = 'initial_grant';
create index credit_ledger_org_idx on private.credit_ledger (organization_id, created_at desc);

-- Historial de revisión de cada reporte (quién, cuándo, de qué estado a cuál).
create table private.bug_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references private.bug_reports (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,
  from_status text,
  to_status text not null,
  note text check (note is null or char_length(note) <= 1000),
  credits_added integer not null default 0,
  created_at timestamptz not null default now()
);
create index bug_report_events_report_idx on private.bug_report_events (report_id, created_at);

alter table private.beta_policy enable row level security;
alter table private.credit_accounts enable row level security;
alter table private.credit_ledger enable row level security;
alter table private.bug_reports enable row level security;
alter table private.bug_report_events enable row level security;

revoke all on table private.beta_policy, private.credit_accounts, private.credit_ledger, private.bug_reports, private.bug_report_events
  from public, anon, authenticated;

-- ---------------------------------------------------- cobro al guardar

-- Ids de un arreglo de cálculos del workspace (quotes o products). Rechaza
-- la escritura si el arreglo no es un arreglo de objetos con id de texto
-- único: un id repetido o ausente podría esconder cálculos sin cobrar.
create or replace function private.workspace_calculation_ids(p_state jsonb, p_key text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_list jsonb := p_state -> p_key;
  v_ids text[];
begin
  if v_list is null or jsonb_typeof(v_list) = 'null' then
    return array[]::text[];
  end if;
  if jsonb_typeof(v_list) <> 'array' then
    raise exception 'rateos_invalid_calculations' using errcode = 'P0001', detail = p_key;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_list) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'id') is distinct from 'string'
        or char_length(e ->> 'id') not between 1 and 100
  ) then
    raise exception 'rateos_invalid_calculations' using errcode = 'P0001', detail = p_key;
  end if;
  select coalesce(array_agg(e ->> 'id'), array[]::text[]) into v_ids from jsonb_array_elements(v_list) e;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'rateos_invalid_calculations' using errcode = 'P0001', detail = p_key;
  end if;
  return v_ids;
end;
$$;

revoke all on function private.workspace_calculation_ids(jsonb, text) from public, anon, authenticated;

create or replace function private.workspace_credit_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Producto de ejemplo "Chipá" (DEMO_IDS.productExample en js/domain/demo-data.js):
  -- no se cobra; como los ids no se repiten, hay uno solo a la vez.
  c_example_product constant text := '00000000-0000-4000-8000-000000002001';
  v_enabled boolean;
  v_balance integer;
  v_new_quotes text[];
  v_new_products text[];
  v_needed integer;
begin
  if new.state is null then
    return new;
  end if;
  select a.enabled into v_enabled from private.credit_accounts a where a.organization_id = new.organization_id;
  if v_enabled is not true then
    -- Empresa sin cuota (las que ya existían) o cuota deshabilitada: sin cambios.
    return new;
  end if;

  select coalesce(array_agg(x), array[]::text[]) into v_new_quotes
    from unnest(private.workspace_calculation_ids(new.state, 'quotes')) x
   where not exists (
     select 1 from private.credit_ledger l
      where l.organization_id = new.organization_id and l.entity_kind = 'quote' and l.entity_id = x
   );
  select coalesce(array_agg(x), array[]::text[]) into v_new_products
    from unnest(private.workspace_calculation_ids(new.state, 'products')) x
   where x <> c_example_product
     and not exists (
       select 1 from private.credit_ledger l
        where l.organization_id = new.organization_id and l.entity_kind = 'product' and l.entity_id = x
     );
  v_needed := cardinality(v_new_quotes) + cardinality(v_new_products);
  if v_needed = 0 then
    return new;
  end if;

  -- La fila del workspace ya está bloqueada por este UPDATE; la cuenta se
  -- bloquea también (la aprobación de un reporte la modifica en paralelo).
  select a.balance into v_balance from private.credit_accounts a where a.organization_id = new.organization_id for update;
  if v_balance < v_needed then
    raise exception 'rateos_credits_exhausted'
      using errcode = 'P0001', detail = json_build_object('needed', v_needed, 'balance', v_balance)::text;
  end if;

  insert into private.credit_ledger (organization_id, delta, reason, entity_kind, entity_id, actor)
  select new.organization_id, -1, 'new_calculation', 'quote', x, (select auth.uid()) from unnest(v_new_quotes) x
  union all
  select new.organization_id, -1, 'new_calculation', 'product', x, (select auth.uid()) from unnest(v_new_products) x;

  update private.credit_accounts a
     set balance = a.balance - v_needed, updated_at = now()
   where a.organization_id = new.organization_id;
  return new;
end;
$$;

revoke all on function private.workspace_credit_guard() from public, anon, authenticated;

create trigger workspace_states_credit_guard
  before insert or update of state on public.workspace_states
  for each row execute function private.workspace_credit_guard();

-- ------------------------------------------------ cuenta de empresa nueva

-- En la misma transacción del alta (handle_new_user → organizations). Falla
-- cerrado: si no se puede crear la cuenta, el alta falla; nunca queda una
-- empresa nueva sin cuota mientras la política esté encendida.
create or replace function private.handle_new_organization_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quota boolean;
  v_initial integer;
begin
  select p.quota_for_new_orgs, p.initial_credits into v_quota, v_initial from private.beta_policy p where p.id;
  if v_quota is not true then
    return new;
  end if;
  insert into private.credit_accounts (organization_id, balance) values (new.id, v_initial);
  if v_initial > 0 then
    insert into private.credit_ledger (organization_id, delta, reason) values (new.id, v_initial, 'initial_grant');
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_organization_credits() from public, anon, authenticated;

create trigger organizations_credit_account
  after insert on public.organizations
  for each row execute function private.handle_new_organization_credits();

-- ------------------------------------- herramientas del dueño (sólo SQL)
-- Sin grants: se ejecutan como postgres desde el SQL Editor o el plugin.

-- Activa la cuota en una empresa existente. Lo que ya tiene queda
-- registrado como existente (delta 0): nunca se cobra.
create or replace function private.enable_credit_quota(p_org uuid, p_balance integer, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_registered integer := 0;
  v_created boolean := false;
begin
  if p_balance is null or p_balance < 0 then
    raise exception 'saldo inválido';
  end if;
  select w.state into v_state from public.workspace_states w where w.organization_id = p_org for update;
  if not found then
    raise exception 'empresa sin workspace';
  end if;
  if not exists (select 1 from private.credit_accounts a where a.organization_id = p_org) then
    insert into private.credit_accounts (organization_id, balance) values (p_org, p_balance);
    if p_balance > 0 then
      insert into private.credit_ledger (organization_id, delta, reason, note) values (p_org, p_balance, 'initial_grant', left(p_note, 300));
    end if;
    v_created := true;
  else
    update private.credit_accounts a set enabled = true, updated_at = now() where a.organization_id = p_org;
  end if;
  if v_state is not null then
    with ids as (
      select 'quote' as kind, x from unnest(private.workspace_calculation_ids(v_state, 'quotes')) x
      union all
      select 'product', x from unnest(private.workspace_calculation_ids(v_state, 'products')) x
    ), ins as (
      insert into private.credit_ledger (organization_id, delta, reason, entity_kind, entity_id, note)
      select p_org, 0, 'existing_at_activation', ids.kind, ids.x, left(p_note, 300) from ids
      on conflict do nothing
      returning 1
    )
    select count(*) into v_registered from ins;
  end if;
  return jsonb_build_object('created', v_created, 'existing_registered', v_registered,
    'balance', (select a.balance from private.credit_accounts a where a.organization_id = p_org));
end;
$$;

-- Ajuste manual del saldo (por ejemplo, para restaurar a una tester un
-- respaldo de otra cuenta). Queda en el ledger con su nota.
create or replace function private.admin_adjust_credits(p_org uuid, p_delta integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if p_delta is null or p_delta = 0 or coalesce(btrim(p_note), '') = '' then
    raise exception 'ajuste inválido: delta distinto de 0 y una nota';
  end if;
  update private.credit_accounts a set balance = a.balance + p_delta, updated_at = now()
   where a.organization_id = p_org
  returning a.balance into v_balance;
  if not found then
    raise exception 'la empresa no tiene cuenta de créditos';
  end if;
  insert into private.credit_ledger (organization_id, delta, reason, note) values (p_org, p_delta, 'admin_adjustment', left(p_note, 300));
  return v_balance;
end;
$$;

revoke all on function private.enable_credit_quota(uuid, integer, text) from public, anon, authenticated;
revoke all on function private.admin_adjust_credits(uuid, integer, text) from public, anon, authenticated;

-- ------------------------------------------------- créditos (miembros)

create or replace function private.get_my_credits(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account private.credit_accounts%rowtype;
begin
  if (select auth.uid()) is null or p_org is null or not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_account from private.credit_accounts a where a.organization_id = p_org;
  if not found or not v_account.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  return jsonb_build_object(
    'enabled', true,
    'balance', v_account.balance,
    'initial', coalesce((select sum(l.delta) from private.credit_ledger l where l.organization_id = p_org and l.reason = 'initial_grant'), 0),
    'used', (select count(*) from private.credit_ledger l where l.organization_id = p_org and l.reason = 'new_calculation'),
    'rewarded', coalesce((select sum(l.delta) from private.credit_ledger l where l.organization_id = p_org and l.reason = 'bug_report_reward'), 0),
    'report_reward', (select p.report_reward from private.beta_policy p where p.id)
  );
end;
$$;

-- Cuántos de estos ids cobraría la empresa (para avisar antes de restaurar o
-- importar). No reserva nada: el cobro real lo hace el trigger al guardar.
create or replace function private.credit_preview(p_org uuid, p_quote_ids text[], p_product_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_example_product constant text := '00000000-0000-4000-8000-000000002001';
  v_account private.credit_accounts%rowtype;
  v_chargeable integer;
begin
  if (select auth.uid()) is null or p_org is null or not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_quote_ids), 0) + coalesce(cardinality(p_product_ids), 0) > 10000 then
    raise exception 'rateos_preview_too_large' using errcode = 'P0001';
  end if;
  select * into v_account from private.credit_accounts a where a.organization_id = p_org;
  if not found or not v_account.enabled then
    return jsonb_build_object('enabled', false, 'chargeable', 0);
  end if;
  select
    (select count(distinct x) from unnest(coalesce(p_quote_ids, array[]::text[])) x
      where not exists (select 1 from private.credit_ledger l where l.organization_id = p_org and l.entity_kind = 'quote' and l.entity_id = x))
    +
    (select count(distinct x) from unnest(coalesce(p_product_ids, array[]::text[])) x
      where x <> c_example_product
        and not exists (select 1 from private.credit_ledger l where l.organization_id = p_org and l.entity_kind = 'product' and l.entity_id = x))
  into v_chargeable;
  return jsonb_build_object('enabled', true, 'balance', v_account.balance, 'chargeable', v_chargeable);
end;
$$;

revoke all on function private.get_my_credits(uuid) from public, anon;
revoke all on function private.credit_preview(uuid, text[], text[]) from public, anon;
grant execute on function private.get_my_credits(uuid) to authenticated;
grant execute on function private.credit_preview(uuid, text[], text[]) to authenticated;

-- ------------------------------------------------- reportes (miembros)

-- Texto de una persona: sin caracteres de control (salvo salto de línea y
-- tabulación) y sin espacios en los extremos.
create or replace function private.clean_report_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
$$;

revoke all on function private.clean_report_text(text) from public, anon, authenticated;

create or replace function private.submit_bug_report(
  p_org uuid, p_category text, p_did text, p_expected text, p_happened text, p_screen text, p_app_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_did text := private.clean_report_text(p_did);
  v_expected text := private.clean_report_text(p_expected);
  v_happened text := private.clean_report_text(p_happened);
  v_screen text := coalesce(p_screen, '');
  v_version text := coalesce(p_app_version, '');
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null or p_org is null or not private.is_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('calculo', 'guardado', 'pdf', 'cuenta', 'pantalla', 'otro')
     or v_screen not in ('inicio', 'nuevo', 'cotizacion', 'resultado', 'escenarios', 'cotizaciones', 'productos', 'producto',
                         'recursos', 'plantillas', 'configuracion', 'cuenta', 'registro', 'pdf', 'reportar', 'otra')
     or v_version !~ '^[0-9A-Za-z.+-]{1,40}$'
     or char_length(v_did) not between 3 and 2000
     or char_length(v_expected) not between 3 and 2000
     or char_length(v_happened) not between 3 and 2000 then
    raise exception 'rateos_report_invalid' using errcode = 'P0001';
  end if;

  -- Límites por persona y por empresa, sin carreras entre envíos simultáneos.
  perform pg_advisory_xact_lock(hashtextextended('rateos_bug_report:' || p_org::text, 0));
  if (select count(*) from private.bug_reports r where r.reporter = v_uid and r.created_at > now() - interval '24 hours') >= 5
     or (select count(*) from private.bug_reports r where r.organization_id = p_org and r.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rateos_report_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from private.bug_reports r where r.organization_id = p_org and r.status in ('received', 'in_review')) >= 20 then
    raise exception 'rateos_report_too_many_open' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from private.bug_reports r
     where r.organization_id = p_org and r.created_at > now() - interval '7 days'
       and r.did = v_did and r.expected = v_expected and r.happened = v_happened
  ) then
    raise exception 'rateos_report_duplicate' using errcode = 'P0001';
  end if;

  insert into private.bug_reports (organization_id, reporter, category, did, expected, happened, screen, app_version)
  values (p_org, v_uid, p_category, v_did, v_expected, v_happened, v_screen, v_version)
  returning id, created_at into v_id, v_created;
  insert into private.bug_report_events (report_id, actor, from_status, to_status) values (v_id, v_uid, null, 'received');
  return jsonb_build_object('id', v_id, 'status', 'received', 'created_at', v_created);
end;
$$;

-- Reportes de la empresa propia (nunca de otra). Sin quién revisó: sólo el
-- estado, la fecha y la nota de respuesta.
create or replace function private.my_bug_reports(p_org uuid)
returns table (
  id uuid,
  created_at timestamptz,
  category text,
  screen text,
  app_version text,
  did text,
  expected text,
  happened text,
  status text,
  review_note text,
  reviewed_at timestamptz,
  mine boolean,
  credits_added integer
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
  select r.id, r.created_at, r.category, r.screen, r.app_version, r.did, r.expected, r.happened, r.status,
         r.review_note, r.reviewed_at, coalesce(r.reporter = (select auth.uid()), false),
         coalesce((select l.delta from private.credit_ledger l where l.bug_report_id = r.id and l.reason = 'bug_report_reward'), 0)
    from private.bug_reports r
   where r.organization_id = p_org
   order by r.created_at desc
   limit 200;
end;
$$;

revoke all on function private.submit_bug_report(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function private.my_bug_reports(uuid) from public, anon;
grant execute on function private.submit_bug_report(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function private.my_bug_reports(uuid) to authenticated;

-- ---------------------------------------------- revisión (RATEOS ADMIN)

-- Cola de reportes con el contexto para decidir. Nunca lee workspace_states.state.
create or replace function private.admin_bug_reports(p_status text default null)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  reporter_email text,
  category text,
  screen text,
  app_version text,
  did text,
  expected text,
  happened text,
  status text,
  duplicate_of uuid,
  review_note text,
  reviewed_at timestamptz,
  reviewer_email text,
  credits_added integer,
  org_quota_enabled boolean,
  org_balance integer,
  similar_reports bigint,
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
  if p_status is not null and p_status not in ('open', 'received', 'in_review', 'approved', 'rejected', 'duplicate') then
    raise exception 'rateos_report_invalid' using errcode = 'P0001';
  end if;
  return query
  select r.id, r.created_at, o.name, ru.email::text, r.category, r.screen, r.app_version, r.did, r.expected, r.happened,
         r.status, r.duplicate_of, r.review_note, r.reviewed_at, rv.email::text,
         coalesce((select l.delta from private.credit_ledger l where l.bug_report_id = r.id and l.reason = 'bug_report_reward'), 0),
         coalesce(a.enabled, false), a.balance,
         (select count(*) from private.bug_reports s where s.id <> r.id and s.category = r.category and s.screen = r.screen and s.status <> 'rejected'),
         coalesce((
           select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', eu.email, 'from', e.from_status, 'to', e.to_status, 'note', e.note, 'credits', e.credits_added) order by e.created_at, e.id)
             from private.bug_report_events e left join auth.users eu on eu.id = e.actor
            where e.report_id = r.id
         ), '[]'::jsonb)
    from private.bug_reports r
    join public.organizations o on o.id = r.organization_id
    left join auth.users ru on ru.id = r.reporter
    left join auth.users rv on rv.id = r.reviewed_by
    left join private.credit_accounts a on a.organization_id = r.organization_id
   where p_status is null
      or (p_status = 'open' and r.status in ('received', 'in_review'))
      or r.status = p_status
   order by (r.status in ('received', 'in_review')) desc, r.created_at desc
   limit 500;
end;
$$;

-- Cambia el estado de un reporte. "approved" suma report_reward créditos a la
-- empresa UNA sola vez (índice único por reporte, reporte bloqueado) y es
-- definitivo. Repetir la aprobación no suma nada. Nadie revisa reportes de
-- una empresa de la que es miembro.
create or replace function private.admin_review_bug_report(p_report uuid, p_status text, p_note text default null, p_duplicate_of uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_report private.bug_reports%rowtype;
  v_note text := nullif(left(private.clean_report_text(p_note), 1000), '');
  v_reward integer;
  v_added integer := 0;
  v_balance integer;
begin
  if v_uid is null or not private.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('in_review', 'approved', 'rejected', 'duplicate') then
    raise exception 'rateos_report_invalid' using errcode = 'P0001';
  end if;
  select * into v_report from private.bug_reports r where r.id = p_report for update;
  if not found then
    raise exception 'rateos_report_not_found' using errcode = 'P0001';
  end if;
  if v_report.reporter = v_uid or private.is_member(v_report.organization_id) then
    raise exception 'rateos_report_self_review' using errcode = '42501';
  end if;
  if v_report.status = 'approved' then
    if p_status = 'approved' then
      return jsonb_build_object('status', 'approved', 'already', true, 'credits_added', 0);
    end if;
    raise exception 'rateos_report_final' using errcode = 'P0001';
  end if;
  if p_status = 'duplicate' then
    if p_duplicate_of is null or p_duplicate_of = p_report
       or not exists (select 1 from private.bug_reports d where d.id = p_duplicate_of) then
      raise exception 'rateos_report_invalid' using errcode = 'P0001';
    end if;
  end if;

  update private.bug_reports r
     set status = p_status,
         duplicate_of = case when p_status = 'duplicate' then p_duplicate_of else null end,
         review_note = coalesce(v_note, r.review_note),
         reviewed_by = v_uid,
         reviewed_at = now(),
         updated_at = now()
   where r.id = p_report;

  if p_status = 'approved' then
    select p.report_reward into v_reward from private.beta_policy p where p.id;
    -- Sólo las empresas con cuota habilitada reciben créditos.
    select a.balance into v_balance from private.credit_accounts a
     where a.organization_id = v_report.organization_id and a.enabled
       for update;
    if found then
      insert into private.credit_ledger (organization_id, delta, reason, bug_report_id, actor, note)
      values (v_report.organization_id, v_reward, 'bug_report_reward', p_report, v_uid, 'Reporte aprobado')
      on conflict do nothing;
      if found then
        update private.credit_accounts a set balance = a.balance + v_reward, updated_at = now()
         where a.organization_id = v_report.organization_id
        returning a.balance into v_balance;
        v_added := v_reward;
      end if;
    end if;
  end if;

  insert into private.bug_report_events (report_id, actor, from_status, to_status, note, credits_added)
  values (p_report, v_uid, v_report.status, p_status, v_note, v_added);
  return jsonb_build_object('status', p_status, 'already', false, 'credits_added', v_added, 'balance', v_balance);
end;
$$;

-- Saldos por empresa (metadata del ledger; nunca el workspace).
create or replace function private.admin_credit_accounts()
returns table (
  organization_name text,
  enabled boolean,
  balance integer,
  initial integer,
  used bigint,
  rewarded integer,
  adjusted integer,
  created_at timestamptz
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
  select o.name, a.enabled, a.balance,
         coalesce((select sum(l.delta) from private.credit_ledger l where l.organization_id = a.organization_id and l.reason = 'initial_grant'), 0)::integer,
         (select count(*) from private.credit_ledger l where l.organization_id = a.organization_id and l.reason = 'new_calculation'),
         coalesce((select sum(l.delta) from private.credit_ledger l where l.organization_id = a.organization_id and l.reason = 'bug_report_reward'), 0)::integer,
         coalesce((select sum(l.delta) from private.credit_ledger l where l.organization_id = a.organization_id and l.reason = 'admin_adjustment'), 0)::integer,
         a.created_at
    from private.credit_accounts a
    join public.organizations o on o.id = a.organization_id
   order by a.created_at desc
   limit 1000;
end;
$$;

revoke all on function private.admin_bug_reports(text) from public, anon;
revoke all on function private.admin_review_bug_report(uuid, text, text, uuid) from public, anon;
revoke all on function private.admin_credit_accounts() from public, anon;
grant execute on function private.admin_bug_reports(text) to authenticated;
grant execute on function private.admin_review_bug_report(uuid, text, text, uuid) to authenticated;
grant execute on function private.admin_credit_accounts() to authenticated;

-- ---------------------------------------------- API (wrappers sin privilegios)

create or replace function public.get_my_credits(p_org uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_my_credits(p_org);
$$;

create or replace function public.credit_preview(p_org uuid, p_quote_ids text[], p_product_ids text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.credit_preview(p_org, p_quote_ids, p_product_ids);
$$;

create or replace function public.submit_bug_report(
  p_org uuid, p_category text, p_did text, p_expected text, p_happened text, p_screen text, p_app_version text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.submit_bug_report(p_org, p_category, p_did, p_expected, p_happened, p_screen, p_app_version);
$$;

create or replace function public.my_bug_reports(p_org uuid)
returns table (
  id uuid,
  created_at timestamptz,
  category text,
  screen text,
  app_version text,
  did text,
  expected text,
  happened text,
  status text,
  review_note text,
  reviewed_at timestamptz,
  mine boolean,
  credits_added integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_bug_reports(p_org);
$$;

create or replace function public.admin_bug_reports(p_status text default null)
returns table (
  id uuid,
  created_at timestamptz,
  organization_name text,
  reporter_email text,
  category text,
  screen text,
  app_version text,
  did text,
  expected text,
  happened text,
  status text,
  duplicate_of uuid,
  review_note text,
  reviewed_at timestamptz,
  reviewer_email text,
  credits_added integer,
  org_quota_enabled boolean,
  org_balance integer,
  similar_reports bigint,
  history jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_bug_reports(p_status);
$$;

create or replace function public.admin_review_bug_report(p_report uuid, p_status text, p_note text default null, p_duplicate_of uuid default null)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_review_bug_report(p_report, p_status, p_note, p_duplicate_of);
$$;

create or replace function public.admin_credit_accounts()
returns table (
  organization_name text,
  enabled boolean,
  balance integer,
  initial integer,
  used bigint,
  rewarded integer,
  adjusted integer,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.admin_credit_accounts();
$$;

revoke all on function public.get_my_credits(uuid) from public, anon;
revoke all on function public.credit_preview(uuid, text[], text[]) from public, anon;
revoke all on function public.submit_bug_report(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.my_bug_reports(uuid) from public, anon;
revoke all on function public.admin_bug_reports(text) from public, anon;
revoke all on function public.admin_review_bug_report(uuid, text, text, uuid) from public, anon;
revoke all on function public.admin_credit_accounts() from public, anon;
grant execute on function public.get_my_credits(uuid) to authenticated;
grant execute on function public.credit_preview(uuid, text[], text[]) to authenticated;
grant execute on function public.submit_bug_report(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.my_bug_reports(uuid) to authenticated;
grant execute on function public.admin_bug_reports(text) to authenticated;
grant execute on function public.admin_review_bug_report(uuid, text, text, uuid) to authenticated;
grant execute on function public.admin_credit_accounts() to authenticated;
