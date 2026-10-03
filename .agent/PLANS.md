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
| PLAN-2026-001 | MVP funcional RATEOS v0.1.0 | motor de costos, migración, otro | Completado |

### PLAN-2026-001 — MVP funcional RATEOS v0.1.0

- Estado: Completado
- Tipo: motor de costos · margen · utilización · migración (esquema inicial v1) · deploy
- Responsable: equipo de agentes de programación + revisión del dueño del repositorio
- Fecha de inicio: 2026-10-03 · Fecha de cierre: 2026-10-03
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
Economía (fórmulas y golden cases), QA (casos extremos y flujos), Seguridad (CSP, DOM seguro, backups, sin secretos), UX (lenguaje simple, "Ver cálculo", ILUSTRATIVO) — registrado en el Pull Request.

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

#### Bitácora
- 2026-10-03 — Arquitectura en capas y contratos definidos; implementación del núcleo, UI, tests, CI/CD y documentación; PR abierto hacia `main` para revisión del dueño antes del merge.
