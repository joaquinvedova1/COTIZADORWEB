# RATEOS — Perímetro de la beta (Beta Perimeter v1)

Plan: [PLAN-2026-016](../.agent/PLANS.md). Base: `main` `998b932` (v0.8.1, esquema 10). Fecha: 2026-10-18.

Objetivo: cerrar los tres requisitos obligatorios antes de habilitar usuarios reales que dejó [BETA_SECURITY.md §6](BETA_SECURITY.md#6-decisiones-del-dueño-human-decision-required) (HD-01, HD-02, HD-03) para una beta cerrada con 3–5 empresas.

> **Todavía no hay beta.** Este trabajo prepara el perímetro; habilitar usuarios reales sigue bloqueado hasta que los tres requisitos estén cumplidos **en producción** (ver §5). No cambia fórmulas, motores ni el esquema de datos (10), y no hay migraciones de base.

| Requisito | Qué hace este cambio | Qué falta (dueño) |
|---|---|---|
| **HD-02** Staging separado o `/preview/` deshabilitado | El deploy publica **sólo producción**; el artefacto nunca trae `preview/`; después de publicar se verifica `/preview/` → 404 (SEC-17). | Autorizar el merge y el deploy. |
| **HD-03** Registro público con confirmación (decisión del dueño, 2026-10-20; antes: registro cerrado o por invitación) | Registro público (`FEATURES.publicSignup = true`) con confirmación obligatoria, sin enumeración de cuentas (SEC-18) y reenvío de la confirmación (PLAN-2026-018). | "Allow new users to sign up" y "Confirm email" **encendidos** (hecho, según el dueño; verificar con el script), **SMTP propio** con plantillas y pruebas reales (§2.3–2.4). |
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

**Estado durante este PR (2026-10-18):** antes del push de esta rama, el dueño **deshabilitó a mano** el workflow "Deploy RATEOS a GitHub Pages" (`disabled_manually`), así que el push **no publicó nada** en GitHub Pages: no hubo ninguna corrida de deploy y `/preview/` sigue con lo que publicó el run #73 (`claude/rateos-beta-security-v1@1f8e000`). Mientras siga deshabilitado, ningún push ni merge despliega: para que este cambio llegue a producción (y borre `/preview/`) hay que **volver a habilitarlo**, con autorización, antes del merge o justo después (en ese caso, correrlo a mano sobre `main`: *Run workflow* con `ref` vacío). Si se lo habilitara antes del merge, el workflow viejo de `main` volvería a publicar `/preview/` con cada push de rama (se lee siempre desde `main`).

**Verificación manual después del deploy:** abrir `https://joaquinvedova1.github.io/COTIZADORWEB/preview/` → página 404 de GitHub; producción sigue en `https://joaquinvedova1.github.io/COTIZADORWEB/` (Configuración → Acerca de: versión y build nuevos).

### Reactivar un staging más adelante (sólo aislado)

Un staging tiene que estar aislado en **origen** y en **base**:

1. **Otro origen:** un sitio propio que no sea una carpeta de producción. Por ejemplo, un repositorio aparte con su propio Pages y un subdominio propio (`staging.<tu-dominio>`), o un hosting estático separado. Nunca `…/COTIZADORWEB/<algo>/` ni ningún otro sitio del mismo origen que producción.
2. **Otra base:** un proyecto de Supabase aparte (o un *branch* de Supabase), con su propia URL y publishable key en la configuración de **ese** build, sus migraciones aplicadas igual que producción y los tests SQL corridos ahí.
3. **Sólo datos sintéticos** y sus propias cuentas; registro cerrado también ahí.
4. **Un workflow propio** que publique en ese sitio con permisos sólo sobre él; el workflow de producción no se toca.
5. La app ya distingue un build de staging (`version.json` con `"channel": "staging"`): pregunta antes de actualizar el formato de datos.
6. Volver a armar `/preview/` dentro de producción está **prohibido** (HD-02, AGENTS.md §16). El script viejo queda en el historial de git (`998b932`) por si sirve su franja "STAGING", nunca su ubicación.

## 2. Registro público con confirmación de email (HD-03)

> **Decisión del dueño (2026-10-20):** registro **público y autoservicio**. Cualquiera crea su cuenta (nombre, empresa, email y contraseña), confirma su email y entra con **su propia empresa**. Reemplaza a la beta por invitación de PLAN-2026-016 (que queda como alternativa: `FEATURES.publicSignup = false`). Lo que sigue de "Configuración actual" y "Diagnóstico" es el relevamiento original.

### Configuración actual (relevada en sólo lectura, 2026-10-18)

- 2 usuarios, ambos con email confirmado; identidades sólo `email`; 0 invitados, 0 anónimos, 0 SSO, 0 MFA, 0 teléfonos.
- La confirmación de email está activa (AUTH_ARCHITECTURE.md §3). El registro está abierto: la app lo ofrecía en 5 lugares.
- El trigger `private.handle_new_user` crea perfil, organización ("Mi empresa" si no llega `company`), membresía OWNER y workspace vacío para **cualquier** usuario nuevo, también los creados desde el Dashboard.
- No pude leer la configuración pública de Auth (`/auth/v1/settings`) desde el entorno de desarrollo: la red de este entorno no llega al host de Supabase. Lo comprueba `node scripts/check-auth-perimeter.mjs` (abajo).
- **Correo:** el repo no registra ningún SMTP propio (README y AUTH_ARCHITECTURE.md §9.1 lo dejan pendiente) y esa configuración no es pública, así que no la pude verificar. Con el **SMTP por defecto**, Supabase **sólo envía correos a los miembros del equipo del proyecto** (Organization → Team): a cualquier otra dirección responde *Email address not authorized*. Además tiene un límite bajo por hora y no tiene garantía de entrega.

### Diagnóstico de HD-03 (2026-10-20): "no me llegó el correo"

Relevado en sólo lectura; el detalle está en la bitácora privada de auditoría (no en este repositorio público).

- **Sin alta previa, Supabase no envía nada.** "¿Olvidaste tu contraseña?" responde igual exista o no la cuenta (para no revelar quién usa RATEOS) y, si no existe, no sale ningún correo. La pantalla decía "…te enviamos un enlace", y eso confundía.
- **El SMTP es el por defecto de Supabase**: sólo entrega al equipo del proyecto. Aunque la cuenta existiera, a una persona de afuera no le llegaría nada.
- **"Allow new users to sign up"** seguía, con toda probabilidad, encendido (el 2026-10-20 el dueño lo apagó y lo volvió a encender: con el registro público tiene que quedar **encendido**).
- **Escáneres de enlaces:** hay señales de que un escáner de correo abrió un enlace de un solo uso antes que la persona. La recuperación ahora también acepta el **código** del correo (§2.3), pero el enlace y el código de un mismo correo son **la misma credencial**: si un escáner abre el enlace, el código de ese correo tampoco sirve. Para ese caso está la plantilla **sólo código** (§2.3 paso 6).

Qué corrige la app (PLAN-2026-018): el registro responde neutro y ofrece reenviar la confirmación; la recuperación no promete un correo antes de pedirlo, responde neutro pero dice qué hacer si no llega, pide esperar 60 s antes de reenviar (sólo una ayuda de la pantalla: recargar la saltea; los límites reales los pone Supabase) y acepta el código del correo; un enlace de "Send invitation" se borra de la URL sin abrir sesión.

### Cómo funciona (registro público)

- **Crear cuenta** (`#/registro`): nombre, empresa, email y contraseña (8 o más). Supabase crea la cuenta **sin confirmar** y manda un correo con un enlace **PKCE** que vuelve a `…/COTIZADORWEB/?auth=confirm`. El trigger `private.handle_new_user` crea el perfil, **su organización** (con el nombre que escribió, limpio y recortado a 120), su membresía OWNER y un workspace vacío. RLS la aísla de todas las demás.
- **Confirmación obligatoria:** hasta abrir el enlace no se puede ingresar ("Todavía no confirmaste tu email", sólo con la contraseña correcta) y se ofrece **reenviar** el correo. El enlace abierto en el mismo navegador entra directo a la app; en otro navegador o por un escáner, el email queda confirmado igual y se pide ingresar con email y contraseña.
- **Sin enumeración de cuentas:** el registro responde **lo mismo** a un email nuevo, a uno ya registrado y a uno sin confirmar (Supabase devuelve un usuario "de mentira" y no manda nada si ya existe); también el reenvío y "¿Olvidaste tu contraseña?". Lo controla SEC-18 del Beta Security Gate. **Excepción documentada, sólo con el envío roto (SMTP por defecto o caído):** si el correo de confirmación no sale, Supabase no crea la cuenta y la app lo dice; y si el **reenvío** no sale, la app dice "No pudimos enviar el correo de confirmación" en vez de "Pedido enviado" (R3). Así nadie queda esperando un correo que no existe. Como Supabase sólo intenta reenviar si hay una cuenta sin confirmar, ese mensaje revela eso mientras dure la falla; con el SMTP propio funcionando no aparece.
- **Ingreso de cuentas existentes:** no cambia (email y contraseña). **Recuperación:** igual que antes, con enlace o código.
- **Antiabuso:** los límites de **Supabase Auth → Rate Limits** (registros e ingresos por IP; correos por hora: con SMTP propio arranca en 30 y es el **tope de registros por hora**, subirlo si hace falta). La confirmación obligatoria impide usar un email ajeno. CAPTCHA (hCaptcha o Turnstile, que Supabase soporta) queda como **decisión aparte** si aparece abuso: suma un tercero a la CSP (AGENTS.md §13).
- **Cuentas sin confirmar:** quedan en la base con su empresa vacía (nadie puede entrar). Si se acumulan, se borran desde Authentication → Users (un paso aparte, con autorización).
- **Requisito: SMTP propio.** Con el SMTP por defecto, Supabase sólo envía al equipo del proyecto: **nadie de afuera puede confirmar su cuenta** (el registro avisa que el correo no salió). Aunque "Allow new users to sign up" esté encendido, el registro de terceros recién funciona con el SMTP propio (§2.3).

Alternativa del dueño (no es la única vía): crear una cuenta desde el Dashboard (**Add user → Create new user**, Auto Confirm) y que la persona elija su contraseña con "¿Olvidaste tu contraseña?". Sirve, por ejemplo, para dar acceso antes de que la persona lo pida.

### Pasos del dueño (configuración de Auth: no la toqué)

1. Supabase Dashboard → **Authentication → Sign In / Providers**:
   - **"Allow new users to sign up": encendido** (el dueño lo volvió a encender el 2026-10-20).
   - **"Confirm email": encendido.** Nunca apagarlo: cualquiera entraría con un email ajeno.
   - **No** apagar el proveedor **Email** ni encender otros (sociales, teléfono, anónimos).
2. Verificar (desde una máquina con acceso a Supabase):
   ```bash
   node scripts/check-auth-perimeter.mjs
   ```
   Tiene que terminar en `PERÍMETRO DE AUTH: OK (registro público con confirmación)`: `disable_signup = false`, `external.email = true`, `mailer_autoconfirm = false` y ningún otro método de ingreso. Lee sólo la configuración pública y no imprime datos de usuarios. El SMTP no es público: queda como verificación **A MANO**.
3. **SMTP propio** (antes de abrir el registro a terceros): **§2.3** (Resend, paso a paso) y las **plantillas** de `supabase/templates/`: `confirmation.html` en **Confirm signup** (obligatoria con el registro público) y `recovery.html` en **Reset password**. Después, las **pruebas reales** de §2.4.
4. **Authentication → Rate Limits:** revisar el límite de correos por hora (es el tope de registros por hora) y el de registros por IP.
5. **Authentication → Sign In / Providers → Email → Password requirements** (si el plan lo permite): mínimo 8 caracteres, como pide la app.
6. **No usar "Send invitation"**: ese enlace no es PKCE y la app lo rechaza a propósito (AUTH_ARCHITECTURE.md §4). Como red de seguridad, `supabase/templates/invite.html` lo reemplaza por uno a "Elegir mi contraseña".
7. Quitar a alguien: borrar el usuario en Authentication → Users. Su organización y su workspace quedan sin miembros (nadie los ve); borrarlos es un paso aparte de la base (SQL, con autorización).

### 2.3 SMTP propio recomendado: Resend (HD-03)

**Por qué Resend:** tiene SMTP compatible con Supabase (es el primero que lista su guía), **seguimiento de clics y aperturas apagado por defecto** (Supabase pide no reescribir los enlaces de Auth), un plan gratis que sobra para la beta y precio fijo si crece. Con **cualquier** proveedor, el seguimiento de clics tiene que estar **apagado**: reescribir los enlaces de Auth los rompe (Supabase pide desactivarlo). **Brevo** no se recomienda por eso: en sus correos transaccionales el seguimiento de clics viene activo y, según su propio foro, apagarlo no es autoservicio. Los dos piden un **dominio propio** verificado (con una dirección `@gmail.com` no se puede firmar DKIM).

| | Resend | Brevo |
|---|---|---|
| Plan gratis | 3.000 correos/mes, 100 por día, 1 dominio | 300 correos por día |
| Pago | Pro: USD 20/mes (50.000 correos) | Desde ~USD 9/mes |
| Seguimiento de enlaces | **Apagado por defecto**, por dominio | Activo en transaccionales; según su foro, apagarlo no es autoservicio |
| SMTP | `smtp.resend.com`, puerto 465 (SSL), usuario `resend`, contraseña = API key | `smtp-relay.brevo.com`, puerto 587, clave SMTP |

Precios aproximados a octubre de 2026: confirmarlos en cada sitio.

**Requisito previo: un dominio** (es el mismo que pide HD-01). Un dominio `.com` cuesta unos USD 10–15 por año; `.com.ar` se registra en NIC Argentina. Conviene un subdominio para el correo, por ejemplo `mail.<tu-dominio>`.

**Pasos (los hace el dueño; las claves nunca van al chat, a GitHub ni al repo):**

1. Crear la cuenta en Resend → **Domains → Add domain** → `mail.<tu-dominio>` (o el dominio).
2. En el DNS del dominio, crear **exactamente** los registros que muestra Resend (los valores son de tu cuenta): un **MX** y un **TXT (SPF)** para el subdominio `send`, un **TXT (DKIM)** `resend._domainkey` y, recomendado, un **TXT DMARC** `_dmarc` (por ejemplo `v=DMARC1; p=none;` para empezar). Esperar a que Resend marque el dominio como **Verified**.
3. En Resend: confirmar que el dominio tiene **Click tracking** y **Open tracking** apagados.
4. Resend → **API Keys → Create** con permiso **Sending access** sólo para ese dominio. Copiarla una sola vez y pegarla directo en Supabase (paso 5). No guardarla en ningún otro lado.
5. Supabase → **Authentication → Emails → SMTP Settings** → *Enable custom SMTP*: host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la API key, remitente `no-reply@mail.<tu-dominio>`, nombre `RATEOS` → Save.
6. Supabase → **Authentication → Emails → Templates**: pegar `supabase/templates/confirmation.html` en **Confirm signup** (asunto "RATEOS: confirmá tu email"; **obligatoria** con el registro público), `recovery.html` en **Reset password** (asunto "RATEOS: elegí tu contraseña") e `invite.html` en **Invite user**.
   - **Si un escáner de correo consume los enlaces de recuperación** (prueba R9): usar `recovery-solo-codigo.html` en su lugar. No trae ningún enlace que verifique nada (es lo que recomienda Supabase contra el *prefetch*); el costo es que no hay clic directo. En la confirmación del registro un escáner no molesta: al abrir el enlace, el email queda confirmado igual y la persona ingresa con su contraseña.
   - Hasta que se publique PLAN-2026-018, la app no tiene dónde escribir el código: el enlace (mismo navegador) funciona igual.
7. Supabase → **Authentication → Rate Limits**: con SMTP propio arranca en 30 correos por hora, que con el registro público es también el **tope de registros por hora** (cada registro manda un correo). Subirlo si se espera más; revisar también el límite de registros e ingresos por IP.
8. Supabase → **Authentication → URL Configuration**: Site URL `https://joaquinvedova1.github.io/COTIZADORWEB/` y Redirect URLs `https://joaquinvedova1.github.io/COTIZADORWEB/**` (lo que ya documenta AUTH_ARCHITECTURE.md §4). Con el dominio propio se agrega el suyo (§3).
9. Correr las pruebas reales de §2.4.

**Compatibilidad con PKCE:** el SMTP sólo transporta el correo; el enlace lo arma Supabase (`…/auth/v1/verify?token=…&type=recovery&redirect_to=https://…/COTIZADORWEB/?auth=recovery`) y vuelve con `?code=`, que la app canjea con el `code_verifier` de ese navegador. Lo rompe que el proveedor **reescriba el enlace** (seguimiento de clics; con Resend está apagado) o que algo lo abra antes que la persona. El **código** del correo (`{{ .Token }}`) no depende del navegador, pero es **la misma credencial** que el enlace: si el enlace ya se abrió (otro navegador, un escáner), el código de ese correo tampoco sirve.

### 2.4 Pruebas REALES (manuales, con SMTP propio configurado)

Las hace el dueño con un email propio que **no** sea del equipo de Supabase. Anotar sólo el resultado (sí/no y hora), nunca el email ni el código.

**Orden recomendado (registro público):** (A) "Allow new users to sign up" y "Confirm email" **encendidos** y el script del §2 paso 2 en OK; (B) dominio + Resend + SMTP verificado + plantillas; (C) revisión, aprobación explícita y deploy controlado de PLAN-2026-018 (la versión publicada hoy todavía no ofrece el registro: `publicSignup = false`); (D) estas pruebas en producción, R10–R14 primero; (E) prueba A/B real (§4) antes de anunciar el registro.

| # | Prueba | Resultado esperado |
|---|---|---|
| R1 | "¿Olvidaste tu contraseña?" con un email **sin** cuenta | Mensaje neutro; **no** llega ningún correo |
| R2 | Alta (Add user → Create new user, Auto Confirm) y "¿Olvidaste tu contraseña?" con ese email | Llega en menos de 5 min, de `no-reply@mail.<tu-dominio>`, con enlace y código; no cae en spam (probar Gmail y Outlook) |
| R3 | Abrir el enlace en el **mismo** navegador | "Elegí una contraseña nueva" con la cuenta; guardar → entra a **su** empresa ("Mi empresa") |
| R4 | (Con PLAN-2026-018 publicado.) Pedir otro correo, leerlo en **otro** dispositivo **sin tocar el enlace** y escribir el **código** en "Ya tengo un código" | Elegir la contraseña funciona |
| R5 | Ingresar con la contraseña nueva; Configuración → Cuenta → "Cambiar contraseña" | Llega el correo; el enlace cambia la contraseña |
| R6 | La cuenta nueva no ve DOVA ni otra empresa | Sólo "Mi empresa" vacía |
| R7 | En Resend → Emails: los correos figuran como *Delivered*, sin seguimiento | Delivered; enlaces sin reescribir |
| R8 | Pedir el correo, recargar la página (la espera de la pantalla es sólo de UX) y pedirlo otra vez antes de 60 s; pasado el minuto, pedir otro | El segundo pedido lo rechaza Supabase ("muchos intentos"); el tercero llega y **sólo sirve el último** correo |
| R9 | Recibir el correo en la casilla corporativa que se va a usar y esperar 2 minutos antes de abrir el enlace | El enlace funciona. Si dice "venció o ya se usó" sin haberlo tocado, hay un escáner: pasar a `recovery-solo-codigo.html` (§2.3 paso 6) |
| R10 | **Crear cuenta** con un email externo nuevo (nombre, empresa, contraseña) | Pantalla "Revisá tu correo"; llega en menos de 5 min la confirmación de `no-reply@mail.<tu-dominio>`; no cae en spam |
| R11 | Antes de confirmar, ingresar con esa contraseña; después "Reenviar el correo de confirmación" | "Todavía no confirmaste tu email"; llega otro correo y **sólo sirve el último** |
| R12 | Abrir el enlace de confirmación en el **mismo** navegador | Entra a la app con **su** empresa (el nombre que escribió), vacía; no ve DOVA |
| R13 | **Crear cuenta** otra vez con el **mismo** email (ya confirmado) | La misma pantalla que R10 y **ningún** correo (no revela que la cuenta existe) |
| R14 | Crear otra cuenta, abrir la confirmación en **otro** dispositivo y después ingresar en el primero | "Tu email ya puede estar confirmado…"; con email y contraseña entra a su empresa |

### 2.5 Pruebas SIMULADAS (automáticas)

- `node --test tests/services/auth-email.test.js` (+ `auth-service.test.js`): registro público (la misma respuesta para un email nuevo, ya registrado o sin confirmar; reenvío neutro; SMTP roto informado sin crear la cuenta; enlace de confirmación PKCE); recuperación con respuesta neutra igual con o sin cuenta, con SMTP por defecto o roto; código de 6 a 10 dígitos de un solo uso; enlaces con tokens en el # descartados; enlace de recuperación en otro navegador; nada de emails ni códigos en los logs.
- `npm run build && npm run test:auth:e2e`: el recorrido completo en navegador (escritorio y celular) con Supabase simulado y un buzón en memoria: registro público (AUTH-01, AUTH-10 a AUTH-14: confirmación, reenvío, email ya registrado, confirmación en otro navegador, SMTP por defecto), alta desde el Dashboard, enlace PKCE, código en otro navegador (y que el código de un correo cuyo enlace ya se abrió no sirve), "Send invitation", SMTP por defecto, dos empresas separadas y privacidad del almacenamiento.
- Beta Security Gate **SEC-18**: registro, reenvío y recuperación responden igual haya o no cuenta.
- **Lo que las simuladas NO prueban:** la entrega real (SMTP, spam, escáneres), los límites reales de Supabase (Rate Limits) ni que la configuración real de Auth coincida (eso lo mira `scripts/check-auth-perimeter.mjs`). Eso es §2.4.

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

- [x] Push y PR de esta rama, autorizados con el workflow de deploy **deshabilitado a mano**: el push no publicó nada en Pages (ninguna corrida de deploy).
- [x] Merge, workflow de deploy habilitado y "Verificar el sitio publicado" en verde (`/preview/` → 404): runs #74 (`d580d9f`) y #75 (`d6540b7`). **HD-02 cumplido.**
- [x] Supabase → Authentication → Sign In / Providers → **"Allow new users to sign up" encendido** y "Confirm email" encendido (el dueño lo informó el 2026-10-20; falta verificarlo con el script).
- [ ] Correr `node scripts/check-auth-perimeter.mjs` → OK (registro público con confirmación).
- [ ] **Dominio** (lo pide el correo y HD-01) y **SMTP propio con Resend** + plantillas (§2.3). Sin esto nadie de afuera puede confirmar su cuenta ni elegir su contraseña.
- [ ] Revisión, aprobación y deploy de PLAN-2026-018 (PR #28).
- [ ] Pruebas reales (§2.4) en verde. **HD-03 cumplido.**
- [ ] Darme el **dominio o subdominio** para RATEOS y el proveedor de DNS.
- [ ] Verificar el dominio en GitHub (TXT) y crear el CNAME (o los A/AAAA).
- [ ] Autorizar el PR de `PUBLIC_SITE_URLS` y el alta de `https://<dominio>/**` en las Redirect URLs de Supabase.
- [ ] Cada persona: sincronizar, exportar backup y cerrar sesión en github.io.
- [ ] Pages → Custom domain → certificado → **Enforce HTTPS**.
- [ ] Verificar el dominio (§3 paso 7) y, si github.io no redirige solo, autorizar `MOVED_TO_SITE_URL`. Cambiar la Site URL de Supabase. **HD-01 cumplido.**
- [ ] Prueba A/B real (§4) en verde sobre el dominio nuevo, y limpieza de lo sintético autorizada.
- [ ] Crear el tag `v0.8.0` sobre `0c213a3` (pendiente desde v0.8.1).
- [ ] Recién entonces: anunciar el registro a las primeras empresas (o crearles la cuenta desde el Dashboard, §2).

## 6. Riesgos que siguen

- **Hasta el deploy**, `/preview/` sigue publicado (lo del run #73): HD-02 se cumple recién con el deploy de este cambio, que necesita volver a habilitar el workflow de deploy. Mientras siga deshabilitado, ningún push lo vuelve a publicar, pero tampoco llega nada a producción (ni un rollback).
- **Registro público:** cualquiera puede crear una cuenta (es lo buscado). No expone datos de otras empresas: cada cuenta nace con su propia empresa y RLS lo garantiza. Riesgos propios: cuentas basura o sin confirmar (límites de Supabase, confirmación obligatoria, limpieza manual) y el tope de correos por hora (Rate Limits).
- **Hasta configurar un SMTP propio**, sólo reciben correos de RATEOS los miembros del equipo de Supabase: **nadie de afuera puede confirmar su cuenta** (el registro avisa que el correo no salió y no la crea) ni elegir su contraseña. Lo detectan las pruebas R10 y R2 de §2.4.
- **Escáneres de correo corporativos:** algunos abren los enlaces antes que la persona y, como los enlaces de Auth son de un solo uso, al hacer clic aparece "El enlace venció…". Con el enlace se usa también el código de ese correo (misma credencial). Mitigación: la plantilla **sólo código** (`supabase/templates/recovery-solo-codigo.html`, §2.3 paso 6), que no trae ningún enlace que verifique nada; lo detecta la prueba R9.
- **Sesiones viejas en el origen compartido:** las sesiones abiertas en github.io quedan en el `localStorage` de ese origen. Mitigación: cerrar sesión antes del cambio de dominio (§3 paso 5).
- **JWT vigente después del logout:** un access token ya emitido sigue siendo válido hasta su vencimiento (Supabase: 1 hora por defecto); el logout revoca el refresh token y la app borra la sesión del navegador. Lo mide la prueba A/B.
- **La prueba A/B real no se pudo ejecutar** desde este entorno (red); hasta correrla, el aislamiento entre usuarios autenticados reales está probado por los tests SQL en la base real (204 controles, simulando la API) y por los E2E con Supabase simulado.
- Siguen las decisiones abiertas HD-04…HD-09 (BETA_SECURITY.md §6).
