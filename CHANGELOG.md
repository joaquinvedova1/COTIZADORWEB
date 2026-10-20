# Changelog

Todos los cambios relevantes de RATEOS se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Los tags `v0.x.x` se crean sólo para hitos (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-tags-y-versiones)).

Reglas para este archivo:

- Todo cambio de fórmula económica se anota aquí **y** en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md), indicando qué resultados cambian.
- Todo cambio de `SCHEMA_VERSION` se anota con la migración correspondiente.
- Secciones: Agregado, Cambiado, Obsoleto, Eliminado, Corregido, Seguridad.

## [Unreleased]

**DESIGN-02 (2/2), cotizar sin fricción (PLAN-2026-026).** Ninguna fórmula ni dato cambia (golden 39/39, esquema 10).

### Agregado

- **Eco de montos en todo campo de plata** (Recursos, Configuración, Productos y el editor): debajo del campo, "$ 2.600.000" desde $ 10.000, con centavos si los hay. Antes existía sólo en el editor de cotizaciones. El texto del campo no se reformatea: cambiarlo al entrar borraría la selección y, con Tab, lo tipeado se sumaría al número anterior (`DESIGN.md` §5).
- **Margen con su palabra** en la barra compacta del resumen en vivo: "cumple", "debajo", "pierde" o "no confiable" (no sólo el color, WCAG 1.4.1).
- Pruebas: `tests/ui/money-echo.test.js`, `tests/ui/live-summary-text.test.js` y `tests/ui/editor-friction.test.js` (15 tests) y el bloque DESIGN-02B del `ui-lab` (escritorio y celular, con una prueba sólo con teclado).

### Cambiado

- **Resumen en vivo:** el resultado y el margen esperados pasan a la lista principal y quedan siempre a la vista en el panel; "Ver más" deja el precio para tu margen y la completitud. La barra compacta muestra costo, piso, tarifa cobrada y margen; "Para no perder" y el resultado en pesos quedan en "Ver detalle".
- **La tarifa cobrada se destaca** en la barra compacta (fondo y cifra más fuerte): ya no se ve igual que la piso.
- **Avisos arriba en el celular**, debajo de la barra de la app: ya no tapan el resumen fijo del editor.
- **Tablas de estructura y de tramos en tarjetas** cuando no entran, como "Otros costos" y los vehículos: sin scroll horizontal en el celular.

### Corregido

- **Accesibilidad de los campos:** los obligatorios llevan `aria-required` (también los que marca el editor); la ayuda y el error de los campos de texto, fecha, selector y buscador se asocian con `aria-describedby` (antes sólo el numérico), y también los avisos del motor junto a un campo.
- El eco de un monto con centavos los muestra ("$ 1.800.000,50"); antes redondeaba al peso.

**DESIGN-02 (1/2), "Ingeniería clara" (PLAN-2026-025): `DESIGN.md` propio y leer bien montos, unidades, riesgo y estado de guardado.** Ninguna fórmula ni dato cambia (golden 39/39, esquema 10). El logo no cambia y no se carga ninguna fuente.

### Agregado

- **`DESIGN.md`** en la raíz: principios, tokens por función, tipografía y números, marcas de riesgo, componentes, celular, impresión, voz, checklist de accesibilidad por PR, estados de pantalla, guía para agentes y decisiones pendientes (logo C, Inter). `tests/ui/design-system.test.js` verifica que sus colores sean los de `css/styles.css`.
- **Alias de color por función** (`--color-text`, `--color-status-critical`…) en `:root`, que apuntan a la paleta de siempre.
- **"Calculado con tus costos y tus supuestos: no es un precio de mercado."** junto a los montos del Resultado (servicios y productos), también impreso (VAL-G4).
- **Estado de guardado con palabra:** en el riel (761 a 1100 px), "Guardado", "Sin conexión", "Conflicto"… debajo del punto de color; en el celular, en la barra de arriba sin abrir el menú.
- Pruebas: `tests/ui/design-system.test.js` y `tests/ui/reference-text.test.js` (15 tests) y el bloque DESIGN-02 del `ui-lab` (escritorio y celular, con una prueba sólo con teclado).

### Cambiado

- **Raíz en %** (`93.75 %` en escritorio, `100 %` en el celular): con la letra de fábrica se ve igual, y si la persona agranda la letra del navegador, la app la sigue (WCAG 1.4.4).
- **Mínimo de 12 px:** `--fs-xs` pasa a 0,8 rem y los 75 tamaños menores de la app (ILUSTRATIVO, subtítulos de tablas, rótulos del resumen, textos del gráfico…) pasan a 12 px. Los tamaños en `em` (códigos, unidades) llevan piso: `max(…em, var(--fs-xs))`.
- **Cifras tabulares** también en las cifras clave del Resultado.
- **"Ver cálculo"** mide 24 px de alto o más en escritorio (WCAG 2.5.8).
- **Gráfico del Resultado:** la tarifa piso va punteada, el objetivo lleno y la tarifa cotizada con guiones, igual en la leyenda: ya no se distinguen sólo por el tono (WCAG 1.4.1). El margen izquierdo y la separación de los rótulos del eje X se calculan con el ancho de los rótulos.
- **Campos dentro de tablas** con el borde de los campos (3,3:1 en lugar de 1,3:1; WCAG 1.4.11).

### Corregido

- **El PDF imprimía la fecha de impresión como si fuera la de la oferta:** ahora dice "Oferta del dd/mm/aaaa · impreso el dd/mm/aaaa" (AUD-T1 C-E2-11). Sin fecha de oferta válida, sólo la de impresión.

**ECO-01 (PLAN-2026-017): bloqueantes económicos de la beta (H-01, H-02, H-03).** Ninguna fórmula cambia y ningún dato guardado se reinterpreta: golden 39/39 sin tocar y las mismas cifras que `main` en 2.097 cotizaciones y 13 productos sintéticos. Cambia qué se puede cargar (una unidad nueva) y qué se marca como pendiente. Esquema sin cambios (sigue en 10), sin migraciones.

### Agregado

- **(H-01) Unidad "Por viaje completo (ida y vuelta)"** para equipos y servicios externos: un viaje ida y vuelta es 1 unidad (`external.tripBasis = 'round_trip'`, opcional). En la cotización (Equipos) y en Recursos ("¿Qué cobra?"). La línea y "Ver cálculo" muestran viajes completos, tramos y el equivalente por km.
- **(H-01) Pendiente crítico "Unidad del proveedor"**: un externo "Por salida" en una ruta con más de un viaje por salida, con salidas, viajes y el equivalente por viaje; [Por viaje completo (ida y vuelta)] o [Sí, cobra por salida]. La confirmación guarda el supuesto (tarifa, viajes por salida y ruta, `equipment[].externalUnitConfirmed`) y deja de valer si cambia.
- **"RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA"** arriba de los números del Resultado (a la vista y en el PDF) con un doble abono, un "por salida" sin confirmar o un puesto sin sueldo; el margen, el cálculo de días y el resumen del editor dicen "NO CONFIABLE" en lugar de "Ganás…". Las cifras no cambian.
- **(H-02) "Cómo se compone la facturación del mes"** en el Resultado (`revenueComposition`): tarifa, abono de disponibilidad, cargos, ajuste al mínimo y total, con los números del motor.
- **(H-02) Pendiente crítico "Dos abonos por mes"** (`monthly_fee_overlap`): tarifa en $/mes + abono de disponibilidad. El resultado queda como borrador hasta dejar un solo abono; "El precio" lo avisa junto al campo. Abono solo, disponibilidad + tarifa por uso y mínimo garantizado siguen igual.
- **(H-03) Puesto usado sin sueldo básico:** "Personal" pasa a **crítico**, nombra el puesto y lleva a su básico (también en "Equipo sin operador" si se cargó un puesto con posiciones); la línea muestra el aviso. En productos, un puesto con minutos por tanda y sin básico es un error.
- Regresiones: `tests/engines/eco-01.test.js` (20 tests; 12 fallan en `main`) y E2E-17 a E2E-20.

### Cambiado

- Rótulos de las unidades de externos: "Por viaje (cada ida o vuelta)" → **"Por tramo (cada ida o cada vuelta)"** (mismo significado y mismos números) y "Por km" → "Por km recorrido".
- El puntaje de completitud cambia sólo en las cotizaciones donde aparece uno de los avisos nuevos.

**Beta Perimeter v1 (PLAN-2026-016).** Prepara el perímetro de la beta cerrada con 3–5 empresas: HD-02 queda resuelto en el código, HD-03 del lado de la app y HD-01 preparado. Sin cambios en motores ni fórmulas (golden 39/39), **ni en la base** (ninguna migración) **ni en el esquema de datos** (sigue en 10). **Todavía no hay beta:** falta lo que configura el dueño (registro apagado en Supabase, SMTP propio y dominio: [docs/BETA_PERIMETER.md](docs/BETA_PERIMETER.md) §5).

### Seguridad

- **(HD-02) Sin staging en el origen de producción.** El deploy publica sólo producción (`push` a `main` y rollback manual): sin `workflow_run`, sin job de preview y sin `scripts/stage-preview.mjs`. El build falla si `dist/` trae `preview/`; después de publicar, el workflow verifica que `version.json` tenga el commit desplegado y que `/preview/` y `/preview/version.json` respondan 404 (si no, el deploy queda en rojo). Pages reemplaza el sitio entero en cada deploy: el primer deploy con este cambio borra también los archivos del preview viejo. Nuevo control SEC-17 del Beta Security Gate.
- **(HD-03) Beta por invitación en la app.** `FEATURES.publicSignup = false`: la app no ofrece "Crear cuenta" (las llamadas a la acción llevan a Ingresar), `#/registro` explica el acceso por invitación sin formulario y `signUp` no llama a Supabase; `signup_disabled` / `email_provider_disabled` muestran el mensaje de la invitación. La barrera real es apagar "Allow new users to sign up" en Supabase Auth: paso del dueño (la configuración de Auth no se tocó).
- El Beta Security Gate rotula HD-01, HD-02 y HD-03 como REQUISITO pendiente antes de habilitar usuarios reales (18 controles y 17 archivos de tests).

### Agregado

- `docs/BETA_PERIMETER.md`: estado de HD-01/02/03, cómo reactivar más adelante un staging aislado (otro origen y otra base), alta por invitación, procedimiento del dominio propio (dato que falta, DNS, Pages, HTTPS, URLs de Supabase, rollback), prueba A/B real, checklist del dueño y riesgos.
- `scripts/check-auth-perimeter.mjs`: lee la configuración pública de Auth y verifica registro cerrado, proveedor Email activo, confirmación de email activa y ningún otro método de ingreso; el SMTP propio (no es público) queda como verificación manual.
- **Prueba A/B real** (manual, nunca en CI ni en `npm test`): `tests/live/perimeter-ab.mjs` (dos usuarios autenticados y dos organizaciones sintéticos `@rateos.invalid`; la app compilada en un navegador y la API con JWT reales: acceso, aislamiento A↔B, guardado, logout, cambio de usuario en la misma pestaña y refresh token revocado) y `supabase/tests/live_ab.sql` (alta, identificación, verificación y limpieza sólo de lo sintético). Preparada, no ejecutada: la red del entorno de desarrollo no llega a Supabase.
- (HD-01) Soporte para un segundo origen: `PUBLIC_SITE_URLS` (cada sitio usa sus propios enlaces de email, porque el enlace PKCE vuelve al origen donde se pidió) y `MOVED_TO_SITE_URL` (mudanza desde github.io antes de iniciar sesión, apagada hasta verificar el dominio).
- E2E `REGISTRO-01` (escritorio y celular): `#/registro` sin formulario ni campo de contraseña, ningún enlace a "Crear cuenta", y siguen Ingresar y "¿Olvidaste tu contraseña?".

### Corregido

- Con el SMTP por defecto de Supabase (sólo envía correos al equipo del proyecto) la recuperación respondía "te enviamos un enlace" aunque el correo no saliera: con la beta por invitación, nadie de afuera habría podido elegir su contraseña, sin ningún aviso. `email_address_not_authorized` tiene código propio: fuera de sesión la respuesta sigue neutra (no revela qué emails tienen cuenta) y queda un aviso técnico sin el email; con la sesión iniciada, "Cambiar contraseña" avisa que el correo no se pudo enviar (también ante cualquier otra falla). El SMTP propio pasa a ser paso obligatorio del dueño antes de la primera alta.

### Eliminado

- El staging público `/preview/` dentro del sitio de producción y `scripts/stage-preview.mjs` (queda en el historial de git, `998b932`). Un staging futuro tiene que estar aislado en origen y en base.

## [0.8.1] - 2026-10-17

**RATEOS v0.8.1: parche de seguridad y de pérdida de datos — Beta Readiness v1 (PLAN-2026-015).** Versión de parche sobre v0.8.0 (`0c213a3`, punto de retorno; el tag `v0.8.0` lo crea el dueño). Sin fórmulas nuevas ni cambios en los motores: ningún costo, tarifa ni golden cambia (39/39). **Sin cambios en la base** (ninguna migración) **ni en el esquema de datos** (sigue en 10): los datos y backups de v0.8.0 se abren igual. Auditoría completa en [docs/BETA_SECURITY.md](docs/BETA_SECURITY.md): 0 P0 de seguridad (ningún acceso entre empresas, ni con IDs conocidos; el admin de plataforma no lee contenido económico); 2 P0 de pérdida de datos, 3 P1 de sesión y 4 P2, corregidos (BS-01…BS-09); 9 decisiones del dueño.

**Todavía no hay beta con empresas externas.** Requisitos obligatorios antes de habilitar usuarios reales (decisión del dueño, 2026-10-17): **HD-01** dominio propio para producción; **HD-02** staging separado de producción en origen y en base de datos, o `/preview/` deshabilitado temporalmente; **HD-03** registro cerrado o por invitación. El Beta Security Gate los informa como REQUISITO pendiente en cada corrida.

### Agregado

- **Tests de negación en la base** `supabase/tests/beta_security_test.sql` (132 controles, todo se deshace): A→B y B→A con los IDs reales de la otra empresa (leer, escribir, borrar, altas con `organization_id` ajeno, upsert, columnas de control, filtros manipulados, búsqueda por contenido), roles OWNER/ADMIN/ESTIMATOR/VIEWER, miembro quitado, RATEOS ADMIN sintético (metadata sí, contenido no), anon, JWT sin usuario y el catálogo en vivo (RLS, grants, `security definer`, Storage, Realtime).
- **Beta Security Gate** (`npm run test:security`; también dentro de `npm test` y como paso de CI): 17 controles estáticos y dinámicos (secretos en lo publicado, superficie de Supabase del navegador, migraciones, cobertura del test SQL, la nube nunca se pisa con datos "recuperados", pestañas, `organizationId`, sesión, PKCE, logs, eventos, backup, CSP, admin, dependencias) + 15 archivos de tests; reporte JSON + Markdown en `reports/security/`. Las decisiones del dueño se informan siempre (no bloquean) y HD-01, HD-02 y HD-03 se rotulan REQUISITO pendiente antes de habilitar usuarios reales.
- Tests de tenancy, recuperación, varias pestañas, acceso perdido y memoria de sesión (`tests/data/beta-security.test.js`) y controles E2E `SESION-01/02` (escritorio y celular): al cerrar sesión no queda nada de la empresa en pantalla ni en el DOM, y otra cuenta en la misma pestaña no ve nada de la anterior, ni con los ids de sus cotizaciones o productos.

### Corregido

- **(P0 pérdida de datos, BS-01)** Si los datos de la nube no se podían leer con la versión abierta (dañados o con estructura inesperada; por ejemplo escritos por otra versión con el mismo esquema, como el staging, que comparte la base), la cuenta cargaba un espacio **vacío** o "reparado" y **lo subía solo**, pisando la única copia compartida. Ahora se abren en **sólo lectura** con un aviso, sin subir nada, y queda una copia en el navegador (también al "Recargar"). Si lo ilegible era una copia local sin subir, se abre la versión de la nube y la copia queda en recuperación.
- **(P0 pérdida de datos, BS-02)** Con varias pestañas, un guardado exitoso en una **borraba** la copia de cambios sin subir de otra (sin conexión o en conflicto): al cerrarla, esos cambios se perdían sin aviso. Ahora cada pestaña tiene su propia copia (`rateos.cloud.<u>.<o>.pending.<pestaña>`); al abrir se retoma la más nueva hecha sobre la revisión actual y las demás quedan en copias de recuperación. La copia única de v0.8.0 se sigue leyendo.
- **(P1 sesión, BS-03 y BS-04)** Al cerrar sesión o entrar con otra cuenta en la misma pestaña quedaban en memoria los borradores no guardados (se restauraban por id de cotización, sin mirar la cuenta), los sliders y las secciones abiertas; y el menú y la barra ocultos conservaban la empresa, su base, el nombre, el email, el título y las migas de la sesión anterior. Ahora los borradores son de cada cuenta y todo lo demás se borra al cerrar la cuenta.
- **(P1 sesión, BS-05)** Los datos del modo local anterior se ofrecían a cualquier cuenta que ingresara en el navegador aunque otra ya los hubiera importado. Ahora quedan "reclamados" (huella, sin datos ni ids) y no se ofrecen a otra cuenta. `rateos.state` nunca se borra.
- (P2, BS-06) Un miembro quitado de la empresa veía "Tu rol no permite guardar" y seguía con los datos en pantalla: ahora se cierra la cuenta en pantalla ("Ya no tenés acceso a esta empresa"), sin reintentos, y sus cambios sin subir quedan en el navegador.
- (P2, BS-09) Las copias de recuperación de cambios que nunca llegaron a la nube (`cloud-unsynced`, `cloud-conflict-local`) tienen su propio cupo de 3: importar o migrar ya no las rota.
- (P2, BS-08) "Conservar una copia" (conflicto) descarga siempre la versión actual de la pestaña: antes, si al abrir se había apartado una copia vieja de cambios sin subir, descargaba esa copia vieja.

### Seguridad

- (P2, BS-07) Toda escritura de una cuenta deja cada entidad con la organización de la cuenta: nunca se guarda el `organizationId` que mande el navegador o un backup (el límite real sigue siendo RLS: nunca hubo acceso entre empresas por esto).

## [0.8.0] - 2026-10-17

**RATEOS v0.8.0: decisiones del dueño LAB-D1…D8 (PLAN-2026-014) y RATEOS Test Lab v1 (PLAN-2026-013).** **Esquema de datos 10** (`migrateV9ToV10`: sólo sube la versión, no cambia ni marca ningún dato; una versión anterior abre estos datos en sólo lectura). Ningún golden anterior cambia (39/39: 37 + 2 nuevos de D1).

**Decisiones del dueño LAB-D1…D8 (PLAN-2026-014).** Cierra las ocho decisiones que dejó Test Lab v1. **Ninguna fórmula cambia para los datos que ya existen**: ninguna cotización ni producto cargado cambia sus números (COT-0009, COT-0010, COT-0011, la demo y los 37 golden anteriores, idénticos; dos golden nuevos aprobados para D1). Cambian números sólo cuando la persona carga un dato nuevo: la financiación de un producto (D3) o la marca "No usa combustible" en un equipo (D5); y una línea de equipo cargada con más de 24 h por día (un dato inválido que la validación ya marcaba como error) ahora se calcula con 24 h por unidad. Lo que sí cambia, a la vista: el **puntaje de completitud** de una cotización cuya operación pide más horas de cobertura que las cargadas para el puesto (aparece el aviso de D2; p. ej. 100 % → 98 %) y el de una cotización real nueva con el precio de combustible de ejemplo (D7); costos y tarifas, iguales. Detalle y fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §2, §2.1, §3, §4, §4.1, §5.1, §5.2, §6, §19 y §23.1.

**RATEOS Test Lab v1 (PLAN-2026-013): QA interno, simulación y auditoría.** No es una funcionalidad visible ni se publica en `dist/`: oráculo económico independiente, candado de golden, 68 escenarios curados (todos los tipos de servicio, las 18 unidades comerciales, las 7 de externos y productos), 20 sondas de contradicción, escenarios generados con seed (pairwise), 35 invariantes, auditor de consistencia UX, auditoría en navegador (escritorio y celular, Supabase simulado), mercado offline y reportes JSON + Markdown. La primera campaña encontró 11 problemas distintos y la revisión del código 1 más; se corrigen acá, cada uno con un test que falló antes del fix (`tests/engines/lab-findings.test.js`). Las 8 decisiones del dueño que dejó (HUMAN DECISION REQUIRED) se cierran en esta misma versión (PLAN-2026-014). **Ningún costo, tarifa ni golden cambia**; sí cambia qué se marca como pendiente, y por eso el puntaje de completitud de las cotizaciones afectadas. Test Lab no cambia el esquema. Detalle en [docs/TEST_LAB.md](docs/TEST_LAB.md); reglas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §19 y §20.

### Agregado

- **Financiación de productos (D3).** `product.finance`: días entre producir y vender, plazo de cobro, tasa mensual y cuándo se paga cada grupo de costos, con el **mismo** `computeFinance` de las cotizaciones (sin duplicarlo). El costo financiero entra al costo por unidad, a los precios, al equilibrio y al resultado del mes; se ve en "Precio y margen" (capital financiado, costo financiero y efecto en el precio con tu margen), en el desglose y en "Ver cálculo". La amortización y el costo de capital no se financian. Es una **estimación financiera sobre costos netos**: el IVA de compras no está incluido en ese capital de trabajo (no es una simulación completa de caja) y la tarjeta "Financiación", el resultado del mes y "Ver cálculo" lo dicen siempre. Un producto nuevo arranca sin plazos ni tasa (nunca se inventan) y uno anterior calcula exactamente igual. Ejemplo: chipá del golden + 10 días de stock, cobro a 20 días y 3 % mensual → costo $ 345 → **$ 355,35**, precio con margen 30 % $ 492,86 → **$ 507,64**.
- **"No usa combustible" (D5)** en cada equipo propio, en la cotización y en Recursos (eléctrico, manual o estacionario): no se pide consumo ni precio de combustible por ese equipo, no consume trabajando ni en ruta y no impide el 100 % de completitud. Un consumo 0 **sin** la marca sigue siendo un dato faltante (nunca se infiere). En la demo, el tráiler y el kit de herramientas vienen marcados.
- **Horas de cobertura del personal (D2).** Pendiente "Horas del personal" (naranja, sólo cuando falta cubrir horas): "La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra.", con el cálculo del mes (días × horas por día contra personas × horas normales por mes + horas extra), las horas que faltan por posición y botón a "Personas por posición". Es un control mensual: RATEOS no tiene un dato de jornada diaria y no habla de jornada. Nunca agrega horas extra, turnos ni personas.
- **Menos de una salida por mes (D1).** Aviso informativo (no resta puntaje) con salidas promedio, salidas costeadas y efecto del redondeo, y botón a "Cada salida se cuenta completa". Golden `salidas-menos-de-una-promedio` y `salidas-menos-de-una-completa`.
- **Km facturables ≠ km de ruta (D4).** Con la unidad "km", "Ver cálculo", "Cómo se cobra", "Movilización y viajes" y el Resultado muestran los dos números y su relación (km facturables por km de ruta); nunca se deriva uno del otro ni se pisa lo cargado.
- Test Lab: escenarios `SRV-D1…D8`, sondas PRB-20b y PRB-21, PRD-04 financiado, invariantes INV-29…31 y PINV-08…10, factores nuevos del generador y auditoría de terminología estática y dinámica (`UX-TERM-HARDCODED`, `UX-TERM-FOREIGN`, `UX-TERM-JORNADA`) y del alcance de la financiación de productos (`UX-PRODUCT-FINANCE-SCOPE`). Navegador: controles de cada decisión (escritorio y celular).
- `npm run test:lab` (campaña estable: falla si un golden cambia, si falta cobertura o si queda un P0/P1 sin triage), `npm run test:lab:extended` (con seed) y `npm run test:lab:e2e` (navegador). Reportes en `reports/lab/` (ignorado por git; artefactos en CI).
- Workflow **Test Lab** (`.github/workflows/test-lab.yml`): PR gate en cada PR (lab estable + build + navegador escritorio/celular) y Extended Lab sólo manual. Sólo lectura, sin deploy; Playwright con versión fija fuera del repo (RATEOS sigue con cero dependencias).
- Avisos informativos (no restan puntaje): puesto con sueldo y 0 posiciones ("no suma costo") y "el servicio no usa materiales" con materiales cargados ("no se suman al costo"), con botón al campo.

### Cambiado

- **Terminología de la activación (D8).** Una magnitud, un nombre por cotización (`js/domain/activation-terms.js`): **llamado** en on-call o con la unidad "llamado", **salida** en transporte, **trabajo** en llave en mano y precio cerrado, **intervención** en el resto (también en servicios permanentes: es el término neutral, RATEOS no sabe si cada activación es un relevo o un cambio de turno). Aplica a formulario, ayudas, avisos, "Ver cálculo", Resultado e impresión (PDF). "Viaje", "día de trabajo", "turno" y "salida de caja" son otras magnitudes y no cambian. La unidad de facturación "llamado" pasa a decir "$/llamado".
- **"Cada salida se cuenta completa" (D1)**: la semántica no cambia y se explicita: apagada = promedio; encendida = los costos indivisibles por salida con salidas enteras. Los textos dicen "promedio", "costeadas" y "efecto del redondeo".
- **Precio de combustible de ejemplo (D7)**: en una cotización real **nueva** (configuración de ejemplo o plantilla de demostración) el $ 1.500/l ILUSTRATIVO no cuenta como definido: la completitud lo marca en rojo, con el valor y su base, hasta "Es mi precio vigente" o un precio propio (`fuel.requiresConfirmation`). Las cotizaciones anteriores y la demo conservan el aviso naranja de siempre. Sin precio automático, scraping ni actualización.
- **CALCULATION_RULES (D6)**: se documentan tres reglas reales que no estaban escritas (IVA "Parcial" sin % = 0 % recuperable; "Otros costos" con categoría "Equipos y servicios externos" = costo directo del grupo Proveedores; las horas por día de una línea de equipo, que no tenían tope y que el dueño unificó después en 24 por unidad, ver abajo). El oráculo de Test Lab ya no tiene huecos.
- **Horas de equipo por día: 24 h por unidad (decisión del dueño)**: `hoursPerActiveDay` de una línea de equipo, propia o externa, son las horas de uso **por unidad** y tienen el mismo tope físico que la actividad (24 h); la cantidad de equipos va en `quantity`, que multiplica (2 equipos × 20 h = 40 equipo-horas por día, nunca 1 × 40 h). Más de 24 h sigue siendo un error de validación y el motor ya no calcula por encima del tope (`equipmentHoursPerDay` en `computeEquipmentLine` y `computeExternalLine`; "Ver cálculo" lo explica en la línea). Antes → después: 30 h × $ 1.000/h de operación = $ 30.000 → **$ 24.000 por día**. Sin cambio de esquema; ningún golden ni escenario anterior usaba más de 24 h.
- Los golden cases se leen con un harness compartido (`tests/golden-cases/harness.js`) que usa también el Test Lab; los casos y sus valores no cambian.

### Corregido

- **Indicador de externos con "Cada salida se cuenta completa"** (LAB-F1): sumaba el combustible por km del proveedor y quedaba más alto que la fila de externos de la EECC (COT-0011 con 13 viajes y 35 L/100 km: $ 9.205.000 → **$ 9.100.000**; caja $ 11.116.000 → **$ 11.011.000**). El costo total y las tarifas no cambian.
- **Unidad "km" con más km facturados que los de la ruta** (LAB-F3): 8.000 km facturados con una ruta de 4.000 km quedaba 100 % completo; ahora es un pendiente a revisar con los dos números y botón a "Viajes por llamado" (no se deriva: decisión del dueño). Una vuelta vacía (más km de ruta que facturados) no se avisa.
- **Unidad "viaje" o "km" con "Sin traslados"** (LAB-F4) y **"Sin traslados" con un equipo que viaja** por sus medios o con vehículo de apoyo (LAB-F5): se avisaba nada; ahora el pendiente dice qué no se suma y lleva a "Sin traslados".
- **Externo $/hora sin horas** (LAB-F6): sumaba $ 0 en silencio; ahora es **crítico** ("Horas del proveedor") con botón a las horas de la línea o de la actividad. **Cobro por hora con 0 horas por día** (LAB-F7): la actividad queda crítica (no hay unidades facturables).
- **Combustible por km con "Sin traslados"** (LAB-F2): el botón llevaba a la distancia (que con "Sin traslados" no resuelve nada); ahora explica y lleva a "Sin traslados".
- **Material con precio y cantidad 0** (LAB-F8): sumaba $ 0 sin aviso; ahora es un pendiente con botón a la cantidad, y `validateQuote` valida cantidades, costos y % de materiales y el monto de otros costos (una cantidad negativa es un error; con "El servicio no usa materiales" las líneas ocultas no se validan).
- **Botón al campo exacto** (LAB-F10/F11/F12): actividad, margen, tarifa conocida, plazo de cobro y costo de equipos llevan al campo; dentro de cada paso, "Ir al campo" usa el campo que indica el motor (antes faltaba en varios avisos nuevos y viejos).

## [0.7.2] - 2026-10-16

**Pulido desde casos reales de transporte (COT-0010 / COT-0011).** Las dos cotizaciones $/viaje que probó el dueño se reproducen al peso (golden): costo $ 12.864.478, piso $ 1.128.463, objetivo $ 1.261.224, sugerida **$ 1.262.000 por viaje**, margen 10,05 %, equilibrio 8,55 viajes. Se corrige un bug de viajes físicos, se ordena la completitud y se suman opcionales pedidos (combustible por km, recursos compartidos, "Usado en"). Las cotizaciones existentes conservan sus números (foto de 99 casos y COT-0009 idénticas), salvo las $/viaje con un dato de viajes inconsistente. **Esquema de datos 9** (`migrateV8ToV9`: sin cambios de datos). Plan: PLAN-2026-012; fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §4.1, §4.2, §5.2, §7, §15 y §19.

### Corregido

- **Viajes físicos con la unidad "viaje" (bug P0):** la ruta usaba "Viajes por llamado" (1 por defecto) aunque se vendieran 2 o 3 viajes por día. Ahora los viajes por intervención se **derivan**: viajes por día × días por intervención. Antes → después, COT-0011 con "Viajes por llamado" en 1: 6 viajes físicos y 1.200 km para 12 facturados, proveedor $ 3.900.000, costo $ 8.320.447, sugerida $ 816.000 → 12 viajes, 2.400 km, $ 7.800.000, $ 12.864.478 y **$ 1.262.000**. Con 1, 2 o 3 viajes por día y los mismos viajes facturables, los km y el costo de un proveedor por km no cambian. El dato guardado no se toca: un aviso explica el cambio y [Entendido] lo iguala. Las demás unidades siguen con "Viajes por llamado".
- **Completitud de combustible (P0):** sólo pide consumo a lo que consume combustible a tu cargo. Un externo con combustible incluido ya no deja "Falta el consumo" (COT-0010 / COT-0011: **92 % → 100 %** sin inventar consumo); provisto por el cliente, sin costo; si no hay nada a tu cargo, "No aplica". El botón lleva al **campo exacto** (`?campo=`) o no se muestra.
- **Equilibrio sin costos fijos:** en lugar de "0 viajes" y "los ingresos fijos ya alcanzan" (falso sin ingresos fijos): "Sin costos fijos: cada viaje vendido cubre su costo variable. Desde el primer viaje hay contribución positiva." El caso de ingresos fijos tiene su propio texto.
- Proveedor por km o por viaje **sin ruta**: pasa de "revisar" a **crítico** ("Falta definir la ruta/distancia para calcular este proveedor."), cuenta en la completitud y la línea dice "Falta la ruta" en lugar de $ 0, con [Definir la ruta].

### Agregado

- **Viajes y km del mes** en "Cómo se cobra", "Movilización y viajes" y el Resultado: viajes facturables, viajes físicos costeados, días de trabajo, km por viaje y km por mes, con "Ver cálculo" (12 ÷ 2 por día = 6 días; 12 viajes × 200 km = 2.400 km; 2.400 × $ 3.250 = $ 7.800.000).
- **Distancia / actividad del proveedor** separada de la movilización propia ("12 viajes · 200 km/viaje · 2.400 km/mes · $ 3.250/km = $ 7.800.000" y "Movilización propia y vehículos de apoyo: $ 0").
- **Tarifa ligada a la ruta**, sin forzar $/km: "Neuquén → Añelo · 200 km por viaje · $ 650.000 por viaje · equivalente $ 3.250/km"; en el Resultado, la tarifa por viaje con su equivalente por km.
- **Combustible de un externo por km** (opcional): L/100 km o km/L sobre los km físicos de la ruta (2.400 km × 35 L/100 km = 840 L = $ 1.260.000), en Combustible y aparte de la tarifa; sin duplicar con L/h, la movilización propia ni "combustible incluido". También en Recursos → Servicios externos.
- **Recursos compartidos** (opcional, PLAN-2026-006 §3.1): personal dedicado / compartido (%) / contratado para el servicio y equipo propio reservado / compartido (%). El % es explícito y mueve sólo los costos fijos ($ 3.280.036 × 25 % = $ 820.009; posesión $ 5.000.000 × 30 % = $ 1.500.000); horas extra, viandas y variables siguen el uso real. Sin dato = 100 %. La estructura por empleado usa la dotación equivalente. Aviso del resto no cubierto.
- **"Usado en"** en Recursos (personal, equipos y servicios externos): cada cotización con su estado y su % asignado; adjudicadas = compromiso, borrador / enviada = potencial; aviso si lo adjudicado supera el 100 % (no bloquea). Sin módulo de contratos.
- "Ver cálculo" del proveedor con la ruta (viajes, km, neto del mes, salida de caja, IVA que se adelanta y crédito fiscal) además del plazo, los días financiados y el costo financiero.
- Golden cases `cot-0010-transporte-1-viaje-por-dia`, `cot-0011-transporte-2-viajes-por-dia`, `cot-0010-transporte-3-viajes-por-dia` y `cot-0011-viajes-por-llamado-inconsistente`.

### Cambiado

- Estructura: aclara que Ingresos Brutos, el impuesto al cheque y sellos van en "Impuestos sobre lo que facturás" y avisa si un rubro desglosado parece uno de esos impuestos (doble conteo). No hay capa nueva ni alícuotas.
- Esquema de datos 8 → 9 (`migrateV8ToV9`, sólo sube la versión): campos opcionales `labor[].assignment` / `fixedCostSharePct`, `equipment[].assignment` / `fixedCostSharePct` y `external.fuelMode` / `fuelLitersPer100Km` / `fuelKmPerLiter`. Una versión anterior abre los datos v9 en sólo lectura.
- Ya estaban en v0.7.0 y sólo se confirman con tests: unidad visible de materiales y horas extra HE 50 % / HE 100 %.

## [0.7.1] - 2026-10-13

**Salidas completas y plazo de pago por proveedor.** Dos mejoras aprobadas por el dueño después de la auditoría de COT-0009, ambas opcionales: con la opción apagada y sin plazos propios, **todas las cotizaciones dan exactamente igual** (COT-0009 golden y foto de 99 casos idénticas). **Esquema de datos 8** (`migrateV7ToV8`: sin cambios de datos). Plan: PLAN-2026-011; fórmulas en [docs/CALCULATION_RULES.md §2.1 y §8](docs/CALCULATION_RULES.md).

### Agregado

- **"Cada salida / intervención se cuenta completa"** (en "Cómo se cobra", apagada por defecto). Las intervenciones estimadas siguen siendo un promedio (10,42) y la producción y la facturación no cambian; sólo los costos físicamente indivisibles por salida se costean con salidas enteras (11): movilización por sus medios, logística auxiliar (vehículos, peajes, viáticos), externos por llamado / viaje / km o con mínimo por llamado, movilización del proveedor, materiales y otros costos por llamado, con su estructura (si es %), su financiación y su contingencia. Sueldos, tenencia de equipos, estructura mensual y producción no se redondean. Se muestra "Intervenciones estimadas: 10,42 · Intervenciones costeadas: 11" y cuánto suma; apagada, cuánto sumaría. Ejemplo COT-0009 con 2.500 m³: +52.930,94 por mes (0,5833 salidas × 90.738,75).
- El equilibrio, los días para el margen objetivo y el comparador de modelos evalúan cada salto del costo (inicio de cada salida) para no saltear una pérdida.
- **"¿A cuántos días pagás a este proveedor?"** en cada equipo o servicio externo. Con plazo propio, ese externo se financia con su plazo; vacío, con el general de "Proveedores". El costo del externo no cambia: sólo el capital de trabajo y el costo financiero. Ejemplo COT-0009: pickup a 15 días → +42.000 de costo financiero. "Ver cálculo" muestra, por proveedor, la salida de caja, el plazo, los días financiados, el capital de trabajo y el costo financiero asociado; la tabla de Financiación agrega una fila por proveedor con plazo propio.
- Una "Condición de pago" de Recursos o un plazo cargado antes como dato informativo no se usan solos: la línea ofrece [Usar X días].

### Corregido

- Celular: los montos de "Equipos y servicios externos en el mes" (resultado) ya no se salen de la pantalla (bug de v0.7.0, visto en las pruebas de punta a punta).

### Cambiado

- El campo informativo "Plazo de pago al proveedor" del tratamiento fiscal se reemplaza por el plazo activo de "Pago al proveedor" (el dato anterior se conserva y se ofrece usarlo).
- Esquema de datos 7 → 8 (`migrateV7ToV8`, sólo sube la versión): campos opcionales `activity.fullActivations` y `equipment[].supplierPayDays`. Una versión anterior abre los datos v8 en sólo lectura.

## [0.7.0] - 2026-10-12

**Auditoría y pulido desde una cotización real (COT-0009).** Los números de COT-0009 (auditados externamente) se mantienen al peso y quedan protegidos por un golden case. Se corrige un bug económico (financiación de externos con IVA), cada número del reporte gana trazabilidad y se pulen las pantallas que podían inducir a cotizar mal. **Esquema de datos 7** (`migrateV6ToV7`: sin cambios de datos). Plan: PLAN-2026-010; fórmulas en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) §3.1, §4.1, §7, §8, §10, §17 y §19.

### Corregido

- **Financiación de equipos y servicios externos (bug P0):** el costo financiero se calculaba sobre el costo económico del externo; ahora se calcula sobre la **salida de caja** (neto + IVA + percepciones + cargos no recuperables). El IVA recuperable y las percepciones no son costo, pero se adelantan al proveedor hasta cobrar. **Sin tratamiento fiscal definido no cambia nada** (COT-0009 y las cotizaciones existentes sin IVA cargado quedan iguales). Antes → después, pickup tercerizada $ 2.800.000/mes financiada 45 días al 3 % mensual: IVA 21 % recuperable $ 0 → $ 26.460 por mes; IVA parcial 50 % $ 14.847 → $ 28.077; IVA recuperable + percepciones 3 % $ 0 → $ 30.240; IVA no recuperable $ 29.694 (sin cambio). La movilización que cobra el proveedor aparte también se financia con su IVA.
- Sin plazo de cobro, el costo financiero ya no se describe como "no calculado": se explica que es parcial (sólo los días hasta facturar) y cuánto da.
- Celular: la barra de resumen del editor ya no se sale de la pantalla cuando un valor es un texto ("No se alcanza"); los números abreviados no se cortan (bug preexistente, visto en el recorrido de rutas).

### Agregado

- Golden case `cot-0009-prueba-real` con todos los números del PDF: costo 28.367.260, piso 12.441,78/m³, objetivo 13.905,52/m³, sugerida 14.000/m³, facturación 33.600.000, impuestos 1.680.000, resultado 3.552.740, margen 10,5736 %, equilibrio ≈ 1.929,05 m³.
- **BORRADOR arriba del resultado** cuando quedan puntos materiales: "BORRADOR — revisar N puntos antes de usar esta tarifa", separando **crítico** (cambia el costo o el precio, por ejemplo un externo sin tarifa), **revisar** e **informativo** (no resta puntaje).
- Línea externa incompleta nombrada ("Equipo alquilado" no tiene tarifa del proveedor) con [Completar] y [Quitar]; asistente de datos del proveedor (tarifa, unidad, IVA, recuperable, percepciones, operador, combustible, seguro, movilización) sin inventar tasas.
- **Impacto incremental** de cada externo en "Ver cálculo": cuánto sube el costo total con la línea (proveedor + estructura + financiación + contingencia). COT-0009: la pickup de $ 2.800.000 sube el costo $ 3.221.400.
- **Horas extra por tramos** (HE 50 %, HE 100 %, otro recargo; editables, no normativa), por día activo o promedio por mes, con detalle por persona y la pregunta "¿Estas horas extra se facturan aparte al cliente?" (siguen siendo costo y además suman ingreso). Sin tramos, el campo único de siempre da lo mismo al centavo.
- **"Desglosar estructura"**: rubros con su propio método (administración % sobre directo, HSE por empleado, seguros por contrato…), guardables como política de la empresa en Configuración y reutilizables. El modo simple sigue igual.
- Comparador de modelos en la unidad comercial ($/m³, $/viaje, $/unidad): tarifa por unidad, abono + tarifa, facturación mínima (take-or-pay) + tarifa, paquete con unidades incluidas + excedente; equilibrio en la unidad. Los modelos por día no cambian.
- "Equivalencias operativas" de una tarifa por cantidad ($/m³, $/viaje…): $ por día de trabajo, $ por hora de trabajo y facturación del mes, con su cálculo.
- Viajes con el detalle A/B/C: A. movilización de los equipos principales (salidas, km por salida y por mes, litros, combustible y desgaste por mes), B. vehículos y logística auxiliar, C. total con su incidencia; "Ver cálculo" de la logística con los pasos por mes. Cada costo sigue en un solo lugar.
- Materiales: unidad visible con opciones habituales (unidad, L, kg, g, t, m, m², m³, paquete, bolsa, tambor) o propia, y la fórmula "10 L/día × $ 5.000/L = $ 50.000/día · 20 días = $ 1.000.000/mes".
- Resumen por intervención (m³ por salida, costo por salida) y aviso si las salidas por mes no son enteras (el costo por salida es un promedio).
- Fecha base: lista de los valores sin base o con base vieja y la opción **"Usar [mes] (mes de la oferta) en los N sin base…"**, con confirmación; nunca pisa una base definida y queda marcada como "Mes de la oferta".
- Aviso informativo de equipo propio sin costo de capital (opcional; no es la financiación del contrato).
- Contrato a 12 meses: "Valores constantes a base [mes]. No incluye actualización ni escalación".

### Cambiado

- "Días por viaje o llamado" → **"Duración promedio de cada salida / intervención"**.
- La tarjeta de equilibrio dice con qué tarifa se calculó ("a $ 14.000/m³").
- EECC: "Fijo del mes" y "Variable por día de trabajo" en columnas separadas (el "$/día activo" mezclaba los fijos); los montos no cambian.
- Eje X del gráfico en la unidad de la cotización (m³, viajes, días…).
- Contingencia: ayuda, aviso en 0 % y nota para no duplicarla con el margen. Estructura: texto neutro en lugar de "es el método más usado".
- Financiación: tasa anual → mensual (÷ 12, interés simple) y explicación de qué se financia.
- Esquema de datos 6 → 7 (`migrateV6ToV7`, sólo sube la versión): campos opcionales `labor[].overtime`, `labor[].overtimeBilled`, `indirect.mode`, `indirect.items`, `settings.indirectPolicy` y fuente de base `'offer'`. Una versión anterior abre los datos v7 en sólo lectura.

## [0.6.0] - 2026-10-12

**Unidades de facturación según el tipo de servicio.** Elegir "Servicio por unidad producida" ya no deja sólo $/día, $/hora o $/mes: cada tipo de servicio ofrece sus unidades (m³, viaje, tonelada, km, llamado, turno, trabajo, hito… y siempre una propia), la actividad se carga en esa unidad y el equilibrio se lee en ella ("6.000 m³ para no perder"). Motor generalizado a **cantidad facturable × precio por unidad** con los costos calculados por días de trabajo (**unidad de costo ≠ unidad de venta**). **Esquema de datos 6** (`migrateV5ToV6`: sin cambios de datos). Plan: PLAN-2026-009; fórmulas en [docs/CALCULATION_RULES.md §12.1](docs/CALCULATION_RULES.md#121-unidad-de-facturación-según-el-tipo-de-servicio-plan-2026-009).

### Agregado

- Unidades por tipo de servicio, con "Otra / personalizada" siempre: on-call ($/día, $/hora, $/llamado o salida, $/mes); permanente ($/mes, $/día, $/hora, $/turno); cuadrilla ($/día, $/hora, $/turno, $/mes); equipo con o sin operador ($/día, $/hora, $/mes, $/viaje); por unidad producida ($/unidad, $/m³, $/tonelada, $/kg, $/metro, $/m², $/km, $/lote); transporte ($/viaje, $/km, $/tonelada, $/ton-km, $/m³, $/hora, $/día); llave en mano y precio cerrado ($ global por trabajo, $/hito); horas y materiales ($/hora, $/día); configurable (todas).
- Unidad propia: se escribe el nombre ("pozo", "muestra") y la cotización cobra "$/pozo" y pregunta "¿Cuántos pozos esperás facturar por mes?".
- Actividad en la unidad comercial: cantidad a facturar por mes y cantidad por día de trabajo (rendimiento); por llamado o trabajo, cuántos por mes y cuántos días de trabajo lleva cada uno (y hitos por trabajo). RATEOS deriva los días de trabajo, que son los que consumen personal, equipos y combustible, y avisa si superan los días disponibles.
- Cantidad de equilibrio en la unidad ("Viajes para no perder: 20 viajes", "Unidades para no perder: 200 u."), con sus días de trabajo y "Ver cálculo" por unidad (costo variable y contribución por m³, viaje…).
- Horas y materiales: opción **"Facturo los materiales aparte (al costo más un recargo)"** en Materiales (marcada al elegir ese tipo de servicio): lo que se cobra por los materiales (costo × (1 + markup de reventa)) suma a la facturación; el costo no cambia.
- Golden cases A–E (`unidad-bombeo-m3`, `unidad-transporte-viaje`, `unidad-movimiento-suelo-m3`, `unidad-inspeccion-unidad`, `unidad-on-call-dia`) y tests del motor y de los textos por unidad.

### Cambiado

- Al elegir el tipo de servicio, la unidad pasa a la habitual de ese tipo (por ejemplo $/unidad o $/viaje) si todavía no hay tarifa ni mínimo por llamado cargados; si ya los hay, no se cambia (el número se leería en otra unidad) y se avisa.
- Cambiar de unidad con una tarifa cargada entre unidades sin conversión segura (por ejemplo de m³ a toneladas) pide borrarla o cancelar; día ↔ hora se sigue convirtiendo.
- Resultado, "El precio", resumen en vivo, matriz, gráfico, sensibilidad, escenarios y listado muestran tarifas "/ m³", "/ viaje"… y cantidades en la unidad; nunca "/ día" si no se cobra por día. El mínimo por llamado se carga en la unidad (m³, viajes…) y no aplica por llamado o trabajo.
- Los descuentos por cantidad de días se aplican sólo con tarifa por día u hora (con otras unidades se explica que no aplican; los tramos quedan guardados).
- Una unidad que no es habitual para el tipo de servicio (por ejemplo $/día en "por unidad producida") calcula igual y muestra "Revisá cómo cobrás".
- **$/día, $/hora y $/mes calculan exactamente igual que antes** (comparación completa de 99 casos idéntica). En "Ver cálculo" el rótulo "Unidades facturables (mess)" se corrige a "(meses)".

### Datos

- `SCHEMA_VERSION` 5 → 6. `migrateV5ToV6` no cambia ni borra datos; una versión anterior abre los datos v6 en sólo lectura (no calcula "por día" una cotización por m³). Campos nuevos opcionales: `quote.unitName`, `activity.billableQuantityPerMonth`, `activity.unitsPerActiveDay`, `activity.unitsPerActivation`, `pricing.materialsBilledSeparately`.

## [0.5.1] - 2026-10-12

Servicios y productos en una misma experiencia de costeo y precio. **Sólo interfaz, navegación y textos**: no cambia ninguna fórmula, ningún motor, el esquema de datos (sigue en 5), Supabase ni RLS. Cotizaciones y productos siguen siendo modelos distintos por debajo.

### Cambiado

- El botón principal del menú pasa de "+ Nueva cotización" a **"+ Nuevo cálculo"** (`#/nuevo`), que pregunta primero **"¿Qué querés calcular?"**: **Servicio** ("Calculá cuánto cuesta prestar un servicio y cuánto deberías cobrar.") lleva a la pantalla de siempre para elegir el servicio y su tipo (on-call, permanente, cuadrilla, equipo con operador, transporte, llave en mano, precio cerrado…); **Producto** ("Calculá cuánto cuesta producir cada unidad y a qué precio venderla según el margen que buscás.") lleva al editor de productos existente.
- **Inicio**: "¿Qué querés calcular hoy?" con dos accesos, **[Nuevo servicio]** y **[Nuevo producto]**.
- "Nuevo servicio" y "Nuevo producto" muestran "Inicio / Nuevo cálculo" en la ruta de navegación y un enlace para cambiar al otro tipo de cálculo.
- Bienvenida: "Calcular un servicio", "Calcular un producto" o "Configurar recursos".
- Landing y textos públicos: "Sabé cuánto te cuesta. Definí cuánto cobrar." para servicios, contratos, productos, producción y comercio (sin limitarse a Oil & Gas); "Empezar a calcular" lleva a "¿Qué querés calcular?".
- El menú lateral sigue con Cotizaciones, Productos, Recursos, Servicios y Escenarios.

## [0.5.0] - 2026-10-11

**Productos**: además de servicios, RATEOS calcula el costo y el precio de un producto (chipá, facturas, viandas…) paso a paso. Motor nuevo (las cotizaciones **no cambian**: mismas fórmulas y mismos números) y **esquema de datos 5** (`migrateV4ToV5` agrega `products: []`, con copia previa). Plan: PLAN-2026-008.

### Agregado

- Sección **Productos** en el menú, con lista (costo por unidad, precio sugerido, margen, equilibrio y estado), duplicar y eliminar, y un **ejemplo "Chipá"** con valores ILUSTRATIVOS.
- Editor en 7 pasos: **El producto** (tanda, pérdida, ventas por mes) → **Ingredientes y materiales** (por tanda o por unidad; g ↔ kg, ml ↔ l, unidad ↔ docena; precio por unidad o del paquete; merma) → **Personal** (sueldo, convenio y cargas, minutos por tanda) → **Máquinas y equipos** (uso por tanda: luz o gas y mantenimiento; tenencia: amortización y seguro como fijo del mes con el % que decide la empresa) → **Gastos fijos** (alquiler, servicios, contador… con el % para el producto) → **Precio y margen** (margen sobre el precio, impuestos sobre la venta, redondeo hacia arriba, IVA opcional y precio de hoy) → **Resultado** (costo por unidad, precio piso, precio sugerido, ganancia por unidad, equilibrio en unidades por mes, resultado del mes y análisis del precio actual). "Así va tu producto" en vivo en cada paso y "Ver cálculo" en cada número.
- Personal: cuántas horas del mes dedica cada persona a este producto (por ejemplo "75 h de las 176 h que trabaja") y aviso si las ventas necesitan más horas de las que hay. Es informativo: el costo sigue siendo por minuto de tanda.
- Traer personal, equipos y materiales de **Recursos** con copia: si el recurso cambia, el producto avisa y se elige [Actualizar en este producto] o [Conservar valor original].
- Convenios: tipos **Empleados de Comercio (CCT 130/75)**, **Panaderos / pasteleros** y **Gastronómicos** (sólo nombres; los parámetros siguen siendo los de cada empresa o los genéricos ILUSTRATIVOS).
- Golden case `producto-chipa-costo-y-precio.json` (costo $ 345, precio $ 492,86 con 30 % de margen, equilibrio 848,7 u/mes) y tests del motor, de la migración v4 → v5, del repositorio y de la interfaz. Fórmulas en [docs/CALCULATION_RULES.md §23](docs/CALCULATION_RULES.md#23-productos-costo-por-unidad-y-precio-plan-2026-008).

### Cambiado

- Esquema de datos **4 → 5**: agrega la lista de productos; no cambia ni borra ningún dato. La versión 0.4.x abre los datos v5 en sólo lectura.
- Textos de la landing, Inicio y README: "servicios y productos".
- Formulario de impuestos sobre la facturación: textos propios cuando se usa en un producto.

### Corregido

- Antes de publicar: guardar o eliminar un producto en una cuenta se subía a la nube recién con la siguiente escritura de otra cosa. Ahora se sube enseguida, como el resto, y un test verifica que **toda** escritura del repositorio local se sincroniza con la cuenta.

## [0.4.1] - 2026-10-06

Cierre del MVP: revisión completa (sólo errores) después de publicar 0.3.0 y 0.4.0. **No cambia ninguna fórmula**, ningún motor ni el esquema de datos (sigue en 4).

### Corregido

- **Deploy:** producción ya no puede volver atrás sola. Cada corrida elige el commit de `main` al empezar. Un deploy de `/preview/` que arrancaba antes de un merge y terminaba después volvía a publicar en producción la versión anterior de `main`. Ahora el job `deploy` vuelve a leer el último commit de `main` justo antes de publicar y, si cambió, no publica: lo hace la corrida del commit nuevo. Un rollback pedido a mano sigue publicando el commit o tag pedido. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- `.agent/PLANS.md`: los planes ya mergeados (001, 002 y 007) figuraban "en curso". Se agrega la lista de pendientes de UX y funcionalidades registrados en el cierre, sin implementar.

## [0.4.0] - 2026-10-06

Mantenimiento y neumáticos con forma de carga (PR #15).

Corrige una UX que inducía errores: un mantenimiento mensual o anual cargado en el campo "$/h" se interpretaba como costo por hora (caso real: autoelevador con $ 3.000.000 "por hora" → $ 360.000.000 en 15 días). **Cambia el motor de equipos** (formas de carga nuevas) y **sube el esquema de datos a 4** (sin cambios de datos). Con los datos existentes **ningún número cambia**: sin forma de carga se sigue usando "por hora" (golden cases, baseline y migración con los mismos resultados). Plan: PLAN-2026-007.

### Agregado

- **Mantenimiento**: costo por hora de uso; **service** (costo cada N horas de uso → $/h); o **presupuesto mensual o anual** → costo FIJO de tenencia (se suma a la posesión; nunca se divide por horas).
- **Neumáticos**: costo por hora; **juego + vida útil en horas** (→ $/h); **juego + vida útil en km** para equipos de ruta (→ $/km, se suma al desgaste en ruta de la movilización).
- "**Así lo calcula RATEOS**" en vivo, antes de guardar, en el legajo del equipo y en la línea de la cotización (por ejemplo "$ 600.000 cada 250 h = $ 2.400 por hora de uso" o "$ 3.000.000 por mes de COSTO FIJO de tenerlo").
- **Avisos de sentido común** (no bloquean ni corrigen): "Revisá este valor. Con el mantenimiento cargado, 100 horas de uso cuestan más que el valor del equipo. ¿Seguro que el importe está expresado por hora?"; mantenimiento o neumáticos desproporcionados; presupuesto anual mayor que el equipo; neumáticos por km absurdos; residual mayor que reposición; vida útil 0; falta el intervalo del service o la vida útil del juego. En la cotización se ven siempre (fuera de las opciones avanzadas).
- Tests de migración: el número (código) de cada cotización no cambia en v2 → v3 → v4 ni en v3 → v4, y una cuenta v3 en la nube pasa a v4 con copia previa en el navegador y los mismos resultados.
- Tests de la regla on-call: con 1, 15 o 30 días trabajados, la amortización, el seguro, la patente, las certificaciones, el mantenimiento por presupuesto y el costo de capital cuentan el mes completo (15 días ≠ 50 % del fijo); combustible, neumáticos y operación crecen con el uso.

### Cambiado

- Esquema de datos **4** (`migrateV3ToV4`: no cambia datos; copia previa automática). Una versión anterior abre los datos v4 en sólo lectura.
- Los datos cargados no se modifican: un valor guardado "por hora" sigue siendo por hora hasta que la persona lo cambie.

### Seguridad

- `supabase/tests/rls_admin_test.sql` corre también con el bootstrap del master ya consumido (la base de producción): usa como RATEOS ADMIN a la cuenta que lo consumió, sin que su id salga del bloque, y verifica que el bootstrap no se pueda volver a usar. Siguen siendo 32 controles y todo se deshace al terminar.

## [0.3.0] - 2026-10-06

Carga inicial de empresa, recursos y personal (PR #14). Iteración corta de UX y catálogos para la carga inicial de empresa, recursos y personal. **No cambia ninguna fórmula**, ningún motor ni el esquema de datos (`schemaVersion` sigue en 3): los campos nuevos son descriptivos y opcionales.

### Agregado

- **Sector de la empresa buscable** (Bienvenida y Configuración → Tu empresa): 20 sectores amplios tomados de las secciones de la ClaNAE (INDEC; el CLAE de ARCA usa las mismas), con "Petróleo y gas" aparte de "Minería" y **Otro / Personalizado**. Se busca sin tildes y por palabras clave ("petróleo", "Vaca Muerta", "camiones"…). No se cargan códigos fiscales. Catálogo en `js/domain/industry-catalog.js`; componente `searchSelectField` (combobox accesible) en `js/ui/components.js`.
- **Actividad / especialidad** (opcional, texto libre con sugerencias según el sector: servicios al pozo, transporte de cargas, mantenimiento industrial, construcción civil, servicios ambientales, montaje, ingeniería, limpieza industrial…). Se guarda en `organization.activity`; pasa a la empresa propia al "Empezar en limpio" y al importar el modo local.
- **Catálogo de equipos ampliado** a 29 familias (se suman camión atmosférico / vacío, batea, tanque, cargadora frontal, motoniveladora, equipo de soldadura y torre de iluminación) con **variantes descriptivas sugeridas** (p. ej. Vactor 5 / 10 / 12 / 15 yd³, camión tractor 4x2 / 6x2 / 6x4, semirremolque 3 ejes tándem / 1+2 / 1+1+1 / sider / carretón / batea / tanque). Sin precios, consumos ni especificaciones económicas.
- **Mis equipos**: sección "¿Qué equipo es?" (familia → variante → nombre) y campo **Capacidad / especificación** (`capacity`, opcional). Elegir una variante completa la capacidad y, si el nombre está vacío, sugiere el nombre; todo queda editable y "Personalizado" deja escribir la propia. La capacidad se ve en la lista. Los modelos del Catálogo usan las mismas sugerencias.

### Cambiado

- **Personal**: el sueldo y su base económica van juntos en "Sueldo y base económica (por persona)": **Sueldo básico mensual · Período base (mes del sueldo) · Fuente · Referencia** (antes la base estaba al final del formulario). La lista de Personal tiene la columna **"Base del sueldo"** ("Base: sep-26" o "Base no definida"), también en la vista de tarjetas.
- Familias renombradas para que se entiendan solas: "Vactor / camión combinado", "Carretón" (la batea es ahora su propia familia), "Camioneta", "Compresor / motocompresor", "Otro / Personalizado". Los ids no cambian: los equipos guardados siguen en su familia.
- Tipos de empresa anteriores: "Servicios petroleros" se lee como sector *Petróleo y gas* y "Mantenimiento industrial" como *Industria manufacturera*, con esa descripción como actividad; el dato guardado sólo cambia cuando la persona edita el sector o la actividad.

## [0.2.0] - 2026-10-05

Tres cambios en esta versión:

1. **Rediseño de experiencia de usuario**: simple en la superficie, potente por debajo. No cambia ninguna fórmula económica. Ninguna capacidad se eliminó: lo avanzado quedó colapsado o en pantallas secundarias. Guía en [docs/UX.md](docs/UX.md).
2. **Impuestos sobre la facturación con gross-up exacto** (PLAN-2026-002, a partir del análisis conceptual de una estructura de costos profesional: [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md)). **Es un cambio de regla de negocio** y **sube el esquema de datos a 2** (con migración). Con los impuestos sin definir —el estado de todas las cotizaciones existentes y de la demo— **ningún número cambia** (baseline de regresión). Detalle abajo.
3. **Usuarios reales con Supabase** (PLAN-2026-003): cuentas con Supabase Auth, datos de cada empresa en la nube protegidos con Row Level Security y demo pública aislada. **No cambia ninguna fórmula** ni el esquema de datos (`schemaVersion` sigue en 2). Detalle en [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) y [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md).
4. **RATEOS ADMIN** (PLAN-2026-004): rol de plataforma separado de los roles de empresa, con un panel `#/admin` de **metadata** (usuarios, empresas, actividad). Administrar la plataforma ≠ leer los datos de los clientes: el admin no ve cotizaciones, costos, márgenes ni tarifas. **No cambia ninguna fórmula** ni el esquema de datos.
5. **Recursos con base económica, snapshots, equipos propios / externos y movilización** (PLAN-2026-005, versión **0.2.0**). **Sube el esquema de datos a 3** (con migración) y agrega reglas de cálculo nuevas para alquilados, tercerizados, movilización y moneda. Con los datos existentes **ningún número cambia** (baseline de regresión de 21 casos y migración v2 → v3 con los mismos resultados). Detalle en [docs/RESOURCE_MODEL.md](docs/RESOURCE_MODEL.md): RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN.

### Agregado

- **Versión visible** en el menú lateral, la landing y Configuración → Acerca de: "v0.2.0 · build abc1234 · fecha" (para saber si estás viendo la versión actualizada). `package.json` pasa a 0.2.0.
- **Base económica** en cada valor económico (sueldos, valor y costos de equipos, tarifas externas, materiales, combustible, tipos de cambio): mes, moneda, fuente y referencia, visible como **"Base: sep-26"** o **"Base no definida"** (nunca se inventa una fecha).
- **Snapshot por línea de cotización**: cada línea guarda qué copió de Recursos y cuándo ("De Recursos · copiado el …"). Si después cambia el recurso: "El costo de X fue actualizado desde que hiciste esta cotización." con valor utilizado vs valor actual y **[Actualizar en esta cotización] [Conservar valor original]**. La cotización nunca cambia sola.
- **Base económica de la oferta**: fecha de la oferta (`quote.offerDate`) como base general, base por rubro y avisos "Esta cotización usa valores con diferentes fechas base", bases de más de 6 meses y valores sin base (en "Tipo de servicio" y en Resultado → Profundizá).
- **Recursos**: pestañas **Servicios externos** y **Catálogo de equipos**. Catálogo de 22 familias (vactor, hidrogrúa, carretón, retro…, sólo descriptivo y sin precios) + modelos propios de la empresa; **Mis equipos** con legajo por unidad (interno, modelo, dominio, obtención, valor, costos, operación, movilidad) con divulgación progresiva.
- **Equipos propios, alquilados o tercerizados**: tarifa NETA del proveedor por hora, día, mes, viaje, km, llamado o global, con mínimo; qué incluye (operador, combustible, movilización, seguro) y **tratamiento fiscal** (IVA y si es recuperable Sí / No / Parcial, percepciones, cargos no recuperables, plazo de pago). Costo económico ≠ salida de caja ≠ crédito fiscal. Motor `js/engines/external-engine.js`.
- **Movilización del recurso principal** ("¿Cómo llega cada equipo al lugar del servicio?": por sus propios medios, lo transporta otro equipo, con un vehículo de apoyo, no requiere) separada de la **logística auxiliar**. Si maneja su operador no se suma otra persona; el desgaste por km no incluye amortización. Motor `js/engines/mobilization-engine.js`. El paso "Viajes" pasa a llamarse **"Movilización y viajes"**.
- **Moneda y tipo de cambio**: valores en USD o EUR se convierten con el tipo de cambio PROPIO de cada cotización (lo carga la empresa); sin tipo de cambio no se suman y la cotización queda en rojo. Configuración: fecha base del combustible y tipos de cambio por defecto. Motor `js/engines/currency-engine.js`.
- Operador asignado a cada equipo (de los puestos de Personal), con aviso si la tarifa del proveedor ya incluye operador.
- Reglas de completitud nuevas: `mobility`, `external_terms`, `duplicates`, `economic_base`, `base_age`, `currency` ([CALCULATION_RULES.md §19](docs/CALCULATION_RULES.md#19-cost-completeness-score)).
- Golden cases: `externo-alquiler-iva-recuperable`, `externo-alquiler-iva-no-recuperable`, `externo-minimo-por-llamado`, `movilizacion-autopropulsada-160km`. Tests de integración de los casos A–F (`tests/engines/resource-cases.test.js`).
- **Staging seguro**: en `/preview/` y en el servidor local (que comparten la base con producción) la app pregunta antes de actualizar el formato de los datos de una cuenta ("Versión de prueba: ¿actualizar el formato de tus datos?") o de crear el espacio de una cuenta nueva; si no, los abre en sólo lectura sin escribir nada.
- Recursos en otra moneda: la ficha de un equipo en USD se calcula con el tipo de cambio por defecto de Configuración (si no hay, se informa en lugar de mezclar dólares con pesos); los costos de materiales se muestran en su moneda.
- Al importar datos del modo local, los tipos de cambio y la fecha base del combustible de la cuenta no se pisan con valores vacíos.
- Un backup con plantillas mal formadas se rechaza al importarlo (antes fallaba después, al crear la cotización).
- Deploy de staging: un deploy de `/preview/` atrasado (cola de runners o re-run de un CI viejo) ya no puede pisar uno más nuevo; antes de publicar se verifica que el commit siga siendo el último de la rama.
- **RATEOS ADMIN** (rol de plataforma): panel `#/admin` con usuarios totales, organizaciones totales, usuarios registrados en los últimos 7 / 30 días y workspaces activos, más una tabla de usuarios (nombre, email, empresa, rol de empresa, fecha de alta, última actualización). La entrada "RATEOS Admin" del menú y la insignia "RATEOS ADMIN" en la cuenta sólo aparecen si la base confirma el rol; un usuario normal que entra a `#/admin` ve "No tenés permisos para acceder a esta sección.". Migración `supabase/migrations/20261005034916_rateos_platform_admin.sql` (tablas en `private`, funciones `am_i_platform_admin` / `admin_overview` / `admin_users`, auditoría `ADMIN_PANEL_OPEN`). Detalle en [docs/AUTH_ARCHITECTURE.md §6.1](docs/AUTH_ARCHITECTURE.md#61-rol-de-plataforma-rateos-admin).
- **Staging público en `/preview/`** del mismo GitHub Pages: producción (`/COTIZADORWEB/`) se construye siempre desde `main`; `/preview/` desde la rama de desarrollo (cuando su CI pasa), con la franja "RATEOS · STAGING · rama · build", `noindex` y "[STAGING]" en el título. Un deploy de preview nunca reemplaza producción: el workflow se lee siempre de `main`, la raíz sólo publica commits de `main` y `scripts/stage-preview.mjs` falla si cambia un archivo de producción. El código de la rama se construye sin permisos de escritura. Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#githubworkflowsdeploy-pagesyml--deploy-rateos-a-github-pages).
- **Impuestos sobre lo que facturás** (Ingresos Brutos, débitos y créditos, sellos, otros cargos sobre lo facturado). No son costo: se pagan sobre el precio, así que se cubren con un gross-up exacto junto con el margen: `facturación necesaria = costo / (1 − margen − impuestos)`. Costo 100, margen 10 %, impuestos 10 % → **125** (no 121 ni 123,46); tarifa piso 111,11. Se cargan como "Un % total" o "Detalle por impuesto" (excluyentes) o se elige "No incluir impuestos sobre la facturación en esta cotización" (una elección de cálculo, no una afirmación fiscal). **RATEOS no trae alícuotas**: sin definir, la tarifa piso no los incluye y se avisa. Valor de la empresa (`settings.defaultBillingTaxes`) para cotizaciones nuevas. Fórmulas en [docs/CALCULATION_RULES.md §13.1](docs/CALCULATION_RULES.md#131-impuestos-sobre-la-facturación-gross-up).
- **"¿Cómo se forma tu precio?"** en el Resultado (desplegable de "Profundizá", cerrado por defecto): de cada $ 100 que facturás, cuánto es costo, cuánto impuestos sobre lo que facturás y cuánto ganancia (100 % del precio; la estructura de costos sigue sumando 100 % del costo). "Ver apropiación y total del contrato": cuánto de cada día (u hora, o mes) cobrado va a cada rubro, a impuestos y a ganancia —suma la tarifa neta; ÷ factor de descuentos = tarifa de lista— y el total del contrato. "Los números cierran" en "Ver cálculo completo": controles automáticos de cuadre. Motor `js/engines/price-composition-engine.js` (`priceComposition`), sin fórmulas en la interfaz.
- `js/engines/billing-taxes-engine.js` (`billingTaxInfo`, `billingTaxConfigInfo`, `traceBillingTaxes`), `js/domain/billing-taxes.js` (forma de los datos) y en `pricing-engine` `priceFromMarginAndTaxes`, `markupWithTaxesPct`, `profitOnCostPct`, `isValidMarginAndTaxes`, `readMarginInput`. Nuevos KPIs: `billingTaxes`, `billingTaxPct`, `billingTaxesDefined`, `billingTaxesInvalid`, `targetMarginInvalid`, `targetMarkupPct`, `targetProfitOnCostPct`, `profitOnCostPct`, `priceToCostMultiplier`; traza "Impuestos sobre lo que facturás".
- **Convención de montos explícita: "Montos sin IVA"** (`quote.vatTreatment = 'excluded'`, `VAT_TREATMENTS` en el catálogo). RATEOS siempre calculó sin IVA; ahora cada cotización lo declara, el editor lo muestra al empezar ("Esta cotización usa costos, precios y tarifas sin IVA: si tenés un valor con IVA, descontalo antes de cargarlo") y en cada etapa, y los formularios de equipos, materiales y combustible lo aclaran. Una cotización con otra convención no se calcula en silencio: `validateQuote` informa un error. Preparado para soportar otra convención en el futuro sin cambiar la forma de los datos.
- Regla de completitud `billing_taxes` (peso 1): naranja si están sin definir, rojo si hay un % inválido.
- Validación: cada impuesto entre 0 y < 100 %, total < 100 % y margen + impuestos < 100 % ("Con X % de impuestos sobre la facturación, el margen tiene que ser menor a (100 − X) %").
- Golden cases: `gross-up-impuestos-facturacion` (125), `tarifa-piso-con-impuestos` (111,11), `markup-con-impuestos` (25 %: precio 125 = costo 100 × 1,25), `ganancia-sobre-costo-con-impuestos` (12,5 %), `on-call-break-even-con-impuestos` (11,54 días), `on-call-tarifa-minima-6-dias-con-impuestos` (6.666.666,67) y `on-call-cotizacion-con-impuestos` (piso 4.444.444,44, objetivo 5.000.000, resultado 10 %). Tests de invariantes: facturación = costo + impuestos + resultado.
- **Red de seguridad** `tests/engines/regression-baseline.test.js` + `tests/fixtures/baseline-v1.json`: con impuestos sin definir, KPIs, EECC, matriz y tramos de 21 casos (demo, referencia, plantillas y variantes sintéticas) son idénticos a los del motor anterior.
- [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md): lógica conceptual de una estructura de costos profesional y decisiones de diseño, sin datos de la planilla de referencia (privada, fuera del repo). Las planillas (`.xls`, `.xlsx`, `.ods`…) quedan excluidas por `.gitignore` y un test de arquitectura.

- **Sitio público separado de la aplicación.** Landing en `#/` ("Cotizá servicios sabiendo cuánto te cuestan."), con mockup del producto calculado en vivo sobre la demo ILUSTRATIVA, tres resultados (cuánto te cuesta, cuánto cobrar, cuánto necesitás trabajar), "¿Te pasa esto?", cómo funciona en 3 pasos y para quién.
- **Demo guiada** `#/demo` de "Hidrogrúa on-call — Añelo" en 4 pasos antes del análisis completo, con un selector de días activos que recalcula la tarifa piso sin guardar cambios. `QuoteService.ensureDemoQuote()` vuelve a crear la demo si se había borrado (con un código nuevo; nunca reutiliza códigos).
- **Ingresar / Crear cuenta / Bienvenida** (`#/login`, `#/registro`, `#/bienvenida`). Primero fueron un flujo preparado sin cuentas; en esta misma versión pasaron a ser **cuentas reales** (ver abajo). El onboarding guarda el tipo de empresa (`organization.industry`, campo opcional) y la base operativa.
- **Cuentas reales (Supabase Auth):** registro con nombre, empresa, email y contraseña (mínimo 8), **confirmación de email** ("Revisá tu email"), ingreso, cierre de sesión y recuperación de contraseña, con mensajes humanos (nunca errores técnicos). Enlaces de email PKCE bajo `/COTIZADORWEB/` compatibles con el router por hash (`?auth=confirm&next=…` antes del `#`; el código se limpia de la URL). La sesión se restaura al recargar; si vence: "Tu sesión terminó. Volvé a ingresar." sin perder los cambios. SDK oficial `@supabase/supabase-js` 2.117.2 vendorizado (`js/data/vendor/`, hash verificado; sigue sin dependencias npm).
- **Base de datos** (migración `supabase/migrations/20261005013833_rateos_identity_workspace.sql`, aplicada con el plugin de Supabase): `profiles`, `organizations`, `organization_members` (OWNER / ADMIN / ESTIMATOR / VIEWER) y `workspace_states` (estado versionado de cada empresa con `revision`). Al registrarse se crean la empresa, la membresía OWNER y un espacio de trabajo **vacío**. **RLS en todas las tablas**, sin permisos para `anon`, `update` sólo por columna, columnas de control fijadas por trigger. Tests: `supabase/tests/rls_test.sql` (40 controles, usuarios A/B, anon, escalada de rol) y `tests/supabase/migrations.test.js`.
- **Tres estados separados:** visitante (landing, ingreso, registro, recuperar contraseña), **demo** sin cuenta (`#/demo`, `#/demo/analisis`, en memoria: nunca escribe en el navegador ni en la nube) y usuario autenticado (`#/inicio` y toda la app). Las rutas protegidas sin sesión van a `#/login?next=…` (sólo destinos internos) y no se muestra nada protegido mientras se restaura la sesión.
- **`SupabaseRepository`:** mismo estado y validaciones que el modo local, guardado en la nube con **control de revisión** (nunca *last-write-wins* silencioso: "Tus datos cambiaron en otro dispositivo." con [Recargar] [Conservar una copia]); sin conexión: "No pudimos sincronizar tus cambios.", copia local recuperable y reintentos; "Guardado" sólo cuando la nube lo confirmó. Estado de sincronización en el menú lateral.
- **Datos del modo local → cuenta:** "Encontramos datos guardados en este navegador." con [Importarlos a mi cuenta] [Empezar en limpio]. Nunca importa la demo, la empresa ficticia ni datos ILUSTRATIVOS; guarda una copia antes y nunca borra `rateos.state`. Un backup importado en una cuenta queda siempre dentro de la empresa de esa cuenta.
- **Cuenta nueva vacía:** "Hola, <nombre>. ¿Qué querés hacer primero?" con [Crear mi primera cotización] [Configurar mi empresa] y la demo opcional; la empresa real en el menú. Zona de cuenta en el menú lateral (nombre, email, rol, "Mi cuenta", "Cerrar sesión") y **Configuración → Cuenta** (nombre editable, email, empresa, rol, cambiar contraseña, cerrar sesión).
- Landing: "Crear una cotización" lleva a crear la cuenta y después a la cotización nueva (con sesión, directo); el encabezado dice "Ingresar / Crear cuenta" o "Abrir RATEOS".
- Pantalla **Escenarios** (`#/escenarios`, `#/escenarios/:id`) para analizar sensibilidad, escenarios y modelos comerciales de una cotización sin modificarla.
- Componentes de interfaz: `disclosure`, `bigStat`, `pageIntro`, `linkButton`, `stepIndicator` y `emptyState` con título, texto y acción. `formatMoneyCompact` ("$ 15,8 M", hacia arriba para tarifas). `QuoteService.latestDraft()`.
- [docs/UX.md](docs/UX.md): principios, arquitectura de información, copy y checklist de carga cognitiva.

### Cambiado

- **Esquema de datos 2 → 3** (`migrateV2ToV3`, con copia de recuperación previa): todo valor existente queda con "Base no definida" y la moneda de la empresa; equipos con familia (desde el tipo anterior), obtención "propio" y movilidad sin definir; nuevas colecciones `resources.externalServices` y `resources.equipmentModels`; líneas con snapshot `legacy`; cotizaciones con `currency`, `offerDate` (= fecha de creación) y `exchangeRates`. Ningún número cambia. Una pestaña con la versión anterior abierta pasa a sólo lectura al ver datos v3.
- **EECC con 9 categorías**: "Equipos" pasa a "Equipos propios" y se agrega "Equipos y servicios externos" (0 en los datos existentes). La incidencia mostrada sigue sumando 100,00 %.
- El indicador logístico pasa a "Movilización y viajes" (movilización de equipos + logística auxiliar); la demo carga la hidrogrúa y la pickup como movilización por sus propios medios (mismos números).
- **Completitud**: las reglas nuevas suman peso; la demo pasa de 93,48 % a 94,44 % (caso de referencia y cotización en blanco sin cambios). La regla `logistics` acepta como "algo se mueve" un equipo con movilización definida o un externo con movilización incluida; `equipment_cost` pide tarifa > 0 a los externos.
- Equipos propios: "Otros costos anuales de tenerlo" (`otherAnnual`: habilitaciones, GPS…) dentro de la posesión en efectivo (0 en los datos existentes).

- **Regla de negocio — tarifas con impuestos sobre la facturación** (sólo cuando la cotización los define; con `t = 0` todo queda igual):
  - Tarifa piso = costo / (1 − t); precio objetivo = costo / (1 − margen − t); resultado = facturación × (1 − t) − costo; margen = resultado / facturación (antes del impuesto a las Ganancias); markup = precio / costo − 1 = (m + t) / (1 − m − t) (AGENTS.md §9: costo 100, margen 10 %, impuestos 10 % → 25 %); ganancia sobre el costo = resultado / costo = m / (1 − m − t) (12,5 %), rotulada aparte: no es el markup.
  - Break-even: contribución por día = tarifa × (1 − t) − variable (caso básico con t 10 %: 11,54 días; sin impuestos sigue en **10 días**). Tarifa mínima para D días = (F / D + v) / (1 − t).
  - Matriz tarifa × días, tramos de descuento, escalera de precios, escenarios, sensibilidad y comparador de modelos usan el mismo t (el mínimo garantizado del comparador pasa a `Fijos / (1 − t)`).
  - Una tarifa que cubre el costo pero no los impuestos ahora es "bajo piso" (pierde plata).
- **Regla de negocio — margen objetivo inválido.** Un margen ≥ 100 %, negativo o no numérico, o margen + impuestos ≥ 100 %, ya **no** se reemplaza por 0 % en silencio: no hay precio objetivo ni tarifa sugerida, la cotización queda "con riesgo" y las trazas lo explican (antes la "sugerida" quedaba igual a la piso). Un margen vacío sigue calculándose con 0 % (y la completitud lo marca en rojo).
- **Completitud**: la regla nueva suma peso 1 a todas las cotizaciones. Con impuestos sin definir, la demo pasa de 95,45 % a 93,48 % y el caso de referencia de 78,57 % a 76,67 %; una cotización en blanco sube de 33,33 % a 34,21 %. Una cotización apenas por encima de 85 % o de 60 % puede cambiar de color o quedar "con riesgo" hasta que se definan los impuestos o se elija no incluirlos.
- **Esquema de datos 1 → 2** (`migrateV1ToV2`): cada cotización recibe `billingTaxes` sin definir y `vatTreatment: 'excluded'`, y la configuración `defaultBillingTaxes: null`; nada se borra (valores ajenos van a `legacy`) y antes se guarda la copia `pre-migration-v1`. Datos v1 con estructura inesperada se migran y reparan; el texto original queda en esa copia de recuperación. Una pestaña con la versión anterior abierta pasa a sólo lectura al ver datos v2. Los backups v1 se importan migrándolos.
- La aplicación arranca en `#/inicio`: "Hola. ¿Qué querés cotizar hoy?", continuar el último borrador, **3 indicadores** (cotizaciones activas, margen promedio, en riesgo) y "Tus cotizaciones"; el resto de los indicadores y atajos, colapsado.
- Menú lateral simplificado: Inicio, Cotizaciones, Recursos (personal, equipos, materiales, ubicaciones), Servicios, Escenarios y, separado, Configuración (empresa, parámetros económicos, convenios, datos y backup, acerca de). Navegación mobile con menú desplegable.
- Editor de cotización agrupado en **5 etapas** (El servicio, Los recursos, Las condiciones, El precio, Resultado) sobre los mismos 11 pasos internos y las mismas URLs; cada paso abre con una pregunta y por qué importa; datos principales separados de "Opciones avanzadas"; resumen en vivo reducido a 4 números.
- Resultado con nueva jerarquía: la primera vista responde sólo cuánto cuesta, cuánto cobrar (tarifa piso y sugerida), cuánto trabajar (frase con los días para cubrir los costos) y cuánto margen queda, con las alertas críticas. Todo lo demás va en "Profundizá", cerrado por defecto: "¿Cómo se forma tu precio?", "¿En qué se va el costo?" (rubros agrupados y estructura completa), reparto de la tarifa y total del contrato, matriz tarifa × días, escenarios, sensibilidad, reglas comerciales, margen vs markup, completitud y cálculo completo (se abren todos al imprimir).
- Copy revisado en castellano claro (p. ej. "¿Cuántos días por mes esperás trabajar?" en lugar de "factor de utilización").
- Sistema de diseño: escala tipográfica, espaciado, radios y sombras nuevos; acción principal en azul Neuquén profundo.
- Enlaces viejos (`#/biblioteca/...`, `#/dashboard`) redirigen a las rutas nuevas.

### Seguridad

- Los mensajes de datos dañados o no migrables ya no muestran claves internas de almacenamiento: indican "Configuración → Datos y backup → Copias de recuperación".
- El catálogo global de familias de equipos no contiene precios ni datos de clientes; marcas, modelos y valores son privados de cada organización.

- **RATEOS_ADMIN se decide sólo en Postgres** (`private.platform_admins` + `private.is_platform_admin()` con `auth.uid()`): ningún email, metadata, claim del JWT, `localStorage` ni `organizationId` del cliente da el rol, y no hay ningún email hardcodeado en el frontend (lo verifica un test de arquitectura). El alta del master es un bootstrap server-side de un solo uso que exige email **confirmado** y normalizado. Las funciones de admin vuelven a verificar el rol en cada llamada, nunca devuelven el contenido de un workspace, y las políticas RLS de los datos de clientes no cambiaron. Tests contra la base: `supabase/tests/rls_admin_test.sql` (32 controles).
- En el navegador sólo la URL de Supabase y la **publishable key**; un test busca en todo el repo `service_role`, secret keys (`sb_secret_…`) y connection strings con contraseña. RATEOS **no guarda contraseñas** en ningún lado.
- CSP: `connect-src` sólo `'self'` y el proyecto de Supabase.
- Revisión de seguridad adversarial de las cuentas, con correcciones: copias de recuperación por usuario y organización (otra persona en el mismo navegador no las ve ni las restaura; en pantalla sólo fecha y motivo), enlaces de email **sólo PKCE** (se rechazan los `?token_hash=`, que podían abrir la cuenta de otra persona en el navegador de la víctima), cerrar sesión borra siempre la sesión local aunque el SDK falle, cambio de usuario en otra pestaña reabre la cuenta correcta, `?next=` sin codificaciones ambiguas y RATEOS no funciona dentro de un iframe (anti-clickjacking).
- Si la base rechaza el token, se intenta renovar la sesión una vez; si no se puede, se cierra con "Tu sesión terminó. Volvé a ingresar." (los cambios quedan en la copia local).

### Corregido

- **Caché después de un deploy (cache busting).** GitHub Pages cachea cada archivo 10 minutos y los JS/CSS tenían URLs fijas: tras un deploy el navegador podía mezclar módulos viejos y nuevos (menú "Dashboard / Bibliotecas / Plantillas de servicio" con "Acerca de" mostrando el build nuevo) y sólo Ctrl+Shift+R lo arreglaba. Ahora el build publica todos los JS, CSS y assets en `build/<sha corto>/`, `index.html` carga `boot.js`, que lee `version.json` sin caché y carga ese build completo (los imports relativos mantienen todo el grafo en la misma carpeta). `version.json` suma el manifiesto `build`. Si una pestaña abierta durante un deploy no puede cargar una pantalla, el botón pasa a ser "Recargar la página". Detalle en [docs/DEPLOYMENT.md §4.1](docs/DEPLOYMENT.md). No cambia ninguna fórmula ni el formato de los datos.

Revisión adversarial económica y de UX de esta versión (sin funcionalidades nuevas):

- **Markup con impuestos** (regla de negocio, AGENTS.md §9): el "markup" que se mostraba con impuestos era la ganancia sobre el costo (12,5 % con costo 100, margen 10 %, impuestos 10 %), pero el precio es 125 = costo × 1,25. Ahora "Markup (recargo sobre el costo)" = 25 % y "Ganancia sobre el costo" = 12,5 % por separado (escalera, "Margen vs markup", trazas y consejos del paso "El precio"). Sin impuestos no cambia nada (11,11 %).
- Un margen escrito como texto ("12,5") se lee igual que en la validación; uno inválido ya no se muestra como 0 % en avisos, comparador ni trazas.
- La tarifa piso distingue impuestos sin definir de impuestos inválidos; la composición del precio con pérdida suma 100 con 1 decimal; descuento del 100 % y 0 días explican por qué no hay composición; el semáforo de descuentos no dice "bajo el objetivo" si no hay margen objetivo válido.
- Configuración → Parámetros económicos guardaba mal los impuestos de la empresa al cambiar de modo (se perdían valores cargados): ahora se copian sin pérdida.
- Cambiar la unidad (día ↔ hora) convierte también el mínimo por llamado con las horas por día activo (antes 1 día pasaba a ser 1 hora); si no se puede convertir, se avisa.
- **Copy de impuestos sin afirmaciones fiscales**: "No incluir impuestos sobre la facturación en esta cotización" en lugar de "No pago impuestos sobre lo que facturo".
- Accesibilidad: "Ver cálculo" con nombre accesible por indicador, foco tras agregar o quitar renglones de impuestos, ayudas asociadas a las casillas, avisos con `role="status"`; alertas del resultado legibles en mobile.

## [0.1.0] - 2026-10-03

Primera versión funcional (MVP) de RATEOS — motor de costos y tarifas para servicios industriales. 100 % frontend (GitHub Pages + `localStorage`), sin backend, sin dependencias npm, sin analytics y sin IA. **Todos los datos demo son ILUSTRATIVOS.**

### Agregado

**Cotizaciones**

- Flujo de cotización de 11 pasos en orden fijo: tipo de servicio, modalidad, personal, equipos, materiales, logística, costos indirectos, financiamiento, riesgo / contingencia, margen y reglas comerciales, resultado.
- Dos modalidades: "Conozco la tarifa" (días mínimos, break-even, resultado y margen esperados) y "Conozco la actividad" (tarifa piso y tarifas con margen 5 %, 10 %, 15 % y personalizado).
- 11 tipos de servicio (on-call, permanente, cuadrilla, equipo con/sin operador, por unidad, transporte, llave en mano, time & materials, lump sum, configurable) y unidades de tarifa $/día, $/hora y $/mes.
- Crear cotizaciones en blanco o desde plantilla, duplicar, eliminar (con confirmación), estados (borrador, enviada, ganada, perdida, archivada) y códigos `COT-0001`…
- Editor con resumen en vivo, recálculo inmediato y guardado automático.
- Dashboard: cotizaciones activas, valor total cotizado, margen promedio, cotizaciones con riesgo y servicios bajo piso.
- Bibliotecas reutilizables: personal (perfiles), convenios parametrizables (Petroleros Privados, Petroleros Jerárquicos, Camioneros, UOCRA, Fuera de convenio, Personalizado), equipos con ficha $/hora · $/día · $/mes, materiales y ubicaciones.
- 12 plantillas de servicio (Cuadrilla 24/7, Hidrogrúa on-call, Transporte, Water Transfer, Servicio ambiental, Movimiento de suelo, Taller móvil, Inspección, Soldadura, Mantenimiento, Generador, Camión con chofer).
- Datos demo: Patagonia Servicios SRL (ficticia), cotización "Hidrogrúa on-call — Añelo" y "Caso de referencia on-call (prueba del motor)".

**Motor económico** (`js/engines/`, funciones puras)

- CostEngine: modelo `Costo(D) = F × factorMeses + v × D`; personal con factor de cargas, relevos (posiciones cubiertas), horas extra cargadas y vianda; equipos con costo de posesión vs operación, amortización y costo de capital; logística (km, litros, costo por activación, por día activo y mensual); materiales (merma, logística, proveedor, base de cálculo); otros costos; estructura con 6 métodos de absorción; standby.
- FinancialEngine: días financiados por grupo de pago, capital de trabajo, costo financiero e impacto en margen.
- Contingencia general + ítems de riesgo.
- Estructura de costos (EECC) en 8 categorías con monto e incidencia %; la incidencia mostrada suma exactamente 100 % (método del mayor resto).
- PricingEngine: margen vs markup diferenciados, conversiones, escalera de precios, redondeo comercial hacia arriba.
- CommercialRulesEngine: minimum call, standby, call-out fee, movilización, km adicional, fee de disponibilidad, mínimo mensual garantizado, descuento por tramos de días (1, 2–7, 8–15, 16–30, +30), descuento por continuidad y descuento comercial; semáforo verde / naranja / rojo por tramo.
- BreakEvenEngine: fórmula cerrada, problema inverso (tarifa mínima para N días) y búsqueda numérica robusta (grilla de 0,1 día + bisección) para reglas no lineales; días para margen objetivo.
- UtilizationEngine: utilización y matriz tarifa × utilización (5, 8, 10, 15, 20 días + actividad estimada).
- ScenarioEngine: sensibilidad con tarifa comercial fija (salarios, combustible, materiales, utilización, plazo de pago, descuento comercial), escenarios pesimista / base / optimista y comparador de 4 modelos comerciales.
- Cost Completeness Score con 14 reglas determinísticas y pendientes priorizados.
- Trazas "Ver cálculo" (costo total, break-even, tarifa piso, precio objetivo, resultado esperado, costo financiero, logística, margen vs markup).

**Datos y persistencia**

- `StorageRepository` (contrato asíncrono) con `LocalStorageRepository`; estado en `rateos.state` con `schemaVersion` 1.
- Migraciones explícitas (`migrateV0ToV1`), copias de recuperación automáticas (`rateos.recovery.*`), reparación de datos dañados sin borrarlos y modo sólo lectura ante datos de una versión más nueva.
- Exportar e importar backup JSON versionado, con validación, resumen y confirmación antes de sobrescribir.
- Pantalla de recuperación si la app no puede iniciar (descarga de los datos guardados tal cual).
- Entidades con UUID, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy` (preparadas para multiempresa).

**Calidad, build y despliegue**

- Suite `npm test` con el test runner de Node (≥ 20), sin dependencias: core, datos (migraciones, esquema, backup, repositorio), servicios, motores, golden cases en JSON (`tests/golden-cases/`), reglas de arquitectura y seguridad, build y sitio estático bajo `/COTIZADORWEB/`.
- `npm run build` genera `dist/` con `version.json` (versión, commit corto, fecha de build, ref) y valida que todas las rutas sean relativas; `npm start` sirve la app en `http://localhost:8080/COTIZADORWEB/` (`--dist` para servir el build).
- Workflow "Deploy RATEOS a GitHub Pages" (push a `main` y `workflow_dispatch` con `ref` para rollback, sólo commits o tags que ya están en `main`): test → build → deploy; no despliega si fallan los tests; permisos mínimos por job.
- Workflow de CI para pull requests y ramas; Dependabot para GitHub Actions.
- Versión visible en Configuración → Acerca de ("RATEOS · v0.1.0 · build abc1234").

**Documentación**

- README, AGENTS.md (constitución para agentes), CHANGELOG, `docs/ARCHITECTURE.md`, `docs/CALCULATION_RULES.md`, `docs/DEPLOYMENT.md`, `docs/DATA_MODEL.md`, `docs/AUTH_ARCHITECTURE.md`, `docs/SUPABASE_PLAN.md`, `docs/AGENT_ROLES.md`, `.agent/PLANS.md` y plantilla de Pull Request.

### Seguridad

- Content Security Policy estricta (`script-src 'self'`, sin inline ni terceros) y `referrer: no-referrer`.
- DOM sin `innerHTML`/`eval`/`new Function`; texto siempre con nodos de texto.
- Protección contra prototype pollution en rutas de edición y en backups importados; límite de 5 MB por backup.
- Logger centralizado sin contexto sensible en producción; eventos internos con lista blanca y sin envío a terceros.
- `.gitignore` excluye `.env*`, secretos y credenciales.

### Correcciones de la revisión multidisciplinaria

Antes del merge se hizo una revisión desde Economía, QA, Seguridad, Datos, UX y cumplimiento. Los hallazgos confirmados se corrigieron con tests de regresión (`tests/data/review-regressions.test.js` y tests de motores, core y servicios). **Los golden cases no cambiaron** y los resultados de las cotizaciones demo (costo, tarifas, facturación, break-even, completitud) son los mismos. Entre paréntesis, el identificador del hallazgo.

**Persistencia y datos**

- Varias pestañas (DATA-01, crítico): una pestaña con una copia vieja en memoria reescribía el estado completo y borraba cotizaciones creadas en otra, y reutilizaba códigos `COT-NNNN`. Ahora el repositorio relee `rateos.state` antes de cada lectura o escritura y adopta los cambios de otras pestañas (`syncFromStorage`); la pantalla se refresca con el evento `storage` (`ctx.onExternalChange`); los códigos usan el contador monotónico `settings.lastQuoteNumber` leído actualizado. Si otra pestaña con una versión más nueva migró los datos, se adoptan en sólo lectura; si el cambio es ilegible, error `stale_state` sin escribir. Limitación documentada: si dos pestañas editan la misma cotización a la vez, gana el último guardado.
- Almacenamiento lleno con datos guardados (DATA-02): ya no se abre la demo en memoria; `createRepository` lanza `quota_exceeded` y la app muestra la pantalla de recuperación para descargar los datos.
- Guardado que falla (DATA-03): el editor conserva el borrador sin guardar aunque se salga y se vuelva a entrar, pide confirmación al cerrar la pestaña y ofrece "Descargar backup con estos cambios" (un backup que sí incluye esos cambios). El mensaje de cuota explica cómo liberar espacio.
- Validaciones de importación (DATA-04, SEC-02): se rechaza un JSON sin versión que no tiene ninguna colección de RATEOS (por ejemplo, un `package.json`, que antes reemplazaba todo por una empresa vacía) y un backup v1 con colecciones de tipo incorrecto (antes se vaciaban en silencio).
- Copias de recuperación (DATA-05): se pueden eliminar desde Configuración (`deleteRecoverySnapshot`); una importación o restauración de la demo que falla por cuota ya no deja una copia huérfana.
- Datos dañados sin espacio para la copia (DATA-06): `init()` lanza `corrupt_no_space` y la app muestra la pantalla de recuperación (descargar los datos tal cual); antes abría la demo en sólo lectura y "Exportar backup" exportaba la demo.
- Modo memoria (DATA-07): el editor dice "Sólo en esta sesión (no se guarda)" en lugar de "Guardado".
- Copias `invalid` (SPEC-03): igual que las `corrupt`, se cuentan aparte con su propio cupo de 3; las importaciones posteriores ya no borran la única copia del original con estructura inválida.

**Seguridad**

- Forma de las cotizaciones (SEC-01): `validateState` revisa la forma interna de cada cotización (líneas como listas de objetos, sub-objetos como objetos); un backup con una cotización malformada se rechaza. Además, los motores ignoran líneas que no son objetos (`objectList`) y `QuoteService` marca con `{ error: true }` una cotización que no se puede calcular: una cotización mala ya no rompe el dashboard ni el listado.
- Deploy manual (SEC-03): el input `ref` sólo acepta commits o tags que ya están en `main` (`git merge-base --is-ancestor`); antes permitía publicar una rama sin mergear, sin PR. Procedimiento de rollback actualizado en `docs/DEPLOYMENT.md`.
- Permisos por job (SEC-04): el workflow sólo da `contents: read`; `build` agrega `pages: read` y sólo `deploy` tiene `pages: write` e `id-token: write`.
- Eventos internos (SEC-05): los enums sólo aceptan letras minúsculas y guion bajo (sin dígitos, así no pasan montos) y `serviceType` se normaliza al catálogo (`unknown` si no está).
- `.gitignore` (SEC-06): `secrets` (archivo o carpeta), `*credentials*`, `*credenciales*`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*service-account*.json` y `.npmrc`.

**Motor económico** (cambios de cálculo y qué resultados cambian; detalle en `docs/CALCULATION_RULES.md`)

- Semáforo de tramos con minimum call (ECO-01, §14): cada tramo se evalúa con la menor cantidad de días **activos** que alcanza su "desde" en días **facturables** (`minActiveDaysForBillableDays`). Cambian `evaluatedDays`, resultado, margen y color de los tramos **sólo** cuando el minimum call supera las unidades por activación. Ejemplo: referencia con minimum call 2 días y 20 % en 8–15 → el tramo 8–15 se evalúa con 4 días (resultado −8.400.000) y pasa de verde a **rojo**.
- `belowFloor` vs `belowFloorRate` (ECO-02, §20): `belowFloor` ("bajo piso: perdés dinero") exige ahora tarifa neta bajo el piso **y** resultado negativo; el nuevo `belowFloorRate` informa sólo lo primero. Cambia con mínimo garantizado que cubre el costo: referencia + mínimo 40.000.000 → resultado +2.000.000, antes `belowFloor = true`, ahora `false` (`belowFloorRate = true`); también el contador "servicios bajo piso".
- Sensibilidad y escenarios con días activos mayores a los disponibles (ECO-04, §17): sin variación de actividad los días no se tocan, y una variación nunca recorta por debajo de la base. Referencia con 35 días y 30 disponibles: sin variaciones Δ resultado pasa de −10.000.000 a 0; el optimista ya no da menos que la base.
- "No aplica standby" (ECO-05, §12): anula días, costo e ingreso de standby aunque los campos tengan valores. Cambian costo, otros ingresos y tarifas sólo en cotizaciones con standby cargado y "no aplica" marcado (demo con 4 días × 500.000 y "no aplica": tarifa piso neta de 1.795.180 a 1.972.062, la misma que sin standby).
- Margen sin tarifa comercial (ECO-06, §20): `kpis.marginPct` y `kpis.markupPct` son `null` si no hay tarifa comercial (antes se calculaban sobre otros ingresos, p. ej. −533,33 %) y ya no entran al margen promedio del dashboard.
- Traza de break-even (ECO-08, ECO-09, §15): la descomposición lineal (`result.linear`) y la traza se arman en el punto de equilibrio, donde rige el tramo que realmente aplica; la entrada se rotula "Ingreso por tarifa por día activo (tarifa neta por <unidad> × unidades del día)". El break-even no cambia; cambian las entradas mostradas (demo: tarifa neta 2.259.000 y contribución ≈ 1.415.864 en lugar de 2.191.230 y 1.348.094). Ejemplo de la documentación corregido.
- Traza de margen vs markup (ECO-10, §11): con 2 decimales (`money2`): $ 111,11 vs $ 110,00, diferencia $ 1,11.
- Comparador de modelos (ECO-13, §17): el fee de disponibilidad y el mínimo garantizado se prorratean con `factorMeses` igual que los costos fijos. Cambia sólo con días estimados mayores a los disponibles: "Fee + tarifa" pasa de 3,08 % a 10 % de margen (referencia con 35 días).
- Traza de tarifa piso (UX-01, ECO-07, §13): pasa por la tarifa piso neta y termina en la tarifa piso **de lista**, el número que se muestra.
- Umbrales de completitud (ECO-14, §19): un solo criterio en toda la interfaz (`completenessTone`): verde ≥ 85 % (`COMPLETENESS_GREEN_THRESHOLD`), naranja ≥ 60 %, rojo < 60 % (`COMPLETENESS_RISK_THRESHOLD`); antes el editor usaba 90/70.
- Tarifas mínimas mostradas hacia arriba (ECO-12, §18): `formatMoneyCeil` / formato `moneyCeil` (4.444.444,44 → $ 4.444.445). Sólo cambia la presentación; el motor no cambia.
- Defaults ILUSTRATIVOS (SPEC-02, §19): una cotización nueva en blanco deja `activity.activeDaysPerMonth` en `null`; con la configuración ILUSTRATIVA de la demo deja además el plazo de cobro en `null`, la contingencia en 0 y el combustible marcado `fuel.illustrative` (el Cost Completeness Score lo pide confirmar en naranja). Cambia el puntaje de las cotizaciones **nuevas** (una en blanco con la configuración demo da 33,33 %); las cotizaciones existentes no cambian.
- Configuración central (SPEC-04): `defaultSettings()` y los motores toman `LOCALE`, `CURRENCY`, `DEFAULT_MATRIX_DAYS` y `DEFAULT_MARGIN_LADDER` de `js/config.js`.

**Interfaz y datos ILUSTRATIVOS**

- Marca ILUSTRATIVO por línea (UX-02, SPEC-01, QA-E2E-05): las líneas copiadas de plantillas o recursos de biblioteca de demostración llevan `illustrative: true` (también los vehículos y `fuel.illustrative`); `illustrativeInfo(quote)` resume `{ any, quote, lines, fuel }` para badges y avisos. No requiere migración.
- Números en formato argentino (QA-E2E-02): `parseDecimalInput` interpreta `1.800.000`, `1.800.000,50` y `8,5` (antes "1.800.000" se guardaba como 1,8 y "8,5" como 85, sin error); `numberField` pasa a `type="text"` y la prop `step` se ignora.
- Valores inválidos al tipear (QA-E2E-03): un valor intermedio inválido ya no queda guardado como prefijo (margen "150" → 15); al confirmar un valor inválido el campo vuelve al valor anterior y el editor no autoguarda mientras haya campos marcados.
- Tarifa piso y precio objetivo en base de LISTA (lo que se escribe en la cotización) con la neta como dato secundario, iguales en el resumen, el paso Modalidad, el Resultado y su "Ver cálculo" (UX-01, ECO-07, ECO-11); tarifas mínimas mostradas siempre hacia arriba (ECO-12); nombres unificados "Precio objetivo" / "Precio comercial sugerido" (UX-11).
- Editor: checkbox "Son valores propios y vigentes" por línea, banner de valores ilustrativos, formulario antes del resumen en pantallas < 1200 px (UX-03), stepper horizontal en el paso Resultado hasta 1600 px (UX-04), tablas de vehículos/otros costos como tarjetas en pantallas angostas (UX-08), "Guardar como plantilla" (UX-13), confirmación al quitar líneas (QA-E2E-11), conversión día ↔ hora al cambiar la unidad con `convertRateUnit` del motor de pricing (QA-E2E-08), paso inválido en la URL redirige a "Tipo de servicio" (QA-E2E-13), campos de standby deshabilitados con "No aplica" (ECO-05). Helpers de presentación compartidos en `js/ui/views/quote-steps/shared.js`.
- Resultado: matriz dividida en "Tarifas necesarias" y "Resultado con tu tarifa comercial", gráfico al ancho real del contenedor, todas las columnas visibles en 1280–1440 px (UX-04, QA-E2E-09); con abono mensual, textos coherentes y "días máximos de actividad sin pérdida" (ECO-03, QA-E2E-10); aviso informativo cuando la tarifa está bajo piso pero el mínimo garantizado cubre la diferencia (ECO-02).
- Configuración se guarda sola (UX-05); contraste WCAG AA (UX-06); "Ver cálculo" con `aria-label` descriptivo (UX-10); tasa de financiamiento por defecto de demo marcada ILUSTRATIVA (`finance.illustrative`).

**Documentación**

- README, `docs/ARCHITECTURE.md`, `docs/CALCULATION_RULES.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/SUPABASE_PLAN.md`, `docs/AGENT_ROLES.md` y `.agent/PLANS.md` actualizados al código: persistencia con varias pestañas (y su limitación), pantallas de recuperación, validaciones de importación, procedimiento de rollback con commits de `main`, ejemplos numéricos recalculados (break-even §15, tramos §14, sensibilidad y comparador §17). Se corrigió la referencia colgante de `docs/ARCHITECTURE.md` (`catalogs.js` incluye `COST_CATEGORY_IDS`, `EQUIPMENT_TYPES` y `DEFAULT_VOLUME_TIERS`) y el estado de PLAN-2026-001 queda "En curso — pendiente de merge" (SPEC-07).

[Unreleased]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/f6b3c08...HEAD
[0.2.0]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/v0.1.0...f6b3c08
[0.1.0]: https://github.com/joaquinvedova1/COTIZADORWEB/releases/tag/v0.1.0
