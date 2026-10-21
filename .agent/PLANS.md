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
| PLAN-2026-001 | MVP funcional RATEOS v0.1.0 | motor de costos, migración, otro | Completado (merge `18cd0ea`, v0.1.0) |
| PLAN-2026-002 | Impuestos sobre la facturación (gross-up) y composición del precio | margen, motor de costos, migración | Completado (PR #7) |
| PLAN-2026-003 | Usuarios reales: Supabase Auth + persistencia cloud con RLS | backend, autenticación, migración | Completado (PR #9) |
| PLAN-2026-004 | RATEOS ADMIN: rol de plataforma con metadata, sin datos de clientes | backend, autenticación | Completado (PR #12) |
| PLAN-2026-005 | Recursos con base económica, snapshots, equipos propios/externos y movilización | motor de costos, migración | Completado (PR #13, v0.2.0 en producción) |
| PLAN-2026-006 | Recurso maestro ≠ utilización de la cotización: dedicación, asignaciones y externos guardables | utilización, motor de costos, migración | Borrador — concepto aprobado, siguiente paso (sin código) |
| PLAN-2026-007 | Mantenimiento y neumáticos con forma de carga y avisos de sentido común | motor de costos, migración | Completado (PR #15, v0.4.0 en producción) |
| PLAN-2026-008 | Costeo de productos: receta, personal con convenio, máquinas, gastos fijos y precio con margen | motor de costos, margen, migración | Completado (v0.5.0) |
| PLAN-2026-009 | Unidades de facturación según el tipo de servicio: cantidad facturable × precio por unidad | motor de costos, utilización, migración | Completado (v0.6.0) |
| PLAN-2026-010 | Auditoría y pulido desde una cotización real (COT-0009): financiación de externos con IVA, trazabilidad y UX que evita cotizar mal | motor de costos, margen, migración | Completado (v0.7.0) |
| PLAN-2026-011 | "Cada salida se cuenta completa" (opcional) y plazo de pago por proveedor externo | motor de costos, utilización, migración | Completado (v0.7.1) |
| PLAN-2026-012 | Pulido desde casos reales de transporte (COT-0010 / COT-0011): viajes físicos, km del proveedor, combustible, recursos compartidos y "Usado en" | motor de costos, utilización, migración | Completado (v0.7.2) |
| PLAN-2026-013 | RATEOS Test Lab v1: oráculo económico independiente, escenarios con seed, invariantes, auditor de consistencia UX y mercado | otro (QA interno + correcciones de completitud que encontró) | Completado (main `37179e7`) |
| PLAN-2026-014 | Cierre de las decisiones LAB-D1…D8 de Test Lab: salidas fraccionarias, horas de cobertura del personal, financiación de productos, km facturables, equipo sin combustible, huecos de reglas, precio ilustrativo y terminología | motor de costos, productos, migración, UX | Completado (PR #24 mergeado, main `0c213a3`, v0.8.0 en producción) |
| PLAN-2026-015 | Beta Readiness v1: seguridad, tenancy, integridad y privacidad para una beta cerrada con empresas reales | backend, autenticación, otro (seguridad) | Completado (merge `998b932`, v0.8.1); beta con empresas externas **no iniciada**: HD-01/02/03 obligatorios antes de usuarios reales |
| PLAN-2026-016 | Beta Perimeter v1: preview público deshabilitado (HD-02), registro por invitación (HD-03), dominio propio (HD-01) y prueba A/B real | backend, autenticación, otro (infraestructura y seguridad) | Completado en la app (merge `d580d9f`, HD-02 publicado en el run #74); HD-01 y HD-03 esperan configuración del dueño (dominio, Auth, SMTP) |
| PLAN-2026-017 | ECO-01 — Bloqueantes económicos de la beta (AUD-T1 H-01, H-02, H-03): tramo / viaje completo / salida / km, doble abono mensual y puesto sin sueldo | motor de costos, completitud, UX | Completado (merge `d6540b7`, publicado en el run #75) |
| PLAN-2026-018 | HD-03 — Registro público con confirmación de email (decisión del dueño, 2026-10-20) y correos de Auth: diagnóstico del correo que no llegó, respuestas neutras sin enumeración, reenvío de la confirmación, código de recuperación, enlaces de invitación descartados y SMTP propio (Resend) | autenticación, UX, otro (correo) | En curso (rama `claude/wonderful-brown-g2ehd6` desde `main` `d6540b7`, PR #28 sin merge; la configuración de Auth/SMTP/DNS la hace el dueño) |
| PLAN-2026-019 | ECO-02 — Riesgo a la vista: resultado NO CONFIABLE marcado fuera del Resultado (listas, Inicio, Escenarios, PDF) y regla de "Enviada" | UX, completitud (presentación) | En curso (rama `claude/eco-02-riesgo-a-la-vista`, PR sin merge; espera revisión independiente y aprobación del dueño) |
| PLAN-2026-020 | ECO-03 — Redondeo comercial proporcional a la tarifa (VAL-01-F1): automático hasta 1 % sobre la objetivo, múltiplo fijo conservado en lo guardado, margen objetivo y real a la vista | motor (tarifa sugerida), UX | En curso (rama `claude/eco-03-redondeo`, PR sin merge; la ambigüedad de compatibilidad está documentada en §2 antes del cambio de regla) |
| PLAN-2026-021 | ECO-04 — Avisos verificables de la beta: abono con más días trabajados que disponibles (AUD-T1 H-04), vehículo de apoyo sin su costo de tenerlo (H-08) y operador de Personal que el externo ya trae (VAL-01-F2) | completitud, UX (sin cambios de fórmulas) | En curso (rama `claude/eco-04-abono-apoyo-operador`, PR sin merge) |
| PLAN-2026-022 | UX-01 — Formularios que pierden cambios sin avisar y valores que se corrigen en silencio: diálogos con formulario, valores que vuelven al anterior al salir, Configuración, "Mi cuenta" y avisos de error | UX (sin cambios de fórmulas ni de datos) | En curso (rama `claude/ux-01-no-perder-cambios`, PR sin merge) |
| PLAN-2026-023 | RES-02 (1/2) — Personal agrupado por convenio, perfiles ≠ personas, sueldo bruto sin doble conteo (con la base de las horas extra explícita) y convenios borrados sin referencias colgadas | UX, datos (campo opcional `peopleCount`, sin migración) | En curso (rama `claude/res-02-personal-por-convenio`, PR sin merge) |
| PLAN-2026-024 | RES-02 (2/2) — Equipos agrupados por familia (equipos de vacío y de pozo aparte de los camiones), unidades propias ≠ alquiladas o tercerizadas y costo de tener la flota propia | UX (sin cambios de fórmulas ni de datos) | En curso (rama `claude/res-02-equipos-por-familia`, apilada sobre el PR #33, sin merge) |
| PLAN-2026-025 | DESIGN-02 (1/2) — "Ingeniería clara": DESIGN.md propio y leer bien montos, unidades, riesgo y estado de guardado | UX, accesibilidad (sin fórmulas ni datos) | En curso (rama `claude/design-02-ingenieria-clara`, PR sin merge) |

### Pendientes registrados (sin implementar)

Mejoras de UX y funcionalidades que aparecieron en la revisión de cierre del MVP (2026-10-06). Se registran acá y **no** se implementan hasta que el dueño lo pida:

- **Recursos sin utilización** (PLAN-2026-006): el legajo del equipo todavía pide "Horas disponibles por mes" y "¿Qué parte de ese tiempo esperás que trabaje y facture?". Es un dato de cada cotización, no del recurso.
- **Dedicación / reserva de fijos** (PLAN-2026-006 §3.1–§4): implementada en PLAN-2026-012 (personal y equipos propios, % explícito en la cotización) junto con "Usado en". Quedan pendientes de PLAN-2026-006: sacar los datos de uso del legajo de Recursos, guardar en Recursos un externo cargado a mano y los estados "Activa" / "Finalizada".
- **Resultado:** el reparto "fijos · variables" del mes se ve en "Estructura de costos" y en "Ver cálculo", no en la tarjeta principal.
- **Externos en la cotización:** la línea muestra la salida de caja por día y el costo del mes, pero no rotula aparte el costo económico por día.
- **Desarrollo local:** al confirmar el email de una cuenta nueva en `localhost` (build de prueba), la app espera la respuesta al diálogo de "versión de prueba" con la landing de fondo. En producción no aparece.
- **Supabase Auth:** la protección contra contraseñas filtradas (advisor `auth_leaked_password_protection`) requiere el plan Pro.
- **GitHub Actions:** los PR de Dependabot que suben versiones mayores de las acciones (`checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`) siguen abiertos. Hoy funcionan forzadas a Node 24. Actualizarlas es un cambio de CI que hay que probar aparte.

### PLAN-2026-001 — MVP funcional RATEOS v0.1.0

- Estado: Completado — mergeado en `main` (`18cd0ea`, v0.1.0)
- Tipo: motor de costos · margen · utilización · migración (esquema inicial v1) · deploy
- Responsable: equipo de agentes de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-03 · Fecha de cierre: 2026-10-03
- Rama / PR: `claude/wonderful-brown-g2ehd6` → `main` (merge `18cd0ea`)

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

- Estado: Completado — mergeado en `main` (PR #7)
- Tipo: margen · motor de costos (precio) · migración (esquema 1 → 2)
- Responsable: agentes de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-04 · Fecha de cierre: 2026-10-04
- Rama / PR: `claude/rateos-ux-progresivo` → `main` (PR #7)

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

- Estado: Completado — PR #13 mergeado; v0.2.0 en producción (`f6b3c08`)
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
- [x] Modelo, migración v2 → v3, validación y backup.
- [x] Motores: externo + fiscal, movilización, conversión de moneda, base económica, completitud.
- [x] UX: Recursos (base, legajo, catálogo, externos), Configuración (combustible y tipo de cambio con base), cotización (snapshot, ajustes, propio/alquilado/tercerizado, movilización), Resultado (base económica de la oferta).
- [x] Tests (casos A–F, migración, regresión), E2E desktop y mobile, revisión adversarial, docs.
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
- 2026-10-05: modelo + migración v2 → v3 (sin cambios de números: baseline de 21 casos y migración con los mismos resultados); motores externo/fiscal, movilización, moneda, base económica y reglas de completitud; golden cases nuevos.
- 2026-10-05: UX de Recursos (legajo, externos, catálogo), Configuración (base del combustible y tipos de cambio), cotización (origen + base + aviso de cambios por línea, externos, operador, "Movilización y viajes", base económica de la oferta) y Resultado. Versión visible "v0.2.0 · build …".
- 2026-10-05: E2E con Supabase simulado (desktop y mobile): Recursos → cotización → snapshot (caso A: conservar / actualizar, persistido en la nube) → externos → movilización (casos B, C, E) → material con base vieja (F) → resultado; staging con datos v2: "sólo lectura" no escribe nada y "Actualizar mis datos" migra a v3. El E2E encontró que `loadVersionInfo` no pasaba `channel` (el resguardo de staging no se activaba): corregido con test.
- 2026-10-05: revisión adversarial (§36) económica y de datos/UX/seguridad; correcciones en el PR.

### PLAN-2026-006 — Recurso maestro ≠ utilización de la cotización: dedicación, asignaciones y externos guardables

- Estado: Borrador — concepto APROBADO por el dueño (2026-10-06) con la UX simplificada de §3.1; **sin código activo**. Es el siguiente paso después de PLAN-2026-007 (mantenimiento y neumáticos).
- Tipo: utilización · motor de costos (dedicación) · migración de datos (esquema 3 → 4, sin cambios de datos) · UX de Recursos y cotización
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-05 · Rama: `claude/resource-usage-in-quote` (apilada sobre `claude/wonderful-brown-g2ehd6`, PR #14)

#### 1. Contexto y problema
Recursos es el maestro / inventario de la empresa, pero el legajo de un equipo pide **días disponibles por mes, horas disponibles por mes y "% que esperás que trabaje y facture"** (obligatorios), y el perfil de personal pide **horas extra por día activo**. Al dar de alta un camión o una persona todavía no se sabe cuánto va a trabajar: eso depende de cada cotización. Hoy además no se puede (a) cargar que un recurso se comparte con otros servicios, (b) guardar en Recursos un tercerizado cargado a mano en una cotización, ni (c) ver en qué cotizaciones o contratos se está usando un recurso.

#### 2. Análisis de impacto en el motor actual (antes de cambiar nada)

| Dato del recurso | ¿Quién lo usa hoy? | ¿Cambia algún número de una cotización? |
|---|---|---|
| `equipment.availableHoursPerMonth`, `availableDaysPerMonth`, `utilizationPct` | **Sólo** `computeEquipmentUnit` para la FICHA de Recursos (`resource-service.equipmentCard`: "$/hora usada", "$/día usado", "$/mes a la utilización configurada", lista, vista previa y "Ver cálculo"). | **No.** `computeEquipmentLine` (cotización) usa posesión mensual completa × cantidad + operación/h × horas por día activo × días activos del SERVICIO. Ningún motor de cotización (cost, quote, economics, utilization, scenario, commercial-rules, break-even) lee la disponibilidad ni la utilización del recurso: todas las ocurrencias de `availableDaysPerMonth` / `utilizationPct` en motores son de `quote.activity`. |
| Ficha del equipo dentro de la cotización (`quote-steps/equipment.js`) | `computeEquipmentUnit` con la actividad DE LA COTIZACIÓN (días disponibles, utilización y horas del servicio). | Ya es el concepto B (utilización concreta de la cotización): se mantiene. |
| `laborProfiles.overtimeHoursPerActiveDay` | Valor inicial al copiar el perfil a una cotización; vista previa del perfil (variable por día activo). | No: NO está en `SNAPSHOT_FIELDS` (ya se trata como dato operativo de la línea); la línea tiene su propio valor. |
| `laborProfiles.normalHoursPerMonth` (jornada), `mealPerActiveDay`, recargo HE | Costo hora cargado (fijo ÷ horas normales), variable por día activo. | Son condiciones del puesto (permanentes), no utilización: **se quedan**. |

Conclusión: la "utilización" del recurso **no distribuye costos fijos en ninguna cotización**; sólo alimenta un $/hora y $/día "de referencia" en Recursos que mezcla el costo permanente del activo con un supuesto de uso. Se separan explícitamente:

- **A. Economía permanente del recurso (Recursos):** costo de TENERLO (posesión: amortización, seguro, patente, certificaciones, otros, costo de capital) por mes y costo de USARLO (operación: mantenimiento, neumáticos, combustible) por hora de uso; sueldo y cargas por persona por mes y costo hora según la jornada. No depende de ningún servicio.
- **B. Utilización concreta dentro de una cotización:** cantidad, horas por día activo, horas extra, días activos y período del servicio, standby, cómo llega (viajes / km) y **dedicación al servicio**. El $/hora y $/día efectivos de un equipo se calculan en cada cotización con ESOS datos (ya existe).

La utilización de una cotización nunca se guarda como propiedad del recurso.

#### 3. Objetivo y no-objetivos
- Objetivo (siguiente iteración):
  1. Recursos sin datos de uso: sacar del alta / edición de equipos "Disponibilidad y uso" (días, horas, % de utilización) y del perfil de personal "Horas extra por día activo". No son obligatorios ni se muestran; **no se borran** de los datos guardados.
  2. Ficha de Recursos = A: "Tenerlo: $ X/mes · Usarlo: $ Y/h" (+ "Ver cálculo"), con el aviso de que el $/hora y $/día se calculan en cada cotización.
  3. En la cotización, al agregar desde Recursos, las tres preguntas de §3.1.
  4. Tercerizados / alquilados cargados a mano en una cotización: botón opcional **[Guardar para futuras cotizaciones]** → Recursos → Servicios externos.
  5. **"Usado en" / Asignaciones** por recurso (§3.2). Estados: "Activa" y "Finalizada" nuevos; "Ganada" pasa a "Adjudicada" (mismo id `won`).
- Fuera de alcance: scheduler de flota, calendario de disponibilidad, reservas con fechas, ERP / órdenes de trabajo; días o período distintos por línea; bloqueo por sobreasignación (sólo se informa).

#### 3.1 UX aprobada: tres conceptos separados (2026-10-06)

| # | Pregunta en la cotización | Qué carga | Qué costos mueve |
|---|---|---|---|
| 1 | **"¿Cuánto se usa en este servicio?"** | días, horas, viajes, km | Sólo **variables**: combustible, mantenimiento por uso, neumáticos por uso, desgaste en ruta, horas extra / viandas. |
| 2 | **"¿El equipo queda reservado para este servicio?"** — Sí / No | reserva exclusiva | Si **Sí** → **100 %** de los costos fijos. |
| 3 | Si **No**: **"¿Se comparte con otros contratos?"** — Sí / No. Si **Sí**: **"¿Qué porcentaje de sus costos fijos querés asignar a esta cotización?"** | % explícito | Ese % de los costos fijos. Si no está reservado ni compartido: 100 % (nunca se reduce solo). |

Ayuda (texto literal): "Esto no depende de cuántos días trabaje. Un equipo on-call puede trabajar 15 días y aun así quedar reservado 100 % para este contrato."

Reglas:
- El uso real mueve costos VARIABLES.
- Los pocos días de uso **NO** reducen automáticamente amortización, seguro, patente, certificaciones, costo de capital ni mantenimiento fijo.
- Reservado exclusivamente → 100 % de costos fijos. Compartido → porcentaje EXPLÍCITO de costos fijos (lo carga la persona; nunca se infiere "50 % de uso = 50 % de costo fijo").
- Alquilado / tercerizado por día u hora → no aplica (no hay amortización propia): usa la tarifa del proveedor por unidad usada.
- Alquilado por mes → esa tarifa mensual sí es un costo fijo del servicio (ya funciona así: unidad "mes").

Ejemplos:
- A. Vactor on-call reservado 100 %, 15 días activos × 8 h → fijos 100 % (amortización, seguro, patente, certificaciones, capital, mantenimiento fijo) aunque esté parado 15 días; variables × 120 h (combustible, mantenimiento por uso, neumáticos) + movilización por llamado.
- B. Autoelevador compartido entre dos contratos, la persona asigna 50 % → fijos × 50 % (si el otro contrato no se concreta, esa mitad queda sin cubrir: se avisa); variables al 100 % de lo que trabaje en ESTE contrato.
- C. Equipo alquilado sólo por los días usados → fijos propios: no aplica; variable = tarifa × unidades (+ combustible no incluido + movilización del proveedor, con su mínimo).

#### 3.2 "Usado en" / Asignaciones (sin scheduler)
Por recurso: cotización / contrato, cliente, estado, período, **% reservado / asignado** y **uso estimado** (días, horas, km), con link. Diferencia **uso potencial** (Borrador, Enviada) de **compromiso real** (Adjudicada, Activa) y **Finalizada** (historial); suma el % asignado comprometido y avisa si supera el 100 %.

#### 4. Impacto en fórmulas (propuesto, sin código activo)
- Datos de la línea (propuesta): `reservedForService` (boolean, por defecto `true`), `sharedWithOtherContracts` (boolean), `fixedCostSharePct` (0 < % ≤ 100, sólo si se comparte).
- `fijo de la línea = costos fijos × cantidad × (compartido ? fixedCostSharePct : 100) / 100`. Variable sin cambios. Sin datos = 100 % (las cotizaciones existentes no cambian).
- Aplica a equipos PROPIOS y a personal (sueldo y cargas, con el mismo criterio de reserva / asignación explícita); no a externos por unidad.
- Lineal en los días activos: break-even, matriz y escenarios siguen valiendo.
- Requiere tests (100 % = sin cambios, reservado, compartido, externos sin efecto, inválidos), golden cases intactos y el mismo cuidado de esquema que PLAN-2026-007 (versión nueva para que una anterior no calcule distinto en silencio).
- El código de una primera versión (un único `dedicationPct`) quedó guardado fuera del repositorio y NO se usa: la UX aprobada lo reemplaza.

#### 5. Impacto en datos
- Nueva versión de esquema (la 4 la usa PLAN-2026-007; esto sería la 5) con una migración que **no cambia ni borra ningún dato** (copia de recuperación previa automática). Se sube porque la reserva / % de costos fijos y los estados "Activa" / "Finalizada" cambian cómo se lee una cotización: una versión anterior los ignoraría y mostraría otro costo, así que abre los datos en sólo lectura (regla de AGENTS §11).
- Datos de uso que quedan en recursos anteriores (`availableHoursPerMonth`, `availableDaysPerMonth`, `utilizationPct`, `overtimeHoursPerActiveDay`): se conservan sin cambios (obsoletos, ningún cálculo los usa). Las horas extra del perfil se usan sólo como valor inicial al agregarlo a una cotización.
- Staging comparte la base con producción: aceptar "actualizar el formato" en `/preview/` deja esa cuenta en la versión nueva y producción la abre en sólo lectura hasta publicarla. Recomendación: probar con una cuenta de prueba o elegir "Sólo mirar".

#### 6. Diseño
- Motores: `labor-engine.computeLaborLine` y `equipment-engine.computeEquipmentLine` aplican el % de costos fijos (100 % si está reservado o no se comparte; el % explícito si se comparte); `cost-engine` usa la dotación equivalente en la estructura por empleado. `computeEquipmentUnit` no cambia.
- Dominio (puro): `js/domain/resource-usage.js` (asignaciones de un recurso a partir de las cotizaciones; grupos potencial / compromiso / historial) y `fixedCostShareOf(line)`.
- Servicios: `resource-service.equipmentCard` devuelve sólo posesión y operación (A).
- UI: legajo de equipo y perfil sin datos de uso; al agregar desde Recursos, las tres preguntas de §3.1 (uso / reservado / compartido + %); botón "Guardar para futuras cotizaciones" en externos sin vínculo; columna y diálogo "Usado en" en Recursos; estados nuevos en el listado.
- Reglas de dependencia: la UI no importa `js/data/`; los motores siguen puros.

#### 7. Tests
Reserva / % de costos fijos (equipo propio, personal, por empleado, reservado = 100 %, sin datos = sin cambios, compartido con % explícito, pocos días de uso NO reducen fijos, externos por unidad sin efecto, alquiler mensual = fijo, valores inválidos), golden cases y baseline intactos, migración sin cambios de datos, asignaciones (vínculo por `sourceId`, grupos de estado, cotizaciones perdidas / archivadas fuera, suma del % comprometido), ficha de Recursos sin utilización. E2E desktop y mobile + regresión de v0.2.0 / v0.3.0.

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| % de costos fijos bajo = tarifa piso baja que no cubre el costo fijo si el otro contrato no se concreta | Sólo con "se comparte" explícito; aviso en la línea ("el X % restante lo tiene que cubrir otro contrato") y en "Ver cálculo"; "Usado en" suma el % comprometido y avisa si supera el 100 %. |
| Confundir uso con reserva ("50 % de uso = 50 % de fijo") | Nunca se infiere: el uso mueve sólo variables y el % de fijos es una respuesta explícita. Texto de ayuda en la pregunta. |
| Staging comparte la base con producción | Versión de esquema nueva sólo con confirmación en `/preview/`; recomendación de cuenta de prueba. |
| Perder datos de uso viejos | No se borran; quedan como obsoletos. |

#### 9. Rollback
Revert del PR. Las cuentas ya actualizadas a la versión de esquema nueva quedarían en sólo lectura en la versión anterior: restaurar la copia previa a la migración (Configuración → Datos y backup) o mantener esta versión.

#### 10. Review multidisciplinario
Economía (% de fijos explícito, nunca inferido del uso; linealidad; aviso de costo no cubierto), QA (0 / 100 / vacío / inválido, externos, alquiler mensual, migración), Seguridad (validación del %, sin `innerHTML`, sin cambios de Auth / RLS), UX (tres preguntas claras, texto de ayuda, "Usado en" potencial vs compromiso). Se deja escrito en el PR.

#### 11. Documentación
CALCULATION_RULES (reserva y % de costos fijos, ficha de Recursos), DATA_MODEL (esquema nuevo, campos de la línea, estados, campos obsoletos), RESOURCE_MODEL (uso vs reserva vs asignación, asignaciones), CHANGELOG, AGENTS §5.1.

#### 12. Criterio de terminación
`npm test` y CI en verde, E2E desktop y mobile, preview publicado con la rama, prueba del dueño en staging y merge del PR por el dueño.

#### Bitácora
- 2026-10-05: análisis de impacto (§2): la utilización del recurso sólo alimenta la ficha de Recursos; ningún número de cotización depende de ella. Diseño A (economía permanente) / B (uso en la cotización) y dedicación al servicio sólo sobre el costo fijo.
- 2026-10-05: caso real (autoelevador, cotización on-call): "Operación por hora $ 3.000.000" sale de `maintenancePerHour` = 3.000.000 cargado al crear el recurso (no es dato ilustrativo, ni migración, ni error de unidades del código: un monto mensual o anual cargado en un campo $/h, sin ninguna advertencia). Propuesta a confirmar: mantenimiento por hora / service + frecuencia en horas (= $/h) / presupuesto mensual o anual (costo FIJO de tenerlo, no $/h); neumáticos por hora / juego + vida útil en horas o km; resultado visible antes de guardar y control de plausibilidad (100 h de operación > valor de reposición → "¿seguro que es por hora?"). Implementación de la dedicación pausada a pedido del dueño ("no cambies fórmulas todavía").
- 2026-10-06: concepto aprobado con UX simplificada (uso / reserva / % de costos fijos explícito, sin inferir del uso). Queda documentado como siguiente paso, sin código activo; PLAN-2026-007 (mantenimiento y neumáticos) va primero en su propio PR.

### PLAN-2026-007 — Mantenimiento y neumáticos con forma de carga y avisos de sentido común

- Estado: Completado — PR #15 mergeado; v0.4.0 en producción (`2d1d58f`)
- Tipo: motor de costos (equipos y movilización) · migración de datos (esquema 3 → 4, sin cambios de datos) · UX de Recursos y cotización
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-05 · Rama: `claude/resource-usage-in-quote`

#### 1. Contexto y problema
Caso real: un autoelevador con reposición $ 100.000.000 y "mantenimiento" $ 3.000.000 cargado en el campo $/h (sin aviso) → operación $ 3.000.000/h, $ 24.000.000 por día activo de 8 h, ~$ 360.000.000 en 15 días. La UX sólo ofrecía "$/h": un presupuesto mensual o anual se interpretaba como por hora.

#### 2. Objetivo y no-objetivos
- Objetivo: cargar el mantenimiento por hora, como service cada N horas (= $/h) o como presupuesto mensual / anual (= costo FIJO de tenencia, nunca dividido por horas); los neumáticos por hora, como juego + vida útil en horas (= $/h) o juego + vida útil en km (= $/km en la ruta). Mostrar SIEMPRE, antes de guardar, cómo lo interpreta RATEOS. Avisos de sentido común (no bloqueos, no correcciones): 100 h > reposición, residual > reposición, vida útil 0, mantenimiento / neumáticos desproporcionados, falta intervalo o vida útil del juego.
- Fuera de alcance: dedicación al servicio (PLAN-2026-006, pausado); modificar datos existentes (el autoelevador sigue en $ 3.000.000/h hasta que la persona lo edite); repuestos, horas de motor, mantenimiento por km del equipo trabajando.

#### 3. Impacto en fórmulas
- Sin forma de carga = "por hora" (igual que antes): golden cases y baseline intactos.
- Posesión: `+ mantenimiento fijo` (presupuesto mensual o anual / 12) en la posesión en efectivo.
- Operación: `mantenimiento/h` = cargado o `service / horas`; `neumáticos/h` = cargado o `juego / vida útil h`.
- Movilización por sus propios medios: `desgaste = km × ($/km + neumáticos $/km)` cuando los neumáticos se cargan por km.
- Casos numéricos: service $ 600.000 / 250 h = $ 2.400/h; presupuesto $ 36.000.000/año = $ 3.000.000/mes fijo y $ 0/h; juego $ 2.400.000 / 3.000 h = $ 800/h; juego $ 2.400.000 / 80.000 km = $ 30/km (100 km de ruta con $ 150/km de mantenimiento → $ 18.000 de desgaste).
- Margen y markup: sin cambios.

#### 4. Impacto en datos
- `SCHEMA_VERSION` 3 → 4 con `migrateV3ToV4`: no cambia ni borra datos (copia previa automática). Campos nuevos opcionales en equipos y líneas: `maintenanceMode`, `maintenanceServiceCost`, `maintenanceServiceHours`, `maintenanceBudget`, `maintenanceBudgetPeriod`, `tiresMode`, `tiresSetCost`, `tiresLifeHours`, `tiresLifeKm`.
- Snapshot: la clave `wear` aparece sólo cuando la forma de carga no es "por hora": las huellas anteriores no cambian (sin avisos falsos de "cambió en Recursos").
- Staging comparte la base con producción: actualizar el formato en `/preview/` deja esa cuenta en v4 y producción (v0.2.0) la abre en sólo lectura hasta publicar esta versión. Recomendación: probar con una cuenta de prueba o "Sólo mirar".

#### 5. Diseño
Motor: `maintenanceOf`, `tiresOf`, `equipmentChecks` en `js/engines/equipment-engine.js`; `computeOwnership` / `computeOperation` los usan; `mobilization-engine` suma neumáticos por km. UI: `js/ui/equipment-wear-ui.js` (interpretación y avisos), legajo del equipo en Recursos (secciones Mantenimiento y Neumáticos con bloque "Así lo calcula RATEOS" en vivo) y línea del equipo en la cotización (mismos selectores; avisos siempre visibles).

#### 7. Tests
`tests/engines/maintenance-tires.test.js` (formas de carga, autoelevador sin cambios, avisos, snapshot sin avisos falsos, copia a la línea), migración v3 → v4 sin cambios de números, validación de los campos nuevos. E2E desktop y mobile: autoelevador real migrado de v3, aviso, presupuesto, juego + horas y + km, cotización avisada y actualizada, staging "Sólo mirar" sin escribir.

#### 9. Rollback
Revert del PR. Las cuentas actualizadas a esquema 4 quedarían en sólo lectura en la versión anterior: restaurar la copia previa (`pre-migration-v3`) o mantener esta versión.

#### Bitácora
- 2026-10-05: diseño validado por el dueño (mantenimiento A/B/C, neumáticos por hora / horas / km, avisos sin bloqueos, no modificar datos). Implementado en motor, Recursos y cotización; esquema 4 sin cambios de datos.

### PLAN-2026-008 — Costeo de productos: receta, personal con convenio, máquinas, gastos fijos y precio con margen

- Estado: Completado (v0.5.0)
- Tipo: motor de costos (nuevo motor de producto) · margen · migración de datos (esquema 4 → 5) · UX nueva (sección Productos)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-11 · Rama: `claude/wonderful-brown-g2ehd6`

#### 1. Contexto y problema
RATEOS sólo costea servicios (cotizaciones por día, hora o abono). Pedido del dueño: que dentro de la misma web una PyME pueda armar el costo y el precio de un **producto** (por ejemplo chipá o facturas): materias primas, empleados con su convenio (comercio, panaderos…), máquinas con su amortización, gastos fijos del local y el precio según el margen que quiere ganar, paso a paso y en forma intuitiva.

#### 2. Objetivo y no-objetivos
- Objetivo: sección **Productos** con un editor paso a paso (El producto → Ingredientes y materiales → Personal → Máquinas y equipos → Gastos fijos → Precio y margen → Resultado) que calcula el **costo por unidad**, el **precio piso**, el **precio con el margen deseado**, el **precio al público con IVA** (si la empresa carga la alícuota), el **punto de equilibrio en unidades por mes** y, si ya vende, si su **precio actual** cubre los costos. Todo con "Ver cálculo".
- Reusa Recursos: perfiles de Personal (con su convenio), Mis equipos y Materiales, con la misma regla RECURSO MAESTRO ≠ COPIA (aviso + [Actualizar] / [Conservar valor original]).
- No-objetivos: inventario, stock, recetas con sub-recetas, órdenes de producción, facturación, punto de venta, listas de precios por cliente. RATEOS no trae escalas salariales, cargas ni alícuotas (AGENTS.md §7): los convenios nuevos son sólo nombres y sus parámetros siguen siendo los genéricos ILUSTRATIVOS.

#### 3. Impacto en fórmulas (motor nuevo `js/engines/product-engine.js`; las cotizaciones no cambian)
- Tanda (receta): `S = unidades por tanda × (1 − pérdida %)` (unidades vendibles por tanda).
- Ingredientes y materiales: `costo = cantidad usada (convertida a la unidad del precio) × precio por unidad × (1 + merma %)`; precio por unidad = cargado o `precio del paquete / contenido`. Van **por tanda** (receta) o **por unidad** (empaque, etiqueta). Unidades convertibles: g ↔ kg, ml ↔ l, unidad ↔ docena.
- Personal: `costo por tanda = personas × minutos por tanda / 60 × costo hora con cargas`, con `costo hora = costo mensual por persona / horas normales del mes` (mismo LaborEngine que las cotizaciones).
- Máquinas: uso `= minutos por tanda / 60 × (mantenimiento/h + neumáticos/h + energía/h)`; tenencia (amortización, seguro, patente, certificaciones, mantenimiento fijo, costo de capital) es un costo **fijo mensual**, del que se asigna al producto un % **explícito** (nunca inferido del uso, como aprobó el dueño en PLAN-2026-006).
- Gastos fijos del negocio (alquiler, servicios, contador…): `monto mensual × % asignado al producto`.
- `variable por unidad = (ingredientes por tanda + personal + uso de máquinas) / S + materiales por unidad`.
- `fijo por unidad = fijos asignados del mes / unidades vendidas por mes`.
- `costo por unidad = variable por unidad + fijo por unidad`.
- Precio (mismas reglas que las cotizaciones, §11 y §13.1): `precio piso = costo / (1 − t)`, `precio con margen = costo / (1 − margen − t)` (margen sobre el precio ≠ markup), redondeo comercial hacia arriba, `precio al público = precio × (1 + IVA %)` sólo si la empresa carga el IVA.
- Punto de equilibrio: `unidades por mes = fijos asignados / (precio × (1 − t) − variable por unidad)`; sin contribución positiva → inalcanzable (null, nunca Infinity).
- Caso numérico (golden, ILUSTRATIVO): tanda de 60 chipás, ingredientes $ 6.000, empaque $ 20/u, personal 90 min a $ 6.000/h = $ 9.000, horno 40 min a $ 1.500/h = $ 1.000 → variable $ 286,67/u; fijos $ 175.000/mes con 3.000 u/mes → $ 58,33/u; costo $ 345/u; margen 30 % sin impuestos → $ 492,86 (markup 42,86 %); equilibrio 848,7 u/mes.

#### 4. Impacto en datos
- `SCHEMA_VERSION` 4 → 5 con `migrateV4ToV5`: agrega `products: []`; no cambia ni borra nada (copia previa automática). Una versión anterior abre los datos v5 en sólo lectura (así nunca guarda un estado sin los productos).
- Producto: `{ id, organizationId, name, saleUnit, unitsPerBatch, lossPct, monthlyUnits, materials[], labor[], equipment[], fixedCosts[], pricing { targetMarginPct, roundingStep, vatPct, currentPrice }, billingTaxes, currency, illustrative, notes }` (detalle en DATA_MODEL).
- Backup, importación, datos locales anteriores y RLS: el producto vive dentro del workspace JSON de la organización (misma fila, mismas políticas): no cambia la base de datos.

#### 5. Diseño
Dominio `js/domain/product-factory.js` (producto vacío, líneas desde Recursos con los mismos factories que la cotización, ejemplo ILUSTRATIVO), motor puro `product-engine.js` con trazas, servicio `product-service.js`, repositorio (`getProducts/saveProduct/deleteProduct`), vistas `products.js` (lista y "Nuevo producto") y `product-editor.js` (pasos con "Así lo calcula RATEOS" en vivo), navegación "Productos", accesos desde Inicio. Convenios: se suman los tipos "Empleados de Comercio (CCT 130/75)", "Panaderos / pasteleros" y "Gastronómicos" (sólo nombres).

#### 6. Review multidisciplinario
- Economía: fijos vs variables separados; el fijo nunca se reparte por un uso inventado; margen ≠ markup; impuestos sobre la venta con gross-up; IVA sólo si se carga.
- QA: tanda 0, pérdida 100 %, ventas 0, margen ≥ 100, margen + t ≥ 100, unidades incompatibles, paquete sin contenido, precio actual menor que el costo variable, valores vacíos y negativos.
- Seguridad: validación de entradas, sin `innerHTML`, sin dependencias, RLS sin cambios.
- UX: lenguaje de comercio ("tanda", "receta", "cuántas vendés por mes"), interpretación en vivo, "Ver cálculo", ejemplo marcado ILUSTRATIVO.

#### 7. Tests
Motor (golden chipá, casos extremos, sin NaN/Infinity), conversiones de unidades, migración v4 → v5 (sin cambios de datos ni de números de cotizaciones), validación del estado, repositorio y servicio, arquitectura. E2E desktop y mobile: crear un producto desde cero con recursos, ejemplo, resultado igual al motor, aviso de cambio en Recursos, persistencia.

#### 9. Rollback
Revert del PR. Las cuentas que pasaron a esquema 5 quedarían en sólo lectura en la versión anterior: restaurar la copia previa (`pre-migration-v4`) o mantener esta versión.

#### Bitácora
- 2026-10-11: pedido del dueño (productos dentro de la misma web, paso a paso). Diseño e implementación en una iteración.
- 2026-10-11: E2E (escritorio y celular, Supabase simulado): producto desde cero = golden (costo $ 345, precio $ 492,86, equilibrio 849 u/mes), ejemplo ILUSTRATIVO, cuenta v4 → v5 con copia previa y recursos intactos, aviso de cambio en Recursos y [Actualizar en este producto]. El E2E encontró que `saveProduct`/`deleteProduct` no se subían a la nube enseguida (faltaban en las escrituras sincronizadas): corregido con un test que exige que toda escritura local se sincronice.
- 2026-10-11: impuestos sobre la venta sin decidir → aviso (como en las cotizaciones); "No corresponden" o un % lo resuelven.
- 2026-10-12 (v0.5.1, sólo UX): pedido del dueño de que productos no quede separado del flujo principal. "+ Nueva cotización" pasa a "+ Nuevo cálculo" (`#/nuevo`, "¿Qué querés calcular?" → Servicio / Producto); Inicio con [Nuevo servicio] [Nuevo producto] y "Tus productos"; bienvenida y textos públicos para servicios y productos. Sin cambios de motores, datos ni RLS.

### PLAN-2026-009 — Unidades de facturación según el tipo de servicio

- Estado: Completado (v0.6.0)
- Tipo: motor de costos (generalización de la unidad facturable) · utilización / break-even · migración de esquema (5 → 6, sin cambios de datos) · UX ("Cómo se cobra", resultado, "El precio", materiales, listado)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-12 · Rama: `claude/wonderful-brown-g2ehd6`

#### 1. Contexto y problema
El dueño detectó una inconsistencia conceptual: eligiendo "Servicio por unidad producida" (m³, toneladas…), "¿En qué unidad cobrás?" sólo ofrecía $/día, $/hora y $/mes. El acoplamiento estaba en todo el motor: los días activos D eran a la vez el driver de costo, la unidad de actividad, la cantidad facturable ($/día), el break-even ("días mínimos"), la matriz, los tramos de descuento y los escenarios.

#### 2. Objetivo y no-objetivos
- Objetivo: TIPO DE SERVICIO → UNIDAD DE FACTURACIÓN → ACTIVIDAD → EQUILIBRIO coherentes. Unidades habituales por tipo (on-call, permanente, cuadrilla, equipos, por unidad producida, transporte, llave en mano / precio cerrado, horas y materiales, configurable) + "Otra / personalizada" siempre; actividad en la unidad comercial ("¿Cuántos m³ esperás facturar por mes?"); cantidad de equilibrio ("6.000 m³ para no perder"); tarifas "/ m³", nunca "/ día" si no se cobra por día; horas y materiales con los materiales facturados aparte.
- No-objetivos: facturación por hito con calendario, certificaciones de avance, precio por mezcla de unidades en una misma cotización (una tarifa principal por cotización; los materiales aparte en horas y materiales).

#### 3. Impacto en fórmulas (detalle en CALCULATION_RULES §12.1)
- UNIDAD DE COSTO ≠ UNIDAD DE VENTA: los costos siguen con los días de trabajo D; la facturación es `cantidad facturable × tarifa por unidad`.
- Por cantidad: `D = Q / max(días por llamado × rendimiento, minimum call) × días por llamado`; cantidad facturable `llamados × max(días por llamado × rendimiento, minimum call)`. Por evento: `D = Q / hitos por trabajo × días por llamado`; facturable `llamados × hitos por trabajo`.
- Equilibrio: misma búsqueda robusta sobre D (§15) y `cantidad de equilibrio = cantidad facturable(D*)`.
- Tramos por cantidad de días sólo con $/día y $/hora.
- Materiales facturados aparte: `costo × (1 + markup de reventa)` suma a los otros ingresos (el costo no cambia).
- Antes → después: $/día, $/hora y $/mes **sin cambios** (foto de 99 casos idéntica; única diferencia el rótulo "(mess)" → "(meses)"). Caso A: 10.000 m³/mes, 500 m³/día, fijos 30.000.000, variable 1.000.000/día, tarifa 7.000/m³ → antes no se podía expresar; ahora piso 5.000/m³, equilibrio 6.000 m³ (12 días).

#### 4. Impacto en datos
- `SCHEMA_VERSION` 5 → 6 con `migrateV5ToV6`, que no cambia ni borra datos (una versión anterior abre los datos v6 en sólo lectura y no calcula "por día" una cotización por m³).
- Campos nuevos opcionales: `quote.unitName`, `activity.billableQuantityPerMonth`, `activity.unitsPerActiveDay`, `activity.unitsPerActivation`, `pricing.materialsBilledSeparately`. `quote.unit` admite los ids de `BILLING_UNITS`.
- Backup, importación, RLS y Supabase: sin cambios (todo vive en el workspace JSON).

#### 5. Diseño
Dominio `js/domain/billing-units.js` (catálogo, unidades por tipo, textos y concordancia); motores: `cost-engine` (`activeDaysForQuantity`, `normalizeActivity`), `commercial-rules-engine` (`billableUnits`, `unitHasDayTiers`, materiales aparte), `economics-engine` (`materialsResaleOf`), `quote-engine` (`billableQuantityAt`, cantidad de equilibrio, avisos de unidad), `break-even-engine` (traza en la unidad), `scenario-engine` (actividad en cantidad), `completeness-engine`. UI: `js/ui/unit-text.js` (textos puros); "Tipo de servicio" ajusta la unidad (si no hay tarifa ni mínimo cargados); "Cómo se cobra" con unidades del tipo, unidad propia y actividad en la unidad; resultado, matriz, gráfico, sensibilidad, escenarios, listado y "El precio" en la unidad comercial; Materiales con "Facturo los materiales aparte".

#### 6. Review multidisciplinario
- Economía: costo con drivers reales; facturación en la unidad; tramos por días no se aplican a otras unidades; materiales aparte siguen siendo costo.
- QA: cantidad 0, sin rendimiento, negativos, más días que los disponibles, unidad propia sin nombre, unidad no habitual, cambio de unidad con tarifa cargada (sin conversión segura → borrar o cancelar), cambio de tipo de servicio con tarifa (no cambia la unidad y avisa).
- Seguridad: nombre de unidad saneado (sin caracteres de control, máx. 30) y mostrado con `textContent`; sin dependencias; RLS sin cambios.
- UX: preguntas en la unidad ("¿Cuántos m³…?", "¿Cuántas toneladas…?"), "m³ para no perder", "Ver cálculo" del equilibrio por unidad.

#### 7. Tests
Golden A–E (`tests/golden-cases/unidad-*.json`), `tests/engines/billing-units.test.js` (unidades por tipo, llamado, hito, trabajo, unidad propia, km, mínimo por llamado, tramos, materiales aparte, casos extremos, avisos, completitud, escenarios), `tests/ui/unit-text.test.js`, migración v5 → v6. E2E desktop y mobile (Supabase simulado): cuenta v5 → v6 con cotizaciones por día/hora/mes intactas, casos A–E en el resultado y en "El precio", flujo real por unidad producida → $/m³, unidad propia "pozo", horas y materiales.

#### 9. Rollback
Revert del PR. Las cuentas que pasaron a esquema 6 quedarían en sólo lectura en la versión anterior: restaurar la copia previa (`pre-migration-v5`) o mantener esta versión.

#### Bitácora
- 2026-10-12: pedido del dueño (unidades según el tipo de servicio, actividad y equilibrio en la unidad, revisar motor y textos). Diagnóstico entregado (acoplamiento a D) e implementado en una iteración; regresión de $/día, $/hora y $/mes idéntica.

### PLAN-2026-010 — Auditoría y pulido desde una cotización real (COT-0009)

- Estado: Completado (v0.7.0)
- Tipo: corrección del motor (financiación de externos) · trazabilidad · UX que puede inducir a cotizar mal · migración de esquema (6 → 7, sin cambios de datos)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-12 · Rama: `claude/wonderful-brown-g2ehd6`

#### 1. Contexto y problema
El dueño cargó una cotización real completa (COT-0009, $/m³) y la auditó externamente: **los números cierran**. Pidió auditar y pulir sin rediseñar ni agregar features por agregar, corrigiendo sólo bugs reales, problemas económicos, inconsistencias de trazabilidad y UX que pueda inducir a cotizar mal. El PDF exportado es la evidencia principal; se reconstruyó la cotización (`tests/fixtures/cot-0009.js`, sin datos de cliente) y reproduce todos sus números al peso.

#### 2. Objetivo y no-objetivos
- Objetivo: mantener los valores de COT-0009 (golden `cot-0009-prueba-real.json`) y de toda cotización existente; corregir el bug P0 de financiación; que cada número del reporte tenga "Ver cálculo" y se entienda.
- No-objetivos: rediseño, índices de actualización / polinómica (se avisa que no se incluyen), cambio automático del modelo de activaciones (ver §5), cálculo de convenios.

#### 3. Impacto en fórmulas (CALCULATION_RULES §3.1, §4.1, §7, §8, §10, §17, §19)
- **Bug P0 corregido — financiación de externos sobre la salida de caja**: el CostEngine pasaba el costo económico como caja; ahora se financia neto + IVA + percepciones + cargos no recuperables (el IVA recuperable no es costo pero se adelanta). Sin tratamiento fiscal definido nada cambia (COT-0009 y la foto de 99 casos idénticas). Antes → después (pickup 2.800.000/mes, 45 días al 3 %): IVA 21 % recuperable 0 → 26.460; parcial 50 % 14.847 → 28.077; recuperable + percepciones 3 % 0 → 30.240; no recuperable 29.694 sin cambio.
- Opcionales nuevos que **no cambian** cotizaciones existentes: horas extra por tramos (HE 50 % / 100 % / otro; por día activo o por mes; facturadas aparte = costo + ingreso), estructura desglosada por rubro (+ política de la empresa), comparador de modelos en $/unidad.
- Sólo presentación: EECC con "Fijo del mes" y "Variable por día de trabajo" (el "$/día activo" mezclaba fijos), eje del gráfico en la unidad, equivalencias operativas, impacto incremental de cada externo (`impact-engine`), severidad de la completitud y banner BORRADOR.

#### 4. Impacto en datos
- `SCHEMA_VERSION` 6 → 7 con `migrateV6ToV7` (sólo sube la versión): una versión anterior ignoraría en silencio los tramos de HE o la estructura desglosada; así abre los datos v7 en sólo lectura.
- Campos nuevos opcionales: `labor[].overtime`, `labor[].overtimeBilled`, `indirect.mode`, `indirect.items`, `settings.indirectPolicy`; fuente de base `'offer'`.
- Backup, importación, RLS y Supabase: sin cambios (workspace JSON).

#### 5. Decisiones y propuestas pendientes del dueño
- **Activaciones discretas (ítem 4)**: hoy 2.500 m³ / 120 m³ por día / 2 días por intervención = 10,42 salidas: el costo por salida (movilización) es un PROMEDIO. No se cambió el motor (rompería golden cases); se avisa en "Cómo se cobra" cuando las salidas no son enteras. Propuesta: opción explícita por cotización "Cada salida se cuenta completa" (`activationsRounding: 'ceil'`), apagada por defecto, que redondee hacia arriba las salidas para la movilización y los cargos por llamado, con su "Ver cálculo". Requiere aprobación (cambia números cuando se activa).
- **Plazo de pago de cada proveedor externo** (`external.fiscal.paymentTermDays`): sigue informativo; la financiación usa los días del grupo "Proveedores". Usarlo por línea cambiaría números: propuesta para una próxima iteración.
- **Contratos de 12 meses (ítem 20)**: aviso visible "Valores constantes a base [mes]. No incluye actualización ni escalación". Índices / polinómica: futuro (no se inventan índices).
- **Fecha base (ítem 19)**: la base general es el mes de la oferta; cada recurso conserva la suya; los valores sin base se pueden completar con el mes de la oferta sólo después de confirmar la lista (nunca en silencio, nunca pisa una base definida).

#### 6. Review multidisciplinario
- Economía: la caja financiada incluye el IVA adelantado; el costo económico no cambia; HE facturadas siguen siendo costo; estructura desglosada = suma de rubros; contingencia separada del margen (sin doble conteo).
- QA: 0 días, sin rendimiento, salidas fraccionarias, externo sin precio (crítico y nombrado, con [Completar] [Quitar]), estructura desglosada sin rubros, plazo de cobro vacío (costo parcial explicado), tasa anual → mensual ÷ 12.
- Seguridad: sin `innerHTML`; textos con `textContent`; rutas de base asignables por lista blanca (`assignOfferBase`); sin dependencias; RLS sin cambios.
- UX: BORRADOR con críticos / revisar / informativo; "Duración promedio de cada salida / intervención"; unidad visible en materiales con fórmula; equilibrio con la tarifa usada; texto neutro en estructura.

#### 7. Tests
Golden `cot-0009-prueba-real.json`; `tests/engines/external-finance.test.js` (recuperable, no recuperable, parcial, percepciones, sin IVA, movilización del proveedor); `tests/engines/audit-cot0009.test.js` (HE por tramos = campo único al centavo, HE por mes y facturadas, estructura desglosada, impacto incremental 3.221.400, comparador por m³, severidades, avisos, BORRADOR, fecha base); `tests/ui/audit-ui.test.js`; migración v6 → v7 y validación v7. Foto de 99 casos idéntica contra `main` (135029f).

#### 9. Rollback
Revert del PR. Las cuentas que pasaron a esquema 7 quedarían en sólo lectura en la versión anterior: restaurar la copia previa (`pre-migration-v6`) o mantener esta versión.

#### Bitácora
- 2026-10-12: auditoría de COT-0009 (PDF vs. motor, trazabilidad de cada número); bug P0 de financiación de externos corregido; 22 ítems de pulido implementados sin cambiar los números existentes.

### PLAN-2026-011 — "Cada salida se cuenta completa" y plazo de pago por proveedor

- Estado: Completado (v0.7.1)
- Tipo: motor de costos (costo escalonado por salida, opcional) · financiación por proveedor · migración de esquema (7 → 8, sin cambios de datos) · UX ("Cómo se cobra", equipos externos, financiación, "Ver cálculo")
- Responsable: agente de programación + decisión del dueño (aprobó ambas mejoras el 2026-10-13)
- Rama: `claude/wonderful-brown-g2ehd6`

#### 1. Contexto
Con 2.500 m³ / 120 m³ por día / 2 días por intervención hay 10,42 intervenciones promedio por mes. Hoy cada costo por salida se reparte por día (costo por salida ÷ días por salida), así que el mes paga 10,42 salidas. El dueño quiere poder costear 11 **sólo** en lo físicamente indivisible, sin redondear la actividad ni la producción. Además, cada externo puede pagarse a un plazo distinto del general de "Proveedores".

#### 2. Inventario de costos por salida (antes de implementar, para no contar dos veces)
| Driver | Dónde se calcula | ¿Discreto? |
|---|---|---|
| Movilización del equipo principal por sus medios (combustible en ruta + desgaste por km) | `mobilization-engine` | Sí |
| Equipo transportado / con vehículo de apoyo | costo en el equipo que transporta o en el vehículo auxiliar | No acá (ya está en esa línea: no se duplica) |
| Logística auxiliar: combustible y desgaste de vehículos, peajes, viáticos / alojamiento por salida | `logistics-engine` | Sí |
| Externo con tarifa por llamado, por viaje o por km | `external-engine` | Sí |
| Externo por hora o por día cuando rige el mínimo por llamado | `external-engine` | Sí (el mínimo es por salida) |
| Externo por hora o por día sin mínimo, combustible no incluido | `external-engine` | No (depende del tiempo trabajado) |
| Movilización cobrada aparte por el proveedor | `external-engine` | Sí |
| Materiales "por llamado" y otros costos "por llamado" | `materials-engine` | Sí |
| Sueldos, standby, tenencia de equipos, mantenimiento por hora, materiales por mes o por día, externos por mes o global | varios | No |
| Ingresos por llamado (call-out, movilización cobrada al cliente, km extra) y mínimo por llamado de la facturación | `commercial-rules-engine` | No: la facturación y la producción siguen con las intervenciones estimadas (decisión conservadora: la opción sólo agrega costo) |

Cada driver discreto existe en una sola línea del modelo; el ajuste usa exactamente esos montos por salida, así que no hay doble conteo.

#### 3. Fórmulas (CALCULATION_RULES §2.1 y §8)
- Intervenciones estimadas `A = D / días por intervención` (fraccionario, igual que siempre). Con la opción: costeadas `C = ⌈A⌉`; ajuste = `(C − A) ×` costo discreto por salida.
- El ajuste lleva lo mismo que cualquier costo directo: estructura sólo si es % (sobre directo o mano de obra), financiación de su salida de caja y contingencia. La estructura mensual fija, los sueldos, la tenencia, la producción y la facturación no cambian.
- Equilibrio y matriz: el costo es escalonado; el buscador robusto suma los puntos de salto (múltiplos de los días por intervención) para no saltear una pérdida.
- Plazo por proveedor: `días financiados = días hasta facturar + plazo de cobro − plazo de ese proveedor` (vacío → días de "Proveedores"). Aplica a la tarifa y a la movilización del proveedor; el costo económico no cambia.
- Antes → después: opción apagada o intervenciones enteras → idéntico; COT-0009 idéntico (golden). Ejemplos numéricos en los tests.

#### 4. Datos
`SCHEMA_VERSION` 7 → 8 (`migrateV7ToV8`, sólo sube la versión): `activity.fullActivations` (opcional, `true` = cada salida completa) y `equipment[].supplierPayDays` (opcional; vacío = plazo general). La "Condición de pago" de Recursos y el viejo `external.fiscal.paymentTermDays` (informativo) no se usan solos: la cotización ofrece [Usar X días].

#### 5. Rollback
Revert del PR; datos v8 → restaurar `pre-migration-v7` o mantener la versión.

### PLAN-2026-012 — Pulido desde casos reales de transporte (COT-0010 / COT-0011)

- Estado: Completado (v0.7.2)
- Tipo: corrección del motor (viajes físicos de la unidad "viaje") · opcionales de motor (combustible por km de externos, % de costos fijos de recursos compartidos) · completitud y trazabilidad · migración de esquema (8 → 9, sin cambios de datos)
- Responsable: agente de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-16 · Rama: `claude/wonderful-brown-g2ehd6`

#### 1. Contexto
El dueño probó dos cotizaciones reales de transporte $/viaje (PDF del 16/10/2026) y pidió una iteración de pulido funcional: sin features decorativas, sin rediseño y sin romper fórmulas validadas. Se reconstruyeron ambas en `tests/fixtures/cot-0010.js` (sin cliente) y reproducen el PDF al peso:

| | COT-0010 | COT-0011 |
|---|---|---|
| Actividad | 12 viajes/mes, 1 por día, 12 días | 12 viajes/mes, 2 por día, 6 días |
| Ruta | Neuquén → Añelo 100 km (200 km ida y vuelta) | igual |
| Proveedor | $ 3.250/km, todo incluido, IVA 21 % recuperable, paga a 15 días: 2.400 km = $ 7.800.000 | igual |
| Personal / estructura 8 % / financiero / contingencia 3 % | $ 3.280.036 / $ 886.403 / $ 523.345 / $ 374.694 | igual |
| Costo · piso · objetivo · sugerida | $ 12.864.478 · $ 1.128.463 · $ 1.261.224 · $ 1.262.000 por viaje | igual |
| Facturación · impuestos 5 % · resultado · margen · equilibrio | $ 15.144.000 · $ 757.200 · $ 1.522.322 · 10,05 % · 8,56 viajes | igual |

#### 2. Hallazgos reproducidos contra `main` (6cc1ca5)
1. **P0 viajes contradictorios (bug):** con unidad "viaje" la ruta usa "Viajes por llamado" (`logistics.tripsPerActivation`, 1 por defecto), independiente de los viajes por día. COT-0011 con 1 viaje por llamado (estado intermedio del dueño) factura 12 viajes pero costea 6 viajes físicos: proveedor $ 3.900.000 en vez de $ 7.800.000, costo $ 8.320.447, sugerida $ 816.000 (−35 %), sin ningún aviso.
2. **P0 completitud de combustible:** 92 % con "Falta el consumo de combustible" aunque el único equipo es un externo con combustible incluido (la regla pide consumo si hay cualquier equipo). El botón lleva a un paso genérico, no al campo.
3. Externo por km sin ruta: la línea muestra $ 0 y la completitud lo trata como "revisar" (peso 1), no como crítico.
4. Equilibrio sin costos fijos: "0 viajes" y el texto "los ingresos fijos ya alcanzan" (falso: no hay ingresos fijos).
5. Los km del proveedor no se ven junto a la ruta: "Movilización y viajes $ 0" parece que los viajes no cuestan.
6. Combustible de un externo que pagamos: sólo L/h (no sirve para un camión por km).
7. Recursos compartidos: no se puede asignar un % del costo fijo de una persona o un equipo propio (PLAN-2026-006 §3.1, aprobado) ni ver en qué cotizaciones se usa.

#### 3. Ya resuelto en `main` (no se reimplementa; se confirma con tests)
- Unidad visible de materiales con fórmula (`MATERIAL_UNIT_PRESETS`, `materialFormulaText`, v0.7.0).
- Horas extra por tramos HE 50 % / HE 100 % / otro, por día o por mes, facturables aparte (v0.7.0, `tests/engines/audit-cot0009.test.js`).

#### 4. Cambios de FÓRMULA (CALCULATION_RULES)
| Cambio | Antes → después | ¿Cambia datos existentes? |
|---|---|---|
| Unidad "viaje": viajes físicos por intervención = viajes por día × días por intervención (se derivan; "Viajes por llamado" deja de usarse con esta unidad) | COT-0011 inconsistente: 1.200 km → 2.400 km, $ 3.900.000 → $ 7.800.000 | Sólo cotizaciones $/viaje cuyo "Viajes por llamado" no coincidía (bug demostrado). Las coherentes (COT-0010, COT-0011) y las demás unidades: idénticas. |
| Combustible de un externo por km (opcional): L/100 km o km/L × km físicos de ruta | 2.400 km × 35 L/100 km = 840 L | No (sin elegirlo sigue por L/h). |
| Recurso compartido (opcional): % del costo FIJO de una persona o un equipo propio | $ 3.280.036 × 25 % = $ 820.009; posesión $ 5.000.000 × 30 % = $ 1.500.000 | No (sin dato = 100 %). |
| Estructura por empleado con personal compartido: dotación equivalente (personas × %) | sólo si hay alguien compartido | No. |

Reglas: la asignación es un dato de la cotización, nunca del recurso maestro; reservado / dedicado / contratado = 100 %; nunca se infiere del uso; las horas extra, viandas, combustible, mantenimiento por uso y demás variables siguen el uso real (no se reducen). El combustible por km de un externo no se duplica con su L/h, con la movilización propia (si va por sus medios, la ruta ya está en su consumo por km) ni con "combustible incluido".

#### 5. Cambios sólo de UX / trazabilidad
- Resumen de transporte (Cómo se cobra, Movilización y viajes, Resultado): viajes facturables, viajes físicos costeados, días de trabajo, km por viaje, km por mes; ruta origen → destino con km de ida, ida y vuelta y equivalente $/km de la tarifa y del proveedor (sin forzar $/km).
- "Distancia / actividad del proveedor" separada de "Movilización propia".
- Completitud: combustible "No aplica" si nadie usa combustible a tu cargo; externo por km o viaje sin ruta = CRÍTICO ("Falta definir la ruta/distancia para calcular este proveedor."), sin $ 0 como si fuera válido; los botones llevan al campo exacto (`?campo=`) o no se muestran.
- Equilibrio sin costos fijos: "Sin costos fijos: cada viaje vendido cubre su costo variable." (y el caso de ingresos fijos con su propio texto).
- Impuestos vs estructura: texto que separa IIBB / cheque / sellos (impuestos sobre lo que facturás) de los gastos de estructura y aviso si un rubro de estructura parece un impuesto que ya está cargado.
- "Ver cálculo" del transporte: viajes ÷ viajes por día = días; viajes físicos × km = km; km × $/km = proveedor; neto, IVA adelantado, caja, crédito, plazo, días financiados y costo financiero.
- "Usado en" en Recursos (personal, equipos y externos): cada cotización con su estado y % asignado; compromiso (adjudicadas) vs potencial (borrador / enviada); aviso si lo comprometido supera el 100 % (no bloquea). Sin módulo de contratos ni estados nuevos.

#### 6. Datos
`SCHEMA_VERSION` 8 → 9 (`migrateV8ToV9`, sólo sube la versión): una versión anterior ignoraría los campos nuevos o costearía la ruta $/viaje con el dato viejo. Campos opcionales nuevos: `labor[].assignment` ('dedicated' | 'shared' | 'hired') y `labor[].fixedCostSharePct`; `equipment[].assignment` ('reserved' | 'shared') y `equipment[].fixedCostSharePct` (equipos propios); `external.fuelMode` ('per_hour' | 'per_100km' | 'km_per_liter'), `external.fuelLitersPer100Km`, `external.fuelKmPerLiter`. `logistics.tripsPerActivation` se conserva (sigue rigiendo con las otras unidades).

#### 7. Tests
Golden COT-0010 y COT-0011; caso inconsistente (deriva 2.400 km, nunca un "completo" silencioso); 1, 2 y 3 viajes por día con los mismos km y el mismo costo del proveedor; $/km sin ruta = crítico; combustible incluido / por L/100 km / propio por L/h sin cambios / provisto por el cliente; asignación 100 % / 25 % (personal) y 100 % / 30 % (posesión) con variables iguales; "Usado en"; migración v8 → v9; confirmación de unidad de materiales y HE 50 / 100; regresión completa (COT-0009 golden y foto de 99 casos contra `main`).

#### 8. Limitaciones conocidas
- Con unidad "viaje" la cantidad de viajes de la ruta es una sola para todo lo que circula por ella (proveedor por km, equipos que van por sus medios y vehículos de apoyo).
- Con "cada salida se cuenta completa" activado, una salida incompleta se costea con todos sus viajes (criterio conservador de PLAN-2026-011).

#### 9. Rollback
Revert del PR. Las cuentas que pasaron a esquema 9 quedarían en sólo lectura en la versión anterior: restaurar la copia previa (`pre-migration-v8`) o mantener esta versión.

#### 10. Review multidisciplinario
Economía (viajes físicos = facturables sin mínimo, % de fijos explícito, combustible sin duplicar), QA (0 viajes por día, sin ruta, sin traslados, mínimo por llamado, 100 % / vacío / inválido), Seguridad (validación de % y consumos, `?campo=` con lista blanca, sin `innerHTML`), UX (resumen de transporte, textos de equilibrio, botones al campo exacto). Se deja escrito en el PR.

#### Bitácora
- 2026-10-16: reproducción de COT-0010 / COT-0011 y de los hallazgos contra `main` (6cc1ca5); plan registrado.
- 2026-10-16: implementado. Golden COT-0010 / COT-0011 (1, 2 y 3 viajes por día y el caso inconsistente) al peso; foto de 99 casos idéntica a `main`; COT-0009 golden sin cambios; completitud de COT-0010 / COT-0011 92 % → 100 %. E2E desktop y mobile (transporte, ruta faltante con foco en el campo, combustible por km, personal compartido 25 %, equilibrio sin fijos y "Usado en").

### PLAN-2026-013 — RATEOS Test Lab v1 (QA, simulación y auditoría internas)

- Estado: Completado (PR #23, main `37179e7`)
- Tipo: otro — infraestructura interna de QA. **No es una funcionalidad visible de RATEOS** y no se publica en `dist/`.
- Responsable: agente de desarrollo (Claude) · revisión del dueño antes de cualquier merge
- Fecha de inicio: 2026-10-16
- Rama / PR: `claude/rateos-test-lab-v1` · sin auto-merge ni deploy

#### 1. Contexto
Las auditorías manuales (COT-0009, COT-0010/0011) encontraron inputs contradictorios, resultados posibles pero conceptualmente mal, avisos imposibles de resolver, combustible pedido aunque estaba incluido, costos en $ 0 por un driver faltante y confusión entre viajes, intervenciones, días y km. Test Lab automatiza ese trabajo: RATEOS intenta romperse a sí mismo.

#### 2. Objetivo y no-objetivos
- Objetivo: evaluar por separado (una dimensión nunca reemplaza a otra) **MATH** (oráculo independiente), **DRIVERS** (cada costo sigue su driver), **INPUTS** (contradicciones), **COMPLETITUD** (faltantes reales, nunca inexistentes), **UX** (avisos resolubles, terminología, consistencia entre pantallas, responsive) y **MERCADO** (plausibilidad, sólo informativa).
- **El mercado no define la fórmula**: una referencia externa distinta nunca cambia una fórmula; produce "MARKET: REVIEW" para revisar los inputs.
- Fuera de alcance: cambiar reglas económicas ambiguas, política comercial o fórmulas por diferencias de mercado (quedan como HUMAN DECISION REQUIRED); funcionalidades nuevas del producto.

#### 3. Impacto en fórmulas
Ninguno por diseño. Si la campaña demuestra un bug, se corrige con el protocolo de AGENTS.md §6 (test que falla antes, golden, suite, CHANGELOG y CALCULATION_RULES) y queda en esta misma rama.

#### 4. Impacto en datos
Ninguno: no cambia `SCHEMA_VERSION` ni el formato. Escenarios 100 % sintéticos (más los golden ya aprobados); nunca datos de clientes.

#### 5. Diseño (se extiende lo existente: `node --test`, golden cases, fixtures, Playwright de los E2E)
- `tests/lab/lib/`: `rng` (PRNG con seed), `oracle` (oráculo económico **independiente**: no importa `js/engines/`; fórmulas cortas escritas desde `docs/CALCULATION_RULES.md`), `product-oracle`, `invariants` (propiedades y relaciones metamórficas), `ux-audit` (contradicciones, avisos resolubles, cero silencioso, no aplica, completitud, terminología, trazabilidad), `coverage` (lee los catálogos del proyecto), `market` (referencias offline → PLAUSIBLE / REVIEW / UNKNOWN), `classify` y `report` (JSON + Markdown), `golden-lock` (candado de los golden).
- `tests/lab/scenarios/`: campaña estable curada (IDs fijos) y generador con seed (pairwise) para la campaña extendida.
- `tests/lab/*.test.js` (**FAST GATE**, dentro de `npm test`): candado de golden, oráculo vs motor, invariantes, cobertura y consistencia determinística.
- `scripts/run-lab.mjs`: `npm run test:lab` (estable) y `npm run test:lab:extended` (seed, 100+ escenarios, mercado). Reportes en `reports/lab/` (ignorado por git; artefacto de CI).
- `tests/lab/e2e/`: auditoría en navegador (escritorio y celular) con el Supabase simulado: cada aviso lleva a un campo real, mismos números en formulario, resumen, "Ver cálculo" y resultado, sin scroll horizontal, sin NaN, controles no tapados.
- `.github/workflows/test-lab.yml`: **PR GATE** (lab estable + E2E principales + build) en cada PR; **EXTENDED LAB** sólo manual (`workflow_dispatch`), listo para correr antes de una release o por schedule. Playwright se instala sólo en ese job (versión fija, sin tocar `package.json`: RATEOS sigue con cero dependencias).

#### 6. Pasos
- [x] 1. Candado de golden + oráculo independiente.
- [x] 2. Escenarios (todos los tipos de servicio y unidades, productos, edge cases) + cobertura automática.
- [x] 3. Invariantes y auditor UX determinístico + trazas de drivers.
- [x] 4. Runner, reportes, mercado, E2E y CI.
- [x] 5. Primera campaña: triage, fixes permitidos (con test que falla antes), re-ejecución.
- [x] 6. Docs (`docs/TEST_LAB.md`), PR sin merge e informe.

#### 7. Tests
Los del propio lab (FAST GATE) + `npm test` completo antes y después de cada fix; golden intactos.

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| El oráculo copia el motor (falsa seguridad) | No importa `js/engines/`; un test de arquitectura lo verifica |
| Lab frágil en cada PR | Campaña estable con IDs fijos; lo exploratorio va al Extended Lab (manual) |
| Actualizar un golden "porque cambió" | Candado con hash por caso: si cambia, FAIL con explicación |
| Datos sensibles en reportes | Sólo datos sintéticos; el reporte se escanea y falla si aparece algo con forma de secreto |

#### 9. Rollback
Revert del PR: no toca datos ni el sitio publicado.

#### 10. Review multidisciplinario
Economía (el oráculo sigue CALCULATION_RULES), QA (casos extremos y propiedades), Seguridad (sin secretos ni PII, CI sin permisos de escritura), UX (auditor de avisos y consistencia). Se deja escrito en el PR.

#### 11. Documentación
- [x] docs/TEST_LAB.md (nuevo)  - [x] README.md (comandos)  - [x] CHANGELOG.md (hubo fixes del producto)  - [x] CALCULATION_RULES.md §19 y §20

#### Bitácora
- 2026-10-16: inventario del repo (11 tipos de servicio, 18 unidades de facturación en 5 familias, 7 unidades de externos, 3 formas de consumo de externos, propios / alquilados / tercerizados, 6 métodos de estructura + desglose, 5 grupos de pago, impuestos combinados / detalle / no aplica, asignación de personal y equipos, completitud con 20 reglas, productos con 6 unidades de medida); plan registrado. Base: `main` `bd75c8c` (v0.7.2, esquema 9).
- 2026-10-16: Test Lab construido. Primera campaña estable (68 escenarios + 19 sondas): 9 hallazgos P0/P1 y 4 P2 que bloqueaban el gate; extendida (seed 20261016, 188): los mismos más variantes generadas. Ningún golden cambió (37/37 y candado OK). El oráculo coincidió con el motor en todos los costos, tarifas y equilibrios; la única diferencia real fue un indicador (externos con salidas completas, LAB-F1). Tres diferencias resultaron ser del lab, no del motor (INV-10 comparaba proveedores por día, INV-25 caía en un salto de tramo, el oráculo no veía una ventana de pérdida justo después de un quiebre): se corrigió el lab.
- 2026-10-16: fixes con el protocolo (test que falla antes en `tests/engines/lab-findings.test.js`, 22 tests): LAB-F1 indicador de externos; F2 combustible con "Sin traslados"; F3 km facturados > km de ruta (sólo cuando faltan costos: una vuelta vacía no se avisa); F4 viaje/km con "Sin traslados"; F5 "Sin traslados" con equipo que viaja; F6 externo $/hora sin horas (crítico); F7 cobro por hora sin horas (crítico); F8 material con precio y cantidad 0 + validación de materiales; F9 avisos informativos (puesto sin posiciones, materiales ignorados); F10/F11 botón al campo exacto; F12 "Ir al campo" dentro del paso usa el `focus` del motor. Ninguno cambia un costo ni una tarifa.
- 2026-10-16: decisiones del dueño registradas (no se inventa la regla): LAB-D1 menos de una salida por mes; D2 horas por día mayores que la jornada; D3 productos sin financiación; D4 derivar km de la ruta; D5 equipo propio que no usa combustible; D6 huecos de CALCULATION_RULES; D7 precio ILUSTRATIVO del combustible frente al mercado; D8 "llamado / salida / intervención".
- 2026-10-16: estado final: estable y extendida (seeds 20261016, 7 y 42) sin P0/P1/P2; navegador escritorio y celular 352/352 controles; `npm test` en verde.

### PLAN-2026-014 — Cierre de las decisiones LAB-D1…D8 (Test Lab)

- Estado: Completado — PR #24 mergeado con autorización del dueño (merge `0c213a3` en `main`); v0.8.0 (esquema 10) en producción
- Tipo: motor de costos (productos), migración de esquema (9 → 10), UX y completitud
- Responsable: agente de desarrollo (Claude) · el dueño decidió cada punto · sin merge ni deploy sin autorización
- Fecha de inicio: 2026-10-17 · Fecha de cierre: 2026-10-17
- Rama / PR: `claude/rateos-lab-decisions-d1-d8` (desde `main` `37179e7`) · PR #24

#### 1. Contexto
Test Lab v1 dejó 8 decisiones del dueño. El dueño ya las tomó; este plan las implementa sin cambiar ningún golden ni el resultado de una cotización existente salvo donde la decisión lo pide explícitamente (y sólo si la persona confirma un dato nuevo).

#### 2. Decisiones y cómo se implementan
| ID | Decisión del dueño | Implementación | ¿Fórmula? |
|---|---|---|---|
| D1 | < 1 salida por mes: mantener la semántica (opción apagada = promedio; prendida = ⌈A⌉ para lo indivisible) y hacerla explícita | Aviso informativo con salidas promedio, salidas costeadas y efecto económico del redondeo, en el paso y en el Resultado; golden + invariante para A < 1 | No |
| D2 | Horas de cobertura de la operación > horas cargadas del puesto: avisar, nunca inferir horas extra, turnos ni convenio | Regla de completitud `labor_hours` (a revisar, sólo si faltan horas): control **mensual** de cobertura que compara las horas del mes (días × horas por día) con las cubiertas por posición (personas × horas normales por mes + horas extra cargadas), con el texto del dueño ("La operación requiere más horas de cobertura que las horas cargadas para este puesto. Revisá dotación, turnos y/o horas extra."), el cálculo del mes y botón a "Personas por posición". No habla de jornada: no existe un dato de jornada diaria y no se agrega (Test Lab: `UX-TERM-JORNADA`) | No |
| D3 | Productos con financiación, sin parche ni motor duplicado | `finance` opcional del producto con los mismos datos que una cotización (días hasta vender, plazo de cobro, tasa, plazo de pago por grupo) reutilizando `computeFinance`; sin datos = $ 0 (los productos existentes no cambian). Es una estimación sobre costos netos: el IVA de compras no se incluye y la interfaz lo aclara siempre junto a la financiación | Sí (sólo productos con datos de financiación) |
| D4 | Km facturables ≠ km de ruta: no derivar, mostrar ambos y avisar si dejan costos sin cubrir | Resumen de transporte con km facturables, km de ruta y su relación; "Ver cálculo" con las dos magnitudes; el aviso de km de LAB-F3 se mantiene | No |
| D5 | Equipo propio que no usa combustible | Dato explícito `equipment[].fuelNotApplicable` ("No usa combustible"): no se pide consumo ni precio por ese equipo y no impide el 100 %; 0 sigue siendo "falta"; sin el dato todo calcula igual | Sí (sólo si se marca) |
| D6 | Huecos de CALCULATION_RULES | Se reconstruye y documenta la regla real (IVA parcial sin %, otros costos "externos", horas de una línea de equipo); el oráculo pasa a citar reglas confirmadas | No |
| D7 | Precio ILUSTRATIVO del combustible | Las cotizaciones reales nuevas con precio ilustrativo lo marcan `fuel.requiresConfirmation`: la completitud pide confirmarlo o reemplazarlo (rojo, con el valor y su base) y se confirma con "Es mi precio vigente" (la casilla que ya existía) o cargando un precio; demo e históricas sin cambios; el mercado nunca cambia el valor | No |
| D8 | Una magnitud = un significado | Un concepto canónico (activación) con copy contextual (`activationTerms`): llamado en on-call o con la unidad "llamado", salida en transporte, trabajo en llave en mano / precio cerrado, intervención en el resto, incluidos los permanentes (término neutral: no hay un dato que diga que cada activación es un relevo o cambio de turno); en formulario, ayudas, avisos, "Ver cálculo", Resultado/PDF y docs; auditoría de terminología estática y dinámica en Test Lab | No |

#### 3. Impacto en fórmulas
Sólo D3 (productos con financiación cargada), D5 (equipo marcado "No usa combustible") y el tope de 24 h por día por unidad de equipo (decisión del dueño antes del merge; sólo cambia una línea con un dato inválido > 24). Ningún golden cambia; los productos y las cotizaciones existentes calculan igual.

#### 4. Impacto en datos
Esquema 9 → 10 (`migrateV9ToV10`: sin cambios de datos; sólo sube la versión). Campos opcionales: `equipment[].fuelNotApplicable`, `fuel.requiresConfirmation`, `product.finance`. Una versión anterior abre los datos v10 en sólo lectura.

#### 5. Pasos
- [x] 1. Helper de terminología + esquema 10.
- [x] 2. D5, D7 (datos y completitud) · D1, D2, D4 (avisos y trazas).
- [x] 3. D3 (motor, validación, editor y resultado de productos) · D6 (documentación y oráculo).
- [x] 4. D8 en toda la interfaz y los motores + auditoría de terminología.
- [x] 5. Test Lab: escenarios D1…D8, gate estable, extendido con varias seeds, E2E escritorio/celular; docs; PR sin merge.

#### 6. Tests
Test que falla antes de cada cambio, suite completa, candado de golden, Test Lab estable y extendido, E2E.

#### 7. Rollback
Revert del PR; los datos v10 sólo agregan campos opcionales (una versión anterior los abre en sólo lectura).

#### Bitácora
- 2026-10-17: auditoría del código de cada decisión; plan registrado. Base `main` `37179e7`.
- 2026-10-17: D3 auditado antes de implementar: `computeFinance` sirve sin cambios (Z = días entre producir y vender, X_g = días después de producir; el impulsor variable es la unidad vendida). No hizo falta rediseño ni plazos nuevos: se implementó (no queda como plan pendiente).
- 2026-10-17: implementado D1…D8 con un test que falló antes de cada cambio (`tests/engines/lab-decisions.test.js`); dos golden nuevos para D1 aprobados en el candado; los 37 anteriores intactos. Antes → después en COT-0009/0010/0011, la demo y 56 escenarios del Lab: costos, tarifas, equilibrio y costo financiero idénticos; sólo cambia el puntaje de completitud donde aparece el aviso de D2.
- 2026-10-17: Test Lab estable (77 escenarios + 22 sondas + auditoría de terminología) y extendido (seeds 20261016, 7, 42 y 20261017, 197 escenarios cada una) sin hallazgos bloqueantes; golden 39/39 con el candado OK; `npm test` 1632 (main: 1580); E2E escritorio y celular 277/277.
- Quedan para el dueño (no bloquean el PR): número de versión al publicar (el esquema ya es 10; `package.json` sigue en 0.7.2); las horas por día de la actividad se limitan a 24 y las de una línea de equipo no (regla real documentada en §4); D2 compara horas del mes porque no existe un dato de jornada diaria (agregarlo sería un dato nuevo); la financiación de productos usa importes netos (el IVA de los insumos no se financia, igual que los materiales de una cotización).
- 2026-10-17 (revisión del dueño del PR #24, micro-pase sin ampliar alcance): D2 sin "jornada" (texto de cobertura mensual, sin dato nuevo; auditoría `UX-TERM-JORNADA` estática y dinámica); D3 sigue sobre costos netos y lo dice en la tarjeta "Financiación", el resultado del mes y "Ver cálculo" ("Estimación financiera sobre costos netos. El IVA de compras no está incluido en este capital de trabajo."; Test Lab: `UX-PRODUCT-FINANCE-SCOPE`); productos sigue en confianza MEDIUM hasta un caso real auditado; D8: un servicio permanente usa "intervención" (sin "cambio de turno" automático); versión **0.8.0** (`package.json`, `version.json`, CHANGELOG, README; el esquema no se toca). Ninguna fórmula cambia. Decisión abierta: el tope de 24 h por día de la actividad vs una línea de equipo sin tope.
- 2026-10-17 (última decisión del dueño antes del merge, cierra la decisión abierta): `hoursPerActiveDay` de una línea de equipo, propia o externa, son horas **por unidad**, como mucho 24 (el mismo tope de la actividad y de la validación); la cantidad va en `quantity` (2 equipos × 20 h = 40 equipo-horas por día). Más de 24 sigue siendo error de validación y el motor ya no calcula por encima (`equipmentHoursPerDay` en `computeEquipmentLine` y `computeExternalLine`; nota en "Ver cálculo"; el oráculo de Test Lab sigue la misma regla). Tests 8 / 24 / 24,1 / 30 h y 2 × 20 h, propio y externo, que fallaron antes del cambio. Sin cambio de esquema ni de versión (0.8.0, esquema 10); ningún golden ni escenario anterior usaba más de 24 h. No quedan decisiones abiertas en este plan.
- 2026-10-17 (cierre): el dueño autorizó el merge del PR #24 (head `82df9d6`, sin conflictos, checks en verde). Merge `0c213a3` en `main`; el deploy de producción publicó **v0.8.0** (esquema 10) desde ese commit. Verificado después del merge: `npm test` en verde, golden 39/39 con el candado, gate estable de Test Lab en verde. No se creó el tag `v0.8.0` (ver PLAN-2026-015 §2).

### PLAN-2026-015 — Beta Readiness v1: seguridad, tenancy, integridad y privacidad

- Estado: Completado — PR #25 mergeado con autorización del dueño (merge `998b932` en `main`, 2026-10-18); el deploy de producción (run #73) publicó **v0.8.1** (esquema 10) desde ese commit. Rama `claude/rateos-beta-security-v1` (base `main` `0c213a3`, v0.8.0). **Beta con empresas externas: no iniciada** (decisión del dueño): HD-01, HD-02 y HD-03 son requisitos obligatorios antes de habilitar usuarios reales (los cierra PLAN-2026-016). Tag `v0.8.0` → `0c213a3`: decidido; lo crea el dueño (esta sesión no puede publicar tags: el push de un tag da 403).
- Tipo: backend, autenticación, otro (seguridad y privacidad; sin fórmulas nuevas)
- Responsable: agente de desarrollo (Claude) · decisiones de permisos e infraestructura: el dueño
- Fecha de inicio: 2026-10-17

#### 1. Contexto y problema
Antes de una beta cerrada con empresas reales hay que probar que una empresa nunca puede leer, modificar ni inferir datos económicos de otra (aunque conozca sus IDs), que el admin de plataforma no lee contenido de clientes, que no quedan datos de una sesión anterior a la vista y que nunca se pierde en silencio el último dato válido.

#### 2. Objetivo y no-objetivos
- Objetivo: inventario real de la base, tests de negación A/B en la base, auditoría del navegador (sesión, pestañas, import/export, recuperación, logs), correcciones claras con un test que falla antes, Beta Security Gate reproducible y lista de decisiones del dueño.
- Fuera de alcance (pedido del dueño): historial/revisiones, billing, créditos beta, landing pública, modalidades nuevas, fórmulas nuevas, IA. Ninguna política se "arregla" sola si el modelo de permisos es ambiguo (HUMAN DECISION).
- Housekeeping: PLAN-2026-014 → completado (PR #24, `main` `0c213a3`, v0.8.0). **Tag `v0.8.0`:** la política (DEPLOYMENT.md §6) usa tags sólo para hitos y como punto natural de rollback, pero **no existe ningún tag** en el repo (tampoco `v0.1.0`). Aporta un punto de retorno con nombre para la versión que llega a la beta (el rollback manual también acepta SHAs, así que no es imprescindible). Propuesta: `git tag -a v0.8.0 0c213a3 -m "RATEOS v0.8.0"`. **Decisión del dueño (2026-10-17):** crearlo exactamente sobre `0c213a3` y no moverlo nunca. Lo crea el dueño: el push de tags desde esta sesión da 403 (ver bitácora).

#### 3. Impacto en fórmulas
Ninguno. No se tocan motores; golden 39/39 sin cambios.

#### 4. Impacto en datos
- Base: sin migraciones (sólo un archivo de tests SQL).
- Esquema de RATEOS: 10, sin cambios; backups iguales.
- Navegador: la copia de cambios sin subir pasa a una clave por pestaña (`rateos.cloud.<u>.<o>.pending.<pestaña>`); la de v0.8.0 se sigue leyendo. Marca `rateos.cloud.local-import.claimed` (sin datos ni ids). Ningún dato se pierde: una copia se suelta sólo cuando quedó a salvo.

#### 5. Diseño
Detalle en [docs/BETA_SECURITY.md](../docs/BETA_SECURITY.md): frontera de tenant (RLS sobre `workspace_states` por membresía), inventario en vivo, pruebas, hallazgos BS-01…BS-09, decisiones HD-01…HD-09 y gate SEC-01…SEC-16.

#### 6. Pasos
- [x] 1. Housekeeping de PLAN-2026-014 y propuesta del tag (sin crearlo).
- [x] 2. Inventario de la base en vivo (sólo lectura) y del navegador.
- [x] 3. `supabase/tests/beta_security_test.sql` (132 controles) + `rls_test.sql` (40) + `rls_admin_test.sql` (32) corridos en la base real con datos sintéticos (todo deshecho; conteos verificados después).
- [x] 4. Reproducción de los hallazgos contra `main` y correcciones (BS-01…BS-09) con tests (los de BS-01, BS-02, BS-03/04, BS-07 y BS-09 fallaron antes del cambio).
- [x] 5. Beta Security Gate (`npm run test:security`, dentro de `npm test` y en CI); contra `main` falla en SEC-05/06/07/08, con la rama pasa.
- [x] 6. E2E `SESION-01/02` (escritorio y celular).
- [x] 7. Documentación (BETA_SECURITY, ARCHITECTURE, AUTH_ARCHITECTURE, DATA_MODEL, SUPABASE_PLAN, AGENTS, README, CHANGELOG).
- [ ] 8. Decisiones del dueño HD-01…HD-09 y merge (sólo con autorización).

#### 7. Tests
`tests/data/beta-security.test.js`, `tests/security/beta-security-gate.test.js`, `supabase/tests/beta_security_test.sql`, E2E `SESION-01/02`; suite completa, Test Lab estable y E2E escritorio/celular.

#### 8. Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| Los tests en la base no corren en CI (sin credenciales, a propósito) | Se corren con el plugin/MCP antes de cada release y después de cada migración; el gate verifica que el test SQL siga completo |
| Origen compartido, staging con la base de producción, registro abierto | Decisiones del dueño HD-01…HD-03 (condiciones para empresas reales) |

#### 9. Rollback
Revert del PR. No hay migraciones ni cambio de esquema; una versión anterior sigue leyendo la copia pendiente de su clave (las copias por pestaña que queden las ignora, sin borrarlas).

#### 10. Review multidisciplinario
- Economía: sin cambios de fórmulas; los motores no se tocaron.
- QA: pestañas, sesión vencida, cambio de cuenta, miembro quitado, nube ilegible, esquema futuro, falla a mitad de guardado, misma cotización en dos pestañas.
- Seguridad: RLS probada en la base con IDs conocidos en ambas direcciones; sin service-role; admin sin contenido; `organizationId` del cliente ignorado.
- UX: mensajes claros ("Ya no tenés acceso a esta empresa", sólo lectura con datos ilegibles, otra pestaña), nunca "guardado" sin la nube.

#### Bitácora
- 2026-10-17: base `main` `0c213a3` confirmada, árbol limpio, rama nueva. Inventario de la base en vivo: migraciones 2 = 2, RLS en todas las tablas, grants mínimos, sin Storage, Realtime ni GraphQL, advisors (sólo `auth_leaked_password_protection`).
- 2026-10-17: reproducidos contra `main` BS-01 (nube dañada → espacio vacío subido), BS-02 (pestaña que borra la copia pendiente de otra) y BS-07 (`organizationId` del cliente guardado).
- 2026-10-17: tests SQL en la base real: 132 + 40 + 32 controles en verde; sin restos (conteos iguales). El plugin de Supabase pide confirmación para DELETE: el test se rediseñó para no ejecutar ningún DELETE como `postgres` (savepoint) en lugar de saltear ese control.
- 2026-10-17: correcciones BS-01…BS-09 (BS-08 y BS-09: "Conservar una copia" con la versión actual y cupo propio para copias de cambios sin subir); gate en verde (contra `main` falla en SEC-05/06/07/08). E2E 574/574 (16 controles nuevos de sesión).
- 2026-10-17 (cierre, autorización del dueño con condiciones): versión de parche **0.8.1** con esquema 10 y CHANGELOG `[0.8.1]` (BS-01…BS-09 con su clasificación); tag `v0.8.0` sobre `0c213a3` decidido (no se mueve nunca; lo crea el dueño); HD-01 (dominio propio), HD-02 (staging separado en origen y base, o `/preview/` deshabilitado) y HD-03 (registro cerrado o por invitación) registrados como requisitos obligatorios antes de habilitar usuarios reales (AGENTS.md §13, BETA_SECURITY.md §6; el gate los rotula REQUISITO pendiente, sin bloquear el CI del código); no se inicia la beta con empresas externas; sin funcionalidades nuevas ni cambios en motores. Antes del release se volvieron a correr los tres SQL en la base real (23:44 UTC): 132 + 40 + 32 = 204 controles en verde; sin restos (conteos, revisión máxima y fecha del último guardado iguales antes y después). Qué corre dónde: BETA_SECURITY.md §3 (base real a mano / Supabase simulado / navegador / estático en CI).
- 2026-10-18 (merge): el push del tag `v0.8.0` dio 403 (esta sesión sólo puede publicar ramas); el dueño eligió mergear primero y crear el tag después. Merge `998b932` (padres `0c213a3` y `1f8e000`); deploy de producción run #73 en verde (tests, build, deploy; Pages publicó `998b932`, versión 0.8.1, ref `main`, 00:55 UTC); sobre `998b932`: `npm test` 1678/1678, golden 39/39 con el candado, gate PASA (324/324), Test Lab estable OK.

### PLAN-2026-016 — Beta Perimeter v1: preview deshabilitado, registro por invitación, dominio propio y prueba A/B real

- Estado: En curso — rama `claude/rateos-beta-perimeter-v1` (desde `main` `998b932`, v0.8.1, esquema 10); PR sin merge ni deploy (sin autorización del dueño no se mergea ni se publica)
- Tipo: backend, autenticación, otro (infraestructura y seguridad; sin fórmulas nuevas)
- Responsable: agente de desarrollo (Claude) · configuración de Auth, DNS, dominio y Pages: el dueño
- Fecha de inicio: 2026-10-18

#### 1. Contexto y problema
PLAN-2026-015 dejó tres requisitos obligatorios antes de habilitar usuarios reales: HD-01 (el origen `joaquinvedova1.github.io` es compartido por todos los sitios de Pages de la cuenta), HD-02 (el staging `/preview/` comparte origen y base con producción: el código de cualquier rama con CI verde corre junto a sesiones y datos reales) y HD-03 (el registro está abierto). Objetivo del dueño: una beta cerrada con 3–5 empresas.

#### 2. Objetivo y no-objetivos
- **HD-02:** deshabilitar por completo el preview público: el workflow publica sólo producción, ningún artefacto trae `/preview/` (así no quedan archivos viejos: cada deploy reemplaza el sitio entero) y después de publicar se verifica que `/preview/` responda 404. Documentar cómo reactivar un staging **aislado** (otro origen y otra base) más adelante.
- **HD-03:** registro exclusivamente por invitación, preservando login, recuperación de contraseña y usuarios existentes. Investigar la configuración actual (sólo lectura) y proponer el método más simple. La app deja de ofrecer el registro; la barrera real es Supabase Auth y **no se toca sin autorización del dueño**.
- **HD-01:** procedimiento para publicar en un dominio propio con HTTPS (datos que necesita el dueño, DNS, Pages, Supabase) y la app lista para el origen nuevo, manteniendo producción en github.io hasta verificar el dominio.
- **Prueba A/B real:** dos usuarios autenticados y dos organizaciones sintéticos contra Supabase real (acceso, aislamiento, guardado, logout, cambio de usuario), sin leer datos económicos existentes; limpiar sólo los datos sintéticos identificados, con autorización.
- No-objetivos: motores, fórmulas, esquema, migraciones de base, iniciar la beta, comprar o inventar un dominio, infraestructura compleja (staging aislado sólo documentado), cambiar Auth/DNS/Pages, merge o deploy sin autorización.

#### 3. Impacto en fórmulas
Ninguno. Golden 39/39 y el candado del Test Lab sin cambios.

#### 4. Impacto en datos
Esquema 10 sin cambios; ninguna migración. La prueba A/B crea en la base real 2 usuarios con email `@rateos.invalid` y sus 2 organizaciones/workspaces (el trigger de alta); se identifican por esos emails y se borran sólo con autorización.

#### 5. Diseño
- **HD-02:** `deploy-pages.yml` sólo con `push` a `main` y `workflow_dispatch` (`ref` = rollback); sin `workflow_run`, sin job de preview ni `stage-preview.mjs`. Guardia en el build: falla si `dist/preview` existe. Verificación posterior al deploy: `version.json` publicado = commit desplegado y `/preview/` + `/preview/version.json` → 404 (con reintentos). Control SEC-17 del Beta Security Gate.
- **HD-03:** `FEATURES.publicSignup = false`: la app no ofrece "Crear cuenta" (las llamadas a la acción llevan a Ingresar; `#/registro` explica la beta por invitación) y `signUp` no llama a la API. `signup_disabled` / `email_provider_disabled` → mensaje "registro por invitación". Método propuesto: apagar **"Allow new users to sign up"** en Supabase Auth (no el proveedor Email) y dar de alta desde el Dashboard (Add user → Create new user, Auto Confirm); la persona elige su contraseña con "¿Olvidaste tu contraseña?" (PKCE). Los enlaces de invitación del Dashboard no se usan: no son PKCE y la app los rechaza a propósito. `scripts/check-auth-perimeter.mjs` verifica la configuración pública de Auth (`/auth/v1/settings`) y lista lo que no es público (SMTP propio) como verificación manual. **SMTP propio obligatorio antes de invitar:** con el SMTP por defecto Supabase sólo envía correos al equipo del proyecto (`email_address_not_authorized`), así que una persona invitada nunca recibe el correo para elegir su contraseña. La app lo mapea a `email_not_authorized`: fuera de sesión la recuperación sigue neutra (ese error sólo aparece si la cuenta existe) con un aviso técnico sin el email; con la sesión iniciada y el propio email, "Cambiar contraseña" informa cualquier falla de envío.
- **HD-01:** `PUBLIC_SITE_URLS` (el primero es el principal para los enlaces de los emails) y `MOVED_TO_SITE_URL` (redirección desde el origen viejo, apagada hasta verificar el dominio). Procedimiento en `docs/BETA_PERIMETER.md`.
- **Prueba A/B:** `tests/live/perimeter-ab.mjs` (opcional, nunca en CI) con la app compilada y Supabase real; SQL de alta, verificación y limpieza con marcadores sintéticos en `supabase/tests/live_ab.sql` (sin contraseñas en el repo).

#### 6. Pasos
- [x] 1. Housekeeping de PLAN-2026-015 (merge `998b932`, deploy run #73, tag `v0.8.0` pendiente del dueño) y este plan.
- [x] 2. HD-02: workflow sólo producción + guardias + tests + SEC-17 + docs.
- [x] 3. HD-03: investigación (sólo lectura), app por invitación, tests, verificación de la configuración pública y docs (incluido el requisito de SMTP propio).
- [x] 4. HD-01: config para el origen nuevo, tests y procedimiento.
- [ ] 5. Prueba A/B real: script + SQL listos; ejecutarla cuando la red del entorno llegue a Supabase (o el dueño en su máquina); limpiar con autorización.
- [x] 6. Validación completa (npm test, gate, Test Lab, golden, E2E), docs, riesgos y checklist del dueño. PR sin merge: se abre con la autorización del push (riesgo de `/preview/`, §8).

#### 7. Tests
`tests/static-site.test.js` (workflow sin preview, guardia y verificación), SEC-17, tests de `siteUrlFor`/`movedTarget`, registro cerrado en `AuthService` y en las vistas, E2E (registro por invitación, CTAs), y la prueba A/B real (manual, fuera de CI).

#### 8. Riesgos y mitigación
- El registro sigue abierto **en la API** hasta que el dueño apague "Allow new users to sign up": la app sólo deja de ofrecerlo (el gate y `check-auth-perimeter` lo informan).
- Pushear una rama mientras `main` todavía tenga el workflow viejo vuelve a publicar `/preview/` con esa rama: se pide autorización antes del primer push.
- Sin SMTP propio las personas invitadas no reciben el correo para elegir su contraseña, y fuera de sesión la app no lo puede decir sin revelar qué emails tienen cuenta: SMTP propio en el checklist del dueño, antes de la primera alta, con una prueba con un email ajeno al equipo de Supabase.
- Escáneres de correo corporativos pueden abrir el enlace de un solo uso antes que la persona ("El enlace venció o ya se usó"): pedir otro; si se repite, la mitigación documentada por Supabase (plantilla con un enlace a una página propia con un botón) es un cambio aparte, con autorización.
- Cambio de dominio: los datos locales del origen viejo (copias sin subir, sesión) no pasan al nuevo; antes del cambio cada persona sincroniza, exporta un backup y cierra sesión.
- Con `disable_signup`, Supabase sólo crea usuarios por invitación o desde el Dashboard (comportamiento documentado de GoTrue); el login y la recuperación de usuarios existentes no dependen del registro: verificarlo con la prueba A/B real.

#### 9. Rollback
Revert del PR. Volver a publicar un preview en el mismo origen está **prohibido** (HD-02); un staging nuevo tiene que ser aislado (`docs/BETA_PERIMETER.md`).

#### 10. Review multidisciplinario
- Economía: sin cambios en motores ni fórmulas.
- QA: registro cerrado, recuperación, usuario existente, cambio de usuario, `/preview/` 404, origen nuevo y viejo.
- Seguridad: sin staging en el origen de producción, registro por invitación sin `token_hash`, sin secretos ni contraseñas en el repo, limpieza sólo de datos sintéticos.
- UX: textos claros de beta por invitación y primer ingreso con "¿Olvidaste tu contraseña?".

#### Bitácora
- 2026-10-18: base `main` `998b932` (v0.8.1, esquema 10), árbol limpio, rama nueva. Sin tags en el repo (el tag `v0.8.0` sigue pendiente del dueño). La red de este entorno no llega a `dltlnizvnvnefgbzfftu.supabase.co` (403 del proxy): la prueba A/B real queda preparada hasta que el dueño agregue ese host o la corra en su máquina.
- 2026-10-18: Auth en la base (sólo conteos): 2 usuarios, ambos confirmados; identidades sólo `email`; 0 invitados, 0 anónimos, 0 SSO, 0 MFA. El trigger `private.handle_new_user` crea perfil, organización ("Mi empresa" si no hay `company`), membresía OWNER y workspace vacío para **cualquier** usuario nuevo (también los creados desde el Dashboard). Borrar un usuario no borra su organización: la limpieza borra primero las organizaciones sintéticas.
- 2026-10-18: hallazgo al revisar el alta por invitación: el primer ingreso depende del correo de recuperación y, según la documentación de Supabase, el SMTP por defecto rechaza toda dirección que no sea del equipo del proyecto (*Email address not authorized*). La recuperación respondía "te enviamos un enlace" igual (neutra a propósito), así que la falla habría sido silenciosa. Corregido en la app lo que se puede sin revelar cuentas (código propio, aviso técnico, "Cambiar contraseña" con la sesión iniciada informa la falla) y agregado el SMTP propio como paso obligatorio del dueño. La configuración de SMTP no es pública: no se pudo verificar desde acá.
- 2026-10-18: validación sobre la rama (cambios sin commitear sobre `998b932`): `npm test` 1694/1694; Beta Security Gate PASA (347/347 tests en 17 archivos; SEC-17 OK, contra `main` falla con 5 hallazgos); Test Lab estable OK, golden 39/39 con el candado; `npm run build` sin `dist/preview`; E2E escritorio y celular 584/584 (10 controles nuevos `REGISTRO-01`). Motores, fórmulas, esquema (10) y migraciones de base sin cambios.

### PLAN-2026-017 — ECO-01: bloqueantes económicos de la beta (H-01, H-02, H-03)

- Estado: En curso — rama `claude/wonderful-brown-g2ehd6` (desde `main` `d580d9f`, v0.8.1, esquema 10); PR sin merge ni deploy (espera la aprobación del dueño)
- Tipo: motor de costos (unidad de externos), completitud, UX
- Responsable: agente de desarrollo (Claude) · decisiones económicas: el dueño
- Fecha de inicio: 2026-10-19

#### 1. Contexto y problema
El dueño decidió que tres hallazgos de la auditoría comercial AUD-T1 bloquean la beta comercial. En los tres el motor calcula bien lo que se carga; el problema es que la carga lleva a un resultado falso sin aviso:
- **H-01:** un transportista que cobra "por viaje ida y vuelta" no tenía unidad: "Por viaje" era cada tramo (ida **o** vuelta) y "Por salida", una vez por salida con todos sus viajes. La misma tarifa daba la mitad o el doble del costo.
- **H-02:** con la tarifa en $/mes (abono), el "Abono de disponibilidad" se suma como otro ingreso fijo: el abono cargado en los dos lugares se factura dos veces.
- **H-03:** un puesto usado con el sueldo básico vacío o en 0 no generaba ningún aviso (costo laboral de menos, completitud casi completa).

#### 2. Objetivo y no-objetivos
- Objetivo: que servicios vendidos y unidades facturadas por el proveedor sean coherentes y explicables (H-01); impedir que el doble abono pase como resultado confiable y mostrar cómo se compone la facturación (H-02); no presentar como completa una cotización con un puesto sin sueldo (H-03). Sin reinterpretar datos guardados ni cambiar fórmulas históricas.
- Fuera de alcance: H-04 a H-15, la tanda 2 de la auditoría, el esquema de Supabase, migraciones de datos, datos reales, Auth/DNS/SMTP/producción.

#### 3. Impacto en fórmulas
- **Ninguna fórmula existente cambia.** "Por tramo" (`trip`) cuenta tramos como siempre, "Por salida" cobra una vez por salida y el abono de disponibilidad se suma como siempre.
- **Unidad nueva (opcional):** "Por viaje completo (ida y vuelta)" = `trip` + `external.tripBasis = 'round_trip'`: unidades por llamado = viajes por llamado (no tramos). E3: 928.000 por viaje completo = 2.900 $/km = 464.000 por tramo → costo $ 41.281.757,11, sugerida $ 1.377.000 (CALCULATION_RULES §4.1).
- **Completitud:** `external_unit_trips` (crítico, peso 2; confirmación ligada al supuesto), `monthly_fee_overlap` (crítico, peso 2) y `labor` crítico con un puesto usado sin básico, los tres `unreliable` ("RESULTADO NO CONFIABLE"); productos: error con un puesto con minutos por tanda y sin básico (§19, §23). Sólo aparecen cuando se disparan.
- `revenueComposition`: presentación de los componentes de `computeRevenue` (§12.0), sin cálculo nuevo.
- Golden: 39/39 sin cambios (ningún archivo de golden tocado). Margen y markup sin cambios.

#### 4. Impacto en datos
- Esquema 10 sin cambios; ninguna migración. Campos opcionales nuevos: `external.tripBasis` (sólo `'round_trip'`) y `equipment[].externalUnitConfirmed` (el supuesto confirmado: tarifa, viajes por salida y ruta). Sin ellos todo calcula igual.
- Ningún dato se pierde ni se reinterpreta. Compatibilidad con una pestaña de la versión anterior y alternativa de subir a v11: DATA_MODEL §5 y decisión D-ECO01-1 del informe.

#### 5. Diseño
- Motores: `external-engine` (base del viaje), `cost-engine` (viajes por llamado al externo), `transport-engine` (tramos, viajes completos, equivalencias y proveedores por salida en la traza), `completeness-engine` (tres reglas), `commercial-rules-engine` (`revenueComposition`), `product-engine` (error de sueldo). Dominio: `catalogs` (rótulos y `EXTERNAL_TRIP_BASES`), `quote-factory` y `resource-snapshot` (el campo nuevo sólo con `round_trip`: las huellas anteriores no cambian).
- UI: Equipos (opción "Por viaje completo", aviso con [Por viaje completo] / [Sí, cobra por salida]), Recursos ("¿Qué cobra?" con "Por tramo"), El precio (aviso del doble abono), Personal (aviso en la línea) y Resultado ("Cómo se compone la facturación del mes"). Sin fórmulas en la UI.

#### 6. Pasos
- [x] 1. Leer la evidencia de AUD-T1 y escribir las regresiones (fallan 12 de 20 en `main`).
- [x] 2. Motores y dominio (H-01, H-02, H-03).
- [x] 3. Interfaz y E2E (E2E-17 a E2E-20).
- [x] 4. Validación completa, comparación con `main` y regresión en navegador con E1, E2 y E3.
- [ ] 5. PR sin merge, informe ECO-01 en el repositorio privado de auditoría y aprobación del dueño.

#### 7. Tests
`tests/engines/eco-01.test.js` (20 tests: 12 fallan en `main`, los 8 restantes protegen lo que no debe cambiar), fixtures sintéticos en `tests/fixtures/eco-01/` (sólo datos económicos) y E2E-17 a E2E-20 en `tests/lab/e2e/ui-lab.mjs`.

#### 8. Riesgos y mitigación
- Una pestaña de la versión anterior abierta durante el deploy costea una línea "por viaje completo" por tramo (de más, nunca de menos) y no ve los avisos: documentado; subir el esquema es decisión del dueño.
- Una cotización existente con "Por salida" y varios viajes por salida, o con abono mensual + abono de disponibilidad, pasa a mostrar un aviso (y la segunda, a borrador): es el objetivo. Comparación con `main`: 58 y 39 de 2.097 cotizaciones sintéticas; ninguna cifra cambia.

#### 9. Rollback
Revert del PR. Los datos con `tripBasis` quedan válidos en la versión anterior (se costean por tramo).

#### 10. Review multidisciplinario
- Economía: ninguna fórmula cambia; la unidad nueva da lo mismo que el $/km equivalente.
- QA: rojo en `main`, verde en la rama; golden y candado sin cambios; corpus de 2.097 cotizaciones con las mismas cifras.
- Seguridad: sin cambios de esquema, Auth ni base; sin datos reales.
- UX: cada aviso nombra los números y lleva al campo; el resultado muestra cómo se compone la facturación.

#### Bitácora
- 2026-10-19: base `main` `d580d9f` (v0.8.1, esquema 10). Regresiones escritas primero: 12 de 20 fallan en `main`.
- 2026-10-19: implementación sin subir el esquema (flag opcional `tripBasis`). Validación: `npm test` en verde, Test Lab igual a `main` (golden 39/39, candado OK), E2E escritorio y celular, comparación con `main` y regresión en navegador con E1, E2 y E3. PR #27.
- 2026-10-19: revisión independiente (ChatGPT, publicada por el dueño): "no aprobado todavía". Cambios: (1) `external_unit_trips` crítico hasta confirmar; (2) la confirmación guarda el supuesto (tarifa, viajes por salida, distancia, ida y vuelta) y vuelve el crítico si cambia; (3) "RESULTADO NO CONFIABLE — NO UTILIZAR ESTA TARIFA" arriba del margen en pantalla y PDF, y el margen / cálculo de días / resumen del editor dicen "NO CONFIABLE"; (4) compatibilidad con 0.8.1 probada en navegador (ver DATA_MODEL §5): sin cambio de esquema, la decisión queda para el dueño. Corrección de una afirmación anterior: en producción una migración de esquema corre sola (la confirmación es sólo de las versiones de prueba).

### PLAN-2026-018 — HD-03: alta por invitación y correos de Auth

- Estado: En curso — rama `claude/wonderful-brown-g2ehd6` (reiniciada desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: autenticación, UX, otro (correo transaccional)
- Responsable: agente de desarrollo (Claude) · configuración de Auth, SMTP y DNS: el dueño
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
Una persona invitada completó un formulario y nunca recibió el correo. Diagnóstico en sólo lectura (resumen en BETA_PERIMETER.md §2; detalle en la bitácora privada): no había alta previa, así que "¿Olvidaste tu contraseña?" no envió nada, y la pantalla decía "…te enviamos un enlace". Además, el SMTP es el por defecto de Supabase (sólo entrega al equipo del proyecto), el registro del backend sigue abierto y hay señales de un escáner que consume los enlaces de un solo uso.

#### 2. Objetivo y no-objetivos
- Objetivo: que una persona pueda entrar por primera vez con un correo real, sin depender del navegador donde lo abre, y que la app diga la verdad cuando no llega nada, sin revelar quién tiene cuenta. **Desde R2 (decisión del dueño, 2026-10-20): registro público y autoservicio**, con confirmación de email obligatoria y su propia empresa.
- Fuera de alcance: cambiar Auth, SMTP, DNS o cuentas en producción (los hace el dueño, con los pasos de BETA_PERIMETER.md §2), esquema, datos y migraciones.

#### 3. Impacto en fórmulas
Ninguno.

#### 4. Impacto en datos
Ninguno: sin migraciones ni campos nuevos. No se tocó ninguna cuenta.

#### 5. Diseño
- `auth-gateway`: `verifyRecoveryCode(email, code)` → `verifyOtp({ type: 'recovery' })`.
- `auth-service`: respuesta neutra `RESET_REQUESTED_MESSAGE` (la misma con o sin cuenta, SMTP por defecto o roto) con qué hacer si no llega y `cooldownSeconds: 60`; `RESET_SENT_OWN_MESSAGE` con la sesión iniciada; `verifyRecoveryCode` (6–10 dígitos) que deja la sesión en modo recuperación; `parseAuthFragment`/`cleanAuthFragment`: los enlaces con tokens o errores en el # ("Send invitation") nunca se usan y se borran de la URL; enlace de recuperación inválido → mensaje que ofrece el código.
- UI: `#/registro` con los pasos del primer ingreso (sin alta no llega ningún correo); recuperación en dos pasos (pedir el correo; enlace o "Ya tengo un código"), reenvío con cuenta regresiva y la cuenta a la vista al elegir la contraseña.
- Plantillas de correo en español (`supabase/templates/`): recuperación con enlace y código (misma credencial: abrir el enlace usa el código); variante sólo código si un escáner consume los enlaces; invitación que lleva a "Elegir mi contraseña"; confirmación para el futuro (no se usa en la beta cerrada).
- Proveedor recomendado: Resend (seguimiento de enlaces apagado por defecto). Con cualquier proveedor, el seguimiento de clics tiene que estar apagado; Brevo no se recomienda porque en transaccionales viene activo y apagarlo no es autoservicio.

#### 6. Pasos
- [x] 1. Diagnóstico en sólo lectura (usuarios agregados sin datos personales, logs de Auth y del gateway).
- [x] 2. Servicio, puerta y pantallas; plantillas.
- [x] 3. Tests simulados: unitarios (`tests/services/auth-email.test.js`) y navegador (`npm run test:auth:e2e`, escritorio y celular, en el PR gate).
- [x] 4. Docs: BETA_PERIMETER §2 (diagnóstico, §2.3 SMTP con Resend, §2.4 pruebas reales, §2.5 simuladas), AUTH_ARCHITECTURE §4, CHANGELOG.
- [x] 5. PR sin merge; informe HD-03 en el repositorio privado de auditoría.
- [x] 5b. Ronda R1 (revisión independiente): ver abajo.
- [ ] 6. El dueño: apagar el registro, dominio, Resend, SMTP y plantillas en Supabase, pruebas reales R1–R9 (R4 después del deploy).

#### 7. Tests
- Simulados: `tests/services/auth-email.test.js` (15) y `tests/services/auth-service.test.js` (actualizado); `tests/lab/e2e/auth-lab.mjs` (AUTH-01 a AUTH-09: 38 controles por modo). El Supabase simulado suma `/recover`, `/verify` (enlace y código), canje PKCE y un buzón en memoria.
- Reales (manuales, del dueño): BETA_PERIMETER.md §2.4.

#### 8. Riesgos y mitigación
- Sin SMTP propio nadie de afuera recibe correos: lo detecta la prueba R2.
- Un escáner puede consumir el enlace y, con él, el código de ese correo (misma credencial): lo detecta la prueba R9; mitigación, la plantilla sólo código.
- Enumeración de cuentas: la respuesta sin sesión es idéntica; sólo los límites de envío del propio Supabase podrían distinguirlas (sin cambios).

#### 9. Ronda R1 (revisión independiente del PR)
- El subtítulo de "¿Olvidaste tu contraseña?" prometía un correo antes de pedirlo ("Te mandamos un correo…"): ahora `RECOVER_REQUEST_SUBTITLE` ("Sólo llega si ya te dieron acceso a RATEOS"), con test unitario y control en navegador (AUTH-02).
- `verifyRecoveryCode`: la puerta exige sesión con `access_token` y usuario válido; el servicio, además, nunca queda autenticado ni en modo recuperación sin usuario. Tests de respuestas incompletas.
- La espera de 60 s es sólo de UX (vive en la pantalla; recargar la saltea). Los límites efectivos son los de Supabase; su 429 se informa. Documentado así.
- Corrección propia: en Supabase el enlace y el código de un correo son la misma credencial (`recovery_token`). El mensaje de enlace inválido sugería usar el código de ese mismo correo, que ya no sirve: ahora pide un correo nuevo y explica que en otro dispositivo se escribe el código sin tocar el enlace. El simulado lo modela (abrir el enlace usa el código; un correo nuevo anula el anterior) y AUTH-05 lo controla. Variante `recovery-solo-codigo.html` para casillas con escáner. (En R1 se dijo que la pantalla del código era sólo sin sesión: no es así, `#/recuperar-contrasena` es pública; R2 lo corrige en las docs.)
- Alcance: la confirmación de email no se usa en la beta cerrada (Auto Confirm) y su entrega real no está probada; ninguna prueba simulada prueba entrega real. Brevo: el criterio es el seguimiento de clics, no el proveedor.

#### 10. Ronda R2 — registro público (decisión del dueño, 2026-10-20)
El dueño revocó la beta por invitación: quiere **registro público y autoservicio** (cualquiera crea su cuenta, confirma su email y tiene su propia empresa). Volvió a encender "Allow new users to sign up" (declaración del dueño, sin lectura independiente).
- `FEATURES.publicSignup = true`. Formulario de siempre (nombre, empresa, email, contraseña) con confirmación obligatoria por enlace PKCE (`?auth=confirm`).
- **Sin enumeración:** el registro responde igual a un email nuevo, ya registrado o sin confirmar (`SIGNUP_REQUESTED_MESSAGE`); la puerta sigue traduciendo el usuario "de mentira" de Supabase a `email_taken` y el servicio lo neutraliza. HD-08 resuelto. Reenvío de la confirmación neutro (`resendConfirmation`, `auth.resend({ type: 'signup' })`), también desde el ingreso cuando la cuenta no está confirmada (sólo con la contraseña correcta).
- **Excepción documentada:** si el correo de confirmación no sale (SMTP por defecto o roto), GoTrue no crea la cuenta; la app lo dice (`SIGNUP_MAIL_FAILED_MESSAGE`). Revela que el email era nuevo sólo mientras el envío está roto; callar dejaría a la persona esperando (el origen de HD-03).
- Antiabuso: límites de Supabase Auth (correos por hora = tope de registros por hora con SMTP propio) y confirmación obligatoria; CAPTCHA queda como decisión aparte (suma un tercero a la CSP). Las cuentas sin confirmar quedan con su empresa vacía (nadie entra); limpieza manual si se acumulan.
- Gate: SEC-18 (sin enumeración en registro, reenvío y recuperación); HD-03 pasa a "registro público con confirmación y SMTP propio"; `scripts/check-auth-perimeter.mjs` sigue a `FEATURES.publicSignup`.
- Tests: unitarios del registro público (`auth-email.test.js`), perímetro, gate y navegador (AUTH-01 y AUTH-10 a AUTH-14). Docs: AGENTS.md §13, README, AUTH_ARCHITECTURE, BETA_PERIMETER §2, BETA_SECURITY, plantillas.
- Pendiente del dueño: SMTP propio + plantillas (sin eso nadie de afuera confirma su cuenta), verificar la configuración con el script, pruebas reales R1–R14 y la prueba A/B real.

#### 11. Ronda R3 — revisión independiente sobre `93448e2`
- **Hallazgo:** `resendConfirmation` devolvía "Pedido enviado" para cualquier falla que no fuera la red o el límite, incluido el rechazo del SMTP por defecto (`emailNotAuthorized`) y `unknown`: decía que se envió cuando se sabía que no (el incidente de HD-03).
- **Corrección:** con cualquier falla del proveedor el reenvío dice `CONFIRMATION_RESEND_FAILED_MESSAGE` ("No pudimos enviar el correo de confirmación…"), el mismo mensaje para toda falla de envío, sin el email ni el código del error; aviso técnico en el logger sin datos personales. Un email rechazado por formato se marca en el campo.
- **Enumeración:** Supabase (`/resend`) responde 200 sin enviar si no hay cuenta o ya está confirmada; sólo intenta enviar con una cuenta sin confirmar. Por eso la respuesta sigue siendo idéntica para un email sin cuenta y uno confirmado, y sólo una cuenta sin confirmar puede recibir el error, **mientras el envío esté roto**: misma excepción documentada que el registro (AGENTS.md §13, SEC-18 la verifica con su límite). Con el SMTP propio funcionando no aparece.
- **"¿Olvidaste tu contraseña?" sin sesión no cambia** (decisión de R1, aceptada en la revisión): su respuesta no promete el correo y explica qué hacer si no llega; informar el rechazo ahí revelaría que el email tiene una cuenta (cualquiera, confirmada o no).
- Tests: 4 unitarios nuevos (fallan sin la corrección), SEC-18 ampliado, AUTH-15 en el navegador (escritorio y celular).

### PLAN-2026-019 — ECO-02: riesgo a la vista (NO CONFIABLE fuera del Resultado y regla de "Enviada")

- Estado: En curso — rama `claude/eco-02-riesgo-a-la-vista` (desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: UX y presentación de la completitud (sin cambios de fórmulas)
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (autorizó implementar en ramas y PRs el 2026-10-20)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
ECO-01 marca "RESULTADO NO CONFIABLE" **dentro** del Resultado. La auditoría DESIGN-01 (UX-P1-1, UX-P1-2 y UX-P1-3, verificados en código y capturas) mostró que **fuera** del Resultado no se ve: la lista, Inicio, "Continuar cotización" y Escenarios muestran la tarifa y un margen de color normal (un doble abono figuraba con "88,72 %" en verde); dentro del Resultado, costo, tarifa piso y tarifa se ven normales; y "Marcar como enviada al cliente" sigue activo, de un clic, también desde la lista y el editor. Inicio, además, promedia ese margen y suma esa facturación.

#### 2. Objetivo y no-objetivos
- Objetivo: que un resultado NO CONFIABLE se vea en cada lugar donde aparece la cotización (listas, Inicio, Escenarios, Resultado y PDF) y que no se pueda marcar como enviada sin resolverlo, con la misma regla en todos los caminos.
- Fuera de alcance (PRs siguientes): el redondeo comercial (VAL-01-F1), H-04, H-08 y el doble conteo de operadores (VAL-01-F2), formularios que pierden cambios, RES-02 y DESIGN-01. Sin cambios de Auth, Supabase, esquema ni datos.

#### 3. Impacto en fórmulas
- **Ninguna fórmula cambia** y ningún indicador del motor (`kpis`) cambia: `summarizeQuote` sólo suma `unreliable`, `unreliableLabels` y `criticalLabels` (proyección de la completitud ya calculada). Golden y candado sin cambios.
- **Agregados de Inicio (`indicatorsFor`):** una cotización activa NO CONFIABLE cuenta como activa y en riesgo, pero no entra en el valor cotizado, el margen promedio ni "bajo piso" (`unreliableCount` dice cuántas quedan afuera). Es una regla de presentación de Inicio, documentada en CALCULATION_RULES §dashboard.

#### 4. Impacto en datos
Esquema 10 sin cambios; ninguna migración; ningún campo nuevo guardado. El estado de una cotización ya enviada no se toca: si hoy es NO CONFIABLE, el Resultado lo dice ("figura como enviada, pero…").

#### 5. Diseño
- Dominio `js/domain/quote-risk.js`: `riskSummary(completeness)`, `impliesSending(from, to)` (Enviada, o Ganada sin haber estado enviada) y `sendCheck(summary)` (NO CONFIABLE o sin calcular → no; críticos → confirmar; si no → sí).
- UI: `js/ui/send-guard.js` (textos y diálogos), lista y columnas compartidas (`quotes-list.js`), Inicio (`dashboard.js`), Resultado (cuatro números, acciones y encabezado del PDF), Escenarios (aviso arriba del análisis) y el estado en el editor (`kit.select` con `guard`). Sin fórmulas en la UI.
- Servicio (R1): `QuoteService.saveQuote` aplica la misma regla contra el estado GUARDADO y rechaza con `send_blocked` (sin guardar nada); el editor vuelve al estado guardado a la vista y guarda el resto; la lista dice el motivo. El respaldo importado (`importBackup`) no pasa por esa regla.
- Alcance: salvaguarda de la app en el navegador (pantallas y servicio), no de la base ni del servidor: el servidor guarda el espacio de trabajo completo y no ejecuta el motor. Una pestaña con una versión anterior, un respaldo o una escritura directa con la propia cuenta pueden dejar una NO CONFIABLE como Enviada; por eso la marca no depende del estado (listas, Resultado y PDF).

#### 6. Pasos
- [x] 1. Regla de dominio y resumen del motor (sin cambiar `kpis`).
- [x] 2. Listas, Inicio, Escenarios, Resultado, PDF y editor.
- [x] 3. Tests unitarios y E2E (los controles nuevos fallan en `main`: 14 en escritorio).
- [x] 4. PR sin merge (#29), evidencia en RATEOS-AUDIT (`tasks/ECO-02/`) y revisión independiente (comentario, no aprobación).
- [x] 5. R1: la regla también en `QuoteService.saveQuote`, alcance documentado (no es del servidor), Perdida → Ganada explícito, verificación combinada con HD-03 (PR #28).

#### 7. Tests
`tests/domain/quote-risk.test.js` (regla, `summarizeQuote` con los mismos `kpis` que el motor, textos), `tests/services/quote-service.test.js` (agregados de Inicio y, desde R1, la regla en `saveQuote`: bloquea Borrador/Archivada/nueva → Enviada o Ganada con NO CONFIABLE o sin calcular; deja pasar Perdida → Ganada, ediciones de una ya enviada, Perdida/Archivada, críticos y el respaldo) y el bloque ECO-02 de `tests/lab/e2e/ui-lab.mjs` (escritorio y celular; desde R1, Perdida → Ganada y el aviso del Resultado).

#### 8. Riesgos y mitigación
- Una cotización enviada antes de este cambio que hoy es NO CONFIABLE no cambia de estado: se avisa en el Resultado y se marca en las listas.
- Los montos de Inicio bajan si hay cotizaciones NO CONFIABLES activas: es el objetivo, y se aclara en los rótulos y en "Ver cálculo".

#### 9. Rollback
Revert del PR. No hay datos nuevos que limpiar.

#### 10. Review multidisciplinario
- Economía: ninguna fórmula ni indicador del motor cambia; Inicio deja de promediar y sumar números que no son reales.
- QA: rojo en `main`, verde en la rama; golden y Test Lab sin cambios.
- Seguridad: sin cambios de esquema, Auth ni base; sin datos reales.
- UX: la marca "No confiable" está en cada fila, número y PDF; "Enviada" bloqueada dice por qué, a la vista, con "Ver qué falta".

#### Bitácora
- 2026-10-20: el dueño autorizó implementar en ramas y PRs (sin merge ni deploy) y pidió empezar por las correcciones críticas. Base `main` `d6540b7`.
- 2026-10-20: PR #29 publicado (`5d19758`). Revisión independiente (comentario, sin aprobar): dirección adecuada para beta; pide documentar que la regla es de la UX y no de la persistencia/servidor y valorar una guarda de servicio, verificar el conjunto con HD-03 y dejar explícito Perdida → Ganada. R1: guarda en `saveQuote` (la opción más segura; no rompe el respaldo ni los estados históricos), alcance y Perdida → Ganada en CALCULATION_RULES, verificación combinada local.

### PLAN-2026-020 — ECO-03: redondeo comercial proporcional a la tarifa (VAL-01-F1)

- Estado: En curso — rama `claude/eco-03-redondeo` (desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: **cambio de regla de negocio** (redondeo de la tarifa sugerida, AGENTS.md §6) y UX (margen objetivo y real a la vista)
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (pidió el 2026-10-20 un redondeo proporcional, configurable y, por defecto, a no más de 1 % sobre la objetivo, conservando las configuraciones explícitas y las cotizaciones existentes, y documentar la ambigüedad de compatibilidad antes de cambiar la regla)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
VAL-01-F1 (P1): el redondeo comercial por defecto es un **múltiplo fijo de $ 1.000** (`defaultSettings().roundingStep`) para cualquier unidad, y cada cotización nueva lo copia (`pricing.roundingStep`). Con $/día ($ 2.408.340 → $ 2.409.000) no se nota; en las unidades de valor bajo la "tarifa sugerida" queda muy arriba del precio objetivo y la pantalla igual dice "Para ganar el 10 % sobre el precio":

| Unidad | Precio objetivo | Sugerida con $ 1.000 | Sobreprecio | Margen con la sugerida |
|---|---:|---:|---:|---:|
| $/ton-km | 277,80 | 1.000 | +260 % | 71,4 % |
| $/kg | 609,87 | 1.000 | +64 % | 43,2 % |
| $/km | 3.003,52 | 4.000 | +33 % | 31,2 % |
| $/t | 12.018,31 | 13.000 | +8,2 % | 16,4 % |
| $/m³ | 10.235,19 | 11.000 | +7,5 % | 15,9 % |

#### 2. Compatibilidad: la ambigüedad (documentada ANTES de cambiar la regla)
- **Dónde vive el redondeo:** en la empresa (`settings.roundingStep`, para las cotizaciones nuevas) y en cada cotización (`quote.pricing.roundingStep`, copiado al crearla y editable en "El precio").
- **La ambigüedad:** un `roundingStep: 1000` guardado no dice si alguien lo eligió o si es el de fábrica. `defaultSettings()` lo trae, cada cotización nueva lo copia y nada marca que se haya elegido.
- **La única señal:** `settings.illustrative`. Es `true` mientras la empresa no confirmó sus parámetros ("Son los valores de mi empresa"). Con `illustrative: true` y $ 1.000, es el valor de fábrica sin confirmar. Con los parámetros confirmados, $ 1.000 pudo elegirse o aceptarse al confirmar: no se puede saber.
- **Interpretación de este PR (la más conservadora):**
  1. **Cotizaciones existentes: sin cambios.** Sin `roundingMode` rige el múltiplo fijo guardado (la regla de siempre), con los mismos números. Una cotización pasa a automático sólo si alguien lo elige.
  2. **Empresas con parámetros confirmados**, o con un paso distinto de $ 1.000: las cotizaciones nuevas conservan su múltiplo.
  3. **Empresas con los parámetros de fábrica sin confirmar** (`illustrative: true`) y $ 1.000: las cotizaciones nuevas usan el automático, que es el nuevo valor de fábrica. Las existentes no cambian.
  4. **Empresas nuevas:** automático, hasta 1 %.
- **Lo que no se puede saber:** si una empresa con parámetros confirmados y $ 1.000 eligió ese valor. Se conserva, y se avisa: el margen objetivo y el real quedan a la vista, y si el redondeo sube la tarifa más de 1 % aparece "la sugerida quedó X % arriba de tu precio objetivo" con [Usar redondeo automático].
- **Plantillas:** una plantilla guardada antes de ECO-03 trae `pricing.roundingStep` sin `roundingMode`: se conserva como múltiplo fijo (es una configuración guardada), salvo el $ 1.000 de fábrica en una plantilla ILUSTRATIVA (las de la demo local), que sigue la regla de la empresa, igual que la configuración de fábrica (`isFactoryLegacyStep`). Las plantillas nuevas guardan su regla.
- **Configuración:** `SettingsService.get` completa lo que falta con los valores de fábrica; desde ECO-03 no completa `roundingMode` en una configuración guardada antes (sería pasarla a automático sin que nadie lo elija, y Configuración lo guardaría al tocar cualquier otro parámetro).
- **HUMAN DECISION REQUIRED (no bloquea):**
  1. ¿mantener el punto 2 para las empresas con $ 1.000 confirmado, o pasarlas a automático para sus cotizaciones nuevas? Cambiarlo es una regla en `settingsRounding()` (`js/domain/rounding.js`), sin migración.
  2. **Tope por defecto del automático: 1 % (lo pedido) o menos.** Con 1 %, las tarifas grandes se redondean a cifras más redondas que antes: $/día de 2.408.340 → 2.410.000 (+0,07 %, antes 2.409.000, +0,03 %); un llamado de 1.761.345 → 1.770.000 (+0,49 %, antes +0,04 %). Siempre ≤ 1 %. Con 0,1 % las tarifas de $ 1 M a $ 10 M quedan como antes (múltiplo de 1.000) y las de valor bajo igual se corrigen (277,80 → 277,80, sin redondeo; 3.003,52 → 3.004). Es un valor de fábrica: cada empresa lo cambia en Configuración.
- **Sin migración ni cambio de esquema** (sigue en 10): los campos nuevos (`roundingMode`, `roundingMaxPct`) son opcionales, y no tenerlos es la regla de siempre. El validador del esquema no rechaza campos nuevos dentro de `pricing` ni de la configuración. `saveSettings` mezcla, así que una pestaña abierta con 0.8.1 no los borra.
- **Pestañas con 0.8.1 abiertas:** ignoran `roundingMode` y calculan con `roundingStep`. Por eso todo lo que queda en automático guarda `roundingStep: 0` (cotizaciones y empresas nuevas, y las que alguien pasa a automático desde "El precio", el aviso del Resultado o Configuración): una versión anterior, o un revert, las muestra sin redondeo, nunca infladas. Al volver a "Múltiplo fijo" el múltiplo se carga de nuevo.

#### 3. Regla nueva
- **Automático (`roundingMode: 'auto'`):** la tarifa objetivo se redondea **hacia arriba** al múltiplo de 1, 10, 100, 1.000… más grande que **no la suba más de `roundingMaxPct`** (1 % por defecto, configurable de 0 a 10). Con una objetivo menor a $ 100 (el 1 % no llega a $ 1) no hay redondeo.
  - Ejemplos: 277,80 → 278; 3.003,52 → 3.010; 12.018,31 → 12.100; 2.408.340 → 2.410.000.
  - Nunca baja el margen y nunca sube más del tope.
- **Múltiplo fijo (`roundingMode: 'step'`, o sin `roundingMode`):** `roundingStep`, como siempre (0 = sin redondeo).
- **Productos:** sin cambios. Tienen su propio redondeo, que por defecto es 0.

#### 4. Impacto en fórmulas
- **Cotizaciones existentes y plantillas:** sin cambios. Golden y candado sin cambios, y A/B contra `main` en las cotizaciones sintéticas del Test Lab: mismos números.
- **Cotizaciones nuevas en automático:** la sugerida cambia (más cerca de la objetivo) y, con ella, el margen, el equilibrio y los indicadores, cuando la tarifa comercial es la sugerida.
- **Indicadores nuevos** (sin tocar los existentes):
  - `roundingMode`, `roundingStep` (el paso que se aplicó) y `roundingMaxPct`;
  - `suggestedRoundUpPct` (cuánto sube la sugerida sobre la objetivo);
  - `suggestedMarginPct` (el margen con la sugerida);
  - `roundingExceedsLimit` (múltiplo fijo que sube más de 1 %).

#### 5. UX: margen objetivo y real siempre a la vista
- **Resultado y PDF:**
  - la sugerida dice "Objetivo: 10 % · con esta tarifa: 10,06 %" y el precio objetivo exacto;
  - el margen dice siempre su objetivo;
  - con un múltiplo fijo que sube más de 1 %, aviso arriba con [Usar redondeo automático].
- **"El precio" y el resumen en vivo:** el mismo par (objetivo y real) y el control del redondeo: Automático (hasta X %) / Múltiplo fijo ($).
- **Configuración:** el mismo control para las cotizaciones nuevas. Con un múltiplo fijo de $ 1.000 se avisa que en $/ton-km, $/kg o $/km puede subir mucho.

#### 6. Pasos
- [x] 1. Documentar la ambigüedad y la interpretación (este plan, antes de cambiar la regla) y fijar con tests que lo guardado no cambia.
- [x] 2. Dominio (`js/domain/rounding.js`) y motor (indicadores nuevos).
- [x] 3. Fábrica: empresas y cotizaciones nuevas en automático; interpretación de lo guardado (empresa y plantillas).
- [x] 4. UI: Resultado, PDF, "El precio", resumen en vivo y Configuración.
- [x] 5. Tests: dominio, motor en las 18 unidades con 0/1/10/1.000 y automático, compatibilidad, vuelta atrás, oráculo del Test Lab (implementación propia del automático), E2E-21 y bloque ECO-03 en el navegador.
- [ ] 6. PR sin merge y evidencia en RATEOS-AUDIT (`tasks/ECO-03/`: A/B contra `main` y capturas antes/después).

#### 7. Rollback
Revert del PR. Las cotizaciones creadas en automático después del deploy guardan `roundingStep: 0`: con el revert se calculan sin redondeo (nunca infladas).

#### Bitácora
- 2026-10-20: Code Review (skill, nivel medio) sobre el cambio: 10 observaciones, todas atendidas antes de publicar. La más importante: `SettingsService.get` completaba `roundingMode: 'auto'` de fábrica en una configuración guardada antes, y Configuración la habría guardado como automático. También: pasar a automático deja el múltiplo en 0, plantillas ILUSTRATIVAS con la regla de fábrica, texto con tope 0, una evaluación menos con tarifa forzada, JSDoc, lógica muerta y constantes.
- 2026-10-20: el dueño pidió el redondeo proporcional (configurable, por defecto a no más de 1 % sobre la objetivo), margen objetivo y real siempre a la vista, conservar las configuraciones explícitas y las cotizaciones existentes, y documentar la ambigüedad de compatibilidad antes de cambiar la regla. La revisión independiente de ECO-02 pidió priorizar `roundingStep` explícito vs. de fábrica, muestras con 0/1/10/1.000, margen real/objetivo y las 18 unidades. Base `main` `d6540b7`. Primero este plan y los tests que fijan lo guardado; después el cambio de regla.
### PLAN-2026-021 — ECO-04: abono con más días que disponibles (H-04), vehículo de apoyo sin costo de tenerlo (H-08) y operador contado dos veces (VAL-01-F2)

- Estado: En curso — rama `claude/eco-04-abono-apoyo-operador` (desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: completitud (avisos y "RESULTADO NO CONFIABLE") y UX; **ninguna fórmula cambia**
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (pidió el 2026-10-20 "soluciones verificables para H-04, H-08 y el doble conteo del operador"; la revisión independiente de VAL-01 pidió para H-04 "advertencia crítica de resultado no confiable hasta que el usuario resuelva el período", para H-08 "corrección o aviso contextual comprobado" y para F2 "advertir y pedir confirmación de alcance", porque no toda superposición es doble conteo)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
En los tres casos el motor calcula bien lo que se carga. El problema es que la carga lleva a un resultado equivocado sin aviso, o con un aviso falso:
- **H-04 (AUD-T1, P1):**
  - **Caso:** tarifa en $/mes (abono) con más días trabajados que disponibles (26 con 22, porque la ayuda sugiere "22 si sólo trabajás días hábiles").
  - **Qué hace el motor:** lo toma como "más de un mes de trabajo". Multiplica los fijos por 26/22 y factura **1,18 abonos**, pero un abono mensual no se cobra 1,18 veces.
  - **Efecto:** margen 15,02 % en vez de 12,26 %, y "trabajando más se gana más".
  - **Aviso actual:** dice que "los cálculos reemplazan los valores inválidos por 0", y no es cierto.
- **H-08 (AUD-T1, P1):**
  - **Caso:** una camioneta propia cargada sólo como vehículo de apoyo.
  - **Qué hace el motor:** suma combustible y desgaste por km, pero no su costo de tenerlo (amortización, seguro, patente).
  - **Efecto:** costo −5,87 %, sugerida −5,9 % y margen real 10 % en vez de 15 %, sin ningún aviso (completitud 98 %).
- **VAL-01-F2 (P2):**
  - **Caso:** el externo trae operador y el mismo operador está en Personal sin estar asignado al equipo.
  - **Efecto:** se paga dos veces sin aviso. En E12, costo +13,5 % y sugerida +9,1 %.
  - **Aviso actual:** sólo aparece si el puesto está asignado al equipo.

#### 2. Decisiones (la opción más segura y sencilla; ninguna fórmula cambia)
- **H-04:**
  - **Regla:** con la tarifa en $/mes y días trabajados mayores que los disponibles, el resultado queda **NO CONFIABLE** (pendiente crítico `month_days_overflow`) hasta corregir los días.
  - **Cómo se corrige:** subir los disponibles (30 si se trabaja todo el mes) o bajar los trabajados.
  - **Sin confirmación:** un abono mensual no se factura más de una vez por mes.
  - **Cifras:** no cambian. Sólo dejan de presentarse como confiables.
  - **Otras unidades** (día, hora, cantidad, evento): "más días que disponibles" sigue siendo "trabajo de más de un mes" (CALCULATION_RULES §1), es decir, fijos y cargos mensuales × días ÷ disponibles. El aviso pasa a decir eso.
  - **Resultado:** los avisos que no reemplazan nada ya no se presentan como "los cálculos reemplazan los valores inválidos por 0".
- **H-08:**
  - **Pregunta:** cada vehículo de apoyo dice dónde está su **costo de tenerlo**:
    - en una línea de Equipos (la camioneta cargada también como equipo, sin horas si sólo traslada);
    - o ya en el costo por km (un tercero que cobra por km, o el desgaste con la amortización, el seguro y la patente incluidos).
  - **Sin respuesta:** pendiente **crítico** `vehicle_ownership_costs`. No vuelve NO CONFIABLE el resultado, porque el costo por km puede estar bien: se pide confirmar antes de mandarla.
  - **Si se borra la línea de Equipos elegida:** se vuelve a preguntar.
  - **Con el vehículo ligado a Equipos:**
    - la ayuda del desgaste dice que no repita la amortización;
    - si esa línea "va por sus propios medios", el control de duplicados lo marca, porque los km se contarían dos veces.
- **VAL-01-F2:**
  - **Cuándo pregunta:** un externo con operador incluido, sin operador asignado, y puestos de Personal (con posiciones) que no operan ningún equipo. El control de duplicados (`duplicates`, para revisar) pregunta si alguno es ese operador.
  - **Cómo se confirma:** en Equipos, "Ningún puesto de Personal lo opera" (`operatorBySupplier`). La confirmación queda ligada a esos puestos (id y nombre): si se agrega otro o se renombra, vuelve a preguntar.
  - **Si se asigna el puesto como operador:** lleva al aviso de siempre ("Operador posiblemente duplicado").

#### 3. Impacto en fórmulas
- **Fórmulas:** ninguna cambia.
- **Golden y candado:** golden 39/39 sin tocar y candado sin cambios.
- **A/B contra `main`:** las mismas cifras en el corpus sintético.
- **Qué cambia:** la completitud (pendientes nuevos, que aparecen sólo cuando se disparan) y los textos.

#### 4. Impacto en datos
- **Esquema:** 10, sin cambios ni migración.
- **Campos opcionales nuevos:**
  - `logistics.vehicles[].ownershipCostsIn`: el id de la línea de Equipos con su costo de tenerlo, o `'per_km'`;
  - `equipment[].operatorBySupplier`: la confirmación de F2 (`{ labor: [{ id, role }] }`).
- **Sin ellos:** todo calcula igual.
- **Pestaña con la versión anterior:** los ignora; calcula igual y no avisa, como hoy.
- **Plantillas:** al crear una cotización desde una plantilla se remapean, como el resto de las referencias entre líneas.
- **"Actualizar desde Recursos":** conserva la confirmación de F2, que es de la cotización, como el operador asignado.

#### 5. Pasos
- [x] 1. Este plan, antes del código.
- [x] 2. Tests que reproducen H-04, H-08 y F2 (`tests/engines/eco-04.test.js`: 10 de 16 fallan en `main`; los demás fijan lo que no cambia) y los de las correcciones del Code Review.
- [x] 3. Completitud (tres reglas), el aviso de días (en el motor, con sus días) y el Resultado.
- [x] 4. UI: el costo de tenerlo en cada vehículo de apoyo y la confirmación del operador en Equipos (cada línea).
- [x] 5. Fábrica (plantillas) y Recursos (actualizar).
- [x] 6. E2E (E2E-22 a E2E-24, escritorio y celular), A/B contra `main` y docs.
- [x] 7. PR sin merge (#31) y evidencia en RATEOS-AUDIT (`tasks/ECO-04/`).

#### 6. HUMAN DECISION REQUIRED (no bloquean)
1. **"Más días que disponibles" en las otras unidades** (D-9, VAL-01-F3, C-E3-10): hoy es trabajo de más de un mes, con el aviso corregido. ¿Pedir confirmación también ahí?
2. **Vehículo de apoyo propio:** este PR lo resuelve ligándolo a una línea de Equipos. La alternativa es cargar su costo de tenerlo en el mismo vehículo, con más campos y un cálculo nuevo.
3. **Severidad de la pregunta del vehículo de apoyo:**
   - **Hoy:** es **crítica**, porque H-08 es P1.
   - **Alcance:** en el corpus sintético aparece en todas las cotizaciones con vehículos de apoyo (626 de 2.196) hasta que se responde una vez por vehículo.
   - **Alternativa:** "para revisar", que no pide confirmar antes de mandarla.

#### 7. Rollback
Revert del PR. Los campos nuevos quedan en los datos y la versión anterior los ignora.

#### Bitácora
- 2026-10-20: base `main` `d6540b7` (v0.8.1, esquema 10). Primero este plan; después los tests que reproducen los tres casos y la implementación.
- 2026-10-20: F2 se acotó a los puestos que **suenan a operador o chofer**.
  - **Por qué:** preguntar por cualquier puesto libre llenaba de preguntas el transporte normal (un transportista con chofer más un coordinador propio). Los casos de la auditoría (VAL-01 E12, AUD-T1 C-E2-07) son choferes.
  - **Qué se perdió:** nada del golden ni del Test Lab.
- 2026-10-20: Code Review (skill, nivel medio), 10 observaciones, todas atendidas:
  - el aviso de días pasó al motor, con los días que usa (tope de 31, y no en unidades por cantidad);
  - cada externo pregunta en Equipos (antes, sólo el primero, y un operador asignado en otra línea las tapaba);
  - "asignado" igual que en el motor (un id viejo no cuenta);
  - la guía de H-08 dice "No requiere movilización";
  - quitar un equipo limpia el vehículo ligado;
  - el texto de los datos inválidos;
  - más nombres de operador ("Hidrogruista", "Operario de grúa");
  - un solo formateador y un solo nombre de puesto;
  - sin re-export.
- 2026-10-20: A/B contra `main` (2.196 cotizaciones: lab, generadas, línea base, demo, fixtures, AUD-T1, plantillas y las 87 de VAL-01):
  - **cifras:** 0 diferencias;
  - **completitud:** ningún cambio fuera de los tres pendientes;
  - `month_days_overflow` sólo en VAL-01 E24 (el caso H-04);
  - `vehicle_ownership_costs` en las 626 con vehículos de apoyo;
  - la pregunta de F2 en 310 (VAL-01 E12, el caso F2, y las generadas con "Operador" y un externo con operador);
  - la demo, las plantillas, el golden y los fixtures no cambian.
- 2026-10-20: las capturas a 390 px mostraron la pregunta del operador en una columna angosta, con el botón al costado. Ahora el botón baja debajo del texto cuando no entran juntos (`css/quote.css`); en escritorio no cambia.

### PLAN-2026-022 — UX-01: formularios que pierden cambios sin avisar y valores que se corrigen en silencio

- Estado: En curso — rama `claude/ux-01-no-perder-cambios` (desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: UX (formularios y avisos); **ninguna fórmula cambia** y no hay datos nuevos
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (pidió el 2026-10-20 "resolver formularios que pierden cambios sin advertir y validaciones que corrigen valores silenciosamente"; la auditoría DESIGN-01 los detalla en D1b, con RES-02-G4)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
Casos verificados en el código de `main`:
- **Diálogos con formulario** (`openDialog` en `js/ui/components.js`):
  - un clic afuera o Esc los cierran **sin preguntar**, con todo lo cargado (RES-02-G4);
  - afecta a la ficha de cada recurso (Personal, Equipos, Materiales, Externos, Convenios…: `openResourceForm` en `js/ui/views/library.js`), a "Renombrar plantilla" (`services.js`) y a "Guardar como plantilla" (editor de cotizaciones).
- **Un valor inválido vuelve al anterior sin que se vea** (`numberField` en `js/ui/components.js`):
  - al confirmar un número inválido, el campo vuelve al valor anterior y lo dice debajo del campo;
  - si eso pasa porque se sale de la pantalla (otro paso, el menú, Atrás), el aviso queda en la vista que se destruye: el valor escrito no se guardó y nadie se entera;
  - pasa en el editor de cotizaciones (`dispose` → `revertInvalidFields`), en el de productos y en Configuración. El nombre de la empresa borrado hace lo mismo.
- **Configuración guarda cada sección sólo si toda la sección es válida:** con un campo inválido enfocado, si se sale sin que el campo pierda el foco (Atrás, un atajo), no se guarda nada de esa sección, ni siquiera los cambios válidos.
- **"Mi cuenta":** el nombre se guarda con "Guardar nombre"; si se sale sin tocarlo, el cambio se pierde sin aviso.
- **Los avisos de error desaparecen a los 3,5 s** y no se pueden cerrar: un "No se pudo guardar" puede pasar sin que se lea.

#### 2. Decisiones (la opción más segura y sencilla)
- **Diálogos con formulario:**
  - un clic en el fondo no los cierra;
  - Esc, la X o "Cancelar" con cambios sin guardar preguntan "¿Descartar los cambios?", con [Seguir editando] y [Descartar];
  - sin cambios, cierran como siempre; después de "Guardar", sin preguntar;
  - Esc se atiende antes de que el navegador procese el cierre (Chrome no deja retener con `cancel` un segundo Esc seguido); si igual se cierra (otro pedido de cierre), se vuelve a abrir con la pregunta encima;
  - "cambios" quiere decir lo que se guardaría distinto de lo que se abrió (normalizado como al guardar: sin contar los campos vacíos, y marcar y desmarcar una casilla no cuenta) o un campo con un valor inválido escrito.
- **Valores que vuelven al anterior:**
  - no se frena la navegación: el router no puede cancelar un cambio de dirección de forma confiable, y los editores guardan solos;
  - si el campo ya no está en pantalla cuando vuelve al valor anterior, aparece un aviso que queda hasta cerrarlo, con la pantalla, el campo, lo que se escribió, por qué no se guardó y qué valor quedó;
  - si el campo sigue en pantalla, alcanza con el aviso debajo del campo, como hoy;
  - en un diálogo que se cierra sin guardar (Cancelar, Esc, la X, Descartar) no se avisa: se descartó a propósito. Si se guardó, sí;
  - los campos de mes (`periodField`) hacen lo mismo que los números: en navegadores sin selector de mes (se ven como texto), un texto inválido queda marcado mientras se escribe y, al confirmarlo, vuelve al último mes guardado con su aviso.
- **Configuración:**
  - al salir (y al cerrar la pestaña), primero vuelven al valor anterior los campos inválidos, con su aviso, y después se guarda el resto de la sección;
  - el guardado automático recuerda que hay cambios sin guardar aunque en ese momento la sección esté inválida: al salir se guardan si ya se puede; si ni así (p. ej. impuestos que suman 100 % o más), un aviso lo dice;
  - si la misma pantalla se redibuja sin navegar (después de recargar la versión de la nube o de importar), no se revierte ni se guarda lo que quedó en pantalla: esos datos ya cambiaron.
- **"Mi cuenta":** al salir con un nombre escrito y sin guardar, aviso con el nombre que no se guardó (no, si se está guardando).
- **Avisos:**
  - los de error quedan hasta cerrarlos;
  - todos tienen "Cerrar";
  - como máximo 4 a la vez: se van primero los que igual se iban solos; uno igual a otro que ya está a la vista no se repite;
  - el plazo de 1,5 s para decidir si el campo se fue con la pantalla queda así: alcanza para el cambio de vista (que es inmediato) y un diálogo que se redibuja ya está cubierto por la regla de arriba.

#### 3. Impacto en fórmulas
Ninguno: no se toca ningún motor. Golden y candado sin cambios.

#### 4. Impacto en datos
- Sin campos nuevos ni migraciones (esquema 10).
- Lo único que cambia en lo que se guarda: al salir de Configuración se guardan los cambios válidos de una sección aunque otro campo estuviera inválido, o aunque la sección haya estado inválida un momento (antes se perdían).

#### 5. Pasos
- [x] 1. Este plan, antes del código.
- [x] 2. Tests:
  - unitarios de las funciones puras (huella del borrador y texto del aviso);
  - E2E que reproducen cada caso y fallan en `main`.
- [x] 3. `openDialog` con `isDirty`; recursos y plantillas.
- [x] 4. Aviso del valor que volvió al anterior fuera de pantalla; Configuración (revertir y guardar) y "Mi cuenta".
- [x] 5. Avisos de error que quedan hasta cerrarlos.
- [x] 5b. Revisión de código propia (10 observaciones): 9 corregidas con su control E2E (ver Bitácora); el plazo de 1,5 s queda como está.
- [ ] 6. Validación completa, capturas antes y después, PR sin merge y evidencia en RATEOS-AUDIT (`tasks/UX-01/`).

#### 6. Fuera de alcance (documentado)
- El resto de D1b de DESIGN-01 (no pierde datos; va en DESIGN-02):
  - el monto con separadores y su eco en Recursos;
  - `aria-required` y las ayudas asociadas con `aria-describedby`.
- "1.500" se sigue leyendo como mil quinientos (punto de miles, formato argentino). El editor ya muestra el eco del monto.
- "Se guardó la plantilla", con su enlace, sigue durando 3,5 s (ahora se puede cerrar). No pierde datos.

#### 7. Rollback
Revert del PR. No deja datos nuevos.

#### Bitácora
- 2026-10-20: base `main` `d6540b7` (v0.8.1, esquema 10). Primero este plan; después los tests que reproducen los casos y la implementación.
- 2026-10-20: implementación y revisión de código propia (10 observaciones). Corregidas 9, cada una con su control E2E:
  - campo de mes (`periodField`) con texto inválido: no volvía al anterior y frenaba el guardado de su sección en Configuración;
  - al redibujar Configuración sin navegar (recargar de la nube, importar) no se revierte ni se guarda lo que quedó en pantalla;
  - un valor restaurado dentro de un diálogo que se cierra sin guardar no deja un aviso fijo; si se guardó, sí avisa;
  - "Mi cuenta": no avisa mientras el nombre se está guardando, y guarda como guardado lo que se mandó;
  - el tope de 4 avisos saca primero los que se iban solos;
  - Esc se atiende antes del cierre del navegador y la pregunta queda siempre encima (se reemplaza si ya había una);
  - `clearToasts` también frena un aviso que todavía no había entrado;
  - el motivo del aviso lo decide el campo (vacío: sin motivo), sin comparar textos;
  - la ficha de un recurso compara lo que se guardaría (normalizado como al guardar): marcar y desmarcar una casilla no es un cambio.
  - Además, al probarlo: el guardado automático de Configuración olvidaba un cambio si la sección estaba inválida justo cuando tocaba guardar. Ahora lo recuerda, lo guarda al salir si ya se puede y, si no, lo avisa.
  - Queda como está el plazo de 1,5 s del aviso (ver Decisiones).
- 2026-10-20: `ui-lab` con 28 controles UX-01 por modo: 20 fallan en `main` (388/408 en escritorio; todas las fallas son de UX-01) y pasan todos en la rama. Los 8 que pasan en `main` son de no regresión (p. ej. "sin cambios, Esc cierra sin preguntar").

### PLAN-2026-023 — RES-02 (1/2): Personal agrupado por convenio y sueldo bruto sin doble conteo

- Estado: En curso — rama `claude/res-02-personal-por-convenio` (desde `main` `d6540b7`, v0.8.1, esquema 10); PR sin merge ni deploy
- Tipo: UX y datos: un campo opcional e informativo (`peopleCount`) sin migración; **ninguna fórmula cambia**
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (20/10: "RES-02 — Implementar Recursos. Autorizo la dirección visual propuesta, con los ajustes de ChatGPT"), con el diseño de RATEOS-AUDIT `tasks/RES-02/` y la revisión de ChatGPT del Issue #4
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
Verificado en el código de `main` (detalle con `archivo:línea` en RATEOS-AUDIT `tasks/RES-02/GAP-ANALISIS.md`):
- **Recursos → Personal es una tabla sin agrupar.** La vista simple ni muestra el convenio y no hay búsqueda.
- **No hay cantidad de personas.** Un perfil se lee como una persona.
- **Doble conteo posible:** el formulario pide "Sueldo básico" y, en otra sección, "Adicionales". Si se escribe el bruto del recibo como básico y además los adicionales, se suman dos veces (+20 % de costo en el ejemplo del diseño).
- **Horas extra:** se valúan sobre el básico. Si el básico es en realidad el bruto, se sobrevalúan sin aviso.
- **RES-02-G1:** al borrar un convenio, el aviso dice que los perfiles "quedarán sin convenio asignado", pero su `agreementId` queda colgando.

#### 2. Decisiones (las del dueño y los ajustes de ChatGPT; para lo técnico, lo más seguro y sencillo)
- **Vista principal agrupada por convenio** (D-R10): "Por convenio" es la vista por defecto de Personal; "Lista" y "Detallada" siguen disponibles.
  - Un grupo por convenio de la empresa, con su nombre (los códigos de CCT no se muestran: no están confirmados, D-R5).
  - **"Fuera de convenio":** los perfiles con un convenio del tipo `fuera_convenio`.
  - **"Sin convenio indicado":** sin convenio o con uno que ya no existe. Siempre desplegado y con la salida a Configuración → Convenios.
  - Orden: los convenios con más perfiles primero (después por nombre), "Fuera de convenio" y "Sin convenio indicado" al final.
  - Grupos con `<details>`/`<summary>` (teclado), "Desplegar todo" / "Plegar todo", búsqueda y filtro por convenio que quedan en la dirección (`?q=&convenio=`).
- **Perfiles ≠ personas** (D-R3, D-R9 y ajuste 3 de ChatGPT):
  - campo opcional `peopleCount` (entero ≥ 0), **informativo**: no se copia a las cotizaciones, no entra en la huella (`SNAPSHOT_FIELDS`) y no cambia `positions` ni `peoplePerPosition`;
  - el encabezado dice "N perfiles · M personas", o "M personas en K de N perfiles" si falta el dato;
  - el monto del grupo suma costo por persona × personas sólo de los perfiles con cantidad. Si falta en alguno, se llama **"subtotal parcial"**; nunca "total del personal". Sin ninguna cantidad, no hay monto;
  - un valor guardado inválido se toma como "sin dato". **No** se agrega una regla a `validateState`: un dato informativo malo no debe bloquear toda la cuenta.
- **"Editar sueldo" a un clic** (D-R1, D-R7):
  - **bruto mensual remunerativo** (obligatorio) que se descompone: `basicMonthly` = básico (o el bruto si no se carga) y `additionalsMonthly` = bruto − básico. El doble conteo es imposible por construcción y se guardan los mismos dos campos de siempre (el motor no cambia);
  - básico mayor que el bruto: error en el campo;
  - **horas extra** (D-R2, ajuste 2 de ChatGPT, pedido del dueño "no asumir silenciosamente que el bruto completo es el básico"): si el perfil o alguna cotización que lo usa tiene horas extra y no se carga el básico, para guardar hay que **cargarlo o confirmar** "valuar las horas extra sobre el bruto completo". Sin horas extra, el diálogo dice que sin básico se valuarían sobre el bruto;
  - si el bruto cambia y el básico no, se avisa que el básico se usa para las horas extra (RATEOS no lo sube solo);
  - **mes base** obligatorio si cambió el sueldo; fuente y referencia opcionales;
  - vista previa del costo empresa por persona antes → después y "Ver cálculo"; los parámetros de cargas a la vista, ILUSTRATIVOS si lo son;
  - cuántas cotizaciones en curso o ganadas lo usan: no cambian y van a avisar "El recurso cambió" (como hoy);
  - sin historial de sueldos en el maestro (D-R7).
- **Formulario completo (el de siempre)** (ajuste 5 de ChatGPT): sigue permitiendo cargar básico y adicionales por separado, ahora con ayudas que lo dicen y la línea "Bruto mensual = básico + adicionales", y suma "Personas en este puesto".
- **RES-02-G1** (D-R11): borrar un convenio limpia el `agreementId` de los perfiles que lo usaban en la misma operación. Las cotizaciones no cambian (el convenio no está en la huella).
- **Celular** (ajuste 1 de ChatGPT): los grupos aparecen en la primera pantalla: el resumen es una línea y no tres tarjetas.

#### 3. Impacto en fórmulas
Ninguno. No se toca ningún motor; golden y candado sin cambios.

#### 4. Impacto en datos
- Campo nuevo, opcional e informativo: `laborProfiles[].peopleCount`. Sin migración ni cambio de `SCHEMA_VERSION` (no cambia costos; `validateState` no tiene lista blanca de campos). Una versión anterior lo ignora.
- "Editar sueldo" guarda `basicMonthly`, `additionalsMonthly` y la base del perfil, como el formulario de siempre.
- Borrar un convenio deja `agreementId: null` en sus perfiles.

#### 5. Pasos
- [x] 1. Este plan, antes del código.
- [x] 2. Funciones puras con tests (agrupación, conteos y subtotales; descomposición del bruto; horas extra en el perfil y en las cotizaciones) y G1 en el repositorio.
- [x] 3. Vista "Por convenio", búsqueda y filtro en la dirección, celular.
- [x] 4. "Editar sueldo" y ayudas del formulario completo.
- [x] 5. E2E (escritorio y celular) que fallan en `main`, validación completa, capturas antes y después, PR sin merge y evidencia en RATEOS-AUDIT.

#### 6. Fuera de alcance (documentado)
- Equipos agrupados por familia: segundo PR de RES-02.
- "+ Nuevo convenio…" desde el perfil y la lista de CCT con códigos (D-R5): los códigos no están confirmados.
- Sumas no remunerativas del convenio (ajuste 5 de ChatGPT): no se mezclan con EPP o seguros sin revisión profesional (D-R12).
- Escalas, vigencias, paritarias, aumentos automáticos e historial (decisión del dueño del 20/10).

#### 7. Rollback
Revert del PR. `peopleCount` queda en los datos y la versión anterior lo ignora.

#### Bitácora
- 2026-10-20: base `main` `d6540b7` (v0.8.1, esquema 10). Primero este plan; después los tests y la implementación.
- 2026-10-20: implementado.
  - Dominio: `js/domain/labor-groups.js`, con 23 tests.
  - Diálogo: `js/ui/labor-salary-dialog.js`.
  - Vista: `js/ui/views/library.js` y `css/views.css`.
  - G1: `deleteResource` del repositorio, que hereda la nube.
  - `ui-lab`: 32 controles RES-02 por modo; contra `main`, los que dependen de la vista fallan (detalle en la evidencia).
  - Decisiones técnicas:
    - el error del diálogo tiene clase propia (`salary-error`);
    - las acciones del bloque del `ui-lab` son "suaves", para que la corrida contra `main` falle control por control y no se corte;
    - en el celular, las pestañas de Recursos se compactan (chips más chicos): con una sola fila desplazable la página crecía a lo ancho.

### PLAN-2026-024 — RES-02 (2/2): Equipos agrupados por familia

- Estado: En curso — rama `claude/res-02-equipos-por-familia`, apilada sobre `claude/res-02-personal-por-convenio` (PR #33, desde `main` `d6540b7`): usa sus grupos, filtros en la dirección y estilos. PR sin merge ni deploy
- Tipo: UX; **ninguna fórmula ni dato cambia**
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (20/10: "Equipos agrupados por familias, revisando la clasificación de equipos especiales"), con el diseño de RATEOS-AUDIT `tasks/RES-02/` (DISENO.md §3, D-R8) y la revisión de ChatGPT del Issue #4 (punto 6)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
Verificado en el código (RATEOS-AUDIT `tasks/RES-02/GAP-ANALISIS.md`, R6 y R7):
- **Recursos → Equipos es una tabla** con propios, alquilados y tercerizados mezclados, sin grupos ni búsqueda.
- **Cada ficha es una unidad** (no hay cantidad en el maestro): no se ve la flota por tipo ni cuánto cuesta tenerla.
- **El catálogo tiene 29 familias en una lista plana.** El diseño ponía vactor, flushby y wireline en "Camiones"; la revisión de ChatGPT (punto 6) pidió revisarlo: para un contratista de servicios especiales eso confunde.

#### 2. Decisiones (las del dueño y los ajustes de ChatGPT; para lo técnico, lo más seguro y sencillo)
- **Vista "Por familia" de entrada.** "Lista" y "Detallada" siguen.
- **Grupos visibles:** una constante descriptiva (`js/domain/equipment-groups.js`), en orden fijo:

| Grupo | Familias del catálogo |
|---|---|
| Grúas | `crane_truck`, `crane` |
| Camiones | `truck`, `tank_truck`, `tractor` |
| Equipos de vacío y succión | `vactor`, `vacuum_truck` |
| Equipos de pozo | `flushby`, `wireline` |
| Remolques y tanques | `semitrailer`, `lowboy`, `dump_trailer`, `tank`, `frac_tank` |
| Camionetas y vehículos livianos | `pickup`, `minibus` |
| Movimiento de suelo | `backhoe`, `excavator`, `wheel_loader`, `motor_grader` |
| Equipos de apoyo | `generator`, `compressor`, `pump`, `welder`, `light_tower`, `forklift`, `telehandler`, `tools` |
| Otros / sin familia | `other` y las fichas sin familia (después de `familyIdOf`) |

- **Punto 6 de ChatGPT (equipos especiales):** vactor y camión atmosférico pasan a "Equipos de vacío y succión"; flushby y wireline, a "Equipos de pozo" (sin la palabra "intervención": en RATEOS es la activación de los servicios permanentes, D8).
  - Por qué: se cotizan como servicios especiales (con su operador y su consumo), no como transporte. Mezclados con los camiones, no se ve la flota.
  - Cada fila sigue diciendo su familia ("Vactor", "Flushby").
  - Los nombres y el reparto (D-R8) quedan para el dueño. Un test garantiza que cada familia esté en un solo grupo, así que cambiarlo es una línea.
- **Conteos:** "unidades propias" (fichas `owned`; una ficha = una unidad) y, aparte, "alquiladas o tercerizadas (no suman)".
- **Monto del grupo:** costo de **tener** las propias por mes, sin usarlas.
  - Es la Σ de la posesión de la ficha: amortización, costo de capital, seguro, patente, certificaciones, otros y mantenimiento fijo.
  - Las alquiladas y tercerizadas **nunca** suman.
  - Una propia valuada en otra moneda sin tipo de cambio no se suma (no se mezclan monedas): el monto es "Subtotal parcial" y lo dice.
  - Sin propias en el grupo, no hay monto.
- **Filas:** equipo (con familia, interno, capacidad o modelo), tenencia, "Tenerlo por mes" (con "Ver cálculo" que termina en ese número), "Usarlo" ($/h sin combustible + L/h, porque el combustible se valúa en cada cotización; o "No usa combustible"; alquilados y tercerizados: la tarifa neta), base, "Usado en" y acciones.
- **Búsqueda y filtro en la dirección** (`?q=&tenencia=`):
  - búsqueda por nombre, interno, dominio, familia, capacidad y modelo;
  - tenencia: todas, propias, o alquiladas y tercerizadas;
  - "Plegar todo" / "Desplegar todo".
- **Celular:** resumen en una línea; el primer grupo en la primera pantalla.

#### 3. Impacto en fórmulas
Ninguno. Los montos salen de la ficha del equipo (`equipmentCard`); golden y candado sin cambios.

#### 4. Impacto en datos
Ninguno: no hay campos nuevos y las familias de las fichas no cambian.

#### 5. Pasos
- [x] 1. Este plan, antes del código.
- [x] 2. Dominio con tests: cada familia en un solo grupo, agrupar, contar, monto de tenencia, filtros.
- [x] 3. Vista "Por familia", búsqueda y filtro en la dirección, traza de tenencia, celular.
- [x] 4. E2E (escritorio y celular) que fallan sin este cambio, validación completa, capturas antes y después, PR apilado sin merge y evidencia en RATEOS-AUDIT.

#### 6. Fuera de alcance (documentado)
- Cantidad en el maestro (cada ficha sigue siendo una unidad).
- Servicios externos (otra pestaña) y el catálogo de modelos.
- Cambiar el catálogo de familias o la familia de las fichas existentes.

#### 7. Rollback
Revert del PR. No deja datos.

#### Bitácora
- 2026-10-20: base `claude/res-02-personal-por-convenio` `ed43a43` (PR #33). Primero este plan; después los tests y la implementación.
- 2026-10-20: implementado.
  - Dominio: `js/domain/equipment-groups.js`, con 13 tests.
  - Vista: `js/ui/views/library.js` y `css/views.css`. Personal y Equipos comparten el grupo plegable (`resourceGroupNode`, clases `resource-group*`); las clases `labor-group*` y `equipment-group*` quedan como ganchos de las pruebas.
  - `ui-lab`: 20 controles RES-02-EQ por modo.
  - Decisiones técnicas:
    - el grupo de flushby y wireline se llama "Equipos de pozo": el auditor de terminología del Test Lab no deja usar "intervención" fuera de la activación de los servicios permanentes (D8);
    - "Ver cálculo" de la posesión es una traza propia (`holdingTrace`) que termina en el número de la fila; la del equipo completo termina en el costo a la utilización esperada;
    - la operación se muestra sin combustible y con los litros por hora: el combustible se valúa en cada cotización;
    - en el celular, la explicación de posesión y operación se pliega y la cantidad de la barra se oculta en las vistas agrupadas (el resumen la dice), para que el primer grupo aparezca en la primera pantalla;
    - la nota "Valor en USD…" de una unidad sin tipo de cambio ensanchaba la página en el celular (ya pasaba en "Lista"): ahora se parte.

### PLAN-2026-025 — DESIGN-02 (1/2): DESIGN.md propio y leer bien montos, unidades, riesgo y estado de guardado

- Estado: En curso — rama `claude/design-02-ingenieria-clara`, desde `main` `d6540b7`. PR sin merge ni deploy
- Tipo: UX y accesibilidad; **ninguna fórmula ni dato cambia**
- Responsable: agente de desarrollo (Claude) · decisiones: el dueño (20/10: "Apruebo como dirección general «Ingeniería clara» […] Prepará las mejoras prioritarias de UX y un DESIGN.md propio […] El logo concepto C queda como propuesta: todavía NO lo reemplaces. Priorizá la experiencia real de cotizar y entender resultados"), sobre la auditoría DESIGN-01 de RATEOS-AUDIT (`tasks/DESIGN-01/`: AUDITORIA, DESIGN.md propuesto y PLAN)
- Fecha de inicio: 2026-10-20

#### 1. Contexto y problema
Verificado en el código de `main` (RATEOS-AUDIT `tasks/DESIGN-01/AUDITORIA.md`, con `archivo:línea`):
- **No hay un sistema de diseño escrito.** Los tokens existen (`css/styles.css`, `:root`), pero sin nombres por función: hay 135 colores sueltos y 87 tamaños de letra.
- **Texto chico donde se lee el riesgo y la plata:**
  - la etiqueta ILUSTRATIVO mide unos 10 px;
  - los subtítulos de columna del Resultado, 9,9 px;
  - los textos del gráfico, 10 y 11 px;
  - en total hay 91 tamaños de letra por debajo de 12 px.
- **La raíz está fija en 15 px:** ignora el tamaño de letra que elige la persona en su navegador (WCAG 1.4.4).
- **Montos clave sin cifras tabulares** (`font-variant-numeric: normal` en las cifras del Resultado): los dígitos "bailan" al cambiar.
- **"Ver cálculo" mide unos 18 px de alto en escritorio.** Es la puerta para entender cada número; WCAG 2.5.8 pide 24 px.
- **En el gráfico del Resultado, la tarifa piso y el precio objetivo** son dos líneas llenas que sólo se distinguen por el tono de azul (WCAG 1.4.1).
- **Los campos dentro de tablas** tienen un borde de 1,3:1: no se ve dónde se escribe (WCAG 1.4.11 pide 3:1).
- **Estado de guardado:**
  - en el riel (761 a 1100 px), "Sin conexión", "Conflicto" o "Guardado" quedan como un punto de color sin texto;
  - en el celular, el estado queda dentro del menú cerrado.
- **Precio de referencia:** VAL-01 (condición VAL-G4 de la beta) pide decir que RATEOS calcula con los datos de la empresa y que **no es un precio de mercado**. Hoy no lo dice en ningún lado.
- **El PDF imprime la fecha de impresión, no la de la oferta** (`offerDate`; AUD-T1 C-E2-11).

#### 2. Decisiones (las del dueño; para lo técnico, lo más seguro y sencillo)
- **Dirección "Ingeniería clara" (DD-1, aprobada):** evolución, no rediseño. Misma paleta, sin efectos ni animaciones nuevas.
- **Logo (DD-2):** el concepto C queda como propuesta. **No se toca la marca.**
- **Tipografía (DD-3, sin decisión):** no se carga ninguna fuente. `DESIGN.md` documenta la pila actual y deja Inter autoalojada como propuesta.
- **Prioridades del Issue #5:** legibilidad de montos y unidades, estado guardado, precios de referencia frente a resultado no confiable, y datos ilustrativos. "Nunca romper claridad de cotización por embellecer".
- **Alcance de este PR (1/2), cada punto con su control automático:**
  1. **`DESIGN.md` en la raíz:** principios, tokens por función, tipografía y números, estados de riesgo, componentes, celular, impresión, voz, checklist de accesibilidad por PR, estados de pantalla y guía para agentes. Un test verifica que sus colores coincidan con los de `css/styles.css`.
  2. **Alias por función** (`--color-text`, `--color-status-critical`…) en `:root`, que apuntan a los tokens actuales. Sin cambio visual. Se usan en las reglas que toca este PR.
  3. **Raíz en %:** `93.75 %` (15 px) en escritorio y `100 %` (16 px) en el celular. Con el tamaño de fábrica del navegador se ve igual; si la persona agranda la letra, la app la sigue.
  4. **Mínimo de 12 px:**
     - `--fs-xs` pasa de 0,78 rem a 0,8 rem (12 px);
     - todo tamaño menor en `styles.css`, `quote.css`, `result.css` y `views.css` pasa a `var(--fs-xs)`;
     - los textos del gráfico pasan a 12 px.
     - `public.css` (landing y registro) queda para D7, después del merge de HD-03 (#28), salvo la etiqueta ILUSTRATIVO.
  5. **Cifras tabulares** en las cifras clave del Resultado.
  6. **"Ver cálculo" de al menos 24 px de alto** en escritorio (en el celular ya mide 44 px).
  7. **Gráfico:** la tarifa piso pasa a línea de trazos (con su muestra igual en la leyenda); el objetivo queda lleno. Ya no se distinguen sólo por el color.
  8. **Campos en tablas** con el borde de los campos (`--field-border`, 3,3:1).
  9. **Estado de guardado con palabra:**
     - en el riel, ícono + palabra corta;
     - en el celular, el estado en la barra de arriba, sin abrir el menú.
     - El texto completo sigue igual; los avisos de error no cambian.
  10. **"No es un precio de mercado" (VAL-G4):** junto a "Montos sin IVA" en el Resultado y en el encabezado del PDF: "Calculado con tus costos y tus supuestos: no es un precio de mercado."
  11. **PDF:** la fecha de la oferta y, aparte, la de impresión.
- **Para después** (DESIGN-02 2/2 y siguientes):
  - Resumen en vivo con el resultado y el margen esperados siempre a la vista; tablas de estructura y de tramos apiladas en el celular; barra compacta que destaca la sugerida; avisos arriba en el celular; `aria-required` y ayudas asociadas; montos con separadores al salir del campo.
  - Configuración con los mismos textos de sincronización que el editor: después de UX-01 (#32), que cambia ese código.
  - Primer uso (D2), Inter (DD-3), logo (DD-2) y landing y registro (D7, después de #28).

#### 3. Impacto en fórmulas
Ninguno. No se toca `js/engines/**` ni `js/domain/**`. Golden 39/39 y candado sin cambios.

#### 4. Impacto en datos
Ninguno: ni campos nuevos ni esquema (sigue en 10). El PDF sólo lee `offerDate`, que ya existe.

#### 5. Pasos
- [x] 1. Este plan, antes del código.
- [x] 2. Tests que fallan en `main`: el estático de `DESIGN.md` y los tokens (`tests/ui/design-system.test.js`) y el bloque DESIGN-02 del `ui-lab` (escritorio y celular, con una prueba sólo con teclado).
- [x] 3. `DESIGN.md`, tokens, CSS, estado de guardado, nota de precio de referencia y fecha de la oferta.
- [x] 4. Validación completa:
  - suite, Test Lab, gate, `ui-lab` y `auth-lab`;
  - capturas antes y después a 1440 y 390 px;
  - Code Review (skill) del diff;
  - PR sin merge, evidencia en RATEOS-AUDIT y verificación combinada con los PR #28 a #34.

#### 6. Rollback
Revert del PR. No deja datos.

#### Bitácora
- 2026-10-20: base `main` `d6540b7`. Primero este plan; después los tests y la implementación.
- 2026-10-20: tests escritos antes del código: los 15 estáticos fallan en `main` (`tests/ui/design-system.test.js` y `tests/ui/reference-text.test.js`); el bloque DESIGN-02 del `ui-lab` se corre contra `main` con acciones "suaves".
- 2026-10-20: implementado.
  - CSS: 75 tamaños por debajo de 12 px pasan a `var(--fs-xs)` (0,8 rem), salvo los textos del gráfico, que van en `12px` porque el SVG se dibuja en px reales. Con texto de 12 px, los rótulos al final de las líneas del gráfico piden 14 px de separación (antes 13).
  - Decisiones técnicas:
    - la tarifa piso va **punteada** (no con guiones), porque los guiones ya son de la tarifa cotizada;
    - en el riel, el texto completo del estado queda para los lectores de pantalla y se ve la palabra corta (`SYNC_SHORT_LABELS` en `js/app.js`);
    - en el celular, la barra lleva su propio `role="status"`: con el menú cerrado, el del menú no se ve ni se anuncia;
    - los textos nuevos están en `js/ui/reference-text.js` (puro, con tests): la nota de mercado y las fechas del PDF, que leen `offerDate` como fecha sin hora (no se corre un día por la zona horaria).
- 2026-10-20: el control de 12 px del `ui-lab` encontró, en escritorio, tamaños en `em` que dentro de un texto de 12 px quedaban en 10,7 a 11 px (`.mono`, `.unit-suffix`, `.qr-unit`, `.qr-cuadre-detail`). Pasan a `max(…em, var(--fs-xs))`, con un test estático que lo exige (`32ba256`). Contra `main`, el detalle de ese control copiaba el email sintético de la cuenta y el lab, con razón, no escribía el reporte: ahora cuenta por pantalla, clase y tamaño, sin copiar el texto.
- 2026-10-20: revisión de código (skill Code Review, nivel medio, sobre `d6540b7..32ba256`): 8 observaciones, ninguna sobre un cálculo. Siete se corrigieron en `2607790`:
  - margen izquierdo y separación del eje X del gráfico según el ancho de los rótulos de 12 px;
  - en el celular, el estado del menú se oculta (con el menú abierto se anunciaba dos veces) y la palabra de la barra se acorta antes que apretar "Menú";
  - un solo validador de fechas (`dayFromDate`);
  - en el `ui-lab`, la fecha de impresión sale del navegador, la cotización ilustrativa sintética entra en el control de fugas de sesión y hay dos controles nuevos en el celular (un solo estado con el menú abierto; la barra a 320 px).
  - Queda a propósito el mínimo de 24 px de "Ver cálculo" también en los botones compactos: son controles sueltos (WCAG 2.5.8).
- 2026-10-20: validación en `2607790` (SIMULADA):
  - `npm test` en verde, Test Lab OK (golden 39/39), gate PASA;
  - `ui-lab` 395/395 (escritorio) y 397/397 (celular), con 15 y 17 controles DESIGN-02;
  - contra `main` fallan 12 de 15 y 10 de 17 (fuera del bloque, 0);
  - combinado con los PR #28 a #34: `npm test` 1918/1918, `ui-lab` 606/606 y 608/608, `auth-lab` 136/136.
  - Al combinarse con ECO-02 (#29), su pastilla "No confiable" (0,75 rem) queda por debajo de 12 px: el test de DESIGN-02 la marca y la pasa a `var(--fs-xs)`.
