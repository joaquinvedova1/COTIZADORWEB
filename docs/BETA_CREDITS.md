# Créditos de prueba y reporte de errores (beta con empresas testers)

PLAN-2026-029. Este documento cubre:
- el contrato de datos;
- las reglas de cobro;
- la seguridad;
- el runbook del dueño (SQL);
- el orden de corte y la vuelta atrás.

Sobre las migraciones y las pruebas:
- **Migración:** [`supabase/migrations/20261021120000_rateos_beta_credits_reports.sql`](../supabase/migrations/20261021120000_rateos_beta_credits_reports.sql).
- **No está aplicada** en el Supabase real. Se aplica sólo con autorización del dueño.
- **Pruebas (SIMULADAS):**
  - [`supabase/tests/credits_reports_test.sql`](../supabase/tests/credits_reports_test.sql);
  - [`supabase/tests/local/`](../supabase/tests/local/);
  - `tests/data/beta-credits.test.js`;
  - `tests/services/beta-service.test.js`;
  - `tests/lab/e2e/beta-lab.mjs`.

## 1. Qué decidió el dueño

| Regla | Detalle |
|---|---|
| Cuota | Cada empresa tester empieza con **10 cálculos de prueba**. El saldo es de la empresa: lo comparten sus miembros |
| No consume | Editar, recalcular, guardar o exportar un cálculo existente |
| Premio por reporte | RATEOS ADMIN revisa cada reporte a mano. Si confirma que es un error, aprueba **+2** para esa empresa |
| Prohibido | Recompensas automáticas, cambiar el saldo desde el navegador y renovación mensual |
| Sin saldo | Se bloquea **sólo crear**. Todo lo demás sigue igual. El mensaje es: «Se agotaron tus cálculos de prueba; podés seguir trabajando con los que ya tenés y enviarnos feedback» |

## 2. Qué cuesta 1 crédito

Postgres cobra al guardar el workspace (la fila JSON `workspace_states.state`) en la misma transacción. Un trigger cuenta los ids de `quotes[]` y `products[]` que la empresa **nunca** tuvo:

| Acción | Créditos |
|---|---|
| Cotización nueva (en blanco o desde plantilla) | 1 |
| Duplicar una cotización o un producto | 1 (el duplicado tiene un id nuevo) |
| Producto nuevo en blanco | 1 |
| Ejemplo "Chipá" | 0. Tiene un id fijo, así que hay uno solo a la vez |
| Editar, recalcular, guardar, escenarios, revisar, Resultado, PDF | 0 |
| Borrar | 0. No reintegra |
| Volver a tener un cálculo que la empresa ya tuvo (restaurar un respaldo propio, deshacer un borrado) | 0 |
| Importar cálculos que la empresa nunca tuvo (respaldo de otra cuenta, datos del modo local) | 1 cada uno |
| Creación rechazada o cancelada | 0. La escritura se rechaza entera |
| Demo pública | 0. No usa la nube |

- **Invariante:** los cálculos que existen a la vez son, como mucho, los créditos gastados más 1 ejemplo.
- Reescribir por completo un cálculo existente es **editar**, y está permitido. Esto incluye:
  - convertir el ejemplo "Chipá" en un producto propio;
  - volcar por la API el contenido de una plantilla (`services[]`) sobre un cálculo ya cobrado.

  Las plantillas no se cobran: no muestran resultado. Crear una cotización desde una plantilla sí cobra.
- La reserva del código COT-NNNN y la cotización van en **una sola escritura**: nunca queda una cotización sin código ni un código a medias. Si la base rechaza la creación por falta de créditos, ese código no se reusa (queda un salto en la numeración, como una factura anulada): así dos pestañas o dos personas nunca terminan con el mismo COT.

## 3. Modelo de datos (todo en `private`)

Las tablas no están expuestas por la API. Tienen RLS y **ningún** grant a `anon`, `authenticated` ni `PUBLIC`. El navegador sólo usa funciones `public.*` `security invoker`, que delegan en `private.*` `security definer` con `search_path = ''`.

| Tabla | Para qué |
|---|---|
| `beta_policy` (1 fila) | `quota_for_new_orgs` (encendida), `initial_credits` (10) y `report_reward` (2) |
| `credit_accounts` | Saldo por empresa (`balance >= 0`) y `enabled` |
| `credit_ledger` | Cada movimiento: asignación inicial, cobro, existente al activar, premio y ajuste. Tiene índices únicos: un cobro por (empresa, tipo, id), un premio por reporte y una asignación inicial por empresa |
| `bug_reports` | Categoría, qué hizo, qué esperaba, qué pasó, pantalla (clave de una lista fija), versión, estado, duplicado de, nota y revisión |
| `bug_report_events` | Historial de cada reporte: quién, cuándo, de qué estado a cuál, nota y créditos |

| Función (API) | Quién | Qué hace |
|---|---|---|
| `get_my_credits(org)` | Miembros | Saldo, asignación inicial, usados y sumados por reportes |
| `credit_preview(org, quote_ids, product_ids)` | Miembros | Cuántos cobraría un respaldo. No reserva nada |
| `submit_bug_report(org, …)` | Miembros (también VIEWER) | Envía un reporte |
| `my_bug_reports(org)` | Miembros | Reportes de la propia empresa |
| `admin_bug_reports(estado)` | RATEOS ADMIN | Cola con empresa, email de quien reportó, saldo, parecidos e historial |
| `admin_review_bug_report(id, estado, nota, duplicado_de)` | RATEOS ADMIN | "En revisión", "Validado y aprobado (+2)", "No corresponde" o "Duplicado" |
| `admin_credit_accounts()` | RATEOS ADMIN | Saldos por empresa |

Reglas de los reportes:
- **Límites:** 5 por persona y 10 por empresa en 24 h, y 20 abiertos por empresa.
- **Duplicados:** se rechaza el mismo texto de la misma empresa en 7 días.
- **Validación:** 3 a 2.000 caracteres, sin caracteres de control, y categoría y pantalla de listas fijas.
- **Aprobar:** es definitivo. Suma el premio **una sola vez**, porque el reporte queda bloqueado y el premio tiene un índice único.
- **Auto-revisión:** un admin no revisa reportes de una empresa de la que es miembro.
- **Lo que nunca entra:** las funciones de reportes y de admin no leen `workspace_states`, y un reporte no lleva costos, cotizaciones, ids, sesión ni capturas.

## 4. Empresas existentes (DOVA y cualquier otra)

**No tienen cuenta de créditos:** para ellas nada cambia, ni límite ni validación nueva.

La cuota se activa sola para las empresas que se registran **después** de aplicar la migración, mientras `beta_policy.quota_for_new_orgs` esté encendida. Para dejar a una cuenta propia sin cuota, ver §7.

**HUMAN DECISION REQUIRED (D-CR-1): el registro público.** Hoy el código tiene el registro público encendido (`js/config.js`, `publicSignup: true`; decisión del 20/10). La cuota es **por empresa**:
- cada cuenta nueva crea su propia empresa con 10 créditos;
- con varios emails (alias como `x+1@…`) alguien junta créditos;
- muchas empresas pueden llenar la cola de reportes (10 por empresa por día).

La cuota no es una barrera contra el registro abusivo. Opciones:

| Opción | Qué implica |
|---|---|
| **a) Recomendada** | Mantener el registro apagado en Auth durante la beta (D-P1-1, revisión del 21/10). Las testers entran por invitación o por la ventana de registro controlada |
| b) | Registro abierto con `initial_credits = 0` y créditos dados a mano (`admin_adjust_credits`) a cada tester aprobada |
| c) | Registro abierto tal como está, aceptando el riesgo. Sólo para un piloto chico y vigilado |

## 5. Qué ve cada persona

| Quién | Qué ve |
|---|---|
| Tester | El saldo en "Nuevo cálculo", "Nueva cotización" y "Nuevo producto". Con 0: el aviso, las opciones de crear deshabilitadas y los duplicados con el mensaje |
| Tester | "Reportar un error" en el menú de la cuenta, que lleva la pantalla donde estaba (sin ids), y "Reportes de su empresa" con el estado y la respuesta |
| Tester, si la base rechaza una creación que el navegador creía posible | El mismo mensaje. Lo rechazado queda en una copia de recuperación y lo demás se guarda |
| Tester, al restaurar un respaldo | Antes, cuántos cálculos nuevos usaría. Si no alcanzan, no se puede restaurar sin hablar con el equipo |
| RATEOS ADMIN, en `#/admin` | "Reportes de errores" con filtros, la aprobación con confirmación y el historial, y "Cálculos de prueba por empresa" |

## 6. Orden de corte (cuando el dueño lo autorice)

1. **Backup** de la base (C0 de BETA-RC1).
2. **Deploy del frontend** que trae estos cambios (con el merge autorizado). El frontend funciona aunque la base no tenga la migración: los gateways ven "función inexistente" y apagan créditos y reportes.
3. **Migración**, con el plugin o el SQL Editor como `postgres`: `20261021120000_rateos_beta_credits_reports.sql`.
4. **Tests SQL en vivo.** Todos se deshacen solos:

   | Test | Resultado esperado |
   |---|---|
   | `rls_test.sql` | 40 |
   | `rls_admin_test.sql` | 32 |
   | `beta_security_test.sql` | 132 |
   | `credits_reports_test.sql` | `CREDITS_TESTS_PASSED: 102 controles` |

   Después, un control de 0 filas sintéticas.
5. **Recién entonces, las cuentas testers** (Dashboard o la ventana de registro controlada).

**El orden importa.** Un frontend viejo (0.9.0 o anterior) contra la base nueva no entiende el rechazo por créditos: reintenta y deja de guardar. Se probó en `bc31190`: se traba, reintenta y consume un código. Por eso:
- el frontend nuevo va primero;
- las empresas que ya existían no tienen cuota, así que un frontend viejo abierto en DOVA sigue funcionando igual.

## 7. Runbook del dueño (SQL Editor, como postgres)

```sql
-- Política (encendida al migrar): ¿las empresas nuevas nacen con cuota?
select * from private.beta_policy;
update private.beta_policy set quota_for_new_orgs = false where id;   -- apagar
update private.beta_policy set initial_credits = 10, report_reward = 2 where id;

-- Saldos y movimientos de una empresa (por nombre)
select o.name, a.balance, a.enabled from private.credit_accounts a join public.organizations o on o.id = a.organization_id order by o.name;
select l.created_at, l.reason, l.delta, l.entity_kind, l.note from private.credit_ledger l
  join public.organizations o on o.id = l.organization_id where o.name = 'Empresa X' order by l.created_at;

-- Ajuste manual (por ejemplo, restaurar a una tester el respaldo de otra cuenta). Queda en el ledger con la nota.
select private.admin_adjust_credits('<org uuid>', 5, 'Restaurar respaldo de la cuenta anterior');

-- Quitar el límite a una empresa (por ejemplo, una cuenta propia creada con la política encendida)
update private.credit_accounts set enabled = false where organization_id = '<org uuid>';

-- Activar la cuota en una empresa existente: lo que ya tiene no se cobra nunca
select private.enable_credit_quota('<org uuid>', 10, 'Activación manual');

-- Exportar antes de una vuelta atrás
select * from private.credit_ledger order by created_at;
select * from private.bug_reports order by created_at;
select * from private.bug_report_events order by created_at;
```

`admin_adjust_credits` y `enable_credit_quota` **no** se pueden llamar desde la API: no tienen grants.

## 8. Vuelta atrás

| Qué | Cómo |
|---|---|
| Frontend | Revertir el PR |
| Base | [`supabase/rollback/20261021120000_rateos_beta_credits_reports_down.sql`](../supabase/rollback/20261021120000_rateos_beta_credits_reports_down.sql) |

Qué hace la vuelta atrás de la base:
- Quita triggers, funciones y tablas nuevas.
- **No toca** `workspace_states` ni las tablas anteriores. Probado: el hash del estado y la revisión quedan iguales.
- Se pierden el ledger y los reportes: antes, exportarlos (§7).
- Si la migración se aplicó con la CLI o el plugin, hay que borrar además su fila en `supabase_migrations.schema_migrations`.

## 9. Amenazas cubiertas y cómo se prueban

| Amenaza | Defensa | Prueba |
|---|---|---|
| Cambiar el saldo (DevTools, API) | Tablas en `private` sin grants | SQL "manipulación directa", E2E "api", gate SEC-19 |
| Escribir el JSON completo con cálculos nuevos | Trigger sobre cada escritura de `state` | SQL "saldo en 0", mutación M1 |
| Esconder cálculos (ids repetidos o ausentes) | Rechazo `rateos_invalid_calculations` | SQL "estructura" (7 formas) |
| Doble débito (reintento, dos pestañas, dos usuarios, concurrencia) | Índice único, cuenta y fila bloqueadas | SQL, concurrencia C1–C3, E2E "pestañas" |
| Doble premio | Índice único por reporte, bloqueo y "aprobado" definitivo | SQL, concurrencia C4, E2E "admin", mutación M2 |
| Auto-aprobación / admin falso | `private.platform_admins` y revisión prohibida a miembros | SQL, mutaciones M4 y M5 |
| Fuga entre empresas | Membresía con `auth.uid()` | SQL A↔B, E2E "api" |
| Pérdida de datos al quedarse sin saldo | Copia de recuperación y lo demás se sube | `tests/data/beta-credits.test.js`, E2E "carrera" |
| Spam en reportes | Límites, longitudes, listas fijas y duplicados | SQL, concurrencia C6 |
| Empresas existentes afectadas | Sin cuenta, sin cambios | SQL "empresa existente", migración sobre datos previos |
