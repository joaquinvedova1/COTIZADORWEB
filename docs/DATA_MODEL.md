# Modelo de datos de RATEOS

Este documento describe el **modelo actual** (v0.1.0, `schemaVersion` 1, guardado en `localStorage` y exportado como backup JSON) y el **modelo futuro relacional** pensado para Supabase/PostgreSQL multiempresa. El futuro **no está implementado**: es la guía para evolucionar sin reescribir los motores.

Código de referencia: `js/data/schema.js`, `js/data/migrations.js`, `js/data/local-storage-repository.js`, `js/domain/quote-factory.js`, `js/domain/demo-data.js`.

## 1. Principios

- **IDs estables tipo UUID v4** (`createId()` en `js/core/ids.js`). El nombre visible nunca es clave primaria. Los datos demo usan UUID fijos (`00000000-0000-4000-8000-…`) para ser determinísticos.
- **Multiempresa desde el diseño:** las entidades principales llevan `organizationId` aunque hoy exista una sola organización.
- **Metadatos:** `id`, `organizationId`, `createdAt`, `updatedAt` (ISO 8601 UTC) y `createdBy`, `updatedBy` (hoy `null`: no hay login; el campo existe para no tener que migrar cuando haya autenticación).
- **Formato limpio y versionado:** el mismo JSON sirve como estado local, backup y origen de la futura importación a Supabase.
- **Nunca se borran datos por un cambio de estructura:** migraciones explícitas, copia de recuperación previa y modo sólo lectura ante datos de una versión más nueva.
- **Las cotizaciones copian valores de la biblioteca** (`sourceId` guarda el origen): cambiar un recurso no altera cotizaciones existentes (auditabilidad).

## 2. Modelo actual — formato del estado y del backup

### Dónde se guarda

| Clave de `localStorage` | Contenido |
|---|---|
| `rateos.state` | Estado completo (JSON). Una sola clave; no depende de la versión de la app. |
| `rateos.recovery.<fecha>.<motivo>` | Copia literal del estado anterior (si dos copias caen en el mismo milisegundo se agrega `.2`, `.3`…). Motivos: `corrupt`, `invalid`, `pre-migration-v<N>`, `before-import`, `before-demo-reset`. Se conservan las 3 más recientes (`MAX_RECOVERY_SNAPSHOTS`); las copias `corrupt` se cuentan aparte para que una importación posterior nunca borre la única copia del original dañado. |
| `rateos.ui` | Reservada para preferencias de interfaz (`STORAGE_KEYS.uiPrefs`); hoy sin uso. |

### Estructura (schemaVersion 1)

El backup exportado (`StorageRepository.exportBackup()`, archivo `rateos-backup-AAAA-MM-DD-HH-MM-SS.json`, hora UTC) es el estado más `app` y `exportedAt`. Ejemplo abreviado:

```json
{
  "schemaVersion": 1,
  "app": { "name": "RATEOS", "version": "0.1.0" },
  "exportedAt": "2026-10-03T12:00:00.000Z",
  "organization": {
    "id": "00000000-0000-4000-8000-000000000001",
    "createdAt": "2026-10-01T12:00:00.000Z",
    "updatedAt": "2026-10-01T12:00:00.000Z",
    "createdBy": null,
    "updatedBy": null,
    "name": "Patagonia Servicios SRL",
    "baseLocation": "Neuquén Capital",
    "illustrative": true,
    "notes": "Empresa ficticia de demostración."
  },
  "resources": {
    "agreements":    [ { "id": "…", "organizationId": "…", "code": "petroleros_privados", "name": "Petroleros Privados", "params": { "normalHoursPerMonth": 176, "overtimePremiumPct": 50, "sacPct": 8.33, "vacationPct": 4, "employerContributionsPct": 24, "artPct": 6 }, "illustrative": true } ],
    "laborProfiles": [ { "id": "…", "organizationId": "…", "role": "Operador de hidrogrúa", "agreementId": "…", "basicMonthly": 1800000, "…": "…" } ],
    "equipment":     [ { "id": "…", "organizationId": "…", "name": "Hidrogrúa (camión con hidrogrúa)", "replacementValue": 250000000, "…": "…" } ],
    "materials":     [ { "id": "…", "organizationId": "…", "description": "Consumibles menores por llamado", "basis": "per_activation", "…": "…" } ],
    "locations":     [ { "id": "…", "organizationId": "…", "name": "Añelo", "type": "destination", "distanceFromBaseKm": 110 } ]
  },
  "services": [ { "id": "…", "organizationId": "…", "name": "Hidrogrúa on-call", "serviceType": "on_call", "description": "…", "defaults": { "…": "valores parciales de cotización" } } ],
  "quotes":   [ { "id": "…", "organizationId": "…", "code": "COT-0001", "name": "Hidrogrúa on-call — Añelo", "…": "ver §3" } ],
  "settings": { "organizationId": "…", "fuelPricePerLiter": 1500, "defaultTargetMarginPct": 10, "…": "…" }
}
```

Puede existir además `legacy` (claves raíz y colecciones de recursos desconocidas preservadas por la migración v0 → v1).

### Validación (`validateState`)

- `schemaVersion` igual a la versión actual; `organization` con `id`; `resources` objeto con las 5 listas; `services`, `quotes` listas; `settings` objeto.
- Cada lista: objetos con `id` string no vacío y **único**; `services` y `quotes` con `name` string.
- Sólo tipos JSON; números finitos; claves `__proto__`, `constructor`, `prototype` prohibidas.
- Límites: 5.000 elementos por colección, 20.000 caracteres por texto, profundidad 12. Backup importado: máximo 5 MB (`MAX_BACKUP_BYTES`).

### Importación (`parseBackupText` → confirmación → `applyBackup`)

1. Se parsea el JSON y se separan `app` y `exportedAt`.
2. Se migra a la versión actual (`migrateState`) y se valida (`validateState`). Nada se modifica todavía.
3. La UI muestra un resumen (organización, cantidad de cotizaciones, plantillas y recursos, fecha de exportación, versión de la app) y pide confirmación para **sobrescribir**.
4. `importBackup` guarda una copia de recuperación `before-import` y recién entonces reemplaza el estado.

## 3. Entidades actuales y campos

### Organización (`organization`)

`id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `name`, `baseLocation`, `illustrative`, `notes`.

### Configuración (`settings`)

| Campo | Uso | Default (ILUSTRATIVO) |
|---|---|---|
| `organizationId` | organización dueña | — |
| `locale`, `currency` | presentación | `es-AR`, `ARS` |
| `fuelPricePerLiter` | precio de combustible por defecto ($/L) | 1500 |
| `financeMonthlyRatePct` | tasa mensual por defecto | 3 |
| `defaultTargetMarginPct` | margen objetivo por defecto | 10 |
| `defaultContingencyPct` | contingencia por defecto | 5 |
| `defaultPaymentTermDays` | plazo de cobro sugerido | 60 |
| `roundingStep` | redondeo comercial | 1000 |
| `matrixDays` | días de la matriz tarifa × utilización | [5, 8, 10, 15, 20] |
| `marginLadder` | escalera de márgenes | [5, 10, 15] |
| `illustrative` | marca de datos de ejemplo | true |
| `scenarios` (opcional) | variaciones pesimista/optimista | `DEFAULT_SCENARIOS` |
| `lastQuoteNumber` | último número de cotización asignado (contador monotónico de códigos `COT-NNNN`) | se crea al generar la primera cotización |

### Recursos de biblioteca (`resources`)

Todos con `id`, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `illustrative`.

| Tipo | Campos |
|---|---|
| `agreements` (convenios) | `code` (`AGREEMENT_TYPES`), `name`, `params` { `normalHoursPerMonth`, `overtimePremiumPct`, `sacPct`, `vacationPct`, `employerContributionsPct`, `artPct` }, `notes`. Los parámetros demo son **genéricos e idénticos** para todos los convenios: no son valores de ningún CCT. |
| `laborProfiles` (perfiles de personal) | `role`, `agreementId`, `category`, `basicMonthly`, `additionalsMonthly`, `normalHoursPerMonth`, `overtimeHoursPerActiveDay`, `overtimePremiumPct`, `mealPerActiveDay`, `sacPct`, `vacationPct`, `employerContributionsPct`, `artPct`, `insuranceMonthly`, `ppeMonthly`, `trainingMonthly`, `transferMonthly`. |
| `equipment` (equipos y vehículos) | `name`, `type` (`vehicle`, `truck`, `crane_truck`, `crane`, `backhoe`, `generator`, `compressor`, `pump`, `trailer`, `tools`, `other`), `currentValue` (informativo), `replacementValue`, `usefulLifeYears`, `residualValue`, `insuranceAnnual`, `licenseAnnual`, `certificationsAnnual`, `capitalRatePctAnnual`, `maintenancePerHour`, `tiresPerHour`, `fuelLitersPerHour`, `availableHoursPerMonth`, `availableDaysPerMonth`, `utilizationPct`. |
| `materials` | `description`, `unit`, `unitCost`, `basis` (`per_month`, `per_active_day`, `per_activation`), `quantity`, `wastePct`, `logisticsPct`, `resaleMarkupPct`, `providedBy` (`contractor`, `third_party`, `client` o `null`). |
| `locations` | `name`, `type` (`base`, `destination`), `distanceFromBaseKm`. |

### Plantillas de servicio (`services`)

`id`, metadatos, `name`, `serviceType`, `description`, `illustrative`, `defaults` (cotización **parcial**: cualquier subconjunto de los campos de §3 "Cotización"). `createQuoteFromTemplate` combina `defaults` sobre una cotización vacía y asigna ids nuevos a todas las líneas. La demo incluye 12 plantillas (Cuadrilla 24/7, Hidrogrúa on-call, Transporte, Water Transfer, Servicio ambiental, Movimiento de suelo, Taller móvil, Inspección, Soldadura, Mantenimiento, Generador, Camión con chofer).

### Cotización (`quotes[]`)

Creada por `createEmptyQuote` / `createQuoteFromTemplate`. Campos raíz:

| Campo | Tipo / valores |
|---|---|
| `id`, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | metadatos |
| `code` | `COT-0001`… (secuencial por organización; `QuoteService` usa el contador monotónico `settings.lastQuoteNumber` para no reutilizar nunca el código de una cotización eliminada) |
| `name`, `client`, `notes` | texto |
| `status` | `draft`, `sent`, `won`, `lost`, `archived` |
| `illustrative` | true en las cotizaciones demo |
| `serviceType` | `SERVICE_TYPES` (`on_call`, `permanent`, `crew`, `equipment_with_operator`, `equipment_only`, `per_unit`, `transport`, `turnkey`, `time_materials`, `lump_sum`, `configurable`) |
| `templateId` | plantilla de origen o `null` |
| `pricingMode` | `known_rate` (conozco la tarifa) / `known_activity` (conozco la actividad) |
| `unit` | `day`, `hour`, `month` |
| `contractMonths` | duración del contrato (descuento por continuidad) |
| `materialsNotApplicable` | el servicio no usa materiales |

Objetos embebidos:

| Objeto | Campos |
|---|---|
| `activity` | `availability` (`24/7`, `window`), `availabilityWindow`, `responseTimeHours`, `activeDaysPerMonth`, `daysPerActivation`, `availableDaysPerMonth`, `hoursPerActiveDay` |
| `labor[]` | `id`, `sourceId`, `role`, `agreementId`, `category`, `positions`, `peoplePerPosition`, `basicMonthly`, `additionalsMonthly`, `normalHoursPerMonth`, `overtimeHoursPerActiveDay`, `overtimePremiumPct`, `mealPerActiveDay`, `sacPct`, `vacationPct`, `employerContributionsPct`, `artPct`, `insuranceMonthly`, `ppeMonthly`, `trainingMonthly`, `transferMonthly` |
| `equipment[]` | `id`, `sourceId`, `name`, `quantity`, `hoursPerActiveDay` (`null` = usar el de la actividad), `replacementValue`, `usefulLifeYears`, `residualValue`, `insuranceAnnual`, `licenseAnnual`, `certificationsAnnual`, `capitalRatePctAnnual`, `maintenancePerHour`, `tiresPerHour`, `fuelLitersPerHour` |
| `materials[]` | `id`, `sourceId`, `description`, `unit`, `basis`, `quantity`, `unitCost`, `wastePct`, `logisticsPct`, `resaleMarkupPct`, `providedBy` |
| `otherCosts[]` | `id`, `description`, `category` (`labor`, `equipment`, `fuel`, `materials`, `logistics`, `structure`), `behavior` (`fixed_monthly`, `per_active_day`, `per_activation`), `amount` |
| `fuel` | `pricePerLiter`, `providedBy` (`contractor`, `client`) |
| `logistics` | `notApplicable`, `baseName`, `destinationName`, `distanceKm`, `roundTrip`, `tripsPerActivation`, `vehicles[]` { `id`, `name`, `count`, `consumptionLPer100Km`, `costPerKm` }, `tollsPerActivation`, `lodgingPerActivation` |
| `indirect` | `method` (`percent_direct`, `percent_labor`, `per_employee`, `per_contract`, `per_hour`, `manual`), `pct`, `amount` |
| `finance` | `paymentTermDays` (`null` = sin definir), `invoiceLagDays`, `monthlyRatePct`, `payDays` { `salaries`, `fuel`, `suppliers`, `materials`, `structure` } |
| `risk` | `generalPct`, `items[]` { `id` (`RISK_ITEMS`), `label`, `pct`, `enabled` } |
| `pricing` | `targetMarginPct`, `customMarginPct`, `knownRate`, `offeredRateOverride`, `commercialDiscountPct`, `roundingStep` |
| `rules` | `availabilityFeeMonthly`, `calloutFeePerActivation`, `mobilizationFeePerActivation`, `includedKmPerActivation`, `extraKmRate`, `minimumCallUnits`, `standbyDaysPerMonth`, `standbyRatePerDay`, `standbyNotApplicable`, `volumeTiers[]` { `id`, `fromDays`, `toDays` (`null` = sin tope), `discountPct` }, `continuityMinMonths`, `continuityDiscountPct`, `minimumMonthlyGuarantee` |

Las líneas embebidas (`labor[]`, `equipment[]`, …) tienen `id` UUID propio pero no metadatos: pertenecen a la cotización. **Los resultados calculados no se guardan**: se recalculan con `computeQuote` (mismos inputs = mismos outputs).

## 4. Modelo futuro relacional (Supabase / PostgreSQL)

Convenciones: PK `id uuid`; toda tabla con datos empresariales lleva `organization_id uuid not null` (FK → `organizations.id`), `created_at`, `updated_at` (`timestamptz`), `created_by`, `updated_by` (FK → `users.id`, nullable) y **Row Level Security** (ver [SUPABASE_PLAN.md](SUPABASE_PLAN.md)). Montos `numeric(18,4)`, porcentajes `numeric(9,4)` en puntos.

```
organizations ─┬─< organization_members >── users (auth.users)
               ├─< settings (1:1)
               ├─< labor_agreements ─< labor_profiles ─< employees_or_roles
               ├─< equipment
               ├─< materials
               ├─< locations
               ├─< service_templates
               ├─< quotes ─┬─< quote_resources
               │           ├── commercial_rules (1:1)
               │           ├─< quote_scenarios
               │           ├─< cost_structures (snapshots)
               │           └─< services (servicio en ejecución, desde una cotización ganada)
               └─< actual_costs  (→ services / quotes)
```

| Tabla | Columnas clave | Relaciones |
|---|---|---|
| `organizations` | `id`, `name`, `base_location`, `illustrative`, metadatos | — |
| `users` | `id` (= `auth.users.id`), `display_name`, `created_at` | perfil público mínimo; el email vive en `auth.users` |
| `organization_members` | PK (`organization_id`, `user_id`), `role` (`OWNER`, `ADMIN`, `ESTIMATOR`, `VIEWER`), `invited_by`, `created_at` | FK a `organizations` y `users` |
| `settings` | PK/FK `organization_id`, `locale`, `currency`, `fuel_price_per_liter`, `finance_monthly_rate_pct`, `default_target_margin_pct`, `default_contingency_pct`, `default_payment_term_days`, `rounding_step`, `matrix_days int[]`, `margin_ladder numeric[]`, `scenarios jsonb`, `illustrative` | 1:1 con `organizations` |
| `labor_agreements` | `id`, `organization_id`, `code`, `name`, `params jsonb`, `notes`, `illustrative` | agregada a la lista conceptual porque el modelo actual ya tiene convenios |
| `labor_profiles` | `id`, `organization_id`, `agreement_id` (FK), `role`, `category`, `basic_monthly`, `additionals_monthly`, `normal_hours_per_month`, `overtime_hours_per_active_day`, `overtime_premium_pct`, `meal_per_active_day`, `sac_pct`, `vacation_pct`, `employer_contributions_pct`, `art_pct`, `insurance_monthly`, `ppe_monthly`, `training_monthly`, `transfer_monthly`, `illustrative` | FK `labor_agreements` |
| `employees_or_roles` | `id`, `organization_id`, `labor_profile_id` (FK), `alias` (nombre o puesto nominal), `active` | **nuevo** (no existe hoy). Minimizar datos: sin DNI, CUIL, domicilio ni datos de salud. |
| `equipment` | `id`, `organization_id`, `name`, `type`, `current_value`, `replacement_value`, `useful_life_years`, `residual_value`, `insurance_annual`, `license_annual`, `certifications_annual`, `capital_rate_pct_annual`, `maintenance_per_hour`, `tires_per_hour`, `fuel_liters_per_hour`, `available_hours_per_month`, `available_days_per_month`, `utilization_pct`, `illustrative` | — |
| `materials` | `id`, `organization_id`, `description`, `unit`, `unit_cost`, `basis`, `quantity`, `waste_pct`, `logistics_pct`, `resale_markup_pct`, `provided_by`, `illustrative` | — |
| `locations` | `id`, `organization_id`, `name`, `type`, `distance_from_base_km` | — |
| `service_templates` | `id`, `organization_id`, `name`, `service_type`, `description`, `defaults jsonb`, `illustrative` | — |
| `quotes` | `id`, `organization_id`, `code` (único por organización), `name`, `client`, `status`, `service_type`, `pricing_mode`, `unit`, `contract_months`, `template_id` (FK), `illustrative`, `notes`, `activity jsonb`, `fuel jsonb`, `logistics jsonb` (sin vehículos), `indirect jsonb`, `finance jsonb`, `risk jsonb`, `pricing jsonb`, `materials_not_applicable`, `schema_version` | FK `service_templates` |
| `quote_resources` | `id`, `organization_id`, `quote_id` (FK, cascade), `kind` (`labor`, `equipment`, `material`, `other_cost`, `vehicle`), `position` (orden), `source_id` (recurso de biblioteca de origen, nullable, sin FK estricta), `data jsonb` (campos de la línea) | FK `quotes` |
| `commercial_rules` | PK/FK `quote_id`, `organization_id`, columnas de `rules` (fees, km, minimum call, standby, continuidad, mínimo garantizado), `volume_tiers jsonb` | 1:1 con `quotes` |
| `quote_scenarios` | `id`, `organization_id`, `quote_id`, `kind` (`pessimistic`, `optimistic`, `sensitivity`, `custom`), `name`, `deltas jsonb` (`salariesPct`, `fuelPct`, `materialsPct`, `activityPct`, `paymentTermDays`, `commercialDiscountPct`) | FK `quotes` (hoy los escenarios no se guardan: se calculan) |
| `cost_structures` | `id`, `organization_id`, `quote_id`, `captured_at`, `reason` (`sent`, `won`, `manual`), `engine_version`, `active_days`, `total_cost`, `by_category jsonb` (monto e incidencia de las 8 categorías), `kpis jsonb` | snapshot **auditado** del cálculo al enviar/ganar; nunca reemplaza el recálculo |
| `services` | `id`, `organization_id`, `quote_id` (FK), `name`, `status` (`active`, `finished`), `starts_on`, `ends_on` | servicio en ejecución nacido de una cotización ganada |
| `actual_costs` | `id`, `organization_id`, `service_id` (FK), `quote_id` (FK), `period` (mes, `date`), `category` (8 categorías EECC), `concept`, `quantity`, `unit` (`h`, `L`, `km`, `día`), `amount`, `notes` | ver §6 |

Índices previstos: `(organization_id)` en todas las tablas; `(organization_id, code)` único en `quotes`; `(quote_id)` en tablas hijas; `(service_id, period)` en `actual_costs`.

### Mapeo modelo actual → tablas

| Hoy (JSON) | Futuro |
|---|---|
| `organization` | `organizations` (+ `organization_members` del usuario que importa como `OWNER`) |
| `settings` | `settings` |
| `resources.agreements[]` | `labor_agreements` |
| `resources.laborProfiles[]` | `labor_profiles` |
| `resources.equipment[]` | `equipment` |
| `resources.materials[]` | `materials` |
| `resources.locations[]` | `locations` |
| `services[]` (plantillas) | `service_templates` (`defaults` → `defaults jsonb`) |
| `quote` campos raíz | `quotes` columnas |
| `quote.activity`, `fuel`, `indirect`, `finance`, `risk`, `pricing` | `quotes.*` jsonb (mismo formato) |
| `quote.logistics` (sin `vehicles`) | `quotes.logistics` |
| `quote.logistics.vehicles[]` | `quote_resources` (`kind = 'vehicle'`) |
| `quote.labor[]`, `equipment[]`, `materials[]`, `otherCosts[]` | `quote_resources` (`kind` = `labor`, `equipment`, `material`, `other_cost`; `sourceId` → `source_id`) |
| `quote.rules` | `commercial_rules` (`volumeTiers` → `volume_tiers`) |
| `createdBy` / `updatedBy` (`null`) | `created_by` / `updated_by` = `auth.uid()` desde la migración |
| `legacy` | no se importa (queda en el backup JSON) |

`SupabaseRepository` reconstruye el **mismo objeto `quote` plano** que hoy (uniendo `quotes`, `quote_resources` y `commercial_rules`), así los motores no cambian.

## 5. Versionado de esquema y migraciones

**Local (JSON):**

- `SCHEMA_VERSION` en `js/config.js` y `schemaVersion` en el estado y en cada backup.
- `migrateState` aplica en orden las funciones registradas en `MIGRATIONS` (`js/data/migrations.js`); hoy existe `migrateV0ToV1` (datos sin versión → v1: completa colecciones, `organizationId`, `createdAt`, `updatedAt`; asigna un id nuevo al repetido si hay ids duplicados, conservando ambos registros; preserva claves raíz y colecciones de recursos desconocidas en `legacy`).
- Para una versión nueva: subir `SCHEMA_VERSION`, agregar `migrateV1ToV2` (y luego `migrateV2ToV3`…) en `MIGRATIONS`, agregar tests en `tests/data/` con un estado v1 real (incluido el backup demo) y documentarlo en el [CHANGELOG](../CHANGELOG.md).
- Cada migración transforma N → N+1 **sin perder datos**. Antes de migrar se guarda `rateos.recovery.<fecha>.pre-migration-v<N>`. Si el resultado de la migración no pasa `validateState`, no se persiste nada (el original queda intacto) y la app abre en modo sólo lectura.
- Datos de una versión más nueva que la app → modo sólo lectura (no se pisan).
- Ejemplo de migración futura: `migrateV1ToV2` podría agregar `actualCosts: []` al estado (para estimado vs real) y `quote.schemaVersion`, sin tocar los campos existentes.

**Futuro (PostgreSQL):** migraciones SQL versionadas en el repositorio (por ejemplo `supabase/migrations/AAAAMMDDHHMM_descripcion.sql`), aplicadas por CI, nunca a mano en producción; columna `schema_version` en `quotes` para convivir con cotizaciones creadas por versiones anteriores del motor.

## 6. Estimado vs real

Diseñado, **no implementado** (feature flag `FEATURES.historicalComparison = false`).

Objetivo: comparar lo cotizado con lo que realmente costó ejecutar el servicio, para aprender y ajustar futuras cotizaciones.

| Comparación | Estimado (cotización) | Real (`actual_costs`) |
|---|---|---|
| Horas de personal | horas normales y extra por días activos | horas reales (`unit = 'h'`, `category = 'labor'`) |
| Combustible | litros de equipos y traslados | litros y monto reales (`category = 'fuel'`) |
| Km | km mensuales de logística | km reales (`unit = 'km'`) |
| Equipos | días y horas usados | días y horas reales por equipo |
| Costo por categoría | EECC con D días reales | Σ `actual_costs.amount` por categoría y período |
| Margen | margen estimado | (facturación real − costo real) / facturación real |

Reglas: la comparación usa los días activos **reales** del período para recalcular el estimado (mismo motor, otra actividad); los costos reales nunca modifican la cotización original; los snapshots de `cost_structures` permiten comparar contra lo que se mostró al cliente.
