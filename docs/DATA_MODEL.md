# Modelo de datos de RATEOS

Este documento describe el **modelo actual** (`schemaVersion` 2 desde PLAN-2026-002; v0.1.0 usaba el 1; guardado en `localStorage` y exportado como backup JSON) y el **modelo futuro relacional** pensado para Supabase/PostgreSQL multiempresa. El futuro **no está implementado**: es la guía para evolucionar sin reescribir los motores.

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
| `rateos.recovery.<fecha>.<motivo>` | Copia literal del estado anterior (si dos copias caen en el mismo milisegundo se agrega `.2`, `.3`…). Motivos: `corrupt`, `invalid`, `pre-migration-v<N>`, `before-import`, `before-demo-reset`. Se conservan las 3 más recientes (`MAX_RECOVERY_SNAPSHOTS`); las copias `corrupt` e `invalid` (texto original dañado o con estructura inesperada) se cuentan **aparte**, con su propio cupo de 3, para que una importación o restauración posterior nunca borre la única copia de esos datos. Se pueden descargar y **eliminar** desde Configuración → Copias de recuperación (para liberar espacio). Si una importación o la restauración de la demo fallan al escribir, la copia recién creada se elimina: no quedan copias huérfanas. |
| `rateos.ui` | Reservada para preferencias de interfaz (`STORAGE_KEYS.uiPrefs`); hoy sin uso. |

### Varias pestañas abiertas

Todas las pestañas de RATEOS de un mismo navegador comparten `rateos.state`. Antes de cada lectura o escritura, `LocalStorageRepository` relee la clave y, si otra pestaña la cambió, adopta esa versión (si es válida) antes de aplicar su propio cambio; la interfaz se refresca con el evento `storage`. Así ninguna pestaña borra cotizaciones creadas en otra y los códigos `COT-NNNN` no se repiten. **Limitación:** si dos pestañas editan la misma cotización a la vez, gana el último guardado. Detalle en [ARCHITECTURE.md §6](ARCHITECTURE.md#varias-pestañas).

### Almacenamiento lleno o datos que no se pueden abrir

- **Guardado que falla por cuota** (`quota_exceeded`): el estado guardado no cambia; el editor conserva la cotización como borrador sin guardar (también si se sale y se vuelve al editor), pide confirmación antes de cerrar la pestaña y ofrece "Descargar backup con estos cambios".
- **Almacenamiento que se puede leer pero no escribir, con datos guardados:** la app no abre la demo en memoria; muestra la pantalla de recuperación para descargar los datos tal cual.
- **Datos dañados sin espacio para la copia** (`corrupt_no_space`): no se toca el original y se muestra la pantalla de recuperación (descargar los datos guardados y las copias, reintentar).

### Estructura (schemaVersion 2)

El backup exportado (`StorageRepository.exportBackup()`, archivo `rateos-backup-AAAA-MM-DD-HH-MM-SS.json`, hora UTC) es el estado más `app` y `exportedAt`. Ejemplo abreviado:

```json
{
  "schemaVersion": 2,
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
  "quotes":   [ { "id": "…", "organizationId": "…", "code": "COT-0001", "name": "Hidrogrúa on-call — Añelo", "vatTreatment": "excluded", "billingTaxes": { "mode": "combined", "notApplicable": false, "combinedPct": null, "items": [] }, "…": "ver §3" } ],
  "settings": { "organizationId": "…", "fuelPricePerLiter": 1500, "defaultTargetMarginPct": 10, "defaultBillingTaxes": null, "…": "…" }
}
```

Puede existir además `legacy` (claves raíz y colecciones de recursos desconocidas preservadas por la migración v0 → v1; una `settings` que no era objeto, preservada por la v1 → v2). Una cotización también puede tener `legacy` (por ejemplo, un `billingTaxes` que no era objeto, preservado por la v1 → v2).

### Validación (`validateState`)

- `schemaVersion` igual a la versión actual; `organization` con `id`; `resources` objeto con las 5 listas; `services`, `quotes` listas; `settings` objeto.
- Cada lista: objetos con `id` string no vacío y **único**; `services` y `quotes` con `name` string.
- **Forma interna de cada cotización:** `labor`, `equipment`, `materials`, `otherCosts`, `logistics.vehicles`, `risk.items`, `rules.volumeTiers` y `billingTaxes.items` deben estar ausentes, ser `null` o ser **listas de objetos**; `activity`, `pricing`, `finance`, `logistics`, `rules`, `fuel`, `indirect`, `risk` y `billingTaxes` deben estar ausentes, ser `null` o ser **objetos**. `settings.defaultBillingTaxes` debe ser `null`, estar ausente o ser un objeto (con `items` lista de objetos). Una cotización con, por ejemplo, `labor: "x"` o `equipment: [null]` se rechaza.
- Sólo tipos JSON; números finitos; claves `__proto__`, `constructor`, `prototype` prohibidas.
- Límites: 5.000 elementos por colección, 20.000 caracteres por texto, profundidad 12. Backup importado: máximo 5 MB (`MAX_BACKUP_BYTES`).

Aunque llegue un registro inválido por otra vía, los motores ignoran las líneas que no son objetos y `QuoteService` marca esa cotización con `{ error: true }` en su resumen: no se rompen el dashboard ni el listado.

### Importación (`parseBackupText` → confirmación → `applyBackup`)

1. Se controla el tamaño (máximo 5 MB en bytes UTF-8), se parsea el JSON y se separan `app` y `exportedAt`.
2. `prepareImport` valida **antes** de migrar:
   - Un JSON **sin `schemaVersion`** (formato legado v0) debe tener al menos una colección de RATEOS (`organization` objeto, `quotes` o `services` listas, o `resources` objeto). Si no, se rechaza: "El archivo no es un backup de RATEOS…" (por ejemplo, un `package.json` o `{}`).
   - Un backup de la **versión actual** se valida tal como viene (completando sólo las claves ausentes): una colección con tipo incorrecto (por ejemplo, `quotes` que no es una lista) se rechaza en lugar de vaciarse en silencio.
3. Se migra a la versión actual (`migrateState`) y se valida (`validateState`). Nada se modifica todavía.
4. La UI muestra un resumen (organización, cantidad de cotizaciones, plantillas y recursos, fecha de exportación, versión de la app) y pide confirmación para **sobrescribir**.
5. `importBackup` guarda una copia de recuperación `before-import` y recién entonces reemplaza el estado. Si la escritura falla (por ejemplo, por cuota), los datos actuales quedan intactos y se elimina esa copia.

## 3. Entidades actuales y campos

### Organización (`organization`)

`id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `name`, `baseLocation`, `illustrative`, `notes` y, opcional, `industry` (tipo de empresa elegido en el onboarding `#/bienvenida`: `oil_gas_services`, `industrial_maintenance`, `transport`, `construction`, `other`). Es un campo aditivo: no cambia `schemaVersion` (los datos anteriores simplemente no lo tienen).

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
| `defaultBillingTaxes` | impuestos sobre la facturación de la empresa (misma forma que `quote.billingTaxes`). `null` = sin definir: **RATEOS no trae alícuotas**. Puede ser un objeto todavía sin decidir (se guarda lo cargado para no perderlo al cambiar de modo). Si la empresa ya decidió, cada cotización nueva arranca con este valor, aunque `illustrative` sea `true` | `null` |
| `illustrative` | marca de datos de ejemplo. Con `true`, una cotización nueva en blanco **no** toma como definidos el plazo de cobro (queda `null`) ni la contingencia (queda en 0), y marca el combustible como ILUSTRATIVO (ver [CALCULATION_RULES.md §19](CALCULATION_RULES.md#19-cost-completeness-score)) | true |
| `scenarios` (opcional) | variaciones pesimista/optimista | `DEFAULT_SCENARIOS` |
| `lastQuoteNumber` | último número de cotización asignado (contador monotónico de códigos `COT-NNNN`: el próximo código es `max(mayor código existente, lastQuoteNumber) + 1`, así nunca se reutiliza el de una cotización eliminada) | se crea al generar la primera cotización |

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

`id`, metadatos, `name`, `serviceType`, `description`, `illustrative`, `defaults` (cotización **parcial**: cualquier subconjunto de los campos de §3 "Cotización"). `createQuoteFromTemplate` combina `defaults` sobre una cotización vacía y asigna ids nuevos a todas las líneas. Si la plantilla es ILUSTRATIVA, cada línea copiada (`labor`, `equipment`, `materials`, `otherCosts`, `logistics.vehicles`) queda con `illustrative: true`, y también `fuel.illustrative` si la plantilla trae precio de combustible; la cotización en sí queda con `illustrative: false`. La demo incluye 12 plantillas (Cuadrilla 24/7, Hidrogrúa on-call, Transporte, Water Transfer, Servicio ambiental, Movimiento de suelo, Taller móvil, Inspección, Soldadura, Mantenimiento, Generador, Camión con chofer).

### Cotización (`quotes[]`)

Creada por `createEmptyQuote` / `createQuoteFromTemplate`. Campos raíz:

| Campo | Tipo / valores |
|---|---|
| `id`, `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | metadatos |
| `code` | `COT-0001`… (secuencial por organización; `QuoteService` usa el contador monotónico `settings.lastQuoteNumber` para no reutilizar nunca el código de una cotización eliminada) |
| `name`, `client`, `notes` | texto |
| `status` | `draft`, `sent`, `won`, `lost`, `archived` |
| `illustrative` | true en las cotizaciones demo (toda la cotización es de demostración). Las líneas y el combustible tienen además su propia marca (ver abajo); `illustrativeInfo(quote)` (`js/domain/quote-factory.js`) resume ambas: `{ any, quote, lines, fuel }` |
| `serviceType` | `SERVICE_TYPES` (`on_call`, `permanent`, `crew`, `equipment_with_operator`, `equipment_only`, `per_unit`, `transport`, `turnkey`, `time_materials`, `lump_sum`, `configurable`) |
| `templateId` | plantilla de origen o `null` |
| `pricingMode` | `known_rate` (conozco la tarifa) / `known_activity` (conozco la actividad) |
| `unit` | `day`, `hour`, `month` |
| `contractMonths` | duración del contrato (descuento por continuidad) |
| `materialsNotApplicable` | el servicio no usa materiales |

Objetos embebidos:

| Objeto | Campos |
|---|---|
| `activity` | `availability` (`24/7`, `window`), `availabilityWindow`, `responseTimeHours`, `activeDaysPerMonth` (`null` = sin cargar; así empieza una cotización nueva en blanco), `daysPerActivation`, `availableDaysPerMonth`, `hoursPerActiveDay` |
| `labor[]` | `id`, `sourceId`, `role`, `agreementId`, `category`, `positions`, `peoplePerPosition`, `basicMonthly`, `additionalsMonthly`, `normalHoursPerMonth`, `overtimeHoursPerActiveDay`, `overtimePremiumPct`, `mealPerActiveDay`, `sacPct`, `vacationPct`, `employerContributionsPct`, `artPct`, `insuranceMonthly`, `ppeMonthly`, `trainingMonthly`, `transferMonthly`, `illustrative` (opcional) |
| `equipment[]` | `id`, `sourceId`, `name`, `quantity`, `hoursPerActiveDay` (`null` = usar el de la actividad), `replacementValue`, `usefulLifeYears`, `residualValue`, `insuranceAnnual`, `licenseAnnual`, `certificationsAnnual`, `capitalRatePctAnnual`, `maintenancePerHour`, `tiresPerHour`, `fuelLitersPerHour`, `illustrative` (opcional) |
| `materials[]` | `id`, `sourceId`, `description`, `unit`, `basis`, `quantity`, `unitCost`, `wastePct`, `logisticsPct`, `resaleMarkupPct`, `providedBy`, `illustrative` (opcional) |
| `otherCosts[]` | `id`, `description`, `category` (`labor`, `equipment`, `fuel`, `materials`, `logistics`, `structure`), `behavior` (`fixed_monthly`, `per_active_day`, `per_activation`), `amount`, `illustrative` (opcional) |
| `fuel` | `pricePerLiter`, `providedBy` (`contractor`, `client`), `illustrative` (opcional: el precio es el valor ILUSTRATIVO por defecto o de una plantilla demo) |
| `logistics` | `notApplicable`, `baseName`, `destinationName`, `distanceKm`, `roundTrip`, `tripsPerActivation`, `vehicles[]` { `id`, `name`, `count`, `consumptionLPer100Km`, `costPerKm`, `illustrative` (opcional) }, `tollsPerActivation`, `lodgingPerActivation` |
| `indirect` | `method` (`percent_direct`, `percent_labor`, `per_employee`, `per_contract`, `per_hour`, `manual`), `pct`, `amount` |
| `finance` | `paymentTermDays` (`null` = sin definir), `invoiceLagDays`, `monthlyRatePct`, `payDays` { `salaries`, `fuel`, `suppliers`, `materials`, `structure` } |
| `risk` | `generalPct`, `items[]` { `id` (`RISK_ITEMS`), `label`, `pct`, `enabled` } |
| `pricing` | `targetMarginPct`, `customMarginPct`, `knownRate`, `offeredRateOverride`, `commercialDiscountPct`, `roundingStep` |
| `billingTaxes` (v2) | impuestos que se pagan sobre lo que se factura (no son costo; gross-up en el precio, ver [CALCULATION_RULES.md §13.1](CALCULATION_RULES.md#131-impuestos-sobre-la-facturación-gross-up)): `mode` (`combined` = "Un % total" o `detailed` = "Detalle por impuesto", **excluyentes**), `notApplicable` ("No incluir impuestos sobre la facturación en esta cotización": elección de cálculo, no una afirmación fiscal), `combinedPct` (`null` = sin definir), `items[]` { `id`, `kind` (`gross_income`, `debits_credits`, `stamp`, `other`), `label`, `pct` } |
| `vatTreatment` (v2) | convención de montos de la cotización. Hoy sólo `excluded` ("Montos sin IVA": costos, tarifas y facturación se cargan y calculan sin IVA). Queda explícita para no asumirla en silencio: un valor distinto no se calcula como si fuera sin IVA (`validateQuote` informa un error). Ausente (datos v2 anteriores a este campo) = `excluded`. Ver [CALCULATION_RULES.md §13.1](CALCULATION_RULES.md#131-impuestos-sobre-la-facturación-gross-up) |
| `rules` | `availabilityFeeMonthly`, `calloutFeePerActivation`, `mobilizationFeePerActivation`, `includedKmPerActivation`, `extraKmRate`, `minimumCallUnits`, `standbyDaysPerMonth`, `standbyRatePerDay`, `standbyNotApplicable`, `volumeTiers[]` { `id`, `fromDays`, `toDays` (`null` = sin tope), `discountPct` }, `continuityMinMonths`, `continuityDiscountPct`, `minimumMonthlyGuarantee` |

Las líneas embebidas (`labor[]`, `equipment[]`, …) tienen `id` UUID propio pero no metadatos: pertenecen a la cotización. **Los resultados calculados no se guardan**: se recalculan con `computeQuote` (mismos inputs = mismos outputs).

**Marca ILUSTRATIVO por línea.** `line.illustrative = true` indica que los valores de esa línea vienen de datos de demostración: la copian `laborLineFromProfile` (si el perfil o el convenio son ilustrativos), `equipmentLineFromLibrary` y `materialLineFromLibrary` (si el recurso es ilustrativo) y `createQuoteFromTemplate` (si la plantilla es ilustrativa). El campo es opcional (las cotizaciones guardadas antes no lo tienen) y no requiere migración: `validateState` acepta campos adicionales en las líneas.

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
| `settings` | PK/FK `organization_id`, `locale`, `currency`, `fuel_price_per_liter`, `finance_monthly_rate_pct`, `default_target_margin_pct`, `default_contingency_pct`, `default_payment_term_days`, `rounding_step`, `matrix_days int[]`, `margin_ladder numeric[]`, `scenarios jsonb`, `default_billing_taxes jsonb`, `illustrative` | 1:1 con `organizations` |
| `labor_agreements` | `id`, `organization_id`, `code`, `name`, `params jsonb`, `notes`, `illustrative` | agregada a la lista conceptual porque el modelo actual ya tiene convenios |
| `labor_profiles` | `id`, `organization_id`, `agreement_id` (FK), `role`, `category`, `basic_monthly`, `additionals_monthly`, `normal_hours_per_month`, `overtime_hours_per_active_day`, `overtime_premium_pct`, `meal_per_active_day`, `sac_pct`, `vacation_pct`, `employer_contributions_pct`, `art_pct`, `insurance_monthly`, `ppe_monthly`, `training_monthly`, `transfer_monthly`, `illustrative` | FK `labor_agreements` |
| `employees_or_roles` | `id`, `organization_id`, `labor_profile_id` (FK), `alias` (nombre o puesto nominal), `active` | **nuevo** (no existe hoy). Minimizar datos: sin DNI, CUIL, domicilio ni datos de salud. |
| `equipment` | `id`, `organization_id`, `name`, `type`, `current_value`, `replacement_value`, `useful_life_years`, `residual_value`, `insurance_annual`, `license_annual`, `certifications_annual`, `capital_rate_pct_annual`, `maintenance_per_hour`, `tires_per_hour`, `fuel_liters_per_hour`, `available_hours_per_month`, `available_days_per_month`, `utilization_pct`, `illustrative` | — |
| `materials` | `id`, `organization_id`, `description`, `unit`, `unit_cost`, `basis`, `quantity`, `waste_pct`, `logistics_pct`, `resale_markup_pct`, `provided_by`, `illustrative` | — |
| `locations` | `id`, `organization_id`, `name`, `type`, `distance_from_base_km` | — |
| `service_templates` | `id`, `organization_id`, `name`, `service_type`, `description`, `defaults jsonb`, `illustrative` | — |
| `quotes` | `id`, `organization_id`, `code` (único por organización), `name`, `client`, `status`, `service_type`, `pricing_mode`, `unit`, `contract_months`, `template_id` (FK), `illustrative`, `notes`, `activity jsonb`, `fuel jsonb`, `logistics jsonb` (sin vehículos), `indirect jsonb`, `finance jsonb`, `risk jsonb`, `pricing jsonb`, `billing_taxes jsonb`, `materials_not_applicable`, `schema_version` | FK `service_templates` |
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
| `quote.activity`, `fuel`, `indirect`, `finance`, `risk`, `pricing`, `billingTaxes` | `quotes.*` jsonb (mismo formato) |
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
- `migrateState` aplica en orden las funciones registradas en `MIGRATIONS` (`js/data/migrations.js`):
  - `migrateV0ToV1` (datos sin versión → v1: completa colecciones, `organizationId`, `createdAt`, `updatedAt`; asigna un id nuevo al repetido si hay ids duplicados, conservando ambos registros; preserva claves raíz y colecciones de recursos desconocidas en `legacy`).
  - `migrateV1ToV2` (PLAN-2026-002, impuestos sobre la facturación): agrega `billingTaxes` **sin definir** a cada cotización (nunca se inventan alícuotas: los números no cambian y la interfaz avisa que la tarifa piso no incluye esos impuestos), `vatTreatment: 'excluded'` (la convención sin IVA con la que RATEOS siempre calculó, ahora explícita; si ya hubiera un valor, se conserva) y `settings.defaultBillingTaxes = null`. Un `billingTaxes` o una `settings` que no sean objeto se guardan en `legacy` (de la cotización o del estado). No toca ningún otro campo.
- Datos v1 que además tienen estructura inesperada: si la migración directa no da un estado válido, se normalizan como datos legados (v0 → v1 → v2) sin borrar nada (estado `repaired`; la copia previa queda en `pre-migration-v1`). Recién si eso tampoco funciona, se abren en sólo lectura.
- Para una versión nueva: subir `SCHEMA_VERSION`, agregar `migrateV1ToV2` (y luego `migrateV2ToV3`…) en `MIGRATIONS`, agregar tests en `tests/data/` con un estado v1 real (incluido el backup demo) y documentarlo en el [CHANGELOG](../CHANGELOG.md).
- Cada migración transforma N → N+1 **sin perder datos**. Antes de migrar se guarda `rateos.recovery.<fecha>.pre-migration-v<N>`. Si el resultado de la migración no pasa `validateState`, no se persiste nada (el original queda intacto) y la app abre en modo sólo lectura.
- Datos de una versión más nueva que la app → modo sólo lectura (no se pisan).
- Ejemplo de migración futura: `migrateV2ToV3` podría agregar `actualCosts: []` al estado (para estimado vs real) y `quote.schemaVersion`, sin tocar los campos existentes.
- **Varias pestañas durante un deploy:** una pestaña vieja (esquema 1) que ve datos v2 pasa a sólo lectura (no los pisa); una pestaña nueva migra los datos al abrir.

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
