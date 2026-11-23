# Backups y recuperación (beta pública)

## Qué hay hoy

| Capa | Qué guarda | Quién lo usa |
| --- | --- | --- |
| Historial en la base (`private.workspace_state_history`, migración `20261124120100`) | Una foto del workspace de cada empresa como mucho cada 30 minutos mientras trabaja; hasta 100 fotos y 25 MB por empresa, ninguna de más de 30 días. Lo de los últimos 30 minutos puede no estar | El dueño, desde el SQL Editor de Supabase |
| Copia local del navegador (`rateos.cloud.*`) | Los cambios sin subir de esa computadora | La app, sola, al volver a entrar |
| Backup JSON (Configuración → Datos y backup → exportar) | Todo el workspace de la empresa, descargado por el usuario | El usuario, cuando quiera |
| Backups de Supabase | **Plan gratuito: no hay backups diarios descargables.** Con plan Pro: diarios, 7 días | El dueño, desde Database → Backups |

Recomendación para la beta con empresas reales: plan Pro de Supabase (backups diarios y el proyecto no se pausa por inactividad). El historial de la base cubre el caso más probable (un guardado equivocado pisa el trabajo de una empresa), pero no un desastre del proyecto entero.

## Restaurar el trabajo de una empresa

Cuando una empresa avisa "se me borró / se me pisó lo que tenía":

1. Pedile que cierre RATEOS en todas sus pestañas (si no, su navegador puede volver a pisar la restauración).
2. SQL Editor de Supabase. Buscá la empresa por el email del usuario:
   ```sql
   select o.id as organization_id, o.name
   from auth.users u
   join public.organization_members m on m.user_id = u.id
   join public.organizations o on o.id = m.organization_id
   where u.email = 'usuario@empresa.com';
   ```
3. Mirá las fotos disponibles (sin abrir el contenido):
   ```sql
   select revision, saved_at, archived_at, pg_column_size(state) as bytes,
          jsonb_array_length(coalesce(state -> 'quotes', '[]'::jsonb)) as cotizaciones
   from private.workspace_state_history
   where organization_id = '<organization_id>'
   order by revision desc;
   ```
4. Restaurá la que corresponda (queda como una revisión nueva, y la versión actual se guarda antes en el historial: si te equivocaste de foto, restaurá la que acaba de guardarse):
   ```sql
   select private.restore_workspace_revision('<organization_id>', <revision>);
   ```
5. Avisale que vuelva a entrar. Anotá qué pasó en el reporte (panel #/admin → Reportes).

Regla: ningún otro cambio manual sobre datos de clientes en producción. Restaurar es la única excepción, y sólo a pedido de la empresa.

## Probado

Las migraciones se aplicaron sobre una base Postgres 16 local con las 4 migraciones de producción: 35 guardados seguidos, el límite de fotos, la restauración (revisión nueva, la app la toma al abrir), y que ni `anon` ni `authenticated` pueden leer el historial ni llamar a la restauración.
