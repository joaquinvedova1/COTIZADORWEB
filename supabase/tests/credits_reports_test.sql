-- =====================================================================
-- RATEOS — tests de créditos de prueba y reporte de errores (PLAN-2026-029,
-- migración 20261021120000_rateos_beta_credits_reports.sql).
--
-- Mismo mecanismo que rls_test.sql: un único bloque que SIEMPRE termina
-- con RAISE EXCEPTION, así que Postgres deshace todo (usuarios, empresas,
-- créditos, reportes y los cambios de política). Nada queda en la base.
--
-- Resultado esperado: un error con el texto
--   CREDITS_TESTS_PASSED: <n> controles
-- Cualquier otro resultado (CREDITS_TESTS_FAILED: … o un error distinto)
-- bloquea el deploy.
--
-- Simula cada rol como la API: SET ROLE authenticated / anon y los claims
-- del JWT (lo que lee auth.uid()). Las ayudas pg_temp.* son temporales y
-- también se deshacen.
--
-- La concurrencia real (dos sesiones a la vez) está en
-- supabase/tests/local/credits_concurrency.sh: necesita confirmar
-- transacciones y sólo corre en el Postgres local SIMULADO.
-- =====================================================================

do $test$
declare
  example_product constant text := '00000000-0000-4000-8000-000000002001';
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  av uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  l uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  adm2 uuid := gen_random_uuid();
  org_a uuid;
  org_b uuid;
  org_l uuid;
  n integer;
  rev bigint;
  rev2 bigint;
  j jsonb;
  t text;
  r1 uuid;
  r2 uuid;
  r3 uuid;
  rl uuid;
  ids text[];
  passed integer := 0;
  failed text[] := '{}';
begin
  -- ----------------------------------------------------------- ayudas
  execute $f$create function pg_temp.ws(q text[], p text[], tag text default 'v1') returns jsonb language sql as $b$
    select jsonb_build_object('schemaVersion', 10,
      'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', x, 'name', 'Cotización ' || x, 'tag', tag)) from unnest(q) x), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('id', x, 'name', 'Producto ' || x, 'tag', tag)) from unnest(p) x), '[]'::jsonb)) $b$ $f$;
  execute $f$create function pg_temp.act_as(uid uuid) returns void language plpgsql as $b$
    begin
      reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
    end $b$ $f$;
  execute $f$create function pg_temp.act_anon() returns void language plpgsql as $b$
    begin
      reset role;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform set_config('request.jwt.claim.sub', '', true);
      set local role anon;
    end $b$ $f$;
  execute $f$create function pg_temp.act_postgres() returns void language plpgsql as $b$
    begin
      reset role;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
    end $b$ $f$;

  -- --------------------------------------------------- usuarios de prueba
  -- Una empresa "existente" (registrada sin la política de testers) y las
  -- demás con la política: 10 créditos y +2 por reporte aprobado.
  update private.beta_policy set quota_for_new_orgs = false where id;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', l, 'authenticated', 'authenticated', 'cr-l@rateos.invalid', '', '{"company":"Empresa existente"}', '{}', now(), now(), now());
  update private.beta_policy set quota_for_new_orgs = true, initial_credits = 10, report_reward = 2 where id;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values
    ('00000000-0000-0000-0000-000000000000', a1, 'authenticated', 'authenticated', 'cr-a1@rateos.invalid', '', '{"company":"Tester A"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a2, 'authenticated', 'authenticated', 'cr-a2@rateos.invalid', '', '{"company":"Propia de a2"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', av, 'authenticated', 'authenticated', 'cr-av@rateos.invalid', '', '{"company":"Propia de av"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'cr-b@rateos.invalid', '', '{"company":"Tester B"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', adm, 'authenticated', 'authenticated', 'cr-adm@rateos.invalid', '', '{"company":"Plataforma"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', adm2, 'authenticated', 'authenticated', 'cr-adm2@rateos.invalid', '', '{"company":"Plataforma 2"}', '{}', now(), now(), now());
  select organization_id into org_a from public.organization_members where user_id = a1;
  select organization_id into org_b from public.organization_members where user_id = b;
  select organization_id into org_l from public.organization_members where user_id = l;
  insert into public.organization_members (organization_id, user_id, role) values (org_a, a2, 'ESTIMATOR'), (org_a, av, 'VIEWER'), (org_a, adm2, 'VIEWER');
  insert into private.platform_admins (user_id, granted_via) values (adm, 'bootstrap'), (adm2, 'bootstrap');

  -- ------------------------------------------------------- alta y cuentas
  select count(*) into n from private.credit_accounts where organization_id = org_a and balance = 10 and enabled;
  if n = 1 then passed := passed + 1; else failed := failed || text 'la empresa tester no arrancó con 10 créditos'; end if;
  select count(*) into n from private.credit_ledger where organization_id = org_a and reason = 'initial_grant' and delta = 10;
  if n = 1 then passed := passed + 1; else failed := failed || text 'falta la asignación inicial en el ledger'; end if;
  select count(*) into n from private.credit_accounts where organization_id = org_l;
  if n = 0 then passed := passed + 1; else failed := failed || text 'la empresa existente recibió una cuota'; end if;

  -- --------------------------------------------- créditos: crear y editar
  perform pg_temp.act_as(a1);
  j := public.get_my_credits(org_a);
  if (j ->> 'enabled')::boolean and (j ->> 'balance')::int = 10 and (j ->> 'used')::int = 0 and (j ->> 'report_reward')::int = 2 then passed := passed + 1; else failed := failed || ('saldo inicial visto por A: ' || j::text); end if;

  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2'], array['p1']) where organization_id = org_a;
  get diagnostics n = row_count;
  j := public.get_my_credits(org_a);
  if n = 1 and (j ->> 'balance')::int = 7 and (j ->> 'used')::int = 3 then passed := passed + 1; else failed := failed || ('crear 2 cotizaciones y 1 producto: ' || j::text); end if;

  -- Editar (mismos ids, otro contenido): no cobra.
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2'], array['p1'], 'editado') where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 7 then passed := passed + 1; else failed := failed || text 'editar cobró créditos'; end if;

  -- Borrar no reintegra; volver a tener el mismo id (restaurar) no cobra.
  update public.workspace_states set state = pg_temp.ws(array['q1'], array['p1']) where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 7 then passed := passed + 1; else failed := failed || text 'borrar cambió el saldo'; end if;
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2'], array['p1'], 'restaurado') where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 7 then passed := passed + 1; else failed := failed || text 'restaurar un cálculo propio cobró'; end if;

  -- El ejemplo de producto (id fijo) no cobra.
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2'], array['p1', example_product]) where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 7 then passed := passed + 1; else failed := failed || text 'el ejemplo cobró'; end if;

  -- ----------------------------------- estructura que escondería cálculos
  select revision into rev from public.workspace_states where organization_id = org_a;
  foreach t in array array[
    '{"schemaVersion":10,"quotes":[{"id":"q1"},{"id":"q1"}],"products":[]}',
    '{"schemaVersion":10,"quotes":[{"id":"q1"},{"name":"sin id"}],"products":[]}',
    '{"schemaVersion":10,"quotes":[{"id":7}],"products":[]}',
    '{"schemaVersion":10,"quotes":[{"id":""}],"products":[]}',
    '{"schemaVersion":10,"quotes":{"q1":{"id":"q1"}},"products":[]}',
    '{"schemaVersion":10,"quotes":["q1"],"products":[]}',
    '{"schemaVersion":10,"quotes":[],"products":[{"id":"p1"},{"id":"p1"}]}',
    (select jsonb_build_object('schemaVersion', 10, 'quotes', jsonb_agg(jsonb_build_object('id', 'x' || g)))::text from generate_series(1, 5001) g)
  ] loop
    begin
      update public.workspace_states set state = t::jsonb where organization_id = org_a;
      failed := failed || ('estructura inválida aceptada: ' || left(t, 120));
    exception when others then
      if sqlerrm = 'rateos_invalid_calculations' then passed := passed + 1; else failed := failed || ('estructura inválida con otro error: ' || sqlerrm); end if;
    end;
  end loop;
  select revision into rev2 from public.workspace_states where organization_id = org_a;
  if rev2 = rev then passed := passed + 1; else failed := failed || text 'un rechazo cambió la revisión'; end if;

  -- ------------------------------- misma empresa: saldo compartido y roles
  perform pg_temp.act_as(a2);
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3'], array['p1', example_product]) where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 6 then passed := passed + 1; else failed := failed || text 'el ESTIMATOR no comparte el saldo de la empresa'; end if;
  perform pg_temp.act_postgres();
  select count(*) into n from private.credit_ledger where organization_id = org_a and entity_id = 'q3' and actor = a2;
  if n = 1 then passed := passed + 1; else failed := failed || text 'el cobro no registra quién creó el cálculo'; end if;

  perform pg_temp.act_as(av);
  if (public.get_my_credits(org_a) ->> 'balance')::int = 6 then passed := passed + 1; else failed := failed || text 'el VIEWER no ve el saldo'; end if;
  update public.workspace_states set state = pg_temp.ws(array['q1', 'viewer'], array[]::text[]) where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; else failed := failed || text 'el VIEWER guardó el workspace'; end if;

  -- --------------------------------------------------------- saldo en 0
  perform pg_temp.act_as(a1);
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'], array['p1', example_product]) where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 0 then passed := passed + 1; else failed := failed || text 'no llegó a 0 con 6 cálculos más'; end if;
  select revision into rev from public.workspace_states where organization_id = org_a;
  begin
    update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'], array['p1', example_product]) where organization_id = org_a;
    failed := failed || text 'con 0 créditos se guardó un cálculo nuevo';
  exception when others then
    get stacked diagnostics t = pg_exception_detail;
    if sqlerrm = 'rateos_credits_exhausted' then passed := passed + 1; else failed := failed || ('sin saldo, otro error: ' || sqlerrm); end if;
    -- El detalle dice cuántos y cuáles (sólo ids de la propia empresa).
    if t::jsonb = '{"needed": 1, "balance": 0, "quotes": ["q10"], "products": []}'::jsonb then passed := passed + 1; else failed := failed || ('detalle del rechazo: ' || coalesce(t, 'null')); end if;
  end;
  select revision into rev2 from public.workspace_states where organization_id = org_a;
  select count(*) into n from public.workspace_states w, jsonb_array_elements(w.state -> 'quotes') e where w.organization_id = org_a and e ->> 'id' = 'q10';
  if rev2 = rev and n = 0 then passed := passed + 1; else failed := failed || text 'el rechazo guardó algo'; end if;
  -- Sin saldo: editar, borrar y restaurar siguen funcionando.
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'], array['p1', example_product], 'editado sin saldo') where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed || text 'sin saldo no se pudo editar'; end if;
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q5', 'q6', 'q7', 'q8', 'q9'], array['p1', example_product]) where organization_id = org_a;
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'], array['p1', example_product]) where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 1 and (public.get_my_credits(org_a) ->> 'balance')::int = 0 then passed := passed + 1; else failed := failed || text 'sin saldo no se pudo borrar y restaurar'; end if;
  -- Importar 3 cálculos nuevos de una vez: se rechaza todo.
  begin
    update public.workspace_states set state = pg_temp.ws(array['q1', 'imp1', 'imp2'], array['imp3']) where organization_id = org_a;
    failed := failed || text 'una importación sin saldo se guardó';
  exception when others then
    if sqlerrm = 'rateos_credits_exhausted' then passed := passed + 1; else failed := failed || ('importación sin saldo, otro error: ' || sqlerrm); end if;
  end;
  -- Vista previa: cuántos cobraría (sin reservar nada).
  j := public.credit_preview(org_a, array['q1', 'q2', 'nuevo1', 'nuevo1'], array['p1', example_product, 'nuevo2']);
  if (j ->> 'chargeable')::int = 2 and (j ->> 'balance')::int = 0 then passed := passed + 1; else failed := failed || ('vista previa: ' || j::text); end if;

  -- -------------------------------- manipulación directa (sin privilegios)
  begin
    update private.credit_accounts set balance = 999 where organization_id = org_a;
    failed := failed || text 'A cambió su saldo';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into private.credit_ledger (organization_id, delta, reason) values (org_a, 50, 'admin_adjustment');
    failed := failed || text 'A escribió el ledger';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from private.credit_accounts;
    failed := failed || text 'A lee credit_accounts';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.enable_credit_quota(org_a, 100);
    failed := failed || text 'A ejecuta enable_credit_quota';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform private.admin_adjust_credits(org_a, 100, 'hack');
    failed := failed || text 'A ejecuta admin_adjust_credits';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    update private.beta_policy set initial_credits = 1000;
    failed := failed || text 'A cambia la política';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Columnas de control del workspace: siguen sin poder tocarse.
  begin
    update public.workspace_states set revision = 0 where organization_id = org_a;
    failed := failed || text 'A cambió la revisión';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ------------------------------------------------- entre empresas (A↔B)
  begin
    perform public.get_my_credits(org_b);
    failed := failed || text 'A ve el saldo de B';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform public.credit_preview(org_b, array['x'], array[]::text[]);
    failed := failed || text 'A consulta la vista previa de B';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  perform pg_temp.act_as(b);
  begin
    perform public.get_my_credits(org_a);
    failed := failed || text 'B ve el saldo de A';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- B usa los mismos ids que A: se cobran en B (el ledger es por empresa).
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2'], array[]::text[]) where organization_id = org_b;
  if (public.get_my_credits(org_b) ->> 'balance')::int = 8 then passed := passed + 1; else failed := failed || text 'los ids de A no se cobraron en B'; end if;
  perform pg_temp.act_as(a1);
  if (public.get_my_credits(org_a) ->> 'balance')::int = 0 then passed := passed + 1; else failed := failed || text 'lo de B cambió el saldo de A'; end if;

  -- --------------------------------------- empresa existente: sin cambios
  perform pg_temp.act_as(l);
  select array_agg('l' || g) into ids from generate_series(1, 30) g;
  update public.workspace_states set state = pg_temp.ws(ids, array['lp1']) where organization_id = org_l;
  get diagnostics n = row_count;
  j := public.get_my_credits(org_l);
  if n = 1 and (j ->> 'enabled')::boolean = false then passed := passed + 1; else failed := failed || text 'la empresa existente tiene límite'; end if;
  update public.workspace_states set state = '{"schemaVersion":10,"quotes":[{"name":"sin id"}]}'::jsonb where organization_id = org_l;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed || text 'la empresa existente no guarda lo que guardaba antes'; end if;
  update public.workspace_states set state = pg_temp.ws(ids, array['lp1']) where organization_id = org_l;
  perform pg_temp.act_postgres();
  select count(*) into n from private.credit_ledger where organization_id = org_l;
  if n = 0 then passed := passed + 1; else failed := failed || text 'la empresa existente tiene movimientos'; end if;

  -- ------------------------------------------------------------- anon
  perform pg_temp.act_anon();
  begin
    perform public.get_my_credits(org_a);
    failed := failed || text 'anon ve un saldo';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform public.submit_bug_report(org_a, 'otro', 'hice algo', 'otra cosa', 'pasó esto', 'inicio', '0.9.0');
    failed := failed || text 'anon envía reportes';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  perform pg_temp.act_postgres();

  -- ----------------------------------------------------------- reportes
  perform pg_temp.act_as(a1);
  j := public.submit_bug_report(org_a, 'calculo', E'Cargué una cotización\u0007\u200B\u202E de hidrogrúa\u0085', 'Que el margen sea 20 %', 'Dio 35 %', 'resultado', '0.9.0');
  r1 := (j ->> 'id')::uuid;
  if j ->> 'status' = 'received' and r1 is not null then passed := passed + 1; else failed := failed || ('enviar reporte: ' || j::text); end if;
  perform pg_temp.act_postgres();
  select count(*) into n from private.bug_reports where id = r1 and did = 'Cargué una cotización de hidrogrúa' and reporter = a1 and organization_id = org_a;
  if n = 1 then passed := passed + 1; else failed := failed || text 'el reporte no quedó limpio y asociado a la empresa'; end if;
  select count(*) into n from private.bug_report_events where report_id = r1 and to_status = 'received' and actor = a1;
  if n = 1 then passed := passed + 1; else failed := failed || text 'falta el evento de recepción'; end if;

  perform pg_temp.act_as(a1);
  -- Validación: listas fijas, longitudes y formato.
  foreach t in array array['categoria', 'pantalla', 'corto', 'largo', 'version'] loop
    begin
      perform public.submit_bug_report(org_a,
        case when t = 'categoria' then 'hack' else 'otro' end,
        case when t = 'corto' then 'a' when t = 'largo' then repeat('x', 2001) else 'Algo que hice ' || t end,
        'Lo que esperaba', 'Lo que pasó',
        case when t = 'pantalla' then 'cotizaciones/123' else 'inicio' end,
        case when t = 'version' then '0.9.0 <script>' else '0.9.0' end);
      failed := failed || ('reporte inválido aceptado: ' || t);
    exception when others then
      if sqlerrm = 'rateos_report_invalid' then passed := passed + 1; else failed := failed || ('reporte inválido con otro error: ' || sqlerrm); end if;
    end;
  end loop;
  -- El mismo texto dos veces (doble clic): se rechaza.
  begin
    perform public.submit_bug_report(org_a, 'calculo', 'Cargué una cotización de hidrogrúa', 'Que el margen sea 20 %', 'Dio 35 %', 'resultado', '0.9.0');
    failed := failed || text 'reporte duplicado aceptado';
  exception when others then
    if sqlerrm = 'rateos_report_duplicate' then passed := passed + 1; else failed := failed || ('duplicado con otro error: ' || sqlerrm); end if;
  end;
  -- A no reporta en nombre de B.
  begin
    perform public.submit_bug_report(org_b, 'otro', 'Algo que hice', 'Lo que esperaba', 'Lo que pasó', 'inicio', '0.9.0');
    failed := failed || text 'A reporta en la empresa de B';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Límite por persona: 5 en 24 h.
  for n in 2..5 loop
    j := public.submit_bug_report(org_a, 'pantalla', 'Paso ' || n, 'Lo que esperaba', 'Lo que pasó', 'inicio', '0.9.0');
    if n = 2 then r2 := (j ->> 'id')::uuid; elsif n = 3 then r3 := (j ->> 'id')::uuid; end if;
  end loop;
  begin
    perform public.submit_bug_report(org_a, 'pantalla', 'Paso 6', 'Lo que esperaba', 'Lo que pasó', 'inicio', '0.9.0');
    failed := failed || text 'una persona superó 5 reportes en 24 h';
  exception when others then
    if sqlerrm = 'rateos_report_rate_limited' then passed := passed + 1; else failed := failed || ('límite por persona, otro error: ' || sqlerrm); end if;
  end;
  -- Límite por empresa: 10 en 24 h.
  perform pg_temp.act_as(a2);
  for n in 1..5 loop
    perform public.submit_bug_report(org_a, 'guardado', 'Paso de a2 ' || n, 'Lo que esperaba', 'Lo que pasó', 'cotizacion', '0.9.0');
  end loop;
  perform pg_temp.act_as(av);
  begin
    perform public.submit_bug_report(org_a, 'otro', 'Paso del viewer', 'Lo que esperaba', 'Lo que pasó', 'inicio', '0.9.0');
    failed := failed || text 'la empresa superó 10 reportes en 24 h';
  exception when others then
    if sqlerrm = 'rateos_report_rate_limited' then passed := passed + 1; else failed := failed || ('límite por empresa, otro error: ' || sqlerrm); end if;
  end;
  -- Mis reportes: los de la empresa propia, con "mine" correcto.
  perform pg_temp.act_as(a2);
  select count(*), count(*) filter (where mine) into n, rev from public.my_bug_reports(org_a);
  if n = 10 and rev = 5 then passed := passed + 1; else failed := failed || format('mis reportes de a2: %s, propios %s', n, rev); end if;
  perform pg_temp.act_as(b);
  begin
    perform 1 from public.my_bug_reports(org_a);
    failed := failed || text 'B lee los reportes de A';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  select count(*) into n from public.my_bug_reports(org_b);
  if n = 0 then passed := passed + 1; else failed := failed || text 'B ve reportes que no son de su empresa'; end if;
  -- Ni lectura ni escritura directa de las tablas de reportes.
  begin
    perform 1 from private.bug_reports;
    failed := failed || text 'B lee bug_reports';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  perform pg_temp.act_as(a1);
  begin
    update private.bug_reports set status = 'approved' where id = r1;
    failed := failed || text 'A aprobó su propio reporte';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Un usuario normal no usa las funciones de revisión.
  begin
    perform 1 from public.admin_bug_reports();
    failed := failed || text 'A lee la cola de reportes';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform public.admin_review_bug_report(r1, 'approved');
    failed := failed || text 'A se aprueba un reporte';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform 1 from public.admin_credit_accounts();
    failed := failed || text 'A lee los saldos de todas las empresas';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Alguien de otra empresa, sin el rol de plataforma, tampoco aprueba.
  perform pg_temp.act_as(b);
  begin
    perform public.admin_review_bug_report(r3, 'approved');
    failed := failed || text 'B aprobó un reporte de A sin ser RATEOS ADMIN';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform public.admin_review_bug_report(r3, 'in_review');
    failed := failed || text 'B cambió el estado de un reporte de A';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  -- Un reporte de la empresa existente (sin cuota).
  perform pg_temp.act_as(l);
  rl := (public.submit_bug_report(org_l, 'pdf', 'Exporté el PDF', 'Que salga el logo', 'Salió sin logo', 'pdf', '0.9.0') ->> 'id')::uuid;

  -- ------------------------------------------------- revisión: RATEOS ADMIN
  perform pg_temp.act_as(adm);
  select count(*) into n from public.admin_bug_reports('open');
  if n = 11 then passed := passed + 1; else failed := failed || format('cola abierta: %s reportes', n); end if;
  select count(*) into n from public.admin_bug_reports() r where r.id = r1 and r.organization_name = 'Tester A' and r.reporter_email = 'cr-a1@rateos.invalid' and r.org_balance = 0 and r.org_quota_enabled;
  if n = 1 then passed := passed + 1; else failed := failed || text 'la cola no muestra empresa, quién y saldo'; end if;

  j := public.admin_review_bug_report(r1, 'in_review', 'Lo estamos mirando');
  if j ->> 'status' = 'in_review' and (j ->> 'credits_added')::int = 0 then passed := passed + 1; else failed := failed || ('en revisión: ' || j::text); end if;
  j := public.admin_review_bug_report(r1, 'approved', 'Confirmado: era un error. ¡Gracias!');
  if (j ->> 'credits_added')::int = 2 and (j ->> 'balance')::int = 2 then passed := passed + 1; else failed := failed || ('aprobar: ' || j::text); end if;
  -- Segunda aprobación: no suma nada.
  j := public.admin_review_bug_report(r1, 'approved');
  if (j ->> 'already')::boolean and (j ->> 'credits_added')::int = 0 then passed := passed + 1; else failed := failed || ('doble aprobación: ' || j::text); end if;
  -- "Aprobado" es definitivo.
  begin
    perform public.admin_review_bug_report(r1, 'rejected');
    failed := failed || text 'un reporte aprobado volvió a otro estado';
  exception when others then
    if sqlerrm = 'rateos_report_final' then passed := passed + 1; else failed := failed || ('aprobado → rechazado, otro error: ' || sqlerrm); end if;
  end;
  -- Duplicado: necesita un original válido.
  foreach t in array array['sin original', 'a sí mismo', 'inexistente'] loop
    begin
      perform public.admin_review_bug_report(r2, 'duplicate', null,
        case when t = 'a sí mismo' then r2 when t = 'inexistente' then gen_random_uuid() else null end);
      failed := failed || ('duplicado inválido aceptado: ' || t);
    exception when others then
      if sqlerrm = 'rateos_report_invalid' then passed := passed + 1; else failed := failed || ('duplicado inválido, otro error: ' || sqlerrm); end if;
    end;
  end loop;
  j := public.admin_review_bug_report(r2, 'duplicate', 'Es el mismo error', r1);
  if j ->> 'status' = 'duplicate' and (j ->> 'credits_added')::int = 0 then passed := passed + 1; else failed := failed || ('duplicado: ' || j::text); end if;
  j := public.admin_review_bug_report(r3, 'rejected', 'No pudimos reproducirlo');
  if (j ->> 'credits_added')::int = 0 then passed := passed + 1; else failed := failed || text 'rechazar sumó créditos'; end if;
  -- Estados que no existen.
  begin
    perform public.admin_review_bug_report(r3, 'received');
    failed := failed || text 'se pudo volver a "recibido"';
  exception when others then
    if sqlerrm = 'rateos_report_invalid' then passed := passed + 1; else failed := failed || ('estado inválido, otro error: ' || sqlerrm); end if;
  end;
  -- Empresa sin cuota: se aprueba, sin créditos.
  j := public.admin_review_bug_report(rl, 'approved');
  if j ->> 'status' = 'approved' and (j ->> 'credits_added')::int = 0 then passed := passed + 1; else failed := failed || ('aprobar sin cuota: ' || j::text); end if;
  -- Historial auditable.
  select r.history into j from public.admin_bug_reports() r where r.id = r1;
  if jsonb_array_length(j) = 3
     and j -> 1 ->> 'actor' = 'cr-adm@rateos.invalid' and j -> 1 ->> 'to' = 'in_review'
     and j -> 2 ->> 'to' = 'approved' and (j -> 2 ->> 'credits')::int = 2 then
    passed := passed + 1;
  else
    failed := failed || ('historial: ' || coalesce(j::text, 'null'));
  end if;
  select count(*) into n from public.admin_credit_accounts() c where c.organization_name = 'Tester A' and c.balance = 2 and c.used = 10 and c.rewarded = 2 and c.initial = 10;
  if n = 1 then passed := passed + 1; else failed := failed || text 'saldos de admin incorrectos'; end if;
  perform pg_temp.act_postgres();
  select count(*) into n from private.credit_ledger where bug_report_id = r1 and reason = 'bug_report_reward';
  if n = 1 then passed := passed + 1; else failed := failed || format('premios del reporte: %s', n); end if;

  -- Un admin que es miembro de la empresa no revisa sus reportes.
  perform pg_temp.act_as(adm2);
  begin
    perform public.admin_review_bug_report(r3, 'approved');
    failed := failed || text 'un admin aprobó un reporte de su propia empresa';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- La empresa ve el resultado y puede usar los 2 créditos.
  perform pg_temp.act_as(a1);
  select count(*) into n from public.my_bug_reports(org_a) r where r.id = r1 and r.status = 'approved' and r.credits_added = 2 and r.review_note like 'Confirmado%';
  if n = 1 then passed := passed + 1; else failed := failed || text 'la empresa no ve su reporte aprobado'; end if;
  update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11'], array['p1', example_product]) where organization_id = org_a;
  if (public.get_my_credits(org_a) ->> 'balance')::int = 0 then passed := passed + 1; else failed := failed || text 'los 2 créditos del reporte no se pudieron usar'; end if;
  begin
    update public.workspace_states set state = pg_temp.ws(array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'], array['p1', example_product]) where organization_id = org_a;
    failed := failed || text 'se creó un cálculo de más después del premio';
  exception when others then
    if sqlerrm = 'rateos_credits_exhausted' then passed := passed + 1; else failed := failed || ('después del premio, otro error: ' || sqlerrm); end if;
  end;
  perform pg_temp.act_postgres();

  -- --------------------------------------- herramientas del dueño (SQL)
  -- Activar la cuota en la empresa existente: lo que ya tiene no se cobra.
  j := private.enable_credit_quota(org_l, 5, 'prueba');
  if (j ->> 'created')::boolean and (j ->> 'existing_registered')::int = 31 and (j ->> 'balance')::int = 5 then passed := passed + 1; else failed := failed || ('activar cuota: ' || j::text); end if;
  perform pg_temp.act_as(l);
  update public.workspace_states set state = pg_temp.ws(ids, array['lp1'], 'editado') where organization_id = org_l;
  if (public.get_my_credits(org_l) ->> 'balance')::int = 5 then passed := passed + 1; else failed := failed || text 'al activar la cuota se cobró lo existente'; end if;
  update public.workspace_states set state = pg_temp.ws(ids || array['nueva'], array['lp1']) where organization_id = org_l;
  if (public.get_my_credits(org_l) ->> 'balance')::int = 4 then passed := passed + 1; else failed := failed || text 'con la cuota activada no se cobra lo nuevo'; end if;
  perform pg_temp.act_postgres();
  if private.admin_adjust_credits(org_a, 3, 'restaurar respaldo de otra cuenta') = 3 then passed := passed + 1; else failed := failed || text 'ajuste manual'; end if;
  begin
    perform private.admin_adjust_credits(org_a, 3, '');
    failed := failed || text 'ajuste sin nota';
  exception when others then passed := passed + 1;
  end;
  begin
    perform private.admin_adjust_credits(org_a, -100, 'dejar negativo');
    failed := failed || text 'el saldo quedó negativo';
  exception when check_violation then passed := passed + 1;
  end;
  -- Deshabilitar la cuenta (por SQL) quita el límite sin tocar el workspace.
  update private.credit_accounts set enabled = false where organization_id = org_a;
  perform pg_temp.act_as(a1);
  update public.workspace_states set state = pg_temp.ws(array['q1', 'libre1', 'libre2', 'libre3', 'libre4'], array[]::text[]) where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 1 and (public.get_my_credits(org_a) ->> 'enabled')::boolean = false then passed := passed + 1; else failed := failed || text 'la cuenta deshabilitada sigue limitando'; end if;
  perform pg_temp.act_postgres();

  -- ---------------------------------------------------- catálogo en vivo
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'private' and table_name in ('beta_policy', 'credit_accounts', 'credit_ledger', 'bug_reports', 'bug_report_events')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n = 0 then passed := passed + 1; else failed := failed || text 'catálogo: hay permisos sobre las tablas nuevas'; end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'private' and c.relname in ('beta_policy', 'credit_accounts', 'credit_ledger', 'bug_reports', 'bug_report_events') and c.relrowsecurity;
  if n = 5 then passed := passed + 1; else failed := failed || text 'catálogo: tabla nueva sin RLS'; end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname = 'public'
     and f.proname in ('get_my_credits', 'credit_preview', 'submit_bug_report', 'my_bug_reports', 'admin_bug_reports', 'admin_review_bug_report', 'admin_credit_accounts')
     and not f.prosecdef and has_function_privilege('authenticated', f.oid, 'EXECUTE') and not has_function_privilege('anon', f.oid, 'EXECUTE');
  if n = 7 then passed := passed + 1; else failed := failed || format('catálogo: %s de 7 funciones públicas invoker sólo para authenticated', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname = 'private'
     and f.proname in ('workspace_credit_guard', 'handle_new_organization_credits', 'workspace_calculation_ids', 'clean_report_text', 'enable_credit_quota', 'admin_adjust_credits')
     and (has_function_privilege('authenticated', f.oid, 'EXECUTE') or has_function_privilege('anon', f.oid, 'EXECUTE'));
  if n = 0 then passed := passed + 1; else failed := failed || format('catálogo: %s función(es) internas ejecutables desde la API', n); end if;
  -- Las funciones para miembros y admins no leen el workspace.
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname in ('public', 'private')
     and f.proname in ('get_my_credits', 'credit_preview', 'submit_bug_report', 'my_bug_reports', 'admin_bug_reports', 'admin_review_bug_report', 'admin_credit_accounts')
     and f.prosrc ilike '%workspace_states%';
  if n = 0 then passed := passed + 1; else failed := failed || text 'catálogo: una función de créditos o reportes lee workspace_states'; end if;
  select count(*) into n from pg_trigger
   where not tgisinternal and tgname in ('workspace_states_credit_guard', 'organizations_credit_account') and tgenabled = 'O';
  if n = 2 then passed := passed + 1; else failed := failed || text 'catálogo: faltan los triggers de créditos'; end if;

  if array_length(failed, 1) is null then
    raise exception 'CREDITS_TESTS_PASSED: % controles', passed;
  else
    raise exception 'CREDITS_TESTS_FAILED: % ok, fallas: %', passed, array_to_string(failed, ' | ');
  end if;
end;
$test$;
