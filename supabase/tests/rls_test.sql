-- =====================================================================
-- RATEOS — tests de Row Level Security (ejecutar con el plugin/MCP de
-- Supabase o con psql como postgres).
--
-- Crea dos usuarios de prueba (A y B) dentro de un bloque que SIEMPRE
-- termina con RAISE EXCEPTION: Postgres deshace todo (usuarios, filas,
-- cambios). Nada queda en la base.
--
-- Resultado esperado: un error con el texto
--   RLS_TESTS_PASSED: <n> controles
-- Cualquier otro resultado (RLS_TESTS_FAILED: … o un error distinto) es una
-- falla de seguridad que bloquea el deploy.
--
-- Simula cada rol como lo hace la API: SET ROLE authenticated / anon y los
-- claims del JWT en request.jwt.claims (lo que lee auth.uid()).
-- =====================================================================

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  org_a uuid;
  org_b uuid;
  n integer;
  rev bigint;
  who uuid;
  passed integer := 0;
  failed text[] := '{}';
begin
  -- ---------------------------------------------- usuarios de prueba
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'rls-a@rateos.invalid', '', '{"full_name":"Usuaria A","company":"Empresa A"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'rls-b@rateos.invalid', '', '{"full_name":"Usuario B","company":"Empresa B"}', '{}', now(), now(), now());

  select organization_id into org_a from public.organization_members where user_id = a;
  select organization_id into org_b from public.organization_members where user_id = b;

  -- ------------------------------------- alta de usuario (como postgres)
  select count(*) into n from public.organization_members where user_id = a and organization_id = org_a and role = 'OWNER';
  if n = 1 then passed := passed + 1; else failed := failed || 'alta: A no quedó OWNER de su organización'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_a and state is null and revision = 0;
  if n = 1 then passed := passed + 1; else failed := failed || 'alta: falta el workspace vacío de A'; end if;
  select count(*) into n from public.organizations where id = org_a and name = 'Empresa A';
  if n = 1 then passed := passed + 1; else failed := failed || 'alta: la organización de A no tiene el nombre de su empresa'; end if;
  if org_a <> org_b then passed := passed + 1; else failed := failed || 'alta: A y B comparten organización'; end if;

  -- ================================================= como USUARIA A
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.organizations where id = org_a;
  if n = 1 then passed := passed + 1; else failed := failed || 'A no lee su organización'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_a;
  if n = 1 then passed := passed + 1; else failed := failed || 'A no lee su workspace'; end if;
  select count(*) into n from public.profiles where id = a;
  if n = 1 then passed := passed + 1; else failed := failed || 'A no lee su perfil'; end if;

  -- A NO puede leer nada de B
  select count(*) into n from public.organizations where id = org_b;
  if n = 0 then passed := passed + 1; else failed := failed || 'A lee la organización de B'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_b;
  if n = 0 then passed := passed + 1; else failed := failed || 'A lee el workspace de B'; end if;
  select count(*) into n from public.organization_members where organization_id = org_b or user_id = b;
  if n = 0 then passed := passed + 1; else failed := failed || 'A ve membresías de B'; end if;
  select count(*) into n from public.profiles where id = b;
  if n = 0 then passed := passed + 1; else failed := failed || 'A lee el perfil de B'; end if;
  select count(*) into n from public.organizations;
  if n = 1 then passed := passed + 1; else failed := failed || 'A ve más organizaciones que la suya'; end if;

  -- A NO puede escribir en B
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = org_b;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'A modificó el workspace de B'; end if;
  update public.organizations set name = 'hack' where id = org_b;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'A renombró la organización de B'; end if;
  update public.profiles set full_name = 'hack' where id = b;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'A modificó el perfil de B'; end if;

  -- A NO puede crear membresías (ni OWNER en B, ni sumar a B a la suya)
  begin
    insert into public.organization_members (organization_id, user_id, role) values (org_b, a, 'OWNER');
    failed := failed || 'A se dio OWNER en la organización de B';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into public.organization_members (organization_id, user_id, role) values (org_a, b, 'VIEWER');
    failed := failed || 'A agregó a B a su organización';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update public.organization_members set role = 'OWNER' where user_id = a;
    failed := failed || 'A cambió un rol';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    delete from public.organization_members where organization_id = org_a;
    failed := failed || 'A borró membresías';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- A NO puede crear ni borrar organizaciones ni workspaces
  begin
    insert into public.organizations (name) values ('Otra');
    failed := failed || 'A creó una organización desde el cliente';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    delete from public.organizations where id = org_a;
    failed := failed || 'A borró su organización desde el cliente';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into public.workspace_states (organization_id) values (org_b);
    failed := failed || 'A creó un workspace';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    delete from public.workspace_states where organization_id = org_a;
    failed := failed || 'A borró su workspace';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- A NO puede tocar columnas de control (revision, organization_id, updated_by)
  begin
    update public.workspace_states set revision = 999 where organization_id = org_a;
    failed := failed || 'A escribió revision';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update public.workspace_states set organization_id = org_b where organization_id = org_a;
    failed := failed || 'A movió su workspace a otra organización';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update public.workspace_states set updated_by = b where organization_id = org_a;
    failed := failed || 'A falsificó updated_by';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- A SÍ guarda su workspace con control de revisión
  update public.workspace_states set state = '{"schemaVersion":2}'::jsonb, schema_version = 2
    where organization_id = org_a and revision = 0
    returning revision, updated_by into rev, who;
  if rev = 1 and who = a then passed := passed + 1; else failed := failed || 'A no pudo guardar su workspace (o la revisión/updated_by no se fijaron)'; end if;
  -- guardar sobre una revisión vieja no pisa nada (conflicto)
  update public.workspace_states set state = '{"schemaVersion":2,"stale":true}'::jsonb
    where organization_id = org_a and revision = 0;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'un guardado con revisión vieja pisó la versión nueva'; end if;

  -- las funciones de membresía no revelan otras organizaciones
  if not private.is_member(org_b) and private.is_member(org_a) then passed := passed + 1; else failed := failed || 'is_member responde mal para A'; end if;

  -- ================================================= como USUARIO B
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.organizations where id = org_a;
  if n = 0 then passed := passed + 1; else failed := failed || 'B lee la organización de A'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_a;
  if n = 0 then passed := passed + 1; else failed := failed || 'B lee el workspace de A'; end if;
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'B modificó el workspace de A'; end if;
  select count(*) into n from public.workspace_states where organization_id = org_b;
  if n = 1 then passed := passed + 1; else failed := failed || 'B no lee su workspace'; end if;

  -- ================================================= como ANON (sin sesión)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  begin
    perform 1 from public.workspace_states limit 1;
    failed := failed || 'anon puede leer workspace_states';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from public.organizations limit 1;
    failed := failed || 'anon puede leer organizations';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from public.organization_members limit 1;
    failed := failed || 'anon puede leer organization_members';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from public.profiles limit 1;
    failed := failed || 'anon puede leer profiles';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update public.workspace_states set state = '{}'::jsonb;
    failed := failed || 'anon puede escribir workspace_states';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.is_member(org_a);
    failed := failed || 'anon puede ejecutar private.is_member';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ============================================ sesión cerrada / usuario borrado
  -- Un JWT de un usuario que ya no existe (o de alguien sin membresía) no ve nada.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (gen_random_uuid())::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_states;
  if n = 0 then passed := passed + 1; else failed := failed || 'un usuario sin membresía ve workspaces'; end if;
  execute 'reset role';

  if array_length(failed, 1) is null then
    raise exception 'RLS_TESTS_PASSED: % controles', passed;
  else
    raise exception 'RLS_TESTS_FAILED: % ok, fallas: %', passed, array_to_string(failed, ' | ');
  end if;
end;
$$;
