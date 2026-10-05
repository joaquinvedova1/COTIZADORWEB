# Arquitectura de RATEOS

RATEOS es una aplicación **frontend estática** (HTML + CSS + JavaScript con ES modules nativos, sin frameworks, sin dependencias npm, sin analytics y sin IA) publicada en GitHub Pages. Todo se calcula en el navegador. Desde la versión con cuentas, los datos reales de cada empresa viven en **Supabase** (Auth + Postgres con Row Level Security), a través de una capa de persistencia abstracta; no hay servidor propio. El SDK oficial de Supabase está **vendorizado** (`js/data/vendor/`), así que siguen sin existir dependencias npm ni CDNs.

Tres estados que nunca se mezclan (detalle en [AUTH_ARCHITECTURE.md](AUTH_ARCHITECTURE.md)): **visitante** (sitio público), **demo** (sin cuenta, en memoria) y **usuario autenticado** (datos de su organización en Supabase). Los motores económicos, modelos de cálculo, reglas comerciales y escenarios no saben de dónde vienen los datos.

## 1. Capas

```
┌──────────────────────────────────────────────────────────────────────┐
│ UI  (index.html, js/app.js, js/ui/**)                                │
│  router por hash · layout · vistas · pasos del editor · componentes   │
│  NO accede al almacenamiento · NO contiene fórmulas económicas        │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ app.ctx.*                     │ funciones puras
                ▼                               │ (computeQuote, etc.)
┌───────────────────────────────────┐           │
│ SERVICIOS  (js/services/**)       │           │
│  casos de uso: cotizaciones,      │           │
│  recursos, backup, configuración, │           │
│  sesión (auth), contextos demo /  │           │
│  cuenta, importación local        │           │
└───────┬───────────────────┬───────┘           │
        │ StorageRepository │ motores           │
        ▼                   ▼                   ▼
┌─────────────────────────┐  ┌───────────────────────────────────────┐
│ DATOS (js/data/**)      │  │ MOTORES (js/engines/**)               │
│  StorageRepository      │  │  funciones PURAS: sin DOM, sin        │
│  LocalStorageRepo.      │  │  storage, sin red. Mismos inputs =    │
│  SupabaseRepository ────┼──┼─► mismos outputs.                     │
│  auth / workspace       │  └───────────────────────────────────────┘
│  gateways, esquema,     │
│  migraciones, vendor/   │──► Supabase (Auth + PostgREST, RLS)
└─────────────────────────┘
──────────────────────────────────────────────────────────────────────
Transversal: js/core/** (números, formato, validación, ids, logger,
eventos, trazas, objetos) · js/domain/** (catálogos, fábricas, demo) ·
js/config.js (configuración central)
```

Prioridad ante conflictos de diseño: **precisión matemática > seguridad > mantenibilidad > claridad de UX > estética**.

## 2. Reglas de dependencia

Las reglas de esta sección se verifican automáticamente en `tests/architecture.test.js` (parte de `npm test`; el análisis ignora comentarios). Lo que no cubra un test se controla en la revisión del Pull Request.

| Capa | Puede importar | NO puede importar (verificado) |
|---|---|---|
| `js/ui/**`, `js/app.js` | services, engines, domain, core, config | `js/data/**` |
| `js/services/**` | data, engines, domain, core, config | ui, app |
| `js/engines/**` | otros engines, core, domain, config | ui, services, data; además sin DOM, storage ni red |
| `js/data/**` | core, domain, config | ui, app, services |
| `js/domain/**` | core, config | ui, app, services, data |
| `js/core/**` | config | ui, app, services, data, engines, domain |
| `js/config.js` | nada | todo |

Reglas transversales (también en `tests/architecture.test.js`):

- Fuera de `js/data/` no se usa `localStorage`, `sessionStorage`, `indexedDB` ni cookies; nunca `localStorage.clear()`.
- Prohibido en todo `js/`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setTimeout`/`setInterval` con string, estilos inline como string (la CSP `style-src 'self'` los bloquea).
- Motores **determinísticos**: sin `Math.random`, `Date.now`, `new Date()` ni `crypto`.
- Sin red externa: ni `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` ni `fetch` a URLs absolutas (sólo `./version.json`). Única excepción: el SDK vendorizado de Supabase (`js/data/vendor/supabase.js`, excluido de estas reglas de estilo y verificado por `tests/data/supabase-vendor.test.js`: hash, un solo importador, sin `eval`/`innerHTML`), que habla sólo con `SUPABASE.url` (la CSP no permite otro destino).
- Todos los imports son **relativos** (`./`, `../`), con rutas literales verificables, y resuelven a archivos existentes; ningún string apunta a la raíz del dominio (`/js/…`).
- Sin `console.*` fuera de `js/core/logger.js` ni `debugger`.
- Sin secretos, `.env` ni claves privadas versionados; `package.json` sin dependencias.

## 3. Responsabilidad de cada módulo

### Raíz

| Archivo | Responsabilidad |
|---|---|
| `index.html` | Documento único. CSP estricta, `<noscript>`, carga `css/*.css` y `./js/app.js` como módulo. Todas las rutas relativas. En el build publicado (`dist/index.html`) los CSS y `app.js` se reemplazan por `./boot.js`. |
| `boot.js` | Sólo en el sitio publicado: pide `./version.json` sin caché y carga los CSS y `app.js` de la carpeta versionada `build/<sha>/` que indica (cache busting, [DEPLOYMENT.md §4.1](DEPLOYMENT.md)). |
| `css/styles.css` | Sistema de diseño base: tokens de la paleta, layout (`.app-shell`, `.sidebar`, `.main`, `.topbar`, `.content`), cards, KPIs, botones, badges, banners, formularios, tablas, diálogos, trazas, responsive e impresión. |
| `css/views.css`, `css/quote.css`, `css/result.css` | Estilos propios de las vistas generales, del editor de cotización y de la pantalla de resultado. |
| `version.json` | Versión de desarrollo (`commit: "dev"`, `ref: "local"`) que se ve al servir el repo sin build. En el deploy no se copia: `npm run build` genera `dist/version.json` con los datos reales. |
| `assets/favicon.svg` | Ícono del sitio. |
| `.nojekyll` | Evita que GitHub Pages procese el sitio con Jekyll. |
| `scripts/build.mjs` | `npm run build`: copia **sólo** `assets/`, `css/` y `js/` a `dist/build/<sha corto>/`, y `boot.js` y `.nojekyll` a `dist/` (nunca tests, docs, scripts ni dotfiles); genera `dist/index.html` (carga `boot.js`), `dist/version.json` (`version` de `package.json`, `commit` corto, `buildDate` ISO UTC, `ref` y el manifiesto `build`) y un shim `dist/js/app.js` para `index.html` viejos en caché; valida que todas las rutas de HTML, CSS e imports sean relativas, existan y no salgan de su build. Falla si encuentra errores. |
| `scripts/serve.mjs` | `npm start`: servidor estático local (sólo `node:http`) en `http://localhost:8080/COTIZADORWEB/` que simula la sub-ruta de GitHub Pages; `npm start -- --dist` sirve `dist/`. Sólo GET/HEAD, bloquea path traversal y dotfiles. |

### `js/config.js`

Configuración central sin secretos: `APP_NAME`, `APP_TAGLINE`, `SCHEMA_VERSION`, `STORAGE_MODE` (`'local'`), `SUPABASE` (URL del proyecto + **publishable key**: públicas por diseño), `PUBLIC_SITE_URL` (base de los enlaces de email), `STORAGE_KEYS` (`rateos.state`, `rateos.recovery.`, `rateos.ui`, `rateos.auth` —sesión del SDK—, `rateos.cloud.` —copias locales de cada cuenta—), `FEATURES`, `LOCALE` (`es-AR`), `CURRENCY` (`ARS`), `DEFAULT_MATRIX_DAYS` (5, 8, 10, 15, 20), `DEFAULT_MARGIN_LADDER` (5, 10, 15), `NUMERIC_EPSILON` (1e-9), `MAX_BACKUP_BYTES` (5 MB), `DEFAULT_SCENARIOS`, `SENSITIVITY_RANGES` y `detectEnvironment()` (localhost/127.0.0.1/vacío = `development`; cualquier otro host = `production`).

Es la **fuente única** de esos valores: `defaultSettings()` (`js/domain/quote-factory.js`) copia `LOCALE`, `CURRENCY`, `DEFAULT_MATRIX_DAYS` y `DEFAULT_MARGIN_LADDER`, y los motores (`utilization-engine.js`, `pricing-engine.js`, `quote-engine.js`) los importan como valores por defecto. Un valor nuevo de configuración se agrega acá y se importa; no se copia como literal en otro archivo.

Feature flags (`FEATURES`), simples y sin servicios externos:

| Flag | Valor | Significado |
|---|---|---|
| `historicalComparison` | `false` | Estimado vs real (diseñado en [DATA_MODEL.md](DATA_MODEL.md#6-estimado-vs-real)). |
| `supabase` | `true` | Cuentas reales y persistencia en Supabase (ver [SUPABASE_PLAN.md](SUPABASE_PLAN.md)). |
| `multiOrganization` | `false` | Más de una organización por usuario. |
| `analytics` | `false` | Envío de eventos internos a un destino externo. |
| `commercialModelComparator` | `true` | Comparador de modelos comerciales en el resultado. |
| `scenarios` | `true` | Escenarios pesimista / base / optimista. |

### `js/core/` — utilidades transversales puras

| Archivo | Exporta / responsabilidad |
|---|---|
| `money.js` | `isFiniteNumber`, `toNumber`, `nonNegative`, `clamp`, `pct`, `safeDivide`, `sum`, `roundTo`, `roundMoney` (2 dec.), `roundRate` (4 dec.), `roundPercentage` (2 dec.), `roundDays`, `ceilTolerant`, `roundUpToStep`, `roundPercentagesToTotal` (mayor resto), `approxEqual`. Nunca devuelve `NaN`/`Infinity`. |
| `format.js` | Presentación es-AR: `formatMoney`, `formatMoneyCeil` (monto sin decimales redondeado **hacia arriba**, para tarifas mínimas: 4.444.444,44 → $ 4.444.445), `formatNumber`, `formatPercent`, `formatDays`, `formatDate`, `formatDateTime`, `formatValue(value, format, unit)` (formatos `money`, `money2` —2 decimales—, `moneyCeil`, `rate`, `percent`, `days`, `km`, `liters`, `hours`, `number`, `text`); valores no finitos → `EMPTY` ("—"). |
| `validation.js` | `RULES` (money, quantity, distance, hours, hoursPerDay, days, daysInMonth, availableDays, positiveDays, paymentDays, percent, percentOpen, margin, utilization, positive, years, months, integer), `parseDecimalInput(raw)` (números escritos en formato argentino: `"1.800.000,50"` → 1800000,5; formatos ambiguos → `NaN`), `numberToInputText(value)` (número → texto editable con coma decimal), `validateNumber(raw, rule, { required })` (usa `parseDecimalInput` para los textos), `sanitizeText`, `validateQuote(quote)` (problemas no bloqueantes; ignora líneas que no son objetos). |
| `ids.js` | `createId()` (UUID v4 con Web Crypto) e `isUuid()`. |
| `logger.js` | `logger.debug/info/warn/error`, `configureLogger`, `addLogSink`. |
| `events.js` | `EVENT_NAMES`, `track(name, props)`, `sanitizeEventProps`, `addEventSink`. |
| `trace.js` | `createTrace({ id, title, formula, inputs, steps, result, notes })`. |
| `object.js` | `deepClone`, `deepFreeze`, `getPath`, `setPath` (rechaza `__proto__`, `prototype`, `constructor`), `isPlainObject`, `objectList(value)` (lista defensiva: si no es un array devuelve `[]` y reemplaza los elementos que no son objetos por `{}`; la usan los motores para que una línea inválida no rompa el cálculo). |

### `js/domain/` — dominio sin cálculo

| Archivo | Responsabilidad |
|---|---|
| `catalogs.js` | Listas cerradas: `SERVICE_TYPES`, `EQUIPMENT_SERVICE_TYPES`, `CONTINUOUS_SERVICE_TYPES`, `PRICING_MODES` (`known_rate`, `known_activity`), `RATE_UNITS` (`day`, `hour`, `month`), `COST_CATEGORIES` (9 categorías EECC desde v3: "Equipos propios" y "Equipos y servicios externos" por separado), `COST_CATEGORY_IDS` (sus ids), `DIRECT_CATEGORY_IDS`, `AGREEMENT_TYPES`, `ILLUSTRATIVE_AGREEMENT_PARAMS`, `EQUIPMENT_TYPES`, `MATERIAL_PROVIDERS`, `FUEL_PROVIDERS`, `COST_BEHAVIORS`, `MATERIAL_BASES`, `INDIRECT_METHODS`, `RISK_ITEMS`, `QUOTE_STATUSES`, `ACTIVE_QUOTE_STATUSES`, `AVAILABILITY_OPTIONS`, `PAY_GROUPS`, `CATEGORY_PAY_GROUP`, `QUOTE_STEPS` (orden obligatorio del flujo), `DEFAULT_VOLUME_TIERS` (tramos 1, 2–7, 8–15, 16–30, +30 días con 0 %; `commercial-rules-engine.js` los re-exporta), base económica y recursos (v3): `CURRENCIES`, `BASE_SOURCES`, `ACQUISITION_MODES` (propio / alquilado / tercerizado), `EXTERNAL_UNITS`, `VAT_RECOVERY`, `MOBILIZATION_MODES`, `DRIVER_OPTIONS`, y `labelOf()`. |
| `equipment-catalog.js` | Catálogo GLOBAL de familias de equipos (`EQUIPMENT_FAMILIES`: vactor, hidrogrúa, carretón, retro…): sólo descripción general y movilidad típica, **sin precios ni datos de clientes**. `familyById`, `familyIdOf`, `suggestedMobility`, `LEGACY_TYPE_TO_FAMILY`. |
| `economic-base.js` | Base económica `{ period, currency, source, note }`: `normalizeBase` (nunca inventa un período), `baseDefined`, `baseLabel`, `periodFromDate`, `monthsBetween`, `isValidPeriod`, `isValidDayDate` (sin `Date`). |
| `resource-snapshot.js` | Snapshot de una línea: `SNAPSHOT_FIELDS` por tipo, `snapshotValuesFromLine`, `fingerprintOf` (huella canónica), `createSnapshot`, `legacySnapshot`. |
| `resource-sync.js` | RECURSO MAESTRO ≠ SNAPSHOT: `lineSyncStatus` (unlinked / missing / current / changed / dismissed + adjusted), `applyResourceUpdate` ("Actualizar en esta cotización", conserva lo operativo), `dismissResourceUpdate` ("Conservar valor original"), `resourceChanges` (base de la futura actualización masiva). Nunca actualiza solo. Ver [RESOURCE_MODEL.md](RESOURCE_MODEL.md). |
| `quote-factory.js` | `defaultSettings`, `defaultRiskItems`, `defaultVolumeTiers`, `createEmptyQuote`, `laborLineFromProfile`, `equipmentLineFromLibrary`, `externalLineFromService`, `blankEquipmentLine`, `materialLineFromLibrary` (cada línea con su `base` y su `snapshot`), `createExternalTerms`, `createMobilization`, `suggestedMobilization`, `normalizeExchangeRates`, `createVehicle`, `createOtherCost`, `createQuoteFromTemplate`, `illustrativeInfo(quote)` → `{ any, quote, lines, fuel }`. Las líneas **copian** valores de la biblioteca (auditabilidad: editar la biblioteca no cambia cotizaciones existentes) y conservan la marca ILUSTRATIVO por línea (`line.illustrative`) si vienen de un perfil, convenio, equipo, material o plantilla de demostración. Con una configuración ILUSTRATIVA (`settings.illustrative === true`), `createEmptyQuote` deja sin definir el plazo de cobro (`null`), pone la contingencia en 0 y marca `fuel.illustrative`; los días activos (`activity.activeDaysPerMonth`) quedan siempre en `null` en una cotización nueva en blanco. |
| `demo-data.js` | `createDemoState(schemaVersion)`: Patagonia Servicios SRL (ficticia), convenios con parámetros genéricos, perfiles, 10 equipos, materiales, ubicaciones, 12 plantillas de servicio y 2 cotizaciones demo. UUID fijos (`DEMO_IDS`, `DEMO_ORG_ID`) para que la demo sea determinística. Todo ILUSTRATIVO. |

### `js/engines/` — motores económicos (funciones puras)

`index.js` re-exporta todo. Detalle de fórmulas en [CALCULATION_RULES.md](CALCULATION_RULES.md).

| Motor (archivo) | Nombre conceptual | Responsabilidad |
|---|---|---|
| `labor-engine.js` | LaborEngine | Costo de personal por persona, posición y dotación (relevos). |
| `equipment-engine.js` | parte de CostEngine | Posesión vs operación; ficha $/hora, $/día, $/mes. |
| `logistics-engine.js` | parte de CostEngine | Logística auxiliar: km, litros, costo por activación, por día activo y mensual. |
| `external-engine.js` | parte de CostEngine | Alquilados y tercerizados: tarifa neta por unidad con mínimo, costo económico vs salida de caja vs crédito fiscal (`computeExternalLine`, `externalFiscal`). |
| `mobilization-engine.js` | parte de CostEngine | Movilización del recurso principal (`computeMobilization`): por sus medios, transportado, con apoyo o no requiere; sin amortización ni mano de obra extra. |
| `currency-engine.js` | — | Moneda de la cotización y conversión con su tipo de cambio (`conversionFactor`): sin tipo de cambio → no se suma. |
| `economic-base-engine.js` | — | Base económica de la oferta (`summarizeEconomicBase`): base general, por rubro, bases distintas o viejas, sin base. Compara contra la fecha de la oferta, nunca contra "hoy". |
| `materials-engine.js` | parte de CostEngine | Materiales (merma, logística, proveedor, base) y otros costos. |
| `finance-engine.js` | FinancialEngine | Días financiados, capital de trabajo y costo financiero. |
| `cost-engine.js` | CostEngine | `buildCostModel`, `normalizeActivity`, `contingencyPctOf`, `costAtActivity`, `costStructure` (EECC), `monthsFactor`, `traceTotalCost`. |
| `pricing-engine.js` | PricingEngine | Margen, markup, conversiones, escalera de precios, redondeo comercial. |
| `commercial-rules-engine.js` | CommercialRulesEngine | Unidades facturables, reglas comerciales (`normalizeRules`; "No aplica standby" anula días e ingreso de standby), tramos, descuentos, facturación, tarifa necesaria, semáforo. |
| `economics-engine.js` | — | Une costo y facturación: `createEconomicsContext`, `revenueAt`, `evaluateAt`, `requiredRatesAt`, `linearDecomposition`. |
| `break-even-engine.js` | BreakEvenEngine | Fórmula cerrada, problema inverso, búsqueda numérica robusta, traza. |
| `utilization-engine.js` | UtilizationEngine | Utilización y matriz tarifa × utilización. |
| `completeness-engine.js` | — | Cost Completeness Score (`evaluateCompleteness`), umbrales `COMPLETENESS_GREEN_THRESHOLD` (85) y `COMPLETENESS_RISK_THRESHOLD` (60) y `completenessTone(score)` (`green` ≥ 85, `orange` ≥ 60, `red` < 60): la única fuente del color de completitud en toda la interfaz. |
| `quote-engine.js` | — | Orquestador: `computeQuote(quote, { settings, listRateOverride })`, `summarizeQuote`, `evaluateDiscountTiers`, `minActiveDaysForBillableDays`. Devuelve KPIs (incluidos `externalMonthly`, `externalCashMonthly`, `externalTaxCreditMonthly`), EECC, matriz, tramos, completitud, equivalencias, `economicBase` y **trazas**. |
| `scenario-engine.js` | ScenarioEngine | Sensibilidad (tarifa fija), escenarios y comparador de modelos comerciales. |

### `js/data/` — capa de persistencia

| Archivo | Responsabilidad |
|---|---|
| `storage-repository.js` | `StorageRepository` (contrato asíncrono) y `RepositoryError`. |
| `local-storage-repository.js` | `LocalStorageRepository` (implementación actual) y `MAX_RECOVERY_SNAPSHOTS` (3). Opción `confirmSchemaUpgrade(from, to)`: si devuelve `false`, los datos se migran sólo en memoria y se abren en sólo lectura sin escribir nada (lo usa staging). Adopta los cambios de otras pestañas antes de leer o escribir (`syncFromStorage`), valida importaciones (`prepareImport`) y administra las copias de recuperación (`listRecoverySnapshots`, `getRecoverySnapshot`, `deleteRecoverySnapshot`). |
| `memory-storage.js` | `MemoryStorage` (Web Storage en memoria, para tests y navegadores sin almacenamiento), `getBrowserStorage()` (prueba lectura y escritura de `localStorage` sin lanzar) y `getReadableBrowserStorage()` (sólo lectura, para recuperar datos con el almacenamiento lleno o bloqueado). |
| `schema.js` | `CURRENT_SCHEMA_VERSION`, `RESOURCE_TYPES`, `createEmptyState`, `detectSchemaVersion`, `validateState` (estructura, ids únicos, **forma interna de cada cotización**, límites, claves prohibidas, números finitos), `normalizeState`. |
| `migrations.js` | `migrateV0ToV1`, `migrateV1ToV2`, `migrateV2ToV3`, `MIGRATIONS`, `migrateState`, `MigrationError`. |
| `repository-factory.js` | `createRepository({ mode, storage, appVersion, globalObject })`: elige la implementación local según `STORAGE_MODE` (tests y modo local). Si el navegador no deja escribir pero sí leer y ya hay datos guardados, lanza `RepositoryError` `quota_exceeded` en lugar de abrir la demo en memoria. |
| `supabase-repository.js` | `SupabaseRepository` (datos de una cuenta): hereda de `LocalStorageRepository` sobre un storage en memoria y sincroniza con `workspace_states` con control de revisión; copia local recuperable mientras haya cambios sin subir; conflictos visibles; copias de recuperación por cuenta. `emptyWorkspaceState`, `cloudCacheKey`, `cloudRecoveryPrefix`. Detalle en [SUPABASE_PLAN.md §7](SUPABASE_PLAN.md#7-supabaserepository). |
| `supabase-client.js` | Único importador del SDK (`vendor/supabase.js`): cliente con PKCE, `detectSessionInUrl: false`, sesión en `rateos.auth`. `clearLocalAuthSession()` borra la sesión local al cerrar. |
| `auth-gateway.js` | Única puerta a Supabase Auth: registro, ingreso, cierre, recuperación, canje del código PKCE, renovación. Traduce errores a códigos propios (`AUTH_ERRORS`) y expone sólo `publicUser()` (sin tokens ni metadatos). |
| `workspace-gateway.js` | Única puerta a PostgREST: membresía y organización del usuario, cargar/guardar el workspace con revisión, renombrar organización y perfil. Errores → `WORKSPACE_ERRORS`. La seguridad la da RLS, no estos filtros. |
| `legacy-local.js` | Lee (sin escribir) los datos del modo local anterior (`rateos.state`) para ofrecer importarlos; recuerda la decisión por usuario; copia de seguridad previa. |
| `vendor/supabase.js` | `@supabase/supabase-js` 2.117.2 (UMD) + export ES; licencia MIT en `vendor/supabase-js.LICENSE.txt`. No se edita a mano. |

### `js/services/` — casos de uso

| Archivo | API |
|---|---|
| `app-context.js` | Composition roots. `createAccountContext({ user, workspaceGateway })` (cuenta: `SupabaseRepository`, `account` {user, organization, role, roleLabel}, `sync` {getState, onChange, retry, reloadFromCloud, localCopyText}, `localImport`, `updateProfileName`). `createDemoContext()` (demo pública: datos ILUSTRATIVOS en memoria, nunca persiste). `createAppContext({ storage?, appVersion? })` (modo local sobre `localStorage`; hoy lo usan los tests). Todos exponen `{ repository, persistent, init, quotes, resources, backup, settings, logger, track, onExternalChange }`. |
| `auth-service.js` | `createAuthService({ gateway })`: estado de sesión (`loading` → `anonymous` / `authenticated`, motivo `signed_out` / `expired`), validación de formularios, mensajes humanos (`AUTH_MESSAGES`), enlaces de email bajo `/COTIZADORWEB/` (`authRedirectUrl`, `parseAuthRedirect`, `cleanAuthUrl`, `siteUrlFor`), recuperación, `revalidate()` cuando la base rechaza el token. |
| `auth-routing.js` | `resolveAccess({ access, status, path, hash })` → mostrar / esperar / redirigir; `isSafeNextPath` (sin redirecciones abiertas), `loginHash`, `registerHash`, `nextFromHash`. |
| `cloud.js` | `createCloud()` → `{ authGateway, workspaceGateway }` (la UI no importa `js/data/`). |
| `local-import-service.js` | Datos del modo local anterior → cuenta: `inspect`, `importToAccount` (copia previa, sin demo ni ILUSTRATIVOS), `skip` ("Empezar en limpio"). |
| `quote-service.js` | `listQuotes` (cada ítem `{ quote, summary }`; si una cotización no se puede calcular, su `summary` es `{ error: true, atRisk: true, … }` en lugar de romper el listado y el dashboard), `getQuote`, `createQuote({ templateId })` (código `COT-0001`… con contador monotónico `settings.lastQuoteNumber`: nunca reutiliza el código de una cotización eliminada), `saveQuote`, `duplicateQuote`, `deleteQuote`, `compute(quote, opts)`, `dashboardStats()`. Los eventos sólo informan `serviceType` del catálogo (si no, `unknown`). |
| `resource-service.js` | `list/get/save/remove(type, …)`, `listServices`, `saveService`, `removeService`, `equipmentCard(eq)`, `laborProfileCost(profile)`. |
| `backup-service.js` | `exportBackup()` → `{ filename, json, data }`, `parseBackupText(text)` → `{ ok, errors, summary, data }` (no modifica nada; máximo 5 MB medidos en bytes UTF-8; valida con `prepareImport` del repositorio y, si el repositorio no sabe validar, rechaza la importación), `applyBackup(data)`, `resetToDemo()`, `listRecoverySnapshots()`, `getRecoverySnapshot(key)`, `deleteRecoverySnapshot(key)`. |
| `settings-service.js` | `get` (defaults + guardado), `save`, `getOrganization`, `saveOrganization`; `loadVersionInfo(fetch)` lee `./version.json` (versión, commit, fecha, ref y `channel`: `staging` en `/preview/`). |
| `recovery-service.js` | `createRecoveryService()`: acceso de **sólo lectura** a los datos crudos cuando la app no puede iniciar (descargar el estado y las copias de recuperación). Nunca lanza. |

### `js/ui/` — interfaz

| Archivo | Responsabilidad |
|---|---|
| `dom.js` | `h()` (crea elementos con `textContent`; prohíbe atributos `on*` como string), `s()` (SVG), `clear`, `mount`, `fragment`, `debounce`, `uniqueId`, `downloadText`, `readFileAsText`. |
| `components.js` | `icon`, `button`, `badge`, `statusDot`, `card`, `kpi`, `banner`, `illustrativeBanner`, `emptyState`, `progressBar`, `table`, `numberField`, `textField`, `periodField` (mes `AAAA-MM` con eco "sep-26"), `dateField`, `triStateField` (Sí / No / Sin definir), `selectField`, `checkboxField`, `choiceGroup`, `formGrid`, `openDialog`, `confirmDialog`, `traceContent`, `openTraceDialog`, `traceButton` ("Ver cálculo"), `toast`, `barList`. `numberField` es un `input type="text"` (`inputmode="decimal"`) que acepta números en formato argentino (`1.800.000,50`); la prop `step` ya no existe (se ignora). |
| `router.js` | Router por hash: `ROUTES` (cada una con `access`: `public` / `guest` / `auth`), `SETTINGS_TABS`, `hashToPath`, `matchRoute`, `createRouter`. Aplica `resolveAccess` antes de dibujar: sin sesión, nada protegido se muestra. |
| `economic-base-ui.js` | Presentación de bases y snapshots: `baseTag` ("Base: sep-26" / "Base no definida"), `baseFormFields`, `syncNotice` (valor utilizado vs actual con [Actualizar en esta cotización] [Conservar valor original]), `lineOrigin`, `economicBaseSummary`. |
| `layout.js` | Sidebar (con la empresa real, la cuenta —nombre, email, "Mi cuenta", "Cerrar sesión"— y el estado de sincronización), topbar, banners globales, contenedor `.content`; `NAV_SECTIONS`, `illustrativeTag`, `userErrorMessage`. |
| `views/public/*.js` | Sitio público: `landing.js`, `demo-tour.js` (demo guiada), `demo-analysis.js` (análisis completo del ejemplo, sin cuenta), `auth.js` (ingreso, registro, recuperación), `onboarding.js`, `public-chrome.js`. |
| `views/dashboard.js` | Indicadores de cotizaciones activas, recientes y conceptos (margen vs markup). |
| `views/quotes-list.js` | Listado (`render`) y "Nueva cotización" en blanco o desde plantilla (`renderNewQuote`). |
| `views/quote-editor.js` | Editor de 11 pasos (`QUOTE_STEPS`), resumen en vivo, recálculo y guardado automático; conserva los borradores que no se pudieron guardar (ver §5). |
| `views/quote-steps/*.js` | Un módulo por paso: `service` (incluye la base económica de la oferta y los tipos de cambio), `modality`, `labor`, `equipment` (propio / alquilado / tercerizado), `materials`, `logistics` ("Movilización y viajes"), `indirect`, `finance`, `risk`, `margin`. `resource-line.js` reúne origen, base, aviso de cambio en Recursos y tipos de cambio de cada línea. `shared.js` reúne helpers de presentación (tarifas en base de lista con la neta como dato, redondeo hacia arriba al mostrar, confirmación al quitar líneas). Las fórmulas siguen en los motores (p. ej. `convertRateUnit` en `pricing-engine.js`). |
| `views/quote-result.js` | Paso "Resultado": `renderQuoteResult(container, app, { quote, result, settings, onQuoteChange })`. Bloques: decisión según modalidad + KPIs + equivalencias + alertas, EECC, matriz tarifa × utilización, margen vs markup, descuentos por días/volumen y continuidad, sensibilidad (tarifa fija), escenarios (`FEATURES.scenarios`), comparador de modelos (`FEATURES.commercialModelComparator`), Cost Completeness Score y acciones (imprimir, marcar como enviada). |
| `views/library.js` | Recursos: personal, Mis equipos (legajo: identificación, obtención, economía, operación, movilidad), servicios externos, materiales, ubicaciones y catálogo (familias + modelos propios, sin precios); convenios (desde Configuración). Cada valor económico con su base. |
| `views/services.js` | Plantillas de servicio. |
| `views/settings.js` | Empresa, parámetros (incluidos fecha base del combustible y tipos de cambio por defecto), backup/importación, demo, copias de recuperación (descargar y **eliminar**, con confirmación) y "Acerca de". |
| `views/not-found.js` | Ruta inexistente. |

`js/app.js` (bootstrap): se niega a funcionar dentro de un iframe (anti-clickjacking), instala el manejo global de errores, lee `version.json`, crea la conexión (`createCloud`) y el `AuthService`, y **espera a que se restaure la sesión antes de dibujar** (sin destello de contenido protegido). Con sesión abre la cuenta (`createAccountContext`); la demo (`app.demo()`) se crea aparte, en memoria. Construye el layout, el objeto `app` que reciben las vistas (`app.ctx` = cuenta abierta, `app.auth`, `app.demo()`, `app.accessStatus()`) y el router. Escucha la sesión (vencida → "Tu sesión terminó. Volvé a ingresar."; cerrada → landing; otra persona → reabre su cuenta) y la sincronización (banners de conflicto, sin conexión e importación de datos locales). Si el contexto no se puede crear muestra una **pantalla de recuperación** que permite **descargar los datos guardados tal cual** y las copias de recuperación, y reintentar (nada se borra). El motivo depende del código de error: `read_failed`, `quota_exceeded` (almacenamiento lleno o bloqueado para escritura con datos guardados), `corrupt_no_space` (datos dañados sin espacio para la copia), `stale_state`, `write_failed`, `unsupported_mode`.

## 4. Contrato UI ↔ vistas

```js
app = {
  ctx,                       // createAppContext()
  navigate(hash),            // app.navigate(`#/cotizaciones/${id}/labor`)
  toast(message, tone),      // 'info' | 'success' | 'warning' | 'danger'
  setHeader({ title, breadcrumbs, actions }),
  version,                   // { version, commit, buildDate, ref }
  getSettings(),             // ctx.settings.get()
  refreshChrome(),           // re-renderiza el sidebar (nombre de empresa) y banners
}
```

Cada vista exporta `async function render(root, app, params)` y puede devolver una función de limpieza que el router llama al salir de la ruta.

## 5. Flujo de datos de una edición

```
input del usuario (numberField / textField / selectField …)
   │  validateNumber(raw, rule)  → parseDecimalInput ("1.800.000,50") + regla; error visible junto al campo
   │  numberField sólo emite valores válidos; si al confirmar (salir del campo / Enter)
   │  el valor es inválido, restaura el valor que tenía al entrar al campo
   ▼
update(path, value)                       js/ui/views/quote-editor.js
   │  setPath(state.quote, path, value)   (copia de trabajo; rechaza __proto__)
   ├──► scheduleRecalc  (debounce RECALC_DELAY_MS = 150 ms)
   │        computeQuote(state.quote, { settings })      motor puro
   │        → actualiza SÓLO los valores calculados (no re-renderiza inputs: no se pierde el foco)
   └──► scheduleSave    (debounce SAVE_DELAY_MS = 400 ms)
            app.ctx.quotes.saveQuote(snapshot)           QuoteService
              → repository.saveQuote(quote)              StorageRepository
                  → LocalStorageRepository.mutate()
                      syncFromStorage (adopta cambios de otra pestaña) → deepClone → aplicar
                      → validateState → persist (JSON en rateos.state)
                      (si algo falla, el estado anterior queda intacto)
```

- Al tipear, un valor intermedio inválido (por ejemplo "150" en un margen) nunca queda guardado como prefijo ("15"): el campo muestra el error y, al confirmarlo, vuelve al valor previo ("Se restauró el valor anterior.").
- Indicador de guardado: "Guardando…", "Guardado", "Error al guardar" (con "Reintentar" y "Descargar backup con estos cambios") o "Sólo lectura". Si el almacenamiento no persiste (`ctx.persistent === false`) dice "Sólo en esta sesión (no se guarda)".
- **Borrador sin guardar:** si un guardado falla (por ejemplo, almacenamiento lleno), la cotización editada se conserva en memoria (`unsavedDrafts`): al salir del editor y volver a entrar se recupera ese borrador, no la versión guardada; mientras haya cambios sin guardar con error, el navegador pide confirmación al cerrar o recargar la pestaña (`beforeunload`); y "Descargar backup con estos cambios" exporta el backup completo reemplazando esa cotización por el borrador (se vuelve a validar al importarlo).
- Cambios estructurales (agregar/quitar filas, tipo de servicio, modalidad, unidad) re-renderizan el paso.
- Al salir de la vista se fuerza el guardado pendiente.
- `stamp()` completa metadatos: `id` (UUID), `organizationId`, `createdAt` (se conserva), `updatedAt` (ahora), `createdBy`, `updatedBy`.

## 6. Persistencia: StorageRepository

`StorageRepository` (`js/data/storage-repository.js`) es el contrato que usa toda la aplicación. **Todos los métodos son asíncronos** aunque `localStorage` sea síncrono, para que una implementación remota lo reemplace sin cambiar servicios ni pantallas:

```
init()
getOrganization()            saveOrganization(org)
getResources(type?)          getResource(type, id)         saveResource(type, r)
updateResource(type, id, p)  deleteResource(type, id)
getQuotes()                  getQuote(id)                  saveQuote(q)
updateQuote(id, patch)       deleteQuote(id)
getServices()                saveService(s)                deleteService(id)
getSettings()                saveSettings(s)
exportBackup()               importBackup(data)
```

`LocalStorageRepository` agrega `prepareImport`, `resetToDemo`, `listRecoverySnapshots`, `getRecoverySnapshot`, `deleteRecoverySnapshot` y las garantías:

- Todo el estado vive en **una sola clave**: `rateos.state` (no depende de la versión de la app → sobrevive a nuevos deploys).
- Mutaciones **transaccionales**: se valida el estado completo antes de escribir.
- Antes de migrar, importar un backup o restaurar la demo guarda una **copia de recuperación** (`rateos.recovery.<fecha>.<motivo>`); conserva las 3 más recientes. Las copias del texto original dañado (`corrupt`) o con estructura inválida (`invalid`) se cuentan **aparte**, con su propio cupo de 3, para que importaciones o restauraciones posteriores nunca borren la única copia de esos datos. Si no hay espacio para la copia previa, la operación se cancela (`recovery_failed`) en lugar de arriesgar los datos.
- Si una importación o la restauración de la demo fallan al escribir (por ejemplo, por cuota), se elimina la copia de recuperación recién creada (`persistReplacing`): el estado principal quedó intacto y la copia sólo ocuparía espacio (no quedan copias huérfanas).
- Las copias se pueden eliminar desde Configuración → Copias de recuperación (`deleteRecoverySnapshot`: sólo acepta claves con el prefijo `rateos.recovery.`) para liberar espacio.
- Una migración que no produce un estado válido no se persiste: los datos originales quedan intactos y la app abre en sólo lectura.
- Datos dañados → se copian a recuperación y se carga la demo (nunca se borran). Si no hay espacio para guardar esa copia, el original **no se toca** e `init()` lanza `RepositoryError` `corrupt_no_space`: la app muestra la pantalla de recuperación para descargar los datos guardados (no abre la demo). Datos de una versión **más nueva** → modo **sólo lectura**.
- Nunca usa `localStorage.clear()`.
- Si el navegador no permite almacenamiento, usa `MemoryStorage` y la UI avisa que los cambios no se guardan (`ctx.persistent === false`). Si no deja escribir pero sí leer y hay datos guardados (almacenamiento lleno o bloqueado), `createRepository` lanza `quota_exceeded` y la app muestra la pantalla de recuperación en lugar de la demo.
- Si al guardar el navegador informa cuota llena, el error `quota_exceeded` explica qué hacer: exportar un backup y liberar espacio (copias de recuperación viejas o cotizaciones que no se usan).

### Varias pestañas

Todas las pestañas de RATEOS del mismo navegador comparten `rateos.state`, y cada escritura reemplaza el estado completo. Para que una pestaña con una copia vieja en memoria no borre lo que guardó otra:

- El repositorio recuerda el último texto que leyó o escribió (`lastRaw`). Antes de **cada lectura o escritura** (`ensureReady` → `syncFromStorage`) relee `rateos.state`; si cambió y es un estado válido de la versión actual, **lo adopta** y recién después aplica la mutación. Así una pestaña nunca borra cotizaciones creadas en otra y los códigos `COT-NNNN` no se repiten (`settings.lastQuoteNumber` se lee actualizado).
- Si otra pestaña con una versión más nueva de la app migró los datos, se adoptan en modo **sólo lectura**. Si el texto cambiado no se puede interpretar, se lanza `stale_state` ("Los datos cambiaron en otra pestaña y no se pudieron leer. Recargá la página.") sin escribir nada.
- La UI se entera por el evento `storage` (`ctx.onExternalChange`) y refresca la pantalla.
- **Limitación conocida:** no hay fusión por campo. Si dos pestañas editan **la misma cotización** a la vez, gana el último guardado (los cambios de la otra pestaña sobre esa cotización se pierden); lo mismo vale para una misma ficha de biblioteca o para la configuración. Los cambios sobre entidades distintas (otra cotización, otro recurso) no se pisan entre sí.

Estados de `init()`: `seeded`, `loaded`, `migrated`, `repaired`, `recovered`, `read_only`. Códigos de `RepositoryError` relevantes para la UI: `read_failed`, `quota_exceeded`, `write_failed`, `recovery_failed`, `corrupt_no_space`, `stale_state`, `read_only`, `validation_failed`, `invalid_backup`, `not_found`. Detalle del formato en [DATA_MODEL.md](DATA_MODEL.md).

### `SupabaseRepository` (cuentas)

Implementado sin tocar los motores: `SupabaseRepository` extiende `LocalStorageRepository` sobre un storage en memoria (mismas entidades, validación, migraciones y backup) y sincroniza el estado completo con la fila de `workspace_states` de la organización:

- Cada escritura espera la confirmación de la nube ("Guardado" = guardado en la cuenta). Si falla, rechaza con `RepositoryError` (`sync_failed`, `conflict`, `session_expired`, `forbidden`, `too_large`), el cambio queda en una copia local recuperable y se reintenta.
- Control de revisión: nunca *last-write-wins* silencioso; un conflicto bloquea las escrituras hasta [Recargar] o [Conservar una copia].
- Las pestañas de una misma cuenta se coordinan por la revisión de la nube (un guardado con revisión vieja es un conflicto visible), no por el evento `storage`.

Plan completo en [SUPABASE_PLAN.md](SUPABASE_PLAN.md).

## 7. Logger

`js/core/logger.js` centraliza los mensajes técnicos:

- **Producción** (cualquier host que no sea `localhost`/`127.0.0.1`): sólo `warn` y `error`, **sin contexto** (el contexto puede tener datos empresariales).
- **Desarrollo**: todos los niveles con su contexto.
- `addLogSink(fn)` permite capturar logs (tests, futuro monitoreo). Un sink defectuoso nunca rompe la app.
- `js/app.js` instala manejadores globales de `error` y `unhandledrejection` que registran nombre y mensaje técnico y muestran un aviso amigable (como máximo uno cada 5 s).

## 8. Eventos internos y privacidad

`js/core/events.js` define eventos de producto desacoplados de cualquier herramienta de analytics. **Hoy no se envía nada a terceros** (`FEATURES.analytics = false`): los sinks sólo reciben eventos si el flag está activo o si se registran con `force` (tests).

- Nombres permitidos (`EVENT_NAMES`): `app_started`, `quote_created`, `quote_completed`, `quote_duplicated`, `quote_deleted`, `scenario_changed`, `break_even_viewed`, `calculation_trace_opened`, `backup_exported`, `backup_imported`, `resource_saved`.
- Propiedades permitidas: `serviceType`, `pricingMode`, `unit`, `step`, `traceId`, `variable`, `resourceType`, `source` (enums cortos: sólo letras minúsculas y guion bajo, `^[a-z][a-z_]{0,39}$`, **sin dígitos**, para que un monto o un identificador no pase disfrazado de enum), `completed`, `isDemo` (booleanos) y `count` (entero 0–10000).
- Los valores que vienen de los datos se normalizan al catálogo antes de emitirse: `QuoteService` envía `serviceType` sólo si es un id de `SERVICE_TYPES` (si no, `unknown`).
- Todo lo demás se descarta: **nunca** montos, salarios, costos, tarifas, nombres de clientes ni texto libre. Permitido: `user_finished_quote = true`. No permitido: `monthly_labor_cost = 85000000`.

## 9. Trazas "Ver cálculo"

Los motores devuelven trazas **de datos** (`createTrace`): `{ id, title, formula, inputs[], steps[], result, notes[] }`, cada ítem con `label`, `value`, `format` (`money`, `money2`, `moneyCeil`, `rate`, `percent`, `days`, `km`, `liters`, `hours`, `number`, `text`) y `unit`. La UI las muestra con `traceButton(trace)` / `openTraceDialog(trace)` usando `formatValue`, nunca con HTML.

`computeQuote` devuelve `traces.totalCost`, `traces.breakEven`, `traces.floorRate`, `traces.targetRate`, `traces.expectedResult`, `traces.financialCost` y `traces.logistics`; `traceMarginVsMarkup` explica margen vs markup (con 2 decimales: 111,11 vs 110,00). Cada traza explica **el mismo número que acompaña**: `traces.floorRate` pasa por la tarifa piso neta y termina en la tarifa piso **de lista**; `traces.breakEven` se arma en el punto de equilibrio, donde rige el tramo de descuento que realmente aplica (ver [CALCULATION_RULES.md §15](CALCULATION_RULES.md#15-break-even-y-días-para-margen-objetivo)). Si una pantalla muestra un resultado sin traza del motor, la construye con `createTrace` (fórmula + entradas + resultado). Regla: **ningún número mágico**.

## 10. Routing y sub-ruta `/COTIZADORWEB/`

- Router por **hash** (`#/…`): nunca toca el `pathname`, así que funciona igual en `https://joaquinvedova1.github.io/COTIZADORWEB/`, en `http://localhost:8080/COTIZADORWEB/`, en la raíz de otro dominio o en cualquier hosting estático (Vercel, Netlify, S3), sin reglas de reescritura.
- Rutas públicas: `#/` (landing), `#/demo`, `#/demo/analisis`, `#/recuperar-contrasena`; sólo sin sesión: `#/login`, `#/registro`; con cuenta: `#/inicio`, `#/cotizaciones`, `#/cotizaciones/nueva`, `#/cotizaciones/:id/:step`, `#/recursos/:tab`, `#/servicios`, `#/escenarios`, `#/configuracion/:tab` (incluida `cuenta`), `#/bienvenida`; cualquier otra → "no encontrado". Sin sesión, una ruta protegida va a `#/login?next=…`.
- Los enlaces de los emails de Auth vuelven con la query **antes** del `#` (`/COTIZADORWEB/?auth=confirm&next=…&code=…`): no chocan con el router; la app canjea el código y limpia la URL.
- Vistas cargadas con `import()` dinámico y rutas relativas. Si una vista falla, el router muestra una tarjeta de error con "Reintentar" sin romper la app.
- Todos los recursos usan rutas relativas (`./css/…`, `./js/app.js`, `./version.json`). **Nunca** `/js/…`: en Pages eso apuntaría a la raíz del dominio y daría 404.
- ES modules requieren HTTP: la app **no funciona con `file://`**.

## 11. Seguridad del frontend

- **CSP** en `index.html`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://dltlnizvnvnefgbzfftu.supabase.co; object-src 'none'; base-uri 'self'; form-action 'none'`, más `referrer: no-referrer`. Sin scripts inline, sin CDNs; la única conexión externa es el proyecto de Supabase (un test lo verifica).
- **Cuentas:** en el navegador sólo la URL del proyecto y la publishable key; nunca `service_role`, secret keys, contraseña de la base ni connection strings (test de patrones de secretos). Las contraseñas nunca se guardan ni se loguean. La autorización real es RLS en Postgres (ver [SUPABASE_PLAN.md §0](SUPABASE_PLAN.md#0-qué-está-implementado)). Riesgos y mitigaciones en [AUTH_ARCHITECTURE.md §9.1](AUTH_ARCHITECTURE.md#91-riesgos-conocidos-y-mitigaciones).
- DOM seguro: `h()` inserta texto con nodos de texto; los estilos dinámicos se aplican por CSSOM (`el.style.setProperty`), compatible con la CSP.
- `setPath` y `validateState` rechazan claves `__proto__`, `prototype`, `constructor` (prototype pollution).
- Backups: límite de 5 MB, JSON validado y migrado **antes** de aplicarse, resumen + confirmación del usuario, copia de recuperación previa. `prepareImport` rechaza un JSON sin versión que no tenga ninguna colección de RATEOS (por ejemplo, un `package.json`), valida la forma **original** de un backup v1 antes de normalizarlo (una colección con tipo incorrecto se rechaza en lugar de vaciarse en silencio) y `validateState` revisa la forma interna de cada cotización (líneas que deben ser listas de objetos y sub-objetos que deben ser objetos).
- Resiliencia: aunque llegue un registro inválido, los motores ignoran las líneas que no son objetos (`objectList`) y `QuoteService` marca la cotización con `{ error: true }`: una cotización mala no rompe el dashboard ni el listado.
- Todo JavaScript es público: no hay secretos, tokens ni claves en el repositorio. `.gitignore` excluye `.env*` (salvo `.env.example`), `*.pem`, `*.key`, `secrets` (archivo o carpeta) y `secrets.*`, `*credentials*`, `*credenciales*`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*service-account*.json` y `.npmrc`.

## 12. Decisiones y trade-offs

| Decisión | Por qué | Costo aceptado |
|---|---|---|
| Sin frameworks ni dependencias npm | Superficie de ataque mínima, sin build obligatorio, carga rápida, nada que actualizar. | Más código propio para DOM y componentes. |
| ES modules nativos | Funciona en cualquier hosting estático; los mismos módulos corren en Node (tests). | No funciona con `file://`; sin bundling. |
| Motores puros con objetos planos | Reproducibles, testeables con `node --test`, reutilizables en backend futuro. | La UI recalcula todo el modelo en cada cambio (rápido para el tamaño actual). |
| Repositorio asíncrono sobre `localStorage` síncrono | Permitió agregar Supabase sin tocar servicios, vistas ni motores. | — |
| Un workspace JSON por organización en Supabase (no el modelo normalizado, todavía) | Mismo estado versionado que el backup: cero cambios en motores, validación y migraciones; RLS simple y probada. | Límite de 5 MB por organización; concurrencia por organización (no por cotización); sin consultas SQL por entidad. |
| SDK de Supabase vendorizado | Cero dependencias npm y CSP sin CDNs; versión fija verificada por hash. | Actualizarlo es un cambio manual (nuevo hash). |
| Un único documento en `rateos.state` | Escrituras atómicas, backup = estado, migraciones simples. | Reescribe todo el estado en cada guardado; límite ~5 MB del navegador. |
| Varias pestañas: releer `rateos.state` antes de cada lectura o escritura | Simple y sin dependencias; ninguna pestaña borra lo que guardó otra. | Sin fusión por campo: si dos pestañas editan la misma cotización, gana el último guardado. |
| Router por hash | Compatible con sub-rutas de Pages sin `404.html`. | URLs con `#`. |
| Las cotizaciones copian valores de la biblioteca | Auditabilidad: una cotización no cambia si cambia la biblioteca. | Actualizar una cotización vieja requiere volver a aplicar el recurso. |
| Interés simple, mes de 30 días | Explicable a una PyME y verificable a mano. | Aproximación del costo financiero real. |
| Break-even numérico (grilla 0,1 + bisección) | Robusto con reglas no lineales (mínimo garantizado, tramos, minimum call). | Más evaluaciones del motor (despreciable). |
