#!/bin/bash
# =====================================================================
# RATEOS — concurrencia del feedback de la beta (PLAN-2026-029), SIMULADO.
#
# Necesita varias sesiones a la vez y confirmar transacciones, así que SÓLO
# corre en la base local `rateos_synth` (supabase/tests/local/reset.sh).
# Se niega a correr en cualquier otra base. Nunca contra Supabase.
#
# Casos:
#   C1  dos envíos simultáneos con un solo cupo por persona: uno solo entra.
#   C2  dos envíos simultáneos con un solo cupo por empresa (dos personas):
#       uno solo entra.
#   C3  dos revisiones simultáneas del mismo feedback: las dos quedan en el
#       historial, en orden, y el estado final es el de la última.
#   C4  un guardado del workspace y un envío de feedback a la vez: ninguno
#       espera ni bloquea al otro (el feedback no toca el workspace).
#
# Resultado esperado: CONCURRENCY_PASSED: 4 casos
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

new_user() {  # new_user <email> <empresa> → uuid
  q "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, email_confirmed_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '$1', '', json_build_object('company', '$2')::jsonb, '{}', now(), now(), now())
     returning id" | head -1
}

org_of() { q "select organization_id from public.organization_members where user_id = '$1' and role = 'OWNER'"; }
send() {  # send <uid> <org> <texto> [espera]
  as_user "$1" "select public.submit_feedback('$2', 'problem', 'otro', '$3', null, null, 'inicio', '0.9.0') ->> 'status'; select pg_sleep(${4:-0});"
}

PASS=0
FAIL=()
check() {  # check <nombre> <condición bash>
  if eval "$2"; then PASS=$((PASS + 1)); echo "ok   $1"; else FAIL+=("$1"); echo "FAIL $1"; fi
}

TAG="conc-$(date +%s%N)"
A1=$(new_user "a1-$TAG@rateos.invalid" "Concurrencia A")
ORG=$(org_of "$A1")
A2=$(new_user "a2-$TAG@rateos.invalid" "Propia a2")
A3=$(new_user "a3-$TAG@rateos.invalid" "Propia a3")
q "insert into public.organization_members (organization_id, user_id, role) values ('$ORG', '$A2', 'ESTIMATOR'), ('$ORG', '$A3', 'ESTIMATOR')" >/dev/null
ADM=$(new_user "adm-$TAG@rateos.invalid" "Plataforma")
ADM2=$(new_user "adm2-$TAG@rateos.invalid" "Plataforma 2")
q "insert into private.platform_admins (user_id, granted_via) values ('$ADM', 'bootstrap'), ('$ADM2', 'bootstrap')" >/dev/null
OUT1=$(mktemp)
OUT2=$(mktemp)

# ---- C1: un solo cupo por persona (4 enviados) y dos envíos a la vez.
for i in 1 2 3 4; do send "$A1" "$ORG" "Relleno a1 $i" >/dev/null; done
send "$A1" "$ORG" "Simultáneo uno" 1 >"$OUT1" &
send "$A1" "$ORG" "Simultáneo dos" 1 >"$OUT2" &
wait
MINE=$(q "select count(*) from private.feedback where author = '$A1'")
check "C1 límite por persona con envíos simultáneos" \
  "[ \"$MINE\" = 5 ] && [ \$(cat '$OUT1' '$OUT2' | grep -c rateos_feedback_rate_limited) = 1 ]"

# ---- C2: un solo cupo por empresa (9 enviados) y dos personas a la vez.
for i in 1 2 3 4; do send "$A2" "$ORG" "Relleno a2 $i" >/dev/null; done
send "$A2" "$ORG" "Empresa uno" 1 >"$OUT1" &
send "$A3" "$ORG" "Empresa dos" 1 >"$OUT2" &
wait
ORGCOUNT=$(q "select count(*) from private.feedback where organization_id = '$ORG'")
check "C2 límite por empresa con envíos simultáneos de dos personas" \
  "[ \"$ORGCOUNT\" = 10 ] && [ \$(cat '$OUT1' '$OUT2' | grep -c rateos_feedback_rate_limited) = 1 ]"

# ---- C3: dos revisiones simultáneas del mismo feedback.
FB=$(q "select id from private.feedback where organization_id = '$ORG' order by created_at limit 1")
as_user "$ADM" "select public.admin_review_feedback('$FB', 'confirmed', 'Lo vemos', null) ->> 'status'; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.4
as_user "$ADM2" "select public.admin_review_feedback('$FB', 'resolved', 'Corregido', null) ->> 'status';" >"$OUT2" &
P2=$!
wait $P1 $P2
HIST=$(q "select string_agg(coalesce(from_status, '-') || '>' || to_status, ',' order by id) from private.feedback_events where feedback_id = '$FB'")
FINAL=$(q "select status from private.feedback where id = '$FB'")
check "C3 dos revisiones simultáneas: historial completo y en orden" \
  "[ \"$HIST\" = '->received,received>confirmed,confirmed>resolved' ] && [ \"$FINAL\" = resolved ] && ! grep -q ERROR '$OUT1' && ! grep -q ERROR '$OUT2'"

# ---- C4: el feedback no bloquea el guardado del workspace.
START=$(date +%s%N)
as_user "$A3" "update public.workspace_states set state = jsonb_build_object('schemaVersion', 10, 'quotes', '[]'::jsonb) where organization_id = '$ORG'; select pg_sleep(1.5);" >"$OUT1" &
P1=$!
sleep 0.3
as_user "$ADM" "select public.submit_feedback(org.organization_id, 'suggestion', 'otro', 'Mientras guardan', null, null, 'inicio', '0.9.0') ->> 'status' from public.organization_members org where org.user_id = '$ADM' and org.role = 'OWNER';" >"$OUT2"
ELAPSED=$(( ($(date +%s%N) - START) / 1000000 ))
wait $P1
check "C4 guardar y enviar feedback a la vez: no se bloquean" \
  "[ $ELAPSED -lt 1400 ] && grep -qx received '$OUT2' && ! grep -q ERROR '$OUT1'"

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
