-- =====================================================================
-- RATEOS — tests del feedback de la beta: problemas y sugerencias
-- (PLAN-2026-029, migración 20261022120000_rateos_beta_feedback.sql).
--
-- Mismo mecanismo que rls_test.sql: un único bloque que SIEMPRE termina
-- con RAISE EXCEPTION, así que Postgres deshace todo (usuarios, empresas y
-- feedback). Nada queda en la base.
--
-- Resultado esperado: un error con el texto
--   FEEDBACK_TESTS_PASSED: <n> controles
-- Cualquier otro resultado (FEEDBACK_TESTS_FAILED: … o un error distinto)
-- bloquea el deploy.
--
-- Simula cada rol como la API: SET ROLE authenticated / anon y los claims
-- del JWT (lo que lee auth.uid()). Las ayudas pg_temp.* son temporales y
-- también se deshacen.
--
-- La concurrencia real (dos sesiones a la vez) está en
-- supabase/tests/local/feedback_concurrency.sh: necesita confirmar
-- transacciones y sólo corre en el Postgres local SIMULADO.
-- =====================================================================

do $test$
declare
  a1 uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  av uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  org_a uuid;
  org_b uuid;
  org_adm uuid;
  n integer;
  j jsonb;
  t text;
  f1 uuid;
  f2 uuid;
  f3 uuid;
  fb uuid;
  fadm uuid;
  passed integer := 0;
  failed text[] := '{}';
begin
  -- ----------------------------------------------------------- ayudas
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
  -- Envía un problema con textos únicos (para probar los límites sin chocar con el control de repetidos).
  execute $f$create function pg_temp.problem(org uuid, tag text) returns jsonb language sql as $b$
    select public.submit_feedback(org, 'problem', 'calculo', 'Pasó algo raro ' || tag, null, null, 'resultado', '0.9.0') $b$ $f$;

  -- --------------------------------------------------- usuarios de prueba
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
  values
    ('00000000-0000-0000-0000-000000000000', a1, 'authenticated', 'authenticated', 'fb-a1@rateos.invalid', '', '{"company":"Empresa A"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', a2, 'authenticated', 'authenticated', 'fb-a2@rateos.invalid', '', '{"company":"Propia de a2"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', av, 'authenticated', 'authenticated', 'fb-av@rateos.invalid', '', '{"company":"Propia de av"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'fb-b@rateos.invalid', '', '{"company":"Empresa B"}', '{}', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', adm, 'authenticated', 'authenticated', 'fb-adm@rateos.invalid', '', '{"company":"Plataforma"}', '{}', now(), now(), now());
  select organization_id into org_a from public.organization_members where user_id = a1;
  select organization_id into org_b from public.organization_members where user_id = b;
  select organization_id into org_adm from public.organization_members where user_id = adm;
  insert into public.organization_members (organization_id, user_id, role) values (org_a, a2, 'ESTIMATOR'), (org_a, av, 'VIEWER');
  insert into private.platform_admins (user_id, granted_via) values (adm, 'bootstrap');

  -- ------------------------------------------------- sin créditos ni cupos
  -- La migración no agrega nada al guardado: una empresa nueva guarda 15 cotizaciones y 5 productos nuevos.
  perform pg_temp.act_as(a1);
  update public.workspace_states
     set state = jsonb_build_object('schemaVersion', 10,
       'quotes', (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'name', 'Cotización ' || i)) from generate_series(1, 15) i),
       'products', (select jsonb_agg(jsonb_build_object('id', 'p' || i, 'name', 'Producto ' || i)) from generate_series(1, 5) i))
   where organization_id = org_a;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; else failed := failed || text 'una empresa nueva no pudo guardar 15 cotizaciones y 5 productos'; end if;
  perform pg_temp.act_postgres();
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'private' and c.relname in ('beta_policy', 'credit_accounts', 'credit_ledger', 'bug_reports', 'bug_report_events');
  if n = 0 then passed := passed + 1; else failed := failed || text 'quedan tablas de créditos o de la versión anterior'; end if;
  select count(*) into n from pg_trigger where not tgisinternal and (tgname ilike '%credit%' or tgrelid = 'public.workspace_states'::regclass and tgname not in (
    select tgname from pg_trigger where tgrelid = 'public.workspace_states'::regclass and tgname in ('workspace_states_before_update', 'workspace_states_before_insert')));
  if n = 0 then passed := passed + 1; else failed := failed || text 'hay un trigger de créditos o uno nuevo sobre workspace_states'; end if;

  -- --------------------------------------------------------------- anon
  perform pg_temp.act_anon();
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', 'Hola desde afuera', null, null, 'inicio', '0.9.0');
    failed := failed || text 'anon envió feedback';
  exception when others then passed := passed + 1;
  end;
  begin
    perform * from public.my_feedback(org_a);
    failed := failed || text 'anon leyó feedback';
  exception when others then passed := passed + 1;
  end;
  begin
    perform * from public.admin_feedback(null, null);
    failed := failed || text 'anon leyó la cola de admin';
  exception when others then passed := passed + 1;
  end;

  -- ------------------------------------------------ acceso directo (API)
  perform pg_temp.act_as(a1);
  begin
    perform count(*) from private.feedback;
    failed := failed || text 'authenticated leyó private.feedback directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    insert into private.feedback (organization_id, author, kind, message, screen, app_version) values (org_a, a1, 'problem', 'directo', 'inicio', '0.9.0');
    failed := failed || text 'authenticated insertó en private.feedback directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;
  begin
    perform count(*) from private.feedback_events;
    failed := failed || text 'authenticated leyó private.feedback_events directo';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ---------------------------------------------------------- envío
  j := public.submit_feedback(org_a, 'problem', 'calculo', '  El costo del mes no cambió  ', 'Cambié los días a 20', 'Que subiera el costo', 'resultado', '0.9.0');
  f1 := (j ->> 'id')::uuid;
  if j ->> 'status' = 'received' and j ->> 'kind' = 'problem' and f1 is not null then passed := passed + 1; else failed := failed || ('envío de un problema: ' || j::text); end if;
  j := public.submit_feedback(org_a, 'suggestion', 'pantalla', 'Poder ordenar la lista por cliente', 'Para encontrar rápido', 'esto no va', 'cotizaciones', '0.9.0');
  f2 := (j ->> 'id')::uuid;
  if j ->> 'kind' = 'suggestion' then passed := passed + 1; else failed := failed || ('envío de una sugerencia: ' || j::text); end if;
  j := public.submit_feedback(org_a, 'suggestion', null, 'Un modo oscuro', null, null, 'otra', '0.9.0');
  f3 := (j ->> 'id')::uuid;

  perform pg_temp.act_postgres();
  select count(*) into n from private.feedback
   where id = f1 and author = a1 and organization_id = org_a and kind = 'problem' and category = 'calculo'
     and message = 'El costo del mes no cambió' and details = 'Cambié los días a 20' and expected = 'Que subiera el costo'
     and screen = 'resultado' and app_version = '0.9.0' and status = 'received';
  if n = 1 then passed := passed + 1; else failed := failed || text 'el problema no se guardó como se envió (texto limpio, autor, empresa)'; end if;
  select count(*) into n from private.feedback where id = f2 and expected is null and details = 'Para encontrar rápido';
  if n = 1 then passed := passed + 1; else failed := failed || text 'una sugerencia guardó "qué esperabas"'; end if;
  select count(*) into n from private.feedback where id = f3 and category = 'otro' and details is null;
  if n = 1 then passed := passed + 1; else failed := failed || text 'una sugerencia sin categoría no quedó en "otro"'; end if;
  select count(*) into n from private.feedback_events where feedback_id = f1 and to_status = 'received' and from_status is null and actor = a1;
  if n = 1 then passed := passed + 1; else failed := failed || text 'falta el evento de recepción'; end if;

  -- ------------------------------------------------------- validación
  perform pg_temp.act_as(a1);
  begin
    perform public.submit_feedback(org_a, 'queja', 'otro', 'Algo que no es un tipo', null, null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó un tipo inválido';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('tipo inválido, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', 'ab', null, null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó un mensaje de 2 letras';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('mensaje corto, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', repeat('x', 2001), null, null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó un mensaje de 2001 caracteres';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('mensaje largo, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', 'Mensaje válido largo', repeat('y', 2001), null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó un detalle de 2001 caracteres';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('detalle largo, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', 'Mensaje válido', null, null, 'cotizaciones/123', '0.9.0');
    failed := failed || text 'aceptó una pantalla fuera de la lista (con un id)';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('pantalla inválida, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', 'Mensaje válido', null, null, 'inicio', '0.9.0 <script>');
    failed := failed || text 'aceptó una versión con caracteres raros';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('versión inválida, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'precios', 'Mensaje válido', null, null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó una categoría fuera de la lista';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('categoría inválida, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'otro', E'​​  ‮ ', null, null, 'inicio', '0.9.0');
    failed := failed || text 'aceptó un mensaje de puros invisibles';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('invisibles, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.submit_feedback(org_a, 'problem', 'calculo', 'El costo del mes no cambió', 'Cambié los días a 20', 'Que subiera el costo', 'resultado', '0.9.0');
    failed := failed || text 'aceptó el mismo problema dos veces';
  exception when others then
    if sqlerrm = 'rateos_feedback_duplicate' then passed := passed + 1; else failed := failed || ('repetido, otro error: ' || sqlerrm); end if;
  end;
  -- Caracteres de dirección y de ancho cero se quitan (no disfrazan el texto ante el admin).
  j := public.submit_feedback(org_a, 'problem', 'pantalla', E'Bot​ón ‮oculto‬', null, null, 'inicio', '0.9.0');
  perform pg_temp.act_postgres();
  select count(*) into n from private.feedback where id = (j ->> 'id')::uuid and message = 'Botón oculto';
  if n = 1 then passed := passed + 1; else failed := failed || text 'no se quitaron los caracteres invisibles o de dirección'; end if;

  -- --------------------------------------------- límites contra el spam
  -- a1 ya envió 4: el 5.º entra y el 6.º no (5 por persona cada 24 h).
  perform pg_temp.act_as(a1);
  perform pg_temp.problem(org_a, 'a1-5');
  begin
    perform pg_temp.problem(org_a, 'a1-6');
    failed := failed || text 'una persona envió 6 en 24 horas';
  exception when others then
    if sqlerrm = 'rateos_feedback_rate_limited' then passed := passed + 1; else failed := failed || ('límite por persona, otro error: ' || sqlerrm); end if;
  end;
  -- La empresa llega a 10 con a2 (también un VIEWER puede enviar) y el 11.º no entra.
  perform pg_temp.act_as(a2);
  perform pg_temp.problem(org_a, 'a2-1');
  perform pg_temp.problem(org_a, 'a2-2');
  perform pg_temp.problem(org_a, 'a2-3');
  perform pg_temp.problem(org_a, 'a2-4');
  perform pg_temp.act_as(av);
  j := pg_temp.problem(org_a, 'av-1');
  if j ->> 'status' = 'received' then passed := passed + 1; else failed := failed || text 'un VIEWER no pudo enviar'; end if;
  begin
    perform pg_temp.problem(org_a, 'av-2');
    failed := failed || text 'la empresa envió 11 en 24 horas';
  exception when others then
    if sqlerrm = 'rateos_feedback_rate_limited' then passed := passed + 1; else failed := failed || ('límite por empresa, otro error: ' || sqlerrm); end if;
  end;
  -- 20 abiertos sin revisar (de días anteriores) frenan uno nuevo; al resolver uno, vuelve a entrar.
  perform pg_temp.act_postgres();
  insert into private.feedback (organization_id, author, kind, message, screen, app_version, created_at)
  select org_b, b, 'problem', 'Viejo ' || i, 'inicio', '0.8.1', now() - interval '3 days' from generate_series(1, 20) i;
  perform pg_temp.act_as(b);
  begin
    perform pg_temp.problem(org_b, 'b-1');
    failed := failed || text 'entró uno nuevo con 20 abiertos';
  exception when others then
    if sqlerrm = 'rateos_feedback_too_many_open' then passed := passed + 1; else failed := failed || ('abiertos, otro error: ' || sqlerrm); end if;
  end;
  perform pg_temp.act_postgres();
  update private.feedback set status = 'resolved' where id = (select id from private.feedback where organization_id = org_b order by created_at limit 1);
  perform pg_temp.act_as(b);
  j := pg_temp.problem(org_b, 'b-2');
  fb := (j ->> 'id')::uuid;
  if fb is not null then passed := passed + 1; else failed := failed || text 'con 19 abiertos no entró uno nuevo'; end if;

  -- ------------------------------------------------------ A ↔ B
  begin
    perform pg_temp.problem(org_a, 'b-en-a');
    failed := failed || text 'B envió feedback a la empresa A';
  exception when others then
    if sqlerrm = 'forbidden' then passed := passed + 1; else failed := failed || ('B en A, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform * from public.my_feedback(org_a);
    failed := failed || text 'B leyó el feedback de A';
  exception when others then
    if sqlerrm = 'forbidden' then passed := passed + 1; else failed := failed || ('B lee A, otro error: ' || sqlerrm); end if;
  end;
  perform pg_temp.act_as(a2);
  select count(*) into n from public.my_feedback(org_a);
  if n = 10 then passed := passed + 1; else failed := failed || format('A ve %s feedback de su empresa (esperado 10)', n); end if;
  select count(*) into n from public.my_feedback(org_a) where mine;
  if n = 4 then passed := passed + 1; else failed := failed || format('a2 ve %s propios (esperado 4)', n); end if;
  select count(*) into n from public.my_feedback(org_a) x where x.message like 'Viejo %' or x.message like '%b-2%';
  if n = 0 then passed := passed + 1; else failed := failed || text 'A ve feedback de B'; end if;

  -- ------------------------------------------------- RATEOS ADMIN
  perform pg_temp.act_as(a1);
  begin
    perform * from public.admin_feedback(null, null);
    failed := failed || text 'una persona sin rol leyó la cola de admin';
  exception when others then
    if sqlerrm = 'forbidden' then passed := passed + 1; else failed := failed || ('cola sin rol, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.admin_review_feedback(f1, 'confirmed', 'Me lo confirmo yo', null);
    failed := failed || text 'una persona sin rol cambió un estado';
  exception when others then
    if sqlerrm = 'forbidden' then passed := passed + 1; else failed := failed || ('revisión sin rol, otro error: ' || sqlerrm); end if;
  end;

  perform pg_temp.act_as(adm);
  select count(*) into n from public.admin_feedback('open', null) x where x.organization_name in ('Empresa A', 'Empresa B');
  if n = 30 then passed := passed + 1; else failed := failed || format('la cola abierta muestra %s (esperado 30: 10 de A y 20 de B)', n); end if;
  select count(*) into n from public.admin_feedback(null, 'suggestion') x where x.kind <> 'suggestion';
  if n = 0 then passed := passed + 1; else failed := failed || text 'el filtro por tipo mezcla problemas'; end if;
  select count(*) into n from public.admin_feedback(null, 'suggestion');
  if n = 2 then passed := passed + 1; else failed := failed || format('sugerencias en la cola: %s (esperado 2)', n); end if;
  select count(*) into n from public.admin_feedback(null, null) x where x.id = f1 and x.author_email = 'fb-a1@rateos.invalid' and x.organization_name = 'Empresa A' and x.details = 'Cambié los días a 20';
  if n = 1 then passed := passed + 1; else failed := failed || text 'la cola no muestra empresa, email y detalle'; end if;
  begin
    perform * from public.admin_feedback('approved', null);
    failed := failed || text 'la cola aceptó un estado viejo ("approved")';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('filtro inválido, otro error: ' || sqlerrm); end if;
  end;

  -- Confirmar con respuesta: la empresa ve el estado y la respuesta.
  j := public.admin_review_feedback(f1, 'confirmed', E'  Gracias: lo reproducimos.​ ', null);
  if j ->> 'status' = 'confirmed' and (j ->> 'changed')::boolean then passed := passed + 1; else failed := failed || ('confirmar: ' || j::text); end if;
  j := public.admin_review_feedback(f1, 'confirmed', null, null);
  if not (j ->> 'changed')::boolean then passed := passed + 1; else failed := failed || text 'repetir el mismo estado sin respuesta dejó otro evento'; end if;
  j := public.admin_review_feedback(f1, 'resolved', 'Corregido en la próxima versión.', null);
  begin
    perform public.admin_review_feedback(f1, 'received', null, null);
    failed := failed || text 'se pudo volver a "Recibido"';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('volver a recibido, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.admin_review_feedback(f1, 'approved', null, null);
    failed := failed || text 'aceptó el estado viejo "approved"';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('approved, otro error: ' || sqlerrm); end if;
  end;
  select count(*) into n from public.admin_feedback(null, null) x
   where x.id = f1 and x.status = 'resolved' and x.reviewer_email = 'fb-adm@rateos.invalid'
     and jsonb_array_length(x.history) = 3 and x.history -> 1 ->> 'to' = 'confirmed' and x.history -> 2 ->> 'to' = 'resolved'
     and x.history -> 1 ->> 'response' = 'Gracias: lo reproducimos.';
  if n = 1 then passed := passed + 1; else failed := failed || text 'el historial no muestra recibido → confirmado → resuelto con quién y la respuesta limpia'; end if;

  -- Duplicado: exige un original válido y distinto.
  begin
    perform public.admin_review_feedback(f2, 'duplicate', null, null);
    failed := failed || text 'duplicado sin original';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('duplicado sin original, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.admin_review_feedback(f2, 'duplicate', null, f2);
    failed := failed || text 'duplicado de sí mismo';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('duplicado de sí mismo, otro error: ' || sqlerrm); end if;
  end;
  begin
    perform public.admin_review_feedback(f2, 'duplicate', null, gen_random_uuid());
    failed := failed || text 'duplicado de uno inexistente';
  exception when others then
    if sqlerrm = 'rateos_feedback_invalid' then passed := passed + 1; else failed := failed || ('duplicado inexistente, otro error: ' || sqlerrm); end if;
  end;
  j := public.admin_review_feedback(f2, 'duplicate', null, f3);
  select count(*) into n from public.admin_feedback(null, null) x where x.id = f2 and x.status = 'duplicate' and x.duplicate_of = f3;
  if n = 1 then passed := passed + 1; else failed := failed || text 'no quedó marcado como duplicado del original'; end if;
  j := public.admin_review_feedback(f2, 'in_review', null, null);
  select count(*) into n from public.admin_feedback(null, null) x where x.id = f2 and x.status = 'in_review' and x.duplicate_of is null;
  if n = 1 then passed := passed + 1; else failed := failed || text 'al dejar de ser duplicado no se limpió el original'; end if;
  begin
    perform public.admin_review_feedback(gen_random_uuid(), 'in_review', null, null);
    failed := failed || text 'revisó uno inexistente';
  exception when others then
    if sqlerrm = 'rateos_feedback_not_found' then passed := passed + 1; else failed := failed || ('inexistente, otro error: ' || sqlerrm); end if;
  end;
  j := public.admin_review_feedback(f3, 'not_applicable', repeat('z', 1500), null);
  select count(*) into n from public.admin_feedback(null, null) x where x.id = f3 and char_length(x.response) = 1000;
  if n = 1 then passed := passed + 1; else failed := failed || text 'la respuesta no se recortó a 1000 caracteres'; end if;
  -- "Parecidos": mismo tipo, categoría y pantalla (sin contar los que no corresponden).
  select x.similar_count::int into n from public.admin_feedback(null, null) x where x.id = fb;
  if n = 7 then passed := passed + 1; else failed := failed || format('parecidos de un problema de B: %s (esperado 7, los de A con la misma categoría y pantalla)', n); end if;
  -- Sin plata de por medio, un admin también clasifica el feedback de su propia empresa.
  j := public.submit_feedback(org_adm, 'suggestion', 'otro', 'Sugerencia del equipo', null, null, 'inicio', '0.9.0');
  fadm := (j ->> 'id')::uuid;
  j := public.admin_review_feedback(fadm, 'in_review', null, null);
  if j ->> 'status' = 'in_review' then passed := passed + 1; else failed := failed || text 'un admin no pudo clasificar el feedback de su empresa'; end if;

  -- La empresa ve lo que respondió RATEOS (pero no quién).
  perform pg_temp.act_as(a1);
  select count(*) into n from public.my_feedback(org_a) x where x.id = f1 and x.status = 'resolved' and x.response = 'Corregido en la próxima versión.';
  if n = 1 then passed := passed + 1; else failed := failed || text 'la empresa no ve el estado y la respuesta'; end if;
  -- Un miembro no cambia estados por la tabla.
  begin
    update private.feedback set status = 'resolved' where id = f2;
    failed := failed || text 'un miembro cambió un estado por la tabla';
  exception when insufficient_privilege then passed := passed + 1;
  end;

  -- ----------------------------------------------------------- catálogo
  perform pg_temp.act_postgres();
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'private' and c.relname in ('feedback', 'feedback_events') and c.relrowsecurity
     and not has_table_privilege('authenticated', c.oid, 'SELECT') and not has_table_privilege('anon', c.oid, 'SELECT')
     and not has_table_privilege('authenticated', c.oid, 'INSERT') and not has_table_privilege('authenticated', c.oid, 'UPDATE');
  if n = 2 then passed := passed + 1; else failed := failed || format('catálogo: %s de 2 tablas con RLS y sin grants', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname = 'private' and f.proname in ('submit_feedback', 'my_feedback', 'admin_feedback', 'admin_review_feedback')
     and f.prosecdef and f.proconfig @> array['search_path=""'] and not has_function_privilege('anon', f.oid, 'EXECUTE');
  if n = 4 then passed := passed + 1; else failed := failed || format('catálogo: %s de 4 funciones definer con search_path vacío y sin anon', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname = 'public' and f.proname in ('submit_feedback', 'my_feedback', 'admin_feedback', 'admin_review_feedback')
     and not f.prosecdef and has_function_privilege('authenticated', f.oid, 'EXECUTE') and not has_function_privilege('anon', f.oid, 'EXECUTE');
  if n = 4 then passed := passed + 1; else failed := failed || format('catálogo: %s de 4 funciones públicas invoker sólo para authenticated', n); end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname = 'private' and f.proname = 'clean_feedback_text'
     and (has_function_privilege('authenticated', f.oid, 'EXECUTE') or has_function_privilege('anon', f.oid, 'EXECUTE'));
  if n = 0 then passed := passed + 1; else failed := failed || text 'catálogo: la limpieza de texto es ejecutable desde la API'; end if;
  -- Ninguna función del feedback lee el workspace.
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname in ('public', 'private') and f.proname in ('submit_feedback', 'my_feedback', 'admin_feedback', 'admin_review_feedback', 'clean_feedback_text')
     and f.prosrc ilike '%workspace_states%';
  if n = 0 then passed := passed + 1; else failed := failed || text 'catálogo: una función del feedback lee workspace_states'; end if;
  select count(*) into n from pg_proc f join pg_namespace s on s.oid = f.pronamespace
   where s.nspname in ('public', 'private') and f.proname ~ '(credit|bug_report)';
  if n = 0 then passed := passed + 1; else failed := failed || text 'catálogo: quedan funciones de créditos o de reportes viejos'; end if;

  if array_length(failed, 1) is null then
    raise exception 'FEEDBACK_TESTS_PASSED: % controles', passed;
  else
    raise exception 'FEEDBACK_TESTS_FAILED: % ok, fallas: %', passed, array_to_string(failed, ' | ');
  end if;
end;
$test$;
