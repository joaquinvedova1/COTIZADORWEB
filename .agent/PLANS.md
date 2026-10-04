# Execution Plans

Los cambios grandes de RATEOS se planifican **antes** de escribir código, en este archivo. Un plan hace explícito qué cambia, cómo se prueba, cómo se vuelve atrás y quién revisa cada perspectiva. Reglas generales en [AGENTS.md](../AGENTS.md); roles de revisión en [docs/AGENT_ROLES.md](../docs/AGENT_ROLES.md).

## Cuándo hace falta un plan

Obligatorio para:

- Nueva modalidad contractual (por ejemplo, tarifa por viaje, por m³, por tonelada, lump sum, costo + fee).
- Cambios en el motor de costos (`js/engines/**`).
- Cambios en el cálculo de margen, markup, tarifa piso o precio objetivo.
- Nuevo motor de utilización o cambios en break-even.
- Backend (Supabase u otro).
- Autenticación y roles.
- Multiempresa.
- Migraciones de datos (`SCHEMA_VERSION`).

No hace falta para: correcciones de texto, estilos, bugs acotados sin cambio de fórmula (igual llevan test), documentación.

## Cómo usarlo

1. Copiar la plantilla al final de "Registro de planes" con estado **Borrador**.
2. Completar todas las secciones (si una no aplica, escribir "No aplica" y por qué).
3. Revisar el plan desde las perspectivas de [AGENT_ROLES.md](../docs/AGENT_ROLES.md) que correspondan → estado **Aprobado**.
4. Implementar en una rama, actualizar la bitácora → **En curso**.
5. Al mergear el PR → **Completado** (o **Descartado**, con el motivo).

---

## Plantilla

```markdown
### PLAN-AAAA-NNN — <título corto>

- Estado: Borrador | Aprobado | En curso | Completado | Descartado
- Tipo: nueva modalidad contractual | motor de costos | margen | utilización | backend | autenticación | multiempresa | migración | otro
- Responsable: <persona o agente>
- Fecha de inicio: AAAA-MM-DD · Fecha de cierre: AAAA-MM-DD
- Rama / PR: <rama> · #<número>

#### 1. Contexto y problema
Qué pasa hoy, quién lo sufre y por qué importa (en lenguaje de PyME).

#### 2. Objetivo y no-objetivos
- Objetivo:
- Fuera de alcance (protección de scope: no ERP, payroll, CRM, marketplace, facturación, gestor documental, IA):

#### 3. Impacto en fórmulas
- Fórmulas que cambian (antes → después), archivo y función:
- Caso numérico de verificación (entradas → resultado esperado):
- Golden cases afectados (deben seguir pasando; si alguno cambia, justificar):
- Margen y markup siguen diferenciados: sí / explicar

#### 4. Impacto en datos
- ¿Cambia el formato? `SCHEMA_VERSION` N → N+1, `migrateVNToVN+1`:
- Compatibilidad de backups anteriores:
- ¿Algún dato podría perderse? (debe ser "no"):

#### 5. Diseño
- Capas y archivos afectados (UI / servicios / motores / datos):
- Reglas de dependencia respetadas (`tests/architecture.test.js`):
- Feature flag (si aplica):

#### 6. Pasos
- [ ] 1.
- [ ] 2.

#### 7. Tests
- Tests nuevos (unitarios, golden cases, migraciones):
- Casos extremos cubiertos (0 días, margen 0 / ≥ 100, utilización 100 % y ~0, precio < costo, vacíos, negativos):
- Verificación manual con `npm start` en `/COTIZADORWEB/`:

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|

#### 9. Rollback
Cómo se vuelve atrás (revert vía PR; redeploy de tag/SHA; qué pasa con datos ya migrados).

#### 10. Review multidisciplinario
- Economía: ¿la fórmula es correcta?
- QA: ¿qué pasa en los casos extremos?
- Seguridad: ¿se validan los inputs? ¿secretos, XSS, RLS?
- UX: ¿la persona usuaria entiende el resultado? ¿hay "Ver cálculo"?

#### 11. Documentación
- [ ] docs/CALCULATION_RULES.md  - [ ] docs/DATA_MODEL.md  - [ ] docs/ARCHITECTURE.md
- [ ] CHANGELOG.md  - [ ] README.md  - [ ] otros:

#### 12. Criterio de terminación
`npm test` en verde, CI en verde, documentación actualizada, review completo, deploy verificado.

#### Bitácora
- AAAA-MM-DD — decisión / avance.
```

---

## Registro de planes

| ID | Título | Tipo | Estado |
|---|---|---|---|
| PLAN-2026-001 | MVP funcional RATEOS v0.1.0 | motor de costos, migración, otro | En curso — pendiente de merge |
| PLAN-2026-002 | Impuestos sobre la facturación (gross-up) y composición del precio | margen, motor de costos, migración | En curso |

### PLAN-2026-001 — MVP funcional RATEOS v0.1.0

- Estado: En curso — pendiente de merge (pasa a **Completado** recién al mergear el PR a `main`, con fecha de cierre y nota en la bitácora)
- Tipo: motor de costos · margen · utilización · migración (esquema inicial v1) · deploy
- Responsable: equipo de agentes de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-03 · Fecha de cierre: pendiente (al mergear)
- Rama / PR: `claude/wonderful-brown-g2ehd6` → `main` (Pull Request pendiente de revisión; sin merge automático)

#### 1. Contexto y problema
Las PyMEs proveedoras de Oil & Gas de Neuquén / Vaca Muerta cotizan con planillas y conocimiento informal y olvidan costos (relevos, cargas, standby, financiero, utilización real). Objetivo de negocio: evitar ganar una licitación y perder plata ejecutándola.

#### 2. Objetivo y no-objetivos
- Objetivo: un producto **usable** en `https://joaquinvedova1.github.io/COTIZADORWEB/` con las 17 prioridades: cotizaciones reales; EECC con monto e incidencia %; on-call; tarifa/utilización; break-even; personal y convenios parametrizables; equipos; logística; costo financiero; margen vs markup; sensibilidad; descuentos por días/volumen; Cost Completeness Score; persistencia local; backup/import; tests; deploy automático.
- Fuera de alcance: backend, Supabase, Firebase, login, APIs externas, analytics, IA; ERP, payroll, CRM, facturación.

#### 3. Impacto en fórmulas
- Motores nuevos en `js/engines/` (CostEngine, PricingEngine, UtilizationEngine, BreakEvenEngine, FinancialEngine, CommercialRulesEngine, ScenarioEngine, más labor, equipment, logistics, materials, economics, completeness y quote). Fórmulas documentadas en [docs/CALCULATION_RULES.md](../docs/CALCULATION_RULES.md).
- Golden cases: on-call 30.000.000 / 1.000.000 / 4.000.000 → 10 días; margen 10 % sobre 100 → 111,11; markup 10 % sobre 100 → 110.

#### 4. Impacto en datos
- Esquema inicial `schemaVersion` 1 en `rateos.state`; migración `migrateV0ToV1` para datos sin versión; copias de recuperación; modo sólo lectura ante versiones más nuevas.
- Backup JSON versionado compatible con el futuro modelo Supabase ([docs/DATA_MODEL.md](../docs/DATA_MODEL.md)).

#### 5. Diseño
Capas UI → servicios → motores → datos, con `StorageRepository` y `LocalStorageRepository`; configuración central en `js/config.js`; router por hash compatible con `/COTIZADORWEB/`; sin dependencias npm. Ver [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

#### 6. Pasos
- [x] Núcleo: `js/core`, `js/domain`, `js/engines`, `js/data`, `js/services`.
- [x] Primitivas de UI (`dom.js`, `components.js`) y sistema de diseño.
- [x] App shell, router, layout, vistas, editor de 11 pasos y resultado.
- [x] Datos demo ILUSTRATIVOS (Patagonia Servicios SRL, Hidrogrúa on-call — Añelo, caso de referencia).
- [x] Tests (`npm test`): core, datos, servicios, motores, golden cases, arquitectura, build.
- [x] Build (`scripts/build.mjs`), servidor local (`scripts/serve.mjs`), workflows de CI y deploy, Dependabot para actions.
- [x] Documentación (README, AGENTS, CHANGELOG, docs/*, plantilla de PR).
- [x] Review multidisciplinario (Economía, QA, Seguridad, Datos, UX, cumplimiento) y correcciones de los hallazgos confirmados (ver CHANGELOG, "Correcciones de la revisión multidisciplinaria").
- [ ] Merge del Pull Request a `main` (revisión del dueño del repositorio).
- [ ] Configurar Pages en "GitHub Actions", verificar el deploy y crear el tag `v0.1.0`.

#### 7. Tests
`npm test` (Node ≥ 20, `node --test`) cubre motores (margen, markup, tarifa piso, break-even, utilización, on-call, fijos/variables, descuentos, standby, minimum call, fee de disponibilidad, costo financiero, volumen, permanencia, casos extremos), datos (migraciones, validación, backup), servicios, golden cases, reglas de arquitectura y build bajo `/COTIZADORWEB/`.

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Se toman valores demo como reales | Banners y etiquetas ILUSTRATIVO; parámetros de convenio genéricos e iguales entre convenios. |
| Pérdida de datos locales | Clave estable, migraciones, copias de recuperación, backup JSON, nunca `localStorage.clear()`. |
| Deploy sin tests | Workflow test → build → deploy; pasar Pages a "GitHub Actions" ([docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)). |
| Error de fórmula | Golden cases, trazas "Ver cálculo", review multidisciplinario. |

#### 9. Rollback
Revert vía PR o redeploy manual de un tag/SHA anterior con `workflow_dispatch` ([docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#5-rollback)).

#### 10. Review multidisciplinario
Economía (fórmulas y golden cases), QA (casos extremos y flujos), Seguridad (CSP, DOM seguro, backups, sin secretos), UX (lenguaje simple, "Ver cálculo", ILUSTRATIVO) — registrado en el Pull Request. La revisión multidisciplinaria encontró, entre otros: pérdida de datos con dos pestañas abiertas, importación de JSON ajenos o mal formados, deploy manual de ramas sin PR, semáforo de tramos optimista con minimum call, alerta "bajo piso" con resultado positivo, trazas que no explicaban el número mostrado, defaults ILUSTRATIVOS contados como definidos y montos en formato argentino mal interpretados. Los hallazgos confirmados se corrigieron con tests de regresión; los golden cases no cambiaron.

#### 11. Documentación
- [x] docs/CALCULATION_RULES.md  - [x] docs/DATA_MODEL.md  - [x] docs/ARCHITECTURE.md
- [x] CHANGELOG.md  - [x] README.md  - [x] docs/DEPLOYMENT.md, docs/AUTH_ARCHITECTURE.md, docs/SUPABASE_PLAN.md, docs/AGENT_ROLES.md

#### 12. Criterio de terminación
Web navegable bajo `/COTIZADORWEB/`, cotización creada de punta a punta, on-call, tarifa/utilización y break-even funcionando, EECC = 100 %, persistencia y export/import funcionando, `npm test` en verde, datos regulatorios demo marcados como ilustrativos, README actualizado. Después del merge: configurar Pages en "GitHub Actions" y crear el tag `v0.1.0`.

#### Limitaciones conocidas al cierre
- Unidades de tarifa soportadas: día, hora y mes (abono). Otras unidades (viaje, km, m³, tonelada, intervención, precio global) quedan para un plan futuro.
- Todos los tipos de servicio usan el mismo modelo económico (fijos mensuales + variables por día activo); no hay checklist específico de llave en mano.
- Datos sólo en el navegador de cada usuario (sin sincronización entre dispositivos: usar backup JSON); sin login ni multiusuario.
- Costo financiero con interés simple y mes de 30 días; el comparador de modelos usa una facturación simplificada.
- Escenarios y sensibilidad se calculan pero no se guardan; estimado vs real diseñado pero no implementado (`FEATURES.historicalComparison = false`).
- Varias pestañas: el repositorio adopta los cambios de otras pestañas antes de leer o escribir, pero no fusiona por campo: si dos pestañas editan la misma cotización a la vez, gana el último guardado.

#### Bitácora
- 2026-10-03 — Arquitectura en capas y contratos definidos; implementación del núcleo, UI, tests, CI/CD y documentación; PR abierto hacia `main` para revisión del dueño antes del merge.
- 2026-10-03 — Review multidisciplinario y correcciones: persistencia con varias pestañas, pantallas de recuperación (almacenamiento lleno, datos dañados sin espacio), borradores sin guardar, validaciones de importación, copias de recuperación eliminables, deploy restringido a commits de `main` con permisos por job, motor (peor caso de tramos con minimum call, `belowFloor` vs `belowFloorRate`, sensibilidad sin variaciones, "No aplica standby", margen sin tarifa comercial, trazas de break-even y tarifa piso, comparador con días > disponibles, umbrales de completitud 85/60), defaults ILUSTRATIVOS no definidos, marca ILUSTRATIVO por línea, números en formato argentino y tarifas mínimas mostradas hacia arriba. Documentación actualizada. Estado: en curso hasta el merge.

### PLAN-2026-002 — Impuestos sobre la facturación (gross-up) y composición del precio

- Estado: En curso
- Tipo: margen · motor de costos (precio) · migración (esquema 1 → 2)
- Responsable: agentes de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-04 · Fecha de cierre: pendiente (al mergear)
- Rama / PR: `claude/rateos-ux-progresivo` → PR pendiente (sin merge automático)

#### 1. Contexto y problema
Una estructura de costos profesional (planilla de «discriminación de precios» de contratos de servicios; análisis conceptual en [docs/REFERENCE_COST_STRUCTURE.md](../docs/REFERENCE_COST_STRUCTURE.md), sin datos de la planilla, que es privada) suma sobre el costo los impuestos que se pagan **sobre lo que se factura** (Ingresos Brutos, débitos y créditos, sellos) con un gross-up exacto. RATEOS no los contemplaba: su "tarifa piso" no era piso (cobrándola, la PyME pierde esos impuestos) y el margen real quedaba debajo del objetivo. Además, un margen objetivo inválido (≥ 100 %) se reemplazaba por 0 % en silencio y la "tarifa sugerida" quedaba igual a la piso.

#### 2. Objetivo y no-objetivos
- Objetivo (entrega A, P0): impuestos sobre la facturación cargados por el usuario (un % total o detalle, excluyentes; "no aplica"; valor de la empresa), gross-up exacto en piso, objetivo, sugerida, resultado, break-even, matriz, tramos, escenarios y comparador; guarda de margen inválido; aclarar "sin IVA" y "margen antes de Ganancias".
- Objetivo (entrega B, P1): "¿Cómo se forma tu precio?" (costo + impuestos + ganancia = 100 % del precio), apropiación por unidad y total del contrato, invariantes y "los números cierran".
- Fuera de alcance: alícuotas precargadas o "reales" (AGENTS.md §7), IVA, Ganancias neta, retenciones/percepciones, índices/polinómica, cuadro con varios ítems, dedicación %, costos únicos, no remunerativos y alquiler de equipos (siguiente iteración, con aprobación del dueño), nómina, herramientas del comitente.

#### 3. Impacto en fórmulas
- `pricing-engine`: `priceFromMarginAndTaxes(c, m, t) = c / (1 − m − t)` (null si m + t ≥ 100); `effectiveMarkupPct(m, t) = m / (1 − m − t)`; `priceLadder(…, t)` con `billingTaxes` y `gain` por fila.
- `commercial-rules-engine.requiredNetRate`: `(Costo / (1 − m − t) − otros ingresos) / unidades` (antes `/ (1 − m)`).
- `economics-engine.evaluateAt`: `resultado = facturación − t·facturación − costo` (antes `facturación − costo`); margen = resultado / facturación; markup = resultado / costo. `linearDecomposition`: contribución = ingreso por día × (1 − t) − variable; fijos netos = fijos − ingresos fijos × (1 − t).
- `break-even-engine`: contribución = p(1 − t) − v; tarifa mínima = (F/D + v)/(1 − t).
- `scenario-engine.compareCommercialModels`: k = 1 − m − t; G = Fijos/(1 − t); resultado = R(1 − t) − C.
- `quote-engine`: margen objetivo inválido o m + t ≥ 100 → sin objetivo/sugerida (`targetMarginInvalid`, `atRisk`), nunca 0 % en silencio.
- Casos de verificación (sintéticos): costo 100, m 10 %, t 10 % → 125; piso 111,11; markup 12,5 %. On-call 30M/1M/4M con t 10 % → 11,54 días; fijos 30M, variable 1M, 10 días, m 10 %, t 10 % → piso 4.444.444,44, objetivo 5.000.000, resultado 5.000.000 (10 %).
- Golden cases existentes: **ninguno cambia** (t = 0 por defecto). Nuevos: 6 (ver CALCULATION_RULES §22).
- Margen y markup siguen diferenciados: sí (markup efectivo rotulado "recargo sobre el costo").

#### 4. Impacto en datos
- `SCHEMA_VERSION` 1 → 2, `migrateV1ToV2`: `quote.billingTaxes` sin definir y `settings.defaultBillingTaxes = null`; valores ajenos a `legacy`. Datos v1 con estructura inesperada: migración + reparación (v0 → v1 → v2) sin perder nada.
- Backups v1 se importan migrándolos; un backup v2 en la versión anterior se rechaza ("más nueva") y los datos v2 se abren en sólo lectura en una pestaña vieja.
- ¿Algún dato podría perderse? No (copia `pre-migration-v1` antes de migrar; tests de migración).

#### 5. Diseño
- Dominio: `js/domain/billing-taxes.js` (forma de los datos), `BILLING_TAX_KINDS` / `BILLING_TAX_MODES` en catálogos (sólo nombres), `billingTaxesForNewQuote` en la fábrica.
- Motores: `billing-taxes-engine.js` + cambios arriba; `completeness-engine` regla `billing_taxes`; `core/validation` reglas `billingTax` y margen + t.
- Datos: migración, `validateState` (forma de `billingTaxes` y `defaultBillingTaxes`), reparación en la migración del repositorio.
- UI: etapa "El precio" (bloque de impuestos con ayuda: qué incluir y qué no), Configuración → parámetros económicos (valor de la empresa), resultado (rótulos, alerta crítica si están sin definir, composición del precio), sin fórmulas en la UI (test estático).
- Reglas de dependencia: respetadas (`tests/architecture.test.js`).

#### 6. Pasos
- [x] PN0 — Baseline de regresión antes de tocar el motor (21 casos).
- [x] PN2 — Motor: gross-up, break-even, matriz, tramos, escenarios, comparador, trazas, KPIs.
- [x] PN3 — Guarda de margen inválido / m + t ≥ 100.
- [x] Completitud, validación, valor de la empresa, esquema v2 + migración + reparación.
- [x] Golden cases, tests unitarios e invariantes.
- [x] Documentación (CALCULATION_RULES §13.1, DATA_MODEL, CHANGELOG).
- [ ] UI de la entrega A (editor, configuración, resultado, "sin IVA").
- [ ] Entrega B: composición del precio, apropiación, total del contrato, "los números cierran".
- [ ] Revisión adversarial económica y de UX; correcciones.
- [ ] PR (sin merge automático).

#### 7. Tests
- `tests/engines/billing-taxes.test.js` (pricing, datos, valor de la empresa, tarifa neta, break-even, cotización completa, invariantes, economía, escenarios y comparador), golden cases nuevos, `tests/engines/regression-baseline.test.js`, completitud (TOTAL_WEIGHT 23), validación, migraciones v1 → v2 y repositorio (migrado / reparado).
- Casos extremos: t sin definir / 0 / no aplica / inválido / 99,99; m + t = 100 y 99,99; 0 días; mínimo garantizado (el ajuste tributa); tarifa que cubre el costo pero no los impuestos (bajo piso).

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Se presentan alícuotas como reales | RATEOS no trae alícuotas; la demo queda "sin definir"; sólo nombres de impuestos. |
| Doble conteo (impuestos cargados también como costo o en imprevistos) | Ayuda en el campo: "si ya los cargaste como otro costo o en imprevistos, sacalos de ahí". Modos excluyentes. |
| Fórmula multiplicativa o sobre la lista por error | Golden 125 (no 123,46 ni 121), invariantes R = C + T + Resultado, test estático de la UI. |
| Cambios de completitud en cotizaciones existentes | Documentado en CHANGELOG y CALCULATION_RULES §19; los números económicos no cambian. |
| Rollback de código con datos ya migrados | Ver §9. |

#### 9. Rollback
Preferir corregir hacia adelante. Si se revierte el código, los datos ya migrados a v2 se abren en **sólo lectura** en la versión anterior (no se pierden ni se pisan); volver a desplegar la versión nueva los reabre. La copia `rateos.recovery.*.pre-migration-v1` permite volver al estado previo a la migración (perdiendo los cambios posteriores), y el backup JSON exportado con la versión nueva sólo se puede importar en una versión ≥ 2.

#### 10. Review multidisciplinario
- Economía: gross-up exacto, base = facturación neta total (incluye otros ingresos y ajuste por mínimo), impuestos fuera de la EECC y de las bases de contingencia y financiero, Sellos como aproximación proporcional documentada. Pendiente: revisión adversarial (§33 del pedido).
- QA: casos extremos arriba; baseline idéntico con t = 0.
- Seguridad: validación de cada % y del total; sin datos de la planilla en el repo (test de `.gitignore`); sin `innerHTML`.
- UX: "Ver cálculo" de los impuestos; aviso cuando están sin definir; lenguaje "impuestos sobre lo que facturás". Pendiente: revisión de UX (§34 del pedido).

#### 11. Documentación
- [x] docs/CALCULATION_RULES.md  - [x] docs/DATA_MODEL.md  - [ ] docs/ARCHITECTURE.md (no cambian las capas)
- [x] CHANGELOG.md  - [ ] README.md  - [x] docs/REFERENCE_COST_STRUCTURE.md

#### 12. Criterio de terminación
`npm test` en verde, golden cases nuevos y viejos en verde, baseline idéntico con t = 0, UI sin fórmulas propias, revisión económica y de UX registradas en el PR, E2E sin errores.

#### Bitácora
- 2026-10-04 — Análisis de la planilla de referencia (privada, fuera del repo) y propuesta con prioridades P0–P3; decisiones por defecto: demo "sin definir", Sellos proporcional.
- 2026-10-04 — PN0 (baseline), motor de la entrega A, esquema v2 con migración y reparación, completitud y validación, golden cases e invariantes, documentación de fórmulas y datos.
