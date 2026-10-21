#!/bin/bash
# =====================================================================
# RATEOS — concurrencia de créditos y reportes (PLAN-2026-029), SIMULADO.
#
# Necesita dos sesiones a la vez y confirmar transacciones, así que SÓLO
# corre en la base local `rateos_synth` (supabase/tests/local/reset.sh).
# Se niega a correr en cualquier otra base. Nunca contra Supabase.
#
# Casos:
#   C1  dos miembros crean a la vez con saldo 1, sin control de revisión
#       (peor caso: API directa): uno guarda, el otro recibe
#       rateos_credits_exhausted; un solo cobro.
#   C2  lo mismo con el control de revisión del cliente: el segundo no
#       guarda (0 filas = conflicto); un solo cobro.
#   C3  el mismo guardado dos veces a la vez (reintento): un solo cobro.
#   C4  dos aprobaciones simultáneas del mismo reporte: +2 una sola vez.
#   C5  una aprobación y un guardado que cobra, a la vez: saldo coherente.
#   C6  dos envíos simultáneos con un solo cupo por persona: uno solo entra.
#
# Resultado esperado: CONCURRENCY_PASSED: 6 casos
# =====================================================================
set -uo pipefail

DB=rateos_synth
PSQL=(runuser -u postgres -- psql -X -q -tA -d "$DB")

if [ "$("${PSQL[@]}" -c 'select current_database()')" != "$DB" ]; then
  echo "Se niega a correr: no es la base local $DB" >&2
  exit 2
fi

q() { "${PSQL[@]}" -v ON_ERROR_STOP=1 -c "$1"; }

# Sesión como un usuario (claims del JWT + rol authenticated) en una transacción.
as_user() {
  local uid="$1" sql="$2"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 <<SQL 2>&1
begin;
select set_config('request.jwt.claims', json_build_object('sub', '$uid', 'role', 'authenticated')::text, true) \\g /dev/null
select set_config('request.jwt.claim.sub', '$uid', true) \\g /dev/null
set local role authenticated;
$sql
commit;
SQL
}

ws() {  # ws "q1,q2" "p1" → JSON del workspace
  local qs="$1" ps="$2"
  echo "jsonb_build_object('schemaVersion', 10,
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('id', x)) from unnest(string_to_array('$qs', ',')) x where x <> ''), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', x)) from unnest(string_to_array('$ps', ',')) x where x <> ''), '[]'::jsonb))"
}

new_user() {  # new_user <email> <empresa> → uuid
  q "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '$1', '', json_build_object('company', '$2')::jsonb, '{}', now(), now(), now())
     returning id" | head -1
}

org_of() { q "select organization_id from public.organization_members where user_id = '$1' and role = 'OWNER'"; }
balance() { q "select balance from private.credit_accounts where organization_id = '$1'"; }
charges() { q "select count(*) from private.credit_ledger where organization_id = '$1' and reason = 'new_calculation'"; }

PASS=0
FAIL=()
check() {  # check <nombre> <condición bash>
  if eval "$2"; then PASS=$((PASS + 1)); echo "ok   $1"; else FAIL+=("$1"); echo "FAIL $1"; fi
}

q "update private.beta_policy set quota_for_new_orgs = true, initial_credits = 10, report_reward = 2 where id" >/dev/null
TAG="conc-$(date +%s%N)"
A1=$(new_user "a1-$TAG@rateos.invalid" "Concurrencia A")
ORG=$(org_of "$A1")
A2=$(new_user "a2-$TAG@rateos.invalid" "Propia a2")
q "insert into public.organization_members (organization_id, user_id, role) values ('$ORG', '$A2', 'ESTIMATOR')" >/dev/null
ADM=$(new_user "adm-$TAG@rateos.invalid" "Plataforma")
ADM2=$(new_user "adm2-$TAG@rateos.invalid" "Plataforma 2")
q "insert into private.platform_admins (user_id, granted_via) values ('$ADM', 'bootstrap'), ('$ADM2', 'bootstrap')" >/dev/null

# Estado inicial: 9 cálculos → saldo 1.
as_user "$A1" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8 p1) where organization_id = '$ORG';" >/dev/null
echo "saldo inicial para C1: $(balance "$ORG")"

# ---- C1: dos creaciones a la vez con saldo 1, sin control de revisión.
OUT1=$(mktemp); OUT2=$(mktemp)
as_user "$A1" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qA p1) where organization_id = '$ORG'; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.4
as_user "$A2" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qB p1) where organization_id = '$ORG';" >"$OUT2" &
P2=$!
wait $P1 $P2
check "C1 un solo cobro con saldo 1 (API directa)" \
  "[ \"$(balance "$ORG")\" = 0 ] && [ \"$(charges "$ORG")\" = 10 ] && grep -q rateos_credits_exhausted '$OUT2' && ! grep -q ERROR '$OUT1'"

# ---- C2: con control de revisión (como el cliente): el segundo es conflicto.
q "select private.admin_adjust_credits('$ORG', 1, 'concurrencia C2')" >/dev/null
REV=$(q "select revision from public.workspace_states where organization_id = '$ORG'")
as_user "$A1" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qA,qC p1) where organization_id = '$ORG' and revision = $REV; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.4
as_user "$A2" "with u as (update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qA,qD p1) where organization_id = '$ORG' and revision = $REV returning 1) select 'filas=' || count(*) from u;" >"$OUT2" &
P2=$!
wait $P1 $P2
check "C2 revisión: el segundo guardado no pisa ni cobra" \
  "[ \"$(balance "$ORG")\" = 0 ] && [ \"$(charges "$ORG")\" = 11 ] && grep -q 'filas=0' '$OUT2'"

# ---- C3: el mismo guardado dos veces a la vez (reintento): un cobro.
q "select private.admin_adjust_credits('$ORG', 2, 'concurrencia C3')" >/dev/null
for i in 1 2; do
  as_user "$A1" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qA,qC,qE p1) where organization_id = '$ORG'; select pg_sleep(1);" >/dev/null &
done
wait
check "C3 reintento simultáneo: un solo cobro" \
  "[ \"$(balance "$ORG")\" = 1 ] && [ \"$(charges "$ORG")\" = 12 ]"

# ---- C4: dos aprobaciones simultáneas del mismo reporte.
REPORT=$(as_user "$A1" "select public.submit_bug_report('$ORG', 'calculo', 'Hice algo', 'Esperaba otra cosa', 'Pasó esto', 'resultado', '0.9.0') ->> 'id';" | grep -E '^[0-9a-f-]{36}$')
as_user "$ADM" "select public.admin_review_bug_report('$REPORT', 'approved') ->> 'credits_added'; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.4
as_user "$ADM2" "select public.admin_review_bug_report('$REPORT', 'approved') ->> 'credits_added';" >"$OUT2" &
P2=$!
wait $P1 $P2
REWARDS=$(q "select count(*) from private.credit_ledger where bug_report_id = '$REPORT' and reason = 'bug_report_reward'")
check "C4 doble aprobación simultánea: +2 una sola vez" \
  "[ \"$REWARDS\" = 1 ] && [ \"$(balance "$ORG")\" = 3 ] && grep -qx 2 '$OUT1' && grep -qx 0 '$OUT2'"

# ---- C5: aprobación y guardado que cobra, a la vez.
REPORT2=$(as_user "$A2" "select public.submit_bug_report('$ORG', 'pantalla', 'Otro paso', 'Esperaba otra cosa', 'Pasó esto', 'inicio', '0.9.0') ->> 'id';" | grep -E '^[0-9a-f-]{36}$')
as_user "$A1" "update public.workspace_states set state = $(ws q1,q2,q3,q4,q5,q6,q7,q8,qA,qC,qE,qF p1) where organization_id = '$ORG'; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.4
as_user "$ADM" "select public.admin_review_bug_report('$REPORT2', 'approved') ->> 'credits_added';" >"$OUT2" &
P2=$!
wait $P1 $P2
check "C5 aprobación y cobro simultáneos: 3 - 1 + 2 = 4" \
  "[ \"$(balance "$ORG")\" = 4 ] && [ \"$(charges "$ORG")\" = 13 ] && ! grep -q ERROR '$OUT1' && grep -qx 2 '$OUT2'"

# ---- C6: dos envíos simultáneos con un solo cupo por persona.
for i in 1 2 3; do
  as_user "$A2" "select public.submit_bug_report('$ORG', 'otro', 'Relleno $i', 'Esperaba otra cosa', 'Pasó esto', 'inicio', '0.9.0');" >/dev/null
done
as_user "$A2" "select public.submit_bug_report('$ORG', 'otro', 'Simultáneo uno', 'Esperaba otra cosa', 'Pasó esto', 'inicio', '0.9.0'); select pg_sleep(1);" >"$OUT1" &
as_user "$A2" "select public.submit_bug_report('$ORG', 'otro', 'Simultáneo dos', 'Esperaba otra cosa', 'Pasó esto', 'inicio', '0.9.0'); select pg_sleep(1);" >"$OUT2" &
wait
MINE=$(q "select count(*) from private.bug_reports where reporter = '$A2'")
check "C6 límite por persona con envíos simultáneos" \
  "[ \"$MINE\" = 5 ] && [ \$(cat '$OUT1' '$OUT2' | grep -c rateos_report_rate_limited) = 1 ]"

rm -f "$OUT1" "$OUT2"
# Limpieza de lo sintético de esta corrida (base local).
q "delete from auth.users where email like '%-$TAG@rateos.invalid'" >/dev/null
q "delete from public.organizations o where not exists (select 1 from public.organization_members m where m.organization_id = o.id)" >/dev/null

if [ ${#FAIL[@]} -eq 0 ]; then
  echo "CONCURRENCY_PASSED: $PASS casos"
else
  echo "CONCURRENCY_FAILED: $PASS ok, fallas: ${FAIL[*]}"
  exit 1
fi
