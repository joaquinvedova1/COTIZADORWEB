-- =====================================================================
-- RATEOS — Beta Security Gate (PLAN-2026-015): tests de NEGACIÓN entre
-- empresas contra la base real (plugin/MCP de Supabase o psql como postgres).
--
-- Igual que rls_test.sql: todo ocurre dentro de un bloque que SIEMPRE
-- termina con RAISE EXCEPTION, así que Postgres deshace todo (usuarios,
-- empresas, membresías, workspaces, admin y auditoría sintéticos). Nada
-- queda en la base y ningún dato real se lee, se muestra ni se modifica:
-- - los únicos workspaces que se intentan escribir son SINTÉTICOS;
-- - las lecturas "sin filtro" sólo cuentan filas (prueban que una cuenta
--   nueva no ve a ninguna empresa real) y nunca devuelven contenido;
-- - los mensajes de falla sólo nombran actores sintéticos (A, B, …).
--
-- Ningún DELETE se ejecuta como postgres (el "miembro quitado" se arma con
-- un savepoint que se deshace): el plugin/MCP de Supabase pide confirmación
-- para sentencias destructivas y este test no la necesita.
--
-- Resultado esperado: un error con el texto
--   BETA_SECURITY_TESTS_PASSED: <n> controles   (132 al 2026-10-17)
-- Cualquier otro resultado (BETA_SECURITY_TESTS_FAILED: … o un error
-- distinto) es una falla de seguridad que bloquea la beta.
--
-- Cubre, en las dos direcciones (A→B y B→A) y con los IDs REALES de la otra
-- empresa (organización, fila del workspace, usuario):
--   lectura · escritura · borrado · alta falsificando organization_id ·
--   upsert · cambio de columnas de control · filtros manipulados ·
--   búsqueda por contenido · funciones de membresía · RPC de admin;
-- roles dentro de una empresa (OWNER / ADMIN / ESTIMATOR / VIEWER), un
-- miembro QUITADO de la empresa, un RATEOS ADMIN sintético (metadata sí,
-- contenido económico no), anon y un JWT sin usuario; y el catálogo en vivo
-- (RLS en todas las tablas, grants, funciones security definer, storage,
-- realtime) para detectar cambios de configuración.
-- =====================================================================

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  a_admin uuid := gen_random_uuid();
  a_est uuid := gen_random_uuid();
  a_view uuid := gen_random_uuid();
  a_gone uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  org_a uuid;
  org_b uuid;
  ws_a uuid;
  ws_b uuid;
  mark_a text := 'SINTETICO-A-' || replace(gen_random_uuid()::text, '-', '');
  mark_b text := 'SINTETICO-B-' || replace(gen_random_uuid()::text, '-', '');
  attackers uuid[];
  own_orgs uuid[];
  victims uuid[];
  victim_orgs uuid[];
  victim_ws uuid[];
  victim_marks text[];
  labels text[] := array['A→B', 'B→A'];
  i integer;
  x uuid;
  xo uuid;
  y uuid;
  yo uuid;
  yw uuid;
  ym text;
  lbl text;
  n integer;
  ok boolean;
  t text;
  j jsonb;
  passed integer := 0;
  failed text[] := '{}';
begin
  -- ================================================== catálogo en vivo
  -- RLS habilitada en TODAS las tablas de public.
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s tabla(s) de public sin RLS', n); end if;
  -- anon no tiene NINGÚN permiso sobre tablas de public ni private.
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema in ('public', 'private');
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: anon tiene %s permiso(s) de tabla', n); end if;
  -- authenticated no puede insertar, borrar ni truncar en tablas de public.
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: authenticated tiene %s permiso(s) de alta/borrado', n); end if;
  -- UPDATE sólo por columna y sólo en las columnas previstas.
  select count(*) into n from information_schema.column_privileges
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
     and (table_name::text, column_name::text) not in (('organizations', 'name'), ('profiles', 'full_name'), ('workspace_states', 'state'), ('workspace_states', 'schema_version'));
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s columna(s) actualizables no previstas', n); end if;
  -- Ningún permiso para nadie sobre las tablas de private (admin, bootstrap, auditoría).
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n = 0 then passed := passed + 1; else failed := failed || 'catálogo: hay permisos sobre tablas de private'; end if;
  -- security definer: sólo en private (salvo public.rls_auto_enable, de Supabase, que nadie de la API ejecuta) y con search_path fijo.
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where f.prosecdef and s.nspname = 'public' and f.proname <> 'rls_auto_enable';
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s función(es) security definer en public', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where f.prosecdef and s.nspname in ('public', 'private')
     and not exists (select 1 from unnest(coalesce(f.proconfig, '{}')) cfg where cfg like 'search_path=%');
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s función(es) security definer sin search_path', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname in ('public', 'private') and has_function_privilege('anon', f.oid, 'EXECUTE');
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: anon puede ejecutar %s función(es)', n); end if;
  if to_regprocedure('public.rls_auto_enable()') is null
     or not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') then
    passed := passed + 1;
  else
    failed := failed || 'catálogo: authenticated puede ejecutar rls_auto_enable';
  end if;
  -- private no es accesible para anon; vault tampoco para authenticated.
  if not has_schema_privilege('anon', 'private', 'USAGE') then passed := passed + 1; else failed := failed || 'catálogo: anon usa el schema private'; end if;
  -- Sin buckets públicos en Storage y sin tablas de clientes en Realtime.
  select count(*) into n from storage.buckets where public;
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s bucket(s) públicos', n); end if;
  select count(*) into n from pg_publication_tables where schemaname in ('public', 'private');
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s tabla(s) publicadas en Realtime', n); end if;
  -- Las tablas de private tienen RLS (deny-all, sin políticas ni grants).
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'private' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if n = 0 then passed := passed + 1; else failed := failed || 'catálogo: tabla de private sin RLS'; end if;

  -- ================================================ actores sintéticos
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'beta-a@rateos.invalid', '', '{"full_name":"Usuaria A","company":"Empresa A"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'beta-b@rateos.invalid', '', '{"full_name":"Usuario B","company":"Empresa B"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a_admin, 'authenticated', 'authenticated', 'beta-a-admin@rateos.invalid', '', '{"full_name":"Admin A","company":"Propia admin"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a_est, 'authenticated', 'authenticated', 'beta-a-est@rateos.invalid', '', '{"full_name":"Presupuestista A","company":"Propia est"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a_view, 'authenticated', 'authenticated', 'beta-a-view@rateos.invalid', '', '{"full_name":"Lectura A","company":"Propia view"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a_gone, 'authenticated', 'authenticated', 'beta-a-gone@rateos.invalid', '', '{"full_name":"Ex miembro A","company":"Propia gone"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', p, 'authenticated', 'authenticated', 'beta-platform@rateos.invalid', '', '{"full_name":"Plataforma","company":"Propia plataforma"}', '{}', now(), now(), now());

  select organization_id into org_a from public.organization_members where user_id = a;
  select organization_id into org_b from public.organization_members where user_id = b;
  select id into ws_a from public.workspace_states where organization_id = org_a;
  select id into ws_b from public.workspace_states where organization_id = org_b;
  -- Otros miembros de la empresa A (no se pueden crear desde el cliente: sólo postgres).
  insert into public.organization_members (organization_id, user_id, role) values
    (org_a, a_admin, 'ADMIN'), (org_a, a_est, 'ESTIMATOR'), (org_a, a_view, 'VIEWER');
  -- Contenido económico sintético con una marca única por empresa.
  update public.workspace_states set state = jsonb_build_object('schemaVersion', 10, 'marca', mark_a, 'organization', jsonb_build_object('id', org_a, 'name', 'Empresa A'), 'quotes', jsonb_build_array(jsonb_build_object('id', 'cot-a', 'client', mark_a, 'price', 123456.78)))
   where id = ws_a;
  update public.workspace_states set state = jsonb_build_object('schemaVersion', 10, 'marca', mark_b, 'organization', jsonb_build_object('id', org_b, 'name', 'Empresa B'), 'quotes', jsonb_build_array(jsonb_build_object('id', 'cot-b', 'client', mark_b, 'price', 987654.32)))
   where id = ws_b;
  -- RATEOS ADMIN sintético (como lo daría el bootstrap): se deshace con todo lo demás.
  insert into private.platform_admins (user_id, granted_via) values (p, 'bootstrap');

  if org_a is not null and org_b is not null and org_a <> org_b and ws_a is not null and ws_b is not null then
    passed := passed + 1;
  else
    failed := failed || 'alta: faltan las empresas o workspaces sintéticos';
  end if;

  attackers := array[a, b];
  own_orgs := array[org_a, org_b];
  victims := array[b, a];
  victim_orgs := array[org_b, org_a];
  victim_ws := array[ws_b, ws_a];
  victim_marks := array[mark_b, mark_a];

  -- ============================================ A→B y B→A con IDs conocidos
  for i in 1 .. 2 loop
    x := attackers[i];
    xo := own_orgs[i];
    y := victims[i];
    yo := victim_orgs[i];
    yw := victim_ws[i];
    ym := victim_marks[i];
    lbl := labels[i];

    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', x::text, true);
    execute 'set local role authenticated';

    -- ---------------------------------------------------------- lectura
    select count(*) into n from public.workspace_states where organization_id = yo;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: lee el workspace por organization_id', lbl); end if;
    select count(*) into n from public.workspace_states where id = yw;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: lee el workspace por su id', lbl); end if;
    select count(*) into n from public.workspace_states where organization_id in (xo, yo);
    if n = 1 then passed := passed + 1; else failed := failed || format('%s: un filtro IN con las dos empresas devuelve más que la propia', lbl); end if;
    select count(*) into n from public.workspace_states where organization_id <> xo or organization_id is null;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: un filtro "distinto de la mía" devuelve filas', lbl); end if;
    -- Sin filtro: sólo la propia (ni la sintética ni NINGUNA empresa real).
    select count(*) into n from public.workspace_states;
    if n = 1 then passed := passed + 1; else failed := failed || format('%s: sin filtro ve %s workspaces', lbl, n); end if;
    select count(*) into n from public.workspace_states where state::text like '%' || ym || '%';
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: encuentra el contenido ajeno buscando por texto', lbl); end if;
    select count(*) into n from public.organizations where id = yo;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: lee la organización ajena', lbl); end if;
    select count(*) into n from public.organizations;
    if n = 1 then passed := passed + 1; else failed := failed || format('%s: ve %s organizaciones', lbl, n); end if;
    select count(*) into n from public.organization_members where organization_id = yo or user_id = y;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: ve membresías ajenas', lbl); end if;
    select count(*) into n from public.profiles where id = y;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: lee el perfil ajeno', lbl); end if;
    select count(*) into n from public.profiles;
    if n = 1 then passed := passed + 1; else failed := failed || format('%s: ve %s perfiles', lbl, n); end if;
    if not private.is_member(yo) and not private.has_role(yo, array['OWNER', 'ADMIN', 'ESTIMATOR', 'VIEWER']) and private.is_member(xo) then
      passed := passed + 1;
    else
      failed := failed || format('%s: las funciones de membresía responden mal', lbl);
    end if;

    -- -------------------------------------------- escritura y borrado
    update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = yo;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: modifica el workspace ajeno por organization_id', lbl); end if;
    update public.workspace_states set state = '{"hack":true}'::jsonb where id = yw;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: modifica el workspace ajeno por id', lbl); end if;
    update public.workspace_states set schema_version = 99 where organization_id = yo;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: cambia el schema_version ajeno', lbl); end if;
    update public.organizations set name = 'hack' where id = yo;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: renombra la organización ajena', lbl); end if;
    update public.profiles set full_name = 'hack' where id = y;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; else failed := failed || format('%s: modifica el perfil ajeno', lbl); end if;
    begin
      delete from public.workspace_states where organization_id = yo;
      failed := failed || format('%s: borra el workspace ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      delete from public.organizations where id = yo;
      failed := failed || format('%s: borra la organización ajena', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      delete from public.profiles where id = y;
      failed := failed || format('%s: borra el perfil ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      delete from public.organization_members where organization_id = yo;
      failed := failed || format('%s: borra membresías ajenas', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;

    -- ------------------------- altas falsificando la organización ajena
    begin
      insert into public.workspace_states (organization_id, state) values (yo, '{"hack":true}'::jsonb);
      failed := failed || format('%s: crea un workspace con el organization_id ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      insert into public.workspace_states (organization_id, state) values (yo, '{"hack":true}'::jsonb)
        on conflict (organization_id) do update set state = excluded.state;
      failed := failed || format('%s: upsert sobre el workspace ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      insert into public.organization_members (organization_id, user_id, role) values (yo, x, 'VIEWER');
      failed := failed || format('%s: se suma como miembro de la empresa ajena', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      insert into public.organizations (id, name) values (yo, 'clon');
      failed := failed || format('%s: crea una organización con el id ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      insert into public.profiles (id, full_name) values (y, 'clon');
      failed := failed || format('%s: crea el perfil ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;

    -- ------------------------------------- columnas de control e identidad
    begin
      update public.workspace_states set organization_id = yo where organization_id = xo;
      failed := failed || format('%s: mueve su workspace a la empresa ajena', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      update public.workspace_states set id = yw where organization_id = xo;
      failed := failed || format('%s: copia el id del workspace ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      update public.workspace_states set revision = 0, updated_by = y where organization_id = xo;
      failed := failed || format('%s: escribe revision/updated_by', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      update public.organizations set id = yo where id = xo;
      failed := failed || format('%s: copia el id de la organización ajena', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      update public.profiles set id = y where id = x;
      failed := failed || format('%s: copia el id del perfil ajeno', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      update public.organization_members set organization_id = yo where user_id = x;
      failed := failed || format('%s: cambia su membresía a la empresa ajena', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;

    -- Su propio workspace con el organization_id ajeno ADENTRO del JSON:
    -- queda en su fila (RLS), nunca en la de la otra empresa.
    update public.workspace_states
       set state = jsonb_build_object('schemaVersion', 10, 'organization', jsonb_build_object('id', yo), 'quotes', jsonb_build_array(jsonb_build_object('organizationId', yo)))
     where organization_id = xo;
    get diagnostics n = row_count;
    if n = 1 then passed := passed + 1; else failed := failed || format('%s: no pudo guardar su propio workspace', lbl); end if;

    -- -------------------------------------------- RPC de administración
    select public.am_i_platform_admin() into ok;
    if ok is false then passed := passed + 1; else failed := failed || format('%s: se reconoce como RATEOS ADMIN', lbl); end if;
    begin
      perform * from public.admin_users();
      failed := failed || format('%s: lee admin_users', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      perform public.admin_overview();
      failed := failed || format('%s: lee admin_overview', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
    begin
      perform 1 from private.platform_admins limit 1;
      failed := failed || format('%s: lee platform_admins', lbl);
    exception when insufficient_privilege then passed := passed + 1;
    end;
  end loop;

  -- ===================================== integridad después de los ataques
  execute 'reset role';
  select count(*) into n from public.workspace_states
   where (id = ws_a and organization_id = org_a and state ->> 'organization' is not null)
      or (id = ws_b and organization_id = org_b and state ->> 'organization' is not null);
  if n = 2 then passed := passed + 1; else failed := failed || 'integridad: un workspace cambió de fila u organización'; end if;
  -- Cada fila sólo tiene lo que escribió SU empresa (nada con el contenido o la marca de la otra).
  select count(*) into n from public.workspace_states
   where (id = ws_a and (state::text like '%' || mark_b || '%' or state::text like '%hack%'))
      or (id = ws_b and (state::text like '%' || mark_a || '%' or state::text like '%hack%'));
  if n = 0 then passed := passed + 1; else failed := failed || 'integridad: contenido de una empresa llegó a la otra'; end if;
  select count(*) into n from public.organizations where (id = org_a and name = 'Empresa A') or (id = org_b and name = 'Empresa B');
  if n = 2 then passed := passed + 1; else failed := failed || 'integridad: cambió el nombre de una organización'; end if;
  select count(*) into n from public.workspace_states where id in (ws_a, ws_b) and schema_version = 99;
  if n = 0 then passed := passed + 1; else failed := failed || 'integridad: cambió el schema_version de otra empresa'; end if;
  select count(*) into n from public.organization_members where organization_id in (org_a, org_b) and user_id in (a, b) and organization_id <> case when user_id = a then org_a else org_b end;
  if n = 0 then passed := passed + 1; else failed := failed || 'integridad: apareció una membresía cruzada'; end if;

  -- Contenido de prueba otra vez (para los roles de la empresa A).
  update public.workspace_states set state = jsonb_build_object('schemaVersion', 10, 'marca', mark_a, 'organization', jsonb_build_object('id', org_a, 'name', 'Empresa A')) where id = ws_a;

  -- ============================================ roles dentro de la empresa A
  -- VIEWER: lee, no escribe ni renombra.
  perform set_config('request.jwt.claims', json_build_object('sub', a_view, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a_view::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_states where organization_id = org_a;
  if n = 1 then passed := passed + 1; else failed := failed || 'VIEWER no lee el workspace de su empresa'; end if;
  update public.workspace_states set state = '{"viewer":true}'::jsonb where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'VIEWER guardó el workspace'; end if;
  update public.organizations set name = 'viewer' where id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'VIEWER renombró la empresa'; end if;
  begin
    update public.organization_members set role = 'OWNER' where user_id = a_view;
    failed := failed || 'VIEWER se cambió el rol';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  select count(*) into n from public.profiles where id = a;
  if n = 0 then passed := passed + 1; else failed := failed || 'VIEWER lee el perfil de otro miembro'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_b;
  if n = 0 then passed := passed + 1; else failed := failed || 'VIEWER de A lee el workspace de B'; end if;

  -- ESTIMATOR: guarda el workspace, no renombra la empresa ni se sube el rol.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a_est, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a_est::text, true);
  execute 'set local role authenticated';
  update public.workspace_states set state = jsonb_build_object('schemaVersion', 10, 'marca', mark_a, 'editadoPor', 'ESTIMATOR') where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed || 'ESTIMATOR no pudo guardar el workspace de su empresa'; end if;
  update public.organizations set name = 'estimator' where id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'ESTIMATOR renombró la empresa'; end if;
  begin
    update public.organization_members set role = 'OWNER' where user_id = a_est;
    failed := failed || 'ESTIMATOR se subió el rol';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = org_b;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'ESTIMATOR de A modificó el workspace de B'; end if;

  -- ADMIN de la empresa: renombra SU empresa y guarda; nada de B.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a_admin::text, true);
  execute 'set local role authenticated';
  update public.organizations set name = 'Empresa A' where id = org_a;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed || 'ADMIN de la empresa no pudo renombrarla'; end if;
  update public.organizations set name = 'hack' where id = org_b;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'ADMIN de A renombró la empresa B'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_b;
  if n = 0 then passed := passed + 1; else failed := failed || 'ADMIN de A lee el workspace de B'; end if;
  -- Ser ADMIN de una empresa no es ser RATEOS ADMIN.
  begin
    perform * from public.admin_users();
    failed := failed || 'ADMIN de una empresa leyó admin_users';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ========================================= miembro QUITADO de la empresa
  -- La membresía de a_gone existe sólo dentro de un savepoint: mientras está,
  -- lee el workspace; al deshacerse el savepoint queda "quitado" (sin ningún
  -- DELETE: nada se borra, ni siquiera lo sintético).
  execute 'reset role';
  begin
    insert into public.organization_members (organization_id, user_id, role) values (org_a, a_gone, 'ESTIMATOR');
    perform set_config('request.jwt.claims', json_build_object('sub', a_gone, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', a_gone::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.workspace_states where organization_id = org_a;
    if n = 1 then passed := passed + 1; else failed := failed || 'el miembro (antes de quitarlo) no lee el workspace'; end if;
    raise exception using errcode = 'RT001', message = 'membresía quitada';
  exception when sqlstate 'RT001' then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a_gone, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a_gone::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_states where organization_id = org_a or id = ws_a;
  if n = 0 then passed := passed + 1; else failed := failed || 'miembro quitado sigue leyendo el workspace'; end if;
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'miembro quitado sigue guardando'; end if;
  select count(*) into n from public.organizations where id = org_a;
  if n = 0 then passed := passed + 1; else failed := failed || 'miembro quitado sigue viendo la empresa'; end if;
  select count(*) into n from public.organization_members where organization_id = org_a;
  if n = 0 then passed := passed + 1; else failed := failed || 'miembro quitado sigue viendo las membresías'; end if;
  if not private.is_member(org_a) then passed := passed + 1; else failed := failed || 'is_member sigue en true para un miembro quitado'; end if;

  -- ====================================================== RATEOS ADMIN sintético
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
  select public.am_i_platform_admin() into ok;
  if ok is true then passed := passed + 1; else failed := failed || 'RATEOS ADMIN sintético no se reconoce'; end if;
  -- Metadata sí (al menos las empresas sintéticas), contenido no: ni la columna state ni la marca de nadie.
  select count(*) into n from public.admin_users() u where u.organization_name in ('Empresa A', 'Empresa B');
  if n >= 2 then passed := passed + 1; else failed := failed || 'admin_users no lista la metadata de las empresas'; end if;
  select count(*) into n from public.admin_users() u where (to_jsonb(u) -> 'state') is not null;
  if n = 0 then passed := passed + 1; else failed := failed || 'admin_users devuelve la columna state'; end if;
  select count(*) into n from public.admin_users() u where to_jsonb(u)::text like '%' || mark_a || '%' or to_jsonb(u)::text like '%' || mark_b || '%';
  if n = 0 then passed := passed + 1; else failed := failed || 'admin_users devuelve contenido económico'; end if;
  select public.admin_overview() into j;
  if (j -> 'state') is null and j::text not like '%' || mark_a || '%' and j::text not like '%' || mark_b || '%' then passed := passed + 1; else failed := failed || 'admin_overview devuelve contenido'; end if;
  -- Por la API de tablas, el admin es una cuenta más: sólo su propia empresa.
  select count(*) into n from public.workspace_states where organization_id in (org_a, org_b) or id in (ws_a, ws_b);
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS ADMIN lee workspaces de clientes'; end if;
  select count(*) into n from public.workspace_states;
  if n = 1 then passed := passed + 1; else failed := failed || format('RATEOS ADMIN ve %s workspaces (sólo debería ver el propio)', n); end if;
  select count(*) into n from public.workspace_states where state::text like '%' || mark_a || '%' or state::text like '%' || mark_b || '%';
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS ADMIN encuentra contenido de clientes por texto'; end if;
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id in (org_a, org_b);
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS ADMIN modificó workspaces de clientes'; end if;
  select count(*) into n from public.organizations where id in (org_a, org_b);
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS ADMIN lee organizaciones por la API de tablas'; end if;
  select count(*) into n from public.profiles where id in (a, b);
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS ADMIN lee perfiles por la API de tablas'; end if;
  begin
    perform 1 from private.admin_audit_log limit 1;
    failed := failed || 'RATEOS ADMIN lee la auditoría directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ========================================== JWT sin usuario (sub vacío)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_states;
  if n = 0 then passed := passed + 1; else failed := failed || 'un JWT sin usuario ve workspaces'; end if;
  select count(*) into n from public.organizations;
  if n = 0 then passed := passed + 1; else failed := failed || 'un JWT sin usuario ve organizaciones'; end if;

  -- ================================================================= anon
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    perform 1 from public.workspace_states where id = ws_a;
    failed := failed || 'anon lee workspace_states';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update public.workspace_states set state = '{}'::jsonb where id = ws_a;
    failed := failed || 'anon escribe workspace_states';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into public.organization_members (organization_id, user_id, role) values (org_a, b, 'OWNER');
    failed := failed || 'anon crea membresías';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform * from public.admin_users();
    failed := failed || 'anon ejecuta admin_users';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.has_role(org_a, array['OWNER']);
    failed := failed || 'anon ejecuta private.has_role';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  execute 'reset role';
  if array_length(failed, 1) is null then
    raise exception 'BETA_SECURITY_TESTS_PASSED: % controles', passed;
  else
    raise exception 'BETA_SECURITY_TESTS_FAILED: % ok, fallas: %', passed, array_to_string(failed, ' | ');
  end if;
end;
$$;
