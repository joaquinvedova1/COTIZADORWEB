# Changelog

Todos los cambios relevantes de RATEOS se documentan en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa [Versionado Semántico](https://semver.org/lang/es/). Los tags `v0.x.x` se crean sólo para hitos (ver [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#6-tags-y-versiones)).

Reglas para este archivo:

- Todo cambio de fórmula económica se anota aquí **y** en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md), indicando qué resultados cambian.
- Todo cambio de `SCHEMA_VERSION` se anota con la migración correspondiente.
- Secciones: Agregado, Cambiado, Obsoleto, Eliminado, Corregido, Seguridad.

## [Unreleased]

Dos cambios en esta versión:

1. **Rediseño de experiencia de usuario**: simple en la superficie, potente por debajo. No cambia ninguna fórmula económica. Ninguna capacidad se eliminó: lo avanzado quedó colapsado o en pantallas secundarias. Guía en [docs/UX.md](docs/UX.md).
2. **Impuestos sobre la facturación con gross-up exacto** (PLAN-2026-002, a partir del análisis conceptual de una estructura de costos profesional: [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md)). **Es un cambio de regla de negocio** y **sube el esquema de datos a 2** (con migración). Con los impuestos sin definir —el estado de todas las cotizaciones existentes y de la demo— **ningún número cambia** (baseline de regresión). Detalle abajo.

### Agregado

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
- **Ingresar / Crear cuenta / Bienvenida** (`#/login`, `#/registro`, `#/bienvenida`) como flujo preparado para la futura autenticación: avisan que las cuentas no están habilitadas, **nunca guardan email ni contraseña** y permiten entrar sin cuenta. `js/services/auth-service.js` (`ctx.auth`) es el punto único de autenticación (hoy modo local, sin cuentas). El onboarding guarda el tipo de empresa (`organization.industry`, campo opcional) y la base operativa.
- Pantalla **Escenarios** (`#/escenarios`, `#/escenarios/:id`) para analizar sensibilidad, escenarios y modelos comerciales de una cotización sin modificarla.
- Componentes de interfaz: `disclosure`, `bigStat`, `pageIntro`, `linkButton`, `stepIndicator` y `emptyState` con título, texto y acción. `formatMoneyCompact` ("$ 15,8 M", hacia arriba para tarifas). `QuoteService.latestDraft()`.
- [docs/UX.md](docs/UX.md): principios, arquitectura de información, copy y checklist de carga cognitiva.

### Cambiado

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

### Corregido

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

[Unreleased]: https://github.com/joaquinvedova1/COTIZADORWEB/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joaquinvedova1/COTIZADORWEB/releases/tag/v0.1.0
