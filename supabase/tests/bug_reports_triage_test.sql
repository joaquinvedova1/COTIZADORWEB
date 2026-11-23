-- Controles de la migración 20261123221818 (reportes: tipo, severidad, seguimiento).
-- Corre dentro de una transacción y se deshace. NO correr sobre producción sin
-- autorización del dueño: crea un reporte sintético (rollback al final).
begin;
-- 1. anon no puede llamar al seguimiento ni leer el historial.
set local role anon;
do $$ begin
  begin perform public.admin_update_bug_report(gen_random_uuid(), '{}'::jsonb); raise exception 'FALLA: anon llamó admin_update_bug_report';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- 2. authenticated sin rol de admin: forbidden.
set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$ begin
  begin perform public.admin_bug_reports(); raise exception 'FALLA: no admin leyó reportes';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
end $$;
reset role;
-- 3. El contexto sólo guarda claves conocidas y el tipo se valida.
do $$ declare r jsonb; c jsonb; k text; begin
  r := private.insert_bug_report('{"what_happened":"prueba de control","kind":"calculo","context":{"mode":"cuenta","language":"es-AR","clientes":"ACME"}}', null, 'abcdefabcdefabcd');
  select context, kind into c, k from private.bug_reports where id = (r->>'id')::uuid;
  if c ? 'clientes' then raise exception 'FALLA: el contexto guardó claves de más'; end if;
  if k <> 'calculo' then raise exception 'FALLA: no guardó el tipo'; end if;
end $$;
-- 4. Ni anon ni authenticated leen private.workspace_state_history.
do $$ begin
  if has_table_privilege('authenticated', 'private.workspace_state_history', 'select') or has_table_privilege('anon', 'private.workspace_state_history', 'select') then
    raise exception 'FALLA: historial legible desde la API';
  end if;
end $$;
select 'bug_reports_triage_test: OK' as resultado;
rollback;
