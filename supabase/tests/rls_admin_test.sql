-- =====================================================================
-- RATEOS ADMIN — tests de seguridad del rol de plataforma (ejecutar con el
-- plugin/MCP de Supabase o con psql como postgres).
--
-- Igual que rls_test.sql: todo ocurre dentro de un bloque que SIEMPRE
-- termina con RAISE EXCEPTION, así que Postgres deshace todo (usuarios,
-- bootstrap consumido, auditoría). Nada queda en la base.
--
-- Resultado esperado: un error con el texto
--   ADMIN_TESTS_PASSED: <n> controles
--
-- Cubre: bootstrap sólo con email CONFIRMADO y normalizado, de un solo uso;
-- metadata/claims/JWT/organizationId no dan RATEOS_ADMIN; usuario normal y
-- anon sin acceso a nada administrativo; RATEOS_ADMIN ve metadata pero NO el
-- workspace (state) de otra organización.
-- =====================================================================

do $$
declare
  master uuid := gen_random_uuid();
  normal uuid := gen_random_uuid();
  late uuid := gen_random_uuid();
  org_normal uuid;
  n integer;
  b boolean;
  j jsonb;
  keys text;
  passed integer := 0;
  failed text[] := '{}';
begin
  -- ------------------------------------------------ usuarios de prueba
  -- Usuario normal que intenta declararse admin por metadata (lo que el cliente controla).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', normal, 'authenticated', 'authenticated', 'admin-test-normal@rateos.invalid', '',
          '{"full_name":"Normal","company":"Empresa Normal","rateos_admin":true,"role":"RATEOS_ADMIN","platform_role":"RATEOS_ADMIN"}',
          '{"role":"RATEOS_ADMIN","rateos_admin":true}', now(), now(), now());
  select organization_id into org_normal from public.organization_members where user_id = normal;

  select count(*) into n from private.platform_admins where user_id = normal;
  if n = 0 then passed := passed + 1; else failed := failed || 'metadata/app_metadata dieron RATEOS_ADMIN'; end if;

  -- La cuenta master SIN confirmar (email con mayúsculas y espacios: se normaliza).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', master, 'authenticated', 'authenticated', ' JoaquinVedova@Hotmail.com ', '',
          '{"full_name":"Master","company":"DOVA"}', '{}', now(), now(), null);
  select count(*) into n from private.platform_admins where user_id = master;
  if n = 0 then passed := passed + 1; else failed := failed || 'email SIN confirmar dio RATEOS_ADMIN'; end if;
  select count(*) into n from private.platform_admin_bootstrap where consumed_at is null;
  if n >= 1 then passed := passed + 1; else failed := failed || 'el bootstrap se consumió sin confirmación'; end if;

  -- Confirma el email → RATEOS_ADMIN (bootstrap consumido).
  update auth.users set email_confirmed_at = now() where id = master;
  select count(*) into n from private.platform_admins where user_id = master and granted_via = 'bootstrap';
  if n = 1 then passed := passed + 1; else failed := failed || 'el master confirmado no quedó RATEOS_ADMIN'; end if;
  select count(*) into n from private.platform_admin_bootstrap where email = 'joaquinvedova@hotmail.com' and consumed_by = master;
  if n = 1 then passed := passed + 1; else failed := failed || 'el bootstrap no quedó consumido por el master'; end if;

  -- Un solo uso: otra cuenta confirmada con el mismo email (otra capitalización) NO lo obtiene.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', late, 'authenticated', 'authenticated', 'JOAQUINVEDOVA@HOTMAIL.COM', '', '{}', '{}', now(), now(), now());
  select count(*) into n from private.platform_admins where user_id = late;
  if n = 0 then passed := passed + 1; else failed := failed || 'el bootstrap se pudo usar dos veces'; end if;
  -- Ni cambiando el email de una cuenta existente (como haría GoTrue tras confirmar el cambio).
  update auth.users set email = 'joaquinvedova@hotmail.com.' where id = normal;
  update auth.users set email = 'joaquinvedova@hotmail.com' where id = late;
  select count(*) into n from private.platform_admins where user_id in (normal, late);
  if n = 0 then passed := passed + 1; else failed := failed || 'cambiar el email dio RATEOS_ADMIN tras consumirse el bootstrap'; end if;

  -- ============================================== como USUARIO NORMAL
  -- JWT "manipulado": claims con el email del master y roles inventados.
  -- (Un JWT real no se puede falsificar sin el secreto; acá se prueba que
  -- aunque los claims digan eso, la autoridad es sólo platform_admins por sub.)
  perform set_config('request.jwt.claims', json_build_object('sub', normal, 'role', 'authenticated', 'email', 'joaquinvedova@hotmail.com',
    'app_metadata', json_build_object('role', 'RATEOS_ADMIN'), 'user_metadata', json_build_object('rateos_admin', true))::text, true);
  perform set_config('request.jwt.claim.sub', normal::text, true);
  execute 'set local role authenticated';

  select public.am_i_platform_admin() into b;
  if b is false then passed := passed + 1; else failed := failed || 'claims del JWT dieron RATEOS_ADMIN'; end if;
  begin
    perform public.admin_overview();
    failed := failed || 'usuario normal leyó admin_overview';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform * from public.admin_users();
    failed := failed || 'usuario normal leyó admin_users';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from private.platform_admins limit 1;
    failed := failed || 'usuario normal leyó platform_admins';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into private.platform_admins (user_id, granted_via) values (normal, 'bootstrap');
    failed := failed || 'usuario normal se insertó en platform_admins';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from private.platform_admin_bootstrap limit 1;
    failed := failed || 'usuario normal leyó el bootstrap';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update private.platform_admin_bootstrap set consumed_at = null;
    failed := failed || 'usuario normal reactivó el bootstrap';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.grant_platform_admin_bootstrap(normal, 'joaquinvedova@hotmail.com', now());
    failed := failed || 'usuario normal ejecutó grant_platform_admin_bootstrap';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from private.admin_audit_log limit 1;
    failed := failed || 'usuario normal leyó la auditoría';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update auth.users set email = 'joaquinvedova@hotmail.com', email_confirmed_at = now() where id = normal;
    failed := failed || 'usuario normal modificó auth.users';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Cambiar organizationId no sirve: RLS sigue igual (no ve la organización del master).
  select count(*) into n from public.workspace_states w where w.organization_id <> org_normal;
  if n = 0 then passed := passed + 1; else failed := failed || 'usuario normal ve workspaces ajenos'; end if;

  -- ================================================== como RATEOS_ADMIN
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', master, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', master::text, true);
  execute 'set local role authenticated';

  select public.am_i_platform_admin() into b;
  if b is true then passed := passed + 1; else failed := failed || 'el master no se reconoce como RATEOS_ADMIN'; end if;
  select public.admin_overview() into j;
  if (j->>'users_total')::int >= 3 and (j->>'organizations_total')::int >= 3 then passed := passed + 1; else failed := failed || 'admin_overview sin conteos'; end if;
  select count(*) into n from public.admin_users() u where u.organization_name = 'Empresa Normal' and u.organization_role = 'OWNER';
  if n = 1 then passed := passed + 1; else failed := failed || 'admin_users no lista la metadata de otra empresa'; end if;
  select string_agg(k, ',') into keys from (select jsonb_object_keys(to_jsonb(u)) k from public.admin_users() u limit 1) s;
  if keys is not null and position(',state,' in ',' || keys || ',') = 0 then passed := passed + 1; else failed := failed || 'admin_users devuelve el state'; end if;
  -- Ser admin NO da acceso al workspace (contenido económico) de otra organización.
  select count(*) into n from public.workspace_states w where w.organization_id = org_normal;
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS_ADMIN lee el workspace de otra organización'; end if;
  update public.workspace_states set state = '{"hack":true}'::jsonb where organization_id = org_normal;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS_ADMIN modificó el workspace de otra organización'; end if;
  select count(*) into n from public.organizations o where o.id = org_normal;
  if n = 0 then passed := passed + 1; else failed := failed || 'RATEOS_ADMIN lee organizations ajenas por la API de tablas'; end if;
  begin
    perform 1 from private.platform_admins limit 1;
    failed := failed || 'RATEOS_ADMIN lee platform_admins directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from private.admin_audit_log limit 1;
    failed := failed || 'RATEOS_ADMIN lee la auditoría directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ========================================================== como ANON
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  begin
    perform public.am_i_platform_admin();
    failed := failed || 'anon ejecutó am_i_platform_admin';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform public.admin_overview();
    failed := failed || 'anon ejecutó admin_overview';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform * from public.admin_users();
    failed := failed || 'anon ejecutó admin_users';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.is_platform_admin();
    failed := failed || 'anon ejecutó is_platform_admin';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ===================================================== auditoría (postgres)
  execute 'reset role';
  select count(*) into n from private.admin_audit_log a where a.actor = master and a.action = 'ADMIN_PANEL_OPEN' and a.detail = '{}'::jsonb;
  if n = 1 then passed := passed + 1; else failed := failed || 'no se registró ADMIN_PANEL_OPEN (o con datos de más)'; end if;

  if array_length(failed, 1) is null then
    raise exception 'ADMIN_TESTS_PASSED: % controles', passed;
  else
    raise exception 'ADMIN_TESTS_FAILED: % ok, fallas: %', passed, array_to_string(failed, ' | ');
  end if;
end;
$$;
