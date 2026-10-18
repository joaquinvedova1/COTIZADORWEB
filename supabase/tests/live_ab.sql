-- =====================================================================
-- RATEOS — prueba A/B REAL (PLAN-2026-016, punto 4): dos usuarios y dos
-- organizaciones SINTÉTICOS en la base real, para tests/live/perimeter-ab.mjs.
--
-- A diferencia de rls_test.sql / beta_security_test.sql, esto NO se deshace
-- solo: el bloque 1 deja dos cuentas para poder ingresar de verdad (Supabase
-- Auth + la app). Todo lo sintético se identifica por estos dos emails:
--   perimetro-a@rateos.invalid · perimetro-b@rateos.invalid
-- (.invalid es un dominio reservado: nunca recibe correo). Nunca se lee ni se
-- toca ningún dato real: cada bloque filtra por esos emails.
--
-- Cuatro bloques, de a uno (plugin/MCP de Supabase o psql como postgres):
--   1. ALTA          crea las 2 cuentas (persiste). Reemplazar las contraseñas.
--   2. IDENTIFICAR   sólo lectura: qué es sintético (lo único que se puede borrar).
--   3. VERIFICAR     sólo lectura, después de la prueba.
--   4. LIMPIEZA      borra SÓLO lo sintético. Requiere autorización del dueño.
--
-- Alternativa al bloque 1 sin SQL: Dashboard → Authentication → Users →
-- Add user → Create new user (Auto Confirm User) con esos dos emails; las
-- organizaciones se llaman "Mi empresa" (el trigger de alta no recibe la
-- empresa) y la prueba no depende del nombre.
-- =====================================================================


-- ------------------------------------------------------------- 1. ALTA
-- Reemplazar las dos contraseñas (≥ 20 caracteres, distintas, nunca en git).
-- Columnas de token en '' (no NULL): Supabase Auth no admite NULL al ingresar.
do $$
declare
  pw_a text := '__CONTRASENA_A__';
  pw_b text := '__CONTRASENA_B__';
  u uuid;
  spec record;
begin
  if pw_a like '\_\_%' or pw_b like '\_\_%' or length(pw_a) < 20 or length(pw_b) < 20 or pw_a = pw_b then
    raise exception 'LIVE_AB_SETUP: reemplazá las dos contraseñas (≥ 20 caracteres, distintas) antes del alta';
  end if;
  if exists (select 1 from auth.users where email in ('perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid')) then
    raise exception 'LIVE_AB_SETUP: las cuentas sintéticas ya existen (bloque 4 primero)';
  end if;
  for spec in
    select * from (values
      ('perimetro-a@rateos.invalid', pw_a, 'Prueba Perímetro A', 'SINTETICO Perímetro A'),
      ('perimetro-b@rateos.invalid', pw_b, 'Prueba Perímetro B', 'SINTETICO Perímetro B')
    ) as t(email, pw, full_name, company)
  loop
    u := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', spec.email,
            extensions.crypt(spec.pw, extensions.gen_salt('bf')),
            jsonb_build_object('full_name', spec.full_name, 'company', spec.company),
            '{"provider":"email","providers":["email"]}'::jsonb, now(), now(), now(),
            '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (u::text, u, jsonb_build_object('sub', u::text, 'email', spec.email, 'email_verified', true, 'phone_verified', false), 'email', now(), now());
  end loop;
end;
$$;


-- ------------------------------------------------------ 2. IDENTIFICAR
-- Sólo lectura. Exactamente 2 usuarios, 2 organizaciones (un miembro cada
-- una) y 2 workspaces: si aparece cualquier otra cosa, la limpieza se niega.
select u.email,
       u.id as user_id,
       m.organization_id,
       m.role,
       w.id as workspace_id,
       w.revision,
       (select count(*) from public.organization_members x where x.organization_id = m.organization_id) as members_in_org,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sessions,
       (select count(*) from auth.identities i where i.user_id = u.id) as identities
from auth.users u
left join public.organization_members m on m.user_id = u.id
left join public.workspace_states w on w.organization_id = m.organization_id
where u.email in ('perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid')
order by u.email;


-- ------------------------------------------------------- 3. VERIFICAR
-- Sólo lectura, después de tests/live/perimeter-ab.mjs: cada workspace
-- sintético quedó guardado por la app (revisión > 0, esquema 10), con SU
-- organización adentro y sin nada de la otra.
with synth as (
  select u.email, m.organization_id, w.revision, w.schema_version, w.state, w.updated_by, u.id as user_id
  from auth.users u
  join public.organization_members m on m.user_id = u.id
  join public.workspace_states w on w.organization_id = m.organization_id
  where u.email in ('perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid')
)
select s.email,
       s.revision > 0 as saved,
       s.schema_version as schema_version,
       (s.state -> 'organization' ->> 'id') = s.organization_id::text as own_organization,
       s.updated_by = s.user_id as saved_by_owner,
       not exists (
         select 1 from synth o
         where o.organization_id <> s.organization_id and s.state::text like '%' || o.organization_id::text || '%'
       ) as nothing_from_the_other
from synth s
order by s.email;


-- -------------------------------------------------------- 4. LIMPIEZA
-- BORRA. Sólo con autorización del dueño, después de mirar el bloque 2.
-- Borra las 2 organizaciones sintéticas (y con ellas workspaces y
-- membresías) y los 2 usuarios sintéticos (y con ellos perfiles,
-- identidades y sesiones). Se niega si encuentra algo distinto de eso.
do $$
declare
  synth_users uuid[];
  synth_orgs uuid[];
  n integer;
begin
  select array_agg(id) into synth_users
  from auth.users where email in ('perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid');
  if coalesce(array_length(synth_users, 1), 0) = 0 then
    raise exception 'LIVE_AB_CLEANUP: no hay cuentas sintéticas: nada que borrar';
  end if;
  select array_agg(distinct organization_id) into synth_orgs
  from public.organization_members where user_id = any(synth_users);
  select count(*) into n from public.organization_members
  where organization_id = any(coalesce(synth_orgs, '{}')) and not (user_id = any(synth_users));
  if n > 0 then
    raise exception 'LIVE_AB_CLEANUP: una organización sintética tiene otros miembros: no se borra nada';
  end if;
  if array_length(synth_users, 1) > 2 or coalesce(array_length(synth_orgs, 1), 0) > 2 then
    raise exception 'LIVE_AB_CLEANUP: hay más datos de los esperados: no se borra nada';
  end if;
  delete from public.organizations where id = any(coalesce(synth_orgs, '{}'));
  delete from auth.users where id = any(synth_users);
  if exists (select 1 from auth.users where email in ('perimetro-a@rateos.invalid', 'perimetro-b@rateos.invalid')) then
    raise exception 'LIVE_AB_CLEANUP: quedaron cuentas sintéticas';
  end if;
end;
$$;
