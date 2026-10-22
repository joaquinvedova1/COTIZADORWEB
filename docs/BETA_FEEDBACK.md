# RATEOS — Beta gratuita y feedback (PLAN-2026-029)

**Decisión del dueño (22/10/2026).** Reemplaza el esquema de créditos del 21/10, que nunca se aplicó.

- La beta es **gratuita y sin límites**:
  - cotizaciones, productos y duplicados ilimitados;
  - sin saldos, cupos, contadores, premios ni bloqueos por volumen.
- Las empresas cuentan qué no funcionó o qué mejorarían. **RATEOS ADMIN** lo clasifica y responde.
- La empresa ve el estado y la respuesta.

**Estado:**
- Migración `supabase/migrations/20261022120000_rateos_beta_feedback.sql`: **no aplicada**. Se aplica sólo con autorización del dueño (§5).
- Vuelta atrás: [`supabase/rollback/20261022120000_rateos_beta_feedback_down.sql`](../supabase/rollback/20261022120000_rateos_beta_feedback_down.sql).
- Tests:
  - [`supabase/tests/feedback_test.sql`](../supabase/tests/feedback_test.sql) (`FEEDBACK_TESTS_PASSED: 64 controles`);
  - [`supabase/tests/local/feedback_concurrency.sh`](../supabase/tests/local/feedback_concurrency.sh) (4 casos, sólo en el Postgres local).

## 1. Qué ve cada persona

| Quién | Qué ve |
|---|---|
| Cualquier persona con cuenta | El distintivo discreto **"Beta gratuita"** en el menú, que lleva a "Acerca de la beta" |
| Cualquier persona con cuenta | En el menú de la cuenta: **"Reportar un problema"** y **"Sugerir una mejora"**. Llevan a `#/mejorar` con el tipo y la pantalla donde estaba (una clave de lista fija, sin ids) |
| Cualquier persona con cuenta | Después de **imprimir o guardar el PDF** de una cotización (con "Imprimir" de la cabecera o "Imprimir / guardar PDF" del Resultado), una invitación discreta, no modal, para dejar un comentario |
| La empresa (todos sus miembros) | "Comentarios de tu empresa": estado, fecha, quién (propio o "de otra persona de tu empresa") y la **respuesta de RATEOS** |
| RATEOS ADMIN, en `#/admin` | "Feedback de la beta": cola con filtros por estado y por tipo, clasificación, respuesta, duplicados e historial (quién y cuándo) |
| Demo y modo local | La pantalla explica que los comentarios se envían desde una cuenta |

**La invitación después de exportar:**
- Aparece **a lo sumo una vez cada 14 días** por navegador.
- "Ahora no" la esconde 60 días.
- Si el navegador no deja guardar esa preferencia, no aparece.

## 2. El formulario: breve, por tipo

Sigue a NN/g y a gov.uk: pedir feedback sin interrumpir una tarea y al terminarla, breve, y reconocer el aporte sin incentivos.

| Tipo | Obligatorio | Opcional (plegado en "Agregar detalles") |
|---|---|---|
| **Encontré un problema** | ¿Qué pasó? | ¿Qué estabas haciendo?, ¿Qué esperabas que pasara?, pantalla y categoría |
| **Tengo una sugerencia** | ¿Qué te gustaría mejorar o agregar? | ¿Para qué te serviría?, pantalla y categoría |

**Errores:** el campo vacío o demasiado largo se marca junto al campo (`aria-invalid`), con el foco en él. Los errores del servidor (límites, sin conexión) se muestran en un aviso debajo de "Enviar" y lo escrito no se pierde.

**Qué se envía:**
- **Sólo** lo que escribe la persona, el tipo, la categoría y la pantalla (de listas fijas) y la versión de la app.
- **Nunca** costos, cotizaciones, ids, sesión, tokens, adjuntos ni capturas.
- La pantalla lo dice: «No incluyas datos de clientes, costos, precios ni contratos».

**Microcopy:**
- **Título:** «Ayudanos a mejorar RATEOS».
- **Pedido:** «Estamos construyendo RATEOS junto a empresas que cotizan todos los días. Si algo no funcionó o se podría entender mejor, contanos. Revisamos cada comentario y nos ayuda a priorizar mejoras».
- **Confirmación:** «Gracias por ayudarnos a mejorar RATEOS. Recibimos tu comentario y vas a poder seguir su estado acá abajo».
- **"Acerca de la beta":**
  - «Durante la beta, RATEOS es gratuito y sin límites de cotizaciones ni productos».
  - «Gracias por ser de las primeras empresas en usarlo: tus comentarios nos ayudan a decidir qué mejorar primero. No hace falta ser experto; si algo no se entiende, también nos sirve saberlo».
  - «Enviar un comentario no da premios ni beneficios».

  Hay reconocimiento y pertenencia, sin promesas y sin incentivos a comentarios inventados.

## 3. Estados

Ningún estado suma ni descuenta nada. "Recibido" es sólo el inicial.

| Estado | Problema | Sugerencia | Cuándo |
|---|---|---|---|
| `received` | Recibido | Recibida | Al enviarlo |
| `in_review` | En revisión | En revisión | Lo estamos mirando |
| `confirmed` | Confirmado | La tenemos en cuenta | Problema: es un error real de RATEOS |
| `resolved` | Resuelto | Ya está disponible | Sólo cuando la corrección está publicada y validada |
| `not_applicable` | No corresponde | No corresponde | No es un error de RATEOS, o no lo vamos a hacer |
| `duplicate` | Duplicado | Duplicada | Con el original (`duplicate_of`) |

Cada cambio queda en `private.feedback_events` con quién, cuándo, de qué estado a cuál y la respuesta. Repetir el mismo estado sin respuesta nueva no deja otro evento.

## 4. Seguridad (autoridad 100 % en Postgres)

**Las tablas:**
- `private.feedback` y `private.feedback_events` viven en `private`, que no está expuesto por la API.
- Tienen RLS y **ningún grant** a `anon`, `authenticated` ni `PUBLIC`.

**Las funciones:**
- El navegador sólo llama 4 funciones `public.*` `security invoker`.
- Esas delegan en funciones `private.*` `security definer` con `search_path = ''`, que verifican `auth.uid()` y la membresía.
- Es el mismo patrón que RATEOS ADMIN.

| Función | Quién | Qué hace |
|---|---|---|
| `submit_feedback(org, kind, category, message, details, expected, screen, app_version)` | Miembros de esa empresa | Valida, limpia el texto (sin controles, invisibles ni marcas de dirección) y aplica los límites |
| `my_feedback(org)` | Miembros de esa empresa | Los de su empresa (nunca de otra), con estado y respuesta, sin quién revisó |
| `admin_feedback(status, kind)` | `private.platform_admins` | Cola con empresa, email de quien lo envió, texto, parecidos e historial. **Nunca lee `workspace_states`** |
| `admin_review_feedback(id, status, response, duplicate_of)` | `private.platform_admins` | Cambia el estado y deja la respuesta. Bloquea la fila mientras escribe |

**Límites técnicos contra el spam (no son cuotas de negocio):**
- 5 por persona y 10 por empresa cada 24 h.
- 20 sin revisar por empresa.
- El mismo texto, del mismo tipo, se rechaza durante 7 días.
- Un advisory lock por empresa evita carreras entre envíos simultáneos.

**La migración no cambia el guardado ni las empresas:**
- No tiene triggers.
- No lee `workspace_states`.
- No tiene tablas de créditos.

Lo verifican el test SQL y el control SEC-19 del Beta Security Gate.

## 5. Orden de corte (cuando el dueño lo autorice)

1. **Backup** de la base.
2. **Deploy del frontend.** Funciona sin la migración: si `submit_feedback` no existe, la pantalla dice que todavía no se pueden enviar comentarios. El resto de la app no cambia.
3. **Migración** `20261022120000_rateos_beta_feedback.sql`, con el plugin o el SQL Editor como `postgres`.
4. **Tests SQL en vivo.** Todos se deshacen solos:

   | Test | Esperado |
   |---|---|
   | `rls_test.sql` | 40 |
   | `rls_admin_test.sql` | 32 |
   | `beta_security_test.sql` | 132 |
   | `feedback_test.sql` | 64 |

   Después, un conteo de 0 filas sintéticas.
5. **Prueba real:** un problema y una sugerencia desde una cuenta de prueba, la respuesta desde RATEOS ADMIN y que otra empresa no los vea.

El orden entre el frontend y la migración **no** es crítico: ninguno de los dos depende del otro para guardar.

## 6. Runbook del dueño (SQL Editor, como postgres)

```sql
-- Feedback abierto, el más viejo primero
select f.created_at, o.name as empresa, f.kind, f.category, f.screen, f.status, left(f.message, 120) as mensaje
  from private.feedback f join public.organizations o on o.id = f.organization_id
 where f.status in ('received', 'in_review', 'confirmed')
 order by f.created_at;

-- Exportar antes de una vuelta atrás
select * from private.feedback order by created_at;
select * from private.feedback_events order by created_at;
```

Clasificar y responder se hace desde `#/admin` (queda en el historial), no con SQL a mano.

## 7. Vuelta atrás

| Qué | Cómo |
|---|---|
| Frontend | Revertir el PR. El frontend anterior no usa el feedback: si la migración quedó aplicada, no pasa nada |
| Base | Exportar (§6) y correr el `down.sql`. No toca `workspace_states` ni ninguna tabla anterior. Se pierden los comentarios y su historial |

## 8. Lo que no hace (a propósito)

- No hay premios, créditos, cupos ni contadores, ni para reportes "confirmados".
- No usa terceros, IA ni correos: la respuesta se ve dentro de RATEOS.
- No hay adjuntos ni capturas: podrían llevar datos económicos de la empresa.
