# AGENTS.md — Constitución de RATEOS

Reglas permanentes para **cualquier agente de programación** (o persona) que trabaje en este repositorio. **Leé este archivo completo antes de hacer cambios importantes.** Si una instrucción puntual contradice estas reglas, prevalecen estas reglas salvo que el dueño del repositorio indique explícitamente lo contrario.

Prioridad ante conflictos: **precisión matemática > seguridad > mantenibilidad > claridad de UX > estética**.

Documentos de referencia:

- [README.md](README.md) — qué es, cómo ejecutar, testear y desplegar.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — capas, módulos y reglas de dependencia.
- [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) — todas las fórmulas.
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — modelo actual y futuro.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — CI/CD, versiones y rollback.
- [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) y [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) — evolución futura.
- [docs/AGENT_ROLES.md](docs/AGENT_ROLES.md) — roles de revisión (Product, Economics, QA, Security, Data, UX).
- [.agent/PLANS.md](.agent/PLANS.md) — planes de ejecución para cambios grandes.

## 1. Propósito del producto

RATEOS es un **motor determinístico** de:

- estructuras de costos,
- pricing,
- rentabilidad,
- utilización,
- break-even,
- escenarios,

para PyMEs proveedoras de servicios industriales (inicialmente Oil & Gas de Neuquén / Vaca Muerta).

Idea central: **ayudar a una empresa a saber cuánto le cuesta realmente prestar un servicio y a qué precio debería cotizarlo para no perder dinero.** Foco:

```
COSTO → TARIFA → RENTABILIDAD → DECISIÓN COMERCIAL
```

Conceptos que nunca se mezclan: **costo** (lo que cuesta prestar el servicio), **tarifa piso** (precio mínimo para no perder), **precio objetivo** (precio para lograr el margen buscado) y **precio comercial** (precio finalmente ofrecido).

## 2. No IA

- No convertir RATEOS en un producto de IA.
- No chatbot, no copilot, no contenido generativo, no integraciones con OpenAI, Claude ni similares dentro del producto, salvo instrucción explícita futura del dueño.
- El valor está en reglas, cálculos, datos persistentes y escenarios.
- Los roles de [docs/AGENT_ROLES.md](docs/AGENT_ROLES.md) son para desarrollo, **no** funcionalidades del producto.

## 3. Scope

RATEOS **NO** es:

- ERP
- payroll (liquidación de sueldos)
- CRM
- marketplace
- facturación
- gestor documental

Antes de agregar una funcionalidad, preguntate si ayuda a costear, tarifar o decidir comercialmente. Si no, no va.

## 4. Arquitectura

Capas (detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

```
UI (js/ui, js/app.js)  →  Servicios (js/services)  →  Motores (js/engines)  →  Datos (js/data)
Transversal: js/core, js/domain, js/config.js
```

Reglas de import (verificadas por `tests/architecture.test.js`):

- La UI puede importar services, engines, domain, core y config. **La UI NO importa `js/data/`.**
- Los motores sólo importan core, domain, config y otros motores. **Son funciones puras:** sin DOM, sin storage, sin red, sin fecha actual ni aleatoriedad.
- Los servicios usan `StorageRepository` y los motores.
- Fuera de `js/data/` nadie usa `localStorage` ni `sessionStorage`.
- No mezclar fórmulas con handlers de UI: si una pantalla necesita un número, lo pide a un motor.
- Imports y recursos con rutas **relativas** (`./`, `../`). Nunca `/js/...`.
- Configuración repetida → `js/config.js` (sin secretos).
- Errores y mensajes técnicos → `logger` (`js/core/logger.js`); nada de `console.log` dispersos.
- El motor no se acopla a GitHub Pages: debe poder correr en otro hosting o en un backend.

## 5. Cálculos

- **Determinísticos, reproducibles, testeables y auditables.** Mismos inputs = mismos outputs.
- Todo resultado importante se puede explicar con "Ver cálculo": fórmula, entradas y resultado (`createTrace` en `js/core/trace.js`). **Nunca números mágicos.**
- Los resultados calculados no se persisten como verdad: se recalculan con `computeQuote`.
- Nunca mostrar `NaN`, `Infinity` ni `-Infinity`: usar `safeDivide`, `nonNegative`, `toNumber` (`js/core/money.js`) y formatear con `js/core/format.js` ("—").

## 6. Protección del motor

Nunca cambiar una fórmula económica sin:

1. **identificar qué cambia** (fórmula, archivo, función y un caso numérico antes → después);
2. **actualizar o agregar tests**;
3. **verificar los casos anteriores** (suite completa y golden cases de `tests/golden-cases/`);
4. **documentar** el cambio material en [docs/CALCULATION_RULES.md](docs/CALCULATION_RULES.md) y en el [CHANGELOG.md](CHANGELOG.md).

Cambios grandes del motor requieren un plan en [.agent/PLANS.md](.agent/PLANS.md) y review multidisciplinario (§18).

## 7. No inventar normativa

Nunca inventar ni presentar como reales:

- escalas salariales,
- porcentajes sindicales,
- cargas patronales,
- impuestos o alícuotas,
- CCT (convenios colectivos),
- valores legales.

Los datos demo son **ILUSTRATIVOS** y deben verse marcados como tales en la interfaz (`illustrative: true`, banners y etiquetas). Los parámetros de convenio demo son genéricos e iguales para todos los convenios a propósito.

## 8. Precisión monetaria

- Redondeos centralizados en `js/core/money.js`: `roundMoney()` (2 decimales), `roundRate()` (4), `roundPercentage()` (2), `roundDays()` (2), `roundPercentagesToTotal()` (EECC = 100 %).
- **Separar valor interno de cálculo y valor mostrado:** los motores calculan sin redondear; se redondea al presentar.
- Porcentajes en puntos (`10` = 10 %).
- El redondeo comercial de tarifas es hacia arriba (`commercialRound`): nunca baja el margen.

## 9. Margen ≠ markup

Nunca tratarlos como sinónimos, ni en código ni en textos:

- Margen (sobre precio): `precio = costo / (1 − margen)` → costo 100, margen 10 % = **111,11**.
- Markup (sobre costo): `precio = costo × (1 + markup)` → costo 100, markup 10 % = **110**.

Hay tests que lo protegen. No los borres.

## 10. Tests como contrato del negocio

- `npm test` (Node ≥ 20, `node --test`, sin dependencias) debe pasar **antes y después** de cualquier cambio de lógica.
- Los tests del motor son especificación funcional: `breakEven = 10 días` en el caso on-call básico es una **regla de negocio**.
- Cada bug económico corregido agrega un test que impide que vuelva.
- Golden cases (`tests/golden-cases/`, un `.json` por caso con `{ id, title, rule, engine, inputs, expected, tolerance }`) deben seguir valiendo aunque cambie la interfaz: on-call 30.000.000 / 1.000.000 / 4.000.000 → 10 días; margen 10 % sobre 100 → 111,11; markup 10 % sobre 100 → 110. Si un cambio rompe un golden case, es un cambio de regla de negocio: se discute y documenta antes de tocar el caso.
- Casos extremos obligatorios: actividad 0, margen 0, utilización 100 %, utilización cercana a 0, precio inferior a costo, descuento con margen negativo, valores vacíos, negativos inválidos.
- No se considera terminada una tarea si algo anterior se rompe.

## 11. Persistencia

- Toda persistencia pasa por `StorageRepository` (`js/data/storage-repository.js`); hoy la implementa `LocalStorageRepository`.
- Estado en `rateos.state` con `schemaVersion`. La clave no depende de la versión: los datos sobreviven recargas, cierres y nuevos deploys.
- Si cambia el formato: subir `SCHEMA_VERSION`, agregar `migrateV{N}ToV{N+1}()` en `js/data/migrations.js`, tests con datos de la versión anterior y entrada en el CHANGELOG.
- **Nunca** usar `localStorage.clear()`. **Nunca** borrar datos porque cambió la estructura: se migran, y antes se guarda una copia de recuperación.
- Datos de una versión más nueva de RATEOS → modo sólo lectura.
- Entidades principales con `id` (UUID), `organizationId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`. Nunca usar el nombre visible como clave.
- Varias pestañas comparten el mismo almacenamiento: `LocalStorageRepository` relee `rateos.state` antes de cada lectura/escritura y adopta los cambios de otra pestaña. Nunca persistir una copia vieja en memoria del estado completo. Limitación conocida: si dos pestañas editan LA MISMA cotización a la vez, gana el último guardado.

## 12. Backup

- Exportar a JSON versionado e importar desde JSON.
- **Validar antes de importar** (tamaño, JSON, migración, `validateState`).
- **Pedir confirmación antes de sobrescribir** y guardar una copia de recuperación previa.
- El formato del backup es el mismo que se usará para migrar a Supabase: mantenerlo limpio y estable.

## 13. Seguridad

- El repo y GitHub Pages pueden ser públicos. **Todo JavaScript frontend es público.**
- Nunca guardar en el repo: API keys, passwords, tokens, service role keys, secretos, archivos `.env`, documentos reales de clientes, estructuras de costos reales ni datos confidenciales. Las planillas de referencia (`.xls`, `.xlsx`, `.ods`…) están en `.gitignore` y un test impide versionarlas: se analizan fuera del repo y sólo se documenta su lógica conceptual, nunca sus valores, nombres ni contratos (ver [docs/REFERENCE_COST_STRUCTURE.md](docs/REFERENCE_COST_STRUCTURE.md)). `.gitignore` ya excluye `.env*` (salvo `.env.example`), `secrets` (archivo o carpeta), `secrets.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*credentials*`, `*credenciales*`, `*service-account*.json` y `.npmrc`.
- DOM: **no usar `innerHTML`** (ni `outerHTML`, `insertAdjacentHTML`, `document.write`) con datos de usuario; preferir `textContent` / `h()` de `js/ui/dom.js`.
- **No usar `eval()`, `new Function()`** ni `setTimeout`/`setInterval` con strings.
- Validar inputs: cantidad ≥ 0, distancia ≥ 0, horas ≥ 0, margen válido (0 ≤ margen < 100), utilización > 0 y ≤ 100 (`RULES` en `js/core/validation.js`).
- No relajar la CSP de `index.html` (sin scripts inline, sin CDNs, sin terceros).
- Minimizar dependencias: hoy hay **cero** dependencias npm. No agregar paquetes sin una razón fuerte y documentada.
- El origen `joaquinvedova1.github.io` es compartido por todos los sitios de Pages de esa cuenta (comparten `localStorage`): no publicar en esa cuenta sitios no confiables.

## 14. Privacidad

- RATEOS maneja información empresarial sensible: minimizar datos y no enviarlos a servicios externos.
- No hay analytics. Los eventos internos (`js/core/events.js`) usan lista blanca de nombres y propiedades y **nunca** incluyen salarios, costos, tarifas, montos, nombres de clientes ni texto libre. Permitido: `user_finished_quote = true`. No permitido: `monthly_labor_cost = 85000000`.
- El logger de producción no emite contexto (puede contener datos de negocio).

## 15. Git

- Flujo: **rama → tests → Pull Request → main → deploy**. `main` = producción.
- **No force push a `main`** ni push directo a `main`. No borrar historial publicado.
- No crear carpetas `version1/`, `version2/`: el historial vive en Git.
- Mantener [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog + SemVer).
- Tags `v0.x.x` **sólo para hitos** importantes.
- No borrar funcionalidades existentes sin una razón explícita.
- Usar la [plantilla de Pull Request](.github/pull_request_template.md) y su checklist.

## 16. Despliegue

- GitHub Pages bajo **`/COTIZADORWEB/`**: nunca asumir la raíz `/`. Todas las rutas relativas; routing por hash.
- Workflow "Deploy RATEOS a GitHub Pages" (`.github/workflows/deploy-pages.yml`): push a `main` o manual → test → build → deploy. **Si fallan los tests, no se despliega.**
- Rollback: revert vía PR (preferido) o redeploy manual de un tag/SHA anterior que ya esté en `main` (el workflow rechaza commits que no están en main). Detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Cada build expone versión, commit corto y fecha en Configuración → Acerca de.

## 17. UX

- Usuarios: dueño PyME, gerente comercial, administrativo, ingeniero, presupuestista.
- Lenguaje simple, español rioplatense. Ejemplo: no "factor de utilización"; sí "¿Cuántos días del mes esperás que el equipo esté trabajando y facturando?".
- **"Ver cálculo"** en todo resultado importante.
- Desktop first, B2B industrial premium, Neuquén / Patagonia sin clichés petroleros.
- Confirmar antes de acciones destructivas; mensajes de error que digan qué hacer.

## 18. Review multidisciplinario

Para cambios importantes del motor económico, revisar desde cuatro perspectivas y dejarlo escrito en el PR:

1. **Economía** — ¿La fórmula es correcta?
2. **QA** — ¿Qué pasa con 0 días y demás casos extremos?
3. **Seguridad** — ¿Se valida el input?
4. **UX** — ¿El usuario entiende el resultado?

Checklists por rol en [docs/AGENT_ROLES.md](docs/AGENT_ROLES.md).

## 19. Supabase y evolución futura

- **Hoy no se conecta Supabase, Firebase ni ningún backend**, ni login, ni RLS, ni PostHog, ni agentes autónomos, ni microservicios.
- El diseño ya está preparado: `StorageRepository`, `STORAGE_MODE`, `FEATURES` (`supabase`, `multiOrganization`, `historicalComparison`, `analytics` en `false`), `organizationId` y metadatos en las entidades.
- Cuando se implemente: `SupabaseRepository` en `js/data/` sin tocar motores; **RLS obligatoria** en todas las tablas con datos empresariales (sólo miembros de la organización); **`SUPABASE_SERVICE_ROLE_KEY` nunca en el frontend**, GitHub Pages, JavaScript público ni repositorio; operaciones privilegiadas en Edge Functions. Ver [docs/SUPABASE_PLAN.md](docs/SUPABASE_PLAN.md) y [docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md).

## 20. Execution plans

Cambios grandes (nueva modalidad contractual, cambios en el motor de costos, cambios de margen, nuevo motor de utilización, backend, autenticación, multiempresa, migraciones) se planifican primero en [.agent/PLANS.md](.agent/PLANS.md).

## 21. No sobreingeniería

No agregar todavía: Kubernetes, microservicios, backend innecesario, autenticación ficticia, Docker, arquitectura enterprise, frameworks ni bundlers. Preferir: **simple, robusto, testeado, documentado.**

## 22. Comandos

```bash
npm test        # suite completa (node --test)
npm start       # http://localhost:8080/COTIZADORWEB/
npm run build   # dist/ + dist/version.json
```

## 23. Definición de terminado

- `npm test` en verde y CI en verde.
- La app funciona bajo `/COTIZADORWEB/` sin errores en consola.
- Sin `NaN`/`Infinity` en pantalla; valores demo marcados como ILUSTRATIVOS; margen y markup diferenciados.
- Persistencia intacta (datos existentes se abren; backup exporta e importa).
- Documentación y CHANGELOG actualizados cuando corresponde.
- Pull Request con el checklist completo.
