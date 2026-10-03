# Arquitectura de RATEOS

RATEOS v0.1.0 es una aplicación **100 % frontend**: HTML + CSS + JavaScript con ES modules nativos, sin frameworks, sin dependencias npm, sin backend, sin analytics y sin IA. Todo se calcula en el navegador y los datos se guardan en `localStorage` a través de una capa de persistencia abstracta.

Objetivo de diseño (ver [AGENTS.md](../AGENTS.md)): hoy **RATEOS + localStorage + GitHub Pages**; mañana **RATEOS + Supabase + Auth + multiempresa**, sin reescribir motores económicos, modelos de cálculo, reglas comerciales ni lógica de escenarios.

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
│  recuperación                     │           │
└───────┬───────────────────┬───────┘           │
        │ StorageRepository │ motores           │
        ▼                   ▼                   ▼
┌─────────────────────┐  ┌───────────────────────────────────────────┐
│ DATOS (js/data/**)  │  │ MOTORES (js/engines/**)                   │
│  StorageRepository  │  │  funciones PURAS: sin DOM, sin storage,   │
│  LocalStorageRepo.  │  │  sin red. Mismos inputs = mismos outputs. │
│  esquema, migración │  └───────────────────────────────────────────┘
└─────────────────────┘
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
| `js/domain/**` | core, config (y la constante citada abajo) | ui, app, services, data |
| `js/core/**` | config | ui, app, services, data, engines, domain |
| `js/config.js` | nada | todo |

Reglas transversales (también en `tests/architecture.test.js`):

- Fuera de `js/data/` no se usa `localStorage`, `sessionStorage`, `indexedDB` ni cookies; nunca `localStorage.clear()`.
- Prohibido en todo `js/`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setTimeout`/`setInterval` con string, estilos inline como string (la CSP `style-src 'self'` los bloquea).
- Motores **determinísticos**: sin `Math.random`, `Date.now`, `new Date()` ni `crypto`.
- Sin red externa: ni `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` ni `fetch` a URLs absolutas (sólo `./version.json`).
- Todos los imports son **relativos** (`./`, `../`), con rutas literales verificables, y resuelven a archivos existentes; ningún string apunta a la raíz del dominio (`/js/…`).
- Sin `console.*` fuera de `js/core/logger.js` ni `debugger`.
- Sin secretos, `.env` ni claves privadas versionados; `package.json` sin dependencias.

## 3. Responsabilidad de cada módulo

### Raíz

| Archivo | Responsabilidad |
|---|---|
| `index.html` | Documento único. CSP estricta, `<noscript>`, carga `css/*.css` y `./js/app.js` como módulo. Todas las rutas relativas. |
| `css/styles.css` | Sistema de diseño base: tokens de la paleta, layout (`.app-shell`, `.sidebar`, `.main`, `.topbar`, `.content`), cards, KPIs, botones, badges, banners, formularios, tablas, diálogos, trazas, responsive e impresión. |
| `css/views.css`, `css/quote.css`, `css/result.css` | Estilos propios de las vistas generales, del editor de cotización y de la pantalla de resultado. |
| `version.json` | Versión de desarrollo (`commit: "dev"`, `ref: "local"`) que se ve al servir el repo sin build. En el deploy no se copia: `npm run build` genera `dist/version.json` con los datos reales. |
| `assets/favicon.svg` | Ícono del sitio. |
| `.nojekyll` | Evita que GitHub Pages procese el sitio con Jekyll. |
| `scripts/build.mjs` | `npm run build`: copia **sólo** `index.html`, `.nojekyll`, `assets/`, `css/` y `js/` a `dist/` (nunca tests, docs, scripts ni dotfiles), genera `dist/version.json` (`version` de `package.json`, `commit` corto, `buildDate` ISO UTC, `ref`) y valida que todas las rutas de HTML, CSS e imports sean relativas y existan. Falla si encuentra errores. |
| `scripts/serve.mjs` | `npm start`: servidor estático local (sólo `node:http`) en `http://localhost:8080/COTIZADORWEB/` que simula la sub-ruta de GitHub Pages; `npm start -- --dist` sirve `dist/`. Sólo GET/HEAD, bloquea path traversal y dotfiles. |

### `js/config.js`

Configuración central sin secretos: `APP_NAME`, `APP_TAGLINE`, `SCHEMA_VERSION` (1), `STORAGE_MODE` (`'local'`), `STORAGE_KEYS` (`rateos.state`, `rateos.recovery.`, `rateos.ui`), `FEATURES`, `LOCALE` (`es-AR`), `CURRENCY` (`ARS`), `DEFAULT_MATRIX_DAYS` (5, 8, 10, 15, 20), `DEFAULT_MARGIN_LADDER` (5, 10, 15), `NUMERIC_EPSILON` (1e-9), `MAX_BACKUP_BYTES` (5 MB), `DEFAULT_SCENARIOS`, `SENSITIVITY_RANGES` y `detectEnvironment()` (localhost/127.0.0.1/vacío = `development`; cualquier otro host = `production`).

Feature flags (`FEATURES`), simples y sin servicios externos:

| Flag | Valor | Significado |
|---|---|---|
| `historicalComparison` | `false` | Estimado vs real (diseñado en [DATA_MODEL.md](DATA_MODEL.md#6-estimado-vs-real)). |
| `supabase` | `false` | Persistencia en Supabase (ver [SUPABASE_PLAN.md](SUPABASE_PLAN.md)). |
| `multiOrganization` | `false` | Más de una organización por usuario. |
| `analytics` | `false` | Envío de eventos internos a un destino externo. |
| `commercialModelComparator` | `true` | Comparador de modelos comerciales en el resultado. |
| `scenarios` | `true` | Escenarios pesimista / base / optimista. |

### `js/core/` — utilidades transversales puras

| Archivo | Exporta / responsabilidad |
|---|---|
| `money.js` | `isFiniteNumber`, `toNumber`, `nonNegative`, `clamp`, `pct`, `safeDivide`, `sum`, `roundTo`, `roundMoney` (2 dec.), `roundRate` (4 dec.), `roundPercentage` (2 dec.), `roundDays`, `ceilTolerant`, `roundUpToStep`, `roundPercentagesToTotal` (mayor resto), `approxEqual`. Nunca devuelve `NaN`/`Infinity`. |
| `format.js` | Presentación es-AR: `formatMoney`, `formatNumber`, `formatPercent`, `formatDays`, `formatDate`, `formatDateTime`, `formatValue(value, format, unit)`; valores no finitos → `EMPTY` ("—"). |
| `validation.js` | `RULES` (money, quantity, distance, hours, hoursPerDay, days, daysInMonth, availableDays, positiveDays, paymentDays, percent, percentOpen, margin, utilization, positive, years, months, integer), `validateNumber(raw, rule, { required })`, `sanitizeText`, `validateQuote(quote)` (problemas no bloqueantes). |
| `ids.js` | `createId()` (UUID v4 con Web Crypto) e `isUuid()`. |
| `logger.js` | `logger.debug/info/warn/error`, `configureLogger`, `addLogSink`. |
| `events.js` | `EVENT_NAMES`, `track(name, props)`, `sanitizeEventProps`, `addEventSink`. |
| `trace.js` | `createTrace({ id, title, formula, inputs, steps, result, notes })`. |
| `object.js` | `deepClone`, `deepFreeze`, `getPath`, `setPath` (rechaza `__proto__`, `prototype`, `constructor`), `isPlainObject`. |

### `js/domain/` — dominio sin cálculo

| Archivo | Responsabilidad |
|---|---|
| `catalogs.js` | Listas cerradas: `SERVICE_TYPES`, `EQUIPMENT_SERVICE_TYPES`, `CONTINUOUS_SERVICE_TYPES`, `PRICING_MODES` (`known_rate`, `known_activity`), `RATE_UNITS` (`day`, `hour`, `month`), `COST_CATEGORIES` (8 categorías EECC), `DIRECT_CATEGORY_IDS`, `AGREEMENT_TYPES`, `ILLUSTRATIVE_AGREEMENT_PARAMS`, `MATERIAL_PROVIDERS`, `FUEL_PROVIDERS`, `COST_BEHAVIORS`, `MATERIAL_BASES`, `INDIRECT_METHODS`, `RISK_ITEMS`, `QUOTE_STATUSES`, `ACTIVE_QUOTE_STATUSES`, `AVAILABILITY_OPTIONS`, `PAY_GROUPS`, `CATEGORY_PAY_GROUP`, `QUOTE_STEPS` (orden obligatorio del flujo) y `labelOf()`. |
| `quote-factory.js` | `defaultSettings`, `defaultRiskItems`, `defaultVolumeTiers`, `createEmptyQuote`, `laborLineFromProfile`, `equipmentLineFromLibrary`, `materialLineFromLibrary`, `createVehicle`, `createOtherCost`, `createQuoteFromTemplate`. Las líneas **copian** valores de la biblioteca (auditabilidad: editar la biblioteca no cambia cotizaciones existentes). |
| `demo-data.js` | `createDemoState(schemaVersion)`: Patagonia Servicios SRL (ficticia), convenios con parámetros genéricos, perfiles, 10 equipos, materiales, ubicaciones, 12 plantillas de servicio y 2 cotizaciones demo. UUID fijos (`DEMO_IDS`, `DEMO_ORG_ID`) para que la demo sea determinística. Todo ILUSTRATIVO. |

### `js/engines/` — motores económicos (funciones puras)

`index.js` re-exporta todo. Detalle de fórmulas en [CALCULATION_RULES.md](CALCULATION_RULES.md).

| Motor (archivo) | Nombre conceptual | Responsabilidad |
|---|---|---|
| `labor-engine.js` | LaborEngine | Costo de personal por persona, posición y dotación (relevos). |
| `equipment-engine.js` | parte de CostEngine | Posesión vs operación; ficha $/hora, $/día, $/mes. |
| `logistics-engine.js` | parte de CostEngine | Km, litros, costo por activación, por día activo y mensual. |
| `materials-engine.js` | parte de CostEngine | Materiales (merma, logística, proveedor, base) y otros costos. |
| `finance-engine.js` | FinancialEngine | Días financiados, capital de trabajo y costo financiero. |
| `cost-engine.js` | CostEngine | `buildCostModel`, `normalizeActivity`, `contingencyPctOf`, `costAtActivity`, `costStructure` (EECC), `monthsFactor`, `traceTotalCost`. |
| `pricing-engine.js` | PricingEngine | Margen, markup, conversiones, escalera de precios, redondeo comercial. |
| `commercial-rules-engine.js` | CommercialRulesEngine | Unidades facturables, reglas comerciales, tramos, descuentos, facturación, tarifa necesaria, semáforo. |
| `economics-engine.js` | — | Une costo y facturación: `createEconomicsContext`, `revenueAt`, `evaluateAt`, `requiredRatesAt`, `linearDecomposition`. |
| `break-even-engine.js` | BreakEvenEngine | Fórmula cerrada, problema inverso, búsqueda numérica robusta, traza. |
| `utilization-engine.js` | UtilizationEngine | Utilización y matriz tarifa × utilización. |
| `completeness-engine.js` | — | Cost Completeness Score (`evaluateCompleteness`, `COMPLETENESS_RISK_THRESHOLD`). |
| `quote-engine.js` | — | Orquestador: `computeQuote(quote, { settings, listRateOverride })`, `summarizeQuote`, `evaluateDiscountTiers`. Devuelve KPIs, EECC, matriz, tramos, completitud, equivalencias y **trazas**. |
| `scenario-engine.js` | ScenarioEngine | Sensibilidad (tarifa fija), escenarios y comparador de modelos comerciales. |

### `js/data/` — capa de persistencia

| Archivo | Responsabilidad |
|---|---|
| `storage-repository.js` | `StorageRepository` (contrato asíncrono) y `RepositoryError`. |
| `local-storage-repository.js` | `LocalStorageRepository` (implementación actual) y `MAX_RECOVERY_SNAPSHOTS` (3). |
| `memory-storage.js` | `MemoryStorage` (Web Storage en memoria, para tests y navegadores sin almacenamiento), `getBrowserStorage()` (prueba lectura y escritura de `localStorage` sin lanzar) y `getReadableBrowserStorage()` (sólo lectura, para recuperar datos con el almacenamiento lleno o bloqueado). |
| `schema.js` | `CURRENT_SCHEMA_VERSION`, `RESOURCE_TYPES`, `createEmptyState`, `detectSchemaVersion`, `validateState` (estructura, ids únicos, límites, claves prohibidas, números finitos), `normalizeState`. |
| `migrations.js` | `migrateV0ToV1`, `MIGRATIONS`, `migrateState`, `MigrationError`. |
| `repository-factory.js` | `createRepository({ mode, storage, appVersion })`: único punto que elige la implementación según `STORAGE_MODE`. |

### `js/services/` — casos de uso

| Archivo | API |
|---|---|
| `app-context.js` | `createAppContext({ storage?, appVersion? })` → `{ repository, persistent, init: { status, messages, readOnly }, quotes, resources, backup, settings, logger, track }`. Composition root. |
| `quote-service.js` | `listQuotes`, `getQuote`, `createQuote({ templateId })` (código `COT-0001`… con contador monotónico `settings.lastQuoteNumber`: nunca reutiliza el código de una cotización eliminada), `saveQuote`, `duplicateQuote`, `deleteQuote`, `compute(quote, opts)`, `dashboardStats()`. |
| `resource-service.js` | `list/get/save/remove(type, …)`, `listServices`, `saveService`, `removeService`, `equipmentCard(eq)`, `laborProfileCost(profile)`. |
| `backup-service.js` | `exportBackup()` → `{ filename, json, data }`, `parseBackupText(text)` → `{ ok, errors, summary, data }` (no modifica nada; máximo 5 MB medidos en bytes UTF-8; si el repositorio no sabe validar, rechaza la importación), `applyBackup(data)`, `resetToDemo()`, `listRecoverySnapshots()`, `getRecoverySnapshot(key)`. |
| `settings-service.js` | `get` (defaults + guardado), `save`, `getOrganization`, `saveOrganization`; `loadVersionInfo(fetch)` lee `./version.json`. |
| `recovery-service.js` | `createRecoveryService()`: acceso de **sólo lectura** a los datos crudos cuando la app no puede iniciar (descargar el estado y las copias de recuperación). Nunca lanza. |

### `js/ui/` — interfaz

| Archivo | Responsabilidad |
|---|---|
| `dom.js` | `h()` (crea elementos con `textContent`; prohíbe atributos `on*` como string), `s()` (SVG), `clear`, `mount`, `fragment`, `debounce`, `uniqueId`, `downloadText`, `readFileAsText`. |
| `components.js` | `icon`, `button`, `badge`, `statusDot`, `card`, `kpi`, `banner`, `illustrativeBanner`, `emptyState`, `progressBar`, `table`, `numberField`, `textField`, `selectField`, `checkboxField`, `choiceGroup`, `formGrid`, `openDialog`, `confirmDialog`, `traceContent`, `openTraceDialog`, `traceButton` ("Ver cálculo"), `toast`, `barList`. |
| `router.js` | Router por hash: `ROUTES`, `LIBRARY_TABS`, `hashToPath`, `matchRoute`, `createRouter`. |
| `layout.js` | Sidebar, topbar, banners globales, contenedor `.content`; `NAV_SECTIONS`, `illustrativeTag`, `userErrorMessage`. |
| `views/dashboard.js` | Indicadores de cotizaciones activas, recientes y conceptos (margen vs markup). |
| `views/quotes-list.js` | Listado (`render`) y "Nueva cotización" en blanco o desde plantilla (`renderNewQuote`). |
| `views/quote-editor.js` | Editor de 11 pasos (`QUOTE_STEPS`), resumen en vivo, recálculo y guardado automático. |
| `views/quote-steps/*.js` | Un módulo por paso: `service`, `modality`, `labor`, `equipment`, `materials`, `logistics`, `indirect`, `finance`, `risk`, `margin`. |
| `views/quote-result.js` | Paso "Resultado": `renderQuoteResult(container, app, { quote, result, settings, onQuoteChange })`. Bloques: decisión según modalidad + KPIs + equivalencias + alertas, EECC, matriz tarifa × utilización, margen vs markup, descuentos por días/volumen y continuidad, sensibilidad (tarifa fija), escenarios (`FEATURES.scenarios`), comparador de modelos (`FEATURES.commercialModelComparator`), Cost Completeness Score y acciones (imprimir, marcar como enviada). |
| `views/library.js` | Bibliotecas: personal, convenios, equipos, materiales, ubicaciones. |
| `views/services.js` | Plantillas de servicio. |
| `views/settings.js` | Empresa, parámetros, backup/importación, demo, copias de recuperación y "Acerca de". |
| `views/not-found.js` | Ruta inexistente. |

`js/app.js` (bootstrap): instala el manejo global de errores, lee `version.json`, crea el contexto (`createAppContext`), construye el layout, el objeto `app` que reciben las vistas y el router. Si el contexto no se puede crear muestra una pantalla de error que permite **descargar los datos guardados tal cual** (nada se borra).

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
   │  validateNumber(raw, rule)  → error visible junto al campo
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
                      deepClone → aplicar → validateState → persist (JSON en rateos.state)
                      (si algo falla, el estado anterior queda intacto)
```

- Indicador de guardado: "Guardando…", "Guardado", "Error al guardar" (con reintento) o "Sólo lectura".
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

`LocalStorageRepository` agrega `prepareImport`, `resetToDemo`, `listRecoverySnapshots`, `getRecoverySnapshot` y las garantías:

- Todo el estado vive en **una sola clave**: `rateos.state` (no depende de la versión de la app → sobrevive a nuevos deploys).
- Mutaciones **transaccionales**: se valida el estado completo antes de escribir.
- Antes de migrar, importar un backup o restaurar la demo guarda una **copia de recuperación** (`rateos.recovery.<fecha>.<motivo>`); conserva las 3 más recientes (las de datos dañados se cuentan aparte). Si no hay espacio para esa copia, la operación se cancela (`recovery_failed`) en lugar de arriesgar los datos.
- Una migración que no produce un estado válido no se persiste: los datos originales quedan intactos y la app abre en sólo lectura.
- Datos dañados → se copian a recuperación y se carga la demo (nunca se borran). Si no hay espacio para guardar esa copia, el original **no se toca** y la demo se abre en modo sólo lectura. Datos de una versión **más nueva** → modo **sólo lectura**.
- Nunca usa `localStorage.clear()`.
- Si el navegador no permite almacenamiento, usa `MemoryStorage` y la UI avisa que los cambios no se guardan (`ctx.persistent === false`).

Estados de `init()`: `seeded`, `loaded`, `migrated`, `repaired`, `recovered`, `read_only`. Detalle del formato en [DATA_MODEL.md](DATA_MODEL.md).

### Cómo agregar `SupabaseRepository` sin tocar los motores

1. Crear `js/data/supabase-repository.js` con una clase que extienda `StorageRepository` e implemente los mismos métodos (mismas formas de datos).
2. En `repository-factory.js`, agregar el caso `mode === 'supabase'` (detrás de `FEATURES.supabase`).
3. Cambiar `STORAGE_MODE` (o elegirlo en tiempo de ejecución después del login).
4. Los motores (`js/engines/**`), las reglas de cálculo y los tests de motor **no cambian**: reciben objetos `quote` planos, vengan de donde vengan.

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
- Propiedades permitidas: `serviceType`, `pricingMode`, `unit`, `step`, `traceId`, `variable`, `resourceType`, `source` (enums cortos `[a-z0-9_]`), `completed`, `isDemo` (booleanos) y `count` (entero 0–10000).
- Todo lo demás se descarta: **nunca** montos, salarios, costos, tarifas, nombres de clientes ni texto libre. Permitido: `user_finished_quote = true`. No permitido: `monthly_labor_cost = 85000000`.

## 9. Trazas "Ver cálculo"

Los motores devuelven trazas **de datos** (`createTrace`): `{ id, title, formula, inputs[], steps[], result, notes[] }`, cada ítem con `label`, `value`, `format` (`money`, `rate`, `percent`, `days`, `km`, `liters`, `hours`, `number`, `text`) y `unit`. La UI las muestra con `traceButton(trace)` / `openTraceDialog(trace)` usando `formatValue`, nunca con HTML.

`computeQuote` devuelve `traces.totalCost`, `traces.breakEven`, `traces.floorRate`, `traces.targetRate`, `traces.expectedResult`, `traces.financialCost` y `traces.logistics`; `traceMarginVsMarkup` explica margen vs markup. Si una pantalla muestra un resultado sin traza del motor, la construye con `createTrace` (fórmula + entradas + resultado). Regla: **ningún número mágico**.

## 10. Routing y sub-ruta `/COTIZADORWEB/`

- Router por **hash** (`#/…`): nunca toca el `pathname`, así que funciona igual en `https://joaquinvedova1.github.io/COTIZADORWEB/`, en `http://localhost:8080/COTIZADORWEB/`, en la raíz de otro dominio o en cualquier hosting estático (Vercel, Netlify, S3), sin reglas de reescritura.
- Rutas: `#/` (Dashboard), `#/cotizaciones`, `#/cotizaciones/nueva`, `#/cotizaciones/:id`, `#/cotizaciones/:id/:step`, `#/biblioteca`, `#/biblioteca/:tab` (`personal`, `convenios`, `equipos`, `materiales`, `ubicaciones`), `#/servicios`, `#/configuracion`; cualquier otra → "no encontrado".
- Vistas cargadas con `import()` dinámico y rutas relativas. Si una vista falla, el router muestra una tarjeta de error con "Reintentar" sin romper la app.
- Todos los recursos usan rutas relativas (`./css/…`, `./js/app.js`, `./version.json`). **Nunca** `/js/…`: en Pages eso apuntaría a la raíz del dominio y daría 404.
- ES modules requieren HTTP: la app **no funciona con `file://`**.

## 11. Seguridad del frontend

- **CSP** en `index.html`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`, más `referrer: no-referrer`. Sin scripts inline, sin CDNs, sin conexiones a terceros.
- DOM seguro: `h()` inserta texto con nodos de texto; los estilos dinámicos se aplican por CSSOM (`el.style.setProperty`), compatible con la CSP.
- `setPath` y `validateState` rechazan claves `__proto__`, `prototype`, `constructor` (prototype pollution).
- Backups: límite de 5 MB, JSON validado y migrado **antes** de aplicarse, resumen + confirmación del usuario, copia de recuperación previa.
- Todo JavaScript es público: no hay secretos, tokens ni claves en el repositorio.

## 12. Decisiones y trade-offs

| Decisión | Por qué | Costo aceptado |
|---|---|---|
| Sin frameworks ni dependencias npm | Superficie de ataque mínima, sin build obligatorio, carga rápida, nada que actualizar. | Más código propio para DOM y componentes. |
| ES modules nativos | Funciona en cualquier hosting estático; los mismos módulos corren en Node (tests). | No funciona con `file://`; sin bundling. |
| Motores puros con objetos planos | Reproducibles, testeables con `node --test`, reutilizables en backend futuro. | La UI recalcula todo el modelo en cada cambio (rápido para el tamaño actual). |
| Repositorio asíncrono sobre `localStorage` síncrono | Permite cambiar a Supabase sin tocar servicios ni vistas. | `async` innecesario hoy. |
| Un único documento en `rateos.state` | Escrituras atómicas, backup = estado, migraciones simples. | Reescribe todo el estado en cada guardado; límite ~5 MB del navegador. |
| Router por hash | Compatible con sub-rutas de Pages sin `404.html`. | URLs con `#`. |
| Las cotizaciones copian valores de la biblioteca | Auditabilidad: una cotización no cambia si cambia la biblioteca. | Actualizar una cotización vieja requiere volver a aplicar el recurso. |
| Interés simple, mes de 30 días | Explicable a una PyME y verificable a mano. | Aproximación del costo financiero real. |
| Break-even numérico (grilla 0,1 + bisección) | Robusto con reglas no lineales (mínimo garantizado, tramos, minimum call). | Más evaluaciones del motor (despreciable). |
