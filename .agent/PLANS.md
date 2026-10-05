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
| PLAN-2026-003 | Usuarios reales: Supabase Auth + persistencia cloud con RLS | backend, autenticación, migración | Completado (PR #9) |
| PLAN-2026-004 | RATEOS ADMIN: rol de plataforma con metadata, sin datos de clientes | backend, autenticación | Completado (PR #12) |
| PLAN-2026-005 | Recursos con base económica, snapshots, equipos propios/externos y movilización | motor de costos, migración | En curso — PR sin merge, publicado en staging |

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
- `pricing-engine`: `priceFromMarginAndTaxes(c, m, t) = c / (1 − m − t)` (null si m + t ≥ 100); `markupWithTaxesPct(m, t) = (m + t) / (1 − m − t)` (markup = precio / costo − 1, AGENTS.md §9) y `profitOnCostPct(m, t) = m / (1 − m − t)` (ganancia sobre el costo, rotulada aparte); `priceLadder(…, t)` con `billingTaxes`, `gain`, `markupPct` y `profitOnCostPct` por fila. (La primera versión rotulaba como "markup efectivo" la ganancia sobre el costo; la revisión económica lo corrigió.)
- `commercial-rules-engine.requiredNetRate`: `(Costo / (1 − m − t) − otros ingresos) / unidades` (antes `/ (1 − m)`).
- `economics-engine.evaluateAt`: `resultado = facturación − t·facturación − costo` (antes `facturación − costo`); margen = resultado / facturación; markup = facturación / costo − 1; ganancia sobre el costo = resultado / costo. `linearDecomposition`: contribución = ingreso por día × (1 − t) − variable; fijos netos = fijos − ingresos fijos × (1 − t).
- `break-even-engine`: contribución = p(1 − t) − v; tarifa mínima = (F/D + v)/(1 − t).
- `scenario-engine.compareCommercialModels`: k = 1 − m − t; G = Fijos/(1 − t); resultado = R(1 − t) − C.
- `quote-engine`: margen objetivo inválido o m + t ≥ 100 → sin objetivo/sugerida (`targetMarginInvalid`, `atRisk`), nunca 0 % en silencio.
- Casos de verificación (sintéticos): costo 100, m 10 %, t 10 % → 125; piso 111,11; markup 25 %; ganancia sobre el costo 12,5 %. On-call 30M/1M/4M con t 10 % → 11,54 días; fijos 30M, variable 1M, 10 días, m 10 %, t 10 % → piso 4.444.444,44, objetivo 5.000.000, resultado 5.000.000 (10 %).
- Golden cases existentes: **ninguno cambia** (t = 0 por defecto). Nuevos: 7 (ver CALCULATION_RULES §22).
- Margen y markup siguen diferenciados: sí ("Markup (recargo sobre el costo)" y, con impuestos, "Ganancia sobre el costo" en columna aparte).

#### 4. Impacto en datos
- `SCHEMA_VERSION` 1 → 2, `migrateV1ToV2`: `quote.billingTaxes` sin definir, `quote.vatTreatment = 'excluded'` (convención sin IVA explícita) y `settings.defaultBillingTaxes = null`; valores ajenos a `legacy`. Datos v1 con estructura inesperada: migración + reparación (v0 → v1 → v2); el texto original queda en la copia de recuperación.
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
- [x] UI de la entrega A (editor, configuración, resultado, "sin IVA"); test estático: la interfaz no recalcula precios.
- [x] Entrega B: composición del precio, apropiación, total del contrato, "los números cierran" (`price-composition-engine.js`).
- [x] Revisión adversarial económica y de UX; correcciones (sin funcionalidades nuevas).
- [x] Cierre pedido por el dueño: copy de impuestos sin afirmaciones fiscales, primera vista del resultado con sólo 4 respuestas (el resto en "Profundizá"), convención "Montos sin IVA" explícita (`vatTreatment`).
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
- Economía: gross-up exacto, base = facturación neta total (incluye otros ingresos y ajuste por mínimo), impuestos fuera de la EECC y de las bases de contingencia y financiero, Sellos como aproximación proporcional documentada. Revisión adversarial hecha: sin bloqueantes; corregidos el rótulo del markup con impuestos (A1), la lectura de márgenes en texto (M1), la conversión del mínimo por llamado al cambiar de unidad (M2) y hallazgos menores. Limitación documentada: el costo financiero de pagar los impuestos antes de cobrar no se modela.
- QA: casos extremos arriba; baseline idéntico con t = 0.
- Seguridad: validación de cada % y del total; sin datos de la planilla en el repo (test de `.gitignore`); sin `innerHTML`.
- UX: "Ver cálculo" de los impuestos; aviso cuando están sin definir; lenguaje "impuestos sobre lo que facturás". Revisión de UX hecha: alertas en mobile, botón de la empresa, pérdida de datos en Configuración, textos con margen inválido, foco y nombres accesibles; la composición, estructura y apropiación pasaron a "Profundizá" para no saturar la primera vista.

#### 11. Documentación
- [x] docs/CALCULATION_RULES.md  - [x] docs/DATA_MODEL.md  - [ ] docs/ARCHITECTURE.md (no cambian las capas)
- [x] CHANGELOG.md  - [x] README.md (limitaciones)  - [x] docs/REFERENCE_COST_STRUCTURE.md  - [x] docs/UX.md

#### 12. Criterio de terminación
`npm test` en verde, golden cases nuevos y viejos en verde, baseline idéntico con t = 0, UI sin fórmulas propias, revisión económica y de UX registradas en el PR, E2E sin errores.

#### Bitácora
- 2026-10-04 — Análisis de la planilla de referencia (privada, fuera del repo) y propuesta con prioridades P0–P3; decisiones por defecto: demo "sin definir", Sellos proporcional.
- 2026-10-04 — PN0 (baseline), motor de la entrega A, esquema v2 con migración y reparación, completitud y validación, golden cases e invariantes, documentación de fórmulas y datos.
- 2026-10-04 — UI de la entrega A (etapa "El precio", Configuración, alertas, "Montos sin IVA") y entrega B (composición del precio, apropiación, total del contrato y controles de cuadre).
- 2026-10-04 — Revisiones adversariales económica y de UX y correcciones. Markup con impuestos corregido a precio / costo − 1 (25 % en el caso 100 / 10 % / 10 %) con "ganancia sobre el costo" (12,5 %) aparte; golden `markup-efectivo-con-impuestos` reemplazado por `markup-con-impuestos` y `ganancia-sobre-costo-con-impuestos`. Cierre de versión sin funcionalidades nuevas: copy no fiscal, resultado progresivo, `vatTreatment`.

### PLAN-2026-003 — Usuarios reales: Supabase Auth + persistencia cloud con RLS

- Estado: Completado — mergeado en `main` (PR #9) tras la prueba real en staging
- Tipo: backend (Supabase) · autenticación · migración de datos (modo local → cuenta)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-05 · Rama: `claude/supabase-auth-v1`

#### 1. Contexto y problema
Hasta v0.1.0 los datos vivían sólo en el navegador y el ingreso/registro eran pantallas preparadas. Para usar RATEOS con clientes hacen falta cuentas reales, datos por empresa y aislamiento garantizado por la base.

#### 2. Objetivo y no-objetivos
- Objetivo: tres estados separados (visitante, demo sin cuenta, usuario autenticado); registro con confirmación de email, ingreso, cierre, recuperación; empresa + OWNER al registrarse; datos de la cuenta en Supabase con RLS; importación opcional de los datos del modo local; sincronización con control de revisión; sesión vencida y sin conexión sin perder cambios.
- Fuera de alcance: invitaciones, Google OAuth, pagos, multiempresa por usuario, modelo normalizado, analytics, cambios en motores (P1/P2 del motor de costos).

#### 3. Impacto en fórmulas
Ninguno. `js/engines/**` no cambia; golden cases y baseline de regresión intactos.

#### 4. Impacto en datos
- Mismo estado versionado (`schemaVersion` 2), ahora en `workspace_states.state` (jsonb, una fila por organización). Sin cambio de `SCHEMA_VERSION`.
- `rateos.state` (modo local) nunca se borra; sus datos reales (sin demo ni ILUSTRATIVOS) se ofrecen para importar con copia previa.

#### 5. Diseño
- Base: migración `20261005013833_rateos_identity_workspace.sql` (4 tablas, RLS, grants por columna, helpers en `private`, trigger de alta, trigger de revisión). Ver [docs/SUPABASE_PLAN.md §0](../docs/SUPABASE_PLAN.md#0-qué-está-implementado).
- Frontend: SDK vendorizado; `auth-gateway` / `workspace-gateway` en `js/data/`; `SupabaseRepository` hereda de `LocalStorageRepository`; `AuthService`, `auth-routing`, contextos de cuenta y demo en `js/services/`; rutas con nivel de acceso. Ver [docs/AUTH_ARCHITECTURE.md](../docs/AUTH_ARCHITECTURE.md).
- Decisión jsonb vs normalizado: jsonb por simplicidad y riesgo cero en motores (tabla comparativa en SUPABASE_PLAN §0).

#### 6. Pasos
- [x] Inspección del proyecto Supabase con el plugin (vacío, sin tablas propias).
- [x] Migración aplicada con el plugin y versionada; tests de RLS (40/40) y advisors sin hallazgos.
- [x] Auth real (PKCE, enlaces bajo `/COTIZADORWEB/` con router por hash) y mensajes humanos.
- [x] `SupabaseRepository`, sincronización, conflictos, sin conexión, sesión vencida, importación local.
- [x] UX: guards, landing, demo aislada, cuenta nueva vacía, zona de cuenta, Configuración → Cuenta.
- [x] Tests unitarios + E2E (Playwright con Supabase simulado) desktop y mobile.
- [x] Revisión de seguridad adversarial y correcciones.
- [x] Configurar en el Dashboard: Site URL y Redirect URLs.
- [ ] SMTP propio antes de abrir el registro a clientes.
- [x] Prueba real con un email real en staging (`/preview/`) y merge del PR por el dueño del repositorio.

#### 7. Tests
`npm test` (sesión, rutas, repositorio con Supabase falso, aislamiento A/B, importación local, migraciones SQL estáticas, secretos), `supabase/tests/rls_test.sql` contra la base real, E2E con endpoints simulados (visitante, demo, usuario nuevo, existente, seguridad A/B, conflicto, sin conexión, sesión vencida, recuperación, importación).

#### 8. Riesgos y mitigación
Origen compartido de Pages (dominio propio recomendado), SMTP por defecto limitado, enlaces PKCE en otro navegador, límite de 5 MB por organización. Detalle en [docs/AUTH_ARCHITECTURE.md §9.1](../docs/AUTH_ARCHITECTURE.md#91-riesgos-conocidos-y-mitigaciones).

#### 9. Rollback
Revert del PR: el sitio vuelve al modo local (los datos de `rateos.state` nunca se tocaron). La base de Supabase puede quedar como está (sin consumidores) o revertirse con una migración nueva; nunca editando la base a mano.

#### 10. Review multidisciplinario
- Economía: sin cambios de fórmulas.
- QA: casos de red, conflicto, sesión vencida, cuenta vacía, importación sin demo.
- Seguridad: RLS probada, sin secretos, sin contraseñas guardadas, revisión adversarial con correcciones (copias por cuenta, sólo PKCE, cierre de sesión robusto, anti-clickjacking).
- UX: estados vacíos, mensajes humanos, nunca "guardado" si no se guardó.

#### 11. Documentación
README, AGENTS, ARCHITECTURE, DATA_MODEL, AUTH_ARCHITECTURE, SUPABASE_PLAN, UX, CHANGELOG, `supabase/README.md`.

#### 12. Criterio de terminación
CI verde, PR mergeado por el dueño, configuración de Auth hecha y un registro real probado de punta a punta.

#### Bitácora
- 2026-10-05: implementación, tests, E2E y revisión de seguridad en `claude/supabase-auth-v1`.
- 2026-10-05: registro real verificado en staging y en la base (perfil, empresa, OWNER, workspace vacío, sin demo); merge a `main` y deploy de producción.

### PLAN-2026-004 — RATEOS ADMIN: rol de plataforma con metadata, sin datos de clientes

- Estado: Completado — mergeado en `main` (PR #12)
- Tipo: backend (Supabase) · autenticación (rol de plataforma)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-05 · Rama: `claude/rateos-admin-v1`

#### 1. Contexto y problema
Con cuentas reales, el dueño de la plataforma necesita saber cuántos usuarios y empresas hay y cómo vienen usando RATEOS, sin acceder a los datos económicos de ninguna empresa.

#### 2. Objetivo y no-objetivos
- Objetivo: rol de plataforma RATEOS_ADMIN separado de los roles de empresa; alta del master (`joaquinvedova@hotmail.com`) por bootstrap server-side con email confirmado; panel `#/admin` con 4 indicadores y tabla de usuarios (metadata); entrada de menú e insignia sólo para admins; auditoría de apertura del panel.
- Fuera de alcance: impersonar, cambiar contraseñas, leer cotizaciones, editar workspaces de clientes, borrar empresas, suspender usuarios, modificar membresías, `service_role` en el frontend, pagos o planes, modelo normalizado, cambios en motores.

#### 3. Impacto en fórmulas
Ninguno. `js/engines/**` no cambia.

#### 4. Impacto en datos
Sin cambios en `workspace_states` ni en `SCHEMA_VERSION`. Tablas nuevas sólo en `private` (`platform_admins`, `platform_admin_bootstrap`, `admin_audit_log`). Las políticas RLS de `public` no cambian.

#### 5. Diseño
- Base: migración `20261005034916_rateos_platform_admin.sql` (tablas en `private` con RLS deny-all; `private.is_platform_admin()`; funciones `admin_*` que verifican el rol en cada llamada y nunca devuelven `state`; wrappers `public` security invoker; trigger de bootstrap en `auth.users`).
- Frontend: `js/data/admin-gateway.js` (sólo RPC, lista blanca de campos), `js/services/admin-service.js`, `js/ui/views/admin.js`, `ADMIN_NAV_ITEM` agregado al menú sólo si la base lo confirma. Ver [docs/AUTH_ARCHITECTURE.md §6.1](../docs/AUTH_ARCHITECTURE.md#61-rol-de-plataforma-rateos-admin).

#### 6. Pasos
- [x] Migración aplicada con el plugin (sin `drop trigger` sobre `auth.users`: pide ACCESS EXCLUSIVE; con `lock_timeout`).
- [x] `supabase/tests/rls_admin_test.sql` (32/32) y `rls_test.sql` (40/40) contra la base real.
- [x] Panel, menú condicional, insignia y guard de la ruta.
- [x] Tests unitarios, estáticos, de arquitectura y E2E desktop/mobile.
- [ ] Registrar y confirmar `joaquinvedova@hotmail.com` (el bootstrap la asocia sola) y probar en staging.
- [ ] Merge del PR por el dueño del repositorio.

#### 7. Tests
`tests/services/platform-admin.test.js` (identificación, separación OWNER/RATEOS_ADMIN, guard, menú, manipulación del frontend, admin sin acceso a otro workspace), `tests/supabase/migrations.test.js` (reglas del rol de plataforma), `tests/architecture.test.js` (sin email del master ni metadata en `js/`), `supabase/tests/rls_admin_test.sql` y E2E (usuario normal sin menú y `#/admin` rechazado; admin con menú y panel; tras cerrar sesión `#/admin` bloqueado).

#### 8. Riesgos y mitigación
- La cuenta hotmail todavía no existe: hasta que se registre y confirme, nadie es RATEOS_ADMIN (el panel no se puede ver en producción ni en staging).
- SMTP por defecto de Supabase: sólo entrega a miembros del equipo del proyecto.
- `last_sign_in_at` es la única señal de "última actividad" además del último guardado del workspace.

#### 9. Rollback
Revert del PR (el menú y el panel desaparecen). En la base, una migración nueva que borre el trigger y las tablas de `private` (nunca a mano); mientras tanto no afecta a ningún usuario.

#### 10. Review multidisciplinario
- Economía: sin cambios de fórmulas.
- QA: usuario normal, admin, anon, sesión cerrada, recarga directa en `#/admin`, errores de red (= no admin).
- Seguridad: autoridad sólo en Postgres, sin datos económicos en el panel, sin email hardcodeado en JS, ataques probados (metadata, email en el request, localStorage, PostgREST directo, `organizationId`, insertar en `platform_admins`, claims del JWT).
- UX: entrada discreta, insignia junto al rol de empresa, mensaje claro sin permisos.

#### 11. Documentación
AGENTS §19, AUTH_ARCHITECTURE §6.1, SUPABASE_PLAN §0, `supabase/README.md`, CHANGELOG.

#### 12. Criterio de terminación
CI verde, preview publicado, prueba del dueño en staging con la cuenta master y merge del PR por el dueño.

#### Bitácora
- 2026-10-05: migración aplicada, tests de base, frontend, tests y E2E en `claude/rateos-admin-v1`.

### PLAN-2026-005 — Recursos con base económica, snapshots, equipos propios/externos y movilización

- Estado: En curso — Pull Request hacia `main` sin merge automático; publicado en staging (`/preview/`)
- Tipo: motor de costos · migración de datos (esquema 2 → 3) · UX de Recursos y cotización
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-05 · Rama: `claude/resources-economic-base-v1`

#### 1. Contexto y problema
Las líneas de una cotización copian valores de Recursos, pero esa copia no es auditable: no tiene fecha base, moneda ni fuente, no recuerda qué tenía el recurso al copiarse (no se puede avisar si cambió) y se edita sin distinguir "valor de Recursos" de "ajuste de esta cotización". Sólo existen equipos propios (un alquiler o un servicio tercerizado es un "otro costo" suelto, sin tratamiento fiscal) y la movilización es una lista de vehículos de texto libre, desacoplada de los equipos (el mismo equipo se carga dos veces y se puede contar dos veces).

#### 2. Objetivo y no-objetivos
- Objetivo: base económica (período, moneda, fuente) en todo valor económico; snapshot por línea con detección de cambios y actualización MANUAL; base económica de la oferta con advertencias; catálogo de familias + modelos propios vs Mis equipos (legajo); obtención propio / alquilado / tercerizado con costo externo y tratamiento fiscal (costo económico ≠ salida de caja ≠ impuestos recuperables); movilización del equipo principal separada de la logística auxiliar; señales de doble conteo en el Cost Completeness Score; versión visible en la web.
- Fuera de alcance: redeterminación / "actualizar toda la oferta" (queda preparada), índices y polinómicas, condición de pago por proveedor en el costo financiero (se guarda y se muestra), IVA recuperable en el capital de trabajo (se informa aparte), catálogo global con marcas y modelos precargados, salarios en moneda extranjera, búsqueda automática de precios, tablas normalizadas en Supabase.

#### 3. Impacto en fórmulas
- Sin cambios para los datos existentes: líneas propias, materiales y viajes calculan igual (baseline de regresión de 21 casos y golden cases intactos).
- Nuevas fórmulas (CALCULATION_RULES §4.1, §5.1, §6.1, §19): costo externo por unidad (hora, día, mes, viaje, km, llamado, global) con mínimo; costo económico vs salida de caja; movilización propia por km (combustible en ruta + mantenimiento y neumáticos por km, sin amortización); conversión de moneda con tipo de cambio explícito de la cotización.
- Caso numérico: camión alquilado $ 1.000.000 neto/día con IVA 21 % recuperable → costo económico $ 1.000.000/día, salida de caja $ 1.210.000/día, crédito fiscal $ 210.000/día (antes no existía el concepto).

#### 4. Impacto en datos
- `SCHEMA_VERSION` 2 → 3 con `migrateV2ToV3` (copia de recuperación previa, ningún dato se borra).
- Nada inventado: fechas base existentes → "Base no definida"; moneda existente = moneda de la empresa (convención vigente, como "sin IVA"); movilidad sin definir (no cambia ningún número).
- Nuevas colecciones privadas del workspace: `resources.equipmentModels`, `resources.externalServices`. El catálogo global sólo tiene familias (descripción general, sin precios).

#### 5. Diseño
Detalle en [docs/RESOURCE_MODEL.md](../docs/RESOURCE_MODEL.md): RECURSO MAESTRO ≠ SNAPSHOT DE COTIZACIÓN.

#### 6. Pasos
- [ ] Modelo, migración v2 → v3, validación y backup.
- [ ] Motores: externo + fiscal, movilización, conversión de moneda, base económica, completitud.
- [ ] UX: Recursos (base, legajo, catálogo, externos), Configuración (combustible y tipo de cambio con base), cotización (snapshot, ajustes, propio/alquilado/tercerizado, movilización), Resultado (base económica de la oferta).
- [ ] Tests (casos A–F, migración, regresión), E2E desktop y mobile, revisión adversarial, docs.
- [ ] PR sin merge y staging.

#### 7. Tests
Casos de integración A–F (snapshot histórico, Vactor autopropulsado, retro + carretón tercerizado, alquiler con IVA recuperable, operador que maneja, material con base vieja), migración v2 → v3 sin cambios de números, baseline de regresión, fingerprints, conversión de moneda, NaN/Infinity/negativos.

#### 8. Riesgos y mitigación
- Staging comparte la base de producción: un preview con esquema 3 migraría el workspace real y producción lo abriría en sólo lectura. Mitigación: en builds de preview, antes de actualizar datos de la nube se pide confirmación; si no, se abren en sólo lectura sin tocar nada.
- Doble conteo (equipo y vehículo, operador y chofer, IVA como costo): reglas de completitud y trazas que lo explicitan.

#### 9. Rollback
Revert del PR. Los workspaces ya migrados a esquema 3 quedarían en sólo lectura en la versión anterior: antes de revertir, restaurar la copia previa a la migración (Configuración → Datos y backup) o mantener esta versión.

#### 10. Review multidisciplinario
Economía (fórmulas externas, fiscal, movilización), QA (casos extremos y migración), Seguridad (catálogo sin datos privados, validación de inputs), UX (progressive disclosure, "Base: sep-26"). Se deja escrito en el PR.

#### 11. Documentación
README, AGENTS, ARCHITECTURE, DATA_MODEL, CALCULATION_RULES, UX, CHANGELOG, RESOURCE_MODEL.

#### 12. Criterio de terminación
CI verde, preview publicado con la rama, prueba del dueño en staging y merge del PR por el dueño.

#### Bitácora
- 2026-10-05: inspección del modelo actual y diseño (respuestas a las 7 preguntas en el PR).

