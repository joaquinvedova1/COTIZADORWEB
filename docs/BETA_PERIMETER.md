# RATEOS — Perímetro de la beta cerrada (Beta Perimeter v1)

Plan: [PLAN-2026-016](../.agent/PLANS.md). Base: `main` `998b932` (v0.8.1, esquema 10). Fecha: 2026-10-18.

Objetivo: cerrar los tres requisitos obligatorios antes de habilitar usuarios reales que dejó [BETA_SECURITY.md §6](BETA_SECURITY.md#6-decisiones-del-dueño-human-decision-required) (HD-01, HD-02, HD-03) para una beta cerrada con 3–5 empresas.

> **Todavía no hay beta.** Este trabajo prepara el perímetro; habilitar usuarios reales sigue bloqueado hasta que los tres requisitos estén cumplidos **en producción** (ver §5). No cambia fórmulas, motores ni el esquema de datos (10), y no hay migraciones de base.

| Requisito | Qué hace este cambio | Qué falta (dueño) |
|---|---|---|
| **HD-02** Staging separado o `/preview/` deshabilitado | El deploy publica **sólo producción**; el artefacto nunca trae `preview/`; después de publicar se verifica `/preview/` → 404 (SEC-17). | Autorizar el merge y el deploy. |
| **HD-03** Registro cerrado o por invitación | La app no ofrece ni llama al registro (`FEATURES.publicSignup = false`); `#/registro` explica el acceso por invitación. | Apagar **"Allow new users to sign up"** en Supabase Auth y configurar un **SMTP propio** (sin él, las personas invitadas no reciben el correo para elegir su contraseña). |
| **HD-01** Dominio propio | La app soporta un segundo origen (enlaces de email por origen) y una mudanza desde github.io, apagada hasta verificar. | Darme el dominio; DNS, Pages, HTTPS y URLs de Supabase. |

## 1. Staging (HD-02)

**Antes (hasta v0.8.1):** el workflow publicaba la rama de desarrollo en `https://joaquinvedova1.github.io/COTIZADORWEB/preview/`, **dentro del mismo sitio**. Mismo origen (mismo `localStorage`, incluida la sesión de Supabase de quien entrara a producción) y la misma base de Supabase: el código de cualquier rama con CI verde corría junto a las sesiones y los datos reales.

**Ahora** (`.github/workflows/deploy-pages.yml`):

- sólo `push` a `main` y el rollback manual (`ref`); sin `workflow_run`, sin job de preview y sin `scripts/stage-preview.mjs` (borrado);
- el build **falla** si `dist/preview` existe;
- GitHub Pages sirve **un artefacto por deploy** y reemplaza el sitio entero: el primer deploy de producción con este cambio **borra también los archivos del preview viejo** (no basta con apagar el workflow: hace falta ese deploy);
- después de publicar, el job `deploy` verifica que `version.json` tenga el commit desplegado y que `/preview/` y `/preview/version.json` respondan **404** (reintenta ~4 minutos, sin caché; si no, el deploy queda en rojo);
- la app no tiene service worker y Pages cachea 10 minutos: después de ese margen ningún navegador puede seguir sirviendo el preview viejo;
- control **SEC-17** del Beta Security Gate y tests en `tests/static-site.test.js`. Contra `main` (v0.8.1) SEC-17 falla con 5 hallazgos.

**Ojo al pushear ramas antes del merge:** mientras `main` tenga el workflow viejo, cada push de una rama con CI verde **vuelve a publicar `/preview/`** con esa rama (el workflow se lee siempre de `main`). Este PR se pushea sólo con autorización.

**Verificación manual después del deploy:** abrir `https://joaquinvedova1.github.io/COTIZADORWEB/preview/` → página 404 de GitHub; producción sigue en `https://joaquinvedova1.github.io/COTIZADORWEB/` (Configuración → Acerca de: versión y build nuevos).

### Reactivar un staging más adelante (sólo aislado)

Un staging tiene que estar aislado en **origen** y en **base**:

1. **Otro origen:** un sitio propio que no sea una carpeta de producción. Por ejemplo, un repositorio aparte con su propio Pages y un subdominio propio (`staging.<tu-dominio>`), o un hosting estático separado. Nunca `…/COTIZADORWEB/<algo>/` ni ningún otro sitio del mismo origen que producción.
2. **Otra base:** un proyecto de Supabase aparte (o un *branch* de Supabase), con su propia URL y publishable key en la configuración de **ese** build, sus migraciones aplicadas igual que producción y los tests SQL corridos ahí.
3. **Sólo datos sintéticos** y sus propias cuentas; registro cerrado también ahí.
4. **Un workflow propio** que publique en ese sitio con permisos sólo sobre él; el workflow de producción no se toca.
5. La app ya distingue un build de staging (`version.json` con `"channel": "staging"`): pregunta antes de actualizar el formato de datos.
6. Volver a armar `/preview/` dentro de producción está **prohibido** (HD-02, AGENTS.md §16). El script viejo queda en el historial de git (`998b932`) por si sirve su franja "STAGING", nunca su ubicación.

## 2. Registro por invitación (HD-03)

### Configuración actual (relevada en sólo lectura, 2026-10-18)

- 2 usuarios, ambos con email confirmado; identidades sólo `email`; 0 invitados, 0 anónimos, 0 SSO, 0 MFA, 0 teléfonos.
- La confirmación de email está activa (AUTH_ARCHITECTURE.md §3). El registro está abierto: la app lo ofrecía en 5 lugares.
- El trigger `private.handle_new_user` crea perfil, organización ("Mi empresa" si no llega `company`), membresía OWNER y workspace vacío para **cualquier** usuario nuevo, también los creados desde el Dashboard.
- No pude leer la configuración pública de Auth (`/auth/v1/settings`) desde el entorno de desarrollo: la red de este entorno no llega al host de Supabase. Lo comprueba `node scripts/check-auth-perimeter.mjs` (abajo).
- **Correo:** el repo no registra ningún SMTP propio (README y AUTH_ARCHITECTURE.md §9.1 lo dejan pendiente) y esa configuración no es pública, así que no la pude verificar. Con el **SMTP por defecto**, Supabase **sólo envía correos a los miembros del equipo del proyecto** (Organization → Team): a cualquier otra dirección responde *Email address not authorized*. Además tiene un límite bajo por hora y no tiene garantía de entrega.

### Método propuesto (el más simple que preserva login, recuperación y usuarios existentes)

**Apagar el registro en Supabase Auth y dar de alta a mano desde el Dashboard.** Nada de código del lado del servidor ni migraciones:

- Con el registro apagado, Supabase sólo crea usuarios desde el Dashboard o por invitación (comportamiento documentado de Supabase Auth: un registro devuelve `signup_disabled`).
- **El ingreso con email y contraseña no cambia** (el proveedor Email sigue activo) y **la recuperación de contraseña tampoco**: no dependen del registro. Los usuarios existentes siguen igual.
- La app ya no ofrece "Crear cuenta": las llamadas a la acción llevan a **Ingresar**, `#/registro` explica la beta por invitación y el primer ingreso, y `signUp` no llama a Supabase. Si alguien llama a la API igual, Supabase la rechaza.
- **Requisito: SMTP propio.** El primer ingreso (elegir la contraseña) y "Cambiar contraseña" usan el correo de recuperación: con el SMTP por defecto, las personas invitadas **nunca lo reciben**. Qué hace la app con ese error (`email_address_not_authorized`):
  - fuera de sesión ("¿Olvidaste tu contraseña?") la respuesta sigue siendo **neutra** a propósito, para no revelar si un email tiene cuenta (ese error sólo aparece cuando la cuenta existe), y queda un aviso técnico en la consola, sin el email;
  - con la sesión iniciada ("Cambiar contraseña", el propio email) no hay nada que revelar: la app dice que el correo no se pudo enviar (también si un SMTP propio falla).

Alternativas descartadas por ahora: el *hook* "Before User Created" (lista de emails permitidos) agrega una función y configuración de Auth que todavía no hacen falta para 3–5 empresas; las invitaciones dentro de la app requieren Edge Functions (AGENTS.md §19: todavía no).

### Pasos del dueño (configuración de Auth: no la toqué)

1. Supabase Dashboard → **Authentication → Sign In / Providers** → sección *User Signups* → apagar **"Allow new users to sign up"** → Save.
   - **No** apagar el proveedor **Email**: eso corta el ingreso y la recuperación de todos.
   - **No** desactivar "Confirm email".
2. Verificar (desde una máquina con acceso a Supabase):
   ```bash
   node scripts/check-auth-perimeter.mjs
   ```
   Tiene que terminar en `PERÍMETRO DE AUTH: OK (beta por invitación)`: `disable_signup = true`, `external.email = true`, `mailer_autoconfirm = false` y ningún otro método de ingreso. Lee sólo la configuración pública (la misma que ve cualquier navegador) y no imprime datos de usuarios.
   El script no puede ver el SMTP (no es público): lo lista como verificación **A MANO**.
3. **SMTP propio** (antes de la primera alta): **Authentication → Emails → SMTP Settings** → activar *custom SMTP*.
   - Datos de tu proveedor de correo transaccional (Supabase menciona Resend, AWS SES, Postmark, Twilio SendGrid, ZeptoMail y Brevo; sirve cualquiera con SMTP): host, puerto, usuario y contraseña; remitente (por ejemplo `no-reply@<tu-dominio>`) y nombre (`RATEOS`).
   - En el proveedor: **SPF, DKIM y DMARC** del dominio remitente, y **sin seguimiento de enlaces** (*link tracking*): reescribe los enlaces de Auth y los rompe.
   - Al guardar, Supabase limita los correos de Auth a **30 por hora** (se ajusta en Authentication → Rate Limits): alcanza para 3–5 empresas.
   - La contraseña del SMTP queda sólo en Supabase: nunca en el repo ni en la app (no hace falta pasármela).
   - Probar: **¿Olvidaste tu contraseña?** con un email tuyo que **no** sea del equipo de Supabase → el correo llega y el enlace abre "Elegí una contraseña nueva".
4. Dar de alta a cada persona de la beta: **Authentication → Users → Add user → Create new user**: su email, una contraseña larga al azar que **no** compartís, **Auto Confirm User** tildado.
   - Avisale: "Entrá a RATEOS → Ingresar → **¿Olvidaste tu contraseña?** → tu email → abrí el enlace **en el mismo navegador** → elegí tu contraseña".
   - Su empresa se crea como **"Mi empresa"**: la persona la renombra en **Configuración → Empresa**.
   - Si el enlace dice "venció o ya se usó" apenas llega, puede haberlo abierto antes un **escáner de correo corporativo** (los enlaces de Auth son de un solo uso): pedir otro (§6).
5. **No usar "Send invitation"**: ese enlace no es PKCE y la app lo rechaza a propósito (AUTH_ARCHITECTURE.md §4). Si alguien lo recibe, igual puede entrar con "¿Olvidaste tu contraseña?".
6. Quitar a alguien: borrar el usuario en Authentication → Users. Su organización y su workspace quedan sin miembros (nadie los ve); borrarlos es un paso aparte de la base (SQL, con autorización).

## 3. Dominio propio (HD-01)

**Por qué:** `joaquinvedova1.github.io` es un origen compartido por todos los sitios de Pages de la cuenta: comparten `localStorage`, incluida la sesión de Supabase de RATEOS. Con un dominio propio RATEOS tiene su propio origen.

### Qué dato necesito

- El **nombre exacto** del dominio o subdominio: recomiendo un subdominio dedicado, por ejemplo `app.<tu-dominio>` o `rateos.<tu-dominio>`. No invento ni compro ninguno.
- Quién administra el **DNS** de ese dominio (tu proveedor) y que ese subdominio no lo use otra cosa.

### Cambios necesarios, en este orden (producción sigue en github.io hasta el paso 6)

1. **Verificar el dominio en GitHub** (protege contra que otro lo tome): tu cuenta → Settings → Pages → *Verified domains* → Add a domain. GitHub muestra un registro **TXT** (`_github-pages-challenge-joaquinvedova1.<dominio>`): crearlo en tu DNS, esperar que propague (`dig TXT …`) y tocar *Verify*. El registro queda.
2. **DNS del sitio:**
   - Subdominio (recomendado): un **CNAME** `app` → `joaquinvedova1.github.io`.
   - Dominio raíz: registros **A** `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (y los AAAA que indique la documentación de GitHub Pages).
   - Sin comodines (`*`) ni registros extra en ese nombre: pueden impedir el certificado.
3. **App (PR, con tu autorización):** en `js/config.js`, poner el dominio **primero** en `PUBLIC_SITE_URLS` y dejar github.io detrás. Cada sitio usa sus propios enlaces de email: el enlace PKCE vuelve al origen donde se pidió. No hace falta tocar la CSP. Tests + gate + merge.
4. **Supabase → Authentication → URL Configuration** (cambio de Auth: con tu autorización): agregar `https://<dominio>/**` a *Redirect URLs* sin sacar las de github.io.
5. **Antes de cambiar el sitio** (cada persona que use RATEOS): que todo diga "Guardado en la nube", exportar un backup (Configuración → Datos y backup) y **cerrar sesión** en github.io. Los datos del navegador de un origen (copias sin subir, sesión) no pasan al otro.
6. **GitHub → repo → Settings → Pages → Custom domain** = `<dominio>` → Save. Esperar el chequeo de DNS y el certificado (puede tardar hasta una hora; "Enforce HTTPS" puede tardar más en habilitarse) → tildar **Enforce HTTPS**.
7. **Verificar** (con 2 cuentas sintéticas, §4):
   - `https://<dominio>/` carga y Acerca de muestra el build;
   - ingreso, recuperación (el enlace vuelve al dominio) y cierre de sesión;
   - `http://<dominio>` redirige a `https`;
   - `https://<dominio>/preview/` → 404;
   - qué pasa con `https://joaquinvedova1.github.io/COTIZADORWEB/`. GitHub suele redirigirlo al dominio, pero no encontré documentación oficial que lo confirme para un sitio de proyecto: **verificarlo**.
8. **Cerrar github.io:** si github.io no redirige solo, poner `MOVED_TO_SITE_URL = 'https://<dominio>/'` en `js/config.js` (PR). La app abierta en github.io se va al dominio **antes** de iniciar sesión o leer datos (la query, como un `?code=` viejo, no viaja). Después: *Site URL* de Supabase = `https://<dominio>/` y, más adelante, sacar las Redirect URLs de github.io.

**Rollback:** sacar el *Custom domain* en Pages vuelve a servir github.io; los datos están en Supabase. La gente vuelve a ingresar.

**HD-01 queda cumplido** cuando RATEOS se usa sólo en el dominio propio con HTTPS forzado, los enlaces de email vuelven al dominio y github.io no abre cuentas.

## 4. Prueba A/B real contra Supabase

Complementa a los tests SQL (que simulan la API dentro de una transacción que se deshace): acá hay **dos usuarios autenticados de verdad** (Supabase Auth), **dos organizaciones** distintas y la **app compilada en un navegador real**.

- `tests/live/perimeter-ab.mjs` (nunca en CI ni en `npm test`; se niega con cuentas que no terminen en `@rateos.invalid`).
- `supabase/tests/live_ab.sql`, en cuatro bloques: 1 alta · 2 identificar · 3 verificar · 4 limpieza.

Qué verifica:

| Área | Controles |
|---|---|
| Navegador | A ingresa y la app **guarda** su workspace (revisión > 0); al cerrar sesión no queda nada de A (pantalla, DOM, sesión); B ingresa en la **misma pestaña** y no ve nada de A; la app guarda el workspace de B; B cierra sesión; sin errores ni pedidos fuera del sitio y de Supabase. |
| API (JWT reales, A→B y B→A con IDs conocidos) | Sin filtro cada uno ve sólo su workspace; no lee, no modifica, no crea ni borra el de la otra empresa (por organización y por id); no lee organización, membresías ni perfil ajenos; no usa RPC de admin; guarda el suyo con la revisión vigente y una revisión vieja no pisa nada; anon no lee. |
| Logout | Supabase cierra la sesión y el refresh token deja de servir. |

**Estado: preparada, no ejecutada.** La red de este entorno de desarrollo no llega a `dltlnizvnvnefgbzfftu.supabase.co`. Para correrla:

1. Cuentas sintéticas, una de dos formas:
   - bloque 1 de `live_ab.sql` (reemplazando las dos contraseñas);
   - el Dashboard: Add user → Create new user con `perimetro-a@rateos.invalid` y `perimetro-b@rateos.invalid`, Auto Confirm (si el Dashboard no acepta el dominio `.invalid`, usar el bloque 1). No hace falta correo: las contraseñas se fijan al crearlas.
2. Correr la prueba:
   ```bash
   npm run build
   RATEOS_LIVE_A_EMAIL=perimetro-a@rateos.invalid RATEOS_LIVE_A_PASSWORD='…' \
   RATEOS_LIVE_B_EMAIL=perimetro-b@rateos.invalid RATEOS_LIVE_B_PASSWORD='…' \
   PLAYWRIGHT_MODULE=<ruta>/node_modules/playwright node tests/live/perimeter-ab.mjs
   ```
   Reporte en `reports/live/` sin emails, contraseñas, tokens ni ids.
3. Bloque 3 (verificar, sólo lectura) y bloque 2 (identificar lo sintético).
4. **Limpieza (bloque 4), sólo con autorización del dueño.** Borra únicamente esas 2 organizaciones (con sus workspaces y membresías) y esos 2 usuarios (con sus perfiles, identidades y sesiones). Se niega si encuentra cualquier otra cosa. El orden importa: borrar un usuario no borra su organización.

Si el dueño agrega `dltlnizvnvnefgbzfftu.supabase.co` a los dominios permitidos del entorno, la corro yo con este mismo procedimiento.

## 5. Checklist del dueño

**Antes de habilitar a la primera empresa externa:**

- [ ] **Autorizar** el push y el PR de esta rama. Al pushear, `main` todavía publica `/preview/` una última vez con esta rama.
- [ ] **Autorizar** el merge y el deploy; confirmar en Actions que "Verificar el sitio publicado" quedó en verde (`/preview/` → 404). **HD-02 cumplido.**
- [ ] Supabase → Authentication → Sign In / Providers → apagar **"Allow new users to sign up"** (no el proveedor Email).
- [ ] Correr `node scripts/check-auth-perimeter.mjs` → OK. **HD-03 cumplido.**
- [ ] Authentication → Emails → SMTP Settings: **SMTP propio** (SPF/DKIM/DMARC, sin seguimiento de enlaces) y probar "¿Olvidaste tu contraseña?" con un email que no sea del equipo de Supabase (§2 paso 3). Sin esto nadie de afuera puede elegir su contraseña.
- [ ] Darme el **dominio o subdominio** para RATEOS y el proveedor de DNS.
- [ ] Verificar el dominio en GitHub (TXT) y crear el CNAME (o los A/AAAA).
- [ ] Autorizar el PR de `PUBLIC_SITE_URLS` y el alta de `https://<dominio>/**` en las Redirect URLs de Supabase.
- [ ] Cada persona: sincronizar, exportar backup y cerrar sesión en github.io.
- [ ] Pages → Custom domain → certificado → **Enforce HTTPS**.
- [ ] Verificar el dominio (§3 paso 7) y, si github.io no redirige solo, autorizar `MOVED_TO_SITE_URL`. Cambiar la Site URL de Supabase. **HD-01 cumplido.**
- [ ] Prueba A/B real (§4) en verde sobre el dominio nuevo, y limpieza de lo sintético autorizada.
- [ ] Crear el tag `v0.8.0` sobre `0c213a3` (pendiente desde v0.8.1).
- [ ] Recién entonces: alta manual de las 3–5 empresas (§2 paso 4).

## 6. Riesgos que siguen

- **Hasta el deploy**, `/preview/` sigue publicado (y cada push de rama lo vuelve a publicar): HD-02 se cumple recién con el deploy de este cambio.
- **Hasta apagar el registro en Supabase**, cualquiera puede crear una cuenta llamando a la API: la app sólo dejó de ofrecerlo. No expone datos de otras empresas (cada cuenta nace con su propia empresa y RLS lo garantiza).
- **Hasta configurar un SMTP propio**, sólo reciben correos de RATEOS los miembros del equipo de Supabase: una persona invitada no puede elegir su contraseña y, fuera de sesión, la app no lo dice (respuesta neutra a propósito). Lo detecta la prueba del §2 paso 3.
- **Escáneres de correo corporativos:** algunos abren los enlaces antes que la persona y, como los enlaces de Auth son de un solo uso, al hacer clic aparece "El enlace venció o ya se usó". Primero, pedir otro enlace; si se repite con una empresa, la mitigación que documenta Supabase es cambiar la plantilla del correo por un enlace a una página propia con un botón (cambio de Auth y de la app: con autorización).
- **Sesiones viejas en el origen compartido:** las sesiones abiertas en github.io quedan en el `localStorage` de ese origen. Mitigación: cerrar sesión antes del cambio de dominio (§3 paso 5).
- **JWT vigente después del logout:** un access token ya emitido sigue siendo válido hasta su vencimiento (Supabase: 1 hora por defecto); el logout revoca el refresh token y la app borra la sesión del navegador. Lo mide la prueba A/B.
- **La prueba A/B real no se pudo ejecutar** desde este entorno (red); hasta correrla, el aislamiento entre usuarios autenticados reales está probado por los tests SQL en la base real (204 controles, simulando la API) y por los E2E con Supabase simulado.
- Siguen las decisiones abiertas HD-04…HD-09 (BETA_SECURITY.md §6).
